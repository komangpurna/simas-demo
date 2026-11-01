/**
 * Notification Inbox & Center System (Facebook-Style)
 * Mengelola notifikasi in-app, sinkronisasi real-time dengan Web Push,
 * penandaan status baca, dan modal detail interaktif.
 * 
 * SSOT: Cloudflare D1 SQL (0 Firestore Read/Write)
 */

import { cfClient } from './cloudflare-client.js';
import { auth } from './config.js';

let _inboxNotifications = [];
let _unreadCount = 0;
let _currentTab = 'all'; // 'all' | 'unread'
let _isLoaded = false;
let _selectedNotification = null;
let _loadingPromise = null;
let _lastLoadedAt = 0;
let _autoRefreshStarted = false;
let _inboxUid = '';
let _sessionVersion = 0;
const _incomingNotifications = new Map();
const _confirmedReadIds = new Set();
const _readRequests = new Map();

// Lonceng harus tetap terbarui untuk pengguna yang belum mengizinkan Web Push.
// Disesuaikan agar sangat hemat kuota baca D1 (5 menit periodic, 2.5 menit visibility gap).
const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const VISIBILITY_REFRESH_MIN_GAP_MS = 150 * 1000;
const INBOX_CACHE_STORAGE_KEY = 'simas_inbox_cache';
const INBOX_CACHE_TTL_MS = 90 * 1000; // 90 detik cache sinkronisasi lintas-tab

// Identitas sesi dari Firebase Auth (bukan localStorage yang bisa basi di perangkat bersama).
function getCurrentUserUid() {
    try {
        return auth?.currentUser?.uid || '';
    } catch (_) {
        return '';
    }
}

function saveInboxToLocalStorage() {
    try {
        const uid = getCurrentUserUid();
        // Tanpa UID pasti, jangan menyimpan: cache tak bertuan bisa tampil di akun lain.
        if (!uid || uid !== _inboxUid || typeof localStorage === 'undefined') return;
        localStorage.setItem(INBOX_CACHE_STORAGE_KEY, JSON.stringify({
            uid,
            notifications: _inboxNotifications,
            unreadCount: _unreadCount,
            loaded: _isLoaded,
            timestamp: Date.now()
        }));
    } catch (_) {}
}

// Cache lintas-tab hanya dipakai bila milik akun yang sama persis dan masih segar.
function readFreshInboxCache() {
    try {
        if (typeof localStorage === 'undefined') return null;
        const parsed = JSON.parse(localStorage.getItem(INBOX_CACHE_STORAGE_KEY) || 'null');
        const currentUid = getCurrentUserUid();
        if (!parsed || !parsed.uid || !currentUid || parsed.uid !== currentUid) return null;
        if (!Array.isArray(parsed.notifications)) return null;
        if (parsed.loaded === false) return null; // Push awal belum memuat riwayat server.
        if (!(Date.now() - Number(parsed.timestamp || 0) < INBOX_CACHE_TTL_MS)) return null;
        return parsed;
    } catch (_) {
        return null;
    }
}

function applyInboxCache(cache) {
    for (const item of cache.notifications || []) {
        if (item.isRead) _confirmedReadIds.add(item.id);
        if (_loadingPromise && !_inboxNotifications.some(n => n.id === item.id)) {
            _incomingNotifications.set(item.id, { notification: item, receivedAt: Date.now() });
        }
    }
    mergeInboxNotifications(cache.notifications);
    _isLoaded = true;
    _lastLoadedAt = Number(cache.timestamp || Date.now());
    updateNotificationBadges(_unreadCount);
    renderNotificationList();
    startNotificationAutoRefresh();
}

// Dipanggil saat logout: isi notifikasi pribadi tidak boleh tertinggal di perangkat bersama.
export function clearNotificationInboxCache() {
    try { localStorage.removeItem(INBOX_CACHE_STORAGE_KEY); } catch (_) {}
    resetInboxState('');
}

function resetInboxState(uid) {
    _sessionVersion++;
    _inboxUid = uid;
    _loadingPromise = null;
    _inboxNotifications = [];
    _unreadCount = 0;
    _isLoaded = false;
    _lastLoadedAt = 0;
    _selectedNotification = null;
    _incomingNotifications.clear();
    _confirmedReadIds.clear();
    _readRequests.clear();
    updateNotificationBadges(0);
    renderNotificationList();
    closeNotificationCenter();
    closeNotificationDetail();
}

function ensureInboxSession() {
    const uid = getCurrentUserUid();
    if (uid !== _inboxUid) resetInboxState(uid);
    return uid;
}

function mergeInboxNotifications(notifications, fromServer = false) {
    const items = Array.isArray(notifications) ? notifications : [];
    const byId = new Map(items.map(n => [n.id, { ...n, url: notificationTargetUrl(n.url) }]));
    for (const [id, incoming] of _incomingNotifications) {
        if ((fromServer && byId.has(id)) || Date.now() - incoming.receivedAt > AUTO_REFRESH_INTERVAL_MS) {
            _incomingNotifications.delete(id);
        } else if (!byId.has(id)) {
            byId.set(id, incoming.notification);
        }
    }
    for (const id of _confirmedReadIds) {
        const item = byId.get(id);
        if (fromServer && item?.isRead) _confirmedReadIds.delete(id);
        else if (item) item.isRead = true;
    }
    _inboxNotifications = [...byId.values()].sort((a, b) =>
        notificationDate(b.createdAt) - notificationDate(a.createdAt)).slice(0, 40);
    _unreadCount = _inboxNotifications.filter(n => !n.isRead).length;
}

function notificationDate(value) {
    // D1 datetime('now') adalah UTC, meskipun tidak menyertakan akhiran Z.
    const text = String(value || '');
    const utc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? text.replace(' ', 'T') + 'Z' : text;
    return new Date(utc);
}

export function notificationTargetUrl(raw) {
    const origin = window.location.origin;
    try {
        const url = new URL(raw || '/dashboard.html', origin);
        if (!url.username && !url.password && [origin, "https://simas-demo-5ead3.web.app"].includes(url.origin)) {
            return new URL(url.pathname + url.search + url.hash, origin).href;
        }
    } catch (_) {}
    return new URL('/dashboard.html', origin).href;
}


/**
 * Format timestamp ISO menjadi teks waktu relatif (ramah pengguna)
 */
export function formatRelativeTime(isoString) {
    if (!isoString) return '';
    try {
        const text = String(isoString);
        const date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? text.replace(' ', 'T') + 'Z' : text);
        if (isNaN(date.getTime())) return '';
        const now = new Date();
        const diffSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

        if (diffSeconds < 60) return 'Baru saja';
        const diffMinutes = Math.floor(diffSeconds / 60);
        if (diffMinutes < 60) return `${diffMinutes} mnt lalu`;
        const diffHours = Math.floor(diffMinutes / 60);
        if (diffHours < 24) return `${diffHours} jam lalu`;
        const diffDays = Math.floor(diffHours / 24);
        if (diffDays === 1) return 'Kemarin';
        if (diffDays < 7) return `${diffDays} hari lalu`;

        return date.toLocaleDateString('id-ID', {
            day: 'numeric',
            month: 'short',
            year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
        });
    } catch (_) {
        return '';
    }
}

/**
 * Mendeteksi ikon dan warna semantik berdasarkan konteks judul / URL notifikasi
 */
export function getNotificationVisual(title = '', body = '', url = '') {
    const text = `${title} ${body} ${url}`.toLowerCase();
    
    if (text.includes('lab') || text.includes('e-lab') || text.includes('laboratorium')) {
        return {
            icon: 'fa-flask',
            iconColor: 'text-sky-600 dark:text-sky-400',
            bgBadge: 'bg-sky-100 dark:bg-sky-950/60 border-sky-200 dark:border-sky-800',
            category: 'E-Laboratorium'
        };
    }
    if (text.includes('presensi') || text.includes('absen') || text.includes('kehadiran')) {
        return {
            icon: 'fa-calendar-check',
            iconColor: 'text-amber-600 dark:text-amber-400',
            bgBadge: 'bg-amber-100 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800',
            category: 'Presensi'
        };
    }
    if (text.includes('permisi') || text.includes('izin')) {
        return {
            icon: 'fa-person-walking-arrow-right',
            iconColor: 'text-blue-600 dark:text-blue-400',
            bgBadge: 'bg-blue-100 dark:bg-blue-950/60 border-blue-200 dark:border-blue-800',
            category: 'Perizinan'
        };
    }
    if (text.includes('prestasi') || text.includes('penghargaan') || text.includes('juara')) {
        return {
            icon: 'fa-trophy',
            iconColor: 'text-amber-500 dark:text-amber-400',
            bgBadge: 'bg-amber-100 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800',
            category: 'Prestasi'
        };
    }
    if (text.includes('disiplin') || text.includes('pelanggaran') || text.includes('poin') || text.includes('bk')) {
        return {
            icon: 'fa-shield-halved',
            iconColor: 'text-rose-600 dark:text-rose-400',
            bgBadge: 'bg-rose-100 dark:bg-rose-950/60 border-rose-200 dark:border-rose-800',
            category: 'Kedisiplinan & BK'
        };
    }
    if (text.includes('spp') || text.includes('keuangan') || text.includes('kas') || text.includes('tunggakan') || text.includes('iuran')) {
        return {
            icon: 'fa-receipt',
            iconColor: 'text-emerald-600 dark:text-emerald-400',
            bgBadge: 'bg-emerald-100 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800',
            category: 'Keuangan'
        };
    }
    if (text.includes('agenda') || text.includes('kegiatan') || text.includes('kalender')) {
        return {
            icon: 'fa-calendar-days',
            iconColor: 'text-purple-600 dark:text-purple-400',
            bgBadge: 'bg-purple-100 dark:bg-purple-950/60 border-purple-200 dark:border-purple-800',
            category: 'Agenda'
        };
    }
    if (text.includes('buku') || text.includes('perpus') || text.includes('sirkulasi')) {
        return {
            icon: 'fa-book-open',
            iconColor: 'text-indigo-600 dark:text-indigo-400',
            bgBadge: 'bg-indigo-100 dark:bg-indigo-950/60 border-indigo-200 dark:border-indigo-800',
            category: 'Perpustakaan'
        };
    }
    return {
        icon: 'fa-bell',
        iconColor: 'text-blue-600 dark:text-blue-400',
        bgBadge: 'bg-blue-100 dark:bg-blue-950/60 border-blue-200 dark:border-blue-800',
        category: 'Informasi'
    };
}

/**
 * Memperbarui badge angka merah di Desktop dan Mobile
 */
export function updateNotificationBadges(count = _unreadCount) {
    _unreadCount = Math.max(0, count);
    const badgeDesktop = document.getElementById('notif-badge-desktop');
    const badgeMobile = document.getElementById('notif-badge-mobile');
    const panelCountBadge = document.getElementById('notif-panel-unread-count');

    const displayCount = _unreadCount > 99 ? '99+' : String(_unreadCount);

    [badgeDesktop, badgeMobile].forEach(el => {
        if (!el) return;
        if (_unreadCount > 0) {
            el.textContent = displayCount;
            el.classList.remove('hidden');
        } else {
            el.classList.add('hidden');
        }
    });

    if (panelCountBadge) {
        if (_unreadCount > 0) {
            panelCountBadge.textContent = `${displayCount} Baru`;
            panelCountBadge.classList.remove('hidden');
        } else {
            panelCountBadge.classList.add('hidden');
        }
    }

    // Animasi Lonceng Bergerak (Bell Ring Swing) saat ada notifikasi belum dibaca
    const bellIcons = document.querySelectorAll(
        '#btn-notification-bell-desktop i.fa-bell, #btn-notification-bell-mobile i.fa-bell, #btn-notif-desktop i.fa-bell, #btn-notif-mobile i.fa-bell, .notif-bell-icon'
    );
    bellIcons.forEach(icon => {
        if (!icon) return;
        if (_unreadCount > 0) {
            icon.classList.add('animate-bell-ring');
        } else {
            icon.classList.remove('animate-bell-ring');
        }
    });
}

/**
 * Memuat notifikasi dari Cloudflare D1
 */
export async function loadNotificationInbox(forceRefresh = false, { silent = false } = {}) {
    if (!ensureInboxSession()) return;
    startNotificationAutoRefresh();
    if (!forceRefresh && _isLoaded) {
        renderNotificationList();
        return;
    }
    // Cache lintas-tab: load halaman biasa, dan auto-refresh senyap bila tab lain baru saja
    // mengambil data (hemat request D1 saat beberapa tab SIMAS terbuka). Tombol Segarkan
    // (forceRefresh tanpa silent) selalu mengambil dari server.
    if (!forceRefresh || silent) {
        const cache = readFreshInboxCache();
        if (cache && (!forceRefresh || Number(cache.timestamp) > _lastLoadedAt)) {
            applyInboxCache(cache);
            return;
        }
    }
    // Gabungkan pemanggilan bersamaan (load awal halaman, buka panel, auto-refresh).
    if (_loadingPromise) return _loadingPromise;
    const attempt = fetchNotificationInbox(forceRefresh && !silent, _inboxUid, _sessionVersion).finally(() => {
        if (_loadingPromise === attempt) _loadingPromise = null;
    });
    _loadingPromise = attempt;
    return _loadingPromise;
}

async function fetchNotificationInbox(showSpinner, uid, sessionVersion) {
    const listContainer = document.getElementById('notification-items-list');
    if (listContainer && showSpinner) {
        listContainer.innerHTML = `
            <div class="p-8 text-center text-slate-400 dark:text-slate-500 text-xs">
                <i class="fa-solid fa-circle-notch fa-spin text-lg text-blue-500 mb-2 block"></i>
                Memuat notifikasi...
            </div>
        `;
    }

    try {
        const res = await cfClient.getNotificationInbox();
        if (getCurrentUserUid() !== uid || _sessionVersion !== sessionVersion) return;
        if (res && res.success) {
            mergeInboxNotifications(res.notifications, true);
            _isLoaded = true;
            _lastLoadedAt = Date.now();
            saveInboxToLocalStorage();
            updateNotificationBadges(_unreadCount);
            renderNotificationList();
            startNotificationAutoRefresh();
        } else throw new Error('Respons inbox belum berhasil.');
    } catch (err) {
        if (getCurrentUserUid() !== uid || _sessionVersion !== sessionVersion) return;
        console.warn('[NotificationInbox] Gagal memuat notifikasi:', err.message);
        if (listContainer && _inboxNotifications.length === 0) {
            listContainer.innerHTML = `
                <div class="p-6 text-center text-slate-400 dark:text-slate-500 text-xs">
                    <i class="fa-solid fa-triangle-exclamation text-amber-500 text-lg mb-1 block"></i>
                    Belum dapat menghubungkan notifikasi server.
                </div>
            `;
        } else renderNotificationList();
    }
}

/**
 * Auto-refresh senyap untuk sesi login, termasuk pemulihan load awal yang gagal.
 * Timer hanya mengambil data saat tab terlihat, agar hemat kuota D1.
 */
function startNotificationAutoRefresh() {
    if (_autoRefreshStarted || typeof document === 'undefined') return;
    _autoRefreshStarted = true;

    const refreshSilently = () => {
        if (!getCurrentUserUid() || navigator.onLine === false) return;
        return loadNotificationInbox(true, { silent: true }).catch(() => {});
    };

    window.addEventListener('online', refreshSilently);
    window.addEventListener('storage', event => {
        if (event.key !== INBOX_CACHE_STORAGE_KEY || !ensureInboxSession()) return;
        if (!event.newValue) { resetInboxState(getCurrentUserUid()); return; }
        const cache = readFreshInboxCache();
        if (cache) applyInboxCache(cache);
    });

    setInterval(() => {
        if (document.visibilityState === 'visible') refreshSilently();
    }, AUTO_REFRESH_INTERVAL_MS);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        if (Date.now() - _lastLoadedAt < VISIBILITY_REFRESH_MIN_GAP_MS) return;
        refreshSilently();
    });
}

/**
 * Merender daftar notifikasi ke elemen DOM panel
 */
export function renderNotificationList() {
    const listContainer = document.getElementById('notification-items-list');
    if (!listContainer) return;

    let items = _inboxNotifications;
    if (_currentTab === 'unread') {
        items = items.filter(n => !n.isRead);
    }

    if (!items || items.length === 0) {
        const emptyMsg = _currentTab === 'unread' 
            ? 'Tidak ada notifikasi yang belum dibaca.' 
            : 'Belum ada notifikasi untuk Anda.';
        listContainer.innerHTML = `
            <div class="p-10 text-center text-slate-400 dark:text-slate-500 flex flex-col items-center justify-center">
                <div class="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 text-xl mb-3 shadow-inner">
                    <i class="fa-regular fa-bell-slash"></i>
                </div>
                <p class="text-xs font-semibold text-slate-600 dark:text-slate-300">${emptyMsg}</p>
                <p class="text-[11px] text-slate-400 dark:text-slate-500 mt-1">Notifikasi agenda, perizinan, dan informasi sekolah akan muncul di sini.</p>
            </div>
        `;
        return;
    }

    listContainer.innerHTML = items.map(n => {
        const visual = getNotificationVisual(n.title, n.body, n.url);
        const relativeTime = formatRelativeTime(n.createdAt);
        const unreadBg = !n.isRead ? 'bg-blue-50/50 dark:bg-blue-950/20' : 'bg-transparent';
        const unreadTitleColor = !n.isRead ? 'font-bold text-slate-900 dark:text-white' : 'font-medium text-slate-700 dark:text-slate-300';

        return `
            <div data-notification-id="${escapeHtml(n.id)}"
                class="group p-3.5 sm:p-4 hover:bg-slate-100/80 dark:hover:bg-slate-800/60 transition-colors cursor-pointer flex items-start gap-3 relative ${unreadBg}">
                
                <!-- Ikon Kategori -->
                <div class="w-10 h-10 rounded-xl ${visual.bgBadge} border flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                    <i class="fa-solid ${visual.icon} ${visual.iconColor} text-base"></i>
                </div>

                <!-- Konten Notifikasi -->
                <div class="flex-1 min-w-0 pr-2">
                    <div class="flex items-center justify-between gap-2 mb-0.5">
                        <span class="text-[10px] font-bold uppercase tracking-wider ${visual.iconColor}">${visual.category}</span>
                        <span class="text-[10px] text-slate-400 dark:text-slate-500 shrink-0 font-medium">${relativeTime}</span>
                    </div>
                    <h4 class="text-xs ${unreadTitleColor} leading-snug line-clamp-1 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">${escapeHtml(n.title)}</h4>
                    <p class="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5 leading-relaxed">${escapeHtml(n.body)}</p>
                </div>

                <!-- Indikator Belum Dibaca (Titik Biru) -->
                ${!n.isRead ? `
                    <div class="w-2.5 h-2.5 rounded-full bg-blue-600 ring-4 ring-blue-100 dark:ring-blue-900/40 shrink-0 self-center" title="Belum dibaca"></div>
                ` : ''}
            </div>
        `;
    }).join('');
    listContainer.querySelectorAll('[data-notification-id]').forEach(row => {
        row.addEventListener('click', () => openNotificationDetail(row.dataset.notificationId));
    });
}

/**
 * Membuka / menutup dropdown panel notifikasi
 */
export function toggleNotificationCenter() {
    const panel = document.getElementById('notification-center-panel');
    const backdrop = document.getElementById('notification-center-backdrop');
    if (!panel) return;

    const isHidden = panel.classList.contains('hidden');
    if (isHidden) {
        openNotificationCenter();
    } else {
        closeNotificationCenter();
    }
}

export function openNotificationCenter() {
    if (!ensureInboxSession()) return;
    const panel = document.getElementById('notification-center-panel');
    const backdrop = document.getElementById('notification-center-backdrop');
    if (!panel) return;

    // Di Desktop, posisikan panel popover tepat di bawah tombol lonceng desktop yang melayang
    if (window.innerWidth >= 768) {
        const bellBtn = document.getElementById('btn-notification-bell-desktop');
        if (bellBtn) {
            const rect = bellBtn.getBoundingClientRect();
            panel.style.top = `${rect.bottom + 10}px`;
            const panelWidth = 410;
            let leftPos = rect.left - 10;
            if (leftPos + panelWidth > window.innerWidth - 16) {
                leftPos = window.innerWidth - panelWidth - 16;
            }
            if (leftPos < 16) leftPos = 16;
            panel.style.left = `${leftPos}px`;
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        }
    } else {
        // Di Mobile, bersihkan inline styling agar layout Bottom Sheet native aktif
        panel.style.top = '';
        panel.style.left = '';
        panel.style.right = '';
        panel.style.bottom = '';
    }

    panel.classList.remove('hidden');
    panel.classList.add('flex');
    if (backdrop) backdrop.classList.remove('hidden');

    // Pastikan data termuat
    loadNotificationInbox(_isLoaded && Date.now() - _lastLoadedAt >= INBOX_CACHE_TTL_MS, { silent: true });
}

export function closeNotificationCenter() {
    const panel = document.getElementById('notification-center-panel');
    const backdrop = document.getElementById('notification-center-backdrop');
    if (panel) {
        panel.classList.add('hidden');
        panel.classList.remove('flex');
    }
    if (backdrop) backdrop.classList.add('hidden');
}

// Tutup panel jika ukuran layar diubah untuk mencegah glitch responsive
if (typeof window !== 'undefined') {
    window.addEventListener('resize', () => {
        const panel = document.getElementById('notification-center-panel');
        if (panel && !panel.classList.contains('hidden')) {
            closeNotificationCenter();
        }
    });
}

/**
 * Mengatur filter tab ('all' vs 'unread')
 */
export function setNotificationTab(tab = 'all') {
    _currentTab = tab;
    const tabAll = document.getElementById('tab-notif-all');
    const tabUnread = document.getElementById('tab-notif-unread');

    if (tab === 'all') {
        if (tabAll) {
            tabAll.className = 'px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 transition shadow-sm';
        }
        if (tabUnread) {
            tabUnread.className = 'px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition';
        }
    } else {
        if (tabAll) {
            tabAll.className = 'px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition';
        }
        if (tabUnread) {
            tabUnread.className = 'px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 transition shadow-sm';
        }
    }

    renderNotificationList();
}

/**
 * Menandai semua notifikasi sebagai sudah dibaca
 */
export async function markAllNotificationsAsRead() {
    if (!ensureInboxSession()) return;
    return persistNotificationRead(_inboxNotifications.map(n => n.id), true);
}

function persistNotificationRead(ids, markAll = false) {
    const key = `${markAll ? 'all' : 'one'}:${[...ids].sort().join(',')}`;
    if (_readRequests.has(key)) return _readRequests.get(key);
    const attempt = performNotificationRead(ids, markAll).finally(() => {
        if (_readRequests.get(key) === attempt) _readRequests.delete(key);
    });
    _readRequests.set(key, attempt);
    return attempt;
}

async function performNotificationRead(ids, markAll) {
    const uid = _inboxUid;
    const sessionVersion = _sessionVersion;
    try {
        // Push lama/Firebase Console dapat tidak punya job D1. Statusnya hanya
        // lokal; jangan kirim ID sementara yang pasti ditolak endpoint server.
        const transient = !markAll && _inboxNotifications.find(n => n.id === ids[0])?.isTransient === true;
        const res = transient ? { success: true } : await cfClient.markNotificationAsRead(markAll ? '' : ids[0], markAll);
        if (getCurrentUserUid() !== uid || _sessionVersion !== sessionVersion) return;
        if (!res?.success) throw new Error('Status baca belum tersimpan di server.');
        ids.forEach(id => _confirmedReadIds.add(id));
        _inboxNotifications.forEach(n => { if (_confirmedReadIds.has(n.id)) n.isRead = true; });
        _unreadCount = _inboxNotifications.filter(n => !n.isRead).length;
        saveInboxToLocalStorage();
        updateNotificationBadges(_unreadCount);
        renderNotificationList();
        if (markAll && typeof window.showToast === 'function') {
            window.showToast('Notifikasi', 'Semua notifikasi telah ditandai sudah dibaca.', 'success', 2000);
        }
    } catch (err) {
        if (getCurrentUserUid() !== uid || _sessionVersion !== sessionVersion) return;
        console.warn('[NotificationInbox] Gagal menyimpan status baca:', err.message);
        window.showToast?.('Status Baca Belum Tersimpan', 'Periksa koneksi lalu coba kembali.', 'warning', 3000);
    }
}

/**
 * Membuka Modal Detail Notifikasi Lengkap
 */
export async function openNotificationDetail(id) {
    if (!ensureInboxSession()) return;
    const notif = _inboxNotifications.find(n => n.id === id);
    if (!notif) return;

    _selectedNotification = notif;

    // Status lokal mengikuti konfirmasi D1 agar tidak kembali belum dibaca saat reload.
    if (!notif.isRead) {
        persistNotificationRead([notif.id]);
    }


    const modal = document.getElementById('modal-notification-detail');
    if (!modal) return;

    const visual = getNotificationVisual(notif.title, notif.body, notif.url);
    const dateStr = notif.createdAt ? notificationDate(notif.createdAt).toLocaleString('id-ID', {
        dateStyle: 'full',
        timeStyle: 'short'
    }) : 'Baru saja';

    document.getElementById('notif-detail-category-badge').textContent = visual.category;
    document.getElementById('notif-detail-category-badge').className = `px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${visual.bgBadge} ${visual.iconColor}`;
    
    document.getElementById('notif-detail-icon-container').className = `w-12 h-12 rounded-2xl ${visual.bgBadge} border flex items-center justify-center shrink-0 text-xl shadow-sm`;
    document.getElementById('notif-detail-icon').className = `fa-solid ${visual.icon} ${visual.iconColor}`;

    document.getElementById('notif-detail-title').textContent = notif.title || 'Notifikasi SIMAS';
    document.getElementById('notif-detail-time').textContent = dateStr;
    document.getElementById('notif-detail-body').textContent = notif.body || '';

    // Tombol CTA Aksi Halaman
    const actionBtn = document.getElementById('notif-detail-btn-action');
    if (notif.url && notificationTargetUrl(notif.url) !== notificationTargetUrl('/dashboard.html')) {
        actionBtn.classList.remove('hidden');
        actionBtn.onclick = () => {
            window.location.href = notificationTargetUrl(notif.url);
        };
    } else {
        actionBtn.classList.add('hidden');
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

export function closeNotificationDetail() {
    const modal = document.getElementById('modal-notification-detail');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

/**
 * Menyuntikkan notifikasi baru secara Real-time saat Web Push tiba di browser
 */
export function injectIncomingNotification(payload) {
    if (!payload || !ensureInboxSession()) return;
    const data = payload.data || {};
    if (data.recipientUid && data.recipientUid !== _inboxUid) return;
    const notification = payload.notification || {};

    const newNotif = {
        id: data.jobId || payload.messageId || ('push_' + Date.now()),
        title: notification.title || data.title || 'Notifikasi SIMAS',
        body: notification.body || data.body || '',
        url: notificationTargetUrl(data.url),
        targetType: data.targetType || 'user',
        isTransient: !data.jobId,
        createdAt: new Date().toISOString(),
        isRead: false
    };

    // Tambahkan ke state lokal paling atas jika belum ada
    if (!_inboxNotifications.some(n => n.id === newNotif.id)) {
        _inboxNotifications.unshift(newNotif);
        _incomingNotifications.set(newNotif.id, { notification: newNotif, receivedAt: Date.now() });
        _inboxNotifications = _inboxNotifications.slice(0, 40);
        _unreadCount = _inboxNotifications.filter(n => !n.isRead).length;
        saveInboxToLocalStorage();
        updateNotificationBadges(_unreadCount);
        renderNotificationList();
        startNotificationAutoRefresh();
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Bind ke window untuk interaksi global & onClick HTML
window.loadNotificationInbox = loadNotificationInbox;
window.toggleNotificationCenter = toggleNotificationCenter;
window.openNotificationCenter = openNotificationCenter;
window.closeNotificationCenter = closeNotificationCenter;
window.setNotificationTab = setNotificationTab;
window.markAllNotificationsAsRead = markAllNotificationsAsRead;
window.openNotificationDetail = openNotificationDetail;
window.closeNotificationDetail = closeNotificationDetail;
window.injectIncomingNotification = injectIncomingNotification;
window.clearNotificationInboxCache = clearNotificationInboxCache;

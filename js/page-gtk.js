/* js/page-gtk.js - Master Data GTK & Tenaga Kependidikan (Pure Cloudflare D1 SSOT - Standar 21 Kolom Dapodik & SIMAS) */
import { auth, db, PATHS, SCHOOL_CONFIG, resolvePhotoUrl } from './config.js';
import { initLayout } from './global.js';
import { cfClient } from './cloudflare-client.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
    collection,
    getDocs,
    query,
    where,
    writeBatch,
    doc,
    deleteDoc,
    serverTimestamp,
    setDoc
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

// ==========================================
// 1. SKEMA MASTER DATA GTK (21 KOLOM DAPODIK & SIMAS - NIK DI KOLOM A & TELEGRAM ID DI KOLOM U)
// ==========================================
export const TEACHER_SCHEMA = [
    { index: 0, key: 'nik', label: 'NIK' },
    { index: 1, key: 'name', label: 'Nama' },
    { index: 2, key: 'nuptk', label: 'NUPTK' },
    { index: 3, key: 'gender', label: 'JK' },
    { index: 4, key: 'birth_place', label: 'Tempat Lahir' },
    { index: 5, key: 'birth_date', label: 'Tanggal Lahir' },
    { index: 6, key: 'nip', label: 'NIP' },
    { index: 7, key: 'status_kepegawaian', label: 'Status Kepegawaian' },
    { index: 8, key: 'jenis_ptk', label: 'Jenis PTK' },
    { index: 9, key: 'agama', label: 'Agama' },
    { index: 10, key: 'alamat', label: 'Alamat Jalan' },
    { index: 11, key: 'rt', label: 'RT' },
    { index: 12, key: 'rw', label: 'RW' },
    { index: 13, key: 'dusun', label: 'Nama Dusun' },
    { index: 14, key: 'kelurahan', label: 'Desa/Kelurahan' },
    { index: 15, key: 'kecamatan', label: 'Kecamatan' },
    { index: 16, key: 'kode_pos', label: 'Kode Pos' },
    { index: 17, key: 'phone', label: 'HP' },
    { index: 18, key: 'email', label: 'Email' },
    { index: 19, key: 'tugas_tambahan', label: 'Tugas Tambahan' },
    { index: 20, key: 'telegramChatId', label: 'Telegram ID' }
];

export const GTK_SCHEMA = TEACHER_SCHEMA;

let allTeachers = []; // Cache Data GTK
let pendingDeleteId = null;

// ==========================================
// HELPER: Normalisasi Nama Tanpa Gelar untuk Smart Name Matching
// ==========================================
/**
 * Menghapus gelar akademik/jabatan dari nama agar bisa dicocokkan secara cerdas.
 * Contoh: "Drs. I Komang Sudiana, M.Pd" → "i komang sudiana"
 *         "I Ketut Nuria" → "i ketut nuria"
 *         "Ni Kadek Ari Astuti, S.Pd" → "ni kadek ari astuti"
 */
export function stripGelar(name) {
    if (!name) return '';
    let n = name.trim();

    // 1. Hapus gelar prefix (di depan nama) — Drs., Dr., Prof., Ir., H., Hj.
    n = n.replace(/^(Prof\.?\s*|Drs?\.?\s*|Dr\.?\s*|Ir\.?\s*|Hj?\.?\s+)/gi, '');

    // 2. Hapus gelar suffix (di belakang nama setelah koma atau spasi), mendukung spasi di antara huruf gelar (cth: S. Pd, M. Pd)
    const suffixRegex = /[,\s]+(?:S\.?\s*Pd\.?(?:\s*,?\s*H)?|M\.?\s*Pd\.?(?:\s*,?\s*H)?|S\.?\s*Kom\.?|S\.?\s*H\.?|S\.?\s*Ag\.?|S\.?\s*Ak\.?|S\.?\s*E\.?|SE|S\.?\s*Sos\.?|S\.?\s*IP\.?|S\.?\s*T\.?|S\.?\s*Si\.?|S\.?\s*I\.?\s*Kom\.?|A\.?\s*Md\.?(?:\s*,?\s*Kom\.?)?|Gr\.?|M\.?\s*Si\.?|M\.?\s*M\.?|M\.?\s*Hum\.?|M\.?\s*Kes\.?|M\.?\s*Ed\.?|M\.?\s*T\.?|Ph\.?\s*D\.?|Drs?\.?|Dr\.?|Prof\.?|Ir\.?|H)\b/gi;

    // Ulangi penghapusan jika guru memiliki lebih dari 1 gelar suffix beruntun
    let prev;
    do {
        prev = n;
        n = n.replace(suffixRegex, '');
    } while (n !== prev);

    // 3. Bersihkan sisa koma, titik, dan spasi berlebih di akhir
    n = n.replace(/[,.\s]+$/g, '').replace(/\s{2,}/g, ' ').trim().toLowerCase();

    return n;
}

// --- SESSION CACHE HELPERS ---
const CACHE_KEY_GTK = 'session_gtk_data';

function getSessionCache(key) {
    try {
        return JSON.parse(sessionStorage.getItem(key));
    } catch (e) { return null; }
}

function setSessionCache(key, data) {
    try {
        sessionStorage.setItem(key, JSON.stringify(data));
    } catch (e) { console.warn('[Cache] Error:', e); }
}

function clearGtkCache() {
    sessionStorage.removeItem(CACHE_KEY_GTK);
    sessionStorage.removeItem('session_teachers_data');
    localStorage.removeItem('simas_teachers_cache');
    localStorage.removeItem('simas_guru_list_cache');
    // Invalidasi global GTK cache (IndexedDB, LocalStorage & Memory)
    if (typeof window.invalidateGtkCache === 'function') window.invalidateGtkCache();
    if (typeof window.invalidateTeachersCache === 'function') window.invalidateTeachersCache();
}

// Update metadata timestamp agar halaman lain tahu data GTK berubah
async function updateGtkMetadata() {
    try {
        if (window.cfClient && window.cfClient.enabled) {
            await window.cfClient.saveSystemSetting('metadata', {
                lastUpdateTeachers: Date.now()
            });
        }
    } catch (e) {
        console.warn('[GTK] Gagal update metadata GTK in D1:', e);
    }
}

// --- HELPER: MODERN ALERT ---
function showModernAlert(title, message, type = 'success') {
    const modal = document.getElementById('modal-alert');
    if (!modal) {
        if (typeof window.showToast === 'function') {
            window.showToast(title, message.replace(/<[^>]*>?/gm, ''), type === 'success' ? 'success' : 'error');
        } else {
            alert(`${title}: ${message.replace(/<[^>]*>?/gm, '')}`);
        }
        return;
    }

    const iconBg = document.getElementById('alert-icon-bg');
    const icon = document.getElementById('alert-icon');
    const titleEl = document.getElementById('alert-title');
    const msgEl = document.getElementById('alert-msg');

    if (type === 'success') {
        if (iconBg) iconBg.className = "w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 animate-bounce-slow";
        if (icon) icon.className = "fa-solid fa-check text-3xl";
    } else {
        if (iconBg) iconBg.className = "w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 animate-pulse";
        if (icon) icon.className = "fa-solid fa-xmark text-3xl";
    }

    if (titleEl) titleEl.innerText = title;
    if (msgEl) msgEl.innerHTML = message;
    modal.classList.remove('hidden');
}

// Format Tanggal Indonesia
export function formatIndoDate(dateStr) {
    if (!dateStr || dateStr === '-') return '-';
    // Format YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
        const parts = dateStr.split('-');
        const y = parts[0];
        const m = parseInt(parts[1], 10);
        const d = parts[2].substring(0, 2);
        const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
        if (m >= 1 && m <= 12) return `${parseInt(d, 10)} ${months[m - 1]} ${y}`;
    }
    // Format YYYYMMDD dari NIP
    if (dateStr.length >= 8 && !isNaN(dateStr.substring(0, 8))) {
        const y = dateStr.substring(0, 4);
        const m = parseInt(dateStr.substring(4, 6), 10);
        const d = dateStr.substring(6, 8);
        const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
        if (m >= 1 && m <= 12) return `${parseInt(d, 10)} ${months[m - 1]} ${y}`;
    }
    return dateStr;
}

if (typeof window !== 'undefined') {
    window.formatIndoDate = formatIndoDate;
}

onAuthStateChanged(auth, (user) => {
    if (!user) {
        window.location.href = 'index.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
        return;
    }

    const role = localStorage.getItem('user_role');

    // Setup UI berdasarkan Role
    const effectiveRole = window.getEffectiveRoleForPage ?
        (window.getEffectiveRoleForPage('gtk.html') || window.getEffectiveRoleForPage('guru.html')) : role;

    const hasWriteAccess = window.hasRole ?
        (window.hasRole('super_admin') || window.hasRole('kesiswaan') || window.hasRole('humas') || window.hasRole('sarpras') || window.hasRole('staff') || window.hasRole('wakasek_kurikulum')) :
        ['super_admin', 'kesiswaan', 'humas', 'sarpras', 'staff', 'wakasek_kurikulum'].includes(role);

    if (!hasWriteAccess && ['kepala_sekolah', 'wali_kelas', 'guru_mapel'].includes(effectiveRole)) {
        document.body.classList.add('readonly-mode');
    }

    // Button Access Control (Whitelist RBAC)
    const canImport = window.hasRole ?
        (window.hasRole('super_admin') || window.hasRole('kesiswaan') || window.hasRole('humas') || window.hasRole('sarpras') || window.hasRole('staff')) :
        ['super_admin', 'kesiswaan', 'humas', 'sarpras', 'staff'].includes(role);
    const btnImport = document.getElementById('btn-import-teacher');
    if (btnImport) {
        if (!canImport) btnImport.classList.add('hidden');
        else btnImport.classList.remove('hidden');
    }

    const canAdd = window.hasRole ?
        (window.hasRole('super_admin') || window.hasRole('kesiswaan') || window.hasRole('humas') || window.hasRole('sarpras') || window.hasRole('staff') || window.hasRole('wakasek_kurikulum')) :
        ['super_admin', 'kesiswaan', 'humas', 'sarpras', 'staff', 'wakasek_kurikulum'].includes(role);
    const btnAdd = document.getElementById('btn-add-teacher');
    if (btnAdd) {
        if (!canAdd) btnAdd.classList.add('hidden');
        else btnAdd.classList.remove('hidden');
    }

    const canApproveSubmissions = window.hasRole ?
        (window.hasRole('super_admin') || window.hasRole('wakasek_kurikulum') || window.hasRole('staff') || window.hasRole('admin')) :
        ['super_admin', 'wakasek_kurikulum', 'staff', 'admin'].includes(role);
    const btnSubmissions = document.getElementById('btn-submissions');
    if (btnSubmissions) {
        if (!canApproveSubmissions) {
            btnSubmissions.classList.add('hidden');
        } else {
            btnSubmissions.classList.remove('hidden');
            loadSubmissionsCount();
        }
    }

    initLayout(effectiveRole);
    document.querySelector('main')?.classList.remove('hidden');

    // Render link bot Telegram dinamis dari SSOT
    const botUser = (SCHOOL_CONFIG && SCHOOL_CONFIG.telegramBotUser) ? SCHOOL_CONFIG.telegramBotUser : "simas_demo_bot";
    document.querySelectorAll('.link-telegram-bot').forEach(el => {
        el.href = `https://t.me/${botUser}`;
        el.innerHTML = `<i class="fa-brands fa-telegram text-sky-500"></i> Buka @${botUser}`;
    });
    document.querySelectorAll('.text-telegram-bot-hint').forEach(el => {
        el.innerHTML = `Dapatkan notifikasi personal via Bot Telegram. Buka <a href="https://t.me/${botUser}" target="_blank" rel="noopener noreferrer" class="text-blue-500 underline font-semibold">@${botUser}</a> untuk mendapatkan Chat ID Anda. (Opsional / Boleh dikosongkan jika belum ada Telegram, GTK tetap dapat mengisinya nanti via pop-up login).`;
    });

    loadGtk();
    setupEventListeners();
    setupImportLogic();
});

// --- LOAD DATA GTK (CLOUDFLARE D1 SSOT WITH LAYERED CACHING) ---
async function loadGtk(forceRefresh = false) {
    const tbody = document.getElementById('teacher-table-body');
    const role = localStorage.getItem('user_role');
    const canDelete = window.hasRole ?
        (window.hasRole('super_admin') || window.hasRole('kesiswaan') || window.hasRole('humas') || window.hasRole('sarpras') || window.hasRole('staff')) :
        ['super_admin', 'kesiswaan', 'humas', 'sarpras', 'staff'].includes(role);
    const canEdit = window.hasRole ?
        (window.hasRole('super_admin') || window.hasRole('kesiswaan') || window.hasRole('humas') || window.hasRole('sarpras') || window.hasRole('staff') || window.hasRole('wakasek_kurikulum')) :
        ['super_admin', 'kesiswaan', 'humas', 'sarpras', 'staff', 'wakasek_kurikulum'].includes(role);
    const colSpanCount = (canEdit || canDelete) ? 6 : 5;

    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="${colSpanCount}" class="p-8 text-center text-slate-400 dark:text-slate-500"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Memuat data GTK...</td></tr>`;
    }

    try {
        if (!forceRefresh) {
            const cached = getSessionCache(CACHE_KEY_GTK);
            if (cached && Array.isArray(cached) && cached.length > 0) {
                console.log('[GTK] Menggunakan session cache data GTK');
                allTeachers = cached;
                renderTable(allTeachers);
                const countEl = document.getElementById('data-count');
                if (countEl) countEl.innerText = `Total: ${allTeachers.length} Data GTK`;
                return;
            }
        }

        if (typeof cfClient !== 'undefined' && cfClient.getGtk) {
            allTeachers = await cfClient.getGtk({ status: 'all' });
        } else if (typeof window.getGtkCache === 'function') {
            allTeachers = await window.getGtkCache(forceRefresh);
        } else if (typeof window.getTeachersCache === 'function') {
            allTeachers = await window.getTeachersCache(forceRefresh);
        } else {
            allTeachers = [];
        }

        // Simpan ke session cache
        setSessionCache(CACHE_KEY_GTK, allTeachers);
        renderTable(allTeachers);

        const countEl = document.getElementById('data-count');
        if (countEl) countEl.innerText = `Total: ${allTeachers.length} Data GTK`;

    } catch (e) {
        console.error('[GTK] Gagal memuat data GTK:', e);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="${colSpanCount}" class="p-8 text-center text-red-500 font-semibold">Gagal memuat data GTK. Silakan segarkan halaman.</td></tr>`;
        }
    }
}

function renderTable(data) {
    const tbody = document.getElementById('teacher-table-body');
    if (!tbody) return;

    const role = localStorage.getItem('user_role');

    const canDelete = window.hasRole ?
        (window.hasRole('super_admin') || window.hasRole('kesiswaan') || window.hasRole('humas') || window.hasRole('sarpras') || window.hasRole('staff')) :
        ['super_admin', 'kesiswaan', 'humas', 'sarpras', 'staff'].includes(role);

    const canEdit = window.hasRole ?
        (window.hasRole('super_admin') || window.hasRole('kesiswaan') || window.hasRole('humas') || window.hasRole('sarpras') || window.hasRole('staff') || window.hasRole('wakasek_kurikulum')) :
        ['super_admin', 'kesiswaan', 'humas', 'sarpras', 'staff', 'wakasek_kurikulum'].includes(role);

    const hasAksi = canEdit || canDelete;
    const colSpanCount = hasAksi ? 6 : 5;

    const thAksi = document.getElementById('th-aksi');
    if (thAksi) {
        if (hasAksi) thAksi.classList.remove('hidden');
        else thAksi.classList.add('hidden');
    }

    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${colSpanCount}" class="p-8 text-center text-slate-400 italic">Belum ada data GTK yang cocok.</td></tr>`;
        return;
    }

    let html = '';
    data.forEach((t, index) => {
        const avatarInitial = (t.name || '?').charAt(0).toUpperCase();
        const primaryId = t.id || t.nip || t.nik || t.nuptk || `idx_${index}`;
        const escapedId = window.escapeHTML ? window.escapeHTML(primaryId) : primaryId;

        // Identitas Dokumen (NIP, NIK & NUPTK)
        const nipVal = t.nip && t.nip !== '-' ? t.nip : '';
        const nikVal = t.nik && t.nik !== '-' ? t.nik : '';
        const nuptkVal = t.nuptk && t.nuptk !== '-' ? t.nuptk : '';
        let idBadges = '';
        if (nipVal) {
            idBadges += `<div class="font-mono text-slate-700 dark:text-slate-300 font-semibold"><span class="text-[10px] text-slate-400 font-normal">NIP:</span> ${window.escapeHTML ? window.escapeHTML(nipVal) : nipVal}</div>`;
        }
        if (nikVal) {
            idBadges += `<div class="font-mono text-slate-500 dark:text-slate-400 text-[11px]"><span class="text-[10px] text-slate-400 font-normal">NIK:</span> ${window.escapeHTML ? window.escapeHTML(nikVal) : nikVal}</div>`;
        }
        if (nuptkVal) {
            idBadges += `<div class="font-mono text-indigo-600 dark:text-indigo-400 text-[11px]"><span class="text-[10px] text-slate-400 font-normal">NUPTK:</span> ${window.escapeHTML ? window.escapeHTML(nuptkVal) : nuptkVal}</div>`;
        }
        if (!idBadges) {
            idBadges = `<span class="text-slate-400 italic text-[11px]">Non-NIP/NIK</span>`;
        }

        // Status Kepegawaian & Jenis PTK
        const statusVal = t.status_kepegawaian || t.status || 'Honorer';
        const jenisPtkVal = t.jenis_ptk || t.jabatan || 'Pendidik';

        // Kontak Phone & WA
        const rawPhone = t.phone || t.no_wa || t.hp || '';
        let contactHtml = '-';
        if (rawPhone) {
            const cleanPhone = String(rawPhone).replace(/[^0-9]/g, '');
            const waPhone = cleanPhone.startsWith('0') ? '62' + cleanPhone.substring(1) : cleanPhone;
            contactHtml = `
                <a href="https://wa.me/${waPhone}" target="_blank" rel="noopener noreferrer" 
                    class="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 font-semibold transition-colors">
                    <i class="fa-brands fa-whatsapp text-sm"></i>
                    <span>${window.escapeHTML ? window.escapeHTML(rawPhone) : rawPhone}</span>
                </a>`;
        }

        // Tombol Aksi
        let actionTd = '';
        if (hasAksi) {
            actionTd = `
            <td class="px-3 py-3 text-center whitespace-nowrap">
                <div class="flex justify-center items-center gap-1.5">
                    <button onclick="window.openTeacherDetail('${escapedId}')" 
                        class="p-1.5 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-lg transition-colors" title="Lihat Biodata Lengkap">
                        <i class="fa-solid fa-eye"></i>
                    </button>
                    ${canEdit ? `
                    <button onclick="window.editTeacher('${escapedId}')" 
                        class="p-1.5 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/30 rounded-lg transition-colors" title="Edit Data GTK">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>` : ''}
                    ${canDelete ? `
                    <button onclick="window.deleteTeacher('${escapedId}')" 
                        class="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors" title="Hapus GTK">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>` : ''}
                </div>
            </td>`;
        }

        html += `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
            <td class="px-3 py-3 text-center text-slate-400 font-mono">${index + 1}</td>
            <td class="px-4 py-3">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 font-bold flex items-center justify-center text-xs shrink-0 overflow-hidden" data-vip-ptk-id="${window.escapeHTML ? window.escapeHTML(String(t.id || '')) : (t.id || '')}" data-vip-size="vip-avatar-sm">
                        ${(t.foto || t.photo_url) ? `<img src="${resolvePhotoUrl(t.foto || t.photo_url)}" alt="${window.escapeHTML ? window.escapeHTML(t.name) : t.name}" class="w-full h-full object-cover rounded-full" onerror="this.remove()">` : avatarInitial}
                    </div>
                    <div>
                        <div class="font-bold text-slate-800 dark:text-white">${window.escapeHTML ? window.escapeHTML(t.name) : t.name}</div>
                        <div class="text-[11px] text-slate-400 dark:text-slate-500">${t.gender === 'P' ? 'Perempuan' : 'Laki-laki'}</div>
                    </div>
                </div>
            </td>
            <td class="px-4 py-3">${idBadges}</td>
            <td class="px-4 py-3">
                <span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/50 mb-1">
                    ${window.escapeHTML ? window.escapeHTML(jenisPtkVal) : jenisPtkVal}
                </span>
                <div class="text-[11px] text-slate-500 dark:text-slate-400">${window.escapeHTML ? window.escapeHTML(statusVal) : statusVal}</div>
            </td>
            <td class="px-4 py-3">
                <div class="space-y-0.5">
                    <div>${contactHtml}</div>
                    ${t.email ? `<div class="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[150px]"><i class="fa-solid fa-envelope text-[10px] mr-1 text-slate-400"></i>${window.escapeHTML ? window.escapeHTML(t.email) : t.email}</div>` : ''}
                </div>
            </td>
            ${actionTd}
        </tr>`;
    });

    tbody.innerHTML = html;
}

// ==========================================
// 2. MODAL DETAIL BIODATA GTK
// ==========================================
window.openTeacherDetail = (id) => {
    const t = allTeachers.find(x => x.id === id || x.nip === id || x.nik === id || x.nuptk === id);
    if (!t) return;

    const modal = document.getElementById('modal-detail');
    if (!modal) return;

    const avatar = document.getElementById('detail-avatar');
    const nameEl = document.getElementById('detail-name');
    const statusEl = document.getElementById('detail-status');
    const jenisPtkEl = document.getElementById('detail-jenis-ptk');
    const profileGrid = document.getElementById('detail-profile-grid');
    const linkWa = document.getElementById('detail-link-wa');
    const linkEmail = document.getElementById('detail-link-email');

    if (avatar) {
        if (t.foto || t.photo_url) {
            avatar.innerHTML = `<img src="${resolvePhotoUrl(t.foto || t.photo_url)}" alt="${window.escapeHTML ? window.escapeHTML(t.name) : t.name}" class="w-full h-full object-cover rounded-full" onerror="this.parentElement.innerText='${(t.name || '?').charAt(0).toUpperCase()}';">`;
        } else {
            avatar.innerText = (t.name || '?').charAt(0).toUpperCase();
        }
        if (typeof window.applyVipBadgeToAvatarContainer === 'function' && typeof window.isPtkVip === 'function') {
            window.applyVipBadgeToAvatarContainer(avatar, window.isPtkVip(t.id), 'vip-avatar-lg');
        }
    }
    if (nameEl) nameEl.innerText = t.name || '-';
    if (statusEl) statusEl.innerText = t.status_kepegawaian || t.status || 'Honorer';
    if (jenisPtkEl) jenisPtkEl.innerText = t.jenis_ptk || t.jabatan || 'Pendidik';

    const escape = (str) => (window.escapeHTML ? window.escapeHTML(str) : (str || '-'));

    // Susun Informasi Detail dalam Section Card
    if (profileGrid) {
        profileGrid.innerHTML = `
        <!-- Identitas Utama -->
        <div class="bg-slate-50 dark:bg-slate-900/50 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700">
            <h4 class="font-bold text-indigo-600 dark:text-indigo-400 uppercase text-[11px] mb-2.5 flex items-center gap-1.5 border-b pb-1">
                <i class="fa-solid fa-id-card"></i> Identitas & Dokumen
            </h4>
            <div class="space-y-1.5 font-mono text-[11px]">
                <div><span class="text-slate-400 font-sans font-normal">NIK:</span> <b class="text-slate-800 dark:text-slate-200">${escape(t.nik)}</b></div>
                <div><span class="text-slate-400 font-sans font-normal">NIP:</span> <b class="text-slate-800 dark:text-slate-200">${escape(t.nip)}</b></div>
                <div><span class="text-slate-400 font-sans font-normal">NUPTK:</span> <b class="text-indigo-600 dark:text-indigo-400">${escape(t.nuptk)}</b></div>
                <div><span class="text-slate-400 font-sans font-normal">JK:</span> <b class="text-slate-800 dark:text-slate-200">${t.gender === 'P' ? 'Perempuan (P)' : 'Laki-laki (L)'}</b></div>
                <div><span class="text-slate-400 font-sans font-normal">Agama:</span> <b class="text-slate-800 dark:text-slate-200">${escape(t.agama)}</b></div>
                <div><span class="text-slate-400 font-sans font-normal">TTL:</span> <b class="text-slate-800 dark:text-slate-200">${escape(t.birth_place || t.birthPlace || t.tempat_lahir)}, ${formatIndoDate(t.birth_date || t.birthDate || t.tanggal_lahir)}</b></div>
            </div>
        </div>

        <!-- Kepegawaian -->
        <div class="bg-slate-50 dark:bg-slate-900/50 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700">
            <h4 class="font-bold text-amber-600 dark:text-amber-400 uppercase text-[11px] mb-2.5 flex items-center gap-1.5 border-b pb-1">
                <i class="fa-solid fa-briefcase"></i> Penugasan & Jabatan
            </h4>
            <div class="space-y-1.5 text-[11px]">
                <div><span class="text-slate-400">Jenis PTK:</span> <b class="text-slate-800 dark:text-slate-200">${escape(t.jenis_ptk || t.jabatan)}</b></div>
                <div><span class="text-slate-400">Status Kepegawaian:</span> <b class="text-slate-800 dark:text-slate-200">${escape(t.status_kepegawaian || t.status)}</b></div>
                <div><span class="text-slate-400">Tugas Tambahan:</span> <b class="text-indigo-600 dark:text-indigo-400">${escape(t.tugas_tambahan || '-')}</b></div>
                <div><span class="text-slate-400">Mapel Diampu:</span> <b class="text-slate-800 dark:text-slate-200">${escape(t.mapel || '-')}</b></div>
            </div>
        </div>

        <!-- Alamat & Domisili -->
        <div class="bg-slate-50 dark:bg-slate-900/50 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700">
            <h4 class="font-bold text-emerald-600 dark:text-emerald-400 uppercase text-[11px] mb-2.5 flex items-center gap-1.5 border-b pb-1">
                <i class="fa-solid fa-location-dot"></i> Alamat Domisili
            </h4>
            <div class="space-y-1 text-[11px]">
                <div><b class="text-slate-800 dark:text-slate-200">${escape(t.alamat || t.address)}</b></div>
                <div><span class="text-slate-400">RT/RW:</span> ${escape(t.rt)} / ${escape(t.rw)}</div>
                <div><span class="text-slate-400">Dusun:</span> ${escape(t.dusun)}</div>
                <div><span class="text-slate-400">Desa/Kel:</span> ${escape(t.kelurahan || t.desa)}</div>
                <div><span class="text-slate-400">Kecamatan:</span> ${escape(t.kecamatan)}</div>
                <div><span class="text-slate-400">Kode Pos:</span> <span class="font-mono">${escape(t.kode_pos)}</span></div>
            </div>
        </div>

        <!-- Kontak & Telegram -->
        <div class="bg-slate-50 dark:bg-slate-900/50 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 md:col-span-2 lg:col-span-3">
            <h4 class="font-bold text-sky-600 dark:text-sky-400 uppercase text-[11px] mb-2.5 flex items-center gap-1.5 border-b pb-1">
                <i class="fa-solid fa-phone"></i> Kontak & Notifikasi SIMAS
            </h4>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px]">
                <div><span class="text-slate-400">No. HP / WA:</span> <b class="font-mono text-emerald-600 dark:text-emerald-400">${escape(t.phone || t.no_wa || t.hp)}</b></div>
                <div><span class="text-slate-400">Email:</span> <b class="text-blue-600 dark:text-blue-400">${escape(t.email)}</b></div>
                <div><span class="text-slate-400">Telegram Chat ID:</span> <b class="font-mono text-sky-600 dark:text-sky-400">${escape(t.telegram_chat_id || t.telegramChatId)}</b></div>
            </div>
        </div>`;
    }

    if (linkWa) {
        const rawPhone = t.phone || t.no_wa || t.hp || '';
        if (rawPhone) {
            const cleanPhone = String(rawPhone).replace(/[^0-9]/g, '');
            const waPhone = cleanPhone.startsWith('0') ? '62' + cleanPhone.substring(1) : cleanPhone;
            linkWa.href = `https://wa.me/${waPhone}`;
            linkWa.classList.remove('hidden');
            linkWa.classList.add('inline-flex');
        } else {
            linkWa.classList.add('hidden');
            linkWa.classList.remove('inline-flex');
        }
    }

    if (linkEmail) {
        if (t.email) {
            linkEmail.href = `mailto:${t.email}`;
            linkEmail.classList.remove('hidden');
            linkEmail.classList.add('inline-flex');
        } else {
            linkEmail.classList.add('hidden');
            linkEmail.classList.remove('inline-flex');
        }
    }

    modal.classList.remove('hidden');
};

// ==========================================
// 3. MODAL EDIT GTK
// ==========================================
window.editTeacher = (id) => {
    const t = allTeachers.find(x => x.id === id || x.nip === id || x.nik === id || x.nuptk === id);
    if (!t) return;

    const modal = document.getElementById('modal-edit');
    if (!modal) return;

    // Populate all fields
    const setVal = (elId, val) => {
        const el = document.getElementById(elId);
        if (el) el.value = val || '';
    };

    setVal('edit-id', t.id || t.nip || t.nik || t.nuptk);
    setVal('edit-name', t.name);
    setVal('edit-gender', t.gender || 'L');
    setVal('edit-nik', t.nik);
    setVal('edit-nuptk', t.nuptk);
    setVal('edit-nip', t.nip);
    setVal('edit-agama', t.agama || 'Hindu');
    setVal('edit-birth_place', t.birth_place || t.birthPlace || t.tempat_lahir);
    setVal('edit-birth_date', t.birth_date || t.birthDate || t.tanggal_lahir);
    setVal('edit-status_kepegawaian', t.status_kepegawaian || t.status || '');
    setVal('edit-jenis_ptk', t.jenis_ptk || t.jabatan || '');
    setVal('edit-tugas_tambahan', t.tugas_tambahan || t.jabatan || '');
    setVal('edit-alamat', t.alamat || t.address || '');
    setVal('edit-rt', t.rt || '');
    setVal('edit-rw', t.rw || '');
    setVal('edit-dusun', t.dusun || '');
    setVal('edit-kelurahan', t.kelurahan || t.desa || '');
    setVal('edit-kecamatan', t.kecamatan || '');
    setVal('edit-kode_pos', t.kode_pos || '');
    setVal('edit-phone', t.phone || t.no_wa || t.hp || '');
    setVal('edit-email', t.email || '');
    setVal('edit-telegram', t.telegram_chat_id || t.telegramChatId || '');

    // KONTROL FOTO PROFIL GTK: HANYA Super Admin yang berhak edit/unggah foto di halaman GTK
    const isSuperAdmin = window.hasRole ? window.hasRole('super_admin') : (localStorage.getItem('user_role') === 'super_admin');
    const photoSection = document.getElementById('gtk-photo-edit-section');
    window._gtkEditPendingPhotoBase64 = null;
    window._gtkEditPendingPhotoDelete = false;

    if (photoSection) {
        if (isSuperAdmin) {
            photoSection.classList.remove('hidden');
            const photoPlaceholder = document.getElementById('gtk-edit-photo-placeholder');
            const photoImg = document.getElementById('gtk-edit-photo-img');
            const btnDeletePhoto = document.getElementById('btn-delete-edit-gtk-photo');
            const photoStatus = document.getElementById('gtk-edit-photo-status');
            const fileInput = document.getElementById('input-edit-gtk-photo');
            if (fileInput) fileInput.value = '';
            if (photoStatus) { photoStatus.innerText = ''; photoStatus.className = 'text-[10px] text-slate-500 mt-1'; }

            const currentPhoto = resolvePhotoUrl(t.foto || t.photo_url || '');
            if (currentPhoto) {
                if (photoImg) { photoImg.src = currentPhoto; photoImg.classList.remove('hidden'); }
                if (photoPlaceholder) photoPlaceholder.classList.add('hidden');
                if (btnDeletePhoto) btnDeletePhoto.classList.remove('hidden');
            } else {
                if (photoImg) { photoImg.src = ''; photoImg.classList.add('hidden'); }
                if (photoPlaceholder) {
                    photoPlaceholder.innerText = (t.name || '?').charAt(0).toUpperCase();
                    photoPlaceholder.classList.remove('hidden');
                }
                if (btnDeletePhoto) btnDeletePhoto.classList.add('hidden');
            }
        } else {
            photoSection.classList.add('hidden');
        }
    }

    modal.classList.remove('hidden');
};

// ==========================================
// 4. HAPUS GTK (PURE CLOUDFLARE D1 SSOT)
// ==========================================
window.deleteTeacher = function (id) {
    pendingDeleteId = id;

    const modal = document.getElementById('modal-confirm');
    const icon = document.getElementById('confirm-icon');
    const title = document.getElementById('confirm-title');
    const desc = document.getElementById('confirm-desc');
    const btnAction = document.getElementById('btn-confirm-action');

    if (icon) {
        icon.innerHTML = '<i class="fa-solid fa-trash text-3xl text-red-500 dark:text-red-400"></i>';
        icon.className = 'w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-red-100 dark:bg-red-900/30';
    }
    if (title) title.innerText = 'Hapus Data GTK?';
    if (desc) desc.innerText = 'Data GTK yang dihapus akan terhapus secara permanen dari basis data SIMAS.';
    if (btnAction) {
        btnAction.className = 'px-5 py-2.5 rounded-lg font-bold text-white bg-red-600 hover:bg-red-700 shadow-lg transition-transform active:scale-95';
        btnAction.innerText = 'Ya, Hapus';
        btnAction.onclick = executeDeleteTeacher;
    }

    if (modal) modal.classList.remove('hidden');
};

async function executeDeleteTeacher() {
    if (!pendingDeleteId) return;

    const modal = document.getElementById('modal-confirm');
    const btnAction = document.getElementById('btn-confirm-action');
    if (btnAction) {
        btnAction.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Menghapus...';
        btnAction.disabled = true;
    }

    try {
        const oldData = allTeachers.find(t => t.id === pendingDeleteId || t.nip === pendingDeleteId || t.nik === pendingDeleteId || t.nuptk === pendingDeleteId);
        
        if (typeof cfClient !== 'undefined' && cfClient.deleteGtk) {
            await cfClient.deleteGtk(pendingDeleteId);
        } else if (typeof cfClient !== 'undefined' && cfClient.deleteTeacher) {
            await cfClient.deleteTeacher(pendingDeleteId);
        }

        if (typeof window.logAudit === 'function') {
            window.logAudit('DELETE_GTK', pendingDeleteId, oldData, null, `Menghapus data GTK: ${oldData ? oldData.name : pendingDeleteId}`);
        }

        if (modal) modal.classList.add('hidden');
        clearGtkCache();
        updateGtkMetadata();
        loadGtk(true);
        showModernAlert("Terhapus", "Data GTK berhasil dihapus.");
    } catch (e) {
        showModernAlert("Error", e.message || "Gagal menghapus data GTK.", 'error');
    } finally {
        if (btnAction) {
            btnAction.disabled = false;
            btnAction.innerHTML = 'Ya, Hapus';
        }
        pendingDeleteId = null;
    }
}

// ==========================================
// 5. SMART IMPORT EXCEL (21 KOLOM DAPODIK & SIMAS - NIK DI KOLOM A & TELEGRAM ID DI KOLOM U)
// ==========================================
export function parseTeacherImportRow(row, offset = 0) {
    if (!row || !row.trim()) return null;
    const cols = row.split('\t').map(c => (c !== undefined ? c.trim() : ''));
    if (cols.length < 2) return null;

    // Deteksi offset jika diawali kolom "No" (angka pendek murni 1..999)
    let colOffset = offset;
    const firstCol = cols[0];
    const secondCol = cols[1];

    if (/^\d{1,4}$/.test(firstCol) && (secondCol.length >= 10 || isNaN(Number(secondCol)))) {
        colOffset = 1;
    }

    const rawNik = cols[0 + colOffset] || '';
    const rawName = cols[1 + colOffset] || '';

    // Abaikan baris header
    if (
        rawNik.toLowerCase() === 'nik' ||
        rawName.toLowerCase() === 'nama' ||
        rawName.toLowerCase() === 'nama lengkap' ||
        cols.some(c => c.toLowerCase() === 'nuptk' || c.toLowerCase() === 'status kepegawaian' || c.toLowerCase() === 'telegram id')
    ) {
        return null;
    }

    // Pastikan ada minimal salah satu identifier (NIK, Nama, NUPTK, NIP, atau Telegram ID)
    const rawNuptk = cols[2 + colOffset] || '';
    const rawNip = cols[6 + colOffset] || '';
    const rawTelegram = cols[20 + colOffset] || '';
    if (!rawNik && !rawName && !rawNuptk && !rawNip && !rawTelegram) {
        return null; // Abaikan baris kosong tanpa pengenal
    }

    const rawGender = cols[3 + colOffset] || '';
    const cleanGender = rawGender.toUpperCase().startsWith('P') ? 'P' : (rawGender.toUpperCase().startsWith('L') ? 'L' : '');

    return {
        nik: rawNik,
        name: rawName,
        nuptk: rawNuptk,
        gender: cleanGender,
        birth_place: cols[4 + colOffset] || '',
        birth_date: cols[5 + colOffset] || '',
        nip: rawNip,
        status_kepegawaian: cols[7 + colOffset] || '',
        jenis_ptk: cols[8 + colOffset] || '',
        agama: cols[9 + colOffset] || '',
        alamat: cols[10 + colOffset] || '',
        rt: cols[11 + colOffset] || '',
        rw: cols[12 + colOffset] || '',
        dusun: cols[13 + colOffset] || '',
        kelurahan: cols[14 + colOffset] || '',
        kecamatan: cols[15 + colOffset] || '',
        kode_pos: cols[16 + colOffset] || '',
        phone: cols[17 + colOffset] || '',
        email: cols[18 + colOffset] || '',
        tugas_tambahan: cols[19 + colOffset] || '',
        telegramChatId: rawTelegram,
        telegram_chat_id: rawTelegram,
        // Backward compatibility alias fields
        birthDate: cols[5 + colOffset] || '',
        jabatan: cols[19 + colOffset] || cols[8 + colOffset] || '',
        status: 'active'
    };
}

if (typeof window !== 'undefined') {
    window.parseTeacherImportRow = parseTeacherImportRow;
    window.parseGtkImportRow = parseTeacherImportRow;
}

// ==========================================
// HELPER: Render Sel Pratinjau dengan Diff Perubahan Data
// ==========================================
export function renderDiffCell(newVal, oldVal, { isMono = false, isBold = false, extraClasses = '', truncate = false } = {}) {
    const escape = (str) => (typeof window !== 'undefined' && window.escapeHTML ? window.escapeHTML(str) : (str || ''));
    const valNew = newVal !== undefined && newVal !== null ? String(newVal).trim() : '';
    const valOld = oldVal !== undefined && oldVal !== null ? String(oldVal).trim() : '';

    // Kasus 1: Nilai baru di Excel KOSONG (tidak diisi di Excel)
    if (!valNew) {
        if (!valOld || valOld === '-') {
            return `<span class="text-slate-400 dark:text-slate-600">-</span>`;
        }
        // Data lama dipertahankan
        return `<span class="${isMono ? 'font-mono' : ''} text-slate-500 dark:text-slate-400 ${extraClasses} ${truncate ? 'truncate max-w-xs inline-block' : ''}" title="${escape(valOld)}">${escape(valOld)}</span>`;
    }

    // Kasus 2: Nilai baru di Excel TERISI
    const isOldEmpty = !valOld || valOld === '-';
    const isDifferent = isOldEmpty ? true : (valNew.toLowerCase() !== valOld.toLowerCase());

    if (!isDifferent) {
        // Data sama persis (tidak ada perubahan)
        return `<span class="${isMono ? 'font-mono' : ''} ${isBold ? 'font-bold' : ''} text-slate-700 dark:text-slate-300 ${extraClasses} ${truncate ? 'truncate max-w-xs inline-block' : ''}" title="${escape(valNew)}">${escape(valNew)}</span>`;
    }

    // Kasus 3: Data baru diisi pertama kali (sebelumnya kosong di database)
    if (isOldEmpty) {
        return `
        <div class="inline-flex flex-col text-left">
            <span class="${isMono ? 'font-mono' : ''} font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800 ${extraClasses} ${truncate ? 'truncate max-w-xs inline-block' : ''}" title="Baru Diisi: ${escape(valNew)}">
                ${escape(valNew)}
            </span>
            <span class="text-[9px] text-emerald-600 dark:text-emerald-400 font-sans font-semibold mt-0.5"><i class="fa-solid fa-plus text-[8px]"></i> Baru diisi</span>
        </div>`;
    }

    // Kasus 4: Data BERBEDA / BERUBAH (nilai lama ditimpa oleh nilai baru dari Excel)
    return `
    <div class="inline-flex flex-col text-left">
        <span class="${isMono ? 'font-mono' : ''} font-bold text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-900/60 px-1.5 py-0.5 rounded border border-amber-300 dark:border-amber-700 shadow-sm ${extraClasses} ${truncate ? 'truncate max-w-xs inline-block' : ''}" title="Nilai Baru: ${escape(valNew)}">
            ${escape(valNew)}
        </span>
        <span class="text-[9px] text-slate-400 dark:text-slate-500 line-through ${isMono ? 'font-mono' : ''} mt-0.5 ${truncate ? 'truncate max-w-xs inline-block' : ''}" title="Nilai Lama: ${escape(valOld)}">
            ${escape(valOld)}
        </span>
    </div>`;
}

function setupImportLogic() {
    const btnPreview = document.getElementById('btn-preview');
    const btnSave = document.getElementById('btn-save-import');
    const pasteArea = document.getElementById('import-paste-area');
    const previewContainer = document.getElementById('preview-container');
    const previewBody = document.getElementById('preview-body');
    const previewDiffSummary = document.getElementById('preview-diff-summary');
    const summaryText = document.getElementById('import-summary-text');

    if (!btnPreview || !btnSave || !pasteArea) return;

    let tempImportData = [];

    // 1. Preview Handler (Dengan Smart Diffing & Visual Indicators)
    btnPreview.addEventListener('click', () => {
        const rawText = pasteArea.value.trim();
        if (!rawText) return;

        const preserveNames = document.getElementById('chk-preserve-names')?.checked ?? true;
        const preserveContacts = document.getElementById('chk-preserve-contacts')?.checked ?? true;
        const rows = rawText.split('\n');
        tempImportData = [];
        let html = '';

        let totalNewGTK = 0;
        let totalUpdatedGTK = 0;
        let totalUnchangedGTK = 0;
        let totalInvalidGTK = 0;
        let totalFieldUpdates = 0;
        let totalNewFields = 0;

        const escape = (str) => (window.escapeHTML ? window.escapeHTML(str) : (str || ''));

        rows.forEach(row => {
            const rowData = parseTeacherImportRow(row);
            if (!rowData) return;

            tempImportData.push(rowData);

            // Cek apakah data ini cocok dengan GTK yang sudah ada di database (Prioritas 1: NIK)
            let matchedTeacher = null;
            if (rowData.nik && rowData.nik !== '-' && rowData.nik !== '') {
                matchedTeacher = allTeachers.find(t => t.nik === rowData.nik);
            }
            if (!matchedTeacher && rowData.nip && rowData.nip !== '-' && rowData.nip !== '') {
                matchedTeacher = allTeachers.find(t => t.nip === rowData.nip);
            }
            if (!matchedTeacher && rowData.nuptk && rowData.nuptk !== '-' && rowData.nuptk !== '') {
                matchedTeacher = allTeachers.find(t => t.nuptk === rowData.nuptk);
            }
            // Match 4a: Nama Lengkap Persis (case-insensitive)
            if (!matchedTeacher && rowData.name) {
                matchedTeacher = allTeachers.find(t => t.name && t.name.trim().toLowerCase() === rowData.name.trim().toLowerCase());
            }
            // Match 4b: Nama Pokok Tanpa Gelar (fallback jika nama persis tidak cocok)
            if (!matchedTeacher && rowData.name) {
                const importNameStripped = stripGelar(rowData.name);
                if (importNameStripped.length >= 3) {
                    matchedTeacher = allTeachers.find(t => t.name && stripGelar(t.name) === importNameStripped);
                }
            }
            // Match 4c: Email matching fallback (jika email terisi dan valid)
            if (!matchedTeacher && rowData.email && rowData.email.includes('@')) {
                const targetEmail = rowData.email.trim().toLowerCase();
                matchedTeacher = allTeachers.find(t => t.email && t.email.trim().toLowerCase() === targetEmail);
            }

            // Hitung statistik perubahan field untuk baris ini
            const GTK_SCHEMA_KEYS = [
                'nik', 'name', 'nuptk', 'gender', 'birth_place', 'birth_date', 'nip',
                'status_kepegawaian', 'jenis_ptk', 'agama', 'alamat', 'rt', 'rw', 'dusun',
                'kelurahan', 'kecamatan', 'kode_pos', 'phone', 'email', 'tugas_tambahan', 'telegramChatId'
            ];

            let changedCount = 0;
            let newlyFilledCount = 0;

            if (matchedTeacher) {
                GTK_SCHEMA_KEYS.forEach(key => {
                    // Jika opsi pertahankan nama aktif dan guru sudah memiliki nama, abaikan perubahan field nama
                    if (key === 'name' && preserveNames && matchedTeacher.name) {
                        return;
                    }
                    // Jika opsi pertahankan kontak aktif dan guru sudah memiliki phone/email, abaikan perubahan kontak
                    if ((key === 'phone' || key === 'email') && preserveContacts && matchedTeacher[key]) {
                        return;
                    }
                    const newVal = rowData[key];
                    if (newVal !== undefined && newVal !== null && String(newVal).trim() !== '') {
                        const valNewStr = String(newVal).trim();
                        const valOldStr = matchedTeacher[key] !== undefined && matchedTeacher[key] !== null ? String(matchedTeacher[key]).trim() : '';

                        if (!valOldStr || valOldStr === '-') {
                            newlyFilledCount++;
                        } else if (valNewStr.toLowerCase() !== valOldStr.toLowerCase()) {
                            changedCount++;
                        }
                    }
                });

                totalFieldUpdates += changedCount;
                totalNewFields += newlyFilledCount;

                if (changedCount + newlyFilledCount > 0) {
                    totalUpdatedGTK++;
                } else {
                    totalUnchangedGTK++;
                }
            } else {
                if (rowData.name) {
                    totalNewGTK++;
                } else {
                    totalInvalidGTK++;
                }
            }

            // Render Cells dengan Diff Indikator
            const nikCell = renderDiffCell(rowData.nik, matchedTeacher ? matchedTeacher.nik : '', { isMono: true, isBold: true });

            // Nama Cell
            let nameCell = '';
            if (matchedTeacher) {
                if (preserveNames && matchedTeacher.name) {
                    nameCell = `
                    <div class="inline-flex flex-col text-left">
                        <span class="font-bold text-slate-800 dark:text-slate-200">${escape(matchedTeacher.name)}</span>
                        <span class="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold inline-flex items-center gap-1 mt-0.5">
                            <i class="fa-solid fa-shield-halved text-[9px]"></i> Nama Bergelar Dipertahankan
                        </span>
                    </div>`;
                } else if (!rowData.name) {
                    nameCell = `<div class="inline-flex flex-col text-left"><span class="font-bold text-slate-800 dark:text-slate-200">${escape(matchedTeacher.name)}</span> <span class="text-[10px] text-amber-600 dark:text-amber-400 font-normal italic">(Nama Dipertahankan)</span></div>`;
                } else {
                    nameCell = renderDiffCell(rowData.name, matchedTeacher.name, { isBold: true });
                }
            } else {
                if (!rowData.name) {
                    nameCell = `<span class="text-red-500 italic font-semibold">[Nama Belum Diisi]</span>`;
                } else {
                    nameCell = `<span class="font-bold text-emerald-600 dark:text-emerald-400">${escape(rowData.name)}</span>`;
                }
            }

            const nuptkCell = renderDiffCell(rowData.nuptk, matchedTeacher ? matchedTeacher.nuptk : '', { isMono: true, extraClasses: 'text-indigo-600 dark:text-indigo-400' });
            const genderCell = renderDiffCell(rowData.gender, matchedTeacher ? matchedTeacher.gender : '', { isBold: true, extraClasses: 'text-center' });

            // TTL Cell
            const newTtl = (rowData.birth_place || rowData.birth_date) ? `${rowData.birth_place || ''}${rowData.birth_place && rowData.birth_date ? ', ' : ''}${rowData.birth_date || ''}` : '';
            const oldTtl = matchedTeacher ? `${matchedTeacher.birth_place || ''}${matchedTeacher.birth_place && matchedTeacher.birth_date ? ', ' : ''}${matchedTeacher.birth_date || ''}` : '';
            const ttlCell = renderDiffCell(newTtl, oldTtl);

            const nipCell = renderDiffCell(rowData.nip, matchedTeacher ? matchedTeacher.nip : '', { isMono: true, isBold: true });
            const statusKepCell = renderDiffCell(rowData.status_kepegawaian, matchedTeacher ? matchedTeacher.status_kepegawaian : '', { isBold: true });
            const jenisPtkCell = renderDiffCell(rowData.jenis_ptk, matchedTeacher ? matchedTeacher.jenis_ptk : '');

            // Alamat Domisili Cell
            const newAlamat = [rowData.alamat, rowData.dusun, rowData.kelurahan, rowData.kecamatan, rowData.kode_pos].filter(Boolean).join(', ');
            const oldAlamat = matchedTeacher ? [matchedTeacher.alamat, matchedTeacher.dusun, matchedTeacher.kelurahan, matchedTeacher.kecamatan, matchedTeacher.kode_pos].filter(Boolean).join(', ') : '';
            const alamatCell = renderDiffCell(newAlamat, oldAlamat, { truncate: true });

            // RT / RW Cell
            const newRtRw = (rowData.rt || rowData.rw) ? `${rowData.rt || '-'}/${rowData.rw || '-'}` : '';
            const oldRtRw = (matchedTeacher && (matchedTeacher.rt || matchedTeacher.rw)) ? `${matchedTeacher.rt || '-'}/${matchedTeacher.rw || '-'}` : '';
            const rtRwCell = renderDiffCell(newRtRw, oldRtRw, { isMono: true });

            // Kontak Cell (HP & Email)
            let phoneDiff = '';
            if (matchedTeacher && preserveContacts && matchedTeacher.phone) {
                phoneDiff = `<div class="inline-flex items-center gap-1"><span class="font-mono text-slate-700 dark:text-slate-300" title="HP Dipertahankan: ${escape(matchedTeacher.phone)}">${escape(matchedTeacher.phone)}</span> <span class="text-[9px] text-emerald-600 dark:text-emerald-400 font-semibold">(HP Dipertahankan)</span></div>`;
            } else {
                phoneDiff = renderDiffCell(rowData.phone, matchedTeacher ? matchedTeacher.phone : '', { isMono: true });
            }

            let emailDiff = '';
            if (matchedTeacher && preserveContacts && matchedTeacher.email) {
                emailDiff = `<div class="inline-flex items-center gap-1"><span class="text-slate-700 dark:text-slate-300 truncate max-w-xs" title="Email Dipertahankan: ${escape(matchedTeacher.email)}">${escape(matchedTeacher.email)}</span> <span class="text-[9px] text-emerald-600 dark:text-emerald-400 font-semibold">(Email Dipertahankan)</span></div>`;
            } else {
                emailDiff = renderDiffCell(rowData.email, matchedTeacher ? matchedTeacher.email : '');
            }
            const kontakCell = `<div class="flex flex-col gap-0.5 text-left">${phoneDiff}${emailDiff}</div>`;

            const tugasCell = renderDiffCell(rowData.tugas_tambahan, matchedTeacher ? matchedTeacher.tugas_tambahan : '', { extraClasses: 'text-indigo-600 dark:text-indigo-400 font-semibold' });
            const telegramCell = renderDiffCell(rowData.telegramChatId || rowData.telegram_chat_id, matchedTeacher ? (matchedTeacher.telegramChatId || matchedTeacher.telegram_chat_id) : '', { isMono: true, extraClasses: 'text-sky-600 dark:text-sky-400 text-[11px]' });

            // Status Badge
            let statusDisplay = '';
            if (matchedTeacher) {
                const totalDiffs = changedCount + newlyFilledCount;
                if (totalDiffs > 0) {
                    const diffLabels = [];
                    if (changedCount > 0) diffLabels.push(`${changedCount} ubah`);
                    if (newlyFilledCount > 0) diffLabels.push(`${newlyFilledCount} baru`);
                    statusDisplay = `<span class="px-2 py-1 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700 shadow-sm inline-flex items-center gap-1"><i class="fa-solid fa-pen-to-square"></i> Update (${diffLabels.join(', ')})</span>`;
                } else {
                    statusDisplay = `<span class="px-2 py-1 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 inline-flex items-center gap-1"><i class="fa-solid fa-check"></i> Sama (0 Ubah)</span>`;
                }
            } else {
                if (!rowData.name) {
                    statusDisplay = `<span class="px-2 py-1 rounded-full text-[10px] font-bold bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-700 inline-flex items-center gap-1"><i class="fa-solid fa-triangle-exclamation"></i> Nama Kosong</span>`;
                } else {
                    statusDisplay = `<span class="px-2 py-1 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700 inline-flex items-center gap-1"><i class="fa-solid fa-plus-circle"></i> Baru</span>`;
                }
            }

            html += `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td class="p-2.5">${nikCell}</td>
                <td class="p-2.5">${nameCell}</td>
                <td class="p-2.5">${nuptkCell}</td>
                <td class="p-2.5 text-center">${genderCell}</td>
                <td class="p-2.5">${ttlCell}</td>
                <td class="p-2.5">${nipCell}</td>
                <td class="p-2.5">${statusKepCell}</td>
                <td class="p-2.5">${jenisPtkCell}</td>
                <td class="p-2.5">${alamatCell}</td>
                <td class="p-2.5">${rtRwCell}</td>
                <td class="p-2.5">${kontakCell}</td>
                <td class="p-2.5">${tugasCell}</td>
                <td class="p-2.5">${telegramCell}</td>
                <td class="p-2.5 text-center">${statusDisplay}</td>
            </tr>`;
        });

        if (previewBody) previewBody.innerHTML = html;
        if (previewContainer) previewContainer.classList.remove('hidden');

        if (previewDiffSummary) {
            previewDiffSummary.innerHTML = `<span class="text-emerald-600 dark:text-emerald-400 font-bold"><i class="fa-solid fa-plus"></i> ${totalNewGTK} Baru</span> · <span class="text-amber-600 dark:text-amber-400 font-bold"><i class="fa-solid fa-pen"></i> ${totalUpdatedGTK} Update (${totalFieldUpdates} field diubah, ${totalNewFields} baru)</span> · <span class="text-slate-500 dark:text-slate-400 font-medium"><i class="fa-solid fa-check"></i> ${totalUnchangedGTK} Sama</span>`;
        }

        if (tempImportData.length > 0) {
            btnSave.disabled = false;
            btnSave.classList.remove('opacity-50', 'cursor-not-allowed');
            btnSave.innerHTML = `<i class="fa-solid fa-cloud-arrow-up mr-2"></i> Simpan Semua (${tempImportData.length} GTK)`;
            if (summaryText) {
                const activeNotes = [];
                if (preserveNames) activeNotes.push('nama bergelar');
                if (preserveContacts) activeNotes.push('kontak HP & email');
                const noteStr = activeNotes.length > 0 ? `Data lama (${activeNotes.join(', ')}) dipertahankan. ` : '';
                summaryText.innerText = `Terdeteksi ${tempImportData.length} baris GTK (${totalNewGTK} baru, ${totalUpdatedGTK} update, ${totalUnchangedGTK} sama). ${noteStr}Kolom kosong tidak akan menimpa data yang sudah ada.`;
            }
        } else {
            if (summaryText) summaryText.innerText = `Tidak ada baris data valid yang terdeteksi. Pastikan data Excel disalin dengan benar.`;
        }
    });

    // Listener toggle checkbox pertahankan nama & kontak
    const chkPreserveNames = document.getElementById('chk-preserve-names');
    if (chkPreserveNames) {
        chkPreserveNames.addEventListener('change', () => {
            if (pasteArea.value.trim() && previewContainer && !previewContainer.classList.contains('hidden')) {
                btnPreview.click();
            }
        });
    }

    const chkPreserveContacts = document.getElementById('chk-preserve-contacts');
    if (chkPreserveContacts) {
        chkPreserveContacts.addEventListener('change', () => {
            if (pasteArea.value.trim() && previewContainer && !previewContainer.classList.contains('hidden')) {
                btnPreview.click();
            }
        });
    }

    // 2. Save Handler (Batch Upsert ke Cloudflare D1 SSOT)
    btnSave.addEventListener('click', async () => {
        if (tempImportData.length === 0) return;

        const preserveNames = document.getElementById('chk-preserve-names')?.checked ?? true;
        const preserveContacts = document.getElementById('chk-preserve-contacts')?.checked ?? true;
        const originalText = btnSave.innerHTML;
        btnSave.disabled = true;
        btnSave.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-2"></i> Menyimpan ke Cloudflare D1...`;

        try {
            let newCount = 0;
            let updateCount = 0;
            const finalGtkToUpsert = [];

            tempImportData.forEach(t => {
                let existingTeacher = null;
                // Match 1: NIK (SSOT Utama)
                if (t.nik && t.nik !== '-' && t.nik !== '') {
                    existingTeacher = allTeachers.find(teacher => teacher.nik === t.nik);
                }
                // Match 2: NIP
                if (!existingTeacher && t.nip && t.nip !== '-' && t.nip !== '') {
                    existingTeacher = allTeachers.find(teacher => teacher.nip === t.nip);
                }
                // Match 3: NUPTK
                if (!existingTeacher && t.nuptk && t.nuptk !== '-' && t.nuptk !== '') {
                    existingTeacher = allTeachers.find(teacher => teacher.nuptk === t.nuptk);
                }
                // Match 4a: Nama Lengkap Persis (case-insensitive)
                if (!existingTeacher && t.name) {
                    existingTeacher = allTeachers.find(teacher => teacher.name && teacher.name.trim().toLowerCase() === t.name.trim().toLowerCase());
                }
                // Match 4b: Nama Pokok Tanpa Gelar (fallback jika nama persis tidak cocok)
                if (!existingTeacher && t.name) {
                    const importNameStripped = stripGelar(t.name);
                    if (importNameStripped.length >= 3) {
                        existingTeacher = allTeachers.find(teacher => teacher.name && stripGelar(teacher.name) === importNameStripped);
                    }
                }
                // Match 4c: Email matching fallback (jika email terisi dan valid)
                if (!existingTeacher && t.email && t.email.includes('@')) {
                    const targetEmail = t.email.trim().toLowerCase();
                    existingTeacher = allTeachers.find(teacher => teacher.email && teacher.email.trim().toLowerCase() === targetEmail);
                }

                if (existingTeacher) {
                    const updateData = { ...existingTeacher };
                    Object.keys(t).forEach(key => {
                        const val = t[key];
                        if (val !== undefined && val !== '' && val !== null) {
                            if (key === 'name' && preserveNames && existingTeacher.name) {
                                return;
                            }
                            if ((key === 'phone' || key === 'email') && preserveContacts && existingTeacher[key]) {
                                return;
                            }
                            updateData[key] = val;
                        }
                    });

                    finalGtkToUpsert.push(updateData);
                    updateCount++;
                } else {
                    if (!t.name) {
                        console.warn('[GTK Import] Baris baru dilewati karena nama kosong:', t);
                        return;
                    }

                    let docId = (t.nik && t.nik !== '-') ? t.nik : ((t.nip && t.nip !== '-') ? t.nip : (t.nuptk && t.nuptk !== '-' ? t.nuptk : null));
                    const insertData = {
                        id: docId || `gtk_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                        gender: 'L',
                        status_kepegawaian: 'Honorer',
                        jenis_ptk: 'Guru Mapel',
                        ...t
                    };

                    finalGtkToUpsert.push(insertData);
                    newCount++;
                }
            });

            if (typeof cfClient !== 'undefined' && cfClient.batchUpsertGtk) {
                await cfClient.batchUpsertGtk(finalGtkToUpsert);
            } else if (typeof cfClient !== 'undefined' && cfClient.batchUpsertTeachers) {
                await cfClient.batchUpsertTeachers(finalGtkToUpsert);
            }

            if (typeof window.logAudit === 'function') {
                window.logAudit('IMPORT_GTK', 'batch', null, { count: tempImportData.length, newCount, updateCount }, `Import ${tempImportData.length} data GTK (${newCount} baru, ${updateCount} update)`);
            }

            document.getElementById('modal-import')?.classList.add('hidden');
            showModernAlert("Import GTK Berhasil! 🎉", `<b>${tempImportData.length}</b> Data GTK berhasil diproses (<b>${newCount}</b> baru, <b>${updateCount}</b> diperbarui).`);
            pasteArea.value = '';
            if (previewContainer) previewContainer.classList.add('hidden');
            clearGtkCache();
            updateGtkMetadata();
            loadGtk(true);

        } catch (error) {
            console.error('[GTK] Gagal import Cloudflare D1:', error);
            showModernAlert("Gagal Import", error.message || "Terjadi kesalahan saat menyimpan data.", 'error');
        } finally {
            btnSave.disabled = false;
            btnSave.innerHTML = originalText;
        }
    });
}

// ==========================================
// 6. EVENT LISTENERS FORM TAMBAH & EDIT (CLOUDFLARE D1 SSOT)
// ==========================================
function setupEventListeners() {
    // 1. Pencarian Real-Time
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const val = e.target.value.toLowerCase().trim();
            if (!val) {
                renderTable(allTeachers);
                return;
            }
            const filtered = allTeachers.filter(t =>
                (t.name && t.name.toLowerCase().includes(val)) ||
                (t.nik && t.nik.toLowerCase().includes(val)) ||
                (t.nip && t.nip.toLowerCase().includes(val)) ||
                (t.nuptk && t.nuptk.toLowerCase().includes(val)) ||
                (t.email && t.email.toLowerCase().includes(val)) ||
                (t.phone && t.phone.toLowerCase().includes(val)) ||
                (t.jenis_ptk && t.jenis_ptk.toLowerCase().includes(val)) ||
                (t.status_kepegawaian && t.status_kepegawaian.toLowerCase().includes(val)) ||
                (t.tugas_tambahan && t.tugas_tambahan.toLowerCase().includes(val)) ||
                (t.jabatan && t.jabatan.toLowerCase().includes(val))
            );
            renderTable(filtered);
        });
    }

    // 2. Form Tambah GTK Baru
    const formAdd = document.getElementById('form-add-teacher');
    if (formAdd) {
        formAdd.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = formAdd.querySelector('button[type="submit"]');
            const originalText = btn ? btn.innerHTML : 'Simpan Data GTK';
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Menyimpan...'; }

            try {
                const formData = new FormData(formAdd);
                const telegramChatId = (formData.get('telegramChatId') || '').trim();

                if (telegramChatId && typeof window.verifyTelegramChatId === 'function') {
                    const checkResult = await window.verifyTelegramChatId(telegramChatId, formData.get('name'));
                    if (!checkResult.valid) {
                        showModernAlert("Verifikasi Telegram Gagal ❌", checkResult.message, 'error');
                        if (btn) { btn.disabled = false; btn.innerHTML = originalText; }
                        return;
                    }
                }

                const nikVal = (formData.get('nik') || '').trim();
                const nipVal = (formData.get('nip') || '').trim();
                const nuptkVal = (formData.get('nuptk') || '').trim();
                const birthDateVal = formData.get('birth_date') || '';
                const tugasTambahanVal = formData.get('tugas_tambahan') || '';
                const jenisPtkVal = formData.get('jenis_ptk') || '';

                const data = {
                    name: (formData.get('name') || '').trim(),
                    nik: nikVal,
                    nuptk: nuptkVal,
                    gender: formData.get('gender') || 'L',
                    birth_place: (formData.get('birth_place') || '').trim(),
                    birth_date: birthDateVal,
                    birthDate: birthDateVal,
                    nip: nipVal,
                    status_kepegawaian: (formData.get('status_kepegawaian') || '').trim(),
                    jenis_ptk: jenisPtkVal,
                    agama: formData.get('agama') || 'Hindu',
                    alamat: (formData.get('alamat') || '').trim(),
                    rt: (formData.get('rt') || '').trim(),
                    rw: (formData.get('rw') || '').trim(),
                    dusun: (formData.get('dusun') || '').trim(),
                    kelurahan: (formData.get('kelurahan') || '').trim(),
                    kecamatan: (formData.get('kecamatan') || '').trim(),
                    kode_pos: (formData.get('kode_pos') || '').trim(),
                    phone: (formData.get('phone') || '').trim(),
                    email: (formData.get('email') || '').trim(),
                    tugas_tambahan: tugasTambahanVal,
                    jabatan: tugasTambahanVal || jenisPtkVal,
                    status: (formData.get('status_kepegawaian') || '').trim(),
                    telegramChatId: telegramChatId,
                    telegram_chat_id: telegramChatId
                };

                // Cek Validasi & Duplikasi NIK (16 Digit SSOT Utama)
                if (data.nik && data.nik !== '-') {
                    if (!/^\d{16}$/.test(data.nik)) {
                        throw new Error('NIK harus terdiri dari tepat 16 digit angka.');
                    }
                    const existNik = allTeachers.find(t => t.nik === data.nik);
                    if (existNik) throw new Error(`NIK ${data.nik} sudah digunakan oleh ${existNik.name}`);
                }

                // Cek Duplikasi NIP Existing di Cache
                if (data.nip && data.nip !== '-') {
                    const existNip = allTeachers.find(t => t.nip === data.nip);
                    if (existNip) throw new Error(`NIP ${data.nip} sudah digunakan oleh ${existNip.name}`);
                }

                // Cek Duplikasi NUPTK Existing di Cache
                if (data.nuptk && data.nuptk !== '-') {
                    const existNuptk = allTeachers.find(t => t.nuptk === data.nuptk);
                    if (existNuptk) throw new Error(`NUPTK ${data.nuptk} sudah digunakan oleh ${existNuptk.name}`);
                }

                // Kunci ID Baru: Prioritaskan NIK (SSOT) -> NIP -> NUPTK -> Auto ID
                let docId = (data.nik && data.nik !== '-') ? data.nik : ((data.nip && data.nip !== '-') ? data.nip : (data.nuptk && data.nuptk !== '-' ? data.nuptk : null));
                
                let savedId = docId;
                if (typeof cfClient !== 'undefined' && cfClient.createGtk) {
                    const res = await cfClient.createGtk({
                        id: docId,
                        ...data
                    });
                    savedId = res?.id || docId;
                } else if (typeof cfClient !== 'undefined' && cfClient.createTeacher) {
                    const res = await cfClient.createTeacher({
                        id: docId,
                        ...data
                    });
                    savedId = res?.id || docId;
                }

                if (typeof window.logAudit === 'function') {
                    window.logAudit('CREATE_GTK', savedId, null, data, `Menambahkan GTK baru: ${data.name}`);
                }

                showModernAlert("Berhasil Ditambahkan! 🎉", `Data GTK <b>${data.name}</b> berhasil disimpan ke database.`);
                document.getElementById('modal-add')?.classList.add('hidden');
                formAdd.reset();
                clearGtkCache();
                updateGtkMetadata();
                loadGtk(true);

            } catch (err) {
                showModernAlert("Gagal Menyimpan", err.message || "Terjadi kesalahan saat menyimpan data.", 'error');
            } finally {
                if (btn) { btn.disabled = false; btn.innerHTML = originalText; }
            }
        });
    }

    // 3. Form Edit GTK
    const formEdit = document.getElementById('form-edit-teacher');
    if (formEdit) {
        formEdit.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = formEdit.querySelector('button[type="submit"]');
            const originalText = btn ? btn.innerHTML : 'Simpan Perubahan';
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Menyimpan...'; }

            try {
                const id = document.getElementById('edit-id')?.value;
                if (!id) throw new Error('ID GTK tidak valid.');

                const name = (document.getElementById('edit-name')?.value || '').trim();
                const telegramChatId = (document.getElementById('edit-telegram')?.value || '').trim();

                if (telegramChatId && typeof window.verifyTelegramChatId === 'function') {
                    const checkResult = await window.verifyTelegramChatId(telegramChatId, name);
                    if (!checkResult.valid) {
                        showModernAlert("Verifikasi Telegram Gagal ❌", checkResult.message, 'error');
                        if (btn) { btn.disabled = false; btn.innerHTML = originalText; }
                        return;
                    }
                }

                const editNik = (document.getElementById('edit-nik')?.value || '').trim();
                const editNip = (document.getElementById('edit-nip')?.value || '').trim();
                const editNuptk = (document.getElementById('edit-nuptk')?.value || '').trim();

                // Validasi & Cek Keunikan NIK pada Edit
                if (editNik && editNik !== '-') {
                    if (!/^\d{16}$/.test(editNik)) {
                        throw new Error('NIK harus terdiri dari tepat 16 digit angka.');
                    }
                    const existNik = allTeachers.find(t => t.nik === editNik && t.id !== id && t.nik !== id);
                    if (existNik) throw new Error(`NIK ${editNik} sudah digunakan oleh ${existNik.name}`);
                }

                // Cek Duplikasi NIP pada Edit
                if (editNip && editNip !== '-') {
                    const existNip = allTeachers.find(t => t.nip === editNip && t.id !== id && t.nip !== id);
                    if (existNip) throw new Error(`NIP ${editNip} sudah digunakan oleh ${existNip.name}`);
                }

                // Cek Duplikasi NUPTK pada Edit
                if (editNuptk && editNuptk !== '-') {
                    const existNuptk = allTeachers.find(t => t.nuptk === editNuptk && t.id !== id && t.nuptk !== id);
                    if (existNuptk) throw new Error(`NUPTK ${editNuptk} sudah digunakan oleh ${existNuptk.name}`);
                }

                const birthDateVal = document.getElementById('edit-birth_date')?.value || '';
                const tugasTambahanVal = document.getElementById('edit-tugas_tambahan')?.value || '';
                const jenisPtkVal = document.getElementById('edit-jenis_ptk')?.value || '';
                const statusKepegawaianVal = (document.getElementById('edit-status_kepegawaian')?.value || '').trim();

                const data = {
                    name: name,
                    gender: document.getElementById('edit-gender')?.value || 'L',
                    nik: editNik,
                    nuptk: editNuptk,
                    nip: editNip,
                    agama: document.getElementById('edit-agama')?.value || 'Hindu',
                    birth_place: (document.getElementById('edit-birth_place')?.value || '').trim(),
                    birth_date: birthDateVal,
                    birthDate: birthDateVal,
                    status_kepegawaian: statusKepegawaianVal,
                    status: statusKepegawaianVal,
                    jenis_ptk: jenisPtkVal,
                    tugas_tambahan: tugasTambahanVal,
                    jabatan: tugasTambahanVal || jenisPtkVal,
                    alamat: (document.getElementById('edit-alamat')?.value || '').trim(),
                    rt: (document.getElementById('edit-rt')?.value || '').trim(),
                    rw: (document.getElementById('edit-rw')?.value || '').trim(),
                    dusun: (document.getElementById('edit-dusun')?.value || '').trim(),
                    kelurahan: (document.getElementById('edit-kelurahan')?.value || '').trim(),
                    kecamatan: (document.getElementById('edit-kecamatan')?.value || '').trim(),
                    kode_pos: (document.getElementById('edit-kode_pos')?.value || '').trim(),
                    phone: (document.getElementById('edit-phone')?.value || '').trim(),
                    email: (document.getElementById('edit-email')?.value || '').trim(),
                    telegramChatId: telegramChatId,
                    telegram_chat_id: telegramChatId
                };

                const oldData = allTeachers.find(t => t.id === id || t.nip === id || t.nik === id || t.nuptk === id);

                // PROSES UPLOAD / HAPUS FOTO GTK (KHUSUS SUPER ADMIN)
                const isSuperAdmin = window.hasRole ? window.hasRole('super_admin') : (localStorage.getItem('user_role') === 'super_admin');
                if (isSuperAdmin && typeof cfClient !== 'undefined') {
                    if (window._gtkEditPendingPhotoBase64 && cfClient.uploadGtkPhoto) {
                        try {
                            const photoUploadRes = await cfClient.uploadGtkPhoto({
                                gtkId: id,
                                photoBase64: window._gtkEditPendingPhotoBase64
                            });
                            if (photoUploadRes && photoUploadRes.foto_url) {
                                data.foto = photoUploadRes.foto_url;
                                data.photo_url = photoUploadRes.foto_url;
                                // Jika GTK ini adalah user aktif yang sedang login, update cache fotonya
                                const currentAuthUid = auth?.currentUser?.uid;
                                if (currentAuthUid) {
                                    const cachedTeacher = await window.getLinkedTeacherForUser?.(auth.currentUser, null);
                                    if (cachedTeacher?.id === id) {
                                        const resolvedPhoto = resolvePhotoUrl(photoUploadRes.foto_url);
                                        localStorage.setItem(`cached_user_photo_${currentAuthUid}`, resolvedPhoto);
                                        window.updateUIAvatars?.(resolvedPhoto);
                                    }
                                }
                            }
                        } catch (ePhotoUp) {
                            console.error('[GTK] Error upload foto GTK:', ePhotoUp);
                            showModernAlert("Peringatan Foto", "Data tersimpan, namun gagal mengunggah foto: " + (ePhotoUp.message || ''), 'error');
                        }
                    } else if (window._gtkEditPendingPhotoDelete && cfClient.deleteGtkPhoto) {
                        try {
                            await cfClient.deleteGtkPhoto(id);
                            data.foto = null;
                            data.photo_url = null;
                            const currentAuthUid = auth?.currentUser?.uid;
                            if (currentAuthUid) {
                                const cachedTeacher = await window.getLinkedTeacherForUser?.(auth.currentUser, null);
                                if (cachedTeacher?.id === id) {
                                    localStorage.removeItem(`cached_user_photo_${currentAuthUid}`);
                                    window.updateUIAvatars?.(null);
                                }
                            }
                        } catch (ePhotoDel) {
                            console.error('[GTK] Error hapus foto GTK:', ePhotoDel);
                        }
                    }
                }

                if (typeof cfClient !== 'undefined' && cfClient.updateGtk) {
                    await cfClient.updateGtk(id, data);
                } else if (typeof cfClient !== 'undefined' && cfClient.updateTeacher) {
                    await cfClient.updateTeacher(id, data);
                }

                // Sinkronkan relasi linkedTeacherId di users jika ada akun yang merujuk ke ID lama dan terjadi migrasi ID
                if (editNik && editNik !== '-' && id !== editNik) {
                    try {
                        const qUsers = await getDocs(query(collection(db, PATHS.users), where('linkedTeacherId', '==', id)));
                        if (!qUsers.empty) {
                            const uBatch = writeBatch(db);
                            qUsers.forEach(uDoc => {
                                uBatch.update(uDoc.ref, { linkedTeacherId: editNik, nik: editNik, updatedAt: serverTimestamp() });
                            });
                            await uBatch.commit();
                            console.log(`[GTK Edit] Berhasil sinkronisasi linkedTeacherId ke NIK baru (${editNik}) untuk ${qUsers.size} user.`);
                        }
                    } catch (eUserSync) {
                        console.warn('[GTK Edit] Warning saat sync linkedTeacherId ke users:', eUserSync);
                    }
                }

                if (typeof window.logAudit === 'function') {
                    window.logAudit('UPDATE_GTK', id, oldData, data, `Memperbarui data GTK: ${data.name}`);
                }

                showModernAlert("Berhasil Diperbarui! 🎉", `Data GTK <b>${data.name}</b> berhasil diperbarui.`);
                document.getElementById('modal-edit')?.classList.add('hidden');
                clearGtkCache();
                updateGtkMetadata();
                loadGtk(true);

            } catch (err) {
                console.error('[GTK] Update error Cloudflare D1:', err);
                showModernAlert("Gagal Update", err.message || "Terjadi kesalahan saat memperbarui data.", 'error');
            } finally {
                if (btn) { btn.disabled = false; btn.innerHTML = originalText; }
            }
        });
    }

    // 4. Listener Upload & Hapus Foto Profil GTK di Modal Edit (Khusus Super Admin)
    const inputGtkPhoto = document.getElementById('input-edit-gtk-photo');
    if (inputGtkPhoto) {
        inputGtkPhoto.addEventListener('change', async (e) => {
            const file = e.target?.files?.[0];
            if (!file) return;

            const isImage = (file.type && file.type.startsWith('image/')) ||
                            /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || '');
            if (!isImage) {
                showModernAlert("Format Salah", "Pilih file gambar yang valid (JPG, PNG, WebP).", 'error');
                return;
            }

            if (file.size > 10 * 1024 * 1024) {
                showModernAlert("Ukuran Terlalu Besar", "Ukuran foto maksimal 10 MB.", 'error');
                return;
            }

            const statusEl = document.getElementById('gtk-edit-photo-status');
            const photoImg = document.getElementById('gtk-edit-photo-img');
            const photoPlaceholder = document.getElementById('gtk-edit-photo-placeholder');
            const btnDeletePhoto = document.getElementById('btn-delete-edit-gtk-photo');

            const applyPhotoResult = (compressedBase64) => {
                window._gtkEditPendingPhotoBase64 = compressedBase64;
                window._gtkEditPendingPhotoDelete = false;

                if (photoImg) {
                    photoImg.src = compressedBase64;
                    photoImg.classList.remove('hidden');
                }
                if (photoPlaceholder) photoPlaceholder.classList.add('hidden');
                if (btnDeletePhoto) btnDeletePhoto.classList.remove('hidden');

                const approxKb = Math.round((compressedBase64.length * 3 / 4) / 1024);
                if (statusEl) {
                    statusEl.innerText = `Siap disimpan (~${approxKb} KB, WebP). Klik Simpan Perubahan.`;
                    statusEl.className = 'text-[10px] text-emerald-600 dark:text-emerald-400 mt-1 font-semibold';
                }
            };

            if (typeof window.openProfilePhotoEditor === 'function') {
                if (statusEl) {
                    statusEl.innerText = 'Membuka editor penyesuaian foto...';
                    statusEl.className = 'text-[10px] text-orange-600 dark:text-orange-400 mt-1 animate-pulse';
                }

                window.openProfilePhotoEditor({
                    file: file,
                    onApply: applyPhotoResult,
                    onCancel: () => {
                        if (e.target) e.target.value = '';
                        if (statusEl && !window._gtkEditPendingPhotoBase64) {
                            statusEl.innerText = '';
                        }
                    }
                });
            } else {
                if (statusEl) {
                    statusEl.innerText = 'Mengompresi foto ke WebP...';
                    statusEl.className = 'text-[10px] text-orange-600 dark:text-orange-400 mt-1 animate-pulse';
                }

                try {
                    const compressFn = window.compressImageToWebP;
                    if (!compressFn) throw new Error('Fungsi kompresi foto belum termuat.');

                    const compressedBase64 = await compressFn(file, 400, 400, 0.82);
                    applyPhotoResult(compressedBase64);
                } catch (err) {
                    console.error('[GTK Photo] Gagal kompres:', err);
                    showModernAlert("Gagal Kompres", err.message || "Gagal memproses gambar.", 'error');
                    if (statusEl) {
                        statusEl.innerText = 'Gagal memproses gambar.';
                        statusEl.className = 'text-[10px] text-red-500 mt-1';
                    }
                }
            }
        });
    }

    const btnDeleteGtkPhoto = document.getElementById('btn-delete-edit-gtk-photo');
    if (btnDeleteGtkPhoto) {
        btnDeleteGtkPhoto.addEventListener('click', async () => {
            const editName = document.getElementById('edit-name')?.value || 'GTK ini';
            let confirmed = false;

            if (typeof Swal !== 'undefined') {
                const { value: confirmText, isConfirmed } = await Swal.fire({
                    title: 'Hapus Foto Profil GTK?',
                    html: `Tindakan ini akan menghapus pasfoto profil <b>${escapeHTML(editName)}</b> dari sistem Cloudflare R2.<br><br><span class="text-xs text-rose-600 dark:text-rose-400 font-bold">Ketik kata <b>HAPUS</b> di bawah untuk mengonfirmasi:</span>`,
                    input: 'text',
                    inputPlaceholder: 'Ketik HAPUS',
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: '#e11d48',
                    cancelButtonColor: '#64748b',
                    confirmButtonText: '<i class="fa-solid fa-trash-can mr-1"></i> Ya, Hapus Foto',
                    cancelButtonText: 'Batal',
                    inputValidator: (val) => {
                        if (!val || String(val).trim().toUpperCase() !== 'HAPUS') {
                            return 'Ketik kata "HAPUS" secara persis untuk mengonfirmasi!';
                        }
                    }
                });
                confirmed = isConfirmed && String(confirmText || '').trim().toUpperCase() === 'HAPUS';
            } else {
                const inputPrompt = prompt(`HAPUS FOTO PROFIL GTK?\n\nTindakan ini akan menghapus foto profil ${editName}.\nKetik "HAPUS" untuk mengonfirmasi:`);
                confirmed = String(inputPrompt || '').trim().toUpperCase() === 'HAPUS';
            }

            if (!confirmed) return;

            window._gtkEditPendingPhotoBase64 = null;
            window._gtkEditPendingPhotoDelete = true;

            const photoImg = document.getElementById('gtk-edit-photo-img');
            const photoPlaceholder = document.getElementById('gtk-edit-photo-placeholder');
            const statusEl = document.getElementById('gtk-edit-photo-status');
            const fileInput = document.getElementById('input-edit-gtk-photo');

            if (fileInput) fileInput.value = '';
            if (photoImg) { photoImg.src = ''; photoImg.classList.add('hidden'); }
            if (photoPlaceholder) {
                const editNameVal = document.getElementById('edit-name')?.value || '?';
                photoPlaceholder.innerText = editNameVal.charAt(0).toUpperCase();
                photoPlaceholder.classList.remove('hidden');
            }
            btnDeleteGtkPhoto.classList.add('hidden');
            if (statusEl) {
                statusEl.innerText = 'Foto akan dihapus saat Anda menekan tombol Simpan Perubahan.';
                statusEl.className = 'text-[10px] text-amber-600 dark:text-amber-400 mt-1 font-semibold';
            }
        });
    }
}

// ==========================================
// 📑 ANTREAN PENGAJUAN DATA GTK MANDIRI (KURIKULUM & STAF APPROVAL)
// ==========================================

let allSubmissions = [];
let currentSubStatusFilter = 'pending';
let activeSubmission = null;

async function loadSubmissionsCount() {
    try {
        const badge = document.getElementById('badge-submissions-count');
        if (!badge) return;
        const pendingList = await cfClient.getGtkSubmissions('pending');
        const count = Array.isArray(pendingList) ? pendingList.length : 0;
        if (count > 0) {
            badge.innerText = count > 99 ? '99+' : count;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    } catch (e) {
        console.warn('[Submissions Count] Gagal memuat jumlah pengajuan:', e);
    }
}

async function openGtkSubmissionsModal() {
    const modal = document.getElementById('modal-gtk-submissions');
    if (!modal) return;
    modal.classList.remove('hidden');
    await loadSubmissionsList(true);
}

function filterSubmissions(status) {
    currentSubStatusFilter = status;
    document.querySelectorAll('.btn-sub-filter').forEach(btn => {
        const btnStatus = btn.getAttribute('data-status');
        if (btnStatus === status) {
            btn.className = 'btn-sub-filter px-3 py-1 rounded-full font-bold bg-amber-600 text-white shadow-sm';
        } else {
            btn.className = 'btn-sub-filter px-3 py-1 rounded-full font-bold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 transition-all';
        }
    });
    renderSubmissionsTable();
}

async function loadSubmissionsList(forceRefresh = false) {
    const loadingEl = document.getElementById('submissions-loading');
    const emptyEl = document.getElementById('submissions-empty');
    const tableEl = document.getElementById('table-submissions');

    if (loadingEl) loadingEl.classList.remove('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');
    if (tableEl) tableEl.classList.add('hidden');

    try {
        allSubmissions = await cfClient.getGtkSubmissions('all');
        if (!Array.isArray(allSubmissions)) allSubmissions = [];

        // Update badge pending
        const pendingCount = allSubmissions.filter(s => s.status === 'pending').length;
        const badge = document.getElementById('badge-submissions-count');
        if (badge) {
            if (pendingCount > 0) {
                badge.innerText = pendingCount > 99 ? '99+' : pendingCount;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }
    } catch (err) {
        console.error('[Load Submissions Error]:', err);
        showAlert('Error', err.message || 'Gagal memuat daftar pengajuan GTK.', 'error');
    } finally {
        if (loadingEl) loadingEl.classList.add('hidden');
        renderSubmissionsTable();
    }
}

function escapeSubmissionHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

function renderSubmissionsTable() {
    const emptyEl = document.getElementById('submissions-empty');
    const tableEl = document.getElementById('table-submissions');
    const tbody = document.getElementById('submissions-table-body');
    if (!tbody) return;

    let filtered = allSubmissions;
    if (currentSubStatusFilter !== 'all') {
        filtered = allSubmissions.filter(s => (s.status || 'pending') === currentSubStatusFilter);
    }

    if (filtered.length === 0) {
        if (emptyEl) emptyEl.classList.remove('hidden');
        if (tableEl) tableEl.classList.add('hidden');
        tbody.innerHTML = '';
        return;
    }

    if (emptyEl) emptyEl.classList.add('hidden');
    if (tableEl) tableEl.classList.remove('hidden');

    tbody.innerHTML = filtered.map(sub => {
        const display = Object.fromEntries(Object.entries(sub).map(([key, value]) => [key, escapeSubmissionHtml(value)]));
        const createdDate = sub.created_at ? new Date(sub.created_at).toLocaleDateString('id-ID', {
            day: 'numeric', month: 'short', year: 'numeric'
        }) : '-';

        let statusBadge = '';
        if (sub.status === 'approved') {
            statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60"><i class="fa-solid fa-check mr-1"></i>Disetujui</span>';
        } else if (sub.status === 'rejected') {
            statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60"><i class="fa-solid fa-xmark mr-1"></i>Ditolak</span>';
        } else {
            statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 animate-pulse"><i class="fa-regular fa-clock mr-1"></i>Menunggu</span>';
        }

        const safeId = escapeSubmissionHtml(sub.id);
        return `
            <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-700/30 transition-colors">
                <td class="px-3 py-2.5 whitespace-nowrap text-slate-500 dark:text-slate-400 font-mono text-[11px]">${createdDate}</td>
                <td class="px-3 py-2.5">
                    <div class="font-bold text-slate-800 dark:text-white">${display.name || '-'}</div>
                    <div class="text-[11px] text-slate-400 dark:text-slate-500">${display.gender === 'L' ? 'Laki-laki' : (sub.gender === 'P' ? 'Perempuan' : '-')}</div>
                </td>
                <td class="px-3 py-2.5 whitespace-nowrap font-mono text-[11px]">
                    <div>NIP: ${display.nip || '-'}</div>
                    <div class="text-slate-400">NIK: ${display.nik || '-'}</div>
                </td>
                <td class="px-3 py-2.5">
                    <div class="font-semibold text-slate-700 dark:text-slate-300">${display.jenis_ptk || 'Pendidik'}</div>
                    <div class="text-[11px] text-slate-400">${display.status_kepegawaian || 'Honorer'}</div>
                </td>
                <td class="px-3 py-2.5">
                    <div class="text-slate-700 dark:text-slate-300"><i class="fa-brands fa-whatsapp text-emerald-500 mr-1"></i>${display.phone || '-'}</div>
                    <div class="text-[11px] text-slate-400"><i class="fa-regular fa-envelope mr-1"></i>${display.email || '-'}</div>
                </td>
                <td class="px-3 py-2.5 text-center whitespace-nowrap">${statusBadge}</td>
                <td class="px-3 py-2.5 text-center whitespace-nowrap">
                    <button type="button" data-submission-id="${safeId}" onclick="window.openSubmissionDetail(this.dataset.submissionId)"
                        class="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white rounded-lg font-bold text-xs shadow-sm transition-all flex items-center gap-1 mx-auto">
                        <i class="fa-solid fa-eye"></i> Tinjau
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function openSubmissionDetail(id) {
    const sub = allSubmissions.find(s => s.id === id);
    if (!sub) {
        showAlert('Error', 'Data pengajuan tidak ditemukan.', 'error');
        return;
    }

    activeSubmission = sub;
    const display = Object.fromEntries(Object.entries(sub).map(([key, value]) => [key, escapeSubmissionHtml(value)]));
    const bodyEl = document.getElementById('sub-detail-body');
    const statusTextEl = document.getElementById('sub-current-status');
    const btnApprove = document.getElementById('btn-approve-sub');
    const btnReject = document.getElementById('btn-reject-sub');

    if (statusTextEl) {
        if (sub.status === 'approved') {
            statusTextEl.innerHTML = `<span class="text-emerald-600 dark:text-emerald-400 font-bold">Disetujui oleh ${display.approved_by || '-'} (${display.approved_at || '-'})</span>`;
        } else if (sub.status === 'rejected') {
            statusTextEl.innerHTML = `<span class="text-rose-600 dark:text-rose-400 font-bold">Ditolak: "${display.rejection_reason || '-'}" (${display.approved_by || '-'})</span>`;
        } else {
            statusTextEl.innerHTML = '<span class="text-amber-600 dark:text-amber-400 font-bold">Menunggu Verifikasi (Pending)</span>';
        }
    }

    // Hanya tampilkan tombol aksi jika status pending
    const isPending = (sub.status || 'pending') === 'pending';
    if (btnApprove) {
        if (isPending) btnApprove.classList.remove('hidden');
        else btnApprove.classList.add('hidden');
    }
    if (btnReject) {
        if (isPending) btnReject.classList.remove('hidden');
        else btnReject.classList.add('hidden');
    }

    const birthInfo = (sub.birth_place && sub.birth_date) ? `${sub.birth_place}, ${sub.birth_date}` : (sub.birth_place || sub.birth_date || '-');
    const rtrw = (sub.rt || sub.rw) ? `RT ${sub.rt || '-'} / RW ${sub.rw || '-'}` : '-';

    if (bodyEl) {
        bodyEl.innerHTML = `
            <!-- A. Identitas PTK -->
            <div class="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-xl border border-slate-200 dark:border-slate-700/60">
                <h4 class="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-3 flex items-center gap-1.5 border-b pb-1 dark:border-slate-700">
                    <i class="fa-solid fa-id-card"></i> A. Identitas Pendidik & Tenaga Kependidikan
                </h4>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div><span class="text-slate-400 block text-[11px]">Nama Lengkap & Gelar:</span><span class="font-bold text-slate-800 dark:text-white text-sm">${display.name || '-'}</span></div>
                    <div><span class="text-slate-400 block text-[11px]">Jenis Kelamin:</span><span class="font-semibold text-slate-700 dark:text-slate-300">${display.gender === 'L' ? 'Laki-laki (L)' : (sub.gender === 'P' ? 'Perempuan (P)' : '-')}</span></div>
                    <div><span class="text-slate-400 block text-[11px]">NIK (16 Digit):</span><span class="font-mono text-slate-700 dark:text-slate-300">${display.nik || '-'}</span></div>
                    <div><span class="text-slate-400 block text-[11px]">NUPTK:</span><span class="font-mono text-slate-700 dark:text-slate-300">${display.nuptk || '-'}</span></div>
                    <div><span class="text-slate-400 block text-[11px]">NIP (18 Digit):</span><span class="font-mono text-slate-700 dark:text-slate-300">${display.nip || '-'}</span></div>
                    <div><span class="text-slate-400 block text-[11px]">Agama:</span><span class="font-semibold text-slate-700 dark:text-slate-300">${display.agama || '-'}</span></div>
                    <div class="sm:col-span-2"><span class="text-slate-400 block text-[11px]">Tempat, Tanggal Lahir:</span><span class="font-semibold text-slate-700 dark:text-slate-300">${escapeSubmissionHtml(birthInfo)}</span></div>
                </div>
            </div>

            <!-- B. Kepegawaian & Penugasan -->
            <div class="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-xl border border-slate-200 dark:border-slate-700/60">
                <h4 class="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-3 flex items-center gap-1.5 border-b pb-1 dark:border-slate-700">
                    <i class="fa-solid fa-briefcase"></i> B. Kepegawaian & Penugasan
                </h4>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div><span class="text-slate-400 block text-[11px]">Status Kepegawaian:</span><span class="font-bold text-slate-800 dark:text-white">${display.status_kepegawaian || '-'}</span></div>
                    <div><span class="text-slate-400 block text-[11px]">Jenis PTK:</span><span class="font-bold text-slate-800 dark:text-white">${display.jenis_ptk || '-'}</span></div>
                    <div><span class="text-slate-400 block text-[11px]">Tugas Tambahan / Jabatan:</span><span class="font-semibold text-slate-700 dark:text-slate-300">${display.tugas_tambahan || '-'}</span></div>
                </div>
            </div>

            <!-- C. Alamat Domisili -->
            <div class="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-xl border border-slate-200 dark:border-slate-700/60">
                <h4 class="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-3 flex items-center gap-1.5 border-b pb-1 dark:border-slate-700">
                    <i class="fa-solid fa-map-location-dot"></i> C. Alamat Domisili
                </h4>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div class="sm:col-span-2"><span class="text-slate-400 block text-[11px]">Alamat Jalan:</span><span class="font-semibold text-slate-700 dark:text-slate-300">${display.alamat || '-'}</span></div>
                    <div><span class="text-slate-400 block text-[11px]">RT / RW:</span><span class="font-semibold text-slate-700 dark:text-slate-300">${escapeSubmissionHtml(rtrw)}</span></div>
                    <div><span class="text-slate-400 block text-[11px]">Dusun / Banjar:</span><span class="font-semibold text-slate-700 dark:text-slate-300">${display.dusun || '-'}</span></div>
                    <div><span class="text-slate-400 block text-[11px]">Desa / Kelurahan:</span><span class="font-semibold text-slate-700 dark:text-slate-300">${display.kelurahan || '-'}</span></div>
                    <div><span class="text-slate-400 block text-[11px]">Kecamatan:</span><span class="font-semibold text-slate-700 dark:text-slate-300">${display.kecamatan || '-'}</span></div>
                    <div><span class="text-slate-400 block text-[11px]">Kode Pos:</span><span class="font-mono text-slate-700 dark:text-slate-300">${display.kode_pos || '-'}</span></div>
                </div>
            </div>

            <!-- D. Kontak & Integrasi Notifikasi -->
            <div class="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-xl border border-slate-200 dark:border-slate-700/60">
                <h4 class="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-3 flex items-center gap-1.5 border-b pb-1 dark:border-slate-700">
                    <i class="fa-solid fa-phone"></i> D. Kontak & Integrasi Notifikasi
                </h4>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div><span class="text-slate-400 block text-[11px]">No. HP / WhatsApp:</span><span class="font-bold text-emerald-600 dark:text-emerald-400">${display.phone || '-'}</span></div>
                    <div><span class="text-slate-400 block text-[11px]">Email Aktif:</span><span class="font-semibold text-slate-700 dark:text-slate-300">${display.email || '-'}</span></div>
                    <div><span class="text-slate-400 block text-[11px]">Telegram Chat ID:</span><span class="font-mono text-slate-700 dark:text-slate-300">${display.telegram_chat_id || '-'}</span></div>
                </div>
            </div>
        `;
    }

    const modalDetail = document.getElementById('modal-detail-submission');
    if (modalDetail) modalDetail.classList.remove('hidden');
}

async function handleApproveSubmission() {
    if (!activeSubmission) return;
    const confirmed = confirm(`Apakah Anda yakin ingin menyetujui data GTK atas nama "${activeSubmission.name}"?\n\nData akan langsung disimpan ke Master Data GTK SIMAS (D1). Pembuatan akun login dapat dilakukan di menu Manajemen Pengguna.`);
    if (!confirmed) return;

    const btn = document.getElementById('btn-approve-sub');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses...';
    }

    try {
        const res = await cfClient.approveGtkSubmission(activeSubmission.id);
        const modalDetail = document.getElementById('modal-detail-submission');
        if (modalDetail) modalDetail.classList.add('hidden');

        showAlert('Berhasil!', res?.message || `Data GTK "${activeSubmission.name}" berhasil disetujui dan ditambahkan ke Master Data GTK.`, 'success');
        await loadGtk(true);
        await loadSubmissionsList(true);
    } catch (err) {
        console.error('[Approve Submission Error]:', err);
        showAlert('Gagal Menyetujui', err.message || 'Terjadi kesalahan saat menyetujui data pengajuan GTK.', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}

async function handleRejectSubmission() {
    if (!activeSubmission) return;
    const reason = prompt(`Masukkan alasan penolakan pengajuan GTK atas nama "${activeSubmission.name}":`, 'Data tidak sesuai atau tidak lengkap');
    if (reason === null) return; // Dibatalkan

    const btn = document.getElementById('btn-reject-sub');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menolak...';
    }

    try {
        const res = await cfClient.rejectGtkSubmission(activeSubmission.id, reason || 'Data tidak sesuai atau tidak lengkap');
        const modalDetail = document.getElementById('modal-detail-submission');
        if (modalDetail) modalDetail.classList.add('hidden');

        showAlert('Ditolak', res?.message || `Pengajuan data GTK "${activeSubmission.name}" telah ditolak.`, 'success');
        await loadSubmissionsList(true);
    } catch (err) {
        console.error('[Reject Submission Error]:', err);
        showAlert('Gagal Menolak', err.message || 'Terjadi kesalahan saat menolak pengajuan GTK.', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}

// Ekspos ke window
window.openGtkSubmissionsModal = openGtkSubmissionsModal;
window.filterSubmissions = filterSubmissions;
window.loadSubmissionsList = loadSubmissionsList;
window.openSubmissionDetail = openSubmissionDetail;
window.handleApproveSubmission = handleApproveSubmission;
window.handleRejectSubmission = handleRejectSubmission;

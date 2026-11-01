import { SUPABASE_CONFIG, SUPABASE_HEADERS, CLOUDFLARE_CONFIG, APP_VERSION, JURNAL_SYNC_API_KEY, resolvePhotoUrl } from "./config.js";
import { CloudflareAPI } from "./jurnal-cloudflare-api.js";

// Google Apps Script URL untuk upload foto ke Google Drive
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyI2jzx01oTvumQRWA1LDVwT-IGU-SYVlscwrmzUubxYiV_DmsyweHzo5Y6G32ahSFW/exec';

// --- APP STATE ---
let currentClass = null;
let geoCoordinates = null;
let isDrawing = false;
let selectedJp = new Set();
let activeTeachers = [];
let selectedGuruName = '';
let journalMasterTeachers = [];
let journalTeacherRefreshPromise = null;
let isVerifyingJournalTeacher = false;
const JOURNAL_TEACHER_VERIFY_TIMEOUT_MS = 12000;
let journalModeConfigPromise = null;
let hasFreshJournalModeConfig = false;
window.selectedGuruName = '';
window.isModeDaring = false;
window._homeTabSelected = null;

// Satu proses untuk setiap pilihan foto; hasil pilihan lama tidak boleh masuk ke form baru.
let activePhotoUpload = null;
let photoUploadSequence = 0;
let isSubmittingJurnal = false;
const PHOTO_SUBMIT_WAIT_MS = 45000;

// --- UNIVERSAL DATE PARSER ---
function parseUniversalDate(val) {
    if (!val) return null;
    if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
    if (typeof val.toDate === 'function') {
        try {
            const d = val.toDate();
            return (d instanceof Date && !isNaN(d.getTime())) ? d : null;
        } catch (e) { return null; }
    }
    if (typeof val.toMillis === 'function') {
        try {
            const d = new Date(val.toMillis());
            return isNaN(d.getTime()) ? null : d;
        } catch (e) { return null; }
    }
    if (typeof val === 'object') {
        if (typeof val.seconds === 'number') {
            const d = new Date(val.seconds * 1000 + (val.nanoseconds ? Math.floor(val.nanoseconds / 1000000) : 0));
            return isNaN(d.getTime()) ? null : d;
        }
        if (typeof val._seconds === 'number') {
            const d = new Date(val._seconds * 1000 + (val._nanoseconds ? Math.floor(val._nanoseconds / 1000000) : 0));
            return isNaN(d.getTime()) ? null : d;
        }
    }
    if (typeof val === 'string') {
        const trimmed = val.trim();
        if (!trimmed) return null;
        const ymd = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (ymd) {
            return new Date(parseInt(ymd[1], 10), parseInt(ymd[2], 10) - 1, parseInt(ymd[3], 10));
        }
        const dmy = trimmed.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
        if (dmy) {
            return new Date(parseInt(dmy[3], 10), parseInt(dmy[2], 10) - 1, parseInt(dmy[1], 10));
        }
        const parsed = new Date(trimmed);
        return isNaN(parsed.getTime()) ? null : parsed;
    }
    if (typeof val === 'number') {
        const d = new Date(val);
        return isNaN(d.getTime()) ? null : d;
    }
    return null;
}
window.parseUniversalDate = parseUniversalDate;

// --- SAFE LUCIDE HELPER ---
function safeRenderLucide() {
    if (typeof window !== 'undefined' && typeof window.lucide !== 'undefined' && window.lucide && typeof window.lucide.createIcons === 'function') {
        try {
            window.lucide.createIcons();
        } catch (e) {
            console.warn('[Lucide] Failed to render icons:', e);
        }
    }
}

// --- CUSTOM POPUP ---
window.showPopup = function (type, title, message, onConfirm = null, showCancel = false, options = {}) {
    const popup = document.getElementById('custom-popup');
    const content = document.getElementById('popup-content');
    const iconEl = document.getElementById('popup-icon');
    const titleEl = document.getElementById('popup-title');
    const msgEl = document.getElementById('popup-message');
    const teacherEl = document.getElementById('popup-teacher');
    const actionsEl = document.getElementById('popup-actions');

    titleEl.textContent = title;
    msgEl.innerHTML = message;
    teacherEl.innerHTML = '';
    teacherEl.classList.add('hidden');

    if (type === 'success') {
        const teacherProfile = options?.teacherProfile || (options?.teacherName && typeof getTeacherProfile === 'function' ? getTeacherProfile(options.teacherName) : null);
        const photoUrl = teacherProfile ? teacherProfile.photoUrl : (options?.teacherPhoto || '');
        const teacherName = teacherProfile ? teacherProfile.displayName : (options?.teacherName || '');

        if (teacherProfile || photoUrl || teacherName) {
            teacherEl.innerHTML = `
                <div class="inline-flex max-w-full items-center gap-3 text-left">
                    <div class="popup-teacher-avatar shrink-0">${renderTeacherJournalAvatar(photoUrl, teacherName, 'popup', teacherProfile?.teacherId || '')}</div>
                    <div class="min-w-0 break-words">
                        <div>Terima kasih</div>
                        <b>${escapeHTML(options?.teacherName || teacherName)}</b>
                    </div>
                </div>
            `;
            teacherEl.classList.remove('hidden');
        }
        iconEl.className = 'mx-auto mb-4 flex items-center justify-center';
        iconEl.innerHTML = `
            <div class="morph-container">
                <div class="morph-icon-check shadow-lg">
                    <i data-lucide="check" class="w-9 h-9"></i>
                </div>
                <div class="morph-icon-logo">
                    <img src="assets/logo-sekolah.png" alt="Logo Sekolah" class="w-[4.5rem] h-[4.5rem] object-contain drop-shadow-lg">
                </div>
            </div>
        `;
    } else if (type === 'error') {
        iconEl.className = 'w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center text-white text-3xl shadow-lg bg-red-500';
        iconEl.innerHTML = '<i data-lucide="x" class="w-8 h-8"></i>';
    } else if (type === 'confirm') {
        iconEl.className = 'w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center text-white text-3xl shadow-lg bg-blue-500';
        iconEl.innerHTML = '<i data-lucide="help-circle" class="w-8 h-8"></i>';
    }

    let buttonsHtml = '';
    if (showCancel) {
        buttonsHtml += `<button id="btn-popup-cancel" class="px-6 py-3 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-bold hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">Batal</button>`;
    }
    buttonsHtml += `<button id="btn-popup-ok" class="px-6 py-3 rounded-xl bg-gray-900 dark:bg-blue-600 text-white font-bold hover:bg-gray-800 dark:hover:bg-blue-700 shadow-lg transform active:scale-95 transition-all">Oke</button>`;
    actionsEl.innerHTML = buttonsHtml;

    popup.classList.remove('pointer-events-none', 'opacity-0');
    content.classList.remove('scale-95');
    content.classList.add('scale-100');
    safeRenderLucide();

    document.getElementById('btn-popup-ok').onclick = () => {
        closePopup();
        if (onConfirm) onConfirm();
    };

    if (showCancel) document.getElementById('btn-popup-cancel').onclick = closePopup;
}

function closePopup() {
    const popup = document.getElementById('custom-popup');
    const content = document.getElementById('popup-content');
    popup.classList.add('opacity-0', 'pointer-events-none');
    content.classList.add('scale-95');
    content.classList.remove('scale-100');
}

window.showToast = function (title, message, type = 'info') {
    const existing = document.getElementById('app-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'app-toast';
    const colors = {
        info: 'bg-gray-900 text-white',
        success: 'bg-green-600 text-white',
        warning: 'bg-yellow-500 text-white',
        error: 'bg-red-600 text-white'
    };
    toast.className = `fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-semibold ${colors[type] || colors.info}`;
    toast.innerHTML = `<div class="font-bold mb-0.5">${title}</div><div class="text-xs opacity-90">${message}</div>`;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

// --- HELPER RENDER LIST REKAP ---
function parseJpArray(jp) {
    if (!jp && jp !== 0) return [];
    if (Array.isArray(jp)) return jp.map(Number).filter(n => !isNaN(n) && n >= 1 && n <= 10);
    if (typeof jp === 'number') return jp >= 1 && jp <= 10 ? [jp] : [];
    if (typeof jp === 'string') {
        const trimmed = jp.trim();
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed)) return parsed.map(Number).filter(n => !isNaN(n) && n >= 1 && n <= 10);
            } catch(e) {}
        }
        if (trimmed.includes('-')) {
            const parts = trimmed.split('-').map(p => parseInt(p.trim(), 10));
            if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                const res = [];
                for (let i = Math.min(parts[0], parts[1]); i <= Math.max(parts[0], parts[1]); i++) {
                    if (i >= 1 && i <= 10) res.push(i);
                }
                return res;
            }
        }
        if (trimmed.includes(',')) {
            return trimmed.split(',').map(p => parseInt(p.trim(), 10)).filter(n => !isNaN(n) && n >= 1 && n <= 10);
        }
        const num = parseInt(trimmed, 10);
        if (!isNaN(num) && num >= 1 && num <= 10) return [num];
    }
    return [];
}

function formatJpString(jp) {
    const list = parseJpArray(jp);
    if (list.length === 0) return typeof jp === 'string' ? jp : '-';
    if (list.length === 1 || Math.min(...list) === Math.max(...list)) return `${list[0]}`;
    return `${Math.min(...list)}-${Math.max(...list)}`;
}

function renderRecapListUI(docs, selectedClass, list, isTruncated = false) {
    if (!list) return;
    if (!docs || docs.length === 0) {
        list.innerHTML = '<tr><td colspan="3" class="p-8 text-center text-gray-400">Tidak ada pengisian jurnal sesuai filter.</td></tr>';
        return;
    }

    let html = '';
    docs.forEach(data => {
        const jpStr = formatJpString(data.jp);

        const classBadgeHtml = selectedClass ? '' : `<span class="bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded text-[10px] font-bold">${data.kelas || '?'}</span>`;

        html += `
        <tr class="hover:bg-blue-50/50 dark:hover:bg-gray-800/50 transition border-b border-gray-50 dark:border-gray-700 last:border-0">
            <td class="p-2 sm:p-3 w-16 align-top">
                <div class="flex flex-col items-start gap-1">
                    ${classBadgeHtml}
                    <span class="text-[9px] font-bold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded whitespace-nowrap">${jpStr}</span>
                </div>
            </td>
            <td class="p-2 sm:p-3 text-[11px] sm:text-xs font-bold text-gray-800 dark:text-gray-200 align-top">${data.guru || 'Guru'}</td>
            <td class="p-2 sm:p-3 align-top">
                <div class="flex items-start justify-between">
                    <div>
                        <div class="text-[11px] sm:text-xs font-bold text-gray-800 dark:text-gray-200 mb-0.5 leading-tight">${data.mapel || '-'}</div>
                        <div class="text-[9px] sm:text-[10px] text-gray-500 dark:text-gray-400 break-words max-w-[150px] leading-tight">${data.topik || '-'}</div>
                    </div>
                    <button onclick="editJurnal('${data.id}')" class="p-1.5 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-800/50 text-blue-600 dark:text-blue-400 rounded transition whitespace-nowrap" title="Edit Jurnal">
                        <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
                    </button>
                </div>
            </td>
        </tr>`;
    });

    if (isTruncated) {
        html += `
        <tr>
            <td colspan="3" class="p-3 text-center bg-gray-50/70 dark:bg-gray-800/70">
                <button onclick="window.loadDailyRecap(true, true)" class="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1">
                    <i data-lucide="chevron-down" class="w-3.5 h-3.5"></i> Tampilkan Seluruh Jurnal Hari Ini
                </button>
            </td>
        </tr>`;
    }

    list.innerHTML = html;
    safeRenderLucide();
}

// --- DAILY RECAP (PUBLIC & SMART SWR CACHE) ---
window.loadDailyRecap = async function (forceRefresh = false, fetchAll = false) {
    const list = document.getElementById('list-rekap-home');
    const dateEl = document.getElementById('recap-date');
    if (!list || !dateEl) return;

    const filterClassSelect = document.getElementById('filter-class');
    const selectedClass = filterClassSelect ? filterClassSelect.value : '';

    // Secara paten menargetkan Hari Ini
    const targetDate = new Date();
    const todayYMD = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;

    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    dateEl.textContent = targetDate.toLocaleDateString('id-ID', options);

    const cacheKey = `rekap_jurnal_${todayYMD}_${selectedClass || 'ALL'}${fetchAll ? '_ALL_RECORDS' : ''}`;
    const RECAP_CACHE_TTL = 3 * 60 * 1000; // 3 menit smart cache (SWR)

    // Cek cache lokal jika bukan forceRefresh
    if (!forceRefresh) {
        const cached = CacheHelper.get(cacheKey, RECAP_CACHE_TTL);
        if (cached && Array.isArray(cached)) {
            console.log(`⚡ [Cache Hit] Rekap hari ini dimuat dari cache lokal (0 Read) untuk ${selectedClass || 'Semua Kelas'}`);
            window.recapDocs = cached;
            renderRecapListUI(cached, selectedClass, list, !fetchAll && !selectedClass && cached.length >= 40);
            return;
        }
    }

    try {
        list.innerHTML = '<tr><td colspan="3" class="p-8 text-center"><i data-lucide="loader-2" class="w-6 h-6 mx-auto animate-spin text-blue-500 mb-2"></i><p class="text-xs text-gray-400">Memuat data...</p></td></tr>';
        safeRenderLucide();

        let docs = [];
        let fetchedFromCloudflare = false;

        // Pengambilan dari Cloudflare D1 Serverless SQL (0 Firestore Read)
        if (CloudflareAPI.isEnabled) {
            try {
                const yyyy = targetDate.getFullYear();
                const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
                const dd = String(targetDate.getDate()).padStart(2, '0');
                const dStr = `${yyyy}-${mm}-${dd}`;

                const params = { date: dStr };
                if (selectedClass) params.class = selectedClass;
                if (!fetchAll && !selectedClass) params.limit = 40;

                const cfDocs = await CloudflareAPI.getRecap(params);
                if (Array.isArray(cfDocs)) {
                    docs = cfDocs;
                    console.log(`⚡ [Cloudflare D1] Sukses memuat ${docs.length} rekap jurnal hari ini (0 Firestore Read).`);
                }
            } catch (cfErr) {
                console.error("[Cloudflare D1] Gagal memuat rekap jurnal:", cfErr);
            }
        }

        window.recapDocs = docs; // Simpan di global untuk diakses editJurnal
        CacheHelper.set(cacheKey, docs);

        renderRecapListUI(docs, selectedClass, list, !fetchAll && !selectedClass && docs.length >= 40);

    } catch (e) {
        console.error("Error load recap:", e);
        list.innerHTML = '<tr><td colspan="3" class="p-8 text-center text-red-400">Gagal memuat data. Periksa koneksi atau index database.</td></tr>';
    }
};

window.refreshDailyRecap = function (force = true) {
    if (typeof showToast === 'function') {
        showToast("Memperbarui Rekap", "Mengambil data jurnal hari ini...", "info");
    }
    window.loadDailyRecap(force);
};

window.refreshData = function () {
    window.refreshDailyRecap(true);
};

// --- AUTO LOGIN CHECK (QR CODE) ---
window.editJurnal = function (docId) {
    if (isSubmittingJurnal) return;
    if (!window.recapDocs) return;
    const docData = window.recapDocs.find(d => d.id === docId);
    if (!docData) return;

    discardPhotoUpload();

    window.currentEditDocId = docId;
    window.currentEditData = docData;

    // Masuk ke mode Edit: Pindah tampilan ke form
    document.getElementById('screen-scan').classList.add('hidden');
    document.getElementById('screen-form').classList.remove('hidden');

    // Kosongkan Canvas TTD sementara karena TTD harus digambar ulang saat diubah, atau dibiarkan kosong
    if (typeof window.clearCanvas === 'function') window.clearCanvas();
    const ttdOptLabel = document.getElementById('ttd-optional-label');
    if (ttdOptLabel) ttdOptLabel.classList.remove('hidden');

    // Injeksi/Pilih Mapel secara manual jika belum ada
    const mapelSelect = document.getElementById('input-mapel');
    let hasMapel = Array.from(mapelSelect.options).some(opt => opt.value === docData.mapel);
    if (!hasMapel) {
        mapelSelect.innerHTML += `<option value="${docData.mapel}">${docData.mapel}</option>`;
    }
    mapelSelect.value = docData.mapel;
    if (typeof checkManualMapel === 'function') checkManualMapel();

    // Isi Form
    document.getElementById('input-topik').value = docData.topik || '';
    document.getElementById('input-catatan').value = docData.catatan || '';

    // Privasi mode edit: jangan tampilkan foto lama ke UI, tapi simpan URL lama di state
    // agar field foto_url tetap dianggap ada tanpa perlu ditampilkan ulang.
    const prevCont = document.getElementById('preview-container');
    const photoBtns = document.getElementById('photo-buttons');
    const uploadBadge = document.getElementById('upload-status-badge');
    const fileCamera = document.getElementById('file-camera');
    if (document.getElementById('image-preview')) {
        document.getElementById('image-preview').src = '';
    }
    prevCont.classList.add('hidden');
    photoBtns.classList.add('hidden');
    if (uploadBadge) uploadBadge.classList.add('hidden');
    if (fileCamera) fileCamera.disabled = true;
    window.uploadedFotoUrl = docData.foto_url || null;
    window.uploadedFotoObj = null;

    // Ubah UI Navbar & Text Form
    document.getElementById('header-class-name').textContent = `Edit Jurnal ${docData.kelas}`;
    currentClass = { name: docData.kelas };

    // Panggil selectClass untuk memuat ulang daftar siswa dari cache
    selectClass(docData.kelas);
}

function releaseQrDeepLinkView() {
    document.documentElement.classList.remove('qr-deeplink');
}

async function handleQrDeepLink() {
    window.__qrDeepLinkStarted = true;
    const urlParams = new URLSearchParams(window.location.search);
    const encodedClass = urlParams.get('c') || urlParams.get('kelas') || urlParams.get('class');

    if (!encodedClass) {
        releaseQrDeepLinkView();
        return;
    }

    try {
        await fetchAppConfig();
        let targetClass = null;
        try {
            const decodedString = atob(encodedClass);
            const parts = decodedString.split('|');
            if (parts.length >= 3) {
                targetClass = parts[1];
            } else {
                targetClass = decodedString;
            }
        } catch (b64Err) {
            targetClass = encodedClass;
        }

        if (targetClass) {
            targetClass = targetClass.trim();
            // Normalisasi format titik (misal X.1 -> X-1) jika ada pada stiker lama
            if (/^(X|XI|XII)\.[0-9]+$/i.test(targetClass)) {
                targetClass = targetClass.replace(/\./g, '-');
            }
            console.log("Auto-login class from QR:", targetClass);
            const btnBack = document.getElementById('btn-back');
            if (btnBack) btnBack.style.display = 'none';
            // selectClass langsung menukar screen-scan -> screen-form secara sinkron,
            // jadi flag tampilan QR aman dilepas setelah pemanggilan ini.
            selectClass(targetClass);
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    } catch (e) {
        console.error("Kode QR Tidak Valid:", e);
        showPopup('error', 'Error', 'Kode QR tidak valid/rusak.');
    } finally {
        releaseQrDeepLinkView();
    }
}

// --- CACHE UTILITY ---
const CacheHelper = {
    expiry: 24 * 60 * 60 * 1000,
    get: (key, customExpiry) => {
        try {
            const item = localStorage.getItem(key);
            if (!item) return null;
            const parsed = JSON.parse(item);
            if (!parsed || typeof parsed !== 'object' || !('data' in parsed)) {
                return null;
            }
            const exp = (customExpiry !== undefined) ? customExpiry : CacheHelper.expiry;
            if (exp !== Infinity && (Date.now() - (parsed.timestamp || 0) > exp)) {
                localStorage.removeItem(key);
                return null;
            }
            return parsed.data;
        } catch (e) {
            return null;
        }
    },
    set: (key, data) => {
        try {
            const item = { data: data, timestamp: Date.now() };
            localStorage.setItem(key, JSON.stringify(item));
        } catch (e) {
            console.warn("Storage quota exceeded or storage error:", e);
        }
    },
    remove: (key) => {
        try {
            localStorage.removeItem(key);
        } catch (e) { }
    },
    clear: () => {
        localStorage.clear();
        location.reload();
    }
};

function sortSchoolClasses(classes) {
    if (!Array.isArray(classes)) return [];
    const getGradeRank = (c) => {
        const u = String(c || '').trim().toUpperCase();
        if (u.startsWith('XII')) return 12;
        if (u.startsWith('XI')) return 11;
        if (u.startsWith('X')) return 10;
        return 99;
    };
    return classes.filter(c => {
        if (!c || typeof c !== 'string') return false;
        const u = c.trim().toUpperCase();
        if (u.startsWith('ALUMNI') || u.startsWith('KELUAR') || u.startsWith('LULUS') || u.startsWith('DROP') || u.startsWith('MUTASI')) {
            return false;
        }
        return u.startsWith('X-') || u.startsWith('XI-') || u.startsWith('XII-') || 
               u.startsWith('X.') || u.startsWith('XI.') || u.startsWith('XII.') ||
               u.startsWith('X ') || u.startsWith('XI ') || u.startsWith('XII ');
    }).sort((a, b) => {
        const rankA = getGradeRank(a);
        const rankB = getGradeRank(b);
        if (rankA !== rankB) return rankA - rankB;
        return a.localeCompare(b, 'id', { numeric: true });
    });
}

function naturalSort(a, b) {
    return a.localeCompare(b, 'id', { numeric: true, sensitivity: 'base' });
}

// --- APP CONFIG (MODE DARING / PJJ) ---
function applyJournalModeConfig(mode, persist = true) {
    if (typeof mode !== 'boolean') return;
    const changed = window.isModeDaring !== mode;
    window.isModeDaring = mode;
    if (persist) {
        hasFreshJournalModeConfig = true;
        CacheHelper.set('app_mode_daring_config', mode);
    }
    applyModeDaringUI();
    const form = document.getElementById('screen-form');
    if (changed && currentClass && form && !form.classList.contains('hidden') && !window.currentEditDocId) {
        geoCoordinates = null;
        if (typeof window.getSilentLocation === 'function') window.getSilentLocation();
    }
}

async function fetchAppConfig() {
    // Cache hanya untuk tampilan awal/fallback. Status operasional dibaca segar
    // dari endpoint kecil agar tidak tertahan cache bundle guru selama 15 menit.
    const cachedMode = CacheHelper.get('app_mode_daring_config', 10 * 60 * 1000);
    if (!hasFreshJournalModeConfig && typeof cachedMode === 'boolean') window.isModeDaring = cachedMode;
    applyModeDaringUI();
    if (!CloudflareAPI.isEnabled) return;
    if (journalModeConfigPromise) return journalModeConfigPromise;
    const request = (async () => {
        let timer;
        try {
            const json = await Promise.race([
                (async () => {
                    const headers = await CloudflareAPI.getHeaders();
                    const response = await fetchWithTimeout(`${CloudflareAPI.baseUrl}/api/jurnal/settings?refresh=1`, { headers, cache: 'no-store' }, 12000);
                    if (!response.ok) throw new Error(`HTTP ${response.status} membaca mode jurnal`);
                    const data = await response.json();
                    if (data.success === false || !data.data || typeof data.data !== 'object' || Array.isArray(data.data) ||
                        data.data.mode_daring !== undefined && typeof data.data.mode_daring !== 'boolean') throw new Error('Pengaturan jurnal tidak valid');
                    return data;
                })(),
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error('Batas waktu membaca mode jurnal')), 12000);
                })
            ]);
            // Setting yang belum pernah dibuat di server berarti mode normal.
            applyJournalModeConfig(json.data.mode_daring === undefined ? false : json.data.mode_daring);
        } catch (error) {
            // Pertahankan mode terakhir; gangguan jaringan bukan keputusan luring baru.
            console.warn('[Config] Memakai mode jurnal terakhir:', error);
        } finally {
            clearTimeout(timer);
        }
    })();
    journalModeConfigPromise = request;
    try {
        await request;
    } finally {
        if (journalModeConfigPromise === request) journalModeConfigPromise = null;
    }
}

function applyModeDaringUI() {
    const bannerDaring = document.getElementById('banner-daring-mode');
    const tabNavDaring = document.getElementById('daring-tab-nav');
    const viewDaring = document.getElementById('view-daring-classes');
    const viewRekap = document.getElementById('view-recap-today');
    const appSubtitle = document.getElementById('app-subtitle');
    const scanInstruction = document.getElementById('instruction-scan-qr');
    const urlParams = new URLSearchParams(window.location.search);
    const hasQrParam = Boolean(urlParams.get('c'));

    if (window.isModeDaring && !hasQrParam) {
        if (bannerDaring) {
            bannerDaring.classList.remove('hidden');
            bannerDaring.classList.add('flex');
        }
        if (tabNavDaring) {
            tabNavDaring.classList.remove('hidden');
            tabNavDaring.classList.add('flex');
        }
        if (appSubtitle) {
            appSubtitle.textContent = 'Pembelajaran Jarak Jauh (PJJ)';
        }
        if (scanInstruction) {
            scanInstruction.classList.add('hidden');
        }
        // Default ke Tab Daring jika belum ada pemilihan tab manual
        if (!window._homeTabSelected || window._homeTabSelected === 'daring') {
            switchHomeTab('daring');
        }
    } else {
        if (bannerDaring) {
            bannerDaring.classList.add('hidden');
            bannerDaring.classList.remove('flex');
        }
        if (tabNavDaring) {
            tabNavDaring.classList.add('hidden');
            tabNavDaring.classList.remove('flex');
        }
        if (viewDaring) {
            viewDaring.classList.add('hidden');
        }
        if (viewRekap) {
            viewRekap.classList.remove('hidden');
        }
        if (appSubtitle) {
            appSubtitle.textContent = 'Rekapitulasi Pengisian Hari Ini';
        }
        if (scanInstruction) {
            scanInstruction.classList.remove('hidden');
        }
    }
    // Selaraskan pemilih foto juga ketika konfigurasi berubah setelah form dibuka.
    const fileCam = document.getElementById('file-camera');
    if (fileCam) {
        if (window.isModeDaring) fileCam.removeAttribute('capture');
        else fileCam.setAttribute('capture', 'environment');
    }
    const photoBtnText = document.getElementById('photo-btn-text');
    const photoBtnSubtext = document.getElementById('photo-btn-subtext');
    if (photoBtnText) photoBtnText.textContent = window.isModeDaring ? 'Pilih Galeri' : 'Kamera HD';
    if (photoBtnSubtext) photoBtnSubtext.textContent = window.isModeDaring ? 'Upload File / Galeri 🖼️' : 'Kamera Utama 📸';
    safeRenderLucide();
}

window.switchHomeTab = function (tab) {
    window._homeTabSelected = tab;
    const btnDaring = document.getElementById('btn-tab-pilih-kelas');
    const btnRekap = document.getElementById('btn-tab-rekap-hari-ini');
    const viewDaring = document.getElementById('view-daring-classes');
    const viewRekap = document.getElementById('view-recap-today');

    if (tab === 'daring') {
        if (viewDaring) viewDaring.classList.remove('hidden');
        if (viewRekap) viewRekap.classList.add('hidden');
        if (btnDaring) btnDaring.className = "flex-1 py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm";
        if (btnRekap) btnRekap.className = "flex-1 py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white";
    } else {
        if (viewDaring) viewDaring.classList.add('hidden');
        if (viewRekap) viewRekap.classList.remove('hidden');
        if (btnRekap) btnRekap.className = "flex-1 py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm";
        if (btnDaring) btnDaring.className = "flex-1 py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white";
        window.loadDailyRecap();
    }
    safeRenderLucide();
};

// --- LOAD CLASSES ---
async function loadClasses() {
    try {
        await fetchAppConfig();
        const container = document.getElementById('class-list-container');
        let sortedClasses = CacheHelper.get('master_kelas_list');

        if (sortedClasses && Array.isArray(sortedClasses)) {
            sortedClasses = sortSchoolClasses(sortedClasses);
        }

        if (!sortedClasses || !Array.isArray(sortedClasses) || sortedClasses.length === 0) {
            try {
                if (CloudflareAPI.isEnabled) {
                    try {
                        console.log("Mengambil Daftar Kelas dari Cloudflare D1 Master Bundle...");
                        const bundle = await CloudflareAPI.getMasterBundle();
                        if (bundle && Array.isArray(bundle.classes) && bundle.classes.length > 0) {
                            sortedClasses = sortSchoolClasses(bundle.classes);
                            CacheHelper.set('master_kelas_list', sortedClasses);
                            console.log(`⚡ [Cloudflare D1] Sukses memuat ${sortedClasses.length} kelas aktif.`);
                        }
                    } catch (cfErr) {
                        console.error("[Cloudflare D1] Gagal memuat master kelas:", cfErr);
                    }
                }
            } catch (netError) {
                console.error("Gagal fetch kelas:", netError);
                const rawCache = localStorage.getItem('master_kelas_list');
                if (rawCache) {
                    try {
                        const parsed = JSON.parse(rawCache);
                        if (parsed && parsed.data && Array.isArray(parsed.data)) {
                            sortedClasses = sortSchoolClasses(parsed.data);
                            console.warn("Using stale cache for classes due to offline.");
                            showToast("Offline Mode", "Menggunakan data kelas yang tersimpan lokal.", "warning");
                        }
                    } catch (e) { }
                }
            }
        } else {
            console.log("Menggunakan Data Kelas dari Cache");
        }

        // Fallback default kelas sekolah aktif jika bundle dan cache offline kosong
        if (!sortedClasses || !Array.isArray(sortedClasses) || sortedClasses.length === 0) {
            sortedClasses = [
                'X-1', 'X-2', 'X-3', 'X-4', 'X-5', 'X-6', 'X-7', 'X-8', 'X-9',
                'XI-1', 'XI-2', 'XI-3', 'XI-4', 'XI-5', 'XI-6', 'XI-7', 'XI-8', 'XI-9', 'XI-10',
                'XII-1', 'XII-2', 'XII-3', 'XII-4', 'XII-5', 'XII-6'
            ];
            CacheHelper.set('master_kelas_list', sortedClasses);
        }

        const filterClassDropdown = document.getElementById('filter-class');
        if (filterClassDropdown) {
            let optionsHtml = '<option value="">Semua Kelas</option>';
            sortedClasses.forEach(c => {
                optionsHtml += `<option value="${c}">${c}</option>`;
            });
            filterClassDropdown.innerHTML = optionsHtml;
            filterClassDropdown.onchange = () => {
                window.loadDailyRecap();
            };

            // Auto trigger load if no QR deep link is being processed
            const urlParams = new URLSearchParams(window.location.search);
            if (!urlParams.get('c')) {
                window.loadDailyRecap();
            }
        }

        let html = '';
        if (sortedClasses.length === 0) {
            container.innerHTML = '<p class="text-center text-gray-400">Tidak ada kelas ditemukan.</p>';
            return;
        }

        sortedClasses.forEach((cls, index) => {
            const colorClasses = [
                'bg-blue-100 text-blue-600 group-hover:bg-blue-600 group-hover:text-white',
                'bg-purple-100 text-purple-600 group-hover:bg-purple-600 group-hover:text-white',
                'bg-pink-100 text-pink-600 group-hover:bg-pink-600 group-hover:text-white',
                'bg-orange-100 text-orange-600 group-hover:bg-orange-600 group-hover:text-white',
                'bg-teal-100 text-teal-600 group-hover:bg-teal-600 group-hover:text-white'
            ];
            const colorClass = colorClasses[index % colorClasses.length];
            const room = "R.Kelas";

            html += `
            <button onclick="selectClass('${cls}')"
                class="w-full bg-white/60 dark:bg-gray-800/60 hover:bg-white dark:hover:bg-gray-800 backdrop-blur-sm border border-white/50 dark:border-gray-700 p-4 rounded-2xl flex items-center justify-between group transition-all duration-300 hover:shadow-lg hover:-translate-y-1">
                <div class="flex items-center gap-4">
                    <div class="${colorClass} p-3 rounded-xl transition-colors">
                        <i data-lucide="users" class="w-6 h-6"></i>
                    </div>
                    <div class="text-left">
                        <div class="font-bold text-gray-800 dark:text-gray-100 text-lg">${cls}</div>
                        <div class="text-xs font-medium text-gray-500 dark:text-gray-400 flex items-center gap-1">
                            <i data-lucide="map-pin" class="w-3 h-3"></i> ${room}
                        </div>
                    </div>
                </div>
                <div class="w-8 h-8 rounded-full bg-gray-50 dark:bg-gray-900/50 flex items-center justify-center group-hover:bg-gray-100 dark:group-hover:bg-gray-700 transition-colors">
                    <i data-lucide="arrow-right" class="w-4 h-4 text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-200"></i>
                </div>
            </button>`;
        });

        container.innerHTML = html;

        // Render Daring Class Grid
        const daringGrid = document.getElementById('daring-class-grid');
        const daringCountBadge = document.getElementById('daring-total-classes-badge');
        if (daringCountBadge) daringCountBadge.textContent = `${sortedClasses.length} Kelas`;
        if (daringGrid) {
            let dGridHtml = '';
            sortedClasses.forEach((cls) => {
                dGridHtml += `
                <button onclick="selectClass('${cls}')"
                    class="bg-white/90 dark:bg-gray-800/90 hover:bg-blue-600 hover:text-white dark:hover:bg-blue-600 border border-gray-100 dark:border-gray-700 p-3 rounded-2xl flex flex-col items-center justify-center text-center group transition-all duration-200 hover:shadow-md active:scale-95 shadow-sm">
                    <div class="w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 group-hover:bg-white/20 group-hover:text-white flex items-center justify-center mb-1 transition-colors">
                        <i data-lucide="users" class="w-4 h-4"></i>
                    </div>
                    <span class="font-bold text-sm text-gray-800 dark:text-gray-100 group-hover:text-white">${cls}</span>
                    <span class="text-[10px] text-gray-400 dark:text-gray-500 group-hover:text-blue-100 flex items-center gap-0.5 mt-0.5"><i data-lucide="wifi" class="w-2.5 h-2.5"></i> Daring</span>
                </button>`;
            });
            daringGrid.innerHTML = dGridHtml;
        }

        applyModeDaringUI();
        safeRenderLucide();

    } catch (e) {
        console.error("Gagal memuat kelas:", e);
        document.getElementById('class-list-container').innerHTML = '<p class="text-center text-red-400">Gagal memuat data kelas.</p>';
    }
}

// --- ENSURE MASTER DATA WITH SYSTEM VERSIONING ---
async function checkSystemVersionAndInvalidateCache() {
    try {
        const localAppVersion = localStorage.getItem('app_installed_version');
        const isAppVersionChanged = localAppVersion && localAppVersion !== APP_VERSION;

        // Throttling pemeriksaan server cloud: cek maksimal 1x per 10 menit per tab sesi browser
        const SYS_CHECK_INTERVAL = 10 * 60 * 1000;
        const lastCheck = sessionStorage.getItem('last_sys_check_ts');
        const now = Date.now();
        const shouldCheckServer = !lastCheck || (now - Number(lastCheck) > SYS_CHECK_INTERVAL);

        let isServerSyncChanged = false;
        let serverSync = null;

        if (shouldCheckServer) {
            try {
                if (CloudflareAPI.isEnabled) {
                    const bundle = await CloudflareAPI.getMasterBundle();
                    if (bundle && bundle.settings && bundle.settings.version) {
                        serverSync = bundle.settings.version;
                    }
                }
                const localSync = localStorage.getItem('last_synced_version');
                isServerSyncChanged = serverSync && localSync !== String(serverSync);
                sessionStorage.setItem('last_sys_check_ts', String(now));
            } catch (netErr) {
                console.warn("Pengecekan server sync version dilewati:", netErr);
            }
        }

        if (isAppVersionChanged || isServerSyncChanged) {
            console.log(`🔥 Pembaruan sistem terdeteksi (App: v${APP_VERSION}, Cloud: ${serverSync || 'Local Bump'})! Membersihkan cache lokal...`);
            Object.keys(localStorage).forEach(k => {
                if (
                    k.startsWith('data_siswa_') ||
                    k === 'master_kelas_list' ||
                    k === 'data_guru' ||
                    k === 'data_mapel' ||
                    k === 'data_lokasi' ||
                    k.startsWith('jurnal_schedule_') ||
                    k === 'daftar_motivasi_cache' ||
                    k.startsWith('motivasi_') ||
                    k.startsWith('rekap_jurnal_') ||
                    k === 'app_mode_daring_config'
                ) {
                    localStorage.removeItem(k);
                }
            });
            cachedScheduleData = null;
            if (serverSync) localStorage.setItem('last_synced_version', String(serverSync));
            localStorage.setItem('app_installed_version', APP_VERSION);
        } else if (!localAppVersion) {
            localStorage.setItem('app_installed_version', APP_VERSION);
        }
    } catch (e) {
        console.warn("Pengecekan versi sistem dilewati:", e);
    }
    await fetchAppConfig();
}

async function ensureMasterData() {
    try {
        // Cek apakah admin baru saja sync data di cloud
        await checkSystemVersionAndInvalidateCache();

        // Salinan lama (abaikan kedaluwarsa) diambil sebelum CacheHelper.get menghapusnya,
        // untuk dipakai hanya jika server tidak bisa dihubungi.
        const staleMasterCache = {
            data_guru: CacheHelper.get('data_guru', Infinity),
            data_mapel: CacheHelper.get('data_mapel', Infinity),
            data_lokasi: CacheHelper.get('data_lokasi', Infinity)
        };

        let guruCache = getJournalMasterTeachers();
        let mapelCache = CacheHelper.get('data_mapel');
        let lokasiCache = CacheHelper.get('data_lokasi');

        const hasBkInCache = Array.isArray(guruCache) && guruCache.some(t => isGuruBk(t));
        const needsGuru = !guruCache || !Array.isArray(guruCache) || guruCache.length === 0 || !hasBkInCache;
        const needsMapel = !mapelCache || !Array.isArray(mapelCache) || mapelCache.length === 0;
        const needsLokasi = !lokasiCache || !Array.isArray(lokasiCache) || lokasiCache.length === 0;

        if (needsGuru || needsMapel || needsLokasi) {
            let fetchedBundle = false;
            if (CloudflareAPI.isEnabled) {
                try {
                    console.log("Fetching Master Data Bundle from Cloudflare D1...");
                    const bundle = await CloudflareAPI.getMasterBundle();
                    if (bundle) {
                        if (bundle.teachers && bundle.teachers.length > 0) {
                            rememberJournalTeachers(bundle.teachers);
                            CacheHelper.set('data_guru', bundle.teachers);
                            guruCache = bundle.teachers;
                        }
                        if (bundle.mapels && bundle.mapels.length > 0) {
                            CacheHelper.set('data_mapel', bundle.mapels);
                            mapelCache = bundle.mapels;
                        }
                        if (bundle.lokasis && bundle.lokasis.length > 0) {
                            CacheHelper.set('data_lokasi', bundle.lokasis);
                            lokasiCache = bundle.lokasis;
                        }
                        if (bundle.classes && bundle.classes.length > 0) {
                            CacheHelper.set('master_kelas_list', sortSchoolClasses(bundle.classes));
                        }
                        if (bundle.motivasi && bundle.motivasi.length > 0) {
                            CacheHelper.set('daftar_motivasi_cache', bundle.motivasi);
                        }
                        // Bundle tetap boleh membantu saat pembacaan konfigurasi gagal,
                        // tetapi tidak menimpa status terverifikasi atau memperpanjang cache mode lama.
                        if (!hasFreshJournalModeConfig && typeof bundle.mode_daring === 'boolean' && typeof CacheHelper.get('app_mode_daring_config') !== 'boolean') {
                            applyJournalModeConfig(bundle.mode_daring, false);
                        }
                        fetchedBundle = true;
                        console.log("⚡ [Cloudflare D1] Sukses memuat seluruh Master Bundle dalam 1 request.");
                    }
                } catch (cfErr) {
                    console.error("[Cloudflare D1] Gagal mengambil Master Bundle:", cfErr);
                }
            }

            if (!fetchedBundle) {
                let restoredStale = false;
                Object.entries(staleMasterCache).forEach(([key, staleData]) => {
                    const current = CacheHelper.get(key);
                    if (Array.isArray(current) && current.length > 0) return;
                    if (!Array.isArray(staleData) || staleData.length === 0) return;
                    try {
                        // Timestamp dibuat hampir kedaluwarsa agar data segar dicoba lagi dalam 10 menit
                        localStorage.setItem(key, JSON.stringify({
                            data: staleData,
                            timestamp: Date.now() - CacheHelper.expiry + 10 * 60 * 1000
                        }));
                        restoredStale = true;
                    } catch (e) { }
                });

                const hasGuruNow = getJournalMasterTeachers().length > 0;
                if (restoredStale) {
                    console.warn("[Master Data] Server tidak terjangkau, memakai data guru/mapel/lokasi tersimpan.");
                } else if (!hasGuruNow && typeof window.showToast === 'function') {
                    window.showToast("Koneksi Lambat", "Data guru gagal dimuat dari server. Muat ulang halaman atau coba pindah ke WiFi.", "warning");
                }
            }
        }

        const allTeachers = getJournalMasterTeachers();
        allTeachers.forEach(t => {
            if (!t.foto && t.id) {
                t.foto = `/api/photos/gtk/${t.id}.webp`;
                t.photo_url = t.foto;
            }
        });
        CacheHelper.set('data_guru', allTeachers);
        rememberJournalTeachers(allTeachers);

    } catch (e) {
        console.error("Ensuring Master Data Failed", e);
    }
}

async function renderMasterDataUI() {
    await ensureMasterData();
    const scheduleData = await loadAndParseScheduleXML();

    // --- RENDER LOKASI ---
    const selectLokasi = document.getElementById('input-lokasi');
    let locs = CacheHelper.get('data_lokasi') || [];
    locs.sort((a, b) => (a.urutan || 9999) - (b.urutan || 9999));

    let htmlLokasi = '';
    locs.forEach(data => htmlLokasi += `<option value="${data.nama_lokasi}">${data.nama_lokasi}</option>`);
    if (!htmlLokasi) htmlLokasi = '<option value="Ruang Kelas">Ruang Kelas (Default)</option>';
    selectLokasi.innerHTML = htmlLokasi;
    
    // Set default value sesuai Mode Daring / Normal
    if (window.isModeDaring) {
        let hasDaring = Array.from(selectLokasi.options).some(o => o.value.toLowerCase().includes('daring'));
        if (!hasDaring) {
            selectLokasi.innerHTML = `<option value="Daring (PJJ)">Daring (PJJ)</option>` + selectLokasi.innerHTML;
        }
        selectLokasi.value = "Daring (PJJ)";
    } else {
        selectLokasi.value = "Ruang Kelas";
    }

    // --- RENDER MAPEL (Strictly dari Acuan Resmi Jadwal.xml) ---
    const mapelSelect = document.getElementById('input-mapel');
    const mapelManualSelect = document.getElementById('input-mapel-manual');

    window.updateMapelDropdownFromXML = function (subjectsList) {
        if (!mapelSelect || !subjectsList || subjectsList.length === 0) return;
        let mapelHtml = '<option value="">Pilih Mata Pelajaran...</option>';
        subjectsList.forEach(name => {
            mapelHtml += `<option value="${name}">${name}</option>`;
        });

        if (mapelManualSelect) {
            mapelManualSelect.innerHTML = mapelHtml.replace('Pilih Mata Pelajaran...', 'Pilih Mapel Lainnya...');
        }

        window.allMapelsHtml = mapelHtml;
        const currentVal = mapelSelect.value;

        mapelHtml += '<option value="Lainnya" class="font-bold text-blue-600">Mapel Lain</option>';
        mapelSelect.innerHTML = mapelHtml;
        if (currentVal) mapelSelect.value = currentVal;
    };

    let initialMapels = [];
    if (cachedScheduleData && cachedScheduleData.xmlSubjectsList && cachedScheduleData.xmlSubjectsList.length > 0) {
        initialMapels = cachedScheduleData.xmlSubjectsList;
    } else {
        const defaultXMLSubjects = [
            'Agama dan Budi Pekerti', 'Pendidikan Pancasila', 'Bahasa Indonesia', 'Bahasa Indonesia Tk Lanjut',
            'Matematika', 'Matematika Tingkat Lanjut', 'Bahasa Inggris', 'Bahasa Inggris TK Lanjut', 'PJOK',
            'Sejarah', 'Sejarah Tingkat Lanjut', 'Seni Budaya', 'Bahasa Bali', 'Informatika', 'Fisika', 'Kimia',
            'Biologi', 'Geografi', 'Sosiologi', 'Ekonomi', 'Antropologi', 'Bahasa Jepang', 'UPACARA',
            'Perhotelan (HK)', 'Perhotelan (FB)', 'Prakarya dan Kewirausahaan', 'Bimbingan dan Konseling',
            'Ekstrakurikuler', 'Kearifan Lokal Bali'
        ];
        initialMapels = defaultXMLSubjects;
    }

    window.updateMapelDropdownFromXML(initialMapels);

    if (mapelManualSelect) mapelManualSelect.classList.add('hidden');

    // --- RENDER GURU (With Logic Sesuai Guru Pengampu di Kelas Terpilih) ---
    const allTeachers = getJournalMasterTeachers();
    rememberJournalTeachers(allTeachers);
    const targetClass = currentClass ? currentClass.name : '';
    activeTeachers = getTeachersForClass(targetClass, allTeachers, scheduleData);
    if (typeof renderGuruDropdown === 'function') {
        renderGuruDropdown(activeTeachers);
    }
    if (typeof updateTeacherPhotoPreview === 'function') {
        const curVal = document.getElementById('input-guru')?.value?.trim();
        updateTeacherPhotoPreview(curVal || '');
    }
}

// --- KONFIGURASI WAKTU JAM PELAJARAN (10 JP) ---
const JAM_PELAJARAN_CONFIG = [
    { jp: 1, start: '07:30', end: '08:15', startM: 7 * 60 + 30, endM: 8 * 60 + 15 },
    { jp: 2, start: '08:15', end: '09:00', startM: 8 * 60 + 15, endM: 9 * 60 },
    { jp: 3, start: '09:00', end: '09:45', startM: 9 * 60, endM: 9 * 60 + 45 },
    // Istirahat 1: 09:45 - 10:00 (15 min) -> JP 4
    { jp: 4, start: '10:00', end: '10:45', startM: 10 * 60, endM: 10 * 60 + 45 },
    { jp: 5, start: '10:45', end: '11:30', startM: 10 * 60 + 45, endM: 11 * 60 + 30 },
    { jp: 6, start: '11:30', end: '12:15', startM: 11 * 60 + 30, endM: 12 * 60 + 15 },
    // Istirahat 2: 12:15 - 12:30 (15 min) -> JP 7
    { jp: 7, start: '12:30', end: '13:15', startM: 12 * 60 + 30, endM: 13 * 60 + 15 },
    { jp: 8, start: '13:15', end: '14:00', startM: 13 * 60 + 15, endM: 14 * 60 },
    { jp: 9, start: '14:00', end: '14:45', startM: 14 * 60, endM: 14 * 60 + 45 },
    { jp: 10, start: '14:45', end: '15:30', startM: 14 * 60 + 45, endM: 15 * 60 + 30 }
];

function getCurrentJP(dateObj = new Date()) {
    const dayOfWeek = dateObj.getDay(); // 0 = Minggu, 1 = Senin, ..., 5 = Jumat, 6 = Sabtu
    if (dayOfWeek === 0 || dayOfWeek === 6) {
        return 1;
    }

    const currentMinutes = dateObj.getHours() * 60 + dateObj.getMinutes();

    // Sebelum 07:30
    if (currentMinutes < 7 * 60 + 30) {
        return dayOfWeek === 1 ? 2 : 1;
    }

    // Istirahat 1 (09:45 - 10:00) -> Arahkan ke JP 4
    if (currentMinutes >= 9 * 60 + 45 && currentMinutes < 10 * 60) {
        return 4;
    }

    // Istirahat 2 (12:15 - 12:30) -> Arahkan ke JP 7
    if (currentMinutes >= 12 * 60 + 15 && currentMinutes < 12 * 60 + 30) {
        return 7;
    }

    // Cek rentang JP aktif
    for (const slot of JAM_PELAJARAN_CONFIG) {
        if (currentMinutes >= slot.startM && currentMinutes < slot.endM) {
            if (dayOfWeek === 1 && slot.jp === 1) return 2; // Senin JP 1 Upacara
            if (dayOfWeek === 5 && slot.jp === 10) return 9; // Jumat JP 10 Ekskul
            return slot.jp;
        }
    }

    // Setelah 15:30 (Sore)
    return dayOfWeek === 5 ? 9 : 10;
}

function normalizeTeacherName(name) {
    if (!name) return '';
    let clean = name.toLowerCase();

    // 1. Normalisasi variasi spasi dalam inisial gelar (misal: 's. pd' -> 's.pd', 'm. pd. h' -> 'm.pd.h')
    clean = clean.replace(/\b([a-z])\.\s+([a-z])\b/gi, '$1.$2');
    clean = clean.replace(/\b([a-z])\.\s+([a-z])\b/gi, '$1.$2');

    // 2. Daftar pola gelar akademis lengkap dengan variasi tanda baca & spasi
    const titlePatterns = [
        /\bm\.?\s*pd\.?\s*h\.?\b/gi,
        /\bs\.?\s*pd\.?\s*h\.?\b/gi,
        /\bm\.?\s*pd\.?\b/gi,
        /\bs\.?\s*pd\.?\b/gi,
        /\bs\.?\s*ag\.?\b/gi,
        /\bs\.?\s*kom\.?\b/gi,
        /\bs\.?\s*e\.?\b/gi,
        /\bs\.?\s*t\.?\b/gi,
        /\bm\.?\s*si\.?\b/gi,
        /\bm\.?\s*m\.?\b/gi,
        /\bm\.?\s*p\.?\b/gi,
        /\bs\.?\s*p\.?\b/gi,
        /\bdrs\.?\b/gi,
        /\bdr\.?\b/gi,
        /\bgr\.?\b/gi,
        /\bh\.?\b/gi,
        /\bhj\.?\b/gi,
        /\btim\s*bk\b/gi,
        /\btim\b/gi
    ];
    titlePatterns.forEach(pattern => {
        clean = clean.replace(pattern, ' ');
    });

    clean = clean.replace(/[^a-z0-9\s]/gi, ' ').replace(/\s+/g, ' ').trim();
    return clean;
}

function isGuruBk(t) {
    if (!t) return false;
    const roleStr = (t.role || '').toLowerCase();
    const jenisPtk = (t.jenis_ptk || '').toLowerCase();
    const jabatan = (t.jabatan || '').toLowerCase();
    const mapelStr = Array.isArray(t.mapel) ? t.mapel.join(' ') : (t.mapel || '');
    const mengajarStr = Array.isArray(t.mengajar) ? t.mengajar.map(m => (typeof m === 'string' ? m : (m.nama || m.name || ''))).join(' ') : '';

    return roleStr === 'guru_bk' ||
           roleStr.includes('bk') ||
           jenisPtk.includes('bk') ||
           jabatan.includes('bk') ||
           mapelStr.toUpperCase().includes('BK') ||
           mapelStr.toUpperCase().includes('BIMBINGAN') ||
           mengajarStr.toUpperCase().includes('BK') ||
           mengajarStr.toUpperCase().includes('BIMBINGAN');
}

function smartMatchTeacher(xmlName, teacherList = []) {
    if (!xmlName) return '';
    if (!teacherList || teacherList.length === 0) return xmlName;

    const rawTrimmed = xmlName.trim().replace(/\s+/g, ' ');
    if (!rawTrimmed) return '';

    // 1. Direct exact match
    const exact = teacherList.find(t => (t.nama || t.name) === rawTrimmed);
    if (exact) return exact.nama || exact.name;

    // 2. Case-insensitive exact match
    const rawLower = rawTrimmed.toLowerCase();
    const caseMatch = teacherList.find(t => (t.nama || t.name || '').toLowerCase() === rawLower);
    if (caseMatch) return caseMatch.nama || caseMatch.name;

    // 3. Exact Normalized Match (tanpa gelar akademis & tanda baca)
    const normXml = normalizeTeacherName(rawTrimmed);
    if (normXml) {
        const normMatch = teacherList.find(t => normalizeTeacherName(t.nama || t.name || '') === normXml);
        if (normMatch) return normMatch.nama || normMatch.name;
    }

    // 4. Token / Substring Matching (untuk nama panggilan / tanpa awalan seperti "Putu widiasih", "Rani", "Sriada")
    if (normXml && normXml.length >= 3) {
        const tokens = normXml.split(' ').filter(t => t.length >= 3);

        const candidates = teacherList.filter(t => {
            const normT = normalizeTeacherName(t.nama || t.name || '');
            if (normT.includes(normXml)) return true;
            if (tokens.length > 0 && tokens.every(tok => normT.includes(tok))) return true;
            return false;
        });

        if (candidates.length === 1) {
            return candidates[0].nama || candidates[0].name;
        }

        if (candidates.length === 0 && tokens.length === 1) {
            const singleToken = tokens[0];
            const commonPrefixes = ['i', 'ni', 'wayan', 'made', 'nyoman', 'ketut', 'putu', 'kadek', 'komang', 'gede'];
            if (!commonPrefixes.includes(singleToken) && singleToken.length >= 4) {
                const tokenMatches = teacherList.filter(t => {
                    const normT = normalizeTeacherName(t.nama || t.name || '');
                    const masterTokens = normT.split(' ');
                    return masterTokens.includes(singleToken) || normT.includes(singleToken);
                });
                if (tokenMatches.length === 1) {
                    return tokenMatches[0].nama || tokenMatches[0].name;
                }
            }
        }
    }

    return '';
}

// --- JOURNAL TEACHER VERIFICATION ---
// Penyimpanan browser hanya cache tambahan. Data yang sudah dimuat tetap bisa
// dipakai selama halaman terbuka meskipun localStorage ditolak atau penuh.
function isJournalTeacherDirectory(teachers) {
    return Array.isArray(teachers) && teachers.length > 0 && teachers.every(t =>
        t && typeof (t.nama || t.name) === 'string' && (t.nama || t.name).trim());
}

function getJournalMasterTeachers() {
    if (isJournalTeacherDirectory(journalMasterTeachers)) return journalMasterTeachers;
    if (isJournalTeacherDirectory(window.allMasterTeachers)) {
        return window.allMasterTeachers;
    }
    const cached = CacheHelper.get('data_guru');
    return isJournalTeacherDirectory(cached) ? cached : [];
}

function rememberJournalTeachers(teachers) {
    if (!isJournalTeacherDirectory(teachers)) return;
    journalMasterTeachers = teachers;
    window.allMasterTeachers = teachers;
    window.guruDetailsMap = {};
    teachers.forEach(data => {
        let parsedMapel = [];
        if (Array.isArray(data.mapel)) {
            parsedMapel = data.mapel;
        } else if (typeof data.mapel === 'string' && data.mapel.trim()) {
            parsedMapel = data.mapel.split(/[,;]/).map(s => s.trim()).filter(Boolean);
        }
        window.guruDetailsMap[data.nama || data.name] = {
            uid: data.uid || null,
            mengajar: Array.isArray(data.mengajar) ? data.mengajar : [],
            mapel: parsedMapel
        };
    });
}

function findJournalTeacher(rawName) {
    if (!rawName || !rawName.trim()) return null;
    // Pengajar pada jurnal lama terkunci saat edit. Pertahankan identitas historis
    // yang sudah tersimpan meskipun guru itu tidak lagi ada di master saat ini.
    const historicalName = window.currentEditData?.guru;
    if (window.currentEditDocId && historicalName && rawName.trim() === historicalName.trim()) {
        return { nama: historicalName, uid: window.currentEditData.uid_guru || null };
    }
    // Jadwal dapat menyertakan nama pengampu tanpa record GTK. Nama tampilan itu
    // belum merupakan bukti guru terdaftar; fallback aktif harus memiliki ID resmi.
    const identifiedActiveTeachers = activeTeachers.filter(t => t && (t.id || t.uid) && typeof (t.nama || t.name) === 'string');
    for (const teachers of [getJournalMasterTeachers(), identifiedActiveTeachers]) {
        if (!Array.isArray(teachers) || teachers.length === 0) continue;
        const matchedName = smartMatchTeacher(rawName, teachers);
        // smartMatchTeacher juga digunakan untuk menampilkan nama mentah jadwal.
        // Validasi wajib menemukan record guru, bukan sekadar string hasil fallback.
        const teacher = teachers.find(t => (t.nama || t.name) === matchedName);
        if (teacher) return teacher;
    }
    return null;
}

function includeJournalTeacher(teacher) {
    const name = teacher.nama || teacher.name;
    if (!activeTeachers.some(t => (t.nama || t.name) === name)) activeTeachers.push(teacher);
    return name;
}

async function refreshJournalTeacherDirectory() {
    if (journalTeacherRefreshPromise) return journalTeacherRefreshPromise;
    const request = (async () => {
        let timer;
        try {
            // Bypass cache memori/sesi API. Batas waktu mencakup token, header dan body,
            // termasuk browser yang tidak mendukung AbortController.
            const bundle = await Promise.race([
                CloudflareAPI.getMasterBundle(true),
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error('Verifikasi guru melewati batas waktu')), JOURNAL_TEACHER_VERIFY_TIMEOUT_MS);
                })
            ]);
            if (typeof bundle?.mode_daring === 'boolean') applyJournalModeConfig(bundle.mode_daring);
            const teachers = bundle && bundle.teachers;
            if (!isJournalTeacherDirectory(teachers)) {
                throw new Error('Daftar guru resmi belum tersedia');
            }
            rememberJournalTeachers(teachers);
            CacheHelper.set('data_guru', teachers);
            // Daftar aktif dibangun kembali agar cache guru lama tidak menimpa data segar.
            activeTeachers = getTeachersForClass(currentClass?.name || '', teachers, cachedScheduleData);
            renderGuruDropdown(activeTeachers);
        } finally {
            clearTimeout(timer);
        }
    })();
    journalTeacherRefreshPromise = request;
    try {
        await request;
    } finally {
        if (journalTeacherRefreshPromise === request) journalTeacherRefreshPromise = null;
    }
}

async function verifyJournalTeacher(rawName) {
    if (!rawName || !rawName.trim()) return { status: 'empty' };
    let teacher = findJournalTeacher(rawName);
    if (teacher) return { status: 'matched', teacher };
    try {
        await refreshJournalTeacherDirectory();
    } catch (error) {
        console.warn('[Journal Teacher] Daftar guru belum dapat diverifikasi:', error);
        teacher = findJournalTeacher(rawName);
        return teacher ? { status: 'matched', teacher } : { status: 'unavailable' };
    }
    teacher = findJournalTeacher(rawName);
    return teacher ? { status: 'matched', teacher } : { status: 'not-found' };
}

// --- SCHEDULE CACHE ---
let cachedScheduleData = null;

async function loadAndParseScheduleXML() {
    if (cachedScheduleData) return cachedScheduleData;

    try {
        let cached = null;
        let cachedTs = null;
        try {
            cached = localStorage.getItem('jurnal_schedule_cache');
            cachedTs = localStorage.getItem('jurnal_schedule_cache_ts');
        } catch (e) { }
        if (cached && cachedTs && (Date.now() - parseInt(cachedTs) < 24 * 60 * 60 * 1000)) {
            try {
                cachedScheduleData = JSON.parse(cached);
                return cachedScheduleData;
            } catch (e) {}
        }

        let xmlText = null;

        // 1. Coba ambil dari Cloudflare D1 SSOT (Bundle Master API)
        if (CloudflareAPI.isEnabled) {
            try {
                const bundle = await CloudflareAPI.getMasterBundle();
                if (bundle && bundle.schedule_config && bundle.schedule_config.xmlContent) {
                    xmlText = bundle.schedule_config.xmlContent;
                    console.log("⚡ [Schedule] Menggunakan master Jadwal XML dari Cloudflare D1 SSOT");
                }
            } catch (cfErr) {
                console.error("[Schedule] Lookup Cloudflare D1 schedule_config error:", cfErr);
            }
        }

        // 3. Fallback ke file statis assets/Jadwal.xml jika belum ada di server
        if (!xmlText) {
            const res = await fetch('./assets/Jadwal.xml');
            if (res.ok) {
                xmlText = await res.text();
                console.log("📄 [Schedule] Menggunakan fallback Jadwal.xml lokal");
            } else {
                console.warn('[Schedule] Gagal fetch ./assets/Jadwal.xml (status ' + res.status + ')');
                return null;
            }
        }

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

        const classesMap = new Map();
        xmlDoc.querySelectorAll('classes > class').forEach(c => {
            classesMap.set(c.getAttribute('id'), c.getAttribute('name'));
        });

        const teachersMap = new Map();
        xmlDoc.querySelectorAll('teachers > teacher').forEach(t => {
            teachersMap.set(t.getAttribute('id'), {
                id: t.getAttribute('id'),
                name: t.getAttribute('name'),
                short: t.getAttribute('short')
            });
        });

        const subjectsMap = new Map();
        xmlDoc.querySelectorAll('subjects > subject').forEach(s => {
            subjectsMap.set(s.getAttribute('id'), s.getAttribute('name'));
        });

        const lessonsMap = new Map();
        xmlDoc.querySelectorAll('lessons > lesson').forEach(l => {
            lessonsMap.set(l.getAttribute('id'), {
                subjectId: l.getAttribute('subjectid'),
                classIds: (l.getAttribute('classids') || '').split(',').filter(Boolean),
                teacherIds: (l.getAttribute('teacherids') || '').split(',').filter(Boolean),
                periodsPerCard: parseInt(l.getAttribute('periodspercard') || '1')
            });
        });

        const dayMaskMap = {
            '10000': 1, // Senin
            '01000': 2, // Selasa
            '00100': 3, // Rabu
            '00010': 4, // Kamis
            '00001': 5  // Jumat
        };

        const scheduleMap = {};
        const classTeachersMap = {};
        const normCls = (str) => (str || '').toString().trim().replace(/[\.\s_]/g, '-').toUpperCase();

        // 1. Ekstrak guru dari seluruh alokasi lesson per kelas
        for (const [_, lesson] of lessonsMap.entries()) {
            const subjectName = subjectsMap.get(lesson.subjectId) || '';
            if (subjectName.toUpperCase() === 'UPACARA') continue;

            const isBk = subjectName.toUpperCase().includes('BK') || subjectName.toUpperCase().includes('BIMBINGAN');

            lesson.classIds.forEach(classId => {
                const className = classesMap.get(classId);
                if (!className) return;
                const normKey = normCls(className);
                if (!classTeachersMap[normKey]) {
                    classTeachersMap[normKey] = {
                        className: className,
                        teacherNames: [],
                        hasBk: false
                    };
                }
                if (isBk) classTeachersMap[normKey].hasBk = true;

                (lesson.teacherIds || []).forEach(tId => {
                    const tObj = teachersMap.get(tId);
                    if (tObj && tObj.name) {
                        const tName = tObj.name.trim();
                        if (!classTeachersMap[normKey].teacherNames.includes(tName)) {
                            classTeachersMap[normKey].teacherNames.push(tName);
                        }
                    }
                });
            });
        }

        xmlDoc.querySelectorAll('cards > card').forEach(card => {
            const lessonId = card.getAttribute('lessonid');
            const periodNum = parseInt(card.getAttribute('period'));
            const daysMask = card.getAttribute('days');
            const dayIndex = dayMaskMap[daysMask];
            if (!dayIndex || !periodNum) return;

            const lesson = lessonsMap.get(lessonId);
            if (!lesson) return;

            const subjectName = subjectsMap.get(lesson.subjectId) || '';

            lesson.classIds.forEach(classId => {
                const className = classesMap.get(classId);
                if (!className) return;

                if (!scheduleMap[className]) scheduleMap[className] = {};
                if (!scheduleMap[className][dayIndex]) scheduleMap[className][dayIndex] = {};

                const primaryTeacher = teachersMap.get(lesson.teacherIds[0]);
                const teacherName = primaryTeacher ? primaryTeacher.name : '';

                scheduleMap[className][dayIndex][periodNum] = {
                    jp: periodNum,
                    mapel: subjectName,
                    guruNama: teacherName,
                    periodsPerCard: lesson.periodsPerCard
                };

                if (teacherName && subjectName.toUpperCase() !== 'UPACARA') {
                    const normKey = normCls(className);
                    if (!classTeachersMap[normKey]) {
                        classTeachersMap[normKey] = {
                            className: className,
                            teacherNames: []
                        };
                    }
                    if (!classTeachersMap[normKey].teacherNames.includes(teacherName)) {
                        classTeachersMap[normKey].teacherNames.push(teacherName);
                    }
                }
            });
        });

        const xmlSubjectsList = Array.from(subjectsMap.values())
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b, 'id', { sensitivity: 'base' }));

        cachedScheduleData = { scheduleMap, xmlSubjectsList, classTeachersMap, parsedAt: Date.now() };
        try {
            localStorage.setItem('jurnal_schedule_cache', JSON.stringify(cachedScheduleData));
            localStorage.setItem('jurnal_schedule_cache_ts', Date.now().toString());
        } catch (e) {}

        // Apabila renderMasterDataUI sudah pernah dipanggil sebelumnya, perbarui daftar mapel dengan data XML
        if (window.updateMapelDropdownFromXML) {
            window.updateMapelDropdownFromXML(xmlSubjectsList);
        }

        return cachedScheduleData;
    } catch (e) {
        console.error('[Schedule] Gagal memuat jadwal XML:', e);
        return null;
    }
}

function getLessonBlockJPs(daySchedule, activeJp) {
    if (!daySchedule || !daySchedule[activeJp]) return [activeJp];
    const targetSlot = daySchedule[activeJp];
    if (!targetSlot.mapel || targetSlot.mapel.toUpperCase() === 'UPACARA') return [activeJp];

    const matchedJps = [activeJp];

    // Cek mundur
    for (let p = activeJp - 1; p >= 1; p--) {
        const slot = daySchedule[p];
        if (slot && slot.mapel === targetSlot.mapel && slot.guruNama === targetSlot.guruNama) {
            matchedJps.unshift(p);
        } else {
            break;
        }
    }

    // Cek maju
    for (let p = activeJp + 1; p <= 10; p++) {
        const slot = daySchedule[p];
        if (slot && slot.mapel === targetSlot.mapel && slot.guruNama === targetSlot.guruNama) {
            matchedJps.push(p);
        } else {
            break;
        }
    }

    return matchedJps;
}

/**
 * Mengambil daftar guru yang mengajar di kelas tertentu berdasarkan SSOT Jadwal aSc Timetables
 * @param {string} targetClassName - Nama kelas (misal "X-1", "XII-4")
 * @param {Array} allTeachers - Seluruh data master guru (CacheHelper data_guru / tabel gtk)
 * @param {Object} scheduleData - Data hasil parse jadwal XML (cachedScheduleData)
 * @returns {Array} Daftar guru yang mengajar di kelas tersebut (termasuk guru BK)
 */
function getTeachersForClass(targetClassName, allTeachers, scheduleData) {
    if (!targetClassName) return allTeachers || [];
    const all = Array.isArray(allTeachers) ? allTeachers : [];
    if (all.length === 0) return [];

    const normCls = (str) => (str || '').toString().trim().replace(/[\.\s_]/g, '-').toUpperCase();
    const normTarget = normCls(targetClassName);

    let teacherNames = [];

    // 1. Ambil dari classTeachersMap yang sudah ter-parse
    if (scheduleData && scheduleData.classTeachersMap) {
        const entry = scheduleData.classTeachersMap[normTarget] ||
                      Object.entries(scheduleData.classTeachersMap).find(([k]) => normCls(k) === normTarget)?.[1];
        if (entry) {
            teacherNames = [...(entry.teacherNames || [])];
        }
    }

    // 2. Fallback / Ekstraksi langsung dari scheduleMap
    if (scheduleData && scheduleData.scheduleMap) {
        const classSched = scheduleData.scheduleMap[targetClassName] ||
                           Object.entries(scheduleData.scheduleMap).find(([k]) => normCls(k) === normTarget)?.[1];
        if (classSched) {
            for (let d = 1; d <= 5; d++) {
                const daySlots = classSched[d];
                if (!daySlots) continue;
                for (let jp = 1; jp <= 10; jp++) {
                    const slot = daySlots[jp];
                    if (slot && slot.guruNama && slot.mapel && slot.mapel.toUpperCase() !== 'UPACARA') {
                        const gName = slot.guruNama.trim();
                        if (!teacherNames.includes(gName)) {
                            teacherNames.push(gName);
                        }
                    }
                }
            }
        }
    }

    // Jika tidak ditemukan data jadwal sama sekali untuk kelas ini (misal XML belum siap), fallback aman ke allTeachers
    if (teacherNames.length === 0) {
        return all;
    }

    const matchedTeachers = [];
    const matchedNames = new Set();

    // 3. Cocokkan nama guru dari Jadwal XML ke data master allTeachers
    teacherNames.forEach(xmlName => {
        const resolved = smartMatchTeacher(xmlName, all);
        if (resolved) {
            const tObj = all.find(t => (t.nama || t.name) === resolved);
            if (tObj) {
                const canonName = tObj.nama || tObj.name;
                if (!matchedNames.has(canonName)) {
                    matchedTeachers.push(tObj);
                    matchedNames.add(canonName);
                }
            }
        } else {
            // Jika nama di XML belum ada di master allTeachers, tetap sertakan agar jadwal tidak kehilangan pengampu
            if (!matchedNames.has(xmlName)) {
                matchedTeachers.push({ nama: xmlName, name: xmlName });
                matchedNames.add(xmlName);
            }
        }
    });

    // 5. Sertakan guru dari master yang memiliki konfigurasi t.mengajar spesifik kelas ini
    all.forEach(t => {
        if (Array.isArray(t.mengajar)) {
            const teachesThisClass = t.mengajar.some(m => Array.isArray(m.kelas) && m.kelas.some(k => normCls(k) === normTarget));
            const tName = t.nama || t.name;
            if (teachesThisClass && tName && !matchedNames.has(tName)) {
                matchedTeachers.push(t);
                matchedNames.add(tName);
            }
        }
    });

    // 6. Jika dalam mode edit, pastikan guru lama tetap ada di daftar agar validasi form tidak gagal
    if (typeof window !== 'undefined' && window.currentEditDocId && window.currentEditData && window.currentEditData.guru) {
        const editGuru = window.currentEditData.guru.trim();
        if (editGuru && !matchedNames.has(editGuru)) {
            const foundInAll = all.find(t => (t.nama || t.name) === editGuru) || { nama: editGuru, name: editGuru };
            matchedTeachers.push(foundInAll);
            matchedNames.add(editGuru);
        }
    }

    // Urutkan alfabetis A-Z
    matchedTeachers.sort((a, b) => (a.nama || a.name || '').localeCompare(b.nama || b.name || '', 'id', { sensitivity: 'base' }));

    return matchedTeachers.length > 0 ? matchedTeachers : all;
}
if (typeof window !== 'undefined') {
    window.getTeachersForClass = getTeachersForClass;
    window.isGuruBk = isGuruBk;
}

async function autoPopulateSchedule(className) {
    try {
        const scheduleData = await loadAndParseScheduleXML();
        const now = new Date();
        const activeJp = getCurrentJP(now);
        const dayOfWeek = now.getDay(); // 1=Senin ... 5=Jumat

        let targetJps = [activeJp];
        let detectedTeacher = '';
        let detectedMapel = '';

        if (scheduleData && scheduleData.scheduleMap && scheduleData.scheduleMap[className] && scheduleData.scheduleMap[className][dayOfWeek]) {
            const daySched = scheduleData.scheduleMap[className][dayOfWeek];
            const slot = daySched[activeJp];
            if (slot && slot.mapel && slot.mapel.toUpperCase() !== 'UPACARA') {
                targetJps = getLessonBlockJPs(daySched, activeJp);
                detectedTeacher = slot.guruNama || '';
                detectedMapel = slot.mapel || '';
            }
        }

        // Terapkan pemilihan tombol JP
        selectedJp.clear();
        document.querySelectorAll('.jp-btn').forEach(btn => {
            const val = parseInt(btn.dataset.val);
            if (targetJps.includes(val)) {
                selectedJp.add(val);
                btn.classList.add('jp-btn-active');
            } else {
                btn.classList.remove('jp-btn-active');
            }
        });

        // Terapkan nama guru & mapel jika terdeteksi dari jadwal
        if (detectedTeacher) {
            const inputGuruEl = document.getElementById('input-guru');
            const mapelSelect = document.getElementById('input-mapel');

            const matchedTeacher = findJournalTeacher(detectedTeacher);
            const matchedName = matchedTeacher ? includeJournalTeacher(matchedTeacher) : '';
            if (inputGuruEl) {
                inputGuruEl.value = matchedName || detectedTeacher;
                selectedGuruName = matchedName || detectedTeacher;
            }
            if (typeof updateTeacherPhotoPreview === 'function') {
                updateTeacherPhotoPreview(selectedGuruName);
            }

            if (typeof window.filterMapelByGuru === 'function') {
                window.filterMapelByGuru();
            }

            if (mapelSelect && detectedMapel) {
                let hasMapel = Array.from(mapelSelect.options).some(opt => opt.value === detectedMapel);
                if (!hasMapel) {
                    const lastOpt = mapelSelect.querySelector('option[value="Lainnya"]');
                    const newOpt = document.createElement('option');
                    newOpt.value = detectedMapel;
                    newOpt.textContent = detectedMapel;
                    if (lastOpt) {
                        mapelSelect.insertBefore(newOpt, lastOpt);
                    } else {
                        mapelSelect.appendChild(newOpt);
                    }
                }
                mapelSelect.value = detectedMapel;
            }

            if (typeof checkManualMapel === 'function') checkManualMapel();
            if (typeof checkHistoryTrigger === 'function') checkHistoryTrigger();
            if (typeof showPresensiNav === 'function') showPresensiNav();

            const minJ = Math.min(...targetJps);
            const maxJ = Math.max(...targetJps);
            const jpSpanStr = minJ === maxJ ? `JP ${minJ}` : `JP ${minJ}-${maxJ}`;
            const displayName = inputGuruEl && inputGuruEl.value ? inputGuruEl.value : detectedTeacher;
            showToast('Jadwal Terdeteksi ⚡', `${displayName} • ${detectedMapel} (${jpSpanStr})`, 'info');
        }
    } catch (e) {
        console.warn('[Schedule] Auto-populate schedule warning:', e);
    }
}

/**
 * Otomatisasi Jadwal Saat Guru Dipilih Manual (Khusus Pengisian di Luar Jam Mengajar)
 * Mencari slot jadwal guru bersangkutan di kelas ini pada hari ini (Senin-Jumat)
 * dan otomatis mengaktifkan blok JP serta memilih Mapel yang sesuai.
 */
async function autoFillTeacherSchedule(guruName) {
    if (!guruName || !currentClass || !currentClass.name || window.currentEditDocId) return;

    try {
        const scheduleData = await loadAndParseScheduleXML();
        if (!scheduleData || !scheduleData.scheduleMap) {
            if (typeof window.filterMapelByGuru === 'function') window.filterMapelByGuru();
            return;
        }

        const now = new Date();
        const dayOfWeek = now.getDay(); // 1=Senin ... 5=Jumat
        const className = currentClass.name;

        if (!scheduleData.scheduleMap[className] || !scheduleData.scheduleMap[className][dayOfWeek]) {
            if (typeof window.filterMapelByGuru === 'function') window.filterMapelByGuru();
            return;
        }

        const daySched = scheduleData.scheduleMap[className][dayOfWeek];
        let foundJp = null;
        let detectedMapel = '';

        for (let jp = 1; jp <= 10; jp++) {
            const slot = daySched[jp];
            if (slot && slot.guruNama && slot.mapel && slot.mapel.toUpperCase() !== 'UPACARA') {
                const isDirectMatch = (slot.guruNama === guruName) ||
                                (typeof smartMatchTeacher === 'function' && smartMatchTeacher(slot.guruNama, [{ nama: guruName }]) === guruName) ||
                                (typeof smartMatchTeacher === 'function' && smartMatchTeacher(guruName, [{ nama: slot.guruNama }]) === slot.guruNama) ||
                                (typeof normalizeTeacherName === 'function' && normalizeTeacherName(slot.guruNama) === normalizeTeacherName(guruName)) ||
                                (slot.guruNama.toLowerCase().includes(guruName.toLowerCase())) ||
                                (guruName.toLowerCase().includes(slot.guruNama.toLowerCase()));

                if (isDirectMatch) {
                    foundJp = jp;
                    detectedMapel = slot.mapel;
                    break;
                }
            }
        }

        if (foundJp) {
            const targetJps = getLessonBlockJPs(daySched, foundJp);

            // 1. Terapkan pemilihan tombol JP
            selectedJp.clear();
            document.querySelectorAll('.jp-btn').forEach(btn => {
                const val = parseInt(btn.dataset.val);
                if (targetJps.includes(val)) {
                    selectedJp.add(val);
                    btn.classList.add('jp-btn-active');
                } else {
                    btn.classList.remove('jp-btn-active');
                }
            });

            // 2. Terapkan pilihan Mapel secara otomatis & terverifikasi
            if (typeof window.filterMapelByGuru === 'function') {
                window.filterMapelByGuru(detectedMapel);
            }
            const mapelSelect = document.getElementById('input-mapel');
            if (mapelSelect && detectedMapel) {
                let hasMapel = Array.from(mapelSelect.options).some(opt => opt.value === detectedMapel);
                if (!hasMapel) {
                    const lastOpt = mapelSelect.querySelector('option[value="Lainnya"]');
                    const newOpt = document.createElement('option');
                    newOpt.value = detectedMapel;
                    newOpt.textContent = detectedMapel;
                    if (lastOpt) {
                        mapelSelect.insertBefore(newOpt, lastOpt);
                    } else {
                        mapelSelect.appendChild(newOpt);
                    }
                }
                mapelSelect.value = detectedMapel;
                if (typeof checkManualMapel === 'function') checkManualMapel();
            }

            if (typeof updateTeacherPhotoPreview === 'function') {
                updateTeacherPhotoPreview(guruName);
            }

            if (typeof checkHistoryTrigger === 'function') checkHistoryTrigger();
            if (typeof updatePreviousTopicPlaceholder === 'function') {
                updatePreviousTopicPlaceholder(className, guruName, detectedMapel);
            }

            const minJ = Math.min(...targetJps);
            const maxJ = Math.max(...targetJps);
            const jpSpanStr = minJ === maxJ ? `JP ${minJ}` : `JP ${minJ}-${maxJ}`;
            showToast('Jadwal Terdeteksi ⚡', `${guruName} • ${detectedMapel} (${jpSpanStr})`, 'info');
        } else {
            // Jika guru tidak punya jadwal hari ini di kelas ini, tetap jalankan filterMapelByGuru agar mapel guru terpilih otomatis!
            if (typeof window.filterMapelByGuru === 'function') {
                window.filterMapelByGuru();
            }
        }
    } catch (e) {
        console.warn('[AutoFillTeacherSchedule] Error:', e);
    }
}

// Sengaja didefinisikan lokal (bukan import dari jurnal-cloudflare-api.js): file itu tidak berversi
// dan bisa tersaji versi lama dari cache service worker, sehingga export baru akan mematikan modul halaman.
async function fetchWithTimeout(url, options = {}, timeoutMs) {
    if (typeof AbortController === 'undefined') return fetch(url, options);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
        if (err && err.name === 'AbortError') {
            throw new Error(`Timeout ${timeoutMs / 1000} detik menunggu respons server`);
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Auto Pre-Fill Presensi Siswa dari Presensi Harian Kelas (Supabase SSOT)
 * Memuat status absensi siswa (S, I, A, D) yang telah diinput Admin Kelas hari ini
 * agar otomatis tercentang/terpilih di form jurnal tanpa perlu input manual.
 */
async function autoPreFillDailyAttendance(className) {
    if (!className || window.currentEditDocId) return;
    // Pelengkap saja: jangan sampai koneksi Supabase yang menggantung menahan inisialisasi tanda tangan
    const PREFILL_TIMEOUT_MS = 8000;
    try {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const dateStr = `${yyyy}-${mm}-${dd}`;

        let rows = null;

        // 1. Ambil data lewat secure-proxy jika API key terkonfigurasi
        if (JURNAL_SYNC_API_KEY && JURNAL_SYNC_API_KEY.trim() !== '') {
            try {
                const proxyUrl = `${SUPABASE_CONFIG.url}/functions/v1/secure-proxy`;
                const proxyRes = await fetchWithTimeout(proxyUrl, {
                    method: 'POST',
                    headers: SUPABASE_HEADERS,
                    body: JSON.stringify({
                        action: 'jurnal-get-presensi-kelas',
                        payload: {
                            secret: JURNAL_SYNC_API_KEY,
                            kelas: className,
                            tanggal: dateStr
                        }
                    })
                }, PREFILL_TIMEOUT_MS);
                if (proxyRes.ok) {
                    const proxyData = await proxyRes.json();
                    if (proxyData && proxyData.success && Array.isArray(proxyData.data)) {
                        rows = proxyData.data;
                    }
                }
            } catch (proxyErr) {
                console.warn('[AutoPreFill] Secure-proxy fetch error, fallback ke REST:', proxyErr);
            }
        }

        // 2. Fallback jika secure-proxy belum selesai deploy / offline
        if (!rows) {
            try {
                const restUrl = `${SUPABASE_CONFIG.url}/rest/v1/siswa_presensi?kelas=eq.${encodeURIComponent(className)}&tanggal=eq.${dateStr}&select=student_nis,student_name,status`;
                const res = await fetchWithTimeout(restUrl, { headers: SUPABASE_HEADERS }, PREFILL_TIMEOUT_MS);
                if (res.ok) {
                    const restData = await res.json();
                    if (Array.isArray(restData)) rows = restData;
                }
            } catch (restErr) {
                console.warn('[AutoPreFill] REST fetch error:', restErr);
            }
        }

        if (!Array.isArray(rows) || rows.length === 0) return;

        const studentRows = Array.from(document.querySelectorAll('.student-row'));
        if (studentRows.length === 0) return;

        let autoFilledCount = 0;
        rows.forEach(r => {
            let status = (r.status || 'H').toUpperCase();
            if (status === 'P') status = 'D'; // Petakan Permisi (P) ke Dispensasi (D)

            if (status !== 'H' && ['S', 'I', 'A', 'D', 'T'].includes(status)) {
                const row = studentRows.find(el => {
                    const elNis = (el.dataset.nis || '').trim();
                    const rNis = (r.student_nis || '').trim();
                    if (elNis && rNis && elNis === rNis) return true;

                    const elName = (el.dataset.name || '').trim().toLowerCase();
                    const rName = (r.student_name || '').trim().toLowerCase();
                    return elName && rName && elName === rName;
                });

                if (row) {
                    const sId = row.dataset.id;
                    setAttendance(sId, status, true);
                    autoFilledCount++;
                }
            }
        });

        if (autoFilledCount > 0) {
            console.log(`[AutoPreFill] Berhasil memuat ${autoFilledCount} siswa tidak hadir dari presensi kelas hari ini (${dateStr}).`);
            if (typeof window.showToast === 'function') {
                window.showToast('Presensi Tersinkron ⚡', `${autoFilledCount} siswa tidak hadir terisi dari presensi kelas hari ini.`, 'info');
            }
        }
    } catch (err) {
        console.warn('[AutoPreFill] Gagal memuat data presensi harian siswa:', err);
    }
}

// Call initial load
loadClasses();
window._masterDataReady = ensureMasterData();

// --- NAVIGATION ---
window.selectClass = async function (className) {
    if (isSubmittingJurnal) return;
    if (activePhotoUpload && activePhotoUpload.className !== className) window.clearImage();
    currentClass = { name: className };
    document.getElementById('screen-scan').classList.add('hidden');
    document.getElementById('screen-form').classList.remove('hidden');
    document.getElementById('header-class-name').textContent = window.currentEditDocId ? `Edit Jurnal ${className}` : `Jurnal Mengajar ${className}`;

    // Atur atribut kamera / upload galeri sesuai Mode Daring
    const fileCam = document.getElementById('file-camera');
    const photoBtnText = document.getElementById('photo-btn-text');
    const photoBtnSubtext = document.getElementById('photo-btn-subtext');
    if (fileCam) {
        if (window.isModeDaring) {
            fileCam.removeAttribute('capture');
            if (photoBtnText) photoBtnText.textContent = 'Pilih Galeri';
            if (photoBtnSubtext) photoBtnSubtext.textContent = 'Upload File / Galeri 🖼️';
        } else {
            fileCam.setAttribute('capture', 'environment');
            if (photoBtnText) photoBtnText.textContent = 'Kamera HD';
            if (photoBtnSubtext) photoBtnSubtext.textContent = 'Kamera Utama 📸';
        }
    }

    if (!window.currentEditDocId) {
        const ttdOptLabel = document.getElementById('ttd-optional-label');
        if (ttdOptLabel) ttdOptLabel.classList.add('hidden');
    }

    const presensiSummary = document.getElementById('presensi-summary');
    if (presensiSummary) presensiSummary.classList.add('hidden');

    document.getElementById('student-list').innerHTML = `
        <div class="text-center py-8">
            <i data-lucide="loader-2" class="w-8 h-8 mx-auto animate-spin text-blue-500 mb-2"></i>
            <p class="text-xs font-bold text-gray-400">Menyiapkan Data Form & Siswa...</p>
        </div>
    `;
    safeRenderLucide();
    document.getElementById('input-guru').placeholder = 'Memproses data...';

    if (typeof checkHistoryTrigger === 'function') {
        checkHistoryTrigger();
    }

    await renderMasterDataUI();
    document.getElementById('input-guru').placeholder = 'Ketik / Pilih Nama Anda...';

    renderJpButtons();
    safeRenderLucide();

    try {
        const cacheKey = `data_siswa_${className}`;
        let students = CacheHelper.get(cacheKey);

        if (!students || !Array.isArray(students) || students.length === 0) {
            let fetchedFromCloudflare = false;
            if (CloudflareAPI.isEnabled) {
                try {
                    console.log(`[Students] Mengambil Data Siswa kelas ${className} dari Cloudflare D1...`);
                    const cfStudents = await CloudflareAPI.getStudents(className);
                    if (Array.isArray(cfStudents) && cfStudents.length > 0) {
                        students = cfStudents.map((s, idx) => ({
                            id: s.nis || String(idx),
                            name: s.name || s.nama,
                            nis: s.nis || '',
                            absen: s.absen || ''
                        }));
                        fetchedFromCloudflare = true;
                        console.log(`⚡ [Cloudflare D1] Sukses memuat ${students.length} siswa kelas ${className} (0 Firestore Read).`);
                    }
                } catch (cfErr) {
                    console.error("[Cloudflare D1] Gagal memuat siswa:", cfErr);
                }
            }

            // Normalisasi dan urutkan alfabetis (A-Z) berdasarkan nama siswa
            if (Array.isArray(students)) {
                students.forEach((s, idx) => {
                    if (!s.id) s.id = s.nis ? String(s.nis) : `std-${idx}`;
                    if (!s.name && s.nama) s.name = s.nama;
                    if (!s.name && !s.nama) s.name = 'Siswa';
                });
                students.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'id', { sensitivity: 'base' }));
            } else {
                students = [];
            }

            if (students.length > 0) {
                CacheHelper.set(cacheKey, students);
            }
        } else {
            console.log(`Menggunakan Data Siswa untuk ${className} dari Cache`);
            // Pastikan data cache juga dinormalisasi dan selalu terurut alfabetis
            if (Array.isArray(students)) {
                students.forEach((s, idx) => {
                    if (!s.id) s.id = s.nis ? String(s.nis) : `std-${idx}`;
                    if (!s.name && s.nama) s.name = s.nama;
                    if (!s.name && !s.nama) s.name = 'Siswa';
                });
                students.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'id', { sensitivity: 'base' }));
            } else {
                students = [];
            }
        }

        renderStudents(students);
        safeRenderLucide();

        // JIKA SCAN JURNAL BARU (Bukan mode edit): Auto-select JP & Auto pre-fill Nama Guru + Mapel (Hanya dalam jam KBM/waktu input)
        if (!window.currentEditDocId) {
            const inputGuru = document.getElementById('input-guru');
            const inputMapel = document.getElementById('input-mapel');

            // Reset awal input guru & mapel menjadi kosong
            if (inputGuru) inputGuru.value = '';
            if (typeof updateTeacherPhotoPreview === 'function') {
                updateTeacherPhotoPreview('');
            }
            if (typeof window.filterMapelByGuru === 'function') {
                window.filterMapelByGuru();
            } else if (inputMapel) {
                if (window.allMapelsHtml) inputMapel.innerHTML = window.allMapelsHtml;
                inputMapel.value = '';
            }

            const now = new Date();
            const dayOfWeek = now.getDay(); // 0 = Minggu, 1 = Senin, ..., 5 = Jumat, 6 = Sabtu
            const curTime = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
            const timeSlots = [
                { jp: 1, start: '07:30', end: '08:15' },
                { jp: 2, start: '08:15', end: '09:00' },
                { jp: 3, start: '09:00', end: '09:45' },
                { jp: 4, start: '10:00', end: '10:45' },
                { jp: 5, start: '10:45', end: '11:30' },
                { jp: 6, start: '11:30', end: '12:15' },
                { jp: 7, start: '12:45', end: '13:30' },
                { jp: 8, start: '13:30', end: '14:15' },
                { jp: 9, start: '14:15', end: '15:00' },
                { jp: 10, start: '15:00', end: '15:45' }
            ];

            let activeJPVal = null;
            // Hanya aktifkan jam pelajaran jika hari sekolah (Senin - Jumat)
            if (dayOfWeek >= 1 && dayOfWeek <= 5) {
                for (const slot of timeSlots) {
                    if (curTime >= slot.start && curTime < slot.end) {
                        activeJPVal = slot.jp;
                        break;
                    }
                }
            }

            if (activeJPVal) {
                const jpBtn = document.getElementById(`jp-btn-${activeJPVal}`);
                if (jpBtn && typeof window.toggleJp === 'function') {
                    window.toggleJp(jpBtn, activeJPVal);
                }
            }
        }

        // JIKA MASUK MODE EDIT
        if (window.currentEditDocId && window.currentEditData) {

            const docData = window.currentEditData;

            // Restore Nama Guru
            const inputGuru = document.getElementById('input-guru');
            if (inputGuru && docData.guru) {
                inputGuru.value = docData.guru;
                selectedGuruName = docData.guru;
                inputGuru.disabled = true; // Blocked saat edit
                if (typeof updateTeacherPhotoPreview === 'function') {
                    updateTeacherPhotoPreview(docData.guru);
                }
            }

            // Tampilkan navigasi riwayat presensi
            if (typeof window.showPresensiNav === 'function') showPresensiNav();

            // Filter Mapel berdasarkan Guru (sama seperti saat input pertama kali)
            if (typeof window.filterMapelByGuru === 'function') {
                window.filterMapelByGuru();
            }

            // Restore Lokasi Mengajar
            const inputLokasi = document.getElementById('input-lokasi');
            if (inputLokasi) {
                const lokVal = docData.lokasi_mengajar || 'Ruang Kelas';
                let hasLokasi = Array.from(inputLokasi.options).some(opt => opt.value === lokVal);
                if (!hasLokasi) {
                    const newOpt = document.createElement('option');
                    newOpt.value = lokVal;
                    newOpt.textContent = lokVal;
                    inputLokasi.appendChild(newOpt);
                }
                inputLokasi.value = lokVal;
            }

            // Restore Mapel (setelah filter diterapkan, set ke value sebelumnya)
            const mapelSelect = document.getElementById('input-mapel');
            if (mapelSelect && docData.mapel) {
                let hasMapel = Array.from(mapelSelect.options).some(opt => opt.value === docData.mapel);
                if (!hasMapel) {
                    // Jika mapel tidak ada di list terfilter, tambahkan sebagai opsi
                    const lastOpt = mapelSelect.querySelector('option[value="Lainnya"]');
                    const newOpt = document.createElement('option');
                    newOpt.value = docData.mapel;
                    newOpt.textContent = docData.mapel;
                    if (lastOpt) {
                        mapelSelect.insertBefore(newOpt, lastOpt);
                    } else {
                        mapelSelect.appendChild(newOpt);
                    }
                }
                mapelSelect.value = docData.mapel;
            }

            // Restore Topik & Catatan
            document.getElementById('input-topik').value = docData.topik || '';
            document.getElementById('input-catatan').value = docData.catatan || '';

            // Restore Jam Pelajaran
            const jpList = parseJpArray(docData.jp);
            selectedJp.clear();
            document.querySelectorAll('.jp-btn').forEach(btn => {
                const val = parseInt(btn.dataset.val);
                if (jpList.includes(val)) {
                    selectedJp.add(val);
                    btn.classList.add('jp-btn-active');
                } else {
                    btn.classList.remove('jp-btn-active');
                }
            });

            // Restore Presensi
            let detailList = docData.presensi_detail;
            if (typeof detailList === 'string') {
                try { detailList = JSON.parse(detailList); } catch (e) { detailList = []; }
            }
            if (Array.isArray(detailList) && detailList.length > 0) {
                setTimeout(() => {
                    detailList.forEach(detail => {
                        const status = detail.status;
                        const namaSiswa = detail.nama;
                        const row = Array.from(document.querySelectorAll('.student-row')).find(r => r.dataset.name === namaSiswa);
                        if (row) {
                            const sId = row.dataset.id;
                            setAttendance(sId, status, true);
                        }
                    });
                }, 300); // Tunggu DOM render sesaat
            } else if (docData.presensi) {
                setTimeout(() => {
                    Object.keys(docData.presensi).forEach(namaSiswa => {
                        const status = docData.presensi[namaSiswa];
                        const row = Array.from(document.querySelectorAll('.student-row')).find(r => r.dataset.name === namaSiswa);
                        if (row) {
                            const sId = row.dataset.id;
                            setAttendance(sId, status, true);
                        }
                    });
                }, 300); // Tunggu DOM render sesaat
            }
            if (typeof window.checkSemesterAttendanceRecapTrigger === 'function') {
                window.checkSemesterAttendanceRecapTrigger();
            }
        } else {
            // MODE INPUT BARU / SCAN QR CODE: Auto-populate JP, Guru & Mapel sesuai jam aktif
            await autoPopulateSchedule(className);
            await autoPreFillDailyAttendance(className);
            if (typeof window.checkSemesterAttendanceRecapTrigger === 'function') {
                window.checkSemesterAttendanceRecapTrigger();
            }
        }

    } catch (e) {
        console.error("Gagal mengambil data siswa:", e);
        document.getElementById('student-list').innerHTML = '<p class="text-center text-red-500">Gagal memuat siswa.</p>';
    }

    initCanvas();
    window.scrollTo(0, 0);

    // GPS: Penanganan Mode Edit vs Input Baru
    if (window.currentEditDocId && window.currentEditData) {
        let oldKoord = window.currentEditData.koordinat;
        if (typeof oldKoord === 'string') {
            try { oldKoord = JSON.parse(oldKoord); } catch (e) { oldKoord = null; }
        }
        const lat = oldKoord ? (oldKoord.lat ?? oldKoord.latitude) : null;
        const lng = oldKoord ? (oldKoord.lng ?? oldKoord.longitude) : null;
        if (lat && lat !== 0) {
            geoCoordinates = { lat, lng };
            const statusEl = document.getElementById('gps-status');
            if (statusEl) {
                statusEl.className = "group flex items-center justify-center w-7 h-7 rounded-full bg-green-50 text-green-600 border border-green-200 shadow-sm";
                statusEl.innerHTML = '<i data-lucide="map-pin" class="w-3.5 h-3.5"></i>';
                statusEl.title = "Menggunakan koordinat jurnal";
                safeRenderLucide();
            }
            console.log("Mode Edit: Menggunakan koordinat lama", geoCoordinates);
        } else {
            // Koordinat lama belum didapat / 0 - set default aman agar mode edit tetap bisa disimpan tanpa blokir GPS
            geoCoordinates = oldKoord || { lat: 0, lng: 0 };
            const statusEl = document.getElementById('gps-status');
            if (statusEl) {
                statusEl.className = "group flex items-center justify-center w-7 h-7 rounded-full bg-slate-100 text-slate-500 border border-slate-200 shadow-sm";
                statusEl.innerHTML = '<i data-lucide="map-pin-off" class="w-3.5 h-3.5"></i>';
                statusEl.title = "Lokasi jurnal lama belum diperoleh (Mode Edit)";
                statusEl.onclick = null;
                safeRenderLucide();
            }
            const banner = document.getElementById('gps-banner');
            if (banner) banner.classList.add('hidden');
            stopGpsRetry();
            console.log("Mode Edit: Koordinat lama belum ada, default {lat: 0, lng: 0}");
        }
    } else {
        getSilentLocation();
    }
}

window.resetApp = function () {
    if (isSubmittingJurnal) return;
    showPopup('confirm', 'Kembali?', 'Data yang belum disimpan akan hilang.', () => {
        if (isSubmittingJurnal) return;
        if (typeof window.closeWebRtcCamera === 'function') window.closeWebRtcCamera();
        discardPhotoUpload();
        // Reset state edit & foto
        window.currentEditDocId = null;
        window.currentEditData = null;
        window.uploadedFotoUrl = null;
        window.uploadedFotoObj = null;
        geoCoordinates = null;

        const ttdOptLabel = document.getElementById('ttd-optional-label');
        if (ttdOptLabel) ttdOptLabel.classList.add('hidden');

        const fileCamera = document.getElementById('file-camera');
        const previewContainer = document.getElementById('preview-container');
        const photoButtons = document.getElementById('photo-buttons');
        const uploadBadge = document.getElementById('upload-status-badge');
        const imagePreview = document.getElementById('image-preview');
        if (fileCamera) {
            fileCamera.disabled = false;
            fileCamera.value = '';
        }
        if (previewContainer) previewContainer.classList.add('hidden');
        if (photoButtons) photoButtons.classList.remove('hidden');
        if (uploadBadge) uploadBadge.classList.add('hidden');
        if (imagePreview) imagePreview.src = '';

        // Aktifkan kembali input guru
        const inputGuru = document.getElementById('input-guru');
        if (inputGuru) inputGuru.disabled = false;

        // Reset & sembunyikan navigasi riwayat presensi & resume
        if (typeof window.resetPresensiNav === 'function') resetPresensiNav();
        const presensiNav = document.getElementById('presensi-nav');
        if (presensiNav) presensiNav.classList.add('hidden');
        const presensiSummary = document.getElementById('presensi-summary');
        if (presensiSummary) presensiSummary.classList.add('hidden');

        document.getElementById('screen-form').classList.add('hidden');
        document.getElementById('screen-scan').classList.remove('hidden');
        loadClasses();
    }, true);
}

// QR Deep Link handler
handleQrDeepLink();

// --- JP BUTTONS ---
window.renderJpButtons = function () {
    const container = document.getElementById('jp-container');
    container.className = "grid grid-cols-5 gap-1.5";

    let html = '';
    const today = new Date().getDay(); // 0 = Minggu, 1 = Senin, ..., 5 = Jumat

    for (let i = 1; i <= 10; i++) {
        let isDisabled = false;
        let disableReason = "";

        if (today === 1 && i === 1) { // Senin JP 1
            isDisabled = true;
            disableReason = "Upacara";
        } else if (today === 5 && i === 10) { // Jumat JP 10
            isDisabled = true;
            disableReason = "Ekskul";
        }

        if (isDisabled) {
            html += `<div title="${disableReason}"
                class="w-full h-8 sm:h-9 flex items-center justify-center rounded-lg text-xs sm:text-sm font-bold bg-gray-100 dark:bg-gray-800/50 text-gray-400 dark:text-gray-600 cursor-not-allowed opacity-50 relative overflow-hidden">
                <span class="z-10">${i}</span>
                <div class="absolute inset-0 bg-striped-disabled opacity-20"></div>
                </div>`;
        } else {
            html += `<button onclick="toggleJp(this, ${i})" id="jp-btn-${i}" data-val="${i}"
                class="jp-btn w-full h-8 sm:h-9 flex items-center justify-center rounded-lg text-xs sm:text-sm font-bold shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5">${i}</button>`;
        }
    }
    container.innerHTML = html;

    window.toggleJp = (btn, val) => {
        if (selectedJp.has(val)) {
            selectedJp.delete(val);
            btn.classList.remove('jp-btn-active');
        } else {
            selectedJp.add(val);
            btn.classList.add('jp-btn-active');

            if (selectedJp.size >= 2) {
                const allSelected = Array.from(selectedJp);
                const min = Math.min(...allSelected);
                const max = Math.max(...allSelected);

                for (let k = min + 1; k < max; k++) {
                    if (!selectedJp.has(k)) {
                        selectedJp.add(k);
                        const b = document.getElementById(`jp-btn-${k}`);
                        if (b) b.classList.add('jp-btn-active');
                    }
                }
            }
        }
    }
}

window.checkHistoryTrigger = async function () {
    const guru = document.getElementById('input-guru').value;
    const mapel = document.getElementById('input-mapel').value;
    const section = document.getElementById('section-history');

    if (guru && mapel) {
        const cacheKey = `hist_${guru.replace(/\s/g, '')}_${mapel.replace(/\s/g, '')}_${currentClass.name.replace(/\s/g, '')}`;
        const cachedData = CacheHelper.get(cacheKey);

        if (cachedData) {
            renderHistory(cachedData);
            return;
        }

        try {
            if (CloudflareAPI.isEnabled) {
                const historyRes = await CloudflareAPI.getHistory({
                    guru,
                    mapel,
                    class: currentClass.name,
                    limit: 1
                });
                if (historyRes) {
                    const item = Array.isArray(historyRes) ? historyRes[0] : historyRes;
                    if (item && item.topik) {
                        const historyData = {
                            topik: item.topik,
                            catatan: item.catatan || '',
                            timestamp: item.timestamp ? new Date(item.timestamp).getTime() : Date.now()
                        };
                        CacheHelper.set(cacheKey, historyData);
                        renderHistory(historyData);
                        return;
                    }
                }
            }
            section.classList.add('hidden');
        } catch (e) {
            console.log("No history found in Cloudflare D1:", e);
            section.classList.add('hidden');
        }
    } else {
        section.classList.add('hidden');
    }

    function renderHistory(data) {
        const date = data.timestamp ? new Date(data.timestamp).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : '-';
        document.getElementById('hist-mapel').textContent = mapel;
        document.getElementById('hist-date').textContent = date;
        document.getElementById('hist-topic').textContent = data.topik;
        document.getElementById('hist-note').textContent = data.catatan || '-';
        section.classList.remove('hidden');
    }
}

window.filterMapelByGuru = function (preferredMapel = null) {
    const guruInput = document.getElementById('input-guru');
    const guruName = (guruInput ? guruInput.value : '').trim();
    const mapelSelect = document.getElementById('input-mapel');
    if (!mapelSelect) return;

    if (!guruName) {
        if (window.allMapelsHtml) mapelSelect.innerHTML = window.allMapelsHtml;
        mapelSelect.value = '';
        checkManualMapel();
        checkHistoryTrigger();
        return;
    }

    const currentMapelVal = (preferredMapel || mapelSelect.value || '').trim();

    // 1. Deteksi mapel dari Jadwal.xml hari ini & hari lain di kelas ini
    let todaySchedMapel = '';
    const classSchedMapels = [];
    if (cachedScheduleData && cachedScheduleData.scheduleMap && currentClass && currentClass.name) {
        const className = currentClass.name;
        const now = new Date();
        const dayOfWeek = now.getDay(); // 1=Senin ... 5=Jumat

        // Cek hari ini
        const daySched = cachedScheduleData.scheduleMap[className]?.[dayOfWeek];
        if (daySched) {
            for (let jp = 1; jp <= 10; jp++) {
                const slot = daySched[jp];
                if (slot && slot.guruNama && slot.mapel && slot.mapel.toUpperCase() !== 'UPACARA') {
                    const isDirectMatch = (slot.guruNama === guruName) ||
                                          (typeof smartMatchTeacher === 'function' && smartMatchTeacher(slot.guruNama, [{ nama: guruName }]) === guruName) ||
                                          (typeof smartMatchTeacher === 'function' && smartMatchTeacher(guruName, [{ nama: slot.guruNama }]) === slot.guruNama) ||
                                          (typeof normalizeTeacherName === 'function' && normalizeTeacherName(slot.guruNama) === normalizeTeacherName(guruName)) ||
                                          (slot.guruNama.toLowerCase().includes(guruName.toLowerCase())) ||
                                          (guruName.toLowerCase().includes(slot.guruNama.toLowerCase()));

                    if (isDirectMatch) {
                        todaySchedMapel = slot.mapel;
                        break;
                    }
                }
            }
        }

        // Cek jadwal hari lainnya di kelas ini (untuk opsi alternatif jika tidak mengajar hari ini)
        const classSched = cachedScheduleData.scheduleMap[className];
        if (classSched) {
            for (let d = 1; d <= 5; d++) {
                const dSched = classSched[d];
                if (!dSched) continue;
                for (let jp = 1; jp <= 10; jp++) {
                    const slot = dSched[jp];
                    if (slot && slot.guruNama && slot.mapel && slot.mapel.toUpperCase() !== 'UPACARA') {
                        const isDirectMatch = (slot.guruNama === guruName) ||
                                              (typeof smartMatchTeacher === 'function' && smartMatchTeacher(slot.guruNama, [{ nama: guruName }]) === guruName) ||
                                              (typeof smartMatchTeacher === 'function' && smartMatchTeacher(guruName, [{ nama: slot.guruNama }]) === slot.guruNama) ||
                                              (typeof normalizeTeacherName === 'function' && normalizeTeacherName(slot.guruNama) === normalizeTeacherName(guruName)) ||
                                              (slot.guruNama.toLowerCase().includes(guruName.toLowerCase())) ||
                                              (guruName.toLowerCase().includes(slot.guruNama.toLowerCase()));

                        if (isDirectMatch && !classSchedMapels.includes(slot.mapel)) {
                            classSchedMapels.push(slot.mapel);
                        }
                    }
                }
            }
        }
    }

    // 2. Cari data guru dari guruDetailsMap atau activeTeachers
    let details = window.guruDetailsMap ? window.guruDetailsMap[guruName] : null;
    if (!details && Array.isArray(activeTeachers)) {
        const t = activeTeachers.find(item => {
            if (!item || !item.nama) return false;
            return item.nama === guruName ||
                   (typeof smartMatchTeacher === 'function' && smartMatchTeacher(guruName, [item]) === item.nama) ||
                   (typeof normalizeTeacherName === 'function' && normalizeTeacherName(item.nama) === normalizeTeacherName(guruName));
        });
        if (t) {
            let parsedMapel = [];
            if (Array.isArray(t.mapel)) {
                parsedMapel = t.mapel;
            } else if (typeof t.mapel === 'string' && t.mapel.trim()) {
                parsedMapel = t.mapel.split(/[,;]/).map(s => s.trim()).filter(Boolean);
            }
            details = {
                uid: t.uid || t.id || null,
                mengajar: Array.isArray(t.mengajar) ? t.mengajar : [],
                mapel: parsedMapel
            };
        }
    }

    const matches = [];
    const addMatch = (m) => {
        if (m && typeof m === 'string' && m.trim()) {
            const trimmed = m.trim();
            if (!matches.includes(trimmed) && trimmed.toUpperCase() !== 'UPACARA') {
                matches.push(trimmed);
            }
        }
    };

    if (todaySchedMapel) addMatch(todaySchedMapel);
    classSchedMapels.forEach(addMatch);

    if (details) {
        if (details.mengajar && Array.isArray(details.mengajar)) {
            details.mengajar.forEach(m => {
                if (Array.isArray(m.kelas) && currentClass && m.kelas.includes(currentClass.name)) {
                    addMatch(m.nama);
                }
            });
        }
        if (details.mapel) {
            if (Array.isArray(details.mapel)) {
                details.mapel.forEach(addMatch);
            } else if (typeof details.mapel === 'string') {
                details.mapel.split(/[,;]/).forEach(addMatch);
            }
        }
    }

    // Tentukan mapel yang akan dipilih secara otomatis
    let targetToSelect = '';
    if (preferredMapel && (matches.includes(preferredMapel) || preferredMapel !== 'Lainnya')) {
        targetToSelect = preferredMapel;
    } else if (todaySchedMapel) {
        targetToSelect = todaySchedMapel;
    } else if (currentMapelVal && (matches.includes(currentMapelVal) || currentMapelVal !== 'Lainnya')) {
        targetToSelect = currentMapelVal;
    } else if (matches.length > 0) {
        targetToSelect = matches[0];
    }

    if (matches.length > 0) {
        let html = '';
        matches.forEach(m => {
            html += `<option value="${m}">${m}</option>`;
        });
        if (!matches.includes('Lainnya')) {
            html += '<option value="Lainnya" class="font-bold text-blue-600">Mapel Lain</option>';
        }
        mapelSelect.innerHTML = html;

        if (targetToSelect && targetToSelect !== 'Lainnya') {
            let hasOpt = Array.from(mapelSelect.options).some(o => o.value === targetToSelect);
            if (!hasOpt) {
                const lastOpt = mapelSelect.querySelector('option[value="Lainnya"]');
                const newOpt = document.createElement('option');
                newOpt.value = targetToSelect;
                newOpt.textContent = targetToSelect;
                if (lastOpt) {
                    mapelSelect.insertBefore(newOpt, lastOpt);
                } else {
                    mapelSelect.appendChild(newOpt);
                }
            }
            mapelSelect.value = targetToSelect;
        } else if (targetToSelect === 'Lainnya') {
            mapelSelect.value = 'Lainnya';
        } else {
            mapelSelect.value = matches[0];
        }
    } else {
        if (window.allMapelsHtml) mapelSelect.innerHTML = window.allMapelsHtml;
        if (!mapelSelect.innerHTML.includes('value="Lainnya"')) {
            mapelSelect.innerHTML += '<option value="Lainnya" class="font-bold text-blue-600">Mapel Lain</option>';
        }
        if (targetToSelect) {
            mapelSelect.value = targetToSelect;
        } else {
            mapelSelect.value = '';
        }
    }

    checkManualMapel();
    checkHistoryTrigger();
    if (typeof window.checkSemesterAttendanceRecapTrigger === 'function') {
        window.checkSemesterAttendanceRecapTrigger();
    }
};

window.updateAttendanceSummary = function () {
    const rows = document.querySelectorAll('.student-row');
    const total = rows.length;
    let counts = { H: 0, S: 0, I: 0, A: 0, D: 0, T: 0 };

    rows.forEach(row => {
        const id = row.dataset.id;
        const cont = document.getElementById(`attendance-${id}`);
        const val = cont ? cont.dataset.value || 'H' : 'H';
        if (counts.hasOwnProperty(val)) {
            counts[val]++;
        } else {
            counts.H++;
        }
    });

    const elTotal = document.getElementById('sum-total');
    const elH = document.getElementById('sum-h');
    const elS = document.getElementById('sum-s');
    const elI = document.getElementById('sum-i');
    const elA = document.getElementById('sum-a');
    const elD = document.getElementById('sum-d');
    const elT = document.getElementById('sum-t');

    if (elTotal) elTotal.textContent = total;
    if (elH) elH.textContent = counts.H;

    const zeroCls = 'bg-white/60 dark:bg-gray-800/60 text-gray-400 dark:text-gray-500 border border-gray-200/50 dark:border-gray-700/50';

    const updateBadge = (el, count, activeStyle) => {
        if (!el) return;
        el.textContent = count;
        if (count > 0) {
            el.className = `w-7 h-7 rounded text-[10px] font-black flex items-center justify-center transition-all ${activeStyle}`;
        } else {
            el.className = `w-7 h-7 rounded text-[10px] font-semibold flex items-center justify-center transition-all ${zeroCls}`;
        }
    };

    updateBadge(elS, counts.S, 'bg-yellow-400 text-slate-900 border border-yellow-500 font-black shadow-xs');
    updateBadge(elI, counts.I, 'bg-blue-400 text-white border border-blue-500 font-black shadow-xs');
    updateBadge(elA, counts.A, 'bg-red-500 text-white border border-red-600 font-black shadow-xs');
    updateBadge(elD, counts.D, 'bg-purple-500 text-white border border-purple-600 font-black shadow-xs');
    updateBadge(elT, counts.T, 'bg-gray-500 text-white border border-gray-600 font-black shadow-xs');
};

// --- MODUL REKAPITULASI KEHADIRAN MAPEL SEMESTER BERJALAN ---
window.semesterAttendanceCache = {}; // Key: `${className}__${mapelName}__${semRange.startDate}` -> { pastEntries, studentMap, semRange }
window.currentSemesterAttendanceData = null;
window.activeRecapPopoverStudentId = null;

function getSemesterDateRange(refDate = new Date()) {
    const year = refDate.getFullYear();
    const month = refDate.getMonth(); // 0 = Jan, 6 = Juli, 11 = Des
    let startYear, endYear, startMonth, endMonth, startDay, endDay, semNum, semLabel;
    if (month >= 6) { // Juli - Des (Semester Ganjil / 1)
        startYear = year;
        endYear = year;
        startMonth = '07';
        endMonth = '12';
        startDay = '01';
        endDay = '31';
        semNum = '1';
        semLabel = 'Ganjil';
    } else { // Jan - Juni (Semester Genap / 2)
        startYear = year;
        endYear = year;
        startMonth = '01';
        endMonth = '06';
        startDay = '01';
        endDay = '30';
        semNum = '2';
        semLabel = 'Genap';
    }
    const taStr = (month >= 6) ? `${year}/${year + 1}` : `${year - 1}/${year}`;
    return {
        startDate: `${startYear}-${startMonth}-${startDay}`,
        endDate: `${endYear}-${endMonth}-${endDay}`,
        semester: semNum,
        semLabel,
        academicYear: taStr
    };
}

function normalizeStudentString(str) {
    return String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

window.loadSemesterAttendanceRecap = async function (className, mapelName) {
    if (!className || !mapelName || mapelName === 'Lainnya' || mapelName === 'Lainnya...') {
        window.currentSemesterAttendanceData = null;
        window.refreshAllStudentRecapBadges();
        return;
    }

    const semRange = getSemesterDateRange(new Date());
    const cacheKey = `${className}__${mapelName}__${semRange.startDate}__${semRange.endDate}`;

    if (window.semesterAttendanceCache[cacheKey]) {
        window.currentSemesterAttendanceData = window.semesterAttendanceCache[cacheKey];
        window.refreshAllStudentRecapBadges();
        if (window.activeRecapPopoverStudentId) {
            window.updateOpenPopoverIfMatching(window.activeRecapPopoverStudentId);
        }
        return;
    }

    try {
        let entries = [];
        if (CloudflareAPI && CloudflareAPI.isEnabled) {
            entries = await CloudflareAPI.getRecap({
                class: className,
                mapel: mapelName,
                start_date: semRange.startDate,
                end_date: semRange.endDate,
                exclude_ttd: 1,
                limit: 100
            });
        }

        // Filter entri: jangan sertakan dokumen yang sedang diedit (window.currentEditDocId)
        const pastEntries = (Array.isArray(entries) ? entries : [])
            .filter(e => {
                if (window.currentEditDocId && String(e.id) === String(window.currentEditDocId)) return false;
                return true;
            })
            .sort((a, b) => (a.tanggal || '').localeCompare(b.tanggal || '') || (a.id || '').localeCompare(b.id || ''));

        // Bangun data rekap per siswa yang ada di baris siswa saat ini
        const studentMap = {};
        document.querySelectorAll('.student-row').forEach(row => {
            const sId = row.dataset.id;
            const sName = row.dataset.name;
            const sNis = row.dataset.nis;
            const sAbsen = row.dataset.absen;

            const pastCounts = { H: 0, S: 0, I: 0, A: 0, D: 0, T: 0 };
            const pastMeetings = [];

            pastEntries.forEach(entry => {
                let detailList = entry.presensi_detail;
                if (typeof detailList === 'string') {
                    try { detailList = JSON.parse(detailList); } catch (e) { detailList = []; }
                }

                let studentStatus = 'H'; // Default hadir jika tidak ada di catatan ketidakhadiran
                if (Array.isArray(detailList) && detailList.length > 0) {
                    const match = detailList.find(d => {
                        if (sNis && d.nis && String(d.nis).trim() === String(sNis).trim()) return true;
                        if (normalizeStudentString(d.nama) === normalizeStudentString(sName)) return true;
                        return false;
                    });
                    if (match && match.status) {
                        studentStatus = String(match.status).toUpperCase();
                    }
                } else if (entry.presensi && typeof entry.presensi === 'object') {
                    // Fallback skema presensi objek lama { "Nama Siswa": "S" }
                    const matchedKey = Object.keys(entry.presensi).find(k => normalizeStudentString(k) === normalizeStudentString(sName));
                    if (matchedKey && entry.presensi[matchedKey]) {
                        studentStatus = String(entry.presensi[matchedKey]).toUpperCase();
                    }
                }

                if (!['H', 'S', 'I', 'A', 'D', 'T'].includes(studentStatus)) {
                    studentStatus = 'H';
                }

                pastCounts[studentStatus] = (pastCounts[studentStatus] || 0) + 1;
                pastMeetings.push({
                    id: entry.id,
                    tanggal: entry.tanggal || '',
                    jp: entry.jp || '',
                    topik: entry.topik || 'Materi KBM',
                    status: studentStatus
                });
            });

            studentMap[sId] = {
                id: sId,
                name: sName,
                nis: sNis,
                absen: sAbsen,
                pastCounts,
                pastMeetings,
                totalPastMeetings: pastMeetings.length
            };
        });

        const recapData = {
            className,
            mapelName,
            semRange,
            pastEntriesCount: pastEntries.length,
            studentMap
        };

        window.semesterAttendanceCache[cacheKey] = recapData;
        window.currentSemesterAttendanceData = recapData;
        window.refreshAllStudentRecapBadges();

        if (window.activeRecapPopoverStudentId) {
            window.updateOpenPopoverIfMatching(window.activeRecapPopoverStudentId);
        }
    } catch (err) {
        console.warn("[SemesterRecap] Gagal memuat rekap kehadiran semester:", err);
    }
};

window.checkSemesterAttendanceRecapTrigger = function () {
    const className = currentClass ? currentClass.name : '';
    let mapelName = document.getElementById('input-mapel')?.value?.trim() || '';
    if (mapelName === 'Lainnya' || mapelName === 'Lainnya...') {
        mapelName = document.getElementById('input-mapel-manual')?.value?.trim() || '';
    }
    if (className && mapelName) {
        window.loadSemesterAttendanceRecap(className, mapelName);
    } else {
        window.currentSemesterAttendanceData = null;
        window.refreshAllStudentRecapBadges();
    }
};

window.calculateStudentDynamicRecap = function (studentId, rowEl = null) {
    let row = rowEl;
    if (!row && studentId) {
        try {
            row = document.querySelector(`.student-row[data-id="${CSS.escape ? CSS.escape(String(studentId)) : studentId}"]`);
        } catch (e) {
            row = null;
        }
    }
    if (!row && studentId) {
        const allRows = document.querySelectorAll('.student-row');
        row = Array.from(allRows).find(r => r.dataset.id === String(studentId) || (r.dataset.nis && r.dataset.nis === String(studentId)));
    }
    if (!row) {
        console.warn("[SemesterRecap] Baris siswa tidak ditemukan untuk ID:", studentId);
        return null;
    }

    const sName = row.dataset.name || 'Siswa';
    const sNis = row.dataset.nis || '';
    const sAbsen = row.dataset.absen || '--';
    const resolvedId = row.dataset.id || studentId;
    const currentStatus = document.getElementById(`attendance-${resolvedId}`)?.dataset?.value || 'H';

    const data = window.currentSemesterAttendanceData;
    const studentData = data?.studentMap?.[resolvedId] || data?.studentMap?.[studentId];

    const pastCounts = studentData?.pastCounts || { H: 0, S: 0, I: 0, A: 0, D: 0, T: 0 };
    const pastMeetings = studentData?.pastMeetings || [];

    // Gabungkan hari ini (pertemuan aktif di form)
    const counts = {
        H: (pastCounts.H || 0) + (currentStatus === 'H' ? 1 : 0),
        S: (pastCounts.S || 0) + (currentStatus === 'S' ? 1 : 0),
        I: (pastCounts.I || 0) + (currentStatus === 'I' ? 1 : 0),
        A: (pastCounts.A || 0) + (currentStatus === 'A' ? 1 : 0),
        D: (pastCounts.D || 0) + (currentStatus === 'D' ? 1 : 0),
        T: (pastCounts.T || 0) + (currentStatus === 'T' ? 1 : 0)
    };

    const totalMeetings = (studentData?.totalPastMeetings || 0) + 1; // Termasuk pertemuan hari ini

    // Formula Kehadiran Murni (H / Total * 100)
    let percent = totalMeetings > 0 ? Math.round((counts.H / totalMeetings) * 100) : 100;
    if (percent > 100) percent = 100;
    if (percent < 0) percent = 0;

    let statusLabel = 'Aman';
    let statusColor = 'emerald';
    if (percent < 75) {
        statusLabel = 'Kritis';
        statusColor = 'rose';
    } else if (percent < 85) {
        statusLabel = 'Waspada';
        statusColor = 'amber';
    }

    const hasAlpa = counts.A > 0;

    // Siapkan 5 Pertemuan Lampau Terakhir (lampau -> terkini)
    const recentSlices = pastMeetings.slice(-5).map(m => ({
        id: m.id,
        tanggal: m.tanggal,
        topik: m.topik,
        status: m.status,
        isToday: false
    }));

    return {
        studentId: resolvedId,
        studentName: sName,
        studentNis: sNis,
        studentAbsen: sAbsen,
        className: currentClass?.name || '',
        mapelName: data?.mapelName || document.getElementById('input-mapel')?.value || '',
        semLabel: data?.semRange?.semLabel || 'Ganjil',
        semNum: data?.semRange?.semester || '1',
        academicYear: data?.semRange?.academicYear || '',
        totalMeetings,
        counts,
        percent,
        statusLabel,
        statusColor,
        hasAlpa,
        recentMeetings: recentSlices
    };
};

function formatDMDate(dateStr) {
    if (!dateStr) return '-';
    const parts = String(dateStr).split(/[-/T ]/);
    if (parts.length >= 3) {
        if (parts[0].length === 4) {
            // YYYY-MM-DD -> d/m
            const m = parseInt(parts[1], 10);
            const d = parseInt(parts[2], 10);
            if (!isNaN(m) && !isNaN(d)) return `${d}/${m}`;
        } else if (parts[2].length === 4) {
            // DD-MM-YYYY -> d/m
            const d = parseInt(parts[0], 10);
            const m = parseInt(parts[1], 10);
            if (!isNaN(m) && !isNaN(d)) return `${d}/${m}`;
        }
    }
    const dt = new Date(dateStr);
    if (!isNaN(dt.getTime())) {
        return `${dt.getDate()}/${dt.getMonth() + 1}`;
    }
    return String(dateStr).substring(0, 5);
}
const formatMDDate = formatDMDate;

window.updateStudentRecapBadge = function (studentId) {
    const pill = document.getElementById(`recap-ghost-pill-${studentId}`);
    if (!pill) return;

    if (!window.currentSemesterAttendanceData) {
        pill.textContent = '--%';
        pill.className = "student-ghost-pill inline-flex items-center justify-center px-1.5 py-0.2 rounded text-[9.5px] font-mono font-bold shrink-0 opacity-60 hover:opacity-100 transition-all bg-slate-500/10 text-slate-500 dark:text-slate-400 border border-slate-300/30 dark:border-slate-600/30 cursor-pointer mr-1";
        pill.title = "Pilih Mapel untuk melihat persentase kehadiran semester (Klik untuk rincian)";
        return;
    }

    const recap = window.calculateStudentDynamicRecap(studentId);
    if (!recap) return;

    let colorClasses = "bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/20 dark:border-emerald-500/30";
    if (recap.statusColor === 'rose') {
        colorClasses = "bg-rose-500/10 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/20 dark:border-rose-500/30";
    } else if (recap.statusColor === 'amber') {
        colorClasses = "bg-amber-500/10 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/20 dark:border-amber-500/30";
    }

    pill.className = `student-ghost-pill inline-flex items-center justify-center px-1.5 py-0.2 rounded text-[9.5px] font-mono font-bold shrink-0 opacity-60 hover:opacity-100 transition-all border cursor-pointer mr-1 ${colorClasses}`;
    pill.textContent = `${recap.percent}%`;
    pill.title = `${recap.studentName}: Hadir ${recap.counts.H}/${recap.totalMeetings} (${recap.percent}% - ${recap.statusLabel}) - Klik untuk rincian`;
};

window.refreshAllStudentRecapBadges = function () {
    document.querySelectorAll('.student-row').forEach(row => {
        window.updateStudentRecapBadge(row.dataset.id);
    });
};

window.activeExpandedStudentId = null;
window.studentRecapCollapseTimer = null;
const STUDENT_RECAP_AUTO_COLLAPSE_MS = 10000;

window.closeAllStudentRecapPanels = function () {
    if (window.studentRecapCollapseTimer) {
        clearTimeout(window.studentRecapCollapseTimer);
        window.studentRecapCollapseTimer = null;
    }
    window.activeExpandedStudentId = null;

    document.querySelectorAll('.student-recap-panel').forEach(panel => {
        panel.classList.add('hidden');
    });

    document.querySelectorAll('.student-item-wrapper').forEach(wrap => {
        wrap.classList.remove('border-blue-300', 'dark:border-blue-600/50', 'shadow-xs');
        wrap.classList.add('border-transparent', 'dark:border-gray-700/40');
    });
};

window.toggleStudentRecapPanel = function (studentId, rowEl = null) {
    if (!studentId && rowEl) {
        studentId = rowEl.dataset?.id || rowEl.dataset?.nis;
    }
    if (!studentId) return;

    const sId = String(studentId);

    // Toggle: Jika sedang terbuka, klik lagi langsung menutupnya
    if (window.activeExpandedStudentId === sId) {
        window.closeAllStudentRecapPanels();
        return;
    }

    // Tutup panel lain
    window.closeAllStudentRecapPanels();

    // Buka panel siswa yang dipilih
    window.openStudentRecapPanel(sId, rowEl);
};

window.openStudentRecapPanel = function (studentId, rowEl = null) {
    if (!studentId && rowEl) {
        studentId = rowEl.dataset?.id || rowEl.dataset?.nis;
    }
    if (!studentId) return;

    const sId = String(studentId);
    const panel = document.getElementById(`student-recap-panel-${sId}`);
    if (!panel) return;

    if (!rowEl) {
        try {
            rowEl = document.querySelector(`.student-row[data-id="${CSS.escape ? CSS.escape(sId) : sId}"]`);
        } catch (e) {
            rowEl = null;
        }
    }

    const recap = window.calculateStudentDynamicRecap(sId, rowEl);
    if (!recap) return;

    // Update pill persentase di baris siswa
    window.updateStudentRecapBadge(sId);

    // Baris 1: Nilai counter H, S, I, A, D, T
    const elH = document.getElementById(`recap-panel-h-${sId}`);
    const elS = document.getElementById(`recap-panel-s-${sId}`);
    const elI = document.getElementById(`recap-panel-i-${sId}`);
    const elA = document.getElementById(`recap-panel-a-${sId}`);
    const elD = document.getElementById(`recap-panel-d-${sId}`);
    const elT = document.getElementById(`recap-panel-t-${sId}`);

    if (elH) elH.textContent = recap.counts.H;
    if (elS) elS.textContent = recap.counts.S;
    if (elI) elI.textContent = recap.counts.I;
    if (elA) elA.textContent = recap.counts.A;
    if (elD) elD.textContent = recap.counts.D;
    if (elT) elT.textContent = recap.counts.T;

    // Alert Alpa / Kritis
    const elAlert = document.getElementById(`recap-panel-alert-${sId}`);
    const elAlertText = document.getElementById(`recap-panel-alert-text-${sId}`);
    if (elAlert) {
        if (recap.hasAlpa) {
            elAlert.classList.remove('hidden');
            if (elAlertText) elAlertText.textContent = `${recap.counts.A} Alpa!`;
            elAlert.title = `Peringatan: Siswa memiliki ${recap.counts.A} catatan Alpa tanpa keterangan pada mapel ini.`;
        } else {
            elAlert.classList.add('hidden');
        }
    }

    // Baris 2: 5 Pertemuan Terakhir Lampau dengan Format m/d: Status
    const elRecent = document.getElementById(`recap-panel-recent-${sId}`);
    if (elRecent) {
        const statusColors = {
            'H': 'text-emerald-600 dark:text-emerald-400',
            'S': 'text-yellow-600 dark:text-yellow-400',
            'I': 'text-blue-600 dark:text-blue-400',
            'A': 'text-rose-600 dark:text-rose-400',
            'D': 'text-purple-600 dark:text-purple-400',
            'T': 'text-gray-600 dark:text-gray-400'
        };

        const slice5 = (recap.recentMeetings || []).slice(-5);
        if (slice5.length === 0) {
            elRecent.innerHTML = `<span class="italic text-[8.5px] text-gray-400">Belum ada riwayat pertemuan.</span>`;
        } else {
            elRecent.innerHTML = slice5.map(m => {
                const color = statusColors[m.status] || 'text-gray-600';
                const dm = formatDMDate(m.tanggal);
                const topik = m.topik ? escapeHTML(m.topik) : '';
                return `
                    <span class="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded bg-white dark:bg-gray-800 border border-gray-200/70 dark:border-gray-700/70 text-[9px] shadow-2xs font-mono shrink-0" title="${escapeHTML(m.tanggal || '')}: ${topik || m.status}">
                        <span class="text-gray-500 dark:text-gray-400">${dm}:</span>
                        <b class="${color}">${m.status}</b>
                    </span>
                `;
            }).join('');
        }
    }

    // Tampilkan panel
    panel.classList.remove('hidden');

    // Highlight wrapper
    const wrapper = document.getElementById(`student-item-${sId}`);
    if (wrapper) {
        wrapper.classList.remove('border-transparent', 'dark:border-gray-700/40');
        wrapper.classList.add('border-blue-300', 'dark:border-blue-600/50', 'shadow-xs');
    }

    window.activeExpandedStudentId = sId;

    // Mulai timer auto-collapse 10 detik
    if (window.studentRecapCollapseTimer) clearTimeout(window.studentRecapCollapseTimer);
    window.studentRecapCollapseTimer = setTimeout(() => {
        window.closeAllStudentRecapPanels();
    }, STUDENT_RECAP_AUTO_COLLAPSE_MS);

    safeRenderLucide();
};

window.updateOpenStudentRecapPanel = function (studentId) {
    if (window.activeExpandedStudentId && String(window.activeExpandedStudentId) === String(studentId)) {
        window.openStudentRecapPanel(studentId);
    }
};

// Aliases untuk integrasi & backward compatibility
window.handleStudentRowClick = function (rowEl) {
    if (!rowEl) return;
    const studentId = rowEl.dataset?.id || rowEl.dataset?.nis;
    if (typeof window.toggleHighlight === 'function') {
        window.toggleHighlight(rowEl, true);
    }
    window.toggleStudentRecapPanel(studentId, rowEl);
};

window.openStudentRecapModal = function (studentId, rowEl = null) {
    window.openStudentRecapPanel(studentId, rowEl);
};

window.closeStudentRecapModal = function () {
    window.closeAllStudentRecapPanels();
};

window.updateOpenPopoverIfMatching = function (studentId) {
    window.updateOpenStudentRecapPanel(studentId);
};

window.renderStudents = function (studentList) {
    const container = document.getElementById('student-list');
    const summaryEl = document.getElementById('presensi-summary');

    // Tutup panel aktif jika daftar siswa dirender ulang
    window.closeAllStudentRecapPanels();

    if (Array.isArray(studentList)) {
        studentList.forEach((s, idx) => {
            if (!s.id) s.id = s.nis ? String(s.nis) : `std-${idx}`;
            if (!s.name && s.nama) s.name = s.nama;
            if (!s.name && !s.nama) s.name = 'Siswa';
        });
    }

    if (studentList && studentList.length > 0) {
        if (summaryEl) summaryEl.classList.remove('hidden');
    } else {
        if (summaryEl) summaryEl.classList.add('hidden');
    }

    container.innerHTML = studentList.map((s, idx) => `
        <div class="student-item-wrapper rounded border border-transparent dark:border-gray-700/40 bg-gray-50/50 dark:bg-gray-800/50 hover:bg-white dark:hover:bg-gray-800 transition-all overflow-hidden mb-1" id="student-item-${s.id}">
            <!-- Baris Siswa Normal: 1 Baris Ramping, Anti-Truncate, Ghost Pill di Kanan Sebelum Tombol -->
            <div class="flex items-center justify-between py-1.5 px-2 student-row cursor-pointer" data-id="${s.id}" data-name="${escapeHTML(s.name)}" data-nis="${escapeHTML(s.nis || '')}" data-absen="${idx + 1}" onclick="window.handleStudentRowClick(this)">
                <div class="flex items-center gap-1.5 flex-1 min-w-0 mr-1.5 rounded px-1 transition-colors">
                    <span class="text-[9px] font-bold text-gray-400 dark:text-gray-500 shrink-0 w-4 text-center student-absen">${idx + 1}</span>
                    <span class="text-[11px] sm:text-xs font-semibold text-gray-700 dark:text-gray-300 break-words text-left min-w-0 flex-1 leading-tight student-name pr-1" title="${escapeHTML(s.name)}">${escapeHTML(s.name)}</span>
                    <span id="recap-ghost-pill-${s.id}" onclick="event.stopPropagation(); window.handleStudentRowClick(this.closest('.student-row'))" class="student-ghost-pill inline-flex items-center justify-center px-1.5 py-0.2 rounded text-[9.5px] font-mono font-bold shrink-0 opacity-60 hover:opacity-100 transition-all bg-slate-500/10 text-slate-500 dark:text-slate-400 border border-slate-300/30 dark:border-slate-600/30 cursor-pointer mr-1" title="Persentase Kehadiran Mapel Semester (Klik untuk rincian)">--%</span>
                </div>
                <div class="flex gap-px shrink-0" id="attendance-${s.id}" data-value="H">
                    <button onclick="event.stopPropagation(); setAttendance('${s.id}', 'S')" class="att-btn w-7 h-7 rounded text-[10px] font-bold bg-white dark:bg-gray-700 text-gray-400 dark:text-gray-300 border border-gray-100 dark:border-gray-600" data-status="S">S</button>
                    <button onclick="event.stopPropagation(); setAttendance('${s.id}', 'I')" class="att-btn w-7 h-7 rounded text-[10px] font-bold bg-white dark:bg-gray-700 text-gray-400 dark:text-gray-300 border border-gray-100 dark:border-gray-600" data-status="I">I</button>
                    <button onclick="event.stopPropagation(); setAttendance('${s.id}', 'A')" class="att-btn w-7 h-7 rounded text-[10px] font-bold bg-white dark:bg-gray-700 text-gray-400 dark:text-gray-300 border border-gray-100 dark:border-gray-600" data-status="A">A</button>
                    <button onclick="event.stopPropagation(); setAttendance('${s.id}', 'D')" class="att-btn w-7 h-7 rounded text-[10px] font-bold bg-white dark:bg-gray-700 text-gray-400 dark:text-gray-300 border border-gray-100 dark:border-gray-600" data-status="D">D</button>
                    <button onclick="event.stopPropagation(); setAttendance('${s.id}', 'T')" class="att-btn w-7 h-7 rounded text-[10px] font-bold bg-white dark:bg-gray-700 text-gray-400 dark:text-gray-300 border border-gray-100 dark:border-gray-600" data-status="T">T</button>
                </div>
            </div>
            <!-- Panel Expand 2-Baris Lega (~50px): 6 Counter Status di Baris 1 + 5 Riwayat di Baris 2 (Tanpa Persentase) -->
            <div id="student-recap-panel-${s.id}" class="student-recap-panel hidden border-t border-blue-200/40 dark:border-blue-900/40 bg-blue-50/40 dark:bg-slate-900/60 px-2.5 py-1.5 transition-all text-[10px]">
                <!-- Baris 1: 6 Counter Status Lega + Alert Alpa -->
                <div class="flex items-center justify-between gap-1.5 mb-1.5">
                    <div class="grid grid-cols-6 gap-1 flex-1 text-center" style="display: grid; grid-template-columns: repeat(6, minmax(0, 1fr));">
                        <div class="px-1 py-0.5 rounded bg-emerald-100/70 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300/40 dark:border-emerald-800/40 leading-tight">
                            <span class="text-[8px] font-bold block">H</span>
                            <span id="recap-panel-h-${s.id}" class="text-[10px] font-black">0</span>
                        </div>
                        <div class="px-1 py-0.5 rounded bg-yellow-100/70 dark:bg-yellow-950/60 text-yellow-800 dark:text-yellow-300 border border-yellow-300/40 dark:border-yellow-800/40 leading-tight">
                            <span class="text-[8px] font-bold block">S</span>
                            <span id="recap-panel-s-${s.id}" class="text-[10px] font-black">0</span>
                        </div>
                        <div class="px-1 py-0.5 rounded bg-blue-100/70 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border border-blue-300/40 dark:border-blue-800/40 leading-tight">
                            <span class="text-[8px] font-bold block">I</span>
                            <span id="recap-panel-i-${s.id}" class="text-[10px] font-black">0</span>
                        </div>
                        <div class="px-1 py-0.5 rounded bg-rose-100/70 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border border-rose-300/40 dark:border-rose-800/40 leading-tight">
                            <span class="text-[8px] font-bold block">A</span>
                            <span id="recap-panel-a-${s.id}" class="text-[10px] font-black">0</span>
                        </div>
                        <div class="px-1 py-0.5 rounded bg-purple-100/70 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300 border border-purple-300/40 dark:border-purple-800/40 leading-tight">
                            <span class="text-[8px] font-bold block">D</span>
                            <span id="recap-panel-d-${s.id}" class="text-[10px] font-black">0</span>
                        </div>
                        <div class="px-1 py-0.5 rounded bg-gray-200 dark:bg-gray-800 text-gray-800 dark:text-gray-300 border border-gray-300/40 dark:border-gray-700/40 leading-tight">
                            <span class="text-[8px] font-bold block">T</span>
                            <span id="recap-panel-t-${s.id}" class="text-[10px] font-black">0</span>
                        </div>
                    </div>
                    <div id="recap-panel-alert-${s.id}" class="hidden shrink-0 ml-1 px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border border-rose-300/40 font-bold text-[9px] flex items-center gap-0.5">
                        <i data-lucide="alert-circle" class="w-2.5 h-2.5"></i>
                        <span id="recap-panel-alert-text-${s.id}">Alpa</span>
                    </div>
                </div>
                <!-- Baris 2: 5 Pertemuan Terakhir dengan Format m/d: Status -->
                <div class="flex items-center gap-1.5 text-[9px] text-gray-500 dark:text-gray-400">
                    <span class="font-bold text-[8.5px] uppercase tracking-wider text-gray-400 dark:text-gray-500 shrink-0">Riwayat:</span>
                    <div id="recap-panel-recent-${s.id}" class="flex items-center gap-1.5 overflow-x-auto py-0.5 font-medium">
                        <span class="italic text-[8.5px] text-gray-400">Belum ada riwayat.</span>
                    </div>
                </div>
            </div>
        </div>
    `).join('');

    // Hitung resume total awal
    window.updateAttendanceSummary();

    // Perbarui badge kehadiran semester untuk seluruh siswa
    window.refreshAllStudentRecapBadges();

    window.toggleHighlight = function (rowEl, forceActive = false) {
        if (!rowEl) return;
        const isActive = rowEl.classList.contains('student-row-active');

        // Hapus highlight dari semua baris lainnya terlebih dahulu
        document.querySelectorAll('.student-row.student-row-active').forEach(row => {
            row.classList.remove('student-row-active', 'bg-blue-50', 'dark:bg-blue-900/30', 'border-blue-300', 'dark:border-blue-600/50', 'shadow-sm');
            row.classList.add('bg-gray-50/50', 'dark:bg-gray-800/50', 'border-transparent', 'dark:border-gray-700/50');
            const name = row.querySelector('.student-name');
            const absen = row.querySelector('.student-absen');
            if (name) { name.classList.remove('text-blue-700', 'dark:text-blue-300', 'font-bold'); name.classList.add('text-gray-700', 'dark:text-gray-300', 'font-semibold'); }
            if (absen) { absen.classList.remove('text-blue-600', 'dark:text-blue-400'); absen.classList.add('text-gray-400', 'dark:text-gray-500'); }
        });

        // Jika baris ini sebelumnya sudah aktif dan tidak forceActive, cukup matikan (toggle off)
        if (isActive && !forceActive) return;

        // Aktifkan highlight pada baris yang diklik
        rowEl.classList.add('student-row-active', 'bg-blue-50', 'dark:bg-blue-900/30', 'border-blue-300', 'dark:border-blue-600/50', 'shadow-sm');
        rowEl.classList.remove('bg-gray-50/50', 'dark:bg-gray-800/50', 'border-transparent', 'dark:border-gray-700/50');
        const name = rowEl.querySelector('.student-name');
        const absen = rowEl.querySelector('.student-absen');
        if (name) { name.classList.remove('text-gray-700', 'dark:text-gray-300', 'font-semibold'); name.classList.add('text-blue-700', 'dark:text-blue-300', 'font-bold'); }
        if (absen) { absen.classList.remove('text-gray-400', 'dark:text-gray-500'); absen.classList.add('text-blue-600', 'dark:text-blue-400'); }
    };

    window.setAttendance = (id, status, forceSet = false) => {
        const container = document.getElementById(`attendance-${id}`);
        if (!container) return;

        const currentVal = container.dataset.value;
        const buttons = container.getElementsByTagName('button');
        const map = { 'S': 0, 'I': 1, 'A': 2, 'D': 3, 'T': 4 };
        const styles = {
            'S': 'bg-yellow-400 text-white shadow-yellow-200 ring-2 ring-yellow-100 dark:ring-yellow-900',
            'I': 'bg-blue-400 text-white shadow-blue-200 ring-2 ring-blue-100 dark:ring-blue-900',
            'A': 'bg-red-500 text-white shadow-red-200 ring-2 ring-red-100 dark:ring-red-900',
            'D': 'bg-purple-500 text-white shadow-purple-200 ring-2 ring-purple-100 dark:ring-purple-900',
            'T': 'bg-gray-500 text-white shadow-gray-200 ring-2 ring-gray-100 dark:ring-gray-800'
        };

        for (let btn of buttons) {
            btn.className = "att-btn w-7 h-7 rounded text-[10px] font-bold bg-white dark:bg-gray-700 text-gray-400 dark:text-gray-300 border border-gray-100 dark:border-gray-600";
        }

        if (!forceSet && currentVal === status) {
            container.dataset.value = 'H';
            window.updateAttendanceSummary();
            window.updateStudentRecapBadge(id);
            window.updateOpenPopoverIfMatching(id);
            return;
        }

        const btn = buttons[map[status]];
        if (btn) {
            btn.className = `att-btn w-7 h-7 rounded text-[10px] font-bold shadow-sm transform scale-105 z-10 ${styles[status]}`;
            container.dataset.value = status;
        }
        window.updateAttendanceSummary();
        window.updateStudentRecapBadge(id);
        window.updateOpenPopoverIfMatching(id);
    }
}

// --- NAVIGASI RIWAYAT PRESENSI ---
// State: navIndex -1 = saat ini (editable), 0+ = riwayat (read-only)
window.presensiHistory = [];       // Cache data riwayat [{presensi, timestamp, mapel, topik, ...}, ...]
window.presensiNavIndex = -1;      // Posisi navigasi saat ini
window.presensiLastTimestamp = null; // Timestamp terakhir untuk startAfter pagination
window.presensiReachedEnd = false;  // Apakah sudah habis data riwayat
window.currentPresensiSnapshot = {}; // Snapshot presensi saat ini (sebelum navigasi)
window.presensiNavGuruKey = '';     // Key guru+kelas untuk reset saat berubah

// Tampilkan/sembunyikan navigasi riwayat
window.showPresensiNav = function () {
    const navEl = document.getElementById('presensi-nav');
    const guruName = document.getElementById('input-guru')?.value?.trim();
    if (navEl && guruName && currentClass?.name) {
        navEl.classList.remove('hidden');
        safeRenderLucide();

        // Reset jika guru atau kelas berubah
        const newKey = `${guruName}_${currentClass.name}`;
        if (window.presensiNavGuruKey !== newKey) {
            resetPresensiNav();
            window.presensiNavGuruKey = newKey;
        }
    }
};

window.resetPresensiNav = function () {
    window.presensiHistory = [];
    window.presensiNavIndex = -1;
    window.presensiLastTimestamp = null;
    window.presensiReachedEnd = false;
    window.currentPresensiSnapshot = {};
    window.presensiNavGuruKey = '';

    const label = document.getElementById('presensi-nav-label');
    if (label) label.innerHTML = '<i data-lucide="calendar-check" class="w-3 h-3"></i><span>Pertemuan Saat Ini</span>';

    const btnNext = document.getElementById('btn-presensi-next');
    if (btnNext) { btnNext.disabled = true; btnNext.classList.add('text-gray-400', 'dark:text-gray-600', 'cursor-not-allowed'); btnNext.classList.remove('text-indigo-600', 'dark:text-indigo-400', 'hover:bg-indigo-100', 'dark:hover:bg-indigo-800/40'); }

    const btnPrev = document.getElementById('btn-presensi-prev');
    if (btnPrev) { btnPrev.disabled = false; btnPrev.classList.remove('text-gray-400', 'dark:text-gray-600', 'cursor-not-allowed'); btnPrev.classList.add('text-indigo-600', 'dark:text-indigo-400', 'hover:bg-indigo-100', 'dark:hover:bg-indigo-800/40'); }

    // Kembalikan tombol presensi ke mode editable
    enableAttendanceButtons(true);
    safeRenderLucide();
};

function enableAttendanceButtons(enable) {
    document.querySelectorAll('.student-row .att-btn').forEach(btn => {
        btn.disabled = !enable;
        if (enable) {
            btn.classList.remove('opacity-40', 'cursor-not-allowed');
        } else {
            btn.classList.add('opacity-40', 'cursor-not-allowed');
        }
    });
}

function saveCurrentPresensiSnapshot() {
    const snapshot = {};
    document.querySelectorAll('.student-row').forEach(row => {
        const name = row.dataset.name;
        const attEl = document.getElementById(`attendance-${row.dataset.id}`);
        if (attEl) snapshot[name] = attEl.dataset.value || 'H';
    });
    window.currentPresensiSnapshot = snapshot;
}

function restoreCurrentPresensi() {
    // Kembalikan status presensi dari snapshot yang disimpan
    document.querySelectorAll('.student-row').forEach(row => {
        const name = row.dataset.name;
        const sId = row.dataset.id;
        const savedStatus = window.currentPresensiSnapshot[name] || 'H';

        // Reset semua tombol dulu
        const container = document.getElementById(`attendance-${sId}`);
        if (!container) return;
        const buttons = container.getElementsByTagName('button');
        for (let btn of buttons) {
            btn.className = "att-btn w-7 h-7 rounded text-[10px] font-bold bg-white dark:bg-gray-700 text-gray-400 dark:text-gray-300 border border-gray-100 dark:border-gray-600";
        }
        container.dataset.value = 'H';

        // Re-apply status yang disimpan
        if (savedStatus !== 'H') {
            setAttendance(sId, savedStatus);
        }
    });
}

function applyHistoryPresensi(historyData) {
    // Reset semua status presensi ke hadir (H) terlebih dahulu
    document.querySelectorAll('.student-row').forEach(row => {
        const sId = row.dataset.id;
        const container = document.getElementById(`attendance-${sId}`);
        if (!container) return;
        const buttons = container.getElementsByTagName('button');
        for (let btn of buttons) {
            btn.className = "att-btn w-7 h-7 rounded text-[10px] font-bold bg-white dark:bg-gray-700 text-gray-400 dark:text-gray-300 border border-gray-100 dark:border-gray-600 opacity-40 cursor-not-allowed";
            btn.disabled = true;
        }
        container.dataset.value = 'H';
    });

    // Terapkan status dari riwayat
    if (historyData.presensi_detail && historyData.presensi_detail.length > 0) {
        historyData.presensi_detail.forEach(detail => {
            const status = detail.status;
            const namaSiswa = detail.nama;
            const row = Array.from(document.querySelectorAll('.student-row')).find(r => r.dataset.name === namaSiswa);
            if (row) {
                const sId = row.dataset.id;
                setAttendance(sId, status);

                const container = document.getElementById(`attendance-${sId}`);
                if (container) {
                    const buttons = container.getElementsByTagName('button');
                    for (let btn of buttons) {
                        btn.disabled = true;
                        btn.classList.add('cursor-not-allowed');
                    }
                }
            }
        });
    } else if (historyData.presensi) {
        Object.keys(historyData.presensi).forEach(namaSiswa => {
            const status = historyData.presensi[namaSiswa];
            const row = Array.from(document.querySelectorAll('.student-row')).find(r => r.dataset.name === namaSiswa);
            if (row) {
                const sId = row.dataset.id;
                setAttendance(sId, status);

                // Tetap disabled (read-only) tapi tampilkan status
                const container = document.getElementById(`attendance-${sId}`);
                if (container) {
                    const buttons = container.getElementsByTagName('button');
                    for (let btn of buttons) {
                        btn.disabled = true;
                        btn.classList.add('cursor-not-allowed');
                    }
                }
            }
        });
    }
}

window.navigatePresensi = async function (direction) {
    const guruName = document.getElementById('input-guru')?.value?.trim();
    if (!guruName || !currentClass?.name) return;

    const label = document.getElementById('presensi-nav-label');
    const btnPrev = document.getElementById('btn-presensi-prev');
    const btnNext = document.getElementById('btn-presensi-next');

    if (direction === 'prev') {
        // Simpan snapshot presensi saat ini (hanya pertama kali)
        if (window.presensiNavIndex === -1) {
            saveCurrentPresensiSnapshot();
        }

        const targetIndex = window.presensiNavIndex + 1;

        // Cek apakah sudah ada di cache
        if (window.presensiHistory[targetIndex]) {
            window.presensiNavIndex = targetIndex;
            applyHistoryPresensi(window.presensiHistory[targetIndex]);
            updatePresensiNavUI();
            return;
        }

        // Cek apakah data sudah habis
        if (window.presensiReachedEnd) {
            if (label) label.innerHTML = '<i data-lucide="alert-circle" class="w-3 h-3"></i><span>Tidak ada lagi riwayat</span>';
            safeRenderLucide();
            setTimeout(() => updatePresensiNavUI(), 1500);
            return;
        }

        // Lazy load dari Cloudflare D1 (atau Firestore fallback)
        if (label) label.innerHTML = '<i data-lucide="loader-2" class="w-3 h-3 animate-spin"></i><span>Memuat...</span>';
        safeRenderLucide();
        if (btnPrev) btnPrev.disabled = true;

        try {
            let fetchedItem = null;
            if (CloudflareAPI.isEnabled) {
                try {
                    const cfHistory = await CloudflareAPI.getHistory({
                        type: 'attendance',
                        guru: guruName,
                        kelas: currentClass.name,
                        before_id: window.presensiLastId || ''
                    });
                    if (cfHistory) {
                        fetchedItem = {
                            id: cfHistory.id,
                            presensi: cfHistory.presensi || null,
                            presensi_detail: cfHistory.presensi_detail || [],
                            timestamp: cfHistory.created_at || cfHistory.tanggal,
                            mapel: cfHistory.mapel || '',
                            topik: cfHistory.topik || ''
                        };
                        window.presensiLastId = cfHistory.id;
                    } else {
                        window.presensiReachedEnd = true;
                    }
                } catch (cfErr) {
                    console.error("[Presensi History] Cloudflare fetch error:", cfErr);
                    window.presensiReachedEnd = true;
                }
            }

            if (window.presensiReachedEnd || !fetchedItem) {
                window.presensiReachedEnd = true;
                if (label) label.innerHTML = '<i data-lucide="alert-circle" class="w-3 h-3"></i><span>Tidak ada riwayat sebelumnya</span>';
                safeRenderLucide();
                if (btnPrev) btnPrev.disabled = false;
                setTimeout(() => updatePresensiNavUI(), 2000);
                return;
            }

            window.presensiHistory.push(fetchedItem);
            window.presensiNavIndex = targetIndex;

            applyHistoryPresensi(window.presensiHistory[targetIndex]);
            updatePresensiNavUI();

        } catch (err) {
            console.error("Gagal memuat riwayat presensi:", err);
            if (label) label.innerHTML = '<i data-lucide="alert-circle" class="w-3 h-3"></i><span>Gagal memuat</span>';
            safeRenderLucide();
            setTimeout(() => updatePresensiNavUI(), 2000);
        }

        if (btnPrev) btnPrev.disabled = false;

    } else if (direction === 'next') {
        if (window.presensiNavIndex <= -1) return;

        window.presensiNavIndex--;

        if (window.presensiNavIndex === -1) {
            // Kembali ke mode saat ini (editable)
            enableAttendanceButtons(true);
            restoreCurrentPresensi();
        } else {
            applyHistoryPresensi(window.presensiHistory[window.presensiNavIndex]);
        }

        updatePresensiNavUI();
    }
};

function updatePresensiNavUI() {
    const label = document.getElementById('presensi-nav-label');
    const btnPrev = document.getElementById('btn-presensi-prev');
    const btnNext = document.getElementById('btn-presensi-next');

    if (window.presensiNavIndex === -1) {
        // Mode saat ini
        if (label) label.innerHTML = '<i data-lucide="calendar-check" class="w-3 h-3"></i><span>Pertemuan Saat Ini</span>';

        // Disable next
        if (btnNext) { btnNext.disabled = true; btnNext.classList.add('text-gray-400', 'dark:text-gray-600', 'cursor-not-allowed'); btnNext.classList.remove('text-indigo-600', 'dark:text-indigo-400', 'hover:bg-indigo-100', 'dark:hover:bg-indigo-800/40'); }
        // Enable prev
        if (btnPrev) { btnPrev.disabled = false; btnPrev.classList.remove('text-gray-400', 'dark:text-gray-600', 'cursor-not-allowed'); btnPrev.classList.add('text-indigo-600', 'dark:text-indigo-400', 'hover:bg-indigo-100', 'dark:hover:bg-indigo-800/40'); }
    } else {
        // Mode riwayat
        const histData = window.presensiHistory ? window.presensiHistory[window.presensiNavIndex] : null;
        let dateStr = '';
        const rawDate = histData?.timestamp || histData?.createdAt || histData?.date || histData?.tanggal;
        const d = parseUniversalDate(rawDate);
        if (d) {
            dateStr = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
        }
        const mapelStr = histData?.mapel ? ` - ${histData.mapel}` : '';
        if (label) label.innerHTML = `<i data-lucide="history" class="w-3 h-3"></i><span>${dateStr}${mapelStr}</span>`;

        // Enable next
        if (btnNext) { btnNext.disabled = false; btnNext.classList.remove('text-gray-400', 'dark:text-gray-600', 'cursor-not-allowed'); btnNext.classList.add('text-indigo-600', 'dark:text-indigo-400', 'hover:bg-indigo-100', 'dark:hover:bg-indigo-800/40'); }
        // Enable/disable prev berdasarkan apakah masih ada data
        if (btnPrev && !window.presensiReachedEnd) { btnPrev.disabled = false; btnPrev.classList.remove('text-gray-400', 'dark:text-gray-600', 'cursor-not-allowed'); btnPrev.classList.add('text-indigo-600', 'dark:text-indigo-400', 'hover:bg-indigo-100', 'dark:hover:bg-indigo-800/40'); }
        if (btnPrev && window.presensiReachedEnd && window.presensiNavIndex >= window.presensiHistory.length - 1) { btnPrev.disabled = true; btnPrev.classList.add('text-gray-400', 'dark:text-gray-600', 'cursor-not-allowed'); btnPrev.classList.remove('text-indigo-600', 'dark:text-indigo-400', 'hover:bg-indigo-100', 'dark:hover:bg-indigo-800/40'); }
    }

    safeRenderLucide();
}

// --- GPS ---
let gpsRetryInterval = null; // Interval auto-retry GPS

window.dismissGpsReminder = function () {
    const banner = document.getElementById('gps-banner');
    if (banner) banner.classList.add('hidden');
}

function stopGpsRetry() {
    if (gpsRetryInterval) {
        clearInterval(gpsRetryInterval);
        gpsRetryInterval = null;
    }
}

function attemptGps() {
    const statusEl = document.getElementById('gps-status');

    // Set indikator loading
    statusEl.className = "group flex items-center justify-center w-7 h-7 rounded-full bg-yellow-50 text-yellow-600 border border-yellow-200";
    statusEl.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i>';
    safeRenderLucide();

    navigator.geolocation.getCurrentPosition(
        (position) => {
            geoCoordinates = { lat: position.coords.latitude, lng: position.coords.longitude };
            statusEl.className = "group flex items-center justify-center w-7 h-7 rounded-full bg-green-50 text-green-600 border border-green-200 shadow-sm";
            statusEl.innerHTML = '<i data-lucide="map-pin" class="w-3.5 h-3.5"></i>';
            statusEl.onclick = null;
            stopGpsRetry();
            safeRenderLucide();
            console.log("GPS berhasil didapatkan:", geoCoordinates);

            // Sembunyikan banner jika GPS berhasil
            const banner = document.getElementById('gps-banner');
            if (banner) banner.classList.add('hidden');
        },
        (error) => {
            console.warn("GPS gagal:", error.code, error.message);

            // Set indikator merah/retry
            statusEl.className = "group flex items-center justify-center w-7 h-7 rounded-full bg-red-50 text-red-600 border border-red-200 cursor-pointer animate-pulse";
            statusEl.innerHTML = '<i data-lucide="satellite" class="w-3.5 h-3.5"></i>';
            statusEl.onclick = function () {
                showPopup('error', 'GPS Belum Aktif', `
                    Lokasi belum didapatkan. Lakukan langkah berikut:<br><br>
                    <b>1. Aktifkan GPS:</b><br>
                    Geser layar dari atas ke bawah &rarr; Aktifkan ikon <b>Lokasi/GPS</b><br><br>
                    <b>2. Izinkan di Browser:</b><br>
                    Ketuk ikon 🔒 di address bar &rarr; Izin &rarr; Lokasi &rarr; <b>Izinkan</b><br><br>
                    <span class="text-xs text-gray-400">Sistem akan otomatis mendeteksi saat GPS aktif.</span>
                `);
                // Langsung retry setelah user melihat panduan
                stopGpsRetry();
                attemptGps();
            };
            safeRenderLucide();

            // Tampilkan banner panduan GPS (hanya sekali, tidak spam tiap retry)
            const banner = document.getElementById('gps-banner');
            if (banner && banner.classList.contains('hidden')) {
                // Tentukan pesan berdasarkan jenis error
                const titleEl = banner.querySelector('p:first-child');
                if (titleEl) {
                    if (error.code === 1) {
                        // PERMISSION_DENIED
                        titleEl.textContent = 'Koordinat Lokasi Belum Didapat';
                    } else if (error.code === 2) {
                        // POSITION_UNAVAILABLE (GPS mati)
                        titleEl.textContent = 'GPS Tidak Aktif';
                    } else {
                        titleEl.textContent = 'GPS Gagal - Timeout';
                    }
                }
                banner.classList.remove('hidden');
                safeRenderLucide();
            }

            // Mulai auto-retry jika belum aktif
            if (!gpsRetryInterval) {
                gpsRetryInterval = setInterval(() => {
                    // Jika sudah dapat koordinat valid, hentikan
                    if (geoCoordinates && geoCoordinates.lat !== 0) {
                        stopGpsRetry();
                        return;
                    }
                    console.log("Auto-retry GPS...");
                    attemptGps();
                }, 10000); // Retry setiap 10 detik
            }
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
}

// Reset izin lokasi browser — mengarahkan user ke pengaturan situs
window.resetLocationPermission = function () {
    // Coba gunakan Permissions API untuk mengecek status
    if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'geolocation' }).then(result => {
            if (result.state === 'denied') {
                showPopup('error', 'Izin Lokasi Diblokir', `
                    Browser mengingat penolakan sebelumnya. Untuk mereset:<br><br>
                    <b>Chrome Android:</b><br>
                    Ketuk ikon 🔒 di address bar &rarr; Izin &rarr; Lokasi &rarr; Izinkan<br><br>
                    <b>Atau:</b><br>
                    Pengaturan Chrome &rarr; Setelan Situs &rarr; Lokasi &rarr; Cari situs ini &rarr; Izinkan
                `);
            } else {
                // Permission belum denied, coba request ulang
                showPopup('confirm', 'Coba Ulang GPS?', 'Klik OK untuk mencoba mendapatkan lokasi lagi.', () => {
                    stopGpsRetry();
                    attemptGps();
                }, true);
            }
        });
    } else {
        // Fallback jika Permissions API tidak tersedia
        showPopup('confirm', 'Coba Ulang GPS?', `
            Pastikan GPS HP sudah hidup, lalu klik OK.<br><br>
            Jika masih gagal, buka pengaturan browser &rarr; Setelan Situs &rarr; Lokasi &rarr; Izinkan untuk situs ini.
        `, () => {
            stopGpsRetry();
            attemptGps();
        }, true);
    }
};

window.getSilentLocation = function () {
    if (window.isModeDaring) {
        geoCoordinates = { lat: 0, lng: 0 };
        stopGpsRetry();
        const statusEl = document.getElementById('gps-status');
        if (statusEl) {
            statusEl.className = "group flex items-center justify-center w-7 h-7 rounded-full bg-blue-50 text-blue-600 border border-blue-200 shadow-sm";
            statusEl.innerHTML = '<i data-lucide="wifi" class="w-3.5 h-3.5"></i>';
            statusEl.title = "Mode Daring: GPS Dilewati";
            statusEl.onclick = null;
            safeRenderLucide();
        }
        const banner = document.getElementById('gps-banner');
        if (banner) banner.classList.add('hidden');
        return;
    }

    if (!navigator.geolocation) {
        showPopup('error', 'Kesalahan GPS', 'Browser tidak mendukung GPS.');
        return;
    }

    // Hentikan retry sebelumnya jika ada
    stopGpsRetry();
    geoCoordinates = null;

    // Deteksi awal: jika izin sudah diblokir, langsung tampilkan panduan
    if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'geolocation' }).then(result => {
            if (result.state === 'denied') {
                // Izin sudah diblokir permanen — langsung tampilkan UI tanpa menunggu timeout
                const statusEl = document.getElementById('gps-status');
                if (statusEl) {
                    statusEl.className = "group flex items-center justify-center w-7 h-7 rounded-full bg-red-50 text-red-600 border border-red-200 cursor-pointer animate-pulse";
                    statusEl.innerHTML = '<i data-lucide="satellite" class="w-3.5 h-3.5"></i>';
                    statusEl.onclick = function () {
                        showPopup('error', 'Izin Lokasi Diblokir', `
                            Browser memblokir akses lokasi. Untuk mengizinkan kembali:<br><br>
                            <b>Chrome Android:</b><br>
                            Ketuk ikon 🔒 di address bar &rarr; Izin &rarr; Lokasi &rarr; <b>Izinkan</b><br><br>
                            <b>Atau:</b><br>
                            Pengaturan Chrome &rarr; Setelan Situs &rarr; Lokasi &rarr; Cari situs ini &rarr; <b>Izinkan</b><br><br>
                            <span class="text-xs text-gray-400">Setelah mengizinkan, sistem akan otomatis mencoba ulang.</span>
                        `);
                        // Langsung retry setelah user melihat panduan
                        stopGpsRetry();
                        attemptGps();
                    };
                    safeRenderLucide();
                }

                // Tampilkan banner panduan langsung
                const banner = document.getElementById('gps-banner');
                if (banner) {
                    const titleEl = banner.querySelector('p:first-child');
                    if (titleEl) titleEl.textContent = 'Koordinat Lokasi Belum Didapat';
                    banner.classList.remove('hidden');
                    safeRenderLucide();
                }

                console.warn("Izin lokasi diblokir permanen oleh browser.");
            }

            // Selalu panggil attemptGps() apapun kondisinya
            attemptGps();

            // Pantau perubahan izin secara real-time
            result.onchange = function () {
                if (result.state === 'granted') {
                    // User baru saja mengizinkan lokasi — coba langsung
                    console.log("Izin lokasi baru diberikan, mencoba GPS...");
                    stopGpsRetry();
                    attemptGps();
                }
            };
        }).catch(() => {
            // Permissions API gagal, fallback ke cara biasa
            attemptGps();
        });
    } else {
        // Browser tidak support Permissions API, langsung coba GPS
        attemptGps();
    }
}

// --- IMAGE COMPRESSION & UPLOAD ke GOOGLE DRIVE ---
async function uploadToGoogleDrive(base64Data, fileName, onRetry = null, maxRetries = 3, context = {}) {
    let lastError = null;
    const className = context.className || (currentClass ? currentClass.name : 'Unknown');

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        // Request yang sudah dikirim tetap ditunggu agar file hasilnya bisa dibersihkan,
        // tetapi foto yang sudah dibatalkan tidak boleh memulai percobaan berikutnya.
        if (context.isCurrent && !context.isCurrent()) return null;
        const startedAt = Date.now();
        let stage = 'request';
        try {
            if (attempt > 1 && typeof onRetry === 'function') {
                onRetry(attempt, maxRetries);
            }

            const response = await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({
                    action: 'upload', // Beri tahu GAS ini perintah upload
                    image: base64Data,
                    fileName: fileName,
                    kelas: className
                })
            });

            if (!response.ok) {
                throw new Error(`Layanan foto mengembalikan HTTP ${response.status}.`);
            }

            stage = 'response';
            const result = await response.json();
            stage = 'server';
            if (!result.success) throw new Error(result.error || 'Upload gagal');
            if (typeof result.url !== 'string' || !result.url) throw new Error('Respons unggahan foto tidak memuat URL.');
            console.info('[Upload Drive] Selesai', { uploadId: context.uploadId, attempt, durationMs: Date.now() - startedAt });
            return { url: result.url, fileId: result.fileId };
        } catch (err) {
            console.warn('[Upload Drive] Percobaan gagal', {
                uploadId: context.uploadId, stage, attempt, durationMs: Date.now() - startedAt,
                bytes: Math.round(base64Data.length * 0.75), message: err.message
            });
            lastError = err;
            if (context.isCurrent && !context.isCurrent()) return null;

            if (attempt < maxRetries) {
                // Pertahankan jeda percobaan ulang yang sudah digunakan.
                const baseDelay = attempt * 1200;
                const jitter = Math.floor(Math.random() * 600);
                await new Promise(res => setTimeout(res, baseDelay + jitter));
            }
        }
    }

    throw new Error(lastError ? (lastError.message === 'Failed to fetch' ? 'Koneksi ke layanan foto terputus atau layanan belum dapat dijangkau. Silakan coba lagi.' : lastError.message) : 'Gagal mengunggah foto ke Google Drive.');
}

async function deleteFromGoogleDrive(fileId) {
    try {
        // Abaikan jika tidak ada ID (Belum diunggah / Gagal)
        if (!fileId) return;

        console.log("Mencoba menghapus foto lama dari Google Drive: ", fileId);
        // Fire and forget (Berjalan di background tanpa menghentikan UI)
        fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'delete',
                fileId: fileId
            })
        }).catch(e => console.warn("Background Delete Error:", e));
    } catch (e) {
        console.warn("Gagal inisiasi hapus file Drive", e);
    }
}

function createPhotoUpload(file, dataUrl = '') {
    const id = ++photoUploadSequence;
    const className = currentClass ? currentClass.name : 'Unknown';
    let notifyCancelled;
    const cancelled = new Promise(resolve => { notifyCancelled = resolve; });
    return {
        id, file, dataUrl, className, fileName: `${className}_Background_${Date.now()}_${id}.jpg`,
        promise: null, result: null, error: null, saveAttempted: false, cancelled, notifyCancelled
    };
}

function discardPhotoUpload() {
    const previous = activePhotoUpload;
    activePhotoUpload = null;
    window.uploadedFotoObj = null;
    if (!previous) return;
    previous.notifyCancelled(null);
    // Respons simpan bisa terputus meskipun jurnal sudah tersimpan di server.
    if (previous.result && !previous.saveAttempted) deleteFromGoogleDrive(previous.result.fileId);
}

function renderPhotoUploadStatus(upload, state, label) {
    if (activePhotoUpload !== upload) return;
    const badge = document.getElementById('upload-status-badge');
    if (!badge) return;
    const styles = {
        processing: ['bg-yellow-100 text-yellow-700', 'loader-2', 'animate-spin'],
        uploading: ['bg-blue-100 text-blue-700', 'upload-cloud', 'animate-bounce'],
        ready: ['bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400', 'check-circle', ''],
        failed: ['bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 cursor-pointer', 'alert-circle', '']
    };
    const [colors, icon, animation] = styles[state];
    badge.className = `ml-auto flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold ${colors}`;
    badge.innerHTML = `<i data-lucide="${icon}" class="w-3 h-3 ${animation}"></i><span>${label}</span>`;
    badge.title = upload.error ? upload.error.message : '';
    // Hapus handler lama segera, termasuk ketika percobaan ulang baru dimulai.
    badge.onclick = state === 'failed' ? () => {
        if (!isSubmittingJurnal) return startPhotoUpload(upload);
    } : null;
    safeRenderLucide();
}

function readAndCompressPhoto(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => {
            try {
                const img = new Image();
                img.onload = async () => {
                    try { resolve(await compressImage(img)); } catch (err) { reject(err); }
                };
                img.onerror = () => reject(new Error('Format foto tidak dapat dibaca. Silakan pilih foto lain.'));
                img.src = e.target.result;
            } catch (err) { reject(err); }
        };
        reader.onerror = () => reject(new Error('Foto tidak dapat dibaca dari perangkat. Silakan coba lagi.'));
        reader.onabort = () => reject(new Error('Pembacaan foto dibatalkan. Silakan coba lagi.'));
        reader.readAsDataURL(file);
    });
}

function startPhotoUpload(upload) {
    if (activePhotoUpload !== upload) return Promise.resolve(null);
    if (upload.promise) return upload.promise;
    if (upload.result) return Promise.resolve(upload.result);

    upload.error = null;
    renderPhotoUploadStatus(upload, 'processing', upload.dataUrl ? 'Mengunggah...' : 'Memproses...');
    document.getElementById('photo-buttons').classList.add('hidden');

    // Jadwalkan setelah promise disimpan, supaya semua pemanggil berbagi proses yang sama.
    upload.promise = Promise.resolve().then(async () => {
        const startedAt = Date.now();
        let stage = 'read/compress';
        try {
            if (activePhotoUpload !== upload) return null;
            if (!upload.dataUrl) upload.dataUrl = await readAndCompressPhoto(upload.file);
            if (activePhotoUpload !== upload) return null;

            document.getElementById('image-preview').src = upload.dataUrl;
            document.getElementById('preview-container').classList.remove('hidden');
            renderPhotoUploadStatus(upload, 'uploading', 'Mengunggah...');
            stage = 'upload';
            const result = await uploadToGoogleDrive(upload.dataUrl.split(',')[1], upload.fileName, (attempt, max) => {
                renderPhotoUploadStatus(upload, 'processing', `Mencoba Ulang (${attempt}/${max})...`);
            }, 3, {
                className: upload.className, uploadId: upload.id,
                isCurrent: () => activePhotoUpload === upload
            });

            if (activePhotoUpload !== upload) {
                if (result && result.fileId) deleteFromGoogleDrive(result.fileId);
                return null;
            }
            upload.result = result;
            window.uploadedFotoObj = result;
            renderPhotoUploadStatus(upload, 'ready', 'Foto Siap');
            return result;
        } catch (err) {
            if (activePhotoUpload !== upload) return null;
            upload.error = err;
            window.uploadedFotoObj = null;
            console.warn('[Foto Jurnal] Gagal', { uploadId: upload.id, stage, durationMs: Date.now() - startedAt, message: err.message });
            renderPhotoUploadStatus(upload, 'failed', 'Gagal! (Sentuh Coba Lagi)');
            if (!upload.dataUrl) document.getElementById('photo-buttons').classList.remove('hidden');
            return null;
        } finally {
            upload.promise = null;
        }
    });
    return upload.promise;
}

async function waitForPhotoUpload(upload) {
    let timer;
    try {
        await Promise.race([
            startPhotoUpload(upload),
            upload.cancelled,
            new Promise(resolve => { timer = setTimeout(resolve, PHOTO_SUBMIT_WAIT_MS); })
        ]);
        if (activePhotoUpload !== upload) throw new Error('Foto telah berubah. Periksa foto lalu simpan kembali.');
        if (upload.result) return upload.result;
        if (upload.error) throw new Error(`Foto belum berhasil diunggah. ${upload.error.message} Isian jurnal tetap tersedia.`);
        const error = new Error('Foto masih diunggah. Jurnal belum disimpan dan isian tetap tersedia. Tunggu status Foto Siap, lalu tekan Simpan Laporan kembali.');
        error.code = 'PHOTO_PENDING';
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

window.handleFileSelect = function (input) {
    const file = input.files[0];
    if (!file || isSubmittingJurnal || window.currentEditDocId) return Promise.resolve(null);
    if (activePhotoUpload && activePhotoUpload.file === file) return startPhotoUpload(activePhotoUpload);
    discardPhotoUpload();
    document.getElementById('image-preview').src = '';
    document.getElementById('preview-container').classList.add('hidden');
    activePhotoUpload = createPhotoUpload(file);
    return startPhotoUpload(activePhotoUpload);
};

window.handleDirectPhotoFile = function (file) {
    if (!file || isSubmittingJurnal || window.currentEditDocId) return Promise.resolve(null);
    if (activePhotoUpload && activePhotoUpload.file === file) return startPhotoUpload(activePhotoUpload);
    discardPhotoUpload();
    const prev = document.getElementById('image-preview');
    if (prev) prev.src = '';
    const prevCont = document.getElementById('preview-container');
    if (prevCont) prevCont.classList.add('hidden');
    activePhotoUpload = createPhotoUpload(file);
    return startPhotoUpload(activePhotoUpload);
};

window.compressImage = function (imgOrSrc, initialQuality = 0.6, maxWidth = 800) {
    return new Promise((resolve) => {
        let img;
        if (typeof imgOrSrc === 'string') {
            img = new Image();
            img.src = imgOrSrc;
            img.onload = process;
        } else {
            img = imgOrSrc;
            process();
        }

        function process() {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;

            if (width > maxWidth) {
                height = Math.round((height * maxWidth) / width);
                width = maxWidth;
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            let quality = initialQuality;
            let dataUrl = canvas.toDataURL('image/jpeg', quality);

            // Pengukuran berat Data Berdasar Base64 (Kasar)
            // 80KB = 81920 bytes. 1 char base64 ~= 0.75 byte.
            // Target DataLength max = 81920 / 0.75 = 109226 karakter
            const MAX_LENGTH = 105000; // Aman

            while (dataUrl.length > MAX_LENGTH && quality > 0.1) {
                quality -= 0.1;
                dataUrl = canvas.toDataURL('image/jpeg', quality);
            }

            // Jika kualitas sudah mentok tapi ukuran masih sedikit lebih besar (jarang terjadi di res 800px),
            // kita loloskan saja kondisi tertingginya untuk menghindari loop tak berujung.
            console.log('Kompresi selesai dengan Kualitas:', quality.toFixed(1), '| Estimasi:', Math.round(dataUrl.length * 0.75 / 1024), 'KB');
            resolve(dataUrl);
        }
    });
}

window.clearImage = function () {
    if (isSubmittingJurnal) return;
    if (typeof window.closeWebRtcCamera === 'function') window.closeWebRtcCamera();
    discardPhotoUpload();

    document.getElementById('file-camera').value = '';
    document.getElementById('preview-container').classList.add('hidden');
    document.getElementById('photo-buttons').classList.remove('hidden');
    document.getElementById('upload-status-badge').classList.add('hidden');
    document.getElementById('upload-status-badge').onclick = null;
    document.getElementById('image-preview').src = '';
}

// --- IN-APP WEBRTC CAMERA (LITE / ANTI-RELOAD UNTUK HP LOW RAM) ---
let webrtcStream = null;
let currentWebRtcFacingMode = 'environment';

window.openWebRtcCamera = async function () {
    if (isSubmittingJurnal || window.currentEditDocId) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (typeof showPopup === 'function') {
            showPopup('info', 'Kamera Lite Tidak Didukung', 'Browser Anda belum mendukung kamera langsung di dalam web. Mengalihkan ke Kamera Bawaan HP...');
        }
        const cam = document.getElementById('file-camera');
        if (cam) cam.click();
        return;
    }

    const modal = document.getElementById('modal-webrtc-camera');
    const loading = document.getElementById('webrtc-loading');
    const errBox = document.getElementById('webrtc-error');
    if (modal) modal.classList.remove('hidden');
    if (loading) loading.classList.remove('hidden');
    if (errBox) errBox.classList.add('hidden');
    if (typeof safeRenderLucide === 'function') safeRenderLucide();

    await startWebRtcStream();
};

async function startWebRtcStream() {
    const video = document.getElementById('webrtc-video');
    const loading = document.getElementById('webrtc-loading');
    const errBox = document.getElementById('webrtc-error');
    const errText = document.getElementById('webrtc-error-text');

    if (webrtcStream) {
        try {
            webrtcStream.getTracks().forEach(track => track.stop());
        } catch (e) {}
        webrtcStream = null;
    }

    try {
        const constraints = {
            video: {
                facingMode: { ideal: currentWebRtcFacingMode },
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        };

        webrtcStream = await navigator.mediaDevices.getUserMedia(constraints);
        if (video) {
            video.srcObject = webrtcStream;
            if (typeof video.play === 'function') {
                await video.play().catch(() => {});
            }
        }
        if (loading) loading.classList.add('hidden');
    } catch (err) {
        console.warn('[WebRTC Camera] Gagal mengakses stream:', err);
        if (loading) loading.classList.add('hidden');
        if (errBox) {
            errBox.classList.remove('hidden');
            let msg = 'Gagal mengakses kamera perangkat.';
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                msg = 'Izin kamera ditolak. Silakan berikan izin akses kamera pada setelan peramban Anda.';
            } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                msg = 'Kamera tidak terdeteksi pada perangkat ini.';
            } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
                msg = 'Kamera sedang digunakan oleh aplikasi lain.';
            }
            if (errText) errText.textContent = msg;
            if (typeof safeRenderLucide === 'function') safeRenderLucide();
        }
    }
}

window.retryWebRtcCamera = function () {
    const loading = document.getElementById('webrtc-loading');
    const errBox = document.getElementById('webrtc-error');
    if (loading) loading.classList.remove('hidden');
    if (errBox) errBox.classList.add('hidden');
    return startWebRtcStream();
};

window.toggleWebRtcCamera = function () {
    currentWebRtcFacingMode = (currentWebRtcFacingMode === 'environment' ? 'user' : 'environment');
    const loading = document.getElementById('webrtc-loading');
    if (loading) loading.classList.remove('hidden');
    return startWebRtcStream();
};

window.closeWebRtcCamera = function () {
    if (webrtcStream) {
        try {
            webrtcStream.getTracks().forEach(track => track.stop());
        } catch (e) {}
        webrtcStream = null;
    }
    const video = document.getElementById('webrtc-video');
    if (video) {
        video.srcObject = null;
    }
    const modal = document.getElementById('modal-webrtc-camera');
    if (modal) modal.classList.add('hidden');
};

window.captureWebRtcPhoto = function () {
    const video = document.getElementById('webrtc-video');
    if (!video || !video.videoWidth || !video.videoHeight) {
        if (typeof showPopup === 'function') {
            showPopup('error', 'Kamera Belum Siap', 'Tunggu hingga tampilan kamera live muncul sebelum mengambil foto.');
        }
        return;
    }

    const canvas = document.getElementById('webrtc-canvas') || document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Langsung hentikan stream kamera agar mengosongkan RAM dan membebaskan sensor
    window.closeWebRtcCamera();

    const className = currentClass ? currentClass.name : 'Kelas';
    const fileName = `${className}_Background_${Date.now()}.jpg`;

    if (canvas.toBlob) {
        canvas.toBlob(blob => {
            if (!blob) return;
            let fileObj;
            try {
                fileObj = new File([blob], fileName, { type: 'image/jpeg' });
            } catch (e) {
                blob.name = fileName;
                fileObj = blob;
            }
            window.handleDirectPhotoFile(fileObj);
        }, 'image/jpeg', 0.85);
    } else {
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        try {
            const byteString = atob(dataUrl.split(',')[1]);
            const mimeString = dataUrl.split(',')[0].split(':')[1].split(';')[0];
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) {
                ia[i] = byteString.charCodeAt(i);
            }
            const blob = new Blob([ab], { type: mimeString });
            blob.name = fileName;
            window.handleDirectPhotoFile(blob);
        } catch (err) {
            console.error('[WebRTC Camera] Error canvas fallback:', err);
        }
    }
};

// --- CANVAS ---
window.initCanvas = function () {
    const canvas = document.getElementById('signature-pad');
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    ctx.strokeStyle = "#000"; ctx.lineWidth = 2;

    function getPos(e) {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return { x: clientX - rect.left, y: clientY - rect.top };
    }

    ['mousedown', 'touchstart'].forEach(ev => canvas.addEventListener(ev, (e) => {
        isDrawing = true;
        const pos = getPos(e);
        ctx.beginPath(); ctx.moveTo(pos.x, pos.y); e.preventDefault();
    }));

    ['mousemove', 'touchmove'].forEach(ev => canvas.addEventListener(ev, (e) => {
        if (!isDrawing) return;
        const pos = getPos(e);
        ctx.lineTo(pos.x, pos.y); ctx.stroke(); e.preventDefault();
    }));

    ['mouseup', 'touchend'].forEach(ev => canvas.addEventListener(ev, () => { isDrawing = false; }));
}

window.clearCanvas = function () {
    const canvas = document.getElementById('signature-pad');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

window.checkManualMapel = function () {
    const select = document.getElementById('input-mapel');
    const manualInput = document.getElementById('input-mapel-manual');

    if (select.value === 'Lainnya') {
        manualInput.classList.remove('hidden');
        manualInput.focus();
    } else {
        manualInput.classList.add('hidden');
    }
}

// --- SCHEDULE COMPARISON HELPER ---
async function compareWithActualSchedule(className, guruName, mapelName, jpList, entryDateStr = null) {
    if (!className || !guruName || !mapelName || !jpList || jpList.length === 0) {
        return { hasSchedule: false, isMatch: true, reasons: [] };
    }

    try {
        const scheduleData = await loadAndParseScheduleXML();
        if (!scheduleData || !scheduleData.scheduleMap) {
            return { hasSchedule: false, isMatch: true, reasons: [] };
        }

        const targetDate = (entryDateStr && /^\d{4}-\d{2}-\d{2}$/.test(entryDateStr))
            ? new Date(entryDateStr + 'T00:00:00')
            : new Date();
        const dayOfWeek = targetDate.getDay(); // 1=Senin ... 5=Jumat
        // Jika akhir pekan (Sabtu/Minggu), bukan KBM reguler
        if (dayOfWeek < 1 || dayOfWeek > 5) {
            return { hasSchedule: false, isMatch: true, isWeekend: true, reasons: [] };
        }

        const daySched = scheduleData.scheduleMap[className]?.[dayOfWeek];
        if (!daySched) {
            return { hasSchedule: false, isMatch: true, reasons: [] };
        }

        const dayNames = ['', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];
        const dayName = dayNames[dayOfWeek] || '';

        const expectedSlots = [];
        let hasAnySlotInSchedule = false;

        for (const jp of jpList) {
            const slot = daySched[jp];
            if (slot && slot.mapel && slot.mapel.toUpperCase() !== 'UPACARA') {
                hasAnySlotInSchedule = true;
                expectedSlots.push({ jp, guru: slot.guruNama, mapel: slot.mapel });
            } else {
                expectedSlots.push({ jp, guru: null, mapel: null });
            }
        }

        if (!hasAnySlotInSchedule) {
            return {
                hasSchedule: true,
                isMatch: false,
                reasons: [`Menurut jadwal resmi hari ${dayName}, pada JP ${jpList.join(', ')} kelas ${className} tidak terdapat jadwal pembelajaran KBM (Jam Kosong / Ekstrakurikuler / Khusus).`],
                expectedDesc: 'Tidak ada KBM di jadwal resmi pada JP ini'
            };
        }

        const scheduledGurus = Array.from(new Set(expectedSlots.map(s => s.guru).filter(Boolean)));
        const scheduledMapels = Array.from(new Set(expectedSlots.map(s => s.mapel).filter(Boolean)));

        const isGuruMatch = scheduledGurus.some(schedG => {
            if (!schedG) return false;
            return (schedG === guruName) ||
                (smartMatchTeacher(schedG, [{ nama: guruName }]) === guruName) ||
                (smartMatchTeacher(guruName, [{ nama: schedG }]) === schedG) ||
                (normalizeTeacherName(schedG) === normalizeTeacherName(guruName)) ||
                (schedG.toLowerCase().includes(guruName.toLowerCase())) ||
                (guruName.toLowerCase().includes(schedG.toLowerCase()));
        });

        const isMapelMatch = scheduledMapels.some(schedM => {
            if (!schedM) return false;
            const s1 = schedM.trim().toLowerCase();
            const s2 = mapelName.trim().toLowerCase();
            return (s1 === s2 || s1.includes(s2) || s2.includes(s1));
        });

        if (isGuruMatch && isMapelMatch) {
            return {
                hasSchedule: true,
                isMatch: true,
                reasons: []
            };
        }

        const reasons = [];
        if (!isGuruMatch && scheduledGurus.length > 0) {
            reasons.push(`Guru di jadwal resmi: <b>${scheduledGurus.join(' / ')}</b>`);
        }
        if (!isMapelMatch && scheduledMapels.length > 0) {
            reasons.push(`Mapel di jadwal resmi: <b>${scheduledMapels.join(' / ')}</b>`);
        }

        return {
            hasSchedule: true,
            isMatch: false,
            reasons,
            scheduledGurus,
            scheduledMapels,
            dayName
        };
    } catch (e) {
        console.warn('[CompareSchedule] Error comparing schedule:', e);
        return { hasSchedule: false, isMatch: true, reasons: [] };
    }
}

// --- CONFIRM SUBMIT MODAL & CHECKLIST GATE ---
let pendingSubmitApproval = null;

window.closeConfirmSubmitDialog = function () {
    const modal = document.getElementById('confirm-submit-modal');
    const content = document.getElementById('confirm-submit-content');
    if (modal && content) {
        modal.classList.add('pointer-events-none', 'opacity-0');
        content.classList.add('scale-95');
        content.classList.remove('scale-100');
    }
    pendingSubmitApproval = null;
};

window.updateConfirmChecklist = function () {
    const chkGuru = document.getElementById('chk-confirm-guru');
    const chkMapel = document.getElementById('chk-confirm-mapel');
    const chkJp = document.getElementById('chk-confirm-jp');
    const counterEl = document.getElementById('confirm-checklist-counter');
    const btnAction = document.getElementById('btn-confirm-submit-action');
    const hintEl = document.getElementById('confirm-submit-hint');

    if (!chkGuru || !chkMapel || !chkJp || !btnAction) return;

    let checkedCount = 0;
    if (chkGuru.checked) checkedCount++;
    if (chkMapel.checked) checkedCount++;
    if (chkJp.checked) checkedCount++;

    if (counterEl) {
        counterEl.textContent = `${checkedCount}/3`;
        if (checkedCount === 3) {
            counterEl.className = 'text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200 font-extrabold';
        } else {
            counterEl.className = 'text-[10px] px-2 py-0.5 rounded-full bg-blue-200/60 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200 font-extrabold';
        }
    }

    if (checkedCount === 3) {
        btnAction.disabled = false;
        btnAction.className = 'flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold text-xs sm:text-sm shadow-lg shadow-blue-500/25 transform active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-1.5';
        if (hintEl) {
            hintEl.className = 'text-[10px] text-center text-emerald-600 dark:text-emerald-400 font-medium';
            hintEl.innerHTML = '✓ Seluruh verifikasi telah tercentang. Tekan <b>Ya, Simpan Jurnal</b> untuk menyelesaikan.';
        }
    } else {
        btnAction.disabled = true;
        btnAction.className = 'flex-1 py-3 px-4 rounded-xl bg-gray-200 dark:bg-gray-700/60 text-gray-400 dark:text-gray-500 font-bold text-xs sm:text-sm transition-all cursor-not-allowed flex items-center justify-center gap-1.5';
        if (hintEl) {
            hintEl.className = 'text-[10px] text-center text-amber-600 dark:text-amber-400 font-medium';
            hintEl.innerHTML = '⚠️ Centang 3 verifikasi di atas (Nama, Mapel, dan JP) untuk mengaktifkan tombol simpan.';
        }
    }
};

window.onConfirmSubmitApproved = function () {
    const chkGuru = document.getElementById('chk-confirm-guru');
    const chkMapel = document.getElementById('chk-confirm-mapel');
    const chkJp = document.getElementById('chk-confirm-jp');
    if (!chkGuru?.checked || !chkMapel?.checked || !chkJp?.checked) {
        return;
    }

    const cb = pendingSubmitApproval;
    window.closeConfirmSubmitDialog();
    if (typeof cb === 'function') {
        cb();
    }
};

async function showConfirmSubmitDialog(data, onApproved) {
    const modal = document.getElementById('confirm-submit-modal');
    const content = document.getElementById('confirm-submit-content');
    if (!modal || !content) {
        if (typeof onApproved === 'function') onApproved();
        return;
    }

    // 1. Set Isi Data Checklist
    const valGuruEl = document.getElementById('confirm-val-guru');
    const valMapelEl = document.getElementById('confirm-val-mapel');
    const valJpEl = document.getElementById('confirm-val-jp');

    if (valGuruEl) valGuruEl.textContent = data.guru || '-';
    if (valMapelEl) valMapelEl.textContent = data.mapel || '-';

    const jpStr = (data.jpList && data.jpList.length > 0)
        ? (data.jpList.length > 1 && data.jpList[data.jpList.length - 1] - data.jpList[0] === data.jpList.length - 1
            ? `JP ${data.jpList[0]}-${data.jpList[data.jpList.length - 1]} (${data.jpList.length} Jam Pelajaran)`
            : `JP ${data.jpList.join(', ')} (${data.jpList.length} Jam Pelajaran)`)
        : '-';

    if (valJpEl) valJpEl.textContent = jpStr;

    // 2. Set Rincian Tambahan
    const valKelasEl = document.getElementById('confirm-val-kelas');
    const valLokasiEl = document.getElementById('confirm-val-lokasi');
    const valTopikEl = document.getElementById('confirm-val-topik');
    const valPresensiSummaryEl = document.getElementById('confirm-val-presensi-summary');
    const valPresensiDetailEl = document.getElementById('confirm-val-presensi-detail');

    if (valKelasEl) valKelasEl.textContent = data.className || '-';
    if (valLokasiEl) valLokasiEl.textContent = data.lokasi || 'Di Ruang Kelas';
    if (valTopikEl) valTopikEl.textContent = data.topik ? `"${data.topik}"` : '-';

    if (valPresensiSummaryEl) {
        valPresensiSummaryEl.textContent = `Total: ${data.totalStudents} Siswa • ${data.hadirCount} Hadir`;
    }

    if (valPresensiDetailEl) {
        const unhadirTotal = data.totalStudents - data.hadirCount;
        if (unhadirTotal === 0) {
            valPresensiDetailEl.innerHTML = '<span class="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1"><i data-lucide="check" class="w-3 h-3"></i> Seluruh siswa hadir lengkap</span>';
        } else {
            const parts = [];
            if (data.unhadirSummary.S) parts.push(`Sakit: ${data.unhadirSummary.S}`);
            if (data.unhadirSummary.I) parts.push(`Izin: ${data.unhadirSummary.I}`);
            if (data.unhadirSummary.A) parts.push(`Alpa: ${data.unhadirSummary.A}`);
            if (data.unhadirSummary.D) parts.push(`Dispen: ${data.unhadirSummary.D}`);
            if (data.unhadirSummary.T) parts.push(`Tugas: ${data.unhadirSummary.T}`);

            let detailHtml = `<span class="text-amber-600 dark:text-amber-400 font-semibold">${unhadirTotal} tidak hadir</span> (${parts.join(', ')})`;
            if (data.unhadirNames && data.unhadirNames.length > 0) {
                detailHtml += `<div class="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 truncate" title="${data.unhadirNames.join(', ')}">${data.unhadirNames.join(', ')}</div>`;
            }
            valPresensiDetailEl.innerHTML = detailHtml;
        }
    }

    // 3. Reset Checkbox State
    const chkGuru = document.getElementById('chk-confirm-guru');
    const chkMapel = document.getElementById('chk-confirm-mapel');
    const chkJp = document.getElementById('chk-confirm-jp');
    if (chkGuru) chkGuru.checked = false;
    if (chkMapel) chkMapel.checked = false;
    if (chkJp) chkJp.checked = false;
    window.updateConfirmChecklist();

    pendingSubmitApproval = onApproved;

    // Tampilkan Modal Secara Instan (0ms Respons ke Pengguna)
    modal.classList.remove('pointer-events-none', 'opacity-0');
    content.classList.remove('scale-95');
    content.classList.add('scale-100');
    safeRenderLucide();

    // 4. Komparasi dengan Jadwal Resmi KBM di Latar Belakang (Gunakan cache hasil komparasi jika tersedia)
    const warningBox = document.getElementById('confirm-schedule-warning');
    const warningText = document.getElementById('confirm-schedule-warning-text');
    const matchBox = document.getElementById('confirm-schedule-match');

    if (warningBox) warningBox.classList.add('hidden');
    if (matchBox) matchBox.classList.add('hidden');

    try {
        const scheduleCheck = data.scheduleCheck || await compareWithActualSchedule(data.className, data.guru, data.mapel, data.jpList, data.tanggal);
        if (scheduleCheck && scheduleCheck.hasSchedule) {
            if (!scheduleCheck.isMatch) {
                if (warningBox && warningText) {
                    const reasonsHtml = scheduleCheck.reasons && scheduleCheck.reasons.length > 0
                        ? scheduleCheck.reasons.map(r => `• ${r}`).join('<br>')
                        : 'Jadwal input tidak sama dengan data jadwal KBM kelas ini.';
                    warningText.innerHTML = `${reasonsHtml}<div class="mt-1 font-medium text-[10px] text-amber-800/80 dark:text-amber-300/80">Jika ini jam pengganti / tukar jadwal, pastikan telah terverifikasi dengan benar sebelum menyimpan.</div>`;
                    warningBox.classList.remove('hidden');
                }
            } else {
                if (matchBox) matchBox.classList.remove('hidden');
            }
        }
    } catch (schedErr) {
        console.warn('Gagal cek kesesuaian jadwal:', schedErr);
    }
}

// Alur penanganan GPS sebelum final commit ke D1
function handleGpsAndProceed(btn, originalBtnContent, guru, mapel, lokasi, topik, catatan, jpList, signatureCanvas, isSignatureEmpty) {
    // Mode Edit: Jika koordinat belum diperoleh / tidak ada, tetap izinkan simpan tanpa memblokir dengan GPS
    if (window.currentEditDocId) {
        if (!geoCoordinates) {
            let oldKoord = window.currentEditData?.koordinat;
            if (typeof oldKoord === 'string') {
                try { oldKoord = JSON.parse(oldKoord); } catch (e) { oldKoord = null; }
            }
            const lat = oldKoord ? (oldKoord.lat ?? oldKoord.latitude ?? 0) : 0;
            const lng = oldKoord ? (oldKoord.lng ?? oldKoord.longitude ?? 0) : 0;
            geoCoordinates = { lat, lng };
        }
        proceedSubmit(btn, originalBtnContent, guru, mapel, lokasi, topik, catatan, jpList, signatureCanvas, isSignatureEmpty);
        return;
    }

    if (!geoCoordinates) {
        if (window.isModeDaring) {
            geoCoordinates = { lat: 0, lng: 0 };
        } else {
            showPopup('confirm', 'Aktifkan GPS Terlebih Dahulu', `
                Koordinat lokasi belum diperoleh. Pastikan:<br><br>
                <b>1.</b> GPS/Lokasi pada HP sudah <b>dihidupkan</b><br>
                <b>2.</b> Izin lokasi browser sudah <b>diizinkan</b><br><br>
                <span class="text-xs text-gray-400">Tekan <b>Oke</b> setelah GPS diaktifkan untuk mencoba ulang (maks. 8 detik).</span>
            `, () => {
                if (btn) {
                    btn.disabled = true;
                    btn.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> <span>Mendapatkan Lokasi...</span>`;
                }
                safeRenderLucide();

                let isResolved = false;

                const handleGpsFailure = (reason) => {
                    if (isResolved) return;
                    isResolved = true;
                    if (gpsWatchdog) clearTimeout(gpsWatchdog);
                    console.warn("[GPS] Gagal / timeout:", reason);

                    if (btn) {
                        btn.innerHTML = originalBtnContent;
                        btn.disabled = false;
                    }
                    safeRenderLucide();

                    showPopup('confirm', 'GPS Masih Belum Tersedia', `
                        Lokasi masih tidak bisa diperoleh setelah dicoba ulang.<br><br>
                        Apakah Anda ingin menyimpan jurnal <b>tanpa data koordinat lokasi</b>?
                    `, () => {
                        geoCoordinates = { lat: 0, lng: 0 };
                        proceedSubmit(btn, originalBtnContent, guru, mapel, lokasi, topik, catatan, jpList, signatureCanvas, isSignatureEmpty);
                    }, true);
                };

                // Watchdog timer 8.5 detik: proteksi mutlak terhadap silent hang di browser mobile saat request High Accuracy
                const gpsWatchdog = setTimeout(() => {
                    handleGpsFailure("Watchdog timeout 8.5s (silent hang browser/OS terdeteksi)");
                }, 8500);

                if (navigator.geolocation && typeof navigator.geolocation.getCurrentPosition === 'function') {
                    try {
                        navigator.geolocation.getCurrentPosition(
                            (position) => {
                                if (isResolved) return;
                                isResolved = true;
                                if (gpsWatchdog) clearTimeout(gpsWatchdog);

                                geoCoordinates = { lat: position.coords.latitude, lng: position.coords.longitude };
                                const statusEl = document.getElementById('gps-status');
                                if (statusEl) {
                                    statusEl.className = "group flex items-center justify-center w-7 h-7 rounded-full bg-green-50 text-green-600 border border-green-200 shadow-sm";
                                    statusEl.innerHTML = '<i data-lucide="map-pin" class="w-3.5 h-3.5"></i>';
                                    statusEl.onclick = null;
                                    safeRenderLucide();
                                }
                                stopGpsRetry();
                                const banner = document.getElementById('gps-banner');
                                if (banner) banner.classList.add('hidden');

                                proceedSubmit(btn, originalBtnContent, guru, mapel, lokasi, topik, catatan, jpList, signatureCanvas, isSignatureEmpty);
                            },
                            (error) => {
                                handleGpsFailure(error ? `${error.code} - ${error.message}` : "Geolocation error");
                            },
                            { enableHighAccuracy: true, timeout: 8000, maximumAge: 5000 }
                        );
                    } catch (geoErr) {
                        handleGpsFailure(`Exception: ${geoErr.message}`);
                    }
                } else {
                    handleGpsFailure("Browser tidak mendukung geolokasi");
                }
            }, true);
            return;
        }
    }

    proceedSubmit(btn, originalBtnContent, guru, mapel, lokasi, topik, catatan, jpList, signatureCanvas, isSignatureEmpty);
}

// --- SUBMIT ---
window.submitData = async function () {
    if (isSubmittingJurnal || isVerifyingJournalTeacher) return;
    const btn = document.querySelector('button[onclick="submitData()"]');
    const originalBtnContent = btn ? btn.innerHTML : 'Simpan Laporan';

    // Helper: Fokus & Efek Blink Merah pada Field Kosong + Toast Feedback
    const showFieldError = (elementId, message = '') => {
        const el = document.getElementById(elementId);
        if (el && !el.classList.contains('hidden') && el.offsetParent !== null) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('ring-error');
            setTimeout(() => {
                el.classList.remove('ring-error');
                if (el.tagName === 'INPUT' || el.tagName === 'SELECT') el.focus();
            }, 1500);
        }
        if (message && typeof showToast === 'function') {
            showToast("Periksa Input", message, "warning");
        }
    };

    // 1. VALIDASI FORM TERLEBIH DAHULU (Tanpa Pop-up, Langsung Scroll & Kedip Merah)
    const rawGuru = document.getElementById('input-guru').value.trim();
    const submittingClass = currentClass;
    const submittingEditId = window.currentEditDocId;
    let verification;
    isVerifyingJournalTeacher = true;
    try {
        if (rawGuru && !findJournalTeacher(rawGuru) && btn) {
            btn.disabled = true;
            btn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> <span>Memverifikasi Pengajar...</span>';
            safeRenderLucide();
        }
        verification = await verifyJournalTeacher(rawGuru);
    } finally {
        isVerifyingJournalTeacher = false;
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalBtnContent;
        }
        safeRenderLucide();
    }
    // Jika pengguna mengganti kelas, mode edit atau nama selama pemulihan data,
    // jangan mengirim isian dari konteks yang sudah berubah.
    if (currentClass !== submittingClass || window.currentEditDocId !== submittingEditId ||
        document.getElementById('input-guru').value.trim() !== rawGuru) return;

    if (verification.status === 'unavailable') {
        showPopup('error', 'Data Guru Belum Dapat Diverifikasi', 'Daftar guru resmi belum berhasil dimuat. Periksa koneksi lalu tekan Simpan lagi. Isian jurnal Anda tetap tersimpan di formulir.');
        return;
    }
    if (verification.status !== 'matched') {
        showFieldError('input-guru');
        showPopup('error', 'Nama Pengajar Wajib Dipilih ⚠️', 'Nama pengajar belum cocok dengan daftar guru resmi. Silakan pilih nama yang sesuai dari daftar dropdown.');
        return;
    }
    const guru = includeJournalTeacher(verification.teacher);
    document.getElementById('input-guru').value = guru;
    selectedGuruName = guru;
    updateTeacherPhotoPreview(guru);

    // Baca isian setelah verifikasi agar perubahan saat menunggu tetap ikut disimpan.
    let mapel = document.getElementById('input-mapel').value;
    if (mapel === 'Lainnya') mapel = document.getElementById('input-mapel-manual').value.trim();
    const lokasi = document.getElementById('input-lokasi').value;
    const topik = document.getElementById('input-topik').value.trim();
    const catatan = document.getElementById('input-catatan').value;
    const jpList = Array.from(selectedJp).sort((a, b) => a - b);
    const signatureCanvas = document.getElementById('signature-pad');
    const isCanvasBlank = (canvas) => {
        if (!canvas) return true;
        const blank = document.createElement('canvas');
        blank.width = canvas.width;
        blank.height = canvas.height;
        return canvas.toDataURL() === blank.toDataURL();
    };
    const isSignatureEmpty = isCanvasBlank(signatureCanvas);
    const isImageVisible = !document.getElementById('preview-container').classList.contains('hidden');
    if (!mapel) {
        showFieldError('input-mapel', 'Silakan pilih mata pelajaran.');
        return;
    }
    if (jpList.length === 0) {
        showFieldError('jp-container', 'Pilih minimal 1 jam pelajaran (JP).');
        return;
    }
    if (!topik) {
        showFieldError('input-topik', 'Topik/materi pembelajaran wajib diisi.');
        return;
    }
    // Mode Input Baru wajib foto; Mode Edit tidak wajib foto baru (mempertahankan data foto yang sudah ada)
    if (!window.currentEditDocId && !isImageVisible && !activePhotoUpload) {
        showFieldError('photo-buttons', 'Foto kegiatan KBM wajib diunggah.');
        return;
    }
    if (!window.currentEditDocId && isSignatureEmpty) {
        showFieldError('signature-container', 'Tanda tangan digital wajib diisi.');
        return;
    }

    // 2. ANTI-DOUBLE SUBMIT MENGGUNAKAN MEMORI LOKAL TERLEBIH DAHULU (0 Read Firestore)
    if (!window.currentEditDocId) {
        const dnow = new Date();
        const yyyy = dnow.getFullYear();
        const mm = String(dnow.getMonth() + 1).padStart(2, '0');
        const todayStr = `${yyyy}-${mm}-${String(dnow.getDate()).padStart(2, '0')}`;
        const localMemId = `submitLog_${todayStr}_${currentClass.name}_${jpList.join('-')}`;
        let alreadySubmitted = false;
        try { alreadySubmitted = Boolean(localStorage.getItem(localMemId)); } catch (e) { }
        if (alreadySubmitted) {
            showPopup('error', 'Entri Ganda Terdeteksi ⚠️', `Anda sudah pernah menyimpan jurnal untuk kelas <b>${currentClass.name}</b> pada JP ini hari ini.<br><br>Gunakan fitur Edit pada halaman utama untuk mengubah data.`);
            return;
        }
    }

    // 3. HITUNG REKAP PRESENSI SISWA DARI FORM
    const studentRows = document.querySelectorAll('.student-row');
    const totalStudents = studentRows.length;
    let hadirCount = 0;
    const unhadirSummary = { S: 0, I: 0, A: 0, D: 0, T: 0 };
    const unhadirNames = [];
    studentRows.forEach(row => {
        const name = row.dataset.name || 'Siswa';
        const statusEl = document.getElementById(`attendance-${row.dataset.id}`);
        const status = (statusEl?.dataset.value || 'H').toUpperCase();
        if (status === 'H') {
            hadirCount++;
        } else {
            if (unhadirSummary[status] !== undefined) {
                unhadirSummary[status]++;
            }
            unhadirNames.push(`${name} (${status})`);
        }
    });

    // 4. PEMERIKSAAN KESESUAIAN JADWAL RESMI KBM & GERBANG VERIFIKASI KONDISIONAL
    const entryTanggal = window.currentEditDocId && window.currentEditData?.tanggal ? window.currentEditData.tanggal : null;
    const targetClassName = currentClass ? currentClass.name : 'Unknown';

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> <span>Memeriksa Jadwal...</span>`;
    }
    safeRenderLucide();

    let scheduleCheck = { hasSchedule: false, isMatch: true, reasons: [] };
    try {
        scheduleCheck = await compareWithActualSchedule(targetClassName, guru, mapel, jpList, entryTanggal);
    } catch (schedErr) {
        console.warn('[submitData] Gagal cek kesesuaian jadwal:', schedErr);
    }

    if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalBtnContent;
    }
    safeRenderLucide();

    // Dialog konfirmasi 3 centang HANYA muncul jika terdapat jadwal resmi KBM dan data pengisian TIDAK COCOK
    // (misal jam pengganti, tukar jam, beda guru/mapel, atau jam kosong di jadwal resmi)
    if (scheduleCheck.hasSchedule && !scheduleCheck.isMatch) {
        showConfirmSubmitDialog({
            guru,
            mapel,
            lokasi: lokasi || 'Di Ruang Kelas',
            topik,
            catatan,
            jpList,
            tanggal: entryTanggal,
            className: targetClassName,
            totalStudents,
            hadirCount,
            unhadirSummary,
            unhadirNames,
            scheduleCheck
        }, () => {
            handleGpsAndProceed(btn, originalBtnContent, guru, mapel, lokasi, topik, catatan, jpList, signatureCanvas, isSignatureEmpty);
        });
    } else {
        // Jika jadwal 100% cocok (atau tidak ada jadwal yang membatasi): langsung lanjut ke proses simpan
        handleGpsAndProceed(btn, originalBtnContent, guru, mapel, lokasi, topik, catatan, jpList, signatureCanvas, isSignatureEmpty);
    }
}

// Fungsi lanjutan submit setelah validasi lolos
async function proceedSubmit(btn, originalBtnContent, guru, mapel, lokasi, topik, catatan, jpList, signatureCanvas, isSignatureEmpty) {
    if (isSubmittingJurnal) return;
    isSubmittingJurnal = true;
    const photoControls = Array.from(document.querySelectorAll('#file-camera, #preview-container button, #photo-buttons button'));
    const photoDisabledStates = photoControls.map(control => control.disabled);
    photoControls.forEach(control => { control.disabled = true; });
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> <span>Mengirim...</span>`;
    }
    safeRenderLucide();

    // Verifikasi anti-double submit ditangani langsung oleh Cloudflare D1 SSOT

    try {
        let fotoUrl = "";
        const imgPreview = document.getElementById('image-preview');
        const isImageVisible = !document.getElementById('preview-container').classList.contains('hidden');
        // Fallback pratinjau lokal tetap memakai jalur unggah yang sama.
        if (!activePhotoUpload && isImageVisible && imgPreview.src.startsWith('data:image/')) {
            activePhotoUpload = createPhotoUpload(null, imgPreview.src);
        }
        const submittedPhoto = activePhotoUpload;
        if (submittedPhoto) {
            if (btn && !submittedPhoto.result) {
                btn.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> <span>Menunggu Selesai Upload Foto...</span>`;
            }
            safeRenderLucide();
            fotoUrl = (await waitForPhotoUpload(submittedPhoto)).url;
        } else if (window.currentEditDocId && isImageVisible && imgPreview.src.startsWith('http')) {
            fotoUrl = imgPreview.src;
        } else if (!window.currentEditDocId) {
            throw new Error('Foto kegiatan KBM wajib diunggah sebelum jurnal disimpan.');
        }

        const presensi_detail = [];
        document.querySelectorAll('.student-row').forEach(row => {
            const name = row.dataset.name;
            const nis = row.dataset.nis;
            const absen = row.dataset.absen;
            const status = document.getElementById(`attendance-${row.dataset.id}`).dataset.value || 'H';
            if (status !== 'H') {
                presensi_detail.push({ nama: name, nis: nis, absen: absen, status: status });
            }
        });

        const ttdBase64 = signatureCanvas.toDataURL('image/png');
        const guruUid = (window.guruDetailsMap && window.guruDetailsMap[guru] ? window.guruDetailsMap[guru].uid : null)
            || (window.currentEditDocId ? window.currentEditData?.uid_guru : null) || null;

        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const todayStr = `${yyyy}-${mm}-${dd}`;

        const entryTanggal = (window.currentEditDocId && window.currentEditData?.tanggal)
            ? window.currentEditData.tanggal
            : todayStr;

        const cfPayload = {
            id: window.currentEditDocId || `${yyyy}_${mm}-${Date.now()}`,
            tanggal: entryTanggal,
            kelas: currentClass.name,
            guru,
            uid_guru: guruUid,
            mapel,
            topik,
            catatan,
            jp: jpList,
            lokasi_mengajar: lokasi || window.currentEditData?.lokasi_mengajar || 'Ruang Kelas',
            foto_url: fotoUrl || window.uploadedFotoUrl || window.currentEditData?.foto_url || "",
            ttd: !isSignatureEmpty ? ttdBase64 : undefined,
            koordinat: geoCoordinates || window.currentEditData?.koordinat || { lat: 0, lng: 0 },
            presensi_detail
        };

        if (CloudflareAPI.isEnabled) {
            try {
                if (submittedPhoto) submittedPhoto.saveAttempted = true;
                if (window.currentEditDocId) {
                    try {
                        await CloudflareAPI.updateJurnal(window.currentEditDocId, cfPayload);
                    } catch (updateErr) {
                        console.warn("[Cloudflare D1] Update via PUT gagal, mencoba fallback via POST force_submit:", updateErr);
                        await CloudflareAPI.saveJurnal({ ...cfPayload, id: window.currentEditDocId, force_submit: true });
                    }
                } else {
                    await CloudflareAPI.saveJurnal(cfPayload);
                }
                console.log("⚡ [Cloudflare D1] Sukses menyimpan jurnal mengajar (0 Firestore Write).");
            } catch (cfSaveErr) {
                if (cfSaveErr.isDuplicate) {
                    showPopup('error', 'Entri Ganda Terdeteksi ⚠️', `Anda sudah pernah menyimpan jurnal untuk kelas <b>${currentClass.name}</b> pada Mapel <b>${mapel}</b> hari ini.<br><br>Gunakan fitur Edit pada halaman utama untuk mengubah data.`);
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = originalBtnContent;
                    }
                    safeRenderLucide();
                    return;
                }
                console.error("[Cloudflare D1] Simpan jurnal gagal:", cfSaveErr);
                throw cfSaveErr;
            }
        }

        // Simpan log keberhasilan submit ke LocalStorage agar menghindari duplikasi (Hemat Kuota)
        try {
            if (!window.currentEditDocId) {
                const memoryId = `submitLog_${todayStr}_${currentClass.name}_${jpList.join('-')}`;
                localStorage.setItem(memoryId, 'true');
            }

            // Bersihkan cache rekap hari ini agar saat kembali ke beranda langsung tersinkronisasi
            CacheHelper.remove(`rekap_jurnal_${todayStr}_ALL`);
            CacheHelper.remove(`rekap_jurnal_${todayStr}_ALL_ALL_RECORDS`);
            CacheHelper.remove(`rekap_jurnal_${todayStr}_${currentClass.name}`);
            if (entryTanggal && entryTanggal !== todayStr) {
                CacheHelper.remove(`rekap_jurnal_${entryTanggal}_ALL`);
                CacheHelper.remove(`rekap_jurnal_${entryTanggal}_ALL_ALL_RECORDS`);
                CacheHelper.remove(`rekap_jurnal_${entryTanggal}_${currentClass.name}`);
            }
        } catch (memErr) {
            console.error('Gagal menyimpan memori anti-double submit', memErr);
        }

        // Kata motivasi random untuk guru
        let randomMotivasi = "Semangat terus, Bapak/Ibu! Di tangan Anda, peradaban masa depan sedang dibentuk."; // Default
        try {
            const MOTIVASI_DATA_EXPIRY = 30 * 24 * 60 * 60 * 1000; // 30 hari - hangus otomatis saat versi sistem diperbarui
            const MOTIVASI_BAG_EXPIRY = Infinity; // Bag tidak pernah expired oleh waktu, hanya reset saat kosong/data berubah
            let motivasiList = CacheHelper.get('daftar_motivasi_cache', MOTIVASI_DATA_EXPIRY);
            let dataRefreshed = false;

            if (!motivasiList) {
                if (CloudflareAPI.isEnabled) {
                    try {
                        const bundle = await CloudflareAPI.getMasterBundle();
                        if (bundle && bundle.motivasi && bundle.motivasi.length > 0) {
                            motivasiList = bundle.motivasi;
                            CacheHelper.set('daftar_motivasi_cache', motivasiList);
                            dataRefreshed = true;
                        }
                    } catch (cfErr) {
                        console.error("[Motivasi] Cloudflare D1 error:", cfErr);
                    }
                }
            }

            if (motivasiList && motivasiList.length > 0) {
                // Shuffle bag pattern: pastikan tidak ada teks yang diulang sampai SEMUA teks habis
                let unseenMotivasi = CacheHelper.get('motivasi_unseen_cache', MOTIVASI_BAG_EXPIRY);

                // Deteksi perubahan admin: jika jumlah motivasi berubah setelah re-fetch, reset bag
                const savedBagSize = parseInt(localStorage.getItem('motivasi_bag_total') || '0');
                const adminChanged = dataRefreshed && savedBagSize > 0 && savedBagSize !== motivasiList.length;

                if (!unseenMotivasi || unseenMotivasi.length === 0 || adminChanged) {
                    // Refill bag dan acak (Fisher-Yates shuffle)
                    unseenMotivasi = [...motivasiList];
                    for (let i = unseenMotivasi.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [unseenMotivasi[i], unseenMotivasi[j]] = [unseenMotivasi[j], unseenMotivasi[i]];
                    }
                    localStorage.setItem('motivasi_bag_total', motivasiList.length.toString());
                }

                // Ambil 1 dari bag yang belum terlihat
                randomMotivasi = unseenMotivasi.pop();

                // Simpan sisa bag ke cache (tanpa expiry waktu)
                CacheHelper.set('motivasi_unseen_cache', unseenMotivasi);
            }
        } catch (mErr) {
            console.warn("Gagal mengambil/memuat cache motivasi dinamis, menggunakan nilai default.", mErr);
        }

        // Format string Jam Pelajaran (contoh: "JP 1, 2" atau "JP 1-2")
        const jpText = jpList && jpList.length > 0
            ? (jpList.length > 1 && jpList[jpList.length - 1] - jpList[0] === jpList.length - 1
                ? `JP ${jpList[0]}-${jpList[jpList.length - 1]}`
                : `JP ${jpList.join(', ')}`)
            : '';
        const jpDisplay = jpText ? ` (${jpText})` : '';

        const jurnalLabel = window.currentEditDocId
            ? "Pembaruan Jurnal Mengajar"
            : (window.isModeDaring ? "Jurnal Mengajar Daring" : "Jurnal Mengajar");
        const finalMessage = `${escapeHTML(jurnalLabel)} <b>${escapeHTML(mapel)}</b> kelas <b>${escapeHTML(currentClass.name)}</b>${escapeHTML(jpDisplay)} berhasil disimpan. Selamat Mengajar ❤️<br><br><i>"${escapeHTML(randomMotivasi)}"</i>`;

        const teacherProfile = typeof getTeacherProfile === 'function' ? getTeacherProfile(guru) : null;
        showPopup('success', 'Berhasil! 🎉', finalMessage, () => location.reload(), false, { teacherProfile, teacherName: guru });

    } catch (error) {
        console.error("Gagal Mengirim:", error);
        const message = document.createElement('span');
        message.textContent = error.message;
        showPopup(error.code === 'PHOTO_PENDING' ? 'confirm' : 'error',
            error.code === 'PHOTO_PENDING' ? 'Foto Masih Diunggah' : 'Gagal Mengirim', message.innerHTML);
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalBtnContent;
        }
        safeRenderLucide();
    } finally {
        isSubmittingJurnal = false;
        photoControls.forEach((control, index) => { control.disabled = photoDisabledStates[index]; });
    }
}

// --- AVATAR & FOTO PROFIL GTK (OWASP ASVS LEVEL 2) ---
function escapeHTML(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getTeacherInitials(name) {
    if (!name || typeof name !== 'string') return 'GT';
    let clean = name.trim();
    const titleRegex = /\b(dr\.|dr|dra\.|dra|drs\.|drs|ir\.|ir|prof\.|prof|h\.|h|hj\.|hj|st\.|st|s\.pd\.|s\.pd|s\.pd\.h|s\.pd\.b|m\.pd\.|m\.pd|m\.pd\.h|s\.ag\.|s\.ag|s\.kom\.|s\.kom|m\.kom\.|m\.kom|s\.e\.|s\.e|m\.m\.|m\.m|s\.si\.|s\.si|m\.si\.|m\.si|s\.sos\.|s\.sos|m\.sos\.|m\.sos|s\.sn\.|s\.sn|m\.sn\.|m\.sn|b\.a\.|b\.a|m\.a\.|m\.a|ph\.d\.|ph\.d|gr\.|gr|nip)\b/gi;
    let filtered = clean.replace(titleRegex, ' ');
    if (/\bTim\b/i.test(filtered) && filtered.replace(/\bTim\b/gi, '').trim().length > 0) {
        filtered = filtered.replace(/\bTim\b/gi, ' ');
    }
    filtered = filtered.replace(/[^a-zA-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!filtered) {
        filtered = clean.replace(/[^a-zA-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();
    }
    if (!filtered) return 'GT';
    const parts = filtered.split(' ').filter(Boolean);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return filtered.slice(0, 2).toUpperCase();
}

function renderTeacherJournalAvatar(photoUrl, teacherName, size = 'sm', teacherId = '') {
    const rawName = teacherName || 'Pengajar';
    const safeName = escapeHTML(rawName);
    const initials = getTeacherInitials(rawName);
    // Penanda VIP diterapkan otomatis oleh js/vip-manager.js lewat atribut ini
    const vipAttr = teacherId
        ? ` data-vip-ptk-id="${escapeHTML(String(teacherId))}" data-vip-size="${size === 'lg' || size === 'popup' ? '' : 'vip-avatar-sm'}"`
        : '';

    const sizeConfig = {
        xs: { wh: 'w-5 h-5 min-w-[20px]', text: 'text-[9px]' },
        sm: { wh: 'w-7 h-7 min-w-[28px]', text: 'text-[10px]' },
        md: { wh: 'w-8 h-8 min-w-[32px]', text: 'text-xs' },
        lg: { wh: 'w-11 h-11 sm:w-12 sm:h-12 min-w-[44px] sm:min-w-[48px]', text: 'text-sm sm:text-base' },
        popup: { wh: 'w-14 h-14 min-w-[56px]', text: 'text-base' }
    };
    const conf = sizeConfig[size] || sizeConfig.sm;

    const fallbackHTML = `
        <div class="${conf.wh} rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-extrabold ${conf.text} flex items-center justify-center shrink-0 shadow-2xs select-none ring-2 ring-white/30 dark:ring-gray-700/50" title="${safeName}"${vipAttr}>
            <span>${initials}</span>
        </div>
    `.trim();

    let resolved = photoUrl ? (typeof resolvePhotoUrl === 'function' ? resolvePhotoUrl(photoUrl) : photoUrl) : '';
    if (resolved && !/^(https?:|\/|data:image\/)/i.test(resolved)) {
        resolved = '';
    }
    if (!resolved) {
        return fallbackHTML;
    }

    const safeUrl = escapeHTML(resolved);

    return `
        <div class="relative ${conf.wh} shrink-0 inline-flex items-center justify-center"${vipAttr}>
            <img src="${safeUrl}" alt="${safeName}" loading="lazy"
                class="${conf.wh} rounded-full object-cover shadow-2xs ring-2 ring-blue-100 dark:ring-blue-900/50"
                onerror="this.onerror=null; this.classList.add('hidden'); if(this.nextElementSibling) this.nextElementSibling.classList.remove('hidden');" />
            <div class="${conf.wh} rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-extrabold ${conf.text} hidden flex items-center justify-center shrink-0 shadow-2xs select-none ring-2 ring-white/30 dark:ring-gray-700/50" title="${safeName}">
                <span>${initials}</span>
            </div>
        </div>
    `.trim();
}

function getTeacherProfile(teacherName) {
    const cleanName = (teacherName || '').trim();
    if (!cleanName) return null;

    const masterTeachers = typeof getJournalMasterTeachers === 'function'
        ? getJournalMasterTeachers()
        : (typeof CacheHelper !== 'undefined' && CacheHelper.get ? CacheHelper.get('data_guru') : null) || window.allMasterTeachers || [];
    const classTeachers = (typeof activeTeachers !== 'undefined' && Array.isArray(activeTeachers) && activeTeachers.length > 0)
        ? activeTeachers
        : masterTeachers;

    let matchedTeacher = null;
    if (typeof smartMatchTeacher === 'function') {
        const matchedName = smartMatchTeacher(cleanName, classTeachers);
        if (matchedName) {
            matchedTeacher = classTeachers.find(t => (t.nama || t.name) === matchedName);
        }
        if (!matchedTeacher && masterTeachers.length > 0) {
            const masterMatchedName = smartMatchTeacher(cleanName, masterTeachers);
            if (masterMatchedName) {
                matchedTeacher = masterTeachers.find(t => (t.nama || t.name) === masterMatchedName);
            }
        }
    }
    if (!matchedTeacher) {
        matchedTeacher = classTeachers.find(t => {
            const tName = t.nama || t.name || '';
            return tName.toLowerCase() === cleanName.toLowerCase() ||
                   (typeof normalizeTeacherName === 'function' && normalizeTeacherName(tName) === normalizeTeacherName(cleanName));
        });
        if (!matchedTeacher && masterTeachers.length > 0) {
            matchedTeacher = masterTeachers.find(t => {
                const tName = t.nama || t.name || '';
                return tName.toLowerCase() === cleanName.toLowerCase() ||
                       (typeof normalizeTeacherName === 'function' && normalizeTeacherName(tName) === normalizeTeacherName(cleanName));
            });
        }
    }

    const displayName = matchedTeacher ? (matchedTeacher.nama || matchedTeacher.name) : cleanName;
    const teacherId = matchedTeacher ? (matchedTeacher.id || matchedTeacher.uid || '') : '';
    let photoUrl = matchedTeacher ? (matchedTeacher.foto || matchedTeacher.photo_url || '') : '';
    if (!photoUrl && teacherId) {
        photoUrl = `/api/photos/gtk/${teacherId}.webp`;
    }
    const nip = matchedTeacher?.nip ? (matchedTeacher.nip.length > 8 ? `NIP: ${matchedTeacher.nip}` : matchedTeacher.nip) : '';
    const isBk = matchedTeacher && typeof isGuruBk === 'function' ? isGuruBk(matchedTeacher) : false;

    return {
        teacher: matchedTeacher,
        displayName,
        teacherId,
        photoUrl,
        nip,
        isBk
    };
}

function updateTeacherPhotoPreview(teacherName) {
    const avatarDisplay = document.getElementById('teacher-avatar-display');
    const nameDisplay = document.getElementById('teacher-display-name');
    const subDisplay = document.getElementById('teacher-display-sub');
    const roleBadge = document.getElementById('teacher-role-badge');
    const statusBadge = document.getElementById('teacher-card-status-badge');

    const cleanName = (teacherName || '').trim();

    if (!cleanName) {
        if (avatarDisplay) {
            avatarDisplay.innerHTML = `
                <div class="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-slate-200 dark:bg-slate-700/80 text-slate-400 dark:text-slate-500 flex items-center justify-center ring-2 ring-slate-100 dark:ring-slate-700 shadow-2xs">
                    <i data-lucide="user" class="w-6 h-6"></i>
                </div>
            `;
            if (typeof safeRenderLucide === 'function') safeRenderLucide();
        }
        if (nameDisplay) nameDisplay.textContent = 'Belum ada pengajar dipilih';
        if (subDisplay) subDisplay.textContent = 'Ketik atau pilih nama Anda pada kolom di bawah';
        if (roleBadge) {
            roleBadge.textContent = '';
            roleBadge.classList.add('hidden');
        }
        if (statusBadge) statusBadge.classList.add('hidden');
        return;
    }

    const profile = getTeacherProfile(cleanName);
    const matchedTeacher = profile?.teacher || null;
    const displayName = profile?.displayName || cleanName;
    const photoUrl = profile?.photoUrl || '';
    const nip = profile?.nip || '';
    const isBk = profile?.isBk || false;

    if (avatarDisplay) {
        avatarDisplay.innerHTML = renderTeacherJournalAvatar(photoUrl, displayName, 'lg', profile?.teacherId || '');
        if (typeof safeRenderLucide === 'function') safeRenderLucide();
    }
    if (nameDisplay) {
        nameDisplay.textContent = displayName;
    }
    if (subDisplay) {
        if (nip) {
            subDisplay.textContent = nip;
        } else {
            subDisplay.textContent = "Pengajar Terverifikasi SMANTARA";
        }
    }
    if (roleBadge) {
        if (isBk) {
            roleBadge.innerHTML = '<i class="fa-solid fa-user-doctor text-[9px] mr-1"></i>Guru BK';
            roleBadge.className = 'text-[10px] bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 font-bold px-2 py-0.5 rounded shrink-0 inline-flex items-center';
        } else if (matchedTeacher?.role === 'wali_kelas') {
            roleBadge.textContent = 'Wali Kelas';
            roleBadge.className = 'text-[10px] bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-bold px-2 py-0.5 rounded shrink-0 inline-flex items-center';
        } else {
            roleBadge.textContent = 'Guru Pengampu';
            roleBadge.className = 'text-[10px] bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-bold px-2 py-0.5 rounded shrink-0 inline-flex items-center';
        }
    }
    if (statusBadge) {
        statusBadge.classList.remove('hidden');
        statusBadge.classList.add('inline-flex');
    }
}

window.getTeacherInitials = getTeacherInitials;
window.renderTeacherJournalAvatar = renderTeacherJournalAvatar;
window.getTeacherProfile = getTeacherProfile;
window.updateTeacherPhotoPreview = updateTeacherPhotoPreview;

// --- CUSTOM TEACHER DROPDOWN LOGIC ---
const inputGuru = document.getElementById('input-guru');
const dropdownGuru = document.getElementById('guru-dropdown');

function renderGuruDropdown(items) {
    if (!dropdownGuru) return;
    if (!items || items.length === 0) {
        dropdownGuru.innerHTML = '<div class="p-3 text-xs text-gray-400 text-center">Guru tidak ditemukan.</div>';
        return;
    }

    dropdownGuru.innerHTML = items.map(t => {
        const safeName = (t.nama || t.name || '').replace(/'/g, "\\'");
        const nipLabel = t.nip ? (t.nip.length > 8 ? `NIP: ${t.nip}` : t.nip) : '';
        const isBk = isGuruBk(t);
        const bkBadge = isBk ? `<span class="text-[10px] text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/40 px-2 py-0.5 rounded font-bold mr-1.5 shrink-0 inline-flex items-center gap-1"><i class="fa-solid fa-user-doctor text-[9px]"></i> Guru BK</span>` : '';
        const tId = t.id || t.uid || '';
        let tFoto = t.foto || t.photo_url || '';
        if (!tFoto && tId) {
            tFoto = `/api/photos/gtk/${tId}.webp`;
        }
        const avatarMini = renderTeacherJournalAvatar(tFoto, t.nama || t.name, 'sm', tId);

        return `
        <div onclick="selectGuru('${safeName}')" 
             class="guru-dropdown-item p-2.5 sm:p-3 text-sm text-gray-700 dark:text-gray-200 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer border-b border-gray-50 dark:border-gray-700 last:border-0 transition-colors flex items-center justify-between gap-2">
            <div class="flex items-center gap-2.5 min-w-0">
                ${avatarMini}
                <span class="font-medium truncate">${t.nama || t.name}</span>
            </div>
            <div class="flex items-center gap-1 shrink-0">
                ${bkBadge}
                ${nipLabel ? `<span class="text-[10px] text-gray-400 bg-gray-100 dark:bg-gray-700/50 px-1.5 py-0.5 rounded font-mono">${nipLabel}</span>` : ''}
            </div>
        </div>
        `;
    }).join('');
}

if (inputGuru) {
    inputGuru.addEventListener('focus', () => {
        inputGuru.classList.remove('ring-2', 'ring-rose-500', 'border-rose-500', 'bg-rose-50', 'dark:bg-rose-950/40', 'placeholder:text-rose-500');
        if (inputGuru.hasAttribute('data-orig-placeholder')) {
            inputGuru.placeholder = inputGuru.getAttribute('data-orig-placeholder');
        }

        const queryStr = inputGuru.value.trim().toLowerCase();
        if (queryStr && queryStr !== (selectedGuruName || '').toLowerCase()) {
            const normQuery = normalizeTeacherName(queryStr);
            const filtered = activeTeachers.filter(t => {
                const nameLower = (t.nama || '').toLowerCase();
                if (nameLower.includes(queryStr)) return true;
                const normT = normalizeTeacherName(t.nama);
                return normT.includes(normQuery);
            });
            renderGuruDropdown(filtered);
        } else {
            renderGuruDropdown(activeTeachers);
            if (queryStr && queryStr === (selectedGuruName || '').toLowerCase()) {
                inputGuru.select();
            }
        }
        dropdownGuru.classList.remove('hidden');
    });

    inputGuru.addEventListener('input', (e) => {
        inputGuru.classList.remove('ring-2', 'ring-rose-500', 'border-rose-500', 'bg-rose-50', 'dark:bg-rose-950/40', 'placeholder:text-rose-500');
        selectedGuruName = ''; // Reset pilihan karena user sedang mengetik baru
        const val = e.target.value.trim().toLowerCase();
        if (!val) {
            updateTeacherPhotoPreview('');
        }
        const normVal = normalizeTeacherName(val);
        const filtered = activeTeachers.filter(t => {
            if (!val) return true;
            const nameLower = (t.nama || '').toLowerCase();
            if (nameLower.includes(val)) return true;
            const normName = normalizeTeacherName(t.nama);
            return normName.includes(normVal);
        });
        renderGuruDropdown(filtered);
        dropdownGuru.classList.remove('hidden');
    });

    inputGuru.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const firstItem = dropdownGuru.querySelector('.guru-dropdown-item');
            if (firstItem) {
                firstItem.click();
            }
        } else if (e.key === 'Escape') {
            dropdownGuru.classList.add('hidden');
        }
    });

    // Jika tidak memilih dari dropdown saat blur, verifikasi apakah teks cocok dengan guru terdaftar
    inputGuru.addEventListener('blur', () => {
        setTimeout(() => {
            const currentVal = inputGuru.value.trim();
            // Cek apakah nilai yang diketik/terisi cocok secara valid dengan salah satu guru aktif atau master
            if (currentVal) {
                const teacher = findJournalTeacher(currentVal);
                const matched = teacher ? includeJournalTeacher(teacher) : '';
                if (matched) {
                    inputGuru.value = matched;
                    selectedGuruName = matched;
                    updateTeacherPhotoPreview(matched);
                    filterMapelByGuru();
                    if (typeof autoFillTeacherSchedule === 'function') {
                        autoFillTeacherSchedule(matched);
                    }
                    checkHistoryTrigger();
                    showPresensiNav();
                    dropdownGuru.classList.add('hidden');
                    return;
                }
            }

            // Jangan hapus nama otomatis/ketikan saat data belum cocok. Simpan akan
            // mencoba data segar terlebih dahulu sebelum menampilkan kesalahan.
            if (currentVal !== selectedGuruName) selectedGuruName = '';
            if (!currentVal) {
                updateTeacherPhotoPreview('');
                filterMapelByGuru();
            }
            dropdownGuru.classList.add('hidden');
        }, 250);
    });
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (inputGuru && dropdownGuru && !inputGuru.contains(e.target) && !dropdownGuru.contains(e.target)) {
        dropdownGuru.classList.add('hidden');
    }
});

window.selectGuru = function (name) {
    selectedGuruName = name;
    inputGuru.value = name;
    dropdownGuru.classList.add('hidden');
    updateTeacherPhotoPreview(name);
    filterMapelByGuru();
    if (typeof autoFillTeacherSchedule === 'function') {
        autoFillTeacherSchedule(name);
    }
    checkHistoryTrigger(); // Cek kemunculan tombol riwayat
    showPresensiNav(); // Tampilkan navigasi riwayat presensi
}

// --- RIWAYAT TOPIK SEBELUMNYA ---
let currentTopikList = null;
let historyCacheKey = ""; // Pembeda cache guru & kelas

// In-memory cache: { [cacheKey]: { topik, catatan } }
const topicPlaceholderCache = {};

/**
 * Auto-update placeholder untuk input topik & catatan berdasarkan riwayat pertemuan sebelumnya.
 */
async function updatePreviousTopicPlaceholder(className, guruName, mapelName) {
    const inputTopik = document.getElementById('input-topik');
    const inputCatatan = document.getElementById('input-catatan');
    if (!inputTopik || !className || !guruName) return;

    // Jika sedang dalam mode Edit, biarkan placeholder default
    if (window.currentEditDocId) return;

    const cacheKey = `${className}_${guruName}_${mapelName || ''}`;

    // 1. Cek in-memory cache untuk penerapan instan (0 latency, 0 read Firestore)
    if (topicPlaceholderCache[cacheKey]) {
        const cached = topicPlaceholderCache[cacheKey];
        if (cached.topik) inputTopik.placeholder = `Sebelumnya: ${cached.topik}`;
        else inputTopik.placeholder = "Judul materi pembelajaran...";

        if (inputCatatan) {
            if (cached.catatan) inputCatatan.placeholder = `Sebelumnya: ${cached.catatan}`;
            else inputCatatan.placeholder = "Catatan tambahan...";
        }
        return;
    }

    try {
        let prevTopik = "";
        let prevCatatan = "";

        // 2. Gunakan cache list riwayat jika sudah dimuat di memori
        if (currentTopikList && currentTopikList.length > 0) {
            prevTopik = currentTopikList[0].topik || '';
            prevCatatan = currentTopikList[0].catatan || '';
        } else {
            let results = [];
            if (CloudflareAPI.isEnabled) {
                try {
                    const cfRes = await CloudflareAPI.getHistory({
                        type: 'placeholder',
                        guru: guruName,
                        mapel: mapelName,
                        kelas: className
                    });
                    if (cfRes) {
                        results.push({
                            topik: cfRes.topik || '',
                            catatan: cfRes.catatan || ''
                        });
                    }
                } catch (cfErr) {
                    console.error("[Placeholder] Cloudflare D1 history fetch error:", cfErr);
                }
            }

            if (results.length > 0) {
                prevTopik = results[0].topik || '';
                prevCatatan = results[0].catatan || '';
            }
        }

        // Simpan ke cache
        topicPlaceholderCache[cacheKey] = { topik: prevTopik, catatan: prevCatatan };

        // Pastikan form saat ini masih dalam konteks yang sama sebelum menerapkan
        const curGuru = document.getElementById('input-guru')?.value?.trim();
        let curMapel = document.getElementById('input-mapel')?.value?.trim();
        if (curMapel === 'Lainnya' || curMapel === 'Lainnya...') {
            curMapel = document.getElementById('input-mapel-manual')?.value?.trim();
        }
        if (currentClass?.name === className && curGuru === guruName && (curMapel || '') === (mapelName || '')) {
            if (prevTopik) {
                inputTopik.placeholder = `Sebelumnya: ${prevTopik}`;
            } else {
                inputTopik.placeholder = "Judul materi pembelajaran...";
            }

            if (inputCatatan) {
                if (prevCatatan) {
                    inputCatatan.placeholder = `Sebelumnya: ${prevCatatan}`;
                } else {
                    inputCatatan.placeholder = "Catatan tambahan...";
                }
            }
        }
    } catch (err) {
        console.warn('[Placeholder] Gagal mengatur placeholder topik sebelumnya:', err);
    }
}

window.checkHistoryTrigger = function () {
    const wrapperHistory = document.getElementById('riwayat-inline-wrapper');
    const inputTopik = document.getElementById('input-topik');
    const inputCatatan = document.getElementById('input-catatan');
    if (!wrapperHistory) return;

    const guruName = document.getElementById('input-guru').value.trim();
    let mapelName = document.getElementById('input-mapel').value.trim();
    if (mapelName === 'Lainnya' || mapelName === 'Lainnya...') {
        mapelName = document.getElementById('input-mapel-manual').value.trim();
    }
    if (currentClass && currentClass.name && guruName && mapelName) {
        // Tampilkan tombol jika kelas, guru, dan mapel telah terpilih konkrit
        wrapperHistory.classList.remove('hidden');

        // Reset cache jika guru, kelas, atau mapel berubah
        const newKey = `${currentClass.name}_${guruName}_${mapelName}`;
        if (historyCacheKey !== newKey) {
            currentTopikList = null;
            historyCacheKey = newKey;

            // Tutup accordion if user changed context
            const container = document.getElementById('container-riwayat-topik');
            const icon = document.getElementById('icon-toggle-riwayat');
            if (container && !container.classList.contains('max-h-0')) {
                container.classList.add('max-h-0', 'opacity-0');
                container.classList.remove('max-h-[500px]', 'opacity-100');
                icon.classList.remove('rotate-180');
            }
        }

        // Perbarui placeholder topik dan catatan sebelumnya
        updatePreviousTopicPlaceholder(currentClass.name, guruName, mapelName);
    } else {
        wrapperHistory.classList.add('hidden');
        if (inputTopik && !window.currentEditDocId) inputTopik.placeholder = "Judul materi pembelajaran...";
        if (inputCatatan && !window.currentEditDocId) inputCatatan.placeholder = "Catatan tambahan...";
    }
};

let debounceHistoryTimer = null;
const debouncedCheckHistoryTrigger = () => {
    clearTimeout(debounceHistoryTimer);
    debounceHistoryTimer = setTimeout(() => {
        if (typeof window.checkHistoryTrigger === 'function') {
            window.checkHistoryTrigger();
        }
    }, 350);
};

// Pasang Listener agar trigger riwayat & rekap presensi semester reaktif saat mapel diubah
document.getElementById('input-mapel')?.addEventListener('change', () => {
    checkHistoryTrigger();
    if (typeof window.checkSemesterAttendanceRecapTrigger === 'function') {
        window.checkSemesterAttendanceRecapTrigger();
    }
});
document.getElementById('input-mapel-manual')?.addEventListener('input', () => {
    debouncedCheckHistoryTrigger();
    if (typeof window.checkSemesterAttendanceRecapTrigger === 'function') {
        window.checkSemesterAttendanceRecapTrigger();
    }
});
document.getElementById('input-guru')?.addEventListener('input', debouncedCheckHistoryTrigger);

document.getElementById('btn-toggle-riwayat')?.addEventListener('click', async () => {
    const container = document.getElementById('container-riwayat-topik');
    const icon = document.getElementById('icon-toggle-riwayat');
    const listContainer = document.getElementById('list-riwayat-topik');
    const loadingUI = document.getElementById('loading-riwayat');

    // Toggle logika Accordion (Buka/Tutup)
    const isClosed = container.classList.contains('max-h-0');

    if (isClosed) {
        // Sedang mau DI TAMPILKAN
        container.classList.remove('max-h-0', 'opacity-0');
        container.classList.add('max-h-[500px]', 'opacity-100');
        icon.classList.add('rotate-180');

        // Mulai tarik data jika cache kosong
        if (currentTopikList !== null) {
            renderTopikList(currentTopikList);
            return;
        }

        const guruName = document.getElementById('input-guru').value.trim();
        let mapelName = document.getElementById('input-mapel').value.trim();
        if (mapelName === 'Lainnya' || mapelName === 'Lainnya...') {
            mapelName = document.getElementById('input-mapel-manual').value.trim();
        }
        const className = currentClass ? currentClass.name : '';

        listContainer.innerHTML = '';
        loadingUI.classList.remove('hidden');

        try {
            let results = [];
            if (CloudflareAPI.isEnabled) {
                try {
                    const cfTopics = await CloudflareAPI.getHistory({
                        type: 'recent_topics',
                        guru: guruName,
                        mapel: mapelName,
                        kelas: className,
                        limit: 5
                    });
                    if (Array.isArray(cfTopics) && cfTopics.length > 0) {
                        results = cfTopics.map(t => ({
                            topik: t.topik || '',
                            catatan: t.catatan || '',
                            waktu: t.created_at || t.tanggal ? new Date(t.created_at || t.tanggal) : new Date(),
                            mapel: t.mapel || mapelName || 'Mapel Umum'
                        }));
                    }
                } catch (cfErr) {
                    console.warn("[Recent Topics] Cloudflare D1 error, fallback to Firestore:", cfErr);
                }
            }

            currentTopikList = results; // Simpan di memori sementara (cache)
            loadingUI.classList.add('hidden');
            renderTopikList(results);

        } catch (error) {
            console.error("Gagal menarik histori topik:", error);
            loadingUI.classList.add('hidden');
            listContainer.innerHTML = `
                <div class="p-3 bg-red-50 text-red-600 rounded-xl text-center border border-red-100 text-xs">
                    <i class="fa-solid fa-triangle-exclamation mb-1 text-lg"></i>
                    <p>Gagal memuat riwayat topik. Pastikan jaringan internet stabil.</p>
                </div>
            `;
        }
    } else {
        // Sedang mau DI TUTUP
        container.classList.remove('max-h-[500px]', 'opacity-100');
        container.classList.add('max-h-0', 'opacity-0');
        icon.classList.remove('rotate-180');
    }
});

function renderTopikList(arr) {
    const listContainer = document.getElementById('list-riwayat-topik');
    if (arr.length === 0) {
        listContainer.innerHTML = `
            <div class="py-4 text-center text-gray-400">
                <i class="fa-solid fa-folder-open text-2xl mb-2 opacity-50"></i>
                <p class="text-[11px] uppercase tracking-wider font-bold">Belum Ada Riwayat Jurnal</p>
            </div>
        `;
        return;
    }

    listContainer.innerHTML = arr.map(item => {
        let dateStr = "Belum Disimpan";
        if (item.waktu) {
            dateStr = item.waktu.toLocaleDateString('id-ID', {
                day: 'numeric', month: 'short'
            });
        }

        let catatanHtml = '';
        if (item.catatan) {
            catatanHtml = `<span class="text-[9px] text-gray-400 italic font-normal ml-1">"${item.catatan}"</span>`;
        }

        return `
            <div class="px-2 py-1.5 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-100 dark:border-gray-700/50 hover:border-purple-300 dark:hover:border-purple-500/50 hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors group cursor-pointer flex items-center justify-between gap-2" 
                 onclick="document.getElementById('input-topik').value = this.dataset.teks; document.getElementById('input-catatan').value = this.dataset.catn; document.getElementById('btn-toggle-riwayat').click();"
                 data-teks="${item.topik.replace(/"/g, '&quot;')}"
                 data-catn="${(item.catatan || '').replace(/"/g, '&quot;')}">
                
                <div class="flex-1 min-w-0 truncate">
                    <span class="text-[11px] font-semibold text-gray-800 dark:text-gray-300 group-hover:text-purple-900 dark:group-hover:text-purple-300">${item.topik}</span>
                    ${catatanHtml}
                </div>
                
                <div class="text-[8px] font-medium text-gray-400 dark:text-gray-500 whitespace-nowrap flex-shrink-0">
                    <i class="fa-regular fa-calendar mr-1"></i>${dateStr}
                </div>
            </div>
        `;
    }).join('');
}

window.refreshClassData = async function () {
    if (!currentClass || !currentClass.name) {
        window.location.reload();
        return;
    }
    try {
        const className = currentClass.name;
        CacheHelper.remove(`data_siswa_${className}`);
        CacheHelper.remove('data_guru');
        CacheHelper.remove('data_mapel');
        CacheHelper.remove('data_lokasi');
        CacheHelper.remove('jurnal_schedule_cache');
        CacheHelper.remove('jurnal_schedule_cache_ts');
        cachedScheduleData = null;

        if (typeof showToast === 'function') {
            showToast("Memperbarui Data...", "Mengambil data siswa, guru & jadwal terbaru dari cloud.", "info");
        }
        // Tombol perbarui harus melewati cache API dan salinan memori juga.
        try {
            await refreshJournalTeacherDirectory();
        } catch (e) {
            console.warn('[Master Data] Memakai daftar guru terakhir saat pembaruan gagal:', e);
        }

        await selectClass(className);
        if (typeof showToast === 'function') {
            showToast("Berhasil Selesai", "Data siswa, guru, dan jadwal telah diperbarui.", "success");
        }
    } catch (e) {
        console.error("Refresh class data failed:", e);
    }
};

safeRenderLucide();

function renderAppVersion() {
    if (typeof document !== 'undefined' && APP_VERSION) {
        document.querySelectorAll('.app-version-text').forEach(el => {
            const prefix = el.getAttribute('data-prefix') || 'Versi ';
            el.textContent = `${prefix}${APP_VERSION}`;
        });
    }
}
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', renderAppVersion);
    } else {
        renderAppVersion();
    }
}

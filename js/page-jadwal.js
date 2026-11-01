import { auth, resolvePhotoUrl } from './config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { initLayout } from './global.js';
import {
    parseASCSchedule,
    getWeeklyScheduleByClass,
    getWeeklyScheduleByTeacher,
    getAllScheduleClasses,
    getAllScheduleTeachers
} from './asc-schedule-parser.js';

/**
 * Ekstraksi 2 huruf inisial nama guru dengan cerdas (menghilangkan gelar umum)
 */
export function getTeacherInitials(name) {
    if (!name || typeof name !== 'string') return 'GT';
    let clean = name.trim();
    // Hapus gelar dan singkatan akademik umum di awal/akhir nama
    const titleRegex = /\b(Drs|Dra|Dr|Prof|Ir|H|Hj|M\.Pd|S\.Pd|M\.Si|S\.T|S\.Ag|S\.Kom|M\.M|Gr|S\.E|S\.P|M\.P)\b\.?/gi;
    let filtered = clean.replace(titleRegex, ' ');

    // Jika diawali "Tim " dan masih ada kata berikutnya (misal "Tim BK" -> "BK")
    if (/\bTim\b/i.test(filtered) && filtered.replace(/\bTim\b/gi, '').trim().length > 0) {
        filtered = filtered.replace(/\bTim\b/gi, ' ');
    }

    filtered = filtered.replace(/[^a-zA-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();

    // Jika hasil filter kosong, fallback ke karakter huruf nama asli
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

/**
 * Render Avatar/Pasfoto Guru untuk Jadwal Pelajaran
 * Menampilkan pasfoto jika ada, atau graceful fallback inisial monogram bergradien
 * Sesuai OWASP ASVS Level 2 (sanitasi URL, anti-XSS, penanganan error 404 image)
 */
export function renderTeacherScheduleAvatar(photoUrl, teacherName, size = 'sm', teacherId = '') {
    const safeName = window.escapeHTML ? window.escapeHTML(teacherName || 'Guru Pengampu') : (teacherName || 'Guru Pengampu');
    const initials = getTeacherInitials(teacherName);
    // Penanda VIP diterapkan otomatis oleh js/vip-manager.js lewat atribut ini
    const cleanId = teacherId && String(teacherId).trim() !== '-' ? String(teacherId).trim() : '';
    const vipAttr = cleanId
        ? ` data-vip-ptk-id="${window.escapeHTML ? window.escapeHTML(cleanId) : cleanId}" data-vip-size="${size === 'lg' ? '' : 'vip-avatar-sm'}"`
        : '';

    const sizeConfig = {
        xs: {
            wh: 'w-5 h-5 min-w-[20px]',
            text: 'text-[9px]'
        },
        sm: {
            wh: 'w-[22px] h-[22px] min-w-[22px]',
            text: 'text-[10px]'
        },
        md: {
            wh: 'w-7 h-7 min-w-[28px]',
            text: 'text-xs'
        },
        lg: {
            wh: 'w-11 h-11 min-w-[44px] sm:w-12 sm:h-12 sm:min-w-[48px]',
            text: 'text-sm sm:text-base'
        }
    };

    const conf = sizeConfig[size] || sizeConfig.sm;

    // Fallback: inisial monogram bergradien
    const fallbackHTML = `
        <div class="${conf.wh} rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-extrabold ${conf.text} flex items-center justify-center shrink-0 shadow-2xs select-none ring-1 ring-white/20" title="${safeName}"${vipAttr}>
            <span>${initials}</span>
        </div>
    `.trim();

    let resolved = photoUrl ? resolvePhotoUrl(photoUrl) : '';
    // Sanitasi URL OWASP: Hindari skema berbahaya
    if (resolved && !/^(https?:|\/|data:image\/)/i.test(resolved)) {
        resolved = '';
    }

    if (!resolved) {
        return fallbackHTML;
    }

    const safeUrl = window.escapeHTML ? window.escapeHTML(resolved) : resolved;

    return `
        <div class="relative ${conf.wh} shrink-0 inline-flex items-center justify-center"${vipAttr}>
            <img src="${safeUrl}" alt="${safeName}" loading="lazy"
                class="${conf.wh} rounded-full object-cover shadow-2xs ring-1 ring-slate-200/80 dark:ring-slate-700/80"
                onerror="this.onerror=null; this.classList.add('hidden'); if(this.nextElementSibling) this.nextElementSibling.classList.remove('hidden');" />
            <div class="${conf.wh} rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-extrabold ${conf.text} hidden flex items-center justify-center shrink-0 shadow-2xs select-none ring-1 ring-white/20" title="${safeName}">
                <span>${initials}</span>
            </div>
        </div>
    `.trim();
}

window.getTeacherInitials = getTeacherInitials;
window.renderTeacherScheduleAvatar = renderTeacherScheduleAvatar;


// ============== JAM PELAJARAN STANDAR ==============
const PERIOD_TIMES = [
    { jp: 1, start: '07:30', end: '08:15' },
    { jp: 2, start: '08:15', end: '09:00' },
    { jp: 3, start: '09:00', end: '09:45' },
    // Istirahat 1: 09:45 - 10:00
    { jp: 4, start: '10:00', end: '10:45' },
    { jp: 5, start: '10:45', end: '11:30' },
    { jp: 6, start: '11:30', end: '12:15' },
    // Istirahat 2: 12:15 - 12:30
    { jp: 7, start: '12:30', end: '13:15' },
    { jp: 8, start: '13:15', end: '14:00' },
    { jp: 9, start: '14:00', end: '14:45' },
    { jp: 10, start: '14:45', end: '15:30' }
];

const DAY_NAMES = {
    1: 'Senin',
    2: 'Selasa',
    3: 'Rabu',
    4: 'Kamis',
    5: 'Jumat'
};

// Palet warna mapel yang harmonis dan estetik
const MAPEL_COLORS = [
    { bg: 'bg-blue-50 dark:bg-blue-950/40', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-200 dark:border-blue-800' },
    { bg: 'bg-emerald-50 dark:bg-emerald-950/40', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-200 dark:border-emerald-800' },
    { bg: 'bg-violet-50 dark:bg-violet-950/40', text: 'text-violet-700 dark:text-violet-300', border: 'border-violet-200 dark:border-violet-800' },
    { bg: 'bg-amber-50 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-200 dark:border-amber-800' },
    { bg: 'bg-rose-50 dark:bg-rose-950/40', text: 'text-rose-700 dark:text-rose-300', border: 'border-rose-200 dark:border-rose-800' },
    { bg: 'bg-cyan-50 dark:bg-cyan-950/40', text: 'text-cyan-700 dark:text-cyan-300', border: 'border-cyan-200 dark:border-cyan-800' },
    { bg: 'bg-teal-50 dark:bg-teal-950/40', text: 'text-teal-700 dark:text-teal-300', border: 'border-teal-200 dark:border-teal-800' },
    { bg: 'bg-indigo-50 dark:bg-indigo-950/40', text: 'text-indigo-700 dark:text-indigo-300', border: 'border-indigo-200 dark:border-indigo-800' },
    { bg: 'bg-fuchsia-50 dark:bg-fuchsia-950/40', text: 'text-fuchsia-700 dark:text-fuchsia-300', border: 'border-fuchsia-200 dark:border-fuchsia-800' }
];

function getMapelColor(mapelName) {
    if (!mapelName) return { bg: 'bg-slate-50 dark:bg-slate-800/60', text: 'text-slate-400 dark:text-slate-500', border: 'border-slate-200 dark:border-slate-700' };
    const clean = mapelName.trim().toUpperCase();
    if (clean === 'UPACARA') {
        return { bg: 'bg-red-50 dark:bg-red-950/40', text: 'text-red-700 dark:text-red-300', border: 'border-red-200 dark:border-red-800' };
    }
    if (clean === 'EKSTRAKURIKULER') {
        return { bg: 'bg-green-50 dark:bg-green-950/40', text: 'text-green-700 dark:text-green-300', border: 'border-green-200 dark:border-green-800' };
    }

    let hash = 0;
    for (let i = 0; i < mapelName.length; i++) {
        hash = mapelName.charCodeAt(i) + ((hash << 5) - hash);
    }
    const idx = Math.abs(hash) % MAPEL_COLORS.length;
    return MAPEL_COLORS[idx];
}

// ============== STATUS KBM REAL-TIME (HARI & JP AKTIF) ==============
function getCurrentKBMStatus() {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0: Minggu, 1: Senin, 2: Selasa, 3: Rabu, 4: Kamis, 5: Jumat, 6: Sabtu
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const nowTotalMinutes = currentHour * 60 + currentMinute;

    let currentJP = null;
    let isBreak = false;
    let breakName = '';

    // Cek JP
    for (const period of PERIOD_TIMES) {
        const [startH, startM] = period.start.split(':').map(Number);
        const [endH, endM] = period.end.split(':').map(Number);
        const startTotal = startH * 60 + startM;
        const endTotal = endH * 60 + endM;

        if (nowTotalMinutes >= startTotal && nowTotalMinutes < endTotal) {
            currentJP = period.jp;
            break;
        }
    }

    // Cek Istirahat 1 (09:45 - 10:00 WITA)
    if (nowTotalMinutes >= (9 * 60 + 45) && nowTotalMinutes < (10 * 60)) {
        isBreak = true;
        breakName = 'Istirahat 1';
    }
    // Cek Istirahat 2 (12:15 - 12:30 WITA)
    if (nowTotalMinutes >= (12 * 60 + 15) && nowTotalMinutes < (12 * 60 + 30)) {
        isBreak = true;
        breakName = 'Istirahat 2';
    }

    return {
        dayOfWeek: (dayOfWeek >= 1 && dayOfWeek <= 5) ? dayOfWeek : null,
        currentJP,
        isBreak,
        breakName,
        isKBMActive: dayOfWeek >= 1 && dayOfWeek <= 5 && nowTotalMinutes >= (7 * 60 + 30) && nowTotalMinutes <= (15 * 60 + 30)
    };
}

// ============== STATE ==============
let currentUser = null;
let currentRole = null;
let currentMode = 'kelas'; // 'kelas' | 'guru' | 'kosong'
let currentSelectedClass = '';
let currentSelectedTeacher = '';
let mobileActiveDay = 1; // 1: Senin .. 5: Jumat
let freeTeacherSubView = 'slots'; // Default: 'slots' (Per Jam JP) | 'matrix' (Matriks Guru)
let freeTeacherSelectedDay = '1'; // 'all' | '1'..'5'
let freeTeacherSelectedJP = 'all'; // 'all' | '1'..'10'
let freeTeacherSearchQuery = '';
let availableClasses = [];
let availableTeachers = [];
let currentScheduleData = null;
let rawParsedSchedule = null;

/**
 * Inisialisasi default pintar untuk mode Jadwal Kosong Guru:
 * - Sub-view default: 'slots' (Per Jam JP)
 * - Hari efektif (Senin-Jumat): Hari ini & JP saat ini (jika sedang KBM), atau 'all' JP jika di luar jam KBM
 * - Di luar hari efektif (Sabtu/Minggu): Tampilkan semuanya ('all' hari & 'all' JP)
 */
function initFreeTeacherDefaults() {
    freeTeacherSubView = 'slots';
    const kbmStatus = getCurrentKBMStatus();
    const todayDay = new Date().getDay(); // 0: Minggu, 1: Senin, ..., 5: Jumat, 6: Sabtu

    if (todayDay >= 1 && todayDay <= 5) {
        freeTeacherSelectedDay = String(todayDay);
        if (kbmStatus.currentJP !== null) {
            freeTeacherSelectedJP = String(kbmStatus.currentJP);
        } else {
            freeTeacherSelectedJP = 'all';
        }
    } else {
        freeTeacherSelectedDay = 'all';
        freeTeacherSelectedJP = 'all';
    }
}

// ============== INIT AUTH & LAYOUT ==============
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = 'index.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
        return;
    }
    currentUser = user;
    currentRole = localStorage.getItem('user_role') || 'guru_mapel';

    const effectiveRole = window.getEffectiveRoleForPage ?
        window.getEffectiveRoleForPage('jadwal.html') : currentRole;

    initLayout(effectiveRole);
    document.querySelector('main').classList.remove('hidden');

    const loadingEl = document.getElementById('loading-indicator');
    if (loadingEl) loadingEl.classList.remove('hidden');

    // Default hari mobile sesuai hari ini jika Senin-Jumat
    const todayDay = new Date().getDay();
    if (todayDay >= 1 && todayDay <= 5) {
        mobileActiveDay = todayDay;
    }

    // Inisialisasi default pintar untuk Jadwal Kosong Guru
    initFreeTeacherDefaults();

    try {
        // Ambil data guru dan kelas (menggunakan cache terpusat XML SSOT)
        rawParsedSchedule = await parseASCSchedule();
        availableClasses = await getAllScheduleClasses();
        availableTeachers = await getAllScheduleTeachers();

        populateClassDropdown();
        setupTeacherSearchInput();

        // Smart Auto-selection sesuai role pengguna
        await handleSmartInitialSelection();

        // Render jadwal awal
        await loadAndRenderSchedule();

        // Interval untuk memperbarui indikator waktu real-time setiap 60 detik
        setInterval(() => {
            renderScheduleHeadersAndStatus();
            if (currentMode === 'kelas' && currentScheduleData) {
                renderDesktopClassMatrix(currentScheduleData);
                renderMobileClassDayView(currentScheduleData, mobileActiveDay);
            } else if (currentMode === 'guru' && currentScheduleData) {
                renderDesktopTeacherMatrix(currentScheduleData);
                renderMobileTeacherDayView(currentScheduleData, mobileActiveDay);
            } else if (currentMode === 'kosong') {
                renderFreeTeachersSchedule();
            }
        }, 60000);

    } catch (err) {
        console.error('[Jadwal] Error inisialisasi jadwal:', err);
    } finally {
        if (loadingEl) loadingEl.classList.add('hidden');
    }
});

// ============== POPULATE SELECTOR KELAS ==============
function populateClassDropdown() {
    const classSelect = document.getElementById('select-schedule-class');
    if (classSelect) {
        if (availableClasses.length === 0) {
            classSelect.innerHTML = '<option value="">Tidak ada data kelas di XML</option>';
        } else {
            classSelect.innerHTML = availableClasses.map(cls =>
                `<option value="${window.escapeHTML(cls)}">Kelas ${window.escapeHTML(cls)}</option>`
            ).join('');
        }
    }
}

// ============== SEARCHABLE COMBOBOX GURU ==============
function setupTeacherSearchInput() {
    const searchInput = document.getElementById('input-search-teacher');
    const dropdownList = document.getElementById('dropdown-teacher-list');
    const clearBtn = document.getElementById('btn-clear-teacher-search');

    if (!searchInput || !dropdownList) return;

    // Event input pencarian
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim().toLowerCase();
        if (clearBtn) {
            if (query.length > 0) clearBtn.classList.remove('hidden');
            else clearBtn.classList.add('hidden');
        }
        renderTeacherDropdownResults(query);
    });

    // Event focus input
    searchInput.addEventListener('focus', () => {
        const query = searchInput.value.trim().toLowerCase();
        renderTeacherDropdownResults(query);
    });

    // Menutup dropdown saat klik di luar area
    document.addEventListener('click', (e) => {
        const container = document.getElementById('container-select-guru');
        if (container && !container.contains(e.target)) {
            dropdownList.classList.add('hidden');
        }
    });
}

function renderTeacherDropdownResults(query = '') {
    const dropdownList = document.getElementById('dropdown-teacher-list');
    if (!dropdownList) return;

    const filtered = availableTeachers.filter(t => {
        if (!query) return true;
        const nameMatch = t.name.toLowerCase().includes(query);
        const shortMatch = t.short ? t.short.toLowerCase().includes(query) : false;
        const nipMatch = t.simasNip ? t.simasNip.toLowerCase().includes(query) : false;
        return nameMatch || shortMatch || nipMatch;
    });

    if (filtered.length === 0) {
        dropdownList.innerHTML = `
            <div class="p-4 text-center text-xs text-slate-400">
                <i class="fa-solid fa-user-xmark text-lg mb-1 block opacity-60"></i>
                Tidak ditemukan guru dengan kata kunci "${window.escapeHTML(query)}"
            </div>
        `;
        dropdownList.classList.remove('hidden');
        return;
    }

    let html = '';
    filtered.forEach(t => {
        const isSelected = t.id === currentSelectedTeacher;
        const shortBadge = t.short ? `<span class="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 rounded text-[10px] font-mono text-slate-600 dark:text-slate-300 font-bold">${window.escapeHTML(t.short)}</span>` : '';
        const nipText = t.simasNip ? `<span class="text-[10px] text-slate-400 font-mono">NIP. ${window.escapeHTML(t.simasNip)}</span>` : '';

        const avatarHtml = renderTeacherScheduleAvatar(t.foto || t.simasFoto, t.name, 'sm', t.simasId);

        html += `
            <button type="button" onclick="selectTeacherFromDropdown('${window.escapeHTML(t.id)}')"
                class="w-full text-left px-3.5 py-2.5 bg-white dark:bg-slate-800 hover:!bg-blue-50 dark:hover:!bg-blue-900/40 transition-colors flex items-center justify-between gap-3 ${isSelected ? '!bg-blue-50 dark:!bg-blue-950/60 text-blue-600 dark:text-blue-400 font-bold' : 'text-slate-700 dark:text-slate-200'}">
                <div class="flex items-center gap-2.5 min-w-0 flex-1">
                    ${avatarHtml}
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                            <span class="text-xs font-semibold truncate">${window.escapeHTML(t.name)}</span>
                            ${shortBadge}
                        </div>
                        ${nipText ? `<div class="mt-0.5">${nipText}</div>` : ''}
                    </div>
                </div>
                ${isSelected ? '<i class="fa-solid fa-check text-blue-600 text-xs shrink-0"></i>' : ''}
            </button>
        `;
    });

    dropdownList.innerHTML = html;
    dropdownList.classList.remove('hidden');
}

window.selectTeacherFromDropdown = async function (teacherId) {
    const teacher = availableTeachers.find(t => t.id === teacherId);
    if (!teacher) return;

    currentSelectedTeacher = teacherId;

    const searchInput = document.getElementById('input-search-teacher');
    const dropdownList = document.getElementById('dropdown-teacher-list');
    const clearBtn = document.getElementById('btn-clear-teacher-search');

    if (searchInput) {
        searchInput.value = teacher.name + (teacher.short ? ` (${teacher.short})` : '');
    }
    if (clearBtn) clearBtn.classList.remove('hidden');
    if (dropdownList) dropdownList.classList.add('hidden');

    await loadAndRenderSchedule();
};

window.clearTeacherSearch = function () {
    const searchInput = document.getElementById('input-search-teacher');
    const clearBtn = document.getElementById('btn-clear-teacher-search');
    if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
    }
    if (clearBtn) clearBtn.classList.add('hidden');
    renderTeacherDropdownResults('');
};

// ============== SMART AUTO-SELECTION BERDASARKAN ROLE ==============
async function handleSmartInitialSelection() {
    const cachedUserDoc = window.getCurrentUserDoc ? await window.getCurrentUserDoc().catch(() => null) : null;
    const assignedClass = localStorage.getItem('user_assigned_class') || cachedUserDoc?.assignedClass || cachedUserDoc?.kelas || '';
    const userRole = currentRole;

    // 1. Kasus Admin Kelas / Siswa / Wali Kelas (Memiliki Assigned Class) -> Otomatis lompat ke Tab Kelas & pilih kelasnya
    if (assignedClass && (userRole === 'admin_kelas' || userRole === 'siswa' || userRole === 'wali_kelas')) {
        currentMode = 'kelas';
        currentSelectedClass = assignedClass;
        const classSelect = document.getElementById('select-schedule-class');
        if (classSelect && availableClasses.includes(assignedClass)) {
            classSelect.value = assignedClass;
        } else if (availableClasses.length > 0) {
            currentSelectedClass = availableClasses[0];
        }
        applyModeUI('kelas');
        return;
    }

    // 2. Kasus Guru Mapel / Guru BK / Wali Kelas tanpa assignedClass khusus -> Otomatis lompat ke Tab Guru & pilih guru bersangkutan
    const teacherNip = cachedUserDoc?.nip || cachedUserDoc?.teacherNip || '';
    const teacherName = cachedUserDoc?.name || cachedUserDoc?.displayName || '';
    const linkedTeacherId = cachedUserDoc?.linkedTeacherId || '';

    let matchedTeacher = null;
    if (linkedTeacherId) {
        matchedTeacher = availableTeachers.find(t => t.id === linkedTeacherId || t.simasId === linkedTeacherId);
    }
    if (!matchedTeacher && teacherNip) {
        matchedTeacher = availableTeachers.find(t => t.simasNip === teacherNip || t.short === teacherNip);
    }
    if (!matchedTeacher && teacherName) {
        const cleanName = teacherName.toLowerCase().replace(/[^a-z0-9]/g, '');
        matchedTeacher = availableTeachers.find(t => {
            const tClean = t.name.toLowerCase().replace(/[^a-z0-9]/g, '');
            return tClean.includes(cleanName) || cleanName.includes(tClean);
        });
    }

    if (matchedTeacher && (userRole === 'guru_mapel' || userRole === 'guru_bk' || userRole === 'kepala_lab')) {
        currentMode = 'guru';
        currentSelectedTeacher = matchedTeacher.id;
        const searchInput = document.getElementById('input-search-teacher');
        if (searchInput) {
            searchInput.value = matchedTeacher.name + (matchedTeacher.short ? ` (${matchedTeacher.short})` : '');
        }
        applyModeUI('guru');
        return;
    }

    // 3. Default Umum (Super Admin, Wakasek Kurikulum, Kepala Sekolah, Staff) -> Tab Kelas
    currentMode = 'kelas';
    if (availableClasses.length > 0) {
        currentSelectedClass = availableClasses[0];
        const classSelect = document.getElementById('select-schedule-class');
        if (classSelect) classSelect.value = availableClasses[0];
    }
    if (availableTeachers.length > 0) {
        currentSelectedTeacher = availableTeachers[0].id;
        const searchInput = document.getElementById('input-search-teacher');
        if (searchInput) {
            searchInput.value = availableTeachers[0].name + (availableTeachers[0].short ? ` (${availableTeachers[0].short})` : '');
        }
    }
    applyModeUI('kelas');
}

// ============== SWITCH MODE (KELAS vs GURU vs KOSONG) ==============
window.switchScheduleMode = async function (mode) {
    if (currentMode === mode) return;
    currentMode = mode;
    applyModeUI(mode);
    await loadAndRenderSchedule();
};

function applyModeUI(mode) {
    const btnKelas = document.getElementById('btn-mode-kelas');
    const btnGuru = document.getElementById('btn-mode-guru');
    const btnKosong = document.getElementById('btn-mode-kosong');
    const contKelas = document.getElementById('container-select-kelas');
    const contGuru = document.getElementById('container-select-guru');
    const contKosong = document.getElementById('container-select-kosong');
    const matrixWrapper = document.getElementById('container-matrix-view');
    const kosongWrapper = document.getElementById('container-kosong-view');
    const mobileDaySelector = document.getElementById('mobile-day-selector-container');

    const activeBtnClass = 'px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 bg-blue-600 text-white shadow-sm';
    const inactiveBtnClass = 'px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-white';

    if (btnKelas) btnKelas.className = (mode === 'kelas') ? activeBtnClass : inactiveBtnClass;
    if (btnGuru) btnGuru.className = (mode === 'guru') ? activeBtnClass : inactiveBtnClass;
    if (btnKosong) btnKosong.className = (mode === 'kosong') ? activeBtnClass : inactiveBtnClass;

    if (mode === 'kelas') {
        if (contKelas) contKelas.classList.remove('hidden');
        if (contGuru) contGuru.classList.add('hidden');
        if (contKosong) contKosong.classList.add('hidden');
        if (matrixWrapper) matrixWrapper.classList.remove('hidden');
        if (kosongWrapper) kosongWrapper.classList.add('hidden');
        if (mobileDaySelector) mobileDaySelector.classList.remove('hidden');
    } else if (mode === 'guru') {
        if (contGuru) contGuru.classList.remove('hidden');
        if (contKelas) contKelas.classList.add('hidden');
        if (contKosong) contKosong.classList.add('hidden');
        if (matrixWrapper) matrixWrapper.classList.remove('hidden');
        if (kosongWrapper) kosongWrapper.classList.add('hidden');
        if (mobileDaySelector) mobileDaySelector.classList.remove('hidden');
    } else { // 'kosong'
        if (contKosong) contKosong.classList.remove('hidden');
        if (contKelas) contKelas.classList.add('hidden');
        if (contGuru) contGuru.classList.add('hidden');
        if (matrixWrapper) matrixWrapper.classList.add('hidden');
        if (kosongWrapper) kosongWrapper.classList.remove('hidden');
        if (mobileDaySelector) mobileDaySelector.classList.add('hidden');
    }
}

// ============== HANDLER PERUBAHAN PILIHAN KELAS ==============
window.handleClassSelectChange = async function () {
    const select = document.getElementById('select-schedule-class');
    if (!select) return;
    currentSelectedClass = select.value;
    await loadAndRenderSchedule();
};

// ============== LOAD & RENDER JADWAL ==============
async function loadAndRenderSchedule() {
    const statContainer = document.getElementById('schedule-stat-container');
    const printSubtitle = document.getElementById('print-subtitle');

    renderScheduleHeadersAndStatus();

    if (currentMode === 'kelas') {
        const classSelect = document.getElementById('select-schedule-class');
        const className = classSelect ? classSelect.value : currentSelectedClass;
        if (!className) return;

        currentScheduleData = await getWeeklyScheduleByClass(className);
        if (!currentScheduleData) return;

        // Render Statistik Mode Kelas
        if (statContainer) {
            statContainer.innerHTML = `
                <div class="px-3.5 py-2 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-xl flex items-center gap-2 shadow-xs">
                    <span class="text-xs font-bold text-blue-700 dark:text-blue-300">
                        <i class="fa-solid fa-graduation-cap mr-1"></i>Kelas ${window.escapeHTML(className)}
                    </span>
                    <span class="text-[10px] text-blue-600 dark:text-blue-400 font-medium hidden sm:inline">10 JP/Hari</span>
                </div>
            `;
        }

        if (printSubtitle) {
            printSubtitle.textContent = `JADWAL KELAS: ${className}`;
        }

        renderDesktopClassMatrix(currentScheduleData);
        renderMobileClassDayView(currentScheduleData, mobileActiveDay);

    } else if (currentMode === 'guru') {
        if (!currentSelectedTeacher && availableTeachers.length > 0) {
            currentSelectedTeacher = availableTeachers[0].id;
        }
        const teacherKey = currentSelectedTeacher;
        if (!teacherKey) return;

        currentScheduleData = await getWeeklyScheduleByTeacher(teacherKey);
        if (!currentScheduleData) return;

        const teacherName = currentScheduleData.teacher?.name || currentScheduleData.teacher?.simasName || 'Guru';
        const totalJP = currentScheduleData.totalJP || 0;
        const totalKelas = (currentScheduleData.classList || []).length;

        const teacherFoto = currentScheduleData.teacher?.foto || currentScheduleData.teacher?.simasFoto || '';
        const teacherNip = currentScheduleData.teacher?.simasNip || '';
        const avatarHtml = renderTeacherScheduleAvatar(teacherFoto, teacherName, 'sm', currentScheduleData.teacher?.simasId);

        // Render Statistik & Profil Mini Mode Guru
        if (statContainer) {
            statContainer.innerHTML = `
                <div class="flex items-center gap-2.5 flex-wrap">
                    <div class="flex items-center gap-2 py-1 px-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xs">
                        ${avatarHtml}
                        <div class="min-w-0">
                            <p class="text-xs font-bold text-slate-800 dark:text-white truncate max-w-[150px] sm:max-w-xs">${window.escapeHTML(teacherName)}</p>
                            ${teacherNip ? `<p class="text-[9px] text-slate-400 font-mono leading-none">NIP. ${window.escapeHTML(teacherNip)}</p>` : ''}
                        </div>
                    </div>
                    <div class="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 rounded-xl shadow-xs">
                        <span class="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                            <i class="fa-solid fa-clock mr-1"></i>Total: ${totalJP} JP
                        </span>
                    </div>
                    <div class="px-3 py-1.5 bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-800 rounded-xl shadow-xs hidden sm:block">
                        <span class="text-xs font-bold text-purple-700 dark:text-purple-300">
                            <i class="fa-solid fa-school mr-1"></i>${totalKelas} Rombel
                        </span>
                    </div>
                </div>
            `;
        }

        if (printSubtitle) {
            printSubtitle.textContent = `JADWAL MENGAJAR: ${teacherName.toUpperCase()} (TOTAL: ${totalJP} JP)`;
        }

        renderDesktopTeacherMatrix(currentScheduleData);
        renderMobileTeacherDayView(currentScheduleData, mobileActiveDay);
    } else {
        // Mode 'kosong' (Jadwal Kosong Guru)
        await renderFreeTeachersSchedule();
    }
}

// ============== RENDER HEADER & STATUS HARI INI ==============
function renderScheduleHeadersAndStatus() {
    const kbmStatus = getCurrentKBMStatus();

    for (let day = 1; day <= 5; day++) {
        const th = document.getElementById(`th-day-${day}`);
        if (!th) continue;

        if (day === kbmStatus.dayOfWeek) {
            th.className = 'p-3 text-center font-extrabold border-r border-blue-600 w-1/5 bg-blue-900 text-white shadow-inner';
            th.innerHTML = `
                <div class="flex items-center justify-center gap-1.5">
                    <span>${DAY_NAMES[day]}</span>
                    <span class="px-1.5 py-0.5 bg-emerald-500 text-white rounded text-[9px] font-bold shadow-xs tracking-wider animate-pulse">
                        Hari Ini
                    </span>
                </div>
            `;
        } else {
            th.className = 'p-3 text-center font-bold border-r border-slate-700 w-1/5 bg-slate-800 text-white';
            th.textContent = DAY_NAMES[day];
        }
    }
}

// ============== RENDER DESKTOP: MODE KELAS ==============
function renderDesktopClassMatrix(data) {
    const tbody = document.getElementById('matrix-tbody');
    if (!tbody) return;

    const kbmStatus = getCurrentKBMStatus();
    let html = '';

    PERIOD_TIMES.forEach(period => {
        const jp = period.jp;
        const isCurrentJP = jp === kbmStatus.currentJP && kbmStatus.dayOfWeek !== null;

        // Baris Istirahat 1 (antara JP 3 & 4)
        if (jp === 4) {
            const isBreak1Active = kbmStatus.isBreak && kbmStatus.breakName === 'Istirahat 1';
            html += `
                <tr class="${isBreak1Active ? 'bg-amber-100 dark:bg-amber-900/60 ring-2 ring-amber-400' : 'bg-amber-50 dark:bg-amber-950/30'} border-y border-amber-200 dark:border-amber-800">
                    <td class="p-2 text-center text-xs font-bold text-amber-700 dark:text-amber-300 border-r border-amber-200 dark:border-amber-800" colspan="6">
                        <i class="fa-solid fa-mug-hot mr-1.5"></i>Istirahat 1 (09:45 - 10:00 WITA)
                        ${isBreak1Active ? '<span class="ml-2 px-2 py-0.5 bg-amber-600 text-white text-[9px] font-bold rounded-full animate-pulse">● Sedang Berlangsung</span>' : ''}
                    </td>
                </tr>
            `;
        }

        // Baris Istirahat 2 (antara JP 6 & 7)
        if (jp === 7) {
            const isBreak2Active = kbmStatus.isBreak && kbmStatus.breakName === 'Istirahat 2';
            html += `
                <tr class="${isBreak2Active ? 'bg-amber-100 dark:bg-amber-900/60 ring-2 ring-amber-400' : 'bg-amber-50 dark:bg-amber-950/30'} border-y border-amber-200 dark:border-amber-800">
                    <td class="p-2 text-center text-xs font-bold text-amber-700 dark:text-amber-300 border-r border-amber-200 dark:border-amber-800" colspan="6">
                        <i class="fa-solid fa-utensils mr-1.5"></i>Istirahat 2 (12:15 - 12:30 WITA)
                        ${isBreak2Active ? '<span class="ml-2 px-2 py-0.5 bg-amber-600 text-white text-[9px] font-bold rounded-full animate-pulse">● Sedang Berlangsung</span>' : ''}
                    </td>
                </tr>
            `;
        }

        const rowBg = isCurrentJP ? 'bg-blue-50/40 dark:bg-blue-950/20' : '';
        html += `<tr class="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50/50 dark:hover:bg-slate-750/30 transition-colors ${rowBg}">`;

        // Kolom Waktu / JP
        const timeBg = isCurrentJP
            ? 'bg-blue-100 dark:bg-blue-900/50 border-l-4 border-l-blue-600 text-blue-800 dark:text-blue-200'
            : 'bg-slate-50/70 dark:bg-slate-800/70 text-slate-700 dark:text-slate-200';

        html += `
            <td class="p-2.5 text-center border-r border-slate-200 dark:border-slate-700 ${timeBg}">
                <div class="flex flex-col items-center">
                    <span class="font-extrabold text-xs">JP ${jp}</span>
                    <span class="block text-[10px] opacity-80 font-mono mt-0.5">${period.start}-${period.end}</span>
                    ${isCurrentJP ? `
                        <span class="mt-1 px-1.5 py-0.5 bg-amber-500 text-slate-900 rounded text-[9px] font-extrabold tracking-tight animate-pulse shadow-xs">
                            ● LIVE
                        </span>
                    ` : ''}
                </div>
            </td>
        `;

        // Kolom Hari 1 s.d. 5 (Senin - Jumat)
        for (let day = 1; day <= 5; day++) {
            const isTodayCell = day === kbmStatus.dayOfWeek;
            const isCurrentSlot = isTodayCell && isCurrentJP;

            const daySlots = (data.days && data.days[day]) || [];
            const slot = daySlots.find(s => s.jp === jp);
            const mapel = slot?.mapel || '';
            const guru = slot?.guruNama || slot?.xmlGuruName || '';

            const cellBorder = isTodayCell ? 'border-r-2 border-r-blue-300 dark:border-r-blue-700' : 'border-r border-slate-200 dark:border-slate-700';

            if (mapel) {
                const color = getMapelColor(mapel);
                const activeRing = isCurrentSlot ? 'ring-2 ring-blue-500 dark:ring-blue-400 shadow-md scale-[1.01]' : 'shadow-xs';

                html += `
                    <td class="p-1.5 ${cellBorder} align-top ${isTodayCell ? 'bg-blue-50/20 dark:bg-blue-950/10' : ''}">
                        <div class="${color.bg} ${color.border} border rounded-xl p-2.5 h-full flex flex-col justify-between ${activeRing} transition-transform hover:scale-[1.02] relative">
                            ${isCurrentSlot ? `
                                <div class="flex items-center justify-between gap-1 mb-1">
                                    <span class="px-1.5 py-0.5 bg-blue-600 text-white rounded text-[9px] font-extrabold tracking-tight shadow-xs animate-pulse flex items-center gap-1">
                                        <i class="fa-solid fa-circle-dot text-[8px] text-amber-300"></i> Saat Ini
                                    </span>
                                </div>
                            ` : ''}
                            <p class="font-bold text-xs ${color.text} leading-tight line-clamp-2" title="${window.escapeHTML(mapel)}">
                                ${window.escapeHTML(mapel)}
                            </p>
                            ${guru ? `
                                <div class="text-[10px] text-slate-500 dark:text-slate-400 mt-1.5 flex items-center gap-1.5 min-w-0" title="${window.escapeHTML(guru)}">
                                    ${renderTeacherScheduleAvatar(slot?.guruFoto, guru, 'xs', slot?.guruId)}
                                    <span class="truncate font-medium">${window.escapeHTML(guru)}</span>
                                </div>
                            ` : ''}
                        </div>
                    </td>
                `;
            } else {
                if (isCurrentSlot) {
                    html += `
                        <td class="p-1.5 ${cellBorder} align-top bg-amber-50/30 dark:bg-amber-950/20">
                            <div class="ring-2 ring-amber-400 dark:ring-amber-500 bg-amber-50 dark:bg-amber-950/50 rounded-xl p-2 text-center text-amber-700 dark:text-amber-300 font-bold text-xs">
                                <i class="fa-solid fa-clock text-[10px] mr-1"></i>Jam Kosong (Saat Ini)
                            </div>
                        </td>
                    `;
                } else {
                    html += `
                        <td class="p-2 text-center ${cellBorder} text-slate-300 dark:text-slate-600 font-bold text-xs ${isTodayCell ? 'bg-blue-50/10 dark:bg-blue-950/10' : ''}">
                            -
                        </td>
                    `;
                }
            }
        }

        html += `</tr>`;
    });

    tbody.innerHTML = html;
}

// ============== RENDER DESKTOP: MODE GURU ==============
function renderDesktopTeacherMatrix(data) {
    const tbody = document.getElementById('matrix-tbody');
    if (!tbody) return;

    const kbmStatus = getCurrentKBMStatus();
    let html = '';

    PERIOD_TIMES.forEach(period => {
        const jp = period.jp;
        const isCurrentJP = jp === kbmStatus.currentJP && kbmStatus.dayOfWeek !== null;

        // Baris Istirahat 1
        if (jp === 4) {
            const isBreak1Active = kbmStatus.isBreak && kbmStatus.breakName === 'Istirahat 1';
            html += `
                <tr class="${isBreak1Active ? 'bg-amber-100 dark:bg-amber-900/60 ring-2 ring-amber-400' : 'bg-amber-50 dark:bg-amber-950/30'} border-y border-amber-200 dark:border-amber-800">
                    <td class="p-2 text-center text-xs font-bold text-amber-700 dark:text-amber-300 border-r border-amber-200 dark:border-amber-800" colspan="6">
                        <i class="fa-solid fa-mug-hot mr-1.5"></i>Istirahat 1 (09:45 - 10:00 WITA)
                        ${isBreak1Active ? '<span class="ml-2 px-2 py-0.5 bg-amber-600 text-white text-[9px] font-bold rounded-full animate-pulse">● Sedang Berlangsung</span>' : ''}
                    </td>
                </tr>
            `;
        }

        // Baris Istirahat 2
        if (jp === 7) {
            const isBreak2Active = kbmStatus.isBreak && kbmStatus.breakName === 'Istirahat 2';
            html += `
                <tr class="${isBreak2Active ? 'bg-amber-100 dark:bg-amber-900/60 ring-2 ring-amber-400' : 'bg-amber-50 dark:bg-amber-950/30'} border-y border-amber-200 dark:border-amber-800">
                    <td class="p-2 text-center text-xs font-bold text-amber-700 dark:text-amber-300 border-r border-amber-200 dark:border-amber-800" colspan="6">
                        <i class="fa-solid fa-utensils mr-1.5"></i>Istirahat 2 (12:15 - 12:30 WITA)
                        ${isBreak2Active ? '<span class="ml-2 px-2 py-0.5 bg-amber-600 text-white text-[9px] font-bold rounded-full animate-pulse">● Sedang Berlangsung</span>' : ''}
                    </td>
                </tr>
            `;
        }

        const rowBg = isCurrentJP ? 'bg-blue-50/40 dark:bg-blue-950/20' : '';
        html += `<tr class="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50/50 dark:hover:bg-slate-750/30 transition-colors ${rowBg}">`;

        // Kolom Waktu
        const timeBg = isCurrentJP
            ? 'bg-blue-100 dark:bg-blue-900/50 border-l-4 border-l-blue-600 text-blue-800 dark:text-blue-200'
            : 'bg-slate-50/70 dark:bg-slate-800/70 text-slate-700 dark:text-slate-200';

        html += `
            <td class="p-2.5 text-center border-r border-slate-200 dark:border-slate-700 ${timeBg}">
                <div class="flex flex-col items-center">
                    <span class="font-extrabold text-xs">JP ${jp}</span>
                    <span class="block text-[10px] opacity-80 font-mono mt-0.5">${period.start}-${period.end}</span>
                    ${isCurrentJP ? `
                        <span class="mt-1 px-1.5 py-0.5 bg-amber-500 text-slate-900 rounded text-[9px] font-extrabold tracking-tight animate-pulse shadow-xs">
                            ● LIVE
                        </span>
                    ` : ''}
                </div>
            </td>
        `;

        // Kolom Hari 1 s.d. 5 (Senin - Jumat)
        for (let day = 1; day <= 5; day++) {
            const isTodayCell = day === kbmStatus.dayOfWeek;
            const isCurrentSlot = isTodayCell && isCurrentJP;

            const daySlots = (data.days && data.days[day]) || [];
            const slot = daySlots.find(s => s.jp === jp);
            const mapel = slot?.mapel || '';
            const className = slot?.className || '';

            const cellBorder = isTodayCell ? 'border-r-2 border-r-blue-300 dark:border-r-blue-700' : 'border-r border-slate-200 dark:border-slate-700';

            if (mapel) {
                const color = getMapelColor(mapel);
                const activeRing = isCurrentSlot ? 'ring-2 ring-blue-500 dark:ring-blue-400 shadow-md scale-[1.01]' : 'shadow-xs';

                html += `
                    <td class="p-1.5 ${cellBorder} align-top ${isTodayCell ? 'bg-blue-50/20 dark:bg-blue-950/10' : ''}">
                        <div class="${color.bg} ${color.border} border rounded-xl p-2.5 h-full flex flex-col justify-between ${activeRing} transition-transform hover:scale-[1.02] relative">
                            <div class="flex items-center justify-between gap-1 mb-1">
                                <span class="px-2 py-0.5 bg-blue-600 text-white rounded text-[10px] font-bold tracking-tight shadow-xs">
                                    Kelas ${window.escapeHTML(className || 'Kelas')}
                                </span>
                                ${isCurrentSlot ? `
                                    <span class="px-1.5 py-0.5 bg-emerald-600 text-white rounded text-[9px] font-extrabold tracking-tight shadow-xs animate-pulse flex items-center gap-1">
                                        <i class="fa-solid fa-circle-dot text-[8px] text-amber-300"></i> Saat Ini
                                    </span>
                                ` : ''}
                            </div>
                            <p class="font-bold text-xs ${color.text} leading-tight line-clamp-2" title="${window.escapeHTML(mapel)}">
                                ${window.escapeHTML(mapel)}
                            </p>
                        </div>
                    </td>
                `;
            } else {
                if (isCurrentSlot) {
                    html += `
                        <td class="p-1.5 ${cellBorder} align-top bg-emerald-50/20 dark:bg-emerald-950/10">
                            <div class="ring-2 ring-emerald-400 dark:ring-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl p-2 text-center text-emerald-700 dark:text-emerald-300 font-semibold text-xs">
                                <i class="fa-solid fa-mug-saucer text-[10px] mr-1"></i>Jam Bebas / Tidak Mengajar
                            </div>
                        </td>
                    `;
                } else {
                    html += `
                        <td class="p-2 text-center ${cellBorder} text-slate-300 dark:text-slate-600 font-bold text-xs ${isTodayCell ? 'bg-blue-50/10 dark:bg-blue-950/10' : ''}">
                            -
                        </td>
                    `;
                }
            }
        }

        html += `</tr>`;
    });

    tbody.innerHTML = html;
}

// ============== RENDER MOBILE VIEW (PER HARI) ==============
window.setMobileActiveDay = function (day) {
    mobileActiveDay = day;
    freeTeacherSelectedDay = day;

    // Update active tab buttons
    document.querySelectorAll('.mobile-day-btn').forEach(btn => {
        const bDay = parseInt(btn.getAttribute('data-day'));
        if (bDay === day) {
            btn.className = 'mobile-day-btn flex-1 py-1.5 text-xs font-bold rounded-lg text-center bg-blue-600 text-white shadow-sm transition-all';
        } else {
            btn.className = 'mobile-day-btn flex-1 py-1.5 text-xs font-bold rounded-lg text-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all';
        }
    });

    if (currentMode === 'kosong') {
        renderFreeTeachersSchedule();
    } else if (currentScheduleData) {
        if (currentMode === 'kelas') {
            renderMobileClassDayView(currentScheduleData, day);
        } else {
            renderMobileTeacherDayView(currentScheduleData, day);
        }
    }
};

function renderMobileClassDayView(data, day) {
    const container = document.getElementById('mobile-list-container');
    if (!container) return;

    const kbmStatus = getCurrentKBMStatus();
    const isToday = day === kbmStatus.dayOfWeek;
    const daySlots = (data.days && data.days[day]) || [];

    let html = `
        <div class="flex items-center justify-between bg-white dark:bg-slate-800 p-3 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs mb-3">
            <div class="flex items-center gap-2">
                <span class="font-extrabold text-sm text-slate-800 dark:text-white">
                    <i class="fa-solid fa-calendar-day text-blue-600 mr-1.5"></i>Hari ${DAY_NAMES[day]}
                </span>
                ${isToday ? '<span class="px-2 py-0.5 bg-emerald-500 text-white rounded-full text-[9px] font-extrabold animate-pulse">Hari Ini</span>' : ''}
            </div>
            <span class="text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/40 px-2.5 py-1 rounded-xl">
                Kelas ${window.escapeHTML(data.className || '')}
            </span>
        </div>
    `;

    PERIOD_TIMES.forEach(period => {
        const jp = period.jp;
        const isCurrentSlot = isToday && jp === kbmStatus.currentJP;

        if (jp === 4) {
            html += `
                <div class="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-2.5 text-center text-xs font-bold text-amber-700 dark:text-amber-300 my-2 shadow-xs">
                    <i class="fa-solid fa-mug-hot mr-1.5"></i>Istirahat 1 (09:45 - 10:00 WITA)
                </div>
            `;
        }
        if (jp === 7) {
            html += `
                <div class="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-2.5 text-center text-xs font-bold text-amber-700 dark:text-amber-300 my-2 shadow-xs">
                    <i class="fa-solid fa-utensils mr-1.5"></i>Istirahat 2 (12:15 - 12:30 WITA)
                </div>
            `;
        }

        const slot = daySlots.find(s => s.jp === jp);
        const mapel = slot?.mapel || '';
        const guru = slot?.guruNama || slot?.xmlGuruName || '';

        if (mapel) {
            const color = getMapelColor(mapel);
            const ring = isCurrentSlot ? 'ring-2 ring-blue-500 shadow-md' : 'shadow-xs';

            html += `
                <div class="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-3.5 ${ring} flex items-center justify-between gap-3 relative">
                    <div class="flex items-center gap-3">
                        <div class="w-11 h-11 rounded-xl ${isCurrentSlot ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-white'} flex flex-col items-center justify-center shrink-0 border border-slate-200 dark:border-slate-600 shadow-xs">
                            <span class="text-xs font-extrabold leading-none">JP ${jp}</span>
                            <span class="text-[9px] opacity-80 font-mono mt-0.5">${period.start}</span>
                        </div>
                        <div class="min-w-0">
                            ${isCurrentSlot ? `
                                <span class="inline-block px-1.5 py-0.5 bg-blue-600 text-white rounded text-[9px] font-extrabold mb-1 animate-pulse">
                                    ● Sedang Berlangsung
                                </span>
                            ` : ''}
                            <p class="font-bold text-sm ${color.text} truncate">${window.escapeHTML(mapel)}</p>
                            ${guru ? `
                                <div class="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mt-1 min-w-0" title="${window.escapeHTML(guru)}">
                                    ${renderTeacherScheduleAvatar(slot?.guruFoto, guru, 'sm', slot?.guruId)}
                                    <span class="truncate font-medium">${window.escapeHTML(guru)}</span>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
            `;
        } else {
            html += `
                <div class="bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 p-2.5 flex items-center justify-between opacity-60">
                    <div class="flex items-center gap-3">
                        <span class="text-xs font-bold text-slate-500 w-10 text-center">JP ${jp}</span>
                        <span class="text-xs text-slate-400 italic">Jam Kosong / Mandiri</span>
                    </div>
                    <span class="text-[10px] font-mono text-slate-400">${period.start}-${period.end}</span>
                </div>
            `;
        }
    });

    container.innerHTML = html;
}

function renderMobileTeacherDayView(data, day) {
    const container = document.getElementById('mobile-list-container');
    if (!container) return;

    const kbmStatus = getCurrentKBMStatus();
    const isToday = day === kbmStatus.dayOfWeek;
    const daySlots = (data.days && data.days[day]) || [];
    const teacherName = data.teacher?.name || data.teacher?.simasName || 'Guru';

    let html = `
        <div class="flex items-center justify-between bg-white dark:bg-slate-800 p-3 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs mb-3">
            <div class="flex items-center gap-2">
                <span class="font-extrabold text-sm text-slate-800 dark:text-white">
                    <i class="fa-solid fa-calendar-day text-blue-600 mr-1.5"></i>Hari ${DAY_NAMES[day]}
                </span>
                ${isToday ? '<span class="px-2 py-0.5 bg-emerald-500 text-white rounded-full text-[9px] font-extrabold animate-pulse">Hari Ini</span>' : ''}
            </div>
            <span class="text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/40 px-2.5 py-1 rounded-xl truncate max-w-[180px]">
                ${window.escapeHTML(teacherName)}
            </span>
        </div>
    `;

    PERIOD_TIMES.forEach(period => {
        const jp = period.jp;
        const isCurrentSlot = isToday && jp === kbmStatus.currentJP;

        if (jp === 4) {
            html += `
                <div class="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-2.5 text-center text-xs font-bold text-amber-700 dark:text-amber-300 my-2 shadow-xs">
                    <i class="fa-solid fa-mug-hot mr-1.5"></i>Istirahat 1 (09:45 - 10:00 WITA)
                </div>
            `;
        }
        if (jp === 7) {
            html += `
                <div class="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-2.5 text-center text-xs font-bold text-amber-700 dark:text-amber-300 my-2 shadow-xs">
                    <i class="fa-solid fa-utensils mr-1.5"></i>Istirahat 2 (12:15 - 12:30 WITA)
                </div>
            `;
        }

        const slot = daySlots.find(s => s.jp === jp);
        const mapel = slot?.mapel || '';
        const className = slot?.className || '';

        if (mapel) {
            const color = getMapelColor(mapel);
            const ring = isCurrentSlot ? 'ring-2 ring-blue-500 shadow-md' : 'shadow-xs';

            html += `
                <div class="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-3.5 ${ring} flex items-center justify-between gap-3 relative">
                    <div class="flex items-center gap-3">
                        <div class="w-11 h-11 rounded-xl ${isCurrentSlot ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-white'} flex flex-col items-center justify-center shrink-0 border border-slate-200 dark:border-slate-600 shadow-xs">
                            <span class="text-xs font-extrabold leading-none">JP ${jp}</span>
                            <span class="text-[9px] opacity-80 font-mono mt-0.5">${period.start}</span>
                        </div>
                        <div class="min-w-0">
                            <div class="flex items-center gap-1.5 mb-1">
                                <span class="px-2 py-0.5 bg-blue-600 text-white rounded text-[10px] font-bold">
                                    Kelas ${window.escapeHTML(className)}
                                </span>
                                ${isCurrentSlot ? `
                                    <span class="px-1.5 py-0.5 bg-emerald-600 text-white rounded text-[9px] font-extrabold animate-pulse">
                                        ● Mengajar Sekarang
                                    </span>
                                ` : ''}
                            </div>
                            <p class="font-bold text-sm ${color.text} truncate">${window.escapeHTML(mapel)}</p>
                        </div>
                    </div>
                </div>
            `;
        } else {
            html += `
                <div class="bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 p-2.5 flex items-center justify-between opacity-60">
                    <div class="flex items-center gap-3">
                        <span class="text-xs font-bold text-slate-500 w-10 text-center">JP ${jp}</span>
                        <span class="text-xs text-slate-400 italic">Tidak ada jam mengajar</span>
                    </div>
                    <span class="text-[10px] font-mono text-slate-400">${period.start}-${period.end}</span>
                </div>
            `;
        }
    });

    container.innerHTML = html;
}

// ============== REFRESH XML SSOT ==============
window.refreshScheduleXML = async function (force = true) {
    const btn = document.getElementById('btn-refresh-xml');
    if (btn) btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin text-xs"></i>';

    try {
        rawParsedSchedule = await parseASCSchedule(null, force);
        availableClasses = await getAllScheduleClasses();
        availableTeachers = await getAllScheduleTeachers();
        populateClassDropdown();
        await loadAndRenderSchedule();
        if (window.showToast) {
            window.showToast('Berhasil', 'Data jadwal berhasil disinkronkan.', 'success');
        }
    } catch (e) {
        console.error('[Jadwal] Gagal refresh jadwal:', e);
        if (window.showToast) {
            window.showToast('Error', 'Gagal menyinkronkan jadwal.', 'error');
        }
    } finally {
        if (btn) btn.innerHTML = '<i class="fa-solid fa-rotate text-xs"></i>';
    }
};

// =========================================================================
// ============== MODE JADWAL KOSONG GURU (GURU STANDBY) ==================
// =========================================================================

/**
 * Pengecekan kegiatan bersama seluruh sekolah:
 * - Senin JP 1 (07:30 - 08:15 WITA): Upacara Bendera
 * - Jumat JP 10 (14:45 - 15:30 WITA): Ekstrakurikuler / Krida Sekolah
 */
function getSchoolWideActivity(day, jp) {
    if (day === 1 && jp === 1) {
        return {
            type: 'UPACARA',
            title: 'Upacara Bendera',
            time: '07:30 - 08:15 WITA',
            desc: 'Kegiatan Upacara / Apel Bendera Bersama Seluruh Guru dan Siswa.'
        };
    }
    if (day === 5 && jp === 10) {
        return {
            type: 'EKSTRAKURIKULER',
            title: 'Ekstrakurikuler / Krida Sekolah',
            time: '14:45 - 15:30 WITA',
            desc: 'Kegiatan Pengembangan Diri & Ekstrakurikuler Bersama Seluruh Siswa dan Guru Pembina.'
        };
    }
    return null;
}

/**
 * Daftar JP KBM efektif per hari:
 * - Senin (d=1): JP 2 s.d. 10 (9 JP KBM, JP 1 Upacara)
 * - Selasa (d=2): JP 1 s.d. 10 (10 JP KBM)
 * - Rabu (d=3): JP 1 s.d. 10 (10 JP KBM)
 * - Kamis (d=4): JP 1 s.d. 10 (10 JP KBM)
 * - Jumat (d=5): JP 1 s.d. 9 (9 JP KBM, JP 10 Ekstrakurikuler)
 * Total KBM Mingguan = 48 JP
 */
function getEffectiveKBMJPsForDay(day) {
    const d = parseInt(day, 10) || 1;
    if (d === 1) return [2, 3, 4, 5, 6, 7, 8, 9, 10];
    if (d === 5) return [1, 2, 3, 4, 5, 6, 7, 8, 9];
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
}

/**
 * Helper internal untuk mengecek apakah seorang guru memiliki slot pelajaran pada Hari D dan JP P
 */
function getTeacherSlotAt(teacher, day, jp) {
    if (!rawParsedSchedule || !rawParsedSchedule.teacherScheduleMap || !teacher) return null;
    const tMap = rawParsedSchedule.teacherScheduleMap;

    // 1. Prioritas utama: XML ID guru (teacher.id) yang bersifat unik mutlak
    if (teacher.id && tMap[teacher.id] && tMap[teacher.id][day] && tMap[teacher.id][day][jp]) {
        return tMap[teacher.id][day][jp];
    }

    // 2. Fallback jika dicari via simasId / simasNip yang valid (bukan placeholder '-')
    const validSimasId = (teacher.simasId && teacher.simasId.trim() !== '' && teacher.simasId.trim() !== '-') ? teacher.simasId.trim() : null;
    const validNip = (teacher.simasNip && teacher.simasNip.trim() !== '' && teacher.simasNip.trim() !== '-' && teacher.simasNip.trim() !== 'null' && teacher.simasNip.trim().length >= 5) ? teacher.simasNip.trim() : null;

    const fallbackKeys = [validSimasId, validNip].filter(Boolean);
    for (const key of fallbackKeys) {
        if (tMap[key] && tMap[key][day] && tMap[key][day][jp]) {
            return tMap[key][day][jp];
        }
    }
    return null;
}

/**
 * Format array JP (misal: [2,3,5,7,8]) menjadi rentang ringkas (misal: "JP 2-3, 5, 7-8")
 */
function formatJPRanges(jpArray, totalMaxCount = 10) {
    if (!jpArray || jpArray.length === 0) return '0 JP';
    if (jpArray.length === totalMaxCount) return `Bebas KBM (${totalMaxCount} JP)`;

    const sorted = [...jpArray].sort((a, b) => a - b);
    const ranges = [];
    let start = sorted[0];
    let end = sorted[0];

    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] === end + 1) {
            end = sorted[i];
        } else {
            ranges.push(start === end ? `${start}` : `${start}-${end}`);
            start = sorted[i];
            end = sorted[i];
        }
    }
    ranges.push(start === end ? `${start}` : `${start}-${end}`);
    return `JP ${ranges.join(', ')}`;
}

/**
 * Mengambil data matriks komprehensif jam kosong seluruh guru dari Senin s.d. Jumat (Berbasis 48 JP KBM)
 */
function getAllTeachersFreeMatrix(dayFilter = 'all', searchQuery = '') {
    if (!availableTeachers || availableTeachers.length === 0) return [];

    const query = (searchQuery || '').trim().toLowerCase();
    const result = [];

    availableTeachers.forEach(t => {
        // Filter nama/NIP jika ada search query
        if (query) {
            const nameMatch = (t.name || '').toLowerCase().includes(query);
            const shortMatch = (t.short || '').toLowerCase().includes(query);
            const nipMatch = (t.simasNip || '').toLowerCase().includes(query);
            if (!nameMatch && !shortMatch && !nipMatch) return;
        }

        const daysData = {};
        let totalTeachingWeekJP = 0;

        for (let d = 1; d <= 5; d++) {
            const effectiveJPs = getEffectiveKBMJPsForDay(d);
            const freeJPs = [];
            const teachingJPs = [];
            const teachingDetails = [];

            for (const p of effectiveJPs) {
                const slot = getTeacherSlotAt(t, d, p);
                if (slot && slot.mapel && slot.mapel.trim() !== '') {
                    if (slot.mapel.toUpperCase() !== 'UPACARA' && slot.mapel.toUpperCase() !== 'EKSTRAKURIKULER') {
                        totalTeachingWeekJP++;
                    }
                    teachingJPs.push(p);
                    teachingDetails.push({
                        jp: p,
                        mapel: slot.mapel,
                        className: slot.className || (slot.classNames ? slot.classNames.join(', ') : '')
                    });
                } else {
                    freeJPs.push(p);
                }
            }

            daysData[d] = {
                day: d,
                dayName: DAY_NAMES[d],
                effectiveTotalJP: effectiveJPs.length,
                freeJPs,
                freeCount: freeJPs.length,
                teachingJPs,
                teachingCount: teachingJPs.length,
                teachingDetails,
                isFreeAllDay: freeJPs.length === effectiveJPs.length,
                isTeachingAllDay: freeJPs.length === 0,
                formattedFree: formatJPRanges(freeJPs, effectiveJPs.length),
                formattedTeaching: teachingJPs.length > 0 ? `Mengajar: ${formatJPRanges(teachingJPs, effectiveJPs.length)}` : 'Tidak mengajar'
            };
        }

        // Total basis KBM mingguan = 48 JP (Senin 9 + Selasa 10 + Rabu 10 + Kamis 10 + Jumat 9)
        const totalFreeWeekJP = Math.max(0, 48 - totalTeachingWeekJP);

        result.push({
            teacher: t,
            totalTeachingWeekJP,
            totalFreeWeekJP,
            days: daysData
        });
    });

    // Urutkan berdasarkan nama guru secara abjad
    result.sort((a, b) => a.teacher.name.localeCompare(b.teacher.name, 'id'));
    return result;
}

/**
 * Menghitung data guru-guru yang kosong/standby pada JP tertentu (Sub-View Slots)
 * Mendukung single day (1..5) maupun all days (Senin s.d. Jumat)
 */
function getFreeTeachersData(day, jpFilter = 'all', searchQuery = '') {
    if (!availableTeachers || availableTeachers.length === 0) {
        return {
            isAllDays: day === 'all',
            dayList: [],
            totalTeachers: 0,
            totalFreeSlotsCount: 0,
            avgFreePerJP: 0
        };
    }

    const isAllDays = (day === 'all');
    const daysToProcess = isAllDays ? [1, 2, 3, 4, 5] : [parseInt(day, 10) || 1];
    const query = (searchQuery || '').trim().toLowerCase();

    const teacherTeachingMap = new Map(); // teacherId -> Map(day -> array of lessons)
    const teacherTotalWeekJPMap = new Map();

    availableTeachers.forEach(t => {
        const dayMap = new Map();
        for (let d = 1; d <= 5; d++) dayMap.set(d, []);
        let totalWeek = 0;

        for (let d = 1; d <= 5; d++) {
            const effectiveJPs = getEffectiveKBMJPsForDay(d);
            for (const p of effectiveJPs) {
                const slot = getTeacherSlotAt(t, d, p);
                if (slot && slot.mapel && slot.mapel.trim() !== '') {
                    if (slot.mapel.toUpperCase() !== 'UPACARA' && slot.mapel.toUpperCase() !== 'EKSTRAKURIKULER') {
                        totalWeek++;
                    }
                    dayMap.get(d).push({
                        jp: p,
                        mapel: slot.mapel,
                        className: slot.className || (slot.classNames ? slot.classNames.join(', ') : '')
                    });
                }
            }
        }
        teacherTeachingMap.set(t.id, dayMap);
        teacherTotalWeekJPMap.set(t.id, totalWeek);
    });

    const jpsToProcess = (jpFilter === 'all' || !jpFilter)
        ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
        : [parseInt(jpFilter, 10)];

    let globalTotalFreeSlots = 0;
    let globalKbmJpCount = 0;
    const dayList = [];

    daysToProcess.forEach(dNum => {
        const jpResults = [];
        let dayFreeSlotsCount = 0;
        let dayKbmJpCount = 0;

        jpsToProcess.forEach(jp => {
            const periodTime = PERIOD_TIMES.find(pt => pt.jp === jp) || { jp, start: '', end: '' };
            const schoolActivity = getSchoolWideActivity(dNum, jp);

            if (schoolActivity) {
                jpResults.push({
                    jp,
                    period: periodTime,
                    isSchoolWideActivity: true,
                    activityInfo: schoolActivity,
                    freeTeachers: [],
                    count: 0
                });
                return;
            }

            dayKbmJpCount++;
            globalKbmJpCount++;
            const freeTeachersForJP = [];

            availableTeachers.forEach(t => {
                const dayLessons = teacherTeachingMap.get(t.id).get(dNum) || [];
                const isTeachingThisJP = dayLessons.some(l => l.jp === jp);

                if (!isTeachingThisJP) {
                    if (query) {
                        const nameMatch = (t.name || '').toLowerCase().includes(query);
                        const shortMatch = (t.short || '').toLowerCase().includes(query);
                        const nipMatch = (t.simasNip || '').toLowerCase().includes(query);
                        if (!nameMatch && !shortMatch && !nipMatch) return;
                    }

                    const totalDayJP = dayLessons.length;
                    const otherJPs = dayLessons.map(l => l.jp).sort((a, b) => a - b);
                    const totalWeekJP = teacherTotalWeekJPMap.get(t.id) || 0;

                    freeTeachersForJP.push({
                        teacher: t,
                        totalDayJP,
                        otherJPs,
                        totalWeekJP,
                        isFreeAllDay: totalDayJP === 0
                    });
                }
            });

            freeTeachersForJP.sort((a, b) => {
                if (a.isFreeAllDay !== b.isFreeAllDay) {
                    return a.isFreeAllDay ? -1 : 1;
                }
                return a.teacher.name.localeCompare(b.teacher.name, 'id');
            });

            dayFreeSlotsCount += freeTeachersForJP.length;
            globalTotalFreeSlots += freeTeachersForJP.length;

            jpResults.push({
                jp,
                period: periodTime,
                isSchoolWideActivity: false,
                activityInfo: null,
                freeTeachers: freeTeachersForJP,
                count: freeTeachersForJP.length
            });
        });

        dayList.push({
            day: dNum,
            dayName: DAY_NAMES[dNum] || 'Senin',
            jpResults,
            freeSlotsCount: dayFreeSlotsCount,
            avgFreePerJP: dayKbmJpCount > 0 ? Math.round(dayFreeSlotsCount / dayKbmJpCount) : 0
        });
    });

    return {
        isAllDays,
        dayList,
        totalTeachers: availableTeachers.length,
        totalFreeSlotsCount: globalTotalFreeSlots,
        avgFreePerJP: globalKbmJpCount > 0 ? Math.round(globalTotalFreeSlots / globalKbmJpCount) : 0
    };
}

/**
 * Memuat dan merender jadwal kosong guru
 */
async function renderFreeTeachersSchedule() {
    const statContainer = document.getElementById('schedule-stat-container');
    const printSubtitle = document.getElementById('print-subtitle');
    const container = document.getElementById('container-kosong-view');
    if (!container) return;

    if (!rawParsedSchedule) {
        rawParsedSchedule = await parseASCSchedule();
    }

    const day = freeTeacherSelectedDay;
    const jpFilter = freeTeacherSelectedJP;
    const query = freeTeacherSearchQuery;
    const kbmStatus = getCurrentKBMStatus();

    // Sinkronkan styling tombol sub-view & visibilitas filter
    const btnMatrix = document.getElementById('btn-subview-matrix');
    const btnSlots = document.getElementById('btn-subview-slots');
    const filterDayContainer = document.getElementById('container-filter-day');
    const filterJPContainer = document.getElementById('container-filter-jp');

    const activeClass = 'px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 bg-blue-600 text-white shadow-xs';
    const inactiveClass = 'px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-white';

    if (btnMatrix) btnMatrix.className = (freeTeacherSubView === 'matrix') ? activeClass : inactiveClass;
    if (btnSlots) btnSlots.className = (freeTeacherSubView === 'slots') ? activeClass : inactiveClass;

    // Filter Hari dan JP hanya muncul di sub-view Per Jam (JP), disembunyikan di Matriks Guru
    if (filterDayContainer) {
        if (freeTeacherSubView === 'slots') {
            filterDayContainer.classList.remove('hidden');
        } else {
            filterDayContainer.classList.add('hidden');
        }
    }

    if (filterJPContainer) {
        if (freeTeacherSubView === 'slots') {
            filterJPContainer.classList.remove('hidden');
        } else {
            filterJPContainer.classList.add('hidden');
        }
    }

    // Sinkronkan elemen dropdown hari & JP
    const daySelect = document.getElementById('select-free-day');
    if (daySelect && daySelect.value !== String(day)) {
        daySelect.value = String(day);
    }
    const jpSelect = document.getElementById('select-free-jp');
    if (jpSelect && jpSelect.value !== String(jpFilter)) {
        jpSelect.value = String(jpFilter);
    }

    // Toggle tombol Live JP (hanya pada mode slots saat jam KBM aktif)
    const btnLiveJP = document.getElementById('btn-jump-live-jp');
    if (btnLiveJP) {
        if (freeTeacherSubView === 'slots' && kbmStatus.isKBMActive && kbmStatus.dayOfWeek !== null && kbmStatus.currentJP !== null) {
            btnLiveJP.classList.remove('hidden');
        } else {
            btnLiveJP.classList.add('hidden');
        }
    }

    // Render Stat Container di Header
    if (statContainer) {
        const dayLabel = day === 'all' ? 'Mingguan (48 JP KBM)' : `Hari ${DAY_NAMES[day] || 'Senin'}`;
        statContainer.innerHTML = `
            <div class="flex items-center gap-2 flex-wrap">
                <div class="px-3.5 py-1.5 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 rounded-xl shadow-xs">
                    <span class="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                        <i class="fa-solid fa-calendar-week mr-1"></i>${dayLabel}
                    </span>
                </div>
                <div class="px-3 py-1.5 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-xl shadow-xs">
                    <span class="text-xs font-bold text-blue-700 dark:text-blue-300">
                        <i class="fa-solid fa-users mr-1"></i>${availableTeachers.length} Guru
                    </span>
                </div>
            </div>
        `;
    }

    if (printSubtitle) {
        printSubtitle.textContent = `PEMETAAN JADWAL KOSONG GURU - ${day === 'all' ? 'MINGGUAN (48 JP KBM)' : 'HARI ' + (DAY_NAMES[day] || '').toUpperCase()}`;
    }

    // Render Sub-View Sesuai Pilihan (Matrix Guru vs Slots Per JP)
    if (freeTeacherSubView === 'matrix') {
        const matrixData = getAllTeachersFreeMatrix(day, query);
        renderAllTeachersFreeMatrixHTML(matrixData, kbmStatus);
    } else {
        const freeData = getFreeTeachersData(day, jpFilter, query);
        renderFreeTeachersHTML(freeData, kbmStatus);
    }
}

/**
 * Merender Tabel & Kartu Matriks Jam Kosong Seluruh Guru (Sub-View Matrix)
 */
function renderAllTeachersFreeMatrixHTML(teachersList, kbmStatus) {
    const container = document.getElementById('container-kosong-view');
    if (!container) return;

    const currentDay = kbmStatus.dayOfWeek;
    const currentJP = kbmStatus.currentJP;
    const isKBMActiveNow = currentDay !== null && currentJP !== null;
    let html = '';

    if (teachersList.length === 0) {
        html += `
            <div class="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-12 text-center text-slate-400 shadow-xs">
                <i class="fa-solid fa-user-slash text-3xl mb-2 opacity-50 block"></i>
                <p class="text-sm font-semibold">Tidak ditemukan guru dengan kata kunci "${window.escapeHTML(freeTeacherSearchQuery)}"</p>
                <button type="button" onclick="clearFreeTeacherSearch()" class="mt-3 px-3.5 py-1.5 bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 text-xs font-bold rounded-xl hover:bg-blue-100 transition-colors">
                    Reset Pencarian
                </button>
            </div>
        `;
        container.innerHTML = html;
        return;
    }

    // =================== DESKTOP TABLE VIEW ===================
    html += `
        <div class="hidden md:block bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div class="overflow-x-auto">
                <table class="w-full text-xs matrix-table border-collapse text-left">
                    <thead class="bg-slate-800 text-white border-b border-slate-700">
                        <tr>
                            <th class="p-3 text-center font-bold w-12 border-r border-slate-700 shrink-0">No</th>
                            <th class="p-3 font-bold border-r border-slate-700 min-w-[200px]">Nama Guru & NIP</th>
                            <th class="p-3 text-center font-bold border-r border-slate-700 w-32 shrink-0">Beban KBM</th>
                            <th class="p-3 text-center font-bold border-r border-slate-700 w-44 ${currentDay === 1 ? 'bg-blue-900 text-white' : ''}">
                                <div>Senin (9 JP)</div>
                                <div class="text-[9px] font-normal text-slate-300">*JP 1 Upacara</div>
                                ${currentDay === 1 ? '<span class="mt-0.5 inline-block px-1.5 py-0.2 bg-emerald-500 text-white text-[9px] font-extrabold rounded-full">Hari Ini</span>' : ''}
                            </th>
                            <th class="p-3 text-center font-bold border-r border-slate-700 w-44 ${currentDay === 2 ? 'bg-blue-900 text-white' : ''}">
                                <div>Selasa (10 JP)</div>
                                ${currentDay === 2 ? '<span class="mt-0.5 inline-block px-1.5 py-0.2 bg-emerald-500 text-white text-[9px] font-extrabold rounded-full">Hari Ini</span>' : ''}
                            </th>
                            <th class="p-3 text-center font-bold border-r border-slate-700 w-44 ${currentDay === 3 ? 'bg-blue-900 text-white' : ''}">
                                <div>Rabu (10 JP)</div>
                                ${currentDay === 3 ? '<span class="mt-0.5 inline-block px-1.5 py-0.2 bg-emerald-500 text-white text-[9px] font-extrabold rounded-full">Hari Ini</span>' : ''}
                            </th>
                            <th class="p-3 text-center font-bold border-r border-slate-700 w-44 ${currentDay === 4 ? 'bg-blue-900 text-white' : ''}">
                                <div>Kamis (10 JP)</div>
                                ${currentDay === 4 ? '<span class="mt-0.5 inline-block px-1.5 py-0.2 bg-emerald-500 text-white text-[9px] font-extrabold rounded-full">Hari Ini</span>' : ''}
                            </th>
                            <th class="p-3 text-center font-bold border-r border-slate-700 w-44 ${currentDay === 5 ? 'bg-blue-900 text-white' : ''}">
                                <div>Jumat (9 JP)</div>
                                <div class="text-[9px] font-normal text-slate-300">*JP 10 Ekskul</div>
                                ${currentDay === 5 ? '<span class="mt-0.5 inline-block px-1.5 py-0.2 bg-emerald-500 text-white text-[9px] font-extrabold rounded-full">Hari Ini</span>' : ''}
                            </th>
                            <th class="p-3 text-center font-bold w-20 shrink-0 no-print">Aksi</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 dark:divide-slate-700/60">
    `;

    teachersList.forEach((item, idx) => {
        const t = item.teacher;
        const shortBadge = t.short ? `<span class="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 rounded text-[9px] font-mono text-slate-600 dark:text-slate-300 font-bold ml-1">${window.escapeHTML(t.short)}</span>` : '';
        const nipText = t.simasNip ? `<span class="text-[10px] text-slate-400 font-mono block">NIP. ${window.escapeHTML(t.simasNip)}</span>` : '';

        // Cek apakah guru ini sedang kosong pada jam KBM yang sedang berlangsung saat ini
        const todayData = item.days[currentDay];
        const isCurrentlyFreeNow = isKBMActiveNow && todayData && todayData.freeJPs.includes(currentJP);

        const rowBgClass = isCurrentlyFreeNow
            ? 'bg-emerald-50/30 dark:bg-emerald-950/20 hover:bg-emerald-100/40 dark:hover:bg-emerald-900/30 transition-colors'
            : 'hover:bg-blue-50/40 dark:hover:bg-blue-950/20 transition-colors';

        html += `
            <tr class="${rowBgClass}">
                <td class="p-3 text-center font-semibold text-slate-400 border-r border-slate-100 dark:border-slate-700/60">${idx + 1}</td>
                <td class="p-3 border-r border-slate-100 dark:border-slate-700/60">
                    <div class="flex items-start gap-2.5">
                        ${renderTeacherScheduleAvatar(t.foto || t.simasFoto, t.name, 'sm', t.simasId)}
                        <div class="min-w-0 flex-1">
                            <button type="button" onclick="selectTeacherAndSwitchMode('${window.escapeHTML(t.id)}')" class="text-left font-bold text-slate-800 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors flex items-center gap-1 flex-wrap">
                                <span class="truncate">${window.escapeHTML(t.name)}</span>
                                ${shortBadge}
                            </button>
                            ${nipText}
                            ${isCurrentlyFreeNow ? `
                                <span class="inline-flex items-center gap-1 px-2 py-0.5 mt-1 bg-emerald-100 dark:bg-emerald-900/70 border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200 text-[10px] font-extrabold rounded-md shadow-2xs animate-pulse">
                                    <i class="fa-solid fa-bolt-lightning text-amber-500"></i>Standby JP ${currentJP}
                                </span>
                            ` : ''}
                        </div>
                    </div>
                </td>
                <td class="p-2.5 text-center border-r border-slate-100 dark:border-slate-700/60">
                    <div class="flex flex-col gap-1 items-center">
                        <span class="px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/80 rounded-md text-[10px] font-bold">
                            Mengajar: ${item.totalTeachingWeekJP} JP
                        </span>
                        <span class="px-2 py-0.5 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/80 rounded-md text-[10px] font-bold">
                            Kosong: ${item.totalFreeWeekJP} JP
                        </span>
                    </div>
                </td>
        `;

        // 5 Hari (Senin - Jumat)
        for (let d = 1; d <= 5; d++) {
            const dData = item.days[d];
            const isTodayCol = d === currentDay;
            const isCellFreeNow = isTodayCol && isCurrentlyFreeNow;
            const colBg = isTodayCol ? (isCellFreeNow ? 'bg-emerald-50/40 dark:bg-emerald-950/20' : 'bg-blue-50/20 dark:bg-blue-950/10') : '';

            html += `<td class="p-2.5 border-r border-slate-100 dark:border-slate-700/60 align-top ${colBg}">`;

            if (dData.isFreeAllDay) {
                const borderHighlight = isCellFreeNow ? 'border-2 border-emerald-500 dark:border-emerald-400 ring-2 ring-emerald-400/20' : 'border border-emerald-200 dark:border-emerald-800/60';
                html += `
                    <div class="p-2 bg-emerald-50 dark:bg-emerald-950/40 ${borderHighlight} rounded-xl text-center shadow-xs">
                        ${isCellFreeNow ? `
                            <span class="text-[9px] font-extrabold text-emerald-800 dark:text-emerald-200 bg-emerald-200/80 dark:bg-emerald-900/80 px-1.5 py-0.2 rounded inline-flex items-center gap-1 mb-1 animate-pulse">
                                <i class="fa-solid fa-bolt-lightning text-amber-500 text-[8px]"></i>Standby JP ${currentJP}
                            </span>
                        ` : ''}
                        <span class="text-[10px] font-extrabold text-emerald-700 dark:text-emerald-300 block">
                            <i class="fa-solid fa-circle-check text-[9px] mr-0.5"></i>Bebas KBM
                        </span>
                        <span class="text-[9px] text-emerald-600/80 dark:text-emerald-400/80 font-medium">${dData.effectiveTotalJP} JP Kosong</span>
                    </div>
                `;
            } else if (dData.isTeachingAllDay) {
                html += `
                    <div class="p-2 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 rounded-xl text-center">
                        <span class="text-[10px] font-bold text-rose-700 dark:text-rose-300 block">Mengajar Penuh</span>
                        <span class="text-[9px] text-rose-600/80 dark:text-rose-400/80">0 JP Kosong</span>
                    </div>
                `;
            } else {
                const borderHighlight = isCellFreeNow ? 'border-2 border-emerald-500 dark:border-emerald-400 ring-2 ring-emerald-400/20 bg-emerald-50/90 dark:bg-emerald-950/80' : 'border border-slate-200/80 dark:border-slate-700 bg-slate-50 dark:bg-slate-750/60';
                html += `
                    <div class="p-2 ${borderHighlight} rounded-xl shadow-xs">
                        <div class="flex items-center justify-between gap-1 mb-1">
                            ${isCellFreeNow ? `
                                <span class="text-[9px] font-extrabold text-emerald-800 dark:text-emerald-200 bg-emerald-200/80 dark:bg-emerald-900/80 px-1.5 py-0.2 rounded flex items-center gap-1 animate-pulse">
                                    <i class="fa-solid fa-bolt-lightning text-amber-500 text-[8px]"></i>Standby JP ${currentJP}
                                </span>
                            ` : `
                                <span class="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-100/70 dark:bg-emerald-900/60 px-1.5 py-0.5 rounded">
                                    Kosong: ${dData.freeCount} JP
                                </span>
                            `}
                        </div>
                        <p class="font-mono text-[10px] font-semibold text-slate-700 dark:text-slate-200 leading-tight">
                            ${window.escapeHTML(dData.formattedFree)}
                        </p>
                        <p class="text-[9px] text-slate-400 dark:text-slate-500 mt-1 truncate" title="${window.escapeHTML(dData.formattedTeaching)}">
                            ${window.escapeHTML(dData.formattedTeaching)}
                        </p>
                    </div>
                `;
            }

            html += `</td>`;
        }

        // Aksi Button
        html += `
                <td class="p-2.5 text-center no-print">
                    <button type="button" onclick="selectTeacherAndSwitchMode('${window.escapeHTML(t.id)}')" title="Lihat Jadwal Lengkap"
                        class="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/60 text-blue-600 dark:text-blue-300 rounded-lg text-[10px] font-bold transition-all border border-blue-200 dark:border-blue-800 flex items-center justify-center gap-1 mx-auto active:scale-95">
                        <i class="fa-solid fa-calendar-day"></i>
                        <span>Detail</span>
                    </button>
                </td>
            </tr>
        `;
    });

    html += `
                    </tbody>
                </table>
            </div>
        </div>
    `;

    // =================== MOBILE LIST VIEW ===================
    html += `<div class="md:hidden space-y-3">`;

    teachersList.forEach((item, idx) => {
        const t = item.teacher;
        const shortBadge = t.short ? `<span class="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 rounded text-[9px] font-mono text-slate-600 dark:text-slate-300 font-bold ml-1">${window.escapeHTML(t.short)}</span>` : '';

        const todayData = item.days[currentDay];
        const isCurrentlyFreeNow = isKBMActiveNow && todayData && todayData.freeJPs.includes(currentJP);

        html += `
            <div class="bg-white dark:bg-slate-800 rounded-2xl ${isCurrentlyFreeNow ? 'border-2 border-emerald-500 dark:border-emerald-400 ring-2 ring-emerald-400/20' : 'border border-slate-200 dark:border-slate-700'} p-4 shadow-xs">
                <!-- Header Kartu Guru -->
                <div class="flex items-start justify-between gap-2.5 pb-3 border-b border-slate-100 dark:border-slate-700/60">
                    <div class="flex items-start gap-2.5 min-w-0 flex-1">
                        ${renderTeacherScheduleAvatar(t.foto || t.simasFoto, t.name, 'sm', t.simasId)}
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-1.5 flex-wrap">
                                <span class="text-xs font-bold text-slate-400">${idx + 1}.</span>
                                <h3 class="font-bold text-sm text-slate-800 dark:text-white truncate">${window.escapeHTML(t.name)}</h3>
                                ${shortBadge}
                                ${isCurrentlyFreeNow ? `
                                    <span class="px-2 py-0.5 bg-emerald-600 text-white rounded-full text-[9px] font-extrabold animate-pulse shadow-xs inline-flex items-center gap-1">
                                        <i class="fa-solid fa-bolt-lightning text-amber-300"></i>Standby JP ${currentJP}
                                    </span>
                                ` : ''}
                            </div>
                            ${t.simasNip ? `<p class="text-[10px] text-slate-400 font-mono mt-0.5">NIP. ${window.escapeHTML(t.simasNip)}</p>` : ''}
                        </div>
                    </div>
                    <button type="button" onclick="selectTeacherAndSwitchMode('${window.escapeHTML(t.id)}')"
                        class="px-2.5 py-1 bg-blue-600 text-white rounded-lg text-[10px] font-bold shrink-0 flex items-center gap-1">
                        <span>Jadwal</span>
                        <i class="fa-solid fa-chevron-right text-[8px]"></i>
                    </button>
                </div>

                <!-- Total Beban -->
                <div class="flex items-center gap-2 py-2 border-b border-slate-100 dark:border-slate-700/40">
                    <span class="text-[10px] font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-800">
                        Mengajar: ${item.totalTeachingWeekJP} JP
                    </span>
                    <span class="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-800">
                        Kosong: ${item.totalFreeWeekJP} JP
                    </span>
                </div>

                <!-- Daftar Jam Kosong Per Hari (Senin - Jumat) -->
                <div class="mt-3 space-y-1.5">
        `;

        for (let d = 1; d <= 5; d++) {
            const dData = item.days[d];
            const isToday = d === currentDay;
            const isRowFreeNow = isToday && isCurrentlyFreeNow;

            const rowClass = isRowFreeNow
                ? 'bg-emerald-50/80 dark:bg-emerald-950/60 border-2 border-emerald-400 dark:border-emerald-600 shadow-2xs'
                : (isToday ? 'bg-blue-50/60 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800' : 'bg-slate-50 dark:bg-slate-750/50 border border-slate-100 dark:border-slate-700/60');

            html += `
                <div class="flex items-center justify-between p-2 rounded-xl text-xs ${rowClass}">
                    <div class="flex items-center gap-1.5 w-28 shrink-0">
                        <span class="font-bold text-slate-700 dark:text-slate-300 text-[11px]">${DAY_NAMES[d]}</span>
                        <span class="text-[9px] text-slate-400">(${dData.effectiveTotalJP} JP)</span>
                        ${isToday ? '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>' : ''}
                    </div>
                    <div class="text-right min-w-0 flex-1">
            `;

            if (dData.isFreeAllDay) {
                html += `
                    <span class="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200 rounded text-[10px] font-extrabold">
                        ${isRowFreeNow ? '⚡ Standby JP ' + currentJP : 'Bebas (' + dData.effectiveTotalJP + ' JP)'}
                    </span>
                `;
            } else if (dData.isTeachingAllDay) {
                html += `<span class="px-2 py-0.5 bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300 rounded text-[10px] font-bold">Mengajar Penuh</span>`;
            } else {
                html += `
                    ${isRowFreeNow ? `
                        <span class="inline-block px-1.5 py-0.2 bg-emerald-600 text-white rounded text-[9px] font-extrabold mb-0.5">
                            ⚡ Standby JP ${currentJP}
                        </span>
                    ` : ''}
                    <span class="font-mono text-[10px] font-bold text-emerald-700 dark:text-emerald-300 block">${window.escapeHTML(dData.formattedFree)}</span>
                    <span class="text-[9px] text-slate-400 block truncate">${window.escapeHTML(dData.formattedTeaching)}</span>
                `;
            }

            html += `
                    </div>
                </div>
            `;
        }

        html += `
                </div>
            </div>
        `;
    });

    html += `</div>`;

    container.innerHTML = html;
}

/**
 * Merender representasi visual HTML untuk Mode Slots Per JP (Sub-View Slots)
 */
function renderFreeTeachersHTML(data, kbmStatus) {
    const container = document.getElementById('container-kosong-view');
    if (!container) return;

    if (!data.dayList || data.dayList.length === 0) {
        container.innerHTML = `
            <div class="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-12 text-center text-slate-400 shadow-xs">
                <i class="fa-solid fa-calendar-xmark text-3xl mb-2 opacity-50 block"></i>
                <p class="text-sm font-semibold">Tidak ada data jadwal kosong untuk ditampilkan.</p>
            </div>
        `;
        return;
    }

    let html = '';

    // Render per hari
    data.dayList.forEach(dayItem => {
        const dNum = dayItem.day;
        const dName = dayItem.dayName;
        const isDayToday = dNum === kbmStatus.dayOfWeek;

        if (data.isAllDays) {
            html += `
                <div class="pt-2 pb-1 border-b border-slate-200 dark:border-slate-700/80 flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2">
                        <span class="w-2.5 h-2.5 rounded-full bg-blue-600"></span>
                        <h3 class="font-extrabold text-sm sm:text-base text-slate-800 dark:text-white">Hari ${dName}</h3>
                        ${isDayToday ? '<span class="px-2 py-0.5 bg-emerald-500 text-white text-[9px] font-extrabold rounded-full animate-pulse">Hari Ini</span>' : ''}
                    </div>
                    <span class="text-xs font-semibold text-slate-500 dark:text-slate-400">
                        Rata-rata: <strong class="text-emerald-600 dark:text-emerald-400">${dayItem.avgFreePerJP} Guru</strong> / JP
                    </span>
                </div>
            `;
        }

        // Render list kartu per JP dalam hari ini
        dayItem.jpResults.forEach(item => {
            const jp = item.jp;
            const isCurrentSlot = isDayToday && jp === kbmStatus.currentJP;
            const periodTime = item.period || { start: '', end: '' };

            // Istirahat 1 Banner
            if (jp === 4 && (freeTeacherSelectedJP === 'all' || freeTeacherSelectedJP === '4')) {
                const isBreak1Active = isDayToday && kbmStatus.isBreak && kbmStatus.breakName === 'Istirahat 1';
                html += `
                    <div class="${isBreak1Active ? 'bg-amber-100 dark:bg-amber-900/60 ring-2 ring-amber-400' : 'bg-amber-50 dark:bg-amber-950/30'} border border-amber-200 dark:border-amber-800 rounded-2xl p-3 text-center text-xs font-bold text-amber-700 dark:text-amber-300 shadow-xs">
                        <i class="fa-solid fa-mug-hot mr-1.5"></i>Istirahat 1 (09:45 - 10:00 WITA)
                        ${isBreak1Active ? '<span class="ml-2 px-2 py-0.5 bg-amber-600 text-white text-[9px] font-bold rounded-full animate-pulse">● Sedang Berlangsung</span>' : ''}
                    </div>
                `;
            }

            // Istirahat 2 Banner
            if (jp === 7 && (freeTeacherSelectedJP === 'all' || freeTeacherSelectedJP === '7')) {
                const isBreak2Active = isDayToday && kbmStatus.isBreak && kbmStatus.breakName === 'Istirahat 2';
                html += `
                    <div class="${isBreak2Active ? 'bg-amber-100 dark:bg-amber-900/60 ring-2 ring-amber-400' : 'bg-amber-50 dark:bg-amber-950/30'} border border-amber-200 dark:border-amber-800 rounded-2xl p-3 text-center text-xs font-bold text-amber-700 dark:text-amber-300 shadow-xs">
                        <i class="fa-solid fa-utensils mr-1.5"></i>Istirahat 2 (12:15 - 12:30 WITA)
                        ${isBreak2Active ? '<span class="ml-2 px-2 py-0.5 bg-amber-600 text-white text-[9px] font-bold rounded-full animate-pulse">● Sedang Berlangsung</span>' : ''}
                    </div>
                `;
            }

            // KARTU AGENDA BERSAMA SEKOLAH (Senin JP 1 Upacara & Jumat JP 10 Ekskul)
            if (item.isSchoolWideActivity && item.activityInfo) {
                html += `
                    <div class="bg-gradient-to-r from-rose-50 via-amber-50 to-orange-50 dark:from-rose-950/40 dark:via-amber-950/30 dark:to-orange-950/30 border border-rose-200 dark:border-rose-800/80 rounded-2xl p-4 transition-all shadow-xs print-break-inside-avoid">
                        <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                            <div class="flex items-center gap-3">
                                <div class="w-10 h-10 rounded-xl bg-rose-600 text-white flex flex-col items-center justify-center shrink-0 shadow-xs">
                                    <span class="text-xs font-extrabold leading-none">JP ${jp}</span>
                                    <span class="text-[9px] opacity-80 font-mono mt-0.5">${periodTime.start}</span>
                                </div>
                                <div>
                                    <div class="flex items-center gap-2">
                                        <h3 class="font-extrabold text-sm text-slate-800 dark:text-white">${item.activityInfo.title}</h3>
                                        <span class="px-2 py-0.5 bg-rose-600 text-white rounded-full text-[9px] font-extrabold shadow-2xs">
                                            ● Agenda Bersama
                                        </span>
                                        ${isCurrentSlot ? `
                                            <span class="px-2 py-0.5 bg-emerald-600 text-white rounded-full text-[9px] font-extrabold shadow-xs animate-pulse">
                                                LIVE Saat Ini
                                            </span>
                                        ` : ''}
                                    </div>
                                    <p class="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                                        ${item.activityInfo.desc} <span class="font-mono text-[11px] text-slate-400 dark:text-slate-500">(${periodTime.start} - ${periodTime.end} WITA)</span>
                                    </p>
                                </div>
                            </div>
                            <div class="self-end sm:self-auto">
                                <span class="px-3 py-1.5 bg-white/80 dark:bg-slate-800 rounded-xl border border-rose-200 dark:border-rose-800 text-xs font-bold text-rose-700 dark:text-rose-300 shadow-2xs">
                                    <i class="fa-solid fa-users mr-1"></i>Seluruh Guru Terlibat
                                </span>
                            </div>
                        </div>
                    </div>
                `;
                return;
            }

            const cardBorder = isCurrentSlot
                ? 'border-2 border-emerald-500 dark:border-emerald-400 ring-4 ring-emerald-500/10 shadow-lg'
                : 'border border-slate-200 dark:border-slate-700 shadow-xs';

            html += `
                <div class="bg-white dark:bg-slate-800 rounded-2xl ${cardBorder} p-4 transition-all print-break-inside-avoid">
                    <!-- Header Kartu JP -->
                    <div class="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-700/60">
                        <div class="flex items-center gap-2.5">
                            <div class="w-10 h-10 rounded-xl ${isCurrentSlot ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-white'} flex flex-col items-center justify-center shrink-0 border border-slate-200 dark:border-slate-600 shadow-xs">
                                <span class="text-xs font-extrabold leading-none">JP ${jp}</span>
                                <span class="text-[9px] opacity-80 font-mono mt-0.5">${periodTime.start}</span>
                            </div>
                            <div>
                                <div class="flex items-center gap-2">
                                    <h3 class="font-extrabold text-sm text-slate-800 dark:text-white">Jam Pelajaran ${jp}</h3>
                                    ${isCurrentSlot ? `
                                        <span class="px-2 py-0.5 bg-emerald-600 text-white rounded-full text-[9px] font-extrabold shadow-xs animate-pulse flex items-center gap-1">
                                            <i class="fa-solid fa-circle-dot text-[8px] text-amber-300"></i> LIVE Saat Ini
                                        </span>
                                    ` : ''}
                                </div>
                                <p class="text-[11px] text-slate-400 dark:text-slate-500 font-mono">${periodTime.start} - ${periodTime.end} WITA</p>
                            </div>
                        </div>

                        <div class="flex items-center gap-2">
                            <span class="px-3 py-1 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/80 text-emerald-700 dark:text-emerald-300 rounded-xl text-xs font-extrabold flex items-center gap-1.5 shadow-2xs">
                                <i class="fa-solid fa-user-check text-emerald-600 dark:text-emerald-400"></i>
                                <span>${item.count} Guru Standby</span>
                            </span>
                        </div>
                    </div>

                    <!-- Grid Guru Bebas -->
                    <div class="mt-3">
            `;

            if (item.freeTeachers.length === 0) {
                html += `
                    <div class="py-6 text-center text-xs text-slate-400 dark:text-slate-500">
                        <i class="fa-solid fa-user-xmark text-xl mb-1.5 opacity-60 block"></i>
                        ${freeTeacherSearchQuery ? `Tidak ada guru kosong yang cocok dengan "${window.escapeHTML(freeTeacherSearchQuery)}"` : 'Seluruh guru terjadwal mengajar pada jam ini'}
                    </div>
                `;
            } else {
                html += `<div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">`;

                item.freeTeachers.forEach(ft => {
                    const t = ft.teacher;
                    const shortBadge = t.short ? `<span class="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 rounded text-[9px] font-mono text-slate-600 dark:text-slate-300 font-bold">${window.escapeHTML(t.short)}</span>` : '';

                    html += `
                        <button type="button" onclick="selectTeacherAndSwitchMode('${window.escapeHTML(t.id)}')" title="Klik untuk melihat jadwal lengkap ${window.escapeHTML(t.name)}"
                            class="group text-left p-2.5 rounded-xl border border-slate-200 dark:border-slate-700/80 hover:border-blue-400 dark:hover:border-blue-500 bg-slate-50/60 dark:bg-slate-750/50 hover:bg-blue-50/50 dark:hover:bg-blue-950/40 transition-all flex items-start justify-between gap-2 shadow-2xs hover:shadow-xs active:scale-[0.99]">
                            <div class="min-w-0 flex-1">
                                <div class="flex items-center gap-2 mb-1.5 min-w-0">
                                    ${renderTeacherScheduleAvatar(t.foto || t.simasFoto, t.name, 'xs', t.simasId)}
                                    <span class="font-bold text-xs text-slate-800 dark:text-slate-100 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                        ${window.escapeHTML(t.name)}
                                    </span>
                                </div>
                                <div class="flex items-center gap-1.5 flex-wrap ml-7">
                                    ${shortBadge}
                                    ${ft.isFreeAllDay ? `
                                        <span class="text-[9px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-100/70 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800/60">
                                            <i class="fa-solid fa-circle-check text-[8px] mr-0.5"></i>Bebas KBM
                                        </span>
                                    ` : `
                                        <span class="text-[9px] text-slate-500 dark:text-slate-400 bg-slate-200/60 dark:bg-slate-700/60 px-1.5 py-0.5 rounded">
                                            Mengajar: JP ${ft.otherJPs.join(',')}
                                        </span>
                                    `}
                                </div>
                            </div>
                            <i class="fa-solid fa-chevron-right text-[10px] text-slate-300 dark:text-slate-600 group-hover:text-blue-500 group-hover:translate-x-0.5 transition-all shrink-0 mt-2"></i>
                        </button>
                    `;
                });

                html += `</div>`;
            }

            html += `
                    </div>
                </div>
            `;
        });
    });

    container.innerHTML = html;
}

// ============== EVENT HANDLERS MODE JADWAL KOSONG ==============

window.switchFreeSubView = async function (subView) {
    if (freeTeacherSubView === subView) return;
    freeTeacherSubView = subView;

    const btnMatrix = document.getElementById('btn-subview-matrix');
    const btnSlots = document.getElementById('btn-subview-slots');
    const filterDayContainer = document.getElementById('container-filter-day');
    const filterJPContainer = document.getElementById('container-filter-jp');

    const activeClass = 'px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 bg-blue-600 text-white shadow-xs';
    const inactiveClass = 'px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-white';

    if (btnMatrix) btnMatrix.className = (subView === 'matrix') ? activeClass : inactiveClass;
    if (btnSlots) btnSlots.className = (subView === 'slots') ? activeClass : inactiveClass;

    if (filterDayContainer) {
        if (subView === 'slots') {
            filterDayContainer.classList.remove('hidden');
        } else {
            filterDayContainer.classList.add('hidden');
        }
    }

    if (filterJPContainer) {
        if (subView === 'slots') {
            filterJPContainer.classList.remove('hidden');
        } else {
            filterJPContainer.classList.add('hidden');
        }
    }

    await renderFreeTeachersSchedule();
};

window.handleFreeDayChange = async function () {
    const select = document.getElementById('select-free-day');
    if (!select) return;
    freeTeacherSelectedDay = select.value;
    await renderFreeTeachersSchedule();
};

window.handleFreeJPChange = async function () {
    const select = document.getElementById('select-free-jp');
    if (!select) return;
    freeTeacherSelectedJP = select.value;
    await renderFreeTeachersSchedule();
};

window.handleFreeSearchInput = function () {
    const input = document.getElementById('input-search-free-teacher');
    const clearBtn = document.getElementById('btn-clear-free-search');
    if (!input) return;

    const query = input.value.trim();
    freeTeacherSearchQuery = query;

    if (clearBtn) {
        if (query.length > 0) clearBtn.classList.remove('hidden');
        else clearBtn.classList.add('hidden');
    }

    if (currentMode === 'kosong') {
        const kbmStatus = getCurrentKBMStatus();
        if (freeTeacherSubView === 'matrix') {
            const matrixData = getAllTeachersFreeMatrix(freeTeacherSelectedDay, freeTeacherSearchQuery);
            renderAllTeachersFreeMatrixHTML(matrixData, kbmStatus);
        } else {
            const freeData = getFreeTeachersData(freeTeacherSelectedDay, freeTeacherSelectedJP, freeTeacherSearchQuery);
            renderFreeTeachersHTML(freeData, kbmStatus);
        }
    }
};

window.clearFreeTeacherSearch = function () {
    const input = document.getElementById('input-search-free-teacher');
    const clearBtn = document.getElementById('btn-clear-free-search');
    if (input) {
        input.value = '';
        input.focus();
    }
    if (clearBtn) clearBtn.classList.add('hidden');
    freeTeacherSearchQuery = '';

    if (currentMode === 'kosong') {
        const kbmStatus = getCurrentKBMStatus();
        if (freeTeacherSubView === 'matrix') {
            const matrixData = getAllTeachersFreeMatrix(freeTeacherSelectedDay, '');
            renderAllTeachersFreeMatrixHTML(matrixData, kbmStatus);
        } else {
            const freeData = getFreeTeachersData(freeTeacherSelectedDay, freeTeacherSelectedJP, '');
            renderFreeTeachersHTML(freeData, kbmStatus);
        }
    }
};

window.jumpToCurrentLiveJP = async function () {
    const kbmStatus = getCurrentKBMStatus();
    if (kbmStatus.dayOfWeek !== null && kbmStatus.dayOfWeek >= 1 && kbmStatus.dayOfWeek <= 5) {
        freeTeacherSelectedDay = String(kbmStatus.dayOfWeek);
    }
    if (kbmStatus.currentJP !== null) {
        freeTeacherSelectedJP = String(kbmStatus.currentJP);
    } else {
        freeTeacherSelectedJP = 'all';
    }

    // Alihkan ke subview slots agar langsung fokus ke kartu JP aktif
    await switchFreeSubView('slots');
};

window.selectTeacherAndSwitchMode = async function (teacherId) {
    const teacher = availableTeachers.find(t => t.id === teacherId);
    if (!teacher) return;

    currentSelectedTeacher = teacherId;

    const searchInput = document.getElementById('input-search-teacher');
    const clearBtn = document.getElementById('btn-clear-teacher-search');

    if (searchInput) {
        searchInput.value = teacher.name + (teacher.short ? ` (${teacher.short})` : '');
    }
    if (clearBtn) clearBtn.classList.remove('hidden');

    await switchScheduleMode('guru');
};




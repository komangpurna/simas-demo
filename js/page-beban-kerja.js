/**
 * js/page-beban-kerja.js
 * Halaman Portal Guru: Rencana & Realisasi Beban Kerja Mingguan
 * Sesuai Permendikdasmen No. 11/2025 & Kepmendikdasmen No. 221/P/2025
 * SSOT: Cloudflare D1 (0 Firestore Read)
 */

import './global.js';
import {
    cfGetWorkloadPolicy, cfGetWorkloadCatalog, cfSaveWorkloadCatalogItem, cfGetWorkloadAssignments,
    cfGetWorkloadTemplates, cfSaveWorkloadTemplate, cfDeleteWorkloadTemplate,
    cfInitializeWorkloadWeek, cfGetWorkloadWeek, cfSaveWorkloadPlanItems,
    cfDeleteWorkloadPlanItem, cfApplyWorkloadTemplate, cfDeduplicateWorkloadPlan, cfCleanWorkloadHolidayDrafts, cfSyncWorkloadSchedule,
    cfSyncWorkloadFromJournal,
    cfSubmitWorkloadPlan, cfSaveWorkloadStudyDay, cfReopenWorkloadPlan, cfSaveWorkloadLog, cfDeleteWorkloadLog, cfGetWorkloadMonitoringSummary,
    cfGetWorkloadMonthlyRecap,
    cfGetWakaDuties, cfSaveWakaDutyItem, cfDeleteWakaDutyItem
} from './cloudflare-client.js';
import {
    getAllScheduleTeachers, getWeeklyScheduleByTeacher, DEFAULT_JP_PERIODS,
    parseASCSchedule, normalizeTeacherName, loadCustomTeacherMapping
} from './asc-schedule-parser.js';
import {
    calculateDayTimelineSlots,
    validateWeeklyPlanCompleteness,
    detectTeacherStudyDay,
    validateTeacherStudyDayPlan,
    checkHasPkActivity,
    findTimeOverlap,
    validateNoOverlap,
    isStudyDayCompliantActivity,
    calculateDutyAllocationSummary,
    formatDurationDisplay,
    countWeekWorkHolidays,
    calculateAdjustedWeeklyTarget,
    minutesToTimeString,
    timeStringToMinutes,
    detectShiftedRealizations,
    subtractTimeRanges,
    resolveDutySummaryCollapsed,
    evaluateWeekSwipeGesture
} from './workload-calc.js';
export { resolveDutySummaryCollapsed };
export { evaluateWeekSwipeGesture };
import {
    fetchRegisteredHolidays,
    isHolidayDate,
    getHolidayDateInfo,
    isRegisteredHoliday
} from './holiday-manager.js';
import { exportWorkloadRealizationDocx } from './exportLaporanDocx.js';
import { auth, EKINERJA_APPS_SCRIPT_URL } from './config.js';
import { SCHOOL_CONFIG } from './school-config.js';
import {
    REKAP_MONTH_NAMES,
    resolveRekapReportPeriod,
    isDateInRekapPeriod,
    nextRekapWeekRange,
    buildRekapPeriodChipsHtml,
    pickRekapReportActivities,
    buildRekapInfographicHtml,
    fitRekapPreviewFrame,
    formatRekapNip,
    isGenericCaption
} from './rekap-infographic.js';
import { reorderArrayItems, setupPhotoGridDragAndDrop } from './utils-photo-dnd.mjs';
import {
    STANDARD_WORKLOAD_CATALOG,
    getCachedWorkloadCatalog,
    setCachedWorkloadCatalog,
    WAKA_TYPES,
    WAKA_MAIN_DUTIES_INFO,
    WAKA_DUTIES_INITIAL_SEED,
    getWakaTypeFromCatalogId,
    isWakaCatalogId,
    getWakaMainDutyInfo
} from './workload-catalog-data.js';
import { createWeekCache } from './workload-week-cache.mjs';

// ========== STATE ==========
let _weekStartDate = '';
let _weekData = null;      // Response dari GET /api/workload/week
const _weekCache = createWeekCache();
let _loadWeekSeq = 0;
let _weekAbortController = null;
let _weekDebounceTimer = null;
let _weekLoadError = null;
let _catalog = getCachedWorkloadCatalog(); // Activity catalog (0ms instant render & offline fallback)
let _assignments = [];      // Teacher assignments
let _templates = [];        // Weekly templates
let _policy = null;         // School work policy
let _selectedDayIndex = 0;  // 0 = Senin (day_of_week 1)
let _matrixViewMode = 'matrix'; // 'matrix' (default pekan) atau 'focus' (fokus 1 hari)
let _studyDayIndex = null;  // 0 = Senin, dst (SE Mendikdasmen No. 5684/2025: Hari Belajar Guru)
let _studyDayIsAuto = true; // true jika otomatis terdeteksi dari hari tanpa KBM
let _isSavingStudyDay = false;
const _appliedTemplateWeeks = new Set(); // Cache pelacakan penerapan template per guru & pekan (SE Mendikdasmen HBG)
let _wakaDutiesCache = null; // Cache butir tugas waka dinamis
let _wakaDutiesIsFallback = false; // true jika cache berisi seed lokal karena server gagal dihubungi
let _activeWakaPolicyTab = 'kurikulum'; // Tab aktif pengaturan waka di tab regulasi
let _activeTab = 'tab-today';
let _syncScheduleTeachers = [];
let _syncScheduleSelectedTeacherKey = null;
let _syncScheduleItems = [];
let _autoCleanedVersionId = null;
const _journalAutoSyncedDates = new Set();
const _pendingQuickReports = new Set();
let _isSavingPlanItem = false;
let _isSavingLog = false;
let _isSubmittingPlan = false;
let _isSyncingFromJournal = false;
let _isLoadingWeek = false;
let _expandedDutyCode = null; // Kode tugas pokok yang sedang di-expand di ringkasan rencana (null = tertutup)
let _dutySummaryManualCollapse = null; // null = otomatis mengikuti status versi rencana, boolean = preferensi manual pengguna
const DAY_NAMES = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];
const BREAKS = [
    { start: '09:45', end: '10:00', duration: 15 },
    { start: '12:15', end: '12:30', duration: 15 }
];

export const STANDARD_JP_PERIODS = [
    { jp: 1, label: 'JP 1', start: '07:30', end: '08:15', isBreak: false },
    { jp: 2, label: 'JP 2', start: '08:15', end: '09:00', isBreak: false },
    { jp: 3, label: 'JP 3', start: '09:00', end: '09:45', isBreak: false },
    { jp: null, label: 'Ist', start: '09:45', end: '10:00', isBreak: true },
    { jp: 4, label: 'JP 4', start: '10:00', end: '10:45', isBreak: false },
    { jp: 5, label: 'JP 5', start: '10:45', end: '11:30', isBreak: false },
    { jp: 6, label: 'JP 6', start: '11:30', end: '12:15', isBreak: false },
    { jp: null, label: 'Ist', start: '12:15', end: '12:30', isBreak: true },
    { jp: 7, label: 'JP 7', start: '12:30', end: '13:15', isBreak: false },
    { jp: 8, label: 'JP 8', start: '13:15', end: '14:00', isBreak: false },
    { jp: 9, label: 'JP 9', start: '14:00', end: '14:45', isBreak: false },
    { jp: 10, label: 'JP 10', start: '14:45', end: '15:30', isBreak: false }
];

export const MAIN_DUTIES_PERMEN_11_2025 = [
    { code: 'PELAKSANAAN_KBM', name: '1. Pelaksanaan Pembelajaran (KBM Tatap Muka)', shortName: 'Pelaksanaan Pembelajaran', mobileName: '1. Pembelajaran (KBM)', icon: 'fa-chalkboard-user' },
    { code: 'PERENCANAAN', name: '2. Perencanaan Pembelajaran (Modul Ajar, Prota, Promes, MGMP)', shortName: 'Perencanaan Pembelajaran', mobileName: '2. Perencanaan', icon: 'fa-book-open' },
    { code: 'PENILAIAN', name: '3. Penilaian Hasil Pembelajaran (Asesmen & Evaluasi)', shortName: 'Penilaian Hasil Pembelajaran', mobileName: '3. Penilaian', icon: 'fa-clipboard-check' },
    { code: 'PEMBIMBINGAN', name: '4. Pembimbingan & Pelatihan Siswa (Ekskul, BK, P5)', shortName: 'Pembimbingan & Pelatihan Siswa', mobileName: '4. Pembimbingan', icon: 'fa-user-graduate' },
    { code: 'TUGAS_TAMBAHAN', name: '5. Pelaksanaan Tugas Tambahan (Wali Kelas, Pembina, Piket, Upacara)', shortName: 'Pelaksanaan Tugas Tambahan', mobileName: '5. Tugas Tambahan', icon: 'fa-briefcase' }
];

export const DEFAULT_CATALOG_EQUIVALENT_JP = {
    'cat_kbm': 1,
    'cat_kbm_p5': 2,
    'cat_kbm_ekstra': 2,
    'cat_bimbing_guru_wali': 2,
    'cat_bimbing_p5': 2,
    'cat_ekstra': 2,
    'cat_tt_waka': 12,
    'cat_tt_waka_kurikulum': 12,
    'cat_tt_waka_kesiswaan': 12,
    'cat_tt_waka_sarpras': 12,
    'cat_tt_waka_humas': 12,
    'cat_tt_kepala_perpus': 12,
    'cat_tt_kepala_lab': 12,
    'cat_tt_gpk': 6,
    'cat_wali_kelas': 2,
    'cat_pembina_osis': 2,
    'cat_tt_koor_pkb': 2,
    'cat_piket': 1,
    'cat_tt_koor_p5': 2,
    'cat_tt_koor_inklusi': 2,
    'cat_tt_tppk': 2,
    'cat_tt_panitia_acara': 1,
    'cat_tt_organisasi_profesi': 1,
    'cat_mgmp': 1,
    'cat_tt_narasumber': 1,
    'cat_tt_peserta_pelatihan': 1,
    'cat_upacara': 1
};

export function getCatalogItemEquivalentJp(catalogItem) {
    if (!catalogItem) return 0;
    if (catalogItem.equivalent_jp != null && Number(catalogItem.equivalent_jp) > 0) {
        return Number(catalogItem.equivalent_jp);
    }
    if (catalogItem.id && DEFAULT_CATALOG_EQUIVALENT_JP[catalogItem.id]) {
        return DEFAULT_CATALOG_EQUIVALENT_JP[catalogItem.id];
    }
    return 0;
}

export function formatCatalogJpLabel(catalogItem) {
    const jp = getCatalogItemEquivalentJp(catalogItem);
    return jp > 0 ? ` (${jp} JP)` : '';
}

export function isCurrentUserWorkloadManager() {
    const directRole = (typeof localStorage !== 'undefined' ? (localStorage.getItem('user_role') || '') : '').toLowerCase().trim();
    let cachedDoc = null;
    try {
        if (typeof localStorage !== 'undefined' && auth?.currentUser?.uid) {
            cachedDoc = JSON.parse(localStorage.getItem(`simas_user_data_${auth.currentUser.uid}`) || 'null');
        }
    } catch (_) {}
    const role = (cachedDoc?.role || cachedDoc?.currentRole || directRole || '').toLowerCase().trim();
    const addRoles = Array.isArray(cachedDoc?.additionalRoles)
        ? cachedDoc.additionalRoles.map(r => String(r).toLowerCase().trim())
        : [];
    return role === 'kepala_sekolah' || role === 'super_admin' ||
           addRoles.includes('kepala_sekolah') || addRoles.includes('super_admin');
}

export function getWorkloadUserRoleInfo() {
    const directRole = (typeof localStorage !== 'undefined' ? (localStorage.getItem('user_role') || '') : '').toLowerCase().trim();
    let cachedDoc = null;
    try {
        if (typeof localStorage !== 'undefined' && auth?.currentUser?.uid) {
            cachedDoc = JSON.parse(localStorage.getItem(`simas_user_data_${auth.currentUser.uid}`) || 'null');
        }
    } catch (_) {}
    const role = (cachedDoc?.role || cachedDoc?.currentRole || directRole || '').toLowerCase().trim();
    const addRoles = Array.isArray(cachedDoc?.additionalRoles)
        ? cachedDoc.additionalRoles.map(r => String(r).toLowerCase().trim())
        : [];
    const allRoles = [role, ...addRoles];
    if (typeof window !== 'undefined' && typeof window.getAllUserRoles === 'function') {
        try {
            allRoles.push(...window.getAllUserRoles().map(r => String(r).toLowerCase().trim()));
        } catch (_) {}
    }
    const isKepalaSekolah = allRoles.includes('kepala_sekolah') ||
        (typeof window !== 'undefined' && typeof window.hasRole === 'function' && window.hasRole('kepala_sekolah'));
    const isSuperAdmin = allRoles.includes('super_admin') ||
        (typeof window !== 'undefined' && typeof window.hasRole === 'function' && window.hasRole('super_admin'));
    return { role, addRoles, allRoles, isKepalaSekolah, isSuperAdmin };
}

export function isCurrentTeacherBk() {
    const directRole = (typeof localStorage !== 'undefined' ? (localStorage.getItem('user_role') || '') : '').toLowerCase().trim();
    let cachedDoc = null;
    try {
        if (typeof localStorage !== 'undefined' && auth?.currentUser?.uid) {
            cachedDoc = JSON.parse(localStorage.getItem(`simas_user_data_${auth.currentUser.uid}`) || 'null');
        }
    } catch (_) {}

    const role = (cachedDoc?.role || cachedDoc?.currentRole || directRole || '').toLowerCase().trim();
    const addRoles = Array.isArray(cachedDoc?.additionalRoles)
        ? cachedDoc.additionalRoles.map(r => String(r).toLowerCase().trim())
        : [];
    const allRoles = [role, ...addRoles];
    if (typeof window !== 'undefined' && typeof window.getAllUserRoles === 'function') {
        try {
            allRoles.push(...window.getAllUserRoles().map(r => String(r).toLowerCase().trim()));
        } catch (_) {}
    }

    if (allRoles.includes('guru_bk') || allRoles.includes('bk') || allRoles.includes('bimbingan_konseling')) {
        return true;
    }

    const targetId = _adminSelectedTeacherId || _weekData?.week?.teacher_id || _weekData?.teacher_id || '';
    let tObj = null;
    const teacherPool = (typeof _adminTeachersCache !== 'undefined' && Array.isArray(_adminTeachersCache))
        ? _adminTeachersCache
        : (typeof window !== 'undefined' && Array.isArray(window._adminTeachersCache) ? window._adminTeachersCache : []);
    if (targetId && teacherPool.length > 0) {
        tObj = teacherPool.find(t => (t.teacher_id || t.id || t.uid) === targetId);
    }
    const tSubject = (tObj?.jenis_ptk || tObj?.mapel || tObj?.mata_pelajaran || _weekData?.week?.jenis_ptk || cachedDoc?.jenis_ptk || cachedDoc?.mata_pelajaran || cachedDoc?.subject || (typeof localStorage !== 'undefined' ? (localStorage.getItem('user_mapel') || '') : '')).toLowerCase();
    if (tSubject.includes('bk') || tSubject.includes('bimbingan') || tSubject.includes('konseling')) {
        return true;
    }

    return false;
}

export function findFirstAvailableTimeSlot(dayIndex) {
    const defaultStart = '07:30';
    if (!_weekData?.segments || _weekData.segments.length === 0) {
        return defaultStart;
    }

    const daySegments = _weekData.segments
        .filter(s => s.day_of_week === (dayIndex + 1) && s.start_time && s.end_time)
        .sort((a, b) => a.start_time.localeCompare(b.start_time));

    if (daySegments.length === 0) {
        return defaultStart;
    }

    const lastSeg = daySegments[daySegments.length - 1];
    let nextStart = lastSeg.end_time;

    if (nextStart >= '09:45' && nextStart < '10:00') {
        nextStart = '10:00';
    }
    if (nextStart >= '12:15' && nextStart < '12:30') {
        nextStart = '12:30';
    }

    if (nextStart >= '15:30') {
        return defaultStart;
    }

    return nextStart;
}

export function calculateEndTimeWithBreaks(startTime, durationMinutes) {
    if (!startTime || !startTime.includes(':')) return '';
    let [h, m] = startTime.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return '';
    let currentTotalMinutes = h * 60 + m;
    let remainingMinutes = Number(durationMinutes || 0);

    while (remainingMinutes > 0) {
        if (currentTotalMinutes >= 585 && currentTotalMinutes < 600) {
            currentTotalMinutes = 600;
        }
        if (currentTotalMinutes >= 735 && currentTotalMinutes < 750) {
            currentTotalMinutes = 750;
        }

        currentTotalMinutes++;
        remainingMinutes--;
    }

    if (currentTotalMinutes > 585 && currentTotalMinutes <= 600) {
        currentTotalMinutes = 600;
    } else if (currentTotalMinutes > 735 && currentTotalMinutes <= 750) {
        currentTotalMinutes = 750;
    }

    const endH = Math.floor(currentTotalMinutes / 60) % 24;
    const endM = currentTotalMinutes % 60;
    return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

export function applyQuickDuration(minutes, isLogModal = false) {
    const prefix = isLogModal ? 'log-input-' : 'plan-input-';
    const startEl = el(`${prefix}start`);
    const endEl = el(`${prefix}end`);
    if (!startEl || !endEl) return;

    let startTime = startEl.value;
    if (!startTime) {
        const dayIdx = isLogModal ? _selectedDayIndex : parseInt(el('plan-input-day')?.value || _selectedDayIndex || 0);
        startTime = findFirstAvailableTimeSlot(dayIdx);
        startEl.value = startTime;
    }

    const calculatedEnd = calculateEndTimeWithBreaks(startTime, minutes);
    endEl.value = calculatedEnd;

    if (!isLogModal) {
        const jpEl = el('plan-input-jp');
        if (jpEl && el('plan-teaching-wrapper')?.style?.display !== 'none') {
            if (minutes === 45) jpEl.value = '1';
            else if (minutes === 90) jpEl.value = '2';
            else if (minutes === 135) jpEl.value = '3';
        }
        updatePlannedMinutesPreview();
    } else {
        updateLogMinutesPreview();
    }
}

export function getTitleHistoryForDutyAndCatalog(dutyCode, catalogId) {
    const titlesSet = new Set();

    if (_weekData?.activities) {
        _weekData.activities.forEach(a => {
            const matchDuty = !dutyCode || a.category_code === dutyCode;
            const matchCat = !catalogId || a.catalog_id === catalogId;
            if (matchDuty && matchCat && a.title && a.title.trim()) {
                titlesSet.add(a.title.trim());
            }
        });
    }

    if (_weekData?.segments) {
        _weekData.segments.forEach(s => {
            const matchCat = !catalogId || s.catalog_id === catalogId;
            const title = s.activity_title || s.description;
            if (matchCat && title && title.trim()) {
                titlesSet.add(title.trim());
            }
        });
    }

    if (Array.isArray(_templates)) {
        _templates.forEach(t => {
            if (Array.isArray(t.items)) {
                t.items.forEach(it => {
                    const matchDuty = !dutyCode || it.category_code === dutyCode;
                    const matchCat = !catalogId || it.catalog_id === catalogId;
                    if (matchDuty && matchCat && it.title && it.title.trim()) {
                        titlesSet.add(it.title.trim());
                    }
                });
            }
        });
    }

    try {
        if (typeof localStorage !== 'undefined') {
            const raw = localStorage.getItem('simas_workload_title_history');
            if (raw) {
                const historyMap = JSON.parse(raw);
                const key = `${dutyCode || ''}_${catalogId || ''}`;
                if (Array.isArray(historyMap[key])) {
                    historyMap[key].forEach(t => {
                        if (t && typeof t === 'string' && t.trim()) titlesSet.add(t.trim());
                    });
                }
            }
        }
    } catch (_) {}

    return Array.from(titlesSet);
}

export function recordTitleToHistory(dutyCode, catalogId, title) {
    if (!title || !title.trim()) return;
    const cleanTitle = title.trim();
    try {
        if (typeof localStorage !== 'undefined') {
            const raw = localStorage.getItem('simas_workload_title_history');
            const historyMap = raw ? JSON.parse(raw) : {};
            const key = `${dutyCode || ''}_${catalogId || ''}`;
            if (!Array.isArray(historyMap[key])) {
                historyMap[key] = [];
            }
            if (!historyMap[key].includes(cleanTitle)) {
                historyMap[key].unshift(cleanTitle);
                if (historyMap[key].length > 15) historyMap[key].pop();
                localStorage.setItem('simas_workload_title_history', JSON.stringify(historyMap));
            }
        }
    } catch (_) {}
}

export function renderTitleHistorySuggestions(dutyCode, catalogId) {
    const listEl = el('plan-title-history-list');
    const containerEl = el('plan-title-suggestions-container');
    if (!listEl && !containerEl) return;

    const titles = getTitleHistoryForDutyAndCatalog(dutyCode, catalogId);

    if (listEl) {
        listEl.innerHTML = titles.map(t => `<option value="${escapeHTML(t)}"></option>`).join('');
    }

    if (containerEl) {
        if (titles.length === 0) {
            containerEl.innerHTML = '';
            containerEl.classList.add('hidden');
        } else {
            containerEl.classList.remove('hidden');
            const chipsHtml = titles.slice(0, 4).map(t => {
                const escaped = escapeHTML(t);
                const attrEscaped = escaped.replace(/"/g, '&quot;');
                return `<button type="button" onclick="window.workloadApplyQuickTitle('${attrEscaped.replace(/'/g, "\\'")}')" class="px-2.5 py-1 rounded-lg text-[11px] bg-slate-100 hover:bg-purple-100 dark:bg-slate-800 dark:hover:bg-purple-900/40 text-slate-700 hover:text-purple-700 dark:text-slate-300 dark:hover:text-purple-300 transition-colors border border-slate-200 dark:border-slate-700 flex items-center gap-1 active:scale-95 truncate max-w-xs" title="${attrEscaped}">
                    <i class="fa-solid fa-clock-rotate-left text-[10px] text-purple-500"></i>
                    <span class="truncate">${escaped}</span>
                </button>`;
            }).join('');

            containerEl.innerHTML = `
                <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Opsi Cepat Riwayat:</span>
                    ${chipsHtml}
                </div>
            `;
        }
    }
}

export function applyQuickTitle(titleText) {
    const input = el('plan-input-title');
    if (!input) return;
    input.value = titleText;
    input.dataset.autoFilled = '0';
    input.focus();
}

// ========== HELPERS ==========
function escapeHTML(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function parseTime(t) {
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
}

function calcEffective(start, end) {
    const s = parseTime(start), e = parseTime(end);
    if (e <= s) return 0;
    let brk = 0;
    for (const b of BREAKS) {
        const bs = parseTime(b.start), be = parseTime(b.end);
        const os = Math.max(s, bs), oe = Math.min(e, be);
        if (oe > os) brk += oe - os;
    }
    return Math.max(0, e - s - brk);
}

function todayWITA() {
    return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}

export function currentTimeMinutesWITA() {
    const d = new Date(Date.now() + 8 * 3600000);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/**
 * Memeriksa apakah kegiatan pada tanggal dan jam tertentu sudah boleh dilaporkan realisasinya
 * Sesuai aturan: pada hari ini (todayWITA), kegiatan baru boleh dilaporkan jika waktu saat ini
 * telah mencapai jam berakhir kegiatan dikurangi toleransi (default 10 menit).
 *
 * @param {string} activityDate - Tanggal kegiatan 'YYYY-MM-DD'
 * @param {string} endTimeStr - Jam berakhir kegiatan 'HH:mm'
 * @param {number} [toleranceMinutes=5] - Toleransi menit sebelum jam berakhir
 * @returns {{ allowed: boolean, allowedTimeStr: string, reason?: string }}
 */
export function canReportActivityNow(activityDate, endTimeStr, toleranceMinutes = 5, mockCurrentMinutes = null, mockToday = null) {
    const today = mockToday || todayWITA();
    if (!activityDate) return { allowed: true, allowedTimeStr: '' };

    if (activityDate > today) {
        return {
            allowed: false,
            allowedTimeStr: '',
            reason: `Tidak dapat melaporkan kegiatan untuk tanggal masa depan (${activityDate}).`
        };
    }

    if (activityDate < today) {
        return { allowed: true, allowedTimeStr: '' };
    }

    if (!endTimeStr || typeof endTimeStr !== 'string' || !endTimeStr.includes(':')) {
        return { allowed: true, allowedTimeStr: '' };
    }

    const endMinutes = parseTime(endTimeStr);
    const allowedMinutes = Math.max(0, endMinutes - toleranceMinutes);
    const curMinutes = (mockCurrentMinutes !== null && mockCurrentMinutes !== undefined) ? mockCurrentMinutes : currentTimeMinutesWITA();

    const allowedH = Math.floor(allowedMinutes / 60);
    const allowedM = allowedMinutes % 60;
    const allowedTimeStr = `${String(allowedH).padStart(2, '0')}:${String(allowedM).padStart(2, '0')}`;

    if (curMinutes < allowedMinutes) {
        return {
            allowed: false,
            allowedTimeStr,
            reason: `Kegiatan belum berakhir. Anda baru dapat melaporkan realisasi mulai pukul ${allowedTimeStr} WITA (toleransi 5 menit sebelum jam ${endTimeStr} WITA).`
        };
    }

    return { allowed: true, allowedTimeStr };
}

/**
 * Memeriksa apakah sinkronisasi senyap otomatis dari Jurnal Mengajar (Jalur C) boleh dipicu.
 * Ketentuan:
 * 1. Hanya aktif paling cepat pukul 15:00 WITA (900 menit) saat seluruh jam KBM selesai.
 * 2. Dibatasi maksimal 1 kali per hari kerja per guru, disimpan secara persisten di localStorage.
 *
 * @param {string} [dayDate] - Tanggal target (opsional)
 * @param {number|null} [mockCurrentMinutes=null] - Untuk pengujian unit
 * @param {string|null} [mockToday=null] - Untuk pengujian unit
 * @param {string|null} [mockTeacherId=null] - Untuk pengujian unit
 * @returns {{ allowed: boolean, storageKey: string, reason?: string }}
 */
export function canTriggerSilentJournalSync(dayDate = null, mockCurrentMinutes = null, mockToday = null, mockTeacherId = null, storageMock = null) {
    const today = mockToday || todayWITA();
    const isPastDay = Boolean(dayDate && dayDate < today);

    // 1. Verifikasi waktu kedinasan:
    // Jika mengecek hari yang sudah lampau (past day < today), KBM sudah selesai penuh, jadi bypass batas jam 15:00 WITA.
    // Jika mengecek hari ini (current day), minimal pukul 15:00 WITA (15 * 60 = 900 menit) saat jam KBM sekolah selesai.
    const currentMins = (mockCurrentMinutes !== null && mockCurrentMinutes !== undefined) ? mockCurrentMinutes : currentTimeMinutesWITA();
    if (!isPastDay && currentMins < 15 * 60) {
        return {
            allowed: false,
            storageKey: '',
            reason: 'Di bawah pukul 15:00 WITA (menunggu Jalur A dan Jalur B)'
        };
    }

    // 2. Verifikasi kuota via localStorage (1x per target date)
    const effectiveTeacherId = mockTeacherId || _weekData?.week?.teacher_id || (typeof getEffectiveTeacherId === 'function' ? getEffectiveTeacherId() : null) || 'me';
    const targetDateKey = (dayDate && dayDate < today) ? dayDate : today;
    const storageKey = `simas_wl_journal_autosync_${effectiveTeacherId}_${targetDateKey}`;

    const store = storageMock || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (store && typeof store.getItem === 'function') {
        try {
            if (store.getItem(storageKey) === '1') {
                return {
                    allowed: false,
                    storageKey,
                    reason: targetDateKey === today 
                        ? `Sudah disinkronkan hari ini untuk guru ${effectiveTeacherId}`
                        : `Sudah disinkronkan untuk tanggal ${targetDateKey} guru ${effectiveTeacherId}`
                };
            }
        } catch (e) {
            console.warn('[SilentJournalSync] Storage read error:', e);
        }
    }

    return { allowed: true, storageKey };
}

/**
 * Memeriksa apakah segmen atau aktivitas merupakan kegiatan tatap muka KBM
 * @param {Object} segOrAct 
 * @returns {boolean}
 */
export function isTeachingActivity(segOrAct) {
    if (!segOrAct) return false;
    if (segOrAct.is_teaching === 1 || segOrAct.is_teaching === true || segOrAct.is_teaching === '1') return true;
    if (segOrAct.catalog_id === 'cat_kbm' || segOrAct.category_code === 'PELAKSANAAN_KBM' || segOrAct.duty_code === 'PELAKSANAAN_KBM') return true;

    const actId = segOrAct.activity_id || segOrAct.id;
    if (actId && _weekData?.activities) {
        const act = _weekData.activities.find(a => a.id === actId);
        if (act && (act.is_teaching === 1 || act.is_teaching === true || act.is_teaching === '1' || act.catalog_id === 'cat_kbm' || act.category_code === 'PELAKSANAAN_KBM' || act.duty_code === 'PELAKSANAAN_KBM')) {
            return true;
        }
    }
    if (actId && _weekData?.segments) {
        const s = _weekData.segments.find(seg => seg.activity_id === actId);
        if (s && (s.is_teaching === 1 || s.is_teaching === true || s.is_teaching === '1' || s.catalog_id === 'cat_kbm' || s.category_code === 'PELAKSANAAN_KBM')) {
            return true;
        }
    }
    const catId = segOrAct.catalog_id;
    if (catId && _catalog) {
        const cat = _catalog.find(c => c.id === catId);
        if (cat && (cat.is_teaching === 1 || cat.is_teaching === true || cat.category_code === 'PELAKSANAAN_KBM')) {
            return true;
        }
    }
    return false;
}

function getMondayOfWeek(dateStr) {
    const d = new Date(dateStr || todayWITA());
    const day = d.getDay(); // 0=Sun
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
}

function dateOfDay(weekStart, dayIdx = 0) {
    try {
        if (!weekStart) {
            return typeof todayWITA === 'function' ? todayWITA() : new Date().toISOString().slice(0, 10);
        }
        const d = new Date(weekStart);
        if (isNaN(d.getTime())) {
            return typeof todayWITA === 'function' ? todayWITA() : new Date().toISOString().slice(0, 10);
        }
        d.setDate(d.getDate() + (Number(dayIdx) || 0));
        return d.toISOString().slice(0, 10);
    } catch (_) {
        return typeof todayWITA === 'function' ? todayWITA() : new Date().toISOString().slice(0, 10);
    }
}

function fmtDate(ds) {
    if (!ds) return '-';
    try {
        const d = new Date(ds);
        return d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return ds; }
}

export function showToast(msg, type = 'success', duration = null, customTitle = null) {
    if (typeof window.showToast === 'function') {
        let defaultDuration = 4000;
        if (type === 'error') defaultDuration = 12000;      // 12 detik agar guru leluasa membaca pesan lengkap
        else if (type === 'warning') defaultDuration = 8000; // 8 detik untuk peringatan
        const effDuration = (typeof duration === 'number' && duration > 0) ? duration : defaultDuration;
        const defaultTitle = type === 'error' ? 'Gagal Menyimpan' : (type === 'warning' ? 'Perhatian' : 'Informasi');
        const title = customTitle || defaultTitle;
        if (typeof effDuration === 'number') {
            window.showToast(title, msg, type, effDuration);
        } else {
            window.showToast(title, msg, type);
        }
    } else if (typeof window.showNotification === 'function') {
        window.showNotification(msg, type);
    } else {
        console.warn(`[Workload] [${type}] ${msg}`);
    }
}

/**
 * Format pesan kesalahan saat menyimpan rencana kerja agar ramah, jelas, solutif,
 * serta tetap transparan meneruskan galat asli dari server (SSOT & Error Parity Mandate)
 */
export function formatSavePlanErrorMessage(err) {
    const rawMsg = String(err?.message || err || '').trim();
    if (!rawMsg) {
        return 'Terjadi kendala teknis saat menyimpan rencana kerja. Silakan periksa koneksi internet Anda atau coba simpan kembali beberapa saat lagi.';
    }

    if (rawMsg.includes('Failed to fetch') || rawMsg.includes('NetworkError') || rawMsg.includes('Load failed')) {
        return 'Koneksi internet Anda terputus atau server sedang sibuk. Pastikan perangkat Anda terhubung ke internet lalu klik tombol Simpan Rencana kembali.';
    }

    if (rawMsg.includes('Data rencana telah diperbarui oleh sesi lain') || rawMsg.includes('409')) {
        return 'Data rencana kerja telah diperbarui di sesi atau perangkat lain. Halaman otomatis menyinkronkan data terbaru. Silakan periksa kembali dan simpan ulang rencana Anda.';
    }

    if (rawMsg.includes('Benturan jam kerja') || rawMsg.includes('bertumpuk') || rawMsg.includes('beririsan')) {
        return `Jadwal kegiatan bertabrakan! ${rawMsg}. Silakan sesuaikan jam mulai atau jam selesai kegiatan agar tidak tumpang tindih.`;
    }

    if (rawMsg.includes('tidak dapat diubah') || rawMsg.includes('status')) {
        return `Rencana kerja tidak dapat diubah (${rawMsg}). Rencana kerja yang sudah diajukan atau disetujui pimpinan tidak dapat disunting kembali tanpa membuka draf terlebih dahulu.`;
    }

    if (rawMsg.includes('dikunci')) {
        return `Minggu kerja telah dikunci oleh pimpinan sekolah (${rawMsg}). Anda tidak dapat menambah atau mengubah rencana kegiatan pada minggu ini.`;
    }

    if (rawMsg.includes('Akses ditolak')) {
        return `Akses ditolak: ${rawMsg}. Anda hanya memiliki wewenang untuk mengelola rencana kerja milik Anda sendiri.`;
    }

    return `Gagal menyimpan rencana kerja: ${rawMsg}. Silakan periksa kembali kelengkapan data isian Anda atau coba simpan kembali.`;
}

export function formatPlanOverlapMessage(overlapCheck, item) {
    const segConf = overlapCheck?.conflictingSegment;
    const confTitle = segConf?.activity_title || segConf?.title || 'Kegiatan Lain';
    const confStart = segConf?.start_time || '';
    const confEnd = segConf?.end_time || '';
    const timeDetail = (confStart && confEnd) ? ` (${confStart} - ${confEnd})` : '';
    return `Jadwal Bertabrakan! Waktu ${item.start_time} - ${item.end_time} bertumpuk dengan kegiatan "${confTitle}"${timeDetail}. Silakan sesuaikan jam mulai atau jam selesai kegiatan agar tidak beririsan.`;
}

async function askConfirm(message, title = 'Konfirmasi', type = 'warning', options = {}) {
    try {
        if (typeof window.showConfirmModal === 'function') {
            return (await window.showConfirmModal(message, title, type, options)) === true;
        }
    } catch (err) {
        console.error('[Workload] Gagal menampilkan konfirmasi:', err);
    }
    showToast('Konfirmasi tidak dapat ditampilkan. Silakan muat ulang halaman lalu coba kembali.', 'error');
    return false;
}

// ========== BUKTI DUKUNG & GOOGLE DRIVE HELPERS ==========
// URL Google Apps Script Web App khusus E-Kinerja (SSOT js/config.js, terpisah dari Jurnal)
const APPS_SCRIPT_URL = EKINERJA_APPS_SCRIPT_URL;

// State profil pengguna yang sedang login & cache lokal
let _currentUserProfile = null;

// State pemilihan guru oleh Super Admin & Kepala Sekolah
let _adminSelectedTeacherId = null;
let _adminSelectedTeacherName = '';
let _adminTeachersCache = [];

export function setCurrentUserProfile(profile) {
    _currentUserProfile = profile || null;
}

export function getCurrentUserProfile() {
    return _currentUserProfile;
}

export function getEffectiveTeacherId() {
    const isMgr = isCurrentUserWorkloadManager();
    if (isMgr && _adminSelectedTeacherId) {
        return _adminSelectedTeacherId;
    }
    return null;
}

export function getAdminSelectedTeacherId() {
    return _adminSelectedTeacherId;
}

// Pimpinan hanya memantau realisasi guru lain; pengisian realisasi tetap oleh guru yang bersangkutan
const MANAGER_READONLY_LOG_MSG = 'Realisasi kegiatan hanya dapat diisi oleh guru yang bersangkutan.';

export function isManagerViewingOtherTeacher() {
    return isCurrentUserWorkloadManager() && !!_adminSelectedTeacherId;
}

function applyManagerReadOnlyLogButtons() {
    if (!isManagerViewingOtherTeacher()) return false;
    ['btn-submit-workload-log', 'btn-draft-workload-log'].forEach(id => {
        const btn = el(id);
        if (!btn) return;
        btn.disabled = true;
        btn.classList.add('opacity-50', 'cursor-not-allowed');
        btn.title = MANAGER_READONLY_LOG_MSG;
    });
    return true;
}

export function setAdminSelectedTeacher(teacherId, teacherName = '') {
    _adminSelectedTeacherId = teacherId || null;
    _adminSelectedTeacherName = teacherName || '';
}

export function getTeacherInitials(name = '') {
    if (!name) return 'G';
    const clean = name.replace(/^(Drs\.|Dr\.|H\.|Hj\.|Ir\.|Prof\.)\s*/i, '').trim();
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'G';
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function highlightTeacherMatch(text = '', query = '') {
    if (!query || !text) return escapeHTML(text);
    const escapedText = escapeHTML(text);
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedQuery})`, 'gi');
    return escapedText.replace(regex, '<mark class="bg-amber-200 dark:bg-amber-900/80 text-slate-900 dark:text-amber-100 rounded-xs px-0.5 font-bold">$1</mark>');
}

export function renderAdminTeacherDropdownResults(query = '') {
    const dropdown = el('admin-teacher-search-results');
    if (!dropdown) return;

    const list = _adminTeachersCache || [];
    const q = (query || '').toLowerCase().trim();

    if (list.length === 0) {
        dropdown.innerHTML = '<div class="p-4 text-center text-xs text-slate-400 dark:text-slate-500"><i class="fa-solid fa-spinner fa-spin mr-1.5"></i>Memuat daftar guru...</div>';
        return;
    }

    const filtered = q
        ? list.filter(t => {
            const name = (t.teacher_name || t.name || t.nama || '').toLowerCase();
            const id = (t.teacher_id || t.id || '').toLowerCase();
            const duty = (t.jenis_ptk || t.mapel || '').toLowerCase();
            const nip = (t.nip || '').toLowerCase();
            return name.includes(q) || id.includes(q) || duty.includes(q) || nip.includes(q);
        })
        : list;

    let itemsHtml = `
        <div class="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-800 flex items-center justify-between sticky top-0 backdrop-blur-xs z-10 border-b border-slate-100 dark:border-slate-700/60">
            <span>Daftar Guru (${filtered.length})</span>
            ${q ? `<span class="text-indigo-600 dark:text-indigo-400 font-semibold lowercase">filter: "${escapeHTML(q)}"</span>` : ''}
        </div>
    `;

    // Opsi reset/kosongkan guru: tampilkan jika query kosong atau user mencari opsi kosong/reset/pilih
    const shouldShowResetOption = !q || q.includes('kosong') || q.includes('reset') || q.includes('pilih');
    if (shouldShowResetOption) {
        const isNoneSelected = !_adminSelectedTeacherId;
        itemsHtml += `
            <div role="option"
                aria-selected="${isNoneSelected}"
                tabindex="0"
                onclick="window.workloadSelectAdminTeacher('')"
                class="admin-teacher-option p-2.5 px-3 flex items-center justify-between gap-2.5 hover:bg-slate-100 dark:hover:bg-slate-700/60 cursor-pointer transition-colors ${isNoneSelected ? 'bg-slate-100/70 dark:bg-slate-700/50 font-bold text-slate-800 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'}">
                <div class="flex items-center gap-2.5 min-w-0">
                    <div class="w-7 h-7 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 flex items-center justify-center text-xs shrink-0">
                        <i class="fa-solid fa-ban"></i>
                    </div>
                    <div class="truncate text-xs">-- Pilih Guru Terlebih Dahulu (Kosongkan) --</div>
                </div>
                ${isNoneSelected ? '<i class="fa-solid fa-check text-slate-500 text-xs shrink-0"></i>' : ''}
            </div>
        `;
    }

    if (filtered.length === 0) {
        itemsHtml += `
            <div class="p-5 text-center text-xs text-slate-400 dark:text-slate-500">
                <i class="fa-solid fa-user-slash text-slate-300 dark:text-slate-600 text-xl mb-1.5 block"></i>
                Tidak ada guru ditemukan dengan kata kunci "<strong>${escapeHTML(query)}</strong>"
            </div>
        `;
    } else {
        filtered.forEach(t => {
            const id = t.teacher_id || t.id;
            const name = t.teacher_name || t.name || t.nama || id;
            const duty = t.jenis_ptk || t.mapel || '';
            const isSelected = (_adminSelectedTeacherId === id);
            const initials = getTeacherInitials(name);
            const rawPhoto = t.foto || t.photo_url || '';
            const photoUrl = (typeof window.resolvePhotoUrl === 'function') ? window.resolvePhotoUrl(rawPhoto) : rawPhoto;

            itemsHtml += `
                <div role="option"
                    aria-selected="${isSelected}"
                    tabindex="0"
                    data-teacher-id="${escapeHTML(id)}"
                    data-teacher-name="${escapeHTML(name)}"
                    onclick="window.workloadSelectAdminTeacher('${escapeHTML(id)}')"
                    class="admin-teacher-option p-2.5 px-3 flex items-center justify-between gap-2.5 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 cursor-pointer transition-colors ${isSelected ? 'bg-indigo-50/80 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-200' : 'text-slate-700 dark:text-slate-200'}">
                    <div class="flex items-center gap-2.5 min-w-0">
                        <div class="w-7 h-7 rounded-lg ${isSelected ? 'bg-indigo-600 text-white' : 'bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'} flex items-center justify-center text-[10px] font-bold shrink-0 border border-indigo-200/50 dark:border-indigo-800/50 overflow-hidden">
                            ${photoUrl ? `<img src="${escapeHTML(photoUrl)}" class="w-full h-full object-cover" onerror="this.parentElement.textContent='${escapeHTML(initials)}'">` : initials}
                        </div>
                        <div class="min-w-0">
                            <div class="text-xs font-semibold ${isSelected ? 'text-indigo-700 dark:text-indigo-300 font-bold' : 'text-slate-800 dark:text-slate-100'} truncate">
                                ${highlightTeacherMatch(name, q)}
                            </div>
                            ${duty ? `<div class="text-[10px] text-slate-400 dark:text-slate-500 truncate">${escapeHTML(duty)}</div>` : ''}
                        </div>
                    </div>
                    ${isSelected ? '<i class="fa-solid fa-circle-check text-indigo-600 dark:text-indigo-400 text-xs shrink-0"></i>' : ''}
                </div>
            `;
        });
    }

    dropdown.innerHTML = itemsHtml;
}

export function openAdminTeacherDropdown(e) {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    const dropdown = el('admin-teacher-search-results');
    const input = el('input-admin-teacher-search');
    const chevron = el('icon-admin-teacher-chevron');
    const strip = el('admin-teacher-selector-strip');
    if (!dropdown) return;

    dropdown.classList.remove('hidden');
    if (input) input.setAttribute('aria-expanded', 'true');
    if (chevron) chevron.classList.add('rotate-180');
    if (strip) {
        strip.classList.add('z-40');
        strip.style.zIndex = '40';
    }

    // Jika teks di input cocok dengan guru terpilih, tampilkan semua guru agar user bisa memilih guru lain
    const query = input?.value || '';
    const isExactMatchSelected = _adminSelectedTeacherName && query.trim() === _adminSelectedTeacherName.trim();
    renderAdminTeacherDropdownResults(isExactMatchSelected ? '' : query);
}

export function closeAdminTeacherDropdown() {
    const dropdown = el('admin-teacher-search-results');
    const input = el('input-admin-teacher-search');
    const chevron = el('icon-admin-teacher-chevron');
    const strip = el('admin-teacher-selector-strip');
    if (!dropdown) return;

    dropdown.classList.add('hidden');
    if (input) input.setAttribute('aria-expanded', 'false');
    if (chevron) chevron.classList.remove('rotate-180');
    if (strip) {
        strip.classList.remove('z-40');
        strip.style.zIndex = '';
    }

    // Sinkronkan kembali teks input dengan guru yang sedang terpilih
    if (input) {
        if (_adminSelectedTeacherId && _adminSelectedTeacherName) {
            input.value = _adminSelectedTeacherName;
        } else if (!_adminSelectedTeacherId) {
            input.value = '';
        }
    }
}

export function toggleAdminTeacherDropdown(e) {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    const dropdown = el('admin-teacher-search-results');
    if (!dropdown) return;
    if (dropdown.classList.contains('hidden')) {
        openAdminTeacherDropdown(e);
        el('input-admin-teacher-search')?.focus();
    } else {
        closeAdminTeacherDropdown();
    }
}

export function filterAdminTeacherDropdown(query) {
    const dropdown = el('admin-teacher-search-results');
    if (dropdown && dropdown.classList.contains('hidden')) {
        openAdminTeacherDropdown();
    }
    const clearBtn = el('btn-admin-clear-teacher');
    if (clearBtn) {
        if ((query || '').trim().length > 0 || _adminSelectedTeacherId) {
            clearBtn.classList.remove('hidden');
        } else {
            clearBtn.classList.add('hidden');
        }
    }
    renderAdminTeacherDropdownResults(query);
}

export async function selectAdminTeacher(teacherId) {
    const input = el('input-admin-teacher-search');
    const clearBtn = el('btn-admin-clear-teacher');

    closeAdminTeacherDropdown();

    if (!teacherId) {
        if (input) input.value = '';
        if (clearBtn) clearBtn.classList.add('hidden');
        await onAdminTeacherChange('');
        return;
    }

    const teacherObj = (_adminTeachersCache || []).find(t => (t.teacher_id || t.id) === teacherId);
    const tName = teacherObj ? (teacherObj.teacher_name || teacherObj.name || teacherObj.nama) : teacherId;
    if (input) input.value = tName;
    if (clearBtn) clearBtn.classList.remove('hidden');

    await onAdminTeacherChange(teacherId);
}

export function onAdminTeacherKeydown(e) {
    const dropdown = el('admin-teacher-search-results');
    if (!dropdown) return;

    if (e.key === 'Escape') {
        closeAdminTeacherDropdown();
        return;
    }

    if (dropdown.classList.contains('hidden')) {
        if (e.key === 'ArrowDown' || e.key === 'Enter') {
            openAdminTeacherDropdown(e);
            return;
        }
    }

    const options = Array.from(dropdown.querySelectorAll('.admin-teacher-option'));
    if (!options.length) return;

    const focusedIdx = options.findIndex(opt => opt === document.activeElement);

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIdx = (focusedIdx + 1) % options.length;
        options[nextIdx].focus();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prevIdx = focusedIdx <= 0 ? options.length - 1 : focusedIdx - 1;
        options[prevIdx].focus();
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (focusedIdx >= 0) {
            options[focusedIdx].click();
        } else if (options.length === 2) {
            options[1].click();
        }
    }
}

export function populateAdminTeacherDropdown(teachers = []) {
    if (Array.isArray(teachers) && teachers.length > 0) {
        _adminTeachersCache = teachers;
    }
    const select = el('select-workload-teacher');
    const input = el('input-admin-teacher-search');
    const clearBtn = el('btn-admin-clear-teacher');

    const currentVal = _adminSelectedTeacherId || select?.value;
    const list = _adminTeachersCache || [];

    if (select) {
        let html = '<option value="">-- Pilih Guru Terlebih Dahulu --</option>';
        list.forEach(t => {
            const id = t.teacher_id || t.id;
            const name = t.teacher_name || t.name || t.nama || id;
            const duty = t.jenis_ptk || t.mapel || '';
            const dutyText = duty ? ` (${duty})` : '';
            html += `<option value="${escapeHTML(id)}">${escapeHTML(name)}${escapeHTML(dutyText)}</option>`;
        });
        select.innerHTML = html;
        if (currentVal && list.some(t => (t.teacher_id || t.id) === currentVal)) {
            select.value = currentVal;
        }
    }

    if (input) {
        if (currentVal) {
            const teacherObj = list.find(t => (t.teacher_id || t.id) === currentVal);
            const tName = teacherObj ? (teacherObj.teacher_name || teacherObj.name || teacherObj.nama) : currentVal;
            input.value = tName;
            if (clearBtn) clearBtn.classList.remove('hidden');
        } else {
            input.value = '';
            if (clearBtn) clearBtn.classList.add('hidden');
        }
    }

    renderAdminTeacherDropdownResults('');
}

export async function onAdminTeacherChange(teacherId) {
    _adminSelectedTeacherId = teacherId || null;
    const select = el('select-workload-teacher');
    const input = el('input-admin-teacher-search');
    const clearBtn = el('btn-admin-clear-teacher');
    const labelEl = el('label-selected-teacher-name');
    const dutyBadge = el('badge-admin-teacher-duty');

    if (_adminSelectedTeacherId) {
        const teacherObj = (_adminTeachersCache || []).find(t => (t.teacher_id || t.id) === _adminSelectedTeacherId);
        const tName = teacherObj ? (teacherObj.teacher_name || teacherObj.name || teacherObj.nama) : (select?.options[select?.selectedIndex]?.text?.split(' (')[0] || _adminSelectedTeacherId);
        const tDuty = teacherObj?.jenis_ptk || teacherObj?.mapel || '';
        _adminSelectedTeacherName = tName;

        if (labelEl) labelEl.textContent = tName;
        if (dutyBadge) {
            if (tDuty) {
                dutyBadge.textContent = tDuty;
                dutyBadge.classList.remove('hidden');
            } else {
                dutyBadge.classList.add('hidden');
            }
        }
        if (clearBtn) clearBtn.classList.remove('hidden');
        if (select) select.value = _adminSelectedTeacherId;
        if (input) input.value = tName;

        _weekCache.clear();
        if (typeof window.monitoringClearCache === 'function') window.monitoringClearCache();
        _autoCleanedVersionId = null;
        _dutySummaryManualCollapse = null;

        try {
            _assignments = await cfGetWorkloadAssignments(_adminSelectedTeacherId);
        } catch (_) {}
        await loadWeek();
    } else {
        _adminSelectedTeacherName = '';
        _weekCache.clear();
        if (typeof window.monitoringClearCache === 'function') window.monitoringClearCache();
        _autoCleanedVersionId = null;
        _dutySummaryManualCollapse = null;
        if (labelEl) labelEl.textContent = 'Pilih guru untuk melihat dan mengelola rencana serta realisasi';
        if (dutyBadge) dutyBadge.classList.add('hidden');
        if (clearBtn) clearBtn.classList.add('hidden');
        if (select) select.value = '';
        if (input) input.value = '';
        _weekData = null;
        renderAll();
    }

    renderAdminTeacherDropdownResults('');
}

export async function adminResetTeacher(e) {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    const input = el('input-admin-teacher-search');
    if (input) input.value = '';
    closeAdminTeacherDropdown();
    await onAdminTeacherChange('');
    showToast('Pilihan guru direset. Silakan pilih guru untuk mengelola kinerjanya.', 'info');
}

export async function adminManageTeacher(teacherId) {
    if (!teacherId) return;
    const select = el('select-workload-teacher');
    const input = el('input-admin-teacher-search');
    if (select) select.value = teacherId;
    await onAdminTeacherChange(teacherId);
    if (input && _adminSelectedTeacherName) {
        input.value = _adminSelectedTeacherName;
    }
    switchTab('tab-today');
    showToast(`Mengelola Kinerja Guru: ${_adminSelectedTeacherName || teacherId}`, 'info');
}

if (typeof document !== 'undefined') {
    document.addEventListener('click', (e) => {
        const container = el('container-admin-teacher-search');
        if (container && !container.contains(e.target)) {
            closeAdminTeacherDropdown();
        }
    });
}

if (typeof window !== 'undefined') {
    window.workloadPopulateAdminTeacherDropdown = populateAdminTeacherDropdown;
    window.workloadOnAdminTeacherChange = onAdminTeacherChange;
    window.workloadAdminManageTeacher = adminManageTeacher;
    window.workloadAdminResetTeacher = adminResetTeacher;
    window.workloadOpenAdminTeacherDropdown = openAdminTeacherDropdown;
    window.workloadCloseAdminTeacherDropdown = closeAdminTeacherDropdown;
    window.workloadToggleAdminTeacherDropdown = toggleAdminTeacherDropdown;
    window.workloadFilterAdminTeacherDropdown = filterAdminTeacherDropdown;
    window.workloadSelectAdminTeacher = selectAdminTeacher;
    window.workloadOnAdminTeacherKeydown = onAdminTeacherKeydown;
    window.workloadGetEffectiveTeacherId = getEffectiveTeacherId;
    window.workloadGetAdminSelectedTeacherId = getAdminSelectedTeacherId;
    window.workloadSetAdminSelectedTeacher = setAdminSelectedTeacher;
}

export function getCurrentTeacherDisplayName() {
    try {
        if (_adminSelectedTeacherId && _adminSelectedTeacherName) return _adminSelectedTeacherName;
        if (_currentUserProfile?.displayName) return _currentUserProfile.displayName;
        if (_currentUserProfile?.name) return _currentUserProfile.name;
        if (_currentUserProfile?.nama) return _currentUserProfile.nama;
        if (_weekData?.week?.teacher_name) return _weekData.week.teacher_name;
        if (_weekData?.teacher_name) return _weekData.teacher_name;
        if (typeof localStorage !== 'undefined' && auth?.currentUser?.uid) {
            const uid = auth.currentUser.uid;
            const cachedName = localStorage.getItem(`cached_user_name_${uid}`);
            if (cachedName) return cachedName;
            const cachedDoc = JSON.parse(localStorage.getItem(`simas_userdoc_${uid}`) || 'null');
            if (cachedDoc?.name) return cachedDoc.name;
            if (cachedDoc?.nama) return cachedDoc.nama;
            if (cachedDoc?.displayName) return cachedDoc.displayName;
            const cached = JSON.parse(localStorage.getItem(`simas_user_data_${uid}`) || 'null');
            if (cached?.name) return cached.name;
            if (cached?.nama) return cached.nama;
            if (cached?.displayName) return cached.displayName;
        }
        if (auth?.currentUser?.displayName) return auth.currentUser.displayName;
    } catch (_) {}
    return 'Guru';
}

// Batas maksimal foto bukti dukung per kegiatan
export const MAX_WORKLOAD_PHOTOS = 5;

// State daftar foto bukti pada modal laporan aktif (maksimal 5 foto)
let _currentLogPhotos = [];
let _photoUploadSeq = 0;

// State Lightbox Galeri Foto Bukti
let _lightboxPhotos = [];
let _lightboxIndex = 0;

export function sanitizeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const trimmed = url.trim();
    if (!trimmed) return '';
    try {
        let validUrlStr = trimmed;
        if (/^\/\//.test(validUrlStr)) {
            validUrlStr = 'https:' + validUrlStr;
        } else if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//i.test(validUrlStr)) {
            validUrlStr = 'https://' + validUrlStr;
        }
        const parsed = new URL(validUrlStr);
        if (['http:', 'https:'].includes(parsed.protocol)) {
            return parsed.href;
        }
    } catch (_) {}
    return '';
}

export function extractGoogleDriveFileId(url) {
    if (!url || typeof url !== 'string') return '';
    const trimmed = url.trim();
    const match = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
                  trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
                  trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : '';
}

export function getGoogleDriveThumbnail(url) {
    if (!url || typeof url !== 'string') return '';
    const trimmed = url.trim();
    const fileId = extractGoogleDriveFileId(trimmed);
    if (fileId) {
        return `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}`;
    }
    // Jika tautan gambar langsung
    if (/\.(jpeg|jpg|png|webp|gif|svg)($|\?)/i.test(trimmed)) {
        return trimmed;
    }
    return '';
}

/**
 * Parsing multi-foto dari nilai evidence_url database D1
 * Mendukung JSON string array [{ url, fileId, name, caption }] maupun single URL string legacy
 * @param {string|Array} raw
 * @returns {Array<{ url: string, fileId?: string, name?: string, caption?: string }>}
 */
export function parseEvidencePhotos(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) {
        return raw.map((item, idx) => {
            if (typeof item === 'string') {
                return { url: item, fileId: extractGoogleDriveFileId(item), name: `Foto Bukti ${idx + 1}`, caption: '' };
            }
            if (item && item.url) {
                return {
                    url: item.url,
                    fileId: item.fileId || extractGoogleDriveFileId(item.url),
                    name: item.name || `Foto Bukti ${idx + 1}`,
                    caption: (item.caption || '').trim()
                };
            }
            return null;
        }).filter(Boolean);
    }
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) return [];
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed)) {
                    return parsed.map((item, idx) => {
                        if (typeof item === 'string') {
                            return { url: item, fileId: extractGoogleDriveFileId(item), name: `Foto Bukti ${idx + 1}`, caption: '' };
                        }
                        if (item && item.url) {
                            return {
                                url: item.url,
                                fileId: item.fileId || extractGoogleDriveFileId(item.url),
                                name: item.name || `Foto Bukti ${idx + 1}`,
                                caption: (item.caption || '').trim()
                            };
                        }
                        return null;
                    }).filter(Boolean);
                }
            } catch (_) {}
        }
        // Legacy single URL string fallback
        const safe = sanitizeUrl(trimmed);
        if (safe) {
            return [{ url: safe, fileId: extractGoogleDriveFileId(safe), name: 'Foto Bukti', caption: '' }];
        }
    }
    return [];
}

/**
 * Kompresi gambar client-side via HTML5 Canvas (JPEG adaptif 60% s.d. 10%, batas ~80KB, dimensi maks 800px)
 * Sistem kompresi ini setara dengan modul Jurnal Mengajar untuk menghemat bandwidth & storage Google Drive.
 * @param {File} file
 * @param {number} maxDimension - Default 800px (sisi terpanjang)
 * @param {number} quality - Default 0.6 (60%)
 * @param {number} maxBytes - Default ~80 KB (80 * 1024)
 * @returns {Promise<{ dataUrl: string, base64: string, width: number, height: number }>}
 */
export function compressImageToJpegBase64(file, maxDimension = 800, quality = 0.6, maxBytes = 80 * 1024) {
    return new Promise((resolve, reject) => {
        // HEIC hanya dapat dibaca oleh peramban yang mendukungnya (mis. Safari); selain itu beri pesan yang jelas
        const isHeic = /^image\/hei[cf]$/i.test(file?.type || '') || /\.hei[cf]$/i.test(file?.name || '');
        if (!file || (!file.type.startsWith('image/') && !isHeic)) {
            return reject(new Error('File yang dipilih bukan berkas gambar yang sah.'));
        }
        const reader = new FileReader();
        reader.onload = e => {
            const img = new Image();
            img.onload = () => {
                let width = img.width;
                let height = img.height;
                if (width > maxDimension || height > maxDimension) {
                    if (width > height) {
                        height = Math.round((height * maxDimension) / width);
                        width = maxDimension;
                    } else {
                        width = Math.round((width * maxDimension) / height);
                        height = maxDimension;
                    }
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                let currentQuality = quality;
                let dataUrl = canvas.toDataURL('image/jpeg', currentQuality);

                // Target Base64 max ~80KB (1 char ~= 0.75 byte)
                if (maxBytes > 0) {
                    const maxChars = Math.round(maxBytes / 0.75);
                    while (dataUrl.length > maxChars && currentQuality > 0.1) {
                        currentQuality -= 0.1;
                        dataUrl = canvas.toDataURL('image/jpeg', currentQuality);
                    }
                }

                const base64 = dataUrl.split(',')[1];
                resolve({ dataUrl, base64, width, height });
            };
            img.onerror = () => {
                if (!isHeic) return reject(new Error('Format foto tidak dapat dibaca oleh peramban.'));
                const heicErr = new Error('Foto berformat HEIC belum dapat dibaca di perangkat ini. Ambil foto lewat tombol Kamera, atau ubah foto ke JPG terlebih dahulu.');
                heicErr.code = 'HEIC_UNSUPPORTED';
                reject(heicErr);
            };
            img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error('Gagal membaca berkas foto dari perangkat.'));
        reader.readAsDataURL(file);
    });
}

/**
 * Unggah foto ke Google Apps Script Web App sekolah (disimpan ke Google Drive)
 * Menggunakan hierarki folder: E-Kinerja / YYYY-MM / Nama_Guru
 */
export async function uploadWorkloadPhotoToGoogleDrive(base64Data, fileName, folderContext = {}, maxRetries = 2) {
    const teacherName = folderContext.teacherName || getCurrentTeacherDisplayName();
    const yearMonth = folderContext.yearMonth || (new Date().toISOString().slice(0, 7));
    const safeTeacher = teacherName.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'Guru';
    const folderPath = `E-Kinerja/${yearMonth}/${safeTeacher}`;

    let lastError = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const timeoutId = controller ? setTimeout(() => controller.abort(), 35000) : null;

            const response = await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({
                    action: 'upload',
                    image: base64Data,
                    fileName: fileName,
                    folderPath: folderPath,
                    guruName: safeTeacher,
                    yearMonth: yearMonth,
                    kelas: folderPath
                }),
                signal: controller ? controller.signal : undefined
            });
            if (timeoutId) clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`Layanan foto Google Drive mengembalikan HTTP ${response.status}.`);
            }

            const result = await response.json();
            if (!result.success) throw new Error(result.error || 'Pengunggahan ke Google Drive gagal.');
            if (!result.url) throw new Error('Respons pengunggahan tidak menyertakan tautan Google Drive.');
            return { url: result.url, fileId: result.fileId, name: fileName };
        } catch (err) {
            lastError = err;
            if (attempt < maxRetries) {
                await new Promise(r => setTimeout(r, 1200));
            }
        }
    }

    throw lastError || new Error('Gagal mengunggah foto ke Google Drive setelah beberapa percobaan.');
}

/**
 * Hapus foto dari Google Drive di latar belakang (fire and forget)
 */
export async function deleteWorkloadPhotoFromGoogleDrive(fileId) {
    if (!fileId) return;
    try {
        fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'delete',
                fileId: fileId
            })
        }).catch(e => console.warn('[Workload Delete Photo]', e));
    } catch (e) {
        console.warn('[Workload Delete Photo]', e);
    }
}

export function workloadUpdatePhotoCaption(index, captionText) {
    if (index >= 0 && index < _currentLogPhotos.length) {
        _currentLogPhotos[index].caption = String(captionText || '');
    }
}

/**
 * Mengatur ulang posisi foto bukti kegiatan realisasi secara interaktif
 * @param {number} fromIndex - Indeks kartu asal
 * @param {number} toIndex - Indeks kartu tujuan
 */
export function reorderWorkloadPhoto(fromIndex, toIndex) {
    if (
        fromIndex === toIndex ||
        fromIndex < 0 || toIndex < 0 ||
        fromIndex >= _currentLogPhotos.length || toIndex >= _currentLogPhotos.length
    ) {
        return;
    }
    _currentLogPhotos = reorderArrayItems(_currentLogPhotos, fromIndex, toIndex);
    renderEvidencePhotosGrid();
}

export function renderEvidencePhotosGrid() {
    const grid = el('evidence-photos-grid');
    const countEl = el('evidence-photos-count');
    const btnAdd = el('btn-add-evidence-photo');
    if (!grid) return;

    // Preservasi fokus & posisi kursor saat re-render otomatis di latar belakang
    const activeEl = document.activeElement;
    let activeIndex = -1;
    let selStart = 0;
    let selEnd = 0;
    if (activeEl && activeEl.dataset && activeEl.dataset.photoCaptionIndex !== undefined) {
        activeIndex = parseInt(activeEl.dataset.photoCaptionIndex, 10);
        selStart = activeEl.selectionStart || 0;
        selEnd = activeEl.selectionEnd || 0;
    }

    const count = _currentLogPhotos.length;
    if (countEl) {
        countEl.textContent = `${count} / ${MAX_WORKLOAD_PHOTOS} Foto`;
        countEl.className = count >= MAX_WORKLOAD_PHOTOS
            ? 'text-[11px] font-bold text-amber-600 dark:text-amber-400'
            : 'text-[11px] font-bold text-slate-400';
    }
    const btnCamera = el('btn-camera-evidence-photo');
    if (btnCamera) {
        btnCamera.disabled = count >= MAX_WORKLOAD_PHOTOS;
        btnCamera.classList.toggle('opacity-50', count >= MAX_WORKLOAD_PHOTOS);
        btnCamera.classList.toggle('cursor-not-allowed', count >= MAX_WORKLOAD_PHOTOS);
    }
    if (btnAdd) {
        btnAdd.disabled = count >= MAX_WORKLOAD_PHOTOS;
        btnAdd.classList.toggle('opacity-50', count >= MAX_WORKLOAD_PHOTOS);
        btnAdd.classList.toggle('cursor-not-allowed', count >= MAX_WORKLOAD_PHOTOS);
    }

    if (count === 0) {
        grid.innerHTML = `
            <div class="col-span-full py-4 px-3 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl text-center text-slate-400 text-xs flex flex-col items-center justify-center gap-1 bg-slate-50/50 dark:bg-slate-900/30">
                <i class="fa-regular fa-images text-xl text-slate-300 dark:text-slate-600"></i>
                <span class="text-[11px]">Belum ada foto bukti diunggah (opsional, maks. ${MAX_WORKLOAD_PHOTOS})</span>
            </div>`;
        return;
    }

    let html = '';
    _currentLogPhotos.forEach((photo, idx) => {
        const thumbUrl = photo.localPreview || (photo.url ? getGoogleDriveThumbnail(photo.url) : '');
        const isUploading = photo.state === 'uploading';
        const isFailed = photo.state === 'failed';
        const captionVal = escapeHTML(photo.caption || '');

        html += `
        <div class="photo-card-item flex flex-col gap-1 p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 shadow-2xs transition-all hover:border-purple-300 dark:hover:border-purple-800 cursor-default" data-photo-index="${idx}">
            <!-- Thumbnail & Tombol Hapus/Pratinjau/Handle Drag -->
            <div class="relative group rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 aspect-video flex items-center justify-center">
                ${thumbUrl ? `
                    <img src="${thumbUrl}" alt="Bukti ${idx + 1}" class="w-full h-full object-cover cursor-pointer transition-transform group-hover:scale-105" onclick="window.workloadPreviewPhotoInModal(${idx})" title="Klik untuk perbesar foto">
                ` : `
                    <div class="w-full h-full flex items-center justify-center text-slate-400"><i class="fa-solid fa-image text-xl"></i></div>
                `}

                ${isUploading ? `
                    <div class="absolute inset-0 bg-black/60 backdrop-blur-2xs flex flex-col items-center justify-center text-white text-[10px] gap-1 z-10">
                        <i class="fa-solid fa-circle-notch animate-spin text-sm text-purple-400"></i>
                        <span class="font-semibold">Mengunggah...</span>
                    </div>
                ` : ''}

                ${isFailed ? `
                    <div class="absolute inset-0 bg-rose-950/80 flex flex-col items-center justify-center text-white text-[10px] gap-1 z-10 p-1 text-center">
                        <i class="fa-solid fa-triangle-exclamation text-rose-400 text-xs"></i>
                        <span class="text-[9px] text-rose-200">Gagal Unggah</span>
                    </div>
                ` : ''}

                <!-- Handle Drag Grip Geser Posisi (Pojok Kiri Atas - Touch & Mouse Friendly) -->
                ${count > 1 ? `
                <div
                    class="photo-drag-handle absolute top-1.5 left-1.5 w-7 h-7 sm:w-6 sm:h-6 rounded-lg bg-black/75 hover:bg-black/90 active:scale-95 text-white/90 hover:text-white flex items-center justify-center text-xs sm:text-[10px] transition-all z-20 cursor-grab active:cursor-grabbing shadow-xs touch-none select-none"
                    title="Tahan dan geser untuk ubah urutan foto"
                    data-photo-index="${idx}"
                    draggable="false"
                >
                    <i class="fa-solid fa-grip-vertical"></i>
                </div>` : ''}

                <!-- Tombol Hapus ❌ (Touch-friendly di layar mobile & desktop) -->
                <button type="button" onclick="event.stopPropagation(); window.workloadRemovePhoto(${idx})" class="absolute top-1.5 right-1.5 w-7 h-7 sm:w-6 sm:h-6 rounded-full bg-black/75 hover:bg-rose-600 active:scale-90 text-white flex items-center justify-center text-xs sm:text-[10px] transition-all z-20 cursor-pointer shadow-xs" title="Hapus foto ini">
                    <i class="fa-solid fa-xmark"></i>
                </button>

                <!-- Label Posisi & Drive Badge -->
                <div class="absolute bottom-1.5 left-1.5 px-2 py-0.5 rounded-md bg-black/70 backdrop-blur-2xs text-[9px] font-bold text-white flex items-center gap-1.5 z-10 pointer-events-none">
                    <i class="fa-brands fa-google-drive text-emerald-400 text-[10px]"></i>
                    <span>Foto ${idx + 1}</span>
                </div>
            </div>

            <!-- Input Keterangan / Caption Foto (Compact Multi-Line Auto-Wrap) -->
            <div class="flex flex-col gap-0.5">
                <label class="text-[9px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <i class="fa-regular fa-comment-dots text-purple-500 text-[9px]"></i>
                    <span>Keterangan Foto ${idx + 1}</span>
                </label>
                <textarea
                    rows="2"
                    maxlength="150"
                    data-photo-caption-index="${idx}"
                    oninput="window.workloadUpdatePhotoCaption(${idx}, this.value)"
                    placeholder="Contoh: Pendampingan siswa di lab..."
                    title="Keterangan untuk foto ${idx + 1} (opsional)"
                    class="w-full px-2 py-1 text-[10px] leading-snug rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-purple-500 focus:bg-white dark:focus:bg-slate-950 transition-all resize-none overflow-y-auto"
                >${captionVal}</textarea>
            </div>
        </div>`;
    });

    grid.innerHTML = html;

    // Hubungkan event Drag-and-Drop serta sentuh mobile pada grid foto
    setupPhotoGridDragAndDrop(grid, {
        handleSelector: '.photo-drag-handle',
        cardSelector: '.photo-card-item',
        onReorder: reorderWorkloadPhoto
    });

    // Kembalikan fokus kursor jika pengguna sedang mengetik saat foto selesai diunggah
    if (activeIndex >= 0) {
        const newActiveInput = grid.querySelector(`[data-photo-caption-index="${activeIndex}"]`);
        if (newActiveInput) {
            newActiveInput.focus();
            try {
                newActiveInput.setSelectionRange(selStart, selEnd);
            } catch (_) {}
        }
    }
}

export async function handlePhotoFilesSelected(files) {
    if (!files || files.length === 0) return;
    try {
        const fileArr = Array.from(files);
        const availableSlots = MAX_WORKLOAD_PHOTOS - _currentLogPhotos.length;

        if (availableSlots <= 0) {
            showToast(`Maksimal ${MAX_WORKLOAD_PHOTOS} foto per kegiatan telah tercapai.`, 'warning');
            return;
        }

        const filesToUpload = fileArr.slice(0, availableSlots);
        if (fileArr.length > availableSlots) {
            showToast(`Hanya ${availableSlots} foto pertama yang dipilih (maksimal ${MAX_WORKLOAD_PHOTOS} foto).`, 'info');
        }

        const fileInput = el('log-input-photo-file');
        if (fileInput) fileInput.value = '';
        const camInput = el('log-input-photo-camera');
        if (camInput) camInput.value = '';

        const todayStr = dateOfDay(_weekStartDate, _selectedDayIndex);
        const yearMonth = todayStr ? todayStr.slice(0, 7) : (new Date().toISOString().slice(0, 7));
        const teacherName = getCurrentTeacherDisplayName();

        for (const file of filesToUpload) {
            if (!file) continue;

            const tempId = ++_photoUploadSeq;
            const photoItem = {
                id: tempId,
                file,
                name: file.name || `Foto_${tempId}.jpg`,
                caption: '',
                state: 'uploading',
                localPreview: '',
                url: '',
                fileId: '',
                error: null
            };
            _currentLogPhotos.push(photoItem);
            renderEvidencePhotosGrid();

            // Mulai kompresi & pengunggahan otomatis di latar belakang
            (async (item) => {
                try {
                    const compressed = await compressImageToJpegBase64(item.file);
                    item.localPreview = compressed.dataUrl;
                    renderEvidencePhotosGrid();

                    const safeName = `${todayStr}_${teacherName.replace(/[^a-zA-Z0-9]/g, '')}_${Date.now()}_${item.id}.jpg`;
                    const uploaded = await uploadWorkloadPhotoToGoogleDrive(compressed.base64, safeName, {
                        teacherName,
                        yearMonth
                    });
                    item.url = uploaded.url;
                    item.fileId = uploaded.fileId;
                    item.state = 'ready';
                    renderEvidencePhotosGrid();
                } catch (err) {
                    console.warn('[Workload Photo Upload]', err);
                    if (err?.code === 'HEIC_UNSUPPORTED') {
                        const idx = _currentLogPhotos.indexOf(item);
                        if (idx >= 0) _currentLogPhotos.splice(idx, 1);
                        showToast(err.message, 'warning', 6000);
                        renderEvidencePhotosGrid();
                        return;
                    }
                    item.state = 'failed';
                    item.error = err?.message || 'Gagal mengunggah foto';
                    showToast(`Gagal mengunggah ${item.name}: ${err?.message || 'Kesalahan jaringan'}`, 'error');
                    renderEvidencePhotosGrid();
                }
            })(photoItem);
        }
    } catch (outerErr) {
        console.error('[Workload handlePhotoFilesSelected error]', outerErr);
        showToast(`Gagal memproses foto bukti: ${outerErr?.message || 'Terjadi kesalahan sistem'}`, 'error');
    }
}

export function removePhoto(index) {
    if (index < 0 || index >= _currentLogPhotos.length) return;
    const item = _currentLogPhotos[index];
    if (item && item.fileId) {
        deleteWorkloadPhotoFromGoogleDrive(item.fileId);
    }
    _currentLogPhotos.splice(index, 1);
    renderEvidencePhotosGrid();
}

export function previewPhotoInModal(index) {
    if (index < 0 || index >= _currentLogPhotos.length) return;
    const readyPhotos = _currentLogPhotos.filter(p => p.url);
    if (readyPhotos.length > 0) {
        workloadOpenLightbox(readyPhotos, index, el('log-input-title')?.value || 'Foto Bukti Kegiatan');
    }
}

export function workloadOpenLightbox(photos, initialIndex = 0, title = 'Foto Bukti Dukung') {
    let parsedList = [];
    if (typeof photos === 'string') {
        parsedList = parseEvidencePhotos(photos);
    } else if (Array.isArray(photos)) {
        parsedList = photos;
    }

    if (!parsedList || parsedList.length === 0) {
        showToast('Tidak ada foto bukti dukung yang tersedia.', 'info');
        return;
    }

    // Jika hanya 1 item dan bukan file gambar (misal tautan folder drive atau dokumen umum)
    if (parsedList.length === 1) {
        const u = parsedList[0].url || '';
        const isDriveImg = !!extractGoogleDriveFileId(u);
        const isDirectImg = /\.(jpeg|jpg|png|webp|gif|svg)($|\?)/i.test(u);
        if (!isDriveImg && !isDirectImg && sanitizeUrl(u)) {
            window.open(sanitizeUrl(u), '_blank', 'noopener,noreferrer');
            return;
        }
    }

    _lightboxPhotos = parsedList;
    _lightboxIndex = Math.max(0, Math.min(initialIndex, parsedList.length - 1));

    const modal = el('modal-evidence-lightbox');
    if (!modal) return;

    const titleEl = el('lightbox-title');
    if (titleEl) titleEl.textContent = title;

    updateLightboxView();
    modal.classList.remove('hidden');

    if (!window._workloadLightboxKeyListener) {
        window._workloadLightboxKeyListener = (e) => {
            const m = el('modal-evidence-lightbox');
            if (!m || m.classList.contains('hidden')) return;
            if (e.key === 'Escape') {
                workloadCloseLightbox();
            } else if (e.key === 'ArrowRight') {
                workloadLightboxNext();
            } else if (e.key === 'ArrowLeft') {
                workloadLightboxPrev();
            }
        };
        document.addEventListener('keydown', window._workloadLightboxKeyListener);
    }

    // Dukungan Gestur Swipe Touch pada Ponsel / Layar Sentuh Mobile
    if (!window._workloadLightboxTouchListener) {
        let touchStartX = 0;
        let touchStartY = 0;
        const stage = el('lightbox-image-stage') || modal;
        if (stage) {
            stage.addEventListener('touchstart', (e) => {
                if (e.touches && e.touches.length === 1) {
                    touchStartX = e.touches[0].clientX;
                    touchStartY = e.touches[0].clientY;
                }
            }, { passive: true });

            stage.addEventListener('touchend', (e) => {
                if (e.changedTouches && e.changedTouches.length === 1) {
                    const deltaX = e.changedTouches[0].clientX - touchStartX;
                    const deltaY = e.changedTouches[0].clientY - touchStartY;
                    // Deteksi usapan horizontal mantap (threshold 45px dan dominan horizontal)
                    if (Math.abs(deltaX) > 45 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25) {
                        if (deltaX < 0) {
                            workloadLightboxNext();
                        } else {
                            workloadLightboxPrev();
                        }
                    }
                }
            }, { passive: true });
            window._workloadLightboxTouchListener = true;
        }
    }
}

export function workloadCloseLightbox() {
    const modal = el('modal-evidence-lightbox');
    if (modal) modal.classList.add('hidden');
}

export function workloadLightboxNext() {
    if (_lightboxPhotos.length <= 1) return;
    _lightboxIndex = (_lightboxIndex + 1) % _lightboxPhotos.length;
    updateLightboxView();
}

export function workloadLightboxPrev() {
    if (_lightboxPhotos.length <= 1) return;
    _lightboxIndex = (_lightboxIndex - 1 + _lightboxPhotos.length) % _lightboxPhotos.length;
    updateLightboxView();
}

function updateLightboxView() {
    if (_lightboxPhotos.length === 0) return;
    const cur = _lightboxPhotos[_lightboxIndex] || {};
    const imgEl = el('lightbox-img');
    const counterEl = el('lightbox-counter');
    const btnDrive = el('lightbox-btn-drive');
    const btnPrev = el('lightbox-btn-prev');
    const btnNext = el('lightbox-btn-next');
    const strip = el('lightbox-thumbnails-strip');

    const rawUrl = cur.url || '';
    const fileId = cur.fileId || extractGoogleDriveFileId(rawUrl);
    const displaySrc = fileId
        ? `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}`
        : rawUrl;

    if (imgEl) {
        imgEl.src = displaySrc;
        imgEl.onerror = () => {
            if (displaySrc.includes('lh3.googleusercontent.com') && rawUrl && !rawUrl.includes('lh3.googleusercontent.com')) {
                imgEl.src = rawUrl;
            }
        };
    }
    if (counterEl) {
        counterEl.textContent = `${_lightboxIndex + 1} / ${_lightboxPhotos.length}`;
    }
    if (btnDrive) {
        btnDrive.href = rawUrl || '#';
    }

    // Tampilkan / Sembunyikan Keterangan / Caption Foto
    const captionBox = el('lightbox-caption-box');
    const captionText = el('lightbox-caption-text');
    const caption = (cur.caption || '').trim();
    if (captionBox && captionText) {
        if (caption) {
            captionText.textContent = caption;
            captionBox.classList.remove('hidden');
        } else {
            captionBox.classList.add('hidden');
            captionText.textContent = '';
        }
    }

    const showNav = _lightboxPhotos.length > 1;
    if (btnPrev) btnPrev.classList.toggle('hidden', !showNav);
    if (btnNext) btnNext.classList.toggle('hidden', !showNav);

    if (strip) {
        if (!showNav) {
            strip.classList.add('hidden');
        } else {
            strip.classList.remove('hidden');
            let stripHtml = '';
            _lightboxPhotos.forEach((p, idx) => {
                const fId = p.fileId || extractGoogleDriveFileId(p.url);
                const thumb = fId ? `https://lh3.googleusercontent.com/d/${encodeURIComponent(fId)}` : p.url;
                const isAct = idx === _lightboxIndex;
                const stripTitle = `Foto ${idx + 1}${p.caption ? ': ' + p.caption : ''}`;
                stripHtml += `
                <button type="button" data-lightbox-thumb-idx="${idx}" onclick="window.workloadSetLightboxIndex(${idx})" title="${escapeHTML(stripTitle)}" class="shrink-0 w-11 h-9 sm:w-12 sm:h-10 rounded-lg overflow-hidden border-2 transition-all cursor-pointer snap-center ${isAct ? 'border-purple-500 scale-105 opacity-100 ring-2 ring-purple-500/30' : 'border-transparent opacity-60 hover:opacity-100'}">
                    <img src="${thumb}" alt="Thumb ${idx + 1}" class="w-full h-full object-cover">
                </button>`;
            });
            strip.innerHTML = stripHtml;

            // Auto-scroll thumbnail aktif ke tengah tampilan strip (sangat nyaman di layar mobile)
            const activeThumb = strip.querySelector(`[data-lightbox-thumb-idx="${_lightboxIndex}"]`);
            if (activeThumb && typeof activeThumb.scrollIntoView === 'function') {
                activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }
        }
    }
}

export function workloadSetLightboxIndex(idx) {
    if (idx >= 0 && idx < _lightboxPhotos.length) {
        _lightboxIndex = idx;
        updateLightboxView();
    }
}

export function workloadOpenLightboxFromLogId(logId) {
    if (!logId || !_weekData?.logs) return;
    const log = _weekData.logs.find(l => l.id === logId);
    if (!log || !log.evidence_url) {
        showToast('Tidak ada foto bukti dukung untuk kegiatan ini.', 'info');
        return;
    }
    const photos = parseEvidencePhotos(log.evidence_url);
    workloadOpenLightbox(photos, 0, log.title || 'Foto Bukti Kegiatan');
}

export function workloadOpenEvidence(url) {
    const photos = parseEvidencePhotos(url);
    if (photos.length > 0) {
        workloadOpenLightbox(photos, 0);
        return;
    }
    const safeUrl = sanitizeUrl(url);
    if (!safeUrl) {
        showToast('Tautan bukti dukung belum diisi atau format URL tidak valid.', 'warning');
        return;
    }
    window.open(safeUrl, '_blank', 'noopener,noreferrer');
}

/**
 * Efek pulsing glow highlight pada box/kontainer foto bukti dukung di modal realisasi
 * Menggulung (scroll) tampilan ke box foto secara halus dan memberikan efek kedip lembut selama 3-4 detik
 */
export function highlightEvidencePhotoSection() {
    if (typeof document === 'undefined') return;
    const section = document.getElementById('log-evidence-photos-section');
    if (!section) return;

    try {
        section.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (_) {
        section.scrollIntoView(false);
    }

    section.classList.add(
        'ring-4',
        'ring-purple-500/70',
        'bg-purple-50/70',
        'dark:bg-purple-950/40',
        'shadow-lg',
        'shadow-purple-500/20',
        'animate-pulse'
    );

    setTimeout(() => {
        section.classList.remove('animate-pulse');
        setTimeout(() => {
            section.classList.remove(
                'ring-4',
                'ring-purple-500/70',
                'bg-purple-50/70',
                'dark:bg-purple-950/40',
                'shadow-lg',
                'shadow-purple-500/20'
            );
        }, 800);
    }, 3200);
}

/**
 * Dialog konfirmasi khusus bukti dukung foto pada aksi simpan cepat (centang 1-klik)
 * Mengembalikan Promise<'photo' | 'save' | 'cancel'>
 * @param {string} message
 * @param {string} title
 * @param {object} options
 * @returns {Promise<'photo'|'save'|'cancel'>}
 */
export function askPhotoConfirmation(message, title = 'Konfirmasi Bukti Dukung Realisasi', options = {}) {
    return new Promise((resolve) => {
        if (typeof document === 'undefined') {
            resolve('save');
            return;
        }

        const existing = document.getElementById('workload-photo-confirm-overlay');
        if (existing) existing.remove();

        const photoBtnText = options.photoText || 'Ambil Foto';
        const saveBtnText = options.saveText || 'Tetap Simpan';

        const overlay = document.createElement('div');
        overlay.id = 'workload-photo-confirm-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);opacity:0;transition:opacity 0.25s ease;';
        overlay.innerHTML = `
            <div id="workload-photo-confirm-card" class="relative" style="background:rgba(255,255,255,0.98);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-radius:1.25rem;padding:2rem 1.75rem 1.5rem;max-width:400px;width:92%;box-shadow:0 25px 60px rgba(0,0,0,0.25),0 0 0 1px rgba(255,255,255,0.1);text-align:center;transform:scale(0.85) translateY(20px);transition:transform 0.3s cubic-bezier(0.34,1.56,0.64,1),opacity 0.3s ease;opacity:0;">
                <button type="button" id="workload-photo-confirm-close" style="position:absolute;top:0.875rem;right:0.875rem;width:2rem;height:2rem;border-radius:0.5rem;display:flex;align-items:center;justify-content:center;border:none;background:transparent;color:#94a3b8;cursor:pointer;font-size:1rem;transition:all 0.2s ease;" title="Tutup">
                    <i class="fa-solid fa-xmark"></i>
                </button>
                <div style="width:4rem;height:4rem;border-radius:50%;background:rgba(168,85,247,0.14);display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;">
                    <i class="fa-solid fa-camera" style="font-size:1.6rem;color:#a855f7;"></i>
                </div>
                <h3 style="font-size:1.1rem;font-weight:700;color:#1e293b;margin:0 0 0.5rem;">${escapeHTML(title)}</h3>
                <div style="font-size:0.875rem;color:#64748b;line-height:1.55;margin:0 0 1.5rem;white-space:pre-line;">${escapeHTML(message)}</div>
                <div style="display:flex;flex-direction:column;gap:0.625rem;justify-content:center;">
                    <button type="button" id="workload-photo-confirm-photo" style="width:100%;padding:0.75rem 1.25rem;border-radius:0.75rem;font-weight:700;font-size:0.875rem;color:#fff;background:linear-gradient(135deg, #9333ea, #7e22ce);border:none;cursor:pointer;transition:all 0.2s ease;box-shadow:0 4px 15px rgba(147,51,234,0.3);display:flex;align-items:center;justify-content:center;gap:0.5rem;">
                        <i class="fa-solid fa-camera"></i>
                        <span>${escapeHTML(photoBtnText)}</span>
                    </button>
                    <button type="button" id="workload-photo-confirm-save" style="width:100%;padding:0.65rem 1.1rem;border-radius:0.75rem;font-weight:600;font-size:0.85rem;color:#475569;background:rgba(100,116,139,0.08);border:1px solid rgba(100,116,139,0.2);cursor:pointer;transition:all 0.2s ease;display:flex;align-items:center;justify-content:center;gap:0.4rem;">
                        <i class="fa-solid fa-check"></i>
                        <span>${escapeHTML(saveBtnText)}</span>
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        if (document.documentElement.classList.contains('dark')) {
            const card = overlay.querySelector('#workload-photo-confirm-card');
            if (card) {
                card.style.background = 'rgba(30,41,59,0.98)';
                const h3 = card.querySelector('h3');
                if (h3) h3.style.color = '#f1f5f9';
                const msgEl = card.querySelector('div[style*="line-height"]');
                if (msgEl) msgEl.style.color = '#94a3b8';
                const saveBtn = card.querySelector('#workload-photo-confirm-save');
                if (saveBtn) {
                    saveBtn.style.color = '#cbd5e1';
                    saveBtn.style.background = 'rgba(148,163,184,0.12)';
                    saveBtn.style.borderColor = 'rgba(148,163,184,0.25)';
                }
            }
        }

        requestAnimationFrame(() => {
            overlay.style.opacity = '1';
            const card = overlay.querySelector('#workload-photo-confirm-card');
            if (card) {
                card.style.transform = 'scale(1) translateY(0)';
                card.style.opacity = '1';
            }
        });

        const closeModal = (choice) => {
            document.removeEventListener('keydown', escHandler);
            const card = overlay.querySelector('#workload-photo-confirm-card');
            overlay.style.opacity = '0';
            if (card) {
                card.style.transform = 'scale(0.85) translateY(20px)';
                card.style.opacity = '0';
            }
            setTimeout(() => {
                overlay.remove();
                resolve(choice);
            }, 250);
        };

        const escHandler = (e) => {
            if (e.key === 'Escape') {
                closeModal('cancel');
            }
        };
        document.addEventListener('keydown', escHandler);

        overlay.querySelector('#workload-photo-confirm-photo')?.addEventListener('click', () => closeModal('photo'));
        overlay.querySelector('#workload-photo-confirm-save')?.addEventListener('click', () => closeModal('save'));
        overlay.querySelector('#workload-photo-confirm-close')?.addEventListener('click', () => closeModal('cancel'));
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal('cancel');
        });
    });
}

/**
 * Validasi apakah suatu tanggal merupakan hari libur resmi sekolah yang sah untuk pembersihan rencana
 * Menjamin entri dispensasi khusus / libur sekolah sementara heuristik Monitoring KBM tidak memicu penghapusan keliru.
 * @param {string} dateStr - Tanggal format YYYY-MM-DD
 * @returns {boolean}
 */
export function isOfficialHolidayForPlanCleanup(dateStr) {
    if (!dateStr || !isHolidayDate(dateStr)) return false;
    const info = getHolidayDateInfo(dateStr);
    if (!info) return true;
    const title = String(info.title || info.name || '').trim();
    if (/^Dispensasi Khusus \/ Libur Sekolah \(\d+ Rombel Aktif\)/i.test(title)) {
        return false;
    }
    return true;
}

export function workloadOpenCurrentEvidence() {
    const rawVal = el('log-input-evidence')?.value?.trim();
    if (!rawVal) {
        showToast('Tautan bukti dukung belum diisi.', 'warning');
        return;
    }
    workloadOpenEvidence(rawVal);
}

export function workloadSyncEvidenceButtons() {
    const rawVal = el('log-input-evidence')?.value?.trim() || '';
    const btnOpen = el('btn-click-open-evidence');
    const safeUrl = sanitizeUrl(rawVal);

    if (btnOpen) {
        btnOpen.disabled = !safeUrl;
    }
    const boxPreview = el('box-evidence-preview');
    const imgThumb = el('img-evidence-thumbnail');
    if (boxPreview && imgThumb) {
        const thumbUrl = getGoogleDriveThumbnail(safeUrl);
        if (thumbUrl) {
            imgThumb.src = thumbUrl;
            boxPreview.classList.remove('hidden');
        } else {
            boxPreview.classList.add('hidden');
            imgThumb.src = '';
        }
    }
}

const INDO_MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function formatWeekRangeDisplay(mondayStr) {
    if (!mondayStr) return '-';
    try {
        const parts = mondayStr.split('-');
        if (parts.length !== 3) return mondayStr;
        const m = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        if (isNaN(m.getTime())) return mondayStr;
        const f = new Date(m);
        f.setDate(m.getDate() + 4); // Jumat (5 hari kerja sekolah)

        const mD = m.getDate();
        const fD = f.getDate();
        const mM = m.getMonth();
        const fM = f.getMonth();
        const mY = m.getFullYear();
        const fY = f.getFullYear();

        const mMonth = INDO_MONTHS_SHORT[mM] || '';
        const fMonth = INDO_MONTHS_SHORT[fM] || '';

        if (mY === fY) {
            if (mM === fM) {
                return `${mD} – ${fD} ${mMonth} ${mY}`;
            }
            return `${mD} ${mMonth} – ${fD} ${fMonth} ${mY}`;
        }
        return `${mD} ${mMonth} ${mY} – ${fD} ${fMonth} ${fY}`;
    } catch {
        return mondayStr;
    }
}

function renderWeekRangeLabel() {
    const lbl = el('label-week-range');
    if (lbl) {
        lbl.textContent = formatWeekRangeDisplay(_weekStartDate);
    }
}

function el(id) { return document.getElementById(id); }

// ========== SE MENDIKDASMEN NO. 5684/2025: HARI BELAJAR GURU ==========
export function determineTeacherStudyDay() {
    // Server resolves master jadwal, identitas guru, libur/cuti dan snapshot versi.
    // Preferensi localStorage lama tidak aman untuk dipindahkan antar guru.
    const detection = _weekData?.study_day || detectTeacherStudyDay();
    _studyDayIndex = detection.studyDayIndex;
    _studyDayIsAuto = detection.isAutoDetected;
    return detection;
}

export async function setTeacherStudyDay(dayIdx) {
    if (_isSavingStudyDay || _isSubmittingPlan || dayIdx === '') return;
    const idx = dayIdx === 'auto' ? null : Number(dayIdx);
    if (idx !== null && (!Number.isInteger(idx) || idx < 0 || idx > 4)) return;
    if (!_weekData || (_weekData.active_version && !['draft', 'needs_revision'].includes(_weekData.active_version.status)) || _weekData.week?.is_locked) return;
    const targetDate = _weekStartDate;
    const targetTeacher = getEffectiveTeacherId();
    const currentData = _weekData;
    _isSavingStudyDay = true;
    renderTeacherStudyDayControl();
    try {
        let data = currentData;
        if (!data.active_version) {
            await cfInitializeWorkloadWeek({ week_start_date: targetDate, teacher_id: targetTeacher || undefined });
            const initialized = await cfGetWorkloadWeek(targetTeacher, targetDate);
            data = initialized?.data;
        }
        if (!data?.week?.id || !data.active_version) throw new Error('Rencana kerja belum tersedia. Muat ulang halaman.');
        const response = await cfSaveWorkloadStudyDay({
            work_week_id: data.week.id, plan_version_id: data.active_version.id,
            revision_lock: Number(data.active_version.revision_lock), manual_day_index: idx
        });
        if (!response?.data?.study_day) throw new Error('Server belum mengembalikan penetapan hari belajar.');
        // Jangan menimpa guru/pekan lain yang dibuka ketika penyimpanan berlangsung.
        if (_weekData === currentData && _weekStartDate === targetDate && getEffectiveTeacherId() === targetTeacher) {
            _weekData = { ...data, study_day: response.data.study_day,
                active_version: { ...data.active_version, revision_lock: response.data.revision_lock } };
            renderAll();
        }
        showToast(idx === null ? 'Deteksi otomatis Hari Belajar Guru diaktifkan.' : `Hari Belajar Guru disimpan: ${DAY_NAMES[idx]}.`, 'success');
    } catch (error) {
        showToast(error.message || 'Gagal menyimpan hari belajar. Silakan coba lagi.', 'error');
    } finally {
        _isSavingStudyDay = false;
        renderTeacherStudyDayControl();
    }
}

function renderTeacherStudyDayControl() {
    const detection = _weekData?.study_day || detectTeacherStudyDay();
    const select = el('select-workload-study-day');
    if (select) {
        select.value = detection.status === 'manual' ? String(detection.studyDayIndex) : 'auto';
        select.disabled = _isSavingStudyDay || _isSubmittingPlan || !_weekData || !!_weekData.week?.is_locked ||
            (!!_weekData.active_version && !['draft', 'needs_revision'].includes(_weekData.active_version.status));
    }
    const badge = el('study-day-auto-badge');
    if (badge) {
        const labels = { auto: 'Otomatis', manual: 'Manual', unavailable: 'Belum ditentukan', needs_selection: 'Pilih hari', exempt: 'Bebas HBG' };
        badge.textContent = _isSavingStudyDay ? 'Menyimpan…' : (labels[detection.status] || 'Belum ditentukan');
        badge.title = detection.reason || '';
    }
    const help = el('study-day-help');
    const box = el('study-day-control-box');
    const suggestion = Number.isInteger(detection.suggestedDayIndex) ? ` Saran: ${DAY_NAMES[detection.suggestedDayIndex]} (durasi KBM paling ringan).` : '';
    const fullHelpText = (detection.status === 'auto' ? `Hasil otomatis: ${detection.studyDayName}. ` : '') +
        (detection.reason || '') + suggestion + (detection.isExempt && detection.status === 'manual' ? ' Kewajiban HBG dikecualikan karena libur/cuti.' : '');

    if (box) {
        box.title = fullHelpText || 'Penetapan Hari Belajar Guru (SE Mendikdasmen No. 5684/2025)';

        // Otomatis sembunyikan pemilihan HBG jika rencana sudah tersimpan/memiliki kegiatan,
        // sudah difinalisasi/disetujui, atau template sudah pernah diterapkan (permanen)
        const hasSegments = (_weekData?.segments || []).length > 0;
        const isFinalized = !!(_weekData?.active_version && (
            _weekData.active_version.submitted_at ||
            ['approved', 'submitted', 'needs_revision'].includes(_weekData.active_version.status)
        ));
        const teacherKey = `${getEffectiveTeacherId() || ''}_${_weekStartDate || ''}`;
        const isTemplateApplied = !!_weekData?.template_applied ||
            !!_weekData?.active_version?.template_id ||
            _appliedTemplateWeeks.has(teacherKey);

        if (hasSegments || isFinalized || isTemplateApplied) {
            box.classList.add('hidden', '!hidden');
            box.style.display = 'none';
        } else {
            box.classList.remove('hidden', '!hidden');
            box.style.display = '';
        }
    }

    if (help) {
        help.textContent = fullHelpText;
        const needsAction = ['needs_selection', 'unavailable'].includes(detection.status);
        if (needsAction) {
            help.className = 'w-full text-[10px] leading-tight text-amber-700 dark:text-amber-300 truncate';
        } else {
            help.className = 'sr-only';
        }
    }
}

export function quickAddMgmp(dayIndex = null) {
    const targetDay = (dayIndex !== null && dayIndex !== undefined) ? Number(dayIndex) : (_studyDayIndex ?? _selectedDayIndex ?? 0);

    const dayDate = dateOfDay(_weekStartDate, targetDay);
    const daySegments = (_weekData?.segments || []).filter(s => s.date === dayDate);
    const dayTimeline = calculateDayTimelineSlots(dayDate, daySegments, { policy: _policy });
    const emptySlot = dayTimeline.slots.find(s => s.type === 'empty' && s.durationMinutes >= 45);

    let start = '13:00';
    let end = '14:30';
    if (emptySlot) {
        start = emptySlot.startTime;
        const [sh, sm] = start.split(':').map(Number);
        const [eh, em] = emptySlot.endTime.split(':').map(Number);
        const slotDuration = (eh * 60 + em) - (sh * 60 + sm);
        if (slotDuration <= 90) {
            end = emptySlot.endTime;
        } else {
            const endTotalMin = sh * 60 + sm + 90;
            const resH = String(Math.floor(endTotalMin / 60)).padStart(2, '0');
            const resM = String(endTotalMin % 60).padStart(2, '0');
            end = `${resH}:${resM}`;
        }
    }

    if (!openPlanItemModal(targetDay, null, start, end)) return;

    const dutySelect = el('plan-input-main-duty');
    if (dutySelect) {
        dutySelect.value = 'PERENCANAAN';
        populateCatalogDropdownByDuty('PERENCANAAN', 'cat_mgmp');
    }
    const catSelect = el('plan-input-catalog');
    if (catSelect) {
        catSelect.value = 'cat_mgmp';
    }
    selectPlanCatalog('cat_mgmp');
    const titleInput = el('plan-input-title');
    if (titleInput) {
        titleInput.value = 'Kegiatan MGMP / Komunitas Belajar Guru';
    }
    const jpInput = el('plan-input-jp');
    if (jpInput) {
        jpInput.value = '1';
    }
    const descInput = el('plan-input-desc');
    if (descInput) {
        descInput.value = 'Pengembangan Keprofesian Berkelanjutan (PKB) sesuai SE Mendikdasmen No. 5684/2025 tentang Hari Belajar Guru.';
    }
    updatePlannedMinutesPreview();
    onCatalogChange();
}

// ========== INIT ==========
function initWorkloadPage() {
    _weekStartDate = getMondayOfWeek(todayWITA());
    const inp = el('input-week-start-date');
    if (inp) inp.value = _weekStartDate;
    renderWeekRangeLabel();

    window.workloadNavWeek = navWeek;
    window.workloadOnDateChange = onDateChange;
    window.workloadSetCurrentWeek = setCurrentWeek;
    window.workloadManualRefresh = manualRefreshCurrentWeek;
    window.workloadSetupMobileWeekSwipeGesture = setupMobileWeekSwipeGesture;
    window.workloadRetryLoadWeek = () => loadWeek({ useCache: false });
    window.workloadClearWeekCache = (teacherId, week) => {
        if (teacherId && week) _weekCache.delete(teacherId, week);
        else _weekCache.clear();
    };
    window.workloadGetWeekStartDate = () => _weekStartDate;
    window.workloadSwitchTab = switchTab;
    window.workloadSelectTab = switchTab;
    window.workloadRenderStatusBadge = renderStatusBadge;
    window.workloadSubmitPlan = submitPlan;
    window.workloadRenderPlanDutySummary = renderPlanDutySummary;
    window.workloadToggleDutyExpand = toggleDutyExpand;
    window.workloadToggleDutySummaryCollapse = toggleDutySummaryCollapse;
    window.workloadOpenLogModal = openLogModal;
    window.workloadSyncLogStatusOptions = syncLogStatusOptions;
    window.workloadOpenAddUnplannedForSlot = openAddUnplannedForSlot;
    window.workloadOpenEditLogModal = openEditLogModal;
    window.workloadIsLogLockedByManualVerification = isLogLockedByManualVerification;
    window.isLogLockedByManualVerification = isLogLockedByManualVerification;
    window.workloadCloseLogModal = closeLogModal;
    window.workloadSaveLog = saveLog;
    window.workloadClosePlanModal = closePlanModal;
    window.workloadSavePlanItem = savePlanItem;
    window.workloadOnMainDutyChange = onMainDutyChange;
    window.workloadOnCatalogChange = onCatalogChange;
    window.workloadOnLogMainDutyChange = onLogMainDutyChange;
    window.workloadOnLogCatalogChange = onLogCatalogChange;
    window.workloadUpdatePlannedMinutesPreview = updatePlannedMinutesPreview;
    window.workloadUpdateLogMinutesPreview = updateLogMinutesPreview;
    window.workloadOnStatusExecutionChange = onStatusExecutionChange;
    window.workloadApplyTemplateModal = openApplyTemplateModal;
    window.workloadCloseApplyTemplateModal = closeApplyTemplateModal;
    window.workloadConfirmApplyTemplate = confirmApplyTemplate;
    window.workloadSyncScheduleModal = syncScheduleModal;
    window.workloadOnKbmMapelChange = onKbmMapelChange;
    window.workloadOnKbmKelasChange = onKbmKelasChange;
    window.workloadCloseSyncScheduleModal = closeSyncScheduleModal;
    window.workloadConfirmSyncSchedule = confirmSyncSchedule;
    window.workloadOnSyncTeacherChange = onSyncTeacherChange;
    window.workloadToggleSyncItem = toggleSyncItem;
    window.workloadToggleSelectAllSync = toggleSelectAllSync;
    window.workloadSaveAsTemplateModal = saveAsTemplateModal;
    window.workloadOpenNewTemplateModal = openNewTemplateModal;
    window.workloadOpenCreateTemplateModal = openCreateTemplateModal;
    window.workloadCloseCreateTemplateModal = closeCreateTemplateModal;
    window.workloadConfirmSaveTemplate = confirmSaveTemplate;
    window.workloadOpenTemplateDetail = openTemplateDetail;
    window.workloadCloseTemplateDetail = closeTemplateDetail;
    window.workloadFormatDurationToJp = formatDurationToJp;
    window.workloadOpenPlanItemModal = openPlanItemModal;
    window.workloadMarkDayHoliday = markDayHoliday;
    window.workloadMarkDayLeave = openMarkLeaveModal;
    window.workloadCloseLeaveModal = closeLeaveModal;
    window.workloadSubmitMarkLeave = submitMarkLeave;
    window.workloadDeactivateDayLeave = deactivateDayLeave;
    window.workloadOpenUnplannedAbsenceModal = openUnplannedAbsenceModal;
    window.workloadCloseUnplannedAbsenceModal = closeUnplannedAbsenceModal;
    window.workloadSubmitUnplannedAbsence = submitUnplannedAbsence;
    window.workloadCancelUnplannedAbsence = cancelUnplannedAbsence;
    window.workloadDeletePlanItem = deletePlanItem;
    window.workloadDeletePlanItemFromModal = deletePlanItemFromModal;
    window.isPlanSegmentRealized = isPlanSegmentRealized;
    window.renderUnapprovedPlanEmptyState = renderUnapprovedPlanEmptyState;
    window.workloadDeleteLog = deleteLog;
    window.workloadDeleteCurrentLog = deleteCurrentLog;
    window.workloadSelectDay = selectDay;
    window.workloadReloadPolicy = reloadPolicy;
    window.workloadSyncFromJournal = syncFromJournal;
    window.workloadOnFilterPlanCatalog = onFilterPlanCatalog;
    window.workloadOnFilterLogCatalog = onFilterLogCatalog;
    window.workloadApplyQuickDuration = applyQuickDuration;
    window.workloadApplyQuickTitle = applyQuickTitle;
    window.workloadOpenCatalogModal = openCatalogModal;
    window.workloadCloseCatalogModal = closeCatalogModal;
    window.workloadSaveCatalogItem = saveCatalogItem;
    window.workloadToggleCatalogItemActive = toggleCatalogItemActive;
    window.workloadOpenWakaDutyModal = openWakaDutyModal;
    window.workloadCloseWakaDutyModal = closeWakaDutyModal;
    window.workloadSaveWakaDutyItem = saveWakaDutyItem;
    window.workloadToggleWakaDutyActive = toggleWakaDutyActive;
    window.workloadDeleteWakaDutyItem = deleteWakaDutyItem;
    window.workloadSwitchWakaDutyTab = switchWakaDutyTab;
    window.workloadToggleWakaDutyDropdown = toggleWakaDutyDropdown;
    window.workloadOpenWakaDutyDropdown = openWakaDutyDropdown;
    window.workloadCloseWakaDutyDropdown = closeWakaDutyDropdown;
    window.workloadOnFilterWakaDuties = onFilterWakaDuties;
    window.workloadSelectWakaDuty = selectWakaDuty;
    window.workloadToggleLogWakaDutyDropdown = toggleLogWakaDutyDropdown;
    window.workloadOpenLogWakaDutyDropdown = openLogWakaDutyDropdown;
    window.workloadCloseLogWakaDutyDropdown = closeLogWakaDutyDropdown;
    window.workloadOnFilterLogWakaDuties = onFilterLogWakaDuties;
    window.workloadSelectLogWakaDuty = selectLogWakaDuty;
    window.workloadSetStudyDay = setTeacherStudyDay;
    window.workloadQuickAddMgmp = quickAddMgmp;
    window.workloadTogglePlanCatalogDropdown = togglePlanCatalogDropdown;
    window.workloadOpenPlanCatalogDropdown = openPlanCatalogDropdown;
    window.workloadClosePlanCatalogDropdown = closePlanCatalogDropdown;
    window.workloadSelectPlanCatalog = selectPlanCatalog;
    window.workloadResetPlanCatalogSearch = resetPlanCatalogSearch;
    window.workloadTogglePlanMainDutyDropdown = togglePlanMainDutyDropdown;
    window.workloadOpenPlanMainDutyDropdown = openPlanMainDutyDropdown;
    window.workloadClosePlanMainDutyDropdown = closePlanMainDutyDropdown;
    window.workloadSelectPlanMainDuty = selectPlanMainDuty;
    window.workloadRenderPlanMainDutyDropdown = renderPlanMainDutyDropdown;
    window.workloadResolveDutyCode = resolveWorkloadDutyCode;
    window.workloadToggleLogCatalogDropdown = toggleLogCatalogDropdown;
    window.workloadOpenLogCatalogDropdown = openLogCatalogDropdown;
    window.workloadCloseLogCatalogDropdown = closeLogCatalogDropdown;
    window.workloadSelectLogCatalog = selectLogCatalog;
    window.workloadResetLogCatalogSearch = resetLogCatalogSearch;
    window.workloadToggleLogMainDutyDropdown = toggleLogMainDutyDropdown;
    window.workloadOpenLogMainDutyDropdown = openLogMainDutyDropdown;
    window.workloadCloseLogMainDutyDropdown = closeLogMainDutyDropdown;
    window.workloadSelectLogMainDuty = selectLogMainDuty;
    window.workloadRenderLogMainDutyDropdown = renderLogMainDutyDropdown;
    window.autoResizeWorkloadTextarea = autoResizeWorkloadTextarea;
    window.workloadToggleMatrixViewMode = toggleMatrixViewMode;
    window.workloadQuickReportComplete = quickReportComplete;
    window.workloadIsTeachingActivity = isTeachingActivity;
    window.workloadCanReportActivityNow = canReportActivityNow;
    window.workloadOpenEvidence = workloadOpenEvidence;
    window.workloadOpenCurrentEvidence = workloadOpenCurrentEvidence;
    window.workloadSyncEvidenceButtons = workloadSyncEvidenceButtons;
    window.getGoogleDriveThumbnail = getGoogleDriveThumbnail;
    window.sanitizeUrl = sanitizeUrl;
    window.workloadHandlePhotoFilesSelected = handlePhotoFilesSelected;
    window.workloadRemovePhoto = removePhoto;
    window.workloadReorderPhoto = reorderWorkloadPhoto;
    window.workloadUpdatePhotoCaption = workloadUpdatePhotoCaption;
    window.workloadPreviewPhotoInModal = previewPhotoInModal;
    window.workloadSaveLogDraft = saveLogDraft;
    window.workloadOpenLightbox = workloadOpenLightbox;
    window.workloadCloseLightbox = workloadCloseLightbox;
    window.workloadLightboxNext = workloadLightboxNext;
    window.workloadLightboxPrev = workloadLightboxPrev;
    window.workloadSetLightboxIndex = workloadSetLightboxIndex;
    window.workloadOpenLightboxFromLogId = workloadOpenLightboxFromLogId;
    window.parseEvidencePhotos = parseEvidencePhotos;
    window.workloadExportRealizationToWord = exportRealizationToWord;
    window.workloadUpdateRealisasiToolbarVisibility = updateRealisasiToolbarVisibility;
    window.workloadUpdatePlanToolbarVisibility = updatePlanToolbarVisibility;
    window.workloadUpdateRekapToolbarVisibility = updateRekapToolbarVisibility;
    window.workloadCanAccessMonthlyRecap = canAccessMonthlyRecap;
    window.workloadOpenRekapPremiumModal = openRekapPremiumModal;
    window.workloadCloseRekapPremiumModal = closeRekapPremiumModal;
    window.workloadToggleRekapSubCatalog = workloadToggleRekapSubCatalog;
    window.workloadOpenSubActivityReport = workloadOpenSubActivityReport;
    window.workloadOpenSubCatalogReport = workloadOpenSubCatalogReport;
    window.getWorkloadUserRoleInfo = getWorkloadUserRoleInfo;

    window.workloadSetCurrentUserProfile = setCurrentUserProfile;
    window.workloadGetCurrentUserProfile = getCurrentUserProfile;
    window.workloadGetCurrentTeacherDisplayName = getCurrentTeacherDisplayName;
    window.workloadPopulateAdminTeacherDropdown = populateAdminTeacherDropdown;
    window.workloadOnAdminTeacherChange = onAdminTeacherChange;
    window.workloadAdminResetTeacher = adminResetTeacher;
    window.workloadAdminManageTeacher = adminManageTeacher;
    window.workloadGetEffectiveTeacherId = getEffectiveTeacherId;
    window.workloadGetAdminSelectedTeacherId = getAdminSelectedTeacherId;
    window.workloadSetAdminSelectedTeacher = setAdminSelectedTeacher;

    try {
        const savedMode = localStorage.getItem('simas_workload_matrix_view_mode');
        if (savedMode === 'matrix' || savedMode === 'focus') {
            _matrixViewMode = savedMode;
        }
    } catch (e) {}

    if (!window._workloadComboboxListenerAdded) {
        window._workloadComboboxListenerAdded = true;
        document.addEventListener('click', (e) => {
            const planCombobox = el('container-plan-catalog-combobox');
            if (planCombobox && !planCombobox.contains(e.target)) {
                closePlanCatalogDropdown();
            }
            const logCombobox = el('container-log-catalog-combobox');
            if (logCombobox && !logCombobox.contains(e.target)) {
                closeLogCatalogDropdown();
            }
            const wakaCombobox = el('container-plan-waka-duty-picker');
            if (wakaCombobox && !wakaCombobox.contains(e.target)) {
                closeWakaDutyDropdown();
            }
            const logWakaCombobox = el('container-log-waka-duty-picker');
            if (logWakaCombobox && !logWakaCombobox.contains(e.target)) {
                closeLogWakaDutyDropdown();
            }
            const planMainDutyCombobox = el('container-plan-main-duty');
            if (planMainDutyCombobox && !planMainDutyCombobox.contains(e.target)) {
                closePlanMainDutyDropdown();
            }
            const logMainDutyCombobox = el('container-log-main-duty');
            if (logMainDutyCombobox && !logMainDutyCombobox.contains(e.target)) {
                closeLogMainDutyDropdown();
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closePlanCatalogDropdown();
                closeLogCatalogDropdown();
                closeWakaDutyDropdown();
                closeLogWakaDutyDropdown();
                closePlanMainDutyDropdown();
                closeLogMainDutyDropdown();
            }
        });
    }

    // Catatan: Auto-refresh 25s pada visibility/focus ditiadakan agar tidak menginterupsi pengguna saat berpindah tab.
    // Pembaruan data server secara riil dilakukan melalui tombol manual refresh (#btn-refresh-week).

    setupMobileWeekSwipeGesture();
    renderStatusBadge();

    let hasLoaded = false;
    if (auth && typeof auth.onAuthStateChanged === 'function') {
        if (auth.currentUser) {
            hasLoaded = true;
            loadAll().catch(() => {});
        }
        auth.onAuthStateChanged((user) => {
            if (user) {
                hasLoaded = true;
                loadAll().catch(() => {});
            } else {
                _weekCache.clear();
                if (typeof window.monitoringClearCache === 'function') window.monitoringClearCache();
                _dutySummaryManualCollapse = null;
            }
        });
    } else {
        loadAll();
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWorkloadPage);
} else {
    initWorkloadPage();
}

async function loadAll() {
    try {
        if (!_currentUserProfile && typeof window.getCurrentUserDoc === 'function') {
            window.getCurrentUserDoc().then(p => {
                if (p) _currentUserProfile = p;
            }).catch(() => {});
        }

        const isMgr = isCurrentUserWorkloadManager();
        const [catRes, policyRes] = await Promise.all([
            cfGetWorkloadCatalog(isMgr).catch(err => {
                console.warn('[Beban Kerja] cfGetWorkloadCatalog gagal, gunakan fallback lokal:', err?.message || err);
                return null;
            }),
            cfGetWorkloadPolicy().catch(err => {
                console.warn('[Beban Kerja] cfGetWorkloadPolicy gagal:', err?.message || err);
                return null;
            })
        ]);

        if (catRes) {
            let serverCatalog = Array.isArray(catRes) ? catRes : (catRes?.data || []);
            if (serverCatalog.length > 0) {
                serverCatalog = serverCatalog.map(it => ({
                    ...it,
                    description: (it.description || '').replace(/\s*\([Ee]kuivalensi[^)]*\)/g, '').trim()
                }));
                _catalog = serverCatalog;
                setCachedWorkloadCatalog(serverCatalog);
                refreshOpenModalCatalogIfActive();
            }
        }
        if (policyRes?.data?.policy) {
            _policy = policyRes.data.policy;
        }

        if (isMgr) {
            // Supervisor: populasikan dropdown guru jika cache masih kosong
            if (!_adminTeachersCache || _adminTeachersCache.length === 0) {
                try {
                    const monRes = await cfGetWorkloadMonitoringSummary(_weekStartDate);
                    const teachers = monRes?.data?.teachers || monRes?.data?.summary || [];
                    if (Array.isArray(teachers) && teachers.length > 0) {
                        populateAdminTeacherDropdown(teachers);
                    }
                } catch (e) {
                    console.warn('[Beban Kerja] Gagal memuat daftar guru monitoring:', e.message);
                }
            }
        }

        try {
            _assignments = await cfGetWorkloadAssignments(getEffectiveTeacherId());
        } catch (e) {
            console.warn('[Beban Kerja] Gagal memuat assignments:', e.message);
        }
        try {
            _templates = await cfGetWorkloadTemplates();
        } catch (e) {
            console.warn('[Beban Kerja] Gagal memuat templates:', e.message);
        }
    } catch (e) {
        console.warn('[Beban Kerja] Gagal memuat data awal:', e.message);
    }
    await loadWeek();
    // Warm-up cache jadwal aSc Timetables di latar belakang agar respon instan (0 delay) saat modal sinkronisasi dibuka
    try {
        getAllScheduleTeachers().catch(() => {});
    } catch (_) {}
}

function refreshOpenModalCatalogIfActive() {
    const planModal = el('modal-plan-item');
    if (planModal && !planModal.classList.contains('hidden')) {
        const dutySelect = el('plan-input-main-duty');
        const catSelect = el('plan-input-catalog');
        const selectedDuty = dutySelect?.value || 'PELAKSANAAN_KBM';
        const selectedCat = catSelect?.value || null;
        populateCatalogDropdownByDuty(selectedDuty, selectedCat);
    }

    const logModal = el('modal-workload-log');
    if (logModal && !logModal.classList.contains('hidden')) {
        const dutySelect = el('log-input-main-duty');
        const catSelect = el('log-input-catalog');
        const selectedDuty = dutySelect?.value || 'PELAKSANAAN_KBM';
        const selectedCat = catSelect?.value || null;
        populateLogCatalogDropdownByDuty(selectedDuty, selectedCat);
    }
}

// ========== SWR CACHE & VISUAL LOADING HELPERS ==========
function computeWeekFingerprint(data) {
    if (!data) return '';
    const vId = data.active_version?.id || '';
    const vStatus = data.active_version?.status || '';
    const vUpdated = data.active_version?.updated_at || '';
    const segCount = (data.segments || []).length;
    const logCount = (data.logs || []).length;
    const studyDay = data.study_day || '';
    return `${vId}:${vStatus}:${vUpdated}:${segCount}:${logCount}:${studyDay}`;
}

function setWorkspaceLoadingState(isLoading, message = 'Memuat data pekan...') {
    const panels = [
        el('tab-content-today'),
        el('tab-content-plan'),
        el('tab-content-rekap')
    ].filter(Boolean);

    const pill = el('workload-floating-loading-pill');
    const pillText = el('workload-floating-loading-text');
    const statusBadge = el('badge-plan-status');

    if (isLoading) {
        panels.forEach(p => {
            p.classList.add('opacity-40', 'pointer-events-none', 'select-none');
            p.setAttribute('aria-busy', 'true');
        });
        if (pill) {
            if (pillText) pillText.textContent = message;
            pill.classList.remove('hidden');
        }
        if (statusBadge) {
            statusBadge.className = 'inline-flex items-center justify-center px-2 py-0.5 md:px-2.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-400 text-slate-900 shadow-xs';
            statusBadge.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-[10px] md:mr-1 motion-reduce:animate-none"></i><span class="hidden md:inline">Memuat...</span>';
            statusBadge.title = message;
        }
    } else {
        panels.forEach(p => {
            p.classList.remove('opacity-40', 'pointer-events-none', 'select-none');
            p.removeAttribute('aria-busy');
        });
        if (pill) pill.classList.add('hidden');
    }
}

function renderWeekError(errorMessage) {
    const todayTimeline = el('today-timeline-container');
    const planAccordion = el('weekly-plan-accordion');
    const safeMsg = escapeHTML(errorMessage || 'Gagal memuat data pekan dari server.');

    const errorHtml = `
        <div class="p-6 sm:p-8 rounded-2xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-center space-y-3 my-4">
            <div class="w-12 h-12 mx-auto rounded-xl bg-rose-100 dark:bg-rose-900/60 text-rose-600 dark:text-rose-400 flex items-center justify-center text-xl">
                <i class="fa-solid fa-triangle-exclamation"></i>
            </div>
            <h4 class="text-sm font-bold text-rose-900 dark:text-rose-200">Gagal Memuat Data Pekan</h4>
            <p class="text-xs text-rose-700 dark:text-rose-300 max-w-md mx-auto font-medium leading-relaxed">${safeMsg}</p>
            <button type="button" onclick="window.workloadRetryLoadWeek()" class="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition-all active:scale-95 shadow-sm inline-flex items-center gap-1.5 cursor-pointer">
                <i class="fa-solid fa-arrows-rotate"></i> <span>Coba Lagi</span>
            </button>
        </div>
    `;

    if (todayTimeline) todayTimeline.innerHTML = errorHtml;
    if (planAccordion) planAccordion.innerHTML = errorHtml;
}

function scheduleWeekLoad() {
    _dutySummaryManualCollapse = null;
    const effectiveTeacherId = getEffectiveTeacherId();
    // Jika cache sudah tersedia, render instan (0ms) tanpa menunggu debounce!
    if (_weekCache.has(effectiveTeacherId, _weekStartDate)) {
        if (_weekDebounceTimer) {
            clearTimeout(_weekDebounceTimer);
            _weekDebounceTimer = null;
        }
        loadWeek({ useCache: true });
        return;
    }

    // Jika belum ada di cache, redupkan area kerja langsung agar user tahu sistem merespon klik
    setWorkspaceLoadingState(true, 'Memuat data pekan...');

    if (_weekDebounceTimer) {
        clearTimeout(_weekDebounceTimer);
    }
    _weekDebounceTimer = setTimeout(() => {
        _weekDebounceTimer = null;
        loadWeek({ useCache: true });
    }, 180);
}

async function loadWeek(opts = {}) {
    const useCache = opts.useCache === true;
    const silent = opts.silent === true;
    const isMgr = isCurrentUserWorkloadManager();
    const effectiveTeacherId = getEffectiveTeacherId();

    if (isMgr && !effectiveTeacherId) {
        _weekData = null;
        _weekLoadError = null;
        setWorkspaceLoadingState(false);
        renderAll();
        return;
    }

    // 1. Cek cache in-memory jika pemanggilan mengizinkan cache
    if (useCache && !silent) {
        const cached = _weekCache.get(effectiveTeacherId, _weekStartDate);
        if (cached) {
            _weekData = cached.data;
            _weekLoadError = null;
            setWorkspaceLoadingState(false);
            renderAll();
            return;
        }
    }

    // 2. Tampilkan indikator loading jika bukan revalidasi senyap
    if (!silent) {
        setWorkspaceLoadingState(true, 'Memuat data pekan...');
    }

    // 3. Batalkan request lama yang masih berjalan & catat sequence
    if (_weekAbortController) {
        try { _weekAbortController.abort(); } catch (_) {}
    }
    _weekAbortController = new AbortController();
    const currentSeq = ++_loadWeekSeq;
    _isLoadingWeek = true;

    try {
        const endOfWeekDate = _weekStartDate ? dateOfDay(_weekStartDate, 4) : null;

        // Paralelisasi simultan: fetch data minggu & hari libur
        const [weekRes, holRes] = await Promise.allSettled([
            cfGetWorkloadWeek(effectiveTeacherId, _weekStartDate, { signal: _weekAbortController.signal }),
            _weekStartDate ? fetchRegisteredHolidays(_weekStartDate, endOfWeekDate) : Promise.resolve()
        ]);

        // Guard sequence: abaikan jika ada request baru yang lebih mutakhir
        if (currentSeq !== _loadWeekSeq) return;

        if (weekRes.status === 'fulfilled') {
            const freshData = weekRes.value?.data || null;

            if (silent) {
                // Saat revalidasi senyap, hanya render ulang jika ada perubahan data riil
                const oldFp = computeWeekFingerprint(_weekData);
                const newFp = computeWeekFingerprint(freshData);
                _weekData = freshData;
                _weekCache.set(effectiveTeacherId, _weekStartDate, _weekData);
                if (oldFp !== newFp) {
                    renderAll();
                }
            } else {
                _weekData = freshData;
                _weekLoadError = null;
                _weekCache.set(effectiveTeacherId, _weekStartDate, _weekData);

                // Auto-Healing Hari Libur Resmi: Deteksi apakah ada rencana tersimpan di hari libur resmi yang baru ditetapkan
                const activeVer = _weekData?.active_version;
                if (activeVer && _weekData?.week?.id && !_weekData.week.is_locked) {
                    const weekHolidayDates = [];
                    for (let d = 0; d < 5; d++) {
                        const dStr = dateOfDay(_weekStartDate, d);
                        if (isOfficialHolidayForPlanCleanup(dStr)) {
                            weekHolidayDates.push(dStr);
                        }
                    }

                    if (weekHolidayDates.length > 0) {
                        const ghostHols = (_weekData?.segments || []).filter(s =>
                            weekHolidayDates.includes(s.date) &&
                            !s.has_realized_log &&
                            (s.has_log === undefined || s.has_log === 0) &&
                            !s.is_leave &&
                            s.catalog_id !== 'cat_cuti_izin' &&
                            s.catalog_id !== 'cat_libur'
                        );

                        if (ghostHols.length > 0) {
                            try {
                                const cleanRes = await cfCleanWorkloadHolidayDrafts({
                                    work_week_id: _weekData.week.id,
                                    plan_version_id: activeVer.id,
                                    holiday_dates: weekHolidayDates
                                });
                                if (cleanRes?.data?.removed_count > 0 && currentSeq === _loadWeekSeq) {
                                    const ghostIds = new Set(ghostHols.map(s => s.id));
                                    _weekData.segments = (_weekData.segments || []).filter(s => !ghostIds.has(s.id));
                                    if (cleanRes.data.total_planned_minutes !== undefined) {
                                        activeVer.total_planned_minutes = cleanRes.data.total_planned_minutes;
                                    }
                                    _weekCache.set(effectiveTeacherId, _weekStartDate, _weekData);
                                    showToast(`✓ Pekan ini mendeteksi hari libur resmi. ${cleanRes.data.removed_count} kegiatan rencana pada hari libur telah ditiadakan otomatis.`, 'info');
                                }
                            } catch (cleanErr) {
                                console.warn('[HolidaySelfHealing] Gagal membersihkan rencana hari libur:', cleanErr);
                            }
                        }
                    }
                }

                // Auto-Healing Senyap: Jika versi draf memuat jadwal duplikat/bentrok, selaraskan otomatis di latar belakang
                if (activeVer && ['draft', 'needs_revision'].includes(activeVer.status) && _weekData?.week?.id) {
                    if (_autoCleanedVersionId !== activeVer.id) {
                        const segs = _weekData?.segments || [];
                        const hasConflict = !validateNoOverlap(segs).isValid;
                        if (hasConflict) {
                            _autoCleanedVersionId = activeVer.id;
                            try {
                                const dedupRes = await cfDeduplicateWorkloadPlan({
                                    work_week_id: _weekData.week.id,
                                    plan_version_id: activeVer.id
                                });
                                if (dedupRes?.data?.removed_count > 0) {
                                    const refreshed = await cfGetWorkloadWeek(effectiveTeacherId, _weekStartDate);
                                    if (currentSeq === _loadWeekSeq) {
                                        _weekData = refreshed?.data || _weekData;
                                        _weekCache.set(effectiveTeacherId, _weekStartDate, _weekData);
                                        showToast(`✓ Sistem menyelaraskan ${dedupRes.data.removed_count} kegiatan duplikat secara otomatis.`, 'info');
                                    }
                                }
                            } catch (dedupErr) {
                                console.warn('[AutoDedup] Silent dedup error:', dedupErr);
                            }
                        }
                    }
                }

                setWorkspaceLoadingState(false);
                renderAll();
            }
        } else {
            const err = weekRes.reason;
            if (err?.name === 'AbortError' || err?.message?.includes('aborted')) {
                // Request dibatalkan oleh navigasi baru, abaikan
                return;
            }
            if (!silent) {
                console.warn('[Beban Kerja] Gagal memuat data minggu:', err?.message);
                _weekData = null;
                _weekLoadError = err?.message || 'Gagal memuat data pekan dari server.';
                setWorkspaceLoadingState(false);
                renderAll();
                renderWeekError(_weekLoadError);
            }
        }
    } catch (e) {
        if (currentSeq !== _loadWeekSeq) return;
        if (!silent) {
            console.warn('[Beban Kerja] Uncaught error saat loadWeek:', e);
            _weekData = null;
            _weekLoadError = e?.message || 'Gagal memuat data pekan.';
            setWorkspaceLoadingState(false);
            renderAll();
            renderWeekError(_weekLoadError);
        }
    } finally {
        if (currentSeq === _loadWeekSeq) {
            _isLoadingWeek = false;
        }
    }
}

// ========== NAVIGATION & MOBILE ERGONOMICS ==========
function triggerNavHapticFeedback() {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
            navigator.vibrate(10);
        } catch (_) {}
    }
}

function navWeek(dir) {
    triggerNavHapticFeedback();
    const d = new Date(_weekStartDate);
    d.setDate(d.getDate() + dir * 7);
    _weekStartDate = d.toISOString().slice(0, 10);
    const inp = el('input-week-start-date');
    if (inp) inp.value = _weekStartDate;
    renderWeekRangeLabel();
    scheduleWeekLoad();
    if (typeof window.monitoringSetWeek === 'function') {
        window.monitoringSetWeek(_weekStartDate);
    }
}

function onDateChange() {
    const inp = el('input-week-start-date');
    if (!inp || !inp.value) return;
    _weekStartDate = getMondayOfWeek(inp.value);
    inp.value = _weekStartDate;
    renderWeekRangeLabel();
    scheduleWeekLoad();
    if (typeof window.monitoringSetWeek === 'function') {
        window.monitoringSetWeek(_weekStartDate);
    }
}

function setCurrentWeek() {
    triggerNavHapticFeedback();
    _weekStartDate = getMondayOfWeek(todayWITA());
    const inp = el('input-week-start-date');
    if (inp) inp.value = _weekStartDate;
    renderWeekRangeLabel();
    scheduleWeekLoad();
    if (typeof window.monitoringSetWeek === 'function') {
        window.monitoringSetWeek(_weekStartDate);
    }
}

async function manualRefreshCurrentWeek() {
    if (_isLoadingWeek) return;
    const btn = el('btn-refresh-week');
    const icon = btn ? btn.querySelector('i') : null;
    if (icon) icon.classList.add('fa-spin');
    if (btn) btn.disabled = true;

    try {
        const effectiveTeacherId = getEffectiveTeacherId();
        if (effectiveTeacherId && _weekStartDate) {
            _weekCache.delete(effectiveTeacherId, _weekStartDate);
        }
        await loadWeek({ useCache: false });
        if (typeof showToast === 'function') {
            showToast('✓ Data pekan berhasil diperbarui dari server.', 'success');
        } else if (typeof window.showToast === 'function') {
            window.showToast('✓ Data pekan berhasil diperbarui dari server.', 'success');
        }
    } catch (e) {
        const err = e?.message || 'Gagal menyegarkan data pekan.';
        if (typeof showToast === 'function') {
            showToast(err, 'error');
        } else if (typeof window.showToast === 'function') {
            window.showToast(err, 'error');
        }
    } finally {
        if (icon) icon.classList.remove('fa-spin');
        if (btn) btn.disabled = false;
    }
}

/**
 * Inisialisasi gestur usap horizontal (swipe left/right) pada perangkat HP/mobile
 * Memungkinkan navigasi antar-minggu secara intuitif dan terlindung dari konflik modal/form/scroll.
 */
function setupMobileWeekSwipeGesture() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (window._workloadWeekSwipeListenerAdded) return;
    window._workloadWeekSwipeListenerAdded = true;

    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;
    let isSwipeIgnored = false;

    const shouldIgnoreTouch = (target) => {
        if (!target || typeof target.closest !== 'function') return false;
        // 1. Elemen interaktif, formulir & tombol
        if (target.closest('input, textarea, select, button, a, label, [role="button"]')) return true;
        // 2. Modal dialog atau popup overlay
        if (target.closest('.modal, [role="dialog"], #modal-plan-item, #modal-log-item, #modal-sync-schedule, #modal-manage-template, #modal-apply-template, #modal-leave, #modal-unplanned-absence, #modal-rekap-preview, #lightbox-overlay')) return true;
        // 3. Kontainer scrollable horizontal (tabel, timeline, tab picker)
        if (target.closest('.overflow-x-auto, [data-prevent-week-swipe="true"], #workload-day-tabs-container, #header-week-nav-container')) return true;
        return false;
    };

    document.addEventListener('touchstart', (e) => {
        if (!e.touches || e.touches.length !== 1) {
            isSwipeIgnored = true;
            return;
        }
        const touch = e.touches[0];
        isSwipeIgnored = shouldIgnoreTouch(e.target);
        if (isSwipeIgnored) return;

        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        touchStartTime = Date.now();
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
        if (isSwipeIgnored) return;
        if (!e.changedTouches || e.changedTouches.length !== 1) return;

        const touch = e.changedTouches[0];
        const deltaX = touch.clientX - touchStartX;
        const deltaY = touch.clientY - touchStartY;
        const elapsedMs = Date.now() - touchStartTime;

        const evaluation = evaluateWeekSwipeGesture(deltaX, deltaY, elapsedMs);
        if (evaluation.isValid) {
            if (evaluation.direction === 'next') {
                navWeek(1);
            } else if (evaluation.direction === 'prev') {
                navWeek(-1);
            }
        }
    }, { passive: true });
}

// ========== REALISASI TOOLBAR VISIBILITY HELPER ==========
export function updateRealisasiToolbarVisibility() {
    const realisasiToolbar = el('tab-realisasi-toolbar');
    if (!realisasiToolbar) return;
    const isMgr = isCurrentUserWorkloadManager();
    const hasSelectedTeacher = !!_adminSelectedTeacherId;
    const isPlanApproved = (_weekData?.active_version?.status === 'approved');
    const shouldShow = (_activeTab === 'tab-today') && (!isMgr || hasSelectedTeacher) && isPlanApproved;
    if (shouldShow) {
        realisasiToolbar.classList.add('hidden', 'md:flex');
        realisasiToolbar.classList.remove('!hidden', 'flex');
        realisasiToolbar.style.display = '';
    } else {
        realisasiToolbar.classList.add('hidden', '!hidden');
        realisasiToolbar.classList.remove('md:flex', 'flex');
        realisasiToolbar.style.display = 'none';
    }
}

// ========== PLAN TOOLBAR VISIBILITY HELPER ==========
export function updatePlanToolbarVisibility() {
    const planToolbar = el('tab-plan-toolbar');
    const isMgr = isCurrentUserWorkloadManager();
    const hasSelectedTeacher = !!_adminSelectedTeacherId;
    const shouldShow = (_activeTab === 'tab-plan') && (!isMgr || hasSelectedTeacher);
    if (planToolbar) {
        if (shouldShow) {
            planToolbar.classList.add('hidden', 'sm:flex');
            planToolbar.classList.remove('!hidden', 'flex');
            planToolbar.style.display = '';
        } else {
            planToolbar.classList.add('hidden', '!hidden');
            planToolbar.classList.remove('flex', 'sm:flex');
            planToolbar.style.display = 'none';
        }

        // Proteksi: Jika rencana kerja minggu ini sudah pernah difinalisasi (atau non-draft), sembunyikan tombol Terapkan Template
        const ver = _weekData?.active_version;
        const hasBeenFinalized = !!(ver && (ver.submitted_at || ['approved', 'submitted', 'needs_revision'].includes(ver.status)));
        const btnApplyTemplate = el('btn-apply-template') || planToolbar.querySelector('button[onclick*="workloadApplyTemplateModal"]');
        if (btnApplyTemplate) {
            if (hasBeenFinalized) {
                btnApplyTemplate.classList.add('hidden', '!hidden');
                btnApplyTemplate.style.display = 'none';
            } else {
                btnApplyTemplate.classList.remove('hidden', '!hidden');
                btnApplyTemplate.style.display = '';
            }
        }
    }
    updateSubmitButton();
}

// ========== MONITORING TOOLBAR VISIBILITY HELPER ==========
export function updateMonitoringToolbarVisibility() {
    const monitoringToolbar = el('tab-monitoring-toolbar');
    if (!monitoringToolbar) return;
    const shouldShow = (_activeTab === 'tab-monitoring');
    if (shouldShow) {
        monitoringToolbar.classList.remove('hidden', '!hidden');
        monitoringToolbar.classList.add('flex');
        monitoringToolbar.style.display = '';
    } else {
        monitoringToolbar.classList.add('hidden', '!hidden');
        monitoringToolbar.classList.remove('flex');
        monitoringToolbar.style.display = 'none';
    }
}

// ========== REKAP TOOLBAR VISIBILITY HELPER ==========
export function updateRekapToolbarVisibility() {
    const rekapToolbar = el('tab-rekap-toolbar');
    if (!rekapToolbar) return;
    const isMgr = isCurrentUserWorkloadManager();
    const hasSelectedTeacher = !!_adminSelectedTeacherId;
    const shouldShow = (_activeTab === 'tab-rekap') && (!isMgr || hasSelectedTeacher);
    if (shouldShow) {
        rekapToolbar.classList.remove('hidden', '!hidden');
        rekapToolbar.classList.add('flex');
        rekapToolbar.style.display = '';
    } else {
        rekapToolbar.classList.add('hidden', '!hidden');
        rekapToolbar.classList.remove('flex');
        rekapToolbar.style.display = 'none';
    }
}

// ========== KONTROL AKSES REKAP REALISASI BULANAN (VIP PREVIEW) ==========
export function canAccessMonthlyRecap() {
    const { isKepalaSekolah, isSuperAdmin } = getWorkloadUserRoleInfo();
    if (isKepalaSekolah || isSuperAdmin) return true;
    if (_policy?.can_access_vip === true) return true;
    if (Array.isArray(_policy?.vip_teacher_ids) && _policy.vip_teacher_ids.length > 0) {
        const myTeacherId = getEffectiveTeacherId() || _weekData?.week?.teacher_id || _weekData?.teacher_id || _currentUserProfile?.linkedTeacherId || _currentUserProfile?.teacher_id;
        const myUid = auth?.currentUser?.uid;
        if (myTeacherId && _policy.vip_teacher_ids.includes(myTeacherId)) return true;
        if (myUid && _policy.vip_teacher_ids.includes(myUid)) return true;
    }
    return false;
}

export function openRekapPremiumModal() {
    const modal = el('modal-rekap-premium-notice');
    if (modal) {
        modal.classList.remove('hidden');
    } else {
        showToast('SIMAS VIP', 'Modul Rekapitulasi Realisasi merupakan fitur eksklusif SIMAS VIP dan belum dibuka untuk umum.', 'info');
    }
}

export function closeRekapPremiumModal() {
    const modal = el('modal-rekap-premium-notice');
    if (modal) modal.classList.add('hidden');
}

// ========== TABS ==========
function switchTab(tabId) {
    const { isKepalaSekolah, isSuperAdmin } = getWorkloadUserRoleInfo();
    if ((isKepalaSekolah || isSuperAdmin) && tabId === 'tab-templates') {
        tabId = 'tab-monitoring';
    }
    // Batasan Akses Sementara: Tab Rekap Realisasi hanya dapat diakses oleh Super Admin & Kepala Sekolah
    if (tabId === 'tab-rekap' && !canAccessMonthlyRecap()) {
        openRekapPremiumModal();
        return;
    }
    _activeTab = tabId;
    document.querySelectorAll('.tab-workload-panel').forEach(p => p.classList.add('hidden'));
    document.querySelectorAll('.tab-workload-btn').forEach(b => {
        b.classList.remove('border-emerald-600', 'text-emerald-600', 'dark:text-emerald-400');
        b.classList.add('border-transparent', 'text-slate-500');
    });
    const panel = el(`tab-content-${tabId.replace('tab-', '')}`);
    if (panel) panel.classList.remove('hidden');
    const btn = el(`tab-btn-${tabId.replace('tab-', '')}`);
    if (btn) {
        btn.classList.add('border-emerald-600', 'text-emerald-600', 'dark:text-emerald-400');
        btn.classList.remove('border-transparent', 'text-slate-500');
    }

    const isMgr = isCurrentUserWorkloadManager();
    const hasSelectedTeacher = !!_adminSelectedTeacherId;

    updateRealisasiToolbarVisibility();
    updatePlanToolbarVisibility();
    updateMonitoringToolbarVisibility();
    updateRekapToolbarVisibility();

    const kpiStrip = el('kpi-summary-strip');
    if (kpiStrip) {
        if (tabId === 'tab-today' && (!isMgr || hasSelectedTeacher)) {
            kpiStrip.classList.remove('hidden');
        } else {
            kpiStrip.classList.add('hidden');
        }
    }

    if (tabId === 'tab-templates') renderTemplatesTab();
    if (tabId === 'tab-regulasi') renderRegulasiTab();
    if (tabId === 'tab-plan') renderPlanTab();
    if (tabId === 'tab-today') renderTodayTab();
    if (tabId === 'tab-rekap') renderRekapTab();
    if (tabId === 'tab-monitoring') {
        if (typeof window.monitoringSetWeek === 'function') {
            window.monitoringSetWeek(_weekStartDate, true);
        } else if (typeof window.monitoringLoadSummary === 'function') {
            window.monitoringLoadSummary();
        }
    }
}

// ========== RENDER ALL ==========
function renderAll() {
    renderWeekRangeLabel();
    renderKPI();
    renderStatusBadge();
    renderRevisionAlert();
    determineTeacherStudyDay();
    renderDaySelector();
    renderTodayTab();
    renderPlanTab();
    renderTemplatesTab();
    renderRegulasiTab();
    if (_activeTab === 'tab-rekap') renderRekapTab();
    updateSubmitButton();
    updateRealisasiToolbarVisibility();
    updatePlanToolbarVisibility();
    updateMonitoringToolbarVisibility();
    updateRekapToolbarVisibility();
}

// ========== KPI CARDS ==========
function renderKPI() {
    const summary = _weekData?.summary || {};
    const segments = _weekData?.segments || [];
    const adjustedTargetObj = calculateAdjustedWeeklyTarget(_weekStartDate, segments, {
        policy: _policy,
        isHolidayFn: (d) => isHolidayDate(d),
        getHolidayInfoFn: (d) => getHolidayDateInfo(d)
    });
    const target = (_weekData?.week?.target_minutes && _weekData.week.target_minutes !== 2250)
        ? _weekData.week.target_minutes
        : adjustedTargetObj.adjustedTargetMinutes;

    const planned = summary.planned_minutes || 0;
    const actual = summary.actual_minutes || 0;
    const verified = summary.verified_minutes || 0;

    const targetFormatted = target.toLocaleString('id-ID');
    const elPlannedTarget = el('kpi-planned-target-label');
    if (elPlannedTarget) {
        elPlannedTarget.textContent = `/ ${targetFormatted} m`;
        if (adjustedTargetObj.holidayCount > 0) {
            elPlannedTarget.title = `Target disesuaikan: ${adjustedTargetObj.effectiveWorkDaysCount} hari kerja (${adjustedTargetObj.holidayCount} hari libur: ${adjustedTargetObj.holidayDates.map(h => h.title).join(', ')})`;
        } else {
            elPlannedTarget.title = 'Target standar: 5 hari kerja (37,5 jam)';
        }
    }
    const elActualTarget = el('kpi-actual-target-label');
    if (elActualTarget) {
        elActualTarget.textContent = `/ ${targetFormatted} m`;
        if (adjustedTargetObj.holidayCount > 0) {
            elActualTarget.title = `Target disesuaikan: ${adjustedTargetObj.effectiveWorkDaysCount} hari kerja (${adjustedTargetObj.holidayCount} hari libur: ${adjustedTargetObj.holidayDates.map(h => h.title).join(', ')})`;
        } else {
            elActualTarget.title = 'Target standar: 5 hari kerja (37,5 jam)';
        }
    }

    const plannedPct = target > 0 ? Math.min(100, Math.round(planned / target * 100)) : 100;
    const elPlanned = el('kpi-planned-minutes');
    if (elPlanned) elPlanned.textContent = planned.toLocaleString('id-ID');
    const barPlanned = el('bar-planned-progress');
    if (barPlanned) barPlanned.style.width = `${plannedPct}%`;
    const elPlannedPctLabel = el('kpi-planned-pct-label');
    if (elPlannedPctLabel) elPlannedPctLabel.textContent = `${plannedPct}%`;

    const actualPct = target > 0 ? Math.min(100, Math.round(actual / target * 100)) : 100;
    const elActual = el('kpi-actual-minutes');
    if (elActual) elActual.textContent = actual.toLocaleString('id-ID');
    const elActualPct = el('kpi-actual-pct');
    if (elActualPct) elActualPct.textContent = `${actualPct}%`;

    const elVerified = el('kpi-verified-minutes');
    if (elVerified) elVerified.textContent = verified.toLocaleString('id-ID');
    const elVerifiedStatus = el('kpi-verified-status');
    if (elVerifiedStatus) {
        if (verified > 0) {
            const verPct = target > 0 ? Math.round(verified / target * 100) : 100;
            elVerifiedStatus.textContent = `${verified.toLocaleString('id-ID')}m diverifikasi (${verPct}%)`;
            elVerifiedStatus.className = 'font-bold text-emerald-600 dark:text-emerald-400';
        } else {
            elVerifiedStatus.textContent = 'Belum diverifikasi';
            elVerifiedStatus.className = 'font-medium text-slate-500 dark:text-slate-400';
        }
    }

    // Hitung JP KBM dan Ekuivalensi
    let teachingJP = 0;
    segments.forEach(s => { if (s.is_teaching) teachingJP += (s.jp_count || 0); });
    let equivalentJP = 0;
    (_assignments || []).forEach(a => { if (a.is_active) equivalentJP += (a.equivalent_jp || 0); });
    // Pasal 17: Jika tatap muka riil >= 24 JP, ekuivalensi = 0
    if (teachingJP >= 24) equivalentJP = 0;

    const elTeachingJP = el('kpi-teaching-jp');
    if (elTeachingJP) elTeachingJP.textContent = teachingJP;
    const elEqBadge = el('kpi-equivalent-jp-badge');
    if (elEqBadge) elEqBadge.textContent = `+${equivalentJP} JP-Eq`;

    const elTeachingStatus = el('kpi-teaching-status');
    if (elTeachingStatus) {
        if (isCurrentTeacherBk()) {
            elTeachingStatus.innerHTML = '<span class="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1"><i class="fa-solid fa-circle-check"></i>Jalur Guru BK (Pasal 13: Membimbing minimal 5 rombel)</span>';
            if (elEqBadge) elEqBadge.textContent = 'BK';
        } else {
            const totalEffectiveJP = teachingJP + equivalentJP;
            if (totalEffectiveJP >= 24) {
                elTeachingStatus.innerHTML = '<span class="text-emerald-600 dark:text-emerald-400 font-semibold"><i class="fa-solid fa-check mr-1"></i>Target 24 JP terpenuhi</span>';
            } else {
                const def = 24 - totalEffectiveJP;
                elTeachingStatus.textContent = `Kurang ${def} JP untuk memenuhi 24 JP`;
            }
        }
    }
}

// ========== STATUS BADGE ==========
export function renderStatusBadge() {
    const badge = el('badge-plan-status');
    if (!badge) return;

    // Perlakuan Khusus untuk Kepala Sekolah dan Super Admin (Pimpinan / Supervisor)
    const { isKepalaSekolah, isSuperAdmin, role } = getWorkloadUserRoleInfo();
    const isMgr = isKepalaSekolah || isSuperAdmin;
    if (isMgr && !_adminSelectedTeacherId) {
        if (role === 'kepala_sekolah' || (isKepalaSekolah && !isSuperAdmin)) {
            badge.title = 'Kepala Sekolah';
            badge.setAttribute('aria-label', 'Kepala Sekolah');
            badge.innerHTML = '<i class="fa-solid fa-user-tie text-[10px] md:mr-1"></i><span class="hidden md:inline">Kepala Sekolah</span>';
            badge.className = 'inline-flex items-center justify-center px-2 py-0.5 md:px-2.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-purple-600 text-white shadow-xs';
            return;
        }
        badge.title = 'Super Admin';
        badge.setAttribute('aria-label', 'Super Admin');
        badge.innerHTML = '<i class="fa-solid fa-shield-halved text-[10px] md:mr-1"></i><span class="hidden md:inline">Super Admin</span>';
        badge.className = 'inline-flex items-center justify-center px-2 py-0.5 md:px-2.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-indigo-600 text-white shadow-xs';
        return;
    }

    const ver = _weekData?.active_version;
    if (!_weekData?.initialized) {
        badge.title = 'Belum Diinisialisasi';
        badge.setAttribute('aria-label', 'Belum Diinisialisasi');
        badge.innerHTML = '<i class="fa-solid fa-hourglass-start text-[10px] md:mr-1"></i><span class="hidden md:inline">Belum Diinisialisasi</span>';
        badge.className = 'inline-flex items-center justify-center px-2 py-0.5 md:px-2.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-slate-400 text-white shadow-xs';
        return;
    }
    const isAutoPolicy = _policy ? Number(_policy.require_plan_approval) === 0 : false;
    const isAutoApproved = isAutoPolicy || (ver?.status === 'approved' && ver?.approved_by_uid === 'system_auto_approval');
    const approvedText = isAutoApproved ? 'Disetujui Otomatis' : 'Disetujui Kepsek';
    const approvedIcon = isAutoApproved ? 'fa-solid fa-bolt' : 'fa-solid fa-circle-check';
    const statusMap = {
        'draft': { text: 'Draft', icon: 'fa-solid fa-pen-ruler', cls: 'bg-amber-400 text-slate-900' },
        'submitted': { 
            text: isAutoApproved ? 'Disetujui Otomatis' : 'Menunggu Persetujuan', 
            icon: isAutoApproved ? 'fa-solid fa-bolt' : 'fa-solid fa-clock', 
            cls: isAutoApproved ? 'bg-emerald-500 text-white' : 'bg-blue-400 text-white' 
        },
        'approved': { text: approvedText, icon: approvedIcon, cls: 'bg-emerald-500 text-white' },
        'needs_revision': { text: 'Perlu Revisi', icon: 'fa-solid fa-triangle-exclamation', cls: 'bg-rose-500 text-white' }
    };
    const st = statusMap[ver?.status] || statusMap['draft'];
    badge.title = st.text;
    badge.setAttribute('aria-label', st.text);
    badge.innerHTML = `<i class="${st.icon} text-[10px] md:mr-1"></i><span class="hidden md:inline">${st.text}</span>`;
    badge.className = `inline-flex items-center justify-center px-2 py-0.5 md:px-2.5 rounded-full text-[10px] font-bold tracking-wider uppercase ${st.cls} shadow-xs`;
}

// ========== REVISION ALERT ==========
function renderRevisionAlert() {
    const alertEl = el('alert-needs-revision');
    if (!alertEl) return;
    const { isKepalaSekolah, isSuperAdmin } = getWorkloadUserRoleInfo();
    const isMgr = isKepalaSekolah || isSuperAdmin;
    if (isMgr && !_adminSelectedTeacherId) {
        alertEl.classList.add('hidden');
        return;
    }
    const ver = _weekData?.active_version;
    if (ver && ver.status === 'needs_revision' && (ver.revision_reason || ver.review_notes)) {
        el('revision-reason-text').textContent = ver.revision_reason || ver.review_notes || '';
        alertEl.classList.remove('hidden');
    } else {
        alertEl.classList.add('hidden');
    }
}

// ========== DAY SELECTOR ==========
function renderDaySelector() {
    const container = el('day-selector-pills');
    if (!container) return;
    const today = todayWITA();
    let html = '';
    for (let i = 0; i < 5; i++) {
        const dayDate = dateOfDay(_weekStartDate, i);
        const isToday = dayDate === today;
        const isSelected = i === _selectedDayIndex;
        const isStudyDay = i === _studyDayIndex;

        const bgClass = isSelected
            ? 'bg-emerald-600 text-white shadow-xs'
            : (isToday ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700');
        
        const parts = dayDate.split('-');
        const dateShort = parts.length === 3 ? `${parts[2]}/${parts[1]}` : dayDate.slice(5);

        const studyBadgeCls = isSelected
            ? 'bg-purple-200/90 text-purple-900'
            : 'bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/60';
        const studyBadgeHtml = isStudyDay
            ? `<span class="text-[9px] px-1.5 py-0.5 rounded-md ${studyBadgeCls} font-extrabold uppercase flex items-center gap-1" title="Hari Belajar Guru (SE Mendikdasmen No. 5684/2025)"><i class="fa-solid fa-graduation-cap"></i> Belajar</span>`
            : '';

        html += `<button type="button" onclick="window.workloadSelectDay(${i})" class="px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 ${bgClass}">
            <span>${DAY_NAMES[i]}</span>
            <span class="text-[10px] opacity-75 font-normal">(${dateShort})</span>
            ${studyBadgeHtml}
            ${isToday ? '<span class="text-[9px] px-1 py-0.5 rounded bg-emerald-500/20 text-current font-extrabold uppercase">Hari Ini</span>' : ''}
        </button>`;
    }
    container.innerHTML = html;
}

function selectDay(idx) {
    _selectedDayIndex = idx;
    renderDaySelector();
    renderTodayTab();
}

// ========== SUBMIT BUTTON & POLICY RELOAD ==========
async function reloadPolicy() {
    try {
        const policyRes = await cfGetWorkloadPolicy();
        _policy = policyRes?.data?.policy || null;
        updateSubmitButton();
    } catch (_) {}
}

function updateSubmitButton() {
    const btnSubmit = el('btn-submit-plan');
    const banner = el('plan-status-banner');
    const btnReopen = el('btn-reopen-plan');
    const bannerIcon = el('plan-status-banner-icon');
    const bannerTitle = el('plan-status-banner-title');
    const bannerBadge = el('plan-status-banner-badge');
    const bannerDesc = el('plan-status-banner-desc');
    const btnReopenText = el('btn-reopen-plan-text');
    const btnApplyMobile = el('btn-apply-template-mobile');
    const btnSaveMobile = el('btn-save-as-template-mobile');
    const btnApplyDesktop = el('btn-apply-template');
    const btnSaveDesktop = el('btn-save-as-template');

    const ver = _weekData?.active_version;
    const isLocked = _weekData?.week?.is_locked === 1;

    if (!ver || ver.status === 'draft') {
        if (btnApplyMobile) {
            btnApplyMobile.classList.remove('hidden', '!hidden');
            btnApplyMobile.style.display = '';
        }
        if (btnApplyDesktop) {
            btnApplyDesktop.classList.remove('hidden', '!hidden');
            btnApplyDesktop.style.display = '';
        }
        if (btnSaveMobile) {
            btnSaveMobile.classList.add('hidden', '!hidden');
            btnSaveMobile.style.display = 'none';
        }
        if (btnSaveDesktop) {
            btnSaveDesktop.classList.add('hidden', '!hidden');
            btnSaveDesktop.style.display = 'none';
        }
        if (btnReopen) {
            btnReopen.classList.add('hidden', '!hidden');
            btnReopen.style.display = 'none';
        }

        if (btnSubmit) {
            btnSubmit.classList.remove('hidden', '!hidden');
            btnSubmit.style.display = '';
            const isAutoApproved = _policy?.require_plan_approval === 0;
            if (isAutoApproved) {
                btnSubmit.innerHTML = '<i class="fa-solid fa-circle-check text-[10px] sm:text-xs"></i> <span id="btn-submit-plan-text" class="text-[11px] sm:text-xs font-bold whitespace-nowrap">Finalisasi</span>';
                btnSubmit.title = 'Rencana kerja mingguan langsung difinalisasi secara mandiri tanpa antrean persetujuan';
            } else {
                btnSubmit.innerHTML = '<i class="fa-solid fa-paper-plane text-[10px] sm:text-xs"></i> <span id="btn-submit-plan-text" class="text-[11px] sm:text-xs font-bold whitespace-nowrap">Ajukan</span>';
                btnSubmit.title = 'Ajukan rencana kerja mingguan kepada Kepala Sekolah untuk ditinjau dan disetujui';
            }
        }
        if (banner) banner.classList.add('hidden');
    } else if (ver && ver.status === 'needs_revision') {
        if (btnApplyMobile) {
            btnApplyMobile.classList.add('hidden', '!hidden');
            btnApplyMobile.style.display = 'none';
        }
        if (btnApplyDesktop) {
            btnApplyDesktop.classList.add('hidden', '!hidden');
            btnApplyDesktop.style.display = 'none';
        }
        if (btnSaveMobile) {
            btnSaveMobile.classList.add('hidden', '!hidden');
            btnSaveMobile.style.display = 'none';
        }
        if (btnSaveDesktop) {
            btnSaveDesktop.classList.add('hidden', '!hidden');
            btnSaveDesktop.style.display = 'none';
        }
        if (btnReopen) {
            btnReopen.classList.add('hidden', '!hidden');
            btnReopen.style.display = 'none';
        }

        if (btnSubmit) {
            btnSubmit.classList.remove('hidden');
            btnSubmit.classList.remove('!hidden');
            btnSubmit.style.display = '';
            btnSubmit.innerHTML = '<i class="fa-solid fa-paper-plane text-[10px] sm:text-xs"></i> <span id="btn-submit-plan-text" class="text-[11px] sm:text-xs font-bold whitespace-nowrap">Ajukan Ulang Rencana</span>';
            btnSubmit.title = 'Ajukan kembali rencana kerja mingguan setelah melakukan penyesuaian/revisi';
        }
        if (banner) {
            banner.classList.remove('hidden');
            banner.className = 'px-3 py-1.5 sm:py-2 rounded-xl border transition-all bg-amber-50/80 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/60';
            if (bannerIcon) {
                bannerIcon.className = 'w-6 h-6 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold shadow-2xs bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400';
                bannerIcon.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
            }
            if (bannerTitle) {
                bannerTitle.className = 'font-bold text-xs text-amber-900 dark:text-amber-200 truncate shrink min-w-0';
                bannerTitle.innerHTML = '<span class="sm:hidden">Perlu Revisi</span><span class="hidden sm:inline">Rencana Kerja Perlu Direvisi</span>';
            }
            if (bannerBadge) {
                bannerBadge.className = 'shrink-0 whitespace-nowrap text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase bg-amber-200/70 dark:bg-amber-800/60 text-amber-800 dark:text-amber-200';
                bannerBadge.textContent = 'Perlu Revisi';
            }
            if (bannerDesc) {
                const note = (ver.review_notes || ver.revision_reason || '').trim();
                bannerDesc.classList.remove('hidden');
                bannerDesc.className = 'text-[11px] text-amber-800/90 dark:text-amber-300 line-clamp-2';
                bannerDesc.textContent = note ? `Catatan Pimpinan: "${note}"` : 'Kepala Sekolah meminta perbaikan pada rencana kerja ini. Silakan sesuaikan kegiatan dan ajukan ulang.';
            }
        }
    } else if (ver && ['approved', 'submitted'].includes(ver.status)) {
        if (btnApplyMobile) {
            btnApplyMobile.classList.add('hidden', '!hidden');
            btnApplyMobile.style.display = 'none';
        }
        if (btnApplyDesktop) {
            btnApplyDesktop.classList.add('hidden', '!hidden');
            btnApplyDesktop.style.display = 'none';
        }
        if (btnSaveMobile) {
            btnSaveMobile.classList.remove('hidden', '!hidden');
            btnSaveMobile.style.display = '';
        }
        if (btnSaveDesktop) {
            btnSaveDesktop.classList.remove('hidden', '!hidden');
            btnSaveDesktop.style.display = '';
        }
        if (btnSubmit) {
            btnSubmit.classList.add('hidden');
            btnSubmit.classList.add('!hidden');
            btnSubmit.style.display = 'none';
        }

        if (btnReopen) {
            if (isLocked) {
                btnReopen.classList.add('hidden');
                btnReopen.classList.add('!hidden');
                btnReopen.style.display = 'none';
            } else {
                btnReopen.classList.remove('hidden');
                btnReopen.classList.remove('!hidden');
                btnReopen.style.display = '';
                if (ver.status === 'submitted') {
                    btnReopen.className = 'w-full sm:w-auto px-1.5 sm:px-2.5 py-1.5 sm:py-1 rounded-lg text-blue-700 dark:text-blue-300 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/60 dark:hover:bg-blue-900/60 border border-blue-200/80 dark:border-blue-800/60 text-xs font-bold shadow-2xs transition-all flex items-center justify-center gap-1 active:scale-95 cursor-pointer shrink-0';
                    btnReopen.innerHTML = '<i class="fa-solid fa-rotate-left text-blue-600 dark:text-blue-400 text-[10px] sm:text-xs"></i> <span id="btn-reopen-plan-text" class="text-[11px] sm:text-xs font-bold whitespace-nowrap">Tarik Draf</span>';
                    btnReopen.title = 'Menunggu persetujuan Kepala Sekolah. Anda dapat menarik kembali pengajuan ke draf jika perlu perbaikan jadwal.';
                } else {
                    btnReopen.className = 'w-full sm:w-auto px-1.5 sm:px-2.5 py-1.5 sm:py-1 rounded-lg text-emerald-700 dark:text-emerald-300 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/60 border border-emerald-200/80 dark:border-emerald-800/60 text-xs font-bold shadow-2xs transition-all flex items-center justify-center gap-1 active:scale-95 cursor-pointer shrink-0';
                    btnReopen.innerHTML = '<i class="fa-solid fa-pen-to-square text-emerald-600 dark:text-emerald-400 text-[10px] sm:text-xs"></i> <span id="btn-reopen-plan-text" class="text-[11px] sm:text-xs font-bold whitespace-nowrap">Edit</span>';
                    btnReopen.title = 'Ingin menambah, mengubah jam, atau menyesuaikan kegiatan? Anda dapat mengembalikan rencana ke draf kapan saja.';
                }
                // Ubah ke Draf (Edit Rencana)
            }
        }

        if (banner) {
            banner.classList.remove('hidden');
            const isApproved = ver.status === 'approved';
            const isAutoApproved = isApproved && (_policy?.require_plan_approval === 0 || ver.reviewed_by_uid === 'system_auto_approval');

            if (isApproved) {
                banner.className = 'px-3 py-1.5 sm:py-2 rounded-xl border transition-all bg-emerald-50/80 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/60';
                if (bannerIcon) {
                    bannerIcon.className = 'w-6 h-6 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold shadow-2xs bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400';
                    bannerIcon.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
                }
                if (bannerTitle) {
                    bannerTitle.className = 'font-bold text-xs text-emerald-900 dark:text-emerald-200 truncate shrink min-w-0';
                    bannerTitle.innerHTML = isAutoApproved
                        ? '<span class="sm:hidden">Rencana Difinalisasi</span><span class="hidden sm:inline">Rencana Kerja Telah Difinalisasi (Mandiri)</span>'
                        : '<span class="sm:hidden">Rencana Disetujui</span><span class="hidden sm:inline">Rencana Kerja Telah Disetujui Kepala Sekolah</span>';
                }
                if (bannerBadge) {
                    bannerBadge.className = 'shrink-0 whitespace-nowrap text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase bg-emerald-200/70 dark:bg-emerald-800/60 text-emerald-800 dark:text-emerald-200';
                    bannerBadge.textContent = `Versi ${ver.version_number}`;
                }
                if (bannerDesc) {
                    bannerDesc.classList.add('hidden');
                }
            } else { // submitted
                banner.className = 'px-3 py-1.5 sm:py-2 rounded-xl border transition-all bg-blue-50/80 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800/60';
                if (bannerIcon) {
                    bannerIcon.className = 'w-6 h-6 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold shadow-2xs bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400';
                    bannerIcon.innerHTML = '<i class="fa-solid fa-paper-plane"></i>';
                }
                if (bannerTitle) {
                    bannerTitle.className = 'font-bold text-xs text-blue-900 dark:text-blue-200 truncate shrink min-w-0';
                    bannerTitle.innerHTML = '<span class="sm:hidden">Rencana Ditinjau</span><span class="hidden sm:inline">Rencana Kerja Sedang Ditinjau Pimpinan</span>';
                }
                if (bannerBadge) {
                    bannerBadge.className = 'shrink-0 whitespace-nowrap text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase bg-blue-200/70 dark:bg-blue-800/60 text-blue-800 dark:text-blue-200';
                    bannerBadge.textContent = `Versi ${ver.version_number}`;
                }
                if (bannerDesc) {
                    bannerDesc.classList.add('hidden');
                }
            }
        }
    } else {
        if (btnSubmit) {
            btnSubmit.classList.add('hidden', '!hidden');
            btnSubmit.style.display = 'none';
        }
        if (btnReopen) {
            btnReopen.classList.add('hidden', '!hidden');
            btnReopen.style.display = 'none';
        }
        if (banner) banner.classList.add('hidden');
    }

    renderTeacherStudyDayControl();
}

// ========== TAB: HARI INI ==========
async function triggerSilentJournalSync(dayDate) {
    if (!_weekData?.initialized || !_weekData?.week?.id) return;
    try {
        const res = await cfSyncWorkloadFromJournal({
            teacher_id: _weekData?.week?.teacher_id || getEffectiveTeacherId() || undefined,
            date: dayDate,
            work_week_id: _weekData.week.id
        });
        if (res && res.success && (res.data?.syncedCount || 0) > 0) {
            if (typeof showToast === 'function') {
                showToast(`✨ Realisasi KBM otomatis terisi dari Jurnal Mengajar (${res.data.syncedCount} sesi)`, 'success');
            }
            await loadWeek();
        }
    } catch (err) {
        console.warn('[SilentJournalSync] Info:', err.message);
    }
}

async function syncFromJournal() {
    const activeVersion = _weekData?.active_version;
    if (!activeVersion || activeVersion.status !== 'approved') {
        const isAuto = _policy?.require_plan_approval === 0;
        const term = isAuto ? 'difinalisasi' : 'disetujui Kepala Sekolah';
        showToast(`Rencana kerja mingguan belum ${term}. Sinkronisasi jurnal hanya dapat dilakukan setelah rencana kerja ${term}.`, 'warning');
        return;
    }
    if (_isSyncingFromJournal) return;
    _isSyncingFromJournal = true;
    const syncBtns = document.querySelectorAll('button[onclick*="workloadSyncFromJournal"]');
    syncBtns.forEach(b => {
        b.disabled = true;
        b.classList.add('opacity-75', 'cursor-wait');
        const icon = b.querySelector('i');
        if (icon) icon.classList.add('fa-spin');
    });

    const dayDate = dateOfDay(_weekStartDate, _selectedDayIndex);
    try {
        if (typeof showToast === 'function') {
            showToast(`Menyinkronkan realisasi KBM dari Jurnal Mengajar (${dayDate})...`, 'info');
        }
        const res = await cfSyncWorkloadFromJournal({
            teacher_id: _weekData?.week?.teacher_id || getEffectiveTeacherId() || undefined,
            date: dayDate,
            work_week_id: _weekData?.week?.id
        });
        if (res && res.success) {
            const count = res.data?.syncedCount || 0;
            if (count > 0) {
                if (typeof showToast === 'function') {
                    showToast(`Berhasil menyinkronkan ${count} realisasi KBM dari Jurnal Mengajar!`, 'success');
                }
            } else {
                if (typeof showToast === 'function') {
                    showToast(res.message || 'Tidak ada entri jurnal yang cocok dengan rencana KBM pada hari ini.', 'info');
                }
            }
            await loadWeek();
        } else {
            throw new Error(res?.error || 'Gagal menyinkronkan dari jurnal');
        }
    } catch (err) {
        console.error('[SyncFromJournal] Error:', err);
        if (typeof showToast === 'function') {
            showToast('Gagal sinkron dari Jurnal: ' + err.message, 'error');
        }
    } finally {
        _isSyncingFromJournal = false;
        syncBtns.forEach(b => {
            b.disabled = false;
            b.classList.remove('opacity-75', 'cursor-wait');
            const icon = b.querySelector('i');
            if (icon) icon.classList.remove('fa-spin');
        });
    }
}

// ========== MODE MATRIKS REALISASI MINGGUAN (PERMENDIKDASMEN 11/2025) ==========

export function toggleMatrixViewMode(mode) {
    _matrixViewMode = mode === 'focus' ? 'focus' : 'matrix';
    try {
        localStorage.setItem('simas_workload_matrix_view_mode', _matrixViewMode);
    } catch (e) {
        console.warn('[MatrixViewMode] Storage error:', e);
    }
    renderTodayTab();
}

export async function quickReportComplete(planActivityId, dayIndex = null, triggerBtn = null) {
    if (!planActivityId) return;
    if (isManagerViewingOtherTeacher()) {
        showToast(MANAGER_READONLY_LOG_MSG, 'warning');
        return;
    }

    const activeVersion = _weekData?.active_version;
    if (!activeVersion || activeVersion.status !== 'approved') {
        const isAuto = _policy?.require_plan_approval === 0;
        const term = isAuto ? 'difinalisasi' : 'disetujui Kepala Sekolah';
        showToast(`Rencana kerja mingguan belum ${term}. Pelaporan realisasi hanya dapat dilakukan setelah rencana kerja ${term}.`, 'warning');
        return;
    }

    // Proteksi anti-double-click & mutex locking (0 duplicate realisasi)
    if (_pendingQuickReports.has(planActivityId)) {
        return;
    }

    const segments = _weekData?.segments || [];
    const seg = segments.find(s => s.activity_id === planActivityId);
    if (!seg) {
        showToast('Data rencana kegiatan tidak ditemukan.', 'error');
        return;
    }

    // Proteksi Integritas Data KBM: Realisasi tatap muka KBM wajib disinkronkan dari Jurnal Mengajar Digital
    if (isTeachingActivity(seg)) {
        showToast('Kegiatan tatap muka KBM tidak dapat dicentang manual. Realisasi otomatis disinkronkan dari Jurnal Mengajar Digital demi menjaga integritas data.', 'warning');
        return;
    }

    // Proteksi waktu kegiatan belum berakhir (dengan toleransi 5 menit)
    const reportCheck = canReportActivityNow(seg.date, seg.end_time, 5);
    if (!reportCheck.allowed) {
        showToast(reportCheck.reason, 'warning');
        return;
    }

    // Cek tautan log yang sudah ada untuk memeriksa ketersediaan bukti dukung foto
    const existingLink = (_weekData?.plan_links || []).find(pl => pl.plan_activity_id === planActivityId);
    const existingLog = (_weekData?.logs || []).find(l => {
        if (existingLink && l.id === existingLink.work_log_id) return true;
        if (l.plan_activity_id && l.plan_activity_id === planActivityId) return true;
        return false;
    }) || null;
    const existingLogId = existingLog?.id || existingLink?.work_log_id || undefined;
    const existingPhotos = parseEvidencePhotos(existingLog?.evidence_url);

    // Konfirmasi profesional jika belum ada foto bukti dukung di draf / log kegiatan
    if (existingPhotos.length === 0) {
        const title = seg.activity_title || seg.title || 'Kegiatan';
        const userChoice = await askPhotoConfirmation(
            `Laporan realisasi kegiatan "${title}" belum dilengkapi dengan dokumentasi atau foto bukti dukung.\n\nApakah Anda ingin mengambil foto bukti terlebih dahulu atau tetap menyimpan realisasi sekarang?`,
            'Konfirmasi Bukti Dukung Realisasi',
            {
                photoText: 'Ambil Foto',
                saveText: 'Tetap Simpan'
            }
        );

        if (userChoice === 'photo') {
            const effDayIdx = (dayIndex != null) ? dayIndex : _selectedDayIndex;
            if (existingLogId) {
                openEditLogModal(existingLogId);
            } else {
                openLogModal(planActivityId, false, 'terlaksana', effDayIdx);
            }
            setTimeout(() => {
                highlightEvidencePhotoSection();
            }, 300);
            return;
        }

        if (userChoice !== 'save') {
            return;
        }
    }

    _pendingQuickReports.add(planActivityId);

    // Respons visual seketika (0ms): tombol berubah jadi spinner berputar & terkunci
    const quickBtns = document.querySelectorAll(`[data-quick-plan-id="${planActivityId}"]`);
    const savedBtnStates = [];
    quickBtns.forEach(b => {
        savedBtnStates.push({ btn: b, html: b.innerHTML, disabled: b.disabled });
        b.disabled = true;
        b.classList.add('opacity-75', 'cursor-wait');
        const hasSpan = b.querySelector('span');
        if (hasSpan) {
            b.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-xs"></i> <span>Menyimpan...</span>';
        } else {
            b.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-[9px]"></i>';
        }
    });

    try {
        // Tampilkan feedback instan bahwa proses sedang berjalan
        showToast('Mencatat realisasi kegiatan...', 'info');

        // Pastikan pekan sudah diinisialisasi
        if (!_weekData?.initialized) {
            try {
                await cfInitializeWorkloadWeek({
                    week_start_date: _weekStartDate,
                    teacher_id: getEffectiveTeacherId() || undefined
                });
                await loadWeek();
            } catch (err) {
                showToast('Gagal inisialisasi pekan: ' + err.message, 'error');
                return;
            }
        }

        const title = seg.activity_title || seg.title || 'Kegiatan';
        const duration = seg.planned_minutes || calcEffective(seg.start_time, seg.end_time);

        let catalogId = seg.catalog_id || 'cat_kbm';
        if (!catalogId || catalogId === 'null') {
            const act = (_weekData?.activities || []).find(a => a.id === planActivityId);
            catalogId = act?.catalog_id || 'cat_kbm';
        }

        const effDayIdx = (dayIndex != null) ? dayIndex : _selectedDayIndex;
        const targetDate = seg.date || dateOfDay(_weekStartDate, effDayIdx);

        // Proteksi bentrokan waktu dengan laporan realisasi yang sudah ada di tanggal yang sama
        const existingLogSegs = [];
        (_weekData?.logs || []).forEach(l => {
            if (l.date !== targetDate || l.status_execution === 'tidak_terlaksana' || (existingLogId && l.id === existingLogId)) return;
            const sList = (_weekData?.log_segments || []).filter(ls => ls.work_log_id === l.id);
            if (sList.length > 0) {
                sList.forEach(s => existingLogSegs.push({ ...s, title: l.title }));
            } else if (l.start_time && l.end_time) {
                existingLogSegs.push({ start_time: l.start_time, end_time: l.end_time, title: l.title });
            }
        });

        const overlapCheck = findTimeOverlap({ start_time: seg.start_time, end_time: seg.end_time }, existingLogSegs);
        if (overlapCheck.hasOverlap) {
            const confTitle = overlapCheck.conflictingSegment?.title || 'kegiatan lain';
            const confTime = (overlapCheck.conflictingSegment?.start_time && overlapCheck.conflictingSegment?.end_time)
                ? ` (${overlapCheck.conflictingSegment.start_time}–${overlapCheck.conflictingSegment.end_time})`
                : '';
            const autoResolve = await askConfirm(
                `Jam kegiatan "${title}" (${seg.start_time}–${seg.end_time}) beririsan dengan laporan "${confTitle}"${confTime} yang telah terlaksana.\n\nApakah kegiatan ini merupakan jadwal kembar/duplikat yang ingin otomatis ditandai sebagai 'Tidak Terlaksana (Duplikat Rencana)'?`,
                'Deteksi Benturan Jam Kerja',
                'warning',
                { confirmText: 'Tandai Tidak Terlaksana (Duplikat)', cancelText: 'Buka Form & Sesuaikan Jam' }
            );
            if (autoResolve) {
                const dupPayload = {
                    id: existingLogId,
                    teacher_id: _weekData?.week?.teacher_id || getEffectiveTeacherId() || undefined,
                    work_week_id: _weekData?.week?.id,
                    date: targetDate,
                    day_of_week: effDayIdx + 1,
                    title: title,
                    catalog_id: catalogId,
                    plan_activity_id: planActivityId,
                    is_unplanned: 0,
                    status_execution: 'tidak_terlaksana',
                    output_summary: 'Jadwal duplikat/kembar di rencana kerja',
                    obstacle_notes: `Jadwal duplikat di jam yang sama dengan "${confTitle}"`,
                    segments: []
                };
                try {
                    await cfSaveWorkloadLog(dupPayload);
                    showToast(`✓ Jadwal duplikat "${title}" berhasil dinonaktifkan (Tidak Terlaksana)`, 'info');
                    await loadWeek();
                } catch (err) {
                    showToast('Gagal memproses kegiatan duplikat: ' + err.message, 'error');
                }
                return;
            } else {
                openLogModal(planActivityId, false, 'terlaksana', effDayIdx);
                return;
            }
        }

        const payload = {
            id: existingLogId,
            teacher_id: _weekData?.week?.teacher_id || getEffectiveTeacherId() || undefined,
            work_week_id: _weekData?.week?.id,
            date: targetDate,
            day_of_week: effDayIdx + 1,
            title: title,
            catalog_id: catalogId,
            plan_activity_id: planActivityId,
            is_unplanned: 0,
            status_execution: 'terlaksana',
            output_summary: existingLog?.output_summary || 'Terlaksana sesuai rencana',
            evidence_url: existingLog?.evidence_url || '',
            start_time: seg.start_time,
            end_time: seg.end_time,
            segments: [{
                start_time: seg.start_time,
                end_time: seg.end_time,
                actual_minutes: duration
            }]
        };
        if (existingLog?.obstacle_notes) {
            payload.obstacle_notes = existingLog.obstacle_notes;
        }

        try {
            await cfSaveWorkloadLog(payload);
            showToast(`✓ Realisasi tercatat: ${title} (${duration}m)`, 'success');
            await loadWeek();
        } catch (err) {
            console.error('[QuickReportComplete] Error:', err);
            const errMsg = err.message || String(err);
            if (errMsg.includes('Benturan jam kerja terdeteksi')) {
                const autoResolve = await askConfirm(
                    `${errMsg}\n\nApakah kegiatan ini merupakan jadwal kembar/duplikat yang ingin otomatis ditandai sebagai 'Tidak Terlaksana (Duplikat)'?`,
                    'Benturan Jam Kerja',
                    'warning',
                    { confirmText: 'Tandai Tidak Terlaksana (Duplikat)', cancelText: 'Buka Form & Sesuaikan Jam' }
                );
                if (autoResolve) {
                    payload.status_execution = 'tidak_terlaksana';
                    payload.output_summary = 'Jadwal duplikat/kembar di rencana kerja';
                    payload.obstacle_notes = 'Jadwal duplikat/kembar beririsan dengan laporan lain';
                    payload.segments = [];
                    delete payload.start_time;
                    delete payload.end_time;
                    try {
                        await cfSaveWorkloadLog(payload);
                        showToast(`✓ Jadwal duplikat "${title}" berhasil dinonaktifkan (Tidak Terlaksana)`, 'info');
                        await loadWeek();
                    } catch (saveErr) {
                        showToast('Gagal memproses kegiatan: ' + saveErr.message, 'error');
                    }
                    return;
                } else {
                    openLogModal(planActivityId, false, 'terlaksana', effDayIdx);
                    return;
                }
            }
            showToast('Gagal mencatat realisasi: ' + errMsg, 'error');
        }
    } finally {
        _pendingQuickReports.delete(planActivityId);
        savedBtnStates.forEach(({ btn, html, disabled }) => {
            if (btn && btn.isConnected) {
                btn.disabled = disabled;
                btn.classList.remove('opacity-75', 'cursor-wait');
                btn.innerHTML = html;
            }
        });
    }
}

export function renderWeeklyMatrixView() {
    const grid = el('weekly-matrix-grid');
    if (!grid) return;

    const segments = _weekData?.segments || [];
    const logs = _weekData?.logs || [];
    const logSegments = _weekData?.log_segments || [];
    const planLinks = _weekData?.plan_links || [];
    const today = todayWITA();

    // === Konstanta timeline Gantt ===
    const GANTT_START = 450; // 07:30 dalam menit
    const GANTT_END = 930;   // 15:30 dalam menit
    const GANTT_TOTAL = GANTT_END - GANTT_START; // 480 menit
    const MIN_BLOCK_MINUTES = 30; // minimal lebar visual = 30 menit

    // === Render time ruler (desktop) mengadopsi Interval Jam Pelajaran (JP 1 - JP 10) ===
    const ruler = el('gantt-time-ruler');
    if (ruler) {
        let rulerHtml = `
            <div class="shrink-0 w-[130px] sm:w-[140px] lg:w-[160px] pl-2 pr-1 flex items-center justify-between text-[10px] font-bold text-slate-500 dark:text-slate-400">
                <span class="flex items-center gap-1"><i class="fa-solid fa-clock text-[9px] text-emerald-500"></i> Jam Pelajaran</span>
            </div>
            <div class="flex-1 relative h-7 bg-slate-50/70 dark:bg-slate-800/40 rounded-lg border border-slate-200/80 dark:border-slate-700/60 overflow-hidden select-none">`;

        STANDARD_JP_PERIODS.forEach(slot => {
            const slotStartM = parseTime(slot.start);
            const slotEndM = parseTime(slot.end);
            const leftPct = ((slotStartM - GANTT_START) / GANTT_TOTAL) * 100;
            const widthPct = ((slotEndM - slotStartM) / GANTT_TOTAL) * 100;

            if (slot.isBreak) {
                rulerHtml += `
                    <div class="absolute top-0 bottom-0 flex flex-col items-center justify-center bg-slate-200/50 dark:bg-slate-700/50 border-r border-slate-200 dark:border-slate-700/80 text-amber-600 dark:text-amber-400"
                         style="left: ${leftPct}%; width: ${widthPct}%" title="Istirahat (${slot.start}–${slot.end})">
                        <i class="fa-solid fa-mug-hot text-[8px]"></i>
                    </div>`;
            } else {
                rulerHtml += `
                    <div class="absolute top-0 bottom-0 flex flex-col items-center justify-center border-r border-slate-200 dark:border-slate-700/80 px-0.5 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 transition-colors"
                         style="left: ${leftPct}%; width: ${widthPct}%" title="${slot.label} (${slot.start} – ${slot.end})">
                        <span class="text-[9px] font-bold text-slate-700 dark:text-slate-200 leading-tight">${slot.label}</span>
                        <span class="text-[7.5px] font-mono text-slate-400 dark:text-slate-500 leading-none">${slot.start}</span>
                    </div>`;
            }
        });

        rulerHtml += '</div>';
        ruler.innerHTML = rulerHtml;
    }

    // === Cek apakah mobile (untuk default collapse state) ===
    const isMobile = window.innerWidth < 768;

    let gridHtml = '';

    for (let i = 0; i < 5; i++) {
        const dayDate = dateOfDay(_weekStartDate, i);
        const isToday = dayDate === today;
        const isPast = dayDate < today;
        const isStudyDay = i === _studyDayIndex;

        const daySegments = segments.filter(s => s.date === dayDate).sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
        const dayLogs = logs.filter(l => l.date === dayDate);
        const dayLogIds = new Set(dayLogs.map(l => l.id));
        const dayLogSegs = logSegments.filter(ls => dayLogIds.has(ls.work_log_id));

        const dayTimeline = calculateDayTimelineSlots(dayDate, daySegments, {
            policy: _policy,
            isHolidayFn: (d) => isHolidayDate(d),
            getHolidayInfoFn: (d) => getHolidayDateInfo(d)
        });
        const isHoliday = dayTimeline.isHoliday;
        const isLeave = dayTimeline.isLeave;

        // Realisasi yang jamnya berbeda dari rencana (mis. diganti rapat 12:30–15:30) digambar sesuai jam aktual;
        // rencana yang beririsan dipindah ke lajur tipis di bawah bar realisasi.
        const realizationOverlap = (isHoliday || isLeave)
            ? { shifted: new Map(), overlapped: new Map() }
            : detectShiftedRealizations(dayTimeline.slots, dayLogs, dayLogSegs, planLinks);
        const shiftedRanges = [...realizationOverlap.shifted.values()];
        const hasOverlapLane = realizationOverlap.overlapped.size > 0;
        const mainLaneCls = hasOverlapLane ? 'top-0 bottom-[13px]' : 'top-0 bottom-0';

        // Hitung total menit aktual hari ini
        let dayActualMinutes = dayLogSegs.reduce((sum, ls) => sum + (ls.actual_minutes || 0), 0);
        if (isHoliday) {
            dayActualMinutes = Math.max(dayActualMinutes, 450);
        }

        const isTargetMet = dayActualMinutes >= 450 || isHoliday || isLeave;
        const dayPct = isLeave ? 100 : (isHoliday ? 100 : Math.min(100, Math.round(dayActualMinutes / 450 * 100)));

        const parts = dayDate.split('-');
        const dateShort = parts.length === 3 ? `${parts[2]}/${parts[1]}` : dayDate.slice(5);

        // Header badges
        let headerBadges = '';
        if (isToday) {
            headerBadges += '<span class="px-1 py-0.5 rounded text-[8px] font-extrabold bg-emerald-600 text-white uppercase">Hari Ini</span>';
        }
        if (isStudyDay) {
            headerBadges += '<span class="px-1 py-0.5 rounded text-[8px] font-extrabold bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800" title="Hari Belajar Guru"><i class="fa-solid fa-graduation-cap text-[7px]"></i></span>';
        }
        if (isHoliday) {
            headerBadges += '<span class="px-1 py-0.5 rounded text-[8px] font-extrabold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200 border border-amber-200">Libur</span>';
        }
        if (isLeave) {
            headerBadges += '<span class="px-1 py-0.5 rounded text-[8px] font-extrabold bg-cyan-100 dark:bg-cyan-950 text-cyan-800 dark:text-cyan-200 border border-cyan-200 dark:border-cyan-800">Cuti</span>';
        }

        // Deteksi apakah hari ini tercatat Sakit / Cuti / Izin mendadak
        const absenceLog = (dayLogs || []).find(l => {
            return (l.date === dayDate || !l.date) && l.status_execution === 'tidak_terlaksana' && /^\[(Sakit|Cuti|Izin)\]/i.test(l.obstacle_notes || '');
        });

        const canMarkAbsence = !_adminSelectedTeacherId && !isHoliday && !isLeave;
        let absenceActionHtml = '';

        if (canMarkAbsence) {
            if (absenceLog) {
                const match = (absenceLog.obstacle_notes || '').match(/^\[(Sakit|Cuti|Izin)\]\s*(.*)/i);
                const absType = match ? match[1] : 'Sakit';
                absenceActionHtml = `
                    <button type="button" onclick="event.stopPropagation(); window.workloadOpenUnplannedAbsenceModal(${i})"
                        class="px-1.5 py-0.5 rounded-md text-[8.5px] font-bold bg-rose-100 hover:bg-rose-200 dark:bg-rose-950/60 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800 transition-all flex items-center gap-1 cursor-pointer shrink-0 shadow-2xs"
                        title="Hari ini tercatat Tidak Terlaksana (${escapeHTML(absType)}). Klik untuk ubah atau batalkan status">
                        <i class="fa-solid fa-calendar-xmark text-[8px]"></i>
                        <span>${escapeHTML(absType)}</span>
                    </button>`;
            } else {
                absenceActionHtml = `
                    <button type="button" onclick="event.stopPropagation(); window.workloadOpenUnplannedAbsenceModal(${i})"
                        class="w-5 h-5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 flex items-center justify-center transition-all cursor-pointer shrink-0"
                        title="Tandai hari ini Tidak Terlaksana (Sakit/Cuti/Izin)">
                        <i class="fa-solid fa-calendar-xmark text-[10px]"></i>
                    </button>`;
            }
        }

        // SVG mini progress ring
        const ringRadius = 14;
        const ringCircumference = 2 * Math.PI * ringRadius;
        const ringOffset = ringCircumference - (dayPct / 100) * ringCircumference;
        const ringColor = isLeave ? '#06b6d4' : (isTargetMet ? '#10b981' : (dayPct >= 50 ? '#3b82f6' : '#f59e0b'));
        const progressRingHtml = `
            <svg width="38" height="38" viewBox="0 0 38 38" class="shrink-0">
                <circle cx="19" cy="19" r="${ringRadius}" fill="none" stroke-width="3" class="stroke-slate-200 dark:stroke-slate-700"></circle>
                <circle cx="19" cy="19" r="${ringRadius}" fill="none" stroke-width="3" stroke="${ringColor}"
                    stroke-dasharray="${ringCircumference}" stroke-dashoffset="${ringOffset}"
                    stroke-linecap="round" transform="rotate(-90 19 19)" class="transition-all duration-500"></circle>
                <text x="19" y="19" text-anchor="middle" dominant-baseline="central" class="fill-slate-700 dark:fill-white text-[8px] font-bold">${dayPct}%</text>
            </svg>`;

        // === Mobile: default collapsed kecuali hari ini yang belum mencapai 100% ===
        // Aturan UX: jika di hari itu sudah 100%, maka otomatis collaps.
        const isDayComplete = isTargetMet || dayPct >= 100 || isHoliday || isLeave;
        const isExpanded = isMobile ? (isToday && !isDayComplete) : true;
        const collapseId = `gantt-row-body-${i}`;

        // === Build Gantt blocks ===
        let ganttBlocksHtml = '';
        let activityCount = 0;

        if (isHoliday) {
            const hTitle = escapeHTML(dayTimeline.holidaySegment?.activity_title || dayTimeline.holidaySegment?.title || dayTimeline.slots[0]?.title || 'Libur');
            ganttBlocksHtml = `
                <div class="flex items-center justify-center h-full px-3 text-center">
                    <div class="flex items-center gap-2 text-amber-700 dark:text-amber-300 text-xs">
                        <i class="fa-solid fa-umbrella-beach text-base text-amber-500"></i>
                        <span class="font-bold">${hTitle}</span>
                        <span class="text-[10px] text-amber-500">(Bebas target)</span>
                    </div>
                </div>`;
        } else if (isLeave) {
            const lTitle = escapeHTML(dayTimeline.leaveTitle || dayTimeline.leaveSegment?.title || 'Cuti / Izin Resmi');
            const lNotes = dayTimeline.leaveNotes ? ` - ${escapeHTML(dayTimeline.leaveNotes)}` : '';
            ganttBlocksHtml = `
                <div class="flex items-center justify-center h-full px-3 text-center">
                    <div class="flex items-center gap-2 text-cyan-700 dark:text-cyan-300 text-xs">
                        <i class="fa-solid fa-calendar-xmark text-base text-cyan-600 dark:text-cyan-400"></i>
                        <span class="font-bold">${lTitle}${lNotes}</span>
                        <span class="text-[10px] text-cyan-600 dark:text-cyan-400 font-medium">(0m Terencana • Bebas Jam Kerja)</span>
                    </div>
                </div>`;
        } else {
            // Build proportional Gantt blocks
            const renderedGanttLogIds = new Set();
            const renderedPlanActivityIds = new Set();
            dayTimeline.slots.forEach(slot => {
                const slotStartMins = parseTime(slot.startTime);
                const slotEndMins = parseTime(slot.endTime);
                let durationMins = slotEndMins - slotStartMins;
                if (durationMins <= 0) return;

                // Clamp to Gantt range
                const clampedStart = Math.max(slotStartMins, GANTT_START);
                const clampedEnd = Math.min(slotEndMins, GANTT_END);
                if (clampedEnd <= clampedStart) return;

                const rawDuration = clampedEnd - clampedStart;
                // Istirahat (15m) & slot kosong harus menggunakan durasi eksak agar presisi dan tidak melewati kolom timeline
                const isBreakOrEmpty = slot.type === 'break' || slot.type === 'empty';
                const hasBreakImmediatelyAfter = slot.endMin < GANTT_END && dayTimeline.slots.some(s => s.type === 'break' && s.startMin === slot.endMin);
                const visualDuration = (isBreakOrEmpty || hasBreakImmediatelyAfter)
                    ? rawDuration
                    : Math.min(Math.max(rawDuration, MIN_BLOCK_MINUTES), GANTT_END - clampedStart);
                const leftPct = ((clampedStart - GANTT_START) / GANTT_TOTAL) * 100;
                const widthPct = Math.min((visualDuration / GANTT_TOTAL) * 100, 100 - leftPct);

                if (slot.type === 'activity') {
                    const seg = slot.segment || {};
                    const activityId = seg.activity_id || slot.id;

                    activityCount++;
                    const linkedLog = dayLogs.find(l => planLinks.some(pl => pl.plan_activity_id === seg.activity_id && pl.work_log_id === l.id));
                    const hasLog = !!linkedLog;
                    if (hasLog) {
                        renderedGanttLogIds.add(linkedLog.id);
                    }

                    // Rentang waktu utuh kegiatan (menyatukan sub-slot yang melintasi istirahat resmi sekolah)
                    const actStartMins = (seg.start_time && parseTime(seg.start_time) > 0) ? parseTime(seg.start_time) : slotStartMins;
                    const actEndMins = (seg.end_time && parseTime(seg.end_time) > 0) ? parseTime(seg.end_time) : slotEndMins;
                    const actClampedStart = Math.max(actStartMins, GANTT_START);
                    const actClampedEnd = Math.min(actEndMins, GANTT_END);
                    const actRawDuration = Math.max(0, actClampedEnd - actClampedStart);
                    const actVisualDuration = Math.min(Math.max(actRawDuration, MIN_BLOCK_MINUTES), GANTT_END - actClampedStart);
                    const actLeftPct = ((actClampedStart - GANTT_START) / GANTT_TOTAL) * 100;
                    const actWidthPct = Math.min((actVisualDuration / GANTT_TOTAL) * 100, 100 - actLeftPct);
                    const actStartTimeStr = seg.start_time || slot.startTime;
                    const actEndTimeStr = seg.end_time || slot.endTime;
                    const actPlannedMins = (seg.planned_minutes !== undefined && seg.planned_minutes !== null)
                        ? parseInt(seg.planned_minutes, 10)
                        : (slot.durationMinutes || actRawDuration);

                    // Cek cakupan log realisasi terhadap kegiatan rencana penuh
                    const segLogItems = hasLog ? dayLogSegs.filter(ls => ls.work_log_id === linkedLog.id && ls.start_time && ls.end_time) : [];
                    const logStartMin = segLogItems.length > 0 ? Math.min(...segLogItems.map(ls => parseTime(ls.start_time))) : (linkedLog?.start_time ? parseTime(linkedLog.start_time) : 0);
                    const logEndMin = segLogItems.length > 0 ? Math.max(...segLogItems.map(ls => parseTime(ls.end_time))) : (linkedLog?.end_time ? parseTime(linkedLog.end_time) : 0);
                    const logActualMins = segLogItems.length > 0 ? segLogItems.reduce((s, ls) => s + (ls.actual_minutes || 0), 0) : (linkedLog ? calcEffective(linkedLog.start_time, linkedLog.end_time) : 0);

                    // Deteksi kegiatan multi-slot (misal KBM multi-JP yang melintasi jam istirahat sekolah)
                    const isMultiSlotPlan = actStartMins < slotStartMins || actEndMins > slotEndMins;
                    const isLogPartialForMultiSlot = Boolean(
                        hasLog && isMultiSlotPlan && linkedLog.status_execution !== 'tidak_terlaksana' && (
                            logEndMin < actEndMins || logStartMin > actStartMins || logActualMins < actPlannedMins
                        )
                    );

                    if (!isLogPartialForMultiSlot) {
                        if (activityId && renderedPlanActivityIds.has(activityId)) {
                            // Kegiatan ini sudah dirender sebagai satu kesatuan utuh pada sub-slot pertama (sebelum jeda istirahat)
                            return;
                        }
                        if (activityId) {
                            renderedPlanActivityIds.add(activityId);
                        }
                    }

                    // Tentukan apakah sub-slot spesifik ini tercakup oleh log realisasi
                    const slotHasLog = Boolean(hasLog && (
                        linkedLog.status_execution === 'tidak_terlaksana' ||
                        !isLogPartialForMultiSlot ||
                        (Math.max(logStartMin, slotStartMins) < Math.min(logEndMin, slotEndMins))
                    ));

                    if (slotHasLog) {
                        renderedGanttLogIds.add(linkedLog.id);
                    }

                    // Jika partial multi-slot: gunakan koordinat sub-slot saat ini agar balok hijau hanya sepanjang jam riil yang terealisasi
                    const curLeftPct = isLogPartialForMultiSlot ? leftPct : actLeftPct;
                    const curWidthPct = isLogPartialForMultiSlot ? widthPct : actWidthPct;
                    const curStartTimeStr = isLogPartialForMultiSlot ? slot.startTime : actStartTimeStr;
                    const curEndTimeStr = isLogPartialForMultiSlot ? slot.endTime : actEndTimeStr;
                    const curPlannedMins = isLogPartialForMultiSlot ? (slot.durationMinutes || rawDuration) : actPlannedMins;
                    const curClampedStart = isLogPartialForMultiSlot ? clampedStart : actClampedStart;
                    const curClampedEnd = isLogPartialForMultiSlot ? clampedEnd : actClampedEnd;
                    const curRawDuration = isLogPartialForMultiSlot ? rawDuration : actRawDuration;

                    // Rencana yang beririsan dengan realisasi bergeser: tampil sebagai lajur tipis di bawah bar realisasi
                    const shiftedReal = realizationOverlap.shifted.get(seg.activity_id) || null;
                    const overlapCover = realizationOverlap.overlapped.get(seg.activity_id) || null;
                    if (overlapCover) {
                        const stripWidthPct = Math.min((actRawDuration / GANTT_TOTAL) * 100, 100 - actLeftPct);
                        const coverRangeStr = `${minutesToTimeString(overlapCover.startMin)}–${minutesToTimeString(overlapCover.endMin)}`;
                        const stripStatus = overlapCover.isOwn ? 'own' : (linkedLog?.status_execution || 'plan');
                        const stripCls = {
                            own: 'bg-slate-200 dark:bg-slate-700 border-slate-400 dark:border-slate-500 text-slate-600 dark:text-slate-300',
                            tidak_terlaksana: 'bg-rose-100 dark:bg-rose-950/60 border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300',
                            draft: 'bg-amber-100 dark:bg-amber-950/60 border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-200'
                        }[stripStatus] || 'bg-blue-100 dark:bg-blue-950/60 border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-300';
                        const stripNote = overlapCover.isOwn
                            ? `Rencana awal, diganti "${overlapCover.title}" (${coverRangeStr})`
                            : `Beririsan dengan realisasi "${overlapCover.title}" (${coverRangeStr})${hasLog ? '' : ', belum dilaporkan'}`;
                        const stripAction = hasLog
                            ? `window.workloadOpenEditLogModal('${linkedLog.id}')`
                            : `window.workloadOpenLogModal('${seg.activity_id}', false, 'tidak_terlaksana', ${i})`;
                        const stripHint = hasLog ? 'Klik untuk edit laporan' : 'Klik untuk melaporkan rencana ini (mis. Tidak Terlaksana)';

                        ganttBlocksHtml += `
                            <div class="absolute bottom-px h-[10px] rounded-sm border border-dashed ${stripCls} overflow-hidden cursor-pointer hover:z-20 hover:shadow-sm transition-all"
                                 onclick="${stripAction}"
                                 style="left: ${actLeftPct}%; width: ${stripWidthPct}%" title="${actStartTimeStr}–${actEndTimeStr} | ${escapeHTML(slot.title)} — ${escapeHTML(stripNote)}. ${stripHint}">
                                <div class="px-1 text-[7px] font-semibold leading-[9px] truncate ${stripStatus === 'tidak_terlaksana' ? 'line-through' : ''}">${escapeHTML(slot.title)}</div>
                            </div>`;

                        if (!shiftedReal) return;
                    }

                    // Determine colors & border based on status
                    let blockBg, blockBorder, blockText, borderLeftColor;

                    if (slotHasLog) {
                        const linkObj = planLinks.find(pl => pl.plan_activity_id === seg.activity_id && pl.work_log_id === linkedLog.id);
                        const isSubstituted = linkObj?.link_type === 'substitution' || linkedLog.status_execution === 'diganti';

                        if (isSubstituted && linkedLog.status_execution !== 'draft') {
                            blockBg = 'bg-emerald-50 dark:bg-emerald-950/30';
                            blockBorder = 'border-emerald-300 dark:border-emerald-800';
                            blockText = 'text-emerald-800 dark:text-emerald-200';
                            borderLeftColor = 'border-l-emerald-500';
                        } else if (linkedLog.status_execution === 'draft') {
                            blockBg = 'bg-amber-50 dark:bg-amber-950/30';
                            blockBorder = 'border-amber-300 dark:border-amber-800 border-dashed';
                            blockText = 'text-amber-800 dark:text-amber-200';
                            borderLeftColor = 'border-l-amber-500';
                        } else if (linkedLog.status_execution === 'sebagian') {
                            blockBg = 'bg-amber-50 dark:bg-amber-950/30';
                            blockBorder = 'border-amber-300 dark:border-amber-800';
                            blockText = 'text-amber-800 dark:text-amber-200';
                            borderLeftColor = 'border-l-amber-500';
                        } else if (linkedLog.status_execution === 'tidak_terlaksana') {
                            blockBg = 'bg-rose-50/70 dark:bg-rose-950/30';
                            blockBorder = 'border-rose-300 dark:border-rose-800 border-dashed';
                            blockText = 'text-rose-700 dark:text-rose-300';
                            borderLeftColor = 'border-l-rose-500';
                        } else {
                            // Terlaksana
                            blockBg = 'bg-emerald-50 dark:bg-emerald-950/30';
                            blockBorder = 'border-emerald-300 dark:border-emerald-800';
                            blockText = 'text-emerald-800 dark:text-emerald-200';
                            borderLeftColor = 'border-l-emerald-500';
                        }

                        const actualMins = dayLogSegs.filter(ls => ls.work_log_id === linkedLog.id).reduce((s, ls) => s + (ls.actual_minutes || 0), 0);
                        const canEditGantt = !isLogLockedByManualVerification(linkedLog);
                        const photos = parseEvidencePhotos(linkedLog?.evidence_url);
                        const photoCount = photos.length;
                        const isDraftLog = linkedLog.status_execution === 'draft';
                        const isNotExecuted = linkedLog.status_execution === 'tidak_terlaksana';
                        const hasEvidence = photoCount > 0 || (linkedLog.evidence_url && sanitizeUrl(linkedLog.evidence_url));

                        // Deteksi jika realisasi hanya sebagian durasi rencana (actualMins < rawDuration)
                        const isPartialRealized = !shiftedReal && !isNotExecuted && !isDraftLog && actualMins > 0 && actualMins < rawDuration;
                        const unfulfilledMins = isPartialRealized ? (rawDuration - actualMins) : 0;
                        const splitMin = isPartialRealized ? (clampedStart + actualMins) : clampedEnd;
                        const splitTimeStr = isPartialRealized ? minutesToTimeString(splitMin) : slot.endTime;
                        const currentRealizedWidthPct = isPartialRealized
                            ? Math.min((actualMins / GANTT_TOTAL) * 100, 100 - curLeftPct)
                            : curWidthPct;

                        // Realisasi bergeser/melebar: bar mengikuti jam aktual log, bukan jam rencana
                        const realStartMin = shiftedReal ? Math.max(shiftedReal.startMin, GANTT_START) : curClampedStart;
                        const realEndMin = shiftedReal ? Math.min(shiftedReal.endMin, GANTT_END) : curClampedEnd;
                        const barLeftPct = shiftedReal ? ((realStartMin - GANTT_START) / GANTT_TOTAL) * 100 : curLeftPct;
                        const barWidthPct = shiftedReal
                            ? Math.max(0, Math.min(((realEndMin - realStartMin) / GANTT_TOTAL) * 100, 100 - barLeftPct))
                            : currentRealizedWidthPct;
                        const barStartStr = shiftedReal ? minutesToTimeString(shiftedReal.startMin) : curStartTimeStr;
                        const barEndStr = shiftedReal ? minutesToTimeString(shiftedReal.endMin) : (isPartialRealized ? splitTimeStr : curEndTimeStr);

                        // In-card action: edit jika belum diverifikasi manual oleh Kepsek & buka bukti jika ada
                        let actionHtml = '';
                        if (canEditGantt || hasEvidence) {
                            actionHtml = `
                                <div class="absolute top-0.5 right-0.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-30">
                                    ${hasEvidence ? `
                                        <button type="button" onclick="event.stopPropagation(); window.workloadOpenLightboxFromLogId('${linkedLog.id}')" class="w-4 h-4 flex items-center justify-center rounded text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-[8px] transition-colors cursor-pointer" title="Buka Gambar Bukti KBM (Google Drive / Foto)"><i class="fa-solid fa-image"></i></button>
                                    ` : ''}
                                    ${canEditGantt ? `
                                        <button type="button" onclick="event.stopPropagation(); window.workloadOpenEditLogModal('${linkedLog.id}')" class="w-4 h-4 flex items-center justify-center rounded text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 text-[8px] transition-colors cursor-pointer" title="${isDraftLog ? 'Lanjutkan Draf' : 'Edit Laporan'}"><i class="fa-solid fa-pen-to-square"></i></button>
                                    ` : ''}
                                </div>`;
                        }

                        const isHbgAct = isActivityHbg(seg);
                        const hbgBadgeXs = renderHbgBadge(seg, 'xs');

                        const displayTitle = isSubstituted
                            ? (linkedLog.title || linkObj?.reason_notes || linkedLog.substitute_notes || slot.title)
                            : slot.title;

                        ganttBlocksHtml += `
                            <div class="absolute ${mainLaneCls} group rounded-md border ${blockBorder} ${blockBg} border-l-[3px] ${borderLeftColor} overflow-hidden ${canEditGantt ? 'cursor-pointer hover:shadow-md hover:scale-[1.01] hover:z-20 active:scale-95' : 'cursor-default'} transition-all ${shiftedReal ? 'z-10' : ''}"
                                 onclick="window.workloadOpenEditLogModal('${linkedLog.id}')"
                                 style="left: ${barLeftPct}%; width: ${barWidthPct}%" title="${barStartStr}–${barEndStr} | ${escapeHTML(displayTitle)}${isSubstituted ? ` (Menggantikan rencana: ${escapeHTML(slot.title)})` : ''}${isNotExecuted ? ' [Tidak Terlaksana]' : ''}${isNotExecuted && linkedLog.obstacle_notes ? ` (Kendala: ${escapeHTML(linkedLog.obstacle_notes)})` : ''} (${actualMins > 0 ? actualMins : curPlannedMins}m)${isPartialRealized ? ` [Terealisasi ${actualMins}m dari rencana ${actPlannedMins}m]` : ''}${shiftedReal ? ` [Jam realisasi berbeda dari rencana ${actStartTimeStr}–${actEndTimeStr}]` : ''}${isDraftLog ? ' [Draf]' : ''}${isHbgAct ? ' [Ranah HBG]' : ''}${canEditGantt ? ' — Klik grid atau judul untuk edit laporan' : ' — Telah diverifikasi Kepala Sekolah'}">
                                ${actionHtml}
                                <div class="px-1.5 py-0.5 h-full flex flex-col justify-center overflow-hidden pointer-events-none">
                                    <div class="text-[9px] font-bold ${blockText} truncate leading-tight ${canEditGantt ? 'group-hover:underline' : ''}">
                                        <span class="truncate ${isNotExecuted ? 'line-through opacity-85' : ''}">${isSubstituted ? '<i class="fa-solid fa-arrows-rotate text-[7px] mr-1"></i>' : ''}${isNotExecuted ? '<i class="fa-solid fa-circle-xmark text-[7px] text-rose-500 mr-1"></i>' : ''}${escapeHTML(displayTitle)}</span>
                                    </div>
                                    <div class="flex items-center gap-1 mt-0.5 flex-wrap">
                                        <span class="text-[8px] font-mono text-slate-400">${barStartStr}${(isPartialRealized || shiftedReal) ? `–${barEndStr}` : ''}</span>
                                        <span class="text-[8px] font-bold ${blockText}">${actualMins > 0 ? actualMins + 'm' : (isDraftLog ? '0m' : (curPlannedMins || 0) + 'm')}</span>
                                        ${seg.is_teaching ? '<span class="text-[7px] px-0.5 rounded bg-blue-200 dark:bg-blue-800 text-blue-700 dark:text-blue-300 font-bold">KBM</span>' : ''}
                                        ${hbgBadgeXs}
                                        ${isDraftLog ? '<span class="text-[7px] px-1 py-0.2 rounded bg-amber-200 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200 font-extrabold border border-amber-300 dark:border-amber-700">Draf</span>' : ''}
                                        ${isPartialRealized ? '<span class="text-[7px] px-1 py-0.2 rounded bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200 font-extrabold border border-amber-300 dark:border-amber-700 flex items-center gap-0.5"><i class="fa-solid fa-clock-rotate-left text-[6px]"></i> Parsial</span>' : ''}
                                        ${isSubstituted ? '<span class="text-[7px] px-1 py-0.2 rounded bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200 font-bold border border-emerald-300 dark:border-emerald-700 flex items-center gap-0.5"><i class="fa-solid fa-arrows-rotate text-[6px]"></i> Diganti</span>' : ''}
                                        ${isNotExecuted ? '<span class="text-[7px] px-1 py-0.2 rounded bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 font-extrabold border border-rose-300 dark:border-rose-800 flex items-center gap-0.5 shrink-0"><i class="fa-solid fa-xmark text-[6px]"></i> Tidak Terlaksana</span>' : ''}
                                        ${hasEvidence ? `
                                            <span onclick="event.stopPropagation(); window.workloadOpenLightboxFromLogId('${linkedLog.id}')" class="pointer-events-auto cursor-pointer hover:underline text-[7px] px-1 py-0.2 rounded bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-bold flex items-center gap-0.5 shrink-0" title="Klik untuk membuka gambar bukti KBM"><i class="fa-solid fa-image text-[6.5px]"></i> Bukti</span>
                                        ` : ''}
                                    </div>
                                </div>
                            </div>`;

                        // Balok Sisa Rencana yang Tidak/Belum Terealisasi atau Terisi Tugas Insidental
                        if (isPartialRealized && unfulfilledMins > 0) {
                            let coveredUntilMin = splitMin;
                            const candidateCoveringLogs = dayLogs.filter(l => {
                                if (l.id === linkedLog.id) return false;
                                if (l.status_execution === 'tidak_terlaksana') return false;
                                const lSegs = dayLogSegs.filter(ls => ls.work_log_id === l.id);
                                const lStart = lSegs[0]?.start_time || l.start_time;
                                const lEnd = lSegs[lSegs.length - 1]?.end_time || l.end_time;
                                if (!lStart || !lEnd) return false;
                                const sMin = parseTime(lStart);
                                const eMin = parseTime(lEnd);
                                return Math.max(splitMin, sMin) < Math.min(clampedEnd, eMin);
                            }).sort((a, b) => {
                                const aStart = dayLogSegs.find(ls => ls.work_log_id === a.id)?.start_time || a.start_time || '';
                                const bStart = dayLogSegs.find(ls => ls.work_log_id === b.id)?.start_time || b.start_time || '';
                                return aStart.localeCompare(bStart);
                            });

                            candidateCoveringLogs.forEach(covLog => {
                                const cSegs = dayLogSegs.filter(ls => ls.work_log_id === covLog.id);
                                const cStart = cSegs[0]?.start_time || covLog.start_time;
                                const cEnd = cSegs[cSegs.length - 1]?.end_time || covLog.end_time;
                                const sMin = Math.max(coveredUntilMin, parseTime(cStart));
                                const eMin = Math.min(clampedEnd, parseTime(cEnd));
                                const durMin = eMin - sMin;
                                if (durMin > 0) {
                                    const covLeftPct = ((sMin - GANTT_START) / GANTT_TOTAL) * 100;
                                    const covWidthPct = Math.min((durMin / GANTT_TOTAL) * 100, 100 - covLeftPct);
                                    const cStartStr = minutesToTimeString(sMin);
                                    const cEndStr = minutesToTimeString(eMin);
                                    const cActualMins = cSegs.reduce((sum, ls) => sum + (ls.actual_minutes || 0), 0) || durMin;
                                    const cCanEdit = !isLogLockedByManualVerification(covLog);

                                    ganttBlocksHtml += `
                                        <div class="absolute ${mainLaneCls} group rounded-md border border-indigo-300 dark:border-indigo-800 bg-indigo-50/90 dark:bg-indigo-950/40 border-l-[3px] border-l-indigo-500 overflow-hidden ${cCanEdit ? 'cursor-pointer hover:shadow-md hover:scale-[1.01] hover:z-20 active:scale-95' : 'cursor-default'} transition-all"
                                             onclick="window.workloadOpenEditLogModal('${covLog.id}')"
                                             style="left: ${covLeftPct}%; width: ${covWidthPct}%" title="${cStartStr}–${cEndStr} | ${escapeHTML(covLog.title)} (${cActualMins}m, Tugas Insidental Pengisi Jam) — Klik untuk edit laporan">
                                            <div class="px-1.5 py-0.5 h-full flex flex-col justify-center overflow-hidden pointer-events-none">
                                                <div class="text-[9px] font-bold text-indigo-800 dark:text-indigo-200 truncate leading-tight flex items-center gap-1 ${cCanEdit ? 'group-hover:underline' : ''}">
                                                    <i class="fa-solid fa-bolt text-[7px] text-amber-500 shrink-0"></i>
                                                    <span class="truncate">${escapeHTML(covLog.title)}</span>
                                                </div>
                                                <div class="flex items-center gap-1 mt-0.5 flex-wrap">
                                                    <span class="text-[8px] font-mono text-slate-500 dark:text-slate-400">${cStartStr}–${cEndStr}</span>
                                                    <span class="text-[8px] font-bold text-indigo-700 dark:text-indigo-300">${cActualMins}m</span>
                                                    <span class="text-[7px] px-1 py-0.2 rounded bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-extrabold border border-indigo-300 dark:border-indigo-800 shrink-0">Insidental</span>
                                                </div>
                                            </div>
                                        </div>`;

                                    renderedGanttLogIds.add(covLog.id);
                                    if (eMin > coveredUntilMin) coveredUntilMin = eMin;
                                }
                            });

                            if (coveredUntilMin < actClampedEnd) {
                                const remMins = actClampedEnd - coveredUntilMin;
                                const remStartStr = minutesToTimeString(coveredUntilMin);
                                const remEndStr = minutesToTimeString(actClampedEnd);
                                const unfulfilledLeftPct = ((coveredUntilMin - GANTT_START) / GANTT_TOTAL) * 100;
                                const unfulfilledWidthPct = Math.min((remMins / GANTT_TOTAL) * 100, 100 - unfulfilledLeftPct);
                                ganttBlocksHtml += `
                                    <div class="absolute ${mainLaneCls} group rounded-md border border-dashed border-rose-300 dark:border-rose-800 bg-rose-50/70 dark:bg-rose-950/30 border-l-[3px] border-l-rose-500 overflow-hidden cursor-pointer hover:shadow-md hover:scale-[1.01] hover:z-20 active:scale-95 transition-all select-none"
                                         onclick="window.workloadOpenAddUnplannedForSlot(${i}, '${remStartStr}', '${remEndStr}', ${remMins}, '${escapeHTML(slot.title)}')"
                                         style="left: ${unfulfilledLeftPct}%; width: ${unfulfilledWidthPct}%" title="${remStartStr}–${remEndStr} | Sisa Rencana Tidak Terealisasi (${remMins}m dari rencana ${actPlannedMins}m) — Klik untuk tambah tugas baru/insidental di jam ini">
                                        <div class="px-1.5 py-0.5 h-full flex flex-col justify-center overflow-hidden pointer-events-none">
                                            <div class="text-[9px] font-bold text-rose-700 dark:text-rose-300 truncate leading-tight flex items-center gap-1">
                                                <i class="fa-solid fa-triangle-exclamation text-[7.5px] text-rose-500 shrink-0"></i>
                                                <span class="truncate">Tidak Terealisasi</span>
                                            </div>
                                            <div class="flex items-center gap-1 mt-0.5 flex-wrap">
                                                <span class="text-[8px] font-mono text-slate-500 dark:text-slate-400">${remStartStr}</span>
                                                <span class="text-[8px] font-bold text-rose-600 dark:text-rose-400">-${remMins}m</span>
                                                <span class="text-[7px] px-1 py-0.2 rounded bg-rose-100 dark:bg-rose-900/60 text-rose-700 dark:text-rose-300 font-extrabold border border-rose-300 dark:border-rose-800 shrink-0">Kurang</span>
                                            </div>
                                        </div>
                                    </div>`;
                            }
                        }
                    } else {
                        const isHbgAct = isActivityHbg(seg);
                        const hbgBadgeXs = renderHbgBadge(seg, 'xs');

                        // Belum dilaporkan — Rencana (Biru)
                        blockBg = 'bg-blue-50 dark:bg-blue-950/20';
                        blockBorder = 'border-blue-200 dark:border-blue-800/60';
                        blockText = 'text-blue-800 dark:text-blue-200';
                        borderLeftColor = 'border-l-blue-500';

                        const planBlockStyle = isLogPartialForMultiSlot
                            ? `style="left: ${leftPct}%; width: ${widthPct}%"`
                            : `style="left: ${actLeftPct}%; width: ${actWidthPct}%"`;

                        ganttBlocksHtml += `
                            <div class="absolute ${mainLaneCls} group rounded-md border ${blockBorder} ${blockBg} border-l-[3px] ${borderLeftColor} overflow-hidden transition-all hover:shadow-md hover:z-20"
                                 ${planBlockStyle} title="${curStartTimeStr}–${curEndTimeStr} | ${escapeHTML(slot.title)} (${curPlannedMins}m)${isHbgAct ? ' [Ranah HBG]' : ''} — Belum dilaporkan">
                                <div class="px-1.5 py-0.5 h-full flex flex-col justify-center overflow-hidden">
                                    <div class="text-[9px] font-bold ${blockText} truncate leading-tight">${escapeHTML(slot.title)}</div>
                                    <div class="flex items-center gap-1 mt-0.5 flex-wrap">
                                        <span class="text-[8px] font-mono text-slate-400">${curStartTimeStr}</span>
                                        <span class="text-[8px] font-semibold text-slate-400">${curPlannedMins}m</span>
                                        ${seg.is_teaching ? '<span class="text-[7px] px-0.5 rounded bg-blue-200 dark:bg-blue-800 text-blue-700 dark:text-blue-300 font-bold">KBM</span>' : ''}
                                        ${hbgBadgeXs}
                                    </div>
                                </div>
                                <!-- In-card actions: ✓ Terlaksana + ••• (Khusus KBM: Opsi Form demi Integritas Data Jurnal) -->
                                <div class="absolute top-0 right-0 flex items-center gap-0.5 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                    ${(() => {
                                        const isKbm = isTeachingActivity(seg);
                                        if (isKbm) {
                                            return `
                                                <button type="button" onclick="event.stopPropagation(); window.workloadOpenLogModal('${seg.activity_id}', false, 'tidak_terlaksana', ${i}, { customStart: '${curStartTimeStr}', customEnd: '${curEndTimeStr}' })" class="w-5 h-5 flex items-center justify-center rounded bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 text-[9px] transition-all cursor-pointer" title="Opsi Form (Jika KBM Tidak Terlaksana / Diganti)"><i class="fa-solid fa-ellipsis"></i></button>
                                            `;
                                        }
                                        const reportCheck = canReportActivityNow(dayDate, curEndTimeStr, 5);
                                        if (reportCheck.allowed) {
                                            return `
                                                <button type="button" data-quick-plan-id="${seg.activity_id}" onclick="window.workloadQuickReportComplete('${seg.activity_id}', ${i}, this)" class="w-5 h-5 flex items-center justify-center rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] transition-all cursor-pointer shadow-xs" title="1-klik Terlaksana"><i class="fa-solid fa-check"></i></button>
                                                <button type="button" onclick="window.workloadOpenLogModal('${seg.activity_id}', false, 'terlaksana', ${i}, { customStart: '${curStartTimeStr}', customEnd: '${curEndTimeStr}' })" class="w-5 h-5 flex items-center justify-center rounded bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 text-[9px] transition-all cursor-pointer" title="Detail/Opsi"><i class="fa-solid fa-ellipsis"></i></button>
                                            `;
                                        } else {
                                            return `
                                                <button type="button" disabled class="w-5 h-5 flex items-center justify-center rounded bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 text-[9px] cursor-not-allowed opacity-60" title="${escapeHTML(reportCheck.reason || 'Kegiatan belum berakhir')}"><i class="fa-solid fa-clock"></i></button>
                                                <button type="button" onclick="window.workloadOpenLogModal('${seg.activity_id}', false, 'draft', ${i}, { customStart: '${curStartTimeStr}', customEnd: '${curEndTimeStr}' })" class="w-5 h-5 flex items-center justify-center rounded bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 text-[9px] transition-all cursor-pointer shadow-xs" title="Upload Foto & Simpan Draf"><i class="fa-solid fa-ellipsis"></i></button>
                                            `;
                                        }
                                    })()}
                                </div>
                            </div>`;
                    }
                } else if (slot.type === 'break') {
                    ganttBlocksHtml += `
                        <div class="absolute ${mainLaneCls} rounded-md bg-amber-100/90 dark:bg-amber-950/40 border border-dashed border-amber-300 dark:border-amber-700/80 overflow-hidden pointer-events-none select-none z-20 text-amber-700 dark:text-amber-300 shadow-2xs"
                             style="left: ${leftPct}%; width: ${widthPct}%" title="Istirahat ${slot.startTime}–${slot.endTime} (${rawDuration}m)">
                            <div class="h-full flex items-center justify-center text-[8px] font-semibold gap-1 text-amber-600 dark:text-amber-400">
                                <i class="fa-solid fa-mug-hot text-[7px]"></i>
                                ${widthPct >= 5 ? `<span class="hidden sm:inline text-[7.5px] uppercase tracking-tighter">Istirahat</span>` : ''}
                            </div>
                        </div>`;
                } else if (slot.type === 'empty') {
                    // Bagian slot kosong yang sudah tertutup realisasi bergeser tidak perlu ditandai kosong lagi
                    subtractTimeRanges(clampedStart, clampedEnd, shiftedRanges).forEach(piece => {
                        const pieceLeftPct = ((piece.startMin - GANTT_START) / GANTT_TOTAL) * 100;
                        const pieceWidthPct = Math.min(((piece.endMin - piece.startMin) / GANTT_TOTAL) * 100, 100 - pieceLeftPct);
                        const pieceStartStr = minutesToTimeString(piece.startMin);
                        const pieceEndStr = minutesToTimeString(piece.endMin);
                        ganttBlocksHtml += `
                        <div class="absolute ${mainLaneCls} rounded-md bg-rose-50/30 dark:bg-rose-950/10 border border-dashed border-rose-200 dark:border-rose-900/30 overflow-hidden cursor-pointer hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-colors"
                             style="left: ${pieceLeftPct}%; width: ${pieceWidthPct}%"
                             title="Slot kosong ${pieceStartStr}–${pieceEndStr}" onclick="window.workloadOpenPlanItemModal(${i}, null, '${pieceStartStr}', '${pieceEndStr}')">
                            <div class="h-full flex items-center justify-center text-[8px] text-rose-400">
                                <i class="fa-solid fa-plus text-[7px]"></i>
                            </div>
                        </div>`;
                    });
                }
            });

            // Unplanned logs (di luar Gantt bar, tampil setelah bar jika belum dirender di Gantt)
            const unplannedLogs = dayLogs.filter(l => (l.is_unplanned === 1 || !planLinks.some(pl => pl.work_log_id === l.id)) && !renderedGanttLogIds.has(l.id));
            if (unplannedLogs.length > 0) {
                let unplannedHtml = '';
                unplannedLogs.forEach(uLog => {
                    const uMins = dayLogSegs.filter(ls => ls.work_log_id === uLog.id).reduce((s, ls) => s + (ls.actual_minutes || 0), 0);
                    const hasUEvidence = parseEvidencePhotos(uLog.evidence_url).length > 0 || (uLog.evidence_url && sanitizeUrl(uLog.evidence_url));
                    unplannedHtml += `
                        <span onclick="window.workloadOpenEditLogModal('${uLog.id}')" class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo-100 dark:bg-indigo-900/40 hover:bg-indigo-200 dark:hover:bg-indigo-900/70 text-indigo-700 dark:text-indigo-300 text-[9px] font-bold border border-indigo-200 dark:border-indigo-800 cursor-pointer transition-all hover:scale-105" title="${escapeHTML(uLog.title)} (${uMins}m, Mendadak) — Klik untuk edit laporan">
                            <i class="fa-solid fa-bolt text-[7px]"></i>${escapeHTML(uLog.title).substring(0, 20)}${(uLog.title || '').length > 20 ? '…' : ''} (${uMins}m)
                            ${hasUEvidence ? `
                                <button type="button" onclick="event.stopPropagation(); window.workloadOpenLightboxFromLogId('${uLog.id}')" class="text-blue-600 dark:text-blue-400 hover:text-blue-800 p-0.5 rounded hover:bg-blue-200 dark:hover:bg-blue-900/80 cursor-pointer" title="Buka Gambar Bukti Dukung"><i class="fa-solid fa-image text-[8px]"></i></button>
                            ` : ''}
                            <i class="fa-solid fa-pen-to-square text-[7px] opacity-60"></i>
                        </span>`;
                });
                ganttBlocksHtml += `<div class="absolute -bottom-5 left-0 right-0 flex items-center gap-1 flex-wrap overflow-hidden">${unplannedHtml}</div>`;
            }

            if (activityCount === 0 && unplannedLogs.length === 0) {
                ganttBlocksHtml = `
                    <div class="absolute inset-0 flex items-center justify-center text-slate-400 text-[10px]">
                        <button type="button" onclick="window.workloadOpenPlanItemModal(${i})" class="flex items-center gap-1 text-emerald-500 hover:text-emerald-700 font-bold cursor-pointer">
                            <i class="fa-solid fa-plus text-[9px]"></i> Tambah Rencana
                        </button>
                    </div>`;
            }
        }

        // Row border & bg
        const rowBorder = isToday ? 'ring-2 ring-emerald-500/20 border-emerald-500/60' : 'border-slate-200 dark:border-slate-800';
        const rowHeaderBg = isToday ? 'bg-emerald-50/80 dark:bg-emerald-950/30' : (isStudyDay ? 'bg-purple-50/60 dark:bg-purple-950/20' : 'bg-slate-50/80 dark:bg-slate-900/60');

        // Unplanned logs presence means we need extra bottom space
        const hasUnplanned = !isHoliday && !isLeave && dayLogs.some(l => l.is_unplanned === 1 || !planLinks.some(pl => pl.work_log_id === l.id));

        gridHtml += `
            <div class="bg-white dark:bg-slate-900 rounded-xl border ${rowBorder} shadow-xs overflow-hidden transition-all">
                <!-- Kontainer Baris: Flex vertikal di mobile (full-width), Flex horizontal berdampingan di desktop -->
                <div class="flex flex-col md:flex-row items-stretch md:min-h-[52px]">
                    <!-- Row Header: Lebar penuh (full-width) di mobile, Kompak di kiri pada desktop -->
                    <div class="w-full md:w-[140px] lg:w-[160px] md:shrink-0 ${rowHeaderBg} border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-800 p-2.5 md:p-2 cursor-pointer md:cursor-default select-none transition-colors"
                         onclick="window.workloadToggleDayCollapse('${collapseId}', 'gantt-arrow-${i}')">
                        
                        <!-- Tampilan Mobile Header (Dua sisi seimbang, 100% full width, tidak kosong di kanan) -->
                        <div class="flex items-center justify-between w-full md:hidden">
                            <div class="flex items-center gap-2.5 min-w-0">
                                ${progressRingHtml}
                                <div class="min-w-0">
                                    <div class="flex items-center gap-1.5 flex-wrap">
                                        <span class="font-bold text-xs sm:text-sm text-slate-800 dark:text-white">${DAY_NAMES[i]}</span>
                                        <span class="text-[10px] text-slate-400 font-medium">${dateShort}</span>
                                        ${absenceActionHtml}
                                        ${headerBadges}
                                    </div>
                                    <div class="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                                        ${isHoliday ? '<span class="text-amber-600 dark:text-amber-400 font-semibold">Libur Resmi</span>' : (isLeave ? '<span class="text-cyan-600 dark:text-cyan-400 font-semibold">Cuti / Izin</span>' : (isStudyDay ? '<span class="text-purple-600 dark:text-purple-400 font-semibold">Hari Belajar Guru</span>' : (activityCount > 0 ? `${activityCount} kegiatan terencana` : 'Belum ada agenda')))}
                                    </div>
                                </div>
                            </div>
                            <div class="flex items-center gap-2 shrink-0 ml-2">
                                <span class="text-[10px] font-bold px-2 py-0.5 rounded-md ${isTargetMet ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}">
                                    ${dayActualMinutes}/${isLeave ? 'Cuti' : (isHoliday ? '✓' : '450')}m
                                </span>
                                <i id="gantt-arrow-${i}" class="fa-solid fa-chevron-down text-xs text-slate-400 dark:text-slate-500 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}"></i>
                            </div>
                        </div>

                        <!-- Tampilan Desktop Header (Kompak Sisi Kiri) -->
                        <div class="hidden md:flex items-center gap-2">
                            ${progressRingHtml}
                            <div class="min-w-0 flex-1">
                                <div class="flex items-center justify-between gap-1 flex-wrap">
                                    <div class="flex items-center gap-1 min-w-0">
                                        <span class="font-bold text-xs text-slate-800 dark:text-white">${DAY_NAMES[i]}</span>
                                        <span class="text-[9px] text-slate-400 font-medium">${dateShort}</span>
                                    </div>
                                    ${absenceActionHtml}
                                </div>
                                <div class="flex items-center gap-1 mt-0.5 flex-wrap">
                                    ${headerBadges}
                                    <span class="text-[9px] ${isTargetMet ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-slate-400 font-medium'}">${dayActualMinutes}/${isLeave ? 'Cuti' : (isHoliday ? '✓' : '450')}m</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Gantt Timeline Area: Desktop selalu tampil, Mobile collapsible full width di bawah header -->
                    <div id="${collapseId}" class="w-full md:flex-1 relative ${hasUnplanned ? 'pb-6' : ''} ${isExpanded ? '' : 'hidden'} md:!block">
                        <!-- Background grid lines (Jam Pelajaran) — desktop only -->
                        <div class="absolute inset-0 hidden md:flex pointer-events-none">
                            ${STANDARD_JP_PERIODS.map(slot => {
                                const slotStartM = parseTime(slot.start);
                                const slotEndM = parseTime(slot.end);
                                const leftPct = ((slotStartM - GANTT_START) / GANTT_TOTAL) * 100;
                                const widthPct = ((slotEndM - slotStartM) / GANTT_TOTAL) * 100;
                                if (slot.isBreak) {
                                    return `<div class="absolute top-0 bottom-0 bg-slate-100/30 dark:bg-slate-800/20 border-r border-dashed border-slate-200/60 dark:border-slate-700/50" style="left: ${leftPct}%; width: ${widthPct}%"></div>`;
                                }
                                return `<div class="absolute top-0 bottom-0 border-r border-slate-100 dark:border-slate-800/40" style="left: ${leftPct}%; width: ${widthPct}%"></div>`;
                            }).join('')}
                        </div>

                        <!-- Desktop: Gantt proportional blocks -->
                        <div class="hidden md:block relative h-full ${hasOverlapLane ? 'min-h-[60px]' : 'min-h-[48px]'}">
                            ${ganttBlocksHtml}
                        </div>

                        <!-- Mobile: Card list fallback (Full width 100%, Touch-friendly) -->
                        <div class="md:hidden p-2.5 sm:p-3 space-y-2 bg-slate-50/50 dark:bg-slate-900/40">
                            ${isHoliday ? `
                                <div class="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-center text-amber-800 dark:text-amber-200 text-xs">
                                    <i class="fa-solid fa-umbrella-beach text-amber-500 text-lg mb-1 inline-block"></i>
                                    <div class="font-bold text-sm">${escapeHTML(dayTimeline.holidaySegment?.activity_title || dayTimeline.holidaySegment?.title || dayTimeline.slots[0]?.title || 'Hari Libur Resmi')}</div>
                                    <div class="text-[11px] text-amber-600 dark:text-amber-400 mt-1">Hari libur resmi sekolah. Bebas kewajiban jam dinas (450m telah dibebaskan).</div>
                                </div>
                            ` : isLeave ? `
                                <div class="p-3.5 rounded-xl bg-cyan-50 dark:bg-cyan-950/30 border border-cyan-200 dark:border-cyan-800/60 text-center text-cyan-800 dark:text-cyan-200 text-xs">
                                    <i class="fa-solid fa-calendar-xmark text-cyan-500 text-lg mb-1 inline-block"></i>
                                    <div class="font-bold text-sm">${escapeHTML(dayTimeline.leaveTitle || 'Cuti / Izin Resmi')}</div>
                                    <div class="text-[11px] text-cyan-600 dark:text-cyan-400 mt-1">${dayTimeline.leaveNotes ? escapeHTML(dayTimeline.leaveNotes) + ' • ' : ''}(0m Terencana • Bebas Jam Kerja)</div>
                                </div>
                            ` : (() => {
                                let mobileHtml = '';
                                dayTimeline.slots.forEach(slot => {
                                    if (slot.type === 'activity') {
                                        const seg = slot.segment || {};
                                        const linkedLog = dayLogs.find(l => planLinks.some(pl => pl.plan_activity_id === seg.activity_id && pl.work_log_id === l.id));
                                        const rawHasLog = !!linkedLog;

                                        const slotStartMins = parseTime(slot.startTime);
                                        const slotEndMins = parseTime(slot.endTime);
                                        const actStartMins = (seg.start_time && parseTime(seg.start_time) > 0) ? parseTime(seg.start_time) : slotStartMins;
                                        const actEndMins = (seg.end_time && parseTime(seg.end_time) > 0) ? parseTime(seg.end_time) : slotEndMins;
                                        const actPlannedMins = (seg.planned_minutes !== undefined && seg.planned_minutes !== null)
                                            ? parseInt(seg.planned_minutes, 10)
                                            : (slot.durationMinutes || (actEndMins - actStartMins));

                                        const segLogItems = rawHasLog ? dayLogSegs.filter(ls => ls.work_log_id === linkedLog.id && ls.start_time && ls.end_time) : [];
                                        const logStartMin = segLogItems.length > 0 ? Math.min(...segLogItems.map(ls => parseTime(ls.start_time))) : (linkedLog?.start_time ? parseTime(linkedLog.start_time) : 0);
                                        const logEndMin = segLogItems.length > 0 ? Math.max(...segLogItems.map(ls => parseTime(ls.end_time))) : (linkedLog?.end_time ? parseTime(linkedLog.end_time) : 0);
                                        const logActualMins = segLogItems.length > 0 ? segLogItems.reduce((s, ls) => s + (ls.actual_minutes || 0), 0) : (linkedLog ? calcEffective(linkedLog.start_time, linkedLog.end_time) : 0);

                                        // Deteksi apakah rencana bersifat multi-slot dan realisasi hanya mencakup sebagian slot
                                        const isMultiSlotPlan = actStartMins < slotStartMins || actEndMins > slotEndMins;
                                        const isLogPartialForMultiSlot = Boolean(
                                            rawHasLog && isMultiSlotPlan && linkedLog.status_execution !== 'tidak_terlaksana' && (
                                                logEndMin < actEndMins || logStartMin > actStartMins || logActualMins < actPlannedMins
                                            )
                                        );

                                        // Sub-slot spesifik ini hanya dianggap ber-log jika log mencakup interval waktu slot
                                        const hasLog = Boolean(rawHasLog && (
                                            linkedLog.status_execution === 'tidak_terlaksana' ||
                                            !isLogPartialForMultiSlot ||
                                            (Math.max(logStartMin, slotStartMins) < Math.min(logEndMin, slotEndMins))
                                        ));

                                        // Rencana yang tertimpa realisasi bergeser: baris ringkas di bawah kartu realisasi
                                        const shiftedMobile = realizationOverlap.shifted.get(seg.activity_id) || null;
                                        const overlapMobile = realizationOverlap.overlapped.get(seg.activity_id) || null;
                                        if (overlapMobile && !shiftedMobile) {
                                            const coverMobileStr = `${minutesToTimeString(overlapMobile.startMin)}–${minutesToTimeString(overlapMobile.endMin)}`;
                                            const isNotExecOverlap = linkedLog?.status_execution === 'tidak_terlaksana';
                                            const overlapAction = hasLog
                                                ? `window.workloadOpenEditLogModal('${linkedLog.id}')`
                                                : `window.workloadOpenLogModal('${seg.activity_id}', false, 'tidak_terlaksana', ${i})`;
                                            mobileHtml += `
                                            <div class="ml-4 flex items-center justify-between gap-2 px-2 py-1 rounded-lg border border-dashed ${isNotExecOverlap ? 'border-rose-300 dark:border-rose-800 bg-rose-50/60 dark:bg-rose-950/20' : 'border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/10'} text-[10px] text-slate-500 dark:text-slate-400 cursor-pointer" onclick="${overlapAction}" title="Beririsan dengan realisasi ${escapeHTML(overlapMobile.title)} (${coverMobileStr})">
                                                <div class="flex items-center gap-1.5 min-w-0">
                                                    <i class="fa-solid fa-turn-up fa-rotate-90 text-[8px] text-slate-400 shrink-0"></i>
                                                    <span class="font-mono shrink-0">${slot.startTime}–${slot.endTime}</span>
                                                    <span class="truncate ${isNotExecOverlap ? 'line-through' : ''}">${escapeHTML(slot.title)}</span>
                                                </div>
                                                <span class="text-[8px] px-1 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold border border-slate-200 dark:border-slate-700 shrink-0">${isNotExecOverlap ? 'Tidak Terlaksana' : 'Beririsan'}</span>
                                            </div>`;
                                            return;
                                        }

                                        const photos = parseEvidencePhotos(linkedLog?.evidence_url);
                                        const hasEvidence = photos.length > 0 || (linkedLog?.evidence_url && sanitizeUrl(linkedLog.evidence_url));
                                        const isDraftLog = linkedLog?.status_execution === 'draft';
                                        const isHbgAct = isActivityHbg(seg);
                                        const hbgBadgeXs = renderHbgBadge(seg, 'xs');

                                        let statusCls, statusIcon, borderL;
                                        const linkObj = hasLog ? planLinks.find(pl => pl.plan_activity_id === seg.activity_id && pl.work_log_id === linkedLog.id) : null;
                                        const isSubstituted = Boolean(hasLog && (linkObj?.link_type === 'substitution' || linkedLog?.status_execution === 'diganti'));
                                        const isNotExecuted = Boolean(hasLog && linkedLog?.status_execution === 'tidak_terlaksana');
                                        const mobileTitle = isSubstituted
                                            ? (linkedLog.title || linkObj?.reason_notes || linkedLog.substitute_notes || slot.title)
                                            : slot.title;

                                        const actualMins = hasLog ? (
                                            isLogPartialForMultiSlot
                                                ? Math.max(0, Math.min(logEndMin, slotEndMins) - Math.max(logStartMin, slotStartMins))
                                                : (segLogItems.length > 0 ? segLogItems.reduce((s, ls) => s + (ls.actual_minutes || 0), 0) : (linkedLog ? calcEffective(linkedLog.start_time, linkedLog.end_time) : 0))
                                        ) : 0;
                                        const isPartialMobile = Boolean(!shiftedMobile && hasLog && !isNotExecuted && !isDraftLog && actualMins > 0 && actualMins < slot.durationMinutes);
                                        const unfulfilledMobileMins = isPartialMobile ? (slot.durationMinutes - actualMins) : 0;
                                        const splitMobileStr = isPartialMobile ? minutesToTimeString(slotStartMins + actualMins) : slot.endTime;

                                        if (hasLog) {
                                            if (linkedLog.status_execution === 'sebagian' || isPartialMobile) {
                                                statusCls = 'bg-amber-50/80 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800';
                                                statusIcon = '<i class="fa-solid fa-clock-rotate-left text-amber-500 text-xs" title="Terlaksana Parsial"></i>';
                                                borderL = 'border-l-amber-500';
                                            } else if (isNotExecuted) {
                                                statusCls = 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/50';
                                                statusIcon = '<span class="px-1.5 py-0.5 rounded text-[8px] font-bold bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 flex items-center gap-0.5"><i class="fa-solid fa-xmark text-[8px]"></i> Tidak Terlaksana</span>';
                                                borderL = 'border-l-rose-500';
                                            } else {
                                                statusCls = 'bg-emerald-50/80 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800';
                                                statusIcon = '<i class="fa-solid fa-circle-check text-emerald-500 text-xs"></i>';
                                                borderL = 'border-l-emerald-500';
                                            }
                                        } else {
                                            statusCls = 'bg-blue-50/70 dark:bg-blue-950/10 border-blue-200 dark:border-blue-800';
                                            statusIcon = '<i class="fa-regular fa-clock text-blue-400 text-xs"></i>';
                                            borderL = 'border-l-blue-500';
                                        }

                                        const canEditMobile = hasLog && !isLogLockedByManualVerification(linkedLog);
                                        mobileHtml += `
                                            <div class="flex items-center justify-between gap-2.5 p-2 sm:p-2.5 rounded-xl border ${statusCls} border-l-4 ${borderL} bg-white dark:bg-slate-800 shadow-2xs hover:shadow-xs transition-all ${canEditMobile ? 'cursor-pointer hover:border-emerald-300 dark:hover:border-emerald-700' : ''}" ${canEditMobile ? `onclick="window.workloadOpenEditLogModal('${linkedLog.id}')" title="Klik untuk mengedit laporan"` : ''}>
                                                <div class="flex-1 min-w-0 pr-1">
                                                    <div class="text-xs font-bold text-slate-800 dark:text-white truncate leading-tight">
                                                        <span class="truncate ${isNotExecuted ? 'line-through text-slate-400 dark:text-slate-500' : ''}">${isSubstituted ? '<i class="fa-solid fa-arrows-rotate text-[10px] text-emerald-600 dark:text-emerald-400 mr-1"></i>' : ''}${isNotExecuted ? '<i class="fa-solid fa-circle-xmark text-rose-500 text-[10px] mr-1"></i>' : ''}${escapeHTML(mobileTitle)}</span>
                                                    </div>
                                                    <div class="flex items-center gap-1.5 mt-1 flex-wrap text-[10px] text-slate-500 dark:text-slate-400">
                                                        ${isPartialMobile ? `
                                                            <span class="font-mono font-medium">${slot.startTime}–${splitMobileStr}</span>
                                                            <span>•</span>
                                                            <span class="font-bold text-amber-600 dark:text-amber-400">${actualMins}m</span>
                                                            <span class="text-slate-400 text-[9px]">/ ${slot.durationMinutes}m</span>
                                                            <span class="text-[8px] px-1 py-0.2 rounded bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200 font-extrabold border border-amber-300 dark:border-amber-700 flex items-center gap-0.5"><i class="fa-solid fa-clock-rotate-left text-[6px]"></i> Parsial</span>
                                                        ` : shiftedMobile ? `
                                                            <span class="font-mono font-medium">${minutesToTimeString(shiftedMobile.startMin)}–${minutesToTimeString(shiftedMobile.endMin)}</span>
                                                            <span>•</span>
                                                            <span class="font-semibold text-slate-600 dark:text-slate-300">${actualMins}m</span>
                                                            <span class="text-slate-400 text-[9px]">(rencana ${slot.startTime}–${slot.endTime})</span>
                                                        ` : `
                                                            <span class="font-mono font-medium">${slot.startTime}–${slot.endTime}</span>
                                                            <span>•</span>
                                                            <span class="font-semibold text-slate-600 dark:text-slate-300">${slot.durationMinutes}m</span>
                                                        `}
                                                        ${seg.is_teaching ? '<span class="text-[8px] px-1 py-0.2 rounded bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 font-bold border border-blue-200 dark:border-blue-800">KBM</span>' : ''}
                                                        ${hbgBadgeXs}
                                                        ${isDraftLog ? '<span class="text-[8px] px-1.5 py-0.2 rounded bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200 font-extrabold border border-amber-300 dark:border-amber-700">Draf</span>' : ''}
                                                    </div>
                                                </div>
                                                <div class="flex items-center gap-1.5 shrink-0">
                                                    ${statusIcon}
                                                    ${!hasLog ? (() => {
                                                        const isKbm = isTeachingActivity(seg);
                                                        if (isKbm) {
                                                            return `
                                                                <a href="jurnal.html" target="_blank" onclick="event.stopPropagation()" class="h-7 px-2 sm:px-2.5 flex items-center justify-center gap-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-[10px] font-bold shadow-2xs transition-all" title="Buka Jurnal Mengajar Digital untuk mengisi realisasi KBM">
                                                                    <i class="fa-solid fa-book-open text-xs text-indigo-600 dark:text-indigo-400"></i>
                                                                    <span>Isi Jurnal</span>
                                                                </a>
                                                                <button type="button" onclick="event.stopPropagation(); window.workloadOpenLogModal('${seg.activity_id}', false, 'tidak_terlaksana', ${i})" class="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 text-xs cursor-pointer border border-slate-200 dark:border-slate-600 transition-all" title="Opsi Form (Jika KBM Tidak Terlaksana / Diganti)">
                                                                    <i class="fa-solid fa-ellipsis"></i>
                                                                </button>
                                                            `;
                                                        }
                                                        const reportCheckMobile = canReportActivityNow(dayDate, slot.endTime, 5);
                                                        if (reportCheckMobile.allowed) {
                                                            return `
                                                                <button type="button" data-quick-plan-id="${seg.activity_id}" onclick="event.stopPropagation(); window.workloadQuickReportComplete('${seg.activity_id}', ${i}, this)" class="h-7 px-2 sm:px-2.5 flex items-center justify-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-[10px] font-bold cursor-pointer shadow-xs transition-all" title="1-Klik Terlaksana">
                                                                    <i class="fa-solid fa-check text-xs"></i>
                                                                    <span>Terlaksana</span>
                                                                </button>
                                                                <button type="button" onclick="event.stopPropagation(); window.workloadOpenLogModal('${seg.activity_id}', false, 'terlaksana', ${i})" class="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 text-xs cursor-pointer border border-slate-200 dark:border-slate-600 transition-all" title="Opsi Formulir Lengkap">
                                                                    <i class="fa-solid fa-ellipsis"></i>
                                                                </button>
                                                            `;
                                                        } else {
                                                            return `
                                                                <button type="button" disabled class="h-7 px-2 flex items-center justify-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 text-[10px] cursor-not-allowed opacity-70 border border-slate-200 dark:border-slate-700" title="${escapeHTML(reportCheckMobile.reason || 'Kegiatan belum berakhir')}">
                                                                    <i class="fa-solid fa-clock text-xs"></i>
                                                                </button>
                                                                <button type="button" onclick="event.stopPropagation(); window.workloadOpenLogModal('${seg.activity_id}', false, 'draft', ${i})" class="h-7 px-2 flex items-center justify-center gap-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 text-[10px] font-semibold cursor-pointer border border-slate-200 dark:border-slate-600 transition-all shadow-2xs" title="Upload Foto & Simpan Draf">
                                                                    <i class="fa-solid fa-camera text-[10px] text-indigo-500"></i>
                                                                    <span class="hidden xs:inline">Draf</span>
                                                                </button>
                                                            `;
                                                        }
                                                    })() : `
                                                        ${hasEvidence ? `
                                                            <button type="button" onclick="event.stopPropagation(); window.workloadOpenLightboxFromLogId('${linkedLog.id}')" class="h-7 px-2 flex items-center justify-center gap-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold border border-indigo-200 dark:border-indigo-800 transition-all cursor-pointer" title="Buka Gambar Bukti">
                                                                <i class="fa-solid fa-image text-[10px]"></i>
                                                                <span class="hidden xs:inline">Bukti</span>
                                                            </button>
                                                        ` : ''}
                                                        ${canEditMobile ? `
                                                            <button type="button" onclick="event.stopPropagation(); window.workloadOpenEditLogModal('${linkedLog.id}')" class="h-7 px-2.5 flex items-center justify-center gap-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold cursor-pointer border border-emerald-200 dark:border-emerald-800 transition-all shadow-2xs" title="Edit Laporan">
                                                                <i class="fa-solid fa-pen-to-square text-[10px]"></i>
                                                                <span>Edit</span>
                                                            </button>
                                                        ` : ''}
                                                    `}
                                                </div>
                                            </div>`;

                                        if (isPartialMobile && unfulfilledMobileMins > 0) {
                                            const mobileSplitMin = slotStartMins + actualMins;
                                            const mobileEndMin = parseTime(slot.endTime);
                                            const isCoveredByOtherLog = dayLogs.some(l => {
                                                if (l.id === linkedLog.id || l.status_execution === 'tidak_terlaksana') return false;
                                                const lSegs = dayLogSegs.filter(ls => ls.work_log_id === l.id);
                                                const lStart = lSegs[0]?.start_time || l.start_time;
                                                const lEnd = lSegs[lSegs.length - 1]?.end_time || l.end_time;
                                                if (!lStart || !lEnd) return false;
                                                return Math.max(mobileSplitMin, parseTime(lStart)) < Math.min(mobileEndMin, parseTime(lEnd));
                                            });

                                            if (!isCoveredByOtherLog) {
                                                mobileHtml += `
                                                    <div class="flex items-center justify-between gap-2 p-2 sm:p-2.5 rounded-xl bg-rose-50/70 dark:bg-rose-950/20 border border-dashed border-rose-300 dark:border-rose-800 border-l-4 border-l-rose-500 text-[10px] text-rose-700 dark:text-rose-300 cursor-pointer hover:bg-rose-100/50 transition-colors shadow-2xs" onclick="window.workloadOpenAddUnplannedForSlot(${i}, '${splitMobileStr}', '${slot.endTime}', ${unfulfilledMobileMins}, '${escapeHTML(mobileTitle)}')" title="Klik untuk menambah realisasi baru di jam ini">
                                                        <div class="flex items-center gap-1.5 font-bold truncate">
                                                            <i class="fa-solid fa-triangle-exclamation text-rose-500 text-xs shrink-0"></i>
                                                            <span class="truncate">${splitMobileStr}–${slot.endTime} Sisa Belum Terealisasi (${unfulfilledMobileMins}m)</span>
                                                        </div>
                                                        <button type="button" onclick="event.stopPropagation(); window.workloadOpenAddUnplannedForSlot(${i}, '${splitMobileStr}', '${slot.endTime}', ${unfulfilledMobileMins}, '${escapeHTML(mobileTitle)}')" class="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-bold text-[9px] transition-all cursor-pointer shadow-xs shrink-0 flex items-center gap-1">
                                                            <i class="fa-solid fa-plus text-[8px]"></i>
                                                            <span>Tambah</span>
                                                        </button>
                                                    </div>`;
                                            }
                                        }
                                    } else if (slot.type === 'break') {
                                        mobileHtml += `
                                            <div class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-100/60 dark:bg-slate-800/30 border border-dashed border-slate-200 dark:border-slate-700 text-[10px] text-slate-400">
                                                <i class="fa-solid fa-mug-hot text-amber-500 text-xs"></i>
                                                <span class="font-medium">${slot.startTime}–${slot.endTime} Istirahat (${slot.durationMinutes}m)</span>
                                            </div>`;
                                    } else if (slot.type === 'empty') {
                                        mobileHtml += `
                                            <div class="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-rose-50/40 dark:bg-rose-950/10 border border-dashed border-rose-200 dark:border-rose-900/30 text-[10px] text-rose-500">
                                                <div class="flex items-center gap-1.5 font-medium">
                                                    <i class="fa-solid fa-hourglass-start text-[10px]"></i>
                                                    <span>${slot.startTime}–${slot.endTime} Slot Kosong (${slot.durationMinutes}m)</span>
                                                </div>
                                                <button type="button" onclick="window.workloadOpenPlanItemModal(${i}, null, '${slot.startTime}', '${slot.endTime}')" class="px-2 py-0.5 rounded bg-rose-100 hover:bg-rose-200 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 font-bold text-[9px] transition-all cursor-pointer">
                                                    + Isi
                                                </button>
                                            </div>`;
                                    }
                                });

                                // Mobile unplanned
                                const unplannedLogs = dayLogs.filter(l => l.is_unplanned === 1 || !planLinks.some(pl => pl.work_log_id === l.id));
                                unplannedLogs.forEach(uLog => {
                                    const uMins = dayLogSegs.filter(ls => ls.work_log_id === uLog.id).reduce((s, ls) => s + (ls.actual_minutes || 0), 0);
                                    const canEditUnpMobile = !isLogLockedByManualVerification(uLog);
                                    const photos = parseEvidencePhotos(uLog.evidence_url);
                                    const hasUEvidence = photos.length > 0 || (uLog.evidence_url && sanitizeUrl(uLog.evidence_url));
                                    mobileHtml += `
                                        <div class="flex items-center justify-between gap-2 p-2 sm:p-2.5 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/30 dark:bg-indigo-950/10 border-l-4 border-l-indigo-500 ${canEditUnpMobile ? 'cursor-pointer hover:bg-indigo-100/40' : ''}" ${canEditUnpMobile ? `onclick="window.workloadOpenEditLogModal('${uLog.id}')" title="Klik untuk mengedit laporan"` : ''}>
                                            <div class="flex-1 min-w-0 pr-1">
                                                <div class="text-xs font-bold text-slate-800 dark:text-white truncate">
                                                    <span class="truncate">${escapeHTML(uLog.title)}</span>
                                                </div>
                                                <div class="flex items-center gap-1.5 mt-1 text-[10px] text-slate-400">
                                                    <span class="text-indigo-600 dark:text-indigo-400 font-bold">Mendadak</span>
                                                    <span>•</span>
                                                    <span class="font-semibold text-slate-600 dark:text-slate-300">${uMins}m</span>
                                                </div>
                                            </div>
                                            <div class="flex items-center gap-1.5 shrink-0">
                                                ${hasUEvidence ? `
                                                    <button type="button" onclick="event.stopPropagation(); window.workloadOpenLightboxFromLogId('${uLog.id}')" class="h-7 px-2 flex items-center justify-center gap-1 rounded-lg bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold transition-all cursor-pointer" title="Buka Gambar Bukti">
                                                        <i class="fa-solid fa-image text-[10px]"></i>
                                                        <span class="hidden xs:inline">Bukti</span>
                                                    </button>
                                                ` : ''}
                                                ${canEditUnpMobile ? `
                                                    <button type="button" onclick="event.stopPropagation(); window.workloadOpenEditLogModal('${uLog.id}')" class="h-7 px-2.5 flex items-center justify-center gap-1 rounded-lg bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold cursor-pointer transition-all" title="Edit Laporan">
                                                        <i class="fa-solid fa-pen-to-square text-[10px]"></i>
                                                        <span>Edit</span>
                                                    </button>
                                                ` : ''}
                                            </div>
                                        </div>`;
                                });

                                if (mobileHtml === '') {
                                    mobileHtml = `
                                        <div class="text-center py-4 text-slate-400 text-xs">
                                            <p class="mb-2 text-slate-500 dark:text-slate-400">Belum ada agenda rencana kegiatan pada hari ini.</p>
                                            <button type="button" onclick="window.workloadOpenPlanItemModal(${i})" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 font-bold text-xs transition-all cursor-pointer border border-emerald-200 dark:border-emerald-800">
                                                <i class="fa-solid fa-plus text-xs"></i> <span>Tambah Rencana</span>
                                            </button>
                                        </div>`;
                                }
                                return mobileHtml;
                            })()}
                        </div>
                    </div>
                </div>
            </div>`;
    }

    grid.innerHTML = gridHtml;
}

/**
 * Helper untuk toggle expand/collapse baris harian pada mobile matriks realisasi.
 * Aturan UX:
 * 1. Single-open Accordion: Ketika me-expand hari tertentu, hari-hari lain otomatis collaps.
 * 2. Baris yang sedang terbuka dapat ditutup kembali dengan mengkliknya.
 */
export function toggleDayCollapse(collapseId, arrowId) {
    if (window.innerWidth >= 768) return;
    const elCollapse = el(collapseId) || document.getElementById(collapseId);
    const elArrow = el(arrowId) || document.getElementById(arrowId);
    if (!elCollapse) return;

    const isCurrentlyHidden = elCollapse.classList.contains('hidden');

    if (isCurrentlyHidden) {
        // Expand baris target & otomatis tutup seluruh baris hari lainnya (accordion mode)
        const allBodies = document.querySelectorAll('[id^="gantt-row-body-"]');
        allBodies.forEach(body => {
            if (body.id !== collapseId) {
                body.classList.add('hidden');
            }
        });

        const allArrows = document.querySelectorAll('[id^="gantt-arrow-"]');
        allArrows.forEach(arrow => {
            if (arrow.id !== arrowId) {
                arrow.classList.remove('rotate-180');
            }
        });

        elCollapse.classList.remove('hidden');
        if (elArrow) elArrow.classList.add('rotate-180');
    } else {
        // Collaps baris target
        elCollapse.classList.add('hidden');
        if (elArrow) elArrow.classList.remove('rotate-180');
    }
}
window.workloadToggleDayCollapse = toggleDayCollapse;

export function renderSingleDayFocusView() {
    const container = el('today-timeline-container');
    if (!container) return;

    const dayDate = dateOfDay(_weekStartDate, _selectedDayIndex);
    const dayOfWeek = _selectedDayIndex + 1;
    const labelEl = el('current-selected-day-label');
    if (labelEl) labelEl.textContent = `${DAY_NAMES[_selectedDayIndex]} (${dayDate})`;

    const segments = (_weekData?.segments || []).filter(s => s.date === dayDate);
    const logs = (_weekData?.logs || []).filter(l => l.date === dayDate);
    const logSegments = _weekData?.log_segments || [];
    const planLinks = _weekData?.plan_links || [];

    // Deteksi dan jalankan sinkronisasi senyap otomatis di latar belakang jika ada KBM yang belum tertaut
    const linkedPlanIds = new Set(planLinks.map(pl => pl.plan_activity_id));
    const hasUnlinkedKbm = segments.some(seg => {
        const isTeaching = seg.is_teaching === 1 || seg.catalog_id === 'cat_kbm' || seg.category_code === 'PELAKSANAAN_KBM';
        const hasLog = linkedPlanIds.has(seg.activity_id) || logs.some(l => {
            return planLinks.some(pl => pl.plan_activity_id === seg.activity_id && pl.work_log_id === l.id);
        });
        return isTeaching && !hasLog;
    });

    if (hasUnlinkedKbm && !_journalAutoSyncedDates.has(dayDate)) {
        const check = canTriggerSilentJournalSync(dayDate);
        if (check.allowed) {
            _journalAutoSyncedDates.add(dayDate);
            try {
                if (check.storageKey && typeof localStorage !== 'undefined') {
                    localStorage.setItem(check.storageKey, '1');
                }
            } catch (e) {
                console.warn('[SilentJournalSync] Storage write error:', e);
            }
            // Smart Jitter Staggering: sebarkan jeda acak 1.5s - 8.5s untuk meratakan lonjakan beban serentak pukul 15:00 WITA
            const jitterMs = 1500 + Math.floor(Math.random() * 7000);
            setTimeout(() => triggerSilentJournalSync(dayDate), jitterMs);
        }
    }

    // Hitung total menit hari ini
    let dayPlanMinutes = 0;
    segments.forEach(s => dayPlanMinutes += (s.planned_minutes || 0));
    let dayActualMinutes = 0;
    const dayLogIds = new Set(logs.map(l => l.id));
    const dayLogSegs = logSegments.filter(ls => dayLogIds.has(ls.work_log_id));
    dayLogSegs.forEach(ls => dayActualMinutes += (ls.actual_minutes || 0));

    const isSelectedToday = dayDate === todayWITA();
    const labelDayTotal = el('label-day-total');
    if (labelDayTotal) {
        labelDayTotal.textContent = isSelectedToday ? 'Total Hari Ini:' : `Total ${DAY_NAMES[_selectedDayIndex]}:`;
    }
    const badgeDayTotal = el('badge-day-total-minutes');
    if (badgeDayTotal) badgeDayTotal.textContent = `${dayActualMinutes} / 450 m`;

    const smartSyncBtnHtml = `
        <div class="flex items-center justify-between p-2.5 px-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/60 mb-3 text-xs">
            <div class="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium flex items-center gap-1.5">
                <i class="fa-solid fa-circle-check text-emerald-500"></i>
                <span>Realisasi KBM terhubung otomatis dengan Jurnal Mengajar di kelas (0 input manual)</span>
            </div>
        </div>`;

    // Banner Interaktif Hari Belajar Guru (SE Mendikdasmen No. 5684/2025)
    let studyDayBannerHtml = '';
    if (_selectedDayIndex === _studyDayIndex) {
        const hasMgmp = checkHasPkActivity(segments, _selectedDayIndex);
        studyDayBannerHtml = `
            <div class="p-3 sm:p-4 rounded-xl bg-purple-50/80 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800/60 mb-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                <div class="flex items-start gap-3">
                    <div class="w-9 h-9 rounded-xl bg-purple-600 text-white flex items-center justify-center text-base shrink-0 shadow-xs">
                        <i class="fa-solid fa-graduation-cap"></i>
                    </div>
                    <div>
                        <div class="flex items-center gap-2 flex-wrap">
                            <span class="font-bold text-purple-900 dark:text-purple-200 text-xs sm:text-sm">Hari Belajar Guru (SE No. 5684/2025)</span>
                            <span class="text-[9px] px-2 py-0.5 rounded-full bg-purple-200/80 dark:bg-purple-900/80 text-purple-800 dark:text-purple-200 font-extrabold uppercase">${_studyDayIsAuto ? 'Terdeteksi Otomatis' : 'Pilihan Guru'}</span>
                            ${hasMgmp ? '<span class="text-[9px] px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 font-bold flex items-center gap-1"><i class="fa-solid fa-check"></i> PKB/MGMP Terjadwal</span>' : '<span class="text-[9px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 font-bold flex items-center gap-1"><i class="fa-solid fa-circle-exclamation"></i> Belum Ada MGMP</span>'}
                        </div>
                        <p class="text-purple-700 dark:text-purple-300 text-[11px] mt-0.5">Hari ini difokuskan untuk Pengembangan Keprofesian Berkelanjutan (MGMP, PMM, riset, atau belajar bersama).</p>
                    </div>
                </div>
                <div class="flex items-center gap-2 w-full sm:w-auto justify-end">
                    <button type="button" onclick="window.workloadQuickAddMgmp(${_selectedDayIndex})" class="w-full sm:w-auto px-3 py-1.5 bg-purple-600 hover:bg-purple-700 active:bg-purple-800 text-white rounded-xl text-xs font-bold shadow-xs transition-all flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer">
                        <i class="fa-solid fa-plus-circle text-xs"></i> <span>+ Tambah MGMP / Belajar Bersama</span>
                    </button>
                </div>
            </div>`;
    }

    const dayTimeline = calculateDayTimelineSlots(dayDate, segments, {
        policy: _policy,
        isHolidayFn: (d) => isHolidayDate(d),
        getHolidayInfoFn: (d) => getHolidayDateInfo(d)
    });

    if (dayTimeline.isHoliday) {
        const hTitle = escapeHTML(dayTimeline.holidayTitle || dayTimeline.slots[0]?.title || 'Libur / Dispensasi Resmi');
        container.innerHTML = `
            ${smartSyncBtnHtml}
            <div class="p-4 sm:p-5 my-2 rounded-2xl bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 text-amber-900 dark:text-amber-200">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/60 flex items-center justify-center shrink-0">
                        <i class="fa-solid fa-umbrella-beach text-amber-600 dark:text-amber-400 text-lg"></i>
                    </div>
                    <div>
                        <div class="font-extrabold text-sm text-amber-900 dark:text-amber-100">${hTitle}</div>
                        <div class="text-xs text-amber-700 dark:text-amber-300 mt-0.5">Hari ini merupakan hari libur resmi yang diakui sekolah. Jam kerja hari ini (450 menit) telah dibebaskan dari target mingguan.</div>
                    </div>
                </div>
            </div>`;
        updateUnplannedAbsenceUI(dayDate, _selectedDayIndex, logs, segments);
        return;
    }

    if (dayTimeline.isLeave) {
        const lTitle = escapeHTML(dayTimeline.leaveTitle || dayTimeline.leaveSegment?.title || 'Cuti / Izin Resmi');
        const lNotes = dayTimeline.leaveNotes ? escapeHTML(dayTimeline.leaveNotes) : 'Hari ini ditandai sebagai Cuti/Izin Resmi.';
        container.innerHTML = `
            ${smartSyncBtnHtml}
            <div class="p-4 sm:p-5 my-2 rounded-2xl bg-cyan-50/80 dark:bg-cyan-950/40 border border-cyan-200 dark:border-cyan-900/60 text-cyan-900 dark:text-cyan-200">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl bg-cyan-100 dark:bg-cyan-900/60 flex items-center justify-center shrink-0">
                        <i class="fa-solid fa-calendar-xmark text-cyan-600 dark:text-cyan-400 text-lg"></i>
                    </div>
                    <div>
                        <div class="font-extrabold text-sm text-cyan-900 dark:text-cyan-100">${lTitle}</div>
                        <div class="text-xs text-cyan-700 dark:text-cyan-300 mt-0.5">${lNotes} (0m Terencana • Bebas Jam Kerja dari target mingguan).</div>
                    </div>
                </div>
            </div>`;
        updateUnplannedAbsenceUI(dayDate, _selectedDayIndex, logs, segments);
        return;
    }

    if (segments.length === 0 && logs.length === 0) {
        container.innerHTML = `
            ${studyDayBannerHtml}
            ${smartSyncBtnHtml}
            <div class="text-center py-10 text-slate-400 text-xs">
                <i class="fa-regular fa-calendar-xmark text-4xl mb-3 text-slate-300"></i>
                <p class="font-semibold text-sm text-slate-500 dark:text-slate-400 mb-1">Belum ada rencana kegiatan pada hari ${DAY_NAMES[_selectedDayIndex]}</p>
                <p>Tambahkan kegiatan melalui Tab "Rencana Mingguan" atau klik tombol "Lapor Realisasi" untuk melaporkan pekerjaan mendadak.</p>
            </div>`;
        updateUnplannedAbsenceUI(dayDate, _selectedDayIndex, logs, segments);
        return;
    }

    // Build timeline cards
    let html = studyDayBannerHtml + smartSyncBtnHtml;

    segments.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
    segments.forEach(seg => {
        const hasLog = linkedPlanIds.has(seg.activity_id) || logs.some(l => {
            return planLinks.some(pl => pl.plan_activity_id === seg.activity_id && pl.work_log_id === l.id);
        });

        const linkedLog = logs.find(l => planLinks.some(pl => pl.plan_activity_id === seg.activity_id && pl.work_log_id === l.id));
        const logStatus = linkedLog ? linkedLog.verification_status : null;

        let statusBadge = '';
        let actionButtons = '';
        let cardBorderCls = 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/50';
        let substituteInfoHtml = '';

        if (hasLog && linkedLog) {
            const linkObj = planLinks.find(pl => pl.plan_activity_id === seg.activity_id && pl.work_log_id === linkedLog.id);
            const isSubstituted = linkObj?.link_type === 'substitution' || linkedLog.status_execution === 'diganti';
            const isJournalLog = (linkedLog.id || '').startsWith('wl_jurnal_');
            const journalBadge = isJournalLog ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 flex items-center gap-1">📘 Dari Jurnal KBM</span>` : '';

            let execBadge = '';
            if (isSubstituted && linkedLog.status_execution !== 'draft') {
                execBadge = `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center gap-1"><i class="fa-solid fa-arrows-rotate text-[8px]"></i><span>Diganti</span></span>`;
                cardBorderCls = 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/30 dark:bg-emerald-950/10';
                const subNote = linkObj?.reason_notes || linkedLog.substitute_notes || linkedLog.title;
                const plannedOriginalTitle = seg.activity_title || seg.description || 'Kegiatan Terencana';
                substituteInfoHtml = `
                    <div class="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1.5 flex-wrap" title="Diganti oleh: ${escapeHTML(subNote)}">
                        <span class="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1"><i class="fa-solid fa-arrows-rotate text-[10px]"></i> Menggantikan rencana:</span>
                        <span class="line-through opacity-75">${escapeHTML(plannedOriginalTitle)}</span>
                    </div>
                    ${(subNote && subNote !== linkedLog.title) ? `<div class="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold mt-0.5 flex items-center gap-1"><i class="fa-solid fa-circle-info text-[10px]"></i><span>Catatan: ${escapeHTML(subNote)}</span></div>` : ''}`;
            } else if (linkedLog.status_execution === 'draft') {
                execBadge = `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200 flex items-center gap-1 border border-amber-300 dark:border-amber-700"><i class="fa-solid fa-bookmark text-[8px]"></i><span>Draf / Sedang Berlangsung</span></span>`;
                cardBorderCls = 'border-amber-300 dark:border-amber-700 bg-amber-50/20 dark:bg-amber-950/10';
            } else if (linkedLog.status_execution === 'sebagian') {
                execBadge = `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 flex items-center gap-1"><i class="fa-solid fa-clock text-[8px]"></i><span>Sebagian</span></span>`;
                cardBorderCls = 'border-amber-200 dark:border-amber-900/50 bg-amber-50/20 dark:bg-amber-950/10';
            } else if (linkedLog.status_execution === 'tidak_terlaksana') {
                const absenceMatch = (linkedLog.obstacle_notes || '').match(/^\[(Sakit|Cuti|Izin)\]/i);
                const absenceTypeStr = absenceMatch ? ` (${absenceMatch[1]})` : '';
                execBadge = `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 flex items-center gap-1 border border-rose-200 dark:border-rose-800"><i class="fa-solid fa-circle-xmark text-[8px]"></i><span>Tidak Terlaksana${absenceTypeStr}</span></span>`;
                cardBorderCls = 'border-rose-200 dark:border-rose-900/40 bg-rose-50/20 dark:bg-rose-950/10';
            } else {
                execBadge = `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center gap-1"><i class="fa-solid fa-check text-[8px]"></i><span>Terlaksana</span></span>`;
                cardBorderCls = 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/30 dark:bg-emerald-950/10';
            }

            const isAuto = linkedLog.verified_by_uid === 'system_auto_policy' || (_policy && Number(_policy.require_log_verification) === 0);
            const verText = isAuto ? 'Terverifikasi (Otomatis)' : 'Terverifikasi (Kepsek)';
            const verTitle = isAuto ? 'Terverifikasi otomatis oleh sistem (Mode Mandiri)' : 'Telah diverifikasi dan disetujui oleh Kepala Sekolah';

            const vMap = {
                'unverified': { text: 'Dilaporkan', cls: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300', title: 'Telah dilaporkan, menunggu verifikasi Kepala Sekolah' },
                'verified': { text: verText, cls: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300', title: verTitle },
                'rejected': { text: 'Ditolak', cls: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300', title: 'Laporan ditolak oleh Kepala Sekolah' }
            };
            const vs = vMap[logStatus] || vMap['unverified'];
            statusBadge = `${journalBadge} ${execBadge} <span class="px-2 py-0.5 rounded-lg text-[10px] font-bold ${vs.cls}" title="${vs.title}">${vs.text}</span>`;

            const canEditFocus = !isLogLockedByManualVerification(linkedLog);
            const photos = parseEvidencePhotos(linkedLog.evidence_url);
            const photoCount = photos.length;
            if (canEditFocus || photoCount > 0) {
                actionButtons = `
                    <div class="flex items-center gap-2 mt-2 flex-wrap">
                        ${canEditFocus ? `
                            <button type="button" onclick="event.stopPropagation(); window.workloadOpenEditLogModal('${linkedLog.id}')" class="px-2.5 py-1 rounded-lg ${linkedLog.status_execution === 'draft' ? 'bg-amber-500 hover:bg-amber-600 text-white' : 'bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'} text-[10px] font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"><i class="fa-solid fa-pen-to-square text-[9px]"></i><span>${linkedLog.status_execution === 'draft' ? 'Lanjutkan Draf' : 'Edit Laporan'}</span></button>
                        ` : ''}
                        ${photoCount > 0 ? `
                            <button type="button" onclick="event.stopPropagation(); window.workloadOpenLightboxFromLogId('${linkedLog.id}')" class="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/60 text-[10px] text-blue-700 dark:text-blue-300 font-bold flex items-center gap-1.5 transition-colors cursor-pointer border border-blue-200 dark:border-blue-800 shadow-2xs" title="Buka tautan bukti kegiatan (Google Drive / Foto)"><i class="fa-solid fa-camera text-[9px]"></i><span>Buka Gambar Bukti</span></button>
                        ` : ''}
                    </div>`;
            }
        } else {
            statusBadge = `<span class="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">Belum Dilaporkan</span>`;
            const isKbm = isTeachingActivity(seg);
            if (isKbm) {
                actionButtons = `
                    <div class="flex items-center gap-1.5 flex-wrap mt-2">
                        <a href="jurnal.html" target="_blank" onclick="event.stopPropagation()" class="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-[10px] font-bold transition-all shadow-2xs flex items-center gap-1" title="Buka Jurnal Mengajar Digital untuk mengisi realisasi KBM"><i class="fa-solid fa-book-open text-[9px]"></i><span>Isi Jurnal</span></a>
                        <button type="button" onclick="event.stopPropagation(); window.workloadOpenLogModal('${seg.activity_id}', false, 'diganti')" class="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-[10px] font-bold transition-all shadow-2xs flex items-center gap-1 cursor-pointer" title="Lapor Diganti Guru Lain / Kegiatan Pengganti"><i class="fa-solid fa-arrows-rotate"></i><span>Diganti</span></button>
                        <button type="button" onclick="event.stopPropagation(); window.workloadOpenLogModal('${seg.activity_id}', false, 'tidak_terlaksana')" class="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-[10px] font-bold transition-all shadow-2xs flex items-center gap-1 cursor-pointer" title="Lapor KBM Tidak Terlaksana"><i class="fa-solid fa-xmark"></i><span>Tidak</span></button>
                    </div>
                    <div class="mt-1.5 text-[10px] text-blue-600 dark:text-blue-400 font-medium flex items-center gap-1">
                        <i class="fa-solid fa-shield-halved text-[9px]"></i>
                        <span>Integritas Data: Realisasi KBM tidak dapat dicentang manual, otomatis disinkronkan dari Jurnal Digital.</span>
                    </div>`;
            } else {
                const reportCheckFocus = canReportActivityNow(seg.date || dateOfDay(_weekStartDate, _selectedDayIndex), seg.end_time, 5);
                if (!reportCheckFocus.allowed) {
                    actionButtons = `
                        <div class="flex items-center gap-1.5 flex-wrap mt-2">
                            <button type="button" disabled class="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 text-[10px] font-semibold cursor-not-allowed border border-slate-200 dark:border-slate-700 flex items-center gap-1 opacity-70" title="${escapeHTML(reportCheckFocus.reason || 'Kegiatan belum berakhir')}">
                                <i class="fa-solid fa-clock text-[9px]"></i>
                                <span>Belum Berakhir (Dapat dilaporkan mulai ${reportCheckFocus.allowedTimeStr} WITA)</span>
                            </button>
                            <button type="button" onclick="event.stopPropagation(); window.workloadOpenLogModal('${seg.activity_id}', false, 'draft')" class="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer" title="Simpan draf atau unggah foto bukti saat kegiatan sedang berlangsung"><i class="fa-solid fa-camera text-[9px]"></i><span>Mulai Draf (Sedang Berlangsung)</span></button>
                        </div>`;
                } else {
                    actionButtons = `
                        <div class="flex items-center gap-1.5 flex-wrap mt-2">
                            <button type="button" onclick="event.stopPropagation(); window.workloadOpenLogModal('${seg.activity_id}')" class="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold transition-all shadow-xs flex items-center gap-1 cursor-pointer" title="Lapor Terlaksana Penuh"><i class="fa-solid fa-check"></i><span>Terlaksana</span></button>
                            <button type="button" onclick="event.stopPropagation(); window.workloadOpenLogModal('${seg.activity_id}', false, 'diganti')" class="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold transition-all shadow-xs flex items-center gap-1 cursor-pointer" title="Lapor Diganti Kegiatan Lain"><i class="fa-solid fa-arrows-rotate"></i><span>Diganti</span></button>
                            <button type="button" onclick="event.stopPropagation(); window.workloadOpenLogModal('${seg.activity_id}', false, 'tidak_terlaksana')" class="px-2.5 py-1 rounded-lg bg-slate-400 hover:bg-slate-500 text-white text-[10px] font-bold transition-all shadow-xs flex items-center gap-1 cursor-pointer" title="Lapor Tidak Terlaksana"><i class="fa-solid fa-xmark"></i><span>Tidak</span></button>
                        </div>`;
                }
            }
        }

        const isSubstituted = Boolean(hasLog && linkedLog && (
            planLinks.find(pl => pl.plan_activity_id === seg.activity_id && pl.work_log_id === linkedLog.id)?.link_type === 'substitution' ||
            linkedLog.status_execution === 'diganti'
        ));
        const isNotExecuted = Boolean(hasLog && linkedLog && linkedLog.status_execution === 'tidak_terlaksana');
        const linkObj = (hasLog && linkedLog) ? planLinks.find(pl => pl.plan_activity_id === seg.activity_id && pl.work_log_id === linkedLog.id) : null;
        const displayCardTitle = isSubstituted
            ? (linkedLog.title || linkObj?.reason_notes || linkedLog.substitute_notes || 'Kegiatan Pengganti')
            : (seg.activity_title || seg.description || 'Kegiatan');

        const actualFocusMins = (hasLog && linkedLog) ? dayLogSegs.filter(ls => ls.work_log_id === linkedLog.id).reduce((s, ls) => s + (ls.actual_minutes || 0), 0) : 0;
        const isPartialFocus = Boolean(hasLog && linkedLog && !isNotExecuted && actualFocusMins > 0 && actualFocusMins < (seg.planned_minutes || 0));
        const unfulfilledFocusMins = isPartialFocus ? ((seg.planned_minutes || 0) - actualFocusMins) : 0;

        const catName = seg.catalog_name || seg.category_code || 'Kegiatan';
        const isTeaching = seg.is_teaching ? '<span class="ml-1 text-[9px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-bold">KBM</span>' : '';
        const hbgBadgeToday = renderHbgBadge(seg, 'sm');

        const canEditCard = hasLog && linkedLog && !isLogLockedByManualVerification(linkedLog);
        const cardTitle = canEditCard ? 'Klik untuk mengedit laporan' : (hasLog ? 'Laporan telah diverifikasi oleh Kepala Sekolah' : '');
        html += `
        <div class="flex gap-3 items-start p-3 rounded-xl border ${cardBorderCls} transition-all ${canEditCard ? 'cursor-pointer hover:border-emerald-400 dark:hover:border-emerald-600 hover:shadow-xs' : ''}" ${canEditCard ? `onclick="window.workloadOpenEditLogModal('${linkedLog.id}')"` : ''} title="${cardTitle}">
            <div class="shrink-0 w-14 text-center pointer-events-none">
                <div class="text-xs font-bold text-slate-700 dark:text-slate-200">${seg.start_time || '—'}</div>
                <div class="text-[9px] text-slate-400">${seg.end_time || '—'}</div>
                <div class="text-[9px] font-semibold ${isPartialFocus ? 'text-amber-600 dark:text-amber-400 font-bold' : 'text-emerald-600 dark:text-emerald-400'} mt-0.5">
                    ${hasLog && actualFocusMins > 0 ? `${actualFocusMins}m` : `${seg.planned_minutes || 0}m`}
                    ${isPartialFocus ? `<div class="text-[8px] text-rose-500 font-extrabold">-${unfulfilledFocusMins}m</div>` : ''}
                </div>
            </div>
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                    ${hasLog && linkedLog ? `
                        <span class="font-bold text-xs truncate ${isNotExecuted ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-800 dark:text-white'} ${canEditCard ? 'cursor-pointer hover:underline' : ''}" ${canEditCard ? `onclick="event.stopPropagation(); window.workloadOpenEditLogModal('${linkedLog.id}')" title="Klik judul untuk mengedit laporan"` : ''}>
                            ${isSubstituted ? '<i class="fa-solid fa-arrows-rotate text-[10px] text-emerald-600 dark:text-emerald-400 mr-1"></i>' : ''}
                            ${isNotExecuted ? '<i class="fa-solid fa-circle-xmark text-[10px] text-rose-500 mr-1"></i>' : ''}
                            ${escapeHTML(displayCardTitle)}
                        </span>
                    ` : `
                        <span class="font-bold text-xs text-slate-800 dark:text-white truncate">${escapeHTML(displayCardTitle)}</span>
                    `}
                    ${isTeaching}
                    ${hbgBadgeToday}
                    ${statusBadge}
                    ${isPartialFocus ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700 flex items-center gap-1"><i class="fa-solid fa-clock-rotate-left text-[8px] text-amber-600"></i> Parsial (${actualFocusMins}m / ${seg.planned_minutes}m)</span>` : ''}
                </div>
                ${!isSubstituted && !isNotExecuted ? `<div class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">${catName}${seg.description ? ' — ' + escapeHTML(seg.description) : ''}</div>` : ''}
                ${substituteInfoHtml}
                ${isPartialFocus ? `
                    <div class="text-[11px] text-amber-800 dark:text-amber-200 bg-amber-50/90 dark:bg-amber-950/40 border border-dashed border-amber-300 dark:border-amber-700 rounded-lg p-2 mt-1.5 flex items-start gap-1.5">
                        <i class="fa-solid fa-triangle-exclamation text-amber-500 text-xs mt-0.5 shrink-0"></i>
                        <div class="min-w-0 flex-1">
                            <div><span class="font-bold">Realisasi Tidak Penuh:</span> Waktu dilaporkan <strong>${actualFocusMins} menit</strong> dari alokasi rencana <strong>${seg.planned_minutes} menit</strong> (kurang <strong>${unfulfilledFocusMins} menit</strong>).</div>
                            ${(() => {
                                const startMin = parseTime(seg.start_time);
                                const splitFocusStartStr = minutesToTimeString(startMin + actualFocusMins);
                                return `
                                    <div class="mt-1.5">
                                        <button type="button" onclick="event.stopPropagation(); window.workloadOpenAddUnplannedForSlot(_selectedDayIndex, '${splitFocusStartStr}', '${seg.end_time}', ${unfulfilledFocusMins}, '${escapeHTML(seg.activity_title || '')}')" class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 active:scale-95 text-white font-bold text-[10px] shadow-xs cursor-pointer transition-all">
                                            <i class="fa-solid fa-plus text-[8px]"></i> Tambah Tugas Baru (${unfulfilledFocusMins}m)
                                        </button>
                                    </div>
                                `;
                            })()}
                        </div>
                    </div>
                ` : ''}
                ${isNotExecuted ? `
                    <div class="text-[11px] text-rose-700 dark:text-rose-300 bg-rose-50/90 dark:bg-rose-950/50 border border-rose-200/80 dark:border-rose-800/60 rounded-lg p-2 mt-1.5 flex items-start gap-1.5">
                        <i class="fa-solid fa-circle-xmark text-rose-500 text-xs mt-0.5 shrink-0"></i>
                        <div class="min-w-0 flex-1">
                            <span class="font-bold">Kegiatan Tidak Terlaksana</span>
                            ${linkedLog.obstacle_notes ? `<span class="text-rose-600 dark:text-rose-400 ml-1.5">— Kendala: ${escapeHTML(linkedLog.obstacle_notes)}</span>` : ''}
                        </div>
                    </div>
                ` : ''}
                ${actionButtons}
            </div>
        </div>`;
    });

    // Log tanpa rencana (unplanned / tugas mendadak)
    const unplannedLogs = logs.filter(l => l.is_unplanned === 1 || !planLinks.some(pl => pl.work_log_id === l.id));
    unplannedLogs.forEach(log => {
        const logMins = logSegments.filter(ls => ls.work_log_id === log.id).reduce((s, ls) => s + (ls.actual_minutes || 0), 0);
        const isJournalLog = (log.id || '').startsWith('wl_jurnal_');
        const journalBadge = isJournalLog ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 flex items-center gap-1">📘 Dari Jurnal KBM</span>` : '';
        const hbgBadgeLog = renderHbgBadge(log, 'sm');
        const isAutoUnplanned = log.verified_by_uid === 'system_auto_policy' || (_policy && Number(_policy.require_log_verification) === 0);
        const unpVerText = isAutoUnplanned ? 'Terverifikasi (Otomatis)' : 'Terverifikasi (Kepsek)';
        const unpVerTitle = isAutoUnplanned ? 'Terverifikasi otomatis oleh sistem (Mode Mandiri)' : 'Telah diverifikasi dan disetujui oleh Kepala Sekolah';

        const vMap = {
            'unverified': { text: 'Dilaporkan', cls: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300', title: 'Telah dilaporkan, menunggu verifikasi Kepala Sekolah' },
            'verified': { text: unpVerText, cls: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300', title: unpVerTitle },
            'rejected': { text: 'Ditolak', cls: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300', title: 'Laporan ditolak oleh Kepala Sekolah' }
        };
        const vs = vMap[log.verification_status] || vMap['unverified'];
        const canEditUnplanned = !isLogLockedByManualVerification(log);

        const isNotExecUnp = log.status_execution === 'tidak_terlaksana';
        const unpAbsenceMatch = (log.obstacle_notes || '').match(/^\[(Sakit|Cuti|Izin)\]/i);
        const unpAbsenceTypeStr = unpAbsenceMatch ? ` (${unpAbsenceMatch[1]})` : '';
        const unpExecBadge = isNotExecUnp
            ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 flex items-center gap-1 border border-rose-200 dark:border-rose-800"><i class="fa-solid fa-circle-xmark text-[8px]"></i><span>Tidak Terlaksana${unpAbsenceTypeStr}</span></span>`
            : `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">Unplanned</span>`;

        html += `
        <div class="flex gap-3 items-start p-3 rounded-xl border ${isNotExecUnp ? 'border-rose-200 dark:border-rose-900/40 bg-rose-50/20 dark:bg-rose-950/10' : 'border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/30 dark:bg-indigo-950/10'} transition-all ${canEditUnplanned ? 'cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-600 hover:shadow-xs' : ''}" ${canEditUnplanned ? `onclick="window.workloadOpenEditLogModal('${log.id}')"` : ''} title="${canEditUnplanned ? 'Klik untuk mengedit laporan' : 'Laporan telah diverifikasi oleh Kepala Sekolah'}">
            <div class="shrink-0 w-14 text-center pointer-events-none">
                <div class="text-[9px] font-bold ${isNotExecUnp ? 'text-rose-500' : 'text-indigo-500'} uppercase">${isNotExecUnp ? 'Absen' : 'Mendadak'}</div>
                <div class="text-xs font-bold ${isNotExecUnp ? 'text-rose-700 dark:text-rose-300' : 'text-indigo-700 dark:text-indigo-300'} mt-0.5">${isNotExecUnp ? '0m' : `${logMins}m`}</div>
            </div>
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-bold text-xs text-slate-800 dark:text-white truncate ${canEditUnplanned ? 'cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline' : ''}" ${canEditUnplanned ? `onclick="event.stopPropagation(); window.workloadOpenEditLogModal('${log.id}')" title="Klik untuk mengedit laporan"` : ''}>
                        ${escapeHTML(log.title)}
                    </span>
                    ${journalBadge}
                    ${hbgBadgeLog}
                    ${unpExecBadge}
                    <span class="px-2 py-0.5 rounded-lg text-[10px] font-bold ${vs.cls}" title="${vs.title}">${vs.text}</span>
                </div>
                ${isNotExecUnp ? `
                    <div class="text-[11px] text-rose-700 dark:text-rose-300 bg-rose-50/90 dark:bg-rose-950/50 border border-rose-200/80 dark:border-rose-800/60 rounded-lg p-2 mt-1.5 flex items-start gap-1.5">
                        <i class="fa-solid fa-circle-xmark text-rose-500 text-xs mt-0.5 shrink-0"></i>
                        <div class="min-w-0 flex-1">
                            <span class="font-bold">Tidak Hadir</span>
                            ${log.obstacle_notes ? `<span class="text-rose-600 dark:text-rose-400 ml-1.5">— Alasan: ${escapeHTML(log.obstacle_notes)}</span>` : ''}
                        </div>
                    </div>
                ` : `<div class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">${log.output_summary || ''}</div>`}
                <div class="flex items-center gap-2 mt-2 flex-wrap">
                    ${canEditUnplanned ? `
                        <button type="button" onclick="event.stopPropagation(); window.workloadOpenEditLogModal('${log.id}')" class="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/60 text-[10px] text-indigo-700 dark:text-indigo-300 font-bold flex items-center gap-1.5 transition-colors cursor-pointer border border-indigo-200 dark:border-indigo-800 shadow-2xs"><i class="fa-solid fa-pen-to-square text-[9px]"></i><span>Edit Laporan</span></button>
                    ` : ''}
                    ${parseEvidencePhotos(log.evidence_url).length > 0 ? `
                        <button type="button" onclick="event.stopPropagation(); window.workloadOpenLightboxFromLogId('${log.id}')" class="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/60 text-[10px] text-blue-700 dark:text-blue-300 font-bold flex items-center gap-1.5 transition-colors cursor-pointer border border-blue-200 dark:border-blue-800 shadow-2xs" title="Buka tautan bukti kegiatan (Google Drive / Foto)"><i class="fa-solid fa-camera text-[9px]"></i><span>Buka Gambar Bukti</span></button>
                    ` : ''}
                </div>
            </div>
        </div>`;
    });

    container.innerHTML = html;
    updateUnplannedAbsenceUI(dayDate, _selectedDayIndex, logs, segments);
}

// ========== EMPTY STATE: RENCANA MINGGUAN BELUM DIFINALISASI / DISETUJUI ==========
export function renderUnapprovedPlanEmptyState() {
    const unapprovedPlaceholder = el('today-empty-state-unapproved');
    if (!unapprovedPlaceholder) return;

    const isMgr = isCurrentUserWorkloadManager();
    const activeVersion = _weekData?.active_version;
    const planStatus = activeVersion ? activeVersion.status : 'draft';
    const hasPreviousLogs = (_weekData?.logs || []).length > 0;

    let iconHtml = '';
    let titleText = '';
    let descText = '';
    let ctaButtonHtml = '';
    let badgeHtml = '';

    if (planStatus === 'submitted') {
        iconHtml = `<div class="w-14 h-14 mx-auto rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center text-2xl border border-blue-100 dark:border-blue-900/60 shadow-xs"><i class="fa-solid fa-clock-rotate-left"></i></div>`;
        badgeHtml = `<span class="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 uppercase tracking-wider inline-flex items-center gap-1.5"><i class="fa-solid fa-paper-plane"></i> Menunggu Persetujuan</span>`;
        if (isMgr) {
            titleText = 'Rencana Kerja Guru Menunggu Persetujuan Anda';
            descText = 'Guru telah mengajukan rencana kerja pekan ini untuk diverifikasi. Silakan tinjau dan setujui rencana kerja untuk membuka pelaporan realisasi kegiatan.';
            ctaButtonHtml = `<button type="button" onclick="window.workloadSwitchTab('tab-plan')" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-2 mx-auto cursor-pointer"><i class="fa-solid fa-stamp"></i><span>Tinjau & Setujui Rencana Guru</span></button>`;
        } else {
            titleText = 'Rencana Kerja Sedang Menunggu Persetujuan Kepala Sekolah';
            descText = 'Rencana kerja pekan ini telah diajukan dan sedang menunggu verifikasi/persetujuan Kepala Sekolah. Tab Realisasi akan otomatis aktif setelah rencana disetujui.';
            ctaButtonHtml = `<button type="button" onclick="window.workloadSwitchTab('tab-plan')" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-2 mx-auto cursor-pointer"><i class="fa-solid fa-file-lines"></i><span>Tinjau Rencana yang Diajukan</span></button>`;
        }
    } else if (planStatus === 'needs_revision') {
        iconHtml = `<div class="w-14 h-14 mx-auto rounded-2xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center text-2xl border border-rose-100 dark:border-rose-900/60 shadow-xs"><i class="fa-solid fa-triangle-exclamation"></i></div>`;
        badgeHtml = `<span class="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 uppercase tracking-wider inline-flex items-center gap-1.5"><i class="fa-solid fa-rotate-left"></i> Perlu Revisi</span>`;
        if (isMgr) {
            titleText = 'Rencana Kerja Dalam Status Revisi';
            descText = 'Rencana kerja telah dikembalikan kepada guru untuk dilakukan penyesuaian jadwal atau tugas pokok.';
            ctaButtonHtml = `<button type="button" onclick="window.workloadSwitchTab('tab-plan')" class="px-4 py-2 bg-slate-700 hover:bg-slate-800 active:scale-95 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-2 mx-auto cursor-pointer"><i class="fa-solid fa-eye"></i><span>Lihat Rencana Kerja Guru</span></button>`;
        } else {
            titleText = 'Rencana Kerja Memerlukan Perbaikan';
            const notes = activeVersion?.review_notes ? escapeHTML(activeVersion.review_notes) : 'Kepala Sekolah meminta perbaikan pada rencana kerja pekan ini.';
            descText = `${notes} Silakan periksa catatan revisi di Tab Rencana Mingguan dan ajukan kembali setelah disesuaikan.`;
            ctaButtonHtml = `<button type="button" onclick="window.workloadSwitchTab('tab-plan')" class="px-4 py-2 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-2 mx-auto cursor-pointer"><i class="fa-solid fa-pen-to-square"></i><span>Buka Tab Rencana & Perbaiki</span></button>`;
        }
    } else {
        // Draf (belum diajukan / belum difinalisasi)
        const isAuto = _policy?.require_plan_approval === 0;
        iconHtml = `<div class="w-14 h-14 mx-auto rounded-2xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center text-2xl border border-amber-100 dark:border-amber-900/60 shadow-xs"><i class="fa-solid fa-file-signature"></i></div>`;
        badgeHtml = `<span class="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 uppercase tracking-wider inline-flex items-center gap-1.5"><i class="fa-solid fa-pen-ruler"></i> Draf Rencana</span>`;
        if (isMgr) {
            titleText = 'Rencana Kerja Guru Masih Berstatus Draf';
            descText = isAuto
                ? 'Guru belum memfinalisasi rencana kerja untuk pekan ini. Seluruh kegiatan realisasi dapat dipantau setelah rencana difinalisasi.'
                : 'Guru belum mengajukan rencana kerja untuk pekan ini. Seluruh kegiatan realisasi dapat dipantau setelah rencana disetujui.';
            ctaButtonHtml = `<button type="button" onclick="window.workloadSwitchTab('tab-plan')" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-2 mx-auto cursor-pointer"><i class="fa-solid fa-eye"></i><span>Lihat Draf Rencana Guru</span></button>`;
        } else {
            titleText = isAuto ? 'Rencana Kerja Pekan Ini Belum Difinalisasi' : 'Rencana Kerja Pekan Ini Belum Diajukan';
            descText = isAuto
                ? 'Sesuai ketentuan beban kerja guru (Permendikdasmen No. 11/2025), pelaporan realisasi harian baru dapat dilakukan setelah rencana kerja mingguan difinalisasi. Silakan lengkapi dan finalisasi rencana kerja Anda pada Tab Rencana terlebih dahulu.'
                : 'Sesuai ketentuan beban kerja guru (Permendikdasmen No. 11/2025), pelaporan realisasi harian baru dapat dilakukan setelah rencana kerja mingguan disetujui Kepala Sekolah. Silakan lengkapi dan ajukan rencana kerja Anda pada Tab Rencana terlebih dahulu.';
            ctaButtonHtml = isAuto
                ? `<button type="button" onclick="window.workloadSwitchTab('tab-plan')" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-2 mx-auto cursor-pointer"><i class="fa-solid fa-circle-check"></i><span>Buka Tab Rencana & Finalisasi Sekarang</span></button>`
                : `<button type="button" onclick="window.workloadSwitchTab('tab-plan')" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-2 mx-auto cursor-pointer"><i class="fa-solid fa-paper-plane"></i><span>Buka Tab Rencana & Ajukan Sekarang</span></button>`;
        }
    }

    let preservedLogsNoticeHtml = '';
    if (hasPreviousLogs) {
        const lockTerm = _policy?.require_plan_approval === 0 ? 'difinalisasi' : 'disetujui';
        preservedLogsNoticeHtml = `
        <div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-left text-xs text-slate-600 dark:text-slate-300 max-w-lg mx-auto flex items-start gap-2.5">
            <i class="fa-solid fa-shield-halved text-emerald-500 mt-0.5 shrink-0 text-sm"></i>
            <div>
                <span class="font-bold text-slate-700 dark:text-slate-200">Realisasi Tersimpan Aman:</span>
                Terdapat <strong>${_weekData.logs.length} kegiatan</strong> realisasi yang telah tercatat sebelumnya. Pengisian realisasi baru dijeda sementara dan seluruh data akan tampil kembali setelah rencana kerja ${lockTerm}.
            </div>
        </div>`;
    }

    unapprovedPlaceholder.innerHTML = `
        ${iconHtml}
        <div>
            ${badgeHtml}
            <h3 class="text-sm sm:text-base font-bold text-slate-800 dark:text-white mt-2">${titleText}</h3>
            <p class="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed mt-1">${descText}</p>
        </div>
        ${preservedLogsNoticeHtml}
        <div class="pt-2">
            ${ctaButtonHtml}
        </div>
    `;
    unapprovedPlaceholder.classList.remove('hidden');
}

function renderTodayTab() {
    updatePlanToolbarVisibility();
    const isMgr = isCurrentUserWorkloadManager();
    const noTeacherPlaceholder = el('admin-no-teacher-placeholder-today');
    const unapprovedPlaceholder = el('today-empty-state-unapproved');
    const kpiStrip = el('kpi-summary-strip');
    const matrixWrapper = el('weekly-matrix-scroll-wrapper');
    const focusContainer = el('single-day-focus-container');

    if (isMgr && !_adminSelectedTeacherId) {
        if (noTeacherPlaceholder) noTeacherPlaceholder.classList.remove('hidden');
        if (unapprovedPlaceholder) unapprovedPlaceholder.classList.add('hidden');
        if (kpiStrip) kpiStrip.classList.add('hidden');
        if (matrixWrapper) matrixWrapper.classList.add('hidden');
        if (focusContainer) focusContainer.classList.add('hidden');
        updateRealisasiToolbarVisibility();
        return;
    } else {
        if (noTeacherPlaceholder) noTeacherPlaceholder.classList.add('hidden');
    }

    // Gerbang Realisasi: Rencana kerja mingguan wajib berstatus 'approved' sebelum tab realisasi dapat dibuka
    const activeVersion = _weekData?.active_version;
    const isPlanApproved = (activeVersion && activeVersion.status === 'approved');

    if (!isPlanApproved) {
        if (kpiStrip) kpiStrip.classList.add('hidden');
        if (matrixWrapper) matrixWrapper.classList.add('hidden');
        if (focusContainer) focusContainer.classList.add('hidden');
        updateRealisasiToolbarVisibility();
        renderUnapprovedPlanEmptyState();
        return;
    } else {
        if (unapprovedPlaceholder) unapprovedPlaceholder.classList.add('hidden');
        if (_activeTab === 'tab-today') {
            if (kpiStrip) kpiStrip.classList.remove('hidden');
        } else {
            if (kpiStrip) kpiStrip.classList.add('hidden');
        }
        updateRealisasiToolbarVisibility();
    }

    // 1. Sinkronisasi Ringkasan Target Pekan Ini (Sticky Top Header)
    const segments = _weekData?.segments || [];
    const logs = _weekData?.logs || [];
    const logSegments = _weekData?.log_segments || [];

    let totalWeeklyActualMinutes = 0;
    const logIds = new Set(logs.map(l => l.id));
    logSegments.filter(ls => logIds.has(ls.work_log_id)).forEach(ls => {
        totalWeeklyActualMinutes += (ls.actual_minutes || 0);
    });

    const adjustedTargetObj = calculateAdjustedWeeklyTarget(_weekStartDate, segments, {
        policy: _policy,
        isHolidayFn: (d) => isHolidayDate(d),
        getHolidayInfoFn: (d) => getHolidayDateInfo(d)
    });
    const targetWeeklyMinutes = (_weekData?.week?.target_minutes && _weekData.week.target_minutes !== 2250)
        ? _weekData.week.target_minutes
        : adjustedTargetObj.adjustedTargetMinutes; // fallback: const targetWeeklyMinutes = 2250;

    const weeklyPct = targetWeeklyMinutes > 0
        ? Math.min(100, Math.round(totalWeeklyActualMinutes / targetWeeklyMinutes * 100))
        : 100;

    const elActualMins = el('matrix-weekly-actual-minutes');
    if (elActualMins) elActualMins.textContent = totalWeeklyActualMinutes;
    const elTargetLabel = el('matrix-weekly-target-label');
    if (elTargetLabel) {
        elTargetLabel.textContent = `/ ${targetWeeklyMinutes.toLocaleString('id-ID')} Menit`;
        if (adjustedTargetObj.holidayCount > 0) {
            elTargetLabel.title = `Target disesuaikan: ${adjustedTargetObj.effectiveWorkDaysCount} hari kerja (${adjustedTargetObj.holidayCount} hari libur: ${adjustedTargetObj.holidayDates.map(h => h.title).join(', ')})`;
        } else {
            elTargetLabel.title = 'Target standar: 5 hari kerja (2.250 Menit)';
        }
    }
    const elProgressBar = el('matrix-weekly-progress-bar');
    if (elProgressBar) elProgressBar.style.width = `${weeklyPct}%`;
    const elPctBadge = el('matrix-weekly-pct-badge');
    if (elPctBadge) elPctBadge.textContent = `${weeklyPct}%`;
    const elStatusBadge = el('matrix-week-status-badge');
    if (elStatusBadge) {
        const hoursDisplay = (targetWeeklyMinutes / 60).toFixed(1).replace('.0', '').replace('.', ',');
        elStatusBadge.textContent = `Target: ${targetWeeklyMinutes.toLocaleString('id-ID')} Menit (${hoursDisplay} Jam)${adjustedTargetObj.holidayCount > 0 ? ` • ${adjustedTargetObj.holidayCount} Hari Libur` : ''}`;
    }

    // Sinkronisasi status tombol saklar (toggle) tampilan
    const btnMatrix = el('btn-view-matrix');
    const btnFocus = el('btn-view-focus');
    if (btnMatrix && btnFocus) {
        if (_matrixViewMode === 'matrix') {
            btnMatrix.className = 'px-2 py-1 rounded-md text-[11px] font-bold transition-all flex items-center gap-1 bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-2xs cursor-pointer';
            btnFocus.className = 'px-2 py-1 rounded-md text-[11px] font-semibold transition-all flex items-center gap-1 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white cursor-pointer';
        } else {
            btnFocus.className = 'px-2 py-1 rounded-md text-[11px] font-bold transition-all flex items-center gap-1 bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-2xs cursor-pointer';
            btnMatrix.className = 'px-2 py-1 rounded-md text-[11px] font-semibold transition-all flex items-center gap-1 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white cursor-pointer';
        }
    }

    // 2. Tampilkan kontainer yang aktif
    if (_matrixViewMode === 'matrix') {
        if (matrixWrapper) matrixWrapper.classList.remove('hidden');
        if (focusContainer) focusContainer.classList.add('hidden');
        renderWeeklyMatrixView();
    } else {
        if (matrixWrapper) matrixWrapper.classList.add('hidden');
        if (focusContainer) focusContainer.classList.remove('hidden');
        renderDaySelector();
        renderSingleDayFocusView();
    }
}

// ========== TOGGLE EXPAND RINGKASAN TUGAS POKOK ==========
export function toggleDutySummaryCollapse() {
    const verStatus = _weekData?.active_version?.status;
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    const currentEffective = resolveDutySummaryCollapsed(verStatus, _dutySummaryManualCollapse, isMobile);
    _dutySummaryManualCollapse = !currentEffective;
    renderPlanDutySummary();
}

export function toggleDutyExpand(dutyCode) {
    if (_expandedDutyCode === dutyCode || !dutyCode) {
        _expandedDutyCode = null;
    } else {
        _expandedDutyCode = dutyCode;
        // Buka summary jika sebelumnya terlipat agar panel rincian terlihat
        _dutySummaryManualCollapse = false;
    }
    renderPlanDutySummary();
}

// ========== RINGKASAN KOMPOSISI RENCANA TUGAS POKOK (PERMENDIKDASMEN 11/2025) ==========
function renderPlanDutySummary() {
    const container = el('plan-duty-summary-container');
    if (!container) return;

    const segments = _weekData?.segments || [];
    const activities = _weekData?.activities || [];
    const adjustedTargetObj = calculateAdjustedWeeklyTarget(_weekStartDate, segments, {
        policy: _policy,
        isHolidayFn: (d) => isHolidayDate(d),
        getHolidayInfoFn: (d) => getHolidayDateInfo(d)
    });
    const targetWeeklyMinutes = (_weekData?.week?.target_minutes && _weekData.week.target_minutes !== 2250)
        ? _weekData.week.target_minutes
        : adjustedTargetObj.adjustedTargetMinutes;

    const summary = calculateDutyAllocationSummary(segments, activities, _catalog, targetWeeklyMinutes);

    const totalMin = summary.totalPlannedMinutes || 0;
    const targetMin = summary.targetMinutes || 2250;
    const totalPct = summary.totalPercentage || 0;
    const totalJp = Math.round((totalMin / 45) * 10) / 10;
    const maxBarTotal = Math.max(targetMin, totalMin);

    const verStatus = _weekData?.active_version?.status;
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    const isCollapsed = resolveDutySummaryCollapsed(verStatus, _dutySummaryManualCollapse, isMobile);

    // Multi-segment progress bar segments
    let barSegmentsHtml = '';
    summary.duties.forEach(d => {
        if (d.plannedMinutes > 0) {
            const barWidth = Math.round((d.plannedMinutes / maxBarTotal) * 1000) / 10;
            barSegmentsHtml += `
                <div class="${d.bgClass} h-full transition-all duration-300 relative group cursor-pointer"
                     style="width: ${barWidth}%;"
                     onclick="window.workloadToggleDutyExpand('${d.code}')"
                     title="${escapeHTML(d.fullName)}: ${d.plannedMinutes}m (${d.equivalentJp} JP) • ${d.percentage}% dari target 37,5 jam (Klik untuk melihat rincian)">
                </div>
            `;
        }
    });

    if (summary.holidayMinutes > 0) {
        const holidayWidth = Math.round((summary.holidayMinutes / maxBarTotal) * 1000) / 10;
        barSegmentsHtml += `
            <div class="bg-rose-400 h-full transition-all duration-300 relative group"
                 style="width: ${holidayWidth}%;"
                 title="Dispensasi / Libur Sekolah: ${summary.holidayMinutes}m • ${summary.holidayPercentage}% dari target 37,5 jam">
            </div>
        `;
    }

    // Chips per Tugas Pokok (Interactive Click-to-Expand, Padat & Ringkas)
    let chipsHtml = '';
    summary.duties.forEach(d => {
        const isExpanded = (_expandedDutyCode === d.code);
        const activeCls = isExpanded
            ? `${d.borderClass} ring-2 ring-emerald-500/30 dark:ring-emerald-400/30 bg-white dark:bg-slate-800 shadow-xs`
            : 'border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 hover:border-slate-200 dark:hover:border-slate-700 hover:bg-white dark:hover:bg-slate-800 shadow-2xs';
        const chevronIcon = isExpanded
            ? `<i class="fa-solid fa-chevron-up text-[9px] ${d.textClass} shrink-0"></i>`
            : `<i class="fa-solid fa-chevron-down text-[9px] text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 shrink-0 transition-transform"></i>`;

        chipsHtml += `
            <div role="button" tabindex="0" onclick="window.workloadToggleDutyExpand('${d.code}')"
                 onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.workloadToggleDutyExpand('${d.code}');}"
                 class="p-1.5 sm:p-2 rounded-xl border ${activeCls} flex flex-col justify-between transition-all duration-200 cursor-pointer select-none active:scale-[0.98] group ${d.code === 'TUGAS_TAMBAHAN' ? 'col-span-2 sm:col-span-1' : 'col-span-1'}"
                 title="Klik untuk ${isExpanded ? 'menutup' : 'melihat'} rincian durasi & JP per Kategori Kegiatan">
                <div class="flex items-center justify-between gap-1 mb-1 min-w-0">
                    <div class="flex items-center gap-1.5 min-w-0">
                        <span class="w-2 h-2 rounded-full ${d.bgClass} shrink-0"></span>
                        <span class="text-[11px] font-bold text-slate-700 dark:text-slate-300 truncate" title="${escapeHTML(d.fullName)}">
                            <span class="sm:hidden">${escapeHTML(d.mobileName || d.shortName || d.name)}</span>
                            <span class="hidden sm:inline">${escapeHTML(d.shortName || d.name)}</span>
                        </span>
                    </div>
                    ${chevronIcon}
                </div>
                <div class="flex items-baseline justify-between gap-1 text-[11px] pt-0.5">
                    <span class="font-bold text-slate-800 dark:text-white">
                        ${formatDurationDisplay(d.plannedMinutes)}
                        <span class="text-[10px] text-slate-400 font-normal">(${d.equivalentJp} JP)</span>
                    </span>
                    <span class="font-black ${d.textClass}">
                        ${d.percentage}%
                    </span>
                </div>
            </div>
        `;
    });

    if (summary.holidayMinutes > 0) {
        chipsHtml += `
            <div class="col-span-2 sm:col-span-1 p-1.5 sm:p-2 rounded-xl border border-rose-200/70 dark:border-rose-900/40 bg-rose-50/60 dark:bg-rose-950/20 flex flex-col justify-between transition-all shadow-2xs">
                <div class="flex items-center gap-1.5 mb-1 min-w-0">
                    <span class="w-2 h-2 rounded-full bg-rose-400 shrink-0"></span>
                    <span class="text-[11px] font-bold text-rose-700 dark:text-rose-300 truncate" title="Dispensasi / Libur Resmi Sekolah">
                        Libur / Dispensasi
                    </span>
                </div>
                <div class="flex items-baseline justify-between gap-1 text-[11px] pt-0.5">
                    <span class="font-bold text-rose-800 dark:text-rose-200">
                        ${formatDurationDisplay(summary.holidayMinutes)}
                    </span>
                    <span class="font-black text-rose-600 dark:text-rose-400">
                        ${summary.holidayPercentage}%
                    </span>
                </div>
            </div>
        `;
    }

    // Panel Rincian Kategori Kegiatan yang Ter-expand
    let expandedPanelHtml = '';
    const activeDuty = _expandedDutyCode ? summary.duties.find(d => d.code === _expandedDutyCode) : null;
    if (activeDuty) {
        let categoriesHtml = '';
        if (activeDuty.categories && activeDuty.categories.length > 0) {
            categoriesHtml = `
                <div class="space-y-2">
                    ${activeDuty.categories.map(cat => {
                        const segPills = (cat.segments || []).map(seg => `
                            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium border border-slate-200/50 dark:border-slate-700/50">
                                <i class="fa-regular fa-calendar-day text-[9px] text-slate-400"></i>
                                <strong class="font-bold text-slate-700 dark:text-slate-200">${escapeHTML(seg.day_name)}:</strong>
                                <span>${escapeHTML(seg.start_time)}–${escapeHTML(seg.end_time)}</span>
                                <span class="text-emerald-600 dark:text-emerald-400 font-bold">(${seg.jp_count} JP)</span>
                                ${seg.title && seg.title !== cat.name ? `<span class="text-slate-500 dark:text-slate-400 italic truncate max-w-[160px]">· ${escapeHTML(seg.title)}</span>` : ''}
                            </span>
                        `).join('');

                        return `
                            <div class="bg-white dark:bg-slate-900 rounded-xl p-2.5 sm:p-3 border border-slate-200/80 dark:border-slate-800 shadow-2xs space-y-2 transition-all hover:border-slate-300 dark:hover:border-slate-700">
                                <div class="flex items-start justify-between gap-2">
                                    <div class="min-w-0 flex-1">
                                        <div class="text-xs font-bold text-slate-800 dark:text-white flex items-center gap-1.5 flex-wrap">
                                            <span class="w-2 h-2 rounded-full ${activeDuty.bgClass} shrink-0"></span>
                                            <span>${escapeHTML(cat.name)}</span>
                                        </div>
                                        ${cat.description ? `<p class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">${escapeHTML(cat.description)}</p>` : ''}
                                    </div>
                                    <div class="text-right shrink-0">
                                        <div class="text-xs font-extrabold text-slate-900 dark:text-white">
                                            ${formatDurationDisplay(cat.plannedMinutes)}
                                            <span class="text-emerald-600 dark:text-emerald-400 font-black">(${cat.equivalentJp} JP)</span>
                                        </div>
                                        <div class="text-[10px] text-slate-400 font-semibold">
                                            ${cat.segmentsCount} sesi alokasi
                                        </div>
                                    </div>
                                </div>
                                ${segPills ? `
                                    <div class="flex items-center gap-1.5 flex-wrap pt-1.5 border-t border-slate-100 dark:border-slate-800">
                                        ${segPills}
                                    </div>
                                ` : ''}
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        } else {
            categoriesHtml = `
                <div class="bg-white/80 dark:bg-slate-900/80 rounded-xl p-4 border border-dashed border-slate-200 dark:border-slate-800 text-center space-y-1.5">
                    <div class="w-8 h-8 mx-auto rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center text-xs">
                        <i class="fa-regular fa-calendar-xmark"></i>
                    </div>
                    <p class="text-xs font-bold text-slate-700 dark:text-slate-300">Belum ada alokasi rencana pada tugas pokok ini (0m / 0 JP)</p>
                    <p class="text-[11px] text-slate-500 dark:text-slate-400">
                        Anda dapat mengalokasikan tugas pokok ini pada jadwal harian melalui tombol <strong>+ Tambah Kegiatan</strong>.
                    </p>
                </div>
            `;
        }

        let catalogRefHtml = '';
        if (activeDuty.availableCatalog && activeDuty.availableCatalog.length > 0) {
            catalogRefHtml = `
                <div class="mt-2.5 pt-2 border-t border-slate-200/60 dark:border-slate-800/80">
                    <div class="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1 uppercase tracking-wider">
                        <i class="fa-solid fa-list-check text-[10px]"></i>
                        <span>Kategori Kegiatan Standar Lainnya (${activeDuty.availableCatalog.length}):</span>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 max-h-36 overflow-y-auto">
                        ${activeDuty.availableCatalog.map(ac => `
                            <div class="px-2.5 py-1.5 rounded-lg bg-white/70 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs" title="${escapeHTML(ac.description || ac.name)}">
                                <span class="text-slate-600 dark:text-slate-300 text-[11px] font-medium truncate pr-2">${escapeHTML(ac.name)}</span>
                                <span class="text-[10px] text-slate-400 shrink-0 font-semibold">0m (0 JP)</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        expandedPanelHtml = `
            <div id="plan-duty-expanded-panel" class="mt-2.5 p-3 sm:p-3.5 rounded-2xl border ${activeDuty.borderClass} ${activeDuty.bgLightClass} transition-all duration-300 space-y-2.5">
                <div class="flex items-center justify-between flex-wrap gap-2">
                    <div class="flex items-center gap-2 min-w-0">
                        <div class="w-7 h-7 rounded-lg ${activeDuty.bgClass} text-white flex items-center justify-center text-xs shrink-0 shadow-2xs">
                            <i class="fa-solid ${activeDuty.icon}"></i>
                        </div>
                        <div class="min-w-0">
                            <h5 class="text-xs sm:text-sm font-bold text-slate-800 dark:text-white flex items-center gap-1.5 truncate">
                                <span>Rincian Kategori: ${escapeHTML(activeDuty.name)}</span>
                            </h5>
                            <p class="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                ${escapeHTML(activeDuty.fullName)}
                            </p>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="px-2.5 py-0.5 rounded-lg text-xs font-black ${activeDuty.bgClass} text-white shadow-2xs">
                            ${formatDurationDisplay(activeDuty.plannedMinutes)} (${activeDuty.equivalentJp} JP • ${activeDuty.percentage}%)
                        </span>
                        <button type="button" onclick="window.workloadToggleDutyExpand(null)"
                                class="w-6 h-6 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition-all flex items-center justify-center cursor-pointer text-xs"
                                title="Tutup Rincian Kategori Kegiatan">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                </div>

                ${categoriesHtml}
                ${catalogRefHtml}
            </div>
        `;
    }

    const badgeColorClass = totalPct >= 100
        ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60'
        : 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60';

    const toggleButtonHtml = `
        <button type="button"
                onclick="window.workloadToggleDutySummaryCollapse()"
                aria-expanded="${!isCollapsed}"
                aria-controls="plan-duty-summary-body"
                class="px-2 py-0.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-[11px] font-semibold transition-all flex items-center gap-1 active:scale-95 cursor-pointer shadow-2xs shrink-0"
                title="${isCollapsed ? 'Buka rincian komposisi 5 tugas pokok' : 'Lipat rincian komposisi tugas pokok'}">
            <span class="hidden sm:inline">${isCollapsed ? 'Rincian' : 'Sembunyikan'}</span>
            <i class="fa-solid ${isCollapsed ? 'fa-chevron-down' : 'fa-chevron-up'} text-[10px]"></i>
        </button>
    `;

    container.innerHTML = `
        <div class="space-y-2">
            <!-- Header Ringkasan Komposisi (Ultra Compact) -->
            <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2 min-w-0">
                    <div class="w-6 h-6 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xs shrink-0 border border-blue-100 dark:border-blue-900/40">
                        <i class="fa-solid fa-chart-pie"></i>
                    </div>
                    <div class="min-w-0">
                        <h4 class="text-xs font-bold text-slate-800 dark:text-white flex items-center gap-1.5 truncate">
                            <span>Komposisi Tugas Pokok</span>
                            <span class="hidden md:inline text-[10px] font-semibold text-slate-400 dark:text-slate-500">(Permendikdasmen 11/2025)</span>
                        </h4>
                    </div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                    <div class="text-right text-[11px] leading-tight">
                        <span class="font-bold text-slate-800 dark:text-white">${formatDurationDisplay(totalMin)}</span>
                        <span class="text-slate-400 font-medium">(${totalJp} JP)</span>
                    </div>
                    <span class="px-1.5 py-0.5 rounded-md text-[10px] font-black ${badgeColorClass}">
                        ${totalPct}%
                    </span>
                    ${toggleButtonHtml}
                </div>
            </div>

            <!-- Multi-Segment Stacked Progress Bar (Ramping & Interaktif) -->
            <div class="w-full h-2 sm:h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex shadow-inner">
                ${barSegmentsHtml || '<div class="w-full h-full bg-slate-100 dark:bg-slate-800"></div>'}
            </div>

            <!-- Konten Rincian (Buka/Tutup Smart Adaptive) -->
            ${!isCollapsed ? `
                <div id="plan-duty-summary-body" class="space-y-2 pt-0.5">
                    <!-- Chips Rincian 5 Tugas Pokok (Padat) -->
                    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5 sm:gap-2">
                        ${chipsHtml}
                    </div>

                    <!-- Panel Rincian Kategori Kegiatan Ter-expand -->
                    ${expandedPanelHtml}
                </div>
            ` : ''}
        </div>
    `;
}

// ========== HELPER: STATUS REALISASI SEGMEN RENCANA ==========
export function isPlanSegmentRealized(seg) {
    if (!seg) return false;
    // 1. Cek langsung properti has_realized_log dari query backend D1
    if (seg.has_realized_log !== undefined && Number(seg.has_realized_log) > 0) {
        return true;
    }
    // 2. Cek relasi activity_id di plan_links atau logs di state _weekData
    const actId = seg.activity_id;
    if (actId) {
        const links = _weekData?.plan_links || _weekData?.plan_log_links || [];
        if (links.some(l => l.plan_activity_id === actId)) {
            return true;
        }
        const logs = _weekData?.logs || [];
        if (logs.some(l => l.plan_activity_id === actId)) {
            return true;
        }
    }
    // 3. Fallback jika ada seg.id yang tertaut
    if (seg.id) {
        const logs = _weekData?.logs || [];
        if (logs.some(l => l.plan_segment_id === seg.id)) {
            return true;
        }
    }
    return false;
}

// ========== TAB: RENCANA MINGGUAN ==========
function renderPlanSyncRequiredBanner() {
    const banner = el('plan-sync-required-banner');
    if (!banner) return;
    const ver = _weekData?.active_version;
    const isEditable = !ver || ['draft', 'needs_revision'].includes(ver.status);
    banner.classList.toggle('hidden', !isEditable || isPlanKbmSyncSatisfied());
}

function renderPlanTab() {
    updateRealisasiToolbarVisibility();
    updatePlanToolbarVisibility();
    const isMgr = isCurrentUserWorkloadManager();
    const noTeacherPlaceholder = el('admin-no-teacher-placeholder-plan');
    const planToolbar = el('plan-toolbar');
    const dutySummary = el('plan-duty-summary-container');
    const accordion = el('weekly-plan-accordion');

    if (isMgr && !_adminSelectedTeacherId) {
        if (noTeacherPlaceholder) noTeacherPlaceholder.classList.remove('hidden');
        if (planToolbar) planToolbar.classList.add('hidden');
        if (dutySummary) dutySummary.classList.add('hidden');
        if (accordion) accordion.classList.add('hidden');
        return;
    } else {
        if (noTeacherPlaceholder) noTeacherPlaceholder.classList.add('hidden');
        if (planToolbar) planToolbar.classList.remove('hidden');
        if (dutySummary) dutySummary.classList.remove('hidden');
        if (accordion) accordion.classList.remove('hidden');
    }

    renderPlanDutySummary();
    renderPlanSyncRequiredBanner();

    const container = el('weekly-plan-accordion');
    if (!container) return;

    renderTeacherStudyDayControl();

    updateSubmitButton();

    const segments = _weekData?.segments || [];
    let html = '';

    for (let i = 0; i < 5; i++) {
        const dayDate = dateOfDay(_weekStartDate, i);
        const dayOfWeek = i + 1;
        const isStudyDay = i === _studyDayIndex;
        const daySegments = segments.filter(s => s.date === dayDate).sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
        const dayTimeline = calculateDayTimelineSlots(dayDate, daySegments, {
            policy: _policy,
            isHolidayFn: (d) => isHolidayDate(d),
            getHolidayInfoFn: (d) => getHolidayDateInfo(d)
        });
        const canEdit = _weekData?.active_version && ['draft', 'needs_revision'].includes(_weekData.active_version.status);
        const canCleanHoliday = _weekData?.active_version && !_weekData.week?.is_locked;

        const dayTotalMin = dayTimeline.totalPlannedMinutes || 0;
        const isHoliday = dayTimeline.isHoliday;
        const isLeave = dayTimeline.isLeave;
        const pct = isHoliday ? 100 : (isLeave ? 0 : Math.min(100, Math.round(dayTotalMin / 450 * 100)));
        const pctColor = isHoliday ? 'bg-indigo-500' : (isLeave ? 'bg-cyan-500' : (pct >= 90 ? 'bg-emerald-500' : (pct >= 60 ? 'bg-blue-500' : 'bg-amber-500')));

        let segHtml = '';
        if (isHoliday) {
            const hTitle = escapeHTML(dayTimeline.holidaySegment?.activity_title || dayTimeline.holidaySegment?.title || dayTimeline.slots[0]?.title || 'Libur / Dispensasi Resmi Sekolah');
            const ghostSegments = daySegments.filter(s => !s.is_holiday && s.catalog_id !== 'cat_libur' && s.category_code !== 'HOLIDAY');
            segHtml = `
            <div class="p-3.5 my-1 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 text-amber-800 dark:text-amber-300">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2.5">
                        <div class="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center shrink-0">
                            <i class="fa-solid fa-umbrella-beach text-amber-600 dark:text-amber-400 text-sm"></i>
                        </div>
                        <div>
                            <div class="font-bold text-xs text-amber-900 dark:text-amber-200">${hTitle}</div>
                            <div class="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">Hari libur kalender resmi sekolah. Target mingguan otomatis disesuaikan (bebas target).</div>
                        </div>
                    </div>
                    ${canEdit && dayTimeline.holidaySegment ? `
                        <button onclick="window.workloadDeletePlanItem('${dayTimeline.holidaySegment.id}')" class="text-rose-500 hover:text-rose-700 dark:text-rose-400 text-xs px-2.5 py-1 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors font-semibold flex items-center gap-1 shrink-0" title="Batalkan status libur">
                            <i class="fa-solid fa-trash-can text-[10px]"></i><span>Hapus</span>
                        </button>
                    ` : ''}
                </div>
                ${ghostSegments.length > 0 && canCleanHoliday ? `
                    <div class="mt-2.5 pt-2.5 border-t border-amber-200/80 dark:border-amber-900/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                        <div class="text-[11px] text-rose-600 dark:text-rose-400 font-semibold flex items-center gap-1.5">
                            <i class="fa-solid fa-triangle-exclamation"></i>
                            <span>Terdeteksi ${ghostSegments.length} kegiatan rencana tersimpan di hari libur ini.</span>
                        </div>
                        <button type="button" onclick="window.workloadClearHolidayDraftItems('${dayDate}')" class="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white text-xs font-bold transition-all flex items-center gap-1 shadow-xs cursor-pointer">
                            <i class="fa-solid fa-trash-can text-[10px]"></i>
                            <span>Tiadakan Rencana Hari Libur</span>
                        </button>
                    </div>
                ` : ''}
            </div>`;
        } else if (isLeave) {
            const leaveTitle = escapeHTML(dayTimeline.leaveTitle || 'Cuti / Izin Resmi');
            const leaveNotes = escapeHTML(dayTimeline.leaveNotes || '');
            segHtml = `
            <div class="flex items-center justify-between p-3.5 my-1 rounded-xl bg-cyan-50/80 dark:bg-cyan-950/40 border border-cyan-200 dark:border-cyan-800/60 text-cyan-900 dark:text-cyan-200">
                <div class="flex items-center gap-2.5">
                    <div class="w-8 h-8 rounded-lg bg-cyan-100 dark:bg-cyan-900/60 flex items-center justify-center shrink-0">
                        <i class="fa-solid fa-calendar-xmark text-cyan-600 dark:text-cyan-400 text-sm"></i>
                    </div>
                    <div>
                        <div class="font-bold text-xs text-cyan-900 dark:text-cyan-100">${leaveTitle}</div>
                        <div class="text-[10px] text-cyan-700 dark:text-cyan-300 mt-0.5">
                            Hari ini berstatus Cuti/Izin (jam kerja 0m). Bebas dari kewajiban rencana jam kerja.
                            ${leaveNotes ? `<span class="italic block text-slate-500 dark:text-slate-400 mt-0.5">Catatan: "${leaveNotes}"</span>` : ''}
                        </div>
                    </div>
                </div>
                ${canEdit && dayTimeline.leaveSegment ? `
                    <button onclick="window.workloadDeactivateDayLeave('${dayTimeline.leaveSegment.id}', ${i})" class="text-rose-600 hover:text-rose-700 dark:text-rose-400 text-xs px-2.5 py-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors font-bold flex items-center gap-1 shrink-0 border border-rose-200 dark:border-rose-800/60" title="Nonaktifkan Cuti/Izin dan kembalikan hari kerja aktif">
                        <i class="fa-solid fa-xmark text-[11px]"></i><span>Nonaktifkan Cuti</span>
                    </button>
                ` : (!canEdit && dayTimeline.leaveSegment ? `
                    <span class="text-[10px] text-slate-400 dark:text-slate-500 italic shrink-0" title="Untuk membatalkan cuti, klik Ubah ke Draf pada header modul terlebih dahulu">
                        Kunci (Ubah ke Draf untuk edit)
                    </span>
                ` : '')}
            </div>`;
        } else {
            let conflictBannerHtml = '';
            if (dayTimeline.hasConflict && canEdit) {
                conflictBannerHtml = `
                <div class="flex items-center justify-between p-2.5 my-1.5 rounded-xl bg-rose-50/90 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 text-xs">
                    <div class="flex items-center gap-2">
                        <i class="fa-solid fa-triangle-exclamation text-rose-500 text-sm"></i>
                        <span class="font-medium">Terdapat kegiatan yang bentrok/duplikat waktu pada hari ini.</span>
                    </div>
                    <button type="button" onclick="window.workloadAutoDeduplicate()" class="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 active:scale-95 text-white text-[10px] font-bold transition-all shadow-2xs flex items-center gap-1 shrink-0" title="Bersihkan kegiatan duplikat otomatis">
                        <i class="fa-solid fa-wand-magic-sparkles"></i><span>Bersihkan Duplikat</span>
                    </button>
                </div>`;
            }

            let slotItemsHtml = '';
            dayTimeline.slots.forEach(slot => {
                if (slot.type === 'activity') {
                    const seg = slot.segment || {};
                    const isRealized = isPlanSegmentRealized(seg);
                    const conflictBadge = slot.hasConflict ? '<span class="ml-1 text-[9px] px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300 font-extrabold inline-flex items-center gap-1 border border-rose-200 dark:border-rose-800"><i class="fa-solid fa-triangle-exclamation text-[8px]"></i> Bentrok</span>' : '';
                    const realizedBadge = isRealized ? '<span class="ml-1 text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 font-extrabold inline-flex items-center gap-1 border border-emerald-200 dark:border-emerald-800" title="Kegiatan rencana ini sudah direalisasikan dalam jurnal harian"><i class="fa-solid fa-circle-check text-[8px]"></i> Terealisasi</span>' : '';
                    const overtimeBadge = (slot.isOvertime || slot.endMin > 930 || slot.startMin < 450)
                        ? '<span class="ml-1 text-[9px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-semibold border border-blue-200 dark:border-blue-800" title="Kegiatan berlangsung di luar rentang jam operasional sekolah reguler (07:30–15:30)"><i class="fa-solid fa-moon text-[8px] mr-0.5"></i> Luar Jam Reguler</span>'
                        : '';
                    slotItemsHtml += `
                    <div class="flex items-center gap-3 py-2 px-2 border-b border-slate-100 dark:border-slate-800 last:border-0 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 rounded-lg transition-colors ${slot.hasConflict ? 'bg-rose-50/30 dark:bg-rose-950/20' : (isRealized ? 'bg-emerald-50/20 dark:bg-emerald-950/10' : '')}">
                        <div class="text-xs font-bold ${slot.hasConflict ? 'text-rose-600 dark:text-rose-400' : 'text-slate-700 dark:text-slate-300'} w-20 shrink-0">${slot.startTime}–${slot.endTime}</div>
                        <div class="flex-1 min-w-0 text-xs">
                            <span class="font-bold text-slate-800 dark:text-white">${escapeHTML(slot.title)}</span>
                            ${seg.is_teaching ? '<span class="ml-1 text-[9px] px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-bold">KBM</span>' : ''}
                            ${renderHbgBadge(seg, 'sm')}
                            ${conflictBadge}
                            ${realizedBadge}
                            ${overtimeBadge}
                            <span class="ml-1 text-[10px] text-slate-400 font-semibold">(${slot.durationMinutes || 0}m)</span>
                        </div>
                        ${canEdit ? (isRealized ? `
                            <div class="flex items-center shrink-0" title="Terkunci: Rencana yang telah direalisasikan tidak dapat disunting atau dihapus">
                                <span class="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 cursor-not-allowed">
                                    <i class="fa-solid fa-lock text-[9px]"></i> Terkunci
                                </span>
                            </div>
                        ` : `
                            <div class="flex items-center gap-1 shrink-0">
                                <button onclick="window.workloadOpenPlanItemModal(${i}, '${slot.id}')" class="text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 text-xs p-1 transition-colors" title="Edit item"><i class="fa-solid fa-pen-to-square"></i></button>
                                <button onclick="window.workloadDeletePlanItem('${slot.id}')" class="hidden sm:inline-block text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 text-xs p-1 transition-colors" title="Hapus item"><i class="fa-solid fa-trash-can"></i></button>
                            </div>
                        `) : ''}
                    </div>`;
                } else if (slot.type === 'break') {
                    slotItemsHtml += `
                    <div class="flex items-center gap-3 py-1.5 px-3 my-1 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-dashed border-slate-200 dark:border-slate-700/60 text-slate-500 dark:text-slate-400 text-xs">
                        <div class="font-semibold text-slate-500 dark:text-slate-400 w-20 shrink-0 text-[11px]">${slot.startTime}–${slot.endTime}</div>
                        <div class="flex-1 text-[11px] flex items-center gap-1.5 font-medium text-slate-600 dark:text-slate-300">
                            <i class="fa-solid fa-mug-hot text-amber-500"></i>
                            <span>${escapeHTML(slot.name)}</span>
                            <span class="text-[10px] text-slate-400">(${slot.durationMinutes}m)</span>
                        </div>
                        <span class="text-[9px] uppercase tracking-wider font-bold text-slate-400 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">Istirahat</span>
                    </div>`;
                } else if (slot.type === 'empty') {
                    slotItemsHtml += `
                    <div class="flex items-center gap-3 py-2 px-3 my-1.5 rounded-xl bg-rose-50/50 dark:bg-rose-950/20 border border-dashed border-rose-300 dark:border-rose-900/60 text-xs transition-colors">
                        <div class="font-bold text-rose-600 dark:text-rose-400 w-20 shrink-0 text-xs">${slot.startTime}–${slot.endTime}</div>
                        <div class="flex-1 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-1.5">
                            <i class="fa-solid fa-clock-rotate-left text-rose-500 text-xs"></i>
                            <span class="font-semibold">Slot Jam Kosong</span>
                            <span class="text-[10px] text-rose-500 font-bold">(${slot.durationMinutes}m)</span>
                        </div>
                        ${canEdit ? `
                            <button onclick="window.workloadOpenPlanItemModal(${i}, null, '${slot.startTime}', '${slot.endTime}')" class="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 active:scale-95 text-white text-[10px] font-bold transition-all shadow-2xs flex items-center gap-1 shrink-0" title="Rencanakan kegiatan pada rentang jam ini">
                                <i class="fa-solid fa-plus text-[9px]"></i><span>Isi Kegiatan</span>
                            </button>
                        ` : ''}
                    </div>`;
                }
            });
            segHtml = (conflictBannerHtml + slotItemsHtml) || '<div class="text-center py-4 text-slate-400 text-xs">Belum ada kegiatan.</div>';
        }

        const badgeText = isHoliday
            ? 'Libur Sekolah'
            : (isLeave
                ? 'Cuti/Izin (0m)'
                : `${dayTotalMin}/450m (${pct}%)`);

        const badgeColor = isHoliday
            ? 'text-indigo-600 dark:text-indigo-400'
            : (isLeave
                ? 'text-cyan-600 dark:text-cyan-400'
                : (pct >= 90 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'));

        const hasHbg = isStudyDay ? checkHasPkActivity(daySegments, i) : false;

        html += `
        <div class="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs overflow-hidden">
            <div class="flex items-center justify-between gap-2 px-3 sm:px-4 py-2 sm:py-2.5 bg-slate-50 dark:bg-slate-800/60">
                <div class="flex items-center gap-2.5 sm:gap-3 min-w-0">
                    <span class="w-8 h-8 rounded-xl ${isStudyDay ? 'bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300' : (isHoliday ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400' : (isLeave ? 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-600 dark:text-cyan-400' : (pct >= 90 ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600' : 'bg-slate-200 dark:bg-slate-700 text-slate-500')))} flex items-center justify-center text-xs font-bold shrink-0">${DAY_NAMES[i].slice(0, 2)}</span>
                    <div class="min-w-0 flex-1">
                        <div class="text-xs font-bold text-slate-800 dark:text-white flex items-center gap-1.5 flex-wrap">
                            <span>${DAY_NAMES[i]}</span>
                            <span class="text-[10px] text-slate-400 font-medium">${dayDate}</span>
                            ${isStudyDay ? `
                                <span class="text-[9px] px-1.5 sm:px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 font-extrabold flex items-center gap-1 border border-purple-200 dark:border-purple-800/60" title="Hari Belajar Guru (SE Mendikdasmen No. 5684/2025)"><i class="fa-solid fa-graduation-cap"></i> <span class="hidden xs:inline">Hari </span>Belajar<span class="hidden sm:inline"> Guru</span></span>
                                ${isLeave ? `
                                    <span class="text-[9px] px-1.5 sm:px-2 py-0.5 rounded-full bg-cyan-100 dark:bg-cyan-950 text-cyan-800 dark:text-cyan-300 font-bold flex items-center gap-1 border border-cyan-200 dark:border-cyan-800/60" title="Cuti/Izin pada Hari Belajar Guru (Bebas dari kewajiban kegiatan HBG)"><i class="fa-solid fa-user-clock"></i> Cuti (Bebas HBG)</span>
                                ` : (hasHbg ? '<span class="text-[9px] px-1.5 sm:px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 font-bold flex items-center gap-1 border border-emerald-200 dark:border-emerald-800/60" title="Kegiatan ranah Hari Belajar Guru terpenuhi"><i class="fa-solid fa-check"></i> HBG Terpenuhi</span>' : '<span class="text-[9px] px-1.5 sm:px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 font-bold flex items-center gap-1 border border-amber-200 dark:border-amber-800/60" title="Sesuai regulasi, wajib minimal ada 1 kegiatan ranah HBG (Perencanaan atau PKB/MGMP)"><i class="fa-solid fa-circle-exclamation"></i> Min. 1 HBG</span>')}
                            ` : ''}
                        </div>
                        <div class="flex items-center gap-2 mt-0.5">
                            <div class="w-16 sm:w-20 bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden shrink-0"><div class="${pctColor} h-full rounded-full" style="width:${pct}%"></div></div>
                            <span class="text-[10px] font-bold ${badgeColor} whitespace-nowrap">${badgeText}</span>
                        </div>
                    </div>
                </div>
                ${canEdit ? `
                    <div class="flex items-center gap-1 sm:gap-1.5 shrink-0">
                        ${isStudyDay && !isHoliday && !isLeave ? `
                            <button onclick="window.workloadQuickAddMgmp(${i})" class="px-2 sm:px-2.5 py-1 rounded-lg bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/40 dark:hover:bg-purple-900/40 text-purple-700 dark:text-purple-300 text-[10px] font-bold transition-all flex items-center gap-1 whitespace-nowrap shadow-2xs active:scale-95 cursor-pointer shrink-0" title="Tambah kegiatan MGMP/Komunitas Belajar (SE No. 5684/2025)">
                                <i class="fa-solid fa-graduation-cap text-[10px]"></i><span>+ HBG</span>
                            </button>
                        ` : ''}
                        ${!isHoliday && !isLeave ? `
                            <button type="button" onclick="window.workloadMarkDayLeave(${i})" aria-label="+ Cuti/Izin" class="px-2 sm:px-2.5 py-1 rounded-xl border border-slate-200 hover:border-cyan-400 dark:border-slate-700 dark:hover:border-cyan-600 bg-white hover:bg-cyan-50/60 dark:bg-slate-800 dark:hover:bg-cyan-950/40 text-slate-700 hover:text-cyan-700 dark:text-slate-300 dark:hover:text-cyan-300 text-[10px] font-bold shadow-2xs transition-all flex items-center gap-1 whitespace-nowrap active:scale-95 cursor-pointer shrink-0" title="Ajukan Cuti Tahunan atau Izin pada hari ini">
                                <i class="fa-solid fa-calendar-plus text-slate-400 hover:text-cyan-600 dark:text-slate-400 dark:hover:text-cyan-400 text-[10px]"></i><span>+ Cuti<span class="hidden sm:inline">/Izin</span></span>
                            </button>
                        ` : ''}
                    </div>
                ` : ''}
            </div>
            <div class="px-3.5 sm:px-4 py-2">${segHtml}</div>
        </div>`;
    }

    container.innerHTML = html;

    // ── Rekap Durasi per Tugas Pokok Guru (Permendikdasmen No. 11/2025) ──
    const summaryContainer = el('plan-duty-summary');
    if (summaryContainer) {
        // Hitung total durasi per category_code dari seluruh segment minggu ini
        const dutyTotals = {};
        let grandTotal = 0;
        const allDuties = MAIN_DUTIES_PERMEN_11_2025 || [];
        allDuties.forEach(d => { dutyTotals[d.code] = 0; });

        segments.forEach(seg => {
            if (seg.is_holiday || seg.catalog_id === 'cat_libur' || seg.category_code === 'HOLIDAY') return;
            const code = seg.category_code || 'TUGAS_TAMBAHAN';
            const dur = parseInt(seg.duration_minutes, 10) || 0;
            if (!dutyTotals.hasOwnProperty(code)) dutyTotals[code] = 0;
            dutyTotals[code] += dur;
            grandTotal += dur;
        });

        // Hanya tampilkan jika ada kegiatan
        if (grandTotal > 0) {
            const dutyColorMap = {
                'PELAKSANAAN_KBM': { bg: 'bg-blue-500', light: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-200 dark:border-blue-800/50' },
                'PERENCANAAN': { bg: 'bg-emerald-500', light: 'bg-emerald-100 dark:bg-emerald-900/40', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-200 dark:border-emerald-800/50' },
                'PENILAIAN': { bg: 'bg-amber-500', light: 'bg-amber-100 dark:bg-amber-900/40', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-200 dark:border-amber-800/50' },
                'PEMBIMBINGAN': { bg: 'bg-purple-500', light: 'bg-purple-100 dark:bg-purple-900/40', text: 'text-purple-700 dark:text-purple-300', border: 'border-purple-200 dark:border-purple-800/50' },
                'TUGAS_TAMBAHAN': { bg: 'bg-rose-500', light: 'bg-rose-100 dark:bg-rose-900/40', text: 'text-rose-700 dark:text-rose-300', border: 'border-rose-200 dark:border-rose-800/50' }
            };

            const maxMin = Math.max(...Object.values(dutyTotals), 1);
            let barsHtml = '';
            allDuties.forEach(d => {
                const mins = dutyTotals[d.code] || 0;
                const pct = Math.round(mins / grandTotal * 100);
                const barPct = Math.round(mins / maxMin * 100);
                const c = dutyColorMap[d.code] || dutyColorMap['TUGAS_TAMBAHAN'];
                const hours = Math.floor(mins / 60);
                const remMin = mins % 60;
                const durLabel = hours > 0 ? `${hours}j ${remMin}m` : `${mins}m`;

                barsHtml += `
                <div class="flex items-center gap-3">
                    <div class="w-6 h-6 rounded-lg ${c.light} flex items-center justify-center shrink-0">
                        <i class="fa-solid ${d.icon} text-[10px] ${c.text}"></i>
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center justify-between mb-0.5">
                            <span class="text-[11px] font-bold ${c.text} truncate">${escapeHTML(d.shortName)}</span>
                            <span class="text-[10px] font-extrabold text-slate-700 dark:text-slate-200 shrink-0 ml-2">${durLabel} <span class="text-slate-400 font-semibold">(${pct}%)</span></span>
                        </div>
                        <div class="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                            <div class="${c.bg} h-full rounded-full transition-all duration-500" style="width:${barPct}%"></div>
                        </div>
                    </div>
                </div>`;
            });

            const grandHours = Math.floor(grandTotal / 60);
            const grandRemMin = grandTotal % 60;
            const grandLabel = grandHours > 0 ? `${grandHours} jam ${grandRemMin} menit` : `${grandTotal} menit`;

            summaryContainer.innerHTML = `
            <div class="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs p-4">
                <div class="flex items-center justify-between mb-3">
                    <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded-xl bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
                            <i class="fa-solid fa-chart-pie text-indigo-600 dark:text-indigo-400 text-sm"></i>
                        </div>
                        <div>
                            <h4 class="text-xs font-bold text-slate-800 dark:text-white">Rekap Durasi per Tugas Pokok</h4>
                            <p class="text-[10px] text-slate-400">Permendikdasmen No. 11/2025 • Total: <span class="font-bold text-slate-600 dark:text-slate-300">${grandLabel}</span></p>
                        </div>
                    </div>
                </div>
                <div class="space-y-2.5">${barsHtml}</div>
            </div>`;
            summaryContainer.classList.remove('hidden');
        } else {
            summaryContainer.innerHTML = '';
            summaryContainer.classList.add('hidden');
        }
    }
}

// ========== TAB: TEMPLATE ==========
function renderTemplatesTab() {
    updateRealisasiToolbarVisibility();
    updatePlanToolbarVisibility();
    const container = el('templates-list-container');
    if (!container) return;

    if (!_templates || _templates.length === 0) {
        container.innerHTML = `
            <div class="col-span-2 text-center py-10 text-slate-400 text-xs bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs">
                <i class="fa-regular fa-copy text-4xl mb-3 text-slate-300"></i>
                <p class="font-semibold text-sm text-slate-500 dark:text-slate-400 mb-1">Belum ada template tersimpan</p>
                <p>Susun rencana mingguan di tab "Rencana Mingguan", lalu klik "Simpan Jadi Template" untuk menyimpan pola rutin.</p>
            </div>`;
        return;
    }

    let html = '';
    _templates.forEach(t => {
        const items = t.items || [];
        const daySet = new Set(items.map(it => it.day_of_week));
        html += `
        <div class="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs p-4">
            <div class="flex items-start justify-between mb-3">
                <div>
                    <div class="flex items-center gap-2">
                        <span class="font-bold text-sm text-slate-800 dark:text-white">${t.template_name}</span>
                        ${t.is_default ? '<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">Default</span>' : ''}
                    </div>
                    <div class="text-[11px] text-slate-400 mt-0.5">${items.length} kegiatan · ${daySet.size} hari · ~${t.total_estimated_minutes || 0} menit</div>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                    <button type="button" onclick="window.workloadOpenTemplateDetail('${t.id}')" class="px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold transition-all flex items-center gap-1 active:scale-95 cursor-pointer" title="Lihat Rincian Kegiatan Non-KBM">
                        <i class="fa-solid fa-eye text-emerald-600 dark:text-emerald-400"></i> <span>Detail</span>
                    </button>
                    <button type="button" onclick="window.workloadDeleteTemplate('${t.id}')" class="text-rose-400 hover:text-rose-600 dark:hover:text-rose-300 text-xs p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer" title="Hapus Template">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            </div>
            <div class="space-y-1 text-xs max-h-40 overflow-y-auto">
                ${items.slice(0, 8).map(it => `
                    <div class="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                        <span class="text-[10px] font-bold text-slate-400 w-8">${DAY_NAMES[(it.day_of_week || 1) - 1]?.slice(0, 2) || '??'}</span>
                        <span>${it.start_time}–${it.end_time}</span>
                        <span class="font-semibold text-slate-700 dark:text-slate-300 truncate">${it.title}</span>
                    </div>
                `).join('')}
                ${items.length > 8 ? `<div class="text-slate-400 text-[10px]">...dan ${items.length - 8} kegiatan lainnya</div>` : ''}
            </div>
        </div>`;
    });
    container.innerHTML = html;

    window.workloadDeleteTemplate = async (id) => {
        const ok = await askConfirm('Apakah Anda yakin ingin menghapus template rencana kerja ini? Tindakan ini tidak dapat dibatalkan.', 'Hapus Template', 'danger', { confirmText: 'Hapus Template' });
        if (!ok) return;
        try {
            await cfDeleteWorkloadTemplate(id);
            showToast('Template berhasil dihapus');
            _templates = await cfGetWorkloadTemplates();
            renderTemplatesTab();
        } catch (e) { showToast(e.message, 'error'); }
    };
}

// ========== FORMAT KONVERSI DURASI KE JP (DURASI / 45 JP) ==========
export function formatDurationToJp(minutes) {
    const min = Number(minutes) || 0;
    if (min <= 0) return '0 JP';
    const val = min / 45;
    const rounded = Math.round(val * 10) / 10;
    const str = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    return `${str} JP`;
}

// ========== MODAL DETAIL KEGIATAN NON-KBM TEMPLATE ==========
export function openTemplateDetail(templateId) {
    const modal = el('modal-template-detail');
    if (!modal) return;

    const template = (_templates || []).find(t => t.id === templateId);
    if (!template) {
        showToast('Data template tidak ditemukan', 'error');
        return;
    }

    const titleEl = el('template-detail-title');
    if (titleEl) titleEl.textContent = template.template_name || 'Rincian Template';

    const defaultBadge = el('template-detail-default-badge');
    if (defaultBadge) {
        defaultBadge.classList.toggle('hidden', !template.is_default);
    }

    // Filter murni non-KBM (mengecualikan kegiatan tatap muka KBM)
    const nonKbmItems = (template.items || []).filter(it => {
        if (it.is_teaching === 1 || it.is_teaching === true || it.is_teaching === '1') return false;
        if (it.catalog_id === 'cat_kbm' || it.category_code === 'PELAKSANAAN_KBM' || it.duty_code === 'PELAKSANAAN_KBM') return false;
        return !isTeachingActivity(it);
    });

    // Urutkan flat list kronologis (Senin s.d Jumat, jam mulai)
    nonKbmItems.sort((a, b) => {
        const dayDiff = (Number(a.day_of_week) || 1) - (Number(b.day_of_week) || 1);
        if (dayDiff !== 0) return dayDiff;
        return (a.start_time || '').localeCompare(b.start_time || '');
    });

    const totalMinutes = nonKbmItems.reduce((acc, it) => {
        const m = Number(it.estimated_minutes) || (it.start_time && it.end_time ? calcEffective(it.start_time, it.end_time) : 0);
        return acc + m;
    }, 0);

    const statCount = el('template-detail-stat-count');
    if (statCount) statCount.textContent = `${nonKbmItems.length}`;

    const statMinutes = el('template-detail-stat-minutes');
    if (statMinutes) statMinutes.textContent = `${totalMinutes} menit`;

    const statJp = el('template-detail-stat-jp');
    if (statJp) statJp.textContent = formatDurationToJp(totalMinutes);

    const bodyEl = el('template-detail-body');
    if (bodyEl) {
        if (nonKbmItems.length === 0) {
            bodyEl.innerHTML = `
                <div class="text-center py-12 px-4 text-slate-400">
                    <div class="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 mx-auto mb-3 text-xl">
                        <i class="fa-solid fa-chalkboard-user"></i>
                    </div>
                    <p class="font-bold text-sm text-slate-700 dark:text-slate-300 mb-1">Tidak Ada Kegiatan Non-KBM</p>
                    <p class="text-xs text-slate-400 max-w-sm mx-auto">Seluruh kegiatan pada template ini merupakan jam tatap muka KBM (Pelaksanaan Pembelajaran).</p>
                </div>`;
        } else {
            const DUTY_STYLE_MAP = {
                'PERENCANAAN': { label: 'Perencanaan', bg: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800/60' },
                'PENILAIAN': { label: 'Penilaian', bg: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/60' },
                'PEMBIMBINGAN': { label: 'Pembimbingan', bg: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60' },
                'TUGAS_TAMBAHAN': { label: 'Tugas Tambahan', bg: 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800/60' },
                'HBG': { label: 'Hari Belajar Guru', bg: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800/60' }
            };

            const rowsHtml = nonKbmItems.map(it => {
                const dayName = DAY_NAMES[(Number(it.day_of_week) || 1) - 1] || 'Senin';
                const minutes = Number(it.estimated_minutes) || (it.start_time && it.end_time ? calcEffective(it.start_time, it.end_time) : 0);
                const jpText = formatDurationToJp(minutes);

                const catObj = (_catalog || []).find(c => c.id === it.catalog_id);
                let catCode = it.category_code || catObj?.category_code;
                if (!catCode) {
                    if (it.catalog_id && it.catalog_id.startsWith('cat_bimbing')) catCode = 'PEMBIMBINGAN';
                    else if (it.catalog_id && it.catalog_id.startsWith('cat_tt')) catCode = 'TUGAS_TAMBAHAN';
                    else if (it.catalog_id && (it.catalog_id.startsWith('cat_penilaian') || it.catalog_id.startsWith('cat_evaluasi'))) catCode = 'PENILAIAN';
                    else catCode = 'PERENCANAAN';
                }

                const dutyDef = MAIN_DUTIES_PERMEN_11_2025.find(d => d.code === catCode);
                const categoryName = dutyDef?.shortName || dutyDef?.name || DUTY_STYLE_MAP[catCode]?.label || catCode;
                const badgeStyle = DUTY_STYLE_MAP[catCode]?.bg || 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700';

                const isHbg = (typeof isCatalogItemHbg === 'function' && isCatalogItemHbg(catObj)) || (it.title && String(it.title).toUpperCase().includes('HBG'));
                const hbgBadge = isHbg ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/60 shrink-0"><i class="fa-solid fa-graduation-cap text-[8px] mr-0.5"></i>HBG</span>` : '';

                return `
                <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td class="p-3 whitespace-nowrap">
                        <div class="font-bold text-slate-800 dark:text-white">${dayName}</div>
                        <div class="text-[11px] text-slate-400 mt-0.5">${escapeHTML(it.start_time || '00:00')} – ${escapeHTML(it.end_time || '00:00')}</div>
                    </td>
                    <td class="p-3 whitespace-nowrap">
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold border ${badgeStyle}">
                            ${escapeHTML(categoryName)}
                        </span>
                    </td>
                    <td class="p-3">
                        <div class="font-semibold text-slate-800 dark:text-white flex items-center gap-1.5 flex-wrap">
                            <span>${escapeHTML(it.title || catObj?.name || 'Kegiatan Non-KBM')}</span>
                            ${hbgBadge}
                        </div>
                        ${it.description && it.description.trim() !== (it.title || '').trim() ? `<div class="text-[11px] text-slate-400 line-clamp-2 mt-0.5">${escapeHTML(it.description)}</div>` : ''}
                    </td>
                    <td class="p-3 text-center whitespace-nowrap">
                        <span class="px-2 py-0.5 rounded-lg text-xs font-extrabold bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/50">${jpText}</span>
                        <div class="text-[10px] text-slate-400 mt-0.5">${minutes} menit</div>
                    </td>
                </tr>`;
            }).join('');

            bodyEl.innerHTML = `
                <div class="overflow-x-auto rounded-2xl border border-slate-100 dark:border-slate-800">
                    <table class="w-full text-left border-collapse text-xs">
                        <thead>
                            <tr class="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-100 dark:border-slate-800 text-slate-500 dark:text-slate-400 text-[11px] font-semibold">
                                <th class="p-3 whitespace-nowrap">Hari & Waktu</th>
                                <th class="p-3 whitespace-nowrap">Kategori Tugas</th>
                                <th class="p-3">Nama Kegiatan</th>
                                <th class="p-3 text-center whitespace-nowrap">Durasi / JP</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>`;
        }
    }

    modal.classList.remove('hidden');
}

export function closeTemplateDetail() {
    el('modal-template-detail')?.classList.add('hidden');
}

// ========== TAB: REGULASI ==========
function renderRegulasiTab() {
    updateRealisasiToolbarVisibility();
    updatePlanToolbarVisibility();
    const tbody = el('table-teacher-assignments-body');
    if (tbody) {
        if (!_assignments || _assignments.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-slate-400 text-xs">Belum ada penugasan tugas tambahan yang terdaftar untuk Anda.</td></tr>';
        } else {
            let html = '';
            _assignments.forEach(a => {
                const today = todayWITA();
                const isExpired = a.valid_until && a.valid_until < today;
                const noSK = !a.sk_number || !a.sk_number.trim();
                let statusHtml = '';
                if (isExpired) statusHtml = '<span class="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300">Kedaluwarsa</span>';
                else if (noSK) statusHtml = '<span class="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">Belum ada SK</span>';
                else statusHtml = '<span class="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">Aktif</span>';

                html += `<tr class="${isExpired ? 'opacity-60' : ''}">
                    <td class="p-3 font-semibold">${escapeHTML(a.duty_name || a.duty_code)}</td>
                    <td class="p-3">${escapeHTML(a.sk_number) || '<span class="text-amber-500 font-bold">—</span>'}</td>
                    <td class="p-3 font-bold text-purple-600 dark:text-purple-400">${a.equivalent_jp || 0} JP-Eq</td>
                    <td class="p-3">${a.valid_from || '—'} s.d ${a.valid_until || '—'}</td>
                    <td class="p-3">${statusHtml}</td>
                </tr>`;
            });
            tbody.innerHTML = html;
        }
    }

    renderManagerCatalogSection();
    renderManagerWakaDutiesSection();
}

export async function renderManagerCatalogSection() {
    const sec = el('manager-catalog-management-section');
    if (!sec) return;

    const isMgr = isCurrentUserWorkloadManager();
    if (!isMgr) {
        sec.classList.add('hidden');
        return;
    }
    sec.classList.remove('hidden');

    const tbody = el('table-master-catalog-body');
    if (!tbody) return;

    if (!_catalog || _catalog.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="p-4 text-center text-slate-400">Tidak ada sub-kegiatan di katalog.</td></tr>';
        return;
    }

    const dutyMap = {
        'PERENCANAAN': '1. Perencanaan',
        'PELAKSANAAN_KBM': '2. Pelaksanaan KBM',
        'PENILAIAN': '3. Penilaian',
        'PEMBIMBINGAN': '4. Pembimbingan',
        'TUGAS_TAMBAHAN': '5. Tugas Tambahan'
    };

    let html = '';
    _catalog.forEach(item => {
        const dutyLabel = dutyMap[item.category_code] || item.category_code || 'Lainnya';
        const jp = getCatalogItemEquivalentJp(item);
        const jpDisplay = jp > 0 ? `<span class="font-bold text-purple-600 dark:text-purple-400">${jp} JP</span>` : '<span class="text-slate-400">—</span>';
        const durDisplay = `${item.default_duration_minutes || 45}m`;
        const kbmDisplay = item.is_teaching ? '<span class="text-emerald-600 font-semibold"><i class="fa-solid fa-check"></i> Ya</span>' : '<span class="text-slate-400">Bukan</span>';
        const isActive = item.is_active !== 0;
        const statusBadge = isActive
            ? '<span class="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">Aktif</span>'
            : '<span class="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500">Nonaktif</span>';

        html += `
        <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors ${!isActive ? 'opacity-50' : ''}">
            <td class="p-3 font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap">${escapeHTML(dutyLabel)}</td>
            <td class="p-3">
                <div class="font-bold text-slate-800 dark:text-white">${escapeHTML(item.name)}</div>
                ${item.description ? `<div class="text-[11px] text-slate-400 line-clamp-1 mt-0.5">${escapeHTML(item.description)}</div>` : ''}
            </td>
            <td class="p-3 text-center">${jpDisplay}</td>
            <td class="p-3 text-center font-medium">${durDisplay}</td>
            <td class="p-3 text-center">${kbmDisplay}</td>
            <td class="p-3 text-center">${statusBadge}</td>
            <td class="p-3 text-center whitespace-nowrap">
                <div class="flex items-center justify-center gap-1">
                    <button type="button" onclick="window.workloadOpenCatalogModal('${item.id}')" class="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/30 dark:hover:bg-amber-900/50 text-amber-700 dark:text-amber-300 text-xs font-bold transition-all flex items-center gap-1 active:scale-95" title="Edit Sub-Kegiatan">
                        <i class="fa-solid fa-pen-to-square"></i> <span>Edit</span>
                    </button>
                    <button type="button" onclick="window.workloadToggleCatalogItemActive('${item.id}')" class="px-2.5 py-1 rounded-lg ${isActive ? 'bg-rose-50 hover:bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300' : 'bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'} text-xs font-bold transition-all flex items-center gap-1 active:scale-95" title="${isActive ? 'Nonaktifkan' : 'Aktifkan'}">
                        <i class="fa-solid ${isActive ? 'fa-ban' : 'fa-check'}"></i> <span>${isActive ? 'Nonaktif' : 'Aktif'}</span>
                    </button>
                </div>
            </td>
        </tr>`;
    });

    tbody.innerHTML = html;
}

export function openCatalogModal(catalogId = null) {
    const modal = el('modal-manage-catalog-item');
    if (!modal) return;

    const titleEl = el('modal-catalog-item-title');
    const idInput = el('catalog-input-id');
    const dutyInput = el('catalog-input-duty');
    const nameInput = el('catalog-input-name');
    const descInput = el('catalog-input-desc');
    const jpInput = el('catalog-input-jp');
    const durInput = el('catalog-input-duration');
    const teachInput = el('catalog-input-teaching');
    const actInput = el('catalog-input-active');

    if (catalogId) {
        const item = (_catalog || []).find(c => c.id === catalogId);
        if (!item) return;

        if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-pen-to-square text-purple-600"></i> Edit Sub-Kegiatan Guru';
        if (idInput) idInput.value = item.id;
        if (dutyInput) dutyInput.value = item.category_code || 'PELAKSANAAN_KBM';
        if (nameInput) nameInput.value = item.name || '';
        if (descInput) descInput.value = item.description || '';
        if (jpInput) jpInput.value = getCatalogItemEquivalentJp(item) || 0;
        if (durInput) durInput.value = item.default_duration_minutes || 45;
        if (teachInput) teachInput.value = item.is_teaching ? '1' : '0';
        if (actInput) actInput.value = item.is_active !== 0 ? '1' : '0';
    } else {
        if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-plus text-purple-600"></i> Tambah Sub-Kegiatan Guru Baru';
        if (idInput) idInput.value = '';
        if (dutyInput) dutyInput.value = 'PELAKSANAAN_KBM';
        if (nameInput) nameInput.value = '';
        if (descInput) descInput.value = '';
        if (jpInput) jpInput.value = '0';
        if (durInput) durInput.value = '45';
        if (teachInput) teachInput.value = '0';
        if (actInput) actInput.value = '1';
    }

    modal.classList.remove('hidden');
    setTimeout(() => nameInput?.focus(), 50);
}

export function closeCatalogModal() {
    el('modal-manage-catalog-item')?.classList.add('hidden');
}

export async function saveCatalogItem(e) {
    if (e && e.preventDefault) e.preventDefault();

    const id = el('catalog-input-id')?.value?.trim();
    const dutyCode = el('catalog-input-duty')?.value || 'PELAKSANAAN_KBM';
    const name = el('catalog-input-name')?.value?.trim();
    const desc = el('catalog-input-desc')?.value?.trim() || '';
    const jp = parseInt(el('catalog-input-jp')?.value || '0', 10);
    const duration = parseInt(el('catalog-input-duration')?.value || '45', 10);
    const isTeaching = el('catalog-input-teaching')?.value === '1' ? 1 : 0;
    const isActive = el('catalog-input-active')?.value === '1' ? 1 : 0;

    if (!name) {
        showToast('Nama sub-kegiatan wajib diisi', 'error');
        return;
    }

    const payload = {
        name,
        category_code: dutyCode,
        description: desc,
        equivalent_jp: jp,
        default_duration_minutes: duration,
        is_teaching: isTeaching,
        is_active: isActive
    };
    if (id) payload.id = id;

    try {
        await cfSaveWorkloadCatalogItem(payload);
        showToast(id ? 'Sub-kegiatan berhasil diperbarui' : 'Sub-kegiatan berhasil ditambahkan');
        closeCatalogModal();

        // Refresh katalog (sertakan inactive untuk manager)
        const catRes = await cfGetWorkloadCatalog(true);
        _catalog = Array.isArray(catRes) ? catRes : (catRes?.data || []);
        renderManagerCatalogSection();

        const dutySelect = el('plan-input-main-duty');
        if (dutySelect) populateCatalogDropdownByDuty(dutySelect.value);
    } catch (err) {
        showToast(err.message || 'Gagal menyimpan sub-kegiatan', 'error');
    }
}

export async function toggleCatalogItemActive(catalogId) {
    const item = (_catalog || []).find(c => c.id === catalogId);
    if (!item) return;

    const newStatus = item.is_active === 0 ? 1 : 0;
    const actionLabel = newStatus === 1 ? 'mengaktifkan' : 'menonaktifkan';
    const confirmType = newStatus === 1 ? 'warning' : 'danger';
    const confirmBtnText = newStatus === 1 ? 'Ya, Aktifkan' : 'Ya, Nonaktifkan';

    const ok = await askConfirm(
        `Apakah Anda yakin ingin ${actionLabel} sub-kegiatan "${item.name}"?`,
        `${newStatus === 1 ? 'Aktifkan' : 'Nonaktifkan'} Sub-Kegiatan`,
        confirmType,
        { confirmText: confirmBtnText }
    );
    if (!ok) {
        return;
    }

    try {
        await cfSaveWorkloadCatalogItem({
            id: item.id,
            is_active: newStatus
        });
        showToast(`Sub-kegiatan berhasil di${newStatus === 1 ? 'aktifkan' : 'nonaktifkan'}`);

        // Refresh katalog
        const catRes = await cfGetWorkloadCatalog(true);
        _catalog = Array.isArray(catRes) ? catRes : (catRes?.data || []);
        renderManagerCatalogSection();

        const dutySelect = el('plan-input-main-duty');
        if (dutySelect) populateCatalogDropdownByDuty(dutySelect.value);
    } catch (err) {
        showToast(err.message || 'Gagal mengubah status', 'error');
    }
}

// ========== MANAJEMEN BUTIR TUGAS WAKIL KEPALA SEKOLAH (WAKA) ==========
export async function loadWakaDuties(forceRefresh = false) {
    // Cache hasil fallback tidak dipakai ulang agar pemanggilan berikutnya mencoba server lagi
    if (_wakaDutiesCache && !forceRefresh && !_wakaDutiesIsFallback) {
        return _wakaDutiesCache;
    }
    const normalize = d => ({
        ...d,
        order_number: Number(d.duty_number ?? d.order_number ?? 1),
        duty_number: Number(d.duty_number ?? d.order_number ?? 1),
        title: String(d.duty_title || d.title || ''),
        duty_title: String(d.duty_title || d.title || ''),
        description: String(d.duty_description || d.description || ''),
        duty_description: String(d.duty_description || d.description || ''),
        is_active: d.is_active !== undefined ? Number(d.is_active) : 1
    });
    try {
        const isMgr = isCurrentUserWorkloadManager();
        const res = await cfGetWakaDuties(null, isMgr);
        const list = Array.isArray(res) ? res : (res?.data || []);
        // Respons sukses dipakai apa adanya, termasuk daftar kosong (mis. semua butir dinonaktifkan)
        _wakaDutiesCache = list.map(normalize);
        _wakaDutiesIsFallback = false;
    } catch (e) {
        console.warn('Gagal memuat butir tugas waka dari Cloudflare D1:', e);
        if (_wakaDutiesCache && !_wakaDutiesIsFallback) {
            showToast('Gagal memuat ulang butir tugas waka dari server. Menampilkan data terakhir yang berhasil dimuat.', 'warning', 6000);
        } else if (!_wakaDutiesIsFallback) {
            _wakaDutiesCache = WAKA_DUTIES_INITIAL_SEED.map(normalize);
            _wakaDutiesIsFallback = true;
            showToast('Gagal memuat butir tugas waka dari server. Menampilkan data bawaan yang mungkin belum mencakup perubahan terbaru.', 'warning', 6000);
        }
    }
    return _wakaDutiesCache;
}

export async function renderManagerWakaDutiesSection() {
    const sec = el('manager-waka-duties-management-section');
    if (!sec) return;

    // Selalu tampilkan section rincian tugas waka di tab regulasi sebagai pedoman resmi
    sec.classList.remove('hidden');

    const isMgr = isCurrentUserWorkloadManager();
    const btnAdd = el('btn-add-waka-duty');
    if (btnAdd) {
        if (isMgr) btnAdd.classList.remove('hidden');
        else btnAdd.classList.add('hidden');
    }

    await loadWakaDuties();

    // Perbarui tab pill aktif
    const tabs = ['kurikulum', 'kesiswaan', 'sarpras', 'humas'];
    tabs.forEach(t => {
        const btn = el(`tab-pill-waka-${t}`);
        if (!btn) return;
        if (t === _activeWakaPolicyTab) {
            btn.className = 'px-3 py-1 rounded-lg bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 font-bold shadow-2xs transition-all cursor-pointer';
        } else {
            btn.className = 'px-3 py-1 rounded-lg text-slate-600 dark:text-slate-300 hover:text-indigo-600 transition-all cursor-pointer';
        }
    });

    // Perbarui Banner Tugas Pokok Bidang Terpilih
    const dutyInfo = getWakaMainDutyInfo(_activeWakaPolicyTab);
    const titleEl = el('waka-policy-banner-title');
    const descEl = el('waka-policy-banner-desc');
    if (dutyInfo) {
        if (titleEl) titleEl.textContent = `${dutyInfo.title}:`;
        if (descEl) descEl.textContent = dutyInfo.main_duty || dutyInfo.description || '';
    }

    renderMasterWakaDutiesTable();
}

export function switchWakaDutyTab(type) {
    const normalized = String(type || '').toLowerCase().trim();
    if (!['kurikulum', 'kesiswaan', 'sarpras', 'humas'].includes(normalized)) return;
    _activeWakaPolicyTab = normalized;
    renderManagerWakaDutiesSection();
}

export function renderMasterWakaDutiesTable() {
    const tbody = el('table-master-waka-duties-body');
    if (!tbody) return;

    const isMgr = isCurrentUserWorkloadManager();
    const thAksi = el('th-waka-duties-action');
    if (thAksi) {
        if (isMgr) thAksi.classList.remove('hidden');
        else thAksi.classList.add('hidden');
    }

    const items = (_wakaDutiesCache || [])
        .filter(d => (d.waka_type || '').toLowerCase() === _activeWakaPolicyTab.toLowerCase() && (isMgr || d.is_active !== 0))
        .sort((a, b) => (Number(a.duty_number ?? a.order_number) || 0) - (Number(b.duty_number ?? b.order_number) || 0));

    const colspan = isMgr ? 4 : 3;
    const fallbackRow = _wakaDutiesIsFallback
        ? `<tr><td colspan="${colspan}" class="p-3 text-xs font-semibold text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800/60"><i class="fa-solid fa-triangle-exclamation mr-1"></i> Server tidak dapat dihubungi. Daftar di bawah adalah data bawaan dan mungkin belum mencakup perubahan terbaru.</td></tr>`
        : '';

    if (items.length === 0) {
        tbody.innerHTML = fallbackRow + `<tr><td colspan="${colspan}" class="p-4 text-center text-slate-400">Belum ada butir tugas terdaftar untuk bidang ini.</td></tr>`;
        return;
    }

    let html = fallbackRow;
    items.forEach(item => {
        const isActive = item.is_active !== 0;
        const statusBadge = isActive
            ? '<span class="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">Aktif</span>'
            : '<span class="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700">Nonaktif</span>';

        const num = item.duty_number ?? item.order_number ?? '-';
        const titleText = item.duty_title || item.title || '';
        const descText = item.duty_description || item.description || '';

        html += `<tr class="${!isActive ? 'opacity-50' : ''}">
            <td class="p-3 text-center font-bold text-slate-500">${num}</td>
            <td class="p-3">
                <div class="font-semibold text-slate-800 dark:text-white">${escapeHTML(titleText)}</div>
                ${descText ? `<div class="text-[11px] text-slate-400 mt-0.5">${escapeHTML(descText)}</div>` : ''}
            </td>
            <td class="p-3 text-center">${statusBadge}</td>
            ${isMgr ? `<td class="p-3 text-center whitespace-nowrap">
                <div class="flex items-center justify-center gap-1">
                    <button type="button" onclick="window.workloadOpenWakaDutyModal('${item.id}')" class="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 text-xs font-bold transition-all flex items-center gap-1 active:scale-95 cursor-pointer" title="Edit Butir Tugas">
                        <i class="fa-solid fa-pen-to-square"></i> <span>Edit</span>
                    </button>
                    <button type="button" onclick="window.workloadToggleWakaDutyActive('${item.id}')" class="px-2.5 py-1 rounded-lg ${isActive ? 'bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' : 'bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'} text-xs font-bold transition-all flex items-center gap-1 active:scale-95 cursor-pointer" title="${isActive ? 'Nonaktifkan' : 'Aktifkan'}">
                        <i class="fa-solid ${isActive ? 'fa-ban' : 'fa-check'}"></i> <span>${isActive ? 'Nonaktif' : 'Aktif'}</span>
                    </button>
                    <button type="button" onclick="window.workloadDeleteWakaDutyItem('${item.id}')" class="px-2 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 text-xs font-bold transition-all flex items-center gap-1 active:scale-95 cursor-pointer" title="Hapus Butir Tugas">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            </td>` : ''}
        </tr>`;
    });

    tbody.innerHTML = html;
}

export function openWakaDutyModal(dutyId = null) {
    const modal = el('modal-manage-waka-duty-item');
    if (!modal) return;

    const titleEl = el('modal-waka-duty-item-title');
    const idInput = el('waka-duty-input-id');
    const typeInput = el('waka-duty-input-type');
    const numInput = el('waka-duty-input-number');
    const actInput = el('waka-duty-input-active');
    const titleInput = el('waka-duty-input-title');
    const descInput = el('waka-duty-input-desc');

    if (dutyId) {
        const item = (_wakaDutiesCache || []).find(d => d.id === dutyId);
        if (!item) return;

        if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-pen-to-square text-indigo-600"></i> Edit Butir Tugas Waka';
        if (idInput) idInput.value = item.id;
        if (typeInput) typeInput.value = item.waka_type || _activeWakaPolicyTab;
        if (numInput) numInput.value = item.duty_number ?? item.order_number ?? 1;
        if (actInput) actInput.value = item.is_active !== 0 ? '1' : '0';
        if (titleInput) titleInput.value = item.duty_title || item.title || '';
        if (descInput) descInput.value = item.duty_description || item.description || '';
    } else {
        const sameTypeItems = (_wakaDutiesCache || []).filter(d => (d.waka_type || '').toLowerCase() === _activeWakaPolicyTab.toLowerCase());
        const maxNum = sameTypeItems.reduce((acc, curr) => Math.max(acc, Number(curr.duty_number ?? curr.order_number) || 0), 0);

        if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-plus text-indigo-600"></i> Tambah Butir Tugas Waka Baru';
        if (idInput) idInput.value = '';
        if (typeInput) typeInput.value = _activeWakaPolicyTab || 'kurikulum';
        if (numInput) numInput.value = maxNum + 1;
        if (actInput) actInput.value = '1';
        if (titleInput) titleInput.value = '';
        if (descInput) descInput.value = '';
    }

    modal.classList.remove('hidden');
    setTimeout(() => titleInput?.focus(), 50);
}

export function closeWakaDutyModal() {
    el('modal-manage-waka-duty-item')?.classList.add('hidden');
}

export async function saveWakaDutyItem(e) {
    if (e && e.preventDefault) e.preventDefault();

    const id = el('waka-duty-input-id')?.value?.trim();
    const wakaType = el('waka-duty-input-type')?.value || _activeWakaPolicyTab;
    const orderNum = parseInt(el('waka-duty-input-number')?.value || '1', 10);
    const isActive = el('waka-duty-input-active')?.value === '1' ? 1 : 0;
    const title = el('waka-duty-input-title')?.value?.trim();
    const desc = el('waka-duty-input-desc')?.value?.trim() || '';

    if (!title) {
        showToast('Uraian / teks butir tugas waka wajib diisi', 'error');
        return;
    }

    const payload = {
        action: 'upsert',
        waka_type: wakaType,
        duty_number: isNaN(orderNum) ? 1 : orderNum,
        order_number: isNaN(orderNum) ? 1 : orderNum,
        duty_title: title,
        title: title,
        duty_description: desc,
        description: desc,
        is_active: isActive
    };
    if (id) payload.id = id;

    try {
        await cfSaveWakaDutyItem(payload);
        showToast(id ? 'Butir tugas waka berhasil diperbarui' : 'Butir tugas waka berhasil ditambahkan');
        closeWakaDutyModal();

        await loadWakaDuties(true);
        renderManagerWakaDutiesSection();

        const curCatId = el('plan-input-catalog')?.value;
        if (isWakaCatalogId(curCatId) && getWakaTypeFromCatalogId(curCatId) === wakaType) {
            renderPlanWakaDutyDropdown(wakaType);
        }
        const curLogCatId = el('log-input-catalog')?.value;
        if (isWakaCatalogId(curLogCatId) && getWakaTypeFromCatalogId(curLogCatId) === wakaType) {
            renderLogWakaDutyDropdown(wakaType);
        }
    } catch (err) {
        showToast(err.message || 'Gagal menyimpan butir tugas waka', 'error');
    }
}

export async function toggleWakaDutyActive(dutyId) {
    const item = (_wakaDutiesCache || []).find(d => d.id === dutyId);
    if (!item) return;

    const newStatus = item.is_active === 0 ? 1 : 0;
    const actionLabel = newStatus === 1 ? 'mengaktifkan' : 'menonaktifkan';
    const titleText = item.duty_title || item.title || '';

    const ok = await askConfirm(
        `Apakah Anda yakin ingin ${actionLabel} butir tugas "${titleText}"?`,
        `${newStatus === 1 ? 'Aktifkan' : 'Nonaktifkan'} Butir Tugas`,
        newStatus === 1 ? 'warning' : 'danger',
        { confirmText: newStatus === 1 ? 'Ya, Aktifkan' : 'Ya, Nonaktifkan' }
    );
    if (!ok) return;

    try {
        await cfSaveWakaDutyItem({
            action: 'upsert',
            id: item.id,
            waka_type: item.waka_type,
            duty_number: item.duty_number ?? item.order_number ?? 1,
            order_number: item.duty_number ?? item.order_number ?? 1,
            duty_title: titleText,
            title: titleText,
            duty_description: item.duty_description || item.description || '',
            description: item.duty_description || item.description || '',
            is_active: newStatus
        });
        showToast(`Butir tugas waka berhasil di${newStatus === 1 ? 'aktifkan' : 'nonaktifkan'}`);
        await loadWakaDuties(true);
        renderManagerWakaDutiesSection();

        const curCatId = el('plan-input-catalog')?.value;
        if (isWakaCatalogId(curCatId) && getWakaTypeFromCatalogId(curCatId) === item.waka_type) {
            renderPlanWakaDutyDropdown(item.waka_type);
        }
        const curLogCatId = el('log-input-catalog')?.value;
        if (isWakaCatalogId(curLogCatId) && getWakaTypeFromCatalogId(curLogCatId) === item.waka_type) {
            renderLogWakaDutyDropdown(item.waka_type);
        }
    } catch (err) {
        showToast(err.message || 'Gagal mengubah status butir tugas', 'error');
    }
}

export async function deleteWakaDutyItem(dutyId) {
    const item = (_wakaDutiesCache || []).find(d => d.id === dutyId);
    if (!item) return;

    const titleText = item.duty_title || item.title || '';
    const ok = await askConfirm(
        `Apakah Anda yakin ingin menghapus permanen butir tugas "${titleText}"? Tindakan ini tidak dapat dibatalkan.`,
        'Hapus Butir Tugas Waka',
        'danger',
        { confirmText: 'Ya, Hapus Permanen' }
    );
    if (!ok) return;

    try {
        await cfDeleteWakaDutyItem(dutyId);
        showToast('Butir tugas waka berhasil dihapus');
        await loadWakaDuties(true);
        renderManagerWakaDutiesSection();

        const curCatId = el('plan-input-catalog')?.value;
        if (isWakaCatalogId(curCatId) && getWakaTypeFromCatalogId(curCatId) === item.waka_type) {
            renderPlanWakaDutyDropdown(item.waka_type);
        }
        const curLogCatId = el('log-input-catalog')?.value;
        if (isWakaCatalogId(curLogCatId) && getWakaTypeFromCatalogId(curLogCatId) === item.waka_type) {
            renderLogWakaDutyDropdown(item.waka_type);
        }
    } catch (err) {
        showToast(err.message || 'Gagal menghapus butir tugas', 'error');
    }
}

// ========== SEARCHABLE COMBOBOX BUTIR TUGAS WAKA DI FORM RENCANA ==========
export async function renderPlanWakaDutyDropdown(wakaType) {
    if (!_wakaDutiesCache) {
        await loadWakaDuties();
    }
    const items = (_wakaDutiesCache || [])
        .filter(d => (d.waka_type || '').toLowerCase() === (wakaType || '').toLowerCase() && d.is_active !== 0)
        .sort((a, b) => (Number(a.duty_number ?? a.order_number) || 0) - (Number(b.duty_number ?? b.order_number) || 0));

    const badgeEl = el('plan-waka-duty-count-badge');
    if (badgeEl) {
        badgeEl.textContent = `${items.length} Butir Tugas`;
    }

    renderPlanWakaDutyCustomOptions(items);
}

export function renderPlanWakaDutyCustomOptions(items) {
    const container = el('list-plan-waka-duty-options');
    if (!container) return;

    if (!items || items.length === 0) {
        container.innerHTML = '<div class="p-4 text-center text-slate-400 text-xs">Tidak ada butir tugas waka yang cocok.</div>';
        return;
    }

    let html = '';
    items.forEach(it => {
        const num = it.duty_number ?? it.order_number ?? '-';
        const titleText = it.duty_title || it.title || '';
        const descText = it.duty_description || it.description || '';
        const titleSafe = escapeHTML(titleText);
        const descSafe = descText ? `<div class="text-[11px] text-slate-400 mt-0.5 leading-tight">${escapeHTML(descText)}</div>` : '';
        const titleAttr = titleText.replace(/'/g, "\\'").replace(/"/g, '&quot;');
        html += `<div onclick="window.workloadSelectWakaDuty('${titleAttr}')"
            class="p-2.5 hover:bg-indigo-50 dark:hover:bg-slate-700/80 cursor-pointer flex items-start gap-2.5 transition-colors border-b border-slate-100 dark:border-slate-700/50 last:border-b-0">
            <span class="w-6 h-6 rounded-lg bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 font-bold text-xs flex items-center justify-center shrink-0">
                ${num}
            </span>
            <div class="min-w-0 flex-1">
                <div class="font-medium text-slate-800 dark:text-white leading-snug">${titleSafe}</div>
                ${descSafe}
            </div>
        </div>`;
    });

    container.innerHTML = html;
}

export function onFilterWakaDuties(autoOpen = true) {
    const searchInput = el('plan-input-waka-duty-search');
    const q = (searchInput?.value || '').toLowerCase().trim();

    const catSelect = el('plan-input-catalog');
    const catId = catSelect?.value;
    const wakaType = getWakaTypeFromCatalogId(catId);

    const items = (_wakaDutiesCache || [])
        .filter(d => (d.waka_type || '').toLowerCase() === (wakaType || '').toLowerCase() && d.is_active !== 0)
        .sort((a, b) => (Number(a.duty_number ?? a.order_number) || 0) - (Number(b.duty_number ?? b.order_number) || 0));

    const filtered = q
        ? items.filter(it => {
            const num = String(it.duty_number ?? it.order_number ?? '');
            const title = (it.duty_title || it.title || '').toLowerCase();
            const desc = (it.duty_description || it.description || '').toLowerCase();
            return title.includes(q) || desc.includes(q) || num.includes(q);
        })
        : items;

    if (autoOpen) {
        openWakaDutyDropdown();
    }
    if (searchInput) {
        autoResizeWorkloadTextarea(searchInput);
    }
    renderPlanWakaDutyCustomOptions(filtered);
}

export function toggleWakaDutyDropdown(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    const panel = el('dropdown-plan-waka-duty-panel');
    if (!panel) return;

    closePlanCatalogDropdown();
    closeLogCatalogDropdown();
    const isClosed = panel.classList.contains('hidden');
    if (isClosed) {
        openWakaDutyDropdown();
        onFilterWakaDuties(true);
        const searchInput = el('plan-input-waka-duty-search');
        if (searchInput) {
            searchInput.focus();
            searchInput.select();
        }
    } else {
        closeWakaDutyDropdown();
    }
}

export function openWakaDutyDropdown() {
    const panel = el('dropdown-plan-waka-duty-panel');
    const chevron = el('icon-plan-waka-duty-chevron');
    if (panel) panel.classList.remove('hidden');
    if (chevron) chevron.classList.add('rotate-180');
}

export function closeWakaDutyDropdown() {
    const panel = el('dropdown-plan-waka-duty-panel');
    const chevron = el('icon-plan-waka-duty-chevron');
    if (panel) panel.classList.add('hidden');
    if (chevron) chevron.classList.remove('rotate-180');
}

export async function selectWakaDuty(titleText) {
    const titleInput = el('plan-input-title');
    const searchInput = el('plan-input-waka-duty-search');
    const existingVal = titleInput?.value?.trim() || '';
    if (existingVal && existingVal !== titleText) {
        const ok = await askConfirm(
            `Kolom uraian kegiatan sudah berisi teks:\n"${existingVal}"\n\nApakah Anda yakin ingin menggantinya dengan butir tugas waka:\n"${titleText}"?`,
            'Ganti Uraian Kegiatan?',
            'warning',
            { confirmText: 'Ya, Ganti Uraian', cancelText: 'Batal' }
        );
        if (!ok) return;
    }
    if (titleInput) {
        titleInput.value = titleText;
        titleInput.classList.add('ring-2', 'ring-indigo-500/50');
        setTimeout(() => titleInput.classList.remove('ring-2', 'ring-indigo-500/50'), 1500);
    }
    if (searchInput) {
        searchInput.value = titleText;
        autoResizeWorkloadTextarea(searchInput);
    }
    closeWakaDutyDropdown();

    const descInput = el('plan-input-desc');
    if (descInput && !descInput.value.trim()) {
        descInput.focus();
    }
}

// ========== SEARCHABLE COMBOBOX BUTIR TUGAS WAKA DI FORM REALISASI ==========
export async function renderLogWakaDutyDropdown(wakaType) {
    if (!_wakaDutiesCache) {
        await loadWakaDuties();
    }
    const items = (_wakaDutiesCache || [])
        .filter(d => (d.waka_type || '').toLowerCase() === (wakaType || '').toLowerCase() && d.is_active !== 0)
        .sort((a, b) => (Number(a.duty_number ?? a.order_number) || 0) - (Number(b.duty_number ?? b.order_number) || 0));

    const badgeEl = el('log-waka-duty-count-badge');
    if (badgeEl) {
        badgeEl.textContent = `${items.length} Butir Tugas`;
    }

    renderLogWakaDutyCustomOptions(items);
}

export function renderLogWakaDutyCustomOptions(items) {
    const container = el('list-log-waka-duty-options');
    if (!container) return;

    if (!items || items.length === 0) {
        container.innerHTML = '<div class="p-4 text-center text-slate-400 text-xs">Tidak ada butir tugas waka yang cocok.</div>';
        return;
    }

    let html = '';
    items.forEach(it => {
        const num = it.duty_number ?? it.order_number ?? '-';
        const titleText = it.duty_title || it.title || '';
        const descText = it.duty_description || it.description || '';
        const titleSafe = escapeHTML(titleText);
        const descSafe = descText ? `<div class="text-[11px] text-slate-400 mt-0.5 leading-tight">${escapeHTML(descText)}</div>` : '';
        const titleAttr = titleText.replace(/'/g, "\\'").replace(/"/g, '&quot;');
        html += `<div onclick="window.workloadSelectLogWakaDuty('${titleAttr}')"
            class="p-2.5 hover:bg-indigo-50 dark:hover:bg-slate-700/80 cursor-pointer flex items-start gap-2.5 transition-colors border-b border-slate-100 dark:border-slate-700/50 last:border-b-0">
            <span class="w-6 h-6 rounded-lg bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 font-bold text-xs flex items-center justify-center shrink-0">
                ${num}
            </span>
            <div class="min-w-0 flex-1">
                <div class="font-medium text-slate-800 dark:text-white leading-snug">${titleSafe}</div>
                ${descSafe}
            </div>
        </div>`;
    });

    container.innerHTML = html;
}

export function onFilterLogWakaDuties(autoOpen = true) {
    const searchInput = el('log-input-waka-duty-search');
    const q = (searchInput?.value || '').toLowerCase().trim();

    const catSelect = el('log-input-catalog');
    const catId = catSelect?.value;
    const wakaType = getWakaTypeFromCatalogId(catId);

    const items = (_wakaDutiesCache || [])
        .filter(d => (d.waka_type || '').toLowerCase() === (wakaType || '').toLowerCase() && d.is_active !== 0)
        .sort((a, b) => (Number(a.duty_number ?? a.order_number) || 0) - (Number(b.duty_number ?? b.order_number) || 0));

    const filtered = q
        ? items.filter(it => {
            const num = String(it.duty_number ?? it.order_number ?? '');
            const title = (it.duty_title || it.title || '').toLowerCase();
            const desc = (it.duty_description || it.description || '').toLowerCase();
            return title.includes(q) || desc.includes(q) || num.includes(q);
        })
        : items;

    if (autoOpen) {
        openLogWakaDutyDropdown();
    }
    if (searchInput) {
        autoResizeWorkloadTextarea(searchInput);
    }
    renderLogWakaDutyCustomOptions(filtered);
}

export function toggleLogWakaDutyDropdown(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    const panel = el('dropdown-log-waka-duty-panel');
    if (!panel) return;

    closePlanCatalogDropdown();
    closeLogCatalogDropdown();
    closeWakaDutyDropdown();
    const isClosed = panel.classList.contains('hidden');
    if (isClosed) {
        openLogWakaDutyDropdown();
        onFilterLogWakaDuties(true);
        const searchInput = el('log-input-waka-duty-search');
        if (searchInput) {
            searchInput.focus();
            searchInput.select();
        }
    } else {
        closeLogWakaDutyDropdown();
    }
}

export function openLogWakaDutyDropdown() {
    const panel = el('dropdown-log-waka-duty-panel');
    const chevron = el('icon-log-waka-duty-chevron');
    if (panel) panel.classList.remove('hidden');
    if (chevron) chevron.classList.add('rotate-180');
}

export function closeLogWakaDutyDropdown() {
    const panel = el('dropdown-log-waka-duty-panel');
    const chevron = el('icon-log-waka-duty-chevron');
    if (panel) panel.classList.add('hidden');
    if (chevron) chevron.classList.remove('rotate-180');
}

export async function selectLogWakaDuty(titleText) {
    const status = el('log-input-status-execution')?.value;
    const isSubstitute = status === 'diganti';
    const targetInput = isSubstitute ? el('log-input-substitute') : el('log-input-title');
    const searchInput = el('log-input-waka-duty-search');

    const existingVal = targetInput?.value?.trim() || '';
    if (existingVal && existingVal !== titleText) {
        const ok = await askConfirm(
            `Kolom uraian ${isSubstitute ? 'kegiatan pengganti' : 'pekerjaan'} sudah berisi teks:\n"${existingVal}"\n\nApakah Anda yakin ingin menggantinya dengan butir tugas waka:\n"${titleText}"?`,
            'Ganti Uraian Kegiatan?',
            'warning',
            { confirmText: 'Ya, Ganti Uraian', cancelText: 'Batal' }
        );
        if (!ok) return;
    }

    if (targetInput) {
        targetInput.value = titleText;
        targetInput.classList.add('ring-2', 'ring-indigo-500/50');
        setTimeout(() => targetInput.classList.remove('ring-2', 'ring-indigo-500/50'), 1500);
    }
    if (isSubstitute && el('log-input-title')) {
        el('log-input-title').value = titleText;
    }
    if (searchInput) {
        searchInput.value = titleText;
        autoResizeWorkloadTextarea(searchInput);
    }
    closeLogWakaDutyDropdown();

    const outputInput = el('log-input-output');
    if (outputInput && !outputInput.value.trim()) {
        outputInput.focus();
    }
}

// ========== MODAL: PLAN ITEM (PERMENDIKDASMEN NO. 11/2025) ==========
function addMinutesToTime(timeStr, minutesToAdd) {
    if (!timeStr || !timeStr.includes(':')) return '';
    const [h, m] = timeStr.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return '';
    const total = h * 60 + m + Number(minutesToAdd || 0);
    const newH = Math.floor(total / 60) % 24;
    const newM = total % 60;
    return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

/// ========== HELPER HBG (HARI BELAJAR GURU - SE NO. 5684/2025) ==========
export function isCatalogItemHbg(catItem) {
    if (!catItem) return false;
    const catId = catItem.id || '';
    const dutyCode = catItem.category_code || '';
    const name = (catItem.name || '').toLowerCase();

    // 1. Tugas Pokok PERENCANAAN
    if (dutyCode === 'PERENCANAAN') return true;

    // 2. Katalog resmi PKB / MGMP / Kombel
    const HBG_CATALOG_IDS = [
        'cat_mgmp',
        'cat_tt_koor_pkb',
        'cat_tt_peserta_pelatihan',
        'cat_tt_narasumber',
        'cat_tt_koor_p5',
        'cat_tt_organisasi_profesi',
        'cat_rencana_kurikulum',
        'cat_rencana_modul',
        'cat_evaluasi'
    ];
    if (HBG_CATALOG_IDS.includes(catId)) return true;

    // 3. Tugas Pokok TUGAS_TAMBAHAN yang relevan
    if (dutyCode === 'TUGAS_TAMBAHAN' && (
        catId.startsWith('cat_tt_koor_pkb') ||
        catId.startsWith('cat_tt_peserta') ||
        catId.startsWith('cat_tt_narasumber') ||
        catId.startsWith('cat_tt_organisasi') ||
        catId.startsWith('cat_tt_koor_p5') ||
        catId === 'cat_mgmp'
    )) return true;

    // 4. Kata kunci nama kegiatan
    const keywords = ['mgmp', 'komunitas belajar', 'kombel', 'pkb', 'pmm', 'pelatihan', 'diseminasi', 'workshop', 'webinar', 'bimtek'];
    return keywords.some(kw => name.includes(kw));
}

/**
 * Memeriksa apakah suatu segmen, aktivitas, atau catatan log merupakan bagian dari ranah Hari Belajar Guru (HBG)
 * (SE Mendikdasmen No. 5684/2025: Perencanaan Pembelajaran, Modul Ajar, Perangkat Ajar, ATP, PKB, MGMP, dsb.)
 * Menolak tegas aktivitas mengajar (KBM) dan hari libur sekolah.
 * @param {Object} seg
 * @returns {boolean}
 */
export function isActivityHbg(seg) {
    if (!seg) return false;
    // KBM dan libur tidak termasuk ranah HBG
    if (seg.is_teaching === 1 || seg.is_teaching === true || seg.catalog_id === 'cat_kbm' || seg.category_code === 'PELAKSANAAN_KBM' || seg.is_holiday || seg.catalog_id === 'cat_libur') {
        return false;
    }

    if (typeof isStudyDayCompliantActivity === 'function' && isStudyDayCompliantActivity(seg)) {
        return true;
    }

    // Fallback dari _weekData.activities jika seg adalah segment
    if (seg.activity_id && _weekData?.activities) {
        const act = _weekData.activities.find(a => a.id === seg.activity_id);
        if (act) {
            if (act.is_teaching === 1 || act.is_teaching === true || act.catalog_id === 'cat_kbm' || act.category_code === 'PELAKSANAAN_KBM') {
                return false;
            }
            if (typeof isStudyDayCompliantActivity === 'function' && isStudyDayCompliantActivity(act)) {
                return true;
            }
        }
    }

    // Fallback dari katalog D1
    const catId = seg.catalog_id || '';
    if (catId && _catalog) {
        const cat = _catalog.find(c => c.id === catId);
        if (cat && isCatalogItemHbg(cat)) {
            return true;
        }
    }

    // Fallback Tugas Pokok Perencanaan
    const duty = seg.category_code || '';
    if (duty === 'PERENCANAAN') return true;

    // Fallback kata kunci pada judul / uraian
    const title = (seg.title || seg.activity_title || seg.description || '').toLowerCase();
    const keywords = ['mgmp', 'komunitas belajar', 'kombel', 'pkb', 'pmm', 'pelatihan', 'diseminasi', 'workshop', 'webinar', 'bimtek', 'modul ajar', 'perangkat ajar', 'perencanaan', 'atp', 'alur tujuan pembelajaran'];
    return keywords.some(kw => title.includes(kw));
}

/**
 * Merender badge penanda toga HBG (Hari Belajar Guru)
 * @param {Object} seg - Objek segmen / kegiatan
 * @param {'xs'|'sm'} size - 'xs' untuk timeline gantt, 'sm' untuk kartu aktivitas
 * @returns {string} HTML string badge
 */
export function renderHbgBadge(seg, size = 'sm') {
    if (!isActivityHbg(seg)) return '';
    if (size === 'xs') {
        return `<span class="text-[7px] px-1 py-0.2 rounded bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/60 font-bold flex items-center gap-0.5 shrink-0" title="Kegiatan Ranah Hari Belajar Guru (HBG - SE Mendikdasmen No. 5684/2025)"><i class="fa-solid fa-graduation-cap text-[6.5px]"></i><span>HBG</span></span>`;
    }
    return `<span class="ml-1 text-[9px] px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/60 font-bold inline-flex items-center gap-1 shrink-0" title="Kegiatan Ranah Hari Belajar Guru (HBG - SE Mendikdasmen No. 5684/2025)"><i class="fa-solid fa-graduation-cap text-[8px]"></i><span>HBG</span></span>`;
}

// ========== FILTER KATALOG BERDASARKAN TUGAS POKOK ==========
export function getFilteredCatalogByDuty(dutyCode, searchQuery = '') {
    const baseCatalog = (_catalog && _catalog.length > 0) ? _catalog : STANDARD_WORKLOAD_CATALOG;
    let filtered = baseCatalog.filter(c => c.is_active !== 0 && c.category_code === dutyCode);

    // Fallback jika database D1 belum selesai memuat atau variasi ID
    if (filtered.length === 0) {
        if (dutyCode === 'PELAKSANAAN_KBM') {
            filtered = baseCatalog.filter(c => c.is_active !== 0 && (c.is_teaching || (c.id && c.id.startsWith('cat_kbm')) || c.id === 'cat_bk'));
        } else if (dutyCode === 'PEMBIMBINGAN') {
            filtered = baseCatalog.filter(c => c.is_active !== 0 && ((c.id && c.id.startsWith('cat_bimbing')) || ['cat_bk', 'cat_ekstra'].includes(c.id)));
        } else if (dutyCode === 'PERENCANAAN') {
            filtered = baseCatalog.filter(c => c.is_active !== 0 && ((c.id && c.id.startsWith('cat_rencana')) || ['cat_evaluasi', 'cat_mgmp'].includes(c.id)));
        } else if (dutyCode === 'PENILAIAN') {
            filtered = baseCatalog.filter(c => c.is_active !== 0 && ((c.id && c.id.startsWith('cat_nilai')) || ['cat_administrasi'].includes(c.id)));
        } else if (dutyCode === 'TUGAS_TAMBAHAN') {
            filtered = baseCatalog.filter(c => c.is_active !== 0 && ((c.id && c.id.startsWith('cat_tt')) || ['cat_wali_kelas', 'cat_pembina_osis', 'cat_piket', 'cat_upacara', 'cat_mgmp'].includes(c.id)));
        }
    }

    if (filtered.length === 0) {
        filtered = baseCatalog.filter(c => c.is_active !== 0);
    }

    const q = (searchQuery || '').trim().toLowerCase();
    if (q) {
        filtered = filtered.filter(c =>
            (c.name && c.name.toLowerCase().includes(q)) ||
            (c.description && c.description.toLowerCase().includes(q))
        );
    }

    return filtered;
}

// ========== CUSTOM DROPDOWN TUGAS POKOK GURU (PERMENDIKDASMEN NO. 11/2025) ==========
export const MAIN_DUTIES_CUSTOM_OPTIONS = [
    {
        code: 'PERENCANAAN',
        label: '1. Merencanakan Pembelajaran atau Pembimbingan',
        icon: 'fa-book-open',
        colorClass: 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/60',
        hbg: true,
        hbgText: 'Ranah HBG'
    },
    {
        code: 'PELAKSANAAN_KBM',
        label: '2. Melaksanakan Pembelajaran atau Pembimbingan',
        icon: 'fa-chalkboard-user',
        colorClass: 'text-indigo-600 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-950/60',
        hbg: false
    },
    {
        code: 'PENILAIAN',
        label: '3. Menilai Hasil Pembelajaran atau Pembimbingan',
        icon: 'fa-clipboard-check',
        colorClass: 'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-950/60',
        hbg: false
    },
    {
        code: 'PEMBIMBINGAN',
        label: '4. Membimbing dan Melatih Murid',
        icon: 'fa-user-graduate',
        colorClass: 'text-cyan-600 dark:text-cyan-400 bg-cyan-100 dark:bg-cyan-950/60',
        hbg: false
    },
    {
        code: 'TUGAS_TAMBAHAN',
        label: '5. Melaksanakan Tugas Tambahan yang Melekat',
        icon: 'fa-briefcase',
        colorClass: 'text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-950/60',
        hbg: true,
        hbgText: 'Ranah HBG - PKB/MGMP'
    }
];

export function resolveWorkloadDutyCode(seg, act, catalog = [], standardCatalog = [], isStudyDay = false) {
    const VALID_CODES = new Set(['PERENCANAAN', 'PELAKSANAAN_KBM', 'PENILAIAN', 'PEMBIMBINGAN', 'TUGAS_TAMBAHAN']);

    // 1. Prioritas Utama (SSOT): Identifikasi dari katalog kegiatan resmi
    const catId = seg?.catalog_id || act?.catalog_id;
    if (catId) {
        const catItem = (catalog || []).find(c => c && c.id === catId) || (standardCatalog || []).find(c => c && c.id === catId);
        if (catItem && VALID_CODES.has(catItem.category_code)) {
            return catItem.category_code;
        }
    }

    // 2. Prioritas Kedua: category_code tersimpan pada segmen atau aktivitas jika valid (abaikan nilai non-standar/legacy seperti 'A')
    const segCode = seg?.category_code;
    if (segCode && VALID_CODES.has(segCode)) {
        return segCode;
    }
    const actCode = act?.category_code;
    if (actCode && VALID_CODES.has(actCode)) {
        return actCode;
    }

    // 3. Fallback berdasarkan karakteristik pembelajaran / HBG
    const isTeaching = seg?.is_teaching === 1 || seg?.is_teaching === true || act?.is_teaching === 1 || act?.is_teaching === true || catId === 'cat_kbm';
    if (isTeaching) {
        return 'PELAKSANAAN_KBM';
    }
    return isStudyDay ? 'PERENCANAAN' : 'PELAKSANAAN_KBM';
}

export function renderPlanMainDutyDropdown(isStudyDay = false) {
    const selectEl = el('plan-input-main-duty');
    const currentVal = selectEl?.value || 'PELAKSANAAN_KBM';
    renderPlanMainDutyCustomSelector(currentVal, isStudyDay);
}

export function togglePlanMainDutyDropdown(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    const panel = el('dropdown-plan-main-duty-panel');
    if (!panel) return;

    if (typeof closePlanCatalogDropdown === 'function') closePlanCatalogDropdown();
    if (typeof closeWakaDutyDropdown === 'function') closeWakaDutyDropdown();
    const isClosed = panel.classList.contains('hidden');
    if (isClosed) {
        openPlanMainDutyDropdown();
    } else {
        closePlanMainDutyDropdown();
    }
}

export function openPlanMainDutyDropdown() {
    const panel = el('dropdown-plan-main-duty-panel');
    const chevron = el('icon-plan-main-duty-chevron');
    if (panel) panel.classList.remove('hidden');
    if (chevron) chevron.classList.add('rotate-180');
}

export function closePlanMainDutyDropdown() {
    const panel = el('dropdown-plan-main-duty-panel');
    const chevron = el('icon-plan-main-duty-chevron');
    if (panel) panel.classList.add('hidden');
    if (chevron) chevron.classList.remove('rotate-180');
}

export function selectPlanMainDuty(dutyCode) {
    const selectEl = el('plan-input-main-duty');
    if (selectEl) {
        selectEl.value = dutyCode;
    }
    const dayIdx = parseInt(el('plan-input-day')?.value, 10);
    const isStudyDay = !isNaN(dayIdx) && dayIdx === _studyDayIndex;
    renderPlanMainDutyCustomSelector(dutyCode, isStudyDay);
    closePlanMainDutyDropdown();
    onMainDutyChange();
}

export function renderLogMainDutyDropdown(isStudyDay = false) {
    const selectEl = el('log-input-main-duty');
    const currentVal = selectEl?.value || 'PELAKSANAAN_KBM';
    const logDate = el('log-input-date')?.value;
    let currentDayIdx = _selectedDayIndex;
    if (logDate && _weekStartDate) {
        const diff = Math.round((new Date(logDate + 'T00:00:00') - new Date(_weekStartDate + 'T00:00:00')) / (86400 * 1000));
        if (!isNaN(diff) && diff >= 0 && diff < 7) currentDayIdx = diff;
    }
    const isCurrentStudyDay = isStudyDay || (!isNaN(currentDayIdx) && currentDayIdx === _studyDayIndex);
    renderLogMainDutyCustomSelector(currentVal, isCurrentStudyDay);
}

export function toggleLogMainDutyDropdown(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    const panel = el('dropdown-log-main-duty-panel');
    if (!panel) return;

    if (typeof closeLogCatalogDropdown === 'function') closeLogCatalogDropdown();
    if (typeof closeLogWakaDutyDropdown === 'function') closeLogWakaDutyDropdown();
    const isClosed = panel.classList.contains('hidden');
    if (isClosed) {
        openLogMainDutyDropdown();
    } else {
        closeLogMainDutyDropdown();
    }
}

export function openLogMainDutyDropdown() {
    const panel = el('dropdown-log-main-duty-panel');
    const chevron = el('icon-log-main-duty-chevron');
    if (panel) panel.classList.remove('hidden');
    if (chevron) chevron.classList.add('rotate-180');
}

export function closeLogMainDutyDropdown() {
    const panel = el('dropdown-log-main-duty-panel');
    const chevron = el('icon-log-main-duty-chevron');
    if (panel) panel.classList.add('hidden');
    if (chevron) chevron.classList.remove('rotate-180');
}

export function selectLogMainDuty(dutyCode) {
    const selectEl = el('log-input-main-duty');
    if (selectEl) {
        selectEl.value = dutyCode;
    }
    const logDate = el('log-input-date')?.value;
    let currentDayIdx = _selectedDayIndex;
    if (logDate && _weekStartDate) {
        const diff = Math.round((new Date(logDate + 'T00:00:00') - new Date(_weekStartDate + 'T00:00:00')) / (86400 * 1000));
        if (!isNaN(diff) && diff >= 0 && diff < 7) currentDayIdx = diff;
    }
    const isCurrentStudyDay = !isNaN(currentDayIdx) && currentDayIdx === _studyDayIndex;
    renderLogMainDutyCustomSelector(dutyCode, isCurrentStudyDay);
    closeLogMainDutyDropdown();
    onLogMainDutyChange();
}

// ========== UTILITAS: AUTO-RESIZE WORKLOAD TEXTAREA (ANTI-TRUNCATION) ==========
export function autoResizeWorkloadTextarea(target) {
    if (!target) return;
    target.style.height = 'auto';
    const newHeight = Math.max(42, target.scrollHeight);
    target.style.height = `${newHeight}px`;
}

// ========== CUSTOM RICH SELECTOR: TUGAS POKOK GURU (PERMENDIKDASMEN NO. 11/2025) ==========
export const WORKLOAD_MAIN_DUTY_CONFIG = {
    'PERENCANAAN': {
        code: 'PERENCANAAN',
        num: '1',
        title: '1. Merencanakan Pembelajaran atau Pembimbingan',
        hbgTitle: '1. Merencanakan Pembelajaran atau Pembimbingan ✨ [Ranah HBG]',
        icon: 'fa-compass-drafting',
        badgeBg: 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
    },
    'PELAKSANAAN_KBM': {
        code: 'PELAKSANAAN_KBM',
        num: '2',
        title: '2. Melaksanakan Pembelajaran atau Pembimbingan',
        hbgTitle: '2. Melaksanakan Pembelajaran atau Pembimbingan',
        icon: 'fa-chalkboard-user',
        badgeBg: 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
    },
    'PENILAIAN': {
        code: 'PENILAIAN',
        num: '3',
        title: '3. Menilai Hasil Pembelajaran atau Pembimbingan',
        hbgTitle: '3. Menilai Hasil Pembelajaran atau Pembimbingan',
        icon: 'fa-chart-simple',
        badgeBg: 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
    },
    'PEMBIMBINGAN': {
        code: 'PEMBIMBINGAN',
        num: '4',
        title: '4. Membimbing dan Melatih Murid',
        hbgTitle: '4. Membimbing dan Melatih Murid',
        icon: 'fa-user-graduate',
        badgeBg: 'bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300'
    },
    'TUGAS_TAMBAHAN': {
        code: 'TUGAS_TAMBAHAN',
        num: '5',
        title: '5. Melaksanakan Tugas Tambahan yang Melekat',
        hbgTitle: '5. Melaksanakan Tugas Tambahan yang Melekat ✨ [Ranah HBG - PKB/MGMP]',
        icon: 'fa-briefcase',
        badgeBg: 'bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
    }
};

export function renderPlanMainDutyCustomSelector(currentValue = 'PELAKSANAAN_KBM', isStudyDay = false) {
    const triggerLabel = el('label-plan-main-duty-selected');
    const triggerBadge = el('icon-plan-main-duty-badge');
    const listEl = el('list-plan-main-duty-options');
    const cfg = WORKLOAD_MAIN_DUTY_CONFIG[currentValue] || WORKLOAD_MAIN_DUTY_CONFIG['PELAKSANAAN_KBM'];

    if (triggerLabel) {
        triggerLabel.textContent = isStudyDay ? (cfg.hbgTitle || cfg.title) : cfg.title;
    }
    if (triggerBadge) {
        triggerBadge.className = `w-6 h-6 rounded-lg ${cfg.badgeBg} flex items-center justify-center shrink-0 text-xs`;
        triggerBadge.innerHTML = `<i class="fa-solid ${cfg.icon}"></i>`;
    }

    if (listEl) {
        listEl.innerHTML = Object.values(WORKLOAD_MAIN_DUTY_CONFIG).map(item => {
            const isSelected = item.code === currentValue;
            const title = isStudyDay ? (item.hbgTitle || item.title) : item.title;
            const bgCls = isSelected
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 font-bold border-l-4 border-emerald-500'
                : 'hover:bg-slate-100 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200';
            return `
            <div onclick="window.workloadSelectPlanMainDuty('${item.code}')" class="p-3 cursor-pointer transition-all flex items-start gap-2.5 ${bgCls}">
                <span class="w-6 h-6 rounded-lg ${item.badgeBg} flex items-center justify-center shrink-0 text-xs mt-0.5">
                    <i class="fa-solid ${item.icon}"></i>
                </span>
                <div class="min-w-0 flex-1 font-medium text-xs leading-snug break-words">
                    ${escapeHTML(title)}
                </div>
                ${isSelected ? '<i class="fa-solid fa-check text-emerald-600 dark:text-emerald-400 text-xs mt-1 shrink-0"></i>' : ''}
            </div>`;
        }).join('');
    }
}

export function renderLogMainDutyCustomSelector(currentValue = 'PELAKSANAAN_KBM', isStudyDay = false) {
    const triggerLabel = el('label-log-main-duty-selected');
    const triggerBadge = el('icon-log-main-duty-badge');
    const listEl = el('list-log-main-duty-options');
    const cfg = WORKLOAD_MAIN_DUTY_CONFIG[currentValue] || WORKLOAD_MAIN_DUTY_CONFIG['PELAKSANAAN_KBM'];

    if (triggerLabel) {
        triggerLabel.textContent = isStudyDay ? (cfg.hbgTitle || cfg.title) : cfg.title;
    }
    if (triggerBadge) {
        triggerBadge.className = `w-6 h-6 rounded-lg ${cfg.badgeBg} flex items-center justify-center shrink-0 text-xs`;
        triggerBadge.innerHTML = `<i class="fa-solid ${cfg.icon}"></i>`;
    }

    if (listEl) {
        listEl.innerHTML = Object.values(WORKLOAD_MAIN_DUTY_CONFIG).map(item => {
            const isSelected = item.code === currentValue;
            const title = isStudyDay ? (item.hbgTitle || item.title) : item.title;
            const bgCls = isSelected
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 font-bold border-l-4 border-emerald-500'
                : 'hover:bg-slate-100 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200';
            return `
            <div onclick="window.workloadSelectLogMainDuty('${item.code}')" class="p-3 cursor-pointer transition-all flex items-start gap-2.5 ${bgCls}">
                <span class="w-6 h-6 rounded-lg ${item.badgeBg} flex items-center justify-center shrink-0 text-xs mt-0.5">
                    <i class="fa-solid ${item.icon}"></i>
                </span>
                <div class="min-w-0 flex-1 font-medium text-xs leading-snug break-words">
                    ${escapeHTML(title)}
                </div>
                ${isSelected ? '<i class="fa-solid fa-check text-emerald-600 dark:text-emerald-400 text-xs mt-1 shrink-0"></i>' : ''}
            </div>`;
        }).join('');
    }
}

export function closeAllWorkloadDropdowns() {
    closePlanMainDutyDropdown();
    closeLogMainDutyDropdown();
    closePlanCatalogDropdown();
    closeLogCatalogDropdown();
    if (typeof closeWakaDutyDropdown === 'function') closeWakaDutyDropdown();
    if (typeof closeLogWakaDutyDropdown === 'function') closeLogWakaDutyDropdown();
}

// ========== CUSTOM SEARCHABLE COMBOBOX: PLAN CATALOG ==========
export function renderPlanCatalogCustomOptions(items = [], selectedId = null) {
    const listEl = el('list-plan-catalog-options');
    const jpBadgeEl = el('plan-catalog-selected-jp-badge');

    const selectedItem = items.find(c => c.id === selectedId) || (_catalog || []).find(c => c.id === selectedId) || STANDARD_WORKLOAD_CATALOG.find(c => c.id === selectedId) || null;
    if (jpBadgeEl) {
        const jp = selectedItem ? getCatalogItemEquivalentJp(selectedItem) : 0;
        jpBadgeEl.textContent = jp > 0 ? `(${jp} JP)` : '';
    }

    if (!listEl) return;

    if (!items || items.length === 0) {
        listEl.innerHTML = `
            <div class="p-3 text-center text-slate-400 text-xs flex flex-col items-center gap-1.5">
                <span>Tidak ada sub-kegiatan yang cocok</span>
                <button type="button" onclick="window.workloadResetPlanCatalogSearch()" class="px-2.5 py-1 text-[11px] rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-800 dark:bg-emerald-950 dark:hover:bg-emerald-900 dark:text-emerald-300 font-bold transition-colors cursor-pointer">
                    <i class="fa-solid fa-rotate-left mr-1"></i>Tampilkan Semua Sub-Kegiatan
                </button>
            </div>`;
        return;
    }

    const currentDayIdx = parseInt(el('plan-input-day')?.value, 10);
    const isCurrentStudyDay = !isNaN(currentDayIdx) && currentDayIdx === _studyDayIndex;

    listEl.innerHTML = items.map(c => {
        const isSelected = c.id === (selectedItem ? selectedItem.id : null);
        const jp = getCatalogItemEquivalentJp(c);
        const jpBadge = jp > 0
            ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 shrink-0 border border-emerald-200 dark:border-emerald-800/60">${jp} JP</span>`
            : '';
        const isHbg = isCurrentStudyDay && isCatalogItemHbg(c);
        const hbgBadge = isHbg
            ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 shrink-0 border border-purple-200 dark:border-purple-800/60 flex items-center gap-1" title="Ranah Hari Belajar Guru (SE No. 5684/2025)"><i class="fa-solid fa-graduation-cap text-[8px]"></i>HBG</span>`
            : '';
        const bgCls = isSelected
            ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 font-bold border-l-4 border-emerald-500'
            : 'hover:bg-slate-100 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200';

        const badgesRight = (jpBadge || hbgBadge)
            ? `<div class="flex flex-col items-end gap-1 shrink-0 mt-0.5">${jpBadge}${hbgBadge}</div>`
            : '';
        const cleanDesc = (c.description || '').replace(/\s*\([Ee]kuivalensi[^)]*\)/g, '').trim();

        return `
        <div onclick="window.workloadSelectPlanCatalog('${c.id}')" class="p-3 cursor-pointer transition-all flex items-start justify-between gap-3 ${bgCls}">
            <div class="min-w-0 flex-1">
                <div class="flex items-start gap-2">
                    ${isSelected ? '<i class="fa-solid fa-check text-emerald-600 dark:text-emerald-400 text-xs mt-0.5 shrink-0"></i>' : '<span class="w-3 shrink-0"></span>'}
                    <div class="font-medium text-xs leading-snug text-slate-800 dark:text-white break-words flex-1">
                        ${escapeHTML(c.name)}
                    </div>
                </div>
                ${cleanDesc ? `<div class="text-[11px] text-slate-500 dark:text-slate-400 font-normal mt-1 leading-relaxed pl-5 break-words">${escapeHTML(cleanDesc)}</div>` : ''}
            </div>
            ${badgesRight}
        </div>`;
    }).join('');
}

export function selectPlanCatalog(catalogId) {
    const catSelect = el('plan-input-catalog');
    if (catSelect) {
        catSelect.value = catalogId;
    }
    const catItem = (_catalog || []).find(c => c.id === catalogId) || STANDARD_WORKLOAD_CATALOG.find(c => c.id === catalogId);
    const searchInput = el('plan-input-catalog-search');
    const jpBadgeEl = el('plan-catalog-selected-jp-badge');
    if (searchInput && catItem) {
        searchInput.value = catItem.name;
        autoResizeWorkloadTextarea(searchInput);
    }
    if (jpBadgeEl && catItem) {
        const jp = getCatalogItemEquivalentJp(catItem);
        jpBadgeEl.textContent = jp > 0 ? `(${jp} JP)` : '';
    }

    // Auto-sync Tugas Pokok Guru jika sub-kegiatan yang dipilih berasal dari tugas pokok berbeda
    if (catItem && catItem.category_code && WORKLOAD_MAIN_DUTY_CONFIG[catItem.category_code]) {
        const dutySelect = el('plan-input-main-duty');
        if (dutySelect && dutySelect.value !== catItem.category_code) {
            dutySelect.value = catItem.category_code;
            const dayIdx = parseInt(el('plan-input-day')?.value, 10);
            const isStudyDay = !isNaN(dayIdx) && dayIdx === _studyDayIndex;
            renderPlanMainDutyCustomSelector(catItem.category_code, isStudyDay);
        }
    }

    closePlanCatalogDropdown();
    onCatalogChange(true);
}

export function togglePlanCatalogDropdown(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    const panel = el('dropdown-plan-catalog-panel');
    if (!panel) return;

    closeLogCatalogDropdown();
    closePlanMainDutyDropdown();
    closeLogMainDutyDropdown();
    const isClosed = panel.classList.contains('hidden');
    if (isClosed) {
        openPlanCatalogDropdown();
        onFilterPlanCatalog(true);
        const searchInput = el('plan-input-catalog-search');
        if (searchInput) {
            searchInput.focus();
            searchInput.select();
        }
    } else {
        closePlanCatalogDropdown();
    }
}

export function openPlanCatalogDropdown() {
    const panel = el('dropdown-plan-catalog-panel');
    const chevron = el('icon-plan-catalog-chevron');
    if (panel) panel.classList.remove('hidden');
    if (chevron) chevron.classList.add('rotate-180');
}

export function closePlanCatalogDropdown() {
    const panel = el('dropdown-plan-catalog-panel');
    const chevron = el('icon-plan-catalog-chevron');
    if (panel) panel.classList.add('hidden');
    if (chevron) chevron.classList.remove('rotate-180');

    const searchInput = el('plan-input-catalog-search');
    const catSelect = el('plan-input-catalog');
    if (searchInput && catSelect && catSelect.value) {
        const item = (_catalog || []).find(c => c.id === catSelect.value) || STANDARD_WORKLOAD_CATALOG.find(c => c.id === catSelect.value);
        if (item && (!searchInput.value || searchInput.value.trim() !== item.name)) {
            searchInput.value = item.name;
            autoResizeWorkloadTextarea(searchInput);
        }
    } else if (searchInput && (!catSelect || !catSelect.value)) {
        searchInput.value = '';
        autoResizeWorkloadTextarea(searchInput);
    }
}

export function populateCatalogDropdownByDuty(dutyCode, selectedCatalogId = null, searchQuery = '') {
    const catSelect = el('plan-input-catalog');
    const filtered = getFilteredCatalogByDuty(dutyCode, searchQuery);

    if (catSelect) {
        if (filtered.length === 0) {
            catSelect.innerHTML = '<option value="" disabled selected>— Tidak ada sub-kegiatan yang cocok —</option>';
        } else {
            const hasSelected = selectedCatalogId && filtered.some(c => c.id === selectedCatalogId);
            const promptOption = `<option value="" disabled${!hasSelected ? ' selected' : ''}>— Pilih Kategori Kegiatan —</option>`;
            catSelect.innerHTML = promptOption + filtered.map(c => {
                const jpLabel = formatCatalogJpLabel(c);
                const jpVal = getCatalogItemEquivalentJp(c);
                return `<option value="${c.id}" data-teaching="${c.is_teaching ? 1 : 0}" data-duration="${c.default_duration_minutes || 45}" data-jp="${jpVal}">${escapeHTML(c.name)}${jpLabel}</option>`;
            }).join('');

            if (hasSelected) {
                catSelect.value = selectedCatalogId;
            } else {
                catSelect.value = '';
            }
        }
    }

    const curId = catSelect?.value || null;
    const curItem = curId ? ((_catalog || []).find(c => c.id === curId) || STANDARD_WORKLOAD_CATALOG.find(c => c.id === curId)) : null;
    const searchInput = el('plan-input-catalog-search');
    const jpBadgeEl = el('plan-catalog-selected-jp-badge');
    if (searchInput) {
        searchInput.value = curItem ? curItem.name : '';
        autoResizeWorkloadTextarea(searchInput);
    }
    if (jpBadgeEl) {
        const jp = curItem ? getCatalogItemEquivalentJp(curItem) : 0;
        jpBadgeEl.textContent = jp > 0 ? `(${jp} JP)` : '';
    }

    const currentDayIdx = parseInt(el('plan-input-day')?.value, 10);
    const isStudyDay = !isNaN(currentDayIdx) && currentDayIdx === _studyDayIndex;
    renderPlanMainDutyCustomSelector(dutyCode, isStudyDay);
    renderPlanCatalogCustomOptions(filtered, curId);
}

export function onFilterPlanCatalog() {
    const autoOpen = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : true;
    const searchInput = el('plan-input-catalog-search');
    const placeholder = (searchInput?.getAttribute('placeholder') || '').trim().toLowerCase();
    const rawVal = (searchInput?.value || '').trim();
    const q = (placeholder && rawVal.toLowerCase() === placeholder) ? '' : rawVal;

    const dutySelect = el('plan-input-main-duty');
    const selectedDuty = dutySelect?.value || 'PELAKSANAAN_KBM';
    const currentVal = el('plan-input-catalog')?.value;

    const curItem = (_catalog || []).find(c => c.id === currentVal) || STANDARD_WORKLOAD_CATALOG.find(c => c.id === currentVal);
    const searchQuery = (curItem && curItem.name.toLowerCase() === q.trim().toLowerCase()) ? '' : q;

    const filtered = getFilteredCatalogByDuty(selectedDuty, searchQuery);
    if (autoOpen) {
        openPlanCatalogDropdown();
    }
    if (searchInput) {
        autoResizeWorkloadTextarea(searchInput);
    }
    renderPlanCatalogCustomOptions(filtered, currentVal);
}

export function resetPlanCatalogSearch() {
    const searchInput = el('plan-input-catalog-search');
    if (searchInput) searchInput.value = '';
    onFilterPlanCatalog(true);
}

function onMainDutyChange() {
    const dutySelect = el('plan-input-main-duty');
    const selectedDuty = dutySelect?.value || 'PELAKSANAAN_KBM';
    populateCatalogDropdownByDuty(selectedDuty);
    closePlanCatalogDropdown();
    onCatalogChange(true);

    // Berikan saran placeholder kontekstual sesuai tugas guru
    const titleInput = el('plan-input-title');
    if (titleInput && (!titleInput.value || titleInput.dataset.autoFilled === '1')) {
        const catSelect = el('plan-input-catalog');
        const selectedCat = (_catalog || []).find(c => c.id === catSelect?.value);
        if (selectedDuty === 'PELAKSANAAN_KBM') {
            titleInput.placeholder = 'Contoh: KBM Matematika Kelas XI.1';
        } else if (selectedDuty === 'PERENCANAAN') {
            titleInput.placeholder = 'Contoh: Penyusunan Modul Ajar Bab 3';
        } else if (selectedDuty === 'PENILAIAN') {
            titleInput.placeholder = 'Contoh: Penilaian Sumatif Lingkup Materi 2';
        } else if (selectedDuty === 'PEMBIMBINGAN') {
            titleInput.placeholder = 'Contoh: Pendampingan Akademik Murid Dampingan (Guru Wali)';
        } else {
            titleInput.placeholder = selectedCat ? `Contoh: ${selectedCat.name}` : 'Contoh: Piket Sekolah';
        }
    }
}

// ========== KUNCI SINKRON KBM SEBELUM MENYUSUN RENCANA ==========
// KBM pada rencana wajib berasal dari jadwal resmi aSc (Sinkron KBM) agar mapel & kelasnya cocok
// dengan Jurnal Mengajar sehingga realisasi terisi otomatis. Pimpinan (Kepsek/Super Admin) dikecualikan.
const KBM_SYNC_FLAG_PREFIX = 'simas_wl_kbm_synced_';
const KBM_PAIRS_PREFIX = 'simas_wl_kbm_pairs_';
let _teacherKbmPairs = []; // [{ mapel, className }] dari jadwal aSc saat Sinkron KBM

function safeStorageGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
}
function safeStorageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
}
function getKbmSyncOwnerKey() {
    return getEffectiveTeacherId() || auth?.currentUser?.uid || 'self';
}

export function hasSyncedScheduleSegments(segments = []) {
    return (segments || []).some(s => !!s.schedule_occurrence_id);
}

// Dipanggil saat sinkron selesai, termasuk jika seluruh jadwal sudah ada di rencana (guru tanpa sesi baru)
function markKbmSyncedForWeek() {
    if (_weekStartDate) safeStorageSet(`${KBM_SYNC_FLAG_PREFIX}${getKbmSyncOwnerKey()}_${_weekStartDate}`, '1');
}

export function isPlanKbmSyncSatisfied() {
    if (isCurrentUserWorkloadManager()) return true;
    if (hasSyncedScheduleSegments(_weekData?.segments)) return true;
    return safeStorageGet(`${KBM_SYNC_FLAG_PREFIX}${getKbmSyncOwnerKey()}_${_weekStartDate}`) === '1';
}

function requireKbmSyncBeforePlanning() {
    if (isPlanKbmSyncSatisfied()) return true;
    showToast('Sinkronisasi Jadwal KBM Diperlukan: Silakan klik tombol "Sinkron KBM" terlebih dahulu agar jadwal mengajar Anda terisi sesuai jadwal resmi sekolah dan dapat terhubung otomatis dengan Jurnal Mengajar.', 'warning', 10000, 'Sinkron KBM Diperlukan');
    const btn = el('btn-sync-kbm-schedule');
    if (btn) {
        btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        btn.classList.add('ring-2', 'ring-amber-400', 'animate-pulse');
        setTimeout(() => btn.classList.remove('ring-2', 'ring-amber-400', 'animate-pulse'), 3000);
    }
    return false;
}

// Format judul KBM SSOT (sama dengan item hasil Sinkron KBM): "KBM {Mapel} ({Kelas})"
export function buildKbmTitle(mapel, className) {
    return className ? `KBM ${mapel} (${className})` : `KBM ${mapel}`;
}
export function parseKbmTitle(title) {
    const m = /^KBM\s+(.+?)\s+\(([^()]+)\)$/.exec(String(title || '').trim());
    return m ? { mapel: m[1].trim(), className: m[2].trim() } : null;
}

function rememberTeacherKbmPairs(pairs) {
    const valid = (pairs || []).filter(p => p && p.mapel && p.className);
    if (valid.length === 0) return;
    _teacherKbmPairs = valid;
    safeStorageSet(KBM_PAIRS_PREFIX + getKbmSyncOwnerKey(), JSON.stringify(valid));
}

// Daftar Mapel–Kelas guru: jadwal aSc (memori/lokal) + KBM tersinkron pada pekan aktif
export function getTeacherKbmPairs() {
    const map = new Map();
    const add = (p) => {
        if (p && p.mapel && p.className) map.set(`${p.mapel}|${p.className}`, { mapel: p.mapel, className: p.className });
    };
    _teacherKbmPairs.forEach(add);
    try { JSON.parse(safeStorageGet(KBM_PAIRS_PREFIX + getKbmSyncOwnerKey()) || '[]').forEach(add); } catch (_) {}
    (_weekData?.segments || [])
        .filter(s => s.schedule_occurrence_id && s.is_teaching)
        .forEach(s => add(parseKbmTitle(s.activity_title || s.title)));
    return [...map.values()].sort((a, b) => a.mapel.localeCompare(b.mapel) || a.className.localeCompare(b.className, 'id', { numeric: true }));
}

function renderKbmPicker(preset = null) {
    const mapelSel = el('plan-input-kbm-mapel');
    const kelasSel = el('plan-input-kbm-kelas');
    const emptyNote = el('plan-kbm-picker-empty');
    if (!mapelSel || !kelasSel) return;

    const pairs = getTeacherKbmPairs();
    if (preset && preset.mapel && preset.className && !pairs.some(p => p.mapel === preset.mapel && p.className === preset.className)) {
        pairs.push(preset); // KBM lama di luar jadwal tetap dapat disunting tanpa kehilangan nilainya
    }
    if (emptyNote) emptyNote.classList.toggle('hidden', pairs.length > 0);

    const mapels = [...new Set(pairs.map(p => p.mapel))];
    mapelSel.innerHTML = '<option value="">-- Pilih Mapel --</option>' +
        mapels.map(m => `<option value="${escapeHTML(m)}">${escapeHTML(m)}</option>`).join('');
    mapelSel.value = preset?.mapel && mapels.includes(preset.mapel) ? preset.mapel : (mapels.length === 1 ? mapels[0] : '');
    fillKbmKelasOptions(pairs, preset?.className);
    applyKbmPickerToTitle();
}

function fillKbmKelasOptions(pairs, presetClass = null) {
    const mapelSel = el('plan-input-kbm-mapel');
    const kelasSel = el('plan-input-kbm-kelas');
    if (!mapelSel || !kelasSel) return;
    const classes = mapelSel.value ? (pairs || getTeacherKbmPairs()).filter(p => p.mapel === mapelSel.value).map(p => p.className) : [];
    kelasSel.innerHTML = '<option value="">-- Pilih Kelas --</option>' +
        classes.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
    kelasSel.disabled = classes.length === 0;
    kelasSel.value = presetClass && classes.includes(presetClass) ? presetClass : (classes.length === 1 ? classes[0] : '');
}

function applyKbmPickerToTitle() {
    const mapel = el('plan-input-kbm-mapel')?.value;
    const kelas = el('plan-input-kbm-kelas')?.value;
    const titleInput = el('plan-input-title');
    if (titleInput && mapel && kelas) titleInput.value = buildKbmTitle(mapel, kelas);
}

export function onKbmMapelChange() {
    const preset = parseKbmTitle(el('plan-input-title')?.value);
    fillKbmKelasOptions(null, preset?.className);
    applyKbmPickerToTitle();
}
export function onKbmKelasChange() {
    applyKbmPickerToTitle();
}

function openPlanItemModal(dayIndex, existingId = null, defaultStartTime = null, defaultEndTime = null) {
    if (!existingId && !requireKbmSyncBeforePlanning()) return false;
    const modal = el('modal-plan-item');
    if (!modal) return false;

    closePlanCatalogDropdown();
    closeWakaDutyDropdown();
    if (typeof closePlanMainDutyDropdown === 'function') closePlanMainDutyDropdown();
    const wakaSearchInput = el('plan-input-waka-duty-search');
    if (wakaSearchInput) wakaSearchInput.value = '';

    const isStudyDay = (dayIndex === _studyDayIndex);

    el('plan-input-day').value = dayIndex;
    el('plan-input-date').value = dateOfDay(_weekStartDate, dayIndex);
    el('plan-input-id').value = existingId || '';

    // Kontrol Banner Hari Belajar Guru di Modal Form (SE No. 5684/2025)
    const studyDayBanner = el('plan-modal-study-day-banner');
    if (studyDayBanner) {
        if (isStudyDay) {
            studyDayBanner.classList.remove('hidden');
        } else {
            studyDayBanner.classList.add('hidden');
        }
    }

    // Opsi Tugas Pokok Guru (Permendikdasmen No. 11/2025):
    // Jika Hari Belajar Guru (SE No. 5684/2025), beri penanda visual jelas pada tugas pokok ranah HBG
    const dutySelect = el('plan-input-main-duty');
    if (dutySelect) {
        if (isStudyDay) {
            dutySelect.innerHTML = `
                <option value="PERENCANAAN">1. Merencanakan Pembelajaran atau Pembimbingan ✨ [Ranah HBG]</option>
                <option value="PELAKSANAAN_KBM">2. Melaksanakan Pembelajaran atau Pembimbingan</option>
                <option value="PENILAIAN">3. Menilai Hasil Pembelajaran atau Pembimbingan</option>
                <option value="PEMBIMBINGAN">4. Membimbing dan Melatih Murid</option>
                <option value="TUGAS_TAMBAHAN">5. Melaksanakan Tugas Tambahan yang Melekat ✨ [Ranah HBG - PKB/MGMP]</option>
            `;
        } else {
            dutySelect.innerHTML = `
                <option value="PERENCANAAN">1. Merencanakan Pembelajaran atau Pembimbingan</option>
                <option value="PELAKSANAAN_KBM" selected>2. Melaksanakan Pembelajaran atau Pembimbingan</option>
                <option value="PENILAIAN">3. Menilai Hasil Pembelajaran atau Pembimbingan</option>
                <option value="PEMBIMBINGAN">4. Membimbing dan Melatih Murid</option>
                <option value="TUGAS_TAMBAHAN">5. Melaksanakan Tugas Tambahan yang Melekat</option>
            `;
        }
    }

    const searchInput = el('plan-input-catalog-search');
    if (searchInput) searchInput.value = '';

    // Populate assignment dropdown
    const asgSelect = el('plan-input-assignment');
    if (asgSelect) {
        asgSelect.innerHTML = '<option value="">(Tidak Ada / Kegiatan Reguler)</option>' +
            (_assignments || []).filter(a => a.is_active).map(a =>
                `<option value="${a.id}">${a.duty_name} (${a.equivalent_jp || 0} JP-Eq)</option>`
            ).join('');
    }

    let existingSeg = null;
    let existingAct = null;
    if (existingId && _weekData?.segments) {
        existingSeg = _weekData.segments.find(s => s.id === existingId);
        if (existingSeg) {
            existingAct = (_weekData.activities || []).find(a => a.id === existingSeg.activity_id);
            if (isPlanSegmentRealized(existingSeg)) {
                showToast('Kegiatan rencana ini telah direalisasikan dan tidak dapat disunting lagi.', 'warning');
                return;
            }
        }
    }

    const modalTitle = el('modal-plan-item-title');
    if (modalTitle) {
        modalTitle.innerHTML = existingSeg
            ? '<i class="fa-solid fa-pen-to-square text-amber-500"></i> Edit Kegiatan Rencana'
            : '<i class="fa-solid fa-calendar-plus text-emerald-500"></i> Tambah Kegiatan Rencana';
    }

    const btnDeletePlan = el('btn-delete-plan-item');
    if (btnDeletePlan) {
        btnDeletePlan.classList.toggle('hidden', !existingSeg);
    }

    if (existingSeg) {
        // Mode Edit: Deteksi Tugas Pokok & Katalog dari data yang tersimpan secara terpadu SSOT
        const targetCatalogId = existingSeg.catalog_id || existingAct?.catalog_id || null;
        const dutyCode = resolveWorkloadDutyCode(existingSeg, existingAct, _catalog, STANDARD_WORKLOAD_CATALOG, isStudyDay);

        if (dutySelect) dutySelect.value = dutyCode;

        populateCatalogDropdownByDuty(dutyCode, targetCatalogId);

        el('plan-input-title').value = existingAct?.title || existingSeg.activity_title || existingSeg.description || '';
        el('plan-input-start').value = existingSeg.start_time || '';
        el('plan-input-end').value = existingSeg.end_time || '';
        el('plan-input-jp').value = existingSeg.jp_count != null ? existingSeg.jp_count : (existingSeg.is_teaching ? 2 : 0);
        if (asgSelect) asgSelect.value = existingAct?.assignment_id || '';
        el('plan-input-desc').value = existingSeg.description || '';
        updatePlannedMinutesPreview();
        renderTitleHistorySuggestions(dutyCode, targetCatalogId);
    } else {
        // Mode Tambah Baru:
        const isBk = isCurrentTeacherBk();
        const defaultDuty = isBk ? 'PEMBIMBINGAN' : (isStudyDay ? 'PERENCANAAN' : 'PELAKSANAAN_KBM');
        const defaultJp = (isBk || isStudyDay) ? '0' : '1';

        if (dutySelect) dutySelect.value = defaultDuty;

        populateCatalogDropdownByDuty(defaultDuty);

        // Reset form
        el('plan-input-title').value = '';
        el('plan-input-start').value = defaultStartTime || '';
        el('plan-input-end').value = defaultEndTime || '';
        el('plan-input-jp').value = defaultJp;
        el('plan-input-desc').value = '';
        updatePlannedMinutesPreview();
        renderTitleHistorySuggestions(defaultDuty, el('plan-input-catalog')?.value);
    }

    onCatalogChange(!defaultEndTime && !existingSeg);
    if (typeof renderPlanMainDutyDropdown === 'function') renderPlanMainDutyDropdown(isStudyDay);
    modal.classList.remove('hidden');
    return true;
}

// ========== TANDAI CUTI / IZIN KERJA (0m terencana, bebas pemenuhan jam) ==========
function openMarkLeaveModal(dayIndex) {
    const dayDate = dateOfDay(_weekStartDate, dayIndex);
    const dayName = DAY_NAMES[dayIndex] || 'Hari Ini';
    const daySegments = (_weekData?.segments || []).filter(s => s.date === dayDate);
    if (daySegments.some(s => isPlanSegmentRealized(s))) {
        showToast('Hari ini memuat kegiatan rencana yang telah direalisasikan dan tidak dapat ditandai libur / Cuti/Izin.', 'warning');
        return;
    }

    const modal = el('modal-mark-leave');
    if (!modal) return;

    if (el('leave-input-day-index')) el('leave-input-day-index').value = dayIndex;
    if (el('leave-modal-day-label')) {
        el('leave-modal-day-label').innerHTML = `<i class="fa-solid fa-calendar-day"></i> <span>${dayName}, ${dayDate}</span>`;
    }
    if (el('leave-input-type')) el('leave-input-type').value = 'Cuti Tahunan';
    if (el('leave-input-notes')) el('leave-input-notes').value = '';

    modal.classList.remove('hidden');
}

function closeLeaveModal() {
    el('modal-mark-leave')?.classList.add('hidden');
}

async function submitMarkLeave(event) {
    if (event && event.preventDefault) event.preventDefault();
    const dayIndex = parseInt(el('leave-input-day-index')?.value, 10);
    if (isNaN(dayIndex) || dayIndex < 0) {
        showToast('Hari kerja tidak valid', 'error');
        return;
    }

    const leaveType = el('leave-input-type')?.value || 'Cuti Tahunan';
    const leaveNotes = (el('leave-input-notes')?.value || '').trim();

    const dayDate = dateOfDay(_weekStartDate, dayIndex);
    const dayName = DAY_NAMES[dayIndex] || 'Hari Ini';
    const daySegments = (_weekData?.segments || []).filter(s => s.date === dayDate);
    const hasExisting = daySegments.length > 0;

    if (!_weekData?.initialized) {
        try {
            const initRes = await cfInitializeWorkloadWeek({
                week_start_date: _weekStartDate,
                teacher_id: getEffectiveTeacherId() || undefined
            });
            _weekData = { ..._weekData, initialized: true, ...initRes.data };
        } catch (err) {
            showToast('Gagal inisialisasi minggu: ' + err.message, 'error');
            return;
        }
        await loadWeek();
    }

    const ver = _weekData?.active_version;
    if (!ver) {
        showToast('Versi rencana kerja tidak tersedia', 'error');
        return;
    }

    // Konfirmasi penggantian jika hari tersebut sudah memuat kegiatan rencana
    if (hasExisting) {
        const ok = await askConfirm(
            `Hari ${dayName} (${dayDate}) saat ini memuat ${daySegments.length} kegiatan rencana kerja.\n\nMenandai hari ini sebagai ${leaveType} akan menghapus seluruh kegiatan rencana pada hari tersebut.\n\nApakah Anda yakin ingin melanjutkan?`,
            'Tandai Cuti / Izin',
            'warning',
            { confirmText: 'Lanjutkan & Ganti Rencana' }
        );
        if (!ok) return;
    }

    const workStartTime = _policy?.workStartTime || '07:30';
    const workEndTime = _policy?.workEndTime || '15:30';

    const item = {
        date: dayDate,
        day_of_week: dayIndex + 1,
        catalog_id: 'cat_cuti_izin',
        title: leaveType,
        start_time: workStartTime,
        end_time: workEndTime,
        is_teaching: 0,
        jp_count: 0,
        assignment_id: null,
        description: leaveNotes ? `${leaveType}: ${leaveNotes}` : leaveType,
        origin_source: 'manual',
        category_code: 'CUTI_IZIN',
        planned_minutes: 0,
        is_leave: 1
    };

    const submitBtn = el('btn-submit-mark-leave');
    const origHtml = submitBtn ? submitBtn.innerHTML : '';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Menyimpan...';
    }

    try {
        await cfSaveWorkloadPlanItems({
            work_week_id: _weekData.week.id,
            plan_version_id: ver.id,
            revision_lock: ver.revision_lock,
            items: [item],
            clear_date: dayDate
        });
        closeLeaveModal();
        showToast(`✓ Hari ${dayName} berhasil ditandai sebagai ${leaveType} (0m terencana)`, 'success', 5000, 'Status Disimpan');
        await loadWeek();
    } catch (err) {
        const friendlyMsg = formatSavePlanErrorMessage(err);
        showToast(friendlyMsg, 'error', 12000, 'Gagal Menyimpan Status');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = origHtml;
        }
    }
}

async function deactivateDayLeave(segmentId, dayIndex) {
    const dayName = DAY_NAMES[dayIndex] || 'Hari Ini';
    const ok = await askConfirm(
        `Nonaktifkan status Cuti/Izin pada hari ${dayName}?\n\nHari ini akan kembali menjadi hari kerja aktif dengan slot jam kosong yang siap Anda rencanakan.`,
        'Nonaktifkan Cuti/Izin',
        'warning',
        { confirmText: 'Ya, Nonaktifkan Cuti', cancelText: 'Batal' }
    );
    if (!ok) return;

    try {
        await cfDeleteWorkloadPlanItem(segmentId);
        showToast(`✓ Status Cuti/Izin hari ${dayName} berhasil dinonaktifkan`);
        await loadWeek();
    } catch (err) {
        showToast(err.message || 'Gagal menonaktifkan cuti', 'error');
    }
}

// Wrapper backward-compatibility untuk pengujian unit & aksi warisan
async function markDayHoliday(dayIndex) {
    openMarkLeaveModal(dayIndex);
}

// ========== ALUR TIDAK TERLAKSANA (SAKIT / CUTI / IZIN DI LUAR RENCANA) ==========
function openUnplannedAbsenceModal(targetDayIndex = null) {
    const dayIndex = targetDayIndex !== null ? Number(targetDayIndex) : _selectedDayIndex;
    const targetDate = dateOfDay(_weekStartDate, dayIndex);
    const dayName = DAY_NAMES[dayIndex] || 'Hari Kerja';

    const dayIdxInput = el('unplanned-absence-day-index');
    const dateInput = el('unplanned-absence-date');
    const dayLabel = el('unplanned-absence-day-label');
    const typeSelect = el('unplanned-absence-type');
    const notesTextarea = el('unplanned-absence-notes');
    const cancelBtn = el('btn-cancel-unplanned-absence');
    const submitBtnLabel = el('label-btn-submit-unplanned-absence');

    if (dayIdxInput) dayIdxInput.value = dayIndex;
    if (dateInput) dateInput.value = targetDate;
    if (dayLabel) {
        dayLabel.innerHTML = `<i class="fa-solid fa-calendar-day"></i> <span>${dayName}, ${targetDate}</span>`;
    }

    // Cari info existing absence jika ada
    const existingAbsenceLog = (_weekData?.logs || []).find(l => {
        return (l.date === targetDate || !l.date) && l.status_execution === 'tidak_terlaksana' && /^\[(Sakit|Cuti|Izin)\]/i.test(l.obstacle_notes || '');
    });

    if (existingAbsenceLog) {
        const match = (existingAbsenceLog.obstacle_notes || '').match(/^\[(Sakit|Cuti|Izin)\]\s*(.*)/i);
        const curType = match ? match[1] : 'Sakit';
        const curNotes = match ? match[2] : (existingAbsenceLog.obstacle_notes || '');

        if (typeSelect) {
            const foundOption = Array.from(typeSelect.options).find(o => o.value.toLowerCase() === curType.toLowerCase());
            typeSelect.value = foundOption ? foundOption.value : 'Sakit';
        }
        if (notesTextarea) notesTextarea.value = curNotes;
        if (cancelBtn) cancelBtn.classList.remove('hidden');
        if (submitBtnLabel) submitBtnLabel.textContent = 'Perbarui Keterangan';
    } else {
        if (typeSelect) typeSelect.value = 'Sakit';
        if (notesTextarea) notesTextarea.value = '';
        if (cancelBtn) cancelBtn.classList.add('hidden');
        if (submitBtnLabel) submitBtnLabel.textContent = 'Simpan Tidak Terlaksana';
    }

    const modal = el('modal-unplanned-absence');
    if (modal) modal.classList.remove('hidden');
}

function closeUnplannedAbsenceModal() {
    const modal = el('modal-unplanned-absence');
    if (modal) modal.classList.add('hidden');
}

async function submitUnplannedAbsence(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (_isSavingLog) return;
    if (isManagerViewingOtherTeacher()) {
        showToast(MANAGER_READONLY_LOG_MSG, 'warning');
        return;
    }

    const dayIndex = Number(el('unplanned-absence-day-index')?.value ?? _selectedDayIndex);
    const targetDate = el('unplanned-absence-date')?.value || dateOfDay(_weekStartDate, dayIndex);
    const type = el('unplanned-absence-type')?.value || 'Sakit';
    const rawNotes = el('unplanned-absence-notes')?.value?.trim() || '';

    if (!rawNotes) {
        showToast('Keterangan alasan wajib diisi.', 'warning');
        el('unplanned-absence-notes')?.focus();
        return;
    }

    if (!_weekData?.initialized) {
        try {
            const initRes = await cfInitializeWorkloadWeek({
                week_start_date: _weekStartDate,
                teacher_id: getEffectiveTeacherId() || undefined
            });
            if (initRes?.data) {
                _weekData = { ..._weekData, initialized: true, ...initRes.data };
            }
        } catch (err) {
            showToast('Gagal inisialisasi minggu: ' + err.message, 'error');
            return;
        }
        await loadWeek();
    }

    const formattedObstacleNotes = `[${type}] ${rawNotes}`;
    const teacherId = _weekData?.week?.teacher_id || _weekData?.teacher_id || getEffectiveTeacherId() || _currentUserProfile?.linkedTeacherId || _currentUserProfile?.teacher_id || auth?.currentUser?.uid || undefined;
    const workWeekId = _weekData?.week?.id;

    if (!workWeekId || !teacherId) {
        showToast('Data pekan kerja atau identitas guru tidak valid.', 'error');
        return;
    }

    // Identifikasi seluruh segment rencana pada hari tersebut
    const daySegments = (_weekData?.segments || []).filter(s => {
        return (Number(s.day_of_week) === (dayIndex + 1)) || s.date === targetDate;
    });

    const submitBtn = el('btn-submit-unplanned-absence');
    const origBtnHtml = submitBtn ? submitBtn.innerHTML : '';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add('opacity-75', 'cursor-wait');
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Menyimpan...';
    }

    _isSavingLog = true;
    try {
        const existingDayLogs = (_weekData?.logs || []).filter(l => l.date === targetDate);
        const planLinks = _weekData?.plan_links || _weekData?.plan_log_links || [];

        const payloadsToSave = [];

        if (daySegments.length > 0) {
            daySegments.forEach(seg => {
                // Cari apakah ada log eksisting untuk segment ini
                const linkedLog = existingDayLogs.find(l => {
                    return planLinks.some(pl => pl.plan_activity_id === seg.activity_id && pl.work_log_id === l.id);
                });

                const payload = {
                    id: linkedLog ? linkedLog.id : undefined,
                    work_week_id: workWeekId,
                    teacher_id: teacherId,
                    date: targetDate,
                    day_of_week: dayIndex + 1,
                    title: seg.activity_title || seg.description || 'Kegiatan Terencana',
                    catalog_id: seg.catalog_id || 'cat_kbm',
                    category_code: seg.category_code || 'PELAKSANAAN_KBM',
                    is_unplanned: 0,
                    status_execution: 'tidak_terlaksana',
                    obstacle_notes: formattedObstacleNotes,
                    output_summary: `Tidak terlaksana karena ${type.toLowerCase()}.`,
                    start_time: seg.start_time || '07:30',
                    end_time: seg.end_time || '08:15',
                    plan_activity_id: seg.activity_id
                };
                payloadsToSave.push(payload);
            });
        } else {
            // Jika tidak ada kegiatan terencana sama sekali pada hari itu, buat 1 log tidak hadir
            const existingAbsenceLog = existingDayLogs.find(l => /^\[(Sakit|Cuti|Izin)\]/i.test(l.obstacle_notes || ''));
            const payload = {
                id: existingAbsenceLog ? existingAbsenceLog.id : undefined,
                work_week_id: workWeekId,
                teacher_id: teacherId,
                date: targetDate,
                day_of_week: dayIndex + 1,
                title: `Tidak Hadir (${type})`,
                catalog_id: 'cat_kbm',
                category_code: 'PELAKSANAAN_KBM',
                is_unplanned: 1,
                status_execution: 'tidak_terlaksana',
                obstacle_notes: formattedObstacleNotes,
                output_summary: `Tidak hadir karena ${type.toLowerCase()}: ${rawNotes}`,
                start_time: '07:30',
                end_time: '15:30'
            };
            payloadsToSave.push(payload);
        }

        // Eksekusi penyimpanan ke D1
        for (const p of payloadsToSave) {
            await cfSaveWorkloadLog(p);
        }

        showToast(`Hari ini berhasil ditandai Tidak Terlaksana (${type}).`);
        closeUnplannedAbsenceModal();
        await loadWeek();
    } catch (err) {
        showToast(err.message || 'Gagal menyimpan status tidak terlaksana', 'error');
    } finally {
        _isSavingLog = false;
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.classList.remove('opacity-75', 'cursor-wait');
            submitBtn.innerHTML = origBtnHtml;
        }
    }
}

async function cancelUnplannedAbsence() {
    const dayIndex = Number(el('unplanned-absence-day-index')?.value ?? _selectedDayIndex);
    const targetDate = el('unplanned-absence-date')?.value || dateOfDay(_weekStartDate, dayIndex);

    const ok = await askConfirm(
        `Batalkan status Tidak Terlaksana pada hari ${DAY_NAMES[dayIndex] || 'ini'} (${targetDate})?\n\nLaporan tidak terlaksana yang telah dibuat akan dihapus sehingga kegiatan dapat dilaporkan kembali secara normal.`,
        'Batalkan Status Tidak Terlaksana',
        'danger',
        { confirmText: 'Batalkan & Hapus Laporan' }
    );
    if (!ok) return;

    // Cari seluruh log pada hari tersebut yang berstatus tidak_terlaksana dengan [Sakit/Cuti/Izin]
    const logsToDelete = (_weekData?.logs || []).filter(l => {
        return l.date === targetDate && l.status_execution === 'tidak_terlaksana' && /^\[(Sakit|Cuti|Izin)\]/i.test(l.obstacle_notes || '');
    });

    if (logsToDelete.length === 0) {
        showToast('Tidak ada laporan ketidakhadiran yang ditemukan untuk dibatalkan.', 'info');
        closeUnplannedAbsenceModal();
        return;
    }

    const cancelBtn = el('btn-cancel-unplanned-absence');
    const origHtml = cancelBtn ? cancelBtn.innerHTML : '';
    if (cancelBtn) {
        cancelBtn.disabled = true;
        cancelBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Membatalkan...';
    }

    try {
        for (const log of logsToDelete) {
            await cfDeleteWorkloadLog(log.id);
        }
        showToast('Status Tidak Terlaksana berhasil dibatalkan. Kegiatan kembali menjadi rencana aktif.');
        closeUnplannedAbsenceModal();
        await loadWeek();
    } catch (err) {
        showToast(err.message || 'Gagal membatalkan status tidak terlaksana', 'error');
    } finally {
        if (cancelBtn) {
            cancelBtn.disabled = false;
            cancelBtn.innerHTML = origHtml;
        }
    }
}

function updateUnplannedAbsenceUI(dayDate, dayIndex, logs, segments) {
    const btnDayAbsence = el('btn-day-unplanned-absence');
    const labelBtn = el('label-btn-day-unplanned-absence');
    const banner = el('unplanned-absence-day-banner');
    const bannerBadge = el('unplanned-absence-banner-type-badge');
    const bannerNotes = el('unplanned-absence-banner-notes');

    // Cek apakah hari ini merupakan hari libur resmi atau cuti terencana
    const dayTimeline = calculateDayTimelineSlots(dayDate, segments || [], {
        policy: _policy,
        isHolidayFn: (d) => isHolidayDate(d),
        getHolidayInfoFn: (d) => getHolidayDateInfo(d)
    });

    if (dayTimeline.isHoliday || dayTimeline.isLeave) {
        if (btnDayAbsence) btnDayAbsence.classList.add('hidden');
        if (banner) banner.classList.add('hidden');
        return;
    }

    if (btnDayAbsence) btnDayAbsence.classList.remove('hidden');

    const absenceLog = (logs || []).find(l => {
        return (l.date === dayDate || !l.date) && l.status_execution === 'tidak_terlaksana' && /^\[(Sakit|Cuti|Izin)\]/i.test(l.obstacle_notes || '');
    });

    if (absenceLog) {
        const match = (absenceLog.obstacle_notes || '').match(/^\[(Sakit|Cuti|Izin)\]\s*(.*)/i);
        const type = match ? match[1] : 'Sakit';
        const notes = match ? match[2] : (absenceLog.obstacle_notes || '');

        if (labelBtn) labelBtn.textContent = `Ubah / Batalkan ${type}`;
        if (btnDayAbsence) {
            btnDayAbsence.classList.remove('bg-rose-50', 'text-rose-700', 'border-rose-200');
            btnDayAbsence.classList.add('bg-amber-50', 'dark:bg-amber-950/40', 'text-amber-800', 'dark:text-amber-200', 'border-amber-300', 'dark:border-amber-700');
        }

        if (banner) {
            banner.classList.remove('hidden');
            if (bannerBadge) bannerBadge.textContent = type;
            if (bannerNotes) bannerNotes.textContent = notes || `Tidak terlaksana karena ${type.toLowerCase()}.`;
        }
    } else {
        if (labelBtn) labelBtn.textContent = 'Tidak Terlaksana (Sakit/Cuti/Izin)';
        if (btnDayAbsence) {
            btnDayAbsence.classList.remove('bg-amber-50', 'dark:bg-amber-950/40', 'text-amber-800', 'dark:text-amber-200', 'border-amber-300', 'dark:border-amber-700');
            btnDayAbsence.classList.add('bg-rose-50', 'dark:bg-rose-950/40', 'text-rose-700', 'dark:text-rose-300', 'border-rose-200', 'dark:border-rose-800/80');
        }
        if (banner) banner.classList.add('hidden');
    }
}

function closePlanModal() {
    closePlanCatalogDropdown();
    closeWakaDutyDropdown();
    if (typeof closePlanMainDutyDropdown === 'function') closePlanMainDutyDropdown();
    el('modal-plan-item')?.classList.add('hidden');
}

export async function deletePlanItemFromModal() {
    const planId = el('plan-input-id')?.value;
    if (!planId) return;
    closePlanModal();
    await deletePlanItem(planId);
}

function onCatalogChange(autoAdjustTime = true) {
    const catSelect = el('plan-input-catalog');
    const kbmPicker = el('plan-kbm-picker');
    const titleInputEl = el('plan-input-title');
    if (!catSelect || !catSelect.value) {
        const wrapper = el('plan-teaching-wrapper');
        if (wrapper) wrapper.style.display = 'none';
        if (kbmPicker) kbmPicker.classList.add('hidden');
        if (titleInputEl) titleInputEl.readOnly = false;
        return;
    }
    const selected = catSelect.options[catSelect.selectedIndex];
    const isTeaching = selected?.dataset?.teaching === '1';
    const wrapper = el('plan-teaching-wrapper');
    if (wrapper) wrapper.style.display = isTeaching ? '' : 'none';

    // KBM tatap muka: judul dikunci ke format jadwal "KBM {Mapel} ({Kelas})" agar cocok dengan Jurnal Mengajar
    if (kbmPicker) kbmPicker.classList.toggle('hidden', !isTeaching);
    if (titleInputEl) {
        titleInputEl.readOnly = isTeaching;
        titleInputEl.classList.toggle('opacity-75', isTeaching);
    }
    if (isTeaching) renderKbmPicker(parseKbmTitle(titleInputEl?.value));

    // Periksa apakah kategori yang dipilih adalah Tugas Tambahan Waka
    const catId = catSelect.value;
    const isWaka = isWakaCatalogId(catId);
    const wakaBanner = el('plan-waka-banner');
    const wakaDutyContainer = el('container-plan-waka-duty-picker');
    const wakaTitleHint = el('plan-title-waka-hint');
    const descStar = el('plan-desc-required-star');
    const descNote = el('plan-desc-waka-note');
    const descInput = el('plan-input-desc');

    if (isWaka) {
        const wakaType = getWakaTypeFromCatalogId(catId);
        const dutyInfo = getWakaMainDutyInfo(wakaType);

        if (wakaBanner) {
            const bTitle = el('plan-waka-banner-title');
            const bText = el('plan-waka-banner-text');
            if (bTitle) bTitle.textContent = `${dutyInfo.title}:`;
            if (bText) bText.textContent = dutyInfo.description;
            wakaBanner.classList.remove('hidden');
        }
        if (wakaDutyContainer) {
            wakaDutyContainer.classList.remove('hidden');
            renderPlanWakaDutyDropdown(wakaType);
        }
        if (wakaTitleHint) wakaTitleHint.classList.remove('hidden');
        if (descStar) descStar.classList.remove('hidden');
        if (descNote) descNote.classList.remove('hidden');
        if (descInput) {
            descInput.required = true;
            descInput.setAttribute('required', 'required');
            descInput.placeholder = 'Uraikan rencana capaian / target pelaksanaan butir tugas waka ini... (Wajib diisi)';
        }
    } else {
        if (wakaBanner) wakaBanner.classList.add('hidden');
        if (wakaDutyContainer) {
            wakaDutyContainer.classList.add('hidden');
            closeWakaDutyDropdown();
        }
        if (wakaTitleHint) wakaTitleHint.classList.add('hidden');
        if (descStar) descStar.classList.add('hidden');
        if (descNote) descNote.classList.add('hidden');
        if (descInput) {
            descInput.required = false;
            descInput.removeAttribute('required');
            descInput.placeholder = 'Catatan materi / target pembelajaran';
        }
    }

    // Perbarui saran riwayat judul
    const dutySelect = el('plan-input-main-duty');
    const selectedDuty = dutySelect?.value || 'PELAKSANAAN_KBM';
    renderTitleHistorySuggestions(selectedDuty, catSelect.value);

    // Otomatisasi estimasi jam selesai: Default murni 1 JP (45 menit), anti-overwrite jam akhir yang telah diisi/diedit guru
    if (autoAdjustTime) {
        const start = el('plan-input-start')?.value;
        const endInput = el('plan-input-end');
        const currentEnd = (endInput?.value || '').trim();

        // SSOT: Jika jam akhir sudah terisi atau diedit oleh guru (baik kurang/lebih dari 1 JP atau dari slot jadwal),
        // JANGAN PERNAH diubah saat guru beralih/mengubah pilihan butir rencana di katalog.
        // Jam akhir hanya diisi otomatis jika masih kosong dan jam mulai tersedia, selalu dengan durasi default 1 JP (45 menit).
        if (!currentEnd && start && endInput) {
            const defaultPlanDurMin = 45; // Default murni 1 JP
            endInput.value = calculateEndTimeWithBreaks(start, defaultPlanDurMin);
        }
        updatePlannedMinutesPreview();
    } else {
        updatePlannedMinutesPreview();
    }
}

function updatePlannedMinutesPreview() {
    const startInput = el('plan-input-start');
    const endInput = el('plan-input-end');
    const submitBtn = el('btn-submit-workload-plan');
    const alertBox = el('plan-time-overlap-alert');
    const alertMsg = el('plan-time-overlap-message');

    const start = startInput?.value;
    const end = endInput?.value;
    const eff = calcEffective(start, end);
    const preview = el('plan-preview-effective-minutes');
    const workEndTime = _policy?.workEndTime || '15:30';
    const isOt = end && workEndTime && end > workEndTime;

    if (preview) {
        preview.innerHTML = `${eff} menit${isOt ? ' <span class="text-blue-600 dark:text-blue-400 font-normal text-[11px] ml-1">(Termasuk kegiatan luar jam reguler)</span>' : ''}`;
    }

    // Reset status visual
    if (alertBox) alertBox.classList.add('hidden');
    if (startInput) {
        startInput.classList.remove('border-rose-500', 'focus:ring-rose-500/30', 'bg-rose-50/50', 'dark:bg-rose-950/20');
    }
    if (endInput) {
        endInput.classList.remove('border-rose-500', 'focus:ring-rose-500/30', 'bg-rose-50/50', 'dark:bg-rose-950/20');
    }
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }

    if (!start || !end) return;

    // Validasi jam mulai < jam selesai
    if (start >= end) {
        if (alertBox && alertMsg) {
            alertMsg.textContent = 'Jam mulai harus lebih awal dari jam selesai.';
            alertBox.classList.remove('hidden');
        }
        if (startInput) startInput.classList.add('border-rose-500');
        if (endInput) endInput.classList.add('border-rose-500');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
        }
        return;
    }

    // Deteksi benturan irisan waktu secara instan dengan segmen hari terkait
    const targetDate = el('plan-input-date')?.value;
    const existingId = el('plan-input-id')?.value;
    let existingActivityId = null;
    if (existingId && _weekData?.segments) {
        const seg = _weekData.segments.find(s => s.id === existingId);
        if (seg) existingActivityId = seg.activity_id;
    }

    const daySegments = (_weekData?.segments || []).filter(s => s.date === targetDate);
    const overlapCheck = findTimeOverlap({ start_time: start, end_time: end }, daySegments, existingId || existingActivityId);

    if (overlapCheck.hasOverlap) {
        if (alertBox && alertMsg) {
            const segConf = overlapCheck?.conflictingSegment;
            const confTitle = segConf?.activity_title || segConf?.title || 'Kegiatan Lain';
            const confStart = segConf?.start_time || '';
            const confEnd = segConf?.end_time || '';
            const timeDetail = (confStart && confEnd) ? ` (${confStart} - ${confEnd})` : '';
            alertMsg.textContent = `Waktu ${start} - ${end} bertabrakan dengan kegiatan "${confTitle}"${timeDetail}. Silakan sesuaikan jam kegiatan.`;
            alertBox.classList.remove('hidden');
        }
        if (startInput) {
            startInput.classList.add('border-rose-500', 'focus:ring-rose-500/30', 'bg-rose-50/50', 'dark:bg-rose-950/20');
        }
        if (endInput) {
            endInput.classList.add('border-rose-500', 'focus:ring-rose-500/30', 'bg-rose-50/50', 'dark:bg-rose-950/20');
        }
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
        }
    }
}

async function savePlanItem(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (_isSavingPlanItem) return;

    // Pastikan minggu sudah diinisialisasi
    if (!_weekData?.initialized) {
        try {
            const initRes = await cfInitializeWorkloadWeek({
                week_start_date: _weekStartDate,
                teacher_id: getEffectiveTeacherId() || undefined
            });
            _weekData = { ..._weekData, initialized: true, ...initRes.data };
        } catch (err) {
            showToast('Gagal menginisialisasi minggu kerja: ' + (err.message || 'Koneksi ke server terputus.') + '. Silakan muat ulang halaman.', 'error', 12000, 'Gagal Menyimpan Rencana');
            return;
        }
        await loadWeek();
    }

    const ver = _weekData?.active_version;
    if (!ver) {
        showToast('Versi rencana kerja tidak tersedia. Silakan muat ulang (refresh) halaman untuk memuat data minggu kerja terbaru Anda.', 'error', 12000, 'Rencana Tidak Tersedia');
        return;
    }

    const catSelect = el('plan-input-catalog');
    if (!catSelect?.value) {
        showToast('Kategori kegiatan belum dipilih. Silakan pilih rincian/kategori kegiatan yang sesuai pada daftar sebelum menyimpan rencana.', 'warning', 8000, 'Pilih Kategori Kegiatan');
        el('plan-input-catalog-search')?.focus();
        openPlanCatalogDropdown();
        return;
    }
    const isTeaching = catSelect?.options[catSelect.selectedIndex]?.dataset?.teaching === '1';
    const dutySelect = el('plan-input-main-duty');
    const selectedDuty = dutySelect?.value || 'PELAKSANAAN_KBM';

    const existingId = el('plan-input-id').value;
    if (!existingId && !requireKbmSyncBeforePlanning()) return;

    if (isTeaching) {
        const kbmMapel = el('plan-input-kbm-mapel')?.value;
        const kbmKelas = el('plan-input-kbm-kelas')?.value;
        if (!kbmMapel || !kbmKelas) {
            showToast('Lengkapi Data KBM: Silakan pilih Mata Pelajaran dan Kelas yang diajar agar kegiatan KBM sesuai jadwal dan dapat tercatat otomatis di Jurnal Mengajar.', 'warning', 10000, 'Data KBM Belum Lengkap');
            el('plan-input-kbm-mapel')?.focus();
            return;
        }
        el('plan-input-title').value = buildKbmTitle(kbmMapel, kbmKelas);
    }
    let existingActivityId = null;
    if (existingId && _weekData?.segments) {
        const seg = _weekData.segments.find(s => s.id === existingId);
        if (seg) {
            existingActivityId = seg.activity_id;
            if (isPlanSegmentRealized(seg)) {
                showToast('Kegiatan rencana ini telah direalisasikan dan tidak dapat disunting atau diubah.', 'warning');
                return;
            }
        }
    }

    const selectedCatId = catSelect?.value || 'cat_kbm';
    const selectedCatItem = (_catalog || []).find(c => c && c.id === selectedCatId) || STANDARD_WORKLOAD_CATALOG.find(c => c && c.id === selectedCatId);
    const resolvedDuty = (selectedCatItem && WORKLOAD_MAIN_DUTY_CONFIG[selectedCatItem.category_code])
        ? selectedCatItem.category_code
        : (WORKLOAD_MAIN_DUTY_CONFIG[selectedDuty] ? selectedDuty : 'PELAKSANAAN_KBM');

    const item = {
        date: el('plan-input-date').value,
        day_of_week: parseInt(el('plan-input-day').value) + 1,
        catalog_id: selectedCatId,
        title: el('plan-input-title').value.trim(),
        start_time: el('plan-input-start').value,
        end_time: el('plan-input-end').value,
        is_teaching: isTeaching ? 1 : 0,
        jp_count: isTeaching ? parseInt(el('plan-input-jp')?.value || '0') : 0,
        assignment_id: el('plan-input-assignment')?.value || null,
        description: el('plan-input-desc')?.value?.trim() || '',
        origin_source: 'manual',
        category_code: resolvedDuty
    };

    if (existingId) {
        item.id = existingId;
        if (existingActivityId) item.activity_id = existingActivityId;
    }

    // Validasi judul kegiatan tidak boleh kosong
    if (!item.title) {
        showToast('Judul rencana kegiatan tidak boleh kosong. Silakan ketik judul atau uraian kegiatan sebelum menyimpan.', 'warning', 8000, 'Judul Kegiatan Kosong');
        el('plan-input-title')?.focus();
        return;
    }

    // Validasi jam kegiatan
    if (!item.start_time || !item.end_time || item.start_time >= item.end_time) {
        showToast('Waktu kegiatan tidak valid. Pastikan jam mulai lebih awal dari jam selesai kegiatan.', 'warning', 8000, 'Jam Tidak Valid');
        el('plan-input-start')?.focus();
        return;
    }

    // Validasi Wajib Keterangan / Rencana Capaian khusus Tugas Tambahan Waka
    if (isWakaCatalogId(item.catalog_id)) {
        if (!item.description || !item.description.trim()) {
            showToast('Keterangan / Rencana Capaian wajib diisi untuk Tugas Tambahan Wakil Kepala Sekolah!', 'warning');
            const descEl = el('plan-input-desc');
            if (descEl) {
                descEl.focus();
                descEl.classList.add('border-rose-500', 'bg-rose-50/50', 'dark:bg-rose-950/20');
                setTimeout(() => {
                    descEl.classList.remove('border-rose-500', 'bg-rose-50/50', 'dark:bg-rose-950/20');
                }, 3000);
            }
            return;
        }
    }

    // Proteksi Jam Istirahat 0 Menit
    if (calcEffective(item.start_time, item.end_time) <= 0 && item.category_code !== 'CUTI_IZIN') {
        showToast('Waktu Berada di Jam Istirahat: Rentang jam kegiatan yang Anda pilih berada tepat di jam istirahat resmi sekolah sehingga durasi efektif 0 menit. Silakan sesuaikan jam kegiatan.', 'error', 12000, 'Waktu Tidak Valid');
        el('plan-input-start')?.focus();
        return;
    }

    // Validasi Anti-Benturan Waktu Rencana (Anti-Overlap Rule)
    const daySegments = (_weekData?.segments || []).filter(s => s.date === item.date);
    const overlapCheck = findTimeOverlap(item, daySegments, existingId || existingActivityId);
    if (overlapCheck.hasOverlap) {
        showToast(formatPlanOverlapMessage(overlapCheck, item), 'warning', 12000, 'Jadwal Bertabrakan');
        el('plan-input-start')?.focus();
        return;
    }

    _isSavingPlanItem = true;
    const submitBtn = el('btn-submit-workload-plan');
    const modalPlan = el('modal-plan-item');
    const cancelBtn = modalPlan ? modalPlan.querySelector('button[onclick*="closePlanModal"]') : null;
    const deleteBtn = el('btn-delete-plan-item');
    const origSubmitHtml = submitBtn ? submitBtn.innerHTML : '';

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add('opacity-75', 'cursor-wait');
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Menyimpan...';
    }
    if (cancelBtn) cancelBtn.disabled = true;
    if (deleteBtn) deleteBtn.disabled = true;

    try {
        await cfSaveWorkloadPlanItems({
            work_week_id: _weekData.week.id,
            plan_version_id: ver.id,
            revision_lock: ver.revision_lock,
            items: [item]
        });
        showToast(existingId ? 'Rencana kegiatan berhasil diperbarui' : 'Rencana kegiatan berhasil disimpan', 'success', 5000, 'Berhasil Disimpan');

        // Simpan riwayat judul untuk saran cepat di kemudian hari
        recordTitleToHistory(selectedDuty, item.catalog_id, item.title);

        const savedDayIdx = parseInt(el('plan-input-day')?.value, 10);

        closePlanModal();
        await loadWeek();

        if (!isNaN(savedDayIdx) && savedDayIdx === _studyDayIndex) {
            const hasHbg = checkHasPkActivity(_weekData?.segments || [], savedDayIdx);
            if (!hasHbg) {
                showToast(`Catatan Kepatuhan Regulasi: Hari ${DAY_NAMES[savedDayIdx]} adalah Hari Belajar Guru (SE No. 5684/2025). Pastikan mencantumkan minimal 1 kegiatan ranah HBG (Perencanaan Pembelajaran atau PKB/MGMP).`, 'info', 8000, 'Hari Belajar Guru');
            }
        }
    } catch (err) {
        const friendlyMsg = formatSavePlanErrorMessage(err);
        showToast(friendlyMsg, 'error', 12000, 'Gagal Menyimpan Rencana');
        if (String(err?.message || '').includes('Data rencana telah diperbarui oleh sesi lain') || String(err?.message || '').includes('409')) {
            try { await loadWeek(); } catch (_) {}
        }
    } finally {
        _isSavingPlanItem = false;
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.classList.remove('opacity-75', 'cursor-wait');
            submitBtn.innerHTML = origSubmitHtml || 'Simpan Rencana';
        }
        if (cancelBtn) cancelBtn.disabled = false;
        if (deleteBtn) deleteBtn.disabled = false;
    }
}

async function deletePlanItem(segmentId) {
    const targetSeg = (_weekData?.segments || []).find(s => s.id === segmentId);
    if (targetSeg && isPlanSegmentRealized(targetSeg)) {
        showToast('Kegiatan rencana ini telah direalisasikan dan tidak dapat dihapus.', 'warning');
        return;
    }
    const ok = await askConfirm('Apakah Anda yakin ingin menghapus item rencana kerja ini?', 'Hapus Rencana', 'danger', { confirmText: 'Hapus Item' });
    if (!ok) return;
    try {
        await cfDeleteWorkloadPlanItem(segmentId);
        showToast('Item rencana berhasil dihapus', 'success', 4000, 'Berhasil Dihapus');
        await loadWeek();
    } catch (e) {
        showToast('Gagal menghapus kegiatan rencana: ' + (e.message || 'Terjadi kesalahan sistem.') + '. Silakan coba lagi.', 'error', 10000, 'Gagal Menghapus');
    }
}

// ========== CUSTOM SEARCHABLE COMBOBOX: LOG CATALOG ==========
export function renderLogCatalogCustomOptions(items = [], selectedId = null) {
    const listEl = el('list-log-catalog-options');
    const jpBadgeEl = el('log-catalog-selected-jp-badge');

    const selectedItem = items.find(c => c.id === selectedId) || (_catalog || []).find(c => c.id === selectedId) || STANDARD_WORKLOAD_CATALOG.find(c => c.id === selectedId) || null;
    if (jpBadgeEl) {
        const jp = selectedItem ? getCatalogItemEquivalentJp(selectedItem) : 0;
        jpBadgeEl.textContent = jp > 0 ? `(${jp} JP)` : '';
    }

    if (!listEl) return;

    if (!items || items.length === 0) {
        listEl.innerHTML = `
            <div class="p-3 text-center text-slate-400 text-xs flex flex-col items-center gap-1.5">
                <span>Tidak ada sub-kegiatan yang cocok</span>
                <button type="button" onclick="window.workloadResetLogCatalogSearch()" class="px-2.5 py-1 text-[11px] rounded-lg bg-blue-100 hover:bg-blue-200 text-blue-800 dark:bg-blue-950 dark:hover:bg-blue-900 dark:text-blue-300 font-bold transition-colors cursor-pointer">
                    <i class="fa-solid fa-rotate-left mr-1"></i>Tampilkan Semua Sub-Kegiatan
                </button>
            </div>`;
        return;
    }

    const logDate = el('log-input-date')?.value;
    let currentDayIdx = _selectedDayIndex;
    if (logDate && _weekStartDate) {
        const diff = Math.round((new Date(logDate + 'T00:00:00') - new Date(_weekStartDate + 'T00:00:00')) / (86400 * 1000));
        if (!isNaN(diff) && diff >= 0 && diff < 7) currentDayIdx = diff;
    }
    const isCurrentStudyDay = !isNaN(currentDayIdx) && currentDayIdx === _studyDayIndex;

    listEl.innerHTML = items.map(c => {
        const isSelected = c.id === (selectedItem ? selectedItem.id : null);
        const jp = getCatalogItemEquivalentJp(c);
        const jpBadge = jp > 0
            ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 shrink-0 border border-blue-200 dark:border-blue-800/60">${jp} JP</span>`
            : '';
        const isHbg = isCurrentStudyDay && isCatalogItemHbg(c);
        const hbgBadge = isHbg
            ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 shrink-0 border border-purple-200 dark:border-purple-800/60 flex items-center gap-1" title="Ranah Hari Belajar Guru (SE No. 5684/2025)"><i class="fa-solid fa-graduation-cap text-[8px]"></i>HBG</span>`
            : '';
        const bgCls = isSelected
            ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 font-bold border-l-4 border-blue-500'
            : 'hover:bg-slate-100 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200';

        const badgesRight = (jpBadge || hbgBadge)
            ? `<div class="flex flex-col items-end gap-1 shrink-0 mt-0.5">${jpBadge}${hbgBadge}</div>`
            : '';
        const cleanDesc = (c.description || '').replace(/\s*\([Ee]kuivalensi[^)]*\)/g, '').trim();

        return `
        <div onclick="window.workloadSelectLogCatalog('${c.id}')" class="p-3 cursor-pointer transition-all flex items-start justify-between gap-3 ${bgCls}">
            <div class="min-w-0 flex-1">
                <div class="flex items-start gap-2">
                    ${isSelected ? '<i class="fa-solid fa-check text-blue-600 dark:text-blue-400 text-xs mt-0.5 shrink-0"></i>' : '<span class="w-3 shrink-0"></span>'}
                    <div class="font-medium text-xs leading-snug text-slate-800 dark:text-white break-words flex-1">
                        ${escapeHTML(c.name)}
                    </div>
                </div>
                ${cleanDesc ? `<div class="text-[11px] text-slate-500 dark:text-slate-400 font-normal mt-1 leading-relaxed pl-5 break-words">${escapeHTML(cleanDesc)}</div>` : ''}
            </div>
            ${badgesRight}
        </div>`;
    }).join('');
}

export async function selectLogCatalog(catalogId) {
    const catSelect = el('log-input-catalog');
    if (catSelect) {
        catSelect.value = catalogId;
    }
    const catItem = (_catalog || []).find(c => c.id === catalogId) || STANDARD_WORKLOAD_CATALOG.find(c => c.id === catalogId);
    const searchInput = el('log-input-catalog-search');
    const jpBadgeEl = el('log-catalog-selected-jp-badge');
    if (searchInput && catItem) {
        searchInput.value = catItem.name;
        autoResizeWorkloadTextarea(searchInput);
    }
    if (jpBadgeEl && catItem) {
        const jp = getCatalogItemEquivalentJp(catItem);
        jpBadgeEl.textContent = jp > 0 ? `(${jp} JP)` : '';
    }

    // Auto-sync Tugas Pokok Guru di log jika sub-kegiatan yang dipilih berasal dari tugas pokok berbeda
    if (catItem && catItem.category_code && WORKLOAD_MAIN_DUTY_CONFIG[catItem.category_code]) {
        const dutySelect = el('log-input-main-duty');
        if (dutySelect && dutySelect.value !== catItem.category_code) {
            dutySelect.value = catItem.category_code;
            const logDate = el('log-input-date')?.value;
            let currentDayIdx = _selectedDayIndex;
            if (logDate && _weekStartDate) {
                const diff = Math.round((new Date(logDate + 'T00:00:00') - new Date(_weekStartDate + 'T00:00:00')) / (86400 * 1000));
                if (!isNaN(diff) && diff >= 0 && diff < 7) currentDayIdx = diff;
            }
            const isCurrentStudyDay = !isNaN(currentDayIdx) && currentDayIdx === _studyDayIndex;
            renderLogMainDutyCustomSelector(catItem.category_code, isCurrentStudyDay);
        }
    }

    closeLogCatalogDropdown();
    await onLogCatalogChange(true);
}

export function toggleLogCatalogDropdown(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    const panel = el('dropdown-log-catalog-panel');
    if (!panel) return;

    closePlanCatalogDropdown();
    closePlanMainDutyDropdown();
    closeLogMainDutyDropdown();
    const isClosed = panel.classList.contains('hidden');
    if (isClosed) {
        openLogCatalogDropdown();
        onFilterLogCatalog(true);
        const searchInput = el('log-input-catalog-search');
        if (searchInput) {
            searchInput.focus();
            searchInput.select();
        }
    } else {
        closeLogCatalogDropdown();
    }
}

export function openLogCatalogDropdown() {
    const panel = el('dropdown-log-catalog-panel');
    const chevron = el('icon-log-catalog-chevron');
    if (panel) panel.classList.remove('hidden');
    if (chevron) chevron.classList.add('rotate-180');
}

export function closeLogCatalogDropdown() {
    const panel = el('dropdown-log-catalog-panel');
    const chevron = el('icon-log-catalog-chevron');
    if (panel) panel.classList.add('hidden');
    if (chevron) chevron.classList.remove('rotate-180');

    const searchInput = el('log-input-catalog-search');
    const catSelect = el('log-input-catalog');
    if (searchInput && catSelect && catSelect.value) {
        const item = (_catalog || []).find(c => c.id === catSelect.value) || STANDARD_WORKLOAD_CATALOG.find(c => c.id === catSelect.value);
        if (item && (!searchInput.value || searchInput.value.trim() !== item.name)) {
            searchInput.value = item.name;
            autoResizeWorkloadTextarea(searchInput);
        }
    } else if (searchInput && (!catSelect || !catSelect.value)) {
        searchInput.value = '';
        autoResizeWorkloadTextarea(searchInput);
    }
}

// ========== MODAL: LOG REALISASI (PERMENDIKDASMEN NO. 11/2025) ==========
export function populateLogCatalogDropdownByDuty(dutyCode, selectedCatalogId = null, searchQuery = '') {
    const catSelect = el('log-input-catalog');
    const filtered = getFilteredCatalogByDuty(dutyCode, searchQuery);

    if (catSelect) {
        if (filtered.length === 0) {
            catSelect.innerHTML = '<option value="" disabled selected>— Tidak ada sub-kegiatan yang cocok —</option>';
        } else {
            const hasSelected = selectedCatalogId && filtered.some(c => c.id === selectedCatalogId);
            const promptOption = `<option value="" disabled${!hasSelected ? ' selected' : ''}>— Pilih Sub-Kegiatan —</option>`;
            catSelect.innerHTML = promptOption + filtered.map(c => {
                const jpLabel = formatCatalogJpLabel(c);
                const jpVal = getCatalogItemEquivalentJp(c);
                return `<option value="${c.id}" data-teaching="${c.is_teaching ? 1 : 0}" data-duration="${c.default_duration_minutes || 45}" data-jp="${jpVal}">${escapeHTML(c.name)}${jpLabel}</option>`;
            }).join('');

            if (hasSelected) {
                catSelect.value = selectedCatalogId;
            } else {
                catSelect.value = '';
            }
        }
    }

    const curId = catSelect?.value || null;
    const curItem = curId ? ((_catalog || []).find(c => c.id === curId) || STANDARD_WORKLOAD_CATALOG.find(c => c.id === curId)) : null;
    const searchInput = el('log-input-catalog-search');
    const jpBadgeEl = el('log-catalog-selected-jp-badge');
    if (searchInput) {
        searchInput.value = curItem ? curItem.name : '';
        autoResizeWorkloadTextarea(searchInput);
    }
    if (jpBadgeEl) {
        const jp = curItem ? getCatalogItemEquivalentJp(curItem) : 0;
        jpBadgeEl.textContent = jp > 0 ? `(${jp} JP)` : '';
    }

    const logDate = el('log-input-date')?.value;
    let currentDayIdx = _selectedDayIndex;
    if (logDate && _weekStartDate) {
        const diff = Math.round((new Date(logDate + 'T00:00:00') - new Date(_weekStartDate + 'T00:00:00')) / (86400 * 1000));
        if (!isNaN(diff) && diff >= 0 && diff < 7) currentDayIdx = diff;
    }
    const isCurrentStudyDay = !isNaN(currentDayIdx) && currentDayIdx === _studyDayIndex;
    renderLogMainDutyCustomSelector(dutyCode, isCurrentStudyDay);
    renderLogCatalogCustomOptions(filtered, curId);
}

export function onFilterLogCatalog() {
    const autoOpen = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : true;
    const searchInput = el('log-input-catalog-search');
    const placeholder = (searchInput?.getAttribute('placeholder') || '').trim().toLowerCase();
    const rawVal = (searchInput?.value || '').trim();
    const q = (placeholder && rawVal.toLowerCase() === placeholder) ? '' : rawVal;

    const dutySelect = el('log-input-main-duty');
    const selectedDuty = dutySelect?.value || 'PELAKSANAAN_KBM';
    const currentVal = el('log-input-catalog')?.value;

    const curItem = (_catalog || []).find(c => c.id === currentVal) || STANDARD_WORKLOAD_CATALOG.find(c => c.id === currentVal);
    const searchQuery = (curItem && curItem.name.toLowerCase() === q.trim().toLowerCase()) ? '' : q;

    const filtered = getFilteredCatalogByDuty(selectedDuty, searchQuery);
    if (autoOpen) {
        openLogCatalogDropdown();
    }
    if (searchInput) {
        autoResizeWorkloadTextarea(searchInput);
    }
    renderLogCatalogCustomOptions(filtered, currentVal);
}

export function resetLogCatalogSearch() {
    const searchInput = el('log-input-catalog-search');
    if (searchInput) searchInput.value = '';
    onFilterLogCatalog(true);
}

function onLogMainDutyChange() {
    const dutySelect = el('log-input-main-duty');
    const selectedDuty = dutySelect?.value || 'PELAKSANAAN_KBM';
    populateLogCatalogDropdownByDuty(selectedDuty);
    closeLogCatalogDropdown();
    onLogCatalogChange(true);
}

async function onLogCatalogChange(autoAdjustTime = false) {
    const catSelect = el('log-input-catalog');
    const teachingWrapper = el('log-teaching-wrapper');
    if (!catSelect) {
        if (teachingWrapper) teachingWrapper.classList.add('hidden');
        return;
    }
    const selected = catSelect.options[catSelect.selectedIndex];
    const isTeaching = selected?.dataset?.teaching === '1';
    const jpVal = parseInt(selected?.dataset?.jp || '0', 10);

    if (teachingWrapper) {
        // Selalu sembunyikan sesuai instruksi UX (durasi JP/menit riil sudah terpampang di atasnya, tugas tambahan tidak relevan di form realisasi)
        teachingWrapper.classList.add('hidden');
        const jpInput = el('log-input-jp');
        if (jpInput) {
            if (jpVal > 0) {
                jpInput.value = jpVal;
            } else {
                const start = el('log-input-start')?.value;
                const end = el('log-input-end')?.value;
                if (start && end) {
                    const mins = calcEffective(start, end);
                    jpInput.value = Math.max(1, Math.round(mins / 45));
                } else {
                    jpInput.value = '2';
                }
            }
        }
    }

    if (autoAdjustTime) {
        const start = el('log-input-start')?.value;
        const durMin = Number(selected?.dataset?.duration || 45);
        const endInput = el('log-input-end');
        const currentEnd = (endInput?.value || '').trim();

        // SSOT: Jam akhir murni sesuai input guru / alokasi awal. Jangan pernah ubah jika sudah terisi dan tanpa popup konfirmasi.
        if (!currentEnd && start && durMin > 0 && endInput) {
            endInput.value = calculateEndTimeWithBreaks(start, durMin);
        }
        updateLogMinutesPreview();
    }

    // Periksa status Hari Belajar Guru (HBG)
    const logDate = el('log-input-date')?.value;
    let currentDayIdx = _selectedDayIndex;
    if (logDate && _weekStartDate) {
        const diff = Math.round((new Date(logDate + 'T00:00:00') - new Date(_weekStartDate + 'T00:00:00')) / (86400 * 1000));
        if (!isNaN(diff) && diff >= 0 && diff < 7) currentDayIdx = diff;
    }
    const isCurrentStudyDay = !isNaN(currentDayIdx) && currentDayIdx === _studyDayIndex;
    const studyDayBanner = el('log-study-day-banner');
    if (studyDayBanner) {
        const status = el('log-input-status-execution')?.value;
        const isDutyVisible = status === 'diganti' || el('log-input-is-unplanned')?.value === '1';
        studyDayBanner.classList.toggle('hidden', !(isDutyVisible && isCurrentStudyDay));
    }

    const status = el('log-input-status-execution')?.value;
    const titleInput = el('log-input-title');
    if (titleInput && (status === 'diganti' || el('log-input-is-unplanned')?.value === '1')) {
        const selectedCat = (_catalog || []).find(c => c.id === catSelect?.value);
        if (selectedCat && (!titleInput.value || titleInput.dataset.autoFilled === '1')) {
            titleInput.placeholder = `Contoh: ${selectedCat.name}`;
        }
    }

    // Periksa apakah kategori yang dipilih pada form realisasi adalah Tugas Tambahan Waka
    const catId = catSelect?.value;
    const isWaka = isWakaCatalogId(catId);
    const logWakaBanner = el('log-waka-banner');
    const logWakaDutyContainer = el('container-log-waka-duty-picker');

    if (isWaka && (status === 'diganti' || el('log-input-is-unplanned')?.value === '1')) {
        const wakaType = getWakaTypeFromCatalogId(catId);
        const dutyInfo = getWakaMainDutyInfo(wakaType);

        if (logWakaBanner) {
            const bTitle = el('log-waka-banner-title');
            const bText = el('log-waka-banner-text');
            if (bTitle) bTitle.textContent = `${dutyInfo.title}:`;
            if (bText) bText.textContent = dutyInfo.description;
            logWakaBanner.classList.remove('hidden');
        }
        if (logWakaDutyContainer) {
            logWakaDutyContainer.classList.remove('hidden');
            renderLogWakaDutyDropdown(wakaType);
        }
    } else {
        if (logWakaBanner) logWakaBanner.classList.add('hidden');
        if (logWakaDutyContainer) {
            logWakaDutyContainer.classList.add('hidden');
            if (typeof closeLogWakaDutyDropdown === 'function') closeLogWakaDutyDropdown();
        }
    }
}

export function syncLogStatusOptions(isSlotReplacement = false, selectedValue = 'terlaksana', isKbmPlan = false) {
    const statusSelect = el('log-input-status-execution');
    if (!statusSelect) return;

    if (isSlotReplacement) {
        // Khusus slot sisa karena rencana parsial/lebih singkat:
        // Opsi terlaksana penuh dan tidak terlaksana ditiadakan, otomatis menjadi diganti kegiatan lain
        statusSelect.innerHTML = '<option value="diganti" selected>Diganti Kegiatan Lain (Pengganti Rencana)</option>';
        statusSelect.value = 'diganti';
    } else if (isKbmPlan) {
        // Khusus KBM Terencana: Opsi terlaksana manual ditiadakan demi integritas data jurnal digital
        const currentVal = (selectedValue === 'terlaksana') ? 'tidak_terlaksana' : (selectedValue || 'tidak_terlaksana');
        statusSelect.innerHTML =
            '<option value="tidak_terlaksana">Tidak Terlaksana (0 Menit)</option>' +
            '<option value="diganti">Diganti Kegiatan Lain</option>';
        statusSelect.value = ['tidak_terlaksana', 'diganti'].includes(currentVal) ? currentVal : 'tidak_terlaksana';
    } else {
        const currentVal = selectedValue || statusSelect.value || 'terlaksana';
        statusSelect.innerHTML =
            '<option value="terlaksana">Terlaksana Penuh</option>' +
            '<option value="tidak_terlaksana">Tidak Terlaksana (0 Menit)</option>' +
            '<option value="diganti">Diganti Kegiatan Lain</option>';
        if (['terlaksana', 'tidak_terlaksana', 'diganti'].includes(currentVal)) {
            statusSelect.value = currentVal;
        } else {
            statusSelect.value = 'terlaksana';
        }
    }
}

export function openLogModal(planActivityId = null, isUnplanned = false, defaultStatus = 'terlaksana', dayIndex = null, options = {}) {
    const activeVersion = _weekData?.active_version;
    if (!activeVersion || activeVersion.status !== 'approved') {
        const isAuto = _policy?.require_plan_approval === 0;
        const term = isAuto ? 'difinalisasi' : 'disetujui Kepala Sekolah';
        showToast(`Rencana kerja mingguan belum ${term}. Pelaporan realisasi hanya dapat dilakukan setelah rencana kerja ${term}.`, 'warning');
        return;
    }

    const modal = el('modal-workload-log');
    if (!modal) return;

    closeLogCatalogDropdown();
    if (typeof closeLogWakaDutyDropdown === 'function') closeLogWakaDutyDropdown();
    if (typeof closeLogMainDutyDropdown === 'function') closeLogMainDutyDropdown();
    const logWakaSearch = el('log-input-waka-duty-search');
    if (logWakaSearch) logWakaSearch.value = '';

    // Sembunyikan tombol hapus karena ini mode buat laporan baru
    const btnDel = el('btn-delete-workload-log');
    if (btnDel) btnDel.classList.add('hidden');

    const seg = planActivityId && _weekData?.segments ? _weekData.segments.find(s => s.activity_id === planActivityId) : null;
    const act = planActivityId && _weekData?.activities ? _weekData.activities.find(a => a.id === planActivityId) : null;
    const isKbmPlan = !isUnplanned && Boolean(planActivityId) && (isTeachingActivity(seg) || isTeachingActivity(act));

    if (planActivityId && seg) {
        modal.dataset.planDuration = String(seg.planned_minutes || calcEffective(seg.start_time, seg.end_time) || 0);
        modal.dataset.planStart = seg.start_time || '';
        modal.dataset.planEnd = seg.end_time || '';
    } else {
        delete modal.dataset.planDuration;
        delete modal.dataset.planStart;
        delete modal.dataset.planEnd;
    }

    // Reset judul modal & tombol submit ke mode lapor baru
    const modalTitleEl = el('modal-log-title');
    if (modalTitleEl) {
        modalTitleEl.innerHTML = isKbmPlan
            ? '<i class="fa-solid fa-clipboard-list text-blue-500"></i> Lapor KBM Tidak Terlaksana / Diganti'
            : '<i class="fa-solid fa-clipboard-check text-emerald-500"></i> Lapor Realisasi Pekerjaan';
    }
    const submitBtnLabel = el('btn-submit-workload-log-label');
    if (submitBtnLabel) {
        submitBtnLabel.textContent = isKbmPlan ? 'Simpan Laporan Kendala/Pengganti' : 'Simpan Laporan';
    }

    const isSlotReplacement = Boolean(options?.isSlotReplacement);
    let effectiveStatus = isSlotReplacement ? 'diganti' : defaultStatus;
    if (isKbmPlan && effectiveStatus === 'terlaksana') {
        effectiveStatus = 'tidak_terlaksana';
    }
    syncLogStatusOptions(isSlotReplacement, effectiveStatus, isKbmPlan);

    // Tampilkan / sembunyikan banner integritas KBM
    const kbmNoticeEl = el('log-kbm-notice');
    if (kbmNoticeEl) {
        if (isKbmPlan) {
            kbmNoticeEl.classList.remove('hidden');
        } else {
            kbmNoticeEl.classList.add('hidden');
        }
    }

    el('log-input-id').value = '';
    el('log-input-plan-id').value = planActivityId || '';
    const actualIsUnplanned = isUnplanned || !planActivityId;
    el('log-input-is-unplanned').value = actualIsUnplanned ? '1' : '0';

    const effectiveDayIdx = (dayIndex != null) ? dayIndex : _selectedDayIndex;
    el('log-input-date').value = dateOfDay(_weekStartDate, effectiveDayIdx);
    el('log-input-status-execution').value = effectiveStatus;
    el('log-input-title').value = '';
    el('log-input-start').value = options?.customStart || '';
    el('log-input-end').value = options?.customEnd || '';
    el('log-input-obstacle').value = '';
    el('log-input-substitute').value = '';
    el('log-input-output').value = '';
    el('log-input-evidence').value = '';
    workloadSyncEvidenceButtons();
    _currentLogPhotos = [];
    renderEvidencePhotosGrid();
    el('log-preview-minutes').textContent = '0 menit';

    // Banner info konteks pengisi sisa waktu kerja
    const contextNoticeEl = el('log-context-notice');
    const contextNoticeTextEl = el('log-context-notice-text');
    if (options?.contextNotice || (options?.customStart && options?.customEnd && options?.unfulfilledMins)) {
        if (contextNoticeEl) {
            contextNoticeEl.classList.remove('hidden');
            if (contextNoticeTextEl) {
                contextNoticeTextEl.innerHTML = options.contextNotice || `Waktu diset otomatis ke <strong>${options.customStart}–${options.customEnd} (${options.unfulfilledMins} menit)</strong> sebagai kegiatan pengganti sisa jam rencana sebelumnya.`;
            }
        }
        if (modalTitleEl) {
            modalTitleEl.innerHTML = isSlotReplacement
                ? '<i class="fa-solid fa-arrows-rotate text-blue-500"></i> Lapor Kegiatan Pengganti (Sisa Jam Rencana)'
                : '<i class="fa-solid fa-file-circle-plus text-indigo-500"></i> Lapor Tugas Baru (Pengisi Sisa Jam)';
        }
        if (submitBtnLabel) {
            submitBtnLabel.textContent = isSlotReplacement ? 'Simpan Kegiatan Pengganti' : 'Simpan Tugas Baru';
        }
        el('log-input-plan-id').value = '';
        el('log-input-is-unplanned').value = '1';
    } else {
        if (contextNoticeEl) {
            contextNoticeEl.classList.add('hidden');
        }
    }

    if (options?.customStart || options?.customEnd) {
        updateLogMinutesPreview();
    }

    const searchInput = el('log-input-catalog-search');
    if (searchInput) searchInput.value = '';

    let initialDuty = 'PELAKSANAAN_KBM';
    let initialCatalogId = null;

    // Pre-fill dari rencana jika ada
    let isPrematureForPlan = false;
    if (planActivityId && _weekData) {
        const seg = (_weekData.segments || []).find(s => s.activity_id === planActivityId);
        const act = (_weekData.activities || []).find(a => a.id === planActivityId);
        if (seg) {
            const segDate = seg.date || dateOfDay(_weekStartDate, effectiveDayIdx);
            const reportCheck = canReportActivityNow(segDate, seg.end_time, 5);
            if (!reportCheck.allowed) {
                // Waktu belum berjalan/lewat -> beralih ke mode draf agar guru bisa upload foto & simpan draf
                isPrematureForPlan = true;
                defaultStatus = 'draft';
            }

            if (seg.date) {
                el('log-input-date').value = seg.date;
            }
            el('log-input-title').value = seg.activity_title || seg.description || '';
            el('log-input-start').value = seg.start_time || '';
            el('log-input-end').value = seg.end_time || '';
            updateLogMinutesPreview();
        }
        if (act?.category_code) {
            initialDuty = act.category_code;
        } else if (seg?.catalog_id) {
            const catItem = (_catalog || []).find(c => c.id === seg.catalog_id);
            if (catItem?.category_code) initialDuty = catItem.category_code;
        }
        initialCatalogId = seg?.catalog_id || act?.catalog_id || null;
        const logJpInput = el('log-input-jp');
        if (logJpInput) {
            logJpInput.value = seg?.jp_count != null ? seg.jp_count : (seg?.is_teaching ? 2 : 2);
        }
    }

    const logAsgSelect = el('log-input-assignment');
    if (logAsgSelect) {
        logAsgSelect.innerHTML = '<option value="">(Tidak Ada / Kegiatan Reguler)</option>' +
            (_assignments || []).filter(a => a.is_active).map(a =>
                `<option value="${a.id}">${a.duty_name} (${a.equivalent_jp || 0} JP-Eq)</option>`
            ).join('');
        const act = planActivityId && _weekData ? (_weekData.activities || []).find(a => a.id === planActivityId) : null;
        logAsgSelect.value = act?.assignment_id || '';
    }

    const dutySelect = el('log-input-main-duty');
    if (dutySelect) dutySelect.value = initialDuty;
    populateLogCatalogDropdownByDuty(initialDuty, initialCatalogId);
    if (typeof renderLogMainDutyDropdown === 'function') renderLogMainDutyDropdown();
    onLogCatalogChange(false);

    const btnDraft = el('btn-draft-workload-log');
    const btnSubmit = el('btn-submit-workload-log');
    const statusSelect = el('log-input-status-execution');

    if (!isSlotReplacement && (defaultStatus === 'draft' || isPrematureForPlan)) {
        if (modalTitleEl) {
            modalTitleEl.innerHTML = '<i class="fa-solid fa-file-pen text-amber-500"></i> Draf Realisasi Kegiatan';
        }
        if (btnDraft) {
            btnDraft.classList.remove('hidden');
            const span = btnDraft.querySelector('span');
            if (span) span.textContent = 'Simpan Draf';
        }
        if (btnSubmit) {
            btnSubmit.classList.add('hidden');
        }
        if (statusSelect) {
            let draftOpt = statusSelect.querySelector('option[value="draft"]');
            if (!draftOpt) {
                draftOpt = document.createElement('option');
                draftOpt.value = 'draft';
                draftOpt.textContent = 'Draf (Sedang Berlangsung)';
                statusSelect.appendChild(draftOpt);
            }
            statusSelect.value = effectiveStatus === 'diganti' ? 'diganti' : 'draft';
            statusSelect.disabled = false;
            for (const option of statusSelect.options) {
                option.disabled = !['draft', 'diganti'].includes(option.value);
            }
        }
    } else {
        // Waktu sudah lewat atau mode pengganti sisa jam kerja
        if (btnDraft) {
            btnDraft.classList.add('hidden');
        }
        if (btnSubmit) {
            btnSubmit.classList.remove('hidden');
            if (submitBtnLabel) {
                submitBtnLabel.textContent = isSlotReplacement ? 'Simpan Kegiatan Pengganti' : 'Simpan Laporan';
            }
        }
        if (statusSelect) {
            statusSelect.disabled = false;
            const draftOpt = statusSelect.querySelector('option[value="draft"]');
            if (draftOpt) draftOpt.remove();
            statusSelect.value = effectiveStatus;
        }
    }

    onStatusExecutionChange();
    if (typeof applyManagerReadOnlyLogButtons === 'function') applyManagerReadOnlyLogButtons();
    modal.classList.remove('hidden');

    if (effectiveStatus === 'diganti') {
        setTimeout(() => el('log-input-substitute')?.focus(), 60);
    } else if (effectiveStatus === 'tidak_terlaksana') {
        setTimeout(() => el('log-input-obstacle')?.focus(), 60);
    }
}

export function openAddUnplannedForSlot(dayIndex, startTime, endTime, unfulfilledMins, slotTitle = '') {
    const titleInfo = slotTitle ? ` untuk alokasi "${escapeHTML(slotTitle)}"` : '';
    openLogModal(null, true, 'diganti', dayIndex, {
        customStart: startTime,
        customEnd: endTime,
        unfulfilledMins: unfulfilledMins,
        slotTitle: slotTitle,
        isSlotReplacement: true,
        contextNotice: `Waktu diset otomatis ke <strong>${startTime}–${endTime} (${unfulfilledMins} menit)</strong>${titleInfo} sebagai <strong>kegiatan pengganti sisa jam rencana</strong> yang belum terpenuhi.`
    });
}

export function isLogLockedByManualVerification(log) {
    if (!log) return false;
    if (log.is_locked === 1 || _weekData?.week?.is_locked === 1) return true;

    // Jika kebijakan alur persetujuan sekolah Mode Mandiri (require_log_verification === 0),
    // verifikasi berlangsung otomatis dan guru berhak mengedit kembali
    if (_policy && Number(_policy.require_log_verification) === 0) {
        return false;
    }

    // Jika log diverifikasi otomatis oleh sistem, guru tetap bisa mengedit
    if (log.verified_by_uid === 'system_auto_policy') {
        return false;
    }

    // Terkunci HANYA jika diverifikasi manual oleh Kepala Sekolah / Pejabat Penilai
    return log.verification_status === 'verified' && Boolean(log.verified_by_uid);
}

export function openEditLogModal(logId) {
    if (!logId || !_weekData) return;

    const modal = el('modal-workload-log');
    if (!modal) return;

    el('log-context-notice')?.classList.add('hidden');
    closeLogCatalogDropdown();
    if (typeof closeLogWakaDutyDropdown === 'function') closeLogWakaDutyDropdown();
    if (typeof closeLogMainDutyDropdown === 'function') closeLogMainDutyDropdown();
    const logWakaSearch = el('log-input-waka-duty-search');
    if (logWakaSearch) logWakaSearch.value = '';

    const log = (_weekData.logs || []).find(l => l.id === logId);
    if (!log) {
        showToast('Data laporan realisasi tidak ditemukan', 'error');
        return;
    }

    if (isLogLockedByManualVerification(log)) {
        if (log.is_locked === 1 || _weekData?.week?.is_locked === 1) {
            showToast('Minggu kerja atau laporan ini telah dikunci dan tidak dapat diubah.', 'warning');
        } else {
            showToast('Laporan ini telah diverifikasi oleh Kepala Sekolah dan tidak dapat diubah.', 'warning');
        }
        return;
    }

    el('log-input-id').value = log.id;

    const planLink = (_weekData.plan_links || []).find(pl => pl.work_log_id === log.id);
    const planActId = planLink?.plan_activity_id || log.plan_activity_id || '';
    const planSeg = planActId ? (_weekData.segments || []).find(s => s.activity_id === planActId) : null;
    el('log-input-plan-id').value = planActId;

    if (planActId && planSeg) {
        modal.dataset.planDuration = String(planSeg.planned_minutes || calcEffective(planSeg.start_time, planSeg.end_time) || 0);
        modal.dataset.planStart = planSeg.start_time || '';
        modal.dataset.planEnd = planSeg.end_time || '';
    } else {
        delete modal.dataset.planDuration;
        delete modal.dataset.planStart;
        delete modal.dataset.planEnd;
    }

    const isUnplanned = log.is_unplanned === 1 || !planActId;
    el('log-input-is-unplanned').value = isUnplanned ? '1' : '0';

    el('log-input-date').value = log.date || dateOfDay(_weekStartDate, _selectedDayIndex);

    let statusExec = log.status_execution || 'terlaksana';
    if (statusExec === 'draft' && planLink?.link_type === 'substitution') {
        statusExec = 'diganti';
    }
    if (!statusExec) {
        if (planLink?.link_type === 'substitution') statusExec = 'diganti';
        else statusExec = 'terlaksana';
    }
    const planAct = planActId ? (_weekData?.activities || []).find(a => a.id === planActId) : null;
    const isKbmPlan = !isUnplanned && Boolean(planActId) && (isTeachingActivity(planSeg) || isTeachingActivity(planAct));
    if (typeof syncLogStatusOptions === 'function') syncLogStatusOptions(false, statusExec, isKbmPlan);
    el('log-input-status-execution').value = statusExec;

    const kbmNoticeEl = el('log-kbm-notice');
    if (kbmNoticeEl) {
        if (isKbmPlan) {
            kbmNoticeEl.classList.remove('hidden');
        } else {
            kbmNoticeEl.classList.add('hidden');
        }
    }

    el('log-input-title').value = log.title || '';

    const logSegs = (_weekData.log_segments || []).filter(ls => ls.work_log_id === log.id);
    const logSeg = logSegs[0] || null;
    const logStartTime = logSegs.length > 0 ? logSegs[0].start_time : (log.start_time || '');
    const logEndTime = logSegs.length > 0 ? logSegs[logSegs.length - 1].end_time : (log.end_time || '');
    el('log-input-start').value = logStartTime;
    el('log-input-end').value = logEndTime;

    let obstacleVal = log.obstacle_notes || '';
    if (!obstacleVal && log.output_summary && log.output_summary.includes('[Kendala:')) {
        const match = log.output_summary.match(/\[Kendala:\s*([^\]]+)\]/);
        if (match) obstacleVal = match[1];
    }
    el('log-input-obstacle').value = obstacleVal;
    el('log-input-substitute').value = log.substitute_notes || planLink?.reason_notes || '';

    let outputVal = log.output_summary || '';
    if (outputVal.includes('[Kendala:')) {
        outputVal = outputVal.replace(/\[Kendala:[^\]]+\]\s*/, '').trim();
    }
    el('log-input-output').value = outputVal;
    const rawEvidence = (log.evidence_url || '').trim();
    const isJsonEvidence = (rawEvidence.startsWith('[') && rawEvidence.endsWith(']')) || (rawEvidence.startsWith('{') && rawEvidence.endsWith('}'));
    el('log-input-evidence').value = isJsonEvidence ? '' : rawEvidence;
    workloadSyncEvidenceButtons();
    _currentLogPhotos = parseEvidencePhotos(rawEvidence);
    renderEvidencePhotosGrid();

    updateLogMinutesPreview();

    const searchInput = el('log-input-catalog-search');
    if (searchInput) searchInput.value = '';

    let catalogId = log.catalog_id;
    let dutyCode = 'PELAKSANAAN_KBM';

    if (!catalogId && planActId) {
        catalogId = planSeg?.catalog_id;
    }

    if (catalogId) {
        const standardList = typeof STANDARD_WORKLOAD_CATALOG !== 'undefined' && Array.isArray(STANDARD_WORKLOAD_CATALOG) ? STANDARD_WORKLOAD_CATALOG : [];
        const catItem = (_catalog || []).find(c => c && c.id === catalogId) || standardList.find(c => c && c.id === catalogId);
        const dutyConfig = typeof WORKLOAD_MAIN_DUTY_CONFIG !== 'undefined' && WORKLOAD_MAIN_DUTY_CONFIG ? WORKLOAD_MAIN_DUTY_CONFIG : null;
        if (catItem?.category_code && (!dutyConfig || dutyConfig[catItem.category_code])) {
            dutyCode = catItem.category_code;
        }
    }

    const dutySelect = el('log-input-main-duty');
    if (dutySelect) dutySelect.value = dutyCode;
    populateLogCatalogDropdownByDuty(dutyCode, catalogId);
    if (typeof renderLogMainDutyDropdown === 'function') renderLogMainDutyDropdown();

    const logAsgSelect = el('log-input-assignment');
    if (logAsgSelect) {
        logAsgSelect.innerHTML = '<option value="">(Tidak Ada / Kegiatan Reguler)</option>' +
            (_assignments || []).filter(a => a.is_active).map(a =>
                `<option value="${a.id}">${a.duty_name} (${a.equivalent_jp || 0} JP-Eq)</option>`
            ).join('');
        const planAct = planActId ? (_weekData.activities || []).find(a => a.id === planActId) : null;
        logAsgSelect.value = log.assignment_id || planAct?.assignment_id || '';
    }

    const logJpInput = el('log-input-jp');
    if (logJpInput) {
        if (log.jp_count != null) {
            logJpInput.value = log.jp_count;
        } else if (planSeg?.jp_count != null) {
            logJpInput.value = planSeg.jp_count;
        } else {
            const start = logStartTime || log.start_time;
            const end = logEndTime || log.end_time;
            if (start && end) {
                const mins = calcEffective(start, end);
                logJpInput.value = Math.max(1, Math.round(mins / 45));
            } else {
                logJpInput.value = '2';
            }
        }
    }
    onLogCatalogChange(false);

    const modalTitleEl = el('modal-log-title');
    const submitBtnLabel = el('btn-submit-workload-log-label');
    const btnDraft = el('btn-draft-workload-log');
    const btnSubmit = el('btn-submit-workload-log');
    const statusSelect = el('log-input-status-execution');

    const targetEndTime = logEndTime || log.end_time || planSeg?.end_time;
    const targetDate = log.date || dateOfDay(_weekStartDate, _selectedDayIndex);
    const reportCheck = canReportActivityNow(targetDate, targetEndTime, 5);
    const isPremature = !reportCheck.allowed;

    if (isPremature) {
        if (modalTitleEl) {
            modalTitleEl.innerHTML = '<i class="fa-solid fa-file-pen text-amber-500"></i> Edit Draf Realisasi';
        }
        if (btnDraft) {
            btnDraft.classList.remove('hidden');
            const span = btnDraft.querySelector('span');
            if (span) span.textContent = 'Perbarui Draf';
        }
        if (btnSubmit) {
            btnSubmit.classList.add('hidden');
        }
        if (statusSelect) {
            let draftOpt = statusSelect.querySelector('option[value="draft"]');
            if (!draftOpt) {
                draftOpt = document.createElement('option');
                draftOpt.value = 'draft';
                draftOpt.textContent = 'Draf (Sedang Berlangsung)';
                statusSelect.appendChild(draftOpt);
            }
            statusSelect.value = statusExec === 'diganti' ? 'diganti' : 'draft';
            statusSelect.disabled = false;
            for (const option of statusSelect.options) {
                option.disabled = !['draft', 'diganti'].includes(option.value);
            }
        }
    } else {
        // Waktu sudah lewat: "tapi kalau waktu sudah lewat, simpan draf jgn dimunculkan, ckup tombol perubahan itu aja"
        if (btnDraft) {
            btnDraft.classList.add('hidden');
        }
        if (btnSubmit) {
            btnSubmit.classList.remove('hidden');
            if (submitBtnLabel) {
                if (log.status_execution === 'draft') {
                    submitBtnLabel.textContent = 'Selesaikan Laporan';
                } else {
                    submitBtnLabel.textContent = 'Perbarui Laporan';
                }
            }
        }
        if (statusSelect) {
            statusSelect.disabled = false;
            const draftOpt = statusSelect.querySelector('option[value="draft"]');
            if (draftOpt) draftOpt.remove();
            if (log.status_execution === 'draft') {
                statusSelect.value = statusExec === 'diganti' ? 'diganti' : (isKbmPlan ? 'tidak_terlaksana' : 'terlaksana');
            } else {
                statusSelect.value = statusExec;
            }
        }
        if (modalTitleEl) {
            if (log.status_execution === 'draft') {
                modalTitleEl.innerHTML = '<i class="fa-solid fa-check-double text-emerald-500"></i> Selesaikan Laporan Realisasi';
            } else {
                modalTitleEl.innerHTML = '<i class="fa-solid fa-pen-to-square text-emerald-500"></i> Edit Laporan Realisasi';
            }
        }
    }

    const isJournalKbmLog = (log.id || '').startsWith('wl_jurnal_') || (isKbmPlan && log.status_execution === 'terlaksana');
    const startInp = el('log-input-start');
    const endInp = el('log-input-end');
    if (isJournalKbmLog) {
        if (modalTitleEl) {
            modalTitleEl.innerHTML = '<i class="fa-solid fa-pen-to-square text-indigo-500"></i> Perbarui Realisasi KBM (Jurnal Digital)';
        }
        if (startInp) {
            startInp.readOnly = true;
            startInp.classList.add('bg-slate-100', 'dark:bg-slate-800/80', 'cursor-not-allowed');
            startInp.title = 'Jam tatap muka KBM dikunci otomatis sesuai data Jurnal Mengajar';
        }
        if (endInp) {
            endInp.readOnly = true;
            endInp.classList.add('bg-slate-100', 'dark:bg-slate-800/80', 'cursor-not-allowed');
            endInp.title = 'Jam tatap muka KBM dikunci otomatis sesuai data Jurnal Mengajar';
        }
        if (statusSelect) {
            statusSelect.innerHTML = '<option value="terlaksana" selected>Terlaksana (Jurnal Mengajar Digital)</option>';
            statusSelect.value = 'terlaksana';
            statusSelect.disabled = true;
        }
        if (btnDraft) btnDraft.classList.add('hidden');
        if (btnSubmit) {
            btnSubmit.classList.remove('hidden');
            if (submitBtnLabel) submitBtnLabel.textContent = 'Simpan Perubahan';
        }
        if (kbmNoticeEl) {
            kbmNoticeEl.classList.remove('hidden');
            const noticeText = kbmNoticeEl.querySelector('.text-xs');
            if (noticeText) {
                noticeText.innerHTML = `
                    <span class="font-bold flex items-center gap-1.5">
                        <span>Integritas Data: Realisasi KBM Terencana</span>
                        <span class="text-[9px] px-1.5 py-0.2 rounded bg-blue-200 dark:bg-blue-800 text-blue-900 dark:text-blue-100 font-extrabold uppercase">Otomatis dari Jurnal</span>
                    </span>
                    <div class="mt-1 leading-relaxed text-[11px] text-blue-700 dark:text-blue-300">
                        Data jam dan kehadiran KBM dikunci otomatis dari Jurnal Mengajar Digital. Anda dapat menambahkan atau memperbarui <strong>foto bukti dokumentasi</strong> dan <strong>catatan hasil pembelajaran</strong> di bawah ini.
                    </div>
                `;
            }
        }
    } else {
        if (startInp) {
            startInp.readOnly = false;
            startInp.classList.remove('bg-slate-100', 'dark:bg-slate-800/80', 'cursor-not-allowed');
            startInp.title = '';
        }
        if (endInp) {
            endInp.readOnly = false;
            endInp.classList.remove('bg-slate-100', 'dark:bg-slate-800/80', 'cursor-not-allowed');
            endInp.title = '';
        }
    }

    // Tampilkan tombol hapus karena dalam mode edit laporan
    const btnDel = el('btn-delete-workload-log');
    if (btnDel) btnDel.classList.remove('hidden');

    onStatusExecutionChange();
    if (typeof applyManagerReadOnlyLogButtons === 'function') applyManagerReadOnlyLogButtons();
    modal.classList.remove('hidden');
}

function closeLogModal() {
    closeLogCatalogDropdown();
    if (typeof closeLogWakaDutyDropdown === 'function') closeLogWakaDutyDropdown();
    if (typeof closeLogMainDutyDropdown === 'function') closeLogMainDutyDropdown();
    const logWakaSearch = el('log-input-waka-duty-search');
    if (logWakaSearch) logWakaSearch.value = '';
    el('log-context-notice')?.classList.add('hidden');
    el('btn-delete-workload-log')?.classList.add('hidden');
    el('btn-draft-workload-log')?.classList.add('hidden');
    el('btn-submit-workload-log')?.classList.remove('hidden');
    const startInp = el('log-input-start');
    if (startInp) {
        startInp.readOnly = false;
        startInp.classList.remove('bg-slate-100', 'dark:bg-slate-800/80', 'cursor-not-allowed');
        startInp.title = '';
    }
    const endInp = el('log-input-end');
    if (endInp) {
        endInp.readOnly = false;
        endInp.classList.remove('bg-slate-100', 'dark:bg-slate-800/80', 'cursor-not-allowed');
        endInp.title = '';
    }
    const kbmNoticeEl = el('log-kbm-notice');
    if (kbmNoticeEl) kbmNoticeEl.classList.add('hidden');
    if (typeof syncLogStatusOptions === 'function') syncLogStatusOptions(false, 'terlaksana');
    const statusSelect = el('log-input-status-execution');
    if (statusSelect) {
        statusSelect.disabled = false;
        const draftOpt = statusSelect.querySelector('option[value="draft"]');
        if (draftOpt) draftOpt.remove();
    }
    el('modal-workload-log')?.classList.add('hidden');
}

function onStatusExecutionChange() {
    const status = el('log-input-status-execution')?.value;
    const isUnplanned = el('log-input-is-unplanned')?.value === '1';
    const timeSection = el('log-time-section');
    const durationBox = el('log-duration-preview-box');
    const obstacleWrapper = el('log-obstacle-wrapper');
    const substituteWrapper = el('log-substitute-wrapper');
    const dutyCatalogWrapper = el('log-duty-catalog-wrapper');
    const titleWrapper = el('log-title-wrapper');
    const titleInput = el('log-input-title');

    if (status === 'tidak_terlaksana') {
        titleWrapper?.classList.remove('hidden');
        if (titleInput) titleInput.required = false;
        timeSection?.classList.add('hidden');
        durationBox?.classList.add('hidden');
        obstacleWrapper?.classList.remove('hidden');
        substituteWrapper?.classList.add('hidden');
        dutyCatalogWrapper?.classList.add('hidden');
        el('log-waka-banner')?.classList.add('hidden');
        el('container-log-waka-duty-picker')?.classList.add('hidden');
        if (typeof closeLogWakaDutyDropdown === 'function') closeLogWakaDutyDropdown();
    } else if (status === 'diganti') {
        // Saat diganti kegiatan lain: sembunyikan form uraian pekerjaan atas karena sudah ada form pengganti di bawah
        titleWrapper?.classList.add('hidden');
        if (titleInput) titleInput.required = false;
        timeSection?.classList.remove('hidden');
        durationBox?.classList.remove('hidden');
        obstacleWrapper?.classList.add('hidden');
        substituteWrapper?.classList.remove('hidden');
        dutyCatalogWrapper?.classList.remove('hidden');

        const dutySelect = el('log-input-main-duty');
        const selectedDuty = dutySelect?.value || 'PELAKSANAAN_KBM';
        if (!el('log-input-catalog')?.options?.length) {
            populateLogCatalogDropdownByDuty(selectedDuty);
        }
        onLogCatalogChange(false);
    } else { // 'terlaksana' / status lainnya
        titleWrapper?.classList.remove('hidden');
        if (titleInput) {
            titleInput.required = true;
            // Jika kosong, pulihkan dari rencana awal jika ada
            if (!titleInput.value) {
                const planId = el('log-input-plan-id')?.value;
                const seg = planId && _weekData?.segments ? _weekData.segments.find(s => s.activity_id === planId) : null;
                if (seg) titleInput.value = seg.activity_title || seg.description || '';
            }
        }
        timeSection?.classList.remove('hidden');
        durationBox?.classList.remove('hidden');
        obstacleWrapper?.classList.add('hidden');
        substituteWrapper?.classList.add('hidden');
        if (isUnplanned) {
            dutyCatalogWrapper?.classList.remove('hidden');
            const dutySelect = el('log-input-main-duty');
            const selectedDuty = dutySelect?.value || 'PELAKSANAAN_KBM';
            if (!el('log-input-catalog')?.options?.length) {
                populateLogCatalogDropdownByDuty(selectedDuty);
            }
            onLogCatalogChange(false);
        } else {
            dutyCatalogWrapper?.classList.add('hidden');
            el('log-waka-banner')?.classList.add('hidden');
            el('container-log-waka-duty-picker')?.classList.add('hidden');
            if (typeof closeLogWakaDutyDropdown === 'function') closeLogWakaDutyDropdown();
        }
    }
    updateLogMinutesPreview();
}

function updateLogMinutesPreview() {
    const startInput = el('log-input-start');
    const endInput = el('log-input-end');
    const submitBtn = el('btn-submit-workload-log');
    const alertBox = el('log-time-overlap-alert');
    const alertMsg = el('log-time-overlap-message');
    const statusExec = el('log-input-status-execution')?.value;

    const start = startInput?.value;
    const end = endInput?.value;
    const eff = calcEffective(start, end);
    const preview = el('log-preview-minutes');
    if (preview) preview.textContent = `${eff} menit`;

    // Reset status visual
    if (alertBox) alertBox.classList.add('hidden');
    if (startInput) {
        startInput.classList.remove('border-rose-500', 'focus:ring-rose-500/30', 'bg-rose-50/50', 'dark:bg-rose-950/20');
    }
    if (endInput) {
        endInput.classList.remove('border-rose-500', 'focus:ring-rose-500/30', 'bg-rose-50/50', 'dark:bg-rose-950/20');
    }
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
    if (typeof applyManagerReadOnlyLogButtons === 'function' && applyManagerReadOnlyLogButtons()) return;

    // Jika status tidak terlaksana, waktu tidak diperhitungkan
    if (statusExec === 'tidak_terlaksana') return;
    if (!start || !end) return;

    // Validasi jam mulai < jam selesai
    if (start >= end) {
        if (alertBox && alertMsg) {
            alertMsg.textContent = 'Jam mulai aktual harus lebih awal dari jam selesai aktual.';
            alertBox.classList.remove('hidden');
        }
        if (startInput) startInput.classList.add('border-rose-500');
        if (endInput) endInput.classList.add('border-rose-500');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
        }
        return;
    }

    const curLogId = el('log-input-id')?.value;
    const targetDate = el('log-input-date')?.value;
    const existingLogSegs = [];

    (_weekData?.logs || []).forEach(l => {
        if (l.id === curLogId || l.date !== targetDate || l.status_execution === 'tidak_terlaksana') return;
        const segs = (_weekData?.log_segments || []).filter(ls => ls.work_log_id === l.id);
        if (segs.length > 0) {
            segs.forEach(s => existingLogSegs.push({ ...s, title: l.title }));
        } else if (l.start_time && l.end_time) {
            existingLogSegs.push({ start_time: l.start_time, end_time: l.end_time, title: l.title });
        }
    });

    const overlapCheck = findTimeOverlap({ start_time: start, end_time: end }, existingLogSegs);
    if (overlapCheck.hasOverlap) {
        if (alertBox && alertMsg) {
            alertMsg.textContent = overlapCheck.message;
            alertBox.classList.remove('hidden');
        }
        if (startInput) {
            startInput.classList.add('border-rose-500', 'focus:ring-rose-500/30', 'bg-rose-50/50', 'dark:bg-rose-950/20');
        }
        if (endInput) {
            endInput.classList.add('border-rose-500', 'focus:ring-rose-500/30', 'bg-rose-50/50', 'dark:bg-rose-950/20');
        }
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
        }
    }
}

export async function saveLogDraft() {
    await saveLog('draft');
}

async function saveLog(e) {
    if (e && typeof e.preventDefault === 'function') {
        e.preventDefault();
    }
    if (_isSavingLog) return;
    if (isManagerViewingOtherTeacher()) {
        showToast(MANAGER_READONLY_LOG_MSG, 'warning');
        return;
    }
    const statusOverride = (typeof e === 'string') ? e : null;

    // Pastikan minggu sudah diinisialisasi
    if (!_weekData?.initialized) {
        try {
            await cfInitializeWorkloadWeek({
                week_start_date: _weekStartDate,
                teacher_id: getEffectiveTeacherId() || undefined
            });
        } catch (err) { showToast('Gagal inisialisasi minggu: ' + err.message, 'error'); return; }
        await loadWeek();
    }

    // Status kegiatan tetap dipakai untuk memilih katalog/judul pengganti;
    // tombol Simpan Draf hanya menentukan status penyimpanannya.
    const selectedStatus = el('log-input-status-execution')?.value || 'terlaksana';
    const statusExec = statusOverride === 'draft' ? selectedStatus : (statusOverride || selectedStatus);
    const isDraft = statusOverride === 'draft' || statusExec === 'draft';
    const isUnplanned = el('log-input-is-unplanned').value === '1';

    // Proteksi Integritas Data KBM: Realisasi tatap muka KBM wajib disinkronkan dari Jurnal Mengajar Digital
    // Pembuatan baru manual untuk status 'terlaksana' diblokir, namun perbarui data (foto/keterangan) pada log yang ada diizinkan
    const planId = el('log-input-plan-id')?.value;
    const existingLogId = el('log-input-id')?.value;
    if (planId && !isUnplanned && statusExec === 'terlaksana' && !existingLogId) {
        const seg = (_weekData?.segments || []).find(s => s.activity_id === planId);
        const act = (_weekData?.activities || []).find(a => a.id === planId);
        if (isTeachingActivity(seg) || isTeachingActivity(act)) {
            showToast('Kegiatan tatap muka KBM tidak dapat dicentang atau dilaporkan secara manual. Realisasi otomatis disinkronkan dari Jurnal Mengajar Digital demi menjaga integritas data.', 'warning', 6000);
            return;
        }
    }

    const substituteNotes = el('log-input-substitute')?.value?.trim() || '';
    if (statusExec === 'diganti' && !substituteNotes) {
        showToast('Catatan kegiatan pengganti wajib diisi', 'error');
        el('log-input-substitute')?.focus();
        return;
    }

    let title = el('log-input-title')?.value?.trim() || '';
    if (statusExec === 'diganti') {
        // Saat diganti kegiatan lain, form uraian atas disembunyikan.
        // Judul kegiatan otomatis diambil dari uraian pengganti yang diisi di form bawah.
        const catSelect = el('log-input-catalog');
        const selectedCatOpt = catSelect?.options[catSelect.selectedIndex];
        const catText = selectedCatOpt?.textContent?.trim() || el('log-input-catalog-search')?.value?.trim() || '';
        title = substituteNotes || catText || title || 'Kegiatan Pengganti';
        if (el('log-input-title')) el('log-input-title').value = title;
    } else {
        if (!title) { showToast('Uraian pekerjaan wajib diisi', 'error'); return; }
    }

    const obstacleNotes = el('log-input-obstacle')?.value?.trim() || '';
    if (statusExec === 'tidak_terlaksana' && !obstacleNotes) {
        showToast('Alasan kegiatan tidak terlaksana wajib diisi', 'error');
        el('log-input-obstacle')?.focus();
        return;
    }

    // Tentukan catalog_id secara akurat
    let catalogId = 'cat_kbm';
    if (statusExec === 'diganti' || isUnplanned) {
        if (!el('log-input-catalog')?.value) {
            showToast('Silakan pilih sub-kegiatan terlebih dahulu', 'warning');
            el('log-input-catalog-search')?.focus();
            openLogCatalogDropdown();
            return;
        }
        catalogId = el('log-input-catalog')?.value || 'cat_kbm';
    } else {
        const planId = el('log-input-plan-id').value;
        if (planId && _weekData?.segments) {
            const seg = _weekData.segments.find(s => s.activity_id === planId);
            const act = (_weekData.activities || []).find(a => a.id === planId);
            catalogId = seg?.catalog_id || act?.catalog_id || el('log-input-catalog')?.value || 'cat_kbm';
        } else {
            catalogId = el('log-input-catalog')?.value || 'cat_kbm';
        }
    }

    // Periksa apakah masih ada foto yang sedang dalam proses pengunggahan
    const hasUploading = _currentLogPhotos.some(p => p.state === 'uploading');
    if (hasUploading) {
        showToast('Foto sedang diunggah ke Google Drive, mohon tunggu sebentar...', 'info');
        return;
    }

    const hasFailed = _currentLogPhotos.some(p => p.state === 'failed');
    if (hasFailed) {
        showToast('Terdapat foto yang gagal diunggah. Silakan hapus foto yang gagal atau coba pilih ulang.', 'warning');
        return;
    }

    const readyPhotos = _currentLogPhotos
        .filter(p => p.url && p.state !== 'uploading')
        .map(p => ({
            url: p.url,
            fileId: p.fileId || '',
            name: p.name || 'Foto Bukti',
            caption: (p.caption || '').trim()
        }));

    let evidencePayload = '';
    if (readyPhotos.length > 0) {
        evidencePayload = JSON.stringify(readyPhotos);
    } else {
        evidencePayload = el('log-input-evidence')?.value?.trim() || '';
    }

    const dutySelect = el('log-input-main-duty');
    const selectedDuty = dutySelect?.value || 'PELAKSANAAN_KBM';
    const catSelect = el('log-input-catalog');
    const selectedCatOpt = catSelect?.options[catSelect.selectedIndex];
    const isTeaching = selectedCatOpt?.dataset?.teaching === '1';
    const jpCount = (isTeaching || parseInt(selectedCatOpt?.dataset?.jp || '0', 10) > 0)
        ? parseInt(el('log-input-jp')?.value || '0', 10)
        : 0;
    const assignmentId = el('log-input-assignment')?.value || null;

    const payload = {
        teacher_id: _weekData?.week?.teacher_id || getEffectiveTeacherId() || undefined,
        work_week_id: _weekData?.week?.id,
        date: el('log-input-date').value,
        day_of_week: _selectedDayIndex + 1,
        title,
        catalog_id: catalogId,
        category_code: selectedDuty,
        is_teaching: isTeaching ? 1 : 0,
        jp_count: jpCount,
        assignment_id: assignmentId,
        plan_activity_id: el('log-input-plan-id').value || undefined,
        is_unplanned: isUnplanned ? 1 : 0,
        status_execution: isDraft ? 'draft' : statusExec,
        output_summary: el('log-input-output')?.value?.trim() || '',
        evidence_url: evidencePayload,
        obstacle_notes: obstacleNotes,
        substitute_notes: substituteNotes
    };
    if (isDraft && statusExec === 'diganti') {
        payload.draft_status_execution = 'diganti';
    }

    // Validasi jam kegiatan belum berakhir (dengan toleransi 10 menit sebelum jam berakhir)
    // Jika disimpan sebagai draf, guru dapat menyimpan kapan saja saat kegiatan sedang berlangsung
    if (!isDraft) {
        let activityEndTime = el('log-input-end')?.value || null;
        const planId = el('log-input-plan-id')?.value;
        if (!activityEndTime && planId && _weekData?.segments) {
            const seg = _weekData.segments.find(s => s.activity_id === planId);
            if (seg?.end_time) {
                activityEndTime = seg.end_time;
            }
        }
        const reportCheck = canReportActivityNow(payload.date, activityEndTime, 5);
        if (!reportCheck.allowed && (statusExec !== 'tidak_terlaksana' || payload.date > todayWITA())) {
            showToast(reportCheck.reason || 'Kegiatan belum berakhir.', 'warning');
            return;
        }
    }

    if (statusExec !== 'tidak_terlaksana') {
        const startInput = el('log-input-start');
        const endInput = el('log-input-end');
        const start = startInput?.value?.trim();
        const end = endInput?.value?.trim();
        if (!start) {
            showToast('Jam mulai dan jam selesai aktual wajib diisi.', 'error');
            startInput?.focus();
            return;
        }
        if (!end) {
            showToast('Jam mulai dan jam selesai aktual wajib diisi.', 'error');
            endInput?.focus();
            return;
        }
        payload.start_time = start;
        payload.end_time = end;
        payload.segments = [{ start_time: start, end_time: end, actual_minutes: calcEffective(start, end) }];

            // Validasi Anti-Benturan Waktu Realisasi (Anti-Overlap Rule)
            const existingLogSegs = [];
            const curLogId = el('log-input-id')?.value;
            (_weekData?.logs || []).forEach(l => {
                if (l.id === curLogId || l.date !== payload.date || l.status_execution === 'tidak_terlaksana') return;
                const segs = (_weekData?.log_segments || []).filter(ls => ls.work_log_id === l.id);
                if (segs.length > 0) {
                    segs.forEach(s => existingLogSegs.push({ ...s, title: l.title }));
                } else if (l.start_time && l.end_time) {
                    existingLogSegs.push({ start_time: l.start_time, end_time: l.end_time, title: l.title });
                }
            });

            const overlapCheck = findTimeOverlap({ start_time: start, end_time: end }, existingLogSegs);
            if (overlapCheck.hasOverlap) {
                showToast(overlapCheck.message, 'warning', 6000);
                el('log-input-start')?.focus();
                return;
            }
    }

    const existingId = el('log-input-id').value;
    if (existingId) payload.id = existingId;

    _isSavingLog = true;
    const submitBtn = el('btn-submit-workload-log');
    const draftBtn = el('btn-draft-workload-log');
    const modalLog = el('modal-workload-log');
    const cancelBtn = modalLog ? modalLog.querySelector('button[onclick*="closeLogModal"]') : null;
    const deleteBtn = el('btn-delete-workload-log');
    const origSubmitHtml = submitBtn ? submitBtn.innerHTML : '';
    const origDraftHtml = draftBtn ? draftBtn.innerHTML : '';

    if (submitBtn) submitBtn.disabled = true;
    if (draftBtn) draftBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    if (deleteBtn) deleteBtn.disabled = true;

    if (isDraft && draftBtn) {
        draftBtn.classList.add('opacity-75', 'cursor-wait');
        draftBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Menyimpan Draf...';
    } else if (submitBtn) {
        submitBtn.classList.add('opacity-75', 'cursor-wait');
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Menyimpan...';
    }

    try {
        await cfSaveWorkloadLog(payload);
        if (isDraft) {
            showToast(existingId ? 'Draf kegiatan berhasil diperbarui' : 'Kegiatan berhasil disimpan sebagai draf');
        } else {
            showToast(existingId ? 'Laporan realisasi berhasil diperbarui' : 'Laporan realisasi berhasil disimpan');
        }
        closeLogModal();
        await loadWeek();
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        _isSavingLog = false;
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.classList.remove('opacity-75', 'cursor-wait');
            submitBtn.innerHTML = origSubmitHtml;
        }
        if (draftBtn) {
            draftBtn.disabled = false;
            draftBtn.classList.remove('opacity-75', 'cursor-wait');
            draftBtn.innerHTML = origDraftHtml;
        }
        if (cancelBtn) cancelBtn.disabled = false;
        if (deleteBtn) deleteBtn.disabled = false;
    }
}

export async function deleteCurrentLog() {
    const logId = el('log-input-id')?.value;
    if (!logId) return;
    closeLogModal();
    await deleteLog(logId);
}

async function deleteLog(logId) {
    const log = (_weekData?.logs || []).find(l => l.id === logId);
    if (log && isLogLockedByManualVerification(log)) {
        if (log.is_locked === 1 || _weekData?.week?.is_locked === 1) {
            showToast('Laporan kegiatan telah dikunci dan tidak dapat dihapus.', 'warning');
        } else {
            showToast('Laporan ini telah diverifikasi oleh Kepala Sekolah dan tidak dapat dihapus.', 'warning');
        }
        return;
    }

    const ok = await askConfirm(
        'Apakah Anda yakin ingin menghapus laporan realisasi kegiatan ini?\n\nSetelah dihapus, status kegiatan akan kembali menjadi rencana kerja yang belum dilaporkan.',
        'Hapus Realisasi',
        'danger',
        { confirmText: 'Hapus Laporan' }
    );
    if (!ok) return;
    try {
        await cfDeleteWorkloadLog(logId);
        showToast('Laporan realisasi berhasil dihapus. Kegiatan kembali menjadi rencana kerja.');
        await loadWeek();
    } catch (e) { showToast(e.message, 'error'); }
}

// ========== SUBMIT PLAN ==========
async function submitPlan() {
    if (_isSubmittingPlan) return;
    if (_isSavingStudyDay) {
        showToast('Tunggu sampai pilihan Hari Belajar Guru selesai disimpan.', 'info');
        return;
    }
    if (!_weekData?.initialized || !_weekData?.active_version) {
        showToast('Belum ada rencana yang dapat diajukan', 'error');
        return;
    }
    const ver = _weekData.active_version;
    if (!['draft', 'needs_revision'].includes(ver.status)) {
        showToast(`Rencana dalam status '${ver.status}' tidak dapat diajukan`, 'error');
        return;
    }

    // Kunci sejak validasi/konfirmasi, termasuk saat deduplikasi menunggu server.
    _isSubmittingPlan = true;
    renderTeacherStudyDayControl();
    const btn = el('btn-submit-plan');
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) btn.disabled = true;
    try {
        // Validasi kelengkapan rencana mingguan (proteksi anti-slot kosong)
        const planActionName = _policy?.require_plan_approval === 0 ? 'difinalisasi' : 'diajukan';
        let completeness = validateWeeklyPlanCompleteness(_weekStartDate, _weekData.segments || [], {
            policy: _policy,
            isHolidayFn: (d) => isHolidayDate(d),
            getHolidayInfoFn: (d) => getHolidayDateInfo(d),
            actionName: planActionName
        });

        if (!completeness.isValid) {
            // Jika terdapat benturan jam kerja atau kegiatan kembar, lakukan pembersihan otomatis senyap (zero-friction)
            if (completeness.message.includes('benturan jam kerja') || completeness.message.includes('kembar')) {
                const cleaned = await autoDeduplicatePlan({ silent: true });
                if (cleaned) {
                    // Evaluasi ulang kelengkapan rencana setelah pembersihan otomatis
                    completeness = validateWeeklyPlanCompleteness(_weekStartDate, _weekData.segments || [], {
                        policy: _policy,
                        isHolidayFn: (d) => isHolidayDate(d),
                        getHolidayInfoFn: (d) => getHolidayDateInfo(d),
                        actionName: planActionName
                    });
                }
            }
        }

        if (!completeness.isValid) {
            showToast(completeness.message, 'warning');
            return;
        }

        const studyValidation = validateTeacherStudyDayPlan(_weekData.study_day, _weekData.segments || [], _weekStartDate);
        if (!studyValidation.isValid) {
            showToast(studyValidation.message, 'warning', 7000);
            return;
        }

        const hasPkb = checkHasPkActivity(_weekData.segments || []);
        let studyDayWarning = '';
        if (!hasPkb) {
            studyDayWarning = '\n\n⚠️ Catatan Kepatuhan Regulasi (SE Mendikdasmen No. 5684/2025):\nAnda belum mencantumkan kegiatan Pengembangan Keprofesian Berkelanjutan (MGMP/Komunitas Belajar) pada rencana minggu ini.';
        }

        const isAutoApproved = _policy?.require_plan_approval === 0;
        const confirmMsg = isAutoApproved
            ? `Rencana kerja mingguan ini telah lengkap dan akan langsung difinalisasi secara mandiri (Mode Mandiri Aktif).${studyDayWarning}\n\nLanjutkan finalisasi rencana?`
            : `Rencana kerja mingguan telah lengkap terisi.${studyDayWarning}\n\nAjukan rencana kerja minggu ini kepada Kepala Sekolah untuk persetujuan?`;
        const confirmTitle = isAutoApproved ? 'Finalisasi Rencana' : 'Pengajuan Rencana Kerja';
        const confirmBtnText = isAutoApproved ? 'Finalisasi Rencana' : 'Ajukan Sekarang';
        // Gunakan revisi terbaru setelah deduplikasi dan tetap ajukan pekan yang
        // dikonfirmasi meskipun pengguna berpindah pekan saat modal terbuka.
        const submissionPayload = {
            work_week_id: _weekData.week.id,
            plan_version_id: _weekData.active_version.id,
            revision_lock: _weekData.active_version.revision_lock
        };

        const ok = await askConfirm(confirmMsg, confirmTitle, 'warning', { confirmText: confirmBtnText });
        if (!ok) return;

        if (btn) {
            btn.classList.add('opacity-75', 'cursor-wait');
            btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> ${isAutoApproved ? 'Memproses...' : 'Mengajukan...'}`;
        }

        const res = await cfSubmitWorkloadPlan(submissionPayload);
        if (res?.data?.auto_approved) {
            showToast('Rencana kerja berhasil difinalisasi (Mode Mandiri Aktif)');
        } else {
            showToast('Rencana kerja berhasil diajukan ke Kepala Sekolah');
        }
        await loadWeek();
    } catch (err) {
        const friendlyMsg = formatSavePlanErrorMessage(err);
        showToast(friendlyMsg, 'error', 12000, 'Gagal Mengajukan Rencana');
    } finally {
        _isSubmittingPlan = false;
        renderTeacherStudyDayControl();
        if (btn) {
            btn.disabled = false;
            btn.classList.remove('opacity-75', 'cursor-wait');
            btn.innerHTML = origHtml;
        }
    }
}

// ========== REOPEN PLAN TO DRAFT ==========
let _isReopeningPlan = false;

async function reopenPlan() {
    if (_isReopeningPlan) return;
    if (!_weekData?.initialized || !_weekData?.active_version) {
        showToast('Rencana kerja belum diinisialisasi', 'error');
        return;
    }
    const ver = _weekData.active_version;
    if (_weekData?.week?.is_locked === 1) {
        showToast('Minggu kerja telah dikunci oleh pimpinan (tidak dapat diubah)', 'error');
        return;
    }
    if (['draft', 'needs_revision'].includes(ver.status)) {
        showToast('Rencana kerja sudah berada dalam status draf', 'info');
        return;
    }

    const isAutoApproved = _policy?.require_plan_approval === 0 || ver.reviewed_by_uid === 'system_auto_approval';
    const confirmTitle = isAutoApproved ? 'Ubah Rencana ke Draf?' : (ver.status === 'submitted' ? 'Tarik Pengajuan Rencana?' : 'Buka Revisi Rencana?');
    const confirmMsg = isAutoApproved
        ? 'Rencana kerja mingguan yang telah difinalisasi akan dikembalikan ke status draf.\n\nAnda dapat menambah, mengedit jadwal, atau menghapus kegiatan, lalu memfinalisasi kembali rencana ini setelah selesai.\n\nLanjutkan ubah ke draf?'
        : (ver.status === 'submitted'
            ? 'Batalkan pengajuan rencana kerja dan kembalikan ke draf untuk diedit kembali sebelum ditinjau Kepala Sekolah?\n\nLanjutkan?'
            : 'Rencana kerja mingguan akan dikembalikan ke status draf agar Anda dapat menyunting jadwal kegiatan.\n\nLanjutkan buka revisi?');

    const ok = await askConfirm(
        confirmMsg,
        confirmTitle,
        'warning',
        { confirmText: 'Ya, Ubah ke Draf', cancelText: 'Batal' }
    );
    if (!ok) return;

    _isReopeningPlan = true;
    const btn = el('btn-reopen-plan');
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.classList.add('opacity-75', 'cursor-wait');
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Memproses...';
    }

    try {
        const res = await cfReopenWorkloadPlan({
            work_week_id: _weekData.week.id,
            plan_version_id: ver.id,
            revision_lock: ver.revision_lock
        });
        showToast(res.message || '✓ Rencana berhasil dikembalikan ke status draf');
        await loadWeek();
    } catch (err) {
        const friendlyMsg = formatSavePlanErrorMessage(err);
        showToast(friendlyMsg, 'error', 12000, 'Gagal Mengembalikan Draf');
    } finally {
        _isReopeningPlan = false;
        if (btn) {
            btn.disabled = false;
            btn.classList.remove('opacity-75', 'cursor-wait');
            btn.innerHTML = origHtml;
        }
    }
}
window.workloadReopenPlan = reopenPlan;

// ========== APPLY TEMPLATE ==========
function openApplyTemplateModal() {
    const ver = _weekData?.active_version;
    const hasBeenFinalized = !!(ver && (ver.submitted_at || ['approved', 'submitted', 'needs_revision'].includes(ver.status)));
    if (hasBeenFinalized) {
        showToast('Template tidak dapat diterapkan karena rencana kerja minggu ini sudah pernah difinalisasi.', 'error');
        return;
    }
    if (!requireKbmSyncBeforePlanning()) return;

    const modal = el('modal-apply-template');
    if (!modal) return;
    const select = el('select-apply-template-id');
    if (select) {
        select.innerHTML = (_templates || []).map(t =>
            `<option value="${t.id}">${t.template_name} (${t.total_estimated_minutes || 0}m)</option>`
        ).join('');
    }
    if (!_templates || _templates.length === 0) {
        showToast('Belum ada template tersimpan. Buat template terlebih dahulu.', 'error');
        return;
    }

    // Deteksi hari libur resmi pada pekan aktif untuk transparansi dan edukasi guru
    const alertEl = el('apply-template-holiday-alert');
    if (alertEl) {
        const holidaysInWeek = [];
        for (let d = 0; d < 5; d++) {
            const dStr = dateOfDay(_weekStartDate, d);
            if (isHolidayDate(dStr)) {
                const info = getHolidayDateInfo(dStr);
                holidaysInWeek.push({
                    date: dStr,
                    dayName: DAY_NAMES[d] || `Hari ke-${d + 1}`,
                    title: info?.title || info?.name || 'Hari Libur Resmi'
                });
            }
        }

        if (holidaysInWeek.length > 0) {
            const listText = holidaysInWeek.map(h => `<strong>${h.dayName} (${fmtDate(h.date)})</strong>: ${escapeHTML(h.title)}`).join('<br>');
            alertEl.innerHTML = `
                <div class="p-3 rounded-2xl bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2.5">
                    <div class="w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-900/60 flex items-center justify-center shrink-0 mt-0.5">
                        <i class="fa-solid fa-umbrella-beach text-amber-600 dark:text-amber-400 text-xs"></i>
                    </div>
                    <div class="flex-1">
                        <div class="font-bold text-xs text-amber-900 dark:text-amber-100">Pekan ini memiliki ${holidaysInWeek.length} hari libur resmi:</div>
                        <div class="text-[11px] text-amber-800 dark:text-amber-300 mt-0.5 leading-relaxed">${listText}</div>
                        <div class="text-[10px] text-amber-600 dark:text-amber-400 mt-1">Kegiatan template pada hari libur otomatis dilewati agar rencana kerja akurat (bebas target).</div>
                    </div>
                </div>`;
            alertEl.classList.remove('hidden');
        } else {
            alertEl.classList.add('hidden');
            alertEl.innerHTML = '';
        }
    }

    modal.classList.remove('hidden');
}

function closeApplyTemplateModal() {
    el('modal-apply-template')?.classList.add('hidden');
}

// ========== BERSIHKAN RENCANA PADA HARI LIBUR RESMI ==========
async function clearHolidayDraftItems(dateStr) {
    if (!_weekData?.initialized || !_weekData?.active_version || !_weekData?.week?.id) return;
    const ver = _weekData.active_version;
    const ghostSegs = (_weekData.segments || []).filter(s =>
        s.date === dateStr &&
        !s.has_realized_log &&
        (s.has_log === undefined || s.has_log === 0) &&
        !s.is_leave &&
        s.catalog_id !== 'cat_cuti_izin' &&
        s.catalog_id !== 'cat_libur'
    );
    if (ghostSegs.length === 0) {
        showToast('Tidak ada kegiatan rencana yang perlu ditiadakan pada tanggal ini', 'info');
        return;
    }

    const ok = await askConfirm(
        `Apakah Anda yakin ingin meniadakan ${ghostSegs.length} kegiatan rencana kerja pada hari libur ini (${fmtDate(dateStr)})?\n\nKegiatan yang belum memiliki realisasi akan ditiadakan agar rencana kerja Anda akurat. Status pengesahan rencana kerja tetap terjaga.`,
        'Tiadakan Rencana Hari Libur',
        'danger',
        { confirmText: 'Tiadakan Sekarang' }
    );
    if (!ok) return;

    try {
        showToast('Sedang meniadakan kegiatan di hari libur...', 'info');
        const res = await cfCleanWorkloadHolidayDrafts({
            work_week_id: _weekData.week.id,
            plan_version_id: ver.id,
            holiday_dates: [dateStr]
        });

        const removedCount = res?.data?.removed_count ?? ghostSegs.length;
        // Pembaruan lokal instan (0 extra read D1)
        const ghostIds = new Set(ghostSegs.map(s => s.id));
        _weekData.segments = (_weekData.segments || []).filter(s => !ghostIds.has(s.id));
        if (res?.data?.total_planned_minutes !== undefined) {
            ver.total_planned_minutes = res.data.total_planned_minutes;
        }
        _weekCache.set(getEffectiveTeacherId(), _weekStartDate, _weekData);
        renderAll();
        showToast(`✓ Berhasil meniadakan ${removedCount} kegiatan rencana di hari libur (${fmtDate(dateStr)}).`);
    } catch (err) {
        showToast(err.message || 'Gagal meniadakan kegiatan hari libur', 'error');
    }
}
window.workloadClearHolidayDraftItems = clearHolidayDraftItems;

// ========== AUTO DEDUPLICATE PLAN ==========
async function autoDeduplicatePlan(options = {}) {
    if (!_weekData?.initialized || !_weekData?.active_version) {
        if (!options.silent) showToast('Rencana kerja belum diinisialisasi', 'error');
        return false;
    }
    const ver = _weekData.active_version;
    if (!['draft', 'needs_revision'].includes(ver.status)) {
        if (!options.silent) showToast(`Rencana dalam status '${ver.status}' tidak dapat diubah`, 'error');
        return false;
    }

    try {
        if (!options.silent) showToast('Sedang membersihkan kegiatan duplikat...');
        const weekHolidays = [];
        for (let d = 0; d < 5; d++) {
            const dStr = dateOfDay(_weekStartDate, d);
            if (isHolidayDate(dStr)) weekHolidays.push(dStr);
        }
        const res = await cfDeduplicateWorkloadPlan({
            work_week_id: _weekData.week.id,
            plan_version_id: ver.id,
            holiday_dates: weekHolidays
        });
        const deletedCount = res?.data?.deleted_count || 0;
        if (deletedCount > 0) {
            showToast(`✓ Sistem telah otomatis menyelaraskan dan membersihkan ${deletedCount} kegiatan rencana yang tumpang tindih/duplikat.`);
        } else if (!options.silent) {
            showToast(res.message || 'Tidak ada kegiatan duplikat ditemukan');
        }
        await loadWeek();
        return deletedCount > 0;
    } catch (err) {
        if (!options.silent) showToast(err.message || 'Gagal membersihkan duplikat rencana', 'error');
        return false;
    }
}
window.workloadAutoDeduplicate = autoDeduplicatePlan;

async function confirmApplyTemplate() {
    const templateId = el('select-apply-template-id')?.value;
    if (!templateId) { showToast('Pilih template terlebih dahulu', 'error'); return; }

    const selectedTemplate = (_templates || []).find(t => t.id === templateId);
    const existingSegs = _weekData?.segments || [];
    const templateItems = selectedTemplate?.items || [];

    // Deteksi hari libur pekan aktif untuk smart diffing dan payload
    const weekHolidays = [];
    for (let d = 0; d < 5; d++) {
        const dStr = dateOfDay(_weekStartDate, d);
        if (isHolidayDate(dStr)) weekHolidays.push(dStr);
    }
    const holidaySet = new Set(weekHolidays);

    // Filter butir template yang jatuh pada hari kerja aktif (bukan hari libur) untuk smart diffing check
    const effectiveTemplateItems = templateItems.filter(ti => {
        const dayOffset = Math.max(0, Number(ti.day_of_week) - 1);
        const targetDate = dateOfDay(_weekStartDate, dayOffset);
        return !holidaySet.has(targetDate);
    });

    // Deteksi cerdas kesamaan identik client-side untuk menghemat kuota read & write D1:
    // Jika seluruh butir template kerja sudah persis sama dengan rencana minggu ini, pertahankan tanpa request database
    if (effectiveTemplateItems.length > 0 && existingSegs.length === effectiveTemplateItems.length) {
        const isAllIdentical = effectiveTemplateItems.every(ti => {
            const dayOffset = Math.max(0, Number(ti.day_of_week) - 1);
            const targetDate = dateOfDay(_weekStartDate, dayOffset);
            const targetTitle = (ti.title || '').trim();
            const targetCatalogId = ti.catalog_id || 'cat_kbm';
            const targetJp = Number(ti.jp_count || 0);
            const targetIsTeaching = ti.is_teaching ? 1 : 0;

            return existingSegs.some(s =>
                s.date === targetDate &&
                s.start_time === ti.start_time &&
                s.end_time === ti.end_time &&
                (s.activity_title || s.title || s.description || '').trim() === targetTitle &&
                (s.catalog_id || 'cat_kbm') === targetCatalogId &&
                Number(s.jp_count || 0) === targetJp &&
                (s.is_teaching ? 1 : 0) === targetIsTeaching
            );
        });

        if (isAllIdentical) {
            showToast('Rencana kerja minggu ini sudah sama persis dengan template yang dipilih (hari libur telah dilewati). Seluruh kegiatan dipertahankan tanpa perubahan database.', 'info');
            closeApplyTemplateModal();
            return;
        }
    }

    // SSOT: Selalu gunakan mode smart reconciliation (replace_existing = true)
    // Backend Cloudflare Worker mengeksekusi Smart Diffing Engine:
    // 1. Yang sudah sama persis -> LEWATI (dipertahankan, 0 write ke DB)
    // 2. Yang tidak sama persis -> DIPERBARUI in-place (UPDATE)
    // 3. Yang ber-log -> dilindungi secara mutlak
    // 4. Yang di hari libur -> otomatis dilewati & dibersihkan
    const replaceExisting = true;

    const btnSubmit = el('btn-confirm-apply-template') || document.querySelector('button[onclick*="workloadConfirmApplyTemplate"]');
    const origHtml = btnSubmit ? btnSubmit.innerHTML : '';
    if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.classList.add('opacity-75', 'cursor-wait');
        btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Menerapkan...';
    }

    try {
        if (!_weekData?.initialized) {
            try {
                await cfInitializeWorkloadWeek({
                    week_start_date: _weekStartDate,
                    teacher_id: getEffectiveTeacherId() || undefined
                });
            } catch (e) { showToast(e.message, 'error'); return; }
            await loadWeek();
        }

        const ver = _weekData?.active_version;
        if (!ver) { showToast('Versi rencana tidak tersedia', 'error'); return; }

        const hasBeenFinalized = !!(ver.submitted_at || ['approved', 'submitted', 'needs_revision'].includes(ver.status));
        if (hasBeenFinalized) {
            showToast('Penerapan template ditolak: Rencana kerja minggu ini sudah pernah difinalisasi.', 'error');
            return;
        }

        const res = await cfApplyWorkloadTemplate({
            work_week_id: _weekData.week.id,
            plan_version_id: ver.id,
            template_id: templateId,
            revision_lock: ver.revision_lock,
            replace_existing: replaceExisting,
            holiday_dates: weekHolidays
        });
        showToast(res.message || 'Template berhasil diterapkan');
        closeApplyTemplateModal();

        // Tandai bahwa template telah diterapkan pada pekan ini agar pemilihan HBG otomatis disembunyikan
        const teacherKey = `${getEffectiveTeacherId() || ''}_${_weekStartDate || ''}`;
        _appliedTemplateWeeks.add(teacherKey);
        if (_weekData) _weekData.template_applied = true;
        renderTeacherStudyDayControl();

        // Hemat kuota read: Hanya muat ulang rencana jika ada mutasi data riil di database
        const stat = res?.data;
        const hasMutations = !stat || (
            (stat.inserted_count || 0) > 0 ||
            (stat.updated_count || 0) > 0 ||
            (stat.deleted_count || 0) > 0 ||
            (stat.dedup_removed || 0) > 0
        );
        if (hasMutations) {
            await loadWeek();
        }
    } catch (err) {
        const friendlyMsg = formatSavePlanErrorMessage(err);
        showToast(friendlyMsg, 'error', 12000, 'Gagal Menerapkan Template');
    } finally {
        if (btnSubmit) {
            btnSubmit.disabled = false;
            btnSubmit.classList.remove('opacity-75', 'cursor-wait');
            btnSubmit.innerHTML = origHtml || 'Terapkan Sekarang';
        }
    }
}

// ========== SYNC SCHEDULE DARI aSc TIMETABLES ==========
function formatTimeHHMM(t) {
    if (!t) return '07:30';
    const parts = t.trim().split(':');
    return `${parts[0].padStart(2, '0')}:${(parts[1] || '00').padStart(2, '0')}`;
}

function getPeriodTimes(periodNum, dynamicPeriods = []) {
    const p = (dynamicPeriods || []).find(d => Number(d.jp) === Number(periodNum)) ||
              DEFAULT_JP_PERIODS.find(d => Number(d.jp) === Number(periodNum));
    if (p) {
        return {
            start: formatTimeHHMM(p.start),
            end: formatTimeHHMM(p.end)
        };
    }
    return { start: '07:30', end: '08:15' };
}

function findMatchedTeacher(teachersList, customMapping = null) {
    if (!Array.isArray(teachersList) || teachersList.length === 0) return null;

    // 1. Dari data minggu kerja aktif atau guru terpilih supervisor
    const targetTeacherId = _adminSelectedTeacherId || _weekData?.week?.teacher_id || _weekData?.teacher_id || '';
    const targetTeacherName = _adminSelectedTeacherName || _weekData?.week?.teacher_name || '';
    const targetTeacherNip = _weekData?.week?.teacher_nip || '';

    // 2. Dari cache user login
    let cachedDoc = null;
    try {
        if (auth?.currentUser?.uid) {
            cachedDoc = JSON.parse(localStorage.getItem(`simas_user_data_${auth.currentUser.uid}`) || 'null');
        }
    } catch (_) {}

    const authUid = auth?.currentUser?.uid || '';
    const linkedTeacherId = _adminSelectedTeacherId || cachedDoc?.linkedTeacherId || targetTeacherId || authUid;
    const nip = targetTeacherNip || cachedDoc?.nip || cachedDoc?.teacherNip || '';
    const name = targetTeacherName || cachedDoc?.name || cachedDoc?.displayName || auth?.currentUser?.displayName || '';

    // Match 0: Cek customTeacherMapping
    let mapping = customMapping;
    if (!mapping && typeof localStorage !== 'undefined') {
        try {
            mapping = JSON.parse(localStorage.getItem('simas_asc_teacher_mapping') || '{}');
        } catch (_) {}
    }
    if (mapping && typeof mapping === 'object') {
        const mappedId = mapping[linkedTeacherId] || mapping[authUid] || (name ? mapping[name] : null);
        if (mappedId) {
            const m = teachersList.find(t => t.id === mappedId);
            if (m) return m;
        }
    }

    // Match 1: ID / simasId
    if (linkedTeacherId) {
        const m = teachersList.find(t => t.id === linkedTeacherId || t.simasId === linkedTeacherId);
        if (m) return m;
    }

    // Match 2: NIP / short
    if (nip) {
        const cleanNip = String(nip).trim();
        const m = teachersList.find(t => t.simasNip === cleanNip || t.short === cleanNip || t.id === cleanNip);
        if (m) return m;
    }

    // Match 3: Normalisasi nama tanpa gelar (mengadopsi Parser E-Rapor)
    if (name) {
        const normTarget = normalizeTeacherName(name);
        if (normTarget) {
            // Cek kesamaan persis hasil normalisasi nama
            let m = teachersList.find(t => {
                const tNorm = normalizeTeacherName(t.name);
                const tSimasNorm = normalizeTeacherName(t.simasName);
                return tNorm === normTarget || tSimasNorm === normTarget;
            });
            if (m) return m;

            // Cek token kata
            const nameTokens = normTarget.split(' ').filter(tok => tok.length > 2);
            if (nameTokens.length > 0) {
                m = teachersList.find(t => {
                    const tNorm = normalizeTeacherName(t.name);
                    const tSimasNorm = normalizeTeacherName(t.simasName);
                    return (tNorm && nameTokens.every(tok => tNorm.includes(tok))) ||
                           (tSimasNorm && nameTokens.every(tok => tSimasNorm.includes(tok)));
                });
                if (m) return m;
            }

            // Cek substring inklusi
            m = teachersList.find(t => {
                const tNorm = normalizeTeacherName(t.name);
                const tSimasNorm = normalizeTeacherName(t.simasName);
                return (tNorm && (normTarget.includes(tNorm) || tNorm.includes(normTarget))) ||
                       (tSimasNorm && (normTarget.includes(tSimasNorm) || tSimasNorm.includes(normTarget)));
            });
            if (m) return m;
        }

        // Fallback string dasar
        const fallbackTarget = name.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (fallbackTarget) {
            const m = teachersList.find(t => {
                const tNorm = (t.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                const tSimasNorm = (t.simasName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                return (tNorm && (tNorm.includes(fallbackTarget) || fallbackTarget.includes(tNorm))) ||
                       (tSimasNorm && (tSimasNorm.includes(fallbackTarget) || fallbackTarget.includes(tSimasNorm)));
            });
            if (m) return m;
        }
    }

    return null;
}

async function syncScheduleModal() {
    const btnSync = el('btn-sync-kbm-schedule');
    const iconSync = el('icon-sync-kbm-schedule');
    const originalIconClass = iconSync ? iconSync.className : '';

    // 1. Taktil Feedback Instan pada tombol (0ms)
    if (btnSync) {
        btnSync.disabled = true;
        btnSync.classList.add('opacity-75', 'cursor-wait');
    }
    if (iconSync) {
        iconSync.className = 'fa-solid fa-arrows-rotate animate-spin text-indigo-500';
    }

    const modal = el('modal-sync-schedule');
    if (!modal) {
        if (btnSync) {
            btnSync.disabled = false;
            btnSync.classList.remove('opacity-75', 'cursor-wait');
        }
        if (iconSync && originalIconClass) iconSync.className = originalIconClass;
        return;
    }

    // 2. Tampilkan Modal SECARA INSTAN (0ms delay) tanpa menunggu roundtrip jaringan!
    const weekBadge = el('sync-schedule-week-badge');
    if (weekBadge) {
        const mondayStr = fmtDate(_weekStartDate);
        const fridayStr = fmtDate(dateOfDay(_weekStartDate, 4));
        weekBadge.textContent = `${mondayStr} s.d ${fridayStr}`;
    }

    modal.classList.remove('hidden');

    // 3. Tampilkan status loading awal di daftar pratinjau modal
    const previewContainer = el('sync-schedule-preview-list');
    if (previewContainer) {
        previewContainer.innerHTML = `
            <div class="text-center py-8 text-slate-400 text-xs">
                <i class="fa-solid fa-spinner fa-spin text-xl mb-2 text-indigo-500"></i>
                <p id="sync-schedule-loading-text">Memeriksa pekan kerja & memuat jadwal KBM...</p>
            </div>`;
    }

    // Kembalikan tombol ke keadaan aktif karena modal sudah tampil di layar
    if (btnSync) {
        btnSync.disabled = false;
        btnSync.classList.remove('opacity-75', 'cursor-wait');
    }
    if (iconSync && originalIconClass) {
        iconSync.className = originalIconClass;
    }

    try {
        // 4. Pastikan minggu sudah diinisialisasi
        if (!_weekData?.initialized) {
            const loadingText = el('sync-schedule-loading-text');
            if (loadingText) loadingText.textContent = 'Menyiapkan pekan kerja di database...';
            try {
                const initRes = await cfInitializeWorkloadWeek({
                    week_start_date: _weekStartDate,
                    teacher_id: getEffectiveTeacherId() || undefined
                });
                _weekData = { ..._weekData, initialized: true, ...initRes.data };
                await loadWeek();
            } catch (err) {
                closeSyncScheduleModal();
                showToast('Gagal inisialisasi minggu: ' + err.message, 'error');
                return;
            }
        }

        // 5. Periksa status versi (hanya draft atau needs_revision yang dapat disunting)
        const ver = _weekData?.active_version;
        if (!_weekData?.initialized || !ver) {
            closeSyncScheduleModal();
            showToast('Data rencana mingguan belum berhasil dimuat. Silakan coba muat ulang sebelum menyinkronkan jadwal.', 'error', 8000, 'Gagal Memuat Rencana');
            return;
        }
        if (ver && !['draft', 'needs_revision'].includes(ver.status)) {
            closeSyncScheduleModal();
            showToast(`Rencana kerja minggu ini berstatus '${ver.status}' (tidak dapat diubah)`, 'warning');
            return;
        }

        const loadingText = el('sync-schedule-loading-text');
        if (loadingText) loadingText.textContent = 'Memuat dan mencocokkan jadwal dari master aSc Timetables...';

        // 6. Ambil daftar guru aSc
        _syncScheduleTeachers = await getAllScheduleTeachers();
        const select = el('select-sync-teacher');
        if (select) {
            select.innerHTML = (_syncScheduleTeachers || []).map(t => {
                const label = t.name + (t.short ? ` (${t.short})` : '');
                return `<option value="${t.id}">${label}</option>`;
            }).join('');
        }

        // Muat custom mapping terlebih dahulu
        let customMapping = null;
        try {
            customMapping = await loadCustomTeacherMapping();
        } catch (_) {}

        // Cari guru yang cocok
        const matched = findMatchedTeacher(_syncScheduleTeachers, customMapping);
        const matchBadge = el('sync-teacher-match-badge');

        if (matched) {
            _syncScheduleSelectedTeacherKey = matched.id;
            if (select) select.value = matched.id;
            if (matchBadge) {
                matchBadge.innerHTML = `<i class="fa-solid fa-circle-check text-xs"></i> <span>Terdeteksi: <strong>${matched.name}</strong></span>`;
                matchBadge.className = 'text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1.5';
            }
            await loadAndRenderSchedulePreview();
        } else {
            // Jika tidak ditemukan matchedTeacher, jangan pilih guru pertama secara liar;
            // biarkan guru memilih namanya sendiri di dropdown
            _syncScheduleSelectedTeacherKey = null;
            if (select) {
                select.insertAdjacentHTML('afterbegin', '<option value="" disabled selected>-- Pilih Nama Guru Anda --</option>');
                select.value = '';
            }
            if (matchBadge) {
                matchBadge.innerHTML = `<i class="fa-solid fa-circle-exclamation text-xs"></i> <span>Identitas tidak terdeteksi otomatis. Silakan pilih nama Anda pada menu di atas.</span>`;
                matchBadge.className = 'text-[11px] text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1.5';
            }
            if (previewContainer) {
                previewContainer.innerHTML = `
                    <div class="text-center py-8 text-slate-400 text-xs">
                        <i class="fa-solid fa-user-tag text-2xl mb-2 text-amber-500"></i>
                        <p class="font-medium text-slate-700 dark:text-slate-300">Identitas guru tidak terdeteksi otomatis</p>
                        <p class="text-[11px] mt-1 text-slate-400">Silakan pilih nama Anda pada menu dropdown di atas untuk memuat jadwal KBM Anda.</p>
                    </div>`;
            }
        }
    } catch (err) {
        console.error('[SyncSchedule] Error load schedule:', err);
        if (previewContainer) {
            previewContainer.innerHTML = `<div class="p-4 text-center text-rose-500 text-xs">Gagal memuat jadwal: ${err.message}</div>`;
        }
    } finally {
        if (btnSync) {
            btnSync.disabled = false;
            btnSync.classList.remove('opacity-75', 'cursor-wait');
        }
        if (iconSync && originalIconClass) {
            iconSync.className = originalIconClass;
        }
    }
}

async function onSyncTeacherChange() {
    const select = el('select-sync-teacher');
    if (!select || !select.value) return;
    _syncScheduleSelectedTeacherKey = select.value;

    const teacherObj = _syncScheduleTeachers.find(t => t.id === _syncScheduleSelectedTeacherKey);
    const matchBadge = el('sync-teacher-match-badge');
    if (matchBadge && teacherObj) {
        matchBadge.innerHTML = `<i class="fa-solid fa-user-tag text-xs"></i> <span>Memilih jadwal: <strong>${teacherObj.name}</strong></span>`;
        matchBadge.className = 'text-[11px] text-indigo-600 dark:text-indigo-400 font-medium flex items-center gap-1.5';
    }

    await loadAndRenderSchedulePreview();
}

async function loadAndRenderSchedulePreview() {
    if (!_syncScheduleSelectedTeacherKey) return;
    const previewContainer = el('sync-schedule-preview-list');
    if (!previewContainer) return;

    previewContainer.innerHTML = `
        <div class="text-center py-6 text-slate-400 text-xs">
            <i class="fa-solid fa-spinner fa-spin text-lg mb-1.5 text-indigo-500"></i>
            <p>Memproses slot jam pelajaran...</p>
        </div>`;

    const schedData = await getWeeklyScheduleByTeacher(_syncScheduleSelectedTeacherKey);
    if (!schedData) {
        previewContainer.innerHTML = '<div class="text-center py-6 text-slate-400 text-xs">Jadwal tidak ditemukan untuk guru ini.</div>';
        return;
    }

    const items = [];
    const existingSegments = _weekData?.segments || [];

    // Loop hari 1 s.d 5 (Senin s.d Jumat)
    for (let day = 1; day <= 5; day++) {
        const daySchedule = schedData.days[day] || [];
        const dayDate = dateOfDay(_weekStartDate, day - 1);
        const isDayHoliday = isHolidayDate(dayDate);

        // 1. Khusus Hari Senin (day = 1): Tambahkan Upacara Bendera (JP 1: 07:30 - 08:15 WITA)
        if (day === 1) {
            const upacaraStart = '07:30';
            const upacaraEnd = '08:15';
            const occIdUpacara = `${_weekStartDate}_d1_jp1_upacara_bendera`;
            const alreadyInPlanUpacara = existingSegments.some(seg => {
                if (seg.date !== dayDate) return false;
                return (seg.schedule_occurrence_id === occIdUpacara) ||
                       (seg.start_time === upacaraStart && seg.end_time === upacaraEnd) ||
                       (seg.title && seg.title.toLowerCase().includes('upacara'));
            });

            items.push({
                day_of_week: 1,
                date: dayDate,
                start_time: upacaraStart,
                end_time: upacaraEnd,
                is_teaching: 0,
                jp_count: 1,
                title: 'Upacara Bendera',
                description: 'Upacara Bendera Mingguan & Apel Sekolah (Senin JP 1)',
                catalog_id: 'cat_upacara',
                category_code: 'TUGAS_TAMBAHAN',
                schedule_occurrence_id: occIdUpacara,
                planned_minutes: 45,
                already_in_plan: alreadyInPlanUpacara,
                is_holiday_blocked: isDayHoliday,
                selected: !alreadyInPlanUpacara && !isDayHoliday
            });
        }

        let currentGroup = null;

        for (let jp = 1; jp <= 10; jp++) {
            const slot = daySchedule[jp - 1] || daySchedule.find(s => s.jp === jp);
            const mapel = (slot?.mapel || '').trim();
            const className = (slot?.className || '').trim();

            const isValidKbm = mapel && mapel.toUpperCase() !== 'UPACARA' && mapel.toUpperCase() !== 'EKSTRAKURIKULER';

            if (isValidKbm) {
                if (currentGroup && currentGroup.mapel === mapel && currentGroup.className === className && currentGroup.endJp === jp - 1) {
                    currentGroup.endJp = jp;
                    currentGroup.jpCount++;
                    const pTimes = getPeriodTimes(jp, schedData.periods);
                    currentGroup.endTime = pTimes.end;
                } else {
                    if (currentGroup) {
                        items.push(buildSyncItem(currentGroup, existingSegments, isDayHoliday));
                    }
                    const pTimes = getPeriodTimes(jp, schedData.periods);
                    currentGroup = {
                        day,
                        date: dayDate,
                        startJp: jp,
                        endJp: jp,
                        jpCount: 1,
                        mapel,
                        className,
                        startTime: pTimes.start,
                        endTime: pTimes.end
                    };
                }
            } else {
                if (currentGroup) {
                    items.push(buildSyncItem(currentGroup, existingSegments, isDayHoliday));
                    currentGroup = null;
                }
            }
        }
        if (currentGroup) {
            items.push(buildSyncItem(currentGroup, existingSegments, isDayHoliday));
        }

        // 2. Khusus Hari Jumat (day = 5): Tambahkan Membina Ekstrakurikuler (JP 10: 14:45 - 15:30 WITA)
        if (day === 5) {
            const ekstraStart = '14:45';
            const ekstraEnd = '15:30';
            const occIdEkstra = `${_weekStartDate}_d5_jp10_membina_ekstrakurikuler`;
            const alreadyInPlanEkstra = existingSegments.some(seg => {
                if (seg.date !== dayDate) return false;
                return (seg.schedule_occurrence_id === occIdEkstra) ||
                       (seg.start_time === ekstraStart && seg.end_time === ekstraEnd) ||
                       (seg.title && seg.title.toLowerCase().includes('ekstra'));
            });

            const hasConflictWithKbm = items.some(it => it.day_of_week === 5 && it.start_time === ekstraStart);
            if (!hasConflictWithKbm) {
                items.push({
                    day_of_week: 5,
                    date: dayDate,
                    start_time: ekstraStart,
                    end_time: ekstraEnd,
                    is_teaching: 0,
                    jp_count: 1,
                    title: 'Membina Kegiatan Ekstrakurikuler',
                    description: 'Pembinaan & Pelatihan Ekstrakurikuler / Krida Sekolah (Jumat JP 10)',
                    catalog_id: 'cat_ekstra',
                    category_code: 'PEMBIMBINGAN',
                    schedule_occurrence_id: occIdEkstra,
                    planned_minutes: 45,
                    already_in_plan: alreadyInPlanEkstra,
                    is_holiday_blocked: isDayHoliday,
                    selected: !alreadyInPlanEkstra && !isDayHoliday
                });
            }
        }
    }

    // Urutkan item secara kronologis per hari (hari 1 s.d 5, lalu jam mulai)
    items.sort((a, b) => {
        if (a.day_of_week !== b.day_of_week) return a.day_of_week - b.day_of_week;
        return a.start_time.localeCompare(b.start_time);
    });

    _syncScheduleItems = items;
    rememberTeacherKbmPairs(items.filter(it => it.is_teaching).map(it => parseKbmTitle(it.title)));
    // Seluruh jadwal resmi sudah ada di rencana (tak ada sesi baru) = sinkron pekan ini terpenuhi
    if (items.every(it => it.already_in_plan)) {
        markKbmSyncedForWeek();
        renderPlanSyncRequiredBanner();
    }
    renderSyncScheduleUI();
}

function buildSyncItem(group, existingSegments, isHoliday = false) {
    const plannedMinutes = calcEffective(group.startTime, group.endTime);
    const cleanMapel = group.mapel.replace(/[^a-zA-Z0-9]/g, '');
    const cleanClass = group.className.replace(/[^a-zA-Z0-9]/g, '');
    const occId = `${_weekStartDate}_d${group.day}_jp${group.startJp}_${group.endJp}_${cleanMapel}_${cleanClass}`;
    const jpLabel = group.startJp === group.endJp ? `JP ${group.startJp}` : `JP ${group.startJp}–${group.endJp}`;
    const title = buildKbmTitle(group.mapel, group.className);
    const description = `Tatap Muka KBM ${group.mapel} Kelas ${group.className} (${jpLabel})`;

    const alreadyInPlan = existingSegments.some(seg => {
        if (seg.date !== group.date) return false;
        return (seg.schedule_occurrence_id === occId) ||
               (seg.is_teaching && seg.start_time === group.startTime && seg.end_time === group.endTime);
    });

    return {
        day_of_week: group.day,
        date: group.date,
        start_time: group.startTime,
        end_time: group.endTime,
        is_teaching: 1,
        jp_count: group.jpCount,
        title,
        description,
        catalog_id: 'cat_kbm',
        schedule_occurrence_id: occId,
        planned_minutes: plannedMinutes,
        already_in_plan: alreadyInPlan,
        is_holiday_blocked: isHoliday,
        selected: !alreadyInPlan && !isHoliday
    };
}

function renderSyncScheduleUI() {
    const totalSessionsEl = el('sync-kpi-total-sessions');
    const totalJpEl = el('sync-kpi-total-jp');
    const totalMinutesEl = el('sync-kpi-total-minutes');
    const previewContainer = el('sync-schedule-preview-list');
    const btnConfirm = el('btn-confirm-sync-schedule');
    const labelConfirm = el('btn-confirm-sync-label');

    const unaddedItems = _syncScheduleItems.filter(it => !it.already_in_plan && !it.is_holiday_blocked);
    const selectedItems = _syncScheduleItems.filter(it => it.selected && !it.already_in_plan && !it.is_holiday_blocked);
    const totalSessions = selectedItems.length;
    const totalJp = selectedItems.filter(it => it.is_teaching).reduce((acc, it) => acc + (it.jp_count || 0), 0);
    const totalMinutes = selectedItems.reduce((acc, it) => acc + (it.planned_minutes || 0), 0);

    if (totalSessionsEl) totalSessionsEl.textContent = totalSessions;
    if (totalJpEl) totalJpEl.textContent = totalJp;
    if (totalMinutesEl) totalMinutesEl.textContent = totalMinutes.toLocaleString('id-ID');

    if (labelConfirm) {
        if (totalSessions > 0) {
            labelConfirm.textContent = `Sinkronkan Jadwal (${totalSessions} Sesi / ${totalJp} JP)`;
        } else if (_syncScheduleItems.length > 0 && unaddedItems.length === 0) {
            labelConfirm.textContent = 'Semua Jadwal Sudah Ada di Rencana';
        } else {
            labelConfirm.textContent = 'Sinkronkan Jadwal';
        }
    }
    if (btnConfirm) btnConfirm.disabled = totalSessions === 0;

    if (!previewContainer) return;

    if (_syncScheduleItems.length === 0) {
        previewContainer.innerHTML = `
            <div class="text-center py-8 text-slate-400 text-xs bg-slate-50 dark:bg-slate-800/30 rounded-2xl p-4 border border-dashed border-slate-200 dark:border-slate-700">
                <i class="fa-solid fa-calendar-xmark text-3xl mb-2 text-slate-300"></i>
                <p class="font-bold text-slate-600 dark:text-slate-300">Tidak ada jadwal KBM tatap muka ditemukan</p>
                <p class="mt-1 text-slate-400">Pastikan nama guru yang dipilih sesuai dengan jadwal di aSc Timetables.</p>
            </div>`;
        return;
    }

    let html = '';
    for (let day = 1; day <= 5; day++) {
        const dayDate = dateOfDay(_weekStartDate, day - 1);
        const dayItems = _syncScheduleItems.filter(it => it.day_of_week === day);
        const isDayHoliday = isHolidayDate(dayDate);
        const holInfo = isDayHoliday ? getHolidayDateInfo(dayDate) : null;

        html += `
        <div class="p-2.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 shadow-2xs space-y-2">
            <div class="flex items-center justify-between pb-1.5 border-b border-slate-100 dark:border-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200">
                <div class="flex items-center gap-1.5">
                    <span class="w-2 h-2 rounded-full ${isDayHoliday ? 'bg-amber-500' : 'bg-indigo-500'}"></span>
                    <span>${DAY_NAMES[day - 1]}</span>
                    <span class="text-[10px] text-slate-400 font-normal">(${dayDate})</span>
                    ${isDayHoliday ? `<span class="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 font-bold flex items-center gap-1" title="${escapeHTML(holInfo?.title || 'Hari Libur Resmi')}"><i class="fa-solid fa-umbrella-beach"></i> Libur Resmi</span>` : ''}
                </div>
                <span class="text-[10px] px-2 py-0.5 rounded-full ${isDayHoliday ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400' : 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400'}">
                    ${dayItems.length} sesi
                </span>
            </div>`;

        if (dayItems.length === 0) {
            html += `<div class="text-[11px] text-slate-400 italic py-1 px-2">Tidak ada kegiatan di jadwal resmi pada hari ini.</div>`;
        } else {
            dayItems.forEach(it => {
                const itemIdx = _syncScheduleItems.indexOf(it);
                let statusBadge = '';
                if (it.is_holiday_blocked) {
                    statusBadge = '<span class="px-2 py-0.5 rounded-lg text-[9px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300">Libur Resmi</span>';
                } else if (it.already_in_plan) {
                    statusBadge = '<span class="px-2 py-0.5 rounded-lg text-[9px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500">Sudah Ada di Rencana</span>';
                } else {
                    statusBadge = '<span class="px-2 py-0.5 rounded-lg text-[9px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">Baru</span>';
                }

                let typeBadge = '';
                if (it.catalog_id === 'cat_upacara') {
                    typeBadge = '<span class="text-[10px] font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1">🇮🇩 Upacara (45m)</span>';
                } else if (it.catalog_id === 'cat_ekstra') {
                    typeBadge = '<span class="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">⚽ Ekskul (45m)</span>';
                } else {
                    typeBadge = `<span class="text-[10px] font-semibold text-purple-600 dark:text-purple-400">${it.jp_count} JP (${it.planned_minutes}m)</span>`;
                }

                const itemDisabled = (it.already_in_plan || it.is_holiday_blocked) ? 'disabled' : '';
                const itemClass = (it.already_in_plan || it.is_holiday_blocked)
                    ? 'opacity-60 bg-slate-50/50 dark:bg-slate-800/30 cursor-not-allowed'
                    : 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:border-slate-200 dark:hover:border-slate-700';

                html += `
                <label class="flex items-center gap-2.5 p-2 rounded-xl transition-colors border border-transparent ${itemClass}">
                    <input type="checkbox" id="sync-item-cb-${itemIdx}" ${it.selected ? 'checked' : ''} ${itemDisabled} onchange="window.workloadToggleSyncItem(${itemIdx}, this.checked)" class="rounded text-indigo-600 focus:ring-indigo-500 ${(it.already_in_plan || it.is_holiday_blocked) ? 'cursor-not-allowed text-slate-400' : ''}">
                    <div class="shrink-0 w-28">
                        <div class="text-xs font-bold text-slate-800 dark:text-white">${it.start_time}–${it.end_time}</div>
                        ${typeBadge}
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="font-bold text-xs text-slate-800 dark:text-white truncate">${it.title}</div>
                        <div class="text-[10px] text-slate-400 truncate">${it.description}</div>
                    </div>
                    <div class="shrink-0">${statusBadge}</div>
                </label>`;
            });
        }

        html += `</div>`;
    }

    previewContainer.innerHTML = html;
}

function toggleSyncItem(idx, isChecked) {
    if (_syncScheduleItems[idx] && !_syncScheduleItems[idx].already_in_plan && !_syncScheduleItems[idx].is_holiday_blocked) {
        _syncScheduleItems[idx].selected = isChecked;
        renderSyncScheduleUI();
    }
}

function toggleSelectAllSync() {
    const unaddedItems = _syncScheduleItems.filter(it => !it.already_in_plan && !it.is_holiday_blocked);
    if (unaddedItems.length === 0) return;
    const allSelected = unaddedItems.every(it => it.selected);
    const newStatus = !allSelected;
    unaddedItems.forEach(it => it.selected = newStatus);
    renderSyncScheduleUI();
    const btn = el('btn-toggle-select-all-sync');
    if (btn) btn.textContent = newStatus ? 'Batal Pilih Semua' : 'Pilih Semua';
}

function closeSyncScheduleModal() {
    el('modal-sync-schedule')?.classList.add('hidden');
}

async function confirmSyncSchedule() {
    // Otomatis memilih sesi KBM yang belum ada dan bukan hari libur
    const selectedItems = _syncScheduleItems.filter(it => it.selected && !it.already_in_plan && !it.is_holiday_blocked);
    if (selectedItems.length === 0) {
        if (_syncScheduleItems.length > 0 && _syncScheduleItems.every(it => it.already_in_plan || it.is_holiday_blocked)) {
            showToast('Seluruh jadwal KBM resmi sudah ada di rencana kerja atau bertepatan dengan hari libur.', 'info');
            markKbmSyncedForWeek();
            closeSyncScheduleModal();
            renderPlanSyncRequiredBanner();
            return;
        }
        showToast('Pilih minimal satu sesi KBM baru untuk disinkronkan', 'warning');
        return;
    }

    if (!_weekData?.initialized || !_weekData?.active_version) {
        showToast('Versi rencana kerja tidak tersedia', 'error');
        return;
    }

    // SSOT: Otomatis memilih metode gabungkan/tambahkan yang belum ada saja (replace_existing = false) untuk menghemat kuota write D1
    const replaceExisting = false;

    const btn = el('btn-confirm-sync-schedule');
    const label = el('btn-confirm-sync-label');
    if (btn) {
        btn.disabled = true;
        if (label) label.textContent = 'Menyinkronkan...';
    }

    try {
        const weekHolidays = [];
        for (let d = 0; d < 5; d++) {
            const dStr = dateOfDay(_weekStartDate, d);
            if (isHolidayDate(dStr)) weekHolidays.push(dStr);
        }
        const payload = {
            work_week_id: _weekData.week.id,
            plan_version_id: _weekData.active_version.id,
            schedule_items: selectedItems,
            replace_existing: replaceExisting,
            holiday_dates: weekHolidays
        };

        const res = await cfSyncWorkloadSchedule(payload);
        markKbmSyncedForWeek();
        showToast(res.message || 'Jadwal KBM berhasil disinkronkan');
        closeSyncScheduleModal();
        // Muat ulang rencana agar slot langsung terisi KBM dan banner "Sinkron KBM" hilang tanpa refresh
        await loadWeek();
    } catch (err) {
        const friendlyMsg = formatSavePlanErrorMessage(err);
        showToast(friendlyMsg, 'error', 12000, 'Gagal Sinkronisasi Jadwal');
    } finally {
        if (btn) {
            btn.disabled = false;
            if (label) label.textContent = 'Sinkronkan Jadwal';
        }
    }
}

// ========== TEMPLATE CREATION MODAL & ACTIONS ==========
function openCreateTemplateModal(fromCurrentWeek = false) {
    const modal = el('modal-create-template');
    if (!modal) return;

    const titleEl = el('modal-create-template-title');
    const nameInput = el('input-template-name');
    const optWeek = el('opt-source-week');
    const optEmpty = el('opt-source-empty');
    const badgeWeek = el('badge-week-segments-count');
    const isDefaultInput = el('input-template-is-default');

    const segmentsCount = (_weekData?.segments || []).length;
    const hasSegments = segmentsCount > 0;

    if (badgeWeek) {
        badgeWeek.textContent = hasSegments ? `${segmentsCount} kegiatan` : '0 kegiatan (kosong)';
        badgeWeek.className = hasSegments
            ? 'text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
            : 'text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400';
    }

    if (optWeek) {
        optWeek.disabled = !hasSegments;
        const optWeekLabel = el('opt-source-week-label');
        if (optWeekLabel) {
            optWeekLabel.classList.toggle('opacity-50', !hasSegments);
            optWeekLabel.classList.toggle('cursor-not-allowed', !hasSegments);
        }
    }

    if (hasSegments) {
        if (titleEl) titleEl.textContent = fromCurrentWeek ? 'Simpan Rencana Jadi Template' : 'Buat Template dari Rencana';
        if (nameInput) nameInput.value = `Template Pekan ${_weekStartDate}`;
        if (optWeek) optWeek.checked = true;
    } else {
        if (titleEl) titleEl.textContent = 'Buat Template Baru';
        if (nameInput) nameInput.value = 'Template Baru';
        if (optEmpty) optEmpty.checked = true;
    }

    if (isDefaultInput) isDefaultInput.checked = false;

    modal.classList.remove('hidden');
    setTimeout(() => nameInput?.focus(), 50);
}

function closeCreateTemplateModal() {
    el('modal-create-template')?.classList.add('hidden');
}

async function confirmSaveTemplate(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();

    const name = el('input-template-name')?.value?.trim();
    if (!name) {
        showToast('Nama template wajib diisi', 'error');
        return;
    }

    const isDefault = el('input-template-is-default')?.checked ? 1 : 0;
    const source = document.querySelector('input[name="template-source"]:checked')?.value || 'empty';

    let items = [];

    if (source === 'current_week') {
        const segments = _weekData?.segments || [];
        if (segments.length === 0) {
            showToast('Rencana minggu ini belum memiliki kegiatan', 'warning');
            return;
        }
        if (!checkWeekCompleteForTemplate()) return;
        items = segments.map(s => ({
            day_of_week: s.day_of_week,
            catalog_id: s.catalog_id || 'cat_kbm',
            title: s.activity_title || s.description || 'Kegiatan KBM',
            start_time: s.start_time,
            end_time: s.end_time,
            is_teaching: s.is_teaching ? 1 : 0,
            jp_count: s.jp_count || 0,
            description: s.description || ''
        }));
    } else {
        // 'empty'
        items = [];
    }

    const btnSubmit = el('btn-submit-create-template');
    if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Menyimpan...';
    }

    try {
        await cfSaveWorkloadTemplate({
            template_name: name,
            items,
            is_default: isDefault
        });
        showToast('Template berhasil disimpan');
        closeCreateTemplateModal();
        _templates = await cfGetWorkloadTemplates();
        renderTemplatesTab();
    } catch (err) {
        showToast(err.message || 'Gagal menyimpan template', 'error');
    } finally {
        if (btnSubmit) {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = '<i class="fa-solid fa-floppy-disk mr-1"></i><span>Simpan Template</span>';
        }
    }
}

// Template hanya boleh dibuat dari rencana sepekan yang sudah penuh (slot kosong non-libur/non-cuti ditolak)
function checkWeekCompleteForTemplate() {
    const result = validateWeeklyPlanCompleteness(_weekStartDate, _weekData?.segments || [], {
        policy: _policy,
        isHolidayFn: (d) => isHolidayDate(d),
        getHolidayInfoFn: (d) => getHolidayDateInfo(d),
        actionName: 'disimpan sebagai template'
    });
    if (!result.isValid) showToast(result.message, 'warning', 8000);
    return result.isValid;
}

function saveAsTemplateModal() {
    if ((_weekData?.segments || []).length > 0 && !checkWeekCompleteForTemplate()) return;
    openCreateTemplateModal(true);
}

function openNewTemplateModal() {
    openCreateTemplateModal(false);
}

// Window bindings untuk pembantu penanda HBG
window.workloadIsActivityHbg = isActivityHbg;
window.workloadRenderHbgBadge = renderHbgBadge;

// ========== EKSPOR DOKUMEN WORD (A4 LANDSCAPE SIAP CETAK) ==========
export function getCurrentTeacherExportInfo() {
    let teacherName = _adminSelectedTeacherName || _weekData?.week?.teacher_name || '';
    let teacherNip = _weekData?.week?.teacher_nip || '';
    let teacherRank = '-';
    let teacherSubject = 'Guru Mata Pelajaran';

    if (_adminSelectedTeacherId && Array.isArray(_adminTeachersCache)) {
        const tObj = _adminTeachersCache.find(t => (t.teacher_id || t.id) === _adminSelectedTeacherId);
        if (tObj) {
            teacherName = teacherName || tObj.teacher_name || tObj.name || tObj.nama || '';
            teacherNip = teacherNip || tObj.nip || tObj.teacher_nip || '-';
            teacherRank = tObj.pangkat_golongan || tObj.rank || '-';
            teacherSubject = tObj.jenis_ptk || tObj.mapel || tObj.mata_pelajaran || 'Guru Mata Pelajaran';
        }
    }

    const authUid = auth?.currentUser?.uid || '';
    let cachedDoc = null;
    if (authUid && typeof localStorage !== 'undefined') {
        try {
            cachedDoc = JSON.parse(localStorage.getItem(`simas_user_data_${authUid}`) || 'null');
        } catch (_) {}
    }

    teacherName = teacherName || cachedDoc?.nama || cachedDoc?.name || localStorage.getItem('user_nama') || "Guru SMANTARA";
    teacherNip = teacherNip || cachedDoc?.nip || cachedDoc?.nik || localStorage.getItem('user_nip') || '-';
    teacherRank = (teacherRank && teacherRank !== '-') ? teacherRank : (cachedDoc?.pangkat_golongan || cachedDoc?.rank || '-');
    teacherSubject = (teacherSubject && teacherSubject !== 'Guru Mata Pelajaran') ? teacherSubject : (cachedDoc?.mata_pelajaran || cachedDoc?.subject || 'Guru Mata Pelajaran');

    return {
        nama: teacherName,
        nip: teacherNip,
        pangkat_golongan: teacherRank,
        mata_pelajaran: teacherSubject
    };
}

export async function exportRealizationToWord() {
    try {
        if (!_weekStartDate) {
            showToast('Pilih pekan beban kerja terlebih dahulu', 'warning');
            return;
        }
        showToast('Menyiapkan dokumen Word Realisasi (.docx)...');
        const teacherInfo = getCurrentTeacherExportInfo();
        await exportWorkloadRealizationDocx({
            weekStartDate: _weekStartDate,
            weekData: _weekData || {},
            teacherInfo
        });
        showToast('Dokumen Realisasi (.docx) berhasil diunduh');
    } catch (e) {
        console.error('[Word Export] Gagal mengekspor realisasi:', e);
        showToast('Gagal mengekspor dokumen realisasi: ' + (e.message || e), 'error');
    }
}

// =========================================================================
// REKAPITULASI REALISASI BULANAN BERBASIS 5 KATEGORI TUGAS POKOK
// Sesuai Permendikdasmen No. 11/2025 & Kepmendikdasmen No. 221/P/2025
// =========================================================================

let _rekapMonth = '';
let _rekapData = null;
let _rekapExpandedCategories = new Set();
let _rekapExpandedSubCatalogs = new Set();
let _rekapActiveSubCatalogId = null;
let _rekapSignatureDrawing = false;
let _rekapSignatureHasContent = false;
let _rekapSignatureDataUrl = '';
let _rekapSignCanvasInited = false;
let _rekapActiveCategoryCode = null;
let _rekapSelectedActivityIds = new Set();
let _rekapReportPages = [new Set()];
let _rekapPrintOrientation = 'portrait';
let _rekapLocalPhotos = {};
let _rekapPhotoCaptions = {};
let _rekapActDrawerOpen = false;
let _rekapPeriodRange = null; // { start, end } indeks minggu; null = sebulan penuh
let _rekapPeriodMonth = '';

function getInitialRekapMonth() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

function syncRekapMonthControls() {
    if (!_rekapMonth) _rekapMonth = getInitialRekapMonth();
    const [yStr, mStr] = _rekapMonth.split('-');
    const selMonth = el('select-rekap-month');
    const selYear = el('select-rekap-year');
    if (selMonth) selMonth.value = mStr;
    if (selYear) selYear.value = yStr;
    const titleEl = el('label-rekap-month-title');
    if (titleEl && _rekapData?.month_label) {
        titleEl.textContent = `Periode: ${_rekapData.month_label}`;
    }
}

export async function renderRekapTab(forceReload = false) {
    if (!canAccessMonthlyRecap()) {
        openRekapPremiumModal();
        return;
    }
    updateRealisasiToolbarVisibility();
    updatePlanToolbarVisibility();
    updateRekapToolbarVisibility();
    if (!_rekapMonth) _rekapMonth = getInitialRekapMonth();
    syncRekapMonthControls();

    const isMgr = isCurrentUserWorkloadManager();
    const hasSelectedTeacher = !!_adminSelectedTeacherId;
    const placeholder = el('admin-no-teacher-placeholder-rekap');
    const wrapper = el('rekap-main-content-wrapper');

    if (isMgr && !hasSelectedTeacher) {
        if (placeholder) placeholder.classList.remove('hidden');
        if (wrapper) wrapper.classList.add('hidden');
        updateRekapToolbarVisibility();
        return;
    }
    if (placeholder) placeholder.classList.add('hidden');
    if (wrapper) wrapper.classList.remove('hidden');
    updateRekapToolbarVisibility();

    const targetTeacherId = isMgr && _adminSelectedTeacherId ? _adminSelectedTeacherId : null;

    if (!forceReload && _rekapData && _rekapData.month === _rekapMonth && _rekapData.targetTeacherId === targetTeacherId) {
        renderRekapUI(_rekapData);
        return;
    }

    const container = el('rekap-categories-container');
    if (container) {
        container.innerHTML = `
            <div class="p-8 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 text-slate-400 text-xs">
                <i class="fa-solid fa-spinner fa-spin text-2xl mb-2 text-emerald-500"></i>
                <p>Memuat rekapitulasi realisasi bulanan...</p>
            </div>
        `;
    }

    try {
        const res = await cfGetWorkloadMonthlyRecap(_rekapMonth, targetTeacherId);
        if (res && res.success && res.data) {
            _rekapData = res.data;
            _rekapData.targetTeacherId = targetTeacherId;
            renderRekapUI(_rekapData);
        } else {
            throw new Error(res?.error || 'Format data rekapitulasi tidak sesuai');
        }
    } catch (err) {
        console.error('[renderRekapTab] Error:', err);
        if (container) {
            container.innerHTML = `
                <div class="p-8 text-center bg-white dark:bg-slate-900 rounded-2xl border border-rose-200 dark:border-rose-900/40 text-rose-600 dark:text-rose-400 text-xs space-y-2">
                    <i class="fa-solid fa-triangle-exclamation text-2xl mb-1 text-rose-500"></i>
                    <p class="font-bold">Gagal memuat rekapitulasi realisasi:</p>
                    <p class="text-slate-600 dark:text-slate-300">${escapeHTML(err.message || 'Kesalahan jaringan atau server.')}</p>
                    <button type="button" onclick="window.workloadReloadMonthlyRecap()" class="mt-2 px-3 py-1.5 rounded-xl bg-rose-600 text-white font-bold text-xs hover:bg-rose-700 active:scale-95 transition-all">
                        Coba Lagi
                    </button>
                </div>
            `;
        }
        showToast('Gagal memuat rekapitulasi realisasi: ' + (err.message || err), 'error');
    }
}

export function renderRekapUI(data) {
    if (!data) return;

    const titleEl = el('label-rekap-month-title');
    if (titleEl) titleEl.textContent = `Periode: ${data.month_label || data.month}`;

    const elHours = el('rekap-metric-hours');
    if (elHours) elHours.textContent = data.grand_total_hours_formatted || '0 Jam 0 Menit';

    const elMins = el('rekap-metric-minutes');
    if (elMins) elMins.textContent = `${(data.grand_total_minutes || 0).toLocaleString('id-ID')} Menit Riil`;

    const elJp = el('rekap-metric-jp');
    if (elJp) elJp.textContent = `${data.grand_total_teaching_jp || 0} JP`;

    const elAct = el('rekap-metric-activities');
    if (elAct) elAct.textContent = `${data.grand_total_activities || 0} Kegiatan`;

    const elDays = el('rekap-metric-days');
    if (elDays) elDays.textContent = `${data.effective_days_count || 0} Hari Efektif`;

    const elVerifPct = el('rekap-metric-verif-pct');
    if (elVerifPct) elVerifPct.textContent = `${data.verification_percentage || 0}%`;

    const elVerifCount = el('rekap-metric-verif-count');
    if (elVerifCount) {
        const verifTxt = `${data.grand_verified_count || 0} Terverifikasi`;
        const pendTxt = (data.grand_unverified_count || 0) > 0 ? `, ${data.grand_unverified_count} Pending` : '';
        elVerifCount.textContent = `${verifTxt}${pendTxt}`;
    }

    const CATEGORY_COLORS = {
        'PELAKSANAAN_KBM': { bg: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-200 dark:border-emerald-800' },
        'PERENCANAAN': { bg: 'bg-indigo-500', text: 'text-indigo-600 dark:text-indigo-400', border: 'border-indigo-200 dark:border-indigo-800' },
        'PENILAIAN': { bg: 'bg-sky-500', text: 'text-sky-600 dark:text-sky-400', border: 'border-sky-200 dark:border-sky-800' },
        'PEMBIMBINGAN': { bg: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-200 dark:border-amber-800' },
        'TUGAS_TAMBAHAN': { bg: 'bg-purple-500', text: 'text-purple-600 dark:text-purple-400', border: 'border-purple-200 dark:border-purple-800' }
    };

    const categories = Array.isArray(data.categories) ? data.categories : [];
    const barEl = el('rekap-segmented-bar');
    const legendEl = el('rekap-category-legends');

    if (barEl) {
        if (data.grand_total_minutes > 0) {
            barEl.innerHTML = categories.map(c => {
                const colors = CATEGORY_COLORS[c.code] || { bg: 'bg-slate-400' };
                const pct = c.percentage || 0;
                if (pct <= 0) return '';
                return `<div style="width: ${pct}%" class="h-full ${colors.bg} transition-all" title="${escapeHTML(c.shortName || c.name)}: ${pct}% (${c.total_hours_formatted})"></div>`;
            }).join('');
        } else {
            barEl.innerHTML = '<div style="width: 100%" class="h-full bg-slate-200 dark:bg-slate-700" title="Belum ada realisasi"></div>';
        }
    }

    if (legendEl) {
        legendEl.innerHTML = categories.map(c => {
            const colors = CATEGORY_COLORS[c.code] || { bg: 'bg-slate-400' };
            const pct = c.percentage || 0;
            return `
                <div class="flex items-center gap-1 min-w-0" title="${escapeHTML(c.name)}: ${c.total_hours_formatted}">
                    <span class="w-2 h-2 rounded-full ${colors.bg} shrink-0"></span>
                    <span class="truncate text-slate-500 dark:text-slate-400 text-[10px]">${escapeHTML(c.shortName || c.name)}:</span>
                    <span class="font-bold text-slate-700 dark:text-slate-200 text-[10px] shrink-0">${pct}%</span>
                </div>
            `;
        }).join('');
    }

    const container = el('rekap-categories-container');
    if (!container) return;

    if (categories.length === 0) {
        container.innerHTML = `
            <div class="p-8 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 text-slate-400 text-xs">
                <i class="fa-solid fa-folder-open text-2xl mb-2 text-slate-300"></i>
                <p>Tidak ada kegiatan realisasi pada bulan ${escapeHTML(data.month_label || data.month)}.</p>
            </div>
        `;
        return;
    }

    let cardsHtml = '';
    categories.forEach(cat => {
        const isExpanded = _rekapExpandedCategories.has(cat.code);
        const colors = CATEGORY_COLORS[cat.code] || { bg: 'bg-slate-500', text: 'text-slate-600', border: 'border-slate-200' };
        const activities = Array.isArray(cat.activities) ? cat.activities : [];

        // Kelompokkan butir kegiatan per sub-kegiatan (sub-catalog)
        const subCatalogMap = new Map();

        // 1. Inisialisasi kelompok berdasarkan daftar katalog dari backend (jika ada)
        if (Array.isArray(cat.sub_catalogs_list)) {
            cat.sub_catalogs_list.forEach(sc => {
                const scId = sc.catalog_id || 'lainnya';
                subCatalogMap.set(scId, {
                    catalog_id: scId,
                    catalog_name: sc.catalog_name || 'Sub Kegiatan',
                    total_minutes: Number(sc.total_minutes || 0),
                    total_activities: Number(sc.total_activities || 0),
                    total_jp: Number(sc.total_jp || 0),
                    activities: []
                });
            });
        }

        // 2. Petakan setiap butir kegiatan ke dalam kelompok yang sesuai
        activities.forEach(act => {
            const scId = act.catalog_id || 'lainnya';
            if (!subCatalogMap.has(scId)) {
                subCatalogMap.set(scId, {
                    catalog_id: scId,
                    catalog_name: act.catalog_name || act.title || 'Kegiatan Tugas Pokok',
                    total_minutes: 0,
                    total_activities: 0,
                    total_jp: 0,
                    activities: []
                });
            }
            const group = subCatalogMap.get(scId);
            group.activities.push(act);
            // Jika sub_catalogs_list belum memuat metrik, kalkulasi secara dinamis
            if (!cat.sub_catalogs_list || cat.sub_catalogs_list.length === 0) {
                group.total_minutes += Number(act.actual_minutes || 0);
                group.total_activities += 1;
                group.total_jp += Number(act.teaching_jp || 0);
            }
        });

        // 3. Konversi ke array untuk rendering (hanya kelompok yang memiliki data kegiatan)
        const subGroupsList = Array.from(subCatalogMap.values()).filter(sc => sc.activities.length > 0);

        let subCatalogsContainerHtml = '';
        if (activities.length === 0 || subGroupsList.length === 0) {
            subCatalogsContainerHtml = `
                <div class="p-6 text-center text-slate-400 text-xs italic bg-white dark:bg-slate-900 rounded-xl border border-slate-200/80 dark:border-slate-800">
                    Belum ada realisasi kegiatan yang dicatat untuk kategori ini pada bulan ${escapeHTML(data.month_label || data.month)}.
                </div>
            `;
        } else {
            subCatalogsContainerHtml = `
                <div class="space-y-3">
                    ${subGroupsList.map(sc => {
                        const subCompositeKey = `${cat.code}__${sc.catalog_id}`;
                        const isSubExpanded = _rekapExpandedSubCatalogs.has(subCompositeKey);

                        const scHours = Math.floor(sc.total_minutes / 60);
                        const scMins = sc.total_minutes % 60;
                        const scDuration = scHours > 0 ? `${scHours}j ${scMins}m` : `${scMins}m`;
                        const jpTxt = sc.total_jp > 0 ? ` · ${sc.total_jp} JP` : '';

                        let subTableRowsHtml = '';
                        if (sc.activities.length === 0) {
                            subTableRowsHtml = `
                                <tr>
                                    <td colspan="7" class="text-center py-4 text-slate-400 text-xs italic">
                                        Belum ada kegiatan untuk sub kegiatan ini.
                                    </td>
                                </tr>
                            `;
                        } else {
                            subTableRowsHtml = sc.activities.map((act, actIdx) => {
                                const dateParts = (act.date || '').split('-');
                                let formattedDate = act.date;
                                if (dateParts.length === 3) {
                                    const dObj = new Date(parseInt(dateParts[0], 10), parseInt(dateParts[1], 10) - 1, parseInt(dateParts[2], 10));
                                    const dayName = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'][dObj.getDay()] || '';
                                    formattedDate = `${dayName}, ${parseInt(dateParts[2], 10)}/${parseInt(dateParts[1], 10)}`;
                                }

                                const segs = Array.isArray(act.segments) ? act.segments : [];
                                const timeStr = segs.length > 0 ? segs.map(s => `${s.start_time} - ${s.end_time}`).join(', ') : '-';
                                const hours = Math.floor(act.actual_minutes / 60);
                                const mins = act.actual_minutes % 60;
                                const durStr = hours > 0 ? `${hours}j ${mins}m` : `${mins}m`;
                                const jpStr = act.teaching_jp > 0 ? `<span class="inline-block ml-1 px-1.5 py-0.2 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-bold text-[10px]">${act.teaching_jp} JP</span>` : '';

                                const verStatus = (act.verification_status || 'unverified').toLowerCase();
                                let verBadge = '';
                                if (verStatus === 'verified') {
                                    verBadge = '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"><i class="fa-solid fa-circle-check text-[9px]"></i> Disetujui</span>';
                                } else if (verStatus === 'rejected') {
                                    verBadge = '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800"><i class="fa-solid fa-circle-xmark text-[9px]"></i> Ditolak</span>';
                                } else {
                                    verBadge = '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800"><i class="fa-solid fa-clock text-[9px]"></i> Pending</span>';
                                }

                                let evidenceBtn = '<span class="text-slate-300 dark:text-slate-600 text-xs">-</span>';
                                if (act.evidence_url && act.evidence_url.trim()) {
                                    const cleanUrl = escapeHTML(act.evidence_url.trim());
                                    evidenceBtn = `
                                        <a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 text-[11px] font-semibold border border-blue-200 dark:border-blue-800 transition-colors" title="Buka Tautan Bukti">
                                            <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i> <span>Bukti</span>
                                        </a>
                                    `;
                                }

                                return `
                                    <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors border-b border-slate-100 dark:border-slate-800/80">
                                        <td class="px-3 py-2.5 text-center text-slate-400 font-semibold text-[11px]">${actIdx + 1}</td>
                                        <td class="px-3 py-2.5 whitespace-nowrap text-xs font-semibold text-slate-700 dark:text-slate-200">${escapeHTML(formattedDate)}</td>
                                        <td class="px-3 py-2.5">
                                            <div class="font-bold text-xs text-slate-800 dark:text-slate-100">${escapeHTML(act.title)}</div>
                                            <div class="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                                                <i class="fa-regular fa-clock text-[9px]"></i>
                                                <span>${escapeHTML(timeStr)}</span>
                                            </div>
                                        </td>
                                        <td class="px-3 py-2.5 whitespace-nowrap text-xs text-slate-700 dark:text-slate-300">
                                            <span class="font-bold">${durStr}</span>${jpStr}
                                        </td>
                                        <td class="px-3 py-2.5 text-xs text-slate-600 dark:text-slate-300 max-w-xs break-words">
                                            ${escapeHTML(act.output_summary || '-')}
                                        </td>
                                        <td class="px-3 py-2.5 whitespace-nowrap text-center">
                                            ${evidenceBtn}
                                        </td>
                                        <td class="px-3 py-2.5 whitespace-nowrap text-center">
                                            ${verBadge}
                                        </td>
                                    </tr>
                                `;
                            }).join('');
                        }

                        const isKbmSub = (cat.code === 'PELAKSANAAN_KBM') ||
                            sc.catalog_id === 'cat_kbm' ||
                            sc.catalog_id === 'kbm_intrakurikuler' ||
                            String(sc.catalog_name).toLowerCase().includes('kbm') ||
                            String(sc.catalog_name).toLowerCase().includes('mengajar') ||
                            String(sc.catalog_name).toLowerCase().includes('tatap muka');

                        return `
                            <div class="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs overflow-hidden transition-all">
                                <div class="p-3 sm:p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-slate-50/70 dark:bg-slate-800/40 hover:bg-slate-100/60 dark:hover:bg-slate-800/70 transition-colors cursor-pointer select-none" onclick="window.workloadToggleRekapSubCatalog('${escapeHTML(subCompositeKey)}')">
                                    <div class="flex items-start sm:items-center gap-2.5 min-w-0 flex-1">
                                        <div class="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60 flex items-center justify-center text-xs shrink-0 mt-0.5 sm:mt-0">
                                            <i class="fa-solid fa-list-check"></i>
                                        </div>
                                        <div class="min-w-0 flex-1">
                                            <div class="font-bold text-xs sm:text-sm text-slate-800 dark:text-white leading-snug">
                                                ${escapeHTML(sc.catalog_name)}
                                            </div>
                                            <div class="flex items-center flex-wrap gap-1.5 mt-1 text-[10px]">
                                                <span class="inline-flex items-center px-2 py-0.5 rounded-md font-bold bg-slate-200/70 dark:bg-slate-700/70 text-slate-700 dark:text-slate-200">
                                                    ${sc.activities.length} Kegiatan
                                                </span>
                                                <span class="inline-flex items-center px-2 py-0.5 rounded-md font-bold bg-emerald-100/70 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300">
                                                    ${scDuration}${jpTxt}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    <div class="flex items-center gap-2 shrink-0 self-end sm:self-center" onclick="event.stopPropagation()">
                                        ${isKbmSub ? `
                                            <a href="guru-mapel.html?tab=jurnal" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" class="px-2.5 sm:px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded-xl text-xs font-bold shadow-2xs transition-all flex items-center gap-1.5 shrink-0" title="Buka Portal Jurnal Mengajar Guru Mapel">
                                                <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i> <span>Jurnal Mengajar</span>
                                            </a>
                                        ` : ''}
                                        <button type="button" onclick="event.stopPropagation(); window.workloadOpenSubActivityReport('${escapeHTML(cat.code)}', '${escapeHTML(sc.catalog_id)}')" class="px-2.5 sm:px-3 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-2xs transition-all flex items-center gap-1.5 cursor-pointer border border-emerald-500/30 shrink-0" title="Cetak Laporan ${escapeHTML(sc.catalog_name)}">
                                            <i class="fa-solid fa-print text-xs"></i> <span>Cetak Laporan</span>
                                        </button>
                                        <button type="button" onclick="event.stopPropagation(); window.workloadToggleRekapSubCatalog('${escapeHTML(subCompositeKey)}')" class="w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-white transition-transform ${isSubExpanded ? 'rotate-180' : ''} shrink-0 cursor-pointer" title="${isSubExpanded ? 'Tutup Rincian' : 'Buka Rincian'}">
                                            <i class="fa-solid fa-chevron-down text-xs"></i>
                                        </button>
                                    </div>
                                </div>

                                <div class="${isSubExpanded ? 'block' : 'hidden'} border-t border-slate-100 dark:border-slate-800 p-2 sm:p-3 bg-white dark:bg-slate-900">
                                    <div class="overflow-x-auto rounded-lg border border-slate-200/80 dark:border-slate-800">
                                        <table class="w-full text-left text-xs border-collapse">
                                            <thead>
                                                <tr class="bg-slate-100/80 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold uppercase text-[10px] tracking-wider">
                                                    <th class="px-3 py-2.5 text-center w-10">No</th>
                                                    <th class="px-3 py-2.5 w-24">Tanggal</th>
                                                    <th class="px-3 py-2.5">Kegiatan & Waktu</th>
                                                    <th class="px-3 py-2.5 w-24">Durasi & JP</th>
                                                    <th class="px-3 py-2.5">Hasil / Output</th>
                                                    <th class="px-3 py-2.5 text-center w-20">Bukti</th>
                                                    <th class="px-3 py-2.5 text-center w-24">Status</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                ${subTableRowsHtml}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        }

        cardsHtml += `
            <div class="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden transition-all">
                <button type="button" onclick="window.workloadToggleRekapCategory('${escapeHTML(cat.code)}')" class="w-full p-3.5 sm:p-4 text-left flex items-center justify-between gap-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors cursor-pointer select-none">
                    <div class="flex items-center gap-2.5 sm:gap-3 min-w-0">
                        <div class="w-9 h-9 sm:w-10 sm:h-10 rounded-xl ${colors.bg}/15 ${colors.text} flex items-center justify-center text-base sm:text-lg shrink-0 border ${colors.border}">
                            <i class="fa-solid ${escapeHTML(cat.icon || 'fa-folder')}"></i>
                        </div>
                        <div class="min-w-0">
                            <h3 class="font-bold text-xs sm:text-sm text-slate-800 dark:text-white truncate">${escapeHTML(cat.name)}</h3>
                            <div class="flex items-center flex-wrap gap-1.5 sm:gap-2 mt-1">
                                <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold ${colors.bg}/15 ${colors.text}">
                                    ${cat.total_hours_formatted || '0j 0m'}
                                </span>
                                ${cat.total_teaching_jp > 0 ? `
                                    <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                                        ${cat.total_teaching_jp} JP
                                    </span>
                                ` : ''}
                                <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                    ${cat.total_activities || 0} Kegiatan
                                </span>
                                <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-900 text-white dark:bg-slate-700">
                                    ${cat.percentage || 0}% Beban
                                </span>
                            </div>
                        </div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        <div class="w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-white transition-transform ${isExpanded ? 'rotate-180' : ''} shrink-0">
                            <i class="fa-solid fa-chevron-down text-xs"></i>
                        </div>
                    </div>
                </button>

                <div class="${isExpanded ? 'block' : 'hidden'} border-t border-slate-100 dark:border-slate-800 p-3 sm:p-4 space-y-3 bg-slate-50/40 dark:bg-slate-950/30">
                    ${subCatalogsContainerHtml}
                </div>
            </div>
        `;
    });

    container.innerHTML = cardsHtml;
}

export function workloadNavMonth(delta) {
    if (!_rekapMonth) _rekapMonth = getInitialRekapMonth();
    const [yStr, mStr] = _rekapMonth.split('-');
    let y = parseInt(yStr, 10);
    let m = parseInt(mStr, 10) + delta;
    if (m > 12) {
        m = 1;
        y += 1;
    } else if (m < 1) {
        m = 12;
        y -= 1;
    }
    _rekapMonth = `${y}-${String(m).padStart(2, '0')}`;
    syncRekapMonthControls();
    renderRekapTab(true);
}

export function workloadOnMonthChange() {
    const selMonth = el('select-rekap-month');
    const selYear = el('select-rekap-year');
    const m = selMonth?.value || '01';
    const y = selYear?.value || '2026';
    _rekapMonth = `${y}-${m}`;
    syncRekapMonthControls();
    renderRekapTab(true);
}

export function workloadSetCurrentMonth() {
    _rekapMonth = getInitialRekapMonth();
    syncRekapMonthControls();
    renderRekapTab(true);
}

export function workloadReloadMonthlyRecap() {
    renderRekapTab(true);
}

export function workloadOnRekapTeacherChange(teacherId) {
    const selectMaster = el('select-workload-teacher');
    if (selectMaster) selectMaster.value = teacherId;
    if (typeof window.workloadOnAdminTeacherChange === 'function') {
        window.workloadOnAdminTeacherChange(teacherId).then(() => {
            renderRekapTab(true);
        }).catch(() => {
            renderRekapTab(true);
        });
    } else {
        renderRekapTab(true);
    }
}

export function workloadToggleRekapCategory(catCode) {
    if (_rekapExpandedCategories.has(catCode)) {
        _rekapExpandedCategories.delete(catCode);
    } else {
        _rekapExpandedCategories.add(catCode);
    }
    if (_rekapData) renderRekapUI(_rekapData);
}

export function workloadToggleRekapSubCatalog(compositeKey) {
    if (_rekapExpandedSubCatalogs.has(compositeKey)) {
        _rekapExpandedSubCatalogs.delete(compositeKey);
    } else {
        _rekapExpandedSubCatalogs.add(compositeKey);
    }
    if (_rekapData) renderRekapUI(_rekapData);
}

// ========== CANVA-STYLE AESTHETIC PRINT PREVIEW & SIGNATURE ==========

export function initRekapSignatureCanvas() {
    const canvas = el('rekap-signature-canvas');
    if (!canvas || _rekapSignCanvasInited) return;
    _rekapSignCanvasInited = true;

    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';

    const getPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.clientX != null ? e.clientX : (e.touches && e.touches[0]?.clientX);
        const clientY = e.clientY != null ? e.clientY : (e.touches && e.touches[0]?.clientY);
        return [
            (clientX - rect.left) * (canvas.width / rect.width),
            (clientY - rect.top) * (canvas.height / rect.height)
        ];
    };

    const startDraw = (e) => {
        _rekapSignatureDrawing = true;
        ctx.beginPath();
        ctx.moveTo(...getPos(e));
    };

    const draw = (e) => {
        if (!_rekapSignatureDrawing) return;
        e.preventDefault();
        ctx.lineTo(...getPos(e));
        ctx.stroke();
        _rekapSignatureHasContent = true;
        updateRekapSignBadge();
    };

    const stopDraw = () => {
        if (_rekapSignatureDrawing) {
            _rekapSignatureDrawing = false;
            _rekapSignatureDataUrl = canvas.toDataURL('image/png');
            updateRekapSignBadge();
        }
    };

    canvas.addEventListener('pointerdown', startDraw);
    canvas.addEventListener('pointermove', draw);
    canvas.addEventListener('pointerup', stopDraw);
    canvas.addEventListener('pointercancel', stopDraw);
    canvas.addEventListener('pointerleave', stopDraw);
}

function updateRekapSignBadge() {
    const badge = el('rekap-sign-status-badge');
    if (badge) {
        if (_rekapSignatureHasContent) {
            badge.textContent = 'Tanda Tangan Siap';
            badge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800';
        } else {
            badge.textContent = 'Belum Ada TTD';
            badge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300';
        }
    }
}

export function workloadClearRekapSignature() {
    const canvas = el('rekap-signature-canvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    _rekapSignatureHasContent = false;
    _rekapSignatureDataUrl = '';
    updateRekapSignBadge();
    workloadRefreshAestheticPreview();
}

function getActiveReportPeriod() {
    const month = _rekapData?.month || '';
    // Rentang minggu hanya berlaku untuk bulan saat rentang itu dipilih
    if (_rekapPeriodMonth !== month) {
        _rekapPeriodRange = null;
        _rekapPeriodMonth = month;
    }
    return resolveRekapReportPeriod(month, _rekapPeriodRange);
}

// Kegiatan yang tersedia untuk laporan aktif: kategori → sub kegiatan → periode
function getReportScopeActivities() {
    const cat = (_rekapData?.categories || []).find(c => c.code === _rekapActiveCategoryCode);
    const allCatActivities = Array.isArray(cat?.activities) ? cat.activities : [];
    const period = getActiveReportPeriod();
    return allCatActivities
        .filter(a => !_rekapActiveSubCatalogId || (a.catalog_id || 'lainnya') === _rekapActiveSubCatalogId)
        .filter(a => isDateInRekapPeriod(a.date, period))
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

function reportActivityHasPhoto(act) {
    return parseEvidencePhotos(act.evidence_url).length > 0 || (_rekapLocalPhotos[String(act.id)] || []).length > 0;
}

export const REKAP_MAX_REPORT_PAGES = 5;

function syncRekapSelectedActivityIds() {
    _rekapSelectedActivityIds = new Set((_rekapReportPages || []).flatMap(p => Array.from(p)));
}

// Pilih otomatis maksimal 4 kegiatan untuk halaman pertama, utamakan yang punya foto dokumentasi
function autoSelectReportActivities() {
    const picked = pickRekapReportActivities(getReportScopeActivities(), reportActivityHasPhoto, REKAP_MAX_REPORT_ACTIVITIES);
    _rekapReportPages = [new Set(picked.map(a => String(a.id)))];
    syncRekapSelectedActivityIds();
}

function updateReportSubtitle() {
    const subtitleEl = el('rekap-print-modal-subtitle');
    if (!subtitleEl || !_rekapData) return;
    const teacherName = _rekapData.teacher?.name || '-';
    syncRekapSelectedActivityIds();
    const pageCount = _rekapReportPages.length;
    const totalSelected = _rekapSelectedActivityIds.size;
    subtitleEl.textContent = `${teacherName} · ${getActiveReportPeriod().label} · ${pageCount} Lembar (${totalSelected} kegiatan terpilih)`;
}

export function workloadAddReportPage() {
    if (_rekapReportPages.length >= REKAP_MAX_REPORT_PAGES) {
        showToast(`Maksimal ${REKAP_MAX_REPORT_PAGES} halaman per laporan cetak.`, 'warning');
        return;
    }
    syncRekapSelectedActivityIds();
    const remainingScope = getReportScopeActivities().filter(a => !_rekapSelectedActivityIds.has(String(a.id)));
    const autoPicked = pickRekapReportActivities(remainingScope, reportActivityHasPhoto, REKAP_MAX_REPORT_ACTIVITIES);
    _rekapReportPages.push(new Set(autoPicked.map(a => String(a.id))));
    syncRekapSelectedActivityIds();
    renderReportActivityDrawer();
    updateReportSubtitle();
    workloadRefreshAestheticPreview();
}

export function workloadRemoveReportPage(pageIdx) {
    if (_rekapReportPages.length <= 1) return;
    const pIdx = parseInt(pageIdx, 10);
    if (pIdx >= 0 && pIdx < _rekapReportPages.length) {
        _rekapReportPages.splice(pIdx, 1);
        syncRekapSelectedActivityIds();
        renderReportActivityDrawer();
        updateReportSubtitle();
        workloadRefreshAestheticPreview();
    }
}

function setReportDrawerOpen(isOpen) {
    _rekapActDrawerOpen = !!isOpen;
    el('panel-report-act-drawer')?.classList.toggle('hidden', !_rekapActDrawerOpen);
    el('icon-report-act-drawer')?.classList.toggle('rotate-180', _rekapActDrawerOpen);
}

export function renderReportPeriodChips() {
    const wrap = el('rekap-period-chips');
    const hint = el('rekap-period-hint');
    if (!wrap || !_rekapData) return;

    const period = getActiveReportPeriod();
    wrap.innerHTML = buildRekapPeriodChipsHtml(_rekapData.month, period, _rekapPeriodRange, {
        full: 'window.workloadSetReportPeriodFull()',
        week: 'window.workloadSetReportPeriodWeek'
    });

    if (hint) {
        const count = getReportScopeActivities().length;
        hint.innerHTML = `Periode aktif: <strong class="text-emerald-700 dark:text-emerald-300">${escapeHTML(period.label)}</strong> · <span class="font-semibold text-slate-700 dark:text-slate-200">${count} kegiatan tersedia</span>. <span class="text-slate-400 text-[10.5px] hidden sm:inline">(Klik satu minggu, lalu klik minggu lain untuk rentang)</span>`;
    }
}

function onReportPeriodChanged() {
    autoSelectReportActivities();
    updateReportSubtitle();
    renderReportPeriodChips();
    renderReportActivityDrawer();
    workloadRefreshAestheticPreview();
}

export function workloadSetReportPeriodFull() {
    _rekapPeriodRange = null;
    _rekapPeriodMonth = _rekapData?.month || '';
    onReportPeriodChanged();
}

// Pola pemilih rentang: klik pertama = 1 minggu, klik kedua = rentang, klik berikutnya mulai ulang
export function workloadSetReportPeriodWeek(weekIdx) {
    const period = getActiveReportPeriod();
    _rekapPeriodRange = nextRekapWeekRange(period.isFullMonth ? null : _rekapPeriodRange, weekIdx);
    _rekapPeriodMonth = _rekapData?.month || '';
    onReportPeriodChanged();
}

function openReportModal(title) {
    _rekapPhotoCaptions = {};
    autoSelectReportActivities();

    const titleEl = el('rekap-print-modal-title');
    if (titleEl) titleEl.textContent = title;
    updateReportSubtitle();

    const kbmLinkBtn = el('rekap-print-kbm-jurnal-link');
    if (kbmLinkBtn) {
        const isKbmActive = _rekapActiveCategoryCode === 'PELAKSANAAN_KBM' ||
            _rekapActiveSubCatalogId === 'cat_kbm' ||
            _rekapActiveSubCatalogId === 'kbm_intrakurikuler' ||
            String(title).toLowerCase().includes('kbm') ||
            String(title).toLowerCase().includes('mengajar') ||
            String(title).toLowerCase().includes('pembelajaran');
        if (isKbmActive) {
            kbmLinkBtn.classList.remove('hidden');
        } else {
            kbmLinkBtn.classList.add('hidden');
        }
    }

    updateOrientationButtonsUI();
    renderReportPeriodChips();
    renderReportActivityDrawer();
    setReportDrawerOpen(getReportScopeActivities().length > REKAP_MAX_REPORT_ACTIVITIES);

    const modal = el('modal-rekap-aesthetic-print');
    if (modal) modal.classList.remove('hidden');

    initRekapSignatureCanvas();
    updateRekapSignBadge();
    workloadRefreshAestheticPreview();
}

export function workloadOpenCategoryReport(catCode) {
    if (!_rekapData || !Array.isArray(_rekapData.categories)) return;
    const cat = _rekapData.categories.find(c => c.code === catCode);
    if (!cat) return;

    _rekapActiveCategoryCode = catCode;
    _rekapActiveSubCatalogId = null;
    openReportModal(`Laporan Realisasi - ${cat.name || 'Kategori'}`);
}

export function workloadOpenSubActivityReport(catCode, subCatalogId) {
    if (!_rekapData || !Array.isArray(_rekapData.categories)) return;
    const cat = _rekapData.categories.find(c => c.code === catCode);
    if (!cat) return;

    _rekapActiveCategoryCode = catCode;
    _rekapActiveSubCatalogId = subCatalogId || null;

    const allCatActivities = Array.isArray(cat.activities) ? cat.activities : [];
    const subActivities = subCatalogId
        ? allCatActivities.filter(a => (a.catalog_id || 'lainnya') === subCatalogId)
        : allCatActivities;

    _rekapSelectedActivityIds = new Set(subActivities.map(a => String(a.id)));

    const subCatObj = (Array.isArray(cat.sub_catalogs_list) ? cat.sub_catalogs_list : []).find(s => s.catalog_id === subCatalogId);
    const subName = subCatObj ? subCatObj.catalog_name : (subActivities[0]?.catalog_name || cat.name || 'Sub Kegiatan');

    openReportModal(`Laporan Realisasi - ${subName}`);
}

export function workloadOpenSubCatalogReport(catCode, subCatalogId) {
    return workloadOpenSubActivityReport(catCode, subCatalogId);
}

export function workloadOpenMonthlyAestheticPrint() {
    if (_rekapData?.categories?.length > 0) {
        workloadOpenCategoryReport(_rekapData.categories[0].code);
    }
}

export function workloadCloseAestheticPrintModal() {
    const modal = el('modal-rekap-aesthetic-print');
    if (modal) modal.classList.add('hidden');
}

export function workloadRefreshAestheticPreview() {
    const frame = el('rekap-aesthetic-preview-frame');
    if (!frame || !_rekapData) return;

    syncRekapSelectedActivityIds();
    const html = buildAestheticCategoryReportHtml(
        _rekapActiveCategoryCode,
        _rekapData,
        _rekapSignatureDataUrl,
        _rekapPrintOrientation,
        _rekapSelectedActivityIds,
        _rekapLocalPhotos,
        _rekapActiveSubCatalogId,
        getActiveReportPeriod(),
        _rekapReportPages
    );
    frame.srcdoc = html;
    fitRekapPreviewFrame(frame, _rekapPrintOrientation, _rekapReportPages.length);
}

export function workloadPrintAestheticReport() {
    const frame = el('rekap-aesthetic-preview-frame');
    if (!frame || !frame.contentWindow) return;
    frame.contentWindow.focus();
    frame.contentWindow.print();
}

function updateOrientationButtonsUI() {
    const btnP = el('btn-rekap-orient-portrait');
    const btnL = el('btn-rekap-orient-landscape');
    const hint = el('rekap-preview-scale-hint');
    if (!btnP || !btnL) return;

    if (_rekapPrintOrientation === 'landscape') {
        btnL.className = 'px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-2xs cursor-pointer';
        btnP.className = 'px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white cursor-pointer';
        if (hint) hint.textContent = 'A4 Landscape (297 × 210 mm)';
    } else {
        btnP.className = 'px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-2xs cursor-pointer';
        btnL.className = 'px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white cursor-pointer';
        if (hint) hint.textContent = 'A4 Portrait (210 × 297 mm)';
    }
}

export function workloadToggleReportActivityDrawer() {
    setReportDrawerOpen(!_rekapActDrawerOpen);
}

export function renderReportActivityDrawer() {
    const listEl = el('rekap-report-activity-list');
    const countEl = el('rekap-selected-act-count');
    if (!listEl || !_rekapData) return;

    const activities = getReportScopeActivities();
    syncRekapSelectedActivityIds();

    if (countEl) {
        countEl.textContent = `${_rekapSelectedActivityIds.size}`;
    }

    if (activities.length === 0) {
        listEl.innerHTML = `<div class="p-3 text-center text-xs text-slate-400">Tidak ada butir kegiatan pada periode ini. Coba pilih minggu lain atau Sebulan Penuh.</div>`;
        return;
    }

    const overflowNotice = activities.length > REKAP_MAX_REPORT_ACTIVITIES ? `
        <div class="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-[11px] text-amber-800 dark:text-amber-200 flex items-start gap-2">
            <i class="fa-solid fa-lightbulb mt-0.5 text-amber-500"></i>
            <span>Ada <strong>${activities.length} kegiatan</strong> pada periode ini. Setiap lembar memuat maks. <strong>${REKAP_MAX_REPORT_ACTIVITIES} kegiatan</strong> agar foto tampil tajam & estetik. Gunakan tombol <strong>+ Tambah Halaman</strong> di bawah untuk menyusun laporan multi-lembar dalam 1 berkas.</span>
        </div>
    ` : '';

    const pagesToolbarHtml = `
        <div class="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-700/80 gap-2 flex-wrap">
            <div class="flex items-center gap-2">
                <span class="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <i class="fa-solid fa-layer-group text-emerald-500"></i>
                    <span>Penyusunan Multi-Halaman: <strong>${_rekapReportPages.length} Lembar</strong></span>
                </span>
            </div>
            <div class="flex items-center gap-1.5">
                <button type="button" onclick="window.workloadAddReportPage()" class="h-7 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold flex items-center gap-1 shadow-2xs transition-all cursor-pointer" title="Tambah lembar halaman berikutnya (maks. ${REKAP_MAX_REPORT_PAGES} lembar)">
                    <i class="fa-solid fa-plus text-[10px]"></i> <span>Tambah Halaman</span>
                </button>
            </div>
        </div>
    `;

    const pagesSectionsHtml = _rekapReportPages.map((pageSet, pageIdx) => {
        const pageCount = pageSet.size;
        const isPageFull = pageCount >= REKAP_MAX_REPORT_ACTIVITIES;

        const activitiesListHtml = activities.map((act) => {
            const actId = String(act.id);
            const isChecked = pageSet.has(actId);
            const otherPageIdx = _rekapReportPages.findIndex((p, idx) => idx !== pageIdx && p.has(actId));
            const isLockedByOther = otherPageIdx !== -1;
            const isLockedByFull = !isChecked && isPageFull;
            const isLocked = isLockedByOther || isLockedByFull;

            const cloudPhotos = parseEvidencePhotos(act.evidence_url);
            const localPhotos = _rekapLocalPhotos[actId] || [];
            const canAddPhoto = cloudPhotos.length + localPhotos.length < REKAP_MAX_REPORT_PHOTOS;

            const allPhotos = [];
            const miniThumbs = [];

            cloudPhotos.forEach((p) => {
                const fId = p.fileId || extractGoogleDriveFileId(p.url);
                const src = fId ? `https://lh3.googleusercontent.com/d/${encodeURIComponent(fId)}` : p.url;
                miniThumbs.push(`<img src="${src}" class="w-7 h-7 rounded object-cover border border-slate-200" title="Foto dari Cloud" onerror="this.style.display='none'">`);
                const pIdx = allPhotos.length;
                const capKey = `${actId}_${pIdx}`;
                const capVal = Object.prototype.hasOwnProperty.call(_rekapPhotoCaptions, capKey)
                    ? _rekapPhotoCaptions[capKey]
                    : (p.caption || (!isGenericCaption(p.name) ? p.name : '') || '');
                allPhotos.push({ src, capVal, isLocal: false, localIdx: -1 });
            });

            localPhotos.forEach((src, lIdx) => {
                miniThumbs.push(`
                    <div class="relative group/ph inline-block">
                        <img src="${src}" class="w-7 h-7 rounded object-cover border border-indigo-400" title="Foto Lokal Cetak">
                        <button type="button" onclick="window.workloadRemoveLocalPhoto('${actId}', ${lIdx})" class="absolute -top-1 -right-1 w-3.5 h-3.5 bg-rose-500 text-white rounded-full flex items-center justify-center text-[8px] hover:bg-rose-600 cursor-pointer" title="Hapus foto lokal">×</button>
                    </div>
                `);
                const pIdx = allPhotos.length;
                const capKey = `${actId}_${pIdx}`;
                const capVal = Object.prototype.hasOwnProperty.call(_rekapPhotoCaptions, capKey)
                    ? _rekapPhotoCaptions[capKey]
                    : '';
                allPhotos.push({ src, capVal, isLocal: true, localIdx: lIdx });
            });

            const hours = Math.floor((act.actual_minutes || 0) / 60);
            const mins = (act.actual_minutes || 0) % 60;
            const durStr = hours > 0 ? `${hours}j ${mins}m` : `${mins}m`;
            const jpTxt = act.teaching_jp > 0 ? ` · ${act.teaching_jp} JP` : '';

            const lockTitle = isLockedByOther
                ? `Sudah dipilih di Halaman ${otherPageIdx + 1}`
                : (isLockedByFull ? `Maksimal ${REKAP_MAX_REPORT_ACTIVITIES} kegiatan per lembar` : '');

            const photoCaptionsEditorHtml = (isChecked && allPhotos.length > 0) ? `
                <div class="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-col gap-1.5 w-full">
                    <div class="text-[10px] font-bold text-slate-600 dark:text-slate-300 flex items-center justify-between">
                        <span class="flex items-center gap-1"><i class="fa-solid fa-tags text-[9px] text-emerald-600"></i> Caption Foto (${allPhotos.length}):</span>
                        <span class="text-[9px] text-slate-400">Tampil pada sel foto cetak</span>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        ${allPhotos.map((ph, phIdx) => `
                            <div class="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800/60 p-1.5 rounded-lg border border-slate-200/80 dark:border-slate-700/80 min-w-0">
                                <div class="relative shrink-0">
                                    <img src="${ph.src}" class="w-8 h-8 rounded object-cover border border-slate-200 dark:border-slate-700" alt="" onerror="this.style.display='none'">
                                    <span class="absolute -top-1 -left-1 px-1 rounded-full bg-slate-800 text-[8px] font-bold text-white">${phIdx + 1}</span>
                                </div>
                                <textarea
                                    rows="2"
                                    placeholder="Caption foto ${phIdx + 1}..."
                                    oninput="window.workloadUpdateRekapPrintPhotoCaption('${actId}', ${phIdx}, this.value)"
                                    class="flex-1 min-w-0 text-[10px] leading-snug px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-white placeholder:text-slate-400 focus:outline-hidden focus:ring-1 focus:ring-emerald-500 resize-none overflow-y-auto"
                                    title="Caption untuk foto ${phIdx + 1}"
                                >${escapeHTML(ph.capVal)}</textarea>
                                ${ph.isLocal ? `
                                    <button type="button" onclick="window.workloadRemoveLocalPhoto('${actId}', ${ph.localIdx})" class="w-5 h-5 rounded-md bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-300 flex items-center justify-center text-[10px] shrink-0 cursor-pointer" title="Hapus foto lokal">
                                        <i class="fa-solid fa-trash-can text-[9px]"></i>
                                    </button>
                                ` : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : '';

            return `
                <div class="p-2 sm:p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex flex-col justify-between gap-2 transition-colors ${isChecked ? 'ring-1 ring-emerald-500/30' : (isLockedByOther ? 'opacity-40 bg-slate-50/50 dark:bg-slate-950/40' : 'opacity-70')}">
                    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 w-full">
                        <div class="flex items-start gap-2.5 min-w-0 flex-1">
                            <input type="checkbox" ${isChecked ? 'checked' : ''} ${isLocked ? `disabled title="${escapeHTML(lockTitle)}"` : ''} onchange="window.workloadToggleReportActivityForPage(${pageIdx}, '${actId}', this.checked)" class="mt-1 rounded text-emerald-600 focus:ring-emerald-500 ${isLocked ? 'cursor-not-allowed' : 'cursor-pointer'} shrink-0">
                            <div class="min-w-0">
                                <div class="text-xs font-bold text-slate-800 dark:text-white truncate flex items-center gap-2">
                                    <span class="truncate">${escapeHTML(act.title || 'Kegiatan')}</span>
                                    ${isLockedByOther ? `<span class="shrink-0 px-1.5 py-0.5 rounded-md bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[9px] font-bold">Dipilih di Hal ${otherPageIdx + 1}</span>` : ''}
                                </div>
                                <div class="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-2 flex-wrap">
                                    <span><i class="fa-regular fa-calendar text-[9px]"></i> ${escapeHTML(act.date || '-')}</span>
                                    <span>•</span>
                                    <span><i class="fa-regular fa-clock text-[9px]"></i> ${durStr}${jpTxt}</span>
                                    <span>•</span>
                                    <span class="truncate max-w-[150px]">${escapeHTML(act.catalog_name || '')}</span>
                                </div>
                            </div>
                        </div>

                        <div class="flex items-center gap-2 shrink-0 self-end sm:self-center">
                            <div class="flex items-center gap-1">
                                ${miniThumbs.join('')}
                            </div>

                            ${canAddPhoto ? `
                            <label class="h-6 px-2 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-colors" title="Unggah foto lokal khusus cetak infografis ini (maks. ${REKAP_MAX_REPORT_PHOTOS} foto per kegiatan)">
                                <i class="fa-solid fa-camera text-[9px]"></i>
                                <span>+ Foto</span>
                                <input type="file" accept="image/*" class="hidden" onchange="window.workloadUploadLocalPhoto('${actId}', this)">
                            </label>` : `<span class="text-[10px] font-semibold text-slate-400" title="Batas foto per kegiatan tercapai">Maks. ${REKAP_MAX_REPORT_PHOTOS} foto</span>`}
                        </div>
                    </div>
                    ${photoCaptionsEditorHtml}
                </div>
            `;
        }).join('');

        return `
            <div class="p-3 rounded-2xl border border-slate-200 dark:border-slate-700/80 bg-slate-50/70 dark:bg-slate-800/40 space-y-2.5">
                <div class="flex items-center justify-between gap-2 flex-wrap">
                    <div class="flex items-center gap-2">
                        <span class="px-2 py-0.5 rounded-lg bg-slate-800 text-white dark:bg-emerald-600 text-xs font-extrabold tracking-wide">
                            Halaman ${pageIdx + 1}
                        </span>
                        <span class="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                            (${pageCount}/${REKAP_MAX_REPORT_ACTIVITIES} Terpilih)
                        </span>
                    </div>
                    <div class="flex items-center gap-1.5">
                        <button type="button" onclick="window.workloadToggleReportSelectAll(true, ${pageIdx})" class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:text-emerald-600 cursor-pointer shadow-2xs">
                            Pilih Cepat
                        </button>
                        <button type="button" onclick="window.workloadToggleReportSelectAll(false, ${pageIdx})" class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:text-rose-600 cursor-pointer shadow-2xs">
                            Kosongkan
                        </button>
                        ${pageIdx > 0 ? `
                            <button type="button" onclick="window.workloadRemoveReportPage(${pageIdx})" class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-300 hover:bg-rose-100 cursor-pointer flex items-center gap-1" title="Hapus lembar ini">
                                <i class="fa-solid fa-trash-can text-[9px]"></i> Hapus Lembar
                            </button>
                        ` : ''}
                    </div>
                </div>
                <div class="space-y-1.5">
                    ${activitiesListHtml}
                </div>
            </div>
        `;
    }).join('');

    listEl.innerHTML = overflowNotice + pagesToolbarHtml + `<div class="space-y-3">${pagesSectionsHtml}</div>`;
}

export function workloadToggleReportActivityForPage(pageIdx, actId, isChecked) {
    const safeIdx = parseInt(pageIdx, 10) || 0;
    if (!_rekapReportPages[safeIdx]) _rekapReportPages[safeIdx] = new Set();
    const pageSet = _rekapReportPages[safeIdx];
    const sId = String(actId);

    if (isChecked) {
        if (pageSet.size >= REKAP_MAX_REPORT_ACTIVITIES) {
            showToast(`Maksimal ${REKAP_MAX_REPORT_ACTIVITIES} kegiatan per lembar. Hapus centang salah satu atau tambah lembar baru.`, 'warning');
            renderReportActivityDrawer();
            return;
        }
        // Pastikan tidak ada di halaman lain (anti-duplikasi)
        _rekapReportPages.forEach((p, idx) => {
            if (idx !== safeIdx) p.delete(sId);
        });
        pageSet.add(sId);
    } else {
        pageSet.delete(sId);
    }
    syncRekapSelectedActivityIds();
    renderReportActivityDrawer();
    updateReportSubtitle();
    workloadRefreshAestheticPreview();
}

export function workloadToggleReportActivity(actId, isChecked) {
    workloadToggleReportActivityForPage(0, actId, isChecked);
}

export function workloadToggleReportSelectAll(selectAll, pageIdx = 0) {
    const safeIdx = parseInt(pageIdx, 10) || 0;
    if (!_rekapReportPages[safeIdx]) _rekapReportPages[safeIdx] = new Set();

    if (selectAll) {
        const otherSelected = new Set(
            _rekapReportPages.flatMap((p, idx) => idx !== safeIdx ? Array.from(p) : [])
        );
        const available = getReportScopeActivities().filter(a => !otherSelected.has(String(a.id)));
        const picked = pickRekapReportActivities(available, reportActivityHasPhoto, REKAP_MAX_REPORT_ACTIVITIES);
        _rekapReportPages[safeIdx] = new Set(picked.map(a => String(a.id)));
    } else {
        _rekapReportPages[safeIdx] = new Set();
    }
    syncRekapSelectedActivityIds();
    renderReportActivityDrawer();
    updateReportSubtitle();
    workloadRefreshAestheticPreview();
}

export function workloadUploadLocalPhoto(actId, fileInput) {
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) return;
    const file = fileInput.files[0];
    if (!file.type.startsWith('image/')) {
        showToast('Mohon pilih berkas gambar yang sah (JPG, PNG, WebP).', 'info');
        return;
    }
    const act = getReportScopeActivities().find(a => String(a.id) === String(actId));
    const existing = (act ? parseEvidencePhotos(act.evidence_url).length : 0) + (_rekapLocalPhotos[actId] || []).length;
    if (existing >= REKAP_MAX_REPORT_PHOTOS) {
        showToast(`Maksimal ${REKAP_MAX_REPORT_PHOTOS} foto per kegiatan.`, 'warning');
        fileInput.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = e => {
        const dataUrl = e.target.result;
        if (!_rekapLocalPhotos[actId]) {
            _rekapLocalPhotos[actId] = [];
        }
        _rekapLocalPhotos[actId].push(dataUrl);
        renderReportActivityDrawer();
        workloadRefreshAestheticPreview();
    };
    reader.readAsDataURL(file);
    fileInput.value = '';
}

export function workloadRemoveLocalPhoto(actId, photoIdx) {
    if (_rekapLocalPhotos[actId] && _rekapLocalPhotos[actId][photoIdx]) {
        _rekapLocalPhotos[actId].splice(photoIdx, 1);
        const act = getReportScopeActivities().find(a => String(a.id) === String(actId));
        const cloudCount = act ? parseEvidencePhotos(act.evidence_url).length : 0;
        const targetKey = `${actId}_${cloudCount + photoIdx}`;
        delete _rekapPhotoCaptions[targetKey];
        renderReportActivityDrawer();
        workloadRefreshAestheticPreview();
    }
}

export function workloadUpdateRekapPrintPhotoCaption(actId, photoIdx, newCaption) {
    const key = `${actId}_${photoIdx}`;
    _rekapPhotoCaptions[key] = String(newCaption || '').trim();
    workloadRefreshAestheticPreview();
}

export function workloadSetReportOrientation(orientation) {
    if (orientation !== 'portrait' && orientation !== 'landscape') orientation = 'portrait';
    _rekapPrintOrientation = orientation;
    updateOrientationButtonsUI();
    workloadRefreshAestheticPreview();
}

// Batas kegiatan per lembar infografis agar area foto tetap lega
export const REKAP_MAX_REPORT_ACTIVITIES = 4;
// Batas foto (cloud + unggahan lokal khusus cetak) per kegiatan
export const REKAP_MAX_REPORT_PHOTOS = 5;

// Gabungan foto cloud (Google Drive) + foto lokal khusus cetak, dipotong sesuai batas
function collectRekapActivityPhotos(act, localPhotosMap = {}) {
    const photos = [];
    const actId = String(act.id);
    parseEvidencePhotos(act.evidence_url).forEach(p => {
        const fId = p.fileId || extractGoogleDriveFileId(p.url);
        const directUrl = fId ? `https://lh3.googleusercontent.com/d/${encodeURIComponent(fId)}` : p.url;
        photos.push({ url: directUrl, caption: p.caption || (!isGenericCaption(p.name) ? p.name : '') || '' });
    });
    ((localPhotosMap && localPhotosMap[actId]) || []).forEach(dataUrl => photos.push({ url: dataUrl, caption: '' }));
    return photos.slice(0, REKAP_MAX_REPORT_PHOTOS).map((p, idx) => {
        const key = `${actId}_${idx}`;
        const overriddenCaption = Object.prototype.hasOwnProperty.call(_rekapPhotoCaptions, key)
            ? _rekapPhotoCaptions[key]
            : p.caption;
        return {
            ...p,
            caption: overriddenCaption
        };
    });
}

export function cleanRekapCategoryName(cat) {
    if (!cat) return 'Tugas Pokok';
    if (typeof cat === 'string') {
        return cat.replace(/^\d+\.\s*/, '').replace(/\s*\([^)]*\)$/, '').trim() || 'Tugas Pokok';
    }
    if (cat.shortName) return String(cat.shortName).trim();
    const raw = String(cat.name || '').trim();
    return raw.replace(/^\d+\.\s*/, '').replace(/\s*\([^)]*\)$/, '').trim() || 'Tugas Pokok';
}

export function buildAestheticCategoryReportHtml(catCode, rekap, signatureDataUrl = '', orientation = 'portrait', selectedActIds = null, localPhotosMap = {}, subCatalogId = null, period = null, reportPages = null) {
    const teacher = rekap?.teacher || {};
    const categories = Array.isArray(rekap?.categories) ? rekap.categories : [];
    const cat = categories.find(c => c.code === catCode) || categories[0] || {};
    const activePeriod = period || resolveRekapReportPeriod(rekap?.month, null);

    const schoolCity = (typeof SCHOOL_CONFIG !== 'undefined' && SCHOOL_CONFIG?.schoolCity) || 'Abang';
    const schoolName = (typeof SCHOOL_CONFIG !== 'undefined' && SCHOOL_CONFIG?.schoolName) || "SMA Negeri Nusantara";

    // Titimangsa menyesuaikan tanggal cetak riil saat ini (WITA)
    const now = new Date();
    const printDay = now.getDate();
    const printMonth = REKAP_MONTH_NAMES[now.getMonth()] || '';
    const printYear = now.getFullYear();
    const titimangsaStr = `${schoolCity}, ${printDay} ${printMonth} ${printYear}`;

    const allCatActivities = Array.isArray(cat?.activities) ? cat.activities : [];
    const scopeActivities = allCatActivities
        .filter(a => !subCatalogId || (a.catalog_id || 'lainnya') === subCatalogId)
        .filter(a => isDateInRekapPeriod(a.date, activePeriod));

    const mapActToInfographic = (act) => {
        const hours = Math.floor((act.actual_minutes || 0) / 60);
        const mins = (act.actual_minutes || 0) % 60;
        const durStr = hours > 0 ? `${hours}j ${mins}m` : `${mins}m`;
        const jpTxt = act.teaching_jp > 0 ? ` · ${act.teaching_jp} JP` : '';
        return {
            date: act.date,
            timeStr: `⏱ ${durStr}${jpTxt}`,
            title: act.title || 'Kegiatan',
            sub: act.catalog_name || '',
            chips: [],
            output: act.output_summary || '',
            photos: collectRekapActivityPhotos(act, localPhotosMap)
        };
    };

    let pagesData = null;
    let selectedActivities = [];
    if (Array.isArray(reportPages) && reportPages.length > 0) {
        pagesData = reportPages.map(pageSet => {
            const pageActList = scopeActivities.filter(a => pageSet.has(String(a.id))).slice(0, REKAP_MAX_REPORT_ACTIVITIES);
            return pageActList.map(mapActToInfographic);
        });
        selectedActivities = scopeActivities.filter(a => {
            return reportPages.some(pageSet => pageSet.has(String(a.id)));
        });
    } else {
        selectedActivities = (selectedActIds
            ? scopeActivities.filter(a => selectedActIds.has(String(a.id)))
            : scopeActivities.slice()
        ).sort((a, b) => (a.date || '').localeCompare(b.date || '')).slice(0, REKAP_MAX_REPORT_ACTIVITIES);
    }

    const subCatalogItem = subCatalogId ? (Array.isArray(cat?.sub_catalogs_list) ? cat.sub_catalogs_list : []).find(s => s.catalog_id === subCatalogId) : null;
    const catCleanName = cleanRekapCategoryName(cat);
    const catDisplayName = subCatalogItem ? subCatalogItem.catalog_name : catCleanName;
    const catSubDesc = subCatalogItem ? `Sub Kegiatan dari ${catCleanName}` : (cat?.sub_catalogs_list?.map(s => s.catalog_name).slice(0, 3).join(' · ') || 'Rincian Realisasi Tugas Pokok');
    const catBadgeCode = `${selectedActivities.length} Kegiatan`;

    const totalMinutes = selectedActivities.reduce((acc, a) => acc + (a.actual_minutes || 0), 0);
    const totalHours = Math.floor(totalMinutes / 60);
    const totalMinsRem = totalMinutes % 60;
    const totalHoursFormatted = totalHours > 0 ? `${totalHours}j ${totalMinsRem}m` : `${totalMinsRem}m`;
    const totalTeachingJp = selectedActivities.reduce((acc, a) => acc + (a.teaching_jp || 0), 0);
    const activeDays = new Set(selectedActivities.map(a => String(a.date || '').slice(0, 10)).filter(Boolean)).size;
    const verifiedCount = selectedActivities.filter(a => a.verification_status === 'verified').length;
    const verifiedPct = selectedActivities.length > 0 ? Math.round((verifiedCount / selectedActivities.length) * 100) : 100;
    const n = selectedActivities.length;

    const activities = pagesData ? (pagesData[0] || []) : selectedActivities.map(mapActToInfographic);

    const remainingCount = Math.max(0, scopeActivities.length - n);
    const scopeNote = remainingCount > 0
        ? `Menampilkan ${n} dari ${scopeActivities.length} kegiatan pada periode ini`
        : `${scopeActivities.length} kegiatan pada periode ini`;

    const teacherNip = (teacher.nip && teacher.nip !== '-')
        ? teacher.nip
        : ((typeof window !== 'undefined' && (window.currentUserProfile?.nip || window.currentUser?.nip)) || teacher.nip || '-');
    const formattedNip = formatRekapNip(teacherNip);

    return buildRekapInfographicHtml({
        orientation,
        docTitle: `Laporan Kegiatan - ${catDisplayName} - ${teacher.name || ''}`,
        schoolName,
        kicker: 'Jurnal Kegiatan Guru',
        title: catDisplayName,
        subtitle: catSubDesc,
        person: {
            name: teacher.name,
            nip: teacherNip,
            nipFormatted: formattedNip,
            role: formattedNip,
            foto: teacher.foto
        },
        period: {
            shortLabel: activePeriod.shortLabel,
            rangeText: activePeriod.isFullMonth ? (rekap?.month_label || activePeriod.rangeText) : activePeriod.rangeText,
            monthOnly: rekap?.month_label || activePeriod.monthOnly || activePeriod.rangeText,
            monthLabel: rekap?.month_label || activePeriod.monthLabel || activePeriod.rangeText
        },
        titimangsa: titimangsaStr,
        stats: [
            { ico: '⏱', val: totalHoursFormatted, lbl: 'Total waktu' },
            { ico: '✦', val: catBadgeCode, lbl: 'Ditampilkan' },
            totalTeachingJp > 0
                ? { ico: '📚', val: `${totalTeachingJp} JP`, lbl: 'Tatap muka' }
                : { ico: '🗓', val: `${activeDays} Hari`, lbl: 'Hari aktif' },
            { ico: '✓', val: `${verifiedPct}%`, lbl: `${verifiedCount}/${n} disetujui` }
        ],
        activities,
        pages: pagesData,
        footTitle: 'Rekap Realisasi Kinerja Guru',
        footLines: [`${scopeNote} · Acuan Permendikdasmen No. 11/2025`, 'Dibuat melalui SIMAS E-Kinerja'],
        signatureDataUrl
    });
}

export function buildAestheticMonthlyReportHtml(rekap, signatureDataUrl = '') {
    const defaultCatCode = rekap?.categories?.[0]?.code || 'PELAKSANAAN_KBM';
    return buildAestheticCategoryReportHtml(defaultCatCode, rekap, signatureDataUrl, 'portrait', null, {});
}

// BINDINGS KE WINDOW UNTUK EVENT HANDLER HTML
if (typeof window !== 'undefined') {
    window.workloadNavMonth = workloadNavMonth;
    window.workloadOnMonthChange = workloadOnMonthChange;
    window.workloadSetCurrentMonth = workloadSetCurrentMonth;
    window.workloadOnRekapTeacherChange = workloadOnRekapTeacherChange;
    window.workloadReloadMonthlyRecap = workloadReloadMonthlyRecap;
    window.workloadOpenCategoryReport = workloadOpenCategoryReport;
    window.workloadOpenMonthlyAestheticPrint = workloadOpenMonthlyAestheticPrint;
    window.workloadPrintAestheticReport = workloadPrintAestheticReport;
    window.workloadCloseAestheticPrintModal = workloadCloseAestheticPrintModal;
    window.workloadClearRekapSignature = workloadClearRekapSignature;
    window.workloadRefreshAestheticPreview = workloadRefreshAestheticPreview;
    window.workloadToggleRekapCategory = workloadToggleRekapCategory;
    window.workloadToggleRekapSubCatalog = workloadToggleRekapSubCatalog;
    window.workloadOpenSubActivityReport = workloadOpenSubActivityReport;
    window.workloadOpenSubCatalogReport = workloadOpenSubCatalogReport;
    window.workloadRenderRekapTab = renderRekapTab;
    window.workloadSetReportOrientation = workloadSetReportOrientation;
    window.workloadSetReportPeriodFull = workloadSetReportPeriodFull;
    window.workloadSetReportPeriodWeek = workloadSetReportPeriodWeek;
    window.workloadToggleReportActivityDrawer = workloadToggleReportActivityDrawer;
    window.workloadToggleReportSelectAll = workloadToggleReportSelectAll;
    window.workloadToggleReportActivity = workloadToggleReportActivity;
    window.workloadToggleReportActivityForPage = workloadToggleReportActivityForPage;
    window.workloadAddReportPage = workloadAddReportPage;
    window.workloadRemoveReportPage = workloadRemoveReportPage;
    window.workloadUploadLocalPhoto = workloadUploadLocalPhoto;
    window.workloadRemoveLocalPhoto = workloadRemoveLocalPhoto;
    window.workloadUpdateRekapPrintPhotoCaption = workloadUpdateRekapPrintPhotoCaption;
    window.workloadOpenAddUnplannedForSlot = openAddUnplannedForSlot;
    window.workloadSyncLogStatusOptions = syncLogStatusOptions;
    window.cleanRekapCategoryName = cleanRekapCategoryName;
    window.workloadUpdateMonitoringToolbarVisibility = updateMonitoringToolbarVisibility;
    window.workloadHighlightEvidencePhotoSection = highlightEvidencePhotoSection;
    window.workloadAskPhotoConfirmation = askPhotoConfirmation;
    window.workloadCanTriggerSilentJournalSync = canTriggerSilentJournalSync;
    window.workloadFormatSavePlanErrorMessage = formatSavePlanErrorMessage;
    window.workloadFormatPlanOverlapMessage = formatPlanOverlapMessage;
    window.workloadOpenTemplateDetail = openTemplateDetail;
    window.workloadCloseTemplateDetail = closeTemplateDetail;
    window.workloadFormatDurationToJp = formatDurationToJp;
}




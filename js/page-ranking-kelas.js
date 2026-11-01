/**
 * js/page-ranking-kelas.js - Modul Monitoring & Ranking Kinerja Rombel Kelas
 * Single Source of Truth (SSOT): Cloudflare D1 (Siswa, Kelas, BK) & Supabase (Presensi, SPP, Perpustakaan)
 * Optimasi: Efisiensi kuota database via Edge API D1 & multi-tier cache memory/sessionStorage (Helper getWaliKelasCache tetap memverifikasi otorisasi)
 * Standar: OWASP Top 10 & ASVS Level 1/2
 */

import { auth, supabase, resolvePhotoUrl } from "./config.js";
import { cfClient } from "./cloudflare-client.js";
import { initLayout, showToast, escapeHTML } from "./global.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

// =====================================
// KONFIGURASI & STATE
// =====================================
const CACHE_KEY = 'simas_class_ranking_cache_v3';
const CACHE_TTL = 15 * 60 * 1000; // 15 Menit

let activeRequestId = 0;

let state = {
    activeCategory: 'spp',     // 'spp' | 'attendance' | 'discipline' | 'library' | 'overall'
    gradeFilter: 'all',        // 'all' | 'X' | 'XI' | 'XII'
    periodScope: 'semester',   // 'month' | 'semester' | 'year' (Default: Semester Berjalan)
    searchQuery: '',
    viewMode: 'table',         // 'table' | 'grid'
    classesList: [],           // List of active classes: ['X-1', ...]
    studentsList: [],          // Active students
    rawMetrics: {},            // className -> metrics object
    rankedClasses: [],         // Computed ranking array
    lastFetchedAt: 0,
    isFetching: false,
    sourcesStatus: {
        attendance: { status: 'idle', count: 0, error: null },
        spp: { status: 'idle', count: 0, error: null },
        discipline: { status: 'idle', count: 0, error: null },
        library: { status: 'idle', count: 0, error: null }
    },
    isDataComplete: false,
    snapshotScope: 'semester',
    snapshotRange: { startDate: '', endDate: '' },
    isStaleCache: false
};

// =====================================
// KONFIGURASI KRITERIA & BOBOT PENILAIAN (SSOT)
// =====================================
export const DEFAULT_RANKING_CRITERIA = {
    visible: {
        attendance: true,
        spp: true,
        discipline: true,
        library: true
    },
    weights: {
        attendance: 40,
        spp: 30,
        discipline: 20,
        library: 10
    }
};

let rankingCriteriaState = JSON.parse(JSON.stringify(DEFAULT_RANKING_CRITERIA));

export async function loadRankingCriteriaConfig() {
    let cfg = null;
    try {
        const cachedStr = localStorage.getItem('simas_ranking_criteria_config');
        if (cachedStr) cfg = JSON.parse(cachedStr);
    } catch (e) {}

    if (!cfg && cfClient && typeof cfClient.getSystemSetting === 'function') {
        try {
            cfg = await cfClient.getSystemSetting('ranking_criteria_config');
            if (cfg) localStorage.setItem('simas_ranking_criteria_config', JSON.stringify(cfg));
        } catch (e) {
            console.warn('[RankingKelas] Error fetching ranking_criteria_config:', e);
        }
    }

    if (cfg && typeof cfg === 'object') {
        rankingCriteriaState = {
            visible: {
                attendance: cfg.visible?.attendance !== false,
                spp: cfg.visible?.spp !== false,
                discipline: cfg.visible?.discipline !== false,
                library: cfg.visible?.library !== false
            },
            weights: {
                attendance: typeof cfg.weights?.attendance === 'number' ? cfg.weights.attendance : DEFAULT_RANKING_CRITERIA.weights.attendance,
                spp: typeof cfg.weights?.spp === 'number' ? cfg.weights.spp : DEFAULT_RANKING_CRITERIA.weights.spp,
                discipline: typeof cfg.weights?.discipline === 'number' ? cfg.weights.discipline : DEFAULT_RANKING_CRITERIA.weights.discipline,
                library: typeof cfg.weights?.library === 'number' ? cfg.weights.library : DEFAULT_RANKING_CRITERIA.weights.library
            }
        };
    } else {
        rankingCriteriaState = JSON.parse(JSON.stringify(DEFAULT_RANKING_CRITERIA));
    }

    applyRankingCriteriaUI();
    return rankingCriteriaState;
}

export function applyRankingCriteriaUI() {
    const vis = rankingCriteriaState.visible || DEFAULT_RANKING_CRITERIA.visible;
    const w = rankingCriteriaState.weights || DEFAULT_RANKING_CRITERIA.weights;

    // 1. Visibilitas Header Kolom Tabel
    const thMap = {
        attendance: document.getElementById('th-attendance'),
        spp: document.getElementById('th-spp'),
        discipline: document.getElementById('th-discipline'),
        library: document.getElementById('th-library')
    };
    Object.entries(thMap).forEach(([key, el]) => {
        if (el) {
            if (!vis[key]) el.classList.add('hidden');
            else el.classList.remove('hidden');
        }
    });

    // 2. Visibilitas Kartu Highlight Metrik di Atas
    const cardMap = {
        attendance: document.getElementById('card-stat-attendance'),
        spp: document.getElementById('card-stat-spp'),
        discipline: document.getElementById('card-stat-discipline')
    };
    Object.entries(cardMap).forEach(([key, el]) => {
        if (el) {
            if (!vis[key]) el.classList.add('hidden');
            else el.classList.remove('hidden');
        }
    });

    // 3. Update Daftar Bobot pada Footer Transparansi
    const listEl = document.getElementById('ranking-weights-list');
    if (listEl) {
        const items = [];
        if (vis.attendance) {
            items.push(`<li><strong>Kehadiran Siswa (${w.attendance}%):</strong> Berdasarkan persentase kehadiran harian siswa (<em class="text-slate-600 dark:text-slate-300">(Hadir + Dispensasi) / Total Pertemuan</em>) dari SSOT Supabase.</li>`);
        }
        if (vis.spp) {
            items.push(`<li><strong>Kelancaran SPP (${w.spp}%):</strong> Berdasarkan rasio siswa yang telah melunasi kewajiban iuran SPP rombel.</li>`);
        }
        if (vis.discipline) {
            items.push(`<li><strong>Kedisiplinan & Karakter (${w.discipline}%):</strong> Berdasarkan akumulasi total poin pelanggaran BK pada rentang tanggal periode filter (sistem saldo kredit 100% dikurangi rata-rata poin pelanggaran rombel ditambah apresiasi prestasi).</li>`);
        }
        if (vis.library) {
            items.push(`<li><strong>Literasi Perpustakaan (${w.library}%):</strong> Mengapresiasi keaktifan peminjaman buku perpustakaan sekolah per rombel.</li>`);
        }
        if (items.length === 0) {
            items.push(`<li><em>Tidak ada kriteria penilaian yang aktif.</em></li>`);
        }
        listEl.innerHTML = items.join('');
    }

    // 4. Update Panduan Pilar Kinerja pada Layar Kunci Jadwal secara dinamis
    renderLockScreenCriteriaPillars();
}

/**
 * Render kartu panduan pilar penilaian pada layar kunci jadwal secara dinamis
 * sesuai konfigurasi rankingCriteriaState (SSOT) yang diatur oleh Super Admin.
 */
export function renderLockScreenCriteriaPillars() {
    const gridEl = document.getElementById('lock-criteria-grid');
    const titleEl = document.getElementById('lock-criteria-title');
    const totalWeightEl = document.getElementById('lock-criteria-total-weight');

    if (!gridEl) return;

    const vis = rankingCriteriaState?.visible || DEFAULT_RANKING_CRITERIA.visible;
    const w = rankingCriteriaState?.weights || DEFAULT_RANKING_CRITERIA.weights;

    const pillarDefinitions = [
        {
            key: 'attendance',
            label: 'Kehadiran',
            desc: 'Maksimalkan presensi harian, tekan sakit/izin/alpa rombel.',
            icon: 'fa-solid fa-user-check text-emerald-500'
        },
        {
            key: 'spp',
            label: 'Kelancaran SPP',
            desc: 'Tuntaskan kewajiban iuran komite/SPP kelas tepat waktu.',
            icon: 'fa-solid fa-file-invoice-dollar text-blue-500'
        },
        {
            key: 'discipline',
            label: 'Kedisiplinan',
            desc: 'Jaga saldo kredit 100%, nihil pelanggaran, dan raih prestasi.',
            icon: 'fa-solid fa-shield-halved text-purple-500'
        },
        {
            key: 'library',
            label: 'Literasi Perpus',
            desc: 'Aktifkan sirkulasi dan peminjaman buku perpustakaan rombel.',
            icon: 'fa-solid fa-book-open-reader text-rose-500'
        }
    ];

    const activePillars = pillarDefinitions.filter(p => vis[p.key] !== false);
    const totalActiveWeight = activePillars.reduce((sum, p) => sum + (Number(w[p.key]) || 0), 0);

    if (activePillars.length === 0) {
        if (titleEl) titleEl.textContent = "Pilar Penilaian Indeks Bintang SMANTARA:";
        if (totalWeightEl) totalWeightEl.textContent = 'Total Bobot: 0%';
        gridEl.className = 'w-full';
        gridEl.innerHTML = `
            <div class="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400">
                <i class="fa-solid fa-circle-info mr-1.5 text-amber-500"></i>
                Saat ini belum ada kriteria penilaian yang diaktifkan oleh Super Admin.
            </div>
        `;
        return;
    }

    if (titleEl) {
        titleEl.textContent = `${activePillars.length} Pilar Penilaian Indeks Bintang SMANTARA:`;
    }

    if (totalWeightEl) {
        totalWeightEl.textContent = `Total Bobot: ${totalActiveWeight}%`;
    }

    // Grid responsif otomatis sesuai jumlah pilar aktif
    let gridColsClass = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5';
    if (activePillars.length === 3) {
        gridColsClass = 'grid grid-cols-1 sm:grid-cols-3 gap-2.5';
    } else if (activePillars.length === 2) {
        gridColsClass = 'grid grid-cols-1 sm:grid-cols-2 gap-2.5';
    } else if (activePillars.length === 1) {
        gridColsClass = 'grid grid-cols-1 gap-2.5 max-w-md mx-auto';
    }
    gridEl.className = gridColsClass;

    gridEl.innerHTML = activePillars.map(p => {
        const weightVal = Number(w[p.key]) || 0;
        return `
            <div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 flex items-start gap-2.5">
                <i class="${p.icon} mt-1 text-sm shrink-0"></i>
                <div>
                    <strong class="text-xs font-bold text-slate-800 dark:text-white block">${p.label} (${weightVal}%)</strong>
                    <p class="text-[10.5px] text-slate-500 dark:text-slate-400 leading-snug">${p.desc}</p>
                </div>
            </div>
        `;
    }).join('');
}

// =====================================
// KONFIGURASI HAK AKSES MODUL (SUPER ADMIN ONLY)
// =====================================
export const PRIMARY_ROLES = [
    { key: 'super_admin', label: 'Super Admin', locked: true, badge: 'Pokok' },
    { key: 'kepala_sekolah', label: 'Kepala Sekolah', badge: 'Pokok' },
    { key: 'wakasek_kurikulum', label: 'Wakasek Kurikulum', badge: 'Pokok' },
    { key: 'kesiswaan', label: 'Kesiswaan', badge: 'Pokok' },
    { key: 'guru_mapel', label: 'Guru Mata Pelajaran', badge: 'Pokok' },
    { key: 'staff', label: 'Staf Administrasi (TU)', badge: 'Pokok' },
    { key: 'siswa', label: 'Siswa', badge: 'Pokok' }
];

export const ADDITIONAL_ROLES = [
    { key: 'wali_kelas', label: 'Wali Kelas', badge: 'Tugas Tambahan' },
    { key: 'guru_bk', label: 'Guru Bimbingan Konseling (BK)', badge: 'Tugas Tambahan' },
    { key: 'kepala_lab', label: 'Kepala Laboratorium', badge: 'Tugas Tambahan' },
    { key: 'admin_spp', label: 'Admin Keuangan SPP', badge: 'Tugas Tambahan' },
    { key: 'admin_perpus', label: 'Admin Perpustakaan', badge: 'Tugas Tambahan' },
    { key: 'admin_pks', label: 'Admin PKS (Ketertiban)', badge: 'Tugas Tambahan' },
    { key: 'admin_kelas', label: 'Admin Presensi Kelas', badge: 'Tugas Tambahan' },
    { key: 'admin_sukaduka', label: 'Admin Suka-Duka', badge: 'Tugas Tambahan' },
    { key: 'admin_duta', label: "Admin Duta CERDAS", badge: 'Tugas Tambahan' }
];

export const ALL_AVAILABLE_ROLES = [...PRIMARY_ROLES, ...ADDITIONAL_ROLES];

let accessSettingsState = {
    mode: 'roles', // 'all' | 'roles' | 'specific_users' | 'combined'
    allowed_roles: ['super_admin', 'kepala_sekolah', 'wakasek_kurikulum', 'kesiswaan', 'kepala_lab', 'admin_spp', 'admin_perpus', 'wali_kelas', 'staff', 'guru_mapel', 'guru_bk', 'admin_pks', 'admin_kelas', 'admin_sukaduka', 'admin_duta', 'siswa'],
    allowed_users: [],
    schedule: {
        enabled: true, // Default aktif: Jumat 12:15 s.d. Senin 10:00 WITA
        startDay: 5,   // 5 = Jumat (12:15 WITA)
        startHour: 12,
        startMinute: 15,
        endDay: 1,     // 1 = Senin
        endHour: 10,   // 10:00 WITA
        endMinute: 0,
        customMotivationMessage: ''
    }
};

let lockCountdownTimer = null;
let isPreviewingLockedScreen = false;

/**
 * Mengevaluasi apakah saat ini berada dalam rentang jadwal aktif (Jumat 12:15 s.d. Senin 10:00 WITA).
 * Standar SSOT Operasional Sekolah: WITA / Asia/Makassar (UTC+8).
 *
 * @param {Date} [targetDate=new Date()]
 * @param {Object} [scheduleConfig]
 * @returns {Object}
 */
export function checkRankingScheduleWindow(targetDate = new Date(), scheduleConfig = null) {
    const d = targetDate instanceof Date && !isNaN(targetDate.getTime()) ? targetDate : new Date();
    // Shift epoch ke WITA (+8 jam)
    const witaEpoch = d.getTime() + 8 * 3600000;
    const witaDate = new Date(witaEpoch);

    const day = witaDate.getUTCDay(); // 0 = Minggu, 1 = Senin, ..., 5 = Jumat, 6 = Sabtu
    const hour = witaDate.getUTCHours();
    const minute = witaDate.getUTCMinutes();
    const second = witaDate.getUTCSeconds();

    const isEnabled = !scheduleConfig || scheduleConfig.enabled !== false;
    if (!isEnabled) {
        return {
            isOpen: true,
            isScheduleEnabled: false,
            currentWita: witaDate,
            day, hour, minute, second,
            scheduleText: 'Jadwal terbuka penuh (Pembatasan nonaktif)'
        };
    }

    // Default jadwal: Jumat (12:15 WITA) s.d. Senin (10:00 WITA)
    const startHour = typeof scheduleConfig?.startHour === 'number' ? scheduleConfig.startHour : 12;
    const startMinute = typeof scheduleConfig?.startMinute === 'number' ? scheduleConfig.startMinute : 15;
    const endHour = typeof scheduleConfig?.endHour === 'number' ? scheduleConfig.endHour : 10;
    const endMinute = typeof scheduleConfig?.endMinute === 'number' ? scheduleConfig.endMinute : 0;

    let isOpen = false;
    if (day === 5) {
        isOpen = (hour > startHour || (hour === startHour && minute >= startMinute));
    } else if (day === 6 || day === 0) {
        isOpen = true;
    } else if (day === 1) {
        isOpen = (hour < endHour || (hour === endHour && minute < endMinute));
    } else {
        isOpen = false;
    }

    // Hitung pembukaan berikutnya (Jumat terdekat pukul startHour:startMinute:00 WITA)
    let daysUntilFriday = 0;
    if (day === 5) {
        if (!isOpen) {
            daysUntilFriday = 0; // Jumat hari ini sebelum jam buka (12:15 WITA)
        } else {
            daysUntilFriday = 7;
        }
    } else if (day === 6) {
        daysUntilFriday = 6;
    } else if (day === 0) {
        daysUntilFriday = 5;
    } else if (day === 1) {
        daysUntilFriday = 4; // Senin setelah 10:00 -> Jumat (4 hari)
    } else if (day === 2) {
        daysUntilFriday = 3; // Selasa -> Jumat (3 hari)
    } else if (day === 3) {
        daysUntilFriday = 2; // Rabu -> Jumat (2 hari)
    } else if (day === 4) {
        daysUntilFriday = 1; // Kamis -> Jumat (1 hari)
    } else {
        daysUntilFriday = (12 - day) % 7 || 7;
    }

    const witaYear = witaDate.getUTCFullYear();
    const witaMonth = witaDate.getUTCMonth();
    const witaDay = witaDate.getUTCDate();

    // Waktu buka Jumat startHour:startMinute:00 WITA dalam UTC epoch
    const nextFridayUtc = new Date(Date.UTC(witaYear, witaMonth, witaDay + daysUntilFriday, startHour, startMinute, 0));
    // Konversi balik ke real date epoch (kurangi 8 jam)
    const nextOpenRealDate = new Date(nextFridayUtc.getTime() - 8 * 3600000);
    const timeRemainingMs = Math.max(0, nextOpenRealDate.getTime() - d.getTime());

    const startMinutePad = String(startMinute).padStart(2, '0');
    const startHourPad = String(startHour).padStart(2, '0');
    const endMinutePad = String(endMinute).padStart(2, '0');
    const endHourPad = String(endHour).padStart(2, '0');

    return {
        isOpen,
        isScheduleEnabled: true,
        currentWita: witaDate,
        day,
        hour,
        minute,
        second,
        nextOpenRealDate,
        timeRemainingMs,
        scheduleText: `Setiap hari Jumat pukul ${startHourPad}:${startMinutePad} s.d. Senin pukul ${endHourPad}:${endMinutePad} WITA`
    };
}

/**
 * Tampilkan tampilan lock screen ramah & edukatif dengan countdown real-time.
 * Mencegah pemanggilan query database saat di luar jadwal (100% hemat kuota read database).
 */
export function renderRankingScheduleLockScreen(scheduleInfo, isPreview = false) {
    const lockContainer = document.getElementById('ranking-schedule-lock-container');
    const mainContent = document.getElementById('ranking-main-content');
    const previewBar = document.getElementById('lock-admin-preview-bar');
    const adminBanner = document.getElementById('super-admin-schedule-banner');

    if (!lockContainer) return;

    if (mainContent) mainContent.classList.add('hidden');
    lockContainer.classList.remove('hidden');

    if (previewBar) {
        if (isPreview) previewBar.classList.remove('hidden');
        else previewBar.classList.add('hidden');
    }

    if (adminBanner) {
        if (isPreview) adminBanner.classList.add('hidden');
    }

    // Sembunyikan tombol aksi data (segarkan & cetak) jika bukan pratinjau super admin
    const btnRefresh = document.getElementById('btn-refresh-ranking');
    const btnPrint = document.querySelector('button[onclick*="printRankingReport"]');
    const cacheIndicator = document.getElementById('cache-status-indicator');

    if (btnRefresh && !isPreview) btnRefresh.classList.add('hidden');
    if (btnPrint && !isPreview) btnPrint.classList.add('hidden');
    if (cacheIndicator && !isPreview) cacheIndicator.classList.add('hidden');

    // Terapkan pesan motivasi kustom jika dikonfigurasi
    const customMotiv = accessSettingsState.schedule?.customMotivationMessage;
    const motivEl = document.getElementById('lock-motivation-text');
    if (motivEl && customMotiv && customMotiv.trim()) {
        motivEl.textContent = customMotiv.trim();
    }

    // Perbarui Panduan Pilar Kinerja pada Layar Kunci sesuai konfigurasi kriteria/bobot dinamis (SSOT)
    renderLockScreenCriteriaPillars();

    // Format Tanggal Buka Berikutnya
    const daysIndo = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const monthsIndo = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

    const nextDate = scheduleInfo.nextOpenRealDate;
    if (nextDate) {
        const nextWita = new Date(nextDate.getTime() + 8 * 3600000);
        const dayName = daysIndo[nextWita.getUTCDay()];
        const dayNum = nextWita.getUTCDate();
        const monthName = monthsIndo[nextWita.getUTCMonth()];
        const year = nextWita.getUTCFullYear();
        const hh = String(nextWita.getUTCHours()).padStart(2, '0');
        const mm = String(nextWita.getUTCMinutes()).padStart(2, '0');
        const nextDateEl = document.getElementById('lock-next-open-date');
        if (nextDateEl) {
            nextDateEl.textContent = `${dayName}, ${dayNum} ${monthName} ${year} • ${hh}:${mm} WITA`;
        }
    }

    // Real-Time WITA Clock & Countdown Tick
    if (lockCountdownTimer) {
        clearInterval(lockCountdownTimer);
        lockCountdownTimer = null;
    }

    const updateClockAndCountdown = () => {
        const now = new Date();
        const nowWita = new Date(now.getTime() + 8 * 3600000);

        const dName = daysIndo[nowWita.getUTCDay()];
        const dNum = nowWita.getUTCDate();
        const mName = monthsIndo[nowWita.getUTCMonth()];
        const yNum = nowWita.getUTCFullYear();
        const hh = String(nowWita.getUTCHours()).padStart(2, '0');
        const mm = String(nowWita.getUTCMinutes()).padStart(2, '0');
        const ss = String(nowWita.getUTCSeconds()).padStart(2, '0');

        const clockEl = document.getElementById('lock-current-wita-time');
        if (clockEl) {
            clockEl.textContent = `${dName}, ${dNum} ${mName} ${yNum} • ${hh}:${mm}:${ss} WITA`;
        }

        // Countdown
        const countdownEl = document.getElementById('lock-countdown-display');
        if (countdownEl && scheduleInfo.nextOpenRealDate) {
            const diffMs = Math.max(0, scheduleInfo.nextOpenRealDate.getTime() - now.getTime());
            if (diffMs <= 0 && !isPreview) {
                countdownEl.textContent = 'Jadwal dibuka! Memuat ulang...';
                clearInterval(lockCountdownTimer);
                setTimeout(() => window.location.reload(), 1500);
                return;
            }

            const totalSec = Math.floor(diffMs / 1000);
            const days = Math.floor(totalSec / 86400);
            const hours = Math.floor((totalSec % 86400) / 3600);
            const mins = Math.floor((totalSec % 3600) / 60);
            const secs = totalSec % 60;

            let countText = '';
            if (days > 0) countText += `${days} hari `;
            countText += `${hours} jam ${mins} menit ${secs} dtk`;
            countdownEl.textContent = countText;
        }
    };

    updateClockAndCountdown();
    lockCountdownTimer = setInterval(updateClockAndCountdown, 1000);
}

/**
 * Super Admin Pratinjau Tampilan Terkunci
 */
export function previewLockedScreen() {
    isPreviewingLockedScreen = true;
    const scheduleInfo = checkRankingScheduleWindow(new Date(), accessSettingsState.schedule);
    renderRankingScheduleLockScreen(scheduleInfo, true);
}

/**
 * Keluar dari Pratinjau Layar Terkunci
 */
export function exitLockedScreenPreview() {
    isPreviewingLockedScreen = false;
    if (lockCountdownTimer) {
        clearInterval(lockCountdownTimer);
        lockCountdownTimer = null;
    }

    const lockContainer = document.getElementById('ranking-schedule-lock-container');
    const mainContent = document.getElementById('ranking-main-content');
    const adminBanner = document.getElementById('super-admin-schedule-banner');
    const btnRefresh = document.getElementById('btn-refresh-ranking');
    const btnPrint = document.querySelector('button[onclick*="printRankingReport"]');
    const cacheIndicator = document.getElementById('cache-status-indicator');

    if (lockContainer) lockContainer.classList.add('hidden');
    if (mainContent) mainContent.classList.remove('hidden');
    if (adminBanner) adminBanner.classList.remove('hidden');
    if (btnRefresh) btnRefresh.classList.remove('hidden');
    if (btnPrint) btnPrint.classList.remove('hidden');
    if (cacheIndicator) cacheIndicator.classList.remove('hidden');
}

export async function checkUserRankingPermission(currentUser) {
    const allRoles = typeof window.getAllUserRoles === 'function' ? window.getAllUserRoles() : [localStorage.getItem('user_role') || ''];
    if (allRoles.includes('super_admin') || allRoles.includes('kepala_sekolah')) return true;

    let cfg = null;
    try {
        const cachedStr = localStorage.getItem('simas_ranking_access_config');
        if (cachedStr) cfg = JSON.parse(cachedStr);
    } catch (e) {}

    if (!cfg && cfClient && typeof cfClient.getSystemSetting === 'function') {
        try {
            cfg = await cfClient.getSystemSetting('ranking_access_config');
            if (cfg) localStorage.setItem('simas_ranking_access_config', JSON.stringify(cfg));
        } catch (e) {
            console.warn('[RankingKelas] Error fetching ranking_access_config:', e);
        }
    }

    if (cfg && typeof cfg === 'object') {
        accessSettingsState.mode = cfg.mode || 'roles';
        if (Array.isArray(cfg.allowed_roles)) accessSettingsState.allowed_roles = cfg.allowed_roles;
        if (Array.isArray(cfg.allowed_users)) accessSettingsState.allowed_users = cfg.allowed_users;
        if (cfg.schedule && typeof cfg.schedule === 'object') {
            accessSettingsState.schedule = {
                enabled: cfg.schedule.enabled !== false,
                startDay: 5,
                startHour: typeof cfg.schedule.startHour === 'number' ? cfg.schedule.startHour : 12,
                startMinute: typeof cfg.schedule.startMinute === 'number' ? cfg.schedule.startMinute : 15,
                endDay: 1,
                endHour: typeof cfg.schedule.endHour === 'number' ? cfg.schedule.endHour : 10,
                endMinute: typeof cfg.schedule.endMinute === 'number' ? cfg.schedule.endMinute : 0,
                customMotivationMessage: cfg.schedule.customMotivationMessage || ''
            };
        }
    }

    if (!cfg || !cfg.mode || cfg.mode === 'all') return true;

    const userIdentifiers = [];
    if (currentUser?.email) userIdentifiers.push(currentUser.email.toLowerCase().trim());
    if (currentUser?.uid) userIdentifiers.push(currentUser.uid.trim());
    const localEmail = (localStorage.getItem('user_email') || '').toLowerCase().trim();
    if (localEmail) userIdentifiers.push(localEmail);
    const localUsername = (localStorage.getItem('user_username') || '').toLowerCase().trim();
    if (localUsername) userIdentifiers.push(localUsername);
    const localNip = (localStorage.getItem('user_nip') || '').trim();
    if (localNip) userIdentifiers.push(localNip);
    const localNis = (localStorage.getItem('user_nis') || '').trim();
    if (localNis) userIdentifiers.push(localNis);

    const allowedRoles = Array.isArray(cfg.allowed_roles) ? cfg.allowed_roles : [];
    const allowedUsers = (Array.isArray(cfg.allowed_users) ? cfg.allowed_users : []).map(u => String(u || '').toLowerCase().trim());

    const roleMatch = allRoles.some(r => allowedRoles.includes(r));
    const userMatch = userIdentifiers.some(id => allowedUsers.includes(id));

    if (cfg.mode === 'roles') {
        return roleMatch;
    } else if (cfg.mode === 'specific_users') {
        return userMatch;
    } else if (cfg.mode === 'combined') {
        return roleMatch || userMatch;
    }
    return true;
}

// =====================================
// INISIALISASI HALAMAN & AUTH
// =====================================
document.addEventListener('DOMContentLoaded', () => {
    // Pastikan inisialisasi halaman penuh hanya dijalankan pada halaman ranking-kelas.html
    const isRankingPage = window.location.pathname.endsWith('ranking-kelas.html') || 
                          window.location.pathname.endsWith('ranking-kelas') || 
                          document.getElementById('ranking-main-content');
    if (!isRankingPage) return;

    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.replace('index.html');
            return;
        }

        const role = localStorage.getItem('user_role') || 'guru_mapel';
        const allRoles = typeof window.getAllUserRoles === 'function' ? window.getAllUserRoles() : [role];
        const isSuperAdmin = allRoles.includes('super_admin');
        const isKepalaSekolah = allRoles.includes('kepala_sekolah');
        const isPrivilegedAccess = isSuperAdmin || isKepalaSekolah;

        // 1. Verifikasi Izin Akses Dinamis RBAC ke Halaman Ini
        const hasAccess = await checkUserRankingPermission(user);
        if (!hasAccess) {
            console.warn('[RankingKelas] Akses halaman dibatasi oleh kebijakan Super Admin.');
            if (typeof showToast === 'function') {
                showToast('Akses Dibatasi', 'Halaman Ranking Kelas saat ini tidak dibuka untuk akun Anda.', 'warning');
            }
            window.location.replace('dashboard.html');
            return;
        }

        if (typeof initLayout === 'function') {
            await initLayout(role);
        }

        // Tampilkan tombol pengaturan akses HANYA untuk Super Admin
        const btnAccess = document.getElementById('btn-ranking-access-settings');
        if (btnAccess && isSuperAdmin) {
            btnAccess.classList.remove('hidden');
        }

        const mainEl = document.querySelector('main');
        if (mainEl) mainEl.classList.remove('hidden');

        // Muat konfigurasi kriteria & bobot penilaian (SSOT)
        await loadRankingCriteriaConfig();

        // 2. Evaluasi Pembatasan Jadwal Waktu Akses (WITA: Jumat 12:15 s.d. Senin 10:00 WITA)
        const scheduleInfo = checkRankingScheduleWindow(new Date(), accessSettingsState.schedule);

        if (!scheduleInfo.isOpen && !isPrivilegedAccess) {
            // PENGGUNA UMUM DI LUAR JADWAL:
            // 0 Database Read! Jangan panggil loadRankingData!
            if (typeof showToast === 'function') {
                showToast(
                    'Jadwal Pemantauan Ranking Kelas',
                    'Papan Ranking Kelas hanya dibuka setiap hari Jumat pukul 12:15 s.d. Senin pukul 10:00 WITA. Mari fokus tingkatkan kinerja rombel!',
                    'info'
                );
            }
            renderRankingScheduleLockScreen(scheduleInfo, false);
            return;
        }

        // SUPER ADMIN & KEPALA SEKOLAH DI LUAR JADWAL: Tampilkan banner status info
        if (!scheduleInfo.isOpen && isPrivilegedAccess) {
            const adminBanner = document.getElementById('super-admin-schedule-banner');
            if (adminBanner) {
                adminBanner.classList.remove('hidden');
                const bannerTitle = document.getElementById('super-admin-banner-title');
                if (bannerTitle) {
                    bannerTitle.innerHTML = isKepalaSekolah && !isSuperAdmin
                        ? '<strong class="font-bold">Akses Penuh Kepala Sekolah Aktif:</strong>'
                        : '<strong class="font-bold">Akses Penuh Super Admin Aktif:</strong>';
                }
            }
        }

        // JIKA JADWAL DIBUKA ATAU USER PRIVILEGED (SUPER ADMIN / KEPALA SEKOLAH): Muat data ranking
        await loadRankingData(false);
    });
});

// =====================================
// LOGIKA TANGGAL & RENTANG WAKTU (WITA SSOT)
// =====================================
function getDateRangeForScope(scope) {
    const todayStr = typeof window.getWitaISODate === 'function'
        ? window.getWitaISODate()
        : new Date().toISOString().substring(0, 10);

    const now = new Date(todayStr);
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1 - 12

    let startDate = todayStr;
    let expectedSppMonths = []; // Array of { year, month } yang telah jatuh tempo

    if (scope === 'month') {
        // Awal bulan berjalan s.d. hari ini
        startDate = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
        expectedSppMonths = [{ year: currentYear, month: currentMonth }];
    } else if (scope === 'semester') {
        // Gunakan getCurrentSemesterRange jika tersedia
        if (typeof window.getCurrentSemesterRange === 'function') {
            const sem = window.getCurrentSemesterRange(now);
            startDate = sem.startDate || (currentMonth >= 7 ? `${currentYear}-07-01` : `${currentYear}-01-01`);
        } else {
            startDate = currentMonth >= 7 ? `${currentYear}-07-01` : `${currentYear}-01-01`;
        }

        // Tentukan bulan-bulan yang telah berjalan di semester aktif
        if (currentMonth >= 7) {
            // Semester Ganjil: bulan 7 sampai currentMonth
            for (let m = 7; m <= currentMonth; m++) {
                expectedSppMonths.push({ year: currentYear, month: m });
            }
        } else {
            // Semester Genap: bulan 1 sampai currentMonth
            for (let m = 1; m <= currentMonth; m++) {
                expectedSppMonths.push({ year: currentYear, month: m });
            }
        }
    } else if (scope === 'year') {
        // Tahun Ajaran berjalan (Mulai 1 Juli)
        const ayStartYear = currentMonth >= 7 ? currentYear : currentYear - 1;
        startDate = `${ayStartYear}-07-01`;

        // Bulan-bulan sejak 1 Juli tahun ajaran hingga bulan saat ini
        if (currentMonth >= 7) {
            for (let m = 7; m <= currentMonth; m++) {
                expectedSppMonths.push({ year: ayStartYear, month: m });
            }
        } else {
            // Paruh pertama (Juli - Des)
            for (let m = 7; m <= 12; m++) {
                expectedSppMonths.push({ year: ayStartYear, month: m });
            }
            // Paruh kedua (Jan - currentMonth)
            for (let m = 1; m <= currentMonth; m++) {
                expectedSppMonths.push({ year: currentYear, month: m });
            }
        }
    }

    if (expectedSppMonths.length === 0) {
        expectedSppMonths = [{ year: currentYear, month: currentMonth }];
    }

    return { startDate, endDate: todayStr, currentYear, currentMonth, expectedSppMonths };
}

// =====================================
// HELPER FORMAT RENTANG TANGGAL & INDIKATOR PERIODE
// =====================================
export function formatRangeIndo(startDateStr, endDateStr) {
    if (!startDateStr || !endDateStr) return '-';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const parse = (dStr) => {
        const parts = String(dStr).split('-');
        return { d: parseInt(parts[2], 10), m: parseInt(parts[1], 10) - 1, y: parseInt(parts[0], 10) };
    };
    const start = parse(startDateStr);
    const end = parse(endDateStr);
    if (isNaN(start.d) || isNaN(end.d)) return `${startDateStr} – ${endDateStr}`;
    if (start.y === end.y) {
        if (start.m === end.m) {
            return `${start.d} – ${end.d} ${months[end.m]} ${end.y}`;
        }
        return `${start.d} ${months[start.m]} – ${end.d} ${months[end.m]} ${end.y}`;
    }
    return `${start.d} ${months[start.m]} ${start.y} – ${end.d} ${months[end.m]} ${end.y}`;
}

export function updatePeriodDisplayUI(scope, startDate, endDate) {
    const rangeText = formatRangeIndo(startDate, endDate);
    const elRangeLabel = document.getElementById('label-period-dates');
    if (elRangeLabel) {
        elRangeLabel.textContent = rangeText;
    }
    const elPeriodBadge = document.getElementById('badge-period-range');
    if (elPeriodBadge) {
        const scopeTitleMap = {
            month: 'Rentang Evaluasi: Bulan Berjalan',
            semester: 'Rentang Evaluasi: Semester Berjalan',
            year: 'Rentang Evaluasi: 1 Tahun Ajaran Penuh'
        };
        elPeriodBadge.setAttribute('title', `${scopeTitleMap[scope] || 'Rentang Evaluasi'} (${rangeText})`);
    }
    const elPeriodDesc = document.getElementById('label-active-period-desc');
    if (elPeriodDesc) {
        // Rentang tanggal evaluasi telah disajikan secara eksplisit pada badge filter di atas tabel (#badge-period-range).
        // Dikosongkan di sini agar tidak terjadi duplikasi informasi (efisien & bebas redundansi).
        elPeriodDesc.textContent = '';
    }
}

export function setRankingContentLoading(isLoading) {
    const podiumEl = document.getElementById('podium-container');
    const tableEl = document.getElementById('view-table-container');
    const gridEl = document.getElementById('view-grid-container');
    [podiumEl, tableEl, gridEl].forEach(el => {
        if (!el) return;
        if (isLoading) {
            el.classList.add('opacity-40', 'pointer-events-none', 'transition-opacity', 'duration-150');
        } else {
            el.classList.remove('opacity-40', 'pointer-events-none');
        }
    });
}

function getWaliForClass(waliMap, cls) {
    if (!waliMap) return null;
    const cleanCls = String(cls).replace(/^Kelas\s+/i, '').trim();
    if (typeof waliMap.get === 'function') {
        return waliMap.get(cleanCls) ||
               waliMap.get(`Kelas ${cleanCls}`) ||
               waliMap.get(cls) ||
               null;
    }
    return waliMap[cleanCls] || waliMap[`Kelas ${cleanCls}`] || waliMap[cls] || null;
}

// =====================================
// HELPER CACHE KEY BERBASIS LINGKUP & RENTANG WITA
// =====================================
function getRankingCacheKey(scope, startDate, endDate) {
    const schoolId = (window.SCHOOL_CONFIG && window.SCHOOL_CONFIG.schoolId) || 'smagesa';
    const role = localStorage.getItem('user_role') || 'guest';
    const uid = (auth && auth.currentUser) ? auth.currentUser.uid : 'anon';
    return `simas_class_ranking_${CACHE_KEY}_${schoolId}_${role}_${uid}_${scope}_${startDate}_${endDate}`;
}

// =====================================
// PEMUATAN DATA UTAMA (SSOT, KONSISTEN & AMAN TERHADAP RACE CONDITION)
// =====================================
export async function loadRankingData(forceRefresh = false) {
    // 1. Snapshot Parameter Periode & Request Cancellation Token
    const currentRequestId = ++activeRequestId;
    const requestedScope = state.periodScope;
    const { startDate, endDate, currentYear, currentMonth, expectedSppMonths } = getDateRangeForScope(requestedScope);

    state.snapshotScope = requestedScope;
    state.snapshotRange = { startDate, endDate };
    state.isFetching = true;

    // Perbarui indikator visual rentang tanggal & feedback transisi halus
    updatePeriodDisplayUI(requestedScope, startDate, endDate);
    setRankingContentLoading(true);
    updateCacheStatusUI('Memuat data...');

    const cacheKey = getRankingCacheKey(requestedScope, startDate, endDate);
    const scopeCacheKey = cacheKey;

    // 2. Cek Session Cache jika tidak dipaksa refresh
    if (!forceRefresh) {
        try {
            const cachedStr = sessionStorage.getItem(cacheKey) || sessionStorage.getItem(scopeCacheKey);
            if (cachedStr) {
                const cached = JSON.parse(cachedStr);
                const isFresh = (Date.now() - (cached.timestamp || 0)) < CACHE_TTL;
                if (isFresh && cached.periodScope === requestedScope && Array.isArray(cached.classesList) && cached.isDataComplete) {
                    if (currentRequestId !== activeRequestId) return;
                    state.classesList = cached.classesList;
                    state.rawMetrics = cached.rawMetrics || {};
                    state.lastFetchedAt = cached.timestamp;
                    state.sourcesStatus = cached.sourcesStatus || {
                        attendance: { status: 'success', count: 0, error: null },
                        spp: { status: 'success', count: 0, error: null },
                        discipline: { status: 'success', count: 0, error: null },
                        library: { status: 'success', count: 0, error: null }
                    };
                    state.isDataComplete = true;
                    state.isStaleCache = false;
                    state.isFetching = false;
                    updateCacheStatusUI('Updated at', cached.timestamp);
                    renderDataStatusBanner();
                    recomputeRankings();
                    setRankingContentLoading(false);
                    return;
                }
            }
        } catch (e) {
            console.warn('[RankingKelas] Gagal membaca session cache:', e);
        }
    }

    try {
        // 3. Ambil Master Kelas Aktif, Siswa Aktif, & Wali Kelas
        // Catatan Arsitektur: getWaliKelasCache di global.js memverifikasi role wali kelas dari Firestore
        // dengan fallback teachers D1 untuk nomor kontak dan NIP (transparan dan sesuai otorisasi).
        const [activeClasses, allStudents, waliKelasMap] = await Promise.all([
            typeof window.getActiveClasses === 'function' ? window.getActiveClasses() : [],
            typeof window.getStudentsCache === 'function' ? window.getStudentsCache(forceRefresh) : [],
            typeof window.getWaliKelasCache === 'function' ? window.getWaliKelasCache(forceRefresh) : new Map()
        ]);

        if (currentRequestId !== activeRequestId) return;

        state.classesList = Array.isArray(activeClasses) ? activeClasses : [];

        // Filter siswa berstatus aktif
        const isStudentActive = typeof window.isStudentActive === 'function'
            ? window.isStudentActive
            : (s) => s && !/alumni|lulus|mutasi|keluar|nonaktif/i.test(String(s.status || ''));

        state.studentsList = (Array.isArray(allStudents) ? allStudents : []).filter(s => isStudentActive(s));

        // Pemetaan Siswa per Rombel Kelas & NIS Map
        const classStudentsMap = {};
        const classNisMap = {};
        state.classesList.forEach(cls => {
            classStudentsMap[cls] = [];
            classNisMap[cls] = [];
        });

        const activeNisList = [];
        const studentClassMap = {};

        state.studentsList.forEach(s => {
            const cls = String(s.class || '').replace(/^Kelas\s+/i, '').trim();
            if (cls && classStudentsMap[cls]) {
                classStudentsMap[cls].push(s);
                const nis = String(s.nis || '').trim();
                if (nis) {
                    activeNisList.push(nis);
                    classNisMap[cls].push(nis);
                    studentClassMap[nis] = cls;
                }
            }
        });

        // Inisialisasi Metrik per Kelas
        const metricsMap = {};
        state.classesList.forEach(cls => {
            const waliObj = getWaliForClass(waliKelasMap, cls);
            let waliPhoto = waliObj?.photo || null;
            if (!waliPhoto && waliObj && (waliObj.nip || waliObj.name) && typeof window.getTeachersMapCacheSync === 'function') {
                const tMap = window.getTeachersMapCacheSync();
                if (tMap) {
                    const t = (waliObj.nip && tMap.get(waliObj.nip)) || (waliObj.name && tMap.get(waliObj.name.toLowerCase().trim()));
                    if (t && (t.foto || t.photo || t.photo_url || t.avatar)) {
                        waliPhoto = t.foto || t.photo || t.photo_url || t.avatar;
                    }
                }
            }
            metricsMap[cls] = {
                className: cls,
                totalStudents: (classStudentsMap[cls] || []).length,
                wali: waliObj ? {
                    name: waliObj.name || '-',
                    nip: waliObj.nip || '',
                    phone: waliObj.phone || '',
                    email: waliObj.email || '',
                    photo: waliPhoto
                } : null,
                attendance: { H: 0, S: 0, I: 0, D: 0, A: 0, totalDays: 0, rate: 0 },
                spp: { paidCount: 0, totalCount: (classStudentsMap[cls] || []).length, rate: 0 },
                discipline: { violationsCount: 0, permissionCount: 0, zeroViolationCount: (classStudentsMap[cls] || []).length, zeroViolationRate: 100, rate: 100, achievementPoints: 0, score: 100 },
                library: { borrowCount: 0, ratePerStudent: 0 }
            };
        });

        // Objek Pelacakan Status Eksplisit Sumber
        const sourcesStatus = {
            attendance: { status: 'loading', count: 0, error: null },
            spp: { status: 'loading', count: 0, error: null },
            discipline: { status: 'loading', count: 0, error: null },
            library: { status: 'loading', count: 0, error: null }
        };

        // Identifikasi Hak Akses Klien
        const userRole = localStorage.getItem('user_role') || '';
        const isRestrictedRole = userRole === 'siswa' || auth?.currentUser?.isAnonymous;

        // 4. METODE A: Coba Ambil Agregat Server (Supabase secure-proxy action 'get-ranking-aggregates')
        let serverSupabaseSuccess = false;
        try {
            const idToken = auth?.currentUser ? await auth.currentUser.getIdToken() : '';
            const proxyBaseUrl = (window.SUPABASE_CONFIG?.url || '').replace(/\/+$/, '');
            if (proxyBaseUrl && idToken) {
                const proxyUrl = `${proxyBaseUrl}/functions/v1/secure-proxy`;
                const proxyResponse = await fetch(proxyUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${idToken}`
                    },
                    body: JSON.stringify({
                        action: 'get-ranking-aggregates',
                        payload: {
                            startDate,
                            endDate,
                            expectedMonths: expectedSppMonths,
                            classStudents: classNisMap,
                            activeClasses: state.classesList
                        }
                    })
                });

                if (proxyResponse.ok) {
                    const resJson = await proxyResponse.json();
                    if (resJson && resJson.success && resJson.aggregates) {
                        // Pasang Presensi dari Server
                        if (resJson.aggregates.attendance) {
                            Object.entries(resJson.aggregates.attendance).forEach(([cls, att]) => {
                                if (metricsMap[cls]) metricsMap[cls].attendance = att;
                            });
                            sourcesStatus.attendance = resJson.sourcesStatus?.attendance || { status: 'success', count: 1, error: null };
                        }
                        // Pasang SPP dari Server
                        if (resJson.aggregates.spp) {
                            Object.entries(resJson.aggregates.spp).forEach(([cls, spp]) => {
                                if (metricsMap[cls]) metricsMap[cls].spp = spp;
                            });
                            sourcesStatus.spp = resJson.sourcesStatus?.spp || { status: 'success', count: 1, error: null };
                        }
                        // Pasang Sirkulasi Perpustakaan dari Server
                        if (resJson.aggregates.library) {
                            Object.entries(resJson.aggregates.library).forEach(([cls, lib]) => {
                                if (metricsMap[cls]) metricsMap[cls].library.borrowCount = Number(lib.borrowCount) || 0;
                            });
                            sourcesStatus.library = resJson.sourcesStatus?.library || { status: 'success', count: 1, error: null };
                        }
                        serverSupabaseSuccess = true;
                    }
                }
            }
        } catch (serverErr) {
            console.warn('[RankingKelas] Server aggregate notice (fallback to authorized client queries):', serverErr);
        }

        // Helper Pagination Safe Supabase Query
        const runSupabaseFetch = async (table, buildQueryFn, opts = {}) => {
            if (!supabase) return { data: [], error: new Error('Supabase client belum siap') };
            if (typeof window.fetchAllSupabaseRows === 'function') {
                return await window.fetchAllSupabaseRows(supabase, table, buildQueryFn, opts);
            }
            let q = supabase.from(table).select(opts.selectFields || '*');
            if (typeof buildQueryFn === 'function') q = buildQueryFn(q);
            return await q;
        };

        // 5. METODE B: Fallback Kueri Client-Side jika server aggregates belum aktif
        // PERINGATAN KEAMANAN: Jangan menghitung ranking seluruh sekolah jika pengguna dibatasi oleh RBAC data mentah!
        const supabasePromises = [];

        // A. Presensi Siswa Harian
        if (!serverSupabaseSuccess) {
            if (isRestrictedRole) {
                sourcesStatus.attendance = {
                    status: 'partial',
                    count: 0,
                    error: 'Akses data presensi mentah dibatasi untuk peran siswa. Memerlukan agregasi server.'
                };
            } else {
                const attPromise = (async () => {
                    try {
                        const { data, error } = await runSupabaseFetch(
                            'siswa_presensi_harian',
                            q => q.gte('tanggal', startDate).lte('tanggal', endDate),
                            { selectFields: 'kelas, summary, tanggal, total_students' }
                        );

                        if (error) {
                            sourcesStatus.attendance = { status: 'error', count: 0, error: error.message || 'Gagal memuat presensi' };
                            return;
                        }

                        if (!Array.isArray(data) || data.length === 0) {
                            // Fallback defensif: jika siswa_presensi_harian belum teragregasi, baca siswa_presensi detail
                            try {
                                const { data: detailData, error: errDetail } = await runSupabaseFetch(
                                    'siswa_presensi',
                                    q => q.gte('tanggal', startDate).lte('tanggal', endDate),
                                    { selectFields: 'kelas, status, tanggal' }
                                );

                                if (!errDetail && Array.isArray(detailData) && detailData.length > 0) {
                                    sourcesStatus.attendance = { status: 'success', count: detailData.length, error: null };
                                    detailData.forEach(row => {
                                        const rawCls = String(row.kelas || '').replace(/^Kelas\s+/i, '').trim();
                                        if (rawCls && metricsMap[rawCls]) {
                                            const st = String(row.status || '').toUpperCase().trim();
                                            if (st === 'H') metricsMap[rawCls].attendance.H += 1;
                                            else if (st === 'S') metricsMap[rawCls].attendance.S += 1;
                                            else if (st === 'I') metricsMap[rawCls].attendance.I += 1;
                                            else if (st === 'D') metricsMap[rawCls].attendance.D += 1;
                                            else if (st === 'A') metricsMap[rawCls].attendance.A += 1;
                                        }
                                    });
                                    return;
                                }
                            } catch (errDetail) {
                                console.warn('[RankingKelas] Fallback siswa_presensi notice:', errDetail);
                            }

                            sourcesStatus.attendance = { status: 'empty', count: 0, error: null };
                            return;
                        }

                        sourcesStatus.attendance = { status: 'success', count: data.length, error: null };
                        const seenDateClass = new Set();
                        const seenDay = seenDateClass;
                        data.forEach(row => {
                            const rawCls = String(row.kelas || '').replace(/^Kelas\s+/i, '').trim();
                            const dateKey = `${rawCls}_${row.tanggal}`;
                            if (seenDay.has(dateKey) || seenDateClass.has(dateKey)) return; // Cegah double-counting
                            seenDay.add(dateKey);
                            seenDateClass.add(dateKey);

                            if (rawCls && metricsMap[rawCls]) {
                                let sum = row.summary || {};
                                if (typeof sum === 'string') {
                                    try { sum = JSON.parse(sum); } catch (e) { sum = {}; }
                                }
                                const h = Number(sum.H) || 0;
                                const s = Number(sum.S) || 0;
                                const i = Number(sum.I) || 0;
                                const d = Number(sum.D) || 0;
                                const a = Number(sum.A) || 0;

                                metricsMap[rawCls].attendance.H += h;
                                metricsMap[rawCls].attendance.S += s;
                                metricsMap[rawCls].attendance.I += i;
                                metricsMap[rawCls].attendance.D += d;
                                metricsMap[rawCls].attendance.A += a;
                                metricsMap[rawCls].attendance.totalDays += 1;
                            }
                        });
                    } catch (errAtt) {
                        console.warn('[RankingKelas] Error query siswa_presensi_harian:', errAtt);
                        sourcesStatus.attendance = { status: 'error', count: 0, error: errAtt.message || 'Error presensi' };
                    }
                })();
                supabasePromises.push(attPromise);
            }

            // B. Transaksi SPP
            if (isRestrictedRole) {
                sourcesStatus.spp = {
                    status: 'partial',
                    count: 0,
                    error: 'Akses transaksi SPP siswa lain dibatasi oleh kebijakan privasi. Memerlukan agregasi server.'
                };
            } else {
                const sppPromise = (async () => {
                    try {
                        const relevantYears = [...new Set(expectedSppMonths.map(item => item.year))];
                        // Filter transaksi resmi SPP tanpa kewajiban manual: neq("type", "manual_debt")
                        const { data, error } = await runSupabaseFetch(
                            'finance_transactions',
                            q => q.in('year', relevantYears).neq('type', 'manual_debt').neq("type", "manual_debt"),
                            { selectFields: 'student_nis, year, month, type' }
                        );

                        if (error) {
                            sourcesStatus.spp = { status: 'error', count: 0, error: error.message || 'Gagal memuat transaksi SPP' };
                            return;
                        }

                        if (!Array.isArray(data) || data.length === 0) {
                            sourcesStatus.spp = { status: 'empty', count: 0, error: null };
                            return;
                        }

                        sourcesStatus.spp = { status: 'success', count: data.length, error: null };
                        const paidKeySet = new Set();
                        data.forEach(trx => {
                            const nis = String(trx.student_nis || '').trim();
                            const yr = Number(trx.year);
                            const mo = Number(trx.month);
                            if (nis && yr && mo) {
                                paidKeySet.add(`${nis}_${yr}_${mo}`);
                            }
                        });

                        state.classesList.forEach(cls => {
                            const studentsInCls = classStudentsMap[cls] || [];
                            const totalSt = studentsInCls.length;
                            if (totalSt === 0) return;

                            let fullyPaidStudents = 0;
                            let totalPaidMonthsInClass = 0;
                            const totalExpectedMonths = expectedSppMonths.length || 1;

                            studentsInCls.forEach(st => {
                                const nis = String(st.nis || '').trim();
                                let studentPaidCount = 0;
                                expectedSppMonths.forEach(target => {
                                    if (paidKeySet.has(`${nis}_${target.year}_${target.month}`)) {
                                        studentPaidCount++;
                                    }
                                });

                                totalPaidMonthsInClass += studentPaidCount;
                                if (studentPaidCount >= totalExpectedMonths) {
                                    fullyPaidStudents++;
                                }
                            });

                            metricsMap[cls].spp.paidCount = fullyPaidStudents;
                            const maxPossibleMonths = totalSt * totalExpectedMonths;
                            metricsMap[cls].spp.rate = maxPossibleMonths > 0
                                ? Number(((totalPaidMonthsInClass / maxPossibleMonths) * 100).toFixed(1))
                                : 0;
                        });
                    } catch (errSpp) {
                        console.warn('[RankingKelas] Error query finance_transactions:', errSpp);
                        sourcesStatus.spp = { status: 'error', count: 0, error: errSpp.message || 'Error SPP' };
                    }
                })();
                supabasePromises.push(sppPromise);
            }

            // C. Sirkulasi Perpustakaan
            if (isRestrictedRole) {
                sourcesStatus.library = {
                    status: 'partial',
                    count: 0,
                    error: 'Akses riwayat peminjaman perpustakaan dibatasi. Memerlukan agregasi server.'
                };
            } else {
                const libPromise = (async () => {
                    try {
                        const { data, error } = await runSupabaseFetch(
                            'lib_sirkulasi',
                            q => q.gte('tgl_pinjam', startDate).lte('tgl_pinjam', endDate).eq('peminjam_type', 'siswa'),
                            { selectFields: 'id, peminjam_id, peminjam_kelas, tgl_pinjam' }
                        );

                        if (error) {
                            sourcesStatus.library = { status: 'error', count: 0, error: error.message || 'Gagal memuat sirkulasi perpustakaan' };
                            return;
                        }

                        if (!Array.isArray(data) || data.length === 0) {
                            sourcesStatus.library = { status: 'empty', count: 0, error: null };
                            return;
                        }

                        sourcesStatus.library = { status: 'success', count: data.length, error: null };
                        const seenCirc = new Set();
                        data.forEach(circ => {
                            if (circ.id && seenCirc.has(String(circ.id))) return;
                            if (circ.id) seenCirc.add(String(circ.id));

                            // Prioritaskan peminjam_kelas untuk integritas historis rombel
                            let cls = String(circ.peminjam_kelas || '').replace(/^Kelas\s+/i, '').trim();
                            if (!cls) {
                                const nis = String(circ.peminjam_id || '').trim();
                                cls = studentClassMap[nis];
                            }
                            if (cls && metricsMap[cls]) {
                                metricsMap[cls].library.borrowCount += 1;
                            }
                        });
                    } catch (errLib) {
                        console.warn('[RankingKelas] Error query lib_sirkulasi:', errLib);
                        sourcesStatus.library = { status: 'error', count: 0, error: errLib.message || 'Error Perpustakaan' };
                    }
                })();
                supabasePromises.push(libPromise);
            }
        }

        // 6. METODE C: Agregasi Kedisiplinan & Prestasi BK dari Cloudflare D1
        const bkPromise = (async () => {
            try {
                let bkAggregateDone = false;

                // Coba ambil via endpoint server class-aggregates terlebih dahulu
                if (cfClient && typeof cfClient.getClassRecordAggregates === 'function') {
                    try {
                        const classAggs = await cfClient.getClassRecordAggregates({
                            startDate,
                            endDate
                        });

                        if (classAggs && typeof classAggs === 'object' && Object.keys(classAggs).length > 0) {
                            state.classesList.forEach(cls => {
                                const agg = classAggs[cls];
                                const studentsInCls = classStudentsMap[cls] || [];
                                const totalSt = studentsInCls.length || 1;

                                // Pemetaan multi-key identitas dan metrik rombel/siswa D1
                                const studentKey = agg?.nis || agg?.student_nis || agg?.id;
                                const violCount = agg ? (agg.violationCount || agg.violation_count || 0) : 0;
                                const violPoints = agg ? (agg.violationPoints || agg.points || 0) : 0;
                                const achCount = agg ? (agg.achievementCount || 0) : 0;
                                const achPoints = agg ? (agg.achievementPoints || 0) : 0;
                                const permCount = agg ? (agg.permissionCount || agg.permission_count || 0) : 0;
                                const violatingStudents = agg ? (agg.violatingStudentsCount || 0) : 0;

                                const zeroCount = Math.max(0, totalSt - violatingStudents);
                                const totalViolations = violPoints > 0 ? violPoints : violCount;
                                const totalAchPoints = achPoints > 0 ? achPoints : achCount;
                                const totalPermissions = permCount;

                                const avgPenalty = Number(((totalViolations / totalSt) * 10).toFixed(1));
                                const permPenalty = Number(((totalPermissions / totalSt) * 2).toFixed(1));
                                const achBonus = Math.min(Number(((totalAchPoints / totalSt) * 3).toFixed(1)), 15);
                                const disciplineScore = Number(Math.max(0, Math.min(100, 100 - avgPenalty - permPenalty + achBonus)).toFixed(1));

                                metricsMap[cls].discipline.violationsCount = totalViolations;
                                metricsMap[cls].discipline.permissionCount = totalPermissions;
                                metricsMap[cls].discipline.zeroViolationCount = zeroCount;
                                metricsMap[cls].discipline.zeroViolationRate = disciplineScore;
                                metricsMap[cls].discipline.rate = disciplineScore;
                                metricsMap[cls].discipline.achievementPoints = totalAchPoints;
                                metricsMap[cls].discipline.score = disciplineScore;
                            });

                            sourcesStatus.discipline = { status: 'success', count: Object.keys(classAggs).length, error: null };
                            bkAggregateDone = true;
                        }
                    } catch (serverBkErr) {
                        console.warn('[RankingKelas] Server class-aggregates belum aktif, menggunakan pagination client:', serverBkErr);
                    }
                }

                // Fallback: Pagination lengkap dengan pengurutan stabil via getAllRecords (membungkus cfClient.getRecords)
                if (!bkAggregateDone) {
                    if (cfClient && typeof cfClient.getAllRecords === 'function') {
                        const { data: records, isComplete, error: bkErr } = await cfClient.getAllRecords({
                            date_start: startDate,
                            date_end: endDate,
                            order: 'ASC'
                        });

                        if (bkErr || !isComplete) {
                            sourcesStatus.discipline = {
                                status: records && records.length > 0 ? 'partial' : 'error',
                                count: records ? records.length : 0,
                                error: bkErr ? bkErr.message : 'Pagination catatan BK tidak lengkap'
                            };
                        } else if (records.length === 0) {
                            // CATATAN PENTING: Periode kosong BUKAN berarti fallback ke kumulatif student_aggregates!
                            // Nilai pelanggaran rombel = 0, permisi = 0, zero rate = 100%, skor = 100
                            sourcesStatus.discipline = { status: 'empty', count: 0, error: null };
                            state.classesList.forEach(cls => {
                                const totalSt = (classStudentsMap[cls] || []).length || 1;
                                metricsMap[cls].discipline = {
                                    violationsCount: 0,
                                    permissionCount: 0,
                                    zeroViolationCount: totalSt,
                                    zeroViolationRate: 100,
                                    rate: 100,
                                    achievementPoints: 0,
                                    score: 100
                                };
                            });
                        } else {
                            sourcesStatus.discipline = { status: 'success', count: records.length, error: null };
                            const periodViolMap = {};
                            const periodAchMap = {};
                            const periodPermMap = {};

                            records.forEach(rec => {
                                const rNis = String(rec.studentNIS || rec.student_nis || rec.nis || '').trim();
                                if (!rNis) return;
                                const cat = String(rec.category || '').toLowerCase();
                                const pts = Number(rec.points || 0);

                                if (cat === 'pelanggaran') {
                                    periodViolMap[rNis] = (periodViolMap[rNis] || 0) + (pts > 0 ? pts : 1);
                                } else if (cat === 'prestasi') {
                                    periodAchMap[rNis] = (periodAchMap[rNis] || 0) + (pts > 0 ? pts : 1);
                                } else if (cat === 'permisi' || cat === 'permission') {
                                    periodPermMap[rNis] = (periodPermMap[rNis] || 0) + 1;
                                }
                            });

                            state.classesList.forEach(cls => {
                                const studentsInCls = classStudentsMap[cls] || [];
                                let zeroCount = 0;
                                let totalViolations = 0;
                                let totalAchPoints = 0;
                                let totalPermissions = 0;

                                studentsInCls.forEach(st => {
                                    const nis = String(st.nis || '').trim();
                                    const vPts = periodViolMap[nis] || 0;
                                    const aPts = periodAchMap[nis] || 0;
                                    const pCount = periodPermMap[nis] || 0;

                                    if (vPts === 0) {
                                        zeroCount++;
                                    } else {
                                        totalViolations += vPts;
                                    }
                                    totalAchPoints += aPts;
                                    totalPermissions += pCount;
                                });

                                const totalSt = studentsInCls.length || 1;
                                const avgPenalty = Number(((totalViolations / totalSt) * 10).toFixed(1));
                                const permPenalty = Number(((totalPermissions / totalSt) * 2).toFixed(1));
                                const achBonus = Math.min(Number(((totalAchPoints / totalSt) * 3).toFixed(1)), 15);
                                const disciplineScore = Number(Math.max(0, Math.min(100, 100 - avgPenalty - permPenalty + achBonus)).toFixed(1));

                                metricsMap[cls].discipline.violationsCount = totalViolations;
                                metricsMap[cls].discipline.permissionCount = totalPermissions;
                                metricsMap[cls].discipline.zeroViolationCount = zeroCount;
                                metricsMap[cls].discipline.zeroViolationRate = disciplineScore;
                                metricsMap[cls].discipline.rate = disciplineScore;
                                metricsMap[cls].discipline.achievementPoints = totalAchPoints;
                                metricsMap[cls].discipline.score = disciplineScore;
                            });
                        }
                    } else {
                        sourcesStatus.discipline = { status: 'error', count: 0, error: 'cfClient tidak tersedia' };
                    }
                }
            } catch (errBk) {
                console.warn('[RankingKelas] Error proses data BK:', errBk);
                sourcesStatus.discipline = { status: 'error', count: 0, error: errBk.message || 'Error BK' };
            }
        })();

        // Tunggu seluruh proses selesai secara simultan
        await Promise.allSettled([...supabasePromises, bkPromise]);

        if (currentRequestId !== activeRequestId) {
            console.log(`[RankingKelas] Mengabaikan hasil request #${currentRequestId} karena request #${activeRequestId} aktif.`);
            return;
        }

        // 7. Kalkulasi Akhir Metrik Tiap Kelas
        state.classesList.forEach(cls => {
            const m = metricsMap[cls];
            const totalSt = m.totalStudents || 1;

            // Attendance Rate % (SSOT SIMAS: (H + D) / Total * 100%)
            const att = m.attendance;
            const totalRecorded = att.H + att.S + att.I + att.D + att.A;
            if (sourcesStatus.attendance.status === 'success' && totalRecorded > 0) {
                if (typeof window.calculateAttendanceStats === 'function') {
                    const stats = window.calculateAttendanceStats(att);
                    att.rate = stats.attPct;
                } else {
                    const hadirCount = att.H + att.D;
                    att.rate = Number(((hadirCount / totalRecorded) * 100).toFixed(1));
                }
            } else if (att.rate !== undefined && att.rate !== null) {
                att.rate = Number(Number(att.rate).toFixed(1));
            }

            // SPP Rate %
            m.spp.rate = Number(Number(m.spp.rate || 0).toFixed(1));

            // Library Rate per student
            m.library.ratePerStudent = Number((m.library.borrowCount / totalSt).toFixed(1));
        });

        // 8. Evaluasi Kelengkapan Sumber Data (Bedakan Sukses, Kosong, Parsial, & Gagal)
        const isDataComplete = ['attendance', 'spp', 'discipline', 'library'].every(
            s => ['success', 'empty'].includes(sourcesStatus[s]?.status)
        );

        state.rawMetrics = metricsMap;
        state.sourcesStatus = sourcesStatus;
        state.isDataComplete = isDataComplete;
        state.lastFetchedAt = Date.now();
        state.isStaleCache = false;

        // 9. Penulisan Cache yang Aman
        // CATATAN KEAMANAN: Data yang gagal atau tidak lengkap DILARANG disimpan sebagai cache lengkap!
        if (isDataComplete) {
            try {
                const serializedPayload = JSON.stringify({
                    timestamp: state.lastFetchedAt,
                    periodScope: requestedScope,
                    startDate,
                    endDate,
                    classesList: state.classesList,
                    rawMetrics: state.rawMetrics,
                    sourcesStatus: state.sourcesStatus,
                    isDataComplete: true
                });
                sessionStorage.setItem(cacheKey, serializedPayload);
                sessionStorage.setItem(scopeCacheKey, serializedPayload);
            } catch (e) {
                console.warn('[RankingKelas] Session storage quota exceeded:', e);
            }
            updateCacheStatusUI('Updated at', state.lastFetchedAt);
        } else {
            // Hapus cache usang jika ada
            try { 
                sessionStorage.removeItem(cacheKey);
                sessionStorage.removeItem(scopeCacheKey);
            } catch (_) {}
            const partialSources = Object.entries(sourcesStatus)
                .filter(([, v]) => !['success', 'empty'].includes(v.status))
                .map(([k]) => k);
            updateCacheStatusUI(`Data Belum Lengkap (${partialSources.join(', ')})`, state.lastFetchedAt);
        }

        renderDataStatusBanner();
        recomputeRankings();

    } catch (err) {
        console.error('[RankingKelas] Gagal memuat data ranking:', err);
        setRankingContentLoading(false);
        if (currentRequestId === activeRequestId) {
            state.isDataComplete = false;
            updateCacheStatusUI('Gagal Memuat');
            renderDataStatusBanner();
            if (typeof showToast === 'function') {
                showToast('Gagal Memuat Data', 'Terjadi gangguan saat mengambil metrik kelas.', 'error');
            }
        }
    } finally {
        if (currentRequestId === activeRequestId) {
            state.isFetching = false;
            setRankingContentLoading(false);
        }
    }
}

// =====================================
// MANAJEMEN SORTING TABEL & BOBOT
// =====================================
// Default sort: Nama Kelas Terurut Natural (Class Ascending)
export let currentRankingSort = {
    column: 'class',
    direction: 'asc'
};

export function parseClassGradeAndNum(clsName) {
    const raw = String(clsName || '').trim();
    const match = raw.match(/^(XII|XI|X)[^0-9a-zA-Z]*(\d+)?(.*)$/i);
    if (!match) return { gradeWeight: 99, num: 0, suffix: raw, raw };
    const gradeStr = match[1].toUpperCase();
    const gradeWeight = gradeStr === 'X' ? 10 : (gradeStr === 'XI' ? 11 : 12);
    const num = match[2] ? parseInt(match[2], 10) : 0;
    const suffix = match[3] ? match[3].trim().toLowerCase() : '';
    return { gradeWeight, num, suffix, raw };
}

export function compareClassesNatural(aName, bName) {
    const a = parseClassGradeAndNum(aName);
    const b = parseClassGradeAndNum(bName);

    if (a.gradeWeight !== b.gradeWeight) {
        return a.gradeWeight - b.gradeWeight;
    }
    if (a.num !== b.num) {
        return a.num - b.num;
    }
    return (a.suffix || '').localeCompare(b.suffix || '', undefined, { numeric: true, sensitivity: 'base' });
}

export function onRankingSortChange(val) {
    if (!val) return;
    const parts = String(val).split('-');
    const col = parts[0];
    // Secara default langsung urutkan tertinggi (desc), kecuali kolom kelas secara natural (asc)
    const dir = parts[1] || (col === 'class' ? 'asc' : 'desc');

    currentRankingSort = {
        column: col,
        direction: dir
    };

    updateRankingSortIcons();
    recomputeRankings();
}

export function sortRankingTable(columnKey) {
    if (currentRankingSort.column === columnKey) {
        currentRankingSort.direction = currentRankingSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        currentRankingSort.column = columnKey;
        // Kolom rombel kelas default asc, kolom metrik performa default desc (tertinggi di atas)
        currentRankingSort.direction = columnKey === 'class' ? 'asc' : 'desc';
    }

    updateRankingSortIcons();
    recomputeRankings();
}

export function updateRankingSortIcons() {
    const columns = ['class', 'attendance', 'spp', 'discipline', 'library', 'overall'];
    columns.forEach(col => {
        const iconEl = document.getElementById(`sort-icon-${col}`);
        if (!iconEl) return;

        if (currentRankingSort.column === col) {
            if (currentRankingSort.direction === 'asc') {
                iconEl.className = 'fa-solid fa-sort-up text-blue-600 dark:text-blue-400 text-[11px]';
            } else {
                iconEl.className = 'fa-solid fa-sort-down text-blue-600 dark:text-blue-400 text-[11px]';
            }
        } else {
            const neutralColor = col === 'overall' ? 'text-blue-300 dark:text-blue-600' : 'text-slate-300 dark:text-slate-600';
            iconEl.className = `fa-solid fa-sort ${neutralColor} text-[11px]`;
        }
    });

    // Sinkronkan nilai dropdown kontrol sortir manual (jika elemen tersedia di DOM)
    const selectSortEl = document.getElementById('select-ranking-sort');
    if (selectSortEl) {
        if (selectSortEl.querySelector(`option[value="${currentRankingSort.column}"]`)) {
            selectSortEl.value = currentRankingSort.column;
        } else {
            const targetVal = `${currentRankingSort.column}-${currentRankingSort.direction}`;
            if (selectSortEl.querySelector(`option[value="${targetVal}"]`)) {
                selectSortEl.value = targetVal;
            }
        }
    }
}

// =====================================
// PERHITUNGAN RANKING & BOBOT
// =====================================
function recomputeRankings() {
    if (!state.classesList || state.classesList.length === 0) {
        renderEmptyState();
        setRankingContentLoading(false);
        return;
    }

    // 1. Filter Tingkat Kelas (Akurat dan bebas bug tumpang tindih X vs XI vs XII)
    let scopedClasses = [...state.classesList];
    if (state.gradeFilter !== 'all') {
        if (state.gradeFilter === 'X') {
            scopedClasses = scopedClasses.filter(c => /^X(?!\s*[I|i])/i.test(c));
        } else if (state.gradeFilter === 'XI') {
            scopedClasses = scopedClasses.filter(c => /^XI(?!\s*[I|i])/i.test(c));
        } else if (state.gradeFilter === 'XII') {
            scopedClasses = scopedClasses.filter(c => /^XII/i.test(c));
        }
    }

    // 2. Hitung Indeks Gabungan untuk seluruh rombel dalam scope tingkat aktif
    const rankedList = scopedClasses.map(cls => {
        const m = state.rawMetrics[cls] || {
            className: cls,
            totalStudents: 0,
            attendance: { rate: 0 },
            spp: { rate: 0 },
            discipline: { score: 100 },
            library: { borrowCount: 0 }
        };

        const attScore = m.attendance.rate || 0;
        const sppScore = m.spp.rate || 0;
        const discScore = m.discipline.score || 0;
        const libScore = Math.min((m.library.borrowCount || 0) * 5, 100);

        // Skor Indeks Komprehensif (Bintang SMAGESA)
        // Dihitung dinamis berdasarkan bobot kriteria yang aktif (dinormalisasi proporsional)
        const vis = rankingCriteriaState.visible || DEFAULT_RANKING_CRITERIA.visible;
        const w = rankingCriteriaState.weights || DEFAULT_RANKING_CRITERIA.weights;

        const activeWeights = {
            attendance: vis.attendance ? (Number(w.attendance) || 0) : 0,
            spp: vis.spp ? (Number(w.spp) || 0) : 0,
            discipline: vis.discipline ? (Number(w.discipline) || 0) : 0,
            library: vis.library ? (Number(w.library) || 0) : 0
        };

        const totalActiveWeight = activeWeights.attendance + activeWeights.spp + activeWeights.discipline + activeWeights.library;

        const normWeights = {
            attendance: totalActiveWeight > 0 ? (activeWeights.attendance / totalActiveWeight) : 0,
            spp: totalActiveWeight > 0 ? (activeWeights.spp / totalActiveWeight) : 0,
            discipline: totalActiveWeight > 0 ? (activeWeights.discipline / totalActiveWeight) : 0,
            library: totalActiveWeight > 0 ? (activeWeights.library / totalActiveWeight) : 0
        };

        const overallScore = Number((
            (attScore * normWeights.attendance) +
            (sppScore * normWeights.spp) +
            (discScore * normWeights.discipline) +
            (libScore * normWeights.library)
        ).toFixed(1));

        return {
            ...m,
            overallScore
        };
    });

    // 3. Urutkan berdasarkan currentRankingSort (Default: Rombel Kelas Natural)
    const { column, direction } = currentRankingSort;
    const isAsc = direction === 'asc';

    rankedList.sort((a, b) => {
        let diff = 0;
        if (column === 'class') {
            diff = compareClassesNatural(a.className, b.className);
        } else if (column === 'attendance') {
            diff = (a.attendance?.rate || 0) - (b.attendance?.rate || 0);
            if (diff === 0) diff = (a.overallScore || 0) - (b.overallScore || 0);
        } else if (column === 'spp') {
            diff = (a.spp?.rate || 0) - (b.spp?.rate || 0);
            if (diff === 0) diff = (a.spp?.paidCount || 0) - (b.spp?.paidCount || 0);
            if (diff === 0) diff = (a.overallScore || 0) - (b.overallScore || 0);
            if (diff === 0) diff = compareClassesNatural(b.className, a.className);
        } else if (column === 'discipline') {
            diff = (a.discipline?.score || 0) - (b.discipline?.score || 0);
            if (diff === 0) diff = (b.discipline?.permissionCount || 0) - (a.discipline?.permissionCount || 0);
            if (diff === 0) diff = (b.discipline?.violationsCount || 0) - (a.discipline?.violationsCount || 0);
            if (diff === 0) diff = (a.overallScore || 0) - (b.overallScore || 0);
        } else if (column === 'library') {
            diff = (a.library?.borrowCount || 0) - (b.library?.borrowCount || 0);
            if (diff === 0) diff = (a.overallScore || 0) - (b.overallScore || 0);
        } else if (column === 'overall') {
            diff = (a.overallScore || 0) - (b.overallScore || 0);
            if (diff === 0) diff = (a.attendance?.rate || 0) - (b.attendance?.rate || 0);
            if (diff === 0) diff = (a.spp?.rate || 0) - (b.spp?.rate || 0);
            if (diff === 0) diff = (a.discipline?.score || 0) - (b.discipline?.score || 0);
            if (diff === 0) diff = (a.library?.borrowCount || 0) - (b.library?.borrowCount || 0);
            if (diff === 0) diff = compareClassesNatural(b.className, a.className);
        } else {
            diff = compareClassesNatural(a.className, b.className);
        }

        return isAsc ? diff : -diff;
    });

    // 4. Beri nomor urut tabel pada daftar acuan lengkap (sebelum filter pencarian kelas)
    rankedList.forEach((item, index) => {
        item.tableIndex = index + 1;
    });

    // Peringkat hakiki Skor Indeks (Bintang SMAGESA) untuk badge modal detail & catatan motivasi
    const overallSorted = [...rankedList].sort((a, b) => {
        const diff = (b.overallScore || 0) - (a.overallScore || 0);
        if (diff !== 0) return diff;
        const diffAtt = (b.attendance?.rate || 0) - (a.attendance?.rate || 0);
        if (diffAtt !== 0) return diffAtt;
        const diffSpp = (b.spp?.rate || 0) - (a.spp?.rate || 0);
        if (diffSpp !== 0) return diffSpp;
        const diffDisc = (b.discipline?.score || 0) - (a.discipline?.score || 0);
        if (diffDisc !== 0) return diffDisc;
        const diffLib = (b.library?.borrowCount || 0) - (a.library?.borrowCount || 0);
        if (diffLib !== 0) return diffLib;
        return compareClassesNatural(a.className, b.className);
    });
    overallSorted.forEach((item, idx) => {
        item.rank = idx + 1;
        item.overallRank = idx + 1;
    });

    // 5. Hitung Top 3 Juara per kategori dari rankedList lengkap (SSOT)
    // agar saat kelas difilter/dicari, ranking & medali tiap kolom tetap seperti posisi aslinya (tidak reset jadi Juara 1)
    const categoryRanks = computeCategoryRankings(rankedList);

    // 6. Terapkan filter pencarian kelas / wali setelah nomor urut dan medali acuan terbentuk
    let displayList = rankedList;
    if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase().trim();
        displayList = rankedList.filter(item => {
            const waliName = (item.wali?.name || '').toLowerCase();
            const waliNip = (item.wali?.nip || '').toLowerCase();
            return item.className.toLowerCase().includes(q) || waliName.includes(q) || waliNip.includes(q);
        });
    }

    state.rankedClasses = rankedList;

    // Simpan ringkasan ranking semester berjalan ke localStorage & sessionStorage (SSOT Cross-Tab untuk Dashboard Eksekutif Kepsek)
    try {
        const summaryPayload = JSON.stringify({
            timestamp: Date.now(),
            periodScope: state.periodScope,
            isDataComplete: state.isDataComplete,
            totalClasses: rankedList.length,
            bestOverall: overallSorted[0] || null,
            topFive: overallSorted.slice(0, 5),
            rankedList: overallSorted.map(r => ({
                rank: r.rank,
                className: r.className,
                overallScore: r.overallScore,
                wali: r.wali,
                attendance: r.attendance,
                spp: r.spp,
                discipline: r.discipline,
                library: r.library
            }))
        });
        localStorage.setItem('simas_class_ranking_summary_cache', summaryPayload);
        sessionStorage.setItem('simas_class_ranking_summary_cache', summaryPayload);
    } catch (_) {}

    // Render ke antarmuka
    renderSummaryHighlights(rankedList);
    renderPodium(rankedList);
    renderLeaderboard(displayList, categoryRanks);
    updateRankingSortIcons();
    setRankingContentLoading(false);
}

// =====================================
// RENDER SUMMARY HIGHLIGHTS (4 KARTU ATAS)
// =====================================
function renderSummaryHighlights(rankedList) {
    if (!rankedList || rankedList.length === 0) return;

    // Juara Umum
    const bestOverall = [...rankedList].sort((a, b) => (b.overallScore - a.overallScore) || ((b.attendance?.rate || 0) - (a.attendance?.rate || 0)) || ((b.spp?.rate || 0) - (a.spp?.rate || 0)) || ((b.discipline?.score || 0) - (a.discipline?.score || 0)) || ((b.library?.borrowCount || 0) - (a.library?.borrowCount || 0)) || compareClassesNatural(a.className, b.className))[0];
    const elBestClass = document.getElementById('stat-best-class');
    const elBestWali = document.getElementById('stat-best-wali');
    if (elBestClass && bestOverall) {
        if (state.isDataComplete) {
            elBestClass.textContent = bestOverall.className;
            if (elBestWali) elBestWali.textContent = `Wali: ${bestOverall.wali?.name || '-'}`;
        } else {
            elBestClass.textContent = `${bestOverall.className}*`;
            if (elBestWali) elBestWali.textContent = `*Indikasi Sementara (Data Belum Lengkap)`;
        }
    }

    // Kehadiran Tertinggi
    const topAtt = [...rankedList].sort((a, b) => (b.attendance.rate - a.attendance.rate) || ((b.overallScore || 0) - (a.overallScore || 0)))[0];
    const elTopAttClass = document.getElementById('stat-top-attendance-class');
    const elTopAttRate = document.getElementById('stat-top-attendance-rate');
    if (elTopAttClass && topAtt) {
        elTopAttClass.textContent = topAtt.className;
        if (elTopAttRate) {
            const isAttOk = state.sourcesStatus?.attendance?.status === 'success';
            elTopAttRate.textContent = isAttOk ? `${formatPercentage(topAtt.attendance.rate)} Kehadiran` : `Data Kehadiran Dibatasi/Gagal`;
        }
    }

    // SPP Tertertib
    const topSpp = [...rankedList].sort((a, b) => (b.spp.rate - a.spp.rate) || ((b.overallScore || 0) - (a.overallScore || 0)))[0];
    const elTopSppClass = document.getElementById('stat-top-spp-class');
    const elTopSppRate = document.getElementById('stat-top-spp-rate');
    if (elTopSppClass && topSpp) {
        elTopSppClass.textContent = topSpp.className;
        if (elTopSppRate) {
            const isSppOk = state.sourcesStatus?.spp?.status === 'success';
            elTopSppRate.textContent = isSppOk ? `${formatPercentage(topSpp.spp.rate)} Lunas` : `Data SPP Dibatasi/Gagal`;
        }
    }

    // Disiplin Terbaik
    const topDisc = [...rankedList].sort((a, b) => (b.discipline.score - a.discipline.score) || ((b.overallScore || 0) - (a.overallScore || 0)))[0];
    const elTopDiscClass = document.getElementById('stat-top-discipline-class');
    const elTopDiscInfo = document.getElementById('stat-top-discipline-info');
    if (elTopDiscClass && topDisc) {
        elTopDiscClass.textContent = topDisc.className;
        if (elTopDiscInfo) {
            const isDiscOk = ['success', 'empty'].includes(state.sourcesStatus?.discipline?.status);
            elTopDiscInfo.textContent = isDiscOk ? `${formatPercentage(topDisc.discipline.score)} Kedisiplinan` : `Data BK Parsial/Gagal`;
        }
    }
}

// =====================================
// RENDER PODIUM (NO-OP / BERSIHKAN KONTAINER)
// =====================================
function renderPodium(rankedList) {
    const container = document.getElementById('podium-container');
    if (!state.isDataComplete) {
        // Penetapan Juara Ditangguhkan jika data sumber evaluasi belum lengkap
        if (container) {
            container.innerHTML = 'Penetapan Juara Ditangguhkan';
            container.classList.add('hidden');
        }
        return;
    }
    if (container) {
        container.innerHTML = '';
        container.classList.add('hidden');
    }
}

// =====================================
// KALKULASI JUARA 1, 2, 3 PER KATEGORI (TOP 3)
// =====================================
export function computeCategoryRankings(list) {
    const categories = ['attendance', 'spp', 'discipline', 'library', 'overall'];
    const rankMap = { attendance: {}, spp: {}, discipline: {}, library: {}, overall: {} };
    if (!Array.isArray(list) || list.length === 0) return rankMap;

    categories.forEach(cat => {
        const eligible = list.filter(item => {
            if (cat === 'attendance') return (item.attendance?.rate || 0) > 0;
            if (cat === 'spp') return (item.spp?.rate || 0) > 0;
            if (cat === 'discipline') return (item.discipline?.score || 0) > 0;
            if (cat === 'library') return (item.library?.borrowCount || 0) > 0;
            if (cat === 'overall') return (item.overallScore || 0) > 0;
            return false;
        });

        const sorted = [...eligible].sort((a, b) => {
            let valA = 0, valB = 0;
            if (cat === 'attendance') {
                valA = a.attendance?.rate || 0;
                valB = b.attendance?.rate || 0;
            } else if (cat === 'spp') {
                valA = a.spp?.rate || 0;
                valB = b.spp?.rate || 0;
            } else if (cat === 'discipline') {
                valA = a.discipline?.score || 0;
                valB = b.discipline?.score || 0;
            } else if (cat === 'library') {
                valA = a.library?.borrowCount || 0;
                valB = b.library?.borrowCount || 0;
            } else if (cat === 'overall') {
                valA = a.overallScore || 0;
                valB = b.overallScore || 0;
            }

            if (valB !== valA) return valB - valA;

            // Tie breaker
            if (cat === 'discipline') {
                const diffPerm = (a.discipline?.permissionCount || 0) - (b.discipline?.permissionCount || 0);
                if (diffPerm !== 0) return diffPerm;
                const diffViol = (a.discipline?.violationsCount || 0) - (b.discipline?.violationsCount || 0);
                if (diffViol !== 0) return diffViol;
            } else if (cat === 'spp') {
                const diffPaid = (b.spp?.paidCount || 0) - (a.spp?.paidCount || 0);
                if (diffPaid !== 0) return diffPaid;
            }

            if (cat !== 'overall') {
                const diffOverall = (b.overallScore || 0) - (a.overallScore || 0);
                if (diffOverall !== 0) return diffOverall;
            } else {
                const diffAtt = (b.attendance?.rate || 0) - (a.attendance?.rate || 0);
                if (diffAtt !== 0) return diffAtt;
                const diffSpp = (b.spp?.rate || 0) - (a.spp?.rate || 0);
                if (diffSpp !== 0) return diffSpp;
                const diffDisc = (b.discipline?.score || 0) - (a.discipline?.score || 0);
                if (diffDisc !== 0) return diffDisc;
                const diffLib = (b.library?.borrowCount || 0) - (a.library?.borrowCount || 0);
                if (diffLib !== 0) return diffLib;
            }

            return compareClassesNatural(a.className, b.className);
        });

        if (cat === 'overall') {
            // Khusus Skor Indeks (Bintang SMAGESA): Tidak ada ranking kembar (tied).
            // Jika skor indeks sama, pemeringkatan dipecahkan oleh kehadiran (lalu SPP, disiplin, dan literasi).
            // Peringkat 1, 2, 3 di Skor Indeks bersifat unik (🥇 1, 🥈 2, 🥉 3).
            for (let i = 0; i < sorted.length && i < 3; i++) {
                rankMap.overall[sorted[i].className] = i + 1;
            }
        } else {
            // Peringkat Dense Tied: Rombel dengan nilai sama persis di posisi teratas mendapatkan medali yang sama
            let currentRank = 1;
            let lastVal = null;
            let lastSecondary = null;
            for (let i = 0; i < sorted.length; i++) {
                const item = sorted[i];
                let val = 0;
                let secondaryVal = null;
                if (cat === 'attendance') {
                    val = item.attendance?.rate || 0;
                } else if (cat === 'spp') {
                    val = item.spp?.rate || 0;
                    secondaryVal = item.spp?.paidCount || 0;
                } else if (cat === 'discipline') {
                    val = item.discipline?.score || 0;
                    secondaryVal = item.discipline?.permissionCount || 0;
                } else if (cat === 'library') {
                    val = item.library?.borrowCount || 0;
                }

                const isDecreased = (lastVal !== null && val < lastVal) ||
                    (cat === 'spp' && lastVal !== null && val === lastVal && lastSecondary !== null && secondaryVal < lastSecondary) ||
                    (cat === 'discipline' && lastVal !== null && val === lastVal && lastSecondary !== null && secondaryVal > lastSecondary);

                if (isDecreased) {
                    currentRank++;
                }
                lastVal = val;
                lastSecondary = secondaryVal;

                if (currentRank <= 3) {
                    rankMap[cat][item.className] = currentRank;
                } else {
                    break;
                }
            }
        }
    });

    return rankMap;
}

export function getCategoryRankBadge(rank, categoryLabel) {
    if (rank === 1) {
        return `<span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-black bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700 shadow-2xs shrink-0" title="Juara 1 ${categoryLabel}">🥇 1</span>`;
    }
    if (rank === 2) {
        return `<span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-200/90 dark:bg-slate-700/90 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 shadow-2xs shrink-0" title="Juara 2 ${categoryLabel}">🥈 2</span>`;
    }
    if (rank === 3) {
        return `<span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-900/15 dark:bg-amber-950/60 text-amber-800 dark:text-amber-400 border border-amber-700/40 shadow-2xs shrink-0" title="Juara 3 ${categoryLabel}">🥉 3</span>`;
    }
    return '';
}

export function formatPercentage(val) {
    if (val === null || val === undefined || isNaN(val)) return '0.0%';
    const n = Number(val);
    if (Number(n.toFixed(1)) === 100 || n >= 100) return '100%';
    return `${n.toFixed(1)}%`;
}

export function formatDecimal(val, digits = 1) {
    if (val === null || val === undefined || isNaN(val)) return (0).toFixed(digits);
    return Number(val).toFixed(digits);
}

// =====================================
// RENDER LEADERBOARD TABLE
// =====================================
function renderLeaderboard(rankedList, baselineCategoryRanks = null) {
    const tableBody = document.getElementById('ranking-table-body');
    const badgeTotal = document.getElementById('badge-total-classes');

    if (badgeTotal) badgeTotal.textContent = `${rankedList ? rankedList.length : 0} Kelas`;

    if (!rankedList || rankedList.length === 0) {
        renderEmptyState();
        return;
    }

    // Hitung Top 3 Juara untuk masing-masing kriteria acuan
    // Jika baselineCategoryRanks diberikan (misal saat memfilter kelas), gunakan categoryRanks baseline agar posisi ranking & medali tidak reset
    const categoryRanks = baselineCategoryRanks || computeCategoryRankings(rankedList);

    // Render Table
    if (tableBody) {
        const isOverallDesc = currentRankingSort.column === 'overall' && currentRankingSort.direction === 'desc';

        const vis = rankingCriteriaState.visible || DEFAULT_RANKING_CRITERIA.visible;

        tableBody.innerHTML = rankedList.map(item => {
            const rankBadge = isOverallDesc && item.tableIndex === 1
                ? "<span class=\"inline-flex items-center justify-center w-7 h-7 rounded-lg bg-amber-500 text-white font-black text-xs shadow-xs\" title=\"Juara 1 Bintang SMANTARA\">🥇 1</span>"
                : isOverallDesc && item.tableIndex === 2
                    ? '<span class="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-300 dark:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs" title="Runner Up">🥈 2</span>'
                    : isOverallDesc && item.tableIndex === 3
                        ? '<span class="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-amber-700/80 text-white font-bold text-xs" title="Juara 3">🥉 3</span>'
                        : `<span class="inline-flex items-center justify-center w-6 h-6 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-semibold text-xs">${item.tableIndex}</span>`;

            const attBadge = getCategoryRankBadge(categoryRanks.attendance[item.className], 'Kehadiran');
            const sppBadge = getCategoryRankBadge(categoryRanks.spp[item.className], 'Kelancaran SPP');
            const discBadge = getCategoryRankBadge(categoryRanks.discipline[item.className], 'Kedisiplinan');
            const libBadge = getCategoryRankBadge(categoryRanks.library[item.className], 'Literasi Perpustakaan');
            const overallBadge = getCategoryRankBadge(categoryRanks.overall[item.className], 'Skor Indeks Keseluruhan');

            const vPts = item.discipline.violationsCount || 0;
            const pCount = item.discipline.permissionCount || 0;
            const aPts = item.discipline.achievementPoints || 0;
            const discTooltip = `${vPts} Poin Pelanggaran, ${pCount}x Permisi Keluar Kelas${item.discipline.achievementPoints > 0 ? `, +${item.discipline.achievementPoints} Prestasi` : ''}`;

            const achSuffix = item.discipline.achievementPoints > 0 ? ` (+${item.discipline.achievementPoints})` : '';
            const discSubText = item.discipline.violationsCount > 0
                ? `${item.discipline.violationsCount} Poin • ${pCount}x Izin${achSuffix}`
                : (pCount > 0 ? `0 Poin • ${pCount}x Izin${achSuffix}` : (item.discipline.achievementPoints > 0 ? `0 Poin (+${item.discipline.achievementPoints})` : '0 Poin'));
            const discSubColor = item.discipline.violationsCount > 0
                ? 'font-semibold text-rose-500'
                : (pCount > 0 ? 'font-medium text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500 font-medium');

            return `
                <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                    <td class="px-3.5 py-2 text-center">${rankBadge}</td>
                    <td class="px-3.5 py-2 font-bold text-slate-800 dark:text-white">
                        <button type="button" onclick="window.openClassDetailModal('${escapeHTML(item.className)}')"
                            title="Klik untuk melihat detail kelas & wali kelas"
                            class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 font-bold text-xs border border-blue-200 dark:border-blue-900/40 transition-all hover:scale-105 active:scale-95 group text-left cursor-pointer">
                            <span>${escapeHTML(item.className)}</span>
                            <i class="fa-solid fa-circle-info text-[10px] text-blue-400 dark:text-blue-400 group-hover:text-blue-600 dark:group-hover:text-blue-200 transition-colors"></i>
                        </button>
                    </td>
                    <td class="px-3.5 py-2 text-center font-medium tabular-nums">${item.totalStudents}</td>
                    <td class="px-3.5 py-2 text-center ${vis.attendance ? '' : 'hidden'}">
                        <div class="inline-flex items-center justify-center relative">
                            <span class="font-bold tabular-nums ${item.attendance.rate >= 90 ? 'text-emerald-600 dark:text-emerald-400' : item.attendance.rate >= 80 ? 'text-blue-600' : 'text-amber-600'}">
                                ${formatPercentage(item.attendance.rate)}
                            </span>
                            <span class="absolute left-full top-1/2 -translate-y-1/2 ml-1.5 shrink-0 inline-flex items-center">${attBadge}</span>
                        </div>
                    </td>
                    <td class="px-3.5 py-2 text-center ${vis.spp ? '' : 'hidden'}" title="${item.spp.paidCount || 0} dari ${item.totalStudents || item.spp.totalCount || 0} siswa lunas SPP hingga bulan berjalan">
                        <div class="inline-flex items-center justify-center relative">
                            <span class="font-bold tabular-nums ${item.spp.rate >= 90 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300'}">
                                ${formatPercentage(item.spp.rate)}
                            </span>
                            <span class="absolute left-full top-1/2 -translate-y-1/2 ml-1.5 shrink-0 inline-flex items-center">${sppBadge}</span>
                        </div>
                        <span class="block text-[10px] leading-tight mt-0.5 ${item.spp.paidCount === (item.totalStudents || item.spp.totalCount) && (item.totalStudents || item.spp.totalCount) > 0 ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-slate-400 dark:text-slate-500 font-medium'}">
                            ${item.spp.paidCount || 0}/${item.totalStudents || item.spp.totalCount || 0} Siswa
                        </span>
                    </td>
                    <td class="px-3.5 py-2 text-center ${vis.discipline ? '' : 'hidden'}" title="${discTooltip}">
                        <div class="inline-flex items-center justify-center relative">
                            <span class="font-bold tabular-nums ${item.discipline.score >= 95 ? 'text-purple-600 dark:text-purple-400' : item.discipline.score >= 80 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}">
                                ${formatPercentage(item.discipline.score)}
                            </span>
                            <span class="absolute left-full top-1/2 -translate-y-1/2 ml-1.5 shrink-0 inline-flex items-center">${discBadge}</span>
                        </div>
                        <span class="block text-[10px] leading-tight mt-0.5 ${discSubColor}">
                            ${discSubText}
                        </span>
                    </td>
                    <td class="px-3.5 py-2 text-center font-medium ${vis.library ? '' : 'hidden'}">
                        <div class="inline-flex items-center justify-center relative">
                            <span class="tabular-nums font-semibold">${item.library.borrowCount}</span>
                            <span class="absolute left-full top-1/2 -translate-y-1/2 ml-1.5 shrink-0 inline-flex items-center">${libBadge}</span>
                        </div>
                    </td>
                    <td class="px-3.5 py-2 text-center bg-blue-50/30 dark:bg-blue-950/20">
                        <div class="inline-flex items-center justify-center relative">
                            <span class="font-black text-blue-700 dark:text-blue-400 text-sm tabular-nums">
                                ${(item.overallScore >= 100 || Number(item.overallScore.toFixed(1)) === 100) ? '100' : formatDecimal(item.overallScore, 1)}
                            </span>
                            <span class="absolute left-full top-1/2 -translate-y-1/2 ml-1.5 shrink-0 inline-flex items-center">${overallBadge}</span>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }
}

function renderEmptyState() {
    const tableBody = document.getElementById('ranking-table-body');
    const gridContainer = document.getElementById('view-grid-container');
    const podiumContainer = document.getElementById('podium-container');

    if (podiumContainer) podiumContainer.innerHTML = '';

    const emptyHtml = `
        <tr>
            <td colspan="8" class="p-8 text-center text-slate-400">
                <i class="fa-solid fa-inbox text-3xl mb-2 block opacity-60"></i>
                <span>Tidak ada data kelas yang sesuai dengan filter saat ini.</span>
            </td>
        </tr>
    `;

    if (tableBody) tableBody.innerHTML = emptyHtml;
    if (gridContainer) {
        gridContainer.innerHTML = `
            <div class="col-span-full p-8 text-center text-slate-400">
                Tidak ada data kelas yang sesuai.
            </div>
        `;
    }
}

// =====================================
// MODAL DETAIL KINERJA KELAS
// =====================================
export function openClassDetailModal(className) {
    const item = state.rankedClasses.find(c => c.className === className);
    if (!item) return;

    const modal = document.getElementById('modal-detail-kelas');
    if (!modal) return;

    // Set Header
    const elRankBadge = document.getElementById('modal-class-rank-badge');
    const elTitle = document.getElementById('modal-class-title');
    const elSubtitle = document.getElementById('modal-class-subtitle');
    if (elRankBadge) elRankBadge.textContent = `#${item.rank}`;
    if (elTitle) elTitle.textContent = `Kelas ${item.className}`;
    if (elSubtitle) elSubtitle.textContent = `Skor Keseluruhan: ${formatDecimal(item.overallScore, 1)} | ${item.totalStudents} Siswa Terdaftar`;

    // Wali Kelas Card
    const elWaliName = document.getElementById('modal-wali-name');
    const elWaliNip = document.getElementById('modal-wali-nip');
    const elWaliAvatar = document.getElementById('modal-wali-avatar');
    const elWaliContact = document.getElementById('modal-wali-contact-container');

    if (elWaliName) elWaliName.textContent = item.wali?.name || 'Belum Ditentukan';
    if (elWaliNip) elWaliNip.textContent = item.wali?.nip ? `NIP. ${item.wali.nip}` : 'NIP. -';

    if (elWaliAvatar) {
        const photoUrl = item.wali?.photo ? resolvePhotoUrl(item.wali.photo) : null;
        const initial = (item.wali?.name || 'W').charAt(0).toUpperCase();
        if (photoUrl) {
            elWaliAvatar.innerHTML = `<img src="${photoUrl}" alt="${escapeHTML(item.wali?.name || '')}" class="w-full h-full object-cover rounded-2xl shadow-xs" onerror="this.onerror=null; this.parentElement.innerHTML='<span>${initial}</span>';">`;
        } else {
            elWaliAvatar.innerHTML = `<span>${initial}</span>`;
        }
    }

    if (elWaliContact) {
        const phone = item.wali?.phone ? item.wali.phone.replace(/[^0-9]/g, '').replace(/^0/, '62') : '';
        if (phone) {
            elWaliContact.innerHTML = `
                <a href="https://wa.me/${phone}" target="_blank"
                    class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm transition-colors">
                    <i class="fa-brands fa-whatsapp text-sm"></i>
                    <span>Chat WA</span>
                </a>
            `;
        } else {
            elWaliContact.innerHTML = `
                <span class="text-[11px] text-slate-400 italic">No HP tidak tersedia</span>
            `;
        }
    }

    // Grid Skor
    const elAtt = document.getElementById('modal-score-attendance');
    const elAttCount = document.getElementById('modal-detail-attendance-count');
    if (elAtt) elAtt.textContent = formatPercentage(item.attendance.rate);
    if (elAttCount) elAttCount.textContent = `${item.attendance.H} Hadir${item.attendance.D > 0 ? ` (+${item.attendance.D} Disp)` : ''}`;

    const elSpp = document.getElementById('modal-score-spp');
    const elSppCount = document.getElementById('modal-detail-spp-count');
    if (elSpp) elSpp.textContent = formatPercentage(item.spp.rate);
    if (elSppCount) elSppCount.textContent = `${item.spp.paidCount}/${item.totalStudents} Siswa`;

    const elDisc = document.getElementById('modal-score-discipline');
    const elDiscPts = document.getElementById('modal-detail-discipline-points');
    if (elDisc) elDisc.textContent = formatPercentage(item.discipline.score);
    if (elDiscPts) {
        const vPts = item.discipline.violationsCount || 0;
        const pCount = item.discipline.permissionCount || 0;
        const aPts = item.discipline.achievementPoints || 0;
        const parts = [];
        parts.push(`${vPts} Poin Pelanggaran`);
        parts.push(`${pCount}x Permisi`);
        if (aPts > 0) parts.push(`+${aPts} Prestasi`);
        elDiscPts.textContent = parts.join(' • ');
    }

    const elLib = document.getElementById('modal-score-library');
    if (elLib) elLib.textContent = `${item.library.borrowCount}`;

    // Komposisi Presensi Granular (H, S, I, D, A)
    const elH = document.getElementById('modal-breakdown-h');
    const elS = document.getElementById('modal-breakdown-s');
    const elI = document.getElementById('modal-breakdown-i');
    const elD = document.getElementById('modal-breakdown-d');
    const elA = document.getElementById('modal-breakdown-a');

    if (elH) elH.textContent = item.attendance.H;
    if (elS) elS.textContent = item.attendance.S;
    if (elI) elI.textContent = item.attendance.I;
    if (elD) elD.textContent = item.attendance.D;
    if (elA) elA.textContent = item.attendance.A;

    // Catatan Motivasi
    const elMotiv = document.getElementById('modal-motivation-text');
    if (elMotiv) {
        if (item.rank <= 3) {
            elMotiv.textContent = `Luar biasa! Kelas ${item.className} berada di 3 besar terbaik sekolah. Terus pertahankan kekompakan dan dedikasi belajar bersama Bapak/Ibu Wali Kelas.`;
        } else if (item.attendance.rate < 85) {
            elMotiv.textContent = `Tingkat kehadiran siswa perlu perhatian lebih (${formatPercentage(item.attendance.rate)}). Disarankan wali kelas berkoordinasi dengan Guru BK dan orang tua siswa yang sering berhalangan.`;
        } else if (item.spp.rate < 70) {
            elMotiv.textContent = `Kelancaran SPP masih perlu ditingkatkan (${formatPercentage(item.spp.rate)}). Dorong ketertiban administrasi agar kegiatan kesiswaan dapat berjalan optimal.`;
        } else {
            elMotiv.textContent = `Kinerja rombel ini sudah cukup stabil. Dorong keaktifan literasi perpustakaan dan prestasi akademik/non-akademik untuk meraih peringkat yang lebih tinggi.`;
        }
    }

    modal.classList.remove('hidden');
}

export function closeClassDetailModal() {
    const modal = document.getElementById('modal-detail-kelas');
    if (modal) modal.classList.add('hidden');
}

// =====================================
// KONTROL FILTER & NAVIGASI
// =====================================
export function switchCategory(cat) {
    state.activeCategory = cat;

    // Sinkronkan ke currentRankingSort
    if (cat === 'overall') currentRankingSort = { column: 'overall', direction: 'desc' };
    else if (cat === 'spp') currentRankingSort = { column: 'spp', direction: 'desc' };
    else if (cat === 'attendance') currentRankingSort = { column: 'attendance', direction: 'desc' };
    else if (cat === 'discipline') currentRankingSort = { column: 'discipline', direction: 'desc' };
    else if (cat === 'library') currentRankingSort = { column: 'library', direction: 'desc' };

    // Update active category description
    const elDesc = document.getElementById('label-active-category-desc');
    if (elDesc) {
        elDesc.textContent = 'Klik header kolom (Kelas, Kehadiran, SPP, Kedisiplinan, Literasi, Skor) untuk mengurutkan tabel.';
    }

    updateRankingSortIcons();
    recomputeRankings();
}

export function setGradeFilter(grade) {
    state.gradeFilter = grade;

    const btns = document.querySelectorAll('.grade-filter-btn');
    btns.forEach(b => {
        if (b.dataset.grade === grade) {
            b.classList.add('bg-white', 'dark:bg-slate-700', 'text-slate-800', 'dark:text-white', 'shadow-xs');
            b.classList.remove('text-slate-500', 'dark:text-slate-400');
        } else {
            b.classList.remove('bg-white', 'dark:bg-slate-700', 'text-slate-800', 'dark:text-white', 'shadow-xs');
            b.classList.add('text-slate-500', 'dark:text-slate-400');
        }
    });

    recomputeRankings();
}

export function onPeriodScopeChange(scope) {
    state.periodScope = scope;
    loadRankingData(false);
}

export function onSearchClassInput(query) {
    state.searchQuery = query || '';
    recomputeRankings();
}

export function setViewMode(mode) {
    state.viewMode = mode;
    const tableContainer = document.getElementById('view-table-container');
    const gridContainer = document.getElementById('view-grid-container');
    const btnTable = document.getElementById('btn-view-table');
    const btnGrid = document.getElementById('btn-view-grid');

    if (mode === 'grid') {
        if (tableContainer) tableContainer.classList.add('hidden');
        if (gridContainer) gridContainer.classList.remove('hidden');

        if (btnGrid) {
            btnGrid.classList.add('bg-white', 'dark:bg-slate-700', 'text-slate-800', 'dark:text-white', 'shadow-xs');
            btnGrid.classList.remove('text-slate-500', 'dark:text-slate-400');
        }
        if (btnTable) {
            btnTable.classList.remove('bg-white', 'dark:bg-slate-700', 'text-slate-800', 'dark:text-white', 'shadow-xs');
            btnTable.classList.add('text-slate-500', 'dark:text-slate-400');
        }
    } else {
        if (tableContainer) tableContainer.classList.remove('hidden');
        if (gridContainer) gridContainer.classList.add('hidden');

        if (btnTable) {
            btnTable.classList.add('bg-white', 'dark:bg-slate-700', 'text-slate-800', 'dark:text-white', 'shadow-xs');
            btnTable.classList.remove('text-slate-500', 'dark:text-slate-400');
        }
        if (btnGrid) {
            btnGrid.classList.remove('bg-white', 'dark:bg-slate-700', 'text-slate-800', 'dark:text-white', 'shadow-xs');
            btnGrid.classList.add('text-slate-500', 'dark:text-slate-400');
        }
    }
}

export function refreshRankingData(force = true) {
    loadRankingData(force);
}

export function printRankingReport() {
    window.print();
}

function updateCacheStatusUI(text, timestamp = 0) {
    const el = document.getElementById('cache-status-text');
    if (el) {
        if (timestamp && typeof timestamp === 'number') {
            try {
                const dateObj = new Date(timestamp);
                const timeStr = dateObj.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Makassar' });
                el.textContent = `${text} • ${timeStr} WITA`;
            } catch (_) {
                el.textContent = text;
            }
        } else {
            el.textContent = text;
        }
    }
}

export function renderDataStatusBanner() {
    const bannerContainer = document.getElementById('ranking-data-status-banner');
    if (!bannerContainer) return;

    if (state.isDataComplete) {
        bannerContainer.classList.add('hidden');
        bannerContainer.innerHTML = '';
        return;
    }

    const s = state.sourcesStatus || {};
    const getBadge = (name, item) => {
        const st = item?.status || 'idle';
        if (st === 'success') {
            return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800"><i class="fa-solid fa-check"></i> ${name}: Lengkap (${item.count || 0})</span>`;
        }
        if (st === 'empty') {
            return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-800"><i class="fa-solid fa-inbox"></i> ${name}: 0 Catatan</span>`;
        }
        if (st === 'partial') {
            return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800"><i class="fa-solid fa-triangle-exclamation"></i> ${name}: Dibatasi/Parsial</span>`;
        }
        if (st === 'error') {
            return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800"><i class="fa-solid fa-circle-xmark"></i> ${name}: Gagal (${escapeHTML(item.error || 'Gangguan')})</span>`;
        }
        return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">${name}: Memuat</span>`;
    };

    bannerContainer.classList.remove('hidden');
    bannerContainer.innerHTML = `
        <div class="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-slate-700 dark:text-slate-200 mb-6 shadow-xs">
            <div class="flex items-center justify-between flex-wrap gap-2 mb-2">
                <div class="flex items-center gap-2 font-bold text-xs text-amber-800 dark:text-amber-300">
                    <i class="fa-solid fa-shield-halved text-amber-600"></i>
                    <span>Informasi Kelengkapan Sumber Data Periode Ini:</span>
                </div>
                <span class="text-[11px] text-slate-500 dark:text-slate-400">
                    Rentang: ${escapeHTML(state.snapshotRange?.startDate || '-')} s.d. ${escapeHTML(state.snapshotRange?.endDate || '-')}
                </span>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
                ${getBadge('Kehadiran', s.attendance)}
                ${getBadge('SPP', s.spp)}
                ${getBadge('Disiplin BK', s.discipline)}
                ${getBadge('Literasi Perpustakaan', s.library)}
            </div>
            <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                *Sebagian metrik dibatasi oleh kebijakan keamanan RBAC atau memerlukan rilis server agregasi. Peringkat rombel kelas berstatus indikasi sementara.
            </p>
        </div>
    `;
}

// =====================================
// MANAJEMEN TAB & FORM KRITERIA PENILAIAN MODAL
// =====================================
export function switchRankingSettingsTab(tab) {
    const tabBtnCriteria = document.getElementById('tab-btn-criteria');
    const tabBtnAccess = document.getElementById('tab-btn-access');
    const contentCriteria = document.getElementById('tab-content-criteria');
    const contentAccess = document.getElementById('tab-content-access');

    if (tab === 'criteria') {
        if (tabBtnCriteria) {
            tabBtnCriteria.className = 'pb-2.5 text-xs font-bold border-b-2 border-blue-600 text-blue-600 dark:text-blue-400 flex items-center gap-1.5 transition-colors';
        }
        if (tabBtnAccess) {
            tabBtnAccess.className = 'pb-2.5 text-xs font-semibold border-b-2 border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 flex items-center gap-1.5 transition-colors';
        }
        if (contentCriteria) contentCriteria.classList.remove('hidden');
        if (contentAccess) contentAccess.classList.add('hidden');
    } else {
        if (tabBtnCriteria) {
            tabBtnCriteria.className = 'pb-2.5 text-xs font-semibold border-b-2 border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 flex items-center gap-1.5 transition-colors';
        }
        if (tabBtnAccess) {
            tabBtnAccess.className = 'pb-2.5 text-xs font-bold border-b-2 border-blue-600 text-blue-600 dark:text-blue-400 flex items-center gap-1.5 transition-colors';
        }
        if (contentCriteria) contentCriteria.classList.add('hidden');
        if (contentAccess) contentAccess.classList.remove('hidden');
    }
}

export function loadRankingCriteriaToForm() {
    const vis = rankingCriteriaState.visible || DEFAULT_RANKING_CRITERIA.visible;
    const w = rankingCriteriaState.weights || DEFAULT_RANKING_CRITERIA.weights;

    ['attendance', 'spp', 'discipline', 'library'].forEach(key => {
        const toggle = document.getElementById(`criteria-toggle-${key}`);
        const input = document.getElementById(`criteria-weight-${key}`);
        if (toggle) toggle.checked = vis[key] !== false;
        if (input) input.value = typeof w[key] === 'number' ? w[key] : DEFAULT_RANKING_CRITERIA.weights[key];
    });

    updateCriteriaTotalWeightDisplay();
}

export function updateCriteriaTotalWeightDisplay() {
    const keys = ['attendance', 'spp', 'discipline', 'library'];
    let total = 0;

    keys.forEach(key => {
        const toggle = document.getElementById(`criteria-toggle-${key}`);
        const input = document.getElementById(`criteria-weight-${key}`);
        if (toggle && input) {
            input.disabled = !toggle.checked;
            if (toggle.checked) {
                input.classList.remove('opacity-40', 'bg-slate-100', 'dark:bg-slate-800');
                input.classList.add('bg-white', 'dark:bg-slate-900');
                const val = Math.max(0, parseInt(input.value || 0, 10));
                total += val;
            } else {
                // Latar nonaktif menggantikan latar dasar (urutan CSS Tailwind build)
                input.classList.remove('bg-white', 'dark:bg-slate-900');
                input.classList.add('opacity-40', 'bg-slate-100', 'dark:bg-slate-800');
            }
        }
    });

    const badge = document.getElementById('criteria-total-weight-badge');
    const badgeText = document.getElementById('criteria-total-weight-text');

    if (badge && badgeText) {
        if (total === 100) {
            badge.className = 'inline-flex items-center gap-1.5 mt-1 px-2.5 py-1 rounded-xl text-xs font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800';
            badge.innerHTML = `<i class="fa-solid fa-circle-check text-emerald-500"></i><span id="criteria-total-weight-text">Total: 100% (Sempurna & Seimbang)</span>`;
        } else {
            badge.className = 'inline-flex items-center gap-1.5 mt-1 px-2.5 py-1 rounded-xl text-xs font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800';
            badge.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-amber-500"></i><span id="criteria-total-weight-text">Total: ${total}% (Disarankan 100%)</span>`;
        }
    }
    return total;
}

export function distributeRankingWeightsEvenly() {
    const keys = ['attendance', 'spp', 'discipline', 'library'];
    const activeKeys = keys.filter(k => {
        const toggle = document.getElementById(`criteria-toggle-${k}`);
        return toggle ? toggle.checked : true;
    });

    if (activeKeys.length === 0) {
        if (typeof showToast === 'function') {
            showToast('Peringatan', 'Aktifkan minimal satu kriteria untuk membagi rata bobot.', 'warning');
        }
        return;
    }

    const count = activeKeys.length;
    const baseWeight = Math.floor(100 / count);
    const remainder = 100 % count;

    activeKeys.forEach((key, idx) => {
        const input = document.getElementById(`criteria-weight-${key}`);
        if (input) {
            input.value = baseWeight + (idx < remainder ? 1 : 0);
        }
    });

    updateCriteriaTotalWeightDisplay();
}

export function resetRankingCriteriaToDefault() {
    const def = DEFAULT_RANKING_CRITERIA;
    ['attendance', 'spp', 'discipline', 'library'].forEach(key => {
        const toggle = document.getElementById(`criteria-toggle-${key}`);
        const input = document.getElementById(`criteria-weight-${key}`);
        if (toggle) toggle.checked = def.visible[key];
        if (input) input.value = def.weights[key];
    });

    updateCriteriaTotalWeightDisplay();
}

// =====================================
// LOGIKA MODAL PENGATURAN MODUL (SUPER ADMIN)
// =====================================
export async function openRankingAccessModal() {
    const allRoles = typeof window.getAllUserRoles === 'function' ? window.getAllUserRoles() : [localStorage.getItem('user_role') || ''];
    if (!allRoles.includes('super_admin')) {
        if (typeof showToast === 'function') {
            showToast('Akses Ditolak', 'Hanya Super Admin yang berhak mengatur hak akses modul ini.', 'warning');
        }
        return;
    }

    // Ambil konfigurasi kriteria terkini jika ada
    await loadRankingCriteriaConfig().catch(() => {});
    loadRankingCriteriaToForm();
    switchRankingSettingsTab('criteria');
    updateCriteriaTotalWeightDisplay();

    // Ambil konfigurasi akses terkini dari D1 atau cache
    try {
        let cfg = null;
        if (cfClient && typeof cfClient.getSystemSetting === 'function') {
            cfg = await cfClient.getSystemSetting('ranking_access_config');
        }
        if (!cfg) {
            const cached = localStorage.getItem('simas_ranking_access_config');
            if (cached) cfg = JSON.parse(cached);
        }
        if (cfg) {
            accessSettingsState.mode = cfg.mode || 'roles';
            accessSettingsState.allowed_roles = Array.isArray(cfg.allowed_roles) ? cfg.allowed_roles : accessSettingsState.allowed_roles;
            accessSettingsState.allowed_users = Array.isArray(cfg.allowed_users) ? cfg.allowed_users : [];
            if (cfg.schedule && typeof cfg.schedule === 'object') {
                accessSettingsState.schedule = {
                    enabled: cfg.schedule.enabled !== false,
                    startDay: 5,
                    startHour: typeof cfg.schedule.startHour === 'number' ? cfg.schedule.startHour : 12,
                    startMinute: typeof cfg.schedule.startMinute === 'number' ? cfg.schedule.startMinute : 15,
                    endDay: 1,
                    endHour: typeof cfg.schedule.endHour === 'number' ? cfg.schedule.endHour : 10,
                    endMinute: typeof cfg.schedule.endMinute === 'number' ? cfg.schedule.endMinute : 0,
                    customMotivationMessage: cfg.schedule.customMotivationMessage || ''
                };
            }
        }
    } catch (err) {
        console.warn('[RankingKelas] Gagal mengambil konfigurasi akses:', err);
    }

    // Pastikan super_admin selalu ada di allowed_roles
    if (!accessSettingsState.allowed_roles.includes('super_admin')) {
        accessSettingsState.allowed_roles.unshift('super_admin');
    }

    // Render mode radio
    const radioModes = document.querySelectorAll('input[name="ranking-access-mode"]');
    radioModes.forEach(r => {
        r.checked = (r.value === accessSettingsState.mode);
    });

    renderRoleCheckboxes();
    renderSpecificUsersTags();
    onAccessModeChange(accessSettingsState.mode);

    // Muat nilai ke form pembatasan jadwal akses publik (WITA)
    const toggleSchedule = document.getElementById('ranking-schedule-toggle');
    if (toggleSchedule) {
        toggleSchedule.checked = accessSettingsState.schedule?.enabled !== false;
    }
    const inputMotivation = document.getElementById('ranking-schedule-motivation-input');
    if (inputMotivation) {
        inputMotivation.value = accessSettingsState.schedule?.customMotivationMessage || '';
    }

    // Muat master user directory secara lazy di latar belakang (0 Firestore Read)
    getMasterUserDirectory().catch(e => console.warn('[RankingKelas] Preload user directory warning:', e));

    const modal = document.getElementById('modal-ranking-access-settings');
    if (modal) modal.classList.remove('hidden');
}

export function closeRankingAccessModal() {
    closeUserSearchDropdown();
    const modal = document.getElementById('modal-ranking-access-settings');
    if (modal) modal.classList.add('hidden');
}

export function onAccessModeChange(mode) {
    accessSettingsState.mode = mode;
    const secRole = document.getElementById('section-role-access');
    const secUsers = document.getElementById('section-specific-users');

    if (mode === 'all') {
        if (secRole) secRole.classList.add('opacity-40', 'pointer-events-none');
        if (secUsers) secUsers.classList.add('opacity-40', 'pointer-events-none');
    } else if (mode === 'roles') {
        if (secRole) secRole.classList.remove('opacity-40', 'pointer-events-none');
        if (secUsers) secUsers.classList.add('opacity-40', 'pointer-events-none');
    } else if (mode === 'specific_users') {
        if (secRole) secRole.classList.add('opacity-40', 'pointer-events-none');
        if (secUsers) secUsers.classList.remove('opacity-40', 'pointer-events-none');
    } else if (mode === 'combined') {
        if (secRole) secRole.classList.remove('opacity-40', 'pointer-events-none');
        if (secUsers) secUsers.classList.remove('opacity-40', 'pointer-events-none');
    }
}

// =====================================
// MANAJEMEN MASTER USER DIRECTORY (0 FIRESTORE READ)
// =====================================
let masterUsersCache = null;
let isBuildingMasterUsers = false;

export async function getMasterUserDirectory() {
    if (masterUsersCache && masterUsersCache.length > 0) {
        return masterUsersCache;
    }
    if (isBuildingMasterUsers) {
        return masterUsersCache || [];
    }
    isBuildingMasterUsers = true;

    try {
        const directory = [];

        // 1. Ambil GTK dari Cache Lokal / IndexedDB / D1 (0 Firestore Read)
        let teachers = [];
        if (typeof window.getTeachersCache === 'function') {
            teachers = await window.getTeachersCache().catch(() => []);
        } else if (cfClient && typeof cfClient.getTeachers === 'function') {
            teachers = await cfClient.getTeachers().catch(() => []);
        }

        if (Array.isArray(teachers)) {
            teachers.forEach(t => {
                const name = t.nama || t.name || '';
                const nip = (t.nip || '').trim();
                const email = (t.email || '').toLowerCase().trim();
                const role = t.role || (nip ? 'guru_mapel' : 'staff');
                let addRoles = [];
                if (Array.isArray(t.additional_roles)) addRoles = t.additional_roles;
                else if (Array.isArray(t.additionalRoles)) addRoles = t.additionalRoles;
                else if (typeof t.additional_roles === 'string') {
                    try { addRoles = JSON.parse(t.additional_roles); } catch (e) {}
                }

                if (name || nip || email) {
                    directory.push({
                        type: 'gtk',
                        name,
                        nip,
                        email,
                        identifier: nip || email || name,
                        role,
                        additionalRoles: Array.isArray(addRoles) ? addRoles : [],
                        label: `${name}${nip ? ` (NIP: ${nip})` : (email ? ` (${email})` : '')}`
                    });
                }
            });
        }

        // 2. Ambil Siswa dari state atau Cache Lokal / IndexedDB (0 Firestore Read)
        let students = state.studentsList || [];
        if ((!students || students.length === 0) && typeof window.getStudentsCache === 'function') {
            students = await window.getStudentsCache().catch(() => []);
        }

        if (Array.isArray(students)) {
            students.forEach(s => {
                const name = s.nama || s.name || '';
                const nis = (s.nis || s.nisn || '').trim();
                const cls = (s.kelas || s.className || '').trim();
                const email = (s.email || '').toLowerCase().trim();
                let addRoles = [];
                if (Array.isArray(s.additional_roles)) addRoles = s.additional_roles;
                else if (Array.isArray(s.additionalRoles)) addRoles = s.additionalRoles;

                if (name || nis) {
                    directory.push({
                        type: 'siswa',
                        name,
                        nis,
                        className: cls,
                        email,
                        identifier: nis || email || name,
                        role: s.role || 'siswa',
                        additionalRoles: Array.isArray(addRoles) ? addRoles : [],
                        label: `${name}${cls ? ` - ${cls}` : ''}${nis ? ` (NIS: ${nis})` : ''}`
                    });
                }
            });
        }

        masterUsersCache = directory;
    } catch (e) {
        console.warn('[RankingKelas] Gagal mengumpulkan master user directory:', e);
        masterUsersCache = [];
    } finally {
        isBuildingMasterUsers = false;
    }

    return masterUsersCache || [];
}

// Helper: Ambil seluruh role yang saat ini tercentang di UI
export function getCurrentlyCheckedRoles() {
    const checked = ['super_admin'];
    const checkboxes = document.querySelectorAll('.role-access-checkbox:checked');
    checkboxes.forEach(cb => {
        const val = cb.value;
        if (val && !checked.includes(val)) {
            checked.push(val);
        }
    });
    return checked;
}

// Filter daftar user: mengecualikan yang sudah ada di whitelist atau role-nya sudah tercentang
export function filterEligibleUsers(usersList, checkedRoles, currentAllowedUsers, query = '') {
    const q = (query || '').toLowerCase().trim();
    const allowedSet = new Set((currentAllowedUsers || []).map(u => String(u || '').toLowerCase().trim()));

    return (usersList || []).filter(user => {
        // 1. Kecualikan jika sudah terdaftar di allowed_users
        const identifiers = [
            user.identifier,
            user.nip,
            user.nis,
            user.email,
            user.name
        ].filter(Boolean).map(x => String(x).toLowerCase().trim());

        if (identifiers.some(id => allowedSet.has(id))) {
            return false;
        }

        // 2. ATURAN PENGECUALIAN DINAMIS (Kombinasi Role + Pengguna Khusus):
        // Jika salah satu role user (primary role atau additional roles) sudah tercentang di atas,
        // user tersebut DIKECUALIKAN dari dropdown karena hak aksesnya sudah di-cover oleh role!
        const userRoles = [user.role, ...(user.additionalRoles || [])].filter(Boolean);
        const hasCheckedRole = userRoles.some(r => checkedRoles.includes(r));
        if (hasCheckedRole) {
            return false;
        }

        // 3. Filter query jika diketikkan
        if (q) {
            const matchName = (user.name || '').toLowerCase().includes(q);
            const matchNip = (user.nip || '').toLowerCase().includes(q);
            const matchNis = (user.nis || '').toLowerCase().includes(q);
            const matchEmail = (user.email || '').toLowerCase().includes(q);
            const matchClass = (user.className || '').toLowerCase().includes(q);
            return matchName || matchNip || matchNis || matchEmail || matchClass;
        }

        return true;
    });
}

// =====================================
// RENDER CHECKBOX ROLE TERKELOMPOK
// =====================================
export function renderRoleCheckboxes() {
    const container = document.getElementById('role-checkbox-container');
    if (!container) return;

    const renderRoleCard = (role) => {
        const isChecked = accessSettingsState.allowed_roles.includes(role.key);
        const isLocked = role.locked === true;
        return `
            <label class="flex items-center gap-2.5 p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-800/80 hover:bg-blue-50/50 dark:hover:bg-slate-700/50 cursor-pointer select-none transition-colors overflow-hidden">
                <input type="checkbox" value="${role.key}"
                    onchange="window.onRoleCheckboxToggle('${role.key}')"
                    class="role-access-checkbox w-4 h-4 rounded text-blue-600 focus:ring-blue-500 shrink-0"
                    style="width: 16px !important; height: 16px !important; min-width: 16px !important; min-height: 16px !important; padding: 0 !important; margin: 0 !important; flex-shrink: 0 !important;"
                    ${isChecked ? 'checked' : ''}
                    ${isLocked ? 'disabled checked data-locked="true"' : ''}>
                <div class="flex flex-col min-w-0 flex-1">
                    <span class="text-xs ${isLocked ? 'font-black text-amber-600 dark:text-amber-400' : 'font-semibold text-slate-800 dark:text-slate-200'} leading-tight">
                        ${escapeHTML(role.label)}
                    </span>
                    <span class="text-[10px] text-slate-400 dark:text-slate-500 font-mono mt-0.5">
                        ${escapeHTML(role.key)}
                    </span>
                </div>
                ${isLocked ? '<span class="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 shrink-0">Wajib</span>' : ''}
            </label>
        `;
    };

    container.innerHTML = `
        <!-- KELOMPOK 1: ROLE UTAMA -->
        <div class="p-3 bg-slate-50/90 dark:bg-slate-800/50 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 space-y-2">
            <div class="flex items-center justify-between pb-1 border-b border-slate-200/60 dark:border-slate-700/60">
                <div class="flex items-center gap-1.5">
                    <i class="fa-solid fa-user-shield text-blue-500 text-xs"></i>
                    <span class="text-xs font-bold text-slate-700 dark:text-slate-200">Role Utama (Akun Pokok)</span>
                </div>
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                    ${PRIMARY_ROLES.length} Role
                </span>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                ${PRIMARY_ROLES.map(renderRoleCard).join('')}
            </div>
        </div>

        <!-- KELOMPOK 2: ROLE TAMBAHAN -->
        <div class="p-3 bg-slate-50/90 dark:bg-slate-800/50 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 space-y-2">
            <div class="flex items-center justify-between pb-1 border-b border-slate-200/60 dark:border-slate-700/60">
                <div class="flex items-center gap-1.5">
                    <i class="fa-solid fa-user-tag text-purple-500 text-xs"></i>
                    <span class="text-xs font-bold text-slate-700 dark:text-slate-200">Role Tambahan (Tugas Rangkap & Fungsional)</span>
                </div>
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">
                    ${ADDITIONAL_ROLES.length} Role
                </span>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                ${ADDITIONAL_ROLES.map(renderRoleCard).join('')}
            </div>
        </div>
    `;
}

export function onRoleCheckboxToggle(roleKey) {
    accessSettingsState.allowed_roles = getCurrentlyCheckedRoles();

    // Jika dropdown menu pencarian pengguna khusus sedang aktif, refresh secara real-time
    const menu = document.getElementById('user-search-dropdown-menu');
    if (menu && !menu.classList.contains('hidden')) {
        const input = document.getElementById('input-new-specific-user');
        refreshUserSearchDropdown(input ? input.value : '');
    }
}

export function selectAllRoles() {
    const checkboxes = document.querySelectorAll('.role-access-checkbox');
    checkboxes.forEach(cb => {
        cb.checked = true;
    });
    accessSettingsState.allowed_roles = getCurrentlyCheckedRoles();

    const menu = document.getElementById('user-search-dropdown-menu');
    if (menu && !menu.classList.contains('hidden')) {
        const input = document.getElementById('input-new-specific-user');
        refreshUserSearchDropdown(input ? input.value : '');
    }
}

export function clearAllRoles() {
    const checkboxes = document.querySelectorAll('.role-access-checkbox');
    checkboxes.forEach(cb => {
        if (!cb.dataset.locked) {
            cb.checked = false;
        }
    });
    accessSettingsState.allowed_roles = getCurrentlyCheckedRoles();

    const menu = document.getElementById('user-search-dropdown-menu');
    if (menu && !menu.classList.contains('hidden')) {
        const input = document.getElementById('input-new-specific-user');
        refreshUserSearchDropdown(input ? input.value : '');
    }
}

// =====================================
// KOMPONEN SEARCHABLE DROPDOWN PENGGUNA KHUSUS
// =====================================
export async function onUserSearchFocus() {
    const input = document.getElementById('input-new-specific-user');
    await refreshUserSearchDropdown(input ? input.value : '');
}

export async function onUserSearchInput(val) {
    const btnClear = document.getElementById('btn-clear-user-search');
    if (btnClear) {
        if (val && val.trim().length > 0) {
            btnClear.classList.remove('hidden');
        } else {
            btnClear.classList.add('hidden');
        }
    }
    await refreshUserSearchDropdown(val);
}

export function clearUserSearchInput() {
    const input = document.getElementById('input-new-specific-user');
    if (input) {
        input.value = '';
        input.focus();
    }
    const btnClear = document.getElementById('btn-clear-user-search');
    if (btnClear) btnClear.classList.add('hidden');
    refreshUserSearchDropdown('');
}

export function onUserSearchKeyDown(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        const firstBtn = document.querySelector('#user-search-dropdown-menu .user-search-item');
        if (firstBtn) {
            firstBtn.click();
        } else {
            addSpecificUserTag();
        }
    } else if (event.key === 'Escape') {
        closeUserSearchDropdown();
    }
}

export function closeUserSearchDropdown() {
    const menu = document.getElementById('user-search-dropdown-menu');
    if (menu) menu.classList.add('hidden');
}

export async function refreshUserSearchDropdown(query = '') {
    const menu = document.getElementById('user-search-dropdown-menu');
    if (!menu) return;

    const checkedRoles = getCurrentlyCheckedRoles();
    const directory = await getMasterUserDirectory();
    const eligible = filterEligibleUsers(directory, checkedRoles, accessSettingsState.allowed_users, query);

    menu.classList.remove('hidden');

    const cleanQ = (query || '').trim();

    if (eligible.length === 0) {
        if (cleanQ) {
            menu.innerHTML = `
                <div class="p-3 text-center text-xs text-slate-500 dark:text-slate-400">
                    <p class="mb-2">Tidak ditemukan pengguna di master data (atau role-nya sudah tercentang di atas).</p>
                    <button type="button" onclick="window.addCustomIdentifier('${escapeHTML(cleanQ)}')"
                        class="px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 font-bold hover:bg-blue-100 transition-colors">
                        <i class="fa-solid fa-plus mr-1"></i> Gunakan "${escapeHTML(cleanQ)}" sebagai ID khusus
                    </button>
                </div>
            `;
        } else {
            menu.innerHTML = `
                <div class="p-3 text-center text-xs text-slate-400 italic">
                    Semua pengguna telah tercakup oleh role yang tercentang di atas atau sudah didaftarkan.
                </div>
            `;
        }
        return;
    }

    const topResults = eligible.slice(0, 25);

    menu.innerHTML = topResults.map(u => {
        const typeBadge = u.type === 'gtk'
            ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">GTK</span>`
            : `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">${escapeHTML(u.className || 'Siswa')}</span>`;
        
        const subInfo = [u.nip ? `NIP: ${u.nip}` : '', u.nis ? `NIS: ${u.nis}` : '', u.email].filter(Boolean).join(' • ');

        return `
            <button type="button"
                onclick="window.selectUserFromDropdown('${escapeHTML(u.identifier)}', '${escapeHTML(u.name)}', '${u.type}')"
                class="user-search-item w-full text-left p-2.5 hover:bg-blue-50/70 dark:hover:bg-slate-800 transition-colors flex items-center justify-between gap-3 group border-b border-slate-100 dark:border-slate-800 last:border-0">
                <div class="flex items-center gap-2.5 min-w-0">
                    <div class="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 shrink-0 text-xs font-bold border border-slate-200 dark:border-slate-700">
                        ${u.type === 'gtk' ? '<i class="fa-solid fa-chalkboard-user"></i>' : '<i class="fa-solid fa-user-graduate"></i>'}
                    </div>
                    <div class="min-w-0">
                        <div class="text-xs font-bold text-slate-800 dark:text-slate-200 truncate group-hover:text-blue-600 transition-colors">
                            ${escapeHTML(u.name)}
                        </div>
                        <div class="text-[10px] text-slate-400 truncate">
                            ${escapeHTML(subInfo || u.identifier)}
                        </div>
                    </div>
                </div>
                <div class="shrink-0 flex items-center gap-1.5">
                    ${typeBadge}
                    <i class="fa-solid fa-plus text-xs text-slate-300 group-hover:text-blue-600"></i>
                </div>
            </button>
        `;
    }).join('');

    if (cleanQ) {
        menu.innerHTML += `
            <div class="p-2 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-100 dark:border-slate-800 text-right">
                <button type="button" onclick="window.addCustomIdentifier('${escapeHTML(cleanQ)}')"
                    class="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline">
                    + Tambahkan manual identifier: "${escapeHTML(cleanQ)}"
                </button>
            </div>
        `;
    }
}

export function selectUserFromDropdown(identifier, displayName, type) {
    if (!identifier) return;
    const lower = identifier.toLowerCase().trim();
    if (!accessSettingsState.allowed_users.some(u => u.toLowerCase() === lower)) {
        accessSettingsState.allowed_users.push(identifier);
        renderSpecificUsersTags();
    }
    clearUserSearchInput();
    closeUserSearchDropdown();
}

export function addCustomIdentifier(raw) {
    if (!raw) return;
    const clean = raw.trim();
    if (!clean) return;
    const lower = clean.toLowerCase();
    if (!accessSettingsState.allowed_users.some(u => u.toLowerCase() === lower)) {
        accessSettingsState.allowed_users.push(clean);
        renderSpecificUsersTags();
    }
    clearUserSearchInput();
    closeUserSearchDropdown();
}

export function addSpecificUserTag() {
    const input = document.getElementById('input-new-specific-user');
    if (!input) return;
    const val = (input.value || '').trim();
    if (!val) return;
    addCustomIdentifier(val);
}

export function removeSpecificUserTag(index) {
    if (index >= 0 && index < accessSettingsState.allowed_users.length) {
        accessSettingsState.allowed_users.splice(index, 1);
        renderSpecificUsersTags();
        const menu = document.getElementById('user-search-dropdown-menu');
        if (menu && !menu.classList.contains('hidden')) {
            const input = document.getElementById('input-new-specific-user');
            refreshUserSearchDropdown(input ? input.value : '');
        }
    }
}

function renderSpecificUsersTags() {
    const container = document.getElementById('specific-users-tags-container');
    if (!container) return;

    if (accessSettingsState.allowed_users.length === 0) {
        container.innerHTML = `<span class="text-[11px] text-slate-400 italic" id="empty-users-hint">Belum ada user khusus yang didaftarkan.</span>`;
        return;
    }

    container.innerHTML = accessSettingsState.allowed_users.map((user, idx) => `
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
            <i class="fa-solid fa-user-check text-[10px] text-blue-500"></i>
            <span>${escapeHTML(user)}</span>
            <button type="button" onclick="window.removeSpecificUserTag(${idx})" class="text-blue-400 hover:text-rose-500 transition-colors p-0.5">
                <i class="fa-solid fa-xmark text-[10px]"></i>
            </button>
        </span>
    `).join('');
}

export async function saveRankingSettings() {
    const btnSave = document.getElementById('btn-save-ranking-access');
    const prevBtnHtml = btnSave ? btnSave.innerHTML : '';
    if (btnSave) {
        btnSave.disabled = true;
        btnSave.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin mr-1"></i> Menyimpan...`;
    }

    try {
        // 1. Simpan Kriteria & Bobot Penilaian
        const vis = {
            attendance: document.getElementById('criteria-toggle-attendance')?.checked ?? true,
            spp: document.getElementById('criteria-toggle-spp')?.checked ?? true,
            discipline: document.getElementById('criteria-toggle-discipline')?.checked ?? true,
            library: document.getElementById('criteria-toggle-library')?.checked ?? true
        };

        const hasActiveCriteria = Object.values(vis).some(Boolean);
        if (!hasActiveCriteria) {
            if (typeof showToast === 'function') {
                showToast('Peringatan', 'Pilih minimal satu kriteria penilaian yang aktif.', 'warning');
            }
            if (btnSave) {
                btnSave.disabled = false;
                btnSave.innerHTML = prevBtnHtml;
            }
            return;
        }

        const weights = {
            attendance: Math.max(0, parseInt(document.getElementById('criteria-weight-attendance')?.value || 0, 10)),
            spp: Math.max(0, parseInt(document.getElementById('criteria-weight-spp')?.value || 0, 10)),
            discipline: Math.max(0, parseInt(document.getElementById('criteria-weight-discipline')?.value || 0, 10)),
            library: Math.max(0, parseInt(document.getElementById('criteria-weight-library')?.value || 0, 10))
        };

        const criteriaPayload = {
            visible: vis,
            weights: weights,
            updated_at: new Date().toISOString(),
            updated_by: localStorage.getItem('user_nama') || 'Super Admin'
        };

        if (cfClient && typeof cfClient.saveSystemSetting === 'function') {
            await cfClient.saveSystemSetting('ranking_criteria_config', criteriaPayload).catch(e => console.warn('[RankingKelas] D1 criteria error:', e));
        }
        localStorage.setItem('simas_ranking_criteria_config', JSON.stringify(criteriaPayload));
        rankingCriteriaState = criteriaPayload;

        // 2. Simpan Hak Akses Pengguna
        const selectedRadio = document.querySelector('input[name="ranking-access-mode"]:checked');
        const mode = selectedRadio ? selectedRadio.value : 'roles';

        const allowedRoles = ['super_admin'];
        document.querySelectorAll('.role-access-checkbox:checked').forEach(cb => {
            const r = cb.value;
            if (r && !allowedRoles.includes(r)) {
                allowedRoles.push(r);
            }
        });

        const toggleSchedule = document.getElementById('ranking-schedule-toggle');
        const inputMotivation = document.getElementById('ranking-schedule-motivation-input');
        const schedulePayload = {
            enabled: toggleSchedule ? toggleSchedule.checked : true,
            startDay: 5,
            startHour: 12,
            startMinute: 15,
            endDay: 1,
            endHour: 10,
            endMinute: 0,
            customMotivationMessage: inputMotivation ? inputMotivation.value.trim() : ''
        };

        const accessPayload = {
            mode,
            allowed_roles: allowedRoles,
            allowed_users: accessSettingsState.allowed_users,
            schedule: schedulePayload,
            updated_at: new Date().toISOString(),
            updated_by: localStorage.getItem('user_nama') || 'Super Admin'
        };

        if (cfClient && typeof cfClient.saveSystemSetting === 'function') {
            await cfClient.saveSystemSetting('ranking_access_config', accessPayload).catch(e => console.warn('[RankingKelas] D1 access error:', e));
        }

        localStorage.setItem('simas_ranking_access_config', JSON.stringify(accessPayload));
        accessSettingsState = accessPayload;

        // 3. Terapkan UI dan Hitung Ulang Peringkat
        applyRankingCriteriaUI();
        recomputeRankings();

        // Perbarui banner jadwal untuk Super Admin jika berada di luar jadwal
        const scheduleInfo = checkRankingScheduleWindow(new Date(), schedulePayload);
        const adminBanner = document.getElementById('super-admin-schedule-banner');
        if (adminBanner) {
            if (!scheduleInfo.isOpen) adminBanner.classList.remove('hidden');
            else adminBanner.classList.add('hidden');
        }

        if (typeof showToast === 'function') {
            showToast('Pengaturan Disimpan', 'Kriteria penilaian, bobot indeks, dan hak akses berhasil diperbarui.', 'success');
        }

        closeRankingAccessModal();

        const role = localStorage.getItem('user_role') || 'super_admin';
        if (typeof initLayout === 'function') {
            initLayout(role);
        }
    } catch (err) {
        console.error('[RankingKelas] Gagal menyimpan pengaturan:', err);
        if (typeof showToast === 'function') {
            showToast('Gagal Menyimpan', 'Terjadi kesalahan saat menyimpan pengaturan.', 'error');
        }
    } finally {
        if (btnSave) {
            btnSave.disabled = false;
            btnSave.innerHTML = prevBtnHtml;
        }
    }
}

export const saveRankingAccessConfig = saveRankingSettings;

// Global click outside listener to close dropdown
if (typeof document !== 'undefined') {
    document.addEventListener('click', (e) => {
        const wrapper = document.getElementById('user-search-dropdown-wrapper');
        const menu = document.getElementById('user-search-dropdown-menu');
        if (wrapper && menu && !wrapper.contains(e.target)) {
            menu.classList.add('hidden');
        }
    });
}

// =====================================
// EXPOSE KE GLOBAL WINDOW
// =====================================
window.sortRankingTable = sortRankingTable;
window.onRankingSortChange = onRankingSortChange;
window.updateRankingSortIcons = updateRankingSortIcons;
window.parseClassGradeAndNum = parseClassGradeAndNum;
window.compareClassesNatural = compareClassesNatural;
window.switchCategory = switchCategory;
window.setGradeFilter = setGradeFilter;
window.onPeriodScopeChange = onPeriodScopeChange;
window.onSearchClassInput = onSearchClassInput;
window.setViewMode = setViewMode;
window.openClassDetailModal = openClassDetailModal;
window.closeClassDetailModal = closeClassDetailModal;
window.refreshRankingData = refreshRankingData;
window.printRankingReport = printRankingReport;
window.renderDataStatusBanner = renderDataStatusBanner;
window.formatRangeIndo = formatRangeIndo;
window.updatePeriodDisplayUI = updatePeriodDisplayUI;
window.setRankingContentLoading = setRankingContentLoading;

// Modul Kriteria & Bobot Penilaian
window.switchRankingSettingsTab = switchRankingSettingsTab;
window.loadRankingCriteriaToForm = loadRankingCriteriaToForm;
window.updateCriteriaTotalWeightDisplay = updateCriteriaTotalWeightDisplay;
window.distributeRankingWeightsEvenly = distributeRankingWeightsEvenly;
window.resetRankingCriteriaToDefault = resetRankingCriteriaToDefault;
window.applyRankingCriteriaUI = applyRankingCriteriaUI;
window.loadRankingCriteriaConfig = loadRankingCriteriaConfig;
window.saveRankingSettings = saveRankingSettings;

// Modul Akses Super Admin
window.openRankingAccessModal = openRankingAccessModal;
window.closeRankingAccessModal = closeRankingAccessModal;
window.onAccessModeChange = onAccessModeChange;
window.renderRoleCheckboxes = renderRoleCheckboxes;
window.onRoleCheckboxToggle = onRoleCheckboxToggle;
window.selectAllRoles = selectAllRoles;
window.clearAllRoles = clearAllRoles;
window.addSpecificUserTag = addSpecificUserTag;
window.removeSpecificUserTag = removeSpecificUserTag;
window.saveRankingAccessConfig = saveRankingAccessConfig;

// Searchable Dropdown Pengguna Khusus
window.onUserSearchFocus = onUserSearchFocus;
window.onUserSearchInput = onUserSearchInput;
window.onUserSearchKeyDown = onUserSearchKeyDown;
window.clearUserSearchInput = clearUserSearchInput;
window.closeUserSearchDropdown = closeUserSearchDropdown;
window.selectUserFromDropdown = selectUserFromDropdown;
window.addCustomIdentifier = addCustomIdentifier;
window.filterEligibleUsers = filterEligibleUsers;
window.getCurrentlyCheckedRoles = getCurrentlyCheckedRoles;

// Kalkulasi Top 3 Juara Per Kategori & Badge Visual
window.computeCategoryRankings = computeCategoryRankings;
window.getCategoryRankBadge = getCategoryRankBadge;
window.formatPercentage = formatPercentage;
window.formatDecimal = formatDecimal;

// Manajemen Jadwal Akses Publik & Layar Motivasi
window.checkRankingScheduleWindow = checkRankingScheduleWindow;
window.renderRankingScheduleLockScreen = renderRankingScheduleLockScreen;
window.renderLockScreenCriteriaPillars = renderLockScreenCriteriaPillars;
window.previewLockedScreen = previewLockedScreen;
window.exitLockedScreenPreview = exitLockedScreenPreview;



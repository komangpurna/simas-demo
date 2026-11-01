/* js/page-dashboard.js - SSOT Compliant, Real Name & Smart Charts */
import { auth, db, PATHS, supabase } from './config.js';
import { initLayout } from './global.js';
import { cfClient } from './cloudflare-client.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { collection, getDocs, doc, getDoc, query, where, orderBy, limit, getCountFromServer, Timestamp, updateDoc, serverTimestamp, addDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

function initSupabase() {
    return !!supabase;
}

// Global Variabel untuk Grafik
let statsData = { violation: 0, achievement: 0, permission: 0 };
let violationTypeData = {};

// Two-Step Permission Variables
let twoStepPermissionEnabled = false;
let currentUserData = null;

// CACHE CONFIG (Untuk Hemat Kuota Read)
const CACHE_KEYS = {
    SYSTEM_CONFIG: 'simas_system_config_cache',
    USER_DATA: 'simas_user_data_cache'
};
const TTL_5_MINUTES = 5 * 60 * 1000; // 5 menit
const TTL_30_MINUTES = 30 * 60 * 1000; // 30 menit
const DASHBOARD_ACTIVE_STUDENTS_CACHE_KEY = 'simas_dashboard_active_students_count';
const DASHBOARD_ACTIVE_STUDENTS_TTL = 15 * 60 * 1000;
const SPP_PROGRESS_CACHE_KEY = 'simas_dashboard_kepsek_spp_cache';
const SPP_PROGRESS_TTL = 15 * 60 * 1000; // 15 menit

// Helper: Get start of academic year (July)
function getAcademicYearStart() {
    const currentAyText = window.getCurrentAcademicYearString();
    const startYear = parseInt(currentAyText.split('/')[0]);
    return new Date(startYear, 6, 1);
}

// Helper: Dapatkan rentang tanggal dan identitas semester berjalan (SSOT Presensi)
function getCurrentSemesterRange(refDate = new Date()) {
    const currentAyText = (typeof window.getCurrentAcademicYearString === 'function')
        ? window.getCurrentAcademicYearString(refDate)
        : `${refDate.getFullYear()}/${refDate.getFullYear() + 1}`;
    const [startYear, endYear] = currentAyText.split('/').map(Number);
    const semType = (typeof window.getCurrentSemester === 'function')
        ? window.getCurrentSemester(refDate)
        : (refDate.getMonth() >= 6 ? '1' : '2');

    let startDateStr, endDateStr, label;
    if (semType === '1') {
        startDateStr = `${startYear}-07-01`;
        endDateStr = `${startYear}-12-31`;
        label = 'Semester Ganjil';
    } else {
        startDateStr = `${endYear}-01-01`;
        endDateStr = `${endYear}-06-30`;
        label = 'Semester Genap';
    }
    return {
        semesterType: semType,
        semesterLabel: label,
        academicYear: currentAyText,
        startDate: startDateStr,
        endDate: endDateStr
    };
}

// Helper: Get permission count for a student this academic year (dengan cache)
const _permCountCache = new Map();
const PERM_COUNT_TTL = 10 * 60 * 1000;

async function getPermissionCountThisYear(studentNIS) {
    if (!studentNIS) return 0;
    const strNis = String(studentNIS).trim();
    const cached = _permCountCache.get(strNis);
    if (cached && (Date.now() - cached.ts < PERM_COUNT_TTL)) {
        return cached.count;
    }

    try {
        const agg = await cfClient.getStudentAggregateByNis(strNis);
        const count = agg?.permission_count || 0;
        _permCountCache.set(strNis, { count, ts: Date.now() });
        return count;
    } catch (e) {
        console.error("Error counting permission:", e);
        return 0;
    }
}

// --- HELPER: GET SYSTEM CONFIG WITH CACHE (delegasi ke global cache terpusat) ---
async function getSystemConfigWithCache() {
    return await window.getSystemConfig();
}

// --- HELPER: FETCH USER DATA WITH CACHE ---
async function fetchUserDataWithCache(uid, email) {
    // 1. Cek User Doc Cache terpusat (0 Read)
    if (typeof window.getCurrentUserDoc === 'function') {
        try {
            const cachedUser = await window.getCurrentUserDoc();
            if (cachedUser && (cachedUser.uid === uid || cachedUser.id === uid || cachedUser.email === email)) {
                return cachedUser;
            }
        } catch (e) {}
    }

    const cacheKey = `${CACHE_KEYS.USER_DATA}_${uid}`;

    // CEK CACHE DULU
    const cached = window.getLocalCache ? window.getLocalCache(cacheKey, TTL_30_MINUTES) : null;
    if (cached) {
        console.log('📦 [CACHE] User data loaded from cache');
        return cached;
    }

    // FETCH DARI FIRESTORE
    console.log('🔄 [NETWORK] Fetching user data...');
    const snap = await getDoc(doc(db, PATHS.users, uid));
    if (snap.exists()) {
        const userData = snap.data();
        // SIMPAN KE CACHE
        if (window.setLocalCache) window.setLocalCache(cacheKey, userData);
        console.log('💾 [CACHE] User data saved');
        return userData;
    }
    return { name: email ? email.split('@')[0] : 'User' };
}

onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash); return; }


    // 1. Role Recovery & Layout (DENGAN CACHE - Hemat Kuota)
    let role = localStorage.getItem('user_role');
    if (!role || role === 'undefined') {
        try {
            const userData = await fetchUserDataWithCache(user.uid, user.email);
            role = userData.role;

            if (!role) {
                console.warn('[Dashboard] Role tidak ditemukan, mengalihkan...');
                // Cek apakah ini siswa
                const sessionNIS = sessionStorage.getItem('student_nis');
                if (sessionNIS) {
                    window.location.replace('portal-siswa.html');
                } else {
                    window.location.replace('index.html');
                }
                return;
            }

            localStorage.setItem('user_role', role);

            // MULTI-ROLE: Simpan additionalRoles ke localStorage
            const additionalRoles = userData.additionalRoles || [];
            localStorage.setItem('user_additional_roles', JSON.stringify(additionalRoles));

            currentUserData = userData;
        } catch (e) { console.error("Role error:", e); role = 'guru_mapel'; }
    } else {
        // Jika role sudah ada, TETAP fetch data user untuk memastikan additionalRoles tersedia
        // FIX: Harus await agar additionalRoles sudah tersedia SEBELUM initLayout dipanggil
        try {
            const userData = await fetchUserDataWithCache(user.uid, user.email);
            currentUserData = userData;
            // MULTI-ROLE: SELALU update additionalRoles (fix: menu lambat muncul setelah refresh)
            const additionalRoles = userData.additionalRoles || [];
            localStorage.setItem('user_additional_roles', JSON.stringify(additionalRoles));
        } catch (e) {
            console.warn('[Dashboard] Failed to load user data:', e);
        }
    }
    // MULTI-ROLE: Ambil role tertinggi untuk halaman ini
    const effectiveRole = window.getEffectiveRoleForPage ?
        window.getEffectiveRoleForPage('dashboard.html') : role;
    initLayout(effectiveRole); // Gunakan role tertinggi

    // TAMPILKAN KERANGKA DASHBOARD SEGERA (0ms Layar Blank)
    const mainContent = document.querySelector('main');
    if (mainContent) {
        mainContent.classList.remove('hidden');
    }

    // Jika pengguna login adalah Super Admin, Kepala Sekolah atau Staff, bersihkan pop-up guru wali
    if (isExemptFromGuruWaliReminder(effectiveRole) || isExemptFromGuruWaliReminder(role)) {
        const existingWarn = document.getElementById('warning-guru-wali');
        if (existingWarn) existingWarn.remove();
    }

    // Kontrol visibility tombol quick input (+) berdasarkan role
    // Role yang BISA akses halaman input. Multi-role support dengan hasRole
    const rolesWithInputAccess = ['super_admin', 'kesiswaan', 'wali_kelas', 'guru_mapel', 'admin_pks', 'staff', 'guru_bk'];
    const btnQuickInput = document.getElementById('btn-quick-input');
    const canAccessInput = window.hasRole ?
        rolesWithInputAccess.some(r => window.hasRole(r)) :
        rolesWithInputAccess.includes(role);
    if (btnQuickInput && canAccessInput) {
        btnQuickInput.classList.remove('hidden');
    }

    // Kontrol visibility tombol Log Aktivitas (Hanya Super Admin)
    const btnLoginHistory = document.getElementById('btn-login-history');
    const isSuperAdminUser = role === 'super_admin' || effectiveRole === 'super_admin' || (window.hasRole && window.hasRole('super_admin'));
    if (btnLoginHistory && isSuperAdminUser) {
        btnLoginHistory.classList.remove('hidden');
    }

    // 2. Setup Header, Load Layout, & Cek Permisi (JALAN BERSAMAAN)
    // - Gunakan Promise.allSettled agar jika satu gagal, yang lain tetap jalan.
    const promises = [
        loadUserProfile(user),
        logLoginActivity(user, role),
        loadDashboardData()
    ];

    // 5. Cek Two-Step Permission untuk Wali Kelas DAN Super Admin
    const isWaliOrAdmin = role === 'wali_kelas' || role === 'super_admin' ||
        effectiveRole === 'wali_kelas' || effectiveRole === 'super_admin' ||
        (window.hasRole && (window.hasRole('wali_kelas') || window.hasRole('super_admin')));
    if (isWaliOrAdmin) {
        promises.push(checkAndShowWaliPermisiSection(user, role));
    }

    // 6. Cek Pop-up Pengingat Voting Duta SHAKTI (Prioritas #1 untuk Semua User Dashboard)
    promises.push(checkDutaVotingReminder(user, role));

    // Eksekusi semua secara paralel
    await Promise.allSettled(promises);
});

// Fungsi Khusus Load Nama Asli (OPTIMIZED - Pakai Cache)
async function loadUserProfile(user) {
    let displayName = user.email ? user.email.split('@')[0] : 'User'; // Default Fallback

    try {
        // PAKAI CACHE/EXISTING DATA (Hemat Kuota)
        if (currentUserData && currentUserData.name) {
            displayName = currentUserData.name;
        } else {
            // Fallback: fetch dengan cache
            const userData = await fetchUserDataWithCache(user.uid, user.email);
            if (userData.name) {
                displayName = userData.name;
                currentUserData = userData; // Simpan ke global
            }
        }
    } catch (e) {
        console.error("Gagal memuat profil user:", e);
    }

    // Update UI
    document.getElementById('user-name-display').innerText = displayName;
}

// --- FILTER PERIODE STATE ---
let currentFilterPeriode = 'month'; // Default: Bulanan (30 hari terakhir)

// Helper: Get start & end date based on filter
function getFilterDateRange(filter) {
    const now = new Date();
    let start, end;

    switch (filter) {
        case 'today':
            start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
            end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
            break;
        case 'week':
            // Mingguan: 7 hari terakhir inklusif (H-6 s.d. hari ini)
            start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0);
            end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
            break;
        case 'semester': {
            // Semester: Mengacu pada semester berjalan (awal semester s.d. hari ini)
            const semRange = typeof getCurrentSemesterRange === 'function' 
                ? getCurrentSemesterRange(now) 
                : { startDate: `${now.getFullYear()}-07-01` };
            const [sYear, sMonth, sDay] = semRange.startDate.split('-').map(Number);
            start = new Date(sYear, sMonth - 1, sDay, 0, 0, 0, 0);
            end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
            break;
        }
        case 'month':
        default:
            // Bulanan: 30 hari terakhir inklusif (H-29 s.d. hari ini)
            start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 0, 0, 0, 0);
            end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
            break;
    }
    return { start, end };
}

// Helper: Get filter label text
function getFilterLabel(filter) {
    switch (filter) {
        case 'today': return 'Hari Ini';
        case 'week': return 'Mingguan';
        case 'month': return 'Bulanan';
        case 'semester': return 'Semester';
        default: return 'Bulanan';
    }
}

window.getFilterDateRange = getFilterDateRange;
window.getFilterLabel = getFilterLabel;

// Update Highlight Animation
function updateFilterHighlight(filterElement) {
    const highlight = document.getElementById('filter-highlight');
    if (!highlight || !filterElement) return;

    // Get the container and element positions
    const container = filterElement.parentElement;
    const containerRect = container.getBoundingClientRect();
    const elementRect = filterElement.getBoundingClientRect();

    // Calculate relative position based on parent
    // Need to account for padding of the container (p-1.5 -> 6px)
    const padding = 6;
    const leftPos = elementRect.left - containerRect.left;
    const widthPercentage = (elementRect.width / containerRect.width) * 100;

    // Apply transform style
    highlight.style.width = `${elementRect.width}px`;
    highlight.style.transform = `translateX(${leftPos - padding}px)`;
}

// Initial set highlight on load
document.addEventListener('DOMContentLoaded', () => {
    // Jalankan segera
    const activeBtn = document.querySelector('.filter-btn.active-filter');
    if (activeBtn) updateFilterHighlight(activeBtn);

    // Jalankan ulang dengan sedikit delay antisipasi font/layout render telat
    setTimeout(() => {
        if (activeBtn) updateFilterHighlight(activeBtn);
    }, 150);
});

// Set Filter Periode (dipanggil dari tombol UI)
window.setFilterPeriode = async (filter) => {
    currentFilterPeriode = filter;

    let targetBtn = null;
    // Update UI Buttons
    document.querySelectorAll('#filter-periode-container .filter-btn').forEach(btn => {
        if (btn.dataset.filter === filter) {
            btn.classList.add('active-filter', 'text-slate-800', 'dark:text-white');
            btn.classList.remove('text-slate-500', 'dark:text-slate-400', 'hover:text-slate-700', 'dark:hover:text-slate-200');
            targetBtn = btn;
        } else {
            btn.classList.remove('active-filter', 'text-slate-800', 'dark:text-white');
            btn.classList.add('text-slate-500', 'dark:text-slate-400', 'hover:text-slate-700', 'dark:hover:text-slate-200');
        }
    });

    if (targetBtn) {
        updateFilterHighlight(targetBtn);
    }

    // Update catatan periode pada diagram pelanggaran
    const noteEl = document.getElementById('violation-chart-period-note');
    if (noteEl) {
        let noteText = '*Data berdasarkan catatan 30 hari terakhir';
        if (filter === 'today') noteText = '*Data berdasarkan catatan hari ini';
        else if (filter === 'week') noteText = '*Data berdasarkan catatan 7 hari terakhir';
        else if (filter === 'semester') noteText = '*Data berdasarkan catatan semester berjalan';
        noteEl.textContent = noteText;
    }

    // Labels tetap tanpa periode filter
    document.getElementById('label-permissions').innerText = 'Permisi';
    document.getElementById('label-violations').innerText = 'Pelanggaran';
    document.getElementById('label-achievements').innerText = 'Prestasi';

    // Update subtext mikro tren / konteks periode
    const filterSubtextMap = {
        today: 'Hari Ini',
        week: 'Mingguan',
        month: 'Bulanan',
        semester: 'Semester Ini'
    };
    const activeSubtext = filterSubtextMap[filter] || 'Bulanan';
    const subPerm = document.getElementById('subtext-permissions');
    if (subPerm) subPerm.innerHTML = `<i class="fa-regular fa-clock text-[9px] text-blue-500"></i> ${activeSubtext}`;
    const subVio = document.getElementById('subtext-violations');
    if (subVio) subVio.innerHTML = `<i class="fa-solid fa-shield-halved text-[9px] text-rose-500"></i> ${activeSubtext}`;
    const subAch = document.getElementById('subtext-achievements');
    if (subAch) subAch.innerHTML = `<i class="fa-solid fa-star text-[9px] text-emerald-500"></i> ${activeSubtext}`;

    // Reload stats with new filter
    await loadDashboardStats();
};

// Navigasi ke Data Riwayat di input.html dengan kategori & rentang tanggal aktif dashboard
window.navigateToHistory = function (category) {
    const { start, end } = getFilterDateRange(currentFilterPeriode);
    const startDateStr = window.getLocalISODate ? window.getLocalISODate(start) : start.toISOString().substring(0, 10);
    const endDateStr = window.getLocalISODate ? window.getLocalISODate(end) : end.toISOString().substring(0, 10);

    const params = new URLSearchParams({
        tab: 'history',
        category: category || '',
        start: startDateStr,
        end: endDateStr
    });

    window.location.href = `input.html?${params.toString()}`;
};

// Load Stats Only (dipisah supaya bisa dipanggil ulang saat filter berubah)
async function loadDashboardStats() {
    try {
        const { start, end } = getFilterDateRange(currentFilterPeriode);
        const startDateStr = window.getLocalISODate ? window.getLocalISODate(start) : start.toISOString().substring(0, 10);
        const endDateStr = window.getLocalISODate ? window.getLocalISODate(end) : end.toISOString().substring(0, 10);

        // Show loading skeleton
        const elAch = document.getElementById('count-achievements');
        const elPerm = document.getElementById('count-permissions');
        const elVio = document.getElementById('count-violations');
        if (elAch && !elAch.querySelector('span')) elAch.innerHTML = '<span class="inline-block w-8 h-7 bg-emerald-100 dark:bg-emerald-900/40 animate-pulse rounded-md"></span>';
        if (elPerm && !elPerm.querySelector('span')) elPerm.innerHTML = '<span class="inline-block w-8 h-7 bg-blue-100 dark:bg-blue-900/40 animate-pulse rounded-md"></span>';
        if (elVio && !elVio.querySelector('span')) elVio.innerHTML = '<span class="inline-block w-8 h-7 bg-red-100 dark:bg-red-900/40 animate-pulse rounded-md"></span>';

        // Fetch stats dari Cloudflare D1 (0 Firestore Read)
        const stats = await cfClient.getRecordStats({
            date_start: startDateStr,
            date_end: endDateStr
        });

        statsData.achievement = stats?.achievement || 0;
        statsData.permission = stats?.permission || 0;
        statsData.violation = stats?.violation || 0;

        // Update Kartu Statistik
        if (elAch) elAch.innerText = statsData.achievement;
        if (elPerm) elPerm.innerText = statsData.permission;
        if (elVio) elVio.innerText = statsData.violation;

        // Render grafik komposisi segera (tanpa menunggu kueri detail pelanggaran)
        if (typeof Chart !== 'undefined') renderCharts();

        // FETCH CHART PELANGGARAN TANPA AWAIT MEMBLOK (Biarkan di-load di background)
        // Agar angka statistik atas muncul instant
        fetchViolationTypesForChart(startDateStr, endDateStr);

    } catch (e) {
        console.error("Gagal load stats:", e);
        const elAch = document.getElementById('count-achievements');
        const elPerm = document.getElementById('count-permissions');
        const elVio = document.getElementById('count-violations');
        if (elAch) elAch.innerText = statsData.achievement || '-';
        if (elPerm) elPerm.innerText = statsData.permission || '-';
        if (elVio) elVio.innerText = statsData.violation || '-';
    }
}

// Terpisah untuk loading grafik pelanggaran agar tidak mengemblok count utama
async function fetchViolationTypesForChart(startDateStr, endDateStr) {
    try {
        const snapVioTypes = await cfClient.getRecords({
            category: 'Pelanggaran',
            date_start: startDateStr,
            date_end: endDateStr,
            limit: 100
        });

        violationTypeData = {};
        (snapVioTypes || []).forEach(r => {
            let label = r.type || r.desc || r.category || "Lainnya";
            if (label.length > 20) label = label.substring(0, 20) + "...";
            violationTypeData[label] = (violationTypeData[label] || 0) + 1;
        });

        // Re-render charts
        if (typeof Chart !== 'undefined') renderCharts();
    } catch (error) {
        console.error("Gagal memuat tipe pelanggaran untuk diagram: ", error);
    }
}

let superAdminDashboardView = localStorage.getItem('simas_superadmin_dashboard_view') || 'standard';

window.toggleDashboardMode = async function () {
    superAdminDashboardView = superAdminDashboardView === 'executive' ? 'standard' : 'executive';
    localStorage.setItem('simas_superadmin_dashboard_view', superAdminDashboardView);
    await loadDashboardData();
};

async function loadDashboardData() {
    try {
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        const currentDateEl = document.getElementById('current-date');
        if (currentDateEl) {
            currentDateEl.innerText = new Date().toLocaleDateString('id-ID', options);
        }

        const role = localStorage.getItem('user_role');
        const isSuperAdmin = role === 'super_admin' || (window.hasRole && window.hasRole('super_admin'));
        const isKepalaSekolah = (role === 'kepala_sekolah') || 
                                (window.hasRole && window.hasRole('kepala_sekolah'));

        const standardContent = document.getElementById('standard-dashboard-content');
        const kepsekContent = document.getElementById('kepala-sekolah-dashboard-content');
        const btnToggleMode = document.getElementById('btn-toggle-dashboard-mode');
        const labelToggleMode = document.getElementById('label-toggle-dashboard-mode');

        // Tampilkan tombol toggle khusus Super Admin
        if (btnToggleMode) {
            if (isSuperAdmin && !isKepalaSekolah) {
                btnToggleMode.classList.remove('hidden');
                if (labelToggleMode) {
                    labelToggleMode.innerText = superAdminDashboardView === 'executive' ? 'Mode Standar' : 'Mode Eksekutif';
                }
            } else {
                btnToggleMode.classList.add('hidden');
            }
        }

        const showExecutive = isKepalaSekolah || (isSuperAdmin && superAdminDashboardView === 'executive');

        if (showExecutive) {
            if (standardContent) standardContent.classList.add('hidden');
            if (kepsekContent) kepsekContent.classList.remove('hidden');
            await loadKepalaSekolahDashboard();
        } else {
            if (standardContent) standardContent.classList.remove('hidden');
            if (kepsekContent) kepsekContent.classList.add('hidden');
            await loadStandardDashboardData();
        }

    } catch (e) {
        console.error("Gagal load dashboard data:", e);
    } finally {
        // SAFETY GUARD: Jamin konten utama tidak pernah tertinggal dalam kondisi hidden
        const mainContent = document.querySelector('main');
        if (mainContent && mainContent.classList.contains('hidden')) {
            mainContent.classList.remove('hidden');
        }
    }
}

async function loadStandardDashboardData() {
    try {
        // Load Total Siswa, Stats, & Recent Activity SECARA BERSAMAAN (Paralel)
        await Promise.allSettled([
            (async () => {
                try {
                    const finalCount = await getDashboardActiveStudentCount();
                    const elCount = document.getElementById('count-students');
                    if (elCount) elCount.innerText = finalCount;
                } catch (err) {
                    console.error("Gagal load student count:", err);
                    const elCount = document.getElementById('count-students');
                    if (elCount) elCount.innerText = '-';
                }
            })(),
            loadDashboardStats(),
            loadRecentActivity()
        ]);

    } catch (e) {
        console.error("Gagal load standard dashboard data:", e);
    }
}

async function getDashboardActiveStudentCount() {
    const cachedCount = typeof window.getLocalCache === 'function'
        ? window.getLocalCache(DASHBOARD_ACTIVE_STUDENTS_CACHE_KEY, DASHBOARD_ACTIVE_STUDENTS_TTL)
        : null;
    if (cachedCount !== null && cachedCount !== undefined && Number.isFinite(Number(cachedCount)) && Number(cachedCount) > 0) {
        return Number(cachedCount);
    }

    // Ambil Master Siswa dari Cloudflare D1 Cache (0 Firestore Read)
    const allStudents = typeof window.getStudentsCache === 'function'
        ? await window.getStudentsCache()
        : [];
    const count = allStudents.filter(student => {
        if (typeof window.isStudentActive === 'function') {
            return window.isStudentActive(student);
        }
        if (!student.class) return false;
        const lower = String(student.class).toLowerCase();
        const isInactiveStatus = student.status && ['alumni', 'mutasi', 'pindah', 'keluar', 'nonaktif', 'non_aktif', 'lulus'].includes(String(student.status).toLowerCase());
        const isInactiveClass = ['alumni', 'mutasi', 'pindah', 'keluar', 'nonaktif', 'non_aktif', 'lulus'].some(label => lower.includes(label));
        return !isInactiveStatus && !isInactiveClass;
    }).length;

    if (typeof window.setLocalCache === 'function' && count > 0) {
        window.setLocalCache(DASHBOARD_ACTIVE_STUDENTS_CACHE_KEY, count);
    }
    return count;
}

async function loadRecentActivity() {
    const tbody = document.getElementById('recent-activity-body');
    try {
        // Ambil 5 aktivitas terakhir dari Cloudflare D1 (0 Firestore Read)
        const docs = await cfClient.getRecords({ limit: 5, order: 'DESC' });

        if (!docs || docs.length === 0) {
            tbody.innerHTML = `
            <tr>
                <td colspan="5" class="py-12 px-4 text-center">
                    <div class="flex flex-col items-center justify-center max-w-xs mx-auto">
                        <div class="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800/80 flex items-center justify-center text-slate-400 dark:text-slate-500 text-xl mb-3 border border-slate-200/60 dark:border-slate-700/60 shadow-sm">
                            <i class="fa-regular fa-clipboard"></i>
                        </div>
                        <h4 class="text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-200">Belum Ada Aktivitas Tercatat</h4>
                        <p class="text-[11px] text-slate-400 dark:text-slate-500 mt-1">Catatan permisi, pelanggaran, dan prestasi siswa terbaru akan tampil di sini secara otomatis.</p>
                    </div>
                </td>
            </tr>`;
            return;
        }

        let html = '';
        docs.forEach(r => {
            const timeObj = r.timestamp?.toDate ? r.timestamp.toDate() : (r.timestampIso ? new Date(r.timestampIso) : (r.createdAt?.toDate ? r.createdAt.toDate() : new Date()));
            const timeStr = timeObj.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
            const dateStr = timeObj.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });

            // Styling Badge Kategori (REVISI: Sesuaikan dengan page-input.js)
            let badgeInfo = { bg: 'bg-gray-100 dark:bg-gray-800', txt: 'text-gray-600 dark:text-gray-300', label: r.category || 'N/A' };

            if (r.category === 'Pelanggaran') badgeInfo = { bg: 'bg-red-50 dark:bg-red-900/30', txt: 'text-red-600 dark:text-red-400', label: 'Pelanggaran' };
            else if (r.category === 'Permisi') badgeInfo = { bg: 'bg-blue-50 dark:bg-blue-900/30', txt: 'text-blue-600 dark:text-blue-400', label: 'Izin/Permisi' };
            else if (r.category === 'Prestasi') badgeInfo = { bg: 'bg-green-50 dark:bg-green-900/30', txt: 'text-green-600 dark:text-green-400', label: 'Prestasi' };

            // Handling Poin (+/-)
            const pointsDisplay = r.points > 0 ? `+${r.points}` : (r.points < 0 ? r.points : '-');

            // REVISI (User Request): Violation points = RED (karena bad behavior), Achievement = GREEN
            let pointColor = r.points > 0 ? 'text-green-600 dark:text-green-400' : (r.points < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-400 dark:text-slate-500');

            if (r.category === 'Pelanggaran') {
                pointColor = 'text-red-600 dark:text-red-400 font-bold'; // Pelanggaran selalu merah
            } else if (r.category === 'Prestasi') {
                pointColor = 'text-green-600 dark:text-green-400 font-bold'; // Prestasi selalu hijau
            }
            const nisDisplay = r.studentNIS ? `<span class="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded font-mono ml-1 border border-slate-200 dark:border-slate-700">${r.studentNIS}</span>` : '';

            html += `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition border-b border-slate-100 dark:border-slate-800/50 last:border-0 text-xs group">
                <td class="px-4 py-2 whitespace-nowrap">
                    <div class="font-bold text-slate-600 dark:text-slate-300">${dateStr}</div>
                    <div class="text-[10px] text-slate-400 dark:text-slate-500">${timeStr}</div>
                </td>
                <td class="px-4 py-2">
                    <a href="siswa.html?nis=${window.escapeHTML(r.studentNIS)}" class="font-bold text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline cursor-pointer block">${window.escapeHTML(r.studentName)}</a>
                    <div class="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 inline-block">${window.escapeHTML(r.studentClass)} ${nisDisplay}</div>
                </td>
                <td class="px-4 py-2">
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border border-transparent ${badgeInfo.bg} ${badgeInfo.txt}">
                        ${r.category || badgeInfo.label}
                    </span>
                </td>
                <td class="px-4 py-2">
                    <div class="text-slate-600 dark:text-slate-300 line-clamp-1 max-w-[200px]" title="${window.escapeHTML(r.desc)}">${window.escapeHTML(r.desc)}</div>
                </td>
                <td class="px-4 py-2 text-right">
                    <span class="font-bold font-mono ${pointColor}">${pointsDisplay}</span>
                </td>
            </tr>`;
        });

        tbody.innerHTML = html;

    } catch (e) {
        console.error("Activity Error:", e);
        tbody.innerHTML = `
        <tr>
            <td colspan="5" class="py-10 px-4 text-center">
                <div class="flex flex-col items-center justify-center max-w-xs mx-auto text-rose-500">
                    <div class="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950/40 flex items-center justify-center text-base mb-2 border border-rose-200/60 dark:border-rose-900/60">
                        <i class="fa-solid fa-triangle-exclamation"></i>
                    </div>
                    <p class="text-xs font-semibold">Gagal memuat data aktivitas.</p>
                </div>
            </td>
        </tr>`;
    }
}

function renderCharts() {
    // 1. Chart Komposisi (Doughnut)
    const ctxComp = document.getElementById('compositionChart').getContext('2d');
    const totalData = statsData.violation + statsData.achievement + statsData.permission;

    // Destroy chart lama jika ada (untuk mencegah overlap saat refresh)
    if (window.myCompChart) window.myCompChart.destroy();

    const isDark = document.documentElement.classList.contains('dark');
    const emptyColor = isDark ? '#334155' : '#f1f5f9';

    // Tooltip Bento Style terpadu
    const bentoTooltipConfig = {
        backgroundColor: isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.98)',
        titleColor: isDark ? '#ffffff' : '#0f172a',
        bodyColor: isDark ? '#cbd5e1' : '#334155',
        borderColor: isDark ? 'rgba(51, 65, 85, 0.8)' : 'rgba(226, 232, 240, 0.9)',
        borderWidth: 1,
        padding: 10,
        cornerRadius: 12,
        displayColors: true,
        usePointStyle: true,
        boxPadding: 4,
        bodyFont: { size: 11, weight: 'bold' },
        titleFont: { size: 12, weight: 'bold' }
    };

    window.myCompChart = new Chart(ctxComp, {
        type: 'doughnut',
        data: {
            labels: totalData === 0 ? ['Belum ada data'] : ['Pelanggaran', 'Prestasi', 'Permisi'],
            datasets: [{
                data: totalData === 0 ? [1] : [statsData.violation, statsData.achievement, statsData.permission],
                backgroundColor: totalData === 0 ? [emptyColor] : ['#ef4444', '#22c55e', '#3b82f6'],
                borderWidth: 0,
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '72%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        usePointStyle: true,
                        boxWidth: 8,
                        color: isDark ? '#cbd5e1' : '#475569',
                        font: { size: 11, weight: 'bold' }
                    }
                },
                tooltip: bentoTooltipConfig
            }
        }
    });

    // 2. Chart Jenis Pelanggaran (Pie)
    const ctxVioType = document.getElementById('violationTypeChart').getContext('2d');

    let labelsVio = Object.keys(violationTypeData);
    let dataVio = Object.values(violationTypeData);

    // Warna chart
    const chartColors = ['#f97316', '#eab308', '#06b6d4', '#8b5cf6', '#ec4899', '#6366f1', '#14b8a6'];

    if (labelsVio.length === 0) {
        labelsVio = ['Belum ada pelanggaran'];
        dataVio = [1];
    }

    if (window.myVioChart) window.myVioChart.destroy();

    window.myVioChart = new Chart(ctxVioType, {
        type: 'pie',
        data: {
            labels: labelsVio,
            datasets: [{
                data: dataVio,
                backgroundColor: labelsVio[0] === 'Belum ada pelanggaran' ? [emptyColor] : chartColors,
                borderWidth: 2,
                borderColor: isDark ? '#1e293b' : '#ffffff',
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        usePointStyle: true,
                        boxWidth: 8,
                        color: isDark ? '#cbd5e1' : '#475569',
                        font: { size: 10, weight: 'bold' }
                    }
                },
                tooltip: bentoTooltipConfig
            }
        }
    });
}

// =====================================
// TWO-STEP PERMISSION FUNCTIONS (WALI KELAS & SUPER ADMIN)
// =====================================

// Cek apakah fitur aktif dan tampilkan section
async function checkAndShowWaliPermisiSection(user, role) {
    try {
        // Cek config (PAKAI CACHE)
        const configData = await getSystemConfigWithCache();
        twoStepPermissionEnabled = configData.twoStepPermission || false;

        if (!twoStepPermissionEnabled) {
            // Fitur tidak aktif, sembunyikan section
            const section = document.getElementById('wali-permisi-section');
            if (section) section.classList.add('hidden');
            return;
        }

        // PAKAI EXISTING currentUserData jika sudah ada (Hemat Kuota)
        if (!currentUserData || !currentUserData.assignedClass) {
            // Hanya fetch jika belum ada data
            const userData = await fetchUserDataWithCache(user.uid, user.email);
            currentUserData = userData;
        }

        // Simpan role di currentUserData untuk dipakai di loadPendingPermissionRequests
        if (currentUserData) {
            currentUserData.currentRole = role;
        } else {
            currentUserData = { currentRole: role };
        }

        // Tampilkan section
        const section = document.getElementById('wali-permisi-section');
        if (section) section.classList.remove('hidden');

        // Load pengajuan
        await loadPendingPermissionRequests();

    } catch (e) {
        console.error("Error checking two-step permission:", e);
    }
}

// Load pengajuan permisi pending
window.loadPendingPermissionRequests = async function () {
    if (!twoStepPermissionEnabled) return;

    const isSuperAdmin = currentUserData?.currentRole === 'super_admin';

    // Super Admin tidak perlu assignedClass
    if (!isSuperAdmin && (!currentUserData || !currentUserData.assignedClass)) {
        console.log("No assigned class for wali kelas");
        return;
    }

    const container = document.getElementById('wali-permisi-list');
    const badge = document.getElementById('badge-pending-count');

    container.innerHTML = `<div class="text-center text-slate-400 py-6 text-sm">
        <i class="fa-solid fa-spinner fa-spin mr-2"></i> Memuat pengajuan...
    </div>`;

    try {
        const today = window.getLocalISODate(new Date());

        let requests = [];
        if (cfClient && cfClient.enabled) {
            const params = {
                date: today,
                status: 'pending_wali'
            };
            if (!isSuperAdmin) {
                params.class = currentUserData.assignedClass;
            }
            const rawRequests = await cfClient.getPermisiRequests(params);
            if (Array.isArray(rawRequests)) {
                requests = rawRequests.map(r => ({
                    id: r.id,
                    data: {
                        studentNIS: r.student_nis,
                        studentName: r.student_name,
                        studentClass: r.student_class,
                        reason: r.reason,
                        requestTime: r.time_out,
                        status: r.status
                    }
                }));
            }
        }

        // Update badge
        if (requests.length === 0) {
            badge.classList.add('hidden');
            container.innerHTML = `
                <div class="text-center py-8">
                    <div class="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-3">
                        <i class="fa-solid fa-check text-green-400 text-2xl"></i>
                    </div>
                    <p class="text-slate-500 text-sm font-medium">Tidak ada pengajuan menunggu</p>
                    <p class="text-slate-400 text-xs mt-1">Semua pengajuan sudah ditangani</p>
                </div>
            `;
            return;
        }

        badge.innerText = requests.length;
        badge.classList.remove('hidden');

        // Fetch permission counts for all students
        const permissionCounts = await Promise.all(
            requests.map(req => getPermissionCountThisYear(req.data.studentNIS))
        );

        let html = '<div class="grid grid-cols-1 md:grid-cols-2 gap-2">';

        requests.forEach((req, index) => {
            const d = req.data;
            const permCount = permissionCounts[index] || 0;

            // Determine if we should show warning (>10 permisi)
            const isHighCount = permCount > 10;
            const countBadgeClass = isHighCount
                ? 'bg-red-100 text-red-600'
                : 'bg-blue-100 text-blue-600';

            html += `
                <div class="p-3 rounded-lg border border-yellow-200 bg-yellow-50/50 hover:bg-yellow-50 transition">
                    <div class="flex items-center justify-between gap-2 mb-2">
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2">
                                <span class="font-bold text-slate-800 text-sm truncate">${window.escapeHTML(d.studentName)}</span>
                                <span class="text-[10px] ${countBadgeClass} px-1.5 py-0.5 rounded font-bold whitespace-nowrap">
                                    Permisi ke-${permCount + 1}
                                </span>
                            </div>
                            <p class="text-[10px] text-slate-500">${window.escapeHTML(d.studentNIS)} • ${window.escapeHTML(d.studentClass)} • Jam ${window.escapeHTML(d.requestTime)}</p>
                        </div>
                        <div class="flex gap-1 shrink-0">
                            <button onclick="approvePermissionRequest('${req.id}')"
                                class="w-7 h-7 bg-green-600 text-white text-xs rounded hover:bg-green-700 transition" title="Setujui">
                                <i class="fa-solid fa-check"></i>
                            </button>
                            <button onclick="openRejectModal('${window.escapeHTML(req.id)}', '${window.escapeHTML(d.studentName)}', '${window.escapeHTML(d.reason.replace(/'/g, "\\'"))}')"
                                class="w-7 h-7 bg-white text-red-600 text-xs rounded border border-red-200 hover:bg-red-50 transition" title="Tolak">
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                    </div>
                    <p class="text-xs text-slate-600 line-clamp-1" title="${window.escapeHTML(d.reason)}">${window.escapeHTML(d.reason)}</p>
                </div>
            `;
        });

        html += '</div>';
        container.innerHTML = html;

    } catch (e) {
        console.error("Load Pending Requests Error:", e);
        container.innerHTML = `
            <div class="text-center text-red-500 py-6 text-sm">
                <i class="fa-solid fa-triangle-exclamation mr-2"></i> Gagal memuat data: ${e.message}
            </div>
        `;
    }
};

// Setujui pengajuan permisi
window.approvePermissionRequest = async function (docId) {
    try {
        if (cfClient && cfClient.enabled) {
            await cfClient.processWaliPermisi(docId, 'approve', currentUserData?.name || 'Wali Kelas');
        }

        await loadPendingPermissionRequests();
        showToast("Berhasil", "Pengajuan disetujui! Siswa bisa ke guru piket.", "success");

    } catch (e) {
        console.error("Approve Error:", e);
        showToast("Gagal", "Gagal menyetujui: " + e.message, "error");
    }
};

// Buka modal tolak
window.openRejectModal = function (docId, studentName, reason) {
    document.getElementById('reject-doc-id').value = docId;
    document.getElementById('reject-student-name').innerText = studentName;
    document.getElementById('reject-reason-preview').innerText = reason;
    document.getElementById('input-reject-reason').value = '';
    document.getElementById('modal-reject-permisi').classList.remove('hidden');
};

// Tutup modal tolak
window.closeRejectModal = function () {
    document.getElementById('modal-reject-permisi').classList.add('hidden');
};

// Eksekusi tolak pengajuan
window.executeRejectPermission = async function () {
    const docId = document.getElementById('reject-doc-id').value;
    const rejectReason = document.getElementById('input-reject-reason').value.trim();

    if (!rejectReason) {
        showToast("Peringatan", "Harap isi alasan penolakan.", "warning");
        document.getElementById('input-reject-reason').focus();
        return;
    }

    try {
        if (cfClient && cfClient.enabled) {
            await cfClient.processWaliPermisi(docId, 'reject', currentUserData?.name || 'Wali Kelas', rejectReason);
        }

        closeRejectModal();
        await loadPendingPermissionRequests();
        showToast("Ditolak", "Pengajuan ditolak. Siswa akan melihat alasan penolakan.", "info");

    } catch (e) {
        console.error("Reject Error:", e);
        showToast("Gagal", "Gagal menolak: " + e.message, "error");
    }
};

// =====================================
// LOG AKTIVITAS LOGIN (SUPER ADMIN ONLY)
// =====================================

// Helper: Deteksi device/browser dari userAgent
function getDeviceInfo() {
    const ua = navigator.userAgent;
    let device = 'Unknown';

    if (/Android/i.test(ua)) device = 'Android';
    else if (/iPhone|iPad|iPod/i.test(ua)) device = 'iOS';
    else if (/Windows/i.test(ua)) device = 'Windows';
    else if (/Mac/i.test(ua)) device = 'Mac';
    else if (/Linux/i.test(ua)) device = 'Linux';

    // Detect browser
    let browser = 'Unknown';
    if (/Chrome/i.test(ua) && !/Edge/i.test(ua)) browser = 'Chrome';
    else if (/Firefox/i.test(ua)) browser = 'Firefox';
    else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';
    else if (/Edge/i.test(ua)) browser = 'Edge';

    return `${browser} / ${device}`;
}

// Log aktivitas login ke Cloudflare D1 (Hemat 100% Kuota Write Firestore)
async function logLoginActivity(user, role) {
    try {
        // Cek apakah sudah login dalam 1 jam terakhir (hemat bandwidth & rate limit)
        const lastLoginKey = `last_login_${user.uid}`;
        const lastLogin = localStorage.getItem(lastLoginKey);
        const now = Date.now();

        // Jika sudah login dalam 1 jam terakhir, skip logging
        if (lastLogin && (now - parseInt(lastLogin)) < 60 * 60 * 1000) {
            console.log('📝 Login already logged within last hour, skipping...');
            return;
        }

        // Ambil nama dari currentUserData, atau fetch dengan cache jika belum ada
        let userName = 'Unknown';
        if (currentUserData && currentUserData.name) {
            userName = currentUserData.name;
        } else {
            try {
                const userData = await fetchUserDataWithCache(user.uid, user.email);
                if (userData && userData.name) {
                    userName = userData.name;
                    currentUserData = userData;
                }
            } catch (fetchErr) {
                console.warn('Failed to fetch user name:', fetchErr);
            }
        }

        // Simpan log ke Cloudflare D1 Serverless SQL
        await cfClient.logLogin({
            uid: user.uid,
            email: user.email || '',
            name: userName,
            role: role || 'unknown',
            login_at: new Date().toISOString(),
            user_agent: getDeviceInfo()
        });

        // Simpan timestamp ke localStorage
        localStorage.setItem(lastLoginKey, now.toString());
        console.log('✅ [Cloudflare D1] Login activity logged');

    } catch (e) {
        console.error('Error logging login activity to Cloudflare:', e);
        // Non-blocking, abaikan jika background log gagal
    }
}

// Buka modal log aktivitas
window.openLoginHistoryModal = async function () {
    const modal = document.getElementById('modal-login-history');
    if (!modal) return;
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden'; // Kunci scroll body

    // Daftarkan listener tombol Escape untuk aksesibilitas & UX ergonomis
    if (!modal._escapeHandler) {
        modal._escapeHandler = (e) => {
            if (e.key === 'Escape') {
                window.closeLoginHistoryModal();
            }
        };
        document.addEventListener('keydown', modal._escapeHandler);
    }

    // Set default date range to last 3 days
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 3);

    const startInput = document.getElementById('filter-login-start');
    const endInput = document.getElementById('filter-login-end');

    const fmtStart = window.getLocalISODate ? window.getLocalISODate(start) : start.toISOString().split('T')[0];
    const fmtEnd = window.getLocalISODate ? window.getLocalISODate(end) : end.toISOString().split('T')[0];

    if (startInput) startInput.value = fmtStart;
    if (endInput) endInput.value = fmtEnd;

    await window.loadLoginHistoryRange();
};

// Tutup modal log aktivitas
window.closeLoginHistoryModal = function () {
    const modal = document.getElementById('modal-login-history');
    if (!modal) return;
    modal.classList.add('hidden');
    document.body.style.overflow = ''; // Kembalikan scroll body

    // Bersihkan listener tombol Escape
    if (modal._escapeHandler) {
        document.removeEventListener('keydown', modal._escapeHandler);
        modal._escapeHandler = null;
    }
};

// Load login history dari Cloudflare D1 berdasarkan rentang tanggal
let loginHistoryData = []; // Cache data di memory

window.loadLoginHistoryRange = async function () {
    const tbody = document.getElementById('login-history-body');
    const startInput = document.getElementById('filter-login-start');
    const endInput = document.getElementById('filter-login-end');
    const selectEl = document.getElementById('filter-login-role');

    if (!startInput || !endInput) return;

    let startStr = startInput.value;
    let endStr = endInput.value;

    if (!startStr || !endStr) return;

    tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-400 dark:text-slate-500"><i class="fa-solid fa-circle-notch fa-spin mr-2"></i> Memuat data dari Cloudflare D1...</td></tr>';

    try {
        const data = await cfClient.getLoginHistory({
            start: startStr,
            end: endStr,
            limit: 500
        });

        loginHistoryData = data || [];

        if (loginHistoryData.length === 0) {
            if (selectEl) {
                selectEl.innerHTML = '<option value="">Semua Role</option>';
            }
            window.filterLoginHistory();
            return;
        }

        // 7 Role Utama Baku Sesuai Manajemen Pengguna (users.html)
        const PRIMARY_ROLES = [
            { id: 'super_admin', label: 'Super Admin' },
            { id: 'admin_perpus', label: 'Admin Perpustakaan' },
            { id: 'kepala_sekolah', label: 'Kepala Sekolah' },
            { id: 'staff', label: 'Staff / Tata Usaha' },
            { id: 'guru_mapel', label: 'Guru Mapel' },
            { id: 'admin_pks', label: 'Admin PKS (Siswa)' },
            { id: 'admin_kelas', label: 'Admin Kelas (Siswa)' }
        ];

        let currentSelectedRole = selectEl ? selectEl.value : '';

        let optionsHtml = '<option value="">Semua Role (Kecuali Super Admin)</option>';
        PRIMARY_ROLES.forEach(r => {
            const selected = r.id === currentSelectedRole ? 'selected' : '';
            optionsHtml += `<option value="${r.id}" ${selected}>${r.label}</option>`;
        });

        if (selectEl) selectEl.innerHTML = optionsHtml;

        window.filterLoginHistory();

    } catch (e) {
        console.error('Error loading login history from Cloudflare:', e);
        tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-red-400 dark:text-red-500">Gagal memuat data: ' + window.escapeHTML(e.message) + '</td></tr>';
    }
};

// Filter login history di browser (tanpa query ulang)
window.filterLoginHistory = function () {
    const tbody = document.getElementById('login-history-body');
    const filterRole = document.getElementById('filter-login-role')?.value || '';

    // Filter data di memory:
    // Default (Semua Role): super_admin dikecualikan agar tidak memenuhi log dengan aktivitas admin sendiri
    // Kecuali jika user secara eksplisit memilih filter role 'super_admin'
    const filteredData = filterRole
        ? loginHistoryData.filter(d => d.role === filterRole)
        : loginHistoryData.filter(d => d.role !== 'super_admin');

    if (filteredData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-400 dark:text-slate-500 italic">Tidak ada data untuk filter ini.</td></tr>';
        return;
    }

    const PRIMARY_ROLES_MAP = {
        'super_admin': { label: 'Super Admin', badgeClass: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300' },
        'admin_perpus': { label: 'Admin Perpustakaan', badgeClass: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' },
        'kepala_sekolah': { label: 'Kepala Sekolah', badgeClass: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' },
        'staff': { label: 'Staff', badgeClass: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300' },
        'guru_mapel': { label: 'Guru Mapel', badgeClass: 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300' },
        'admin_pks': { label: 'Admin PKS', badgeClass: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300' },
        'admin_kelas': { label: 'Admin Kelas', badgeClass: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300' }
    };

    let html = '';
    filteredData.forEach(d => {
        const rawTime = d.login_at || d.loginAt;
        const loginTime = rawTime?.toDate ? rawTime.toDate() : (rawTime ? new Date(rawTime) : new Date());
        const timeStr = isNaN(loginTime.getTime()) ? '-' : loginTime.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        const dateStr = isNaN(loginTime.getTime()) ? '-' : loginTime.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

        // Styling role badge
        const badgeInfo = PRIMARY_ROLES_MAP[d.role] || {
            label: d.role ? d.role.replace(/_/g, ' ').toUpperCase() : '-',
            badgeClass: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
        };

        const userAgentStr = d.user_agent || d.userAgent || '-';

        html += `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/60 border-b border-transparent dark:border-slate-800/40 transition text-xs">
                <td class="px-4 py-2 whitespace-nowrap">
                    <div class="font-bold text-slate-600 dark:text-slate-300">${dateStr}</div>
                    <div class="text-[10px] text-slate-400 dark:text-slate-500">${timeStr}</div>
                </td>
                <td class="px-4 py-2 font-medium text-slate-700 dark:text-slate-200">${d.name || '-'}</td>
                <td class="px-4 py-2 text-slate-500 dark:text-slate-400">${d.email || '-'}</td>
                <td class="px-4 py-2">
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${badgeInfo.badgeClass}">${badgeInfo.label}</span>
                </td>
                <td class="px-4 py-2 text-slate-400 dark:text-slate-500">${userAgentStr}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
};

// === HELPER: CEK PENGECUALIAN PENGINGAT GURU WALI (RBAC EXEMPTION) ===
// Super Admin, Kepala Sekolah, dan Staff/Tata Usaha tidak dibebani kewajiban membina siswa perwalian.
// Admin Kelas, Admin PKS, dan Siswa juga tidak memiliki siswa perwalian.
function isExemptFromGuruWaliReminder(role) {
    const directRole = role || localStorage.getItem('user_role') || (currentUserData && (currentUserData.role || currentUserData.currentRole));
    const exemptRoles = ['super_admin', 'kepala_sekolah', 'staff', 'admin_kelas', 'admin_pks', 'siswa'];

    if (directRole && exemptRoles.includes(directRole)) {
        return true;
    }

    if (typeof window.hasRole === 'function') {
        if (exemptRoles.some(r => window.hasRole(r))) {
            return true;
        }
    }

    if (typeof window.getAllUserRoles === 'function') {
        const allRoles = window.getAllUserRoles();
        if (Array.isArray(allRoles) && allRoles.some(r => exemptRoles.includes(r))) {
            return true;
        }
    }

    if (currentUserData) {
        const userRole = currentUserData.role || currentUserData.currentRole;
        const addRoles = Array.isArray(currentUserData.additionalRoles) ? currentUserData.additionalRoles : [];
        if (userRole && exemptRoles.includes(userRole)) {
            return true;
        }
        if (addRoles.some(r => exemptRoles.includes(r))) {
            return true;
        }
        const jabatan = (currentUserData.jabatan || '').toLowerCase();
        if (jabatan.includes('kepala sekolah') || jabatan.includes('staff') || jabatan.includes('tata usaha') || jabatan.includes('tu') || jabatan.includes('admin')) {
            return true;
        }
    }

    return false;
}
window.isExemptFromGuruWaliReminder = isExemptFromGuruWaliReminder;

// === PENGINGAT GURU WALI UNTUK GURU MAPEL ===
// Menghemat Read dengan menyimpan Local Storage jika sudah pernah isi
async function checkGuruWaliAssignmentReminder(user, role) {
    // Kepala Sekolah dan Staff tidak memiliki siswa perwalian, jangan tampilkan popup
    if (isExemptFromGuruWaliReminder(role)) {
        const existingWarn = document.getElementById('warning-guru-wali');
        if (existingWarn) existingWarn.remove();
        return;
    }

    const cacheKey = `has_wali_students_${user.uid}`;
    if (localStorage.getItem(cacheKey) === 'true') {
        return; // Sudah pernah isi, skip Firestore query
    }

    try {
        if (cfClient && cfClient.enabled) {
            const list = await cfClient.getGuruWaliAssignments({ guru_uid: user.uid, limit: 1 });
            if (Array.isArray(list) && list.length > 0) {
                // Guru ini sudah menginput minimal 1 siswa. Catat di cache agar tidak ditanya lagi.
                localStorage.setItem(cacheKey, 'true');
            } else {
                // Jika kosong/belum ada siswa perwalian sama sekali, tampilkan pop-up merah (kecuali kepsek/staff)
                if (!isExemptFromGuruWaliReminder(role)) {
                    showGuruWaliWarningPopup(role);
                }
            }
        }
    } catch (e) {
        console.warn("Gagal mengecek assignment guru wali via D1:", e);
    }
}
window.checkGuruWaliAssignmentReminder = checkGuruWaliAssignmentReminder;

function showGuruWaliWarningPopup(role) {
    // Jangan tampilkan popup jika yang login kepala sekolah atau staff
    if (isExemptFromGuruWaliReminder(role)) {
        const existingWarn = document.getElementById('warning-guru-wali');
        if (existingWarn) existingWarn.remove();
        return;
    }

    // Hindari duplikasi overlay jika kepanggil dua kali
    if (document.getElementById('warning-guru-wali')) return;

    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[9999] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 transition-opacity fade-in';
    overlay.id = 'warning-guru-wali';
    
    overlay.innerHTML = `
        <div class="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl p-8 max-w-md w-full relative overflow-hidden transform transition-all scale-100 text-center border-2 border-red-500">
            <div class="absolute top-0 left-0 w-full h-2 bg-red-500 animate-pulse"></div>
            
            <div class="w-24 h-24 mx-auto bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mb-6 shadow-inner">
                <i class="fa-solid fa-triangle-exclamation text-5xl text-red-600 dark:text-red-500 animate-bounce"></i>
            </div>
            
            <h2 class="text-2xl font-black text-slate-800 dark:text-white mb-2 uppercase tracking-wide text-red-600 dark:text-red-500">
                Lengkapi Data Perwalian!
            </h2>
            <p class="text-slate-600 dark:text-slate-300 mb-6 font-medium text-sm leading-relaxed">
                Bapak/Ibu Guru terdeteksi <strong class="text-slate-800 dark:text-white">belum menambahkan satupun Siswa</strong> di Portal Guru Wali.
            </p>
            
            <div class="bg-red-50 dark:bg-red-900/10 rounded-xl p-4 mb-8 text-xs text-red-700 dark:text-red-400 text-left border border-red-100 dark:border-red-900/30">
                <ul class="list-disc pl-4 space-y-2">
                    <li>Mohon segera input siswa yang Bapak/Ibu dampingi agar <b>Riwayat Pelanggaran & Prestasi</b> mereka tidak luput dari pantauan.</li>
                    <li>Sistem pengingatan otomatis tidak akan bisa berjalan jika data perwalian ini dibiarkan kosong.</li>
                </ul>
            </div>
            
            <div class="flex flex-col gap-3">
                <a href="guru-wali.html" class="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-4 rounded-xl shadow-lg transition-transform transform hover:-translate-y-1 flex items-center justify-center gap-2">
                    Buka Portal Guru Wali <i class="fa-solid fa-arrow-right"></i>
                </a>
                <button onclick="document.getElementById('warning-guru-wali').remove()" class="w-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 font-bold py-3 rounded-xl transition-colors text-sm">
                    Tutup Sementara (Beresiko)
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(overlay);
}
window.showGuruWaliWarningPopup = showGuruWaliWarningPopup;

// === PENGINGAT VOTING DUTA SHAKTI UNTUK SEMUA USER DASHBOARD ===
async function checkDutaVotingReminder(user, role) {
    // Jika user adalah kepala sekolah atau staff, pastikan popup peringatan guru wali dibersihkan
    if (isExemptFromGuruWaliReminder(role)) {
        const existingWarn = document.getElementById('warning-guru-wali');
        if (existingWarn) existingWarn.remove();
    }

    const shouldCheckGuruWali = () => {
        if (isExemptFromGuruWaliReminder(role)) return false;
        const isGuruMapel = window.hasRole ? window.hasRole('guru_mapel') : (role === 'guru_mapel');
        return isGuruMapel || role === 'guru_mapel';
    };

    // Pengecualian: super_admin, admin_kelas, dan admin_pks tidak ikut voting Duta SHAKTI
    const forbiddenRoles = ['super_admin', 'admin_kelas', 'admin_pks'];
    const hasForbiddenRole = window.hasRole ? 
        forbiddenRoles.some(r => window.hasRole(r)) : 
        forbiddenRoles.includes(role);

    if (hasForbiddenRole) {
        // Lanjutkan ke pengingat guru wali jika dia adalah guru mapel
        if (shouldCheckGuruWali()) {
            await checkGuruWaliAssignmentReminder(user, role);
        }
        return;
    }

    const cacheKey = `duta_voting_completed_${user.uid}`;
    
    // Hemat Kuota: Cek apakah cache lokal sudah menandai voting selesai
    if (localStorage.getItem(cacheKey) === 'true') {
        // Lanjutkan ke pengingat guru wali jika dia adalah guru mapel
        if (shouldCheckGuruWali()) {
            await checkGuruWaliAssignmentReminder(user, role);
        }
        return;
    }

    try {
        // 1. Ambil config system_config (PAKAI CACHE)
        const configData = await getSystemConfigWithCache();
        if (configData.dutaVoting !== true) {
            // Jika voting tidak aktif, jalankan check guru wali (jika guru)
            if (shouldCheckGuruWali()) {
                await checkGuruWaliAssignmentReminder(user, role);
            }
            return;
        }

        // 2. Hubungkan ke Supabase (SSOT)
        if (!supabase) throw new Error('Supabase client belum siap');

        // 3. Cek jumlah suara masuk dari UID ini
        const { count, error } = await supabase
            .from('duta_suara_masuk')
            .select('*', { count: 'exact', head: true })
            .eq('nis_pemilih', String(user.uid));

        if (error) throw error;

        // 4. Jika belum selesai memilih (suara < 6)
        if (count === null || count < 6) {
            console.log(`[Duta Voting] User ${user.uid} baru memilih ${count || 0}/6 kategori. Tampilkan pop-up!`);
            showDutaVotingPopup(count || 0);
        } else {
            // Catat di cache agar di lain waktu tidak mengueri Supabase kembali (hemat kuota)
            localStorage.setItem(cacheKey, 'true');
            console.log(`[Duta Voting] User ${user.uid} sudah menyelesaikan seluruh 6 kategori.`);
            
            // Lanjutkan ke check guru wali (jika guru)
            if (shouldCheckGuruWali()) {
                await checkGuruWaliAssignmentReminder(user, role);
            }
        }
    } catch (e) {
        console.warn("[Duta Voting] Gagal memverifikasi status voting:", e);
        // Fallback aman: jalankan check guru wali demi kelancaran jurnal
        if (shouldCheckGuruWali()) {
            await checkGuruWaliAssignmentReminder(user, role);
        }
    }
}

function showDutaVotingPopup(completedCount) {
    if (document.getElementById('warning-duta-voting')) return;

    const overlay = document.createElement('div');
    overlay.id = 'warning-duta-voting';
    overlay.className = "fixed inset-0 z-[9999] bg-slate-950/85 backdrop-blur-xl flex items-center justify-center p-4 transition-opacity fade-in";

    overlay.innerHTML = `
        <div class="bg-gradient-to-br from-slate-900 to-slate-950 border-2 border-purple-500/40 rounded-[2.5rem] p-6 sm:p-8 max-w-md w-full shadow-[0_0_50px_rgba(168,85,247,0.3)] text-white text-center relative overflow-hidden transform scale-95 opacity-0 transition-all duration-300">
            <!-- Efek Cahaya Latar Belakang -->
            <div class="absolute -right-20 -top-20 w-52 h-52 bg-purple-500/10 rounded-full blur-3xl"></div>
            <div class="absolute -left-20 -bottom-20 w-52 h-52 bg-indigo-500/10 rounded-full blur-3xl"></div>
            
            <!-- Icon Mahkota Emas -->
            <div class="w-20 h-20 bg-gradient-to-tr from-yellow-400 via-amber-400 to-yellow-600 text-slate-950 rounded-full flex items-center justify-center mx-auto mb-6 shadow-2xl border-4 border-slate-900 animate-bounce">
                <i class="fa-solid fa-crown text-3xl"></i>
            </div>

            <span class="bg-purple-500/10 text-purple-400 text-[10px] font-black px-3 py-1.5 rounded-full border border-purple-500/20 uppercase tracking-widest leading-none inline-block mb-3">
                Anugerah Duta CERDAS 2026
            </span>
            
            <h3 class="font-black text-xl md:text-2xl leading-tight tracking-tight font-outfit text-white">Suara Anda Sangat Berharga!</h3>
            <p class="text-slate-400 text-xs mt-3 leading-relaxed">
                Bapak/Ibu terdeteksi <strong class="text-white">belum menyelesaikan voting</strong> Pemilihan Duta CERDAS 2026. Baru mengisi <strong class="text-yellow-400">${completedCount}/6</strong> Kategori.
            </p>
            <p class="text-purple-300 text-[11px] font-bold mt-2">
                Mari bersama salurkan apresiasi Anda untuk menentukan siswa-siswi terbaik sekolah kita!
            </p>

            <div class="mt-8 space-y-3">
                <a href="duta/vote.html" class="w-full bg-gradient-to-r from-yellow-500 via-amber-500 to-yellow-600 hover:from-yellow-600 hover:to-amber-600 text-slate-955 font-black py-4 rounded-2xl shadow-xl shadow-yellow-500/20 transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-2 text-xs">
                    <i class="fa-solid fa-check-to-slot text-sm"></i> MASUK PORTAL VOTING SEKARANG
                </a>
                <button onclick="document.getElementById('warning-duta-voting').remove()" class="w-full bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white font-bold py-3.5 rounded-2xl transition-colors text-[10px] uppercase tracking-wider">
                    Nanti Saja
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Animasi Scale-in
    setTimeout(() => {
        const card = overlay.querySelector('div');
        if (card) {
            card.classList.remove('scale-95', 'opacity-0');
            card.classList.add('scale-100', 'opacity-100');
        }
    }, 50);
}

window.showStudentDistributionModal = async () => {
    const modal = document.getElementById('modal-student-distribution');
    if (!modal) return;

    modal.classList.remove('hidden');
    
    // Tampilkan loader di kontainer
    document.getElementById('dist-total-active').innerText = "...";
    document.getElementById('dist-generation-container').innerHTML = `
        <div class="col-span-3 py-6 text-center text-slate-400 text-xs">
            <i class="fa-solid fa-circle-notch fa-spin text-lg mb-2"></i><br>Menghitung data...
        </div>
    `;
    document.getElementById('dist-class-container').innerHTML = `
        <div class="py-6 text-center text-slate-400 text-xs">
            <i class="fa-solid fa-circle-notch fa-spin text-lg mb-2"></i><br>Menghitung data...
        </div>
    `;

    try {
        // Ambil data siswa dari cache SSOT (hemat kuota)
        const allStudents = await window.getStudentsCache();
        
        // Filter siswa aktif saja (SSOT: sinkron 100% dengan isStudentActive)
        const activeStudents = allStudents.filter(s => {
            if (typeof window.isStudentActive === 'function') {
                return window.isStudentActive(s);
            }
            if (!s.class) return false;
            const lower = String(s.class).toLowerCase();
            const isInactiveStatus = s.status && ['alumni', 'mutasi', 'pindah', 'keluar', 'nonaktif', 'non_aktif', 'lulus', 'do'].includes(String(s.status).toLowerCase());
            const isInactiveClass = ['alumni', 'mutasi', 'pindah', 'keluar', 'nonaktif', 'non_aktif', 'lulus', 'do'].some(label => lower.includes(label));
            return !isInactiveStatus && !isInactiveClass;
        });

        const totalActive = activeStudents.length;
        document.getElementById('dist-total-active').innerText = totalActive.toLocaleString('id-ID');

        // Hitung Per Angkatan (X, XI, XII)
        const genCounts = { X: 0, XI: 0, XII: 0, Lainnya: 0 };
        const classCounts = {};

        activeStudents.forEach(s => {
            const cls = s.class.trim();
            
            // Hitung per kelas
            classCounts[cls] = (classCounts[cls] || 0) + 1;

            // Tentukan Angkatan
            if (cls.toUpperCase().startsWith('XII')) genCounts.XII++;
            else if (cls.toUpperCase().startsWith('XI')) genCounts.XI++;
            else if (cls.toUpperCase().startsWith('X')) genCounts.X++;
            else genCounts.Lainnya++;
        });

        // Render Per Angkatan
        let genHTML = '';
        ['X', 'XI', 'XII'].forEach(grade => {
            const count = genCounts[grade];
            const percent = totalActive > 0 ? ((count / totalActive) * 100).toFixed(0) : 0;
            
            genHTML += `
                <div class="bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800/80 rounded-xl p-3 text-center shadow-sm">
                    <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Kelas ${grade}</span>
                    <h5 class="text-xl font-black text-slate-700 dark:text-slate-200 mt-1">${count}</h5>
                    <div class="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5 font-bold">${percent}% dari total</div>
                </div>
            `;
        });
        document.getElementById('dist-generation-container').innerHTML = genHTML;

        // Render Detail Per Kelas
        const sortedClasses = Object.keys(classCounts).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        
        if (sortedClasses.length === 0) {
            document.getElementById('dist-class-container').innerHTML = `
                <div class="p-6 text-center text-slate-400 italic text-xs">Tidak ada data kelas aktif.</div>
            `;
            return;
        }

        // Cari jumlah siswa terbanyak di suatu kelas untuk perhitungan skala progress bar
        const maxInClass = Math.max(...Object.values(classCounts));

        let classHTML = '';
        sortedClasses.forEach(cls => {
            const count = classCounts[cls];
            const progressPercent = maxInClass > 0 ? (count / maxInClass) * 100 : 0;
            
            classHTML += `
                <div class="flex items-center justify-between p-3.5 hover:bg-slate-100/50 dark:hover:bg-slate-800/30 transition-colors">
                    <div class="flex-1 min-w-0 pr-4">
                        <div class="flex justify-between items-center mb-1.5">
                            <span class="text-xs font-bold text-slate-700 dark:text-slate-200">${cls}</span>
                            <span class="text-xs font-black text-slate-800 dark:text-slate-100">${count} <span class="text-[10px] font-normal text-slate-400">siswa</span></span>
                        </div>
                        <div class="w-full bg-slate-200 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                            <div class="bg-gradient-to-r from-blue-500 to-indigo-500 h-full rounded-full" style="width: ${progressPercent}%;"></div>
                        </div>
                    </div>
                </div>
            `;
        });
        document.getElementById('dist-class-container').innerHTML = classHTML;

    } catch (err) {
        console.error("Gagal menghitung distribusi siswa:", err);
        document.getElementById('dist-class-container').innerHTML = `
            <div class="p-6 text-center text-red-500 text-xs"><i class="fa-solid fa-circle-exclamation mr-1"></i> Gagal memuat data.</div>
        `;
    }
};

window.closeStudentDistributionModal = () => {
    const modal = document.getElementById('modal-student-distribution');
    if (modal) modal.classList.add('hidden');
};

// =========================================================================
// ANALYTICS & VISUALIZATION FOR KEPALA SEKOLAH (HEADING LEVEL SUMMARY & CHARTS)
// =========================================================================

// Global cache untuk data pelanggaran tahun ajaran (hemat kuota read)
const VIOLATIONS_CACHE_KEY = 'simas_violations_academic_year_cache';
const VIOLATIONS_CACHE_TS_KEY = 'simas_violations_academic_year_cache_ts';

async function getViolationsAcademicYearCache(forceRefresh = false) {
    try {
        const serverTime = await window.getServerMetadataLastUpdate(forceRefresh);

        if (!forceRefresh) {
            const localTs = localStorage.getItem(VIOLATIONS_CACHE_TS_KEY);
            const localData = localStorage.getItem(VIOLATIONS_CACHE_KEY);

            if (serverTime > 0 && localTs && String(serverTime) === String(localTs) && localData) {
                console.log('[Cache Violations] Using localStorage cache (metadata valid)');
                return JSON.parse(localData);
            }
        }

        const startAcademicYear = getAcademicYearStart();
        const startAcademicYearStr = window.getLocalISODate ? window.getLocalISODate(startAcademicYear) : startAcademicYear.toISOString().substring(0, 10);

        console.log('[Cache Violations] Fetching records from Cloudflare D1...');
        const snap = await cfClient.getRecords({
            category: 'Pelanggaran',
            date_start: startAcademicYearStr,
            limit: 2000
        });

        const violations = (snap || []).map(r => {
            const timeObj = r.timestamp?.toDate ? r.timestamp.toDate() : (r.timestampIso ? new Date(r.timestampIso) : (r.date ? new Date(r.date) : new Date()));
            return {
                id: r.id,
                studentNIS: r.studentNIS || r.student_nis,
                studentName: r.studentName || r.student_name,
                studentClass: r.studentClass || r.student_class,
                category: r.category,
                type: r.type,
                points: r.points,
                desc: r.desc,
                timestampMillis: timeObj.getTime()
            };
        });

        try {
            localStorage.setItem(VIOLATIONS_CACHE_KEY, JSON.stringify(violations));
            localStorage.setItem(VIOLATIONS_CACHE_TS_KEY, String(serverTime || Date.now()));
        } catch (e) {
            console.warn('[Cache Violations] Failed to save to localStorage:', e);
        }

        return violations;
    } catch (e) {
        console.error('[Cache Violations] Error:', e);
        const localData = localStorage.getItem(VIOLATIONS_CACHE_KEY);
        if (localData) return JSON.parse(localData);
        return [];
    }
}


/**
 * Helper SSOT: Verifikasi Keaktifan Guru & Tenaga Kependidikan (GTK)
 * Meloloskan seluruh GTK yang terdaftar di master D1/Firestore kecuali yang memiliki status
 * nonaktif eksplisit (pensiun, mutasi, keluar, nonaktif, almarhum, dsb).
 */
function isGtkActive(t) {
    if (!t) return false;
    if (t.is_active === false || t.is_active === 0 || t.is_active === '0') return false;

    const rawStatus = String(t.status || '').trim().toLowerCase();
    const rawStatusKep = String(t.status_kepegawaian || '').trim().toLowerCase();
    const rawKeaktifan = String(t.keaktifan || t.status_aktif || '').trim().toLowerCase();

    const inactiveKeywords = ['pensiun', 'mutasi', 'keluar', 'nonaktif', 'non_aktif', 'non-aktif', 'meninggal', 'almarhum', 'berhenti', 'dikeluarkan'];

    if (inactiveKeywords.some(kw => rawStatus === kw || rawStatus.includes(kw))) return false;
    if (inactiveKeywords.some(kw => rawStatusKep === kw || rawStatusKep.includes(kw))) return false;
    if (inactiveKeywords.some(kw => rawKeaktifan === kw || rawKeaktifan.includes(kw))) return false;

    return true;
}
if (typeof window !== 'undefined') {
    window.isGtkActive = isGtkActive;
}

// CACHE CONFIG PRESENSI EKSEKUTIF (Hemat 97% Kuota Supabase & 0ms SWR)
const KEPSEK_ATTENDANCE_CACHE_KEY = 'simas_dashboard_kepsek_attendance_cache';
const KEPSEK_ATTENDANCE_TTL = 15 * 60 * 1000; // 15 menit

/**
 * Agregasi Presensi Eksekutif (SSOT Supabase - Hemat Kuota)
 * Prioritas 1: Membaca tabel pra-agregasi siswa_presensi_harian (1 baris per kelas per hari).
 * Prioritas 2 (Fallback): Membaca siswa_presensi detail per siswa jika tabel harian belum teragregasi.
 * Prioritas 3 (Fallback Ekstrem): Agregasi lokal dari student_aggregates D1.
 */
async function getExecutiveAttendanceSummary({ startAcademicYearStr, todayStr, semRange, allAggregates = [], studentMap = {}, forceRefresh = false } = {}) {
    // 1. Cek Cache Lokal (0 Supabase Read)
    if (!forceRefresh && typeof window.getLocalCache === 'function') {
        const cached = window.getLocalCache(KEPSEK_ATTENDANCE_CACHE_KEY, KEPSEK_ATTENDANCE_TTL);
        if (cached && cached.classAttMap && cached.semesterClassAttMap && cached.gradeAttMap) {
            console.log('📦 [Dashboard Kepsek] Attendance summary loaded from cache (0 Supabase Read)');
            return cached;
        }
    }

    const classAttMap = {};
    const semesterClassAttMap = {};
    const gradeAttMap = {
        X: { H: 0, S: 0, I: 0, D: 0, A: 0 },
        XI: { H: 0, S: 0, I: 0, D: 0, A: 0 },
        XII: { H: 0, S: 0, I: 0, D: 0, A: 0 }
    };
    let totalH = 0, totalS = 0, totalI = 0, totalD = 0, totalA = 0;
    const todayFallbackMap = {};
    let source = 'empty';

    // 2. Prioritas 1: Ambil data pra-agregasi dari siswa_presensi_harian (1 baris per rombel per hari - Hemat 97% Kuota)
    let harianRows = [];
    if (supabase && typeof window.fetchAllSupabaseRows === 'function') {
        try {
            const res = await window.fetchAllSupabaseRows(
                supabase,
                'siswa_presensi_harian',
                q => q.gte('tanggal', startAcademicYearStr).lte('tanggal', todayStr),
                { selectFields: 'tanggal, kelas, summary' }
            );
            if (res && Array.isArray(res.data) && res.data.length > 0) {
                harianRows = res.data;
                source = 'siswa_presensi_harian';
            }
        } catch (errHarian) {
            console.warn('[Dashboard Kepsek] Error fetch siswa_presensi_harian Supabase:', errHarian);
        }
    }

    // 3. Prioritas 2 (Fallback Defensif): Jika siswa_presensi_harian belum ada data, baca siswa_presensi detail
    let detailRows = [];
    const fetchAttendancePromise = (source === 'empty' && supabase && typeof window.fetchAllSupabaseRows === 'function')
        ? window.fetchAllSupabaseRows(
            supabase,
            'siswa_presensi',
            q => q.gte('tanggal', startAcademicYearStr).lte('tanggal', todayStr),
            { selectFields: 'tanggal, kelas, status' }
        ).then(res => res.data || []).catch(err => {
            console.warn('[Dashboard Kepsek] Error fetch siswa_presensi Supabase:', err);
            return [];
        })
        : Promise.resolve([]);

    if (source === 'empty') {
        detailRows = await fetchAttendancePromise;
        if (detailRows.length > 0) {
            source = 'siswa_presensi';
        }
    }

    // 4. Kalkulasi Agregasi Berdasarkan Sumber Data
    if (source === 'siswa_presensi_harian' && harianRows.length > 0) {
        harianRows.forEach(row => {
            const cls = String(row.kelas || '').trim();
            if (!cls) return;

            const rowDate = String(row.tanggal || '').substring(0, 10);
            const isSemesterRow = !rowDate || (rowDate >= semRange.startDate && rowDate <= todayStr && (!semRange.endDate || rowDate <= semRange.endDate));

            if (!classAttMap[cls]) {
                classAttMap[cls] = { H: 0, S: 0, I: 0, D: 0, A: 0 };
            }
            if (isSemesterRow && !semesterClassAttMap[cls]) {
                semesterClassAttMap[cls] = { H: 0, S: 0, I: 0, D: 0, A: 0 };
            }

            let sum = row.summary || {};
            if (typeof sum === 'string') {
                try { sum = JSON.parse(sum); } catch (_) { sum = {}; }
            }
            const h = Number(sum.H) || 0;
            const s = Number(sum.S) || 0;
            const i = Number(sum.I) || 0;
            const d = Number(sum.D) || 0;
            const a = Number(sum.A) || 0;

            classAttMap[cls].H += h;
            classAttMap[cls].S += s;
            classAttMap[cls].I += i;
            classAttMap[cls].D += d;
            classAttMap[cls].A += a;

            totalH += h;
            totalS += s;
            totalI += i;
            totalD += d;
            totalA += a;

            if (isSemesterRow) {
                semesterClassAttMap[cls].H += h;
                semesterClassAttMap[cls].S += s;
                semesterClassAttMap[cls].I += i;
                semesterClassAttMap[cls].D += d;
                semesterClassAttMap[cls].A += a;
            }

            if (rowDate === todayStr) {
                if (!todayFallbackMap[cls]) todayFallbackMap[cls] = { H: 0, S: 0, I: 0, D: 0, A: 0 };
                todayFallbackMap[cls].H += h;
                todayFallbackMap[cls].S += s;
                todayFallbackMap[cls].I += i;
                todayFallbackMap[cls].D += d;
                todayFallbackMap[cls].A += a;
            }

            let grade = null;
            const cleanCls = cls.toUpperCase().replace(/^KELAS\s+/i, '');
            if (cleanCls.startsWith('XII') || cleanCls.startsWith('12')) grade = 'XII';
            else if (cleanCls.startsWith('XI') || cleanCls.startsWith('11')) grade = 'XI';
            else if (cleanCls.startsWith('X') || cleanCls.startsWith('10')) grade = 'X';

            if (grade && gradeAttMap[grade]) {
                gradeAttMap[grade].H += h;
                gradeAttMap[grade].S += s;
                gradeAttMap[grade].I += i;
                gradeAttMap[grade].D += d;
                gradeAttMap[grade].A += a;
            }
        });
    } else if (source === 'siswa_presensi' && detailRows.length > 0) {
        detailRows.forEach(row => {
            const cls = String(row.kelas || '').trim();
            if (!cls) return;

            const rowDate = String(row.tanggal || '').substring(0, 10);
            const isSemesterRow = !rowDate || (rowDate >= semRange.startDate && rowDate <= todayStr && (!semRange.endDate || rowDate <= semRange.endDate));

            if (!classAttMap[cls]) {
                classAttMap[cls] = { H: 0, S: 0, I: 0, D: 0, A: 0 };
            }
            if (isSemesterRow && !semesterClassAttMap[cls]) {
                semesterClassAttMap[cls] = { H: 0, S: 0, I: 0, D: 0, A: 0 };
            }

            const st = String(row.status || '').toUpperCase();
            let counted = true;
            if (st === 'H' || st === 'HADIR') {
                classAttMap[cls].H++;
                totalH++;
                if (isSemesterRow) semesterClassAttMap[cls].H++;
            } else if (st === 'S' || st === 'SAKIT') {
                classAttMap[cls].S++;
                totalS++;
                if (isSemesterRow) semesterClassAttMap[cls].S++;
            } else if (st === 'I' || st === 'IZIN') {
                classAttMap[cls].I++;
                totalI++;
                if (isSemesterRow) semesterClassAttMap[cls].I++;
            } else if (st === 'D' || st === 'DISPEN' || st === 'DISPENSASI') {
                classAttMap[cls].D++;
                totalD++;
                if (isSemesterRow) semesterClassAttMap[cls].D++;
            } else if (st === 'A' || st === 'ALPA' || st === 'ALPHA') {
                classAttMap[cls].A++;
                totalA++;
                if (isSemesterRow) semesterClassAttMap[cls].A++;
            } else {
                counted = false;
            }

            if (rowDate === todayStr && counted) {
                if (!todayFallbackMap[cls]) todayFallbackMap[cls] = { H: 0, S: 0, I: 0, D: 0, A: 0 };
                if (st === 'H' || st === 'HADIR') todayFallbackMap[cls].H++;
                else if (st === 'S' || st === 'SAKIT') todayFallbackMap[cls].S++;
                else if (st === 'I' || st === 'IZIN') todayFallbackMap[cls].I++;
                else if (st === 'D' || st === 'DISPEN' || st === 'DISPENSASI') todayFallbackMap[cls].D++;
                else if (st === 'A' || st === 'ALPA' || st === 'ALPHA') todayFallbackMap[cls].A++;
            }

            if (counted) {
                let grade = null;
                const cleanCls = cls.toUpperCase().replace(/^KELAS\s+/i, '');
                if (cleanCls.startsWith('XII') || cleanCls.startsWith('12')) grade = 'XII';
                else if (cleanCls.startsWith('XI') || cleanCls.startsWith('11')) grade = 'XI';
                else if (cleanCls.startsWith('X') || cleanCls.startsWith('10')) grade = 'X';

                if (grade && gradeAttMap[grade]) {
                    if (st === 'H' || st === 'HADIR') gradeAttMap[grade].H++;
                    else if (st === 'S' || st === 'SAKIT') gradeAttMap[grade].S++;
                    else if (st === 'I' || st === 'IZIN') gradeAttMap[grade].I++;
                    else if (st === 'D' || st === 'DISPEN' || st === 'DISPENSASI') gradeAttMap[grade].D++;
                    else if (st === 'A' || st === 'ALPA' || st === 'ALPHA') gradeAttMap[grade].A++;
                }
            }
        });
    } else if (Array.isArray(allAggregates) && allAggregates.length > 0) {
        // Fallback backward compatibility jika presensi tercatat di agregat siswa
        source = 'student_aggregates';
        allAggregates.forEach(agg => {
            const student = studentMap[agg.nis || agg.student_nis];
            if (!student) return;

            const att = agg.attendance || {};
            const h = att.H || 0;
            const s = att.S || 0;
            const i = att.I || 0;
            const d = att.D || 0;
            const a = att.A || 0;

            totalH += h;
            totalS += s;
            totalI += i;
            totalD += d;
            totalA += a;

            const cls = student.class;
            if (!classAttMap[cls]) {
                classAttMap[cls] = { H: 0, S: 0, I: 0, D: 0, A: 0 };
            }
            classAttMap[cls].H += h;
            classAttMap[cls].S += s;
            classAttMap[cls].I += i;
            classAttMap[cls].D += d;
            classAttMap[cls].A += a;

            let grade = null;
            const cleanCls = String(cls || '').toUpperCase().replace(/^KELAS\s+/i, '');
            if (cleanCls.startsWith('XII') || cleanCls.startsWith('12')) grade = 'XII';
            else if (cleanCls.startsWith('XI') || cleanCls.startsWith('11')) grade = 'XI';
            else if (cleanCls.startsWith('X') || cleanCls.startsWith('10')) grade = 'X';

            if (grade && gradeAttMap[grade]) {
                gradeAttMap[grade].H += h;
                gradeAttMap[grade].S += s;
                gradeAttMap[grade].I += i;
                gradeAttMap[grade].D += d;
                gradeAttMap[grade].A += a;
            }
        });
    }

    // 5. Hitung Metrik Agregat Tambahan
    const totalDaysAll = totalH + totalS + totalI + totalD + totalA;
    let avgAttPercent = null;
    if (totalDaysAll > 0) {
        if (typeof window.calculateAttendanceStats === 'function') {
            const stats = window.calculateAttendanceStats({ H: totalH, S: totalS, I: totalI, D: totalD, A: totalA });
            avgAttPercent = stats.attPct;
        } else {
            avgAttPercent = parseFloat((((totalH + totalD) / totalDaysAll) * 100).toFixed(1));
        }
    }

    const classList = [];
    Object.keys(classAttMap).forEach(cls => {
        const att = classAttMap[cls];
        const stats = typeof window.calculateAttendanceStats === 'function'
            ? window.calculateAttendanceStats(att)
            : { total: att.H + att.S + att.I + att.D + att.A, attPct: 0 };
        if (stats.total > 0) {
            const percent = stats.attPct !== undefined ? stats.attPct : parseFloat(((att.H + att.D) / stats.total * 100).toFixed(1));
            classList.push({ cls, percent, total: stats.total });
        }
    });
    const lowAttClasses = classList.filter(item => item.percent < 90);

    const payload = {
        classAttMap,
        semesterClassAttMap,
        gradeAttMap,
        totalH, totalS, totalI, totalD, totalA,
        totalDaysAll,
        avgAttPercent,
        classList,
        lowAttClasses,
        todayFallbackMap,
        source
    };

    // 6. Simpan ke Cache Lokal (TTL 15 Menit)
    if (typeof window.setLocalCache === 'function' && totalDaysAll > 0) {
        window.setLocalCache(KEPSEK_ATTENDANCE_CACHE_KEY, payload);
    }

    return payload;
}

async function loadKepalaSekolahDashboard(forceRefresh = false) {
    try {
        const elTotalSiswa = document.getElementById('kepsek-total-siswa');
        const elTotalGtk = document.getElementById('kepsek-total-gtk');
        const elAvgAtt = document.getElementById('kepsek-avg-attendance');
        const elTotalVio = document.getElementById('kepsek-total-violations');
        const elTotalAch = document.getElementById('kepsek-total-achievements');

        // SWR (STALE-WHILE-REVALIDATE) TINGKAT 0: Tampilkan data dari cache lokal secara instan (0ms)
        const cachedSpp = !forceRefresh && typeof window.getLocalCache === 'function'
            ? window.getLocalCache(SPP_PROGRESS_CACHE_KEY, SPP_PROGRESS_TTL)
            : null;
        if (cachedSpp) {
            applySppUI(cachedSpp);
        } else {
            if (document.getElementById('spp-realisasi-amount')) document.getElementById('spp-realisasi-amount').innerText = 'Rp ...';
            if (document.getElementById('spp-target-amount')) document.getElementById('spp-target-amount').innerText = 'Rp ...';
            if (document.getElementById('spp-kekurangan-amount')) document.getElementById('spp-kekurangan-amount').innerText = 'Rp ...';
            if (document.getElementById('spp-progress-percent')) document.getElementById('spp-progress-percent').innerText = '0%';
            if (document.getElementById('spp-month-realisasi')) document.getElementById('spp-month-realisasi').innerText = 'Rp ...';
            if (document.getElementById('spp-month-target')) document.getElementById('spp-month-target').innerText = 'Rp ...';
            if (document.getElementById('spp-month-kekurangan')) document.getElementById('spp-month-kekurangan').innerText = 'Rp ...';
            if (document.getElementById('spp-month-percent')) document.getElementById('spp-month-percent').innerText = '0%';
        }

        const cachedAtt = !forceRefresh && typeof window.getLocalCache === 'function'
            ? window.getLocalCache(KEPSEK_ATTENDANCE_CACHE_KEY, KEPSEK_ATTENDANCE_TTL)
            : null;
        if (cachedAtt && cachedAtt.avgAttPercent !== null) {
            if (elAvgAtt) {
                elAvgAtt.innerText = `${cachedAtt.avgAttPercent.toFixed(1)}%`;
                elAvgAtt.title = `Total catatan presensi TA: ${(cachedAtt.totalDaysAll || 0).toLocaleString('id-ID')}`;
            }
            const elAttSub = document.getElementById('kepsek-attendance-subtext');
            if (elAttSub) {
                if ((cachedAtt.classList || []).length === 0 || cachedAtt.totalDaysAll === 0) {
                    elAttSub.innerText = 'Belum ada data presensi (TA)';
                } else if ((cachedAtt.lowAttClasses || []).length > 0) {
                    elAttSub.innerHTML = `<span class="text-amber-600 dark:text-amber-400 font-bold">${cachedAtt.lowAttClasses.length} kelas</span> &lt; 90%`;
                } else {
                    elAttSub.innerHTML = `<span class="text-emerald-600 dark:text-emerald-400 font-bold">Semua kelas</span> &ge; 90%`;
                }
            }
            const targetExtreme = Object.keys(cachedAtt.semesterClassAttMap || {}).length > 0 ? cachedAtt.semesterClassAttMap : cachedAtt.classAttMap;
            if (cachedAtt.gradeAttMap) renderGradeAttendanceBarChart(cachedAtt.gradeAttMap);
            if (targetExtreme) renderTopClassesAttendance(targetExtreme);
        } else {
            if (elTotalSiswa) elTotalSiswa.innerText = '...';
            if (elTotalGtk) elTotalGtk.innerText = '...';
            if (elAvgAtt) elAvgAtt.innerText = '...';
            if (elTotalVio) elTotalVio.innerText = '...';
            if (elTotalAch) elTotalAch.innerText = '...';
        }

        const startAcademicYear = getAcademicYearStart();
        const startAcademicYearStr = window.getLocalISODate ? window.getLocalISODate(startAcademicYear) : startAcademicYear.toISOString().substring(0, 10);
        const todayStr = (window.getWitaISODate && typeof window.getWitaISODate === 'function')
            ? window.getWitaISODate()
            : (window.getLocalISODate ? window.getLocalISODate(new Date()) : new Date().toISOString().substring(0, 10));
        const semRange = getCurrentSemesterRange();

        // Siapkan promise presensi harian HARI INI dari Supabase (siswa_presensi_harian - SSOT presensi.html)
        const fetchTodaySummaryPromise = (typeof window.fetchDailyAttendanceSummary === 'function')
            ? window.fetchDailyAttendanceSummary(todayStr).catch(err => {
                console.warn('[Dashboard Kepsek] Error fetch daily attendance summary:', err);
                return { rows: [], source: 'empty' };
            })
            : Promise.resolve({ rows: [], source: 'empty' });

        // TINGKAT 1: Ambil data master siswa, aggregates, riwayat pelanggaran, stats D1, GTK
        // Panggilan ini sangat cepat (< 150ms) dan mandiri dari Cloudflare D1
        const masterDataPromise = Promise.all([
            window.getStudentsCache(forceRefresh),
            window.getStudentAggregatesCache(forceRefresh),
            getViolationsAcademicYearCache(forceRefresh),
            cfClient.getRecordStats({ date_start: startAcademicYearStr }).catch(e => {
                console.warn('[Dashboard Kepsek] getRecordStats fallback:', e);
                return null;
            }),
            typeof window.getTeachersCache === 'function' ? window.getTeachersCache(forceRefresh).catch(() => []) : []
        ]);

        // Tunggu data master Tingkat 1 dan render kartu KPI segera (< 100ms)
        const [allStudents, allAggregates, violations, recordStats, allGtk] = await masterDataPromise;

        // 1. Filter siswa aktif (SSOT Compliant)
        const activeStudents = allStudents.filter(s => {
            if (typeof window.isStudentActive === 'function') {
                return window.isStudentActive(s);
            }
            if (!s.class) return false;
            const lower = String(s.class).toLowerCase();
            const isInactiveStatus = s.status && ['alumni', 'mutasi', 'pindah', 'keluar', 'nonaktif', 'non_aktif', 'lulus', 'do'].includes(String(s.status).toLowerCase());
            const isInactiveClass = ['alumni', 'mutasi', 'pindah', 'keluar', 'nonaktif', 'non_aktif', 'lulus', 'do'].some(label => lower.includes(label));
            return !isInactiveStatus && !isInactiveClass;
        });

        const activeStudentCount = activeStudents.length;
        if (elTotalSiswa) elTotalSiswa.innerText = activeStudentCount.toLocaleString('id-ID');

        // 2. Hitung GTK Aktif (SSOT Compliant)
        const activeGtkCount = (allGtk || []).filter(isGtkActive).length;
        if (elTotalGtk) elTotalGtk.innerText = activeGtkCount.toLocaleString('id-ID');

        // Buat map NIS -> student data untuk pencarian cepat
        const studentMap = {};
        activeStudents.forEach(s => {
            studentMap[s.nis] = s;
        });

        // 3. Render Pelanggaran, Prestasi & Grafik BK Segera
        const finalViolations = recordStats?.violation !== undefined ? recordStats.violation : violations.length;
        const finalAchievements = recordStats?.achievement || 0;

        if (elTotalVio) elTotalVio.innerText = finalViolations.toLocaleString('id-ID');
        if (elTotalAch) elTotalAch.innerText = finalAchievements.toLocaleString('id-ID');

        const todayViolations = (violations || []).filter(v => {
            const d = new Date(v.timestampMillis);
            const dStr = (window.getWitaISODate && typeof window.getWitaISODate === 'function')
                ? window.getWitaISODate(d)
                : (window.getLocalISODate ? window.getLocalISODate(d) : d.toISOString().substring(0, 10));
            return dStr === todayStr;
        });
        const elBkSub = document.getElementById('kepsek-bk-subtext');
        if (elBkSub) {
            if (todayViolations.length > 0) {
                elBkSub.innerHTML = `<span class="text-rose-600 dark:text-rose-400 font-bold">Hari ini: ${todayViolations.length} kasus baru</span>`;
            } else {
                elBkSub.innerHTML = `<span>Hari ini: Nihil kasus</span>`;
            }
        }

        renderViolationTrendLineChart(violations);
        renderViolationHeatmap(violations);

        // Update label konteks semester pada kartu Kehadiran Kelas Ekstrim
        const elExtBadge = document.getElementById('kepsek-extreme-att-badge');
        if (elExtBadge) {
            elExtBadge.innerText = 'Semester Berjalan';
            elExtBadge.title = `${semRange.semesterLabel} (TA ${semRange.academicYear})`;
        }
        const elExtSub = document.getElementById('kepsek-extreme-att-subtext');
        if (elExtSub) {
            elExtSub.innerText = `Akumulasi semester aktif (s.d. hari ini)`;
            elExtSub.title = `${semRange.semesterLabel} TA ${semRange.academicYear}`;
        }

        // TINGKAT 2 & 3: Presensi Teragregasi & SPP Latar Belakang (Jalan Paralel)
        const attendancePromise = getExecutiveAttendanceSummary({
            startAcademicYearStr,
            todayStr,
            semRange,
            allAggregates,
            studentMap,
            forceRefresh
        });
        const sppPromise = renderSppProgressRing(activeStudents, forceRefresh);

        // Tunggu data presensi & presensi harian hari ini
        const [attSummary, todaySummaryResult] = await Promise.all([
            attendancePromise,
            fetchTodaySummaryPromise
        ]);

        const {
            classAttMap,
            semesterClassAttMap,
            gradeAttMap,
            avgAttPercent,
            totalDaysAll,
            classList,
            lowAttClasses,
            todayFallbackMap
        } = attSummary;

        if (elAvgAtt) {
            if (avgAttPercent !== null) {
                elAvgAtt.innerText = `${avgAttPercent.toFixed(1)}%`;
                elAvgAtt.title = `Total catatan presensi TA: ${totalDaysAll.toLocaleString('id-ID')}`;
            } else {
                elAvgAtt.innerText = '-';
                elAvgAtt.title = 'Belum ada catatan presensi di tahun ajaran ini';
            }
        }

        const elAttSub = document.getElementById('kepsek-attendance-subtext');
        if (elAttSub) {
            if (classList.length === 0 || totalDaysAll === 0) {
                elAttSub.innerText = 'Belum ada data presensi (TA)';
            } else if (lowAttClasses.length > 0) {
                elAttSub.innerHTML = `<span class="text-amber-600 dark:text-amber-400 font-bold">${lowAttClasses.length} kelas</span> &lt; 90%`;
            } else {
                elAttSub.innerHTML = `<span class="text-emerald-600 dark:text-emerald-400 font-bold">Semua kelas</span> &ge; 90%`;
            }
        }

        // Render Grafik Kehadiran & Kelas Ekstrim
        const targetExtremeClassMap = Object.keys(semesterClassAttMap).length > 0 ? semesterClassAttMap : classAttMap;
        renderGradeAttendanceBarChart(gradeAttMap);
        renderTopClassesAttendance(targetExtremeClassMap);

        // Hitung kehadiran kelas khusus HARI INI (SSOT dengan presensi.html)
        const todayClassList = [];
        const todayRows = (todaySummaryResult && Array.isArray(todaySummaryResult.rows)) ? todaySummaryResult.rows : [];

        if (todayRows.length > 0) {
            todayRows.forEach(row => {
                const stats = typeof window.calculateAttendanceStats === 'function'
                    ? window.calculateAttendanceStats(row.summary)
                    : (() => {
                        const s = row.summary || {};
                        const tot = (s.H || 0) + (s.S || 0) + (s.I || 0) + (s.D || 0) + (s.A || 0);
                        const had = (s.H || 0) + (s.D || 0);
                        return { total: tot, attPct: tot > 0 ? parseFloat((had / tot * 100).toFixed(1)) : 0 };
                    })();
                if (stats.total > 0) {
                    todayClassList.push({
                        cls: row.class,
                        percent: stats.attPct,
                        total: stats.total,
                        hadirCount: stats.hadirCount,
                        summary: row.summary
                    });
                }
            });
        } else if (todayFallbackMap && Object.keys(todayFallbackMap).length > 0) {
            Object.keys(todayFallbackMap).forEach(cls => {
                const stats = typeof window.calculateAttendanceStats === 'function'
                    ? window.calculateAttendanceStats(todayFallbackMap[cls])
                    : null;
                if (stats && stats.total > 0) {
                    todayClassList.push({
                        cls,
                        percent: stats.attPct,
                        total: stats.total,
                        hadirCount: stats.hadirCount,
                        summary: todayFallbackMap[cls]
                    });
                }
            });
        }
        const todayLowAttClasses = todayClassList.filter(item => item.percent < 90);

        // Tunggu SPP (jika belum selesai)
        const sppData = await sppPromise;

        // Render Section Atensi Hari Ini (Executive Attention Center)
        // SSOT: Menggunakan data presensi HARI INI (todayClassList), bukan akumulasi TA
        renderAtensiHariIni({
            classList: todayClassList,
            lowAttClasses: todayLowAttClasses,
            todayViolations,
            violations,
            sppData
        });

        // Render Section Ringkasan Ranking Kinerja Rombel Kelas (Executive Ranking Showcase)
        await loadAndRenderExecutiveRankingSummary({
            activeStudents,
            semesterClassAttMap,
            classAttMap,
            violations,
            sppData,
            allGtk,
            forceRefresh
        });
    } catch (e) {
        console.error("Gagal memproses dashboard Kepala Sekolah:", e);
    }
}

function renderAtensiHariIni({ classList, lowAttClasses, todayViolations, violations, sppData }) {
    const container = document.getElementById('atensi-items-container');
    const badge = document.getElementById('atensi-count-badge');
    const dateScopeEl = document.getElementById('atensi-date-scope');
    if (!container) return;

    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateStr = new Date().toLocaleDateString('id-ID', options);
    if (dateScopeEl) {
        dateScopeEl.innerText = `Kondisi prioritas per ${dateStr}`;
    }

    const attentionItems = [];

    // 1. ATENSI KEHADIRAN SISWA HARI INI (SSOT Presensi Siswa)
    if (Array.isArray(classList) && classList.length > 0) {
        const sortedClasses = [...classList].sort((a, b) => a.percent - b.percent);
        const lowestClass = sortedClasses[0];

        if (lowestClass && lowestClass.percent < 90) {
            const isCritical = lowestClass.percent < 85;
            attentionItems.push({
                severity: isCritical ? 'critical' : 'warning',
                icon: isCritical ? 'fa-solid fa-circle-exclamation' : 'fa-solid fa-triangle-exclamation',
                title: `Kelas ${lowestClass.cls} memiliki kehadiran terendah: ${lowestClass.percent}%`,
                desc: isCritical 
                    ? `Perlu perhatian pimpinan terkait absensi rendah hari ini (${lowestClass.percent}%). Terdapat ${lowAttClasses.length} kelas di bawah 90%.`
                    : `Terdapat ${lowAttClasses.length} kelas dengan persentase kehadiran di bawah 90% hari ini.`,
                actionLabel: 'Pantau Presensi',
                actionUrl: 'presensi.html'
            });
        }
    }

    // 2. ATENSI KASUS BK HARI INI
    const todayCount = (todayViolations || []).length;
    if (todayCount > 0) {
        const isCritical = todayCount >= 5;
        attentionItems.push({
            severity: isCritical ? 'critical' : 'warning',
            icon: isCritical ? 'fa-solid fa-bell-exclamation' : 'fa-solid fa-scale-balanced',
            title: `${todayCount} kasus BK baru tercatat hari ini`,
            desc: `Tercatat penambahan kasus pelanggaran disiplin siswa pada hari ini.`,
            actionLabel: 'Buka Buku Kasus',
            actionUrl: 'bk.html'
        });
    }

    // 3. ATENSI SISWA DENGAN KASUS BERULANG (TA)
    if (Array.isArray(violations) && violations.length > 0) {
        const vioCountByStudent = {};
        violations.forEach(v => {
            const nis = v.studentNIS;
            if (nis) {
                vioCountByStudent[nis] = (vioCountByStudent[nis] || 0) + 1;
            }
        });
        const repeatCount = Object.values(vioCountByStudent).filter(c => c >= 3).length;
        if (repeatCount > 0) {
            attentionItems.push({
                severity: 'warning',
                icon: 'fa-solid fa-repeat',
                title: `${repeatCount} siswa memiliki 3+ kasus pelanggaran (TA)`,
                desc: `Memerlukan koordinasi pembinaan terpadu wali kelas dan konselor BK.`,
                actionLabel: 'Lihat Siswa BK',
                actionUrl: 'bk.html'
            });
        }
    }

    // 4. ATENSI TUNGGAKAN SPP
    if (sppData && sppData.unpaidStudentsCount > 0) {
        const unpaidCount = sppData.unpaidStudentsCount;
        const topClass = sppData.topDebtClass;
        const topAmount = sppData.topDebtAmount;
        
        let descText = `${unpaidCount} siswa aktif tercatat belum menyelesaikan iuran SPP.`;
        if (topClass && topClass !== '-' && topAmount > 0) {
            descText += ` Tunggakan terbesar: ${topClass} (Rp ${topAmount.toLocaleString('id-ID')}).`;
        }

        attentionItems.push({
            severity: 'warning',
            icon: 'fa-solid fa-wallet',
            title: `${unpaidCount} siswa masih memiliki tunggakan SPP`,
            desc: descText,
            actionLabel: 'Lihat Keuangan',
            actionUrl: 'keuangan.html#tab=laporan&subtab=estimasi'
        });
    }

    // UPDATE BADGE
    if (badge) {
        if (attentionItems.length > 0) {
            badge.innerText = `${attentionItems.length} Perhatian`;
            badge.className = attentionItems.some(i => i.severity === 'critical')
                ? 'px-2 py-0.5 text-[10px] font-black rounded-full bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300'
                : 'px-2 py-0.5 text-[10px] font-black rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300';
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }

    // RENDER ITEMS OR NORMAL STATE
    if (attentionItems.length === 0) {
        container.innerHTML = `
            <div class="flex items-center gap-3.5 p-3.5 sm:p-4 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-100/80 dark:border-emerald-900/40 text-emerald-800 dark:text-emerald-300">
                <div class="w-9 h-9 rounded-xl bg-emerald-500/10 dark:bg-emerald-500/20 flex items-center justify-center shrink-0 text-emerald-600 dark:text-emerald-400 text-lg">
                    <i class="fa-solid fa-circle-check"></i>
                </div>
                <div class="flex-1 min-w-0">
                    <p class="font-bold text-xs sm:text-sm text-emerald-900 dark:text-emerald-200">Kondisi utama sekolah hari ini terpantau normal</p>
                    <p class="text-[11px] text-emerald-700/80 dark:text-emerald-400/80 mt-0.5">Kehadiran kelas dalam batas aman, nihil lonjakan kasus disiplin, dan pembayaran iuran terpantau wajar.</p>
                </div>
            </div>
        `;
        return;
    }

    let html = '';
    attentionItems.forEach(item => {
        const isCrit = item.severity === 'critical';
        const cardBg = isCrit 
            ? 'bg-rose-50/60 dark:bg-rose-950/20 border-rose-100 dark:border-rose-900/40' 
            : 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-100 dark:border-amber-900/40';
        const iconBg = isCrit
            ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
            : 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
        const titleColor = isCrit
            ? 'text-rose-900 dark:text-rose-200'
            : 'text-amber-900 dark:text-amber-200';
        const descColor = isCrit
            ? 'text-rose-700/80 dark:text-rose-300/80'
            : 'text-amber-800/80 dark:text-amber-300/80';
        const btnClass = isCrit
            ? 'bg-rose-600 hover:bg-rose-700 text-white'
            : 'bg-amber-600 hover:bg-amber-700 text-white';

        html += `
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 sm:p-3.5 rounded-xl border ${cardBg} transition-all">
                <div class="flex items-start sm:items-center gap-3 min-w-0">
                    <div class="w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center shrink-0 text-sm mt-0.5 sm:mt-0">
                        <i class="${item.icon}"></i>
                    </div>
                    <div class="min-w-0">
                        <h4 class="text-xs sm:text-sm font-bold ${titleColor} leading-tight">${item.title}</h4>
                        <p class="text-[11px] ${descColor} mt-0.5 line-clamp-1">${item.desc}</p>
                    </div>
                </div>
                <div class="flex sm:shrink-0 justify-end">
                    <a href="${item.actionUrl}" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold ${btnClass} shadow-xs transition-transform active:scale-95 whitespace-nowrap">
                        ${item.actionLabel} <i class="fa-solid fa-arrow-right text-[10px]"></i>
                    </a>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

// =====================================
// RINGKASAN RANKING KINERJA KELAS (EXECUTIVE RANKING SHOWCASE)
// =====================================
function parseClassGradeAndNum(clsName) {
    const raw = String(clsName || '').trim();
    const match = raw.match(/^(XII|XI|X)[^0-9a-zA-Z]*(\d+)?(.*)$/i);
    if (!match) return { gradeWeight: 99, num: 0, suffix: raw, raw };
    const gradeStr = match[1].toUpperCase();
    const gradeWeight = gradeStr === 'X' ? 10 : (gradeStr === 'XI' ? 11 : 12);
    const num = match[2] ? parseInt(match[2], 10) : 0;
    const suffix = match[3] ? match[3].trim().toLowerCase() : '';
    return { gradeWeight, num, suffix, raw };
}

function compareClassesNatural(aName, bName) {
    if (typeof window.compareClassesNatural === 'function') {
        return window.compareClassesNatural(aName, bName);
    }
    const a = parseClassGradeAndNum(aName);
    const b = parseClassGradeAndNum(bName);
    if (a.gradeWeight !== b.gradeWeight) return a.gradeWeight - b.gradeWeight;
    if (a.num !== b.num) return a.num - b.num;
    return (a.suffix || '').localeCompare(b.suffix || '', undefined, { numeric: true, sensitivity: 'base' });
}

async function loadAndRenderExecutiveRankingSummary({ activeStudents = [], semesterClassAttMap = {}, classAttMap = {}, violations = [], sppData = {}, allGtk = [], forceRefresh = false } = {}) {
    const loadingEl = document.getElementById('ranking-summary-loading');
    const contentEl = document.getElementById('ranking-summary-content');
    const podiumEl = document.getElementById('ranking-summary-podium');
    const tableBodyEl = document.getElementById('ranking-summary-table-body');
    const totalInfoEl = document.getElementById('ranking-summary-total-info');

    if (!podiumEl || !tableBodyEl) return;

    const CACHE_TTL = 15 * 60 * 1000; // 15 Menit
    let rankingData = null;

    // Bersihkan cache lama (jika ada sisa versi sebelumnya)
    try { sessionStorage.removeItem('simas_dashboard_ranking_summary'); } catch (_) {}

    // 1. Cek Cache (Shared SSOT dari ranking-kelas.html via localStorage atau sessionStorage)
    if (!forceRefresh) {
        try {
            const cachedSharedStr = localStorage.getItem('simas_class_ranking_summary_cache') || sessionStorage.getItem('simas_class_ranking_summary_cache');
            if (cachedSharedStr) {
                const parsedShared = JSON.parse(cachedSharedStr);
                if (parsedShared && (Date.now() - (parsedShared.timestamp || 0) < CACHE_TTL) && Array.isArray(parsedShared.rankedList) && parsedShared.rankedList.length > 0) {
                    rankingData = parsedShared;
                }
            }
        } catch (e) {
            console.warn('[Dashboard Kepsek] Error membaca cache ranking:', e);
        }
    }

    // 2. Jika belum ada cache, hitung agregasi metrik dari data in-memory / backend (SSOT 100% Selaras Ranking Kelas)
    if (!rankingData) {
        try {
            // Ambil daftar kelas aktif
            let classList = [];
            if (typeof window.getActiveClasses === 'function') {
                try {
                    classList = await window.getActiveClasses();
                } catch (_) {}
            }
            if (!Array.isArray(classList) || classList.length === 0) {
                const clsSet = new Set();
                (activeStudents || []).forEach(s => {
                    const c = String(s.class || '').replace(/^Kelas\s+/i, '').trim();
                    if (c) clsSet.add(c);
                });
                classList = Array.from(clsSet);
            }

            // Urutkan kelas secara natural
            classList.sort((a, b) => compareClassesNatural(a, b));

            // Ambil mapping wali kelas & guru
            const waliMap = typeof window.getWaliKelasCache === 'function' ? await window.getWaliKelasCache().catch(() => new Map()) : new Map();
            const teachersMap = typeof window.getTeachersMapCacheSync === 'function' ? window.getTeachersMapCacheSync() : null;

            // Pemetaan siswa per rombel
            const classStudentsMap = {};
            classList.forEach(c => { classStudentsMap[c] = []; });
            (activeStudents || []).forEach(s => {
                const c = String(s.class || '').replace(/^Kelas\s+/i, '').trim();
                if (classStudentsMap[c]) classStudentsMap[c].push(s);
            });

            // Ambil bobot kriteria evaluasi (SSOT dari Cloudflare D1 / localStorage)
            let criteriaWeights = { attendance: 40, spp: 25, discipline: 35, library: 0 };
            let criteriaVisible = { attendance: true, spp: true, discipline: true, library: true };
            try {
                let cfg = null;
                const cfgStr = localStorage.getItem('simas_ranking_criteria_config');
                if (cfgStr) cfg = JSON.parse(cfgStr);
                if (!cfg && window.cfClient && typeof window.cfClient.getSystemSetting === 'function') {
                    cfg = await window.cfClient.getSystemSetting('ranking_criteria_config');
                    if (cfg) localStorage.setItem('simas_ranking_criteria_config', JSON.stringify(cfg));
                }
                if (cfg?.weights) {
                    criteriaWeights = {
                        attendance: typeof cfg.weights.attendance === 'number' ? cfg.weights.attendance : 40,
                        spp: typeof cfg.weights.spp === 'number' ? cfg.weights.spp : 25,
                        discipline: typeof cfg.weights.discipline === 'number' ? cfg.weights.discipline : 35,
                        library: typeof cfg.weights.library === 'number' ? cfg.weights.library : 0
                    };
                }
                if (cfg?.visible) {
                    criteriaVisible = {
                        attendance: cfg.visible.attendance !== false,
                        spp: cfg.visible.spp !== false,
                        discipline: cfg.visible.discipline !== false,
                        library: cfg.visible.library !== false
                    };
                }
            } catch (_) {}

            const activeW = {
                attendance: criteriaVisible.attendance ? criteriaWeights.attendance : 0,
                spp: criteriaVisible.spp ? criteriaWeights.spp : 0,
                discipline: criteriaVisible.discipline ? criteriaWeights.discipline : 0,
                library: criteriaVisible.library ? criteriaWeights.library : 0
            };
            const totalW = (activeW.attendance + activeW.spp + activeW.discipline + activeW.library) || 100;
            const normW = {
                attendance: activeW.attendance / totalW,
                spp: activeW.spp / totalW,
                discipline: activeW.discipline / totalW,
                library: activeW.library / totalW
            };

            // 0. Ambil rentang semester aktif & bulan target SPP (SSOT Ranking Kelas)
            const todayIso = (window.getWitaISODate && typeof window.getWitaISODate === 'function')
                ? window.getWitaISODate()
                : (window.getLocalISODate ? window.getLocalISODate(new Date()) : new Date().toISOString().substring(0, 10));
            const now = new Date(todayIso);
            const currentYear = now.getFullYear();
            const currentMonth = now.getMonth() + 1;
            const semRange = typeof getCurrentSemesterRange === 'function' ? getCurrentSemesterRange(now) : { startDate: `${currentYear}-07-01` };
            const startStr = semRange.startDate || (currentMonth >= 7 ? `${currentYear}-07-01` : `${currentYear}-01-01`);

            const expectedSppMonths = [];
            if (currentMonth >= 7) {
                for (let m = 7; m <= currentMonth; m++) expectedSppMonths.push({ year: currentYear, month: m });
            } else {
                for (let m = 1; m <= currentMonth; m++) expectedSppMonths.push({ year: currentYear, month: m });
            }
            if (expectedSppMonths.length === 0) expectedSppMonths.push({ year: currentYear, month: currentMonth });

            const relevantYears = [...new Set(expectedSppMonths.map(item => item.year))];
            const needSppFetch = !sppData?.paidRecords && supabase && typeof window.fetchAllSupabaseRows === 'function';

            // Ambil agregat BK D1, sirkulasi perpustakaan, & transaksi SPP (bila diperlukan) secara paralel
            const [bkRes, libRes, sppRes] = await Promise.allSettled([
                window.cfClient && typeof window.cfClient.getClassRecordAggregates === 'function'
                    ? window.cfClient.getClassRecordAggregates({ date_start: startStr, date_end: todayIso })
                    : Promise.resolve(null),
                supabase && typeof window.fetchAllSupabaseRows === 'function'
                    ? window.fetchAllSupabaseRows(
                        supabase,
                        'lib_sirkulasi',
                        q => q.gte('tgl_pinjam', startStr).lte('tgl_pinjam', todayIso).eq('peminjam_type', 'siswa'),
                        { selectFields: 'id, peminjam_id, peminjam_kelas' }
                    ).then(r => r.data || []).catch(() => [])
                    : Promise.resolve([]),
                needSppFetch
                    ? window.fetchAllSupabaseRows(
                        supabase,
                        'finance_transactions',
                        q => q.in('year', relevantYears).neq('type', 'manual_debt'),
                        { selectFields: 'student_nis, year, month, type' }
                    ).then(r => r.data || []).catch(() => [])
                    : Promise.resolve([])
            ]);

            const bkAggregates = bkRes.status === 'fulfilled' ? bkRes.value : null;
            const libRows = libRes.status === 'fulfilled' ? libRes.value : [];
            const sppRows = sppRes.status === 'fulfilled' ? sppRes.value : [];

            // Peta transaksi pembayaran SPP
            const paidKeySet = new Set();
            if (sppData?.paidRecords) {
                Object.keys(sppData.paidRecords).forEach(k => {
                    const r = sppData.paidRecords[k];
                    if (r && r.type !== 'manual_debt') paidKeySet.add(k);
                });
            }
            if (Array.isArray(sppRows)) {
                sppRows.forEach(trx => {
                    const nis = String(trx.student_nis || '').trim();
                    const yr = Number(trx.year);
                    const mo = Number(trx.month);
                    if (nis && yr && mo) paidKeySet.add(`${nis}_${yr}_${mo}`);
                });
            }

            // Peta sirkulasi perpustakaan
            const libBorrowMap = {};
            if (Array.isArray(libRows)) {
                const seenCirc = new Set();
                libRows.forEach(circ => {
                    if (circ.id && seenCirc.has(String(circ.id))) return;
                    if (circ.id) seenCirc.add(String(circ.id));
                    let c = String(circ.peminjam_kelas || '').replace(/^Kelas\s+/i, '').trim();
                    if (!c && circ.peminjam_id) {
                        const foundSt = (activeStudents || []).find(s => s.nis === circ.peminjam_id);
                        if (foundSt) c = String(foundSt.class || '').replace(/^Kelas\s+/i, '').trim();
                    }
                    if (c) {
                        libBorrowMap[c] = (libBorrowMap[c] || 0) + 1;
                    }
                });
            }

            const rankedList = [];

            classList.forEach(cls => {
                const cleanCls = String(cls).replace(/^Kelas\s+/i, '').trim();

                // 1. Wali Kelas
                let waliObj = null;
                if (typeof waliMap.get === 'function') {
                    waliObj = waliMap.get(cleanCls) || waliMap.get(`Kelas ${cleanCls}`) || waliMap.get(cls) || null;
                } else if (waliMap) {
                    waliObj = waliMap[cleanCls] || waliMap[`Kelas ${cleanCls}`] || waliMap[cls] || null;
                }
                let waliPhoto = waliObj?.photo || null;
                const waliTeacher = (waliObj && teachersMap)
                    ? ((waliObj.nip && teachersMap.get(waliObj.nip)) || (waliObj.name && teachersMap.get(waliObj.name.toLowerCase().trim())) || null)
                    : null;
                if (!waliPhoto && waliTeacher) {
                    const t = waliTeacher;
                    if (t?.foto || t?.photo || t?.photo_url || t?.avatar) {
                        waliPhoto = t.foto || t.photo || t.photo_url || t.avatar;
                    }
                }
                const waliId = waliObj?.id || waliObj?.teacher_id || waliTeacher?.id || '';

                // 2. Presensi Kelas (Semester Berjalan)
                const att = (semesterClassAttMap && (semesterClassAttMap[cls] || semesterClassAttMap[cleanCls] || semesterClassAttMap[`Kelas ${cleanCls}`])) 
                         || (classAttMap && (classAttMap[cls] || classAttMap[cleanCls] || classAttMap[`Kelas ${cleanCls}`])) 
                         || { H: 0, S: 0, I: 0, D: 0, A: 0 };
                let attRate = 0;
                const totalAtt = (att.H || 0) + (att.S || 0) + (att.I || 0) + (att.D || 0) + (att.A || 0);
                if (totalAtt > 0) {
                    if (typeof window.calculateAttendanceStats === 'function') {
                        const s = window.calculateAttendanceStats(att);
                        attRate = s.attPct || 0;
                    } else {
                        attRate = parseFloat((((att.H + att.D) / totalAtt) * 100).toFixed(1));
                    }
                }

                // 3. SPP Kelas (SSOT Presisi: Rasio bulan lunas terhadap target bulan semester berjalan)
                const studentsInCls = classStudentsMap[cls] || [];
                const totalStudentsInCls = studentsInCls.length || 1;
                let sppPaidCount = 0;
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
                        sppPaidCount++;
                    }
                });
                const maxPossibleMonths = totalStudentsInCls * totalExpectedMonths;
                const sppRate = maxPossibleMonths > 0
                    ? Number(((totalPaidMonthsInClass / maxPossibleMonths) * 100).toFixed(1))
                    : 0;

                // 4. Disiplin BK Kelas (SSOT Presisi: Membaca camelCase & snake_case Cloudflare D1)
                let discScore = 100;
                let violCount = 0;
                let permCount = 0;
                let achPoints = 0;
                const agg = bkAggregates ? (bkAggregates[cls] || bkAggregates[cleanCls]) : null;
                if (agg) {
                    violCount = Number(agg.violationPoints || agg.points || agg.violationCount || agg.violation_count || 0);
                    permCount = Number(agg.permissionCount || agg.permission_count || 0);
                    achPoints = Number(agg.achievementPoints || agg.achievementCount || agg.achievement_count || 0);
                } else if (Array.isArray(violations)) {
                    violations.forEach(v => {
                        const nis = v.studentNIS || v.student_nis;
                        const st = studentsInCls.find(s => s.nis === nis);
                        if (st) {
                            const cat = String(v.category || '').toLowerCase();
                            if (cat.includes('pelanggaran')) violCount += (Number(v.points) || 1);
                            else if (cat.includes('permisi')) permCount += 1;
                            else if (cat.includes('prestasi')) achPoints += (Number(v.points) || 1);
                        }
                    });
                }
                const avgPenalty = Number(((violCount / totalStudentsInCls) * 10).toFixed(1));
                const permPenalty = Number(((permCount / totalStudentsInCls) * 2).toFixed(1));
                const achBonus = Math.min(Number(((achPoints / totalStudentsInCls) * 3).toFixed(1)), 15);
                discScore = Number(Math.max(0, Math.min(100, 100 - avgPenalty - permPenalty + achBonus)).toFixed(1));

                // 5. Literasi Perpustakaan (SSOT Presisi)
                const libBorrowCount = libBorrowMap[cleanCls] || libBorrowMap[cls] || 0;
                const libScore = Math.min(libBorrowCount * 5, 100);

                // 6. Skor Indeks Komprehensif (Bintang SMAGESA)
                const overallScore = Number((
                    (attRate * normW.attendance) +
                    (sppRate * normW.spp) +
                    (discScore * normW.discipline) +
                    (libScore * normW.library)
                ).toFixed(1));

                rankedList.push({
                    className: cls,
                    wali: {
                        name: waliObj?.name || 'Wali Belum Diatur',
                        nip: waliObj?.nip || '',
                        id: waliId,
                        photo: waliPhoto
                    },
                    overallScore,
                    attendance: { rate: attRate },
                    spp: { rate: sppRate, paidCount: sppPaidCount, totalCount: totalStudentsInCls },
                    discipline: { score: discScore, violationsCount: violCount, permissionCount: permCount, achievementPoints: achPoints },
                    library: { borrowCount: libBorrowCount, score: libScore },
                    totalStudents: totalStudentsInCls
                });
            });

            // Urutkan peringkat berdasarkan overallScore DESC dengan tie-breaker akurat SSOT
            rankedList.sort((a, b) => {
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

            rankedList.forEach((item, idx) => {
                item.rank = idx + 1;
            });

            rankingData = {
                timestamp: Date.now(),
                periodScope: 'semester',
                isDataComplete: true,
                totalClasses: classList.length,
                bestOverall: rankedList[0] || null,
                topFive: rankedList.slice(0, 5),
                rankedList
            };

            try {
                const serialized = JSON.stringify(rankingData);
                localStorage.setItem('simas_class_ranking_summary_cache', serialized);
                sessionStorage.setItem('simas_class_ranking_summary_cache', serialized);
            } catch (_) {}

        } catch (err) {
            console.error('[Dashboard Kepsek] Gagal mengkalkulasi ringkasan ranking:', err);
        }
    }

    // 3. Render ke Antarmuka Pengguna
    if (!rankingData || !Array.isArray(rankingData.rankedList) || rankingData.rankedList.length === 0) {
        if (loadingEl) {
            loadingEl.innerHTML = `
                <div class="p-6 text-center text-slate-400">
                    <i class="fa-solid fa-triangle-exclamation text-amber-500 text-xl mb-2"></i>
                    <p class="text-xs">Data ranking kelas belum tersedia saat ini.</p>
                    <a href="ranking-kelas.html" class="inline-flex items-center gap-1.5 mt-3 text-xs font-bold text-amber-600 hover:underline">
                        Buka Papan Ranking Lengkap <i class="fa-solid fa-arrow-right text-[10px]"></i>
                    </a>
                </div>
            `;
        }
        return;
    }

    const { rankedList, totalClasses } = rankingData;
    const topThree = rankedList.slice(0, 3);
    const topFive = rankedList.slice(0, 5);

    // Helper render avatar wali kelas
    const renderWaliAvatar = (photo, name, waliId = '') => {
        const initial = (name || 'W').charAt(0).toUpperCase();
        let inner;
        if (photo && typeof photo === 'string' && photo.trim()) {
            const resolvedUrl = (typeof window.resolvePhotoUrl === 'function') ? window.resolvePhotoUrl(photo) : photo;
            inner = `<img src="${resolvedUrl}" alt="${name || 'Wali Kelas'}" class="w-8 h-8 rounded-full object-cover border border-amber-300 dark:border-amber-700 shadow-2xs shrink-0" onerror="this.outerHTML='<div class=\\'w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 font-bold flex items-center justify-center text-xs shrink-0\\'>${initial}</div>'">`;
        } else {
            inner = `<div class="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 font-bold flex items-center justify-center text-xs shrink-0">${initial}</div>`;
        }
        if (!waliId) return inner;
        // Pembungkus stabil agar penanda VIP (js/vip-manager.js) tetap utuh saat onerror mengganti <img>
        const safeId = window.escapeHTML ? window.escapeHTML(String(waliId)) : String(waliId);
        return `<div class="w-8 h-8 shrink-0 inline-flex" data-vip-ptk-id="${safeId}" data-vip-size="vip-avatar-sm">${inner}</div>`;
    };

    // Render 3 Kartu Juara Podium
    if (podiumEl) {
        const podiumConfig = [
            {
                badgeText: 'Juara 1 (Emas)',
                badgeClass: 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-400/30',
                iconClass: 'fa-solid fa-crown text-amber-500',
                borderClass: 'border-amber-400/40 dark:border-amber-500/40 hover:border-amber-500',
                bgGradient: 'bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent',
                accentText: 'text-amber-600 dark:text-amber-400'
            },
            {
                badgeText: 'Juara 2 (Perak)',
                badgeClass: 'bg-slate-400/20 text-slate-700 dark:text-slate-300 border-slate-300/40',
                iconClass: 'fa-solid fa-medal text-slate-400',
                borderClass: 'border-slate-200 dark:border-slate-700 hover:border-slate-400',
                bgGradient: 'bg-gradient-to-br from-slate-100/50 via-slate-50/20 to-transparent dark:from-slate-800/40 dark:via-slate-800/10',
                accentText: 'text-slate-700 dark:text-slate-200'
            },
            {
                badgeText: 'Juara 3 (Perunggu)',
                badgeClass: 'bg-amber-700/20 text-amber-800 dark:text-amber-300 border-amber-600/30',
                iconClass: 'fa-solid fa-award text-amber-700 dark:text-amber-400',
                borderClass: 'border-amber-600/30 dark:border-amber-700/40 hover:border-amber-600',
                bgGradient: 'bg-gradient-to-br from-amber-700/10 via-amber-600/5 to-transparent dark:from-amber-900/20 dark:via-amber-950/10',
                accentText: 'text-amber-800 dark:text-amber-300'
            }
        ];

        podiumEl.innerHTML = topThree.map((item, idx) => {
            const cfg = podiumConfig[idx] || podiumConfig[2];
            const waliName = item.wali?.name || 'Wali Kelas Belum Diatur';
            const waliPhoto = item.wali?.photo || null;

            return `
                <div onclick="window.location.href='ranking-kelas.html'"
                    class="stat-card-premium ${cfg.bgGradient} border ${cfg.borderClass} backdrop-blur-sm rounded-2xl p-4 shadow-2xs hover:shadow-md transition-all duration-200 cursor-pointer group flex flex-col justify-between relative overflow-hidden"
                    title="Klik untuk membuka Papan Ranking Kelas (Rombel ${item.className})">
                    <div>
                        <!-- Header Kartu -->
                        <div class="flex items-center justify-between gap-2 mb-2">
                            <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${cfg.badgeClass}">
                                <i class="${cfg.iconClass}"></i> ${cfg.badgeText}
                            </span>
                            <div class="flex items-center gap-1 text-xs font-black text-amber-500">
                                <i class="fa-solid fa-star text-[11px]"></i>
                                <span class="text-sm font-black text-slate-800 dark:text-slate-100">${(item.overallScore || 0).toFixed(1)}</span>
                            </div>
                        </div>

                        <!-- Nama Kelas & Wali -->
                        <div class="flex items-center gap-2.5 my-2">
                            ${renderWaliAvatar(waliPhoto, waliName, item.wali?.id)}
                            <div class="min-w-0 flex-1">
                                <h4 class="text-base sm:text-lg font-black text-slate-800 dark:text-slate-100 tracking-tight leading-tight group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                                    Kelas ${item.className}
                                </h4>
                                <p class="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                                    ${waliName}
                                </p>
                            </div>
                        </div>
                    </div>

                    <!-- Mini Pilar Breakdown -->
                    <div class="grid grid-cols-3 gap-1.5 pt-3 border-t border-slate-100 dark:border-slate-800/80 text-center text-xs">
                        <div class="bg-white/60 dark:bg-slate-900/60 rounded-xl p-1.5 border border-slate-100/80 dark:border-slate-800/60">
                            <span class="text-[9px] uppercase font-bold text-slate-400 block">Presensi</span>
                            <span class="text-xs font-black text-emerald-600 dark:text-emerald-400">${item.attendance?.rate || 0}%</span>
                        </div>
                        <div class="bg-white/60 dark:bg-slate-900/60 rounded-xl p-1.5 border border-slate-100/80 dark:border-slate-800/60">
                            <span class="text-[9px] uppercase font-bold text-slate-400 block">SPP</span>
                            <span class="text-xs font-black text-blue-600 dark:text-blue-400">${item.spp?.rate || 0}%</span>
                        </div>
                        <div class="bg-white/60 dark:bg-slate-900/60 rounded-xl p-1.5 border border-slate-100/80 dark:border-slate-800/60">
                            <span class="text-[9px] uppercase font-bold text-slate-400 block">Disiplin</span>
                            <span class="text-xs font-black text-purple-600 dark:text-purple-400">${item.discipline?.score !== undefined ? item.discipline.score : 100}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // Render Tabel 5 Besar Rombel Terbaik
    if (tableBodyEl) {
        tableBodyEl.innerHTML = topFive.map(item => {
            const waliName = item.wali?.name || 'Wali Kelas Belum Diatur';
            const waliPhoto = item.wali?.photo || null;

            let rankBadge = '';
            if (item.rank === 1) {
                rankBadge = '<span class="w-6 h-6 rounded-full bg-amber-500 text-white font-black text-xs flex items-center justify-center shadow-xs mx-auto"><i class="fa-solid fa-crown text-[10px]"></i></span>';
            } else if (item.rank === 2) {
                rankBadge = '<span class="w-6 h-6 rounded-full bg-slate-400 text-white font-black text-xs flex items-center justify-center shadow-xs mx-auto">2</span>';
            } else if (item.rank === 3) {
                rankBadge = '<span class="w-6 h-6 rounded-full bg-amber-700 text-white font-black text-xs flex items-center justify-center shadow-xs mx-auto">3</span>';
            } else {
                rankBadge = `<span class="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold text-xs flex items-center justify-center mx-auto">${item.rank}</span>`;
            }

            return `
                <tr onclick="window.location.href='ranking-kelas.html'"
                    class="hover:bg-amber-50/50 dark:hover:bg-amber-950/20 cursor-pointer transition-colors group"
                    title="Klik untuk melihat detail ranking kelas ${item.className}">
                    <td class="py-2.5 px-3 text-center">
                        ${rankBadge}
                    </td>
                    <td class="py-2.5 px-3">
                        <div class="flex items-center gap-2.5">
                            ${renderWaliAvatar(waliPhoto, waliName, item.wali?.id)}
                            <div class="min-w-0">
                                <span class="font-bold text-slate-800 dark:text-slate-100 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                                    Kelas ${item.className}
                                </span>
                                <span class="block text-[10.5px] text-slate-400 truncate">${waliName}</span>
                            </div>
                        </div>
                    </td>
                    <td class="py-2.5 px-3 text-center font-bold">
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200/50 dark:border-amber-800/40">
                            <i class="fa-solid fa-star text-[10px] text-amber-500"></i>
                            <span>${(item.overallScore || 0).toFixed(1)}</span>
                        </span>
                    </td>
                    <td class="py-2.5 px-3 text-center">
                        <span class="font-bold text-emerald-600 dark:text-emerald-400">${item.attendance?.rate || 0}%</span>
                    </td>
                    <td class="py-2.5 px-3 text-center">
                        <span class="font-bold text-blue-600 dark:text-blue-400">${item.spp?.rate || 0}%</span>
                    </td>
                    <td class="py-2.5 px-3 text-center">
                        <span class="font-bold text-purple-600 dark:text-purple-400">${item.discipline?.score !== undefined ? item.discipline.score : 100}</span>
                    </td>
                    <td class="py-2.5 px-3 text-center">
                        <a href="ranking-kelas.html"
                            class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-100/60 dark:bg-amber-900/40 group-hover:bg-amber-500 group-hover:text-white transition-all shadow-2xs">
                            <span>Detail</span>
                            <i class="fa-solid fa-arrow-right text-[9px]"></i>
                        </a>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // Update info jumlah rombel aktif
    if (totalInfoEl) {
        totalInfoEl.innerText = `Menampilkan 5 besar rombel terbaik dari total ${totalClasses || rankedList.length} kelas aktif`;
    }

    // Tampilkan kontainer konten dan sembunyikan loader
    if (loadingEl) loadingEl.classList.add('hidden');
    if (contentEl) contentEl.classList.remove('hidden');
}

window.loadAndRenderExecutiveRankingSummary = loadAndRenderExecutiveRankingSummary;

function renderGradeAttendanceBarChart(gradeAttMap) {
    const ctx = document.getElementById('gradeAttendanceChart').getContext('2d');
    if (window.myGradeAttChart) window.myGradeAttChart.destroy();

    const grades = ['X', 'XI', 'XII'];
    const datasets = grades.map(grade => {
        const att = gradeAttMap[grade];
        const total = att.H + att.S + att.I + att.D + att.A;
        return total > 0 ? parseFloat(((att.H + att.D) / total * 100).toFixed(1)) : 0;
    });

    const isDark = document.documentElement.classList.contains('dark');
    const textColor = isDark ? '#94a3b8' : '#64748b';

    window.myGradeAttChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Kelas X', 'Kelas XI', 'Kelas XII'],
            datasets: [{
                label: 'Persentase Kehadiran (%)',
                data: datasets,
                backgroundColor: ['#3b82f6', '#10b981', '#8b5cf6'],
                borderRadius: 8,
                borderWidth: 0,
                barThickness: 32
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    min: 0,
                    max: 100,
                    ticks: { color: textColor, font: { size: 10 } },
                    grid: { color: isDark ? 'rgba(51, 65, 85, 0.3)' : '#f1f5f9' }
                },
                x: {
                    ticks: { color: textColor, font: { size: 11, weight: 'bold' } },
                    grid: { display: false }
                }
            }
        }
    });
}

function renderTopClassesAttendance(classAttMap) {
    const classList = [];
    Object.keys(classAttMap).forEach(cls => {
        const att = classAttMap[cls];
        const stats = typeof window.calculateAttendanceStats === 'function'
            ? window.calculateAttendanceStats(att)
            : { total: att.H + att.S + att.I + att.D + att.A, attPct: 0 };
        if (stats.total > 0) {
            const percent = stats.attPct !== undefined ? stats.attPct : parseFloat(((att.H + att.D) / stats.total * 100).toFixed(1));
            classList.push({ cls, percent, total: stats.total });
        }
    });

    const bestContainer = document.getElementById('attendance-best-classes');
    const worstContainer = document.getElementById('attendance-worst-classes');
    if (!bestContainer || !worstContainer) return;

    // Cek apakah ada data kehadiran aktif (> 0%)
    const hasValidAttendance = classList.some(item => item.percent > 0);
    if (!hasValidAttendance || classList.length === 0) {
        bestContainer.innerHTML = '<p class="text-xs text-slate-400 italic py-1">Belum ada presensi tercatat di semester ini</p>';
        worstContainer.innerHTML = '<p class="text-xs text-slate-400 italic py-1">Belum ada presensi tercatat di semester ini</p>';
        return;
    }

    // Tentukan threshold minimum record agar kelas baru / anomali sedikit data tidak mendistorsi ranking (Poin 3)
    const maxTotal = classList.reduce((max, item) => Math.max(max, item.total), 0);
    const minThreshold = maxTotal >= 10 ? Math.min(5, Math.floor(maxTotal * 0.1) || 3) : 1;
    const qualifiedClasses = classList.filter(item => item.total >= minThreshold);
    const candidateList = qualifiedClasses.length >= 3 ? qualifiedClasses : classList;

    // Urutkan kelas dari persentase tertinggi ke terendah
    candidateList.sort((a, b) => b.percent - a.percent);

    // Ambil Top 3 Terbaik & Top 3 Terburuk
    const best = candidateList.slice(0, 3);
    const worst = candidateList.length <= 3 ? [...candidateList].reverse() : candidateList.slice(-3).reverse();

    // Render ke UI
    let bestHTML = '';
    best.forEach(item => {
        bestHTML += `
            <a href="presensi.html#type=semester&class=${encodeURIComponent(item.cls)}" title="Buka detail presensi kelas ${item.cls}" class="flex items-center justify-between text-xs p-1 -mx-1 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors group">
                <span class="font-bold text-slate-700 dark:text-slate-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors flex items-center gap-1.5">
                    ${item.cls}
                    <i class="fa-solid fa-arrow-up-right-from-square text-[9px] opacity-0 group-hover:opacity-100 transition-opacity"></i>
                </span>
                <div class="flex items-center gap-3 flex-1 justify-end max-w-[150px]">
                    <div class="w-full bg-slate-100 dark:bg-slate-800 h-1 rounded-full overflow-hidden">
                        <div class="bg-emerald-500 h-full rounded-full" style="width: ${item.percent}%"></div>
                    </div>
                    <span class="font-black text-emerald-600 dark:text-emerald-400 min-w-[45px] text-right">${item.percent}%</span>
                </div>
            </a>
        `;
    });
    bestContainer.innerHTML = bestHTML;

    let worstHTML = '';
    worst.forEach(item => {
        worstHTML += `
            <a href="presensi.html#type=semester&class=${encodeURIComponent(item.cls)}" title="Buka detail presensi kelas ${item.cls}" class="flex items-center justify-between text-xs p-1 -mx-1 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors group">
                <span class="font-bold text-slate-700 dark:text-slate-200 group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors flex items-center gap-1.5">
                    ${item.cls}
                    <i class="fa-solid fa-arrow-up-right-from-square text-[9px] opacity-0 group-hover:opacity-100 transition-opacity"></i>
                </span>
                <div class="flex items-center gap-3 flex-1 justify-end max-w-[150px]">
                    <div class="w-full bg-slate-100 dark:bg-slate-800 h-1 rounded-full overflow-hidden">
                        <div class="bg-rose-500 h-full rounded-full" style="width: ${item.percent}%"></div>
                    </div>
                    <span class="font-black text-rose-600 dark:text-rose-400 min-w-[45px] text-right">${item.percent}%</span>
                </div>
            </a>
        `;
    });
    worstContainer.innerHTML = worstHTML;
}

function renderViolationTrendLineChart(violations) {
    const ctx = document.getElementById('violationTrendChart').getContext('2d');
    if (window.myVioTrendChart) window.myVioTrendChart.destroy();

    // Daftar bulan akademik (Juli s.d. Juni)
    const monthsAcademic = [
        { index: 6, label: 'Jul' },
        { index: 7, label: 'Agu' },
        { index: 8, label: 'Sep' },
        { index: 9, label: 'Okt' },
        { index: 10, label: 'Nov' },
        { index: 11, label: 'Des' },
        { index: 0, label: 'Jan' },
        { index: 1, label: 'Feb' },
        { index: 2, label: 'Mar' },
        { index: 3, label: 'Apr' },
        { index: 4, label: 'Mei' },
        { index: 5, label: 'Jun' }
    ];

    // Tentukan bulan akademik saat ini agar bulan masa depan diisi null (bukan 0 semu)
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentAyIdx = monthsAcademic.findIndex(item => item.index === currentMonth);

    // Inisialisasi counter: isi 0 untuk bulan berjalan/sudah lewat, dan null untuk bulan yang belum tiba
    const counts = monthsAcademic.map((item, idx) => {
        return (currentAyIdx !== -1 && idx <= currentAyIdx) ? 0 : null;
    });

    (violations || []).forEach(v => {
        const d = new Date(v.timestampMillis);
        const m = d.getMonth();
        
        // Cari index bulan akademik
        const idx = monthsAcademic.findIndex(item => item.index === m);
        if (idx !== -1 && counts[idx] !== null) {
            counts[idx]++;
        }
    });

    const isDark = document.documentElement.classList.contains('dark');
    const textColor = isDark ? '#94a3b8' : '#64748b';

    // Gradient background di bawah garis
    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, 'rgba(239, 68, 68, 0.2)');
    gradient.addColorStop(1, 'rgba(239, 68, 68, 0)');

    window.myVioTrendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: monthsAcademic.map(item => item.label),
            datasets: [{
                label: 'Kasus Pelanggaran',
                data: counts,
                borderColor: '#ef4444',
                backgroundColor: gradient,
                borderWidth: 3,
                tension: 0.3,
                fill: true,
                spanGaps: false,
                pointBackgroundColor: '#ef4444',
                pointHoverRadius: 6,
                pointRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            if (context.raw === null || context.raw === undefined) {
                                return ' Belum ada data (bulan belum berjalan)';
                            }
                            return ` Kasus Pelanggaran: ${context.raw}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { stepSize: 1, color: textColor, font: { size: 10 } },
                    grid: { color: isDark ? 'rgba(51, 65, 85, 0.3)' : '#f1f5f9' }
                },
                x: {
                    ticks: { color: textColor, font: { size: 10 } },
                    grid: { display: false }
                }
            }
        }
    });
}

function renderViolationHeatmap(violations) {
    const days = [
        { index: 1, label: 'Senin' },
        { index: 2, label: 'Selasa' },
        { index: 3, label: 'Rabu' },
        { index: 4, label: 'Kamis' },
        { index: 5, label: 'Jumat' }
    ];

    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    violations.forEach(v => {
        const d = new Date(v.timestampMillis);
        const dayIdx = d.getDay();
        if (dayIdx >= 1 && dayIdx <= 5) {
            counts[dayIdx]++;
        }
    });

    const container = document.getElementById('violations-heatmap-container');
    let html = '';

    const maxCount = Math.max(...Object.values(counts), 1);

    days.forEach(day => {
        const count = counts[day.index];
        const ratio = count / maxCount;

        let bgClass = 'bg-emerald-500/10 dark:bg-emerald-950/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20';
        if (count > 0) {
            if (ratio <= 0.3) {
                bgClass = 'bg-amber-500/20 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 border-amber-500/30';
            } else if (ratio <= 0.7) {
                bgClass = 'bg-rose-500/40 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 border-rose-500/40';
            } else {
                bgClass = 'bg-rose-600 text-white border-transparent';
            }
        }

        html += `
            <div class="p-3.5 border rounded-xl flex flex-col justify-between items-center transition shadow-sm ${bgClass}">
                <span class="text-[9px] font-bold uppercase tracking-wider opacity-80">${day.label}</span>
                <h5 class="text-lg font-black mt-2 leading-none">${count}</h5>
                <span class="text-[8px] font-medium opacity-70 mt-1.5">kasus</span>
            </div>
        `;
    });

    container.innerHTML = html;
}

let FINANCE_RATES_CACHE = null;

async function getFinanceRatesWithCache() {
    if (FINANCE_RATES_CACHE) return FINANCE_RATES_CACHE;
    try {
        const data = await window.getFinanceRatesCache();
        if (data && Object.keys(data).length > 0) {
            FINANCE_RATES_CACHE = data;
            return FINANCE_RATES_CACHE;
        }
    } catch (e) {
        console.error("Gagal load finance_rates:", e);
    }
    return { X: 70000, XI: 65000, XII: 65000 };
}

function calculateCohort(className) {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const academicYearStart = currentMonth >= 6 ? currentYear : currentYear - 1;

    if (className.toLowerCase().includes('alumni')) {
        const match = className.match(/(\d{4})\/(\d{4})/);
        if (match) {
            const endAcademicYear = parseInt(match[2]);
            const startYear = endAcademicYear - 3;
            const endYear = startYear + 2;
            return { startYear, endYear };
        }
        return { startYear: currentYear - 3, endYear: currentYear - 1 };
    }

    let offset = 0;
    if (className.startsWith("XII")) offset = 2;
    else if (className.startsWith("XI")) offset = 1;
    else offset = 0;

    const startYear = academicYearStart - offset;
    const endYear = startYear + 2;
    return { startYear, endYear };
}

function getRateForStudent(student, ratesConfig, y, m) {
    if (!student || !student.class) return 0;
    const cohort = calculateCohort(student.class);
    
    // Ajaran baru dimulai bulan Juli (7)
    const academicYearOfPeriod = (m >= 7) ? y : y - 1;
    const diff = academicYearOfPeriod - cohort.startYear;
    
    let targetGrade = "X";
    if (diff === 1) targetGrade = "XI";
    else if (diff === 2) targetGrade = "XII";
    
    const cohortYearStr = String(cohort.startYear);
    
    if (ratesConfig && ratesConfig.cohorts && ratesConfig.cohorts[cohortYearStr]) {
        const cohortObj = ratesConfig.cohorts[cohortYearStr];
        if (cohortObj[targetGrade] !== undefined) {
            return cohortObj[targetGrade];
        }
        const availableRates = Object.values(cohortObj).filter(v => typeof v === 'number');
        if (availableRates.length > 0) {
            return availableRates[0];
        }
    }
    
    return (ratesConfig && ratesConfig[targetGrade]) || 0;
}

let cachedFrozenMigration = null;

async function getVirtualMigrationEntries(targetYear) {
    if (targetYear !== 2026) return [];
    if (cachedFrozenMigration) return cachedFrozenMigration;

    const virtualDates = ["2026-01-20", "2026-02-20", "2026-03-20", "2026-04-20", "2026-05-20", "2026-06-20"];
    try {
        initSupabase();
        if (supabase) {
            const { data: sbRows, error: sbErr } = await supabase
                .from('finance_daily_summary')
                .select('*')
                .in('id', virtualDates)
                .eq('is_migration', true);

            if (!sbErr && Array.isArray(sbRows) && sbRows.length === 6) {
                console.log("[Virtual Migration] Menggunakan data beku dari Supabase finance_daily_summary untuk dashboard.");
                cachedFrozenMigration = sbRows.map(r => {
                    const dStr = r.date_str || r.id;
                    const m = parseInt(dStr.split('-')[1], 10);
                    return {
                        dateStr: dStr,
                        amount: Number(r.total_amount) || 0,
                        count: Number(r.transaction_count) || 0,
                        month: m
                    };
                }).sort((a, b) => a.month - b.month);
                return cachedFrozenMigration;
            }
        }
    } catch (e) {
        console.warn("[Virtual Migration] Gagal memuat data beku dari Supabase:", e);
    }
    return [];
}

function applySppUI(data) {
    if (!data) return;
    const monthLabelEl = document.getElementById('spp-month-label');
    if (monthLabelEl) monthLabelEl.innerText = data.monthLabel || 'Bulan Berjalan';

    const sppMonthRealisasiEl = document.getElementById('spp-month-realisasi');
    if (sppMonthRealisasiEl) sppMonthRealisasiEl.innerText = `Rp ${Number(data.realisasiBulanIni || 0).toLocaleString('id-ID')}`;

    const sppMonthTargetEl = document.getElementById('spp-month-target');
    if (sppMonthTargetEl) sppMonthTargetEl.innerText = `Rp ${Number(data.targetBulanan || 0).toLocaleString('id-ID')}`;

    const sppMonthKekuranganEl = document.getElementById('spp-month-kekurangan');
    if (sppMonthKekuranganEl) sppMonthKekuranganEl.innerText = `Rp ${Number(data.monthKekurangan || 0).toLocaleString('id-ID')}`;

    const sppMonthPercentEl = document.getElementById('spp-month-percent');
    if (sppMonthPercentEl) sppMonthPercentEl.innerText = `${data.monthPercent || 0}%`;

    const sppRealisasiAmountEl = document.getElementById('spp-realisasi-amount');
    if (sppRealisasiAmountEl) sppRealisasiAmountEl.innerText = `Rp ${Number(data.totalRealisasiTahunan || 0).toLocaleString('id-ID')}`;

    const sppTargetAmountEl = document.getElementById('spp-target-amount');
    if (sppTargetAmountEl) sppTargetAmountEl.innerText = `Rp ${Number(data.totalTargetTahunan || 0).toLocaleString('id-ID')}`;

    const sppKekuranganAmountEl = document.getElementById('spp-kekurangan-amount');
    if (sppKekuranganAmountEl) sppKekuranganAmountEl.innerText = `Rp ${Number(data.kekuranganTahunan || 0).toLocaleString('id-ID')}`;

    const sppYearPercentEl = document.getElementById('spp-year-percent');
    if (sppYearPercentEl) sppYearPercentEl.innerText = `${data.percentTahunan || 0}%`;

    const sppProgressPercentEl = document.getElementById('spp-progress-percent');
    if (sppProgressPercentEl) sppProgressPercentEl.innerText = `${data.monthPercent || 0}%`;

    const circle = document.getElementById('spp-progress-bar');
    if (circle) {
        const circumference = 439.82;
        const offset = circumference - ((data.monthPercent || 0) / 100) * circumference;
        circle.setAttribute('stroke-dashoffset', offset);
    }

    // Actionable SPP metrics: Penunggak & Tunggakan Terbesar
    const elUnpaid = document.getElementById('spp-unpaid-students-count');
    if (elUnpaid) elUnpaid.innerText = `${(data.unpaidStudentsCount || 0).toLocaleString('id-ID')} siswa`;

    const elTopDebtClass = document.getElementById('spp-top-debt-class');
    if (elTopDebtClass) elTopDebtClass.innerText = data.topDebtClass || '-';

    const elTopDebtAmount = document.getElementById('spp-top-debt-amount');
    if (elTopDebtAmount) elTopDebtAmount.innerText = `(Rp ${(data.topDebtAmount || 0).toLocaleString('id-ID')})`;
}

async function renderSppProgressRing(activeStudents, forceRefresh = false) {
    try {
        // Cek Cache Supabase SPP (Hemat Kuota Free-tier & Cepat)
        const cachedSpp = !forceRefresh && typeof window.getLocalCache === 'function'
            ? window.getLocalCache(SPP_PROGRESS_CACHE_KEY, SPP_PROGRESS_TTL)
            : null;

        if (cachedSpp && cachedSpp.paidRecords) {
            applySppUI(cachedSpp);
            return cachedSpp;
        }

        const ratesConfig = await getFinanceRatesWithCache();
        const startAcademicYear = getAcademicYearStart();
        const startYear = startAcademicYear.getFullYear();

        // Tentukan Bulan Berjalan
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1; // 1 - 12
        const monthNamesIndo = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
        const currentMonthName = monthNamesIndo[now.getMonth()];
        const currentYearMonthStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
        const currentMonthStart = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;

        // 1. Fetch Riwayat Pembayaran Transaksi per Siswa Aktif dari Supabase
        const SYSTEM_START_DATE = new Date(2026, 6, 1);
        const systemDueDate = 20;
        const activeNISList = activeStudents.map(s => s.nis).filter(Boolean);
        const paidRecords = {};

        if (activeNISList.length > 0) {
            initSupabase();
            if (!supabase) throw new Error('Supabase client belum siap');

            const { data, error } = await window.fetchAllSupabaseRows(
                supabase,
                'finance_transactions',
                q => q.in('student_nis', activeNISList),
                { selectFields: 'student_nis, year, month, amount, type, date_str' }
            );

            if (error) {
                console.error('[Dashboard] Error fetch finance_transactions Supabase:', error);
                throw error;
            }

            if (data) {
                data.forEach(d => {
                    if (d.student_nis && d.year && d.month) {
                        const normNIS = String(d.student_nis).trim();
                        paidRecords[`${normNIS}_${d.year}_${d.month}`] = {
                            studentNIS: d.student_nis,
                            year: d.year,
                            month: d.month,
                            amount: Number(d.amount) || 0,
                            type: d.type || 'paid',
                            dateStr: d.date_str || ''
                        };
                    }
                });
            }
        }

        // 2. Hitung Target Bulanan (Estimasi SPP dengan Advance Payment Check + Tunggakan Lalu dengan Cutoff Date)
        let targetSPPBulanIni = 0;
        let totalTunggakanLalu = 0;
        let totalTargetTahunan = 0;
        let unpaidStudentsCount = 0;
        const classDebtMap = {};
        const studentDebtMap = {};

        activeStudents.forEach(student => {
            if (!student || !student.class) return;
            const cohort = calculateCohort(student.class);
            const normStudentNIS = String(student.nis || '').trim();
            const rate = getRateForStudent(student, ratesConfig, currentYear, currentMonth);

            totalTargetTahunan += rate * 12;

            // A. Pengecekan Bayar di Muka (Advance Payment Check) untuk SPP Bulan Ini
            const currentKey = `${normStudentNIS}_${currentYear}_${currentMonth}`;
            const currentMonthRecord = paidRecords[currentKey];
            const isPeriodMigrasi = currentYear === 2026 && currentMonth <= 6;

            let isPaidInAdvance = false;
            if (isPeriodMigrasi) {
                const hasManualDebt = currentMonthRecord && currentMonthRecord.type === 'manual_debt';
                isPaidInAdvance = !hasManualDebt;
            } else if (currentMonthRecord && currentMonthRecord.type !== 'manual_debt') {
                const payDateStr = currentMonthRecord.dateStr || '';
                if (payDateStr && payDateStr < currentMonthStart) {
                    isPaidInAdvance = true;
                }
            }

            const studentEstimationSPP = isPaidInAdvance ? 0 : rate;
            targetSPPBulanIni += studentEstimationSPP;

            // B. Pengecekan Tunggakan Lalu Berbasis Cutoff Date (Saldo Awal Piutang per Awal Bulan)
            let currY = cohort.startYear;
            let currM = 7;

            const maxY = cohort.endYear + 1;
            const maxM = 6;
            let checkLimitYear = currentYear;
            let checkLimitMonth = currentMonth;

            if (checkLimitYear > maxY || (checkLimitYear === maxY && checkLimitMonth > maxM)) {
                checkLimitYear = maxY;
                checkLimitMonth = maxM + 1;
            }

            let studentTunggakanLalu = 0;
            while (currY < checkLimitYear || (currY === checkLimitYear && currM < checkLimitMonth)) {
                const checkKey = `${normStudentNIS}_${currY}_${currM}`;
                const checkRecord = paidRecords[checkKey];
                const checkDueDate = new Date(currY, currM - 1, systemDueDate);

                let isPaidBeforePeriod = false;
                if (checkRecord) {
                    if (checkRecord.type === 'manual_debt') {
                        isPaidBeforePeriod = false;
                    } else {
                        const payDateStr = checkRecord.dateStr || '';
                        if (payDateStr && payDateStr < currentMonthStart) {
                            isPaidBeforePeriod = true;
                        } else if (!payDateStr) {
                            isPaidBeforePeriod = (checkDueDate < SYSTEM_START_DATE);
                        } else {
                            isPaidBeforePeriod = false;
                        }
                    }
                } else {
                    if (checkDueDate < SYSTEM_START_DATE) {
                        isPaidBeforePeriod = true; // Lunas migrasi
                    } else {
                        isPaidBeforePeriod = false;
                    }
                }

                if (!isPaidBeforePeriod) {
                    const debtAmt = getRateForStudent(student, ratesConfig, currY, currM);
                    studentTunggakanLalu += debtAmt;
                    totalTunggakanLalu += debtAmt;
                }

                currM++;
                if (currM > 12) { currM = 1; currY++; }
            }

            // Hitung tunggakan siswa (tunggakan s.d. bulan lalu ATAU bulan berjalan jika sudah lewat tgl 20)
            const isCurrentMonthUnpaid = (!currentMonthRecord || currentMonthRecord.type === 'manual_debt') && studentEstimationSPP > 0;
            const isCurrentMonthPastDue = now.getDate() >= systemDueDate && isCurrentMonthUnpaid;
            const totalStudentDebt = studentTunggakanLalu + (isCurrentMonthPastDue ? studentEstimationSPP : 0);

            studentDebtMap[normStudentNIS] = totalStudentDebt;

            if (totalStudentDebt > 0) {
                unpaidStudentsCount++;
                const cls = String(student.class || '').trim();
                if (cls) {
                    classDebtMap[cls] = (classDebtMap[cls] || 0) + totalStudentDebt;
                }
            }
        });

        // Cari kelas dengan tunggakan terbesar
        let topDebtClass = '-';
        let topDebtAmount = 0;
        Object.entries(classDebtMap).forEach(([cls, amt]) => {
            if (amt > topDebtAmount) {
                topDebtAmount = amt;
                topDebtClass = cls;
            }
        });

        // Target Bulan Berjalan = Estimasi SPP (Sisa Tagihan) + Tunggakan Lalu (Sinkron 100% dengan Tab Estimasi)
        const targetBulanan = targetSPPBulanIni + totalTunggakanLalu;

        // 2. Hitung Realisasi SPP Sekolah (Tahun Ajaran & Bulan Berjalan)
        const startDateStr = `${startYear}-07-01`;
        const endDateStr = `${startYear + 1}-06-30`;

        let totalRealisasiTahunan = 0;
        let realisasiBulanIni = 0;

        const { data: dailyRows, error: dailyErr } = await window.fetchAllSupabaseRows(
            supabase,
            'finance_daily_summary',
            q => q.gte('date_str', startDateStr).lte('date_str', endDateStr),
            { selectFields: 'date_str, total_amount, is_migration' }
        );

        if (dailyErr) {
            console.error('[Dashboard] Error daily summary Supabase:', dailyErr);
            throw dailyErr;
        }

        if (dailyRows) {
            dailyRows.forEach(d => {
                if (d.is_migration) return;
                const amt = Number(d.total_amount) || 0;
                totalRealisasiTahunan += amt;
                if (d.date_str && d.date_str.startsWith(currentYearMonthStr)) {
                    realisasiBulanIni += amt;
                }
            });
        }

        // Tambah virtual migrasi jika melibatkan tahun 2026
        if (startYear === 2025) {
            const virtualMigrationEntries = await getVirtualMigrationEntries(2026);
            virtualMigrationEntries.forEach(ve => {
                const amt = ve.amount || 0;
                totalRealisasiTahunan += amt;
                if (ve.dateStr && ve.dateStr.startsWith(currentYearMonthStr)) {
                    realisasiBulanIni += amt;
                }
            });
        }

        const monthPercent = targetBulanan > 0 ? Math.min(100, Math.round((realisasiBulanIni / targetBulanan) * 100)) : 0;
        const monthKekurangan = Math.max(0, targetBulanan - realisasiBulanIni);
        const percentTahunan = totalTargetTahunan > 0 ? Math.min(100, Math.round((totalRealisasiTahunan / totalTargetTahunan) * 100)) : 0;
        const kekuranganTahunan = Math.max(0, totalTargetTahunan - totalRealisasiTahunan);

        const sppPayload = {
            monthLabel: `Bulan (${currentMonthName})`,
            realisasiBulanIni,
            targetBulanan,
            monthKekurangan,
            monthPercent,
            totalRealisasiTahunan,
            totalTargetTahunan,
            kekuranganTahunan,
            percentTahunan,
            unpaidStudentsCount,
            topDebtClass,
            topDebtAmount,
            studentDebtMap,
            paidRecords
        };

        // Render UI
        applySppUI(sppPayload);

        // Simpan ke cache lokal ber-TTL 15 menit
        if (typeof window.setLocalCache === 'function') {
            window.setLocalCache(SPP_PROGRESS_CACHE_KEY, sppPayload);
        }

        return sppPayload;

    } catch (e) {
        console.error("Gagal merender progress ring SPP:", e);
        return null;
    }
}

// Observer untuk memperbarui warna chart secara dinamis saat Dark Mode di-toggle
if (typeof MutationObserver !== 'undefined' && typeof window !== 'undefined') {
    const themeObserver = new MutationObserver(() => {
        const isDark = document.documentElement.classList.contains('dark');
        const textColor = isDark ? '#94a3b8' : '#64748b';
        const gridColor = isDark ? 'rgba(51, 65, 85, 0.3)' : '#f1f5f9';

        if (window.myGradeAttChart && window.myGradeAttChart.options && window.myGradeAttChart.options.scales) {
            if (window.myGradeAttChart.options.scales.x && window.myGradeAttChart.options.scales.x.ticks) {
                window.myGradeAttChart.options.scales.x.ticks.color = textColor;
            }
            if (window.myGradeAttChart.options.scales.y && window.myGradeAttChart.options.scales.y.ticks) {
                window.myGradeAttChart.options.scales.y.ticks.color = textColor;
            }
            if (window.myGradeAttChart.options.scales.y && window.myGradeAttChart.options.scales.y.grid) {
                window.myGradeAttChart.options.scales.y.grid.color = gridColor;
            }
            window.myGradeAttChart.update('none');
        }
        if (window.myVioTrendChart && window.myVioTrendChart.options && window.myVioTrendChart.options.scales) {
            if (window.myVioTrendChart.options.scales.x && window.myVioTrendChart.options.scales.x.ticks) {
                window.myVioTrendChart.options.scales.x.ticks.color = textColor;
            }
            if (window.myVioTrendChart.options.scales.y && window.myVioTrendChart.options.scales.y.ticks) {
                window.myVioTrendChart.options.scales.y.ticks.color = textColor;
            }
            if (window.myVioTrendChart.options.scales.y && window.myVioTrendChart.options.scales.y.grid) {
                window.myVioTrendChart.options.scales.y.grid.color = gridColor;
            }
            window.myVioTrendChart.update('none');
        }
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}

// Auto-refresh data saat kembali ke tab Dashboard (Mitigasi Stale Data / Poin 8)
let lastDashboardFocusRefresh = Date.now();
const DASHBOARD_REFRESH_THROTTLE_MS = 5 * 60 * 1000; // Throttle 5 menit agar hemat kuota dan responsif

function handleDashboardTabRefresh() {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        const now = Date.now();
        if (now - lastDashboardFocusRefresh > DASHBOARD_REFRESH_THROTTLE_MS) {
            lastDashboardFocusRefresh = now;
            console.log('🔄 [Dashboard] Tab kembali aktif, memuat ulang ringkasan eksekutif...');
            if (typeof loadDashboardData === 'function') {
                loadDashboardData();
            }
        }
    }
}

if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleDashboardTabRefresh);
}
if (typeof window !== 'undefined') {
    window.addEventListener('pageshow', (event) => {
        if (event.persisted) {
            handleDashboardTabRefresh();
        }
    });
}

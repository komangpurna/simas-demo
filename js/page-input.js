/* js/page-input.js - Separated Aggregates & SSOT Architecture */
import { auth, db, PATHS, resolvePhotoUrl } from './config.js';
import { cfClient } from './cloudflare-client.js';
import { initLayout } from './global.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { collection, getDocs, doc, runTransaction, writeBatch, serverTimestamp, Timestamp, query, orderBy, where, limit, setDoc, getDoc, getCountFromServer, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

let studentsCache = [];
let selectedStudentNIS = null;
let currentUserName = "";
let editingState = null; // { docId, oldPoints, oldCategory, oldNis }

// Two-Step Permission
let twoStepPermissionEnabled = false;

// NAMA KOLEKSI BARU UNTUK POIN (AGREGAT)
const AGGREGATE_COLLECTION = 'student_aggregates';

// CACHE CONFIG (Untuk Hemat Kuota Read)
const CACHE_KEYS = {
    VIOLATION_TYPES: 'simas_violation_types_cache',
    SYSTEM_CONFIG: 'simas_system_config_cache',
    USER_DATA: 'simas_user_data_cache'
};
const TTL_30_HOURS = 30 * 60 * 60 * 1000; // 30 jam
const TTL_5_MINUTES = 5 * 60 * 1000; // 5 menit

// Variable untuk menyimpan user data (agar tidak double fetch)
let cachedUserData = null;

// HELPER: Cek wewenang hak akses input pelanggaran
// Guru Mapel, Wali Kelas, dan Staff tidak diberikan akses input pelanggaran
function canInputViolation() {
    if (typeof window !== 'undefined' && typeof window.hasRole === 'function') {
        if (window.hasRole('super_admin') || window.hasRole('guru_bk') || window.hasRole('kesiswaan') || window.hasRole('admin_pks')) {
            return true;
        }
        if (window.hasRole('guru_mapel') || window.hasRole('wali_kelas') || window.hasRole('staff')) {
            return false;
        }
    }
    const primaryRole = typeof localStorage !== 'undefined' ? localStorage.getItem('user_role') : '';
    let additionalRoles = [];
    try {
        additionalRoles = JSON.parse(localStorage.getItem('user_additional_roles') || '[]');
    } catch (e) {
        additionalRoles = [];
    }
    const allRoles = [primaryRole, ...additionalRoles].filter(Boolean);
    if (allRoles.some(r => ['super_admin', 'guru_bk', 'kesiswaan', 'admin_pks'].includes(r))) {
        return true;
    }
    if (allRoles.some(r => ['guru_mapel', 'wali_kelas', 'staff'].includes(r))) {
        return false;
    }
    return false;
}
if (typeof window !== 'undefined') {
    window.canInputViolation = canInputViolation;
}

// HELPER: Sinkronisasi status disabled tombol simpan berdasarkan peran & kategori aktif
function updateSaveButtonState(type) {
    const currentType = type || (typeof document !== 'undefined' && document.getElementById('active-type')?.value) || 'violation';
    if (typeof document === 'undefined') return;
    const btnSave = document.getElementById('btn-save-activity');
    const noticeEl = document.getElementById('violation-restricted-notice');
    const btnAddVio = document.querySelector('button[onclick="window.addViolationRow()"]');
    if (!btnSave) return;

    const isRestricted = !canInputViolation();

    if (currentType === 'violation' && isRestricted) {
        btnSave.disabled = true;
        btnSave.classList.add('opacity-50', 'cursor-not-allowed', 'pointer-events-none');
        btnSave.classList.remove('active:scale-95', 'hover:bg-slate-800', 'dark:hover:bg-blue-700');
        btnSave.setAttribute('title', 'Akses Dibatasi: Guru Mapel, Wali Kelas, dan Staff tidak memiliki akses input pelanggaran');
        if (noticeEl) noticeEl.classList.remove('hidden');
        if (btnAddVio) {
            btnAddVio.disabled = true;
            btnAddVio.classList.add('opacity-50', 'cursor-not-allowed', 'pointer-events-none');
        }
    } else {
        btnSave.disabled = false;
        btnSave.classList.remove('opacity-50', 'cursor-not-allowed', 'pointer-events-none');
        btnSave.classList.add('active:scale-95', 'hover:bg-slate-800', 'dark:hover:bg-blue-700');
        btnSave.removeAttribute('title');
        if (noticeEl) noticeEl.classList.add('hidden');
        if (btnAddVio) {
            btnAddVio.disabled = false;
            btnAddVio.classList.remove('opacity-50', 'cursor-not-allowed', 'pointer-events-none');
        }
    }
}
if (typeof window !== 'undefined') {
    window.updateSaveButtonState = updateSaveButtonState;
}

/* Update bagian ini di js/page-input.js */

onAuthStateChanged(auth, (user) => { // Hapus 'async' di sini biar lebih cepat
    if (!user) { window.location.href = 'index.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash); return; }

    // 1. AMBIL NAMA USER (DENGAN CACHE - Hemat Kuota)
    // Cek cache dulu sebelum fetch dari Firestore
    fetchUserDataWithCache(user.uid, user.email).then((userData) => {
        cachedUserData = userData;
        currentUserName = userData.name || user.email.split('@')[0];
    }).catch(() => {
        currentUserName = user.email;
    });

    const role = localStorage.getItem('user_role');
    // MULTI-ROLE: Ambil role tertinggi untuk halaman ini
    const effectiveRole = window.getEffectiveRoleForPage ?
        window.getEffectiveRoleForPage('input.html') : role;

    if (role === 'siswa') {
        window.location.href = 'dashboard.html'; return;
    }

    initLayout(effectiveRole); // Gunakan role tertinggi

    // 2. TAMPILKAN HALAMAN SEGERA
    const loadingScreen = document.getElementById('loading-screen');
    const mainContent = document.querySelector('main');

    if (loadingScreen) {
        loadingScreen.classList.add('opacity-0'); // Efek fade out
        setTimeout(() => loadingScreen.remove(), 500); // Hapus elemen setelah animasi
    }
    mainContent.classList.remove('hidden'); // Munculkan konten utama

    // 3. SETTING TANGGAL & LOAD DATA LAINNYA
    // Helper Use Local Date String (YYYY-MM-DD) to avoid UTC shift
    const getLocalISODate = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };

    const today = new Date();
    const todayStr = getLocalISODate(today);

    document.getElementById('input-date-vio').value = todayStr;
    document.getElementById('input-date-perm').value = todayStr;
    document.getElementById('input-date-ach').value = todayStr;
    document.getElementById('filter-date-end').value = todayStr;

    const startWeek = new Date();
    startWeek.setDate(startWeek.getDate() - 6); // 1 Minggu Terakhir
    document.getElementById('filter-date-start').value = getLocalISODate(startWeek);

    const now = new Date();
    document.getElementById('input-time-perm').value = now.toTimeString().substring(0, 5);

    // Fungsi load data tetap berjalan
    loadStudentList().then(() => {
        // --- FEATURE: AUTO SELECT BY URL (Deep Link) ---
        const urlParams = new URLSearchParams(window.location.search);
        const targetNIS = urlParams.get('nis');
        if (targetNIS) {
            // Tunggu sebentar agar list ter-render
            setTimeout(() => {
                selectStudentByNIS(targetNIS);
                // Scroll ke input area
                const inputArea = document.getElementById('input-area');
                if (inputArea) inputArea.scrollIntoView({ behavior: 'smooth' });
            }, 500);
        }
    });
    loadViolationMaster();
    loadClassOptions();
    loadRecentSideFeed();
    initTeamMemberSearch();
    loadTeachersDatalist();

    // --- CHECK TWO-STEP PERMISSION MODE ---
    checkTwoStepPermission();

    // 4. RESTRICT ADMIN PKS (Hanya Pelanggaran)
    // Multi-role support: jika punya role lain (misalnya guru_bk), boleh input lain
    const isOnlyAdminPks = window.hasRole ?
        (window.hasRole('admin_pks') && !window.hasRole('super_admin') && !window.hasRole('kesiswaan') &&
            !window.hasRole('staff') && !window.hasRole('guru_bk') && !window.hasRole('wali_kelas')) :
        role === 'admin_pks';
    if (isOnlyAdminPks) {
        const typeContainer = document.getElementById('type-selection-container');
        if (typeContainer) typeContainer.classList.add('hidden');
        const tabPerm = document.getElementById('tab-permission');
        const tabAch = document.getElementById('tab-achievement');
        const tabContainer = tabPerm.parentElement; // Grid container

        if (tabPerm) tabPerm.classList.add('hidden');
        if (tabAch) tabAch.classList.add('hidden');

        // Ubah grid menjadi 1 kolom agar tab 'Pelanggaran' full width
        if (tabContainer) {
            tabContainer.classList.remove('grid-cols-3');
            tabContainer.classList.add('grid-cols-1');
        }
    } else {
        // DEFAULT TAB: PERMISI (Diminta User) 
        // OR CHECK URL PARAM 'type' (e.g. ?type=achievement)
        const urlParams = new URLSearchParams(window.location.search);
        const urlType = urlParams.get('type');

        if (urlType && ['violation', 'permission', 'achievement'].includes(urlType)) {
            if (typeof window.switchInputType === 'function') {
                window.switchInputType(urlType);
            }
        } else {
            // Default fallback
            if (typeof window.switchInputType === 'function') {
                window.switchInputType('permission');
            }
        }
        updateSaveButtonState();
    }

    // 5. RESTRICT KEPALA SEKOLAH (View Only - Hide Input Tab, Switch to History)
    // Multi-role support: jika punya role lain yang bisa input, jangan restrict
    const isOnlyKepsek = window.hasRole ?
        (window.hasRole('kepala_sekolah') && !window.hasRole('super_admin') && !window.hasRole('kesiswaan') &&
            !window.hasRole('staff') && !window.hasRole('guru_bk') && !window.hasRole('wali_kelas') && !window.hasRole('admin_pks')) :
        role === 'kepala_sekolah';
    if (isOnlyKepsek) {
        // Sembunyikan tombol tab Input Baru
        const btnMainInput = document.getElementById('btn-main-input');
        if (btnMainInput) btnMainInput.classList.add('hidden');

        // Langsung switch ke tab Data Riwayat
        if (typeof switchMainTab === 'function') {
            switchMainTab('history');
        }

        // Load data riwayat otomatis
        setTimeout(() => {
            if (typeof window.loadHistoryByFilter === 'function') {
                window.loadHistoryByFilter();
            }
        }, 500);
    }

    // 6. DEFAULT FILTER WALI KELAS (PAKAI CACHED USER DATA - Hemat Kuota)
    const urlParams = new URLSearchParams(window.location.search);
    const urlTab = urlParams.get('tab');
    const urlCategory = urlParams.get('category') || urlParams.get('type');
    const urlStart = urlParams.get('start') || urlParams.get('startDate');
    const urlEnd = urlParams.get('end') || urlParams.get('endDate');
    const urlClass = urlParams.get('class') || urlParams.get('kelas');

    if (role === 'wali_kelas' && !urlTab) {
        // Tunggu cachedUserData tersedia lalu gunakan
        const checkUserData = setInterval(() => {
            if (cachedUserData && cachedUserData.assignedClass) {
                clearInterval(checkUserData);
                const classSelect = document.getElementById('filter-history-class');
                // Tunggu opsi kelas ter-load
                const checkClassOptions = setInterval(() => {
                    if (classSelect.options.length > 1) {
                        classSelect.value = cachedUserData.assignedClass;
                        if (classSelect.value === cachedUserData.assignedClass) {
                            loadHistoryByFilter();
                        }
                        clearInterval(checkClassOptions);
                    }
                }, 200);
                setTimeout(() => clearInterval(checkClassOptions), 5000);
            }
        }, 100);
        setTimeout(() => clearInterval(checkUserData), 5000);
    }

    // --- 7. AUTO TAB & FILTER DARI URL PARAMETER (Deep Linking dari Dashboard / Link Luar) ---
    const endInput = document.getElementById('filter-date-end');
    const startInput = document.getElementById('filter-date-start');
    const categorySelect = document.getElementById('filter-history-category');
    const classSelect = document.getElementById('filter-history-class');

    // Atur tanggal dari URL atau default 3 hari terakhir
    if (endInput && startInput) {
        if (urlStart && urlEnd) {
            startInput.value = urlStart;
            endInput.value = urlEnd;
        } else {
            const today = new Date();
            const threeDaysAgo = new Date();
            threeDaysAgo.setDate(today.getDate() - 2); // Rentang 3 hari: Hari ini, H-1, H-2

            const formatDt = (d) => {
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const dt = String(d.getDate()).padStart(2, '0');
                return `${y}-${m}-${dt}`;
            };

            endInput.value = formatDt(today);
            startInput.value = formatDt(threeDaysAgo);
        }
    }

    // Jika diminta membuka tab riwayat (misal diklik dari kartu dashboard)
    if (urlTab === 'history') {
        if (urlCategory && categorySelect) {
            const catMap = {
                'violation': 'violation',
                'pelanggaran': 'violation',
                'permission': 'permission',
                'permisi': 'permission',
                'achievement': 'achievement',
                'prestasi': 'achievement'
            };
            categorySelect.value = catMap[urlCategory.toLowerCase()] || '';
        }

        if (typeof switchMainTab === 'function') {
            switchMainTab('history');
        }

        // Jika ada filter kelas di URL
        if (urlClass && classSelect) {
            const checkClassOptions = setInterval(() => {
                if (classSelect.options.length > 1) {
                    classSelect.value = urlClass;
                    clearInterval(checkClassOptions);
                    if (typeof window.loadHistoryByFilter === 'function') {
                        window.loadHistoryByFilter();
                    }
                }
            }, 150);
            setTimeout(() => {
                clearInterval(checkClassOptions);
                if (typeof window.loadHistoryByFilter === 'function') {
                    window.loadHistoryByFilter();
                }
            }, 2000);
        } else {
            // Muat riwayat otomatis sesuai filter yang dipasang
            setTimeout(() => {
                if (typeof window.loadHistoryByFilter === 'function') {
                    window.loadHistoryByFilter();
                }
            }, 250);
        }
    }

});

function getAcademicYearStart() {
    const currentAyText = window.getCurrentAcademicYearString();
    const startYear = parseInt(currentAyText.split('/')[0]);
    return new Date(startYear, 6, 1);
}

// --- HELPER: FETCH USER DATA WITH CACHE ---
async function fetchUserDataWithCache(uid, email) {
    const TTL_USER = 30 * 60 * 1000; // 30 menit
    const cacheKey = `${CACHE_KEYS.USER_DATA}_${uid}`;

    // CEK CACHE DULU
    try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
            const { data, timestamp } = JSON.parse(cached);
            const now = Date.now();
            if (now - timestamp < TTL_USER && data) {
                console.log('📦 [CACHE] User data loaded from localStorage');
                return data;
            }
        }
    } catch (e) {
        console.warn('[CACHE] Error reading user cache:', e);
    }

    // FETCH DARI FIRESTORE
    console.log('🔄 [NETWORK] Fetching user data from Firestore...');
    const snap = await getDoc(doc(db, PATHS.users, uid));
    if (snap.exists()) {
        const userData = snap.data();
        // SIMPAN KE CACHE
        try {
            localStorage.setItem(cacheKey, JSON.stringify({
                data: userData,
                timestamp: Date.now()
            }));
            console.log('💾 [CACHE] User data saved to localStorage');
        } catch (e) {
            console.warn('[CACHE] Failed to save user cache:', e);
        }
        return userData;
    }
    return { name: email.split('@')[0] };
}

// --- HELPER: GET SYSTEM CONFIG WITH CACHE (delegasi ke global cache terpusat) ---
async function getSystemConfigWithCache() {
    return await window.getSystemConfig();
}



// --- 1. LOAD SISWA (GABUNGAN PROFIL + AGREGAT - SSOT CACHE) ---
async function loadStudentList() {
    try {
        // LOAD CONFIG SHOW ALUMNI (PAKAI CACHE)
        let showAlumni = false;
        try {
            const configData = await getSystemConfigWithCache();
            showAlumni = configData.showAlumni || false;
        } catch (e) { }

        // A. Ambil Data Agregat Poin (Key = NIS)
        const statsDocs = (typeof window.getStudentAggregatesCache === 'function')
            ? await window.getStudentAggregatesCache()
            : [];
        const statsMap = {};
        statsDocs.forEach(item => {
            const key = item.nis || item.id;
            if (key) statsMap[key] = item.points || 0;
        });

        // B. Ambil Profil Siswa dari Global Cache (IndexedDB / SSOT)
        const allStudents = (typeof window.getStudentsCache === 'function')
            ? await window.getStudentsCache()
            : [];
        studentsCache = [];

        allStudents.forEach(d => {
            const nis = d.nis || d.id;

            if (d.class) {
                const lowerClass = d.class.toLowerCase();
                // FILTER ALUMNI & KELAS NON-AKTIF (Keluar, Pindah, Mutasi)
                if (!showAlumni && lowerClass.includes('alumni')) return;
                if (lowerClass.includes('keluar') || lowerClass.includes('pindah') || lowerClass.includes('mutasi')) return;
            }

            if (nis) {
                studentsCache.push({
                    nis: nis,
                    name: d.name,
                    class: d.class,
                    parentPhone: d.phone_parent || d.parentPhone || '',
                    parentName: d.parentName || d.parent_name || '',
                    points: statsMap[nis] || 0,
                    activePhotoUrl: d.activePhotoUrl || d.active_photo_url || d.photoUrl || d.photo_url || d.foto || d.foto_url || ''
                });
            }
        });

        // C. Sorting
        studentsCache.sort((a, b) => {
            const classDiff = (a.class || '').localeCompare(b.class || '', undefined, { numeric: true });
            if (classDiff !== 0) return classDiff;
            return (a.nis || '').toString().localeCompare((b.nis || '').toString(), undefined, { numeric: true });
        });

        console.log(`[Input] ${studentsCache.length} siswa dimuat untuk dropdown dari SSOT Cache.`);
    } catch (e) {
        console.error("Gagal load student list:", e);
    }
}

// --- 2. EVENT LISTENER PENCARIAN (BY NIS) ---
// --- 2. LOGIC SELEKSI SISWA (REUSABLE) ---
function selectStudentByNIS(nis) {
    const s = studentsCache.find(x => String(x.nis) === String(nis));
    const infoBox = document.getElementById('selected-student-info');
    const searchInput = document.getElementById('student-search');

    if (s) {
        selectedStudentNIS = s.nis;

        // Update Search Input agar user tahu siapa yang dipilih
        searchInput.value = `${s.nis} | ${s.name} (${s.class})`;

        // Update Info Box
        document.getElementById('info-name').innerText = s.name;
        document.getElementById('info-class').innerText = s.class;
        document.getElementById('info-points').innerText = s.violationPoints || 0;

        updatePermissionCount(s.nis);
        infoBox.classList.remove('hidden');

        // Show Piket Info with Animation
        const piketBox = document.getElementById('info-piket-box');
        if (piketBox) {
            piketBox.classList.remove('hidden');
            // Reset animation
            piketBox.classList.remove('blink-active');
            void piketBox.offsetWidth; // trigger reflow
            piketBox.classList.add('blink-active');
            // Animation removes itself naturally via css iteration count, but we remove class for clean next time
            setTimeout(() => { piketBox.classList.remove('blink-active'); }, 2500);
        }

    } else {
        selectedStudentNIS = null;
        infoBox.classList.add('hidden');
        document.getElementById('info-piket-box').classList.add('hidden');
    }

    // Tutup dropdown setelah memilih
    document.getElementById('student-dropdown').classList.add('hidden');
}

// === CUSTOM DROPDOWN PENCARIAN SISWA ===
function renderStudentDropdown(filterText = '') {
    const dropdown = document.getElementById('student-dropdown');
    const term = filterText.toLowerCase().trim();

    // Filter siswa berdasarkan nama atau NIS
    let filtered = studentsCache;
    if (term) {
        filtered = studentsCache.filter(s =>
            s.name.toLowerCase().includes(term) ||
            String(s.nis).includes(term) ||
            (s.class || '').toLowerCase().includes(term)
        );
    }

    // Batasi tampilan agar tidak terlalu berat (maks 50 item)
    const maxShow = 20;
    const sliced = filtered.slice(0, maxShow);

    if (sliced.length === 0) {
        dropdown.innerHTML = `<div class="px-4 py-3 text-sm text-slate-400 text-center">Tidak ditemukan</div>`;
        dropdown.classList.remove('hidden');
        return;
    }

    dropdown.innerHTML = sliced.map(s => {
        const rawPhoto = s.activePhotoUrl || s.active_photo_url || s.photoUrl || s.photo_url || s.foto || s.foto_url || '';
        const resolvedPhoto = rawPhoto ? (typeof resolvePhotoUrl === 'function' ? resolvePhotoUrl(rawPhoto) : (window.resolvePhotoUrl ? window.resolvePhotoUrl(rawPhoto) : rawPhoto)) : '';
        const safePhoto = (resolvedPhoto && /^(https?:|\/|data:image\/)/i.test(resolvedPhoto)) ? resolvedPhoto : '';
        const initial = window.escapeHTML((s.name || '?').charAt(0));

        const avatarThumb = safePhoto
            ? `<img src="${safePhoto}" alt="" loading="lazy" class="w-6 h-6 rounded-full object-cover shrink-0 ring-1 ring-slate-200/80 dark:ring-slate-700" onerror="this.onerror=null; this.classList.add('hidden'); if(this.nextElementSibling) this.nextElementSibling.classList.remove('hidden');" /><div class="hidden w-6 h-6 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center text-slate-500 dark:text-slate-400 text-[10px] font-bold shrink-0">${initial}</div>`
            : `<div class="w-6 h-6 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center text-slate-500 dark:text-slate-400 text-[10px] font-bold shrink-0">${initial}</div>`;

        return `
        <div class="student-dropdown-item px-3 py-2 cursor-pointer hover:bg-blue-50 dark:hover:bg-slate-700/50 flex items-center gap-3 border-b border-slate-50 dark:border-slate-700/50 last:border-0 transition-colors"
             data-nis="${window.escapeHTML(s.nis)}">
            ${avatarThumb}
            <div class="flex-1 min-w-0 flex items-center justify-between gap-2">
                <div class="font-semibold text-sm text-slate-800 dark:text-slate-200 truncate">${window.escapeHTML(s.name)}</div>
                <div class="text-[10px] text-slate-500 dark:text-slate-400 whitespace-nowrap bg-slate-50 dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700">${window.escapeHTML(s.nis)} &bull; ${window.escapeHTML(s.class)}</div>
            </div>
        </div>
        `;
    }).join('');

    if (filtered.length > maxShow) {
        dropdown.innerHTML += `<div class="px-4 py-2 text-[11px] text-slate-400 dark:text-slate-500 text-center bg-slate-50 dark:bg-slate-800">...dan ${filtered.length - maxShow} siswa lainnya. Ketik lebih spesifik.</div>`;
    }

    dropdown.classList.remove('hidden');
}

// Event: Klik item di dropdown
document.getElementById('student-dropdown').addEventListener('click', (e) => {
    const item = e.target.closest('.student-dropdown-item');
    if (item) {
        selectStudentByNIS(item.dataset.nis);
    }
});

// Event: Focus pada input â†’ tampilkan dropdown
document.getElementById('student-search').addEventListener('focus', () => {
    if (studentsCache.length > 0) {
        const val = document.getElementById('student-search').value;
        // Jangan tampilkan dropdown jika sudah ada siswa terpilih (format "NIS | Nama")
        if (!val.includes(' | ')) {
            renderStudentDropdown(val);
        }
    }
});

// Event: Ketik di input â†’ filter dropdown
document.getElementById('student-search').addEventListener('input', (e) => {
    const val = e.target.value;
    e.target.classList.remove('ring-2', 'ring-red-500', 'bg-red-50', 'dark:bg-red-900/20');
    e.target.classList.add('bg-white'); // pulihkan latar dasar setelah penanda error

    // Coba extract NIS dari string "12345 | Budi (X-1)"
    const parts = val.split(' | ');
    if (parts.length >= 2) {
        const inputNIS = parts[0].trim();
        const exists = studentsCache.find(s => String(s.nis) === inputNIS);
        if (exists) {
            selectStudentByNIS(inputNIS);
            return;
        }
    }

    // Reset selection
    document.getElementById('selected-student-info').classList.add('hidden');
    document.getElementById('info-piket-box').classList.add('hidden');
    selectedStudentNIS = null;

    // Render dropdown hasil filter
    if (studentsCache.length > 0) {
        renderStudentDropdown(val);
    }
});

// Event: Tekan Enter pada input pencarian siswa untuk memilih siswa berdasarkan NIS
document.getElementById('student-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const val = e.target.value.trim();
        if (!val) return;

        // Jika siswa sudah dipilih (format "NIS | Nama (Kelas)")
        if (selectedStudentNIS && val.includes(' | ')) {
            e.preventDefault();
            return;
        }

        e.preventDefault();
        
        // Cari siswa yang memiliki NIS persis sama
        const exactMatch = studentsCache.find(s => String(s.nis) === val);
        if (exactMatch) {
            selectStudentByNIS(exactMatch.nis);
            return;
        }

        // Jika tidak ada NIS yang persis cocok, cari yang terfilter dari input
        const term = val.toLowerCase();
        const filtered = studentsCache.filter(s =>
            s.name.toLowerCase().includes(term) ||
            String(s.nis).includes(term) ||
            (s.class || '').toLowerCase().includes(term)
        );

        if (filtered.length > 0) {
            selectStudentByNIS(filtered[0].nis);
        } else {
            showToast("Tidak Ditemukan", `Tidak ada siswa dengan NIS atau nama "${val}"`, "error");
        }
    }
});

// Event: Tutup dropdown saat klik di luar
document.addEventListener('click', (e) => {
    // 1. Dropdown Pencarian Siswa
    const dropdown = document.getElementById('student-dropdown');
    const searchInput = document.getElementById('student-search');
    if (searchInput && dropdown) {
        if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.add('hidden');
        }
    }

    // 2. Dropdown Pencarian Pelanggaran (Bisa lebih dari 1 baris)
    const violationRows = document.querySelectorAll('.violation-row');
    violationRows.forEach(row => {
        const vSearch = row.querySelector('.violation-search-input');
        const vDrop = row.querySelector('.violation-dropdown');
        if (vSearch && vDrop) {
            if (!vSearch.contains(e.target) && !vDrop.contains(e.target)) {
                vDrop.classList.add('hidden');
            }
        }
    });

    // 3. Dropdown Anggota Tim Prestasi
    const teamDropdown = document.getElementById('team-member-dropdown');
    const teamSearch = document.getElementById('team-member-search');
    if (teamSearch && teamDropdown) {
        if (!teamSearch.contains(e.target) && !teamDropdown.contains(e.target)) {
            teamDropdown.classList.add('hidden');
        }
    }
});

// --- HELPER PRESTASI: MANAJEMEN ANGGOTA TIM & GURU PEMBINA ---
let achievementTeamMembers = [];

window.toggleAchievementTeamMode = function (isTeam) {
    const teamSection = document.getElementById('team-section');
    if (!teamSection) return;
    if (isTeam) {
        teamSection.classList.remove('hidden');
    } else {
        teamSection.classList.add('hidden');
    }
};

window.removeTeamMember = function (nis) {
    achievementTeamMembers = achievementTeamMembers.filter(m => String(m.nis) !== String(nis));
    renderTeamMembersChips();
};

function renderTeamMembersChips() {
    const container = document.getElementById('team-members-chips');
    if (!container) return;
    if (achievementTeamMembers.length === 0) {
        container.innerHTML = '<span class="text-xs text-slate-400 dark:text-slate-500 italic">Belum ada anggota tim tambahan yang dipilih.</span>';
        return;
    }
    container.innerHTML = achievementTeamMembers.map(m => `
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 text-xs font-semibold">
            <span>${window.escapeHTML(m.name)} (${window.escapeHTML(m.class || '-')})</span>
            <button type="button" onclick="window.removeTeamMember('${window.escapeHTML(String(m.nis))}')" class="text-blue-400 hover:text-red-500 focus:outline-none">
                <i class="fa-solid fa-xmark text-xs"></i>
            </button>
        </span>
    `).join('');
}

function initTeamMemberSearch() {
    const searchInput = document.getElementById('team-member-search');
    const dropdown = document.getElementById('team-member-dropdown');
    if (!searchInput || !dropdown) return;

    searchInput.addEventListener('input', (e) => {
        const val = e.target.value.trim().toLowerCase();
        if (val.length < 2) {
            dropdown.classList.add('hidden');
            dropdown.innerHTML = '';
            return;
        }

        const currentNis = selectedStudentNIS ? String(selectedStudentNIS) : '';
        const existingTeamNis = new Set(achievementTeamMembers.map(m => String(m.nis)));

        const matches = (studentsCache || []).filter(s => {
            const sNis = String(s.nis);
            if (sNis === currentNis || existingTeamNis.has(sNis)) return false;
            return (s.name || '').toLowerCase().includes(val) ||
                sNis.includes(val) ||
                (s.class || '').toLowerCase().includes(val);
        }).slice(0, 8);

        if (matches.length === 0) {
            dropdown.innerHTML = '<div class="p-3 text-xs text-slate-400 dark:text-slate-500 text-center">Siswa tidak ditemukan atau sudah ditambahkan</div>';
            dropdown.classList.remove('hidden');
            return;
        }

        dropdown.innerHTML = matches.map(s => `
            <div class="team-member-item p-2.5 hover:bg-slate-100 dark:hover:bg-slate-700/60 cursor-pointer flex items-center justify-between text-xs border-b border-slate-100 dark:border-slate-700/40 last:border-0"
                 data-nis="${window.escapeHTML(String(s.nis))}"
                 data-name="${window.escapeHTML(s.name)}"
                 data-class="${window.escapeHTML(s.class || '')}">
                <div>
                    <span class="font-bold text-slate-700 dark:text-slate-200">${window.escapeHTML(s.name)}</span>
                    <span class="text-slate-400 ml-1 font-mono">${window.escapeHTML(String(s.nis))}</span>
                </div>
                <span class="text-slate-500 dark:text-slate-400 font-medium">${window.escapeHTML(s.class || '')}</span>
            </div>
        `).join('');
        dropdown.classList.remove('hidden');
    });

    dropdown.addEventListener('click', (e) => {
        const item = e.target.closest('.team-member-item');
        if (!item) return;
        const nis = item.getAttribute('data-nis');
        const name = item.getAttribute('data-name');
        const sClass = item.getAttribute('data-class');

        if (nis && !achievementTeamMembers.some(m => String(m.nis) === String(nis))) {
            achievementTeamMembers.push({ nis, name, class: sClass });
            renderTeamMembersChips();
        }

        searchInput.value = '';
        dropdown.classList.add('hidden');
        dropdown.innerHTML = '';
    });
}

async function loadTeachersDatalist() {
    try {
        const datalist = document.getElementById('teachers-datalist');
        if (!datalist) return;
        const teachers = await cfClient.getTeachers();
        const list = Array.isArray(teachers) ? teachers : (teachers?.results || teachers?.data || []);
        if (list && list.length > 0) {
            datalist.innerHTML = list
                .filter(t => t.name)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(t => `<option value="${window.escapeHTML(t.name)}">${window.escapeHTML(t.name)}${t.mapel ? ` (${window.escapeHTML(t.mapel)})` : ''}</option>`)
                .join('');
        }
    } catch (err) {
        console.warn('Gagal memuat datalist guru pembina:', err);
    }
}

// --- 4. EKSEKUSI SIMPAN (CUSTOM ID & REALTIME CLOCK) ---
window.executeSaveActivity = async () => {
    document.getElementById('modal-confirm-activity').classList.add('hidden');
    const btn = document.getElementById('btn-save-activity');
    const oldText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';

    const inputType = document.getElementById('active-type').value;
    const role = localStorage.getItem('user_role');

    // SECURITY CHECK: GURU MAPEL, WALI KELAS, STAFF DILARANG INPUT PELANGGARAN
    if (inputType === 'violation' && !canInputViolation()) {
        showToast("Akses Ditolak", "Guru Mapel, Wali Kelas, dan Staff tidak memiliki akses untuk menginput data pelanggaran.", "error");
        btn.disabled = false; btn.innerHTML = oldText;
        return;
    }

    // SECURITY CHECK FOR ADMIN PKS
    if (role === 'admin_pks' && inputType !== 'violation') {
        showToast("Akses Ditolak", "Admin PKS hanya boleh menginput Pelanggaran.", "error");
        btn.disabled = false; btn.innerHTML = oldText;
        return;
    }

    try {
        const studentRef = studentsCache.find(s => s.nis === selectedStudentNIS);
        if (!studentRef) throw new Error("Data siswa tidak valid / NIS tidak ditemukan.");

        // 1. SETUP WAKTU (Gabungkan Tanggal Input + Jam Sekarang)
        const now = new Date(); // Waktu saat ini (Jam:Menit:Detik)

        // Fungsi helper untuk menggabungkan Tanggal Pilihan + Jam Sekarang (LOCAL COMPATIBLE)
        const getRealTimestamp = (dateInputId) => {
            const inputDateVal = document.getElementById(dateInputId).value; // YYYY-MM-DD
            if (!inputDateVal) return new Date();

            const [y, m, d] = inputDateVal.split('-').map(Number);
            const finalDate = new Date(y, m - 1, d); // Local Midnight

            finalDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
            return finalDate;
        };

        // 2. GENERATE ID DOKUMEN MANUAL (NIS + TIMESTAMP)
        // Format: 12345_17099882211 (Unik & Bisa dibaca)
        let customDocID = `${studentRef.nis}_${now.getTime()}`;
        let isUpdateMode = false;

        if (editingState) {
            customDocID = editingState.docId;
            isUpdateMode = true;
        }

        const baseRecord = {
            studentNIS: studentRef.nis,
            studentName: document.getElementById('info-name').innerText,
            studentClass: document.getElementById('info-class').innerText,
            // createdAt: serverTimestamp(), // Jangan update createdAt kalau edit
            updatedAt: serverTimestamp(),
            updatedBy: currentUserName,
            // Only set CreatedAt on New
            ...(isUpdateMode ? {} : { createdAt: serverTimestamp(), createdBy: currentUserName })
        };

        // --- A. PELANGGARAN (MULTI-VIOLATION SUPPORT) ---
        if (inputType === 'violation') {
            // Gunakan helper waktu
            const realTimeDate = getRealTimestamp('input-date-vio');

            // Kumpulkan data dari semua baris pelanggaran
            const violationRows = document.querySelectorAll('#violation-items .violation-row');
            const violations = [];
            violationRows.forEach(row => {
                const pts = parseInt(row.querySelector('.violation-points-input')?.value) || 0;
                const desc = row.querySelector('.violation-desc-input')?.value || 'Pelanggaran';
                if (pts > 0 || desc !== 'Pelanggaran') {
                    violations.push({ points: pts, desc: desc });
                }
            });

            // Minimal 1 pelanggaran harus ada
            if (violations.length === 0) {
                throw new Error('Minimal 1 pelanggaran harus diisi.');
            }

            // SIMPAN SEMUA PELANGGARAN KE CLOUDFLARE D1 (100% SSOT & 0 FIRESTORE READ)
            const recPayloads = violations.map((v, idx) => ({
                id: isUpdateMode ? customDocID : `${customDocID}_${idx}`,
                student_nis: studentRef.nis,
                student_name: studentRef.name,
                student_class: studentRef.class,
                category: 'Pelanggaran',
                type: v.desc || 'Pelanggaran',
                points: v.points,
                desc: v.desc,
                reporter_uid: auth.currentUser?.uid || '',
                reporter_name: currentUserName,
                date: window.getLocalISODate(realTimeDate),
                timestamp: realTimeDate.toISOString(),
                photo_url: baseRecord.photoUrl || '',
                status: 'active',
                created_by: currentUserName
            }));

            if (isUpdateMode) {
                await cfClient.updateRecord(customDocID, recPayloads[0]);
            } else {
                await cfClient.saveRecord(recPayloads);
            }

            if (typeof window.logAudit === 'function') {
                if (isUpdateMode) {
                    window.logAudit('UPDATE_RECORD', customDocID, editingState, { category: 'Pelanggaran', newViolations: violations }, `Mengubah pelanggaran ${studentRef.name}`);
                } else {
                    window.logAudit('CREATE_RECORD', customDocID, null, { category: 'Pelanggaran', violations: violations }, `Input ${violations.length} pelanggaran untuk ${studentRef.name}`);
                }
            }

        }
        // --- B. PERMISI ---
        else if (inputType === 'permission') {
            const dateVal = document.getElementById('input-date-perm').value;
            const timeVal = document.getElementById('input-time-perm').value; // Jam dari input manual
            const note = document.getElementById('desc-permission').value;

            // VALIDASI INPUT KOSONG
            if (!dateVal) throw new Error("Tanggal permisi wajib diisi.");
            if (!timeVal) throw new Error("Jam keluar permisi wajib diisi.");
            if (!note.trim()) throw new Error("Keperluan permisi wajib diisi.");

            // VALIDASI: Cek apakah siswa sudah permisi di hari yang sama (kecuali mode edit) via Cloudflare D1
            if (!isUpdateMode) {
                const existingPerm = await cfClient.getRecords({
                    nis: studentRef.nis,
                    category: 'Permisi',
                    date_start: dateVal,
                    date_end: dateVal
                });

                if (existingPerm && existingPerm.length > 0) {
                    throw new Error(`Siswa ${studentRef.name} sudah memiliki catatan permisi pada tanggal ${dateVal}. Tidak bisa input permisi lebih dari 1x di hari yang sama.`);
                }
            }

            // Khusus Permisi, jamnya ikut inputan 'Jam Keluar', bukan jam sekarang
            const permDate = new Date(`${dateVal}T${timeVal}`);
            const permPayload = {
                id: customDocID,
                student_nis: studentRef.nis,
                student_name: studentRef.name,
                student_class: studentRef.class,
                category: 'Permisi',
                type: 'Permisi',
                points: 0,
                desc: `[${timeVal}] ${note}`,
                reporter_uid: auth.currentUser?.uid || '',
                reporter_name: currentUserName,
                date: dateVal,
                timestamp: permDate.toISOString(),
                photo_url: baseRecord.photoUrl || '',
                status: 'active',
                created_by: currentUserName
            };

            if (isUpdateMode) {
                await cfClient.updateRecord(customDocID, permPayload);
            } else {
                await cfClient.saveRecord(permPayload);
            }

            if (typeof window.logAudit === 'function') {
                if (isUpdateMode) {
                    window.logAudit('UPDATE_RECORD', customDocID, editingState, { category: 'Permisi', date: dateVal, time: timeVal, note: note }, `Mengubah catatan permisi ${studentRef.name}`);
                } else {
                    window.logAudit('CREATE_RECORD', customDocID, null, { category: 'Permisi', date: dateVal, time: timeVal, note: note }, `Input permisi untuk ${studentRef.name}`);
                }
            }

            if (!isUpdateMode) {
                // Pengiriman WA diproses melalui Cloudflare Worker.
                showToast("Info", "Notifikasi WA akan otomatis dikirim ke Wali Kelas.", "success");
            }

        }
        // --- C. PRESTASI ---
        else if (inputType === 'achievement') {
            const dateVal = document.getElementById('input-date-ach').value;
            const field = document.getElementById('input-achievement-field').value;
            const title = document.getElementById('input-achievement-title').value.trim();
            const organizer = document.getElementById('input-achievement-organizer').value.trim();
            const level = document.getElementById('input-achievement-level').value;
            const rank = document.getElementById('input-achievement-rank').value;
            const isTeam = document.getElementById('part-type-team')?.checked || false;
            const participationType = isTeam ? 'Beregu' : 'Individu';
            const teamName = isTeam ? document.getElementById('input-achievement-team-name').value.trim() : '';
            const mentorName = document.getElementById('input-achievement-mentor').value.trim();
            const evidenceUrl = document.getElementById('input-achievement-evidence').value.trim();
            const certNo = document.getElementById('input-achievement-cert-no').value.trim();
            const note = document.getElementById('desc-achievement').value.trim();

            // VALIDASI INPUT KOSONG
            if (!dateVal) throw new Error("Tanggal prestasi wajib diisi.");
            if (!title) throw new Error("Nama kompetisi / kegiatan wajib diisi.");
            if (!organizer) throw new Error("Penyelenggara kompetisi wajib diisi.");
            if (!level) throw new Error("Tingkat prestasi wajib diisi.");
            if (!rank) throw new Error("Peringkat / capaian juara wajib diisi.");
            if (isTeam && !teamName) throw new Error("Nama tim / regu wajib diisi untuk kepesertaan beregu.");

            // Format deskripsi terpadu untuk backward-compatibility
            let formattedDesc = `[${field}] ${title} (${level}) - ${rank}`;
            if (organizer) formattedDesc += ` | Penyelenggara: ${organizer}`;
            if (mentorName) formattedDesc += ` | Pembina: ${mentorName}`;
            if (isTeam && teamName) formattedDesc += ` | Tim: ${teamName}`;
            if (certNo) formattedDesc += ` | No. SK: ${certNo}`;
            if (note) formattedDesc += ` | Catatan: ${note}`;

            // Gunakan helper waktu
            const realTimeDate = getRealTimestamp('input-date-ach');

            // Kumpulkan seluruh siswa yang didaftarkan (Siswa Utama + Anggota Tim jika Beregu)
            let targetStudents = [studentRef];
            if (!isUpdateMode && isTeam && achievementTeamMembers.length > 0) {
                targetStudents = [studentRef, ...achievementTeamMembers];
            }

            const achPayloads = targetStudents.map((st, idx) => ({
                id: (isUpdateMode && idx === 0) ? customDocID : `${st.nis}_${realTimeDate.getTime()}_${idx}`,
                student_nis: st.nis,
                student_name: st.name,
                student_class: st.class,
                category: 'Prestasi',
                type: level,
                points: 0,
                desc: formattedDesc,
                competition_name: title,
                organizer: organizer,
                level: level,
                field: field,
                rank: rank,
                participation_type: participationType,
                team_name: teamName,
                mentor_name: mentorName,
                certificate_no: certNo,
                evidence_url: evidenceUrl,
                reporter_uid: auth.currentUser?.uid || '',
                reporter_name: currentUserName,
                date: window.getLocalISODate(realTimeDate),
                timestamp: realTimeDate.toISOString(),
                photo_url: baseRecord.photoUrl || '',
                status: 'active',
                created_by: currentUserName
            }));

            if (isUpdateMode) {
                await cfClient.updateRecord(customDocID, achPayloads[0]);
            } else {
                await cfClient.saveRecord(achPayloads);
            }

            if (typeof window.logAudit === 'function') {
                const auditDetail = { category: 'Prestasi', title, field, level, rank, organizer, participation_type: participationType, member_count: targetStudents.length };
                if (isUpdateMode) {
                    window.logAudit('UPDATE_RECORD', customDocID, editingState, auditDetail, `Mengubah prestasi ${studentRef.name}`);
                } else {
                    window.logAudit('CREATE_RECORD', customDocID, null, auditDetail, `Input prestasi untuk ${targetStudents.map(s => s.name).join(', ')}`);
                }
            }
        }

        if (isUpdateMode) {
            showToast("Berhasil", "Data berhasil diperbarui.", "success");
            window.cancelEditMode();
        } else {
            showToast("Berhasil", "Data aktivitas berhasil disimpan!", "success");

            // SIMPAN NILAI TANGGAL & JAM SEBELUM RESET
            const dateVio = document.getElementById('input-date-vio').value;
            const datePerm = document.getElementById('input-date-perm').value;
            const timePerm = document.getElementById('input-time-perm').value;
            const dateAch = document.getElementById('input-date-ach').value;

            // RESET FORM
            document.getElementById('form-input').reset();

            // RESTORE NILAI TANGGAL & JAM
            document.getElementById('input-date-vio').value = dateVio;
            document.getElementById('input-date-perm').value = datePerm;
            document.getElementById('input-time-perm').value = timePerm;
            document.getElementById('input-date-ach').value = dateAch;

            // RESET TEAM MEMBERS STATE
            achievementTeamMembers = [];
            renderTeamMembersChips();
            window.toggleAchievementTeamMode(false);
            if (document.getElementById('part-type-individual')) {
                document.getElementById('part-type-individual').checked = true;
            }

            // RESET MULTI-VIOLATION ROWS
            resetViolationRows();

            document.getElementById('student-search').value = "";
            document.getElementById('student-search').focus();
            document.getElementById('selected-student-info').classList.add('hidden');
            selectedStudentNIS = null;
        }

        // REFRESH FEED
        loadRecentSideFeed();

    } catch (e) {
        console.error(e);
        if (!navigator.onLine) {
            showToast("Tersimpan Offline", "Data catatan tersimpan di browser/HP Anda dan akan otomatis terkirim saat online.", "warning");
        } else {
            showToast("Gagal", "Gagal menyimpan data: " + e.message, "error");
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = oldText;
    }
};

async function updatePermissionCount(studentNIS) {
    const countEl = document.getElementById('piket-perm-count');
    if (!countEl) return;

    countEl.innerText = "...";

    try {
        const agg = await cfClient.getStudentAggregateByNis(studentNIS);
        const total = agg?.permission_count || 0;
        countEl.innerText = total + " kali";

        const box = document.getElementById('info-piket-box');
        if (total > 10) {
            box.classList.replace('bg-blue-50', 'bg-red-50');
            box.classList.replace('dark:bg-blue-900/10', 'dark:bg-red-900/20');
            box.classList.replace('border-blue-500', 'border-red-500');
            box.querySelector('h4')?.classList.replace('text-blue-800', 'text-red-800');
            box.querySelector('h4')?.classList.replace('dark:text-blue-300', 'dark:text-red-300');
            box.querySelector('p')?.classList.replace('text-blue-700', 'text-red-700');
            box.querySelector('p')?.classList.replace('dark:text-blue-400', 'dark:text-red-400');
            box.querySelector('i')?.classList.replace('text-blue-500', 'text-red-500');
        } else {
            // Revert changes back to blue if < 10, without resetting entire className
            box.classList.replace('bg-red-50', 'bg-blue-50');
            box.classList.replace('dark:bg-red-900/20', 'dark:bg-blue-900/10');
            box.classList.replace('border-red-500', 'border-blue-500');
            box.querySelector('h4').classList.replace('text-red-800', 'text-blue-800');
            box.querySelector('h4').classList.replace('dark:text-red-300', 'dark:text-blue-300');
            box.querySelector('p').classList.replace('text-red-700', 'text-blue-700');
            box.querySelector('p').classList.replace('dark:text-red-400', 'dark:text-blue-400');
            box.querySelector('i').classList.replace('text-red-500', 'text-blue-500');

            // Fallback: if classes were not replaced (because they were already blue or initial load), ensure they exist
            // This is safer than = className
            if (!box.classList.contains('bg-blue-50')) box.classList.add('bg-blue-50');
            if (!box.classList.contains('dark:bg-blue-900/10')) {
                // Ganti (bukan tumpuk) latar dark dasar dari HTML agar tidak kalah urutan CSS Tailwind build
                box.classList.remove('dark:bg-blue-900/30');
                box.classList.add('dark:bg-blue-900/10');
            }
            if (!box.classList.contains('border-blue-500')) box.classList.add('border-blue-500');
        }

        // Visibility handled in selectStudentByNIS now to coordinate with animation


    } catch (e) { console.error("Gagal hitung permisi:", e); }
}

let violationCache = [];
async function loadViolationMaster() {
    // CEK MEMORY CACHE DULU
    if (violationCache.length > 0) {
        initAllViolationRows();
        return;
    }

    // CEK LOCALSTORAGE CACHE (TTL 30 JAM)
    try {
        const cached = localStorage.getItem(CACHE_KEYS.VIOLATION_TYPES);
        if (cached) {
            const { data, timestamp } = JSON.parse(cached);
            const now = Date.now();
            if (now - timestamp < TTL_30_HOURS && data && data.length > 0) {
                console.log('📦 [CACHE] Violation types loaded from localStorage');
                violationCache = data;
                initAllViolationRows();
                return;
            }
        }
    } catch (e) {
        console.warn('[CACHE] Error reading violation cache:', e);
    }

    // FETCH DARI CLOUDFLARE D1 (0 FIRESTORE READ)
    violationCache = [];

    try {
        console.log('🔄 [EDGE] Fetching violation types from Cloudflare D1...');
        const types = await cfClient.getViolationTypes();
        violationCache = types || [];

        // SIMPAN KE CACHE
        try {
            localStorage.setItem(CACHE_KEYS.VIOLATION_TYPES, JSON.stringify({
                data: violationCache,
                timestamp: Date.now()
            }));
            console.log('💾 [CACHE] Violation types saved to localStorage');
        } catch (e) {
            console.warn('[CACHE] Failed to save violation cache:', e);
        }

        initAllViolationRows();
    } catch (e) { console.error("Gagal load pelanggaran dari D1:", e); }
}

// Render dropdown custom pelanggaran sesuai dengan input search
function renderViolationDropdown(searchText, dropdownEl, searchInput, row) {
    dropdownEl.innerHTML = '';

    const query = searchText.toLowerCase();
    const filtered = violationCache.filter(v =>
        v.title.toLowerCase().includes(query) ||
        v.code.toLowerCase().includes(query)
    );

    if (filtered.length === 0 && query !== '') {
        dropdownEl.innerHTML = '<div class="p-3 text-sm text-slate-500 text-center">Tidak ditemukan</div>';
    } else {
        const toShow = query === '' ? violationCache : filtered.slice(0, 50);

        toShow.forEach(v => {
            const item = document.createElement('div');
            item.className = 'p-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer border-b border-slate-100 dark:border-slate-700/50 last:border-0 transition-colors flex items-start gap-3';
            item.innerHTML = `
                <div class="w-8 h-8 rounded-full bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 flex items-center justify-center font-bold shrink-0 text-xs shadow-sm">
                    ${window.escapeHTML(v.points)}
                </div>
                <div class="flex-1 flex items-center">
                    <div class="font-bold text-slate-800 dark:text-slate-200 text-sm leading-tight">${window.escapeHTML(v.code)} - ${window.escapeHTML(v.title)}</div>
                </div>
            `;

            // Klik item list pelanggaran
            item.addEventListener('click', () => {
                searchInput.value = `${v.code} | ${v.title}`;
                const pointsInput = row.querySelector('.violation-points-input');
                const descInput = row.querySelector('.violation-desc-input');

                pointsInput.value = v.points;
                pointsInput.readOnly = false;
                descInput.value = v.title;

                searchInput.classList.remove('ring-2', 'ring-red-500');
                dropdownEl.classList.add('hidden');

                if (typeof updateTotalPoints === 'function') updateTotalPoints();
            });

            dropdownEl.appendChild(item);
        });
    }

    // Tambahan Opsi Manual Mode
    const manualItem = document.createElement('div');
    manualItem.className = 'p-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer transition-colors flex items-center justify-center gap-2 bg-slate-50 dark:bg-slate-800/80 font-bold text-slate-600 dark:text-slate-400 text-sm border-t border-slate-200 dark:border-slate-700';
    manualItem.innerHTML = `<i class="fa-solid fa-pen"></i> Lainnya / Input Manual`;
    manualItem.addEventListener('click', () => {
        searchInput.value = "Lainnya / Input Manual";
        const pointsInput = row.querySelector('.violation-points-input');
        const descInput = row.querySelector('.violation-desc-input');

        setupManualMode(pointsInput, descInput);
        dropdownEl.classList.add('hidden');
        if (typeof updateTotalPoints === 'function') updateTotalPoints();
    });
    dropdownEl.appendChild(manualItem);

    dropdownEl.classList.remove('hidden');
}

// Inisialisasi listener untuk semua baris pelanggaran yang ada
function initAllViolationRows() {
    const rows = document.querySelectorAll('.violation-row');
    rows.forEach(row => {
        if (!row.dataset.initialized) {
            initViolationRowListener(row);
            row.dataset.initialized = 'true';
        }
    });
}

// Inisialisasi listener untuk satu baris pelanggaran
function initViolationRowListener(row) {
    const searchInput = row.querySelector('.violation-search-input');
    const dropdownEl = row.querySelector('.violation-dropdown');
    const descInput = row.querySelector('.violation-desc-input');
    const pointsInput = row.querySelector('.violation-points-input');

    if (!searchInput || !dropdownEl) return;

    // Menampilkan & memfilter hasil saat diketik
    searchInput.addEventListener('input', (e) => {
        const val = e.target.value;
        if (val === '') {
            pointsInput.value = "0";
            descInput.value = "";
            if (typeof updateTotalPoints === 'function') updateTotalPoints();
        }
        renderViolationDropdown(val, dropdownEl, searchInput, row);
    });

    // Tampilkan selalu walau hanya fokus (belum mengetik)
    searchInput.addEventListener('focus', (e) => {
        renderViolationDropdown(e.target.value, dropdownEl, searchInput, row);
    });

    // Update total poin saat user edit manual poin
    pointsInput.addEventListener('input', () => updateTotalPoints());
}

function setupManualMode(inputPoints, inputDesc) {
    inputPoints.readOnly = false;
    inputPoints.value = "";
    inputPoints.placeholder = "Poin";
    inputPoints.className = "violation-points-input w-full p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg font-bold text-red-600 dark:text-red-400 text-center bg-white dark:bg-slate-700 ring-2 ring-blue-200 dark:ring-blue-900/50 focus:ring-blue-500";
    inputPoints.focus();
    inputDesc.value = "";
    inputDesc.placeholder = "Tulis detail pelanggaran...";
    inputDesc.className = "violation-desc-input w-full p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 ring-2 ring-blue-200 dark:ring-blue-900/50 focus:ring-blue-500 placeholder:text-slate-400 dark:placeholder:text-slate-500";
}

// --- MULTI-VIOLATION: Tambah / Hapus / Total Poin ---
let violationRowCounter = 1; // Dimulai dari 1 karena baris pertama sudah ada

window.addViolationRow = function () {
    if (!canInputViolation()) {
        showToast("Akses Ditolak", "Guru Mapel, Wali Kelas, dan Staff tidak memiliki akses untuk menambah pelanggaran.", "error");
        return;
    }
    violationRowCounter++;
    const container = document.getElementById('violation-items');
    const idx = violationRowCounter;

    const row = document.createElement('div');
    row.className = 'violation-row bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 rounded-lg p-3 space-y-3 animate-fade-in';
    row.dataset.index = idx;
    row.innerHTML = `
        <div class="flex items-center justify-between">
            <span class="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase">Pelanggaran #${container.children.length + 1}</span>
            <button type="button" onclick="window.removeViolationRow(this)"
                class="w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/30 text-red-500 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-800/50 flex items-center justify-center text-xs transition-all hover:scale-110"
                title="Hapus baris ini">
                <i class="fa-solid fa-times"></i>
            </button>
        </div>
        <div>
            <label class="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">Cari Jenis Pelanggaran</label>
            <div class="relative">
                <input type="text" name="violation-search"
                    class="violation-search-input w-full p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/50 outline-none transition-all placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm"
                    placeholder="Ketik nama pelanggaran..." autocomplete="off">
                <div class="violation-dropdown hidden absolute z-50 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl max-h-80 overflow-y-auto">
                    <!-- Populated by JS -->
                </div>
            </div>
        </div>
        <div class="grid grid-cols-4 gap-3">
            <div class="col-span-3">
                <label class="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">Keterangan Detail</label>
                <input type="text" name="desc-violation"
                    class="violation-desc-input w-full p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-colors"
                    placeholder="Pilih jenis pelanggaran dulu...">
            </div>
            <div>
                <label class="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">Poin</label>
                <input type="number" inputmode="numeric" name="input-points"
                    class="violation-points-input w-full p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg font-bold text-red-600 dark:text-red-400 text-center bg-white dark:bg-slate-700"
                    value="0" min="0">
            </div>
        </div>
    `;

    container.appendChild(row);
    initViolationRowListener(row);
    row.dataset.initialized = 'true';

    // Focus ke search input baris baru
    row.querySelector('.violation-search-input').focus();
};

window.removeViolationRow = function (btn) {
    const row = btn.closest('.violation-row');
    if (row) {
        row.classList.add('opacity-0', 'scale-95');
        row.style.transition = 'all 0.2s ease';
        setTimeout(() => {
            row.remove();
            renumberViolationRows();
            updateTotalPoints();
        }, 200);
    }
};

function renumberViolationRows() {
    const rows = document.querySelectorAll('#violation-items .violation-row');
    rows.forEach((row, i) => {
        const label = row.querySelector('.text-slate-400');
        if (label) label.textContent = `Pelanggaran #${i + 1}`;
    });
}

function updateTotalPoints() {
    const inputs = document.querySelectorAll('#violation-items .violation-points-input');
    let total = 0;
    inputs.forEach(inp => { total += parseInt(inp.value) || 0; });
    const el = document.getElementById('violation-total-points');
    if (el) el.textContent = total;
}

// Reset violation rows ke 1 baris default
function resetViolationRows() {
    const container = document.getElementById('violation-items');
    if (!container) return;

    // Hapus semua baris kecuali pertama
    const rows = container.querySelectorAll('.violation-row');
    rows.forEach((row, i) => {
        if (i > 0) row.remove();
    });

    // Reset baris pertama
    const firstRow = container.querySelector('.violation-row');
    if (firstRow) {
        const search = firstRow.querySelector('.violation-search-input');
        const desc = firstRow.querySelector('.violation-desc-input');
        const pts = firstRow.querySelector('.violation-points-input');
        if (search) search.value = '';
        if (desc) { desc.value = ''; desc.placeholder = 'Pilih jenis pelanggaran dulu...'; }
        if (pts) { pts.value = '0'; pts.readOnly = false; }
    }

    violationRowCounter = 1;
    updateTotalPoints();
}

// --- 3. KONFIRMASI SIMPAN (REVISI: PAKE NIS) ---
window.confirmSaveActivity = () => {
    const inputType = document.getElementById('active-type')?.value || 'violation';
    if (inputType === 'violation' && !canInputViolation()) {
        showToast("Akses Ditolak", "Guru Mapel, Wali Kelas, dan Staff tidak memiliki akses untuk menginput data pelanggaran.", "error");
        return;
    }

    // Cek variabel NIS, bukan ID lagi
    if (!selectedStudentNIS) {
        const searchInput = document.getElementById('student-search');
        searchInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        searchInput.focus();
        // Latar merah menggantikan latar dasar (bg-white menang urutan CSS Tailwind build)
        searchInput.classList.remove('bg-white');
        searchInput.classList.add('ring-2', 'ring-red-500', 'bg-red-50');
        return;
    }
    document.getElementById('modal-confirm-activity').classList.remove('hidden');
};

async function loadClassOptions() {
    const select = document.getElementById('filter-history-class');

    try {
        // Gunakan helper global terpusat (hemat Firestore, pakai cache)
        const list = await window.getActiveClasses();

        if (list && list.length > 0) {
            // Extract unique grade levels (X, XI, XII)
            const grades = new Set();
            list.forEach(c => {
                const grade = c.split('-')[0];
                if (grade) grades.add(grade);
            });

            let html = '<option value="">-- Semua Kelas --</option>';

            // Tambahkan opsi angkatan
            Array.from(grades).sort((a, b) => {
                const order = { 'X': 1, 'XI': 2, 'XII': 3 };
                return (order[a] || 99) - (order[b] || 99);
            }).forEach(g => {
                html += `<option value="ALL-${g}" class="bg-blue-50 font-bold">📚 Angkatan ${g} (Semua)</option>`;
            });

            // Separator
            html += '<option disabled>───────────</option>';

            // Tambahkan kelas individual
            list.forEach(c => html += `<option value="${c}">${c}</option>`);
            select.innerHTML = html;
        }
    } catch (e) { console.error(e); }
}


let currentHistoryDocs = [];

window.loadHistoryByFilter = async () => {
    const classVal = document.getElementById('filter-history-class').value;
    const categoryVal = document.getElementById('filter-history-category')?.value || '';
    const startVal = document.getElementById('filter-date-start').value;
    const endVal = document.getElementById('filter-date-end').value;
    const tbody = document.getElementById('history-table-body');

    if (!startVal || !endVal) { document.getElementById('filter-date-start').focus(); return; }

    tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>';

    try {
        const startDateStr = startVal;
        const endDateStr = endVal;

        const categoryMap = { 'violation': 'Pelanggaran', 'permission': 'Permisi', 'achievement': 'Prestasi' };
        const categoryFilter = categoryVal ? (categoryMap[categoryVal] || categoryVal) : undefined;

        // FETCH DARI CLOUDFLARE D1 (0 FIRESTORE READ)
        let docs = await cfClient.getRecords({
            class: (classVal && !classVal.startsWith('ALL-')) ? classVal : undefined,
            category: categoryFilter,
            date_start: startDateStr,
            date_end: endDateStr,
            limit: classVal && classVal.startsWith('ALL-') ? 200 : 100
        });

        // Filter client-side HANYA untuk angkatan (prefix matching)
        if (classVal && classVal.startsWith('ALL-')) {
            const grade = classVal.replace('ALL-', '');
            docs = docs.filter(r => (r.studentClass || r.student_class) && (r.studentClass || r.student_class).startsWith(grade + '-'));
        }

        currentHistoryDocs = docs || [];

        if (docs.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-slate-400 dark:text-slate-500">Tidak ada data pada periode ini.</td></tr>'; return; }

        let html = '';
        docs.forEach((r, index) => {
            const docId = r.id;
            const timeObj = r.timestamp?.toDate ? r.timestamp.toDate() : (r.timestampIso ? new Date(r.timestampIso) : (r.date ? new Date(r.date) : null));
            const dateStr = timeObj ? timeObj.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: '2-digit' }) : (r.date || '-');

            let badgeClass = 'bg-gray-100 dark:bg-gray-800/80 text-gray-600 dark:text-gray-400';
            if (r.category === 'Pelanggaran') badgeClass = 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400';
            else if (r.category === 'Prestasi') badgeClass = 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400';
            else if (r.category === 'Permisi') badgeClass = 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400';

            const pointsDisplay = r.points ? `+${r.points}` : '-';
            const sNis = r.studentNIS || r.student_nis || '';
            const sName = r.studentName || r.student_name || '';
            const sClass = r.studentClass || r.student_class || '';

            // Creator info
            const creator = r.createdBy ? `<div class="text-[10px] text-slate-400 dark:text-slate-500">oleh: ${window.escapeHTML(r.createdBy)}</div>` : '';

            // ACTION BUTTONS (Owner atau Super Admin)
            const isSuperAdmin = window.hasRole ? window.hasRole('super_admin') : localStorage.getItem('user_role') === 'super_admin';
            let actionButtons = '-';
            const reporterUid = String(r.reporterUID || r.reporter_uid || '').trim();
            const isOwner = reporterUid ? reporterUid === auth.currentUser?.uid : r.createdBy === currentUserName;
            if (isOwner || isSuperAdmin) {
                actionButtons = `
                <div class="flex justify-center gap-2">
                    <button onclick="window.editActivity('${docId}')" class="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 p-1" title="Edit">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button onclick="window.deleteActivity('${docId}', '${sNis}', ${r.points || 0}, '${r.category}')" class="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 p-1" title="Hapus">
                         <i class="fa-solid fa-trash"></i>
                    </button>
                </div>`;
            }

            let descContent = `<div class="text-slate-700 dark:text-slate-300 text-sm whitespace-normal break-words">${window.escapeHTML(r.desc || '')}</div>`;
                if (r.category === 'Prestasi') {
                    const comp = r.competition_name || r.competitionName;
                    const fld = r.field;
                    const lvl = r.level || r.type;
                    const rnk = r.rank;
                    const org = r.organizer;
                    const mentor = r.mentor_name || r.mentorName;
                    const evidence = r.evidence_url || r.evidenceUrl;
                    const cert = r.certificate_no || r.certificateNo;
                    const partType = r.participation_type || r.participationType;
                    const tName = r.team_name || r.teamName;

                    if (comp || fld || rnk) {
                        descContent = `
                            <div class="space-y-1 text-left">
                                <div class="flex flex-wrap items-center gap-1.5 mb-1">
                                    ${rnk ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60"><i class="fa-solid fa-medal mr-1"></i>${window.escapeHTML(rnk)}</span>` : ''}
                                    ${fld ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60"><i class="fa-solid fa-shapes mr-1"></i>${window.escapeHTML(fld)}</span>` : ''}
                                    ${lvl ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60"><i class="fa-solid fa-layer-group mr-1"></i>${window.escapeHTML(lvl)}</span>` : ''}
                                    ${partType === 'Beregu' ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60"><i class="fa-solid fa-users mr-1"></i>Beregu${tName ? `: ${window.escapeHTML(tName)}` : ''}</span>` : ''}
                                </div>
                                <div class="font-bold text-slate-800 dark:text-slate-100 text-xs sm:text-sm">
                                    ${window.escapeHTML(comp || r.desc || '-')}
                                </div>
                                <div class="text-[11px] text-slate-500 dark:text-slate-400 space-y-0.5">
                                    ${org ? `<div><span class="font-medium text-slate-600 dark:text-slate-300">Penyelenggara:</span> ${window.escapeHTML(org)}</div>` : ''}
                                    ${mentor ? `<div><span class="font-medium text-slate-600 dark:text-slate-300">Pembina:</span> ${window.escapeHTML(mentor)}</div>` : ''}
                                    ${cert ? `<div><span class="font-medium text-slate-600 dark:text-slate-300">No. SK/Piagam:</span> <span class="font-mono text-[10px]">${window.escapeHTML(cert)}</span></div>` : ''}
                                </div>
                                ${evidence ? `
                                    <div class="pt-1">
                                        <a href="${window.escapeHTML(evidence)}" target="_blank" rel="noopener noreferrer"
                                           class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition-colors">
                                            <i class="fa-solid fa-arrow-up-right-from-square"></i>
                                            <span>Buka Bukti Piagam / Dokumen</span>
                                        </a>
                                    </div>
                                ` : ''}
                            </div>
                        `;
                    }
                }

                html += `
            <tr class="border-b border-slate-100 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <td data-label="No" class="p-3 text-center text-slate-500 dark:text-slate-400 font-mono text-xs hidden md:table-cell">${index + 1}</td>
                <td data-label="Waktu" class="p-3 text-slate-500 dark:text-slate-400 font-mono whitespace-nowrap text-xs">${dateStr}</td>
                <td data-label="Siswa" class="p-3 whitespace-nowrap">
                    <div class="font-bold text-slate-700 dark:text-slate-200">
                        <a href="siswa.html?nis=${window.escapeHTML(sNis)}" class="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline">${window.escapeHTML(sName)}</a>
                    </div>
                    <div class="text-[10px] text-slate-400 dark:text-slate-500">${window.escapeHTML(sClass)} &bull; ${window.escapeHTML(sNis)}</div>
                </td>
                <td data-label="Kategori" class="p-3 whitespace-nowrap"><span class="px-2 py-1 rounded text-[10px] font-bold uppercase ${badgeClass}">${window.escapeHTML(r.category)}</span></td>
                <td data-label="Keterangan" class="p-3">
                    ${descContent}
                    ${creator} 
                </td>
                <td data-label="Poin" class="p-3 text-right font-bold text-red-600 dark:text-red-400 font-mono whitespace-nowrap">${pointsDisplay}</td>
                <td data-label="Aksi" class="p-3 text-center whitespace-nowrap">${actionButtons}</td>
            </tr>`;
        });
        tbody.innerHTML = html;
    } catch (e) { console.error(e); tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-red-500">Error: ${window.escapeHTML(e.message)}</td></tr>`; }
};

window.exportHistoryToExcel = function () {
    if (typeof XLSX === 'undefined') {
        showToast("Error", "Library Excel belum dimuat. Silakan refresh halaman.", "error");
        return;
    }

    if (!currentHistoryDocs || currentHistoryDocs.length === 0) {
        showToast("Info", "Tidak ada data riwayat untuk diexport. Silakan tampilkan data terlebih dahulu.", "info");
        return;
    }

    try {
        const rows = currentHistoryDocs.map((r, index) => {
            const timeObj = r.timestamp?.toDate ? r.timestamp.toDate() : (r.timestampIso ? new Date(r.timestampIso) : (r.date ? new Date(r.date) : null));
            const dateStr = timeObj ? timeObj.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : (r.date || '-');
            const sNis = r.studentNIS || r.student_nis || '-';
            const sName = r.studentName || r.student_name || '-';
            const sClass = r.studentClass || r.student_class || '-';
            const points = r.points || 0;
            const category = r.category || '-';
            const desc = r.desc || '-';
            const creator = r.createdBy || '-';

            const baseRow = {
                'No': index + 1,
                'Tanggal / Waktu': dateStr,
                'NIS': sNis,
                'Nama Siswa': sName,
                'Kelas': sClass,
                'Kategori': category,
                'Keterangan': desc,
                'Poin': points,
                'Dicatat Oleh': creator
            };

            if (category === 'Prestasi') {
                baseRow['Nama Lomba / Kegiatan'] = r.competition_name || r.competitionName || '-';
                baseRow['Bidang'] = r.field || '-';
                baseRow['Tingkat'] = r.level || r.type || '-';
                baseRow['Peringkat / Juara'] = r.rank || '-';
                baseRow['Penyelenggara'] = r.organizer || '-';
                baseRow['Jenis Kepesertaan'] = r.participation_type || r.participationType || 'Individu';
                baseRow['Nama Tim'] = r.team_name || r.teamName || '-';
                baseRow['Guru Pembina'] = r.mentor_name || r.mentorName || '-';
                baseRow['No. Sertifikat'] = r.certificate_no || r.certificateNo || '-';
                baseRow['Tautan Bukti'] = r.evidence_url || r.evidenceUrl || '-';
            }

            return baseRow;
        });

        const worksheet = XLSX.utils.json_to_sheet(rows);
        worksheet['!cols'] = [
            { wch: 6 },  // No
            { wch: 20 }, // Tanggal / Waktu
            { wch: 12 }, // NIS
            { wch: 28 }, // Nama Siswa
            { wch: 12 }, // Kelas
            { wch: 15 }, // Kategori
            { wch: 45 }, // Keterangan
            { wch: 8 },  // Poin
            { wch: 22 }, // Dicatat Oleh
            { wch: 30 }, // Nama Lomba
            { wch: 18 }, // Bidang
            { wch: 15 }, // Tingkat
            { wch: 15 }, // Peringkat
            { wch: 25 }, // Penyelenggara
            { wch: 15 }, // Jenis Kepesertaan
            { wch: 20 }, // Nama Tim
            { wch: 25 }, // Guru Pembina
            { wch: 22 }, // No. Sertifikat
            { wch: 35 }  // Tautan Bukti
        ];

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Data Riwayat');

        const classVal = document.getElementById('filter-history-class')?.value || 'Semua';
        const startVal = document.getElementById('filter-date-start')?.value || '';
        const endVal = document.getElementById('filter-date-end')?.value || '';
        const safeClass = classVal.replace(/[^a-zA-Z0-9_-]/g, '_');
        const filename = `Riwayat_Catatan_Siswa_${safeClass}_${startVal}_sd_${endVal}.xlsx`;

        XLSX.writeFile(workbook, filename);
        showToast("Sukses", "Data riwayat berhasil diexport ke Excel.", "success");
    } catch (err) {
        console.error("Error exporting to Excel:", err);
        showToast("Gagal", "Gagal export data ke Excel: " + err.message, "error");
    }
};

window.loadRecentSideFeed = async function () {
    const container = document.getElementById('recent-activity-feed');
    try {
        const docs = await cfClient.getRecords({ limit: 10, order: 'DESC' });

        if (!docs || docs.length === 0) { container.innerHTML = '<div class="p-6 text-center text-slate-400 dark:text-slate-500 text-xs italic">Belum ada data.</div>'; return; }

        let html = '<div class="divide-y divide-slate-100 dark:divide-slate-700/50">';
        docs.forEach(r => {
            const timeObj = r.timestamp?.toDate ? r.timestamp.toDate() : (r.timestampIso ? new Date(r.timestampIso) : (r.createdAt?.toDate ? r.createdAt.toDate() : new Date()));
            const now = new Date();
            const isToday = timeObj.getDate() === now.getDate() && timeObj.getMonth() === now.getMonth() && timeObj.getFullYear() === now.getFullYear();
            const timeDisplay = isToday ? timeObj.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : timeObj.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });

            let color = 'gray'; let icon = 'circle';
            if (r.category === 'Pelanggaran') { color = 'red'; icon = 'circle-exclamation'; }
            else if (r.category === 'Permisi') { color = 'blue'; icon = 'person-walking-arrow-right'; }
            else if (r.category === 'Prestasi') { color = 'green'; icon = 'trophy'; }

            const sName = r.studentName || r.student_name || '';
            const sClass = r.studentClass || r.student_class || '';
            const sNis = r.studentNIS || r.student_nis || '';

            html += `
            <div class="p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition group">
                <div class="flex gap-3">
                    <div class="w-8 h-8 rounded-full bg-${color}-50 dark:bg-${color}-900/30 border border-${color}-100 dark:border-${color}-800/50 flex items-center justify-center text-${color}-500 dark:text-${color}-400 shrink-0 mt-0.5">
                        <i class="fa-solid fa-${icon} text-xs"></i>
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex justify-between items-start">
                            <h4 class="text-xs font-bold truncate pr-2">
                                <a href="siswa.html?nis=${window.escapeHTML(sNis)}" class="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline">${window.escapeHTML(sName)}</a> <span class="font-normal text-slate-400 dark:text-slate-500">(${window.escapeHTML(sClass)})</span>
                            </h4>
                            <span class="text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap bg-slate-100 dark:bg-slate-800 border dark:border-slate-700 px-1.5 rounded">${timeDisplay}</span>
                        </div>
                        <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2 leading-snug">
                            ${window.escapeHTML(r.desc || '')}
                        </p>
                        ${r.points ? `<div class="mt-1 text-[10px] font-bold text-red-500 dark:text-red-400 text-right">+${r.points} Poin</div>` : ''}
                    </div>
                </div>
            </div>`;
        });
        html += '</div>'; container.innerHTML = html;
    } catch (e) { console.error(e); }
};


// Sistem double-click confirm untuk hapus record (menggantikan confirm() browser)
let deleteRecordTarget = null;
let deleteRecordTimeout = null;

window.deleteRecord = async function (id) {
    // Jika klik pertama atau ID berbeda, set sebagai target
    if (deleteRecordTarget !== id) {
        deleteRecordTarget = id;
        showToast("Konfirmasi", "Klik tombol hapus sekali lagi dalam 3 detik untuk menghapus.", "warning");

        // Reset target setelah 3 detik
        if (deleteRecordTimeout) clearTimeout(deleteRecordTimeout);
        deleteRecordTimeout = setTimeout(() => {
            deleteRecordTarget = null;
        }, 3000);
        return;
    }

    // Klik kedua pada ID yang sama - eksekusi hapus via Cloudflare D1
    try {
        let oldRecordData = null;
        try {
            oldRecordData = await cfClient.getRecordById(id);
        } catch (err) {
            console.warn("Gagal fetch data record lama (audit trail):", err);
        }

        await cfClient.deleteRecord(id);
        if (typeof window.logAudit === 'function') {
            window.logAudit('DELETE_RECORD', id, oldRecordData, null, 'Menghapus catatan history jurnal/pelanggaran siswa');
        }
        showToast("Terhapus", "Catatan berhasil dihapus dari Cloudflare D1.", "success");
        loadHistoryByFilter();
    } catch (e) {
        showToast("Gagal", "Gagal hapus: " + e.message, "error");
    } finally {
        deleteRecordTarget = null;
        if (deleteRecordTimeout) clearTimeout(deleteRecordTimeout);
    }
};

// =====================================
// TWO-STEP PERMISSION FUNCTIONS (GURU PIKET)
// =====================================

// Cek apakah fitur Two-Step Permission aktif (DENGAN CACHE GLOBAL TERPUSAT)
async function checkTwoStepPermission() {
    try {
        const configData = await window.getSystemConfig();

        if (configData) {
            twoStepPermissionEnabled = configData.twoStepPermission || false;
        }

        const tabPerm = document.getElementById('tab-permission');
        const piketSection = document.getElementById('piket-approved-section');

        if (twoStepPermissionEnabled) {
            // Sembunyikan tab permisi manual
            if (tabPerm) tabPerm.classList.add('hidden');

            // Tampilkan section approved requests
            if (piketSection) piketSection.classList.remove('hidden');

            // Update grid tabs menjadi 2 kolom (tanpa permisi)
            const tabContainer = document.getElementById('type-selection-container')?.querySelector('.grid');
            if (tabContainer) {
                tabContainer.classList.remove('grid-cols-3');
                tabContainer.classList.add('grid-cols-2');
            }

            // Load approved requests
            await loadApprovedPermissionRequests();
        } else {
            // Tampilkan tab permisi manual
            if (tabPerm) tabPerm.classList.remove('hidden');

            // Sembunyikan section approved requests
            if (piketSection) piketSection.classList.add('hidden');

            // Kembalikan grid tabs ke 3 kolom (jika sebelumnya diubah)
            const tabContainer = document.getElementById('type-selection-container')?.querySelector('.grid');
            if (tabContainer) {
                tabContainer.classList.remove('grid-cols-2');
                tabContainer.classList.add('grid-cols-3');
            }
        }
    } catch (e) {
        console.error("Error checking two-step permission:", e);
    }
}

// Load pengajuan yang sudah disetujui wali kelas (menunggu ACC piket)
window.loadApprovedPermissionRequests = async function () {
    if (!twoStepPermissionEnabled) return;

    const container = document.getElementById('piket-approved-list');
    const badge = document.getElementById('badge-piket-pending');

    if (!container) return;

    container.innerHTML = `<div class="text-center text-slate-400 py-4 text-xs">
        <i class="fa-solid fa-spinner fa-spin mr-1"></i> Memuat...
    </div>`;

    try {
        const today = window.getLocalISODate(new Date());

        let requests = [];
        if (cfClient && cfClient.enabled) {
            const raw = await cfClient.getPermisiRequests({
                date: today,
                status: 'wali_approved'
            });
            if (Array.isArray(raw)) {
                requests = raw.map(r => ({
                    id: r.id,
                    data: {
                        studentNIS: r.student_nis,
                        studentName: r.student_name,
                        studentClass: r.student_class,
                        reason: r.reason,
                        requestTime: r.time_out,
                        waliApprovedBy: r.wali_approved_by
                    }
                }));
            }
        }

        if (requests.length === 0) {
            badge?.classList.add('hidden');
            container.innerHTML = `
                <div class="text-center py-4">
                    <i class="fa-solid fa-inbox text-slate-300 dark:text-slate-600 text-xl mb-2"></i>
                    <p class="text-slate-400 dark:text-slate-500 text-xs">Tidak ada pengajuan menunggu</p>
                </div>
            `;
            return;
        }

        if (badge) {
            badge.innerText = requests.length;
            badge.classList.remove('hidden');
        }

        let html = '<div class="space-y-2">';

        requests.forEach(docSnap => {
            const d = docSnap.data;

            html += `
                <div class="p-3 rounded-lg border border-blue-200 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-900/20 hover:bg-blue-50 dark:hover:bg-blue-900/40 transition">
                    <div class="flex items-start justify-between gap-2">
                        <div class="flex-1">
                            <p class="font-bold text-slate-800 dark:text-slate-200 text-sm">${window.escapeHTML(d.studentName)}</p>
                            <p class="text-[10px] text-slate-500 dark:text-slate-400">${window.escapeHTML(d.studentClass)} &bull; Jam ${window.escapeHTML(d.requestTime)}</p>
                            <p class="text-xs text-slate-600 dark:text-slate-300 mt-1 line-clamp-2">${window.escapeHTML(d.reason)}</p>
                            <p class="text-[9px] text-blue-600 dark:text-blue-400 mt-1">
                                <i class="fa-solid fa-check-circle mr-1"></i> ACC: ${window.escapeHTML(d.waliApprovedBy || 'Wali Kelas')}
                            </p>
                        </div>
                        <button onclick="finalizePermission('${docSnap.id}', '${window.escapeHTML(d.studentNIS)}')"
                            class="px-2 py-1 bg-green-600 dark:bg-green-600 text-white text-[10px] font-bold rounded hover:bg-green-700 dark:hover:bg-green-500 shadow-sm transition whitespace-nowrap">
                            <i class="fa-solid fa-person-walking-arrow-right"></i> Proses
                        </button>
                    </div>
                </div>
            `;
        });

        html += '</div>';
        container.innerHTML = html;

    } catch (e) {
        console.error("Load Approved Requests Error:", e);
        container.innerHTML = `
            <div class="text-center text-red-500 py-4 text-xs">
                <i class="fa-solid fa-triangle-exclamation mr-1"></i> Gagal memuat
            </div>
        `;
    }
};

// Finalize permission (ACC Piket) via Cloudflare D1
window.finalizePermission = async function (requestId, studentNIS) {
    try {
        const piketName = currentUserName || 'Guru Piket';
        const actualTime = new Date().toTimeString().substring(0, 5);

        if (cfClient && cfClient.enabled) {
            await cfClient.processPiketPermisi(requestId, 'approve', piketName, actualTime);
        }

        if (typeof window.logAudit === 'function') {
            window.logAudit('FINALIZE_PERMISSION', 'permisi_requests', requestId, null, `Guru piket memproses izin keluar siswa NIS ${studentNIS} jam ${actualTime}`);
        }

        showToast("Berhasil", "Izin permisi diproses! Siswa diperbolehkan keluar.", "success");
        await loadApprovedPermissionRequests();

    } catch (e) {
        console.error("Finalize Permission Error:", e);
    }
};

// --- 5. EDIT & HAPUS ---
// --- 5. EDIT & HAPUS --- (REVISED)
let deleteActivityTarget = null; // Temp storage for delete parameters

window.deleteActivity = (docId, nis, points, category) => {
    // Simpan parameter ke variable global sementara
    deleteActivityTarget = { docId, nis, points, category };

    const confirmText = document.getElementById('delete-confirm-text');
    if (confirmText) {
        if (category === 'Pelanggaran') {
            confirmText.textContent = `Apakah Anda yakin ingin menghapus catatan pelanggaran ini? Poin (${points || 0}) yang tercatat akan dikembalikan.`;
        } else if (category === 'Prestasi') {
            confirmText.textContent = `Apakah Anda yakin ingin menghapus catatan prestasi ini?`;
        } else if (category === 'Permisi') {
            confirmText.textContent = `Apakah Anda yakin ingin menghapus catatan izin permisi ini?`;
        } else {
            confirmText.textContent = `Apakah Anda yakin ingin menghapus data ini? Poin yang sudah tercatat akan dikembalikan.`;
        }
    }

    // Tampilkan Modal
    const modal = document.getElementById('modal-confirm-delete');
    if (modal) {
        modal.classList.remove('hidden');
        // Opsional: Focus ke tombol hapus biar bisa langsung enter
        setTimeout(() => {
            const btn = document.getElementById('btn-confirm-delete-action');
            if (btn) btn.focus();
        }, 100);
    } else {
        console.error("Modal delete not found!");
        // Fallback if modal missing (safety)
        if (typeof window.showConfirmModal === 'function') {
            window.showConfirmModal("Hapus data ini? Aksi ini tidak dapat dibatalkan.", "Hapus Catatan", "danger").then(ok => {
                if (ok) window.executeDeleteActivity();
            });
        }
    }
};

// Fungsi Eksekusi Asli (Dipanggil dari tombol "Ya, Hapus" di Modal)
window.executeDeleteActivity = async () => {
    // Fallback direct params if globals are null (prevent error)
    if (!deleteActivityTarget) {
        console.warn("No delete target");
        return;
    }

    const { docId, nis, points, category } = deleteActivityTarget;
    const btnConfirm = document.getElementById('btn-confirm-delete-action');
    const originalText = btnConfirm ? btnConfirm.innerHTML : 'Delete';

    if (btnConfirm) {
        btnConfirm.disabled = true;
        btnConfirm.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Hapus...';
    }

    try {
        // HAPUS RECORD DI CLOUDFLARE D1 (Otomatis recalculate agregat poin)
        await cfClient.deleteRecord(docId);

        const modal = document.getElementById('modal-confirm-delete');
        if (modal) modal.classList.add('hidden');
        showToast("Berhasil", "Data berhasil dihapus dari Cloudflare D1.", "success");
        if (typeof window.loadHistoryByFilter === 'function') window.loadHistoryByFilter(); // Refresh table
        if (typeof window.loadRecentSideFeed === 'function') window.loadRecentSideFeed(); // Refresh feed

    } catch (e) {
        console.error(e);
        showToast("Gagal", "Gagal menghapus data: " + e.message, "error");
    } finally {
        if (btnConfirm) {
            btnConfirm.disabled = false;
            btnConfirm.innerHTML = originalText;
        }
        deleteActivityTarget = null;
    }
};

window.editActivity = async (docId) => {
    try {
        const data = await cfClient.getRecordById(docId);
        if (!data) { showToast("Error", "Data tidak ditemukan!", "error"); return; }

        const isSuperAdmin = window.hasRole ? window.hasRole('super_admin') : localStorage.getItem('user_role') === 'super_admin';
        const reporterUid = String(data.reporterUID || data.reporter_uid || '').trim();
        const isOwner = reporterUid
            ? (auth.currentUser && reporterUid === auth.currentUser.uid)
            : (data.createdBy && currentUserName && String(data.createdBy).trim() === String(currentUserName).trim());
        if (!isOwner && !isSuperAdmin) {
            showToast("Akses Ditolak", "Hanya pembuat catatan atau Super Admin yang dapat mengedit data ini.", "error");
            return;
        }

        // 1. Switch to Input Tab
        switchMainTab('input');

        // 2. Lock Search & Set Student
        const searchInput = document.getElementById('student-search');
        searchInput.value = `${data.studentName} (${data.studentClass})`;
        searchInput.disabled = true;
        selectedStudentNIS = data.studentNIS;

        // Render info manual override (simulate select)
        document.getElementById('selected-student-info').classList.remove('hidden');
        document.getElementById('info-name').innerText = data.studentName;
        document.getElementById('info-class').innerText = data.studentClass;

        // 3. Switch Category Type
        let type = 'violation';
        if (data.category === 'Permisi') type = 'permission';
        else if (data.category === 'Prestasi') type = 'achievement';
        switchInputType(type);

        // Helper parse date defensif untuk D1 SQL & Firestore
        const parseItemDate = (itemData) => {
            const timeObj = itemData?.timestamp?.toDate ? itemData.timestamp.toDate() : (itemData?.timestampIso ? new Date(itemData.timestampIso) : (itemData?.date ? new Date(itemData.date) : (itemData?.timestamp ? new Date(itemData.timestamp) : new Date())));
            return (timeObj instanceof Date && !isNaN(timeObj.getTime())) ? timeObj : new Date();
        };

        // 4. Fill Data by Type
        if (type === 'violation') {
            // Parse Date from Timestamp
            const date = parseItemDate(data);
            const yyyy = date.getFullYear();
            const mm = String(date.getMonth() + 1).padStart(2, '0');
            const dd = String(date.getDate()).padStart(2, '0');
            document.getElementById('input-date-vio').value = `${yyyy}-${mm}-${dd}`;

            // Cari elemen di baris pelanggaran pertama (default)
            const firstRow = document.querySelector('#violation-items .violation-row');
            if (firstRow) {
                const search = firstRow.querySelector('.violation-search-input');
                const desc = firstRow.querySelector('.violation-desc-input');
                const pts = firstRow.querySelector('.violation-points-input');
                if (search) search.value = ""; // Kosongkan search karena ini pengeditan custom manual
                if (desc) desc.value = data.desc;
                if (pts) {
                    pts.value = data.points;
                    pts.readOnly = false; // Izinkan pengeditan manual
                }
            }
            updateTotalPoints();
        } else if (type === 'permission') {
            const date = parseItemDate(data);
            const yyyy = date.getFullYear();
            const mm = String(date.getMonth() + 1).padStart(2, '0');
            const dd = String(date.getDate()).padStart(2, '0');
            document.getElementById('input-date-perm').value = `${yyyy}-${mm}-${dd}`;

            // Extract Time & Note from desc
            const regex = /\[(.*?)\] (.*)/;
            const match = data.desc.match(regex);
            if (match) {
                document.getElementById('input-time-perm').value = match[1];
                document.getElementById('desc-permission').value = match[2];
            } else {
                document.getElementById('desc-permission').value = data.desc;
            }
        } else if (type === 'achievement') {
            const date = parseItemDate(data);
            const yyyy = date.getFullYear();
            const mm = String(date.getMonth() + 1).padStart(2, '0');
            const dd = String(date.getDate()).padStart(2, '0');
            document.getElementById('input-date-ach').value = `${yyyy}-${mm}-${dd}`;
            
            const compName = data.competition_name || data.competitionName || "";
            const org = data.organizer || "";
            const lvl = data.level || data.type || "Sekolah";
            const fld = data.field || "Akademik";
            const rnk = data.rank || "Juara 1";
            const partType = data.participation_type || data.participationType || "Individu";
            const tName = data.team_name || data.teamName || "";
            const mentor = data.mentor_name || data.mentorName || "";
            const cert = data.certificate_no || data.certificateNo || "";
            const evidence = data.evidence_url || data.evidenceUrl || "";

            // Reset team members state untuk mode edit
            achievementTeamMembers = [];
            renderTeamMembersChips();

            if (compName) {
                document.getElementById('input-achievement-title').value = compName;
                document.getElementById('input-achievement-organizer').value = org;
                document.getElementById('input-achievement-level').value = lvl;
                document.getElementById('input-achievement-field').value = fld;
                document.getElementById('input-achievement-rank').value = rnk;
                if (partType === 'Beregu') {
                    if (document.getElementById('part-type-team')) document.getElementById('part-type-team').checked = true;
                    window.toggleAchievementTeamMode(true);
                    document.getElementById('input-achievement-team-name').value = tName;
                } else {
                    if (document.getElementById('part-type-individual')) document.getElementById('part-type-individual').checked = true;
                    window.toggleAchievementTeamMode(false);
                    document.getElementById('input-achievement-team-name').value = "";
                }
                document.getElementById('input-achievement-mentor').value = mentor;
                document.getElementById('input-achievement-cert-no').value = cert;
                document.getElementById('input-achievement-evidence').value = evidence;
                const notePart = (data.desc || '').includes('| Catatan:') ? data.desc.split('| Catatan:')[1].trim() : (data.notes || "");
                document.getElementById('desc-achievement').value = notePart;
            } else {
                // Regex parser untuk data legacy
                const regexAch = /^(.*?)\s*\((Sekolah|Kecamatan|Kabupaten|Provinsi|Nasional|Internasional)\)\s*-\s*Oleh:\s*(.*?)\.\s*(.*)/s;
                const matchAch = (data.desc || '').match(regexAch);
                if (matchAch) {
                    document.getElementById('input-achievement-title').value = matchAch[1].trim();
                    document.getElementById('input-achievement-level').value = matchAch[2].trim();
                    document.getElementById('input-achievement-organizer').value = matchAch[3].trim();
                    document.getElementById('desc-achievement').value = matchAch[4].trim();
                } else {
                    document.getElementById('input-achievement-title').value = "";
                    document.getElementById('input-achievement-level').value = data.type || "Sekolah";
                    document.getElementById('input-achievement-organizer').value = "";
                    document.getElementById('desc-achievement').value = data.desc || "";
                }
                if (document.getElementById('part-type-individual')) document.getElementById('part-type-individual').checked = true;
                window.toggleAchievementTeamMode(false);
            }
        }

        // 5. Set Editing State
        editingState = {
            docId: docId,
            oldPoints: data.points || 0,
            oldCategory: data.category,
            oldNis: data.studentNIS
        };

        // 6. Update Button UI
        const btnSave = document.getElementById('btn-save-activity');
        btnSave.innerHTML = `<i class="fa-solid fa-pen-to-square mr-2"></i> Update Data`;
        btnSave.classList.remove('bg-slate-900', 'hover:bg-slate-800', 'dark:bg-slate-800');
        btnSave.classList.add('bg-blue-600', 'hover:bg-blue-700', 'dark:bg-blue-600', 'dark:hover:bg-blue-700');

        // 7. Add Cancel Button if not exists
        if (!document.getElementById('btn-cancel-edit')) {
            const btnCancel = document.createElement('button');
            btnCancel.id = 'btn-cancel-edit';
            btnCancel.type = 'button';
            btnCancel.className = "w-full mt-2 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 py-3 rounded-lg font-bold hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors";
            btnCancel.innerHTML = "Batal Edit";
            btnCancel.onclick = window.cancelEditMode;
            btnSave.parentNode.appendChild(btnCancel);
        }

    } catch (e) {
        console.error(e);
        showToast("Error", "Error load data edit: " + e.message, "error");
    }
};

window.cancelEditMode = () => {
    editingState = null;
    document.getElementById('form-input').reset();
    document.getElementById('student-search').disabled = false;
    document.getElementById('student-search').value = "";
    document.getElementById('selected-student-info').classList.add('hidden');
    document.getElementById('info-piket-box').classList.add('hidden');
    selectedStudentNIS = null;

    // Reset team members state
    achievementTeamMembers = [];
    renderTeamMembersChips();
    window.toggleAchievementTeamMode(false);
    if (document.getElementById('part-type-individual')) {
        document.getElementById('part-type-individual').checked = true;
    }

    // Reset baris pelanggaran kembali ke 1 baris
    resetViolationRows();

    // Kembalikan nilai tanggal & jam hari ini
    const today = new Date();
    const getLocalISODate = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };
    const todayStr = getLocalISODate(today);
    document.getElementById('input-date-vio').value = todayStr;
    document.getElementById('input-date-perm').value = todayStr;
    document.getElementById('input-date-ach').value = todayStr;
    document.getElementById('input-time-perm').value = today.toTimeString().substring(0, 5);

    const btnSave = document.getElementById('btn-save-activity');
    btnSave.innerHTML = `<i class="fa-solid fa-floppy-disk mr-2"></i> Simpan Data`;
    btnSave.classList.add('bg-slate-900', 'hover:bg-slate-800', 'dark:bg-blue-600', 'dark:hover:bg-blue-700');
    btnSave.classList.remove('bg-blue-600', 'hover:bg-blue-700');

    const btnCancel = document.getElementById('btn-cancel-edit');
    if (btnCancel) btnCancel.remove();

    switchMainTab('history');
};

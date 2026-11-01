/* js/page-e-rapor.js - E-Rapor Nilai Teori & Praktik Kelas XII */
import { auth, db, PATHS } from './config.js';
import { cfClient } from './cloudflare-client.js';
import { initLayout } from './global.js';
import { parseASCSchedule, getAllXMLTeachersWithStatus, saveCustomTeacherMapping, getSubjectsWithLessonsFromXML, saveUploadedASCScheduleXML, getASCScheduleSourceInfo } from './asc-schedule-parser.js';


import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
    getDocs, doc, setDoc, getDoc, collection, addDoc, onSnapshot,
    query as fsQuery, where, serverTimestamp, writeBatch, deleteField
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

// --- STATE ---
let currentUser = null;
let currentRole = '';
// Config baru: rapor_config berisi mapel_teori, mapel_praktik, mapel_guru
let raporConfig = {
    tahun_ajaran_aktif: '',
    mapel_teori: [],  // Semua mapel untuk teori
    mapel_praktik: [], // Subset mapel yang punya praktik
    mapel_guru: {}     // Mapping guru per mapel per kelas
};
let kelasXIIList = [];
let loadedStudents = [];
let previewData = [];
let rekapData = [];
let allStudentsCache = []; // Cache siswa kelas XII
let isInputNilaiLocked = false; // Status pengunci input nilai
let currentScoreType = 'teori'; // Mode aktif: 'teori' atau 'praktik'

// --- STATE TAMBAHAN: 2 TAB UTAMA ---
let currentMainTab = 'ujian_sekolah'; // 'ujian_sekolah' | 'pengaturan'
let ujianSekolahSubTab = 'teori'; // 'teori' | 'praktik' | 'rekap'


// --- CACHE HELPER FUNCTIONS ---
const CACHE_TTL_CONFIG = 12 * 60 * 60 * 1000; // 12 jam untuk rapor_config
const CACHE_TTL_STUDENTS = 24 * 60 * 60 * 1000; // 24 jam untuk data siswa

function getCachedData(key) {
    try {
        const cached = localStorage.getItem(key);
        if (!cached) return null;
        const { data, expiry } = JSON.parse(cached);
        if (Date.now() > expiry) {
            localStorage.removeItem(key);
            return null;
        }
        return data;
    } catch (e) {
        console.warn('[Cache] Error reading cache:', key, e);
        return null;
    }
}

function setCachedData(key, data, ttl) {
    try {
        const item = { data, expiry: Date.now() + ttl };
        localStorage.setItem(key, JSON.stringify(item));
    } catch (e) {
        console.warn('[Cache] Error writing cache:', key, e);
    }
}

function getSessionCache(key) {
    try {
        const cached = sessionStorage.getItem(key);
        return cached ? JSON.parse(cached) : null;
    } catch (e) {
        return null;
    }
}

function setSessionCache(key, data) {
    try {
        sessionStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
        console.warn('[Cache] Error writing session cache:', key, e);
    }
}

// --- HELPER: SAFE KEY (Replace spaces/dots with underscores) ---
function safeKey(str) {
    return str.replace(/[\s\.]/g, '_');
}

// --- HELPER: MODERN ALERT ---
function showModernAlert(title, message, type = 'success') {
    const modal = document.getElementById('modal-alert');
    if (!modal) { showToast(title, message, type === 'success' ? 'success' : 'error'); return; }

    const iconBg = document.getElementById('alert-icon-bg');
    const icon = document.getElementById('alert-icon');
    const titleEl = document.getElementById('alert-title');
    const msgEl = document.getElementById('alert-msg');

    if (type === 'success') {
        iconBg.className = "w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-green-100 text-green-600";
        icon.className = "fa-solid fa-check text-3xl";
    } else {
        iconBg.className = "w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-red-100 text-red-600";
        icon.className = "fa-solid fa-triangle-exclamation text-3xl";
    }

    titleEl.innerText = title;
    msgEl.innerHTML = message;
    modal.classList.remove('hidden');
}

// --- AUTH & INIT ---
let isWakasekKurikulum = false; // Flag untuk cek akses Wakasek Kurikulum

onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash); return; }

    currentUser = user;
    currentRole = localStorage.getItem('user_role') || '';
    // MULTI-ROLE: Ambil role tertinggi untuk halaman ini
    const effectiveRole = window.getEffectiveRoleForPage ?
        window.getEffectiveRoleForPage('e-rapor.html') : currentRole;

    // Access Control - gunakan hasRole untuk multi-role support
    const allowedRoles = ['super_admin', 'guru_mapel', 'wali_kelas', 'kesiswaan', 'wakasek_kurikulum'];
    const hasAccess = window.hasRole ?
        allowedRoles.some(r => window.hasRole(r)) :
        allowedRoles.includes(currentRole);
    if (!hasAccess) {
        showModernAlert("Akses Ditolak", "Halaman ini khusus untuk guru dan admin.", "error");
        setTimeout(() => window.location.href = 'dashboard.html', 2000);
        return;
    }

    initLayout(effectiveRole); // Gunakan role tertinggi
    document.querySelector('main').classList.remove('hidden');

    await loadKelasXII();
    await loadRaporConfig();

    // Cek apakah user adalah Wakasek Kurikulum (ROLE-BASED)
    checkWakasekKurikulumStatus();

    // Kontrol akses tab Rekap Leger: hanya super_admin dan Wakasek Kurikulum
    const canAccessRekapLeger = (window.hasRole ? window.hasRole('super_admin') : currentRole === 'super_admin') || isWakasekKurikulum;
    const tabBtnRekap = document.getElementById('tab-btn-ujian-rekap') || document.getElementById('tab-btn-rekap');
    if (tabBtnRekap) {
        if (canAccessRekapLeger) {
            tabBtnRekap.classList.remove('hidden');
        } else {
            tabBtnRekap.classList.add('hidden');
        }
    }

    // Kontrol akses tab Pengaturan: hanya super_admin dan Wakasek Kurikulum
    const canAccessPengaturan = (window.hasRole ? window.hasRole('super_admin') : currentRole === 'super_admin') || isWakasekKurikulum;
    const tabBtnPengaturan = document.getElementById('tab-main-pengaturan') || document.getElementById('tab-btn-pengaturan');
    if (tabBtnPengaturan) {
        if (canAccessPengaturan) {
            tabBtnPengaturan.classList.remove('hidden');
        } else {
            tabBtnPengaturan.classList.add('hidden');
        }
    }

    switchMainTab('ujian_sekolah');
});


// --- CEK STATUS WAKASEK KURIKULUM (ROLE-BASED) ---
// Wakasek Kurikulum sekarang dikelola via role, bukan UID di settings
function checkWakasekKurikulumStatus() {
    // Cek apakah user punya role wakasek_kurikulum (primary atau additional)
    // hasRole() dari global.js mengecek localStorage additionalRoles
    if (typeof window.hasRole === 'function') {
        isWakasekKurikulum = window.hasRole('wakasek_kurikulum');
    } else {
        // Fallback jika hasRole belum tersedia: cek langsung localStorage
        const additionalRoles = JSON.parse(localStorage.getItem('user_additional_roles') || '[]');
        isWakasekKurikulum = currentRole === 'wakasek_kurikulum' || additionalRoles.includes('wakasek_kurikulum');
    }
    console.log('[E-Rapor] isWakasekKurikulum:', isWakasekKurikulum);
}


// --- LOAD KONFIGURASI RAPOR (Unified Teori + Praktik) - CLOUDFLARE D1 SSOT ---
async function loadRaporConfig() {
    try {
        let newData = null;

        // Memuat konfigurasi rapor murni dari Cloudflare D1 SSOT (0 Firestore Read)
        if (cfClient && cfClient.enabled) {
            try {
                newData = await cfClient.getRaporConfig();
                console.log('⚡ [E-Rapor] Konfigurasi rapor berhasil dimuat dari Cloudflare D1 SSOT');
            } catch (cfErr) {
                console.error('[E-Rapor] Gagal memuat config dari Cloudflare D1:', cfErr);
            }
        }

        if (newData) {
            // Auto-detect tahun_ajaran_aktif secara dinamis agar mandiri & otomatis
            const autoTA = window.getCurrentAcademicYearString ? window.getCurrentAcademicYearString() : (() => {
                const now = new Date();
                const month = now.getMonth();
                const year = now.getFullYear();
                const startYear = (month >= 6) ? year : year - 1;
                return `${startYear}/${startYear + 1}`;
            })();

            // Update config & override dengan tahun ajaran otomatis
            raporConfig = { ...raporConfig, ...newData, tahun_ajaran_aktif: autoTA };

            // Normalize Unified Lists for Internal Logic
            const masterList = raporConfig.mapel_list || [];
            const praktikFlags = raporConfig.mapel_praktik_flags || {};

            // Internal 'mapel_teori' is effectively ALL mapels (since all have theory)
            raporConfig.mapel_teori = [...masterList];

            // Internal 'mapel_praktik' is filtered list based on flags
            raporConfig.mapel_praktik = masterList.filter(m => praktikFlags[m] === true);

            // Update Display Tahun Ajaran
            const display = document.getElementById('tahun-ajaran-display');
            if (display) {
                display.textContent = raporConfig.tahun_ajaran_aktif
                    ? raporConfig.tahun_ajaran_aktif
                    : 'Belum Diatur';
            }

            // Update Input Defaults (Rekap)
            const inputTahun = document.getElementById('input-tahun-rekap');
            if (inputTahun && raporConfig.tahun_ajaran_aktif) inputTahun.value = raporConfig.tahun_ajaran_aktif;

            // Populate Mapel Dropdowns
            populateMapelDropdowns();

            // CEK STATUS INPUT NILAI (kecuali super_admin) - TERPISAH: TEORI & PRAKTIK
            raporConfig.input_nilai_teori_enabled = raporConfig.input_nilai_teori_enabled || false;
            raporConfig.input_nilai_praktik_enabled = raporConfig.input_nilai_praktik_enabled || false;

            // SELALU update status lock setiap kali ada perubahan di config
            updateInputLockStatus();
            applyInputLockMode();
        }
    } catch (err) {
        console.error('[E-Rapor] Error loading config:', err);
    }
}

// --- UPDATE INPUT LOCK STATUS (berdasarkan mode aktif) ---
function updateInputLockStatus() {
    // Multi-role: Gunakan hasRole agar super_admin sebagai additional role juga bypass lock
    const isSuperAdmin = window.hasRole ? window.hasRole('super_admin') : currentRole === 'super_admin';
    if (isSuperAdmin) {
        isInputNilaiLocked = false; // Super admin tidak pernah terkunci
        return;
    }

    // Cek berdasarkan mode aktif
    if (currentScoreType === 'teori') {
        isInputNilaiLocked = !raporConfig.input_nilai_teori_enabled;
    } else {
        isInputNilaiLocked = !raporConfig.input_nilai_praktik_enabled;
    }
}

// --- APPLY INPUT LOCK MODE ---
// Mengunci UI input jika toggle dinonaktifkan
function applyInputLockMode() {
    // Update status lock terlebih dahulu
    updateInputLockStatus();

    const banner = document.getElementById('banner-input-locked');
    const tabBtnImport = document.getElementById('tab-btn-import');
    const btnSaveInput = document.getElementById('btn-save-input');
    const btnOpenImportUjian = document.getElementById('btn-open-modal-import');

    if (isInputNilaiLocked) {
        // Tampilkan banner warning
        if (banner) banner.classList.remove('hidden');

        // Sembunyikan tombol / tab Import Excel
        if (tabBtnImport) tabBtnImport.classList.add('hidden');
        if (btnOpenImportUjian) btnOpenImportUjian.classList.add('hidden');

        // Sembunyikan tombol Simpan di tab Input
        if (btnSaveInput) btnSaveInput.classList.add('hidden');

        console.log('[E-Rapor] Mode TERKUNCI: Input nilai dinonaktifkan oleh admin.');
    } else {
        // Tampilkan semua elemen kembali
        if (banner) banner.classList.add('hidden');
        if (tabBtnImport) tabBtnImport.classList.remove('hidden');
        if (btnOpenImportUjian) btnOpenImportUjian.classList.remove('hidden');
        // Tombol Simpan hanya ditampilkan jika siswa sudah di-load
        if (btnSaveInput && loadedStudents.length > 0) btnSaveInput.classList.remove('hidden');
    }
}

// --- POPULATE MAPEL DROPDOWNS ---
// Simpan mapping mapel -> kelas yang diampu guru ini (untuk filter)
let guruMapelKelasMap = {}; // { "Biologi": ["XII-1", "XII-2"], ... }

function populateMapelDropdowns() {
    const selects = [
        document.getElementById('select-mapel-input'),
        document.getElementById('select-mapel-import')
    ];

    // Pilih mapel list berdasarkan mode aktif (teori atau praktik)
    let availableMapel = currentScoreType === 'praktik'
        ? (raporConfig.mapel_praktik || [])
        : (raporConfig.mapel_teori || []);

    guruMapelKelasMap = {}; // Reset

    // FILTER MAPEL BY GURU (Jika bukan admin/super/kesiswaan)
    // Multi-role: Gunakan hasRole agar additional role juga terdeteksi
    const isAdmin = window.hasRole
        ? (window.hasRole('super_admin') || window.hasRole('kesiswaan'))
        : ['super_admin', 'kesiswaan'].includes(currentRole);

    if (!isAdmin && currentUser) {
        const mapelGuru = raporConfig.mapel_guru || {};

        // Filter mapel dimana UID user ada di daftar pengampu (support struktur lama & baru)
        availableMapel = availableMapel.filter(m => {
            const pengampu = mapelGuru[m] || [];
            let isAssigned = false;

            for (const g of pengampu) {
                // Struktur lama: string UID
                if (typeof g === 'string' && g === currentUser.uid) {
                    guruMapelKelasMap[m] = []; // Semua kelas (legacy)
                    isAssigned = true;
                    break;
                }
                // Struktur baru: { uid, kelas: [...] }
                if (typeof g === 'object' && g.uid === currentUser.uid) {
                    guruMapelKelasMap[m] = g.kelas || [];
                    isAssigned = true;
                    break;
                }
            }

            if (!isAssigned) return false;

            // NEW: Filter khusus untuk E-Rapor Kelas XII
            // Jika guru punya assignment kelas spesifik, pastikan ada yang kelas XII
            const assignedClasses = guruMapelKelasMap[m];
            if (assignedClasses.length > 0) {
                // Cek apakah ada satupun kelas yang diawali "XII"
                const hasClassXII = assignedClasses.some(k => k.startsWith('XII'));
                if (!hasClassXII) return false; // Skip mapel ini jika tidak diajar di kelas XII
            }

            return true;
        });
    } else {
        // Admin: semua mapel, semua kelas
        availableMapel.forEach(m => {
            guruMapelKelasMap[m] = []; // Empty = semua kelas
        });
    }

    // Simpan flag apakah user punya akses mapel
    const hasMapelAccess = availableMapel.length > 0;

    selects.forEach(select => {
        if (!select) return;

        if (!hasMapelAccess) {
            select.innerHTML = '<option value="">-- Tidak ada mapel yang diampu --</option>';
        } else {
            // Langsung pilih mapel pertama sebagai default
            select.innerHTML = availableMapel.map((m, i) =>
                `<option value="${m}" ${i === 0 ? 'selected' : ''}>${m}</option>`
            ).join('');
        }
    });

    // Jika tidak ada mapel, kosongkan juga dropdown kelas
    if (!hasMapelAccess) {
        const kelasSelects = [
            document.getElementById('select-kelas-input'),
            document.getElementById('select-kelas-rekap')
        ];
        kelasSelects.forEach(sel => {
            if (sel) sel.innerHTML = '<option value="">-- Tidak ada akses --</option>';
        });
    } else {
        // Jika ada mapel, trigger update kelas untuk mapel pertama
        updateKelasDropdownByMapel('input');
    }

    // Add event listeners untuk update kelas dropdown ketika mapel berubah
    const selectMapelInput = document.getElementById('select-mapel-input');
    if (selectMapelInput) {
        selectMapelInput.addEventListener('change', () => updateKelasDropdownByMapel('input'));
    }
}


// Update Kelas Dropdown berdasarkan Mapel yang dipilih
function updateKelasDropdownByMapel(context = 'input') {
    const selectMapel = document.getElementById(context === 'input' ? 'select-mapel-input' : 'select-mapel-import');
    const selectKelas = document.getElementById(context === 'input' ? 'select-kelas-input' : 'select-kelas-rekap');

    if (!selectMapel || !selectKelas) return;

    // Simpan nilai kelas yang sedang dipilih SEBELUM rebuild dropdown
    const currentKelasValue = selectKelas.value;

    const mapelDipilih = selectMapel.value;
    const isAdmin = ['super_admin', 'kesiswaan'].includes(currentRole);

    let filteredKelas = [];

    // Jika admin atau tidak ada mapel dipilih, tampilkan semua kelas
    if (isAdmin || !mapelDipilih) {
        filteredKelas = kelasXIIList;
    } else {
        // Filter kelas berdasarkan mapel yang dipilih
        const kelasYangDiampu = guruMapelKelasMap[mapelDipilih] || [];

        // Jika array kosong, berarti guru ini mengampu SEMUA kelas untuk mapel ini (legacy atau setting semua)
        filteredKelas = kelasYangDiampu.length > 0
            ? kelasXIIList.filter(k => kelasYangDiampu.includes(k))
            : kelasXIIList;
    }

    if (filteredKelas.length === 0) {
        selectKelas.innerHTML = '<option value="">-- Tidak ada kelas yang diampu --</option>';
    } else {
        if (context === 'rekap') {
            // Untuk REKAP: List kelas dulu, baru opsi 'Semua Kelas' di paling bawah
            selectKelas.innerHTML = filteredKelas.map(k => `<option value="${k}">${k}</option>`).join('') +
                '<option value="">Semua Kelas XII</option>';
        } else {
            // Untuk INPUT: Default opsi 'Pilih Kelas' di paling atas
            selectKelas.innerHTML = '<option value="">-- Pilih Kelas --</option>' +
                filteredKelas.map(k => `<option value="${k}">${k}</option>`).join('');
        }


        // Restore nilai kelas yang sebelumnya dipilih jika masih ada di daftar
        if (currentKelasValue && filteredKelas.includes(currentKelasValue)) {
            selectKelas.value = currentKelasValue;
        }
    }
}


// --- VALIDASI NILAI (Input Handler) ---
window.validateScoreInput = (input) => {
    const val = parseInt(input.value);

    if (input.value === '') return; // Allow empty (reset)

    const min = 0;
    const max = 100;

    if (isNaN(val) || val < min || val > max) {
        showToast('Nilai Tidak Valid', `Nilai harus berupa angka ${min} - ${max}!`, 'error');
        input.value = ''; // Kosongkan form
        input.focus();
    }
};

// --- LOAD KELAS XII (REFACTORED: Pakai Global Helper) ---
async function loadKelasXII() {
    try {
        // Bypass filter kelas aktif — E-Rapor punya filter sendiri via mapel_guru
        // (kelas XII yang diampu guru sudah difilter di populateMapelDropdowns)
        kelasXIIList = await window.getActiveClasses({ gradeFilter: 'XII', bypassActiveFilter: true });

        // Populate Kelas Dropdowns
        const selectInput = document.getElementById('select-kelas-input');
        const selectRekap = document.getElementById('select-kelas-rekap');
        const isAdmin = ['super_admin', 'kesiswaan'].includes(currentRole);

        if (selectInput) {
            // Untuk guru non-admin: kosongkan dan minta pilih mapel dulu
            // Untuk admin: tampilkan semua kelas
            if (isAdmin) {
                selectInput.innerHTML = '<option value="">-- Pilih Kelas --</option>' +
                    kelasXIIList.map(k => `<option value="${k}">${k}</option>`).join('');
            } else {
                selectInput.innerHTML = '<option value="">-- Pilih Mapel Dulu --</option>';
            }
        }

        if (selectRekap) {
            // Default: Kelas pertama terpilih (XII-1), opsi "Semua Kelas XII" di bagian bawah
            selectRekap.innerHTML = kelasXIIList.map((k, i) =>
                `<option value="${k}" ${i === 0 ? 'selected' : ''}>${k}</option>`
            ).join('') + '<option value="">Semua Kelas XII</option>';
        }

        console.log(`Loaded ${kelasXIIList.length} kelas XII dari metadata`);

    } catch (e) {
        console.error('Error loading kelas XII:', e);
        showToast('Error', 'Gagal memuat daftar kelas: ' + e.message, 'error');
    }
}


// --- 2 MAIN TABS SWITCHING (Ujian Sekolah | Pengaturan) ---
window.switchMainTab = (mainTab) => {
    currentMainTab = mainTab;

    const secUjian = document.getElementById('section-ujian-sekolah');
    const tabPengaturan = document.getElementById('tab-pengaturan');
    const banner = document.getElementById('banner-input-locked');

    const subnavUjian = document.getElementById('subnav-ujian-sekolah');
    const subnavPengaturan = document.getElementById('subnav-pengaturan');

    if (secUjian) secUjian.classList.toggle('hidden', mainTab !== 'ujian_sekolah');
    if (tabPengaturan) tabPengaturan.classList.toggle('hidden', mainTab !== 'pengaturan');

    // Dynamic Header Subnav visibility
    if (subnavUjian) subnavUjian.classList.toggle('hidden', mainTab !== 'ujian_sekolah');
    if (subnavPengaturan) subnavPengaturan.classList.toggle('hidden', mainTab !== 'pengaturan');

    if (mainTab === 'ujian_sekolah') {
        updateHeaderAndHighlight('ujian_sekolah');
        switchUjianSekolahSubTab(ujianSekolahSubTab);
    } else if (mainTab === 'pengaturan') {
        updateHeaderAndHighlight('pengaturan');
        if (banner) banner.classList.add('hidden');
        renderUnifiedMapelList();
        renderXMLScheduleStatus();
    }

    applyInputLockMode();
};


// --- SUB-TABS: UJIAN SEKOLAH (Teori | Praktik | Rekap) ---
window.switchUjianSekolahSubTab = (subTab) => {
    ujianSekolahSubTab = subTab;

    const btnTeori = document.getElementById('tab-btn-ujian-teori');
    const btnPraktik = document.getElementById('tab-btn-ujian-praktik');
    const btnRekap = document.getElementById('tab-btn-ujian-rekap');
    const tabInput = document.getElementById('tab-input');
    const tabRekap = document.getElementById('tab-rekap');

    [btnTeori, btnPraktik, btnRekap].forEach(btn => {
        if (!btn) return;
        btn.classList.remove('active', 'bg-white', 'text-blue-700', 'shadow-sm');
        btn.classList.add('text-white/85');
    });

    if (subTab === 'teori') {
        if (btnTeori) {
            btnTeori.classList.add('active', 'bg-white', 'text-blue-700', 'shadow-sm');
            btnTeori.classList.remove('text-white/85');
        }
        tabInput?.classList.remove('hidden');
        tabRekap?.classList.add('hidden');
        switchMode('teori');
    } else if (subTab === 'praktik') {
        if (btnPraktik) {
            btnPraktik.classList.add('active', 'bg-white', 'text-blue-700', 'shadow-sm');
            btnPraktik.classList.remove('text-white/85');
        }
        tabInput?.classList.remove('hidden');
        tabRekap?.classList.add('hidden');
        switchMode('praktik');
    } else if (subTab === 'rekap') {
        if (btnRekap) {
            btnRekap.classList.add('active', 'bg-white', 'text-blue-700', 'shadow-sm');
            btnRekap.classList.remove('text-white/85');
        }
        tabInput?.classList.add('hidden');
        tabRekap?.classList.remove('hidden');
    }
};

// --- MODAL IMPORT EXCEL: UJIAN SEKOLAH ---
window.openModalImportUjian = () => {
    const modal = document.getElementById('modal-import-ujian');
    if (!modal) return;
    modal.classList.remove('hidden');

    // Sinkronkan mapel yang sedang dipilih pada form input utama
    const selMapelIn = document.getElementById('select-mapel-input');
    const selMapelImp = document.getElementById('select-mapel-import');
    if (selMapelIn && selMapelImp && selMapelIn.value) {
        selMapelImp.value = selMapelIn.value;
    }

    const titleEl = document.getElementById('modal-import-ujian-title');
    if (titleEl) {
        titleEl.textContent = `Import Nilai Excel - Ujian Sekolah (${currentScoreType === 'praktik' ? 'Praktik' : 'Teori'})`;
    }
};

window.closeModalImportUjian = () => {
    const modal = document.getElementById('modal-import-ujian');
    if (modal) modal.classList.add('hidden');
};

// --- TAB SWITCHING (Header & Animated Highlighter) ---
function updateHeaderAndHighlight(tabKey) {
    const header = document.getElementById('page-header');
    const headerTitle = document.getElementById('header-title');
    const headerSubtitle = document.getElementById('header-subtitle');
    const highlight = document.getElementById('erapor-tab-highlight');

    // 1. Update Background & Text Header
    if (header) {
        header.classList.remove('header-teori', 'header-praktik', 'header-rekap', 'header-ujian_sekolah', 'header-pengaturan');
        header.classList.add(`header-${tabKey}`);
    }

    if (headerTitle && headerSubtitle) {
        if (tabKey === 'ujian_sekolah' || tabKey === 'teori' || tabKey === 'praktik') {
            headerTitle.textContent = 'E-Rapor Ujian Sekolah';
            headerSubtitle.textContent = 'Input dan rekap nilai ujian sekolah (Teori & Praktik) kelas XII';
        } else if (tabKey === 'pengaturan') {
            headerTitle.innerHTML = 'Pengaturan E-Rapor';
            headerSubtitle.textContent = 'Kelola mata pelajaran, guru pengampu, dan status input nilai';
        }
    }

    // 2. 2 Main Tabs: Highlight position
    const mainTabs = [
        { key: 'ujian_sekolah', id: 'tab-main-ujian', altId: 'tab-btn-teori' },
        { key: 'pengaturan', id: 'tab-main-pengaturan', altId: 'tab-btn-pengaturan' }
    ];

    const visibleMainTabs = mainTabs.filter(t => {
        const btn = document.getElementById(t.id) || document.getElementById(t.altId);
        return btn && !btn.classList.contains('hidden');
    });

    const activeMainKey = (tabKey === 'pengaturan' ? 'pengaturan' : 'ujian_sekolah');
    const offsetIdx = visibleMainTabs.findIndex(t => t.key === activeMainKey);
    const validIdx = offsetIdx !== -1 ? offsetIdx : 0;
    const totalVisible = visibleMainTabs.length || 1;

    let widthClass = totalVisible === 1 ? 'w-full' : 'w-1/2';

    if (highlight) {
        highlight.className = `absolute top-1 bottom-1 bg-white dark:bg-slate-800 rounded-lg shadow-lg ring-4 ring-white/20 transition-all duration-300 ease-out z-0 ${
            totalVisible === 1 ? 'w-[calc(100%-8px)]' : 'w-[calc(50%-4px)]'
        }`;
        const translation = `calc(${validIdx * 100}% + ${validIdx * 4}px)`;
        highlight.style.transform = `translateX(${translation})`;
    }

    // 3. Update Text Color Buttons
    mainTabs.forEach(t => {
        const btn = document.getElementById(t.id) || document.getElementById(t.altId);
        if (!btn) return;
        const isHidden = btn.classList.contains('hidden');
        if (t.key === activeMainKey) {
            let activeColor = (activeMainKey === 'pengaturan') ? 'text-purple-700 dark:text-purple-300' : 'text-blue-700 dark:text-blue-300';
            btn.className = `relative z-10 ${widthClass} px-4 py-1.5 rounded-lg text-xs font-bold transition-all duration-300 flex items-center justify-center gap-2 ${activeColor}`;
        } else {
            btn.className = `relative z-10 ${widthClass} px-4 py-1.5 rounded-lg text-xs font-bold transition-all duration-300 flex items-center justify-center gap-2 text-white/80 hover:text-white`;
        }
        if (isHidden) btn.classList.add('hidden');
    });
}

// --- TAB SWITCHING (Backward compatibility & sub-tab switcher) ---
window.switchTab = (tabId) => {
    if (tabId === 'pengaturan') {
        switchMainTab('pengaturan');
        return;
    }
    if (tabId === 'rekap') {
        switchMainTab('ujian_sekolah');
        switchUjianSekolahSubTab('rekap');
        return;
    }

    // Tab Input / Import di Ujian Sekolah
    const banner = document.getElementById('banner-input-locked');
    const tabInput = document.getElementById('tab-input');

    if (tabId === 'import') {
        openModalImportUjian();
        return;
    }

    if (tabInput) tabInput.classList.remove('hidden');

    if (isInputNilaiLocked && banner) {
        banner.classList.remove('hidden');
    }
};

// --- MODE SWITCHING (Teori / Praktik Ujian Sekolah) ---
window.switchMode = (mode) => {
    const modeChanged = currentScoreType !== mode;
    currentScoreType = mode;

    const btnSaveText = document.getElementById('btn-save-text');
    if (btnSaveText) {
        btnSaveText.textContent = mode === 'teori' ? 'Simpan Nilai Teori' : 'Simpan Nilai Praktik';
    }

    if (modeChanged) {
        populateMapelDropdowns();
        updateKelasDropdownByMapel('input');

        const container = document.getElementById('input-table-container');
        if (container) {
            container.innerHTML = `
                <div class="text-center text-slate-400 py-12">
                    <i class="fa-solid fa-arrow-pointer text-3xl mb-2"></i>
                    <p class="text-sm">Pilih kelas dan mata pelajaran, lalu klik "Load Siswa"</p>
                </div>
            `;
        }

        loadedStudents = [];
        const btnSave = document.getElementById('btn-save-input');
        if (btnSave) btnSave.classList.add('hidden');
    }

    switchTab('input');
    applyInputLockMode();
    console.log(`[E-Rapor] Mode switched to: "${mode.toUpperCase()}"`);
};

// ======================== TAB 1: INPUT INDIVIDUAL ========================

window.loadStudentsForInput = async () => {
    const kelas = document.getElementById('select-kelas-input').value;
    const mapel = document.getElementById('select-mapel-input').value;
    const tahunAjaran = raporConfig.tahun_ajaran_aktif;
    const container = document.getElementById('input-table-container');
    const btnSave = document.getElementById('btn-save-input');

    if (!kelas || !mapel) {
        showToast('Peringatan', 'Pilih kelas dan mata pelajaran terlebih dahulu!', 'warning');
        return;
    }

    container.innerHTML = '<div class="text-center py-8"><i class="fa-solid fa-spinner fa-spin text-2xl text-slate-400"></i></div>';

    try {
        // === CACHE: Data Siswa per Kelas (TTL 24 jam) ===
        const studentsCacheKey = `cache_students_${kelas}`;
        let cachedStudents = getCachedData(studentsCacheKey);

        if (cachedStudents) {
            console.log(`[E-Rapor] Menggunakan cache siswa kelas ${kelas}`);
            loadedStudents = cachedStudents;
        } else {
            // Prioritaskan cache IndexedDB terpusat (0 Reads)
            let studentsFromCache = null;
            if (typeof window.getStudentsCache === 'function') {
                try {
                    const allStudents = await window.getStudentsCache();
                    if (allStudents && allStudents.length > 0) {
                        studentsFromCache = allStudents.filter(s => s.class === kelas && s.is_alumni !== true);
                    }
                } catch (e) { console.warn('[E-Rapor] getStudentsCache error:', e); }
            }

            if (studentsFromCache && studentsFromCache.length > 0) {
                loadedStudents = studentsFromCache;
            } else {
                try {
                    if (cfClient && cfClient.enabled) {
                        const cfStudents = await cfClient.getStudents({ class: kelas, limit: 100 });
                        if (Array.isArray(cfStudents) && cfStudents.length > 0) {
                            loadedStudents = cfStudents.filter(s => s.status === 'active' || !s.is_alumni);
                            console.log(`[E-Rapor] Memuat ${loadedStudents.length} siswa dari Cloudflare D1 (0 Read)`);
                        }
                    }
                } catch (cfErr) {
                    console.warn('[E-Rapor] Gagal memuat siswa dari Cloudflare D1:', cfErr);
                }

                if (!loadedStudents || loadedStudents.length === 0) {
                    const allStudents = typeof window.getStudentsCache === 'function' ? await window.getStudentsCache() : [];
                    loadedStudents = allStudents.filter(s => (s.class === kelas || s.kelas === kelas) && (s.status === 'active' || !s.is_alumni));
                }
            }

            // Sort by name
            loadedStudents.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

            // Simpan ke cache (TTL 24 jam)
            if (loadedStudents.length > 0) {
                setCachedData(studentsCacheKey, loadedStudents, CACHE_TTL_STUDENTS);
                console.log(`[E-Rapor] Data siswa kelas ${kelas} di-cache (TTL 24 jam)`);
            }
        }

        if (loadedStudents.length === 0) {
            container.innerHTML = '<div class="text-center text-slate-400 py-8">Tidak ada siswa di kelas ini.</div>';
            btnSave.classList.add('hidden');
            return;
        }


        // Load existing scores per siswa dari Cloudflare D1 SSOT (struktur baru: scores_teori dan scores_praktik terpisah)
        const existingScores = new Map(); // nis -> { scores_teori: {mapel: nilai}, scores_praktik: {mapel: nilai} }
        const scoreField = currentScoreType === 'teori' ? 'scores_teori' : 'scores_praktik';

        let cfScores = [];
        if (cfClient && cfClient.enabled) {
            try {
                cfScores = await cfClient.getRaporScores({ class: kelas, tahun_ajaran: tahunAjaran });
                console.log(`⚡ [E-Rapor] Memuat ${cfScores.length} data nilai dari Cloudflare D1 SSOT (0 Firestore Read)`);
            } catch (cfErr) {
                console.error('[E-Rapor] Gagal memuat nilai dari Cloudflare D1:', cfErr);
            }
        }

        if (Array.isArray(cfScores) && cfScores.length > 0) {
            cfScores.forEach(d => {
                existingScores.set(d.nis, {
                    id: d.id,
                    nis: d.nis,
                    name: d.name,
                    class: d.class,
                    scores_teori: d.scores_teori || {},
                    scores_praktik: d.scores_praktik || {}
                });
            });
        }

        // Render Table
        // Tentukan apakah input harus disabled
        const inputDisabled = isInputNilaiLocked ? 'readonly' : '';
        const inputClass = isInputNilaiLocked
            ? 'w-20 p-1.5 border border-slate-200 dark:border-slate-700 rounded text-center text-sm bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 cursor-not-allowed score-input'
            : 'w-20 p-1.5 border border-slate-300 dark:border-slate-600 rounded text-center text-sm bg-white dark:bg-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none score-input';

        container.innerHTML = `
            <table class="w-full text-sm text-left">
                <thead class="bg-slate-50 dark:bg-slate-800 text-xs uppercase text-slate-500 dark:text-slate-400">
                    <tr>
                        <th class="px-4 py-3 w-12">No</th>
                        <th class="px-4 py-3 w-24">NIS</th>
                        <th class="px-4 py-3">Nama Siswa</th>
                        <th class="px-4 py-3 w-32 text-center">Nilai (0-100)</th>
                        <th class="px-4 py-3 w-24 text-center">Status</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100 dark:divide-slate-800" id="input-body">
                    ${loadedStudents.map((s, idx) => {
            const existing = existingScores.get(s.nis);
            // Ambil nilai mapel dari scores_teori atau scores_praktik sesuai mode aktif
            const safeMapel = safeKey(mapel);
            const scoresObj = existing?.[scoreField] || {};
            const scoreVal = scoresObj[safeMapel] ?? scoresObj[mapel] ?? '';
            const hasScore = scoreVal !== '';
            const statusBadge = hasScore
                ? '<span class="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Tersimpan</span>'
                : '<span class="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">Belum</span>';

            return `
                            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors" data-nis="${s.nis}" data-name="${s.name}">
                                <td class="px-4 py-2 text-slate-400 dark:text-slate-500">${idx + 1}</td>
                                <td class="px-4 py-2 font-mono text-xs dark:text-slate-300">${window.escapeHTML(s.nis)}</td>
                                <td class="px-4 py-2 font-medium dark:text-slate-200">${window.escapeHTML(s.name)}</td>
                                <td class="px-4 py-2 text-center">
                                    <input type="number" inputmode="numeric" min="0" max="100" step="1" value="${scoreVal}"
                                        onchange="window.validateScoreInput(this)"
                                        class="${inputClass}" ${inputDisabled}>
                                </td>
                                <td class="px-4 py-2 text-center status-cell">${statusBadge}</td>
                            </tr>
                        `;
        }).join('')}
                </tbody>
            </table>
        `;

        // Kontrol visibility button Save berdasarkan lock status
        if (isInputNilaiLocked) {
            btnSave.classList.add('hidden');
        } else {
            btnSave.classList.remove('hidden');
        }

    } catch (e) {
        console.error(e);
        container.innerHTML = '<div class="text-center text-red-400 py-8">Gagal memuat data.</div>';
    }
};

window.saveInputScores = async () => {
    // GUARD: Cek apakah input dikunci
    if (isInputNilaiLocked) {
        showModernAlert('Akses Ditolak', 'Input nilai sedang dikunci oleh admin. Anda tidak dapat menyimpan data.', 'error');
        return;
    }

    const kelas = document.getElementById('select-kelas-input').value;
    const mapel = document.getElementById('select-mapel-input').value;
    const tahunAjaran = raporConfig.tahun_ajaran_aktif;
    const btn = document.getElementById('btn-save-input');
    const rows = document.querySelectorAll('#input-body tr');

    // VALIDASI: Cek semua form sudah terisi
    const emptyInputs = [];
    for (const row of rows) {
        const input = row.querySelector('.score-input');
        if (input && input.value.trim() === '') {
            emptyInputs.push({ row, input, name: row.dataset.name });
        }
    }

    if (emptyInputs.length > 0) {
        // Scroll dan focus ke input kosong pertama
        const firstEmpty = emptyInputs[0];
        firstEmpty.input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        firstEmpty.input.focus();
        // Border merah menggantikan border dasar (border-slate-300 menang urutan CSS Tailwind build atas border-red-500)
        const hadBaseBorder = firstEmpty.input.classList.contains('border-slate-300');
        firstEmpty.input.classList.remove('border-slate-300');
        firstEmpty.input.classList.add('ring-2', 'ring-red-500', 'border-red-500');

        // Hapus highlight setelah 3 detik
        setTimeout(() => {
            firstEmpty.input.classList.remove('ring-2', 'ring-red-500', 'border-red-500');
            if (hadBaseBorder) firstEmpty.input.classList.add('border-slate-300');
        }, 3000);

        showToast('Nilai Belum Lengkap',
            `Masih ada ${emptyInputs.length} siswa yang belum diisi nilai. Silakan lengkapi terlebih dahulu.`,
            'warning'
        );
        return;
    }

    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Menyimpan...';
    btn.disabled = true;

    let savedCount = 0;
    let errorCount = 0;
    const itemsToSave = [];

    try {
        for (const row of rows) {
            const nis = row.dataset.nis;
            const name = row.dataset.name;
            const input = row.querySelector('.score-input');
            const statusCell = row.querySelector('.status-cell');
            const scoreVal = input.value.trim();

            if (scoreVal === '') continue;

            const score = parseInt(scoreVal);
            if (isNaN(score) || score < 70 || score > 100) {
                errorCount++;
                statusCell.innerHTML = '<span class="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Invalid</span>';
                continue;
            }

            itemsToSave.push({ nis, name, score });
            statusCell.innerHTML = '<span class="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Tersimpan</span>';
            savedCount++;
        }

        // 1. Simpan ke Cloudflare D1 SSOT (Pure D1 Write)
        if (cfClient && cfClient.enabled) {
            await cfClient.saveRaporScores({
                items: itemsToSave,
                mapel,
                class: kelas,
                tahun_ajaran: tahunAjaran,
                scoreType: currentScoreType
            });
            console.log(`⚡ [E-Rapor] ${savedCount} nilai berhasil disimpan ke Cloudflare D1 SSOT (0 Firestore Write)`);
        }

        if (typeof window.logAudit === 'function') {
            window.logAudit('UPDATE_RAPOR', 'rapor_scores', null, { mapel, savedCount, errorCount, scoreType: currentScoreType }, `Menginput ${savedCount} nilai ${currentScoreType} untuk mapel ${mapel} kelas ${kelas}`);
        }

        showModernAlert(
            'Nilai Tersimpan',
            `<b>${savedCount}</b> nilai <b>${mapel}</b> berhasil disimpan ke Cloudflare D1.${errorCount ? `<br><span class="text-red-500">${errorCount} nilai invalid.</span>` : ''}`
        );

    } catch (e) {
        console.error(e);
        showModernAlert('Gagal Simpan', e.message, 'error');
    } finally {
        btn.innerHTML = '<i class="fa-solid fa-save mr-2"></i> Simpan Nilai';
        btn.disabled = false;
    }
};

// ======================== TAB 2: IMPORT EXCEL ========================

// --- REFACTOR: Import Excel by NIS Only ---
window.previewPasteData = async () => {
    const textarea = document.getElementById('textarea-paste');
    const mapel = document.getElementById('select-mapel-import').value;
    const container = document.getElementById('preview-container');
    const body = document.getElementById('preview-body');
    const countEl = document.getElementById('preview-count');
    const btnSave = document.getElementById('btn-save-paste');
    const placeholder = document.getElementById('preview-placeholder');

    if (!mapel) {
        showToast('Peringatan', 'Pilih mata pelajaran terlebih dahulu!', 'warning');
        return;
    }

    const rawData = textarea.value.trim();
    if (!rawData) {
        showToast('Peringatan', 'Tidak ada data untuk di-preview!', 'warning');
        return;
    }

    // Tampilkan loading state
    if (placeholder) placeholder.classList.add('hidden');
    container.classList.remove('hidden');
    body.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2 text-2xl"></i><br><span class="text-sm mt-2 block">Sedang mencocokkan data siswa...</span></td></tr>';
    btnSave.classList.add('hidden');

    try {
        // 1. Parsing Input: NIS, NILAI (dengan SMART DETECTION untuk skip header dan baris invalid)
        const lines = rawData.split('\n').filter(l => l.trim());
        const parsedItems = []; // { nis, score }
        const uniqueNIS = new Set();
        let skippedLines = 0;

        // Pattern untuk mendeteksi header tabel (case-insensitive)
        const headerPatterns = /^(no\.?|nomor|nis|nisn|nama|siswa|name|student|nilai|score|kelas|class|mapel|mata|pelajaran)$/i;

        // Helper: Cek apakah sebuah string "terlihat" seperti NIS (minimal 5 digit angka berurutan)
        const looksLikeNIS = (str) => /^\d{5,}$/.test(str.trim());

        // Helper: Cek apakah sebuah string adalah nilai valid (angka 0-100)
        const isValidScoreString = (str) => {
            const num = parseInt(str.trim());
            return !isNaN(num) && num >= 0 && num <= 100;
        };

        lines.forEach((line, lineIdx) => {
            const parts = line.split(/\t|;|,|\s{2,}/).map(p => p.trim()).filter(p => p); // Split by tab, comma, semicolon, atau 2+ spasi

            if (parts.length < 2) {
                skippedLines++;
                return; // Skip baris dengan kurang dari 2 kolom
            }

            // DETEKSI HEADER: Jika sebagian besar kolom adalah kata header, skip baris ini
            const headerMatches = parts.filter(p => headerPatterns.test(p.replace(/[^\w]/g, '')));
            if (headerMatches.length >= 2) {
                console.log(`[Import] Skip header line ${lineIdx + 1}: "${line.substring(0, 50)}..."`);
                skippedLines++;
                return; // Skip header row
            }

            // SMART EXTRACTION: Cari NIS (elemen yang terlihat seperti NIS)
            // Biasanya NIS ada di awal, tapi bisa juga setelah nomor urut
            let nis = null;
            let nisIndex = -1;

            for (let i = 0; i < parts.length; i++) {
                if (looksLikeNIS(parts[i])) {
                    nis = parts[i].trim();
                    nisIndex = i;
                    break;
                }
            }

            // Jika tidak ada yang terlihat seperti NIS, coba elemen pertama (atau kedua jika pertama adalah nomor urut kecil)
            if (!nis) {
                // Cek apakah elemen pertama adalah nomor urut (1, 2, 3, dst - biasanya < 500)
                const firstNum = parseInt(parts[0]);
                if (!isNaN(firstNum) && firstNum < 500 && parts.length > 2) {
                    // Kemungkinan kolom pertama adalah nomor urut, ambil kolom kedua sebagai NIS
                    nis = parts[1].trim();
                    nisIndex = 1;
                } else {
                    nis = parts[0].trim();
                    nisIndex = 0;
                }
            }

            // SMART EXTRACTION: Cari NILAI (angka valid dari kolom terakhir mundur)
            let score = NaN;
            for (let i = parts.length - 1; i > nisIndex; i--) {
                if (isValidScoreString(parts[i])) {
                    score = parseInt(parts[i].trim());
                    break;
                }
            }

            // Validasi: NIS harus ada dan score harus berupa angka
            if (!nis || nis.length < 3) {
                skippedLines++;
                return; // Skip jika NIS tidak valid
            }

            // Cek duplikat NIS dalam satu import
            if (uniqueNIS.has(nis)) {
                console.log(`[Import] Skip duplikat NIS: ${nis}`);
                skippedLines++;
                return;
            }

            parsedItems.push({ nis, score });
            uniqueNIS.add(nis);
        });

        if (skippedLines > 0) {
            console.log(`[Import] Total ${skippedLines} baris di-skip (header/invalid/duplikat)`);
        }

        if (parsedItems.length === 0) {
            body.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-red-500 bg-red-50 font-medium">Format data tidak dikenali. Pastikan format correct: NIS [spasi/tab] NILAI</td></tr>';
            return;
        }

        // 2. Lookup Siswa by NIS (Chunked Query 'IN')
        // Firestore 'IN' limit is 10 items (or 30? Documentation varies, safe bet 10 for 'in' array)
        // Actually limit is 30 for 'IN' operator usually.
        const nisArray = Array.from(uniqueNIS);
        const studentMap = new Map(); // nis -> studentData

        // Prioritaskan resolve dari getStudentsCache (0 Read)
        let allStudentsCache = null;
        if (typeof window.getStudentsCache === 'function') {
            try {
                allStudentsCache = await window.getStudentsCache();
            } catch (e) {}
        }

        const missingNIS = [];
        if (allStudentsCache && allStudentsCache.length > 0) {
            const cacheMap = new Map(allStudentsCache.map(s => [String(s.nis || s.id), s]));
            nisArray.forEach(nis => {
                const s = cacheMap.get(String(nis));
                if (s) {
                    studentMap.set(s.nis || s.id, s);
                } else {
                    missingNIS.push(nis);
                }
            });
        } else {
            missingNIS.push(...nisArray);
        }

        if (missingNIS.length > 0) {
            const remainingMissing = [];
            if (cfClient && cfClient.enabled) {
                for (const nis of missingNIS) {
                    try {
                        const s = await cfClient.getStudentByNis(nis);
                        if (s) {
                            studentMap.set(s.nis || s.id, s);
                        } else {
                            remainingMissing.push(nis);
                        }
                    } catch (e) {
                        remainingMissing.push(nis);
                    }
                }
            } else {
                remainingMissing.push(...missingNIS);
            }

            if (remainingMissing.length > 0) {
                const allStudents = typeof window.getStudentsCache === 'function' ? await window.getStudentsCache() : [];
                remainingMissing.forEach(nis => {
                    const found = allStudents.find(s => String(s.nis || s.id) === String(nis));
                    if (found) {
                        studentMap.set(String(nis), found);
                    }
                });
            }
        }

        // 3. Build Preview Data (dengan validasi kelas yang diampu)
        const mapelTerpilih = mapel;
        const kelasYangDiampu = guruMapelKelasMap[mapelTerpilih] || [];
        const isAdmin = ['super_admin', 'kesiswaan'].includes(currentRole);

        // Jika array kosong dan bukan admin, berarti guru mengampu SEMUA kelas (legacy support)
        // Jika array kosong dan admin, juga semua kelas
        const semuaKelasDiampu = kelasYangDiampu.length === 0;

        previewData = parsedItems.map(item => {
            const student = studentMap.get(item.nis);
            const score = item.score;

            let status = 'OK';
            let statusClass = 'bg-green-100 text-green-700';

            if (!student) {
                status = 'NIS Tidak Ditemukan';
                statusClass = 'bg-red-100 text-red-700';
            } else if (!student.class?.startsWith('XII')) {
                status = `Bukan Kelas XII (${student.class || '-'})`;
                statusClass = 'bg-yellow-100 text-yellow-700';
            } else if (!isAdmin && !semuaKelasDiampu && !kelasYangDiampu.includes(student.class)) {
                // VALIDASI BARU: Cek apakah kelas siswa diampu oleh guru untuk mapel ini
                status = `Kelas Tidak Diampu (${student.class})`;
                statusClass = 'bg-orange-100 text-orange-700';
            } else if (isNaN(score) || score < 70 || score > 100) {
                status = 'Nilai Invalid (70-100)';
                statusClass = 'bg-red-100 text-red-700';
            }

            return {
                nis: item.nis,
                name: student?.name || '-', // Auto from DB
                class: student?.class || '-', // Auto from DB
                score,
                status, statusClass,
                valid: status === 'OK'
            };
        });

        // 4. Render Preview
        body.innerHTML = previewData.map((d, idx) => `
            <tr class="${d.valid ? 'hover:bg-slate-50 dark:hover:bg-slate-800/50' : 'bg-red-50/50 hover:bg-red-50 dark:bg-rose-500/10 dark:hover:bg-rose-500/20'} border-b border-slate-100 dark:border-slate-800/50 last:border-0 transition-colors">
                <td class="px-4 py-3 text-slate-400 dark:text-slate-500 text-xs">${idx + 1}</td>
                <td class="px-4 py-3 font-mono text-xs font-semibold text-slate-600 dark:text-slate-400">${window.escapeHTML(d.nis)}</td>
                <td class="px-4 py-3 font-medium text-slate-700 dark:text-slate-200">${window.escapeHTML(d.name)}</td> <!-- Auto Filled -->
                <td class="px-4 py-3 text-xs text-center dark:text-slate-300">${window.escapeHTML(d.class)}</td> <!-- Auto Filled -->
                <td class="px-4 py-3 text-center font-bold text-slate-800 dark:text-slate-200">${isNaN(d.score) ? '-' : d.score}</td>
                <td class="px-4 py-3 text-center"><span class="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full ${d.statusClass}">${window.escapeHTML(d.status)}</span></td>
            </tr>
        `).join('');

        const validCount = previewData.filter(d => d.valid).length;
        countEl.textContent = `${validCount} valid / ${previewData.length}`;
        btnSave.classList.toggle('hidden', validCount === 0);

    } catch (e) {
        console.error("Error preview import:", e);
        showToast('Error', 'Gagal memproses data import: ' + e.message, 'error');
        body.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-red-400">Error: ${window.escapeHTML(e.message)}</td></tr>`;
    }
};

window.savePasteData = async () => {
    // GUARD: Cek apakah input dikunci
    if (isInputNilaiLocked) {
        showModernAlert('Akses Ditolak', 'Input nilai sedang dikunci oleh admin. Anda tidak dapat menyimpan data.', 'error');
        return;
    }

    const mapel = document.getElementById('select-mapel-import').value;
    const tahunAjaran = raporConfig.tahun_ajaran_aktif;
    const btn = document.getElementById('btn-save-paste');
    const validData = previewData.filter(d => d.valid);

    if (validData.length === 0) {
        showToast('Peringatan', 'Tidak ada data valid untuk disimpan!', 'warning');
        return;
    }

    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Menyimpan...';
    btn.disabled = true;

    try {
        // 1. Simpan ke Cloudflare D1 SSOT (Pure D1 Write)
        if (cfClient && cfClient.enabled) {
            // Kelompokkan data berdasarkan kelas siswa agar bisa disimpan batch per kelas
            const itemsByClass = new Map();
            validData.forEach(d => {
                const k = d.class || 'XII.1';
                if (!itemsByClass.has(k)) itemsByClass.set(k, []);
                itemsByClass.get(k).push({ nis: d.nis, name: d.name, score: d.score });
            });

            for (const [clsName, classItems] of itemsByClass.entries()) {
                await cfClient.saveRaporScores({
                    items: classItems,
                    mapel,
                    class: clsName,
                    tahun_ajaran: tahunAjaran,
                    scoreType: currentScoreType
                });
            }
            console.log(`⚡ [E-Rapor] ${validData.length} nilai import berhasil disimpan ke Cloudflare D1 SSOT (0 Firestore Write)`);
        }

        if (typeof window.logAudit === 'function') {
            window.logAudit('IMPORT_RAPOR', 'rapor_scores', null, { mapel, count: validData.length, scoreType: currentScoreType }, `Mengimport ${validData.length} nilai ${currentScoreType} untuk mapel ${mapel}`);
        }

        showModernAlert('Import Berhasil', `<b>${validData.length}</b> nilai berhasil diimport ke Cloudflare D1.`);

        // Reset UI
        document.getElementById('textarea-paste').value = '';
        document.getElementById('preview-container').classList.add('hidden');

        const placeholder = document.getElementById('preview-placeholder');
        if (placeholder) placeholder.classList.remove('hidden'); // Show placeholder again

        btn.classList.add('hidden');
        previewData = [];

        // Tutup modal import dan reload tabel input jika kelas/mapel telah dipilih
        closeModalImportUjian();
        const selMapelIn = document.getElementById('select-mapel-input');
        const selKelasIn = document.getElementById('select-kelas-input');
        if (selMapelIn && selKelasIn && selMapelIn.value && selKelasIn.value) {
            loadStudentsForInput();
        }

    } catch (e) {
        console.error(e);
        showModernAlert('Gagal Import', e.message, 'error');
    } finally {
        btn.innerHTML = '<i class="fa-solid fa-upload mr-2"></i> Simpan';
        btn.disabled = false;
    }
};

// ======================== TAB 3: REKAP LEGER ========================

window.loadRekapData = async (forceRefresh = false) => {
    const tahun = raporConfig.tahun_ajaran_aktif;
    const kelas = document.getElementById('select-kelas-rekap').value;
    const jenis = document.getElementById('select-jenis-rekap').value; // 'all', 'teori', 'praktik'
    const container = document.getElementById('rekap-container');
    const btnDownload = document.getElementById('btn-download-leger');

    if (!tahun) {
        showToast('Peringatan', 'Tahun ajaran belum dikonfigurasi!', 'warning');
        return;
    }

    container.innerHTML = '<div class="text-center py-8"><i class="fa-solid fa-spinner fa-spin text-2xl text-slate-400"></i></div>';

    try {
        // === SESSION CACHE: Data Skor Rekap ===
        const rekapCacheKey = `session_rekap_scores_${tahun}_${kelas || 'all'}`;
        let cachedScoresData = forceRefresh ? null : getSessionCache(rekapCacheKey);
        let studentScoresArray;

        if (forceRefresh) {
            // Hapus cache lama agar data fresh
            sessionStorage.removeItem(rekapCacheKey);
            console.log('[E-Rapor] Hard refresh: bypass session cache');
        }

        if (cachedScoresData) {
            console.log('[E-Rapor] Menggunakan session cache untuk rekap skor');
            studentScoresArray = cachedScoresData;
        } else {
            let cfRekap = [];

            // 1. Coba ambil dari Cloudflare D1 SSOT (0 Firestore Read)
            if (cfClient && cfClient.enabled) {
                try {
                    cfRekap = await cfClient.getRaporRekap({ class: kelas, tahun_ajaran: tahun });
                    console.log(`⚡ [E-Rapor] Memuat ${cfRekap.length} data rekap dari Cloudflare D1 SSOT (0 Firestore Read)`);
                } catch (cfErr) {
                    console.warn('[E-Rapor] Gagal query rekap dari D1, fallback Firestore:', cfErr);
                }
            }

            if (Array.isArray(cfRekap) && cfRekap.length > 0) {
                studentScoresArray = cfRekap.map(d => ({
                    nis: d.nis,
                    name: d.name,
                    class: d.class,
                    scores_teori: d.scores_teori || {},
                    scores_praktik: d.scores_praktik || {}
                }));
            } else {
                studentScoresArray = [];
            }

            // Simpan ke session cache
            setSessionCache(rekapCacheKey, studentScoresArray);
            console.log('[E-Rapor] Data rekap skor di-cache ke sessionStorage');
            if (forceRefresh) {
                showToast('Data Diperbarui', 'Rekap nilai berhasil di-refresh dari Cloudflare D1.', 'success');
            }
        }

        // Sort data
        rekapData = studentScoresArray.sort((a, b) => {
            // Sort by class, then by name
            if (a.class !== b.class) return a.class.localeCompare(b.class);
            return a.name.localeCompare(b.name);
        });

        if (rekapData.length === 0) {
            container.innerHTML = '<div class="text-center text-slate-400 py-8">Tidak ada data nilai untuk filter ini.</div>';
            btnDownload.classList.add('hidden');
            return;
        }

        // Tentukan mapel list berdasarkan jenis yang dipilih
        let mapelList = [];
        if (jenis === 'teori') {
            mapelList = raporConfig.mapel_teori || raporConfig.mapel_list || [];
        } else if (jenis === 'praktik') {
            mapelList = raporConfig.mapel_praktik || [];
        } else {
            // 'all' - gunakan semua mapel teori (karena praktik adalah subset)
            mapelList = raporConfig.mapel_teori || raporConfig.mapel_list || [];
        }

        // Simpan jenis untuk download
        rekapData._jenis = jenis;

        // Tentukan mapel praktik set untuk pengecekan cepat
        const mapelPraktikSet = new Set(raporConfig.mapel_praktik || []);

        // Untuk jenis='all', buat struktur kolom khusus: mapel T/P atau plain
        let columnDefs = []; // { mapel, type: 'teori'|'praktik'|'plain', header }
        if (jenis === 'all') {
            mapelList.forEach(m => {
                if (mapelPraktikSet.has(m)) {
                    // Mapel punya praktik: 2 kolom
                    columnDefs.push({ mapel: m, type: 'teori', header: `${m} (T)` });
                    columnDefs.push({ mapel: m, type: 'praktik', header: `${m} (P)` });
                } else {
                    // Mapel tanpa praktik: 1 kolom tanpa suffix
                    columnDefs.push({ mapel: m, type: 'plain', header: m });
                }
            });
        } else if (jenis === 'teori') {
            mapelList.forEach(m => columnDefs.push({ mapel: m, type: 'teori', header: m }));
        } else {
            // praktik
            mapelList.forEach(m => columnDefs.push({ mapel: m, type: 'praktik', header: m }));
        }

        // Render Table
        container.innerHTML = `
            <table class="w-full text-sm text-left border border-slate-200 dark:border-slate-800">
                <thead class="bg-emerald-50 dark:bg-emerald-900/20 text-xs uppercase text-slate-600 dark:text-emerald-300">
                    <tr>
                        <th class="px-3 py-2 border-r dark:border-slate-800">No</th>
                        <th class="px-3 py-2 border-r dark:border-slate-800">NIS</th>
                        <th class="px-3 py-2 border-r dark:border-slate-800">Nama</th>
                        <th class="px-3 py-2 border-r dark:border-slate-800">Kelas</th>
                        ${columnDefs.map(col => `<th class="px-3 py-2 border-r dark:border-slate-800 text-center">${window.escapeHTML(col.header)}</th>`).join('')}
                        <th class="px-3 py-2 text-center border-r dark:border-slate-800">Total</th>
                        <th class="px-3 py-2 text-center">Rata-rata</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100 dark:divide-slate-800/50" id="rekap-body">
                    ${rekapData.map((s, idx) => {
            const scores = columnDefs.map(col => {
                const safeM = safeKey(col.mapel);
                if (col.type === 'teori' || col.type === 'plain') {
                    return s.scores_teori?.[safeM] ?? s.scores_teori?.[col.mapel] ?? '-';
                } else {
                    return s.scores_praktik?.[safeM] ?? s.scores_praktik?.[col.mapel] ?? '-';
                }
            });
            const numScores = scores.filter(v => typeof v === 'number');
            const total = numScores.reduce((a, b) => a + b, 0);
            const avg = numScores.length > 0
                ? (total / numScores.length).toFixed(1)
                : '-';

            return `
                            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                <td class="px-3 py-2 border-r dark:border-slate-800/50 text-slate-400 dark:text-slate-500">${idx + 1}</td>
                                <td class="px-3 py-2 border-r dark:border-slate-800/50 font-mono text-xs dark:text-slate-300">${window.escapeHTML(s.nis)}</td>
                                <td class="px-3 py-2 border-r dark:border-slate-800/50 font-medium dark:text-slate-200">${window.escapeHTML(s.name)}</td>
                                <td class="px-3 py-2 border-r dark:border-slate-800/50 text-xs dark:text-slate-300">${window.escapeHTML(s.class)}</td>
                                ${scores.map(sc => `<td class="px-3 py-2 border-r dark:border-slate-800/50 text-center ${sc === '-' ? 'text-slate-300 dark:text-slate-600' : 'font-bold dark:text-slate-200'}">${sc}</td>`).join('')}
                                <td class="px-3 py-2 border-r dark:border-slate-800/50 text-center font-bold text-blue-600 dark:text-blue-400">${numScores.length > 0 ? total : '-'}</td>
                                <td class="px-3 py-2 text-center font-bold text-emerald-600 dark:text-emerald-400">${avg}</td>
                            </tr>
                        `;
        }).join('')}
                </tbody>
                <tfoot class="bg-slate-50 dark:bg-slate-800/50 font-bold text-xs uppercase text-slate-700 dark:text-slate-300">
                    <tr>
                        <td colspan="4" class="px-3 py-2 border-r dark:border-slate-800/50 text-center">RATA-RATA KELAS</td>
                        ${columnDefs.map(col => {
            const safeM = safeKey(col.mapel);
            const scoresKey = (col.type === 'teori' || col.type === 'plain') ? 'scores_teori' : 'scores_praktik';
            const allScores = rekapData.map(s => s[scoresKey]?.[safeM] ?? s[scoresKey]?.[col.mapel]).filter(v => typeof v === 'number');
            const avgMapel = allScores.length > 0
                ? (allScores.reduce((a, b) => a + b, 0) / allScores.length).toFixed(1)
                : '-';
            return `<td class="px-3 py-2 border-r dark:border-slate-800/50 text-center">${avgMapel}</td>`;
        }).join('')}
                        <td class="px-3 py-2 border-r dark:border-slate-800/50 text-center bg-blue-50 dark:bg-blue-900/10">-</td>
                        <td class="px-3 py-2 text-center bg-emerald-50 dark:bg-emerald-900/10">-</td>
                    </tr>
                </tfoot>
            </table>
            <p class="text-xs text-slate-400 mt-2">Total: ${rekapData.length} siswa, ${columnDefs.length} kolom nilai</p>
        `;

        // Setup sticky scrollbar
        setupStickyScrollbar();

        // Store mapel list for download
        rekapData._mapelList = mapelList;
        btnDownload.classList.remove('hidden');

    } catch (e) {
        console.error(e);
        container.innerHTML = '<div class="text-center text-red-400 py-8">Gagal memuat data.</div>';
    }
};

// Setup sticky scrollbar untuk tabel rekap
function setupStickyScrollbar() {
    const container = document.getElementById('rekap-container');
    const wrapper = document.getElementById('rekap-scrollbar-wrapper');
    const scrollbar = document.getElementById('rekap-scrollbar');
    const scrollbarContent = document.getElementById('rekap-scrollbar-content');
    const table = container.querySelector('table');

    if (!table || !wrapper || !scrollbar || !scrollbarContent) return;

    // Set width scrollbar content sama dengan tabel
    scrollbarContent.style.width = table.scrollWidth + 'px';
    wrapper.classList.remove('hidden');

    // Sync scroll: scrollbar -> container
    scrollbar.addEventListener('scroll', () => {
        container.scrollLeft = scrollbar.scrollLeft;
    });

    // Sync scroll: container -> scrollbar
    container.addEventListener('scroll', () => {
        scrollbar.scrollLeft = container.scrollLeft;
    });
}

window.downloadLeger = () => {
    if (rekapData.length === 0) return;

    try {
        const tahun = raporConfig.tahun_ajaran_aktif || '';
        const kelasDipilih = document.getElementById('select-kelas-rekap').value;
        const jenis = rekapData._jenis || 'all'; // 'teori', 'praktik', 'all'
        const mapelList = rekapData._mapelList || [];

        // Tentukan mapel praktik set untuk pengecekan cepat
        const mapelPraktikSet = new Set(raporConfig.mapel_praktik || []);

        // Buat definisi kolom sesuai jenis
        let columnDefs = [];
        if (jenis === 'all') {
            mapelList.forEach(m => {
                if (mapelPraktikSet.has(m)) {
                    columnDefs.push({ mapel: m, type: 'teori', header: `${m} (T)` });
                    columnDefs.push({ mapel: m, type: 'praktik', header: `${m} (P)` });
                } else {
                    columnDefs.push({ mapel: m, type: 'plain', header: m });
                }
            });
        } else if (jenis === 'teori') {
            mapelList.forEach(m => columnDefs.push({ mapel: m, type: 'teori', header: m }));
        } else {
            mapelList.forEach(m => columnDefs.push({ mapel: m, type: 'praktik', header: m }));
        }

        // Helper: Build rows untuk data siswa tertentu
        const buildRows = (students, columnDefs) => {
            const header = ['No', 'NIS', 'Nama', 'Kelas', ...columnDefs.map(c => c.header), 'Total', 'Rata-rata'];
            const rows = students.map((s, idx) => {
                const scores = columnDefs.map(col => {
                    const safeM = safeKey(col.mapel);
                    if (col.type === 'teori' || col.type === 'plain') {
                        return s.scores_teori?.[safeM] ?? s.scores_teori?.[col.mapel] ?? '';
                    } else {
                        return s.scores_praktik?.[safeM] ?? s.scores_praktik?.[col.mapel] ?? '';
                    }
                });
                const numScores = scores.filter(v => typeof v === 'number');
                const total = numScores.reduce((a, b) => a + b, 0);
                const avg = numScores.length > 0
                    ? Number((total / numScores.length).toFixed(1))
                    : '';
                return [idx + 1, s.nis, s.name, s.class, ...scores, total || '', avg];
            });

            // Baris Rata-rata
            const avgRow = ['RATA-RATA', '', '', ''];
            columnDefs.forEach(col => {
                const safeM = safeKey(col.mapel);
                const scoresKey = (col.type === 'teori' || col.type === 'plain') ? 'scores_teori' : 'scores_praktik';
                const allScores = students.map(s => s[scoresKey]?.[safeM] ?? s[scoresKey]?.[col.mapel]).filter(v => typeof v === 'number');
                const avgMapel = allScores.length > 0
                    ? Number((allScores.reduce((a, b) => a + b, 0) / allScores.length).toFixed(1))
                    : '';
                avgRow.push(avgMapel);
            });
            avgRow.push(''); // Kolom Total
            avgRow.push(''); // Kolom Rata-rata

            return [header, ...rows, avgRow];
        };

        // Tentukan label jenis untuk nama file
        const jenisLabel = jenis === 'all' ? 'Lengkap' : jenis === 'teori' ? 'Teori' : 'Praktik';

        const wb = XLSX.utils.book_new();

        if (kelasDipilih) {
            // SINGLE CLASS: 1 Sheet saja
            const sheetData = buildRows(rekapData, columnDefs);
            const ws = XLSX.utils.aoa_to_sheet(sheetData);
            XLSX.utils.book_append_sheet(wb, ws, kelasDipilih);

            const filename = `Leger_${jenisLabel}_${kelasDipilih}_${tahun.replace('/', '-')}.xlsx`;
            XLSX.writeFile(wb, filename);
            showToast('Download Berhasil', `File ${filename} telah diunduh.`, 'success');

        } else {
            // SEMUA KELAS: Multi-sheet
            // Sheet 1: Semua Siswa
            const allData = buildRows(rekapData, columnDefs);
            const wsAll = XLSX.utils.aoa_to_sheet(allData);
            XLSX.utils.book_append_sheet(wb, wsAll, 'Semua Kelas XII');

            // Sheet per Kelas
            const kelasSet = [...new Set(rekapData.map(s => s.class))].sort((a, b) =>
                a.localeCompare(b, undefined, { numeric: true })
            );

            kelasSet.forEach(kelas => {
                const studentsInClass = rekapData.filter(s => s.class === kelas);
                if (studentsInClass.length > 0) {
                    const classData = buildRows(studentsInClass, columnDefs);
                    const wsClass = XLSX.utils.aoa_to_sheet(classData);
                    XLSX.utils.book_append_sheet(wb, wsClass, kelas);
                }
            });

            const filename = `Leger_${jenisLabel}_Semua_Kelas_${tahun.replace('/', '-')}.xlsx`;
            XLSX.writeFile(wb, filename);
            showToast('Download Berhasil', `File ${filename} telah diunduh dengan ${kelasSet.length + 1} sheet.`, 'success');
        }
    } catch (e) {
        console.error('[E-Rapor] Error downloading leger:', e);
        showModernAlert('Error', 'Gagal mendownload leger: ' + e.message, 'error');
    }
};

// ============== E-RAPOR CONFIGURATION (TAB PENGATURAN) ==============

let allUsersCache = [];        // Cache users
let selectedMapelForGuru = ''; // Context for Guru Modal
let currentSettingsMapel = ''; // Context for Mapel Settings Modal
let allKelasListSettings = []; // Semua kelas X-XII

// Helper: Escape HTML string
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Helper: Get User Name by UID
function getUserNameByUid(uid) {
    if (!uid) return '';

    // 1. Cek di allUsersCache
    const user = allUsersCache.find(u => u.uid === uid || u.id === uid || u.linkedTeacherId === uid);
    if (user && user.name) return user.name;

    // 2. Fallback cek di cache sinkron window.getTeachersCacheSync()
    if (window.getTeachersCacheSync) {
        const teachers = window.getTeachersCacheSync();
        if (Array.isArray(teachers) && teachers.length > 0) {
            const teacher = teachers.find(t => t.id === uid || t.uid === uid || t.nip === uid || t.nik === uid);
            if (teacher && teacher.name) return teacher.name;
        }
    }

    return uid;
}

// Helper: Invalidasi Cache Rapor Config
function invalidateRaporConfigCache() {
    localStorage.removeItem('cache_rapor_config');
    localStorage.removeItem('simas_mapel_config_cache');
    localStorage.removeItem('simas_rapor_config_cache');
    localStorage.removeItem('simas_rapor_config');
}

// Load all users untuk cache (Murni SSOT Master Teachers / GTK - 0 Firestore Read)
async function loadAllUsersCache() {
    if (allUsersCache.length > 0) return allUsersCache;

    const sessionCacheKey = 'simas_erapor_users_cache';
    try {
        const cached = sessionStorage.getItem(sessionCacheKey);
        if (cached) {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed) && parsed.length > 0) {
                allUsersCache = parsed;
                return allUsersCache;
            }
        }
    } catch (e) {}

    try {
        const userMap = new Map();
        const seenNames = new Set();

        // SSOT Cloudflare D1 / IndexedDB (0 Firestore Read)
        if (window.getTeachersCache) {
            const teachers = await window.getTeachersCache();
            if (Array.isArray(teachers)) {
                teachers.forEach(t => {
                    const status = (t.status || 'aktif').toLowerCase();
                    if (status === 'aktif' && t.name) {
                        const norm = t.name.trim().toLowerCase();
                        const isBk = (t.jabatan && t.jabatan.toLowerCase().includes('bk')) || (t.mapel && t.mapel.toLowerCase().includes('bk'));
                        if (!seenNames.has(norm)) {
                            seenNames.add(norm);
                            userMap.set(t.id || t.nip || t.nik, {
                                uid: t.id || t.nip || t.nik,
                                name: t.name.trim(),
                                email: t.email || '',
                                role: isBk ? 'guru_bk' : 'guru_mapel',
                                linkedTeacherId: t.id || t.nip || t.nik
                            });
                        }
                    }
                });
            }
        }

        allUsersCache = Array.from(userMap.values()).sort((a, b) => a.name.localeCompare(b.name));
        try {
            sessionStorage.setItem(sessionCacheKey, JSON.stringify(allUsersCache));
        } catch (e) {}
        return allUsersCache;

    } catch (e) {
        console.error('[E-Rapor] Error loading users cache:', e);
        return [];
    }
}


// Update UI toggle input nilai di tab Pengaturan
function updateInputNilaiUI(type, isEnabled) {
    const statusLabel = document.getElementById(`status-input-${type}`);
    const iconContainer = document.getElementById(`icon-input-${type}`);
    const card = document.getElementById(`card-toggle-input-${type}`);

    if (isEnabled) {
        if (statusLabel) {
            statusLabel.textContent = `• AKTIF (Bisa Input)`;
            statusLabel.className = 'text-[10px] text-emerald-600 font-bold';
        }
        if (iconContainer) {
            iconContainer.className = 'w-5 h-5 rounded bg-emerald-600 text-white flex items-center justify-center';
            iconContainer.innerHTML = '<i class="fa-solid fa-lock-open text-[8px]"></i>';
        }
        if (card) {
            card.className = 'flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60';
        }
    } else {
        if (statusLabel) {
            statusLabel.textContent = `• TERKUNCI`;
            statusLabel.className = 'text-[10px] text-rose-600 font-medium';
        }
        if (iconContainer) {
            iconContainer.className = 'w-5 h-5 rounded bg-rose-600 text-white flex items-center justify-center';
            iconContainer.innerHTML = '<i class="fa-solid fa-lock text-[8px]"></i>';
        }
        if (card) {
            card.className = 'flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60';
        }
    }
}

// Save status toggle ke Firestore (dual: teori & praktik)
window.saveInputNilaiStatus = async function () {
    if (currentRole !== 'super_admin' && !isWakasekKurikulum) {
        showModernAlert('Akses Ditolak', 'Anda tidak memiliki hak akses untuk mengubah status input nilai.', 'error');
        return;
    }

    const toggleTeori = document.getElementById('toggle-input-teori');
    const togglePraktik = document.getElementById('toggle-input-praktik');
    const teoriEnabled = toggleTeori ? toggleTeori.checked : false;
    const praktikEnabled = togglePraktik ? togglePraktik.checked : false;

    try {
        await saveRaporConfig({
            input_nilai_teori_enabled: teoriEnabled,
            input_nilai_praktik_enabled: praktikEnabled
        });

        updateInputNilaiUI('teori', teoriEnabled);
        updateInputNilaiUI('praktik', praktikEnabled);

        const teoriStatus = teoriEnabled ? '<b>AKTIF</b>' : '<b>TERKUNCI</b>';
        const praktikStatus = praktikEnabled ? '<b>AKTIF</b>' : '<b>TERKUNCI</b>';

        showModernAlert(
            'Pengaturan Disimpan',
            `Input Nilai Teori: ${teoriStatus}<br>Input Nilai Praktik: ${praktikStatus}`
        );

    } catch (e) {
        console.error('[E-Rapor] Error saving input nilai status:', e);
        showModernAlert('Error', 'Gagal menyimpan pengaturan: ' + e.message, 'error');
        if (toggleTeori) toggleTeori.checked = !teoriEnabled;
        if (togglePraktik) togglePraktik.checked = !praktikEnabled;
    }
};

// Save Tanggal Cetak Rapor Resmi (SSOT Kurikulum)
window.saveTanggalCetakRapor = async function () {
    if (currentRole !== 'super_admin' && !isWakasekKurikulum) {
        showModernAlert('Akses Ditolak', 'Hanya Kurikulum / Super Admin yang dapat mengatur tanggal cetak rapor.', 'error');
        return;
    }

    const inputTgl = document.getElementById('input-tgl-cetak-rapor');
    const val = inputTgl ? inputTgl.value : '';
    if (!val) {
        showModernAlert('Peringatan', 'Silakan pilih tanggal cetak rapor terlebih dahulu.', 'warning');
        return;
    }

    try {
        await saveRaporConfig({
            tanggal_cetak_rapor: val,
            tgl_cetak_rapor: val
        });

        raporConfig.tanggal_cetak_rapor = val;
        raporConfig.tgl_cetak_rapor = val;

        const formalDate = (typeof formatDateIndoFormal === 'function')
            ? formatDateIndoFormal(val)
            : val;

        showModernAlert(
            'Tanggal Cetak Rapor Disimpan',
            `Tanggal cetak rapor resmi sekolah berhasil diperbarui:<br><b class="text-amber-600">${escapeHtml(formalDate)}</b><br><span class="text-xs text-slate-500">Tanggal ini otomatis tercantum pada seluruh lembar cetak rapor sekolah (SSOT).</span>`
        );
    } catch (e) {
        console.error('[E-Rapor] Error saving tanggal cetak rapor:', e);
        showModernAlert('Error', 'Gagal menyimpan tanggal cetak rapor: ' + e.message, 'error');
    }
};

// Render Master List Mapel (Unified List)
async function renderUnifiedMapelList() {
    const container = document.getElementById('unified-mapel-list');
    const countEl = document.getElementById('mapel-count');
    const inputTahun = document.getElementById('input-tahun-ajaran');
    const inputTglRapor = document.getElementById('input-tgl-cetak-rapor');

    // Pastikan user cache sudah terisi sebelum render
    if (allUsersCache.length === 0) {
        await loadAllUsersCache();
    }

    if (inputTahun && raporConfig.tahun_ajaran_aktif) {
        inputTahun.value = raporConfig.tahun_ajaran_aktif;
    }

    // Load Tanggal Cetak Rapor Resmi
    if (inputTglRapor) {
        inputTglRapor.value = raporConfig.tanggal_cetak_rapor || raporConfig.tgl_cetak_rapor || '';
    }

    // Load status toggle
    const toggleTeori = document.getElementById('toggle-input-teori');
    if (toggleTeori) toggleTeori.checked = raporConfig.input_nilai_teori_enabled === true;
    updateInputNilaiUI('teori', raporConfig.input_nilai_teori_enabled === true);

    const togglePraktik = document.getElementById('toggle-input-praktik');
    if (togglePraktik) togglePraktik.checked = raporConfig.input_nilai_praktik_enabled === true;
    updateInputNilaiUI('praktik', raporConfig.input_nilai_praktik_enabled === true);

    if (!container) return;

    const masterList = raporConfig.mapel_list || [];
    const praktikFlags = raporConfig.mapel_praktik_flags || {};
    const guruMap = raporConfig.mapel_guru || {};

    if (countEl) countEl.textContent = `${masterList.length} Mapel`;

    if (masterList.length === 0) {
        container.innerHTML = `<div class="text-center text-slate-400 dark:text-slate-500 text-sm py-8 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-dashed border-slate-300 dark:border-slate-700">
            <i class="fa-solid fa-folder-open mb-2 text-2xl"></i><br>Belum ada mata pelajaran.<br>Silakan tambahkan baru di atas.
        </div>`;
        return;
    }

    container.innerHTML = masterList.map((mapel, idx) => {
        const isPraktik = praktikFlags[mapel] === true;
        const guruList = guruMap[mapel] || [];

        const normalizedGuru = guruList.map(g => {
            if (typeof g === 'string') return { uid: g, kelas: [] };
            return g;
        });

        const guruBadges = normalizedGuru.length > 0
            ? normalizedGuru.map(g => {
                let kelasStr = '(Semua Kelas)';
                if (g.kelas && g.kelas.length > 0) {
                    kelasStr = `(${g.kelas.join(', ')})`;
                }

                const resolvedName = getUserNameByUid(g.uid);
                const guruName = (resolvedName && resolvedName !== g.uid) ? resolvedName : (g.name || g.uid);


                return `
                    <div class="inline-flex items-center gap-1.5 text-[11px] bg-indigo-50/80 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 px-2.5 py-1 rounded-lg border border-indigo-100 dark:border-indigo-800/60 cursor-pointer hover:bg-indigo-100 dark:hover:bg-indigo-800/60 transition-all shadow-sm my-0.5" 
                        onclick="window.editGuruKelas('${escapeHtml(mapel)}', '${g.uid}')" 
                        title="Klik untuk edit: ${escapeHtml(guruName)}">
                        <i class="fa-solid fa-user text-[9px] text-indigo-500 shrink-0"></i>
                        <span class="font-bold text-slate-800 dark:text-slate-100">${escapeHtml(guruName)}</span>
                        <span class="text-indigo-600 dark:text-indigo-400 font-semibold text-[10px]">${escapeHtml(kelasStr)}</span>
                    </div>
                `;
            }).join('')
            : '<span class="text-[11px] text-slate-400 dark:text-slate-500 italic">Belum ada guru</span>';

        return `
            <div class="grid grid-cols-12 gap-4 items-center p-3 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/50 border-b border-slate-100 dark:border-slate-700 last:border-0 transition-colors group">
                <!-- No -->
                <div class="col-span-1 text-center font-bold text-slate-400 text-xs">${idx + 1}</div>
                
                <!-- Nama Mapel (Clickable) -->
                <div onclick="window.openMapelSettings('${escapeHtml(mapel)}')" 
                    class="col-span-4 md:col-span-3 font-bold text-slate-700 dark:text-slate-200 text-sm truncate cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline transition-colors flex items-center gap-1" 
                    title="Klik untuk pengaturan ${escapeHtml(mapel)}">
                    <i class="fa-solid fa-cog text-[10px] text-slate-300 dark:text-slate-500 mr-1 group-hover:text-indigo-400"></i>
                    <span>${escapeHtml(mapel)}</span>
                    ${raporConfig.mapel_xml_source ? `<span class="px-1.5 py-0.5 text-[9px] font-extrabold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 rounded border border-emerald-200 dark:border-emerald-800 shrink-0">XML</span>` : ''}
                </div>


                <!-- Toggle Praktik -->
                <div class="col-span-2 flex justify-center">
                    <label class="inline-flex items-center cursor-pointer">
                        <input type="checkbox" value="" class="sr-only peer" 
                            ${isPraktik ? 'checked' : ''} 
                            onchange="window.togglePraktikStatus('${escapeHtml(mapel)}', this.checked)">
                        <div class="relative w-9 h-5 bg-slate-200 dark:bg-slate-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                        <span class="ml-2 text-[10px] font-medium text-slate-500 dark:text-slate-400 hidden md:inline-block">${isPraktik ? 'Ya' : 'Tidak'}</span>
                    </label>
                </div>

                <!-- Guru List (klik badge untuk edit) -->
                <div class="col-span-4 md:col-span-5 flex flex-wrap gap-1 items-center">
                    ${guruBadges}
                </div>

                <!-- Actions -->
                <div class="col-span-1 text-right flex items-center justify-end gap-1">
                    <button onclick="window.openEditMapelModal('${escapeHtml(mapel)}')" 
                        class="p-2 text-slate-400 dark:text-slate-500 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/30 rounded-lg transition-all" title="Edit Nama Mapel">
                        <i class="fa-solid fa-pen-to-square text-xs"></i>
                    </button>
                    <button onclick="window.deleteMapel('${escapeHtml(mapel)}')" 
                        class="p-2 text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-all" title="Hapus Mapel">
                        <i class="fa-solid fa-trash text-xs"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// Tambah Mapel Baru
window.addMapel = async function () {
    if (currentRole !== 'super_admin' && !isWakasekKurikulum) {
        showModernAlert('Akses Ditolak', 'Anda tidak memiliki akses untuk menambah mapel.', 'error');
        return;
    }

    const input = document.getElementById('input-new-mapel');
    const mapel = (input ? input.value : '').trim();

    if (!mapel) {
        showModernAlert('Peringatan', 'Nama mapel tidak boleh kosong!', 'error');
        return;
    }

    const masterList = [...(raporConfig.mapel_list || [])];
    if (masterList.some(m => m.toLowerCase() === mapel.toLowerCase())) {
        showModernAlert('Peringatan', 'Mata pelajaran tersebut sudah ada!', 'error');
        return;
    }

    try {
        masterList.push(mapel);
        masterList.sort();

        const guruMap = { ...(raporConfig.mapel_guru || {}) };
        if (!guruMap[mapel]) guruMap[mapel] = [];

        const praktikFlags = { ...(raporConfig.mapel_praktik_flags || {}) };
        if (praktikFlags[mapel] === undefined) praktikFlags[mapel] = false;

        await saveRaporConfig({
            mapel_list: masterList,
            mapel_guru: guruMap,
            mapel_praktik_flags: praktikFlags
        });

        if (input) input.value = '';
        renderUnifiedMapelList();
        showModernAlert('Berhasil', `"${escapeHtml(mapel)}" berhasil ditambahkan.`, 'success');

    } catch (e) {
        console.error('[E-Rapor] Error adding mapel:', e);
        showModernAlert('Error', 'Gagal menambahkan mapel: ' + e.message, 'error');
    }
};

// Buka Modal Edit Nama Mapel
window.openEditMapelModal = function (mapelName) {
    if (currentRole !== 'super_admin' && !isWakasekKurikulum) {
        showModernAlert('Akses Ditolak', 'Anda tidak memiliki akses untuk mengubah nama mapel.', 'error');
        return;
    }

    const modal = document.getElementById('modal-edit-mapel-name');
    const oldInput = document.getElementById('edit-mapel-old-name');
    const input = document.getElementById('edit-mapel-input-name');

    if (!modal || !oldInput || !input) return;

    oldInput.value = mapelName;
    input.value = mapelName;

    modal.classList.remove('hidden');
    setTimeout(() => {
        input.focus();
        input.select();
    }, 100);
};

// Simpan Perubahan Nama Mapel
window.saveEditMapelName = async function () {
    if (currentRole !== 'super_admin' && !isWakasekKurikulum) {
        showModernAlert('Akses Ditolak', 'Anda tidak memiliki akses untuk mengubah nama mapel.', 'error');
        return;
    }

    const oldInput = document.getElementById('edit-mapel-old-name');
    const input = document.getElementById('edit-mapel-input-name');

    const oldName = oldInput ? oldInput.value.trim() : '';
    const newName = input ? input.value.trim() : '';

    if (!newName) {
        showModernAlert('Peringatan', 'Nama mata pelajaran tidak boleh kosong!', 'error');
        return;
    }

    if (newName === oldName) {
        document.getElementById('modal-edit-mapel-name')?.classList.add('hidden');
        return;
    }

    const masterList = [...(raporConfig.mapel_list || [])];
    
    // Cek duplikasi (case-insensitive) jika nama berubah (kecuali jika hanya ubah kapitalisasi mapel yang sama)
    if (newName.toLowerCase() !== oldName.toLowerCase()) {
        if (masterList.some(m => m.toLowerCase() === newName.toLowerCase())) {
            showModernAlert('Peringatan', `Mata pelajaran "${escapeHtml(newName)}" sudah ada!`, 'error');
            return;
        }
    }

    try {
        // 1. Update masterList array
        const idx = masterList.indexOf(oldName);
        if (idx !== -1) {
            masterList[idx] = newName;
        } else {
            masterList.push(newName);
        }
        masterList.sort();

        // 2. Update mapel_praktik_flags
        const isPraktik = (raporConfig.mapel_praktik_flags || {})[oldName];
        const praktikFlags = { ...(raporConfig.mapel_praktik_flags || {}) };
        delete praktikFlags[oldName];
        praktikFlags[newName] = isPraktik === true;

        // 3. Update mapel_guru
        const currentGurus = (raporConfig.mapel_guru || {})[oldName] || [];
        const guruMap = { ...(raporConfig.mapel_guru || {}) };
        delete guruMap[oldName];
        guruMap[newName] = currentGurus;

        await saveRaporConfig({
            mapel_list: masterList,
            mapel_praktik_flags: praktikFlags,
            mapel_guru: guruMap
        });

        // 4. Update konteks jika modal settings mapel sedang terbuka untuk mapel ini
        if (currentSettingsMapel === oldName) {
            currentSettingsMapel = newName;
            const settingsNameEl = document.getElementById('modal-settings-mapel-name');
            if (settingsNameEl) settingsNameEl.textContent = newName;
        }

        document.getElementById('modal-edit-mapel-name')?.classList.add('hidden');
        renderUnifiedMapelList();
        showModernAlert('Berhasil', `Nama mapel "${escapeHtml(oldName)}" berhasil diubah menjadi "${escapeHtml(newName)}".`, 'success');

    } catch (e) {
        console.error('[E-Rapor] Error editing mapel name:', e);
        showModernAlert('Error', 'Gagal mengubah nama mapel: ' + e.message, 'error');
    }
};

// Hapus Mapel
window.deleteMapel = async function (mapelName) {
    if (currentRole !== 'super_admin' && !isWakasekKurikulum) {
        showModernAlert('Akses Ditolak', 'Anda tidak memiliki akses untuk menghapus mapel.', 'error');
        return;
    }

    const confirmed = typeof window.showConfirmModal === 'function'
        ? await window.showConfirmModal(`Yakin ingin menghapus mapel "${mapelName}"? Pengaturan guru pengampu dan status praktik mapel ini juga akan terhapus.`, 'Hapus Mata Pelajaran', 'danger')
        : true;
    if (!confirmed) return;

    try {
        let masterList = (raporConfig.mapel_list || []).filter(m => m !== mapelName);
        const praktikFlags = { ...(raporConfig.mapel_praktik_flags || {}) };
        delete praktikFlags[mapelName];
        const guruMap = { ...(raporConfig.mapel_guru || {}) };
        delete guruMap[mapelName];

        await saveRaporConfig({
            mapel_list: masterList,
            mapel_praktik_flags: praktikFlags,
            mapel_guru: guruMap
        });

        renderUnifiedMapelList();
        showModernAlert('Berhasil', `"${escapeHtml(mapelName)}" telah dihapus.`, 'success');

    } catch (e) {
        console.error('[E-Rapor] Error deleting mapel:', e);
        showModernAlert('Error', 'Gagal menghapus mapel: ' + e.message, 'error');
    }
};

// Toggle Status Praktik Mapel
window.togglePraktikStatus = async function (mapelName, isChecked) {
    if (currentRole !== 'super_admin' && !isWakasekKurikulum) {
        showModernAlert('Akses Ditolak', 'Anda tidak memiliki akses untuk mengubah status praktik.', 'error');
        return;
    }

    try {
        const praktikFlags = { ...(raporConfig.mapel_praktik_flags || {}) };
        praktikFlags[mapelName] = isChecked;

        await saveRaporConfig({
            mapel_praktik_flags: praktikFlags
        });

        renderUnifiedMapelList();
        showModernAlert('Berhasil', `Status praktik untuk "${escapeHtml(mapelName)}" diperbarui.`, 'success');

    } catch (e) {
        console.error('[E-Rapor] Error toggle praktik:', e);
        showModernAlert('Error', 'Gagal update status: ' + e.message, 'error');
    }
};

// Helper: Sanitasi Rapor Config (Eliminasi Orphan Keys)
function sanitizeRaporConfig(configToSave) {
    const masterList = configToSave.mapel_list || raporConfig.mapel_list || [];
    const masterSet = new Set(masterList);

    const updatedGuru = { ...(configToSave.mapel_guru || raporConfig.mapel_guru || {}) };
    for (const key of Object.keys(updatedGuru)) {
        if (!masterSet.has(key) || typeof updatedGuru[key] === 'undefined' || updatedGuru[key] === null || (typeof updatedGuru[key] === 'object' && updatedGuru[key]?._methodName === 'deleteField')) {
            delete updatedGuru[key];
        }
    }

    const updatedPraktik = { ...(configToSave.mapel_praktik_flags || raporConfig.mapel_praktik_flags || {}) };
    for (const key of Object.keys(updatedPraktik)) {
        if (!masterSet.has(key) || typeof updatedPraktik[key] === 'undefined' || updatedPraktik[key] === null || (typeof updatedPraktik[key] === 'object' && updatedPraktik[key]?._methodName === 'deleteField')) {
            delete updatedPraktik[key];
        }
    }

    return {
        ...configToSave,
        mapel_guru: updatedGuru,
        mapel_praktik_flags: updatedPraktik
    };
}

// Helper: Save Full Config
async function saveRaporConfig(newConfig = {}) {
    const mergedConfig = { ...raporConfig, ...newConfig };
    const sanitizedPayload = sanitizeRaporConfig(mergedConfig);

    // Simpan ke Cloudflare D1 SSOT (0 Firestore Write)
    if (cfClient && cfClient.enabled) {
        try {
            await cfClient.saveRaporConfig(sanitizedPayload);
            console.log('⚡ [E-Rapor] Konfigurasi rapor berhasil disimpan ke Cloudflare D1 SSOT');
        } catch (cfErr) {
            console.error('[E-Rapor] Gagal simpan config ke Cloudflare D1:', cfErr);
            throw cfErr;
        }
    }

    invalidateRaporConfigCache();
}

// --- GURU PENGAMPU LOGIC ---

// Load Semua Kelas Aktif (X-XII) untuk pengaturan mapel
async function loadAllKelasForSettings() {
    if (allKelasListSettings.length > 0) return;

    try {
        const allStudents = await window.getStudentsCache();
        const kelasSet = new Set();
        allStudents.forEach(data => {
            const kelas = (data.class || '').trim();
            const isAlumni = data.is_alumni === true;
            const isKeluar = data.status === 'keluar' || data.is_active === false;

            // Filter ketat: Hanya kelas yang diawali tingkat X, XI, atau XII dan bukan Alumni/Keluar/Lulus
            if (kelas && !isAlumni && !isKeluar) {
                const upper = kelas.toUpperCase();
                if (!upper.startsWith('ALUMNI') && !upper.startsWith('KELUAR') && !upper.startsWith('LULUS') && !upper.startsWith('DROP')) {
                    kelasSet.add(kelas);
                }
            }
        });

        allKelasListSettings = Array.from(kelasSet).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    } catch (e) {
        console.error('[ERapor] Gagal memuat daftar kelas:', e);
    }
}

// Buka Modal Tambah Guru
window.openAddGuruModal = async (mapel) => {
    selectedMapelForGuru = mapel;

    const modal = document.getElementById('modal-pilih-guru');
    const mapelEl = document.getElementById('modal-mapel-name');
    const select = document.getElementById('select-guru-pengampu');
    const checklistContainer = document.getElementById('checklist-kelas');

    if (!modal) return;

    mapelEl.innerHTML = `Mapel: <b>${escapeHtml(mapel)}</b>`;

    await loadAllKelasForSettings();
    await loadAllUsersCache();

    const guruMap = raporConfig.mapel_guru || {};
    const currentGurus = guruMap[mapel] || [];
    const usedKelas = new Set();
    currentGurus.forEach(g => {
        const guru = typeof g === 'string' ? { uid: g, kelas: [] } : g;
        if (guru.kelas && guru.kelas.length > 0) {
            guru.kelas.forEach(k => usedKelas.add(k));
        }
    });

    const availableKelas = allKelasListSettings.filter(k => !usedKelas.has(k));

    if (availableKelas.length === 0) {
        checklistContainer.innerHTML = '<p class="col-span-2 text-center text-slate-400 text-xs py-2">Semua kelas sudah ditugaskan ke guru lain</p>';
    } else {
        checklistContainer.innerHTML = availableKelas.map(kelas => `
            <label class="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer p-1 hover:bg-white dark:hover:bg-slate-700 rounded">
                <input type="checkbox" value="${escapeHtml(kelas)}" class="kelas-checkbox accent-indigo-600 w-3.5 h-3.5">
                <span>${escapeHtml(kelas)}</span>
            </label>
        `).join('');
    }

    const currentUids = currentGurus.map(g => typeof g === 'string' ? g : g.uid);
    const availableUsers = allUsersCache.filter(u => !currentUids.includes(u.uid));
    window._availableUsersForModal = availableUsers;

    if (availableUsers.length === 0) {
        select.innerHTML = '<option value="">-- Semua guru sudah terdaftar --</option>';
    } else {
        select.innerHTML = availableUsers.map(u => `<option value="${u.uid}">${escapeHtml(u.name)} (${u.role})</option>`).join('');
    }

    const searchInput = document.getElementById('search-guru-pengampu');
    if (searchInput) searchInput.value = '';

    modal.classList.remove('hidden');

    setTimeout(() => {
        document.addEventListener('click', window.hideGuruDropdownOnClickOutside);
    }, 100);
};

// Tampilkan Dropdown Melayang
window.showGuruDropdown = () => {
    const dropdown = document.getElementById('guru-dropdown-list');
    if (dropdown) {
        dropdown.classList.remove('hidden');
        window.filterGuruDropdown('');
    }
};

// Sembunyikan Dropdown saat klik di luar
window.hideGuruDropdownOnClickOutside = (e) => {
    const dropdown = document.getElementById('guru-dropdown-list');
    const input = document.getElementById('search-guru-pengampu');
    if (dropdown && input && !dropdown.contains(e.target) && e.target !== input) {
        dropdown.classList.add('hidden');
    }
};

// Pilih Guru dari Dropdown
window.selectGuru = (uid, name) => {
    const input = document.getElementById('search-guru-pengampu');
    const hiddenInput = document.getElementById('select-guru-pengampu');
    const dropdown = document.getElementById('guru-dropdown-list');

    if (input) input.value = name;
    if (hiddenInput) hiddenInput.value = uid;
    if (dropdown) dropdown.classList.add('hidden');
};

// Tutup Modal Tambah Guru
window.closeGuruModal = () => {
    const modal = document.getElementById('modal-pilih-guru');
    if (modal) modal.classList.add('hidden');
    document.removeEventListener('click', window.hideGuruDropdownOnClickOutside);
};

// Filter Guru Dropdown
window.filterGuruDropdown = (keyword) => {
    const dropdown = document.getElementById('guru-dropdown-list');
    if (!dropdown) return;

    const allUsers = window._availableUsersForModal || [];
    const kw = keyword.toLowerCase().trim();

    const filtered = kw
        ? allUsers.filter(u => u.name.toLowerCase().includes(kw) || u.email?.toLowerCase().includes(kw))
        : allUsers;

    if (filtered.length === 0) {
        dropdown.innerHTML = '<div class="p-3 text-center text-slate-400 text-xs"><i class="fa-solid fa-user-slash mr-1"></i> Tidak ditemukan</div>';
    } else {
        dropdown.innerHTML = filtered.map(u => {
            const safeName = escapeHtml(u.name).replace(/'/g, "\\'")
            return `
            <div onclick="window.selectGuru('${u.uid}', '${safeName}')"
                class="px-3 py-2.5 hover:bg-emerald-50 dark:hover:bg-slate-700 cursor-pointer border-b border-slate-100 dark:border-slate-700 last:border-0 transition-colors flex items-center gap-2">
                <div class="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-300 flex items-center justify-center text-xs font-bold">
                    ${escapeHtml(u.name.charAt(0).toUpperCase())}
                </div>
                <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">${escapeHtml(u.name)}</p>
                    <p class="text-[10px] text-slate-400">${escapeHtml(u.role || '-')}</p>
                </div>
            </div>
        `}).join('');
    }

    dropdown.classList.remove('hidden');
};

// Toggle Semua Kelas
window.toggleAllKelas = () => {
    const checkboxes = document.querySelectorAll('#checklist-kelas .kelas-checkbox');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    checkboxes.forEach(cb => cb.checked = !allChecked);
};

// Konfirmasi Tambah Guru
window.confirmAddGuruPengampu = async () => {
    const select = document.getElementById('select-guru-pengampu');
    const uid = select ? select.value : '';
    const mapel = selectedMapelForGuru;

    const checkboxes = document.querySelectorAll('#checklist-kelas .kelas-checkbox:checked');
    const selectedKelas = Array.from(checkboxes).map(cb => cb.value);

    if (!uid || !mapel) {
        showModernAlert('Peringatan', 'Pilih guru terlebih dahulu!', 'error');
        return;
    }

    if (selectedKelas.length === 0) {
        showModernAlert('Peringatan', 'Pilih minimal satu kelas yang diampu!', 'error');
        return;
    }

    try {
        const guruMap = { ...(raporConfig.mapel_guru || {}) };
        if (!guruMap[mapel]) guruMap[mapel] = [];

        guruMap[mapel].push({
            uid: uid,
            kelas: selectedKelas
        });

        await saveRaporConfig({
            mapel_guru: guruMap
        });

        renderUnifiedMapelList();
        renderGuruListInModal(mapel);
        document.getElementById('modal-pilih-guru').classList.add('hidden');
        showModernAlert('Berhasil', `Guru berhasil ditambahkan.`, 'success');

    } catch (e) {
        console.error('[E-Rapor] Error adding guru mapel:', e);
        showModernAlert('Error', 'Gagal update guru pengampu: ' + e.message, 'error');
    }
};

// Hapus Guru dari Mapel
window.removeGuruFromMapel = async (mapel, uid) => {
    const confirmed = typeof window.showConfirmModal === 'function'
        ? await window.showConfirmModal(`Hapus guru ini dari pengampu mapel "${mapel}"?`, 'Hapus Pengampu Mapel', 'danger')
        : true;
    if (!confirmed) return;

    try {
        const guruMap = { ...(raporConfig.mapel_guru || {}) };
        if (guruMap[mapel]) {
            guruMap[mapel] = guruMap[mapel].filter(g => {
                if (typeof g === 'string') return g !== uid;
                return g.uid !== uid;
            });

            await saveRaporConfig({
                mapel_guru: guruMap
            });

            renderUnifiedMapelList();
            showModernAlert('Berhasil', 'Guru pengampu dihapus.', 'success');
        }
    } catch (e) {
        console.error('[E-Rapor] Error removing guru mapel:', e);
        showModernAlert('Error', 'Gagal hapus guru: ' + e.message, 'error');
    }
};

// === MODAL PENGATURAN MAPEL ===

// Buka Modal Pengaturan Mapel
window.openMapelSettings = async function (mapel) {
    currentSettingsMapel = mapel;

    await loadAllUsersCache();
    await loadAllKelasForSettings();

    const modal = document.getElementById('modal-mapel-settings');
    const mapelNameEl = document.getElementById('modal-settings-mapel-name');
    const togglePraktik = document.getElementById('modal-toggle-praktik');

    if (!modal) return;

    mapelNameEl.textContent = mapel;

    const isPraktik = (raporConfig.mapel_praktik_flags || {})[mapel] === true;
    if (togglePraktik) togglePraktik.checked = isPraktik;

    if (togglePraktik) {
        togglePraktik.onchange = async function () {
            await window.togglePraktikStatus(mapel, this.checked);
        };
    }

    renderGuruListInModal(mapel);
    modal.classList.remove('hidden');
};

// Render Daftar Guru di Modal Settings
function renderGuruListInModal(mapel) {
    const container = document.getElementById('modal-guru-list');
    const guruMap = raporConfig.mapel_guru || {};
    const guruList = guruMap[mapel] || [];

    if (!container) return;

    if (guruList.length === 0) {
        container.innerHTML = '<div class="text-center text-slate-400 text-sm py-4 bg-slate-50 dark:bg-slate-800 rounded-lg border border-dashed border-slate-200 dark:border-slate-700">Belum ada guru pengampu</div>';
        return;
    }

    container.innerHTML = guruList.map((g, idx) => {
        const guru = typeof g === 'string' ? { uid: g, kelas: [] } : g;
        const name = getUserNameByUid(guru.uid);
        const kelasList = guru.kelas && guru.kelas.length > 0 ? guru.kelas.join(', ') : 'Semua Kelas';

        return `
            <div class="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-indigo-300 transition-all">
                <div class="flex-1 min-w-0">
                    <div class="font-bold text-slate-700 dark:text-slate-200 text-sm truncate">${escapeHtml(name)}</div>
                    <div class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        <i class="fa-solid fa-school text-indigo-400 mr-1"></i>
                        <span class="truncate">${escapeHtml(kelasList)}</span>
                    </div>
                </div>
                <div class="flex items-center gap-1 ml-2">
                    <button onclick="window.editGuruKelas('${escapeHtml(mapel)}', '${guru.uid}')" 
                        class="p-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/40 rounded-lg transition-all" title="Edit Kelas">
                        <i class="fa-solid fa-edit text-sm"></i>
                    </button>
                    <button onclick="window.removeGuruFromModalSettings('${escapeHtml(mapel)}', '${guru.uid}')" 
                        class="p-2 text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/40 rounded-lg transition-all" title="Hapus">
                        <i class="fa-solid fa-trash text-sm"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// Tambah Guru dari Modal Settings
window.openAddGuruFromSettings = function () {
    window.openAddGuruModal(currentSettingsMapel);
};

// Hapus Guru dari Modal Settings (dan refresh modal)
window.removeGuruFromModalSettings = async function (mapel, uid) {
    await window.removeGuruFromMapel(mapel, uid);
    renderGuruListInModal(mapel);
};

// Edit Guru dan Kelas
window.editGuruKelas = async function (mapel, uid) {
    await loadAllKelasForSettings();
    await loadAllUsersCache();

    const guruMap = raporConfig.mapel_guru || {};
    const guruList = guruMap[mapel] || [];
    const guruData = guruList.find(g => (typeof g === 'string' ? g : g.uid) === uid);
    const currentKelas = guruData && typeof guruData === 'object' ? (guruData.kelas || []) : [];
    const currentGuruName = getUserNameByUid(uid);

    const modalHtml = `
        <div id="modal-edit-kelas" class="fixed inset-0 z-[140] bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm fade-in">
            <div class="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
                <div class="p-5">
                    <div class="flex items-center gap-3 mb-4 text-amber-600 dark:text-amber-400">
                        <i class="fa-solid fa-edit text-xl"></i>
                        <div>
                            <h3 class="font-bold text-base dark:text-slate-100">Edit Guru & Kelas</h3>
                            <p class="text-xs text-slate-500 dark:text-slate-400">${escapeHtml(mapel)}</p>
                        </div>
                    </div>
                    
                    <!-- Pilih Guru (Searchable Dropdown) -->
                    <div class="mb-4 relative">
                        <label class="text-xs font-bold text-slate-500 dark:text-slate-400 block mb-1">Guru Pengampu</label>
                        <div class="relative">
                            <input type="text" id="edit-search-guru-pengampu" value="${escapeHtml(currentGuruName)}" placeholder="Ketik nama guru..."
                                oninput="window.filterEditGuruDropdown(this.value)" onclick="window.showEditGuruDropdown()"
                                autocomplete="off"
                                class="w-full p-2.5 pr-8 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 outline-none">
                            <i class="fa-solid fa-chevron-down absolute right-3 top-3.5 text-xs text-slate-400 pointer-events-none"></i>
                        </div>
                        <input type="hidden" id="edit-guru-select" value="${uid}">
                        
                        <!-- Dropdown List Melayang -->
                        <div id="edit-guru-dropdown-list"
                            class="hidden absolute left-0 right-0 top-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl max-h-72 overflow-y-auto z-[150]">
                        </div>
                    </div>
                    
                    <!-- Pilih Kelas -->
                    <div class="mb-4">
                        <div class="flex items-center justify-between mb-2">
                            <label class="text-xs font-bold text-slate-500 dark:text-slate-400">Kelas yang Diampu</label>
                            <div class="flex gap-1">
                                <button type="button" onclick="window.selectKelasByLevel('X')"
                                    class="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700 px-2 py-1 bg-blue-50 dark:bg-blue-950/50 rounded-lg">X</button>
                                <button type="button" onclick="window.selectKelasByLevel('XI')"
                                    class="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 px-2 py-1 bg-emerald-50 dark:bg-emerald-950/50 rounded-lg">XI</button>
                                <button type="button" onclick="window.selectKelasByLevel('XII')"
                                    class="text-[10px] font-bold text-purple-600 dark:text-purple-400 hover:text-purple-700 px-2 py-1 bg-purple-50 dark:bg-purple-950/50 rounded-lg">XII</button>
                            </div>
                        </div>
                        <div id="edit-kelas-checklist" class="grid grid-cols-3 gap-1 max-h-48 overflow-y-auto p-2 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                            ${allKelasListSettings.map(kelas => `
                                <label class="flex items-center gap-1 text-[11px] text-slate-700 dark:text-slate-300 cursor-pointer p-1 hover:bg-white dark:hover:bg-slate-700 rounded">
                                    <input type="checkbox" value="${escapeHtml(kelas)}" class="edit-kelas-cb accent-amber-600 w-3 h-3" 
                                        ${currentKelas.includes(kelas) ? 'checked' : ''}>
                                    <span class="truncate">${escapeHtml(kelas)}</span>
                                </label>
                            `).join('')}
                        </div>
                        <p class="text-[10px] text-slate-400 mt-1"><i class="fa-solid fa-info-circle mr-1"></i>Kosongkan untuk semua kelas</p>
                    </div>
                    
                    <div class="flex gap-2 justify-end">
                        <button onclick="window.closeEditGuruModal()" 
                            class="px-3 py-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm">Batal</button>
                        <button onclick="window.saveGuruKelasEdit('${escapeHtml(mapel)}', '${uid}')" 
                            class="px-4 py-2 rounded-lg font-bold text-white bg-amber-600 hover:bg-amber-700 text-sm">
                            <i class="fa-solid fa-save mr-1"></i>Simpan
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    setTimeout(() => {
        document.addEventListener('click', window.hideEditGuruDropdownOnClickOutside);
    }, 100);
};

// Helper Dropdown Search untuk Edit Modal
window.showEditGuruDropdown = () => {
    const dropdown = document.getElementById('edit-guru-dropdown-list');
    if (dropdown) {
        dropdown.classList.remove('hidden');
        window.filterEditGuruDropdown('');
    }
};

window.hideEditGuruDropdownOnClickOutside = (e) => {
    const dropdown = document.getElementById('edit-guru-dropdown-list');
    const input = document.getElementById('edit-search-guru-pengampu');
    if (dropdown && input && !dropdown.contains(e.target) && e.target !== input) {
        dropdown.classList.add('hidden');
    }
};

window.selectEditGuru = (uid, name) => {
    const input = document.getElementById('edit-search-guru-pengampu');
    const hiddenInput = document.getElementById('edit-guru-select');
    const dropdown = document.getElementById('edit-guru-dropdown-list');

    if (input) input.value = name;
    if (hiddenInput) hiddenInput.value = uid;
    if (dropdown) dropdown.classList.add('hidden');
};

window.filterEditGuruDropdown = (keyword) => {
    const dropdown = document.getElementById('edit-guru-dropdown-list');
    if (!dropdown) return;

    const kw = keyword.toLowerCase().trim();
    const filtered = kw
        ? allUsersCache.filter(u => u.name.toLowerCase().includes(kw) || u.email?.toLowerCase().includes(kw))
        : allUsersCache;

    if (filtered.length === 0) {
        dropdown.innerHTML = '<div class="p-3 text-center text-slate-400 text-xs"><i class="fa-solid fa-user-slash mr-1"></i> Tidak ditemukan</div>';
    } else {
        dropdown.innerHTML = filtered.map(u => {
            const safeName = escapeHtml(u.name).replace(/'/g, "\\'");
            return `
            <div onclick="window.selectEditGuru('${u.uid}', '${safeName}')"
                class="px-3 py-2 bg-white dark:bg-slate-800 hover:bg-amber-50 dark:hover:bg-slate-700 cursor-pointer border-b border-slate-100 dark:border-slate-700 last:border-0 transition-colors flex items-center gap-2">
                <div class="w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-300 flex items-center justify-center text-[10px] font-bold">
                    ${escapeHtml(u.name.charAt(0).toUpperCase())}
                </div>
                <div class="flex-1 min-w-0">
                    <p class="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">${escapeHtml(u.name)}</p>
                </div>
            </div>
        `}).join('');
    }

    dropdown.classList.remove('hidden');
};

window.closeEditGuruModal = () => {
    document.getElementById('modal-edit-kelas')?.remove();
    document.removeEventListener('click', window.hideEditGuruDropdownOnClickOutside);
};

// Toggle kelas berdasarkan tingkat (X, XI, XII)
window.selectKelasByLevel = function (level) {
    const checkboxes = document.querySelectorAll('.edit-kelas-cb');
    checkboxes.forEach(cb => {
        const kelas = cb.value;
        if (level === 'X') {
            if (kelas.startsWith('X ') || kelas.match(/^X[^I]/i) || kelas === 'X') {
                cb.checked = !cb.checked;
            }
        } else if (level === 'XI') {
            if (kelas.startsWith('XI ') || kelas.match(/^XI[^I]/i) || kelas === 'XI') {
                cb.checked = !cb.checked;
            }
        } else if (level === 'XII') {
            if (kelas.startsWith('XII')) {
                cb.checked = !cb.checked;
            }
        }
    });
};

// Simpan Perubahan Kelas Guru
window.saveGuruKelasEdit = async function (mapel, uid) {
    const checkboxes = document.querySelectorAll('.edit-kelas-cb:checked');
    const selectedKelas = Array.from(checkboxes).map(cb => cb.value);

    try {
        const guruMap = { ...(raporConfig.mapel_guru || {}) };
        const guruList = guruMap[mapel] || [];
        const idx = guruList.findIndex(g => (typeof g === 'string' ? g : g.uid) === uid);

        const newUid = document.getElementById('edit-guru-select')?.value || uid;

        if (idx !== -1) {
            guruList[idx] = { uid: newUid, kelas: selectedKelas };
            guruMap[mapel] = guruList;

            await saveRaporConfig({
                mapel_guru: guruMap
            });

            showModernAlert('Berhasil', 'Data guru berhasil diperbarui.', 'success');
            renderGuruListInModal(mapel);
            renderUnifiedMapelList();
        }

        window.closeEditGuruModal();
    } catch (e) {
        console.error('[E-Rapor] Error saving guru kelas:', e);
        showModernAlert('Error', 'Gagal menyimpan: ' + e.message, 'error');
    }
};

// === ASC TIMETABLES XML SCHEDULE & TEACHER MAPPING HANDLERS ===
let currentMappingFilterStatus = 'all';
let currentMappingSearchQuery = '';
let cachedXMLTeachers = [];

async function renderXMLScheduleStatus() {
    try {
        const masterEl = document.getElementById('xml-status-master');
        const lessonsEl = document.getElementById('xml-status-lessons');
        const matchingEl = document.getElementById('xml-status-matching');
        const badgeUnmatched = document.getElementById('badge-unmatched-count');

        if (!masterEl) return;

        masterEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i>Memuat...`;

        const data = await parseASCSchedule();
        if (!data) {
            masterEl.className = "font-bold text-rose-600 dark:text-rose-400";
            masterEl.textContent = "Gagal Membaca File XML";
            return;
        }

        masterEl.className = "font-bold text-emerald-600 dark:text-emerald-400";
        masterEl.innerHTML = `<i class="fa-solid fa-check-circle mr-1"></i>Aktif & Valid`;

        const fileEl = document.getElementById('xml-status-file');
        const srcInfo = getASCScheduleSourceInfo();
        if (fileEl) {
            fileEl.textContent = srcInfo.fileName + (srcInfo.isCustomUploaded ? ' (Diunggah)' : ' (Default)');
        }

        if (lessonsEl) lessonsEl.textContent = `${data.totalLessons} Pelajaran`;

        const allTeachers = Array.from(data.teachersMap.values());
        const matchedCount = allTeachers.filter(t => t.isMatched).length;
        const totalTeachers = allTeachers.length;
        const unmatchedCount = data.unmatchedTeachersList.length;

        if (matchingEl) {
            matchingEl.innerHTML = `<span class="${unmatchedCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}">${matchedCount} / ${totalTeachers} Terhubung</span>`;
        }

        if (badgeUnmatched) {
            if (unmatchedCount > 0) {
                badgeUnmatched.textContent = unmatchedCount;
                badgeUnmatched.classList.remove('hidden');
            } else {
                badgeUnmatched.classList.add('hidden');
            }
        }
    } catch (e) {
        console.error('[E-Rapor] Gagal memuat status XML:', e);
    }
}

// === UPLOAD HANDLER BERSAMA UNTUK WAKASEK KURIKULUM ===
window.handleUploadASCScheduleXML = async function (inputEl) {
    const file = inputEl.files ? inputEl.files[0] : null;
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.xml')) {
        showModernAlert('Format Salah', 'Harap pilih berkas dengan ekstensi .xml hasil ekspor dari aSc Timetables.', 'error');
        inputEl.value = '';
        return;
    }

    try {
        showToast('Memproses Upload', `Membaca berkas ${file.name}...`, 'info');
        const reader = new FileReader();
        reader.onload = async function (e) {
            const xmlText = e.target.result;

            // Validasi sintaks XML
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, "text/xml");
            const parseError = xmlDoc.querySelector("parsererror");

            if (parseError || !xmlDoc.querySelector("timetable") || !xmlDoc.querySelector("lessons")) {
                showModernAlert('File XML Tidak Valid', 'Berkas XML yang diunggah tidak memiliki struktur data aSc Timetables yang valid.', 'error');
                inputEl.value = '';
                return;
            }

            // Simpan XML ke Firestore & LocalStorage
            const success = await saveUploadedASCScheduleXML(xmlText, file.name);
            inputEl.value = '';

            if (success) {
                await window.syncASCScheduleXML();
            } else {
                showModernAlert('Gagal', 'Gagal menyimpan berkas XML ke database pusat.', 'error');
            }
        };

        reader.readAsText(file);
    } catch (err) {
        console.error('[E-Rapor] Error uploading XML schedule:', err);
        showModernAlert('Error', 'Gagal membaca berkas XML: ' + err.message, 'error');
        inputEl.value = '';
    }
};

// === MASTER SYNC BERSAMA (PARSER JADWAL & MASTER MAPEL ROMBEL GURU) ===
window.syncASCScheduleXML = async function () {
    try {
        showToast('Processing 🪄', 'Memproses sinkronisasi jadwal master XML & daftar mapel guru...', 'info');

        // 1. Parse XML Schedule
        const data = await parseASCSchedule();
        if (!data) {
            showModernAlert('Gagal', 'Berkas XML jadwal tidak valid atau gagal dibaca.', 'error');
            return;
        }

        await renderXMLScheduleStatus();

        // 2. Sync Mapel & Rombel Guru dari XML
        const xmlSubjects = await getSubjectsWithLessonsFromXML();
        if (!xmlSubjects || xmlSubjects.length === 0) {
            showModernAlert('Gagal', 'Gagal membaca daftar mapel dari berkas XML.', 'error');
            return;
        }

        const mapelList = [];
        const mapelGuru = {};
        const mapelShortCodes = {};

        xmlSubjects.forEach(sub => {
            const mName = sub.name;
            mapelList.push(mName);
            if (sub.short) {
                mapelShortCodes[mName] = sub.short;
            }

            if (sub.guruList && sub.guruList.length > 0) {
                const mappedList = sub.guruList.map(g => ({
                    uid: g.uid,
                    name: g.name || getUserNameByUid(g.uid),
                    kelas: g.kelas || []
                }));

                if (mappedList.length > 0) {
                    mapelGuru[mName] = mappedList;
                }
            }
        });

        // Update state local & simpan via saveRaporConfig (otomatis sanitize & deleteField orphan keys)
        raporConfig.mapel_list = mapelList;
        raporConfig.mapel_guru = mapelGuru;
        raporConfig.mapel_short_codes = mapelShortCodes;
        raporConfig.mapel_xml_source = true;
        raporConfig.updated_at = serverTimestamp();

        await saveRaporConfig({
            mapel_list: mapelList,
            mapel_guru: mapelGuru,
            mapel_short_codes: mapelShortCodes,
            mapel_xml_source: true,
            updated_at: serverTimestamp()
        });

        localStorage.setItem('simas_rapor_config', JSON.stringify(raporConfig));

        await renderUnifiedMapelList();

        showModernAlert(
            'Sinkronisasi Master XML Berhasil 🪄',
            `Sistem berhasil memparse <b>${data.totalLessons}</b> slot pelajaran, menyinkronkan <b>${mapelList.length}</b> Mata Pelajaran & Rombel Guru Pengampu ke seluruh sistem terpusat!`,
            'success'
        );
    } catch (e) {
        console.error('[E-Rapor] Error sync XML master:', e);
        showModernAlert('Error', 'Gagal memproses sinkronisasi XML: ' + e.message, 'error');
    }
};

window.syncMapelFromASCScheduleXML = window.syncASCScheduleXML;


window.openTeacherMappingModal = async function () {
    const modal = document.getElementById('modal-mapping-guru');
    if (!modal) return;

    modal.classList.remove('hidden');
    cachedXMLTeachers = await getAllXMLTeachersWithStatus();
    await renderMappingTable();
};

async function renderMappingTable() {
    const tbody = document.getElementById('mapping-table-body');
    if (!tbody) return;

    let filtered = [...cachedXMLTeachers];

    // Filter status
    if (currentMappingFilterStatus === 'unmatched') {
        filtered = filtered.filter(t => !t.isMatched);
    }

    // Filter search query
    if (currentMappingSearchQuery) {
        const q = currentMappingSearchQuery.toLowerCase();
        filtered = filtered.filter(t => t.name.toLowerCase().includes(q) || (t.short && t.short.toLowerCase().includes(q)));
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center py-8 text-slate-400">
                    <i class="fa-solid fa-circle-check text-green-500 text-xl mb-1 block"></i>
                    Semua guru sudah terhubung atau tidak ditemukan pencocokan.
                </td>
            </tr>
        `;
        return;
    }

    let simasTeachers = [];
    if (window.getTeachersCache) {
        simasTeachers = await window.getTeachersCache();
    }
    if (!Array.isArray(simasTeachers)) simasTeachers = [];

    let bkTeachersForMapping = [];
    if (typeof window.getBkTeachersCache === 'function') {
        bkTeachersForMapping = await window.getBkTeachersCache();
    }
    if (!Array.isArray(bkTeachersForMapping)) bkTeachersForMapping = [];

    const existingTeacherIds = new Set(simasTeachers.map(st => st.id));
    const extraBkTeachers = bkTeachersForMapping.filter(bk => !existingTeacherIds.has(bk.id));

    const fullTeacherList = [
        ...simasTeachers,
        ...extraBkTeachers
    ];

    tbody.innerHTML = filtered.map((t, idx) => {
        const options = fullTeacherList.map(st => `
            <option value="${st.id}" ${t.simasId === st.id ? 'selected' : ''}>
                ${st.name} ${st.nip ? `(${st.nip})` : ''}
            </option>
        `).join('');


        const statusBadge = t.isMatched
            ? `<span class="bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded font-bold text-[10px]">Terhubung</span>`
            : `<span class="bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded font-bold text-[10px]">Perlu Link</span>`;

        return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                <td class="px-4 py-2.5 text-center text-slate-400 font-mono">${idx + 1}</td>
                <td class="px-4 py-2.5 font-bold text-slate-800 dark:text-slate-200">
                    ${t.name}
                </td>
                <td class="px-4 py-2.5 text-center font-mono text-slate-500">${t.short || '-'}</td>
                <td class="px-4 py-2.5">
                    <select data-xml-id="${t.id}" class="mapping-select-guru w-full p-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-xs dark:bg-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500">
                        <option value="">-- Pilih Guru SIMAS SSOT --</option>
                        ${options}
                    </select>
                </td>
                <td class="px-4 py-2.5 text-center">${statusBadge}</td>
            </tr>
        `;
    }).join('');
}

window.filterMappingTable = async function (query) {
    currentMappingSearchQuery = query.trim();
    await renderMappingTable();
};

window.filterMappingByStatus = async function (status) {
    currentMappingFilterStatus = status;
    const btnAll = document.getElementById('btn-filter-map-all');
    const btnUnmatched = document.getElementById('btn-filter-map-unmatched');

    if (status === 'all') {
        if (btnAll) btnAll.className = "px-2.5 py-1 text-xs font-bold rounded-lg bg-indigo-600 text-white";
        if (btnUnmatched) btnUnmatched.className = "px-2.5 py-1 text-xs font-bold rounded-lg bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300";
    } else {
        if (btnUnmatched) btnUnmatched.className = "px-2.5 py-1 text-xs font-bold rounded-lg bg-indigo-600 text-white";
        if (btnAll) btnAll.className = "px-2.5 py-1 text-xs font-bold rounded-lg bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300";
    }

    await renderMappingTable();
};


window.saveTeacherMappingFromModal = async function () {
    try {
        const selects = document.querySelectorAll('.mapping-select-guru');
        const mappingObj = {};

        selects.forEach(sel => {
            const xmlId = sel.getAttribute('data-xml-id');
            const simasId = sel.value;
            if (xmlId && simasId) {
                mappingObj[xmlId] = simasId;
            }
        });

        const success = await saveCustomTeacherMapping(mappingObj);
        if (success) {
            showModernAlert('Pemetaan Berhasil Disimpan', 'Tabel pemetaan guru XML ↔ SIMAS telah diperbarui secara permanen.', 'success');
            document.getElementById('modal-mapping-guru')?.classList.add('hidden');
            await renderXMLScheduleStatus();
        } else {
            showModernAlert('Gagal', 'Gagal menyimpan pemetaan guru.', 'error');
        }
    } catch (e) {
        console.error('[E-Rapor] Error saving teacher mapping:', e);
        showModernAlert('Error', 'Gagal menyimpan mapping: ' + e.message, 'error');
    }
};

// === SINKRONISASI DAFTAR MAPEL & GURU PENGAMPU DARI ASC SCHEDULE XML ===
window.syncMapelFromASCScheduleXML = function () {
    return window.syncASCScheduleXML();
};



/* js/page-e-lab.js - E-Laboratorium Booking System via Cloudflare D1 (0 Lab Firestore RW) */
import { auth, db, PATHS, resolvePhotoUrl } from './config.js';
import { SCHOOL_CONFIG } from './school-config.js';
import { cfClient } from './cloudflare-client.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
    collection, doc, getDoc, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { initLayout } from './global.js';
import { getScheduleForClassAndDate } from './asc-schedule-parser.js';

// ============== KONFIGURASI JAM PELAJARAN ==============
const JAM_PELAJARAN = [
    { jp: 1, mulai: '07:30', selesai: '08:15' },
    { jp: 2, mulai: '08:15', selesai: '09:00' },
    { jp: 3, mulai: '09:00', selesai: '09:45' },
    // Istirahat 1: 09:45 - 10:00
    { jp: 4, mulai: '10:00', selesai: '10:45' },
    { jp: 5, mulai: '10:45', selesai: '11:30' },
    { jp: 6, mulai: '11:30', selesai: '12:15' },
    // Istirahat 2: 12:15 - 12:30
    { jp: 7, mulai: '12:30', selesai: '13:15' },
    { jp: 8, mulai: '13:15', selesai: '14:00' },
    { jp: 9, mulai: '14:00', selesai: '14:45' },
    { jp: 10, mulai: '14:45', selesai: '15:30' }
];

const HARI = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];

// ============== STATE ==============
let currentUser = null;
let currentRole = null;
let labsList = [];
let labsAccessVerified = false;
let labsLoadPromise = null;
let labsLoadUid = null;
let labPageReady = false;
let lastLabAccessRefreshAt = 0;
let weeklyBookings = [];
let isKepalaLab = false;
let allKepalaLabAccounts = []; // Array of { uid, nama, email, phone, nip }
let kepalaLabList = []; // Array of { uid, nama, phone } untuk follow-up WA
let teacherUsersList = []; // Array of { uid, name, email, role, phone, linkedTeacherId } untuk pilihan Koordinator Lab

// Filter & View State
let filterLab = '';
let filterStatus = '';
let isMobileListView = false;

// Smart Booking State: untuk fitur klik 2 slot
let smartBookingSelection = null; // { dateStr, jp }

// ============== INIT ==============
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = 'index.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
        return;
    }
    currentUser = user;
    labsAccessVerified = false;
    labPageReady = false;

    // 1. Ambil dokumen pengguna dari cache / Firestore untuk menjamin otorisasi SSOT akurat
    let userDoc = null;
    try {
        if (typeof window.getCurrentUserDoc === 'function') {
            userDoc = await window.getCurrentUserDoc();
        }
    } catch (e) {
        console.warn('[E-Lab] Gagal memuat user doc:', e);
    }

    // 2. Sinkronkan role utama & additional roles secara atomik (membersihkan stale role akun lama)
    if (userDoc) {
        currentRole = userDoc.role || 'guru_mapel';
        localStorage.setItem('user_role', currentRole);
        const additionalRoles = Array.isArray(userDoc.additionalRoles) ? userDoc.additionalRoles : [];
        localStorage.setItem('user_additional_roles', JSON.stringify(additionalRoles));
    } else {
        currentRole = localStorage.getItem('user_role') || 'guru_mapel';
    }

    // MULTI-ROLE: Ambil role tertinggi untuk halaman ini
    const effectiveRole = window.getEffectiveRoleForPage ?
        window.getEffectiveRoleForPage('e-lab.html') : currentRole;

    // Init Layout segera (UI muncul cepat)
    initLayout(effectiveRole); // Gunakan role tertinggi

    // Show Content IMMEDIATELY (Render HTML dulu, data menyusul)
    document.querySelector('main').classList.remove('hidden');

    // Show Loading Indicator
    const loadingEl = document.getElementById('loading-indicator');
    if (loadingEl) loadingEl.classList.remove('hidden');

    // === BATCH 1: Query data master lab & status Kepala Lab (PARALLEL) ===
    await Promise.all([
        checkKepalaLabStatus(userDoc),
        loadLabs()
    ]);

    // Populate filter dropdown dengan daftar lab (sync, no DB)
    populateFilterLabOptions();

    // Populate JP Dropdowns (sync, no DB)
    populateJPDropdowns();

    // Set default week (sync, no DB)
    setCurrentWeek();
    setCurrentRiwayatWeek();

    // Set default booking lab jika ada
    if (labsList.length > 0) {
        document.getElementById('booking-lab').value = labsList[0].id;
    }

    // Inisialisasi preferensi tampilan jadwal: default tabel matriks kalender di semua perangkat (HP & PC)
    try {
        const savedViewPref = sessionStorage.getItem('simas_elab_view_pref');
        if (savedViewPref === 'list') {
            isMobileListView = true;
        } else {
            isMobileListView = false;
        }
    } catch (e) {
        isMobileListView = false;
    }
    updateScheduleViewVisibility();

    // === BATCH 2: Query jadwal dan class PARALLEL ===
    const parallelTasks = [
        loadWeeklySchedule(),
        loadMyBookingHistory(),
        loadClassList()
    ];

    // Terapkan akses setelah role dan penugasan lab selesai dimuat.
    syncLabAccessUI();
    if (isKepalaLab || isLabAdminUser() || isUserCoordinatorForAnyLab()) {
        parallelTasks.push(loadPendingBookings());
    }

    await Promise.all(parallelTasks);

    // Populate Filter Dropdowns (sync, no DB)
    populateLabFilters();
    labPageReady = true;

    // Hide Loading Indicator
    if (loadingEl) loadingEl.classList.add('hidden');
});

// ============== HELPER OTORISASI & KOORDINATOR LAB ==============
function isLabAdminUser() {
    if (currentRole === 'super_admin' || currentRole === 'admin') return true;
    try {
        const additional = JSON.parse(localStorage.getItem('user_additional_roles') || '[]');
        return Array.isArray(additional) && (additional.includes('super_admin') || additional.includes('admin'));
    } catch (e) {
        return false;
    }
}

function isUserCoordinatorForLab(labId) {
    if (!labsAccessVerified || !labId || !currentUser?.uid) return false;
    const lab = labsList.find(l => l.id === labId);
    return Boolean(lab && lab.koordinator_uid && lab.koordinator_uid === currentUser.uid);
}

function isUserCoordinatorForAnyLab() {
    if (!labsAccessVerified || !currentUser?.uid) return false;
    return labsList.some(l => Boolean(l.koordinator_uid && l.koordinator_uid === currentUser.uid));
}

function canUserManageLab(labId) {
    if (isLabAdminUser()) return true;
    // 1. Kepala Laboratorium global berhak mengelola seluruh lab (penugasan koordinator tidak membatasi Kepala Lab)
    if (isKepalaLab) return true;
    // 2. Koordinator Lab berhak mengelola inventaris HANYA untuk lab tugasnya
    if (labId && isUserCoordinatorForLab(labId)) return true;
    return false;
}

function getAccessibleLabsForWrite() {
    if (isLabAdminUser() || isKepalaLab) return [...labsList];
    if (!labsAccessVerified || !currentUser?.uid) return [];
    return labsList.filter(l => Boolean(l.koordinator_uid && l.koordinator_uid === currentUser.uid));
}

function syncLabAccessUI() {
    const fullAccess = isKepalaLab || isLabAdminUser();
    const canApprove = fullAccess || isUserCoordinatorForAnyLab();
    const visibility = {
        'btn-tab-approval': canApprove,
        'btn-tab-pengaturan': fullAccess,
        'riwayat-filter-owner-container': canApprove,
        'btn-booking-export-excel': canApprove
    };
    Object.entries(visibility).forEach(([id, visible]) => {
        document.getElementById(id)?.classList.toggle('hidden', !visible);
    });

    if (!canApprove) {
        document.getElementById('badge-pending')?.classList.add('hidden');
        const pendingBody = document.getElementById('pending-bookings-body');
        if (pendingBody) pendingBody.innerHTML = '';
        const ownerFilter = document.getElementById('riwayat-filter-owner');
        if (ownerFilter) ownerFilter.value = 'mine';
    }
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    if ((activeTab === 'approval' && !canApprove) || (activeTab === 'pengaturan' && !fullAccess)) {
        window.switchTab('jadwal');
    }

    const summary = document.getElementById('lab-access-summary');
    if (summary) {
        const myLabs = getAccessibleLabsForWrite();
        summary.textContent = fullAccess
            ? (isLabAdminUser() ? 'Admin · Mengelola seluruh lab' : 'Kepala Lab · Mengelola seluruh lab')
            : myLabs.length ? `Koordinator: ${myLabs.map(lab => lab.nama).join(', ')}` : '';
        summary.classList.toggle('hidden', !summary.textContent);
    }
    updateInventoryAddButtonVisibility();
    document.getElementById('detail-inv-actions')?.classList.toggle(
        'hidden', !selectedInventoryItem || !canUserManageLab(selectedInventoryItem.lab_id)
    );
}

async function refreshLabAccess(event) {
    if (!currentUser || !labPageReady || document.visibilityState === 'hidden') return;
    // Focus dan visibilitychange sering terpicu bersamaan; cukup satu permintaan.
    if (event?.type !== 'online' && Date.now() - lastLabAccessRefreshAt < 1000) return;
    lastLabAccessRefreshAt = Date.now();
    await loadLabs(true);
}

document.addEventListener('visibilitychange', refreshLabAccess);
window.addEventListener('focus', refreshLabAccess);
window.addEventListener('online', refreshLabAccess);

// ============== CHECK KEPALA LAB (ROLE-BASED) ==============
async function checkKepalaLabStatus(userDoc = null) {
    // Cek apakah user punya role kepala_lab (primary atau additional)
    if (userDoc) {
        const isPrimary = userDoc.role === 'kepala_lab';
        const isAdditional = Array.isArray(userDoc.additionalRoles) && userDoc.additionalRoles.includes('kepala_lab');
        isKepalaLab = isPrimary || isAdditional;
    } else if (typeof window.hasRole === 'function') {
        isKepalaLab = window.hasRole('kepala_lab');
    } else {
        // Fallback jika hasRole belum tersedia: cek langsung localStorage
        const additionalRoles = JSON.parse(localStorage.getItem('user_additional_roles') || '[]');
        isKepalaLab = currentRole === 'kepala_lab' || additionalRoles.includes('kepala_lab');
    }
    console.log('[E-Lab] isKepalaLab (role-based):', isKepalaLab);

    // Muat data pengguna guru dan deteksi akun kepala_lab
    await loadTeacherUsersList();
    await loadAllKepalaLabData();
}

// ============== LOAD TEACHER USERS LIST (DROPDOWN KOORDINATOR) ==============
// Mengambil data guru berakun dari Firestore (di-cache di sessionStorage: Hemat Kuota Read)
async function loadTeacherUsersList(forceRefresh = false) {
    const cacheKey = 'simas_elab_teacher_users_cache';
    if (!forceRefresh) {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    teacherUsersList = parsed;
                    return teacherUsersList;
                }
            } catch (e) {}
        }
    }

    try {
        const snap = await getDocs(collection(db, PATHS.users));
        const list = [];
        snap.forEach(docSnap => {
            const data = docSnap.data();
            const role = data.role || '';
            const addRoles = Array.isArray(data.additionalRoles) ? data.additionalRoles : [];

            // Hanya sertakan pengguna selain siswa dan alumni (guru, staf, kepsek, dsb)
            if (role !== 'siswa' && role !== 'alumni') {
                list.push({
                    uid: docSnap.id,
                    name: data.name || data.email?.split('@')[0] || 'Guru/Staf',
                    email: data.email || '',
                    role: role,
                    additionalRoles: addRoles,
                    nip: data.nip || '',
                    phone: data.phone || '',
                    linkedTeacherId: data.linkedTeacherId || null
                });
            }
        });

        // Urutkan alfabetis nama
        list.sort((a, b) => a.name.localeCompare(b.name, 'id'));
        teacherUsersList = list;

        try {
            sessionStorage.setItem(cacheKey, JSON.stringify(teacherUsersList));
        } catch (e) {}
    } catch (e) {
        console.error('Error loading teacher users list:', e);
    }
    return teacherUsersList;
}

// ============== LOAD ALL KEPALA LAB DATA ==============
// Mendeteksi seluruh akun dengan role kepala_lab dan menyiapkan nomor WhatsApp kontak
async function loadAllKepalaLabData(forceRefresh = false) {
    const cacheKey = 'simas_elab_kalab_accounts_cache';
    if (!forceRefresh) {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed?.accounts)) {
                    allKepalaLabAccounts = parsed.accounts;
                    kepalaLabList = parsed.waList || [];
                    renderKalabSummaryUI();
                    return;
                }
            } catch (e) {}
        }
    }

    try {
        if (teacherUsersList.length === 0) {
            await loadTeacherUsersList(forceRefresh);
        }

        // Ambil data SSOT guru dari D1 untuk nomor telepon & NIP resmi
        let teachersData = new Map();
        try {
            if (typeof window.getTeachersMapCache === 'function') {
                teachersData = await window.getTeachersMapCache();
            }
        } catch (e) {
            console.warn('[E-Lab] Gagal memuat getTeachersMapCache:', e);
        }

        allKepalaLabAccounts = [];
        kepalaLabList = [];

        teacherUsersList.forEach(u => {
            const isKalab = u.role === 'kepala_lab' || (Array.isArray(u.additionalRoles) && u.additionalRoles.includes('kepala_lab'));
            if (isKalab) {
                let phone = u.phone || '';
                let nama = u.name;
                let nip = u.nip || '';

                if (u.linkedTeacherId && teachersData.has(u.linkedTeacherId)) {
                    const tData = teachersData.get(u.linkedTeacherId);
                    if (tData.phone) phone = tData.phone;
                    if (tData.name) nama = tData.name;
                    if (tData.nip) nip = tData.nip;
                }

                const accountObj = {
                    uid: u.uid,
                    nama: nama,
                    email: u.email,
                    phone: phone,
                    nip: nip
                };

                allKepalaLabAccounts.push(accountObj);
                if (phone) {
                    kepalaLabList.push(accountObj);
                }
            }
        });

        try {
            sessionStorage.setItem(cacheKey, JSON.stringify({
                accounts: allKepalaLabAccounts,
                waList: kepalaLabList
            }));
        } catch (e) {}

        console.log('[E-Lab] Akun Kepala Lab terdeteksi:', allKepalaLabAccounts.length);
        renderKalabSummaryUI();
    } catch (e) {
        console.warn('Error loading kepala lab data:', e);
    }
}

// ============== LAB COLOR UTILS ==============
// Palet warna laboratorium profesional dengan aksen sisi kiri dan latar lembut
const labColors = [
    { bg: '#eff6ff', text: '#1e3a8a', border: '#bfdbfe', accent: '#3b82f6', darkBg: 'rgba(30, 58, 138, 0.25)', darkText: '#93c5fd', darkBorder: '#1d4ed8' }, // Indigo / Blue
    { bg: '#f0fdf4', text: '#14532d', border: '#bbf7d0', accent: '#16a34a', darkBg: 'rgba(20, 83, 45, 0.25)', darkText: '#86efac', darkBorder: '#15803d' }, // Emerald / Green
    { bg: '#faf5ff', text: '#581c87', border: '#e9d5ff', accent: '#9333ea', darkBg: 'rgba(88, 28, 135, 0.25)', darkText: '#d8b4fe', darkBorder: '#7e22ce' }, // Purple
    { bg: '#fff7ed', text: '#7c2d12', border: '#fed7aa', accent: '#ea580c', darkBg: 'rgba(124, 45, 18, 0.25)', darkText: '#fdba74', darkBorder: '#c2410c' }, // Amber / Orange
    { bg: '#f0fdfa', text: '#134e4a', border: '#99f6e4', accent: '#0d9488', darkBg: 'rgba(19, 78, 74, 0.25)', darkText: '#5eead4', darkBorder: '#0f766e' }, // Teal
    { bg: '#fff1f2', text: '#881337', border: '#fecdd3', accent: '#e11d48', darkBg: 'rgba(136, 19, 55, 0.25)', darkText: '#fda4af', darkBorder: '#be123c' }, // Rose
    { bg: '#f0f9ff', text: '#0c4a6e', border: '#bae6fd', accent: '#0284c7', darkBg: 'rgba(12, 74, 110, 0.25)', darkText: '#7dd3fc', darkBorder: '#0369a1' }, // Sky
    { bg: '#fefce8', text: '#713f12', border: '#fef08a', accent: '#ca8a04', darkBg: 'rgba(113, 63, 18, 0.25)', darkText: '#fde047', darkBorder: '#a16207' }, // Yellow
    { bg: '#f5f3ff', text: '#4338ca', border: '#c7d2fe', accent: '#4f46e5', darkBg: 'rgba(67, 56, 202, 0.25)', darkText: '#a5b4fc', darkBorder: '#3730a3' }, // Violet
    { bg: '#fdf2f8', text: '#831843', border: '#fbcfe8', accent: '#db2777', darkBg: 'rgba(131, 24, 67, 0.25)', darkText: '#f472b6', darkBorder: '#9d174d' }  // Pink
];

function getLabColor(labId) {
    if (!labId) return labColors[0];

    // Create a simple hash from labId string
    let hash = 0;
    for (let i = 0; i < labId.length; i++) {
        hash = labId.charCodeAt(i) + ((hash << 5) - hash);
    }

    // Use positive modulo to pick a color
    const index = Math.abs(hash) % labColors.length;
    return labColors[index];
}

window.getLabColor = getLabColor; // Expose globally if needed

// ============== LOAD LABS ==============
async function loadLabs(forceRefresh = false) {
    const uid = currentUser?.uid;
    if (labsLoadPromise && labsLoadUid === uid) return labsLoadPromise;
    const pending = fetchLabs(forceRefresh);
    labsLoadPromise = pending;
    labsLoadUid = uid;
    try {
        return await pending;
    } finally {
        if (labsLoadPromise === pending) labsLoadPromise = null;
    }
}

async function fetchLabs(forceRefresh = false) {
    const cacheKey = 'simas_elab_labs_cache';
    const uid = currentUser?.uid;
    const previousAssignments = JSON.stringify(getAccessibleLabsForWrite().map(lab => lab.id).sort());

    const applyLabsToUI = () => {
        const bookingLab = document.getElementById('booking-lab');
        if (bookingLab) {
            const selectedLab = bookingLab.value;
            bookingLab.innerHTML = '<option value="">-- Pilih Lab --</option>' +
                labsList.map(l => `<option value="${window.escapeHTML(l.id)}">${window.escapeHTML(l.nama)}</option>`).join('');
            bookingLab.value = labsList.some(lab => lab.id === selectedLab) ? selectedLab : '';
        }
        if (typeof populateFilterLabOptions === 'function') {
            populateFilterLabOptions();
        }
        renderManageLabsList();
        if (labPageReady) populateLabFilters();
    };

    try {
        // Cache hanya mempercepat tampilan; penugasan wajib diperiksa ke server.
        if (!forceRefresh && !labsList.length) {
            let cached = null;
            try {
                cached = sessionStorage.getItem(cacheKey) || localStorage.getItem(cacheKey);
            } catch (e) {}

            if (cached) {
                try {
                    const parsed = JSON.parse(cached);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        labsList = parsed;
                        applyLabsToUI();
                    }
                } catch (e) {}
            }
        }

        // 1. Ambil murni dari Cloudflare D1 (0 Firestore Read) via cfClient auto-retry
        const list = await cfClient.getLabs();
        if (currentUser?.uid !== uid) return false;
        if (!Array.isArray(list)) throw new Error('Daftar laboratorium tidak valid');
        labsList = list;
        labsAccessVerified = true;

        try {
            sessionStorage.setItem(cacheKey, JSON.stringify(labsList));
            localStorage.setItem(cacheKey, JSON.stringify(labsList));
        } catch (e) {}

        applyLabsToUI();

    } catch (e) {
        if (currentUser?.uid !== uid) return false;
        labsAccessVerified = false;
        console.error('Error loading labs:', e);

        // Daftar offline boleh dibaca, tetapi tidak mengaktifkan akses koordinator.
        let fallbackApplied = labsList.length > 0;
        try {
            const fallback = !fallbackApplied && localStorage.getItem(cacheKey);
            if (fallback) {
                const parsed = JSON.parse(fallback);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    labsList = parsed;
                    applyLabsToUI();
                    fallbackApplied = true;
                    console.warn('[E-Lab] Memuat daftar laboratorium dari cache lokal offline/darurat.');
                }
            }
        } catch (errFallback) {}

        if (!fallbackApplied) {
            showToast('Peringatan', 'Gagal memuat daftar laboratorium. Silakan periksa koneksi atau coba segarkan halaman.', 'warning');
        }
    }
    if (labPageReady) {
        syncLabAccessUI();
        const currentAssignments = JSON.stringify(getAccessibleLabsForWrite().map(lab => lab.id).sort());
        if (currentAssignments !== previousAssignments) {
            // Hapus aksi yang sudah terbuka sebelum penugasan berubah.
            safeCloseModal('modal-booking-detail');
            const forms = {
                'modal-inventory-form': document.getElementById('inv-form-lab')?.value,
                'modal-inventory-import': document.getElementById('inv-import-lab')?.value,
                'modal-inventory-condition': selectedInventoryItem?.lab_id
            };
            Object.entries(forms).forEach(([modal, labId]) => {
                if (!canUserManageLab(labId)) safeCloseModal(modal);
            });
            const pendingBody = document.getElementById('pending-bookings-body');
            if (pendingBody) pendingBody.innerHTML = '';
            if (isKepalaLab || isLabAdminUser() || isUserCoordinatorForAnyLab()) {
                await window.loadPendingBookings();
            }
            await window.loadMyBookingHistory();
        }
    }
    return labsAccessVerified;
}
window.loadLabs = loadLabs;

// ============== AUTO-FILL SUBJECT FROM SCHEDULE XML ==============
let autoFillScheduleTimeout = null;

async function autoFillSubjectFromSchedule(force = false) {
    const dateInput = document.getElementById('booking-date');
    const startJPSelect = document.getElementById('booking-start-jp');
    const kelasSelect = document.getElementById('booking-kelas');
    const kegiatanInput = document.getElementById('booking-kegiatan');
    const badgeEl = document.getElementById('booking-mapel-badge');
    const hintEl = document.getElementById('booking-mapel-hint');

    if (!dateInput || !startJPSelect || !kelasSelect || !kegiatanInput) return;

    const dateStr = dateInput.value;
    const startJP = parseInt(startJPSelect.value);
    let kelas = kelasSelect.value;

    // Reset badge & hint jika data belum lengkap atau kelas adalah 'Lainnya' / manual
    if (!dateStr || !startJP || !kelas || kelas === 'Lainnya') {
        if (badgeEl) badgeEl.classList.add('hidden');
        if (hintEl) {
            hintEl.classList.add('hidden');
            hintEl.innerHTML = '';
        }
        return;
    }

    // Jika sedang edit booking eksisting dan belum ada pergantian kelas/JP eksplisit, pertahankan nilai awal
    if (window.editingBookingId && kegiatanInput.value.trim() && !force) {
        return;
    }

    // Debounce agar hemat proses
    if (autoFillScheduleTimeout) clearTimeout(autoFillScheduleTimeout);

    autoFillScheduleTimeout = setTimeout(async () => {
        try {
            const schedule = await getScheduleForClassAndDate(kelas, dateStr);
            if (!schedule || !Array.isArray(schedule)) return;

            const slot = schedule.find(s => s.jp === startJP);
            if (slot && slot.mapel && slot.mapel.trim() && slot.mapel.toUpperCase() !== 'UPACARA' && slot.mapel.toUpperCase() !== 'EKSTRAKURIKULER') {
                kegiatanInput.value = slot.mapel;

                // Tampilkan badge & hint informatif
                if (badgeEl) badgeEl.classList.remove('hidden');
                if (hintEl) {
                    const guruInfo = slot.guruNama ? ` • Guru: ${escapeHtml(slot.guruNama)}` : '';
                    hintEl.innerHTML = `<i class="fa-solid fa-circle-info text-emerald-600"></i> Terisi otomatis dari jadwal: <span class="text-emerald-700 font-semibold">${escapeHtml(slot.mapel)}</span><span class="text-slate-500">${guruInfo}</span> (tetap bisa diedit manual)`;
                    hintEl.classList.remove('hidden');
                }
            } else {
                if (badgeEl) badgeEl.classList.add('hidden');
                if (hintEl) {
                    hintEl.classList.add('hidden');
                    hintEl.innerHTML = '';
                }
            }
        } catch (err) {
            console.warn('[E-Lab] Gagal auto-fill mapel dari jadwal XML:', err);
        }
    }, 150);
}

// ============== POPULATE JP DROPDOWNS ==============
function populateJPDropdowns() {
    const startSelect = document.getElementById('booking-start-jp');
    const endSelect = document.getElementById('booking-end-jp');

    const options = JAM_PELAJARAN.map(j =>
        `<option value="${j.jp}">JP ${j.jp} (${j.mulai})</option>`
    ).join('');

    startSelect.innerHTML = '<option value="">-- Pilih --</option>' + options;
    endSelect.innerHTML = '<option value="">-- Pilih --</option>' + options;

    // Auto-update end when start changes
    startSelect.addEventListener('change', () => {
        const startJP = parseInt(startSelect.value);
        if (startJP) {
            // Filter end options to only show >= start
            const filteredOptions = JAM_PELAJARAN
                .filter(j => j.jp >= startJP)
                .map(j => `<option value="${j.jp}">JP ${j.jp} (${j.selesai})</option>`)
                .join('');
            endSelect.innerHTML = '<option value="">-- Pilih --</option>' + filteredOptions;
        }
        checkBookingConflict();
        autoFillSubjectFromSchedule();
    });

    // Add conflict check & auto-fill listeners
    endSelect.addEventListener('change', checkBookingConflict);
    document.getElementById('booking-lab').addEventListener('change', checkBookingConflict);
    document.getElementById('booking-date').addEventListener('change', () => {
        checkBookingConflict();
        autoFillSubjectFromSchedule();
    });

    // Listener saat kegiatan diedit manual oleh user
    const kegiatanInput = document.getElementById('booking-kegiatan');
    if (kegiatanInput) {
        kegiatanInput.addEventListener('input', () => {
            const badgeEl = document.getElementById('booking-mapel-badge');
            if (badgeEl) badgeEl.classList.add('hidden');
        });
    }
}

// ============== CHECK BOOKING CONFLICT (REAL-TIME) ==============
let conflictCheckTimeout = null;

async function checkBookingConflict() {
    const labId = document.getElementById('booking-lab').value;
    const dateStr = document.getElementById('booking-date').value;
    const startJP = parseInt(document.getElementById('booking-start-jp').value);
    const endJP = parseInt(document.getElementById('booking-end-jp').value);
    const conflictPreview = document.getElementById('conflict-preview');

    // Reset if incomplete
    if (!labId || !dateStr || !startJP || !endJP) {
        conflictPreview.classList.add('hidden');
        return;
    }

    // Debounce to avoid too many requests
    if (conflictCheckTimeout) clearTimeout(conflictCheckTimeout);

    conflictCheckTimeout = setTimeout(async () => {
        try {
            const bookings = await cfClient.getLabBookings({
                tanggal: dateStr,
                labId: labId
            });

            const conflicts = [];
            (bookings || []).forEach(b => {
                // Hanya periksa status pending, conflict, approved
                if (!['pending', 'approved', 'conflict'].includes(b.status)) return;

                // Jika sedang edit, skip booking yang sedang diedit sendiri
                if (window.editingBookingId && b.id === window.editingBookingId) {
                    return; // Skip, jangan dianggap conflict dengan diri sendiri
                }

                // Check if time slots overlap
                if (!(endJP < b.jam_mulai || startJP > b.jam_selesai)) {
                    conflicts.push(b);
                }
            });

            if (conflicts.length > 0) {
                const conflictList = conflicts.map(c =>
                    `<div class="text-xs mt-1">• JP ${c.jam_mulai}-${c.jam_selesai}: <b>${escapeHtml(c.kelas || '')}</b> - ${escapeHtml(c.kegiatan)} (${c.status === 'approved' ? 'Disetujui' : 'Pending'})</div>`
                ).join('');

                conflictPreview.innerHTML = `
                    <p class="text-xs font-bold text-orange-700 flex items-center gap-2">
                        <i class="fa-solid fa-triangle-exclamation"></i>
                        Jadwal Bentrok dengan ${conflicts.length} booking!
                    </p>
                    ${conflictList}
                    <p class="text-[10px] text-slate-500 mt-2">Booking tetap bisa diajukan, Kepala Lab akan menentukan prioritas.</p>
                `;
                conflictPreview.classList.remove('hidden');
            } else {
                conflictPreview.classList.add('hidden');
            }
        } catch (e) {
            console.warn('Error checking conflict:', e);
        }
    }, 300);
}

// ============== WEEK NAVIGATION STATE ==============
let currentWeekDate = new Date(); // Tanggal Senin minggu aktif

// ============== SET CURRENT WEEK ==============
function setCurrentWeek() {
    const now = new Date();
    // Get Monday of current week
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
    currentWeekDate = new Date(now.setDate(diff));
    updateWeekDisplay();
}

function updateWeekDisplay() {
    const weekInput = document.getElementById('select-week');
    const weekDisplay = document.getElementById('week-display');

    // Calculate week value for internal use
    const year = currentWeekDate.getFullYear();
    const startOfYear = new Date(year, 0, 1);
    const days = Math.floor((currentWeekDate - startOfYear) / 86400000);
    const weekNumber = Math.ceil((days + startOfYear.getDay() + 1) / 7);
    weekInput.value = `${year}-W${String(weekNumber).padStart(2, '0')}`;

    // Get Friday of the week
    const friday = new Date(currentWeekDate);
    friday.setDate(currentWeekDate.getDate() + 4);

    // Format display in Indonesian
    const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

    const startDay = currentWeekDate.getDate();
    const endDay = friday.getDate();
    const startMonth = months[currentWeekDate.getMonth()];
    const endMonth = months[friday.getMonth()];
    const startYear = currentWeekDate.getFullYear();
    const endYear = friday.getFullYear();

    let displayText;
    if (startMonth === endMonth && startYear === endYear) {
        displayText = `${startDay} - ${endDay} ${endMonth} ${endYear}`;
    } else if (startYear === endYear) {
        displayText = `${startDay} ${startMonth} - ${endDay} ${endMonth} ${endYear}`;
    } else {
        displayText = `${startDay} ${startMonth} ${startYear} - ${endDay} ${endMonth} ${endYear}`;
    }

    weekDisplay.textContent = displayText;
}

window.changeWeek = function (direction) {
    // Move week forward or backward
    currentWeekDate.setDate(currentWeekDate.getDate() + (direction * 7));
    updateWeekDisplay();
    loadWeeklySchedule();
};

window.goToCurrentWeek = function () {
    setCurrentWeek();
    loadWeeklySchedule();
};

// ============== GET WEEK DATES ==============
function getWeekDates(weekValue) {
    // Gunakan currentWeekDate yang sudah dihitung akurat sebagai Senin minggu aktif
    // Ini mencegah bug perhitungan ISO week yang rumit
    const monday = new Date(currentWeekDate);

    const dates = [];
    for (let i = 0; i < 5; i++) { // Senin - Jumat
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        // Format ke YYYY-MM-DD dengan handling timezone lokal
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        dates.push(`${year}-${month}-${day}`);
    }
    return dates;
}

// ============== LOAD WEEKLY SCHEDULE ==============
window.loadWeeklySchedule = async function () {
    const weekValue = document.getElementById('select-week')?.value;

    if (!weekValue) {
        renderEmptySchedule();
        return;
    }

    const weekDates = getWeekDates(weekValue);

    // Visual loading state
    const loadingEl = document.getElementById('schedule-loading');
    const errorEl = document.getElementById('schedule-error');
    const filterEmptyEl = document.getElementById('schedule-filter-empty');
    const scheduleContainer = document.getElementById('schedule-container');

    if (loadingEl) loadingEl.classList.remove('hidden');
    if (errorEl) errorEl.classList.add('hidden');
    if (filterEmptyEl) filterEmptyEl.classList.add('hidden');

    try {
        // Query ALL bookings for this week (semua lab) via Cloudflare D1 (0 Firestore Read)
        const list = await cfClient.getLabBookings({
            weekStart: weekDates[0],
            weekEnd: weekDates[4]
        });

        weeklyBookings = list || [];

        // Preload master guru dari cache D1 (0 Firestore Read) untuk render avatar instan
        if (typeof window.getTeachersCache === 'function') {
            await window.getTeachersCache().catch(() => {});
        }

        if (loadingEl) loadingEl.classList.add('hidden');

        renderScheduleMatrix(weekDates);
        renderLabLegend();

        // Update mobile list view
        renderMobileListView();

    } catch (e) {
        console.error('Error loading schedule:', e);
        if (loadingEl) loadingEl.classList.add('hidden');
        if (errorEl) {
            errorEl.classList.remove('hidden');
            const errorMsg = document.getElementById('schedule-error-msg');
            if (errorMsg) errorMsg.textContent = e.message || 'Terjadi kesalahan saat memuat jadwal.';
        }
        showToast('Error', 'Gagal memuat jadwal: ' + (e.message || 'Kesalahan koneksi'), 'error');
    }
};

// ============== UPDATE SCHEDULE TABLE HEADER ==============
function updateScheduleTableHeader(weekDates) {
    const headerRow = document.getElementById('schedule-header-row');
    if (!headerRow) return;

    const todayStr = window.getLocalISODate(new Date());
    const dayNames = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];
    const monthNamesShort = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

    let headerHtml = `<th class="sched-corner-header p-2.5 text-center text-xs font-bold uppercase tracking-wider bg-slate-800 text-slate-200 border-b border-r border-slate-700 select-none">Waktu</th>`;

    weekDates.forEach((dateStr, idx) => {
        const isToday = dateStr === todayStr;
        const d = parseLocalDate(dateStr);
        const dayNum = d.getDate();
        const monthShort = monthNamesShort[d.getMonth()];
        const dayName = dayNames[idx] || '';

        const todayBadge = isToday
            ? `<span class="inline-block ml-1 px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-blue-500 text-white leading-tight shadow-xs">Hari Ini</span>`
            : '';

        const thClass = isToday
            ? 'bg-slate-800 text-blue-300 ring-1 ring-blue-400/50'
            : 'bg-slate-800 text-slate-200';

        headerHtml += `
            <th class="p-2.5 text-center text-xs font-bold border-b border-r border-slate-700 ${thClass}" data-col="${idx}">
                <div class="flex items-center justify-center gap-1">
                    <span>${dayName}</span>
                    ${todayBadge}
                </div>
                <div class="text-[11px] font-normal text-slate-400 mt-0.5">${dayNum} ${monthShort}</div>
            </th>
        `;
    });

    headerRow.innerHTML = headerHtml;
}

// ============== RENDER SCHEDULE MATRIX ==============
function renderScheduleMatrix(weekDates) {
    const tbody = document.getElementById('schedule-body');
    if (!tbody) return;

    // Update Header Tabel dengan Hari dan Tanggal
    updateScheduleTableHeader(weekDates);

    const filteredBookings = getFilteredBookings();
    const filterEmptyEl = document.getElementById('schedule-filter-empty');
    const scheduleContainer = document.getElementById('schedule-container');

    // Tampilkan state filter kosong jika ada booking minggu ini tetapi 0 setelah difilter
    if (weeklyBookings.length > 0 && filteredBookings.length === 0) {
        if (filterEmptyEl) filterEmptyEl.classList.remove('hidden');
    } else {
        if (filterEmptyEl) filterEmptyEl.classList.add('hidden');
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let html = '';

    JAM_PELAJARAN.forEach((jp, idx) => {
        // Baris Istirahat 1 (sebelum JP 4)
        if (jp.jp === 4) {
            html += `<tr class="bg-amber-50/70 dark:bg-amber-950/30 border-y border-amber-200/60 dark:border-amber-900/40 select-none">
                <td colspan="6" class="py-1 px-3 text-center text-xs text-amber-800 dark:text-amber-300 font-semibold">
                    <i class="fa-solid fa-mug-hot text-amber-600 dark:text-amber-400 mr-1.5 text-xs"></i>Istirahat 1 (09:45 - 10:00)
                </td>
            </tr>`;
        }
        // Baris Istirahat 2 (sebelum JP 7)
        if (jp.jp === 7) {
            html += `<tr class="bg-amber-50/70 dark:bg-amber-950/30 border-y border-amber-200/60 dark:border-amber-900/40 select-none">
                <td colspan="6" class="py-1 px-3 text-center text-xs text-amber-800 dark:text-amber-300 font-semibold">
                    <i class="fa-solid fa-utensils text-amber-600 dark:text-amber-400 mr-1.5 text-xs"></i>Istirahat 2 (12:15 - 12:30)
                </td>
            </tr>`;
        }

        html += `<tr class="${idx % 2 === 0 ? 'bg-white dark:bg-slate-800' : 'bg-slate-50/60 dark:bg-slate-800/60'} border-b border-slate-200 dark:border-slate-700/80">`;

        // Kolom Waktu Sticky Left
        html += `<td class="sched-time-cell p-2 text-center text-xs border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 select-none whitespace-nowrap">
            <div class="font-bold text-slate-800 dark:text-slate-200 text-xs">JP ${jp.jp}</div>
            <div class="text-[10px] text-slate-400 dark:text-slate-500">${jp.mulai} - ${jp.selesai}</div>
        </td>`;

        // Loop Hari (Senin - Jumat)
        weekDates.forEach((dateStr, dayIdx) => {
            const slotDate = parseLocalDate(dateStr);
            const isPastDate = slotDate < today;

            // Bookings di slot ini (sesuai filter)
            const bookingsOnSlot = filteredBookings.filter(b =>
                b.tanggal === dateStr &&
                jp.jp >= b.jam_mulai &&
                jp.jp <= b.jam_selesai &&
                (b.status === 'approved' || b.status === 'pending' || b.status === 'conflict')
            );

            // Validasi Ketersediaan Riil: cek seluruh booking tanpa filter
            const allBookingsOnSlot = weeklyBookings.filter(b =>
                b.tanggal === dateStr &&
                jp.jp >= b.jam_mulai &&
                jp.jp <= b.jam_selesai &&
                (b.status === 'approved' || b.status === 'pending' || b.status === 'conflict')
            );

            // KASUS 1: Slot Kosong Sesuai Filter
            if (bookingsOnSlot.length === 0) {
                const isSelected = smartBookingSelection &&
                    smartBookingSelection.dateStr === dateStr &&
                    smartBookingSelection.jp === jp.jp;

                const isSameDay = smartBookingSelection && smartBookingSelection.dateStr === dateStr;

                if (isSelected) {
                    // Slot awal terpilih (Smart Quick Booking)
                    html += `<td class="p-1.5 text-center border-r border-slate-200 dark:border-slate-700 bg-blue-600 text-white cursor-pointer transition-all shadow-inner"
                        data-date="${dateStr}" data-jp="${jp.jp}"
                        onclick="quickBook('${dateStr}', ${jp.jp})" title="Slot awal terpilih - klik slot akhir">
                        <div class="flex items-center justify-center gap-1 text-xs font-bold">
                            <i class="fa-solid fa-arrow-down animate-bounce"></i>
                            <span>JP ${jp.jp}</span>
                        </div>
                    </td>`;
                } else if (isSameDay) {
                    // Potensi slot akhir di hari yang sama
                    html += `<td class="sched-empty-slot p-1.5 text-center border-r border-slate-200 dark:border-slate-700 hover:bg-blue-100 dark:hover:bg-blue-900/40 cursor-pointer transition-all"
                        data-date="${dateStr}" data-jp="${jp.jp}"
                        tabindex="0" role="button" aria-label="Pilih akhir booking JP ${jp.jp}"
                        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();quickBook('${dateStr}', ${jp.jp});}"
                        onmouseover="highlightRange('${dateStr}', ${jp.jp})"
                        onmouseout="clearRangeHighlight()"
                        onclick="quickBook('${dateStr}', ${jp.jp})" title="Klik untuk menentukan akhir booking">
                        <div class="sched-empty-action inline-flex items-center justify-center gap-1 text-[10px] font-bold text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/60 px-2 py-0.5 rounded border border-blue-300 dark:border-blue-700">
                            <span>Hingga JP ${jp.jp}</span>
                        </div>
                        <span class="sched-empty-dash text-blue-400 dark:text-blue-500 text-xs font-semibold">+</span>
                    </td>`;
                } else if (allBookingsOnSlot.length > 0) {
                    // Slot memiliki booking aktif tetapi tersembunyi karena filter status/lab
                    html += `<td class="p-1.5 text-center border-r border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40">
                        <div class="p-1 rounded-md border border-dashed border-slate-300 dark:border-slate-600 text-slate-400 dark:text-slate-500 text-[10px] italic flex items-center justify-center gap-1 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
                            onclick="quickBook('${dateStr}', ${jp.jp})"
                            title="Terdapat ${allBookingsOnSlot.length} booking aktif yang disembunyikan oleh filter. Klik untuk mengajukan booking.">
                            <i class="fa-solid fa-filter text-[9px]"></i>
                            <span>Terfilter (${allBookingsOnSlot.length})</span>
                        </div>
                    </td>`;
                } else if (isPastDate) {
                    // Slot tanggal lampau (nonaktif)
                    html += `<td class="p-1.5 text-center border-r border-slate-200 dark:border-slate-700 bg-slate-100/40 dark:bg-slate-800/30 text-slate-300 dark:text-slate-600 text-xs select-none cursor-not-allowed" title="Tanggal lampau">
                        -
                    </td>`;
                } else {
                    // Slot kosong normal siap dibooking
                    html += `<td class="sched-empty-slot p-1.5 text-center border-r border-slate-200 dark:border-slate-700 hover:bg-blue-50/70 dark:hover:bg-slate-700/60 cursor-pointer transition-all"
                        data-date="${dateStr}" data-jp="${jp.jp}"
                        tabindex="0" role="button" aria-label="Slot JP ${jp.jp} tanggal ${dateStr}, kosong. Tekan Enter untuk booking."
                        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();quickBook('${dateStr}', ${jp.jp});}"
                        onclick="quickBook('${dateStr}', ${jp.jp})" title="Klik untuk booking">
                        <div class="sched-empty-action inline-flex items-center justify-center gap-1 text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/70 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800 shadow-2xs">
                            <i class="fa-solid fa-plus text-[9px]"></i><span>Booking</span>
                        </div>
                        <span class="sched-empty-dash text-slate-300 dark:text-slate-600 text-xs">-</span>
                    </td>`;
                }

            } else if (bookingsOnSlot.length === 1) {
                // KASUS 2: 1 Booking pada slot ini
                const b = bookingsOnSlot[0];
                const labColor = getLabColor(b.lab_id);
                const statusBadge = renderScheduleStatusBadge(b.status);

                html += `<td class="p-1 text-left border-r border-slate-200 dark:border-slate-700 align-top">
                    <div class="relative overflow-hidden rounded-lg p-2 text-xs cursor-pointer hover:shadow-xs transition-all border border-slate-200 dark:border-slate-700/90 border-l-4"
                        style="border-left-color: ${labColor.accent}; background-color: ${labColor.bg};"
                        tabindex="0" role="button" aria-label="Detail booking ${escapeHtml(b.kegiatan)}"
                        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();showBookingDetail('${b.id}');}"
                        onclick="showBookingDetail('${b.id}')">
                        <div class="flex items-center justify-between gap-1 mb-1 relative z-1">
                            <span class="font-bold text-[10px] uppercase tracking-wide truncate max-w-[120px]" style="color: ${labColor.text};">
                                ${escapeHtml((b.lab_nama || 'Lab').replace('Laboratorium', 'Lab'))}
                            </span>
                            ${statusBadge}
                        </div>
                        <p class="font-semibold text-xs leading-snug text-slate-800 dark:text-slate-100 line-clamp-2 relative z-1" title="${escapeHtml(b.kegiatan)}">
                            ${escapeHtml(b.kegiatan)}
                        </p>
                        <div class="text-[10px] text-slate-600 dark:text-slate-300 truncate mt-1 flex items-center gap-1 relative z-1">
                            <span class="font-medium text-slate-700 dark:text-slate-200">${escapeHtml(b.pemohon_nama.split(',')[0])}</span>
                            ${b.kelas ? `<span class="text-slate-400">•</span><span>${escapeHtml(b.kelas)}</span>` : ''}
                        </div>
                    </div>
                </td>`;

            } else if (bookingsOnSlot.length === 2) {
                // KASUS 3: 2 Booking pada slot ini (tampilkan 2 kartu ringkas)
                let cardsHtml = '';
                bookingsOnSlot.forEach(b => {
                    const labColor = getLabColor(b.lab_id);
                    const statusBadge = renderScheduleStatusBadge(b.status, true);

                    cardsHtml += `
                        <div class="relative overflow-hidden rounded-md p-1.5 mb-1 last:mb-0 text-xs cursor-pointer hover:shadow-2xs transition-all border border-slate-200 dark:border-slate-700 border-l-4"
                            style="border-left-color: ${labColor.accent}; background-color: ${labColor.bg};"
                            tabindex="0" role="button" aria-label="Detail booking ${escapeHtml(b.kegiatan)}"
                            onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();showBookingDetail('${b.id}');}"
                            onclick="showBookingDetail('${b.id}')" title="${escapeHtml(b.lab_nama)}: ${escapeHtml(b.kegiatan)}">
                            <div class="flex items-center justify-between gap-1 relative z-1">
                                <span class="font-bold text-[9px] truncate max-w-[70px]" style="color: ${labColor.text};">
                                    ${escapeHtml((b.lab_nama || 'Lab').replace('Laboratorium', 'Lab'))}
                                </span>
                                ${statusBadge}
                            </div>
                            <p class="font-semibold text-[11px] leading-tight text-slate-800 dark:text-slate-100 truncate mt-0.5 relative z-1" title="${escapeHtml(b.kegiatan)}">
                                ${escapeHtml(b.kegiatan)}
                            </p>
                            <p class="text-[9px] text-slate-500 dark:text-slate-400 truncate mt-0.5 relative z-1">
                                ${escapeHtml(b.pemohon_nama.split(',')[0])}${b.kelas ? ` • ${escapeHtml(b.kelas)}` : ''}
                            </p>
                        </div>
                    `;
                });

                html += `<td class="p-1 text-left border-r border-slate-200 dark:border-slate-700 align-top">
                    ${cardsHtml}
                </td>`;

            } else {
                // KASUS 4: Slot Padat (> 2 Booking)
                // Tampilkan 2 kartu teratas + tombol modal "+N lainnya"
                let topCardsHtml = '';
                bookingsOnSlot.slice(0, 2).forEach(b => {
                    const labColor = getLabColor(b.lab_id);
                    const statusBadge = renderScheduleStatusBadge(b.status, true);

                    topCardsHtml += `
                        <div class="relative overflow-hidden rounded-md p-1 mb-1 text-xs cursor-pointer hover:shadow-2xs transition-all border border-slate-200 dark:border-slate-700 border-l-4"
                            style="border-left-color: ${labColor.accent}; background-color: ${labColor.bg};"
                            onclick="showBookingDetail('${b.id}')" title="${escapeHtml(b.lab_nama)}: ${escapeHtml(b.kegiatan)}">
                            <div class="flex items-center justify-between gap-1 relative z-1">
                                <span class="font-bold text-[9px] truncate max-w-[70px]" style="color: ${labColor.text};">
                                    ${escapeHtml((b.lab_nama || 'Lab').replace('Laboratorium', 'Lab'))}
                                </span>
                                ${statusBadge}
                            </div>
                            <p class="font-semibold text-[10px] leading-tight text-slate-800 dark:text-slate-100 truncate relative z-1">
                                ${escapeHtml(b.kegiatan)}
                            </p>
                        </div>
                    `;
                });

                const remainingCount = bookingsOnSlot.length - 2;
                html += `<td class="p-1 text-left border-r border-slate-200 dark:border-slate-700 align-top">
                    ${topCardsHtml}
                    <button type="button" onclick="window.showSlotBookingsModal('${dateStr}', ${jp.jp})"
                        class="w-full mt-0.5 py-1 px-1.5 rounded-md bg-blue-50 hover:bg-blue-100 dark:bg-slate-700 dark:hover:bg-slate-600 text-blue-700 dark:text-blue-300 text-[10px] font-bold border border-blue-200 dark:border-slate-600 transition-colors flex items-center justify-center gap-1 shadow-2xs">
                        <i class="fa-solid fa-layer-group text-[9px]"></i>
                        <span>+${remainingCount} lainnya</span>
                    </button>
                </td>`;
            }
        });

        html += '</tr>';
    });

    tbody.innerHTML = html;
}

/**
 * Helper untuk mendapatkan data dan elemen foto/avatar profil guru penanggung jawab jam praktikum
 * Berbasis SSOT D1 & Cloudflare R2 (0 Firestore Read)
 * Pada matriks tabel jadwal ('schedule-single' dan 'schedule-multi'), avatar disembunyikan
 * sesuai preferensi antarmuka pengguna agar sel kartu bersih, lapang, dan mudah dibaca.
 * Avatar tetap ditampilkan secara kaya pada mode 'table', 'detail', dan 'compact'.
 *
 * @param {Object} booking - Data booking lab
 * @param {string} mode - 'schedule-single', 'schedule-multi', 'table', 'detail', 'compact'
 * @returns {string} HTML markup avatar/foto guru atau string kosong untuk matriks
 */
function getTeacherBookingAvatar(booking, mode = 'schedule-single') {
    if (!booking) return '';
    const rawName = (booking.pemohon_nama || 'Guru').trim();
    const cleanName = rawName.split(',')[0].trim();

    // 1. Ekstraksi inisial untuk fallback monogram
    const nameParts = cleanName.split(/\s+/).filter(Boolean);
    let initials = 'G';
    if (nameParts.length >= 2) {
        initials = (nameParts[0][0] + nameParts[1][0]).toUpperCase();
    } else if (nameParts.length === 1 && nameParts[0].length >= 1) {
        initials = nameParts[0].substring(0, 2).toUpperCase();
    }

    // 2. Pencarian guru di Master GTK / Teachers D1 Cache (0 Firestore Read)
    let photoUrl = '';
    let teacherId = '';
    const teachersList = (typeof window.getTeachersCacheSync === 'function')
        ? window.getTeachersCacheSync()
        : [];

    let matchedTeacher = null;
    // Coba cocokkan via pemohon_uid di teacherUsersList atau teachersList
    if (booking.pemohon_uid) {
        if (Array.isArray(teacherUsersList) && teacherUsersList.length > 0) {
            const matchedUser = teacherUsersList.find(u => u.uid === booking.pemohon_uid);
            if (matchedUser && matchedUser.linkedTeacherId) {
                matchedTeacher = teachersList.find(t => (t.id || t.nip) === matchedUser.linkedTeacherId);
            }
        }
        if (!matchedTeacher && Array.isArray(teachersList)) {
            matchedTeacher = teachersList.find(t => t.uid === booking.pemohon_uid || t.id === booking.pemohon_uid);
        }
    }

    // Jika belum ketemu, cocokkan berdasarkan nama
    if (!matchedTeacher && cleanName && Array.isArray(teachersList) && teachersList.length > 0) {
        const lowerClean = cleanName.toLowerCase();
        matchedTeacher = teachersList.find(t => {
            const tName = (t.name || t.nama || '').toLowerCase();
            return tName === lowerClean || tName.includes(lowerClean) || lowerClean.includes(tName);
        });
    }

    if (matchedTeacher) {
        teacherId = matchedTeacher.id || matchedTeacher.uid || '';
        photoUrl = matchedTeacher.foto || matchedTeacher.photo_url || '';
        if (!photoUrl && teacherId) {
            photoUrl = `/api/photos/gtk/${teacherId}.webp`;
        }
    }

    // Resolusi SSOT Cloudflare Worker URL
    let resolved = photoUrl ? (typeof resolvePhotoUrl === 'function' ? resolvePhotoUrl(photoUrl) : photoUrl) : '';
    if (resolved && !/^(https?:|\/|data:image\/)/i.test(resolved)) {
        resolved = '';
    }

    const safeUrl = resolved ? escapeHtml(resolved) : '';
    const safeName = escapeHtml(rawName);

    if (mode === 'schedule-single' || mode === 'schedule-multi') {
        // Mode Matriks Jadwal: Foto/avatar disembunyikan agar sel kartu bersih, minimalis, dan mudah dibaca
        return '';
    } else if (mode === 'table') {
        // Mode Tabel Riwayat / Log Pemakaian: Inline avatar dalam sel tabel
        return `
            <div class="inline-flex items-center gap-2">
                <div class="relative w-6 h-6 shrink-0 inline-flex items-center justify-center">
                    ${safeUrl ? `
                        <img src="${safeUrl}" alt="${safeName}" loading="lazy"
                            class="w-6 h-6 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-700 shadow-2xs"
                            onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" />
                    ` : ''}
                    <div class="w-6 h-6 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-extrabold text-[9px] ${safeUrl ? 'hidden' : 'flex'} items-center justify-center ring-1 ring-slate-200 dark:ring-slate-700 shadow-2xs select-none">
                        <span>${initials}</span>
                    </div>
                </div>
                <span class="font-medium text-slate-800 dark:text-slate-200">${safeName}</span>
            </div>
        `.trim();
    } else if (mode === 'detail') {
        // Mode Detail Modal: Avatar medium yang jelas
        return `
            <div class="flex items-center gap-3 p-2.5 bg-slate-50 dark:bg-slate-700/40 rounded-xl border border-slate-100 dark:border-slate-700">
                <div class="relative w-10 h-10 shrink-0 inline-flex items-center justify-center">
                    ${safeUrl ? `
                        <img src="${safeUrl}" alt="${safeName}" loading="lazy"
                            class="w-10 h-10 rounded-full object-cover ring-2 ring-blue-500/30 shadow-xs"
                            onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" />
                    ` : ''}
                    <div class="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-extrabold text-xs ${safeUrl ? 'hidden' : 'flex'} items-center justify-center ring-2 ring-blue-500/30 shadow-xs select-none">
                        <span>${initials}</span>
                    </div>
                </div>
                <div class="min-w-0 flex-1">
                    <p class="font-bold text-sm text-slate-800 dark:text-slate-100 truncate">${safeName}</p>
                    <p class="text-xs text-slate-500 dark:text-slate-400">Guru Penanggung Jawab Praktikum</p>
                </div>
            </div>
        `.trim();
    } else {
        // Mode Mobile List / Slot Modal Item: Inline mini avatar
        return `
            <span class="relative w-5 h-5 shrink-0 inline-flex items-center justify-center align-middle">
                ${safeUrl ? `
                    <img src="${safeUrl}" alt="${safeName}" loading="lazy"
                        class="w-5 h-5 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-700"
                        onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" />
                ` : ''}
                <span class="w-5 h-5 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-extrabold text-[8px] ${safeUrl ? 'hidden' : 'inline-flex'} items-center justify-center ring-1 ring-slate-200 dark:ring-slate-700 select-none">
                    <span>${initials}</span>
                </span>
            </span>
        `.trim();
    }
}
window.getTeacherBookingAvatar = getTeacherBookingAvatar;

// Helper untuk render status badge kalender bebas glow
function renderScheduleStatusBadge(status, isCompact = false) {
    if (status === 'approved') {
        return `<span class="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.2 rounded border border-emerald-200/60 dark:border-emerald-800/50 shrink-0">
            <i class="fa-solid fa-circle-check text-emerald-600 text-[8px]"></i>
            ${isCompact ? '' : '<span>Disetujui</span>'}
        </span>`;
    }
    if (status === 'conflict') {
        return `<span class="inline-flex items-center gap-1 text-[9px] font-bold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/60 px-1.5 py-0.2 rounded border border-rose-200/60 dark:border-rose-800/50 shrink-0" title="Bentrok Jadwal">
            <i class="fa-solid fa-triangle-exclamation text-rose-600 text-[8px]"></i>
            ${isCompact ? '' : '<span>Bentrok</span>'}
        </span>`;
    }
    // pending
    return `<span class="inline-flex items-center gap-1 text-[9px] font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 px-1.5 py-0.2 rounded border border-amber-200/60 dark:border-amber-800/50 shrink-0">
        <i class="fa-solid fa-clock text-amber-600 text-[8px]"></i>
        ${isCompact ? '' : '<span>Menunggu</span>'}
    </span>`;
}

// Helper untuk status class styling (backward-compatibility)
function getStatusClass(status) {
    switch (status) {
        case 'approved': return 'bg-emerald-50 text-emerald-800 border-emerald-200';
        case 'rejected': return 'bg-rose-50 text-rose-800 border-rose-200';
        case 'pending': return 'bg-amber-50 text-amber-800 border-amber-200';
        case 'conflict': return 'bg-rose-50 text-rose-800 border-rose-200';
        default: return 'bg-slate-50 text-slate-800 border-slate-200';
    }
}

function renderEmptySchedule() {
    const tbody = document.getElementById('schedule-body');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-slate-400 dark:text-slate-500">
            Pilih minggu untuk melihat jadwal laboratorium.
        </td></tr>`;
    }
}

// ============== MODAL SLOT BOOKINGS PADAT (+N Lainnya) ==============
window.showSlotBookingsModal = function (dateStr, jp) {
    const filteredBookings = getFilteredBookings();
    const slotBookings = filteredBookings.filter(b =>
        b.tanggal === dateStr &&
        jp >= b.jam_mulai &&
        jp <= b.jam_selesai &&
        (b.status === 'approved' || b.status === 'pending' || b.status === 'conflict')
    );

    const jpInfo = JAM_PELAJARAN.find(j => j.jp === jp);
    const titleEl = document.getElementById('slot-modal-title');
    if (titleEl) {
        titleEl.textContent = `Booking JP ${jp} (${jpInfo?.mulai || ''} - ${jpInfo?.selesai || ''}) • ${formatDate(dateStr)}`;
    }

    const contentEl = document.getElementById('slot-modal-content');
    if (contentEl) {
        if (slotBookings.length === 0) {
            contentEl.innerHTML = '<p class="text-center text-xs text-slate-400 py-6">Tidak ada booking pada slot ini.</p>';
        } else {
            contentEl.innerHTML = slotBookings.map(b => {
                const labColor = getLabColor(b.lab_id);
                const statusBadge = renderScheduleStatusBadge(b.status);

                return `
                    <div class="p-3 rounded-lg border border-slate-200 dark:border-slate-700 border-l-4 bg-white dark:bg-slate-800 shadow-2xs space-y-1.5"
                        style="border-left-color: ${labColor.accent};">
                        <div class="flex items-center justify-between gap-2">
                            <span class="font-bold text-xs" style="color: ${labColor.text};">
                                <i class="fa-solid fa-flask text-xs mr-1"></i>${escapeHtml(b.lab_nama)}
                            </span>
                            ${statusBadge}
                        </div>
                        <h4 class="font-bold text-sm text-slate-800 dark:text-slate-100 leading-snug">
                            ${escapeHtml(b.kegiatan)}
                        </h4>
                        <div class="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                            <span class="inline-flex items-center gap-1.5">${getTeacherBookingAvatar(b, 'compact')}<span>${escapeHtml(b.pemohon_nama)}</span></span>
                            ${b.kelas ? `<span><i class="fa-solid fa-users text-[10px] mr-1"></i>${escapeHtml(b.kelas)}</span>` : ''}
                            <span><i class="fa-solid fa-clock text-[10px] mr-1"></i>JP ${b.jam_mulai} - ${b.jam_selesai}</span>
                        </div>
                        <div class="pt-1.5 border-t border-slate-100 dark:border-slate-700 flex justify-end">
                            <button type="button" onclick="closeModal('modal-slot-bookings'); showBookingDetail('${b.id}');"
                                class="px-2.5 py-1 rounded bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/40 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 text-xs font-bold transition-colors">
                                <i class="fa-solid fa-eye mr-1"></i>Lihat Detail
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }

    const modal = document.getElementById('modal-slot-bookings');
    if (modal) modal.classList.remove('hidden');
};

// ============== RESET SCHEDULE FILTERS ==============
window.resetScheduleFilters = function () {
    const selectLab = document.getElementById('filter-lab');
    const selectStatus = document.getElementById('filter-status');
    if (selectLab) selectLab.value = '';
    if (selectStatus) selectStatus.value = '';
    filterLab = '';
    filterStatus = '';
    loadWeeklySchedule();
};

// ============== QUICK BOOK (SMART BOOKING DUA KLIK) ==============
window.quickBook = function (dateStr, jp) {
    // Cek apakah tanggal sudah lewat
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const slotDate = parseLocalDate(dateStr);
    if (slotDate < today) {
        showToast('Peringatan', 'Tidak bisa booking di tanggal yang sudah lewat.', 'warning');
        return;
    }

    // Jika belum ada selection, simpan sebagai selection pertama
    if (!smartBookingSelection) {
        smartBookingSelection = { dateStr, jp };
        updateQuickBookBanner(dateStr, jp);
        showToast('Info', `Slot JP ${jp} dipilih. Klik slot akhir di hari yang sama.`, 'info');
        highlightSmartSelection();
        return;
    }

    // Jika sudah ada selection dan di hari yang sama
    if (smartBookingSelection.dateStr === dateStr) {
        const startJP = Math.min(smartBookingSelection.jp, jp);
        const endJP = Math.max(smartBookingSelection.jp, jp);

        // Tutup banner panduan
        hideQuickBookBanner();

        // Buka modal booking dan prefill
        openBookingModal(dateStr, startJP, endJP);

        // Reset selection
        clearSmartSelection();
    } else {
        // Hari berbeda, reset dan mulai selection baru di hari yang baru
        smartBookingSelection = { dateStr, jp };
        updateQuickBookBanner(dateStr, jp);
        showToast('Info', `Hari berbeda - pemilihan direset ke ${formatDate(dateStr)} (JP ${jp}). Klik slot kedua di hari yang sama.`, 'warning');
        highlightSmartSelection();
    }
};

function updateQuickBookBanner(dateStr, jp) {
    const banner = document.getElementById('quickbook-banner');
    const textEl = document.getElementById('quickbook-banner-text');
    if (!banner || !textEl) return;

    const d = parseLocalDate(dateStr);
    const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const dayName = dayNames[d.getDay()] || '';

    textEl.textContent = `Memilih rentang booking: JP ${jp} (${dayName}, ${d.getDate()}/${d.getMonth() + 1}) terpilih. Klik slot lain di hari yang sama untuk menentukan akhir JP.`;
    banner.classList.remove('hidden');
    banner.classList.add('flex');
}

function hideQuickBookBanner() {
    const banner = document.getElementById('quickbook-banner');
    if (banner) {
        banner.classList.add('hidden');
        banner.classList.remove('flex');
    }
}

// Highlight slot yang sudah dipilih
function highlightSmartSelection() {
    const weekValue = document.getElementById('select-week')?.value;
    if (weekValue) {
        const weekDates = getWeekDates(weekValue);
        renderScheduleMatrix(weekDates);
    }
}

// Clear smart selection dan re-render
function clearSmartSelection() {
    smartBookingSelection = null;
    hideQuickBookBanner();
    const weekValue = document.getElementById('select-week')?.value;
    if (weekValue) {
        const weekDates = getWeekDates(weekValue);
        renderScheduleMatrix(weekDates);
    }
}

// Cancel smart selection (untuk reset manual via tombol atau escape)
window.cancelSmartSelection = function () {
    if (smartBookingSelection) {
        clearSmartSelection();
        showToast('Info', 'Pemilihan rentang booking dibatalkan.', 'info');
    }
};

// Highlight range slot antara selection awal dan posisi hover
window.highlightRange = function (hoverDateStr, hoverJP) {
    if (!smartBookingSelection || smartBookingSelection.dateStr !== hoverDateStr) return;

    const startJP = smartBookingSelection.jp;
    const minJP = Math.min(startJP, hoverJP);
    const maxJP = Math.max(startJP, hoverJP);

    document.querySelectorAll('td[data-date][data-jp]').forEach(td => {
        const tdDate = td.getAttribute('data-date');
        const tdJP = parseInt(td.getAttribute('data-jp'));

        if (tdDate === hoverDateStr && tdJP >= minJP && tdJP <= maxJP) {
            if (tdJP === startJP) {
                td.classList.add('bg-blue-600', 'text-white');
            } else {
                td.classList.add('bg-blue-100', 'dark:bg-blue-900/50');
            }
        }
    });
};

// Clear highlight range saat mouse out
window.clearRangeHighlight = function () {
    if (!smartBookingSelection) return;

    document.querySelectorAll('td[data-date][data-jp]').forEach(td => {
        const tdDate = td.getAttribute('data-date');
        const tdJP = parseInt(td.getAttribute('data-jp'));

        if (!(smartBookingSelection.dateStr === tdDate && smartBookingSelection.jp === tdJP)) {
            td.classList.remove('bg-blue-100', 'dark:bg-blue-900/50');
        }
    });
};

// ============== OPEN BOOKING MODAL ==============
function openBookingModal(dateStr = null, startJP = null, endJP = null) {
    const modal = document.getElementById('modal-booking');
    if (!modal) return;

    // Reset form fields
    const kelasSelect = document.getElementById('booking-kelas');
    if (kelasSelect) kelasSelect.value = '';

    const kelasManual = document.getElementById('booking-kelas-manual');
    if (kelasManual) kelasManual.value = '';

    const manualContainer = document.getElementById('booking-kelas-manual-container');
    if (manualContainer) manualContainer.classList.add('hidden');

    const kegiatanInput = document.getElementById('booking-kegiatan');
    if (kegiatanInput) kegiatanInput.value = '';

    const catatanInput = document.getElementById('booking-catatan');
    if (catatanInput) catatanInput.value = '';

    const conflictPreview = document.getElementById('conflict-preview');
    if (conflictPreview) conflictPreview.classList.add('hidden');

    // Reset badge & hint otomatis XML mapel
    const badgeEl = document.getElementById('booking-mapel-badge');
    if (badgeEl) badgeEl.classList.add('hidden');
    const hintEl = document.getElementById('booking-mapel-hint');
    if (hintEl) {
        hintEl.classList.add('hidden');
        hintEl.innerHTML = '';
    }

    // Reset mode edit
    window.editingBookingId = null;
    const submitBtn = document.getElementById('btn-submit-booking');
    if (submitBtn) {
        submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane mr-1"></i>Ajukan';
    }

    // Prefill laboratorium jika filterLab sedang aktif di kalender
    const labSelect = document.getElementById('booking-lab');
    if (labSelect && typeof filterLab !== 'undefined' && filterLab) {
        labSelect.value = filterLab;
    }

    // Prefill tanggal
    const dateInput = document.getElementById('booking-date');
    if (dateInput) {
        if (dateStr) {
            dateInput.value = dateStr;
        } else {
            const today = (typeof window.getLocalISODate === 'function')
                ? window.getLocalISODate(new Date())
                : new Date().toISOString().split('T')[0];
            dateInput.value = today;
        }
    }

    // Prefill JP Mulai & Selesai
    const startSelect = document.getElementById('booking-start-jp');
    const endSelect = document.getElementById('booking-end-jp');

    if (startSelect && startJP) {
        startSelect.value = String(startJP);
        // Dispatch change event agar dropdown end-jp terfilter hanya slot >= startJP
        startSelect.dispatchEvent(new Event('change'));
    }

    if (endSelect && endJP) {
        endSelect.value = String(endJP);
        endSelect.dispatchEvent(new Event('change'));
    }

    // Periksa potensi konflik jadwal secara proaktif jika data slot sudah terisi
    if (typeof checkBookingConflict === 'function') {
        checkBookingConflict();
    }

    // Auto-fill mapel dari jadwal jika ada
    if (typeof autoFillSubjectFromSchedule === 'function') {
        autoFillSubjectFromSchedule();
    }

    // Tampilkan modal booking
    modal.classList.remove('hidden');
}

window.openBookingModal = openBookingModal;

// ============== SUBMIT BOOKING ==============
window.submitBooking = async function () {
    const labId = document.getElementById('booking-lab').value;
    const dateStr = document.getElementById('booking-date').value;
    const startJP = parseInt(document.getElementById('booking-start-jp').value);
    const endJP = parseInt(document.getElementById('booking-end-jp').value);
    let kelas = document.getElementById('booking-kelas').value;
    // Handle Manual Class Input
    if (kelas === 'Lainnya') {
        kelas = document.getElementById('booking-kelas-manual').value.trim();
        if (!kelas) {
            showToast('Peringatan', 'Silakan isi nama kelas / keterangan.', 'warning');
            document.getElementById('booking-kelas-manual').focus();
            return;
        }
    }

    const kegiatan = document.getElementById('booking-kegiatan').value.trim();
    const catatan = document.getElementById('booking-catatan').value.trim();

    // Validation
    if (!labId || !dateStr || !startJP || !endJP || !kelas || !kegiatan) {
        showToast('Peringatan', 'Mohon lengkapi semua field yang wajib.', 'warning');
        return;
    }

    if (endJP < startJP) {
        showToast('Peringatan', 'Jam selesai harus >= jam mulai.', 'warning');
        return;
    }

    // Check if weekend
    const bookingDate = parseLocalDate(dateStr);
    const dayOfWeek = bookingDate.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
        showToast('Peringatan', 'Tidak bisa booking di hari Sabtu/Minggu.', 'warning');
        return;
    }

    // Check if date is in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (bookingDate < today) {
        showToast('Peringatan', 'Tidak bisa booking di tanggal yang sudah lewat.', 'warning');
        return;
    }

    const btn = document.getElementById('btn-submit-booking');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-2"></i>Memproses...';
    btn.disabled = true;

    try {
        // Check for conflicts
        const bookingsOnDate = await cfClient.getLabBookings({
            tanggal: dateStr,
            labId: labId
        });

        let hasConflict = false;
        (bookingsOnDate || []).forEach(b => {
            if (!['pending', 'approved', 'conflict'].includes(b.status)) return;

            // Jika sedang edit, skip booking yang sedang diedit sendiri
            if (window.editingBookingId && b.id === window.editingBookingId) {
                return;
            }

            // Check if time slots overlap
            if (!(endJP < b.jam_mulai || startJP > b.jam_selesai)) {
                hasConflict = true;
            }
        });

        const labName = labsList.find(l => l.id === labId)?.nama || 'Lab';
        const userName = currentUser.displayName || localStorage.getItem(`cached_user_name_${currentUser.uid}`) || currentUser.email.split('@')[0];

        const payload = {
            lab_id: labId,
            lab_nama: labName,
            tanggal: dateStr,
            jam_mulai: startJP,
            jam_selesai: endJP,
            kelas: kelas,
            kegiatan: kegiatan,
            catatan: catatan,
            status: hasConflict ? 'conflict' : 'pending',
            pemohon_nama: userName
        };

        // Check if editing existing booking
        if (window.editingBookingId) {
            // UPDATE existing booking via D1
            await cfClient.saveLabBooking(payload, true, window.editingBookingId);

            if (typeof window.logAudit === 'function') {
                window.logAudit('UPDATE_LAB_BOOKING', window.editingBookingId, null, { lab_nama: labName, tanggal: dateStr, kelas, kegiatan, status: hasConflict ? 'conflict' : 'pending' }, `Memperbarui pengajuan booking lab: ${kegiatan} oleh ${kelas} via D1`);
            }

            showToast('Berhasil', 'Booking berhasil diperbarui.', 'success');
            window.editingBookingId = null;
        } else {
            // CREATE new booking via D1
            await cfClient.saveLabBooking(payload, false);

            if (typeof window.logAudit === 'function') {
                window.logAudit('CREATE_LAB_BOOKING', labId, null, { lab_nama: labName, tanggal: dateStr, kelas, kegiatan, status: hasConflict ? 'conflict' : 'pending' }, `Mengajukan booking lab baru: ${kegiatan} oleh ${kelas} via D1`);
            }

            showToast('Berhasil', hasConflict
                ? 'Booking diajukan dengan status BENTROK. Kepala Lab akan menentukan prioritas.'
                : 'Booking berhasil diajukan. Menunggu persetujuan Kepala Lab.',
                hasConflict ? 'warning' : 'success'
            );

            // Tampilkan popup WA Kepala Lab secara otomatis setelah booking baru berhasil dibuat (sebagai follow-up manual cepat jika diperlukan)
            if (kepalaLabList && kepalaLabList.length > 0) {
                showWAKepalaLabModal(labName, dateStr, startJP, endJP, kegiatan);
            }
        }

        // Reset form
        document.getElementById('booking-kelas').value = '';
        document.getElementById('booking-kegiatan').value = '';
        document.getElementById('booking-catatan').value = '';

        // Reset tombol submit ke default
        btn.innerHTML = '<i class="fa-solid fa-paper-plane mr-1"></i>Ajukan';

        // Close modal and refresh jadwal
        closeModal('modal-booking');
        await loadWeeklySchedule();

        // Refresh pending badge
        if (isKepalaLab || currentRole === 'super_admin') {
            await loadPendingBookings();
        }

    } catch (e) {
        console.error('Error submitting booking:', e);
        showToast('Error', 'Gagal mengajukan booking: ' + e.message, 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

// ============== SHOW BOOKING DETAIL ==============
window.showBookingDetail = async function (bookingId) {
    try {
        let b = weeklyBookings.find(x => x.id === bookingId);
        if (!b) {
            const list = await cfClient.getLabBookings({ limit: 200 });
            b = (list || []).find(x => x.id === bookingId);
        }

        if (!b) {
            showToast('Error', 'Data booking tidak ditemukan.', 'error');
            return;
        }

        const jpInfo = JAM_PELAJARAN.find(j => j.jp === Number(b.jam_mulai));
        const jpEndInfo = JAM_PELAJARAN.find(j => j.jp === Number(b.jam_selesai));

        // Simpan data booking untuk kebutuhan WhatsApp follow-up dan aksi modal
        window.pendingBookingDetailData = b;
        window.pendingBookingForWA = {
            labName: b.lab_nama,
            tanggal: b.tanggal,
            jpMulai: b.jam_mulai,
            jpSelesai: b.jam_selesai,
            kegiatan: b.kegiatan
        };

        const statusBadge = {
            'pending': '<span class="px-2 py-1 bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400 rounded text-xs font-bold">Pending</span>',
            'approved': '<span class="px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded text-xs font-bold">Approved</span>',
            'rejected': '<span class="px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded text-xs font-bold">Rejected</span>',
            'conflict': '<span class="px-2 py-1 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 rounded text-xs font-bold">Bentrok</span>',
            'cancelled': '<span class="px-2 py-1 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded text-xs font-bold">Dibatalkan</span>',
            'auto_rejected': '<span class="px-2 py-1 bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400 rounded text-xs font-bold">Ditolak Sistem</span>'
        };

        const content = document.getElementById('modal-booking-content');
        content.innerHTML = `
            <div class="space-y-3">
                <div class="flex justify-between items-center">
                    <span class="text-xs text-slate-500">Status</span>
                    ${statusBadge[b.status] || ''}
                </div>
                <div>
                    <span class="text-xs text-slate-500 block">Lab</span>
                    <span class="font-bold text-slate-800">${escapeHtml(b.lab_nama)}</span>
                </div>
                <div>
                    <span class="text-xs text-slate-500 block">Tanggal</span>
                    <span class="font-bold text-slate-800">${formatDate(b.tanggal)}</span>
                </div>
                <div>
                    <span class="text-xs text-slate-500 block">Waktu</span>
                    <span class="font-bold text-slate-800">JP ${b.jam_mulai} - JP ${b.jam_selesai} (${jpInfo?.mulai || ''} - ${jpEndInfo?.selesai || ''})</span>
                </div>
                <div>
                    <span class="text-xs text-slate-500 block">Kelas</span>
                    <span class="font-bold text-slate-800">${escapeHtml(b.kelas || '-')}</span>
                </div>
                <div>
                    <span class="text-xs text-slate-500 block">Kegiatan</span>
                    <span class="font-bold text-slate-800">${escapeHtml(b.kegiatan)}</span>
                </div>
                <div>
                    <span class="text-xs text-slate-500 block mb-1">Guru Penanggung Jawab Praktikum</span>
                    ${getTeacherBookingAvatar(b, 'detail')}
                </div>
                ${b.catatan ? `<div>
                    <span class="text-xs text-slate-500 block">Catatan</span>
                    <span class="text-slate-600 text-sm">${escapeHtml(b.catatan)}</span>
                </div>` : ''}
                <div>
                    <span class="text-xs text-slate-500 block">Diajukan</span>
                    <span class="text-slate-600 text-sm">${formatTimestamp(b.diajukan_pada || b.created_at)}</span>
                </div>
            </div>
        `;

        // Action buttons
        const actionsDiv = document.getElementById('modal-booking-actions');
        const isOwner = b.pemohon_uid === currentUser.uid;
        const isFullAdminOrKalab = isKepalaLab || isLabAdminUser();
        const isLabCoordinator = isUserCoordinatorForLab(b.lab_id);
        const canManageApproval = isFullAdminOrKalab || isLabCoordinator;

        // Cek apakah tanggal booking belum lewat
        const bookingDate = parseLocalDate(b.tanggal);
        const todayCheck = new Date();
        todayCheck.setHours(0, 0, 0, 0);
        const isFutureBooking = bookingDate >= todayCheck;

        // Batalkan: bisa untuk pending, conflict, DAN approved (selama tanggal belum lewat)
        // Dapat dilakukan oleh pemilik booking (mandiri) maupun pengelola lab (Kepala Lab, Admin, Koordinator Lab)
        const canCancel = (isOwner || isFullAdminOrKalab || isLabCoordinator) && isFutureBooking && ['pending', 'conflict', 'approved'].includes(b.status);
        // Edit: hanya untuk pending dan conflict (karena edit akan reset status ke pending)
        const canEdit = isOwner && isFutureBooking && ['pending', 'conflict'].includes(b.status);

        let actionsHtml = '';

        // Tombol Batalkan untuk pemilik booking
        if (canCancel) {
            actionsHtml += `
                <button onclick="cancelBooking('${bookingId}')" 
                    class="px-4 py-2 rounded-lg font-bold text-red-600 bg-red-50 hover:bg-red-100 transition-colors text-sm">
                    <i class="fa-solid fa-trash mr-1"></i>Batalkan
                </button>
            `;
        }

        // Tombol Edit untuk pemilik booking (hanya pending/conflict)
        if (canEdit) {
            actionsHtml += `
                <button onclick="editBooking('${bookingId}')" 
                    class="px-4 py-2 rounded-lg font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors text-sm">
                    <i class="fa-solid fa-pen mr-1"></i>Edit
                </button>
            `;
        }

        // Tombol Hubungi Pengelola jika booking pending/conflict
        if (isOwner && ['pending', 'conflict'].includes(b.status)) {
            actionsHtml += `
                <button onclick="window.showContactPengelolaModal(window.pendingBookingDetailData)" 
                    class="px-4 py-2 rounded-lg font-bold text-green-600 bg-green-50 hover:bg-green-100 transition-colors text-sm flex items-center gap-1.5">
                    <i class="fa-brands fa-whatsapp"></i>Hubungi Pengelola
                </button>
            `;
        }

        // Tombol Approve dan Reject untuk Pengelola Lab (Kepala Lab, Admin, atau Koordinator Lab terkait)
        if (canManageApproval && ['pending', 'conflict'].includes(b.status)) {
            actionsHtml += `
                <button onclick="rejectBooking('${bookingId}')" 
                    class="px-4 py-2 rounded-lg font-bold text-red-600 bg-red-50 hover:bg-red-100 transition-colors text-sm">
                    <i class="fa-solid fa-times mr-1"></i>Tolak
                </button>
            `;

            // Proteksi Anti-Bentrok: Koordinator dilarang keras menyetujui booking bentrok
            if (b.status === 'conflict' && !isFullAdminOrKalab) {
                actionsHtml += `
                    <button disabled 
                        class="px-4 py-2 rounded-lg font-bold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-700 cursor-not-allowed text-xs flex items-center gap-1.5" title="Booking bentrok hanya dapat diputuskan oleh Kepala Lab atau Admin">
                        <i class="fa-solid fa-lock text-xs"></i> Bentrok (Wewenang Kalab)
                    </button>
                `;
            } else {
                actionsHtml += `
                    <button onclick="approveBooking('${bookingId}')" 
                        class="px-4 py-2 rounded-lg font-bold text-white bg-green-600 hover:bg-green-700 transition-colors text-sm">
                        <i class="fa-solid fa-check mr-1"></i>Setujui
                    </button>
                `;
            }
        }

        // Default: tombol tutup (jika tidak ada aksi lain)
        if (!canCancel && !canEdit && !(canManageApproval && ['pending', 'conflict'].includes(b.status))) {
            actionsHtml = `
                <button onclick="closeModal('modal-booking-detail')" 
                    class="px-4 py-2 rounded-lg font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 transition-colors text-sm">
                    Tutup
                </button>
            `;
        }

        actionsDiv.innerHTML = actionsHtml;

        document.getElementById('modal-booking-detail').classList.remove('hidden');

    } catch (e) {
        console.error('Error showing booking detail:', e);
        showToast('Error', 'Gagal memuat detail booking.', 'error');
    }
};

// ============== EDIT BOOKING ==============
window.editBooking = async function (bookingId) {
    try {
        let b = weeklyBookings.find(x => x.id === bookingId);
        if (!b) {
            const list = await cfClient.getLabBookings({ limit: 200 });
            b = (list || []).find(x => x.id === bookingId);
        }

        if (!b) {
            showToast('Error', 'Booking tidak ditemukan.', 'error');
            return;
        }

        // Tutup modal detail
        closeModal('modal-booking-detail');

        // Buka modal booking dengan data terisi
        openBookingModal(b.tanggal, b.jam_mulai, b.jam_selesai);

        // Isi data lainnya
        document.getElementById('booking-lab').value = b.lab_id;
        
        // Handle dropdown vs manual class input
        const kelasSelect = document.getElementById('booking-kelas');
        const manualContainer = document.getElementById('booking-kelas-manual-container');
        const manualInput = document.getElementById('booking-kelas-manual');
        
        if (b.kelas) {
            if (classList.includes(b.kelas)) {
                kelasSelect.value = b.kelas;
                manualContainer.classList.add('hidden');
                manualInput.value = '';
            } else {
                kelasSelect.value = 'Lainnya';
                manualContainer.classList.remove('hidden');
                manualInput.value = b.kelas;
            }
        } else {
            kelasSelect.value = '';
            manualContainer.classList.add('hidden');
            manualInput.value = '';
        }

        document.getElementById('booking-kegiatan').value = b.kegiatan || '';
        document.getElementById('booking-catatan').value = b.catatan || '';

        // Simpan ID booking yang sedang diedit (untuk update)
        window.editingBookingId = bookingId;

        // Ubah teks tombol submit
        const btnSubmit = document.getElementById('btn-submit-booking');
        btnSubmit.innerHTML = '<i class="fa-solid fa-save mr-1"></i>Simpan Perubahan';

    } catch (e) {
        console.error('Error editing booking:', e);
        showToast('Error', 'Gagal memuat data booking.', 'error');
    }
};

// ============== CANCEL BOOKING ==============
window.cancelBooking = function (bookingId) {
    showConfirmModal(
        'Batalkan Booking',
        'Apakah Anda yakin ingin membatalkan booking ini?',
        'cancel',
        async () => {
            try {
                const targetBooking = window.pendingBookingDetailData || weeklyBookings.find(x => x.id === bookingId);
                const isOwner = targetBooking?.pemohon_uid === currentUser?.uid;
                const reason = isOwner ? 'Dibatalkan oleh pemohon.' : 'Dibatalkan oleh pengelola lab.';
                const actorName = currentUser?.displayName || currentUser?.email || 'Pengguna';

                await cfClient.updateLabBookingStatus(bookingId, 'cancelled', reason, actorName);

                if (typeof window.logAudit === 'function') {
                    window.logAudit('CANCEL_LAB_BOOKING', bookingId, null, { status: 'cancelled' }, `${reason} (${actorName}) via D1`);
                }

                showToast('Berhasil', 'Booking berhasil dibatalkan.', 'success');

                // Tutup modal dan refresh jadwal & riwayat
                closeModal('modal-booking-detail');
                await loadWeeklySchedule();
                await loadMyBookingHistory();

                // Refresh pending jika pengelola lab (admin, kepala lab, atau koordinator lab)
                if (isKepalaLab || currentRole === 'super_admin' || isUserCoordinatorForAnyLab()) {
                    await loadPendingBookings();
                }

            } catch (e) {
                console.error('Error cancelling booking:', e);
                showToast('Error', e.message || 'Gagal membatalkan booking.', 'error');
            }
        }
    );
};

// ============== SHOW CONFLICT DETAIL ==============
window.showConflictDetail = async function (dateStr, jp) {
    // Find all bookings di slot ini (dari semua lab)
    const conflicts = weeklyBookings.filter(b =>
        b.tanggal === dateStr &&
        jp >= b.jam_mulai &&
        jp <= b.jam_selesai &&
        (b.status === 'approved' || b.status === 'pending' || b.status === 'conflict')
    );

    if (conflicts.length === 0) return;

    const content = document.getElementById('modal-booking-content');
    content.innerHTML = `
        <div class="mb-4">
            <p class="text-sm text-slate-600">
                <i class="fa-solid fa-layer-group text-orange-500 mr-1"></i>
                Terdapat <b>${conflicts.length} booking</b> pada slot waktu ini.
            </p>
        </div>
        <div class="space-y-3 max-h-60 overflow-y-auto">
            ${conflicts.map(b => {
        let cardStyle = '';
        let cardClass = '';

        if (b.status === 'approved') {
            const color = getLabColor(b.lab_id);
            cardStyle = `background-color: ${color.bg}; color: ${color.text}; border: 1px solid ${color.border};`;
            cardClass = 'shadow-sm';
        } else {
            cardClass = getStatusClass(b.status);
        }

        return `
                <div class="p-3 border rounded-lg ${cardClass} cursor-pointer hover:opacity-80"
                    style="${cardStyle}"
                    onclick="showBookingDetail('${b.id}')">
                    <div class="flex justify-between items-center mb-1">
                        <p class="text-xs font-bold opacity-90">${escapeHtml(b.lab_nama || 'Lab')}</p>
                        ${b.status === 'pending' ? '<i class="fa-regular fa-clock text-xs" title="Menunggu"></i>' : ''}
                    </div>
                    <p class="font-bold text-sm leading-tight">${escapeHtml(b.kegiatan)}</p>
                    <p class="text-xs opacity-80 mt-1">JP ${b.jam_mulai}-${b.jam_selesai} | ${escapeHtml(b.pemohon_nama)}</p>
                </div>`;
    }).join('')}
        </div>
    `;

    const actionsDiv = document.getElementById('modal-booking-actions');
    actionsDiv.innerHTML = `
        <button onclick="closeModal('modal-booking-detail')" 
            class="px-4 py-2 rounded-lg font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 transition-colors text-sm">
            Tutup
        </button>
    `;

    document.getElementById('modal-booking-detail').classList.remove('hidden');
};

// ============== APPROVE BOOKING ==============
window.approveBooking = function (bookingId) {
    showConfirmModal(
        'Setujui Booking',
        'Apakah Anda yakin ingin menyetujui booking ini?',
        'approve',
        () => executeApproveBooking(bookingId)
    );
};

window.executeApproveBooking = async function (bookingId, forceOverride = false) {
    try {
        let b = weeklyBookings.find(x => x.id === bookingId);
        if (!b) {
            const list = await cfClient.getLabBookings({ limit: 200 });
            b = (list || []).find(x => x.id === bookingId);
        }

        if (!b) {
            showToast('Error', 'Booking tidak ditemukan.', 'error');
            return;
        }

        const isFullAdminOrKalab = isKepalaLab || isLabAdminUser();
        const isLabCoordinator = isUserCoordinatorForLab(b.lab_id);

        if (!isFullAdminOrKalab && !isLabCoordinator) {
            showToast('Ditolak', 'Anda tidak memiliki wewenang untuk menyetujui booking laboratorium ini.', 'error');
            return;
        }

        const bStart = Number(b.jam_mulai);
        const bEnd = Number(b.jam_selesai);

        // CEK DULU: Apakah ada booking yang SUDAH APPROVED di slot yang sama via D1
        const approvedBookings = await cfClient.getLabBookings({
            tanggal: b.tanggal,
            labId: b.lab_id,
            status: 'approved'
        });

        let conflictWithApproved = [];
        (approvedBookings || []).forEach(otherB => {
            if (otherB.id !== bookingId) {
                const oStart = Number(otherB.jam_mulai);
                const oEnd = Number(otherB.jam_selesai);
                if (!(bEnd < oStart || bStart > oEnd)) {
                    conflictWithApproved.push(otherB);
                }
            }
        });

        // Proteksi Anti-Bentrok Koordinator:
        // Koordinator DILARANG KERAS menyetujui booking yang bentrok (conflict status atau overlap dengan approved)
        if (!isFullAdminOrKalab && (b.status === 'conflict' || conflictWithApproved.length > 0)) {
            showToast('Wewenang Terbatas', 'Booking bentrok hanya dapat diputuskan dan disetujui oleh Kepala Laboratorium atau Admin.', 'warning');
            return;
        }

        // Jika ada bentrok dengan yang sudah approved DAN belum force override (khusus Kepala Lab / Admin)
        if (conflictWithApproved.length > 0 && !forceOverride) {
            // Tampilkan konfirmasi khusus
            showReplaceApprovalModal(bookingId, b, conflictWithApproved);
            return;
        }

        // Jika force override = true, reject booking approved yang bentrok
        if (conflictWithApproved.length > 0 && forceOverride) {
            for (const oldBooking of conflictWithApproved) {
                await cfClient.updateLabBookingStatus(oldBooking.id, 'rejected', 'Dibatalkan dan diganti dengan booking prioritas baru.', currentUser.uid);
            }

            if (typeof window.logAudit === 'function') {
                window.logAudit('REJECT_LAB_BOOKING', bookingId, null, { count: conflictWithApproved.length, reason: 'Force override' }, `Membatalkan ${conflictWithApproved.length} booking disetujui untuk prioritas baru via D1`);
            }
        }

        // Cek dan reject booking pending/conflict lain yang bentrok
        const sameSlotBookings = await cfClient.getLabBookings({
            tanggal: b.tanggal,
            labId: b.lab_id
        });

        const conflictsToReject = [];
        (sameSlotBookings || []).forEach(otherB => {
            if (otherB.id !== bookingId && ['pending', 'conflict'].includes(otherB.status)) {
                const oStart = Number(otherB.jam_mulai);
                const oEnd = Number(otherB.jam_selesai);
                if (!(bEnd < oStart || bStart > oEnd)) {
                    conflictsToReject.push(otherB.id);
                }
            }
        });

        if (conflictsToReject.length > 0) {
            for (const id of conflictsToReject) {
                await cfClient.updateLabBookingStatus(id, 'rejected', 'Ditolak otomatis karena slot waktu sudah disetujui untuk booking lain.', currentUser.uid);
            }
            if (typeof window.logAudit === 'function') {
                window.logAudit('REJECT_LAB_BOOKING', bookingId, null, { count: conflictsToReject.length, reason: 'Auto reject conflict' }, `Menolak otomatis ${conflictsToReject.length} booking bentrok via D1`);
            }
        }

        await cfClient.updateLabBookingStatus(bookingId, 'approved', '', currentUser.uid);

        // Tampilkan pesan sukses
        if (forceOverride && conflictWithApproved.length > 0) {
            showToast('Berhasil', `Booking disetujui. ${conflictWithApproved.length} booking sebelumnya diganti.`, 'success');
        } else if (conflictsToReject.length > 0) {
            showToast('Berhasil', `Booking disetujui. ${conflictsToReject.length} booking bentrok lainnya otomatis ditolak.`, 'success');
        } else {
            showToast('Berhasil', 'Booking telah disetujui.', 'success');
        }

        closeModal('modal-booking-detail');
        closeModal('modal-replace-approval');
        await loadWeeklySchedule();
        await loadPendingBookings();

    } catch (e) {
        console.error('Error approving booking:', e);
        showToast('Error', 'Gagal menyetujui booking: ' + e.message, 'error');
    }
}

// ============== MODAL KONFIRMASI GANTI APPROVAL ==============
function showReplaceApprovalModal(bookingId, newBooking, conflictBookings) {
    // Cek apakah modal sudah ada, jika belum buat
    let modal = document.getElementById('modal-replace-approval');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal-replace-approval';
        modal.className = 'hidden fixed inset-0 z-[10000] bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm fade-in';
        modal.innerHTML = `
            <div class="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
                <div class="bg-orange-50 p-4 border-b border-orange-200">
                    <h3 class="font-bold text-orange-800 flex items-center gap-2">
                        <i class="fa-solid fa-triangle-exclamation"></i>
                        Slot Sudah Terisi
                    </h3>
                </div>
                <div class="p-4" id="replace-approval-content"></div>
                <div class="p-4 bg-slate-50 border-t flex justify-end gap-2" id="replace-approval-actions"></div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    const content = document.getElementById('replace-approval-content');
    content.innerHTML = `
        <p class="text-sm text-slate-600 mb-4">
            Slot waktu ini <b>sudah ada booking yang disetujui</b>. Jika Anda melanjutkan, booking lama akan <b>dibatalkan</b> dan diganti dengan booking baru.
        </p>
        
        <div class="space-y-3">
            <div class="p-3 bg-red-50 border border-red-200 rounded-lg">
                <p class="text-xs font-bold text-red-700 mb-1">
                    <i class="fa-solid fa-times-circle mr-1"></i>AKAN DIBATALKAN:
                </p>
                ${conflictBookings.map(cb => `
                    <div class="text-sm text-red-800">
                        • <b>${escapeHtml(cb.kegiatan)}</b> (${escapeHtml(cb.pemohon_nama)})<br>
                        <span class="text-xs text-red-600">JP ${cb.jam_mulai}-${cb.jam_selesai}</span>
                    </div>
                `).join('')}
            </div>
            
            <div class="p-3 bg-green-50 border border-green-200 rounded-lg">
                <p class="text-xs font-bold text-green-700 mb-1">
                    <i class="fa-solid fa-check-circle mr-1"></i>AKAN DISETUJUI:
                </p>
                <div class="text-sm text-green-800">
                    • <b>${escapeHtml(newBooking.kegiatan)}</b> (${escapeHtml(newBooking.pemohon_nama)})<br>
                    <span class="text-xs text-green-600">JP ${newBooking.jam_mulai}-${newBooking.jam_selesai}</span>
                </div>
            </div>
        </div>
    `;

    const actions = document.getElementById('replace-approval-actions');
    actions.innerHTML = `
        <button onclick="closeModal('modal-replace-approval')" 
            class="px-4 py-2 rounded-lg font-bold text-slate-500 hover:bg-slate-100 border border-slate-200 transition-colors text-sm">
            Batal
        </button>
        <button onclick="executeApproveBooking('${bookingId}', true)" 
            class="px-4 py-2 rounded-lg font-bold text-white bg-orange-600 hover:bg-orange-700 shadow-lg transition-transform active:scale-95 text-sm">
            <i class="fa-solid fa-exchange-alt mr-1"></i>Ya, Ganti Prioritas
        </button>
    `;

    modal.classList.remove('hidden');
}

// ============== REJECT BOOKING ==============
window.rejectBooking = function (bookingId) {
    showConfirmModal(
        'Tolak Booking',
        'Apakah Anda yakin ingin menolak booking ini?',
        'reject',
        () => executeRejectBooking(bookingId)
    );
};

async function executeRejectBooking(bookingId) {
    try {
        await cfClient.updateLabBookingStatus(bookingId, 'rejected', 'Ditolak oleh Kepala Lab', currentUser.uid);

        if (typeof window.logAudit === 'function') {
            window.logAudit('REJECT_LAB_BOOKING', bookingId, null, { status: 'rejected' }, 'Menolak pengajuan booking lab via D1');
        }

        showToast('Berhasil', 'Booking telah ditolak.', 'success');
        closeModal('modal-booking-detail');
        await loadWeeklySchedule();
        await loadPendingBookings();

    } catch (e) {
        console.error('Error rejecting booking:', e);
        showToast('Error', 'Gagal menolak booking.', 'error');
    }
}

// ============== CONFIRM MODAL HELPER ==============
function showConfirmModal(title, message, type, onConfirm) {
    const modal = document.getElementById('modal-confirm-action');
    const iconBg = document.getElementById('confirm-icon-bg');
    const icon = document.getElementById('confirm-icon');
    const titleEl = document.getElementById('confirm-title');
    const msgEl = document.getElementById('confirm-msg');
    const btnConfirm = document.getElementById('btn-confirm-action');

    titleEl.textContent = title;
    msgEl.innerHTML = message;

    if (type === 'approve') {
        iconBg.className = 'w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-green-100 dark:bg-green-950/40 text-green-600 dark:text-green-400';
        icon.className = 'fa-solid fa-check text-3xl';
        btnConfirm.className = 'px-5 py-2.5 rounded-lg font-bold text-white bg-green-600 hover:bg-green-700 shadow-lg transition-transform active:scale-95';
        btnConfirm.innerHTML = '<i class="fa-solid fa-check mr-1"></i> Ya, Setujui';
    } else if (type === 'cancel') {
        iconBg.className = 'w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400';
        icon.className = 'fa-solid fa-trash text-3xl';
        btnConfirm.className = 'px-5 py-2.5 rounded-lg font-bold text-white bg-red-600 hover:bg-red-700 shadow-lg transition-transform active:scale-95';
        btnConfirm.innerHTML = '<i class="fa-solid fa-trash mr-1"></i> Ya, Batalkan';
    } else if (type === 'danger') {
        iconBg.className = 'w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400';
        icon.className = 'fa-solid fa-trash-can text-3xl';
        btnConfirm.className = 'px-5 py-2.5 rounded-lg font-bold text-white bg-red-600 hover:bg-red-700 shadow-lg transition-transform active:scale-95';
        btnConfirm.innerHTML = '<i class="fa-solid fa-trash-can mr-1"></i> Ya, Hapus';
    } else {
        iconBg.className = 'w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400';
        icon.className = 'fa-solid fa-times text-3xl';
        btnConfirm.className = 'px-5 py-2.5 rounded-lg font-bold text-white bg-red-600 hover:bg-red-700 shadow-lg transition-transform active:scale-95';
        btnConfirm.innerHTML = '<i class="fa-solid fa-times mr-1"></i> Ya, Tolak';
    }

    // Set callback
    btnConfirm.onclick = () => {
        closeModal('modal-confirm-action');
        onConfirm();
    };

    modal.classList.remove('hidden');
}

// ============== LOAD PENDING BOOKINGS ==============
window.loadPendingBookings = async function () {
    const filterLab = document.getElementById('approval-filter-lab')?.value || '';
    const tbody = document.getElementById('pending-bookings-body');

    try {
        let allList = await cfClient.getLabBookings({
            labId: filterLab,
            limit: 200
        });

        let pendingList = (allList || []).filter(b => ['pending', 'conflict'].includes(b.status));

        // Jika user bukan Kepala Lab & bukan Admin (yakni Koordinator), hanya tampilkan booking lab yang dikoordinasikannya
        const isFullAdminOrKalab = isKepalaLab || isLabAdminUser();
        if (!isFullAdminOrKalab) {
            const myLabIds = getAccessibleLabsForWrite().map(l => l.id);
            pendingList = pendingList.filter(b => myLabIds.includes(b.lab_id));
        }

        const getTsMillis = (val) => {
            if (!val) return 0;
            const ms = new Date(val).getTime();
            return isNaN(ms) ? 0 : ms;
        };

        // Sort in memory by diajukan_pada desc
        pendingList.sort((a, b) => getTsMillis(b.diajukan_pada || b.created_at) - getTsMillis(a.diajukan_pada || a.created_at));

        // Filter: Sembunyikan ajuan yang tanggalnya sudah lewat hari ini
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = window.getLocalISODate(today); // Format YYYY-MM-DD (Local)

        pendingList = pendingList.filter(b => {
            // Jika tanggal ajuan >= hari ini, tampilkan
            return b.tanggal >= todayStr;
        });

        // Update badge
        const badge = document.getElementById('badge-pending');
        if (pendingList.length > 0) {
            badge.textContent = pendingList.length;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }

        if (pendingList.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-slate-400">Tidak ada booking yang menunggu persetujuan.</td></tr>';
            return;
        }

        tbody.innerHTML = pendingList.map(b => {
            const isConflict = b.status === 'conflict';
            const statusBadge = isConflict
                ? '<span class="px-2 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 rounded text-xs font-bold">Bentrok</span>'
                : '<span class="px-2 py-0.5 bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400 rounded text-xs font-bold">Pending</span>';

            const canApproveBooking = isFullAdminOrKalab || (!isConflict && isUserCoordinatorForLab(b.lab_id));

            const approveBtnHtml = canApproveBooking
                ? `<button onclick="approveBooking('${b.id}')" class="w-8 h-8 flex items-center justify-center rounded-lg bg-green-50 hover:bg-green-100 text-green-600 dark:bg-green-900/30 dark:hover:bg-green-900/50 dark:text-green-400 transition-colors" title="Setujui">
                        <i class="fa-solid fa-check"></i>
                   </button>`
                : `<button disabled class="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed opacity-60" title="Booking bentrok hanya dapat diputuskan dan disetujui oleh Kepala Lab / Admin">
                        <i class="fa-solid fa-lock text-xs"></i>
                   </button>`;

            return `<tr class="border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                <td class="p-3 font-medium text-slate-800 dark:text-slate-200">${escapeHtml(b.lab_nama)}</td>
                <td class="p-3">${formatDate(b.tanggal)}</td>
                <td class="p-3">JP ${b.jam_mulai} - ${b.jam_selesai}</td>
                <td class="p-3">${getTeacherBookingAvatar(b, 'table')}</td>
                <td class="p-3">${escapeHtml(b.kegiatan.substring(0, 30))}${b.kegiatan.length > 30 ? '...' : ''}</td>
                <td class="p-3">${statusBadge}</td>
                <td class="p-3 text-center">
                    <div class="flex gap-1 justify-center">
                        <button onclick="showBookingDetail('${b.id}')" class="w-8 h-8 flex items-center justify-center rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 dark:text-blue-400 transition-colors" title="Detail">
                            <i class="fa-solid fa-eye"></i>
                        </button>
                        ${approveBtnHtml}
                        <button onclick="rejectBooking('${b.id}')" class="w-8 h-8 flex items-center justify-center rounded-lg bg-red-50 hover:bg-red-100 text-red-600 dark:bg-red-900/30 dark:hover:bg-red-900/50 dark:text-red-400 transition-colors" title="Tolak">
                            <i class="fa-solid fa-times"></i>
                        </button>
                    </div>
                </td>
            </tr>`;
        }).join('');

    } catch (e) {
        console.error('Error loading pending bookings:', e);
        tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-red-400">Gagal memuat data.</td></tr>';
    }
};

// ============== RIWAYAT WEEK NAVIGATION STATE ==============
let riwayatWeekDate = new Date(); // Tanggal Senin minggu aktif untuk riwayat

// ============== SET CURRENT RIWAYAT WEEK ==============
function setCurrentRiwayatWeek() {
    const now = new Date();
    // Get Monday of current week
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    riwayatWeekDate = new Date(now.setDate(diff));
    updateRiwayatWeekDisplay();
}

function updateRiwayatWeekDisplay() {
    const weekInput = document.getElementById('riwayat-week');
    const weekDisplay = document.getElementById('riwayat-week-display');

    if (!weekInput || !weekDisplay) return;

    // Calculate week value for internal use
    const year = riwayatWeekDate.getFullYear();
    const startOfYear = new Date(year, 0, 1);
    const days = Math.floor((riwayatWeekDate - startOfYear) / 86400000);
    const weekNumber = Math.ceil((days + startOfYear.getDay() + 1) / 7);
    weekInput.value = `${year}-W${String(weekNumber).padStart(2, '0')}`;

    // Get Friday of the week
    const friday = new Date(riwayatWeekDate);
    friday.setDate(riwayatWeekDate.getDate() + 4);

    // Format display in Indonesian
    const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

    const startDay = riwayatWeekDate.getDate();
    const endDay = friday.getDate();
    const startMonth = months[riwayatWeekDate.getMonth()];
    const endMonth = months[friday.getMonth()];
    const startYear = riwayatWeekDate.getFullYear();
    const endYear = friday.getFullYear();

    let displayText;
    if (startMonth === endMonth && startYear === endYear) {
        displayText = `${startDay} - ${endDay} ${endMonth} ${endYear}`;
    } else if (startYear === endYear) {
        displayText = `${startDay} ${startMonth} - ${endDay} ${endMonth} ${endYear}`;
    } else {
        displayText = `${startDay} ${startMonth} ${startYear} - ${endDay} ${endMonth} ${endYear}`;
    }

    weekDisplay.textContent = displayText;
}

window.changeRiwayatWeek = function (direction) {
    riwayatWeekDate.setDate(riwayatWeekDate.getDate() + (direction * 7));
    updateRiwayatWeekDisplay();
    loadMyBookingHistory();
};

window.goToCurrentRiwayatWeek = function () {
    setCurrentRiwayatWeek();
    loadMyBookingHistory();
};

function getRiwayatWeekDates() {
    // Gunakan riwayatWeekDate yang sudah dihitung akurat sebagai Senin minggu aktif
    const monday = new Date(riwayatWeekDate);
    const friday = new Date(riwayatWeekDate);
    friday.setDate(monday.getDate() + 4);

    // Format ke YYYY-MM-DD dengan timezone lokal
    const formatLocalDate = (d) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    return {
        start: formatLocalDate(monday),
        end: formatLocalDate(friday)
    };
}

// ============== LOAD MY BOOKING HISTORY ==============
window.loadMyBookingHistory = async function () {
    const weekDates = getRiwayatWeekDates();
    const status = document.getElementById('riwayat-status').value;
    const ownerFilter = document.getElementById('riwayat-filter-owner')?.value || 'mine';
    const tbody = document.getElementById('history-bookings-body');
    const title = document.getElementById('riwayat-title');

    // Update title based on filter
    if (title) {
        if (ownerFilter === 'all' && (isKepalaLab || currentRole === 'super_admin')) {
            title.innerHTML = '<i class="fa-solid fa-clock-rotate-left text-slate-600"></i> Riwayat Booking Semua Guru';
        } else {
            title.innerHTML = '<i class="fa-solid fa-clock-rotate-left text-slate-600"></i> Riwayat Booking Saya';
        }
    }

    if (!weekDates) {
        tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-slate-400">Pilih minggu untuk melihat riwayat.</td></tr>';
        return;
    }

    try {
        let historyList = await cfClient.getLabBookings({
            weekStart: weekDates.start,
            weekEnd: weekDates.end,
            pemohonUid: (ownerFilter === 'all' && (isKepalaLab || currentRole === 'super_admin')) ? '' : currentUser.uid
        });

        // Sort in memory by tanggal desc then jam_mulai desc
        (historyList || []).sort((a, b) => {
            const cmp = (b.tanggal || '').localeCompare(a.tanggal || '');
            if (cmp !== 0) return cmp;
            return (Number(b.jam_mulai) || 0) - (Number(a.jam_mulai) || 0);
        });

        // Filter by status if specified
        if (status) {
            historyList = historyList.filter(b => b.status === status);
        }

        if (!historyList || historyList.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-slate-400">Tidak ada data dalam minggu tersebut.</td></tr>';
            return;
        }

        tbody.innerHTML = historyList.map(b => {
            const statusBadge = {
                'pending': '<span class="px-2 py-0.5 bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400 rounded text-xs font-bold">Pending</span>',
                'approved': '<span class="px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded text-xs font-bold">Approved</span>',
                'rejected': '<span class="px-2 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded text-xs font-bold">Rejected</span>',
                'conflict': '<span class="px-2 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 rounded text-xs font-bold">Bentrok</span>',
                'cancelled': '<span class="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded text-xs font-bold">Dibatalkan</span>',
                'auto_rejected': '<span class="px-2 py-0.5 bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400 rounded text-xs font-bold">Ditolak Sistem</span>'
            };

            return `<tr onclick="showBookingDetail('${b.id}')" 
                class="border-b border-slate-100 dark:border-slate-700 hover:bg-blue-50/50 dark:hover:bg-slate-700/50 cursor-pointer transition-colors" 
                title="Klik untuk melihat detail atau membatalkan booking">
                <td class="p-3 font-medium text-slate-800 dark:text-slate-200">${escapeHtml(b.lab_nama)}</td>
                <td class="p-3">${formatDate(b.tanggal)}</td>
                <td class="p-3">JP ${b.jam_mulai} - ${b.jam_selesai}</td>
                <td class="p-3">${getTeacherBookingAvatar(b, 'table')}</td>
                <td class="p-3">${escapeHtml((b.kegiatan || '').substring(0, 30))}${(b.kegiatan || '').length > 30 ? '...' : ''}</td>
                <td class="p-3">${statusBadge[b.status] || `<span class="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs">${escapeHtml(b.status || '-')}</span>`}</td>
                <td class="p-3 text-xs text-slate-500 dark:text-slate-400">${b.diproses_pada ? formatTimestamp(b.diproses_pada) : '-'}</td>
            </tr>`;
        }).join('');

    } catch (e) {
        console.error('Error loading history:', e);
        tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-red-400">Gagal memuat data.</td></tr>';
    }
};

// ============== POPULATE LAB FILTERS ==============
function populateLabFilters() {
    const approvalFilter = document.getElementById('approval-filter-lab');
    if (approvalFilter) {
        const cur = approvalFilter.value;
        const approvalLabs = getAccessibleLabsForWrite();
        approvalFilter.innerHTML = '<option value="">Semua Lab</option>' +
            approvalLabs.map(l => `<option value="${window.escapeHTML(l.id)}">${window.escapeHTML(l.nama)}</option>`).join('');
        approvalFilter.value = approvalLabs.some(lab => lab.id === cur) ? cur : '';
    }

    const invFilter = document.getElementById('inv-filter-lab');
    if (invFilter) {
        const cur = invFilter.value;
        invFilter.innerHTML = '<option value="">Semua Lab</option>' +
            labsList.map(l => `<option value="${window.escapeHTML(l.id)}" ${l.id === cur ? 'selected' : ''}>${window.escapeHTML(l.nama)}</option>`).join('');
    }

    const setCatFilter = document.getElementById('setting-category-filter-lab');
    if (setCatFilter) {
        const cur = setCatFilter.value;
        setCatFilter.innerHTML = labsList.map(l => `<option value="${window.escapeHTML(l.id)}" ${l.id === cur ? 'selected' : ''}>${window.escapeHTML(l.nama)}</option>`).join('');
    }

    const setLocFilter = document.getElementById('setting-location-filter-lab');
    if (setLocFilter) {
        const cur = setLocFilter.value;
        setLocFilter.innerHTML = labsList.map(l => `<option value="${window.escapeHTML(l.id)}" ${l.id === cur ? 'selected' : ''}>${window.escapeHTML(l.nama)}</option>`).join('');
    }
}

// ============== LOAD CLASS LIST (REFACTORED: Global Helper) ==============
let classList = [];

async function loadClassList() {
    const select = document.getElementById('booking-kelas');
    if (!select) return;

    try {
        // Gunakan helper global terpusat (hemat Firestore, pakai cache)
        classList = await window.getActiveClasses();

        // Populate dropdown
        select.innerHTML = '<option value="">-- Pilih Kelas --</option>' +
            classList.map(c => `<option value="${window.escapeHTML(c)}">${window.escapeHTML(c)}</option>`).join('') +
            '<option value="Lainnya" class="font-bold text-orange-600 bg-orange-50">Lainnya (Isi Manual)</option>'; // Tambah opsi Lainnya

    } catch (e) {
        console.error('Error loading class list:', e);
    }
}

// ============== HANDLE KELAS CHANGE (MANUAL INPUT) ==============
window.handleKelasChange = function () {
    const select = document.getElementById('booking-kelas');
    const container = document.getElementById('booking-kelas-manual-container');
    const input = document.getElementById('booking-kelas-manual');
    const badgeEl = document.getElementById('booking-mapel-badge');
    const hintEl = document.getElementById('booking-mapel-hint');

    if (!select || !container || !input) return;

    if (select.value === 'Lainnya') {
        container.classList.remove('hidden');
        input.focus();
        if (badgeEl) badgeEl.classList.add('hidden');
        if (hintEl) {
            hintEl.classList.add('hidden');
            hintEl.innerHTML = '';
        }
    } else {
        container.classList.add('hidden');
        input.value = ''; // Reset input manual jika pindah opsi
        autoFillSubjectFromSchedule(true);
    }
};

// ============== UTILITY FUNCTIONS ==============
function escapeHtml(text) {
    if (text == null) return '';
    if (typeof window.escapeHTML === 'function') {
        return window.escapeHTML(text);
    }
    return String(text).replace(/[&<>'"]/g, tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[tag] || tag));
}

function getTsMillis(val) {
    if (!val) return 0;
    if (typeof val.toMillis === 'function') return val.toMillis();
    if (typeof val.seconds === 'number') return val.seconds * 1000;
    if (typeof val === 'number') return val;
    const ms = new Date(val).getTime();
    return isNaN(ms) ? 0 : ms;
}

function parseLocalDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return new Date();
    const parts = dateStr.split('-');
    if (parts.length < 3) return new Date();
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    if (isNaN(year) || isNaN(month) || isNaN(day)) return new Date();
    const d = new Date(year, month, day);
    return isNaN(d.getTime()) ? new Date() : d;
}

function formatDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return '-';
    const d = parseLocalDate(dateStr);
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function formatTimestamp(ts) {
    if (!ts) return '-';
    let d;
    if (typeof ts.toDate === 'function') {
        d = ts.toDate();
    } else if (typeof ts.seconds === 'number') {
        d = new Date(ts.seconds * 1000);
    } else if (typeof ts.toMillis === 'function') {
        d = new Date(ts.toMillis());
    } else {
        d = new Date(ts);
    }
    if (!d || isNaN(d.getTime())) return '-';
    const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Make switchTab available globally (already inline in HTML but backup)
window.switchTab = window.switchTab || function (tab) {
    document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.remove('active', 'bg-blue-600', 'text-white');
        b.classList.add('bg-slate-100', 'text-slate-600');
    });
    const activeBtn = document.querySelector(`[data-tab="${tab}"]`);
    if (activeBtn) {
        activeBtn.classList.add('active', 'bg-blue-600', 'text-white');
        activeBtn.classList.remove('bg-slate-100', 'text-slate-600');
    }

    // Updated: 'booking' is now a modal, removing from tabs
    ['jadwal', 'approval', 'riwayat'].forEach(v => {
        const el = document.getElementById(`view-${v}`);
        if (el) el.classList.add('hidden');
    });

    const targetEl = document.getElementById(`view-${tab}`);
    if (targetEl) targetEl.classList.remove('hidden');
};

// ============== FILTER FUNCTIONS ==============
window.applyFilters = function () {
    const labEl = document.getElementById('filter-lab');
    const statusEl = document.getElementById('filter-status');
    filterLab = labEl ? labEl.value : '';
    filterStatus = statusEl ? statusEl.value : '';

    const weekValue = document.getElementById('select-week')?.value;
    if (weekValue) {
        const weekDates = getWeekDates(weekValue);
        renderScheduleMatrix(weekDates);
        renderLabLegend();
        renderMobileListView();
    } else {
        loadWeeklySchedule();
    }
};

function populateFilterLabOptions() {
    const select = document.getElementById('filter-lab');
    if (!select) return;

    const cur = select.value;
    let html = '<option value="">Semua Lab</option>';
    labsList.forEach(lab => {
        html += `<option value="${escapeHtml(lab.id)}">${escapeHtml(lab.nama)}</option>`;
    });
    select.innerHTML = html;
    select.value = labsList.some(lab => lab.id === cur) ? cur : '';
    filterLab = select.value;
}

function getFilteredBookings() {
    let filtered = [...weeklyBookings];

    if (filterLab) {
        filtered = filtered.filter(b => b.lab_id === filterLab);
    }

    if (filterStatus) {
        filtered = filtered.filter(b => b.status === filterStatus);
    }

    return filtered;
}

// ============== LAB LEGEND ==============
function renderLabLegend() {
    const container = document.getElementById('lab-legend-items');
    if (!container) return;

    // Tampilkan seluruh lab yang terdaftar
    const activeLabs = labsList && labsList.length > 0
        ? labsList
        : [...new Set(weeklyBookings.map(b => b.lab_id))].map(id => {
            const b = weeklyBookings.find(x => x.lab_id === id);
            return { id, nama: b?.lab_nama || 'Lab' };
        });

    if (activeLabs.length === 0) {
        container.innerHTML = '<span class="text-[11px] text-slate-400 dark:text-slate-500 italic">Laboratorium belum dikonfigurasi</span>';
        return;
    }

    let html = '';
    activeLabs.forEach(lab => {
        const color = getLabColor(lab.id);
        const labName = (lab.nama || 'Lab').replace('Laboratorium', 'Lab');

        html += `
            <span class="inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-700/60 text-slate-700 dark:text-slate-200 shadow-2xs">
                <span class="w-2 h-2 rounded-full shrink-0" style="background-color: ${color.accent};"></span>
                <span>${escapeHtml(labName)}</span>
            </span>
        `;
    });

    container.innerHTML = html;
}

// ============== UPDATE SCHEDULE VIEW VISIBILITY ==============
function updateScheduleViewVisibility() {
    const scheduleContainer = document.getElementById('schedule-container');
    const mobileListView = document.getElementById('mobile-list-view');
    const btnToggleText = document.getElementById('btn-toggle-view-text');
    const btnToggleIcon = document.getElementById('btn-toggle-view-icon');

    if (isMobileListView) {
        if (scheduleContainer) scheduleContainer.classList.add('hidden');
        if (mobileListView) mobileListView.classList.remove('hidden');
        if (btnToggleText) btnToggleText.textContent = 'Tabel';
        if (btnToggleIcon) btnToggleIcon.className = 'fa-solid fa-table-cells text-xs';
    } else {
        if (scheduleContainer) scheduleContainer.classList.remove('hidden');
        if (mobileListView) mobileListView.classList.add('hidden');
        if (btnToggleText) btnToggleText.textContent = 'Daftar';
        if (btnToggleIcon) btnToggleIcon.className = 'fa-solid fa-list text-xs';
    }
}

// ============== TOGGLE MOBILE VIEW ==============
window.toggleMobileView = function (forceMode) {
    if (typeof forceMode === 'boolean') {
        isMobileListView = forceMode;
    } else {
        isMobileListView = !isMobileListView;
    }

    try {
        sessionStorage.setItem('simas_elab_view_pref', isMobileListView ? 'list' : 'table');
    } catch (e) {}

    updateScheduleViewVisibility();

    if (isMobileListView) {
        renderMobileListView();
    } else {
        const weekValue = document.getElementById('select-week')?.value;
        if (weekValue) {
            renderScheduleMatrix(getWeekDates(weekValue));
        }
    }
};

// ============== RENDER MOBILE LIST VIEW ==============
function renderMobileListView() {
    const container = document.getElementById('mobile-list-view');
    if (!container) return;

    const filtered = getFilteredBookings().filter(b =>
        b.status === 'approved' || b.status === 'pending' || b.status === 'conflict'
    );

    // KONDISI 1: Tidak ada booking sama sekali di minggu ini
    if (weeklyBookings.length === 0) {
        container.innerHTML = `
            <div class="py-12 px-4 text-center">
                <div class="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-700/60 flex items-center justify-center mx-auto mb-3 text-slate-400">
                    <i class="fa-solid fa-calendar-xmark text-lg"></i>
                </div>
                <h4 class="text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">Tidak Ada Jadwal Booking</h4>
                <p class="text-xs text-slate-400 mb-4">Belum ada peminjaman laboratorium yang diajukan untuk minggu ini.</p>
                <button type="button" onclick="openBookingModal()"
                    class="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs active:scale-95">
                    <i class="fa-solid fa-plus text-[10px]"></i>Ajukan Booking Baru
                </button>
            </div>
        `;
        return;
    }

    // KONDISI 2: Ada booking di minggu ini, tetapi tidak cocok dengan filter aktif
    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="py-10 px-4 text-center">
                <div class="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-700/60 flex items-center justify-center mx-auto mb-3 text-slate-400">
                    <i class="fa-solid fa-filter text-lg"></i>
                </div>
                <h4 class="text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">Tidak Ada Booking yang Cocok</h4>
                <p class="text-xs text-slate-400 mb-3">Tidak ditemukan kegiatan laboratorium yang sesuai dengan filter yang Anda pilih.</p>
                <button type="button" onclick="window.resetScheduleFilters()"
                    class="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold transition-colors">
                    <i class="fa-solid fa-rotate-left mr-1"></i>Reset Filter
                </button>
            </div>
        `;
        return;
    }

    // KONDISI 3: Tampilkan daftar booking yang dikelompokkan per tanggal
    const grouped = {};
    filtered.forEach(b => {
        if (!grouped[b.tanggal]) grouped[b.tanggal] = [];
        grouped[b.tanggal].push(b);
    });

    const sortedDates = Object.keys(grouped).sort();
    const todayStr = window.getLocalISODate(new Date());

    let html = '';
    sortedDates.forEach(dateStr => {
        const dayBookings = grouped[dateStr];
        const d = parseLocalDate(dateStr);
        const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        const dayName = dayNames[d.getDay()] || '';
        const isToday = dateStr === todayStr;

        html += `
            <div class="space-y-2">
                <div class="flex items-center justify-between pb-1 border-b border-slate-100 dark:border-slate-700">
                    <div class="flex items-center gap-1.5">
                        <i class="fa-solid fa-calendar-day text-blue-600 dark:text-blue-400 text-xs"></i>
                        <span class="text-xs font-bold text-slate-700 dark:text-slate-200">${dayName}, ${formatDate(dateStr)}</span>
                        ${isToday ? '<span class="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-blue-500 text-white leading-tight">Hari Ini</span>' : ''}
                    </div>
                    <span class="text-[10px] text-slate-400 font-medium">${dayBookings.length} kegiatan</span>
                </div>
        `;

        dayBookings.sort((a, b) => a.jam_mulai - b.jam_mulai).forEach(b => {
            const labColor = getLabColor(b.lab_id);
            const statusBadge = renderScheduleStatusBadge(b.status);
            const jpInfo = JAM_PELAJARAN.find(j => j.jp === Number(b.jam_mulai));
            const jpEndInfo = JAM_PELAJARAN.find(j => j.jp === Number(b.jam_selesai));

            html += `
                <div class="rounded-xl p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 border-l-4 shadow-2xs space-y-1.5 cursor-pointer active:scale-[0.99] transition-all min-h-[44px]"
                    style="border-left-color: ${labColor.accent};"
                    tabindex="0" role="button" aria-label="Detail booking ${escapeHtml(b.kegiatan)}"
                    onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();showBookingDetail('${b.id}');}"
                    onclick="showBookingDetail('${b.id}')">
                    <div class="flex items-center justify-between gap-2">
                        <span class="font-bold text-xs" style="color: ${labColor.text};">
                            <i class="fa-solid fa-flask text-xs mr-1"></i>${escapeHtml(b.lab_nama)}
                        </span>
                        ${statusBadge}
                    </div>
                    <h4 class="font-bold text-sm text-slate-800 dark:text-slate-100 leading-snug">
                        ${escapeHtml(b.kegiatan)}
                    </h4>
                    <div class="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <span class="inline-flex items-center gap-1.5">${getTeacherBookingAvatar(b, 'compact')}<span>${escapeHtml(b.pemohon_nama)}</span></span>
                        ${b.kelas ? `<span><i class="fa-solid fa-users text-[10px] mr-1 text-slate-400"></i>${escapeHtml(b.kelas)}</span>` : ''}
                        <span><i class="fa-solid fa-clock text-[10px] mr-1 text-slate-400"></i>JP ${b.jam_mulai}-${b.jam_selesai} (${jpInfo?.mulai || ''} - ${jpEndInfo?.selesai || ''})</span>
                    </div>
                </div>
            `;
        });

        html += '</div>';
    });

    container.innerHTML = html;
}

// ============== SHOW WA PENGELOLA LAB MODAL (KOORDINATOR VS KEPALA LAB) ==============
function showWAKepalaLabModal(labName, tanggal, jpMulai, jpSelesai, kegiatan, isConflict = false) {
    const tanggalIndo = formatDate(tanggal);
    const ePin = "📍"; const eCal = "📅"; const eClock = "⏰"; const eBook = "📖"; const ePray = "🙏"; const eWarn = "⚠️";

    const userName = currentUser.displayName || localStorage.getItem(`cached_user_name_${currentUser.uid}`) || currentUser.email.split('@')[0];

    function generateWALink(kepalaLab) {
        let waMessage = `Halo ${kepalaLab.nama},\n\n`;
        if (isConflict) {
            waMessage += `Saya *${userName}* mengajukan jadwal lab yang *BERBENTURAN/BENTROK* dengan pengajuan lain:\n\n`;
        } else {
            waMessage += `Saya *${userName}* baru saja mengajukan booking lab dengan detail:\n\n`;
        }
        waMessage += `${ePin} *Lab:* ${labName}\n`;
        waMessage += `${eCal} *Tanggal:* ${tanggalIndo}\n`;
        waMessage += `${eClock} *Waktu:* JP ${jpMulai} - JP ${jpSelesai}\n`;
        waMessage += `${eBook} *Kegiatan:* ${kegiatan}\n\n`;
        if (isConflict) {
            waMessage += `Mohon arahan dan kebijaksanaan Kepala Lab untuk keputusan jadwal ini. Terima kasih. ${ePray}`;
        } else {
            waMessage += `Mohon konfirmasinya. Terima kasih. ${ePray}`;
        }

        let phoneNumber = (kepalaLab.phone || '').replace(/[^0-9]/g, '');
        if (phoneNumber.startsWith('0')) {
            phoneNumber = '62' + phoneNumber.substring(1);
        }

        let targetUrl = new URL("https://api.whatsapp.com/send");
        targetUrl.searchParams.set("phone", phoneNumber);
        targetUrl.searchParams.set("text", waMessage);
        return targetUrl.toString();
    }

    let waButtonsHtml = '';
    kepalaLabList.forEach((kl, idx) => {
        const waLink = generateWALink(kl);
        waButtonsHtml += `
            <a href="${waLink}" target="_blank" 
                class="w-full bg-green-600 text-white py-3 px-4 rounded-xl font-bold text-center hover:bg-green-700 transition-colors shadow-lg flex items-center justify-center gap-2 ${idx > 0 ? 'mt-2' : ''}">
                <i class="fa-brands fa-whatsapp text-xl"></i>
                Hubungi Kepala Lab: ${escapeHtml(kl.nama)}
            </a>
        `;
    });

    if (kepalaLabList.length === 0) {
        waButtonsHtml = `
            <div class="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-xl text-center text-xs text-amber-700 dark:text-amber-400">
                Nomor WhatsApp Kepala Lab belum terdaftar di sistem. Konfirmasi dapat dilakukan langsung di ruang laboratorium atau via Admin.
            </div>
        `;
    }

    const infoText = isConflict
        ? `Jadwal ini bertabrakan dengan pengajuan lain. Keputusan persetujuan bentrok wewenang eksklusif Kepala Laboratorium.`
        : (kepalaLabList.length === 1
            ? `Hubungi <b>${escapeHtml(kepalaLabList[0].nama)}</b> via WhatsApp untuk mempercepat proses konfirmasi booking anda.`
            : `Pilih salah satu Kepala Lab untuk dihubungi via WhatsApp:`);

    const modalId = 'modal-wa-kepala-lab';
    let modal = document.getElementById(modalId);

    if (!modal) {
        modal = document.createElement('div');
        modal.id = modalId;
        modal.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[10000] p-4';
        document.body.appendChild(modal);
    }

    const headerGradient = isConflict
        ? 'bg-gradient-to-r from-amber-500 to-orange-600'
        : 'bg-gradient-to-r from-purple-600 to-indigo-600';
    const headerTitle = isConflict ? 'Jadwal Bentrok Terdeteksi' : 'Booking Berhasil Diajukan';
    const headerSubtitle = isConflict ? 'Memerlukan Keputusan Kepala Lab' : 'Menunggu Persetujuan Kepala Lab';

    modal.innerHTML = `
        <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full animate-fade-in overflow-hidden max-h-[90vh] flex flex-col border border-slate-100 dark:border-slate-700">
            <!-- Header (compact) -->
            <div class="${headerGradient} p-4 text-white text-center flex-shrink-0">
                <div class="flex items-center justify-center gap-3">
                    <div class="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center text-xl">
                        <i class="fa-solid ${isConflict ? 'fa-triangle-exclamation' : 'fa-circle-check'}"></i>
                    </div>
                    <div class="text-left">
                        <h2 class="text-base font-bold">${headerTitle}</h2>
                        <p class="text-xs opacity-90">${headerSubtitle}</p>
                    </div>
                </div>
            </div>
            
            <!-- Content -->
            <div class="p-5 space-y-3.5 overflow-y-auto flex-1">
                <div class="bg-slate-50 dark:bg-slate-700/40 rounded-xl p-3.5 space-y-1.5 text-xs text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600">
                    <p><i class="fa-solid fa-flask mr-2 text-purple-600"></i><b>${escapeHtml(labName)}</b></p>
                    <p><i class="fa-solid fa-calendar mr-2 text-purple-600"></i>${tanggalIndo}</p>
                    <p><i class="fa-solid fa-clock mr-2 text-purple-600"></i>JP ${jpMulai} - JP ${jpSelesai}</p>
                    <p><i class="fa-solid fa-book mr-2 text-purple-600"></i>${escapeHtml(kegiatan)}</p>
                </div>
                
                <div class="${isConflict ? 'bg-orange-50 border-orange-200 dark:bg-orange-950/30 dark:border-orange-900/50 text-orange-800 dark:text-orange-300' : 'bg-purple-50 border-purple-200 dark:bg-purple-950/30 dark:border-purple-900/50 text-purple-800 dark:text-purple-300'} border rounded-xl p-3">
                    <p class="text-xs font-bold mb-1 flex items-center gap-1.5">
                        <i class="fa-solid fa-circle-info"></i>Informasi Tindak Lanjut
                    </p>
                    <p class="text-[11px]">${infoText}</p>
                </div>
                
                ${waButtonsHtml}
            </div>
            
            <!-- Footer -->
            <div class="p-3.5 bg-slate-50 dark:bg-slate-700/30 border-t border-slate-200 dark:border-slate-700 flex-shrink-0">
                <button onclick="document.getElementById('${modalId}').classList.add('hidden')"
                    class="w-full bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-200 py-2.5 px-4 rounded-xl font-bold text-xs hover:bg-slate-300 transition-colors">
                    Tutup
                </button>
            </div>
        </div>
    `;

    modal.classList.remove('hidden');
}
window.showWAKepalaLabModal = showWAKepalaLabModal;

// Tampilkan Modal WhatsApp Khusus Koordinator Laboratorium
async function showCoordinatorWAModal(lab, booking) {
    if (!lab || !booking) return;

    let coordPhone = '';
    let coordName = lab.koordinator_nama || 'Koordinator Lab';

    // Cari no HP koordinator dari cache guru/users
    try {
        let teachersData = new Map();
        if (typeof window.getTeachersMapCache === 'function') {
            teachersData = await window.getTeachersMapCache();
        }

        const userCoord = teacherUsersList.find(u => u.uid === lab.koordinator_uid);
        if (userCoord) {
            coordPhone = userCoord.phone || '';
            if (userCoord.linkedTeacherId && teachersData.has(userCoord.linkedTeacherId)) {
                const tData = teachersData.get(userCoord.linkedTeacherId);
                if (tData.phone) coordPhone = tData.phone;
                if (tData.name) coordName = tData.name;
            }
        }
    } catch (e) {
        console.warn('[E-Lab] Gagal mencari kontak koordinator:', e);
    }

    // Jika koordinator belum memiliki nomor HP, fallback ke kontak Kepala Lab
    if (!coordPhone) {
        showWAKepalaLabModal(booking.lab_nama || lab.nama, booking.tanggal, booking.jam_mulai, booking.jam_selesai, booking.kegiatan, false);
        return;
    }

    const tanggalIndo = formatDate(booking.tanggal);
    const userName = currentUser.displayName || localStorage.getItem(`cached_user_name_${currentUser.uid}`) || currentUser.email.split('@')[0];
    const ePin = "📍"; const eCal = "📅"; const eClock = "⏰"; const eBook = "📖"; const ePray = "🙏";

    let waMessage = `Halo Pak/Bu ${coordName} (Koordinator ${lab.nama}),\n\n`;
    waMessage += `Saya *${userName}* baru saja mengajukan peminjaman lab:\n\n`;
    waMessage += `${ePin} *Lab:* ${lab.nama}\n`;
    waMessage += `${eCal} *Tanggal:* ${tanggalIndo}\n`;
    waMessage += `${eClock} *Waktu:* JP ${booking.jam_mulai} - JP ${booking.jam_selesai}\n`;
    waMessage += `${eBook} *Kegiatan:* ${booking.kegiatan}\n\n`;
    waMessage += `Mohon konfirmasi dan persetujuannya. Terima kasih. ${ePray}`;

    let phoneNumber = coordPhone.replace(/[^0-9]/g, '');
    if (phoneNumber.startsWith('0')) {
        phoneNumber = '62' + phoneNumber.substring(1);
    }

    let targetUrl = new URL("https://api.whatsapp.com/send");
    targetUrl.searchParams.set("phone", phoneNumber);
    targetUrl.searchParams.set("text", waMessage);

    const modalId = 'modal-wa-koordinator-lab';
    let modal = document.getElementById(modalId);
    if (!modal) {
        modal = document.createElement('div');
        modal.id = modalId;
        modal.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[10000] p-4';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full animate-fade-in overflow-hidden max-h-[90vh] flex flex-col border border-slate-100 dark:border-slate-700">
            <div class="bg-gradient-to-r from-emerald-600 to-teal-600 p-4 text-white text-center flex-shrink-0">
                <div class="flex items-center justify-center gap-3">
                    <div class="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center text-xl">
                        <i class="fa-solid fa-circle-check"></i>
                    </div>
                    <div class="text-left">
                        <h2 class="text-base font-bold">Booking Berhasil Diajukan</h2>
                        <p class="text-xs opacity-90">Menunggu Persetujuan Koordinator Lab</p>
                    </div>
                </div>
            </div>
            
            <div class="p-5 space-y-3.5 overflow-y-auto flex-1">
                <div class="bg-slate-50 dark:bg-slate-700/40 rounded-xl p-3.5 space-y-1.5 text-xs text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600">
                    <p><i class="fa-solid fa-flask mr-2 text-emerald-600"></i><b>${escapeHtml(lab.nama)}</b></p>
                    <p><i class="fa-solid fa-user-check mr-2 text-emerald-600"></i>Koordinator: <b>${escapeHtml(coordName)}</b></p>
                    <p><i class="fa-solid fa-calendar mr-2 text-emerald-600"></i>${tanggalIndo}</p>
                    <p><i class="fa-solid fa-clock mr-2 text-emerald-600"></i>JP ${booking.jam_mulai} - JP ${booking.jam_selesai}</p>
                    <p><i class="fa-solid fa-book mr-2 text-emerald-600"></i>${escapeHtml(booking.kegiatan)}</p>
                </div>
                
                <div class="bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-900/50 rounded-xl p-3 text-emerald-800 dark:text-emerald-300">
                    <p class="text-xs font-bold mb-1"><i class="fa-solid fa-info-circle mr-1"></i>Konfirmasi ke Koordinator</p>
                    <p class="text-[11px]">Hubungi Koordinator Lab via WhatsApp untuk mempercepat konfirmasi jadwal peminjaman.</p>
                </div>
                
                <a href="${targetUrl.toString()}" target="_blank" 
                    class="w-full bg-green-600 text-white py-3 px-4 rounded-xl font-bold text-center hover:bg-green-700 transition-colors shadow-lg flex items-center justify-center gap-2">
                    <i class="fa-brands fa-whatsapp text-xl"></i>
                    Hubungi Koordinator (${escapeHtml(coordName)})
                </a>
            </div>
            
            <div class="p-3.5 bg-slate-50 dark:bg-slate-700/30 border-t border-slate-200 dark:border-slate-700 flex-shrink-0">
                <button onclick="document.getElementById('${modalId}').classList.add('hidden')"
                    class="w-full bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-200 py-2.5 px-4 rounded-xl font-bold text-xs hover:bg-slate-300 transition-colors">
                    Tutup
                </button>
            </div>
        </div>
    `;

    modal.classList.remove('hidden');
}

// Router Pintar: Hubungi Pengelola Lab (Koordinator jika booking biasa, Kepala Lab jika bentrok/tanpa koordinator)
window.showContactPengelolaModal = async function (booking) {
    if (!booking) return;

    // Tutup modal booking detail jika terbuka
    closeModal('modal-booking-detail');

    const lab = labsList.find(l => l.id === booking.lab_id);
    const isConflict = booking.status === 'conflict';

    if (isConflict || !lab?.koordinator_uid) {
        // Arahkan ke Kepala Lab
        showWAKepalaLabModal(booking.lab_nama || lab?.nama || 'Laboratorium', booking.tanggal, booking.jam_mulai, booking.jam_selesai, booking.kegiatan, isConflict);
    } else {
        // Arahkan ke Koordinator Lab
        await showCoordinatorWAModal(lab, booking);
    }
};

// Fungsi legacy backward compatibility jika dipanggil di tempat lain
window.showWAKepalaLabFromDetail = function () {
    const data = window.pendingBookingDetailData || window.pendingBookingForWA;
    if (!data) {
        showToast('Error', 'Data booking tidak ditemukan.', 'error');
        return;
    }
    window.showContactPengelolaModal(data);
};

// ============== TOOLTIP HOVER ==============
function createTooltip() {
    if (document.getElementById('booking-tooltip')) return;

    const tooltip = document.createElement('div');
    tooltip.id = 'booking-tooltip';
    tooltip.className = 'hidden fixed z-[100] bg-slate-900 text-white text-xs rounded-lg p-3 shadow-xl max-w-[200px] pointer-events-none';
    tooltip.innerHTML = '<div id="tooltip-content"></div>';
    document.body.appendChild(tooltip);
}

window.showTooltip = function (event, bookingId) {
    const tooltip = document.getElementById('booking-tooltip');
    const content = document.getElementById('tooltip-content');
    if (!tooltip || !content) return;

    const booking = weeklyBookings.find(b => b.id === bookingId);
    if (!booking) return;

    const statusLabels = { approved: 'Disetujui', pending: 'Menunggu', conflict: 'Bentrok' };
    content.innerHTML = `
        <p class="font-bold mb-1">${escapeHtml(booking.lab_nama || 'Lab')}</p>
        <p class="opacity-80 mb-1"><i class="fa-solid fa-book mr-1"></i>${escapeHtml(booking.kegiatan)}</p>
        <p class="opacity-80 mb-1"><i class="fa-solid fa-user mr-1"></i>${escapeHtml(booking.pemohon_nama)}</p>
        <p class="opacity-80 mb-1"><i class="fa-solid fa-users mr-1"></i>${escapeHtml(booking.kelas || '-')}</p>
        <p class="opacity-80"><i class="fa-solid fa-clock mr-1"></i>JP ${booking.jam_mulai} - ${booking.jam_selesai}</p>
        <p class="mt-1 pt-1 border-t border-white/20 font-bold">${statusLabels[booking.status] || booking.status}</p>
    `;

    tooltip.style.left = (event.pageX + 10) + 'px';
    tooltip.style.top = (event.pageY + 10) + 'px';
    tooltip.classList.remove('hidden');
};

window.hideTooltip = function () {
    const tooltip = document.getElementById('booking-tooltip');
    if (tooltip) tooltip.classList.add('hidden');
};

// Initialize tooltip on load
createTooltip();

// ============== LAB MANAGEMENT (Tab Pengaturan - Super Admin & Kepala Lab only) ==============

// Render Ringkasan Kepala Laboratorium Global di Tab Pengaturan
function renderKalabSummaryUI() {
    const card = document.getElementById('kalab-summary-card');
    if (!card) return;

    // Skenario 1: Tepat 1 akun Kepala Lab
    if (allKepalaLabAccounts.length === 1) {
        const kalab = allKepalaLabAccounts[0];
        card.className = "bg-gradient-to-r from-purple-50 via-indigo-50 to-blue-50 dark:from-purple-950/40 dark:via-indigo-950/30 dark:to-blue-950/30 p-4 rounded-xl border border-purple-100 dark:border-purple-900/40 shadow-sm transition-all";
        card.innerHTML = `
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div class="flex items-center gap-3">
                    <div class="w-11 h-11 rounded-xl bg-purple-600 text-white flex items-center justify-center text-xl font-bold shadow-sm shrink-0">
                        <i class="fa-solid fa-user-tie"></i>
                    </div>
                    <div class="min-w-0">
                        <div class="flex items-center gap-2">
                            <span class="text-xs font-bold uppercase tracking-wider text-purple-700 dark:text-purple-300">Kepala Laboratorium (Global)</span>
                            <span class="text-[10px] px-2 py-0.5 rounded-full bg-purple-200/70 dark:bg-purple-800/60 text-purple-800 dark:text-purple-200 font-bold">Membawahi Seluruh Lab</span>
                        </div>
                        <h4 class="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">${escapeHtml(kalab.nama)}</h4>
                        <div class="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            ${kalab.nip ? `<span>NIP: ${escapeHtml(kalab.nip)}</span>` : ''}
                            ${kalab.email ? `<span>${escapeHtml(kalab.email)}</span>` : ''}
                            ${kalab.phone ? `<span class="text-green-600 dark:text-green-400 font-medium"><i class="fa-brands fa-whatsapp mr-1"></i>${escapeHtml(kalab.phone)}</span>` : ''}
                        </div>
                    </div>
                </div>
                <div class="text-right shrink-0">
                    <span class="text-[11px] bg-white/80 dark:bg-slate-800/80 px-2.5 py-1 rounded-lg border border-purple-200/60 dark:border-purple-800/50 text-purple-700 dark:text-purple-300 font-medium inline-flex items-center gap-1.5">
                        <i class="fa-solid fa-shield-check text-purple-500"></i> Otoritas Penuh Seluruh Lab
                    </span>
                </div>
            </div>
        `;
    } else if (allKepalaLabAccounts.length === 0) {
        // Skenario 2: Belum ada akun Kepala Lab
        card.className = "bg-amber-50 dark:bg-amber-950/30 p-4 rounded-xl border border-amber-200 dark:border-amber-900/50 shadow-sm transition-all";
        card.innerHTML = `
            <div class="flex items-start gap-3">
                <div class="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400 flex items-center justify-center text-lg font-bold shrink-0">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-0.5">
                        <h4 class="text-sm font-bold text-amber-900 dark:text-amber-200">Belum Ada Akun Kepala Laboratorium</h4>
                        <span class="text-[10px] px-2 py-0.5 rounded-full bg-amber-200/80 dark:bg-amber-800/60 text-amber-900 dark:text-amber-200 font-bold">Perlu Perhatian</span>
                    </div>
                    <p class="text-xs text-amber-800 dark:text-amber-300">
                        Tidak ditemukan akun pengguna dengan role <code>kepala_lab</code> di sistem. Seluruh wewenang E-Laboratorium saat ini ditangani langsung oleh Administrator. Tetapkan guru yang ditugaskan sebagai Kepala Lab melalui menu Manajemen Pengguna.
                    </p>
                </div>
            </div>
        `;
    } else {
        // Skenario 3: Ditemukan >1 akun Kepala Lab
        card.className = "bg-orange-50 dark:bg-orange-950/30 p-4 rounded-xl border border-orange-200 dark:border-orange-900/50 shadow-sm transition-all";
        const kalabNames = allKepalaLabAccounts.map(k => `<b>${escapeHtml(k.nama)}</b>`).join(', ');
        card.innerHTML = `
            <div class="flex items-start gap-3">
                <div class="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-900/50 text-orange-600 dark:text-orange-400 flex items-center justify-center text-lg font-bold shrink-0">
                    <i class="fa-solid fa-users-viewfinder"></i>
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-0.5">
                        <h4 class="text-sm font-bold text-orange-900 dark:text-orange-200">Ditemukan Lebih dari Satu Akun Kepala Laboratorium (${allKepalaLabAccounts.length} Akun)</h4>
                        <span class="text-[10px] px-2 py-0.5 rounded-full bg-orange-200/80 dark:bg-orange-800/60 text-orange-900 dark:text-orange-200 font-bold">Perlu Penyesuaian</span>
                    </div>
                    <p class="text-xs text-orange-800 dark:text-orange-300">
                        Secara struktur organisasi, sekolah hanya memiliki satu guru sebagai Kepala Laboratorium yang membawahi seluruh lab. Sistem mendeteksi role <code>kepala_lab</code> aktif pada akun: ${kalabNames}. Harap sesuaikan role pengguna di Manajemen Pengguna.
                    </p>
                </div>
            </div>
        `;
    }
}
window.renderKalabSummaryUI = renderKalabSummaryUI;

// Render daftar lab di tab Pengaturan
function renderManageLabsList() {
    const container = document.getElementById('manage-labs-list');
    if (!container) return;

    renderKalabSummaryUI();

    // Update counter
    const countEl = document.getElementById('manage-labs-count');
    if (countEl) countEl.textContent = `${labsList.length} Lab`;

    if (labsList.length === 0) {
        container.innerHTML = '<div class="text-center text-slate-400 dark:text-slate-500 text-sm py-8">Belum ada laboratorium terdaftar. Klik tombol <b>Tambah Laboratorium</b> di atas untuk menambahkan.</div>';
        return;
    }

    container.innerHTML = labsList.map((lab, idx) => {
        const hasCoordinator = Boolean(lab.koordinator_uid && lab.koordinator_nama);
        const coordinatorHtml = hasCoordinator
            ? `<span class="text-xs text-purple-700 dark:text-purple-300 font-medium inline-flex items-center gap-1.5"><i class="fa-solid fa-user-check text-purple-500 text-[11px]"></i>Koordinator: <b>${escapeHtml(lab.koordinator_nama)}</b></span>`
            : `<span class="text-xs text-slate-400 dark:text-slate-500 italic inline-flex items-center gap-1.5"><i class="fa-solid fa-user-slash text-slate-400 text-[11px]"></i>Koordinator belum ditetapkan</span>`;

        return `
            <div class="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 hover:shadow-sm transition-all gap-3">
                <div class="flex items-start sm:items-center gap-3">
                    <span class="w-8 h-8 flex items-center justify-center bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 rounded-lg text-xs font-bold shrink-0">${idx + 1}</span>
                    <div>
                        <div class="flex items-center gap-2 flex-wrap">
                            <h4 class="font-bold text-slate-800 dark:text-slate-100 text-sm">${escapeHtml(lab.nama)}</h4>
                            ${lab.kode ? `<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-purple-50 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/60">${escapeHtml(lab.kode)}</span>` : ''}
                        </div>
                        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs">
                            ${coordinatorHtml}
                            ${lab.deskripsi ? `<span class="text-slate-500 dark:text-slate-400">• ${escapeHtml(lab.deskripsi)}</span>` : ''}
                        </div>
                    </div>
                </div>
                <div class="flex items-center gap-1 self-end sm:self-center shrink-0">
                    <button onclick="window.openEditLabModal('${escapeHtml(lab.id)}')"
                        class="px-2.5 py-1.5 bg-slate-100 dark:bg-slate-700 hover:bg-purple-50 dark:hover:bg-purple-900/30 text-slate-700 dark:text-slate-300 hover:text-purple-600 dark:hover:text-purple-400 rounded-lg text-xs font-bold transition-colors flex items-center gap-1" title="Edit Laboratorium & Koordinator">
                        <i class="fa-solid fa-pen-to-square text-[11px]"></i> Edit
                    </button>
                    <button onclick="window.moveLabOrder('${escapeHtml(lab.id)}', 'up')" ${idx === 0 ? 'disabled' : ''}
                        class="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-600 dark:text-slate-300 text-xs ${idx === 0 ? 'opacity-30 cursor-not-allowed' : ''}" title="Pindah Naik">
                        <i class="fa-solid fa-chevron-up"></i>
                    </button>
                    <button onclick="window.moveLabOrder('${escapeHtml(lab.id)}', 'down')" ${idx === labsList.length - 1 ? 'disabled' : ''}
                        class="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-600 dark:text-slate-300 text-xs ${idx === labsList.length - 1 ? 'opacity-30 cursor-not-allowed' : ''}" title="Pindah Turun">
                        <i class="fa-solid fa-chevron-down"></i>
                    </button>
                    <button onclick="window.deleteLab('${escapeHtml(lab.id)}', '${escapeHtml(lab.nama)}')" 
                        class="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg text-red-600 dark:text-red-400 text-xs" title="Hapus Laboratorium">
                        <i class="fa-solid fa-trash text-[11px]"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// Buka Modal Tambah Lab Baru
window.openAddLabModal = async function () {
    if (currentRole !== 'super_admin' && !isKepalaLab && !isLabAdminUser()) {
        showToast('Ditolak', 'Hanya Kepala Lab atau Admin yang dapat menambah laboratorium.', 'error');
        return;
    }

    const titleEl = document.getElementById('modal-manage-lab-title');
    if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-flask mr-1.5"></i>Tambah Laboratorium Baru';

    const idInput = document.getElementById('manage-lab-form-id');
    const isEditInput = document.getElementById('manage-lab-form-is-edit');
    const namaInput = document.getElementById('manage-lab-form-nama');
    const kodeInput = document.getElementById('manage-lab-form-kode');
    const deskripsiInput = document.getElementById('manage-lab-form-deskripsi');

    if (idInput) idInput.value = '';
    if (isEditInput) isEditInput.value = '0';
    if (namaInput) namaInput.value = '';
    if (kodeInput) kodeInput.value = '';
    if (deskripsiInput) deskripsiInput.value = '';

    await populateCoordinatorDropdown('');

    const modal = document.getElementById('modal-manage-lab');
    if (modal) modal.classList.remove('hidden');
};

// Buka Modal Edit Lab Eksisting
window.openEditLabModal = async function (labId) {
    if (currentRole !== 'super_admin' && !isKepalaLab && !isLabAdminUser()) {
        showToast('Ditolak', 'Hanya Kepala Lab atau Admin yang dapat mengedit laboratorium.', 'error');
        return;
    }

    const lab = labsList.find(l => l.id === labId);
    if (!lab) {
        showToast('Error', 'Laboratorium tidak ditemukan.', 'error');
        return;
    }

    const titleEl = document.getElementById('modal-manage-lab-title');
    if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-pen-to-square mr-1.5"></i>Edit Laboratorium & Koordinator';

    const idInput = document.getElementById('manage-lab-form-id');
    const isEditInput = document.getElementById('manage-lab-form-is-edit');
    const namaInput = document.getElementById('manage-lab-form-nama');
    const kodeInput = document.getElementById('manage-lab-form-kode');
    const deskripsiInput = document.getElementById('manage-lab-form-deskripsi');

    if (idInput) idInput.value = lab.id;
    if (isEditInput) isEditInput.value = '1';
    if (namaInput) namaInput.value = lab.nama || '';
    if (kodeInput) kodeInput.value = lab.kode || '';
    if (deskripsiInput) deskripsiInput.value = lab.deskripsi || '';

    await populateCoordinatorDropdown(lab.koordinator_uid || '');

    const modal = document.getElementById('modal-manage-lab');
    if (modal) modal.classList.remove('hidden');
};

// ============== SEARCHABLE COMBOBOX KOORDINATOR LAB ==============
let _isLabCoordinatorComboboxInit = false;

function setupLabCoordinatorSearchCombobox() {
    if (_isLabCoordinatorComboboxInit) return;
    const searchInput = document.getElementById('manage-lab-koordinator-search');
    const dropdownList = document.getElementById('manage-lab-koordinator-dropdown');
    const container = document.getElementById('container-manage-lab-koordinator');
    if (!searchInput || !dropdownList) return;

    _isLabCoordinatorComboboxInit = true;

    // Event input pencarian
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        const clearBtn = document.getElementById('manage-lab-koordinator-clear');
        if (clearBtn) {
            if (query.length > 0) clearBtn.classList.remove('hidden');
            else clearBtn.classList.add('hidden');
        }
        renderCoordinatorDropdownOptions(query);
    });

    // Event focus input
    searchInput.addEventListener('focus', () => {
        const query = searchInput.value.trim();
        renderCoordinatorDropdownOptions(query);
    });

    // Menutup dropdown saat klik di luar area
    document.addEventListener('click', (e) => {
        if (container && !container.contains(e.target)) {
            dropdownList.classList.add('hidden');
        }
    });

    // Escape untuk menutup dropdown
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            dropdownList.classList.add('hidden');
        }
    });
}

function renderCoordinatorDropdownOptions(query = '') {
    const dropdownList = document.getElementById('manage-lab-koordinator-dropdown');
    if (!dropdownList) return;

    const currentVal = (document.getElementById('manage-lab-form-koordinator')?.value || '').trim();
    const currentSelectedUid = currentVal.includes('|') ? currentVal.split('|')[0] : currentVal;

    const lowerQuery = query.toLowerCase();
    const filtered = teacherUsersList.filter(t => {
        if (!lowerQuery) return true;
        const nameMatch = (t.name || '').toLowerCase().includes(lowerQuery);
        const emailMatch = (t.email || '').toLowerCase().includes(lowerQuery);
        const nipMatch = (t.nip || '').toLowerCase().includes(lowerQuery);
        const roleMatch = (t.role || '').toLowerCase().includes(lowerQuery);
        return nameMatch || emailMatch || nipMatch || roleMatch;
    });

    let html = `
        <button type="button" onclick="window.clearLabCoordinatorSelection()"
            class="w-full text-left px-3.5 py-2.5 bg-slate-50/80 dark:bg-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-700/60">
            <span class="text-xs text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1.5">
                <i class="fa-solid fa-user-slash text-slate-400 text-[11px]"></i>
                -- Tanpa Koordinator (Kosongkan) --
            </span>
            ${!currentSelectedUid ? '<i class="fa-solid fa-check text-purple-600 dark:text-purple-400 text-xs font-bold"></i>' : ''}
        </button>
    `;

    if (filtered.length === 0) {
        html += `
            <div class="p-4 text-center text-xs text-slate-400 italic">
                <i class="fa-solid fa-user-xmark text-base mb-1 block opacity-60"></i>
                Tidak ditemukan guru dengan kata kunci "${escapeHtml(query)}"
            </div>
        `;
    } else {
        filtered.forEach(t => {
            const isSelected = (t.uid === currentSelectedUid);
            const roleBadge = t.role ? `<span class="px-1.5 py-0.5 rounded text-[10px] bg-purple-50 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/50 uppercase font-mono">${escapeHtml(t.role)}</span>` : '';
            const detailText = t.email || t.nip ? (t.nip ? `NIP. ${escapeHtml(t.nip)}` : escapeHtml(t.email)) : (t.role || '');

            html += `
                <button type="button" onclick="window.selectLabCoordinator('${escapeHtml(t.uid)}', '${escapeHtml(t.name)}', '${escapeHtml(t.email || t.role || '')}')"
                    class="w-full text-left px-3.5 py-2.5 hover:bg-purple-50 dark:hover:bg-purple-900/30 transition-colors flex items-center justify-between gap-2 ${isSelected ? 'bg-purple-50/90 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 font-bold' : 'text-slate-700 dark:text-slate-200'}">
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                            <span class="text-xs font-semibold truncate">${escapeHtml(t.name)}</span>
                            ${roleBadge}
                        </div>
                        ${detailText ? `<div class="text-[10px] text-slate-400 dark:text-slate-400 truncate mt-0.5">${detailText}</div>` : ''}
                    </div>
                    ${isSelected ? '<i class="fa-solid fa-check text-purple-600 dark:text-purple-400 text-xs shrink-0 font-bold"></i>' : ''}
                </button>
            `;
        });
    }

    dropdownList.innerHTML = html;
    dropdownList.classList.remove('hidden');
}

window.selectLabCoordinator = function (uid, name, detail) {
    const hiddenInput = document.getElementById('manage-lab-form-koordinator');
    const searchInput = document.getElementById('manage-lab-koordinator-search');
    const dropdownList = document.getElementById('manage-lab-koordinator-dropdown');
    const clearBtn = document.getElementById('manage-lab-koordinator-clear');

    if (hiddenInput) hiddenInput.value = `${uid}|${name}`;
    if (searchInput) searchInput.value = detail ? `${name} (${detail})` : name;
    if (clearBtn) clearBtn.classList.remove('hidden');
    if (dropdownList) dropdownList.classList.add('hidden');
};

window.clearLabCoordinatorSelection = function () {
    const hiddenInput = document.getElementById('manage-lab-form-koordinator');
    const searchInput = document.getElementById('manage-lab-koordinator-search');
    const dropdownList = document.getElementById('manage-lab-koordinator-dropdown');
    const clearBtn = document.getElementById('manage-lab-koordinator-clear');

    if (hiddenInput) hiddenInput.value = '';
    if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
    }
    if (clearBtn) clearBtn.classList.add('hidden');
    if (dropdownList) dropdownList.classList.add('hidden');
};

// Isi Dropdown Pilihan Koordinator dari Guru Berakun
async function populateCoordinatorDropdown(selectedUid = '') {
    setupLabCoordinatorSearchCombobox();

    const hiddenInput = document.getElementById('manage-lab-form-koordinator');
    const searchInput = document.getElementById('manage-lab-koordinator-search');
    const clearBtn = document.getElementById('manage-lab-koordinator-clear');
    const dropdownList = document.getElementById('manage-lab-koordinator-dropdown');

    if (dropdownList) dropdownList.classList.add('hidden');

    if (teacherUsersList.length === 0) {
        await loadTeacherUsersList();
    }

    if (selectedUid) {
        const found = teacherUsersList.find(t => t.uid === selectedUid);
        if (found) {
            if (hiddenInput) hiddenInput.value = `${found.uid}|${found.name}`;
            if (searchInput) searchInput.value = `${found.name} (${found.email || found.role || ''})`;
            if (clearBtn) clearBtn.classList.remove('hidden');
        } else {
            if (hiddenInput) hiddenInput.value = selectedUid;
            if (searchInput) searchInput.value = selectedUid;
            if (clearBtn) clearBtn.classList.remove('hidden');
        }
    } else {
        if (hiddenInput) hiddenInput.value = '';
        if (searchInput) searchInput.value = '';
        if (clearBtn) clearBtn.classList.add('hidden');
    }
}
window.populateCoordinatorDropdown = populateCoordinatorDropdown;

// Submit Form Kelola Laboratorium (Tambah / Edit)
window.submitManageLabForm = async function (event) {
    if (event) event.preventDefault();

    if (currentRole !== 'super_admin' && !isKepalaLab && !isLabAdminUser()) {
        showToast('Ditolak', 'Hanya Kepala Lab atau Admin yang berhak menyimpan laboratorium.', 'error');
        return;
    }

    const id = (document.getElementById('manage-lab-form-id')?.value || '').trim();
    const isEdit = document.getElementById('manage-lab-form-is-edit')?.value === '1';
    const nama = (document.getElementById('manage-lab-form-nama')?.value || '').trim();
    const rawKode = (document.getElementById('manage-lab-form-kode')?.value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const kode = rawKode || nama.substring(0, 3).toUpperCase() || 'LAB';
    const deskripsi = (document.getElementById('manage-lab-form-deskripsi')?.value || '').trim();
    const coordVal = (document.getElementById('manage-lab-form-koordinator')?.value || '').trim();

    if (!nama) {
        showToast('Peringatan', 'Nama laboratorium wajib diisi!', 'warning');
        return;
    }

    let koordinatorUid = null;
    let koordinatorNama = null;
    if (coordVal && coordVal.includes('|')) {
        const parts = coordVal.split('|');
        koordinatorUid = parts[0] || null;
        koordinatorNama = parts[1] || null;
    }

    // Cek duplikasi nama pada lab lain
    const duplicate = labsList.find(l => l.nama.toLowerCase() === nama.toLowerCase() && l.id !== id);
    if (duplicate) {
        showToast('Peringatan', 'Laboratorium dengan nama tersebut sudah ada!', 'warning');
        return;
    }

    const submitBtn = document.getElementById('btn-submit-manage-lab');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Menyimpan...';
    }

    try {
        if (isEdit && id) {
            const existingLab = labsList.find(l => l.id === id);
            await cfClient.saveLab({
                nama: nama,
                kode: kode,
                deskripsi: deskripsi,
                urutan: existingLab ? existingLab.urutan : 0,
                koordinator_uid: koordinatorUid,
                koordinator_nama: koordinatorNama
            }, true, id);

            if (typeof window.logAudit === 'function') {
                window.logAudit('UPDATE_LAB', id, existingLab, { nama, kode, koordinator_nama: koordinatorNama }, `Memperbarui lab: ${nama} (${kode})`);
            }
            showToast('Berhasil', `Laboratorium "${nama}" berhasil diperbarui.`, 'success');
        } else {
            const nextUrutan = labsList.length > 0 ? Math.max(...labsList.map(l => l.urutan || 0)) + 1 : 1;
            await cfClient.saveLab({
                nama: nama,
                kode: kode,
                deskripsi: deskripsi,
                urutan: nextUrutan,
                koordinator_uid: koordinatorUid,
                koordinator_nama: koordinatorNama
            }, false);

            if (typeof window.logAudit === 'function') {
                window.logAudit('CREATE_LAB', nama, null, { nama, kode, koordinator_nama: koordinatorNama }, `Menambahkan lab baru: ${nama} (${kode})`);
            }
            showToast('Berhasil', `Laboratorium "${nama}" berhasil ditambahkan.`, 'success');
        }

        safeCloseModal('modal-manage-lab');
        sessionStorage.removeItem('simas_elab_labs_cache');
        localStorage.removeItem('simas_elab_labs_cache');
        await loadLabs(true);
    } catch (e) {
        console.error('Error saving lab:', e);
        showToast('Error', 'Gagal menyimpan laboratorium: ' + e.message, 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk mr-1"></i>Simpan Laboratorium';
        }
    }
};

// Hapus Lab
window.deleteLab = async function (labId, labName) {
    // Otorisasi: hanya super_admin atau kepala_lab yang boleh
    if (currentRole !== 'super_admin' && !isKepalaLab && !isLabAdminUser()) {
        showToast('Ditolak', 'Anda tidak memiliki akses untuk menghapus lab.', 'error');
        return;
    }

    showConfirmModal(
        'Hapus Laboratorium',
        `Yakin ingin menghapus <b>"${escapeHtml(labName)}"</b>?<br><br>Lab akan dihapus dari daftar, namun booking yang sudah ada tidak terhapus.`,
        'danger',
        async () => {
            try {
                await cfClient.deleteLab(labId);

                if (typeof window.logAudit === 'function') {
                    window.logAudit('DELETE_LAB', labId, { nama: labName }, null, `Menghapus laboratorium: ${labName} dari D1`);
                }

                showToast('Berhasil', `Lab "${labName}" berhasil dihapus.`, 'success');
                sessionStorage.removeItem('simas_elab_labs_cache');
                await loadLabs(true); // Reload labs dan re-render semua
            } catch (e) {
                console.error('Error deleting lab:', e);
                showToast('Error', 'Gagal menghapus lab: ' + e.message, 'error');
            }
        }
    );
};

// Ubah Urutan Lab
window.moveLabOrder = async function (labId, direction) {
    // Otorisasi: hanya super_admin atau kepala_lab yang boleh
    if (currentRole !== 'super_admin' && !isKepalaLab && !isLabAdminUser()) {
        showToast('Ditolak', 'Anda tidak memiliki akses untuk mengubah urutan lab.', 'error');
        return;
    }

    const idx = labsList.findIndex(l => l.id === labId);
    if (idx === -1) return;

    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= labsList.length) return;

    try {
        const currentLab = labsList[idx];
        const swapLab = labsList[swapIdx];

        await cfClient.saveLab({ nama: currentLab.nama, deskripsi: currentLab.deskripsi || '', urutan: swapLab.urutan || swapIdx + 1, koordinator_uid: currentLab.koordinator_uid, koordinator_nama: currentLab.koordinator_nama }, true, currentLab.id);
        await cfClient.saveLab({ nama: swapLab.nama, deskripsi: swapLab.deskripsi || '', urutan: currentLab.urutan || idx + 1, koordinator_uid: swapLab.koordinator_uid, koordinator_nama: swapLab.koordinator_nama }, true, swapLab.id);

        sessionStorage.removeItem('simas_elab_labs_cache');
        await loadLabs(true); // Reload labs dan re-render semua

    } catch (e) {
        console.error('Error moving lab:', e);
        showToast('Error', 'Gagal mengubah urutan.', 'error');
    }
};

// =========================================================================
// 📦 E-LABORATORIUM INVENTARIS (BARANG TIDAK HABIS PAKAI) VIA CLOUDFLARE D1
// 0 Firestore Read/Write | SSOT Cloudflare D1 Serverless SQL | Multi-Role RBAC
// =========================================================================

// State Inventaris
let inventoryItems = [];
let inventoryCategories = [];
let inventoryLocations = [];
let selectedInventoryItem = null;

// Filter & Sort State
let currentInventoryLabFilter = '';
let currentInventoryCategoryFilter = '';
let currentInventoryLocationFilter = '';
let currentInventoryConditionFilter = 'all';
let currentInventorySort = 'created_at_desc';
let inventorySearchQuery = '';
let inventorySearchDebounceTimer = null;

// Pagination State
let inventoryPage = 1;
let inventoryLimit = 25;
let inventoryTotalItems = 0;

// Race Condition Prevention: Request Sequence ID
let inventorySearchRequestId = 0;

// Double-Submit & Idempotency Flag
let isSubmittingInventory = false;

// Helper Tutup Modal Aman
function safeCloseModal(modalId) {
    if (typeof window.closeModal === 'function') {
        window.closeModal(modalId);
    } else {
        const el = document.getElementById(modalId);
        if (el) el.classList.add('hidden');
    }
}

// Helper Format Waktu WITA (Asia/Makassar)
function formatWitaDateTime(dateStr) {
    if (!dateStr) return '-';
    try {
        const iso = (dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T')) + (dateStr.endsWith('Z') ? '' : 'Z');
        const d = new Date(iso);
        if (isNaN(d.getTime())) return dateStr;
        return new Intl.DateTimeFormat('id-ID', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Makassar'
        }).format(d) + ' WITA';
    } catch (e) {
        return dateStr;
    }
}

// Helper Parse Opsi Sorting
function parseSortOption(sortKey) {
    switch (sortKey) {
        case 'name_asc': return ['name', 'ASC'];
        case 'name_desc': return ['name', 'DESC'];
        case 'code_asc': return ['code', 'ASC'];
        case 'qty_desc': return ['qty_total', 'DESC'];
        case 'qty_asc': return ['qty_total', 'ASC'];
        case 'year_desc': return ['year', 'DESC'];
        case 'created_at_desc':
        default:
            return ['created_at', 'DESC'];
    }
}

// Helper Pembaruan Visibilitas Tombol Tambah & Impor Barang berdasarkan RBAC & Konteks Lab Terpilih
function updateInventoryAddButtonVisibility() {
    const btnAddItem = document.getElementById('btn-inv-add-item');
    const btnImportExcel = document.getElementById('btn-inv-import-excel');
    if (!btnAddItem && !btnImportExcel) return;
    const accessibleLabs = getAccessibleLabsForWrite();
    let canAdd = false;
    if (isLabAdminUser() || isKepalaLab) {
        canAdd = true;
    } else if (currentInventoryLabFilter) {
        canAdd = canUserManageLab(currentInventoryLabFilter);
    } else {
        canAdd = accessibleLabs.length > 0;
    }

    if (btnAddItem) {
        if (canAdd) {
            btnAddItem.classList.remove('hidden');
            btnAddItem.classList.add('inline-flex');
            btnAddItem.style.display = '';
        } else {
            btnAddItem.classList.add('hidden');
            btnAddItem.classList.remove('inline-flex');
            btnAddItem.style.display = 'none';
        }
    }

    if (btnImportExcel) {
        if (canAdd) {
            btnImportExcel.classList.remove('hidden');
            btnImportExcel.classList.add('inline-flex');
            btnImportExcel.style.display = '';
        } else {
            btnImportExcel.classList.add('hidden');
            btnImportExcel.classList.remove('inline-flex');
            btnImportExcel.style.display = 'none';
        }
    }
    document.querySelectorAll('.inv-auth-add-btn').forEach(button => {
        button.classList.toggle('hidden', !canAdd);
        button.style.display = canAdd ? '' : 'none';
    });
}

// =========================================================================
// 1. DATA LOADER, FILTERING, SORTING & PAGINATION
// =========================================================================

window.loadInventoryData = async function (options = {}) {
    const loadingState = document.getElementById('inv-loading-state');
    const emptyInitial = document.getElementById('inv-empty-initial');
    const emptySearch = document.getElementById('inv-empty-search');
    const tableContainer = document.getElementById('inv-table-container');
    const mobileCards = document.getElementById('inv-mobile-cards');
    const tableFooter = document.getElementById('inv-table-footer');
    const btnAddItem = document.getElementById('btn-inv-add-item');
    const scopeInfoEl = document.getElementById('inv-scope-info');

    // Sequence ID untuk membatalkan penimpaan data dari respons lama
    const currentReqId = ++inventorySearchRequestId;

    if (!options.silent) {
        if (loadingState) loadingState.classList.remove('hidden');
        if (emptyInitial) emptyInitial.classList.add('hidden');
        if (emptySearch) emptySearch.classList.add('hidden');
        if (tableContainer) tableContainer.classList.add('hidden');
        if (mobileCards) mobileCards.innerHTML = '';
        if (tableFooter) tableFooter.classList.add('hidden');
    }

    // Cek otorisasi tombol tambah barang sesuai konteks filter lab yang dipilih
    updateInventoryAddButtonVisibility();

    // Tampilkan informasi cakupan
    if (scopeInfoEl) {
        if (currentInventoryLabFilter) {
            const labObj = labsList.find(l => l.id === currentInventoryLabFilter);
            scopeInfoEl.textContent = `Cakupan: ${labObj ? labObj.nama : 'Laboratorium Terpilih'}`;
        } else {
            scopeInfoEl.textContent = 'Cakupan: Seluruh Laboratorium';
        }
    }

    try {
        if (!labsList || labsList.length === 0) {
            await loadLabs();
            updateInventoryAddButtonVisibility();
        }

        populateInventoryLabFilterDropdown();

        const [sortBy, sortDir] = parseSortOption(currentInventorySort);
        const labId = currentInventoryLabFilter || '';
        const offset = Math.max(0, (inventoryPage - 1) * inventoryLimit);

        const [summary, categories, locations, items] = await Promise.all([
            cfClient.getInventorySummary(labId),
            cfClient.getInventoryCategories(labId),
            cfClient.getInventoryLocations(labId),
            cfClient.getInventoryItems({
                lab_id: labId,
                category_id: currentInventoryCategoryFilter || '',
                location_id: currentInventoryLocationFilter || '',
                condition: currentInventoryConditionFilter || 'all',
                search: inventorySearchQuery || '',
                limit: inventoryLimit,
                offset: offset,
                sort_by: sortBy,
                sort_dir: sortDir
            })
        ]);

        // Cegah respons lama menimpa hasil pencarian/filter terbaru
        if (currentReqId !== inventorySearchRequestId) {
            console.log(`[Inventory] Respon request #${currentReqId} diabaikan (request aktif #${inventorySearchRequestId})`);
            return;
        }

        inventoryCategories = Array.isArray(categories) ? categories : (categories?.data || []);
        inventoryLocations = Array.isArray(locations) ? locations : (locations?.data || []);
        inventoryItems = Array.isArray(items) ? items : (items?.data || []);
        inventoryTotalItems = typeof items?.total === 'number' ? items.total : inventoryItems.length;

        renderInventorySummary(summary || {});
        populateInventoryCategoryFilterDropdown();
        populateInventoryLocationFilterDropdown();
        updateInventoryFilterBadge();
        renderFilterChipsUI();
        renderInventoryItemsUI();
        renderInventoryPaginationUI();

    } catch (e) {
        console.error('Error loading inventory data:', e);
        showToast('Error', 'Gagal memuat data inventaris: ' + (e.message || 'Terjadi gangguan koneksi'), 'error');
    } finally {
        if (loadingState) loadingState.classList.add('hidden');
    }
};

function populateInventoryLabFilterDropdown() {
    const select = document.getElementById('inv-filter-lab');
    if (!select) return;

    const currentVal = select.value;
    let html = '<option value="">Semua Laboratorium</option>';
    labsList.forEach(lab => {
        const selected = lab.id === (currentInventoryLabFilter || currentVal) ? 'selected' : '';
        html += `<option value="${escapeHtml(lab.id)}" ${selected}>${escapeHtml(lab.nama)}</option>`;
    });
    select.innerHTML = html;
}

function populateInventoryCategoryFilterDropdown() {
    const select = document.getElementById('inv-filter-category');
    if (!select) return;

    const currentVal = currentInventoryCategoryFilter || select.value;
    let html = '<option value="">Semua Kategori</option>';
    (inventoryCategories || []).forEach(cat => {
        const selected = cat.id === currentVal ? 'selected' : '';
        html += `<option value="${escapeHtml(cat.id)}" ${selected}>${escapeHtml(cat.name)}</option>`;
    });
    select.innerHTML = html;
}

function populateInventoryLocationFilterDropdown() {
    const select = document.getElementById('inv-filter-location');
    if (!select) return;

    const currentVal = currentInventoryLocationFilter || select.value;
    let html = '<option value="">Semua Lokasi</option>';
    (inventoryLocations || []).forEach(loc => {
        const selected = loc.id === currentVal ? 'selected' : '';
        html += `<option value="${escapeHtml(loc.id)}" ${selected}>${escapeHtml(loc.name)}</option>`;
    });
    select.innerHTML = html;
}

// Controller Popover Filter
window.toggleInventoryFilterPanel = function (forceState) {
    const popover = document.getElementById('inv-filter-popover');
    const chevron = document.getElementById('inv-filter-chevron');
    if (!popover) return;

    const isCurrentlyOpen = !popover.classList.contains('hidden');
    const nextState = forceState !== undefined ? forceState : !isCurrentlyOpen;

    if (nextState) {
        popover.classList.remove('hidden');
        if (chevron) chevron.classList.add('rotate-180');
    } else {
        popover.classList.add('hidden');
        if (chevron) chevron.classList.remove('rotate-180');
    }
};

window.closeInventoryFilterPopover = function () {
    window.toggleInventoryFilterPanel(false);
};

// Event listener klik di luar popover filter untuk menutupnya secara anggun
document.addEventListener('click', (e) => {
    const popover = document.getElementById('inv-filter-popover');
    const toggleBtn = document.getElementById('btn-inv-filter-toggle');
    if (popover && !popover.classList.contains('hidden')) {
        if (!popover.contains(e.target) && !toggleBtn?.contains(e.target)) {
            window.closeInventoryFilterPopover();
        }
    }
});

window.debounceInventorySearch = function () {
    const input = document.getElementById('inv-search-input');
    const clearBtn = document.getElementById('btn-inv-search-clear');
    const query = (input ? input.value : '').trim();

    if (clearBtn) {
        if (query) clearBtn.classList.remove('hidden');
        else clearBtn.classList.add('hidden');
    }

    if (inventorySearchDebounceTimer) {
        clearTimeout(inventorySearchDebounceTimer);
    }
    inventorySearchDebounceTimer = setTimeout(() => {
        inventorySearchQuery = query;
        inventoryPage = 1;
        window.loadInventoryData();
    }, 350);
};

window.clearInventorySearch = function () {
    const input = document.getElementById('inv-search-input');
    const clearBtn = document.getElementById('btn-inv-search-clear');
    if (input) input.value = '';
    if (clearBtn) clearBtn.classList.add('hidden');
    inventorySearchQuery = '';
    inventoryPage = 1;
    window.loadInventoryData();
};

window.handleInventoryLabChange = function () {
    const labSelect = document.getElementById('inv-filter-lab');
    const newLab = labSelect ? labSelect.value : '';

    // Jika lab berganti, bersihkan filter kategori dan lokasi karena terikat pada lab
    if (currentInventoryLabFilter !== newLab) {
        currentInventoryLabFilter = newLab;
        currentInventoryCategoryFilter = '';
        currentInventoryLocationFilter = '';

        const catSelect = document.getElementById('inv-filter-category');
        const locSelect = document.getElementById('inv-filter-location');
        if (catSelect) catSelect.value = '';
        if (locSelect) locSelect.value = '';
    }

    inventoryPage = 1;
    window.loadInventoryData();
};

window.handleInventorySubFilterChange = function () {
    const catSelect = document.getElementById('inv-filter-category');
    const locSelect = document.getElementById('inv-filter-location');
    const condSelect = document.getElementById('inv-filter-condition');
    const sortSelect = document.getElementById('inv-filter-sort');

    currentInventoryCategoryFilter = catSelect ? catSelect.value : '';
    currentInventoryLocationFilter = locSelect ? locSelect.value : '';
    currentInventoryConditionFilter = condSelect ? condSelect.value : 'all';
    currentInventorySort = sortSelect ? sortSelect.value : 'created_at_desc';

    inventoryPage = 1;
    window.loadInventoryData();
};

window.resetInventoryFiltersOnly = function () {
    const catSelect = document.getElementById('inv-filter-category');
    const locSelect = document.getElementById('inv-filter-location');
    const condSelect = document.getElementById('inv-filter-condition');
    const sortSelect = document.getElementById('inv-filter-sort');

    if (catSelect) catSelect.value = '';
    if (locSelect) locSelect.value = '';
    if (condSelect) condSelect.value = 'all';
    if (sortSelect) sortSelect.value = 'created_at_desc';

    currentInventoryCategoryFilter = '';
    currentInventoryLocationFilter = '';
    currentInventoryConditionFilter = 'all';
    currentInventorySort = 'created_at_desc';

    inventoryPage = 1;
    window.loadInventoryData();
};

window.resetAllInventoryFilters = function () {
    const labSelect = document.getElementById('inv-filter-lab');
    const searchInput = document.getElementById('inv-search-input');
    const clearBtn = document.getElementById('btn-inv-search-clear');
    const catSelect = document.getElementById('inv-filter-category');
    const locSelect = document.getElementById('inv-filter-location');
    const condSelect = document.getElementById('inv-filter-condition');
    const sortSelect = document.getElementById('inv-filter-sort');

    if (labSelect) labSelect.value = '';
    if (searchInput) searchInput.value = '';
    if (clearBtn) clearBtn.classList.add('hidden');
    if (catSelect) catSelect.value = '';
    if (locSelect) locSelect.value = '';
    if (condSelect) condSelect.value = 'all';
    if (sortSelect) sortSelect.value = 'created_at_desc';

    currentInventoryLabFilter = '';
    currentInventoryCategoryFilter = '';
    currentInventoryLocationFilter = '';
    currentInventoryConditionFilter = 'all';
    currentInventorySort = 'created_at_desc';
    inventorySearchQuery = '';
    inventoryPage = 1;

    window.closeInventoryFilterPopover();
    window.loadInventoryData();
};

window.removeFilterChip = function (type) {
    if (type === 'lab') {
        currentInventoryLabFilter = '';
        currentInventoryCategoryFilter = '';
        currentInventoryLocationFilter = '';
        const labSelect = document.getElementById('inv-filter-lab');
        if (labSelect) labSelect.value = '';
    } else if (type === 'category') {
        currentInventoryCategoryFilter = '';
        const catSelect = document.getElementById('inv-filter-category');
        if (catSelect) catSelect.value = '';
    } else if (type === 'location') {
        currentInventoryLocationFilter = '';
        const locSelect = document.getElementById('inv-filter-location');
        if (locSelect) locSelect.value = '';
    } else if (type === 'condition') {
        currentInventoryConditionFilter = 'all';
        const condSelect = document.getElementById('inv-filter-condition');
        if (condSelect) condSelect.value = 'all';
    } else if (type === 'sort') {
        currentInventorySort = 'created_at_desc';
        const sortSelect = document.getElementById('inv-filter-sort');
        if (sortSelect) sortSelect.value = 'created_at_desc';
    } else if (type === 'search') {
        window.clearInventorySearch();
        return;
    }

    inventoryPage = 1;
    window.loadInventoryData();
};

function updateInventoryFilterBadge() {
    const badge = document.getElementById('inv-filter-badge');
    if (!badge) return;

    let activeCount = 0;
    if (currentInventoryCategoryFilter) activeCount++;
    if (currentInventoryLocationFilter) activeCount++;
    if (currentInventoryConditionFilter && currentInventoryConditionFilter !== 'all') activeCount++;
    if (currentInventorySort && currentInventorySort !== 'created_at_desc') activeCount++;

    if (activeCount > 0) {
        badge.textContent = activeCount;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function renderFilterChipsUI() {
    const bar = document.getElementById('inv-active-chips-bar');
    const list = document.getElementById('inv-active-chips-list');
    if (!bar || !list) return;

    const chips = [];

    if (currentInventoryLabFilter) {
        const lab = labsList.find(l => l.id === currentInventoryLabFilter);
        chips.push({
            type: 'lab',
            label: `Lab: ${lab ? lab.nama : currentInventoryLabFilter}`
        });
    }

    if (inventorySearchQuery) {
        chips.push({
            type: 'search',
            label: `Cari: "${inventorySearchQuery}"`
        });
    }

    if (currentInventoryCategoryFilter) {
        const cat = inventoryCategories.find(c => c.id === currentInventoryCategoryFilter);
        chips.push({
            type: 'category',
            label: `Kategori: ${cat ? cat.name : currentInventoryCategoryFilter}`
        });
    }

    if (currentInventoryLocationFilter) {
        const loc = inventoryLocations.find(l => l.id === currentInventoryLocationFilter);
        chips.push({
            type: 'location',
            label: `Lokasi: ${loc ? loc.name : currentInventoryLocationFilter}`
        });
    }

    if (currentInventoryConditionFilter && currentInventoryConditionFilter !== 'all') {
        const condMap = {
            'good': 'Kondisi: 100% Baik',
            'minor_damage': 'Kondisi: Ada Rusak Ringan',
            'major_damage': 'Kondisi: Ada Rusak Berat'
        };
        chips.push({
            type: 'condition',
            label: condMap[currentInventoryConditionFilter] || currentInventoryConditionFilter
        });
    }

    if (currentInventorySort && currentInventorySort !== 'created_at_desc') {
        const sortMap = {
            'name_asc': 'Urut: Nama (A-Z)',
            'name_desc': 'Urut: Nama (Z-A)',
            'code_asc': 'Urut: Kode (A-Z)',
            'qty_desc': 'Urut: Unit Terbanyak',
            'qty_asc': 'Urut: Unit Tersedikit',
            'year_desc': 'Urut: Tahun Terbaru'
        };
        chips.push({
            type: 'sort',
            label: sortMap[currentInventorySort] || currentInventorySort
        });
    }

    if (chips.length === 0) {
        bar.classList.add('hidden');
        list.innerHTML = '';
        return;
    }

    bar.classList.remove('hidden');
    list.innerHTML = chips.map(c => `
        <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600 text-[11px] font-medium">
            <span>${escapeHtml(c.label)}</span>
            <button type="button" onclick="window.removeFilterChip('${c.type}')" class="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400" title="Hapus filter ini">
                <i class="fa-solid fa-xmark text-[10px]"></i>
            </button>
        </span>
    `).join('');
}

function renderInventoryPaginationUI() {
    const countInfo = document.getElementById('inv-count-info');
    const pageInfo = document.getElementById('inv-page-info');
    const btnPrev = document.getElementById('btn-inv-prev-page');
    const btnNext = document.getElementById('btn-inv-next-page');
    const limitSelect = document.getElementById('inv-limit-select');

    const totalPages = Math.ceil(inventoryTotalItems / inventoryLimit) || 1;
    if (inventoryPage > totalPages) inventoryPage = totalPages;

    const start = inventoryTotalItems === 0 ? 0 : (inventoryPage - 1) * inventoryLimit + 1;
    const end = Math.min(inventoryPage * inventoryLimit, inventoryTotalItems);

    if (countInfo) {
        countInfo.textContent = `Menampilkan ${start}-${end} dari ${inventoryTotalItems.toLocaleString('id-ID')} barang`;
    }

    if (pageInfo) {
        pageInfo.textContent = `Hal ${inventoryPage} dari ${totalPages}`;
    }

    if (btnPrev) btnPrev.disabled = (inventoryPage <= 1);
    if (btnNext) btnNext.disabled = (inventoryPage >= totalPages);
    if (limitSelect) limitSelect.value = String(inventoryLimit);
}

window.changeInventoryPage = function (delta) {
    const totalPages = Math.ceil(inventoryTotalItems / inventoryLimit) || 1;
    const newPage = inventoryPage + delta;
    if (newPage >= 1 && newPage <= totalPages && newPage !== inventoryPage) {
        inventoryPage = newPage;
        window.loadInventoryData();
    }
};

window.handleInventoryLimitChange = function (newLimit) {
    inventoryLimit = parseInt(newLimit, 10) || 25;
    inventoryPage = 1;
    window.loadInventoryData();
};

// =========================================================================
// 2. RENDERING SUMMARY, TABEL DESKTOP & MOBILE CARDS
// =========================================================================

function renderInventorySummary(summary) {
    const elItems = document.getElementById('inv-stat-items');
    const elUnits = document.getElementById('inv-stat-units');
    const elGood = document.getElementById('inv-stat-good');
    const elMinor = document.getElementById('inv-stat-minor');
    const elMajor = document.getElementById('inv-stat-major');

    if (elItems) elItems.textContent = (summary.total_items || 0).toLocaleString('id-ID');
    if (elUnits) elUnits.textContent = (summary.total_units || 0).toLocaleString('id-ID');
    if (elGood) elGood.textContent = (summary.total_good || 0).toLocaleString('id-ID');
    if (elMinor) elMinor.textContent = (summary.total_minor_damage || 0).toLocaleString('id-ID');
    if (elMajor) elMajor.textContent = (summary.total_major_damage || 0).toLocaleString('id-ID');
}

function renderInventoryItemsUI() {
    const emptyInitial = document.getElementById('inv-empty-initial');
    const emptySearch = document.getElementById('inv-empty-search');
    const tableContainer = document.getElementById('inv-table-container');
    const tbody = document.getElementById('inv-table-body');
    const mobileContainer = document.getElementById('inv-mobile-cards');
    const tableFooter = document.getElementById('inv-table-footer');

    const isFiltered = Boolean(
        currentInventoryLabFilter ||
        currentInventoryCategoryFilter ||
        currentInventoryLocationFilter ||
        (currentInventoryConditionFilter && currentInventoryConditionFilter !== 'all') ||
        inventorySearchQuery
    );

    if (!Array.isArray(inventoryItems) || inventoryItems.length === 0) {
        if (tableContainer) tableContainer.classList.add('hidden');
        if (mobileContainer) mobileContainer.innerHTML = '';
        if (tableFooter) tableFooter.classList.add('hidden');

        if (isFiltered) {
            if (emptySearch) emptySearch.classList.remove('hidden');
            if (emptyInitial) emptyInitial.classList.add('hidden');
        } else {
            if (emptyInitial) {
                emptyInitial.classList.remove('hidden');
                const btnsInEmpty = emptyInitial.querySelectorAll('.inv-auth-add-btn');
                if (btnsInEmpty && btnsInEmpty.length > 0) {
                    let canAddInEmpty = false;
                    if (isLabAdminUser() || isKepalaLab) {
                        canAddInEmpty = true;
                    } else if (currentInventoryLabFilter) {
                        canAddInEmpty = canUserManageLab(currentInventoryLabFilter);
                    } else {
                        canAddInEmpty = getAccessibleLabsForWrite().length > 0;
                    }

                    btnsInEmpty.forEach(btn => {
                        if (canAddInEmpty) {
                            btn.classList.remove('hidden');
                            btn.style.display = '';
                        } else {
                            btn.classList.add('hidden');
                            btn.style.display = 'none';
                        }
                    });
                }
            }
            if (emptySearch) emptySearch.classList.add('hidden');
        }
        return;
    }

    if (emptyInitial) emptyInitial.classList.add('hidden');
    if (emptySearch) emptySearch.classList.add('hidden');
    if (tableContainer) tableContainer.classList.remove('hidden');
    if (tableFooter) tableFooter.classList.remove('hidden');

    // Render Tabel Desktop
    if (tbody) {
        tbody.innerHTML = inventoryItems.map(item => {
            const canManage = canUserManageLab(item.lab_id);
            const placementHtml = currentInventoryLabFilter
                ? `<span class="font-medium text-slate-700 dark:text-slate-300"><i class="fa-solid fa-location-dot text-[10px] mr-1 text-emerald-500"></i>${escapeHtml(item.location_name || '-')}</span>`
                : `<div class="font-medium text-slate-700 dark:text-slate-300">${escapeHtml(item.lab_nama || '-')}</div>
                   <div class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5"><i class="fa-solid fa-location-dot text-[9px] mr-1 text-emerald-500"></i>${escapeHtml(item.location_name || '-')}</div>`;

            return `
                <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-700/40 transition-colors">
                    <td class="py-3 px-3.5 font-mono font-bold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                        <span class="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700/80 border border-slate-200 dark:border-slate-600 text-[11px]">
                            ${escapeHtml(item.inventory_code)}
                        </span>
                    </td>
                    <td class="py-3 px-3.5">
                        <div class="font-bold text-slate-800 dark:text-slate-100 text-xs">${escapeHtml(item.name)}</div>
                        <div class="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mt-0.5 flex-wrap">
                            <span class="px-1.5 py-0.2 rounded text-[10px] bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 font-medium">
                                ${escapeHtml(item.category_name || '-')}
                            </span>
                            ${item.specification ? `<span class="truncate max-w-[200px]" title="${escapeHtml(item.specification)}">• ${escapeHtml(item.specification)}</span>` : ''}
                        </div>
                    </td>
                    <td class="py-3 px-3.5 whitespace-nowrap">
                        ${placementHtml}
                    </td>
                    <td class="py-3 px-3.5 text-center whitespace-nowrap font-extrabold text-slate-800 dark:text-slate-100">
                        ${item.qty_total} <span class="text-[10px] font-normal text-slate-500">${escapeHtml(item.unit || 'Unit')}</span>
                    </td>
                    <td class="py-3 px-3.5 text-center whitespace-nowrap">
                        <div class="inline-flex items-center gap-1 text-[11px] font-bold">
                            <span class="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-800/40" title="Kondisi Baik">
                                ${item.qty_good}
                            </span>
                            <span class="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200/50 dark:border-amber-800/40" title="Rusak Ringan">
                                ${item.qty_minor_damage}
                            </span>
                            <span class="px-1.5 py-0.5 rounded bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border border-rose-200/50 dark:border-rose-800/40" title="Rusak Berat">
                                ${item.qty_major_damage}
                            </span>
                        </div>
                    </td>
                    <td class="py-3 px-3.5 text-center text-slate-600 dark:text-slate-400 whitespace-nowrap text-xs">
                        ${item.acquisition_year || '-'}
                    </td>
                    <td class="py-3 px-3.5 text-center whitespace-nowrap">
                        <button onclick="window.showInventoryDetail('${escapeHtml(item.id)}')"
                            class="px-2.5 py-1 text-xs font-semibold text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30 rounded-lg transition-colors inline-flex items-center justify-center" title="Lihat Detail">
                            Detail
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // Render Cards Mobile
    if (mobileContainer) {
        mobileContainer.innerHTML = inventoryItems.map(item => {
            const canManage = canUserManageLab(item.lab_id);
            return `
                <div class="bg-slate-50/70 dark:bg-slate-700/30 p-3 rounded-xl border border-slate-200 dark:border-slate-600 space-y-2">
                    <div class="flex items-start justify-between gap-2">
                        <div>
                            <span class="px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-[10px] font-mono font-bold text-slate-700 dark:text-slate-300">
                                ${escapeHtml(item.inventory_code)}
                            </span>
                            <h5 class="font-bold text-slate-800 dark:text-slate-100 text-sm mt-1">${escapeHtml(item.name)}</h5>
                            <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                ${escapeHtml(item.lab_nama)} • ${escapeHtml(item.category_name || '-')} • ${escapeHtml(item.location_name || '-')}
                            </p>
                        </div>
                        <div class="text-right shrink-0">
                            <span class="text-sm font-extrabold text-blue-600 dark:text-blue-400 block">
                                ${item.qty_total} ${escapeHtml(item.unit || 'Unit')}
                            </span>
                            <span class="text-[10px] text-slate-500 dark:text-slate-400">Thn ${item.acquisition_year}</span>
                        </div>
                    </div>

                    <div class="flex items-center justify-between pt-2 border-t border-slate-200/60 dark:border-slate-600 text-xs">
                        <div class="flex items-center gap-1.5">
                            <span class="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 font-bold text-[11px] border border-emerald-200/50">
                                B: ${item.qty_good}
                            </span>
                            <span class="px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 font-bold text-[11px] border border-amber-200/50">
                                RR: ${item.qty_minor_damage}
                            </span>
                            <span class="px-2 py-0.5 rounded bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 font-bold text-[11px] border border-rose-200/50">
                                RB: ${item.qty_major_damage}
                            </span>
                        </div>

                        <div class="flex items-center gap-1">
                            <button onclick="window.showInventoryDetail('${escapeHtml(item.id)}')"
                                class="px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-colors">
                                Detail
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }
}

// =========================================================================
// 3. TAMBAH & EDIT DATA BARANG INVENTARIS
// =========================================================================

window.openAddInventoryModal = async function () {
    const accessibleLabs = getAccessibleLabsForWrite();
    if (accessibleLabs.length === 0) {
        showToast('Ditolak', 'Anda tidak memiliki hak akses untuk menambah barang di laboratorium.', 'warning');
        return;
    }

    if (currentInventoryLabFilter && !canUserManageLab(currentInventoryLabFilter)) {
        showToast('Ditolak', 'Anda tidak memiliki hak akses untuk menambah barang di laboratorium terpilih ini.', 'warning');
        return;
    }

    const modal = document.getElementById('modal-inventory-form');
    const titleEl = document.getElementById('inv-form-title');
    const idInput = document.getElementById('inv-form-id');
    const isEditInput = document.getElementById('inv-form-is-edit');
    const labSelect = document.getElementById('inv-form-lab');
    const codeDisplay = document.getElementById('inv-form-code-display');
    const condSection = document.getElementById('inv-form-condition-section');
    const editNotice = document.getElementById('inv-form-edit-notice');
    const yearInput = document.getElementById('inv-form-year');

    if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-boxes-stacked mr-1"></i> Tambah Barang Inventaris';
    if (idInput) idInput.value = '';
    if (isEditInput) isEditInput.value = '0';
    if (codeDisplay) codeDisplay.textContent = '(Otomatis dibuat sistem setelah disimpan)';
    if (condSection) condSection.classList.remove('hidden');
    if (editNotice) editNotice.classList.add('hidden');
    if (yearInput) yearInput.value = new Date().getFullYear();

    const nameInput = document.getElementById('inv-form-name');
    const specInput = document.getElementById('inv-form-spec');
    const unitInput = document.getElementById('inv-form-unit');
    const goodInput = document.getElementById('inv-form-good');
    const minorInput = document.getElementById('inv-form-minor');
    const majorInput = document.getElementById('inv-form-major');
    const fundingInput = document.getElementById('inv-form-funding');
    const notesInput = document.getElementById('inv-form-notes');

    if (nameInput) nameInput.value = '';
    if (specInput) specInput.value = '';
    if (unitInput) unitInput.value = 'Unit';
    if (goodInput) goodInput.value = 1;
    if (minorInput) minorInput.value = 0;
    if (majorInput) majorInput.value = 0;
    if (fundingInput) fundingInput.value = 'BOS Reguler';
    if (notesInput) notesInput.value = '';

    window.calcFormTotal();

    if (labSelect) {
        labSelect.disabled = false;
        labSelect.innerHTML = '<option value="">-- Pilih Laboratorium --</option>' +
            accessibleLabs.map(l => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.nama)}</option>`).join('');

        // Gunakan konteks lab terpilih sebagai nilai awal jika pengguna berhak
        if (currentInventoryLabFilter && accessibleLabs.some(l => l.id === currentInventoryLabFilter)) {
            labSelect.value = currentInventoryLabFilter;
        } else if (accessibleLabs.length === 1) {
            labSelect.value = accessibleLabs[0].id;
        }
    }

    await window.handleFormLabChange();
    if (modal) modal.classList.remove('hidden');
};

window.handleFormLabChange = async function () {
    const labSelect = document.getElementById('inv-form-lab');
    const catSelect = document.getElementById('inv-form-category');
    const locSelect = document.getElementById('inv-form-location');

    const labId = labSelect ? labSelect.value : '';
    if (!labId) {
        if (catSelect) catSelect.innerHTML = '<option value="">-- Pilih Kategori --</option>';
        if (locSelect) locSelect.innerHTML = '<option value="">-- Pilih Lokasi --</option>';
        return;
    }

    try {
        const [categories, locations] = await Promise.all([
            cfClient.getInventoryCategories(labId),
            cfClient.getInventoryLocations(labId)
        ]);

        const catList = Array.isArray(categories) ? categories : (categories?.data || []);
        const locList = Array.isArray(locations) ? locations : (locations?.data || []);

        if (catSelect) {
            if (catList.length === 0) {
                catSelect.innerHTML = '<option value="">-- Belum ada kategori di lab ini --</option>';
            } else {
                catSelect.innerHTML = '<option value="">-- Pilih Kategori --</option>' +
                    catList.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)} (${escapeHtml(c.code)})</option>`).join('');
            }
        }

        if (locSelect) {
            if (locList.length === 0) {
                locSelect.innerHTML = '<option value="">-- Belum ada lokasi di lab ini --</option>';
            } else {
                locSelect.innerHTML = '<option value="">-- Pilih Lokasi --</option>' +
                    locList.map(l => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.name)}</option>`).join('');
            }
        }
    } catch (e) {
        console.error('Error fetching lab metadata for form:', e);
    }
};

window.calcFormTotal = function () {
    const good = Math.max(0, parseInt(document.getElementById('inv-form-good')?.value || 0, 10));
    const minor = Math.max(0, parseInt(document.getElementById('inv-form-minor')?.value || 0, 10));
    const major = Math.max(0, parseInt(document.getElementById('inv-form-major')?.value || 0, 10));
    const unit = document.getElementById('inv-form-unit')?.value || 'Unit';

    const total = good + minor + major;
    const badge = document.getElementById('inv-form-total-badge');
    if (badge) {
        badge.textContent = `${total} ${unit}`;
    }
};

window.openEditInventoryModal = async function (itemId) {
    let item = inventoryItems.find(i => i.id === itemId);
    if (!item && selectedInventoryItem && selectedInventoryItem.id === itemId) {
        item = selectedInventoryItem;
    }

    if (!item) {
        try {
            item = await cfClient.getInventoryItemDetail(itemId);
        } catch (_) {}
    }

    if (!item) {
        showToast('Error', 'Barang inventaris tidak ditemukan.', 'error');
        return;
    }

    if (!canUserManageLab(item.lab_id)) {
        showToast('Ditolak', 'Anda tidak memiliki wewenang untuk mengedit barang di laboratorium ini.', 'warning');
        return;
    }

    const modal = document.getElementById('modal-inventory-form');
    const titleEl = document.getElementById('inv-form-title');
    const idInput = document.getElementById('inv-form-id');
    const isEditInput = document.getElementById('inv-form-is-edit');
    const labSelect = document.getElementById('inv-form-lab');
    const codeDisplay = document.getElementById('inv-form-code-display');
    const condSection = document.getElementById('inv-form-condition-section');
    const editNotice = document.getElementById('inv-form-edit-notice');
    const totalBadge = document.getElementById('inv-form-total-badge');

    if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-pen-to-square mr-1"></i> Edit Data Barang';
    if (idInput) idInput.value = item.id;
    if (isEditInput) isEditInput.value = '1';
    if (codeDisplay) codeDisplay.textContent = item.inventory_code;
    if (condSection) condSection.classList.add('hidden');
    if (editNotice) editNotice.classList.remove('hidden');
    if (totalBadge) totalBadge.textContent = `${item.qty_total} ${item.unit || 'Unit'}`;

    if (labSelect) {
        labSelect.innerHTML = `<option value="${escapeHtml(item.lab_id)}" selected>${escapeHtml(item.lab_nama)}</option>`;
        labSelect.disabled = true;
    }

    await window.handleFormLabChange();

    const catSelect = document.getElementById('inv-form-category');
    const nameInput = document.getElementById('inv-form-name');
    const specInput = document.getElementById('inv-form-spec');
    const locSelect = document.getElementById('inv-form-location');
    const unitInput = document.getElementById('inv-form-unit');
    const yearInput = document.getElementById('inv-form-year');
    const fundingInput = document.getElementById('inv-form-funding');
    const notesInput = document.getElementById('inv-form-notes');

    if (catSelect) catSelect.value = item.category_id;
    if (nameInput) nameInput.value = item.name;
    if (specInput) specInput.value = item.specification || '';
    if (locSelect) locSelect.value = item.location_id;
    if (unitInput) unitInput.value = item.unit || 'Unit';
    if (yearInput) yearInput.value = item.acquisition_year;
    if (fundingInput) fundingInput.value = item.funding_source || 'BOS Reguler';
    if (notesInput) notesInput.value = item.notes || '';

    if (modal) modal.classList.remove('hidden');
};

window.submitInventoryForm = async function (event) {
    event.preventDefault();

    // Pencegahan Submit Ganda / Idempotency
    if (isSubmittingInventory) return;

    const isEdit = document.getElementById('inv-form-is-edit')?.value === '1';
    const itemId = document.getElementById('inv-form-id')?.value;
    const labId = document.getElementById('inv-form-lab')?.value;
    const categoryId = document.getElementById('inv-form-category')?.value;
    const name = document.getElementById('inv-form-name')?.value.trim();
    const spec = document.getElementById('inv-form-spec')?.value.trim();
    const locationId = document.getElementById('inv-form-location')?.value;
    const unit = document.getElementById('inv-form-unit')?.value;
    const year = parseInt(document.getElementById('inv-form-year')?.value, 10);
    const funding = document.getElementById('inv-form-funding')?.value;
    const notes = document.getElementById('inv-form-notes')?.value.trim();

    if (!labId || !categoryId || !name || !locationId || !unit || isNaN(year)) {
        showToast('Peringatan', 'Harap isi seluruh field bertanda bintang (*).', 'warning');
        return;
    }

    if (!canUserManageLab(labId)) {
        showToast('Ditolak', 'Anda tidak memiliki wewenang untuk mengelola inventaris di laboratorium ini.', 'warning');
        return;
    }

    const payload = {
        lab_id: labId,
        category_id: categoryId,
        name: name,
        specification: spec,
        location_id: locationId,
        unit: unit,
        acquisition_year: year,
        funding_source: funding,
        notes: notes
    };

    if (!isEdit) {
        const good = parseInt(document.getElementById('inv-form-good')?.value || 0, 10);
        const minor = parseInt(document.getElementById('inv-form-minor')?.value || 0, 10);
        const major = parseInt(document.getElementById('inv-form-major')?.value || 0, 10);

        if (good < 0 || minor < 0 || major < 0) {
            showToast('Peringatan', 'Kuantitas tidak boleh berupa angka negatif.', 'warning');
            return;
        }

        const total = good + minor + major;
        if (total < 1) {
            showToast('Peringatan', 'Total unit barang harus minimal 1 unit.', 'warning');
            return;
        }

        payload.qty_good = good;
        payload.qty_minor_damage = minor;
        payload.qty_major_damage = major;
    }

    const btnSubmit = document.getElementById('btn-submit-inventory');
    const originalText = btnSubmit ? btnSubmit.innerHTML : '';
    if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Menyimpan...';
    }
    isSubmittingInventory = true;

    try {
        await cfClient.saveInventoryItem(payload, isEdit, itemId);
        showToast('Berhasil', isEdit ? 'Data barang berhasil diperbarui.' : 'Barang inventaris baru berhasil disimpan.', 'success');
        safeCloseModal('modal-inventory-form');

        // Jika barang baru disimpan pada lab yang berbeda dari filter aktif, berikan feedback jelas
        if (!isEdit && currentInventoryLabFilter && currentInventoryLabFilter !== labId) {
            const targetLab = labsList.find(l => l.id === labId);
            const targetLabName = targetLab ? targetLab.nama : 'laboratorium terkait';
            showToast('Info Filter', `Barang tersimpan di ${targetLabName}. Beralih ke filter ${targetLabName} agar barang langsung terlihat.`, 'info');
            currentInventoryLabFilter = labId;
            const labFilterSelect = document.getElementById('inv-filter-lab');
            if (labFilterSelect) labFilterSelect.value = labId;
        }

        // Perbarui data tanpa me-reload penuh halaman dan pertahankan filter/sorting
        await window.loadInventoryData({ silent: false });

        // Jika dalam mode edit, buka kembali modal detail dengan data terbarunya
        if (isEdit && itemId) {
            window.showInventoryDetail(itemId);
        }

    } catch (e) {
        console.error('Error saving inventory item:', e);
        // Pertahankan input pengguna saat terjadi kesalahan (jangan tutup modal)
        showToast('Error', 'Gagal menyimpan barang: ' + (e.message || 'Terjadi kesalahan pada server'), 'error');
    } finally {
        isSubmittingInventory = false;
        if (btnSubmit) {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = originalText;
        }
    }
};

// =========================================================================
// 3b. IMPOR DATA BARANG INVENTARIS DARI EXCEL (COPY - PASTE TSV)
// =========================================================================

let tempInventoryImportRows = [];
let importLabCategories = [];
let importLabLocations = [];
let isSubmittingInventoryImport = false;

window.openImportInventoryModal = async function () {
    const accessibleLabs = getAccessibleLabsForWrite();
    if (accessibleLabs.length === 0) {
        showToast('Ditolak', 'Anda tidak memiliki hak akses untuk mengimpor barang di laboratorium.', 'warning');
        return;
    }

    const modal = document.getElementById('modal-inventory-import');
    const labSelect = document.getElementById('inv-import-lab');
    const pasteArea = document.getElementById('inv-import-paste-area');
    const previewContainer = document.getElementById('inv-import-preview-container');
    const previewBody = document.getElementById('inv-import-preview-body');
    const countInfo = document.getElementById('inv-import-count-info');
    const btnSave = document.getElementById('btn-inv-import-save');
    const btnSaveLabel = document.getElementById('btn-inv-import-save-label');

    tempInventoryImportRows = [];

    if (pasteArea) pasteArea.value = '';
    if (previewContainer) previewContainer.classList.add('hidden');
    if (previewBody) previewBody.innerHTML = '';
    if (countInfo) countInfo.textContent = 'Menunggu data disalin...';
    if (btnSave) btnSave.disabled = true;
    if (btnSaveLabel) btnSaveLabel.textContent = 'Proses Impor';

    if (labSelect) {
        labSelect.innerHTML = '<option value="">-- Pilih Laboratorium --</option>' +
            accessibleLabs.map(l => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.nama)}</option>`).join('');

        if (currentInventoryLabFilter && accessibleLabs.some(l => l.id === currentInventoryLabFilter)) {
            labSelect.value = currentInventoryLabFilter;
        } else if (accessibleLabs.length === 1) {
            labSelect.value = accessibleLabs[0].id;
        }
    }

    await window.handleImportLabChange();
    if (modal) modal.classList.remove('hidden');
};

window.handleImportLabChange = async function () {
    const labSelect = document.getElementById('inv-import-lab');
    const labId = labSelect ? labSelect.value : '';

    importLabCategories = [];
    importLabLocations = [];

    if (!labId) return;

    try {
        const [categories, locations] = await Promise.all([
            cfClient.getInventoryCategories(labId),
            cfClient.getInventoryLocations(labId)
        ]);

        importLabCategories = Array.isArray(categories) ? categories : (categories?.data || []);
        importLabLocations = Array.isArray(locations) ? locations : (locations?.data || []);

        const pasteArea = document.getElementById('inv-import-paste-area');
        if (pasteArea && pasteArea.value.trim().length > 0) {
            window.previewInventoryImportData();
        }
    } catch (e) {
        console.error('Error fetching categories/locations for import:', e);
        showToast('Peringatan', 'Gagal memuat kategori dan lokasi laboratorium: ' + e.message, 'warning');
    }
};

window.copyInventoryExcelTemplate = function () {
    const headers = [
        'Nama Barang',
        'Spesifikasi / Merk',
        'Kategori',
        'Lokasi Simpan',
        'Jumlah Unit',
        'Satuan',
        'Tahun Perolehan',
        'Sumber Dana',
        'Keterangan'
    ].join('\t');

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(headers).then(() => {
            showToast('Berhasil Disalin', 'Format 9 kolom Excel berhasil disalin ke clipboard! Silakan paste (Ctrl+V) di Excel Anda.', 'success');
        }).catch(() => {
            prompt('Salin teks format kolom berikut (Ctrl+C lalu Enter):', headers);
        });
    } else {
        prompt('Salin teks format kolom berikut (Ctrl+C lalu Enter):', headers);
    }
};

window.previewInventoryImportData = function () {
    const labSelect = document.getElementById('inv-import-lab');
    const labId = labSelect ? labSelect.value : '';
    if (!labId) {
        showToast('Peringatan', 'Silakan pilih laboratorium tujuan terlebih dahulu.', 'warning');
        return;
    }

    const pasteArea = document.getElementById('inv-import-paste-area');
    const rawText = (pasteArea ? pasteArea.value : '').trim();
    const previewContainer = document.getElementById('inv-import-preview-container');
    const previewBody = document.getElementById('inv-import-preview-body');
    const badgesContainer = document.getElementById('inv-import-summary-badges');
    const countInfo = document.getElementById('inv-import-count-info');
    const btnSave = document.getElementById('btn-inv-import-save');
    const btnSaveLabel = document.getElementById('btn-inv-import-save-label');
    const offsetSelect = document.getElementById('inv-import-offset-select');

    if (!rawText) {
        showToast('Peringatan', 'Area teks masih kosong. Silakan salin (copy) data dari Excel lalu tempel (paste) di sini.', 'warning');
        if (previewContainer) previewContainer.classList.add('hidden');
        if (btnSave) btnSave.disabled = true;
        return;
    }

    const rawLines = rawText.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim().length > 0);
    if (rawLines.length === 0) {
        showToast('Peringatan', 'Tidak ditemukan baris data yang valid.', 'warning');
        return;
    }

    // Deteksi Delimiter (Default Tab TSV Excel, fallback Titik-koma atau Koma jika salinan CSV)
    let delimiter = '\t';
    if (!rawLines[0].includes('\t')) {
        if (rawLines[0].includes(';')) delimiter = ';';
        else if (rawLines[0].includes(',')) delimiter = ',';
    }

    // Helper pembersih cell spreadsheet (hapus enclosing quotes dan trim)
    const cleanCell = (c) => {
        let s = (c || '').trim();
        if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
            s = s.slice(1, -1).replace(/""/g, '"').trim();
        }
        return s;
    };

    // Cek apakah baris pertama header
    const firstLineCols = rawLines[0].split(delimiter).map(c => cleanCell(c).toLowerCase());
    const isFirstLineHeader = firstLineCols.some(c =>
        c === 'nama' || c === 'nama barang' || c === 'barang' || c === 'spesifikasi' ||
        c === 'kategori' || c === 'no' || c === 'no.' || c === 'jumlah' || c === 'tahun'
    );

    const dataLines = isFirstLineHeader ? rawLines.slice(1) : rawLines;
    if (dataLines.length === 0) {
        showToast('Peringatan', 'Hanya terdeteksi baris header tanpa isi data barang.', 'warning');
        return;
    }

    // Deteksi Offset (apakah kolom 1 adalah No Urut)
    let offset = 0;
    const manualOffset = offsetSelect ? offsetSelect.value : 'auto';
    if (manualOffset === '1') {
        offset = 1;
    } else if (manualOffset === '0') {
        offset = 0;
    } else {
        const sampleCols = dataLines[0].split(delimiter).map(cleanCell);
        if (sampleCols.length >= 10 && /^\d+$/.test(sampleCols[0])) {
            offset = 1;
        } else {
            offset = 0;
        }
    }

    tempInventoryImportRows = [];
    let validCount = 0;
    let invalidCount = 0;
    let totalUnits = 0;

    const currentYear = new Date().getFullYear();

    const rowsHtml = dataLines.map((line, idx) => {
        const cols = line.split(delimiter).map(cleanCell);

        // 1. Nama Barang (Wajib)
        // 2. Spesifikasi / Merk (Wajib)
        // 3. Kategori (Wajib)
        // 4. Lokasi Simpan (Wajib)
        // 5. Jumlah Unit (Wajib) -> 100% Kondisi Baik
        // 6. Satuan (Wajib)
        // 7. Tahun Perolehan (Wajib)
        // 8. Sumber Dana (Wajib)
        // 9. Keterangan (Opsional)
        const name = cols[offset] || '';
        const spec = cols[offset + 1] || '';
        const catStr = cols[offset + 2] || '';
        const locStr = cols[offset + 3] || '';
        const qtyRaw = cols[offset + 4] || '';
        const unit = cols[offset + 5] || '';
        const yearRaw = cols[offset + 6] || '';
        const funding = cols[offset + 7] || '';
        const notes = cols[offset + 8] || '';

        const errors = [];

        if (!name) errors.push('Nama barang kosong');
        if (!spec) errors.push('Spesifikasi/Merk kosong');
        if (!catStr) errors.push('Kategori kosong');
        if (!locStr) errors.push('Lokasi simpan kosong');

        // Validasi kuantitas riil (aman terhadap format desimal '10.0'/'5.00' dan ribuan '1.000', serta menolak angka negatif)
        let qty = NaN;
        const trimmedQty = qtyRaw.trim();
        if (/^-/.test(trimmedQty)) {
            qty = -1; // Nilai negatif tidak diizinkan
        } else if (/^\d{1,3}[.,]\d{3}$/.test(trimmedQty)) {
            qty = parseInt(trimmedQty.replace(/[.,]/g, ''), 10);
        } else {
            const num = parseFloat(trimmedQty.replace(/,/g, '.'));
            if (!isNaN(num)) {
                qty = Math.floor(num);
            } else {
                const fallbackInt = parseInt(trimmedQty.replace(/[^0-9]/g, ''), 10);
                if (!isNaN(fallbackInt)) qty = fallbackInt;
            }
        }

        if (isNaN(qty) || qty < 1) {
            errors.push('Jumlah unit harus angka minimal 1');
        }

        // Validasi satuan
        if (!unit) errors.push('Satuan kosong');

        // Validasi tahun perolehan (aman terhadap '2024.0', '2024/2025', dan 'Tahun 2024', menolak negatif)
        let year = NaN;
        const trimmedYear = yearRaw.trim();
        if (!/^-/.test(trimmedYear)) {
            const yearMatch = trimmedYear.match(/\b(19\d\d|20\d\d)\b/);
            if (yearMatch) {
                year = parseInt(yearMatch[1], 10);
            } else {
                const numYear = parseFloat(trimmedYear.replace(/,/g, '.'));
                if (!isNaN(numYear)) {
                    year = Math.floor(numYear);
                }
            }
        }

        if (isNaN(year) || year < 1900 || year > 2100) {
            errors.push('Tahun perolehan wajib 4 digit (1900-2100)');
        }

        // Validasi sumber dana
        if (!funding) errors.push('Sumber dana kosong');

        // Pencocokan Kategori (case-insensitive nama / kode / format 'Nama (Kode)')
        let matchedCat = null;
        if (catStr) {
            const cleanCat = catStr.toLowerCase();
            matchedCat = importLabCategories.find(c =>
                c.name.toLowerCase() === cleanCat ||
                c.code.toLowerCase() === cleanCat ||
                `${c.name} (${c.code})`.toLowerCase() === cleanCat
            );
            if (!matchedCat) {
                matchedCat = importLabCategories.find(c =>
                    c.name.toLowerCase().includes(cleanCat) ||
                    cleanCat.includes(c.name.toLowerCase()) ||
                    (c.code && cleanCat.includes(c.code.toLowerCase()))
                );
            }
            if (!matchedCat) {
                errors.push(`Kategori "${catStr}" tidak terdaftar di lab ini`);
            }
        }

        // Pencocokan Lokasi (case-insensitive nama / kode)
        let matchedLoc = null;
        if (locStr) {
            const cleanLoc = locStr.toLowerCase();
            matchedLoc = importLabLocations.find(l =>
                l.name.toLowerCase() === cleanLoc ||
                (l.code && l.code.toLowerCase() === cleanLoc) ||
                `${l.name} (${l.code})`.toLowerCase() === cleanLoc
            );
            if (!matchedLoc) {
                matchedLoc = importLabLocations.find(l =>
                    l.name.toLowerCase().includes(cleanLoc) ||
                    cleanLoc.includes(l.name.toLowerCase())
                );
            }
            if (!matchedLoc) {
                errors.push(`Lokasi "${locStr}" tidak terdaftar di lab ini`);
            }
        }

        const isValid = errors.length === 0;

        if (isValid) {
            validCount++;
            totalUnits += qty;
            tempInventoryImportRows.push({
                lab_id: labId,
                name: name,
                specification: spec,
                category_id: matchedCat.id,
                location_id: matchedLoc.id,
                qty_good: qty,
                qty_total: qty,
                unit: unit,
                acquisition_year: year,
                funding_source: funding,
                notes: notes
            });
        } else {
            invalidCount++;
        }

        const statusBadge = isValid
            ? `<span class="px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-bold text-[10px] inline-flex items-center gap-1"><i class="fa-solid fa-circle-check"></i> Siap</span>`
            : `<span class="px-2 py-0.5 rounded-md bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 font-bold text-[10px] inline-flex items-center gap-1" title="${escapeHtml(errors.join(', '))}"><i class="fa-solid fa-triangle-exclamation"></i> Error</span>`;

        return `
            <tr class="${isValid ? 'hover:bg-slate-50 dark:hover:bg-slate-700/30' : 'bg-rose-50/40 dark:bg-rose-950/20'}">
                <td class="py-2 px-2.5 text-center whitespace-nowrap">${statusBadge}</td>
                <td class="py-2 px-2.5">
                    <div class="font-bold text-slate-800 dark:text-slate-100">${escapeHtml(name || '-')}</div>
                    <div class="text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-[200px]" title="${escapeHtml(spec)}">${escapeHtml(spec || '-')}</div>
                    ${!isValid ? `<div class="text-[10px] text-rose-600 dark:text-rose-400 font-medium mt-0.5">${escapeHtml(errors.join(' • '))}</div>` : ''}
                </td>
                <td class="py-2 px-2.5 whitespace-nowrap">
                    <span class="${matchedCat ? 'text-slate-700 dark:text-slate-300 font-medium' : 'text-rose-600 dark:text-rose-400 font-bold'}">
                        ${escapeHtml(matchedCat ? matchedCat.name : (catStr || '-'))}
                    </span>
                </td>
                <td class="py-2 px-2.5 whitespace-nowrap">
                    <span class="${matchedLoc ? 'text-slate-700 dark:text-slate-300' : 'text-rose-600 dark:text-rose-400 font-bold'}">
                        ${escapeHtml(matchedLoc ? matchedLoc.name : (locStr || '-'))}
                    </span>
                </td>
                <td class="py-2 px-2.5 text-center whitespace-nowrap font-bold text-emerald-600 dark:text-emerald-400">
                    ${isValid ? `${qty} ${escapeHtml(unit)}` : (qtyRaw || '-')}
                </td>
                <td class="py-2 px-2.5 text-center whitespace-nowrap text-slate-600 dark:text-slate-400">
                    ${isValid ? year : (yearRaw || '-')}
                </td>
                <td class="py-2 px-2.5 whitespace-nowrap text-slate-600 dark:text-slate-400 text-[10px]">
                    ${escapeHtml(funding || '-')}
                </td>
            </tr>
        `;
    }).join('');

    if (previewBody) previewBody.innerHTML = rowsHtml;
    if (previewContainer) previewContainer.classList.remove('hidden');

    if (badgesContainer) {
        badgesContainer.innerHTML = `
            <span class="px-2 py-0.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-bold">
                <i class="fa-solid fa-check mr-1"></i>${validCount} Valid
            </span>
            ${invalidCount > 0 ? `
                <span class="px-2 py-0.5 rounded-lg bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 font-bold">
                    <i class="fa-solid fa-xmark mr-1"></i>${invalidCount} Error
                </span>
            ` : ''}
            <span class="px-2 py-0.5 rounded-lg bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-bold">
                Total: ${totalUnits} Unit
            </span>
        `;
    }

    if (countInfo) {
        countInfo.innerHTML = `Terdeteksi <b>${dataLines.length}</b> baris (${validCount} valid siap impor, ${invalidCount} error).`;
    }

    if (btnSave) {
        btnSave.disabled = validCount === 0;
    }
    if (btnSaveLabel) {
        btnSaveLabel.textContent = `Proses Impor (${validCount} Barang)`;
    }
};

window.submitInventoryImportData = async function () {
    const labSelect = document.getElementById('inv-import-lab');
    const labId = labSelect ? labSelect.value : '';
    if (!labId) {
        showToast('Peringatan', 'Silakan pilih laboratorium tujuan terlebih dahulu.', 'warning');
        return;
    }

    if (tempInventoryImportRows.length === 0) {
        showToast('Peringatan', 'Tidak ada data barang yang valid untuk diimpor.', 'warning');
        return;
    }

    if (isSubmittingInventoryImport) return;

    const targetLab = labsList.find(l => l.id === labId);
    const labNama = targetLab ? targetLab.nama : 'laboratorium';

    const btnSave = document.getElementById('btn-inv-import-save');
    const btnSaveLabel = document.getElementById('btn-inv-import-save-label');
    const originalLabel = btnSaveLabel ? btnSaveLabel.textContent : 'Proses Impor';

    if (btnSave) btnSave.disabled = true;
    if (btnSaveLabel) btnSaveLabel.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Mengimpor ke Cloudflare D1...';
    isSubmittingInventoryImport = true;

    try {
        const result = await cfClient.bulkSaveInventoryItems(labId, tempInventoryImportRows);
        const count = result.count || tempInventoryImportRows.length;

        showToast('Impor Berhasil', `Sebanyak ${count} barang inventaris berhasil diimpor ke ${labNama}.`, 'success');
        safeCloseModal('modal-inventory-import');

        if (currentInventoryLabFilter !== labId) {
            currentInventoryLabFilter = labId;
            const filterLabSelect = document.getElementById('inv-filter-lab');
            if (filterLabSelect) filterLabSelect.value = labId;
        }

        await window.loadInventoryData({ silent: false });

    } catch (e) {
        console.error('Error importing inventory items:', e);
        showToast('Gagal Impor', 'Terjadi kesalahan saat menyimpan data: ' + (e.message || 'Error server'), 'error');
    } finally {
        isSubmittingInventoryImport = false;
        if (btnSave) btnSave.disabled = false;
        if (btnSaveLabel) btnSaveLabel.textContent = originalLabel;
    }
};

// =========================================================================
// 4. DETAIL BARANG & RIWAYAT PERUBAHAN KONDISI
// =========================================================================

window.showInventoryDetail = async function (itemId) {
    let item = inventoryItems.find(i => i.id === itemId);
    if (!item && selectedInventoryItem && selectedInventoryItem.id === itemId) {
        item = selectedInventoryItem;
    }
    selectedInventoryItem = item || null;

    const modal = document.getElementById('modal-inventory-detail');
    if (modal) modal.classList.remove('hidden');

    const renderItemInfo = (data) => {
        if (!data) return;
        const nameEl = document.getElementById('detail-inv-name');
        const codeEl = document.getElementById('detail-inv-code');
        const subEl = document.getElementById('detail-inv-subtitle');
        const totalEl = document.getElementById('detail-inv-total');
        const goodEl = document.getElementById('detail-inv-good');
        const minorEl = document.getElementById('detail-inv-minor');
        const majorEl = document.getElementById('detail-inv-major');
        const locEl = document.getElementById('detail-inv-location');
        const yearEl = document.getElementById('detail-inv-year');
        const fundEl = document.getElementById('detail-inv-funding');
        const unitEl = document.getElementById('detail-inv-unit');
        const specEl = document.getElementById('detail-inv-spec');
        const notesEl = document.getElementById('detail-inv-notes');

        if (nameEl) nameEl.textContent = data.name || '-';
        if (codeEl) codeEl.textContent = data.inventory_code || '-';
        if (subEl) subEl.textContent = `${data.lab_nama || '-'} • ${data.category_name || '-'}`;
        if (totalEl) totalEl.textContent = `${data.qty_total ?? 0} ${data.unit || 'Unit'}`;
        if (goodEl) goodEl.textContent = data.qty_good ?? 0;
        if (minorEl) minorEl.textContent = data.qty_minor_damage ?? 0;
        if (majorEl) majorEl.textContent = data.qty_major_damage ?? 0;
        if (locEl) locEl.textContent = data.location_name || '-';
        if (yearEl) yearEl.textContent = data.acquisition_year || '-';
        if (fundEl) fundEl.textContent = data.funding_source || '-';
        if (unitEl) unitEl.textContent = data.unit || 'Unit';
        if (specEl) specEl.textContent = data.specification || '-';
        if (notesEl) notesEl.textContent = data.notes || '-';

        const canManage = canUserManageLab(data.lab_id);
        const actionsBox = document.getElementById('detail-inv-actions');
        if (actionsBox) {
            if (canManage) {
                actionsBox.classList.remove('hidden');
            } else {
                actionsBox.classList.add('hidden');
            }
        }
    };

    if (item) {
        renderItemInfo(item);
    }

    const historyList = document.getElementById('detail-inv-history-list');
    if (historyList) {
        historyList.innerHTML = '<div class="text-center text-slate-400 py-3 text-xs"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Memuat detail & riwayat...</div>';
    }

    try {
        const detail = await cfClient.getInventoryItemDetail(itemId);
        if (detail) {
            item = detail;
            selectedInventoryItem = item;
            renderItemInfo(item);
        }

        const historyRes = await cfClient.getInventoryConditionHistory(itemId);
        const history = Array.isArray(historyRes) ? historyRes : (historyRes?.data || []);
        if (!history || history.length === 0) {
            if (historyList) {
                historyList.innerHTML = '<div class="text-center text-slate-400 py-3 text-xs">Belum ada riwayat mutasi kondisi.</div>';
            }
        } else {
            const condLabels = {
                good: 'Baik',
                minor_damage: 'Rusak Ringan',
                major_damage: 'Rusak Berat'
            };
            const condBadges = {
                good: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
                minor_damage: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
                major_damage: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300'
            };

            if (historyList) {
                historyList.innerHTML = history.map(h => `
                    <div class="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-700/30 border border-slate-200 dark:border-slate-600 text-xs space-y-1">
                        <div class="flex items-center justify-between">
                            <span class="font-bold text-slate-700 dark:text-slate-200">${escapeHtml(h.user_name || 'Staf Lab')}</span>
                            <span class="text-[10px] text-slate-400">${formatWitaDateTime(h.created_at)}</span>
                        </div>
                        <div class="flex items-center gap-1.5 text-[11px] font-medium pt-0.5">
                            <span class="px-1.5 py-0.5 rounded ${condBadges[h.from_condition] || ''}">${condLabels[h.from_condition] || h.from_condition}</span>
                            <i class="fa-solid fa-arrow-right text-[10px] text-slate-400"></i>
                            <span class="px-1.5 py-0.5 rounded ${condBadges[h.to_condition] || ''}">${condLabels[h.to_condition] || h.to_condition}</span>
                            <span class="font-bold text-slate-700 dark:text-slate-200 ml-1">(${h.quantity} unit)</span>
                        </div>
                        ${h.notes ? `<p class="text-slate-600 dark:text-slate-400 italic text-[11px] mt-1">"${escapeHtml(h.notes)}"</p>` : ''}
                    </div>
                `).join('');
            }
        }

    } catch (e) {
        console.error('Error fetching inventory item detail:', e);
        showToast('Error', 'Gagal memuat detail barang: ' + e.message, 'error');
    }
};

window.handleDetailEditClick = function () {
    if (!selectedInventoryItem) return;
    safeCloseModal('modal-inventory-detail');
    window.openEditInventoryModal(selectedInventoryItem.id);
};

window.handleDetailChangeConditionClick = function () {
    if (!selectedInventoryItem) return;
    safeCloseModal('modal-inventory-detail');
    window.openChangeConditionModal(selectedInventoryItem.id);
};

window.handleDetailDeleteClick = function () {
    if (!selectedInventoryItem) return;
    if (!canUserManageLab(selectedInventoryItem.lab_id)) {
        showToast('Ditolak', 'Anda tidak memiliki wewenang untuk menghapus barang ini.', 'warning');
        return;
    }
    window.deleteInventoryItem(selectedInventoryItem.id, selectedInventoryItem.name);
};

// =========================================================================
// 5. MUTASI KONDISI BARANG & LOG PENGHAPUSAN
// =========================================================================

window.openChangeConditionModal = function (itemId) {
    const item = inventoryItems.find(i => i.id === itemId) || selectedInventoryItem;
    if (!item) {
        showToast('Error', 'Barang inventaris tidak ditemukan.', 'error');
        return;
    }

    if (!canUserManageLab(item.lab_id)) {
        showToast('Ditolak', 'Anda tidak memiliki wewenang untuk mengubah kondisi barang ini.', 'warning');
        return;
    }

    selectedInventoryItem = item;
    const modal = document.getElementById('modal-inventory-condition');
    const idInput = document.getElementById('inv-cond-item-id');
    const nameEl = document.getElementById('inv-cond-item-name');
    const codeEl = document.getElementById('inv-cond-item-code');
    const fromSelect = document.getElementById('inv-cond-from');
    const toSelect = document.getElementById('inv-cond-to');
    const qtyInput = document.getElementById('inv-cond-quantity');
    const notesInput = document.getElementById('inv-cond-notes');

    if (idInput) idInput.value = item.id;
    if (nameEl) nameEl.textContent = item.name;
    if (codeEl) codeEl.textContent = item.inventory_code;
    if (fromSelect) fromSelect.value = 'good';
    if (toSelect) toSelect.value = 'minor_damage';
    if (qtyInput) qtyInput.value = 1;
    if (notesInput) notesInput.value = '';

    window.updateConditionLimits();
    if (modal) modal.classList.remove('hidden');
};

window.updateConditionLimits = function () {
    const item = selectedInventoryItem;
    if (!item) return;

    const fromSelect = document.getElementById('inv-cond-from');
    const toSelect = document.getElementById('inv-cond-to');
    const qtyInput = document.getElementById('inv-cond-quantity');
    const hintEl = document.getElementById('inv-cond-available-hint');

    const fromCond = fromSelect ? fromSelect.value : 'good';
    const condStockMap = {
        good: item.qty_good || 0,
        minor_damage: item.qty_minor_damage || 0,
        major_damage: item.qty_major_damage || 0
    };

    const available = condStockMap[fromCond] || 0;
    if (hintEl) {
        hintEl.textContent = `Tersedia: ${available} unit`;
    }

    if (qtyInput) {
        qtyInput.max = available;
        if (parseInt(qtyInput.value, 10) > available) {
            qtyInput.value = Math.max(1, available);
        }
    }

    if (toSelect) {
        const conds = [
            { val: 'good', label: 'Baik' },
            { val: 'minor_damage', label: 'Rusak Ringan' },
            { val: 'major_damage', label: 'Rusak Berat' }
        ];
        const validOptions = conds.filter(c => c.val !== fromCond);
        const currentTo = toSelect.value;
        toSelect.innerHTML = validOptions.map(c => `<option value="${c.val}">${c.label}</option>`).join('');

        if (validOptions.some(c => c.val === currentTo)) {
            toSelect.value = currentTo;
        } else {
            toSelect.value = validOptions[0].val;
        }
    }
};

window.submitChangeCondition = async function (event) {
    event.preventDefault();
    const itemId = document.getElementById('inv-cond-item-id')?.value;
    const fromCond = document.getElementById('inv-cond-from')?.value;
    const toCond = document.getElementById('inv-cond-to')?.value;
    const quantity = parseInt(document.getElementById('inv-cond-quantity')?.value, 10);
    const notes = document.getElementById('inv-cond-notes')?.value.trim();

    if (!itemId || !fromCond || !toCond || isNaN(quantity) || quantity <= 0) {
        showToast('Peringatan', 'Harap isi jumlah unit mutasi kondisi dengan benar.', 'warning');
        return;
    }

    if (fromCond === toCond) {
        showToast('Peringatan', 'Kondisi asal dan tujuan tidak boleh sama.', 'warning');
        return;
    }

    if (!notes) {
        showToast('Peringatan', 'Catatan / alasan perubahan kondisi wajib diisi.', 'warning');
        return;
    }

    const item = inventoryItems.find(i => i.id === itemId) || selectedInventoryItem;
    if (item && !canUserManageLab(item.lab_id)) {
        showToast('Ditolak', 'Anda tidak memiliki wewenang untuk mengubah kondisi barang ini.', 'warning');
        return;
    }

    const btnSubmit = document.getElementById('btn-submit-condition');
    const originalText = btnSubmit ? btnSubmit.innerHTML : '';
    if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Menyimpan...';
    }

    try {
        await cfClient.changeInventoryCondition(itemId, {
            from_condition: fromCond,
            to_condition: toCond,
            quantity: quantity,
            notes: notes
        });

        showToast('Berhasil', `Berhasil memindahkan ${quantity} unit ke kondisi baru.`, 'success');
        safeCloseModal('modal-inventory-condition');
        await window.loadInventoryData();

        if (selectedInventoryItem && selectedInventoryItem.id === itemId) {
            window.showInventoryDetail(itemId);
        }
    } catch (e) {
        console.error('Error changing inventory condition:', e);
        showToast('Error', 'Gagal mengubah kondisi: ' + e.message, 'error');
    } finally {
        if (btnSubmit) {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = originalText;
        }
    }
};

window.deleteInventoryItem = async function (itemId, itemName) {
    const item = inventoryItems.find(i => i.id === itemId) || selectedInventoryItem;
    if (item && !canUserManageLab(item.lab_id)) {
        showToast('Ditolak', 'Anda tidak memiliki wewenang untuk menghapus barang ini.', 'warning');
        return;
    }

    showConfirmModal(
        'Hapus Barang Inventaris',
        `Yakin ingin menghapus <b>"${escapeHtml(itemName)}"</b>?<br><br>Data barang beserta seluruh riwayat perubahan kondisinya akan dihapus permanen dari D1.`,
        'danger',
        async () => {
            try {
                await cfClient.deleteInventoryItem(itemId);
                showToast('Berhasil', `Barang "${itemName}" berhasil dihapus.`, 'success');
                safeCloseModal('modal-inventory-detail');
                await window.loadInventoryData();
            } catch (e) {
                console.error('Error deleting inventory item:', e);
                showToast('Error', 'Gagal menghapus barang: ' + e.message, 'error');
            }
        }
    );
};

// =========================================================================
// 6. QUICK LOCATION & MASTER PENGATURAN (KATEGORI & LOKASI)
// =========================================================================

window.openQuickLocationModal = function () {
    const labId = document.getElementById('inv-form-lab')?.value;
    if (!labId) {
        showToast('Peringatan', 'Silakan pilih laboratorium terlebih dahulu.', 'warning');
        return;
    }
    if (!canUserManageLab(labId)) {
        showToast('Ditolak', 'Anda tidak memiliki wewenang untuk menambah lokasi di laboratorium ini.', 'warning');
        return;
    }
    const input = document.getElementById('quick-location-name');
    if (input) input.value = '';
    const modal = document.getElementById('modal-quick-location');
    if (modal) modal.classList.remove('hidden');
};

window.submitQuickLocation = async function () {
    const labId = document.getElementById('inv-form-lab')?.value;
    const input = document.getElementById('quick-location-name');
    const name = (input ? input.value : '').trim();

    if (!labId || !name) {
        showToast('Peringatan', 'Nama lokasi tidak boleh kosong.', 'warning');
        return;
    }

    try {
        const res = await cfClient.saveInventoryLocation({ lab_id: labId, name: name });
        showToast('Berhasil', `Lokasi "${name}" berhasil ditambahkan.`, 'success');
        safeCloseModal('modal-quick-location');

        const locSelect = document.getElementById('inv-form-location');
        const locations = await cfClient.getInventoryLocations(labId);
        if (locSelect) {
            locSelect.innerHTML = '<option value="">-- Pilih Lokasi --</option>' +
                (locations || []).map(l => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.name)}</option>`).join('');
            if (res && res.data && res.data.id) {
                locSelect.value = res.data.id;
            }
        }
    } catch (e) {
        console.error('Error adding quick location:', e);
        showToast('Error', 'Gagal menambah lokasi: ' + e.message, 'error');
    }
};

// =========================================================================
// 6. MASTER PENGATURAN E-LABORATORIUM (TAB PENGATURAN)
// Hanya 2 Subtab: 1. Laboratorium, 2. Inventaris (Kategori & Lokasi Terpadu)
// =========================================================================

// State Pengaturan Inventaris
let currentManageInventoryLabId = '';
let currentManageCategories = [];
let currentManageLocations = [];
let manageCategorySearchTerm = '';
let manageLocationSearchTerm = '';

window.openQuickLocationModal = function () {
    const labId = document.getElementById('inv-form-lab')?.value;
    if (!labId) {
        showToast('Peringatan', 'Silakan pilih laboratorium terlebih dahulu.', 'warning');
        return;
    }
    const input = document.getElementById('quick-location-name');
    if (input) input.value = '';
    const modal = document.getElementById('modal-quick-location');
    if (modal) modal.classList.remove('hidden');
};

window.submitQuickLocation = async function () {
    const labId = document.getElementById('inv-form-lab')?.value;
    const input = document.getElementById('quick-location-name');
    const name = (input ? input.value : '').trim();

    if (!labId || !name) {
        showToast('Peringatan', 'Nama lokasi tidak boleh kosong.', 'warning');
        return;
    }

    try {
        const res = await cfClient.saveInventoryLocation({ lab_id: labId, name: name });
        showToast('Berhasil', `Lokasi "${name}" berhasil ditambahkan.`, 'success');
        safeCloseModal('modal-quick-location');

        const locSelect = document.getElementById('inv-form-location');
        const locations = await cfClient.getInventoryLocations(labId);
        if (locSelect) {
            locSelect.innerHTML = '<option value="">-- Pilih Lokasi --</option>' +
                (locations || []).map(l => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.name)}</option>`).join('');
            if (res && res.data && res.data.id) {
                locSelect.value = res.data.id;
            }
        }
    } catch (e) {
        console.error('Error adding quick location:', e);
        showToast('Error', 'Gagal menambah lokasi: ' + e.message, 'error');
    }
};

// Navigasi 2 Subtab Pengaturan: 'labs' | 'inventory'
window.switchSettingsSubTab = function (subtab) {
    // Aliaskan panggilan legacy 'categories' dan 'locations' ke 'inventory'
    const activeSubtab = (subtab === 'categories' || subtab === 'locations') ? 'inventory' : subtab;

    const btnLabs = document.getElementById('btn-subtab-labs');
    const btnInv = document.getElementById('btn-subtab-inventory');
    const viewLabs = document.getElementById('subview-pengaturan-labs');
    const viewInv = document.getElementById('subview-pengaturan-inventory');

    const activeBtnClass = 'settings-subtab-btn active px-3 py-1.5 text-xs font-bold rounded-md bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 shadow-sm transition-all';
    const inactiveBtnClass = 'settings-subtab-btn px-3 py-1.5 text-xs font-bold rounded-md text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-all';

    if (activeSubtab === 'labs') {
        if (btnLabs) btnLabs.className = activeBtnClass;
        if (btnInv) btnInv.className = inactiveBtnClass;
        if (viewLabs) viewLabs.classList.remove('hidden');
        if (viewInv) viewInv.classList.add('hidden');
        renderManageLabsList();
    } else {
        if (btnLabs) btnLabs.className = inactiveBtnClass;
        if (btnInv) btnInv.className = activeBtnClass;
        if (viewLabs) viewLabs.classList.add('hidden');
        if (viewInv) viewInv.classList.remove('hidden');
        window.loadManageInventoryData();
    }
};

// Pemuatan Data Pengaturan Inventaris (Kategori & Lokasi Simpan secara Terpadu)
window.loadManageInventoryData = async function (selectedLabId = null) {
    const selectLab = document.getElementById('setting-inventory-filter-lab');
    const containerCats = document.getElementById('manage-cats-list');
    const containerLocs = document.getElementById('manage-locs-list');
    const countCatsEl = document.getElementById('manage-cats-count');
    const countLocsEl = document.getElementById('manage-locs-count');
    const btnAddCat = document.getElementById('btn-open-add-cat');
    const btnAddLoc = document.getElementById('btn-open-add-loc');

    // Populate dropdown lab jika belum terisi atau jumlahnya beda
    if (selectLab && (selectLab.options.length === 0 || selectLab.options.length !== labsList.length)) {
        selectLab.innerHTML = labsList.map(l => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.nama)}</option>`).join('');
    }

    // Tentukan lab yang sedang aktif dikelola
    if (selectedLabId) {
        currentManageInventoryLabId = selectedLabId;
    } else if (selectLab && selectLab.value) {
        currentManageInventoryLabId = selectLab.value;
    } else if (labsList.length > 0) {
        const accessible = getAccessibleLabsForWrite();
        currentManageInventoryLabId = (accessible.length > 0 ? accessible[0].id : labsList[0].id);
    } else {
        currentManageInventoryLabId = '';
    }

    if (selectLab && currentManageInventoryLabId) {
        selectLab.value = currentManageInventoryLabId;
    }

    // Periksa hak akses untuk mengelola lab ini
    const canManage = canUserManageLab(currentManageInventoryLabId);
    if (btnAddCat) {
        btnAddCat.style.display = canManage ? 'inline-flex' : 'none';
    }
    if (btnAddLoc) {
        btnAddLoc.style.display = canManage ? 'inline-flex' : 'none';
    }

    // Indikator loading
    if (containerCats) {
        containerCats.innerHTML = '<div class="text-center text-slate-400 py-6 text-xs"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Memuat kategori...</div>';
    }
    if (containerLocs) {
        containerLocs.innerHTML = '<div class="text-center text-slate-400 py-6 text-xs"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Memuat lokasi simpan...</div>';
    }

    if (!currentManageInventoryLabId) {
        if (containerCats) containerCats.innerHTML = '<div class="text-center text-slate-400 py-6 text-xs">Pilih laboratorium untuk melihat kategori.</div>';
        if (containerLocs) containerLocs.innerHTML = '<div class="text-center text-slate-400 py-6 text-xs">Pilih laboratorium untuk melihat lokasi simpan.</div>';
        return;
    }

    try {
        // Ambil kategori & lokasi paralel (hemat waktu & 0 firestore read)
        const [catsRes, locsRes] = await Promise.all([
            cfClient.getInventoryCategories(currentManageInventoryLabId, true),
            cfClient.getInventoryLocations(currentManageInventoryLabId, true)
        ]);

        currentManageCategories = Array.isArray(catsRes) ? catsRes : (catsRes?.data || []);
        currentManageLocations = Array.isArray(locsRes) ? locsRes : (locsRes?.data || []);

        if (countCatsEl) countCatsEl.textContent = `${currentManageCategories.length} Kategori`;
        if (countLocsEl) countLocsEl.textContent = `${currentManageLocations.length} Lokasi`;

        window.renderManageCategoriesUI();
        window.renderManageLocationsUI();
    } catch (e) {
        console.error('Error loading manage inventory data:', e);
        if (containerCats) containerCats.innerHTML = '<div class="text-center text-rose-500 py-4 text-xs">Gagal memuat kategori.</div>';
        if (containerLocs) containerLocs.innerHTML = '<div class="text-center text-rose-500 py-4 text-xs">Gagal memuat lokasi simpan.</div>';
    }
};

// Handler Pencarian Kategori
window.handleCategorySearch = function (term) {
    manageCategorySearchTerm = (term || '').trim().toLowerCase();
    window.renderManageCategoriesUI();
};

// Render Daftar Kategori Inventaris
window.renderManageCategoriesUI = function () {
    const container = document.getElementById('manage-cats-list');
    if (!container) return;

    const canManage = canUserManageLab(currentManageInventoryLabId);

    // Filter berdasarkan search term
    const filtered = currentManageCategories.filter(cat => {
        if (!manageCategorySearchTerm) return true;
        const nameMatch = (cat.name || '').toLowerCase().includes(manageCategorySearchTerm);
        const codeMatch = (cat.code || '').toLowerCase().includes(manageCategorySearchTerm);
        return nameMatch || codeMatch;
    });

    if (filtered.length === 0) {
        if (manageCategorySearchTerm) {
            container.innerHTML = `
                <div class="text-center text-slate-400 dark:text-slate-500 py-6 text-xs">
                    <i class="fa-solid fa-magnifying-glass mr-1"></i> Tidak ditemukan kategori dengan kata kunci "<b>${escapeHtml(manageCategorySearchTerm)}</b>".
                </div>
            `;
        } else {
            container.innerHTML = `
                <div class="text-center text-slate-400 dark:text-slate-500 py-6 text-xs">
                    Belum ada kategori untuk laboratorium ini. Klik tombol <b>Tambah Kategori</b> untuk membuat kategori baru.
                </div>
            `;
        }
        return;
    }

    container.innerHTML = filtered.map(cat => `
        <div class="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/40 hover:bg-white dark:hover:bg-slate-700 transition-colors">
            <div class="flex items-center gap-2.5 min-w-0">
                <span class="px-2 py-0.5 rounded font-mono font-bold text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 shrink-0">
                    ${escapeHtml(cat.code || 'CAT')}
                </span>
                <span class="font-bold text-xs text-slate-800 dark:text-slate-200 truncate">${escapeHtml(cat.name)}</span>
                ${!cat.is_active ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300 font-bold shrink-0">Nonaktif</span>' : ''}
            </div>
            ${canManage ? `
                <div class="flex items-center gap-1 shrink-0 ml-2">
                    <button type="button" onclick="window.openCategoryModal('${escapeHtml(cat.id)}')"
                        class="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded text-xs transition-colors" title="Edit Kategori">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button type="button" onclick="window.deleteCategory('${escapeHtml(cat.id)}', '${escapeHtml(cat.name)}')"
                        class="p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded text-xs transition-colors" title="Hapus / Nonaktifkan">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            ` : ''}
        </div>
    `).join('');
};

// Handler Pencarian Lokasi
window.handleLocationSearch = function (term) {
    manageLocationSearchTerm = (term || '').trim().toLowerCase();
    window.renderManageLocationsUI();
};

// Render Daftar Lokasi Simpan
window.renderManageLocationsUI = function () {
    const container = document.getElementById('manage-locs-list');
    if (!container) return;

    const canManage = canUserManageLab(currentManageInventoryLabId);

    // Filter berdasarkan search term
    const filtered = currentManageLocations.filter(loc => {
        if (!manageLocationSearchTerm) return true;
        return (loc.name || '').toLowerCase().includes(manageLocationSearchTerm);
    });

    if (filtered.length === 0) {
        if (manageLocationSearchTerm) {
            container.innerHTML = `
                <div class="text-center text-slate-400 dark:text-slate-500 py-6 text-xs">
                    <i class="fa-solid fa-magnifying-glass mr-1"></i> Tidak ditemukan lokasi dengan kata kunci "<b>${escapeHtml(manageLocationSearchTerm)}</b>".
                </div>
            `;
        } else {
            container.innerHTML = `
                <div class="text-center text-slate-400 dark:text-slate-500 py-6 text-xs">
                    Belum ada lokasi simpan untuk laboratorium ini. Klik tombol <b>Tambah Lokasi</b> untuk membuat lokasi baru.
                </div>
            `;
        }
        return;
    }

    container.innerHTML = filtered.map(loc => `
        <div class="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/40 hover:bg-white dark:hover:bg-slate-700 transition-colors">
            <div class="flex items-center gap-2 min-w-0">
                <i class="fa-solid fa-location-dot text-emerald-500 text-xs shrink-0"></i>
                <span class="font-bold text-xs text-slate-800 dark:text-slate-200 truncate">${escapeHtml(loc.name)}</span>
                ${!loc.is_active ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300 font-bold shrink-0">Nonaktif</span>' : ''}
            </div>
            ${canManage ? `
                <div class="flex items-center gap-1 shrink-0 ml-2">
                    <button type="button" onclick="window.openLocationModal('${escapeHtml(loc.id)}')"
                        class="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded text-xs transition-colors" title="Edit Lokasi">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button type="button" onclick="window.deleteLocation('${escapeHtml(loc.id)}', '${escapeHtml(loc.name)}')"
                        class="p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded text-xs transition-colors" title="Hapus / Nonaktifkan">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            ` : ''}
        </div>
    `).join('');
};

// ==========================================
// CRUD MODAL FORM KATEGORI
// ==========================================

window.openCategoryModal = function (catId = null) {
    const titleEl = document.getElementById('modal-category-title');
    const idInput = document.getElementById('category-form-id');
    const isEditInput = document.getElementById('category-form-is-edit');
    const labSelect = document.getElementById('category-form-lab');
    const nameInput = document.getElementById('category-form-name');
    const codeInput = document.getElementById('category-form-code');

    // Populate dropdown lab
    if (labSelect) {
        labSelect.innerHTML = labsList.map(l => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.nama)}</option>`).join('');
        labSelect.value = currentManageInventoryLabId || (labsList.length > 0 ? labsList[0].id : '');
    }

    if (catId) {
        // Mode Edit
        const cat = currentManageCategories.find(c => c.id === catId);
        if (!cat) {
            showToast('Error', 'Data kategori tidak ditemukan.', 'error');
            return;
        }
        if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-pen-to-square mr-1.5"></i>Edit Kategori Inventaris';
        if (idInput) idInput.value = cat.id;
        if (isEditInput) isEditInput.value = '1';
        if (labSelect && cat.lab_id) labSelect.value = cat.lab_id;
        if (nameInput) nameInput.value = cat.name || '';
        if (codeInput) codeInput.value = cat.code || '';
    } else {
        // Mode Tambah
        if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-tags mr-1.5"></i>Tambah Kategori Inventaris';
        if (idInput) idInput.value = '';
        if (isEditInput) isEditInput.value = '0';
        if (nameInput) nameInput.value = '';
        if (codeInput) codeInput.value = '';
    }

    const modal = document.getElementById('modal-category-form');
    if (modal) modal.classList.remove('hidden');
};

window.submitCategoryForm = async function (event) {
    if (event) event.preventDefault();

    const id = (document.getElementById('category-form-id')?.value || '').trim();
    const isEdit = document.getElementById('category-form-is-edit')?.value === '1';
    const labId = (document.getElementById('category-form-lab')?.value || '').trim();
    const name = (document.getElementById('category-form-name')?.value || '').trim();
    const code = (document.getElementById('category-form-code')?.value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (!labId || !name) {
        showToast('Peringatan', 'Laboratorium dan nama kategori wajib diisi.', 'warning');
        return;
    }

    if (!code) {
        showToast('Peringatan', 'Kode kategori wajib diisi (misal: OPT, GLS).', 'warning');
        return;
    }

    if (!canUserManageLab(labId)) {
        showToast('Ditolak', 'Anda tidak memiliki wewenang mengelola kategori pada lab ini.', 'warning');
        return;
    }

    // Cek duplikasi nama atau kode pada lab yang sama
    const duplicate = currentManageCategories.find(c =>
        c.id !== id &&
        (c.name.toLowerCase() === name.toLowerCase() || (c.code && c.code.toUpperCase() === code))
    );
    if (duplicate) {
        showToast('Peringatan', 'Kategori dengan nama atau kode tersebut sudah terdaftar pada lab ini.', 'warning');
        return;
    }

    const submitBtn = document.getElementById('btn-submit-category');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Menyimpan...';
    }

    try {
        if (isEdit && id) {
            await cfClient.saveInventoryCategory({ lab_id: labId, name: name, code: code }, true, id);
            showToast('Berhasil', `Kategori "${name}" berhasil diperbarui.`, 'success');
        } else {
            await cfClient.saveInventoryCategory({ lab_id: labId, name: name, code: code }, false);
            showToast('Berhasil', `Kategori "${name}" berhasil ditambahkan.`, 'success');
        }

        safeCloseModal('modal-category-form');
        await window.loadManageInventoryData(labId);
    } catch (e) {
        console.error('Error saving category:', e);
        showToast('Error', 'Gagal menyimpan kategori: ' + e.message, 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk mr-1"></i> Simpan Kategori';
        }
    }
};

window.deleteCategory = async function (catId, catName) {
    if (!canUserManageLab(currentManageInventoryLabId)) {
        showToast('Ditolak', 'Anda tidak memiliki wewenang mengelola kategori pada lab ini.', 'warning');
        return;
    }

    showConfirmModal(
        'Hapus / Nonaktifkan Kategori',
        `Yakin ingin menghapus kategori <b>"${escapeHtml(catName)}"</b>?<br><br>Jika sudah ada barang yang menggunakannya, sistem akan otomatis menonaktifkannya alih-alih menghapus permanen agar referensi inventaris tetap aman.`,
        'danger',
        async () => {
            try {
                const res = await cfClient.deleteInventoryCategory(catId);
                const msg = res.message || `Kategori "${catName}" diproses.`;
                showToast('Berhasil', msg, 'success');
                await window.loadManageInventoryData(currentManageInventoryLabId);
            } catch (e) {
                console.error('Error deleting category:', e);
                showToast('Error', 'Gagal memproses kategori: ' + e.message, 'error');
            }
        }
    );
};

// ==========================================
// CRUD MODAL FORM LOKASI SIMPAN
// ==========================================

window.openLocationModal = function (locId = null) {
    const titleEl = document.getElementById('modal-location-title');
    const idInput = document.getElementById('location-form-id');
    const isEditInput = document.getElementById('location-form-is-edit');
    const labSelect = document.getElementById('location-form-lab');
    const nameInput = document.getElementById('location-form-name');

    // Populate dropdown lab
    if (labSelect) {
        labSelect.innerHTML = labsList.map(l => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.nama)}</option>`).join('');
        labSelect.value = currentManageInventoryLabId || (labsList.length > 0 ? labsList[0].id : '');
    }

    if (locId) {
        // Mode Edit
        const loc = currentManageLocations.find(l => l.id === locId);
        if (!loc) {
            showToast('Error', 'Data lokasi simpan tidak ditemukan.', 'error');
            return;
        }
        if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-pen-to-square mr-1.5"></i>Edit Lokasi Penyimpanan';
        if (idInput) idInput.value = loc.id;
        if (isEditInput) isEditInput.value = '1';
        if (labSelect && loc.lab_id) labSelect.value = loc.lab_id;
        if (nameInput) nameInput.value = loc.name || '';
    } else {
        // Mode Tambah
        if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-location-dot mr-1.5"></i>Tambah Lokasi Penyimpanan';
        if (idInput) idInput.value = '';
        if (isEditInput) isEditInput.value = '0';
        if (nameInput) nameInput.value = '';
    }

    const modal = document.getElementById('modal-location-form');
    if (modal) modal.classList.remove('hidden');
};

window.submitLocationForm = async function (event) {
    if (event) event.preventDefault();

    const id = (document.getElementById('location-form-id')?.value || '').trim();
    const isEdit = document.getElementById('location-form-is-edit')?.value === '1';
    const labId = (document.getElementById('location-form-lab')?.value || '').trim();
    const name = (document.getElementById('location-form-name')?.value || '').trim();

    if (!labId || !name) {
        showToast('Peringatan', 'Laboratorium dan nama lokasi simpan wajib diisi.', 'warning');
        return;
    }

    if (!canUserManageLab(labId)) {
        showToast('Ditolak', 'Anda tidak memiliki wewenang mengelola lokasi pada lab ini.', 'warning');
        return;
    }

    // Cek duplikasi nama lokasi pada lab yang sama
    const duplicate = currentManageLocations.find(l =>
        l.id !== id && l.name.toLowerCase() === name.toLowerCase()
    );
    if (duplicate) {
        showToast('Peringatan', 'Lokasi dengan nama tersebut sudah ada pada lab ini.', 'warning');
        return;
    }

    const submitBtn = document.getElementById('btn-submit-location');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Menyimpan...';
    }

    try {
        if (isEdit && id) {
            await cfClient.saveInventoryLocation({ lab_id: labId, name: name }, true, id);
            showToast('Berhasil', `Lokasi "${name}" berhasil diperbarui.`, 'success');
        } else {
            await cfClient.saveInventoryLocation({ lab_id: labId, name: name }, false);
            showToast('Berhasil', `Lokasi "${name}" berhasil ditambahkan.`, 'success');
        }

        safeCloseModal('modal-location-form');
        await window.loadManageInventoryData(labId);
    } catch (e) {
        console.error('Error saving location:', e);
        showToast('Error', 'Gagal menyimpan lokasi: ' + e.message, 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk mr-1"></i> Simpan Lokasi';
        }
    }
};

window.deleteLocation = async function (locId, locName) {
    if (!canUserManageLab(currentManageInventoryLabId)) {
        showToast('Ditolak', 'Anda tidak memiliki wewenang mengelola lokasi pada lab ini.', 'warning');
        return;
    }

    showConfirmModal(
        'Hapus / Nonaktifkan Lokasi',
        `Yakin ingin menghapus lokasi <b>"${escapeHtml(locName)}"</b>?<br><br>Jika sudah ada barang yang disimpan di lokasi ini, sistem akan otomatis menonaktifkannya alih-alih menghapus permanen agar riwayat inventaris tetap utuh.`,
        'danger',
        async () => {
            try {
                const res = await cfClient.deleteInventoryLocation(locId);
                const msg = res.message || `Lokasi "${locName}" diproses.`;
                showToast('Berhasil', msg, 'success');
                await window.loadManageInventoryData(currentManageInventoryLabId);
            } catch (e) {
                console.error('Error deleting location:', e);
                showToast('Error', 'Gagal memproses lokasi: ' + e.message, 'error');
            }
        }
    );
};

// Aliaskan fungsi lama untuk backward compatibility
window.loadManageCategories = () => window.loadManageInventoryData(currentManageInventoryLabId);
window.loadManageLocations = () => window.loadManageInventoryData(currentManageInventoryLabId);

// =========================================================================
// FITUR EKSPOR EXCEL INVENTARIS SIAP CETAK A4 LENGKAP KOP SURAT (EXCELJS)
// Standar: Kop Asli dari Aset (assets/kop.png), Font Times New Roman (TNR) Resmi,
// Penandatangan Kontekstual (Koordinator Lab vs Kepala Lab + NIP), 2-Tier Header,
// Page Setup A4 Landscape, Auto Summary, & Signature Block (SSOT SCHOOL_CONFIG)
// =========================================================================

function sanitizeExcelCellValue(val) {
    if (typeof val !== 'string') return val;
    const trimmed = val.trim();
    if (trimmed.length > 0 && ['=', '+', '-', '@'].includes(trimmed.charAt(0))) {
        if (trimmed === '-') return '-';
        return `'${trimmed}`;
    }
    return val;
}

export async function fetchKopImageBuffer(path = 'assets/kop.png') {
    if (typeof fetch === 'undefined') return null;
    try {
        const res = await fetch(path);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        return new Uint8Array(buf);
    } catch (e) {
        console.warn('[E-Lab] Gagal memuat aset gambar kop:', e);
        return null;
    }
}

export async function resolveInventorySigner(labId) {
    let roleTitle = 'Kepala Laboratorium,';
    let signerName = '';
    let signerNip = '';

    if (labId) {
        const labObj = (labsList || []).find(l => l.id === labId);
        const labName = labObj?.nama || 'Laboratorium';
        roleTitle = `Koordinator ${labName},`;
        signerName = labObj?.koordinator_nama || '';

        const coordUid = labObj?.koordinator_uid;
        if (coordUid || signerName) {
            if (teacherUsersList.length === 0) {
                try { await loadTeacherUsersList(); } catch (e) {}
            }
            const matchedUser = (teacherUsersList || []).find(u =>
                (coordUid && u.uid === coordUid) ||
                (signerName && u.name === signerName)
            );
            if (matchedUser) {
                if (!signerName) signerName = matchedUser.name;
                signerNip = matchedUser.nip || '';
            }

            if (!signerNip && typeof window.getTeachersMapCache === 'function') {
                try {
                    const teachersMap = await window.getTeachersMapCache();
                    if (teachersMap instanceof Map) {
                        for (const [, t] of teachersMap.entries()) {
                            if (t && (t.name === signerName || (matchedUser && matchedUser.linkedTeacherId === t.id))) {
                                if (t.nip) {
                                    signerNip = t.nip;
                                    break;
                                }
                            }
                        }
                    }
                } catch (e) {}
            }
        }
    } else {
        roleTitle = 'Kepala Laboratorium,';
        if (!allKepalaLabAccounts || allKepalaLabAccounts.length === 0) {
            try { await loadAllKepalaLabData(); } catch (e) {}
        }
        if (allKepalaLabAccounts && allKepalaLabAccounts.length > 0) {
            signerName = allKepalaLabAccounts[0].nama || '';
            signerNip = allKepalaLabAccounts[0].nip || '';
        }
    }

    return {
        roleTitle,
        name: signerName || '...................................................',
        nip: signerNip ? String(signerNip).trim() : ''
    };
}

export function buildInventoryExportWorkbook(items = [], meta = {}, ExcelJSLib = null) {
    const Lib = ExcelJSLib || (typeof window !== 'undefined' && window.ExcelJS ? window.ExcelJS : (typeof ExcelJS !== 'undefined' ? ExcelJS : null));
    if (!Lib) {
        throw new Error('Pustaka ExcelJS tidak ditemukan untuk merender laporan cetak A4.');
    }

    const {
        schoolConfig = SCHOOL_CONFIG,
        labName = 'Semua Laboratorium',
        categoryName = 'Semua Kategori',
        locationName = 'Semua Lokasi',
        conditionLabel = 'Semua Kondisi',
        searchQuery = '',
        printDate = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
        labPicName = '',
        labPicNip = '',
        signerRoleTitle = '',
        kopImageBuffer = null
    } = meta;

    const wb = new Lib.Workbook();
    wb.creator = "SIMAS SMANTARA - E-Laboratorium";
    wb.created = new Date();

    const FONT_FAMILY = 'Times New Roman';
    const THIN_BORDER = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } }
    };
    const HEADER_FILL = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD9E2F3' } // Biru pastel kedinasan lembut
    };
    const SUMMARY_FILL = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF2F2F2' }
    };

    const LAST_COL_LETTER = 'N';
    const LAST_COL_INDEX = 14;

    const safeSheetTitle = (labName && labName !== 'Semua Laboratorium')
        ? `Inv_${labName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 25)}`
        : 'Inventaris Lab';

    const ws = wb.addWorksheet(safeSheetTitle, {
        pageSetup: {
            paperSize: 9, // A4 Standard
            orientation: 'landscape',
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0, // Tinggi mengalir alami ke bawah jika data banyak
            horizontalCentered: true,
            showGridLines: true,
            margins: { left: 0.35, right: 0.35, top: 0.5, bottom: 0.6, header: 0.25, footer: 0.25 },
            printTitlesRow: '11:12' // Header 2-tier berulang otomatis di setiap halaman lanjutan saat cetak
        },
        views: [{ showGridLines: true }],
        headerFooter: {
            oddFooter: `&L ${schoolConfig?.schoolName || "SMA Negeri Nusantara"} &C Halaman &P dari &N &R Dicetak: &D`
        }
    });

    // 1. KOP SURAT RESMI DARI ASSET (assets/kop.png)
    if (kopImageBuffer && typeof wb.addImage === 'function' && typeof ws.addImage === 'function') {
        const imageId = wb.addImage({
            buffer: kopImageBuffer,
            extension: 'png'
        });

        // Set tinggi baris 1 s/d 4 untuk wadah kop gambar asli
        for (let r = 1; r <= 4; r++) {
            ws.getRow(r).height = 24;
        }

        // Sematkan gambar kop: proporsional selebar tabel A4 Landscape
        ws.addImage(imageId, {
            tl: { col: 1.2, row: 0.1 },
            ext: { width: 740, height: 122 },
            editAs: 'oneCell'
        });
    } else {
        // Fallback teks kedinasan resmi jika gambar kop belum termuat
        ws.mergeCells(`A1:${LAST_COL_LETTER}1`);
        const c1 = ws.getCell('A1');
        const provinsiName = schoolConfig?.schoolProvince ? schoolConfig.schoolProvince.toUpperCase() : 'BALI';
        c1.value = `PEMERINTAH PROVINSI ${provinsiName}`;
        c1.font = { name: FONT_FAMILY, size: 10, bold: true };
        c1.alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getRow(1).height = 14;

        ws.mergeCells(`A2:${LAST_COL_LETTER}2`);
        const c2 = ws.getCell('A2');
        c2.value = 'DINAS PENDIDIKAN, KEPEMUDAAN DAN OLAHRAGA';
        c2.font = { name: FONT_FAMILY, size: 10, bold: true };
        c2.alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getRow(2).height = 14;

        ws.mergeCells(`A3:${LAST_COL_LETTER}3`);
        const c3 = ws.getCell('A3');
        c3.value = (schoolConfig?.schoolNameUpper || "SMA NEGERI NUSANTARA").toUpperCase();
        c3.font = { name: FONT_FAMILY, size: 14, bold: true };
        c3.alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getRow(3).height = 18;

        ws.mergeCells(`A4:${LAST_COL_LETTER}4`);
        const c4 = ws.getCell('A4');
        const alamat = schoolConfig?.schoolAddressFull || schoolConfig?.schoolAddress || "Jl. Nusantara No. 1, Denpasar 80234";
        const web = schoolConfig?.schoolWebsite ? ` | Website: ${schoolConfig.schoolWebsite}` : '';
        c4.value = `${alamat}${web}`;
        c4.font = { name: FONT_FAMILY, size: 8.5, italic: true };
        c4.alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getRow(4).height = 13;

        for (let col = 1; col <= LAST_COL_INDEX; col++) {
            ws.getCell(4, col).border = {
                bottom: { style: 'medium', color: { argb: 'FF000000' } }
            };
        }
    }

    // Baris 5: Spacing halus
    ws.getRow(5).height = 8;

    // 2. JUDUL DOKUMEN LAPORAN (Baris 6)
    ws.mergeCells(`A6:${LAST_COL_LETTER}6`);
    const c6 = ws.getCell('A6');
    const titleLabPart = (labName && labName !== 'Semua Laboratorium') ? ` - ${labName.toUpperCase()}` : '';
    c6.value = `DAFTAR INVENTARIS SARANA & PRASARANA LABORATORIUM${titleLabPart}`;
    c6.font = { name: FONT_FAMILY, size: 12, bold: true };
    c6.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(6).height = 18;

    // Baris 7: Spacing halus
    ws.getRow(7).height = 6;

    // 3. METADATA LAPORAN (Baris 8 & 9)
    const midCol = 9; // Kolom I

    // Baris 8
    ws.getCell('A8').value = 'Laboratorium';
    ws.getCell('A8').font = { name: FONT_FAMILY, size: 9.5, bold: true };
    ws.getCell('C8').value = `: ${labName}`;
    ws.getCell('C8').font = { name: FONT_FAMILY, size: 9.5 };

    ws.getCell(8, midCol).value = 'Tanggal Cetak';
    ws.getCell(8, midCol).font = { name: FONT_FAMILY, size: 9.5, bold: true };
    ws.getCell(8, midCol + 2).value = `: ${printDate}`;
    ws.getCell(8, midCol + 2).font = { name: FONT_FAMILY, size: 9.5 };

    // Baris 9
    ws.getCell('A9').value = 'Kategori / Lokasi';
    ws.getCell('A9').font = { name: FONT_FAMILY, size: 9.5, bold: true };
    ws.getCell('C9').value = `: ${categoryName} / ${locationName}`;
    ws.getCell('C9').font = { name: FONT_FAMILY, size: 9.5 };

    const totalJenis = items.length;
    const totalUnitAll = items.reduce((acc, it) => acc + (Number(it.qty_total) || 0), 0);
    ws.getCell(9, midCol).value = 'Total Rekapitulasi';
    ws.getCell(9, midCol).font = { name: FONT_FAMILY, size: 9.5, bold: true };
    ws.getCell(9, midCol + 2).value = `: ${totalJenis} Jenis Barang (${totalUnitAll} Unit)`;
    ws.getCell(9, midCol + 2).font = { name: FONT_FAMILY, size: 9.5 };

    [8, 9].forEach(r => {
        ws.getRow(r).height = 15;
        ws.getCell(`A${r}`).alignment = { horizontal: 'left', vertical: 'middle' };
        ws.getCell(`C${r}`).alignment = { horizontal: 'left', vertical: 'middle' };
        ws.getCell(r, midCol).alignment = { horizontal: 'left', vertical: 'middle' };
        ws.getCell(r, midCol + 2).alignment = { horizontal: 'left', vertical: 'middle' };
    });

    // Baris 10: Spacing sebelum tabel
    ws.getRow(10).height = 6;

    // 4. HEADER TABEL 2-TIER (Baris 11 & 12)
    ws.mergeCells('A11:A12'); ws.getCell('A11').value = 'NO';
    ws.mergeCells('B11:B12'); ws.getCell('B11').value = 'KODE BARANG';
    ws.mergeCells('C11:C12'); ws.getCell('C11').value = 'NAMA BARANG';
    ws.mergeCells('D11:D12'); ws.getCell('D11').value = 'SPESIFIKASI / MERK';
    ws.mergeCells('E11:E12'); ws.getCell('E11').value = 'KATEGORI';
    ws.mergeCells('F11:F12'); ws.getCell('F11').value = 'LABORATORIUM';
    ws.mergeCells('G11:G12'); ws.getCell('G11').value = 'LOKASI SIMPAN';

    // Grup Kondisi Barang di kolom H, I, J
    ws.mergeCells('H11:J11');
    ws.getCell('H11').value = 'RINCIAN KONDISI';
    ws.getCell('H12').value = 'BAIK (B)';
    ws.getCell('I12').value = 'RUSAK RINGAN (RR)';
    ws.getCell('J12').value = 'RUSAK BERAT (RB)';

    ws.mergeCells('K11:K12'); ws.getCell('K11').value = 'TOTAL';
    ws.mergeCells('L11:L12'); ws.getCell('L11').value = 'SATUAN';
    ws.mergeCells('M11:M12'); ws.getCell('M11').value = 'TAHUN';
    ws.mergeCells('N11:N12'); ws.getCell('N11').value = 'SUMBER DANA';

    for (let r = 11; r <= 12; r++) {
        const row = ws.getRow(r);
        row.height = 18;
        for (let c = 1; c <= LAST_COL_INDEX; c++) {
            const cell = ws.getCell(r, c);
            cell.font = { name: FONT_FAMILY, size: 9.5, bold: true };
            cell.fill = HEADER_FILL;
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            cell.border = THIN_BORDER;
        }
    }

    // 5. ISI DATA INVENTARIS (Baris 13 .. 13 + items.length - 1)
    let totalGood = 0;
    let totalMinor = 0;
    let totalMajor = 0;
    let totalQty = 0;

    items.forEach((item, idx) => {
        const rIdx = 13 + idx;
        const row = ws.getRow(rIdx);

        const good = Number(item.qty_good) || 0;
        const minor = Number(item.qty_minor_damage) || 0;
        const major = Number(item.qty_major_damage) || 0;
        const total = Number(item.qty_total) || (good + minor + major);

        totalGood += good;
        totalMinor += minor;
        totalMajor += major;
        totalQty += total;

        ws.getCell(rIdx, 1).value = idx + 1;
        ws.getCell(rIdx, 2).value = sanitizeExcelCellValue(item.inventory_code || '-');
        ws.getCell(rIdx, 3).value = sanitizeExcelCellValue(item.name || '-');
        ws.getCell(rIdx, 4).value = sanitizeExcelCellValue(item.specification || '-');
        ws.getCell(rIdx, 5).value = sanitizeExcelCellValue(item.category_name || item.kategori || '-');
        ws.getCell(rIdx, 6).value = sanitizeExcelCellValue(item.lab_nama || item.lab_name || '-');
        ws.getCell(rIdx, 7).value = sanitizeExcelCellValue(item.location_name || item.lokasi || '-');
        ws.getCell(rIdx, 8).value = good;
        ws.getCell(rIdx, 9).value = minor;
        ws.getCell(rIdx, 10).value = major;
        ws.getCell(rIdx, 11).value = total;
        ws.getCell(rIdx, 12).value = sanitizeExcelCellValue(item.unit || 'Unit');
        ws.getCell(rIdx, 13).value = sanitizeExcelCellValue(item.acquisition_year || '-');
        ws.getCell(rIdx, 14).value = sanitizeExcelCellValue(item.funding_source || '-');

        row.height = 16;
        for (let col = 1; col <= LAST_COL_INDEX; col++) {
            const cell = ws.getCell(rIdx, col);
            cell.font = {
                name: FONT_FAMILY,
                size: col === 4 ? 8.5 : 9.5,
                bold: col === 3 || col === 11
            };
            cell.border = THIN_BORDER;

            if (col === 1 || col === 2 || col === 12 || col === 13) {
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
            } else if (col === 3 || col === 4 || col === 5 || col === 6 || col === 7 || col === 14) {
                cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: col === 3 || col === 4 };
            } else if (col >= 8 && col <= 11) {
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
            }
        }
    });

    const lastDataRow = 12 + Math.max(items.length, 1);

    if (items.length === 0) {
        const emptyRow = ws.getRow(13);
        emptyRow.height = 20;
        ws.mergeCells(`A13:${LAST_COL_LETTER}13`);
        const cell = ws.getCell('A13');
        cell.value = 'Tidak ada barang inventaris yang sesuai dengan filter.';
        cell.font = { name: FONT_FAMILY, size: 9.5, italic: true };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        for (let col = 1; col <= LAST_COL_INDEX; col++) {
            ws.getCell(13, col).border = THIN_BORDER;
        }
    }

    // 6. BARIS REKAPITULASI TOTAL (Summary Row)
    const summaryRowIdx = lastDataRow + 1;
    ws.mergeCells(`A${summaryRowIdx}:G${summaryRowIdx}`);
    const summaryLabel = ws.getCell(`A${summaryRowIdx}`);
    summaryLabel.value = 'TOTAL REKAPITULASI UNIT';
    summaryLabel.font = { name: FONT_FAMILY, size: 9.5, bold: true };
    summaryLabel.alignment = { horizontal: 'center', vertical: 'middle' };

    ws.getCell(`H${summaryRowIdx}`).value = totalGood;
    ws.getCell(`I${summaryRowIdx}`).value = totalMinor;
    ws.getCell(`J${summaryRowIdx}`).value = totalMajor;
    ws.getCell(`K${summaryRowIdx}`).value = totalQty;
    ws.getCell(`L${summaryRowIdx}`).value = 'Unit';
    ws.getCell(`M${summaryRowIdx}`).value = '';
    ws.getCell(`N${summaryRowIdx}`).value = '';

    const summaryRow = ws.getRow(summaryRowIdx);
    summaryRow.height = 18;
    for (let col = 1; col <= LAST_COL_INDEX; col++) {
        const cell = ws.getCell(summaryRowIdx, col);
        cell.font = { name: FONT_FAMILY, size: 9.5, bold: true };
        cell.fill = SUMMARY_FILL;
        cell.border = {
            top: { style: 'medium', color: { argb: 'FF000000' } },
            left: { style: 'thin', color: { argb: 'FF000000' } },
            bottom: { style: 'medium', color: { argb: 'FF000000' } },
            right: { style: 'thin', color: { argb: 'FF000000' } }
        };
        if (col >= 8 && col <= 12) {
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
    }

    // 7. BLOK TANDA TANGAN RESMI PENGESAHAN (Signature Block)
    const ttdStartRow = summaryRowIdx + 2;
    const colKiri = 2;  // Kolom B
    const colKanan = 10; // Kolom J

    const schoolCity = schoolConfig?.schoolCity || 'Denpasar';
    const headTitle = schoolConfig?.headmasterTitle || `Kepala ${schoolConfig?.schoolName || "SMA Negeri Nusantara"}`;
    const headName = schoolConfig?.headmasterName || "Dr. I Wayan Sudarsana, M.Pd.";
    const headNip = schoolConfig?.headmasterNIP || "197501012000031001";

    // Penandatangan Kanan: Koordinator Lab (jika 1 lab) atau Kepala Lab (jika semua lab)
    const targetRoleTitle = signerRoleTitle || (labName && labName !== 'Semua Laboratorium'
        ? `Koordinator ${labName},`
        : 'Kepala Laboratorium,');

    ws.getCell(ttdStartRow, colKiri).value = 'Mengetahui,';
    ws.getCell(ttdStartRow, colKanan).value = `${schoolCity}, ${printDate}`;

    ws.getCell(ttdStartRow + 1, colKiri).value = headTitle;
    ws.getCell(ttdStartRow + 1, colKanan).value = targetRoleTitle;

    ws.getCell(ttdStartRow + 5, colKiri).value = headName;
    ws.getCell(ttdStartRow + 5, colKiri).font = { name: FONT_FAMILY, size: 9.5, bold: true, underline: true };
    ws.getCell(ttdStartRow + 5, colKanan).value = labPicName || '...................................................';
    ws.getCell(ttdStartRow + 5, colKanan).font = { name: FONT_FAMILY, size: 9.5, bold: true, underline: true };

    ws.getCell(ttdStartRow + 6, colKiri).value = `NIP. ${headNip}`;
    ws.getCell(ttdStartRow + 6, colKiri).font = { name: FONT_FAMILY, size: 9 };
    ws.getCell(ttdStartRow + 6, colKanan).value = labPicNip ? `NIP. ${labPicNip}` : 'NIP. -';
    ws.getCell(ttdStartRow + 6, colKanan).font = { name: FONT_FAMILY, size: 9 };

    for (let r = ttdStartRow; r <= ttdStartRow + 6; r++) {
        ws.getRow(r).height = 15;
        [colKiri, colKanan].forEach(c => {
            const cell = ws.getCell(r, c);
            if (!cell.font) cell.font = { name: FONT_FAMILY, size: 9.5 };
            cell.alignment = { horizontal: 'left', vertical: 'middle' };
        });
    }

    const lastRowAll = ttdStartRow + 6;
    ws.pageSetup.printArea = `A1:${LAST_COL_LETTER}${lastRowAll}`;

    // 8. PENGATURAN LEBAR KOLOM (Auto / Tuned Widths untuk Landscape A4)
    ws.getColumn(1).width = 4.5;   // No
    ws.getColumn(2).width = 15;    // Kode Barang
    ws.getColumn(3).width = 25;    // Nama Barang
    ws.getColumn(4).width = 23;    // Spesifikasi / Merk
    ws.getColumn(5).width = 13;    // Kategori
    ws.getColumn(6).width = 16;    // Lab
    ws.getColumn(7).width = 14;    // Lokasi Simpan
    ws.getColumn(8).width = 9.5;   // Baik
    ws.getColumn(9).width = 10.5;  // Rusak Ringan
    ws.getColumn(10).width = 10.5; // Rusak Berat
    ws.getColumn(11).width = 9.5;  // Total Unit
    ws.getColumn(12).width = 8;    // Satuan
    ws.getColumn(13).width = 8;    // Tahun
    ws.getColumn(14).width = 14;   // Sumber Dana

    return wb;
}

// Helper Pengambilan Seluruh Data Inventaris untuk Ekspor (Bypass Pagination)
async function fetchAllInventoryForExport() {
    const labId = currentInventoryLabFilter || '';
    const [sortBy, sortDir] = parseSortOption(currentInventorySort);
    const BATCH_LIMIT = 500;
    const allItems = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
        const batch = await cfClient.getInventoryItems({
            lab_id: labId,
            category_id: currentInventoryCategoryFilter || '',
            location_id: currentInventoryLocationFilter || '',
            condition: currentInventoryConditionFilter || 'all',
            search: inventorySearchQuery || '',
            limit: BATCH_LIMIT,
            offset: offset,
            sort_by: sortBy,
            sort_dir: sortDir
        });

        const batchItems = Array.isArray(batch) ? batch : (Array.isArray(batch?.items) ? batch.items : (Array.isArray(batch?.data) ? batch.data : []));
        allItems.push(...batchItems);

        const totalRecords = typeof batch?.total === 'number' ? batch.total : batchItems.length;
        offset += batchItems.length;

        if (batchItems.length < BATCH_LIMIT || offset >= totalRecords || batchItems.length === 0) {
            hasMore = false;
        }
    }

    return allItems;
}

window.exportInventoryExcel = async function () {
    const Lib = typeof window !== 'undefined' && window.ExcelJS ? window.ExcelJS : (typeof ExcelJS !== 'undefined' ? ExcelJS : null);
    if (!Lib) {
        if (typeof window.showToast === 'function') {
            window.showToast('Pustaka Belum Siap', 'Pustaka ExcelJS belum selesai dimuat. Silakan muat ulang halaman.', 'error');
        } else {
            alert('Pustaka ExcelJS belum siap. Silakan muat ulang halaman.');
        }
        return;
    }

    const btnExport = document.getElementById('btn-inv-export-excel');
    const originalBtnHtml = btnExport ? btnExport.innerHTML : '';
    if (btnExport) {
        btnExport.disabled = true;
        btnExport.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin text-xs"></i><span class="hidden sm:inline"> Mengekspor...</span>';
    }

    if (typeof window.showToast === 'function') {
        window.showToast('Menyiapkan Excel', 'Sedang mengumpulkan data inventaris siap cetak A4...', 'info');
    }

    try {
        const [items, kopBuffer, signer] = await Promise.all([
            fetchAllInventoryForExport(),
            fetchKopImageBuffer('assets/kop.png'),
            resolveInventorySigner(currentInventoryLabFilter)
        ]);

        if (!items || items.length === 0) {
            if (typeof window.showToast === 'function') {
                window.showToast('Data Kosong', 'Tidak ada data inventaris yang ditemukan pada filter saat ini.', 'warning');
            }
            return;
        }

        let selectedLabName = 'Semua Laboratorium';
        if (currentInventoryLabFilter) {
            const labObj = (labsList || []).find(l => l.id === currentInventoryLabFilter);
            if (labObj) selectedLabName = labObj.nama;
        }

        let selectedCategoryName = 'Semua Kategori';
        if (currentInventoryCategoryFilter) {
            const catObj = (inventoryCategories || []).find(c => c.id === currentInventoryCategoryFilter);
            if (catObj) selectedCategoryName = catObj.name;
        }

        let selectedLocationName = 'Semua Lokasi';
        if (currentInventoryLocationFilter) {
            const locObj = (inventoryLocations || []).find(l => l.id === currentInventoryLocationFilter);
            if (locObj) selectedLocationName = locObj.name;
        }

        const conditionMap = {
            'all': 'Semua Kondisi',
            'good': 'Baik (100% Siap Pakai)',
            'minor_damage': 'Ada Rusak Ringan',
            'major_damage': 'Ada Rusak Berat'
        };
        const conditionLabel = conditionMap[currentInventoryConditionFilter] || 'Semua Kondisi';

        const printDate = new Date().toLocaleDateString('id-ID', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });

        const workbook = buildInventoryExportWorkbook(items, {
            schoolConfig: SCHOOL_CONFIG,
            labName: selectedLabName,
            categoryName: selectedCategoryName,
            locationName: selectedLocationName,
            conditionLabel: conditionLabel,
            searchQuery: inventorySearchQuery,
            printDate: printDate,
            labPicName: signer.name,
            labPicNip: signer.nip,
            signerRoleTitle: signer.roleTitle,
            kopImageBuffer: kopBuffer
        }, Lib);

        const dateIso = new Date().toISOString().split('T')[0];
        const labSlug = selectedLabName.toLowerCase().replace(/[^a-z0-9]/g, '_');
        const filename = `Inventaris_${labSlug}_${dateIso}.xlsx`;

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const downloadUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(downloadUrl);

        if (typeof window.showToast === 'function') {
            window.showToast('Sukses Ekspor', `Berkas ${filename} siap cetak A4 berhasil diunduh.`, 'success');
        }
    } catch (err) {
        console.error('[E-Lab Inventory Export] Error:', err);
        if (typeof window.showToast === 'function') {
            window.showToast('Gagal Ekspor', err.message || 'Terjadi kesalahan saat mengekspor Excel.', 'error');
        }
    } finally {
        if (btnExport) {
            btnExport.disabled = false;
            btnExport.innerHTML = originalBtnHtml;
        }
    }
};

// ==================== EXPORT EXCEL PENGGUNAAN LABORATORIUM ====================

export function buildLabUsageExportWorkbook(bookings = [], meta = {}, ExcelJSLib = null) {
    const Lib = ExcelJSLib || (typeof window !== 'undefined' && window.ExcelJS ? window.ExcelJS : (typeof ExcelJS !== 'undefined' ? ExcelJS : null));
    if (!Lib) {
        throw new Error('Pustaka ExcelJS tidak ditemukan untuk merender laporan cetak A4.');
    }

    const {
        schoolConfig = SCHOOL_CONFIG,
        labName = 'Semua Laboratorium',
        startDate = '',
        endDate = '',
        printDate = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
        headmasterName = schoolConfig?.headmasterName || 'I Ketut Kertayasa, S.Pd., M.Pd.',
        headmasterNip = schoolConfig?.headmasterNIP || '',
        headmasterTitle = schoolConfig?.headmasterTitle || "Kepala SMA Negeri Nusantara",
        kepalaLabName = '',
        kepalaLabNip = '',
        koordinatorName = '',
        koordinatorNip = '',
        kopImageBuffer = null
    } = meta;

    const wb = new Lib.Workbook();
    wb.creator = "SIMAS SMANTARA - E-Laboratorium";
    wb.created = new Date();

    const FONT_FAMILY = 'Times New Roman';
    const THIN_BORDER = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } }
    };
    const HEADER_FILL = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD9E2F3' } // Biru pastel kedinasan lembut
    };
    const SUMMARY_FILL = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF2F2F2' }
    };

    const LAST_COL_LETTER = 'K';
    const LAST_COL_INDEX = 11;

    const safeSheetTitle = (labName && labName !== 'Semua Laboratorium')
        ? `Lap_${labName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 25)}`
        : 'Penggunaan Lab';

    const ws = wb.addWorksheet(safeSheetTitle, {
        pageSetup: {
            paperSize: 9, // A4 Standard
            orientation: 'landscape',
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0,
            horizontalCentered: true,
            showGridLines: true,
            margins: { left: 0.35, right: 0.35, top: 0.5, bottom: 0.6, header: 0.25, footer: 0.25 },
            printTitlesRow: '11:11' // Header kolom berulang di setiap halaman cetak lanjutan
        },
        views: [{ showGridLines: true }],
        headerFooter: {
            oddFooter: `&L ${schoolConfig?.schoolName || "SMA Negeri Nusantara"} &C Halaman &P dari &N &R Dicetak: &D`
        }
    });

    // 1. KOP SURAT RESMI
    if (kopImageBuffer && typeof wb.addImage === 'function' && typeof ws.addImage === 'function') {
        const imageId = wb.addImage({
            buffer: kopImageBuffer,
            extension: 'png'
        });
        for (let r = 1; r <= 4; r++) {
            ws.getRow(r).height = 24;
        }
        ws.addImage(imageId, {
            tl: { col: 0.8, row: 0.1 },
            ext: { width: 780, height: 122 },
            editAs: 'oneCell'
        });
    } else {
        ws.mergeCells(`A1:${LAST_COL_LETTER}1`);
        const c1 = ws.getCell('A1');
        const provinsiName = schoolConfig?.schoolProvince ? schoolConfig.schoolProvince.toUpperCase() : 'BALI';
        c1.value = `PEMERINTAH PROVINSI ${provinsiName}`;
        c1.font = { name: FONT_FAMILY, size: 10, bold: true };
        c1.alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getRow(1).height = 14;

        ws.mergeCells(`A2:${LAST_COL_LETTER}2`);
        const c2 = ws.getCell('A2');
        c2.value = 'DINAS PENDIDIKAN, KEPEMUDAAN DAN OLAHRAGA';
        c2.font = { name: FONT_FAMILY, size: 10, bold: true };
        c2.alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getRow(2).height = 14;

        ws.mergeCells(`A3:${LAST_COL_LETTER}3`);
        const c3 = ws.getCell('A3');
        c3.value = (schoolConfig?.schoolNameUpper || "SMA NEGERI NUSANTARA").toUpperCase();
        c3.font = { name: FONT_FAMILY, size: 14, bold: true };
        c3.alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getRow(3).height = 18;

        ws.mergeCells(`A4:${LAST_COL_LETTER}4`);
        const c4 = ws.getCell('A4');
        const alamat = schoolConfig?.schoolAddressFull || schoolConfig?.schoolAddress || "Jl. Nusantara No. 1, Denpasar 80234";
        const web = schoolConfig?.schoolWebsite ? ` | Website: ${schoolConfig.schoolWebsite}` : '';
        c4.value = `${alamat}${web}`;
        c4.font = { name: FONT_FAMILY, size: 8.5, italic: true };
        c4.alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getRow(4).height = 13;

        for (let col = 1; col <= LAST_COL_INDEX; col++) {
            ws.getCell(4, col).border = {
                bottom: { style: 'medium', color: { argb: 'FF000000' } }
            };
        }
    }

    // Baris 5: Spacing
    ws.getRow(5).height = 8;

    // 2. JUDUL DOKUMEN LAPORAN (Baris 6)
    ws.mergeCells(`A6:${LAST_COL_LETTER}6`);
    const c6 = ws.getCell('A6');
    const titleLabPart = (labName && labName !== 'Semua Laboratorium') ? ` - ${labName.toUpperCase()}` : '';
    c6.value = `REKAPITULASI PENGGUNAAN LABORATORIUM${titleLabPart}`;
    c6.font = { name: FONT_FAMILY, size: 12, bold: true };
    c6.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(6).height = 18;

    // Baris 7: Spacing
    ws.getRow(7).height = 6;

    // 3. METADATA LAPORAN (Baris 8 & 9)
    const midCol = 7; // Kolom G

    // Baris 8
    ws.getCell('A8').value = 'Laboratorium';
    ws.getCell('A8').font = { name: FONT_FAMILY, size: 9.5, bold: true };
    ws.getCell('C8').value = `: ${labName}`;
    ws.getCell('C8').font = { name: FONT_FAMILY, size: 9.5 };

    ws.getCell(8, midCol).value = 'Tanggal Cetak';
    ws.getCell(8, midCol).font = { name: FONT_FAMILY, size: 9.5, bold: true };
    ws.getCell(8, midCol + 2).value = `: ${printDate}`;
    ws.getCell(8, midCol + 2).font = { name: FONT_FAMILY, size: 9.5 };

    // Format Periode
    const formatIndoDate = (dateStr) => {
        if (!dateStr) return '';
        const d = new Date(dateStr + 'T00:00:00');
        if (isNaN(d)) return dateStr;
        return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    };
    const periodStr = (startDate && endDate)
        ? `${formatIndoDate(startDate)} s/d ${formatIndoDate(endDate)}`
        : (startDate ? `Mulai ${formatIndoDate(startDate)}` : 'Semua Periode');

    // Baris 9
    ws.getCell('A9').value = 'Periode Laporan';
    ws.getCell('A9').font = { name: FONT_FAMILY, size: 9.5, bold: true };
    ws.getCell('C9').value = `: ${periodStr}`;
    ws.getCell('C9').font = { name: FONT_FAMILY, size: 9.5 };

    const totalBookings = (bookings || []).length;
    let totalJP = 0;
    (bookings || []).forEach(b => {
        const sm = Number(b.jam_mulai);
        const se = Number(b.jam_selesai);
        if (!isNaN(sm) && !isNaN(se)) {
            totalJP += Math.max(1, se - sm + 1);
        } else {
            totalJP += 1;
        }
    });

    ws.getCell(9, midCol).value = 'Total Penggunaan';
    ws.getCell(9, midCol).font = { name: FONT_FAMILY, size: 9.5, bold: true };
    ws.getCell(9, midCol + 2).value = `: ${totalBookings} Sesi (${totalJP} JP)`;
    ws.getCell(9, midCol + 2).font = { name: FONT_FAMILY, size: 9.5 };

    for (let r = 8; r <= 9; r++) {
        ws.getRow(r).height = 14;
    }

    // Baris 10: Spacing
    ws.getRow(10).height = 6;

    // 4. HEADER TABEL 11 KOLOM (Baris 11)
    const HEADERS = [
        'NO',
        'HARI, TANGGAL',
        'SESI (JP)',
        'WAKTU (WITA)',
        'LABORATORIUM',
        'GURU PENGAJAR',
        'NIP',
        'KELAS',
        'MATA PELAJARAN / TOPIK PRAKTIKUM',
        'CATATAN PENGGUNAAN',
        'DIVERIFIKASI OLEH'
    ];

    const headerRow = ws.getRow(11);
    headerRow.height = 24;
    HEADERS.forEach((hText, idx) => {
        const colNum = idx + 1;
        const cell = headerRow.getCell(colNum);
        cell.value = hText;
        cell.font = { name: FONT_FAMILY, size: 9, bold: true };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.fill = HEADER_FILL;
        cell.border = THIN_BORDER;
    });

    // 5. ISI DATA
    const sortedBookings = [...(bookings || [])].sort((a, b) => {
        const dateCmp = String(a.tanggal || '').localeCompare(String(b.tanggal || ''));
        if (dateCmp !== 0) return dateCmp;
        return Number(a.jam_mulai || 0) - Number(b.jam_mulai || 0);
    });

    let currentRow = 12;

    if (sortedBookings.length === 0) {
        ws.mergeCells(`A${currentRow}:${LAST_COL_LETTER}${currentRow}`);
        const emptyCell = ws.getCell(`A${currentRow}`);
        emptyCell.value = 'Tidak ada data penggunaan laboratorium yang disetujui (ACC) pada periode ini.';
        emptyCell.font = { name: FONT_FAMILY, size: 9.5, italic: true };
        emptyCell.alignment = { horizontal: 'center', vertical: 'middle' };
        for (let c = 1; c <= LAST_COL_INDEX; c++) {
            ws.getCell(currentRow, c).border = THIN_BORDER;
        }
        ws.getRow(currentRow).height = 22;
        currentRow++;
    } else {
        sortedBookings.forEach((item, index) => {
            const row = ws.getRow(currentRow);
            row.height = 18;

            // 1. No
            const cellNo = row.getCell(1);
            cellNo.value = index + 1;
            cellNo.alignment = { horizontal: 'center', vertical: 'middle' };

            // 2. Hari, Tanggal
            const dObj = new Date((item.tanggal || '') + 'T00:00:00');
            const hName = !isNaN(dObj) ? dObj.toLocaleDateString('id-ID', { weekday: 'long' }) : (item.hari || '');
            const tStr = !isNaN(dObj) ? dObj.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' }) : (item.tanggal || '');
            const cellDate = row.getCell(2);
            cellDate.value = hName ? `${hName}, ${tStr}` : tStr;
            cellDate.alignment = { horizontal: 'center', vertical: 'middle' };

            // 3. Sesi JP
            const sm = item.jam_mulai;
            const se = item.jam_selesai;
            const jpText = (sm && se && sm !== se) ? `JP ${sm} - ${se}` : (sm ? `JP ${sm}` : '-');
            const cellJp = row.getCell(3);
            cellJp.value = jpText;
            cellJp.alignment = { horizontal: 'center', vertical: 'middle' };

            // 4. Waktu
            const startJpObj = JAM_PELAJARAN.find(j => j.jp === Number(sm));
            const endJpObj = JAM_PELAJARAN.find(j => j.jp === Number(se));
            const wMulai = item.waktu_mulai || (startJpObj ? startJpObj.mulai : '');
            const wSelesai = item.waktu_selesai || (endJpObj ? endJpObj.selesai : '');
            const cellWaktu = row.getCell(4);
            cellWaktu.value = (wMulai && wSelesai) ? `${wMulai} - ${wSelesai}` : (wMulai || '-');
            cellWaktu.alignment = { horizontal: 'center', vertical: 'middle' };

            // 5. Laboratorium
            const cellLab = row.getCell(5);
            cellLab.value = item.lab_nama || item.lab_name || item.lab_id || '-';
            cellLab.alignment = { horizontal: 'left', vertical: 'middle' };

            // 6. Guru Pengajar
            const cellGuru = row.getCell(6);
            cellGuru.value = item.pemohon_nama || item.guru_nama || '-';
            cellGuru.alignment = { horizontal: 'left', vertical: 'middle' };

            // 7. NIP
            const cellNip = row.getCell(7);
            cellNip.value = item.pemohon_nip ? String(item.pemohon_nip).trim() : '-';
            cellNip.alignment = { horizontal: 'center', vertical: 'middle' };

            // 8. Kelas
            const cellKelas = row.getCell(8);
            cellKelas.value = item.kelas || '-';
            cellKelas.alignment = { horizontal: 'center', vertical: 'middle' };

            // 9. Mapel / Topik
            const cellMapel = row.getCell(9);
            cellMapel.value = item.kegiatan || item.mapel || '-';
            cellMapel.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };

            // 10. Catatan
            const cellCatatan = row.getCell(10);
            cellCatatan.value = item.catatan || '-';
            cellCatatan.alignment = { horizontal: 'left', vertical: 'middle' };

            // 11. Diverifikasi Oleh
            const cellApprover = row.getCell(11);
            cellApprover.value = item.diproses_oleh || item.approved_by || 'Disetujui';
            cellApprover.alignment = { horizontal: 'center', vertical: 'middle' };

            // Styling & Zebra Stripe
            const isEven = (index % 2 === 1);
            for (let c = 1; c <= LAST_COL_INDEX; c++) {
                const cell = row.getCell(c);
                cell.font = { name: FONT_FAMILY, size: 8.5 };
                cell.border = THIN_BORDER;
                if (isEven) {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFF9FAFC' }
                    };
                }
            }

            currentRow++;
        });
    }

    // 6. BARIS TOTAL REKAPITULASI
    const sumRow = ws.getRow(currentRow);
    sumRow.height = 20;

    ws.mergeCells(`A${currentRow}:E${currentRow}`);
    const sumLabel = sumRow.getCell(1);
    sumLabel.value = 'TOTAL PENGGUNAAN LABORATORIUM';
    sumLabel.font = { name: FONT_FAMILY, size: 9, bold: true };
    sumLabel.alignment = { horizontal: 'center', vertical: 'middle' };

    const sumBookingsCell = sumRow.getCell(6);
    sumBookingsCell.value = `${totalBookings} Sesi Kegiatan`;
    sumBookingsCell.font = { name: FONT_FAMILY, size: 9, bold: true };
    sumBookingsCell.alignment = { horizontal: 'left', vertical: 'middle' };

    const sumJpCell = sumRow.getCell(7);
    sumJpCell.value = `${totalJP} JP`;
    sumJpCell.font = { name: FONT_FAMILY, size: 9, bold: true };
    sumJpCell.alignment = { horizontal: 'center', vertical: 'middle' };

    ws.mergeCells(`H${currentRow}:${LAST_COL_LETTER}${currentRow}`);

    for (let c = 1; c <= LAST_COL_INDEX; c++) {
        const cell = sumRow.getCell(c);
        cell.fill = SUMMARY_FILL;
        cell.border = {
            top: { style: 'thin', color: { argb: 'FF000000' } },
            left: { style: 'thin', color: { argb: 'FF000000' } },
            bottom: { style: 'double', color: { argb: 'FF000000' } },
            right: { style: 'thin', color: { argb: 'FF000000' } }
        };
    }

    currentRow += 2; // Jarak 1 baris kosong sebelum tanda tangan

    // 7. BLOK TANDA TANGAN BERTINGKAT (3 PIHAK)
    const schoolCity = schoolConfig?.schoolCity || 'Denpasar';
    const ttdAtasRow = currentRow;

    // Sisi Kiri Atas: Kepala Laboratorium
    ws.getCell(ttdAtasRow, 2).value = 'Mengetahui / Memeriksa,';
    ws.getCell(ttdAtasRow + 1, 2).value = 'Kepala Laboratorium,';
    ws.getCell(ttdAtasRow + 5, 2).value = kepalaLabName || '...................................................';
    ws.getCell(ttdAtasRow + 5, 2).font = { name: FONT_FAMILY, size: 9.5, bold: true, underline: true };
    ws.getCell(ttdAtasRow + 6, 2).value = kepalaLabNip ? `NIP. ${kepalaLabNip}` : 'NIP. -';
    ws.getCell(ttdAtasRow + 6, 2).font = { name: FONT_FAMILY, size: 9 };

    // Sisi Kanan Atas: Koordinator Laboratorium
    const koordTitle = (labName && labName !== 'Semua Laboratorium')
        ? `Koordinator ${labName},`
        : 'Koordinator Laboratorium,';

    ws.getCell(ttdAtasRow, 8).value = `${schoolCity}, ${printDate}`;
    ws.getCell(ttdAtasRow + 1, 8).value = koordTitle;
    ws.getCell(ttdAtasRow + 5, 8).value = koordinatorName || '...................................................';
    ws.getCell(ttdAtasRow + 5, 8).font = { name: FONT_FAMILY, size: 9.5, bold: true, underline: true };
    ws.getCell(ttdAtasRow + 6, 8).value = koordinatorNip ? `NIP. ${koordinatorNip}` : 'NIP. -';
    ws.getCell(ttdAtasRow + 6, 8).font = { name: FONT_FAMILY, size: 9 };

    for (let r = ttdAtasRow; r <= ttdAtasRow + 6; r++) {
        ws.getRow(r).height = 14;
        [2, 8].forEach(c => {
            const cell = ws.getCell(r, c);
            if (!cell.font) cell.font = { name: FONT_FAMILY, size: 9.5 };
            cell.alignment = { horizontal: 'left', vertical: 'middle' };
        });
    }

    // Baris Bawah: Tengah Kepala Sekolah (Mengetahui)
    const ttdBawahRow = ttdAtasRow + 8;
    const colTengah = 5; // Kolom E (tengah dokumen 11 kolom)

    ws.getCell(ttdBawahRow, colTengah).value = 'Mengetahui,';
    ws.getCell(ttdBawahRow + 1, colTengah).value = headmasterTitle;
    ws.getCell(ttdBawahRow + 5, colTengah).value = headmasterName;
    ws.getCell(ttdBawahRow + 5, colTengah).font = { name: FONT_FAMILY, size: 9.5, bold: true, underline: true };
    ws.getCell(ttdBawahRow + 6, colTengah).value = headmasterNip ? `NIP. ${headmasterNip}` : 'NIP. -';
    ws.getCell(ttdBawahRow + 6, colTengah).font = { name: FONT_FAMILY, size: 9 };

    for (let r = ttdBawahRow; r <= ttdBawahRow + 6; r++) {
        ws.getRow(r).height = 14;
        const cell = ws.getCell(r, colTengah);
        if (!cell.font) cell.font = { name: FONT_FAMILY, size: 9.5 };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
    }

    const lastRowAll = ttdBawahRow + 6;
    ws.pageSetup.printArea = `A1:${LAST_COL_LETTER}${lastRowAll}`;

    // 8. LEBAR KOLOM A4 LANDSCAPE
    ws.getColumn(1).width = 5;    // NO
    ws.getColumn(2).width = 18;   // HARI, TANGGAL
    ws.getColumn(3).width = 11;   // SESI (JP)
    ws.getColumn(4).width = 14;   // WAKTU
    ws.getColumn(5).width = 20;   // LABORATORIUM
    ws.getColumn(6).width = 26;   // GURU PENGAJAR
    ws.getColumn(7).width = 19;   // NIP
    ws.getColumn(8).width = 11;   // KELAS
    ws.getColumn(9).width = 30;   // MAPEL / TOPIK PRAKTIKUM
    ws.getColumn(10).width = 24;  // CATATAN PENGGUNAAN
    ws.getColumn(11).width = 18;  // DIVERIFIKASI OLEH

    return wb;
}

// Handler Pembuka Modal Export Penggunaan Lab
window.openBookingExportModal = function () {
    const canExport = isKepalaLab || isLabAdminUser() || isUserCoordinatorForAnyLab();
    if (!canExport) {
        if (typeof window.showToast === 'function') {
            window.showToast('Akses Dibatasi', 'Fitur ekspor dokumen resmi ini khusus untuk Pengelola & Koordinator Laboratorium.', 'warning');
        } else {
            alert('Akses dibatasi untuk Pengelola & Koordinator Laboratorium.');
        }
        return;
    }

    const modal = document.getElementById('modal-export-booking');
    if (!modal) return;

    // Set default rentang tanggal: 1 bulan kalender penuh berjalan (tanggal 1 s/d hari terakhir)
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const lastDayOfMonth = new Date(year, now.getMonth() + 1, 0).getDate();
    const defaultStart = `${year}-${month}-01`;
    const defaultEnd = `${year}-${month}-${String(lastDayOfMonth).padStart(2, '0')}`;

    const startInput = document.getElementById('export-booking-start');
    const endInput = document.getElementById('export-booking-end');
    if (startInput) startInput.value = defaultStart;
    if (endInput) endInput.value = defaultEnd;

    // Isi pilihan lab pada dropdown modal
    const labSelect = document.getElementById('export-booking-lab');
    if (labSelect) {
        let labHtml = '<option value="">Semua Laboratorium</option>';
        (labsList || []).forEach(l => {
            labHtml += `<option value="${l.id}">${l.nama}</option>`;
        });
        labSelect.innerHTML = labHtml;

        // Jika filter aktif di riwayat sudah memilih lab tertentu, selaraskan
        const activeRiwayatLab = document.getElementById('riwayat-filter-lab')?.value;
        if (activeRiwayatLab) {
            labSelect.value = activeRiwayatLab;
        }
    }

    modal.classList.remove('hidden');
};

// Handler Eksekusi Unduh Spreadsheet Penggunaan Lab
window.submitExportLabUsage = async function (event) {
    if (event) event.preventDefault();

    const Lib = typeof window !== 'undefined' && window.ExcelJS ? window.ExcelJS : (typeof ExcelJS !== 'undefined' ? ExcelJS : null);
    if (!Lib) {
        if (typeof window.showToast === 'function') {
            window.showToast('Pustaka Belum Siap', 'Pustaka ExcelJS belum selesai dimuat. Silakan muat ulang halaman.', 'error');
        } else {
            alert('Pustaka ExcelJS belum siap. Silakan muat ulang halaman.');
        }
        return;
    }

    const startDate = document.getElementById('export-booking-start')?.value;
    const endDate = document.getElementById('export-booking-end')?.value;
    const labId = document.getElementById('export-booking-lab')?.value || '';

    if (!startDate || !endDate) {
        if (typeof window.showToast === 'function') {
            window.showToast('Validasi Gagal', 'Harap isi tanggal mulai dan tanggal selesai.', 'warning');
        }
        return;
    }

    if (startDate > endDate) {
        if (typeof window.showToast === 'function') {
            window.showToast('Validasi Gagal', 'Tanggal mulai tidak boleh lebih besar dari tanggal selesai.', 'warning');
        }
        return;
    }

    const btnSubmit = document.getElementById('btn-submit-export-booking');
    const btnText = document.getElementById('btn-submit-export-booking-text');
    const originalText = btnText ? btnText.textContent : 'Unduh Spreadsheet (.xlsx)';

    if (btnSubmit) btnSubmit.disabled = true;
    if (btnText) btnText.textContent = 'Mengumpulkan Data...';

    if (typeof window.showToast === 'function') {
        window.showToast('Menyiapkan Laporan', 'Sedang mengambil data booking terverifikasi dari server...', 'info');
    }

    try {
        // Query data booking berstatus approved pada rentang tanggal
        const filter = {
            startDate,
            endDate,
            status: 'approved',
            limit: 3000
        };
        if (labId) filter.labId = labId;

        const bookings = await cfClient.getLabBookings(filter);
        const bookingList = Array.isArray(bookings) ? bookings : (Array.isArray(bookings?.data) ? bookings.data : []);

        if (btnText) btnText.textContent = 'Menyusun Excel...';

        // Resolusi Nama Lab Terpilih
        let selectedLabName = 'Semua Laboratorium';
        let labObj = null;
        if (labId) {
            labObj = (labsList || []).find(l => l.id === labId);
            if (labObj) selectedLabName = labObj.nama;
        }

        // Resolusi Signer (Kepala Lab & Koordinator)
        const kepalaLabSigner = await resolveInventorySigner('');
        let koordinatorSigner = { name: '', nip: '' };
        if (labId) {
            koordinatorSigner = await resolveInventorySigner(labId);
        } else {
            // Jika semua lab, gunakan koordinator yang sedang login jika ada, atau fallback terhormat
            const myCoordLabs = getAccessibleLabsForWrite();
            if (myCoordLabs && myCoordLabs.length > 0) {
                koordinatorSigner = await resolveInventorySigner(myCoordLabs[0].id);
            } else {
                koordinatorSigner = {
                    name: (currentUserDoc?.name || currentUserDoc?.nama || currentUser?.displayName || 'Koordinator Laboratorium'),
                    nip: currentUserDoc?.nip || ''
                };
            }
        }

        const kopBuffer = await fetchKopImageBuffer();

        const printDate = new Date().toLocaleDateString('id-ID', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });

        const workbook = buildLabUsageExportWorkbook(bookingList, {
            schoolConfig: SCHOOL_CONFIG,
            labName: selectedLabName,
            startDate: startDate,
            endDate: endDate,
            printDate: printDate,
            headmasterName: SCHOOL_CONFIG?.headmasterName || 'I Ketut Kertayasa, S.Pd., M.Pd.',
            headmasterNip: SCHOOL_CONFIG?.headmasterNIP || '',
            headmasterTitle: SCHOOL_CONFIG?.headmasterTitle || "Kepala SMA Negeri Nusantara",
            kepalaLabName: kepalaLabSigner?.name || '',
            kepalaLabNip: kepalaLabSigner?.nip || '',
            koordinatorName: koordinatorSigner?.name || '',
            koordinatorNip: koordinatorSigner?.nip || '',
            kopImageBuffer: kopBuffer
        }, Lib);

        const labSlug = selectedLabName.toLowerCase().replace(/[^a-z0-9]/g, '_');
        const filename = `Penggunaan_Lab_${labSlug}_${startDate}_sd_${endDate}.xlsx`;

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const downloadUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(downloadUrl);

        // Tutup modal export
        if (typeof window.closeModal === 'function') {
            window.closeModal('modal-export-booking');
        } else {
            document.getElementById('modal-export-booking')?.classList.add('hidden');
        }

        if (typeof window.showToast === 'function') {
            window.showToast('Sukses Ekspor', `Berkas ${filename} siap cetak A4 berhasil diunduh.`, 'success');
        }
    } catch (err) {
        console.error('[E-Lab Booking Export] Error:', err);
        if (typeof window.showToast === 'function') {
            window.showToast('Gagal Ekspor', err.message || 'Terjadi kesalahan saat mengekspor Excel penggunaan lab.', 'error');
        }
    } finally {
        if (btnSubmit) btnSubmit.disabled = false;
        if (btnText) btnText.textContent = originalText;
    }
};




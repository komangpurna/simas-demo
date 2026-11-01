/* js/page-presensi-guru.js - Input Presensi Guru Harian */

import { auth, db, PATHS, supabase } from './config.js';
import { cfClient } from './cloudflare-client.js';
import { initLayout, showToast, escapeHTML } from './global.js';
import { getScheduleForClassAndDate, normalizeTeacherName } from './asc-schedule-parser.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
    doc, getDoc, setDoc, updateDoc, serverTimestamp,
    collection, getDocs, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

// === CONFIG JP ===
const JP_TIME_CONFIG = [
    { jp: 1, start: '07:30', end: '08:15' },
    { jp: 2, start: '08:15', end: '09:00' },
    { jp: 3, start: '09:00', end: '09:45' },
    { jp: 4, start: '10:00', end: '10:45' },
    { jp: 5, start: '10:45', end: '11:30' },
    { jp: 6, start: '11:30', end: '12:15' },
    { jp: 7, start: '12:30', end: '13:15' },
    { jp: 8, start: '13:15', end: '14:00' },
    { jp: 9, start: '14:00', end: '14:45' },
    { jp: 10, start: '14:45', end: '15:30' }
];

const STATUS_OPTIONS = [
    { value: 'H', label: 'Hadir', color: 'bg-green-100 text-green-700' },
    { value: 'I', label: 'Izin', color: 'bg-blue-100 text-blue-700' },
    { value: 'S', label: 'Sakit', color: 'bg-yellow-100 text-yellow-700' },
    { value: 'K', label: 'Kegiatan', color: 'bg-purple-100 text-purple-700' },

    { value: 'TK', label: 'Tanpa Keterangan', color: 'bg-red-100 text-red-700' }
];


// === STATE ===
let currentUser = null;
let currentKelas = '';
let currentRole = '';
let mapelGuruConfig = {}; // Mapping mapel -> guru dari rapor_config
let mapelList = [];
let kelasList = []; // Untuk super_admin
let guruList = []; // Daftar guru untuk searchable input
let savedJP = {}; // Track JP yang sudah disimpan per tanggal
let savedJPData = {}; // Snapshot data Firestore per JP (1..10) untuk tanggal aktif
let currentDaySchedule = []; // Data jadwal XML aSc Timetables hari aktif untuk deteksi blok JP


// === INIT ===
onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash); return; }
    currentUser = user;

    // Cek role (dari cache terpusat)
    const cachedUserDoc = await window.getCurrentUserDoc();
    let role = localStorage.getItem('user_role');
    if (!role) {
        role = cachedUserDoc ? (cachedUserDoc.role || '') : '';
        localStorage.setItem('user_role', role);
    }
    currentRole = role;

    // Akses: admin_kelas, super_admin, atau wakasek_kurikulum
    const isKurikulumRole = cachedUserDoc && (
        (cachedUserDoc.additionalRoles && cachedUserDoc.additionalRoles.includes('wakasek_kurikulum')) ||
        cachedUserDoc.role === 'wakasek_kurikulum'
    );

    if (role !== 'admin_kelas' && role !== 'super_admin' && !isKurikulumRole) {
        showToast('Akses Ditolak', 'Halaman ini khusus Admin Kelas & Kurikulum.', 'error');
        setTimeout(() => window.location.href = 'dashboard.html', 1500);
        return;
    }


    // Ambil kelas user (dari cache, bukan getDoc ulang)
    if (cachedUserDoc) {
        currentKelas = cachedUserDoc.assignedClass || cachedUserDoc.class || '';
    }
    if (!currentKelas) {
        currentKelas = localStorage.getItem('user_assigned_class') || localStorage.getItem('user_handled_class') || '';
    }

    // Untuk super_admin, load daftar kelas dan render selector
    if (role === 'super_admin') {
        await loadKelasList();
        renderKelasSelector();
        if (!currentKelas && kelasList.length > 0) {
            currentKelas = kelasList[0];
        }
    }

    if (!currentKelas) {
        showToast('Error', 'Anda belum ditugaskan ke kelas manapun.', 'error');
        return;
    }

    updateKelasDisplay();

    // MULTI-ROLE: Ambil role tertinggi untuk halaman ini
    const effectiveRole = window.getEffectiveRoleForPage ?
        window.getEffectiveRoleForPage('presensi-guru.html') : role;
    initLayout(effectiveRole); // Gunakan role tertinggi
    document.querySelector('main').classList.remove('hidden');

    // Set tanggal hari ini (menggunakan waktu lokal, bukan UTC)
    const today = window.getLocalISODate(new Date());
    const inputTanggal = document.getElementById('input-tanggal');
    inputTanggal.value = today;

    // Admin kelas tidak boleh pilih tanggal masa depan
    if (role === 'admin_kelas') {
        inputTanggal.max = today;
    }

    // Load daftar guru (untuk searchable input)
    await loadGuruList();

    // Load config mapel-guru
    await loadMapelGuruConfig();

    // Load daftar guru BK
    await loadBkTeachers();

    // Render tabel JP
    renderJPTable();

    // Load existing data untuk hari ini
    await loadExistingData();

    // Event listener untuk perubahan tanggal
    document.getElementById('input-tanggal').addEventListener('change', async () => {
        renderJPTable(); // Re-render tabel karena blocked JP bisa berubah sesuai hari
        await loadExistingData();
    });
});

// === LOAD KELAS LIST (REFACTORED: Pakai Global Helper SSOT) ===
async function loadKelasList() {
    try {
        // Gunakan helper global terpusat (hemat Firestore, pakai cache)
        kelasList = await window.getActiveClasses();
    } catch (e) {
        console.error('Error loading kelas:', e);
        kelasList = [];
    }
}

// === RENDER KELAS SELECTOR (super_admin only) ===
function renderKelasSelector() {
    const container = document.getElementById('kelas-container');
    if (!container) return;

    const options = kelasList.map(k =>
        `<option value="${escapeHTML(k)}" ${k === currentKelas ? 'selected' : ''}>${escapeHTML(k)}</option>`
    ).join('');

    container.innerHTML = `
        <select id="select-kelas" onchange="onKelasChange(this.value)"
            class="bg-slate-800 text-white px-3 py-2 rounded-lg font-bold text-sm border-0 cursor-pointer">
            ${options}
        </select>
    `;
}

// === UPDATE KELAS DISPLAY ===
function updateKelasDisplay() {
    const kelasName = document.getElementById('kelas-name');
    if (kelasName) kelasName.textContent = currentKelas;
}

// === ON KELAS CHANGE (super_admin) ===
window.onKelasChange = async function (kelas) {
    currentKelas = kelas;
    updateKelasDisplay();
    await loadMapelGuruConfig();
    renderJPTable();
    await loadExistingData();
};

// === LOAD GURU LIST (untuk searchable input) ===
const GURU_CACHE_KEY = 'simas_guru_list_cache';
const GURU_CACHE_TTL = 30 * 60 * 60 * 1000; // 30 jam dalam milidetik

async function loadGuruList() {
    try {
        // Cek cache terlebih dahulu
        const cached = window.getLocalCache ? window.getLocalCache(GURU_CACHE_KEY, GURU_CACHE_TTL) : null;
        if (cached && cached.length > 0) {
            guruList = cached;
            console.log('📦 Guru list loaded from cache (' + guruList.length + ' teachers)');
            return;
        }

        // Cache expired atau tidak ada, gunakan global teachers cache
        const teachers = await window.getTeachersCache();

        guruList = [];
        const nonTeacherKeywords = ['tenaga kependidikan', 'tenaga administrasi sekolah', 'keamanan', 'kebersihan', 'satpam', 'penjaga', 'tata usaha', 'pegawai'];

        (teachers || []).forEach(data => {
            if (!data || !data.name) return;
            const jenisPtk = (data.jenis_ptk || '').toLowerCase();
            const role = (data.role || '').toLowerCase();
            const jabatanRaw = (data.jabatan || data.tugas_tambahan || '').toLowerCase();

            // Saring tenaga non-guru/tendik/keamanan murni
            const isExplicitNonTeacher = nonTeacherKeywords.some(kw => jenisPtk.includes(kw) || jabatanRaw.includes(kw)) &&
                !jenisPtk.includes('guru') && !role.includes('guru_bk') && !jenisPtk.includes('kepala sekolah');

            if (!isExplicitNonTeacher) {
                const jabatanLabel = (data.tugas_tambahan && data.tugas_tambahan !== '-' && data.tugas_tambahan !== 'Lainnya')
                    ? data.tugas_tambahan
                    : (data.jabatan || data.jenis_ptk || 'Guru');

                guruList.push({
                    id: data.id || data.nik || data.nip || '',
                    nik: data.nik || '',
                    name: data.name,
                    nip: data.nip || '',
                    jabatan: jabatanLabel
                });
            }
        });

        // Simpan ke cache
        if (window.setLocalCache) window.setLocalCache(GURU_CACHE_KEY, guruList);
        console.log('🔄 Guru list loaded from GTK SSOT & cached (' + guruList.length + ' teachers)');

    } catch (e) {
        console.error('Error loading guru list:', e);
    }
}

// Helper datalist dihapus karena menggunakan select dropdown

// === LOAD MAPEL-GURU CONFIG (dengan cache) ===
const MAPEL_CACHE_KEY = 'simas_mapel_config_cache';
const MAPEL_CACHE_TTL = 30 * 60 * 60 * 1000; // 30 jam dalam milidetik

async function loadMapelGuruConfig() {
    try {
        // Cek cache terlebih dahulu
        const cached = window.getLocalCache ? window.getLocalCache(MAPEL_CACHE_KEY, MAPEL_CACHE_TTL) : null;
        if (cached) {
            mapelList = cached.mapelListData || [];
            mapelGuruConfig = cached.mapelGuruConfigData || {};
            console.log('📦 Mapel config loaded from cache');
            return;
        }

        // Ambil dari Cloudflare D1 SSOT (0 Firestore Read)
        let data = null;
        if (cfClient && cfClient.enabled) {
            try {
                data = await cfClient.getRaporConfig();
                if (data && (data.mapel_list || data.mapel_guru)) {
                    console.log('⚡ Mapel config loaded from Cloudflare D1 SSOT');
                }
            } catch (cfErr) {
                console.error('[PresensiGuru] Gagal ambil config dari Cloudflare D1:', cfErr);
            }
        }

        if (data) {
            let list = [];
            if (Array.isArray(data.mapel_list) && data.mapel_list.length > 0) {
                list = data.mapel_list;
            } else if (Array.isArray(data.mapel_teori) && data.mapel_teori.length > 0) {
                list = data.mapel_teori;
            } else if (data.mapel_guru && typeof data.mapel_guru === 'object') {
                list = Object.keys(data.mapel_guru);
            }
            mapelList = list.filter(m => m && typeof m === 'string' && m.trim().length > 0)
                .sort((a, b) => a.localeCompare(b, 'id'));
            mapelGuruConfig = data.mapel_guru || {};

            // Simpan ke cache
            if (window.setLocalCache) {
                window.setLocalCache(MAPEL_CACHE_KEY, {
                    mapelListData: mapelList,
                    mapelGuruConfigData: mapelGuruConfig
                });
            }
        }
    } catch (e) {
        console.error('Error loading config:', e);
    }
}

// === LOAD BK TEACHERS ===
const BK_TEACHERS_CACHE_KEY = 'simas_bk_teachers_cache';
const BK_TEACHERS_CACHE_TTL = 30 * 60 * 60 * 1000; // 30 jam dalam milidetik
let bkTeachersList = [];

async function loadBkTeachers() {
    try {
        if (typeof window.getBkTeachersCache === 'function') {
            const list = await window.getBkTeachersCache();
            if (Array.isArray(list) && list.length > 0) {
                bkTeachersList = list;
                if (window.setLocalCache) {
                    window.setLocalCache(BK_TEACHERS_CACHE_KEY, bkTeachersList);
                }
                console.log('🔄 BK teachers loaded from SSOT getBkTeachersCache:', bkTeachersList.length);
                return bkTeachersList;
            }
        }

        const cached = window.getLocalCache ? window.getLocalCache(BK_TEACHERS_CACHE_KEY, BK_TEACHERS_CACHE_TTL) : null;
        if (cached && Array.isArray(cached) && cached.length > 0) {
            bkTeachersList = cached;
            console.log('📦 BK teachers loaded from cache:', bkTeachersList.length);
            return bkTeachersList;
        }

        const bkMap = new Map();

        // 1. Query user dengan primary role guru_bk
        try {
            const q1 = query(collection(db, PATHS.users), where('role', '==', 'guru_bk'));
            const snap1 = await getDocs(q1);
            snap1.forEach(docSnap => {
                const u = docSnap.data();
                if (u && (u.name || docSnap.id)) {
                    bkMap.set(docSnap.id, {
                        id: u.nik || u.linkedTeacherId || docSnap.id,
                        uid: docSnap.id,
                        nik: u.nik || '',
                        name: u.name || '',
                        nip: u.nip || '',
                        jabatan: 'Guru BK'
                    });
                }
            });
        } catch (errQ1) {
            console.warn('[PresensiGuru] Gagal query role guru_bk:', errQ1);
        }

        // 2. Query user dengan additionalRoles array-contains guru_bk
        try {
            const q2 = query(collection(db, PATHS.users), where('additionalRoles', 'array-contains', 'guru_bk'));
            const snap2 = await getDocs(q2);
            snap2.forEach(docSnap => {
                const u = docSnap.data();
                if (u && (u.name || docSnap.id) && !bkMap.has(docSnap.id)) {
                    bkMap.set(docSnap.id, {
                        id: u.nik || u.linkedTeacherId || docSnap.id,
                        uid: docSnap.id,
                        nik: u.nik || '',
                        name: u.name || '',
                        nip: u.nip || '',
                        jabatan: 'Guru BK'
                    });
                }
            });
        } catch (errQ2) {
            console.warn('[PresensiGuru] Gagal query additionalRoles guru_bk:', errQ2);
        }

        // 3. Fallback: Cocokkan dari data master guruList jika ada jabatan BK
        if (Array.isArray(guruList)) {
            guruList.forEach(g => {
                if (!g || !g.name) return;
                const jab = (g.jabatan || '').toLowerCase();
                const nm = (g.name || '').toLowerCase();
                if (jab.includes('bk') || jab.includes('bimbingan') || jab.includes('konseling') || nm.includes('guru bk')) {
                    let exists = false;
                    for (const existing of bkMap.values()) {
                        if (existing.id === g.id || (existing.name && existing.name.toLowerCase() === g.name.toLowerCase())) {
                            exists = true;
                            break;
                        }
                    }
                    if (!exists) {
                        bkMap.set(g.id, {
                            id: g.id,
                            uid: g.id,
                            name: g.name,
                            nip: g.nip || '',
                            jabatan: g.jabatan || 'Guru BK'
                        });
                    }
                }
            });
        }

        // 4. Fallback: Cocokkan dari mapelGuruConfig untuk mapel BK
        if (mapelGuruConfig) {
            const bkKeys = Object.keys(mapelGuruConfig).filter(k => {
                const lk = k.toLowerCase();
                return lk.includes('bk') || lk.includes('bimbingan');
            });
            bkKeys.forEach(k => {
                const val = mapelGuruConfig[k];
                if (Array.isArray(val)) {
                    val.forEach(item => {
                        if (item.uid && item.name) {
                            let exists = false;
                            for (const existing of bkMap.values()) {
                                if (existing.id === item.uid || existing.uid === item.uid || (existing.name && existing.name.toLowerCase() === item.name.toLowerCase())) {
                                    exists = true;
                                    break;
                                }
                            }
                            if (!exists) {
                                bkMap.set(item.uid, {
                                    id: item.uid,
                                    uid: item.uid,
                                    name: item.name,
                                    nip: item.nip || '',
                                    jabatan: 'Guru BK'
                                });
                            }
                        }
                    });
                }
            });
        }

        // Sinkronisasi data nama resmi dengan master guruList
        bkTeachersList = Array.from(bkMap.values()).map(bk => {
            const matchedGuru = guruList.find(g => g.id === bk.id || (g.name && normalizeTeacherName(g.name) === normalizeTeacherName(bk.name)));
            if (matchedGuru) {
                return {
                    id: matchedGuru.id,
                    uid: bk.uid || matchedGuru.id,
                    name: matchedGuru.name,
                    nip: matchedGuru.nip || bk.nip || '',
                    jabatan: matchedGuru.jabatan || 'Guru BK'
                };
            }
            return bk;
        }).filter(bk => bk.name && bk.name.trim().length > 0);

        if (window.setLocalCache && bkTeachersList.length > 0) {
            window.setLocalCache(BK_TEACHERS_CACHE_KEY, bkTeachersList);
        }

        console.log('🔄 BK teachers loaded & cached:', bkTeachersList.length);
        return bkTeachersList;
    } catch (e) {
        console.error('Error loading BK teachers:', e);
        return [];
    }
}

// Helper getter daftar guru BK
function getBkTeachers() {
    if (bkTeachersList && bkTeachersList.length > 0) {
        return bkTeachersList;
    }
    // Fallback instan dari guruList jika cache belum terisi
    return guruList.filter(g => {
        if (!g || !g.name) return false;
        const jab = (g.jabatan || '').toLowerCase();
        return jab.includes('bk') || jab.includes('bimbingan') || jab.includes('konseling');
    });
}

// === GET CURRENT JP ===
function getCurrentJP() {
    const now = new Date();
    const currentTime = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');

    for (const config of JP_TIME_CONFIG) {
        if (currentTime >= config.start && currentTime < config.end) {
            return config.jp;
        }
    }
    return null; // Di luar jam pelajaran
}

// === HELPER: Cek apakah JP ini diblokir ===
function isBlockedJP(jpNum, dayOfWeek) {
    // Senin (1) JP 1 = Upacara Bendera
    if (dayOfWeek === 1 && jpNum === 1) return {
        blocked: true, label: 'Upacara Bendera', icon: 'fa-flag',
        bgRow: 'bg-indigo-50', bgBadge: 'bg-indigo-600',
        textTitle: 'text-indigo-700', textSub: 'text-indigo-500'
    };
    // Jumat (5) JP 10 = Ekstrakurikuler
    if (dayOfWeek === 5 && jpNum === 10) return {
        blocked: true, label: 'Ekstrakurikuler', icon: 'fa-futbol',
        bgRow: 'bg-purple-50', bgBadge: 'bg-purple-600',
        textTitle: 'text-purple-700', textSub: 'text-purple-500'
    };
    return { blocked: false };
}

// === HELPER: Dapatkan JP Tertinggi yang sudah Tersimpan ===
function getMaxSavedJP() {
    let maxSaved = 0;
    for (let i = 1; i <= 10; i++) {
        if (savedJPData[i] && savedJPData[i].mapel && savedJPData[i].guru_nama && savedJPData[i].status) {
            maxSaved = i;
        }
    }
    return maxSaved;
}

// Helper normalisasi nama guru untuk perbandingan blok
function cleanTeacherNameForBlock(name) {
    if (!name) return '';
    return name.toLowerCase()
        .replace(/\b(drs|dr|m\.pd\.h|m\.pd|s\.pd\.h|s\.pd|s\.ag|s\.e|s\.kom|gr|m\.si|m\.m|h\.|hj\.|st|s\.t|s\.p|m\.p|tim|bk)\b/g, '')
        .replace(/[^a-z0-9]/g, '');
}

// Helper: Cek apakah 2 item JP berada dalam blok guru/mapel yang sama
function isSameTeacherBlock(item1, item2) {
    if (!item1 || !item2) return false;
    const g1 = (item1.guru_nama || item1.guruNama || '').trim();
    const g2 = (item2.guru_nama || item2.guruNama || '').trim();
    const m1 = (item1.mapel || '').trim().toLowerCase();
    const m2 = (item2.mapel || '').trim().toLowerCase();

    const c1 = cleanTeacherNameForBlock(g1);
    const c2 = cleanTeacherNameForBlock(g2);

    // Jika kedua JP memiliki nama guru
    if (c1 && c2) {
        if (c1 === c2 || c1.includes(c2) || c2.includes(c1)) {
            return true;
        }
        return false; // Nama guru berbeda = beda blok
    }

    // Jika nama guru belum terisi tapi nama mapel sama
    if (m1 && m2 && m1 === m2) {
        return true;
    }

    return false;
}

// Helper: Dapatkan item JP effective (dari savedJPData, schedule XML, atau DOM)
function getEffectiveJPItem(jpNum) {
    if (savedJPData[jpNum] && (savedJPData[jpNum].guru_nama || savedJPData[jpNum].mapel)) {
        return {
            guru_nama: savedJPData[jpNum].guru_nama || '',
            mapel: savedJPData[jpNum].mapel || ''
        };
    }
    if (currentDaySchedule && currentDaySchedule[jpNum - 1]) {
        const sched = currentDaySchedule[jpNum - 1];
        if (sched.guruNama || sched.mapel) {
            return {
                guru_nama: sched.guruNama || '',
                mapel: sched.mapel || ''
            };
        }
    }
    const guruEl = document.getElementById(`guru-${jpNum}`) || document.getElementById(`guru-d-${jpNum}`);
    const mapelEl = document.getElementById(`mapel-${jpNum}`) || document.getElementById(`mapel-d-${jpNum}`);
    const gVal = guruEl ? guruEl.value.trim() : '';
    const mVal = mapelEl ? mapelEl.value.trim() : '';
    if (gVal || mVal) {
        return {
            guru_nama: gVal,
            mapel: mVal
        };
    }
    return null;
}

// Helper: Dapatkan JP Tertinggi yang harus ditampilkan (Multi-JP Block Unlocking)
function getMaxJPToShow(dayOfWeek) {
    const maxSaved = getMaxSavedJP();

    // Cari JP pertama yang belum tersimpan dan tidak diblokir
    let firstUnsavedJP = null;
    for (let i = 1; i <= 10; i++) {
        if (isBlockedJP(i, dayOfWeek).blocked) continue;
        if (!savedJPData[i] || !savedJPData[i].mapel || !savedJPData[i].guru_nama || !savedJPData[i].status) {
            firstUnsavedJP = i;
            break;
        }
    }

    if (!firstUnsavedJP) {
        return 10; // Seluruh JP non-blocked sudah tersimpan
    }

    let blockEnd = firstUnsavedJP;
    const refItem = getEffectiveJPItem(firstUnsavedJP);

    if (refItem) {
        for (let j = firstUnsavedJP + 1; j <= 10; j++) {
            if (isBlockedJP(j, dayOfWeek).blocked) break;
            const itemJ = getEffectiveJPItem(j);
            if (itemJ && isSameTeacherBlock(refItem, itemJ)) {
                blockEnd = j;
            } else {
                break;
            }
        }
    }

    let maxShow = Math.max(maxSaved, blockEnd);

    // Pengecualian Hari Senin: JP 1 Upacara (blocked), min maxShow = 2
    if (dayOfWeek === 1 && maxShow < 2) {
        maxShow = 2;
    }
    if (maxShow < 1) {
        maxShow = 1;
    }
    return Math.min(maxShow, 10);
}

// Helper: Re-render otomatis jika pengisian guru/mapel memperluas blok JP
window.checkAndReRenderIfBlockExpanded = function () {
    const tanggalVal = document.getElementById('input-tanggal').value;
    if (!tanggalVal) return;
    const selectedDate = new Date(tanggalVal);
    const dayOfWeek = selectedDate.getDay();
    const computedMax = getMaxJPToShow(dayOfWeek);
    const renderedRows = document.querySelectorAll('#presensi-body tr[data-jp]');
    const uniqueJPCount = new Set(Array.from(renderedRows).map(r => r.getAttribute('data-jp'))).size;
    if (computedMax > uniqueJPCount) {
        renderJPTable();
        restoreJPTableValues();
    }
};


// === UPDATE STATUS BARIS JP (Saved vs Modified vs Unsaved) ===
window.updateJPRowStatus = function (jpNum) {
    const btnM = document.getElementById(`btn-save-${jpNum}`);
    const btnD = document.getElementById(`btn-save-d-${jpNum}`);
    const badgeM = document.getElementById(`jp-badge-${jpNum}`);
    const badgeD = document.getElementById(`jp-badge-d-${jpNum}`);
    const statusElM = document.getElementById(`status-jp-${jpNum}`);
    const statusElD = document.getElementById(`status-jp-d-${jpNum}`);

    if (!btnM && !btnD) return;

    // Ambil nilai saat ini dari DOM
    const mapelEl = document.getElementById(`mapel-${jpNum}`);
    const guruEl = document.getElementById(`guru-${jpNum}`);
    const guruIdEl = document.getElementById(`guru-id-${jpNum}`);
    const statusSelect = document.getElementById(`status-${jpNum}`);
    const tugasCheckbox = document.getElementById(`tugas-${jpNum}`);
    const kegiatanEl = document.getElementById(`kegiatan-${jpNum}`);

    const curMapel = mapelEl ? mapelEl.value : '';
    const curGuru = guruEl ? guruEl.value.trim() : '';
    const curStatus = statusSelect ? statusSelect.value : '';
    const curTugas = ['I', 'S', 'K'].includes(curStatus) && tugasCheckbox ? tugasCheckbox.checked : null;
    const curKegiatan = curStatus === 'K' && kegiatanEl ? kegiatanEl.value.trim() : '';

    const saved = savedJPData[jpNum];
    const isSaved = saved && saved.mapel && saved.guru_nama && saved.status;
    const isUnchanged = isSaved && (curMapel === saved.mapel) &&
        (curGuru === saved.guru_nama) &&
        (curStatus === saved.status) &&
        (curTugas === saved.ada_tugas) &&
        (curStatus !== 'K' || curKegiatan === (saved.keterangan || ''));

    if (isUnchanged) {
        // TERSIMPAN (Hijau) -> Sembunyikan tombol simpan, ubah warna badge JP menjadi Hijau
        if (btnM) btnM.classList.add('hidden');
        if (btnD) btnD.classList.add('hidden');

        if (badgeM) badgeM.className = 'bg-emerald-600 text-white w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs shrink-0 shadow-xs transition-colors duration-300';
        if (badgeD) badgeD.className = 'bg-emerald-600 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shadow-xs transition-colors duration-300';

        if (statusElM) { statusElM.innerHTML = ''; statusElM.classList.add('hidden'); }
        if (statusElD) { statusElD.innerHTML = ''; statusElD.classList.add('hidden'); }
    } else {
        // BELUM DISIMPAN / ADA PERUBAHAN (Kuning/Amber) -> Tampilkan tombol simpan, ubah warna badge JP menjadi Kuning
        if (btnM) {
            btnM.classList.remove('hidden');
            btnM.disabled = false;
            btnM.innerHTML = '<i class="fa-solid fa-check mr-1"></i>Simpan';
        }
        if (btnD) {
            btnD.classList.remove('hidden');
            btnD.disabled = false;
            btnD.innerHTML = '<i class="fa-solid fa-check"></i>';
            btnD.title = 'Simpan';
        }

        if (badgeM) badgeM.className = 'bg-amber-500 text-white w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs shrink-0 transition-colors duration-300';
        if (badgeD) badgeD.className = 'bg-amber-500 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm transition-colors duration-300';

        if (statusElM) { statusElM.innerHTML = ''; statusElM.classList.add('hidden'); }
        if (statusElD) { statusElD.innerHTML = ''; statusElD.classList.add('hidden'); }
    }
};

// === RESTORE VALUES INTO VISIBLE JP TABLE ROWS ===
function restoreJPTableValues() {
    const tanggal = document.getElementById('input-tanggal').value;
    if (!tanggal) return;

    const selectedDate = new Date(tanggal);
    const dayOfWeek = selectedDate.getDay();

    for (let i = 1; i <= 10; i++) {
        if (isBlockedJP(i, dayOfWeek).blocked) continue;

        const mapelM = document.getElementById(`mapel-${i}`);
        const mapelD = document.getElementById(`mapel-d-${i}`);
        const guruM = document.getElementById(`guru-${i}`);
        const guruD = document.getElementById(`guru-d-${i}`);
        const guruIdM = document.getElementById(`guru-id-${i}`);
        const guruIdD = document.getElementById(`guru-id-d-${i}`);
        const statusM = document.getElementById(`status-${i}`);
        const statusD = document.getElementById(`status-d-${i}`);

        if (!mapelM && !mapelD) continue; // JP ini belum terbuka/disembunyikan

        const jpData = savedJPData[i];
        if (jpData) {
            if (mapelM) setSelectMapelValue(mapelM, jpData.mapel || '');
            if (mapelD) setSelectMapelValue(mapelD, jpData.mapel || '');
            if (guruM) guruM.value = jpData.guru_nama || '';
            if (guruD) guruD.value = jpData.guru_nama || '';
            if (guruIdM) guruIdM.value = jpData.guru_id || '';
            if (guruIdD) guruIdD.value = jpData.guru_id || '';
            if (statusM) statusM.value = jpData.status || '';
            if (statusD) statusD.value = jpData.status || '';

            onStatusChange(i);

            if (jpData.keterangan) {
                const kegiatanM = document.getElementById(`kegiatan-${i}`);
                const kegiatanD = document.getElementById(`kegiatan-d-${i}`);
                if (kegiatanM) kegiatanM.value = jpData.keterangan;
                if (kegiatanD) kegiatanD.value = jpData.keterangan;
            }

            if (jpData.ada_tugas !== null && jpData.ada_tugas !== undefined) {
                const tugasCheckbox = document.getElementById(`tugas-${i}`);
                const tugasCheckboxD = document.getElementById(`tugas-d-${i}`);
                if (tugasCheckbox) tugasCheckbox.checked = jpData.ada_tugas;
                if (tugasCheckboxD) tugasCheckboxD.checked = jpData.ada_tugas;
            }
        }
        updateJPRowStatus(i);
    }
}

// === RENDER JP TABLE ===
function renderJPTable() {
    const tbody = document.getElementById('presensi-body');
    const activeJP = getCurrentJP();

    // Deteksi hari untuk blocked JP
    const tanggalVal = document.getElementById('input-tanggal').value;
    const selectedDateForDay = tanggalVal ? new Date(tanggalVal) : new Date();
    const dayOfWeek = selectedDateForDay.getDay();

    const maxSaved = getMaxSavedJP();
    // Multi-JP Block Unlocking: Tampilkan seluruh JP tersimpan + seluruh JP dalam blok pengajaran guru yang sama
    let maxJPToShow = getMaxJPToShow(dayOfWeek);

    let html = JP_TIME_CONFIG.filter(jp => jp.jp <= maxJPToShow).map(jp => {
        // Cek apakah JP ini diblokir (Senin JP1 / Jumat JP10)
        const blockInfo = isBlockedJP(jp.jp, dayOfWeek);
        if (blockInfo.blocked) {
            return `
            <!-- Mobile: Blocked JP -->
            <tr class="md:hidden border-b border-slate-200 ${blockInfo.bgRow}" data-jp="${jp.jp}">
                <td colspan="6" class="p-3">
                    <div class="flex items-center gap-3">
                        <span class="${blockInfo.bgBadge} text-white w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs shrink-0">
                            ${jp.jp}
                        </span>
                        <div class="flex-1 text-center">
                            <span class="${blockInfo.textTitle} font-bold text-sm">
                                <i class="fa-solid ${blockInfo.icon} mr-1"></i>${blockInfo.label}
                            </span>
                            <span class="${blockInfo.textSub} text-xs block">${jp.start} - ${jp.end}</span>
                        </div>
                    </div>
                </td>
            </tr>
            <!-- Desktop: Blocked JP -->
            <tr class="hidden md:table-row ${blockInfo.bgRow}" data-jp="${jp.jp}">
                <td class="px-4 py-3">
                    <span class="${blockInfo.bgBadge} text-white w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm">
                        ${jp.jp}
                    </span>
                </td>
                <td class="px-4 py-3 text-slate-500 font-mono text-xs">${jp.start} - ${jp.end}</td>
                <td colspan="4" class="px-4 py-3 text-center">
                    <span class="${blockInfo.textTitle} font-bold text-sm">
                        <i class="fa-solid ${blockInfo.icon} mr-1"></i>${blockInfo.label}
                    </span>
                </td>
            </tr>
            `;
        }

        const mapelOptions = mapelList.map(m => `<option value="${escapeHTML(m)}">${escapeHTML(m)}</option>`).join('');
        const statusOptions = STATUS_OPTIONS.map(s =>
            `<option value="${s.value}" class="text-left">${s.value} - ${s.label}</option>`
        ).join('');

        const isActive = activeJP === jp.jp;
        const activeMobileBg = isActive ? 'bg-emerald-50 dark:bg-emerald-900/40 border-l-4 border-l-emerald-500' : '';
        const activeDesktopBg = isActive ? 'bg-emerald-50 dark:bg-emerald-900/40' : '';
        const activeBadgeBg = isActive ? 'bg-emerald-600 animate-pulse' : 'bg-slate-800 dark:bg-slate-700';
        const activeIndicator = isActive ? ' 🔴' : '';

        // Cek apakah hari Senin (untuk skip tombol copy di JP 2)
        const tanggal = document.getElementById('input-tanggal').value;
        const selectedDate = tanggal ? new Date(tanggal) : new Date();
        const isMonday = selectedDate.getDay() === 1;

        const showCopyBtn = jp.jp > 1 && !(isMonday && jp.jp === 2);

        const copyBtnMobile = showCopyBtn ? `
                            <button onclick="copyFromAbove(${jp.jp})" title="Copy dari JP ${jp.jp - 1}"
                                class="bg-blue-100 text-blue-600 dark:bg-blue-800 dark:text-blue-300 w-7 h-7 rounded-lg text-xs hover:bg-blue-200 dark:hover:bg-blue-700 transition active:scale-95 shrink-0">
                                <i class="fa-solid fa-copy"></i>
                            </button>` : '';

        const copyBtnDesktop = showCopyBtn ? `
                    <button onclick="copyFromAbove(${jp.jp})" title="Copy dari JP ${jp.jp - 1}"
                        class="bg-blue-100 text-blue-600 dark:bg-blue-800 dark:text-blue-300 w-8 h-8 rounded-lg text-xs hover:bg-blue-200 dark:hover:bg-blue-700 transition active:scale-95">
                        <i class="fa-solid fa-copy"></i>
                    </button>` : '';

        return `
            <!-- Mobile: Card Layout -->
            <tr class="md:hidden border-b border-slate-200 dark:border-slate-700/50 ${activeMobileBg}" data-jp="${jp.jp}">
                <td colspan="6" class="p-3">
                    <div class="flex flex-col gap-2.5">
                        <!-- Row 1: JP Badge + Copy Btn + Mapel -->
                        <div class="flex items-center gap-2">
                            <span id="jp-badge-${jp.jp}" class="${activeBadgeBg} text-white w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs shrink-0 shadow-xs">
                                ${jp.jp}${activeIndicator}
                            </span>
                            ${copyBtnMobile}
                            <select id="mapel-${jp.jp}" onchange="syncField('mapel', ${jp.jp}, false)"
                                class="!p-2 text-xs border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 rounded-lg flex-1 min-w-0 font-medium">
                                <option value="">Pilih Mapel</option>
                                ${mapelOptions}
                            </select>
                        </div>
                        <!-- Row 2: Guru name (Searchable Combobox) -->
                        <div class="flex items-center gap-2">
                            <div class="relative flex-1 guru-combobox-container" data-jp="${jp.jp}">
                                <div class="relative">
                                    <input type="text" id="guru-${jp.jp}" placeholder="Pilih / Ketik Nama Guru"
                                        onfocus="window.showGuruDropdown(${jp.jp}, false)"
                                        oninput="window.filterGuruDropdown(${jp.jp}, false)"
                                        onclick="window.showGuruDropdown(${jp.jp}, false)"
                                        onblur="window.onGuruBlur(${jp.jp}, false)"
                                        autocomplete="off"
                                        class="!p-2 text-xs border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 rounded-lg w-full pr-8 focus:ring-2 focus:ring-emerald-500 outline-none">
                                    <i class="fa-solid fa-chevron-down absolute right-2.5 top-3 text-[10px] text-slate-400 pointer-events-none"></i>
                                </div>
                                <div id="guru-dropdown-${jp.jp}"
                                    class="hidden absolute left-0 right-0 top-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl max-h-[320px] overflow-y-auto z-[200] divide-y divide-slate-100 dark:divide-slate-700/50">
                                </div>
                            </div>
                            <input type="hidden" id="guru-id-${jp.jp}">
                        </div>
                        <!-- Row 3: Status + Tugas Toggle + Save -->
                        <div class="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                            <select id="status-${jp.jp}" onchange="syncField('status', ${jp.jp}, false)"
                                class="!p-2 text-xs border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 rounded-lg font-bold flex-1 min-w-[120px] text-left">
                                <option value="" class="text-left">Pilih Status</option>
                                ${statusOptions}
                            </select>
                            <!-- Tugas Toggle (hidden by default, shown on I/S/K) -->
                            <div id="tugas-wrapper-${jp.jp}" class="hidden items-center gap-1.5 shrink-0 bg-purple-50 dark:bg-purple-950/40 px-2 py-1 rounded-lg border border-purple-200 dark:border-purple-800/50">
                                <label for="tugas-${jp.jp}" class="inline-flex items-center gap-1.5 cursor-pointer select-none">
                                    <div class="relative inline-flex items-center">
                                        <input type="checkbox" id="tugas-${jp.jp}" onchange="syncField('tugas', ${jp.jp}, false); window.updateJPRowStatus(${jp.jp});" class="sr-only peer">
                                        <div class="w-7 h-4 bg-slate-300 dark:bg-slate-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-purple-600"></div>
                                    </div>
                                    <span class="text-[10px] font-bold text-purple-700 dark:text-purple-300">Tugas</span>
                                </label>
                            </div>
                            <button id="btn-save-${jp.jp}" onclick="saveJP(${jp.jp})"
                                class="bg-emerald-600 text-white px-3.5 py-2 rounded-lg text-xs font-bold hover:bg-emerald-700 transition active:scale-95 shrink-0 whitespace-nowrap shadow-xs">
                                <i class="fa-solid fa-check mr-1"></i>Simpan
                            </button>
                            <span id="status-jp-${jp.jp}" class="hidden shrink-0 whitespace-nowrap">
                            </span>
                        </div>
                        <!-- Row 4: Kegiatan Guru (Muncul saat status K) -->
                        <div id="kegiatan-wrapper-${jp.jp}" class="hidden flex-col gap-1 w-full bg-purple-50/70 dark:bg-purple-950/30 p-2.5 rounded-lg border border-purple-200 dark:border-purple-800/50 transition-all duration-200">
                            <label for="kegiatan-${jp.jp}" class="text-[11px] font-semibold text-purple-800 dark:text-purple-300 flex items-center gap-1.5">
                                <i class="fa-solid fa-briefcase text-purple-600 dark:text-purple-400"></i>
                                <span>Keterangan Kegiatan Guru:</span>
                            </label>
                            <input type="text" id="kegiatan-${jp.jp}" placeholder="Tuliskan kegiatan guru (cth: Rapat Dinas, Lomba, dll)"
                                oninput="syncField('kegiatan', ${jp.jp}, false); window.updateJPRowStatus(${jp.jp});"
                                class="!p-2 text-xs border border-purple-200 dark:border-purple-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-lg w-full focus:ring-2 focus:ring-purple-500 outline-none">
                        </div>
                    </div>
                </td>
            </tr>
            <!-- Desktop: Normal Table Row -->
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 hidden md:table-row ${activeDesktopBg}" data-jp="${jp.jp}">
                <td class="px-4 py-3">
                    <span id="jp-badge-d-${jp.jp}" class="${activeBadgeBg} text-white w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm">
                        ${jp.jp}${activeIndicator}
                    </span>
                </td>
                <td class="px-4 py-3 text-slate-500 font-mono text-xs">
                    ${jp.start} - ${jp.end}
                </td>
                <td class="px-4 py-3">
                    <select id="mapel-d-${jp.jp}" onchange="syncField('mapel', ${jp.jp}, true)"
                        class="!p-2 !text-sm border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 rounded-lg w-full">
                        <option value="">Pilih Mapel</option>
                        ${mapelOptions}
                    </select>
                </td>
                <td class="px-4 py-3">
                    <div class="relative w-full guru-combobox-container-d" data-jp="${jp.jp}">
                        <div class="relative">
                            <input type="text" id="guru-d-${jp.jp}" placeholder="Pilih / Ketik Nama Guru"
                                onfocus="window.showGuruDropdown(${jp.jp}, true)"
                                oninput="window.filterGuruDropdown(${jp.jp}, true)"
                                onclick="window.showGuruDropdown(${jp.jp}, true)"
                                onblur="window.onGuruBlur(${jp.jp}, true)"
                                autocomplete="off"
                                class="!p-2 !text-sm border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 rounded-lg w-full pr-8 focus:ring-2 focus:ring-emerald-500 outline-none">
                            <i class="fa-solid fa-chevron-down absolute right-2.5 top-3 text-xs text-slate-400 pointer-events-none"></i>
                        </div>
                        <div id="guru-dropdown-d-${jp.jp}"
                            class="hidden absolute left-0 right-0 top-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl max-h-[420px] overflow-y-auto z-[150] divide-y divide-slate-100 dark:divide-slate-700/50">
                        </div>
                    </div>
                    <input type="hidden" id="guru-id-d-${jp.jp}">
                </td>
                <td class="px-4 py-3 text-center">
                    <div class="flex flex-col items-center gap-1.5 w-full">
                        <select id="status-d-${jp.jp}" onchange="syncField('status', ${jp.jp}, true)"
                            class="!p-2 !text-sm border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 rounded-lg font-bold text-left w-full max-w-[150px]">
                            <option value="" class="text-left"></option>
                            ${statusOptions}
                        </select>
                        <!-- Tugas Toggle Desktop (hidden by default, shown on I/S/K) -->
                        <div id="tugas-wrapper-d-${jp.jp}" class="hidden items-center gap-1.5">
                            <label for="tugas-d-${jp.jp}" class="inline-flex items-center gap-1.5 cursor-pointer select-none" title="Memberi tugas ke siswa?">
                                <div class="relative inline-flex items-center">
                                    <input type="checkbox" id="tugas-d-${jp.jp}" onchange="syncField('tugas', ${jp.jp}, true); window.updateJPRowStatus(${jp.jp});" class="sr-only peer">
                                    <div class="w-8 h-4 bg-slate-300 dark:bg-slate-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-purple-600"></div>
                                </div>
                                <span class="text-[11px] font-semibold text-slate-700 dark:text-slate-300">Tugas</span>
                            </label>
                        </div>
                        <!-- Kegiatan Input Desktop (Muncul saat status K) -->
                        <div id="kegiatan-wrapper-d-${jp.jp}" class="hidden flex-col gap-1 w-full max-w-[180px] text-left">
                            <input type="text" id="kegiatan-d-${jp.jp}" placeholder="Keterangan kegiatan..."
                                oninput="syncField('kegiatan', ${jp.jp}, true); window.updateJPRowStatus(${jp.jp});"
                                class="!p-1.5 text-xs border border-purple-200 dark:border-purple-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-lg w-full focus:ring-2 focus:ring-purple-500 outline-none">
                        </div>
                    </div>
                </td>
                <td class="px-4 py-3 text-center flex items-center justify-center gap-1">
                    ${copyBtnDesktop}
                    <button id="btn-save-d-${jp.jp}" onclick="saveJP(${jp.jp})"
                        class="bg-emerald-600 text-white w-8 h-8 rounded-lg text-xs font-bold hover:bg-emerald-700 transition active:scale-95">
                        <i class="fa-solid fa-check"></i>
                    </button>
                    <span id="status-jp-d-${jp.jp}" class="hidden">
                    </span>
                </td>
            </tr>
        `;
    }).join('');

    // Tambah baris istirahat
    const istirahat1 = `
            <tr class="bg-amber-50 dark:bg-amber-900/20 border-y border-amber-200 dark:border-amber-800/50">
                <td colspan="6" class="px-4 py-2 text-center text-amber-700 dark:text-amber-400 text-xs font-bold">
                    <i class="fa-solid fa-mug-hot mr-1"></i> ISTIRAHAT 1 (09:45 - 10:00)
                </td>
            </tr>`;

    const istirahat2 = `
            <tr class="bg-amber-50 dark:bg-amber-900/20 border-y border-amber-200 dark:border-amber-800/50">
                <td colspan="6" class="px-4 py-2 text-center text-amber-700 dark:text-amber-400 text-xs font-bold">
                    <i class="fa-solid fa-utensils mr-1"></i> ISTIRAHAT 2 (12:15 - 13:00)
                </td>
            </tr>`;

    html = html.replace(/(<\/tr>)(\s*<tr[^>]*data-jp="4")/i, `$1${istirahat1}$2`);
    html = html.replace(/(<\/tr>)(\s*<tr[^>]*data-jp="7")/i, `$1${istirahat2}$2`);

    // Helper Unlock Row di bagian bawah tabel
    let helperHtml = '';
    let firstUnsavedJP = null;
    for (let i = 1; i <= 10; i++) {
        if (isBlockedJP(i, dayOfWeek).blocked) continue;
        if (!savedJPData[i] || !savedJPData[i].mapel || !savedJPData[i].guru_nama || !savedJPData[i].status) {
            firstUnsavedJP = i;
            break;
        }
    }

    if (maxSaved < 10 && firstUnsavedJP && firstUnsavedJP <= 10) {
        const nextBlock = isBlockedJP(firstUnsavedJP, dayOfWeek);
        if (nextBlock.blocked) {
            helperHtml = `
            <tr id="helper-unlock-row" class="bg-indigo-50/80 dark:bg-indigo-950/40 border-t border-b border-indigo-200 dark:border-indigo-800/50">
                <td colspan="6" class="px-4 py-3 text-center text-xs font-semibold text-indigo-800 dark:text-indigo-300">
                    <i class="fa-solid fa-circle-info text-indigo-500 mr-1.5"></i>
                    <span>JP ${firstUnsavedJP} (${nextBlock.label}) tidak memerlukan presensi. Presensi berlanjut ke JP berikutnya.</span>
                </td>
            </tr>`;
        } else {
            const nextJPToUnlock = Math.min(maxJPToShow + 1, 10);
            const jpText = maxJPToShow > firstUnsavedJP
                ? `JP ${firstUnsavedJP} s.d. ${maxJPToShow}`
                : `JP ${firstUnsavedJP}`;
            helperHtml = `
            <tr id="helper-unlock-row" class="bg-amber-50/80 dark:bg-amber-950/40 border-t border-b border-amber-200/70 dark:border-amber-800/40">
                <td colspan="6" class="px-4 py-3 text-center text-xs font-semibold text-amber-800 dark:text-amber-300">
                    <i class="fa-solid fa-lightbulb text-amber-500 mr-1.5 animate-pulse"></i>
                    <span>Silakan simpan presensi guru ${jpText} sebelum dapat mengisi presensi guru JP ${nextJPToUnlock}</span>
                </td>
            </tr>`;
        }
    } else if (maxSaved === 10 || !firstUnsavedJP) {
        helperHtml = `
        <tr id="helper-unlock-row" class="bg-emerald-50/80 dark:bg-emerald-950/40 border-t border-b border-emerald-200 dark:border-emerald-800/50">
            <td colspan="6" class="px-4 py-3 text-center text-xs font-bold text-emerald-800 dark:text-emerald-300">
                <i class="fa-solid fa-circle-check text-emerald-600 mr-1.5"></i>
                <span>Seluruh Jam Pelajaran (JP 1 s.d. 10) hari ini telah lengkap tersimpan!</span>
            </td>
        </tr>`;
    }

    tbody.innerHTML = html + helperHtml;
}

// Helper String Escape untuk Inline JS Handler
function escapeJsString(str) {
    if (!str) return '';
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// Helper: Penyesuaian Posisi Dropdown (Atas / Bawah secara Adaptif)
function adjustGuruDropdownPosition(input, dropdown) {
    if (!input || !dropdown) return;
    const rect = input.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;

    // Jika ruang di bawah kurang dari 420px dan ruang di atas lebih luas, munculkan di atas
    if (spaceBelow < 420 && spaceAbove > spaceBelow) {
        dropdown.classList.remove('top-full', 'mt-1');
        dropdown.classList.add('bottom-full', 'mb-1');
    } else {
        dropdown.classList.remove('bottom-full', 'mb-1');
        dropdown.classList.add('top-full', 'mt-1');
    }
}

// === SHOW GURU DROPDOWN ===
window.showGuruDropdown = function (jpNum, isDesktop) {
    // Sembunyikan dropdown guru di JP lain agar tidak menumpuk
    for (let i = 1; i <= 10; i++) {
        if (i !== jpNum) {
            const elM = document.getElementById(`guru-dropdown-${i}`);
            const elD = document.getElementById(`guru-dropdown-d-${i}`);
            if (elM) elM.classList.add('hidden');
            if (elD) elD.classList.add('hidden');
        }
    }

    const dropdownId = isDesktop ? `guru-dropdown-d-${jpNum}` : `guru-dropdown-${jpNum}`;
    const inputId = isDesktop ? `guru-d-${jpNum}` : `guru-${jpNum}`;
    const dropdown = document.getElementById(dropdownId);
    const input = document.getElementById(inputId);

    if (!dropdown) return;

    if (input) {
        input.classList.remove('ring-2', 'ring-rose-500', 'border-rose-500', 'bg-rose-50', 'dark:bg-rose-950/40', 'placeholder:text-rose-500');
        if (input.hasAttribute('data-orig-placeholder')) {
            input.placeholder = input.getAttribute('data-orig-placeholder');
        }
        adjustGuruDropdownPosition(input, dropdown);
    }
    dropdown.classList.remove('hidden');
    window.filterGuruDropdown(jpNum, isDesktop);
};

// === FILTER GURU DROPDOWN ===
window.filterGuruDropdown = function (jpNum, isDesktop) {
    const inputId = isDesktop ? `guru-d-${jpNum}` : `guru-${jpNum}`;
    const otherInputId = isDesktop ? `guru-${jpNum}` : `guru-d-${jpNum}`;
    const dropdownId = isDesktop ? `guru-dropdown-d-${jpNum}` : `guru-dropdown-${jpNum}`;

    const input = document.getElementById(inputId);
    const otherInput = document.getElementById(otherInputId);
    const dropdown = document.getElementById(dropdownId);

    if (!input || !dropdown) return;

    input.classList.remove('ring-2', 'ring-rose-500', 'border-rose-500', 'bg-rose-50', 'dark:bg-rose-950/40', 'placeholder:text-rose-500');
    if (otherInput) {
        otherInput.classList.remove('ring-2', 'ring-rose-500', 'border-rose-500', 'bg-rose-50', 'dark:bg-rose-950/40', 'placeholder:text-rose-500');
    }

    adjustGuruDropdownPosition(input, dropdown);

    const query = input.value.trim().toLowerCase();

    // Sync nilai ke input pasangan (desktop <-> mobile)
    if (otherInput && otherInput.value !== input.value) {
        otherInput.value = input.value;
    }

    // Reset ID guru terpilih saat user mengetik baru (wajib klik dari dropdown)
    const idInputM = document.getElementById(`guru-id-${jpNum}`);
    const idInputD = document.getElementById(`guru-id-d-${jpNum}`);
    if (idInputM) idInputM.value = "";
    if (idInputD) idInputD.value = "";

    const cleanGuruList = guruList;

    // Filter guru berdasarkan kata kunci pencarian
    const filtered = query
        ? cleanGuruList.filter(g => g.name.toLowerCase().includes(query) || (g.jabatan && g.jabatan.toLowerCase().includes(query)))
        : cleanGuruList;

    if (filtered.length === 0) {
        dropdown.innerHTML = `<div class="px-3 py-2 text-xs text-slate-400 text-center dark:text-slate-500"><i class="fa-solid fa-circle-exclamation mr-1"></i>Nama guru tidak ditemukan</div>`;
    } else {
        dropdown.innerHTML = filtered.map(g => {
            return `
            <div onpointerdown="window.selectGuruOption(${jpNum}, ${isDesktop}, '${escapeJsString(g.name)}', '${g.id}')" onclick="window.selectGuruOption(${jpNum}, ${isDesktop}, '${escapeJsString(g.name)}', '${g.id}')"
                class="px-3 py-2 text-xs md:text-sm text-slate-700 dark:text-slate-200 hover:bg-emerald-50 dark:hover:bg-emerald-900/40 cursor-pointer flex items-center justify-between transition">
                <span class="font-medium">${escapeHTML(g.name)}</span>
                ${g.jabatan ? `<span class="text-[10px] text-slate-400 px-1.5 py-0.5 rounded ml-2 shrink-0">${escapeHTML(g.jabatan)}</span>` : ''}
            </div>
            `;
        }).join('');
    }

    dropdown.classList.remove('hidden');
    window.onGuruChange(jpNum);
};


// === SELECT GURU OPTION ===
window.selectGuruOption = function (jpNum, isDesktop, guruName, guruId) {
    const inputM = document.getElementById(`guru-${jpNum}`);
    const inputD = document.getElementById(`guru-d-${jpNum}`);
    const idInputM = document.getElementById(`guru-id-${jpNum}`);
    const idInputD = document.getElementById(`guru-id-d-${jpNum}`);

    if (inputM) inputM.value = guruName;
    if (inputD) inputD.value = guruName;
    if (idInputM) idInputM.value = guruId || '';
    if (idInputD) idInputD.value = guruId || '';

    // Sembunyikan dropdown
    const dropM = document.getElementById(`guru-dropdown-${jpNum}`);
    const dropD = document.getElementById(`guru-dropdown-d-${jpNum}`);
    if (dropM) dropM.classList.add('hidden');
    if (dropD) dropD.classList.add('hidden');

    window.onGuruChange(jpNum);
};

// Helper pemberi penanda visual saat kolom input guru dikosongkan kembali
function markEmptyGuruInput(el) {
    if (!el) return;
    const origPl = el.getAttribute('data-orig-placeholder') || el.placeholder || 'Pilih / Ketik Nama Guru';
    if (!el.hasAttribute('data-orig-placeholder')) {
        el.setAttribute('data-orig-placeholder', origPl);
    }
    el.value = '';
    // Penanda merah menggantikan border & latar dasar (urutan CSS Tailwind build), lalu dipulihkan
    el.classList.remove('border-slate-200', 'dark:bg-slate-800');
    el.classList.add('ring-2', 'ring-rose-500', 'border-rose-500', 'bg-rose-50', 'dark:bg-rose-950/40', 'placeholder:text-rose-500');
    el.placeholder = '⚠️ Wajib klik nama dari daftar!';

    setTimeout(() => {
        el.classList.remove('ring-2', 'ring-rose-500', 'border-rose-500', 'bg-rose-50', 'dark:bg-rose-950/40', 'placeholder:text-rose-500');
        el.classList.add('border-slate-200', 'dark:bg-slate-800');
        el.placeholder = el.getAttribute('data-orig-placeholder') || origPl;
    }, 3000);
}

// Jika tidak ada guru yang diklik dari dropdown saat blur, kosongkan input kembali dan beri penanda visual
window.onGuruBlur = function (jpNum, isDesktop) {
    setTimeout(() => {
        const inputId = isDesktop ? `guru-d-${jpNum}` : `guru-${jpNum}`;
        const otherId = isDesktop ? `guru-${jpNum}` : `guru-d-${jpNum}`;
        const idInputM = document.getElementById(`guru-id-${jpNum}`);
        const idInputD = document.getElementById(`guru-id-d-${jpNum}`);
        const el = document.getElementById(inputId);
        const otherEl = document.getElementById(otherId);
        if (!el) return;

        const val = el.value.trim();

        const selectedId = (idInputM && idInputM.value) || (idInputD && idInputD.value) || '';

        // Pastikan nama dan ID sesuai dengan pilihan resmi dari dropdown
        let match = guruList.find(g => (selectedId && (g.id === selectedId || g.nik === selectedId || g.nip === selectedId)) || g.name.toLowerCase() === val.toLowerCase());
        if (!match && val) {
            const norm = normalizeTeacherName(val);
            if (norm) match = guruList.find(g => normalizeTeacherName(g.name) === norm);
        }

        if (match) {
            el.value = match.name;
            if (otherEl) otherEl.value = match.name;
            if (idInputM) idInputM.value = match.id;
            if (idInputD) idInputD.value = match.id;
        } else if (val) {
            markEmptyGuruInput(el);
            if (otherEl) markEmptyGuruInput(otherEl);
            if (idInputM) idInputM.value = '';
            if (idInputD) idInputD.value = '';
        }

        const dropM = document.getElementById(`guru-dropdown-${jpNum}`);
        const dropD = document.getElementById(`guru-dropdown-d-${jpNum}`);
        if (dropM) dropM.classList.add('hidden');
        if (dropD) dropD.classList.add('hidden');
    }, 250);
};

// Global listener click outside untuk menyembunyikan dropdown
document.addEventListener('click', (e) => {
    if (!e.target.closest('.guru-combobox-container') && !e.target.closest('.guru-combobox-container-d')) {
        for (let i = 1; i <= 10; i++) {
            const dropM = document.getElementById(`guru-dropdown-${i}`);
            const dropD = document.getElementById(`guru-dropdown-d-${i}`);
            if (dropM) dropM.classList.add('hidden');
            if (dropD) dropD.classList.add('hidden');
        }
    }
});

// === SYNC FIELD (untuk sinkronisasi bidirectional mobile-desktop) ===
window.syncField = function (type, jpNum, isFromDesktop = true) {
    if (type === 'mapel') {
        const srcId = isFromDesktop ? `mapel-d-${jpNum}` : `mapel-${jpNum}`;
        const tgtId = isFromDesktop ? `mapel-${jpNum}` : `mapel-d-${jpNum}`;
        const srcEl = document.getElementById(srcId);
        const tgtEl = document.getElementById(tgtId);
        if (srcEl && tgtEl) tgtEl.value = srcEl.value;
        onMapelChange(jpNum, isFromDesktop);
    } else if (type === 'guru') {
        const srcId = isFromDesktop ? `guru-d-${jpNum}` : `guru-${jpNum}`;
        const tgtId = isFromDesktop ? `guru-${jpNum}` : `guru-d-${jpNum}`;
        const srcEl = document.getElementById(srcId);
        const tgtEl = document.getElementById(tgtId);
        if (srcEl && tgtEl) tgtEl.value = srcEl.value;
        onGuruChange(jpNum);
    } else if (type === 'status') {
        const srcId = isFromDesktop ? `status-d-${jpNum}` : `status-${jpNum}`;
        const tgtId = isFromDesktop ? `status-${jpNum}` : `status-d-${jpNum}`;
        const srcEl = document.getElementById(srcId);
        const tgtEl = document.getElementById(tgtId);
        if (srcEl && tgtEl) tgtEl.value = srcEl.value;
        onStatusChange(jpNum, isFromDesktop);
    } else if (type === 'tugas') {
        const srcId = isFromDesktop ? `tugas-d-${jpNum}` : `tugas-${jpNum}`;
        const tgtId = isFromDesktop ? `tugas-${jpNum}` : `tugas-d-${jpNum}`;
        const srcEl = document.getElementById(srcId);
        const tgtEl = document.getElementById(tgtId);
        if (srcEl && tgtEl) tgtEl.checked = srcEl.checked;
    } else if (type === 'kegiatan') {
        const srcId = isFromDesktop ? `kegiatan-d-${jpNum}` : `kegiatan-${jpNum}`;
        const tgtId = isFromDesktop ? `kegiatan-${jpNum}` : `kegiatan-d-${jpNum}`;
        const srcEl = document.getElementById(srcId);
        const tgtEl = document.getElementById(tgtId);
        if (srcEl && tgtEl) tgtEl.value = srcEl.value;
    }
    window.updateJPRowStatus(jpNum);
};

// === ON STATUS CHANGE (toggle tugas field & kegiatan field) ===
window.onStatusChange = function (jpNum, isFromDesktop = false) {
    const srcId = isFromDesktop ? `status-d-${jpNum}` : `status-${jpNum}`;
    const tgtId = isFromDesktop ? `status-${jpNum}` : `status-d-${jpNum}`;
    const statusEl = document.getElementById(srcId);
    const targetStatusEl = document.getElementById(tgtId);
    if (!statusEl) return;
    const status = statusEl.value;
    if (targetStatusEl && targetStatusEl.value !== status) {
        targetStatusEl.value = status;
    }

    const tugasWrapper = document.getElementById(`tugas-wrapper-${jpNum}`);
    const tugasWrapperD = document.getElementById(`tugas-wrapper-d-${jpNum}`);
    const tugasCheckbox = document.getElementById(`tugas-${jpNum}`);
    const tugasCheckboxD = document.getElementById(`tugas-d-${jpNum}`);

    // Status yang perlu opsi tugas: I (Izin), S (Sakit), K (Kegiatan)
    const needTugas = ['I', 'S', 'K'].includes(status);

    if (needTugas) {
        // Tampilkan toggle tugas
        if (tugasWrapper) {
            tugasWrapper.classList.remove('hidden');
            tugasWrapper.classList.add('flex');
        }
        if (tugasWrapperD) {
            tugasWrapperD.classList.remove('hidden');
            tugasWrapperD.classList.add('flex');
        }
    } else {
        // Sembunyikan dan reset toggle tugas
        if (tugasWrapper) {
            tugasWrapper.classList.add('hidden');
            tugasWrapper.classList.remove('flex');
        }
        if (tugasWrapperD) {
            tugasWrapperD.classList.add('hidden');
            tugasWrapperD.classList.remove('flex');
        }
        if (tugasCheckbox) tugasCheckbox.checked = false;
        if (tugasCheckboxD) tugasCheckboxD.checked = false;
    }

    // Status Kegiatan (K): Tampilkan input keterangan kegiatan
    const kegiatanWrapper = document.getElementById(`kegiatan-wrapper-${jpNum}`);
    const kegiatanWrapperD = document.getElementById(`kegiatan-wrapper-d-${jpNum}`);
    const kegiatanInput = document.getElementById(`kegiatan-${jpNum}`);
    const kegiatanInputD = document.getElementById(`kegiatan-d-${jpNum}`);

    if (status === 'K') {
        if (kegiatanWrapper) {
            kegiatanWrapper.classList.remove('hidden');
            kegiatanWrapper.classList.add('flex');
        }
        if (kegiatanWrapperD) {
            kegiatanWrapperD.classList.remove('hidden');
            kegiatanWrapperD.classList.add('flex');
        }
    } else {
        if (kegiatanWrapper) {
            kegiatanWrapper.classList.add('hidden');
            kegiatanWrapper.classList.remove('flex');
        }
        if (kegiatanWrapperD) {
            kegiatanWrapperD.classList.add('hidden');
            kegiatanWrapperD.classList.remove('flex');
        }
        if (kegiatanInput) kegiatanInput.value = '';
        if (kegiatanInputD) kegiatanInputD.value = '';
    }
    window.updateJPRowStatus(jpNum);
};

// === ON MAPEL CHANGE ===
window.onMapelChange = function (jpNum, isFromDesktop = false) {
    const srcId = isFromDesktop ? `mapel-d-${jpNum}` : `mapel-${jpNum}`;
    const tgtId = isFromDesktop ? `mapel-${jpNum}` : `mapel-d-${jpNum}`;
    const mapelEl = document.getElementById(srcId);
    const targetMapelEl = document.getElementById(tgtId);
    const mapel = mapelEl ? mapelEl.value : '';
    if (targetMapelEl && targetMapelEl.value !== mapel) {
        targetMapelEl.value = mapel;
    }

    const guruInput = document.getElementById(`guru-${jpNum}`);
    const guruIdInput = document.getElementById(`guru-id-${jpNum}`);
    const guruInputD = document.getElementById(`guru-d-${jpNum}`);
    const guruIdInputD = document.getElementById(`guru-id-d-${jpNum}`);

    if (!mapel) {
        if (guruInput) guruInput.value = '';
        if (guruIdInput) guruIdInput.value = '';
        if (guruInputD) guruInputD.value = '';
        if (guruIdInputD) guruIdInputD.value = '';
        window.updateJPRowStatus(jpNum);
        return;
    }

    // Cari guru dari config mapel_guru (optional, sebagai suggestion)
    let gName = '';
    let gId = '';

    // 1. Format Modern: mapelGuruConfig[mapel] adalah Array [{ uid, name, kelas }]
    if (mapelGuruConfig && Array.isArray(mapelGuruConfig[mapel])) {
        const teacherMatch = mapelGuruConfig[mapel].find(g => Array.isArray(g.kelas) && g.kelas.includes(currentKelas));
        if (teacherMatch) {
            gName = teacherMatch.name || '';
            gId = teacherMatch.uid || '';
        }
    } else if (mapelGuruConfig && mapelGuruConfig[currentKelas] && mapelGuruConfig[currentKelas][mapel]) {
        // 2. Format Legacy: mapelGuruConfig[currentKelas][mapel]
        const guruData = mapelGuruConfig[currentKelas][mapel];
        if (guruData && guruData.name) {
            gName = guruData.name;
            gId = guruData.uid || '';
        }
    }

    // Fallback: Cari ID dari guruList jika ada nama tapi belum ada ID
    if (!gId && gName) {
        let match = guruList.find(g => g.name.toLowerCase() === gName.toLowerCase());
        if (!match) {
            const norm = normalizeTeacherName(gName);
            if (norm) match = guruList.find(g => normalizeTeacherName(g.name) === norm);
        }
        if (match) gId = match.id;
    }

    if (guruInput) guruInput.value = gName;
    if (guruIdInput) guruIdInput.value = gId;
    if (guruInputD) guruInputD.value = gName;
    if (guruIdInputD) guruIdInputD.value = gId;

    if (gName) {
        if (guruInput) guruInput.classList.add('bg-yellow-50');
        if (guruInputD) guruInputD.classList.add('bg-yellow-50');
        setTimeout(() => {
            if (guruInput) guruInput.classList.remove('bg-yellow-50');
            if (guruInputD) guruInputD.classList.remove('bg-yellow-50');
        }, 500);
    }
    window.updateJPRowStatus(jpNum);
    window.checkAndReRenderIfBlockExpanded();
};

// === ON GURU CHANGE ===
window.onGuruChange = function (jpNum, isFromDesktop = null) {
    const guruInput = document.getElementById(`guru-${jpNum}`);
    const guruIdInput = document.getElementById(`guru-id-${jpNum}`);
    const guruInputD = document.getElementById(`guru-d-${jpNum}`);
    const guruIdInputD = document.getElementById(`guru-id-d-${jpNum}`);

    let name = '';
    if (isFromDesktop === true && guruInputD) {
        name = guruInputD.value.trim();
        if (guruInput) guruInput.value = guruInputD.value;
    } else if (isFromDesktop === false && guruInput) {
        name = guruInput.value.trim();
        if (guruInputD) guruInputD.value = guruInput.value;
    } else {
        name = (guruInputD?.value?.trim() || guruInput?.value?.trim() || '');
        if (guruInput && !guruInput.value && name) guruInput.value = name;
        if (guruInputD && !guruInputD.value && name) guruInputD.value = name;
    }

    if (!name) {
        if (guruIdInput) guruIdInput.value = '';
        if (guruIdInputD) guruIdInputD.value = '';
        window.updateJPRowStatus(jpNum);
        return;
    }

    // Cari id guru dari list
    let match = guruList.find(g => g.name.toLowerCase() === name.toLowerCase());
    if (!match) {
        const norm = normalizeTeacherName(name);
        if (norm) match = guruList.find(g => normalizeTeacherName(g.name) === norm);
    }
    const gid = match ? match.id : '';
    if (guruIdInput) guruIdInput.value = gid;
    if (guruIdInputD) guruIdInputD.value = gid;
    window.updateJPRowStatus(jpNum);
    window.checkAndReRenderIfBlockExpanded();
};

// === SAVE JP (PER BARIS) ===
window.saveJP = async function (jpNum) {
    const tanggal = document.getElementById('input-tanggal').value;
    if (!tanggal) {
        showToast('Error', 'Pilih tanggal terlebih dahulu!', 'error');
        return;
    }

    // Cek apakah JP ini diblokir (Senin JP1 / Jumat JP10)
    const selectedDateCheck = new Date(tanggal);
    const blockInfo = isBlockedJP(jpNum, selectedDateCheck.getDay());
    if (blockInfo.blocked) {
        showToast('Info', `JP ${jpNum} tidak bisa diisi karena ${blockInfo.label}.`, 'info');
        return;
    }

    const mapel = document.getElementById(`mapel-${jpNum}`).value;
    if (!mapel) {
        showToast('Peringatan', 'Pilih mata pelajaran terlebih dahulu!', 'warning');
        return;
    }

    // Validasi: Nama guru wajib diisi
    const guruNama = (document.getElementById(`guru-d-${jpNum}`)?.value || document.getElementById(`guru-${jpNum}`)?.value || '').trim();
    const guruId = document.getElementById(`guru-id-d-${jpNum}`)?.value || document.getElementById(`guru-id-${jpNum}`)?.value || '';

    if (!guruNama) {
        showToast('Peringatan', 'Nama guru wajib diisi!', 'warning');
        const targetInput = document.getElementById(`guru-d-${jpNum}`) || document.getElementById(`guru-${jpNum}`);
        if (targetInput) targetInput.focus();
        return;
    }

    // Jika guruList belum siap/kosong, coba reload
    if (!guruList || guruList.length === 0) {
        await loadGuruList();
    }

    // Validasi: Nama guru harus sesuai daftar, tidak boleh ngetik bebas (manual)
    let matchedGuru = guruList.find(g => (guruId && (g.id === guruId || g.nik === guruId || g.nip === guruId)) || g.name.toLowerCase() === guruNama.toLowerCase());
    if (!matchedGuru) {
        const norm = normalizeTeacherName(guruNama);
        if (norm) matchedGuru = guruList.find(g => normalizeTeacherName(g.name) === norm);
    }
    // Fallback: Cari di master window.getTeachersCacheSync() jika belum cocok di guruList
    if (!matchedGuru && typeof window.getTeachersCacheSync === 'function') {
        const allGtk = window.getTeachersCacheSync() || [];
        const norm = normalizeTeacherName(guruNama);
        const matchGtk = allGtk.find(g => (guruId && (g.id === guruId || g.nik === guruId || g.nip === guruId)) ||
            (g.name && g.name.toLowerCase() === guruNama.toLowerCase()) ||
            (norm && g.name && normalizeTeacherName(g.name) === norm));
        if (matchGtk) {
            matchedGuru = {
                id: matchGtk.id || matchGtk.nik || matchGtk.nip || '',
                name: matchGtk.name,
                nip: matchGtk.nip || '',
                jabatan: matchGtk.tugas_tambahan || matchGtk.jabatan || matchGtk.jenis_ptk || 'Guru'
            };
        }
    }
    if (!matchedGuru) {
        showToast('Peringatan', 'Pilih nama guru resmi dari daftar yang tersedia! Tidak boleh mengetik nama manual.', 'warning');
        const guruInputElM = document.getElementById(`guru-${jpNum}`);
        const guruInputElD = document.getElementById(`guru-d-${jpNum}`);
        [guruInputElM, guruInputElD].forEach(el => {
            if (!el) return;
            el.classList.remove('dark:bg-slate-800'); // latar merah mode gelap menggantikan latar dasar
            el.classList.add('bg-red-50', 'dark:bg-red-900/30');
            setTimeout(() => {
                el.classList.remove('bg-red-50', 'dark:bg-red-900/30');
                el.classList.add('dark:bg-slate-800');
            }, 1000);
        });
        if (guruInputElD && guruInputElD.offsetParent !== null) {
            guruInputElD.focus();
        } else if (guruInputElM) {
            guruInputElM.focus();
        }
        return;
    }

    // Validasi: JP sebelumnya harus sudah disimpan (kecuali JP 1)
    const selectedDate = new Date(tanggal);
    const dayOfWeekSave = selectedDate.getDay();
    const isMonday = dayOfWeekSave === 1; // 0 = Minggu, 1 = Senin
    const prevBlocked = isBlockedJP(jpNum - 1, dayOfWeekSave).blocked;
    const skipValidation = (isMonday && jpNum === 2) || prevBlocked; // Skip jika JP sebelumnya diblokir

    if (jpNum > 1 && !skipValidation && !savedJP[tanggal]?.[jpNum - 1]) {
        showToast('Peringatan', `JP ${jpNum - 1} belum disimpan!`, 'warning');
        return;
    }

    // Validasi: Status wajib dipilih
    const status = document.getElementById(`status-${jpNum}`).value;
    if (!status) {
        showToast('Peringatan', 'Status kehadiran wajib dipilih!', 'warning');
        document.getElementById(`status-${jpNum}`).focus();
        return;
    }

    // Validasi: Jika status Kegiatan (K), keterangan kegiatan wajib diisi
    const kegiatanVal = (document.getElementById(`kegiatan-${jpNum}`)?.value || document.getElementById(`kegiatan-d-${jpNum}`)?.value || '').trim();
    if (status === 'K' && !kegiatanVal) {
        showToast('Peringatan', 'Keterangan kegiatan guru wajib diisi!', 'warning');
        const kInputM = document.getElementById(`kegiatan-${jpNum}`);
        const kInputD = document.getElementById(`kegiatan-d-${jpNum}`);
        if (kInputM && !kInputM.classList.contains('hidden')) {
            kInputM.focus();
        } else if (kInputD) {
            kInputD.focus();
        }
        return;
    }

    const btn = document.getElementById(`btn-save-${jpNum}`);
    const btnD = document.getElementById(`btn-save-d-${jpNum}`);
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; }
    if (btnD) { btnD.disabled = true; btnD.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; }

    const [year, month, day] = tanggal.split('-');
    const monthKey = `${year}-${month}`;

    // Cek apakah status butuh field tugas: I (Izin), S (Sakit), K (Kegiatan)
    const needTugas = ['I', 'S', 'K'].includes(status);
    const adaTugas = needTugas ? document.getElementById(`tugas-${jpNum}`).checked : null;
    const keteranganKegiatan = status === 'K' ? kegiatanVal : null;

    const resolvedGuruId = (matchedGuru && (matchedGuru.nik || matchedGuru.id || matchedGuru.nip)) ? (matchedGuru.nik || matchedGuru.id || matchedGuru.nip) : (guruId || '');

    const jpData = {
        mapel: mapel,
        guru_id: resolvedGuruId,
        guru_nama: matchedGuru?.name || guruNama || '',
        status: status,
        ada_tugas: adaTugas, // null jika status H/TK, true/false jika I/S/K
        keterangan: keteranganKegiatan
    };

    try {
        if (!supabase) {
            throw new Error('Koneksi Supabase belum terinisialisasi.');
        }

        const cleanClassSlug = currentKelas.replace(/\s+/g, '_');
        const sbId = `${cleanClassSlug}_${tanggal}_${jpNum}`;
        const upsertRow = {
            id: sbId,
            kelas: currentKelas,
            tanggal: tanggal,
            jp: jpNum,
            mapel: mapel,
            guru_id: guruId || null,
            guru_nama: guruNama,
            status: status,
            ada_tugas: adaTugas,
            keterangan: keteranganKegiatan,
            created_by: currentUser.uid,
            updated_at: new Date().toISOString()
        };
        let { error: sbUpsertErr } = await supabase.from('guru_presensi').upsert(upsertRow, { onConflict: 'kelas,tanggal,jp' });

        // Fallback: kolom keterangan belum ada di DB (migrasi 202610130001 belum dijalankan)
        if (sbUpsertErr && /keterangan/i.test(sbUpsertErr.message || '')) {
            console.warn('[PresensiGuru] Kolom keterangan belum tersedia, simpan ulang tanpa keterangan.');
            const { keterangan, ...rowTanpaKeterangan } = upsertRow;
            ({ error: sbUpsertErr } = await supabase.from('guru_presensi').upsert(rowTanpaKeterangan, { onConflict: 'kelas,tanggal,jp' }));
        }

        if (sbUpsertErr) {
            throw new Error(`Gagal menyimpan ke Supabase: ${sbUpsertErr.message}`);
        }

        console.log(`✅ [PresensiGuru] Supabase upsert OK: JP ${jpNum} (${currentKelas})`);

        if (typeof window.logAudit === 'function') {
            const ketLog = keteranganKegiatan ? ` (Kegiatan: ${keteranganKegiatan})` : '';
            window.logAudit('SAVE_GURU_PRESENSI', `${currentKelas}_${tanggal}_JP${jpNum}`, null, jpData, `Input presensi guru ${currentKelas} tanggal ${tanggal} JP${jpNum}: ${jpData.guru_nama} (${jpData.mapel}) - ${jpData.status}${ketLog}`);
        }

        // Simpan ke memori snapshot
        if (!savedJP[tanggal]) savedJP[tanggal] = {};
        savedJP[tanggal][jpNum] = true;
        savedJPData[jpNum] = { ...jpData };

        // Progressive Unlocking: Re-render tabel untuk membuka 1 JP berikutnya
        renderJPTable();
        restoreJPTableValues();
        await window.applyASCScheduleToPresensi(false);
        restoreJPTableValues();

        // Update status tersimpan (Global)
        const countSaved = Object.keys(savedJPData).length;
        const savedAt = new Date();
        const statusSavedEl = document.getElementById('status-saved');
        if (statusSavedEl) {
            statusSavedEl.innerHTML = `
                <i class="fa-solid fa-check-circle text-green-500 mr-1"></i>
                ${countSaved} dari 10 JP tersimpan pada ${savedAt.toLocaleString('id-ID')}
            `;
        }

        const nextJP = jpNum + 1;
        const hasNext = nextJP <= 10 && !isBlockedJP(nextJP, dayOfWeekSave).blocked;
        const unlockMsg = hasNext ? ` JP ${nextJP} kini terbuka!` : '';
        showToast('Tersimpan', `JP ${jpNum} berhasil disimpan.${unlockMsg}`, 'success', 2500);

        // Update monitoring kelengkapan presensi guru seluruh kelas secara real-time
        window.checkClassesPresensiCompleteness();

    } catch (e) {
        console.error('Error saving JP:', e);
        showToast('Gagal', 'Terjadi kesalahan: ' + e.message, 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check mr-1"></i>Simpan'; }
        if (btnD) { btnD.disabled = false; btnD.innerHTML = '<i class="fa-solid fa-check"></i>'; }
    }
};

// === WIDGET MONITORING KELENGKAPAN PRESENSI GURU KELAS (MULAI PUKUL 14:00) ===
function isCompletenessCheckTime(selectedDateStr) {
    const now = new Date();
    const todayStr = window.getLocalISODate(now);

    // Jika memilih tanggal lampau (sebelum hari ini), selalu aktifkan pengecekan
    if (selectedDateStr < todayStr) {
        return true;
    }
    // Jika memilih tanggal hari ini, hanya aktif mulai pukul 14:00
    if (selectedDateStr === todayStr) {
        const currentHour = now.getHours();
        return currentHour >= 14;
    }
    // Jika memilih tanggal masa depan, sembunyikan
    return false;
}

// State cache kelengkapan kelas (hemat 2.880+ reads/hari)
let _completenessCache = null;
let _completenessCacheDate = '';
let _completenessCacheTs = 0;
const COMPLETENESS_CACHE_TTL = 5 * 60 * 1000; // 5 menit

window.checkClassesPresensiCompleteness = async function (force = false) {
    const widget = document.getElementById('incomplete-classes-widget');
    if (!widget) return;

    const tanggal = document.getElementById('input-tanggal').value;
    if (!tanggal) {
        widget.classList.add('hidden');
        return;
    }

    const selectedDate = new Date(tanggal);
    const dayOfWeek = selectedDate.getDay();

    // Hari Sabtu (6) dan Minggu (0) libur, sembunyikan widget
    if (dayOfWeek === 0 || dayOfWeek === 6) {
        widget.classList.add('hidden');
        return;
    }

    // Role admin_kelas, siswa, admin_pks, dan guru_mapel hanya mengelola/melihat kelas sendiri
    // Lewati scan 24 kelas se-sekolah untuk menghemat kuota read Firestore secara signifikan
    const userRole = currentRole || localStorage.getItem('user_role') || '';
    if (['admin_kelas', 'siswa', 'admin_pks', 'guru_mapel'].includes(userRole)) {
        widget.classList.add('hidden');
        return;
    }

    // Periksa apakah waktu sudah memenuhi syarat (>= 14:00 atau tanggal lampau)
    if (!isCompletenessCheckTime(tanggal)) {
        widget.classList.add('hidden');
        return;
    }

    // Pastikan daftar kelas aktif termuat
    if (!kelasList || kelasList.length === 0) {
        await loadKelasList();
    }

    const [year, month, day] = tanggal.split('-');

    // Optimasi 1: Jika cache masih valid dan tanggal sama, gunakan cache
    const isCacheValid = _completenessCache && (_completenessCacheDate === tanggal) && (Date.now() - _completenessCacheTs < COMPLETENESS_CACHE_TTL);
    
    // Jika dipicu oleh admin_kelas saat simpan JP dan cache ada: perbarui status kelas aktif secara lokal tanpa hit Firestore 24x
    if (!force && isCacheValid) {
        if (currentKelas && _completenessCache.length > 0) {
            let savedCount = 0;
            let missingJPs = [];
            for (let i = 1; i <= 10; i++) {
                if (isBlockedJP(i, dayOfWeek).blocked) continue;
                const jpData = savedJPData[i];
                if (jpData && jpData.guru_nama && jpData.status) {
                    savedCount++;
                } else {
                    missingJPs.push(i);
                }
            }
            let totalRequiredJP = 10;
            if (dayOfWeek === 1) totalRequiredJP = 9;
            if (dayOfWeek === 5) totalRequiredJP = 9;

            const existingIdx = _completenessCache.findIndex(item => item.kelas === currentKelas);
            if (existingIdx !== -1) {
                _completenessCache[existingIdx].savedCount = savedCount;
                _completenessCache[existingIdx].missingJPs = missingJPs;
                _completenessCache[existingIdx].isComplete = savedCount >= totalRequiredJP;
            }
        }
        const incompleteList = _completenessCache.filter(r => !r.isComplete);
        renderIncompleteClassesWidget(incompleteList, _completenessCache.length);
        return;
    }

    try {
        // Tampilkan placeholder loading jika widget sedang kosong
        if (!widget.innerHTML || widget.classList.contains('hidden')) {
            widget.classList.remove('hidden');
            widget.innerHTML = `
                <div class="bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-center gap-2">
                    <i class="fa-solid fa-spinner fa-spin text-emerald-500"></i> Memeriksa kelengkapan presensi guru seluruh kelas...
                </div>
            `;
        }

        let results = null;

        // Query 1 Kali ke Supabase untuk seluruh kelas pada tanggal ini (Super Cepat & 0 Egress)
        if (!supabase) {
            widget.classList.add('hidden');
            return;
        }

        const { data: sbRows, error: sbErr } = await supabase
            .from('guru_presensi')
            .select('kelas, jp, status, guru_nama')
            .eq('tanggal', tanggal);

        if (sbErr) {
            throw new Error(`Gagal mengecek kelengkapan presensi Supabase: ${sbErr.message}`);
        }

        const classMap = {};
        kelasList.forEach(k => {
            classMap[k] = {};
        });
        (sbRows || []).forEach(row => {
            if (classMap[row.kelas]) {
                classMap[row.kelas][row.jp] = row;
            }
        });

        let totalRequiredJP = 10;
        if (dayOfWeek === 1) totalRequiredJP = 9; // Senin JP 1 Upacara
        if (dayOfWeek === 5) totalRequiredJP = 9; // Jumat JP 10 Ekskul

        results = kelasList.map(k => {
            const jpMap = classMap[k] || {};
            let savedCount = 0;
            let missingJPs = [];
            for (let i = 1; i <= 10; i++) {
                if (isBlockedJP(i, dayOfWeek).blocked) continue;
                const jpData = (k === currentKelas && savedJPData[i]) ? savedJPData[i] : jpMap[i];
                if (jpData && jpData.guru_nama && jpData.status) {
                    savedCount++;
                } else {
                    missingJPs.push(i);
                }
            }
            return {
                kelas: k,
                savedCount,
                totalRequiredJP,
                missingJPs,
                isComplete: savedCount >= totalRequiredJP
            };
        });

        _completenessCache = results;
        _completenessCacheDate = tanggal;
        _completenessCacheTs = Date.now();

        const incompleteList = results.filter(r => !r.isComplete);
        renderIncompleteClassesWidget(incompleteList, results.length);
    } catch (e) {
        console.error('[PresensiGuru] Error checking completeness:', e);
        widget.classList.add('hidden');
    }
};

function renderIncompleteClassesWidget(incompleteList, totalClasses) {
    const widget = document.getElementById('incomplete-classes-widget');
    if (!widget) return;

    if (incompleteList.length === 0) {
        // Seluruh kelas LENGKAP
        widget.classList.remove('hidden');
        widget.innerHTML = `
            <div class="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-xl p-3 md:p-4 shadow-xs">
                <div class="flex items-center justify-between gap-3">
                    <div class="flex items-center gap-2.5">
                        <div class="w-8 h-8 rounded-lg bg-emerald-500 text-white flex items-center justify-center font-bold text-sm shrink-0 shadow-xs">
                            <i class="fa-solid fa-circle-check"></i>
                        </div>
                        <div>
                            <h4 class="text-xs md:text-sm font-bold text-emerald-900 dark:text-emerald-300">
                                Presensi Guru Lengkap (100%)
                            </h4>
                            <p class="text-[11px] text-emerald-700 dark:text-emerald-400">
                                Seluruh <strong>${totalClasses} kelas</strong> telah lengkap mengisi presensi guru hari ini s.d. JP 10.
                            </p>
                        </div>
                    </div>
                    <button onclick="window.checkClassesPresensiCompleteness(true)" title="Muat ulang status"
                        class="text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 p-1.5 rounded-lg text-xs transition">
                        <i class="fa-solid fa-arrows-rotate"></i>
                    </button>
                </div>
            </div>
        `;
        return;
    }

    // Ada kelas BELUM LENGKAP
    const isSuperAdmin = (currentRole === 'super_admin');

    // Urutkan kelas secara alfabetis seragam
    const sortedList = [...incompleteList].sort((a, b) => a.kelas.localeCompare(b.kelas));

    const chipsHtml = sortedList.map(item => {
        // RBAC: Hanya Super Admin yang bisa klik untuk pindah kelas. Admin Kelas hanya static badge info!
        const cursorStyle = isSuperAdmin ? 'cursor-pointer hover:border-amber-400 hover:bg-amber-100/60 dark:hover:bg-slate-700 active:scale-95' : 'cursor-default';
        const clickAction = isSuperAdmin ? `onclick="window.onKelasChange('${escapeHTML(item.kelas)}'); document.getElementById('select-kelas') && (document.getElementById('select-kelas').value = '${escapeHTML(item.kelas)}');"` : '';

        return `
            <div ${clickAction}
                class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-amber-200/90 dark:border-amber-700/60 bg-white/90 dark:bg-slate-800 text-xs shadow-2xs transition ${cursorStyle}"
                title="${isSuperAdmin ? 'Klik untuk buka presensi ' + escapeHTML(item.kelas) : 'Kelas ' + escapeHTML(item.kelas) + ' belum lengkap'}">
                <span class="font-medium text-slate-800 dark:text-slate-200">${escapeHTML(item.kelas)}</span>
                <span class="text-[10px] font-bold px-1 py-0.2 rounded bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300">
                    ${item.savedCount}/${item.totalRequiredJP} JP
                </span>
            </div>
        `;
    }).join('');

    widget.classList.remove('hidden');
    widget.innerHTML = `
        <div class="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/20 border border-amber-200 dark:border-amber-800/60 rounded-xl p-2.5 md:p-3 shadow-xs">
            <div class="flex items-center justify-between gap-3 mb-2">
                <div class="flex items-center gap-2">
                    <div class="w-7 h-7 rounded-lg bg-amber-500 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-xs">
                        <i class="fa-solid fa-triangle-exclamation"></i>
                    </div>
                    <div>
                        <h4 class="text-xs md:text-sm font-bold text-amber-950 dark:text-amber-200 leading-tight">
                            Monitoring Kelengkapan Presensi Guru
                        </h4>
                        <p class="text-[11px] text-amber-800 dark:text-amber-300/90 leading-tight mt-0.5">
                            Terdapat <strong>${incompleteList.length} dari ${totalClasses} kelas</strong> belum lengkap Mengisi Presensi Guru.
                        </p>
                    </div>
                </div>
                <button onclick="window.checkClassesPresensiCompleteness(true)" title="Muat ulang status kelengkapan"
                    class="text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50 p-1 rounded-md text-xs transition shrink-0">
                    <i class="fa-solid fa-arrows-rotate"></i>
                </button>
            </div>

            <!-- Chips Kelas Belum Lengkap (Compact Flex-Wrap) -->
            <div class="flex flex-wrap gap-1.5 pt-1.5 border-t border-amber-200/60 dark:border-amber-800/40">
                ${chipsHtml}
            </div>
        </div>
    `;
}

// === HELPER & LOGIKA VALIDASI HARI SEKOLAH SEBELUMNYA ===
let _acknowledgedPreviousDays = {}; // Tracking konfirmasi pengguna: `${kelas}_${tanggal}`

function getPreviousSchoolDay(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const dayOfWeek = date.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat

    let daysToSubtract = 1;
    if (dayOfWeek === 1) {
        // Senin -> Jumat sebelumnya (3 hari ke belakang)
        daysToSubtract = 3;
    } else if (dayOfWeek === 0) {
        // Minggu -> Jumat sebelumnya (2 hari ke belakang)
        daysToSubtract = 2;
    } else if (dayOfWeek === 6) {
        // Sabtu -> Jumat sebelumnya (1 hari ke belakang)
        daysToSubtract = 1;
    }

    date.setDate(date.getDate() - daysToSubtract);
    const prevY = date.getFullYear();
    const prevM = String(date.getMonth() + 1).padStart(2, '0');
    const prevD = String(date.getDate()).padStart(2, '0');
    return `${prevY}-${prevM}-${prevD}`;
}

function formatIndonesianDate(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
}

async function checkPreviousDayCompleteness(tanggal, kelas) {
    if (!supabase || !tanggal || !kelas) {
        return { isComplete: true };
    }

    try {
        const prevDateStr = getPreviousSchoolDay(tanggal);
        if (!prevDateStr) return { isComplete: true };

        const [py, pm, pd] = prevDateStr.split('-').map(Number);
        const prevDate = new Date(py, pm - 1, pd);
        const prevDayOfWeek = prevDate.getDay();

        // Ambil data guru_presensi untuk hari sekolah sebelumnya
        const { data: prevRows, error: prevErr } = await supabase
            .from('guru_presensi')
            .select('jp, status, guru_nama')
            .eq('kelas', kelas)
            .eq('tanggal', prevDateStr);

        if (prevErr) {
            console.warn('[PresensiGuru] Gagal cek presensi hari sebelumnya:', prevErr);
            return { isComplete: true };
        }

        let totalRequiredJP = 10;
        if (prevDayOfWeek === 1) totalRequiredJP = 9; // Senin JP 1 Upacara
        if (prevDayOfWeek === 5) totalRequiredJP = 9; // Jumat JP 10 Ekskul

        const savedJPs = new Set();
        (prevRows || []).forEach(row => {
            if (row.guru_nama && row.status && !isBlockedJP(row.jp, prevDayOfWeek).blocked) {
                savedJPs.add(row.jp);
            }
        });

        const savedCount = savedJPs.size;
        const missingJPs = [];
        for (let i = 1; i <= 10; i++) {
            if (isBlockedJP(i, prevDayOfWeek).blocked) continue;
            if (!savedJPs.has(i)) {
                missingJPs.push(i);
            }
        }

        const isComplete = (savedCount >= totalRequiredJP);

        return {
            prevDateStr,
            prevDayOfWeek,
            totalRequiredJP,
            savedCount,
            missingJPs,
            isComplete
        };
    } catch (e) {
        console.warn('[PresensiGuru] Error evaluating previous day completeness:', e);
        return { isComplete: true };
    }
}

function showPreviousDayIncompleteModal(prevCheck) {
    const modal = document.getElementById('modal-previous-day-incomplete');
    const card = document.getElementById('modal-previous-day-card');
    if (!modal) return;

    const prevDateFormatted = formatIndonesianDate(prevCheck.prevDateStr);
    const dayName = prevDateFormatted.split(',')[0];

    const titleEl = document.getElementById('modal-prev-day-title');
    const msgEl = document.getElementById('modal-prev-day-message');
    const dateEl = document.getElementById('modal-prev-day-date');
    const statusEl = document.getElementById('modal-prev-day-status');
    const missingEl = document.getElementById('modal-prev-day-missing');
    const btnSwitchText = document.getElementById('btn-switch-prev-day-text');
    const btnSwitch = document.getElementById('btn-switch-to-prev-day');

    if (titleEl) {
        titleEl.textContent = prevCheck.savedCount === 0 
            ? 'Presensi Hari Sebelumnya Belum Terisi' 
            : 'Presensi Hari Sebelumnya Belum Lengkap';
    }

    if (msgEl) {
        msgEl.innerHTML = `Presensi guru untuk kelas <strong>${escapeHTML(currentKelas)}</strong> pada hari <strong>${prevDateFormatted}</strong> belum lengkap diisi.`;
    }

    if (dateEl) dateEl.textContent = prevDateFormatted;
    if (statusEl) {
        statusEl.textContent = prevCheck.savedCount === 0 
            ? `Belum Terisi (0 dari ${prevCheck.totalRequiredJP} JP)` 
            : `${prevCheck.savedCount} dari ${prevCheck.totalRequiredJP} JP tersimpan`;
    }

    if (missingEl) {
        if (prevCheck.missingJPs.length > 0) {
            missingEl.innerHTML = `<i class="fa-solid fa-circle-exclamation mr-1 text-amber-500"></i>JP yang belum diisi: <strong>JP ${prevCheck.missingJPs.join(', ')}</strong>`;
            missingEl.classList.remove('hidden');
        } else {
            missingEl.classList.add('hidden');
        }
    }

    if (btnSwitchText) {
        btnSwitchText.textContent = `Ubah ke Hari ${dayName} (${prevCheck.prevDateStr})`;
    }

    if (btnSwitch) {
        btnSwitch.onclick = () => window.switchToPreviousDate(prevCheck.prevDateStr);
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    requestAnimationFrame(() => {
        if (card) {
            card.classList.remove('scale-95', 'opacity-0');
            card.classList.add('scale-100', 'opacity-100');
        }
    });
}

function hidePreviousDayIncompleteModal() {
    const modal = document.getElementById('modal-previous-day-incomplete');
    const card = document.getElementById('modal-previous-day-card');
    if (!modal) return;

    if (card) {
        card.classList.remove('scale-100', 'opacity-100');
        card.classList.add('scale-95', 'opacity-0');
    }
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }, 200);
}

function renderPendingPreviousDayPlaceholder(prevCheck) {
    const tbody = document.getElementById('presensi-body');
    if (!tbody) return;

    const prevDateFormatted = formatIndonesianDate(prevCheck.prevDateStr);
    const dayName = prevDateFormatted.split(',')[0];
    const missingText = prevCheck.missingJPs.length > 0 ? `JP ${prevCheck.missingJPs.join(', ')}` : '-';
    const statusText = prevCheck.savedCount === 0 ? 'Belum Terisi (0 JP)' : `Baru Terisi ${prevCheck.savedCount} dari ${prevCheck.totalRequiredJP} JP`;

    tbody.innerHTML = `
        <tr>
            <td colspan="6" class="p-4 sm:p-8 text-center bg-slate-50/50 dark:bg-slate-900/30">
                <div class="max-w-md mx-auto py-2 sm:py-4">
                    <div class="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 mx-auto flex items-center justify-center text-xl mb-3 shadow-xs">
                        <i class="fa-solid fa-triangle-exclamation"></i>
                    </div>
                    <h3 class="text-sm sm:text-base font-bold text-slate-800 dark:text-white mb-1.5">
                        Presensi Guru Hari Sebelumnya Belum Lengkap
                    </h3>
                    <p class="text-xs text-slate-600 dark:text-slate-300 mb-2 leading-relaxed">
                        Presensi guru kelas <strong>${escapeHTML(currentKelas)}</strong> pada hari <strong>${prevDateFormatted}</strong> ${statusText}.
                        ${prevCheck.missingJPs.length > 0 ? `<br><span class="text-amber-700 dark:text-amber-400 font-semibold">Jam belum terisi: ${missingText}</span>` : ''}
                    </p>
                    <p class="text-[11px] text-slate-500 dark:text-slate-400 mb-4 italic">
                        *Jika pada hari tersebut kelas memang tidak belajar (hari libur/kegiatan sekolah), klik <strong>"Oke, Lanjut Hari Ini"</strong> untuk membuka form jam pertama.
                    </p>
                    <div class="flex flex-col sm:flex-row items-center justify-center gap-2">
                        <button onclick="window.switchToPreviousDate('${prevCheck.prevDateStr}')"
                            class="w-full sm:w-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition shadow-xs flex items-center justify-center gap-1.5">
                            <i class="fa-solid fa-calendar-day"></i> Ubah ke Hari ${dayName} (${prevCheck.prevDateStr})
                        </button>
                        <button onclick="window.acknowledgeAndShowToday()"
                            class="w-full sm:w-auto px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold transition">
                            Oke, Lanjut Hari Ini
                        </button>
                    </div>
                </div>
            </td>
        </tr>
    `;

    const statusSavedEl = document.getElementById('status-saved');
    if (statusSavedEl) {
        statusSavedEl.innerHTML = `
            <i class="fa-solid fa-triangle-exclamation text-amber-500 mr-1"></i>
            Presensi guru hari sebelumnya (${prevCheck.prevDateStr}) belum lengkap. Silakan lengkapi atau klik "Oke, Lanjut Hari Ini".
        `;
    }
}

window.acknowledgeAndShowToday = async function () {
    const tanggal = document.getElementById('input-tanggal').value;
    if (tanggal && currentKelas) {
        _acknowledgedPreviousDays[`${currentKelas}_${tanggal}`] = true;
    }
    hidePreviousDayIncompleteModal();

    try {
        currentDaySchedule = await getScheduleForClassAndDate(currentKelas, tanggal);
    } catch (errSched) {
        console.warn('Gagal memuat jadwal XML:', errSched);
        currentDaySchedule = [];
    }

    renderJPTable();
    restoreJPTableValues();
    await window.applyASCScheduleToPresensi(false);
    restoreJPTableValues();
    window.checkAndReRenderIfBlockExpanded();

    const countSaved = Object.keys(savedJPData).length;
    const statusSavedEl = document.getElementById('status-saved');
    if (statusSavedEl) {
        if (countSaved > 0) {
            statusSavedEl.innerHTML = `
                <i class="fa-solid fa-check-circle text-green-500 mr-1"></i>
                ${countSaved} dari 10 JP tersimpan
            `;
        } else {
            statusSavedEl.innerHTML = `
                <i class="fa-solid fa-wand-magic-sparkles text-purple-600 mr-1"></i> Jadwal otomatis diterapkan dari aSc Timetables XML.
            `;
        }
    }

    window.checkClassesPresensiCompleteness();
};

window.switchToPreviousDate = function (prevDateStr) {
    hidePreviousDayIncompleteModal();
    const dateInput = document.getElementById('input-tanggal');
    if (dateInput && prevDateStr) {
        if (currentKelas) {
            _acknowledgedPreviousDays[`${currentKelas}_${prevDateStr}`] = true;
        }
        dateInput.value = prevDateStr;
        loadExistingData();
    }
};

// === LOAD EXISTING DATA ===
async function loadExistingData() {
    hidePreviousDayIncompleteModal();
    const tanggal = document.getElementById('input-tanggal').value;
    if (!tanggal || !currentKelas) return;

    // Validasi hari libur (Sabtu = 6, Minggu = 0)
    const selectedDate = new Date(tanggal);
    const dayOfWeek = selectedDate.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
        const dayName = dayOfWeek === 0 ? 'Minggu' : 'Sabtu';
        savedJPData = {};
        renderJPTable();
        document.getElementById('status-saved').innerHTML = `
            <i class="fa-solid fa-calendar-xmark text-amber-500 mr-1"></i> 
            Hari ${dayName} libur, tidak ada KBM
        `;
        return;
    }

    const [year, month, day] = tanggal.split('-');
    const monthKey = `${year}-${month}`;

    savedJP[tanggal] = {};
    savedJPData = {};
    let loadedFromSupabase = false;
    let dataTimestamp = null;

    try {
        // 1. Baca data presensi guru murni dari Supabase (Primary Database)
        if (supabase) {
            const { data: sbData, error: sbErr } = await supabase
                .from('guru_presensi')
                .select('*')
                .eq('kelas', currentKelas)
                .eq('tanggal', tanggal);

            if (!sbErr && Array.isArray(sbData) && sbData.length > 0) {
                loadedFromSupabase = true;
                const loadDayOfWeek = selectedDate.getDay();
                sbData.forEach(item => {
                    const jpNum = item.jp;
                    if (!isBlockedJP(jpNum, loadDayOfWeek).blocked && item.guru_nama && item.status) {
                        savedJP[tanggal][jpNum] = true;
                        savedJPData[jpNum] = {
                            mapel: item.mapel || '',
                            guru_nama: item.guru_nama || '',
                            guru_id: item.guru_id || '',
                            status: item.status || '',
                            ada_tugas: item.ada_tugas ?? null,
                            keterangan: item.keterangan || ''
                        };
                        if (item.updated_at) {
                            dataTimestamp = new Date(item.updated_at);
                        }
                    }
                });
                console.log(`📦 [PresensiGuru] Loaded ${sbData.length} records from Supabase for ${currentKelas} ${tanggal}`);
            }
        }

        const countSaved = Object.keys(savedJPData).length;

        // Cek riwayat kehadiran guru hari sebelumnya sebelum mengizinkan input jam pertama hari ini
        const ackKey = `${currentKelas}_${tanggal}`;
        if (countSaved === 0 && !_acknowledgedPreviousDays[ackKey]) {
            const prevCheck = await checkPreviousDayCompleteness(tanggal, currentKelas);
            if (prevCheck && !prevCheck.isComplete) {
                showPreviousDayIncompleteModal(prevCheck);
                renderPendingPreviousDayPlaceholder(prevCheck);
                return;
            }
        }

        // Load jadwal XML hari ini untuk deteksi multi-JP block pengajaran guru
        try {
            currentDaySchedule = await getScheduleForClassAndDate(currentKelas, tanggal);
        } catch (errSched) {
            console.warn('Gagal memuat jadwal XML:', errSched);
            currentDaySchedule = [];
        }

        renderJPTable();
        restoreJPTableValues();
        await window.applyASCScheduleToPresensi(false);
        restoreJPTableValues();
        window.checkAndReRenderIfBlockExpanded();

        if (countSaved > 0) {
            const savedAt = dataTimestamp || new Date();
            const sourceLabel = loadedFromSupabase ? ' (Supabase DB)' : '';
            document.getElementById('status-saved').innerHTML = `
                <i class="fa-solid fa-check-circle text-green-500 mr-1"></i>
                ${countSaved} dari 10 JP tersimpan (${savedAt.toLocaleString('id-ID')})${sourceLabel}
            `;
            showToast('Data Dimuat', `${countSaved} JP presensi ditemukan untuk tanggal ini.`, 'info');
        } else {
            document.getElementById('status-saved').innerHTML = `
                <i class="fa-solid fa-wand-magic-sparkles text-purple-600 mr-1"></i> Jadwal otomatis diterapkan dari aSc Timetables XML.
            `;
        }

        // Cek kelengkapan presensi guru seluruh kelas (aktif >= 14:00)
        window.checkClassesPresensiCompleteness();
    } catch (e) {
        console.error('Error loading data:', e);
    }
}

// Helper: Smart Set Value untuk Select Mapel (dengan fallback normalisasi & pembuatan opsi dinamis)
function setSelectMapelValue(selectEl, mapelName) {
    if (!selectEl || !mapelName) return;

    // 1. Exact Match
    selectEl.value = mapelName;
    if (selectEl.value === mapelName) return;

    // 2. Normalized Match
    const normTarget = mapelName.toLowerCase().replace(/[^a-z0-9]/gi, '');
    let matchedValue = null;

    for (let i = 0; i < selectEl.options.length; i++) {
        const opt = selectEl.options[i];
        const normOpt = opt.value.toLowerCase().replace(/[^a-z0-9]/gi, '');
        if (normOpt && normTarget && (normOpt === normTarget || normOpt.includes(normTarget) || normTarget.includes(normOpt))) {
            matchedValue = opt.value;
            break;
        }
    }

    if (matchedValue) {
        selectEl.value = matchedValue;
        return;
    }

    // 3. Opsi Baru Dinamis jika belum ada di list
    const newOpt = document.createElement('option');
    newOpt.value = mapelName;
    newOpt.textContent = mapelName;
    selectEl.appendChild(newOpt);
    selectEl.value = mapelName;
}

// === AUTO POPULATE FROM ASC TIMETABLES XML SCHEDULE ===
window.applyASCScheduleToPresensi = async function (force = false) {
    const tanggal = document.getElementById('input-tanggal').value;
    if (!tanggal || !currentKelas) return;

    try {
        const schedule = await getScheduleForClassAndDate(currentKelas, tanggal);
        if (!schedule || schedule.length === 0) {
            if (force) showToast('Info', 'Tidak ditemukan jadwal XML untuk tanggal dan kelas ini.', 'info');
            return;
        }

        const selectedDate = new Date(tanggal);
        const dayOfWeek = selectedDate.getDay();
        let populatedCount = 0;

        for (const item of schedule) {
            const jpNum = item.jp;
            // Skip JP yang diblokir (Senin JP1 / Jumat JP10)
            if (isBlockedJP(jpNum, dayOfWeek).blocked) continue;

            const mapelM = document.getElementById(`mapel-${jpNum}`);
            const mapelD = document.getElementById(`mapel-d-${jpNum}`);
            const guruM = document.getElementById(`guru-${jpNum}`);
            const guruD = document.getElementById(`guru-d-${jpNum}`);
            const guruIdM = document.getElementById(`guru-id-${jpNum}`);
            const guruIdD = document.getElementById(`guru-id-d-${jpNum}`);

            // Isi jika force = true atau jika kolom mapel belum diisi
            if (force || (mapelM && !mapelM.value)) {
                let targetMapel = item.mapel || '';
                let targetGuru = item.guruNama || '';
                let targetGuruId = item.guruId || '';

                if (targetMapel) {
                    if (mapelM) setSelectMapelValue(mapelM, targetMapel);
                    if (mapelD) setSelectMapelValue(mapelD, targetMapel);
                }
                if (targetGuru || targetGuruId) {
                    if (guruM) guruM.value = targetGuru;
                    if (guruD) guruD.value = targetGuru;
                    if (guruIdM) guruIdM.value = targetGuruId;
                    if (guruIdD) guruIdD.value = targetGuruId;
                }

                if (targetMapel || targetGuru) {
                    populatedCount++;
                    // Efek visual highlight halus
                    if (guruM) guruM.classList.add('bg-purple-50', 'dark:bg-purple-900/30');
                    if (guruD) guruD.classList.add('bg-purple-50', 'dark:bg-purple-900/30');
                    setTimeout(() => {
                        if (guruM) guruM.classList.remove('bg-purple-50', 'dark:bg-purple-900/30');
                        if (guruD) guruD.classList.remove('bg-purple-50', 'dark:bg-purple-900/30');
                    }, 800);
                }
            }
        }

        if (populatedCount > 0 && force) {
            showToast('Jadwal Terpasang', `${populatedCount} JP berhasil diisi dari Jadwal XML!`, 'success');
        }
    } catch (e) {
        console.error('[PresensiGuru] Error applying XML schedule:', e);
    }
};


// === RESET FORM ===
function resetForm() {
    const tanggal = document.getElementById('input-tanggal').value;
    savedJPData = {};
    if (tanggal) savedJP[tanggal] = {};
    renderJPTable();
}

// === COPY FROM ABOVE (copy data dari JP sebelumnya) ===
window.copyFromAbove = function (jpNum) {
    if (jpNum <= 1) return; // JP 1 tidak punya JP di atasnya

    const prevJP = jpNum - 1;

    // Safety check: JP sebelumnya mungkin diblokir (tidak ada form fields)
    const tanggal = document.getElementById('input-tanggal').value;
    const dateObj = tanggal ? new Date(tanggal) : new Date();
    if (isBlockedJP(prevJP, dateObj.getDay()).blocked) {
        showToast('Info', `JP ${prevJP} tidak tersedia untuk di-copy.`, 'info');
        return;
    }

    // Ambil data dari JP sebelumnya (mobile fields sebagai source)
    const prevMapel = document.getElementById(`mapel-${prevJP}`).value;
    const prevGuru = document.getElementById(`guru-${prevJP}`).value;
    const prevGuruId = document.getElementById(`guru-id-${prevJP}`).value;
    const prevStatus = document.getElementById(`status-${prevJP}`).value;
    const prevTugas = document.getElementById(`tugas-${prevJP}`).checked;
    const prevKegiatan = (document.getElementById(`kegiatan-${prevJP}`)?.value || document.getElementById(`kegiatan-d-${prevJP}`)?.value || '').trim();

    // Validasi: JP sebelumnya harus ada isinya
    if (!prevMapel && !prevGuru) {
        showToast('Info', `JP ${prevJP} masih kosong, tidak ada yang bisa di-copy.`, 'info');
        return;
    }

    // Set ke JP saat ini (mobile fields)
    document.getElementById(`mapel-${jpNum}`).value = prevMapel;
    document.getElementById(`guru-${jpNum}`).value = prevGuru;
    document.getElementById(`guru-id-${jpNum}`).value = prevGuruId;
    document.getElementById(`status-${jpNum}`).value = prevStatus;

    // Set ke JP saat ini (desktop fields)
    document.getElementById(`mapel-d-${jpNum}`).value = prevMapel;
    document.getElementById(`guru-d-${jpNum}`).value = prevGuru;
    document.getElementById(`guru-id-d-${jpNum}`).value = prevGuruId;
    document.getElementById(`status-d-${jpNum}`).value = prevStatus;

    // Trigger onStatusChange untuk toggle tugas & kegiatan visibility
    onStatusChange(jpNum);

    // Copy tugas checkbox jika applicable
    document.getElementById(`tugas-${jpNum}`).checked = prevTugas;
    document.getElementById(`tugas-d-${jpNum}`).checked = prevTugas;

    // Copy keterangan kegiatan jika status K atau ada keterangan di JP sebelumnya
    if (prevStatus === 'K' || prevKegiatan) {
        const kegM = document.getElementById(`kegiatan-${jpNum}`);
        const kegD = document.getElementById(`kegiatan-d-${jpNum}`);
        if (kegM) kegM.value = prevKegiatan;
        if (kegD) kegD.value = prevKegiatan;
    }

    // Highlight efek sukses
    const mobileRow = document.querySelector(`tr[data-jp="${jpNum}"].md\\:hidden`);
    const desktopRow = document.querySelector(`tr[data-jp="${jpNum}"].md\\:table-row`);

    if (mobileRow) {
        mobileRow.classList.add('bg-blue-50');
        setTimeout(() => mobileRow.classList.remove('bg-blue-50'), 500);
    }
    if (desktopRow) {
        desktopRow.classList.add('bg-blue-50');
        setTimeout(() => desktopRow.classList.remove('bg-blue-50'), 500);
    }

    showToast('Berhasil', `Data JP ${prevJP} berhasil di-copy ke JP ${jpNum}`, 'success', 1500);
    window.checkAndReRenderIfBlockExpanded();
};


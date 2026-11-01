import { auth, supabase } from './config.js';
import { cfClient } from './cloudflare-client.js';
import { initLayout, validateStudentIdentityNumbers } from './global.js';
import { SimasEWS } from './ews-calculator.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
    compressImageToJpegBase64,
    uploadWorkloadPhotoToGoogleDrive,
    getGoogleDriveThumbnail,
    parseEvidencePhotos,
    sanitizeUrl
} from './workload-photo-upload.js';

function initSupabase() {
    return !!supabase;
}

let currentUser = null;
let myStudents = []; // Cache siswa perwalian
let allStudentsCache = []; // Cache semua siswa (flat list)
let selectedStudentsToAdd = []; // Siswa terpilih untuk ditambahkan
let selectedStudentsForNote = []; // Siswa terpilih untuk catatan (kolektif)
let currentDetailNIS = null; // NIS siswa yang sedang dibuka detailnya
let currentDetailRawAttendance = [];
let detailSppYear = null;
let detailStudentCohort = null;
let detailPaymentHistory = {};
let detailSppDueDate = 20;
let isListenersSetup = false;
let ewsWeights = null;

let currentViewMode = 'grid'; // Mode tampilan: 'grid' atau 'table'
let currentStudentSort = {
    column: 'class', // 'class', 'no', 'name', 'ews', 'alpa', 'percent', 'points', 'permisi'
    order: 'asc'     // 'asc' atau 'desc'
};
window.currentStudentSort = currentStudentSort;

// --- CACHE HELPER FUNCTIONS ---
const CACHE_TTL_MY_STUDENTS = 24 * 60 * 60 * 1000; // 24 jam untuk siswa perwalian

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

function clearMyStudentsCache() {
    // Dipanggil saat ada perubahan data (tambah/hapus siswa)
    if (currentUser) {
        localStorage.removeItem(`cache_my_students_${currentUser.uid}`);
    }
}

// --- INIT ---
onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash); return; }
    currentUser = user;

    const role = localStorage.getItem('user_role');
    // MULTI-ROLE: Ambil role tertinggi untuk halaman ini
    const effectiveRole = window.getEffectiveRoleForPage ?
        window.getEffectiveRoleForPage('guru-wali.html') : role;
    initLayout(effectiveRole); // Gunakan role tertinggi

    // Tampilkan UI
    document.querySelector('main').classList.remove('hidden');

    // Load Data Awal
    await loadMyStudents();
    await loadAllStudentsForDatalist();
    if (!isListenersSetup) {
        setupEventListeners();
    }
});

// --- BATCH FETCHERS FOR INFORMATIVE METRICS ---
async function fetchSppSummaryForStudents(nisList) {
    const map = new Map();
    if (!nisList || nisList.length === 0) return map;

    try {
        const uniqueNis = Array.from(new Set(nisList.filter(Boolean).map(n => String(n).trim())));
        if (uniqueNis.length === 0) return map;

        initSupabase();
        if (!supabase) throw new Error('Supabase client belum siap');

        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth() + 1; // 1-12

        const { data, error } = await window.fetchAllSupabaseRows(
            supabase,
            'finance_transactions',
            q => q.in('student_nis', uniqueNis),
            { selectFields: 'student_nis, year, month, amount, type' }
        );

        if (error) {
            console.error('[Guru Wali] Error fetchSppSummaryForStudents Supabase:', error);
            throw error;
        }

        if (data) {
            data.forEach(d => {
                const nisStr = String(d.student_nis || '').trim();
                if (nisStr && d.type !== 'manual_debt') {
                    if (!map.has(nisStr)) {
                        map.set(nisStr, { totalPaid: 0, monthsPaid: new Set() });
                    }
                    const obj = map.get(nisStr);
                    obj.totalPaid += (Number(d.amount) || 0);
                    if (d.month && d.year) {
                        obj.monthsPaid.add(`${d.year}-${d.month}`);
                    }
                }
            });
        }

        uniqueNis.forEach(nisStr => {
            if (!map.has(nisStr)) {
                map.set(nisStr, { isPaid: false, label: 'Belum Bulan Ini' });
            } else {
                const obj = map.get(nisStr);
                const currentKey = `${currentYear}-${currentMonth}`;
                const isPaidCurrentMonth = obj.monthsPaid.has(currentKey) || obj.totalPaid > 0;
                if (isPaidCurrentMonth) {
                    map.set(nisStr, { isPaid: true, label: 'Lunas' });
                } else {
                    map.set(nisStr, { isPaid: false, label: 'Belum Bulan Ini' });
                }
            }
        });

    } catch (e) {
        console.warn('[Guru Wali] Error fetching SPP summary batch:', e);
    }
    return map;
}

// --- BATCH FETCH ATTENDANCE SUMMARY DARI SUPABASE (100% SSOT) ---
async function fetchAttendanceSummaryForStudents(nisList) {
    const map = new Map();
    if (!nisList || nisList.length === 0) return map;

    try {
        const uniqueNis = Array.from(new Set(nisList.filter(Boolean).map(n => String(n).trim())));
        if (uniqueNis.length === 0) return map;

        // Default awal 0 untuk setiap siswa
        uniqueNis.forEach(nisStr => {
            map.set(nisStr, { H: 0, S: 0, I: 0, A: 0, D: 0, P: 0, T: 0, total: 0 });
        });

        initSupabase();
        if (!supabase) return map;

        const now = new Date();
        const curM = now.getMonth();
        const curY = now.getFullYear();
        const startYear = (curM >= 6) ? curY : curY - 1;
        const startDate = `${startYear}-07-01`;

        const { data, error } = await window.fetchAllSupabaseRows(
            supabase,
            'siswa_presensi',
            q => q.in('student_nis', uniqueNis).gte('tanggal', startDate),
            { selectFields: 'student_nis, status' }
        );

        if (error) {
            console.error('[Guru Wali] Error fetchAttendanceSummaryForStudents Supabase:', error);
            return map;
        }

        if (Array.isArray(data)) {
            data.forEach(d => {
                const nisStr = String(d.student_nis || '').trim();
                const st = String(d.status || '').toUpperCase();
                if (nisStr && map.has(nisStr)) {
                    const counts = map.get(nisStr);
                    if (st === 'H' || st === 'HADIR') counts.H++;
                    else if (st === 'S' || st === 'SAKIT') counts.S++;
                    else if (st === 'I' || st === 'IZIN') counts.I++;
                    else if (st === 'A' || st === 'ALPA' || st === 'ALPHA') counts.A++;
                    else if (st === 'D' || st === 'DISPEN' || st === 'DISPENSASI') counts.D++;
                    else if (st === 'P' || st === 'PERMISI') counts.P++;
                    else if (st === 'T' || st === 'TERLAMBAT') counts.T++;
                    counts.total++;
                }
            });
        }
    } catch (e) {
        console.warn('[Guru Wali] Error fetching attendance summary batch from Supabase:', e);
    }
    return map;
}

// --- BATCH FETCH PERMISSIONS SUMMARY DARI CLOUDFLARE D1 (100% SSOT & 0 FIRESTORE READ) ---
async function fetchPermissionsSummaryForStudents(students, nisList) {
    const map = new Map();
    if (!Array.isArray(nisList) || nisList.length === 0) return map;

    const uniqueNis = Array.from(new Set(nisList.filter(Boolean).map(n => String(n).trim())));
    const nisSet = new Set(uniqueNis);
    uniqueNis.forEach(nisStr => map.set(nisStr, 0));

    if (!cfClient || !cfClient.enabled) return map;

    try {
        const classSet = new Set();
        (students || []).forEach(s => {
            const c = (s.student_class || s.class || '').trim();
            if (c) classSet.add(c);
        });

        const permisiRequests = [];
        // Jika siswa perwalian berasal dari rombel tertentu (<=8 rombel), kueri per rombel sangat efisien
        if (classSet.size > 0 && classSet.size <= 8) {
            const classPromises = Array.from(classSet).map(cls =>
                cfClient.getPermisiRequests({ class: cls, limit: 300 }).catch(err => {
                    console.warn(`[Guru Wali] Error getPermisiRequests for class ${cls}:`, err);
                    return [];
                })
            );
            const results = await Promise.all(classPromises);
            results.forEach(list => {
                if (Array.isArray(list)) permisiRequests.push(...list);
            });
        } else {
            // Fallback jika tidak ada info kelas / rombel tersebar: kueri paralel per-NIS
            const nisPromises = uniqueNis.map(nisStr =>
                cfClient.getPermisiRequests({ student_nis: nisStr, limit: 100 }).catch(err => {
                    console.warn(`[Guru Wali] Error getPermisiRequests for NIS ${nisStr}:`, err);
                    return [];
                })
            );
            const results = await Promise.all(nisPromises);
            results.forEach(list => {
                if (Array.isArray(list)) permisiRequests.push(...list);
            });
        }

        const countedRequestIds = new Set();
        permisiRequests.forEach(r => {
            const nisStr = String(r.student_nis || r.studentNIS || r.nis || '').trim();
            const status = String(r.status || '').toLowerCase();
            const reqId = String(r.id || `${nisStr}_${r.date}_${r.time_out}`);

            if (nisSet.has(nisStr) && !countedRequestIds.has(reqId)) {
                if (['approved', 'wali_approved'].includes(status)) {
                    countedRequestIds.add(reqId);
                    map.set(nisStr, (map.get(nisStr) || 0) + 1);
                }
            }
        });
    } catch (e) {
        console.warn('[Guru Wali] Error fetching permissions summary from D1:', e);
    }
    return map;
}

// --- HELPER: FORMAT NOTE DATE ---
function formatNoteDate(dateVal) {
    if (!dateVal) return '';
    try {
        let dateObj = null;
        if (typeof dateVal.toDate === 'function') {
            dateObj = dateVal.toDate();
        } else if (dateVal instanceof Date) {
            dateObj = dateVal;
        } else if (typeof dateVal === 'object' && dateVal.seconds !== undefined) {
            dateObj = new Date(dateVal.seconds * 1000);
        } else if (typeof dateVal === 'string' && dateVal.trim() !== '') {
            dateObj = new Date(dateVal);
        } else if (typeof dateVal === 'number') {
            dateObj = new Date(dateVal);
        }

        if (dateObj && !isNaN(dateObj.getTime())) {
            return dateObj.toLocaleDateString('id-ID', {
                day: 'numeric',
                month: 'short',
                year: 'numeric'
            });
        }
    } catch (e) {}
    return String(dateVal || '');
}

function getNoteTimestampMs(dateVal) {
    if (!dateVal) return 0;
    try {
        if (typeof dateVal.toDate === 'function') return dateVal.toDate().getTime();
        if (dateVal instanceof Date) return dateVal.getTime();
        if (typeof dateVal === 'object' && dateVal.seconds !== undefined) return dateVal.seconds * 1000;
        if (typeof dateVal === 'string' || typeof dateVal === 'number') {
            const t = new Date(dateVal).getTime();
            return isNaN(t) ? 0 : t;
        }
    } catch (e) {}
    return 0;
}

// --- FETCH RECENT NOTES FOR STUDENTS BATCH ---
async function fetchRecentNotesForStudents(nisList) {
    const map = new Map();
    if (!Array.isArray(nisList) || nisList.length === 0) return map;

    try {
        const uniqueNisStr = Array.from(new Set(nisList.filter(Boolean).map(n => String(n).trim())));
        const nisSet = new Set(uniqueNisStr);

        // Fetch recent notes directly from Cloudflare D1 (0 Firestore Read)
        if (cfClient && cfClient.enabled) {
            const notes = await cfClient.getGuruWaliNotes({
                guru_uid: currentUser?.uid,
                limit: 500
            });

            if (Array.isArray(notes)) {
                notes.forEach(d => {
                    const nisStr = String(d.student_nis || d.studentNis || d.nis || '').trim();
                    if (nisStr && nisSet.has(nisStr)) {
                        const noteTime = getNoteTimestampMs(d.date || d.tanggal || d.created_at);
                        const noteObj = {
                            title: d.title || d.judul || d.notes || d.catatan || 'Catatan Pembinaan',
                            date: formatNoteDate(d.date || d.tanggal || d.created_at),
                            timestamp: noteTime,
                            category: d.category || 'Umum'
                        };
                        const existing = map.get(nisStr);
                        if (!existing || noteTime > existing.timestamp) {
                            map.set(nisStr, noteObj);
                        }
                    }
                });
            }
        }
    } catch (e) {
        console.warn('[Guru Wali] Error fetching recent notes batch from D1:', e);
    }
    return map;
}

async function refreshGridAndTableNotes() {
    if (!myStudents || myStudents.length === 0) return;
    try {
        const nisList = myStudents.map(s => s.student_nis);
        const recentNotesMap = await fetchRecentNotesForStudents(nisList);
        myStudents.forEach(s => {
            const nisStr = String(s.student_nis).trim();
            s.lastNote = recentNotesMap.get(nisStr) || null;
        });
        applyFiltersAndRender();
    } catch (e) {
        console.warn('[Guru Wali] Error refreshing grid notes:', e);
    }
}

// --- LOAD SISWA PERWALIAN (WITH ENRICHED METRICS) ---
async function loadMyStudents(forceRefresh = false) {
    const grid = document.getElementById('siswa-grid');
    if (grid) {
        grid.innerHTML = `<div class="col-span-full text-center py-12 text-slate-400">
            <i class="fa-solid fa-spinner fa-spin text-4xl mb-3"></i>
            <p>Memuat data siswa perwalian...</p>
        </div>`;
    }

    try {
        const cacheKey = `cache_my_students_${currentUser.uid}`;
        let rawAssignments = [];

        if (!forceRefresh) {
            const cached = getCachedData(cacheKey);
            if (cached && Array.isArray(cached)) {
                console.log('[Guru Wali] Menggunakan cache siswa perwalian');
                rawAssignments = cached;
            }
        }

        if (rawAssignments.length === 0) {
            if (cfClient && cfClient.enabled) {
                rawAssignments = await cfClient.getGuruWaliAssignments({ guru_uid: currentUser.uid });
            }
            setCachedData(cacheKey, rawAssignments, CACHE_TTL_MY_STUDENTS);
        }

        myStudents = rawAssignments;

        // 1. Sync dengan SSOT Data Siswa
        await updateMyStudentsWithSSOT();

        // 2. Enrich dengan Aggregates (Presensi + BK Points) dari window.getStudentAggregatesCache
        let aggregatesMap = new Map();
        if (typeof window.getStudentAggregatesCache === 'function') {
            try {
                const aggs = await window.getStudentAggregatesCache();
                if (aggs && Array.isArray(aggs)) {
                    aggs.forEach(a => {
                        if (a && a.nis) aggregatesMap.set(String(a.nis).trim(), a);
                    });
                }
            } catch (errAgg) {
                console.warn('[Guru Wali] Error fetching aggregates cache:', errAgg);
            }
        }

        // 3. Batch fetch SPP Summary
        const nisList = myStudents.map(s => s.student_nis);
        const sppMap = await fetchSppSummaryForStudents(nisList);

        // 3b. Batch fetch Attendance Summary dari Supabase (100% Supabase SSOT)
        const attendanceMap = await fetchAttendanceSummaryForStudents(nisList);

        // 3c. Batch fetch Permissions Summary dari Cloudflare D1 (100% SSOT & 0 Firestore Read)
        const permissionMap = await fetchPermissionsSummaryForStudents(myStudents, nisList);

        // 4. Batch fetch Recent Notes
        const recentNotesMap = await fetchRecentNotesForStudents(nisList);

        // 4b. Ambil konfigurasi bobot EWS resmi sekolah jika belum ada
        if (!ewsWeights && SimasEWS && typeof SimasEWS.getWeights === 'function') {
            try {
                ewsWeights = await SimasEWS.getWeights();
            } catch (errW) {
                console.warn('[Guru Wali] Error getWeights EWS:', errW);
            }
        }

        // 5. Attach data to each student
        myStudents.forEach(s => {
            const nisStr = String(s.student_nis).trim();
            s.aggregates = aggregatesMap.get(nisStr) || {};
            // Inject / override data kehadiran langsung dari Supabase SSOT
            const att = attendanceMap.get(nisStr) || { H: 0, S: 0, I: 0, A: 0, D: 0, P: 0, T: 0, total: 0 };
            s.aggregates.attendance = att;
            s.sppStatus = sppMap.get(nisStr) || { isPaid: true, label: 'Lunas' };
            s.lastNote = recentNotesMap.get(nisStr) || null;

            // Hitung data permisi komprehensif (permisi_requests D1 + student_aggregates + presensi Supabase)
            const permFromRequests = permissionMap.get(nisStr) || 0;
            const permFromAgg = Number(s.aggregates.permission_count || 0);
            const permFromPresensi = Number(att.P || 0);
            const finalPermisi = Math.max(permFromRequests, permFromAgg, permFromPresensi);

            s.aggregates.permisi = finalPermisi;
            s.aggregates.permission_count = finalPermisi;
            s.permissionCount = finalPermisi;

            // Calculate EWS Risk dengan data permisi yang akurat dan bobot resmi
            s.ewsResult = SimasEWS
                ? SimasEWS.calculateStudentRisk(s, s.aggregates || {}, finalPermisi, ewsWeights)
                : { level: 'low', label: 'Aman', totalScore: 0, details: { alpa: 0, izin: 0, points: 0, permisi: finalPermisi } };
        });

        // 6. Update Overview Stat Cards
        updateOverviewStats();

        // 7. Render Views
        applyFiltersAndRender();
        populateSiswaFilters();

    } catch (e) {
        console.error('Error load my students:', e);
        if (grid) {
            grid.innerHTML = `<div class="col-span-full text-center py-12 text-red-400">
                <i class="fa-solid fa-triangle-exclamation text-4xl mb-3"></i>
                <p>Gagal memuat data. Silakan refresh halaman.</p>
            </div>`;
        }
    }
}

// --- UPDATE OVERVIEW STAT CARDS ---
function updateOverviewStats() {
    const totalCount = myStudents.length;
    const statTotalEl = document.getElementById('stat-total-siswa');
    if (statTotalEl) statTotalEl.innerText = totalCount;

    let highCount = 0;
    let medCount = 0;
    let lowCount = 0;
    let totalPresencePct = 0;
    let presenceWarningCount = 0;
    let sppLunasCount = 0;
    let sppTunggakanCount = 0;

    myStudents.forEach(s => {
        // EWS
        const lvl = s.ewsResult ? s.ewsResult.level : 'low';
        if (lvl === 'high') highCount++;
        else if (lvl === 'medium') medCount++;
        else lowCount++;

        // Attendance
        const att = (s.aggregates && s.aggregates.attendance) || {};
        const h = Number(att.H || 0);
        const s_cnt = Number(att.S || 0);
        const i_cnt = Number(att.I || 0);
        const a_cnt = Number(att.A || 0);
        const d_cnt = Number(att.D || 0);
        const totalDays = h + s_cnt + i_cnt + a_cnt + d_cnt;
        const pct = totalDays > 0 ? Math.round(((h + d_cnt) / totalDays) * 100) : 100;
        totalPresencePct += pct;

        if (a_cnt > 0 || pct < 85) {
            presenceWarningCount++;
        }

        // SPP
        if (s.sppStatus && s.sppStatus.isPaid) {
            sppLunasCount++;
        } else {
            sppTunggakanCount++;
        }
    });

    const avgPresence = totalCount > 0 ? Math.round(totalPresencePct / totalCount) : 100;

    const elHigh = document.getElementById('stat-ews-high');
    const elMed = document.getElementById('stat-ews-med');
    const elLow = document.getElementById('stat-ews-low');
    const elAvg = document.getElementById('stat-avg-presence');
    const elWarn = document.getElementById('stat-presence-warning');
    const elLunas = document.getElementById('stat-spp-lunas');
    const elTunggakan = document.getElementById('stat-spp-tunggakan');

    if (elHigh) elHigh.innerText = `${highCount} High`;
    if (elMed) elMed.innerText = `${medCount} Med`;
    if (elLow) elLow.innerText = `${lowCount} Safe`;
    if (elAvg) elAvg.innerText = `${avgPresence}%`;
    if (elWarn) elWarn.innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-1"></i>${presenceWarningCount} Siswa Alpa/Warning`;
    if (elLunas) elLunas.innerText = `${sppLunasCount} Lunas`;
    if (elTunggakan) elTunggakan.innerText = `${sppTunggakanCount} Belum`;
}

// --- UPDATE SISWA PERWALIAN DENGAN DATA SSOT DARI DATABASE SISWA ---
async function updateMyStudentsWithSSOT() {
    try {
        const allStudents = await window.getStudentsCache();
        if (allStudents && allStudents.length > 0) {
            const studentMap = new Map(allStudents.filter(s => s && (s.nis || s.id)).map(s => [String(s.nis || s.id).trim(), s]));
            myStudents.forEach(s => {
                const actualStudent = studentMap.get(String(s.student_nis).trim());
                if (actualStudent) {
                    if (actualStudent.class) s.student_class = actualStudent.class;
                    if (actualStudent.name) s.student_name = actualStudent.name;
                    if (actualStudent.phone_parent) s.phone_parent = actualStudent.phone_parent;
                    if (actualStudent.phone_siswa) s.phone_siswa = actualStudent.phone_siswa;
                    const photo = actualStudent.activePhotoUrl || actualStudent.active_photo_url || actualStudent.photoUrl || actualStudent.photo_url || actualStudent.foto || null;
                    if (photo) s.activePhotoUrl = photo;
                }
            });
        }
    } catch (e) {
        console.error('[Guru Wali] Gagal sinkronisasi data perwalian dengan SSOT:', e);
    }
}

// --- PRESENCE PERCENTAGE HELPER ---
function getStudentPresencePct(s) {
    const att = (s && s.aggregates && s.aggregates.attendance) || {};
    const h = Number(att.H || 0);
    const s_cnt = Number(att.S || 0);
    const i_cnt = Number(att.I || 0);
    const a_cnt = Number(att.A || 0);
    const d_cnt = Number(att.D || 0);
    const totalDays = h + s_cnt + i_cnt + a_cnt + d_cnt;
    return totalDays > 0 ? Math.round(((h + d_cnt) / totalDays) * 100) : 100;
}
window.getStudentPresencePct = getStudentPresencePct;

// --- IN-COLUMN SORT TRIGGER ---
window.sortStudentTable = function (columnKey) {
    if (currentStudentSort.column === columnKey) {
        currentStudentSort.order = currentStudentSort.order === 'asc' ? 'desc' : 'asc';
    } else {
        currentStudentSort.column = columnKey;
        // Default order intuitif saat kolom pertama kali diklik:
        // Metrik kuantitas/risiko/poin/alpa: default ke 'desc' (terbanyak/tertinggi dahulu)
        if (['ews', 'alpa', 'points', 'permisi'].includes(columnKey)) {
            currentStudentSort.order = 'desc';
        } else if (columnKey === 'percent') {
            currentStudentSort.order = 'asc'; // % hadir terendah dahulu untuk intervensi
        } else {
            currentStudentSort.order = 'asc';
        }
    }
    if (typeof window.applyFiltersAndRender === 'function') {
        window.applyFiltersAndRender();
    }
};

// --- UPDATE TABLE SORT ICONS ---
function updateTableSortIcons() {
    const sortIcons = {
        'no': 'sort-icon-no',
        'name': 'sort-icon-name',
        'ews': 'sort-icon-ews',
        'alpa': 'sort-icon-alpa',
        'percent': 'sort-icon-percent',
        'points': 'sort-icon-points'
    };

    const ewsMatriksIcons = {
        'no': 'sort-icon-ews-no',
        'name': 'sort-icon-ews-name',
        'class': 'sort-icon-ews-class',
        'alpa': 'sort-icon-ews-alpa',
        'permisi': 'sort-icon-ews-permisi',
        'points': 'sort-icon-ews-points',
        'ews': 'sort-icon-ews-score'
    };

    const activeCol = currentStudentSort.column;
    const isAsc = currentStudentSort.order === 'asc';

    Object.entries(sortIcons).forEach(([col, iconId]) => {
        const el = document.getElementById(iconId);
        if (!el) return;
        if (col === activeCol || (activeCol === 'class' && col === 'no')) {
            el.className = `fa-solid ${isAsc ? 'fa-sort-up' : 'fa-sort-down'} ml-1 text-[11px] text-blue-600 dark:text-blue-400`;
        } else {
            el.className = 'fa-solid fa-sort ml-1 text-[10px] text-slate-300 dark:text-slate-500';
        }
    });

    Object.entries(ewsMatriksIcons).forEach(([col, iconId]) => {
        const el = document.getElementById(iconId);
        if (!el) return;
        if (col === activeCol || (activeCol === 'no' && col === 'class')) {
            el.className = `fa-solid ${isAsc ? 'fa-sort-up' : 'fa-sort-down'} ml-1 text-[11px] text-blue-600 dark:text-blue-400`;
        } else {
            el.className = 'fa-solid fa-sort ml-1 text-[10px] text-slate-300 dark:text-slate-500';
        }
    });
}
window.updateTableSortIcons = updateTableSortIcons;

// --- FILTER & SORT HELPER ---
function getFilteredAndSortedStudents() {
    const searchVal = (document.getElementById('search-siswa')?.value || '').toLowerCase().trim();
    const ewsFilter = document.getElementById('filter-ews-risk')?.value || '';
    const presensiFilter = document.getElementById('filter-presensi-problem')?.value || '';

    let filtered = [...myStudents];

    // 1. Search
    if (searchVal) {
        filtered = filtered.filter(s =>
            (s.student_name || '').toLowerCase().includes(searchVal) ||
            (s.student_nis || '').includes(searchVal) ||
            (s.student_class || '').toLowerCase().includes(searchVal)
        );
    }

    // 2. EWS Filter
    if (ewsFilter) {
        filtered = filtered.filter(s => s.ewsResult && s.ewsResult.level === ewsFilter);
    }

    // 3. Presensi Filter
    if (presensiFilter === 'has_alpa') {
        filtered = filtered.filter(s => {
            const att = (s.aggregates && s.aggregates.attendance) || {};
            return Number(att.A || 0) > 0;
        });
    } else if (presensiFilter === 'low_presence') {
        filtered = filtered.filter(s => {
            return getStudentPresencePct(s) < 85;
        });
    } else if (presensiFilter === 'has_permission') {
        filtered = filtered.filter(s => {
            const count = Number(s.aggregates?.permisi ?? s.permissionCount ?? s.ewsResult?.details?.permisi ?? 0);
            return count > 0;
        });
    }

    // 4. Sorting
    const getClassLevel = (className) => {
        if (!className) return 0;
        if (className.startsWith('XII')) return 12;
        if (className.startsWith('XI')) return 11;
        if (className.startsWith('X')) return 10;
        return 0;
    };

    const isAsc = currentStudentSort.order === 'asc';
    const sortCol = currentStudentSort.column;

    filtered.sort((a, b) => {
        if (sortCol === 'ews') {
            const scoreA = Number(a.ewsResult?.totalScore || 0);
            const scoreB = Number(b.ewsResult?.totalScore || 0);
            if (scoreA !== scoreB) {
                return isAsc ? scoreA - scoreB : scoreB - scoreA;
            }
            return (a.student_name || '').localeCompare(b.student_name || '', 'id', { numeric: true });
        } else if (sortCol === 'alpa') {
            const alpaA = Number(a.aggregates?.attendance?.A || a.ewsResult?.details?.alpa || 0);
            const alpaB = Number(b.aggregates?.attendance?.A || b.ewsResult?.details?.alpa || 0);
            if (alpaA !== alpaB) {
                return isAsc ? alpaA - alpaB : alpaB - alpaA;
            }
            return (a.student_name || '').localeCompare(b.student_name || '', 'id', { numeric: true });
        } else if (sortCol === 'percent') {
            const pctA = getStudentPresencePct(a);
            const pctB = getStudentPresencePct(b);
            if (pctA !== pctB) {
                return isAsc ? pctA - pctB : pctB - pctA;
            }
            return (a.student_name || '').localeCompare(b.student_name || '', 'id', { numeric: true });
        } else if (sortCol === 'points') {
            const ptsA = Number(a.aggregates?.points || a.aggregates?.totalPoints || a.ewsResult?.details?.points || 0);
            const ptsB = Number(b.aggregates?.points || b.aggregates?.totalPoints || b.ewsResult?.details?.points || 0);
            if (ptsA !== ptsB) {
                return isAsc ? ptsA - ptsB : ptsB - ptsA;
            }
            return (a.student_name || '').localeCompare(b.student_name || '', 'id', { numeric: true });
        } else if (sortCol === 'permisi') {
            const permA = Number(a.aggregates?.permisi ?? a.permissionCount ?? a.ewsResult?.details?.permisi ?? 0);
            const permB = Number(b.aggregates?.permisi ?? b.permissionCount ?? b.ewsResult?.details?.permisi ?? 0);
            if (permA !== permB) {
                return isAsc ? permA - permB : permB - permA;
            }
            return (a.student_name || '').localeCompare(b.student_name || '', 'id', { numeric: true });
        } else if (sortCol === 'name') {
            const nameComp = (a.student_name || '').localeCompare(b.student_name || '', 'id', { numeric: true });
            return isAsc ? nameComp : -nameComp;
        } else {
            // Default 'class' atau 'no' (berdasarkan tingkat kelas & nama)
            const levelA = getClassLevel(a.student_class);
            const levelB = getClassLevel(b.student_class);
            if (levelB !== levelA) return isAsc ? levelB - levelA : levelA - levelB;
            const classCompare = (a.student_class || '').localeCompare(b.student_class || '', 'id', { numeric: true });
            if (classCompare !== 0) return isAsc ? classCompare : -classCompare;
            const nameComp = (a.student_name || '').localeCompare(b.student_name || '', 'id', { numeric: true });
            return isAsc ? nameComp : -nameComp;
        }
    });

    return filtered;
}

window.applyFiltersAndRender = function () {
    const filtered = getFilteredAndSortedStudents();
    renderStudentGrid(filtered);
    renderStudentTable(filtered);
    renderMatriksEws(filtered);
    updateTableSortIcons();
};

// --- RENDER STUDENT GRID (KARTU INFORMATIF) ---
function renderStudentGrid(filteredList) {
    const grid = document.getElementById('siswa-grid');
    if (!grid) return;

    if (!filteredList || filteredList.length === 0) {
        grid.innerHTML = `<div class="col-span-full text-center py-12 text-slate-400">
            <i class="fa-solid fa-user-slash text-4xl mb-3"></i>
            <p>Tidak ada siswa yang sesuai kriteria filter/pencarian.</p>
        </div>`;
        return;
    }

    grid.innerHTML = filteredList.map(s => {
        const initial = s.student_name ? s.student_name.charAt(0).toUpperCase() : '?';
        const ews = s.ewsResult || { level: 'low', label: 'Aman', colorClass: 'text-emerald-600 bg-emerald-50 border-emerald-200', badgeBg: 'bg-emerald-500', totalScore: 0 };
        const att = (s.aggregates && s.aggregates.attendance) || {};
        const h = Number(att.H || 0);
        const s_cnt = Number(att.S || 0);
        const i_cnt = Number(att.I || 0);
        const a_cnt = Number(att.A || 0);
        const d_cnt = Number(att.D || 0);
        const totalDays = h + s_cnt + i_cnt + a_cnt + d_cnt;
        const pct = totalDays > 0 ? Math.round(((h + d_cnt) / totalDays) * 100) : 100;
        
        const presenceColor = pct >= 92 ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30' :
                              pct >= 85 ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30' :
                              'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/30';

        const bkPoints = Number(s.aggregates?.points || s.aggregates?.totalPoints || 0);
        const sppLabel = s.sppStatus ? s.sppStatus.label : 'Lunas';
        const sppColor = s.sppStatus && s.sppStatus.isPaid ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';

        const lastNoteHtml = s.lastNote ? `
            <div class="text-[11px] text-slate-600 dark:text-slate-300 truncate font-medium">
                <i class="fa-solid fa-clipboard-check text-indigo-500 mr-1"></i>${window.escapeHTML(s.lastNote.title)} <span class="text-[9px] text-slate-400">(${window.escapeHTML(s.lastNote.date)})</span>
            </div>
        ` : `<span class="text-[11px] text-slate-400 dark:text-slate-500 italic">Belum ada catatan pembinaan</span>`;

        const safeName = window.escapeHTML(s.student_name);
        const safeNIS = window.escapeHTML(s.student_nis);
        const safeClass = window.escapeHTML(s.student_class);

        const rawPhoto = s.activePhotoUrl || s.active_photo_url || s.photoUrl || s.foto || '';
        const resolvedPhoto = (typeof window.resolvePhotoUrl === 'function' && rawPhoto)
            ? window.resolvePhotoUrl(rawPhoto)
            : rawPhoto;
        const safePhotoUrl = (resolvedPhoto && /^(https?:|\/|data:image\/)/i.test(resolvedPhoto))
            ? window.escapeHTML(resolvedPhoto)
            : '';

        const cardAvatarHtml = safePhotoUrl
            ? `<div class="w-11 h-11 rounded-xl shrink-0 overflow-hidden shadow-sm ring-1 ring-slate-200 dark:ring-slate-700 bg-slate-100 dark:bg-slate-800">
                <img src="${safePhotoUrl}" alt="${safeName}" class="w-full h-full object-cover" loading="lazy" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'w-full h-full bg-gradient-to-tr from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-base\\'>${initial}</div>';" />
               </div>`
            : `<div class="w-11 h-11 bg-gradient-to-tr from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center text-white font-bold text-base shadow-sm shrink-0">
                ${initial}
               </div>`;

        return `
        <div class="bg-white dark:bg-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-2xl p-4 transition-all shadow-sm hover:shadow-md flex flex-col justify-between gap-3">
            <div>
                <!-- Top Row: Avatar & Basic Info -->
                <div class="flex items-start justify-between gap-2 mb-2.5">
                    <div class="flex items-center gap-3 cursor-pointer flex-1 min-w-0" onclick="window.openDetailSiswa('${safeNIS}')">
                        ${cardAvatarHtml}
                        <div class="min-w-0 flex-1">
                            <h4 class="font-bold text-sm text-slate-800 dark:text-white break-words leading-snug hover:text-blue-600 transition-colors">${safeName}</h4>
                            <p class="text-xs text-slate-500 dark:text-slate-400 break-words mt-0.5">${safeClass} • NIS: ${safeNIS}</p>
                        </div>
                    </div>
                    <!-- EWS Badge -->
                    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${ews.colorClass} shrink-0">
                        <span class="w-1.5 h-1.5 rounded-full ${ews.badgeBg}"></span>
                        ${ews.label} (${ews.totalScore})
                    </span>
                </div>

                <!-- Metrics Grid (Presensi, BK, SPP) -->
                <div class="grid grid-cols-3 gap-2 my-2.5 p-2.5 bg-slate-50 dark:bg-slate-800/80 rounded-xl border border-slate-100 dark:border-slate-700/60">
                    <!-- Presensi -->
                    <div class="text-center border-r border-slate-200 dark:border-slate-700 pr-1">
                        <p class="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Hadir</p>
                        <p class="text-xs font-black ${presenceColor} px-1 py-0.5 rounded-md mt-0.5 inline-block">${pct}%</p>
                        <p class="text-[9px] text-slate-400 mt-0.5">A:${a_cnt} S:${s_cnt} I:${i_cnt}</p>
                    </div>

                    <!-- BK Points -->
                    <div class="text-center border-r border-slate-200 dark:border-slate-700 pr-1">
                        <p class="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Poin BK</p>
                        <p class="text-xs font-black ${bkPoints > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-700 dark:text-slate-300'} mt-0.5">${bkPoints}</p>
                        <p class="text-[9px] text-slate-400 mt-0.5">Poin Pelanggaran</p>
                    </div>

                    <!-- SPP Status -->
                    <div class="text-center">
                        <p class="text-[9px] font-bold text-slate-400 uppercase tracking-wider">SPP</p>
                        <span class="inline-block px-1.5 py-0.5 text-[10px] font-bold rounded-md ${sppColor} mt-0.5 truncate max-w-full">${sppLabel}</span>
                        <p class="text-[9px] text-slate-400 mt-0.5">Status Keuangan</p>
                    </div>
                </div>

                <!-- Last Note Preview -->
                <div class="bg-indigo-50/50 dark:bg-indigo-950/30 p-2 rounded-xl border border-indigo-100/50 dark:border-indigo-900/40">
                    ${lastNoteHtml}
                </div>
            </div>

            <!-- Action Buttons Row -->
            <div class="flex items-center justify-between gap-1.5 pt-2.5 border-t border-slate-100 dark:border-slate-700/60">
                <div class="flex items-center gap-1.5">
                    <button onclick="window.openModalTambahCatatanForStudent('${safeNIS}')" class="px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/70 rounded-xl text-xs font-bold transition-all active:scale-95 flex items-center gap-1.5 min-h-[34px]" title="Tambah Catatan Pembinaan">
                        <i class="fa-solid fa-pen text-[11px]"></i><span>+ Catatan</span>
                    </button>
                    <button onclick="window.openWhatsAppParent('${safeNIS}', '${safeName}', '${s.phone_parent || s.phone_siswa || ''}')" class="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/70 rounded-xl text-xs font-bold transition-all active:scale-95 flex items-center gap-1.5 min-h-[34px]" title="Hubungi Orang Tua via WhatsApp">
                        <i class="fa-brands fa-whatsapp text-sm text-emerald-600 dark:text-emerald-400"></i><span>WA Ortu</span>
                    </button>
                </div>

                <div class="flex items-center gap-1.5">
                    <a href="siswa.html?nis=${encodeURIComponent(s.student_nis)}&action=print" target="_blank" onclick="event.stopPropagation()" class="w-8 h-8 flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-all active:scale-95" title="Cetak Rapor Siswa">
                        <i class="fa-solid fa-print text-xs"></i>
                    </a>
                    <button onclick="window.openDetailSiswa('${safeNIS}')" class="w-8 h-8 flex items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-700 shadow-sm shadow-blue-500/20 transition-all active:scale-95" title="Buka Detail Lengkap">
                        <i class="fa-solid fa-arrow-right text-xs"></i>
                    </button>
                </div>
            </div>
        </div>
        `;
    }).join('');
}

// --- RENDER STUDENT TABLE (SPREADSHEET MODE) ---
function renderStudentTable(filteredList) {
    const tbody = document.getElementById('siswa-table-body');
    if (!tbody) return;

    if (!filteredList || filteredList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="p-8 text-center text-slate-400">Tidak ada siswa yang sesuai filter.</td></tr>`;
        return;
    }

    tbody.innerHTML = filteredList.map((s, idx) => {
        const ews = s.ewsResult || { level: 'low', label: 'Aman', colorClass: 'text-emerald-600 bg-emerald-50 border-emerald-200', totalScore: 0 };
        const att = (s.aggregates && s.aggregates.attendance) || {};
        const h = Number(att.H || 0);
        const s_cnt = Number(att.S || 0);
        const i_cnt = Number(att.I || 0);
        const a_cnt = Number(att.A || 0);
        const d_cnt = Number(att.D || 0);
        const t_cnt = Number(att.T || 0);
        const totalDays = h + s_cnt + i_cnt + a_cnt + d_cnt;
        const pct = totalDays > 0 ? Math.round(((h + d_cnt) / totalDays) * 100) : 100;
        
        const presenceColor = pct >= 92 ? 'text-emerald-600 dark:text-emerald-400' :
                              pct >= 85 ? 'text-amber-600 dark:text-amber-400' :
                              'text-rose-600 dark:text-rose-400';

        const bkPoints = Number(s.aggregates?.points || s.aggregates?.totalPoints || 0);
        const sppLabel = s.sppStatus ? s.sppStatus.label : 'Lunas';
        const sppBadge = s.sppStatus && s.sppStatus.isPaid ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';

        const lastNoteStr = s.lastNote ? `${s.lastNote.title} (${s.lastNote.date})` : '-';

        const safeName = window.escapeHTML(s.student_name);
        const safeNIS = window.escapeHTML(s.student_nis);
        const safeClass = window.escapeHTML(s.student_class);

        const initial = s.student_name ? s.student_name.charAt(0).toUpperCase() : '?';
        const rawPhoto = s.activePhotoUrl || s.active_photo_url || s.photoUrl || s.foto || '';
        const resolvedPhoto = (typeof window.resolvePhotoUrl === 'function' && rawPhoto)
            ? window.resolvePhotoUrl(rawPhoto)
            : rawPhoto;
        const safePhotoUrl = (resolvedPhoto && /^(https?:|\/|data:image\/)/i.test(resolvedPhoto))
            ? window.escapeHTML(resolvedPhoto)
            : '';

        const tableAvatarHtml = safePhotoUrl
            ? `<div class="w-8 h-8 rounded-lg shrink-0 overflow-hidden shadow-2xs ring-1 ring-slate-200 dark:ring-slate-700 bg-slate-100 dark:bg-slate-800">
                <img src="${safePhotoUrl}" alt="${safeName}" class="w-full h-full object-cover" loading="lazy" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'w-full h-full bg-gradient-to-tr from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xs\\'>${initial}</div>';" />
               </div>`
            : `<div class="w-8 h-8 bg-gradient-to-tr from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center text-white font-bold text-xs shadow-2xs shrink-0">
                ${initial}
               </div>`;

        return `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
            <td class="p-3 text-center font-bold text-slate-400">${idx + 1}</td>
            <td class="p-3 cursor-pointer" onclick="window.openDetailSiswa('${safeNIS}')">
                <div class="flex items-center gap-2.5">
                    ${tableAvatarHtml}
                    <div class="min-w-0">
                        <p class="font-bold text-slate-800 dark:text-white hover:text-blue-600 transition-colors break-words whitespace-normal">${safeName}</p>
                        <p class="text-[11px] text-slate-400 break-words whitespace-normal">${safeClass} • NIS: ${safeNIS}</p>
                    </div>
                </div>
            </td>
            <td class="p-3 text-center">
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${ews.colorClass}">
                    ${ews.label} (${ews.totalScore})
                </span>
            </td>
            <td class="p-3 text-center font-mono">
                <span class="text-emerald-600 font-bold">${h}</span> / <span class="text-blue-500 font-bold">${s_cnt}</span> / <span class="text-amber-500 font-bold">${i_cnt}</span> / <span class="text-rose-600 font-bold">${a_cnt}</span> / <span class="text-purple-500 font-bold">${d_cnt}</span>
            </td>
            <td class="p-3 text-center font-bold ${presenceColor}">${pct}%</td>
            <td class="p-3 text-center font-bold ${bkPoints > 0 ? 'text-rose-600' : 'text-slate-600 dark:text-slate-400'}">${bkPoints}</td>
            <td class="p-3 text-center">
                <span class="px-2 py-0.5 text-[10px] font-bold rounded-full ${sppBadge}">${sppLabel}</span>
            </td>
            <td class="p-3 text-slate-600 dark:text-slate-300 max-w-[180px] truncate" title="${window.escapeHTML(lastNoteStr)}">${window.escapeHTML(lastNoteStr)}</td>
            <td class="p-3 text-center">
                <div class="flex items-center justify-center gap-1">
                    <button onclick="window.openModalTambahCatatanForStudent('${safeNIS}')" class="p-1.5 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/40 rounded-lg transition" title="Tambah Catatan">
                        <i class="fa-solid fa-pen text-xs"></i>
                    </button>
                    <button onclick="window.openWhatsAppParent('${safeNIS}', '${safeName}', '${s.phone_parent || s.phone_siswa || ''}')" class="p-1.5 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/40 rounded-lg transition" title="WhatsApp Ortu">
                        <i class="fa-brands fa-whatsapp text-xs"></i>
                    </button>
                    <button onclick="window.openDetailSiswa('${safeNIS}')" class="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/40 rounded-lg transition" title="Buka Detail">
                        <i class="fa-solid fa-eye text-xs"></i>
                    </button>
                </div>
            </td>
        </tr>
        `;
    }).join('');
}

// --- RENDER MATRIKS EWS ---
function renderMatriksEws(filteredList) {
    const tbody = document.getElementById('matriks-ews-table-body');
    if (!tbody) return;

    if (!filteredList || filteredList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-slate-400">Tidak ada data matriks EWS.</td></tr>`;
        return;
    }

    tbody.innerHTML = filteredList.map((s, idx) => {
        const ews = s.ewsResult || { totalScore: 0, level: 'low', label: 'Aman', details: {} };
        const d = ews.details || {};
        const safeName = window.escapeHTML(s.student_name);
        const safeNIS = window.escapeHTML(s.student_nis);
        const safeClass = window.escapeHTML(s.student_class);

        const alpaCount = Number(d.alpa || 0);
        const izinCount = Number(d.izin || 0);
        const permisiCount = Number(d.permisi || 0);
        const pointsCount = Number(d.points || 0);

        const alpaClass = alpaCount > 0 ? 'text-rose-600 font-bold' : 'text-slate-600 dark:text-slate-400 font-bold';
        const izinClass = izinCount > 0 ? 'text-amber-600 font-bold' : 'text-slate-600 dark:text-slate-400 font-bold';
        const permisiClass = permisiCount > 0 ? 'text-indigo-600 dark:text-indigo-400 font-bold' : 'text-slate-600 dark:text-slate-400 font-bold';
        const pointsClass = pointsCount > 0 ? 'text-rose-600 font-bold' : 'text-slate-600 dark:text-slate-400 font-bold';

        return `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
            <td class="p-3 text-center font-bold text-slate-400">${idx + 1}</td>
            <td class="p-3 font-bold text-slate-800 dark:text-white cursor-pointer break-words whitespace-normal" onclick="window.openDetailSiswa('${safeNIS}')">${safeName}</td>
            <td class="p-3 text-slate-500 dark:text-slate-400">${safeClass} • NIS: ${safeNIS}</td>
            <td class="p-3 text-center"><span class="${alpaClass}">${alpaCount} Alpa</span>, <span class="${izinClass}">${izinCount} Izin</span></td>
            <td class="p-3 text-center ${permisiClass}">${permisiCount}x</td>
            <td class="p-3 text-center ${pointsClass}">${pointsCount} Poin</td>
            <td class="p-3 text-center font-black text-sm">${ews.totalScore}</td>
            <td class="p-3 text-center">
                <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border ${ews.colorClass}">
                    <span class="w-1.5 h-1.5 rounded-full ${ews.badgeBg}"></span>
                    ${ews.label}
                </span>
            </td>
        </tr>
        `;
    }).join('');
}

// --- VIEW MODE SWITCHER ---
window.setViewMode = function (mode) {
    currentViewMode = mode;
    const btnGrid = document.getElementById('btn-view-grid');
    const btnTable = document.getElementById('btn-view-table');
    const containerGrid = document.getElementById('siswa-grid-container');
    const containerTable = document.getElementById('siswa-table-container');

    if (mode === 'grid') {
        if (btnGrid) {
            btnGrid.classList.add('active', 'bg-white', 'dark:bg-slate-800', 'text-blue-600', 'dark:text-blue-400', 'shadow');
            btnGrid.classList.remove('text-slate-500', 'dark:text-slate-400');
        }
        if (btnTable) {
            btnTable.classList.remove('active', 'bg-white', 'dark:bg-slate-800', 'text-blue-600', 'dark:text-blue-400', 'shadow');
            btnTable.classList.add('text-slate-500', 'dark:text-slate-400');
        }
        if (containerGrid) containerGrid.classList.remove('hidden');
        if (containerTable) containerTable.classList.add('hidden');
    } else {
        if (btnTable) {
            btnTable.classList.add('active', 'bg-white', 'dark:bg-slate-800', 'text-blue-600', 'dark:text-blue-400', 'shadow');
            btnTable.classList.remove('text-slate-500', 'dark:text-slate-400');
        }
        if (btnGrid) {
            btnGrid.classList.remove('active', 'bg-white', 'dark:bg-slate-800', 'text-blue-600', 'dark:text-blue-400', 'shadow');
            btnGrid.classList.add('text-slate-500', 'dark:text-slate-400');
        }
        if (containerTable) containerTable.classList.remove('hidden');
        if (containerGrid) containerGrid.classList.add('hidden');
    }
};

// --- WHATSAPP PARENT HELPER ---
window.openWhatsAppParent = function (nis, name, parentPhone) {
    if (!parentPhone) {
        showToast('Info', `Nomor telepon orang tua untuk ${name} belum diisi di data profil.`, 'info');
        return;
    }
    let cleanPhone = String(parentPhone).replace(/[^0-9]/g, '');
    if (cleanPhone.startsWith('0')) {
        cleanPhone = '62' + cleanPhone.slice(1);
    }
    const message = encodeURIComponent(`Om Swastyastu / Selamat Pagi/Siang Bapak/Ibu Orang Tua dari Ananda ${name} (NIS: ${nis}). Saya Guru Wali perwalian sekolah ingin menyampaikan informasi bimbingan siswa...`);
    window.open(`https://wa.me/${cleanPhone}?text=${message}`, '_blank');
};

// --- OPEN CATATAN MODAL FOR SPECIFIC STUDENT ---
window.openModalTambahCatatanForStudent = function (nis) {
    const student = myStudents.find(s => String(s.student_nis).trim() === String(nis).trim());
    if (!student) return;

    selectedStudentsForNote = [student];
    renderCatatanSiswaChips();
    loadMyStudentsForNoteDatalist();

    const dateInput = document.getElementById('catatan-tanggal');
    if (dateInput) dateInput.value = window.getLocalISODate ? window.getLocalISODate() : new Date().toLocaleDateString('sv-SE');

    const modal = document.getElementById('modal-tambah-catatan');
    if (modal) modal.classList.remove('hidden');
};

// --- EXPORT PERWALIAN REPORT TO EXCEL ---
window.exportPerwalianReport = function () {
    if (!myStudents || myStudents.length === 0) {
        showToast('Info', 'Tidak ada data siswa perwalian untuk diexport.', 'info');
        return;
    }

    try {
        const rows = myStudents.map((s, idx) => {
            const att = (s.aggregates && s.aggregates.attendance) || {};
            const h = Number(att.H || 0);
            const s_cnt = Number(att.S || 0);
            const i_cnt = Number(att.I || 0);
            const a_cnt = Number(att.A || 0);
            const d_cnt = Number(att.D || 0);
            const totalDays = h + s_cnt + i_cnt + a_cnt + d_cnt;
            const pct = totalDays > 0 ? Math.round(((h + d_cnt) / totalDays) * 100) : 100;
            const ews = s.ewsResult || {};
            const bk = Number(s.aggregates?.points || s.aggregates?.totalPoints || 0);
            const spp = s.sppStatus ? s.sppStatus.label : '-';

            return {
                'No': idx + 1,
                'NIS': s.student_nis,
                'Nama Siswa': s.student_name,
                'Kelas': s.student_class,
                'Status EWS': ews.label || 'Aman',
                'Skor EWS': ews.totalScore || 0,
                'Hadir (H)': h,
                'Sakit (S)': s_cnt,
                'Izin (I)': i_cnt,
                'Alpa (A)': a_cnt,
                '% Kehadiran': `${pct}%`,
                'Permisi': Number(s.aggregates?.permisi ?? s.permissionCount ?? (ews.details && ews.details.permisi) ?? 0),
                'Poin BK': bk,
                'Status SPP': spp,
                'Catatan Terakhir': s.lastNote ? `${s.lastNote.title} (${s.lastNote.date})` : 'Belum Ada'
            };
        });

        if (typeof XLSX !== 'undefined') {
            const worksheet = XLSX.utils.json_to_sheet(rows);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Laporan Perwalian');
            XLSX.writeFile(workbook, `Laporan_Perwalian_GuruWali_${new Date().toISOString().slice(0, 10)}.xlsx`);
            showToast('Sukses', 'Laporan perwalian berhasil diexport ke Excel.', 'success');
        } else {
            showToast('Info', 'Library Excel belum siap.', 'info');
        }
    } catch (err) {
        console.error('Error export excel:', err);
        showToast('Gagal', 'Gagal membuat file Excel.', 'error');
    }
};

function updateTotalCounter() {
    document.getElementById('total-siswa-perwalian').innerText = myStudents.length;
}

// --- POPULATE FILTER DROPDOWN ---
function populateSiswaFilters() {
    const filterSelect = document.getElementById('filter-siswa-catatan');
    const catatanSelect = document.getElementById('catatan-siswa');

    const options = myStudents.map(s => {
        const safeNIS = window.escapeHTML ? window.escapeHTML(String(s.student_nis)) : s.student_nis;
        const safeName = window.escapeHTML ? window.escapeHTML(s.student_name) : s.student_name;
        const safeClass = window.escapeHTML ? window.escapeHTML(s.student_class) : s.student_class;
        return `<option value="${safeNIS}">${safeName} (${safeClass})</option>`;
    }).join('');

    if (filterSelect) {
        filterSelect.innerHTML = `<option value="">Semua Siswa</option>${options}`;
    }
    if (catatanSelect) {
        catatanSelect.innerHTML = `<option value="">-- Pilih Siswa --</option>${options}`;
    }
}

// --- LOAD ALL STUDENTS FOR DATALIST ---
async function loadAllStudentsForDatalist() {
    try {
        // GUNAKAN GLOBAL CACHE (Hemat Kuota Read)
        const allStudents = await window.getStudentsCache();

        // Filter dan map ke allStudentsCache lokal
        allStudentsCache = allStudents
            .filter(s => s.class && !s.class.toLowerCase().includes('alumni'))
            .map(s => ({
                nis: s.nis,
                name: s.name,
                class: s.class
            }));

        // Sort by class then name
        allStudentsCache.sort((a, b) => {
            const classDiff = (a.class || '').localeCompare(b.class || '', undefined, { numeric: true });
            if (classDiff !== 0) return classDiff;
            return (a.name || '').localeCompare(b.name || '');
        });

        // Populate dropdown siswa
        renderTambahSiswaDropdown();

    } catch (e) {
        console.error('Error load all students:', e);
    }
}

// --- HANDLE TAMBAH SISWA SELECTION (SEARCHABLE FLOATING DROPDOWN) ---
window.showTambahSiswaDropdown = function () {
    const dropdown = document.getElementById('tambah-siswa-dropdown');
    if (!dropdown) return;
    renderTambahSiswaDropdown();
    dropdown.classList.remove('hidden');
};

window.hideTambahSiswaDropdown = function () {
    const dropdown = document.getElementById('tambah-siswa-dropdown');
    if (dropdown) dropdown.classList.add('hidden');
};

window.filterTambahSiswaDropdown = function () {
    const dropdown = document.getElementById('tambah-siswa-dropdown');
    if (!dropdown) return;
    renderTambahSiswaDropdown();
    dropdown.classList.remove('hidden');
};

function renderTambahSiswaDropdown() {
    const dropdown = document.getElementById('tambah-siswa-dropdown');
    const input = document.getElementById('search-siswa-input');
    if (!dropdown) return;

    const query = input ? input.value.trim().toLowerCase() : '';

    // ATURAN: Hanya tampilkan daftar siswa jika minimal 2 karakter sudah diketik
    if (query.length < 2) {
        dropdown.innerHTML = `
            <div class="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                <div class="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-500 flex items-center justify-center mx-auto mb-2.5">
                    <i class="fa-solid fa-keyboard text-lg"></i>
                </div>
                <p class="font-semibold text-slate-700 dark:text-slate-300">Ketik minimal 2 karakter</p>
                <p class="text-[11px] text-slate-400 dark:text-slate-500 mt-1">Masukkan nama, NIS, atau kelas siswa untuk menampilkan daftar hasil pencarian.</p>
            </div>
        `;
        return;
    }

    const existingNIS = new Set(myStudents.map(s => String(s.student_nis).trim()));
    const selectedNIS = new Set(selectedStudentsToAdd.map(s => String(s.nis).trim()));

    // Pencarian memory-cache murni (0 Firestore Read & 0 Network fetch)
    const availableStudents = allStudentsCache.filter(s => {
        const nisStr = String(s.nis).trim();
        if (existingNIS.has(nisStr)) return false;

        const name = (s.name || '').toLowerCase();
        const sClass = (s.class || '').toLowerCase();
        return name.includes(query) || nisStr.includes(query) || sClass.includes(query);
    });

    // Urutkan siswa berdasarkan tingkat kelas: XII -> XI -> X, lalu kelas & nama
    availableStudents.sort((a, b) => {
        const weightA = getGradeWeight(a.class);
        const weightB = getGradeWeight(b.class);
        if (weightA !== weightB) {
            return weightB - weightA;
        }
        const classComp = (a.class || '').localeCompare(b.class || '', 'id', { numeric: true });
        if (classComp !== 0) return classComp;
        return (a.name || '').localeCompare(b.name || '', 'id', { numeric: true });
    });

    if (availableStudents.length === 0) {
        dropdown.innerHTML = `
            <div class="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                <div class="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-700/60 text-slate-400 flex items-center justify-center mx-auto mb-2.5 text-lg">
                    <i class="fa-solid fa-user-slash"></i>
                </div>
                <p class="font-semibold text-slate-700 dark:text-slate-300">Tidak ada siswa ditemukan</p>
                <p class="text-[11px] text-slate-400 dark:text-slate-500 mt-1">Tidak ada siswa yang cocok dengan "${window.escapeHTML(query)}".</p>
            </div>
        `;
        return;
    }

    // Batasi render maksimal 50 siswa agar DOM tetap sangat ringan dan cepat
    const maxResults = 50;
    const displayStudents = availableStudents.slice(0, maxResults);

    let html = `
        <div class="sticky top-0 bg-slate-50 dark:bg-slate-750 px-3.5 py-2 border-b border-slate-100 dark:border-slate-700/60 flex justify-between items-center text-[11px] font-semibold text-slate-500 dark:text-slate-400 z-10">
            <span>Ditemukan <strong>${availableStudents.length}</strong> siswa</span>
            <span class="text-[10px] text-blue-600 dark:text-blue-400">Pilih untuk menambahkan</span>
        </div>
    `;

    html += displayStudents.map(s => {
        const safeNIS = window.escapeHTML(s.nis);
        const safeName = window.escapeHTML(s.name);
        const safeClass = window.escapeHTML(s.class || '-');
        const isSelected = selectedNIS.has(String(s.nis).trim());

        return `
            <div onclick="window.toggleSelectTambahSiswa('${safeNIS}')"
                class="p-2.5 sm:p-3 hover:bg-blue-50/80 dark:hover:bg-blue-900/40 cursor-pointer transition flex items-center justify-between group ${isSelected ? 'bg-blue-50/60 dark:bg-blue-950/30' : ''}">
                <div class="flex items-center gap-2.5 sm:gap-3 min-w-0 pr-2">
                    <div class="w-8 h-8 rounded-full ${isSelected ? 'bg-blue-600 text-white' : 'bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-400'} flex items-center justify-center font-bold text-xs shrink-0 transition-colors">
                        <i class="fa-solid ${isSelected ? 'fa-check' : 'fa-user-graduate'}"></i>
                    </div>
                    <div class="min-w-0">
                        <div class="text-xs sm:text-sm font-bold text-slate-800 dark:text-white ${isSelected ? 'text-blue-600 dark:text-blue-400' : 'group-hover:text-blue-600 dark:group-hover:text-blue-400'} transition-colors truncate">
                            ${safeName}
                        </div>
                        <div class="text-[10px] sm:text-[11px] text-slate-400 dark:text-slate-500 flex items-center gap-1.5 mt-0.5">
                            <span class="font-mono">NIS: ${safeNIS}</span>
                            <span>&bull;</span>
                            <span class="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-semibold text-[10px]">${safeClass}</span>
                        </div>
                    </div>
                </div>
                <div class="flex items-center gap-1 shrink-0 ml-2">
                    ${isSelected
                        ? `<span class="px-2 py-0.5 text-[10px] font-bold rounded-md bg-blue-600 text-white flex items-center gap-1 shadow-sm"><i class="fa-solid fa-check text-[9px]"></i> Terpilih</span>`
                        : `<span class="px-2 py-0.5 text-[10px] font-semibold rounded-md bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 group-hover:bg-blue-600 group-hover:text-white dark:group-hover:bg-blue-600 transition-colors flex items-center gap-1"><i class="fa-solid fa-plus text-[9px]"></i> Pilih</span>`
                    }
                </div>
            </div>
        `;
    }).join('');

    if (availableStudents.length > maxResults) {
        html += `
            <div class="p-2 text-center text-[10px] text-slate-400 dark:text-slate-500 bg-slate-50/50 dark:bg-slate-750 border-t border-slate-100 dark:border-slate-700/60">
                Menampilkan 50 dari ${availableStudents.length} siswa. Ketik lebih spesifik untuk mempersempit hasil.
            </div>
        `;
    }

    dropdown.innerHTML = html;
}

window.toggleSelectTambahSiswa = function (nis) {
    const nisStr = String(nis).trim();
    const existingIdx = selectedStudentsToAdd.findIndex(s => String(s.nis).trim() === nisStr);

    if (existingIdx >= 0) {
        selectedStudentsToAdd.splice(existingIdx, 1);
    } else {
        const student = allStudentsCache.find(s => String(s.nis).trim() === nisStr);
        if (!student) return;

        if (myStudents.some(s => String(s.student_nis).trim() === nisStr)) {
            showToast('Info', 'Siswa ini sudah ada di perwalian Anda.', 'info');
            return;
        }

        selectedStudentsToAdd.push(student);
    }

    renderSelectedChips();
    renderTambahSiswaDropdown();

    const input = document.getElementById('search-siswa-input');
    if (input) {
        input.focus();
    }
};

window.selectTambahSiswa = function (nis) {
    window.toggleSelectTambahSiswa(nis);
};

window.clearAllSelectedSiswa = function () {
    selectedStudentsToAdd = [];
    renderSelectedChips();
    renderTambahSiswaDropdown();
};

function renderSelectedChips() {
    const container = document.getElementById('tambah-siswa-chips-container');
    const input = document.getElementById('search-siswa-input');
    const countBadge = document.getElementById('tambah-siswa-selected-count-badge');
    const footerInfo = document.getElementById('tambah-siswa-footer-info');
    const clearAllBtn = document.getElementById('btn-clear-all-selected');
    const submitBtn = document.getElementById('btn-submit-tambah-siswa');
    const submitBtnText = document.getElementById('btn-submit-tambah-siswa-text');

    const totalSelected = selectedStudentsToAdd.length;

    if (countBadge) countBadge.textContent = `${totalSelected} Siswa Dipilih`;
    if (footerInfo) {
        footerInfo.textContent = totalSelected === 0
            ? '0 siswa siap ditambahkan'
            : `${totalSelected} siswa siap ditambahkan ke perwalian`;
    }
    if (submitBtn) {
        submitBtn.disabled = (totalSelected === 0);
    }
    if (submitBtnText) {
        submitBtnText.textContent = totalSelected === 0
            ? 'Simpan Siswa'
            : `Simpan (${totalSelected} Siswa)`;
    }
    if (clearAllBtn) {
        if (totalSelected > 0) clearAllBtn.classList.remove('hidden');
        else clearAllBtn.classList.add('hidden');
    }

    if (!container || !input) return;

    // Remove existing chips (but keep input)
    const chips = container.querySelectorAll('.tambah-student-chip');
    chips.forEach(c => c.remove());

    // Insert chips before input
    selectedStudentsToAdd.forEach((s, idx) => {
        const chip = document.createElement('div');
        chip.className = 'tambah-student-chip inline-flex items-center gap-1.5 bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-2.5 py-1 rounded-lg text-xs font-bold break-words whitespace-normal border border-blue-200 dark:border-blue-800 animate-fadeIn';
        chip.innerHTML = `
            <span>${window.escapeHTML(s.name)}</span>
            <span class="text-[10px] text-blue-500 dark:text-blue-400 font-normal">(${window.escapeHTML(s.class || '-')})</span>
            <button type="button" onclick="event.stopPropagation(); window.removeSelectedSiswa(${idx})" class="hover:text-red-500 dark:hover:text-red-400 ml-0.5 rounded-full p-0.5 transition-colors" title="Hapus dari pilihan">
                <i class="fa-solid fa-xmark text-xs"></i>
            </button>
        `;
        container.insertBefore(chip, input);
    });
}

window.removeSelectedSiswa = function (idx) {
    selectedStudentsToAdd.splice(idx, 1);
    renderSelectedChips();
    renderTambahSiswaDropdown();
};

// --- SUBMIT TAMBAH SISWA ---
window.submitTambahSiswa = async function () {
    if (selectedStudentsToAdd.length === 0) {
        showToast('Peringatan', 'Pilih minimal 1 siswa.', 'warning');
        return;
    }

    const btn = document.getElementById('btn-submit-tambah-siswa');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Memeriksa...';
    btn.disabled = true;

    try {
        // Get guru name from cache
        let guruName = localStorage.getItem(`cached_user_name_${currentUser.uid}`) ||
            currentUser.displayName ||
            currentUser.email?.split('@')[0] || 'unknown';

        // --- VALIDASI DUPLIKAT: Cek apakah siswa sudah punya guru wali lain ---
        const conflicts = [];
        if (cfClient && cfClient.enabled && selectedStudentsToAdd.length > 0) {
            const uniqueClasses = [...new Set(selectedStudentsToAdd.map(s => s.class).filter(Boolean))];
            const nisSet = new Set(selectedStudentsToAdd.map(s => String(s.nis).trim()));
            let existingAssignments = [];

            if (uniqueClasses.length > 0 && uniqueClasses.length <= 3) {
                // Batch query per rombel kelas terpilih (jauh lebih hemat dan instan dibanding N queries individual)
                const classPromises = uniqueClasses.map(cls => cfClient.getGuruWaliAssignments({ class: cls }));
                const classResults = await Promise.all(classPromises);
                existingAssignments = classResults.flat();
            } else {
                const checkPromises = selectedStudentsToAdd.map(s => cfClient.getGuruWaliAssignments({ student_nis: s.nis }));
                const indResults = await Promise.all(checkPromises);
                existingAssignments = indResults.flat();
            }

            const studentMap = new Map(selectedStudentsToAdd.map(s => [String(s.nis).trim(), s]));
            (existingAssignments || []).forEach(data => {
                const sNis = String(data.student_nis || data.studentNis || data.nis || '').trim();
                if (nisSet.has(sNis) && data.guru_uid !== currentUser.uid) {
                    const studentObj = studentMap.get(sNis);
                    conflicts.push({
                        studentName: studentObj?.name || data.student_name || 'Siswa',
                        studentClass: studentObj?.class || data.student_class || '-',
                        existingGuruName: data.guru_name || 'Guru Lain'
                    });
                }
            });
        }

        // Jika ada konflik, tampilkan error dan batalkan
        if (conflicts.length > 0) {
            const conflictList = conflicts.map(c =>
                `• ${c.studentName} (${c.studentClass}) → sudah perwalian ${c.existingGuruName}`
            ).join('\n');

            showToast('Tidak Dapat Menambahkan',
                `Beberapa siswa sudah menjadi perwalian guru lain:\n${conflictList}\n\nSilakan koordinasi dengan guru wali terkait terlebih dahulu.`,
                'error', 8000);

            btn.innerHTML = originalText;
            btn.disabled = false;
            return;
        }
        // --- END VALIDASI DUPLIKAT ---

        let currentUserNik = '';
        try {
            const userDoc = typeof window.getCurrentUserDoc === 'function' ? await window.getCurrentUserDoc() : null;
            if (userDoc?.nik) currentUserNik = userDoc.nik;
            else if (userDoc?.linkedTeacherId) currentUserNik = userDoc.linkedTeacherId;
        } catch (_) {}

        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Menyimpan...';

        const assignmentItems = selectedStudentsToAdd.map(s => ({
            id: `${currentUser.uid}_${s.nis}`,
            guru_uid: currentUser.uid,
            guru_nip: currentUserNik || '',
            guru_name: guruName,
            student_nis: s.nis,
            student_name: s.name,
            student_class: s.class,
            academic_year: '2026/2027'
        }));

        if (cfClient && cfClient.enabled) {
            await cfClient.saveGuruWaliAssignments(assignmentItems);
        }

        if (typeof window.logAudit === 'function') {
            const addedNames = selectedStudentsToAdd.map(s => `${s.name} (${s.class})`).join(', ');
            window.logAudit('ADD_PERWALIAN', currentUser.uid, null, { count: selectedStudentsToAdd.length, students: addedNames }, `Menambahkan ${selectedStudentsToAdd.length} siswa ke perwalian`);
        }

        const mutationMsg = (typeof mutatedNotesCount !== 'undefined' && mutatedNotesCount > 0)
            ? ` (${mutatedNotesCount} catatan dimutasi)`
            : '';
        showToast('Berhasil', `${selectedStudentsToAdd.length} siswa ditambahkan ke perwalian Anda${mutationMsg}.`, 'success');
        closeModal('modal-tambah-siswa');

        // Clear selection
        selectedStudentsToAdd = [];

        // Clear cache dan reload data dengan force refresh
        clearMyStudentsCache();
        await loadMyStudents(true);
        renderTambahSiswaDropdown(); // Refresh dropdown to exclude newly added

    } catch (e) {
        console.error('Error tambah siswa:', e);
        showToast('Gagal', 'Gagal menyimpan data. Coba lagi.', 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

// --- HANDLE NOTE STUDENTS SELECTION (SEARCHABLE DROPDOWN COMBOBOX) ---
window.showCatatanSiswaDropdown = function () {
    const dropdown = document.getElementById('catatan-siswa-dropdown');
    if (!dropdown) return;
    renderCatatanSiswaDropdown();
    dropdown.classList.remove('hidden');
};

window.hideCatatanSiswaDropdown = function () {
    const dropdown = document.getElementById('catatan-siswa-dropdown');
    if (dropdown) dropdown.classList.add('hidden');
};

window.filterCatatanSiswaDropdown = function () {
    const dropdown = document.getElementById('catatan-siswa-dropdown');
    if (!dropdown) return;
    renderCatatanSiswaDropdown();
    dropdown.classList.remove('hidden');
};

function getGradeWeight(className) {
    if (!className) return 0;
    const str = String(className).toUpperCase().trim();
    if (str.startsWith('XII') || str.includes('12')) return 3;
    if (str.startsWith('XI') || str.includes('11')) return 2;
    if (str.startsWith('X') || str.includes('10')) return 1;
    return 0;
}

window.selectAllCatatanSiswa = function () {
    if (!myStudents || myStudents.length === 0) {
        showToast('Informasi', 'Belum ada data siswa binaan.', 'info');
        return;
    }
    selectedStudentsForNote = [...myStudents];
    renderCatatanSiswaChips();
    window.hideCatatanSiswaDropdown();
    const input = document.getElementById('catatan-search-siswa');
    if (input) input.value = '';
};

function renderCatatanSiswaDropdown() {
    const dropdown = document.getElementById('catatan-siswa-dropdown');
    const input = document.getElementById('catatan-search-siswa');
    if (!dropdown || !input) return;

    const query = input.value.trim().toLowerCase();
    const selectedNIS = new Set(selectedStudentsForNote.map(s => s.student_nis));

    const availableStudents = myStudents.filter(s => {
        if (selectedNIS.has(s.student_nis)) return false;
        if (!query) return true;
        const name = (s.student_name || '').toLowerCase();
        const nis = String(s.student_nis || '').toLowerCase();
        const sClass = (s.student_class || '').toLowerCase();
        return name.includes(query) || nis.includes(query) || sClass.includes(query);
    });

    // Urutkan siswa berdasarkan Kelas: XII -> XI -> X, lalu abjad kelas & nama
    availableStudents.sort((a, b) => {
        const weightA = getGradeWeight(a.student_class);
        const weightB = getGradeWeight(b.student_class);
        if (weightA !== weightB) {
            return weightB - weightA; // XII (3) dulu, lalu XI (2), lalu X (1)
        }
        const classComp = (a.student_class || '').localeCompare(b.student_class || '', 'id', { numeric: true });
        if (classComp !== 0) return classComp;
        return (a.student_name || '').localeCompare(b.student_name || '', 'id', { numeric: true });
    });

    if (availableStudents.length === 0) {
        dropdown.innerHTML = `
            <div class="p-3 text-xs text-center text-slate-400 dark:text-slate-500 italic">
                ${myStudents.length === 0 ? 'Belum ada data siswa binaan.' : 'Tidak ada siswa ditemukan.'}
            </div>
        `;
        return;
    }

    const collectiveOption = (!query && availableStudents.length > 1) ? `
        <div onclick="window.selectAllCatatanSiswa()" 
            class="p-2.5 bg-indigo-50/80 dark:bg-indigo-900/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/70 cursor-pointer transition flex items-center justify-between text-indigo-600 dark:text-indigo-300 font-bold text-xs border-b border-indigo-100 dark:border-indigo-800/50 group">
            <div class="flex items-center gap-2">
                <div class="w-7 h-7 rounded-full bg-indigo-200 dark:bg-indigo-800 text-indigo-700 dark:text-indigo-300 flex items-center justify-center font-bold text-xs">
                    <i class="fa-solid fa-users-check"></i>
                </div>
                <div>
                    <div class="text-xs font-bold text-indigo-700 dark:text-indigo-300">
                        Pilih Semua Siswa Binaan (Kolektif)
                    </div>
                    <div class="text-[10px] text-indigo-500 dark:text-indigo-400">
                        Pilih sekaligus ${availableStudents.length} siswa binaan
                    </div>
                </div>
            </div>
            <i class="fa-solid fa-check-double text-xs text-indigo-500 dark:text-indigo-400"></i>
        </div>
    ` : '';

    dropdown.innerHTML = collectiveOption + availableStudents.map(s => {
        const safeNIS = window.escapeHTML(s.student_nis);
        const safeName = window.escapeHTML(s.student_name);
        const safeClass = window.escapeHTML(s.student_class || '-');
        return `
            <div onclick="window.selectCatatanSiswa('${safeNIS}')" 
                class="p-2.5 hover:bg-indigo-50 dark:hover:bg-indigo-900/40 cursor-pointer transition flex items-center justify-between group">
                <div class="flex items-center gap-2">
                    <div class="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-xs">
                        <i class="fa-solid fa-user"></i>
                    </div>
                    <div>
                        <div class="text-xs font-bold text-slate-800 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                            ${safeName}
                        </div>
                        <div class="text-[10px] text-slate-400 dark:text-slate-500">
                            NIS: ${safeNIS} &bull; Kelas: ${safeClass}
                        </div>
                    </div>
                </div>
                <i class="fa-solid fa-plus text-xs text-slate-300 dark:text-slate-600 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors"></i>
            </div>
        `;
    }).join('');
}

window.selectCatatanSiswa = function (nis) {
    const student = myStudents.find(s => String(s.student_nis).trim() === String(nis).trim());
    if (!student) return;

    if (!selectedStudentsForNote.some(s => s.student_nis === student.student_nis)) {
        selectedStudentsForNote.push(student);
        renderCatatanSiswaChips();
    }

    const input = document.getElementById('catatan-search-siswa');
    if (input) input.value = '';

    window.hideCatatanSiswaDropdown();
};

function renderCatatanSiswaChips() {
    const container = document.getElementById('catatan-selected-chips');
    const input = document.getElementById('catatan-search-siswa');
    if (!container || !input) return;

    // Remove existing chips (but keep input)
    const chips = container.querySelectorAll('.student-chip');
    chips.forEach(c => c.remove());

    // Insert chips before input
    selectedStudentsForNote.forEach((s, idx) => {
        const chip = document.createElement('div');
        chip.className = 'student-chip flex items-center gap-1 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400 px-2 py-1 rounded-md text-xs font-bold break-words whitespace-normal';
        chip.innerHTML = `
            <span>${window.escapeHTML(s.student_name)}</span>
            <button type="button" onclick="window.removeSelectedCatatanSiswa(${idx})" class="hover:text-red-500 dark:hover:text-red-400 ml-1 rounded-full p-0.5">
                <i class="fa-solid fa-xmark"></i>
            </button>
        `;
        container.insertBefore(chip, input);
    });
}

window.removeSelectedCatatanSiswa = function (idx) {
    selectedStudentsForNote.splice(idx, 1);
    renderCatatanSiswaChips();
    renderCatatanSiswaDropdown();
};

// --- MODAL OPENERS ---
window.openModalTambahSiswa = function () {
    // Reset seleksi dan filter sebelumnya
    selectedStudentsToAdd = [];
    const input = document.getElementById('search-siswa-input');
    if (input) input.value = '';

    renderSelectedChips();
    renderTambahSiswaDropdown();

    document.getElementById('modal-tambah-siswa').classList.remove('hidden');
    setTimeout(() => {
        if (input) {
            input.focus();
            window.showTambahSiswaDropdown();
        }
    }, 100);
};

let _catatanSelectedPhotos = []; // [{ file, previewUrl, name }]

window.applyCatatanQuickDuration = function (minutes = 45) {
    const startInput = document.getElementById('catatan-jam-mulai');
    const endInput = document.getElementById('catatan-jam-selesai');
    const label = document.getElementById('catatan-durasi-label');
    if (!startInput || !endInput) return;

    let startTime = startInput.value;
    if (!startTime) {
        const now = new Date();
        startTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        startInput.value = startTime;
    }
    const [h, m] = startTime.split(':').map(Number);
    const startDate = new Date();
    startDate.setHours(h, m, 0, 0);
    const endDate = new Date(startDate.getTime() + (Number(minutes) || 45) * 60000);
    const endStr = `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`;
    endInput.value = endStr;
    if (label) {
        const jp = Math.round((Number(minutes) / 45) * 10) / 10;
        label.textContent = `${minutes} Menit (${jp} JP)`;
    }
};

window.updateCatatanDurationLabel = function () {
    const startInput = document.getElementById('catatan-jam-mulai');
    const endInput = document.getElementById('catatan-jam-selesai');
    const label = document.getElementById('catatan-durasi-label');
    if (!startInput || !endInput || !label) return;

    const startVal = startInput.value;
    const endVal = endInput.value;
    if (!startVal || !endVal) {
        label.textContent = '-';
        return;
    }
    const [h1, m1] = startVal.split(':').map(Number);
    const [h2, m2] = endVal.split(':').map(Number);
    let diff = (h2 * 60 + m2) - (h1 * 60 + m1);
    if (diff < 0) diff += 24 * 60; // Antisipasi pergantian hari
    const jp = Math.round((diff / 45) * 10) / 10;
    label.textContent = `${diff} Menit (${jp} JP)`;
};

window.handleCatatanPhotoSelect = function (files) {
    if (!files || files.length === 0) return;
    const remainingSlots = 3 - _catatanSelectedPhotos.length;
    if (remainingSlots <= 0) {
        showToast('Batas Foto', 'Maksimal 3 foto dokumentasi per sesi pembinaan.', 'warning');
        return;
    }

    const filesToProcess = Array.from(files).slice(0, remainingSlots);
    for (const file of filesToProcess) {
        try {
            const previewUrl = URL.createObjectURL(file);
            _catatanSelectedPhotos.push({
                file,
                previewUrl,
                name: file.name
            });
        } catch (e) {
            console.warn('[GuruWali] Gagal memuat foto:', e);
        }
    }
    renderCatatanPhotoGrid();
};

window.removeCatatanPhoto = function (index) {
    if (index >= 0 && index < _catatanSelectedPhotos.length) {
        const removed = _catatanSelectedPhotos.splice(index, 1)[0];
        if (removed && removed.previewUrl) {
            try { URL.revokeObjectURL(removed.previewUrl); } catch (_) {}
        }
    }
    renderCatatanPhotoGrid();
};

window.resetCatatanPhotos = function () {
    _catatanSelectedPhotos.forEach(p => {
        if (p.previewUrl) {
            try { URL.revokeObjectURL(p.previewUrl); } catch (_) {}
        }
    });
    _catatanSelectedPhotos = [];
    renderCatatanPhotoGrid();
};

function renderCatatanPhotoGrid() {
    const grid = document.getElementById('catatan-foto-grid');
    const countEl = document.getElementById('catatan-foto-count');
    if (countEl) countEl.textContent = `${_catatanSelectedPhotos.length}/3 Foto`;
    if (!grid) return;

    if (_catatanSelectedPhotos.length === 0) {
        grid.innerHTML = '<span class="text-[11px] text-slate-400 self-center">Belum ada foto dipilih (opsional).</span>';
        return;
    }

    grid.innerHTML = _catatanSelectedPhotos.map((p, idx) => `
        <div class="relative w-16 h-16 rounded-lg overflow-hidden border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 group shadow-sm">
            <img src="${p.previewUrl}" alt="Preview" class="w-full h-full object-cover">
            <button type="button" onclick="window.removeCatatanPhoto(${idx})" class="absolute top-0.5 right-0.5 w-5 h-5 bg-rose-600/90 text-white rounded-full flex items-center justify-center text-[10px] hover:bg-rose-700 transition" title="Hapus Foto">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
    `).join('');
}

window.openModalTambahCatatan = function () {
    selectedStudentsForNote = [];
    renderCatatanSiswaChips();
    window.hideCatatanSiswaDropdown();
    const input = document.getElementById('catatan-search-siswa');
    if (input) input.value = '';

    document.getElementById('catatan-kategori').value = 'akademik';
    document.getElementById('catatan-tanggal').value = window.getLocalISODate(new Date());
    document.getElementById('catatan-judul').value = '';
    document.getElementById('catatan-isi').value = '';

    // Smart default waktu (+45 menit dari waktu saat ini)
    const now = new Date();
    const startStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const startInput = document.getElementById('catatan-jam-mulai');
    if (startInput) startInput.value = startStr;
    window.applyCatatanQuickDuration(45);

    // Reset foto & checkbox sync e-kinerja
    window.resetCatatanPhotos();
    const chkSync = document.getElementById('catatan-sync-ekinerja');
    if (chkSync) chkSync.checked = true;

    document.getElementById('modal-tambah-catatan').classList.remove('hidden');
};

window.openModalTambahCatatanForStudent = function () {
    if (!currentDetailNIS) return;
    const student = myStudents.find(s => s.student_nis === currentDetailNIS);
    if (!student) return;

    selectedStudentsForNote = [student];
    renderCatatanSiswaChips();
    window.hideCatatanSiswaDropdown();
    const input = document.getElementById('catatan-search-siswa');
    if (input) input.value = '';

    document.getElementById('catatan-kategori').value = 'akademik';
    document.getElementById('catatan-tanggal').value = window.getLocalISODate(new Date());
    document.getElementById('catatan-judul').value = '';
    document.getElementById('catatan-isi').value = '';

    // Smart default waktu (+45 menit)
    const now = new Date();
    const startStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const startInput = document.getElementById('catatan-jam-mulai');
    if (startInput) startInput.value = startStr;
    window.applyCatatanQuickDuration(45);

    window.resetCatatanPhotos();
    const chkSync = document.getElementById('catatan-sync-ekinerja');
    if (chkSync) chkSync.checked = true;

    document.getElementById('modal-tambah-catatan').classList.remove('hidden');
};

// --- SUBMIT CATATAN PEMBINAAN GURU WALI ---
window.submitTambahCatatan = async function (replaceKbmConfirmed = false) {
    if (selectedStudentsForNote.length === 0) {
        showToast('Peringatan', 'Pilih minimal satu siswa binaan.', 'warning');
        return;
    }

    const kategori = document.getElementById('catatan-kategori').value;
    const tanggal = document.getElementById('catatan-tanggal').value;
    const judul = document.getElementById('catatan-judul').value.trim();
    const isi = document.getElementById('catatan-isi').value.trim();

    const startTime = (document.getElementById('catatan-jam-mulai')?.value || '08:00').trim();
    const endTime = (document.getElementById('catatan-jam-selesai')?.value || '08:45').trim();
    const syncEkinerja = document.getElementById('catatan-sync-ekinerja')?.checked !== false;

    if (!judul || !isi || !tanggal) {
        showToast('Peringatan', 'Judul, isi, dan tanggal pembinaan wajib diisi.', 'warning');
        return;
    }

    // Kalkulasi durasi
    const [h1, m1] = startTime.split(':').map(Number);
    const [h2, m2] = endTime.split(':').map(Number);
    let durationMinutes = (h2 * 60 + m2) - (h1 * 60 + m1);
    if (durationMinutes <= 0) durationMinutes += 24 * 60;
    if (durationMinutes < 5) {
        showToast('Peringatan', 'Durasi pembinaan minimal 5 menit. Periksa jam mulai dan selesai.', 'warning');
        return;
    }

    const btn = document.getElementById('btn-submit-tambah-catatan');
    const originalText = btn.innerHTML;
    btn.disabled = true;

    try {
        // 1. Pengunggahan Foto Bukti Dukung (jika ada foto yang dipilih)
        let evidenceUrl = '';
        if (_catatanSelectedPhotos.length > 0) {
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Mengunggah Foto...';
            const uploadedPhotos = [];
            const teacherName = currentUser.displayName || 'Guru Wali';
            const yearMonth = tanggal.slice(0, 7);

            for (let i = 0; i < _catatanSelectedPhotos.length; i++) {
                const photoObj = _catatanSelectedPhotos[i];
                const compressed = await compressImageToJpegBase64(photoObj.file, 800, 0.6, 80 * 1024);
                const safeFileName = `pembinaan_gw_${Date.now()}_${i + 1}.jpg`;
                const uploadRes = await uploadWorkloadPhotoToGoogleDrive(compressed.base64, safeFileName, {
                    teacherName,
                    yearMonth
                });
                uploadedPhotos.push({
                    url: uploadRes.url,
                    fileId: uploadRes.fileId,
                    name: `Dokumentasi Pembinaan ${i + 1}`,
                    caption: judul
                });
            }
            evidenceUrl = JSON.stringify(uploadedPhotos);
        }

        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Menyimpan...';

        const baseTimestamp = Date.now();
        const collectiveStudents = selectedStudentsForNote.map(s => s.student_name || s.student_nis);
        let sharedWorkLogId = null;

        // Loop penyimpanan catatan untuk setiap siswa (kolektif berbagi 1 work_log_id yang sama)
        for (let idx = 0; idx < selectedStudentsForNote.length; idx++) {
            const s = selectedStudentsForNote[idx];
            const timestamp = baseTimestamp + idx;
            const noteId = `${currentUser.uid}_${s.student_nis}_${timestamp}`;

            const notePayload = {
                id: noteId,
                guru_uid: currentUser.uid,
                guru_name: currentUser.displayName || 'Guru Wali',
                student_nis: s.student_nis,
                student_name: s.student_name || '',
                student_class: s.student_class || '',
                category: kategori,
                title: judul,
                notes: `${judul}\n${isi}`,
                date: tanggal,
                start_time: startTime,
                end_time: endTime,
                duration_minutes: durationMinutes,
                evidence_url: evidenceUrl,
                source_portal: 'guru_wali',
                sync_ekinerja: syncEkinerja,
                replace_kbm: replaceKbmConfirmed,
                work_log_id: sharedWorkLogId || undefined,
                collective_students: collectiveStudents
            };

            if (cfClient && cfClient.enabled) {
                const res = await cfClient.saveGuruWaliNote(notePayload);
                if (res?.sync_ekinerja?.log_id) {
                    sharedWorkLogId = res.sync_ekinerja.log_id;
                } else if (res?.data?.work_log_id) {
                    sharedWorkLogId = res.data.work_log_id;
                }
            }
        }

        if (typeof window.logAudit === 'function') {
            const studentNames = selectedStudentsForNote.map(s => s.student_name).join(', ');
            window.logAudit('CREATE_CATATAN_WALI', currentUser.uid, null, { kategori, judul, students: studentNames, syncEkinerja }, `Menambahkan catatan pembinaan guru wali: ${judul}`);
        }

        const successMsg = syncEkinerja
            ? 'Catatan pembinaan berhasil disimpan dan disinkronkan ke E-Kinerja Guru!'
            : 'Catatan pembinaan berhasil disimpan.';
        showToast('Berhasil', successMsg, 'success');

        window.resetCatatanPhotos();
        closeModal('modal-tambah-catatan');

        await refreshGridAndTableNotes();

        // Reload notes jika sedang membuka tab catatan atau detail modal
        if (!document.getElementById('view-catatan').classList.contains('hidden')) {
            loadCatatanPembinaan();
        }
        if (currentDetailNIS && selectedStudentsForNote.some(s => s.student_nis === currentDetailNIS)) {
            loadDetailPembinaanList(currentDetailNIS);
        }

    } catch (e) {
        console.error('Error tambah catatan guru wali:', e);

        // Deteksi Bentrok Jadwal KBM di E-Kinerja
        if (e.conflict_kbm || e.payload?.conflict_kbm) {
            const kbmInfo = e.kbm || e.payload?.kbm || {};
            const kbmDesc = kbmInfo.class
                ? `${kbmInfo.class} - ${kbmInfo.subject || 'KBM'} (${kbmInfo.start_time || ''} - ${kbmInfo.end_time || ''})`
                : 'jadwal KBM reguler';

            const swalFn = (typeof Swal !== 'undefined' && Swal.fire) ? Swal.fire : null;
            if (swalFn) {
                const result = await swalFn({
                    title: 'Bentrok Jadwal KBM',
                    html: `Waktu pembinaan ini (${startTime} - ${endTime}) bertepatan dengan <b>${window.escapeHTML(kbmDesc)}</b> di E-Kinerja.<br><br>Apakah Anda ingin <b>mengganti sesi KBM tersebut</b> dengan pembinaan siswa ini di E-Kinerja?`,
                    icon: 'question',
                    showCancelButton: true,
                    confirmButtonText: '<i class="fa-solid fa-arrows-rotate mr-1"></i> Ya, Ganti Jam KBM',
                    cancelButtonText: 'Batal / Sesuaikan Jam',
                    confirmButtonColor: '#4f46e5',
                    cancelButtonColor: '#64748b'
                });

                if (result.isConfirmed) {
                    // Panggil ulang dengan persetujuan substitusi KBM
                    return await window.submitTambahCatatan(true);
                } else {
                    return; // Biarkan form terbuka agar guru bisa mengubah jam pembinaan
                }
            } else {
                const ok = confirm(`Waktu pembinaan ini bertepatan dengan jadwal KBM: ${kbmDesc}.\n\nApakah Anda ingin mengganti sesi KBM tersebut dengan pembinaan ini di E-Kinerja?`);
                if (ok) {
                    return await window.submitTambahCatatan(true);
                } else {
                    return;
                }
            }
        }

        showToast('Gagal', e.message || 'Gagal menyimpan catatan pembinaan. Coba lagi.', 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

// --- LOAD CATATAN PEMBINAAN (Tab Catatan) ---
async function loadCatatanPembinaan() {
    const container = document.getElementById('catatan-timeline');
    container.innerHTML = `<div class="text-center py-12 text-slate-400">
        <i class="fa-solid fa-spinner fa-spin text-4xl mb-3"></i>
        <p>Memuat catatan pembinaan...</p>
    </div>`;

    try {
        const filterNIS = document.getElementById('filter-siswa-catatan').value;
        const filterKategori = document.getElementById('filter-kategori').value;

        let notes = [];
        if (cfClient && cfClient.enabled) {
            notes = await cfClient.getGuruWaliNotes({
                guru_uid: currentUser.uid,
                student_nis: filterNIS || undefined,
                category: filterKategori || undefined,
                limit: 100
            });
        }

        // Client-side filter
        if (filterNIS) {
            notes = notes.filter(n => String(n.student_nis).trim() === String(filterNIS).trim());
        }
        if (filterKategori) {
            notes = notes.filter(n => (n.category || '').toLowerCase().trim() === filterKategori.toLowerCase().trim());
        }

        if (notes.length === 0) {
            container.innerHTML = `<div class="text-center py-12 text-slate-400">
                <i class="fa-solid fa-clipboard text-4xl mb-3"></i>
                <p>Belum ada catatan pembinaan.</p>
            </div>`;
            return;
        }

        container.innerHTML = notes.map(n => {
            const student = myStudents.find(s => String(s.student_nis).trim() === String(n.student_nis).trim());
            const studentName = student ? student.student_name : n.student_nis;
            const dateStr = formatNoteDate(n.date || n.tanggal || n.created_at) || '-';
            const categoryBadge = getCategoryBadge(n.category);
            const timeBadge = (n.start_time && n.end_time)
                ? `<span class="text-xs bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/50 px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1"><i class="fa-solid fa-clock text-[10px]"></i> ${window.escapeHTML(n.start_time)} - ${window.escapeHTML(n.end_time)}</span>`
                : '';
            const rawNotes = n.notes || n.content || '';
            const lines = rawNotes.split('\n');
            const title = n.title || n.judul || lines[0] || 'Catatan Pembinaan';
            const content = n.content || (lines.length > 1 ? lines.slice(1).join('\n') : rawNotes);

            const evidencePhotos = parseEvidencePhotos(n.evidence_url);
            const photoThumbnailsHtml = evidencePhotos.length > 0 ? `
                <div class="flex flex-wrap items-center gap-2 mt-2.5 pt-2 border-t border-slate-200/60 dark:border-slate-600/60">
                    <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block w-full"><i class="fa-solid fa-camera mr-1"></i>Dokumentasi:</span>
                    ${evidencePhotos.map(p => {
                        const thumb = getGoogleDriveThumbnail(p.url) || p.url;
                        return `
                            <a href="${window.escapeHTML(p.url)}" target="_blank" rel="noopener noreferrer" class="group relative w-12 h-12 rounded-lg overflow-hidden border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 shadow-sm block hover:ring-2 hover:ring-indigo-400 transition" title="${window.escapeHTML(p.name || 'Dokumentasi')}">
                                <img src="${window.escapeHTML(thumb)}" alt="Foto" class="w-full h-full object-cover group-hover:scale-110 transition duration-200" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22 fill=%22%2394a3b8%22 viewBox=%220 0 24 24%22><path d=%22M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z%22/></svg>'">
                            </a>
                        `;
                    }).join('')}
                </div>
            ` : '';

            return `
            <div class="bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-lg p-4 hover:border-blue-300 dark:hover:border-blue-500 transition-all">
                <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div class="flex flex-wrap items-center gap-2">
                        ${categoryBadge}
                        ${timeBadge}
                        <span class="text-xs text-slate-500 dark:text-slate-400">${window.escapeHTML(dateStr)}</span>
                        <span class="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full font-semibold">${window.escapeHTML(studentName)}</span>
                    </div>
                    <div class="flex items-center gap-1">
                        <button onclick="window.openEditCatatan('${window.escapeHTML(n.id)}')" class="w-8 h-8 flex items-center justify-center text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 rounded-xl transition-all active:scale-90" title="Edit">
                            <i class="fa-solid fa-pen"></i>
                        </button>
                        <button onclick="window.confirmHapusCatatan('${window.escapeHTML(n.id)}', '${window.escapeHTML(title).replace(/'/g, "\\'")}')" class="w-8 h-8 flex items-center justify-center text-xs text-red-500 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-xl transition-all active:scale-90" title="Hapus">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>
                <p class="font-bold text-slate-800 dark:text-white mb-1">${window.escapeHTML(title)}</p>
                <p class="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-line">${window.escapeHTML(content)}</p>
                ${photoThumbnailsHtml}
            </div>
            `;
        }).join('');

    } catch (e) {
        console.error('Error load catatan:', e);
        container.innerHTML = `<div class="text-center py-12 text-red-400">
            <i class="fa-solid fa-triangle-exclamation text-4xl mb-3"></i>
            <p>Gagal memuat catatan.</p>
        </div>`;
    }
}

function getCategoryBadge(category) {
    const key = (category || 'akademik').toLowerCase().trim();
    const badges = {
        'akademik': '<span class="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded-full font-bold"><i class="fa-solid fa-graduation-cap mr-1"></i>Akademik</span>',
        'kompetensi': '<span class="text-xs bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full font-bold"><i class="fa-solid fa-award mr-1"></i>Kompetensi</span>',
        'keterampilan': '<span class="text-xs bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400 px-2 py-0.5 rounded-full font-bold"><i class="fa-solid fa-tools mr-1"></i>Keterampilan</span>',
        'karakter': '<span class="text-xs bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400 px-2 py-0.5 rounded-full font-bold"><i class="fa-solid fa-heart mr-1"></i>Karakter</span>'
    };
    return badges[key] || `<span class="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded-full font-bold"><i class="fa-solid fa-graduation-cap mr-1"></i>Akademik</span>`;
}

// --- DETAIL SISWA ---
window.openDetailSiswa = async function (nis) {
    currentDetailNIS = nis;
    const student = myStudents.find(s => String(s.student_nis).trim() === String(nis).trim());
    if (!student) return;

    // Set Basic Info
    const initial = student.student_name.charAt(0).toUpperCase();
    const avatarEl = document.getElementById('detail-avatar');
    if (avatarEl) {
        const rawPhoto = student.activePhotoUrl || student.active_photo_url || student.photoUrl || student.foto || '';
        const resolvedPhoto = (typeof window.resolvePhotoUrl === 'function' && rawPhoto) ? window.resolvePhotoUrl(rawPhoto) : rawPhoto;
        if (resolvedPhoto && /^(https?:|\/|data:image\/)/i.test(resolvedPhoto)) {
            avatarEl.innerHTML = `<img src="${window.escapeHTML(resolvedPhoto)}" alt="${window.escapeHTML(student.student_name)}" class="w-full h-full object-cover rounded-full" onerror="this.parentElement.innerText='${initial}';" />`;
        } else {
            avatarEl.innerText = initial;
        }
    }
    document.getElementById('detail-nama').innerText = student.student_name;
    document.getElementById('detail-kelas-nis').innerText = `${student.student_class} • NIS: ${student.student_nis}`;

    // Reset tabs
    document.querySelectorAll('.detail-tab').forEach(b => {
        b.classList.remove('active', 'border-blue-600', 'text-blue-600');
        b.classList.add('border-transparent', 'text-slate-500');
    });
    const profilTab = document.querySelector('.detail-tab[data-tab="profil"]');
    profilTab.classList.remove('border-transparent', 'text-slate-500'); // tab aktif menggantikan gaya non-aktif (urutan CSS Tailwind build)
    profilTab.classList.add('active', 'border-blue-600', 'text-blue-600');
    document.querySelectorAll('.detail-content').forEach(c => c.classList.add('hidden'));
    document.getElementById('detail-content-profil').classList.remove('hidden');

    // Open modal
    document.getElementById('modal-detail-siswa').classList.remove('hidden');

    // Load profil data
    await loadDetailProfil(nis);
};

async function loadDetailProfil(nis) {
    try {
        // === SESSION CACHE: Profil Siswa ===
        const cacheKey = `session_profil_${nis}`;
        let data = getSessionCache(cacheKey);

        if (!data) {
            // Prioritaskan dari master cache IndexedDB (0 Read)
            if (typeof window.getStudentsCache === 'function') {
                try {
                    const allStudents = await window.getStudentsCache();
                    const found = allStudents.find(s => String(s.nis || s.id) === String(nis));
                    if (found) {
                        data = found;
                        setSessionCache(cacheKey, data);
                        console.log(`[Guru Wali] Profil siswa ${nis} dimuat dari IndexedDB (0 Read)`);
                    }
                } catch (e) {}
            }

            if (!data) {
                try {
                    if (cfClient && cfClient.enabled) {
                        const cfStudent = await cfClient.getStudentByNis(nis);
                        if (cfStudent) {
                            data = cfStudent;
                            setSessionCache(cacheKey, data);
                            console.log(`[Guru Wali] Profil siswa ${nis} dimuat dari Cloudflare D1 (0 Read)`);
                        }
                    }
                } catch (cfErr) {
                    console.warn('[Guru Wali] Gagal memuat siswa dari Cloudflare D1:', cfErr);
                }
            }
        } else {
            console.log(`[Guru Wali] Menggunakan session cache profil siswa ${nis}`);
        }

        if (data) {
            const studentPhoto = data.activePhotoUrl || data.active_photo_url || data.photoUrl || data.foto || '';
            const avatarEl = document.getElementById('detail-avatar');
            if (avatarEl && studentPhoto) {
                const resolvedPhoto = (typeof window.resolvePhotoUrl === 'function') ? window.resolvePhotoUrl(studentPhoto) : studentPhoto;
                if (resolvedPhoto && /^(https?:|\/|data:image\/)/i.test(resolvedPhoto)) {
                    const initial = (data.name || data.student_name || '?').charAt(0).toUpperCase();
                    avatarEl.innerHTML = `<img src="${window.escapeHTML(resolvedPhoto)}" alt="${window.escapeHTML(data.name || data.student_name || '')}" class="w-full h-full object-cover rounded-full" onerror="this.parentElement.innerText='${initial}';" />`;
                }
            }

            const setText = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.innerText = (val !== undefined && val !== null && String(val).trim() !== '') ? val : '-';
            };

            // 1. Identitas Siswa & Dokumen Pribadi
            setText('profil-nis', `${data.nis || '-'} / ${data.nisn || '-'}`);
            setText('profil-kelas', data.class || '-');
            setText('profil-gender', data.gender === 'L' ? 'Laki-laki' : data.gender === 'P' ? 'Perempuan' : (data.gender || '-'));
            setText('profil-agama', data.religion || data.agama);
            setText('profil-ttl', `${data.birthPlace || data.pob || data.tempatLahir || '-'}, ${data.birthDate || data.dob || data.tanggalLahir || '-'}`);
            setText('profil-nik', data.nik);
            setText('profil-kk', data.kk_no || data.no_kk);
            setText('profil-anak-ke', data.child_order || data.anakKe);
            setText('profil-jml-saudara', data.jml_saudara_kandung || data.jml_saudara);
            setText('profil-akta', data.akta_lahir_reg || data.no_akta);
            setText('profil-sekolah-asal', data.sekolah_asal);

            // 2. Kontak Siswa & Domisili
            setText('profil-hp-siswa', data.phone_siswa || data.phone || data.hpSiswa);
            setText('profil-email', data.email_siswa || data.email);
            setText('profil-jenis-tinggal', data.living_type || data.jenis_tinggal);
            setText('profil-transportasi', data.transportation || data.alat_transportasi);
            setText('profil-alamat', data.address || data.alamat);
            setText('profil-dusun', data.dusun);
            setText('profil-kelurahan', data.kelurahan);
            setText('profil-kecamatan', data.kecamatan);
            setText('profil-kode-pos', data.postal_code || data.kode_pos);
            setText('profil-jarak', data.jarak_sekolah_km ? `${data.jarak_sekolah_km} KM` : '-');

            // 3. Data Ayah, Ibu & Wali
            setText('profil-ayah-nama', data.father || data.namaAyah || data.father_name);
            setText('profil-ayah-nik', data.father_nik || data.nik_ayah);
            setText('profil-ayah-tahun', data.father_birth_year || data.tahun_lahir_ayah);
            setText('profil-ayah-pendidikan', data.father_education || data.pendidikan_ayah);
            setText('profil-ayah-pekerjaan', data.father_job || data.pekerjaan_ayah);
            setText('profil-ayah-penghasilan', data.father_income || data.penghasilan_ayah);
            setText('profil-ayah-hp', data.father_phone || data.phone_parent || data.parentPhone || data.hpOrtu);

            setText('profil-ibu-nama', data.mother || data.name_parent || data.parentName || data.namaIbu || data.mother_name);
            setText('profil-ibu-nik', data.mother_nik || data.nik_ibu);
            setText('profil-ibu-tahun', data.mother_birth_year || data.tahun_lahir_ibu);
            setText('profil-ibu-pendidikan', data.mother_education || data.pendidikan_ibu);
            setText('profil-ibu-pekerjaan', data.mother_job || data.pekerjaan_ibu);
            setText('profil-ibu-penghasilan', data.mother_income || data.penghasilan_ibu);
            setText('profil-ibu-hp', data.phone_parent || data.mother_phone || data.parentPhone || data.hpOrtu);

            setText('profil-wali-nama', data.guardian_name || data.nama_wali);
            setText('profil-wali-nik', data.guardian_nik || data.nik_wali);
            setText('profil-wali-tahun', data.guardian_birth_year || data.tahun_lahir_wali);
            setText('profil-wali-pendidikan', data.guardian_education || data.pendidikan_wali);
            setText('profil-wali-pekerjaan', data.guardian_job || data.pekerjaan_wali);
            setText('profil-wali-penghasilan', data.guardian_income || data.penghasilan_wali);
            setText('profil-wali-hp', data.guardian_phone || data.phone_wali);

            // 4. Data Fisik & Catatan
            setText('profil-bb', data.weight || data.berat_badan ? `${data.weight || data.berat_badan} kg` : '-');
            setText('profil-tb', data.height || data.tinggi_badan ? `${data.height || data.tinggi_badan} cm` : '-');
            setText('profil-lk', data.head_circumference || data.lingkar_kepala ? `${data.head_circumference || data.lingkar_kepala} cm` : '-');
            setText('profil-note', data.note || 'Tidak ada catatan.');
        }
    } catch (e) {
        console.error('Error load profil:', e);
    }
}

// --- LOAD DETAIL TAB CONTENT ---
window.loadDetailTabContent = async function (tab) {
    if (!currentDetailNIS) return;

    switch (tab) {
        case 'pembinaan':
            await loadDetailPembinaanList(currentDetailNIS);
            break;
        case 'presensi':
            await loadDetailPresensi(currentDetailNIS);
            break;
        case 'perilaku':
            await loadDetailPerilaku(currentDetailNIS);
            break;
        case 'spp':
            await loadDetailSPP(currentDetailNIS);
            break;
        case 'bk':
            await loadDetailBK(currentDetailNIS);
            break;
    }
};

async function loadDetailPembinaanList(nis) {
    const container = document.getElementById('detail-pembinaan-list');
    container.innerHTML = '<p class="text-center text-slate-400 py-8">Memuat catatan...</p>';

    try {
        let notes = [];
        if (cfClient && cfClient.enabled) {
            notes = await cfClient.getGuruWaliNotes({
                student_nis: nis,
                limit: 100
            });
        }

        if (!notes || notes.length === 0) {
            container.innerHTML = '<p class="text-center text-slate-400 py-8">Belum ada catatan untuk siswa ini.</p>';
            return;
        }

        let html = '';
        notes.forEach(n => {
            const noteId = n.id;
            const dateStr = formatNoteDate(n.date || n.tanggal || n.created_at) || '-';
            const categoryBadge = getCategoryBadge(n.category);
            const timeBadge = (n.start_time && n.end_time)
                ? `<span class="text-xs bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/50 px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1"><i class="fa-solid fa-clock text-[10px]"></i> ${window.escapeHTML(n.start_time)} - ${window.escapeHTML(n.end_time)}</span>`
                : '';
            const title = n.title || n.judul || n.notes?.split('\n')[0] || 'Catatan Pembinaan';
            const content = n.notes || n.content || '';

            const evidencePhotos = parseEvidencePhotos(n.evidence_url);
            const photoThumbnailsHtml = evidencePhotos.length > 0 ? `
                <div class="flex flex-wrap items-center gap-2 mt-2.5 pt-2 border-t border-slate-200/60 dark:border-slate-600/60">
                    <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block w-full"><i class="fa-solid fa-camera mr-1"></i>Dokumentasi:</span>
                    ${evidencePhotos.map(p => {
                        const thumb = getGoogleDriveThumbnail(p.url) || p.url;
                        return `
                            <a href="${window.escapeHTML(p.url)}" target="_blank" rel="noopener noreferrer" class="group relative w-12 h-12 rounded-lg overflow-hidden border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 shadow-sm block hover:ring-2 hover:ring-indigo-400 transition" title="${window.escapeHTML(p.name || 'Dokumentasi')}">
                                <img src="${window.escapeHTML(thumb)}" alt="Foto" class="w-full h-full object-cover group-hover:scale-110 transition duration-200" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22 fill=%22%2394a3b8%22 viewBox=%220 0 24 24%22><path d=%22M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z%22/></svg>'">
                            </a>
                        `;
                    }).join('')}
                </div>
            ` : '';

            html += `
            <div class="bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-lg p-4">
                <div class="flex items-center justify-between gap-2 mb-2">
                    <div class="flex flex-wrap items-center gap-2">
                        ${categoryBadge}
                        ${timeBadge}
                        <span class="text-xs text-slate-500 dark:text-slate-400">${window.escapeHTML(dateStr)}</span>
                    </div>
                    <div class="flex items-center gap-1">
                        <button onclick="window.openEditCatatan('${window.escapeHTML(noteId)}')" class="w-8 h-8 flex items-center justify-center text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 rounded-xl transition-all active:scale-90" title="Edit">
                            <i class="fa-solid fa-pen"></i>
                        </button>
                        <button onclick="window.confirmHapusCatatan('${window.escapeHTML(noteId)}', '${window.escapeHTML(title).replace(/'/g, "\\'")}')" class="w-8 h-8 flex items-center justify-center text-xs text-red-500 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-xl transition-all active:scale-90" title="Hapus">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>
                <p class="font-bold text-slate-800 dark:text-white mb-1">${window.escapeHTML(title)}</p>
                <p class="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-line">${window.escapeHTML(content)}</p>
                ${photoThumbnailsHtml}
            </div>
            `;
        });

        container.innerHTML = html;

    } catch (e) {
        console.error('Error load pembinaan:', e);
        container.innerHTML = '<p class="text-center text-red-400 py-8">Gagal memuat catatan.</p>';
    }
}

async function loadDetailPresensi(nis) {
    const container = document.getElementById('detail-presensi-content');
    container.innerHTML = '<p class="text-center text-slate-400 py-8"><i class="fa-solid fa-spinner fa-spin mr-1"></i>Memuat data presensi...</p>';

    try {
        currentDetailNIS = nis;

        // Cari kelas siswa dari myStudents cache
        const student = myStudents.find(s => String(s.student_nis).trim() === String(nis).trim());
        let targetClass = student ? student.student_class : null;

        if (!targetClass) {
            // Prioritaskan dari master cache IndexedDB (0 Read)
            if (typeof window.getStudentsCache === 'function') {
                try {
                    const allStudents = await window.getStudentsCache();
                    const found = allStudents.find(s => String(s.nis || s.id) === String(nis));
                    if (found && found.class) targetClass = found.class;
                } catch (e) {}
            }

            if (!targetClass) {
                try {
                    if (cfClient && cfClient.enabled) {
                        const cfStudent = await cfClient.getStudentByNis(nis);
                        if (cfStudent && cfStudent.class) targetClass = cfStudent.class;
                    }
                } catch (cfErr) {
                    console.warn('[Guru Wali] Gagal memuat siswa dari Cloudflare D1:', cfErr);
                }
            }
        }

        if (!targetClass) {
            throw new Error("Kelas siswa tidak ditemukan");
        }

        // === LIVE ATTENDANCE: Query murni dari Supabase SSOT (Retensi 3 Tahun) ===
        const cacheKeyAtt = `session_att_guruwali_${nis}`;
        let rawAttendance = getSessionCache(cacheKeyAtt);

        if (!rawAttendance) {
            rawAttendance = [];
            try {
                const { rows: attRows } = await window.fetchStudentAttendanceRange(nis, null, null);
                if (Array.isArray(attRows)) {
                    rawAttendance = attRows.map(r => ({
                        date: r.date,
                        status: r.status,
                        note: r.note || '',
                        hasLetter: !!r.hasLetter,
                        className: r.className || targetClass
                    }));
                }
            } catch (eAtt) {
                console.warn('[Guru Wali] Supabase attendance notice:', eAtt);
            }

            setSessionCache(cacheKeyAtt, rawAttendance);
            console.log(`[Guru Wali] Presensi siswa ${nis} di-cache (${rawAttendance.length} record dari Supabase)`);
        } else {
            console.log(`[Guru Wali] Menggunakan session cache presensi siswa ${nis}`);
        }

        currentDetailRawAttendance = rawAttendance;

        // Inisialisasi Filter dropdown sesuai jenjang kelas siswa (X, XI, XII)
        populateDetailPresensiFilter(targetClass);

        // Render awal dengan pilihan filter aktif (bulan saat ini atau 'all')
        window.filterDetailPresensi();

    } catch (e) {
        console.error('Error load presensi:', e);
        container.innerHTML = '<p class="text-center text-red-400 py-8">Gagal memuat data presensi.</p>';
        loadDetailAbsensi(nis, []);
        loadDetailPermisi(nis);
    }
}

// --- POPULATE FILTER BULAN & TAHUN AJARAN (SESUAI TINGKAT KELAS X, XI, XII) ---
function populateDetailPresensiFilter(className) {
    const select = document.getElementById('detail-presensi-filter-month');
    if (!select) return;

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const curStartYear = (currentMonth >= 6) ? currentYear : currentYear - 1;

    // Tentukan tingkat kelas & batas tahun ajaran lampau
    const cls = String(className || '').toUpperCase().trim();
    let gradeLabel = 'Kelas XII';
    let maxPastYears = 2; // Default XII / Alumni (3 TA: aktif + 2 lampau)

    if (cls.startsWith('X-') || cls.startsWith('X ') || cls === 'X') {
        gradeLabel = 'Kelas X';
        maxPastYears = 0; // Hanya TA Aktif (1 TA)
    } else if (cls.startsWith('XI-') || cls.startsWith('XI ') || cls === 'XI') {
        gradeLabel = 'Kelas XI';
        maxPastYears = 1; // TA Aktif (Kelas XI) + 1 TA lampau (Kelas X)
    } else if (cls.startsWith('XII-') || cls.startsWith('XII ') || cls === 'XII') {
        gradeLabel = 'Kelas XII';
        maxPastYears = 2; // TA Aktif (Kelas XII) + 2 TA lampau (Kelas XI & X)
    }

    let html = '';
    let addedMonths = 0;

    // 1. Opsi Bulan & Semester Tahun Ajaran Berjalan
    html += `<optgroup label="Tahun Ajaran Aktif (${curStartYear}/${curStartYear + 1} - ${gradeLabel})">`;
    html += `<option value="ta:${curStartYear}/${curStartYear + 1}">📌 Seluruh TA ${curStartYear}/${curStartYear + 1} (${gradeLabel})</option>`;
    html += `<option value="sem:ODD:${curStartYear}/${curStartYear + 1}">🗓️ Semester Ganjil (Smt 1 - ${gradeLabel})</option>`;
    html += `<option value="sem:EVEN:${curStartYear}/${curStartYear + 1}">🗓️ Semester Genap (Smt 2 - ${gradeLabel})</option>`;
    
    let month = currentMonth;
    let year = currentYear;
    while (true) {
        const monthDate = new Date(year, month, 1);
        const monthStr = String(month + 1).padStart(2, '0');
        const value = `${year}-${monthStr}`;
        const label = monthDate.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
        
        const selected = addedMonths === 0 ? 'selected' : '';
        html += `<option value="${value}" ${selected}>• ${label}</option>`;
        addedMonths++;

        if (year === curStartYear && month === 6) break;

        month--;
        if (month < 0) {
            month = 11;
            year--;
        }
    }
    html += `</optgroup>`;

    // 2. Opsi Tahun Ajaran & Semester Sebelumnya (Hanya jika siswa sudah menempuh kelas sebelumnya)
    for (let offset = 1; offset <= maxPastYears; offset++) {
        const prevStartYear = curStartYear - offset;
        const prevEndYear = prevStartYear + 1;
        const taLabel = `${prevStartYear}/${prevEndYear}`;
        
        // Label kelas lampau: jika sekarang kelas XI, offset 1 adalah kelas X
        // jika sekarang kelas XII, offset 1 adalah kelas XI, offset 2 adalah kelas X
        const pastGradeLabel = (maxPastYears === 1) 
            ? 'Kelas X' 
            : (offset === 1 ? 'Kelas XI' : 'Kelas X');
        
        html += `<optgroup label="Tahun Ajaran ${taLabel} (${pastGradeLabel})">`;
        html += `<option value="ta:${taLabel}">📁 Seluruh TA ${taLabel} (${pastGradeLabel})</option>`;
        html += `<option value="sem:ODD:${taLabel}">🗓️ Semester Ganjil (Smt 1 - ${pastGradeLabel})</option>`;
        html += `<option value="sem:EVEN:${taLabel}">🗓️ Semester Genap (Smt 2 - ${pastGradeLabel})</option>`;
        
        // Tambahkan bulan-bulan TA tersebut (Juli - Juni)
        for (let mIdx = 11; mIdx >= 0; mIdx--) {
            const m = (mIdx >= 6) ? mIdx : mIdx;
            const y = (mIdx >= 6) ? prevStartYear : prevEndYear;
            const mStr = String(m + 1).padStart(2, '0');
            const mDate = new Date(y, m, 1);
            const mLabel = mDate.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' });
            html += `<option value="${y}-${mStr}">• ${mLabel} (${pastGradeLabel})</option>`;
        }
        html += `</optgroup>`;
    }

    // 3. Opsi Semua Riwayat (Disesuaikan dengan rentang studi yang telah dijalani)
    const allHistoryLabel = maxPastYears === 0 
        ? 'Seluruh Riwayat (Kelas X)' 
        : (maxPastYears === 1 ? 'Seluruh Riwayat Studi (Kelas X - XI)' : 'Seluruh Riwayat Studi (Kelas X - XII)');
    html += `<optgroup label="Ringkasan Total">`;
    html += `<option value="all">🌐 ${allHistoryLabel}</option>`;
    html += `</optgroup>`;

    select.innerHTML = html;
}

// --- FILTER & RENDER DETAIL PRESENSI (100% CLIENT SIDE DARI SUPABASE CACHE) ---
window.filterDetailPresensi = function () {
    const select = document.getElementById('detail-presensi-filter-month');
    if (!select) return;

    const filterVal = select.value;
    const container = document.getElementById('detail-presensi-content');

    const agg = { sakit: 0, izin: 0, alpha: 0, dispen: 0 };
    let filteredAttendance = [];
    let filterLabelText = '';

    if (filterVal === 'all') {
        filteredAttendance = currentDetailRawAttendance || [];
        filterLabelText = `Menampilkan Seluruh Riwayat Studi`;
    } else if (filterVal.startsWith('sem:')) {
        const [, semType, taLabel] = filterVal.split(':');
        const [startYStr, endYStr] = taLabel.split('/');
        const startY = parseInt(startYStr);
        const endY = parseInt(endYStr);
        let minDate, maxDate, semName;

        if (semType === 'ODD') {
            minDate = `${startY}-07-01`;
            maxDate = `${startY}-12-31`;
            semName = 'Semester Ganjil (Smt 1)';
        } else {
            minDate = `${endY}-01-01`;
            maxDate = `${endY}-06-30`;
            semName = 'Semester Genap (Smt 2)';
        }

        filteredAttendance = (currentDetailRawAttendance || []).filter(a => a.date >= minDate && a.date <= maxDate);
        filterLabelText = `Menampilkan Data ${semName} - TA ${taLabel}`;
    } else if (filterVal.startsWith('ta:')) {
        const taLabel = filterVal.replace('ta:', '');
        const [startYStr, endYStr] = taLabel.split('/');
        const startY = parseInt(startYStr);
        const endY = parseInt(endYStr);
        const minDate = `${startY}-07-01`;
        const maxDate = `${endY}-06-30`;

        filteredAttendance = (currentDetailRawAttendance || []).filter(a => a.date >= minDate && a.date <= maxDate);
        filterLabelText = `Menampilkan Data Tahun Ajaran ${taLabel}`;
    } else {
        filteredAttendance = (currentDetailRawAttendance || []).filter(a => a.date && a.date.startsWith(filterVal));
        const [y, m] = filterVal.split('-');
        const monthDate = new Date(Number(y), Number(m) - 1, 1);
        const monthName = monthDate.toLocaleDateString('id-ID', { month: 'long' });
        const taStr = window.getCurrentAcademicYearString 
            ? window.getCurrentAcademicYearString(monthDate)
            : ((Number(m) >= 7) ? `${y}/${Number(y) + 1}` : `${Number(y) - 1}/${y}`);
        filterLabelText = `Menampilkan data bulan ${monthName} ${y} (Tahun Ajaran ${taStr})`;
    }

    filteredAttendance.forEach(a => {
        if (a.status === 'S') agg.sakit++;
        else if (a.status === 'I') agg.izin++;
        else if (a.status === 'A') agg.alpha++;
        else if (a.status === 'D') agg.dispen++;
    });

    container.innerHTML = `
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div class="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-900/50 rounded-lg p-4 text-center">
            <p class="text-2xl font-bold text-yellow-600 dark:text-yellow-400">${agg.sakit}</p>
            <p class="text-xs text-yellow-700 dark:text-yellow-500 font-bold">SAKIT</p>
        </div>
        <div class="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900/50 rounded-lg p-4 text-center">
            <p class="text-2xl font-bold text-blue-600 dark:text-blue-400">${agg.izin}</p>
            <p class="text-xs text-blue-700 dark:text-blue-500 font-bold">IZIN</p>
        </div>
        <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg p-4 text-center">
            <p class="text-2xl font-bold text-red-600 dark:text-red-400">${agg.alpha}</p>
            <p class="text-xs text-red-700 dark:text-red-500 font-bold">ALPHA</p>
        </div>
        <div class="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-900/50 rounded-lg p-4 text-center">
            <p class="text-2xl font-bold text-purple-600 dark:text-purple-400">${agg.dispen}</p>
            <p class="text-xs text-purple-700 dark:text-purple-500 font-bold">DISPENSASI</p>
        </div>
    </div>
    <p class="text-xs text-slate-500 dark:text-slate-400 text-center font-bold bg-slate-100 dark:bg-slate-800 py-1.5 rounded">${filterLabelText}</p>
    `;

    loadDetailAbsensi(currentDetailNIS, filteredAttendance);
    loadDetailPermisi(currentDetailNIS, filterVal);
};

// Load Riwayat Permisi Komprehensif dari Cloudflare D1 (0 Firestore Read)
async function loadDetailPermisi(nis, filterVal = 'all') {
    const container = document.getElementById('detail-permisi-list');
    if (!container) return;

    try {
        container.innerHTML = `
            <div class="text-center py-4 text-slate-400 text-xs">
                <i class="fa-solid fa-spinner fa-spin mr-1"></i>Memuat riwayat permisi...
            </div>
        `;

        const nisStr = String(nis).trim();

        // 1. Fetch paralel permisi_requests & records (category: 'Permisi')
        const [permisiRes, recordsRes] = await Promise.allSettled([
            cfClient && cfClient.enabled ? cfClient.getPermisiRequests({ student_nis: nisStr, limit: 100 }) : Promise.resolve([]),
            cfClient && cfClient.enabled ? cfClient.getRecords({ nis: nisStr, category: 'Permisi', limit: 100 }) : Promise.resolve([])
        ]);

        const rawRequests = (permisiRes.status === 'fulfilled' && Array.isArray(permisiRes.value)) ? permisiRes.value : [];
        const rawRecords = (recordsRes.status === 'fulfilled' && Array.isArray(recordsRes.value)) ? recordsRes.value : [];

        // 2. Satukan data secara deduplikasi
        const combinedList = [];
        const seenKeys = new Set();

        // A. Dari permisi_requests (Alur Surat Izin Siswa Online)
        rawRequests.forEach(r => {
            const reqId = String(r.id || `${r.date}_${r.time_out}`);
            seenKeys.add(`permisi_${reqId}`);
            seenKeys.add(reqId);

            let dateObj = (typeof window.parseUniversalDate === 'function')
                ? window.parseUniversalDate(r.date || r.created_at)
                : (r.date ? new Date(r.date) : null);
            
            let itemDateStr = '';
            let dateDisplay = '-';
            if (dateObj && !isNaN(dateObj.getTime())) {
                const year = dateObj.getFullYear();
                const month = String(dateObj.getMonth() + 1).padStart(2, '0');
                itemDateStr = `${year}-${month}`;
                dateDisplay = dateObj.toLocaleDateString('id-ID', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric'
                });
            } else if (r.date) {
                itemDateStr = String(r.date).slice(0, 7);
                dateDisplay = r.date;
            }

            const st = String(r.status || '').toLowerCase();
            let statusBadge = {
                text: 'Disetujui Piket/BK',
                badgeClass: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
            };
            if (st === 'wali_approved') {
                statusBadge = {
                    text: 'Disetujui Wali',
                    badgeClass: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                };
            } else if (st === 'rejected') {
                statusBadge = {
                    text: 'Ditolak',
                    badgeClass: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300'
                };
            } else if (['pending', 'pending_wali', 'waiting'].includes(st)) {
                statusBadge = {
                    text: 'Menunggu',
                    badgeClass: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                };
            }

            const timeRange = [r.time_out, r.time_in].filter(Boolean).join(' - ');

            combinedList.push({
                id: reqId,
                dateDisplay,
                itemDateStr,
                timestamp: dateObj ? dateObj.getTime() : 0,
                time: timeRange,
                type: r.permission_type || 'Permisi Keluar',
                reason: r.reason || 'Izin meninggalkan kelas',
                statusBadge,
                approver: r.piket_approved_by || r.wali_approved_by || ''
            });
        });

        // B. Dari records (Catatan Kedisiplinan Kategori Permisi)
        rawRecords.forEach(rec => {
            const recId = String(rec.id || '');
            if (seenKeys.has(recId)) return; // Sudah tercakup dari permisi_requests

            seenKeys.add(recId);

            let dateObj = (typeof window.parseUniversalDate === 'function')
                ? window.parseUniversalDate(rec.timestamp || rec.date || rec.timestampIso || rec.created_at)
                : (rec.timestamp?.toDate ? rec.timestamp.toDate() : (rec.date ? new Date(rec.date) : null));

            let itemDateStr = '';
            let dateDisplay = '-';
            if (dateObj && !isNaN(dateObj.getTime())) {
                const year = dateObj.getFullYear();
                const month = String(dateObj.getMonth() + 1).padStart(2, '0');
                itemDateStr = `${year}-${month}`;
                dateDisplay = dateObj.toLocaleDateString('id-ID', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric'
                });
            } else if (rec.date) {
                itemDateStr = String(rec.date).slice(0, 7);
                dateDisplay = rec.date;
            }

            let time = '';
            let reason = rec.desc || rec.description || '-';
            if (reason.startsWith('[')) {
                const match = reason.match(/^\[([^\]]+)\]\s*(.*)$/);
                if (match) {
                    time = match[1];
                    reason = match[2] || '-';
                }
            }

            combinedList.push({
                id: recId,
                dateDisplay,
                itemDateStr,
                timestamp: dateObj ? dateObj.getTime() : 0,
                time,
                type: rec.type || 'Permisi',
                reason,
                statusBadge: {
                    text: 'Tercatat',
                    badgeClass: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                },
                approver: rec.reporter_name || ''
            });
        });

        // 3. Urutkan berdasarkan waktu/tanggal terbaru
        combinedList.sort((a, b) => b.timestamp - a.timestamp);

        // 4. Terapkan filter bulan jika ada
        const filteredList = (filterVal !== 'all')
            ? combinedList.filter(item => item.itemDateStr && item.itemDateStr.startsWith(filterVal))
            : combinedList;

        if (filteredList.length === 0) {
            container.innerHTML = `
                <div class="text-center py-4">
                    <i class="fa-solid fa-inbox text-slate-300 dark:text-slate-600 text-2xl mb-2"></i>
                    <p class="text-slate-400 text-sm">Tidak ada riwayat permisi untuk periode ini.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = filteredList.map(item => `
            <div class="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-900/50 rounded-lg p-3 hover:bg-orange-100 dark:hover:bg-orange-900/40 transition">
                <div class="flex justify-between items-start gap-2">
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-1.5 flex-wrap mb-1">
                            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${item.statusBadge.badgeClass}">
                                ${item.statusBadge.text}
                            </span>
                            <span class="text-xs font-bold text-slate-700 dark:text-slate-200">${window.escapeHTML(item.type)}</span>
                        </div>
                        <p class="text-xs text-slate-600 dark:text-slate-300 line-clamp-2">${window.escapeHTML(item.reason)}</p>
                        <div class="flex items-center gap-2 mt-1 text-[10px] text-slate-400">
                            <span><i class="fa-regular fa-calendar mr-1"></i>${item.dateDisplay}</span>
                            ${item.approver ? `<span>&bull; Oleh: ${window.escapeHTML(item.approver)}</span>` : ''}
                        </div>
                    </div>
                    ${item.time ? `<span class="text-[11px] font-bold bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 px-2 py-1 rounded shrink-0 whitespace-nowrap">
                        <i class="fa-regular fa-clock mr-1"></i>${window.escapeHTML(item.time)}
                    </span>` : ''}
                </div>
            </div>
        `).join('');

    } catch (e) {
        console.error('Error load permisi:', e);
        container.innerHTML = '<p class="text-center text-red-400 py-4 text-sm">Gagal memuat riwayat permisi.</p>';
    }
}

// Load Riwayat Absensi dari data attendance yg sudah di-query (hemat kuota!)
async function loadDetailAbsensi(nis, rawAttendance) {
    const container = document.getElementById('detail-absensi-list');
    if (!container) return;

    try {
        // Gunakan data rawAttendance yang sudah di-pass dari loadDetailPresensi
        // Ini menghemat kuota karena tidak perlu query ulang
        const attendance = rawAttendance || [];
        
        // Filter absen: hanya S, I, A, D (bukan H)
        const absences = attendance.filter(a => a.status && a.status !== 'H');

        if (absences.length === 0) {
            container.innerHTML = `
                <div class="text-center py-4">
                    <i class="fa-regular fa-calendar-check text-slate-300 dark:text-slate-600 text-3xl mb-2"></i>
                    <p class="text-slate-400 text-sm">Tidak ada riwayat absensi.</p>
                </div>
            `;
            return;
        }

        // Sort descending by date
        absences.sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            return dateB - dateA;
        });

        let html = '';
        absences.forEach(item => {
            let dateDisplay = item.date;
            try {
                const d = new Date(item.date);
                dateDisplay = d.toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
            } catch (e) { }

            const status = item.status || '?';
            const note = item.note || '-';

            let statusColor = 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300';
            let statusLabel = status;
            
            if (status === 'S') { statusColor = 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800'; statusLabel = 'Sakit'; }
            else if (status === 'I') { statusColor = 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800'; statusLabel = 'Izin'; }
            else if (status === 'A') { statusColor = 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800'; statusLabel = 'Alpha'; }
            else if (status === 'D') { statusColor = 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800'; statusLabel = 'Dispen'; }

            const safeNote = note.replace(/</g, "&lt;").replace(/>/g, "&gt;");

            html += `
            <div class="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-700/30 rounded-lg border border-slate-100 dark:border-slate-700">
                <div class="px-2 py-1 rounded text-xs font-bold border ${statusColor} min-w-[50px] text-center shrink-0">
                    ${statusLabel}
                </div>
                <div class="flex-1 min-w-0">
                    <p class="text-sm font-bold text-slate-800 dark:text-white mb-0.5 truncate">${dateDisplay}</p>
                    <p class="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">${safeNote}</p>
                </div>
            </div>
            `;
        });

        container.innerHTML = html;

    } catch (e) {
        console.error('Error load absensi:', e);
        container.innerHTML = '<p class="text-center text-red-400 py-4 text-sm">Gagal memuat riwayat absensi.</p>';
    }
}

async function loadDetailPerilaku(nis) {
    const container = document.getElementById('detail-perilaku-content');
    container.innerHTML = '<p class="text-center text-slate-400 py-8">Memuat data perilaku...</p>';

    try {
        // Load aggregates & records dari Cloudflare D1 (0 Firestore Read)
        const [aggDoc, snap] = await Promise.all([
            cfClient.getStudentAggregateByNis(nis),
            cfClient.getRecords({ nis: String(nis), limit: 20 })
        ]);

        let totalPoin = aggDoc?.points || 0;
        let records = snap || [];

        const violations = records.filter(r => r.type === 'violation' || r.category === 'Pelanggaran');
        const achievements = records.filter(r => r.type === 'achievement' || r.category === 'Prestasi');

        // Fallback: Jika data agregat dari database bernilai 0 tapi ada riwayat pelanggaran yang ter-load,
        // jumlahkan poin dari riwayat pelanggaran tersebut secara dinamis.
        if (totalPoin === 0 && violations.length > 0) {
            totalPoin = violations.reduce((sum, v) => sum + (Number(v.points) || Number(v.point) || 0), 0);
        }

        const formatDate = (r) => {
            if (r.timestamp && r.timestamp.toDate) return r.timestamp.toDate().toLocaleDateString('id-ID', {day: 'numeric', month: 'short', year: 'numeric'});
            if (r.date) return new Date(r.date).toLocaleDateString('id-ID', {day: 'numeric', month: 'short', year: 'numeric'});
            return '-';
        };

        container.innerHTML = `
        <div class="grid grid-cols-2 gap-4 mb-4">
            <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg p-4 text-center">
                <p class="text-3xl font-bold text-red-600 dark:text-red-400">${totalPoin}</p>
                <p class="text-xs text-red-700 dark:text-red-500 font-bold">TOTAL POIN</p>
            </div>
            <div class="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-900/50 rounded-lg p-4 text-center">
                <p class="text-3xl font-bold text-green-600 dark:text-green-400">${achievements.length}</p>
                <p class="text-xs text-green-700 dark:text-green-500 font-bold">PRESTASI</p>
            </div>
        </div>

        <h4 class="font-bold text-slate-800 dark:text-white mb-2 mt-4"><i class="fa-solid fa-triangle-exclamation text-red-500 mr-1"></i>Riwayat Pelanggaran</h4>
        <div class="space-y-2 max-h-40 overflow-y-auto mb-4 custom-scrollbar">
            ${violations.length ? violations.map(v => `
                <div class="bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded p-2 text-sm text-slate-700 dark:text-slate-300">
                    <div class="flex justify-between items-start">
                        <span class="font-bold">${v.violationName || v.name || '-'}</span>
                        <span class="text-red-600 dark:text-red-400 font-bold ml-2 shrink-0">(${v.points || v.point || 0} poin)</span>
                    </div>
                    <p class="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">${formatDate(v)} • ${v.desc || 'Tanpa keterangan'}</p>
                </div>
            `).join('') : '<p class="text-slate-400 text-sm">Tidak ada pelanggaran tercatat.</p>'}
        </div>

        <div class="flex justify-between items-center mb-2 mt-4">
            <h4 class="font-bold text-slate-800 dark:text-white"><i class="fa-solid fa-trophy text-yellow-500 mr-1"></i>Riwayat Prestasi</h4>
            <a href="input.html?nis=${nis}&type=achievement" target="_blank" class="text-xs bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 px-3 py-1 rounded-full hover:bg-green-200 dark:hover:bg-green-900/60 transition">
                <i class="fa-solid fa-plus mr-1"></i>Input
            </a>
        </div>
        <div class="space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
            ${achievements.length ? achievements.map(a => `
                <div class="bg-green-50 dark:bg-green-900/10 border border-green-100 dark:border-green-900/30 rounded p-2 text-sm text-slate-700 dark:text-slate-300">
                    <div class="font-bold">${a.achievementName || a.name || '-'}</div>
                    <p class="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">${formatDate(a)} • ${a.desc || 'Tanpa keterangan'}</p>
                </div>
            `).join('') : '<p class="text-slate-400 text-sm">Tidak ada prestasi tercatat.</p>'}
        </div>
        `;

    } catch (e) {
        console.error('Error load perilaku:', e);
        container.innerHTML = '<p class="text-center text-red-400 py-8">Gagal memuat data perilaku.</p>';
    }
}

// Tanggal mulai sistem baru - bulan sebelum ini otomatis dianggap lunas
const SYSTEM_START_DATE = new Date(2026, 6, 1);

// Hitung tahun ajaran siswa berdasarkan kelas (3 tahun: X, XI, XII)
function calculateCohort(className) {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const academicYearStart = currentMonth >= 6 ? currentYear : currentYear - 1;

    let offset = 0;
    if (className && className.startsWith("XII")) offset = 2;
    else if (className && className.startsWith("XI")) offset = 1;
    else offset = 0;

    const startYear = academicYearStart - offset;
    const endYear = startYear + 3;
    return { startYear, endYear };
}

function isMonthPaid(paymentHistory, year, month, dueDate) {
    const key = `${year}-${month}`;
    const data = paymentHistory[key];

    if (data) {
        if (data.type === 'manual_debt') return false;
        return true;
    }

    const itemDate = new Date(year, month - 1, dueDate);
    if (itemDate < SYSTEM_START_DATE) return true;

    return false;
}

async function loadDetailSPP(nis) {
    const container = document.getElementById('detail-spp-content');
    container.innerHTML = '<p class="text-center text-slate-400 py-8"><i class="fa-solid fa-spinner fa-spin mr-1"></i>Memuat status SPP...</p>';

    try {
        const student = myStudents.find(s => String(s.student_nis).trim() === String(nis).trim());
        if (!student) {
            container.innerHTML = '<p class="text-center text-red-400 py-8">Siswa tidak terdaftar di perwalian Anda.</p>';
            return;
        }

        // 1. Hitung Cohort Siswa
        detailStudentCohort = calculateCohort(student.student_class);

        // 2. Set default tahun SPP ke tahun akademik aktif saat ini
        const now = new Date();
        const curMonth = now.getMonth();
        const curYear = now.getFullYear();
        const activeAcademicYear = curMonth >= 6 ? curYear : curYear - 1;

        detailSppYear = activeAcademicYear;
        if (detailSppYear < detailStudentCohort.startYear) detailSppYear = detailStudentCohort.startYear;
        if (detailSppYear > detailStudentCohort.endYear - 1) detailSppYear = detailStudentCohort.endYear - 1;

        // 3. Ambil Konfigurasi Tanggal Jatuh Tempo (cache terpusat)
        detailSppDueDate = 20; // Default
        try {
            const configData = await window.getFinanceConfigCache();
            if (configData && configData.dueDate) {
                detailSppDueDate = configData.dueDate;
            }
        } catch (e) { }

        // 4. Query transaksi SPP secara efisien dari Supabase
        const nisStr = String(nis).trim();
        const normNis = nisStr.replace(/^0+/, '');
        const targetNisList = Array.from(new Set([nisStr, normNis, nisStr.padStart(4, '0')].filter(Boolean)));
        detailPaymentHistory = {};

        initSupabase();
        if (!supabase) throw new Error('Supabase client belum siap');

        const { data, error } = await supabase
            .from('finance_transactions')
            .select('year, month, amount, type, notes, payment_date, date_str')
            .in('student_nis', targetNisList);

        if (error) {
            console.error('[GuruWali] Error loadStudentSPP Supabase:', error);
            throw error;
        }

        if (data) {
            data.forEach(d => {
                if (d.year && d.month) {
                    const key = `${d.year}-${d.month}`;
                    detailPaymentHistory[key] = {
                        amount: Number(d.amount) || 0,
                        type: d.type || 'paid',
                        note: d.notes || '',
                        paymentDate: d.payment_date ? new Date(d.payment_date) : null,
                        dateStr: d.date_str || ''
                    };
                }
            });
        }

        // 6. Render Grid UI
        renderDetailSppGrid();

    } catch (e) {
        console.error('Error load SPP:', e);
        container.innerHTML = '<p class="text-center text-red-400 py-8">Gagal memuat data SPP.</p>';
    }
}

function renderDetailSppGrid() {
    const container = document.getElementById('detail-spp-content');
    if (!container || !detailStudentCohort) return;

    // Nama bulan Indonesia (Disingkat)
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

    // Urutan bulan tahun ajaran: Juli (7) - Juni (6)
    const academicMonths = [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6];

    const today = new Date();

    let gridHtml = '';
    for (let i = 0; i < 12; i++) {
        const monthNum = academicMonths[i];
        const year = monthNum >= 7 ? detailSppYear : detailSppYear + 1;

        const monthLabel = monthNames[monthNum - 1];
        const monthKey = `${year}-${monthNum}`;

        // Cek status Locked (di luar range tahun ajaran siswa)
        let isLocked = false;
        if (year < detailStudentCohort.startYear || (year === detailStudentCohort.startYear && monthNum < 7)) isLocked = true;
        if (year > detailStudentCohort.endYear || (year === detailStudentCohort.endYear && monthNum > 6)) isLocked = true;

        const isPaid = isMonthPaid(detailPaymentHistory, year, monthNum, detailSppDueDate);
        const paymentData = detailPaymentHistory[monthKey];

        // Cek apakah sudah jatuh tempo
        const itemDate = new Date(year, monthNum - 1, detailSppDueDate);
        const isPastDue = itemDate < today && !isPaid;

        let cardClass = 'bg-slate-100 dark:bg-slate-700/30 border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500'; // Default
        let icon = '<i class="fa-solid fa-clock text-slate-300 dark:text-slate-600 text-sm"></i>';
        let statusText = 'Nanti';

        if (isLocked) {
            cardClass = 'bg-slate-50 dark:bg-slate-800/20 border-slate-100 dark:border-slate-800/50 text-slate-300 dark:text-slate-700 opacity-50';
            icon = '<i class="fa-solid fa-ban text-slate-200 dark:text-slate-700 text-sm"></i>';
            statusText = 'Lock';
        } else if (isPaid) {
            if (paymentData) {
                cardClass = 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900/50 text-green-700 dark:text-green-400';
                icon = '<i class="fa-solid fa-check-circle text-green-500 dark:text-green-400 text-sm"></i>';
                statusText = 'Lunas';
            } else {
                cardClass = 'bg-emerald-50/60 dark:bg-emerald-950/10 border-emerald-100 dark:border-emerald-900/30 text-emerald-600 dark:text-emerald-500';
                icon = '<i class="fa-solid fa-check text-emerald-400 dark:text-emerald-500 text-sm"></i>';
                statusText = 'Lunas';
            }
        } else if (isPastDue) {
            cardClass = 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400';
            icon = '<i class="fa-solid fa-exclamation-circle text-red-500 dark:text-red-400 text-sm"></i>';
            statusText = 'Tunggakan';
        }

        let payDateHtml = '';
        if (isPaid && !isLocked) {
            if (paymentData) {
                let pDate = null;
                if (paymentData.paymentDate) {
                    if (typeof paymentData.paymentDate.toDate === 'function') {
                        pDate = paymentData.paymentDate.toDate();
                    } else {
                        pDate = new Date(paymentData.paymentDate);
                    }
                } else if (paymentData.dateStr) {
                    pDate = new Date(paymentData.dateStr);
                }
                if (pDate && !isNaN(pDate.getTime())) {
                    const dd = String(pDate.getDate()).padStart(2, '0');
                    const mm = String(pDate.getMonth() + 1).padStart(2, '0');
                    payDateHtml = ` • <span class="bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300 px-0.5 rounded font-medium text-[8px]" title="Tanggal Bayar: ${dd}/${mm}/${pDate.getFullYear()}"><i class="fa-regular fa-calendar-check mr-0.5"></i>${dd}/${mm}</span>`;
                }
            } else {
                payDateHtml = ` • <span class="bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-0.5 rounded font-medium text-[8px]" title="Lunas Migrasi Awal"><i class="fa-solid fa-clock-rotate-left mr-0.5"></i>Migrasi</span>`;
            }
        }

        gridHtml += `
            <div class="rounded-lg border p-1.5 text-center ${cardClass} transition-all hover:shadow-sm flex flex-col justify-between h-20">
                <div class="text-sm">${icon}</div>
                <div class="font-bold text-[10px] leading-tight mt-0.5">${monthLabel}</div>
                <div class="text-[8px] text-slate-400 dark:text-slate-500 flex items-center justify-center gap-0.5">${year}${payDateHtml}</div>
                <div class="text-[8px] font-bold uppercase tracking-wider mt-0.5">${statusText}</div>
            </div>
        `;
    }

    container.innerHTML = `
        <div class="flex justify-between items-center mb-3 bg-slate-50 dark:bg-slate-700/30 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 gap-2">
            <span class="text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                <i class="fa-solid fa-file-invoice-dollar text-blue-500"></i>
                Status SPP Bulanan
            </span>
            <div class="flex items-center gap-2">
                <button onclick="window.changeDetailSppYear(-1)" id="detail-spp-btn-prev" class="w-6 h-6 rounded-full border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center transition-colors"><i class="fa-solid fa-chevron-left text-[10px] dark:text-white"></i></button>
                <span id="detail-spp-display-year" class="text-[10px] font-bold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 px-2.5 py-0.5 rounded-full border border-slate-200 dark:border-slate-600">-</span>
                <button onclick="window.changeDetailSppYear(1)" id="detail-spp-btn-next" class="w-6 h-6 rounded-full border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center transition-colors"><i class="fa-solid fa-chevron-right text-[10px] dark:text-white"></i></button>
            </div>
        </div>
        <div id="detail-spp-grid" class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
            ${gridHtml}
        </div>
    `;

    // Update display year
    document.getElementById('detail-spp-display-year').innerText = `${detailSppYear}/${detailSppYear + 1}`;

    // Update nav buttons status
    const btnPrev = document.getElementById('detail-spp-btn-prev');
    const btnNext = document.getElementById('detail-spp-btn-next');
    if (btnPrev && btnNext) {
        const maxYear = detailStudentCohort.endYear - 1;
        btnPrev.disabled = detailSppYear <= detailStudentCohort.startYear;
        btnPrev.classList.toggle('opacity-30', detailSppYear <= detailStudentCohort.startYear);
        btnPrev.classList.toggle('cursor-not-allowed', detailSppYear <= detailStudentCohort.startYear);

        btnNext.disabled = detailSppYear >= maxYear;
        btnNext.classList.toggle('opacity-30', detailSppYear >= maxYear);
        btnNext.classList.toggle('cursor-not-allowed', detailSppYear >= maxYear);
    }
}

window.changeDetailSppYear = function (delta) {
    if (!detailStudentCohort) return;
    const newYear = detailSppYear + delta;
    if (newYear < detailStudentCohort.startYear || newYear > detailStudentCohort.endYear - 1) return;
    detailSppYear = newYear;
    renderDetailSppGrid();
};

async function loadDetailBK(nis) {
    const container = document.getElementById('detail-bk-content');
    container.innerHTML = '<p class="text-center text-slate-400 py-8">Memuat catatan BK...</p>';

    try {
        const snap = await cfClient.getBkActions({ nis: String(nis), limit: 10 });

        if (!snap || snap.length === 0) {
            container.innerHTML = '<p class="text-center text-slate-400 py-8">Tidak ada catatan BK ditemukan.</p>';
            return;
        }

        let html = '<div class="space-y-3">';
        snap.forEach(b => {
            const dateStr = b.date?.toDate ? b.date.toDate().toLocaleDateString('id-ID') : (b.date || '-');

            html += `
            <div class="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
                <div class="flex justify-between items-center mb-2">
                    <span class="text-xs font-bold text-indigo-600">${b.actionType || b.type || 'Konseling'}</span>
                    <span class="text-xs text-slate-500">${dateStr}</span>
                </div>
                <p class="text-sm text-slate-700">${b.notes || b.description || '-'}</p>
            </div>
            `;
        });
        html += '</div>';

        container.innerHTML = html;

    } catch (e) {
        console.error('Error load BK:', e);
        container.innerHTML = '<p class="text-center text-red-400 py-8">Gagal memuat catatan BK.</p>';
    }
}

// --- HAPUS SISWA DARI PERWALIAN ---
window.confirmHapusSiswa = function () {
    if (!currentDetailNIS) return;
    const student = myStudents.find(s => s.student_nis === currentDetailNIS);
    if (!student) return;

    document.getElementById('confirm-hapus-msg').innerText = `${student.student_name} akan dihapus dari daftar perwalian Anda.`;
    document.getElementById('modal-confirm-hapus').classList.remove('hidden');
};

window.executeHapusSiswa = async function () {
    if (!currentDetailNIS) return;

    const btn = document.getElementById('btn-confirm-hapus');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    btn.disabled = true;

    try {
        const docId = `${currentUser.uid}_${currentDetailNIS}`;
        const oldStudent = myStudents.find(s => s.student_nis === currentDetailNIS);

        if (cfClient && cfClient.enabled) {
            await cfClient.deleteGuruWaliAssignment(docId, {
                guru_uid: currentUser.uid,
                student_nis: currentDetailNIS
            });
        }

        if (typeof window.logAudit === 'function') {
            window.logAudit('DELETE_PERWALIAN', docId, oldStudent, null, `Menghapus siswa dari perwalian: ${oldStudent ? oldStudent.student_name : currentDetailNIS}`);
        }

        showToast('Berhasil', 'Siswa dihapus dari perwalian.', 'success');
        closeModal('modal-confirm-hapus');
        closeModal('modal-detail-siswa');
        currentDetailNIS = null;

        // Clear cache dan reload dengan force refresh
        clearMyStudentsCache();
        await loadMyStudents(true);

    } catch (e) {
        console.error('Error hapus siswa:', e);
        showToast('Gagal', 'Gagal menghapus siswa. Coba lagi.', 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

// --- EVENT LISTENERS ---
function setupEventListeners() {
    // Search siswa di main grid/table
    const searchInput = document.getElementById('search-siswa');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            if (typeof window.applyFiltersAndRender === 'function') {
                window.applyFiltersAndRender();
            }
        });
    }

    // Filter EWS & Presensi
    const filterEws = document.getElementById('filter-ews-risk');
    const filterPresensi = document.getElementById('filter-presensi-problem');

    if (filterEws) filterEws.addEventListener('change', () => window.applyFiltersAndRender());
    if (filterPresensi) filterPresensi.addEventListener('change', () => window.applyFiltersAndRender());

    // Search & Focus siswa di modal tambah siswa (Searchable Floating Dropdown)
    const searchModalInput = document.getElementById('search-siswa-input');
    if (searchModalInput) {
        searchModalInput.addEventListener('focus', () => {
            window.showTambahSiswaDropdown();
        });
        searchModalInput.addEventListener('click', () => {
            window.showTambahSiswaDropdown();
        });
        searchModalInput.addEventListener('input', () => {
            window.filterTambahSiswaDropdown();
        });
    }

    // Search & Focus siswa di modal catatan (Searchable Combobox)
    const searchCatatanInput = document.getElementById('catatan-search-siswa');
    if (searchCatatanInput) {
        searchCatatanInput.addEventListener('focus', () => {
            window.showCatatanSiswaDropdown();
        });
        searchCatatanInput.addEventListener('input', () => {
            window.filterCatatanSiswaDropdown();
        });
        searchCatatanInput.addEventListener('click', () => {
            window.showCatatanSiswaDropdown();
        });
    }

    // Close dropdown on click outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#catatan-selected-chips') && !e.target.closest('#catatan-siswa-dropdown')) {
            window.hideCatatanSiswaDropdown();
        }
        if (!e.target.closest('#tambah-siswa-chips-container') && !e.target.closest('#tambah-siswa-dropdown')) {
            window.hideTambahSiswaDropdown();
        }
    });

    // Filter catatan
    const filterSiswa = document.getElementById('filter-siswa-catatan');
    const filterKategori = document.getElementById('filter-kategori');
    if (filterSiswa) filterSiswa.addEventListener('change', loadCatatanPembinaan);
    if (filterKategori) filterKategori.addEventListener('change', loadCatatanPembinaan);

    // Event listener kalkulasi waktu pembinaan modal catatan
    const catatanJamMulai = document.getElementById('catatan-jam-mulai');
    const catatanJamSelesai = document.getElementById('catatan-jam-selesai');
    if (catatanJamMulai) {
        catatanJamMulai.addEventListener('input', window.updateCatatanDurationLabel);
        catatanJamMulai.addEventListener('change', window.updateCatatanDurationLabel);
    }
    if (catatanJamSelesai) {
        catatanJamSelesai.addEventListener('input', window.updateCatatanDurationLabel);
        catatanJamSelesai.addEventListener('change', window.updateCatatanDurationLabel);
    }

    // Event listener upload foto modal catatan
    const inputFotoFile = document.getElementById('catatan-input-foto-file');
    const inputFotoCamera = document.getElementById('catatan-input-foto-camera');
    if (inputFotoFile) {
        inputFotoFile.addEventListener('change', function () {
            window.handleCatatanPhotoSelect(this.files);
            this.value = '';
        });
    }
    if (inputFotoCamera) {
        inputFotoCamera.addEventListener('change', function () {
            window.handleCatatanPhotoSelect(this.files);
            this.value = '';
        });
    }

    // Tab switch trigger load
    const tabCatatan = document.getElementById('tab-btn-catatan');
    if (tabCatatan) {
        tabCatatan.addEventListener('click', () => {
            setTimeout(loadCatatanPembinaan, 100);
        });
    }
    isListenersSetup = true;
}

// --- CLOSE MODAL ---
window.closeModal = function (id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
};

// --- EDIT CATATAN ---
let currentEditNoteId = null;

window.openEditCatatan = async function (noteId) {
    currentEditNoteId = noteId;

    try {
        let noteData = null;
        if (cfClient && cfClient.enabled) {
            const notes = await cfClient.getGuruWaliNotes({ guru_uid: currentUser?.uid, limit: 200 });
            noteData = notes.find(n => n.id === noteId);

            // Fallback: Jika dibuka dari detail siswa dan tidak ditemukan di catatan guru saat ini
            if (!noteData && currentDetailNIS) {
                const studentNotes = await cfClient.getGuruWaliNotes({ student_nis: currentDetailNIS, limit: 100 });
                noteData = (studentNotes || []).find(n => n.id === noteId);
            }
        }

        if (!noteData) {
            showToast('Error', 'Catatan tidak ditemukan.', 'error');
            return;
        }

        const rawNotes = noteData.notes || noteData.content || '';
        const lines = rawNotes.split('\n');
        const title = noteData.title || lines[0] || '';
        const content = noteData.content || (lines.length > 1 ? lines.slice(1).join('\n') : rawNotes);

        // Populate form kategori (4 kategori resmi: akademik, kompetensi, keterampilan, karakter)
        const catSelect = document.getElementById('edit-catatan-kategori');
        let catValue = (noteData.category || 'akademik').toLowerCase().trim();
        const validCategories = ['akademik', 'kompetensi', 'keterampilan', 'karakter'];
        if (!validCategories.includes(catValue)) {
            catValue = 'akademik';
        }
        if (catSelect) {
            catSelect.value = catValue;
        }
        document.getElementById('edit-catatan-tanggal').value = noteData.date || '';
        document.getElementById('edit-catatan-judul').value = title;
        document.getElementById('edit-catatan-isi').value = content;

        document.getElementById('modal-edit-catatan').classList.remove('hidden');

    } catch (e) {
        console.error('Error load catatan for edit:', e);
        showToast('Error', 'Gagal memuat data catatan.', 'error');
    }
};

window.submitEditCatatan = async function () {
    if (!currentEditNoteId) return;

    let kategori = (document.getElementById('edit-catatan-kategori')?.value || 'akademik').toLowerCase().trim();
    const validCategories = ['akademik', 'kompetensi', 'keterampilan', 'karakter'];
    if (!validCategories.includes(kategori)) {
        kategori = 'akademik';
    }
    const tanggal = document.getElementById('edit-catatan-tanggal')?.value || '';
    const judul = document.getElementById('edit-catatan-judul')?.value.trim() || '';
    const isi = document.getElementById('edit-catatan-isi')?.value.trim() || '';

    if (!judul || !isi || !tanggal) {
        showToast('Peringatan', 'Semua field wajib diisi.', 'warning');
        return;
    }

    const btn = document.getElementById('btn-submit-edit-catatan');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Menyimpan...';
    btn.disabled = true;

    try {
        if (cfClient && cfClient.enabled) {
            await cfClient.saveGuruWaliNote({
                category: kategori,
                title: judul,
                notes: `${judul}\n${isi}`,
                date: tanggal
            }, true, currentEditNoteId);
        }

        if (typeof window.logAudit === 'function') {
            window.logAudit('UPDATE_CATATAN_WALI', currentEditNoteId, null, { kategori, judul }, `Memperbarui catatan pembinaan: ${judul}`);
        }

        showToast('Berhasil', 'Catatan berhasil diperbarui.', 'success');
        closeModal('modal-edit-catatan');
        currentEditNoteId = null;

        await refreshGridAndTableNotes();

        // Reload catatan
        if (!document.getElementById('view-catatan').classList.contains('hidden')) {
            loadCatatanPembinaan();
        }
        if (currentDetailNIS) {
            loadDetailPembinaanList(currentDetailNIS);
        }

    } catch (e) {
        console.error('Error update catatan:', e);
        showToast('Gagal', 'Gagal menyimpan perubahan.', 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

// --- HAPUS CATATAN ---
let noteToDelete = null;

window.confirmHapusCatatan = function (noteId, noteTitle) {
    noteToDelete = noteId;
    document.getElementById('hapus-catatan-title').innerText = noteTitle || 'Catatan ini';
    document.getElementById('modal-confirm-hapus-catatan').classList.remove('hidden');
};

window.executeHapusCatatan = async function () {
    if (!noteToDelete) return;

    const btn = document.getElementById('btn-confirm-hapus-catatan');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Menghapus...';
    btn.disabled = true;

    try {
        if (cfClient && cfClient.enabled) {
            await cfClient.deleteGuruWaliNote(noteToDelete);
        }

        if (typeof window.logAudit === 'function') {
            window.logAudit('DELETE_CATATAN_WALI', noteToDelete, null, null, `Menghapus catatan pembinaan`);
        }

        showToast('Berhasil', 'Catatan berhasil dihapus.', 'success');
        closeModal('modal-confirm-hapus-catatan');
        noteToDelete = null;

        await refreshGridAndTableNotes();

        // Reload catatan
        if (!document.getElementById('view-catatan').classList.contains('hidden')) {
            loadCatatanPembinaan();
        }
        if (currentDetailNIS) {
            loadDetailPembinaanList(currentDetailNIS);
        }

    } catch (e) {
        console.error('Error hapus catatan:', e);
        showToast('Gagal', 'Gagal menghapus catatan.', 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

// --- EDIT DATA SISWA ---
window.openEditDataSiswa = async function () {
    if (!currentDetailNIS) {
        showToast('Error', 'NIS siswa tidak ditemukan.', 'error');
        return;
    }

    try {
        let data = null;
        if (typeof window.getStudentsCache === 'function') {
            try {
                const allStudents = await window.getStudentsCache();
                const found = allStudents.find(s => String(s.nis || s.id) === String(currentDetailNIS));
                if (found) data = found;
            } catch (e) {}
        }

        if (!data) {
            try {
                if (cfClient && cfClient.enabled) {
                    const cfStudent = await cfClient.getStudentByNis(currentDetailNIS);
                    if (cfStudent) data = cfStudent;
                }
            } catch (cfErr) {}
        }

        if (!data) {
            showToast('Error', 'Data siswa tidak ditemukan.', 'error');
            return;
        }

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = (val !== undefined && val !== null) ? val : '';
        };

        // Populate form (Lengkap 48 Dapodik)
        document.getElementById('wali-edit-nis-hidden').value = currentDetailNIS;

        // 1. Identitas Sekolah & Pribadi
        setVal('wali-edit-nis', data.nis);
        setVal('wali-edit-nisn', data.nisn);
        setVal('wali-edit-class', data.class);
        setVal('wali-edit-name', data.name);
        setVal('wali-edit-gender', data.gender || 'L');
        setVal('wali-edit-birthPlace', data.birthPlace || data.pob || data.tempatLahir);
        setVal('wali-edit-birthDate', data.birthDate || data.dob || data.tanggalLahir);
        setVal('wali-edit-nik', data.nik);
        setVal('wali-edit-kk_no', data.kk_no || data.no_kk);
        setVal('wali-edit-religion', data.religion || data.agama);
        setVal('wali-edit-child_order', data.child_order || data.anakKe);
        setVal('wali-edit-jml_saudara_kandung', data.jml_saudara_kandung || data.jml_saudara);
        setVal('wali-edit-akta_lahir_reg', data.akta_lahir_reg || data.no_akta);
        setVal('wali-edit-sekolah_asal', data.sekolah_asal);

        // 2. Kontak Siswa & Domisili
        setVal('wali-edit-phone_siswa', data.phone_siswa || data.phone || data.hpSiswa);
        setVal('wali-edit-email', data.email_siswa || data.email);
        setVal('wali-edit-living_type', data.living_type || data.jenis_tinggal);
        setVal('wali-edit-transportation', data.transportation || data.alat_transportasi);
        setVal('wali-edit-address', data.address || data.alamat);
        setVal('wali-edit-dusun', data.dusun);
        setVal('wali-edit-kelurahan', data.kelurahan);
        setVal('wali-edit-kecamatan', data.kecamatan);
        setVal('wali-edit-postal_code', data.postal_code || data.kode_pos);
        setVal('wali-edit-jarak_sekolah_km', data.jarak_sekolah_km);

        // 3. Data Ayah
        setVal('wali-edit-father', data.father || data.namaAyah || data.father_name);
        setVal('wali-edit-father_nik', data.father_nik || data.nik_ayah);
        setVal('wali-edit-father_birth_year', data.father_birth_year || data.tahun_lahir_ayah);
        setVal('wali-edit-father_education', data.father_education || data.pendidikan_ayah);
        setVal('wali-edit-father_job', data.father_job || data.pekerjaan_ayah);
        setVal('wali-edit-father_income', data.father_income || data.penghasilan_ayah);
        setVal('wali-edit-father_phone', data.father_phone || data.phone_parent || data.parentPhone || data.hpOrtu);

        // 4. Data Ibu
        setVal('wali-edit-mother', data.mother || data.name_parent || data.parentName || data.namaIbu || data.mother_name);
        setVal('wali-edit-mother_nik', data.mother_nik || data.nik_ibu);
        setVal('wali-edit-mother_birth_year', data.mother_birth_year || data.tahun_lahir_ibu);
        setVal('wali-edit-mother_education', data.mother_education || data.pendidikan_ibu);
        setVal('wali-edit-mother_job', data.mother_job || data.pekerjaan_ibu);
        setVal('wali-edit-mother_income', data.mother_income || data.penghasilan_ibu);
        setVal('wali-edit-phone_parent', data.phone_parent || data.mother_phone || data.parentPhone || data.hpOrtu);

        // 5. Data Wali
        setVal('wali-edit-guardian_name', data.guardian_name || data.nama_wali);
        setVal('wali-edit-guardian_nik', data.guardian_nik || data.nik_wali);
        setVal('wali-edit-guardian_birth_year', data.guardian_birth_year || data.tahun_lahir_wali);
        setVal('wali-edit-guardian_education', data.guardian_education || data.pendidikan_wali);
        setVal('wali-edit-guardian_job', data.guardian_job || data.pekerjaan_wali);
        setVal('wali-edit-guardian_income', data.guardian_income || data.penghasilan_wali);
        setVal('wali-edit-guardian_phone', data.guardian_phone || data.phone_wali);

        // 6. Data Fisik & Catatan
        setVal('wali-edit-weight', data.weight || data.berat_badan);
        setVal('wali-edit-height', data.height || data.tinggi_badan);
        setVal('wali-edit-head_circumference', data.head_circumference || data.lingkar_kepala);
        setVal('wali-edit-note', data.note);

        window._currentEditingStudentGuruWali = data || {};
        document.getElementById('modal-edit-data-siswa').classList.remove('hidden');

    } catch (e) {
        console.error('Error load siswa for edit:', e);
        showToast('Error', 'Gagal memuat data siswa.', 'error');
    }
};

window.submitEditDataSiswa = async function () {
    const nis = document.getElementById('wali-edit-nis-hidden').value;
    if (!nis) return;

    const oldData = window._currentEditingStudentGuruWali || {};
    let name = (document.getElementById('wali-edit-name')?.value || '').trim();
    let kelas = (document.getElementById('wali-edit-class')?.value || '').trim();

    // Preservasi data pokok jika dikosongkan (Smart Merge)
    if (!name && oldData.name) name = oldData.name;
    if (!kelas && oldData.class) kelas = oldData.class;

    const btn = document.getElementById('btn-submit-edit-data-siswa');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Menyimpan...';
    btn.disabled = true;

    try {
        const getVal = (id) => (document.getElementById(id)?.value || '').trim();
        const fatherPhone = getVal('wali-edit-father_phone');
        const motherPhone = getVal('wali-edit-phone_parent');
        const emailVal = getVal('wali-edit-email');
        const fatherName = getVal('wali-edit-father');
        const motherName = getVal('wali-edit-mother');

        const updatedData = {
            // 1. Identitas Sekolah & Pribadi
            nisn: getVal('wali-edit-nisn'),
            class: kelas,
            name: name,
            gender: document.getElementById('wali-edit-gender')?.value || oldData.gender || 'L',
            birthPlace: getVal('wali-edit-birthPlace'),
            birthDate: document.getElementById('wali-edit-birthDate')?.value || null,
            nik: getVal('wali-edit-nik'),
            kk_no: getVal('wali-edit-kk_no'),
            religion: document.getElementById('wali-edit-religion')?.value || '',
            child_order: document.getElementById('wali-edit-child_order')?.value || null,
            jml_saudara_kandung: document.getElementById('wali-edit-jml_saudara_kandung')?.value || null,
            akta_lahir_reg: getVal('wali-edit-akta_lahir_reg'),
            sekolah_asal: getVal('wali-edit-sekolah_asal'),

            // 2. Kontak Siswa, Domisili & Transportasi
            phone_siswa: getVal('wali-edit-phone_siswa'),
            email_siswa: emailVal,
            email: emailVal,
            living_type: getVal('wali-edit-living_type'),
            transportation: getVal('wali-edit-transportation'),
            address: getVal('wali-edit-address'),
            dusun: getVal('wali-edit-dusun'),
            kelurahan: getVal('wali-edit-kelurahan'),
            kecamatan: getVal('wali-edit-kecamatan'),
            postal_code: getVal('wali-edit-postal_code'),
            jarak_sekolah_km: getVal('wali-edit-jarak_sekolah_km'),

            // 3. Data Ayah
            father: fatherName,
            father_name: fatherName,
            father_nik: getVal('wali-edit-father_nik'),
            father_birth_year: getVal('wali-edit-father_birth_year'),
            father_education: getVal('wali-edit-father_education'),
            father_job: getVal('wali-edit-father_job'),
            father_income: getVal('wali-edit-father_income'),
            father_phone: fatherPhone,

            // 4. Data Ibu
            mother: motherName,
            mother_name: motherName,
            name_parent: motherName || fatherName,
            mother_nik: getVal('wali-edit-mother_nik'),
            mother_birth_year: getVal('wali-edit-mother_birth_year'),
            mother_education: getVal('wali-edit-mother_education'),
            mother_job: getVal('wali-edit-mother_job'),
            mother_income: getVal('wali-edit-mother_income'),
            phone_parent: motherPhone || fatherPhone,

            // 5. Data Wali
            guardian_name: getVal('wali-edit-guardian_name'),
            guardian_nik: getVal('wali-edit-guardian_nik'),
            guardian_birth_year: getVal('wali-edit-guardian_birth_year'),
            guardian_education: getVal('wali-edit-guardian_education'),
            guardian_job: getVal('wali-edit-guardian_job'),
            guardian_income: getVal('wali-edit-guardian_income'),
            guardian_phone: getVal('wali-edit-guardian_phone'),

            // 6. Data Fisik & Catatan
            weight: getVal('wali-edit-weight'),
            height: getVal('wali-edit-height'),
            head_circumference: getVal('wali-edit-head_circumference'),
            note: getVal('wali-edit-note'),
            updated_at: new Date().toISOString()
        };

        // Validasi format 16 digit NIK/KK & keunikan dengan mode parsial/edit (tidak wajib lengkap 16 digit)
        const idValidation = typeof validateStudentIdentityNumbers === 'function'
            ? validateStudentIdentityNumbers({
                nik: updatedData.nik,
                kk_no: updatedData.kk_no,
                father_nik: updatedData.father_nik,
                mother_nik: updatedData.mother_nik,
                guardian_nik: updatedData.guardian_nik
            }, { allowPartial: true, isEdit: true })
            : (window.validateStudentIdentityNumbers ? window.validateStudentIdentityNumbers({
                nik: updatedData.nik,
                kk_no: updatedData.kk_no,
                father_nik: updatedData.father_nik,
                mother_nik: updatedData.mother_nik,
                guardian_nik: updatedData.guardian_nik
            }, { allowPartial: true, isEdit: true }) : { valid: true });

        if (!idValidation.valid) {
            showToast('Peringatan Validasi', idValidation.message, 'warning');
            btn.innerHTML = originalText;
            btn.disabled = false;
            return;
        }

        if (cfClient && cfClient.enabled) {
            await cfClient.saveStudent({ ...updatedData, nis }, true);
        }

        if (typeof window.logAudit === 'function') {
            window.logAudit('UPDATE_STUDENT_BY_WALI', nis, null, updatedData, `Guru wali memperbarui data siswa (Dapodik lengkap): ${name} (${kelas})`);
        }

        // Invalidate students cache SSOT
        if (cfClient && cfClient.enabled) {
            await cfClient.saveSystemSetting('metadata', { lastUpdateStudents: Date.now() });
        }
        if (typeof window.invalidateStudentsCache === 'function') {
            window.invalidateStudentsCache();
        }

        showToast('Berhasil', 'Data siswa berhasil diperbarui.', 'success');
        closeModal('modal-edit-data-siswa');

        // Reload profil dan data di modal detail
        loadDetailProfil(nis);

        // Update nama di header modal detail
        document.getElementById('detail-nama').innerText = name;

        // Update assignment cache
        const assignment = myStudents.find(s => String(s.student_nis).trim() === String(nis).trim());
        if (assignment) {
            assignment.student_name = name;
            assignment.student_class = kelas;
        }

        // Reload grid di background
        renderStudentGrid();

    } catch (e) {
        console.error('Error update siswa:', e);
        showToast('Gagal', 'Gagal menyimpan perubahan.', 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

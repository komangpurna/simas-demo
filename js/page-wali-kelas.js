/* js/page-wali-kelas.js - Complete Integrated Command Center Portal Wali Kelas SIMAS SMAGESA */
import { auth, db, PATHS, AI_CONFIG, getAiConfig, getAiConfigAsync, buildRaporNotePrompt, computeClassicalMetrics, extractFriendlyStudentName, fetchGeminiWithFallback, getUserGeminiApiKeysAsync, supabase, SCHOOL_CONFIG, replaceSchoolIdentityText, calculateCohort, getRateForStudent, calculateStudentTunggakan, SYSTEM_START_DATE_SPP, resolvePhotoUrl } from './config.js';
import { cfClient } from './cloudflare-client.js';
import { initLayout, escapeHTML, showToast, formatDateIndo, formatDateIndoFormal, getLocalISODate, canDo, validateStudentIdentityNumbers } from './global.js';
import { renderWeeklyJurnalTab, printWeeklyJurnal } from './wali-kelas-jurnal.js';
import StudentCardRenderer, {
    isRegularStudentClass,
    isStudentCardActive,
    renderKtsFrontHtml,
    renderKtsBackHtml,
    renderKtsPrintPairHtml,
    renderKtsQrCode,
    printSingleKts,
    formatBirthDateIndo,
    formatBirthPlace,
    formatStudentCardAddress,
    updateKtsCardScale
} from './student-card-renderer.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { 
    collection, query, where, orderBy, getDocs, getDoc, doc, documentId, addDoc, updateDoc, deleteDoc, serverTimestamp, setDoc, Timestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { SimasEWS } from './ews-calculator.js';
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

// --- STATE MANAGEMENT ---
let currentUserProfile = {};
let currentRombelClass = '';
let currentClassStudents = [];
let currentClassAggregates = {};
let currentPermissionCounts = {};
let pendingPermisiList = [];
let todayAttendanceMap = {};
let monthlyAttendanceData = [];
let currentClassAttendanceRows = [];
let classNotesList = [];
let classRecordsList = [];
let currentRecordsSubTab = 'accumulation';
let sppStatusMap = {};
let raporCatatanMap = {};
let ewsWeights = null;
let activeStudentForWa = null;
let activeWaRecipientTarget = 'parent';
let activeStudentForDetail = null;
let activePrintDataPromise = null;

// SPP Grid & Cohort State
let detailStudentCohort = null;
let detailSppYear = 2025;
let detailPaymentHistory = {};
let detailSppDueDate = 20;
const SYSTEM_START_DATE = SYSTEM_START_DATE_SPP;

// Cache sesi rombel. Tidak menyimpan token/credential dan terikat UID aktif.
const WALI_ROMBEL_CACHE_ENABLED = true;
const WALI_ROMBEL_CACHE_TTL_MS = 15 * 60 * 1000;
const WALI_ROMBEL_CACHE_SCHEMA_VERSION = 2;
const WALI_ROMBEL_CACHE_MAX_BYTES = 2 * 1024 * 1024;
let isApplyingWaliRombelCache = false;

function getWaliRombelCacheKey(className) {
    const uid = auth.currentUser?.uid || '';
    if (!uid || !className) return '';
    return `simas:wali-rombel:v${WALI_ROMBEL_CACHE_SCHEMA_VERSION}:${encodeURIComponent(uid)}:${encodeURIComponent(className)}`;
}

function readWaliRombelCache(className) {
    if (!WALI_ROMBEL_CACHE_ENABLED) return null;
    const key = getWaliRombelCacheKey(className);
    if (!key) return null;
    try {
        const snapshot = JSON.parse(sessionStorage.getItem(key) || 'null');
        if (!snapshot || snapshot.schemaVersion !== WALI_ROMBEL_CACHE_SCHEMA_VERSION || Date.now() - snapshot.cachedAt > WALI_ROMBEL_CACHE_TTL_MS) {
            if (snapshot) sessionStorage.removeItem(key);
            return null;
        }
        return snapshot;
    } catch (error) {
        console.warn('[WaliKelas] Cache rombel tidak valid:', error);
        sessionStorage.removeItem(key);
        return null;
    }
}

function buildWaliRombelSnapshot() {
    return {
        schemaVersion: WALI_ROMBEL_CACHE_SCHEMA_VERSION,
        cachedAt: Date.now(),
        currentClassStudents,
        currentClassAggregates,
        currentPermissionCounts,
        pendingPermisiList,
        todayAttendanceMap,
        classNotesList,
        classRecordsList,
        sppStatusMap,
        raporCatatanMap,
        walikelasNotesMap,
        guruWaliMap
    };
}

function writeWaliRombelCache(className) {
    if (!WALI_ROMBEL_CACHE_ENABLED) return;
    const key = getWaliRombelCacheKey(className);
    if (!key) return;
    try {
        const serialized = JSON.stringify(buildWaliRombelSnapshot());
        if (serialized.length > WALI_ROMBEL_CACHE_MAX_BYTES) {
            console.warn('[WaliKelas] Cache rombel dilewati: payload melebihi batas aman.');
            return;
        }
        sessionStorage.setItem(key, serialized);
    } catch (error) {
        console.warn('[WaliKelas] Gagal menyimpan cache rombel:', error);
    }
}

function applyWaliRombelSnapshot(snapshot) {
    currentClassStudents = Array.isArray(snapshot.currentClassStudents) ? snapshot.currentClassStudents : [];
    currentClassAggregates = snapshot.currentClassAggregates || {};
    currentPermissionCounts = snapshot.currentPermissionCounts || {};
    pendingPermisiList = Array.isArray(snapshot.pendingPermisiList) ? snapshot.pendingPermisiList : [];
    todayAttendanceMap = snapshot.todayAttendanceMap || {};
    classNotesList = Array.isArray(snapshot.classNotesList) ? snapshot.classNotesList : [];
    classRecordsList = Array.isArray(snapshot.classRecordsList) ? snapshot.classRecordsList : [];
    sppStatusMap = snapshot.sppStatusMap || {};
    raporCatatanMap = snapshot.raporCatatanMap || {};
    walikelasNotesMap = snapshot.walikelasNotesMap || {};
    guruWaliMap = snapshot.guruWaliMap || {};
}

function clearWaliRombelCache(className = currentRombelClass) {
    const key = getWaliRombelCacheKey(className);
    if (key) sessionStorage.removeItem(key);
}

function updateWaliCacheStatus(mode, cachedAt = null) {
    const status = document.getElementById('wali-cache-status');
    if (!status) return;
    if (mode === 'cached') {
        const time = new Date(cachedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        status.className = 'text-[9px] font-bold text-emerald-200 whitespace-nowrap';
        status.textContent = `Cache valid • ${time}`;
        return;
    }
    if (mode === 'loading') {
        status.className = 'text-[9px] font-bold text-amber-200 whitespace-nowrap';
        status.textContent = 'Memuat server...';
        return;
    }
    status.className = 'text-[9px] font-bold text-indigo-200 whitespace-nowrap';
    status.textContent = 'Data terbaru';
}


function normalizeNIS(nis) {
    if (!nis) return "";
    return String(nis).trim().replace(/^0+/, "");
}

/**
 * Helper SSOT: Resolusi hierarkis nama & nomor kontak WhatsApp Orang Tua / Wali Siswa
 * Mengintegrasikan atribut 48 kolom Dapodik (father, mother, guardian, phone_parent, dsb.)
 * Menjamin keselarasan data (0 Firestore Read)
 * @param {Object} student - Objek biodata siswa
 * @returns {Object} - { name, phone, cleanPhone, rawPhone, role, fatherName, motherName, guardianName }
 */
export function resolveStudentParent(student) {
    if (!student || typeof student !== 'object') {
        return {
            name: '-',
            phone: '-',
            cleanPhone: '',
            rawPhone: '',
            role: '',
            fatherName: '',
            motherName: '',
            guardianName: ''
        };
    }

    const sanitize = val => {
        if (val === undefined || val === null) return '';
        const s = String(val).trim();
        if (s === '' || s === '-' || s === '--' || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined') return '';
        return s;
    };

    const fatherName = sanitize(student.father || student.namaAyah || student.father_name || student.nama_ayah);
    const motherName = sanitize(student.mother || student.namaIbu || student.mother_name || student.nama_ibu);
    const guardianName = sanitize(student.guardian || student.guardian_name || student.nama_wali || student.namaWali);
    const explicitParentName = sanitize(student.name_parent || student.parentName || student.namaOrtu || student.parent_name);

    // Resolusi Nama Ortu
    let name = explicitParentName;
    if (!name) {
        if (fatherName && motherName) {
            name = `${fatherName} / ${motherName}`;
        } else if (fatherName) {
            name = `${fatherName} (Ayah)`;
        } else if (motherName) {
            name = `${motherName} (Ibu)`;
        } else if (guardianName) {
            name = `${guardianName} (Wali)`;
        } else {
            name = '-';
        }
    }

    // Resolusi Telepon Ortu (Prioritas: phone_parent -> mother_phone -> father_phone -> guardian_phone)
    const explicitPhone = sanitize(student.phone_parent || student.parentPhone || student.hpOrtu || student.parent_phone);
    const motherPhone = sanitize(student.mother_phone || student.phone_mother || student.hpIbu);
    const fatherPhone = sanitize(student.father_phone || student.phone_father || student.hpAyah);
    const guardianPhone = sanitize(student.guardian_phone || student.phone_wali || student.hpWali);

    let rawPhone = '';
    let role = '';

    if (explicitPhone) {
        rawPhone = explicitPhone;
        role = 'Ortu';
    } else if (motherPhone) {
        rawPhone = motherPhone;
        role = 'Ibu';
    } else if (fatherPhone) {
        rawPhone = fatherPhone;
        role = 'Ayah';
    } else if (guardianPhone) {
        rawPhone = guardianPhone;
        role = 'Wali';
    }

    // Format cleanPhone untuk WhatsApp link (standar Indonesia: 628...)
    let cleanPhone = rawPhone.replace(/[^0-9]/g, '');
    if (cleanPhone.startsWith('0')) {
        cleanPhone = '62' + cleanPhone.slice(1);
    } else if (cleanPhone.startsWith('8')) {
        cleanPhone = '628' + cleanPhone.slice(1);
    }

    const isValidPhone = cleanPhone.length >= 9 && cleanPhone.startsWith('62');

    return {
        name: name || '-',
        phone: rawPhone || '-',
        cleanPhone: isValidPhone ? cleanPhone : '',
        rawPhone: rawPhone,
        role: role,
        fatherName,
        motherName,
        guardianName
    };
}
if (typeof window !== 'undefined') {
    window.resolveStudentParent = resolveStudentParent;
}


function isMonthPaid(paymentHistory, year, month, dueDate) {
    const key = `${year}-${month}`;
    const data = paymentHistory ? paymentHistory[key] : null;

    if (data) {
        if (data.type === 'manual_debt') return false;
        return true;
    }

    const actualDueDate = dueDate || detailSppDueDate || 20;
    const itemDate = new Date(year, month - 1, actualDueDate);
    if (itemDate < SYSTEM_START_DATE) return true;

    return false;
}

let financeRatesCache = null;

async function getFinanceRatesWithCache() {
    if (financeRatesCache) return financeRatesCache;
    try {
        const data = await window.getFinanceRatesCache();
        if (data && Object.keys(data).length > 0) {
            financeRatesCache = data;
            return financeRatesCache;
        }
    } catch (e) {
        console.warn("[WaliKelas] Gagal load finance_rates:", e);
    }
    return { X: 70000, XI: 65000, XII: 65000 };
}

onAuthStateChanged(auth, async (user) => {
    if (window.location.hostname === '127.0.0.1' && window.location.search.includes('mock=true')) {
        console.log('[WaliKelas] Mode Mock UI aktif untuk verifikasi lokal.');
        return;
    }

    if (!user) {
        window.location.href = 'index.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
        return;
    }

    try {
        let currentUserData = {};
        try {
            const cachedUserDoc = await window.getCurrentUserDoc();
            if (cachedUserDoc) {
                currentUserData = cachedUserDoc;
                currentUserProfile = currentUserData || {};
                if (currentUserData.assignedClass) {
                    localStorage.setItem('user_assigned_class', currentUserData.assignedClass);
                }
            }
        } catch (errUser) {
            console.warn('[WaliKelas] Error fetching user profile:', errUser);
        }

        const role = currentUserData.role || localStorage.getItem('user_role');
        const effectiveRole = window.getEffectiveRoleForPage ? window.getEffectiveRoleForPage('wali-kelas.html') : (role || 'wali_kelas');
        await initLayout(effectiveRole);

        // Unhide main content after layout initialization
        const mainEl = document.querySelector('main');
        if (mainEl) mainEl.classList.remove('hidden');

        ewsWeights = await SimasEWS.getWeights();
        await setupClassDropdown(user, currentUserData);
        setupEventListeners();
    } catch (e) {
        console.error('[WaliKelas] Initialization error:', e);
        showToast('Error', 'Gagal menginisialisasi Portal Wali Kelas', 'error');
    }
});

/**
 * Setup Rombel Class Selector & Role-based Visibility
 */
async function setupClassDropdown(user, currentUserData = {}) {
    const selectEl = document.getElementById('select-rombel-class');
    const selectorContainer = document.getElementById('rombel-selector-container');
    const assignedBadge = document.getElementById('rombel-assigned-badge');
    const waliInfoCard = document.getElementById('wali-kelas-info-card');
    const badgeClassNameEl = document.getElementById('badge-class-name');
    if (!selectEl) return;

    // Check if user has an assigned class as Wali Kelas
    const handledClass = currentUserData.assignedClass || currentUserData.handledClass || currentUserData.kelas || localStorage.getItem('user_assigned_class') || localStorage.getItem('user_handled_class') || '';

    const role = currentUserData.role || localStorage.getItem('user_role') || '';
    const allRoles = window.getAllUserRoles ? window.getAllUserRoles() : [role];
    const isWaliKelas = Boolean(handledClass) || allRoles.includes('wali_kelas');

    if (isWaliKelas && handledClass) {
        // Logged in user is a Wali Kelas with an assigned class:
        // Hide dropdown selector completely, show clean active rombel badge & auto-load class data
        if (selectorContainer) selectorContainer.classList.add('hidden');
        if (assignedBadge) {
            assignedBadge.classList.remove('hidden');
            if (badgeClassNameEl) {
                badgeClassNameEl.textContent = `Kelas ${handledClass}`;
            } else {
                assignedBadge.innerHTML = `<i class="fa-solid fa-school-flag text-indigo-300 text-sm"></i><div><p class="text-[8px] text-indigo-300 uppercase font-bold tracking-wider leading-none">Rombel Binaan Aktif</p><p class="text-xs sm:text-sm font-black text-white mt-0.5">Kelas ${escapeHTML(handledClass)}</p></div>`;
            }
        }
        if (waliInfoCard) waliInfoCard.classList.remove('hidden');

        selectEl.value = handledClass;

        // Automatically load assigned class data
        await loadRombelData(handledClass);

    } else {
        // Not a Wali Kelas (Super Admin, Inspector, Kepala Sekolah, Staff without single assigned class):
        // Allow choosing any active class from dropdown
        if (selectorContainer) selectorContainer.classList.remove('hidden');
        if (assignedBadge) assignedBadge.classList.add('hidden');
        if (waliInfoCard) waliInfoCard.classList.remove('hidden');

        selectEl.disabled = false;
        selectEl.classList.remove('cursor-not-allowed', 'opacity-85', 'bg-slate-800');
        selectEl.title = 'Pilih kelas rombel binaan';
        selectEl.innerHTML = '<option value="">-- Pilih Rombel Binaan --</option>';

        try {
            let activeClasses = [];
            if (typeof window.getActiveClasses === 'function') {
                activeClasses = await window.getActiveClasses();
            } else if (typeof window.getActiveClassesConfig === 'function') {
                const config = await window.getActiveClassesConfig();
                activeClasses = config.classes || [];
            }

            activeClasses.forEach(cls => {
                const opt = document.createElement('option');
                opt.value = cls;
                opt.textContent = `Kelas ${cls}`;
                selectEl.appendChild(opt);
            });

            selectEl.value = '';
            renderEmptyRombelState();

            selectEl.onchange = async () => {
                if (selectEl.value) {
                    await loadRombelData(selectEl.value);
                } else {
                    renderEmptyRombelState();
                }
            };

        } catch (err) {
            console.error('[WaliKelas] Failed to setup class dropdown for inspector:', err);
        }
    }
}

/**
 * Render Empty Rombel State when no class is selected (Hemat Kuota Read Firestore)
 */
function renderEmptyRombelState() {
    currentRombelClass = '';
    currentClassStudents = [];
    currentClassAggregates = {};
    currentPermissionCounts = {};
    pendingPermisiList = [];
    todayAttendanceMap = {};
    classNotesList = [];
    classRecordsList = [];
    sppStatusMap = {};
    raporCatatanMap = {};

    const waliInfoCard = document.getElementById('wali-kelas-info-card');
    if (waliInfoCard) waliInfoCard.classList.add('hidden');

    renderAllTabs();
}

function isClassMatching(studentClass, targetClass) {
    if (!studentClass || !targetClass) return false;
    const cleanS = String(studentClass).trim().toLowerCase().replace(/[-\s_]+/g, '.');
    const cleanT = String(targetClass).trim().toLowerCase().replace(/[-\s_]+/g, '.');
    return cleanS === cleanT || cleanS === `kelas.${cleanT}` || `kelas.${cleanS}` === cleanT;
}

async function loadScopedClassStudents(className) {
    try {
        // Prioritas 1: Ambil data master siswa rombel real-time dari Cloudflare D1 SQL (0 Firestore Read, SSOT status foto & Dapodik)
        if (cfClient && cfClient.enabled) {
            try {
                let cfStudents = await cfClient.getStudents({ class: className, status: 'all', limit: 150 });
                if ((!cfStudents || cfStudents.length === 0) && className) {
                    const altClass = className.includes('.') ? className.replace(/\./g, '-') : className.replace(/-/g, '.');
                    cfStudents = await cfClient.getStudents({ class: altClass, status: 'all', limit: 150 });
                }
                if (Array.isArray(cfStudents) && cfStudents.length > 0) {
                    return cfStudents;
                }
            } catch (cfErr) {
                console.warn('[WaliKelas] Query Cloudflare D1 rombel gagal, beralih ke cache lokal:', cfErr);
            }
        }

        // Prioritas 2 (Fallback): Gunakan cache siswa lokal jika Cloudflare D1 offline
        if (typeof window.getStudentsCache === 'function') {
            const allStudents = await window.getStudentsCache();
            if (Array.isArray(allStudents) && allStudents.length > 0) {
                const matched = allStudents.filter(student => isClassMatching(student.class || student.kelas, className));
                if (matched.length > 0) return matched;
            }
        }
        return [];
    } catch (error) {
        console.warn('[WaliKelas] Query siswa per rombel gagal, memakai cache global/offline:', error);
        const allStudents = typeof window.getStudentsCache === 'function'
            ? await window.getStudentsCache()
            : [];
        return allStudents.filter(student => isClassMatching(student.class || student.kelas, className));
    }
}

/**
 * Sinkronisasi status pasfoto rombel terbaru dari Cloudflare D1 SQL secara realtime (0 Firestore Read)
 */
async function syncRombelPhotoStatuses(className = currentRombelClass) {
    if (!className || !cfClient || !cfClient.enabled) return;
    try {
        let freshStudents = await cfClient.getStudents({ class: className, status: 'all', limit: 150 });
        if ((!freshStudents || freshStudents.length === 0) && className) {
            const altClass = className.includes('.') ? className.replace(/\./g, '-') : className.replace(/-/g, '.');
            freshStudents = await cfClient.getStudents({ class: altClass, status: 'all', limit: 150 });
        }
        if (!Array.isArray(freshStudents) || freshStudents.length === 0) return;

        let hasChange = false;
        freshStudents.forEach(fresh => {
            const freshNis = String(fresh.nis || fresh.id || '').trim();
            const existing = currentClassStudents.find(s => String(s.nis || s.id || '').trim() === freshNis);
            if (existing) {
                const freshActivePhoto = fresh.activePhotoUrl || fresh.active_photo_url || fresh.photoUrl || fresh.photo_url || fresh.foto || fresh.foto_url || null;
                const pendingChanged = existing.pendingPhotoUrl !== fresh.pendingPhotoUrl;
                const statusChanged = existing.photoStatus !== fresh.photoStatus;
                const activeChanged = existing.activePhotoUrl !== freshActivePhoto;
                if (pendingChanged || statusChanged || activeChanged) {
                    existing.pendingPhotoUrl = fresh.pendingPhotoUrl;
                    existing.photoStatus = fresh.photoStatus;
                    existing.activePhotoUrl = freshActivePhoto;
                    existing.photoPublicToken = fresh.photoPublicToken || fresh.cardToken || existing.photoPublicToken;
                    existing.photoRejectionReason = fresh.photoRejectionReason || existing.photoRejectionReason;
                    hasChange = true;
                }
            }
        });

        if (hasChange) {
            renderMasterStudentsTab();
            renderEwsTable();
            writeWaliRombelCache(className);
        }
    } catch (e) {
        console.warn('[WaliKelas] Silent sync status foto rombel dilewati:', e);
    }
}
window.syncRombelPhotoStatuses = syncRombelPhotoStatuses;

async function loadScopedStudentAggregates(students) {
    const studentNisList = [...new Set(students
        .map(student => String(student.nis || student.id || '').trim())
        .filter(Boolean))];
    if (studentNisList.length === 0) return [];

    try {
        const allAggregates = typeof window.getStudentAggregatesCache === 'function'
            ? await window.getStudentAggregatesCache()
            : await cfClient.getStudentAggregates();
        const allowedNis = new Set(studentNisList);
        return (allAggregates || []).filter(aggregate => allowedNis.has(String(aggregate.nis || aggregate.id || '')));
    } catch (error) {
        console.warn('[WaliKelas] Query agregat per rombel gagal, memakai cache global/offline:', error);
        return [];
    }
}

/**
 * Load complete Rombel Data (Students, Aggregates, Attendance, Permisi, Notes, SPP, Rapor)
 */
async function loadRombelData(className, { forceRefresh = false } = {}) {
    currentRombelClass = className;
    const todayDateStr = getLocalISODate();
    const cachedSnapshot = !forceRefresh ? readWaliRombelCache(className) : null;

    if (cachedSnapshot) {
        isApplyingWaliRombelCache = true;
        try {
            applyWaliRombelSnapshot(cachedSnapshot);
            renderAllTabs(true);
            updateWaliCacheStatus('cached', cachedSnapshot.cachedAt);
            updateHeaderWaliKelasInfo(className);
            return;
        } finally {
            isApplyingWaliRombelCache = false;
        }
    }

    // Reset State
    currentClassStudents = [];
    currentClassAggregates = {};
    currentPermissionCounts = {};
    pendingPermisiList = [];
    todayAttendanceMap = {};
    classNotesList = [];
    classRecordsList = [];
    sppStatusMap = {};
    raporCatatanMap = {};

    setLoadingState(true);
    updateWaliCacheStatus('loading');

    try {
        // 1. Query hanya rombel aktif; cache global tetap menjadi fallback offline.
        currentClassStudents = await loadScopedClassStudents(className);
        currentClassStudents.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        // 2. Query agregat hanya untuk NIS pada rombel aktif (maks. 30 ID per query).
        const allAggs = await loadScopedStudentAggregates(currentClassStudents);
        allAggs.forEach(agg => {
            const key = agg.nis || agg.id;
            if (key) currentClassAggregates[key] = agg;
        });

        // 3-10. Fetch all sub-data concurrently (Parallel Execution for ultra-fast load speed)
        await Promise.allSettled([
            loadTodayAttendance(className, selectedAttendanceDateIso || todayDateStr),
            loadClassAttendanceAggregates(className),
            loadPermissionData(className),
            loadClassNotes(className),
            loadClassRecordsAndPermisi(className),
            loadSppStatusSummary(className),
            loadWaliKelasNotes(className),
            loadGuruWaliAssignments(className),
            syncRombelPhotoStatuses(className),
            updateHeaderWaliKelasInfo(className)
        ]);

        // 11. Render All Tabs & Update Overview Stats. Presensi harian sudah dimuat di Promise.allSettled.
        renderAllTabs(true);
        writeWaliRombelCache(className);
        updateWaliCacheStatus('fresh');

    } catch (e) {
        console.error('[WaliKelas] Error loading rombel data:', e);
        showToast('Error', 'Gagal memuat data rombel kelas', 'error');
    } finally {
        setLoadingState(false);
    }
}

/**
 * Load Class Attendance Aggregates for Academic Year (Hadir, Sakit, Izin, Alpa, Dispen)
 */
async function loadClassAttendanceAggregates(className) {
    if (!className) return;
    try {
        const academicRange = getActiveAcademicYearRange();
        const resAbsen = await window.fetchClassAttendanceRange(className, academicRange.minDateIso, academicRange.maxDateIso);
        const rows = resAbsen.rows || [];
        if (Array.isArray(rows) && rows.length > 0) {
            currentClassAttendanceRows = rows;
        }

        const attendanceMap = {};
        rows.forEach(rec => {
            if (!rec) return;
            const nisStr = String(rec.student_nis || rec.nis || '').trim();
            if (!nisStr) return;
            if (!attendanceMap[nisStr]) {
                attendanceMap[nisStr] = { H: 0, S: 0, I: 0, A: 0, D: 0, P: 0, total: 0 };
            }
            const st = (rec.status || 'H').toString().trim();
            if (st === 'H' || st === 'Hadir') attendanceMap[nisStr].H++;
            else if (st === 'S' || st === 'Sakit') attendanceMap[nisStr].S++;
            else if (st === 'I' || st === 'Izin') attendanceMap[nisStr].I++;
            else if (st === 'A' || st === 'Alpa') attendanceMap[nisStr].A++;
            else if (st === 'D' || st === 'Dispen' || st === 'Dispensasi') attendanceMap[nisStr].D++;
            else if (['P', 'Permisi', 'DIPERBOLEHKAN'].includes(st)) attendanceMap[nisStr].P++;
            attendanceMap[nisStr].total++;
        });

        // Merge live attendance counts into currentClassAggregates
        Object.keys(attendanceMap).forEach(nis => {
            const counts = attendanceMap[nis];
            if (!currentClassAggregates[nis]) {
                currentClassAggregates[nis] = {
                    nis: nis,
                    attendance: counts,
                    alpa: counts.A,
                    izin: counts.I,
                    sakit: counts.S,
                    hadir: counts.H,
                    dispen: counts.D
                };
            } else {
                currentClassAggregates[nis].attendance = {
                    ...(currentClassAggregates[nis].attendance || {}),
                    ...counts
                };
                currentClassAggregates[nis].alpa = counts.A;
                currentClassAggregates[nis].izin = counts.I;
                currentClassAggregates[nis].sakit = counts.S;
                currentClassAggregates[nis].hadir = counts.H;
                currentClassAggregates[nis].dispen = counts.D;
            }
        });
    } catch (e) {
        console.warn('[WaliKelas] Error loading class attendance aggregates:', e);
    }
}

/**
 * Load Today's Attendance for Rombel
 */
async function loadTodayAttendance(className, todayDateStr) {
    todayAttendanceMap = {};
    if (!className || !todayDateStr) return;
    try {
        const attRes = await window.fetchClassAttendance(className, todayDateStr);
        if (attRes && attRes.exists && attRes.records) {
            Object.values(attRes.records).forEach(rec => {
                const nis = String(rec.nis || '').trim();
                if (nis) {
                    let rawStatus = (rec.status || 'H').toString().trim();
                    let statusLabel = 'Hadir';
                    if (rawStatus === 'H' || rawStatus === 'Hadir') statusLabel = 'Hadir';
                    else if (rawStatus === 'S' || rawStatus === 'Sakit') statusLabel = 'Sakit';
                    else if (rawStatus === 'I' || rawStatus === 'Izin') statusLabel = 'Izin';
                    else if (rawStatus === 'A' || rawStatus === 'Alpa') statusLabel = 'Alpa';
                    else if (rawStatus === 'D' || rawStatus === 'Dispen' || rawStatus === 'Dispensasi') statusLabel = 'Dispensasi';
                    else if (['P', 'Permisi', 'DIPERBOLEHKAN'].includes(rawStatus)) statusLabel = 'Permisi';

                    todayAttendanceMap[nis] = {
                        status: statusLabel,
                        notes: rec.note || rec.notes || ''
                    };
                }
            });
        }

        // Integrasi Permisi 2 Tahap (permisi_requests Cloudflare D1): Cek permohonan permisi online tanggal ini
        try {
            if (cfClient && cfClient.enabled) {
                const permisiList = await cfClient.getPermisiRequests({
                    class: className,
                    date: todayDateStr
                });

                if (Array.isArray(permisiList)) {
                    permisiList.forEach(d => {
                        const nis = String(d.student_nis || d.studentNIS || d.nis || '').trim();
                        if (!nis) return;

                        const statusLower = (d.status || '').toLowerCase();
                        const isApproved = ['approved', 'wali_approved'].includes(statusLower);
                        const isPending = ['pending_wali', 'pending'].includes(statusLower);
                        const reason = d.reason || d.permission_type || 'Permisi 2 Tahap';

                        if (isApproved) {
                            if (!todayAttendanceMap[nis] || todayAttendanceMap[nis].status === 'Hadir' || todayAttendanceMap[nis].status === 'Belum Diisi') {
                                todayAttendanceMap[nis] = {
                                    status: 'Permisi',
                                    notes: `${reason} (Disetujui)`
                                };
                            }
                        } else if (isPending) {
                            if (!todayAttendanceMap[nis] || todayAttendanceMap[nis].status === 'Belum Diisi') {
                                todayAttendanceMap[nis] = {
                                    status: 'Permisi (Pending)',
                                    notes: `${reason} (Menunggu Persetujuan)`
                                };
                            }
                        }
                    });
                }
            }
        } catch (errPerm) {
            console.warn('[WaliKelas] Check permisi_requests for today grid error from D1:', errPerm.message);
        }

        // Integrasi Catatan Permisi dari Halaman Input (records category == 'Permisi' HANYA hari ini via Cloudflare D1)
        try {
            if (cfClient && cfClient.enabled) {
                const recPermisi = await cfClient.getRecords({
                    category: 'Permisi',
                    date_start: todayDateStr,
                    date_end: todayDateStr,
                    class: className || undefined
                });
                (recPermisi || []).forEach(d => {
                    const nis = String(d.studentNIS || d.student_nis || d.studentNis || d.nis || d.studentId || '').trim();
                    if (!nis) return;

                    const studentClass = d.studentClass || d.student_class || d.class || d.className || '';
                    const isStudentInClass = currentClassStudents.some(s => String(s.nis) === nis || String(s.id) === nis);

                    if (studentClass === className || isStudentInClass || !className) {
                        const descText = d.desc || d.note || d.keterangan || 'Permisi';
                        if (!todayAttendanceMap[nis] || todayAttendanceMap[nis].status === 'Hadir' || todayAttendanceMap[nis].status === 'Belum Diisi') {
                            todayAttendanceMap[nis] = {
                                status: 'Permisi',
                                notes: descText
                            };
                        }
                    }
                });
            }
        } catch (errRec) {
            console.warn('[WaliKelas] Check records permisi from D1 error:', errRec.message);
        }
    } catch (e) {
        console.warn('[WaliKelas] Error loading today attendance:', e.message);
    }
}

let twoStepPermissionEnabled = false;
let cachedSystemConfig = null;

/**
 * Get Dynamic SPP Due Date from System Config
 */
async function getSppDueDate() {
    try {
        const configData = await window.getFinanceConfigCache();
        if (configData && configData.dueDate) {
            detailSppDueDate = Number(configData.dueDate) || 20;
        }
    } catch (e) {
        console.warn('[WaliKelas] Could not get SPP due date:', e);
    }
    return detailSppDueDate || 20;
}

/**
 * Load Permissions (Approved Counts & Pending Requests for Approval)
 */
async function loadPermissionData(className) {
    currentPermissionCounts = {};
    pendingPermisiList = [];
    twoStepPermissionEnabled = false;

    // Check system_config for twoStepPermission toggle (terpusat via getSystemConfig)
    try {
        const configData = await window.getSystemConfig();
        if (configData) {
            twoStepPermissionEnabled = configData.twoStepPermission || false;
        }
    } catch (errCfg) {
        console.warn('[WaliKelas] Could not check system_config:', errCfg);
    }

    // EARLY EXIT GUARD: Jika fitur Permisi 2 Tahap dinonaktifkan di Pengaturan, lewati kueri (0 Read)
    if (!twoStepPermissionEnabled) {
        return;
    }

    try {
        if (cfClient && cfClient.enabled) {
            const list = await cfClient.getPermisiRequests({ class: className });
            if (Array.isArray(list)) {
                list.forEach(d => {
                    const status = (d.status || '').toLowerCase();
                    const nis = String(d.student_nis || d.studentNIS || d.nis || '').trim();

                    if (['approved', 'wali_approved'].includes(status)) {
                        if (nis) currentPermissionCounts[nis] = (currentPermissionCounts[nis] || 0) + 1;
                    } else if (['pending_wali', 'pending', 'waiting'].includes(status)) {
                        pendingPermisiList.push({
                            id: d.id,
                            studentNIS: nis,
                            studentName: d.student_name,
                            studentClass: d.student_class,
                            permissionType: d.permission_type,
                            reason: d.reason,
                            requestDateStr: d.date,
                            timeOut: d.time_out,
                            timeIn: d.time_in,
                            status: d.status
                        });
                    }
                });
            }
        }
    } catch (e) {
        console.warn('[WaliKelas] Error loading permission data from D1:', e.message);
    }
}

/**
 * Helper: Parse dates from various formats (Timestamp, ISO string, milliseconds)
 */
function parseNoteDate(val) {
    if (!val) return getLocalISODate();
    if (typeof val === 'string') {
        if (val.includes('T')) return val.split('T')[0];
        return val;
    }
    if (typeof val === 'number') {
        return new Date(val).toISOString().split('T')[0];
    }
    if (val.toDate && typeof val.toDate === 'function') {
        return val.toDate().toISOString().split('T')[0];
    }
    if (val.seconds) {
        return new Date(val.seconds * 1000).toISOString().split('T')[0];
    }
    return getLocalISODate();
}

/**
 * Load Catatan Pembinaan Rombel (Khusus Guru Wali & Guru BK)
 */
/**
 * Load Catatan Pembinaan Rombel (Khusus Guru Wali & Guru BK)
 */
async function loadClassNotes(className) {
    classNotesList = [];
    if (!className || !Array.isArray(currentClassStudents) || currentClassStudents.length === 0) return;

    const studentMapByNis = {};
    const nisList = [];
    currentClassStudents.forEach(s => {
        if (s && s.nis) {
            const strNis = String(s.nis).trim();
            studentMapByNis[strNis] = s.name;
            nisList.push(strNis);
        }
    });

    if (nisList.length === 0) return;
    const nisSet = new Set(nisList);

    try {
        const addedIds = new Set();

        // 1. Fetch guru_wali_notes (Catatan Perwalian Wali Kelas dari Cloudflare D1)
        const fetchWaliNotes = async () => {
            const list = [];
            if (cfClient && cfClient.enabled) {
                try {
                    const rawNotes = await cfClient.getGuruWaliNotes({ class: className });
                    if (Array.isArray(rawNotes)) {
                        rawNotes.forEach(d => {
                            const nis = String(d.student_nis || d.studentNis || d.nis || '').trim();
                            if (!nisSet.has(nis)) return;

                            list.push({
                                id: d.id,
                                source: 'wali',
                                sourceLabel: 'Perwalian Guru Wali',
                                sourceBadgeClass: 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200 dark:border-blue-800',
                                sourceIcon: 'fa-user-graduate',
                                studentNis: nis,
                                studentName: d.student_name || d.studentName || studentMapByNis[nis] || '-',
                                category: d.category || 'umum',
                                title: d.title || 'Catatan Pembinaan',
                                content: d.notes || d.content || '',
                                date: d.date || getLocalISODate(),
                                authorName: d.guru_name || 'Guru Wali'
                            });
                        });
                    }
                } catch (e) {
                    console.warn(`[WaliKelas] Query guru_wali_notes from D1 error:`, e.message);
                }
            }
            return list;
        };

        // 2. Fetch bk_actions dari Cloudflare D1 (Catatan Tindakan / Konseling BK)
        const fetchBkActions = async () => {
            const list = [];

            try {
                const snap = await cfClient.getBkActions({ class: className });
                (snap || []).forEach(d => {
                    if (!addedIds.has(d.id)) {
                        const nis = String(d.studentNIS || d.student_nis || d.nis || '').trim();
                        if (!nisSet.has(nis)) return;

                        addedIds.add(d.id);
                        const problemText = d.problem ? `Permasalahan: ${d.problem}` : '';
                        const notesText = d.notes || d.tindakan || d.content || '';
                        const fullContent = [problemText, notesText ? `Tindakan/Catatan: ${notesText}` : ''].filter(Boolean).join(' | ');
                        const counselor = d.counselorName || d.counselor_name || d.guruBkName || d.createdByName || d.author || 'Guru BK';

                        list.push({
                            id: d.id,
                            source: 'bk',
                            sourceLabel: 'Bimbingan Konseling (BK)',
                            sourceBadgeClass: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
                            sourceIcon: 'fa-user-shield',
                            studentNis: nis,
                            studentName: d.studentName || d.student_name || d.nama || studentMapByNis[nis] || '-',
                            category: 'karakter',
                            title: `Layanan BK: ${d.serviceType || d.service_type || 'Konseling'} (${d.status || 'Aktif'})`,
                            content: fullContent || 'Catatan layanan bimbingan konseling.',
                            date: parseNoteDate(d.date || d.createdAt || d.timestamp),
                            author: counselor
                        });
                    }
                });
            } catch (e) {
                console.warn(`[WaliKelas] Query bk_actions error:`, e.message);
            }
            return list;
        };

        const results = await Promise.allSettled([
            fetchWaliNotes(),
            fetchBkActions()
        ]);

        results.forEach(res => {
            if (res.status === 'fulfilled' && Array.isArray(res.value)) {
                classNotesList.push(...res.value);
            }
        });

        // Sort desc by date
        classNotesList.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    } catch (e) {
        console.error('[WaliKelas] Error loading class notes:', e);
    }
}

/**
 * Load Catatan Pelanggaran, Prestasi, dan Riwayat Permisi (Untuk Sub-Tab 2 di Tab Poin & Perilaku)
 */
async function loadClassRecordsAndPermisi(className) {
    classRecordsList = [];
    if (!className || !Array.isArray(currentClassStudents) || currentClassStudents.length === 0) return;

    const studentMapByNis = {};
    const nisList = [];
    currentClassStudents.forEach(s => {
        if (s && s.nis) {
            const strNis = String(s.nis).trim();
            studentMapByNis[strNis] = s.name;
            nisList.push(strNis);
        }
    });

    if (nisList.length === 0) return;
    const nisSet = new Set(nisList);

    try {
        const addedIds = new Set();        // 1. Fetch records (Catatan Pelanggaran & Prestasi)
        const fetchRecords = async () => {
            const list = [];

            try {
                if (cfClient && cfClient.enabled) {
                    const cfRecList = await cfClient.getRecords({ class: className, limit: 300 });
                    (cfRecList || []).forEach(d => {
                        const recId = String(d.id || `${d.student_nis}_${d.date}`);
                        if (!addedIds.has(recId)) {
                            const nis = String(d.student_nis || d.studentNIS || d.nis || '').trim();
                            if (!nisSet.has(nis)) return;

                            addedIds.add(recId);
                            const catStr = String(d.category || d.type || '').toLowerCase();
                            const isPelanggaran = catStr.includes('pelanggaran') || catStr.includes('violation') || (d.points && Number(d.points) > 0);
                            const isPrestasi = catStr.includes('prestasi') || catStr.includes('achievement');

                            let type = isPelanggaran ? 'pelanggaran' : (isPrestasi ? 'prestasi' : 'catatan');
                            let badgeClass = 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800';
                            let icon = 'fa-clipboard-check';
                            if (isPelanggaran) {
                                badgeClass = 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border-rose-200 dark:border-rose-800';
                                icon = 'fa-triangle-exclamation';
                            } else if (isPrestasi) {
                                badgeClass = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
                                icon = 'fa-trophy';
                            }

                            const pointsInfo = d.points ? ` [${isPelanggaran ? '-' : '+'}${d.points} Poin]` : '';
                            const catName = isPelanggaran ? 'Pelanggaran' : (isPrestasi ? 'Prestasi' : (d.category || 'Kedisiplinan'));

                            list.push({
                                id: recId,
                                type: type,
                                typeLabel: `${catName}${pointsInfo}`,
                                typeBadgeClass: badgeClass,
                                icon: icon,
                                studentNis: nis,
                                studentName: d.student_name || d.studentName || d.nama || studentMapByNis[nis] || '-',
                                title: d.title || d.violation_name || d.violationName || d.desc || `${catName}${pointsInfo}`,
                                content: d.notes || d.description || d.desc || d.keterangan || '-',
                                date: parseNoteDate(d.date || d.tanggal || d.created_at || d.timestamp),
                                rawDate: d.date || d.tanggal || d.created_at || d.timestamp || '',
                                points: Number(d.points || d.point || 0),
                                author: d.reporter_name || d.reporterName || d.created_by || 'Guru / Tim Kedisiplinan'
                            });
                        }
                    });
                }
            } catch (e) {
                console.warn(`[WaliKelas] Query records from D1 error:`, e.message);
            }

            return list;
        };

        // 2. Fetch permisiRequests dari Cloudflare D1 (Riwayat Surat Permisi)
        const fetchPermisi = async () => {
            const list = [];
            if (cfClient && cfClient.enabled) {
                try {
                    const snap = await cfClient.getPermisiRequests({ class: className });
                    (snap || []).forEach(d => {
                        if (!addedIds.has(d.id)) {
                            const nis = String(d.student_nis || d.studentNIS || d.nis || '').trim();
                            if (!nisSet.has(nis)) return;

                            addedIds.add(d.id);
                            const permType = d.permission_type || d.permisiType || 'Permisi';
                            const status = (d.status || 'approved').toUpperCase();

                            list.push({
                                id: d.id,
                                type: 'permisi',
                                typeLabel: `Surat Permisi (${permType})`,
                                typeBadgeClass: 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200 dark:border-blue-800',
                                icon: 'fa-envelope-open-text',
                                studentNis: nis,
                                studentName: d.student_name || studentMapByNis[nis] || '-',
                                title: `Permisi: ${permType} [Status: ${status}]`,
                                content: `Alasan: ${d.reason || '-'}${d.wali_approved_by ? ` | Disetujui: ${d.wali_approved_by}` : ''}`,
                                date: d.date || getLocalISODate(),
                                rawDate: d.date || '',
                                points: 0,
                                author: d.student_name || 'Pengajuan Siswa'
                            });
                        }
                    });
                } catch (e) {
                    console.warn(`[WaliKelas] Query permisi_requests from D1 by class error:`, e.message);
                }
            }
            return list;
        };

        const results = await Promise.allSettled([
            fetchRecords(),
            fetchPermisi()
        ]);

        results.forEach(res => {
            if (res.status === 'fulfilled' && Array.isArray(res.value)) {
                classRecordsList.push(...res.value);
            }
        });

        classRecordsList.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    } catch (e) {
        console.error('[WaliKelas] Error loading class records & permisi:', e);
    }
}

/**
 * Helper SSOT: Memastikan Catatan Records Siswa (Pelanggaran & Prestasi) Terload Sempurna (Anti Race Condition & 0 Firestore Read)
 * Mengambil langsung dari Cloudflare D1 berbasis NIS jika belum termuat di memori, dan mensinkronisasikan ke classRecordsList.
 */
async function ensureStudentRecords(studentOrNis, { forceLive = false } = {}) {
    const nis = typeof studentOrNis === 'object' && studentOrNis !== null ? (studentOrNis.nis || studentOrNis.id) : studentOrNis;
    const cleanNis = String(nis || '').trim();
    if (!cleanNis) return [];

    const studentObj = (typeof studentOrNis === 'object' && studentOrNis !== null)
        ? studentOrNis
        : (currentClassStudents.find(s => String(s.nis).trim() === cleanNis || String(s.id).trim() === cleanNis) || activePrintStudent || activeStudentForDetail);

    const agg = currentClassAggregates[cleanNis] || {};
    const aggPoints = Number(agg.totalPoints ?? agg.poinPelanggaran ?? agg.points ?? agg.poin ?? 0);

    // 1. Cek apakah di memory sudah ada records untuk siswa ini
    const existingInMemory = (Array.isArray(classRecordsList) ? classRecordsList : [])
        .filter(r => String(r.studentNis).trim() === cleanNis);

    const existingStudentRecords = (studentObj && Array.isArray(studentObj.records) && studentObj.records.length > 0)
        ? studentObj.records
        : null;

    // Jika sudah ada records di memori siswa dan sesuai agregat (atau agregat 0), gunakan cache
    if (!forceLive && existingStudentRecords && (aggPoints === 0 || existingStudentRecords.some(r => r.type === 'pelanggaran' || r.category === 'Pelanggaran' || (r.points && Number(r.points) > 0)))) {
        return existingStudentRecords;
    }

    if (!forceLive && existingInMemory.length > 0 && (aggPoints === 0 || existingInMemory.some(r => r.type === 'pelanggaran' || (r.points && Number(r.points) > 0)))) {
        const mapped = existingInMemory.map(r => ({
            id: r.id,
            type: r.type,
            category: r.type === 'prestasi' ? 'Prestasi' : (r.type === 'pelanggaran' ? 'Pelanggaran' : (r.type === 'permisi' ? 'Permisi' : 'Catatan')),
            desc: r.title || r.content || r.desc || '',
            title: r.title || '',
            points: Number(r.points || 0),
            notes: r.content || r.notes || '',
            date: r.date || r.rawDate || '',
            dateObj: (r.dateObj instanceof Date && !isNaN(r.dateObj)) ? r.dateObj : (r.date ? new Date(r.date) : (r.rawDate ? new Date(r.rawDate) : new Date()))
        }));
        if (studentObj) {
            studentObj.records = mapped;
            studentObj._recordsLoaded = true;
        }
        return mapped;
    }

    // 2. Fetch live records by NIS from Cloudflare D1 SQL (0 Firestore Read)
    let fetchedRecords = [];
    try {
        if (cfClient && cfClient.enabled) {
            const raw = await cfClient.getRecords({ nis: cleanNis, limit: 100 });
            if (Array.isArray(raw)) {
                fetchedRecords = raw;
            }
        }
    } catch (errFetch) {
        console.warn(`[WaliKelas] Kueri live records by NIS (${cleanNis}) notice:`, errFetch.message || errFetch);
    }

    // 3. Normalisasi hasil kueri D1
    const normalized = fetchedRecords.map(d => {
        const recId = String(d.id || `${cleanNis}_${d.date || Date.now()}`);
        const catStr = String(d.category || d.type || '').toLowerCase();
        const isPelanggaran = catStr.includes('pelanggaran') || catStr.includes('violation') || (d.points && Number(d.points) > 0);
        const isPrestasi = catStr.includes('prestasi') || catStr.includes('achievement');
        const isPermisi = catStr.includes('permisi') || catStr.includes('permission');

        let type = isPelanggaran ? 'pelanggaran' : (isPrestasi ? 'prestasi' : (isPermisi ? 'permisi' : 'catatan'));
        let catName = isPelanggaran ? 'Pelanggaran' : (isPrestasi ? 'Prestasi' : (isPermisi ? 'Permisi' : (d.category || 'Kedisiplinan')));
        let points = Number(d.points || d.point || 0);
        let badgeClass = isPelanggaran
            ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border-rose-200 dark:border-rose-800'
            : (isPrestasi
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                : 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800');
        let icon = isPelanggaran ? 'fa-triangle-exclamation' : (isPrestasi ? 'fa-trophy' : 'fa-clipboard-check');
        const pointsInfo = points > 0 ? ` [${isPelanggaran ? '-' : '+'}${points} Poin]` : '';
        const dateStr = parseNoteDate(d.date || d.tanggal || d.created_at || d.timestamp || d.timestampIso);

        return {
            id: recId,
            type: type,
            category: catName,
            typeLabel: `${catName}${pointsInfo}`,
            typeBadgeClass: badgeClass,
            icon: icon,
            studentNis: cleanNis,
            studentName: d.studentName || d.student_name || studentObj?.name || '-',
            title: d.title || d.violation_name || d.violationName || d.desc || `${catName}${pointsInfo}`,
            desc: d.desc || d.description || d.title || d.notes || d.keterangan || '',
            content: d.notes || d.description || d.desc || d.keterangan || '-',
            notes: d.notes || d.description || d.desc || d.keterangan || '',
            points: points,
            date: dateStr,
            rawDate: d.date || d.tanggal || d.created_at || d.timestamp || '',
            dateObj: dateStr ? new Date(dateStr) : new Date(),
            author: d.reporter_name || d.reporterName || d.created_by || 'Guru / Tim Kedisiplinan'
        };
    });

    // 4. Sinkronisasikan / Upsert ke classRecordsList di memori
    if (!Array.isArray(classRecordsList)) classRecordsList = [];
    const existingIds = new Set(classRecordsList.map(r => String(r.id)));
    normalized.forEach(item => {
        if (!existingIds.has(String(item.id))) {
            classRecordsList.push(item);
            existingIds.add(String(item.id));
        }
    });

    const mappedForStudent = normalized.map(r => ({
        id: r.id,
        type: r.type,
        category: r.category,
        desc: r.title || r.content || r.desc || '',
        title: r.title || '',
        points: Number(r.points || 0),
        notes: r.content || r.notes || '',
        date: r.date || r.rawDate || '',
        dateObj: (r.dateObj instanceof Date && !isNaN(r.dateObj)) ? r.dateObj : (r.date ? new Date(r.date) : new Date())
    }));

    if (studentObj) {
        studentObj.records = mappedForStudent;
        studentObj._recordsLoaded = true;
    }

    return mappedForStudent;
}
window.ensureStudentRecords = ensureStudentRecords;

/**
 * Load SPP Payment Status for Rombel
 */
async function loadSppStatusSummary(className) {
    sppStatusMap = {};
    if (!currentClassStudents || currentClassStudents.length === 0) return;

    try {
        const uniqueNISValues = new Set();
        currentClassStudents.forEach(student => {
            if (!student || !student.nis) return;
            const str = String(student.nis).trim();
            if (str) {
                uniqueNISValues.add(str);
                const norm = normalizeNIS(str);
                if (norm) uniqueNISValues.add(norm);
                const padded = str.padStart(4, '0');
                if (padded) uniqueNISValues.add(padded);
            }
        });

        const cleanNisArray = Array.from(uniqueNISValues);
        if (cleanNisArray.length === 0) return;

        initSupabase();
        if (!supabase) throw new Error('Supabase client belum siap');

        const { data, error } = await window.fetchAllSupabaseRows(
            supabase,
            'finance_transactions',
            q => q.in('student_nis', cleanNisArray),
            { selectFields: 'id, transaction_id, student_nis, year, month, amount, type, notes, payment_date, date_str, payment_method, teller_name' }
        );

        if (error) {
            console.error('[WaliKelas] Error loadSppSummary Supabase:', error);
            throw error;
        }

        if (data) {
            data.forEach(d => {
                const rawNis = String(d.student_nis || '').trim();
                const normNis = normalizeNIS(rawNis);
                const keys = Array.from(new Set([rawNis, normNis, rawNis.padStart(4, '0')].filter(Boolean)));

                keys.forEach(keyNis => {
                    if (!sppStatusMap[keyNis]) {
                        sppStatusMap[keyNis] = { paidMonths: [], totalPaid: 0, paymentHistory: {} };
                    }
                    if (d.month && d.type !== 'manual_debt') {
                        if (!sppStatusMap[keyNis].paidMonths.includes(d.month)) {
                            sppStatusMap[keyNis].paidMonths.push(d.month);
                        }
                    }
                    sppStatusMap[keyNis].totalPaid += (Number(d.amount) || 0);

                    if (d.year && d.month) {
                        const key = `${d.year}-${d.month}`;
                        sppStatusMap[keyNis].paymentHistory[key] = {
                            id: d.id,
                            transactionId: d.transaction_id || d.id,
                            amount: Number(d.amount) || 0,
                            type: d.type || 'paid',
                            note: d.notes || '',
                            paymentDate: d.payment_date ? new Date(d.payment_date) : null,
                            dateStr: d.date_str || '',
                            paymentMethod: d.payment_method || 'Tunai',
                            tellerName: d.teller_name || ''
                        };
                    }
                });
            });
        }
    } catch (e) {
        console.warn('[WaliKelas] Error loading SPP summary:', e.message);
    }
}

let walikelasNotesMap = {};

/**
 * Load Catatan Wali Kelas per Semester (koleksi walikelas_notes Cloudflare D1)
 */
async function loadWaliKelasNotes(className) {
    walikelasNotesMap = {};
    try {
        const yearFilter = document.getElementById('tab-rapor-year-filter')?.value || '2026/2027';
        const semFilter = document.getElementById('tab-rapor-semester-filter')?.value || '1';

        if (cfClient && cfClient.enabled) {
            const queryPayload = {
                class: className,
                ta: yearFilter
            };
            // Jika filter adalah 1 Tahun Ajaran (TA / FULL / ALL), jangan batasi parameter semester agar seluruh catatan TA terambil
            if (semFilter !== 'TA' && semFilter !== 'FULL' && semFilter !== 'ALL') {
                queryPayload.semester = semFilter;
            }
            const notes = await cfClient.getWalikelasNotes(queryPayload);

            if (Array.isArray(notes)) {
                notes.forEach(d => {
                    const nis = String(d.student_nis || d.nis || '').trim();
                    const noteContent = d.notes || d.catatanWaliKelas || d.academic_notes || '';
                    if (!nis || !noteContent) return;

                    if (semFilter === 'TA' || semFilter === 'FULL' || semFilter === 'ALL') {
                        // Prioritas untuk 1 Tahun Ajaran: catatan khusus TA > catatan sem 2 > catatan sem 1
                        if (d.semester === 'TA' || d.semester === 'FULL') {
                            walikelasNotesMap[nis] = noteContent;
                        } else if (!walikelasNotesMap[nis] || d.semester === '2') {
                            walikelasNotesMap[nis] = noteContent;
                        }
                    } else {
                        walikelasNotesMap[nis] = noteContent;
                    }
                });
            }
        }
    } catch (e) {
        console.warn('[WaliKelas] Error loading walikelas_notes from D1:', e.message);
    }
}

window.onTabRaporFilterChange = async function () {
    if (currentRombelClass) {
        await loadWaliKelasNotes(currentRombelClass);
        renderRaporTab();
    }
};

let guruWaliMap = {};

/**
 * Load Guru Wali Assignments for Rombel
 */
async function loadGuruWaliAssignments(className) {
    guruWaliMap = {};
    if (!currentClassStudents || currentClassStudents.length === 0) return;

    try {
        if (cfClient && cfClient.enabled) {
            const targetClass = className || currentRombelClass || '';
            let assignList = await cfClient.getGuruWaliAssignments({ class: targetClass });

            // Fallback: Jika pemanggilan kelas spesifik kosong, coba variasi format kelas (misal X.1 vs X-1)
            if ((!assignList || assignList.length === 0) && targetClass) {
                const altClass = targetClass.includes('.') ? targetClass.replace(/\./g, '-') : targetClass.replace(/-/g, '.');
                assignList = await cfClient.getGuruWaliAssignments({ class: altClass });
            }

            (assignList || []).forEach(d => {
                const nisStr = String(d.student_nis || d.studentNis || d.nis || '').trim();
                const teacherName = d.guru_name || d.guruName || '';
                if (nisStr && teacherName) {
                    guruWaliMap[nisStr] = teacherName;
                    const num = Number(nisStr);
                    if (Number.isFinite(num)) guruWaliMap[num] = teacherName;
                }
            });
        }
    } catch (e) {
        console.warn('[WaliKelas] Error loading guru wali assignments:', e.message);
    }
}

/**
 * Update Header Wali Kelas Assigned Info Card
 */
async function updateHeaderWaliKelasInfo(className) {
    const waliInfoCard = document.getElementById('wali-kelas-info-card');
    if (!waliInfoCard) return;

    if (!className) {
        waliInfoCard.classList.add('hidden');
        return;
    }

    const nameEl = document.getElementById('header-wali-name');
    const subEl = document.getElementById('header-wali-sub');
    const contactEl = document.getElementById('header-wali-contact');

    try {
        // Tampilkan kartu dan bersihkan nama lama segera agar tidak tertinggal data kelas sebelumnya
        waliInfoCard.classList.remove('hidden');
        if (nameEl) nameEl.textContent = 'Memuat Data Wali...';
        if (subEl) subEl.innerHTML = `<div>Kelas ${window.escapeHTML ? window.escapeHTML(className) : className}</div>`;
        if (contactEl) contactEl.innerHTML = '';

        let waliData = (typeof window.getWaliKelasByClass === 'function')
            ? await window.getWaliKelasByClass(className)
            : null;

        const currentUserUid = auth.currentUser?.uid;
        const currentUserEmail = auth.currentUser?.email;

        // If the Wali Kelas of this class is the logged-in user, hide the card (they manage their own class)
        const isMyOwnClass = waliData && (
            (currentUserUid && waliData.uid === currentUserUid) ||
            (currentUserEmail && waliData.email && waliData.email.toLowerCase() === currentUserEmail.toLowerCase())
        );

        if (isMyOwnClass) {
            waliInfoCard.classList.add('hidden');
            return;
        }

        if (!waliData) {
            // Tetap tampilkan informasi informatif bahwa kelas ini belum ada wali kelas terdaftar
            waliInfoCard.classList.remove('hidden');
            if (nameEl) nameEl.textContent = 'Belum Ditetapkan';
            if (subEl) subEl.innerHTML = `<div>Wali Kelas ${window.escapeHTML ? window.escapeHTML(className) : className} belum terdaftar di sistem</div>`;
            if (contactEl) {
                contactEl.innerHTML = `<span class="px-2.5 py-1 bg-white/10 text-indigo-200 rounded-lg text-[10px] font-medium">Belum Ada Kontak</span>`;
            }
            return;
        }

        // Only show for Inspector / Super Admin viewing someone else's class
        waliInfoCard.classList.remove('hidden');

        if (nameEl) nameEl.textContent = waliData.name || 'Wali Kelas';
        if (subEl) {
            const nipStr = waliData.nip ? `NIP: ${waliData.nip}` : 'NIP: -';
            const emailStr = waliData.email ? `Email: ${waliData.email}` : 'Email: -';
            subEl.innerHTML = `
                <div>${window.escapeHTML ? window.escapeHTML(nipStr) : nipStr}</div>
                <div class="truncate max-w-[220px]" title="${window.escapeHTML ? window.escapeHTML(waliData.email || '') : (waliData.email || '')}">${window.escapeHTML ? window.escapeHTML(emailStr) : emailStr}</div>
            `;
        }

        if (contactEl) {
            if (waliData.phone) {
                let cleanPhone = waliData.phone.replace(/[^0-9]/g, '');
                if (cleanPhone.startsWith('0')) cleanPhone = '62' + cleanPhone.slice(1);
                contactEl.innerHTML = `
                    <a href="https://wa.me/${cleanPhone}" target="_blank" class="px-3 py-1.5 bg-emerald-500/80 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg shadow transition inline-flex items-center gap-1.5">
                        <i class="fa-brands fa-whatsapp text-sm"></i> Kontak WA Wali
                    </a>
                `;
            } else {
                contactEl.innerHTML = `<span class="px-2.5 py-1 bg-white/10 text-indigo-200 rounded-lg text-[10px] font-medium">No. HP Belum Ada</span>`;
            }
        }
    } catch (e) {
        console.warn('[WaliKelas] Failed to fetch wali kelas info:', e);
        if (nameEl) nameEl.textContent = 'Wali Kelas';
        if (subEl) subEl.innerHTML = `<div>Kelas ${window.escapeHTML ? window.escapeHTML(className) : className}</div>`;
    }
}

/**
 * Render All Tabs and Overview Cards
 */
function renderAllTabs(useCachedAttendance = false) {
    renderOverviewStats();
    renderEwsTable();
    renderAttendanceTab(useCachedAttendance);
    renderPendingPermisi();
    renderPointsTab();
    renderNotesTab();
    renderSppTab();
    renderMasterStudentsTab();
    renderPerpusTab();
    renderRaporTab();

    const jurnalBtn = document.getElementById('tab-btn-jurnal');
    if (jurnalBtn && jurnalBtn.classList.contains('active')) {
        renderWeeklyJurnalTab('tab-content-jurnal', currentRombelClass, null, false);
    }
}

/**
 * Render 4 Overview Stat Cards
 */
function renderOverviewStats() {
    if (!currentRombelClass) {
        document.getElementById('stat-total-students').textContent = '0';
        document.getElementById('stat-gender-ratio').textContent = 'L: 0 | P: 0';
        document.getElementById('stat-today-attendance').textContent = '--';
        document.getElementById('stat-today-detail').textContent = 'Silakan pilih Rombel Binaan';
        document.getElementById('stat-high-risk').textContent = '0 Siswa';
        document.getElementById('stat-risk-summary').textContent = 'Sedang: 0 | Aman: 0';
        document.getElementById('stat-total-notes').textContent = '0';
        return;
    }

    const totalStudents = currentClassStudents.length;
    let maleCount = 0;
    let femaleCount = 0;
    currentClassStudents.forEach(s => {
        const g = (s.gender || s.jenisKelamin || '').toUpperCase();
        if (g === 'L' || g.startsWith('LAK')) maleCount++;
        else if (g === 'P' || g.startsWith('PER')) femaleCount++;
    });

    // Today Attendance Stats
    // Check if attendance was inputted by Admin Kelas today
    const hasTodayAttendance = Object.keys(todayAttendanceMap).length > 0;

    let hadir = 0, sakit = 0, izin = 0, alpa = 0;
    if (hasTodayAttendance) {
        currentClassStudents.forEach(s => {
            const studentNis = String(s.nis || s.id || '').trim();
            const att = todayAttendanceMap[studentNis] || todayAttendanceMap[s.nis];
            const st = att ? att.status : 'Hadir';
            if (st === 'Hadir') hadir++;
            else if (st === 'Sakit') sakit++;
            else if (st === 'Izin') izin++;
            else if (st === 'Alpa') alpa++;
            else hadir++;
        });
    }

    const attPercentage = (hasTodayAttendance && totalStudents > 0) ? Math.round((hadir / totalStudents) * 100) : 0;

    // EWS Risk Stats
    let highRisk = 0, mediumRisk = 0, lowRisk = 0;
    currentClassStudents.forEach(s => {
        const nisKey = String(s.nis || s.id || '').trim();
        const agg = currentClassAggregates[nisKey] || currentClassAggregates[s.nis] || {};
        const permisi = currentPermissionCounts[nisKey] || currentPermissionCounts[s.nis] || 0;
        const res = SimasEWS.calculateStudentRisk(s, agg, permisi, ewsWeights);
        if (res.level === 'high') highRisk++;
        else if (res.level === 'medium') mediumRisk++;
        else lowRisk++;
    });

    document.getElementById('stat-total-students').textContent = totalStudents;
    document.getElementById('stat-gender-ratio').textContent = `L: ${maleCount} | P: ${femaleCount}`;

    if (hasTodayAttendance) {
        document.getElementById('stat-today-attendance').textContent = `${attPercentage}%`;
        document.getElementById('stat-today-detail').textContent = `H: ${hadir} | I: ${izin} | S: ${sakit} | A: ${alpa}`;
    } else {
        document.getElementById('stat-today-attendance').textContent = `Belum Diisi`;
        document.getElementById('stat-today-detail').textContent = `Admin kelas belum input presensi`;
    }

    document.getElementById('stat-high-risk').textContent = `${highRisk} Siswa`;
    document.getElementById('stat-risk-summary').textContent = `Sedang: ${mediumRisk} | Aman: ${lowRisk}`;

    document.getElementById('stat-total-notes').textContent = classNotesList.length;
}

let currentEwsSort = { column: 'name', order: 'asc' };
window.currentEwsSort = currentEwsSort;

/**
 * Update Icon Sort Indikator Header Tabel EWS
 */
function updateEwsSortIcons() {
    const sortableCols = ['no', 'name', 'alpa', 'points', 'permisi', 'score', 'level'];
    const { column, order } = currentEwsSort;
    const isAsc = order === 'asc';

    sortableCols.forEach(col => {
        const icon = document.getElementById(`sort-icon-ews-${col}`);
        if (!icon) return;
        icon.className = 'ml-1 text-[10px] fa-solid';
        if (col === column) {
            icon.classList.add(isAsc ? 'fa-sort-up' : 'fa-sort-down', 'text-indigo-600', 'dark:text-indigo-400');
        } else {
            icon.classList.add('fa-sort', 'text-slate-300', 'dark:text-slate-600');
        }
    });
}
window.updateEwsSortIcons = updateEwsSortIcons;

/**
 * Handle Klik Header Kolom EWS (Sort Handler)
 */
window.sortEwsTable = function (columnKey) {
    if (!currentClassStudents || currentClassStudents.length === 0) return;

    if (currentEwsSort.column === columnKey) {
        currentEwsSort.order = currentEwsSort.order === 'asc' ? 'desc' : 'asc';
    } else {
        // Kolom metrik risiko/kuantitatif (score, alpa, points, permisi, level) default desc (tertinggi/prioritas)
        const isDescByDefault = ['score', 'alpa', 'points', 'permisi', 'level'].includes(columnKey);
        currentEwsSort = {
            column: columnKey,
            order: isDescByDefault ? 'desc' : 'asc'
        };
    }
    window.currentEwsSort = currentEwsSort;
    renderEwsTable();
};

/**
 * Render Tab 1: EWS Kedisiplinan Table
 */
function renderEwsTable() {
    const tbody = document.getElementById('ews-table-body');
    if (!tbody) return;

    updateEwsSortIcons();

    if (!currentRombelClass) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="p-8 text-center text-slate-500 font-medium dark:text-slate-400">
                    <i class="fa-solid fa-hand-pointer text-indigo-500 text-2xl mb-2 block"></i>
                    Silakan pilih Rombel Binaan terlebih dahulu pada menu dropdown di atas.
                </td>
            </tr>
        `;
        return;
    }

    if (currentClassStudents.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="p-8 text-center text-slate-400 font-medium">Tidak ada siswa pada rombel ini.</td></tr>';
        return;
    }

    const searchQuery = (document.getElementById('ews-search-input')?.value || '').toLowerCase().trim();
    const riskFilter = document.getElementById('ews-filter-risk')?.value || 'all';

    // 1. Hitung risiko EWS setiap siswa & simpan nomor urut awal
    const processedStudents = currentClassStudents.map((student, originalIndex) => {
        const nisKey = String(student.nis || student.id || '').trim();
        const agg = currentClassAggregates[nisKey] || currentClassAggregates[student.nis] || {};
        const permisi = currentPermissionCounts[nisKey] || currentPermissionCounts[student.nis] || 0;
        const ewsRes = SimasEWS.calculateStudentRisk(student, agg, permisi, ewsWeights);
        return {
            student,
            originalIndex,
            ewsRes
        };
    });

    // 2. Filter data berdasarkan filter status risiko & kata kunci pencarian
    const filteredStudents = processedStudents.filter(item => {
        if (riskFilter !== 'all' && item.ewsRes.level !== riskFilter) return false;

        const matchSearch = (item.student.name || '').toLowerCase().includes(searchQuery) ||
                            (item.student.nis || '').toLowerCase().includes(searchQuery);
        return matchSearch;
    });

    if (filteredStudents.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="p-8 text-center text-slate-400 font-medium">Tidak ada data siswa yang cocok dengan filter.</td></tr>';
        return;
    }

    // 3. Pengurutan data (In-memory Sort)
    const { column, order } = currentEwsSort;
    const isAsc = order === 'asc';
    const riskLevelRank = { high: 3, medium: 2, low: 1 };

    filteredStudents.sort((a, b) => {
        if (column === 'score') {
            const scoreA = Number(a.ewsRes?.totalScore || 0);
            const scoreB = Number(b.ewsRes?.totalScore || 0);
            if (scoreA !== scoreB) {
                return isAsc ? scoreA - scoreB : scoreB - scoreA;
            }
            return (a.student.name || '').localeCompare(b.student.name || '', 'id', { numeric: true });
        } else if (column === 'alpa') {
            const alpaA = Number(a.ewsRes?.details?.alpa || 0);
            const alpaB = Number(b.ewsRes?.details?.alpa || 0);
            if (alpaA !== alpaB) {
                return isAsc ? alpaA - alpaB : alpaB - alpaA;
            }
            return (a.student.name || '').localeCompare(b.student.name || '', 'id', { numeric: true });
        } else if (column === 'points') {
            const ptsA = Number(a.ewsRes?.details?.points || 0);
            const ptsB = Number(b.ewsRes?.details?.points || 0);
            if (ptsA !== ptsB) {
                return isAsc ? ptsA - ptsB : ptsB - ptsA;
            }
            return (a.student.name || '').localeCompare(b.student.name || '', 'id', { numeric: true });
        } else if (column === 'permisi') {
            const permA = Number(a.ewsRes?.details?.permisi || 0);
            const permB = Number(b.ewsRes?.details?.permisi || 0);
            if (permA !== permB) {
                return isAsc ? permA - permB : permB - permA;
            }
            return (a.student.name || '').localeCompare(b.student.name || '', 'id', { numeric: true });
        } else if (column === 'level') {
            const rankA = riskLevelRank[a.ewsRes?.level] || 0;
            const rankB = riskLevelRank[b.ewsRes?.level] || 0;
            if (rankA !== rankB) {
                return isAsc ? rankA - rankB : rankB - rankA;
            }
            const scoreDiff = Number(b.ewsRes?.totalScore || 0) - Number(a.ewsRes?.totalScore || 0);
            if (scoreDiff !== 0) return scoreDiff;
            return (a.student.name || '').localeCompare(b.student.name || '', 'id', { numeric: true });
        } else if (column === 'no') {
            return isAsc ? a.originalIndex - b.originalIndex : b.originalIndex - a.originalIndex;
        } else {
            // column === 'name' atau fallback default
            const cmp = (a.student.name || '').localeCompare(b.student.name || '', 'id', { numeric: true, sensitivity: 'base' });
            return isAsc ? cmp : -cmp;
        }
    });

    // 4. Bangun baris HTML
    const rowsHtml = filteredStudents.map((item, idx) => {
        const { student, ewsRes } = item;
        const rowIdx = idx + 1;

        const pInfo = resolveStudentParent(student);
        const waBtn = pInfo.cleanPhone
            ? `<button onclick="window.openModalWaGenerator('${escapeHTML(student.nis)}', 'ews_warning', 'parent')" class="inline-flex items-center gap-1 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 text-[11px] font-bold px-2.5 py-1 rounded-lg transition" title="Hubungi ${escapeHTML(pInfo.role ? 'WA ' + pInfo.role : 'WA Ortu')}">
                <i class="fa-brands fa-whatsapp text-xs"></i> WA
               </button>`
            : `<span class="text-[11px] text-slate-400" title="Nomor WA ortu belum terdata">-</span>`;

        const rawPhoto = student.activePhotoUrl || student.active_photo_url || student.photoUrl || student.photo_url || student.foto || student.foto_url || '';
        const resolvedPhoto = (typeof window.resolvePhotoUrl === 'function' && rawPhoto)
            ? window.resolvePhotoUrl(rawPhoto)
            : rawPhoto;
        const safePhotoUrl = (resolvedPhoto && /^(https?:|\/|data:image\/)/i.test(resolvedPhoto))
            ? window.escapeHTML(resolvedPhoto)
            : '';
        const initial = (student.name || '?').charAt(0).toUpperCase();

        const studentAvatarHtml = safePhotoUrl
            ? `<div class="w-8 h-9 rounded-lg overflow-hidden shrink-0 shadow-2xs ring-1 ring-slate-200 dark:ring-slate-700 bg-slate-100 dark:bg-slate-800">
                <img src="${safePhotoUrl}" alt="${escapeHTML(student.name)}" class="w-full h-full object-cover" loading="lazy" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'w-full h-full bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs\\'>${initial}</div>';" />
               </div>`
            : `<div class="w-8 h-9 rounded-lg bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs shrink-0 shadow-2xs ring-1 ring-indigo-400/30">${initial}</div>`;

        return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition">
                <td class="p-3.5 text-center font-semibold text-slate-500">${rowIdx}</td>
                <td class="p-3.5">
                    <div class="flex items-center gap-2.5">
                        ${studentAvatarHtml}
                        <div class="min-w-0">
                            <div class="font-bold text-slate-800 dark:text-slate-100 leading-snug">${escapeHTML(student.name)}</div>
                            <div class="text-[10px] text-slate-400 font-mono">NIS: ${escapeHTML(student.nis || '-')}</div>
                        </div>
                    </div>
                </td>
                <td class="p-3.5 text-center">
                    <span class="inline-block font-semibold px-2.5 py-1 rounded-lg text-xs ${ewsRes.details.alpa > 0 ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 font-bold' : (ewsRes.details.izin > 0 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 font-bold' : 'text-slate-600 dark:text-slate-300')}">
                        Alpa: ${ewsRes.details.alpa} | Izin: ${ewsRes.details.izin}
                    </span>
                </td>
                <td class="p-3.5 text-center font-bold ${ewsRes.details.points > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300'}">
                    ${ewsRes.details.points} Poin
                </td>
                <td class="p-3.5 text-center font-semibold text-slate-600 dark:text-slate-300">
                    ${ewsRes.details.permisi}x
                </td>
                <td class="p-3.5 text-center font-black text-slate-800 dark:text-white text-sm">
                    ${ewsRes.totalScore}
                </td>
                <td class="p-3.5 text-center">
                    <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${ewsRes.colorClass}">
                        <span class="w-2 h-2 rounded-full ${ewsRes.badgeBg}"></span>
                        ${ewsRes.label}
                    </span>
                </td>
                <td class="p-3.5 text-center space-x-1">
                    ${waBtn}
                    <button onclick="window.openModalDetailSiswa('${escapeHTML(student.nis)}')" class="inline-flex items-center gap-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 text-[11px] font-bold px-2.5 py-1 rounded-lg transition" title="Lihat Profil & EWS">
                        <i class="fa-solid fa-eye text-xs"></i> Detail
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    tbody.innerHTML = rowsHtml;
}

/**
 * Render Pending Permisi Requests (2-Tahap Approval for Wali Kelas)
 */
function renderPendingPermisi() {
    const section = document.getElementById('pending-permisi-section');
    const container = document.getElementById('pending-permisi-container');
    const badgeCount = document.getElementById('badge-pending-permisi-count');

    // Only display this section if 2-Step Permission is enabled in System Config
    if (!twoStepPermissionEnabled) {
        if (section) section.classList.add('hidden');
        return;
    }

    if (!currentRombelClass) {
        if (section) section.classList.add('hidden');
        return;
    }

    if (section) section.classList.remove('hidden');
    if (!container) return;

    if (badgeCount) badgeCount.textContent = `${pendingPermisiList.length} Pending`;

    if (pendingPermisiList.length === 0) {
        container.innerHTML = '<p class="text-slate-400 text-xs py-2 text-center">Tidak ada pengajuan permisi pending.</p>';
        return;
    }

    container.innerHTML = pendingPermisiList.map(item => `
        <div class="bg-white dark:bg-slate-800 p-3 rounded-xl border border-amber-200 dark:border-amber-800/60 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
                <div class="flex items-center gap-2">
                    <span class="font-bold text-slate-800 dark:text-slate-100 text-xs">${escapeHTML(item.studentName || item.namaSiswa || 'Siswa')}</span>
                    <span class="text-[10px] text-slate-400 font-mono">(${escapeHTML(item.nis || '-')})</span>
                </div>
                <p class="text-xs text-slate-600 dark:text-slate-300 mt-0.5"><i class="fa-solid fa-comment-dots mr-1 text-amber-500"></i> Alasan: ${escapeHTML(item.reason || item.alasan || 'Permisi Meninggalkan Kelas')}</p>
                <p class="text-[10px] text-slate-400 mt-0.5">Tanggal: ${formatDateIndo(item.date || item.tanggal || getLocalISODate())}</p>
            </div>
            <div class="flex items-center gap-2 self-end sm:self-center">
                <button onclick="window.approvePermisi('${item.id}')" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow transition flex items-center gap-1">
                    <i class="fa-solid fa-check"></i> Setujui
                </button>
                <button onclick="window.rejectPermisi('${item.id}')" class="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-lg shadow transition flex items-center gap-1">
                    <i class="fa-solid fa-times"></i> Tolak
                </button>
            </div>
        </div>
    `).join('');
}

/**
 * Approve Permisi Request
 */
window.approvePermisi = async function (permisiId) {
    try {
        const waliName = auth.currentUser?.displayName || auth.currentUser?.email || 'Wali Kelas';
        if (cfClient && cfClient.enabled) {
            await cfClient.processWaliPermisi(permisiId, 'approve', waliName);
        }
        showToast('Sukses', 'Izin permisi siswa disetujui', 'success');
        clearWaliRombelCache();
        await loadPermissionData(currentRombelClass);
        renderPendingPermisi();
        renderEwsTable();
    } catch (e) {
        console.error('[WaliKelas] Error approving permisi:', e);
        showToast('Error', 'Gagal menyetujui permisi', 'error');
    }
};

/**
 * Reject Permisi Request
 */
window.rejectPermisi = async function (permisiId) {
    try {
        const waliName = auth.currentUser?.displayName || auth.currentUser?.email || 'Wali Kelas';
        if (cfClient && cfClient.enabled) {
            await cfClient.processWaliPermisi(permisiId, 'reject', waliName);
        }
        showToast('Sukses', 'Izin permisi siswa ditolak', 'info');
        clearWaliRombelCache();
        await loadPermissionData(currentRombelClass);
        renderPendingPermisi();
        renderEwsTable();
    } catch (e) {
        console.error('[WaliKelas] Error rejecting permisi:', e);
        showToast('Error', 'Gagal menolak permisi', 'error');
    }
};

/**
 * Helper: Ambil rentang Tahun Ajaran berjalan (misal 1 Juli 2026 s/d 30 Juni 2027)
 */
function getActiveAcademicYearRange() {
    const now = new Date();
    const currentMonth = now.getMonth(); // 0 = Jan, 6 = July
    const currentYear = now.getFullYear();

    const startYear = currentMonth >= 6 ? currentYear : currentYear - 1;
    const endYear = startYear + 1;

    return {
        startYear,
        endYear,
        academicYearStr: `${startYear}/${endYear}`,
        minDateIso: `${startYear}-07-01`,
        maxDateIso: `${endYear}-06-30`
    };
}

let selectedAttendanceDateIso = typeof getLocalISODate === 'function' ? getLocalISODate() : new Date().toISOString().split('T')[0];
let currentAttendanceRekapData = [];
let currentAttendanceSort = { column: 'name', order: 'asc' };

/**
 * Render Tab 2: Presensi Rombel
 */
function renderAttendanceTab(useCachedAttendance = false) {
    const academicRange = getActiveAcademicYearRange();
    const dateInput = document.getElementById('input-attendance-date');

    if (dateInput) {
        dateInput.min = academicRange.minDateIso;
        dateInput.max = academicRange.maxDateIso;

        if (!dateInput.value) {
            dateInput.value = selectedAttendanceDateIso;
        }

        dateInput.onchange = () => {
            let val = dateInput.value;
            if (!val) {
                val = getLocalISODate();
                dateInput.value = val;
            }

            // Validasi batasan 1 tahun ajaran berjalan
            if (val < academicRange.minDateIso || val > academicRange.maxDateIso) {
                showToast('Peringatan', `Tanggal presensi harus di dalam rentang Tahun Ajaran ${academicRange.academicYearStr} (1 Juli ${academicRange.startYear} - 30 Juni ${academicRange.endYear}).`, 'warning');
                val = val < academicRange.minDateIso ? academicRange.minDateIso : academicRange.maxDateIso;
                dateInput.value = val;
            }

            selectedAttendanceDateIso = val;
            loadAttendanceForDate(currentRombelClass, selectedAttendanceDateIso);
        };
    }

    loadAttendanceForDate(currentRombelClass, selectedAttendanceDateIso, useCachedAttendance);
    setupAttendanceMonthSelector();
}

/**
 * Load & Render Status Kehadiran Siswa untuk Tanggal Terpilih
 */
async function loadAttendanceForDate(className, targetDateStr, useCachedAttendance = false) {
    const todayGrid = document.getElementById('attendance-today-grid');
    const sectionTitle = document.getElementById('attendance-section-title');

    if (sectionTitle) {
        sectionTitle.textContent = `Status Kehadiran Siswa Tanggal ${formatDateIndo(targetDateStr)}`;
    }

    if (!todayGrid) return;

    if (!className) {
        todayGrid.innerHTML = `
            <div class="p-8 text-center text-slate-500 font-medium dark:text-slate-400 col-span-full">
                <i class="fa-solid fa-hand-pointer text-indigo-500 text-2xl mb-2 block"></i>
                Silakan pilih Rombel Binaan terlebih dahulu pada menu dropdown di atas.
            </div>
        `;
        return;
    }

    if (currentClassStudents.length === 0) {
        todayGrid.innerHTML = '<p class="text-slate-400 text-xs col-span-full py-4 text-center">Tidak ada data siswa.</p>';
        return;
    }

    if (!useCachedAttendance) {
        todayGrid.innerHTML = '<p class="text-slate-400 text-xs col-span-full py-4 text-center"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Memuat presensi tanggal ' + formatDateIndo(targetDateStr) + '...</p>';
        await loadTodayAttendance(className, targetDateStr);
    }

    todayGrid.innerHTML = currentClassStudents.map(student => {
        const studentNis = String(student.nis || student.id || '').trim();
        const att = todayAttendanceMap[studentNis] || todayAttendanceMap[student.nis];
        let statusText = 'Belum Diisi';
        let badgeStyle = 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border-slate-300';

        if (att && att.status) {
            statusText = att.status;
            if (att.status === 'Hadir') badgeStyle = 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-300';
            else if (att.status === 'Sakit') badgeStyle = 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-blue-300';
            else if (att.status === 'Izin') badgeStyle = 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-300';
            else if (att.status === 'Alpa') badgeStyle = 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300 border-rose-300';
            else if (att.status === 'Dispensasi' || att.status === 'Dispen') badgeStyle = 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 border-purple-300';
            else if (att.status.includes('Permisi')) badgeStyle = 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300 border-violet-300';
        }

        const noteHtml = (att && att.notes) 
            ? `<p class="text-[10px] text-indigo-600 dark:text-indigo-400 font-medium italic truncate mt-0.5" title="${escapeHTML(att.notes)}"><i class="fa-solid fa-circle-info text-[9px] mr-1"></i>${escapeHTML(att.notes)}</p>` 
            : '';

        const rawPhoto = student.activePhotoUrl || student.active_photo_url || student.photoUrl || student.photo_url || student.foto || student.foto_url || '';
        const resolvedPhoto = (typeof window.resolvePhotoUrl === 'function' && rawPhoto)
            ? window.resolvePhotoUrl(rawPhoto)
            : rawPhoto;
        const safePhotoUrl = (resolvedPhoto && /^(https?:|\/|data:image\/)/i.test(resolvedPhoto))
            ? window.escapeHTML(resolvedPhoto)
            : '';
        const initial = (student.name || '?').charAt(0).toUpperCase();

        const todayAvatarHtml = safePhotoUrl
            ? `<div class="w-9 h-10 rounded-lg overflow-hidden shrink-0 shadow-2xs ring-1 ring-slate-200 dark:ring-slate-700 bg-slate-100 dark:bg-slate-800">
                <img src="${safePhotoUrl}" alt="${escapeHTML(student.name)}" class="w-full h-full object-cover" loading="lazy" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'w-full h-full bg-gradient-to-tr from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xs\\'>${initial}</div>';" />
               </div>`
            : `<div class="w-9 h-10 rounded-lg bg-gradient-to-tr from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xs shrink-0 shadow-2xs">${initial}</div>`;

        return `
            <div class="bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-between gap-2.5">
                <div class="flex items-center gap-2.5 min-w-0 flex-1">
                    ${todayAvatarHtml}
                    <div class="min-w-0 flex-1">
                        <p class="font-bold text-xs text-slate-800 dark:text-slate-100 truncate">${escapeHTML(student.name)}</p>
                        <p class="text-[10px] text-slate-400 font-mono">NIS: ${escapeHTML(student.nis)}</p>
                        ${noteHtml}
                    </div>
                </div>
                <span class="px-2.5 py-1 text-[11px] font-bold rounded-lg border ${badgeStyle} shrink-0">
                    ${escapeHTML(statusText)}
                </span>
            </div>
        `;
    }).join('');
}

/**
 * Setup Month Selector for Rekap Presensi Rombel (Menggunakan Rentang Tahun Ajaran Berjalan)
 */
function setupAttendanceMonthSelector() {
    const monthSelect = document.getElementById('select-attendance-month');
    if (!monthSelect) return;

    const academicRange = getActiveAcademicYearRange();

    if (monthSelect.children.length === 0) {
        const monthsInAcademicYear = [
            { name: 'Juli', monthNum: '07', year: academicRange.startYear },
            { name: 'Agustus', monthNum: '08', year: academicRange.startYear },
            { name: 'September', monthNum: '09', year: academicRange.startYear },
            { name: 'Oktober', monthNum: '10', year: academicRange.startYear },
            { name: 'November', monthNum: '11', year: academicRange.startYear },
            { name: 'Desember', monthNum: '12', year: academicRange.startYear },
            { name: 'Januari', monthNum: '01', year: academicRange.endYear },
            { name: 'Februari', monthNum: '02', year: academicRange.endYear },
            { name: 'Maret', monthNum: '03', year: academicRange.endYear },
            { name: 'April', monthNum: '04', year: academicRange.endYear },
            { name: 'Mei', monthNum: '05', year: academicRange.endYear },
            { name: 'Juni', monthNum: '06', year: academicRange.endYear }
        ];

        const now = new Date();
        const currentMonthNum = String(now.getMonth() + 1).padStart(2, '0');
        const currentYear = now.getFullYear();
        const defaultVal = `${currentYear}-${currentMonthNum}`;

        // Option 1: Full Academic Year Rekap
        const optFull = document.createElement('option');
        optFull.value = 'FULL_YEAR';
        optFull.textContent = `Semua Bulan (Rekap 1 TA ${academicRange.academicYearStr})`;
        monthSelect.appendChild(optFull);

        // Option 2: Semester Ganjil
        const optGanjil = document.createElement('option');
        optGanjil.value = 'SEMESTER_GANJIL';
        optGanjil.textContent = `Semester Ganjil (Juli - Des ${academicRange.startYear})`;
        monthSelect.appendChild(optGanjil);

        // Option 3: Semester Genap
        const optGenap = document.createElement('option');
        optGenap.value = 'SEMESTER_GENAP';
        optGenap.textContent = `Semester Genap (Jan - Jun ${academicRange.endYear})`;
        monthSelect.appendChild(optGenap);

        // Options 4-15: Individual Academic Year Months
        monthsInAcademicYear.forEach(m => {
            const valKey = `${m.year}-${m.monthNum}`;
            const opt = document.createElement('option');
            opt.value = valKey;
            opt.textContent = `${m.name} ${m.year}`;
            if (valKey === defaultVal) opt.selected = true;
            monthSelect.appendChild(opt);
        });

        monthSelect.onchange = () => loadMonthlyAttendanceRekap(monthSelect.value);
    }

    loadMonthlyAttendanceRekap(monthSelect.value || 'FULL_YEAR');
}

/**
 * Load & Render Attendance Rekap (Bulan Spesifik, Per Semester, atau 1 Tahun Ajaran Full)
 */

window.onToggleIncludeSakitRekap = function (checked) {
    try {
        localStorage.setItem('simas_presensi_include_sakit', checked ? 'true' : 'false');
    } catch (_) {}
    const badge = document.getElementById('badge-mode-akademik-rekap');
    if (badge) {
        if (checked) badge.classList.remove('hidden');
        else badge.classList.add('hidden');
    }
    if (Array.isArray(currentAttendanceRekapData) && currentAttendanceRekapData.length > 0) {
        const includeSakit = !!checked;
        currentAttendanceRekapData.forEach(r => {
            const stats = (typeof window.calculateAttendanceStats === 'function')
                ? window.calculateAttendanceStats({ H: r.H, S: r.S, I: r.I, D: r.D, A: r.A }, { includeSakit })
                : null;
            r.percent = stats
                ? (stats.attPctRounded !== undefined ? stats.attPctRounded : Math.round(stats.attPct || 0))
                : (r.total > 0 ? Math.round(((r.H + r.D + (includeSakit ? r.S : 0)) / r.total) * 100) : 0);
        });
        renderAttendanceRekapTable();
    }
};

async function loadMonthlyAttendanceRekap(periodKey) {
    const tbody = document.getElementById('attendance-rekap-body');
    const periodLabel = document.getElementById('rekap-period-label');
    if (!tbody) return;

    if (!currentRombelClass) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="p-8 text-center text-slate-500 font-medium dark:text-slate-400">
                    <i class="fa-solid fa-hand-pointer text-indigo-500 text-2xl mb-2 block"></i>
                    Silakan pilih Rombel Binaan terlebih dahulu pada menu dropdown di atas.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = '<tr><td colspan="8" class="p-6 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Menghitung rekapitulasi presensi...</td></tr>';

    try {
        const academicRange = getActiveAcademicYearRange();
        let startIso = '';
        let endIso = '';
        let labelText = '';

        if (!periodKey || periodKey === 'FULL_YEAR') {
            startIso = academicRange.minDateIso;
            endIso = academicRange.maxDateIso;
            labelText = `Rekapitulasi 1 Tahun Ajaran (${academicRange.academicYearStr})`;
        } else if (periodKey === 'SEMESTER_GANJIL') {
            startIso = `${academicRange.startYear}-07-01`;
            endIso = `${academicRange.startYear}-12-31`;
            labelText = `Rekapitulasi Semester Ganjil (Juli - Des ${academicRange.startYear})`;
        } else if (periodKey === 'SEMESTER_GENAP') {
            startIso = `${academicRange.endYear}-01-01`;
            endIso = `${academicRange.endYear}-06-30`;
            labelText = `Rekapitulasi Semester Genap (Jan - Jun ${academicRange.endYear})`;
        } else {
            const [y, m] = periodKey.split('-');
            const yearNum = parseInt(y, 10);
            const monthNum = parseInt(m, 10);
            const lastDay = new Date(yearNum, monthNum, 0).getDate();
            startIso = `${y}-${m}-01`;
            endIso = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
            const monthNamesIndo = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
            labelText = `Rekapitulasi Bulan ${monthNamesIndo[monthNum] || ''} ${y}`;
        }

        if (periodLabel) periodLabel.textContent = labelText;

        const countsMap = {};
        currentClassStudents.forEach(s => {
            const nis = String(s.nis || s.id || '').trim();
            countsMap[nis] = { H: 0, S: 0, I: 0, A: 0, D: 0, P: 0, total: 0 };
        });

        try {
            const { rows: attRows } = await window.fetchClassAttendanceRange(currentRombelClass, startIso, endIso);
            if (Array.isArray(attRows)) {
                if (attRows.length > 0) {
                    const existingMap = new Map((currentClassAttendanceRows || []).map(r => [`${r.student_nis || r.nis}_${r.tanggal || r.date}`, r]));
                    attRows.forEach(r => {
                        const k = `${r.student_nis || r.nis}_${r.tanggal || r.date}`;
                        existingMap.set(k, r);
                    });
                    currentClassAttendanceRows = Array.from(existingMap.values());
                }
                attRows.forEach(rec => {
                    const nis = String(rec.student_nis || rec.nis || '').trim();
                    if (countsMap[nis]) {
                        const st = (rec.status || 'H').toString().trim();
                        if (st === 'H' || st === 'Hadir') countsMap[nis].H++;
                        else if (st === 'S' || st === 'Sakit') countsMap[nis].S++;
                        else if (st === 'I' || st === 'Izin') countsMap[nis].I++;
                        else if (st === 'A' || st === 'Alpa') countsMap[nis].A++;
                        else if (st === 'D' || st === 'Dispen' || st === 'Dispensasi') countsMap[nis].D++;
                        else if (['P', 'Permisi', 'DIPERBOLEHKAN'].includes(st)) countsMap[nis].P++;
                        countsMap[nis].total++;
                    }
                });
            }
        } catch (eAttRecap) {
            console.warn('[WaliKelas] Attendance recap fetch notice:', eAttRecap);
        }

        // Sertakan rekap permisi dari Cloudflare D1 (records category == 'Permisi')
        try {
            if (cfClient && cfClient.enabled) {
                const recList = await cfClient.getRecords({
                    class: currentRombelClass,
                    category: 'Permisi',
                    date_start: startIso,
                    date_end: endIso,
                    limit: 500
                });
                (recList || []).forEach(d => {
                    const nis = String(d.student_nis || d.studentNIS || d.nis || '').trim();
                    if (countsMap[nis]) {
                        countsMap[nis].P++;
                    }
                });
            }
        } catch (eRec) {
            console.warn('[WaliKelas] Rekap permisi records from D1 error:', eRec.message);
        }

        const includeSakit = localStorage.getItem('simas_presensi_include_sakit') === 'true';
        const toggleEl = document.getElementById('toggle-include-sakit-rekap');
        if (toggleEl) toggleEl.checked = includeSakit;
        const badgeEl = document.getElementById('badge-mode-akademik-rekap');
        if (badgeEl) {
            if (includeSakit) badgeEl.classList.remove('hidden');
            else badgeEl.classList.add('hidden');
        }

        currentAttendanceRekapData = currentClassStudents.map((student, idx) => {
            const nis = String(student.nis || student.id || '').trim();
            const c = countsMap[nis] || { H: 0, S: 0, I: 0, A: 0, D: 0, P: 0, total: 0 };
            // SSOT SIMAS: ((H + D) / Total) * 100% atau ((H + D + S) / Total) * 100%
            const stats = (typeof window.calculateAttendanceStats === 'function')
                ? window.calculateAttendanceStats(c, { includeSakit })
                : null;
            const effectiveDays = stats ? stats.total : (c.total || (c.H + c.S + c.I + c.A + c.D));
            const percent = stats
                ? (stats.attPctRounded !== undefined ? stats.attPctRounded : Math.round(stats.attPct || 0))
                : (effectiveDays > 0 ? Math.round(((c.H + c.D + (includeSakit ? c.S : 0)) / effectiveDays) * 100) : 0);
            return {
                no: idx + 1,
                originalIndex: idx + 1,
                nis: student.nis,
                name: student.name,
                H: c.H,
                S: c.S,
                I: c.I,
                A: c.A,
                D: c.D,
                P: c.P,
                total: effectiveDays,
                percent
            };
        });

        renderAttendanceRekapTable();

    } catch (e) {
        console.error('[WaliKelas] Error loading attendance rekap:', e);
        tbody.innerHTML = '<tr><td colspan="9" class="p-6 text-center text-rose-500">Gagal memuat rekap presensi.</td></tr>';
    }
}

/**
 * Render Tabel Rekapitulasi Presensi dengan Dukungan Sorting Dinamis
 */
function renderAttendanceRekapTable() {
    const tbody = document.getElementById('attendance-rekap-body');
    if (!tbody) return;

    if (!currentAttendanceRekapData || currentAttendanceRekapData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="p-6 text-center text-slate-400">Tidak ada siswa di rombel ini.</td></tr>';
        return;
    }

    const sortableCols = ['no', 'name', 'H', 'S', 'I', 'A', 'D', 'P', 'percent'];
    const { column, order } = currentAttendanceSort;
    const isAsc = order === 'asc';

    // In-memory sort
    currentAttendanceRekapData.sort((a, b) => {
        let valA = a[column];
        let valB = b[column];

        if (column === 'no') {
            valA = a.originalIndex ?? a.no ?? 0;
            valB = b.originalIndex ?? b.no ?? 0;
        }

        if (typeof valA === 'string' && typeof valB === 'string') {
            const cmp = valA.localeCompare(valB, 'id', { numeric: true, sensitivity: 'base' });
            return isAsc ? cmp : -cmp;
        }

        const numA = Number(valA ?? 0);
        const numB = Number(valB ?? 0);
        if (numA !== numB) {
            return isAsc ? numA - numB : numB - numA;
        }

        return (a.name || '').localeCompare(b.name || '', 'id', { numeric: true });
    });

    // Update icons visual
    sortableCols.forEach(col => {
        const icon = document.getElementById(`sort-icon-${col}`);
        if (!icon) return;

        icon.className = 'ml-1 text-[10px] fa-solid';
        if (col === column) {
            icon.classList.add(isAsc ? 'fa-sort-up' : 'fa-sort-down', 'text-indigo-600', 'dark:text-indigo-400');
        } else {
            icon.classList.add('fa-sort', 'text-slate-300', 'dark:text-slate-600');
        }
    });

    tbody.innerHTML = currentAttendanceRekapData.map((row, idx) => {
        const studentObj = currentClassStudents.find(s => String(s.nis).trim() === String(row.nis).trim()) || {};
        const rawPhoto = studentObj.activePhotoUrl || studentObj.active_photo_url || studentObj.photoUrl || studentObj.photo_url || studentObj.foto || studentObj.foto_url || '';
        const resolvedPhoto = (typeof window.resolvePhotoUrl === 'function' && rawPhoto)
            ? window.resolvePhotoUrl(rawPhoto)
            : rawPhoto;
        const safePhotoUrl = (resolvedPhoto && /^(https?:|\/|data:image\/)/i.test(resolvedPhoto))
            ? window.escapeHTML(resolvedPhoto)
            : '';
        const initial = (row.name || '?').charAt(0).toUpperCase();

        const rekapAvatarHtml = safePhotoUrl
            ? `<div class="w-8 h-8 rounded-lg shrink-0 overflow-hidden shadow-2xs ring-1 ring-slate-200 dark:ring-slate-700 bg-slate-100 dark:bg-slate-800">
                <img src="${safePhotoUrl}" alt="${escapeHTML(row.name)}" class="w-full h-full object-cover" loading="lazy" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'w-full h-full bg-gradient-to-tr from-emerald-500 to-teal-600 flex items-center justify-center text-white font-bold text-xs\\'>${initial}</div>';" />
               </div>`
            : `<div class="w-8 h-8 bg-gradient-to-tr from-emerald-500 to-teal-600 rounded-lg flex items-center justify-center text-white font-bold text-xs shadow-2xs shrink-0">${initial}</div>`;

        return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition">
                <td class="p-3 text-center font-semibold text-slate-500">${idx + 1}</td>
                <td class="p-3 font-bold text-slate-800 dark:text-slate-100">
                    <div class="flex items-center gap-2.5">
                        ${rekapAvatarHtml}
                        <div class="min-w-0">
                            <div>${escapeHTML(row.name)}</div>
                            <span class="text-[10px] font-mono text-slate-400 block sm:inline">NIS: ${escapeHTML(row.nis)}</span>
                        </div>
                    </div>
                </td>
                <td class="p-3 text-center font-bold text-emerald-600">${row.H}</td>
                <td class="p-3 text-center font-semibold text-blue-600">${row.S}</td>
                <td class="p-3 text-center font-semibold text-amber-600">${row.I}</td>
                <td class="p-3 text-center font-bold text-rose-600">${row.A}</td>
                <td class="p-3 text-center font-semibold text-purple-600">${row.D}</td>
                <td class="p-3 text-center font-semibold text-violet-600">${row.P}</td>
                <td class="p-3 text-center font-black ${row.percent >= 85 ? 'text-emerald-600' : 'text-rose-600'}">${row.percent}%</td>
            </tr>
        `;
    }).join('');
}

/**
 * Handle Klik Header Kolom Rekapitulasi Presensi (Sort Handler)
 */
window.sortAttendanceRekap = function (columnKey) {
    if (!currentAttendanceRekapData || currentAttendanceRekapData.length === 0) return;

    if (currentAttendanceSort.column === columnKey) {
        currentAttendanceSort.order = currentAttendanceSort.order === 'asc' ? 'desc' : 'asc';
    } else {
        const isNumericQuantity = ['H', 'S', 'I', 'A', 'D', 'P', 'percent'].includes(columnKey);
        currentAttendanceSort = {
            column: columnKey,
            order: isNumericQuantity ? 'desc' : 'asc'
        };
    }

    renderAttendanceRekapTable();
};

/**
 * Export Rekapitulasi Presensi ke Excel (.xlsx)
 */
window.exportAttendanceRekap = function () {
    if (typeof XLSX === 'undefined') {
        showToast('Error', 'Library SheetJS (XLSX) belum dimuat. Mohon muat ulang halaman.', 'error');
        return;
    }

    if (!currentRombelClass || currentAttendanceRekapData.length === 0) {
        showToast('Peringatan', 'Belum ada data rekap presensi untuk diexport.', 'warning');
        return;
    }

    const periodLabelText = document.getElementById('rekap-period-label')?.textContent || 'Rekapitulasi Presensi';
    const includeSakit = localStorage.getItem('simas_presensi_include_sakit') === 'true';
    const percentHeader = includeSakit ? '% Kehadiran (Akademik: H+D+S)' : '% Kehadiran';

    const excelData = currentAttendanceRekapData.map((r, idx) => ({
        'No': idx + 1,
        'NIS': String(r.nis),
        'Nama Siswa': r.name,
        'Kelas': currentRombelClass,
        'Hadir (H)': r.H,
        'Sakit (S)': r.S,
        'Izin (I)': r.I,
        'Alpa (A)': r.A,
        'Dispensasi (D)': r.D,
        'Permisi (P)': r.P,
        'Total Presensi': r.total,
        [percentHeader]: `${r.percent}%`
    }));

    try {
        const worksheet = XLSX.utils.json_to_sheet(excelData);

        // Auto-fit column widths
        worksheet['!cols'] = [
            { wch: 5 },   // No
            { wch: 14 },  // NIS
            { wch: 32 },  // Nama Siswa
            { wch: 10 },  // Kelas
            { wch: 10 },  // H
            { wch: 10 },  // S
            { wch: 10 },  // I
            { wch: 10 },  // A
            { wch: 10 },  // P
            { wch: 14 },  // Total
            { wch: 14 }   // % Kehadiran
        ];

        const workbook = XLSX.utils.book_new();
        const sheetName = 'Rekap Presensi';
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

        const cleanClass = currentRombelClass.replace(/[^a-zA-Z0-9_-]/g, '_');
        const cleanPeriod = periodLabelText.replace(/[^a-zA-Z0-9_-]/g, '_');
        const fileName = `Rekap_Presensi_${cleanClass}_${cleanPeriod}.xlsx`;

        XLSX.writeFile(workbook, fileName);
        showToast('Sukses', `Rekap presensi ${currentRombelClass} berhasil diexport ke XLSX`, 'success');

        if (typeof window.logAudit === 'function') {
            window.logAudit('EXPORT_EXCEL_REKAP_PRESENSI', 'attendance', cleanClass, null, `Export Excel Rekap Presensi Rombel ${currentRombelClass} (${periodLabelText})`);
        }
    } catch (err) {
        console.error('[WaliKelas] Error exporting attendance XLSX:', err);
        showToast('Error', 'Gagal mengexport file Excel', 'error');
    }
};

/**
 * Render Tab 3: Poin & Perilaku (Catatan Pelanggaran, Prestasi & Permisi)
 * Catatan: Tabel akumulasi poin rombel dihapus karena sudah diakomodasi penuh di Tab 1 (EWS).
 */
function renderPointsTab() {
    renderRecordsTimelineTab();
}

/**
 * Switch Sub-Tab inside Tab 3: Poin & Perilaku (Backward-compatible stub)
 */
window.switchPointsSubTab = function (subTab = 'timeline') {
    currentRecordsSubTab = subTab;
    renderRecordsTimelineTab();
};

/**
 * Render Tab 3: Timeline Catatan Pelanggaran, Prestasi & Permisi
 */
function renderRecordsTimelineTab() {
    const container = document.getElementById('records-timeline-container');
    const studentFilterSelect = document.getElementById('filter-records-student');
    const typeFilterSelect = document.getElementById('filter-records-type');

    if (studentFilterSelect) {
        const prevVal = studentFilterSelect.value;
        studentFilterSelect.innerHTML = '<option value="">Semua Siswa Rombel</option>';
        if (currentRombelClass && Array.isArray(currentClassStudents)) {
            currentClassStudents.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.nis;
                opt.textContent = `${s.name} (${s.nis})`;
                if (String(s.nis) === String(prevVal)) {
                    opt.selected = true;
                }
                studentFilterSelect.appendChild(opt);
            });
        }
    }

    if (!container) return;

    if (!currentRombelClass) {
        container.innerHTML = `
            <div class="p-8 text-center text-slate-500 font-medium dark:text-slate-400">
                <i class="fa-solid fa-hand-pointer text-amber-500 text-2xl mb-2 block"></i>
                Silakan pilih Rombel Binaan terlebih dahulu pada menu dropdown di atas.
            </div>
        `;
        return;
    }

    const selectedNis = studentFilterSelect?.value || '';
    const selectedType = typeFilterSelect?.value || '';

    const filtered = classRecordsList.filter(item => {
        if (selectedNis && item.studentNis !== selectedNis && item.nis !== selectedNis) return false;
        if (selectedType && item.type !== selectedType) return false;
        return true;
    });

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="text-center py-10 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
                <i class="fa-solid fa-clipboard-check text-slate-400 text-3xl mb-2"></i>
                <p class="text-slate-500 dark:text-slate-400 font-medium text-xs">Belum ada riwayat catatan pelanggaran, prestasi, atau permisi untuk rombel ini.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = filtered.map(item => {
        const targetNis = String(item.studentNis || item.nis || '').trim();
        const student = (Array.isArray(currentClassStudents) ? currentClassStudents : []).find(s => String(s.nis).trim() === targetNis);
        const rawPhoto = student ? (student.activePhotoUrl || student.active_photo_url || student.photoUrl || student.photo_url || student.foto || student.foto_url || '') : '';
        const resolvedPhoto = (typeof window.resolvePhotoUrl === 'function' && rawPhoto)
            ? window.resolvePhotoUrl(rawPhoto)
            : rawPhoto;
        const safePhotoUrl = (resolvedPhoto && /^(https?:|\/|data:image\/)/i.test(resolvedPhoto))
            ? window.escapeHTML(resolvedPhoto)
            : '';
        const initial = (item.studentName || student?.name || '?').charAt(0).toUpperCase();

        const pointsAvatarHtml = safePhotoUrl
            ? `<div class="w-8 h-9 rounded-lg overflow-hidden shrink-0 shadow-2xs ring-1 ring-slate-200 dark:ring-slate-700 bg-slate-100 dark:bg-slate-800">
                <img src="${safePhotoUrl}" alt="${escapeHTML(item.studentName || student?.name || '')}" class="w-full h-full object-cover" loading="lazy" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'w-full h-full bg-gradient-to-tr from-amber-500 to-rose-600 flex items-center justify-center text-white font-bold text-xs\\'>${initial}</div>';" />
               </div>`
            : `<div class="w-8 h-9 rounded-lg bg-gradient-to-tr from-amber-500 to-rose-600 flex items-center justify-center text-white font-bold text-xs shrink-0 shadow-2xs ring-1 ring-amber-400/30">${initial}</div>`;

        return `
            <div class="bg-white dark:bg-slate-800 p-3.5 sm:p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs hover:border-amber-400 dark:hover:border-amber-600/50 transition flex items-start gap-3">
                ${pointsAvatarHtml}
                <div class="space-y-1.5 flex-1 min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${item.typeBadgeClass || 'bg-amber-100 text-amber-800 border-amber-300'} uppercase inline-flex items-center gap-1">
                            <i class="fa-solid ${item.icon || 'fa-tag'}"></i> ${escapeHTML(item.typeLabel || 'Catatan')}
                        </span>
                        <span class="text-[10px] text-slate-400 font-semibold ml-auto sm:ml-0">${formatDateIndo(item.date || getLocalISODate())}</span>
                    </div>
                    <h4 class="font-bold text-sm text-slate-800 dark:text-slate-100 leading-snug">${escapeHTML(item.title || '-')}</h4>
                    <p class="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">${escapeHTML(item.content || '-')}</p>
                    <div class="flex flex-wrap items-center justify-between gap-2 pt-1 text-[10px] text-slate-400 font-medium border-t border-slate-100 dark:border-slate-700/50 mt-2">
                        <span>Siswa: <strong class="text-slate-700 dark:text-slate-200">${escapeHTML(item.studentName || student?.name || '-')}</strong> (${escapeHTML(targetNis || '-')})</span>
                        <span>Oleh/Sumber: <strong class="text-slate-700 dark:text-slate-200">${escapeHTML(item.author || 'Sistem')}</strong></span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Render Tab 4: Catatan Pembinaan Wali Kelas
 */
function renderNotesTab() {
    const container = document.getElementById('notes-timeline-container');
    const studentFilterSelect = document.getElementById('filter-note-student');

    if (studentFilterSelect) {
        const prevVal = studentFilterSelect.value;
        studentFilterSelect.innerHTML = '<option value="">Semua Siswa Rombel</option>';
        if (currentRombelClass && Array.isArray(currentClassStudents)) {
            const sortedStudents = [...currentClassStudents].sort((a, b) => 
                (a.name || '').localeCompare((b.name || ''), 'id', { sensitivity: 'base' })
            );
            sortedStudents.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.nis;
                opt.textContent = `${s.name} (${s.nis})`;
                if (String(s.nis) === String(prevVal)) {
                    opt.selected = true;
                }
                studentFilterSelect.appendChild(opt);
            });
        }
    }

    if (!container) return;

    if (!currentRombelClass) {
        container.innerHTML = `
            <div class="p-8 text-center text-slate-500 font-medium dark:text-slate-400">
                <i class="fa-solid fa-hand-pointer text-indigo-500 text-2xl mb-2 block"></i>
                Silakan pilih Rombel Binaan terlebih dahulu pada menu dropdown di atas.
            </div>
        `;
        return;
    }

    const selectedNis = document.getElementById('filter-note-student')?.value || '';
    const selectedCategory = document.getElementById('filter-note-category')?.value || '';

    const filteredNotes = classNotesList.filter(n => {
        if (selectedNis && n.studentNis !== selectedNis && n.nis !== selectedNis) return false;
        if (selectedCategory && n.category !== selectedCategory) return false;
        return true;
    });

    if (filteredNotes.length === 0) {
        container.innerHTML = `
            <div class="text-center py-10 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
                <i class="fa-solid fa-book-open text-slate-400 text-3xl mb-2"></i>
                <p class="text-slate-500 dark:text-slate-400 font-medium text-xs">Belum ada catatan pembinaan wali kelas untuk rombel ini.</p>
            </div>
        `;
        return;
    }

    const categoryIcons = {
        akademik: { label: 'Akademik', icon: 'fa-graduation-cap', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
        kompetensi: { label: 'Kompetensi', icon: 'fa-award', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
        keterampilan: { label: 'Keterampilan', icon: 'fa-tools', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
        karakter: { label: 'Karakter', icon: 'fa-heart', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' }
    };

    container.innerHTML = filteredNotes.map(note => {
        const cat = categoryIcons[note.category] || { label: note.category || 'Umum', icon: 'fa-tag', color: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300' };
        
        const sourceBadgeClass = note.sourceBadgeClass || 'bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 border-purple-200 dark:border-purple-800';
        const sourceIcon = note.sourceIcon || 'fa-user-tie';
        const sourceLabel = note.sourceLabel || 'Catatan Wali Kelas';
        const isWaliSource = note.source === 'wali';

        const currentUid = auth.currentUser?.uid || '';
        const currentUserName = (auth.currentUser?.displayName || currentUserProfile.name || currentUserProfile.nama || localStorage.getItem('user_display_name') || auth.currentUser?.email || '').toLowerCase().trim();

        const noteUid = note.guruUid || note.createdById || note.authorUid || note.userId || '';
        const noteAuthor = (note.author || note.createdByName || '').toLowerCase().trim();

        // Check if note was created by current logged in user
        let isCreator = false;
        if (currentUid && noteUid) {
            isCreator = (currentUid === noteUid);
        } else if (currentUserName && noteAuthor && noteAuthor !== 'wali kelas' && noteAuthor !== 'guru perwalian') {
            isCreator = noteAuthor.includes(currentUserName) || currentUserName.includes(noteAuthor);
        }

        const isOwnWaliNote = isWaliSource && isCreator;

        const actionButtonsHtml = isOwnWaliNote ? `
            <div class="flex sm:flex-col items-center justify-end gap-1 shrink-0 border-t sm:border-t-0 sm:border-l border-slate-100 dark:border-slate-700 pt-2 sm:pt-0 sm:pl-3">
                <button onclick="window.openModalTambahCatatanWali('${note.id}')" class="p-2 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-lg text-xs font-bold transition" title="Edit Catatan">
                    <i class="fa-solid fa-pen-to-square"></i>
                </button>
                <button onclick="window.deleteCatatanWali('${note.id}')" class="p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded-lg text-xs font-bold transition" title="Hapus Catatan">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        ` : `
            <div class="flex sm:flex-col items-center justify-end gap-1 shrink-0 border-t sm:border-t-0 sm:border-l border-slate-100 dark:border-slate-700 pt-2 sm:pt-0 sm:pl-3">
                <span class="text-[9px] text-slate-400 font-semibold italic text-center">Terintegrasi</span>
            </div>
        `;

        const timeBadge = (note.start_time && note.end_time)
            ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/50 inline-flex items-center gap-1"><i class="fa-solid fa-clock text-[9px]"></i> ${escapeHTML(note.start_time)} - ${escapeHTML(note.end_time)}</span>`
            : '';

        const evidencePhotos = parseEvidencePhotos(note.evidence_url || note.evidenceUrl);
        const photoThumbnailsHtml = evidencePhotos.length > 0 ? `
            <div class="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-slate-100 dark:border-slate-700/50">
                <span class="text-[9px] font-bold text-slate-400 uppercase tracking-wider block w-full"><i class="fa-solid fa-camera mr-1"></i>Dokumentasi:</span>
                ${evidencePhotos.map(p => {
                    const thumb = getGoogleDriveThumbnail(p.url) || p.url;
                    return `
                        <a href="${escapeHTML(p.url)}" target="_blank" rel="noopener noreferrer" class="group relative w-10 h-10 rounded-lg overflow-hidden border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 shadow-sm block hover:ring-2 hover:ring-indigo-400 transition" title="${escapeHTML(p.name || 'Dokumentasi')}">
                            <img src="${escapeHTML(thumb)}" alt="Foto" class="w-full h-full object-cover group-hover:scale-110 transition duration-200" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22 fill=%22%2394a3b8%22 viewBox=%220 0 24 24%22><path d=%22M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z%22/></svg>'">
                        </a>
                    `;
                }).join('')}
            </div>
        ` : '';

        return `
            <div class="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col sm:flex-row justify-between gap-4">
                <div class="space-y-1.5 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${cat.color} uppercase inline-flex items-center gap-1">
                            <i class="fa-solid ${cat.icon}"></i> ${escapeHTML(cat.label || note.category || 'Umum')}
                        </span>
                        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${sourceBadgeClass} inline-flex items-center gap-1">
                            <i class="fa-solid ${sourceIcon}"></i> ${escapeHTML(sourceLabel)}
                        </span>
                        ${timeBadge}
                        <span class="text-[10px] text-slate-400 font-semibold ml-auto sm:ml-0">${formatDateIndo(note.date || getLocalISODate())}</span>
                    </div>
                    <h4 class="font-bold text-sm text-slate-800 dark:text-slate-100">${escapeHTML(note.title)}</h4>
                    <p class="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">${escapeHTML(note.content)}</p>
                    ${photoThumbnailsHtml}
                    <div class="flex flex-wrap items-center justify-between gap-2 pt-1 text-[10px] text-slate-400 font-medium border-t border-slate-100 dark:border-slate-700/50 mt-2">
                        <span>Siswa: <strong class="text-slate-700 dark:text-slate-200">${escapeHTML(note.studentName || '-')}</strong> (${escapeHTML(note.studentNis || '-')})</span>
                        <span>Oleh: <strong class="text-slate-700 dark:text-slate-200">${escapeHTML(note.author || 'Sistem')}</strong></span>
                    </div>
                </div>
                ${actionButtonsHtml}
            </div>
        `;
    }).join('');
}

/**
 * Render Tab 5: Status SPP Rombel
 */
async function renderSppTab() {
    const tbody = document.getElementById('spp-table-body');
    if (!tbody) return;

    if (!currentRombelClass) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="p-8 text-center text-slate-500 font-medium dark:text-slate-400">
                    <i class="fa-solid fa-hand-pointer text-indigo-500 text-2xl mb-2 block"></i>
                    Silakan pilih Rombel Binaan terlebih dahulu pada menu dropdown di atas.
                </td>
            </tr>
        `;
        const lunasBadge = document.getElementById('spp-summary-lunas-badge');
        const tunggakanBadge = document.getElementById('spp-summary-tunggakan-badge');
        const nominalBadge = document.getElementById('spp-summary-nominal-badge');
        const tfoot = document.getElementById('spp-table-foot');
        if (lunasBadge) lunasBadge.textContent = 'Lunas: 0';
        if (tunggakanBadge) tunggakanBadge.textContent = 'Belum: 0';
        if (nominalBadge) nominalBadge.textContent = 'Total Tunggakan: Rp 0';
        if (tfoot) tfoot.classList.add('hidden');
        return;
    }

    if (currentClassStudents.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-400">Tidak ada siswa.</td></tr>';
        return;
    }

    const ratesConfig = await getFinanceRatesWithCache();
    const sppDueDate = await getSppDueDate();
    const now = new Date();
    const todayYear = now.getFullYear();
    const todayMonth = now.getMonth() + 1;
    const activeAcademicYear = todayMonth >= 7 ? todayYear : todayYear - 1;
    const academicMonths = [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6];
    const monthNamesIndo = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

    let lunasCount = 0;
    let belumCount = 0;
    let totalNominalRombel = 0;
    let totalUnpaidMonthsRombel = 0;

    const rowsHtml = currentClassStudents.map((student, idx) => {
        const studentNisKey = String(student.nis || student.id || '').trim();
        const normKey = normalizeNIS(studentNisKey);
        const spp = sppStatusMap[normKey] || sppStatusMap[studentNisKey] || sppStatusMap[student.nis] || { paidMonths: [], totalPaid: 0, paymentHistory: {} };
        
        // Status bulan berjalan SSOT: Cek apakah bulan terpilih ini lunas berdasarkan tgl jatuh tempo dinamis
        const isCurrentMonthPaid = isMonthPaid(spp.paymentHistory, todayYear, todayMonth, sppDueDate);

        if (isCurrentMonthPaid) lunasCount++;
        else belumCount++;

        // Hitung total tunggakan SSOT (berdasarkan cohort, finance_rates Firestore, dan riwayat transaksi)
        const { unpaidCount, totalNominal } = calculateStudentTunggakan(student, spp.paymentHistory, ratesConfig, sppDueDate);

        totalNominalRombel += totalNominal;
        totalUnpaidMonthsRombel += unpaidCount;

        let tunggakanHtml = '';
        if (unpaidCount > 0) {
            tunggakanHtml = `
                <div class="font-black text-rose-600 dark:text-rose-400">Rp ${totalNominal.toLocaleString('id-ID')}</div>
                <div class="text-[10px] text-rose-500 font-bold">(${unpaidCount}x Tunggakan)</div>
            `;
        } else {
            tunggakanHtml = `
                <div class="font-bold text-emerald-600 dark:text-emerald-400">Rp 0</div>
                <div class="text-[10px] text-emerald-500 font-semibold">(Lunas)</div>
            `;
        }

        // Tanggal Pembayaran Terakhir
        let latestDateObj = null;
        if (spp.paymentHistory) {
            Object.values(spp.paymentHistory).forEach(tx => {
                if (!tx || tx.type === 'manual_debt') return;

                let pDate = null;
                if (tx.paymentDate) {
                    pDate = typeof tx.paymentDate.toDate === 'function' ? tx.paymentDate.toDate() : new Date(tx.paymentDate);
                } else if (tx.dateStr) {
                    pDate = new Date(tx.dateStr);
                } else if (tx.date) {
                    pDate = new Date(tx.date);
                }

                if (pDate && !isNaN(pDate.getTime())) {
                    if (!latestDateObj || pDate > latestDateObj) {
                        latestDateObj = pDate;
                    }
                }
            });
        }

        let keteranganText = 'Belum ada transaksi';
        if (latestDateObj) {
            const yyyy = latestDateObj.getFullYear();
            const mm = String(latestDateObj.getMonth() + 1).padStart(2, '0');
            const dd = String(latestDateObj.getDate()).padStart(2, '0');
            keteranganText = formatDateIndo(`${yyyy}-${mm}-${dd}`);
        }

        const rawPhoto = student.activePhotoUrl || student.active_photo_url || student.photoUrl || student.photo_url || student.foto || student.foto_url || '';
        const resolvedPhoto = (typeof window.resolvePhotoUrl === 'function' && rawPhoto)
            ? window.resolvePhotoUrl(rawPhoto)
            : rawPhoto;
        const safePhotoUrl = (resolvedPhoto && /^(https?:|\/|data:image\/)/i.test(resolvedPhoto))
            ? window.escapeHTML(resolvedPhoto)
            : '';
        const initial = (student.name || '?').charAt(0).toUpperCase();

        const sppAvatarHtml = safePhotoUrl
            ? `<div class="w-8 h-9 rounded-lg overflow-hidden shrink-0 shadow-2xs ring-1 ring-slate-200 dark:ring-slate-700 bg-slate-100 dark:bg-slate-800">
                <img src="${safePhotoUrl}" alt="${escapeHTML(student.name)}" class="w-full h-full object-cover" loading="lazy" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'w-full h-full bg-gradient-to-tr from-emerald-500 to-teal-600 flex items-center justify-center text-white font-bold text-xs\\'>${initial}</div>';" />
               </div>`
            : `<div class="w-8 h-9 rounded-lg bg-gradient-to-tr from-emerald-500 to-teal-600 flex items-center justify-center text-white font-bold text-xs shrink-0 shadow-2xs ring-1 ring-emerald-400/30">${initial}</div>`;

        return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition">
                <td class="p-3 text-center font-semibold text-slate-500">${idx + 1}</td>
                <td class="p-3 font-bold text-slate-800 dark:text-slate-100">
                    <div class="flex items-center gap-2.5">
                        ${sppAvatarHtml}
                        <div class="min-w-0">
                            <div>${escapeHTML(student.name)}</div>
                            <div class="text-[10px] text-slate-400 font-mono">NIS: ${escapeHTML(student.nis)}</div>
                        </div>
                    </div>
                </td>
                <td class="p-3 text-center">
                    <span class="px-2.5 py-1 text-[11px] font-bold rounded-full ${isCurrentMonthPaid ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300'}">
                        ${isCurrentMonthPaid ? 'LUNAS' : 'BELUM LUNAS'}
                    </span>
                </td>
                <td class="p-3 text-center">
                    ${tunggakanHtml}
                </td>
                <td class="p-3 text-center text-slate-500 text-xs">
                    ${keteranganText}
                </td>
                <td class="p-3 text-center">
                    <button onclick="window.openModalWaGenerator('${escapeHTML(student.nis)}', 'spp_reminder', 'student')" class="px-2.5 py-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 text-[11px] font-bold rounded-lg hover:bg-emerald-200 transition" title="Kirim WA Pengingat SPP ke Siswa">
                        <i class="fa-brands fa-whatsapp"></i> WA Siswa
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    tbody.innerHTML = rowsHtml;

    const tfoot = document.getElementById('spp-table-foot');
    if (tfoot) {
        if (currentClassStudents.length > 0) {
            tfoot.classList.remove('hidden');
            tfoot.innerHTML = `
                <tr>
                    <td colspan="3" class="p-3 text-right font-extrabold uppercase tracking-wider text-[11px]">Total Tunggakan Rombel:</td>
                    <td class="p-3 text-center">
                        <div class="font-black text-rose-600 dark:text-rose-400 text-sm">Rp ${totalNominalRombel.toLocaleString('id-ID')}</div>
                        <div class="text-[10px] text-rose-500 font-bold">(${totalUnpaidMonthsRombel}x Bulan Tunggakan)</div>
                    </td>
                    <td colspan="2" class="p-3 text-center text-xs text-slate-500 dark:text-slate-400 font-medium">
                        (${belumCount} dari ${currentClassStudents.length} siswa menunggak)
                    </td>
                </tr>
            `;
        } else {
            tfoot.classList.add('hidden');
        }
    }

    const lunasBadge = document.getElementById('spp-summary-lunas-badge');
    const tunggakanBadge = document.getElementById('spp-summary-tunggakan-badge');
    const nominalBadge = document.getElementById('spp-summary-nominal-badge');

    if (lunasBadge) lunasBadge.textContent = `Lunas: ${lunasCount}`;
    if (tunggakanBadge) tunggakanBadge.textContent = `Belum: ${belumCount}`;
    if (nominalBadge) nominalBadge.textContent = `Total Tunggakan: Rp ${totalNominalRombel.toLocaleString('id-ID')}`;
}

/**
 * Render Tab 8: Monitoring Peminjaman Buku Perpustakaan Siswa Rombel (Supabase SSOT)
 */
let currentRombelPerpusLoans = [];

async function renderPerpusTab() {
    const tbody = document.getElementById('perpus-table-body');
    if (!tbody) return;

    if (!currentRombelClass) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="p-8 text-center text-slate-500 font-medium dark:text-slate-400">
                    <i class="fa-solid fa-hand-pointer text-indigo-500 text-2xl mb-2 block"></i>
                    Silakan pilih Rombel Binaan terlebih dahulu pada menu dropdown di atas.
                </td>
            </tr>
        `;
        const badgeDip = document.getElementById('perpus-summary-dipinjam-badge');
        const badgeTer = document.getElementById('perpus-summary-terlambat-badge');
        const badgeDen = document.getElementById('perpus-summary-denda-badge');
        const badgeBeb = document.getElementById('perpus-summary-bebas-pustaka-badge');
        if (badgeDip) badgeDip.textContent = 'Buku Dipinjam: 0';
        if (badgeTer) badgeTer.textContent = 'Terlambat: 0 Siswa';
        if (badgeDen) badgeDen.textContent = 'Total Denda: Rp 0';
        if (badgeBeb) badgeBeb.innerHTML = '<i class="fa-solid fa-file-shield text-teal-600"></i> Bebas Pustaka: 0 / 0 (0%)';
        return;
    }

    await loadWaliPerpusData();
}

let currentRombelBebasPustakaMap = new Map();

async function loadWaliPerpusData() {
    const tbody = document.getElementById('perpus-table-body');
    if (!tbody) return;

    if (!currentClassStudents || currentClassStudents.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-slate-400">Tidak ada siswa di rombel ini.</td></tr>';
        return;
    }

    try {
        if (!supabase) {
            tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-slate-400">Layanan database perpustakaan tidak tersedia.</td></tr>';
            return;
        }

        const studentNisList = currentClassStudents.map(s => String(s.nis || s.id || '').trim()).filter(Boolean);

        // 1. Fetch sirkulasi siswa di rombel ini
        const { data: sirkulasiData, error: errSirkulasi } = await supabase
            .from('lib_sirkulasi')
            .select(`
                *,
                buku:lib_buku (id, judul, pengarang, penerbit, lokasi_rak),
                eksemplar:lib_eksemplar (id, nomor_induk, kode_barcode, copy_number)
            `)
            .eq('peminjam_type', 'siswa')
            .in('peminjam_id', studentNisList)
            .order('created_at', { ascending: false });

        if (errSirkulasi) throw errSirkulasi;

        // 2. Fetch Bebas Pustaka Digital status untuk seluruh siswa rombel
        const clearanceResponse = await window.callSecureEdgeFunction('library-clearance-get', {
            nisList: studentNisList
        });
        const bebasData = clearanceResponse?.data || [];

        currentRombelBebasPustakaMap.clear();
        bebasData.forEach(b => currentRombelBebasPustakaMap.set(String(b.student_nis), b));

        currentRombelPerpusLoans = sirkulasiData || [];
        renderPerpusTableRows();

    } catch (e) {
        console.error('[WaliKelas] Gagal load data perpus rombel:', e);
        tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-rose-500">Gagal memuat data peminjaman buku perpustakaan.</td></tr>';
    }
}

function renderPerpusTableRows() {
    const tbody = document.getElementById('perpus-table-body');
    if (!tbody) return;

    const searchTerm = (document.getElementById('perpus-search-input')?.value || '').toLowerCase().trim();
    const filterStatus = document.getElementById('perpus-filter-status')?.value || 'dipinjam';
    const todayStr = new Date().toISOString().split('T')[0];

    // Summary calculations
    const activeLoans = currentRombelPerpusLoans.filter(l => l.status === 'dipinjam');
    const lateLoans = activeLoans.filter(l => l.tgl_jatuh_tempo && l.tgl_jatuh_tempo < todayStr);
    
    // Unique late students
    const uniqueLateNis = new Set(lateLoans.map(l => l.peminjam_id));
    
    let totalDendaTertunggak = 0;
    activeLoans.forEach(l => {
        if (l.tgl_jatuh_tempo && l.tgl_jatuh_tempo < todayStr) {
            const diffTime = Math.abs(new Date(todayStr) - new Date(l.tgl_jatuh_tempo));
            const lateDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            const rawTarif = (l.tarif_denda_per_hari !== null && l.tarif_denda_per_hari !== undefined) ? Number(l.tarif_denda_per_hari) : 1000;
            totalDendaTertunggak += lateDays * (Number.isNaN(rawTarif) ? 1000 : rawTarif);
        }
    });

    const totalStudents = currentClassStudents ? currentClassStudents.length : 0;
    const countBebasPustaka = currentRombelBebasPustakaMap.size;
    const pctBebas = totalStudents > 0 ? Math.round((countBebasPustaka / totalStudents) * 100) : 0;

    const badgeDipinjam = document.getElementById('perpus-summary-dipinjam-badge');
    const badgeTerlambat = document.getElementById('perpus-summary-terlambat-badge');
    const badgeDenda = document.getElementById('perpus-summary-denda-badge');
    const badgeBebas = document.getElementById('perpus-summary-bebas-pustaka-badge');

    if (badgeDipinjam) badgeDipinjam.textContent = `Buku Dipinjam: ${activeLoans.length}`;
    if (badgeTerlambat) badgeTerlambat.textContent = `Terlambat: ${uniqueLateNis.size} Siswa (${lateLoans.length} Buku)`;
    if (badgeDenda) badgeDenda.textContent = `Total Denda: Rp ${totalDendaTertunggak.toLocaleString('id-ID')}`;
    if (badgeBebas) badgeBebas.innerHTML = `<i class="fa-solid fa-file-shield text-teal-600"></i> Bebas Pustaka: ${countBebasPustaka} / ${totalStudents} (${pctBebas}%)`;

    // Filter bebas pustaka adalah filter siswa, bukan filter transaksi. Render
    // satu baris per siswa agar siswa tanpa riwayat pinjaman tetap terlihat.
    if (filterStatus === 'bebas_pustaka' || filterStatus === 'belum_bebas') {
        const shouldBeApproved = filterStatus === 'bebas_pustaka';
        const studentRows = (currentClassStudents || []).map(student => {
            const nis = String(student.nis || student.id || '').trim();
            const name = student.name || student.nama || '-';
            const approval = currentRombelBebasPustakaMap.get(nis) || null;
            const loans = activeLoans.filter(loan => String(loan.peminjam_id || '').trim() === nis);
            const searchableBooks = loans.map(loan => loan.buku?.judul || '').join(' ').toLowerCase();
            return { student, nis, name, approval, loans, searchableBooks };
        }).filter(row => {
            if (Boolean(row.approval) !== shouldBeApproved) return false;
            if (!searchTerm) return true;
            return row.name.toLowerCase().includes(searchTerm)
                || row.nis.toLowerCase().includes(searchTerm)
                || row.searchableBooks.includes(searchTerm);
        });

        if (studentRows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-slate-400">Tidak ada siswa yang sesuai dengan filter status bebas pustaka.</td></tr>';
            return;
        }

        tbody.innerHTML = studentRows.map((row, idx) => {
            let outstandingFine = 0;
            row.loans.forEach(loan => {
                if (loan.tgl_jatuh_tempo && loan.tgl_jatuh_tempo < todayStr) {
                    const lateDays = Math.ceil(Math.abs(new Date(todayStr) - new Date(loan.tgl_jatuh_tempo)) / (1000 * 60 * 60 * 24));
                    const rawTarif = (loan.tarif_denda_per_hari !== null && loan.tarif_denda_per_hari !== undefined) ? Number(loan.tarif_denda_per_hari) : 1000;
                    outstandingFine += lateDays * (Number.isNaN(rawTarif) ? 1000 : rawTarif);
                }
            });

            const firstLoan = row.loans[0];
            const bookSummary = row.loans.length === 0
                ? '<span class="text-slate-400 italic">Tidak ada pinjaman aktif</span>'
                : `<div class="font-semibold text-slate-800 dark:text-slate-200">${row.loans.length} buku aktif</div>
                   <div class="text-[10px] text-slate-400 max-w-xs truncate" title="${escapeHTML(row.loans.map(loan => loan.buku?.judul || 'Buku').join(', '))}">${escapeHTML(row.loans.map(loan => loan.buku?.judul || 'Buku').join(', '))}</div>`;
            const statusBadge = row.approval
                ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 font-bold text-[10px] border border-teal-200 dark:border-teal-800" title="${escapeHTML(row.approval.no_surat || '')}"><i class="fa-solid fa-file-shield"></i> Bebas Pustaka</span>`
                : row.loans.length > 0
                    ? '<span class="px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 font-bold text-[10px] border border-rose-200">Ada Tanggungan</span>'
                    : '<span class="px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 font-bold text-[10px] border border-amber-200">Belum Diterbitkan</span>';

            return `
                <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition">
                    <td class="p-3 text-center text-slate-400 font-mono">${idx + 1}</td>
                    <td class="p-3"><div class="font-bold text-slate-800 dark:text-white">${escapeHTML(row.name)}</div><div class="text-[10px] text-slate-400 font-mono">NIS: ${escapeHTML(row.nis)}</div></td>
                    <td class="p-3">${bookSummary}</td>
                    <td class="p-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">${firstLoan?.tgl_pinjam || '-'}</td>
                    <td class="p-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">${firstLoan?.tgl_jatuh_tempo || '-'}</td>
                    <td class="p-3 text-center whitespace-nowrap">${statusBadge}</td>
                    <td class="p-3 text-right whitespace-nowrap font-bold ${outstandingFine > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'}">${outstandingFine > 0 ? `Rp ${outstandingFine.toLocaleString('id-ID')}` : '-'}</td>
                </tr>
            `;
        }).join('');
        return;
    }

    // Filter
    let filtered = currentRombelPerpusLoans.filter(l => {
        const isLate = l.status === 'dipinjam' && l.tgl_jatuh_tempo && l.tgl_jatuh_tempo < todayStr;
        const nis = String(l.peminjam_id || '');
        const isBebas = currentRombelBebasPustakaMap.has(nis);

        if (filterStatus === 'dipinjam' && l.status !== 'dipinjam') return false;
        if (filterStatus === 'terlambat' && !isLate) return false;
        if (filterStatus === 'kembali' && l.status !== 'kembali') return false;
        if (filterStatus === 'bebas_pustaka' && !isBebas) return false;
        if (filterStatus === 'belum_bebas' && isBebas) return false;

        if (searchTerm) {
            const name = (l.peminjam_nama || '').toLowerCase();
            const judul = (l.buku?.judul || '').toLowerCase();
            const barcode = (l.eksemplar?.kode_barcode || l.eksemplar?.nomor_induk || '').toLowerCase();

            return name.includes(searchTerm) || nis.includes(searchTerm) || judul.includes(searchTerm) || barcode.includes(searchTerm);
        }

        return true;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-slate-400">Tidak ada data peminjaman yang sesuai dengan filter.</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map((row, idx) => {
        const isLate = row.status === 'dipinjam' && row.tgl_jatuh_tempo && row.tgl_jatuh_tempo < todayStr;
        const nis = String(row.peminjam_id || '');
        const bebasRecord = currentRombelBebasPustakaMap.get(nis);
        let lateDays = 0;
        let dendaNominal = 0;

        if (isLate) {
            const diffTime = Math.abs(new Date(todayStr) - new Date(row.tgl_jatuh_tempo));
            lateDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            const rawTarif = (row.tarif_denda_per_hari !== null && row.tarif_denda_per_hari !== undefined) ? Number(row.tarif_denda_per_hari) : 1000;
            dendaNominal = lateDays * (Number.isNaN(rawTarif) ? 1000 : rawTarif);
        } else if (row.status === 'kembali') {
            dendaNominal = Number(row.total_denda) || 0;
        }

        let badgeStatus = '';
        if (row.status === 'kembali') {
            badgeStatus = `<span class="px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 font-bold text-[10px] border border-emerald-200">Kembali</span>`;
        } else if (isLate) {
            badgeStatus = `<span class="px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 font-bold text-[10px] border border-rose-200 animate-pulse">Terlambat ${lateDays} Hari</span>`;
        } else {
            badgeStatus = `<span class="px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 font-bold text-[10px] border border-blue-200">Dipinjam</span>`;
        }

        const bebasPustakaBadge = bebasRecord
            ? `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 font-bold text-[9px] border border-teal-200 dark:border-teal-800" title="No Surat: ${escapeHTML(bebasRecord.no_surat)}"><i class="fa-solid fa-file-shield"></i> Bebas Pustaka</span>`
            : '';

        return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition">
                <td class="p-3 text-center text-slate-400 font-mono">${idx + 1}</td>
                <td class="p-3">
                    <div class="font-bold text-slate-800 dark:text-white flex items-center gap-1.5">
                        ${escapeHTML(row.peminjam_nama)}
                        ${bebasPustakaBadge}
                    </div>
                    <div class="text-[10px] text-slate-400 font-mono">NIS: ${escapeHTML(row.peminjam_id)}</div>
                </td>
                <td class="p-3">
                    <div class="font-semibold text-slate-800 dark:text-slate-200 max-w-xs truncate" title="${escapeHTML(row.buku?.judul || '')}">${escapeHTML(row.buku?.judul || 'Buku')}</div>
                    <div class="text-[10px] text-slate-400 font-mono">${escapeHTML(row.eksemplar?.kode_barcode || row.eksemplar?.nomor_induk || '-')} (c.${row.eksemplar?.copy_number || 1})</div>
                </td>
                <td class="p-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">${row.tgl_pinjam || '-'}</td>
                <td class="p-3 whitespace-nowrap ${isLate ? 'text-rose-600 dark:text-rose-400 font-bold' : 'text-slate-600 dark:text-slate-400'}">
                    ${row.tgl_jatuh_tempo || '-'}
                </td>
                <td class="p-3 text-center whitespace-nowrap">${badgeStatus}</td>
                <td class="p-3 text-right whitespace-nowrap font-bold ${dendaNominal > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'}">
                    ${dendaNominal > 0 ? `Rp ${dendaNominal.toLocaleString('id-ID')}` : '-'}
                </td>
            </tr>
        `;
    }).join('');
}

window.onWaliPerpusSearchOrFilterChange = function () {
    renderPerpusTableRows();
};

window.exportWaliPerpusExcel = function () {
    if (!currentRombelPerpusLoans || currentRombelPerpusLoans.length === 0) {
        Swal.fire({ icon: 'info', title: 'Data Kosong', text: 'Tidak ada data peminjaman buku untuk rombel ini.', confirmButtonColor: '#4f46e5' });
        return;
    }

    try {
        const todayStr = new Date().toISOString().split('T')[0];
        const rows = currentRombelPerpusLoans.map((row, idx) => {
            const isLate = row.status === 'dipinjam' && row.tgl_jatuh_tempo && row.tgl_jatuh_tempo < todayStr;
            let lateDays = 0;
            let denda = 0;

            if (isLate) {
                const diffTime = Math.abs(new Date(todayStr) - new Date(row.tgl_jatuh_tempo));
                lateDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                const rawTarif = (row.tarif_denda_per_hari !== null && row.tarif_denda_per_hari !== undefined) ? Number(row.tarif_denda_per_hari) : 1000;
                denda = lateDays * (Number.isNaN(rawTarif) ? 1000 : rawTarif);
            } else if (row.status === 'kembali') {
                denda = Number(row.total_denda) || 0;
            }

            return {
                'No': idx + 1,
                'Kelas': currentRombelClass,
                'NIS Siswa': row.peminjam_id,
                'Nama Siswa': row.peminjam_nama,
                'Judul Buku': row.buku?.judul || '-',
                'Pengarang': row.buku?.pengarang || '-',
                'Barcode': row.eksemplar?.kode_barcode || row.eksemplar?.nomor_induk || '-',
                'Tanggal Pinjam': row.tgl_pinjam,
                'Tanggal Jatuh Tempo': row.tgl_jatuh_tempo,
                'Tanggal Kembali': row.tgl_kembali || '-',
                'Status': row.status,
                'Terlambat (Hari)': lateDays,
                'Total Denda (Rp)': denda
            };
        });

        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Peminjaman Perpus Rombel");
        XLSX.writeFile(wb, `Peminjaman_Perpus_Rombel_${currentRombelClass}_${todayStr}.xlsx`);

    } catch (e) {
        console.error('[WaliKelas] Gagal export perpus Excel:', e);
        Swal.fire({ icon: 'error', title: 'Gagal Export', text: e.message, confirmButtonColor: '#4f46e5' });
    }
};

/**
 * Render Tab 6: Master Siswa & Kontak Ortu Siswa Rombel
 */
function renderMasterStudentsTab() {
    const tbody = document.getElementById('master-students-body');
    if (!tbody) return;

    if (!currentRombelClass) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="p-8 text-center text-slate-500 font-medium dark:text-slate-400">
                    <i class="fa-solid fa-hand-pointer text-indigo-500 text-2xl mb-2 block"></i>
                    Silakan pilih Rombel Binaan terlebih dahulu pada menu dropdown di atas.
                </td>
            </tr>
        `;
        return;
    }

    if (currentClassStudents.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="p-6 text-center text-slate-400">Tidak ada siswa pada rombel ini.</td></tr>';
        return;
    }

    const searchQuery = (document.getElementById('input-search-master-students')?.value || '').toLowerCase().trim();

    let rowCount = 0;
    const rowsHtml = currentClassStudents.map(student => {
        const pInfo = resolveStudentParent(student);
        const parentName = pInfo.name;
        const parentPhone = pInfo.phone;
        const cleanPhone = pInfo.cleanPhone;
        const guruWaliName = guruWaliMap[student.nis] || guruWaliMap[String(student.nis).trim()] || '-';
        const isGuruWaliAssigned = Boolean(guruWaliName && guruWaliName !== '-');

        // Pencarian multi-kriteria: Nama Siswa, NIS, NISN, Nama Ortu, Kontak Ortu, Guru Wali
        if (searchQuery) {
            const matchSearch = (student.name || '').toLowerCase().includes(searchQuery) ||
                (student.nis || '').toLowerCase().includes(searchQuery) ||
                (student.nisn || '').toLowerCase().includes(searchQuery) ||
                parentName.toLowerCase().includes(searchQuery) ||
                parentPhone.toLowerCase().includes(searchQuery) ||
                (guruWaliName || '').toLowerCase().includes(searchQuery);
            if (!matchSearch) return '';
        }

        rowCount++;

        // Render Kontak Ortu WA
        let phoneHtml = '<span class="text-slate-400 italic text-[10px]">-</span>';
        if (cleanPhone) {
            phoneHtml = `
                <div class="inline-flex items-center gap-1">
                    <a href="https://wa.me/${cleanPhone}" target="_blank" class="inline-flex items-center gap-0.5 font-mono font-bold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 hover:underline transition text-[10.5px]" title="Chat WhatsApp ${escapeHTML(pInfo.role ? pInfo.role : 'Ortu')}">
                        <i class="fa-brands fa-whatsapp text-emerald-500 text-xs"></i>
                        <span>${escapeHTML(parentPhone)}</span>
                    </a>
                    ${pInfo.role ? `<span class="text-[8.5px] font-semibold px-1 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">${escapeHTML(pInfo.role)}</span>` : ''}
                </div>
            `;
        } else if (parentPhone && parentPhone !== '-') {
            phoneHtml = `<span class="font-mono font-medium text-slate-700 dark:text-slate-200 text-[10.5px]">${escapeHTML(parentPhone)}</span>`;
        }

        // Render Guru Wali
        const guruWaliHtml = isGuruWaliAssigned
            ? `<span class="font-semibold text-slate-800 dark:text-slate-100 truncate max-w-[95px] sm:max-w-[110px] block" title="${escapeHTML(guruWaliName)}">${escapeHTML(guruWaliName)}</span>`
            : `<span class="text-slate-400 italic text-[10px]">Belum Ada</span>`;

        // Render Status Foto KTS
        const hasPending = Boolean(student.pendingPhotoUrl || student.photoStatus === 'pending');
        const hasActive = Boolean(student.activePhotoUrl || student.photoStatus === 'approved');
        const isRejected = Boolean(student.photoStatus === 'rejected');

        let photoStatusBadgeHtml = '';
        if (hasPending) {
            photoStatusBadgeHtml = `
                <button type="button" onclick="window.openVerifyPhotoModal('${escapeHTML(student.nis)}')" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9.5px] font-extrabold bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 border border-amber-300 dark:border-amber-700 animate-pulse hover:bg-amber-200 transition shadow-xs" title="Ada pengajuan foto baru dari siswa. Klik untuk verifikasi">
                    <i class="fa-solid fa-clock-rotate-left text-amber-500"></i> Verif
                </button>
            `;
        } else if (hasActive) {
            photoStatusBadgeHtml = `
                <button type="button" onclick="window.openKtsPreviewModal('${escapeHTML(student.nis)}')" class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9.5px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 transition cursor-pointer" title="Foto resmi aktif. Klik untuk lihat KTS & info publik">
                    <i class="fa-solid fa-circle-check text-emerald-500"></i> Aktif
                </button>
            `;
        } else if (isRejected) {
            photoStatusBadgeHtml = `
                <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9.5px] font-bold bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-800" title="Ditolak: ${escapeHTML(student.photoRejectionReason || '')}">
                    <i class="fa-solid fa-circle-xmark text-rose-500"></i> Ditolak
                </span>
            `;
        } else {
            photoStatusBadgeHtml = `<span class="text-slate-400 italic text-[9.5px]">-</span>`;
        }

        // Render Action Buttons
        const waActionBtn = cleanPhone
            ? `<button onclick="window.openModalWaGenerator('${escapeHTML(student.nis)}', 'ews_warning', 'parent')" class="p-1 px-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 font-bold rounded-md transition text-[10.5px] inline-flex items-center gap-0.5" title="Kirim WA Ortu">
                <i class="fa-brands fa-whatsapp text-xs"></i> WA
               </button>`
            : '';

        const verifyActionBtn = hasPending
            ? `<button onclick="window.openVerifyPhotoModal('${escapeHTML(student.nis)}')" class="p-1 px-2 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-md transition text-[10.5px] inline-flex items-center gap-1 shadow-xs animate-pulse" title="Verifikasi Pengajuan Foto">
                <i class="fa-solid fa-user-check text-[10px]"></i> Verif
               </button>`
            : '';

        const rawPhoto = student.activePhotoUrl || student.active_photo_url || student.photoUrl || student.photo_url || student.foto || student.foto_url || '';
        const resolvedStudentPhoto = (typeof window.resolvePhotoUrl === 'function' && rawPhoto)
            ? window.resolvePhotoUrl(rawPhoto)
            : rawPhoto;
        const safeStudentPhoto = (resolvedStudentPhoto && /^(https?:|\/|data:image\/)/i.test(resolvedStudentPhoto))
            ? window.escapeHTML(resolvedStudentPhoto)
            : '';
        const initial = (student.name || '?').charAt(0).toUpperCase();

        const studentAvatarHtml = safeStudentPhoto
            ? `<div class="w-7 h-8.5 rounded-lg overflow-hidden shrink-0 shadow-2xs ring-1 ring-slate-200 dark:ring-slate-700 bg-slate-100 dark:bg-slate-800">
                <img src="${safeStudentPhoto}" alt="${escapeHTML(student.name)}" class="w-full h-full object-cover" loading="lazy" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'w-full h-full bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-[10px]\\'>${initial}</div>';" />
               </div>`
            : `<div class="w-7 h-8.5 rounded-lg bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-[10px] shrink-0 shadow-2xs ring-1 ring-indigo-400/30">${initial}</div>`;

        let kkBadgeHtml = '';
        if (student.kk_document_url) {
            const escapedStudentName = escapeHTML(student.name || '').replace(/'/g, "\\'");
            kkBadgeHtml = `
                <button type="button" onclick="event.stopPropagation(); window.openKKPreviewWali('${escapeHTML(student.nis || '')}', '${escapedStudentName}', '${encodeURIComponent(student.kk_document_url)}', '${student.kk_uploaded_at || ''}')"
                    class="inline-flex items-center gap-1 px-1.5 py-0.5 ml-1 rounded text-[9.5px] font-bold bg-emerald-100 hover:bg-emerald-200 text-emerald-800 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/80 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 transition cursor-pointer"
                    title="Foto KK Terunggah - Klik untuk melihat arsip foto KK">
                    <i class="fa-solid fa-file-invoice text-emerald-600 dark:text-emerald-400"></i>
                    <span>KK</span>
                </button>
            `;
        } else {
            kkBadgeHtml = `
                <span class="inline-flex items-center gap-1 px-1.5 py-0.5 ml-1 rounded text-[8.5px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700" title="Foto KK belum diunggah siswa">
                    <i class="fa-regular fa-file text-[7.5px]"></i>
                    <span>Belum KK</span>
                </span>
            `;
        }

        return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition">
                <td class="px-2 py-1.5 text-center font-semibold text-slate-500 text-[11px]">${rowCount}</td>
                <td class="px-2 py-1.5 font-bold text-slate-800 dark:text-slate-100">
                    <div class="flex items-center flex-wrap gap-1 cursor-pointer group" onclick="window.openModalDetailSiswa('${escapeHTML(student.nis)}')" title="Lihat Profil & Biodata Lengkap">
                        ${studentAvatarHtml}
                        <span class="truncate max-w-[125px] sm:max-w-[140px] text-[11px] leading-snug block group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors" title="${escapeHTML(student.name)}">${escapeHTML(student.name)}</span>
                        ${kkBadgeHtml}
                    </div>
                </td>
                <td class="px-2 py-1.5 text-center leading-tight">
                    <span class="font-mono font-bold text-slate-700 dark:text-slate-200 text-[11px] block">${escapeHTML(student.nis || '-')}</span>
                    <span class="font-mono text-slate-400 text-[9.5px] block">${escapeHTML(student.nisn || '-')}</span>
                </td>
                <td class="px-2 py-1.5 text-center font-bold text-slate-600 dark:text-slate-300 text-[11px]">${escapeHTML(student.gender || student.jenisKelamin || '-')}</td>
                <td class="px-2 py-1.5 font-medium text-slate-700 dark:text-slate-200 text-[11px]">
                    <span class="truncate max-w-[105px] sm:max-w-[120px] block" title="${escapeHTML(parentName)}">${escapeHTML(parentName)}</span>
                </td>
                <td class="px-2 py-1.5 text-center">${phoneHtml}</td>
                <td class="px-2 py-1.5 text-center">${guruWaliHtml}</td>
                <td class="px-2 py-1.5 text-center whitespace-nowrap">${photoStatusBadgeHtml}</td>
                <td class="px-2 py-1.5 text-center whitespace-nowrap space-x-0.5">
                    <button onclick="window.openModalDetailSiswa('${escapeHTML(student.nis)}')" class="p-1 px-1.5 bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200 font-bold rounded-md hover:bg-slate-200 dark:hover:bg-slate-600 transition text-[10.5px] inline-flex items-center gap-0.5" title="Lihat Profil & Biodata Siswa">
                        <i class="fa-solid fa-eye text-[10px]"></i> Detail
                    </button>
                    <button onclick="window.openKtsPreviewModal('${escapeHTML(student.nis)}')" class="p-1 px-1.5 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 font-bold rounded-md hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition text-[10.5px] inline-flex items-center gap-0.5 cursor-pointer" title="Lihat Kartu Pelajar (KTS) & Info Publik">
                        <i class="fa-solid fa-id-card text-[10px]"></i> KTS
                    </button>
                    ${verifyActionBtn}
                    ${waActionBtn}
                </td>
            </tr>
        `;
    }).join('');

    tbody.innerHTML = rowCount > 0
        ? rowsHtml
        : '<tr><td colspan="9" class="p-6 text-center text-slate-400">Tidak ada data siswa yang cocok dengan pencarian.</td></tr>';
}

window.onMasterStudentsSearchChange = function () {
    renderMasterStudentsTab();
};

/**
 * Export Rekap Master Siswa & Kontak Ortu Rombel ke Format Excel
 */
window.exportMasterSiswaExcel = function () {
    if (!currentClassStudents || currentClassStudents.length === 0) {
        showToast('Info', 'Tidak ada data siswa untuk diexport.', 'info');
        return;
    }

    try {
        const rows = currentClassStudents.map((s, idx) => {
            const pInfo = resolveStudentParent(s);
            const guruWaliName = guruWaliMap[s.nis] || guruWaliMap[String(s.nis).trim()] || '-';

            return {
                'No': idx + 1,
                'NIS': s.nis || '-',
                'NISN': s.nisn || '-',
                'Nama Siswa': s.name || '-',
                'Kelas': s.class || currentRombelClass || '-',
                'Jenis Kelamin': s.gender || s.jenisKelamin || '-',
                'Tempat Lahir': s.birthPlace || s.tempatLahir || '-',
                'Tanggal Lahir': s.birthDate || s.tanggalLahir || '-',
                'NIK Siswa': s.nik || '-',
                'No KK': s.kk_no || s.no_kk || '-',
                'Nama Orang Tua / Wali': pInfo.name,
                'Kontak Ortu (WA)': pInfo.phone,
                'Peran Kontak': pInfo.role || '-',
                'Nama Ayah': s.father || s.father_name || s.namaAyah || '-',
                'No HP Ayah': s.father_phone || s.phone_father || '-',
                'Nama Ibu': s.mother || s.mother_name || s.namaIbu || '-',
                'No HP Ibu': s.mother_phone || s.phone_mother || '-',
                'Nama Wali': s.guardian || s.guardian_name || s.nama_wali || '-',
                'No HP Wali': s.guardian_phone || s.phone_wali || '-',
                'No HP Siswa': s.phone_siswa || s.phone || '-',
                'Alamat': s.address || s.alamat || '-',
                'Guru Wali': guruWaliName !== '-' ? guruWaliName : 'Belum Ditugaskan'
            };
        });

        if (typeof XLSX !== 'undefined') {
            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, `Master Siswa ${currentRombelClass}`);
            const dateStr = getLocalISODate();
            XLSX.writeFile(wb, `Master_Siswa_Rombel_${currentRombelClass}_${dateStr}.xlsx`);
            showToast('Sukses', 'Berhasil mengunduh master data siswa rombel ke Excel.', 'success');
        } else {
            showToast('Peringatan', 'Pustaka XLSX belum dimuat untuk export Excel.', 'warning');
        }
    } catch (e) {
        console.error('[WaliKelas] Gagal export master siswa Excel:', e);
        showToast('Error', 'Gagal export data master siswa: ' + e.message, 'error');
    }
};


/**
 * Render Tab 7: Akademik & Catatan Rapor Wali Kelas
 */
function renderRaporTab() {
    const tbody = document.getElementById('rapor-table-body');
    if (!tbody) return;

    if (!currentRombelClass) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="p-8 text-center text-slate-500 font-medium dark:text-slate-400">
                    <i class="fa-solid fa-hand-pointer text-indigo-500 text-2xl mb-2 block"></i>
                    Silakan pilih Rombel Binaan terlebih dahulu pada menu dropdown di atas.
                </td>
            </tr>
        `;
        return;
    }

    const btnBulkPrintRapor = document.getElementById('btn-open-bulk-print-rapor');
    if (btnBulkPrintRapor) {
        btnBulkPrintRapor.classList.remove('hidden');
    }
    const isPerhotelan = isPerhotelanClass(currentRombelClass);
    const btnPrintAllAfektif = document.getElementById('btn-print-all-afektif');
    const btnPrintAllPerhotelan = document.getElementById('btn-print-all-perhotelan');
    if (btnPrintAllAfektif) {
        btnPrintAllAfektif.classList.remove('hidden');
    }
    if (btnPrintAllPerhotelan) {
        if (isPerhotelan) {
            btnPrintAllPerhotelan.classList.remove('hidden');
            btnPrintAllPerhotelan.style.display = 'inline-flex';
        } else {
            btnPrintAllPerhotelan.classList.add('hidden');
            btnPrintAllPerhotelan.style.display = 'none';
        }
    }

    if (currentClassStudents.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="p-6 text-center text-slate-400">Tidak ada siswa.</td></tr>';
        return;
    }

    tbody.innerHTML = currentClassStudents.map((student, idx) => {
        const rawNote = walikelasNotesMap[student.nis] || '';
        const hasNote = Boolean(rawNote && rawNote.trim());
        const catatanHtml = hasNote
            ? `<div class="flex items-start justify-between gap-2">
                   <span class="line-clamp-2 text-slate-800 dark:text-slate-100 font-medium">${escapeHTML(rawNote)}</span>
                   <button type="button" onclick="window.openModalCatatanRapor('${escapeHTML(student.nis || student.id || '')}')" class="shrink-0 p-1 text-slate-400 hover:text-indigo-600 transition" title="Edit Catatan & Buat dengan AI">
                       <i class="fa-solid fa-pencil text-xs"></i>
                   </button>
               </div>`
            : `<button type="button" onclick="window.openModalCatatanRapor('${escapeHTML(student.nis || student.id || '')}')" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-[11px] font-semibold transition active:scale-95" title="Tulis Catatan atau Generate Otomatis dengan AI">
                   <i class="fa-solid fa-wand-magic-sparkles text-indigo-500"></i> Buat Catatan (AI)
               </button>`;

        const rawPhoto = student.activePhotoUrl || student.active_photo_url || student.photoUrl || student.photo_url || student.foto || student.foto_url || '';
        const resolvedPhoto = (typeof window.resolvePhotoUrl === 'function' && rawPhoto)
            ? window.resolvePhotoUrl(rawPhoto)
            : rawPhoto;
        const safePhotoUrl = (resolvedPhoto && /^(https?:|\/|data:image\/)/i.test(resolvedPhoto))
            ? window.escapeHTML(resolvedPhoto)
            : '';
        const initial = (student.name || '?').charAt(0).toUpperCase();

        const raporAvatarHtml = safePhotoUrl
            ? `<div class="w-8 h-9 rounded-lg overflow-hidden shrink-0 shadow-2xs ring-1 ring-slate-200 dark:ring-slate-700 bg-slate-100 dark:bg-slate-800">
                <img src="${safePhotoUrl}" alt="${escapeHTML(student.name)}" class="w-full h-full object-cover" loading="lazy" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'w-full h-full bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs\\'>${initial}</div>';" />
               </div>`
            : `<div class="w-8 h-9 rounded-lg bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs shrink-0 shadow-2xs ring-1 ring-indigo-400/30">${initial}</div>`;

        return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition">
                <td class="p-3 text-center font-semibold text-slate-500">${idx + 1}</td>
                <td class="p-3 font-bold text-slate-800 dark:text-slate-100">
                    <div class="flex items-center gap-2.5">
                        ${raporAvatarHtml}
                        <div class="min-w-0">
                            <div>${escapeHTML(student.name)}</div>
                            <span class="text-[10px] font-mono text-slate-400 block sm:hidden">NIS: ${escapeHTML(student.nis)}</span>
                        </div>
                    </div>
                </td>
                <td class="p-3 text-center font-mono text-slate-600 dark:text-slate-300">${escapeHTML(student.nis)}</td>
                <td class="p-3 text-slate-700 dark:text-slate-200">${catatanHtml}</td>
                <td class="p-3 text-center whitespace-nowrap">
                    <button type="button" onclick="window.openPrintRaporWali('${escapeHTML(student.nis || student.id || '')}')" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg transition inline-flex items-center gap-1.5 shadow-sm text-xs cursor-pointer active:scale-95" title="Buka Pengaturan & Cetak Rapor Siswa">
                        <i class="fa-solid fa-print"></i> Cetak Rapor
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * Setup All Event Listeners
 */
function setupEventListeners() {
    // Refresh data rombel dari server sesuai permintaan pengguna.
    document.getElementById('wali-refresh-data-btn')?.addEventListener('click', async () => {
        if (!currentRombelClass) {
            showToast('Peringatan', 'Pilih rombel binaan terlebih dahulu.', 'warning');
            return;
        }
        await loadRombelData(currentRombelClass, { forceRefresh: true });
        showToast('Sukses', 'Data rombel diperbarui dari server.', 'success');
    });

    // Tambah Catatan Button
    document.getElementById('btn-tambah-catatan-wali')?.addEventListener('click', () => {
        window.openModalTambahCatatanWali();
    });

    // Catat Pelanggaran Global Button
    document.getElementById('btn-input-record-global')?.addEventListener('click', () => {
        window.openModalInputRecord();
    });

    // Search and Filters
    document.getElementById('ews-search-input')?.addEventListener('input', renderEwsTable);
    document.getElementById('ews-filter-risk')?.addEventListener('change', renderEwsTable);
    document.getElementById('filter-records-student')?.addEventListener('change', renderRecordsTimelineTab);
    document.getElementById('filter-records-type')?.addEventListener('change', renderRecordsTimelineTab);
    document.getElementById('filter-note-student')?.addEventListener('change', renderNotesTab);
    document.getElementById('filter-note-category')?.addEventListener('change', renderNotesTab);
    document.getElementById('input-search-master-students')?.addEventListener('input', renderMasterStudentsTab);

    // Form Submits
    document.getElementById('form-catatan-wali')?.addEventListener('submit', window.saveCatatanWali);

    // Event listener kalkulasi waktu & foto catatan wali
    document.getElementById('form-note-time-start')?.addEventListener('input', window.updateWaliCatatanDurationLabel);
    document.getElementById('form-note-time-start')?.addEventListener('change', window.updateWaliCatatanDurationLabel);
    document.getElementById('form-note-time-end')?.addEventListener('input', window.updateWaliCatatanDurationLabel);
    document.getElementById('form-note-time-end')?.addEventListener('change', window.updateWaliCatatanDurationLabel);

    const formNoteFotoFile = document.getElementById('form-note-foto-file');
    const formNoteFotoCamera = document.getElementById('form-note-foto-camera');
    if (formNoteFotoFile) {
        formNoteFotoFile.addEventListener('change', function () {
            window.handleWaliCatatanPhotoSelect(this.files);
            this.value = '';
        });
    }
    if (formNoteFotoCamera) {
        formNoteFotoCamera.addEventListener('change', function () {
            window.handleWaliCatatanPhotoSelect(this.files);
            this.value = '';
        });
    }
    document.getElementById('form-edit-siswa-wali')?.addEventListener('submit', window.saveEditDataSiswa);
    document.getElementById('form-input-record')?.addEventListener('submit', window.saveRecordRecord);
    document.getElementById('form-catatan-rapor')?.addEventListener('submit', window.saveCatatanRapor);

    // Template WA Select Change
    document.getElementById('wa-template-select')?.addEventListener('change', updateWaPreviewMessage);

    // Violation Autocomplete Input listeners
    const recTitleInput = document.getElementById('record-title');
    const recDrop = document.getElementById('record-violation-dropdown');

    recTitleInput?.addEventListener('input', (e) => {
        const typeSelect = document.getElementById('record-type');
        if (typeSelect && typeSelect.value === 'pelanggaran') {
            renderRecordViolationDropdown(e.target.value);
        }
    });

    recTitleInput?.addEventListener('focus', (e) => {
        const typeSelect = document.getElementById('record-type');
        if (typeSelect && typeSelect.value === 'pelanggaran') {
            renderRecordViolationDropdown(e.target.value);
        }
    });

    document.addEventListener('click', (e) => {
        if (recTitleInput && recDrop) {
            if (!recTitleInput.contains(e.target) && !recDrop.contains(e.target)) {
                recDrop.classList.add('hidden');
            }
        }
    });

    setupTabSwitching();
}

/**
 * Setup Main Tab Navigation Switcher (7 Tabs)
 */
function setupTabSwitching() {
    const tabs = [
        { keys: ['ews', 'ews-kedisiplinan'], btn: 'tab-btn-ews', content: 'tab-content-ews' },
        { keys: ['attendance', 'presensi', 'presensi-permisi'], btn: 'tab-btn-attendance', content: 'tab-content-attendance' },
        { keys: ['jurnal', 'jurnal-mingguan', 'agenda-kelas', 'jurnal-kelas'], btn: 'tab-btn-jurnal', content: 'tab-content-jurnal' },
        { keys: ['points', 'poin', 'perilaku', 'poin-perilaku'], btn: 'tab-btn-points', content: 'tab-content-points' },
        { keys: ['notes', 'catatan', 'pembinaan', 'catatan-pembinaan'], btn: 'tab-btn-notes', content: 'tab-content-notes' },
        { keys: ['spp', 'status-spp', 'pembayaran-spp'], btn: 'tab-btn-spp', content: 'tab-content-spp' },
        { keys: ['students', 'siswa', 'master-siswa', 'rombel'], btn: 'tab-btn-students', content: 'tab-content-students' },
        { keys: ['perpus', 'perpustakaan', 'buku-perpustakaan', 'buku-pinjaman'], btn: 'tab-btn-perpus', content: 'tab-content-perpus' },
        { keys: ['rapor', 'akademik', 'e-rapor'], btn: 'tab-btn-rapor', content: 'tab-content-rapor' }
    ];

    const activateTabByKey = (key) => {
        if (!key) return false;
        const normalizedKey = key.toLowerCase().trim();
        const target = tabs.find(t => t.keys.includes(normalizedKey));
        if (target) {
            const btnEl = document.getElementById(target.btn);
            if (btnEl) {
                btnEl.click();
                return true;
            }
        }
        return false;
    };

    tabs.forEach(({ btn, content }) => {
        const btnEl = document.getElementById(btn);
        if (!btnEl) return;

        btnEl.onclick = () => {
            tabs.forEach(t => {
                const b = document.getElementById(t.btn);
                const c = document.getElementById(t.content);
                if (b && c) {
                    b.classList.remove('active', 'bg-indigo-50', 'dark:bg-indigo-900/40', 'text-indigo-600', 'dark:text-indigo-400');
                    b.classList.add('text-slate-600', 'dark:text-slate-400');
                    c.classList.add('hidden');
                }
            });

            btnEl.classList.add('active', 'bg-indigo-50', 'dark:bg-indigo-900/40', 'text-indigo-600', 'dark:text-indigo-400');
            btnEl.classList.remove('text-slate-600', 'dark:text-slate-400');
            document.getElementById(content)?.classList.remove('hidden');

            if (btn === 'tab-btn-perpus') {
                renderPerpusTab();
            } else if (btn === 'tab-btn-points') {
                renderRecordsTimelineTab();
            } else if (btn === 'tab-btn-students') {
                renderMasterStudentsTab();
                syncRombelPhotoStatuses();
            } else if (btn === 'tab-btn-jurnal') {
                renderWeeklyJurnalTab('tab-content-jurnal', currentRombelClass, null, false);
            }
        };
    });

    const checkUrlTab = () => {
        const urlParams = new URLSearchParams(window.location.search);
        const queryTab = urlParams.get('tab');
        const queryClass = urlParams.get('class');
        if (queryClass) {
            const selectEl = document.getElementById('select-rombel-class');
            if (selectEl && selectEl.value !== queryClass) {
                for (let i = 0; i < selectEl.options.length; i++) {
                    if (selectEl.options[i].value === queryClass || selectEl.options[i].text.includes(queryClass)) {
                        selectEl.selectedIndex = i;
                        selectEl.dispatchEvent(new Event('change'));
                        break;
                    }
                }
            }
        }
        const hashTab = window.location.hash ? window.location.hash.replace('#', '') : null;
        const targetKey = queryTab || hashTab;
        if (targetKey) {
            activateTabByKey(targetKey);
        }
    };

    checkUrlTab();
    window.addEventListener('hashchange', checkUrlTab);
}

/**
 * Open Modal Edit Data Siswa Rombel
 */
window.openModalEditDataSiswa = function (nis) {
    const student = currentClassStudents.find(s => String(s.nis) === String(nis) || String(s.id) === String(nis) || s.nis == nis) || activeStudentForDetail;
    if (!student) return;

    const docId = student.id || student.nis;

    document.getElementById('edit-student-id-hidden').value = docId;
    document.getElementById('edit-student-nis-hidden').value = student.nis || '';

    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = (val !== undefined && val !== null) ? val : '';
    };

    // 1. Identitas Sekolah & Pribadi
    setVal('edit-student-nis', student.nis);
    setVal('edit-student-nisn', student.nisn);
    setVal('edit-student-class', student.class || currentRombelClass);
    setVal('edit-student-name', student.name);
    setVal('edit-student-gender', student.gender || student.jenisKelamin || 'L');
    setVal('edit-student-birthPlace', student.birthPlace || student.pob || student.tempatLahir);
    setVal('edit-student-birthDate', student.birthDate || student.dob || student.tanggalLahir);
    setVal('edit-student-nik', student.nik);
    setVal('edit-student-kk_no', student.kk_no || student.no_kk);
    setVal('edit-student-religion', student.religion || student.agama);
    setVal('edit-student-child_order', student.child_order || student.anakKe);
    setVal('edit-student-jml_saudara_kandung', student.jml_saudara_kandung || student.jml_saudara);
    setVal('edit-student-akta_lahir_reg', student.akta_lahir_reg || student.no_akta);
    setVal('edit-student-sekolah_asal', student.sekolah_asal);

    // 2. Kontak Siswa & Domisili
    setVal('edit-student-phone_siswa', student.phone_siswa || student.phone || student.hpSiswa);
    setVal('edit-student-email', student.email_siswa || student.email);
    setVal('edit-student-living_type', student.living_type || student.jenis_tinggal);
    setVal('edit-student-transportation', student.transportation || student.alat_transportasi);
    setVal('edit-student-address', student.address || student.alamat);
    setVal('edit-student-dusun', student.dusun);
    setVal('edit-student-kelurahan', student.kelurahan);
    setVal('edit-student-kecamatan', student.kecamatan);
    setVal('edit-student-postal_code', student.postal_code || student.kode_pos);
    setVal('edit-student-jarak_sekolah_km', student.jarak_sekolah_km);

    // 3. Data Ayah
    setVal('edit-student-father', student.father || student.namaAyah || student.father_name);
    setVal('edit-student-father_nik', student.father_nik || student.nik_ayah);
    setVal('edit-student-father_birth_year', student.father_birth_year || student.tahun_lahir_ayah);
    setVal('edit-student-father_education', student.father_education || student.pendidikan_ayah);
    setVal('edit-student-father_job', student.father_job || student.pekerjaan_ayah);
    setVal('edit-student-father_income', student.father_income || student.penghasilan_ayah);
    setVal('edit-student-father_phone', student.father_phone || student.phone_father || student.hpAyah);

    // 4. Data Ibu
    setVal('edit-student-mother', student.mother || student.name_parent || student.parentName || student.namaIbu || student.mother_name);
    setVal('edit-student-mother_nik', student.mother_nik || student.nik_ibu);
    setVal('edit-student-mother_birth_year', student.mother_birth_year || student.tahun_lahir_ibu);
    setVal('edit-student-mother_education', student.mother_education || student.pendidikan_ibu);
    setVal('edit-student-mother_job', student.mother_job || student.pekerjaan_ibu);
    setVal('edit-student-mother_income', student.mother_income || student.penghasilan_ibu);
    setVal('edit-student-phone_parent', student.mother_phone || student.phone_mother || student.hpIbu || student.phone_parent);

    // 5. Data Wali
    setVal('edit-student-guardian_name', student.guardian || student.guardian_name || student.nama_wali || student.namaWali);
    setVal('edit-student-guardian_nik', student.guardian_nik || student.nik_wali);
    setVal('edit-student-guardian_birth_year', student.guardian_birth_year || student.tahun_lahir_wali);
    setVal('edit-student-guardian_education', student.guardian_education || student.pendidikan_wali);
    setVal('edit-student-guardian_job', student.guardian_job || student.pekerjaan_wali);
    setVal('edit-student-guardian_income', student.guardian_income || student.penghasilan_wali);
    setVal('edit-student-guardian_phone', student.guardian_phone || student.phone_wali || student.hpWali);

    // 6. Data Fisik & Catatan
    setVal('edit-student-weight', student.weight || student.berat_badan);
    setVal('edit-student-height', student.height || student.tinggi_badan);
    setVal('edit-student-head_circumference', student.head_circumference || student.lingkar_kepala);
    setVal('edit-student-note', student.note);

    window.openModal('modal-edit-data-siswa');
};

/**
 * Save Edit Data Siswa Rombel to Cloudflare D1 (Matching page-students.js SSOT CRUD)
 */
window.saveEditDataSiswa = async function (e) {
    e.preventDefault();

    const docId = document.getElementById('edit-student-id-hidden').value || document.getElementById('edit-student-nis-hidden').value;
    if (!docId) return;

    const getVal = (id) => (document.getElementById(id)?.value || '').trim();

    const fatherPhone = getVal('edit-student-father_phone');
    const motherPhone = getVal('edit-student-phone_parent');
    const emailVal = getVal('edit-student-email');
    const fatherName = getVal('edit-student-father');
    const motherName = getVal('edit-student-mother');
    const guardianName = getVal('edit-student-guardian_name');
    const guardianPhone = getVal('edit-student-guardian_phone');

    const updates = {
        // 1. Identitas Sekolah & Pribadi
        nisn: getVal('edit-student-nisn'),
        class: getVal('edit-student-class'),
        name: getVal('edit-student-name'),
        gender: document.getElementById('edit-student-gender')?.value || 'L',
        birthPlace: getVal('edit-student-birthPlace'),
        birthDate: document.getElementById('edit-student-birthDate')?.value || '',
        nik: getVal('edit-student-nik'),
        kk_no: getVal('edit-student-kk_no'),
        religion: document.getElementById('edit-student-religion')?.value || '',
        child_order: document.getElementById('edit-student-child_order')?.value || '',
        jml_saudara_kandung: document.getElementById('edit-student-jml_saudara_kandung')?.value || '',
        akta_lahir_reg: getVal('edit-student-akta_lahir_reg'),
        no_akta_lahir: getVal('edit-student-akta_lahir_reg'),
        sekolah_asal: getVal('edit-student-sekolah_asal'),

        // 2. Kontak Siswa, Domisili & Transportasi
        phone_siswa: getVal('edit-student-phone_siswa'),
        email_siswa: emailVal,
        email: emailVal,
        living_type: getVal('edit-student-living_type'),
        transportation: getVal('edit-student-transportation'),
        address: getVal('edit-student-address'),
        dusun: getVal('edit-student-dusun'),
        kelurahan: getVal('edit-student-kelurahan'),
        kecamatan: getVal('edit-student-kecamatan'),
        postal_code: getVal('edit-student-postal_code'),
        jarak_sekolah_km: getVal('edit-student-jarak_sekolah_km'),

        // 3. Data Ayah
        father: fatherName,
        father_name: fatherName,
        father_nik: getVal('edit-student-father_nik'),
        father_birth_year: getVal('edit-student-father_birth_year'),
        father_education: getVal('edit-student-father_education'),
        father_job: getVal('edit-student-father_job'),
        father_income: getVal('edit-student-father_income'),
        father_phone: fatherPhone,

        // 4. Data Ibu
        mother: motherName,
        mother_name: motherName,
        name_parent: motherName || fatherName || guardianName,
        mother_nik: getVal('edit-student-mother_nik'),
        mother_birth_year: getVal('edit-student-mother_birth_year'),
        mother_education: getVal('edit-student-mother_education'),
        mother_job: getVal('edit-student-mother_job'),
        mother_income: getVal('edit-student-mother_income'),
        mother_phone: motherPhone,
        phone_parent: motherPhone || fatherPhone || guardianPhone,

        // 5. Data Wali
        guardian: guardianName,
        guardian_name: guardianName,
        guardian_nik: getVal('edit-student-guardian_nik'),
        guardian_birth_year: getVal('edit-student-guardian_birth_year'),
        guardian_education: getVal('edit-student-guardian_education'),
        guardian_job: getVal('edit-student-guardian_job'),
        guardian_income: getVal('edit-student-guardian_income'),
        guardian_phone: guardianPhone,

        // 6. Data Fisik & Catatan
        weight: getVal('edit-student-weight'),
        height: getVal('edit-student-height'),
        head_circumference: getVal('edit-student-head_circumference'),
        note: getVal('edit-student-note'),
        updatedAt: serverTimestamp()
    };

    // Ambil data lama dari cache rombel untuk preservasi data pokok jika dikosongkan (Smart Merge)
    let oldData = currentClassStudents.find(s => s.id === docId || s.nis === docId);
    if (!updates.name && oldData?.name) updates.name = oldData.name;
    if (!updates.class && oldData?.class) updates.class = oldData.class;
    if (!updates.gender && oldData?.gender) updates.gender = oldData.gender;

    // Validasi format NIK/KK & keunikan dengan mode parsial/edit (tidak wajib lengkap 16 digit jika belum siap)
    const idValidation = typeof validateStudentIdentityNumbers === 'function'
        ? validateStudentIdentityNumbers({
            nik: updates.nik,
            kk_no: updates.kk_no,
            father_nik: updates.father_nik,
            mother_nik: updates.mother_nik,
            guardian_nik: updates.guardian_nik
        }, { allowPartial: true, isEdit: true })
        : (window.validateStudentIdentityNumbers ? window.validateStudentIdentityNumbers({
            nik: updates.nik,
            kk_no: updates.kk_no,
            father_nik: updates.father_nik,
            mother_nik: updates.mother_nik,
            guardian_nik: updates.guardian_nik
        }, { allowPartial: true, isEdit: true }) : { valid: true });

    if (!idValidation.valid) {
        showToast('Peringatan Validasi', idValidation.message, 'warning');
        return;
    }

    try {
        if (cfClient && cfClient.enabled) {
            await cfClient.saveStudent({ ...updates, nis: docId }, true);
        }

        if (typeof window.logAudit === 'function') {
            window.logAudit('UPDATE_STUDENT', docId, oldData, updates, `Memperbarui data siswa (Dapodik lengkap): ${updates.name} (${updates.class})`);
        }

        // Sync Metadata & Invalidate Global Students Cache (SSOT)
        if (cfClient && cfClient.enabled) {
            await cfClient.saveSystemSetting('metadata', { lastUpdateStudents: Date.now() });
        }
        if (typeof window.invalidateStudentsCache === 'function') {
            window.invalidateStudentsCache();
        }

        showToast('Sukses', `Data profil siswa ${updates.name} berhasil diperbarui`, 'success');
        window.closeModal('modal-edit-data-siswa');

        if (updates.class === currentRombelClass) {
            currentClassStudents = currentClassStudents
                .map(student => (student.id === docId || student.nis === docId)
                    ? { ...student, ...updates, updatedAt: new Date() }
                    : student)
                .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            renderAllTabs(true);
            writeWaliRombelCache(currentRombelClass);
            updateWaliCacheStatus('fresh');
        } else {
            await loadRombelData(currentRombelClass, { forceRefresh: true });
        }

    } catch (err) {
        console.error('[WaliKelas] Error updating student:', err);
        showToast('Error', 'Gagal memperbarui data profil siswa: ' + err.message, 'error');
    }
};

let violationTypesCache = [];

/**
 * Load Master Violation Types Cache from Cloudflare D1 (0 Firestore Read)
 */
async function loadViolationTypesCache() {
    if (violationTypesCache.length > 0) return;
    try {
        const cached = localStorage.getItem('cache_violation_types');
        if (cached) {
            const parsed = JSON.parse(cached);
            if (Date.now() - (parsed.timestamp || 0) < 3600000) {
                violationTypesCache = parsed.data || [];
                if (violationTypesCache.length > 0) return;
            }
        }
    } catch (e) {
        console.warn('[WaliKelas] Violation cache read error:', e);
    }

    try {
        const types = await cfClient.getViolationTypes();
        violationTypesCache = types || [];
        try {
            localStorage.setItem('cache_violation_types', JSON.stringify({
                data: violationTypesCache,
                timestamp: Date.now()
            }));
        } catch (e) {}
    } catch (err) {
        console.warn('[WaliKelas] Error fetching violation types from D1:', err);
    }
}

/**
 * Render Autocomplete Dropdown for Violation Types in Record Modal
 */
function renderRecordViolationDropdown(searchText) {
    const dropdown = document.getElementById('record-violation-dropdown');
    const titleInput = document.getElementById('record-title');
    const pointsInput = document.getElementById('record-points');
    if (!dropdown || !titleInput) return;

    const queryStr = (searchText || '').toLowerCase().trim();
    const filtered = violationTypesCache.filter(v =>
        (v.title && v.title.toLowerCase().includes(queryStr)) ||
        (v.code && v.code.toLowerCase().includes(queryStr))
    );

    dropdown.innerHTML = '';
    const listToDisplay = queryStr === '' ? violationTypesCache : filtered;

    if (listToDisplay.length === 0) {
        dropdown.innerHTML = '<div class="p-3 text-xs text-slate-400 text-center">Tidak ditemukan jenis pelanggaran yang cocok</div>';
    } else {
        listToDisplay.forEach(v => {
            const item = document.createElement('div');
            item.className = 'p-2.5 hover:bg-amber-50 dark:hover:bg-slate-700/60 cursor-pointer border-b border-slate-100 dark:border-slate-700/50 last:border-0 transition-colors flex items-center justify-between gap-3 text-xs';
            item.innerHTML = `
                <div class="flex items-center gap-2">
                    <span class="font-bold text-slate-700 dark:text-slate-200">${escapeHTML(v.code || '')} - ${escapeHTML(v.title || '')}</span>
                </div>
                <span class="px-2 py-0.5 rounded-md font-extrabold bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 text-[11px]">
                    +${v.points || 0} Poin
                </span>
            `;

            item.addEventListener('click', () => {
                titleInput.value = `${v.code ? v.code + ' - ' : ''}${v.title}`;
                if (pointsInput && v.points !== undefined) {
                    pointsInput.value = v.points;
                }
                dropdown.classList.add('hidden');
            });

            dropdown.appendChild(item);
        });
    }

    // Manual Input Option
    const manualItem = document.createElement('div');
    manualItem.className = 'p-2.5 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer transition-colors flex items-center justify-center gap-2 bg-slate-50 dark:bg-slate-800 font-bold text-indigo-600 dark:text-indigo-400 text-xs border-t border-slate-200 dark:border-slate-700';
    manualItem.innerHTML = `<i class="fa-solid fa-pen"></i> Lainnya / Input Manual`;
    manualItem.addEventListener('click', () => {
        dropdown.classList.add('hidden');
        titleInput.focus();
    });
    dropdown.appendChild(manualItem);

    dropdown.classList.remove('hidden');
}

/**
 * Switch Record Type via Segmented Tab Buttons
 */
window.switchRecordType = function (type) {
    const hiddenTypeInput = document.getElementById('record-type');
    const tabPelanggaran = document.getElementById('tab-record-pelanggaran');
    const tabPrestasi = document.getElementById('tab-record-prestasi');

    if (hiddenTypeInput) hiddenTypeInput.value = type;

    if (type === 'prestasi') {
        if (tabPelanggaran) {
            tabPelanggaran.className = 'py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-all flex items-center justify-center gap-2';
        }
        if (tabPrestasi) {
            tabPrestasi.className = 'py-2.5 text-xs font-bold rounded-lg text-emerald-700 dark:text-emerald-300 bg-white dark:bg-slate-700 shadow-sm border border-slate-200 dark:border-slate-600 transition-all flex items-center justify-center gap-2';
        }
    } else {
        if (tabPelanggaran) {
            tabPelanggaran.className = 'py-2.5 text-xs font-bold rounded-lg text-amber-700 dark:text-amber-300 bg-white dark:bg-slate-700 shadow-sm border border-slate-200 dark:border-slate-600 transition-all flex items-center justify-center gap-2';
        }
        if (tabPrestasi) {
            tabPrestasi.className = 'py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-all flex items-center justify-center gap-2';
        }
    }

    window.handleRecordTypeChange();
};

/**
 * Handle Record Type Change (Pelanggaran vs Prestasi)
 */
window.handleRecordTypeChange = async function () {
    const typeSelect = document.getElementById('record-type');
    const header = document.getElementById('modal-record-header');
    const titleText = document.getElementById('modal-record-title-text');
    const titleLabel = document.getElementById('record-title-label');
    const titleInput = document.getElementById('record-title');
    const pointsContainer = document.getElementById('record-points-container');
    const pointsInput = document.getElementById('record-points');
    const extraPrestasi = document.getElementById('record-prestasi-extra');
    const btnSubmit = document.getElementById('btn-submit-record');
    const dropdown = document.getElementById('record-violation-dropdown');

    if (!typeSelect) return;
    const isPrestasi = typeSelect.value === 'prestasi';

    if (dropdown) dropdown.classList.add('hidden');

    if (isPrestasi) {
        if (header) {
            header.className = 'bg-emerald-600 text-white p-4 flex justify-between items-center transition-colors';
        }
        if (titleText) {
            titleText.innerHTML = '<i class="fa-solid fa-trophy text-lg"></i> Catat Prestasi Siswa';
        }
        if (titleLabel) titleLabel.textContent = 'Nama Kegiatan / Lomba Prestasi *';
        if (titleInput) {
            titleInput.placeholder = 'Misal: Juara 1 OSN Matematika / Duta Sekolah';
            titleInput.value = '';
        }
        if (pointsContainer) pointsContainer.classList.add('hidden');
        if (pointsInput) pointsInput.removeAttribute('required');
        if (extraPrestasi) extraPrestasi.classList.remove('hidden');
        if (btnSubmit) btnSubmit.className = 'flex-1 py-2.5 rounded-xl font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow transition flex items-center justify-center gap-2 active:scale-95';
    } else {
        if (header) {
            header.className = 'bg-amber-600 text-white p-4 flex justify-between items-center transition-colors';
        }
        if (titleText) {
            titleText.innerHTML = '<i class="fa-solid fa-scale-balanced text-lg"></i> Catat Pelanggaran Siswa';
        }
        if (titleLabel) titleLabel.textContent = 'Cari / Pilih Jenis Pelanggaran *';
        if (titleInput) {
            titleInput.placeholder = 'Ketik nama / kode pelanggaran...';
            titleInput.value = '';
        }
        if (pointsContainer) pointsContainer.classList.remove('hidden');
        if (pointsInput) pointsInput.setAttribute('required', 'true');
        if (extraPrestasi) extraPrestasi.classList.add('hidden');
        if (btnSubmit) btnSubmit.className = 'flex-1 py-2.5 rounded-xl font-bold text-white bg-amber-600 hover:bg-amber-700 shadow transition flex items-center justify-center gap-2 active:scale-95';

        // Load master violation types cache
        await loadViolationTypesCache();
    }
};

/**
 * Open Modal Input Record (Pelanggaran / Prestasi)
 */
window.openModalInputRecord = function (defaultNis = null) {
    const select = document.getElementById('record-student-select');
    if (!select) return;

    select.innerHTML = '<option value="">-- Pilih Siswa Rombel --</option>';
    const sortedStudents = [...currentClassStudents].sort((a, b) => 
        (a.name || '').localeCompare((b.name || ''), 'id', { sensitivity: 'base' })
    );
    sortedStudents.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.nis;
        opt.textContent = `${s.name} (${s.nis})`;
        if (defaultNis && defaultNis === s.nis) opt.selected = true;
        select.appendChild(opt);
    });

    if (document.getElementById('record-points')) document.getElementById('record-points').value = '10';
    document.getElementById('record-title').value = '';
    document.getElementById('record-desc').value = '';
    if (document.getElementById('record-organizer')) document.getElementById('record-organizer').value = '';
    if (document.getElementById('record-level')) document.getElementById('record-level').value = 'Sekolah';

    window.switchRecordType('pelanggaran');
    window.openModal('modal-input-record');
};

/**
 * Save Record (Pelanggaran / Prestasi) to Firestore & Update Aggregates (SSOT)
 */
window.saveRecordRecord = async function (e) {
    if (e) e.preventDefault();

    const nis = document.getElementById('record-student-select').value;
    const type = document.getElementById('record-type').value;
    const isPrestasi = type === 'prestasi';
    const points = isPrestasi ? 0 : (parseInt(document.getElementById('record-points')?.value, 10) || 0);
    const title = document.getElementById('record-title').value.trim();
    const desc = document.getElementById('record-desc').value.trim();
    const organizer = document.getElementById('record-organizer')?.value.trim() || '';
    const level = document.getElementById('record-level')?.value || 'Sekolah';

    if (!nis || !title) {
        showToast('Peringatan', 'Pilih siswa dan isi judul catatan', 'warning');
        return;
    }

    const student = currentClassStudents.find(s => String(s.nis) === String(nis) || String(s.id) === String(nis) || s.nis == nis);
    if (!student && nis) {
        console.warn('[WaliKelas] Student not found for NIS:', nis);
        showToast('Info', `Data siswa dengan NIS ${nis} tidak ditemukan`, 'warning');
        return;
    }
    const reporterName = auth.currentUser?.displayName || auth.currentUser?.email || 'Wali Kelas';

    try {
        const cfPayload = {
            id: `${nis}_${Date.now()}`,
            student_nis: nis,
            student_name: student.name || student.nama || '-',
            student_class: currentRombelClass,
            category: isPrestasi ? 'Prestasi' : 'Pelanggaran',
            type: isPrestasi ? (level || 'Prestasi') : title,
            points: isPrestasi ? 0 : points,
            desc: desc || title,
            reporter_uid: auth.currentUser?.uid || '',
            reporter_name: reporterName,
            date: getLocalISODate(),
            timestamp: new Date().toISOString(),
            status: 'active',
            created_by: reporterName
        };

        await cfClient.saveRecord(cfPayload);

        // Cloudflare Worker menghitung ulang agregat di D1. UI diperbarui lokal
        // agar simpan tetap terasa instan tanpa full collection refresh.
        const currentAgg = currentClassAggregates[nis] || {};
        const rawPts = Number(currentAgg.totalPoints ?? currentAgg.poinPelanggaran ?? currentAgg.points ?? 0);
        const currentPoints = isNaN(rawPts) ? 0 : Math.max(0, rawPts);
        const newPoints = isPrestasi ? currentPoints : (currentPoints + points);
        const optimisticAggregate = {
            ...currentAgg,
            nis: nis,
            class: currentRombelClass,
            points: newPoints,
            totalPoints: newPoints,
            poinPelanggaran: newPoints,
            lastBkAction: isPrestasi ? `Prestasi: ${title}` : `Pelanggaran: ${title} (+${points} Poin)`,
            updatedAt: new Date()
        };
        currentClassAggregates[nis] = optimisticAggregate;
        if (typeof window.patchStudentAggregateCache === 'function') {
            window.patchStudentAggregateCache(nis, optimisticAggregate).catch(() => {});
        }

        showToast('Sukses', `Catatan ${type === 'prestasi' ? 'prestasi' : 'pelanggaran'} siswa berhasil disimpan`, 'success');
        window.closeModal('modal-input-record');
        renderAllTabs(true);
        writeWaliRombelCache(currentRombelClass);
        updateWaliCacheStatus('fresh');

    } catch (err) {
        console.error('[WaliKelas] Error saving record:', err);
        showToast('Error', 'Gagal menyimpan catatan kedisiplinan', 'error');
    }
};

/**
 * Open Modal Catatan Rapor Wali Kelas (with Gemini AI Assistant)
 */
window.openModalCatatanRapor = async function (nis) {
    const student = currentClassStudents.find(s => String(s.nis) === String(nis) || String(s.id) === String(nis) || s.nis == nis);
    if (!student) {
        console.warn('[WaliKelas] Student not found for NIS:', nis);
        showToast('Info', `Data siswa dengan NIS ${nis} tidak ditemukan`, 'warning');
        return;
    }

    activePrintStudent = student;
    const targetNisStr = String(nis).trim();

    document.getElementById('rapor-student-nis').value = targetNisStr;
    document.getElementById('rapor-student-name').value = student.name;
    const classEl = document.getElementById('rapor-student-class');
    if (classEl) classEl.textContent = currentRombelClass;

    // Render avatar pasfoto siswa pada modal catatan rapor bila tersedia
    const raporAvatarContainer = document.getElementById('rapor-student-avatar-container');
    if (raporAvatarContainer) {
        const rawPhoto = student.activePhotoUrl || student.active_photo_url || student.photoUrl || student.photo_url || student.foto || student.foto_url || '';
        const resolvedPhoto = (typeof window.resolvePhotoUrl === 'function' && rawPhoto) ? window.resolvePhotoUrl(rawPhoto) : rawPhoto;
        const initial = (student.name || '?').charAt(0).toUpperCase();
        if (resolvedPhoto && /^(https?:|\/|data:image\/)/i.test(resolvedPhoto)) {
            raporAvatarContainer.innerHTML = `<img src="${window.escapeHTML(resolvedPhoto)}" alt="${window.escapeHTML(student.name)}" class="w-full h-full object-cover" onerror="this.onerror=null; this.parentElement.innerHTML='<span class=\\'font-bold text-sm text-indigo-600 dark:text-indigo-300\\'>${initial}</span>';" />`;
        } else {
            raporAvatarContainer.innerHTML = `<span class="font-bold text-sm text-indigo-600 dark:text-indigo-300">${initial}</span>`;
        }
    }

    const currentYearFilter = document.getElementById('tab-rapor-year-filter')?.value || '2026/2027';
    const currentSemFilter = document.getElementById('tab-rapor-semester-filter')?.value || '1';

    const yearSelect = document.getElementById('rapor-academic-year');
    const semSelect = document.getElementById('rapor-semester');

    if (yearSelect) yearSelect.value = currentYearFilter;
    if (semSelect) semSelect.value = currentSemFilter;

    // 1. Ekstraksi Agregat Awal (Mendukung properti D1 SQL: points, violation_count, achievement_count, permission_count)
    const agg = currentClassAggregates[targetNisStr] || currentClassAggregates[student.nis] || currentClassAggregates[nis] || {};
    let poin = Number(agg.totalPoints ?? agg.poinPelanggaran ?? agg.points ?? agg.poin ?? agg.pelanggaran ?? 0);
    let prestasi = Number(agg.totalPrestasi ?? agg.prestasiCount ?? agg.achievement_count ?? agg.prestasi ?? 0);
    let permisi = Number(currentPermissionCounts[targetNisStr] ?? agg.totalPermisi ?? agg.permission_count ?? agg.permisi ?? agg.P ?? 0);

    const attRekap = (Array.isArray(currentAttendanceRekapData) && currentAttendanceRekapData.length > 0)
        ? currentAttendanceRekapData.find(r => String(r.nis).trim() === targetNisStr)
        : null;

    let sakit = attRekap ? Number(attRekap.S || 0) : Number(agg.totalSakit ?? agg.sakit ?? agg.S ?? agg.attendance?.S ?? 0);
    let izin = attRekap ? Number(attRekap.I || 0) : Number(agg.totalIzin ?? agg.izin ?? agg.I ?? agg.attendance?.I ?? 0);
    let alpha = attRekap ? Number(attRekap.A || 0) : Number(agg.totalAlpha ?? agg.alpa ?? agg.alpha ?? agg.A ?? agg.attendance?.A ?? 0);
    let dispen = Number(agg.totalDispen ?? agg.dispen ?? agg.D ?? agg.attendance?.D ?? 0);
    if (attRekap && attRekap.P !== undefined && permisi === 0) {
        permisi = Number(attRekap.P || 0);
    }

    // Render preliminary numbers immediately ke badge modal
    if (document.getElementById('rapor-preview-poin')) document.getElementById('rapor-preview-poin').textContent = isNaN(poin) ? 0 : Math.max(0, poin);
    if (document.getElementById('rapor-preview-prestasi')) document.getElementById('rapor-preview-prestasi').textContent = isNaN(prestasi) ? 0 : Math.max(0, prestasi);
    if (document.getElementById('rapor-preview-alpha')) document.getElementById('rapor-preview-alpha').textContent = isNaN(alpha) ? 0 : Math.max(0, alpha);
    if (document.getElementById('rapor-preview-permisi')) document.getElementById('rapor-preview-permisi').textContent = isNaN(permisi) ? 0 : Math.max(0, permisi);
    if (document.getElementById('rapor-preview-sakit')) document.getElementById('rapor-preview-sakit').textContent = isNaN(sakit) ? 0 : Math.max(0, sakit);
    if (document.getElementById('rapor-preview-izin')) document.getElementById('rapor-preview-izin').textContent = isNaN(izin) ? 0 : Math.max(0, izin);
    if (document.getElementById('rapor-preview-dispen')) document.getElementById('rapor-preview-dispen').textContent = isNaN(dispen) ? 0 : Math.max(0, dispen);

    document.getElementById('rapor-catatan-text').value = walikelasNotesMap[targetNisStr] || walikelasNotesMap[nis] || '';

    // Load AI Assistant controls & user API keys automatically
    window.loadUserApiKeyRapor();

    window.openModal('modal-catatan-rapor');

    // 2. Fetch SSOT records siswa & update preview badges secara live (Anti-Race Condition & 0 Firestore Read)
    try {
        const liveRecords = await ensureStudentRecords(student);
        activePrintStudent.records = liveRecords;

        // Hitung total poin riil dari rincian catatan pelanggaran
        const calculatedPoints = (liveRecords || [])
            .filter(r => r.type === 'pelanggaran' || r.category === 'Pelanggaran' || (r.points && Number(r.points) > 0 && r.type !== 'prestasi' && r.category !== 'Prestasi'))
            .reduce((sum, r) => sum + Number(r.points || 0), 0);

        if (calculatedPoints > 0 && (poin === 0 || isNaN(poin))) {
            poin = calculatedPoints;
            if (document.getElementById('rapor-preview-poin')) {
                document.getElementById('rapor-preview-poin').textContent = poin;
            }
        }

        const calculatedPrestasi = (liveRecords || [])
            .filter(r => r.type === 'prestasi' || r.category === 'Prestasi')
            .length;

        if (calculatedPrestasi > 0 && (prestasi === 0 || isNaN(prestasi))) {
            prestasi = calculatedPrestasi;
            if (document.getElementById('rapor-preview-prestasi')) {
                document.getElementById('rapor-preview-prestasi').textContent = prestasi;
            }
        }
    } catch (errRecModal) {
        console.warn('[WaliKelas] Notice ensure records in openModalCatatanRapor:', errRecModal);
    }
};

/**
 * Handle perubahan Tahun Ajaran / Semester pada Modal Catatan Rapor secara interaktif
 */
window.onRaporModalPeriodChange = async function () {
    if (!activePrintStudent) return;
    const targetNisStr = String(activePrintStudent.nis || activePrintStudent.id || '').trim();
    const yearVal = document.getElementById('rapor-academic-year')?.value || '2026/2027';
    const semVal = document.getElementById('rapor-semester')?.value || '1';

    if (!targetNisStr) return;

    // Load saved notes for this specific academic year and semester from Cloudflare D1
    if (cfClient && cfClient.enabled) {
        try {
            const notes = await cfClient.getWalikelasNotes({ nis: targetNisStr, ta: yearVal });
            let currentText = '';
            if (Array.isArray(notes) && notes.length > 0) {
                if (semVal === 'TA' || semVal === 'FULL' || semVal === 'ALL') {
                    const taDoc = notes.find(n => n.semester === 'TA' || n.semester === 'FULL');
                    const s2Doc = notes.find(n => n.semester === '2');
                    const s1Doc = notes.find(n => n.semester === '1');
                    currentText = (taDoc || s2Doc || s1Doc)?.notes || (taDoc || s2Doc || s1Doc)?.catatanWaliKelas || '';
                } else {
                    const semDoc = notes.find(n => String(n.semester) === String(semVal));
                    currentText = semDoc?.notes || semDoc?.catatanWaliKelas || '';
                }
            }
            const textInput = document.getElementById('rapor-catatan-text');
            if (textInput) textInput.value = currentText;
        } catch (errNotes) {
            console.warn('[WaliKelas] Notice onRaporModalPeriodChange getWalikelasNotes:', errNotes);
        }
    }
};

window.toggleCatatanRaporMode = function (mode) {
    const aiContainer = document.getElementById('rapor-ai-mode-container');
    const noteInput = document.getElementById('rapor-catatan-text');

    if (aiContainer) aiContainer.classList.remove('hidden');
    if (noteInput) {
        // Warna ungu mode catatan menggantikan latar & border dasar (urutan CSS Tailwind build)
        noteInput.classList.remove('bg-slate-50', 'border-slate-200');
        noteInput.classList.add('border-purple-200', 'bg-purple-50');
        noteInput.placeholder = "Tuliskan motivasi, perkembangan belajar, dan saran perkembangan siswa untuk dicetak di rapor atau gunakan AI Assistant...";
    }
    window.loadUserApiKeyRapor();
};

window.userApiKeysRapor = [];
window._deleteKeyPendingRapor = null;

/**
 * Load User API Keys for Rapor AI (SSOT Firestore + localStorage)
 */
async function loadUserApiKeyRapor() {
    const btnGen = document.getElementById('btn-generate-rapor-ai');
    const list = document.getElementById('rapor-api-key-list');
    const addBtn = document.getElementById('btn-rapor-show-add-key');
    const formContainer = document.getElementById('rapor-add-api-key-form-container');
    const cancelBtn = document.getElementById('btn-rapor-cancel-add-key');

    let keys = [];
    let loadedFromLegacyStorage = false;

    // 1. Fetch from Firestore users collection if user logged in
    if (auth.currentUser) {
        try {
            const userDoc = await getDoc(doc(db, PATHS.userSecrets, auth.currentUser.uid));
            if (userDoc.exists()) {
                const data = userDoc.data().geminiApiKey;
                if (Array.isArray(data)) {
                    keys = data;
                } else if (typeof data === 'string' && data.length > 5) {
                    keys = [data];
                }
            }
        } catch (e) {
            console.warn("[WaliKelas] Load key from user doc error:", e.message);
        }
    }

    // 2. Fallback to localStorage keys if array empty
    if (keys.length === 0) {
        const localKey = localStorage.getItem('user_gemini_key') || localStorage.getItem('user_gemini_api_key');
        if (localKey && localKey.trim()) {
            keys = [localKey.trim()];
            loadedFromLegacyStorage = true;
        }
    }
    if (loadedFromLegacyStorage && auth.currentUser) {
        await setDoc(doc(db, PATHS.userSecrets, auth.currentUser.uid), {
            geminiApiKey: keys,
            updatedAt: serverTimestamp()
        }, { merge: true });
    }
    localStorage.removeItem('user_gemini_key');
    localStorage.removeItem('user_gemini_api_key');

    const inputRapor = document.getElementById('user-gemini-api-key-rapor');
    if (inputRapor) inputRapor.value = '';

    window.userApiKeysRapor = keys;

    renderApiKeyListRapor();

    // UI State Logic
    if (window.userApiKeysRapor.length > 0) {
        if (btnGen) btnGen.classList.remove('hidden');
        if (list) list.classList.remove('hidden');
        if (addBtn) addBtn.classList.remove('hidden');
        if (formContainer) formContainer.classList.add('hidden');
    } else {
        if (btnGen) btnGen.classList.add('hidden');
        if (list) list.classList.add('hidden');
        if (addBtn) addBtn.classList.add('hidden');
        if (formContainer) formContainer.classList.remove('hidden');
        if (cancelBtn) cancelBtn.classList.add('hidden');
    }

    // Update dynamic AI Model Display Name badges
    const activeAiConfig = (typeof getAiConfig === 'function' ? getAiConfig() : null) || (typeof AI_CONFIG !== 'undefined' ? AI_CONFIG : { displayName: 'Gemini AI' });
    const badgeLabels = document.querySelectorAll('#gemini-badge-label, #rapor-gemini-badge-label, #wali-gemini-badge-label, .ai-badge-label');
    badgeLabels.forEach(el => { if (el) el.textContent = activeAiConfig.displayName || 'Gemini AI'; });
}
window.loadUserApiKeyRapor = loadUserApiKeyRapor;

window.renderApiKeyListRapor = function () {
    const list = document.getElementById('rapor-api-key-list');
    if (!list) return;
    list.innerHTML = '';
    const canDelete = window.userApiKeysRapor.length > 1;

    window.userApiKeysRapor.forEach((key, index) => {
        const li = document.createElement('li');
        li.className = "flex justify-between items-center bg-white dark:bg-slate-800 px-2.5 py-1.5 border dark:border-slate-700 rounded-lg text-[10px]";
        const masked = key.substring(0, 4) + '...' + key.substring(key.length - 4);
        const deleteBtn = canDelete
            ? `<button type="button" onclick="window.deleteUserApiKeyRapor(${index})" class="text-slate-400 hover:text-red-500 transition-colors px-1" title="Hapus Key"><i class="fa-solid fa-trash-can text-[9px]"></i></button>`
            : '';
        li.innerHTML = `
            <span class="font-mono text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                <i class="fa-solid fa-key text-purple-500 text-[9px]"></i>
                Key ${index + 1}: <b class="text-purple-700 dark:text-purple-300">${escapeHTML(masked)}</b>
                <span class="text-emerald-600 font-bold flex items-center gap-0.5 ml-1.5"><i class="fa-solid fa-circle-check text-[9px]"></i> Valid</span>
            </span>
            ${deleteBtn}
        `;
        list.appendChild(li);
    });
};

window.showAddKeyFormRapor = function () {
    const formContainer = document.getElementById('rapor-add-api-key-form-container');
    const addBtn = document.getElementById('btn-rapor-show-add-key');
    const cancelBtn = document.getElementById('btn-rapor-cancel-add-key');
    const input = document.getElementById('user-gemini-api-key-rapor');

    if (input) input.value = '';
    if (formContainer) formContainer.classList.remove('hidden');
    if (addBtn) addBtn.classList.add('hidden');
    if (cancelBtn) cancelBtn.classList.remove('hidden');

    setTimeout(() => input?.focus(), 100);
};

window.cancelAddKeyRapor = function () {
    const formContainer = document.getElementById('rapor-add-api-key-form-container');
    const addBtn = document.getElementById('btn-rapor-show-add-key');
    if (formContainer) formContainer.classList.add('hidden');
    if (addBtn) addBtn.classList.remove('hidden');
};

window.toggleApiKeyVisibilityRapor = function () {
    const input = document.getElementById('user-gemini-api-key-rapor');
    const icon = document.getElementById('icon-toggle-api-key-rapor');
    if (!input || !icon) return;
    if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'fa-solid fa-eye-slash';
    } else {
        input.type = 'password';
        icon.className = 'fa-solid fa-eye';
    }
};

window.deleteUserApiKeyRapor = async function (index) {
    if (window.userApiKeysRapor.length <= 1) {
        showToast("Info", "Minimal harus ada 1 API Key.", "info");
        return;
    }

    if (window._deleteKeyPendingRapor !== index) {
        window._deleteKeyPendingRapor = index;
        showToast("Konfirmasi", "Klik hapus sekali lagi untuk konfirmasi.", "warning");
        setTimeout(() => { window._deleteKeyPendingRapor = null; }, 3000);
        return;
    }
    window._deleteKeyPendingRapor = null;

    try {
        window.userApiKeysRapor.splice(index, 1);
        if (auth.currentUser) {
            await setDoc(doc(db, PATHS.userSecrets, auth.currentUser.uid), {
                geminiApiKey: window.userApiKeysRapor,
                updatedAt: serverTimestamp()
            }, { merge: true });
        }
        showToast("Info", "API Key dihapus", "success");
        loadUserApiKeyRapor();
    } catch (e) {
        console.error("Gagal hapus key", e);
        showToast("Error", "Gagal hapus key", "error");
        loadUserApiKeyRapor();
    }
};

window.saveUserApiKeyRapor = async function () {
    const input = document.getElementById('user-gemini-api-key-rapor');
    const btn = document.getElementById('btn-save-api-key-rapor');

    if (!input) return;
    const apiKey = input.value.trim();

    if (!apiKey) {
        showToast("Error", "API Key kosong!", "error");
        return;
    }

    if (window.userApiKeysRapor.includes(apiKey)) {
        showToast("Info", "API Key ini sudah ada di list.", "info");
        return;
    }

    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Cek...';

        // Validasi Key ke endpoint Gemini (SSOT dari Pengaturan)
        if (typeof window.validateGeminiApiKeyDirect === 'function') {
            await window.validateGeminiApiKeyDirect(apiKey);
        } else {
            const activeAiConfig = (typeof getAiConfigAsync === 'function' ? await getAiConfigAsync() : null) ||
                                   (typeof getAiConfig === 'function' ? getAiConfig() : null) ||
                                   AI_CONFIG;
            if (!activeAiConfig?.model) {
                throw new Error("Model AI Gemini belum dikonfigurasi di menu Pengaturan. Harap Super Admin mengisi Model ID di Pengaturan Aplikasi.");
            }
            const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${activeAiConfig.model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: "Tes." }] }],
                    generationConfig: { maxOutputTokens: 1 }
                })
            });

            const respData = await resp.json();
            if (!resp.ok) {
                throw new Error(respData.error?.message || resp.statusText);
            }
        }

        window.userApiKeysRapor.push(apiKey);

        if (auth.currentUser) {
            await setDoc(doc(db, PATHS.userSecrets, auth.currentUser.uid), {
                geminiApiKey: window.userApiKeysRapor,
                updatedAt: serverTimestamp()
            }, { merge: true });
        }

        showToast("Sukses", "API Key Ditambahkan & Tersimpan!", "success");
        btn.innerHTML = 'Simpan';
        btn.disabled = false;
        input.value = "";

        loadUserApiKeyRapor();

    } catch (e) {
        console.error("Gagal simpan API Key", e);
        let msg = e.message;
        if (msg.includes('API key not valid')) msg = "API Key Tidak Valid/Salah";
        if (msg.includes('quota')) msg = "Kuota API Key Habis";
        showToast("Gagal", msg, "error");
        btn.innerHTML = 'Simpan';
        btn.disabled = false;
    }
};

window.copyRaporNotes = function () {
    const text = document.getElementById('rapor-catatan-text')?.value;
    if (!text) {
        showToast('Peringatan', 'Tidak ada catatan untuk disalin', 'warning');
        return;
    }
    navigator.clipboard.writeText(text).then(() => {
        showToast('Tersalin', 'Catatan rapor berhasil disalin ke clipboard', 'success');
    }).catch(err => {
        console.error('Gagal salin catatan:', err);
    });
};

window.generateCatatanRaporAI = async function () {
    const isRaporModalOpen = !document.getElementById('modal-catatan-rapor')?.classList.contains('hidden');
    const btn = isRaporModalOpen
        ? (document.getElementById('btn-generate-rapor-ai') || document.getElementById('btn-generate-ai'))
        : (document.getElementById('btn-generate-ai') || document.getElementById('btn-generate-rapor-ai'));
    const textArea = isRaporModalOpen
        ? (document.getElementById('rapor-catatan-text') || document.getElementById('print-notes-input'))
        : (document.getElementById('print-notes-input') || document.getElementById('rapor-catatan-text'));
    const statusEl = isRaporModalOpen
        ? (document.getElementById('rapor-generation-status') || document.getElementById('generation-status'))
        : (document.getElementById('generation-status') || document.getElementById('rapor-generation-status'));

    if (!activePrintStudent) {
        showToast('Peringatan', 'Data siswa tidak ditemukan', 'warning');
        return;
    }

    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Merangkai Kata...';
    }
    if (textArea) textArea.placeholder = "AI sedang menyusun kalimat personal...";

    if (statusEl) statusEl.innerHTML = '<span class="text-[10px] text-purple-600 font-bold"><i class="fa-solid fa-wand-magic-sparkles fa-spin mr-1"></i> Merangkai kalimat personalisasi rapor...</span>';

    try {
        const studentName = activePrintStudent.name;
        const studentNis = String(activePrintStudent.nis || activePrintStudent.id || '').trim();
        const studentClass = currentRombelClass || activePrintStudent.class || 'SMA';
        const yearVal = document.getElementById('tab-rapor-year-filter')?.value || document.getElementById('rapor-academic-year')?.value || '2026/2027';
        const semVal = document.getElementById('print-modal-semester-select')?.value || document.getElementById('tab-rapor-semester-filter')?.value || document.getElementById('rapor-semester')?.value || '1';
        let semLabel = semVal === '1' ? 'Ganjil (Semester 1)' : 'Genap (Semester 2)';
        if (semVal === 'TA' || semVal === 'FULL' || semVal === 'ALL') {
            semLabel = '1 Tahun Penuh (Semester 1 & 2)';
        }

        const isRaporModalOpen = !document.getElementById('modal-catatan-rapor')?.classList.contains('hidden');
        const poin = parseInt((isRaporModalOpen ? document.getElementById('rapor-preview-poin') : document.getElementById('print-preview-poin'))?.innerText || '0') || 0;
        const alpha = parseInt((isRaporModalOpen ? document.getElementById('rapor-preview-alpha') : document.getElementById('print-preview-alpha'))?.innerText || '0') || 0;
        const sakit = parseInt((isRaporModalOpen ? document.getElementById('rapor-preview-sakit') : document.getElementById('print-preview-sakit'))?.innerText || '0') || 0;
        const izin = parseInt((isRaporModalOpen ? document.getElementById('rapor-preview-izin') : document.getElementById('print-preview-izin'))?.innerText || '0') || 0;
        const dispen = parseInt((isRaporModalOpen ? document.getElementById('rapor-preview-dispen') : document.getElementById('print-preview-dispen'))?.innerText || '0') || 0;
        const prestasi = parseInt((isRaporModalOpen ? document.getElementById('rapor-preview-prestasi') : document.getElementById('print-preview-prestasi'))?.innerText || '0') || 0;
        const permisi = parseInt((isRaporModalOpen ? document.getElementById('rapor-preview-permisi') : document.getElementById('print-preview-permisi'))?.innerText || '0') || 0;

        // 1. Ekstrak data records (pelanggaran/prestasi) siswa
        let studentRecords = (Array.isArray(activePrintStudent.records) && activePrintStudent.records.length > 0)
            ? activePrintStudent.records
            : [];
        if (studentRecords.length === 0) {
            try {
                studentRecords = await ensureStudentRecords(studentNis);
            } catch (errAiRec) {
                console.warn('[WaliKelas] Fallback ensure records for AI prompt notice:', errAiRec);
            }
        }
        if (studentRecords.length === 0 && Array.isArray(classRecordsList)) {
            studentRecords = classRecordsList
                .filter(r => String(r.studentNis).trim() === studentNis)
                .map(r => ({
                    type: r.type,
                    category: r.type === 'prestasi' ? 'Prestasi' : 'Pelanggaran',
                    desc: r.title || r.content || '',
                    title: r.title || '',
                    points: r.typeBadgeClass?.includes('rose') ? (r.points || 0) : 0,
                    notes: r.content || ''
                }));
        }

        // 2. Ekstrak data kehadiran (S/I/D reasons)
        let studentAttendance = (Array.isArray(activePrintStudent.attendance) && activePrintStudent.attendance.length > 0)
            ? activePrintStudent.attendance
            : [];
        if (studentAttendance.length === 0 && Array.isArray(currentAttendanceRekapData)) {
            const attRekap = currentAttendanceRekapData.find(r => String(r.nis).trim() === studentNis);
            if (attRekap) {
                studentAttendance = [
                    ...Array(attRekap.S || 0).fill({ status: 'S', note: 'Sakit' }),
                    ...Array(attRekap.I || 0).fill({ status: 'I', note: 'Izin' }),
                    ...Array(attRekap.D || 0).fill({ status: 'D', note: 'Dispensasi' })
                ];
            }
        }

        // 3. Ekstrak data klasikal rombel (komparasi objektif kelas)
        const computeFn = typeof computeClassicalMetrics === 'function' ? computeClassicalMetrics : window.computeClassicalMetrics;
        let classContext = null;
        if (typeof computeFn === 'function') {
            try {
                classContext = computeFn({
                    students: currentClassStudents,
                    aggregates: currentClassAggregates,
                    attendanceRekap: currentAttendanceRekapData,
                    targetNis: studentNis,
                    targetAlpha: alpha
                });
            } catch (errClassical) {
                console.warn('[WaliKelas] Compute classical metrics warning:', errClassical);
            }
        }

        // 4. Data personal pelengkap
        const attRekap = (Array.isArray(currentAttendanceRekapData) && currentAttendanceRekapData.length > 0)
            ? currentAttendanceRekapData.find(r => String(r.nis).trim() === studentNis)
            : null;
        const agg = currentClassAggregates[studentNis] || {};
        const totalHadir = attRekap?.H || agg.hadir || agg.attendance?.H || 0;
        const gender = activePrintStudent.gender || activePrintStudent.jenis_kelamin || '';
        const studentNickName = extractFriendlyStudentName(studentName);

        // Build SSOT prompt via buildRaporNotePrompt helper in config.js
        const prompt = buildRaporNotePrompt({
            studentName: studentName,
            studentNickName: studentNickName,
            studentClass: studentClass,
            gender: gender,
            yearVal: yearVal,
            semVal: semVal,
            poin: poin,
            alpha: alpha,
            sakit: sakit,
            izin: izin,
            dispen: dispen,
            prestasi: prestasi,
            permisi: permisi,
            totalHadir: totalHadir,
            classContext: classContext,
            records: studentRecords,
            attendance: studentAttendance,
            pembinaan: activePrintStudent?.pembinaanList || []
        });

        // 2. Prepare manual key if any in input
        const manualInputKey = isRaporModalOpen
            ? (document.getElementById('user-gemini-api-key-rapor')?.value.trim() || document.getElementById('user-gemini-api-key')?.value.trim())
            : (document.getElementById('user-gemini-api-key')?.value.trim() || document.getElementById('user-gemini-api-key-rapor')?.value.trim());

        // 3. Eksekusi Request dengan Otomatis Fallback Multi-Key
        const activeAiConfig = (typeof getAiConfigAsync === 'function' ? await getAiConfigAsync() : null) ||
                               (typeof getAiConfig === 'function' ? getAiConfig() : null) ||
                               AI_CONFIG;
        if (!activeAiConfig?.model) {
            throw new Error("Model AI Gemini belum dikonfigurasi di menu Pengaturan. Harap Super Admin mengisi Model ID di Pengaturan Aplikasi.");
        }

        const { response: finalResponse, keyLabel: successKeyLabel } = await fetchGeminiWithFallback(
            async (key) => {
                return await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${activeAiConfig.model}:generateContent?key=${encodeURIComponent(key)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: {
                            maxOutputTokens: 250,
                            temperature: 0.7
                        }
                    })
                });
            },
            {
                manualKey: manualInputKey,
                allowSystemKey: true
            }
        );

        // 6. Process Result
        const data = await finalResponse.json();
        if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0].text) {
            let aiText = data.candidates[0].content.parts[0].text.trim();
            // Jika keluaran terpotong tanpa tanda baca akhir, rapikan hingga akhir kalimat terakhir yang utuh
            if (!/[.!?]$/.test(aiText)) {
                const lastPunctuation = Math.max(aiText.lastIndexOf('.'), aiText.lastIndexOf('!'), aiText.lastIndexOf('?'));
                if (lastPunctuation > 20) {
                    aiText = aiText.slice(0, lastPunctuation + 1).trim();
                }
            }
            if (textArea) textArea.value = aiText;
            if (statusEl) {
                const activeAiConfig = (typeof getAiConfig === 'function' ? getAiConfig() : null) || (typeof AI_CONFIG !== 'undefined' ? AI_CONFIG : { displayName: 'Gemini AI' });
                const modelName = (activeAiConfig && activeAiConfig.displayName) ? activeAiConfig.displayName : "Gemini AI";
                statusEl.innerHTML = `Powered by <b>Google ${modelName}</b> — AI terbaru & tercepat`;
                statusEl.className = "text-[9px] text-slate-400 italic mt-1";
            }
            const keyInfo = successKeyLabel ? ` via ${successKeyLabel}` : '';
            showToast("Sukses", `Catatan AI dibuat${keyInfo}`, "success");
        } else {
            throw new Error("Empty AI Response");
        }

    } catch (err) {
        console.warn('[WaliKelas] AI Generation error, running fallback:', err);
        if (statusEl) {
            statusEl.innerHTML = '<i class="fa-solid fa-laptop-code mr-1"></i> System Auto-Gen';
            statusEl.className = "text-[10px] uppercase font-bold tracking-wider text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-700";
        }
        
        // Fallback generator
        try {
            const studentName = activePrintStudent.name;
            const poinEl = isRaporModalOpen ? document.getElementById('rapor-preview-poin') : document.getElementById('print-preview-poin');
            const alphaEl = isRaporModalOpen ? document.getElementById('rapor-preview-alpha') : document.getElementById('print-preview-alpha');
            const prestasiEl = isRaporModalOpen ? document.getElementById('rapor-preview-prestasi') : document.getElementById('print-preview-prestasi');
            const permisiEl = isRaporModalOpen ? document.getElementById('rapor-preview-permisi') : document.getElementById('print-preview-permisi');

            const poin = parseInt(poinEl?.innerText || '0') || 0;
            const alpha = parseInt(alphaEl?.innerText || '0') || 0;
            const prestasi = parseInt(prestasiEl?.innerText || '0') || 0;
            const permisi = parseInt(permisiEl?.innerText || '0') || 0;
            
            runFallbackNotesWali(studentName, poin, alpha, prestasi > 0, permisi > 0, textArea);
            showToast('Mode Offline', 'Generator Lokal Digunakan', 'info');
        } catch (eFb) {
            console.error('[WaliKelas] Fallback notes error:', eFb);
            if (textArea) textArea.value = "Tetap semangat belajar, tingkatkan kedisiplinan dan pertahankan kebaikan yang sudah dicapai.";
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText || '<i class="fa-solid fa-wand-magic-sparkles mr-1"></i> Generate Catatan Otomatis dengan AI';
        }
        if (textArea) textArea.focus();
    }
};

const TEMPLATES_WALI = {
    opening: [
        "Berdasarkan pengamatan kami selama semester ini,",
        "Evaluasi perkembangan karakter ananda menunjukkan bahwa",
        "Secara keseluruhan, pemantauan kami di sekolah memperlihatkan",
        "Dari catatan keseharian di kelas, kami menyimpulkan",
        "Hasil evaluasi kepribadian semester ini menggambarkan",
        "Kami melihat perkembangan ananda ${name} yang berproses,"
    ],
    discipline: {
        perfect: [
            "ananda ${name} menjaga integritas diri dengan sangat baik tanpa catatan pelanggaran.",
            "kedisiplinan ananda patut menjadi teladan bagi teman-temannya.",
            "ananda menunjukkan kematangan sikap dengan selalu menaati tata tertib sekolah.",
            "karakter santun dan disiplin ananda sangat kami apresiasi.",
            "konsistensi ananda dalam berperilaku baik sangat membanggakan sekolah.",
            "tidak ada satu pun catatan negatif, mencerminkan pribadi yang bertanggung jawab."
        ],
        minor: [
            "secara umum perilaku ananda baik, namun ada sedikit catatan kecil yang perlu diperbaiki.",
            "ananda anak yang baik, meski sesekali perlu diingatkan terkait aturan.",
            "kedisiplinan sudah cukup mumpuni, tinggal ditingkatkan lagi ketelitiannya pada tata tertib.",
            "kami harap ananda lebih mawas diri agar catatan pelanggaran ringan tidak terulang."
        ],
        major: [
            "kami menyoroti perlunya perbaikan serius dalam hal kedisiplinan dan ketaatan aturan.",
            "mohon orang tua turut membina ananda agar frekuensi pelanggaran dapat ditekan.",
            "perlu adanya perubahan sikap yang signifikan demi kebaikan masa depan ananda.",
            "kami mengharapkan komitmen lebih kuat dari ananda untuk mematuhi tata tertib sekolah."
        ]
    },
    attendance: {
        perfect: [
            "Kehadiran ananda yang rajin sangat menunjang proses belajarnya.",
            "Konsistensi kehadiran ananda sangat baik dan patut dipertahankan.",
            "Disiplin waktu dan kehadiran ananda di kelas sangat memuaskan.",
            "Terima kasih telah menjaga kehadiran yang prima di sekolah."
        ],
        warning: [
            "Mohon agar frekuensi ketidakhadiran dikurangi agar tidak tertinggal pelajaran.",
            "Perlu peningkatan kehadiran agar ananda bisa lebih maksimal menyerap materi di kelas.",
            "Kami menyarankan agar izin keluar atau ketidakhadiran hanya dilakukan jika sangat mendesak."
        ]
    },
    achievement: {
        yes: [
            "Selamat dan bangga atas prestasi yang telah diraih, semoga menjadi motivasi untuk terus berkarya.",
            "Pencapaian ananda di bidang non-akademik turut mengharumkan nama sekolah.",
            "Teruslah asah bakat ananda, prestasi ini adalah bukti potensi yang luar biasa."
        ],
        no: [
            "Kami yakin ananda memiliki potensi terpendam yang siap digali lebih dalam.",
            "Teruslah semangat belajar, kami menantikan partisipasi aktif ananda di kegiatan mendatang.",
            "Jangan ragu untuk mengeksplorasi minat dan bakat baru di lingkungan sekolah."
        ]
    },
    closing: [
        "Teruslah berkarya dan jadilah pribadi yang bermanfaat.",
        "Semoga semester depan membawa pencapaian yang lebih gemilang.",
        "Kami mendukung sepenuhnya langkah ananda menuju kesuksesan.",
        "Pertahankan yang baik dan perbaiki yang kurang, sukses selalu untuk ananda."
    ]
};

function runFallbackNotesWali(name, poin, alpha, hasPrestasi, hasPermisi, textArea) {
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const format = (str) => str.replace(/\$\{name\}/g, name);

    let parts = [];
    parts.push(format(pick(TEMPLATES_WALI.opening)));

    if (poin === 0) parts.push(format(pick(TEMPLATES_WALI.discipline.perfect)));
    else if (poin <= 15) parts.push(format(pick(TEMPLATES_WALI.discipline.minor)));
    else parts.push(format(pick(TEMPLATES_WALI.discipline.major)));

    const totalAbsent = alpha + (hasPermisi ? 3 : 0);
    if (alpha > 0 || totalAbsent > 6) parts.push(format(pick(TEMPLATES_WALI.attendance.warning)));
    else parts.push(format(pick(TEMPLATES_WALI.attendance.perfect)));

    if (hasPrestasi) parts.push(format(pick(TEMPLATES_WALI.achievement.yes)));
    else parts.push(format(pick(TEMPLATES_WALI.achievement.no)));

    parts.push(format(pick(TEMPLATES_WALI.closing)));

    textArea.value = parts.join(" ");
}

/**
 * Save Catatan Rapor Wali Kelas per Semester to `walikelas_notes` Cloudflare D1
 */
window.saveCatatanRapor = async function (e) {
    e.preventDefault();

    const nis = document.getElementById('rapor-student-nis').value;
    const studentName = document.getElementById('rapor-student-name').value;
    const yearVal = document.getElementById('rapor-academic-year')?.value || '2026/2027';
    const semVal = document.getElementById('rapor-semester')?.value || '1';
    const text = document.getElementById('rapor-catatan-text').value.trim();

    if (!nis) return;

    try {
        const cleanYear = yearVal.replace(/\//g, '-');
        const docId = `${nis}_${cleanYear}_${semVal}`;

        if (cfClient && cfClient.enabled) {
            await cfClient.saveWalikelasNote({
                id: docId,
                student_nis: nis,
                student_name: studentName,
                student_class: currentRombelClass,
                academic_year: yearVal,
                semester: semVal,
                notes: text
            });
        }

        if (typeof window.logAudit === 'function') {
            window.logAudit('UPDATE_WALIKELAS_NOTE', 'walikelas_notes', docId, null, `Mengubah Catatan Wali Kelas ${studentName} (${nis}) TA ${yearVal} Sem ${semVal}`);
        }

        const currentActiveYear = document.getElementById('tab-rapor-year-filter')?.value || '2026/2027';
        const currentActiveSem = document.getElementById('tab-rapor-semester-filter')?.value || '1';

        if (currentActiveYear === yearVal && currentActiveSem === semVal) {
            walikelasNotesMap[nis] = text;
            renderRaporTab();
        } else {
            await loadWaliKelasNotes(currentRombelClass);
            renderRaporTab();
        }

        showToast('Sukses', `Catatan Wali Kelas TA ${yearVal} Sem ${semVal} disimpan`, 'success');
        window.closeModal('modal-catatan-rapor');

    } catch (err) {
        console.error('[WaliKelas] Error saving walikelas_note:', err);
        showToast('Error', 'Gagal menyimpan Catatan Wali Kelas', 'error');
    }
};

/**
 * Mengambil seluruh log presensi siswa tertentu dari memori rombel kelas aktif
 */
function getStudentAttendanceLogsFromClass(targetNis, startDateIso, endDateIso) {
    if (!targetNis) return [];
    const cleanTargetNis = String(targetNis).trim();
    const normTargetNis = typeof normalizeNIS === 'function' ? normalizeNIS(cleanTargetNis) : cleanTargetNis.replace(/^0+/, '');

    return (currentClassAttendanceRows || []).filter(rec => {
        if (!rec) return false;
        const recNis = String(rec.student_nis || rec.nis || '').trim();
        const recNormNis = typeof normalizeNIS === 'function' ? normalizeNIS(recNis) : recNis.replace(/^0+/, '');
        const isMatch = (recNis === cleanTargetNis) ||
                        (normTargetNis && recNormNis === normTargetNis) ||
                        (cleanTargetNis.padStart(4, '0') === recNis.padStart(4, '0'));
        if (!isMatch) return false;

        const dateStr = rec.tanggal || rec.date || '';
        if (startDateIso && dateStr && dateStr < startDateIso) return false;
        if (endDateIso && dateStr && dateStr > endDateIso) return false;
        return true;
    });
}
window.getStudentAttendanceLogsFromClass = getStudentAttendanceLogsFromClass;

let activePrintStudent = null;

/**
 * Open Print Rapor Settings Modal (Gemini AI Assistant)
 */
window.openPrintRaporWali = async function (nis) {
    const student = currentClassStudents.find(s => String(s.nis) === String(nis) || String(s.id) === String(nis) || s.nis == nis);
    if (!student) {
        console.warn('[WaliKelas] Student not found for NIS:', nis);
        showToast('Info', `Data siswa dengan NIS ${nis} tidak ditemukan`, 'warning');
        return;
    }

    activePrintStudent = student;

    const nameEl = document.getElementById('print-preview-student-name');
    const periodEl = document.getElementById('print-preview-period');
    if (nameEl) nameEl.textContent = `${student.name} (${student.nis})`;

    const activeYear = document.getElementById('tab-rapor-year-filter')?.value || document.getElementById('rapor-academic-year')?.value || '2026/2027';
    const activeSem = document.getElementById('tab-rapor-semester-filter')?.value || document.getElementById('rapor-semester')?.value || '1';
    let semLabel = '1 (Ganjil)';
    if (activeSem === '2') {
        semLabel = '2 (Genap)';
    } else if (activeSem === 'TA' || activeSem === 'FULL' || activeSem === 'ALL') {
        semLabel = '1 Tahun Ajaran (Sem. 1 & 2)';
    }

    if (periodEl) periodEl.textContent = `Tahun Ajaran ${activeYear} - Semester ${semLabel}`;

    const modalSemSelect = document.getElementById('print-modal-semester-select');
    if (modalSemSelect) {
        modalSemSelect.value = activeSem;
    }

    // Determine Academic Year & Semester Date Range
    const yearParts = activeYear.split('/');
    const startYear = parseInt(yearParts[0], 10) || 2026;
    const endYear = parseInt(yearParts[1], 10) || (startYear + 1);

    let startDateIso = `${startYear}-07-01`;
    let endDateIso = `${endYear}-06-30`;
    if (activeSem === '1') {
        startDateIso = `${startYear}-07-01`;
        endDateIso = `${startYear}-12-31`;
    } else if (activeSem === '2') {
        startDateIso = `${endYear}-01-01`;
        endDateIso = `${endYear}-06-30`;
    }

    // 1. Initial values from cached currentAttendanceRekapData & currentClassAggregates
    const attRekap = (Array.isArray(currentAttendanceRekapData) && currentAttendanceRekapData.length > 0)
        ? currentAttendanceRekapData.find(r => String(r.nis) === String(nis))
        : null;

    const agg = currentClassAggregates[nis] || {};

    let poin = Number(agg.totalPoints ?? agg.poinPelanggaran ?? agg.points ?? agg.poin ?? agg.pelanggaran ?? 0);
    let prestasi = Number(agg.totalPrestasi ?? agg.prestasiCount ?? agg.prestasi ?? 0);
    let sakit = attRekap ? Number(attRekap.S || 0) : Number(agg.totalSakit ?? agg.sakit ?? agg.S ?? agg.attendance?.S ?? agg.attendance?.sakit ?? 0);
    let izin = attRekap ? Number(attRekap.I || 0) : Number(agg.totalIzin ?? agg.izin ?? agg.I ?? agg.attendance?.I ?? agg.attendance?.izin ?? 0);
    let alpha = attRekap ? Number(attRekap.A || 0) : Number(agg.totalAlpha ?? agg.alpa ?? agg.alpha ?? agg.A ?? agg.attendance?.A ?? agg.attendance?.alpa ?? 0);
    let permisi = attRekap ? Number(attRekap.P || 0) : Number(currentPermissionCounts[nis] ?? agg.totalPermisi ?? agg.permisi ?? agg.P ?? agg.attendance?.P ?? 0);
    let dispen = Number(agg.totalDispen ?? agg.dispen ?? agg.D ?? agg.attendance?.D ?? agg.attendance?.dispen ?? 0);

    // Render preliminary numbers immediately
    if (document.getElementById('print-preview-poin')) document.getElementById('print-preview-poin').textContent = isNaN(poin) ? 0 : Math.max(0, poin);
    if (document.getElementById('print-preview-prestasi')) document.getElementById('print-preview-prestasi').textContent = isNaN(prestasi) ? 0 : Math.max(0, prestasi);
    if (document.getElementById('print-preview-alpha')) document.getElementById('print-preview-alpha').textContent = isNaN(alpha) ? 0 : Math.max(0, alpha);
    if (document.getElementById('print-preview-permisi')) document.getElementById('print-preview-permisi').textContent = isNaN(permisi) ? 0 : Math.max(0, permisi);
    if (document.getElementById('print-preview-sakit')) document.getElementById('print-preview-sakit').textContent = isNaN(sakit) ? 0 : Math.max(0, sakit);
    if (document.getElementById('print-preview-izin')) document.getElementById('print-preview-izin').textContent = isNaN(izin) ? 0 : Math.max(0, izin);
    if (document.getElementById('print-preview-dispen')) document.getElementById('print-preview-dispen').textContent = isNaN(dispen) ? 0 : Math.max(0, dispen);

    const ssotDateIso = await getSsotRaporDate();
    const dateInput = document.getElementById('print-date-input');
    if (dateInput) dateInput.value = ssotDateIso;
    const dateDisplay = document.getElementById('print-date-ssot-display');
    if (dateDisplay) {
        dateDisplay.textContent = formatDateIndoFormal(ssotDateIso);
    }

    // Pre-fill text with saved Catatan Wali Kelas if available
    const currentNote = walikelasNotesMap[nis] || '';
    const initialNoteText = (typeof currentNote === 'object' && currentNote !== null ? (currentNote.catatanWaliKelas || currentNote.notes || '') : String(currentNote || '')).trim();
    const textInput = document.getElementById('print-notes-input');
    if (textInput) textInput.value = (typeof currentNote === 'object' && currentNote !== null ? currentNote.catatanWaliKelas : currentNote) || '';
    if (activePrintStudent) {
        activePrintStudent._originalNote = initialNoteText;
    }

    // Load AI Assistant controls & user API keys automatically
    window.loadUserApiKeyWali();

    // Toggle Perhotelan button in print modal for class X & XI
    const btnModalPerhotelan = document.getElementById('btn-print-modal-perhotelan');
    if (btnModalPerhotelan) {
        if (isPerhotelanClass(currentRombelClass || student.class)) {
            btnModalPerhotelan.classList.remove('hidden');
            btnModalPerhotelan.style.display = 'inline-flex';
        } else {
            btnModalPerhotelan.classList.add('hidden');
            btnModalPerhotelan.style.display = 'none';
        }
    }

    window.openModal('print-settings-modal');

    // 2. Fetch live exact attendance & records for this student within date range [startDateIso, endDateIso]
    activePrintDataPromise = (async () => {
        try {
            const studentClass = currentRombelClass || student.class;
            const targetNisStr = String(nis).trim();

            let liveHadir = 0, liveSakit = 0, liveIzin = 0, liveAlpha = 0, livePermisi = 0, liveDispen = 0;
            let hasAttRecords = false;

            // Pastikan catatan pelanggaran/prestasi siswa terambil sempurna dari Cloudflare D1 (Anti-Race Condition)
            await ensureStudentRecords(student);

            // Ambil dari cache baris presensi kelas terlebih dahulu agar data langsung tersedia
            const cachedClassLogs = getStudentAttendanceLogsFromClass(targetNisStr, startDateIso, endDateIso);
            if (cachedClassLogs.length > 0 && activePrintStudent) {
                activePrintStudent.attendance = cachedClassLogs.map(r => ({
                    date: r.tanggal || r.date,
                    status: r.status || 'H',
                    note: r.note || '',
                    className: r.kelas || r.className
                }));
            }

            const { rows: attRows } = await window.fetchStudentAttendanceRange(targetNisStr, startDateIso, endDateIso);
            if (Array.isArray(attRows) && attRows.length > 0) {
                hasAttRecords = true;
                attRows.forEach(rec => {
                    let st = (rec.status || 'H').toString().trim();
                    if (st === 'H' || st === 'Hadir') liveHadir++;
                    else if (st === 'S' || st === 'Sakit') liveSakit++;
                    else if (st === 'I' || st === 'Izin') liveIzin++;
                    else if (st === 'A' || st === 'Alpa') liveAlpha++;
                    else if (st === 'D' || st === 'Dispen') liveDispen++;
                    else if (['P', 'Permisi', 'DIPERBOLEHKAN'].includes(st)) livePermisi++;
                });
            } else if (cachedClassLogs.length > 0) {
                hasAttRecords = true;
                cachedClassLogs.forEach(rec => {
                    let st = (rec.status || 'H').toString().trim();
                    if (st === 'H' || st === 'Hadir') liveHadir++;
                    else if (st === 'S' || st === 'Sakit') liveSakit++;
                    else if (st === 'I' || st === 'Izin') liveIzin++;
                    else if (st === 'A' || st === 'Alpa') liveAlpha++;
                    else if (st === 'D' || st === 'Dispen') liveDispen++;
                    else if (['P', 'Permisi', 'DIPERBOLEHKAN'].includes(st)) livePermisi++;
                });
            }

            if (hasAttRecords) {
                sakit = liveSakit;
                izin = liveIzin;
                alpha = liveAlpha;
                dispen = liveDispen;
                permisi = Math.max(permisi, livePermisi);
                if (activePrintStudent) {
                    activePrintStudent.attendance = (Array.isArray(attRows) && attRows.length > 0)
                        ? attRows
                        : cachedClassLogs.map(r => ({
                            date: r.tanggal || r.date,
                            status: r.status || 'H',
                            note: r.note || '',
                            className: r.kelas || r.className
                        }));
                }
            } else if (cachedClassLogs.length > 0 && activePrintStudent) {
                activePrintStudent.attendance = cachedClassLogs.map(r => ({
                    date: r.tanggal || r.date,
                    status: r.status || 'H',
                    note: r.note || '',
                    className: r.kelas || r.className
                }));
            }

            // Pastikan activePrintStudent.records terisi sempurna
            if (activePrintStudent && (!Array.isArray(activePrintStudent.records) || activePrintStudent.records.length === 0)) {
                await ensureStudentRecords(activePrintStudent);
            }

            // Hitung status tunggakan SPP siswa (SSOT - 0 Firestore Read)
            try {
                const sppData = sppStatusMap[targetNisStr] ||
                                sppStatusMap[normalizeNIS(targetNisStr)] ||
                                sppStatusMap[targetNisStr.padStart(4, '0')] ||
                                null;
                const paymentHistory = sppData?.paymentHistory || {};
                const ratesConfig = await getFinanceRatesWithCache();
                const financeConfig = typeof window.getFinanceConfigCache === 'function' ? await window.getFinanceConfigCache() : null;
                const sppDueDate = Number(financeConfig?.dueDate) || detailSppDueDate || 20;
                const sppTunggakan = calculateStudentTunggakan(student, paymentHistory, ratesConfig, sppDueDate);
                if (activePrintStudent) {
                    activePrintStudent.sppTunggakan = sppTunggakan;
                }
            } catch (errSppCalc) {
                console.warn('[WaliKelas] Gagal kalkulasi tunggakan SPP untuk cetak rapor:', errSppCalc);
            }

            // Live Permisi Requests Count dari Cloudflare D1
            if (cfClient && cfClient.enabled) {
                try {
                    const rawPerm = await cfClient.getPermisiRequests({ student_nis: targetNisStr });
                    let permCount = 0;
                    if (Array.isArray(rawPerm)) {
                        rawPerm.forEach(d => {
                            const status = (d.status || '').toLowerCase();
                            const reqDate = d.date || '';
                            if (['approved', 'wali_approved'].includes(status)) {
                                if (!reqDate || (reqDate >= startDateIso && reqDate <= endDateIso)) {
                                    permCount++;
                                }
                            }
                        });
                    }
                    if (permCount > 0) permisi = Math.max(permisi, permCount);
                } catch (errPerm) {
                    console.warn('[WaliKelas] Live permisi count from D1 error:', errPerm.message);
                }
            }

            // Live Catatan Pembinaan Siswa (Guru Wali, Wali Kelas, & BK) dari Cloudflare D1 (SSOT)
            let livePembinaan = [];
            if (typeof window.fetchStudentPembinaanHistory === 'function') {
                try {
                    livePembinaan = await window.fetchStudentPembinaanHistory(targetNisStr, {
                        startDateIso,
                        endDateIso,
                        studentClass,
                        currentUid: auth.currentUser?.uid || '',
                        currentUserName: currentUserProfile?.name || currentUserProfile?.nama || ''
                    });
                } catch (errPemb) {
                    console.warn('[WaliKelas] Live pembinaan records from D1 error:', errPemb.message);
                }
            }
            if (activePrintStudent) {
                activePrintStudent.pembinaanList = livePembinaan;
            }

            // Update DOM elements with live exact numbers
            if (document.getElementById('print-preview-poin')) document.getElementById('print-preview-poin').textContent = isNaN(poin) ? 0 : Math.max(0, poin);
            if (document.getElementById('print-preview-prestasi')) document.getElementById('print-preview-prestasi').textContent = isNaN(prestasi) ? 0 : Math.max(0, prestasi);
            if (document.getElementById('print-preview-alpha')) document.getElementById('print-preview-alpha').textContent = isNaN(alpha) ? 0 : Math.max(0, alpha);
            if (document.getElementById('print-preview-permisi')) document.getElementById('print-preview-permisi').textContent = isNaN(permisi) ? 0 : Math.max(0, permisi);
            if (document.getElementById('print-preview-sakit')) document.getElementById('print-preview-sakit').textContent = isNaN(sakit) ? 0 : Math.max(0, sakit);
            if (document.getElementById('print-preview-izin')) document.getElementById('print-preview-izin').textContent = isNaN(izin) ? 0 : Math.max(0, izin);
            if (document.getElementById('print-preview-dispen')) document.getElementById('print-preview-dispen').textContent = isNaN(dispen) ? 0 : Math.max(0, dispen);

        } catch (eLive) {
            console.warn('[WaliKelas] Error fetching live student stats:', eLive.message);
        }
    })();
};

window.toggleNoteMode = function (mode) {
    const aiContainer = document.getElementById('ai-mode-container');
    const noteInput = document.getElementById('print-notes-input');

    if (aiContainer) aiContainer.classList.remove('hidden');
    if (noteInput) {
        // Warna ungu mode catatan menggantikan latar & border dasar (urutan CSS Tailwind build)
        noteInput.classList.remove('bg-slate-50', 'border-slate-200');
        noteInput.classList.add('border-purple-200', 'bg-purple-50');
        noteInput.placeholder = "Tulis catatan perkembangan siswa di sini atau gunakan AI Assistant...";
    }
    window.loadUserApiKeyWali();
};

window.userApiKeysWali = [];
window._deleteKeyPendingWali = null;

/**
 * Load User API Keys for Print Rapor Modal (SSOT Firestore + localStorage)
 */
async function loadUserApiKeyWali() {
    const btnGen = document.getElementById('btn-generate-ai');
    const list = document.getElementById('wali-api-key-list');
    const addBtn = document.getElementById('btn-wali-show-add-key');
    const formContainer = document.getElementById('wali-add-api-key-form-container');
    const cancelBtn = document.getElementById('btn-wali-cancel-add-key');

    let keys = [];
    let loadedFromLegacyStorage = false;

    // 1. Check window.userApiKeysRapor first if already loaded
    if (window.userApiKeysRapor && window.userApiKeysRapor.length > 0) {
        keys = [...window.userApiKeysRapor];
    } else if (auth.currentUser) {
        try {
            const userDoc = await getDoc(doc(db, PATHS.userSecrets, auth.currentUser.uid));
            if (userDoc.exists()) {
                const data = userDoc.data().geminiApiKey;
                if (Array.isArray(data)) {
                    keys = data;
                } else if (typeof data === 'string' && data.length > 5) {
                    keys = [data];
                }
            }
        } catch (e) {
            console.warn("[WaliKelas] Load key from user doc error:", e.message);
        }
    }

    // 2. Fallback to localStorage keys if array empty
    if (keys.length === 0) {
        const localKey = localStorage.getItem('user_gemini_key') || localStorage.getItem('user_gemini_api_key');
        if (localKey && localKey.trim()) {
            keys = [localKey.trim()];
            loadedFromLegacyStorage = true;
        }
    }
    if (loadedFromLegacyStorage && auth.currentUser) {
        await setDoc(doc(db, PATHS.userSecrets, auth.currentUser.uid), {
            geminiApiKey: keys,
            updatedAt: serverTimestamp()
        }, { merge: true });
    }
    localStorage.removeItem('user_gemini_key');
    localStorage.removeItem('user_gemini_api_key');

    const inputWali = document.getElementById('user-gemini-api-key');
    if (inputWali) inputWali.value = '';

    window.userApiKeysWali = keys;
    window.userApiKeysRapor = keys;

    renderApiKeyListWali();

    // UI State Logic
    if (window.userApiKeysWali.length > 0) {
        if (btnGen) btnGen.classList.remove('hidden');
        if (list) list.classList.remove('hidden');
        if (addBtn) addBtn.classList.remove('hidden');
        if (formContainer) formContainer.classList.add('hidden');
    } else {
        if (btnGen) btnGen.classList.add('hidden');
        if (list) list.classList.add('hidden');
        if (addBtn) addBtn.classList.add('hidden');
        if (formContainer) formContainer.classList.remove('hidden');
        if (cancelBtn) cancelBtn.classList.add('hidden');
    }

    // Update dynamic AI Model Display Name badges
    const activeAiConfig = (typeof getAiConfig === 'function' ? getAiConfig() : null) || (typeof AI_CONFIG !== 'undefined' ? AI_CONFIG : { displayName: 'Gemini AI' });
    const badgeLabels = document.querySelectorAll('#gemini-badge-label, #rapor-gemini-badge-label, #wali-gemini-badge-label, .ai-badge-label');
    badgeLabels.forEach(el => { if (el) el.textContent = activeAiConfig.displayName || 'Gemini AI'; });
}
window.loadUserApiKeyWali = loadUserApiKeyWali;

window.renderApiKeyListWali = function () {
    const list = document.getElementById('wali-api-key-list');
    if (!list) return;
    list.innerHTML = '';
    const canDelete = window.userApiKeysWali.length > 1;

    window.userApiKeysWali.forEach((key, index) => {
        const li = document.createElement('li');
        li.className = "flex justify-between items-center bg-white dark:bg-slate-800 px-2.5 py-1.5 border dark:border-slate-700 rounded-lg text-[10px]";
        const masked = key.substring(0, 4) + '...' + key.substring(key.length - 4);
        const deleteBtn = canDelete
            ? `<button type="button" onclick="window.deleteUserApiKeyWali(${index})" class="text-slate-400 hover:text-red-500 transition-colors px-1" title="Hapus Key"><i class="fa-solid fa-trash-can text-[9px]"></i></button>`
            : '';
        li.innerHTML = `
            <span class="font-mono text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                <i class="fa-solid fa-key text-purple-500 text-[9px]"></i>
                Key ${index + 1}: <b class="text-purple-700 dark:text-purple-300">${escapeHTML(masked)}</b>
                <span class="text-emerald-600 font-bold flex items-center gap-0.5 ml-1.5"><i class="fa-solid fa-circle-check text-[9px]"></i> Valid</span>
            </span>
            ${deleteBtn}
        `;
        list.appendChild(li);
    });
};

window.showAddKeyFormWali = function () {
    const formContainer = document.getElementById('wali-add-api-key-form-container');
    const addBtn = document.getElementById('btn-wali-show-add-key');
    const cancelBtn = document.getElementById('btn-wali-cancel-add-key');
    const input = document.getElementById('user-gemini-api-key');

    if (input) input.value = '';
    if (formContainer) formContainer.classList.remove('hidden');
    if (addBtn) addBtn.classList.add('hidden');
    if (cancelBtn) cancelBtn.classList.remove('hidden');

    setTimeout(() => input?.focus(), 100);
};

window.cancelAddKeyWali = function () {
    const formContainer = document.getElementById('wali-add-api-key-form-container');
    const addBtn = document.getElementById('btn-wali-show-add-key');
    if (formContainer) formContainer.classList.add('hidden');
    if (addBtn) addBtn.classList.remove('hidden');
};

window.toggleApiKeyVisibilityWali = function () {
    const input = document.getElementById('user-gemini-api-key');
    const icon = document.getElementById('icon-toggle-api-key-wali');
    if (!input || !icon) return;
    if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'fa-solid fa-eye-slash';
    } else {
        input.type = 'password';
        icon.className = 'fa-solid fa-eye';
    }
};

window.deleteUserApiKeyWali = async function (index) {
    if (window.userApiKeysWali.length <= 1) {
        showToast("Info", "Minimal harus ada 1 API Key.", "info");
        return;
    }

    if (window._deleteKeyPendingWali !== index) {
        window._deleteKeyPendingWali = index;
        showToast("Konfirmasi", "Klik hapus sekali lagi untuk konfirmasi.", "warning");
        setTimeout(() => { window._deleteKeyPendingWali = null; }, 3000);
        return;
    }
    window._deleteKeyPendingWali = null;

    try {
        window.userApiKeysWali.splice(index, 1);
        window.userApiKeysRapor = window.userApiKeysWali;
        if (auth.currentUser) {
            await setDoc(doc(db, PATHS.userSecrets, auth.currentUser.uid), {
                geminiApiKey: window.userApiKeysWali,
                updatedAt: serverTimestamp()
            }, { merge: true });
        }
        showToast("Info", "API Key dihapus", "success");
        loadUserApiKeyWali();
    } catch (e) {
        console.error("Gagal hapus key", e);
        showToast("Error", "Gagal hapus key", "error");
        loadUserApiKeyWali();
    }
};

window.saveUserApiKeyWali = async function () {
    const input = document.getElementById('user-gemini-api-key');
    const btn = document.getElementById('btn-save-api-key-wali');

    if (!input) return;
    const apiKey = input.value.trim();

    if (!apiKey) {
        showToast("Error", "API Key kosong!", "error");
        return;
    }

    if (window.userApiKeysWali.includes(apiKey)) {
        showToast("Info", "API Key ini sudah ada di list.", "info");
        return;
    }

    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Cek...';

        // Validasi Key ke endpoint Gemini (SSOT dari Pengaturan)
        if (typeof window.validateGeminiApiKeyDirect === 'function') {
            await window.validateGeminiApiKeyDirect(apiKey);
        } else {
            const activeAiConfig = (typeof getAiConfigAsync === 'function' ? await getAiConfigAsync() : null) ||
                                   (typeof getAiConfig === 'function' ? getAiConfig() : null) ||
                                   AI_CONFIG;
            if (!activeAiConfig?.model) {
                throw new Error("Model AI Gemini belum dikonfigurasi di menu Pengaturan. Harap Super Admin mengisi Model ID di Pengaturan Aplikasi.");
            }
            const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${activeAiConfig.model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: "Tes." }] }],
                    generationConfig: { maxOutputTokens: 1 }
                })
            });

            const respData = await resp.json();
            if (!resp.ok) {
                throw new Error(respData.error?.message || resp.statusText);
            }
        }

        window.userApiKeysWali.push(apiKey);
        window.userApiKeysRapor = window.userApiKeysWali;

        if (auth.currentUser) {
            await setDoc(doc(db, PATHS.userSecrets, auth.currentUser.uid), {
                geminiApiKey: window.userApiKeysWali,
                updatedAt: serverTimestamp()
            }, { merge: true });
        }

        showToast("Sukses", "API Key Ditambahkan & Tersimpan!", "success");
        btn.innerHTML = 'Simpan';
        btn.disabled = false;
        input.value = "";

        loadUserApiKeyWali();

    } catch (e) {
        console.error("Gagal simpan API Key", e);
        let msg = e.message;
        if (msg.includes('API key not valid')) msg = "API Key Tidak Valid/Salah";
        if (msg.includes('quota')) msg = "Kuota API Key Habis";
        showToast("Gagal", msg, "error");
        btn.innerHTML = 'Simpan';
        btn.disabled = false;
    }
};

window.copyPrintNotes = function () {
    const text = document.getElementById('print-notes-input')?.value;
    if (!text || !text.trim()) {
        showToast('Peringatan', 'Tidak ada catatan untuk disalin', 'warning');
        return;
    }
    navigator.clipboard.writeText(text).then(() => {
        showToast('Tersalin', 'Catatan rapor berhasil disalin ke clipboard', 'success');
    }).catch(err => {
        console.error('Gagal salin catatan:', err);
        showToast('Info', 'Gagal menyalin otomatis, silakan salin manual', 'info');
    });
};

window.triggerGenerateCatatanPrintModal = async function () {
    const textInput = document.getElementById('print-notes-input');
    const currentText = (textInput?.value || '').trim();

    if (currentText.length > 0) {
        if (typeof Swal !== 'undefined') {
            const result = await Swal.fire({
                title: 'Timpa Catatan Rapor?',
                text: 'Catatan perkembangan siswa sudah terisi di formulir ini. Apakah Anda yakin ingin membuat catatan baru dengan AI dan menimpa teks yang ada?',
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Ya, Susun Ulang dengan AI',
                cancelButtonText: 'Batal',
                confirmButtonColor: '#7c3aed',
                cancelButtonColor: '#64748b'
            });
            if (!result.isConfirmed) return;
        } else {
            if (!confirm('Catatan perkembangan siswa sudah terisi. Apakah Anda yakin ingin membuat catatan baru dengan AI dan menimpa teks yang ada?')) {
                return;
            }
        }
    }

    await window.generateCatatanRaporAI();
};

window.generateAutoNotesWali = async function () {
    await window.generateCatatanRaporAI();
};

/**
 * Mendapatkan catatan wali kelas yang sudah tersimpan untuk siswa yang aktif di modal cetak
 */
function getExistingSavedPrintNote(nis) {
    if (activePrintStudent && String(activePrintStudent.nis) === String(nis) && activePrintStudent._originalNote !== undefined && activePrintStudent._originalNote !== null) {
        return String(activePrintStudent._originalNote).trim();
    }
    const raw = walikelasNotesMap[nis] || '';
    if (typeof raw === 'object' && raw !== null) {
        return String(raw.catatanWaliKelas || raw.notes || '').trim();
    }
    return String(raw || '').trim();
}
window.getExistingSavedPrintNote = getExistingSavedPrintNote;

/**
 * Save Catatan Wali Kelas directly from Print Rapor Settings Modal
 * @param {boolean} shouldCloseModal - Apakah menutup modal setelah berhasil simpan
 * @param {boolean} onlyIfChanged - Jika true, simpan HANYA jika teks catatan baru atau berbeda dengan catatan yang sudah ada (hemat kuota)
 */
window.saveCatatanFromPrintModal = async function (shouldCloseModal = true, onlyIfChanged = false) {
    if (!activePrintStudent) {
        showToast('Peringatan', 'Data siswa tidak ditemukan', 'warning');
        return false;
    }

    const nis = activePrintStudent.nis;
    const studentName = activePrintStudent.name;
    const yearVal = document.getElementById('tab-rapor-year-filter')?.value || '2026/2027';
    const semVal = document.getElementById('print-modal-semester-select')?.value || document.getElementById('tab-rapor-semester-filter')?.value || '1';
    const text = (document.getElementById('print-notes-input')?.value || '').trim();

    // Verifikasi apakah ada perubahan catatan dibandingkan data tersimpan
    const existingText = getExistingSavedPrintNote(nis);
    const isNoteChanged = (text !== existingText);

    // Jika mode onlyIfChanged aktif dan tidak ada perubahan catatan, lewati penulisan DB tanpa error (0 request)
    if (onlyIfChanged && !isNoteChanged) {
        return false;
    }

    // Jika dipanggil dari tombol manual dan tidak ada perubahan, beri info ramah tanpa membuang kuota DB
    if (!onlyIfChanged && !isNoteChanged) {
        showToast('Info', 'Catatan sudah sesuai (tidak ada perubahan).', 'info');
        if (shouldCloseModal) {
            window.closeModal('print-settings-modal');
        }
        return true;
    }

    const btnSave = document.getElementById('btn-save-note-print-modal');
    if (btnSave) {
        btnSave.disabled = true;
        btnSave.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Menyimpan...';
    }

    try {
        const cleanYear = yearVal.replace(/\//g, '-');
        const docId = `${nis}_${cleanYear}_${semVal}`;

        if (cfClient && cfClient.enabled) {
            await cfClient.saveWalikelasNote({
                id: docId,
                student_nis: nis,
                student_name: studentName,
                student_class: currentRombelClass,
                academic_year: yearVal,
                semester: semVal,
                notes: text
            });
        }

        if (typeof window.logAudit === 'function') {
            window.logAudit('UPDATE_WALIKELAS_NOTE', 'walikelas_notes', docId, null, `Menyimpan Catatan Wali Kelas ${studentName} (${nis}) TA ${yearVal} Sem ${semVal}`);
        }

        walikelasNotesMap[nis] = text;
        if (activePrintStudent && String(activePrintStudent.nis) === String(nis)) {
            activePrintStudent._originalNote = text;
        }
        renderRaporTab();

        showToast('Sukses', `Catatan Wali Kelas ${studentName} berhasil disimpan`, 'success');
        if (shouldCloseModal) {
            window.closeModal('print-settings-modal');
        }
        return true;

    } catch (err) {
        console.error('[WaliKelas] Error saving walikelas_note:', err);
        showToast('Error', 'Gagal menyimpan Catatan Wali Kelas', 'error');
        return false;
    } finally {
        if (btnSave) {
            btnSave.disabled = false;
            btnSave.innerHTML = '<i class="fa-solid fa-floppy-disk font-bold"></i> Simpan Catatan';
        }
    }
};

/**
 * Switch semester inside Print Rapor Settings Modal interactively
 */
window.changePrintPeriod = async function (newSem) {
    if (!activePrintStudent) return;
    const nis = activePrintStudent.nis;
    const targetNisStr = String(nis).trim();

    const activeYear = document.getElementById('tab-rapor-year-filter')?.value || document.getElementById('rapor-academic-year')?.value || '2026/2027';
    const activeSem = newSem || document.getElementById('print-modal-semester-select')?.value || '1';

    let semLabel = '1 (Ganjil)';
    if (activeSem === '2') {
        semLabel = '2 (Genap)';
    } else if (activeSem === 'TA' || activeSem === 'FULL' || activeSem === 'ALL') {
        semLabel = '1 Tahun Ajaran (Sem. 1 & 2)';
    }

    const periodEl = document.getElementById('print-preview-period');
    if (periodEl) periodEl.textContent = `Tahun Ajaran ${activeYear} - Semester ${semLabel}`;

    const yearParts = activeYear.split('/');
    const startYear = parseInt(yearParts[0], 10) || 2026;
    const endYear = parseInt(yearParts[1], 10) || (startYear + 1);

    let startDateIso = `${startYear}-07-01`;
    let endDateIso = `${endYear}-06-30`;
    if (activeSem === '1') {
        startDateIso = `${startYear}-07-01`;
        endDateIso = `${startYear}-12-31`;
    } else if (activeSem === '2') {
        startDateIso = `${endYear}-01-01`;
        endDateIso = `${endYear}-06-30`;
    }

    try {
        // 1. Live Attendance Range
        let liveHadir = 0, liveSakit = 0, liveIzin = 0, liveAlpha = 0, livePermisi = 0, liveDispen = 0;
        const { rows: attRows } = await window.fetchStudentAttendanceRange(targetNisStr, startDateIso, endDateIso);
        if (Array.isArray(attRows) && attRows.length > 0) {
            attRows.forEach(rec => {
                let st = (rec.status || 'H').toString().trim();
                if (st === 'H' || st === 'Hadir') liveHadir++;
                else if (st === 'S' || st === 'Sakit') liveSakit++;
                else if (st === 'I' || st === 'Izin') liveIzin++;
                else if (st === 'A' || st === 'Alpa') liveAlpha++;
                else if (st === 'D' || st === 'Dispen') liveDispen++;
                else if (['P', 'Permisi', 'DIPERBOLEHKAN'].includes(st)) livePermisi++;
            });
            activePrintStudent.attendance = attRows;
            if (document.getElementById('print-preview-sakit')) document.getElementById('print-preview-sakit').textContent = liveSakit;
            if (document.getElementById('print-preview-izin')) document.getElementById('print-preview-izin').textContent = liveIzin;
            if (document.getElementById('print-preview-alpha')) document.getElementById('print-preview-alpha').textContent = liveAlpha;
            if (document.getElementById('print-preview-dispen')) document.getElementById('print-preview-dispen').textContent = liveDispen;
            if (document.getElementById('print-preview-permisi')) document.getElementById('print-preview-permisi').textContent = livePermisi;
        }

        // 2. Live Permisi D1
        if (cfClient && cfClient.enabled) {
            try {
                const rawPerm = await cfClient.getPermisiRequests({ student_nis: targetNisStr });
                let permCount = 0;
                if (Array.isArray(rawPerm)) {
                    rawPerm.forEach(d => {
                        const status = (d.status || '').toLowerCase();
                        const reqDate = d.date || '';
                        if (['approved', 'wali_approved'].includes(status)) {
                            if (!reqDate || (reqDate >= startDateIso && reqDate <= endDateIso)) {
                                permCount++;
                            }
                        }
                    });
                }
                if (permCount > 0 && document.getElementById('print-preview-permisi')) {
                    document.getElementById('print-preview-permisi').textContent = Math.max(Number(document.getElementById('print-preview-permisi').textContent) || 0, permCount);
                }
            } catch (ePerm) {}
        }

        // 3. Live Pembinaan SSOT
        if (typeof window.fetchStudentPembinaanHistory === 'function') {
            const livePemb = await window.fetchStudentPembinaanHistory(targetNisStr, {
                startDateIso,
                endDateIso,
                studentClass: currentRombelClass || activePrintStudent.class,
                currentUid: auth.currentUser?.uid || '',
                currentUserName: currentUserProfile?.name || currentUserProfile?.nama || ''
            });
            activePrintStudent.pembinaanList = livePemb;
        }

        // 4. Pre-fill Catatan Wali Kelas untuk Semester Ini
        if (cfClient && cfClient.enabled) {
            const notes = await cfClient.getWalikelasNotes({ nis: targetNisStr, ta: activeYear });
            let currentText = '';
            if (Array.isArray(notes) && notes.length > 0) {
                if (activeSem === 'TA' || activeSem === 'FULL' || activeSem === 'ALL') {
                    const taDoc = notes.find(n => n.semester === 'TA' || n.semester === 'FULL');
                    const s2Doc = notes.find(n => n.semester === '2');
                    const s1Doc = notes.find(n => n.semester === '1');
                    currentText = (taDoc || s2Doc || s1Doc)?.notes || (taDoc || s2Doc || s1Doc)?.catatanWaliKelas || '';
                } else {
                    const semDoc = notes.find(n => String(n.semester) === String(activeSem));
                    currentText = semDoc?.notes || semDoc?.catatanWaliKelas || '';
                }
            }
            const textInput = document.getElementById('print-notes-input');
            if (textInput) textInput.value = currentText;
            if (activePrintStudent) {
                activePrintStudent._originalNote = (currentText || '').trim();
            }
        }
    } catch (eChange) {
        console.warn('[WaliKelas] changePrintPeriod error:', eChange);
    }
};

/**
 * Export Catatan Wali Kelas (Tab 7 Rapor) to Excel (.xlsx)
 */
window.exportCatatanRaporExcel = function () {
    if (typeof XLSX === 'undefined') {
        showToast("Error", "Library SheetJS (XLSX) belum dimuat. Mohon muat ulang halaman.", "error");
        return;
    }

    if (!currentClassStudents || currentClassStudents.length === 0) {
        showToast("Peringatan", "Data siswa rombel kosong.", "warning");
        return;
    }

    const yearVal = document.getElementById('tab-rapor-year-filter')?.value || '2026/2027';
    const semVal = document.getElementById('tab-rapor-semester-filter')?.value || '1';
    let semLabel = semVal === '1' ? '1 (Ganjil)' : '2 (Genap)';
    if (semVal === 'TA' || semVal === 'FULL' || semVal === 'ALL') {
        semLabel = '1 & 2 (1 Tahun Penuh)';
    }

    const excelData = [];

    currentClassStudents.forEach((student, index) => {
        const nis = student.nis || student.id || '';
        const nisn = student.nisn || '';
        const name = student.name || 'Siswa';
        const gender = student.gender || student.sex || 'L';
        const studentClass = currentRombelClass || student.class || '';

        const noteObj = walikelasNotesMap[nis] || null;
        let noteText = '';
        let status = 'Belum Ada Catatan';
        let lastUpdated = '-';

        if (noteObj) {
            if (typeof noteObj === 'string') {
                noteText = noteObj;
                status = noteText ? 'Tersimpan' : 'Belum Ada Catatan';
            } else if (typeof noteObj === 'object') {
                noteText = noteObj.catatanWaliKelas || '';
                status = noteText ? 'Tersimpan' : 'Draft Kosong';
                if (noteObj.updatedAt) {
                    try {
                        const dateObj = noteObj.updatedAt.toDate ? noteObj.updatedAt.toDate() : new Date(noteObj.updatedAt);
                        lastUpdated = formatDateIndo(dateObj);
                    } catch (e) {
                        lastUpdated = '-';
                    }
                }
            }
        }

        excelData.push({
            'No': index + 1,
            'NIS': String(nis),
            'NISN': String(nisn),
            'Nama Siswa': name,
            'L/P': gender,
            'Kelas': studentClass,
            'Tahun Ajaran': yearVal,
            'Semester': semLabel,
            'Catatan Wali Kelas (Rapor)': noteText || '(Belum diisi)',
            'Status Catatan': status,
            'Terakhir Diperbarui': lastUpdated
        });
    });

    try {
        const worksheet = XLSX.utils.json_to_sheet(excelData);

        // Auto-fit column widths
        const colWidths = [
            { wch: 5 },   // No
            { wch: 12 },  // NIS
            { wch: 15 },  // NISN
            { wch: 28 },  // Nama Siswa
            { wch: 6 },   // L/P
            { wch: 12 },  // Kelas
            { wch: 14 },  // Tahun Ajaran
            { wch: 18 },  // Semester
            { wch: 45 },  // Catatan Wali Kelas (Rapor)
            { wch: 16 },  // Status Catatan
            { wch: 22 }   // Terakhir Diperbarui
        ];
        worksheet['!cols'] = colWidths;

        const workbook = XLSX.utils.book_new();
        const sheetName = (semVal === 'TA' || semVal === 'FULL' || semVal === 'ALL') ? `Catatan Rapor 1 Tahun` : `Catatan Rapor Sem ${semVal}`;
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

        const cleanClass = (currentRombelClass || 'Rombel').replace(/[^a-zA-Z0-9_-]/g, '_');
        const cleanYear = yearVal.replace('/', '-');
        const semSuffix = (semVal === 'TA' || semVal === 'FULL' || semVal === 'ALL') ? '1Tahun' : `Sem${semVal}`;
        const fileName = `Catatan_Rapor_Wali_Kelas_${cleanClass}_${cleanYear}_${semSuffix}.xlsx`;

        XLSX.writeFile(workbook, fileName);
        showToast("Sukses", `Rekap Catatan Rapor ${currentRombelClass} berhasil diunduh (${currentClassStudents.length} siswa)`, "success");

        if (typeof window.logAudit === 'function') {
            window.logAudit('EXPORT_EXCEL_CATATAN_RAPOR', 'walikelas_notes', cleanClass, null, `Export Excel Catatan Rapor Wali Kelas ${currentRombelClass} TA ${yearVal} Sem ${semVal}`);
        }
    } catch (err) {
        console.error("Export Excel error:", err);
        showToast("Error", "Gagal mengunduh file Excel", "error");
    }
};

/**
 * Helper SSOT Tanggal Cetak Rapor Resmi Sekolah
 * Mengambil tanggal resmi yang diatur oleh Wakasek Kurikulum / Super Admin di Pengaturan E-Rapor (Cloudflare D1 system_settings.rapor_config).
 */
let ssotRaporConfigCache = null;
let ssotRaporConfigTime = 0;

async function getSsotRaporDate() {
    const now = Date.now();
    if (ssotRaporConfigCache && (now - ssotRaporConfigTime < 5 * 60 * 1000)) {
        return ssotRaporConfigCache.tanggal_cetak_rapor || ssotRaporConfigCache.tgl_cetak_rapor || getLocalISODate();
    }

    try {
        if (typeof cfClient !== 'undefined' && cfClient && cfClient.enabled && typeof cfClient.getRaporConfig === 'function') {
            const cfg = await cfClient.getRaporConfig();
            if (cfg) {
                ssotRaporConfigCache = cfg;
                ssotRaporConfigTime = now;
                if (cfg.tanggal_cetak_rapor || cfg.tgl_cetak_rapor) {
                    return cfg.tanggal_cetak_rapor || cfg.tgl_cetak_rapor;
                }
            }
        }
    } catch (e) {
        console.warn('[WaliKelas] Gagal memuat tanggal cetak rapor SSOT:', e);
    }
    return getLocalISODate();
}
window.getSsotRaporDate = getSsotRaporDate;

/**
 * Dialog Konfirmasi Tanggal Cetak Rapor (SSOT Konfirmasi Tanggal Rapor)
 * Memunculkan modal dialog interaktif yang bersih dan modern untuk menentukan/memastikan tanggal rapor sebelum cetak.
 * Format tampilan input tanggal menggunakan standar Indonesia (dd/mm/yyyy).
 * Mengembalikan format ISO string YYYY-MM-DD jika disetujui, atau null jika dibatalkan.
 */
async function promptRaporDateConfirmation(options = {}) {
    const title = options.title || 'Konfirmasi Cetak Rapor';
    const description = options.description || 'Silakan tentukan tanggal rapor yang akan dicantumkan pada lembar cetak:';
    const confirmBtnText = options.confirmButtonText || '<i class="fa-solid fa-print"></i> Cetak Rapor';
    const confirmBtnColor = options.confirmButtonColor || '#0d9488';
    const isPerhotelan = options.theme === 'perhotelan' || (title && title.toLowerCase().includes('perhotelan'));
    const iconGradient = isPerhotelan ? 'from-teal-600 to-emerald-400 shadow-teal-500/25' : 'from-indigo-600 to-purple-500 shadow-indigo-500/25';

    const dateInputEl = document.getElementById('print-date-input');
    const defaultDate = (dateInputEl?.value && /^\d{4}-\d{2}-\d{2}$/.test(dateInputEl.value))
        ? dateInputEl.value
        : (typeof getLocalISODate === 'function' ? getLocalISODate() : new Date().toISOString().split('T')[0]);

    const formatToIndoDmy = (isoStr) => {
        if (!isoStr || !/^\d{4}-\d{2}-\d{2}$/.test(isoStr)) return '';
        const [y, m, d] = isoStr.split('-');
        return `${d}/${m}/${y}`;
    };

    const parseIndoDmyToIso = (dmyStr) => {
        if (!dmyStr || typeof dmyStr !== 'string') return null;
        const str = dmyStr.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
        const match = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
        if (match) {
            const d = parseInt(match[1], 10);
            const m = parseInt(match[2], 10);
            const y = parseInt(match[3], 10);
            if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2100) {
                return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            }
        }
        return null;
    };

    if (typeof Swal === 'undefined') {
        if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
            const entered = window.prompt(`${title}\n${description}`, formatToIndoDmy(defaultDate) || defaultDate);
            if (!entered) return null;
            const parsedIso = parseIndoDmyToIso(entered) || entered;
            if (dateInputEl) dateInputEl.value = parsedIso;
            return parsedIso;
        }
        return defaultDate;
    }

    let initialFormatted = '';
    try {
        initialFormatted = typeof formatDateIndoFormal === 'function' ? formatDateIndoFormal(defaultDate) : defaultDate;
    } catch (e) {
        initialFormatted = defaultDate;
    }

    const defaultDmy = formatToIndoDmy(defaultDate);

    const studentInfoHtml = options.studentInfo
        ? `
        <div class="mb-4 px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/80 rounded-xl text-left flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center text-xs font-bold shrink-0">
                <i class="fa-solid fa-user-graduate"></i>
            </div>
            <div class="text-xs text-slate-700 dark:text-slate-300 font-medium leading-relaxed truncate">
                ${options.studentInfo}
            </div>
        </div>
        `
        : '';

    const { value: selectedDate, isConfirmed } = await Swal.fire({
        html: `
            <div class="text-center pt-1">
                <!-- Modern Gradient Icon Badge -->
                <div class="mx-auto mb-3.5 w-14 h-14 rounded-2xl bg-gradient-to-tr ${iconGradient} text-white flex items-center justify-center shadow-lg">
                    <i class="fa-solid fa-print text-2xl"></i>
                </div>

                <h3 class="text-lg font-bold text-slate-800 dark:text-slate-100 tracking-tight mb-1">
                    ${escapeHTML(title)}
                </h3>
                <p class="text-xs text-slate-500 dark:text-slate-400 mb-4 leading-normal">
                    ${escapeHTML(description)}
                </p>

                ${studentInfoHtml}

                <div class="text-left bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-xl p-3.5 shadow-sm space-y-2">
                    <label for="swal-rapor-date-input" class="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                        <i class="fa-regular fa-calendar text-teal-600 mr-1"></i> Tanggal Rapor:
                    </label>
                    <div class="relative flex items-center">
                        <input type="text" id="swal-rapor-date-input"
                            class="w-full px-3 py-2 pr-10 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-800 dark:text-slate-100 font-medium focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500 transition-all cursor-pointer"
                            placeholder="DD/MM/YYYY (cth: 11/09/2026)"
                            value="${escapeHTML(defaultDmy)}">
                        <button type="button" id="swal-rapor-calendar-btn"
                            class="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 p-1.5 transition-colors pointer-events-none"
                            title="Pilih tanggal dari kalender" tabindex="-1">
                            <i class="fa-regular fa-calendar text-base"></i>
                        </button>
                        <input type="date" id="swal-rapor-native-picker"
                            style="position: absolute; right: 6px; top: 50%; transform: translateY(-50%); width: 30px; height: 30px; opacity: 0; cursor: pointer; z-index: 10;"
                            value="${defaultDate}"
                            tabindex="-1"
                            aria-label="Pilih tanggal dari kalender">
                    </div>
                    <div id="swal-date-formatted-preview" class="text-xs text-teal-700 dark:text-teal-400 font-medium flex items-center gap-1.5 pt-0.5">
                        <i class="fa-regular fa-calendar-check text-sm text-teal-600"></i>
                        <span>Tanggal tercetak: <strong>${escapeHTML(initialFormatted)}</strong></span>
                    </div>
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: confirmBtnText,
        cancelButtonText: 'Batal',
        confirmButtonColor: confirmBtnColor,
        cancelButtonColor: '#64748b',
        focusConfirm: false,
        customClass: {
            popup: 'rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-800 !p-6 max-w-sm sm:max-w-md w-full',
            htmlContainer: '!m-0 !p-0',
            actions: '!mt-5 !mb-0 flex gap-2.5 justify-end w-full',
            confirmButton: 'inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl font-semibold text-sm shadow-md shadow-teal-600/20 active:scale-95 transition-all',
            cancelButton: 'inline-flex items-center justify-center px-4 py-2.5 rounded-xl font-medium text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 active:scale-95 transition-all'
        },
        buttonsStyling: true,
        didOpen: () => {
            const textInputEl = document.getElementById('swal-rapor-date-input');
            const pickerEl = document.getElementById('swal-rapor-native-picker');
            const previewEl = document.getElementById('swal-date-formatted-preview');

            const updateFromIso = (isoVal) => {
                if (textInputEl) textInputEl.value = formatToIndoDmy(isoVal);
                if (pickerEl) pickerEl.value = isoVal;
                if (previewEl) {
                    try {
                        const formatted = typeof formatDateIndoFormal === 'function'
                            ? formatDateIndoFormal(isoVal)
                            : isoVal;
                        previewEl.innerHTML = `<i class="fa-regular fa-calendar-check text-sm text-teal-600"></i> <span>Tanggal tercetak: <strong>${escapeHTML(formatted)}</strong></span>`;
                    } catch (e) {
                        previewEl.innerHTML = `<i class="fa-regular fa-calendar-check text-sm text-teal-600"></i> <span>Tanggal tercetak: <strong>${escapeHTML(isoVal)}</strong></span>`;
                    }
                }
            };

            if (pickerEl) {
                pickerEl.addEventListener('change', () => {
                    if (pickerEl.value) {
                        updateFromIso(pickerEl.value);
                    }
                });
            }

            if (textInputEl) {
                textInputEl.focus();
                textInputEl.addEventListener('input', () => {
                    const parsedIso = parseIndoDmyToIso(textInputEl.value);
                    if (parsedIso) {
                        if (pickerEl) pickerEl.value = parsedIso;
                        if (previewEl) {
                            try {
                                const formatted = typeof formatDateIndoFormal === 'function'
                                    ? formatDateIndoFormal(parsedIso)
                                    : parsedIso;
                                previewEl.innerHTML = `<i class="fa-regular fa-calendar-check text-sm text-teal-600"></i> <span>Tanggal tercetak: <strong>${escapeHTML(formatted)}</strong></span>`;
                            } catch (e) {
                                previewEl.innerHTML = `<i class="fa-regular fa-calendar-check text-sm text-teal-600"></i> <span>Tanggal tercetak: <strong>${escapeHTML(parsedIso)}</strong></span>`;
                            }
                        }
                    } else if (!textInputEl.value.trim()) {
                        if (previewEl) {
                            previewEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-sm text-amber-500"></i> <span class="text-amber-600">Tanggal rapor belum diisi</span>`;
                        }
                    } else {
                        if (previewEl) {
                            previewEl.innerHTML = `<i class="fa-solid fa-circle-exclamation text-sm text-rose-500"></i> <span class="text-rose-600">Format tanggal harus dd/mm/yyyy (cth: 11/09/2026)</span>`;
                        }
                    }
                });
            }
        },
        preConfirm: () => {
            const textInputEl = document.getElementById('swal-rapor-date-input');
            const rawVal = textInputEl?.value?.trim();
            if (!rawVal) {
                Swal.showValidationMessage('Tanggal rapor wajib diisi!');
                return false;
            }
            const isoVal = parseIndoDmyToIso(rawVal);
            if (!isoVal) {
                Swal.showValidationMessage('Format tanggal tidak valid! Gunakan format dd/mm/yyyy (contoh: 11/09/2026).');
                return false;
            }
            return isoVal;
        }
    });

    if (!isConfirmed || !selectedDate) {
        return null;
    }

    if (dateInputEl) {
        dateInputEl.value = selectedDate;
    }

    return selectedDate;
}
window.promptRaporDateConfirmation = promptRaporDateConfirmation;

/**
 * Pembangun Lembar Cetak Rapor Afektif Siswa Standar A4 Resmi (SSOT)
 * Menjamin keseragaman tata letak 100% identik antara cetak per individu dan cetak kolektif rombel.
 */
function buildRaporAfektifPageHtml(student, options = {}) {
    const studentName = student.name || 'Siswa';
    const studentClass = options.studentClass || student.class || '';
    const studentNIS = student.nis || '-';
    const studentNISN = student.nisn || '-';
    const activeYear = options.academicYear || '2026/2027';
    const semesterDisplay = options.semesterDisplay || '1 (Ganjil)';
    const reportDate = options.reportDate || '';
    const teacher = options.teacher || { name: `Wali Kelas ${studentClass}`, nip: '' };
    const kopUrl = options.kopUrl || new URL('assets/kop.png', window.location.href).href;

    const poin = Number(options.poin ?? 0);
    const a = Number(options.a ?? 0);
    const s = Number(options.s ?? 0);
    const i = Number(options.i ?? 0);
    const d = Number(options.d ?? 0);
    const p = Number(options.p ?? 0);

    const achievements = Array.isArray(options.achievements) ? options.achievements : [];
    const violations = Array.isArray(options.violations) ? options.violations : [];
    const attLogs = Array.isArray(options.attLogs) ? options.attLogs : [];
    const pembinaanList = Array.isArray(options.pembinaanList) ? options.pembinaanList : [];
    const sppTunggakan = options.sppTunggakan || null;
    const notes = options.notes || '';
    const pageBreakStyle = options.pageBreak ? 'page-break-after: always; break-after: page;' : '';

    const sppSectionHtml = (sppTunggakan && sppTunggakan.unpaidCount > 0) ? `
        <!-- E. INFORMASI TUNGGAKAN IURAN KOMITE (SPP) -->
        <div class="mb-6 break-inside-avoid">
            <div class="gray-header border border-black p-1 pl-2 text-sm bg-amber-50">E. INFORMASI TUNGGAKAN IURAN KOMITE (SPP)</div>
            <table class="w-full">
                <tbody>
                    <tr>
                        <td style="width: 25%">Status Pembayaran</td>
                        <td style="width: 2%">:</td>
                        <td class="font-bold text-red-600">Menunggak ${sppTunggakan.unpaidCount} Bulan</td>
                    </tr>
                    <tr>
                        <td>Total Kewajiban Tunggakan</td>
                        <td>:</td>
                        <td class="font-bold text-red-600">Rp ${Number(sppTunggakan.totalNominal || 0).toLocaleString('id-ID')}</td>
                    </tr>
                    <tr>
                        <td>Rincian Bulan Belum Lunas</td>
                        <td>:</td>
                        <td class="text-sm italic">${escapeHTML((sppTunggakan.unpaidMonths || []).join(', '))}</td>
                    </tr>
                </tbody>
            </table>
            <p class="text-[10px] italic text-slate-600 mt-1">* Mohon bantuan Bapak/Ibu Orang Tua/Wali Murid untuk segera menyelesaikan administrasi iuran komite di loket bendahara sekolah demi kelancaran operasional pendidikan ananda.</p>
        </div>
    ` : '';

    const cleanTeacherNip = (teacher.nip && typeof cleanNipWithoutSpaces === 'function')
        ? cleanNipWithoutSpaces(teacher.nip)
        : (teacher.nip ? String(teacher.nip).replace(/^(NIP\.?\s*:?\s*)+/i, '').replace(/\s+/g, '').trim() : '');
    const formattedNip = (cleanTeacherNip && cleanTeacherNip !== '-' && cleanTeacherNip !== '0')
        ? (cleanTeacherNip.toUpperCase().startsWith('NIP') ? cleanTeacherNip : `NIP. ${cleanTeacherNip}`)
        : '';

    return `
        <div class="rapor-afektif-page" style="${pageBreakStyle} min-height: 100vh; padding: 4mm 0;">
            <!-- KOP SURAT -->
            <div class="mb-2 text-center relative">
                 <img src="${kopUrl}" class="w-full h-auto object-contain max-h-36 mx-auto" alt="Kop Surat" onerror="this.src='https://placehold.co/800x150?text=KOP+SURAT'">
            </div>

            <!-- JUDUL -->
            <div class="text-center mb-6 mt-4">
                <h1 class="text-xl font-bold uppercase double-underline mb-2">LAPORAN PERKEMBANGAN AFEKTIF SISWA</h1>
                <p class="font-bold text-lg">Tahun Pelajaran ${escapeHTML(activeYear)}</p>
            </div>

            <!-- DATA SISWA -->
            <div class="mb-6">
                <table class="w-full no-border font-bold">
                    <tr>
                        <td style="width: 15%">Nama Siswa</td>
                        <td style="width: 2%">:</td>
                        <td style="width: 40%">${escapeHTML(studentName.toUpperCase())}</td>
                        <td style="width: 10%">Kelas</td>
                        <td style="width: 2%">:</td>
                        <td style="width: 31%">${escapeHTML(studentClass)}</td>
                    </tr>
                    <tr>
                        <td>NIS / NISN</td>
                        <td>:</td>
                        <td>${escapeHTML(studentNIS)} / ${escapeHTML(studentNISN)}</td>
                        <td>Semester</td>
                        <td>:</td>
                        <td>${escapeHTML(semesterDisplay)}</td>
                    </tr>
                </table>
            </div>

            <!-- A. CATATAN PRESTASI -->
            <div class="mb-6">
                <div class="gray-header border border-black p-1 pl-2 text-sm">A. CATATAN PRESTASI</div>
                <table class="w-full">
                    <thead>
                        <tr class="text-center font-bold">
                            <td style="width: 5%">No</td>
                            <td style="width: 20%">Tanggal</td>
                            <td>Uraian Prestasi / Perilaku Positif</td>
                        </tr>
                    </thead>
                    <tbody>
                        ${achievements.length > 0 ? achievements.map((r, idx) => `
                        <tr>
                            <td class="text-center">${idx + 1}</td>
                            <td class="text-center">${r.date ? formatDateIndo(r.date) : (r.dateObj ? r.dateObj.toLocaleDateString('id-ID') : '-')}</td>
                            <td>${escapeHTML(r.desc || r.title || r.notes)}</td>
                        </tr>`).join('') : `
                        <tr><td colspan="3" class="text-center italic text-gray-500 py-4">- Tidak ada catatan khusus -</td></tr>
                        `}
                    </tbody>
                </table>
            </div>

            <!-- B. CATATAN KETIDAKHADIRAN & PERMISI -->
            <div class="mb-6">
                <div class="gray-header border border-black border-b-0 p-1 pl-2 text-sm">B. CATATAN KETIDAKHADIRAN &amp; PERMISI</div>
                
                <!-- SUMMARY ROW INSIDE BOX -->
                <div class="border border-black border-b-0 bg-slate-50 p-2 text-sm font-bold flex gap-6 justify-center">
                    <span>Ringkasan:</span>
                    <span>Sakit: ${s}</span>
                    <span>|</span>
                    <span>Izin: ${i}</span>
                    <span>|</span>
                    <span>Alpha: ${a}</span>
                    <span>|</span>
                    <span>Dispen: ${d}</span>
                    <span>|</span>
                    <span>Permisi: ${p}</span>
                </div>

                <table class="w-full">
                    <thead>
                        <tr class="text-center font-bold">
                            <td style="width: 25%">Tanggal</td>
                            <td style="width: 15%">Status</td>
                            <td>Keterangan</td>
                        </tr>
                    </thead>
                    <tbody>
                        ${attLogs.length > 0 ? attLogs.map(l => {
                            let statusLabel = l.status;
                            if (l.status === 'S' || l.status === 'SAKIT') statusLabel = 'Sakit';
                            else if (l.status === 'I' || l.status === 'IZIN') statusLabel = 'Izin';
                            else if (l.status === 'A' || l.status === 'ALPA' || l.status === 'ALPHA') statusLabel = 'Alpha';
                            else if (l.status === 'D' || l.status === 'DISPEN') statusLabel = 'Dispensasi';
                            else if (l.status === 'P' || l.status === 'PERMISI') statusLabel = 'Permisi';

                            return `
                            <tr>
                                <td class="text-center">${l.dateStr ? formatDateIndo(l.dateStr) : (l.dateObj ? l.dateObj.toLocaleDateString('id-ID') : '-')}</td>
                                <td class="text-center">${statusLabel}</td>
                                <td>${escapeHTML(l.note)}</td>
                            </tr>
                            `;
                        }).join('') : (
                            (s > 0 || i > 0 || a > 0 || d > 0 || p > 0) ? `
                            <tr><td colspan="3" class="text-center italic text-gray-600 py-3">Tercatat pada rekapan: ${[
                                s > 0 ? `Sakit ${s} hari` : '',
                                i > 0 ? `Izin ${i} hari` : '',
                                a > 0 ? `Alpha ${a} hari` : '',
                                d > 0 ? `Dispensasi ${d} hari` : '',
                                p > 0 ? `Permisi ${p} kali` : ''
                            ].filter(Boolean).join(', ')} (Rincian tanggal spesifik tidak terdata di log)</td></tr>
                            ` : `
                            <tr><td colspan="3" class="text-center italic text-gray-500 py-4">- Hadir Penuh (Nihil Absen/Permisi) -</td></tr>
                            `
                        )}
                    </tbody>
                </table>
            </div>

            <!-- C. CATATAN KEDISIPLINAN -->
            <div class="mb-6">
                <div class="gray-header border border-black p-1 pl-2 text-sm">C. CATATAN KEDISIPLINAN</div>
                <table class="w-full">
                    <thead>
                        <tr class="text-center font-bold">
                            <td style="width: 5%">No</td>
                            <td style="width: 20%">Tanggal</td>
                            <td>Uraian Pelanggaran</td>
                            <td style="width: 10%">Poin</td>
                        </tr>
                    </thead>
                    <tbody>
                        ${violations.length > 0 ? `
                            ${violations.map((v, idx) => `
                            <tr>
                                <td class="text-center">${idx + 1}</td>
                                <td class="text-center">${v.date ? formatDateIndo(v.date) : (v.dateObj ? v.dateObj.toLocaleDateString('id-ID') : '-')}</td>
                                <td>${escapeHTML(v.desc || v.title || v.notes)}</td>
                                <td class="text-center font-bold text-red-600">${v.points || 0}</td>
                            </tr>`).join('')}
                            <tr class="font-bold bg-slate-50">
                                <td colspan="3" class="text-right pr-4">Total Poin Pelanggaran:</td>
                                <td class="text-center text-red-600">${violations.reduce((sum, v) => sum + (parseInt(v.points) || 0), 0)}</td>
                            </tr>
                        ` : `
                        <tr><td colspan="4" class="text-center italic text-gray-500 py-4">- Nihil Pelanggaran (Sangat Baik) -</td></tr>
                        `}
                    </tbody>
                </table>
            </div>

            <!-- D. RIWAYAT PEMBINAAN & KONSELING -->
            <div class="mb-6 break-inside-avoid">
                <div class="gray-header border border-black p-1 pl-2 text-sm">D. RIWAYAT PEMBINAAN &amp; KONSELING (GURU WALI, WALI KELAS, &amp; BK)</div>
                <table class="w-full">
                    <thead>
                        <tr class="text-center font-bold">
                            <td style="width: 5%">No</td>
                            <td style="width: 15%">Tanggal</td>
                            <td style="width: 25%">Pembina / Layanan</td>
                            <td>Uraian Pembinaan &amp; Tindak Lanjut</td>
                        </tr>
                    </thead>
                    <tbody>
                        ${pembinaanList.length > 0 ? pembinaanList.map((item, idx) => {
                            const dateText = item.date ? (window.formatDateIndo ? formatDateIndo(item.date) : item.date) : '-';
                            const followUpNote = item.followUp ? `<div class="mt-0.5 text-xs text-slate-600 italic"><b>Tindak Lanjut:</b> ${escapeHTML(item.followUp)}</div>` : '';
                            return `
                            <tr>
                                <td class="text-center">${idx + 1}</td>
                                <td class="text-center">${escapeHTML(dateText)}</td>
                                <td>
                                    <div class="font-bold">${escapeHTML(item.counselor || '-')}</div>
                                    <div class="text-xs text-slate-500">${escapeHTML(item.role || 'Pembina')} &bull; ${escapeHTML(item.category || 'Umum')}</div>
                                </td>
                                <td>
                                    <div>${escapeHTML(item.notes || '-')}</div>
                                    ${followUpNote}
                                </td>
                            </tr>
                            `;
                        }).join('') : `
                        <tr><td colspan="4" class="text-center italic text-gray-500 py-3">- Nihil Catatan Pembinaan Khusus (Perilaku &amp; Karakter Baik) -</td></tr>
                        `}
                    </tbody>
                </table>
            </div>

            ${sppSectionHtml}

            <!-- CATATAN WALI KELAS -->
            <div class="mb-8">
                <div class="font-bold underline mb-2 text-sm">Catatan Wali Kelas:</div>
                <div class="border border-black p-3 min-h-[100px] text-justify leading-relaxed italic">
                    ${escapeHTML(notes || 'Belum ada catatan khusus.')}
                </div>
            </div>

            <!-- TTD -->
            <div class="flex justify-between mt-8 text-sm break-inside-avoid px-8">
                <div class="text-center">
                    <p class="mb-16">Mengetahui,<br>Orang Tua/Wali</p>
                    <p class="font-bold border-b border-black inline-block min-w-[200px]">( ........................................ )</p>
                </div>
                <div class="text-center">
                    <p class="mb-16">Denpasar, ${escapeHTML(reportDate)}<br>Wali Kelas ${escapeHTML(studentClass)}</p>
                    <p class="font-bold border-b border-black inline-block min-w-[200px]">${escapeHTML(teacher.name)}</p>
                    ${formattedNip ? `<p class="mt-1 font-bold">${escapeHTML(formattedNip)}</p>` : ''}
                </div>
            </div>

            <!-- FOOTER PROFESIONAL -->
            <div class="mt-12 text-center border-t border-slate-300 pt-2">
                <p class="text-[10px] text-slate-500 italic font-medium">
                    Dokumen ini disusun dan dicetak otomatis oleh sistem aplikasi ${SCHOOL_CONFIG.appName} - ${SCHOOL_CONFIG.schoolName}.
                </p>
            </div>
        </div>
    `;
}
window.buildRaporAfektifPageHtml = buildRaporAfektifPageHtml;

function wrapRaporAfektifPrintDocument(title, bodyContent) {
    return `<!DOCTYPE html>
<html>
<head>
    <title>${escapeHTML(title)}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Times+New+Roman:wght@400;700&display=swap');
        body { font-family: 'Times New Roman', serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-size: 11pt; }
        @page { size: A4; margin: 10mm 15mm; }
        .double-underline { border-bottom: 3px double black; display: inline-block; padding-bottom: 2px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid black; padding: 4px 6px; }
        .no-border td { border: none; padding: 2px; }
        .gray-header { background-color: #E5E7EB; font-weight: bold; text-transform: uppercase; }
        .page-break { page-break-after: always; break-after: page; }
    </style>
    <link rel="stylesheet" href="${new URL('css/tailwind.css', document.baseURI).href}">
</head>
<body class="bg-white text-black p-4">
    ${bodyContent}
    <script>window.onload = function() { window.print(); }<\/script>
</body>
</html>`;
}
window.wrapRaporAfektifPrintDocument = wrapRaporAfektifPrintDocument;

window.printReportCardWali = async function () {
    if (activePrintDataPromise) {
        try {
            await activePrintDataPromise;
        } catch (errWait) {
            console.warn('[WaliKelas] Notice awaiting activePrintDataPromise in printReportCardWali:', errWait);
        }
    }
    if (!activePrintStudent) return;

    const studentName = activePrintStudent.name || 'Siswa';
    const studentClass = currentRombelClass || activePrintStudent.class || '';

    // Tanggal Cetak Rapor SSOT dari Kurikulum (Cloudflare D1 system_settings.rapor_config)
    const dateInputEl = document.getElementById('print-date-input');
    const confirmedDateIso = (dateInputEl?.value && /^\d{4}-\d{2}-\d{2}$/.test(dateInputEl.value))
        ? dateInputEl.value
        : await getSsotRaporDate();

    if (!confirmedDateIso) return;

    // Simpan catatan ke database HANYA jika ada catatan baru atau berbeda dengan catatan yang sudah ada sebelumnya (ada perubahan/diedit)
    const currentInputNote = (document.getElementById('print-notes-input')?.value || '').trim();
    const existingSavedNote = getExistingSavedPrintNote(activePrintStudent.nis);
    const isNoteChanged = (currentInputNote !== existingSavedNote);

    if (isNoteChanged) {
        await window.saveCatatanFromPrintModal(false, false);
    }
    const notes = document.getElementById('print-notes-input')?.value || '';
    const reportDate = formatDateIndoFormal(confirmedDateIso);

    const activeYear = document.getElementById('tab-rapor-year-filter')?.value || '2026/2027';
    const activeSem = document.getElementById('print-modal-semester-select')?.value || document.getElementById('tab-rapor-semester-filter')?.value || '1';
    let semesterDisplay = activeSem === '1' ? '1 (Ganjil)' : '2 (Genap)';
    if (activeSem === 'TA' || activeSem === 'FULL' || activeSem === 'ALL') {
        semesterDisplay = '1 & 2 (1 Tahun Penuh)';
    }

    const yearParts = activeYear.split('/');
    const startYear = parseInt(yearParts[0], 10) || 2026;
    const endYear = parseInt(yearParts[1], 10) || (startYear + 1);
    let startDateIso = `${startYear}-07-01`;
    let endDateIso = `${endYear}-06-30`;
    if (activeSem === '1') {
        startDateIso = `${startYear}-07-01`;
        endDateIso = `${startYear}-12-31`;
    } else if (activeSem === '2') {
        startDateIso = `${endYear}-01-01`;
        endDateIso = `${endYear}-06-30`;
    }

    const poin = document.getElementById('print-preview-poin')?.innerText || '0';
    const a = document.getElementById('print-preview-alpha')?.innerText || '0';
    const s = document.getElementById('print-preview-sakit')?.innerText || '0';
    const i = document.getElementById('print-preview-izin')?.innerText || '0';
    const d = document.getElementById('print-preview-dispen')?.innerText || '0';
    const p = document.getElementById('print-preview-permisi')?.innerText || '0';

    // Rincian Records (Prestasi, Pelanggaran, & Permisi)
    let records = activePrintStudent.records;
    const aggPoinVal = Number(poin || currentClassAggregates[activePrintStudent.nis]?.totalPoints || currentClassAggregates[activePrintStudent.nis]?.points || 0);
    if (!Array.isArray(records) || (records.length === 0 && aggPoinVal > 0)) {
        try {
            records = await ensureStudentRecords(activePrintStudent);
            activePrintStudent.records = records;
        } catch (errRec) {
            console.warn('[WaliKelas] Fallback records in printReportCardWali notice:', errRec);
            records = records || [];
        }
    }
    records = Array.isArray(records) ? records : [];
    const achievements = records.filter(r => r.type === 'prestasi' || r.category === 'Prestasi');
    const violations = records.filter(r => r.type === 'pelanggaran' || r.category === 'Pelanggaran' || (r.points && Number(r.points) > 0 && r.type !== 'prestasi' && r.category !== 'Prestasi'));
    const permissionRecords = records.filter(r => r.type === 'permission' || r.type === 'permisi' || r.category === 'Permisi');
    
    // Rincian Riwayat Pembinaan & Konseling (BK, Guru Wali, Wali Kelas)
    let pembinaanList = activePrintStudent.pembinaanList;
    if ((!pembinaanList || pembinaanList.length === 0) && typeof window.fetchStudentPembinaanHistory === 'function') {
        try {
            const targetNisStr = String(activePrintStudent.nis).trim();
            pembinaanList = await window.fetchStudentPembinaanHistory(targetNisStr, {
                startDateIso,
                endDateIso,
                studentClass,
                currentUid: auth.currentUser?.uid || '',
                currentUserName: currentUserProfile?.name || currentUserProfile?.nama || ''
            });
            activePrintStudent.pembinaanList = pembinaanList;
        } catch (errP) {
            console.warn('[WaliKelas] Fallback fetch pembinaan before print error:', errP);
            pembinaanList = [];
        }
    }
    pembinaanList = pembinaanList || [];

    // Pastikan data rincian presensi siswa lengkap (dari cache kelas atau fetch langsung jika kosong)
    if (!activePrintStudent.attendance || activePrintStudent.attendance.length === 0) {
        const cachedLogs = getStudentAttendanceLogsFromClass(activePrintStudent.nis, startDateIso, endDateIso);
        if (cachedLogs.length > 0) {
            activePrintStudent.attendance = cachedLogs.map(r => ({
                date: r.tanggal || r.date,
                status: r.status || 'H',
                note: r.note || '',
                className: r.kelas || r.className
            }));
        } else {
            try {
                const { rows: liveRows } = await window.fetchStudentAttendanceRange(activePrintStudent.nis, startDateIso, endDateIso);
                if (Array.isArray(liveRows) && liveRows.length > 0) {
                    activePrintStudent.attendance = liveRows;
                } else {
                    const { rows: allRows } = await window.fetchStudentAttendanceRange(activePrintStudent.nis, null, null);
                    if (Array.isArray(allRows) && allRows.length > 0) {
                        activePrintStudent.attendance = allRows;
                    }
                }
            } catch (errAtt) {
                console.warn('[WaliKelas] Fallback fetch attendance before print warning:', errAtt);
            }
        }
    }

    // Rincian Ketidakhadiran & Permisi
    const rawAtt = activePrintStudent.attendance || [];
    let attLogs = rawAtt.map(r => ({
        dateStr: r.date || r.tanggal || '',
        dateObj: r.date ? new Date(r.date) : (r.tanggal ? new Date(r.tanggal) : new Date()),
        status: (r.status || '').toUpperCase(),
        note: r.note || r.keterangan || '-'
    }));

    if (Array.isArray(permissionRecords)) {
        permissionRecords.forEach(pr => {
            attLogs.push({
                dateStr: pr.date || getLocalISODate(),
                dateObj: (pr.dateObj instanceof Date && !isNaN(pr.dateObj)) ? pr.dateObj : (pr.date ? new Date(pr.date) : new Date()),
                status: 'P',
                note: pr.notes || pr.title || 'Izin Keluar / Permisi'
            });
        });
    }

    attLogs.sort((x, y) => (x.dateObj || 0) - (y.dateObj || 0));
    attLogs = attLogs.filter(l => l.status !== 'H' && l.status !== 'HADIR');

    // Cek Data Tunggakan SPP Siswa (SSOT - hanya tampil jika menunggak)
    let sppTunggakan = activePrintStudent.sppTunggakan;
    if (!sppTunggakan) {
        try {
            const targetNisStr = String(activePrintStudent.nis).trim();
            const sppData = sppStatusMap[targetNisStr] ||
                            sppStatusMap[normalizeNIS(targetNisStr)] ||
                            sppStatusMap[targetNisStr.padStart(4, '0')] ||
                            null;
            const paymentHistory = sppData?.paymentHistory || {};
            const ratesConfig = await getFinanceRatesWithCache();
            const financeConfig = typeof window.getFinanceConfigCache === 'function' ? await window.getFinanceConfigCache() : null;
            const sppDueDate = Number(financeConfig?.dueDate) || detailSppDueDate || 20;
            sppTunggakan = calculateStudentTunggakan(activePrintStudent, paymentHistory, ratesConfig, sppDueDate);
        } catch (errSpp) {
            console.warn('[WaliKelas] Gagal mengambil data tunggakan SPP saat cetak:', errSpp);
        }
    }

    // Data Wali Kelas & Resolusi NIP yang Sah
    const teacher = (typeof window.resolveHomeroomTeacher === 'function')
        ? await window.resolveHomeroomTeacher(studentClass, currentUserProfile)
        : {
            name: `Wali Kelas ${studentClass}`,
            nip: ''
        };

    const kopUrl = new URL('assets/kop.png', window.location.href).href;

    const studentPageHtml = buildRaporAfektifPageHtml(activePrintStudent, {
        studentClass,
        academicYear: activeYear,
        semesterDisplay,
        reportDate,
        teacher,
        kopUrl,
        poin,
        a,
        s,
        i,
        d,
        p,
        achievements,
        violations,
        attLogs,
        pembinaanList,
        sppTunggakan,
        notes,
        pageBreak: false
    });

    const printTitle = `Laporan Rapor Afektif - ${studentName}`;
    const fullHtml = wrapRaporAfektifPrintDocument(printTitle, studentPageHtml);

    const printWin = window.open('', '_blank');
    if (!printWin) {
        if (typeof executeRaporPerhotelanPrint === 'function') {
            executeRaporPerhotelanPrint(null, printTitle, fullHtml);
        } else if (typeof showToast === 'function') {
            showToast("Pop-up Terblokir", "Harap izinkan pop-up peramban untuk membuka pratinjau cetak rapor.", "warning");
        }
        return;
    }
    printWin.document.write(fullHtml);
    printWin.document.close();
};

/**
 * Cetak Seluruh Rapor Afektif Siswa Rombel 1 Kelas (Kertas A4)
 * Menghasilkan dokumen cetak resmi dengan tata letak yang 100% IDENTIK dengan cetak per individu.
 */
window.printAllRaporAfektifWali = async function () {
    try {
        if (!currentClassStudents || currentClassStudents.length === 0) {
            showToast('Peringatan', 'Tidak ada siswa pada rombel ini.', 'warning');
            return;
        }

        const confirmedDateIso = await getSsotRaporDate();
        if (!confirmedDateIso) return;

        const reportDate = formatDateIndoFormal(confirmedDateIso);
        const activeYear = document.getElementById('tab-rapor-year-filter')?.value || '2026/2027';
        const activeSem = document.getElementById('tab-rapor-semester-filter')?.value || '1';
        let semesterDisplay = activeSem === '1' ? '1 (Ganjil)' : '2 (Genap)';
        if (activeSem === 'TA' || activeSem === 'FULL' || activeSem === 'ALL') {
            semesterDisplay = '1 & 2 (1 Tahun Penuh)';
        }

        const yearParts = activeYear.split('/');
        const startYear = parseInt(yearParts[0], 10) || 2026;
        const endYear = parseInt(yearParts[1], 10) || (startYear + 1);
        let startDateIso = `${startYear}-07-01`;
        let endDateIso = `${endYear}-06-30`;
        if (activeSem === '1') {
            startDateIso = `${startYear}-07-01`;
            endDateIso = `${startYear}-12-31`;
        } else if (activeSem === '2') {
            startDateIso = `${endYear}-01-01`;
            endDateIso = `${endYear}-06-30`;
        }

        const studentClass = currentRombelClass || (currentClassStudents[0]?.class || '');
        const teacher = (typeof window.resolveHomeroomTeacher === 'function')
            ? await window.resolveHomeroomTeacher(studentClass, currentUserProfile)
            : { name: `Wali Kelas ${studentClass}`, nip: '' };

        const kopUrl = new URL('assets/kop.png', window.location.href).href;

        // Ambil konfigurasi tarif SPP 1 kali untuk seluruh siswa rombel (0 Firestore Read waste)
        let ratesConfig = null;
        let sppDueDate = 20;
        try {
            ratesConfig = await getFinanceRatesWithCache();
            const financeConfig = typeof window.getFinanceConfigCache === 'function' ? await window.getFinanceConfigCache() : null;
            sppDueDate = Number(financeConfig?.dueDate) || detailSppDueDate || 20;
        } catch (e) {
            console.warn('[WaliKelas] Info load finance rates for bulk print:', e);
        }

        showToast('Memproses', `Menyiapkan ${currentClassStudents.length} Rapor Afektif Siswa...`, 'info');

        // Pastikan classRecordsList telah dimuat dari Cloudflare D1
        if (!Array.isArray(classRecordsList) || classRecordsList.length === 0) {
            try {
                await loadClassRecordsAndPermisi(studentClass);
            } catch (errBulkRec) {
                console.warn('[WaliKelas] Load classRecordsList in bulk print notice:', errBulkRec);
            }
        }

        let allPagesHtml = '';
        for (let idx = 0; idx < currentClassStudents.length; idx++) {
            const student = currentClassStudents[idx];
            const targetNisStr = String(student.nis || '').trim();

            // 1. Records (Prestasi, Pelanggaran, Permisi)
            let records = (Array.isArray(classRecordsList) ? classRecordsList : [])
                .filter(r => String(r.studentNis).trim() === targetNisStr);

            // 2. Agregat Presensi
            const agg = currentClassAggregates[targetNisStr] || {};
            const poin = Number(agg.totalPoints ?? agg.poinPelanggaran ?? agg.points ?? agg.poin ?? 0);

            // Self-healing: jika siswa tercatat memiliki poin agregat > 0 namun catatan belum terfilter di rombel, ambil live by NIS
            if (poin > 0 && records.filter(r => r.type === 'pelanggaran' || r.category === 'Pelanggaran' || (r.points && Number(r.points) > 0)).length === 0) {
                try {
                    const fallbackRecs = await ensureStudentRecords(student);
                    if (Array.isArray(fallbackRecs) && fallbackRecs.length > 0) {
                        records = fallbackRecs;
                    }
                } catch (eF) {
                    console.warn(`[WaliKelas] Fallback records bulk print for NIS ${targetNisStr}:`, eF);
                }
            }

            const achievements = records.filter(r => r.type === 'prestasi' || r.category === 'Prestasi');
            const violations = records.filter(r => r.type === 'pelanggaran' || r.category === 'Pelanggaran' || (r.points && Number(r.points) > 0 && r.type !== 'prestasi' && r.category !== 'Prestasi'));
            const permissionRecords = records.filter(r => r.type === 'permission' || r.type === 'permisi' || r.category === 'Permisi');
            const a = Number(agg.totalAlpha ?? agg.alpa ?? agg.alpha ?? agg.A ?? 0);
            const s = Number(agg.totalSakit ?? agg.sakit ?? agg.S ?? 0);
            const i = Number(agg.totalIzin ?? agg.izin ?? agg.I ?? 0);
            const d = Number(agg.totalDispen ?? agg.dispen ?? agg.D ?? 0);
            const p = Number(currentPermissionCounts[targetNisStr] ?? agg.totalPermisi ?? agg.permisi ?? agg.P ?? 0);

            // 3. Raw attendance logs dari memori rombel kelas atau student.attendance
            let rawAtt = student.attendance;
            if (!Array.isArray(rawAtt) || rawAtt.length === 0) {
                const classLogs = getStudentAttendanceLogsFromClass(targetNisStr, startDateIso, endDateIso);
                rawAtt = classLogs.map(r => ({
                    date: r.tanggal || r.date,
                    status: r.status || 'H',
                    note: r.note || '',
                    className: r.kelas || r.className
                }));
            }
            let attLogs = rawAtt.map(r => ({
                dateStr: r.date || r.tanggal || '',
                dateObj: r.date ? new Date(r.date) : (r.tanggal ? new Date(r.tanggal) : new Date()),
                status: (r.status || '').toUpperCase(),
                note: r.note || r.keterangan || '-'
            }));
            if (Array.isArray(permissionRecords)) {
                permissionRecords.forEach(pr => {
                    attLogs.push({
                        dateStr: pr.date || pr.rawDate || getLocalISODate(),
                        dateObj: (pr.dateObj instanceof Date && !isNaN(pr.dateObj)) ? pr.dateObj : (pr.date ? new Date(pr.date) : new Date()),
                        status: 'P',
                        note: pr.desc || pr.notes || pr.title || 'Izin Keluar / Permisi'
                    });
                });
            }
            attLogs.sort((x, y) => (x.dateObj || 0) - (y.dateObj || 0));
            attLogs = attLogs.filter(l => l.status !== 'H' && l.status !== 'HADIR');

            // 4. Pembinaan (BK, Guru Wali, Wali Kelas)
            const studentNotes = (Array.isArray(classNotesList) ? classNotesList : [])
                .filter(n => String(n.studentNis).trim() === targetNisStr)
                .map(n => ({
                    date: n.date,
                    counselor: n.authorName || n.counselor || 'Wali Kelas',
                    role: n.sourceLabel || n.role || 'Pembina',
                    category: n.category || 'Umum',
                    notes: n.content || n.notes || '',
                    followUp: n.followUp || ''
                }));

            // 5. Tunggakan SPP
            const sppData = sppStatusMap[targetNisStr] ||
                            sppStatusMap[normalizeNIS(targetNisStr)] ||
                            sppStatusMap[targetNisStr.padStart(4, '0')] || null;
            let sppTunggakan = null;
            if (sppData && typeof calculateStudentTunggakan === 'function') {
                const paymentHistory = sppData?.paymentHistory || {};
                sppTunggakan = calculateStudentTunggakan(student, paymentHistory, ratesConfig, sppDueDate);
            }

            // 6. Catatan Wali Kelas di Rapor
            const savedNote = walikelasNotesMap[targetNisStr] || '';
            const noteText = typeof savedNote === 'object' ? (savedNote.catatanWaliKelas || '') : savedNote;

            const isLast = idx === currentClassStudents.length - 1;

            allPagesHtml += buildRaporAfektifPageHtml(student, {
                studentClass,
                academicYear: activeYear,
                semesterDisplay,
                reportDate,
                teacher,
                kopUrl,
                poin,
                a,
                s,
                i,
                d,
                p,
                achievements,
                violations,
                attLogs,
                pembinaanList: studentNotes,
                sppTunggakan,
                notes: noteText,
                pageBreak: !isLast
            });
        }

        const printTitle = `Laporan Rapor Afektif Kolektif - Kelas ${studentClass}`;
        const fullHtml = wrapRaporAfektifPrintDocument(printTitle, allPagesHtml);

        const printWin = window.open('', '_blank');
        if (!printWin) {
            if (typeof executeRaporPerhotelanPrint === 'function') {
                executeRaporPerhotelanPrint(null, printTitle, fullHtml);
            } else if (typeof showToast === 'function') {
                showToast("Pop-up Terblokir", "Harap izinkan pop-up peramban untuk membuka pratinjau cetak rapor.", "warning");
            }
            return;
        }

        printWin.document.write(fullHtml);
        printWin.document.close();

    } catch (err) {
        console.error('[WaliKelas] Gagal cetak semua rapor afektif:', err);
        showToast('Error', 'Gagal memproses cetak semua rapor afektif: ' + (err.message || err), 'error');
    }
};
window.printAllRaporAfektifWali = printAllRaporAfektifWali;

/**
 * Buka Modal Pilihan Cetak Semua Rapor Rombel (Afektif / Perhotelan)
 */
window.openBulkPrintRaporModal = function () {
    if (!currentRombelClass) {
        showToast('Peringatan', 'Silakan pilih rombel binaan terlebih dahulu.', 'warning');
        return;
    }
    if (!currentClassStudents || currentClassStudents.length === 0) {
        showToast('Info', 'Tidak ada data siswa dalam rombel ini untuk dicetak.', 'info');
        return;
    }

    const classDisplayEl = document.getElementById('bulk-rapor-class-display');
    if (classDisplayEl) classDisplayEl.textContent = currentRombelClass;

    const optPerhotelan = document.getElementById('bulk-option-perhotelan-container');
    if (optPerhotelan) {
        if (isPerhotelanClass(currentRombelClass)) {
            optPerhotelan.classList.remove('hidden');
            optPerhotelan.style.display = 'flex';
        } else {
            optPerhotelan.classList.add('hidden');
            optPerhotelan.style.display = 'none';
        }
    }

    window.openModal('modal-bulk-print-rapor');
};

/**
 * Eksekusi Pilihan Cetak Massal Rombel
 */
window.executeBulkPrintOption = async function (type) {
    window.closeModal('modal-bulk-print-rapor');
    if (type === 'afektif') {
        await window.printAllRaporAfektifWali();
    } else if (type === 'perhotelan') {
        await window.printAllRaporPerhotelanWali();
    }
};

/**
 * =========================================================================
 * RAPOR VOKASI PERHOTELAN (KELAS X & XI) - STANDAR A4 RESMI
 * =========================================================================
 */

function isPerhotelanClass(className) {
    if (!className) return false;
    let trimmed = String(className).trim().toUpperCase();
    if (trimmed.startsWith('KELAS ') || trimmed.startsWith('KELAS.')) {
        trimmed = trimmed.replace(/^KELAS[\s\.]+/, '');
    }
    if (trimmed.startsWith('XII-') || trimmed.startsWith('XII.') || trimmed.startsWith('XII ') || trimmed.startsWith('XII_') || trimmed === 'XII' || /^XII\d/i.test(trimmed)) return false;
    return trimmed.startsWith('X-') || trimmed.startsWith('X.') || trimmed.startsWith('X ') || trimmed.startsWith('X_') || /^X\d/i.test(trimmed) ||
           trimmed.startsWith('XI-') || trimmed.startsWith('XI.') || trimmed.startsWith('XI ') || trimmed.startsWith('XI_') || /^XI\d/i.test(trimmed);
}
window.isPerhotelanClass = isPerhotelanClass;

function getFaseFromClass(className) {
    if (!className) return 'E';
    const trimmed = String(className).trim().toUpperCase();
    if (trimmed.startsWith('X-') || trimmed.startsWith('X.') || trimmed.startsWith('X ') || trimmed.startsWith('X_') || trimmed === 'X') {
        return 'E';
    }
    return 'F';
}
window.getFaseFromClass = getFaseFromClass;

function getPerhotelanPredicate(score) {
    if (score === null || score === undefined || score === '' || isNaN(Number(score))) return '';
    const num = Number(score);
    if (num >= 85) return 'Sangat Kompeten';
    if (num >= 70) return 'Kompeten';
    if (num >= 60) return 'Cukup Kompeten';
    return 'Kurang Kompeten';
}
window.getPerhotelanPredicate = getPerhotelanPredicate;

function cleanNipWithoutSpaces(nip) {
    if (!nip) return '';
    return String(nip).replace(/^(NIP\.?\s*:?\s*)+/i, '').replace(/\s+/g, '').trim();
}
window.cleanNipWithoutSpaces = cleanNipWithoutSpaces;

async function fetchPerhotelanScoresForClass(studentClass, academicYear, semester) {
    const scoresByNis = {};
    const cleanClass = (studentClass || '').trim();
    const cleanYear = (academicYear || '2025/2026').replace(/\//g, '-');
    const sem = String(semester || '1');

    // 1. Supabase Guru Mapel Summaries
    if (supabase) {
        try {
            const clsVariants = Array.from(new Set([
                cleanClass,
                cleanClass.replace(/\s+/g, '_'),
                cleanClass.replace(/\s+/g, '-'),
                cleanClass.replace(/-/g, '_'),
                cleanClass.replace(/-/g, ' ')
            ])).filter(Boolean);

            const mapelVariants = [
                'Perhotelan (HK)', 'Perhotelan (FB)', 'Perhotelan',
                'Housekeeping', 'Food and Beverage Service', 'Food & Beverage Service'
            ];

            const directGbIds = [];
            clsVariants.forEach(cls => {
                mapelVariants.forEach(m => {
                    directGbIds.push(`${cleanYear}_S${sem}_${cls.replace(/\s+/g, '_')}_${m.replace(/\s+/g, '_')}`);
                    directGbIds.push(`${cleanYear}_S${sem}_${cls}_${m}`);
                });
            });

            let matchedGbIds = [...directGbIds];
            try {
                const { data: gbs, error: gbErr } = await supabase
                    .from('guru_mapel_gradebooks')
                    .select('id, subject_id, class_id, tahun_ajaran, semester')
                    .eq('tahun_ajaran', academicYear)
                    .eq('semester', sem);
                if (!gbErr && Array.isArray(gbs)) {
                    const targetCls = cleanClass.toUpperCase().replace(/[\s_]/g, '-');
                    gbs.forEach(g => {
                        const gCls = (g.class_id || '').trim().toUpperCase().replace(/[\s_]/g, '-');
                        const gMapel = (g.subject_id || '').toLowerCase();
                        const isPerhotelan = gMapel.includes('perhotelan') || gMapel.includes('housekeeping') || gMapel.includes('food') || gMapel.includes('beverage');
                        if (isPerhotelan && (gCls === targetCls || g.class_id === cleanClass)) {
                            matchedGbIds.push(g.id);
                        }
                    });
                } else if (gbErr) {
                    console.warn('[WaliKelas] Query guru_mapel_gradebooks error:', gbErr);
                }
            } catch (errGb) {
                console.warn('[WaliKelas] Query guru_mapel_gradebooks optional warning:', errGb);
            }

            const uniqueGbIds = Array.from(new Set(matchedGbIds));
            if (uniqueGbIds.length > 0) {
                const { data: summaries, error: sumErr } = await supabase
                    .from('guru_mapel_summaries')
                    .select('id, gradebook_id, student_nis, final_score, deskripsi_cp')
                    .in('gradebook_id', uniqueGbIds);

                if (!sumErr && Array.isArray(summaries)) {
                    summaries.forEach(sm => {
                        const nis = String(sm.student_nis || '').trim();
                        if (!nis) return;
                        if (!scoresByNis[nis]) {
                            scoresByNis[nis] = { fb: null, hk: null };
                        }
                        const gbIdLower = String(sm.gradebook_id || '').toLowerCase();
                        const isFB = gbIdLower.includes('fb') || gbIdLower.includes('food') || gbIdLower.includes('beverage');
                        const isHK = gbIdLower.includes('hk') || gbIdLower.includes('house');

                        const entry = {
                            final_score: sm.final_score !== null && sm.final_score !== undefined ? Math.round(Number(sm.final_score)) : null,
                            deskripsi_cp: (sm.deskripsi_cp || '').trim(),
                            source: 'supabase'
                        };

                        if (isFB) {
                            scoresByNis[nis].fb = entry;
                        } else if (isHK) {
                            scoresByNis[nis].hk = entry;
                        } else {
                            if (/^X[\s\-\.]/i.test(cleanClass)) {
                                scoresByNis[nis].fb = entry;
                            } else {
                                scoresByNis[nis].hk = entry;
                            }
                        }
                    });
                }
            }
        } catch (e) {
            console.warn('[WaliKelas] fetchPerhotelanScoresForClass Supabase error:', e);
        }
    }

    // 2. Cloudflare D1 rapor_scores Fallback / Enrichment
    if (cfClient && cfClient.enabled && typeof cfClient.getRaporScores === 'function') {
        try {
            const d1Rows = await cfClient.getRaporScores({
                student_class: cleanClass,
                academic_year: academicYear,
                semester: sem
            }) || [];

            d1Rows.forEach(row => {
                const nis = String(row.student_nis || '').trim();
                if (!nis) return;
                if (!scoresByNis[nis]) {
                    scoresByNis[nis] = { fb: null, hk: null };
                }
                const mapelLower = String(row.mapel || '').toLowerCase();
                const isFB = mapelLower.includes('fb') || mapelLower.includes('food') || mapelLower.includes('beverage');
                const isHK = mapelLower.includes('hk') || mapelLower.includes('house');

                const teori = row.scores_teori !== null && row.scores_teori !== undefined ? Math.round(Number(row.scores_teori)) : null;
                const praktik = row.scores_praktik !== null && row.scores_praktik !== undefined ? Math.round(Number(row.scores_praktik)) : null;
                const finalSc = row.final_score !== null && row.final_score !== undefined ? Math.round(Number(row.final_score)) : null;

                const targetSlot = isFB ? 'fb' : (isHK ? 'hk' : (/^X[\s\-\.]/i.test(cleanClass) ? 'fb' : 'hk'));

                if (!scoresByNis[nis][targetSlot]) {
                    scoresByNis[nis][targetSlot] = {
                        final_score: finalSc ?? (teori !== null && praktik !== null ? Math.round((teori + praktik) / 2) : (teori ?? praktik)),
                        teori: teori,
                        praktik: praktik,
                        deskripsi_cp: (row.deskripsi_cp || row.notes || '').trim(),
                        source: 'd1'
                    };
                } else {
                    if (teori !== null) scoresByNis[nis][targetSlot].teori = teori;
                    if (praktik !== null) scoresByNis[nis][targetSlot].praktik = praktik;
                    if (!scoresByNis[nis][targetSlot].deskripsi_cp && row.deskripsi_cp) {
                        scoresByNis[nis][targetSlot].deskripsi_cp = row.deskripsi_cp.trim();
                    }
                }
            });
        } catch (eD1) {
            console.warn('[WaliKelas] fetchPerhotelanScoresForClass D1 error:', eD1);
        }
    }

    return scoresByNis;
}
window.fetchPerhotelanScoresForClass = fetchPerhotelanScoresForClass;

function resolveStudentPerhotelan(student, perhotelanScores, defaultMapelKey = null) {
    const nis = String(student.nis || student.id || '').trim();
    const studentClass = student.class || currentRombelClass || '';
    const studentData = perhotelanScores ? (perhotelanScores[nis] || perhotelanScores[student.nis] || null) : null;

    let activeKey = defaultMapelKey;
    if (!activeKey) {
        if (/(?:^|\b|\s|_)X(?:[\s\-\._]|\d|$)/i.test(studentClass)) {
            activeKey = 'fb';
        } else {
            activeKey = 'hk';
        }
    }

    if (studentData) {
        if (studentData.fb && !studentData.hk) {
            activeKey = 'fb';
        } else if (studentData.hk && !studentData.fb) {
            activeKey = 'hk';
        }
    }

    const res = {
        activeSubject: activeKey,
        fb: {
            pengetahuanScore: '',
            pengetahuanPredikat: '',
            pengetahuanDesc: '',
            keterampilanScore: '',
            keterampilanPredikat: '',
            keterampilanDesc: '',
            isActive: activeKey === 'fb'
        },
        hk: {
            pengetahuanScore: '',
            pengetahuanPredikat: '',
            pengetahuanDesc: '',
            keterampilanScore: '',
            keterampilanPredikat: '',
            keterampilanDesc: '',
            isActive: activeKey === 'hk'
        }
    };

    if (activeKey === 'fb') {
        const d = studentData?.fb;
        if (d && (d.final_score !== null || d.teori !== null || d.praktik !== null)) {
            const pScore = (d.teori !== null && d.teori !== undefined) ? d.teori : d.final_score;
            const kScore = (d.praktik !== null && d.praktik !== undefined) ? d.praktik : d.final_score;
            res.fb.pengetahuanScore = (pScore !== null && pScore !== undefined) ? String(pScore) : '';
            res.fb.pengetahuanPredikat = getPerhotelanPredicate(pScore);
            res.fb.pengetahuanDesc = d.deskripsi_cp || 'Siswa mampu mendeskripsikan dan memahami materi Food and Beverage Service.';
            res.fb.keterampilanScore = (kScore !== null && kScore !== undefined) ? String(kScore) : '';
            res.fb.keterampilanPredikat = getPerhotelanPredicate(kScore);
            res.fb.keterampilanDesc = d.deskripsi_cp || 'Siswa mampu mempraktikkan keterampilan Food and Beverage Service.';
        }
    } else if (activeKey === 'hk') {
        const d = studentData?.hk;
        if (d && (d.final_score !== null || d.teori !== null || d.praktik !== null)) {
            const pScore = (d.teori !== null && d.teori !== undefined) ? d.teori : d.final_score;
            const kScore = (d.praktik !== null && d.praktik !== undefined) ? d.praktik : d.final_score;
            res.hk.pengetahuanScore = (pScore !== null && pScore !== undefined) ? String(pScore) : '';
            res.hk.pengetahuanPredikat = getPerhotelanPredicate(pScore);
            res.hk.pengetahuanDesc = d.deskripsi_cp || 'Siswa mampu mendeskripsikan cara menjelaskan fasilitas hotel.';
            res.hk.keterampilanScore = (kScore !== null && kScore !== undefined) ? String(kScore) : '';
            res.hk.keterampilanPredikat = getPerhotelanPredicate(kScore);
            res.hk.keterampilanDesc = d.deskripsi_cp || 'Siswa mampu mendeskripsikan cara menjelaskan fasilitas hotel.';
        }
    }

    return res;
}
window.resolveStudentPerhotelan = resolveStudentPerhotelan;

function buildRaporPerhotelanPageHtml(student, perhotelanData, teacher, options = {}) {
    const studentName = (student.name || student.nama || '-').toUpperCase();
    const studentNIS = student.nis || student.id || '-';
    const studentNISN = student.nisn || '-';
    const rawClass = student.class || currentRombelClass || '-';
    const studentClassDisplay = rawClass.replace(/[-_]/g, ' ');
    const faseDisplay = getFaseFromClass(rawClass);

    const academicYear = options.academicYear || '2025/2026';
    const semester = options.semester || '2';
    const reportDate = options.reportDate || formatDateIndoFormal(getLocalISODate());
    const schoolCity = options.schoolCity || SCHOOL_CONFIG.schoolCity || 'Abang';
    const schoolNameUpper = options.schoolNameUpper || SCHOOL_CONFIG.schoolNameUpper || "SMA NEGERI NUSANTARA";
    const schoolStreetAddress = options.schoolStreetAddress || SCHOOL_CONFIG.schoolAddressShort || SCHOOL_CONFIG.schoolStreetAddress || "Jl. Nusantara No. 1, Denpasar";
    const kepsekName = options.kepsekName || SCHOOL_CONFIG.headmasterName || "Dr. I Wayan Sudarsana, M.Pd.";
    const rawKepsekNip = options.kepsekNIP || SCHOOL_CONFIG.headmasterNIP || '19700521 199702 1 001';
    const cleanKepsekNip = cleanNipWithoutSpaces(rawKepsekNip);
    const kepsekNipDisplay = cleanKepsekNip && cleanKepsekNip !== '-' ? `NIP. ${cleanKepsekNip}` : 'NIP. -';

    const teacherName = teacher?.name || currentUserProfile?.name || `Wali Kelas ${rawClass}`;
    const rawTeacherNip = teacher?.nip || currentUserProfile?.nip || '';
    const cleanTeacherNip = cleanNipWithoutSpaces(rawTeacherNip);
    const teacherNipDisplay = cleanTeacherNip && cleanTeacherNip !== '-' ? `NIP. ${cleanTeacherNip}` : 'NIP. -';

    const fb = perhotelanData?.fb || {};
    const hk = perhotelanData?.hk || {};

    return `
        <!-- HEADER IDENTITAS (2 KOLOM) -->
        <table style="width: 100%; border: none; border-collapse: collapse; font-size: 10pt; line-height: 1.4; margin-bottom: 8px;">
            <tr style="border: none;">
                <td style="width: 14%; border: none; vertical-align: top; padding: 2px 0;">Nama</td>
                <td style="width: 2%; border: none; vertical-align: top; padding: 2px 0;">:</td>
                <td style="width: 54%; border: none; vertical-align: top; padding: 2px 0; font-weight: bold;">${escapeHTML(studentName)}</td>
                <td style="width: 16%; border: none; vertical-align: top; padding: 2px 0; white-space: nowrap;">Kelas</td>
                <td style="width: 2%; border: none; vertical-align: top; padding: 2px 0; text-align: center;">:</td>
                <td style="width: 12%; border: none; vertical-align: top; padding: 2px 0; white-space: nowrap;">${escapeHTML(studentClassDisplay)}</td>
            </tr>
            <tr style="border: none;">
                <td style="border: none; vertical-align: top; padding: 2px 0;">NIS/NISN</td>
                <td style="border: none; vertical-align: top; padding: 2px 0;">:</td>
                <td style="border: none; vertical-align: top; padding: 2px 0;">${escapeHTML(studentNIS)} / ${escapeHTML(studentNISN)}</td>
                <td style="border: none; vertical-align: top; padding: 2px 0; white-space: nowrap;">Fase</td>
                <td style="border: none; vertical-align: top; padding: 2px 0; text-align: center;">:</td>
                <td style="border: none; vertical-align: top; padding: 2px 0; white-space: nowrap;">${escapeHTML(faseDisplay)}</td>
            </tr>
            <tr style="border: none;">
                <td style="border: none; vertical-align: top; padding: 2px 0;">Nama Sekolah</td>
                <td style="border: none; vertical-align: top; padding: 2px 0;">:</td>
                <td style="border: none; vertical-align: top; padding: 2px 0;">${escapeHTML(schoolNameUpper)}</td>
                <td style="border: none; vertical-align: top; padding: 2px 0; white-space: nowrap;">Semester</td>
                <td style="border: none; vertical-align: top; padding: 2px 0; text-align: center;">:</td>
                <td style="border: none; vertical-align: top; padding: 2px 0; white-space: nowrap;">${escapeHTML(semester)}</td>
            </tr>
            <tr style="border: none;">
                <td style="border: none; vertical-align: top; padding: 2px 0;">Alamat</td>
                <td style="border: none; vertical-align: top; padding: 2px 0;">:</td>
                <td style="border: none; vertical-align: top; padding: 2px 0;">${escapeHTML(schoolStreetAddress)}</td>
                <td style="border: none; vertical-align: top; padding: 2px 0; white-space: nowrap;">Tahun Pelajaran</td>
                <td style="border: none; vertical-align: top; padding: 2px 0; text-align: center;">:</td>
                <td style="border: none; vertical-align: top; padding: 2px 0; white-space: nowrap;">${escapeHTML(academicYear)}</td>
            </tr>
        </table>

        <!-- GARIS PEMISAH -->
        <div style="border-bottom: 2px solid #000; margin: 6px 0 16px 0;"></div>

        <!-- JUDUL -->
        <div style="text-align: center; margin-bottom: 18px;">
            <div style="font-weight: bold; font-size: 11pt; letter-spacing: 0.5px;">LAPORAN CAPAIAN KOMPETENSI</div>
            <div style="font-weight: bold; font-size: 11pt; letter-spacing: 0.5px;">MATA PELAJARAN VOKASI PERHOTELAN</div>
        </div>

        <!-- A. NILAI PENGETAHUAN -->
        <div style="margin-bottom: 16px;">
            <div style="font-weight: bold; font-size: 10pt; margin-bottom: 5px;">A. Nilai Pengetahuan</div>
            <table style="width: 100%; border-collapse: collapse; font-size: 9.5pt;">
                <thead>
                    <tr style="background-color: #dbeafe; font-weight: bold; text-align: center;">
                        <th style="border: 1px solid #000; padding: 6px 4px; width: 5%;">No</th>
                        <th style="border: 1px solid #000; padding: 6px 6px; width: 25%;">Mata Pelajaran</th>
                        <th style="border: 1px solid #000; padding: 6px 4px; width: 11%;">Nilai Akhir</th>
                        <th style="border: 1px solid #000; padding: 6px 6px; width: 14%;">Predikat</th>
                        <th style="border: 1px solid #000; padding: 6px 8px;">Capaian Kompetensi</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="border: 1px solid #000; padding: 6px 4px; text-align: center; vertical-align: middle;">1</td>
                        <td style="border: 1px solid #000; padding: 6px 6px; font-style: italic; vertical-align: middle;">Food and Beverage<br>Service</td>
                        <td style="border: 1px solid #000; padding: 6px 4px; text-align: center; vertical-align: middle;">${fb.pengetahuanScore || ''}</td>
                        <td style="border: 1px solid #000; padding: 6px 6px; text-align: center; vertical-align: middle;">${fb.pengetahuanPredikat || ''}</td>
                        <td style="border: 1px solid #000; padding: 6px 8px; text-align: left; vertical-align: middle;">${escapeHTML(fb.pengetahuanDesc || '')}</td>
                    </tr>
                    <tr>
                        <td style="border: 1px solid #000; padding: 6px 4px; text-align: center; vertical-align: middle;">2</td>
                        <td style="border: 1px solid #000; padding: 6px 6px; font-style: italic; vertical-align: middle;">Housekeeping</td>
                        <td style="border: 1px solid #000; padding: 6px 4px; text-align: center; vertical-align: middle;">${hk.pengetahuanScore || ''}</td>
                        <td style="border: 1px solid #000; padding: 6px 6px; text-align: center; vertical-align: middle;">${hk.pengetahuanPredikat || ''}</td>
                        <td style="border: 1px solid #000; padding: 6px 8px; text-align: left; vertical-align: middle;">${escapeHTML(hk.pengetahuanDesc || '')}</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <!-- B. NILAI KETERAMPILAN -->
        <div style="margin-bottom: 16px;">
            <div style="font-weight: bold; font-size: 10pt; margin-bottom: 5px;">B. Nilai Keterampilan</div>
            <table style="width: 100%; border-collapse: collapse; font-size: 9.5pt;">
                <thead>
                    <tr style="background-color: #dbeafe; font-weight: bold; text-align: center;">
                        <th style="border: 1px solid #000; padding: 6px 4px; width: 5%;">No</th>
                        <th style="border: 1px solid #000; padding: 6px 6px; width: 25%;">Mata Pelajaran</th>
                        <th style="border: 1px solid #000; padding: 6px 4px; width: 11%;">Nilai Akhir</th>
                        <th style="border: 1px solid #000; padding: 6px 6px; width: 14%;">Predikat</th>
                        <th style="border: 1px solid #000; padding: 6px 8px;">Capaian Kompetensi</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="border: 1px solid #000; padding: 6px 4px; text-align: center; vertical-align: middle;">1</td>
                        <td style="border: 1px solid #000; padding: 6px 6px; font-style: italic; vertical-align: middle;">Food and Beverage<br>Service</td>
                        <td style="border: 1px solid #000; padding: 6px 4px; text-align: center; vertical-align: middle;">${fb.keterampilanScore || ''}</td>
                        <td style="border: 1px solid #000; padding: 6px 6px; text-align: center; vertical-align: middle;">${fb.keterampilanPredikat || ''}</td>
                        <td style="border: 1px solid #000; padding: 6px 8px; text-align: left; vertical-align: middle;">${escapeHTML(fb.keterampilanDesc || '')}</td>
                    </tr>
                    <tr>
                        <td style="border: 1px solid #000; padding: 6px 4px; text-align: center; vertical-align: middle;">2</td>
                        <td style="border: 1px solid #000; padding: 6px 6px; font-style: italic; vertical-align: middle;">Housekeeping</td>
                        <td style="border: 1px solid #000; padding: 6px 4px; text-align: center; vertical-align: middle;">${hk.keterampilanScore || ''}</td>
                        <td style="border: 1px solid #000; padding: 6px 6px; text-align: center; vertical-align: middle;">${hk.keterampilanPredikat || ''}</td>
                        <td style="border: 1px solid #000; padding: 6px 8px; text-align: left; vertical-align: middle;">${escapeHTML(hk.keterampilanDesc || '')}</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <!-- KETERANGAN PREDIKAT -->
        <div style="margin-top: 10px; margin-bottom: 22px;">
            <div style="font-weight: bold; font-size: 10pt; margin-bottom: 4px;">Keterangan</div>
            <table style="border-collapse: collapse; font-size: 9pt; width: 340px;">
                <thead>
                    <tr style="text-align: center; font-weight: bold;">
                        <th style="border: 1px solid #000; padding: 4px 6px;">Rentang Rata-Rata Total</th>
                        <th style="border: 1px solid #000; padding: 4px 6px;">Ketercapaian Kompetensi</th>
                    </tr>
                </thead>
                <tbody style="text-align: center;">
                    <tr>
                        <td style="border: 1px solid #000; padding: 3px 6px;">0 - 59</td>
                        <td style="border: 1px solid #000; padding: 3px 6px;">Kurang Kompeten</td>
                    </tr>
                    <tr>
                        <td style="border: 1px solid #000; padding: 3px 6px;">60 - 69</td>
                        <td style="border: 1px solid #000; padding: 3px 6px;">Cukup Kompeten</td>
                    </tr>
                    <tr>
                        <td style="border: 1px solid #000; padding: 3px 6px;">70 - 84</td>
                        <td style="border: 1px solid #000; padding: 3px 6px;">Kompeten</td>
                    </tr>
                    <tr>
                        <td style="border: 1px solid #000; padding: 3px 6px;">85 - 100</td>
                        <td style="border: 1px solid #000; padding: 3px 6px;">Sangat Kompeten</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <!-- TANDA TANGAN 3 PIHAK -->
        <table style="width: 100%; border: none; border-collapse: collapse; font-size: 10pt; margin-top: 8px;">
            <tr style="border: none;">
                <td style="width: 70%; border: none; vertical-align: top; padding: 0;">
                    <div>Mengetahui</div>
                    <div>Orang Tua/Wali,</div>
                    <div style="height: 55px;"></div>
                    <div>.....................................................</div>
                </td>
                <td style="width: 30%; border: none; vertical-align: top; padding: 0; text-align: left;">
                    <div>${escapeHTML(schoolCity)}, ${escapeHTML(reportDate)}</div>
                    <div>Wali Kelas,</div>
                    <div style="height: 55px;"></div>
                    <div style="font-weight: bold; text-decoration: underline;">${escapeHTML(teacherName)}</div>
                    <div>${escapeHTML(teacherNipDisplay)}</div>
                </td>
            </tr>
            <tr style="border: none;">
                <td colspan="2" style="border: none; text-align: center; vertical-align: top; padding-top: 18px;">
                    <div>Mengetahui</div>
                    <div>Kepala Sekolah</div>
                    <div style="height: 55px;"></div>
                    <div style="font-weight: bold; text-decoration: underline;">${escapeHTML(kepsekName)}</div>
                    <div>${escapeHTML(kepsekNipDisplay)}</div>
                </td>
            </tr>
        </table>
    `;
}
window.buildRaporPerhotelanPageHtml = buildRaporPerhotelanPageHtml;

/**
 * Pratinjau Rekapan Nilai & Deskripsi CP Rapor Perhotelan Satuan (Personal Siswa)
 */
async function openPreviewSingleRaporPerhotelan(nis) {
    try {
        const targetNis = nis || activePrintStudent?.nis;
        if (!targetNis) {
            showToast('Peringatan', 'Pilih siswa terlebih dahulu untuk melihat pratinjau rapor perhotelan.', 'warning');
            return;
        }

        const cleanTargetNis = String(targetNis).trim();
        const student = (currentClassStudents || []).find(s => 
            String(s.nis || '').trim() === cleanTargetNis || 
            String(s.id || '').trim() === cleanTargetNis ||
            s.nis == cleanTargetNis ||
            s.id == cleanTargetNis ||
            (typeof normalizeNIS === 'function' && normalizeNIS(s.nis) && normalizeNIS(s.nis) === normalizeNIS(cleanTargetNis)) ||
            (cleanTargetNis.padStart(4, '0') === String(s.nis || '').trim().padStart(4, '0'))
        );
        if (!student) {
            showToast('Error', `Data siswa dengan NIS ${targetNis} tidak ditemukan.`, 'error');
            return;
        }

        activePrintStudent = student;
        const studentClass = currentRombelClass || student.class || '';

        if (!isPerhotelanClass(studentClass)) {
            showToast('Peringatan', 'Rapor Vokasi Perhotelan hanya diperuntukkan bagi siswa kelas X dan XI.', 'warning');
            return;
        }

        const modal = document.getElementById('modal-preview-rapor-perhotelan');
        const modalDialog = document.getElementById('modal-preview-rapor-perhotelan-dialog');
        const modalTitle = document.getElementById('perhotelan-preview-modal-title');
        const modalSubtitle = document.getElementById('perhotelan-preview-modal-subtitle');
        const modalBody = document.getElementById('perhotelan-preview-modal-body');
        const modalActions = document.getElementById('perhotelan-preview-modal-actions');
        if (!modal || !modalBody) {
            showToast('Error', 'Komponen modal pratinjau perhotelan tidak ditemukan di halaman.', 'error');
            return;
        }

        if (modalDialog) {
            modalDialog.classList.remove('max-w-4xl');
            modalDialog.classList.add('max-w-2xl');
        }

        // INSTANT FEEDBACK: Buka modal pratinjau seketika dengan spinner sebelum network call
        window.closeModal('print-settings-modal');

        if (modalTitle) modalTitle.textContent = `Pratinjau Rapor Vokasi Perhotelan - ${student.name || 'Siswa'}`;
        if (modalSubtitle) modalSubtitle.textContent = 'Memuat data...';
        if (modalActions) modalActions.innerHTML = '';
        modalBody.innerHTML = `
            <div class="py-12 text-center text-slate-500 dark:text-slate-400">
                <i class="fa-solid fa-circle-notch fa-spin text-2xl text-teal-600 mb-2"></i>
                <p>Memuat rekapan nilai dan deskripsi capaian pembelajaran...</p>
            </div>
        `;
        modal.classList.remove('hidden');
        modal.style.display = 'flex';
        if (typeof window.openModal === 'function') window.openModal('modal-preview-rapor-perhotelan');

        const activeYear = document.getElementById('tab-rapor-year-filter')?.value || '2025/2026';
        const activeSem = document.getElementById('print-modal-semester-select')?.value || document.getElementById('tab-rapor-semester-filter')?.value || '2';
        const cleanSem = (activeSem === 'TA' || activeSem === 'FULL' || activeSem === 'ALL') ? '2' : activeSem;

        // Ambil tanggal SSOT kurikulum (setelah modal sudah terbuka dengan spinner)
        const ssotDateIso = await getSsotRaporDate();
        const reportDate = formatDateIndoFormal(ssotDateIso);

        const perhotelanScores = await fetchPerhotelanScoresForClass(studentClass, activeYear, cleanSem);
        const resolved = resolveStudentPerhotelan(student, perhotelanScores);

        const isClassX = /^X[\s\-\.]/i.test(studentClass);
        const mapelKey = isClassX ? 'fb' : 'hk';
        const mapelName = isClassX ? 'Food and Beverage Service' : 'Housekeeping';
        const subjectData = resolved[mapelKey] || {};

        const scorePengetahuan = subjectData.pengetahuanScore || '-';
        const predikatPengetahuan = subjectData.pengetahuanPredikat || '-';
        const scoreKeterampilan = subjectData.keterampilanScore || '-';
        const predikatKeterampilan = subjectData.keterampilanPredikat || '-';
        const deskripsiCp = subjectData.pengetahuanDesc || subjectData.keterampilanDesc || 'Deskripsi capaian pembelajaran belum diinput oleh guru mata pelajaran.';

    if (modalTitle) {
        modalTitle.textContent = `Pratinjau Rapor Vokasi Perhotelan - ${student.name || 'Siswa'}`;
    }
    if (modalSubtitle) {
        modalSubtitle.innerHTML = `${escapeHTML(mapelName)} &bull; Kelas ${escapeHTML(studentClass.replace(/[-_]/g, ' '))} &bull; TA ${escapeHTML(activeYear)} (Sem. ${escapeHTML(cleanSem)})`;
    }

    modalBody.innerHTML = `
        <!-- Identitas Siswa -->
        <div class="bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800/60 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div>
                <p class="text-[10px] uppercase font-bold text-teal-700 dark:text-teal-400 tracking-wider">Nama Lengkap Siswa</p>
                <h4 class="font-bold text-sm text-slate-800 dark:text-slate-100">${escapeHTML(student.name || '-')}</h4>
                <p class="text-slate-500 dark:text-slate-400 text-[11px] mt-0.5">NIS: ${escapeHTML(student.nis || '-')} &bull; NISN: ${escapeHTML(student.nisn || '-')}</p>
            </div>
            <div class="text-right">
                <p class="text-[10px] uppercase font-bold text-teal-700 dark:text-teal-400 tracking-wider">Mata Pelajaran Aktif</p>
                <div class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-teal-600 text-white font-semibold rounded-lg text-xs mt-0.5 shadow-sm">
                    <i class="fa-solid fa-utensils text-[10px]"></i>
                    <span>${escapeHTML(mapelName)}</span>
                </div>
                <p class="text-slate-500 dark:text-slate-400 text-[10px] mt-1">Tanggal Cetak SSOT: <strong>${escapeHTML(reportDate)}</strong></p>
            </div>
        </div>

        <!-- Rekapan Nilai Rapor (NR) -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="bg-white dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700/80 rounded-xl p-3.5 shadow-sm">
                <div class="flex items-center justify-between mb-2">
                    <span class="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Nilai Pengetahuan (NR)</span>
                    <span class="px-2 py-0.5 text-[10px] font-bold rounded-full ${predikatPengetahuan === 'Sangat Kompeten' ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300' : 'bg-teal-100 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300'}">
                        ${escapeHTML(predikatPengetahuan)}
                    </span>
                </div>
                <div class="text-2xl font-black text-slate-800 dark:text-white">
                    ${escapeHTML(scorePengetahuan)}
                </div>
            </div>

            <div class="bg-white dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700/80 rounded-xl p-3.5 shadow-sm">
                <div class="flex items-center justify-between mb-2">
                    <span class="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Nilai Keterampilan (NR)</span>
                    <span class="px-2 py-0.5 text-[10px] font-bold rounded-full ${predikatKeterampilan === 'Sangat Kompeten' ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300' : 'bg-teal-100 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300'}">
                        ${escapeHTML(predikatKeterampilan)}
                    </span>
                </div>
                <div class="text-2xl font-black text-slate-800 dark:text-white">
                    ${escapeHTML(scoreKeterampilan)}
                </div>
            </div>
        </div>

        <!-- Deskripsi Capaian Kompetensi (CP) -->
        <div class="bg-white dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700/80 rounded-xl p-4 shadow-sm space-y-1.5">
            <h5 class="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                <i class="fa-solid fa-file-lines text-teal-600"></i> Deskripsi Capaian Pembelajaran (CP)
            </h5>
            <div class="p-3 bg-slate-50 dark:bg-slate-900/60 rounded-lg text-slate-700 dark:text-slate-300 text-xs leading-relaxed border border-slate-100 dark:border-slate-800">
                ${escapeHTML(deskripsiCp)}
            </div>
        </div>

        <div class="p-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-xl text-[11px] text-amber-800 dark:text-amber-300 flex items-center gap-2">
            <i class="fa-solid fa-circle-info text-amber-500 text-sm shrink-0"></i>
            <span>Periksa nilai dan deskripsi CP di atas. Klik <strong>Lanjut Cetak Rapor</strong> untuk mencetak lembar rapor resmi (A4).</span>
        </div>
    `;

    if (modalActions) {
        modalActions.innerHTML = `
            <button type="button" onclick="window.printRaporPerhotelanWali('${escapeHTML(student.nis)}', true)"
                class="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-xl shadow-md shadow-teal-600/20 transition flex items-center gap-1.5">
                <i class="fa-solid fa-print"></i> Lanjut Cetak Rapor
            </button>
        `;
    }
    } catch (err) {
        console.error('[WaliKelas] Gagal membuka pratinjau rapor perhotelan:', err);
        showToast('Error', 'Gagal memuat pratinjau rapor perhotelan: ' + (err.message || err), 'error');
    }
}
window.openPreviewSingleRaporPerhotelan = openPreviewSingleRaporPerhotelan;

/**
 * Pratinjau Rekapan Nilai & Deskripsi CP Rapor Perhotelan Seluruh Siswa Rombel 1 Kelas
 */
async function openPreviewAllRaporPerhotelan() {
    try {
        if (!currentClassStudents || currentClassStudents.length === 0) {
            showToast('Peringatan', 'Tidak ada siswa pada rombel ini.', 'warning');
            return;
        }

        const studentClass = currentRombelClass || (currentClassStudents[0]?.class || '');

        if (!isPerhotelanClass(studentClass)) {
            showToast('Peringatan', 'Rapor Vokasi Perhotelan hanya diperuntukkan bagi siswa kelas X dan XI.', 'warning');
            return;
        }

        const modal = document.getElementById('modal-preview-rapor-perhotelan');
        const modalDialog = document.getElementById('modal-preview-rapor-perhotelan-dialog');
        const modalTitle = document.getElementById('perhotelan-preview-modal-title');
        const modalSubtitle = document.getElementById('perhotelan-preview-modal-subtitle');
        const modalBody = document.getElementById('perhotelan-preview-modal-body');
        const modalActions = document.getElementById('perhotelan-preview-modal-actions');
        if (!modal || !modalBody) {
            showToast('Error', 'Komponen modal pratinjau perhotelan tidak ditemukan di halaman.', 'error');
            return;
        }

        if (modalDialog) {
            modalDialog.classList.remove('max-w-2xl');
            modalDialog.classList.add('max-w-4xl');
        }

        // INSTANT FEEDBACK: Tutup modal AI jika sedang terbuka, buka modal pratinjau dengan spinner SEGERA
        window.closeModal('print-settings-modal');

        if (modalTitle) modalTitle.textContent = `Pratinjau Kolektif Rapor Perhotelan Kelas ${studentClass.replace(/[-_]/g, ' ')}`;
        if (modalSubtitle) modalSubtitle.textContent = 'Memuat rekapan nilai rombel...';
        if (modalActions) modalActions.innerHTML = '';
        modalBody.innerHTML = `
            <div class="py-12 text-center text-slate-500 dark:text-slate-400">
                <i class="fa-solid fa-circle-notch fa-spin text-2xl text-teal-600 mb-2"></i>
                <p>Memuat rekapan nilai seluruh siswa rombel kelas...</p>
            </div>
        `;
        modal.classList.remove('hidden');
        modal.style.display = 'flex';
        if (typeof window.openModal === 'function') window.openModal('modal-preview-rapor-perhotelan');

        const activeYear = document.getElementById('tab-rapor-year-filter')?.value || '2025/2026';
        const activeSem = document.getElementById('tab-rapor-semester-filter')?.value || '2';
        const cleanSem = (activeSem === 'TA' || activeSem === 'FULL' || activeSem === 'ALL') ? '2' : activeSem;

        // Ambil tanggal SSOT kurikulum (setelah modal sudah terbuka dengan spinner)
        const ssotDateIso = await getSsotRaporDate();
        const reportDate = formatDateIndoFormal(ssotDateIso);

        const perhotelanScores = await fetchPerhotelanScoresForClass(studentClass, activeYear, cleanSem);

        const isClassX = /^X[\s\-\.]/i.test(studentClass);
        const mapelKey = isClassX ? 'fb' : 'hk';
        const mapelName = isClassX ? 'Food and Beverage Service' : 'Housekeeping';

        if (modalTitle) {
            modalTitle.textContent = `Pratinjau Kolektif Rapor Perhotelan Kelas ${studentClass.replace(/[-_]/g, ' ')}`;
        }
        if (modalSubtitle) {
            modalSubtitle.innerHTML = `${escapeHTML(mapelName)} &bull; ${currentClassStudents.length} Siswa &bull; TA ${escapeHTML(activeYear)} (Sem. ${escapeHTML(cleanSem)})`;
        }

        const rowsHtml = currentClassStudents.map((student, idx) => {
            const resolved = resolveStudentPerhotelan(student, perhotelanScores);
            const subjectData = resolved[mapelKey] || {};
            const scorePengetahuan = subjectData.pengetahuanScore || '-';
            const predikatPengetahuan = subjectData.pengetahuanPredikat || '-';
            const scoreKeterampilan = subjectData.keterampilanScore || '-';
            const predikatKeterampilan = subjectData.keterampilanPredikat || '-';
            const deskripsiCp = subjectData.pengetahuanDesc || subjectData.keterampilanDesc || '-';

            return `
                <tr class="hover:bg-teal-50/40 dark:hover:bg-teal-950/20 transition">
                    <td class="p-2.5 text-center font-semibold text-slate-500">${idx + 1}</td>
                    <td class="p-2.5 text-center font-mono text-slate-600 dark:text-slate-300">${escapeHTML(student.nis || '-')}</td>
                    <td class="p-2.5 font-bold text-slate-800 dark:text-slate-100">${escapeHTML(student.name || '-')}</td>
                    <td class="p-2.5 text-center font-bold text-slate-700 dark:text-slate-200">${escapeHTML(String(scorePengetahuan))}</td>
                    <td class="p-2.5 text-center font-bold text-slate-700 dark:text-slate-200">${escapeHTML(String(scoreKeterampilan))}</td>
                    <td class="p-2.5 text-center font-semibold text-teal-700 dark:text-teal-400">${escapeHTML(predikatPengetahuan !== '-' ? predikatPengetahuan : predikatKeterampilan)}</td>
                    <td class="p-2.5 text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed max-w-xs">${escapeHTML(deskripsiCp)}</td>
                </tr>
            `;
        }).join('');

        modalBody.innerHTML = `
            <div class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table class="w-full text-left text-xs text-slate-700 dark:text-slate-200">
                    <thead class="bg-slate-100/90 dark:bg-slate-800 text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase">
                        <tr>
                            <th class="px-2.5 py-2 text-center">No</th>
                            <th class="px-2.5 py-2">NIS</th>
                            <th class="px-2.5 py-2">Nama Siswa</th>
                            <th class="px-2.5 py-2 text-center">Pengetahuan</th>
                            <th class="px-2.5 py-2 text-center">Keterampilan</th>
                            <th class="px-2.5 py-2 text-center">Predikat</th>
                            <th class="px-2.5 py-2">Deskripsi Capaian (CP)</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>

            <div class="p-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-xl text-[11px] text-amber-800 dark:text-amber-300 flex items-center gap-2">
                <i class="fa-solid fa-circle-info text-amber-500 text-sm shrink-0"></i>
                <span>Periksa seluruh rekapan nilai di atas. Klik <strong>Lanjut Cetak Semua Rapor</strong> untuk mencetak langsung lembar resmi seluruh siswa rombel (${currentClassStudents.length} halaman A4).</span>
            </div>
        `;

        if (modalActions) {
            modalActions.innerHTML = `
                <button type="button" onclick="window.printAllRaporPerhotelanWali(true)"
                    class="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-xl shadow-md shadow-teal-600/20 transition flex items-center gap-1.5">
                    <i class="fa-solid fa-print"></i> Lanjut Cetak Semua Rapor (${currentClassStudents.length} Siswa)
                </button>
            `;
        }
    } catch (err) {
        console.error('[WaliKelas] Gagal membuka pratinjau kolektif rapor perhotelan:', err);
        showToast('Error', 'Gagal memuat pratinjau kolektif rapor perhotelan: ' + (err.message || err), 'error');
    }
}
window.openPreviewAllRaporPerhotelan = openPreviewAllRaporPerhotelan;

function executeRaporPerhotelanPrint(printWin, printTitle, fullHtml) {
    if (printWin && !printWin.closed) {
        try {
            printWin.document.open();
            printWin.document.write(fullHtml);
            printWin.document.close();
            return true;
        } catch (e) {
            console.warn('[WaliKelas] Gagal menulis ke print window, mengalihkan ke pencetakan otomatis iframe:', e);
            try { printWin.close(); } catch (_) {}
        }
    }

    // Fallback Iframe (100% Anti Pop-up Blocker: Dialog Cetak A4 Langsung Terbuka)
    try {
        let iframe = document.getElementById('simas-rapor-perhotelan-print-frame');
        if (iframe) iframe.remove();

        iframe = document.createElement('iframe');
        iframe.id = 'simas-rapor-perhotelan-print-frame';
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        iframe.style.zIndex = '-9999';
        document.body.appendChild(iframe);

        const doc = iframe.contentWindow.document;
        doc.open();
        doc.write(fullHtml);
        doc.close();

        setTimeout(() => {
            try {
                iframe.contentWindow.focus();
                iframe.contentWindow.print();
            } catch (errPrint) {
                console.error('[WaliKelas] Cetak iframe error:', errPrint);
            }
        }, 500);
        return true;
    } catch (errFallback) {
        console.error('[WaliKelas] Gagal mengeksekusi pencetakan iframe:', errFallback);
        showToast('Error', 'Gagal memicu pencetakan dokumen rapor: ' + (errFallback.message || errFallback), 'error');
        return false;
    }
}
window.executeRaporPerhotelanPrint = executeRaporPerhotelanPrint;

window.printSingleRaporPerhotelanWali = async function (nis) {
    try {
        await window.openPreviewSingleRaporPerhotelan(nis);
    } catch (err) {
        console.error('[WaliKelas] Gagal memicu pratinjau perhotelan satuan:', err);
        showToast('Error', 'Gagal memuat pratinjau rapor perhotelan: ' + (err.message || err), 'error');
    }
};

window.printRaporPerhotelanWali = async function (nis = null, directPrint = false) {
    try {
        const targetNis = nis || activePrintStudent?.nis;
        if (!targetNis) {
            showToast('Peringatan', 'Pilih siswa terlebih dahulu untuk mencetak rapor perhotelan.', 'warning');
            return;
        }

        // Jika dipanggil tanpa directPrint, buka modal pratinjau rekapan nilai & deskripsi CP terlebih dahulu
        if (!directPrint) {
            await window.openPreviewSingleRaporPerhotelan(targetNis);
            return;
        }

        const cleanTargetNis = String(targetNis).trim();
        const student = (currentClassStudents || []).find(s => 
            String(s.nis || '').trim() === cleanTargetNis || 
            String(s.id || '').trim() === cleanTargetNis ||
            s.nis == cleanTargetNis ||
            s.id == cleanTargetNis ||
            (typeof normalizeNIS === 'function' && normalizeNIS(s.nis) && normalizeNIS(s.nis) === normalizeNIS(cleanTargetNis)) ||
            (cleanTargetNis.padStart(4, '0') === String(s.nis || '').trim().padStart(4, '0'))
        );
        if (!student) {
            showToast('Error', `Data siswa dengan NIS ${targetNis} tidak ditemukan.`, 'error');
            return;
        }

        activePrintStudent = student;
        const studentClass = currentRombelClass || student.class || '';

        if (!isPerhotelanClass(studentClass)) {
            showToast('Peringatan', 'Rapor Vokasi Perhotelan hanya diperuntukkan bagi siswa kelas X dan XI.', 'warning');
            return;
        }

        window.closeModal('modal-preview-rapor-perhotelan');

        // Tanggal Cetak Rapor SSOT dari Kurikulum (Cloudflare D1 system_settings.rapor_config)
        const confirmedDateIso = await getSsotRaporDate();
        if (!confirmedDateIso) return;

        const activeYear = document.getElementById('tab-rapor-year-filter')?.value || '2025/2026';
        const activeSem = document.getElementById('print-modal-semester-select')?.value || document.getElementById('tab-rapor-semester-filter')?.value || '2';
        const cleanSem = (activeSem === 'TA' || activeSem === 'FULL' || activeSem === 'ALL') ? '2' : activeSem;
        const reportDate = formatDateIndoFormal(confirmedDateIso);

        const teacher = (typeof window.resolveHomeroomTeacher === 'function')
            ? await window.resolveHomeroomTeacher(studentClass, currentUserProfile)
            : {
                name: currentUserProfile?.name || `Wali Kelas ${studentClass}`,
                nip: currentUserProfile?.nip || ''
            };

        showToast('Info', 'Memuat data nilai rapor perhotelan...', 'info');
        const perhotelanScores = await fetchPerhotelanScoresForClass(studentClass, activeYear, cleanSem);
        const resolvedPerhotelan = resolveStudentPerhotelan(student, perhotelanScores);

        const options = {
            academicYear: activeYear,
            semester: cleanSem,
            reportDate: reportDate,
            schoolCity: SCHOOL_CONFIG.schoolCity || 'Abang',
            schoolNameUpper: SCHOOL_CONFIG.schoolNameUpper || "SMA NEGERI NUSANTARA",
            schoolStreetAddress: SCHOOL_CONFIG.schoolAddressShort || SCHOOL_CONFIG.schoolStreetAddress || "Jl. Nusantara No. 1, Denpasar",
            kepsekName: SCHOOL_CONFIG.headmasterName || "Dr. I Wayan Sudarsana, M.Pd.",
            kepsekNIP: SCHOOL_CONFIG.headmasterNIP || '19700521 199702 1 001'
        };

        const studentPageHtml = buildRaporPerhotelanPageHtml(student, resolvedPerhotelan, teacher, options);

        const printWin = window.open('', '_blank');
        if (!printWin) {
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    icon: 'warning',
                    title: 'Pop-up Terblokir',
                    text: 'Peramban memblokir jendela pratinjau cetak. Mohon izinkan pop-up (Always allow pop-ups) pada peramban Anda untuk mencetak Rapor Vokasi Perhotelan.'
                });
            } else if (typeof showToast === 'function') {
                showToast("Pop-up Terblokir", "Harap izinkan pop-up peramban untuk membuka pratinjau cetak rapor.", "warning");
            }
        }

        const fullHtml = `
            <!DOCTYPE html>
            <html lang="id">
            <head>
                <meta charset="UTF-8">
                <title>Rapor Vokasi Perhotelan - ${escapeHTML(student.name || 'Siswa')}</title>
                <style>
                    @page { size: A4 portrait; margin: 12mm 15mm; }
                    * { box-sizing: border-box; }
                    body {
                        font-family: Arial, Helvetica, sans-serif;
                        color: #000;
                        background: #fff;
                        margin: 0;
                        padding: 8px;
                        line-height: 1.35;
                        font-size: 10pt;
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                    @media print {
                        body { padding: 0; }
                        .no-print { display: none !important; }
                    }
                </style>
            </head>
            <body>
                ${studentPageHtml}
                <script>window.onload = function() { window.print(); }<\/script>
            </body>
            </html>
        `;

        executeRaporPerhotelanPrint(printWin, `Rapor Vokasi Perhotelan - ${student.name || 'Siswa'}`, fullHtml);
    } catch (err) {
        console.error('[WaliKelas] Gagal mencetak rapor perhotelan:', err);
        showToast('Error', 'Gagal mencetak rapor perhotelan: ' + (err.message || err), 'error');
    }
};

window.printAllRaporPerhotelanWali = async function (directPrint = false) {
    try {
        if (!currentClassStudents || currentClassStudents.length === 0) {
            showToast('Peringatan', 'Tidak ada siswa pada rombel ini.', 'warning');
            return;
        }

        const studentClass = currentRombelClass || (currentClassStudents[0]?.class || '');

        if (!isPerhotelanClass(studentClass)) {
            showToast('Peringatan', 'Rapor Vokasi Perhotelan hanya diperuntukkan bagi siswa kelas X dan XI.', 'warning');
            return;
        }

        // Jika dipanggil tanpa directPrint, buka modal pratinjau rekapan nilai seluruh siswa 1 rombel
        if (!directPrint) {
            await window.openPreviewAllRaporPerhotelan();
            return;
        }

        window.closeModal('modal-preview-rapor-perhotelan');

        // Tanggal Cetak Rapor SSOT dari Kurikulum (Cloudflare D1 system_settings.rapor_config)
        const confirmedDateIso = await getSsotRaporDate();
        if (!confirmedDateIso) return;

        const activeYear = document.getElementById('tab-rapor-year-filter')?.value || '2025/2026';
        const activeSem = document.getElementById('tab-rapor-semester-filter')?.value || '2';
        const cleanSem = (activeSem === 'TA' || activeSem === 'FULL' || activeSem === 'ALL') ? '2' : activeSem;
        const reportDate = formatDateIndoFormal(confirmedDateIso);

        const teacher = (typeof window.resolveHomeroomTeacher === 'function')
            ? await window.resolveHomeroomTeacher(studentClass, currentUserProfile)
            : {
                name: currentUserProfile?.name || `Wali Kelas ${studentClass}`,
                nip: currentUserProfile?.nip || ''
            };

        showToast('Info', `Menyiapkan ${currentClassStudents.length} rapor perhotelan...`, 'info');

        const perhotelanScores = await fetchPerhotelanScoresForClass(studentClass, activeYear, cleanSem);

        const options = {
            academicYear: activeYear,
            semester: cleanSem,
            reportDate: reportDate,
            schoolCity: SCHOOL_CONFIG.schoolCity || 'Abang',
            schoolNameUpper: SCHOOL_CONFIG.schoolNameUpper || "SMA NEGERI NUSANTARA",
            schoolStreetAddress: SCHOOL_CONFIG.schoolAddressShort || SCHOOL_CONFIG.schoolStreetAddress || "Jl. Nusantara No. 1, Denpasar",
            kepsekName: SCHOOL_CONFIG.headmasterName || "Dr. I Wayan Sudarsana, M.Pd.",
            kepsekNIP: SCHOOL_CONFIG.headmasterNIP || '19700521 199702 1 001'
        };

        const pagesHtml = currentClassStudents.map((student, idx) => {
            const resolved = resolveStudentPerhotelan(student, perhotelanScores);
            const isLast = idx === currentClassStudents.length - 1;
            const pageBreakStyle = isLast ? '' : 'page-break-after: always; break-after: page;';
            return `
                <div class="rapor-perhotelan-page" style="${pageBreakStyle} min-height: 98%;">
                    ${buildRaporPerhotelanPageHtml(student, resolved, teacher, options)}
                </div>
            `;
        }).join('');

        const printWin = window.open('', '_blank');
        if (!printWin) {
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    icon: 'warning',
                    title: 'Pop-up Terblokir',
                    text: 'Peramban memblokir jendela pratinjau cetak. Mohon izinkan pop-up (Always allow pop-ups) pada peramban Anda untuk mencetak Rapor Vokasi Perhotelan.'
                });
            } else if (typeof showToast === 'function') {
                showToast("Pop-up Terblokir", "Harap izinkan pop-up peramban untuk membuka pratinjau cetak rapor.", "warning");
            }
        }

        const fullHtml = `
            <!DOCTYPE html>
            <html lang="id">
            <head>
                <meta charset="UTF-8">
                <title>Cetak Semua Rapor Vokasi Perhotelan - Kelas ${escapeHTML(studentClass)}</title>
                <style>
                    @page { size: A4 portrait; margin: 12mm 15mm; }
                    * { box-sizing: border-box; }
                    body {
                        font-family: Arial, Helvetica, sans-serif;
                        color: #000;
                        background: #fff;
                        margin: 0;
                        padding: 8px;
                        line-height: 1.35;
                        font-size: 10pt;
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                    .rapor-perhotelan-page {
                        box-sizing: border-box;
                    }
                    @media print {
                        body { padding: 0; }
                        .no-print { display: none !important; }
                        .rapor-perhotelan-page {
                            page-break-inside: avoid;
                        }
                    }
                </style>
            </head>
            <body>
                ${pagesHtml}
                <script>window.onload = function() { window.print(); }<\/script>
            </body>
            </html>
        `;

        executeRaporPerhotelanPrint(printWin, `Cetak Semua Rapor Vokasi Perhotelan - Kelas ${studentClass}`, fullHtml);
    } catch (err) {
        console.error('[WaliKelas] Gagal mencetak semua rapor perhotelan:', err);
        showToast('Error', 'Gagal mencetak semua rapor perhotelan: ' + (err.message || err), 'error');
    }
};

/**
 * Open Modal Detail Siswa (6 Integrated Tabs: Profil, Pembinaan, Presensi, Perilaku, SPP, BK)
 */
window.openModalDetailSiswa = async function (nis) {
    const student = currentClassStudents.find(s => String(s.nis) === String(nis) || String(s.id) === String(nis) || s.nis == nis);
    if (!student) return;

    activeStudentForDetail = student;

    // Header info
    const initial = (student.name || '?').charAt(0).toUpperCase();
    const avatarEl = document.getElementById('modal-detail-avatar');
    if (avatarEl) {
        const rawPhoto = student.activePhotoUrl || student.active_photo_url || student.photoUrl || student.photo_url || student.foto || student.foto_url || '';
        const resolvedPhoto = (typeof window.resolvePhotoUrl === 'function' && rawPhoto) ? window.resolvePhotoUrl(rawPhoto) : rawPhoto;
        if (resolvedPhoto && /^(https?:|\/|data:image\/)/i.test(resolvedPhoto)) {
            avatarEl.innerHTML = `<img src="${window.escapeHTML(resolvedPhoto)}" alt="${window.escapeHTML(student.name)}" class="w-full h-full object-cover rounded-full" onerror="this.onerror=null; this.parentElement.textContent='${initial}';" />`;
        } else {
            avatarEl.textContent = initial;
        }
    }
    document.getElementById('modal-detail-name').textContent = student.name || '-';
    document.getElementById('modal-detail-sub').textContent = `NIS: ${student.nis || '-'} | Rombel: ${student.class || '-'}`;

    // Action buttons inside modal
    document.getElementById('btn-detail-edit-profile').onclick = () => {
        window.openModalEditDataSiswa(student.nis);
    };

    const btnAddRecord = document.getElementById('btn-detail-add-record');
    if (btnAddRecord) {
        btnAddRecord.onclick = () => {
            window.openModalInputRecord(student.nis);
        };
    }

    // Fill Tab 1: Profil Lengkap Dapodik
    const setText = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = (val !== undefined && val !== null && String(val).trim() !== '') ? val : '-';
    };

    // 1. Identitas Siswa & Dokumen Pribadi
    setText('m-profil-nis', `${student.nis || '-'} / ${student.nisn || '-'}`);
    setText('m-profil-kelas', student.class || currentRombelClass || '-');
    setText('m-profil-gender', student.gender === 'L' ? 'Laki-laki' : student.gender === 'P' ? 'Perempuan' : (student.gender || '-'));
    setText('m-profil-agama', student.religion || student.agama);
    setText('m-profil-ttl', `${student.birthPlace || student.pob || student.tempatLahir || '-'}, ${student.birthDate || student.dob || student.tanggalLahir || '-'}`);
    setText('m-profil-nik', student.nik);
    setText('m-profil-kk', student.kk_no || student.no_kk);
    setText('m-profil-anak-ke', student.child_order || student.anakKe);
    setText('m-profil-jml-saudara', student.jml_saudara_kandung || student.jml_saudara);
    setText('m-profil-akta', student.akta_lahir_reg || student.no_akta || student.no_akta_lahir);
    setText('m-profil-sekolah-asal', student.sekolah_asal);

    // 2. Kontak Siswa, Domisili & Transportasi
    setText('m-profil-hp-siswa', student.phone_siswa || student.phone || student.hpSiswa);
    setText('m-profil-email', student.email_siswa || student.email);
    setText('m-profil-jenis-tinggal', student.living_type || student.jenis_tinggal);
    setText('m-profil-transportasi', student.transportation || student.alat_transportasi);
    setText('m-profil-alamat', student.address || student.alamat);
    setText('m-profil-dusun', student.dusun);
    setText('m-profil-kelurahan', student.kelurahan);
    setText('m-profil-kecamatan', student.kecamatan);
    setText('m-profil-kode-pos', student.postal_code || student.kode_pos);
    setText('m-profil-jarak', student.jarak_sekolah_km ? `${student.jarak_sekolah_km} KM` : '-');

    // 3. Rincian Data Ayah
    setText('m-profil-ayah-nama', student.father || student.namaAyah || student.father_name);
    setText('m-profil-ayah-nik', student.father_nik || student.nik_ayah);
    setText('m-profil-ayah-tahun', student.father_birth_year || student.tahun_lahir_ayah);
    setText('m-profil-ayah-pendidikan', student.father_education || student.pendidikan_ayah);
    setText('m-profil-ayah-pekerjaan', student.father_job || student.pekerjaan_ayah);
    setText('m-profil-ayah-penghasilan', student.father_income || student.penghasilan_ayah);
    setText('m-profil-ayah-hp', student.father_phone || student.phone_father || student.hpAyah || student.phone_parent || student.parentPhone);

    // 4. Rincian Data Ibu
    setText('m-profil-ibu-nama', student.mother || student.name_parent || student.parentName || student.namaIbu || student.mother_name);
    setText('m-profil-ibu-nik', student.mother_nik || student.nik_ibu);
    setText('m-profil-ibu-tahun', student.mother_birth_year || student.tahun_lahir_ibu);
    setText('m-profil-ibu-pendidikan', student.mother_education || student.pendidikan_ibu);
    setText('m-profil-ibu-pekerjaan', student.mother_job || student.pekerjaan_ibu);
    setText('m-profil-ibu-penghasilan', student.mother_income || student.penghasilan_ibu);
    setText('m-profil-ibu-hp', student.mother_phone || student.phone_mother || student.hpIbu || student.phone_parent || student.parentPhone);

    // 5. Rincian Data Wali
    setText('m-profil-wali-nama', student.guardian || student.guardian_name || student.nama_wali || student.namaWali);
    setText('m-profil-wali-nik', student.guardian_nik || student.nik_wali);
    setText('m-profil-wali-tahun', student.guardian_birth_year || student.tahun_lahir_wali);
    setText('m-profil-wali-pendidikan', student.guardian_education || student.pendidikan_wali);
    setText('m-profil-wali-pekerjaan', student.guardian_job || student.pekerjaan_wali);
    setText('m-profil-wali-penghasilan', student.guardian_income || student.penghasilan_wali);
    setText('m-profil-wali-hp', student.guardian_phone || student.phone_wali || student.hpWali);

    // 6. Data Fisik & Catatan
    setText('m-profil-bb', student.weight || student.berat_badan ? `${student.weight || student.berat_badan} kg` : '-');
    setText('m-profil-tb', student.height || student.tinggi_badan ? `${student.height || student.tinggi_badan} cm` : '-');
    setText('m-profil-lk', student.head_circumference || student.lingkar_kepala ? `${student.head_circumference || student.lingkar_kepala} cm` : '-');
    setText('m-profil-catatan', student.note || 'Tidak ada catatan tambahan.');

    // Direct WA Button inside Modal Detail (Otomatis hubungi Orang Tua)
    const btnWaDirect = document.getElementById('btn-modal-wa-direct');
    if (btnWaDirect) {
        btnWaDirect.onclick = () => {
            window.closeModal('modal-detail-siswa');
            window.openModalWaGenerator(student.nis, 'ews_warning', 'parent');
        };
    }

    await window.switchModalDetailTab('profil');
    window.openModal('modal-detail-siswa');
};

/**
 * Switch Modal Detail Sub-tabs
 */
window.switchModalDetailTab = async function (tabKey) {
    const tabs = ['profil', 'pembinaan', 'presensi', 'perilaku', 'spp', 'bk'];
    tabs.forEach(k => {
        const btn = document.querySelector(`[data-modal-tab="${k}"]`);
        const content = document.getElementById(`modal-tab-content-${k}`);
        if (btn && content) {
            if (k === tabKey) {
                btn.classList.add('active', 'border-indigo-600', 'text-indigo-600', 'dark:text-indigo-400');
                btn.classList.remove('border-transparent', 'text-slate-600', 'dark:text-slate-400');
                content.classList.remove('hidden');
            } else {
                btn.classList.remove('active', 'border-indigo-600', 'text-indigo-600', 'dark:text-indigo-400');
                btn.classList.add('border-transparent', 'text-slate-600', 'dark:text-slate-400');
                content.classList.add('hidden');
            }
        }
    });

    if (!activeStudentForDetail) return;
    const nis = activeStudentForDetail.nis;

    if (tabKey === 'pembinaan') await loadModalDetailPembinaan(nis);
    else if (tabKey === 'presensi') await loadModalDetailPresensi(nis);
    else if (tabKey === 'perilaku') await loadModalDetailPerilaku(nis);
    else if (tabKey === 'spp') await loadModalDetailSPP(nis);
    else if (tabKey === 'bk') await loadModalDetailBK(nis);
};

/**
 * Load Sub-tab: Pembinaan Guru Wali & Wali Kelas
 */
async function loadModalDetailPembinaan(nis) {
    const container = document.getElementById('m-pembinaan-list');
    if (!container) return;

    container.innerHTML = '<p class="text-slate-400 text-center py-4"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Memuat catatan pembinaan...</p>';

    try {
        let notes = classNotesList.filter(n => (n.studentNis === nis || n.nis === nis || n.student_nis === nis));
        
        if (notes.length === 0 && cfClient && cfClient.enabled) {
            try {
                const rawNotes = await cfClient.getGuruWaliNotes({ student_nis: nis });
                if (Array.isArray(rawNotes)) {
                    rawNotes.forEach(d => {
                        notes.push({
                            id: d.id,
                            category: d.category || 'Umum',
                            date: d.date || getLocalISODate(),
                            title: d.title || 'Catatan Pembinaan',
                            content: d.notes || d.content || '',
                            authorName: d.guru_name || 'Guru Wali'
                        });
                    });
                }
            } catch (eD1) {
                console.warn('[WaliKelas] Load modal detail pembinaan from D1 warning:', eD1);
            }
        }

        if (notes.length === 0) {
            container.innerHTML = '<p class="text-slate-400 text-center py-6">Belum ada catatan pembinaan untuk siswa ini.</p>';
            return;
        }

        notes.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

        container.innerHTML = notes.map(n => `
            <div class="bg-slate-50 dark:bg-slate-700/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1">
                <div class="flex justify-between items-center">
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 uppercase">${escapeHTML(n.category || 'Umum')}</span>
                    <span class="text-[10px] text-slate-400">${formatDateIndo(n.date || getLocalISODate())}</span>
                </div>
                <h5 class="font-bold text-slate-800 dark:text-slate-100 text-xs">${escapeHTML(n.title)}</h5>
                <p class="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">${escapeHTML(n.content)}</p>
                <p class="text-[10px] text-slate-400 pt-1">Oleh: ${escapeHTML(n.authorName || n.guru_name || 'Wali Kelas')}</p>
            </div>
        `).join('');
    } catch (e) {
        console.error('[WaliKelas] Error loading detail pembinaan:', e);
        container.innerHTML = '<p class="text-rose-500 text-center py-4">Gagal memuat catatan pembinaan.</p>';
    }
}

/**
 * Load Sub-tab: Presensi & Permisi
 */
async function loadModalDetailPresensi(nis) {
    const container = document.getElementById('m-presensi-list');
    const summaryBox = document.getElementById('m-presensi-summary-box');
    if (!container) return;

    container.innerHTML = '<p class="text-slate-400 text-center py-4"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Memuat riwayat presensi...</p>';

    try {
        const student = activeStudentForDetail || currentClassStudents.find(s => String(s.nis) === String(nis));
        const studentClass = student ? student.class : currentRombelClass;
        const targetNisStr = String(nis).trim();

        let hadir = 0, sakit = 0, izin = 0, alpa = 0, dispen = 0;
        const attList = [];

        try {
            const { rows: attRows, stats } = await window.fetchStudentAttendanceRange(targetNisStr, null, null);
            if (stats) {
                hadir = stats.H || 0;
                sakit = stats.S || 0;
                izin = stats.I || 0;
                alpa = stats.A || 0;
                dispen = stats.D || 0;
            }
            if (Array.isArray(attRows)) {
                attRows.forEach(r => {
                    let statusLabel = 'Hadir';
                    if (r.status === 'S') statusLabel = 'Sakit';
                    else if (r.status === 'I') statusLabel = 'Izin';
                    else if (r.status === 'A') statusLabel = 'Alpa';
                    else if (r.status === 'D') statusLabel = 'Dispensasi';

                    if (r.status !== 'H') {
                        attList.push({
                            type: 'presensi',
                            date: r.date || '',
                            status: statusLabel,
                            notes: r.note || ''
                        });
                    }
                });
            }
        } catch (eSbAtt) {
            console.warn('[WaliKelas] Supabase student att fetch warning:', eSbAtt);
        }

        // Load Permisi dari Cloudflare D1
        if (cfClient && cfClient.enabled) {
            try {
                const rawPerm = await cfClient.getPermisiRequests({ student_nis: targetNisStr });
                if (Array.isArray(rawPerm)) {
                    rawPerm.forEach(d => {
                        attList.push({
                            type: 'permisi',
                            date: d.date || '',
                            status: `Permisi (${d.reason || d.permission_type || 'Izin Keluar'})`,
                            notes: (d.status || 'approved').toUpperCase()
                        });
                    });
                }
            } catch (errPerm) {
                console.warn(`[WaliKelas] Query permisi from D1 in modal for ${targetNisStr} error:`, errPerm.message);
            }
        }

        attList.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

        if (summaryBox) {
            summaryBox.innerHTML = `
                <div class="bg-emerald-50 dark:bg-emerald-900/30 p-2 rounded-lg border border-emerald-200 text-emerald-700 dark:text-emerald-300 font-bold">Hadir: ${hadir}</div>
                <div class="bg-blue-50 dark:bg-blue-900/30 p-2 rounded-lg border border-blue-200 text-blue-700 dark:text-blue-300 font-bold">Sakit: ${sakit}</div>
                <div class="bg-amber-50 dark:bg-amber-900/30 p-2 rounded-lg border border-amber-200 text-amber-700 dark:text-amber-300 font-bold">Izin: ${izin}</div>
                <div class="bg-rose-50 dark:bg-rose-900/30 p-2 rounded-lg border border-rose-200 text-rose-700 dark:text-rose-300 font-bold">Alpa: ${alpa}</div>
            `;
        }

        if (attList.length === 0) {
            container.innerHTML = '<p class="text-slate-400 text-center py-6">Tidak ada catatan ketidakhadiran / permisi.</p>';
            return;
        }

        container.innerHTML = attList.map(item => `
            <div class="bg-slate-50 dark:bg-slate-700/50 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 flex justify-between items-center">
                <div>
                    <span class="font-bold text-slate-800 dark:text-slate-100 text-xs">${escapeHTML(item.status)}</span>
                    ${item.notes ? `<p class="text-[10px] text-slate-500">${escapeHTML(item.notes)}</p>` : ''}
                </div>
                <span class="text-[10px] font-mono font-bold text-slate-400">${formatDateIndo(item.date)}</span>
            </div>
        `).join('');

    } catch (e) {
        console.error('[WaliKelas] Error loading detail presensi:', e);
        container.innerHTML = '<p class="text-rose-500 text-center py-4">Gagal memuat presensi.</p>';
    }
}

/**
 * Load Sub-tab: Perilaku & EWS (Pelanggaran/Prestasi Records)
 */
async function loadModalDetailPerilaku(nis) {
    const container = document.getElementById('m-records-list');
    const ewsBox = document.getElementById('m-ews-breakdown');
    if (!container) return;

    // Render EWS Box
    const student = activeStudentForDetail;
    const agg = currentClassAggregates[nis] || {};
    const permisi = currentPermissionCounts[nis] || 0;
    const ewsRes = SimasEWS.calculateStudentRisk(student, agg, permisi, ewsWeights);

    if (ewsBox) {
        ewsBox.innerHTML = `
            <div class="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                <div class="flex justify-between items-center">
                    <span class="font-bold text-slate-700 dark:text-slate-200">Status Kedisiplinan EWS:</span>
                    <span class="px-3 py-1 rounded-full font-bold text-xs ${ewsRes.colorClass}">${ewsRes.label}</span>
                </div>
                <p class="text-slate-600 dark:text-slate-300">Skor Total EWS: <strong class="text-slate-900 dark:text-white text-base">${ewsRes.totalScore}</strong></p>
                <div class="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200 dark:border-slate-600 text-center">
                    <div class="bg-white dark:bg-slate-800 p-2 rounded-lg">
                        <p class="text-[10px] text-slate-400">Absensi</p>
                        <p class="font-bold text-rose-600">Alpa: ${ewsRes.details.alpa} | Izin: ${ewsRes.details.izin}</p>
                    </div>
                    <div class="bg-white dark:bg-slate-800 p-2 rounded-lg">
                        <p class="text-[10px] text-slate-400">Poin BK</p>
                        <p class="font-bold text-amber-600">${ewsRes.details.points} Poin</p>
                    </div>
                    <div class="bg-white dark:bg-slate-800 p-2 rounded-lg">
                        <p class="text-[10px] text-slate-400">Permisi</p>
                        <p class="font-bold text-purple-600">${ewsRes.details.permisi}x</p>
                    </div>
                </div>
            </div>
        `;
    }

    container.innerHTML = '<p class="text-slate-400 text-center py-4"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Memuat data kedisiplinan...</p>';

    try {
        const records = await ensureStudentRecords(nis, { forceLive: true });

        if (records.length === 0) {
            container.innerHTML = '<p class="text-slate-400 text-center py-6">Belum ada catatan pelanggaran / prestasi tersimpan.</p>';
            return;
        }

        records.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

        container.innerHTML = records.map(r => `
            <div class="bg-slate-50 dark:bg-slate-700/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700 flex justify-between items-start">
                <div>
                    <div class="flex items-center gap-2 mb-1">
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${r.type === 'prestasi' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}">${escapeHTML(r.type || 'pelanggaran')}</span>
                        <span class="font-bold text-slate-800 dark:text-slate-100">${escapeHTML(r.title || r.violationName || 'Catatan Perilaku')}</span>
                    </div>
                    <p class="text-slate-600 dark:text-slate-300 text-[11px]">${escapeHTML(r.desc || r.description || r.keterangan || '')}</p>
                    <p class="text-[10px] text-slate-400 mt-1">Dilaporkan oleh: ${escapeHTML(r.author || r.reporterName || r.createdBy || '-')}</p>
                </div>
                <div class="text-right shrink-0">
                    <span class="font-black text-xs ${r.points > 0 ? 'text-amber-600' : 'text-emerald-600'}">+${r.points || 0} Poin</span>
                    <p class="text-[10px] text-slate-400 mt-1 font-mono">${formatDateIndo(r.date)}</p>
                </div>
            </div>
        `).join('');
    } catch (e) {
        console.error('[WaliKelas] Error loading detail perilaku:', e);
        container.innerHTML = '<p class="text-rose-500 text-center py-4">Gagal memuat kedisiplinan.</p>';
    }
}

function renderModalDetailSppGrid() {
    const container = document.getElementById('m-spp-grid-container');
    if (!container || !detailStudentCohort) return;

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const academicMonths = [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6];
    const today = new Date();

    let gridHtml = '';
    for (let i = 0; i < 12; i++) {
        const monthNum = academicMonths[i];
        const year = monthNum >= 7 ? detailSppYear : detailSppYear + 1;

        const monthLabel = monthNames[monthNum - 1];
        const monthKey = `${year}-${monthNum}`;

        const maxY = detailStudentCohort.endYear + 1;
        let isLocked = false;
        if (year < detailStudentCohort.startYear || (year === detailStudentCohort.startYear && monthNum < 7)) isLocked = true;
        if (year > maxY || (year === maxY && monthNum > 6)) isLocked = true;

        const isPaid = isMonthPaid(detailPaymentHistory, year, monthNum, detailSppDueDate);
        const paymentData = detailPaymentHistory[monthKey];

        const itemDate = new Date(year, monthNum - 1, detailSppDueDate);
        const isPastDue = itemDate < today && !isPaid;

        let cardClass = 'bg-slate-100 dark:bg-slate-700/30 border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500';
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
                    pDate = typeof paymentData.paymentDate.toDate === 'function' ? paymentData.paymentDate.toDate() : new Date(paymentData.paymentDate);
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
        <div class="flex justify-between items-center mb-2 bg-slate-50 dark:bg-slate-700/30 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 gap-2">
            <span class="text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                <i class="fa-solid fa-file-invoice-dollar text-indigo-500"></i>
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

    document.getElementById('detail-spp-display-year').innerText = `${detailSppYear}/${detailSppYear + 1}`;

    const btnPrev = document.getElementById('detail-spp-btn-prev');
    const btnNext = document.getElementById('detail-spp-btn-next');
    if (btnPrev && btnNext) {
        const maxYear = detailStudentCohort.endYear;
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
    if (newYear < detailStudentCohort.startYear || newYear > detailStudentCohort.endYear) return;
    detailSppYear = newYear;
    renderModalDetailSppGrid();
};

/**
 * Load Sub-tab: SPP & Keuangan
 */
async function loadModalDetailSPP(nis) {
    const summaryBox = document.getElementById('m-spp-summary-box');
    const gridContainer = document.getElementById('m-spp-grid-container');
    const historyList = document.getElementById('m-spp-history-list');
    if (!historyList) return;

    if (gridContainer) {
        gridContainer.innerHTML = '<p class="text-slate-400 text-center py-4"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Memuat status grid SPP...</p>';
    }
    historyList.innerHTML = '<p class="text-slate-400 text-center py-4"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Memuat data transaksi SPP...</p>';

    try {
        const student = activeStudentForDetail || currentClassStudents.find(s => s.nis === nis);
        if (student) {
            detailStudentCohort = calculateCohort(student.class || currentRombelClass);
        } else {
            detailStudentCohort = calculateCohort(currentRombelClass);
        }

        const now = new Date();
        const curMonth = now.getMonth();
        const curYear = now.getFullYear();
        const activeAcademicYear = curMonth >= 6 ? curYear : curYear - 1;

        detailSppYear = activeAcademicYear;
        if (detailSppYear < detailStudentCohort.startYear) detailSppYear = detailStudentCohort.startYear;
        if (detailSppYear > detailStudentCohort.endYear) detailSppYear = detailStudentCohort.endYear;

        detailSppDueDate = await getSppDueDate();

        const nisStr = String(nis).trim();
        const normNis = normalizeNIS(nisStr);
        const targetNisList = Array.from(new Set([nisStr, normNis, nisStr.padStart(4, '0')].filter(Boolean)));
        detailPaymentHistory = {};
        let totalPaid = 0;
        const paidMonths = [];

        initSupabase();
        if (!supabase) throw new Error('Supabase client belum siap');

        const { data, error } = await supabase
            .from('finance_transactions')
            .select('id, transaction_id, year, month, amount, type, notes, payment_date, date_str, payment_method, teller_name')
            .in('student_nis', targetNisList);

        if (error) {
            console.error('[WaliKelas] Error openDetailSppModal Supabase:', error);
            throw error;
        }

        const monthNamesIndo = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

        if (data) {
            data.forEach(d => {
                totalPaid += (Number(d.amount) || 0);
                if (d.month && d.type !== 'manual_debt') {
                    const mName = (typeof d.month === 'number' && monthNamesIndo[d.month]) ? monthNamesIndo[d.month] : d.month;
                    const label = `${mName} ${d.year || ''}`.trim();
                    if (!paidMonths.includes(label)) {
                        paidMonths.push(label);
                    }
                }

                if (d.year && d.month) {
                    const key = `${d.year}-${d.month}`;
                    detailPaymentHistory[key] = {
                        id: d.id,
                        transactionId: d.transaction_id || d.id,
                        amount: Number(d.amount) || 0,
                        type: d.type || 'paid',
                        note: d.notes || '',
                        paymentDate: d.payment_date ? new Date(d.payment_date) : null,
                        dateStr: d.date_str || '',
                        paymentMethod: d.payment_method || 'Tunai',
                        tellerName: d.teller_name || ''
                    };
                }
            });
        }

        // Render Grid Status SPP Bulanan
        renderModalDetailSppGrid();

        if (summaryBox) {
            summaryBox.innerHTML = `
                <div class="flex justify-between items-center">
                    <div>
                        <p class="text-[10px] font-bold text-slate-400 uppercase">Total Terbayar</p>
                        <p class="text-base font-black text-emerald-600 dark:text-emerald-400">Rp ${totalPaid.toLocaleString('id-ID')}</p>
                    </div>
                    <div class="text-right">
                        <p class="text-[10px] font-bold text-slate-400 uppercase">Bulan Terbayar (${paidMonths.length})</p>
                        <p class="text-xs font-bold text-slate-700 dark:text-slate-200">${paidMonths.length > 0 ? paidMonths.join(', ') : 'Belum Ada'}</p>
                    </div>
                </div>
            `;
        }

        const txs = (data || []).filter(d => d.type !== 'manual_debt');
        if (txs.length === 0) {
            historyList.innerHTML = '<p class="text-slate-400 text-center py-6">Belum ada riwayat transaksi SPP tersimpan.</p>';
            return;
        }

        txs.sort((a, b) => {
            const dateA = a.payment_date || a.date_str || '';
            const dateB = b.payment_date || b.date_str || '';
            return dateB.localeCompare(dateA);
        });

        historyList.innerHTML = txs.map(t => {
            let dateDisplay = '-';
            if (t.payment_date) {
                const pDate = new Date(t.payment_date);
                if (!isNaN(pDate.getTime())) {
                    const yyyy = pDate.getFullYear();
                    const mm = String(pDate.getMonth() + 1).padStart(2, '0');
                    const dd = String(pDate.getDate()).padStart(2, '0');
                    dateDisplay = formatDateIndo(`${yyyy}-${mm}-${dd}`);
                }
            } else if (t.date_str) {
                dateDisplay = formatDateIndo(t.date_str);
            }
            const receipt = t.transaction_id || t.id || '-';
            const monthName = (typeof t.month === 'number' && monthNamesIndo[t.month]) ? monthNamesIndo[t.month] : (t.month || '-');
            return `
            <div class="bg-slate-50 dark:bg-slate-700/50 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 flex justify-between items-center">
                <div>
                    <span class="font-bold text-slate-800 dark:text-slate-100">SPP Bulan ${escapeHTML(String(monthName))} ${escapeHTML(String(t.year || ''))}</span>
                    <p class="text-[10px] text-slate-400 font-mono">Kwitansi: ${escapeHTML(String(receipt))}</p>
                </div>
                <div class="text-right">
                    <span class="font-bold text-emerald-600 dark:text-emerald-400 text-xs">Rp ${(Number(t.amount) || 0).toLocaleString('id-ID')}</span>
                    <p class="text-[10px] text-slate-400 font-mono">${dateDisplay}</p>
                </div>
            </div>
            `;
        }).join('');
    } catch (e) {
        console.error('[WaliKelas] Error loading detail SPP:', e);
        historyList.innerHTML = '<p class="text-rose-500 text-center py-4">Gagal memuat data SPP.</p>';
    }
}

/**
 * Load Sub-tab: Catatan & Tindakan BK
 */
async function loadModalDetailBK(nis) {
    const container = document.getElementById('m-bk-list');
    if (!container) return;

    container.innerHTML = '<p class="text-slate-400 text-center py-4"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Memuat catatan Guru BK...</p>';

    try {
        const snap = await cfClient.getBkActions({ nis: String(nis), limit: 20 });
        const actions = snap || [];

        if (actions.length === 0) {
            container.innerHTML = '<p class="text-slate-400 text-center py-6">Belum ada catatan konseling / tindakan dari Guru BK.</p>';
            return;
        }

        actions.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

        container.innerHTML = actions.map(a => `
            <div class="bg-slate-50 dark:bg-slate-700/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1">
                <div class="flex justify-between items-center">
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 uppercase">${escapeHTML(a.actionType || 'Konseling BK')}</span>
                    <span class="text-[10px] text-slate-400 font-mono">${formatDateIndo(a.date)}</span>
                </div>
                <h5 class="font-bold text-slate-800 dark:text-slate-100 text-xs">${escapeHTML(a.title || a.notes || 'Bimbingan Konseling')}</h5>
                <p class="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">${escapeHTML(a.description || a.result || a.notes || '')}</p>
                <p class="text-[10px] text-slate-400 pt-1">Konselor: ${escapeHTML(a.counselorName || a.createdBy || 'Guru BK')}</p>
            </div>
        `).join('');
    } catch (e) {
        console.error('[WaliKelas] Error loading detail BK:', e);
        container.innerHTML = '<p class="text-rose-500 text-center py-4">Gagal memuat catatan BK.</p>';
    }
}

/**
 * Open Modal Generator WhatsApp
 */
window.openModalWaGenerator = function (nis, defaultTemplate = 'ews_warning', targetRecipient = 'parent') {
    const student = currentClassStudents.find(s => String(s.nis) === String(nis) || String(s.id) === String(nis) || s.nis == nis);
    if (!student) {
        showToast('Info', 'Data siswa tidak ditemukan', 'info');
        return;
    }

    activeStudentForWa = student;
    activeWaRecipientTarget = targetRecipient;

    let targetPhone = '';
    let cleanPhone = '';
    if (targetRecipient === 'student') {
        targetPhone = student.phone_siswa || student.phone || student.hpSiswa || '';
        cleanPhone = targetPhone.replace(/[^0-9]/g, '');
        if (cleanPhone.startsWith('0')) {
            cleanPhone = '62' + cleanPhone.slice(1);
        } else if (cleanPhone.startsWith('8')) {
            cleanPhone = '628' + cleanPhone.slice(1);
        }
    } else {
        const pInfo = resolveStudentParent(student);
        targetPhone = pInfo.phone !== '-' ? pInfo.phone : '';
        cleanPhone = pInfo.cleanPhone;
    }

    const titleEl = document.getElementById('modal-wa-title');
    if (titleEl) {
        titleEl.textContent = targetRecipient === 'student' 
            ? 'Generator Pesan WA ke Siswa' 
            : 'Generator Pesan WA ke Orang Tua';
    }

    const phoneInputEl = document.getElementById('wa-phone-target');
    const noticeEl = document.getElementById('wa-no-phone-notice');

    if (!cleanPhone) {
        if (phoneInputEl) {
            phoneInputEl.value = '(Nomor WA belum terdata - pilih kontak saat WA terbuka)';
        }
        if (noticeEl) {
            noticeEl.classList.remove('hidden');
            noticeEl.innerHTML = `
                <div class="flex items-center gap-2">
                    <i class="fa-solid fa-circle-info text-amber-600 text-lg"></i>
                    <div>
                        <div class="font-bold text-amber-900 dark:text-amber-200">Nomor WA ${targetRecipient === 'student' ? 'Siswa' : 'Orang Tua'} belum terdata.</div>
                        <div class="text-[11px] text-amber-700 dark:text-amber-300">Pilih kontak saat WA terbuka atau perbarui data siswa.</div>
                    </div>
                </div>
                <button onclick="window.closeModal('modal-wa-generator'); window.openModalEditDataSiswa('${escapeHTML(student.nis)}')" class="px-2.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-[11px] rounded-lg shadow transition whitespace-nowrap active:scale-95 flex items-center gap-1.5">
                    <i class="fa-solid fa-pen-to-square"></i> Edit Data Siswa
                </button>
            `;
        }
        showToast('Info', `Nomor WA ${targetRecipient === 'student' ? 'Siswa' : 'Orang Tua'} belum tersedia. Kontak dapat dipilih saat WA terbuka atau silakan update data siswa.`, 'info');
    } else {
        if (phoneInputEl) {
            phoneInputEl.value = cleanPhone;
        }
        if (noticeEl) {
            noticeEl.classList.add('hidden');
            noticeEl.innerHTML = '';
        }
    }

    document.getElementById('wa-template-select').value = defaultTemplate;

    updateWaPreviewMessage();
    window.openModal('modal-wa-generator');
};

/**
 * Update WhatsApp Message Preview Text
 */
function updateWaPreviewMessage() {
    if (!activeStudentForWa) return;

    const student = activeStudentForWa;
    const templateType = document.getElementById('wa-template-select')?.value || 'ews_warning';
    const recipient = activeWaRecipientTarget || 'parent';
    const pInfo = resolveStudentParent(student);
    const parentName = pInfo.name !== '-' ? pInfo.name : 'Bapak/Ibu Orang Tua/Wali Siswa';

    const agg = currentClassAggregates[student.nis] || {};
    const permisi = currentPermissionCounts[student.nis] || 0;
    const ewsRes = SimasEWS.calculateStudentRisk(student, agg, permisi, ewsWeights);

    let message = '';

    if (recipient === 'student') {
        const studentName = student.name || 'Siswa';
        const studentClass = student.class ? ` (${student.class})` : '';

        if (templateType === 'spp_reminder') {
            const studentNisKey = String(student.nis || student.id || '').trim();
            const normKey = normalizeNIS(studentNisKey);
            const sppData = sppStatusMap[normKey] || sppStatusMap[studentNisKey] || sppStatusMap[student.nis] || { paymentHistory: {} };
            const ratesConfig = financeRatesCache || { X: 70000, XI: 65000, XII: 65000 };
            const sppDueDate = (cachedSystemConfig && cachedSystemConfig.dueDate) || detailSppDueDate || 20;
            const { unpaidCount, totalNominal, unpaidMonths } = calculateStudentTunggakan(student, sppData.paymentHistory, ratesConfig, sppDueDate);

            if (unpaidCount > 0) {
                const monthsText = unpaidMonths.join(', ');
                message = `INFORMASI SPP\n\nHalo *${studentName}*${studentClass},\n\nMengingatkan administrasi SPP yang belum terselesaikan:\n- Bulan: *${monthsText}* (${unpaidCount} bulan)\n- Total Tunggakan: *Rp ${totalNominal.toLocaleString('id-ID')}*\n\nSegera diselesaikan ya. Jika ada kendala, bisa sampaikan langsung. Terima kasih.\n\n>SIMAS-CERDAS`;
            } else {
                message = `INFORMASI SPP\n\nHalo *${studentName}*${studentClass},\n\nAdministrasi SPP kamu saat ini terdata *LUNAS* (Rp 0).\n\nTerima kasih atas kelancaran pembayarannya. Semangat belajarnya!\n\n>SIMAS-CERDAS`;
            }
        } else if (templateType === 'ews_warning') {
            message = `PEMBERITAHUAN KEDISIPLINAN - SIMAS SMANTARA\n\nHalo *${studentName}*${studentClass},\n\nBerikut catatan presensi & kedisiplinan kamu di sekolah:\n- Alpa: ${ewsRes.details.alpa}x, Izin: ${ewsRes.details.izin}x\n- Poin BK: ${ewsRes.details.points} Poin\n- Status EWS: *${ewsRes.label}*\n\nMohon tingkatkan kedisiplinan dan kehadiran kamu di sekolah. Terima kasih.`;
        } else if (templateType === 'attendance_absence') {
            message = `PEMBERITAHUAN PRESENSI - SIMAS SMANTARA\n\nHalo *${studentName}*${studentClass},\n\nKamu terdata *TIDAK HADIR / ALPA* pada presensi kelas hari ini.\n\nMohon segera konfirmasikan alasan ketidakhadiran kamu. Terima kasih.`;
        } else if (templateType === 'parent_invitation') {
            message = `PEMANGGILAN ORANG TUA - ${SCHOOL_CONFIG.appName} ${SCHOOL_CONFIG.schoolShortName}\n\nHalo *${studentName}*${studentClass},\n\nTolong sampaikan ke Orang Tua / Wali kamu untuk hadir ke sekolah berkonsultasi mengenai perkembangan belajar kamu:\n- Agenda: Konsultasi Perkembangan Belajar & Kedisiplinan\n- Tempat: Ruang Wali Kelas / BK ${SCHOOL_CONFIG.schoolName}\n\nTerima kasih.`;
        } else if (templateType === 'appreciation') {
            message = `APRESIASI SISWA - SIMAS SMANTARA\n\nHalo *${studentName}*${studentClass},\n\nApresiasi untuk perkembangan belajar dan kedisiplinan kamu yang sangat baik di sekolah.\n\nPertahankan terus semangat belajar kamu. Terima kasih.`;
        }
    } else {
        if (templateType === 'ews_warning') {
            message = `Yth. ${parentName},\nOrang tua/wali dari ananda *${student.name}* (Kelas ${student.class}).\n\nInformasi dari Wali Kelas ${SCHOOL_CONFIG.appName} ${SCHOOL_CONFIG.schoolShortName} (${SCHOOL_CONFIG.schoolName}):\nMenyampaikan bahwa ananda saat ini memerlukan bimbingan & perhatian khusus terkait kedisiplinan sekolah.\n\n*Ringkasan Catatan:*\n- Ketidakhadiran: Alpa ${ewsRes.details.alpa}x, Izin ${ewsRes.details.izin}x\n- Kredit Poin BK: ${ewsRes.details.points} Poin\n- Status Risiko EWS: *${ewsRes.label}*\n\nMohon kerjasamanya untuk membimbing ananda di rumah agar proses pembelajaran berjalan optimal. Terima kasih.`;
        } else if (templateType === 'attendance_absence') {
            message = `Yth. ${parentName},\nOrang tua/wali dari ananda *${student.name}* (Kelas ${student.class}).\n\nInformasi dari Wali Kelas SIMAS SMANTARA:\nMemberitahukan bahwa ananda hari ini terdata *TIDAK HADIR / ALPA* dalam presensi kelas.\n\nMohon konfirmasi sebab ketidakhadiran ananda. Terima kasih.`;
        } else if (templateType === 'parent_invitation') {
            message = `Yth. ${parentName},\nOrang tua/wali dari ananda *${student.name}* (Kelas ${student.class}).\n\nMengharapkan kehadiran Bapak/Ibu ke sekolah untuk berkonsultasi mengenai perkembangan belajar & kedisiplinan ananda bersama Wali Kelas dan Guru BK.\n\n*Waktu:* (Silakan tentukan jadwal)\n*Tempat:* Ruang Wali Kelas / BK ${SCHOOL_CONFIG.schoolName}.\n\nAtas perhatian dan kerjasamanya kami ucapkan terima kasih.`;
        } else if (templateType === 'spp_reminder') {
            const studentNisKey = String(student.nis || student.id || '').trim();
            const normKey = normalizeNIS(studentNisKey);
            const sppData = sppStatusMap[normKey] || sppStatusMap[studentNisKey] || sppStatusMap[student.nis] || { paymentHistory: {} };
            const ratesConfig = financeRatesCache || { X: 70000, XI: 65000, XII: 65000 };
            const sppDueDate = (cachedSystemConfig && cachedSystemConfig.dueDate) || detailSppDueDate || 20;
            const { unpaidCount, totalNominal, unpaidMonths } = calculateStudentTunggakan(student, sppData.paymentHistory, ratesConfig, sppDueDate);

            if (unpaidCount > 0) {
                const monthsText = unpaidMonths.join(', ');
                message = `PENGINGAT SPP - SIMAS SMANTARA\n\nYth. ${parentName},\nOrang tua/wali dari ananda *${student.name}* (Kelas ${student.class}).\n\nMenginformasikan administrasi SPP ananda yang belum terselesaikan:\n- Bulan: *${monthsText}* (${unpaidCount} bulan)\n- Total Tunggakan: *Rp ${totalNominal.toLocaleString('id-ID')}*\n\nMohon untuk menyelesaikan pembayaran SPP ananda di loket keuangan sekolah. Jika ada kendala, silakan berkoordinasi dengan pihak sekolah. Terima kasih atas pengertian dan kerjasamanya.\n\n>SIMAS-CERDAS`;
            } else {
                message = `PENGINGAT SPP - SIMAS SMANTARA\n\nYth. ${parentName},\nOrang tua/wali dari ananda *${student.name}* (Kelas ${student.class}).\n\nAdministrasi SPP ananda saat ini terdata *LUNAS* (Rp 0).\n\nTerima kasih banyak atas kelancaran dan ketepatan pembayaran SPP ananda.\n\n>SIMAS-CERDAS`;
            }
        } else if (templateType === 'appreciation') {
            message = `Yth. ${parentName},\nOrang tua/wali dari ananda *${student.name}* (Kelas ${student.class}).\n\nApresiasi tinggi dari Wali Kelas SIMAS SMANTARA:\nAnanda menunjukkan perkembangan belajar dan kedisiplinan yang sangat baik di sekolah. Semoga prestasi dan semangat ini dapat terus dipertahankan.\n\nTerima kasih atas bimbingan luar biasa dari Bapak/Ibu di rumah!`;
        }
    }

    document.getElementById('wa-message-preview').value = replaceSchoolIdentityText(message);
}

/**
 * Send WhatsApp Message Link
 */
window.sendWhatsAppMessage = function () {
    let phone = document.getElementById('wa-phone-target')?.value || '';
    const text = document.getElementById('wa-message-preview')?.value || '';

    if (!text) {
        showToast('Peringatan', 'Isi pesan tidak boleh kosong', 'warning');
        return;
    }

    if (phone.includes('Nomor WA') || phone.includes('belum terdata') || phone.includes('tidak tersedia')) {
        phone = '';
    } else {
        phone = phone.replace(/[^0-9]/g, '');
    }

    const encodedText = encodeURIComponent(text);
    const waUrl = phone 
        ? `https://wa.me/${phone}?text=${encodedText}` 
        : `https://api.whatsapp.com/send?text=${encodedText}`;

    window.open(waUrl, '_blank');
    window.closeModal('modal-wa-generator');
};

let currentWaliSppRecapFilter = 'all';

/**
 * Open Modal Rekap WhatsApp SPP Rombel
 */
window.openWaliSppRecapModal = function () {
    if (!currentClassStudents || currentClassStudents.length === 0) {
        showToast('Info', 'Data siswa rombel belum dimuat.', 'info');
        return;
    }

    currentWaliSppRecapFilter = 'all';
    
    // Update Rombel & Periode Info
    const elClass = document.getElementById('spp-recap-wa-class-name');
    if (elClass) elClass.textContent = currentRombelClass ? `Kelas ${currentRombelClass}` : '-';

    const now = new Date();
    const monthNamesIndo = [
        '', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    const elPeriod = document.getElementById('spp-recap-wa-period-name');
    if (elPeriod) elPeriod.textContent = `${monthNamesIndo[now.getMonth() + 1]} ${now.getFullYear()}`;

    // Update button states
    updateWaliSppRecapFilterButtons('all');

    // Generate draft text
    window.generateWaliSppRecapText('all');

    window.openModal('modal-spp-recap-wa');
};

/**
 * Update active styles of filter buttons
 */
function updateWaliSppRecapFilterButtons(mode) {
    const btnAll = document.getElementById('btn-recap-mode-all');
    const btnUnpaid = document.getElementById('btn-recap-mode-unpaid');
    const btnPaid = document.getElementById('btn-recap-mode-paid');

    const activeClass = 'py-2 px-2 rounded-xl border text-center font-bold text-[11px] transition bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700 shadow-2xs';
    const inactiveClass = 'py-2 px-2 rounded-xl border text-center font-bold text-[11px] transition bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700';

    if (btnAll) btnAll.className = (mode === 'all') ? activeClass : inactiveClass;
    if (btnUnpaid) btnUnpaid.className = (mode === 'unpaid') ? activeClass : inactiveClass;
    if (btnPaid) btnPaid.className = (mode === 'paid') ? activeClass : inactiveClass;
}

/**
 * Handle filter change
 */
window.onWaliSppRecapFilterChange = function (mode) {
    currentWaliSppRecapFilter = mode;
    updateWaliSppRecapFilterButtons(mode);
    window.generateWaliSppRecapText(mode);
};

/**
 * Generate formatted WhatsApp message for SPP recap
 */
window.generateWaliSppRecapText = function (filterMode = 'all') {
    if (!currentClassStudents || currentClassStudents.length === 0) return;

    const ratesConfig = financeRatesCache || { X: 70000, XI: 65000, XII: 65000 };
    const sppDueDate = (cachedSystemConfig && cachedSystemConfig.dueDate) || detailSppDueDate || 20;
    const now = new Date();
    const monthNamesIndo = [
        '', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    const dateFormatted = `${String(now.getDate()).padStart(2, '0')} ${monthNamesIndo[now.getMonth() + 1]} ${now.getFullYear()}`;
    const periodName = `${monthNamesIndo[now.getMonth() + 1]} ${now.getFullYear()}`;
    const waliName = currentUserProfile?.name || 'Wali Kelas';

    let totalStudents = currentClassStudents.length;
    let paidStudents = [];
    let unpaidStudents = [];
    let totalNominalTunggakan = 0;

    currentClassStudents.forEach((student, index) => {
        const rawNis = String(student.nis || student.id || '').trim();
        const normNis = normalizeNIS(rawNis);
        const sppData = sppStatusMap[normNis] || sppStatusMap[rawNis] || sppStatusMap[student.nis] || { paymentHistory: {} };
        const { unpaidCount, totalNominal, unpaidMonths } = calculateStudentTunggakan(student, sppData.paymentHistory, ratesConfig, sppDueDate);

        if (unpaidCount > 0) {
            unpaidStudents.push({
                no: index + 1,
                name: student.name || 'Siswa',
                nis: rawNis || '-',
                unpaidCount,
                totalNominal,
                unpaidMonths
            });
            totalNominalTunggakan += totalNominal;
        } else {
            paidStudents.push({
                no: index + 1,
                name: student.name || 'Siswa',
                nis: rawNis || '-'
            });
        }
    });

    let msg = `*REKAPITULASI ADMINISTRASI SPP - SIMAS SMANTARA*\n`;
    msg += `🏫 *Kelas:* ${currentRombelClass || '-'}\n`;
    msg += `📅 *Periode:* ${periodName}\n`;
    msg += `🕒 *Per Tanggal:* ${dateFormatted}\n`;
    msg += `👤 *Wali Kelas:* ${waliName}\n\n`;

    msg += `📊 *Ringkasan Status Rombel:*\n`;
    msg += `• Total Siswa: *${totalStudents} Siswa*\n`;
    msg += `• Sudah Lunas: *${paidStudents.length} Siswa*\n`;
    msg += `• Belum Lunas: *${unpaidStudents.length} Siswa*\n`;
    msg += `• Total Tunggakan Rombel: *Rp ${totalNominalTunggakan.toLocaleString('id-ID')}*\n\n`;

    if (filterMode === 'all' || filterMode === 'unpaid') {
        msg += `❌ *DAFTAR SISWA BELUM LUNAS / MENUNGGAK (${unpaidStudents.length} Siswa):*\n`;
        if (unpaidStudents.length === 0) {
            msg += `_Alhamdulillah, seluruh siswa kelas ${currentRombelClass || ''} sudah LUNAS._\n\n`;
        } else {
            unpaidStudents.forEach((s, idx) => {
                const monthsStr = s.unpaidMonths.length > 0 ? s.unpaidMonths.join(', ') : 'Bulan Berjalan';
                msg += `${idx + 1}. *${s.name}* (NIS: ${s.nis})\n`;
                msg += `   └ Total: *Rp ${s.totalNominal.toLocaleString('id-ID')}* (${s.unpaidCount}x Tunggakan: ${monthsStr})\n`;
            });
            msg += `\n`;
        }
    }

    if (filterMode === 'all' || filterMode === 'paid') {
        msg += `✅ *DAFTAR SISWA LUNAS (${paidStudents.length} Siswa):*\n`;
        if (paidStudents.length === 0) {
            msg += `_Belum ada siswa yang tercatat lunas._\n\n`;
        } else {
            paidStudents.forEach((s, idx) => {
                msg += `${idx + 1}. ${s.name} (NIS: ${s.nis}) - *LUNAS*\n`;
            });
            msg += `\n`;
        }
    }

    if (filterMode === 'unpaid' || filterMode === 'all') {
        msg += `_Mohon kepada Bapak/Ibu orang tua/wali siswa yang masih memiliki administrasi SPP tertunda agar dapat menyelesaikannya di loket keuangan sekolah. Terima kasih atas pengertian dan kerjasamanya._ 🙏\n\n`;
    } else {
        msg += `_Terima kasih banyak atas ketepatan dan kelancaran pembayaran SPP ananda._ 🙏\n\n`;
    }

    msg += `> ${SCHOOL_CONFIG.appBrand} • ${SCHOOL_CONFIG.schoolName}`;

    const elMsg = document.getElementById('spp-recap-wa-message');
    if (elMsg) elMsg.value = msg;
};

/**
 * Copy SPP Recap message to clipboard
 */
window.copyWaliSppRecapMessage = async function () {
    const elMsg = document.getElementById('spp-recap-wa-message');
    const textToCopy = elMsg ? elMsg.value.trim() : '';

    if (!textToCopy) {
        showToast('Peringatan', 'Teks pesan rekap kosong.', 'warning');
        return;
    }

    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(textToCopy);
        } else {
            const textArea = document.createElement('textarea');
            textArea.value = textToCopy;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
        }
        showToast('Berhasil', 'Pesan rekap SPP berhasil disalin ke clipboard!', 'success');
    } catch (e) {
        console.error('[WaliKelas] Gagal copy pesan:', e);
        showToast('Error', 'Gagal menyalin pesan secara otomatis. Silakan blok dan salin manual.', 'error');
    }
};

/**
 * Open WhatsApp with SPP recap message
 */
window.sendWaliSppRecapToWhatsApp = function () {
    const elMsg = document.getElementById('spp-recap-wa-message');
    const textToSend = elMsg ? elMsg.value.trim() : '';

    if (!textToSend) {
        showToast('Peringatan', 'Teks pesan rekap tidak boleh kosong.', 'warning');
        return;
    }

    const encodedText = encodeURIComponent(textToSend);
    const waUrl = `https://wa.me/?text=${encodedText}`;
    window.open(waUrl, '_blank');
};

/**
 * Open Modal Tambah/Edit Catatan Pembinaan
 */
window.openModalTambahCatatanWali = function (noteId = null) {
    const studentSelect = document.getElementById('form-note-student');
    if (!studentSelect) return;

    studentSelect.innerHTML = '<option value="">-- Pilih Siswa Rombel --</option>';
    const sortedStudents = [...currentClassStudents].sort((a, b) => 
        (a.name || '').localeCompare((b.name || ''), 'id', { sensitivity: 'base' })
    );
    sortedStudents.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.nis;
        opt.textContent = `${s.name} (${s.nis})`;
        studentSelect.appendChild(opt);
    });

    if (noteId) {
        const existingNote = classNotesList.find(n => n.id === noteId);
        if (existingNote) {
            document.getElementById('form-note-id').value = existingNote.id;
            document.getElementById('form-note-student').value = existingNote.studentNis || existingNote.nis || '';
            document.getElementById('form-note-category').value = existingNote.category || 'akademik';
            document.getElementById('form-note-date').value = existingNote.date || getLocalISODate();
            document.getElementById('form-note-title').value = existingNote.title || '';
            document.getElementById('form-note-content').value = existingNote.content || '';

            const startInput = document.getElementById('form-note-time-start');
            const endInput = document.getElementById('form-note-time-end');
            if (startInput) startInput.value = existingNote.start_time || existingNote.startTime || '08:00';
            if (endInput) endInput.value = existingNote.end_time || existingNote.endTime || '08:45';
            window.updateWaliCatatanDurationLabel();

            window.resetWaliCatatanPhotos();
            document.getElementById('modal-catatan-title').innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Edit Catatan Pembinaan';
        }
    } else {
        document.getElementById('form-note-id').value = '';
        document.getElementById('form-note-category').value = 'akademik';
        document.getElementById('form-note-date').value = getLocalISODate();
        document.getElementById('form-note-title').value = '';
        document.getElementById('form-note-content').value = '';

        // Smart default waktu (+45 menit dari waktu sekarang)
        const now = new Date();
        const startStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const startInput = document.getElementById('form-note-time-start');
        if (startInput) startInput.value = startStr;
        window.applyWaliCatatanQuickDuration(45);

        window.resetWaliCatatanPhotos();
        const chkSync = document.getElementById('form-note-sync-ekinerja');
        if (chkSync) chkSync.checked = true;

        document.getElementById('modal-catatan-title').innerHTML = '<i class="fa-solid fa-plus-circle"></i> Buat Catatan Pembinaan Wali Kelas';
    }

    const submitBtn = document.getElementById('btn-submit-catatan');
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-save"></i> Simpan Catatan';
        submitBtn.classList.remove('opacity-75', 'cursor-not-allowed');
    }

    window.openModal('modal-catatan-wali');
};

let _waliCatatanSelectedPhotos = []; // [{ file, previewUrl, name }]

window.applyWaliCatatanQuickDuration = function (minutes = 45) {
    const startInput = document.getElementById('form-note-time-start');
    const endInput = document.getElementById('form-note-time-end');
    const label = document.getElementById('form-note-durasi-label');
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

window.updateWaliCatatanDurationLabel = function () {
    const startInput = document.getElementById('form-note-time-start');
    const endInput = document.getElementById('form-note-time-end');
    const label = document.getElementById('form-note-durasi-label');
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
    if (diff < 0) diff += 24 * 60;
    const jp = Math.round((diff / 45) * 10) / 10;
    label.textContent = `${diff} Menit (${jp} JP)`;
};

window.handleWaliCatatanPhotoSelect = function (files) {
    if (!files || files.length === 0) return;
    const remainingSlots = 3 - _waliCatatanSelectedPhotos.length;
    if (remainingSlots <= 0) {
        showToast('Batas Foto', 'Maksimal 3 foto dokumentasi per sesi pembinaan.', 'warning');
        return;
    }

    const filesToProcess = Array.from(files).slice(0, remainingSlots);
    for (const file of filesToProcess) {
        try {
            const previewUrl = URL.createObjectURL(file);
            _waliCatatanSelectedPhotos.push({
                file,
                previewUrl,
                name: file.name
            });
        } catch (e) {
            console.warn('[WaliKelas] Gagal memuat foto:', e);
        }
    }
    renderWaliCatatanPhotoGrid();
};

window.removeWaliCatatanPhoto = function (index) {
    if (index >= 0 && index < _waliCatatanSelectedPhotos.length) {
        const removed = _waliCatatanSelectedPhotos.splice(index, 1)[0];
        if (removed && removed.previewUrl) {
            try { URL.revokeObjectURL(removed.previewUrl); } catch (_) {}
        }
    }
    renderWaliCatatanPhotoGrid();
};

window.resetWaliCatatanPhotos = function () {
    _waliCatatanSelectedPhotos.forEach(p => {
        if (p.previewUrl) {
            try { URL.revokeObjectURL(p.previewUrl); } catch (_) {}
        }
    });
    _waliCatatanSelectedPhotos = [];
    renderWaliCatatanPhotoGrid();
};

function renderWaliCatatanPhotoGrid() {
    const grid = document.getElementById('form-note-foto-grid');
    const countEl = document.getElementById('form-note-foto-count');
    if (countEl) countEl.textContent = `${_waliCatatanSelectedPhotos.length}/3 Foto`;
    if (!grid) return;

    if (_waliCatatanSelectedPhotos.length === 0) {
        grid.innerHTML = '<span class="text-[11px] text-slate-400 self-center">Belum ada foto dipilih (opsional).</span>';
        return;
    }

    grid.innerHTML = _waliCatatanSelectedPhotos.map((p, idx) => `
        <div class="relative w-16 h-16 rounded-lg overflow-hidden border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 group shadow-sm">
            <img src="${p.previewUrl}" alt="Preview" class="w-full h-full object-cover">
            <button type="button" onclick="window.removeWaliCatatanPhoto(${idx})" class="absolute top-0.5 right-0.5 w-5 h-5 bg-rose-600/90 text-white rounded-full flex items-center justify-center text-[10px] hover:bg-rose-700 transition" title="Hapus Foto">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
    `).join('');
}

window._isSavingCatatanWali = false;

/**
 * Close Catatan Wali Modal with Unsaved Changes Guard
 */
window.closeCatatanWaliModal = async function () {
    if (window._isSavingCatatanWali) return;

    const title = document.getElementById('form-note-title')?.value.trim() || '';
    const content = document.getElementById('form-note-content')?.value.trim() || '';
    const noteId = document.getElementById('form-note-id')?.value || '';

    if (!noteId && (title || content)) {
        const ok = typeof window.showConfirmModal === 'function'
            ? await window.showConfirmModal('Catatan pembinaan yang Anda ketik belum disimpan. Apakah Anda yakin ingin membatalkan dan menutup?', 'Tutup Tanpa Menyimpan', 'warning')
            : confirm('Catatan pembinaan yang Anda ketik belum disimpan. Apakah Anda yakin ingin menutup?');
        if (!ok) return;
    } else if (noteId && (title || content)) {
        const existingNote = (classNotesList || []).find(n => n.id === noteId);
        if (existingNote && (existingNote.title !== title || (existingNote.content || existingNote.notes) !== content)) {
            const ok = typeof window.showConfirmModal === 'function'
                ? await window.showConfirmModal('Perubahan catatan pembinaan belum disimpan. Yakin ingin menutup?', 'Perubahan Belum Disimpan', 'warning')
                : confirm('Perubahan catatan pembinaan belum disimpan. Yakin ingin menutup?');
            if (!ok) return;
        }
    }

    window.closeModal('modal-catatan-wali');
};

/**
 * Save Catatan Pembinaan Wali Kelas
 */
window.saveCatatanWali = async function (e, replaceKbmConfirmed = false) {
    if (e && typeof e.preventDefault === 'function') {
        e.preventDefault();
    }

    if (window._isSavingCatatanWali) {
        console.warn('[WaliKelas] Simpan catatan sedang berjalan, abaikan klik ganda.');
        return;
    }

    const noteId = document.getElementById('form-note-id')?.value || '';
    const studentNis = document.getElementById('form-note-student')?.value || '';
    const category = document.getElementById('form-note-category')?.value || 'akademik';
    const date = document.getElementById('form-note-date')?.value || '';
    const title = document.getElementById('form-note-title')?.value.trim() || '';
    const content = document.getElementById('form-note-content')?.value.trim() || '';

    const startTime = (document.getElementById('form-note-time-start')?.value || '08:00').trim();
    const endTime = (document.getElementById('form-note-time-end')?.value || '08:45').trim();
    const syncEkinerja = document.getElementById('form-note-sync-ekinerja')?.checked !== false;

    if (!studentNis || !title || !content || !date) {
        showToast('Peringatan', 'Harap lengkapi semua bidang yang wajib diisi', 'warning');
        return;
    }

    // Hitung durasi pembinaan
    const [h1, m1] = startTime.split(':').map(Number);
    const [h2, m2] = endTime.split(':').map(Number);
    let durationMinutes = (h2 * 60 + m2) - (h1 * 60 + m1);
    if (durationMinutes <= 0) durationMinutes += 24 * 60;
    if (durationMinutes < 5) {
        showToast('Peringatan', 'Durasi pembinaan minimal 5 menit. Periksa jam mulai dan selesai.', 'warning');
        return;
    }

    const submitBtn = document.getElementById('btn-submit-catatan');
    const originalBtnHtml = submitBtn ? submitBtn.innerHTML : '<i class="fa-solid fa-save"></i> Simpan Catatan';

    window._isSavingCatatanWali = true;
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Menyimpan...';
        submitBtn.classList.add('opacity-75', 'cursor-not-allowed');
    }

    const student = currentClassStudents.find(s => String(s.nis) === String(studentNis) || String(s.id) === String(studentNis) || s.nis == studentNis);
    const authorRealName = auth.currentUser?.displayName || currentUserProfile?.name || currentUserProfile?.nama || localStorage.getItem('user_display_name') || auth.currentUser?.email || 'Wali Kelas';
    const currentUid = auth.currentUser?.uid || '';

    try {
        if (!cfClient || !cfClient.enabled) {
            throw new Error('Layanan Cloudflare D1 tidak aktif atau belum terhubung. Periksa koneksi internet Anda.');
        }

        // Pengunggahan foto jika ada foto yang dipilih
        let evidenceUrl = '';
        if (_waliCatatanSelectedPhotos.length > 0) {
            if (submitBtn) submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Mengunggah Foto...';
            const uploadedPhotos = [];
            const yearMonth = date.slice(0, 7);

            for (let i = 0; i < _waliCatatanSelectedPhotos.length; i++) {
                const photoObj = _waliCatatanSelectedPhotos[i];
                const compressed = await compressImageToJpegBase64(photoObj.file, 800, 0.6, 80 * 1024);
                const safeFileName = `pembinaan_wk_${Date.now()}_${i + 1}.jpg`;
                const uploadRes = await uploadWorkloadPhotoToGoogleDrive(compressed.base64, safeFileName, {
                    teacherName: authorRealName,
                    yearMonth
                });
                uploadedPhotos.push({
                    url: uploadRes.url,
                    fileId: uploadRes.fileId,
                    name: `Dokumentasi Wali Kelas ${i + 1}`,
                    caption: title
                });
            }
            evidenceUrl = JSON.stringify(uploadedPhotos);
        }

        if (submitBtn) submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Menyimpan...';

        await cfClient.saveGuruWaliNote({
            id: noteId || undefined,
            guru_uid: currentUid,
            guru_name: authorRealName,
            student_nis: studentNis,
            student_name: student ? student.name : '',
            student_class: currentRombelClass,
            title: title,
            notes: content,
            category: category,
            date: date,
            start_time: startTime,
            end_time: endTime,
            duration_minutes: durationMinutes,
            evidence_url: evidenceUrl,
            source_portal: 'wali_kelas',
            sync_ekinerja: syncEkinerja,
            replace_kbm: replaceKbmConfirmed
        });

        const successMsg = syncEkinerja
            ? (noteId ? 'Catatan pembinaan berhasil diperbarui dan disinkronkan ke E-Kinerja' : 'Catatan pembinaan berhasil ditambahkan dan disinkronkan ke E-Kinerja')
            : (noteId ? 'Catatan pembinaan berhasil diperbarui' : 'Catatan pembinaan berhasil ditambahkan');
        showToast('Sukses', successMsg, 'success');

        window.resetWaliCatatanPhotos();
        window.closeModal('modal-catatan-wali');
        clearWaliRombelCache();
        await loadClassNotes(currentRombelClass);
        renderNotesTab();
        renderOverviewStats();

    } catch (err) {
        console.error('[WaliKelas] Error saving note to D1:', err);

        // Deteksi Bentrok Jadwal KBM di E-Kinerja
        if (err.conflict_kbm || err.payload?.conflict_kbm) {
            const kbmInfo = err.kbm || err.payload?.kbm || {};
            const kbmDesc = kbmInfo.class
                ? `${kbmInfo.class} - ${kbmInfo.subject || 'KBM'} (${kbmInfo.start_time || ''} - ${kbmInfo.end_time || ''})`
                : 'jadwal KBM reguler';

            const swalFn = (typeof Swal !== 'undefined' && Swal.fire) ? Swal.fire : null;
            if (swalFn) {
                const result = await swalFn({
                    title: 'Bentrok Jadwal KBM',
                    html: `Waktu pembinaan wali kelas ini (${startTime} - ${endTime}) bertepatan dengan <b>${escapeHTML(kbmDesc)}</b> di E-Kinerja.<br><br>Apakah Anda ingin <b>mengganti sesi KBM tersebut</b> dengan pembinaan siswa ini di E-Kinerja?`,
                    icon: 'question',
                    showCancelButton: true,
                    confirmButtonText: '<i class="fa-solid fa-arrows-rotate mr-1"></i> Ya, Ganti Jam KBM',
                    cancelButtonText: 'Batal / Sesuaikan Jam',
                    confirmButtonColor: '#4f46e5',
                    cancelButtonColor: '#64748b'
                });

                if (result.isConfirmed) {
                    return await window.saveCatatanWali(null, true);
                } else {
                    return;
                }
            } else {
                const ok = confirm(`Waktu pembinaan ini bertepatan dengan jadwal KBM: ${kbmDesc}.\n\nApakah Anda ingin mengganti sesi KBM tersebut dengan pembinaan ini di E-Kinerja?`);
                if (ok) {
                    return await window.saveCatatanWali(null, true);
                } else {
                    return;
                }
            }
        }

        showToast('Gagal Menyimpan', (err && err.message) ? err.message : 'Gagal menyimpan catatan pembinaan. Form tetap terbuka agar data Anda tidak hilang.', 'error');
    } finally {
        window._isSavingCatatanWali = false;
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalBtnHtml;
            submitBtn.classList.remove('opacity-75', 'cursor-not-allowed');
        }
    }
};

/**
 * Delete Catatan Pembinaan
 */
window.deleteCatatanWali = async function (noteId) {
    const ok = typeof window.showConfirmModal === 'function'
        ? await window.showConfirmModal('Apakah Anda yakin ingin menghapus catatan pembinaan ini?', 'Hapus Catatan Pembinaan', 'danger')
        : true;
    if (!ok) return;

    try {
        if (!cfClient || !cfClient.enabled) {
            throw new Error('Layanan Cloudflare D1 tidak aktif atau belum terhubung.');
        }
        await cfClient.deleteGuruWaliNote(noteId);
        showToast('Sukses', 'Catatan pembinaan dihapus', 'success');
        clearWaliRombelCache();
        await loadClassNotes(currentRombelClass);
        renderNotesTab();
        renderOverviewStats();
    } catch (e) {
        console.error('[WaliKelas] Error deleting note from D1:', e);
        showToast('Error', 'Gagal menghapus catatan: ' + (e.message || ''), 'error');
    }
};

/**


/**
 * Print / Export Rombel Report
 */
window.printRombelReport = function () {
    window.print();
};

/**
 * Modal Generic Helpers
 */
window.openModal = function (id) {
    const el = document.getElementById(id);
    if (el) {
        el.classList.remove('hidden');
        el.style.display = 'flex';
    }
};

window.closeModal = function (id) {
    const el = document.getElementById(id);
    if (el) {
        el.classList.add('hidden');
        el.style.display = 'none';
    }
};

function setLoadingState(isLoading) {
    const tbody = document.getElementById('ews-table-body');
    if (tbody && isLoading) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="p-8 text-center text-slate-500 font-medium">
                    <i class="fa-solid fa-spinner fa-spin text-indigo-600 text-xl mb-2 block"></i>
                    Memuat data lengkap rombel ${escapeHTML(currentRombelClass)}...
                </td>
            </tr>
        `;
    }
}

// =====================================================================
// MODUL KARTU PELAJAR DIGITAL (E-KTS) & VERIFIKASI FOTO WALI KELAS
// =====================================================================

let currentVerifyStudentNis = null;

/**
 * Buka modal verifikasi pasfoto baru yang diajukan siswa
 * Menampilkan komparasi 2 sisi: Foto Saat Ini (Aktif) vs Foto Baru (Pending)
 */
window.openVerifyPhotoModal = function (nis) {
    if (!nis) return;
    const student = currentClassStudents.find(s => String(s.nis).trim() === String(nis).trim());
    if (!student) {
        showToast('Info', 'Data siswa tidak ditemukan di rombel ini.', 'warning');
        return;
    }

    currentVerifyStudentNis = String(nis).trim();

    // Isi Data Siswa
    const nameEl = document.getElementById('verify-student-name');
    if (nameEl) nameEl.textContent = student.name || '-';
    const nisEl = document.getElementById('verify-student-nis');
    if (nisEl) nisEl.textContent = `${student.nis || '-'} / ${student.nisn || '-'}`;
    const classEl = document.getElementById('verify-student-class');
    if (classEl) classEl.textContent = student.class || currentRombelClass || '-';
    const uploadedEl = document.getElementById('verify-uploaded-at');
    if (uploadedEl) {
        uploadedEl.textContent = student.photoUploadedAt
            ? new Date(student.photoUploadedAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
            : 'Baru saja';
    }

    // 1. Sisi Kiri: Foto Saat Ini (Aktif Sebelumnya)
    const activeImg = document.getElementById('verify-active-photo-img');
    const activeEmpty = document.getElementById('verify-active-photo-empty');
    if (student.activePhotoUrl) {
        if (activeImg) {
            activeImg.src = (typeof window !== 'undefined' && window.resolvePhotoUrl) ? window.resolvePhotoUrl(student.activePhotoUrl) : student.activePhotoUrl;
            activeImg.classList.remove('hidden');
        }
        if (activeEmpty) activeEmpty.classList.add('hidden');
    } else {
        if (activeImg) {
            activeImg.src = '';
            activeImg.classList.add('hidden');
        }
        if (activeEmpty) activeEmpty.classList.remove('hidden');
    }

    // 2. Sisi Kanan: Foto Baru yang Diajukan (Pending)
    const pendingImg = document.getElementById('verify-pending-photo-img');
    const pendingLoading = document.getElementById('verify-pending-photo-loading');
    if (student.pendingPhotoUrl) {
        if (pendingImg) {
            pendingImg.src = (typeof window !== 'undefined' && window.resolvePhotoUrl) ? window.resolvePhotoUrl(student.pendingPhotoUrl) : student.pendingPhotoUrl;
            pendingImg.onload = () => {
                pendingImg.classList.remove('hidden');
                if (pendingLoading) pendingLoading.classList.add('hidden');
            };
            pendingImg.onerror = () => {
                pendingImg.classList.add('hidden');
                if (pendingLoading) {
                    pendingLoading.innerHTML = '<p class="text-[11px] text-rose-500 font-bold">Gagal memuat foto dari R2.</p>';
                    pendingLoading.classList.remove('hidden');
                }
            };
        }
    } else {
        if (pendingImg) {
            pendingImg.src = '';
            pendingImg.classList.add('hidden');
        }
        if (pendingLoading) {
            pendingLoading.innerHTML = '<p class="text-[11px] text-slate-400">Tidak ada pengajuan foto pending.</p>';
            pendingLoading.classList.remove('hidden');
        }
    }

    // Reset Form Alasan Penolakan
    const quickReason = document.getElementById('verify-quick-reason');
    if (quickReason) quickReason.value = '';
    const customReason = document.getElementById('verify-rejection-reason');
    if (customReason) customReason.value = '';

    window.openModal('modal-verify-student-photo');
};

window.closeVerifyPhotoModal = function () {
    currentVerifyStudentNis = null;
    window.closeModal('modal-verify-student-photo');
};

window.onQuickReasonSelect = function (val) {
    const textarea = document.getElementById('verify-rejection-reason');
    if (!textarea) return;
    if (val && val !== 'custom') {
        textarea.value = val;
    } else if (val === 'custom') {
        textarea.value = '';
        textarea.focus();
    }
};

/**
 * Submit Verifikasi Pasfoto Siswa (Setujui / Tolak)
 */
window.submitPhotoVerification = async function (action) {
    if (!currentVerifyStudentNis) return;

    const student = currentClassStudents.find(s => String(s.nis).trim() === currentVerifyStudentNis);
    const rejectionReason = (document.getElementById('verify-rejection-reason')?.value || '').trim();

    if (action === 'reject' && !rejectionReason) {
        if (typeof Swal !== 'undefined') {
            Swal.fire({
                icon: 'warning',
                title: 'Alasan Penolakan Wajib',
                text: 'Harap isi alasan penolakan agar siswa mengerti koreksi pasfoto yang harus dilakukan.',
                confirmButtonColor: '#4f46e5'
            });
        } else {
            alert('Harap isi alasan penolakan agar siswa mengerti koreksi pasfoto.');
        }
        document.getElementById('verify-rejection-reason')?.focus();
        return;
    }

    const isApprove = action === 'approve';
    let confirmed = true;
    if (typeof Swal !== 'undefined') {
        const confirmResult = await Swal.fire({
            title: isApprove ? 'Setujui Pasfoto Siswa?' : 'Tolak Pasfoto Siswa?',
            text: isApprove
                ? `Pasfoto baru ini akan langsung aktif sebagai foto resmi pada E-KTS ${student?.name || 'siswa'}.`
                : `Siswa akan diminta mengunggah ulang pasfoto sesuai catatan penolakan.`,
            icon: isApprove ? 'question' : 'warning',
            showCancelButton: true,
            confirmButtonColor: isApprove ? '#059669' : '#e11d48',
            cancelButtonColor: '#64748b',
            confirmButtonText: isApprove ? 'Ya, Setujui & Aktifkan' : 'Ya, Tolak Foto',
            cancelButtonText: 'Batal'
        });
        confirmed = confirmResult.isConfirmed;
    } else {
        confirmed = confirm(isApprove ? 'Setujui pasfoto siswa?' : 'Tolak pasfoto siswa?');
    }

    if (!confirmed) return;

    const btnApprove = document.getElementById('btn-approve-photo');
    const btnReject = document.getElementById('btn-reject-photo');
    const modalEl = document.getElementById('modal-verify-student-photo');
    const cancelBtns = modalEl ? modalEl.querySelectorAll('button[onclick*="closeVerifyPhotoModal"]') : [];

    // Simpan konten asli tombol untuk pemulihan bila proses gagal
    const originalApproveHtml = btnApprove ? btnApprove.innerHTML : '';
    const originalRejectHtml = btnReject ? btnReject.innerHTML : '';

    // Kunci tombol aksi & tombol tutup modal selama proses berlangsung
    if (btnApprove) {
        btnApprove.disabled = true;
        if (isApprove) {
            btnApprove.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Menyimpan...';
            btnApprove.classList.add('opacity-80', 'cursor-not-allowed');
        }
    }
    if (btnReject) {
        btnReject.disabled = true;
        if (!isApprove) {
            btnReject.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Memproses...';
            btnReject.classList.add('opacity-80', 'cursor-not-allowed');
        }
    }
    cancelBtns.forEach(btn => {
        btn.disabled = true;
        btn.classList.add('pointer-events-none', 'opacity-50');
    });

    // Tampilkan SweetAlert Loading seketika agar pengguna mendapatkan umpan balik langsung
    if (typeof Swal !== 'undefined') {
        Swal.fire({
            title: isApprove ? 'Menyimpan Verifikasi...' : 'Menyimpan Penolakan...',
            html: isApprove
                ? '<p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Sedang mengaktifkan pasfoto baru dan memperbarui kartu digital siswa...</p>'
                : '<p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Sedang mencatat catatan penolakan pasfoto siswa ke server...</p>',
            allowOutsideClick: false,
            allowEscapeKey: false,
            showConfirmButton: false,
            didOpen: () => {
                if (typeof Swal.showLoading === 'function') {
                    Swal.showLoading();
                }
            }
        });
    } else if (typeof showToast === 'function') {
        showToast('Memproses', isApprove ? 'Sedang menyetujui pasfoto...' : 'Sedang menolak pasfoto...', 'info');
    }

    try {
        if (!cfClient || !cfClient.enabled) {
            throw new Error('Layanan Cloudflare backend tidak tersedia.');
        }

        const res = await cfClient.verifyStudentPhoto({
            nis: currentVerifyStudentNis,
            action,
            rejectionReason: !isApprove ? rejectionReason : ''
        });

        if (!res || res.success === false) {
            throw new Error(res?.error || 'Gagal memproses verifikasi foto.');
        }

        // Update State Lokal Siswa
        if (student) {
            if (isApprove) {
                student.activePhotoUrl = student.pendingPhotoUrl;
                student.pendingPhotoUrl = null;
                student.photoStatus = 'approved';
                student.photoRejectionReason = null;
                if (res.photoPublicToken) student.photoPublicToken = res.photoPublicToken;
            } else {
                student.pendingPhotoUrl = null;
                student.photoStatus = 'rejected';
                student.photoRejectionReason = rejectionReason;
            }
        }

        window.closeVerifyPhotoModal();
        renderMasterStudentsTab();

        // Invalidate students cache agar modul lain mengambil data terbaru
        if (typeof window.getStudentsCache === 'function') {
            window.getStudentsCache(true).catch(() => {});
        }

        if (typeof Swal !== 'undefined') {
            Swal.fire({
                icon: 'success',
                title: isApprove ? 'Foto Berhasil Disetujui!' : 'Pengajuan Foto Ditolak',
                text: isApprove
                    ? 'E-KTS siswa telah diperbarui dengan foto resmi baru.'
                    : 'Pemberitahuan penolakan telah dicatat ke sistem.',
                confirmButtonColor: '#4f46e5'
            });
        } else {
            showToast('Sukses', isApprove ? 'Foto berhasil disetujui!' : 'Pengajuan foto ditolak.', 'success');
        }

    } catch (err) {
        console.error('[VerifyPhoto] Error:', err);
        if (typeof Swal !== 'undefined') {
            Swal.fire({
                icon: 'error',
                title: 'Gagal Memproses Verifikasi',
                text: err.message || 'Terjadi kesalahan sistem.',
                confirmButtonColor: '#4f46e5'
            });
        } else {
            showToast('Error', err.message || 'Gagal verifikasi foto.', 'error');
        }
    } finally {
        if (btnApprove) {
            btnApprove.disabled = false;
            btnApprove.classList.remove('opacity-80', 'cursor-not-allowed');
            if (originalApproveHtml) btnApprove.innerHTML = originalApproveHtml;
        }
        if (btnReject) {
            btnReject.disabled = false;
            btnReject.classList.remove('opacity-80', 'cursor-not-allowed');
            if (originalRejectHtml) btnReject.innerHTML = originalRejectHtml;
        }
        cancelBtns.forEach(btn => {
            btn.disabled = false;
            btn.classList.remove('pointer-events-none', 'opacity-50');
        });
    }
};

/**
 * Helper Membuat HTML Kartu Pelajar (CR-80: 85.60 mm x 53.98 mm) - SSOT StudentCardRenderer
 */
function buildKtsPrintMarkup(student, index, side = 'both') {
    return renderKtsPrintPairHtml(student, index, side);
}

// =====================================================================
// MODAL PRATINJAU KTS & INFORMASI PUBLIK HASIL SCAN QR WALI KELAS
// =====================================================================

let currentKtsStudent = null;
let currentKtsSideView = 'front';
let currentKtsPhotoToken = '';
let waliCropImage = null;
let waliCropZoom = 1;
let waliCropOffsetX = 0;
let waliCropOffsetY = 0;
let isDraggingWaliCrop = false;
let waliDragStartX = 0;
let waliDragStartY = 0;

/**
 * Buka Modal Pratinjau KTS & Informasi Publik Hasil Scan QR
 */
window.openKtsPreviewModal = async function (nis) {
    if (!nis) return;
    const student = currentClassStudents.find(s => String(s.nis).trim() === String(nis).trim()) ||
                    (Array.isArray(window.currentClassStudents) && window.currentClassStudents.find(s => String(s.nis).trim() === String(nis).trim()));
    if (!student) {
        showToast('Peringatan', 'Data siswa tidak ditemukan di rombel ini.', 'warning');
        return;
    }

    currentKtsStudent = student;
    currentKtsSideView = 'front';

    // Muat data info foto dan public token terbaru dari server
    try {
        if (cfClient && cfClient.enabled) {
            const photoInfoRes = await cfClient.getStudentPhotoInfo(nis);
            if (photoInfoRes && photoInfoRes.success && photoInfoRes.data) {
                const info = photoInfoRes.data;
                currentKtsPhotoToken = info.public_token || student.photoPublicToken || student.cardToken || '';
                if (info.active_photo_url) currentKtsStudent.activePhotoUrl = info.active_photo_url;
                if (info.pending_photo_url) currentKtsStudent.pendingPhotoUrl = info.pending_photo_url;
                if (info.status) currentKtsStudent.photoStatus = info.status === 'verified' ? 'approved' : info.status;
                currentKtsStudent.verifiedAt = info.verified_at;
                currentKtsStudent.verifiedByName = info.verified_by_name;
            }
        }
    } catch (e) {
        console.warn('[KTS Preview] Gagal memuat info foto realtime:', e);
        currentKtsPhotoToken = student.photoPublicToken || student.cardToken || '';
    }

    if (!currentKtsPhotoToken) {
        currentKtsPhotoToken = student.photoPublicToken || student.cardToken || '';
    }

    // Isi Data Informasi Publik di Kolom Kanan
    const pubName = document.getElementById('pub-info-name');
    if (pubName) pubName.textContent = student.name || '-';

    const pubNisNisn = document.getElementById('pub-info-nis-nisn');
    if (pubNisNisn) pubNisNisn.textContent = `${student.nis || '-'} / ${student.nisn || '-'}`;

    const pubClass = document.getElementById('pub-info-class');
    if (pubClass) pubClass.textContent = student.class || currentRombelClass || '-';

    const pubGender = document.getElementById('pub-info-gender');
    if (pubGender) {
        const rawG = String(student.gender || student.jenisKelamin || '').toUpperCase();
        pubGender.textContent = rawG.startsWith('L') ? 'Laki-laki' : (rawG.startsWith('P') ? 'Perempuan' : '-');
    }

    const pubTtl = document.getElementById('pub-info-ttl');
    if (pubTtl) {
        const place = student.birthPlace || student.tempatLahir || '';
        const date = student.birthDate || student.tanggalLahir || '';
        pubTtl.textContent = place && date ? `${place}, ${date}` : (place || date || '-');
    }

    const pubStatus = document.getElementById('pub-info-status');
    if (pubStatus) {
        const studentCls = student.class || currentRombelClass || '';
        const isCardActive = typeof isStudentCardActive === 'function' ? isStudentCardActive(student) : isRegularStudentClass(studentCls);
        if (isCardActive) {
            pubStatus.className = 'inline-flex items-center gap-1 font-bold text-emerald-600 dark:text-emerald-400';
            pubStatus.innerHTML = `<i class="fa-solid fa-circle-check text-[10px]"></i> Siswa Aktif (${escapeHTML(studentCls)})`;
        } else {
            pubStatus.className = 'inline-flex items-center gap-1 font-bold text-rose-600 dark:text-rose-400';
            pubStatus.innerHTML = `<i class="fa-solid fa-circle-xmark text-[10px]"></i> Siswa Nonaktif (${escapeHTML(studentCls)})`;
        }
    }

    const pubVerified = document.getElementById('pub-info-verified');
    if (pubVerified) {
        const hasVerified = currentKtsStudent.activePhotoUrl || currentKtsStudent.photoStatus === 'approved';
        if (hasVerified) {
            const verBy = currentKtsStudent.verifiedByName ? ` oleh ${escapeHTML(currentKtsStudent.verifiedByName)}` : '';
            const verAt = currentKtsStudent.verifiedAt ? ` (${new Date(currentKtsStudent.verifiedAt).toLocaleDateString('id-ID')})` : '';
            pubVerified.innerHTML = `<span class="text-emerald-600 dark:text-emerald-400 font-bold"><i class="fa-solid fa-circle-check mr-1"></i>Terverifikasi${verBy}${verAt}</span>`;
        } else if (currentKtsStudent.pendingPhotoUrl) {
            pubVerified.innerHTML = `<span class="text-amber-600 dark:text-amber-400 font-bold"><i class="fa-solid fa-clock mr-1"></i>Menunggu Verifikasi</span>`;
        } else {
            pubVerified.innerHTML = `<span class="text-slate-400 italic">Belum Ada Foto Resmi</span>`;
        }
    }

    const pubToken = document.getElementById('pub-info-token');
    if (pubToken) pubToken.textContent = currentKtsPhotoToken || '-';

    const badgeStatus = document.getElementById('modal-kts-badge-status');
    if (badgeStatus) {
        const hasPhoto = Boolean(currentKtsStudent.activePhotoUrl);
        badgeStatus.textContent = hasPhoto ? 'Aktif' : 'Belum Ada Foto';
        badgeStatus.className = `px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${hasPhoto ? 'bg-emerald-500 text-white' : 'bg-slate-500 text-white'} shadow-xs`;
    }

    const btnDelPhoto = document.getElementById('btn-kts-delete-photo');
    if (btnDelPhoto) {
        const hasPhoto = Boolean(currentKtsStudent.activePhotoUrl || currentKtsStudent.pendingPhotoUrl);
        btnDelPhoto.disabled = !hasPhoto;
        btnDelPhoto.title = hasPhoto ? 'Hapus Pasfoto Siswa' : 'Siswa belum memiliki pasfoto untuk dihapus';
    }

    // Link Uji Halaman Publik
    const testLink = document.getElementById('link-test-public-card');
    if (testLink) {
        testLink.href = `${window.location.origin}/kartu-shakti.html?id=${encodeURIComponent(currentKtsPhotoToken)}`;
    }

    // Render Visual Kartu
    window.setKtsSideView('front');

    window.openModal('modal-kts-preview');

    // Reset posisi scroll kolom kanan ke puncak teratas setiap kali modal dibuka
    const rightColEl = document.getElementById('modal-kts-preview-right');
    if (rightColEl) {
        rightColEl.scrollTop = 0;
    }

    // Delegasikan event wheel di area kiri desktop ke kolom kanan agar pergerakan scroll tetap mengalir halus
    const leftColEl = document.getElementById('modal-kts-preview-left');
    if (leftColEl && !leftColEl._ktsWheelDelegated) {
        leftColEl._ktsWheelDelegated = true;
        leftColEl.addEventListener('wheel', (e) => {
            if (window.innerWidth >= 1024) {
                const targetRight = document.getElementById('modal-kts-preview-right');
                if (targetRight) targetRight.scrollTop += e.deltaY;
            }
        }, { passive: true });
    }

    // Pastikan kalkulasi skala kartu langsung terpicu begitu modal terlihat di layar
    requestAnimationFrame(() => {
        const cardEl = document.querySelector('#kts-card-render-box .kts-card-wrapper');
        if (cardEl && typeof updateKtsCardScale === 'function') {
            updateKtsCardScale(cardEl);
        }
    });
};

/**
 * Tutup Modal Pratinjau KTS
 */
window.closeKtsPreviewModal = function () {
    window.closeModal('modal-kts-preview');
};

/**
 * Ganti Tampilan Sisi Kartu (Depan / Belakang)
 */
window.setKtsSideView = function (side) {
    currentKtsSideView = side === 'back' ? 'back' : 'front';

    const btnFront = document.getElementById('btn-kts-side-front');
    const btnBack = document.getElementById('btn-kts-side-back');
    if (btnFront && btnBack) {
        if (currentKtsSideView === 'front') {
            btnFront.className = 'px-2.5 py-1 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs transition';
            btnBack.className = 'px-2.5 py-1 rounded-md text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition';
        } else {
            btnBack.className = 'px-2.5 py-1 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs transition';
            btnFront.className = 'px-2.5 py-1 rounded-md text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition';
        }
    }

    renderKtsPreviewCard();
};

/**
 * Helper Membuat HTML Kartu Pelajar Khusus Layar / Modal Pratinjau - SSOT StudentCardRenderer
 */
function buildKtsScreenCardMarkup(student, side = 'front') {
    const qrId = `modal-screen-qr-${String(student?.nis || 'kts').replace(/\W/g, '')}`;
    if (side === 'front') {
        const resolvedPhoto = (typeof window !== 'undefined' && window.resolvePhotoUrl) ? window.resolvePhotoUrl(student?.activePhotoUrl) : student?.activePhotoUrl;
        const frontHtml = renderKtsFrontHtml(student, { qrId, mode: 'screen', standalone: true, photoSrc: resolvedPhoto });
        return {
            qrId,
            html: `<div class="kts-card-wrapper" style="max-width: 400px; cursor: default;">${frontHtml}</div>`
        };
    } else {
        const backHtml = renderKtsBackHtml(student, { mode: 'screen', standalone: true });
        return {
            qrId: null,
            html: `<div class="kts-card-wrapper" style="max-width: 400px; cursor: default;">${backHtml}</div>`
        };
    }
}

/**
 * Render Visual Kartu KTS di Dalam Modal Pratinjau - SSOT StudentCardRenderer
 */
function renderKtsPreviewCard() {
    const renderBox = document.getElementById('kts-card-render-box');
    if (!renderBox || !currentKtsStudent) return;

    // The generated side must use the same verified QR token as the live preview.
    if (currentKtsPhotoToken) currentKtsStudent.photoPublicToken = currentKtsPhotoToken;

    renderBox.innerHTML = '';
    const cardData = buildKtsScreenCardMarkup(currentKtsStudent, currentKtsSideView);
    renderBox.innerHTML = cardData.html;

    if (currentKtsSideView === 'front' && cardData.qrId) {
        const token = currentKtsPhotoToken || currentKtsStudent.photoPublicToken || currentKtsStudent.cardToken || currentKtsStudent;
        renderKtsQrCode(cardData.qrId, token, { width: 74, height: 74 });
    }

    // Auto-scale kartu agar berperilaku proporsional persis seperti gambar
    const cardEl = renderBox.querySelector('.kts-card-wrapper');
    if (cardEl && typeof updateKtsCardScale === 'function') {
        updateKtsCardScale(cardEl);
    }
}

/**
 * Cetak KTS Siswa yang Sedang Dibuka di Modal
 */
window.printCurrentKtsModal = function () {
    if (!currentKtsStudent) return;
    window.printSingleKtsWali(currentKtsStudent.nis);
};

/**
 * Unduh Gambar KTS PNG dari Modal Wali Kelas (SSOT CR-80 HD 300 DPI)
 * @param {'front'|'back'|'both'|null} side
 */
window.downloadKtsModalPng = async function (side = 'both') {
    if (!currentKtsStudent) return;

    if (typeof showToast === 'function') {
        showToast('Mengunduh Kartu', 'Menyiapkan berkas Kartu Pelajar HD (Depan & Belakang)...', 'info');
    }

    if (typeof StudentCardRenderer?.downloadKtsPng === 'function') {
        await StudentCardRenderer.downloadKtsPng(currentKtsStudent, side || 'both');
    } else if (typeof window.downloadKtsPng === 'function') {
        await window.downloadKtsPng(currentKtsStudent, side || 'both');
    }
};

window.openKtsDownloadModal = function (student) {
    if (typeof StudentCardRenderer?.openKtsDownloadModal === 'function') {
        StudentCardRenderer.openKtsDownloadModal(student || currentKtsStudent);
    }
};

// =====================================================================
// MODAL CROP & GANTI FOTO SISWA OLEH WALI KELAS (AUTO-VERIFIED)
// =====================================================================

window.openWaliCropPhotoModal = function () {
    if (!currentKtsStudent) {
        showToast('Peringatan', 'Pilih siswa terlebih dahulu.', 'warning');
        return;
    }

    const subtitleEl = document.getElementById('wali-crop-student-subtitle');
    if (subtitleEl) {
        subtitleEl.textContent = `Siswa: ${currentKtsStudent.name || '-'} (${currentKtsStudent.nis || '-'})`;
    }

    const fileInput = document.getElementById('input-wali-pasfoto-file');
    if (fileInput) {
        fileInput.value = '';
        fileInput.click();
    }
};

window.closeWaliCropPhotoModal = function () {
    window.closeModal('modal-wali-crop-photo');
};

window.handleWaliPasfotoFileSelect = function (event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showToast('Format Salah', 'File yang dipilih harus berupa file gambar (JPG/PNG/WebP).', 'warning');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            waliCropImage = img;
            waliCropZoom = 1;
            waliCropOffsetX = 0;
            waliCropOffsetY = 0;

            const previewArea = document.getElementById('wali-crop-preview-area');
            const submitBtn = document.getElementById('btn-submit-wali-crop-photo');
            if (previewArea) previewArea.classList.remove('hidden');
            if (submitBtn) submitBtn.disabled = false;

            window.openModal('modal-wali-crop-photo');
            initWaliCropDragging();
            drawWaliCropCanvas();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
};

function initWaliCropDragging() {
    const canvas = document.getElementById('wali-crop-canvas');
    if (!canvas || canvas.dataset.dragInited) return;
    canvas.dataset.dragInited = 'true';

    canvas.addEventListener('mousedown', (e) => {
        isDraggingWaliCrop = true;
        waliDragStartX = e.clientX - waliCropOffsetX;
        waliDragStartY = e.clientY - waliCropOffsetY;
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDraggingWaliCrop) return;
        waliCropOffsetX = e.clientX - waliDragStartX;
        waliCropOffsetY = e.clientY - waliDragStartY;
        drawWaliCropCanvas();
    });

    window.addEventListener('mouseup', () => { isDraggingWaliCrop = false; });

    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            isDraggingWaliCrop = true;
            waliDragStartX = e.touches[0].clientX - waliCropOffsetX;
            waliDragStartY = e.touches[0].clientY - waliCropOffsetY;
        }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
        if (!isDraggingWaliCrop || e.touches.length !== 1) return;
        waliCropOffsetX = e.touches[0].clientX - waliDragStartX;
        waliCropOffsetY = e.touches[0].clientY - waliDragStartY;
        drawWaliCropCanvas();
    }, { passive: true });

    window.addEventListener('touchend', () => { isDraggingWaliCrop = false; });
}

function drawWaliCropCanvas() {
    const canvas = document.getElementById('wali-crop-canvas');
    if (!canvas || !waliCropImage) return;

    canvas.width = 300;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const scale = Math.max(canvas.width / waliCropImage.width, canvas.height / waliCropImage.height) * waliCropZoom;
    const w = waliCropImage.width * scale;
    const h = waliCropImage.height * scale;
    const x = (canvas.width - w) / 2 + waliCropOffsetX;
    const y = (canvas.height - h) / 2 + waliCropOffsetY;

    ctx.drawImage(waliCropImage, x, y, w, h);
}

window.zoomWaliCropPhoto = function (delta) {
    waliCropZoom = Math.min(Math.max(0.5, waliCropZoom + delta), 3.0);
    drawWaliCropCanvas();
};

window.resetWaliCropPhoto = function () {
    waliCropZoom = 1;
    waliCropOffsetX = 0;
    waliCropOffsetY = 0;
    drawWaliCropCanvas();
};

window.submitWaliCroppedPhoto = async function () {
    const canvas = document.getElementById('wali-crop-canvas');
    if (!canvas || !currentKtsStudent) return;

    const btnSubmit = document.getElementById('btn-submit-wali-crop-photo');
    const uploadStatus = document.getElementById('wali-crop-upload-status');
    if (btnSubmit) btnSubmit.disabled = true;
    if (uploadStatus) uploadStatus.classList.remove('hidden');

    try {
        const base64Data = canvas.toDataURL('image/webp', 0.85);

        if (!cfClient || !cfClient.enabled) {
            throw new Error('Layanan Cloudflare API tidak tersedia.');
        }

        const result = await cfClient.uploadStudentPhoto({
            nis: currentKtsStudent.nis,
            photoBase64: base64Data,
            format: 'webp',
            autoVerify: true
        });

        if (!result || !result.success) {
            throw new Error(result?.error || 'Gagal menyimpan foto siswa.');
        }

        // Perbarui data foto lokal siswa
        if (result.active_photo_url) {
            currentKtsStudent.activePhotoUrl = result.active_photo_url;
        }
        currentKtsStudent.pendingPhotoUrl = null;
        currentKtsStudent.photoStatus = 'approved';
        if (result.public_token) {
            currentKtsStudent.photoPublicToken = result.public_token;
            currentKtsPhotoToken = result.public_token;
        }
        currentKtsStudent.verifiedAt = new Date().toISOString();
        currentKtsStudent.verifiedByName = auth?.currentUser?.displayName || auth?.currentUser?.email || 'Wali Kelas';

        window.closeWaliCropPhotoModal();

        // Re-render tampilan pratinjau kartu di modal KTS
        renderKtsPreviewCard();

        // Update badge verifikasi di info publik
        const pubVerified = document.getElementById('pub-info-verified');
        if (pubVerified) {
            pubVerified.innerHTML = `<span class="text-emerald-600 dark:text-emerald-400 font-bold"><i class="fa-solid fa-circle-check mr-1"></i>Terverifikasi oleh Anda (Baru saja)</span>`;
        }
        const badgeStatus = document.getElementById('modal-kts-badge-status');
        if (badgeStatus) {
            badgeStatus.textContent = 'Aktif';
            badgeStatus.className = 'px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500 text-white shadow-xs';
        }

        // Re-render tabel master siswa rombel agar avatar & badge foto terupdate seketika
        renderMasterStudentsTab();

        // Invalidate students cache
        if (typeof window.getStudentsCache === 'function') {
            window.getStudentsCache(true).catch(() => {});
        }

        if (typeof Swal !== 'undefined') {
            Swal.fire({
                icon: 'success',
                title: 'Foto Resmi Diperbarui!',
                text: `Pasfoto resmi siswa ${currentKtsStudent.name} berhasil disimpan dan langsung aktif di kartu KTS.`,
                confirmButtonColor: '#059669',
                timer: 2500
            });
        } else {
            showToast('Sukses', 'Pasfoto resmi siswa berhasil disimpan dan langsung aktif.', 'success');
        }

    } catch (err) {
        console.error('[Submit Wali Photo Error]:', err);
        if (typeof Swal !== 'undefined') {
            Swal.fire({
                icon: 'error',
                title: 'Gagal Menyimpan Foto',
                text: err.message || 'Terjadi kesalahan jaringan.',
                confirmButtonColor: '#4f46e5'
            });
        } else {
            showToast('Gagal Unggah Foto', err.message || 'Terjadi kesalahan sistem.', 'error');
        }
    } finally {
        if (btnSubmit) btnSubmit.disabled = false;
        if (uploadStatus) uploadStatus.classList.add('hidden');
    }
};

/**
 * Hapus Pasfoto Resmi Siswa dari Kartu Pelajar (Wali Kelas & Super Admin)
 * Dilengkapi dialog konfirmasi keamanan wajib mengetik kata 'HAPUS' (OWASP ASVS Destructive Guard)
 */
window.deleteStudentPhotoWali = async function () {
    if (!currentKtsStudent || !currentKtsStudent.nis) {
        showToast('Peringatan', 'Data siswa tidak ditemukan.', 'warning');
        return;
    }

    if (!currentKtsStudent.activePhotoUrl && !currentKtsStudent.pendingPhotoUrl) {
        showToast('Info', 'Siswa ini belum memiliki pasfoto resmi.', 'info');
        return;
    }

    const studentName = currentKtsStudent.name || 'Siswa ini';
    let confirmed = false;

    if (typeof Swal !== 'undefined') {
        const { value: confirmText, isConfirmed } = await Swal.fire({
            title: 'Hapus Pasfoto Siswa?',
            html: `Tindakan ini akan menghapus pasfoto resmi <b>${escapeHTML(studentName)}</b> dari penyimpanan Cloudflare R2 dan kartu pelajar akan kembali menggunakan avatar default bawaan sekolah.<br><br><span class="text-xs text-rose-600 dark:text-rose-400 font-bold">Ketik kata <b>HAPUS</b> di bawah untuk mengonfirmasi:</span>`,
            input: 'text',
            inputPlaceholder: 'Ketik HAPUS',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#e11d48',
            cancelButtonColor: '#64748b',
            confirmButtonText: '<i class="fa-solid fa-trash-can mr-1"></i> Ya, Hapus Pasfoto',
            cancelButtonText: 'Batal',
            inputValidator: (val) => {
                if (!val || String(val).trim().toUpperCase() !== 'HAPUS') {
                    return 'Ketik kata "HAPUS" secara persis untuk mengonfirmasi!';
                }
            }
        });
        confirmed = isConfirmed && String(confirmText || '').trim().toUpperCase() === 'HAPUS';
    } else {
        const inputPrompt = prompt(`HAPUS PASFOTO SISWA?\n\nTindakan ini akan menghapus pasfoto ${studentName} dari kartu pelajar.\nKetik "HAPUS" untuk mengonfirmasi:`);
        confirmed = String(inputPrompt || '').trim().toUpperCase() === 'HAPUS';
    }

    if (!confirmed) return;

    const btnDel = document.getElementById('btn-kts-delete-photo');
    if (btnDel) {
        btnDel.disabled = true;
        btnDel.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Menghapus...';
    }

    try {
        if (!cfClient || !cfClient.enabled) {
            throw new Error('Layanan Cloudflare API tidak tersedia.');
        }

        const res = await cfClient.deleteStudentPhoto(currentKtsStudent.nis);
        if (!res || res.success === false) {
            throw new Error(res?.error || 'Gagal menghapus pasfoto siswa.');
        }

        // 1. Perbarui state lokal data siswa
        currentKtsStudent.activePhotoUrl = null;
        currentKtsStudent.pendingPhotoUrl = null;
        currentKtsStudent.photoStatus = 'none';
        currentKtsStudent.photoRejectionReason = null;
        currentKtsStudent.verifiedAt = null;
        currentKtsStudent.verifiedByName = null;

        // Cari dan update objek siswa di currentClassStudents
        const sIdx = currentClassStudents.findIndex(s => String(s.nis).trim() === String(currentKtsStudent.nis).trim());
        if (sIdx !== -1) {
            currentClassStudents[sIdx].activePhotoUrl = null;
            currentClassStudents[sIdx].pendingPhotoUrl = null;
            currentClassStudents[sIdx].photoStatus = 'none';
            currentClassStudents[sIdx].photoRejectionReason = null;
            currentClassStudents[sIdx].verifiedAt = null;
            currentClassStudents[sIdx].verifiedByName = null;
        }

        // 2. Refresh UI pratinjau kartu di modal KTS
        renderKtsPreviewCard();

        // 3. Update status verifikasi & badge di modal KTS
        const pubVerified = document.getElementById('pub-info-verified');
        if (pubVerified) {
            pubVerified.innerHTML = `<span class="text-slate-400 italic">Belum Ada Foto Resmi</span>`;
        }
        const badgeStatus = document.getElementById('modal-kts-badge-status');
        if (badgeStatus) {
            badgeStatus.textContent = 'Belum Ada Foto';
            badgeStatus.className = 'px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-slate-500 text-white shadow-xs';
        }

        // 4. Update status tombol hapus
        if (btnDel) {
            btnDel.disabled = true;
            btnDel.innerHTML = '<i class="fa-solid fa-trash-can text-rose-600 dark:text-rose-400"></i> <span class="truncate">Hapus Foto</span>';
            btnDel.title = 'Siswa belum memiliki pasfoto untuk dihapus';
        }

        // 5. Re-render tabel master siswa rombel
        renderMasterStudentsTab();

        // 6. Invalidate students cache agar komponen lain sinkron
        if (typeof window.getStudentsCache === 'function') {
            window.getStudentsCache(true).catch(() => {});
        }

        if (typeof Swal !== 'undefined') {
            Swal.fire({
                icon: 'success',
                title: 'Pasfoto Berhasil Dihapus',
                text: `Pasfoto resmi siswa ${studentName} berhasil dihapus. Kartu kembali menggunakan avatar default.`,
                confirmButtonColor: '#059669',
                timer: 2500
            });
        } else {
            showToast('Sukses', 'Pasfoto resmi siswa berhasil dihapus.', 'success');
        }

    } catch (err) {
        console.error('[DeleteStudentPhoto Error]:', err);
        if (typeof Swal !== 'undefined') {
            Swal.fire({
                icon: 'error',
                title: 'Gagal Menghapus Foto',
                text: err.message || 'Terjadi kesalahan sistem.',
                confirmButtonColor: '#4f46e5'
            });
        } else {
            showToast('Error', err.message || 'Gagal menghapus pasfoto.', 'error');
        }
    } finally {
        if (btnDel && currentKtsStudent?.activePhotoUrl) {
            btnDel.disabled = false;
            btnDel.innerHTML = '<i class="fa-solid fa-trash-can text-rose-600 dark:text-rose-400"></i> <span class="truncate">Hapus Foto</span>';
        }
    }
};

/**
 * Cetak KTS Satuan untuk Siswa Tertentu - SSOT StudentCardRenderer
 */
window.printSingleKtsWali = async function (nis) {
    if (!nis) return;
    const student = currentClassStudents.find(s => String(s.nis).trim() === String(nis).trim());
    if (!student) {
        showToast('Peringatan', 'Data siswa tidak ditemukan.', 'warning');
        return;
    }

    await printSingleKts(student, 'both', 'print-single-kts-container');
};

/**
 * Buka Modal Pengaturan Cetak Massal KTS Rombel
 */
window.openBulkPrintKtsModal = function () {
    if (!currentRombelClass) {
        showToast('Peringatan', 'Silakan pilih rombel binaan terlebih dahulu.', 'warning');
        return;
    }
    if (currentClassStudents.length === 0) {
        showToast('Info', 'Tidak ada data siswa dalam rombel ini untuk dicetak.', 'info');
        return;
    }

    const countEl = document.getElementById('bulk-kts-count');
    if (countEl) countEl.textContent = currentClassStudents.length;

    window.openModal('modal-bulk-kts-settings');
};

/**
 * Eksekusi Cetak Massal KTS Rombel (Ukuran Presisi CR-80 KTP di Lembar A4) - SSOT StudentCardRenderer
 */
window.executeBulkPrintKts = async function () {
    if (currentClassStudents.length === 0) return;

    const sideOption = document.querySelector('input[name="bulk-kts-side"]:checked')?.value || 'both';
    const container = document.getElementById('print-kts-bulk-container');
    if (!container) return;

    window.closeModal('modal-bulk-kts-settings');
    if (typeof showToast === 'function') {
        showToast('Menyiapkan Dokumen Cetak', `Menyiapkan ${currentClassStudents.length} kartu sesuai preview...`, 'info');
    }
    await StudentCardRenderer.prepareKtsPrintCards(currentClassStudents, sideOption, container);
    window.print();
};

/**
 * Buka Pratinjau Dokumen Foto KK Siswa untuk Wali Kelas
 */
window.openKKPreviewWali = function (nis, studentName, encodedUrl, uploadedAt) {
    const rawUrl = decodeURIComponent(encodedUrl || '');
    if (!rawUrl) {
        if (typeof showToast === 'function') {
            showToast('Peringatan', 'Tautan dokumen foto KK belum tersedia.', 'warning');
        } else {
            alert('Tautan dokumen foto KK belum tersedia.');
        }
        return;
    }

    const modal = document.getElementById('modal-preview-kk-wali');
    const titleEl = document.getElementById('modal-preview-kk-wali-title');
    const subtitleEl = document.getElementById('modal-preview-kk-wali-subtitle');
    const imgEl = document.getElementById('modal-preview-kk-wali-img');
    const driveLinkEl = document.getElementById('modal-preview-kk-wali-drivelink');
    const metaEl = document.getElementById('modal-preview-kk-wali-meta');

    if (titleEl) titleEl.innerText = `Kartu Keluarga: ${studentName || 'Siswa'}`;
    if (subtitleEl) subtitleEl.innerText = `NIS: ${nis || '-'} • Arsip Google Drive Resmi Sekolah`;
    if (imgEl) {
        imgEl.src = rawUrl;
        imgEl.alt = `Dokumen Kartu Keluarga - ${studentName || nis}`;
    }
    if (driveLinkEl) driveLinkEl.href = rawUrl;
    if (metaEl) {
        const uploadDateStr = uploadedAt ? (typeof formatDateIndoFormal === 'function' ? formatDateIndoFormal(uploadedAt) : uploadedAt) : 'Terverifikasi';
        metaEl.innerText = `NIS: ${nis || '-'} | Waktu Unggah: ${uploadDateStr}`;
    }

    if (modal) modal.classList.remove('hidden');
};

/**
 * Tutup Pratinjau Dokumen Foto KK Siswa
 */
window.closeKKPreviewWali = function () {
    const modal = document.getElementById('modal-preview-kk-wali');
    if (modal) modal.classList.add('hidden');
    const imgEl = document.getElementById('modal-preview-kk-wali-img');
    if (imgEl) imgEl.src = '';
};


import { groupLmsModules } from './lms-structure.mjs';
import { renderLmsStudentModules } from './lms-module-student.mjs';
/* js/page-portal-siswa.js - Portal Siswa dengan SSO Login */
import { app, auth, db, PATHS, APP_VERSION, supabase, SCHOOL_CONFIG, CLOUDFLARE_CONFIG, resolvePhotoUrl, STUDENT_DOCS_APPS_SCRIPT_URL } from './config.js';
import StudentCardRenderer, {
    isRegularStudentClass,
    isStudentCardActive,
    renderKtsInteractiveCard,
    renderKtsQrCode,
    printSingleKts,
    formatBirthDateIndo,
    formatBirthPlace,
    formatStudentCardAddress,
    updateKtsCardScale
} from './student-card-renderer.js';
import {
    cfClient,
    cfStartLmsQuiz,
    cfSaveLmsQuizAnswers,
    cfSubmitLmsQuiz,    cfReportLmsQuizViolation,    cfGetLmsStudentCourses,
    cfTrackLmsStudentProgress,
    cfGetLmsDiscussions,
    cfSaveLmsDiscussion
} from './cloudflare-client.js';
import { installStudentQuiz } from './lms-quiz-student.mjs';
import { getLmsScheduleState, formatLmsScheduleTime } from './lms-schedule.mjs';
import { setLmsHtmlFrame, validateLmsHtml, getLmsMaterialInstructions } from './lms-html.mjs';
import { resolveLmsResourceLink } from './lms-resource-link.mjs';
import { installLmsDiscussionLayout } from './lms-discussion-layout.mjs';
import { installLmsResourceFullscreen } from './lms-resource-fullscreen.mjs';
import { attachLmsHtmlState, lmsHtmlRevision, readLmsHtmlSession, writeLmsHtmlSession, clearLmsHtmlSession } from './lms-html-state.mjs';
import { validateStudentIdentityNumbers } from './global.js';
import { openLmsMathPaletteModal } from './lms-math-palette.mjs';
import {
    normalizeNIS,
    getFriendlyErrorMessage,
    calculateDueDateUrgency,
    renderSafeMarkdown
} from './utils.mjs';
import { setupPushNotifications } from './push-notification.js';
import { loadNotificationInbox } from './notification-inbox.js';
import { verifyStudentSession, isRecoverableStudentSessionError, isExpiredStudentSessionError } from './student-session.mjs';
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { collection, getDocs, query, where, orderBy, doc, getDoc, limit, setDoc, updateDoc, serverTimestamp, Timestamp, collectionGroup } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

function initSupabase() {
    return !!supabase;
}

// Session Data
let currentStudent = null;
let currentNIS = null;
let attendanceCache = {};
let sppYear = null;

// --- SESSION CACHE HELPERS ---
const SESSION_CACHE_KEYS = {
    KEDISIPLINAN: 'session_portal_kedisiplinan',
    BK: 'session_portal_bk',
    SPP_HISTORY: 'session_portal_spp',
    SYSTEM_CONFIG: 'session_portal_config',
    WALI_NOTES: 'session_portal_wali_notes',
    WALI_KELAS_INFO: 'session_portal_wali_kelas_info',
    GURU_WALI_ASSIGNMENT: 'session_portal_guru_wali_assignment',
    GURU_WALI_NAME: 'session_portal_nama_guru_wali',
    GURU_WALI_PHONE: 'session_portal_telp_guru_wali',
    LMS: 'session_portal_lms'
};
const LMS_SESSION_CACHE_TTL_MS = 300000; // 5 menit (300 detik) untuk menghemat kuota read Cloudflare D1

function getSessionCache(key) {
    try {
        return JSON.parse(sessionStorage.getItem(key));
    } catch (e) { return null; }
}

function setSessionCache(key, data) {
    try {
        sessionStorage.setItem(key, JSON.stringify(data));
    } catch (e) { console.warn('[Cache] Error:', e); }
}

function clearPortalCache() {
    Object.values(SESSION_CACHE_KEYS).forEach(key => sessionStorage.removeItem(key));
    try {
        const keysToRemove = [];
        for (let i = 0; i < sessionStorage.length; i++) {
            const k = sessionStorage.key(i);
            if (k && k.startsWith('simas_portal_presensi_')) keysToRemove.push(k);
        }
        keysToRemove.forEach(k => sessionStorage.removeItem(k));
    } catch (_) {}
}

function formatWaUrl(phone, defaultText = '') {
    if (!phone) return '';
    let clean = String(phone).replace(/\D/g, '');
    if (clean.startsWith('0')) clean = '62' + clean.slice(1);
    if (!clean.startsWith('62')) clean = '62' + clean;
    const textParam = defaultText ? `?text=${encodeURIComponent(defaultText)}` : '';
    return `https://wa.me/${clean}${textParam}`;
}

async function getOrFetchWaliKelasInfo(className) {
    const cacheKey = SESSION_CACHE_KEYS.WALI_KELAS_INFO;
    const cached = getSessionCache(cacheKey);
    if (cached && typeof cached === 'object' && cached.name) {
        return cached;
    }

    let name = 'Wali Kelas';
    let phone = '';
    let nip = '';
    let foto = '';

    try {
        if (cfClient && cfClient.enabled && className) {
            const result = await cfClient.getHomeroomContact(className);
            name = result?.name || name;
            phone = result?.phone || '';
            nip = result?.nip || '';
            foto = result?.foto || '';

            // Fallback lookup jika backend belum menyertakan foto/nip tetapi nama wali terdeteksi valid
            if ((!foto || !nip) && name && name !== 'Wali Kelas') {
                try {
                    const gtkList = await cfClient.getGtk({ search: name, limit: 1 });
                    if (Array.isArray(gtkList) && gtkList.length > 0) {
                        const matched = gtkList[0];
                        if (!foto && matched.foto) foto = matched.foto;
                        if (!nip && matched.nip) nip = matched.nip;
                        if (!phone && (matched.phone || matched.hp)) phone = matched.phone || matched.hp;
                    }
                } catch (eGtk) {
                    console.warn('[Portal] Fallback lookup GTK Wali Kelas error:', eGtk);
                }
            }
        }
    } catch (e) {
        console.error("Gagal fetch info Wali Kelas:", e);
    }

    const resData = { name, phone, nip, foto, class: className || '' };
    setSessionCache(cacheKey, resData);
    return resData;
}

async function getOrFetchGuruWaliAssignment(nis) {
    if (!nis) return null;
    const cacheKey = SESSION_CACHE_KEYS.GURU_WALI_ASSIGNMENT;
    const cached = getSessionCache(cacheKey);
    if (cached !== null) {
        return cached;
    }

    let guruWaliData = null;
    try {
        if (cfClient && cfClient.enabled) {
            const assignments = await cfClient.getGuruWaliAssignments({ student_nis: String(nis) });
            if (Array.isArray(assignments) && assignments.length > 0) {
                const assign = assignments[0];
                let phone = '';
                let foto = '';
                let nip = assign.guru_nip || '';

                // Lookup kontak nomor HP & foto guru wali dari Master GTK D1 (0 Firestore Read)
                try {
                    if (assign.guru_nip) {
                        const gtkList = await cfClient.getGtk({ search: assign.guru_nip, limit: 1 });
                        if (Array.isArray(gtkList) && gtkList.length > 0) {
                            phone = gtkList[0].phone || gtkList[0].hp || '';
                            foto = gtkList[0].foto || '';
                            if (!nip && gtkList[0].nip) nip = gtkList[0].nip;
                        }
                    }
                    if ((!phone || !foto) && assign.guru_name) {
                        const gtkList = await cfClient.getGtk({ search: assign.guru_name, limit: 1 });
                        if (Array.isArray(gtkList) && gtkList.length > 0) {
                            if (!phone) phone = gtkList[0].phone || gtkList[0].hp || '';
                            if (!foto) foto = gtkList[0].foto || '';
                            if (!nip && gtkList[0].nip) nip = gtkList[0].nip;
                        }
                    }
                } catch (gtkErr) {
                    console.warn('[Portal] Gagal lookup nomor kontak & foto GTK Guru Wali:', gtkErr);
                }

                guruWaliData = {
                    name: assign.guru_name || 'Tanpa Nama',
                    nip: nip,
                    phone: phone,
                    foto: foto,
                    academicYear: assign.academic_year || '',
                    guruUid: assign.guru_uid || ''
                };
            }
        }
    } catch (e) {
        console.error("Gagal fetch penugasan Guru Wali:", e);
    }

    setSessionCache(cacheKey, guruWaliData);
    return guruWaliData;
}

// Wrapper backward-compatible untuk kode legacy/permisi
async function getOrFetchGuruWaliInfo(nis, className) {
    const waliInfo = await getOrFetchWaliKelasInfo(className || currentStudent?.class || '');
    setSessionCache(SESSION_CACHE_KEYS.GURU_WALI_NAME, waliInfo.name);
    setSessionCache(SESSION_CACHE_KEYS.GURU_WALI_PHONE, waliInfo.phone);
    return waliInfo;
}



// --- INIT ---
let portalSessionCheck = 0;
let portalSessionRetryTimer = null;
let portalSessionRecoveryNoticeShown = false;

async function restoreStudentPortalSession(user) {
    const check = ++portalSessionCheck;
    clearTimeout(portalSessionRetryTimer);
    portalSessionRetryTimer = null;
    // Render versi dinamis dari SSOT
    const footerEl = document.getElementById('portal-siswa-version-display');
    if (footerEl) {
        footerEl.innerHTML = `Portal Siswa ${SCHOOL_CONFIG.appBrand} v${APP_VERSION} &copy; 2025-2026 | ${SCHOOL_CONFIG.schoolName}`;
    }

    // Pastikan Firebase Auth telah tuntas memulihkan sesi dari IndexedDB (ASVS Level 2 Anti Race Condition)
    if (window.location.hostname === '127.0.0.1' && window.location.search.includes('mock=true')) {
        console.log('[Portal] Mode Mock UI aktif untuk verifikasi lokal.');
        return;
    }

    if (typeof auth?.authStateReady === 'function') {
        try {
            await auth.authStateReady();
            user = auth.currentUser;
        } catch (_) {}
    }
    if (check !== portalSessionCheck || window._simasIdleLogoutInProgress) return;
    const isCurrentSession = () => check === portalSessionCheck && auth.currentUser === user;

    // Cek apakah ada sesi siswa yang tersimpan (SSO dari index.html)
    let savedNIS = sessionStorage.getItem('student_nis');

    if (user && (savedNIS || user.isAnonymous)) {
        try {
            const tokenResult = await verifyStudentSession(user, savedNIS, { isCurrent: isCurrentSession });
            // A new tab may restore its NIS only from verified, signed Firebase claims.
            if (!savedNIS) {
                savedNIS = String(tokenResult.claims.studentNis).trim();
                sessionStorage.setItem('student_nis', savedNIS);
            }
            portalSessionRecoveryNoticeShown = false;
        } catch (identityError) {
            if (!isCurrentSession() || identityError?.code === 'session/superseded') return;
            console.warn('[Portal] Sesi siswa ditolak:', identityError);
            if (isRecoverableStudentSessionError(identityError)) {
                // Keep the session while offline or while claims are propagating.
                // Do not load student data until verification actually succeeds.
                portalSessionRetryTimer = setTimeout(() => {
                    portalSessionRetryTimer = null;
                    void restoreStudentPortalSession(auth.currentUser);
                }, 15000);
                if (!portalSessionRecoveryNoticeShown && typeof window.showToast === 'function') {
                    window.showToast('Memulihkan Sesi', 'Sesi belum dapat diperiksa. Aplikasi akan mencoba kembali secara otomatis saat koneksi tersedia.', 'warning', 6000);
                    portalSessionRecoveryNoticeShown = true;
                }
                return;
            }
            // A mismatched tab must not sign out the account active in other tabs.
            if (isExpiredStudentSessionError(identityError)) await signOut(auth).catch(() => {});
            if (check !== portalSessionCheck) return;
            sessionStorage.clear();
            window.location.replace('index.html?status=session_invalid');
            return;
        }

        // Cek Mode Pemeliharaan (Maintenance Mode) & Status Portal Siswa
        try {
            const configData = await window.getSystemConfig();
            if (!isCurrentSession()) return;
            if (configData) {
                if (configData.maintenanceMode) {
                    console.warn('[Portal] Sistem sedang dalam pemeliharaan. Mengeluarkan siswa...');
                    await window.showAlertModal('Pemeliharaan Sistem', 'Sistem sedang dalam pemeliharaan rutin. Anda akan dikeluarkan secara otomatis.', 'warning');
                    if (!isCurrentSession()) return;
                    await signOut(auth);
                    sessionStorage.clear();
                    window.location.replace('index.html');
                    return;
                }
                if (configData.allowStudentLogin === false) {
                    console.warn('[Portal] Login siswa dinonaktifkan. Mengeluarkan siswa...');
                    if (typeof window.showPopup === 'function') {
                        window.showPopup("Portal Nonaktif", "Portal Siswa sedang nonaktif untuk sementara.", "warning");
                        
                        // Timpa fungsi closePopup / tombol OK agar me-redirect ke login
                        const btnOk = document.querySelector('#popup-modal button');
                        if (btnOk) {
                            btnOk.onclick = async () => {
                                if (!isCurrentSession()) return;
                                document.getElementById('popup-modal').classList.add('hidden');
                                await signOut(auth);
                                sessionStorage.clear();
                                window.location.replace('index.html');
                            };
                        } else {
                            await signOut(auth);
                            sessionStorage.clear();
                            window.location.replace('index.html');
                        }
                    } else {
                        // Fallback jika showPopup tidak tersedia
                        await window.showAlertModal('Portal Nonaktif', 'Portal Siswa sedang nonaktif untuk sementara.', 'warning');
                        if (!isCurrentSession()) return;
                        await signOut(auth);
                        sessionStorage.clear();
                        window.location.replace('index.html');
                    }
                    return;
                }
            }
        } catch (e) {
            console.warn('[Portal] Gagal memeriksa status sistem:', e);
        }

        // Ada sesi valid dan user aktif, langsung load dashboard
        if (!isCurrentSession()) return;
        currentNIS = savedNIS;
        loadStudentData(savedNIS);
    } else if (savedNIS && !user) {
        // Berikan konfirmasi tuntas pembacaan sesi IndexedDB sebelum menganggap sesi berakhir
        if (typeof auth?.authStateReady === 'function') {
            try {
                await auth.authStateReady();
            } catch (_) {}
        }
        if (check !== portalSessionCheck || window._simasIdleLogoutInProgress) return;
        if (auth.currentUser) {
            // Sesi terpulihkan setelah authStateReady selesai, biarkan pemrosesan berlanjut
            return;
        }
        // NIS di sessionStorage bukan bukti identitas. Custom claim hanya dapat
        // diterbitkan ulang setelah kredensial diverifikasi oleh backend.
        sessionStorage.clear();
        window.location.replace('index.html?status=session_unavailable');
    } else {
        // A tab without a student session does not revoke another tab's login.
        console.log('[Portal] Sesi tidak ditemukan, membersihkan sesi & redirect ke login...');
        sessionStorage.clear();
        window.location.replace('index.html');
    }
}

const retryPortalSession = () => {
    if (portalSessionRetryTimer !== null && document.visibilityState !== 'hidden') {
        void restoreStudentPortalSession(auth.currentUser);
    }
};
window.addEventListener('online', retryPortalSession);
document.addEventListener('visibilitychange', retryPortalSession);
onAuthStateChanged(auth, restoreStudentPortalSession);



// Utility to prevent XSS
window.escapeHTML = (str) => {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};


function toISODateString(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function toLocalISODate(date = new Date()) {
    return toISODateString(date);
}

function toLocalTimeHHMM(date = new Date()) {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
}

function parseLocalDateTime(dateStr, timeStr = '00:00') {
    const dateMatch = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!dateMatch) return null;

    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]) - 1;
    const day = Number(dateMatch[3]);

    let hour = 0;
    let minute = 0;
    const timeMatch = String(timeStr || '').match(/^(\d{2}):(\d{2})$/);
    if (timeMatch) {
        hour = Number(timeMatch[1]);
        minute = Number(timeMatch[2]);
    }

    return new Date(year, month, day, hour, minute, 0, 0);
}

function normalizeCategory(record = {}) {
    const rawCategory = String(record.category || '').trim().toLowerCase();
    const rawType = String(record.type || '').trim().toLowerCase();
    const rawDesc = String(record.desc || record.notes || '').trim().toLowerCase();

    const categoryVal = rawCategory || rawType;

    if (categoryVal === 'pelanggaran' || categoryVal === 'violation') return 'violation';
    if (categoryVal === 'prestasi' || categoryVal === 'achievement') return 'achievement';
    if (categoryVal === 'permisi' || categoryVal === 'permission') return 'permission';

    // Fallback ringan dari deskripsi untuk data legacy yang tidak konsisten.
    if (rawDesc.includes('pelanggaran') || rawDesc.includes('violation')) return 'violation';
    if (rawDesc.includes('prestasi') || rawDesc.includes('achievement')) return 'achievement';
    if (rawDesc.includes('permisi') || rawDesc.includes('izin') || rawDesc.includes('permission')) return 'permission';

    return 'unknown';
}

function getRecordDateString(record = {}) {
    if (record.date) {
        const parsed = new Date(record.date);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
        }
    }

    if (record.timestamp && typeof record.timestamp.toDate === 'function') {
        return record.timestamp.toDate().toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    if (record.timestampIso) {
        const parsed = new Date(record.timestampIso);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
        }
    }

    if (record.timestamp) {
        const parsed = new Date(record.timestamp);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
        }
    }

    return '-';
}

function normalizeBirthDate(value) {
    if (!value) return '';

    if (value instanceof Timestamp) {
        return toISODateString(value.toDate());
    }

    if (value instanceof Date) {
        return toISODateString(value);
    }

    if (typeof value === 'object' && typeof value.toDate === 'function') {
        return toISODateString(value.toDate());
    }

    const raw = String(value).trim();
    if (!raw) return '';

    // Handle ISO / YYYY-MM-DD / YYYY/MM/DD
    const ymd = raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (ymd) {
        return `${ymd[1]}-${String(ymd[2]).padStart(2, '0')}-${String(ymd[3]).padStart(2, '0')}`;
    }

    // Handle DD/MM/YYYY or DD-MM-YYYY
    const dmy = raw.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
    if (dmy) {
        return `${dmy[3]}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`;
    }

    return '';
}

async function findStudentByNIS(nis) {
    const cleanNIS = normalizeNIS(nis);
    if (!cleanNIS) return null;

    // Prioritas 1: Cloudflare D1
    if (cfClient && cfClient.enabled) {
        try {
            const cfStudent = await cfClient.getStudentByNis(cleanNIS);
            if (cfStudent) return { id: cfStudent.nis || cfStudent.id || cleanNIS, data: cfStudent };
        } catch (e) {
            console.warn('[PortalSiswa] Gagal mengambil siswa dari Cloudflare D1:', e);
        }
    }

    // Prioritas 2: Global / Local Cache
    if (typeof window.getStudentByNIS === 'function') {
        const cached = await window.getStudentByNIS(cleanNIS);
        if (cached) return { id: cached.nis || cached.id || cleanNIS, data: cached };
    }

    // Prioritas 3: Session Storage Fallback (Data hasil verifikasi kredensial saat login)
    try {
        const sessionDataRaw = sessionStorage.getItem('student_data');
        if (sessionDataRaw) {
            const sessionData = JSON.parse(sessionDataRaw);
            if (sessionData && normalizeNIS(sessionData.nis) === cleanNIS) {
                return { id: sessionData.nis || cleanNIS, data: sessionData };
            }
        }
    } catch (sessionErr) {
        console.warn('[PortalSiswa] Gagal membaca fallback student_data dari sessionStorage:', sessionErr);
    }

    return null;
}



// --- LOAD STUDENT DATA ---
async function loadStudentData(nis) {
    try {
        // Selalu muat profil otoritatif dari Firestore. student_data berada di
        // browser dan tidak boleh menjadi sumber identitas/nama/kelas resmi.
        const studentResult = await findStudentByNIS(nis);
        if (studentResult) {
            currentStudent = { id: studentResult.id, ...studentResult.data };
            sessionStorage.setItem('student_data', JSON.stringify(currentStudent));
            sessionStorage.setItem('student_class', currentStudent.class || currentStudent.kelas || currentStudent.rombel || '');
            sessionStorage.setItem('student_name', currentStudent.name || currentStudent.nama || '');
            checkYearbookTab();
        } else {
            throw new Error('Data siswa tidak ditemukan.');
        }

        // Sinkronkan data session user anonim secara senyap ke Firestore /student_sessions/{uid} (untuk keperluan firestore.rules)
        // Lakukan ini secara sinkron (await) sebelum kueri-kueri sekunder (presensi, BK, dll) dipanggil
        const user = auth.currentUser;
        if (currentStudent && user && user.isAnonymous) {
            try {
                const sessionRef = doc(db, 'student_sessions', user.uid);
                await setDoc(sessionRef, {
                    nis: nis,
                    class: currentStudent.class || '-',
                    name: currentStudent.name || '-',
                    updatedAt: serverTimestamp()
                }, { merge: true });
                console.log('[Portal] Sukses sinkronisasi student session.');
            } catch (err) {
                console.warn('[Portal] Gagal mendaftarkan student session:', err);
            }
        }

        // Update Profile UI
        document.getElementById('profile-name').innerText = currentStudent.name || '-';
        document.getElementById('profile-class').innerText = currentStudent.class || '-';
        document.getElementById('profile-nis').innerText = currentStudent.nis || nis;

        // Sinkronisasi otomatis foto profil ke sidebar kiri bawah & header mobile
        const cachedStudentPhoto = sessionStorage.getItem('student_active_photo_url') || currentStudent?.activePhotoUrl || currentStudent?.active_photo_url;
        if (cachedStudentPhoto) {
            syncStudentHeaderAvatar(cachedStudentPhoto, currentStudent.name);
        } else {
            // Fetch status foto aktif siswa dari Cloudflare R2/D1 (0 Firestore Read) secara non-blocking
            const workerUrl = CLOUDFLARE_CONFIG?.WORKER_URL || "https://simas-demo-api.komangpurna1.workers.dev";
            const studentToken = sessionStorage.getItem('student_token') || '';
            const photoHeaders = { 'Accept': 'application/json' };
            if (studentToken) photoHeaders['X-Student-Token'] = studentToken;
            fetch(`${workerUrl}/api/students/photo/info/${encodeURIComponent(nis)}`, { method: 'GET', headers: photoHeaders })
                .then(r => r.json())
                .then(res => {
                    if (res?.success && res.data?.active_photo_url) {
                        sessionStorage.setItem('student_active_photo_url', res.data.active_photo_url);
                        syncStudentHeaderAvatar(res.data.active_photo_url, currentStudent?.name);
                    }
                })
                .catch(() => {});
        }
        updateHubKKStatus(currentStudent);

        // Tab peminatan disembunyikan terlebih dahulu secara default.
        // Visibilitasnya akan dikontrol secara terpusat oleh fungsi checkPeminatanBanner() agar sinkron dengan status kuesioner & riwayat submit.
        const tabPeminatan = document.getElementById('tab-peminatan');
        if (tabPeminatan) {
            tabPeminatan.classList.add('hidden');
            tabPeminatan.classList.remove('flex');
        }



        // Init Filter Bulan Presensi (Mendukung rentang hingga 3 tahun studi di Supabase)
        initMonthFilter();

        // Cek apakah fitur two-step permission aktif
        await checkTwoStepPermissionEnabled();

        // Init form permisi
        try {
            initPermisiForm();
        } catch (featureError) {
            console.error("Init Permisi Error:", featureError);
        }

        // Revalidate the server's material access before resuming a refreshed HTML viewer.
        if (readLmsHtmlSession(nis)) {
            if (typeof window.switchTab === 'function') window.switchTab('lms');
            else void loadStudentLmsData();
        }

        // LAZY LOADING: Hanya load tab default (Presensi) saat login.
        // Tab lainnya akan di-load on-demand saat pertama kali diklik (hemat kuota read).
        try {
            await loadPresensi();
        } catch (e) {
            console.error('Load Presensi Error:', e);
        }

        // Check Peminatan Questionnaire
        checkPeminatanBanner();

        // Check Duta SHAKTI Voting Banner
        checkDutaVotingBanner();

        // Check Yearbook Tab Visibility (Khusus Siswa Kelas XII)
        checkYearbookTab();

        // Inisialisasi Form Edit Profil Siswa Mandiri
        initStudentProfileEditForm();

        // Inisialisasi Push Notifications & Notification Center Siswa (non-blocking)
        try {
            // Wajib UID sesi anonim (bukan NIS): setupPushNotifications menolak UID
            // yang berbeda dari auth.currentUser. Worker memetakan NIS dari klaim token.
            setupPushNotifications(auth.currentUser?.uid);
            loadNotificationInbox(true);
        } catch (eNotif) {
            console.warn('[Portal] Inisialisasi notifikasi siswa warning:', eNotif.message);
        }

    } catch (error) {
        console.error("Load Data Error:", error);
        const code = String(error?.code || '').toLowerCase();
        const msg = String(error?.message || '').toLowerCase();
        const isAuthError = code.startsWith('auth/') || code === 'permission-denied' || code === 'unauthenticated';
        const isInvalidSession = msg.includes('data siswa tidak ditemukan');

        // Logout hanya untuk sinyal sesi/auth invalid yang eksplisit
        if (isAuthError || isInvalidSession) {
            await logout();
            return;
        }

        if (typeof showPopup === 'function') {
            showPopup("Sebagian Data Gagal Dimuat", "Dashboard tetap dibuka, tetapi ada fitur yang gagal dimuat.", "warning");
        }
    }
}

// --- PRESENSI (SUPABASE SSOT MULTI-TAHUN) ---
function initMonthFilter() {
    const select = document.getElementById('filter-presensi-month');
    if (!select) return;

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const curStartYear = (currentMonth >= 6) ? currentYear : currentYear - 1;

    // Tentukan tingkat kelas & batas tahun ajaran lampau
    const cls = String(currentStudent?.class || '').toUpperCase().trim();
    let gradeLabel = 'Kelas XII';
    let maxPastYears = 2; // Default XII / Alumni

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

    // 1. Tahun Ajaran Berjalan (Bulan aktif & Semester)
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

    // 2. Tahun Ajaran & Semester Sebelumnya (Sesuai Jenjang Kelas Siswa)
    for (let offset = 1; offset <= maxPastYears; offset++) {
        const prevStartYear = curStartYear - offset;
        const prevEndYear = prevStartYear + 1;
        const taLabel = `${prevStartYear}/${prevEndYear}`;
        
        const pastGradeLabel = (maxPastYears === 1) 
            ? 'Kelas X' 
            : (offset === 1 ? 'Kelas XI' : 'Kelas X');
        
        html += `<optgroup label="Tahun Ajaran ${taLabel} (${pastGradeLabel})">`;
        html += `<option value="ta:${taLabel}">📁 Seluruh TA ${taLabel} (${pastGradeLabel})</option>`;
        html += `<option value="sem:ODD:${taLabel}">🗓️ Semester Ganjil (Smt 1 - ${pastGradeLabel})</option>`;
        html += `<option value="sem:EVEN:${taLabel}">🗓️ Semester Genap (Smt 2 - ${pastGradeLabel})</option>`;
        
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

    select.innerHTML = html;
}

function updatePresensiPersenUI(currentStats) {
    const elPersen = document.getElementById('stat-persen');
    const elCard = document.getElementById('card-stat-persen');
    const elLabel = document.getElementById('stat-persen-label');
    if (!elPersen) return;

    const attStats = (typeof window.calculateAttendanceStats === 'function')
        ? window.calculateAttendanceStats(currentStats)
        : { attPctFormatted: '0%', tier: 'emerald' };

    elPersen.innerText = attStats.attPctFormatted;

    if (elCard && elLabel) {
        if (attStats.tier === 'rose') {
            elCard.className = 'bg-rose-50 rounded-lg p-1.5 sm:p-3 text-center border border-rose-100';
            elPersen.className = 'text-lg sm:text-2xl font-bold text-rose-600';
            elLabel.className = 'text-[8px] sm:text-[10px] font-bold text-rose-500 uppercase';
        } else if (attStats.tier === 'amber') {
            elCard.className = 'bg-amber-50 rounded-lg p-1.5 sm:p-3 text-center border border-amber-100';
            elPersen.className = 'text-lg sm:text-2xl font-bold text-amber-600';
            elLabel.className = 'text-[8px] sm:text-[10px] font-bold text-amber-500 uppercase';
        } else {
            elCard.className = 'bg-emerald-50 rounded-lg p-1.5 sm:p-3 text-center border border-emerald-100';
            elPersen.className = 'text-lg sm:text-2xl font-bold text-emerald-600';
            elLabel.className = 'text-[8px] sm:text-[10px] font-bold text-emerald-500 uppercase';
        }
    }
}

window.loadPresensi = async function (forceRefresh = false) {
    const filterEl = document.getElementById('filter-presensi-month');
    if (!filterEl) return;
    const monthVal = filterEl.value;
    const tbody = document.getElementById('presensi-tbody');
    if (!tbody) return;

    const refreshBtn = document.getElementById('btn-refresh-presensi');
    const refreshIcon = refreshBtn?.querySelector('i');
    if (refreshIcon) refreshIcon.classList.add('fa-spin');

    tbody.innerHTML = `<tr><td colspan="3" class="p-8 text-center text-blue-500"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;

    // Reset stats
    const stats = { H: 0, S: 0, I: 0, D: 0, A: 0 };

    try {
        if (!currentStudent || !currentNIS) return;

        // Session Cache per filter value
        const presensiCacheKey = `simas_portal_presensi_${currentNIS}_${monthVal}`;
        if (forceRefresh) {
            try { sessionStorage.removeItem(presensiCacheKey); } catch (_) {}
        }
        const cachedPresensi = !forceRefresh ? getSessionCache(presensiCacheKey) : null;

        // Anti-Stale Empty Cache: Jangan gunakan cache jika seluruh data cached adalah 0
        // Mencegah status 0 terkunci jika portal dibuka sebelum presensi harian selesai diinput
        const isCachedEmpty = cachedPresensi && (
            Number(cachedPresensi.stats?.H || 0) === 0 &&
            Number(cachedPresensi.stats?.S || 0) === 0 &&
            Number(cachedPresensi.stats?.I || 0) === 0 &&
            Number(cachedPresensi.stats?.D || 0) === 0 &&
            Number(cachedPresensi.stats?.A || 0) === 0
        );

        if (cachedPresensi && !isCachedEmpty) {
            document.getElementById('stat-hadir').innerText = cachedPresensi.stats.H;
            document.getElementById('stat-sakit').innerText = cachedPresensi.stats.S;
            document.getElementById('stat-izin').innerText = cachedPresensi.stats.I;
            document.getElementById('stat-dispen').innerText = cachedPresensi.stats.D;
            document.getElementById('stat-alpha').innerText = cachedPresensi.stats.A;
            updatePresensiPersenUI(cachedPresensi.stats);
            tbody.innerHTML = cachedPresensi.html;
            return;
        }

        let startDate = null;
        let endDate = null;

        if (monthVal.startsWith('sem:')) {
            const [, semType, taLabel] = monthVal.split(':');
            const [startYStr, endYStr] = taLabel.split('/');
            if (semType === 'ODD') {
                startDate = `${startYStr}-07-01`;
                endDate = `${startYStr}-12-31`;
            } else {
                startDate = `${endYStr}-01-01`;
                endDate = `${endYStr}-06-30`;
            }
        } else if (monthVal.startsWith('ta:')) {
            const taLabel = monthVal.replace('ta:', '');
            const [startYStr, endYStr] = taLabel.split('/');
            startDate = `${startYStr}-07-01`;
            endDate = `${endYStr}-06-30`;
        } else {
            const [y, m] = monthVal.split('-');
            const lastDay = new Date(parseInt(y, 10), parseInt(m, 10), 0).getDate();
            startDate = `${monthVal}-01`;
            endDate = `${monthVal}-${String(lastDay).padStart(2, '0')}`;
        }

        // Ambil langsung dari Supabase via Helper (0 Firestore Read)
        const sbRes = await window.fetchStudentAttendanceRange(currentNIS, startDate, endDate);
        let rows = [];

        if (sbRes && sbRes.source === 'supabase' && Array.isArray(sbRes.rows)) {
            stats.H = sbRes.stats.H || 0;
            stats.S = sbRes.stats.S || 0;
            stats.I = sbRes.stats.I || 0;
            stats.D = sbRes.stats.D || 0;
            stats.A = sbRes.stats.A || 0;

            const statusConfig = {
                'H': ['Hadir', 'bg-green-100 text-green-700 border-green-200'],
                'S': ['Sakit', 'bg-yellow-100 text-yellow-700 border-yellow-200'],
                'I': ['Izin', 'bg-blue-100 text-blue-700 border-blue-200'],
                'D': ['Dispen', 'bg-purple-100 text-purple-700 border-purple-200'],
                'A': ['Alpha', 'bg-red-100 text-red-700 border-red-200']
            };

            rows = sbRes.rows.map(r => {
                const dateObj = new Date(r.date);
                const dateStr = dateObj.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
                const [label, css] = statusConfig[r.status] || ['?', 'bg-gray-100'];

                return {
                    date: r.date,
                    html: `<tr class="hover:bg-slate-50">
                        <td class="px-2 sm:px-4 py-2 font-medium text-slate-700">${dateStr}</td>
                        <td class="px-2 sm:px-4 py-2 text-center"><span class="text-[10px] font-bold px-1.5 py-0.5 rounded border ${css}">${label}</span></td>
                        <td class="px-2 sm:px-4 py-2 text-slate-500">${window.escapeHTML(r.note || '-')}</td>
                    </tr>`
                };
            });
        }

        // Update Stats UI
        document.getElementById('stat-hadir').innerText = stats.H;
        document.getElementById('stat-sakit').innerText = stats.S;
        document.getElementById('stat-izin').innerText = stats.I;
        document.getElementById('stat-dispen').innerText = stats.D;
        document.getElementById('stat-alpha').innerText = stats.A;
        updatePresensiPersenUI(stats);

        const renderedHtml = rows.length === 0
            ? `<tr><td colspan="3" class="p-6 text-center text-slate-400">Belum ada data presensi pada periode ini.</td></tr>`
            : rows.map(r => r.html).join('');
        tbody.innerHTML = renderedHtml;

        // Simpan ke Session Cache agar ganti tab instan (0 read),
        // hanya jika ada data (rows.length > 0) agar status kosong tidak terkunci di cache
        if (rows.length > 0) {
            setSessionCache(presensiCacheKey, { stats, html: renderedHtml });
        } else {
            try { sessionStorage.removeItem(presensiCacheKey); } catch (_) {}
        }

    } catch (e) {
        console.error("Load Presensi Error:", e);
        tbody.innerHTML = `<tr><td colspan="3" class="p-6 text-center text-red-500">Gagal memuat data.</td></tr>`;
    } finally {
        if (refreshIcon) refreshIcon.classList.remove('fa-spin');
    }
};

// --- KEDISIPLINAN (WITH SESSION CACHE) ---
async function loadKedisiplinan() {
    if (!currentStudent) return;

    try {
        // === SESSION CACHE ===
        const cacheKey = SESSION_CACHE_KEYS.KEDISIPLINAN;
        const cached = getSessionCache(cacheKey);

        if (cached) {
            const hasPointsButNoViolations = Number(cached.totalPoints || 0) > 0 && (cached.pelanggaran || []).length === 0;
            if (!hasPointsButNoViolations) {
                console.log('[Portal] Menggunakan session cache kedisiplinan');
                renderKedisiplinan(cached);
                return;
            }
            console.log('[Portal] Cache kedisiplinan terindikasi stale, refresh dari server');
        }

        // 1 & 2. Load Aggregates & Records dari Cloudflare D1 (0 Firestore Read)
        const [aggDoc, cfRecords] = await Promise.all([
            cfClient.getStudentAggregateByNis(currentNIS),
            cfClient.getRecords({ nis: currentNIS, limit: 100 })
        ]);

        let totalPoints = aggDoc?.points || 0;
        const records = (cfRecords || []).map(r => {
            const timeObj = r.timestamp?.toDate ? r.timestamp.toDate() : (r.timestampIso ? new Date(r.timestampIso) : (r.date ? new Date(r.date) : new Date()));
            return {
                ...r,
                category: r.category,
                points: r.points || 0,
                desc: r.desc || '',
                timestamp: { toDate: () => timeObj }
            };
        });

        let pelanggaran = [];
        let prestasi = [];
        let permisi = [];

        records.forEach(r => {
            const dateStr = getRecordDateString(r);
            const normalized = normalizeCategory(r);
            const recordWithDate = { ...r, dateStr };

            if (normalized === 'violation') {
                pelanggaran.push(recordWithDate);
            } else if (normalized === 'achievement') {
                prestasi.push(recordWithDate);
            } else if (normalized === 'permission') {
                permisi.push(recordWithDate);
            }
        });

        const sortByDateDesc = (a, b) => {
            const aTime = a.timestamp && typeof a.timestamp.toDate === 'function'
                ? a.timestamp.toDate().getTime()
                : (a.date ? new Date(a.date).getTime() : 0);
            const bTime = b.timestamp && typeof b.timestamp.toDate === 'function'
                ? b.timestamp.toDate().getTime()
                : (b.date ? new Date(b.date).getTime() : 0);
            return bTime - aTime;
        };

        pelanggaran.sort(sortByDateDesc);
        prestasi.sort(sortByDateDesc);
        permisi.sort(sortByDateDesc);

        // Simpan ke cache
        const cacheData = { totalPoints, pelanggaran, prestasi, permisi };
        setSessionCache(cacheKey, cacheData);
        console.log('[Portal] Kedisiplinan di-cache ke sessionStorage');

        renderKedisiplinan(cacheData);

    } catch (e) {
        console.error("Load Kedisiplinan Error:", e);
    }
}

// Helper render kedisiplinan
function renderKedisiplinan(data) {
    const { totalPoints, pelanggaran, prestasi, permisi } = data;

    document.getElementById('total-pelanggaran').innerText = totalPoints;
    document.getElementById('total-prestasi').innerText = prestasi.length;
    document.getElementById('total-permisi').innerText = permisi.length;

    // Render pelanggaran
    const pelanggaranHtml = pelanggaran.map(r => `
        <li class="p-3 hover:bg-red-50 transition-colors">
            <div class="flex justify-between items-start">
                <div>
                    <div class="font-bold text-slate-700">${window.escapeHTML(r.violationName || r.name || r.desc || '-')}</div>
                    <div class="text-slate-400">${window.escapeHTML(r.notes || '')}</div>
                </div>
                <div class="text-right shrink-0">
                    <span class="text-red-600 font-bold">${r.points || r.point || 0} Poin</span>
                    <div class="text-slate-400">${r.dateStr}</div>
                </div>
            </div>
        </li>
    `).join('');

    document.getElementById('list-pelanggaran').innerHTML = pelanggaran.length > 0
        ? pelanggaranHtml
        : '<li class="p-4 text-center text-green-500"><i class="fa-solid fa-check-circle mr-1"></i> Tidak ada pelanggaran tercatat.</li>';

    // Render prestasi
    const prestasiHtml = prestasi.map(r => `
        <li class="p-3 hover:bg-green-50 transition-colors">
            <div class="flex justify-between items-start">
                <div>
                    <div class="font-bold text-slate-700">${window.escapeHTML(r.achievementName || r.name || '-')}</div>
                    <div class="text-slate-400">${window.escapeHTML(r.notes || '')}</div>
                </div>
                <div class="text-slate-400 shrink-0">${r.dateStr}</div>
            </div>
        </li>
    `).join('');

    document.getElementById('list-prestasi').innerHTML = prestasi.length > 0
        ? prestasiHtml
        : '<li class="p-4 text-center text-slate-400">Belum ada prestasi tercatat.</li>';

    // Render permisi
    const permisiHtml = permisi.map(r => `
        <li class="p-3 hover:bg-orange-50 transition-colors">
            <div class="flex justify-between items-start">
                <div>
                    <div class="font-bold text-slate-700">${window.escapeHTML(r.permissionType || 'Izin Keluar')}</div>
                    <div class="text-slate-400">${window.escapeHTML(r.notes || '')}</div>
                </div>
                <div class="text-slate-400 shrink-0">${r.dateStr}</div>
            </div>
        </li>
    `).join('');

    document.getElementById('list-permisi').innerHTML = permisi.length > 0
        ? permisiHtml
        : '<li class="p-4 text-center text-slate-400">Tidak ada riwayat permisi.</li>';
}

// --- CATATAN BK (WITH SESSION CACHE) ---
// --- CATATAN BK (WITH SESSION CACHE & CLOUDFLARE D1) ---
async function loadBK() {
    if (!currentStudent) return;

    const listEl = document.getElementById('bk-list');
    const emptyEl = document.getElementById('bk-empty');

    try {
        // === SESSION CACHE ===
        const cacheKey = SESSION_CACHE_KEYS.BK;
        const cached = getSessionCache(cacheKey);

        if (cached) {
            console.log('[Portal] Menggunakan session cache BK');
            renderBK(listEl, emptyEl, cached);
            return;
        }

        // Fetch dari Cloudflare D1 (0 Firestore Read)
        const bkData = await cfClient.getBkActions({ nis: String(currentNIS), limit: 20 });

        if (!bkData || bkData.length === 0) {
            setSessionCache(cacheKey, []);
            listEl.classList.add('hidden');
            emptyEl.classList.remove('hidden');
            return;
        }

        // Simpan ke cache
        setSessionCache(cacheKey, bkData);
        console.log('[Portal] BK di-cache ke sessionStorage');

        renderBK(listEl, emptyEl, bkData);

    } catch (e) {
        console.error("Load BK Error:", e);
        listEl.innerHTML = '<p class="text-center text-red-500 py-4">Gagal memuat data BK.</p>';
    }
}

// Helper render BK
function renderBK(listEl, emptyEl, data) {
    if (data.length === 0) {
        listEl.classList.add('hidden');
        emptyEl.classList.remove('hidden');
        return;
    }

    emptyEl.classList.add('hidden');
    listEl.classList.remove('hidden');

    let html = '';
    data.forEach(d => {
        const dateStr = d.date ? new Date(d.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '-';

        const statusConfig = {
            'Selesai': 'bg-green-100 text-green-700 border-green-200',
            'Dalam Pantauan': 'bg-yellow-100 text-yellow-700 border-yellow-200',
            'Perlu Tindak Lanjut': 'bg-red-100 text-red-700 border-red-200'
        };
        const statusCss = statusConfig[d.status] || 'bg-slate-100 text-slate-600';

        html += `
            <div class="border border-slate-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                <div class="flex justify-between items-start mb-2">
                    <div>
                        <h4 class="font-bold text-slate-800">${window.escapeHTML(d.problem || '-')}</h4>
                        <div class="text-xs text-slate-400">${dateStr}</div>
                    </div>
                    <span class="text-[10px] font-bold px-2 py-1 rounded border ${statusCss}">${d.status || '-'}</span>
                </div>
                <div class="flex items-center gap-2 mb-2">
                    <span class="text-xs font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-100">${window.escapeHTML(d.serviceType || '-')}</span>
                </div>
                ${d.notes ? `<p class="text-xs text-slate-600 mt-2 p-2 bg-slate-50 rounded border">${window.escapeHTML(d.notes)}</p>` : ''}
            </div>
        `;
    });

    listEl.innerHTML = html;
}

// --- HELPER FOTO PROFIL GTK & LIGHTBOX WALI ---
function getTeacherInitials(name) {
    if (!name || typeof name !== 'string') return '';
    const clean = name.replace(/^(drs\.|dra\.|dr\.|prof\.)\s*/i, '').trim();
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

function renderTeacherAvatar(containerEl, photoUrl, name, roleTitle, subInfo = '') {
    if (!containerEl) return;
    const resolvedPhoto = photoUrl ? resolvePhotoUrl(photoUrl) : '';
    const safeName = (typeof window !== 'undefined' && window.escapeHTML) ? window.escapeHTML(name || '') : String(name || '');
    const safeRole = (typeof window !== 'undefined' && window.escapeHTML) ? window.escapeHTML(roleTitle || '') : String(roleTitle || '');
    const safeSub = (typeof window !== 'undefined' && window.escapeHTML) ? window.escapeHTML(subInfo || '') : String(subInfo || '');
    const isWaliKelas = roleTitle.toLowerCase().includes('kelas');
    const fallbackIcon = isWaliKelas ? 'fa-chalkboard-user' : 'fa-clipboard-user';
    const initials = getTeacherInitials(name);

    if (resolvedPhoto && !resolvedPhoto.startsWith('javascript:')) {
        const safeUrl = (typeof window !== 'undefined' && window.escapeHTML) ? window.escapeHTML(resolvedPhoto) : resolvedPhoto;
        containerEl.innerHTML = `
            <img src="${safeUrl}" alt="${safeName}"
                class="w-full h-full object-cover object-top hover:scale-105 transition-transform duration-200 cursor-pointer"
                title="Klik untuk melihat pasfoto ${safeName}"
                onclick="window.previewTeacherPhoto('${encodeURIComponent(resolvedPhoto)}', '${safeName}', '${safeRole}', '${safeSub}')"
                loading="lazy"
                onerror="this.onerror=null; this.parentElement.innerHTML='<span class=\\'text-xs font-bold text-white\\'>${initials || `<i class=\\'fa-solid ${fallbackIcon}\\'></i>`}</span>';">
        `;
    } else if (initials && name && name !== 'Wali Kelas' && name !== 'Belum Ditugaskan') {
        containerEl.innerHTML = `
            <span class="text-xs font-bold text-white tracking-wider cursor-pointer select-none"
                title="${safeName}"
                onclick="window.previewTeacherPhoto('', '${safeName}', '${safeRole}', '${safeSub}')">
                ${initials}
            </span>
        `;
    } else {
        containerEl.innerHTML = `<i class="fa-solid ${fallbackIcon} text-sm sm:text-base"></i>`;
    }
}

function renderTeacherThumb(thumbEl, photoUrl, name, roleTitle) {
    if (!thumbEl) return;
    const resolvedPhoto = photoUrl ? resolvePhotoUrl(photoUrl) : '';
    const safeName = (typeof window !== 'undefined' && window.escapeHTML) ? window.escapeHTML(name || '') : String(name || '');
    const isWaliKelas = roleTitle.toLowerCase().includes('kelas');
    const fallbackIcon = isWaliKelas ? 'fa-chalkboard-user' : 'fa-clipboard-user';

    if (resolvedPhoto && !resolvedPhoto.startsWith('javascript:')) {
        const safeUrl = (typeof window !== 'undefined' && window.escapeHTML) ? window.escapeHTML(resolvedPhoto) : resolvedPhoto;
        thumbEl.innerHTML = `
            <img src="${safeUrl}" alt="${safeName}" class="w-full h-full object-cover object-top"
                onerror="this.onerror=null; this.parentElement.innerHTML='<i class=\\'fa-solid ${fallbackIcon} text-[10px]\\'></i>';">
        `;
    } else {
        thumbEl.innerHTML = `<i class="fa-solid ${fallbackIcon} text-[10px]"></i>`;
    }
}

window.previewTeacherPhoto = function(photoUrlParam, name, role, sub) {
    const modal = document.getElementById('modal-preview-teacher-photo');
    if (!modal) return;
    const imgEl = document.getElementById('preview-teacher-photo-img');
    const roleEl = document.getElementById('preview-teacher-photo-role');
    const nameEl = document.getElementById('preview-teacher-photo-name');
    const subEl = document.getElementById('preview-teacher-photo-sub');

    let decodedPhoto = '';
    try {
        decodedPhoto = photoUrlParam ? decodeURIComponent(photoUrlParam) : '';
    } catch (e) {
        decodedPhoto = photoUrlParam || '';
    }

    if (imgEl) {
        if (decodedPhoto && !decodedPhoto.startsWith('javascript:')) {
            imgEl.src = resolvePhotoUrl(decodedPhoto);
            imgEl.parentElement.classList.remove('hidden');
        } else {
            imgEl.src = 'assets/default-avatar.svg';
        }
    }
    if (roleEl) roleEl.textContent = role || 'Guru';
    if (nameEl) nameEl.textContent = name || '-';
    if (subEl) subEl.textContent = sub || '';

    modal.classList.remove('hidden');
};

window.closeTeacherPhotoModal = function() {
    const modal = document.getElementById('modal-preview-teacher-photo');
    if (modal) modal.classList.add('hidden');
};

// --- CATATAN WALI KELAS & GURU WALI (WITH SESSION CACHE) ---
async function loadWaliNotes() {
    if (!currentStudent || !currentNIS) return;

    const listEl = document.getElementById('wali-list');
    const emptyEl = document.getElementById('wali-empty');

    // Elemen Footer
    const footerWaliKelasEl = document.getElementById('nama-wali-kelas');
    const footerGuruWaliEl = document.getElementById('nama-guru-wali');
    const footerWaliKelasThumbEl = document.getElementById('foto-wali-kelas-thumb');
    const footerGuruWaliThumbEl = document.getElementById('foto-guru-wali-thumb');

    // Elemen Card Profil Atas: Wali Kelas
    const cardWaliKelasAvatarEl = document.getElementById('info-wali-kelas-avatar');
    const cardWaliKelasNameEl = document.getElementById('info-wali-kelas-name');
    const cardWaliKelasSubEl = document.getElementById('info-wali-kelas-sub');
    const cardWaliKelasActionEl = document.getElementById('info-wali-kelas-action');

    // Elemen Card Profil Atas: Guru Wali
    const cardGuruWaliAvatarEl = document.getElementById('info-guru-wali-avatar');
    const cardGuruWaliNameEl = document.getElementById('info-guru-wali-name');
    const cardGuruWaliSubEl = document.getElementById('info-guru-wali-sub');
    const cardGuruWaliActionEl = document.getElementById('info-guru-wali-action');

    try {
        const studentClass = currentStudent?.class || '';
        const studentName = currentStudent?.name || 'Siswa';

        // 1. Fetch Informasi Wali Kelas & Guru Wali secara paralel dari Edge D1 SSOT (0 Firestore Read)
        const [waliKelasData, guruWaliData] = await Promise.all([
            getOrFetchWaliKelasInfo(studentClass),
            getOrFetchGuruWaliAssignment(currentNIS)
        ]);

        // === RENDER INFORMASI WALI KELAS ===
        const waliKelasName = waliKelasData?.name || 'Wali Kelas';
        const waliSubStr = studentClass ? `Wali Kelas ${studentClass}` : 'Wali Kelas Rombel';
        const waliDetailStr = [waliSubStr, waliKelasData?.nip ? `NIP. ${waliKelasData.nip}` : ''].filter(Boolean).join(' • ');

        if (footerWaliKelasEl) footerWaliKelasEl.innerText = waliKelasName;
        if (cardWaliKelasNameEl) cardWaliKelasNameEl.innerText = waliKelasName;
        if (cardWaliKelasSubEl) cardWaliKelasSubEl.innerText = waliSubStr;

        renderTeacherAvatar(cardWaliKelasAvatarEl, waliKelasData?.foto, waliKelasName, 'Wali Kelas', waliDetailStr);
        renderTeacherThumb(footerWaliKelasThumbEl, waliKelasData?.foto, waliKelasName, 'Wali Kelas');

        if (cardWaliKelasActionEl) {
            if (waliKelasData?.phone) {
                const waUrl = formatWaUrl(waliKelasData.phone, `Halo Bapak/Ibu ${waliKelasName}, saya ${studentName} dari ${studentClass}.`);
                cardWaliKelasActionEl.innerHTML = `
                    <a href="${waUrl}" target="_blank" rel="noopener noreferrer"
                        class="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-2xs transition active:scale-95 cursor-pointer"
                        title="Chat WhatsApp Wali Kelas">
                        <i class="fa-brands fa-whatsapp text-sm"></i>
                        <span class="hidden sm:inline">Hubungi</span>
                    </a>
                `;
            } else {
                cardWaliKelasActionEl.innerHTML = `
                    <span class="text-[10px] text-slate-400 font-medium px-2 py-1 bg-slate-100 rounded-md">
                        <i class="fa-solid fa-chalkboard-user mr-1 text-slate-400"></i>Wali Rombel
                    </span>
                `;
            }
        }

        // === RENDER INFORMASI GURU WALI ===
        if (guruWaliData && guruWaliData.name) {
            const guruWaliName = guruWaliData.name;
            if (footerGuruWaliEl) {
                footerGuruWaliEl.innerText = guruWaliName;
                footerGuruWaliEl.classList.remove('italic', 'text-slate-400');
                footerGuruWaliEl.classList.add('text-indigo-600');
            }
            if (cardGuruWaliNameEl) {
                cardGuruWaliNameEl.innerText = guruWaliName;
                cardGuruWaliNameEl.classList.remove('italic', 'text-slate-400');
                cardGuruWaliNameEl.classList.add('text-slate-800');
            }
            const nipStr = guruWaliData.nip ? `NIP. ${guruWaliData.nip}` : '';
            const taStr = guruWaliData.academicYear ? `TA ${guruWaliData.academicYear}` : '';
            const detailStr = [nipStr, taStr].filter(Boolean).join(' • ') || 'Pembimbing Akademik & Karakter';
            if (cardGuruWaliSubEl) {
                cardGuruWaliSubEl.innerText = detailStr;
            }

            renderTeacherAvatar(cardGuruWaliAvatarEl, guruWaliData.foto, guruWaliName, 'Guru Wali', detailStr);
            renderTeacherThumb(footerGuruWaliThumbEl, guruWaliData.foto, guruWaliName, 'Guru Wali');

            if (cardGuruWaliActionEl) {
                if (guruWaliData.phone) {
                    const waUrl = formatWaUrl(guruWaliData.phone, `Halo Bapak/Ibu ${guruWaliName}, saya ${studentName} dari ${studentClass} (Siswa Binaan Guru Wali).`);
                    cardGuruWaliActionEl.innerHTML = `
                        <a href="${waUrl}" target="_blank" rel="noopener noreferrer"
                            class="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-2xs transition active:scale-95 cursor-pointer"
                            title="Chat WhatsApp Guru Wali">
                            <i class="fa-brands fa-whatsapp text-sm"></i>
                            <span class="hidden sm:inline">Hubungi</span>
                        </a>
                    `;
                } else {
                    cardGuruWaliActionEl.innerHTML = `
                        <span class="text-[10px] text-indigo-600 font-medium px-2 py-1 bg-indigo-50 border border-indigo-100 rounded-md">
                            <i class="fa-solid fa-clipboard-user mr-1 text-indigo-500"></i>Guru Wali
                        </span>
                    `;
                }
            }
        } else {
            const unassignedText = 'Belum Ditugaskan';
            if (footerGuruWaliEl) {
                footerGuruWaliEl.innerText = unassignedText;
                footerGuruWaliEl.classList.add('italic', 'text-slate-400');
                footerGuruWaliEl.classList.remove('text-indigo-600');
            }
            if (cardGuruWaliNameEl) {
                cardGuruWaliNameEl.innerText = unassignedText;
                // Warna "belum ada" menggantikan warna dasar (urutan CSS Tailwind build)
                cardGuruWaliNameEl.classList.remove('text-slate-800');
                cardGuruWaliNameEl.classList.add('italic', 'text-slate-400');
            }
            if (cardGuruWaliSubEl) {
                cardGuruWaliSubEl.innerText = 'Menunggu penugasan perwalian';
            }
            renderTeacherAvatar(cardGuruWaliAvatarEl, '', unassignedText, 'Guru Wali', 'Menunggu penugasan perwalian');
            renderTeacherThumb(footerGuruWaliThumbEl, '', unassignedText, 'Guru Wali');

            if (cardGuruWaliActionEl) {
                cardGuruWaliActionEl.innerHTML = `
                    <span class="text-[10px] text-slate-400 italic px-2 py-1 bg-slate-100 rounded-md">
                        Belum Ada
                    </span>
                `;
            }
        }

        // === SESSION CACHE CATATAN PEMBINAAN ===
        const cacheKey = SESSION_CACHE_KEYS.WALI_NOTES;
        const cached = getSessionCache(cacheKey);

        if (cached && cached.length > 0) {
            console.log('[Portal] Menggunakan session cache Catatan Wali');
            renderWaliNotes(listEl, emptyEl, cached);
            return;
        }

        // Fetch dari Cloudflare D1 (guru_wali_notes)
        let notes = [];
        if (cfClient && cfClient.enabled) {
            const rawNotes = await cfClient.getGuruWaliNotes({
                student_nis: String(currentNIS),
                limit: 50
            });

            if (Array.isArray(rawNotes)) {
                notes = rawNotes.map(n => ({
                    id: n.id,
                    ...n,
                    title: n.title || n.notes?.split('\n')[0] || 'Catatan Pembinaan',
                    content: n.notes || n.content || '',
                    dateStr: n.date || getRecordDateString(n)
                }));
            }
        }

        console.log(`[Portal] Fetched ${notes.length} Wali Notes from D1 for NIS: ${currentNIS}`);

        setSessionCache(cacheKey, notes);
        console.log('[Portal] Catatan Wali di-cache ke sessionStorage');

        renderWaliNotes(listEl, emptyEl, notes);

    } catch (e) {
        console.error("Load Catatan Wali Error:", e);
        if (listEl) {
            listEl.innerHTML = `<div class="bg-red-50 text-red-600 p-4 rounded-lg text-center font-medium">Gagal memuat catatan perwalian.</div>`;
        }
        if (emptyEl) emptyEl.classList.add('hidden');
    }
}

function renderWaliNotes(listEl, emptyEl, records) {
    if (!records || records.length === 0) {
        if (emptyEl) emptyEl.classList.remove('hidden');
        if (listEl) listEl.innerHTML = '';
        return;
    }

    if (emptyEl) emptyEl.classList.add('hidden');

    const html = records.map(r => {
        // Render badges
        const badges = {
            'akademik': '<span class="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold uppercase tracking-wide"><i class="fa-solid fa-graduation-cap mr-1"></i>Akademik</span>',
            'kompetensi': '<span class="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold uppercase tracking-wide"><i class="fa-solid fa-award mr-1"></i>Kompetensi</span>',
            'keterampilan': '<span class="text-[10px] bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-bold uppercase tracking-wide"><i class="fa-solid fa-tools mr-1"></i>Keterampilan</span>',
            'karakter': '<span class="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-bold uppercase tracking-wide"><i class="fa-solid fa-heart mr-1"></i>Karakter</span>'
        };
        const badge = badges[r.category] || `<span class="text-[10px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full font-bold uppercase tracking-wide"><i class="fa-solid fa-tag mr-1"></i>${r.category || 'Lainnya'}</span>`;

        let dateStr = r.dateStr || '-';
        if (r.date && typeof r.date.toDate === 'function') {
            dateStr = r.date.toDate().toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
        } else if (r.date) {
            dateStr = new Date(r.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
        }

        return `
        <div class="p-4 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
            <div class="flex flex-wrap justify-between items-start mb-2 gap-3">
                <div>
                    <h4 class="font-bold text-slate-800 leading-tight">${window.escapeHTML(r.title || '-')}</h4>
                    <div class="mt-1 flex items-center gap-2">
                        ${badge}
                    </div>
                </div>
                <div class="text-[11px] font-medium text-slate-400 bg-slate-100 px-2 py-1 rounded shrink-0">
                    <i class="fa-regular fa-calendar mr-1"></i> ${dateStr}
                </div>
            </div>
            <p class="text-sm text-slate-600 mt-2 whitespace-pre-line leading-relaxed">${window.escapeHTML(r.content || '-')}</p>
        </div>
        `;
    }).join('');

    if (listEl) listEl.innerHTML = html;
}

// --- SPP ---
// Tanggal mulai sistem baru - bulan sebelum ini otomatis dianggap lunas
const SYSTEM_START_DATE = new Date(2026, 6, 1);

// Hitung tahun ajaran siswa berdasarkan kelas (3 tahun: X, XI, XII)
function calculateCohort(className) {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    // Tahun ajaran dimulai Juli, jadi jika sekarang >= Juli, tahun ajaran = tahun ini
    const academicYearStart = currentMonth >= 6 ? currentYear : currentYear - 1;

    let offset = 0;
    if (className && className.startsWith("XII")) offset = 2;
    else if (className && className.startsWith("XI")) offset = 1;
    else offset = 0;

    const startYear = academicYearStart - offset;
    const endYear = startYear + 3;
    return { startYear, endYear };
}

// Cek apakah bulan tersebut sudah dibayar
function isMonthPaid(paymentHistory, year, month, dueDate) {
    const key = `${year}-${month}`;
    const data = paymentHistory[key];

    // Jika ada data pembayaran di database
    if (data) {
        // Cek apakah ini tanda hutang manual (dari fitur hapus pembayaran)
        if (data.type === 'manual_debt') return false;
        return true; // Ada pembayaran
    }

    // Logika Migrasi: Jika tanggal sebelum SYSTEM_START_DATE, otomatis lunas
    const itemDate = new Date(year, month - 1, dueDate);
    if (itemDate < SYSTEM_START_DATE) return true;

    return false;
}

async function loadSPP() {
    if (!currentStudent) return;

    const grid = document.getElementById('spp-grid');
    if (!grid) return;

    try {
        // Hitung cohort siswa
        const cohort = calculateCohort(currentStudent.class);

        // Inisialisasi tahun SPP ke tahun akademik aktif jika belum terisi
        if (!sppYear) {
            const now = new Date();
            const curMonth = now.getMonth();
            const curYear = now.getFullYear();
            sppYear = curMonth >= 6 ? curYear : curYear - 1;
        }

        // Batasi navigasi tahun (Maksimal 3 tahun ajaran)
        if (sppYear < cohort.startYear) sppYear = cohort.startYear;
        if (sppYear > cohort.endYear - 1) sppYear = cohort.endYear - 1;

        const displayYearEl = document.getElementById('spp-display-year');
        if (displayYearEl) {
            displayYearEl.innerText = `${sppYear}/${sppYear + 1}`;
        }

        grid.innerHTML = `<div class="col-span-full text-center text-blue-500 py-8"><i class="fa-solid fa-spinner fa-spin"></i> Memuat...</div>`;

        // Load semua pembayaran SPP untuk siswa ini dari Supabase
        initSupabase();
        if (!supabase) throw new Error('Supabase client belum siap');

        const rawNis = String(currentNIS || '').trim();
        const normNis = rawNis.replace(/^0+/, '');
        const targetNisList = Array.from(new Set([rawNis, normNis, rawNis.padStart(4, '0')].filter(Boolean)));

        const paymentHistory = {};
        const { data, error } = await supabase
            .from('finance_transactions')
            .select('year, month, amount, type, notes, payment_date, date_str')
            .in('student_nis', targetNisList);

        if (error) {
            console.error('[PortalSiswa] Error loadSPP Supabase:', error);
            throw error;
        }

        if (data) {
            data.forEach(d => {
                if (d.year && d.month) {
                    const key = `${d.year}-${d.month}`;
                    paymentHistory[key] = {
                        amount: Number(d.amount) || 0,
                        type: d.type || 'paid',
                        note: d.notes || '',
                        paymentDate: d.payment_date ? new Date(d.payment_date) : null,
                        dateStr: d.date_str || ''
                    };
                }
            });
        }

        // Nama bulan Indonesia (singkat untuk mobile-friendly)
        const monthNamesShort = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
            'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];
        const monthNamesFull = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
            'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

        // Urutan bulan tahun ajaran: Juli (7) - Juni (6)
        const academicMonths = [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6];

        const today = new Date();
        const currentMonth = today.getMonth() + 1; // 1-12
        const currentYear = today.getFullYear();

        // Ambil tanggal jatuh tempo dari config (cache terpusat)
        let dueDate = 20; // Default
        try {
            const configData = await window.getFinanceConfigCache();
            if (configData && configData.dueDate) {
                dueDate = configData.dueDate;
            }
        } catch (e) { }

        let html = '';

        for (let i = 0; i < 12; i++) {
            const monthNum = academicMonths[i];
            // Juli-Des = tahun awal, Jan-Juni = tahun berikutnya
            const year = monthNum >= 7 ? sppYear : sppYear + 1;

            const monthLabel = monthNamesShort[monthNum - 1];
            const monthFull = monthNamesFull[monthNum - 1];
            const monthKey = `${year}-${monthNum}`;

            // Cek status Locked (di luar range tahun ajaran siswa)
            let isLocked = false;
            if (year < cohort.startYear || (year === cohort.startYear && monthNum < 7)) isLocked = true;
            if (year > cohort.endYear || (year === cohort.endYear && monthNum > 6)) isLocked = true;

            const isPaid = isMonthPaid(paymentHistory, year, monthNum, dueDate);
            const paymentData = paymentHistory[monthKey];

            // Cek apakah sudah jatuh tempo
            const itemDate = new Date(year, monthNum - 1, dueDate);
            const isPastDue = itemDate < today && !isPaid;

            let cardClass = 'bg-slate-100 border-slate-200 text-slate-400'; // Default: Belum jatuh tempo
            let icon = '<i class="fa-solid fa-clock text-slate-300"></i>';
            let statusText = 'Belum Jatuh Tempo';

            if (isLocked) {
                // Non-aktif (di luar periode sekolah)
                cardClass = 'bg-slate-50 border-slate-100 text-slate-300 opacity-50';
                icon = '<i class="fa-solid fa-ban text-slate-200"></i>';
                statusText = 'Non-Aktif';
            } else if (isPaid) {
                if (paymentData) {
                    // Lunas dengan pembayaran
                    cardClass = 'bg-green-50 border-green-200 text-green-700';
                    icon = '<i class="fa-solid fa-check-circle text-green-500"></i>';
                    statusText = 'Lunas';
                } else {
                    // Lunas Migrasi (sebelum Jan 2026)
                    cardClass = 'bg-emerald-50/60 border-emerald-100 text-emerald-600';
                    icon = '<i class="fa-solid fa-check text-emerald-400"></i>';
                    statusText = 'Lunas';
                }
            } else if (isPastDue) {
                // Tunggakan
                cardClass = 'bg-red-50 border-red-200 text-red-600';
                icon = '<i class="fa-solid fa-exclamation-circle text-red-500"></i>';
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
                        payDateHtml = ` • <span class="bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300 px-1 rounded font-medium text-[8.5px]" title="Tanggal Bayar: ${dd}/${mm}/${pDate.getFullYear()}"><i class="fa-regular fa-calendar-check mr-0.5"></i>${dd}/${mm}</span>`;
                    }
                } else {
                    payDateHtml = ` • <span class="bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-1 rounded font-medium text-[8.5px]" title="Lunas Migrasi Awal"><i class="fa-solid fa-clock-rotate-left mr-0.5"></i>Migrasi</span>`;
                }
            }

            html += `
                <div class="rounded-lg border p-2 text-center ${cardClass} transition-all hover:shadow-md" title="${monthFull} ${year} - ${statusText}">
                    <div class="text-lg mb-0.5">${icon}</div>
                    <div class="font-bold text-xs">${monthLabel}</div>
                    <div class="text-[8px] text-slate-400 flex items-center justify-center gap-0.5">${year}${payDateHtml}</div>
                    <div class="text-[9px] uppercase tracking-wide mt-0.5">${statusText}</div>
                </div>
            `;
        }

        grid.innerHTML = html;

        // Update status tombol navigasi
        updateSppNavButtons(cohort);

    } catch (e) {
        console.error("Load SPP Error:", e);
        grid.innerHTML = '<div class="col-span-full text-center text-red-500 py-8">Gagal memuat data SPP.</div>';
    }
}

function updateSppNavButtons(cohort) {
    const btnPrev = document.getElementById('spp-btn-prev');
    const btnNext = document.getElementById('spp-btn-next');
    if (!btnPrev || !btnNext || !cohort) return;

    const maxYear = cohort.endYear - 1;

    // Tombol kiri (prev): disable jika sudah di tahun paling awal
    btnPrev.disabled = sppYear <= cohort.startYear;
    btnPrev.classList.toggle('opacity-30', sppYear <= cohort.startYear);
    btnPrev.classList.toggle('cursor-not-allowed', sppYear <= cohort.startYear);

    // Tombol kanan (next): disable jika sudah di tahun paling akhir
    btnNext.disabled = sppYear >= maxYear;
    btnNext.classList.toggle('opacity-30', sppYear >= maxYear);
    btnNext.classList.toggle('cursor-not-allowed', sppYear >= maxYear);
}

window.changeSppYear = function (delta) {
    if (!currentStudent) return;
    const cohort = calculateCohort(currentStudent.class);
    if (!sppYear) {
        const now = new Date();
        const curMonth = now.getMonth();
        const curYear = now.getFullYear();
        sppYear = curMonth >= 6 ? curYear : curYear - 1;
    }
    const newYear = sppYear + delta;
    if (newYear < cohort.startYear || newYear > cohort.endYear - 1) return;
    sppYear = newYear;
    loadSPP();
};

// --- LOAD PERPUSTAKAAN LOANS (SUPABASE SSOT) ---
async function loadLibraryLoans() {
    if (!currentNIS) return;

    const activeContainer = document.getElementById('perpus-active-loans-container');
    const historyContainer = document.getElementById('perpus-history-loans-container');
    const badgeActive = document.getElementById('perpus-badge-active-count');
    const statDipinjam = document.getElementById('perpus-stat-dipinjam');
    const statTerlambat = document.getElementById('perpus-stat-terlambat');
    const statTotal = document.getElementById('perpus-stat-total');

    try {
        if (!supabase) {
            if (activeContainer) activeContainer.innerHTML = '<div class="p-6 text-center text-slate-400">Layanan perpustakaan sedang tidak tersedia.</div>';
            return;
        }

        const { data, error } = await supabase
            .from('lib_sirkulasi')
            .select(`
                *,
                buku:lib_buku (id, judul, pengarang, penerbit, lokasi_rak, cover_url),
                eksemplar:lib_eksemplar (id, nomor_induk, kode_barcode, copy_number)
            `)
            .eq('peminjam_id', String(currentNIS))
            .order('created_at', { ascending: false });

        if (error) throw error;

        const allLoans = data || [];
        const activeLoans = allLoans.filter(l => l.status === 'dipinjam');
        const returnedLoans = allLoans.filter(l => l.status === 'kembali');

        const todayStr = new Date().toISOString().split('T')[0];
        let countTerlambat = 0;

        activeLoans.forEach(l => {
            if (l.tgl_jatuh_tempo && l.tgl_jatuh_tempo < todayStr) {
                countTerlambat++;
            }
        });

        if (statDipinjam) statDipinjam.textContent = activeLoans.length;
        if (statTerlambat) statTerlambat.textContent = countTerlambat;
        if (statTotal) statTotal.textContent = allLoans.length;
        if (badgeActive) badgeActive.textContent = `${activeLoans.length} Buku`;

        // Fetch Bebas Pustaka Digital status
        let studentClearance = null;
        try {
            const clearanceResponse = await window.callSecureEdgeFunction('library-clearance-get', {
                nis: String(currentNIS)
            });
            studentClearance = clearanceResponse?.data?.[0] || null;
        } catch (e) {
            console.warn('[PortalSiswa] Error fetch bebas pustaka:', e);
            throw new Error('Status bebas pustaka tidak dapat diverifikasi saat ini. Silakan muat ulang halaman.');
        }

        // Render Status Bebas Pustaka Card
        const bebasCard = document.getElementById('perpus-bebas-pustaka-card');
        const bebasBadge = document.getElementById('perpus-bebas-pustaka-badge');
        const bebasDesc = document.getElementById('perpus-bebas-pustaka-desc');
        const bebasAction = document.getElementById('perpus-bebas-pustaka-action');

        if (studentClearance) {
            window.currentStudentClearance = studentClearance;
            if (bebasBadge) {
                bebasBadge.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 inline-flex items-center gap-1';
                bebasBadge.innerHTML = '<i class="fa-solid fa-circle-check text-emerald-600"></i> Resmi Bebas Pustaka';
            }
            if (bebasDesc) {
                bebasDesc.innerHTML = `No Surat: <b class="font-mono text-teal-700 dark:text-teal-400">${window.escapeHTML(studentClearance.no_surat)}</b> &bull; Diverifikasi oleh: <b>${window.escapeHTML(studentClearance.petugas_nama || 'Petugas Perpustakaan')}</b> (${studentClearance.tgl_terbit || '-'}).`;
            }
            if (bebasAction) {
                bebasAction.innerHTML = `
                    <button onclick="window.viewStudentClearanceLetter()" class="w-full sm:w-auto px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs transition shadow-md shadow-teal-600/30 flex items-center justify-center gap-2 active:scale-95">
                        <i class="fa-solid fa-file-shield"></i> Lihat E-Surat Resmi
                    </button>
                `;
            }
        } else {
            window.currentStudentClearance = null;
            if (activeLoans.length > 0) {
                if (bebasBadge) {
                    bebasBadge.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700';
                    bebasBadge.textContent = 'Ada Tanggungan Buku';
                }
                if (bebasDesc) {
                    bebasDesc.innerHTML = `Kamu masih memiliki <b>${activeLoans.length} buku pinjaman aktif</b>. Kembalikan buku ke perpustakaan untuk syarat bebas pustaka.`;
                }
                if (bebasAction) {
                    bebasAction.innerHTML = '<span class="text-xs text-amber-600 dark:text-amber-400 font-semibold italic">Harap selesaikan peminjaman</span>';
                }
            } else {
                if (bebasBadge) {
                    bebasBadge.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-700';
                    bebasBadge.textContent = 'Bersih (Menunggu Petugas)';
                }
                if (bebasDesc) {
                    bebasDesc.textContent = 'Tidak ada tanggungan buku. Petugas perpustakaan akan segera memvalidasi status bebas pustaka digitalmu.';
                }
                if (bebasAction) {
                    bebasAction.innerHTML = '<span class="text-xs text-teal-600 dark:text-teal-400 font-bold flex items-center gap-1"><i class="fa-solid fa-check"></i> Tanggungan Bersih</span>';
                }
            }
        }

        // Render Active Loans
        if (activeLoans.length === 0) {
            activeContainer.innerHTML = `
                <div class="p-8 text-center text-slate-400">
                    <i class="fa-solid fa-book-bookmark text-3xl mb-2 text-slate-300"></i>
                    <p class="text-xs font-medium">Kamu tidak memiliki pinjaman buku aktif saat ini.</p>
                </div>
            `;
        } else {
            activeContainer.innerHTML = activeLoans.map(l => {
                const isLate = l.tgl_jatuh_tempo && l.tgl_jatuh_tempo < todayStr;
                let lateDays = 0;
                if (isLate) {
                    const diffTime = Math.abs(new Date(todayStr) - new Date(l.tgl_jatuh_tempo));
                    lateDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                }

                const rawTarif = (l.tarif_denda_per_hari !== null && l.tarif_denda_per_hari !== undefined)
                    ? Number(l.tarif_denda_per_hari)
                    : 1000;
                const tarifVal = Number.isNaN(rawTarif) ? 1000 : rawTarif;
                const dendaEst = lateDays * tarifVal;

                return `
                    <div class="p-3.5 sm:p-4 hover:bg-slate-50 transition flex flex-col sm:flex-row justify-between sm:items-center gap-2">
                        <div>
                            <div class="font-bold text-slate-800 text-xs sm:text-sm leading-tight">${window.escapeHTML(l.buku?.judul || 'Buku')}</div>
                            <div class="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                                <i class="fa-solid fa-user-pen text-[10px] text-blue-500"></i>
                                <span>${window.escapeHTML(l.buku?.pengarang || 'Anonim')}</span>
                                &bull; <span class="font-mono text-slate-400">Barcode: ${window.escapeHTML(l.eksemplar?.kode_barcode || l.eksemplar?.nomor_induk || '-')}</span>
                            </div>
                            <div class="text-[11px] text-slate-500 mt-1 flex flex-wrap items-center gap-2">
                                <span>Tgl Pinjam: <b>${l.tgl_pinjam || '-'}</b></span>
                                &bull; 
                                <span class="${isLate ? 'text-rose-600 font-bold' : ''}">Jatuh Tempo: <b>${l.tgl_jatuh_tempo || '-'}</b></span>
                            </div>
                        </div>

                        <div class="shrink-0 text-left sm:text-right">
                            ${isLate ? `
                                <span class="px-2.5 py-1 rounded-full bg-rose-50 text-rose-600 border border-rose-200 font-bold text-[10px] inline-flex items-center gap-1">
                                    <i class="fa-solid fa-triangle-exclamation"></i> Terlambat ${lateDays} Hari
                                </span>
                                <div class="text-[10px] ${dendaEst > 0 ? 'text-rose-600' : 'text-emerald-600'} font-bold mt-1">${dendaEst > 0 ? `Est. Denda: Rp ${dendaEst.toLocaleString('id-ID')}` : 'Bebas Denda'}</div>
                            ` : `
                                <span class="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-bold text-[10px] inline-flex items-center gap-1">
                                    <i class="fa-solid fa-clock"></i> Masa Pinjam Aktif
                                </span>
                            `}
                        </div>
                    </div>
                `;
            }).join('');
        }

        // Render Past Returned Loans
        if (returnedLoans.length === 0) {
            historyContainer.innerHTML = '<div class="p-6 text-center text-slate-400 italic">Belum ada riwayat pengembalian buku.</div>';
        } else {
            historyContainer.innerHTML = returnedLoans.map(l => `
                <div class="p-3 hover:bg-slate-50 transition flex justify-between items-center text-xs">
                    <div>
                        <div class="font-semibold text-slate-800">${window.escapeHTML(l.buku?.judul || 'Buku')}</div>
                        <div class="text-[10px] text-slate-400">Pinjam: ${l.tgl_pinjam || '-'} &bull; Kembali: ${l.tgl_kembali || '-'}</div>
                    </div>
                    <span class="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 font-bold text-[10px] border border-emerald-200">
                        Kembali
                    </span>
                </div>
            `).join('');
        }

    } catch (e) {
        console.error('[Portal] Gagal load pinjaman perpus:', e);
        if (activeContainer) activeContainer.innerHTML = '<div class="p-6 text-center text-rose-500">Gagal memuat data perpustakaan.</div>';
    }
}

// Expose fungsi load tab ke window untuk lazy loading dari inline script switchTab
window.loadKedisiplinan = loadKedisiplinan;
window.loadBK = loadBK;
window.loadWaliNotes = loadWaliNotes;
window.loadSPP = loadSPP;
window.loadLibraryLoans = loadLibraryLoans;

// --- LOGOUT ---
window.logout = async function () {
    window.closeStudentResourceModal?.();
    try {
        await signOut(auth);
    } catch (e) { }

    // Bersihkan semua cache portal & seluruh sisa sesi siswa (HP bersama aman)
    if (typeof window.invalidateCurrentUserDoc === 'function') window.invalidateCurrentUserDoc();
    clearPortalCache();
    sessionStorage.clear();
    localStorage.removeItem('last_login_uid');
    localStorage.removeItem('simas_inbox_cache'); // isi lonceng pribadi siswa (HP bersama)
    localStorage.removeItem('user_role');
    localStorage.removeItem('user_additional_roles');
    currentStudent = null;
    currentNIS = null;
    sppYear = null;

    // Redirect ke halaman login utama (unified)
    window.location.href = 'index.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
};

// =====================================
// TWO-STEP PERMISSION SYSTEM
// =====================================

let twoStepPermissionEnabled = false;

// Cek apakah fitur Two-Step Permission aktif (WITH SESSION CACHE)
async function checkTwoStepPermissionEnabled() {
    try {
        // === SESSION CACHE ===
        const cacheKey = SESSION_CACHE_KEYS.SYSTEM_CONFIG;
        let configData = getSessionCache(cacheKey);

        if (!configData) {
            configData = await window.getSystemConfig();
            if (configData) {
                setSessionCache(cacheKey, configData);
                console.log('[Portal] System config di-cache ke sessionStorage');
            } else {
                configData = {};
            }
        } else {
            console.log('[Portal] Menggunakan session cache system config');
        }

        twoStepPermissionEnabled = configData.twoStepPermission || false;

        // Tampilkan/sembunyi tab permisi berdasarkan setting
        const tabPermisi = document.getElementById('tab-permisi');
        if (tabPermisi) {
            if (twoStepPermissionEnabled) {
                tabPermisi.classList.remove('hidden');
            } else {
                tabPermisi.classList.add('hidden');
            }
        }

        return twoStepPermissionEnabled;
    } catch (e) {
        console.error("Error checking two-step permission:", e);
        return false;
    }
}

// Load pengajuan permisi siswa
window.loadMyPermissionRequests = async function () {
    if (!twoStepPermissionEnabled || !currentNIS) return;

    const container = document.getElementById('list-permisi-requests');
    const notifContainer = document.getElementById('permisi-notification');

    container.innerHTML = `<div class="text-center text-slate-400 py-6 text-sm">
        <i class="fa-solid fa-spinner fa-spin mr-2"></i> Memuat pengajuan...
    </div>`;

    try {
        const today = toLocalISODate(new Date());

        let requests = [];
        if (cfClient && cfClient.enabled) {
            const raw = await cfClient.getPermisiRequests({
                student_nis: String(currentNIS),
                date: today
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
                        status: r.status,
                        waliNote: r.wali_note,
                        piketNote: r.piket_note
                    }
                }));
            }
        }

        if (requests.length === 0) {
            container.innerHTML = `
                <div class="text-center py-8">
                    <div class="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
                        <i class="fa-solid fa-inbox text-slate-300 text-2xl"></i>
                    </div>
                    <p class="text-slate-400 text-sm">Belum ada pengajuan hari ini</p>
                    <p class="text-slate-300 text-xs mt-1">Ajukan permisi melalui form di sebelah kiri</p>
                </div>
            `;
            notifContainer.classList.add('hidden');
            return;
        }

        // Ambil data Wali Kelas untuk tombol WA
        let waliKelasPhone = '';
        let waliKelasName = 'Wali Kelas';
        try {
            const waliInfo = await getOrFetchGuruWaliInfo(currentNIS, currentStudent?.class || '');
            waliKelasPhone = waliInfo.phone || '';
            waliKelasName = waliInfo.name || 'Wali Kelas';
        } catch (e) {
            console.error("Gagal cari info Wali Kelas:", e);
        }

        let html = '';
        let hasRejected = false;
        let rejectedReason = '';

        requests.forEach(docSnap => {
            const d = docSnap.data;
            const status = (d.status || 'pending_wali').toLowerCase();
            const requestTime = d.requestTime || '-';
            const reason = d.reason || '-';

            // Status UI
            let statusClass = '';
            let statusIcon = '';
            let statusText = '';
            let actionBtn = '';

            switch (status) {
                case 'pending_wali':
                case 'pending':
                    statusClass = 'bg-yellow-50 border-yellow-200';
                    statusIcon = '<i class="fa-solid fa-clock text-yellow-500"></i>';
                    statusText = '<span class="text-yellow-600 font-bold text-xs">Menunggu ACC Wali Kelas</span>';

                    const waMessage = `Om Swastiastu/Assalamualaikum Bapak/Ibu Wali Kelas ${waliKelasName}, saya ${currentStudent.name} kelas ${currentStudent.class} telah mengajukan permisi. Mohon konfirmasinya. Terima kasih.`;
                    const encodedMsg = encodeURIComponent(waMessage);
                    let waLink = `https://wa.me/?text=${encodedMsg}`;

                    if (waliKelasPhone) {
                        let p = waliKelasPhone.replace(/\D/g, '');
                        if (p.startsWith('0')) p = '62' + p.substring(1);
                        if (!p.startsWith('62')) p = '62' + p;
                        waLink = `https://wa.me/${p}?text=${encodedMsg}`;
                    }

                    actionBtn = `
                        <a href="${waLink}" target="_blank" 
                            class="mb-3 flex items-center justify-center w-full bg-green-500 text-white text-xs font-bold py-2.5 rounded hover:bg-green-600 transition shadow-sm border-b-2 border-green-600 active:border-0 active:translate-y-0.5">
                            <i class="fa-brands fa-whatsapp text-base mr-2"></i> Hubungi Wali Kelas
                        </a>
                        <div class="flex gap-2">
                            <button onclick="openEditModal('${docSnap.id}', '${requestTime}', '${reason.replace(/'/g, "\\'")}')" 
                                class="flex-1 bg-white text-slate-700 text-xs font-bold py-2 rounded border border-slate-200 hover:bg-slate-50 transition shadow-sm">
                                <i class="fa-solid fa-pen mr-1"></i> Edit
                            </button>
                            <button onclick="cancelPermissionRequest('${docSnap.id}')" 
                                class="flex-1 bg-white text-red-600 text-xs font-bold py-2 rounded border border-red-200 hover:bg-red-50 transition shadow-sm">
                                <i class="fa-solid fa-times mr-1"></i> Batalkan
                            </button>
                        </div>
                    `;
                    break;

                case 'wali_approved':
                    statusClass = 'bg-blue-50 border-blue-200';
                    statusIcon = '<i class="fa-solid fa-person-walking-arrow-right text-blue-500"></i>';
                    statusText = '<span class="text-blue-600 font-bold text-xs">Di-ACC Wali Kelas → Ke Guru Piket</span>';
                    actionBtn = `
                        <div class="bg-blue-100/50 rounded p-2 text-center text-xs text-blue-700 font-medium">
                            <i class="fa-solid fa-info-circle mr-1"></i> Silakan temui Guru Piket di lobi untuk izin keluar
                        </div>
                    `;
                    break;

                case 'approved':
                    statusClass = 'bg-green-50 border-green-200';
                    statusIcon = '<i class="fa-solid fa-circle-check text-green-500"></i>';
                    statusText = '<span class="text-green-600 font-bold text-xs">Izin Resmi Disetujui</span>';
                    actionBtn = `
                        <div class="bg-green-100/50 rounded p-2 text-center text-xs text-green-700 font-medium">
                            <i class="fa-solid fa-door-open mr-1"></i> Anda diperbolehkan keluar sekolah
                        </div>
                    `;
                    break;

                case 'wali_rejected':
                case 'rejected':
                    statusClass = 'bg-red-50 border-red-200';
                    statusIcon = '<i class="fa-solid fa-circle-xmark text-red-500"></i>';
                    statusText = '<span class="text-red-600 font-bold text-xs">Pengajuan Ditolak</span>';
                    hasRejected = true;
                    break;
                case 'cancelled':
                    statusClass = 'bg-slate-50 border-slate-200';
                    statusIcon = '<i class="fa-solid fa-ban text-slate-400"></i>';
                    statusText = '<span class="text-slate-500 font-bold text-xs">Dibatalkan</span>';
                    break;
                default:
                    statusClass = 'bg-slate-50 border-slate-200';
                    statusIcon = '<i class="fa-solid fa-question text-slate-400"></i>';
                    statusText = '<span class="text-slate-500 text-xs">' + status + '</span>';
            }

            html += `
                <div class="p-4 rounded-lg border ${statusClass}">
                    <div class="flex items-start gap-3">
                        <div class="w-10 h-10 rounded-full flex items-center justify-center bg-white shadow-sm text-lg">
                            ${statusIcon}
                        </div>
                        <div class="flex-1">
                            <div class="flex justify-between items-start">
                                <div>
                                    <p class="font-bold text-slate-700 text-sm">Jam ${requestTime}</p>
                                    <p class="text-xs text-slate-500 mt-0.5">${window.escapeHTML(reason)}</p>
                                </div>
                                ${statusText}
                            </div>
                            ${actionBtn}
                        </div>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;

        // Tampilkan notifikasi jika ada yang ditolak
        if (hasRejected) {
            notifContainer.innerHTML = `
                <div class="flex items-start gap-2">
                    <i class="fa-solid fa-circle-exclamation text-red-500 mt-0.5"></i>
                    <div>
                        <p class="font-bold text-red-700">Pengajuan Ditolak</p>
                        <p class="text-red-600">Alasan: ${window.escapeHTML(rejectedReason)}</p>
                    </div>
                </div>
            `;
            notifContainer.className = 'mb-4 p-3 rounded-lg text-sm bg-red-50 border border-red-200';
            notifContainer.classList.remove('hidden');
        } else {
            notifContainer.classList.add('hidden');
        }

    } catch (e) {
        console.error("Load Permission Requests Error:", e);
        container.innerHTML = `
            <div class="text-center text-red-500 py-6 text-sm">
                <i class="fa-solid fa-triangle-exclamation mr-2"></i> Gagal memuat data
            </div>
        `;
    }
};

// Submit pengajuan permisi baru
async function submitPermissionRequest(e) {
    e.preventDefault();

    if (!currentStudent || !currentNIS) {
        showPopup("Sesi Tidak Valid", "Silakan login ulang.", "error");
        return;
    }

    const btn = document.getElementById('btn-submit-permisi');
    const dateInput = document.getElementById('permisi-date');
    const timeInput = document.getElementById('permisi-time');
    const reasonInput = document.getElementById('permisi-reason');

    const requestDate = dateInput.value;
    const requestTime = timeInput.value;
    const reason = reasonInput.value.trim();

    // Validasi
    const today = toLocalISODate(new Date());
    if (requestDate !== today) {
        showPopup("Tanggal Tidak Valid", "Pengajuan hanya bisa untuk hari ini.", "warning");
        dateInput.value = today;
        return;
    }

    // Cek jam (harus sebelum 15:30)
    const now = new Date();
    const cutoffTime = new Date();
    cutoffTime.setHours(15, 30, 0, 0);

    if (now >= cutoffTime) {
        showPopup("Batas Waktu Terlewati", "Pengajuan sudah melewati batas waktu (15:30). Silakan ajukan besok.", "warning");
        return;
    }

    if (!reason) {
        showPopup("Alasan Kosong", "Harap isi alasan keperluan izin.", "warning");
        reasonInput.focus();
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Mengirim...';

    try {
        const docId = `${currentNIS}_${Date.now()}`;

        if (cfClient && cfClient.enabled) {
            await cfClient.submitPermisiRequest({
                id: docId,
                student_nis: String(currentNIS),
                student_name: currentStudent.name || '-',
                student_class: currentStudent.class || '-',
                permission_type: 'Izin Keluar',
                reason: reason,
                date: requestDate,
                time_out: requestTime
            });
        }

        if (typeof window.logAudit === 'function') {
            window.logAudit('CREATE_PERMISSION_REQUEST', docId, null, { studentNIS: String(currentNIS), studentName: currentStudent.name, reason, requestTime }, `Siswa ${currentStudent.name} mengajukan permisi: ${reason}`);
        }

        // Reset form
        reasonInput.value = '';
        timeInput.value = toLocalTimeHHMM(new Date());

        // Reload list
        await loadMyPermissionRequests();

        showPopup("Berhasil Dikirim", "Pengajuan permisi berhasil dikirim! Tunggu persetujuan dari wali kelas.", "success");

    } catch (e) {
        console.error("Submit Permission Error:", e);
        showPopup("Gagal Mengirim", "Pengajuan gagal dikirim: " + e.message, "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-paper-plane mr-2"></i> Kirim Pengajuan';
    }
}

// Batalkan pengajuan - langsung eksekusi dengan feedback
window.cancelPermissionRequest = async function (docId) {
    try {
        if (cfClient && cfClient.enabled) {
            await cfClient.deletePermisiRequest(docId);
        }

        if (typeof window.logAudit === 'function') {
            window.logAudit('CANCEL_PERMISSION_REQUEST', docId, null, null, `Siswa membatalkan pengajuan permisi: ${docId}`);
        }

        showPopup("Dibatalkan", "Pengajuan permisi berhasil dibatalkan.", "info");
        await loadMyPermissionRequests();

    } catch (e) {
        console.error("Cancel Permission Error:", e);
        const errMsg = getFriendlyErrorMessage(e, "cancel");
        showPopup("Gagal Membatalkan", errMsg, "error");
    }
};

// Inisialisasi form permisi
function initPermisiForm() {
    const form = document.getElementById('form-permisi-request');
    const dateInput = document.getElementById('permisi-date');
    const timeInput = document.getElementById('permisi-time');

    if (!form) return;

    // Set default values
    const today = new Date();
    const todayStr = toLocalISODate(today);
    dateInput.value = todayStr;
    dateInput.min = todayStr; // Tidak boleh tanggal kemarin
    dateInput.max = todayStr; // Tidak boleh tanggal besok
    timeInput.value = toLocalTimeHHMM(today);

    // Event listener
    form.addEventListener('submit', submitPermissionRequest);
}

// =====================================
// EDIT PERMISSION REQUEST FUNCTIONS
// =====================================

// Buka modal edit permisi
window.openEditModal = function (docId, time, reason) {
    document.getElementById('edit-permisi-id').value = docId;
    document.getElementById('edit-permisi-time').value = time;
    document.getElementById('edit-permisi-reason').value = reason;
    document.getElementById('modal-edit-permisi').classList.remove('hidden');
};

// Tutup modal edit
window.closeEditModal = function () {
    document.getElementById('modal-edit-permisi').classList.add('hidden');
};

// Simpan edit permisi
window.saveEditPermission = async function () {
    const docId = document.getElementById('edit-permisi-id').value;
    const newTime = document.getElementById('edit-permisi-time').value;
    const newReason = document.getElementById('edit-permisi-reason').value.trim();

    if (!newReason) {
        showPopup("Alasan Kosong", "Harap isi alasan keperluan izin.", "warning");
        return;
    }

    try {
        if (cfClient && cfClient.enabled) {
            await cfClient.submitPermisiRequest({
                id: docId,
                student_nis: String(currentNIS),
                student_name: currentStudent?.name || '-',
                student_class: currentStudent?.class || '-',
                permission_type: 'Izin Keluar',
                reason: newReason,
                date: toLocalISODate(new Date()),
                time_out: newTime
            });
        }

        if (typeof window.logAudit === 'function') {
            window.logAudit('UPDATE_PERMISSION_REQUEST', docId, null, { newTime, newReason }, `Siswa mengedit pengajuan permisi: ${docId}`);
        }

        closeEditModal();
        await loadMyPermissionRequests();
        showPopup("Berhasil", "Pengajuan permisi berhasil diperbarui.", "success");

    } catch (e) {
        console.error("Edit Permission Error:", e);
        const errMsg = getFriendlyErrorMessage(e, "edit");
        showPopup("Gagal Menyimpan", errMsg, "error");
    }
};

async function checkPeminatanBanner() {
    const bannerContainer = document.getElementById('dynamic-banners');
    const tabPeminatan = document.getElementById('tab-peminatan');
    if (!bannerContainer) return;

    const hideTab = () => {
        if (tabPeminatan) {
            tabPeminatan.classList.add('hidden');
            tabPeminatan.classList.remove('flex');
        }
    };

    try {
        // 1. Cek apakah Siswa Kelas X (0 READ - Local Check)
        const studentClass = String(currentStudent.class || '').toUpperCase().trim();
        const isKelasX = studentClass.startsWith('X') && !studentClass.startsWith('XI') && !studentClass.startsWith('XII');
        if (!isKelasX) {
            hideTab();
            return;
        }

        // 2. Cek Cache Sesi (0 READ - Memory Check)
        if (sessionStorage.getItem('peminatan_submitted') === 'true') {
            hideTab();
            return;
        }

        // 3. Cek Status Kuesioner & Respon Siswa via Cloudflare D1 API (0 Firestore Read)
        const statusRes = await cfClient.getPeminatanStatus(currentNIS);
        if (!statusRes.isKuesionerActive) {
            hideTab();
            return;
        }
        if (statusRes.hasSubmitted) {
            sessionStorage.setItem('peminatan_submitted', 'true');
            hideTab();
            return;
        }

        // Tampilkan Tab Peminatan di navigasi atas
        if (tabPeminatan) {
            tabPeminatan.classList.remove('hidden');
            tabPeminatan.classList.add('flex');
        }

        // 5. Tampilkan Banner Jika Belum Mengisi
        bannerContainer.innerHTML = `
            <div class="bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-700 rounded-[1.5rem] md:rounded-[2rem] p-5 md:p-8 text-white shadow-xl shadow-indigo-200 dark:shadow-none animate-zoom-in relative overflow-hidden group border border-white/10">
                <!-- Efek Dekorasi Latar Belakang -->
                <div class="absolute -right-12 -top-12 w-48 h-48 bg-white/10 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-1000"></div>
                <div class="absolute -left-12 -bottom-12 w-48 h-48 bg-indigo-400/20 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-1000"></div>
                
                <div class="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
                    <div class="flex items-start md:items-center gap-5">
                        <div class="w-14 h-14 md:w-16 md:h-16 bg-white/20 backdrop-blur-xl rounded-2xl md:rounded-[1.5rem] flex items-center justify-center text-3xl shrink-0 shadow-inner border border-white/20">
                            <i class="fa-solid fa-brain animate-pulse"></i>
                        </div>
                        <div class="space-y-1">
                            <h3 class="font-black text-xl md:text-2xl leading-tight tracking-tight">Tentukan Masa Depanmu!</h3>
                            <p class="text-indigo-100 text-[11px] md:text-sm font-medium leading-relaxed opacity-90">Kuesioner peminatan jurusan sudah dibuka. Yuk, kenali potensi terbaikmu sekarang!</p>
                        </div>
                    </div>
                    <a href="peminatan.html" class="group/btn bg-white text-indigo-700 px-8 py-4 rounded-2xl font-black text-sm shadow-xl hover:bg-indigo-50 hover:shadow-2xl active:scale-95 transition-all text-center flex items-center justify-center gap-2">
                        Mulai Kuesioner 
                        <i class="fa-solid fa-chevron-right text-[10px] group-hover/btn:translate-x-1 transition-transform"></i>
                    </a>
                </div>
            </div>
        `;
    } catch (e) {
        console.warn('[Peminatan] Banner Check Failed:', e);
    }
}

async function checkDutaVotingBanner() {
    const bannerContainer = document.getElementById('dynamic-banners');
    if (!bannerContainer) return;

    try {
        // 1. Ambil config dari session cache (0 READ - Hemat Kuota)
        const cacheKey = SESSION_CACHE_KEYS.SYSTEM_CONFIG;
        let configData = getSessionCache(cacheKey);
        
        if (!configData) {
            configData = await window.getSystemConfig();
            if (configData) {
                setSessionCache(cacheKey, configData);
            } else {
                configData = {};
            }
        }

        // 2. Cek apakah voting aktif
        if (configData.dutaVoting !== true) return;

        // 3. Hubungkan ke Supabase (SSOT)
        if (!supabase) throw new Error('Supabase client belum siap');

        const { count, error } = await supabase
            .from('duta_suara_masuk')
            .select('*', { count: 'exact', head: true })
            .eq('nis_pemilih', String(currentNIS));

        if (error) throw error;

        // Jika siswa sudah mengisi semua (6 kategori), sembunyikan banner/popup sepenuhnya
        if (count !== null && count === 6) {
            console.log(`[Duta Voting] Siswa ${currentNIS} sudah mengisi lengkap. Banner disembunyikan.`);
            return;
        }

        // 4. Tampilkan Banner Voting Duta SHAKTI jika aktif dan belum lengkap
        const bannerId = 'duta-voting-banner';
        if (!document.getElementById(bannerId)) {
            const dutaBanner = document.createElement('div');
            dutaBanner.id = bannerId;
            dutaBanner.className = "bg-gradient-to-br from-violet-600 via-purple-700 to-indigo-700 rounded-[1.5rem] md:rounded-[2rem] p-5 md:p-8 text-white shadow-xl shadow-purple-100 dark:shadow-none animate-zoom-in relative overflow-hidden group border border-white/10 mt-4";
            dutaBanner.innerHTML = `
                <!-- Efek Dekorasi Latar Belakang -->
                <div class="absolute -right-12 -top-12 w-48 h-48 bg-white/10 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-1000"></div>
                <div class="absolute -left-12 -bottom-12 w-48 h-48 bg-purple-400/20 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-1000"></div>
                
                <div class="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
                    <div class="flex items-start md:items-center gap-5">
                        <div class="w-14 h-14 md:w-16 md:h-16 bg-white/20 backdrop-blur-xl rounded-2xl md:rounded-[1.5rem] flex items-center justify-center text-3xl shrink-0 shadow-inner border border-white/20">
                            <i class="fa-solid fa-star text-yellow-300 animate-pulse"></i>
                        </div>
                        <div class="space-y-1">
                            <h3 class="font-black text-xl md:text-2xl leading-tight tracking-tight">Duta CERDAS 2026!</h3>
                            <p class="text-purple-100 text-[11px] md:text-sm font-medium leading-relaxed opacity-90">Pemilihan Duta CERDAS 2026 resmi dibuka. Anda baru mengisi <strong class="text-yellow-300">${count || 0}/6</strong> Kategori. Salurkan suaramu sekarang!</p>
                        </div>
                    </div>
                    <a href="duta/vote.html" class="group/btn bg-white text-purple-700 px-8 py-4 rounded-2xl font-black text-sm shadow-xl hover:bg-purple-50 hover:shadow-2xl active:scale-95 transition-all text-center flex items-center justify-center gap-2">
                        Mulai Memilih
                        <i class="fa-solid fa-chevron-right text-[10px] group-hover/btn:translate-x-1 transition-transform"></i>
                    </a>
                </div>
            `;
            bannerContainer.appendChild(dutaBanner);
        }

        // 5. Tampilkan juga Pop-up Meriah khusus untuk Siswa jika belum mengisi lengkap (selalu muncul setiap login/refresh jika belum lengkap)
        if (count === null || count < 6) {
            showDutaVotingPopupSiswa(count || 0);
        }

    } catch (e) {
        console.warn('[Duta Voting] Banner Check Failed:', e);
    }
}

function showDutaVotingPopupSiswa(completedCount) {
    if (document.getElementById('warning-duta-voting')) return;

    const overlay = document.createElement('div');
    overlay.id = 'warning-duta-voting';
    overlay.className = "fixed inset-0 z-[160] bg-slate-950/80 backdrop-blur-xl flex items-center justify-center p-4 transition-opacity fade-in";

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
            
            <h3 class="font-black text-xl md:text-2xl leading-tight tracking-tight font-outfit text-white">Suara Kamu Sangat Berharga!</h3>
            <p class="text-slate-400 text-xs mt-3 leading-relaxed">
                Halo! Kamu terdeteksi <strong class="text-white">belum menyelesaikan voting</strong> Pemilihan Duta CERDAS 2026. Baru mengisi <strong class="text-yellow-400">${completedCount}/6</strong> Kategori.
            </p>
            <p class="text-purple-300 text-[11px] font-bold mt-2">
                Yuk salurkan suaramu untuk menentukan siswa-siswi terbaik perwakilan sekolah kita!
            </p>

            <div class="mt-8 space-y-3">
                <a href="duta/vote.html" class="w-full bg-gradient-to-r from-yellow-500 via-amber-500 to-yellow-600 hover:from-yellow-600 hover:to-amber-600 text-slate-950 font-black py-4 rounded-2xl shadow-xl shadow-yellow-500/20 transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-2 text-xs">
                    <i class="fa-solid fa-check-to-slot text-sm"></i> MULAI MEMILIH SEKARANG
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

// =========================================================================
// E-SURAT BEBAS PUSTAKA PREVIEW & PRINT
// =========================================================================
window.viewStudentClearanceLetter = function () {
    const data = window.currentStudentClearance;
    if (!data) return;

    const modal = document.getElementById('modal-esurat-bebas-pustaka');
    if (!modal) return;

    document.getElementById('student-esurat-no').textContent = `Nomor: ${data.no_surat}`;
    document.getElementById('student-esurat-name').textContent = data.student_name || currentStudent?.nama || currentStudent?.name || '-';
    document.getElementById('student-esurat-nis').textContent = data.student_nis || currentNIS || '-';
    document.getElementById('student-esurat-class').textContent = data.student_class || currentStudent?.kelas || currentStudent?.class || '-';
    document.getElementById('student-esurat-year').textContent = data.tahun_ajaran || '2025/2026';
    document.getElementById('student-esurat-keperluan').textContent = data.keperluan || 'Pengambilan Ijazah / Kelulusan';
    document.getElementById('student-esurat-date').textContent = `Denpasar, ${data.tgl_terbit || '-'}`;
    document.getElementById('student-esurat-petugas').textContent = data.petugas_nama || "Petugas Perpustakaan SMANTARA";

    modal.classList.remove('hidden');
};

window.printStudentClearanceLetter = function () {
    window.print();
};

// =========================================================================
// FITUR EDIT DATA DIRI SISWA MANDIRI
// =========================================================================
function formatDateForDateInput(raw) {
    if (!raw) return '';
    if (typeof raw === 'object' && raw.toDate) {
        return toISODateString(raw.toDate());
    }
    if (raw instanceof Date) {
        return toISODateString(raw);
    }
    const str = String(raw).trim();
    const ymd = str.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (ymd) {
        return `${ymd[1]}-${String(ymd[2]).padStart(2, '0')}-${String(ymd[3]).padStart(2, '0')}`;
    }
    const dmy = str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
    if (dmy) {
        return `${dmy[3]}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`;
    }
    return '';
}

// =========================================================================
// MODUL PENGARSIPAN DOKUMEN FOTO KARTU KELUARGA (KK) SISWA - GOOGLE DRIVE
// =========================================================================

let _pendingKKUpload = null; // { base64, dataUrl, width, height, approxSizeKb }
let _pendingKKUploadResult = null; // Cache hasil upload Google Drive jika save database D1 perlu retry
let _currentKKUrl = '';
let _currentKKFileId = '';

/**
 * Ekstraksi ID Berkas dari Tautan Google Drive
 */
export function extractGoogleDriveFileId(url) {
    if (!url || typeof url !== 'string') return null;
    const patterns = [
        /\/file\/d\/([a-zA-Z0-9_-]+)/,
        /id=([a-zA-Z0-9_-]+)/,
        /\/d\/([a-zA-Z0-9_-]+)/,
        /\/open\?id=([a-zA-Z0-9_-]+)/,
        /\/uc\?(?:[^&]*&)*id=([a-zA-Z0-9_-]+)/
    ];
    for (const p of patterns) {
        const m = url.match(p);
        if (m && m[1]) return m[1];
    }
    return null;
}

/**
 * Dapatkan URL Thumbnail Google Drive yang dioptimasi
 */
export function getGoogleDriveThumbnail(url) {
    if (!url) return '';
    const fileId = extractGoogleDriveFileId(url);
    if (fileId) {
        return `https://lh3.googleusercontent.com/d/${fileId}=w600`;
    }
    return url;
}

/**
 * Hitung Tahun Ajaran Aktif (SSOT: Juli = Tahun Ajaran Baru)
 * Contoh: 2026-2027
 */
export function getCurrentAcademicYear() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1; // 1-12
    if (month >= 7) {
        return `${year}-${year + 1}`;
    }
    return `${year - 1}-${year}`;
}

/**
 * Kompresi Dokumen Foto KK via HTML5 Canvas Cerdas
 * Resolusi maksimal 1920px (sisi terpanjang), JPEG kualitas 0.82 (82%).
 * Menghasilkan berkas berukuran ~200-400 KB yang tetap sangat tajam dan tabel/angka NIK 16 digit terbaca sempurna.
 */
export function compressKKImageToJpeg(file, maxDimension = 1920, quality = 0.82) {
    return new Promise((resolve, reject) => {
        if (!file || !file.type.startsWith('image/')) {
            return reject(new Error('Berkas yang dipilih bukan berkas gambar yang sah.'));
        }
        const reader = new FileReader();
        reader.onload = (e) => {
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
                // Latar belakang putih solid agar transparan PNG tidak menjadi hitam
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);
                const dataUrl = canvas.toDataURL('image/jpeg', quality);
                const base64 = dataUrl.split(',')[1];
                const approxSizeKb = Math.round((base64.length * 3 / 4) / 1024);
                resolve({ dataUrl, base64, width, height, approxSizeKb });
            };
            img.onerror = () => reject(new Error('Format berkas foto tidak dapat dibaca oleh peramban.'));
            img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error('Gagal membaca berkas foto dari perangkat.'));
        reader.readAsDataURL(file);
    });
}

/**
 * Unggah foto KK ke Google Apps Script Web App sekolah (disimpan ke Google Drive)
 * Hierarki folder: KK-Siswa / {TahunAjaran} / {Kelas}
 * Nama berkas otomatis: KK_{NIS}_{Nama Siswa}.jpg
 */
export async function uploadStudentKKToDrive(base64Data, context = {}) {
    if (!base64Data || typeof base64Data !== 'string') {
        throw new Error('Data gambar foto KK tidak valid atau kosong.');
    }
    const nis = context.nis || currentNIS || currentStudent?.nis || '0000';
    const name = context.name || currentStudent?.name || 'Siswa';
    const kelas = context.class || currentStudent?.class || 'Umum';
    const academicYear = context.academicYear || getCurrentAcademicYear();
    const safeName = name.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'Siswa';
    const safeNis = String(nis).replace(/[^a-zA-Z0-9_-]/g, '').trim() || '0000';
    const fileName = `KK_${safeNis}_${safeName}.jpg`;

    const scriptUrl = STUDENT_DOCS_APPS_SCRIPT_URL;
    if (!scriptUrl) {
        throw new Error('URL Layanan Google Apps Script Dokumen Siswa belum dikonfigurasi.');
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 45000) : null;

    try {
        const response = await fetch(scriptUrl, {
            method: 'POST',
            body: JSON.stringify({
                action: 'upload',
                image: base64Data,
                fileName: fileName,
                nis: safeNis,
                nama: safeName,
                studentName: safeName,
                academicYear: academicYear,
                tahunAjaran: academicYear,
                kelas: kelas,
                className: kelas
            }),
            signal: controller ? controller.signal : undefined
        });
        if (timeoutId) clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`Layanan Google Drive mengembalikan HTTP ${response.status}.`);
        }

        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || 'Gagal mengunggah foto KK ke Google Drive.');
        }
        return result;
    } catch (err) {
        if (timeoutId) clearTimeout(timeoutId);
        if (err.name === 'AbortError' || String(err.message || '').toLowerCase().includes('abort')) {
            throw new Error('Koneksi ke Google Drive memakan waktu terlalu lama (timeout). Silakan periksa jaringan internet dan coba lagi.');
        }
        throw err;
    }
}

/**
 * Hapus foto KK dari Google Drive (fire and forget)
 */
export async function deleteStudentKKFromDrive(fileId) {
    if (!fileId) return;
    const scriptUrl = STUDENT_DOCS_APPS_SCRIPT_URL;
    if (!scriptUrl) return;
    try {
        await fetch(scriptUrl, {
            method: 'POST',
            body: JSON.stringify({
                action: 'delete',
                fileId: fileId
            })
        });
    } catch (e) {
        console.warn('[Portal Siswa] Error menghapus foto KK lama dari Google Drive:', e);
    }
}

/**
 * Sinkronisasi Tampilan Pratinjau KK di Form Modal Edit Profil
 */
export function renderKKPreviewUI(studentData) {
    const s = studentData || currentStudent || {};
    const imgEl = document.getElementById('student-kk-img');
    const placeholderEl = document.getElementById('student-kk-placeholder');
    const badgeEl = document.getElementById('student-kk-status-badge');
    const btnLarge = document.getElementById('btn-view-kk-large');
    const btnGdrive = document.getElementById('btn-open-gdrive-kk');
    const btnDelete = document.getElementById('btn-delete-kk');
    const btnUploadText = document.getElementById('btn-kk-upload-text');
    const infoText = document.getElementById('student-kk-info-text');
    const fileInput = document.getElementById('input-kk-file');
    if (fileInput) fileInput.value = '';

    // Jika ada pending upload baru yang dipilih siswa
    if (_pendingKKUpload) {
        if (imgEl) {
            imgEl.src = _pendingKKUpload.dataUrl;
            imgEl.classList.remove('hidden');
        }
        if (placeholderEl) placeholderEl.classList.add('hidden');
        if (btnLarge) btnLarge.classList.remove('hidden');
        if (btnDelete) btnDelete.classList.remove('hidden');
        if (badgeEl) {
            badgeEl.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200';
            badgeEl.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin mr-1 text-[9px]"></i>Siap Disimpan (~${_pendingKKUpload.approxSizeKb} KB)`;
        }
        if (btnUploadText) btnUploadText.textContent = 'Ganti Foto';
        if (infoText) infoText.textContent = `Foto baru dipilih (~${_pendingKKUpload.approxSizeKb} KB, ${_pendingKKUpload.width}x${_pendingKKUpload.height}px). Klik "Simpan Perubahan" untuk mengunggah ke Google Drive.`;
        return;
    }

    const kkUrl = s.kk_document_url || s.kkUrl || s.kk_file_url || '';
    const kkFileId = s.kk_file_id || s.kkFileId || extractGoogleDriveFileId(kkUrl) || '';
    _currentKKUrl = kkUrl;
    _currentKKFileId = kkFileId;

    if (kkUrl) {
        const thumbUrl = getGoogleDriveThumbnail(kkUrl);
        if (imgEl) {
            imgEl.src = thumbUrl;
            imgEl.classList.remove('hidden');
        }
        if (placeholderEl) placeholderEl.classList.add('hidden');
        if (btnLarge) btnLarge.classList.remove('hidden');
        if (btnGdrive) {
            btnGdrive.href = kkUrl;
            btnGdrive.classList.remove('hidden');
        }
        if (btnDelete) btnDelete.classList.remove('hidden');
        if (btnUploadText) btnUploadText.textContent = 'Ganti Foto KK';
        if (badgeEl) {
            badgeEl.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200';
            badgeEl.innerHTML = `<i class="fa-solid fa-circle-check mr-1 text-[9px]"></i>Tersimpan di Drive`;
        }
        const fileNameStr = s.kk_file_name || `KK_${s.nis || ''}_${s.name || ''}.jpg`;
        const dateStr = s.kk_uploaded_at ? new Date(s.kk_uploaded_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
        if (infoText) infoText.textContent = `Berkas: ${fileNameStr}${dateStr ? ' • Diunggah: ' + dateStr : ''} (Tersimpan di Google Drive sekolah)`;
    } else {
        if (imgEl) {
            imgEl.src = '';
            imgEl.classList.add('hidden');
        }
        if (placeholderEl) placeholderEl.classList.remove('hidden');
        if (btnLarge) btnLarge.classList.add('hidden');
        if (btnGdrive) btnGdrive.classList.add('hidden');
        if (btnDelete) btnDelete.classList.add('hidden');
        if (btnUploadText) btnUploadText.textContent = 'Pilih Foto KK';
        if (badgeEl) {
            badgeEl.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200';
            badgeEl.textContent = 'Belum Diunggah';
        }
        if (infoText) infoText.textContent = 'Format JPG, PNG, atau WebP. Tersimpan otomatis dalam folder tahun ajaran & kelas selama masa studi (~3 tahun).';
    }
}

/**
 * Sinkronisasi Status KK di Panel Rincian Smart Pass Hub di samping kartu digital
 */
export function updateHubKKStatus(student) {
    const hubContainer = document.getElementById('student-hub-kk-container');
    const hubStatus = document.getElementById('student-hub-kk-status');
    if (!hubContainer || !hubStatus) return;

    const s = student || currentStudent || {};
    const kkUrl = s.kk_document_url || s.kkUrl || s.kk_file_url;
    if (kkUrl) {
        hubContainer.innerHTML = `
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <i class="fa-solid fa-circle-check text-[9px]"></i> Terunggah
            </span>
            <button type="button" onclick="window.openKKPreviewModal()" class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 text-blue-600 hover:bg-blue-100 transition cursor-pointer">
                Lihat KK
            </button>
        `;
    } else {
        hubContainer.innerHTML = `
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200">
                Belum Ada
            </span>
            <button type="button" onclick="window.openEditProfileModal()" class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 transition cursor-pointer">
                Upload
            </button>
        `;
    }
}

/**
 * Handler Pemilihan Berkas Foto KK
 */
window.handleKKFileSelect = async function (e) {
    const file = e.target?.files?.[0];
    if (!file) return;

    // Guard ukuran file sebelum diproses ke RAM (Maksimal 15 MB)
    const MAX_FILE_SIZE = 15 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
        alert('Ukuran berkas terlalu besar (maksimal 15 MB). Silakan pilih foto dengan ukuran lebih kecil.');
        if (e.target) e.target.value = '';
        return;
    }

    const progressEl = document.getElementById('student-kk-uploading-progress');
    const progressText = document.getElementById('student-kk-progress-text');
    if (progressEl) progressEl.classList.remove('hidden');
    if (progressText) progressText.textContent = 'Mengompresi foto Kartu Keluarga (maks 1920px)...';

    try {
        const compressed = await compressKKImageToJpeg(file, 1920, 0.82);
        _pendingKKUpload = compressed;
        _pendingKKUploadResult = null; // Reset hasil upload sebelumnya jika user memilih file baru
        renderKKPreviewUI(currentStudent);
    } catch (err) {
        console.error('[Portal Siswa] Error kompresi KK:', err);
        alert(err.message || 'Gagal memproses foto KK.');
    } finally {
        if (progressEl) progressEl.classList.add('hidden');
    }
};

/**
 * Handler Buka Modal Pratinjau KK
 */
window.openKKPreviewModal = function () {
    const modal = document.getElementById('modal-preview-kk');
    const imgEl = document.getElementById('modal-preview-kk-img');
    const titleEl = document.getElementById('modal-preview-kk-title');
    const subtitleEl = document.getElementById('modal-preview-kk-subtitle');
    const driveLinkEl = document.getElementById('modal-preview-kk-drivelink');
    const metaEl = document.getElementById('modal-preview-kk-meta');
    if (!modal) return;

    const s = currentStudent || {};
    const displayUrl = _pendingKKUpload ? _pendingKKUpload.dataUrl : (_currentKKUrl ? getGoogleDriveThumbnail(_currentKKUrl) : '');
    const originalDriveUrl = _currentKKUrl || '#';

    if (imgEl) imgEl.src = displayUrl;
    if (titleEl) titleEl.textContent = `Kartu Keluarga • ${s.name || 'Siswa'}`;
    if (subtitleEl) subtitleEl.textContent = `NIS: ${s.nis || '-'} • Rombel: ${s.class || '-'}`;
    if (driveLinkEl) {
        driveLinkEl.href = originalDriveUrl;
        if (!_currentKKUrl) {
            driveLinkEl.classList.add('hidden');
        } else {
            driveLinkEl.classList.remove('hidden');
        }
    }
    const folderStr = s.kk_drive_folder || `KK-Siswa/${getCurrentAcademicYear()}/${s.class || 'Umum'}`;
    if (metaEl) metaEl.textContent = `Folder: ${folderStr}`;

    modal.classList.remove('hidden');
};

/**
 * Handler Tutup Modal Pratinjau KK
 */
window.closeKKPreviewModal = function () {
    const modal = document.getElementById('modal-preview-kk');
    if (modal) modal.classList.add('hidden');
};

/**
 * Handler Hapus Foto KK
 */
window.deleteKKPhoto = async function () {
    if (_pendingKKUpload) {
        _pendingKKUpload = null;
        _pendingKKUploadResult = null;
        renderKKPreviewUI(currentStudent);
        return;
    }

    if (!confirm('Apakah Anda yakin ingin menghapus foto Kartu Keluarga yang tersimpan di Google Drive?')) {
        return;
    }

    const btnDelete = document.getElementById('btn-delete-kk');
    const origBtnHTML = btnDelete ? btnDelete.innerHTML : '';
    if (btnDelete) {
        btnDelete.disabled = true;
        btnDelete.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> Menghapus...`;
    }

    const fileIdToDelete = _currentKKFileId;
    const prevUrl = _currentKKUrl;
    const prevFileId = _currentKKFileId;
    const targetNis = String(currentStudent?.nis || currentNIS || sessionStorage.getItem('student_nis') || '').trim();

    if (!targetNis) {
        if (btnDelete) {
            btnDelete.disabled = false;
            btnDelete.innerHTML = origBtnHTML;
        }
        alert('Identitas siswa tidak ditemukan.');
        return;
    }

    const cleanUpdates = {
        kk_document_url: '',
        kk_file_id: '',
        kk_uploaded_at: '',
        kk_file_name: '',
        kk_drive_folder: ''
    };

    try {
        if (cfClient && cfClient.enabled) {
            await cfClient.saveStudent({ ...cleanUpdates, nis: targetNis }, true);
        }
        _currentKKUrl = '';
        _currentKKFileId = '';
        _pendingKKUpload = null;
        _pendingKKUploadResult = null;

        currentStudent = { ...currentStudent, ...cleanUpdates, nis: targetNis };
        sessionStorage.setItem('student_data', JSON.stringify(currentStudent));
        renderKKPreviewUI(currentStudent);
        updateHubKKStatus(currentStudent);

        if (fileIdToDelete) {
            deleteStudentKKFromDrive(fileIdToDelete);
        }

        if (typeof showPopup === 'function') {
            showPopup("Foto KK Dihapus", "Foto Kartu Keluarga berhasil dihapus dari sistem.", "info");
        } else {
            alert('Foto Kartu Keluarga berhasil dihapus.');
        }
    } catch (e) {
        console.error('[Portal Siswa] Gagal menghapus foto KK:', e);
        // Rollback state memori jika save database gagal
        _currentKKUrl = prevUrl;
        _currentKKFileId = prevFileId;
        renderKKPreviewUI(currentStudent);
        const errMsg = e.message || 'Kesalahan sistem saat menghapus data.';
        if (typeof showPopup === 'function') {
            showPopup("Gagal Menghapus", errMsg, "error");
        } else {
            alert('Gagal menghapus foto KK: ' + errMsg);
        }
    } finally {
        if (btnDelete) {
            btnDelete.disabled = false;
            btnDelete.innerHTML = origBtnHTML;
        }
    }
};

window.openEditProfileModal = async function () {
    const modal = document.getElementById('modal-edit-profile-siswa');
    if (!modal) return;

    let s = currentStudent;
    if (!s) {
        const cachedDataStr = sessionStorage.getItem('student_data');
        if (cachedDataStr) {
            try {
                s = JSON.parse(cachedDataStr);
                currentStudent = s;
            } catch (_) {}
        }
    }

    if (!s) {
        const nisToFind = currentNIS || sessionStorage.getItem('student_nis');
        if (nisToFind) {
            try {
                const studentResult = await findStudentByNIS(nisToFind);
                if (studentResult) {
                    s = { id: studentResult.id, ...studentResult.data };
                    currentStudent = s;
                }
            } catch (e) {
                console.warn('[Portal] Gagal memuat data siswa untuk modal edit:', e);
            }
        }
    }

    if (!s) {
        if (typeof showPopup === 'function') {
            showPopup("Data Belum Siap", "Data profil siswa sedang dimuat, silakan coba sesaat lagi.", "warning");
        } else {
            alert("Data profil sedang dimuat, silakan coba beberapa saat lagi.");
        }
        return;
    }

    const setInput = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = (val !== undefined && val !== null) ? val : '';
    };

    // A. Identitas Resmi Terkunci (Hak Sekolah)
    setInput('student-edit-nis', s.nis || currentNIS || sessionStorage.getItem('student_nis'));
    setInput('student-edit-nisn', s.nisn || '-');
    setInput('student-edit-class', s.class || '-');
    setInput('student-edit-name', s.name || '-');
    const genderText = (String(s.gender || '').toUpperCase() === 'P' || String(s.gender || '').toLowerCase() === 'perempuan') ? 'Perempuan (P)' : 'Laki-laki (L)';
    setInput('student-edit-gender', genderText);

    // B. Biodata Pribadi Siswa
    setInput('student-edit-agama', s.agama);
    setInput('student-edit-birthplace', s.birthPlace || s.tempat_lahir);
    setInput('student-edit-birthdate', formatDateForDateInput(s.birthDate || s.tgl_lahir));
    setInput('student-edit-nik', s.nik);
    setInput('student-edit-kk', s.kk_no || s.kkNumber || s.no_kk);
    setInput('student-edit-child-order', s.child_order || s.childOrder || s.anak_ke);
    setInput('student-edit-jml-saudara', s.jml_saudara_kandung);
    setInput('student-edit-no-akta', s.no_akta_lahir);
    setInput('student-edit-sekolah-asal', s.sekolah_asal);

    // C. Kontak Siswa
    setInput('student-edit-phone-siswa', s.phone_siswa || s.phone_student || s.phone || s.hp_siswa);
    setInput('student-edit-email-siswa', s.email_siswa || s.email);

    // D. Alamat Domisili & Transportasi
    setInput('student-edit-alamat', s.alamat || s.address);
    setInput('student-edit-dusun', s.dusun);
    setInput('student-edit-kelurahan', s.kelurahan || s.desa);
    setInput('student-edit-kecamatan', s.kecamatan);
    setInput('student-edit-kode-pos', s.kode_pos);
    setInput('student-edit-jenis-tinggal', s.jenis_tinggal);
    setInput('student-edit-transportasi', s.alat_transportasi);
    setInput('student-edit-jarak-sekolah', s.jarak_sekolah_km);

    // E. Data Ayah Kandung
    setInput('student-edit-father', s.father || s.fatherName || s.nama_ayah);
    setInput('student-edit-father-nik', s.father_nik);
    setInput('student-edit-father-phone', s.father_phone || s.phone_parent || s.parentPhone);
    setInput('student-edit-father-birth-year', s.father_birth_year);
    setInput('student-edit-father-education', s.father_education);
    setInput('student-edit-father-job', s.father_job);
    setInput('student-edit-father-income', s.father_income);

    // F. Data Ibu Kandung
    setInput('student-edit-mother', s.mother || s.motherName || s.nama_ibu);
    setInput('student-edit-mother-nik', s.mother_nik);
    setInput('student-edit-mother-phone', s.mother_phone);
    setInput('student-edit-mother-birth-year', s.mother_birth_year);
    setInput('student-edit-mother-education', s.mother_education);
    setInput('student-edit-mother-job', s.mother_job);
    setInput('student-edit-mother-income', s.mother_income);

    // G. Data Wali Murid
    setInput('student-edit-guardian', s.guardian);
    setInput('student-edit-guardian-nik', s.guardian_nik);
    setInput('student-edit-guardian-phone', s.guardian_phone);
    setInput('student-edit-guardian-birth-year', s.guardian_birth_year);
    setInput('student-edit-guardian-education', s.guardian_education);
    setInput('student-edit-guardian-job', s.guardian_job);
    setInput('student-edit-guardian-income', s.guardian_income);

    // H. Data Fisik & Periodik
    setInput('student-edit-berat-badan', s.berat_badan);
    setInput('student-edit-tinggi-badan', s.tinggi_badan);
    setInput('student-edit-lingkar-kepala', s.lingkar_kepala);

    // I. Dokumen Foto Kartu Keluarga (KK)
    _pendingKKUpload = null;
    _pendingKKUploadResult = null;
    renderKKPreviewUI(s);

    modal.classList.remove('hidden');
};

window.closeEditProfileModal = function () {
    const modal = document.getElementById('modal-edit-profile-siswa');
    if (modal) modal.classList.add('hidden');
};

function initStudentProfileEditForm() {
    const form = document.getElementById('form-edit-profile-siswa');
    if (!form || form.dataset.initialized === 'true') return;
    form.dataset.initialized = 'true';

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btnSave = document.getElementById('btn-save-profile-siswa');
        const origBtnHTML = btnSave ? btnSave.innerHTML : 'Simpan Perubahan';

        try {
            if (btnSave) {
                btnSave.disabled = true;
                btnSave.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Menyimpan...`;
            }

            const getVal = (id) => (document.getElementById(id)?.value || '').trim();
            const cleanIdNumber = (val) => String(val || '').replace(/[\s\-_.]/g, '').trim();
            const cleanPhone = (val) => String(val || '').replace(/[^\d+]/g, '').trim();

            const fatherPhone = cleanPhone(getVal('student-edit-father-phone'));
            const motherPhone = cleanPhone(getVal('student-edit-mother-phone'));
            const guardianPhone = cleanPhone(getVal('student-edit-guardian-phone'));
            const studentPhone = cleanPhone(getVal('student-edit-phone-siswa'));
            const emailSiswa = getVal('student-edit-email-siswa').toLowerCase();

            // Sanitasi nomor identitas kependudukan (buang spasi/strip/titik)
            const nikClean = cleanIdNumber(getVal('student-edit-nik'));
            const kkClean = cleanIdNumber(getVal('student-edit-kk'));
            const fatherNikClean = cleanIdNumber(getVal('student-edit-father-nik'));
            const motherNikClean = cleanIdNumber(getVal('student-edit-mother-nik'));
            const guardianNikClean = cleanIdNumber(getVal('student-edit-guardian-nik'));

            // Whitelist payload: Name, NISN, Note, NIS, Class, Tanggal Lahir, Gender, dan Status DILARANG masuk ke payload updates siswa mandiri
            const updates = {
                agama: getVal('student-edit-agama'),
                birthPlace: getVal('student-edit-birthplace'),
                nik: nikClean,
                kk_no: kkClean,
                no_kk: kkClean,
                kkNumber: kkClean,
                child_order: getVal('student-edit-child-order'),
                jml_saudara_kandung: getVal('student-edit-jml-saudara'),
                no_akta_lahir: getVal('student-edit-no-akta'),
                sekolah_asal: getVal('student-edit-sekolah-asal'),
                phone_siswa: studentPhone,
                email_siswa: emailSiswa,
                email: emailSiswa,
                alamat: getVal('student-edit-alamat'),
                dusun: getVal('student-edit-dusun'),
                kelurahan: getVal('student-edit-kelurahan'),
                kecamatan: getVal('student-edit-kecamatan'),
                kode_pos: getVal('student-edit-kode-pos'),
                jenis_tinggal: getVal('student-edit-jenis-tinggal'),
                alat_transportasi: getVal('student-edit-transportasi'),
                jarak_sekolah_km: getVal('student-edit-jarak-sekolah'),
                father: getVal('student-edit-father'),
                father_nik: fatherNikClean,
                father_phone: fatherPhone,
                phone_parent: fatherPhone,
                father_birth_year: getVal('student-edit-father-birth-year'),
                father_education: getVal('student-edit-father-education'),
                father_job: getVal('student-edit-father-job'),
                father_income: getVal('student-edit-father-income'),
                mother: getVal('student-edit-mother'),
                mother_nik: motherNikClean,
                mother_phone: motherPhone,
                mother_birth_year: getVal('student-edit-mother-birth-year'),
                mother_education: getVal('student-edit-mother-education'),
                mother_job: getVal('student-edit-mother-job'),
                mother_income: getVal('student-edit-mother-income'),
                guardian: getVal('student-edit-guardian'),
                guardian_nik: guardianNikClean,
                guardian_phone: guardianPhone,
                guardian_birth_year: getVal('student-edit-guardian-birth-year'),
                guardian_education: getVal('student-edit-guardian-education'),
                guardian_job: getVal('student-edit-guardian-job'),
                guardian_income: getVal('student-edit-guardian-income'),
                berat_badan: getVal('student-edit-berat-badan'),
                tinggi_badan: getVal('student-edit-tinggi-badan'),
                lingkar_kepala: getVal('student-edit-lingkar-kepala'),
                updatedAt: new Date().toISOString()
            };

            // Validasi format NIK/KK & keunikan dengan mode parsial/edit (tidak wajib lengkap 16 digit jika belum ada)
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
                throw new Error(idValidation.message);
            }

            // Otoritatif target NIS (prioritaskan NIS angka, bukan ID dokumen Firestore acak)
            const targetNis = String(currentStudent?.nis || currentNIS || sessionStorage.getItem('student_nis') || currentStudent?.id || '').trim();
            if (!targetNis) {
                throw new Error('Identitas NIS siswa tidak ditemukan. Silakan muat ulang halaman atau login kembali.');
            }

            // Unggah foto KK ke Google Drive jika ada berkas baru yang dipilih atau ada hasil upload tertunda
            if (_pendingKKUpload) {
                let uploadRes = _pendingKKUploadResult;
                if (!uploadRes) {
                    const academicYear = getCurrentAcademicYear();
                    const progressEl = document.getElementById('student-kk-uploading-progress');
                    const progressText = document.getElementById('student-kk-progress-text');
                    if (progressEl) progressEl.classList.remove('hidden');
                    if (progressText) progressText.textContent = 'Mengunggah foto Kartu Keluarga ke Google Drive sekolah...';

                    try {
                        uploadRes = await uploadStudentKKToDrive(_pendingKKUpload.base64, {
                            nis: targetNis,
                            name: currentStudent?.name,
                            class: currentStudent?.class,
                            academicYear: academicYear
                        });
                        _pendingKKUploadResult = uploadRes;
                    } catch (uploadErr) {
                        console.error('[Portal Siswa] Upload KK Gagal:', uploadErr);
                        const isTimeout = uploadErr.name === 'AbortError' || String(uploadErr.message || '').toLowerCase().includes('abort');
                        const friendlyUploadErr = isTimeout
                            ? 'Koneksi ke Google Drive memakan waktu terlalu lama (timeout). Silakan periksa jaringan internet Anda dan coba lagi.'
                            : (uploadErr.message || 'Gagal mengunggah foto KK ke Google Drive.');
                        throw new Error(friendlyUploadErr);
                    } finally {
                        if (progressEl) progressEl.classList.add('hidden');
                    }
                }

                if (uploadRes) {
                    const oldFileId = currentStudent?.kk_file_id;
                    if (oldFileId && oldFileId !== uploadRes.fileId) {
                        deleteStudentKKFromDrive(oldFileId);
                    }

                    updates.kk_document_url = uploadRes.url;
                    updates.kk_file_id = uploadRes.fileId;
                    updates.kk_uploaded_at = uploadRes.uploadedAt || new Date().toISOString();
                    updates.kk_file_name = uploadRes.name;
                    updates.kk_drive_folder = uploadRes.folderPath;
                }
            }

            // Eksekusi update langsung ke Cloudflare D1 (Master Tunggal SSOT)
            if (cfClient && cfClient.enabled) {
                await cfClient.saveStudent({ ...updates, nis: targetNis }, true);
            }

            // Update in-memory state & session storage
            currentStudent = {
                ...currentStudent,
                ...updates,
                nis: targetNis,
                updatedAt: new Date().toISOString()
            };
            sessionStorage.setItem('student_data', JSON.stringify(currentStudent));
            sessionStorage.setItem('student_nis', targetNis);

            // Reset pending upload hanya setelah penyimpanan DB berhasil 100%
            _pendingKKUpload = null;
            _pendingKKUploadResult = null;

            // Invalidate cache global browser jika tersedia
            if (typeof window.invalidateStudentsCache === 'function') {
                try { window.invalidateStudentsCache(); } catch (_) {}
            }

            // Re-render Smart Pass Hub & KTS jika elemen aktif di halaman
            try {
                if (typeof renderKtsInteractiveCard === 'function' && document.getElementById('student-card-3d')) {
                    renderKtsInteractiveCard('student-card-3d', currentStudent, { qrId: 'kts-front-qr-box' });
                }
                const hubTtlGender = document.getElementById('student-hub-ttl-gender');
                if (hubTtlGender && (currentStudent.birthDate || currentStudent.birthPlace)) {
                    const studentTtl = (currentStudent.birthPlace ? currentStudent.birthPlace + ', ' : '') + (typeof formatBirthDateIndo === 'function' ? formatBirthDateIndo(currentStudent.birthDate) : (currentStudent.birthDate || '-'));
                    const rawGender = String(currentStudent.gender || '').toUpperCase();
                    const genderLabel = rawGender.startsWith('L') ? 'Laki-laki' : (rawGender.startsWith('P') ? 'Perempuan' : '-');
                    hubTtlGender.textContent = `${studentTtl} • ${genderLabel}`;
                }
            } catch (syncErr) {
                console.warn('[Portal Siswa] Error refreshing card UI:', syncErr);
            }

            // Sinkronisasi status pratinjau KK dan Smart Pass Hub
            try {
                renderKKPreviewUI(currentStudent);
                updateHubKKStatus(currentStudent);
            } catch (kkSyncErr) {
                console.warn('[Portal Siswa] Error refreshing KK status UI:', kkSyncErr);
            }

            // Tutup modal
            window.closeEditProfileModal();

            // Beri notifikasi popup sukses
            if (typeof showPopup === 'function') {
                showPopup("Data Berhasil Disimpan", "Biodata diri dan foto KK Anda telah berhasil disimpan ke sistem.", "success");
            } else {
                alert("Data diri dan foto KK berhasil disimpan!");
            }

        } catch (err) {
            console.error('[Portal Siswa] Gagal memperbarui profil siswa:', err);
            const errMsg = (typeof getFriendlyErrorMessage === 'function') ? getFriendlyErrorMessage(err) : err.message;
            if (typeof showPopup === 'function') {
                showPopup("Gagal Menyimpan", errMsg || "Terjadi kesalahan saat menyimpan data profil.", "error");
            } else {
                alert("Gagal menyimpan: " + (errMsg || err.message));
            }
        } finally {
            if (btnSave) {
                btnSave.disabled = false;
                btnSave.innerHTML = origBtnHTML;
            }
        }
    });
}

// Inisialisasi awal saat script termuat
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStudentProfileEditForm);
} else {
    initStudentProfileEditForm();
}

// =========================================================================
// MODAL: OPAC BUKU PERPUSTAKAAN (POPUP HANDLER)
// =========================================================================
window.openOpacModal = function () {
    const modal = document.getElementById('modal-opac-popup');
    const iframe = document.getElementById('opac-modal-iframe');
    const loader = document.getElementById('opac-iframe-loading');
    if (!modal || !iframe) return;

    if (loader) loader.classList.remove('hidden');

    if (!iframe.src || !iframe.src.includes('mode=popup')) {
        iframe.src = 'library/opac.html?mode=popup&v=' + Date.now();
        iframe.onload = () => {
            if (loader) loader.classList.add('hidden');
        };
    } else {
        if (loader) loader.classList.add('hidden');
    }

    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
};

window.closeOpacModal = function () {
    const modal = document.getElementById('modal-opac-popup');
    if (modal) modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
};

window.refreshOpacIframe = function () {
    const iframe = document.getElementById('opac-modal-iframe');
    const loader = document.getElementById('opac-iframe-loading');
    if (iframe) {
        if (loader) loader.classList.remove('hidden');
        iframe.src = 'library/opac.html?mode=popup&t=' + Date.now();
        iframe.onload = () => {
            if (loader) loader.classList.add('hidden');
        };
    }
};

// Listen message from iframe child for modal close signal
window.addEventListener('message', (e) => {
    if (e.data && e.data.action === 'close-opac-modal') {
        window.closeOpacModal();
    }
});

// Shortcut Escape key to close OPAC modal
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const opacModal = document.getElementById('modal-opac-popup');
        if (opacModal && !opacModal.classList.contains('hidden')) {
            window.closeOpacModal();
        }
        const resModal = document.getElementById('modal-student-resource');
        if (resModal && !resModal.classList.contains('hidden')) {
            window.closeStudentResourceModal();
        }
        const readModal = document.getElementById('modal-student-read-material');
        if (readModal && !readModal.classList.contains('hidden')) {
            window.closeStudentReadMaterialModal();
        }
        const discModal = document.getElementById('modal-student-lms-discussion');
        if (discModal && !discModal.classList.contains('hidden')) {
            window.closeStudentLmsDiscussion();
        }
    }
});

// =========================================================================
// SECTION: LOGIKA MODUL LMS SISWA (CLOUDFLARE D1 SERVERLESS SQL)
// =========================================================================

let studentLmsRawData = { topics: [], materials: [] };
let studentLmsClockOffset = 0;
let studentLmsScheduleTimer = null;

function applyStudentLmsSchedule(raw) {
    const now = Date.now() + studentLmsClockOffset;
    clearTimeout(studentLmsScheduleTimer);
    let nextBoundary = Infinity;
    raw.materials = (raw.materials || []).map(material => {
        const schedule = getLmsScheduleState(material, now);
        for (const time of [schedule.opensAt, schedule.closesAt]) {
            const boundary = Date.parse(time);
            if (boundary > now) nextBoundary = Math.min(nextBoundary, boundary);
        }
        if (material.reading_mode === 'external' && material.is_opened && material.reading_complete === false && material.reading_remaining_seconds > 0) {
            nextBoundary = Math.min(nextBoundary, now + material.reading_remaining_seconds * 1000);
        }
        return {
            ...material,
            schedule_state: schedule.state,
            is_locked: Boolean(material.is_locked || !schedule.isAccessible),
            is_teaching_completed: schedule.teachingCompleted ? 1 : material.is_teaching_completed,
            teaching_completed_at: schedule.teachingCompleted ? schedule.cutoffAt : material.teaching_completed_at,
            teaching_status_source: schedule.teachingSource,
            unlock_reason: schedule.message || material.unlock_reason || ''
        };
    });
    if (Number.isFinite(nextBoundary)) {
        studentLmsScheduleTimer = setTimeout(() => {
            // Crossing the target changes teaching status; it does not destroy
            // an open HTML exercise, reading position, discussion draft or quiz.
            processAndRenderStudentLms(raw);
            void loadStudentLmsData(true);
        }, Math.min(2147483647, Math.max(50, nextBoundary - now + 50)));
    }
}
let studentLmsSubjects = [];
let studentLmsActiveSubject = '';
let studentLmsStatusFilter = 'pending';
let studentLmsCourseSubTab = 'silabus';
let studentLmsOpenTopics = new Map();
let studentLmsCompletedSections = new Set();
let studentLmsLoadSequence = 0;
let studentLmsLastRefresh = 0;
let currentReaderFontSize = 14;
let activeStudentDiscussionMaterialId = null;
let activeStudentReplyingTo = null;
let currentStudentLmsCommentsMap = new Map();

/**
 * 20+ Gradasi Warna Dinamis & Ikon Tematik Berdasarkan Mata Pelajaran (SSOT)
 */
const LMS_FALLBACK_PALETTES = [
    { bg: 'from-blue-600 to-indigo-900', gradientStart: '#2563eb', gradientEnd: '#1e1b4b', border: 'border-blue-500/30', badge: 'bg-white/20 text-white', icon: 'fa-book-open' },
    { bg: 'from-emerald-600 to-teal-700', gradientStart: '#059669', gradientEnd: '#0f766e', border: 'border-emerald-500/30', badge: 'bg-white/20 text-white', icon: 'fa-book-bookmark' },
    { bg: 'from-purple-600 to-indigo-900', gradientStart: '#9333ea', gradientEnd: '#312e81', border: 'border-purple-500/30', badge: 'bg-white/20 text-white', icon: 'fa-graduation-cap' },
    { bg: 'from-amber-500 to-orange-700', gradientStart: '#d97706', gradientEnd: '#9a3412', border: 'border-amber-500/30', badge: 'bg-white/20 text-white', icon: 'fa-shapes' },
    { bg: 'from-rose-600 to-pink-700', gradientStart: '#e11d48', gradientEnd: '#881337', border: 'border-rose-500/30', badge: 'bg-white/20 text-white', icon: 'fa-certificate' },
    { bg: 'from-cyan-600 to-blue-700', gradientStart: '#0891b2', gradientEnd: '#1e3a8a', border: 'border-cyan-500/30', badge: 'bg-white/20 text-white', icon: 'fa-lightbulb' },
    { bg: 'from-violet-600 to-purple-800', gradientStart: '#7c3aed', gradientEnd: '#4c1d95', border: 'border-violet-500/30', badge: 'bg-white/20 text-white', icon: 'fa-award' },
    { bg: 'from-teal-600 to-emerald-900', gradientStart: '#0d9488', gradientEnd: '#064e3b', border: 'border-teal-500/30', badge: 'bg-white/20 text-white', icon: 'fa-compass' },
    { bg: 'from-indigo-600 to-purple-800', gradientStart: '#4f46e5', gradientEnd: '#3b0764', border: 'border-indigo-500/30', badge: 'bg-white/20 text-white', icon: 'fa-school' },
    { bg: 'from-red-600 to-rose-600', gradientStart: '#dc2626', gradientEnd: '#9f1239', border: 'border-red-500/30', badge: 'bg-white/20 text-white', icon: 'fa-book' },
    { bg: 'from-green-600 to-emerald-900', gradientStart: '#16a34a', gradientEnd: '#064e3b', border: 'border-green-500/30', badge: 'bg-white/20 text-white', icon: 'fa-seedling' },
    { bg: 'from-sky-600 to-indigo-700', gradientStart: '#0284c7', gradientEnd: '#3730a3', border: 'border-sky-500/30', badge: 'bg-white/20 text-white', icon: 'fa-brain' },
    { bg: 'from-amber-600 to-yellow-600', gradientStart: '#d97706', gradientEnd: '#713f12', border: 'border-amber-500/30', badge: 'bg-white/20 text-white', icon: 'fa-puzzle-piece' },
    { bg: 'from-blue-700 to-slate-900', gradientStart: '#1d4ed8', gradientEnd: '#0f172a', border: 'border-blue-600/30', badge: 'bg-white/20 text-white', icon: 'fa-pen-nib' },
    { bg: 'from-slate-800 to-indigo-900', gradientStart: '#334155', gradientEnd: '#1e1b4b', border: 'border-slate-600/30', badge: 'bg-white/20 text-white', icon: 'fa-layer-group' },
    { bg: 'from-slate-800 to-slate-950', gradientStart: '#1e293b', gradientEnd: '#020617', border: 'border-slate-700/30', badge: 'bg-white/20 text-white', icon: 'fa-folder-open' }
];

const LMS_GRADIENTS = LMS_FALLBACK_PALETTES;

function getSubjectTheme(subjectName, fallbackIndex = 0) {
    const raw = String(subjectName || '').toLowerCase().trim();

    // 1. Matematika (Prioritas: VIBRANT PURPLE / UNGU ELEKTRIK - Berbeda kontras dengan Bahasa Indonesia yang BIRU)
    if (/matematika/i.test(raw)) {
        if (/lanjut/i.test(raw)) {
            return {
                bg: 'from-violet-600 to-purple-800',
                gradientStart: '#7c3aed',
                gradientEnd: '#4c1d95',
                border: 'border-violet-500/30',
                badge: 'bg-white/20 text-white',
                icon: 'fa-square-root-variable'
            };
        }
        return {
            bg: 'from-purple-600 to-indigo-900',
            gradientStart: '#9333ea',
            gradientEnd: '#312e81',
            border: 'border-purple-500/30',
            badge: 'bg-white/20 text-white',
            icon: 'fa-calculator'
        };
    }

    // 2. Sains Eksakta (Kimia: Hijau Zamrud/Teal, Biologi: Hijau Daun/Forest, Fisika: Cobalt Cyan)
    if (/kimia/i.test(raw)) {
        return {
            bg: 'from-teal-600 to-emerald-900',
            gradientStart: '#0d9488',
            gradientEnd: '#064e3b',
            border: 'border-teal-500/30',
            badge: 'bg-white/20 text-white',
            icon: 'fa-flask-vial'
        };
    }
    if (/biologi/i.test(raw)) {
        return {
            bg: 'from-emerald-600 to-emerald-900',
            gradientStart: '#16a34a',
            gradientEnd: '#064e3b',
            border: 'border-emerald-500/30',
            badge: 'bg-white/20 text-white',
            icon: 'fa-dna'
        };
    }
    if (/fisika/i.test(raw)) {
        return {
            bg: 'from-cyan-600 to-blue-700',
            gradientStart: '#0891b2',
            gradientEnd: '#1e3a8a',
            border: 'border-cyan-500/30',
            badge: 'bg-white/20 text-white',
            icon: 'fa-atom'
        };
    }

    // 3. Bahasa & Sastra
    // Bahasa Indonesia: Classic Royal Blue / Biru Samudera
    if (/bahasa indonesia|b\.?\s*indo/i.test(raw)) {
        if (/lanjut/i.test(raw)) {
            return {
                bg: 'from-blue-700 to-slate-900',
                gradientStart: '#1e40af',
                gradientEnd: '#0f172a',
                border: 'border-blue-600/30',
                badge: 'bg-white/20 text-white',
                icon: 'fa-book-bookmark'
            };
        }
        return {
            bg: 'from-blue-600 to-indigo-900',
            gradientStart: '#1d4ed8',
            gradientEnd: '#1e1b4b',
            border: 'border-blue-500/30',
            badge: 'bg-white/20 text-white',
            icon: 'fa-book-bookmark'
        };
    }
    // Bahasa Inggris: Electric Sky Blue / Ocean Teal (berakhir di Teal pekat)
    if (/inggris|english/i.test(raw)) {
        if (/lanjut/i.test(raw)) {
            return {
                bg: 'from-sky-600 to-indigo-700',
                gradientStart: '#0284c7',
                gradientEnd: '#3730a3',
                border: 'border-sky-500/30',
                badge: 'bg-white/20 text-white',
                icon: 'fa-language'
            };
        }
        return {
            bg: 'from-sky-600 to-teal-700',
            gradientStart: '#0284c7',
            gradientEnd: '#0f766e',
            border: 'border-sky-500/30',
            badge: 'bg-white/20 text-white',
            icon: 'fa-language'
        };
    }
    if (/bali|kearifan lokal/i.test(raw)) {
        return {
            bg: 'from-amber-600 to-yellow-600',
            gradientStart: '#d97706',
            gradientEnd: '#713f12',
            border: 'border-amber-500/30',
            badge: 'bg-white/20 text-white',
            icon: 'fa-feather-pointed'
        };
    }
    if (/jepang|japan/i.test(raw)) {
        return {
            bg: 'from-rose-600 to-red-600',
            gradientStart: '#e11d48',
            gradientEnd: '#7f1d1d',
            border: 'border-rose-500/30',
            badge: 'bg-white/20 text-white',
            icon: 'fa-torii-gate'
        };
    }

    // 4. Sosial & Humaniora
    if (/sejarah/i.test(raw)) {
        if (/lanjut/i.test(raw)) {
            return {
                bg: 'from-amber-700 to-slate-900',
                gradientStart: '#92400e',
                gradientEnd: '#0f172a',
                border: 'border-amber-600/30',
                badge: 'bg-white/20 text-white',
                icon: 'fa-landmark'
            };
        }
        return {
            bg: 'from-amber-700 to-yellow-600',
            gradientStart: '#92400e',
            gradientEnd: '#451a03',
            border: 'border-amber-500/30',
            badge: 'bg-white/20 text-white',
            icon: 'fa-landmark'
        };
    }
    if (/geografi/i.test(raw)) {
        return {
            bg: 'from-teal-600 to-emerald-900',
            gradientStart: '#0d9488',
            gradientEnd: '#042f2e',
            border: 'border-teal-500/30',
            badge: 'bg-white/20 text-white',
            icon: 'fa-earth-asia'
        };
    }
    if (/ekonomi|akuntansi/i.test(raw)) {
        return {
            bg: 'from-teal-700 to-indigo-900',
            gradientStart: '#0f766e',
            gradientEnd: '#1e1b4b',
            border: 'border-teal-600/30',
            badge: 'bg-white/20 text-white',
            icon: 'fa-chart-line'
        };
    }
    if (/sosiologi/i.test(raw)) {
        return {
            bg: 'from-violet-600 to-purple-800',
            gradientStart: '#8b5cf6',
            gradientEnd: '#4c1d95',
            border: 'border-violet-500/30',
            badge: 'bg-white/20 text-white',
            icon: 'fa-people-group'
        };
    }
    if (/antropologi/i.test(raw)) {
        return {
            bg: 'from-amber-600 to-orange-700',
            gradientStart: '#ea580c',
            gradientEnd: '#78350f',
            border: 'border-amber-500/30',
            badge: 'bg-white/20 text-white',
            icon: 'fa-users-rays'
        };
    }

    // 5. Teknologi & Keterampilan
    if (/informatika|komputer|tik/i.test(raw)) {
        return {
            bg: 'from-slate-800 to-indigo-900',
            gradientStart: '#334155',
            gradientEnd: '#0f172a',
            border: 'border-slate-600/30',
            badge: 'bg-white/20 text-white',
            icon: 'fa-laptop-code'
        };
    }
    // Prakarya & Kewirausahaan: Sunset Amber / Warm Gold
    if (/prakarya|kewirausahaan|pkwu/i.test(raw)) {
        return {
            bg: 'from-amber-500 to-orange-700',
            gradientStart: '#d97706',
            gradientEnd: '#9a3412',
            border: 'border-amber-400/30',
            badge: 'bg-white/20 text-white',
            icon: 'fa-lightbulb'
        };
    }

    // 6. Seni & Olahraga
    if (/seni/i.test(raw)) {
        return {
            bg: 'from-fuchsia-600 to-pink-700',
            gradientStart: '#db2777',
            gradientEnd: '#581c87',
            border: 'border-fuchsia-500/30',
            badge: 'bg-white/20 text-white',
            icon: 'fa-palette'
        };
    }
    if (/penjas|pjok|olahraga/i.test(raw)) {
        return {
            bg: 'from-lime-600 to-emerald-700',
            gradientStart: '#65a30d',
            gradientEnd: '#064e3b',
            border: 'border-lime-500/30',
            badge: 'bg-white/20 text-white',
            icon: 'fa-volleyball'
        };
    }

    // 7. Karakter, Agama, Budi Pekerti, Pancasila
    // Agama: Ruby Crimson / Merah Marun (berakhir di Wine pekat)
    if (/agama|budi pekerti/i.test(raw)) {
        return {
            bg: 'from-rose-600 to-pink-700',
            gradientStart: '#e11d48',
            gradientEnd: '#881337',
            border: 'border-rose-500/30',
            badge: 'bg-white/20 text-white',
            icon: 'fa-hands-praying'
        };
    }
    if (/pancasila|ppkn|pkn/i.test(raw)) {
        return {
            bg: 'from-red-600 to-rose-600',
            gradientStart: '#dc2626',
            gradientEnd: '#7f1d1d',
            border: 'border-red-500/30',
            badge: 'bg-white/20 text-white',
            icon: 'fa-shield-halved'
        };
    }
    if (/bk|bimbingan/i.test(raw)) {
        return {
            bg: 'from-sky-600 to-teal-700',
            gradientStart: '#0284c7',
            gradientEnd: '#1e3a8a',
            border: 'border-sky-500/30',
            badge: 'bg-white/20 text-white',
            icon: 'fa-comments'
        };
    }
    if (/p5|projek/i.test(raw)) {
        return {
            bg: 'from-purple-600 to-indigo-800',
            gradientStart: '#9333ea',
            gradientEnd: '#312e81',
            border: 'border-purple-500/30',
            badge: 'bg-white/20 text-white',
            icon: 'fa-shapes'
        };
    }

    // 8. Fallback Deterministik String Hash (Jika mapel tidak ada di kamus)
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
        hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
    }
    const idx = (hash + (Number.isFinite(fallbackIndex) ? fallbackIndex : 0)) % LMS_FALLBACK_PALETTES.length;
    return LMS_FALLBACK_PALETTES[idx];
}
window.getSubjectTheme = getSubjectTheme;
window.LMS_FALLBACK_PALETTES = LMS_FALLBACK_PALETTES;

function refreshStudentLmsOnReturn() {
    if (document.visibilityState === 'hidden' || !currentNIS || !currentStudent ||
        document.getElementById('view-lms')?.classList.contains('hidden') || Date.now() - studentLmsLastRefresh < LMS_SESSION_CACHE_TTL_MS) return;
    studentLmsLastRefresh = Date.now();
    void loadStudentLmsData(false);
}
window.addEventListener('focus', refreshStudentLmsOnReturn);
document.addEventListener('visibilitychange', refreshStudentLmsOnReturn);

/**
 * Memuat daftar seluruh mata pelajaran & modul LMS untuk rombel kelas siswa aktif
 */
async function loadStudentLmsData(force = false) {
    const requestSequence = ++studentLmsLoadSequence;
    const listContainer = document.getElementById('student-lms-list-container');
    const nis = currentNIS || currentStudent?.nis || sessionStorage.getItem('student_nis');
    const studentClass = currentStudent?.class || currentStudent?.kelas || currentStudent?.rombel || sessionStorage.getItem('student_class');

    if (!nis || !studentClass) {
        console.warn('[LMS Siswa] Identitas siswa atau rombel belum siap.');
        return false;
    }

    let renderedCache = false;
    // Cache hanya untuk tampilan awal, data server tetap divalidasi ulang.
    if (!force) {
        const cached = getSessionCache(SESSION_CACHE_KEYS.LMS);
        if (cached && cached.raw && cached.nis === String(nis) && cached.className === studentClass &&
            Date.now() - Number(cached.timestamp || 0) < LMS_SESSION_CACHE_TTL_MS) {
            console.log('[LMS Siswa] ⚡ Memuat data LMS dari Cache Sesi (0 Reads)');
            studentLmsRawData = cached.raw;
            processAndRenderStudentLms(cached.raw);
            renderedCache = true;
        }
    }

    const classCardsGrid = document.getElementById('student-lms-class-cards-grid');
    if (classCardsGrid && !renderedCache) {
        classCardsGrid.innerHTML = `
            <div class="col-span-full p-8 text-center bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 space-y-2">
                <i class="fa-solid fa-spinner fa-spin text-2xl text-emerald-500 mb-1"></i>
                <p class="text-xs font-semibold text-slate-500 dark:text-slate-400">Memuat topik pembelajaran...</p>
            </div>
        `;
    }

    if (listContainer && !renderedCache) {
        listContainer.innerHTML = `
            <div class="p-10 text-center text-slate-400 text-xs italic bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700">
                <i class="fa-solid fa-spinner fa-spin text-xl mb-2 text-emerald-500"></i>
                <p>Memuat daftar materi pembelajaran...</p>
            </div>
        `;
    }

    try {
        console.log(`[LMS Siswa] 🔄 Mengambil materi LMS multi-mapel untuk Siswa NIS: ${nis}, Kelas: ${studentClass}...`);
        const res = await cfGetLmsStudentCourses({ class: studentClass, studentNis: nis });
        if (requestSequence !== studentLmsLoadSequence || String(currentNIS || currentStudent?.nis || sessionStorage.getItem('student_nis')) !== String(nis)) return false;

        const raw = {
            topics: res.topics || [],
            materials: res.materials || []
        };
        const serverTime = Date.parse(res.server_now);
        if (Number.isFinite(serverTime)) studentLmsClockOffset = serverTime - Date.now();
        studentLmsRawData = raw;
        studentLmsLastRefresh = Date.now();

        setSessionCache(SESSION_CACHE_KEYS.LMS, { raw, nis: String(nis), className: studentClass, timestamp: Date.now() });
        processAndRenderStudentLms(raw);
        void resumeStudentHtmlMaterial();
        return true;
    } catch (err) {
        if (requestSequence !== studentLmsLoadSequence) return false;
        console.error('[LMS Siswa] Error loading student courses:', err);
        if (classCardsGrid && (!studentLmsSubjects || studentLmsSubjects.length === 0)) {
            classCardsGrid.innerHTML = `
                <div class="col-span-full p-6 text-center text-rose-500 bg-rose-50 border border-rose-200 rounded-xl text-xs font-semibold">
                    <i class="fa-solid fa-circle-exclamation text-xl mb-2"></i>
                    <p>Gagal memuat mata pelajaran: ${window.escapeHTML(err.message || 'Terjadi kesalahan jaringan.')}</p>
                </div>
            `;
        }
        if (listContainer) {
            listContainer.innerHTML = `
                <div class="p-6 text-center text-rose-500 bg-rose-50 border border-rose-200 rounded-xl text-xs font-semibold">
                    <i class="fa-solid fa-circle-exclamation text-xl mb-2"></i>
                    <p>Gagal memuat materi pembelajaran: ${window.escapeHTML(err.message || 'Terjadi kesalahan jaringan.')}</p>
                </div>
            `;
        }
        return false;
    }
}

/**
 * Helper format nama guru: mendeteksi email atau placeholder kosong dan mengembalikan label netral
 */
function formatTeacherDisplayName(name) {
    if (!name || typeof name !== 'string') return 'Nama guru belum tersedia';
    const clean = name.trim();
    if (!clean || clean === '-' || clean.toLowerCase() === 'guru mapel' || clean.includes('@')) {
        return 'Nama guru belum tersedia';
    }
    return clean;
}

/**
 * Helper resolusi identitas guru: memprioritaskan nama asli dibanding format email
 */
function resolveTeacherDisplayName(existingName, candidateName) {
    const isEmail = (str) => Boolean(str && typeof str === 'string' && str.includes('@'));
    const isFallback = (str) => !str || str === 'Guru Mapel' || str === '-' || str === 'Nama guru belum tersedia';

    const cleanCandidate = typeof candidateName === 'string' ? candidateName.trim() : '';
    const cleanExisting = typeof existingName === 'string' ? existingName.trim() : '';

    if (!cleanExisting || isFallback(cleanExisting)) {
        if (cleanCandidate && !isEmail(cleanCandidate) && !isFallback(cleanCandidate)) {
            return cleanCandidate;
        }
        return isEmail(cleanCandidate) ? 'Nama guru belum tersedia' : (cleanCandidate || 'Nama guru belum tersedia');
    }
    if (isEmail(cleanExisting) && cleanCandidate && !isEmail(cleanCandidate) && !isFallback(cleanCandidate)) {
        return cleanCandidate;
    }
    if (isEmail(cleanExisting)) {
        return 'Nama guru belum tersedia';
    }
    return cleanExisting;
}

/**
 * Memproses struktur data raw D1 menjadi hierarki Google Classroom per Mapel & Topik
 */
function processAndRenderStudentLms(raw) {
    applyStudentLmsSchedule(raw);
    const topicsMap = new Map();
    (raw.topics || []).forEach(t => topicsMap.set(t.id, t));

    const subjectsMap = new Map();

    (raw.materials || []).forEach(mat => {
        const subName = (mat.subject_name || 'Lainnya').trim();
        const initialTeacher = formatTeacherDisplayName(mat.teacher_name || mat.guru_name || mat.teacher_display_name || mat.author_name || '');
        if (!subjectsMap.has(subName)) {
            subjectsMap.set(subName, {
                subject_name: subName,
                teacher_name: initialTeacher,
                topics: new Map(),
                direct_materials: [],
                all_materials: [],
                total_materials: 0,
                completed_count: 0
            });
        }

        const subObj = subjectsMap.get(subName);
        const candidateTeacher = mat.teacher_name || mat.guru_name || mat.teacher_display_name || mat.author_name;
        if (candidateTeacher) {
            subObj.teacher_name = resolveTeacherDisplayName(subObj.teacher_name, candidateTeacher);
        }

        subObj.total_materials++;
        subObj.all_materials.push(mat);
        if (mat.requirement_met) {
            subObj.completed_count++;
        }

        if (mat.topic_id && topicsMap.has(mat.topic_id)) {
            const topic = topicsMap.get(mat.topic_id);
            if (!subObj.topics.has(mat.topic_id)) {
                subObj.topics.set(mat.topic_id, {
                    topic_info: topic,
                    materials: []
                });
            }
            subObj.topics.get(mat.topic_id).materials.push(mat);
        } else {
            subObj.direct_materials.push(mat);
        }
    });

    // Periksa apakah topik memiliki informasi guru yang lebih lengkap
    (raw.topics || []).forEach(t => {
        const tSub = (t.subject_name || '').trim();
        if (tSub && subjectsMap.has(tSub)) {
            const subObj = subjectsMap.get(tSub);
            const topicTeacher = t.teacher_name || t.guru_name || t.author_name;
            if (topicTeacher) {
                subObj.teacher_name = resolveTeacherDisplayName(subObj.teacher_name, topicTeacher);
            }
        }
    });

    studentLmsSubjects = Array.from(subjectsMap.values()).map(sub => {
        const topicsList = Array.from(sub.topics.values()).map(t => ({
            ...t.topic_info,
            materials: t.materials.sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
        })).sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

        const modules = sub.all_materials.some(m=>m.module_id) ? groupLmsModules(sub.all_materials) : null;
        const totalModules = modules ? modules.length : sub.total_materials;
        const completedModules = modules ? modules.filter(m=>m.is_completed).length : sub.completed_count;
        return {
            subject_name: sub.subject_name,
            teacher_name: formatTeacherDisplayName(sub.teacher_name),
            modules,
            topics: topicsList,
            direct_materials: sub.direct_materials.sort((a, b) => (a.order_index || 0) - (b.order_index || 0)),
            all_materials: sub.all_materials || [],
            total_materials: totalModules,
            completed_count: completedModules,
            completion_rate: totalModules > 0 ? Math.round((completedModules / totalModules) * 100) : 0
        };
    });

    const studentName = currentStudent?.name || currentStudent?.nama || sessionStorage.getItem('student_name') || 'Siswa';
    const fullName = String(studentName).trim() || 'Siswa';
    const nameEl = document.getElementById('student-lms-student-firstname');
    if (nameEl) nameEl.textContent = fullName;

    updateStudentLmsOverallStats(raw.materials || []);
    if (studentLmsActiveSubject && !studentLmsSubjects.some(s => s.subject_name === studentLmsActiveSubject)) studentLmsActiveSubject = '';
    updateStudentLmsClassroomHeader();
    renderStudentLmsClassCards(studentLmsSubjects);
    renderStudentLmsPills(studentLmsSubjects);
    populateStudentLmsSubjectDropdown(studentLmsSubjects);
    renderStudentLmsStream();
    if (studentLmsActiveSubject) window.switchStudentCourseSubTab(studentLmsCourseSubTab, true);
}

/**
 * Hitung ringkasan statistik keseluruhan siswa
 */
function updateStudentLmsOverallStats(materials) {
    const badgeStatus = document.getElementById('student-lms-badge-status');
    const statTotal = document.getElementById('student-lms-total-count');
    const statDone = document.getElementById('student-lms-completed-count');
    const statPending = document.getElementById('student-lms-pending-count');
    const percentText = document.getElementById('student-lms-percent-text');
    const progressBar = document.getElementById('student-lms-progress-bar');
    const subjectsBadge = document.getElementById('student-lms-subjects-count-badge');

    const modules = materials.some(m=>m.module_id) ? groupLmsModules(materials) : null;
    let total = modules ? modules.length : materials.length;
    let completed = modules ? modules.filter(m=>m.is_completed).length : materials.filter(m=>m.requirement_met).length;

    const pending = Math.max(0, total - completed);
    const rate = total > 0 ? Math.round((completed / total) * 100) : 0;

    if (statTotal) statTotal.textContent = total;
    if (statDone) statDone.textContent = completed;
    if (statPending) statPending.textContent = pending;
    if (percentText) percentText.textContent = `${rate}%`;
    if (progressBar) progressBar.style.width = `${rate}%`;
    if (subjectsBadge) subjectsBadge.textContent = studentLmsSubjects.length > 0 ? `${studentLmsSubjects.length} Mapel Aktif` : 'Belum ada topik';

    if (badgeStatus) {
        if (total === 0) {
            badgeStatus.className = 'px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-slate-500/20 border border-slate-400/30 text-slate-300 flex items-center gap-1';
            badgeStatus.innerHTML = '<i class="fa-solid fa-circle-info text-slate-300"></i> Belum ada topik';
        } else if (rate === 100 && total > 0) {
            badgeStatus.className = 'px-2.5 py-1 rounded-full text-[11px] font-black bg-amber-500/30 border border-amber-400 text-amber-200 flex items-center gap-1 shadow-sm';
            badgeStatus.innerHTML = '<i class="fa-solid fa-circle-check text-emerald-300"></i> Semua selesai';
        } else if (rate >= 80) {
            badgeStatus.className = 'px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-emerald-500/20 border border-emerald-400 text-emerald-200 flex items-center gap-1';
            badgeStatus.innerHTML = `${rate}% selesai`;
        } else if (rate >= 50) {
            badgeStatus.className = 'px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-blue-500/20 border border-blue-400 text-blue-200 flex items-center gap-1';
            badgeStatus.innerHTML = `${rate}% selesai`;
        } else {
            badgeStatus.className = 'px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-amber-500/20 border border-amber-400 text-amber-200 flex items-center gap-1';
            badgeStatus.innerHTML = `${rate}% selesai`;
        }
    }
}

/**
 * Menghitung indikator urgensi & status penyelesaian tugas untuk kartu mata pelajaran
 * @param {Object} sub Objek mata pelajaran dari studentLmsSubjects
 * @returns {Object} { status, badgeHtml, pillDotHtml, pendingCount, overdueCount, todayCount, soonCount }
 */
function getSubjectUrgencyIndicator(sub) {
    const total = sub.total_materials || 0;
    const completed = sub.completed_count || 0;
    const pending = Math.max(0, total - completed);

    if (total === 0) {
        return {
            status: 'empty',
            badgeHtml: '<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-white/20 text-white/90 border border-white/20 flex items-center gap-1"><i class="fa-solid fa-folder-open text-[10px]"></i> 0 Modul</span>',
            pillDotHtml: '',
            pendingCount: 0,
            overdueCount: 0,
            todayCount: 0,
            soonCount: 0
        };
    }

    if (pending === 0) {
        return {
            status: 'all_done',
            badgeHtml: '<span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-400 text-emerald-950 border border-emerald-300 shadow-xs flex items-center gap-1"><i class="fa-solid fa-circle-check text-[10px]"></i> Semua Tuntas</span>',
            pillDotHtml: '<span class="inline-block w-2 h-2 rounded-full bg-emerald-400 mr-1 shrink-0" title="Semua materi/tugas telah tuntas"></span>',
            pendingCount: 0,
            overdueCount: 0,
            todayCount: 0,
            soonCount: 0
        };
    }

    const uncompletedMaterials = sub.modules ? sub.modules.filter(m=>!m.is_completed) : (sub.all_materials || []).filter(m => !m.requirement_met);
    let overdueCount = 0;
    let todayCount = 0;
    let soonCount = 0;

    uncompletedMaterials.forEach(m => {
        if (m.due_date) {
            const urgency = calculateDueDateUrgency(m.due_date, false);
            if (urgency.level === 'overdue') {
                overdueCount++;
            } else if (urgency.level === 'today') {
                todayCount++;
            } else if (urgency.level === 'tomorrow' || urgency.level === 'soon') {
                soonCount++;
            }
        }
    });

    if (overdueCount > 0) {
        const text = overdueCount > 1 ? `${overdueCount} Terlambat` : 'Terlambat';
        return {
            status: 'overdue',
            badgeHtml: `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-rose-500 text-white border border-rose-300 shadow-xs flex items-center gap-1 animate-pulse" title="${overdueCount} tugas melewati tenggat"><i class="fa-solid fa-triangle-exclamation text-[10px]"></i> ${text}</span>`,
            pillDotHtml: '<span class="inline-flex relative mr-1 shrink-0"><span class="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-rose-400 opacity-75"></span><span class="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span></span>',
            pendingCount: pending,
            overdueCount,
            todayCount,
            soonCount
        };
    }

    if (todayCount > 0) {
        const text = todayCount > 1 ? `${todayCount} Hari Ini` : 'Hari Ini!';
        return {
            status: 'today',
            badgeHtml: `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-400 text-amber-950 border border-amber-300 shadow-xs flex items-center gap-1 animate-pulse" title="${todayCount} tugas jatuh tempo hari ini"><i class="fa-solid fa-fire text-[10px]"></i> ${text}</span>`,
            pillDotHtml: '<span class="inline-flex relative mr-1 shrink-0"><span class="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-amber-400 opacity-75"></span><span class="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span></span>',
            pendingCount: pending,
            overdueCount,
            todayCount,
            soonCount
        };
    }

    if (soonCount > 0) {
        return {
            status: 'soon',
            badgeHtml: `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-300 text-amber-950 border border-amber-200 shadow-xs flex items-center gap-1" title="${soonCount} tugas mendekati batas akhir"><i class="fa-solid fa-clock text-[10px]"></i> ${soonCount} Tugas Segera</span>`,
            pillDotHtml: '<span class="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1 shrink-0" title="${soonCount} tugas mendekati batas akhir"></span>',
            pendingCount: pending,
            overdueCount,
            todayCount,
            soonCount
        };
    }

    return {
        status: 'pending',
        badgeHtml: `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-white/20 text-white border border-white/30 backdrop-blur-xs flex items-center gap-1" title="${pending} materi belum selesai"><i class="fa-solid fa-hourglass-half text-[10px]"></i> ${pending} Belum Selesai</span>`,
        pillDotHtml: '<span class="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1 shrink-0" title="${pending} belum selesai"></span>',
        pendingCount: pending,
        overdueCount,
        todayCount,
        soonCount
    };
}

/**
 * Render Grid Kartu Mata Pelajaran Siswa (Tampilan Google Classroom)
 */
function renderStudentLmsClassCards(subjects) {
    const gridEl = document.getElementById('student-lms-class-cards-grid');
    if (!gridEl) return;

    if (!subjects || subjects.length === 0) {
        gridEl.innerHTML = `
            <div class="col-span-full p-8 text-center bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 space-y-2">
                <div class="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xl mx-auto mb-2">
                    <i class="fa-solid fa-folder-open"></i>
                </div>
                <h4 class="font-bold text-slate-800 dark:text-slate-100 text-sm">Belum Ada Topik Pembelajaran</h4>
                <p class="text-xs text-slate-400 dark:text-slate-400 max-w-sm mx-auto">
                    Guru pengampu belum membuat topik atau mempublikasikan materi pembelajaran untuk kelasmu.
                </p>
            </div>
        `;
        return;
    }

    let html = '';

    subjects.forEach((sub, idx) => {
        const theme = getSubjectTheme(sub.subject_name, idx);
        const isSelected = studentLmsActiveSubject === sub.subject_name;
        const encodedSubject = encodeURIComponent(sub.subject_name).replace(/'/g, '%27');
        const topicCount = Array.isArray(sub.topics) ? sub.topics.length : 0;
        const topicSummaryText = topicCount > 0
            ? `${topicCount} topik · ${sub.total_materials} modul`
            : `${sub.total_materials} modul`;
        const teacherName = formatTeacherDisplayName(sub.teacher_name);
        const indicator = getSubjectUrgencyIndicator(sub);

        html += `
            <button type="button"
                onclick="window.selectStudentLmsSubject(decodeURIComponent('${encodedSubject}'))"
                aria-label="Buka mata pelajaran ${window.escapeHTML(sub.subject_name)}"
                style="background-image: linear-gradient(135deg, ${theme.gradientStart || '#3b82f6'}, ${theme.gradientEnd || '#1e1b4b'});"
                class="text-left w-full bg-gradient-to-br ${theme.bg} rounded-2xl p-4 text-white shadow-sm border ${theme.border} hover:shadow-md hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 transition-all duration-200 relative overflow-hidden flex flex-col justify-between cursor-pointer group ${isSelected ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900' : ''}">

                <div class="absolute -right-4 -bottom-4 text-white text-8xl pointer-events-none group-hover:scale-110 transition-transform" style="opacity: 0.07;">
                    <i class="fa-solid ${theme.icon}"></i>
                </div>

                <div class="space-y-2 relative z-10 w-full">
                    <div class="flex items-start justify-between gap-2">
                        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold ${theme.badge} border border-white/20">
                            ${topicSummaryText}
                        </span>
                        <div class="shrink-0">
                            ${indicator.badgeHtml}
                        </div>
                    </div>

                    <div>
                        <h4 class="font-black text-base text-white tracking-tight leading-snug break-words group-hover:text-amber-200 transition-colors">
                            ${window.escapeHTML(sub.subject_name)}
                        </h4>
                        <p class="text-xs text-white/90 font-medium flex items-center gap-1.5 mt-0.5">
                            <i class="fa-solid fa-chalkboard-user text-[11px] text-white/70 shrink-0"></i>
                            <span class="truncate">${window.escapeHTML(teacherName)}</span>
                        </p>
                    </div>
                </div>

                <div class="pt-3.5 mt-2 border-t border-white/20 relative z-10 w-full space-y-2">
                    <div class="w-full h-1.5 bg-black/30 rounded-full overflow-hidden">
                        <div class="bg-emerald-400 h-full rounded-full transition-all" style="width: ${sub.completion_rate}%"></div>
                    </div>

                    <div class="flex items-center justify-between text-[11px] gap-2">
                        <span class="text-white font-bold drop-shadow-xs truncate">${sub.completed_count} dari ${sub.total_materials} selesai (${sub.completion_rate}%)</span>
                        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-black/35 group-hover:bg-black/55 text-white font-extrabold text-[11px] border border-white/25 shadow-xs transition-colors shrink-0">
                            <span>Buka Mapel</span>
                            <i class="fa-solid fa-arrow-right text-[10px] group-hover:translate-x-0.5 transition-transform"></i>
                        </span>
                    </div>
                </div>
            </button>
        `;
    });

    gridEl.innerHTML = html;
}
window.renderStudentLmsClassCards = renderStudentLmsClassCards;

/**
 * Render Pill Filter Mata Pelajaran Cepat
 */
function renderStudentLmsPills(subjects) {
    const pillsContainer = document.getElementById('student-lms-subject-pills');
    if (!pillsContainer) return;

    let html = `
        <button onclick="window.selectStudentLmsSubject('')"
            class="px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap transition-all shadow-2xs ${studentLmsActiveSubject === '' ? 'bg-slate-800 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}">
            <i class="fa-solid fa-layer-group mr-1"></i> Semua Mapel (${studentLmsRawData.materials.length})
        </button>
    `;

    subjects.forEach(sub => {
        const isSelected = studentLmsActiveSubject === sub.subject_name;
        const encodedSubject = encodeURIComponent(sub.subject_name).replace(/'/g, '%27');
        const indicator = getSubjectUrgencyIndicator(sub);
        html += `
            <button onclick="window.selectStudentLmsSubject(decodeURIComponent('${encodedSubject}'))"
                class="px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap transition-all shadow-2xs flex items-center gap-1.5 ${isSelected ? 'bg-emerald-600 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}">
                ${indicator.pillDotHtml}
                <span>${window.escapeHTML(sub.subject_name)}</span>
                <span class="ml-0.5 opacity-80 text-[10px]">(${sub.completed_count}/${sub.total_materials})</span>
            </button>
        `;
    });

    pillsContainer.innerHTML = html;
}

/**
 * Isi dropdown filter mata pelajaran
 */
function populateStudentLmsSubjectDropdown(subjects) {
    const selectSubject = document.getElementById('select-student-lms-subject');
    if (!selectSubject) return;

    let html = '<option value="">-- Semua Mata Pelajaran --</option>';
    subjects.forEach(sub => {
        html += `<option value="${window.escapeHTML(sub.subject_name)}" ${sub.subject_name === studentLmsActiveSubject ? 'selected' : ''}>${window.escapeHTML(sub.subject_name)} (${sub.total_materials} Modul)</option>`;
    });

    selectSubject.innerHTML = html;
}

/**
 * Filter mata pelajaran saat kartu kelas atau pill diklik
 */
function selectStudentLmsSubject(subjectName) {
    studentLmsActiveSubject = subjectName;
    const selectSubject = document.getElementById('select-student-lms-subject');
    if (selectSubject) selectSubject.value = subjectName;

    if (subjectName) {
        const subMaterials = (studentLmsRawData.materials || []).filter(m => m.subject_name === subjectName);
        const comp = subMaterials.filter(m => m.requirement_met).length;
        const pend = subMaterials.length - comp;
        if (subMaterials.length > 0 && pend === 0) {
            studentLmsStatusFilter = 'completed';
        } else {
            studentLmsStatusFilter = 'pending';
        }
    } else {
        studentLmsStatusFilter = 'pending';
    }

    updateStudentLmsClassroomHeader();
    renderStudentLmsClassCards(studentLmsSubjects);
    renderStudentLmsPills(studentLmsSubjects);
    setStudentLmsStatusFilter(studentLmsStatusFilter);

    if (subjectName) {
        const headerEl = document.getElementById('student-lms-classroom-header');
        if (headerEl && typeof headerEl.scrollIntoView === 'function') {
            headerEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    } else {
        const gridEl = document.getElementById('student-lms-all-classes-section');
        if (gridEl && typeof gridEl.scrollIntoView === 'function') {
            gridEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }
}
window.selectStudentLmsSubject = selectStudentLmsSubject;

window.onStudentSubjectSelectChange = function () {
    const val = document.getElementById('select-student-lms-subject')?.value || '';
    selectStudentLmsSubject(val);
};

/**
 * Update visibilitas & data header ruang kelas aktif
 */
function updateStudentLmsClassroomHeader() {
    const classroomHeader = document.getElementById('student-lms-classroom-header');
    const allClassesSection = document.getElementById('student-lms-all-classes-section');
    const homeSummary = document.getElementById('student-lms-home-summary');
    const listContainer = document.getElementById('student-lms-list-container');
    const filterWrapper = document.getElementById('student-lms-filter-wrapper');
    const inlineDiscussion = document.getElementById('student-lms-inline-discussions-container');
    const inlineDeadline = document.getElementById('student-lms-inline-deadlines-container');
    const titleEl = document.getElementById('student-lms-classroom-title');
    const teacherEl = document.getElementById('student-lms-classroom-teacher');
    const teacherNameEl = document.getElementById('student-lms-teacher-name');
    const progressBadge = document.getElementById('student-lms-classroom-progress-badge');

    if (!studentLmsActiveSubject) {
        if (classroomHeader) {
            classroomHeader.classList.add('hidden');
            classroomHeader.className = 'hidden bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700 p-3.5 sm:p-4 shadow-xs';
            classroomHeader.removeAttribute('style');
            const watermark = classroomHeader.querySelector('.student-lms-header-watermark');
            if (watermark) watermark.remove();
        }
        if (allClassesSection) allClassesSection.classList.remove('hidden');
        if (homeSummary) homeSummary.classList.remove('hidden');
        if (listContainer) listContainer.classList.add('hidden');
        if (filterWrapper) filterWrapper.classList.add('hidden');
        if (inlineDiscussion) inlineDiscussion.classList.add('hidden');
        if (inlineDeadline) inlineDeadline.classList.add('hidden');
        return;
    }

    if (allClassesSection) allClassesSection.classList.add('hidden');
    if (classroomHeader) classroomHeader.classList.remove('hidden');
    if (homeSummary) homeSummary.classList.add('hidden');
    if (listContainer) listContainer.classList.remove('hidden');
    if (filterWrapper) filterWrapper.classList.remove('hidden');
    if (inlineDiscussion) inlineDiscussion.classList.add('hidden');
    if (inlineDeadline) inlineDeadline.classList.add('hidden');

    const sub = studentLmsSubjects.find(s => s.subject_name === studentLmsActiveSubject);
    if (sub) {
        const theme = getSubjectTheme(sub.subject_name);
        const topicCount = Array.isArray(sub.topics) ? sub.topics.length : 0;
        const teacherName = formatTeacherDisplayName(sub.teacher_name);

        if (classroomHeader) {
            classroomHeader.className = `relative overflow-hidden bg-gradient-to-br ${theme.bg} rounded-2xl border ${theme.border} p-3.5 sm:p-4 shadow-md text-white`;
            classroomHeader.setAttribute('style', `background-image: linear-gradient(135deg, ${theme.gradientStart || '#3b82f6'}, ${theme.gradientEnd || '#1e1b4b'});`);
            let watermark = classroomHeader.querySelector('.student-lms-header-watermark');
            if (!watermark) {
                watermark = document.createElement('div');
                watermark.className = 'student-lms-header-watermark absolute -right-4 -bottom-6 text-white text-8xl sm:text-9xl pointer-events-none transition-transform';
                classroomHeader.appendChild(watermark);
            }
            watermark.style.opacity = '0.07';
            watermark.innerHTML = `<i class="fa-solid ${theme.icon}"></i>`;
        }

        const backBtn = classroomHeader?.querySelector('button');
        if (backBtn) {
            backBtn.className = 'w-9 h-9 min-w-[36px] mt-0.5 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center transition active:scale-95 text-xs font-bold shrink-0 z-10 relative';
        }

        if (titleEl) {
            titleEl.textContent = sub.subject_name;
            titleEl.className = 'font-black text-base sm:text-lg text-white leading-tight break-words relative z-10';
        }
        if (teacherNameEl) {
            teacherNameEl.textContent = teacherName;
            teacherNameEl.className = 'text-white font-bold';
        } else if (teacherEl) {
            teacherEl.innerHTML = `<span>Guru:</span> <strong class="text-white font-bold">${window.escapeHTML(teacherName)}</strong>`;
        }
        if (teacherEl) {
            teacherEl.className = 'text-xs text-white/80 font-medium flex items-center gap-1.5 flex-wrap relative z-10';
        }
        if (progressBadge) {
            const topicText = topicCount > 0 ? `${topicCount} topik · ` : '';
            progressBadge.textContent = `${topicText}${sub.total_materials} modul · ${sub.completed_count} selesai (${sub.completion_rate}%)`;
            progressBadge.className = 'inline-flex items-center px-2 py-0.5 rounded-md bg-white/20 text-white border border-white/25 font-bold text-[11px] relative z-10';
        }
        const guideEl = document.getElementById('student-lms-classroom-guide');
        if (guideEl) {
            guideEl.className = 'text-white/80 font-medium';
        }
    }
}
window.updateStudentLmsClassroomHeader = updateStudentLmsClassroomHeader;

/**
 * Berpindah sub-tab di dalam ruang kelas mapel aktif ('silabus' | 'diskusi' | 'tenggat')
 */
function switchStudentCourseSubTab(subTab, isQuiet = false) {
    studentLmsCourseSubTab = subTab;

    const btnSilabus = document.getElementById('btn-subtab-silabus');
    const btnDiskusi = document.getElementById('btn-subtab-diskusi');
    const btnTenggat = document.getElementById('btn-subtab-tenggat');

    const streamContainer = document.getElementById('student-lms-list-container');
    const filterWrapper = document.getElementById('student-lms-filter-wrapper');
    const discContainer = document.getElementById('student-lms-inline-discussions-container');
    const deadlineContainer = document.getElementById('student-lms-inline-deadlines-container');

    const activeClass = 'px-3 py-1.5 rounded-lg font-bold transition-all bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-2xs flex items-center gap-1.5';
    const inactiveClass = 'px-3 py-1.5 rounded-lg font-bold transition-all text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white flex items-center gap-1.5';

    if (btnSilabus) btnSilabus.className = subTab === 'silabus' ? activeClass : inactiveClass;
    if (btnDiskusi) btnDiskusi.className = subTab === 'diskusi' ? activeClass : inactiveClass;
    if (btnTenggat) btnTenggat.className = subTab === 'tenggat' ? activeClass : inactiveClass;

    if (subTab === 'silabus') {
        if (streamContainer) streamContainer.classList.remove('hidden');
        if (filterWrapper) filterWrapper.classList.remove('hidden');
        if (discContainer) discContainer.classList.add('hidden');
        if (deadlineContainer) deadlineContainer.classList.add('hidden');
    } else if (subTab === 'diskusi') {
        if (streamContainer) streamContainer.classList.add('hidden');
        if (filterWrapper) filterWrapper.classList.add('hidden');
        if (discContainer) discContainer.classList.remove('hidden');
        if (deadlineContainer) deadlineContainer.classList.add('hidden');
        renderStudentLmsInlineDiscussions();
    } else if (subTab === 'tenggat') {
        if (streamContainer) streamContainer.classList.add('hidden');
        if (filterWrapper) filterWrapper.classList.add('hidden');
        if (discContainer) discContainer.classList.add('hidden');
        if (deadlineContainer) deadlineContainer.classList.remove('hidden');
        renderStudentLmsInlineDeadlines();
    }
}
window.switchStudentCourseSubTab = switchStudentCourseSubTab;

/**
 * Render forum diskusi terpadu langsung di halaman kelas aktif
 */
function renderStudentLmsInlineDiscussions() {
    const discContainer = document.getElementById('student-lms-inline-discussions-container');
    if (!discContainer) return;

    const materials = (studentLmsRawData.materials || []).filter(m => {
        if (studentLmsActiveSubject && m.subject_name !== studentLmsActiveSubject) return false;
        return Number(m.allow_discussion) === 1;
    });

    if (materials.length === 0) {
        discContainer.innerHTML = `
            <div class="p-8 text-center bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 space-y-2">
                <div class="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xl mx-auto mb-2">
                    <i class="fa-solid fa-comments"></i>
                </div>
                <h4 class="font-bold text-slate-800 dark:text-white text-sm">Belum Ada Forum Diskusi Dibuka</h4>
                <p class="text-xs text-slate-400 max-w-sm mx-auto">
                    Guru pengampu belum mengaktifkan ruang diskusi pada modul pelajaran ini.
                </p>
            </div>
        `;
        return;
    }

    let html = `
        <div class="space-y-3">
            <div class="p-3 bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-800/60 rounded-xl flex items-center justify-between text-xs text-indigo-900 dark:text-indigo-200">
                <div class="flex items-center gap-2">
                    <i class="fa-solid fa-circle-info text-indigo-600 dark:text-indigo-400"></i>
                    <span>Pilih materi di bawah untuk membuka ruang tanya-jawab dan diskusi kelas.</span>
                </div>
                <span class="font-bold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 text-[10px]">
                    ${materials.length} Ruang Diskusi
                </span>
            </div>
    `;

    materials.forEach(mat => {
        const count = Number(mat.discussion_count) || 0;
        html += `
            <div class="bg-white dark:bg-slate-800 rounded-xl p-3.5 border border-slate-200/80 dark:border-slate-700 shadow-2xs hover:shadow-xs transition flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div class="space-y-1 min-w-0 flex-1">
                    <div class="flex items-center gap-2 flex-wrap">
                        <span class="px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-extrabold text-[10px]">
                            ${window.escapeHTML(mat.subject_name || 'Mapel')}
                        </span>
                        <span class="text-[10px] text-slate-400 font-semibold truncate max-w-xs">
                            ${window.escapeHTML(mat.title)}
                        </span>
                    </div>
                    <h5 class="font-bold text-slate-800 dark:text-white text-xs sm:text-sm">
                        ${window.escapeHTML(mat.title)}
                    </h5>
                    ${mat.content_description && mat.resource_type !== 'html' ? `<p class="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1">${window.escapeHTML(mat.content_description)}</p>` : ''}
                </div>
                <button onclick="window.openStudentLmsDiscussion('${mat.id}', '${window.escapeHTML(mat.title)}')"
                    class="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 active:scale-95 shadow-xs shrink-0">
                    <i class="fa-solid fa-comments text-xs"></i>
                    <span>Buka Diskusi (${count})</span>
                </button>
            </div>
        `;
    });

    html += `</div>`;
    discContainer.innerHTML = html;
}

/**
 * Render tenggat waktu / deadlines terpadu langsung di halaman kelas aktif
 */
function renderStudentLmsInlineDeadlines() {
    const deadlineContainer = document.getElementById('student-lms-inline-deadlines-container');
    if (!deadlineContainer) return;

    const materials = (studentLmsRawData.materials || []).filter(m => {
        if (studentLmsActiveSubject && m.subject_name !== studentLmsActiveSubject) return false;
        return !!m.due_date;
    });

    if (materials.length === 0) {
        deadlineContainer.innerHTML = `
            <div class="p-8 text-center bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 space-y-2">
                <div class="w-12 h-12 rounded-2xl bg-teal-50 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400 flex items-center justify-center text-xl mx-auto mb-2">
                    <i class="fa-solid fa-calendar-check"></i>
                </div>
                <h4 class="font-bold text-slate-800 dark:text-white text-sm">Tidak Ada Tenggat Waktu Khusus</h4>
                <p class="text-xs text-slate-400 max-w-sm mx-auto">
                    Guru pengampu belum menetapkan batas waktu untuk modul di mata pelajaran ini. Kamu dapat belajar sesuai kecepatanmu!
                </p>
            </div>
        `;
        return;
    }

    let html = `<div class="space-y-2.5">`;

    materials.forEach(mat => {
        const isDone = Boolean(mat.requirement_met);
        const urgency = calculateDueDateUrgency(mat.due_date, isDone);
        const isText = mat.resource_type === 'text';

        html += `
            <div class="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-200/80 dark:border-slate-700 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div class="space-y-1 min-w-0 flex-1">
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <span class="px-2 py-0.5 rounded-md border text-[10px] flex items-center gap-1 ${urgency.badgeClass}">
                            <i class="${urgency.icon}"></i> <span>${window.escapeHTML(urgency.label)}</span>
                        </span>
                        ${isDone ? '<span class="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 text-[10px] font-extrabold flex items-center gap-1"><i class="fa-solid fa-check"></i> Tuntas</span>' : ''}
                    </div>
                    <h5 class="font-bold text-slate-800 dark:text-white text-xs sm:text-sm">
                        ${window.escapeHTML(mat.title)}
                    </h5>
                    <p class="text-[11px] text-slate-400">
                        Buka: <strong>${window.escapeHTML(formatLmsScheduleTime(mat.publish_at))}</strong><br>
                        Target selesai: <strong>${window.escapeHTML(formatLmsScheduleTime(mat.due_date))}</strong>
                    </p>
                </div>
                <button ${mat.is_locked ? 'disabled' : ''} onclick="${isText ? `window.openStudentReadMaterial('${mat.id}')` : `window.scrollToMaterialCard('${mat.id}', '${window.escapeHTML(mat.subject_name || '')}')`}"
                    class="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 active:scale-95 shrink-0">
                    <span>${isDone ? 'Lihat Modul' : 'Kerjakan'}</span>
                    <i class="fa-solid fa-arrow-right text-[10px]"></i>
                </button>
            </div>
        `;
    });

    html += `</div>`;
    deadlineContainer.innerHTML = html;
}

window.scrollToMaterialCard = function (materialId, subjectName) {
    if (subjectName && studentLmsActiveSubject !== subjectName) {
        selectStudentLmsSubject(subjectName);
    }
    setTimeout(() => {
        const card = document.getElementById(`lms-mat-${materialId}`);
        if (card) {
            const workspace = document.getElementById('student-lms-list-container');
            for (let section = card; section && section !== workspace; section = section.parentElement) {
                if (section.tagName !== 'DETAILS') continue;
                section.open = true;
                if (section.dataset.expansionKey) workspace?.lmsExpansion?.set(section.dataset.expansionKey, true);
            }
            if (typeof card.scrollIntoView === 'function') {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            card.classList.add('ring-2', 'ring-amber-400');
            setTimeout(() => card.classList.remove('ring-2', 'ring-amber-400'), 2500);
        }
    }, 150);
};

/**
 * Toggle expand/collapse kontainer topik LMS siswa
 */
function toggleStudentLmsTopic(topicId) {
    if (!studentLmsActiveSubject) return;
    if (!studentLmsOpenTopics.has(studentLmsActiveSubject)) {
        studentLmsOpenTopics.set(studentLmsActiveSubject, new Set());
    }
    const openSet = studentLmsOpenTopics.get(studentLmsActiveSubject);
    const wasOpen = openSet.has(topicId);
    if (wasOpen) {
        openSet.delete(topicId);
    } else {
        openSet.add(topicId);
    }

    const contentEl = document.getElementById(`topic-content-${topicId}`);
    const chevronEl = document.getElementById(`topic-chevron-${topicId}`);
    const btnEl = document.getElementById(`topic-btn-${topicId}`);

    if (contentEl) {
        if (wasOpen) contentEl.classList.add('hidden');
        else contentEl.classList.remove('hidden');
    }
    if (chevronEl) {
        if (wasOpen) chevronEl.classList.remove('rotate-180');
        else chevronEl.classList.add('rotate-180');
    }
    if (btnEl) {
        btnEl.setAttribute('aria-expanded', wasOpen ? 'false' : 'true');
    }
}
window.toggleStudentLmsTopic = toggleStudentLmsTopic;

/**
 * Render Classwork Stream Materi Siswa
 */
function renderStudentLmsStream() {
    const listContainer = document.getElementById('student-lms-list-container');
    if (!listContainer) return;

    if (!studentLmsActiveSubject) {
        listContainer.classList.add('hidden');
        listContainer.innerHTML = '';
        return;
    }

    const subject = studentLmsSubjects.find(s => s.subject_name === studentLmsActiveSubject);
    if (!subject) {
        listContainer.innerHTML = `
            <div class="p-8 text-center bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 space-y-2">
                <i class="fa-solid fa-folder-open text-2xl text-slate-300 dark:text-slate-600 mb-1"></i>
                <p class="font-bold text-slate-700 dark:text-slate-200 text-sm">Belum Ada Topik</p>
                <p class="text-xs text-slate-400">Guru belum membuat topik atau mempublikasikan materi pada mata pelajaran ini.</p>
            </div>
        `;
        return;
    }

    if ((subject.topics || []).some(t => (t.materials || []).some(p => p.module_id))) {
        updateStudentLmsFilterCounters();
        return renderLmsStudentModules(listContainer,subject,{
            filter:studentLmsStatusFilter,now:Date.now()+studentLmsClockOffset,
            openMaterial:p=>p.resource_type==='text'?window.openStudentReadMaterial(p.id):window.openStudentMaterial(p.id),
            openQuiz:p=>window.openStudentQuiz(p.id),
            openDiscussion:async p=>{if(!p.is_opened)await trackStudentItemOpened(p);return window.openStudentLmsDiscussion(p.id,p.title);},
            onError:error=>Swal.fire('Belum dapat dibuka',error.message,'error')
        });
    }
    const topics = subject.topics || [];
    const directMaterials = subject.direct_materials || [];
    if (topics.length === 0 && directMaterials.length === 0) {
        listContainer.innerHTML = `
            <div class="p-8 text-center bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 space-y-2">
                <i class="fa-solid fa-folder-open text-2xl text-slate-300 dark:text-slate-600 mb-1"></i>
                <p class="font-bold text-slate-700 dark:text-slate-200 text-sm">Belum Ada Topik</p>
                <p class="text-xs text-slate-400">Belum ada topik atau materi yang dipublikasikan pada mata pelajaran ini.</p>
            </div>
        `;
        return;
    }

    const statusFilter = (studentLmsStatusFilter || '').trim();
    updateStudentLmsFilterCounters();

    // Inisialisasi default open topics jika belum ada
    if (!studentLmsOpenTopics.has(studentLmsActiveSubject)) {
        studentLmsOpenTopics.set(studentLmsActiveSubject, new Set());
        const firstPendingTopic = topics.find(t => {
            const mats = t.materials || [];
            return !t.is_completed || mats.some(m => !m.requirement_met);
        }) || topics[0];

        if (firstPendingTopic && firstPendingTopic.id) {
            studentLmsOpenTopics.get(studentLmsActiveSubject).add(firstPendingTopic.id);
        }
    }

    const openSet = studentLmsOpenTopics.get(studentLmsActiveSubject);

    let renderedTopicCount = 0;
    let html = '<div class="space-y-3">';

    topics.forEach((topic, topicIndex) => {
        const topicMaterials = topic.materials || [];
        const rawTotalCount = topicMaterials.length;
        const pendingList = topicMaterials.filter(m => !m.requirement_met);
        const completedList = topicMaterials.filter(m => Boolean(m.requirement_met));

        if (statusFilter === 'pending' && pendingList.length === 0) return;
        if (statusFilter === 'completed' && completedList.length === 0) return;
        if (statusFilter === '' && rawTotalCount === 0) return;

        renderedTopicCount++;
        const isOpen = openSet.has(topic.id);
        const topicDone = Boolean(topic.is_completed);
        const topicLocked = Boolean(topic.is_locked);
        const topicTeachingCompleted = Number(topic.is_teaching_completed) === 1;

        const topicStateBorder = topicLocked
            ? 'border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40'
            : (topicDone
                ? 'border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/20 dark:bg-emerald-950/20'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800');

        const topicIcon = topicLocked ? 'fa-lock' : (topicDone ? 'fa-check' : 'fa-book-bookmark');
        const topicIconClass = topicLocked
            ? 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
            : (topicDone
                ? 'bg-emerald-600 text-white'
                : 'bg-indigo-600 text-white');

        const completedCount = completedList.length;
        const statusBadgeText = topicDone
            ? 'Sudah Selesai'
            : (topicLocked
                ? 'Terkunci'
                : `${completedCount}/${rawTotalCount} materi selesai`);

        const rawTopicDesc = (topic.description || '').trim();
        const hasTopicDesc = Boolean(rawTopicDesc && rawTopicDesc.toLowerCase() !== (topic.title || '').trim().toLowerCase());

        let topicContentHtml = '';
        if (statusFilter === 'pending') {
            topicContentHtml = `
                <div class="space-y-2">
                    ${pendingList.map(renderSingleMaterialCardHtml).join('')}
                </div>
            `;
        } else if (statusFilter === 'completed') {
            topicContentHtml = `
                <div class="space-y-2">
                    ${completedList.map(renderSingleMaterialCardHtml).join('')}
                </div>
            `;
        } else {
            let sectionsHtml = '';
            if (pendingList.length > 0) {
                sectionsHtml += `
                    <div class="space-y-2">
                        <div class="pt-0.5 pb-0.5">
                            <h5 class="text-[10px] font-black uppercase tracking-wider text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                                <i class="fa-solid fa-hourglass-half text-[9px]"></i>
                                <span>Perlu Dikerjakan (${pendingList.length})</span>
                            </h5>
                        </div>
                        ${pendingList.map(renderSingleMaterialCardHtml).join('')}
                    </div>
                `;
            }
            if (completedList.length > 0) {
                const isCompletedOpen = studentLmsCompletedSections.has(topic.id) || pendingList.length === 0;
                sectionsHtml += `
                    <div class="pt-2">
                        <button type="button" onclick="window.toggleStudentLmsCompletedSection('${topic.id}')"
                            class="w-full flex items-center justify-between py-1.5 text-left group cursor-pointer border-t border-slate-100 dark:border-slate-700/60">
                            <h5 class="text-[10px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                                <i class="fa-solid fa-circle-check text-[9px]"></i>
                                <span>Selesai (${completedList.length})</span>
                            </h5>
                            <i id="completed-chevron-${topic.id}" class="fa-solid fa-chevron-down text-[10px] text-slate-400 group-hover:text-slate-600 transition-transform ${isCompletedOpen ? 'rotate-180' : ''}"></i>
                        </button>
                        <div id="completed-content-${topic.id}" class="${isCompletedOpen ? '' : 'hidden'} pt-1.5 space-y-2">
                            ${completedList.map(renderSingleMaterialCardHtml).join('')}
                        </div>
                    </div>
                `;
            }
            topicContentHtml = sectionsHtml;
        }

        html += `
            <section class="rounded-2xl border ${topicStateBorder} overflow-hidden shadow-xs transition-colors">
                <button type="button"
                    id="topic-btn-${topic.id}"
                    onclick="window.toggleStudentLmsTopic('${topic.id}')"
                    aria-expanded="${isOpen ? 'true' : 'false'}"
                    aria-controls="topic-content-${topic.id}"
                    class="w-full text-left p-3 sm:p-4 flex items-center justify-between gap-3 hover:bg-slate-50/70 dark:hover:bg-slate-700/40 transition cursor-pointer select-none">

                    <div class="flex items-start gap-3 min-w-0 flex-1">
                        <span class="w-8 h-8 sm:w-9 sm:h-9 rounded-xl ${topicIconClass} flex items-center justify-center shrink-0 text-xs shadow-2xs mt-0.5">
                            <i class="fa-solid ${topicIcon}"></i>
                        </span>
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-1.5 flex-wrap">
                                <span class="text-[10px] uppercase tracking-wider font-extrabold text-slate-400 dark:text-slate-500">
                                    Topik ${topicIndex + 1}
                                </span>
                                ${topicTeachingCompleted ? '<span class="px-2 py-0.5 rounded-full bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300 text-[10px] font-extrabold flex items-center gap-1"><i class="fa-solid fa-chalkboard-user"></i>Pembahasan Guru Selesai</span>' : ''}
                            </div>
                            <h4 class="font-black text-sm sm:text-base text-slate-900 dark:text-white leading-snug break-words mt-0.5">
                                ${window.escapeHTML(topic.title)}
                            </h4>
                            ${hasTopicDesc ? `<p class="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5 leading-normal">${window.escapeHTML(rawTopicDesc)}</p>` : ''}
                        </div>
                    </div>

                    <div class="shrink-0 flex items-center gap-2">
                        <span class="px-2.5 py-1 rounded-full text-[10px] font-bold ${topicDone ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' : (topicLocked ? 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300' : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300')}">
                            ${statusBadgeText}
                        </span>
                        <div class="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 flex items-center justify-center">
                            <i id="topic-chevron-${topic.id}" class="fa-solid fa-chevron-down text-xs transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}"></i>
                        </div>
                    </div>
                </button>

                <div id="topic-content-${topic.id}" class="${isOpen ? '' : 'hidden'} p-2.5 sm:p-3.5 space-y-2.5 border-t border-slate-100 dark:border-slate-700/60 bg-white/70 dark:bg-slate-800/70">
                    ${rawTotalCount > 1 ? `<nav aria-label="Urutan modul dalam topik" class="rounded-xl border border-slate-200 dark:border-slate-700 p-2.5 space-y-1.5"><p class="text-[11px] font-bold text-slate-700 dark:text-slate-200">Alur topik · ${completedCount}/${rawTotalCount} modul tuntas</p><ol class="flex flex-wrap gap-2 text-[11px]">${topicMaterials.map((material, index) => `<li data-topic-material="${window.escapeHTML(material.id)}" data-module-state="${material.requirement_met ? 'completed' : material.is_locked ? 'locked' : 'available'}" class="inline-flex items-center gap-1.5 ${material.requirement_met ? 'text-emerald-700 dark:text-emerald-300' : material.is_locked ? 'text-slate-500 dark:text-slate-400' : 'text-indigo-700 dark:text-indigo-300'}"><i aria-hidden="true" class="fa-solid ${material.requirement_met ? 'fa-circle-check' : material.is_locked ? 'fa-lock' : 'fa-circle-dot'}"></i><span>${index + 1}. ${window.escapeHTML(material.title)} — ${material.requirement_met ? 'Tuntas' : material.is_locked ? 'Menunggu' : 'Bisa dikerjakan'}</span></li>`).join('')}</ol><p class="text-[10px] text-slate-500 dark:text-slate-400">Selesaikan semua syarat modul untuk melanjutkan ke modul berikutnya.</p></nav>` : ''}
                    ${topicContentHtml}
                </div>
            </section>
        `;
    });

    if (directMaterials.length > 0) {
        let directItems = directMaterials;
        if (statusFilter === 'pending') {
            directItems = directItems.filter(m => !m.requirement_met);
        } else if (statusFilter === 'completed') {
            directItems = directItems.filter(m => Boolean(m.requirement_met));
        }

        if (directItems.length > 0) {
            renderedTopicCount++;
            const directDone = directItems.every(m => m.requirement_met);
            html += `
                <section class="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden shadow-xs">
                    <div class="p-3 sm:p-4 border-b border-slate-100 dark:border-slate-700/60 flex items-center justify-between gap-2">
                        <div class="flex items-center gap-2">
                            <span class="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xs">
                                <i class="fa-solid fa-folder-open"></i>
                            </span>
                            <h4 class="font-black text-sm text-slate-800 dark:text-white">Materi Tambahan</h4>
                        </div>
                        <span class="px-2.5 py-1 rounded-full text-[10px] font-bold ${directDone ? 'bg-emerald-100 text-emerald-800' : 'bg-indigo-50 text-indigo-700'}">
                            ${directItems.filter(m => m.requirement_met).length}/${directItems.length} selesai
                        </span>
                    </div>
                    <div class="p-2.5 sm:p-3.5 space-y-2.5 bg-white/70 dark:bg-slate-800/70">
                        ${directItems.map(renderSingleMaterialCardHtml).join('')}
                    </div>
                </section>
            `;
        }
    }

    html += '</div>';

    if (renderedTopicCount === 0) {
        const allMapelMats = (studentLmsRawData.materials || []).filter(m => !studentLmsActiveSubject || m.subject_name === studentLmsActiveSubject);
        const totalMapelCount = allMapelMats.length;
        const completedMapelCount = allMapelMats.filter(m => m.requirement_met).length;

        if (statusFilter === 'pending' && totalMapelCount > 0 && completedMapelCount === totalMapelCount) {
            listContainer.innerHTML = `
                <div class="p-8 text-center bg-white dark:bg-slate-800 rounded-2xl border border-emerald-200 dark:border-emerald-800/60 shadow-2xs space-y-3">
                    <div class="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xl mx-auto shadow-xs">
                        <i class="fa-solid fa-award"></i>
                    </div>
                    <div class="space-y-1">
                        <h4 class="font-black text-slate-900 dark:text-white text-sm sm:text-base">Semua Materi Selesai!</h4>
                        <p class="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto leading-relaxed">
                            Hebat! Kamu telah menyelesaikan seluruh materi pada mata pelajaran ini.
                        </p>
                    </div>
                    <div>
                        <button type="button" onclick="window.setStudentLmsStatusFilter('completed')"
                            class="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition shadow-xs active:scale-95">
                            <i class="fa-solid fa-circle-check"></i>
                            <span>Lihat Materi Selesai</span>
                        </button>
                    </div>
                </div>
            `;
            return;
        }

        if (statusFilter === 'completed' && completedMapelCount === 0) {
            listContainer.innerHTML = `
                <div class="p-8 text-center bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 space-y-2">
                    <i class="fa-solid fa-circle-check text-2xl text-slate-300 dark:text-slate-600 mb-1"></i>
                    <p class="font-bold text-slate-700 dark:text-slate-200 text-sm">Belum ada materi selesai</p>
                    <p class="text-xs text-slate-400">Kamu belum menyelesaikan materi pada mata pelajaran ini.</p>
                    <button type="button" onclick="window.setStudentLmsStatusFilter('pending')"
                        class="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-xs font-bold hover:bg-indigo-100 transition">
                        <i class="fa-solid fa-book-open"></i><span>Lihat Materi yang Perlu Dikerjakan</span>
                    </button>
                </div>
            `;
            return;
        }

        listContainer.innerHTML = `
            <div class="p-8 text-center bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 space-y-2">
                <i class="fa-solid fa-filter text-2xl text-slate-300 dark:text-slate-600 mb-1"></i>
                <p class="font-bold text-slate-700 dark:text-slate-200 text-sm">Tidak ada materi ditemukan</p>
                <p class="text-xs text-slate-400">Tidak ada materi yang sesuai dengan filter status yang dipilih.</p>
            </div>
        `;
        return;
    }

    listContainer.innerHTML = html;
}

/**
 * Render satu modul materi beserta forum opsionalnya.
 */
function renderSingleMaterialCardHtml(mat) {
    const schedule = getLmsScheduleState(mat, Date.now() + studentLmsClockOffset);
    const isLocked = Boolean(mat.is_locked || !schedule.isAccessible);
    const isDone = Boolean(mat.requirement_met);
    const teachingCompleted = schedule.teachingCompleted;
    const isQuiz = (Number(mat.quiz_enabled ?? (mat.resource_type === 'quiz' ? 1 : 0)) === 1);
    const materialOpened = Boolean(mat.is_opened || mat.my_first_opened_at || isDone);
    const readingComplete = materialOpened && mat.reading_complete !== false;
    const quizCompleted = isQuiz && (isDone || (mat.my_status || mat.status) === 'completed');
    const discussionRequired = Boolean(mat.discussion_required || Number(mat.allow_discussion) === 1);
    const needsDiscussion = Boolean(readingComplete && (!isQuiz || quizCompleted) && discussionRequired && !mat.discussion_completed);
    let resIcon = '<i class="fa-solid fa-link text-purple-500"></i>';
    let resLabel = 'Tautan Web';
    let resBadge = 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800/50';

    if (mat.resource_type === 'gdrive') {
        resIcon = '<i class="fa-brands fa-google-drive text-blue-500"></i>';
        resLabel = 'Google Drive';
        resBadge = 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800/50';
    } else if (mat.resource_type === 'youtube') {
        resIcon = '<i class="fa-brands fa-youtube text-rose-500"></i>';
        resLabel = 'YouTube';
        resBadge = 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800/50';
    } else if (mat.resource_type === 'text') {
        resIcon = '<i class="fa-solid fa-file-lines text-teal-600"></i>';
        resLabel = 'Teks Mandiri';
        resBadge = 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/50 dark:text-teal-300 dark:border-teal-800/50';
    } else if (mat.resource_type === 'html') {
        resIcon = '<i class="fa-solid fa-code text-emerald-600"></i>';
        resLabel = 'HTML Interaktif';
        resBadge = 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/50';
    } else if ((Number(mat.quiz_enabled ?? (mat.resource_type === 'quiz' ? 1 : 0)) === 1)) {
        let isStrictQuiz = false;
        if (mat.quiz_payload) {
            try {
                const qp = typeof mat.quiz_payload === 'string' ? JSON.parse(mat.quiz_payload) : mat.quiz_payload;
                isStrictQuiz = qp?.mode === 'strict';
            } catch (_) {}
        }
        if (isStrictQuiz) {
            resIcon = '<i class="fa-solid fa-shield-halved text-rose-600"></i>';
            resLabel = 'Kuis CBT';
            resBadge = 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800/50';
        } else {
            resIcon = '<i class="fa-solid fa-circle-question text-purple-600"></i>';
            resLabel = 'Kuis Formatif';
            resBadge = 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800/50';
        }
    }

    let isStrictQuizCard = false;
    if (isQuiz && mat.quiz_payload) {
        try {
            const qp = typeof mat.quiz_payload === 'string' ? JSON.parse(mat.quiz_payload) : mat.quiz_payload;
            isStrictQuizCard = qp?.mode === 'strict';
        } catch (_) {}
    }

    const statusBadge = schedule.state === 'scheduled'
            ? '<span class="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 text-[10px] font-bold">Belum Dibuka</span>'
        : isDone
        ? '<span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 text-[10px] font-extrabold flex items-center gap-1"><i class="fa-solid fa-check"></i> Sudah Selesai</span>'
        : (isLocked
            ? '<span class="px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300 text-[10px] font-bold flex items-center gap-1"><i class="fa-solid fa-lock"></i> Terkunci</span>'
            : (materialOpened && !readingComplete
                ? '<span class="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300 text-[10px] font-bold">Sedang Belajar</span>'
                : needsDiscussion
                ? '<span class="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300 text-[10px] font-bold flex items-center gap-1"><i class="fa-solid fa-comments"></i> Menunggu tanggapan</span>'
                : (isQuiz
                    ? (isStrictQuizCard
                        ? '<span class="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 text-[10px] font-bold flex items-center gap-1"><i class="fa-solid fa-shield-halved"></i> Siap CBT</span>'
                        : '<span class="px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 text-[10px] font-bold flex items-center gap-1"><i class="fa-solid fa-pen-nib"></i> Siap dikerjakan</span>')
                    : '<span class="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 text-[10px] font-bold flex items-center gap-1"><i class="fa-solid fa-book-open"></i> Siap dibuka</span>')));

    let quizScoreBadge = '';
    const rawQuizScore = mat.my_quiz_score !== undefined ? mat.my_quiz_score : mat.quiz_score;
    if (isQuiz && rawQuizScore !== null && rawQuizScore !== undefined) {
        const sc = Number(rawQuizScore);
        quizScoreBadge = `<span class="px-2 py-0.5 rounded-md ${quizCompleted ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300' : 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300'} text-[10px] font-black">Nilai: ${sc}</span>`;
    }

    let dueBadgeHtml = '';
    if (mat.due_date) {
        const urgency = calculateDueDateUrgency(mat.due_date, isDone);
        dueBadgeHtml = `<span class="px-2 py-0.5 rounded-md border text-[10px] flex items-center gap-1 ${urgency.badgeClass}"><i class="${urgency.icon}"></i> <span>${window.escapeHTML(urgency.label)}</span></span>`;
    }

    const openMaterialHandler = isQuiz
        ? `window.openStudentQuiz('${mat.id}')`
        : (mat.resource_type === 'text'
            ? `window.openStudentReadMaterial('${mat.id}')`
            : `window.openStudentMaterial('${mat.id}')`);
    const openMaterialIcon = isQuiz
        ? (isStrictQuizCard ? 'fa-shield-halved' : 'fa-circle-question')
        : (mat.resource_type === 'text'
            ? 'fa-book-open'
            : (mat.resource_type === 'youtube' ? 'fa-play' : (mat.resource_type === 'gdrive' ? 'fa-file-lines' : 'fa-arrow-up-right-from-square')));
    const openMaterialLabel = isQuiz
        ? (isStrictQuizCard
            ? (isDone ? 'Lihat CBT' : (mat.is_opened ? 'Lanjutkan CBT' : 'Mulai CBT'))
            : (isDone ? 'Lihat Kuis' : (mat.is_opened ? 'Lanjutkan Kuis' : 'Kerjakan Kuis')))
        : 'Buka Materi';

    let actionButtonsHtml = '';
    if (!isLocked) {
        if (needsDiscussion) {
            actionButtonsHtml = `
                <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0 w-full sm:w-auto">
                    <button type="button" onclick="${openMaterialHandler}"
                        class="w-full sm:w-auto min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition border border-indigo-200 dark:border-indigo-800 bg-white hover:bg-indigo-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-indigo-700 dark:text-indigo-300 shadow-2xs active:scale-95 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        title="Buka kembali materi untuk dipelajari">
                        <i class="fa-solid ${openMaterialIcon}"></i><span>${isQuiz ? 'Lihat Kuis' : 'Buka Materi'}</span>
                    </button>
                    <button type="button" onclick="window.openStudentLmsDiscussion('${mat.id}')"
                        class="w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition bg-indigo-600 hover:bg-indigo-500 text-white shadow-xs active:scale-95 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
                        title="Tanggapi diskusi pembelajaran">
                        <i class="fa-solid fa-comments"></i><span>Tanggapi Diskusi</span>
                    </button>
                </div>
            `;
        } else if (isDone && discussionRequired) {
            actionButtonsHtml = `
                <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0 w-full sm:w-auto">
                    <button type="button" onclick="${openMaterialHandler}"
                        class="w-full sm:w-auto min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs active:scale-95 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        title="Buka kembali materi pembelajaran ini">
                        <i class="fa-solid ${openMaterialIcon}"></i><span>${isQuiz ? 'Lihat Kuis' : 'Buka Materi'}</span>
                    </button>
                    <button type="button" onclick="window.openStudentLmsDiscussion('${mat.id}')"
                        class="w-full sm:w-auto min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition border border-indigo-200 dark:border-indigo-800 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 shadow-2xs active:scale-95 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        title="Lihat forum diskusi pembelajaran">
                        <i class="fa-solid fa-comments"></i><span>Lihat Diskusi</span>
                    </button>
                </div>
            `;
        } else {
            const btnColorClass = isDone ? 'bg-emerald-600 hover:bg-emerald-500' : (isQuiz ? 'bg-purple-600 hover:bg-purple-500' : 'bg-indigo-600 hover:bg-indigo-500');
            const focusRingClass = isQuiz ? 'focus:ring-purple-500' : 'focus:ring-indigo-500';
            actionButtonsHtml = `
                <button type="button" onclick="${openMaterialHandler}"
                    class="w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shrink-0 transition ${btnColorClass} text-white shadow-xs active:scale-95 focus:outline-none focus:ring-2 ${focusRingClass} focus:ring-offset-1">
                    <i class="fa-solid ${openMaterialIcon}"></i><span>${openMaterialLabel}</span>
                </button>
            `;
        }
    }

    const rawDesc = (mat.resource_type === 'html' ? (mat.html_instructions || '') : (mat.content_description || '')).trim();
    const isDuplicateDesc = rawDesc.toLowerCase() === (mat.title || '').trim().toLowerCase();
    const showDesc = Boolean(rawDesc && !isDuplicateDesc);

    const discussionHtml = discussionRequired && !isLocked
        ? `<div class="mt-1.5 flex items-start gap-1.5 text-[10px] ${mat.is_opened ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-500 dark:text-slate-400'}">
                <i class="fa-solid fa-comments mt-0.5"></i>
                <span>${materialOpened && !readingComplete
                    ? 'Diskusi terbuka setelah syarat waktu belajar terpenuhi.'
                    : isQuiz && materialOpened && !quizCompleted
                    ? 'Diskusi terbuka setelah kuis dinyatakan tuntas. Tunggu pemeriksaan guru jika jawaban belum dinilai.'
                    : mat.is_opened
                    ? `${window.escapeHTML(mat.discussion_prompt || 'Diskusi wajib setelah membuka materi.')}`
                    : 'Diskusi wajib akan terbuka setelah materi dibuka.'}</span>
           </div>`
        : '';

    const unlockText = schedule.message || mat.unlock_reason || 'Selesaikan materi sebelumnya untuk membuka.';
    const learningSteps = [
        { key: 'material', label: isQuiz ? 'Buka Kuis' : 'Buka Materi', done: readingComplete, available: !isLocked },
        ...(isQuiz ? [{ key: 'quiz', label: 'Tuntaskan Kuis', done: quizCompleted, available: !isLocked && materialOpened }] : []),
        ...(discussionRequired ? [{ key: 'discussion', label: 'Tanggapi Diskusi', done: Boolean(mat.discussion_completed || isDone), available: !isLocked && readingComplete && (!isQuiz || quizCompleted) }] : [])
    ];
    const learningStepsHtml = `<ol aria-label="Alur belajar" class="flex flex-wrap items-center gap-2 text-[11px] pt-1">${learningSteps.map((step, index) => {
        const state = step.done ? 'completed' : step.available ? 'available' : 'locked';
        return `<li data-lms-step="${step.key}" data-step-state="${state}" class="inline-flex items-center gap-1.5 ${step.done ? 'text-emerald-700 dark:text-emerald-300' : step.available ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-500 dark:text-slate-400'}"><i aria-hidden="true" class="fa-solid ${step.done ? 'fa-circle-check' : step.available ? 'fa-circle-dot' : 'fa-lock'}"></i><span>${index + 1}. ${step.label} — ${step.done ? 'Selesai' : step.available ? 'Bisa dikerjakan' : 'Menunggu'}</span></li>`;
    }).join('')}</ol><p class="text-[10px] text-slate-500 dark:text-slate-400">${isDone ? 'Semua syarat terpenuhi. Modul selesai.' : 'Ikuti alurnya. Modul tuntas setelah semua syarat dicentang.'}</p>`;

    return `
        <div id="lms-mat-${mat.id}" class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl border transition-all ${isLocked ? 'bg-slate-50/70 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700/80 opacity-80' : (isDone ? 'bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/50' : (isQuiz ? 'bg-purple-50/30 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800/60 shadow-2xs' : 'bg-white dark:bg-slate-800 border-indigo-200 dark:border-indigo-800/60 shadow-2xs'))}">
            <div class="flex items-start gap-3 flex-1 min-w-0">
                <span class="w-7 h-7 mt-0.5 rounded-full shrink-0 flex items-center justify-center text-[11px] font-black ${isLocked ? 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400' : (isDone ? 'bg-emerald-600 text-white' : (isQuiz ? 'bg-purple-600 text-white' : 'bg-indigo-600 text-white'))}">
                    ${isDone ? '<i class="fa-solid fa-check"></i>' : (isLocked ? '<i class="fa-solid fa-lock"></i>' : (Number(mat.learning_position) || Number(mat.topic_position) || 1))}
                </span>
                <div class="space-y-1 flex-1 min-w-0">
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <span class="px-2 py-0.5 rounded-md border text-[10px] font-extrabold flex items-center gap-1.5 ${resBadge}">
                            ${resIcon} <span>${resLabel}</span>
                        </span>
                        ${statusBadge}
                        ${quizScoreBadge}
                        ${teachingCompleted ? '<span class="px-2 py-0.5 rounded-full bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300 text-[10px] font-extrabold" title="Materi tetap dapat dipelajari dan dituntaskan"><i class="fa-solid fa-chalkboard-user mr-1"></i>Selesai Dibahas</span>' : ''}
                        ${dueBadgeHtml}
                    </div>
                    <h5 class="font-black text-slate-800 dark:text-white text-xs sm:text-sm leading-snug break-words">
                        ${window.escapeHTML(mat.title)}
                    </h5>
                    ${(mat.publish_at || mat.due_date) ? `<p class="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">Buka: ${window.escapeHTML(formatLmsScheduleTime(mat.publish_at))}<br>Target selesai: ${window.escapeHTML(formatLmsScheduleTime(mat.due_date))}</p>` : ''}
                    ${showDesc ? `<p class="text-[11px] text-slate-600 dark:text-slate-400 line-clamp-2 leading-relaxed">${window.escapeHTML(rawDesc)}</p>` : ''}
                    ${learningStepsHtml}
                    ${!readingComplete && Number(mat.reading_required_seconds) > 0 ? `<p data-lms-reading-progress="${window.escapeHTML(mat.id)}" class="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">${mat.reading_mode === 'external' ? 'Waktu akses sejak pertama dibuka' : 'Belajar aktif di LMS'}: minimal ${Math.ceil(mat.reading_required_seconds / 60)} menit. ${materialOpened ? `Tersisa ${Math.ceil((Number(mat.reading_remaining_seconds) || 0) / 60)} menit.` : 'Buka materi untuk mulai.'}</p>` : ''}
                    ${discussionRequired && !isLocked ? '<span class="inline-flex px-2 py-0.5 rounded-md border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 text-[10px] font-extrabold"><i class="fa-solid fa-comments mr-1"></i>Diskusi wajib</span>' : ''}
                    ${discussionHtml}
                    ${isLocked ? `<div class="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 font-medium pt-0.5"><i class="fa-solid fa-lock text-[10px] text-slate-400 shrink-0"></i><span>${window.escapeHTML(unlockText)}</span></div>` : ''}
                    ${teachingCompleted && !isLocked ? `<p class="text-[10px] text-teal-700 dark:text-teal-400"><i class="fa-solid fa-book-open-reader mr-1"></i>${isDone ? 'Tetap dapat dibuka kembali sebagai bahan pengayaan.' : 'Masih dapat dituntaskan. Aktivitas susulan dicatat Terlambat, tanpa potongan nilai otomatis.'}</p>` : ''}
                </div>
            </div>
            ${actionButtonsHtml}
        </div>
    `;
}

/**
 * Segmented Filter Status Materi Siswa ('pending' | '' | 'completed')
 */
function setStudentLmsStatusFilter(filter) {
    studentLmsStatusFilter = filter || '';

    const btnPending = document.getElementById('filter-btn-pending');
    const btnAll = document.getElementById('filter-btn-all');
    const btnCompleted = document.getElementById('filter-btn-completed');
    const countPending = document.getElementById('filter-count-pending');
    const countAll = document.getElementById('filter-count-all');
    const countCompleted = document.getElementById('filter-count-completed');

    const activeBase = 'flex-1 sm:flex-initial px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 min-h-[36px] bg-white dark:bg-slate-700 shadow-2xs';
    const inactiveBase = 'flex-1 sm:flex-initial px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 min-h-[36px] text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200';
    const counterInactive = 'px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-slate-200/70 dark:bg-slate-700 text-slate-600 dark:text-slate-300';

    if (btnPending) {
        if (studentLmsStatusFilter === 'pending') {
            btnPending.className = `${activeBase} text-indigo-700 dark:text-indigo-300`;
            if (countPending) countPending.className = 'px-1.5 py-0.2 rounded-full text-[10px] font-black bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300';
        } else {
            btnPending.className = inactiveBase;
            if (countPending) countPending.className = counterInactive;
        }
    }

    if (btnAll) {
        if (studentLmsStatusFilter === '') {
            btnAll.className = `${activeBase} text-slate-900 dark:text-white`;
            if (countAll) countAll.className = 'px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-slate-200/80 dark:bg-slate-600 text-slate-800 dark:text-slate-200';
        } else {
            btnAll.className = inactiveBase;
            if (countAll) countAll.className = counterInactive;
        }
    }

    if (btnCompleted) {
        if (studentLmsStatusFilter === 'completed') {
            btnCompleted.className = `${activeBase} text-emerald-700 dark:text-emerald-300`;
            if (countCompleted) countCompleted.className = 'px-1.5 py-0.2 rounded-full text-[10px] font-black bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-300';
        } else {
            btnCompleted.className = inactiveBase;
            if (countCompleted) countCompleted.className = counterInactive;
        }
    }

    const selectStatus = document.getElementById('select-student-lms-status');
    if (selectStatus && selectStatus.value !== studentLmsStatusFilter) {
        selectStatus.value = studentLmsStatusFilter;
    }

    renderStudentLmsStream();
}
window.setStudentLmsStatusFilter = setStudentLmsStatusFilter;

/**
 * Hitung dan perbarui angka counter pada segmented filter status
 */
function updateStudentLmsFilterCounters() {
    const allMaterials = (studentLmsRawData.materials || []).filter(m => !studentLmsActiveSubject || m.subject_name === studentLmsActiveSubject);
    const groupedModules = allMaterials.some(m=>m.module_id) ? groupLmsModules(allMaterials) : null;
    const total = groupedModules ? groupedModules.length : allMaterials.length;
    const completed = groupedModules ? groupedModules.filter(m=>m.is_completed).length : allMaterials.filter(m => Boolean(m.requirement_met)).length;
    const pending = Math.max(0, total - completed);

    const countPending = document.getElementById('filter-count-pending');
    const countAll = document.getElementById('filter-count-all');
    const countCompleted = document.getElementById('filter-count-completed');

    if (countPending) countPending.textContent = String(pending);
    if (countAll) countAll.textContent = String(total);
    if (countCompleted) countCompleted.textContent = String(completed);
}

/**
 * Buka/tutup sub-seksi materi selesai di dalam topik accordion
 */
window.toggleStudentLmsCompletedSection = function (topicId) {
    if (!topicId) return;
    if (studentLmsCompletedSections.has(topicId)) {
        studentLmsCompletedSections.delete(topicId);
    } else {
        studentLmsCompletedSections.add(topicId);
    }
    const isNowOpen = studentLmsCompletedSections.has(topicId);
    const contentEl = document.getElementById(`completed-content-${topicId}`);
    const chevronEl = document.getElementById(`completed-chevron-${topicId}`);
    if (contentEl) {
        if (isNowOpen) contentEl.classList.remove('hidden');
        else contentEl.classList.add('hidden');
    }
    if (chevronEl) {
        if (isNowOpen) chevronEl.classList.add('rotate-180');
        else chevronEl.classList.remove('rotate-180');
    }
};

window.filterStudentLms = function () {
    const val = document.getElementById('select-student-lms-status')?.value;
    setStudentLmsStatusFilter(val !== undefined ? val : studentLmsStatusFilter);
};

// =========================================================================
// ACTIVE SESSION DURATION TRACKER PER MODUL (CLOUDFLARE FREE OPTIMIZED)
// =========================================================================

let lmsActiveSession = null;
const LMS_HEARTBEAT_INTERVAL_MS = 300000; // 5 menit (300 detik) failsafe checkpoint hemat kuota write Cloudflare D1

function generateLmsSessionId() {
    return 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

function safeSetInterval(fn, ms) {
    if (typeof setInterval === 'function') return setInterval(fn, ms);
    if (typeof window !== 'undefined' && typeof window.setInterval === 'function') return window.setInterval(fn, ms);
    return null;
}

function safeClearInterval(timerId) {
    if (!timerId) return;
    if (typeof clearInterval === 'function') return clearInterval(timerId);
    if (typeof window !== 'undefined' && typeof window.clearInterval === 'function') return window.clearInterval(timerId);
}

function startLmsActiveSession(material, sessionId, resumed = null) {
    if (!material || !material.id) return '';
    if (lmsActiveSession) {
        stopLmsActiveSession(true);
    }

    const sessId = sessionId || generateLmsSessionId();
    const nis = currentNIS || currentStudent?.nis || sessionStorage.getItem('student_nis');

    lmsActiveSession = {
        materialId: material.id,
        sessionId: sessId,
        studentNis: nis,
        activeSeconds: resumed?.activeSeconds || 0,
        htmlRevision: material.resource_type === 'html' ? lmsHtmlRevision(material.content_description || '') : '',
        lastTickTimestamp: Date.now(),
        isRunning: typeof document !== 'undefined' ? document.visibilityState === 'visible' : true,
        lastSyncedSeconds: 0,
        readingRequiredSeconds: Number(material.reading_required_seconds) || 0,
        readingActiveBase: Math.max(0, (Number(material.reading_active_seconds) || 0) - (material.my_last_session_id === sessId ? Number(material.my_last_session_seconds) || 0 : 0)),
        readingComplete: material.reading_complete !== false,
        readingCheckpointPending: false,
        heartbeatTimer: null,
        tickTimer: null
    };
    writeLmsHtmlSession(lmsActiveSession);
    if (lmsActiveSession.readingRequiredSeconds > 0 && !lmsActiveSession.readingComplete) {
        document.querySelectorAll('.lms-reading-live-clock').forEach(node => node.remove());
        const host = document.getElementById(material.resource_type === 'text' ? 'student-read-meta' : 'student-resource-note')?.parentElement;
        if (host) {
            const clock = document.createElement('p');
            clock.className = 'lms-reading-live-clock text-xs font-semibold text-indigo-700 dark:text-indigo-300';
            clock.dataset.lmsReadingProgress = material.id;
            host.append(clock);
        }
    }

    lmsActiveSession.tickTimer = safeSetInterval(() => {
        if (!lmsActiveSession) return;
        const now = Date.now();
        if (lmsActiveSession.isRunning && (typeof document === 'undefined' || document.visibilityState === 'visible')) {
            const elapsed = Math.round((now - lmsActiveSession.lastTickTimestamp) / 1000);
            if (elapsed >= 1) {
                lmsActiveSession.activeSeconds += elapsed;
                lmsActiveSession.lastTickTimestamp = now;
            }
        } else {
            lmsActiveSession.lastTickTimestamp = now;
        }
        writeLmsHtmlSession(lmsActiveSession);
        const session = lmsActiveSession;
        if (session.readingRequiredSeconds > 0 && !session.readingComplete) {
            const seconds = Math.min(session.readingRequiredSeconds, session.readingActiveBase + session.activeSeconds);
            document.querySelectorAll('[data-lms-reading-progress]').forEach(node => {
                if (node.dataset.lmsReadingProgress === session.materialId) node.textContent = `Belajar aktif ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} / ${Math.ceil(session.readingRequiredSeconds / 60)} menit. Centang menunggu verifikasi waktu server.`;
            });
            if (seconds >= session.readingRequiredSeconds && !session.readingCheckpointPending && Date.now() >= (session.readingNextCheckAt || 0)) {
                session.readingCheckpointPending = true;
                void syncLmsActiveSessionDuration(false, session).finally(() => { session.readingCheckpointPending = false; session.readingNextCheckAt = Date.now() + 5000; });
            }
        }
    }, 1000);

    lmsActiveSession.heartbeatTimer = safeSetInterval(() => {
        syncLmsActiveSessionDuration(false);
    }, LMS_HEARTBEAT_INTERVAL_MS);

    return sessId;
}

async function syncLmsActiveSessionDuration(useKeepAlive = false, session = lmsActiveSession) {
    if (!session) return;

    if (session.isRunning && (typeof document === 'undefined' || document.visibilityState === 'visible')) {
        const elapsed = Math.round((Date.now() - session.lastTickTimestamp) / 1000);
        if (elapsed >= 1) {
            session.activeSeconds += elapsed;
            session.lastTickTimestamp = Date.now();
        }
    }

    const unsynced = session.activeSeconds - session.lastSyncedSeconds;
    if (session === lmsActiveSession) writeLmsHtmlSession(session);
    if (unsynced <= 0) return;

    const secondsToSend = session.activeSeconds;

    try {
        const payload = {
            material_id: session.materialId,
            action: 'sync_duration',
            session_id: session.sessionId,
            session_seconds: secondsToSend,
            student_nis: session.studentNis
        };

        const result = await cfTrackLmsStudentProgress(payload, useKeepAlive ? { keepalive: true } : {});
        session.lastSyncedSeconds = Math.max(session.lastSyncedSeconds, secondsToSend);
        if (session.readingRequiredSeconds > 0 && result?.reading_complete && !session.readingComplete) {
            session.readingComplete = true;
            document.querySelectorAll('[data-lms-reading-progress]').forEach(node => {
                if (node.dataset.lmsReadingProgress === session.materialId) node.textContent = '✓ Syarat waktu belajar terpenuhi.';
            });
            if (!useKeepAlive) {
                await loadStudentLmsData(true);
                if (typeof currentStudentResourceMaterial !== 'undefined' && currentStudentResourceMaterial?.id === session.materialId) {
                    const latest = studentLmsRawData.materials.find(item => item.id === session.materialId);
                    if (latest) currentStudentResourceMaterial = latest;
                    const button = document.getElementById('btn-student-resource-discussion');
                    if (button) { button.disabled = false; button.classList.remove('opacity-50'); button.removeAttribute('title'); }
                }
                if (typeof currentReadingStudentMaterial !== 'undefined' && currentReadingStudentMaterial?.id === session.materialId) {
                    const latest = studentLmsRawData.materials.find(item => item.id === session.materialId);
                    if (latest) currentReadingStudentMaterial = latest;
                    const quizDone = !(Number(latest?.quiz_enabled) === 1) || latest?.quiz_submitted || latest?.quiz_passed;
                    for (const id of ['btn-student-read-complete', 'btn-student-read-discussion']) {
                        const button = document.getElementById(id); if (button) { button.disabled = id === 'btn-student-read-discussion' && Number(latest?.quiz_enabled) === 1 && !quizDone; button.classList.toggle('opacity-50', button.disabled); button.title=button.disabled ? 'Kumpulkan Kuis Formatif terlebih dahulu.' : ''; }
                    }
                    if (typeof updateReaderAdjacentButtons === 'function') updateReaderAdjacentButtons();
                }
            }
        }
    } catch (err) {
        console.warn('[LMS Tracker] Gagal menyinkronkan durasi modul:', err);
    }
}

function stopLmsActiveSession(syncImmediately = true, preserveForRefresh = false) {
    if (!lmsActiveSession) return;
    const session = lmsActiveSession;

    if (session.tickTimer) safeClearInterval(session.tickTimer);
    if (session.heartbeatTimer) safeClearInterval(session.heartbeatTimer);

    if (session.isRunning && (typeof document === 'undefined' || document.visibilityState === 'visible')) {
        const elapsed = Math.round((Date.now() - session.lastTickTimestamp) / 1000);
        if (elapsed >= 1) {
            session.activeSeconds += elapsed;
            session.lastTickTimestamp = Date.now();
        }
    }
    session.isRunning = false;
    if (preserveForRefresh) writeLmsHtmlSession(session);
    else if (session.htmlRevision) clearLmsHtmlSession(session.studentNis);
    lmsActiveSession = null;

    if (syncImmediately) {
        void syncLmsActiveSessionDuration(false, session);
    }

    return session;
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (!lmsActiveSession) return;
        if (document.visibilityState === 'hidden') {
            if (lmsActiveSession.isRunning) {
                const elapsed = Math.round((Date.now() - lmsActiveSession.lastTickTimestamp) / 1000);
                if (elapsed >= 1) lmsActiveSession.activeSeconds += elapsed;
                lmsActiveSession.isRunning = false;
                void syncLmsActiveSessionDuration(true);
            }
        } else if (document.visibilityState === 'visible') {
            lmsActiveSession.isRunning = true;
            lmsActiveSession.lastTickTimestamp = Date.now();
        }
    });

    window.addEventListener('pagehide', () => {
        if (lmsActiveSession) {
            const session = stopLmsActiveSession(false, true);
            void syncLmsActiveSessionDuration(true, session);
        }
    });
}

async function trackStudentItemOpened(material, sessionId = '') {
    const nis = currentNIS || currentStudent?.nis || sessionStorage.getItem('student_nis');
    const studentName = currentStudent?.name || currentStudent?.nama || sessionStorage.getItem('student_name') || 'Siswa';
    const studentClass = currentStudent?.class || currentStudent?.kelas || currentStudent?.rombel || sessionStorage.getItem('student_class');
    if (!material) return false;
    if (material.is_locked) {
        if (typeof showCustomPopup === 'function') {
            showCustomPopup('warning', 'Modul Masih Terkunci', material.unlock_reason || 'Selesaikan modul sebelumnya terlebih dahulu.');
        } else if (typeof window.showPopup === 'function') {
            window.showPopup('Modul Masih Terkunci', material.unlock_reason || 'Selesaikan modul sebelumnya terlebih dahulu.', 'warning');
        }
        return false;
    }
    if (!nis || !studentClass) return false;

    const payload = {
        material_id: material.id,
        student_nis: nis,
        student_name: studentName,
        student_class: studentClass,
        action: 'open'
    };
    if (sessionId) payload.session_id = sessionId;

    await cfTrackLmsStudentProgress(payload);
    if (String(currentNIS || currentStudent?.nis || sessionStorage.getItem('student_nis')) !== String(nis)) return false;
    // The server has already checked class, publication, schedule and prerequisites.
    // A secondary list refresh must not revoke that successful open.
    material.is_opened = true;
    const refreshed = await loadStudentLmsData(true);
    if (String(currentNIS || currentStudent?.nis || sessionStorage.getItem('student_nis')) !== String(nis)) return false;
    if (!refreshed) processAndRenderStudentLms(studentLmsRawData);
    return true;
}

let currentStudentResourceMaterial = null;
let studentHtmlStateController = null;
let studentHtmlResumeAttempted = false;

async function resumeStudentHtmlMaterial() {
    if (studentHtmlResumeAttempted) return;
    studentHtmlResumeAttempted = true;
    const nis = currentNIS || currentStudent?.nis;
    const saved = readLmsHtmlSession(nis);
    if (!saved) return;
    const material = (studentLmsRawData.materials || []).find(m => m.id === saved.materialId);
    if (!material || material.is_locked || material.resource_type !== 'html') {
        clearLmsHtmlSession(nis);
        return;
    }
    await window.openStudentMaterial(material.id);
}

/**
 * Membuka video/dokumen/tautan di popup internal dan mencatat syarat "sudah dibuka".
 */
window.openStudentMaterial = async function (materialId) {
    studentHtmlResumeAttempted = true;
    let material = (studentLmsRawData.materials || []).find(m => m.id === materialId);
    if (!material) return;
    if (material.is_locked) {
        if (typeof window.showPopup === 'function') window.showPopup('Modul Masih Terkunci', material.unlock_reason || 'Selesaikan modul sebelumnya.', 'warning');
        return;
    }

    const studentNis = currentNIS || currentStudent?.nis || sessionStorage.getItem('student_nis');
    const savedSession = material.resource_type === 'html' ? readLmsHtmlSession(studentNis) : null;
    const resumed = savedSession?.materialId === material.id && savedSession.revision === lmsHtmlRevision(material.content_description || '') ? savedSession : null;
    const sessionId = resumed?.sessionId || generateLmsSessionId();
    try {
        const tracked = await trackStudentItemOpened(material, sessionId);
        if (!tracked) {
            stopLmsActiveSession(false);
            return;
        }
        material = (studentLmsRawData.materials || []).find(m => m.id === materialId);
        if (!material || material.is_locked) {
            stopLmsActiveSession(false);
            return;
        }
    } catch (err) {
        stopLmsActiveSession(false);
        console.error('[LMS Progress] Gagal membuka modul:', err);
        const detail = err.message || 'Silakan coba lagi.';
        const connectionFailed = !err.status && /failed to fetch|network|load failed|timeout|koneksi/i.test(detail);
        if (typeof window.showPopup === 'function') window.showPopup(
            connectionFailed ? 'Koneksi LMS Terganggu' : 'Materi Tidak Dapat Dibuka',
            connectionFailed ? `Pencatatan pembukaan materi belum dapat dikonfirmasi. Periksa koneksi lalu coba buka lagi. (${detail})` : detail,
            'error'
        );
        return;
    }

    startLmsActiveSession(material, sessionId, resumed);
    const isHtml = material.resource_type === 'html';
    if (isHtml && lmsActiveSession?.materialId === material.id) {
        lmsActiveSession.htmlRevision = lmsHtmlRevision(material.content_description || '');
        writeLmsHtmlSession(lmsActiveSession);
    }
    const resourceLink = isHtml ? null : resolveLmsResourceLink(material.resource_url || '', material.resource_type);
    const embeddedUrl = resourceLink?.embedUrl || '';
    const isExternal = !isHtml && Boolean(resourceLink && !embeddedUrl);
    if (isHtml) {
        try { validateLmsHtml(material.content_description); }
        catch (error) {
            stopLmsActiveSession(true);
            if (typeof window.showPopup === 'function') window.showPopup('Materi HTML Belum Tersedia', error.message, 'warning');
            return;
        }
    }
    if (!isHtml && !resourceLink) {
        stopLmsActiveSession(true);
        if (typeof window.showPopup === 'function') window.showPopup('Materi Belum Tersedia', 'Tautan materi belum valid atau belum diisi oleh guru.', 'warning');
        return;
    }

    currentStudentResourceMaterial = material;
    void window.resetStudentResourceFullscreen?.();
    const modal = document.getElementById('modal-student-resource');
    const frame = document.getElementById('student-resource-frame');
    const loader = document.getElementById('student-resource-loader');
    const titleEl = document.getElementById('student-resource-title');
    const typeEl = document.getElementById('student-resource-type');
    const fallback = document.getElementById('student-resource-fallback-link');
    const discBtn = document.getElementById('btn-student-resource-discussion');
    const external = document.getElementById('student-resource-external');
    const externalLink = document.getElementById('student-resource-open-link');
    if (!modal || !frame) {
        stopLmsActiveSession(true);
        return;
    }

    if (titleEl) titleEl.textContent = material.title || 'Materi Pembelajaran';
    if (typeEl) typeEl.textContent = isHtml ? 'HTML Interaktif' : material.resource_type === 'youtube' ? 'Video' : (material.resource_type === 'gdrive' ? 'Dokumen' : 'Materi Web');
    document.getElementById('btn-student-resource-fullscreen')?.classList.toggle('hidden', !isHtml);
    const guide = document.getElementById('student-resource-instructions');
    const guideBody = document.getElementById('student-resource-instructions-body');
    const instructions = getLmsMaterialInstructions(material);
    if (guide) { guide.classList.toggle('hidden', !instructions.trim()); guide.open = true; }
    if (guideBody) guideBody.innerHTML = renderSafeMarkdown(instructions);
    const resourceNote = document.getElementById('student-resource-note');
    if (resourceNote) resourceNote.textContent = isHtml ? 'Materi interaktif dapat digunakan langsung. Durasi belajar aktif tetap dicatat.' :
        isExternal ? 'Setelah belajar di situs sumber, kembali ke LMS untuk berdiskusi atau menandai materi selesai.' :
            'Jika sumber menolak tampil di dalam aplikasi, gunakan tombol “Buka eksternal”.';
    const engagement = document.getElementById('student-resource-engagement-info');
    if (engagement) engagement.textContent = isExternal ?
        'Pembukaan materi dicatat di LMS.' :
        'Guru dapat memantau aktivitas, progres, dan durasi belajar aktifmu di LMS. Ikuti petunjuk dan kerjakan latihan hingga tuntas.';
    if (fallback) {
        fallback.classList.toggle('hidden', isHtml || isExternal);
        fallback.href = resourceLink?.url || '#';
    }
    external?.classList.toggle('hidden', !isExternal);
    frame.classList.toggle('hidden', isExternal);
    if (externalLink) externalLink.href = isExternal ? resourceLink.url : '#';
    const sourceName = document.getElementById('student-resource-source');
    if (sourceName) sourceName.textContent = resourceLink?.hostname || '';
    const externalReason = document.getElementById('student-resource-external-reason');
    if (externalReason) externalReason.textContent = resourceLink?.isCanva ?
        'Website Canva dibuka di tab browser agar materi dan latihan interaktif dapat digunakan.' :
        'Materi ini dibuka di situs sumber. Tekan tombol berikut untuk mulai belajar.';

    if (discBtn) {
        const hasDiscussion = Boolean(material.discussion_required || Number(material.allow_discussion) === 1);
        const quizDone = !(Number(material.quiz_enabled ?? (material.resource_type === 'quiz' ? 1 : 0)) === 1) || material.quiz_submitted || material.quiz_passed;
        const nextQuiz = Number(material.quiz_enabled ?? (material.resource_type === 'quiz' ? 1 : 0)) === 1 && !quizDone;
        discBtn.textContent = nextQuiz ? 'Lanjut ke Kuis' : 'Diskusi';
        discBtn.disabled = material.reading_complete === false;
        discBtn.classList.toggle('opacity-50', discBtn.disabled);
        discBtn.title = discBtn.disabled ? 'Selesaikan waktu belajar minimal 5 menit untuk berdiskusi.' : 'Buka diskusi';
        if (hasDiscussion || nextQuiz) {
            discBtn.classList.remove('hidden');
        } else {
            discBtn.classList.add('hidden');
        }
    }

    if (loader) loader.classList.toggle('hidden', isExternal);
    frame.onload = () => loader?.classList.add('hidden');
    studentHtmlStateController?.dispose();
    studentHtmlStateController = null;
    const draftStatus = document.getElementById('student-resource-draft-status');
    if (draftStatus) { draftStatus.classList.toggle('hidden', !isHtml); draftStatus.textContent = ''; }
    if (isHtml) {
        studentHtmlStateController = attachLmsHtmlState(frame, {
            nis: studentNis, materialId: material.id, code: material.content_description,
            getStudentId: () => currentNIS || currentStudent?.nis,
            onStatus: status => {
                if (draftStatus) draftStatus.textContent = status === 'saved' ? 'Jawaban dicadangkan di perangkat ini.' :
                    status === 'restoring' ? 'Memulihkan cadangan jawaban...' : status === 'failed' ?
                        'Cadangan jawaban tidak dapat disimpan. Jangan refresh sebelum menyelesaikan latihan.' : 'Cadangan otomatis jawaban aktif di perangkat ini.';
            }
        });
        setLmsHtmlFrame(frame, material.content_description, material.title, studentHtmlStateController.bootstrap);
    }
    else {
        frame.removeAttribute('srcdoc');
        frame.removeAttribute('sandbox');
        frame.removeAttribute('referrerpolicy');
        frame.setAttribute('allow', 'autoplay; encrypted-media; fullscreen; picture-in-picture');
        frame.src = embeddedUrl || 'about:blank';
        // Neither a launch card nor a hidden LMS tab measures learning on another site.
        if (isExternal) stopLmsActiveSession(false);
    }
    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
};

window.closeStudentResourceModal = function () {
    void window.resetStudentResourceFullscreen?.();
    studentHtmlStateController?.dispose();
    studentHtmlStateController = null;
    stopLmsActiveSession(true);
    currentStudentResourceMaterial = null;
    const discBtn = document.getElementById('btn-student-resource-discussion');
    if (discBtn) discBtn.classList.add('hidden');
    const modal = document.getElementById('modal-student-resource');
    const frame = document.getElementById('student-resource-frame');
    if (modal) modal.classList.add('hidden');
    if (frame) {
        if (frame.hasAttribute('srcdoc')) frame.srcdoc = '';
        else frame.src = 'about:blank';
        frame.onload = null;
    }
    document.body.classList.remove('overflow-hidden');
};

installLmsResourceFullscreen();

window.openDiscussionFromResourceModal = async function () {
    if (!currentStudentResourceMaterial) return;
    const mat = currentStudentResourceMaterial;
    window.closeStudentResourceModal();
    const quizDone = !(Number(mat.quiz_enabled ?? (mat.resource_type === 'quiz' ? 1 : 0)) === 1) || mat.quiz_submitted || mat.quiz_passed;
    if (!quizDone) return await window.openStudentQuiz(mat.id);
    return await window.openStudentLmsDiscussion(mat.id, mat.title);
};

/**
 * Siswa menandai modul materi telah tuntas dipelajari
 */
window.markStudentMaterialComplete = async function (materialId) {
    const nis = currentNIS || currentStudent?.nis || sessionStorage.getItem('student_nis');
    const studentName = currentStudent?.name || currentStudent?.nama || sessionStorage.getItem('student_name') || 'Siswa';
    const studentClass = currentStudent?.class || currentStudent?.kelas || currentStudent?.rombel || sessionStorage.getItem('student_class');

    if (!nis || !studentClass) return;

    const material = (studentLmsRawData.materials || []).find(m => m.id === materialId);
    if (!material) return;

    if (material.requirement_met) return;
    if (material.is_locked) {
        if (typeof window.showPopup === 'function') window.showPopup('Modul Masih Terkunci', material.unlock_reason || 'Selesaikan modul sebelumnya.', 'warning');
        return;
    }
    if (material.discussion_required && !material.discussion_completed) {
        if (typeof window.showPopup === 'function') window.showPopup('Diskusi Wajib', 'Kirim tanggapan diskusi pada modul ini untuk menyelesaikan pembelajaran.', 'warning');
        return;
    }

    if (!material.is_opened) {
        if (typeof window.showPopup === 'function') {
            window.showPopup('Materi Belum Dibuka', 'Harap buka dan pelajari modul ini terlebih dahulu sebelum menandai selesai.', 'warning');
        }
        return;
    }

    try {
        const payload = {
            material_id: materialId,
            student_nis: nis,
            student_name: studentName,
            student_class: studentClass,
            action: 'complete'
        };
        const progressSession = lmsActiveSession?.materialId === materialId ? lmsActiveSession : null;
        if (progressSession) {
            if (lmsActiveSession.isRunning && (typeof document === 'undefined' || document.visibilityState === 'visible')) {
                const elapsed = Math.round((Date.now() - lmsActiveSession.lastTickTimestamp) / 1000);
                if (elapsed >= 1) lmsActiveSession.activeSeconds += elapsed;
                lmsActiveSession.lastTickTimestamp = Date.now();
            }
            payload.session_id = lmsActiveSession.sessionId;
            payload.session_seconds = lmsActiveSession.activeSeconds;
        }

        await cfTrackLmsStudentProgress(payload);
        if (progressSession) progressSession.lastSyncedSeconds = Math.max(progressSession.lastSyncedSeconds, payload.session_seconds);

        if (!await loadStudentLmsData(true)) throw new Error('Progres tersimpan. Muat ulang LMS untuk memperbarui tampilan.');

        if (typeof window.triggerLmsCelebration === 'function') {
            window.triggerLmsCelebration();
        }

        if (typeof window.showPopup === 'function') {
            window.showPopup('Modul Selesai!', 'Selamat! Kamu telah berhasil menyelesaikan modul pembelajaran ini.', 'success');
        }
    } catch (err) {
        console.error('[LMS Progress] Error marking complete:', err);
        if (typeof window.showPopup === 'function') {
            window.showPopup('Progres Gagal Disimpan', err.message || 'Silakan coba lagi.', 'error');
        }
    }
};

// =========================================================================
// MODUL PEMBACA TEKS MANDIRI SISWA (ZEN READING EXPERIENCE)
// =========================================================================

let currentReadingStudentMaterial = null;

function updateReaderAdjacentButtons() {
    const btnPrev = document.getElementById('btn-student-read-prev');
    const btnNext = document.getElementById('btn-student-read-next');
    if (!btnPrev || !btnNext || !currentReadingStudentMaterial) return;

    const materials = (studentLmsRawData.materials || []).filter(m => m.material_enabled !== 0 && m.resource_type === 'text' && m.subject_name === currentReadingStudentMaterial.subject_name);
    const idx = materials.findIndex(m => m.id === currentReadingStudentMaterial.id);

    btnPrev.disabled = idx <= 0 || materials[idx - 1]?.is_locked;
    btnNext.disabled = idx < 0 || idx >= materials.length - 1 || materials[idx + 1]?.is_locked;
}

window.navigateAdjacentMaterial = function (direction) {
    if (!currentReadingStudentMaterial) return;
    const materials = (studentLmsRawData.materials || []).filter(m => m.material_enabled !== 0 && m.resource_type === 'text' && m.subject_name === currentReadingStudentMaterial.subject_name);
    const idx = materials.findIndex(m => m.id === currentReadingStudentMaterial.id);
    const targetIdx = idx + direction;

    if (targetIdx >= 0 && targetIdx < materials.length) {
        window.openStudentReadMaterial(materials[targetIdx].id);
    }
};

window.adjustReaderFontSize = function (delta) {
    currentReaderFontSize = Math.min(22, Math.max(12, currentReaderFontSize + delta * 2));
    const contentEl = document.getElementById('student-read-content');
    if (contentEl) {
        contentEl.style.fontSize = `${currentReaderFontSize}px`;
    }
};

window.onReaderScroll = function (el) {
    if (!el) return;
    const maxScroll = el.scrollHeight - el.clientHeight;
    const pct = maxScroll > 0 ? Math.min(100, Math.round((el.scrollTop / maxScroll) * 100)) : 100;
    const pBar = document.getElementById('student-read-progress-bar');
    if (pBar) {
        pBar.style.width = `${pct}%`;
    }
};

window.openStudentReadMaterial = async function (materialId) {
    let material = (studentLmsRawData.materials || []).find(m => m.id === materialId);
    if (!material) return;
    if (material.is_locked) {
        if (typeof window.showPopup === 'function') {
            window.showPopup('Modul Masih Terkunci', material.unlock_reason || 'Selesaikan modul sebelumnya terlebih dahulu.', 'warning');
        }
        return;
    }

    const sessionId = generateLmsSessionId();
    startLmsActiveSession(material, sessionId);

    try {
        const tracked = await trackStudentItemOpened(material, sessionId);
        if (!tracked) {
            stopLmsActiveSession(false);
            return;
        }
        material = (studentLmsRawData.materials || []).find(m => m.id === materialId);
        if (!material || material.is_locked) {
            stopLmsActiveSession(false);
            return;
        }
    } catch (err) {
        stopLmsActiveSession(false);
        console.error('[LMS Reader Track error]:', err);
        if (typeof window.showPopup === 'function') window.showPopup('Materi Tidak Dapat Dibuka', err.message || 'Silakan coba lagi.', 'error');
        return;
    }

    currentReadingStudentMaterial = material;
    const modal = document.getElementById('modal-student-read-material');
    const titleEl = document.getElementById('student-read-title');
    const subjectEl = document.getElementById('student-read-subject');
    const teacherEl = document.getElementById('student-read-teacher');
    const statusBadge = document.getElementById('student-read-status-badge');
    const dueBadge = document.getElementById('student-read-due-badge');
    const contentEl = document.getElementById('student-read-content');
    const btnComplete = document.getElementById('btn-student-read-complete');
    const discLabel = document.getElementById('student-read-disc-label');
    const btnDisc = document.getElementById('btn-student-read-discussion');
    const timeEstEl = document.getElementById('student-read-time-est');
    const scrollContainer = document.getElementById('student-read-scroll-container');
    const pBar = document.getElementById('student-read-progress-bar');

    if (titleEl) titleEl.textContent = material.title || 'Modul Pembelajaran';
    if (subjectEl) subjectEl.textContent = material.subject_name || '-';
    if (teacherEl) teacherEl.textContent = `Pengampu: ${formatTeacherDisplayName(material.teacher_name)}`;

    const isDone = Boolean(material.requirement_met);
    if (statusBadge) {
        if (isDone) {
            statusBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 flex items-center gap-1';
            statusBadge.innerHTML = '<i class="fa-solid fa-check"></i> Sudah Dibuka';
        } else {
            statusBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 flex items-center gap-1';
            statusBadge.innerHTML = '<i class="fa-solid fa-book-open-reader"></i> Sedang Membaca';
        }
    }

    if (dueBadge) {
        if (material.due_date) {
            const urgency = calculateDueDateUrgency(material.due_date, isDone);
            dueBadge.className = `px-2 py-0.5 rounded-md border text-[10px] flex items-center gap-1 ${urgency.badgeClass}`;
            dueBadge.innerHTML = `<i class="${urgency.icon}"></i> <span>${window.escapeHTML(urgency.label)}</span>`;
            dueBadge.classList.remove('hidden');
        } else {
            dueBadge.classList.add('hidden');
        }
    }

    const rawText = material.content_description || '';
    if (timeEstEl) {
        const wordCount = rawText.trim() ? rawText.trim().split(/\s+/).length : 0;
        const estMinutes = Math.max(1, Math.ceil(wordCount / 180));
        timeEstEl.innerHTML = `<i class="fa-solid fa-stopwatch text-slate-400"></i> <span>~${estMinutes} mnt baca</span>`;
    }

    if (contentEl) {
        if (rawText.trim()) {
            contentEl.innerHTML = renderSafeMarkdown(rawText);
        } else {
            contentEl.innerHTML = '<p class="text-xs text-slate-400 italic">Tidak ada teks instruksi/materi yang disertakan.</p>';
        }
        contentEl.style.fontSize = `${currentReaderFontSize}px`;
    }

    if (scrollContainer) scrollContainer.scrollTop = 0;
    if (pBar) pBar.style.width = '0%';

    if (btnComplete) {
        if (isDone) {
            btnComplete.className = 'px-4 py-2 bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 rounded-xl text-xs font-bold transition flex items-center gap-1.5';
            btnComplete.innerHTML = '<i class="fa-solid fa-circle-check"></i> <span>Tuntas</span>';
        } else {
            btnComplete.className = 'px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-xs active:scale-95';
            btnComplete.innerHTML = '<i class="fa-solid fa-check"></i> <span>Tandai Selesai</span>';
        }
    }

    const discCount = Number(material.discussion_count) || 0;
    if (discLabel) {
        discLabel.textContent = `Diskusi (${discCount})`;
    }
    const quizDone = !(Number(material.quiz_enabled ?? (material.resource_type === 'quiz' ? 1 : 0)) === 1) || material.quiz_submitted || material.quiz_passed;
    const pendingQuiz = Number(material.quiz_enabled ?? (material.resource_type === 'quiz' ? 1 : 0)) === 1 && !quizDone;
    if (btnDisc) {
        btnDisc.style.display = Number(material.allow_discussion) === 1 ? 'inline-flex' : 'none';
        btnDisc.disabled = material.reading_complete === false || pendingQuiz;
    }
    if (btnComplete && pendingQuiz) btnComplete.innerHTML = '<span>Lanjut ke Kuis</span>';
    if (btnComplete) btnComplete.disabled = material.reading_complete === false;
    for (const button of [btnComplete, btnDisc]) {
        if (button) { button.classList.toggle('opacity-50', button.disabled); button.title = button.disabled ? 'Selesaikan waktu belajar minimal 5 menit.' : ''; }
    }

    updateReaderAdjacentButtons();

    if (modal) modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
};

window.closeStudentReadMaterialModal = function () {
    stopLmsActiveSession(true);
    currentReadingStudentMaterial = null;
    const modal = document.getElementById('modal-student-read-material');
    if (modal) modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
};

window.markCurrentReadingMaterialComplete = async function () {
    if (!currentReadingStudentMaterial) return;
    const quizDone = !(Number(currentReadingStudentMaterial.quiz_enabled ?? (currentReadingStudentMaterial.resource_type === 'quiz' ? 1 : 0)) === 1) || currentReadingStudentMaterial.quiz_submitted || currentReadingStudentMaterial.quiz_passed;
    if (!quizDone) {
        const id=currentReadingStudentMaterial.id;window.closeStudentReadMaterialModal();return window.openStudentQuiz(id);
    }
    if (currentReadingStudentMaterial.discussion_required && !currentReadingStudentMaterial.discussion_completed) {
        window.openDiscussionFromReader();
        return;
    }
    const materialId = currentReadingStudentMaterial.id;
    await window.markStudentMaterialComplete(materialId);
    await window.openStudentReadMaterial(materialId);
};

window.openDiscussionFromReader = function () {
    if (!currentReadingStudentMaterial) return;
    const mat = currentReadingStudentMaterial;
    window.closeStudentReadMaterialModal();
    const quizDone = !(Number(mat.quiz_enabled ?? (mat.resource_type === 'quiz' ? 1 : 0)) === 1) || mat.quiz_submitted || mat.quiz_passed;
    if (!quizDone) return window.openStudentQuiz(mat.id);
    window.openStudentLmsDiscussion(mat.id, mat.title);
};

/**
 * Efek selebrasi gamifikasi konfeti saat siswa menyelesaikan seluruh materi atau menandai selesai
 */
window.triggerLmsCelebration = function () {
    const canvas = document.getElementById('lms-confetti-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.classList.remove('hidden');

    const particles = [];
    const colors = ['#10B981', '#06B6D4', '#6366F1', '#F59E0B', '#EC4899', '#3B82F6', '#14B8A6'];
    const count = 75;

    for (let i = 0; i < count; i++) {
        particles.push({
            x: canvas.width / 2 + (Math.random() - 0.5) * 240,
            y: canvas.height * 0.45 + (Math.random() - 0.5) * 120,
            vx: (Math.random() - 0.5) * 12,
            vy: (Math.random() - 0.8) * 15 - 3,
            size: Math.random() * 8 + 4,
            color: colors[Math.floor(Math.random() * colors.length)],
            rotation: Math.random() * 360,
            rotationSpeed: (Math.random() - 0.5) * 10,
            opacity: 1
        });
    }

    let animationFrame;
    const startTime = Date.now();
    const duration = 2600;

    function renderConfetti() {
        const elapsed = Date.now() - startTime;
        if (elapsed > duration) {
            cancelAnimationFrame(animationFrame);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            canvas.classList.add('hidden');
            return;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        particles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.38;
            p.rotation += p.rotationSpeed;
            p.opacity = Math.max(0, 1 - (elapsed / duration));

            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate((p.rotation * Math.PI) / 180);
            ctx.globalAlpha = p.opacity;
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
            ctx.restore();
        });

        animationFrame = requestAnimationFrame(renderConfetti);
    }

    renderConfetti();
};

// =========================================================================
// 📝 MODUL KUIS FORMATIF SISWA (MICRO-QUIZ ENGINE & AUTO-GRADING)
// =========================================================================

installStudentQuiz({
    api: { start: cfStartLmsQuiz, save: cfSaveLmsQuizAnswers, submit: cfSubmitLmsQuiz, violation: cfReportLmsQuizViolation },
    getMaterial: id => (studentLmsRawData.materials || []).find(m => m.id === id),
    getStudentId: () => currentNIS || currentStudent?.nis || '',
    notify: (title, message, type) => typeof window.showToast === 'function' ? window.showToast(title, message, type) : window.alert(message),
    onResult: async (material, attempt) => {
        material.my_quiz_score = attempt.result.score;
        material.quiz_submitted = attempt.status !== 'in_progress';
        material.my_status = (attempt.result.passed || attempt.status !== 'in_progress') ? 'completed' : 'opened';
        sessionStorage.removeItem(SESSION_CACHE_KEYS.LMS);
        await loadStudentLmsData(true);
    }
});

// Ruang diskusi siswa.
window.openStudentLmsDiscussion = async function (materialId, title) {
    const material = (studentLmsRawData.materials || []).find(m => m.id === materialId);
    if (!material) return;
    if (Number(material.allow_discussion) !== 1 && !material.discussion_required) {
        if (typeof window.showPopup === 'function') window.showPopup('Forum Tidak Diaktifkan', 'Guru tidak mengaktifkan forum diskusi untuk modul ini.', 'info');
        return;
    }
    if (material.is_locked) {
        if (typeof window.showPopup === 'function') window.showPopup('Diskusi Masih Terkunci', material.unlock_reason || 'Selesaikan modul sebelumnya terlebih dahulu.', 'warning');
        return;
    }
    if (!material.is_opened) {
        if (typeof window.showPopup === 'function') window.showPopup('Buka Materi Terlebih Dahulu', 'Pelajari materi pada modul ini sebelum masuk ke diskusi.', 'warning');
        return;
    }

    activeStudentDiscussionMaterialId = materialId;
    activeStudentReplyingTo = null;
    window.cancelStudentLmsReply();

    const modal = document.getElementById('modal-student-lms-discussion');
    installLmsDiscussionLayout(modal);
    const discussionBody = modal?.querySelector('.lms-discussion-body');
    if (discussionBody) discussionBody.scrollTop = 0;
    const titleEl = document.getElementById('student-lms-discussion-title');
    const countBadge = document.getElementById('student-lms-discussion-count');
    const listEl = document.getElementById('student-lms-comments-list');
    const promptContainer = document.getElementById('student-lms-prompt-container');

    if (titleEl) titleEl.textContent = title || material.title || 'Diskusi Pembelajaran';
    if (promptContainer) promptContainer.innerHTML = '';
    if (listEl) {
        listEl.innerHTML = '<div class="text-center py-10 text-slate-400 text-xs"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Memuat ruang diskusi...</div>';
    }
    if (modal) modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');

    try {
        const res = await cfGetLmsDiscussions(materialId);
        if (activeStudentDiscussionMaterialId !== materialId) return;
        const comments = res.data || [];
        if (countBadge) countBadge.textContent = `${res.total_comments || 0} Tanggapan`;

        const prompt = res.material?.discussion_prompt || '';
        const teacherName = res.material?.teacher_name || 'Guru Mapel';
        renderStudentLmsPromptCard(prompt, teacherName);

        renderStudentLmsDiscussions(comments);
    } catch (err) {
        if (activeStudentDiscussionMaterialId !== materialId) return;
        console.error('[LMS Discussion Siswa] Error:', err);
        if (listEl) {
            listEl.innerHTML = `<div class="text-center py-8 text-rose-500 text-xs font-bold">Gagal memuat diskusi: ${window.escapeHTML(err.message)}</div>`;
        }
    }
};

window.closeStudentLmsDiscussion = function () {
    activeStudentDiscussionMaterialId = null;
    activeStudentReplyingTo = null;
    const promptContainer = document.getElementById('student-lms-prompt-container');
    if (promptContainer) promptContainer.innerHTML = '';
    const modal = document.getElementById('modal-student-lms-discussion');
    if (modal) modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
};

window.openStudentMaterialFromActiveDiscussion = async function () {
    const matId = activeStudentDiscussionMaterialId;
    if (!matId) return;
    const material = (studentLmsRawData.materials || []).find(m => m.id === matId);
    if (!material) return;
    window.closeStudentLmsDiscussion();
    if (material.resource_type === 'text') {
        return await window.openStudentReadMaterial(matId);
    } else {
        return await window.openStudentMaterial(matId);
    }
};

window.openStudentDiscussionMathPalette = function (target, triggerBtn = null) {
    const el = typeof target === 'string' ? document.getElementById(target) : target;
    const btn = typeof triggerBtn === 'string' ? document.getElementById(triggerBtn) : triggerBtn;
    if (el) openLmsMathPaletteModal(el, null, btn);
};

function renderStudentLmsPromptCard(prompt, teacherName) {
    const container = document.getElementById('student-lms-prompt-container');
    if (!container) return;

    if (prompt && prompt.trim() !== '') {
        container.innerHTML = `
            <div class="p-3.5 bg-gradient-to-r from-indigo-50/95 via-amber-50/80 to-transparent dark:from-indigo-950/40 dark:via-amber-950/30 dark:to-transparent border-2 border-indigo-200/90 dark:border-indigo-800/80 rounded-2xl shadow-2xs space-y-2">
                <div class="lms-discussion-prompt-toolbar flex items-center justify-between gap-2">
                    <div class="lms-discussion-prompt-identity flex items-center gap-2 min-w-0">
                        <span class="px-2.5 py-0.5 rounded-full bg-indigo-600 text-white text-[10px] font-extrabold flex items-center gap-1 shadow-2xs shrink-0">
                            <i class="fa-solid fa-lightbulb"></i> Masalah &amp; Pemantik Diskusi Guru
                        </span>
                        <span class="text-[11px] font-bold text-slate-700 dark:text-slate-300 truncate">
                            ${window.escapeHTML(formatTeacherDisplayName(teacherName))}
                        </span>
                    </div>
                    <button type="button" onclick="window.focusStudentDiscussionReply()"
                        class="px-2.5 py-1 rounded-lg text-[10px] font-extrabold bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1 shrink-0 transition shadow-2xs active:scale-95">
                        <i class="fa-solid fa-reply"></i>
                        <span>Tanggapi Masalah</span>
                    </button>
                </div>
                <div class="text-xs text-slate-800 dark:text-slate-100 font-semibold leading-relaxed pl-3 border-l-3 border-indigo-500">
                    ${renderSafeMarkdown(prompt)}
                </div>
                <p class="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                    💡 Berikan jawaban, tanggapan, atau pendapatmu terkait masalah pemantik guru di atas.
                </p>
            </div>
        `;
    } else {
        container.innerHTML = `
            <div class="p-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                <i class="fa-solid fa-circle-info text-indigo-500 text-sm shrink-0"></i>
                <span>Belum ada masalah pemantik khusus dari guru. Silakan ajukan pertanyaan atau tanggapanmu mengenai materi ini.</span>
            </div>
        `;
    }
}

window.focusStudentDiscussionReply = function () {
    const input = document.getElementById('input-student-lms-content');
    if (input) {
        input.focus();
        input.placeholder = 'Tuliskan tanggapan atau analisismu terhadap masalah pemantik guru di sini...';
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
};

function renderStudentLmsDiscussions(comments) {
    const listEl = document.getElementById('student-lms-comments-list');
    if (!listEl) return;

    currentStudentLmsCommentsMap.clear();
    const registerComments = (items) => {
        (items || []).forEach(it => {
            currentStudentLmsCommentsMap.set(String(it.id), it);
            if (it.replies && it.replies.length > 0) {
                registerComments(it.replies);
            }
        });
    };
    registerComments(comments);

    if (!comments || comments.length === 0) {
        listEl.innerHTML = `
            <div class="text-center py-10 text-slate-400 text-xs space-y-2">
                <i class="fa-solid fa-comments text-3xl opacity-30 text-indigo-500"></i>
                <p class="font-bold text-slate-600 dark:text-slate-300">Belum Ada Tanggapan Siswa</p>
                <p class="text-[11px] text-slate-400">Jadilah yang pertama memberikan tanggapan atas masalah pemantik di atas!</p>
            </div>
        `;
        return;
    }

    let html = '';

    comments.forEach(c => {
        const isGuru = c.user_role !== 'siswa';
        const roleBadge = isGuru
            ? '<span class="px-2 py-0.2 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 text-[9px] font-extrabold">Guru Mapel</span>'
            : '<span class="px-2 py-0.2 rounded bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 text-[9px] font-extrabold">Siswa</span>';

        const pinnedBadge = c.is_pinned === 1
            ? '<span class="px-2 py-0.2 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-[9px] font-extrabold flex items-center gap-1"><i class="fa-solid fa-thumbtack text-[9px]"></i> Disematkan Guru</span>'
            : '';

        const replies = c.replies || [];
        const cPhotoUrl = (!isGuru && c.user_photo_url) ? (typeof resolvePhotoUrl === 'function' ? resolvePhotoUrl(c.user_photo_url) : c.user_photo_url) : '';
        const cInitial = (c.user_name || 'S').charAt(0).toUpperCase();
        const cAvatarHtml = isGuru
            ? `<div class="w-7 h-7 rounded-full bg-emerald-600 text-white text-xs flex items-center justify-center font-black shrink-0 shadow-2xs"><i class="fa-solid fa-chalkboard-user text-[11px]"></i></div>`
            : cPhotoUrl
                ? `<div class="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs shrink-0 overflow-hidden ring-1 ring-blue-500/20 shadow-2xs"><img src="${cPhotoUrl}" alt="${window.escapeHTML(c.user_name)}" class="w-full h-full object-cover" onerror="this.onerror=null; this.parentElement.classList.add('bg-blue-600','text-white','font-black'); this.parentElement.innerHTML='${cInitial}';" /></div>`
                : `<div class="w-7 h-7 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center font-black shrink-0 shadow-2xs">${cInitial}</div>`;

        html += `
            <div class="p-3 rounded-xl border ${c.is_pinned ? 'border-amber-300 dark:border-amber-700/80 bg-amber-50/40 dark:bg-amber-950/20' : 'border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50'} space-y-2">
                <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2">
                        ${cAvatarHtml}
                        <div>
                            <div class="flex items-center gap-1.5 flex-wrap">
                                <span class="font-black text-xs text-slate-800 dark:text-slate-100">${window.escapeHTML(c.user_name)}</span>
                                ${roleBadge}
                                ${pinnedBadge}
                            </div>
                            <span class="text-[10px] text-slate-400 font-medium">${c.created_at || ''}</span>
                        </div>
                    </div>

                    <button onclick="window.replyToStudentLmsComment('${c.id}')"
                        class="p-1 px-1.5 rounded text-[11px] font-bold text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 flex items-center gap-1">
                        <i class="fa-solid fa-reply text-[10px]"></i>
                        <span class="hidden sm:inline">Balas</span>
                    </button>
                </div>

                <div class="text-xs text-slate-700 dark:text-slate-200 leading-relaxed pl-9">
                    ${renderSafeMarkdown(c.content)}
                </div>

                ${replies.length > 0 ? `
                    <div class="pl-7 pt-2 space-y-2 border-l-2 border-slate-200 dark:border-slate-700 ml-3">
                        ${replies.map(r => {
                            const rIsGuru = r.user_role !== 'siswa';
                            const rReplies = r.replies || [];
                            const rPhotoUrl = (!rIsGuru && r.user_photo_url) ? (typeof resolvePhotoUrl === 'function' ? resolvePhotoUrl(r.user_photo_url) : r.user_photo_url) : '';
                            const rInitial = (r.user_name || 'S').charAt(0).toUpperCase();
                            const rAvatarHtml = rIsGuru
                                ? `<div class="w-5 h-5 rounded-full bg-emerald-600 text-white text-[9px] flex items-center justify-center font-bold shrink-0 shadow-2xs"><i class="fa-solid fa-chalkboard-user text-[8px]"></i></div>`
                                : rPhotoUrl
                                    ? `<div class="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[9px] shrink-0 overflow-hidden ring-1 ring-blue-500/20 shadow-2xs"><img src="${rPhotoUrl}" alt="${window.escapeHTML(r.user_name)}" class="w-full h-full object-cover" onerror="this.onerror=null; this.parentElement.classList.add('bg-blue-600','text-white','font-bold'); this.parentElement.innerHTML='${rInitial}';" /></div>`
                                    : `<div class="w-5 h-5 rounded-full bg-blue-600 text-white text-[9px] flex items-center justify-center font-bold shrink-0 shadow-2xs">${rInitial}</div>`;

                            return `
                                <div class="p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 space-y-1.5 shadow-2xs">
                                    <div class="flex items-center justify-between gap-1.5">
                                        <div class="flex items-center gap-1.5 flex-wrap">
                                            ${rAvatarHtml}
                                            <span class="font-bold text-[11px] text-slate-800 dark:text-slate-200">${window.escapeHTML(r.user_name)}</span>
                                            ${rIsGuru ? '<span class="px-1.5 py-0.2 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 text-[8px] font-bold">Guru Mapel</span>' : '<span class="px-1.5 py-0.2 rounded bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 text-[8px] font-bold">Siswa</span>'}
                                            <span class="text-[9px] text-slate-400">${r.created_at || ''}</span>
                                        </div>
                                        <button onclick="window.replyToStudentLmsComment('${r.id}')"
                                            class="p-0.5 px-1.5 rounded text-[10px] font-bold text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 flex items-center gap-1 shrink-0"
                                            title="Balas tanggapan">
                                            <i class="fa-solid fa-reply text-[9px]"></i>
                                            <span>Balas</span>
                                        </button>
                                    </div>
                                    <div class="text-[11px] text-slate-600 dark:text-slate-300 leading-snug pl-6.5">
                                        ${renderSafeMarkdown(r.content)}
                                    </div>

                                    ${rReplies.length > 0 ? `
                                        <div class="pl-3.5 pt-1.5 space-y-1.5 border-l-2 border-indigo-200 dark:border-indigo-900 ml-1.5 mt-2">
                                            ${rReplies.map(r2 => {
                                                const r2IsGuru = r2.user_role !== 'siswa';
                                                const r2PhotoUrl = (!r2IsGuru && r2.user_photo_url) ? (typeof resolvePhotoUrl === 'function' ? resolvePhotoUrl(r2.user_photo_url) : r2.user_photo_url) : '';
                                                const r2Initial = (r2.user_name || 'S').charAt(0).toUpperCase();
                                                const r2AvatarHtml = r2IsGuru
                                                    ? `<div class="w-4.5 h-4.5 rounded-full bg-emerald-600 text-white text-[8px] flex items-center justify-center font-bold shrink-0 shadow-2xs"><i class="fa-solid fa-chalkboard-user text-[7px]"></i></div>`
                                                    : r2PhotoUrl
                                                        ? `<div class="w-4.5 h-4.5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[8px] shrink-0 overflow-hidden ring-1 ring-blue-500/20 shadow-2xs"><img src="${r2PhotoUrl}" alt="${window.escapeHTML(r2.user_name)}" class="w-full h-full object-cover" onerror="this.onerror=null; this.parentElement.classList.add('bg-blue-600','text-white','font-bold'); this.parentElement.innerHTML='${r2Initial}';" /></div>`
                                                        : `<div class="w-4.5 h-4.5 rounded-full bg-blue-600 text-white text-[8px] flex items-center justify-center font-bold shrink-0 shadow-2xs">${r2Initial}</div>`;

                                                return `
                                                    <div class="p-2 bg-slate-50/90 dark:bg-slate-950/60 rounded-lg border border-slate-100/90 dark:border-slate-800/80 space-y-1">
                                                        <div class="flex items-center gap-1.5 flex-wrap">
                                                            ${r2AvatarHtml}
                                                            <span class="font-bold text-[10px] text-slate-800 dark:text-slate-200">${window.escapeHTML(r2.user_name)}</span>
                                                            ${r2IsGuru ? '<span class="px-1 py-0.2 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 text-[7px] font-bold">Guru Mapel</span>' : '<span class="px-1 py-0.2 rounded bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 text-[7px] font-bold">Siswa</span>'}
                                                            <span class="text-[8px] text-slate-400">${r2.created_at || ''}</span>
                                                        </div>
                                                        <div class="text-[10px] text-slate-600 dark:text-slate-300 leading-snug pl-6">
                                                            ${renderSafeMarkdown(r2.content)}
                                                        </div>
                                                    </div>
                                                `;
                                            }).join('')}
                                        </div>
                                    ` : ''}
                                </div>
                            `;
                        }).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    });

    listEl.innerHTML = html;
}

window.replyToStudentLmsComment = function (commentId, explicitAuthorName) {
    const commentObj = currentStudentLmsCommentsMap.get(String(commentId));
    const authorName = explicitAuthorName || commentObj?.user_name || 'Tanggapan';
    activeStudentReplyingTo = { id: commentId, name: authorName };
    const banner = document.getElementById('student-lms-replying-banner');
    const nameEl = document.getElementById('student-lms-replying-name');
    const input = document.getElementById('input-student-lms-content');

    if (banner) banner.classList.remove('hidden');
    if (nameEl) nameEl.textContent = authorName;
    if (input) {
        input.focus();
        input.placeholder = `Balas tanggapan ${authorName}...`;
    }
};

window.cancelStudentLmsReply = function () {
    activeStudentReplyingTo = null;
    const banner = document.getElementById('student-lms-replying-banner');
    const input = document.getElementById('input-student-lms-content');
    if (banner) banner.classList.add('hidden');
    if (input) input.placeholder = 'Tuliskan pertanyaan, tanggapan, atau pendapatmu di sini...';
};

window.sendStudentLmsComment = async function () {
    if (!activeStudentDiscussionMaterialId) return;
    const materialId = activeStudentDiscussionMaterialId;

    const input = document.getElementById('input-student-lms-content');
    const content = (input?.value || '').trim();
    if (!content) return;

    const btnSend = document.getElementById('btn-send-student-lms-comment');
    if (btnSend?.disabled) return;
    if (btnSend) btnSend.disabled = true;

    const nis = currentNIS || currentStudent?.nis || sessionStorage.getItem('student_nis') || 'siswa';
    const studentName = currentStudent?.name || currentStudent?.nama || sessionStorage.getItem('student_name') || 'Siswa';

    try {
        await cfSaveLmsDiscussion({
            material_id: materialId,
            parent_id: activeStudentReplyingTo ? activeStudentReplyingTo.id : null,
            user_id: nis,
            user_name: studentName,
            user_role: 'siswa',
            content
        });

        if (activeStudentDiscussionMaterialId !== materialId) return;
        if (input && input.value.trim() === content) input.value = '';
        window.cancelStudentLmsReply();

        const res = await cfGetLmsDiscussions(materialId);
        if (activeStudentDiscussionMaterialId !== materialId) return;
        const countBadge = document.getElementById('student-lms-discussion-count');
        if (countBadge) countBadge.textContent = `${res.total_comments || 0} Tanggapan`;
        renderStudentLmsDiscussions(res.data || []);
        if (!await loadStudentLmsData(true)) return;
        if (typeof window.showPopup === 'function') {
            window.showPopup('Tanggapan Terkirim', 'Syarat diskusi sudah terpenuhi. Modul berikutnya kini dapat dibuka.', 'success');
        }
    } catch (err) {
        console.error('[LMS Discussion Siswa] Gagal kirim:', err);
        if (typeof window.showPopup === 'function') window.showPopup('Tanggapan Belum Terkirim', err.message || 'Periksa koneksi dan muat ulang diskusi.', 'error');
    } finally {
        if (btnSend) btnSend.disabled = false;
    }
};

window.loadStudentLmsData = loadStudentLmsData;

// =====================================================================
// 🪪 MODUL KARTU PELAJAR DIGITAL (E-KTS) & FOTO RESMI R2
// Standar Internasional ISO/IEC 7810 ID-1 (CR-80: 85.60 mm x 53.98 mm)
// Single Source of Truth (SSOT): js/student-card-renderer.js
// =====================================================================

let currentStudentCardSide = 'front'; // 'front' | 'back'
let currentStudentPhotoToken = '';
let studentCardPhotoInfo = null;
let cropImageObj = null;
let cropScale = 1.0;
let cropOffsetX = 0;
let cropOffsetY = 0;
let isDraggingCrop = false;
let dragStartX = 0;
let dragStartY = 0;

/**
 * Memuat Data Kartu Pelajar Digital, Status Foto R2, dan Render QR Code - SSOT StudentCardRenderer
 */
async function loadStudentCardData() {
    const nis = currentNIS || currentStudent?.nis || sessionStorage.getItem('student_nis');
    if (!nis) {
        console.warn('[StudentCard] NIS siswa tidak tersedia.');
        return;
    }

    const workerUrl = CLOUDFLARE_CONFIG?.WORKER_URL || "https://simas-demo-api.komangpurna1.workers.dev";
    
    // Tampilkan data teks siswa ke kartu depan & hub
    const studentName = currentStudent?.name || currentStudent?.nama || sessionStorage.getItem('student_name') || '-';
    const studentClass = currentStudent?.class || currentStudent?.kelas || sessionStorage.getItem('student_class') || '-';
    const studentNisn = currentStudent?.nisn || '-';
    const studentTtl = (currentStudent?.birthPlace || currentStudent?.birth_place ? (currentStudent.birthPlace || currentStudent.birth_place) + ', ' : '') + 
                       (currentStudent?.birthDate || currentStudent?.birth_date || '-');

    // SSOT: Render Kartu Interaktif 3D Depan & Belakang secara terpadu
    const studentDataObj = currentStudent || {
        nis,
        name: studentName,
        class: studentClass,
        nisn: studentNisn,
        birthPlace: currentStudent?.birthPlace || currentStudent?.birth_place || '',
        birthDate: currentStudent?.birthDate || currentStudent?.birth_date || '',
        address: currentStudent?.address || currentStudent?.alamat || sessionStorage.getItem('student_address') || '',
        alamat: currentStudent?.alamat || currentStudent?.address || sessionStorage.getItem('student_address') || '',
        dusun: currentStudent?.dusun || '',
        kelurahan: currentStudent?.kelurahan || currentStudent?.desa || '',
        desa: currentStudent?.desa || currentStudent?.kelurahan || '',
        kecamatan: currentStudent?.kecamatan || ''
    };

    const cardResult = renderKtsInteractiveCard('student-card-3d', studentDataObj, {
        qrId: 'kts-front-qr-box'
    });
    if (typeof updateKtsCardScale === 'function') {
        updateKtsCardScale('student-card-3d');
    }

    // Tampilkan data ke Panel Rincian Smart Pass Hub di samping kartu
    const hubName = document.getElementById('student-hub-name');
    if (hubName) hubName.textContent = studentName;
    const hubNisNisn = document.getElementById('student-hub-nis-nisn');
    if (hubNisNisn) hubNisNisn.textContent = `${nis} / ${studentNisn}`;
    const hubClass = document.getElementById('student-hub-class');
    if (hubClass) hubClass.textContent = studentClass;
    const rawGender = String(currentStudent?.gender || currentStudent?.jenisKelamin || '').toUpperCase();
    const genderLabel = rawGender.startsWith('L') ? 'Laki-laki' : (rawGender.startsWith('P') ? 'Perempuan' : '-');
    const hubTtlGender = document.getElementById('student-hub-ttl-gender');
    if (hubTtlGender) hubTtlGender.textContent = `${studentTtl} • ${genderLabel}`;

    // Sinkronisasi Status Dokumen KK Siswa di Smart Pass Hub
    updateHubKKStatus(studentDataObj);

    // SSOT: Periksa status keaktifan kartu berdasarkan kelas reguler vs alumni / non-reguler
    const isCardActive = typeof isStudentCardActive === 'function' ? isStudentCardActive(studentDataObj) : isRegularStudentClass(studentClass);
    const hubStatusBadge = document.getElementById('student-hub-status-badge');
    if (hubStatusBadge) {
        if (isCardActive) {
            hubStatusBadge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200';
            hubStatusBadge.innerHTML = '<i class="fa-solid fa-circle-check text-[9px] mr-1"></i>Siswa Aktif';
        } else {
            hubStatusBadge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200';
            hubStatusBadge.innerHTML = '<i class="fa-solid fa-circle-xmark text-[9px] mr-1"></i>Siswa Nonaktif';
        }
    }
    const hubValidity = document.getElementById('student-hub-validity');
    if (hubValidity) {
        if (isCardActive) {
            hubValidity.className = 'font-bold text-emerald-700';
            hubValidity.textContent = 'Selama Menjadi Siswa Aktif';
        } else {
            hubValidity.className = 'font-bold text-rose-600';
            hubValidity.textContent = 'Telah Berakhir (Nonaktif)';
        }
    }

    const effectiveToken = cardResult?.token || currentStudent?.photoPublicToken || currentStudent?.cardToken;
    const initialToken = effectiveToken;
    const hubPublicLink = document.getElementById('student-hub-public-link');
    if (effectiveToken) {
        if (hubPublicLink) hubPublicLink.href = `${window.location.origin}/kartu-shakti.html?id=${encodeURIComponent(effectiveToken)}`;
        renderStudentCardFrontQrCode(effectiveToken);
    }

    try {
        const idToken = auth?.currentUser ? await auth.currentUser.getIdToken() : '';
        const studentToken = sessionStorage.getItem('student_token') || '';

        const headers = { 'Accept': 'application/json' };
        if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
        if (studentToken) headers['X-Student-Token'] = studentToken;

        const res = await fetch(`${workerUrl}/api/students/photo/info/${encodeURIComponent(nis)}`, {
            method: 'GET',
            headers
        });

        const data = await res.json();
        if (res.ok && data.success && data.data) {
            studentCardPhotoInfo = data.data;
            updateStudentCardPhotoUI(data.data);
            const activeToken = data.data.public_token || initialToken;
            if (activeToken) {
                renderStudentCardFrontQrCode(activeToken);
                if (hubPublicLink) {
                    hubPublicLink.href = `${window.location.origin}/kartu-shakti.html?id=${encodeURIComponent(activeToken)}`;
                }
            }
        } else if (initialToken) {
            renderStudentCardFrontQrCode(initialToken);
        }
    } catch (err) {
        console.error('[StudentCard] Error fetch photo info:', err);
        if (initialToken) renderStudentCardFrontQrCode(initialToken);
    }
}

function updateStudentCardPhotoUI(photoData) {
    const statusPill = document.getElementById('student-card-status-pill');
    const alertPending = document.getElementById('student-card-alert-pending');
    const pendingPhotoPreview = document.getElementById('student-pending-photo-preview');
    const modalPendingPhotoImg = document.getElementById('modal-pending-photo-img');
    const alertRejected = document.getElementById('student-card-alert-rejected');
    const rejectReason = document.getElementById('student-card-reject-reason');
    const photoImg = document.getElementById('kts-front-photo');
    const workerUrl = CLOUDFLARE_CONFIG?.WORKER_URL || "https://simas-demo-api.komangpurna1.workers.dev";

    // 1. Update Alert Banners
    if (alertPending) alertPending.classList.add('hidden');
    if (alertRejected) alertRejected.classList.add('hidden');

    if (photoData.pending_photo_url) {
        if (alertPending) alertPending.classList.remove('hidden');

        // Pratinjau Foto Baru yang Diajukan (Thumbnail & Modal Zoom)
        const pendingUrl = (typeof window.resolvePhotoUrl === 'function')
            ? window.resolvePhotoUrl(photoData.pending_photo_url)
            : (typeof resolvePhotoUrl === 'function' ? resolvePhotoUrl(photoData.pending_photo_url) : (photoData.pending_photo_url.startsWith('http') ? photoData.pending_photo_url : `${workerUrl}${photoData.pending_photo_url}`));

        if (pendingPhotoPreview) {
            pendingPhotoPreview.src = pendingUrl;
            pendingPhotoPreview.onerror = () => {
                pendingPhotoPreview.src = 'assets/default-avatar.svg';
            };
        }
        if (modalPendingPhotoImg) {
            modalPendingPhotoImg.src = pendingUrl;
            modalPendingPhotoImg.onerror = () => {
                modalPendingPhotoImg.src = 'assets/default-avatar.svg';
            };
        }

        if (statusPill) {
            statusPill.textContent = 'Menunggu Verifikasi';
            statusPill.className = 'text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 uppercase tracking-wider animate-pulse';
        }
    } else if (photoData.status === 'rejected') {
        if (alertRejected) alertRejected.classList.remove('hidden');
        if (rejectReason) rejectReason.textContent = `Alasan penolakan: ${photoData.rejection_reason || 'Foto tidak sesuai ketentuan seragam/latar belakang.'}`;
        if (statusPill) {
            statusPill.textContent = 'Foto Ditolak';
            statusPill.className = 'text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300 uppercase tracking-wider';
        }
    } else if (photoData.status === 'verified') {
        if (statusPill) {
            statusPill.textContent = 'Foto Terverifikasi';
            statusPill.className = 'text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 uppercase tracking-wider';
        }
    } else {
        if (statusPill) {
            statusPill.textContent = 'Belum Ada Foto';
            statusPill.className = 'text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wider';
        }
    }

    // 2. Tampilkan Foto Aktif (Jika belum diverifikasi, tetap pakai foto aktif sebelumnya)
    if (photoImg) {
        if (photoData.active_photo_url) {
            const url = photoData.active_photo_url.startsWith('http') ? photoData.active_photo_url : `${workerUrl}${photoData.active_photo_url}`;
            photoImg.src = url;
            photoImg.classList.remove('p-2', 'opacity-50');
            photoImg.onerror = () => {
                photoImg.src = 'assets/default-avatar.svg';
                photoImg.classList.remove('p-2', 'opacity-50');
            };
        } else {
            photoImg.src = 'assets/default-avatar.svg';
            photoImg.classList.remove('p-2', 'opacity-50');
        }
    }

    // 3. Sinkronkan foto ke Sidebar Kiri Bawah & Header Mobile
    if (photoData.active_photo_url) {
        syncStudentHeaderAvatar(photoData.active_photo_url, currentStudent?.name);
    }
}

/**
 * Sinkronisasi Foto Profil Otomatis pada Sidebar Kiri Bawah & Header Mobile Akun Siswa
 */
function syncStudentHeaderAvatar(photoUrl, studentName) {
    const rawPhoto = photoUrl || sessionStorage.getItem('student_active_photo_url') || '';
    const name = studentName || currentStudent?.name || sessionStorage.getItem('student_name') || 'Siswa';
    const headerImg = document.getElementById('student-header-avatar-img');
    const headerIcon = document.getElementById('student-header-avatar-icon');
    const popupImg = document.getElementById('student-popup-avatar-img');
    const popupIcon = document.getElementById('student-popup-avatar-icon');

    if (rawPhoto) {
        sessionStorage.setItem('student_active_photo_url', rawPhoto);
        const resolved = (typeof window.resolvePhotoUrl === 'function')
            ? window.resolvePhotoUrl(rawPhoto)
            : (typeof resolvePhotoUrl === 'function' ? resolvePhotoUrl(rawPhoto) : rawPhoto);

        if (headerImg) {
            headerImg.src = resolved;
            headerImg.classList.remove('hidden');
            headerImg.onerror = () => {
                headerImg.classList.add('hidden');
                if (headerIcon) headerIcon.classList.remove('hidden');
            };
            if (headerIcon) headerIcon.classList.add('hidden');
        }

        if (popupImg) {
            popupImg.src = resolved;
            popupImg.classList.remove('hidden');
            popupImg.onerror = () => {
                popupImg.classList.add('hidden');
                if (popupIcon) popupIcon.classList.remove('hidden');
            };
            if (popupIcon) popupIcon.classList.add('hidden');
        }
    } else {
        if (headerImg) headerImg.classList.add('hidden');
        if (headerIcon) headerIcon.classList.remove('hidden');
        if (popupImg) popupImg.classList.add('hidden');
        if (popupIcon) popupIcon.classList.remove('hidden');
    }
}
window.syncStudentHeaderAvatar = syncStudentHeaderAvatar;

/**
 * Render QR Code Sisi Depan: Verifikasi Publik Anti-IDOR (Menggunakan SSOT StudentCardRenderer)
 */
function renderStudentCardFrontQrCode(publicToken) {
    const container = document.getElementById('kts-front-qr-box');
    if (!container || !publicToken) return;
    renderKtsQrCode(container, publicToken, { width: 74, height: 74 });
}

/**
 * Universal Wrapper Render QR Code Kartu Pelajar
 * Mendukung pemanggilan fleksibel: renderStudentCardQrCode(publicToken) atau renderStudentCardQrCode(targetContainer, publicToken)
 */
function renderStudentCardQrCode(target, token) {
    if (typeof target === 'string' && !token) {
        renderStudentCardFrontQrCode(target);
        return;
    }
    const container = typeof target === 'string' ? document.getElementById(target) : target;
    const qrToken = token || target;
    if (container && qrToken) {
        renderKtsQrCode(container, qrToken, { width: 74, height: 74 });
    }
}

/**
 * Render QR Code Sisi Belakang: Dipertahankan sebagai no-op untuk kompatibilitas
 * (Kartu sekarang menggunakan Single Universal QR Code di sisi depan)
 */
function renderStudentCardBackQrCode(nis) {
    // Single QR Code aktif di sisi depan kartu
    return;
}

function updateStudentSideSwitchUI(isBack) {
    const btnFront = document.getElementById('btn-student-side-front');
    const btnBack = document.getElementById('btn-student-side-back');
    if (btnFront && btnBack) {
        if (isBack) {
            btnBack.className = 'px-2.5 py-1 rounded-md bg-white text-slate-900 shadow-xs transition';
            btnFront.className = 'px-2.5 py-1 rounded-md text-slate-600 hover:text-slate-900 transition';
        } else {
            btnFront.className = 'px-2.5 py-1 rounded-md bg-white text-slate-900 shadow-xs transition';
            btnBack.className = 'px-2.5 py-1 rounded-md text-slate-600 hover:text-slate-900 transition';
        }
    }
}

function setStudentCardSide(side) {
    const cardEl = document.getElementById('student-card-3d');
    if (!cardEl) return;
    const isBack = side === 'back';
    if (isBack) {
        cardEl.classList.add('flipped', 'show-back');
    } else {
        cardEl.classList.remove('flipped', 'show-back');
    }
    updateStudentSideSwitchUI(isBack);
}

function flipDigitalCard() {
    const cardEl = document.getElementById('student-card-3d');
    if (cardEl) {
        const isBack = cardEl.classList.contains('flipped') || cardEl.classList.contains('show-back');
        setStudentCardSide(isBack ? 'front' : 'back');
    }
}

// === INTERACTIVE CROPPER MODAL (3:4 RATIO) ===
function openCropPhotoModal() {
    const modal = document.getElementById('modal-crop-foto-siswa');
    if (modal) modal.classList.remove('hidden');
    resetCropPhoto();
}

function closeCropPhotoModal() {
    const modal = document.getElementById('modal-crop-foto-siswa');
    if (modal) modal.classList.add('hidden');
}

function handlePasfotoFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        if (typeof window.showPopup === 'function') window.showPopup('Format File Salah', 'Pilih file gambar (JPG, PNG, atau WebP).', 'error');
        return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            cropImageObj = img;
            cropScale = 1.0;
            cropOffsetX = 0;
            cropOffsetY = 0;
            document.getElementById('crop-preview-area')?.classList.remove('hidden');
            document.getElementById('btn-submit-crop-photo')?.removeAttribute('disabled');
            drawCropCanvas();
            initCropDragging();
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

function drawCropCanvas() {
    const canvas = document.getElementById('crop-canvas');
    if (!canvas || !cropImageObj) return;

    canvas.width = 300;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const imgRatio = cropImageObj.width / cropImageObj.height;
    const canvasRatio = 3 / 4;

    let drawW, drawH;
    if (imgRatio > canvasRatio) {
        drawH = canvas.height * cropScale;
        drawW = drawH * imgRatio;
    } else {
        drawW = canvas.width * cropScale;
        drawH = drawW / imgRatio;
    }

    const drawX = (canvas.width - drawW) / 2 + cropOffsetX;
    const drawY = (canvas.height - drawH) / 2 + cropOffsetY;

    ctx.drawImage(cropImageObj, drawX, drawY, drawW, drawH);
}

function zoomCropPhoto(delta) {
    cropScale = Math.max(0.5, Math.min(3.0, cropScale + delta));
    drawCropCanvas();
}

function resetCropPhoto() {
    cropScale = 1.0;
    cropOffsetX = 0;
    cropOffsetY = 0;
    drawCropCanvas();
}

function initCropDragging() {
    const canvas = document.getElementById('crop-canvas');
    if (!canvas || canvas.dataset.dragInited) return;
    canvas.dataset.dragInited = 'true';

    canvas.addEventListener('mousedown', (e) => {
        isDraggingCrop = true;
        dragStartX = e.clientX - cropOffsetX;
        dragStartY = e.clientY - cropOffsetY;
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDraggingCrop) return;
        cropOffsetX = e.clientX - dragStartX;
        cropOffsetY = e.clientY - dragStartY;
        drawCropCanvas();
    });

    window.addEventListener('mouseup', () => { isDraggingCrop = false; });

    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            isDraggingCrop = true;
            dragStartX = e.touches[0].clientX - cropOffsetX;
            dragStartY = e.touches[0].clientY - cropOffsetY;
        }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
        if (!isDraggingCrop || e.touches.length !== 1) return;
        cropOffsetX = e.touches[0].clientX - dragStartX;
        cropOffsetY = e.touches[0].clientY - dragStartY;
        drawCropCanvas();
    }, { passive: true });

    window.addEventListener('touchend', () => { isDraggingCrop = false; });
}

async function submitCroppedPhoto() {
    const canvas = document.getElementById('crop-canvas');
    const nis = currentNIS || currentStudent?.nis || sessionStorage.getItem('student_nis');
    if (!canvas || !nis) return;

    const btnSubmit = document.getElementById('btn-submit-crop-photo');
    const uploadStatus = document.getElementById('crop-upload-status');
    if (btnSubmit) btnSubmit.disabled = true;
    if (uploadStatus) uploadStatus.classList.remove('hidden');

    try {
        const base64Data = canvas.toDataURL('image/webp', 0.8);
        const workerUrl = CLOUDFLARE_CONFIG?.WORKER_URL || "https://simas-demo-api.komangpurna1.workers.dev";

        const idToken = auth?.currentUser ? await auth.currentUser.getIdToken() : '';
        const studentToken = sessionStorage.getItem('student_token') || '';

        const headers = { 'Content-Type': 'application/json' };
        if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
        if (studentToken) headers['X-Student-Token'] = studentToken;

        const res = await fetch(`${workerUrl}/api/students/photo/upload`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                nis,
                image: base64Data
            })
        });

        const result = await res.json();
        if (!res.ok || !result.success) {
            throw new Error(result.error || 'Gagal mengunggah foto ke server.');
        }

        // Tampilkan foto diajukan seketika ke thumbnail preview pending tanpa jeda
        const pendingPreviewImg = document.getElementById('student-pending-photo-preview');
        const modalPendingImg = document.getElementById('modal-pending-photo-img');
        const alertPending = document.getElementById('student-card-alert-pending');
        const alertRejected = document.getElementById('student-card-alert-rejected');
        const statusPill = document.getElementById('student-card-status-pill');

        if (pendingPreviewImg) pendingPreviewImg.src = base64Data;
        if (modalPendingImg) modalPendingImg.src = base64Data;
        if (alertPending) alertPending.classList.remove('hidden');
        if (alertRejected) alertRejected.classList.add('hidden');
        if (statusPill) {
            statusPill.textContent = 'Menunggu Verifikasi';
            statusPill.className = 'text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 uppercase tracking-wider animate-pulse';
        }

        closeCropPhotoModal();
        if (typeof window.showPopup === 'function') {
            window.showPopup(
                'Foto Berhasil Diajukan',
                'Foto pasfoto resmi berhasil diunggah dan sedang menunggu verifikasi Wali Kelas. Kartu saat ini tetap memakai foto sebelumnya hingga disetujui.',
                'success'
            );
        }

        await loadStudentCardData();

    } catch (err) {
        console.error('[Submit Photo Error]:', err);
        if (typeof window.showPopup === 'function') {
            window.showPopup('Gagal Unggah Foto', err.message || 'Terjadi kesalahan jaringan.', 'error');
        }
    } finally {
        if (btnSubmit) btnSubmit.disabled = false;
        if (uploadStatus) uploadStatus.classList.add('hidden');
    }
}

// === DOWNLOAD KARTU PELAJAR PNG (SSOT RESOLUSI TINGGI 300 DPI - DEPAN / BELAKANG / LENGKAP) ===
async function downloadStudentCardPng(side = null) {
    let student = currentStudent;
    if (!student) {
        const nis = currentNIS || sessionStorage.getItem('student_nis');
        if (nis) {
            student = {
                nis,
                name: sessionStorage.getItem('student_name') || 'Siswa',
                class: sessionStorage.getItem('student_class') || '-',
                nisn: document.getElementById('kts-front-nisn')?.textContent || '-',
                activePhotoUrl: document.getElementById('kts-front-photo')?.getAttribute('src') || 'assets/default-avatar.svg',
                photoPublicToken: studentCardPhotoInfo?.public_token || ''
            };
        }
    }
    if (!student) return;

    // Jika sisi spesifik diberikan ('front' | 'back' | 'both'), langsung unduh
    if (side) {
        if (typeof showToast === 'function') {
            showToast('Mengunduh Kartu', 'Menyiapkan berkas Kartu Pelajar HD...', 'info');
        }
        if (typeof StudentCardRenderer?.downloadKtsPng === 'function') {
            await StudentCardRenderer.downloadKtsPng(student, side);
        } else if (typeof window.downloadKtsPng === 'function') {
            await window.downloadKtsPng(student, side);
        }
        return;
    }

    // Buka modal dialog pilihan sisi (Depan, Belakang, atau Kedua Sisi)
    openKtsDownloadModal(student);
}

async function printSingleStudentCard() {
    let student = currentStudent;
    if (!student) {
        const nis = currentNIS || sessionStorage.getItem('student_nis');
        if (nis) {
            student = {
                nis,
                name: sessionStorage.getItem('student_name') || '-',
                class: sessionStorage.getItem('student_class') || '-',
                nisn: document.getElementById('kts-front-nisn')?.textContent || '-',
                activePhotoUrl: document.getElementById('kts-front-photo')?.getAttribute('src') || 'assets/default-avatar.svg',
                photoPublicToken: studentCardPhotoInfo?.public_token || ''
            };
        }
    }
    if (!student) return;
    if (typeof showToast === 'function') {
        showToast('Mencetak Kartu', 'Menyiapkan dokumen cetak standar CR-80...', 'info');
    }
    if (typeof StudentCardRenderer?.printSingleKts === 'function') {
        await StudentCardRenderer.printSingleKts(student, 'both', 'print-kts-container');
    } else if (typeof window.printSingleKts === 'function') {
        await window.printSingleKts(student, 'both', 'print-kts-container');
    }
}

function openKtsDownloadModal(student) {
    if (typeof StudentCardRenderer?.openKtsDownloadModal === 'function') {
        StudentCardRenderer.openKtsDownloadModal(student || currentStudent);
    }
}

function previewPendingPhotoModal() {
    const modal = document.getElementById('modal-preview-pending-photo');
    if (modal) modal.classList.remove('hidden');
}

function closePendingPhotoModal() {
    const modal = document.getElementById('modal-preview-pending-photo');
    if (modal) modal.classList.add('hidden');
}

// Bind ke window object
window.loadStudentCardData = loadStudentCardData;
window.flipDigitalCard = flipDigitalCard;
window.setStudentCardSide = setStudentCardSide;
window.renderStudentCardFrontQrCode = renderStudentCardFrontQrCode;
window.renderStudentCardBackQrCode = renderStudentCardBackQrCode;
window.renderStudentCardQrCode = renderStudentCardQrCode;
window.openCropPhotoModal = openCropPhotoModal;
window.closeCropPhotoModal = closeCropPhotoModal;
window.previewPendingPhotoModal = previewPendingPhotoModal;
window.closePendingPhotoModal = closePendingPhotoModal;
window.handlePasfotoFileSelect = handlePasfotoFileSelect;
window.zoomCropPhoto = zoomCropPhoto;
window.resetCropPhoto = resetCropPhoto;
window.submitCroppedPhoto = submitCroppedPhoto;
window.downloadStudentCardPng = downloadStudentCardPng;
window.openKtsDownloadModal = openKtsDownloadModal;
window.printSingleStudentCard = printSingleStudentCard;

// =========================================================================
// 🎓 MODUL BUKU TAHUNAN (YEARBOOK) KELAS XII - PORTAL SISWA
// =========================================================================

// Satu-satunya sumber kebenaran kelayakan Buku Kenangan: rombel Kelas XII ("XII ...", "XII-1", "12 IPA", dst).
// Profil otoritatif (currentStudent) diutamakan; sessionStorage hanya cadangan sebelum profil termuat.
function getYearbookStudentClass() {
    return String(currentStudent?.class || currentStudent?.kelas || currentStudent?.rombel || sessionStorage.getItem('student_class') || '').toUpperCase().trim();
}

function isYearbookEligibleClass(className) {
    // Pemisah (spasi/titik/strip) tidak dibuang agar "XII IPS 1" tidak terbaca "XIIIPS1".
    const normalized = String(className || '').toUpperCase().trim();
    return /^(XII|12)(?![I0-9])/.test(normalized);
}

function isYearbookEligibleStudent() {
    return isYearbookEligibleClass(getYearbookStudentClass());
}

function checkYearbookTab() {
    const tabYearbook = document.getElementById('tab-yearbook');
    if (!tabYearbook) return;
    const isKelasXII = isYearbookEligibleStudent();
    if (!isKelasXII) _cachedYearbookData = null;
    if (isKelasXII) {
        tabYearbook.classList.remove('hidden');
        tabYearbook.classList.add('flex');
    } else {
        tabYearbook.classList.add('hidden');
        tabYearbook.classList.remove('flex');
        const viewYearbook = document.getElementById('view-yearbook');
        if (viewYearbook) viewYearbook.classList.add('hidden');
    }
}

function compressImageFileToWebp(file, maxDimension = 1000, quality = 0.85) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
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
                ctx.fillStyle = '#ffffff'; // latar putih agar PNG transparan tidak menjadi hitam saat jadi JPEG
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);

                // Safari/iOS tertentu tidak bisa meng-encode WebP dan diam-diam mengembalikan PNG (besar).
                // Fallback ke JPEG, lalu turunkan kualitas sampai muat batas Worker (base64 ≤ ~600 KB).
                const MAX_BASE64_CHARS = 560 * 1024;
                const supportsWebp = canvas.toDataURL('image/webp', quality).startsWith('data:image/webp');
                const mime = supportsWebp ? 'image/webp' : 'image/jpeg';
                let q = quality;
                let dataUrl = canvas.toDataURL(mime, q);
                while (dataUrl.length > MAX_BASE64_CHARS && q > 0.45) {
                    q = Math.round((q - 0.1) * 100) / 100;
                    dataUrl = canvas.toDataURL(mime, q);
                }
                resolve(dataUrl);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

let _cachedYearbookData = null;

async function loadStudentYearbookData(forceRefresh = false) {
    if (!currentStudent || !currentStudent.nis) return;
    const isKelasXII = isYearbookEligibleStudent();
    if (!isKelasXII) {
        console.warn('[Yearbook] Akses ditolak: Modul Buku Kenangan hanya untuk siswa kelas XII.');
        const viewYearbook = document.getElementById('view-yearbook');
        if (viewYearbook) viewYearbook.classList.add('hidden');
        const tabYearbook = document.getElementById('tab-yearbook');
        if (tabYearbook) {
            tabYearbook.classList.add('hidden');
            tabYearbook.classList.remove('flex');
        }
        return;
    }
    const statusBadge = document.getElementById('yearbook-status-badge');
    const formalImg = document.getElementById('yearbook-preview-formal');
    const formalIcon = document.getElementById('yearbook-empty-formal');
    const casualImg = document.getElementById('yearbook-preview-casual');
    const casualEmpty = document.getElementById('yearbook-empty-casual');
    const quoteInput = document.getElementById('yearbook-input-quote');
    const ambitionInput = document.getElementById('yearbook-input-ambition');
    const campusInput = document.getElementById('yearbook-input-campus');
    const igInput = document.getElementById('yearbook-input-instagram');
    const spotifyInput = document.getElementById('yearbook-input-spotify');
    const quoteCounter = document.getElementById('yearbook-quote-counter');
    const messagesList = document.getElementById('yearbook-messages-list');
    const approvedCounter = document.getElementById('yearbook-approved-counter');

    if (quoteInput && !quoteInput._hasCounter) {
        quoteInput._hasCounter = true;
        quoteInput.addEventListener('input', () => {
            if (quoteCounter) quoteCounter.textContent = `${quoteInput.value.length} / 300`;
        });
        // Pratinjau halaman buku tahunan diperbarui langsung saat siswa mengetik
        [quoteInput, ambitionInput, campusInput, igInput, spotifyInput].forEach(el => {
            if (el) el.addEventListener('input', updateYearbookPreview);
        });
    }

    try {
        if (!_cachedYearbookData || forceRefresh) {
            const res = await cfClient.getYearbookProfile();
            if (res && res.success) {
                _cachedYearbookData = res;
            }
        }

        const data = _cachedYearbookData;
        if (!data) return;

        const classOfEl = document.getElementById('yearbook-class-of');
        const yearMatch = String(data.academic_year || '').match(/^\d{4}\/(\d{4})$/);
        if (classOfEl && yearMatch) classOfEl.textContent = yearMatch[1];
        const galleryLink = document.getElementById('yearbook-gallery-link');
        if (galleryLink && data.student?.class) galleryLink.href = `yearbook.html?kelas=${encodeURIComponent(data.student.class)}`;

        // 1. Tampilkan Pasfoto Formal
        const formalUrl = data.student?.formal_photo_url
            ? resolvePhotoUrl(data.student.formal_photo_url)
            : (currentStudent.active_photo_url ? resolvePhotoUrl(currentStudent.active_photo_url) : null);
        if (formalUrl && formalImg) {
            formalImg.src = formalUrl;
            formalImg.classList.remove('hidden');
            if (formalIcon) formalIcon.classList.add('hidden');
        }

        // 2. Tampilkan Foto Kasual
        const casualUrl = data.profile?.casual_photo_url;
        if (casualUrl && casualImg) {
            casualImg.src = resolvePhotoUrl(casualUrl);
            casualImg.classList.remove('hidden');
            if (casualEmpty) casualEmpty.classList.add('hidden');
        }

        // 3. Populate Form Biodata
        if (data.profile) {
            if (quoteInput) {
                quoteInput.value = data.profile.quote || '';
                if (quoteCounter) quoteCounter.textContent = `${quoteInput.value.length} / 300`;
            }
            if (ambitionInput) ambitionInput.value = data.profile.ambition || '';
            if (campusInput) campusInput.value = data.profile.dream_campus || '';
            const soc = data.profile.social_media || {};
            if (igInput) igInput.value = soc.instagram || '';
            if (spotifyInput) spotifyInput.value = soc.spotify || '';
        }

        if (statusBadge) {
            const st = data.profile?.status || 'draft';
            const hiddenByAdmin = Number(data.profile?.is_published) === 0;
            const [label, tone] = hiddenByAdmin
                ? ['Disembunyikan Admin', 'bg-rose-100 text-rose-700']
                : st === 'submitted'
                    ? ['Tersimpan & Tampil', 'bg-emerald-100 text-emerald-700']
                    : ['Draft', 'bg-amber-100 text-amber-700'];
            statusBadge.textContent = label;
            statusBadge.className = `px-2.5 py-0.5 rounded-full text-[10px] font-bold ${tone}`;
            statusBadge.title = hiddenByAdmin ? 'Profilmu sedang disembunyikan oleh tim kesiswaan. Hubungi wali kelas bila ada pertanyaan.' : '';
        }

        updateYearbookPreview();

        // 4. Render Pesan Teman
        const msgs = data.messages || [];
        const approvedCount = msgs.filter(m => m.is_approved === 1).length;
        const pendingCount = msgs.length - approvedCount;
        if (approvedCounter) {
            approvedCounter.textContent = pendingCount > 0
                ? `${approvedCount} Disetujui · ${pendingCount} Baru`
                : `${approvedCount} Disetujui`;
        }

        if (messagesList) {
            if (msgs.length === 0) {
                messagesList.innerHTML = `
                    <div class="text-center py-6 text-slate-400 text-xs">
                        <i class="fa-regular fa-envelope-open text-2xl mb-1 text-slate-300"></i>
                        <p>Belum ada pesan kesan dari kawan seangkatan.</p>
                        <p class="mt-1">Bagikan tautan galeri ke kawanmu agar mereka menulis untukmu!</p>
                    </div>
                `;
            } else {
                messagesList.innerHTML = msgs.map(m => `
                    <div class="p-3 rounded-xl border ${m.is_approved === 1 ? 'border-emerald-200 bg-emerald-50/40' : 'border-amber-200 bg-amber-50/50'} transition space-y-1.5" id="msg-card-${escapeHTML(m.id)}">
                        <div class="flex items-center justify-between gap-2">
                            <div class="min-w-0">
                                <span class="font-bold text-xs text-slate-800 truncate block">${escapeHTML(m.sender_name)}</span>
                                <span class="text-[10px] text-slate-400 font-medium">${escapeHTML(m.sender_class)}${m.is_approved === 1 ? '' : ' · <span class="text-amber-600 font-bold">Menunggu persetujuanmu</span>'}</span>
                            </div>
                            <div class="flex items-center gap-1 shrink-0">
                                <button type="button" onclick="window.toggleApproveMessage('${escapeHTML(m.id)}', ${m.is_approved === 1 ? 0 : 1})"
                                    class="px-2 py-1 rounded-lg text-[10px] font-bold transition flex items-center gap-1 cursor-pointer ${m.is_approved === 1 ? 'bg-emerald-600 text-white' : 'bg-slate-900 hover:bg-slate-700 text-white'}">
                                    <i class="fa-solid ${m.is_approved === 1 ? 'fa-check' : 'fa-plus'}"></i>
                                    <span>${m.is_approved === 1 ? 'Disetujui' : 'Setujui'}</span>
                                </button>
                                <button type="button" onclick="window.deleteYearbookReceivedMessage('${escapeHTML(m.id)}')" title="Hapus pesan"
                                    class="w-7 h-7 rounded-lg text-[10px] text-rose-600 hover:bg-rose-50 border border-rose-200 transition flex items-center justify-center cursor-pointer">
                                    <i class="fa-solid fa-trash"></i>
                                </button>
                            </div>
                        </div>
                        <p class="text-xs text-slate-600 italic leading-relaxed break-words">&ldquo;${escapeHTML(decodeYearbookText(m.message))}&rdquo;</p>
                    </div>
                `).join('');
            }
        }

        // 5. Render Pesan yang Dikirim
        renderYearbookSentMessages(data.sent_messages || []);

    } catch (err) {
        console.error('[Yearbook] Gagal memuat data yearbook:', err);
    }
}

// Worker menyimpan pesan dengan < > yang sudah di-escape; kembalikan dulu agar tidak ter-escape dua kali.
function decodeYearbookText(str) {
    return String(str || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function updateYearbookPreview() {
    const val = id => (document.getElementById(id)?.value || '').trim();
    const name = currentStudent?.name || currentStudent?.nama || sessionStorage.getItem('student_name') || 'Nama Kamu';
    const quote = val('yearbook-input-quote');
    const ambition = val('yearbook-input-ambition');
    const campus = val('yearbook-input-campus');
    const instagram = val('yearbook-input-instagram');
    const spotify = val('yearbook-input-spotify');
    const casualImg = document.getElementById('yearbook-preview-casual');
    const formalImg = document.getElementById('yearbook-preview-formal');
    const hasCasual = Boolean(casualImg && !casualImg.classList.contains('hidden') && casualImg.getAttribute('src'));
    const hasFormal = Boolean(formalImg && !formalImg.classList.contains('hidden') && formalImg.getAttribute('src'));

    const titleName = String(name).toLowerCase().replace(/(^|\s)(\S)/g, (m, s, c) => s + c.toUpperCase());
    const parts = titleName.trim().split(/\s+/).filter(Boolean);
    const initials = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || '?')[0];

    const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };
    setText('yearbook-preview-name', titleName);
    setText('yearbook-preview-meta', [ambition, campus].filter(Boolean).join(' · ') || 'Cita-cita · Kampus impian');
    setText('yearbook-preview-quote', quote ? `“${quote}”` : '“Quote kelulusanmu akan tampil di sini.”');
    setText('yearbook-preview-initials', initials.toUpperCase());

    const cardPhoto = document.getElementById('yearbook-preview-card-photo');
    if (cardPhoto) {
        const src = hasCasual ? casualImg.src : (hasFormal ? formalImg.src : '');
        if (src) {
            cardPhoto.src = src;
            cardPhoto.classList.remove('hidden');
        } else {
            cardPhoto.classList.add('hidden');
        }
    }

    const items = [
        { ok: hasCasual, label: 'Foto santai', required: true },
        { ok: Boolean(quote), label: 'Quote kelulusan', required: true },
        { ok: Boolean(ambition || campus), label: 'Cita-cita / kampus' },
        { ok: Boolean(instagram || spotify), label: 'Instagram / lagu' }
    ];
    const done = items.filter(i => i.ok).length;
    const pct = Math.round((done / items.length) * 100);

    const checklist = document.getElementById('yearbook-checklist');
    if (checklist) {
        checklist.innerHTML = items.map(i => `
            <li class="flex items-center gap-1.5 ${i.ok ? 'text-emerald-700' : 'text-slate-500'}">
                <i class="fa-solid ${i.ok ? 'fa-circle-check text-emerald-500' : 'fa-circle text-slate-300'} text-[10px]"></i>
                <span>${i.label}${i.required && !i.ok ? ' <span class="text-rose-500">*</span>' : ''}</span>
            </li>
        `).join('');
    }

    const ring = document.getElementById('yearbook-progress-ring');
    if (ring) ring.style.strokeDashoffset = String(97.4 * (1 - pct / 100));
    setText('yearbook-progress-pct', `${pct}%`);
}

function renderYearbookSentMessages(sent) {
    const list = document.getElementById('yearbook-sent-list');
    const counter = document.getElementById('yearbook-sent-counter');
    if (counter) counter.textContent = `${sent.length} pesan`;
    if (!list) return;

    if (sent.length === 0) {
        list.innerHTML = `
            <p class="text-center py-4 text-slate-400 text-xs">
                Belum ada pesan yang kamu kirim. Buka <a href="${escapeHTML(document.getElementById('yearbook-gallery-link')?.getAttribute('href') || 'yearbook.html')}" class="text-indigo-600 font-bold hover:underline">Galeri Angkatan</a>, pilih kawanmu, lalu tulis kenangan untuknya.
            </p>
        `;
        return;
    }

    list.innerHTML = sent.map(m => `
        <div class="p-2.5 rounded-xl border border-slate-200 bg-slate-50/60">
            <div class="flex items-center justify-between gap-2">
                <span class="text-xs font-bold text-slate-800 truncate">Untuk ${escapeHTML(m.target_name || m.target_nis)}${m.target_class ? ` <span class="font-medium text-slate-400">· ${escapeHTML(m.target_class)}</span>` : ''}</span>
                <span class="shrink-0 px-1.5 py-0.5 rounded-md text-[9px] font-bold ${m.is_approved === 1 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}">${m.is_approved === 1 ? 'Tampil' : 'Menunggu'}</span>
            </div>
            <p class="text-[11px] text-slate-600 italic mt-1 line-clamp-2 break-words">&ldquo;${escapeHTML(decodeYearbookText(m.message))}&rdquo;</p>
        </div>
    `).join('');
}

async function deleteYearbookReceivedMessage(msgId) {
    if (!msgId) return;
    if (!confirm('Hapus pesan ini dari buku kenanganmu? Tindakan ini tidak dapat dibatalkan.')) return;
    try {
        const res = await cfClient.deleteYearbookMessage(msgId);
        if (res && res.success) {
            showToast('Pesan Dihapus', 'Pesan telah dihapus dari buku kenanganmu.', 'success');
            await loadStudentYearbookData(true);
        } else {
            throw new Error(res?.error || 'Gagal menghapus pesan.');
        }
    } catch (err) {
        console.error('[Yearbook] Delete message error:', err);
        showToast('Gagal', err.message, 'error');
    }
}

async function saveYearbookProfileData(e) {
    if (e) e.preventDefault();
    const isKelasXII = isYearbookEligibleStudent();
    if (!isKelasXII) {
        showToast('Akses Dibatasi', 'Buku Kenangan hanya diperuntukkan bagi siswa Kelas XII.', 'warning');
        return;
    }

    const btn = document.getElementById('btn-save-yearbook');
    const quote = document.getElementById('yearbook-input-quote')?.value || '';
    const ambition = document.getElementById('yearbook-input-ambition')?.value || '';
    const campus = document.getElementById('yearbook-input-campus')?.value || '';
    const instagram = document.getElementById('yearbook-input-instagram')?.value || '';
    const spotify = document.getElementById('yearbook-input-spotify')?.value || '';

    if (!quote.trim()) {
        showToast('Peringatan', 'Quote kelulusan wajib diisi.', 'warning');
        return;
    }

    try {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
        }

        const payload = {
            quote: quote.trim(),
            ambition: ambition.trim(),
            dream_campus: campus.trim(),
            social_media: {
                instagram: instagram.trim().replace(/^@/, ''),
                spotify: spotify.trim()
            }
        };

        const res = await cfClient.saveYearbookProfile(payload);
        if (res && res.success) {
            showToast('Berhasil', 'Profil buku kenangan Anda berhasil disimpan!', 'success');
            await loadStudentYearbookData(true);
        } else {
            throw new Error(res?.error || 'Gagal menyimpan profil.');
        }
    } catch (err) {
        console.error('[Yearbook] Save error:', err);
        showToast('Gagal', err.message || 'Terjadi kesalahan saat menyimpan.', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> <span>Simpan Profil Buku Kenangan</span>';
        }
    }
}

async function handleYearbookPhotoUpload(inputEl) {
    const isKelasXII = isYearbookEligibleStudent();
    if (!isKelasXII) {
        showToast('Akses Dibatasi', 'Unggah foto Buku Kenangan hanya diperuntukkan bagi siswa Kelas XII.', 'warning');
        if (inputEl) inputEl.value = '';
        return;
    }

    const file = inputEl?.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showToast('Format Salah', 'Harap pilih file gambar (JPG, PNG, atau WebP).', 'warning');
        return;
    }

    try {
        showToast('Memproses Foto', 'Mengompresi dan menyiapkan foto...', 'info');
        const photoBase64 = await compressImageFileToWebp(file, 800, 0.85);

        showToast('Mengunggah', 'Menyimpan foto santai ke server Cloudflare...', 'info');
        const res = await cfClient.uploadYearbookCasualPhoto({
            nis: currentStudent.nis,
            photoBase64
        });

        if (res && res.success) {
            showToast('Sukses', 'Foto santai buku kenangan berhasil diunggah!', 'success');
            await loadStudentYearbookData(true);
        } else {
            throw new Error(res?.error || 'Gagal mengunggah foto.');
        }
    } catch (err) {
        console.error('[Yearbook] Upload photo error:', err);
        showToast('Gagal Unggah', err.message || 'Gagal memproses foto santai.', 'error');
    } finally {
        if (inputEl) inputEl.value = '';
    }
}

async function toggleApproveMessage(msgId, newApproval) {
    try {
        const res = await cfClient.toggleApproveYearbookMessage(msgId, newApproval);
        if (res && res.success) {
            showToast('Status Pesan Diperbarui', res.message, 'success');
            await loadStudentYearbookData(true);
        } else {
            throw new Error(res?.error || 'Gagal mengubah status pesan.');
        }
    } catch (err) {
        console.error('[Yearbook] Toggle approve error:', err);
        showToast('Gagal', err.message, 'error');
    }
}

window.checkYearbookTab = checkYearbookTab;
window.isYearbookEligibleStudent = isYearbookEligibleStudent;
window.loadStudentYearbookData = loadStudentYearbookData;
window.saveYearbookProfileData = saveYearbookProfileData;
window.handleYearbookPhotoUpload = handleYearbookPhotoUpload;
window.toggleApproveMessage = toggleApproveMessage;
window.deleteYearbookReceivedMessage = deleteYearbookReceivedMessage;

// Handler Dokumen Kartu Keluarga (KK)
export function openKKPreviewModal() {
    const modal = document.getElementById('modal-preview-kk');
    if (modal) modal.classList.remove('hidden');
}

export function closeKKPreviewModal() {
    const modal = document.getElementById('modal-preview-kk');
    if (modal) modal.classList.add('hidden');
}

export function handleKKFileSelect(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;
    if (typeof showToast === 'function') {
        showToast('Unggah KK', 'Fitur pratinjau foto KK aktif.', 'info');
    }
}

export function deleteKKPhoto() {
    if (typeof showToast === 'function') {
        showToast('Hapus KK', 'Dokumen KK berhasil dibersihkan.', 'info');
    }
}

window.openKKPreviewModal = openKKPreviewModal;
window.closeKKPreviewModal = closeKKPreviewModal;
window.handleKKFileSelect = handleKKFileSelect;
window.deleteKKPhoto = deleteKKPhoto;

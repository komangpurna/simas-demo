import { auth, db, PATHS, AI_CONFIG, getAiConfig, getAiConfigAsync, buildRaporNotePrompt, computeClassicalMetrics, extractFriendlyStudentName, fetchGeminiWithFallback, getUserGeminiApiKeysAsync, supabase, SCHOOL_CONFIG, calculateCohort, getRateForStudent, calculateStudentTunggakan } from './config.js';
import { cfClient } from './cloudflare-client.js';
import { initLayout, getLocalCache, setLocalCache, validateStudentIdentityNumbers, formatDateIndoFormal } from './global.js';
import StudentCardRenderer, {
    printSingleKts,
    renderKtsFrontHtml,
    renderKtsBackHtml,
    renderKtsQrCode,
    updateKtsCardScale,
    isRegularStudentClass,
    isStudentCardActive,
    downloadKtsPng
} from './student-card-renderer.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
// REVISI: Menambahkan limit, startAt, endAt, updateDoc
import { collection, getDocs, query, where, orderBy, doc, deleteDoc, serverTimestamp, getDoc, writeBatch, limit, startAt, endAt, updateDoc, setDoc, deleteField, increment } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

// --- KONFIGURASI SCHEMA DATA DAPODIK (Satu Sumber Kebenaran - 48 Kolom) ---
// index: Urutan kolom di Excel ekspor Dapodik (Dimulai dari 0)
// key: Nama field di Database Firestore
export const STUDENT_SCHEMA = [
    { index: 0, key: 'nis', label: 'NIS', primary: true }, // KUNCI UTAMA
    { index: 1, key: 'nisn', label: 'NISN' },
    { index: 2, key: 'name', label: 'Nama Lengkap' },
    { index: 3, key: 'gender', label: 'Jenis Kelamin (L/P)' },
    { index: 4, key: 'class', label: 'Kelas' },
    { index: 5, key: 'birthPlace', label: 'Tempat Lahir' },
    { index: 6, key: 'birthDate', label: 'Tgl Lahir' },
    { index: 7, key: 'nik', label: 'NIK' },
    { index: 8, key: 'agama', label: 'Agama' },
    { index: 9, key: 'alamat', label: 'Alamat' },
    { index: 10, key: 'dusun', label: 'Dusun' },
    { index: 11, key: 'kelurahan', label: 'Kelurahan' },
    { index: 12, key: 'kecamatan', label: 'Kecamatan' },
    { index: 13, key: 'kode_pos', label: 'Kode Pos' },
    { index: 14, key: 'jenis_tinggal', label: 'Jenis Tinggal' },
    { index: 15, key: 'alat_transportasi', label: 'Alat Transportasi' },
    { index: 16, key: 'phone_siswa', label: 'HP Siswa' },
    { index: 17, key: 'email_siswa', label: 'E-Mail' },
    { index: 18, key: 'father', label: 'Nama Ayah' },
    { index: 19, key: 'father_birth_year', label: 'Tahun Lahir Ayah' },
    { index: 20, key: 'father_education', label: 'Jenjang Pendidikan Ayah' },
    { index: 21, key: 'father_job', label: 'Pekerjaan Ayah' },
    { index: 22, key: 'father_income', label: 'Penghasilan Ayah' },
    { index: 23, key: 'father_nik', label: 'NIK Ayah' },
    { index: 24, key: 'father_phone', label: 'NO HP AYAH' },
    { index: 25, key: 'mother', label: 'Nama Ibu' },
    { index: 26, key: 'mother_birth_year', label: 'Tahun Lahir Ibu' },
    { index: 27, key: 'mother_education', label: 'Jenjang Pendidikan Ibu' },
    { index: 28, key: 'mother_job', label: 'Pekerjaan Ibu' },
    { index: 29, key: 'mother_income', label: 'Penghasilan Ibu' },
    { index: 30, key: 'mother_nik', label: 'NIK Ibu' },
    { index: 31, key: 'mother_phone', label: 'NO HP IBU' },
    { index: 32, key: 'guardian', label: 'Nama Wali' },
    { index: 33, key: 'guardian_birth_year', label: 'Tahun Lahir Wali' },
    { index: 34, key: 'guardian_education', label: 'Jenjang Pendidikan Wali' },
    { index: 35, key: 'guardian_job', label: 'Pekerjaan Wali' },
    { index: 36, key: 'guardian_income', label: 'Penghasilan Wali' },
    { index: 37, key: 'guardian_nik', label: 'NIK Wali' },
    { index: 38, key: 'guardian_phone', label: 'NO HP WALI' },
    { index: 39, key: 'no_akta_lahir', label: 'No Registrasi Akta Lahir' },
    { index: 40, key: 'sekolah_asal', label: 'Sekolah Asal' },
    { index: 41, key: 'child_order', label: 'Anak ke-berapa' },
    { index: 42, key: 'kk_no', label: 'No KK' },
    { index: 43, key: 'berat_badan', label: 'Berat Badan' },
    { index: 44, key: 'tinggi_badan', label: 'Tinggi Badan' },
    { index: 45, key: 'lingkar_kepala', label: 'Lingkar Kepala' },
    { index: 46, key: 'jml_saudara_kandung', label: 'Jml. Saudara Kandung' },
    { index: 47, key: 'jarak_sekolah_km', label: 'Jarak Rumah ke Sekolah (KM)' }
];

let studentsCache = [];
let deleteTargetId = null;
const GURU_WALI_CACHE = new Map(); // Global Cache for Guru Wali
let GURU_WALI_ALL_LOADED = false; // Menandai jika seluruh tabel assignment sekolah sudah tersimpan di cache
let currentDetailStudentNIS = null; // Variable global untuk Detail Modal
let searchTimeout = null; // Tambahkan ini

// --- CACHE CONSTANTS (HEMAT KUOTA FIRESTORE) ---
const CACHE_TTL = 30 * 60 * 60 * 1000; // 30 jam
const KELAS_CACHE_KEY = 'simas_kelas_list_cache';
const SHOW_ALUMNI_CACHE_KEY = 'simas_show_alumni_cache';



onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash); return; }

    const role = localStorage.getItem('user_role');
    const isSuperAdmin = window.hasRole ? window.hasRole('super_admin') : role === 'super_admin';
    // MULTI-ROLE: Ambil role tertinggi untuk halaman ini
    const effectiveRole = window.getEffectiveRoleForPage ?
        window.getEffectiveRoleForPage('siswa.html') : role;

    initLayout(effectiveRole); // Gunakan role tertinggi

    // Tampilkan UI dulu sebelum load data
    document.querySelector('main').classList.remove('hidden');

    // FETCH WALI KELAS INFO
    // Multi-role: cek juga jika wali_kelas adalah role tambahan (misal guru_mapel + wali_kelas)
    const isWaliKelasRole = window.hasRole ? window.hasRole('wali_kelas') : role === 'wali_kelas';
    if (isWaliKelasRole) {
        try {
            const cachedUserDoc = await window.getCurrentUserDoc();
            if (cachedUserDoc) {
                const assignedClass = cachedUserDoc.assignedClass;
                localStorage.setItem('user_assigned_class', assignedClass || '');
            }
        } catch (e) { console.error('Error load wali kelas info:', e); }
    }

    const allowedAllStudentsRoles = ['super_admin', 'wakasek_kurikulum', 'staff', 'guru_mapel', 'guru_bk', 'bk'];
    const canSeeAllStudents = window.hasRole ?
        allowedAllStudentsRoles.some(r => window.hasRole(r)) :
        allowedAllStudentsRoles.includes(role);

    loadClassOptions(canSeeAllStudents);
    setupEventListeners();
    setupImportLogic();

    // 1. IMPORT BUTTON
    const canImport = window.hasRole ?
        (window.hasRole('super_admin') || window.hasRole('kesiswaan') || window.hasRole('staff')) :
        ['super_admin', 'kesiswaan', 'staff'].includes(role);
    const btnImport = document.getElementById('btn-import-student');
    if (btnImport && !canImport) {
        btnImport.classList.add('hidden');
    }

    // 2. ADD & PRINT BUTTON: Blacklist (Existing Logic)
    // Admin PKS, Admin SPP, Guru BK, Guru Mapel tidak boleh Tambah Manual
    // Multi-role: jika punya role yang boleh (super_admin, kesiswaan, staff), jangan hide
    const canAdd = window.hasRole ?
        (window.hasRole('super_admin') || window.hasRole('kesiswaan') || window.hasRole('staff') || window.hasRole('wali_kelas') || window.hasRole('kepala_sekolah')) :
        !['admin_pks', 'admin_spp', 'guru_bk', 'guru_mapel'].includes(role);
    if (!canAdd) {
        const btnAdd = document.getElementById('btn-add-student');
        if (btnAdd) btnAdd.classList.add('hidden');
    }

    // Hide Print Raport for Admin PKS & Admin SPP (Guru BK allowed)
    // Multi-role support
    const canPrint = window.hasRole ?
        !(window.hasRole('admin_pks') || window.hasRole('admin_spp')) || window.hasRole('super_admin') :
        !['admin_pks', 'admin_spp'].includes(role);
    if (!canPrint) {
        const btnPrint = document.getElementById('btn-print-raport');
        if (btnPrint) btnPrint.classList.add('hidden');
    }

    // Hide Surat Keterangan for unauthorized roles (hanya boleh: staff, super_admin, kepala_sekolah, kesiswaan, wakasek_kurikulum, wali_kelas)
    const canPrintSuratKet = window.hasRole ?
        (window.hasRole('staff') || window.hasRole('super_admin') || window.hasRole('kepala_sekolah') || window.hasRole('kesiswaan') || window.hasRole('wakasek_kurikulum') || window.hasRole('wali_kelas')) :
        ['staff', 'super_admin', 'kepala_sekolah', 'kesiswaan', 'wakasek_kurikulum', 'wali_kelas'].includes(role);
    const btnPrintSurat = document.getElementById('btn-print-surat-keterangan');
    if (btnPrintSurat && !canPrintSuratKet) {
        btnPrintSurat.classList.add('hidden');
    }

    // 3. CEK PARAMETER URL: Jika ada ?nis=XXX, langsung buka detail siswa
    const urlParams = new URLSearchParams(window.location.search);
    const urlNIS = urlParams.get('nis');
    if (urlNIS) {
        await openDetailByNIS(urlNIS);
    }

    // 4. TAB NAVIGATION FOR SUPER ADMIN
    if (isSuperAdmin) {
        const tabsNav = document.getElementById('student-tabs-nav');
        if (tabsNav) tabsNav.classList.remove('hidden');
    }
});

// --- HELPER: OPEN DETAIL BY NIS (Untuk handling URL parameter) ---
async function openDetailByNIS(nis) {
    try {
        const safeNis = typeof window.escapeHTML === 'function' ? window.escapeHTML(String(nis || '')) : String(nis || '').replace(/[&<>"']/g, '');

        // Tampilkan loading di tabel
        const tbody = document.getElementById('student-table-body');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="7" class="px-6 py-8 text-center text-blue-500"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Mencari data siswa (NIS: ${safeNis})...</td></tr>`;
        }

        // Prioritaskan dari IndexedDB / global student cache (0 Read)
        let studentData = null;
        if (typeof window.getStudentsCache === 'function') {
            try {
                const allStudents = await window.getStudentsCache();
                const found = allStudents.find(s => String(s.nis || s.id) === String(nis));
                if (found) studentData = found;
            } catch (e) {}
        }

        if (!studentData) {
            try {
                if (cfClient && cfClient.enabled) {
                    const cfStudent = await cfClient.getStudentByNis(nis);
                    if (cfStudent) studentData = cfStudent;
                }
            } catch (cfErr) {
                console.warn('[Students] Gagal mencari siswa dari Cloudflare D1:', cfErr);
            }
        }

        if (!studentData) {
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="7" class="px-6 py-8 text-center text-red-400"><i class="fa-solid fa-circle-xmark mr-2"></i> Siswa dengan NIS "${safeNis}" tidak ditemukan.</td></tr>`;
            }
            showToast("Tidak Ditemukan", `Siswa dengan NIS "${safeNis}" tidak ditemukan dalam database.`, "error");
            return;
        }

        // Masukkan ke cache agar openStudentDetail bisa menemukan
        studentsCache = [studentData];

        // Fetch Poin
        await fetchStudentAggregates(studentsCache);

        // Render tabel dengan data siswa ini
        renderTable(studentsCache);

        // Update filter kelas jika ada
        const classSelect = document.getElementById('filter-class');
        if (classSelect && studentData.class) {
            // Set kelas terpilih jika ada di options
            for (let opt of classSelect.options) {
                if (opt.value === studentData.class) {
                    classSelect.value = studentData.class;
                    break;
                }
            }
        }

        // Buka modal detail
        window.openStudentDetail(studentData.id);

        // Bersihkan URL parameter setelah modal dibuka (opsional, biar URL bersih)
        if (window.history.replaceState) {
            const cleanUrl = window.location.pathname;
            window.history.replaceState({}, document.title, cleanUrl);
        }

    } catch (e) {
        console.error("Error opening detail by NIS:", e);
        showToast("Error", "Gagal membuka data siswa: " + e.message, "error");
    }
}


// --- HELPER: MODAL ANIMATION ---
window.openModal = function (modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    modal.classList.remove('hidden');
    // Trigger Reflow
    void modal.offsetWidth;

    const backdrop = modal.querySelector('div[onclick*="closeModal"]');
    const content = modal.querySelector('div[class*="scale-95"]');

    if (backdrop) backdrop.classList.remove('opacity-0');
    if (content) content.classList.remove('scale-95', 'opacity-0');
};

window.closeModal = function (modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    const backdrop = modal.querySelector('div[onclick*="closeModal"]');
    const content = modal.querySelector('div[class*="scale-95"]'); // Use generic class selector for robustness
    // Or select the inner content div if we know the structure. 
    // The HTML has: <div class="... scale-95 opacity-0 ...">

    if (backdrop) backdrop.classList.add('opacity-0');
    if (content) content.classList.add('scale-95', 'opacity-0');

    setTimeout(() => {
        modal.classList.add('hidden');
    }, 300); // Match transition duration
};

// --- HELPER: TOAST (Menggunakan showToast() dari global.js) ---
// Fungsi showToast() sudah tersedia global dari global.js

// --- REPORT CARD FEATURES ---

window.openPrintModal = function () {
    // 1. Get Context from Active Filter
    const filterEl = document.getElementById('detail-semester-filter');
    const filterLabel = filterEl.options[filterEl.selectedIndex].text;

    // 2. Data Calculation (Logic mirrored from reloadStudentStats for consistency)
    // We rely on window.currentStudentRaw which is populated by openStudentDetail
    if (!window.currentStudentRaw) {
        showToast("Peringatan", "Data siswa belum siap. Silakan buka ulang detail siswa.", "warning");
        return;
    }

    const filterValue = filterEl.value;
    const range = getSmartRange(filterValue);

    // A. POIN/PRESTASI/PERMISI (Always Live Records)
    const records = window.currentStudentRaw?.records || [];
    const filteredRecords = records.filter(r => {
        if (!range) return true; // ALL
        return r.dateObj >= range.start && r.dateObj <= range.end;
    });

    let poin = 0, prestasi = 0, permisi = 0;
    filteredRecords.forEach(r => {
        if (r.type === 'violation' || r.category === 'Pelanggaran') poin += (parseInt(r.point) || parseInt(r.points) || 0);
        else if (r.type === 'achievement' || r.category === 'Prestasi') prestasi++;
        else if (r.type === 'permission' || r.category === 'Permisi') permisi++;
    });

    // B. ATTENDANCE (Murni Supabase Multi-Tahun)
    let s = 0, i = 0, a = 0, d = 0;
    const filteredAtt = (window.currentStudentRaw.attendance || []).filter(att => {
        if (!range) return true;
        return att.dateObj >= range.start && att.dateObj <= range.end;
    });
    filteredAtt.forEach(att => {
        if (att.status === 'S') s++;
        else if (att.status === 'I') i++;
        else if (att.status === 'A') a++;
        else if (att.status === 'D') d++;
    });

    // Update UI Stats Preview
    document.getElementById('print-preview-period').innerText = filterLabel;

    document.getElementById('print-preview-poin').innerText = poin;
    document.getElementById('print-preview-prestasi').innerText = prestasi;
    document.getElementById('print-preview-permisi').innerText = permisi;

    document.getElementById('print-preview-alpha').innerText = a;
    const elS = document.getElementById('print-preview-sakit'); if (elS) elS.innerText = s;
    const elI = document.getElementById('print-preview-izin'); if (elI) elI.innerText = i;
    const elD = document.getElementById('print-preview-dispen'); if (elD) elD.innerText = d;

    // Pre-fill saved note from walikelas_notes SSOT collection
    const nisVal = window.currentStudentRaw.nis || window.currentStudentRaw.id;
    const nowM = new Date().getMonth();
    const nowY = new Date().getFullYear();
    const activeYearStr = (nowM >= 6) ? `${nowY}/${nowY + 1}` : `${nowY - 1}/${nowY}`;
    const activeSemStr = (nowM >= 6 && nowM <= 11) ? '1' : '2';

    const cleanYearStr = activeYearStr.replace('/', '-');
    const noteDocId = `${nisVal}_${cleanYearStr}_${activeSemStr}`;

    const notesInputEl = document.getElementById('print-notes-input');
    if (notesInputEl) notesInputEl.value = ""; // Default reset

    if (cfClient && cfClient.enabled) {
        cfClient.getWalikelasNoteByNis(nisVal, activeYearStr, activeSemStr).then(nDoc => {
            if (nDoc && (nDoc.notes || nDoc.catatanWaliKelas)) {
                if (notesInputEl) notesInputEl.value = nDoc.notes || nDoc.catatanWaliKelas;
            }
        }).catch(e => console.warn("[Students] Error loading note from D1:", e));
    }

    // Clear generation status
    const statusEl = document.getElementById('generation-status');
    if (statusEl) statusEl.innerHTML = "";

    // 4. FETCH HOMEROOM TEACHER (Background)
    window.currentHomeroomTeacher = { name: '.........................', nip: '' }; // Default
    try {
        const cls = document.getElementById('detail-class').innerText;
        if (cls && cls !== '-') {
            window.getWaliKelasByClass(cls).then(guru => {
                if (guru) {
                    window.currentHomeroomTeacher = {
                        name: guru.name || '.........................',
                        nip: guru.nip ? `NIP. ${guru.nip}` : ''
                    };
                } else {
                    const qGuru = query(collection(db, PATHS.users), where('assignedClass', '==', cls), where('role', '==', 'wali_kelas'));
                    getDocs(qGuru).then(async snap => {
                        if (!snap.empty) {
                            const uData = snap.docs[0].data();
                            let name = uData.name || '.........................';
                            let nip = '';
                            if (uData.linkedTeacherId) {
                                const tMap = await window.getTeachersMapCache();
                                const tData = tMap.get(uData.linkedTeacherId);
                                if (tData) {
                                    name = tData.name || name;
                                    nip = tData.nip ? `NIP. ${tData.nip}` : '';
                                }
                            } else if (uData.nip) {
                                nip = `NIP. ${uData.nip}`;
                            }
                            window.currentHomeroomTeacher = {
                                name: name,
                                nip: nip
                            };
                        }
                    });
                }
            });
        }
    } catch (e) { console.error("Gagal load wali kelas", e); }

    // 5. Initialize Date Picker
    const today = window.getLocalISODate(new Date());
    const dateInput = document.getElementById('print-date-input');
    if (dateInput) dateInput.value = today;

    // 6. Muat Riwayat Pembinaan & Konseling Siswa (BK, Guru Wali, Wali Kelas) dari D1
    if (typeof window.fetchStudentPembinaanHistory === 'function') {
        const studentNis = window.currentStudentRaw.nis || window.currentStudentRaw.id;
        const studentCls = document.getElementById('detail-class')?.innerText?.trim() || '';
        const startDateIso = range?.start ? (window.getLocalISODate ? window.getLocalISODate(range.start) : range.start.toISOString().substring(0, 10)) : null;
        const endDateIso = range?.end ? (window.getLocalISODate ? window.getLocalISODate(range.end) : range.end.toISOString().substring(0, 10)) : null;

        window.fetchStudentPembinaanHistory(studentNis, {
            startDateIso,
            endDateIso,
            studentClass: studentCls,
            currentUid: auth?.currentUser?.uid || '',
            currentUserName: auth?.currentUser?.displayName || ''
        }).then(pList => {
            if (window.currentStudentRaw) {
                window.currentStudentRaw.pembinaanList = pList;
            }
        }).catch(e => console.warn("[Students] Gagal load pembinaan di openPrintModal:", e));
    }

    // 7. Load AI Assistant & API Keys automatically
    if (typeof loadUserApiKey === 'function') loadUserApiKey();

    // 8. Inject dynamic model name (SSOT) into HTML badges/labels
    const activeAiConfig = typeof getAiConfig === 'function' ? getAiConfig() : AI_CONFIG;
    const badgeLabel = document.getElementById('gemini-badge-label');
    if (badgeLabel && activeAiConfig && activeAiConfig.displayName) {
        badgeLabel.textContent = activeAiConfig.displayName;
    }

    window.openModal('print-settings-modal');
};


window.toggleNoteMode = function (mode) {
    const aiContainer = document.getElementById('ai-mode-container');
    const noteInput = document.getElementById('print-notes-input');

    if (aiContainer) aiContainer.classList.remove('hidden');
    if (noteInput) {
        // Warna mode catatan menggantikan warna dasar (urutan CSS Tailwind build)
        noteInput.classList.remove('border-slate-200', 'bg-slate-50');
        noteInput.classList.add('border-purple-200', 'bg-purple-50');
        noteInput.placeholder = "Tulis catatan perkembangan siswa di sini atau gunakan AI Assistant...";
    }

    if (typeof loadUserApiKey === 'function') loadUserApiKey();
};

async function loadUserApiKey() {
    const input = document.getElementById('user-gemini-api-key');
    const badge = document.getElementById('api-key-saved-badge');
    const btnGen = document.getElementById('btn-generate-ai');
    const list = document.getElementById('api-key-list');
    const addBtn = document.getElementById('btn-show-add-key');
    const formContainer = document.getElementById('add-api-key-form-container');
    const cancelBtn = document.getElementById('btn-cancel-add-key');

    if (!auth.currentUser) return;

    try {
        const userDoc = await getDoc(doc(db, PATHS.userSecrets, auth.currentUser.uid));
        if (userDoc.exists()) {
            const data = userDoc.data().geminiApiKey;
            if (Array.isArray(data)) {
                window.userApiKeys = data;
            } else if (typeof data === 'string' && data.length > 5) {
                window.userApiKeys = [data]; // Migration
            } else {
                window.userApiKeys = [];
            }
        }

        if (window.renderApiKeyList) window.renderApiKeyList();

        // UI Logic
        if (window.userApiKeys.length > 0) {
            if (badge) badge.classList.remove('hidden');
            if (btnGen) btnGen.classList.remove('hidden');

            // Mode: List View
            if (list) list.classList.remove('hidden');
            if (addBtn) addBtn.classList.remove('hidden');
            if (formContainer) formContainer.classList.add('hidden');
        } else {
            // Mode: Empty state (Show Form)
            if (list) list.classList.add('hidden');
            if (addBtn) addBtn.classList.add('hidden');
            if (formContainer) formContainer.classList.remove('hidden');
        }

        // Update dynamic AI Model Display Name badges
        const activeAiConfig = (typeof getAiConfig === 'function' ? getAiConfig() : null) || (typeof AI_CONFIG !== 'undefined' ? AI_CONFIG : { displayName: 'Gemini AI' });
        const badgeLabels = document.querySelectorAll('#gemini-badge-label, #rapor-gemini-badge-label, .ai-badge-label');
        badgeLabels.forEach(el => { if (el) el.textContent = activeAiConfig.displayName || 'Gemini AI'; });

    } catch (e) {
        console.warn("Load key error", e);
    }
}





// --- MULTI-KEY MANAGEMENT ---
window.userApiKeys = [];

window.renderApiKeyList = function () {
    const list = document.getElementById('api-key-list');
    if (!list) return;
    list.innerHTML = '';
    const canDelete = window.userApiKeys.length > 1;

    window.userApiKeys.forEach((key, index) => {
        const li = document.createElement('li');
        li.className = "flex justify-between items-center bg-white dark:bg-slate-800 px-2 py-1.5 border dark:border-slate-700 rounded text-[10px]";
        const masked = key.substring(0, 4) + '...' + key.substring(key.length - 4);
        const deleteBtn = canDelete
            ? `<button onclick="window.deleteUserApiKey(${index})" class="text-slate-400 hover:text-red-500 transition-colors px-1" title="Hapus Key"><i class="fa-solid fa-trash-can text-[9px]"></i></button>`
            : '';
        li.innerHTML = `
            <span class="font-mono text-slate-600 flex items-center gap-1">
                <i class="fa-solid fa-key text-purple-400 text-[8px]"></i>
                Key ${index + 1}: <b class="text-purple-700">${window.escapeHTML(masked)}</b>
                <span class="text-green-600 font-bold flex items-center gap-0.5 ml-1"><i class="fa-solid fa-circle-check text-[8px]"></i> Valid</span>
            </span>
            ${deleteBtn}
        `;
        list.appendChild(li);
    });
};

window.showAddKeyForm = function () {
    document.getElementById('add-api-key-form-container').classList.remove('hidden');
    document.getElementById('btn-show-add-key').classList.add('hidden');
    const cancelBtn = document.getElementById('btn-cancel-add-key');
    if (cancelBtn) cancelBtn.classList.remove('hidden');
    setTimeout(() => document.getElementById('user-gemini-api-key').focus(), 100);
};

window.cancelAddKey = function () {
    document.getElementById('add-api-key-form-container').classList.add('hidden');
    document.getElementById('btn-show-add-key').classList.remove('hidden');
};

// Menggunakan mekanisme "klik dua kali" untuk konfirmasi tanpa browser alert
window._deleteKeyPending = null;
window.deleteUserApiKey = async function (index) {
    // Guard: tidak boleh hapus jika sisa 1
    if (window.userApiKeys.length <= 1) {
        showToast("Info", "Minimal harus ada 1 API Key.", "info");
        return;
    }

    // Konfirmasi inline: klik pertama = warning, klik kedua = hapus
    if (window._deleteKeyPending !== index) {
        window._deleteKeyPending = index;
        showToast("Konfirmasi", "Klik hapus sekali lagi untuk konfirmasi.", "warning");
        // Reset setelah 3 detik jika tidak diklik lagi
        setTimeout(() => { window._deleteKeyPending = null; }, 3000);
        return;
    }
    window._deleteKeyPending = null;

    try {
        window.userApiKeys.splice(index, 1);
        await setDoc(doc(db, PATHS.userSecrets, auth.currentUser.uid), {
            geminiApiKey: window.userApiKeys,
            updatedAt: serverTimestamp()
        }, { merge: true });
        showToast("Info", "API Key dihapus", "success");
        loadUserApiKey(); // Refresh UI
    } catch (e) {
        showToast("Error", "Gagal hapus key", "error");
        loadUserApiKey();
    }
};

// Helper: Validate Gemini Key by making a small request (SSOT dari Pengaturan)
async function validateUserGeminiKey(apiKey) {
    if (typeof window.validateGeminiApiKeyDirect === 'function') {
        return await window.validateGeminiApiKeyDirect(apiKey);
    }
    try {
        const activeAiConfig = (typeof getAiConfigAsync === 'function' ? await getAiConfigAsync() : null) ||
                               (typeof getAiConfig === 'function' ? getAiConfig() : null) ||
                               AI_CONFIG;
        if (!activeAiConfig?.model) {
            throw new Error("Model AI Gemini belum dikonfigurasi di menu Pengaturan. Harap Super Admin mengisi Model ID di Pengaturan Aplikasi.");
        }
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${activeAiConfig.model}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: "Tes." }] }],
                generationConfig: { maxOutputTokens: 1 }
            })
        });

        const data = await response.json();
        if (!response.ok) {
            const errorMsg = data.error?.message || response.statusText;
            throw new Error(errorMsg);
        }
        return true;
    } catch (e) {
        console.warn("Validation Failed:", e);
        throw e;
    }
}

window.saveUserApiKey = async function () {
    const input = document.getElementById('user-gemini-api-key');
    const btn = document.getElementById('btn-save-api-key');

    if (!input || !auth.currentUser) return;
    const apiKey = input.value.trim();

    if (!apiKey) {
        showToast("Error", "API Key kosong!", "error");
        return;
    }

    // Cek duplikasi
    if (window.userApiKeys.includes(apiKey)) {
        showToast("Info", "API Key ini sudah ada di list.", "info");
        return;
    }

    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Cek...';

        // Validasi
        await validateUserGeminiKey(apiKey);

        // Add to array
        window.userApiKeys.push(apiKey);

        // Save to DB
        await setDoc(doc(db, PATHS.userSecrets, auth.currentUser.uid), {
            geminiApiKey: window.userApiKeys,
            updatedAt: serverTimestamp()
        }, { merge: true });

        showToast("Sukses", "API Key Ditambahkan!", "success");
        btn.innerHTML = 'Simpan';
        btn.disabled = false;
        input.value = "";

        // Refresh UI logic
        loadUserApiKey();

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

/* DEPRECATED
window.saveUserApiKey_OLD = async function () {
    const input = document.getElementById('user-gemini-api-key');
    const btn = document.getElementById('btn-save-api-key');
    const btnGen = document.getElementById('btn-generate-ai');
    const badge = document.getElementById('api-key-saved-badge');

    if (!input || !auth.currentUser) return;

    const apiKey = input.value.trim();
    if (!apiKey) {
        showToast("Error", "API Key tidak boleh kosong", "error");
        return;
    }

    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Cek...';

        // 0. VALIDASI DULU KE GOOGLE
        await validateUserGeminiKey(apiKey);

        // 1. Simpan ke Firestore
        await updateDoc(doc(db, PATHS.users, auth.currentUser.uid), {
            geminiApiKey: apiKey
        });

        // 2. Simpan ke LocalStorage
        localStorage.setItem('user_gemini_key', apiKey);

        showToast("Sukses", "API Key Valid & Tersimpan!", "success");
        btn.innerHTML = '<i class="fa-solid fa-check"></i>';


        // Show Button & Badge, Clear Input
        if (btnGen) {
            btnGen.classList.remove('hidden');
            btnGen.classList.add('animate-fade-in-up');
        }
        if (badge) {
            badge.classList.remove('hidden');
            badge.classList.add('animate-scale-in');
        }
        input.value = "";
        input.placeholder = "API Key tersimpan (Aman). Paste baru untuk update.";

        setTimeout(() => { btn.innerHTML = 'Simpan'; btn.disabled = false; }, 2000);

    } catch (e) {
        console.error("Gagal simpan API Key", e);
        let msg = e.message;
        // Simplify common Gemini errors
        if (msg.includes('API key not valid')) msg = "API Key Tidak Valid (Cek Copy Paste)";
        if (msg.includes('quota')) msg = "Kuota API Key Habis";

        showToast("Validasi Gagal", msg, "error");
        btn.innerHTML = 'Simpan';
        btn.disabled = false;
    }
}; */



window.toggleApiKeyVisibility = function () {
    const input = document.getElementById('user-gemini-api-key');
    const icon = document.getElementById('icon-toggle-api-key');

    if (!input || !icon) return;

    if (input.type === "password") {
        input.type = "text";
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        input.type = "password";
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
};

// --- COPY CATATAN WALI KELAS ---
window.copyNotes = async function () {
    const textArea = document.getElementById('print-notes-input');
    const icon = document.getElementById('icon-copy-notes');
    if (!textArea || !textArea.value.trim()) {
        showToast('Info', 'Belum ada catatan untuk disalin.', 'warning');
        return;
    }

    try {
        await navigator.clipboard.writeText(textArea.value.trim());

        // Feedback visual: ubah ikon jadi centang
        if (icon) {
            icon.classList.remove('fa-regular', 'fa-copy');
            icon.classList.add('fa-solid', 'fa-check', 'text-green-500');
            setTimeout(() => {
                icon.classList.remove('fa-solid', 'fa-check', 'text-green-500');
                icon.classList.add('fa-regular', 'fa-copy');
            }, 1500);
        }

        showToast('Tersalin!', 'Catatan berhasil disalin ke clipboard.', 'success');
    } catch (e) {
        // Fallback untuk browser yang tidak support clipboard API
        textArea.select();
        document.execCommand('copy');
        showToast('Tersalin!', 'Catatan berhasil disalin.', 'success');
    }
};

window.generateAutoNotes = async function () {
    const btn = document.querySelector('button[onclick="window.generateAutoNotes()"]');
    const originalText = btn.innerHTML;
    const textArea = document.getElementById('print-notes-input');

    // Clear status
    const statusEl = document.getElementById('generation-status');
    if (statusEl) statusEl.innerHTML = '';

    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Merangkai Kata...`;
    textArea.placeholder = "AI sedang menyusun kalimat personal...";

    // Context Data from UI
    const poin = parseInt(document.getElementById('print-preview-poin').innerText) || 0;
    const alpha = parseInt(document.getElementById('print-preview-alpha').innerText) || 0;

    // Get Raw Data for Details
    const filterEl = document.getElementById('detail-semester-filter');
    const filterValue = filterEl.value;
    const range = getSmartRange(filterValue);

    // 1. Get Detailed Violations
    const rawRecords = window.currentStudentRaw?.records || [];
    const vioRecords = rawRecords.filter(r => {
        if (range && (r.dateObj < range.start || r.dateObj > range.end)) return false;
        return r.type === 'violation' || r.category === 'Pelanggaran';
    });
    const violationList = vioRecords.map(r => `- ${r.desc || r.violationName || r.name} (${r.point || r.points || 0} Poin)`).join('\n') || "Nihil.";

    // 2. Get Detailed Achievements
    const achRecords = rawRecords.filter(r => {
        if (range && (r.dateObj < range.start || r.dateObj > range.end)) return false;
        return r.type === 'achievement' || r.category === 'Prestasi';
    });
    const achievementList = achRecords.map(r => `- ${r.desc || r.achievementName || r.name} (${r.notes || ''})`).join('\n') || "Tidak ada data prestasi tercatat.";
    const hasPrestasi = achRecords.length > 0 ? 1 : 0;

    // 3. Get Detailed Attendance Reasons (S/I/D - Murni Supabase Multi-Tahun)
    const attList = (window.currentStudentRaw?.attendance || []).filter(a => {
        if (range && (a.dateObj < range.start || a.dateObj > range.end)) return false;
        return ['S', 'I', 'D'].includes(a.status);
    });
    const attendanceNotes = attList.map(a => `${a.status}: ${a.note || 'Tanpa Keterangan'}`);
    const attendanceDetail = attendanceNotes.length > 0 ? attendanceNotes.join(', ') : "Tidak ada catatan khusus.";

    // 4. Get Permission (Leaving Early) Details
    const permRecords = rawRecords.filter(r => {
        if (range && (r.dateObj < range.start || r.dateObj > range.end)) return false;
        return r.type === 'permission' || r.category === 'Permisi';
    });
    const permissionList = permRecords.map(r => `${r.permissionType || 'Izin Keluar'}: ${r.notes || ''}`).join(', ') || "Nihil.";

    const hasPermisi = permRecords.length > 0 ? 1 : 0;

    const studentName = document.getElementById('detail-name').innerText;
    const studentClass = document.getElementById('detail-class').innerText.trim();

    // Deteksi tingkat kelas (X, XI, XII) dan semester untuk konteks AI
    const gradeLevel = studentClass.startsWith('XII') ? 'XII' :
        studentClass.startsWith('XI') ? 'XI' : 'X';
    const semesterMap = {
        'CURRENT_ODD': 'Ganjil (Semester 1)',
        'CURRENT_EVEN': 'Genap (Semester 2)',
        'CURRENT_AY': 'Tahun Ajaran Ini',
        'ALL': 'Seluruh Waktu'
    };
    const semesterLabel = semesterMap[filterValue] || (filterValue.startsWith('ARCHIVE_') ? filterValue.replace('ARCHIVE_', 'Arsip ') : 'Tidak diketahui');

    // Konteks situasional berdasarkan kelas + semester
    let situationalContext = '';
    if (gradeLevel === 'XII' && (filterValue === 'CURRENT_EVEN' || filterValue === 'ALL')) {
        situationalContext = 'Siswa ini berada di kelas XII dan akan segera menyelesaikan pendidikan di sekolah ini. Berikan catatan yang bersifat menguatkan, memotivasi untuk masa depan (kuliah/karir), serta mengapresiasi perjalanan belajar selama di sekolah.';
    } else if (gradeLevel === 'XII' && filterValue === 'CURRENT_ODD') {
        situationalContext = 'Siswa ini berada di kelas XII semester ganjil, sedang mempersiapkan diri menuju semester akhir. Dorong semangat belajar dan persiapan ujian akhir.';
    } else if (gradeLevel === 'XI') {
        situationalContext = 'Siswa ini berada di kelas XI yang merupakan masa krusial pendalaman materi. Dorong konsistensi belajar dan pengembangan minat/bakat.';
    } else if (gradeLevel === 'X') {
        situationalContext = 'Siswa ini berada di kelas X yang merupakan masa adaptasi awal di SMA. Berikan dorongan untuk beradaptasi, aktif berorganisasi, dan membangun fondasi belajar yang kuat.';
    }

    try {
        // 1. Ekstrak records dan attendance yang SUDAH DIFILTER sesuai semester/range aktif
        const filteredRecords = [...vioRecords, ...achRecords, ...permRecords];
        const filteredAttendance = attList;

        // 2. Hitung total hari hadir riil pada rentang aktif
        const totalHadir = (window.currentStudentRaw?.attendance || []).filter(a => {
            if (range && (a.dateObj < range.start || a.dateObj > range.end)) return false;
            return a.status === 'H' || a.status === 'Hadir';
        }).length;

        // 3. Ekstrak data personal
        const rawStudentObj = window.currentStudentRaw?.student || {};
        const gender = rawStudentObj.gender || rawStudentObj.jenis_kelamin || '';
        const studentNickName = extractFriendlyStudentName(studentName);

        // 4. Hitung metrik klasikal dari cache in-memory / IndexedDB (0 database read)
        let classContext = null;
        const computeFn = typeof computeClassicalMetrics === 'function' ? computeClassicalMetrics : window.computeClassicalMetrics;
        if (typeof computeFn === 'function' && typeof window.getStudentsCache === 'function') {
            try {
                const allStudents = await window.getStudentsCache();
                const classStudents = (Array.isArray(allStudents) && studentClass)
                    ? allStudents.filter(s => (s.class || s.kelas) === studentClass)
                    : [];
                const allAggregates = typeof window.getStudentAggregatesCache === 'function'
                    ? await window.getStudentAggregatesCache()
                    : [];
                classContext = computeFn({
                    students: classStudents,
                    aggregates: allAggregates,
                    targetNis: window.currentStudentRaw?.nis || '',
                    targetAlpha: alpha
                });
            } catch (errClassContext) {
                console.warn('[Students] Calculate class context notice:', errClassContext);
            }
        }

        // --- MULTI-KEY ROTATION LOGIC WITH SSOT PROMPT BUILDER ---
        const prompt = buildRaporNotePrompt({
            studentName: studentName,
            studentNickName: studentNickName,
            studentClass: studentClass,
            gender: gender,
            yearVal: filterValue.startsWith('ARCHIVE_') ? filterValue.replace('ARCHIVE_', '') : '2026/2027',
            semVal: semesterLabel,
            poin: poin,
            alpha: alpha,
            totalHadir: totalHadir,
            classContext: classContext,
            records: filteredRecords,
            attendance: filteredAttendance,
            pembinaan: window.currentStudentRaw?.pembinaanList || []
        });

        // 2. Prepare manual key if any in input
        const manualInputKey = document.getElementById('user-gemini-api-key')?.value.trim();

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
        if (data.candidates && data.candidates[0].content.parts[0].text) {
            let aiText = data.candidates[0].content.parts[0].text.trim();
            // Jika keluaran terpotong tanpa tanda baca akhir, rapikan hingga akhir kalimat terakhir yang utuh
            if (!/[.!?]$/.test(aiText)) {
                const lastPunctuation = Math.max(aiText.lastIndexOf('.'), aiText.lastIndexOf('!'), aiText.lastIndexOf('?'));
                if (lastPunctuation > 20) {
                    aiText = aiText.slice(0, lastPunctuation + 1).trim();
                }
            }
            textArea.value = aiText;
            if (statusEl) {
                const modelName = (activeAiConfig && activeAiConfig.displayName) ? activeAiConfig.displayName : "Gemini AI";
                statusEl.innerHTML = `Powered by <b>Google ${modelName}</b> — AI terbaru & tercepat`;
                statusEl.className = "text-[9px] text-slate-400 italic mt-1";
            }
            const keyInfo = successKeyLabel ? ` via ${successKeyLabel}` : '';
            window.showToast("Sukses", `Catatan dibuat${keyInfo}`, "success");
        } else {
            throw new Error("Empty AI Response");
        }

    } catch (e) {
        console.warn("AI Gagal, fallback ke lokal", e);

        // Update Status FIRST
        if (statusEl) {
            statusEl.innerHTML = '<i class="fa-solid fa-laptop-code mr-1"></i> System Auto-Gen';
            statusEl.className = "text-[10px] uppercase font-bold tracking-wider text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200";
        }

        // FALLBACK LOCAL LOGIC
        try {
            runFallbackNotes(studentName, poin, alpha, hasPrestasi, hasPermisi, textArea);
        } catch (errFallback) {
            console.error("Fallback Failed", errFallback);
            textArea.value = "Mohon maaf, sistem gagal membuat catatan otomatis.";
        }

        window.showToast("Mode Offline: Generator Lokal Digunakan", "info");
    } finally {
        btn.disabled = false; btn.innerHTML = originalText; textArea.focus();
    }
};


const TEMPLATES = {
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
        minor: [ // 1-15 points
            "secara umum perilaku ananda baik, namun ada sedikit catatan kecil yang perlu diperbaiki.",
            "ananda anak yang baik, meski sesekali perlu diingatkan terkait aturan.",
            "kedisiplinan sudah cukup mumpuni, tinggal ditingkatkan lagi ketelitiannya pada tata tertib.",
            "kami harap ananda lebih mawas diri agar catatan pelanggaran ringan tidak terulang.",
            "mari perbaiki beberapa kelalaian kecil agar rekam jejak ananda semakin bersih."
        ],
        major: [ // >15 points
            "kami menyoroti perlunya perbaikan serius dalam hal kedisiplinan dan ketaatan aturan.",
            "mohon orang tua turut membina ananda agar frekuensi pelanggaran dapat ditekan.",
            "perlu adanya perubahan sikap yang signifikan demi kebaikan masa depan ananda.",
            "kami mengharapkan komitmen lebih kuat dari ananda untuk mematuhi tata tertib sekolah.",
            "evaluasi kedisiplinan ini penting untuk direnungkan agar ananda tidak terhambat masalah perilaku."
        ]
    },
    attendance: {
        perfect: [ // Alpha = 0, Permisi/Sakit < 5
            "Kehadiran ananda yang rajin sangat menunjang proses belajarnya.",
            "Konsistensi kehadiran ananda sangat baik dan patut dipertahankan.",
            "Disiplin waktu dan kehadiran ananda di kelas sangat memuaskan.",
            "Terima kasih telah menjaga kehadiran yang prima di sekolah.",
            "Semangat bersekolah ananda terlihat dari rekam jejak absensi yang minim."
        ],
        warning: [ // Alpha > 0 or Total Absent high
            "Mohon agar frekuensi ketidakhadiran dikurangi agar tidak tertinggal pelajaran.",
            "Perlu peningkatan kehadiran agar ananda bisa lebih maksimal menyerap materi di kelas.",
            "Kami menyarankan agar izin keluar atau ketidakhadiran hanya dilakukan jika sangat mendesak.",
            "Fokus belajar ananda akan lebih baik jika kehadiran di sekolah lebih rutin.",
            "Kehadiran adalah kunci sukses, mari kurangi ijin/alpa yang tidak perlu."
        ]
    },
    achievement: {
        yes: [
            "Selamat dan bangga atas prestasi yang telah diraih, semoga menjadi motivasi untuk terus berkarya.",
            "Pencapaian ananda di bidang non-akademik turut mengharumkan nama sekolah.",
            "Teruslah asah bakat ananda, prestasi ini adalah bukti potensi yang luar biasa.",
            "Kami sangat mengapresiasi keaktifan dan prestasi ananda di luar kelas.",
            "Pertahankan semangat kompetisi positif ini untuk masa depan yang gemilang."
        ],
        no: [
            "Kami yakin ananda memiliki potensi terpendam yang siap digali lebih dalam.",
            "Teruslah semangat belajar, kami menantikan partisipasi aktif ananda di kegiatan mendatang.",
            "Jangan ragu untuk mengeksplorasi minat dan bakat baru di lingkungan sekolah.",
            "Fokus akademik sudah baik, cobalah untuk lebih aktif di kegiatan ekstrakurikuler.",
            "Setiap anak punya bakat unik, mari temukan dan kembangkan potensi ananda."
        ]
    },
    closing: [
        "Teruslah berkarya dan jadilah pribadi yang bermanfaat.",
        "Semoga semester depan membawa pencapaian yang lebih gemilang.",
        "Kami mendukung sepenuhnya langkah ananda menuju kesuksesan.",
        "Pertahankan yang baik dan perbaiki yang kurang, sukses selalu untuk ananda.",
        "Tetap rendah hati dan semangat dalam menuntut ilmu.",
        "Jadilah versi terbaik dari dirimu setiap harinya."
    ]
};

function runFallbackNotes(name, poin, alpha, hasPrestasi, hasPermisi, textArea) {
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const format = (str) => str.replace(/\$\{name\}/g, name);

    // 1. Opening
    let parts = [];
    parts.push(format(pick(TEMPLATES.opening)));

    // 2. Discipline Logic
    if (poin === 0) parts.push(format(pick(TEMPLATES.discipline.perfect)));
    else if (poin <= 15) parts.push(format(pick(TEMPLATES.discipline.minor)));
    else parts.push(format(pick(TEMPLATES.discipline.major)));

    // 3. Attendance Logic (Alpha > 0 or Total Absent > 6 considered warning)
    const totalAbsent = alpha + (hasPermisi ? 3 : 0); // Weighted permission check approximation or pass distinct count
    if (alpha > 0 || totalAbsent > 6) parts.push(format(pick(TEMPLATES.attendance.warning)));
    else parts.push(format(pick(TEMPLATES.attendance.perfect)));

    // 4. Achievement Logic
    if (hasPrestasi) parts.push(format(pick(TEMPLATES.achievement.yes)));
    else parts.push(format(pick(TEMPLATES.achievement.no)));

    // 5. Closing
    parts.push(format(pick(TEMPLATES.closing)));

    // Combine with natural flow
    textArea.value = parts.join(" ");
}

/**
 * Save Catatan Wali Kelas directly from Print Rapor Settings Modal (SSOT walikelas_notes)
 */
window.saveCatatanFromPrintModalSiswa = async function (shouldCloseModal = true) {
    if (!window.currentStudentRaw) {
        showToast("Peringatan", "Data siswa belum siap", "warning");
        return;
    }

    const nis = window.currentStudentRaw.nis || window.currentStudentRaw.id;
    const studentName = window.currentStudentRaw.name || document.getElementById('detail-name')?.innerText || '';
    const studentClass = window.currentStudentRaw.class || document.getElementById('detail-class')?.innerText || '';
    const text = document.getElementById('print-notes-input')?.value.trim() || '';

    const curMonth = new Date().getMonth();
    const curYear = new Date().getFullYear();
    const activeYear = (curMonth >= 6) ? `${curYear}/${curYear + 1}` : `${curYear - 1}/${curYear}`;
    const activeSem = (curMonth >= 6 && curMonth <= 11) ? '1' : '2';

    const btnSave = document.getElementById('btn-save-note-print-siswa');
    if (btnSave) {
        btnSave.disabled = true;
        btnSave.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Menyimpan...';
    }

    try {
        const cleanYear = activeYear.replace(/\//g, '-');
        const docId = `${nis}_${cleanYear}_${activeSem}`;

        if (cfClient && cfClient.enabled) {
            await cfClient.saveWalikelasNote({
                id: docId,
                student_nis: String(nis),
                student_name: studentName,
                student_class: studentClass,
                academic_year: activeYear,
                semester: activeSem,
                notes: text
            });
        }

        if (typeof window.logAudit === 'function') {
            window.logAudit('UPDATE_WALIKELAS_NOTE', 'walikelas_notes', docId, null, `Menyimpan Catatan Wali Kelas ${studentName} (${nis}) TA ${activeYear} Sem ${activeSem}`);
        }

        showToast("Sukses", `Catatan Wali Kelas ${studentName} berhasil disimpan`, "success");
        if (shouldCloseModal) {
            window.closeModal('print-settings-modal');
        }

    } catch (err) {
        console.error("[Students] Error saving walikelas_note:", err);
        showToast("Error", "Gagal menyimpan Catatan Wali Kelas", "error");
    } finally {
        if (btnSave) {
            btnSave.disabled = false;
            btnSave.innerHTML = '<i class="fa-solid fa-floppy-disk font-bold"></i> Simpan Catatan';
        }
    }
};

window.printReportCard = async function () {
    if (!window.currentStudentRaw) return;

    // Automatically save note to walikelas_notes SSOT collection
    await window.saveCatatanFromPrintModalSiswa(false);
    const studentName = document.getElementById('detail-name').innerText;
    const studentClass = document.getElementById('detail-class').innerText;
    const studentNIS = document.getElementById('detail-nis').innerText;
    const studentNISN = (document.getElementById('detail-nisn')?.innerText !== '-' && document.getElementById('detail-nisn')?.innerText) || window.currentStudentRaw?.nisn || '-';
    const notes = document.getElementById('print-notes-input').value;
    // Get Report Date
    const dateInputVal = document.getElementById('print-date-input').value;
    const reportDate = dateInputVal ? formatDateIndoFormal(dateInputVal) : formatDateIndoFormal(window.getLocalISODate ? window.getLocalISODate() : new Date());

    // Get Stats from UI
    const poin = document.getElementById('print-preview-poin').innerText;
    // Retrieve Counts
    const s = document.getElementById('print-preview-sakit').innerText;
    const i = document.getElementById('print-preview-izin').innerText;
    const a = document.getElementById('print-preview-alpha').innerText;
    const d = document.getElementById('print-preview-dispen').innerText;
    const p = document.getElementById('print-preview-permisi').innerText;

    // Filter Info & Dynamic Header Parsing
    const filterEl = document.getElementById('detail-semester-filter');
    const filterVal = filterEl.value;

    let academicYear = "";
    let semesterDisplay = "";

    // 1. Determine Academic Year from Filter Value
    const yearMatch = filterVal.match(/(\d{4})_(\d{4})$/);
    if (yearMatch) {
        academicYear = `${yearMatch[1]}/${yearMatch[2]}`;
    } else if (filterVal.startsWith('ARCHIVE_')) {
        academicYear = filterVal.replace('ARCHIVE_', '');
    } else {
        const nowY = new Date().getFullYear();
        academicYear = `${nowY}/${nowY + 1}`;
    }

    // 2. Determine Semester Label
    if (filterVal.startsWith('AY_') || filterVal.startsWith('ARCHIVE_')) {
        semesterDisplay = "1 (Satu) & 2 (Dua)";
    } else if (filterVal.includes('_ODD_')) {
        semesterDisplay = "1 (Satu)";
    } else if (filterVal.includes('_EVEN_')) {
        semesterDisplay = "2 (Dua)";
    } else {
        semesterDisplay = "1 (Satu) & 2 (Dua)";
    }

    // Legacy variable for compatibility if needed (unused)
    const semesterPart = "";
    // Use the actual period label for "Tahun Pelajaran" context if possible, or parse it.
    // Assuming periodLabel is like "2025/2026 Ganjil"

    // Homeroom Teacher Data & NIP Handling (SSOT per Kelas Siswa)
    const teacher = (typeof window.resolveHomeroomTeacher === 'function')
        ? await window.resolveHomeroomTeacher(studentClass, null)
        : {
            name: `Wali Kelas ${studentClass}`,
            nip: ''
        };

    // DATA FETCHING (Re-filter for constraints)
    // DATA FETCHING (Re-filter for constraints)
    const range = getSmartRange(filterVal);

    // 1. Records (Live Data for violations/achievements/permissions)
    let rawRecords = window.currentStudentRaw?.records || [];
    const aggPoinVal = Number(poin || 0);
    if ((!Array.isArray(rawRecords) || rawRecords.length === 0) && aggPoinVal > 0 && cfClient && cfClient.enabled) {
        try {
            const studentNisVal = window.currentStudentRaw?.nis || studentNIS;
            const snapRec = await cfClient.getRecords({ nis: String(studentNisVal).trim(), limit: 100 });
            if (Array.isArray(snapRec) && snapRec.length > 0) {
                rawRecords = snapRec.map(d => {
                    const timeObj = d.timestamp?.toDate ? d.timestamp.toDate() : (d.timestampIso ? new Date(d.timestampIso) : (d.date ? new Date(d.date) : (d.timestamp ? new Date(d.timestamp) : new Date())));
                    return {
                        id: d.id,
                        studentNIS: d.studentNIS || d.student_nis,
                        studentName: d.studentName || d.student_name,
                        studentClass: d.studentClass || d.student_class,
                        category: d.category,
                        type: d.type,
                        points: d.points || 0,
                        desc: d.desc || d.description || d.title || '',
                        createdBy: d.createdBy || d.created_by,
                        timestamp: d.timestamp,
                        dateObj: (!isNaN(timeObj.getTime())) ? timeObj : new Date()
                    };
                });
                if (window.currentStudentRaw) {
                    window.currentStudentRaw.records = rawRecords;
                }
            }
        } catch (eR) {
            console.warn('[Students] Fallback records in printReportCard notice:', eR);
        }
    }
    const filteredRecords = rawRecords.filter(r => {
        if (!range) return true;
        return r.dateObj >= range.start && r.dateObj <= range.end;
    });

    // Sort chronological
    const violations = filteredRecords.filter(r => r.type === 'violation' || r.type === 'pelanggaran' || r.category === 'Pelanggaran' || (r.points && Number(r.points) > 0 && r.type !== 'achievement' && r.type !== 'prestasi' && r.category !== 'Prestasi')).sort((a, b) => a.dateObj - b.dateObj);
    const achievements = filteredRecords.filter(r => r.type === 'achievement' || r.type === 'prestasi' || r.category === 'Prestasi').sort((a, b) => a.dateObj - b.dateObj);
    // Explicit Permission Records (if any stored as records, usually 'Izin Keluar' is mostly attendance P, but if 'permission' type exists in records):
    const permissionRecords = filteredRecords.filter(r => r.type === 'permission' || r.type === 'permisi' || r.category === 'Permisi').sort((a, b) => a.dateObj - b.dateObj);

    // 2. Attendance Details (S/I/A/D/P) (Murni Supabase Multi-Tahun)
    const rawAtt = (window.currentStudentRaw.attendance || []).filter(r => {
        if (!range) return true;
        return r.dateObj >= range.start && r.dateObj <= range.end;
    });
    let attLogs = rawAtt.map(r => ({
        dateObj: r.dateObj,
        dateStr: r.date,
        status: r.status,
        note: r.note || '-'
    }));

    // Combine Permissions (P) into this log if they are separate records? 
    // Usually 'P' is counted separately. The reference image says "Catatan Ketidakhadiran & Permisi".
    // We will combine them.
    permissionRecords.forEach(pr => {
        attLogs.push({
            dateObj: pr.dateObj,
            dateStr: window.getLocalISODate(pr.dateObj),
            status: 'P',
            note: pr.notes || pr.permissionType || 'Izin Keluar'
        });
    });

    // Sort All Logs
    attLogs.sort((a, b) => a.dateObj - b.dateObj);
    attLogs = attLogs.filter(l => l.status !== 'H' && l.status !== 'h');

    // 3. SPP Debt Checking (Hanya jika siswa menunggak - 0 Read Firestore)
    let sppTunggakan = { unpaidCount: 0, totalNominal: 0, unpaidMonths: [] };
    try {
        const studentNisVal = window.currentStudentRaw?.nis || studentNIS;
        if (studentNisVal && supabase) {
            const cleanNis = String(studentNisVal).trim();
            const normNis = cleanNis.replace(/^0+/, '');
            const searchNisList = Array.from(new Set([cleanNis, normNis, cleanNis.padStart(4, '0')].filter(Boolean)));

            const { data: txData, error: txErr } = await supabase
                .from('finance_transactions')
                .select('year, month, amount, type')
                .in('student_nis', searchNisList);

            if (!txErr && Array.isArray(txData)) {
                const paymentHistory = {};
                txData.forEach(d => {
                    if (d.year && d.month) {
                        paymentHistory[`${d.year}-${d.month}`] = {
                            amount: Number(d.amount) || 0,
                            type: d.type || 'paid'
                        };
                    }
                });

                const studentObj = window.currentStudentRaw?.student || { class: studentClass };
                const ratesConfig = typeof window.getFinanceRatesCache === 'function' ? await window.getFinanceRatesCache() : null;
                const financeConfig = typeof window.getFinanceConfigCache === 'function' ? await window.getFinanceConfigCache() : null;
                const dueDate = Number(financeConfig?.dueDate) || 20;

                sppTunggakan = calculateStudentTunggakan(studentObj, paymentHistory, ratesConfig, dueDate);
            }
        }
    } catch (eSpp) {
        console.warn('[Students] Error fetching SPP debt status for report card:', eSpp);
    }

    // 4. Riwayat Pembinaan & Konseling Siswa (BK, Guru Wali, Wali Kelas)
    let pembinaanList = window.currentStudentRaw?.pembinaanList;
    if (!pembinaanList && typeof window.fetchStudentPembinaanHistory === 'function') {
        try {
            const startDateIso = range?.start ? (window.getLocalISODate ? window.getLocalISODate(range.start) : range.start.toISOString().substring(0, 10)) : null;
            const endDateIso = range?.end ? (window.getLocalISODate ? window.getLocalISODate(range.end) : range.end.toISOString().substring(0, 10)) : null;
            pembinaanList = await window.fetchStudentPembinaanHistory(studentNIS, {
                startDateIso,
                endDateIso,
                studentClass: studentClass,
                currentUid: auth?.currentUser?.uid || '',
                currentUserName: auth?.currentUser?.displayName || ''
            });
            if (window.currentStudentRaw) {
                window.currentStudentRaw.pembinaanList = pembinaanList;
            }
        } catch (ePemb) {
            console.warn('[Students] Gagal load pembinaan sebelum cetak rapor:', ePemb);
            pembinaanList = [];
        }
    }
    pembinaanList = pembinaanList || [];

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
                            <td class="font-bold text-red-600">Rp ${sppTunggakan.totalNominal.toLocaleString('id-ID')}</td>
                        </tr>
                        <tr>
                            <td>Rincian Bulan Belum Lunas</td>
                            <td>:</td>
                            <td class="text-sm italic">${window.escapeHTML(sppTunggakan.unpaidMonths.join(', '))}</td>
                        </tr>
                    </tbody>
                </table>
                <p class="text-[10px] italic text-slate-600 mt-1">* Mohon bantuan Bapak/Ibu Orang Tua/Wali Murid untuk segera menyelesaikan administrasi iuran komite di loket bendahara sekolah demi kelancaran operasional pendidikan ananda.</p>
            </div>
    ` : '';

    const kopUrl = new URL('assets/kop.png', window.location.href).href;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        if (typeof Swal !== 'undefined') {
            Swal.fire({
                icon: 'warning',
                title: 'Pop-up Terblokir',
                text: 'Peramban memblokir jendela pratinjau cetak. Mohon izinkan pop-up (Always allow pop-ups) pada peramban Anda untuk mencetak Rapor Karakter/Afektif Siswa.'
            });
        } else if (typeof showToast === 'function') {
            showToast("Pop-up Terblokir", "Harap izinkan pop-up peramban untuk membuka pratinjau cetak rapor.", "warning");
        }
        return;
    }
    printWindow.document.write(`
        <html>
        <head>
            <title>Rapor Karakter - ${studentName}</title>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Times+New+Roman:wght@400;700&display=swap');
                body { font-family: 'Times New Roman', serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-size: 11pt; }
                @page { size: A4; margin: 10mm 15mm; }
                .double-underline { border-bottom: 3px double black; display: inline-block; padding-bottom: 2px; }
                table { width: 100%; border-collapse: collapse; }
                th, td { border: 1px solid black; padding: 4px 6px; }
                .no-border td { border: none; padding: 2px; }
                .gray-header { background-color: #E5E7EB; font-weight: bold; text-transform: uppercase; }
            </style>
            <link rel="stylesheet" href="${new URL('css/tailwind.css', document.baseURI).href}">
        </head>
        <body class="bg-white text-black p-4">
            
            <!-- KOP SURAT -->
            <div class="mb-2 text-center relative">
                 <img src="${kopUrl}" class="w-full h-auto object-contain max-h-36 mx-auto" alt="Kop Surat" onerror="this.src='https://placehold.co/800x150?text=KOP+SURAT'">
            </div>

            <!-- JUDUL -->
            <div class="text-center mb-6 mt-4">
                <h1 class="text-xl font-bold uppercase double-underline mb-2">LAPORAN PERKEMBANGAN AFEKTIF SISWA</h1>
                <p class="font-bold text-lg">Tahun Pelajaran ${academicYear}</p>
            </div>

            <!-- DATA SISWA -->
            <div class="mb-6">
                <table class="w-full no-border font-bold">
                    <tr>
                        <td style="width: 15%">Nama Siswa</td>
                        <td style="width: 2%">:</td>
                        <td style="width: 40%">${window.escapeHTML(studentName.toUpperCase())}</td>
                        <td style="width: 10%">Kelas</td>
                        <td style="width: 2%">:</td>
                        <td style="width: 31%">${window.escapeHTML(studentClass)}</td>
                    </tr>
                    <tr>
                        <td>NIS / NISN</td>
                        <td>:</td>
                        <td>${window.escapeHTML(studentNIS)} / ${window.escapeHTML(studentNISN)}</td>
                        <td>Semester</td>
                        <td>:</td>
                        <td>${semesterDisplay}</td>
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
                        ${achievements.length > 0 ? achievements.map((r, i) => `
                        <tr>
                            <td class="text-center">${i + 1}</td>
                            <td class="text-center">${new Date(r.dateObj).toLocaleDateString('id-ID')}</td>
                            <td>${window.escapeHTML(r.desc || r.achievementName || r.name)}</td>
                        </tr>`).join('') : `
                        <tr><td colspan="3" class="text-center italic text-gray-500 py-4">- Tidak ada catatan khusus -</td></tr>
                        `}
                    </tbody>
                </table>
            </div>

            <!-- B. CATATAN KETIDAKHADIRAN & PERMISI -->
            <div class="mb-6">
                <div class="gray-header border border-black border-b-0 p-1 pl-2 text-sm">B. CATATAN KETIDAKHADIRAN & PERMISI</div>
                
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
        if (l.status === 'S') statusLabel = 'Sakit';
        if (l.status === 'I') statusLabel = 'Izin';
        if (l.status === 'A') statusLabel = 'Alpha';
        if (l.status === 'D') statusLabel = 'Dispensasi';
        if (l.status === 'P') statusLabel = 'Permisi';

        return `
                            <tr>
                                <td class="text-center">${new Date(l.dateObj).toLocaleDateString('id-ID')}</td>
                                <td class="text-center">${statusLabel}</td>
                                <td>${window.escapeHTML(l.note)}</td>
                            </tr>
                            `;
    }).join('') : `
                        <tr><td colspan="3" class="text-center italic text-gray-500 py-4">- Hadir Penuh (Nihil Absen/Permisi) -</td></tr>
                        `}
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
                            ${violations.map((v, i) => `
                            <tr>
                                <td class="text-center">${i + 1}</td>
                                <td class="text-center">${new Date(v.dateObj).toLocaleDateString('id-ID')}</td>
                                <td>${window.escapeHTML(v.desc || v.violationName || v.name)}</td>
                                <td class="text-center font-bold text-red-600">${v.point || v.points || 0}</td>
                            </tr>`).join('')}
                            <tr class="font-bold bg-slate-50">
                                <td colspan="3" class="text-right pr-4">Total Poin Pelanggaran:</td>
                                <td class="text-center text-red-600">${violations.reduce((sum, v) => sum + (parseInt(v.point) || parseInt(v.points) || 0), 0)}</td>
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
                            const dateText = item.date ? (window.formatDateIndo ? window.formatDateIndo(item.date) : item.date) : '-';
                            const followUpNote = item.followUp ? `<div class="mt-0.5 text-xs text-slate-600 italic"><b>Tindak Lanjut:</b> ${window.escapeHTML(item.followUp)}</div>` : '';
                            return `
                            <tr>
                                <td class="text-center">${idx + 1}</td>
                                <td class="text-center">${window.escapeHTML(dateText)}</td>
                                <td>
                                    <div class="font-bold">${window.escapeHTML(item.counselor || '-')}</div>
                                    <div class="text-xs text-slate-500">${window.escapeHTML(item.role || 'Pembina')} &bull; ${window.escapeHTML(item.category || 'Umum')}</div>
                                </td>
                                <td>
                                    <div>${window.escapeHTML(item.notes || '-')}</div>
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
                    ${window.escapeHTML(notes)}
                 </div>
             </div>

            <!-- TTD -->
            <div class="flex justify-between mt-8 text-sm break-inside-avoid px-8">
                <div class="text-center">
                    <p class="mb-16">Mengetahui,<br>Orang Tua/Wali</p>
                    <p class="font-bold border-b border-black inline-block min-w-[200px]">( ........................................ )</p>
                </div>
                <div class="text-center">
                    <p class="mb-16">Denpasar, ${reportDate}<br>Wali Kelas ${window.escapeHTML(studentClass)}</p>
                    <p class="font-bold border-b border-black inline-block min-w-[200px]">${window.escapeHTML(teacher.name)}</p>
                    ${teacher.nip ? `<p class="mt-1 font-bold">${window.escapeHTML(String(teacher.nip).trim().toUpperCase().startsWith('NIP') ? teacher.nip : `NIP. ${teacher.nip}`)}</p>` : ''}
                </div>
            </div>

            <!-- FOOTER PROFESIONAL -->
            <div class="mt-12 text-center border-t border-slate-300 pt-2">
                <p class="text-[10px] text-slate-500 italic font-medium">
                    Dokumen ini disusun dan dicetak otomatis oleh sistem aplikasi ${SCHOOL_CONFIG.appName} - ${SCHOOL_CONFIG.schoolName}.
                </p>
            </div>

            <script>window.onload = function() { window.print(); }<\/script>
        </body>
        </html>
    `);
    printWindow.document.close();
};

// =========================================================================
// --- FITUR CETAK SURAT KETERANGAN SISWA (STANDAR DINAS A4) ---
// =========================================================================

/**
 * Mengonversi string ke Title Case (kapital hanya di awal kata saja).
 * Menjaga tanda baca umum dan memformat karakter awal setiap kata dengan huruf kapital.
 * Contoh: "KARANGASEM" -> "Karangasem", "BR. DINAS PURWAYA" -> "Br. Dinas Purwaya"
 * @param {string} str
 * @returns {string}
 */
function toTitleCase(str) {
    if (!str || typeof str !== 'string') return '';
    const trimmed = str.trim().replace(/\s+/g, ' ');
    if (!trimmed || trimmed === '-') return '';

    return trimmed.toLowerCase().replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (match, prefix, char) => {
        return prefix + char.toUpperCase();
    });
}
if (typeof window !== 'undefined') {
    window.toTitleCase = toTitleCase;
}

/**
 * Format alamat siswa secara terstruktur dan formal untuk dokumen kedinasan Surat Keterangan.
 * Mengharuskan pencantuman hirarki: Desa/Kelurahan, Kecamatan, Kabupaten, Provinsi,
 * serta memastikan penulisan kapital hanya di awal kata saja (Title Case).
 * Jika alamat sumber sudah memiliki komponen tersebut secara lengkap, sistem akan menyesuaikan
 * tanpa menduplikasi komponen wilayah.
 *
 * @param {object} student Objek data siswa
 * @param {string} [customAddress] Input alamat kustom dari textarea (opsional)
 * @returns {string} Alamat terformat Title Case lengkap dengan Desa, Kecamatan, Kabupaten, Provinsi
 */
function formatStudentAddress(student, customAddress = null) {
    if (!student && !customAddress) return '-';

    // 1. Ambil teks alamat mentah
    let rawAddress = typeof customAddress === 'string' && customAddress.trim()
        ? customAddress.trim()
        : String(student?.alamat || student?.address || '').trim();

    const dusun = String(student?.dusun || '').trim();
    let kelurahan = String(student?.kelurahan || student?.desa || '').trim();
    let kecamatan = String(student?.kecamatan || '').trim();
    let kabupaten = String(student?.kabupaten || student?.kota || student?.city || '').trim();
    let provinsi = String(student?.provinsi || student?.province || '').trim();

    // Default sekolah jika tidak ada di entitas siswa
    const defaultKecamatan = 'Abang';
    const defaultKabupaten = 'Karangasem';
    const defaultProvinsi = 'Bali';

    // Jika alamat mentah kosong namun dusun tersedia, gunakan dusun sebagai komponen pangkal
    if (!rawAddress && dusun) {
        rawAddress = (/^(br\.?|banjar|dusun)\b/i.test(dusun)) ? dusun : `Br. Dinas ${dusun}`;
    }

    if (!rawAddress) {
        rawAddress = '-';
    }

    // 2. Normalisasi singkatan umum kedinasan di teks alamat (Ds. -> Desa, Kec. -> Kecamatan, Kab. -> Kabupaten, Prov. -> Provinsi)
    let processed = rawAddress
        .replace(/\bds\.?\s+/gi, 'Desa ')
        .replace(/\bkel\.?\s+/gi, 'Kelurahan ')
        .replace(/\bkec\.?\s+/gi, 'Kecamatan ')
        .replace(/\bkab\.?\s+/gi, 'Kabupaten ')
        .replace(/\b(prov|prop)\.?\s+/gi, 'Provinsi ');

    // 3. Helper pembersih keyword dasar untuk pencocokan wilayah
    const cleanGeoKeyword = (s) => {
        return String(s || '')
            .toLowerCase()
            .replace(/^(desa|kelurahan|kecamatan|kabupaten|kota|provinsi|propinsi)\s+/i, '')
            .trim();
    };

    const targetDesa = kelurahan;
    const targetDesaKeyword = cleanGeoKeyword(targetDesa);

    const targetKec = kecamatan || defaultKecamatan;
    const targetKecKeyword = cleanGeoKeyword(targetKec);

    const targetKab = kabupaten || defaultKabupaten;
    const targetKabKeyword = cleanGeoKeyword(targetKab);

    const targetProv = provinsi || defaultProvinsi;
    const targetProvKeyword = cleanGeoKeyword(targetProv);

    // 4. Pecah berdasarkan koma untuk identifikasi per segmen
    let segments = processed
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

    // 5. Penyesuaian Komponen: Desa / Kelurahan
    let hasDesa = segments.some(seg => /\b(desa|kelurahan)\s+[a-z0-9]/i.test(seg));
    if (!hasDesa && targetDesaKeyword) {
        // Cari segmen yang persis nama desa tanpa prefiks
        const exactDesaIdx = segments.findIndex(seg => cleanGeoKeyword(seg) === targetDesaKeyword && !/^(br\.?|banjar|dusun|jl\.?|jalan)\b/i.test(seg));
        if (exactDesaIdx !== -1) {
            const prefix = /^kelurahan\b/i.test(targetDesa) ? 'Kelurahan' : 'Desa';
            segments[exactDesaIdx] = `${prefix} ${toTitleCase(targetDesaKeyword)}`;
            hasDesa = true;
        } else if (targetDesa) {
            const desaLabel = /^(desa|kelurahan)\b/i.test(targetDesa) ? targetDesa : `Desa ${targetDesa}`;
            segments.push(desaLabel);
            hasDesa = true;
        }
    }

    // 6. Penyesuaian Komponen: Kecamatan
    let hasKec = segments.some(seg => /\bkecamatan\s+[a-z0-9]/i.test(seg));
    if (!hasKec && targetKecKeyword) {
        const exactKecIdx = segments.findIndex(seg => cleanGeoKeyword(seg) === targetKecKeyword && !/^(br\.?|banjar|dusun|desa|kelurahan)\b/i.test(seg));
        if (exactKecIdx !== -1) {
            segments[exactKecIdx] = `Kecamatan ${toTitleCase(targetKecKeyword)}`;
            hasKec = true;
        } else if (targetKec) {
            const kecLabel = /^kecamatan\b/i.test(targetKec) ? targetKec : `Kecamatan ${targetKec}`;
            segments.push(kecLabel);
            hasKec = true;
        }
    }

    // 7. Penyesuaian Komponen: Kabupaten / Kota
    let hasKab = segments.some(seg => /\b(kabupaten|kota)\s+[a-z0-9]/i.test(seg));
    if (!hasKab && targetKabKeyword) {
        const exactKabIdx = segments.findIndex(seg => cleanGeoKeyword(seg) === targetKabKeyword && !/^(br\.?|banjar|dusun|desa|kelurahan|kecamatan)\b/i.test(seg));
        if (exactKabIdx !== -1) {
            const prefix = /^kota\b/i.test(targetKab) ? 'Kota' : 'Kabupaten';
            segments[exactKabIdx] = `${prefix} ${toTitleCase(targetKabKeyword)}`;
            hasKab = true;
        } else if (targetKab) {
            const kabLabel = /^(kabupaten|kota)\b/i.test(targetKab) ? targetKab : `Kabupaten ${targetKab}`;
            segments.push(kabLabel);
            hasKab = true;
        }
    }

    // 8. Penyesuaian Komponen: Provinsi
    let hasProv = segments.some(seg => /\b(provinsi|propinsi)\s+[a-z0-9]/i.test(seg));
    if (!hasProv && targetProvKeyword) {
        const exactProvIdx = segments.findIndex(seg => cleanGeoKeyword(seg) === targetProvKeyword && !/^(br\.?|banjar|dusun|desa|kelurahan|kecamatan|kabupaten|kota)\b/i.test(seg));
        if (exactProvIdx !== -1) {
            segments[exactProvIdx] = `Provinsi ${toTitleCase(targetProvKeyword)}`;
            hasProv = true;
        } else if (targetProv) {
            const provLabel = /^(provinsi|propinsi)\b/i.test(targetProv) ? targetProv : `Provinsi ${targetProv}`;
            segments.push(provLabel);
            hasProv = true;
        }
    }

    // 9. Format kapital hanya di awal kata saja (Title Case)
    const finalAddress = segments.join(', ');
    return toTitleCase(finalAddress);
}
if (typeof window !== 'undefined') {
    window.formatStudentAddress = formatStudentAddress;
}

/**
 * Format tanggal Indonesia (contoh: 26 Agustus 2026)
 */
function formatIndoDate(dateStrOrObj) {
    if (!dateStrOrObj) return '-';
    try {
        const d = (typeof window.parseUniversalDate === 'function')
            ? window.parseUniversalDate(dateStrOrObj)
            : new Date(dateStrOrObj);
        if (!d || isNaN(d.getTime())) return String(dateStrOrObj);
        const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
        return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
    } catch (e) {
        return String(dateStrOrObj);
    }
}

/**
 * Helper untuk mendapatkan URL pasfoto resmi siswa untuk Surat Keterangan.
 * Mengabaikan avatar default dan me-resolve URL Cloudflare/R2.
 */
function getStudentSuratPhoto(student) {
    if (!student) return null;
    const rawPhoto = student.photoUrl || student.activePhotoUrl || student.active_photo_url || student.photo_url || student.foto || student.foto_url;
    if (!rawPhoto || typeof rawPhoto !== 'string') return null;
    const trimmed = rawPhoto.trim();
    if (!trimmed || trimmed.includes('default-avatar') || trimmed.includes('blank-avatar')) return null;
    return (typeof window.resolvePhotoUrl === 'function') ? window.resolvePhotoUrl(trimmed) : trimmed;
}
if (typeof window !== 'undefined') {
    window.getStudentSuratPhoto = getStudentSuratPhoto;
}

/**
 * Update UI status pasfoto 3x4 pada modal Surat Keterangan
 */
function updateSuratKetPhotoPreview(photoUrl) {
    const statusEl = document.getElementById('surat-ket-preview-photo-status');
    if (!statusEl) return;
    if (photoUrl) {
        statusEl.innerHTML = `
            <img src="${window.escapeHTML(photoUrl)}" alt="Foto Siswa" class="w-7 h-9 object-cover rounded shadow-sm border border-slate-200 dark:border-slate-700 shrink-0" onerror="this.parentElement.innerHTML='<span class=\\'text-slate-400 italic text-[11px]\\'><i class=\\'fa-solid fa-circle-minus mr-1\\'></i>Belum Ada Foto (Dikosongkan)</span>';">
            <div class="min-w-0">
                <span class="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                    <i class="fa-solid fa-circle-check"></i> Pasfoto 3x4 Terpasang
                </span>
                <p class="text-[10px] text-slate-400">Dicetak otomatis di sebelah tanda tangan.</p>
            </div>
        `;
    } else {
        statusEl.innerHTML = `
            <span class="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400 italic">
                <i class="fa-solid fa-circle-minus text-slate-400"></i> Belum Ada Foto (Dikosongkan)
            </span>
        `;
    }
}

/**
 * Buka Modal Pengaturan & Preview Surat Keterangan Siswa
 */
window.openSuratKeteranganModal = function () {
    const student = window.currentStudentDetailData || (window.currentStudentRaw && window.currentStudentRaw.student) || (studentsCache.find(s => s.nis === currentDetailStudentNIS));
    if (!student) {
        showToast("Peringatan", "Data siswa belum dipilih. Silakan buka detail siswa terlebih dahulu.", "warning");
        return;
    }

    // 1. Nomor Surat (Default dari SCHOOL_CONFIG atau format resmi)
    const defNo = SCHOOL_CONFIG?.defaultSuratKeteranganNo || "B.10.400.7.22.1/4387/SMA NEGERI NUSANTARA/DIKPORA";
    const noInput = document.getElementById('surat-ket-no');
    if (noInput) {
        noInput.value = defNo;
    }

    // 2. Tanggal Surat (Default tanggal hari ini format ISO YYYY-MM-DD)
    const today = new Date();
    const tzOffset = today.getTimezoneOffset() * 60000;
    const localISODate = (new Date(today.getTime() - tzOffset)).toISOString().split('T')[0];
    const dateInput = document.getElementById('surat-ket-date');
    if (dateInput) {
        dateInput.value = localISODate;
    }

    // 3. Tahun Pelajaran Aktif (misal 2026/2027)
    const curYear = today.getFullYear();
    const curMonth = today.getMonth() + 1; // 1-12
    const startYear = curMonth >= 7 ? curYear : curYear - 1;
    const academicYearStr = `${startYear}/${startYear + 1}`;
    const ayInput = document.getElementById('surat-ket-academic-year');
    if (ayInput) {
        ayInput.value = academicYearStr;
    }

    // 4. Data Siswa
    const nameEl = document.getElementById('surat-ket-preview-name');
    const nisnNisEl = document.getElementById('surat-ket-preview-nisn-nis');
    const ttlEl = document.getElementById('surat-ket-preview-ttl');
    const classBadge = document.getElementById('surat-ket-preview-class-badge');
    const addressInput = document.getElementById('surat-ket-address');

    if (nameEl) nameEl.textContent = student.name || '-';
    if (nisnNisEl) nisnNisEl.textContent = `${student.nisn || '-'} / ${student.nis || '-'}`;

    const rawBirthPlace = student.birthPlace || 'Karangasem';
    const birthPlace = toTitleCase(rawBirthPlace);
    const birthDateFormatted = student.birthDate ? formatIndoDate(student.birthDate) : '-';
    const ttlFormatted = (student.birthPlace || student.birthDate) ? `${birthPlace}, ${birthDateFormatted}` : '-';
    if (ttlEl) ttlEl.textContent = ttlFormatted;

    if (classBadge) classBadge.textContent = `Kelas ${student.class || '-'}`;

    const formattedAddress = formatStudentAddress(student);
    if (addressInput) {
        addressInput.value = formattedAddress;
    }

    // Deteksi foto siswa awal
    const studentPhoto = getStudentSuratPhoto(student);
    updateSuratKetPhotoPreview(studentPhoto);

    // Simpan referensi sementara
    window._activeSuratKeteranganStudent = {
        ...student,
        birthPlace,
        birthDateFormatted,
        ttlFormatted,
        photoUrl: studentPhoto,
        formattedAddress
    };

    // 5. Cek async ke Cloudflare D1 jika di objek siswa belum ada URL foto (0 Firestore Read)
    if (!studentPhoto && student.nis && typeof cfClient !== 'undefined' && cfClient && cfClient.enabled && typeof cfClient.getStudentPhotoInfo === 'function') {
        cfClient.getStudentPhotoInfo(student.nis).then(res => {
            if (res && res.success && res.data && res.data.active_photo_url) {
                const liveUrl = (typeof window.resolvePhotoUrl === 'function') 
                    ? window.resolvePhotoUrl(res.data.active_photo_url) 
                    : res.data.active_photo_url;
                student.activePhotoUrl = res.data.active_photo_url;
                student.photoUrl = liveUrl;
                if (window._activeSuratKeteranganStudent && String(window._activeSuratKeteranganStudent.nis) === String(student.nis)) {
                    window._activeSuratKeteranganStudent.photoUrl = liveUrl;
                    updateSuratKetPhotoPreview(liveUrl);
                }
            }
        }).catch(() => {});
    }

    // Buka Modal
    window.openModal('modal-surat-keterangan');
};

/**
 * Cetak Surat Keterangan Siswa (A4 Standar Kedinasan)
 */
window.printSuratKeterangan = function () {
    const student = window._activeSuratKeteranganStudent || window.currentStudentDetailData || (studentsCache.find(s => s.nis === currentDetailStudentNIS));
    if (!student) {
        showToast("Error", "Data siswa tidak ditemukan untuk dicetak.", "error");
        return;
    }

    const noSurat = document.getElementById('surat-ket-no')?.value?.trim() || SCHOOL_CONFIG?.defaultSuratKeteranganNo || "B.10.400.7.22.1/4387/SMA NEGERI NUSANTARA/DIKPORA";
    const dateVal = document.getElementById('surat-ket-date')?.value;
    const academicYear = document.getElementById('surat-ket-academic-year')?.value?.trim() || "2026/2027";
    const rawAddressInput = document.getElementById('surat-ket-address')?.value?.trim();
    const addressVal = rawAddressInput ? formatStudentAddress(student, rawAddressInput) : formatStudentAddress(student);
    const tglSuratIndo = dateVal ? formatIndoDate(dateVal) : formatIndoDate(new Date());
    const kopUrl = new URL(SCHOOL_CONFIG?.kopPath || 'assets/kop.png', window.location.href).href;

    // Data Kepala Sekolah & Lembaga
    const { headmasterName: kepsekName, headmasterRank: kepsekRank, headmasterNIP: kepsekNIP, headmasterTitle: kepsekTitle, schoolCity } = SCHOOL_CONFIG;

    const studentName = student.name || '-';
    const studentNISN = student.nisn || '-';
    const studentNIS = student.nis || '-';
    const studentBirthPlace = toTitleCase(student.birthPlace || 'Karangasem');
    const studentTTL = (student.birthPlace || student.birthDate) ? `${studentBirthPlace}, ${student.birthDate ? formatIndoDate(student.birthDate) : '-'}` : (student.ttlFormatted || '-');
    const studentClass = student.class || '-';
    const studentPhotoUrl = getStudentSuratPhoto(student);

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        showToast("Pop-up Terblokir", "Harap izinkan pop-up peramban untuk membuka pratinjau cetak surat.", "warning");
        return;
    }

    printWindow.document.write(`
        <!DOCTYPE html>
        <html lang="id">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Surat Keterangan - ${window.escapeHTML(studentName)}</title>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Tinos:ital,wght@0,400;0,700;1,400&family=Times+New+Roman&display=swap');
                
                @page {
                    size: A4 portrait;
                    margin: 15mm 20mm 15mm 20mm;
                }

                * {
                    box-sizing: border-box;
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                }

                body {
                    margin: 0;
                    padding: 0;
                    background-color: #ffffff;
                    color: #000000;
                    font-family: 'Times New Roman', 'Tinos', serif;
                    font-size: 12pt;
                    line-height: 1.5;
                }

                .surat-container {
                    width: 100%;
                    max-width: 210mm;
                    margin: 0 auto;
                    padding: 0;
                }

                .kop-image {
                    width: 100%;
                    max-height: 38mm;
                    object-fit: contain;
                    display: block;
                    margin: 0 auto 10px auto;
                }

                .title-container {
                    text-align: center;
                    margin-top: 15px;
                    margin-bottom: 25px;
                }

                .title-main {
                    font-size: 13pt;
                    font-weight: bold;
                    text-decoration: underline;
                    text-transform: uppercase;
                    margin: 0;
                    letter-spacing: 0.5px;
                }

                .title-nomor {
                    font-size: 11pt;
                    margin-top: 4px;
                    margin-bottom: 0;
                }

                .content-paragraph {
                    text-align: justify;
                    margin-bottom: 16px;
                    line-height: 1.6;
                }

                .biodata-table {
                    width: 100%;
                    margin: 14px 0 18px 0;
                    border-collapse: collapse;
                }

                .biodata-table td {
                    padding: 5.5px 0;
                    vertical-align: top;
                    font-size: 12pt;
                    line-height: 1.5;
                }

                .col-label {
                    width: 28%;
                    white-space: nowrap;
                }

                .col-colon {
                    width: 3%;
                    text-align: center;
                }

                .col-value {
                    width: 69%;
                }

                .spaced-label {
                    letter-spacing: 3.5px;
                }

                .spaced-nisn {
                    letter-spacing: 2px;
                }

                .spaced-nis {
                    letter-spacing: 2px;
                }

                .signature-section {
                    margin-top: 30px;
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-end;
                    padding-left: 20px;
                    padding-right: 30px;
                    page-break-inside: avoid;
                }

                .photo-container {
                    width: 30mm;
                    height: 40mm;
                    min-width: 30mm;
                    min-height: 40mm;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border: none;
                    outline: none;
                    background: transparent;
                }

                .photo-3x4 {
                    width: 30mm;
                    height: 40mm;
                    object-fit: cover;
                    display: block;
                }

                .signature-box {
                    width: 260px;
                    text-align: left;
                    font-size: 12pt;
                    line-height: 1.35;
                }

                .signature-space {
                    height: 75px;
                }

                .signature-name {
                    font-weight: bold;
                    text-decoration: underline;
                }

                @media print {
                    body {
                        padding: 0;
                    }
                    .no-print {
                        display: none !important;
                    }
                }
            </style>
        </head>
        <body>
            <div class="surat-container">
                <!-- KOP SURAT RESMI -->
                <div>
                    <img src="${kopUrl}" class="kop-image" alt="Kop Surat Resmi" onerror="this.style.display='none';">
                </div>

                <!-- JUDUL SURAT & NOMOR -->
                <div class="title-container">
                    <h1 class="title-main">SURAT KETERANGAN</h1>
                    <p class="title-nomor">Nomor : ${window.escapeHTML(noSurat)}</p>
                </div>

                <!-- PARAGRAF PEMBUKA -->
                <p class="content-paragraph">
                    Yang bertanda tangan di bawah ini ${window.escapeHTML(SCHOOL_CONFIG.headmasterTitle)} menerangkan bahwa :
                </p>

                <!-- TABEL BIODATA SISWA -->
                <table class="biodata-table">
                    <tr>
                        <td class="col-label"><span class="spaced-label">Nama</span></td>
                        <td class="col-colon">:</td>
                        <td class="col-value"><strong>${window.escapeHTML(studentName)}</strong></td>
                    </tr>
                    <tr>
                        <td class="col-label"><span class="spaced-nisn">NISN</span></td>
                        <td class="col-colon">:</td>
                        <td class="col-value">${window.escapeHTML(studentNISN)}</td>
                    </tr>
                    <tr>
                        <td class="col-label"><span class="spaced-nis">NIS</span></td>
                        <td class="col-colon">:</td>
                        <td class="col-value">${window.escapeHTML(studentNIS)}</td>
                    </tr>
                    <tr>
                        <td class="col-label">Tempat/Tanggal Lahir</td>
                        <td class="col-colon">:</td>
                        <td class="col-value">${window.escapeHTML(studentTTL)}</td>
                    </tr>
                    <tr>
                        <td class="col-label">Alamat</td>
                        <td class="col-colon">:</td>
                        <td class="col-value">${window.escapeHTML(addressVal)}</td>
                    </tr>
                </table>

                <!-- PARAGRAF PERNYATAAN AKTIF -->
                <p class="content-paragraph">
                    Memang benar siswa tersebut di atas adalah siswa ${window.escapeHTML(SCHOOL_CONFIG.schoolName)}, kelas ${window.escapeHTML(studentClass)} tahun pelajaran ${window.escapeHTML(academicYear)}.
                </p>

                <!-- PARAGRAF PENUTUP -->
                <p class="content-paragraph">
                    Demikian Surat Keterangan ini di buat untuk dapat dipergunakan sebagaimana mestinya.
                </p>

                <!-- TANDA TANGAN KEPALA SEKOLAH & PASFOTO 3X4 (DIKOSONGKAN JIKA TIDAK ADA FOTO) -->
                <div class="signature-section">
                    <div class="photo-container">
                        ${studentPhotoUrl ? `
                            <img src="${window.escapeHTML(studentPhotoUrl)}" 
                                 class="photo-3x4" 
                                 alt="Pasfoto Siswa 3x4" 
                                 crossorigin="anonymous" 
                                 onerror="this.style.display='none';">
                        ` : ''}
                    </div>
                    <div class="signature-box">
                        <div>${window.escapeHTML(schoolCity)}, ${window.escapeHTML(tglSuratIndo)}</div>
                        <div style="margin-top: 4px;">${window.escapeHTML(kepsekTitle)},</div>
                        <div class="signature-space"></div>
                        <div class="signature-name">${window.escapeHTML(kepsekName)}</div>
                        <div>${window.escapeHTML(kepsekRank)}</div>
                        <div>NIP. ${window.escapeHTML(kepsekNIP)}</div>
                    </div>
                </div>
            </div>

            <script>
                window.addEventListener('load', function () {
                    setTimeout(function () {
                        window.print();
                    }, 400);
                });
            <\/script>
        </body>
        </html>
    `);
    printWindow.document.close();
};

/**
 * Unduh Surat Keterangan Siswa dalam format Microsoft Word (.DOCX)
 */
window.downloadSuratKeteranganDocx = async function () {
    const student = window._activeSuratKeteranganStudent || window.currentStudentDetailData || (studentsCache.find(s => s.nis === currentDetailStudentNIS));
    if (!student) {
        showToast("Error", "Data siswa tidak ditemukan untuk diunduh.", "error");
        return;
    }

    const btn = document.getElementById('btn-download-docx-surat-keterangan');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Memproses DOCX...';
    }

    try {
        // 1. Pastikan library docx terload
        if (!window.docx) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js';
                script.onload = () => resolve();
                script.onerror = () => reject(new Error('Gagal memuat pustaka pembentuk dokumen DOCX.'));
                document.head.appendChild(script);
            });
        }

        const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, UnderlineType, ImageRun, BorderStyle } = window.docx;

        const noSurat = document.getElementById('surat-ket-no')?.value?.trim() || SCHOOL_CONFIG?.defaultSuratKeteranganNo || "B.10.400.7.22.1/4387/SMA NEGERI NUSANTARA/DIKPORA";
        const dateVal = document.getElementById('surat-ket-date')?.value;
        const academicYear = document.getElementById('surat-ket-academic-year')?.value?.trim() || "2026/2027";
        const rawAddressInput = document.getElementById('surat-ket-address')?.value?.trim();
        const addressVal = rawAddressInput ? formatStudentAddress(student, rawAddressInput) : formatStudentAddress(student);

        // Format Tanggal Surat Indonesia
        const tglSuratIndo = dateVal ? formatIndoDate(dateVal) : formatIndoDate(new Date());

        // Data Kepala Sekolah & Lembaga
        const kepsekName = SCHOOL_CONFIG.headmasterName;
        const kepsekRank = SCHOOL_CONFIG.headmasterRank;
        const kepsekNIP = SCHOOL_CONFIG.headmasterNIP;
        const kepsekTitle = SCHOOL_CONFIG.headmasterTitle;
        const schoolCity = SCHOOL_CONFIG.schoolCity;

        const studentName = student.name || '-';
        const studentNISN = student.nisn || '-';
        const studentNIS = student.nis || '-';
        const studentBirthPlace = toTitleCase(student.birthPlace || 'Karangasem');
        const studentTTL = (student.birthPlace || student.birthDate) ? `${studentBirthPlace}, ${student.birthDate ? formatIndoDate(student.birthDate) : '-'}` : (student.ttlFormatted || '-');
        const studentClass = student.class || '-';
        const studentPhotoUrl = getStudentSuratPhoto(student);

        // 2. Fetch Kop & TTE Image Buffer
        let kopBuffer = null;
        try {
            const kopUrl = new URL(SCHOOL_CONFIG?.kopPath || 'assets/kop.png', window.location.href).href;
            const res = await fetch(kopUrl);
            if (res.ok) {
                kopBuffer = await res.arrayBuffer();
            }
        } catch (e) {
            console.warn('[DOCX] Gagal memuat kop surat image buffer:', e);
        }

        let tteBuffer = null;
        try {
            const tteUrl = new URL(SCHOOL_CONFIG?.ttePath || 'assets/tte.png', window.location.href).href;
            const res = await fetch(tteUrl);
            if (res.ok) {
                tteBuffer = await res.arrayBuffer();
            }
        } catch (e) {
            console.warn('[DOCX] Gagal memuat TTE image buffer:', e);
        }

        let studentPhotoBuffer = null;
        if (studentPhotoUrl) {
            try {
                const res = await fetch(studentPhotoUrl);
                if (res.ok) {
                    studentPhotoBuffer = await res.arrayBuffer();
                }
            } catch (e) {
                console.warn('[DOCX] Gagal memuat pasfoto siswa image buffer:', e);
            }
        }

        const children = [];

        // KOP SURAT IMAGE
        if (kopBuffer) {
            children.push(
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                        new ImageRun({
                            data: kopBuffer,
                            transformation: {
                                width: 595,
                                height: 175
                            }
                        })
                    ],
                    spacing: { after: 150 }
                })
            );
        }

        // JUDUL SURAT & NOMOR
        children.push(
            new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                    new TextRun({
                        text: 'SURAT KETERANGAN',
                        bold: true,
                        underline: { type: UnderlineType.SINGLE },
                        size: 24, // 12pt
                        font: 'Times New Roman'
                    })
                ],
                spacing: { line: 360 }
            }),
            new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                    new TextRun({
                        text: 'Nomor : ${NOMOR}',
                        size: 24, // 12pt
                        font: 'Times New Roman'
                    })
                ],
                spacing: { line: 360, after: 280 }
            }),
            // PARAGRAF PEMBUKA
            new Paragraph({
                alignment: AlignmentType.BOTH,
                children: [
                    new TextRun({
                        text: `Yang bertanda tangan di bawah ini ${SCHOOL_CONFIG.headmasterTitle} menerangkan bahwa :`,
                        size: 24, // 12pt
                        font: 'Times New Roman'
                    })
                ],
                spacing: { line: 360, after: 200 }
            })
        );

        // TABEL BIODATA SISWA (Borderless)
        const invisibleBorders = {
            top: { style: BorderStyle.NONE },
            bottom: { style: BorderStyle.NONE },
            left: { style: BorderStyle.NONE },
            right: { style: BorderStyle.NONE },
            insideHorizontal: { style: BorderStyle.NONE },
            insideVertical: { style: BorderStyle.NONE }
        };

        const createBiodataRow = (label, value) => {
            return new TableRow({
                children: [
                    new TableCell({
                        width: { size: 30, type: WidthType.PERCENTAGE },
                        borders: invisibleBorders,
                        children: [
                            new Paragraph({
                                spacing: { line: 360, after: 60 },
                                children: [
                                    new TextRun({
                                        text: label,
                                        size: 24,
                                        font: 'Times New Roman'
                                    })
                                ]
                            })
                        ]
                    }),
                    new TableCell({
                        width: { size: 4, type: WidthType.PERCENTAGE },
                        borders: invisibleBorders,
                        children: [
                            new Paragraph({
                                spacing: { line: 360, after: 60 },
                                children: [
                                    new TextRun({
                                        text: ':',
                                        size: 24,
                                        font: 'Times New Roman'
                                    })
                                ]
                            })
                        ]
                    }),
                    new TableCell({
                        width: { size: 66, type: WidthType.PERCENTAGE },
                        borders: invisibleBorders,
                        children: [
                            new Paragraph({
                                spacing: { line: 360, after: 60 },
                                children: [
                                    new TextRun({
                                        text: value || '-',
                                        size: 24,
                                        font: 'Times New Roman'
                                    })
                                ]
                            })
                        ]
                    })
                ]
            });
        };

        children.push(
            new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                borders: invisibleBorders,
                rows: [
                    createBiodataRow('N a m a', studentName),
                    createBiodataRow('NISN', studentNISN),
                    createBiodataRow('NIS', studentNIS),
                    createBiodataRow('Tempat/Tanggal Lahir', studentTTL),
                    createBiodataRow('Alamat', addressVal)
                ]
            }),
            // PARAGRAF PERNYATAAN AKTIF
            new Paragraph({
                alignment: AlignmentType.BOTH,
                children: [
                    new TextRun({
                        text: `Memang benar siswa tersebut di atas adalah siswa ${SCHOOL_CONFIG.schoolName}, kelas ${studentClass} tahun pelajaran ${academicYear}.`,
                        size: 24, // 12pt
                        font: 'Times New Roman'
                    })
                ],
                spacing: { line: 360, before: 200, after: 200 }
            }),
            // PARAGRAF PENUTUP
            new Paragraph({
                alignment: AlignmentType.BOTH,
                children: [
                    new TextRun({
                        text: 'Demikian Surat Keterangan ini di buat untuk dapat dipergunakan sebagaimana mestinya.',
                        size: 24, // 12pt
                        font: 'Times New Roman'
                    })
                ],
                spacing: { line: 360, after: 400 }
            }),
            // TANGGAL & TTE KANAN BAWAH (Format Persis Sesuai Portal TTE Dinas - Kolom Kiri Pasfoto 3x4, Kolom Kanan TTE)
            new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                borders: invisibleBorders,
                rows: [
                    new TableRow({
                        children: [
                            new TableCell({
                                width: { size: 52, type: WidthType.PERCENTAGE },
                                borders: invisibleBorders,
                                children: studentPhotoBuffer ? [
                                    new Paragraph({
                                        spacing: { line: 240 },
                                        children: [
                                            new ImageRun({
                                                data: studentPhotoBuffer,
                                                transformation: {
                                                    width: 113.4, // 3 cm dalam piksel 96 DPI (30mm)
                                                    height: 151.2 // 4 cm dalam piksel 96 DPI (40mm)
                                                }
                                            })
                                        ]
                                    })
                                ] : [new Paragraph({})]
                            }),
                            new TableCell({
                                width: { size: 48, type: WidthType.PERCENTAGE },
                                borders: invisibleBorders,
                                children: [
                                    new Paragraph({
                                        spacing: { line: 360, after: 120 },
                                        children: [
                                            new TextRun({
                                                text: "Denpasar, ${TANGGAL}",
                                                size: 24, // 12pt
                                                font: 'Times New Roman'
                                            })
                                        ]
                                    }),
                                    ...(tteBuffer ? [
                                        new Paragraph({
                                            spacing: { line: 240 },
                                            children: [
                                                new ImageRun({
                                                    data: tteBuffer,
                                                    transformation: {
                                                        width: 245,
                                                        height: 79
                                                    }
                                                })
                                            ]
                                        })
                                    ] : [])
                                ]
                            })
                        ]
                    })
                ]
            })
        );

        const doc = new Document({
            sections: [{
                properties: {
                    page: {
                        size: {
                            width: 11906, // A4 Width in twips
                            height: 16838 // A4 Height in twips
                        },
                        margin: {
                            top: 850,    // 15mm
                            right: 1134,  // 20mm
                            bottom: 850, // 15mm
                            left: 1134   // 20mm
                        }
                    }
                },
                children: children
            }]
        });

        const blob = await Packer.toBlob(doc);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const cleanName = (student.name || 'Siswa').replace(/[^a-zA-Z0-9]/g, '_');
        a.download = `Surat_Keterangan_${cleanName}_NIS_${student.nis || 'Siswa'}.docx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast("Berhasil", "Berkas Word (.DOCX) Surat Keterangan berhasil dibuat dan diunduh.", "success");

    } catch (err) {
        console.error('[DOCX Download Error]:', err);
        showToast("Gagal DOCX", "Terjadi kesalahan saat membuat berkas DOCX: " + err.message, "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
};

// --- HELPER: MODERN ALERT ---
function showModernAlert(title, message, type = 'success') {
    const modal = document.getElementById('modal-alert');
    if (!modal) { showToast(title, message.replace(/<[^>]*>?/gm, ''), type === 'success' ? 'success' : 'error'); return; }

    const iconBg = document.getElementById('alert-icon-bg');
    const icon = document.getElementById('alert-icon');
    const titleEl = document.getElementById('alert-title');
    const msgEl = document.getElementById('alert-msg');

    if (type === 'success') {
        iconBg.className = "w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-green-100 text-green-600 animate-bounce-slow";
        icon.className = "fa-solid fa-check text-3xl";
    } else {
        iconBg.className = "w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-red-100 text-red-600 animate-pulse";
        icon.className = "fa-solid fa-xmark text-3xl";
    }

    titleEl.innerText = title;
    msgEl.innerHTML = message;
    modal.classList.remove('hidden');
}



// --- FUNGSI BARU: SEARCH GLOBAL (SMART MULTI-CASE CLIENT-SIDE) ---
async function searchStudentsGlobal(keyword) {
    const tbody = document.getElementById('student-table-body');
    tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-10 text-center text-slate-400"><i class="fa-solid fa-circle-notch fa-spin mr-2"></i> Mencari "${window.escapeHTML(keyword)}"...</td></tr>`;

    try {
        const allStudents = await window.getStudentsCache();
        const kw = keyword.toLowerCase().trim();

        let showAlumni = getLocalCache(SHOW_ALUMNI_CACHE_KEY);
        if (showAlumni === null) {
            try {
                const configData = await window.getSystemConfig();
                showAlumni = configData.showAlumni || false;
                setLocalCache(SHOW_ALUMNI_CACHE_KEY, showAlumni);
            } catch (e) { showAlumni = false; }
        }

        const results = allStudents.filter(s => {
            if (!showAlumni && s.class && s.class.toLowerCase().includes('alumni')) return false;
            const name = (s.name || s.nama || '').toLowerCase();
            const nis = String(s.nis || '');
            const nisn = String(s.nisn || '');
            const sClass = (s.class || '').toLowerCase();
            return name.includes(kw) || nis.includes(kw) || nisn.includes(kw) || sClass.includes(kw);
        }).slice(0, 50); // Top 50 matches

        if (results.length === 0) {
            tbody.innerHTML = `
                <tr><td colspan="6" class="px-6 py-12 text-center text-slate-500">
                    <div class="mb-2"><i class="fa-solid fa-circle-info text-2xl text-blue-400"></i></div>
                    <p class="font-bold text-slate-700">Tidak ditemukan data siswa dengan kata kunci "${window.escapeHTML(keyword)}".</p>
                </td></tr>`;
        } else {
            await fetchStudentAggregates(results);
            studentsCache = results;
            renderTable(results);
        }

    } catch (e) {
        console.error("Search Error:", e);
        tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-10 text-center text-red-400">Terjadi kesalahan pencarian. Cek koneksi.</td></tr>`;
    }
}

// --- HELPER: FETCH AGGREGATES (POIN) VIA CACHE (HEMAT READ) ---
async function fetchStudentAggregates(studentList) {
    if (!studentList || studentList.length === 0) return;

    try {
        const aggregateList = await window.getStudentAggregatesCache();
        const aggMap = new Map(aggregateList.map(aggregate => [String(aggregate.nis), aggregate.points || 0]));
        studentList.forEach(student => {
            student.violationPoints = student.nis ? (aggMap.get(String(student.nis)) || 0) : 0;
        });
    } catch (e) {
        console.error("Gagal load aggregate points dari cache:", e);
        studentList.forEach(s => s.violationPoints = 0);
    }
}

// --- 1. LOAD DATA KELAS (KHUSUS DATA SISWA: Tampilkan SEMUA kelas, bukan hanya aktif) ---
async function loadClassOptions(canSeeAllStudents) {
    const select = document.getElementById('filter-class');
    if (!select) return;

    if (typeof canSeeAllStudents === 'undefined') {
        const role = localStorage.getItem('user_role');
        const allowedAllStudentsRoles = ['super_admin', 'wakasek_kurikulum', 'staff', 'guru_mapel', 'guru_bk', 'bk'];
        canSeeAllStudents = window.hasRole ?
            allowedAllStudentsRoles.some(r => window.hasRole(r)) :
            allowedAllStudentsRoles.includes(role);
    }

    try {
        const activeClasses = await window.getActiveClasses({ bypassActiveFilter: true });
        select.innerHTML = '<option value="">-- Pilih Kelas --</option>';

        if (activeClasses && activeClasses.length > 0) {
            activeClasses.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c; opt.innerText = c;
                select.appendChild(opt);
            });
        }

        // Opsi Tampilkan Semua Siswa tepat di atas daftar siswa berstatus arsip
        if (canSeeAllStudents) {
            const optAll = document.createElement('option');
            optAll.value = 'ALL';
            optAll.innerText = '-- Tampilkan Semua Siswa --';
            select.appendChild(optAll);
        }

        const optDivider = document.createElement('option');
        optDivider.disabled = true;
        optDivider.innerText = "──────────────────";
        select.appendChild(optDivider);

        ['KELUAR', 'MUTASI', 'PINDAH', 'ALUMNI'].forEach(c => {
            const opt = document.createElement('option');
            opt.value = c; opt.innerText = `[ARSIP] Siswa ${c}`;
            select.appendChild(opt);
        });

        // Auto-select kelas perwalian jika ada
        const assignedClass = localStorage.getItem('user_assigned_class');
        if (assignedClass && activeClasses && activeClasses.includes(assignedClass)) {
            select.value = assignedClass;
            loadStudentsByClass(assignedClass);
        }
    } catch (e) { console.error("Gagal load kelas:", e); }
}
window.loadClassOptions = loadClassOptions;

// --- 2a. LOAD SISWA PER KELAS ---
async function loadStudentsByClass(className) {
    const tbody = document.getElementById('student-table-body');
    const searchInput = document.getElementById('search-input');

    tbody.innerHTML = `<tr><td colspan="7" class="px-6 py-8 text-center text-blue-500"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Memuat data kelas ${className}...</td></tr>`;

    try {
        let allStudents = [];
        if (typeof window.getStudentsCache === 'function') {
            allStudents = await window.getStudentsCache();
        }

        let filtered = (allStudents || [])
            .filter(s => (s.class || s.studentClass || '') === className)
            .map(s => ({ ...s }));

        // Jika cache global belum terisi atau kosong untuk kelas ini, query langsung ke Cloudflare D1
        if (filtered.length === 0 && cfClient && cfClient.enabled) {
            try {
                const cfStudents = await cfClient.getStudents({ class: className, limit: 300 });
                if (Array.isArray(cfStudents) && cfStudents.length > 0) {
                    filtered = cfStudents.map(s => ({ ...s }));
                }
            } catch (e) {
                console.warn('[Students] Gagal memuat siswa per kelas langsung dari Cloudflare D1:', e);
            }
        }

        filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        studentsCache = filtered;
        renderTable(studentsCache);
        searchInput.disabled = false;
        searchInput.placeholder = "Ketik Nama atau NIS...";
        searchInput.focus();

        if (studentsCache.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="px-6 py-8 text-center text-slate-400">Belum ada data siswa di kelas ${className}.</td></tr>`;
        } else {
            tbody.innerHTML = `<tr><td colspan="7" class="px-6 py-8 text-center text-blue-500"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Sinkronisasi Poin...</td></tr>`;
            await fetchStudentAggregates(studentsCache);
            renderTable(studentsCache);
        }
    } catch (error) {
        console.error(error);
        tbody.innerHTML = `<tr><td colspan="7" class="px-6 py-8 text-center text-red-500">Error: ${error.message}</td></tr>`;
    }
}

// --- 2b. LOAD SEMUA SISWA (KHUSUS SUPERADMIN) ---
async function loadAllStudents() {
    const tbody = document.getElementById('student-table-body');
    const searchInput = document.getElementById('search-input');

    tbody.innerHTML = `<tr><td colspan="7" class="px-6 py-8 text-center text-blue-500"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Memuat seluruh data siswa...</td></tr>`;

    try {
        let cachedStudents = typeof window.getStudentsCache === 'function'
            ? await window.getStudentsCache()
            : [];

        if ((!cachedStudents || cachedStudents.length === 0) && cfClient && cfClient.enabled) {
            try {
                const cfList = await cfClient.getStudents({ limit: 2000 });
                if (Array.isArray(cfList) && cfList.length > 0) {
                    cachedStudents = cfList;
                }
            } catch (cfErr) {
                console.warn('[Students] Gagal load all students dari Cloudflare D1:', cfErr);
            }
        }

        studentsCache = cachedStudents.map(student => ({ ...student }));

        studentsCache.sort((a, b) => {
            const classA = (a.class || '').toString().toLowerCase();
            const classB = (b.class || '').toString().toLowerCase();
            if (classA !== classB) return classA.localeCompare(classB);
            return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase());
        });

        renderTable(studentsCache);
        searchInput.disabled = false;
        searchInput.placeholder = "Ketik Nama atau NIS...";
        searchInput.focus();

        if (studentsCache.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="px-6 py-8 text-center text-slate-400">Belum ada data siswa.</td></tr>`;
        } else {
            tbody.innerHTML = `<tr><td colspan="7" class="px-6 py-8 text-center text-blue-500"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Sinkronisasi Poin...</td></tr>`;
            await fetchStudentAggregates(studentsCache);
            renderTable(studentsCache);
        }
    } catch (error) {
        console.error("Gagal memuat seluruh siswa:", error);
        tbody.innerHTML = `<tr><td colspan="7" class="px-6 py-8 text-center text-red-500">Error: ${error.message}</td></tr>`;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const role = localStorage.getItem('user_role');

    // HIDE IMPORT & ADD FOR ADMIN PKS, ADMIN SPP & GURU BK & GURU MAPEL & KEPALA SEKOLAH
    // Multi-role: Sembunyikan HANYA jika user TIDAK punya role yang boleh import/add
    const rolesNoImportAdd = ['admin_pks', 'admin_spp', 'guru_bk', 'guru_mapel', 'kepala_sekolah'];
    const hasNoImportAddRole = window.hasRole ?
        rolesNoImportAdd.some(r => window.hasRole(r)) &&
        !['super_admin', 'kesiswaan', 'staff', 'wali_kelas'].some(r => window.hasRole(r)) :
        rolesNoImportAdd.includes(role);
    if (hasNoImportAddRole) {
        const btnImport = document.getElementById('btn-import-student');
        const btnAdd = document.getElementById('btn-add-student');
        if (btnImport) btnImport.classList.add('hidden');
        if (btnAdd) btnAdd.classList.add('hidden');
    }

    // HIDE PRINT RAPORT ONLY FOR ADMIN PKS & ADMIN SPP (Guru BK Boleh Cetak)
    // Multi-role: Sembunyikan HANYA jika user TIDAK punya role yang boleh print
    const rolesNoPrint = ['admin_pks', 'admin_spp'];
    const hasNoPrintRole = window.hasRole ?
        rolesNoPrint.some(r => window.hasRole(r)) &&
        !['super_admin', 'kesiswaan', 'staff', 'wali_kelas', 'guru_bk', 'guru_mapel', 'kepala_sekolah'].some(r => window.hasRole(r)) :
        rolesNoPrint.includes(role);
    if (hasNoPrintRole) {
        const btnPrint = document.getElementById('btn-print-raport');
        if (btnPrint) btnPrint.classList.add('hidden');
    }

    // STRICT FOR ADMIN PKS: HIDE ACTION COLUMN HEADER
    // Multi-role: Sembunyikan HANYA jika admin_pks DAN tidak punya role lain yang boleh aksi
    const isOnlyAdminPks = window.hasRole ?
        window.hasRole('admin_pks') &&
        !['super_admin', 'kesiswaan', 'staff', 'wali_kelas'].some(r => window.hasRole(r)) :
        role === 'admin_pks';
    if (isOnlyAdminPks) {
        const thAction = document.getElementById('th-action');
        if (thAction) thAction.classList.add('hidden');
    }
});

// ... (existing code helpers) ...

function renderTable(data) {
    const tbody = document.getElementById('student-table-body');
    document.getElementById('data-count').innerText = `${data.length} Siswa ditampilkan`;

    // Get Role for Conditional Rendering
    const currentRole = localStorage.getItem('user_role');
    const assignedClass = localStorage.getItem('user_assigned_class'); // For Wali Kelas

    // Khusus Admin SPP, Admin PKS, Guru BK, Guru Mapel, Kepala Sekolah tidak boleh hapus
    let canDelete = !['admin_spp', 'admin_pks', 'guru_bk', 'guru_mapel', 'kepala_sekolah'].includes(currentRole);

    // Yang tidak boleh cetak raport: Admin PKS, Admin SPP, Guru Mapel
    // Kepala Sekolah BOLEH cetak raport (View Only)
    // Multi-role: jika punya role yg boleh print (wali_kelas, guru_bk, dll), jangan hide
    let hidePrint = window.hasRole ?
        (['admin_pks', 'admin_spp', 'guru_mapel'].some(r => window.hasRole(r)) &&
            !['super_admin', 'kesiswaan', 'staff', 'wali_kelas', 'guru_bk', 'kepala_sekolah'].some(r => window.hasRole(r))) :
        ['admin_pks', 'admin_spp', 'guru_mapel'].includes(currentRole);

    // Hak Akses Cetak Kartu Pelajar (E-KTS): Hanya Super Admin, Staff Tata Usaha, dan Kesiswaan.
    // Wali Kelas mencetak kartu melalui Portal Wali Kelas (wali-kelas.html).
    const canPrintKts = window.hasRole ?
        (window.hasRole('super_admin') || window.hasRole('staff') || window.hasRole('kesiswaan')) :
        ['super_admin', 'staff', 'kesiswaan'].includes(currentRole);

    // ADMIN PKS: STRICTLY NO ACTION COLUMN
    const hideActionCol = currentRole === 'admin_pks';

    // Peran mutasi global (Super Admin, Kesiswaan, Staff, Admin)
    const isGlobalStaff = window.hasRole ?
        (window.hasRole('super_admin') || window.hasRole('kesiswaan') || window.hasRole('staff') || window.hasRole('admin')) :
        ['super_admin', 'kesiswaan', 'staff', 'admin'].includes(currentRole);

    // Wewenang Akses Dokumen Kartu Keluarga (KK): Super Admin, Admin Dapodik, dan Wali Kelas untuk rombelnya
    const isSuperOrAdmin = window.hasRole ?
        (window.hasRole('super_admin') || window.hasRole('admin')) :
        ['super_admin', 'admin'].includes(currentRole);
    const isAdminDapodik = window.hasRole ?
        window.hasRole('admin_dapodik') :
        currentRole === 'admin_dapodik';

    if (data.length === 0) {
        // Adjust colspan based on column visibility
        const cols = hideActionCol ? 7 : 8; // +1 for Guru Wali
        tbody.innerHTML = `<tr><td colspan="${cols}" class="px-6 py-8 text-center text-slate-400">Tidak ada data.</td></tr>`;
        return;
    }

    // SORT BY NAME (Alfabet) — Nomor urut otomatis berdasarkan nama
    data.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'id'));

    tbody.innerHTML = data.map((s, idx) => {
        // LOGIC KHUSUS WALI KELAS (Multi-role supported):
        // Hanya boleh Edit, Hapus & Cetak Rapor di kelas perwaliannya sendiri.
        const isWali = window.hasRole ? window.hasRole('wali_kelas') : currentRole === 'wali_kelas';
        const isMyClass = s.class === assignedClass;
        const canEditThisStudent = isGlobalStaff || (isWali && isMyClass);

        if (isWali) {
            canDelete = isMyClass;
            hidePrint = !isMyClass;
        }

        // Penanda & Akses Dokumen Foto Kartu Keluarga (KK)
        const canViewThisStudentKK = isSuperOrAdmin || isAdminDapodik || (isWali && isMyClass);
        let kkIndicatorHtml = '';
        if (canViewThisStudentKK) {
            if (s.kk_document_url) {
                const escapedStudentName = window.escapeHTML(s.name || '').replace(/'/g, "\\'");
                kkIndicatorHtml = `
                    <button type="button" onclick="event.stopPropagation(); window.openKKPreviewAdmin('${s.nis}', '${escapedStudentName}', '${encodeURIComponent(s.kk_document_url)}', '${s.kk_uploaded_at || ''}')"
                        class="inline-flex items-center gap-1 px-1.5 py-0.5 ml-1.5 rounded text-[10px] font-bold bg-emerald-100 hover:bg-emerald-200 text-emerald-800 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/80 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 transition-colors shadow-sm cursor-pointer"
                        title="Foto KK Terunggah - Klik untuk melihat arsip foto KK">
                        <i class="fa-solid fa-file-invoice text-emerald-600 dark:text-emerald-400"></i>
                        <span>KK</span>
                    </button>
                `;
            } else if (isAdminDapodik || (isWali && isMyClass)) {
                kkIndicatorHtml = `
                    <span class="inline-flex items-center gap-1 px-1.5 py-0.5 ml-1.5 rounded text-[9px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700" title="Foto KK belum diunggah siswa">
                        <i class="fa-regular fa-file text-[8px]"></i>
                        <span>Belum KK</span>
                    </span>
                `;
            }
        }

        return `
        <tr class="hover:bg-blue-50 dark:hover:bg-slate-700 transition-colors border-b border-slate-50 dark:border-slate-700 group">
            
            <td class="px-4 py-3 text-center font-mono text-slate-500 dark:text-slate-400 font-bold bg-slate-50/50 dark:bg-slate-800/50">
                ${idx + 1}
            </td>

            <td class="px-4 py-3 font-mono text-blue-600 dark:text-blue-400 font-bold text-xs">
                ${window.escapeHTML(s.nis || '-')}
            </td>
            
            <td class="px-4 py-3">
                <div class="flex items-center flex-wrap gap-1">
                    <div class="cursor-pointer" onclick="window.openStudentDetail('${s.id}')">
                        <span class="font-bold text-slate-700 dark:text-slate-200 group-hover:text-blue-700 dark:group-hover:text-blue-400 transition-colors">${window.escapeHTML(s.name)}</span>
                    </div>
                    ${kkIndicatorHtml}
                </div>
            </td>

            <td class="px-4 py-3 text-sm text-slate-600 dark:text-slate-400">
                ${s.birthDate ? new Date(s.birthDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: '2-digit' }) : '-'}
            </td>
            
            <td class="px-4 py-3 text-center">
                <span class="bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-2 py-1 rounded text-xs font-bold border border-slate-200 dark:border-slate-600">
                    ${window.escapeHTML(s.class || '-')}
                </span>
            </td>
            <td class="px-4 py-3 text-center">
                <span class="px-2 py-1 rounded text-xs font-bold ${s.violationPoints > 0 ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400' : 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'}">
                    ${s.violationPoints || 0}
                </span>
            </td>
            <td class="px-4 py-3 text-center">
                 <span id="gw-${s.nis}" class="text-xs text-slate-400 italic">...</span>
            </td>
            ${hideActionCol ? '' : `
            <td class="px-4 py-3 text-center md:sticky right-0 bg-white dark:bg-slate-800 group-hover:bg-blue-50 dark:group-hover:bg-slate-700/80 border-l border-slate-100 dark:border-slate-700">
                <div class="flex justify-center gap-1.5">
                    ${canEditThisStudent ? `
                    <button onclick="window.openEditStudent('${s.id}')" class="w-8 h-8 rounded-lg hover:bg-orange-100 dark:hover:bg-orange-500/20 text-orange-400 dark:text-orange-300 hover:text-orange-600 dark:hover:text-orange-400 transition-all hover:scale-110" title="Edit">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>` : ''}
                    ${canPrintKts ? `
                    <button onclick="window.openKtsPreviewModal('${s.nis || s.id}')" class="w-8 h-8 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-500/20 text-emerald-500 dark:text-emerald-400 hover:text-emerald-700 transition-all hover:scale-110" title="Pratinjau & Cetak Kartu Pelajar Digital (E-KTS) Presisi CR-80">
                        <i class="fa-solid fa-id-card"></i>
                    </button>` : ''}
                    ${canDelete ? `
                    <button onclick="window.openMutateStudent('${s.id}')" class="w-8 h-8 rounded-lg hover:bg-red-100 dark:hover:bg-red-500/20 text-slate-300 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 transition-all hover:scale-110" title="Mutasi / Keluar">
                        <i class="fa-solid fa-user-slash"></i>
                    </button>` : ''}
                    <!-- NEW: Report Card Button -->
                    <button onclick="window.openPrintModal()"
                        class="${hidePrint ? 'hidden' : ''} w-8 h-8 rounded-lg hover:bg-purple-100 dark:hover:bg-purple-500/20 text-purple-400 dark:text-purple-300 hover:text-purple-600 dark:hover:text-purple-400 transition-all hover:scale-110" title="Cetak Raport">
                        <i class="fa-solid fa-print"></i>
                    </button>
                </div>
            </td> `}
        </tr>
    `;
    }).join('');

    // Fetch Guru Wali Data (Async & Batch + Cache)
    fetchGuruWaliForTable(data);
}


// --- 4. HAPUS DATA ---
window.confirmDeleteStudent = (id, name, nis, className) => {
    deleteTargetId = id;
    // Simpan context untuk Deep Delete
    window.deleteTargetNIS = nis;
    window.deleteTargetClass = className;

    document.getElementById('delete-target-name').innerText = `${name} (${className || '?'})`;
    document.getElementById('modal-confirm-delete').classList.remove('hidden');
};

// --- 4. HAPUS DATA (DEEP DELETE / CLEAN DELETE) ---
window.executeDeleteStudent = async () => {
    if (!deleteTargetId) return;

    // Ambil context yang disimpan saat confirm
    const targetNIS = window.deleteTargetNIS;
    const targetClass = window.deleteTargetClass;

    const btn = document.querySelector('#modal-confirm-delete button[onclick="window.executeDeleteStudent()"]');
    const originalText = btn ? btn.innerHTML : 'Hapus';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Membersihkan Data...';
    }

    try {
        showToast("Proses Hapus", "Memulai pembersihan total data siswa...", "info");

        // 1. HAPUS DOKUMEN UTAMA SISWA (Cloudflare D1 & Firestore)
        let oldData = null;
        if (typeof studentsCache !== 'undefined') {
            oldData = studentsCache.find(s => s.id === deleteTargetId);
        }

        try {
            if (cfClient && cfClient.enabled) {
                await cfClient.deleteStudent(deleteTargetId);
            }
        } catch (cfErr) {
            console.warn('[DeleteStudent] Gagal hapus dari Cloudflare D1:', cfErr.message);
        }

        if (typeof window.logAudit === 'function') {
            window.logAudit('DELETE_STUDENT', deleteTargetId, oldData, null, `Menghapus data siswa/mutasi: ${oldData ? oldData.name : deleteTargetId}`);
        }

        // 2. HAPUS RECORDS & BK_ACTIONS DI CLOUDFLARE D1 (0 Firestore Read)
        if (targetNIS) {
            try {
                await Promise.all([
                    cfClient.batchDeleteRecords({ nis: String(targetNIS) }),
                    cfClient.deleteBkAction(String(targetNIS)).catch(() => {})
                ]);
            } catch (d1Err) {
                console.warn('[Students] Gagal cleanup D1 records/bk:', d1Err);
            }
        }

        // 3. DATA TERKAIT (Dikelola murni di SSOT masing-masing: D1 & Supabase)
        if (targetNIS) {
            // A. DATA KEUANGAN (TRANSAKSI) - Murni Supabase SSOT
            const sbClient = supabase || window.supabase;
            if (sbClient) {
                try {
                    await sbClient.from('finance_transactions').delete().eq('student_nis', String(targetNIS));
                } catch (sbDelErr) {
                    console.warn('[Students] Gagal hapus finance_transactions Supabase:', sbDelErr);
                }
            }

            // B. DATA PERMISI & PERWALIAN: Dikelola 100% di Cloudflare D1 (Pure Edge SQL SSOT)
        }

        // 4. CLEANUP SUPABASE DATA (Presensi & Nilai Mapel)
        if (targetNIS) {
            const sbClient = supabase || window.supabase;
            if (sbClient) {
                try {
                    await sbClient.from('siswa_presensi').delete().eq('student_nis', targetNIS);
                    await sbClient.from('guru_mapel_scores').delete().eq('student_nis', targetNIS);
                    await sbClient.from('guru_mapel_summaries').delete().eq('student_nis', targetNIS);
                } catch (sbDelErr) {
                    console.warn('[Students] Supabase delete single student warning:', sbDelErr);
                }
            }
        }

        // 4b. CLEANUP CLOUDFLARE D1 DATA
        if (targetNIS && cfClient && cfClient.enabled) {
            try {
                await cfClient.deleteStudent(String(targetNIS));
            } catch (cfDelErr) {
                console.warn('[Students] Cloudflare D1 delete single student warning:', cfDelErr);
            }
        }

        // 5. TRIGGER SYNC METADATA
        if (cfClient && cfClient.enabled) {
            await cfClient.saveSystemSetting('metadata', {
                lastUpdateStudents: Date.now(),
                ...(targetNIS ? { lastAggregateNis: String(targetNIS) } : {})
            });
        }
        if (typeof window.invalidateStudentAggregatesCache === 'function') {
            window.invalidateStudentAggregatesCache();
        }

        // UI Updates
        studentsCache = studentsCache.filter(s => s.id !== deleteTargetId);
        renderTable(studentsCache);

        document.getElementById('modal-confirm-delete').classList.add('hidden');
        showToast("Berhasil", "Data siswa & riwayatnya telah dibersihkan.", "success");

        deleteTargetId = null;
        window.deleteTargetNIS = null;
        window.deleteTargetClass = null;

    } catch (e) {
        console.error("Clean Delete Error:", e);
        showToast("Error", "Gagal hapus total: " + e.message, "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
};

// --- IMPORT LOGIC (SMART IMPORT: ID=NIS & DATA PRESERVATION) ---

/**
 * Deteksi apakah baris-baris data impor diawali kolom nomor urut "No" (1, 2, 3...)
 * @param {Array<string>} rows - Baris teks yang ditempel
 * @param {Map<string, object>|null} existingStudentsMap - Map NIS siswa yang sudah ada di database
 * @returns {number} 0 jika langsung NIS di kolom A, 1 jika diawali kolom No
 */
export function detectStudentImportOffset(rows, existingStudentsMap = null, manualSelection = 'auto') {
    if (manualSelection === '0' || manualSelection === 0) return 0;
    if (manualSelection === '1' || manualSelection === 1) return 1;
    if (!rows || rows.length === 0) return 0;

    // 1. Cek baris header pertama jika ada
    const firstCols = rows[0].split('\t').map(c => c.trim());
    if (firstCols.length > 1) {
        const h0 = firstCols[0].toLowerCase();
        const h1 = firstCols[1].toLowerCase();
        if ((h0 === 'no' || h0 === 'nomor' || h0 === '#' || h0 === 'no.') && (h1 === 'nis' || h1.includes('nis'))) {
            return 1;
        }
        if (h0 === 'nis' || h0.includes('nis')) {
            return 0;
        }
    }

    // 2. Evaluasi sampel baris data (maksimal 25 baris)
    // Default SIMAS SMAGESA: 0 (Kolom A adalah NIS).
    // Offset hanya menjadi 1 jika ada indikasi kuat bahwa Kolom A adalah nomor urut (1, 2, 3...)
    let evidenceOffset0 = 0;
    let evidenceOffset1 = 0;

    const dataRows = rows.filter(r => {
        const c = r.split('\t').map(x => x.trim());
        const first = (c[0] || '').toLowerCase();
        return first !== 'nis' && first !== 'no' && first !== 'nomor' && first !== '#';
    }).slice(0, 25);

    if (dataRows.length === 0) return 0;

    for (let idx = 0; idx < dataRows.length; idx++) {
        const cols = dataRows[idx].split('\t').map(c => c.trim());
        if (cols.length < 2) continue;
        const c0 = cols[0];
        const c1 = cols[1];

        // Jika c0 terdaftar di database siswa -> 100% PASTI OFFSET 0!
        if (existingStudentsMap && existingStudentsMap.has(c0)) {
            evidenceOffset0 += 10;
        }
        // Jika c1 terdaftar di database siswa dan c0 bukan NIS -> Indikasi kuat OFFSET 1
        if (existingStudentsMap && existingStudentsMap.has(c1) && !existingStudentsMap.has(c0)) {
            evidenceOffset1 += 10;
        }

        // Cek pola nomor urut: Apakah c0 adalah nomor urut baris (1, 2, 3...) atau '1'/'01'?
        // Ingat: NIS di SMAGESA adalah 4-6 digit (misal: 1476, 1477). Angka 4 digit BUKAN nomor urut 1!
        const isSequentialNo = (c0 === String(idx + 1)) || (idx === 0 && (c0 === '1' || c0 === '01' || c0 === '001'));
        if (isSequentialNo && c0.length <= 3) {
            evidenceOffset1 += 4;
        }

        // Jika c0 adalah 4 digit atau lebih (format lazim NIS) dan bukan '1'
        if (/^\d{4,}$/.test(c0)) {
            evidenceOffset0 += 4;
        }

        // Cek posisi Nama: jika kolom ke-3 (cols[2]) adalah teks nama orang (huruf abjad) -> Indikasi kuat Offset 0 (NIS, NISN, Nama)
        if (cols.length > 2 && /^[A-Za-z\s.,'-]{3,}$/.test(cols[2])) {
            evidenceOffset0 += 3;
        }
        // Jika kolom ke-4 (cols[3]) adalah teks nama orang dan cols[2] adalah angka/NISN -> Indikasi Offset 1 (No, NIS, NISN, Nama)
        if (cols.length > 3 && /^[A-Za-z\s.,'-]{3,}$/.test(cols[3]) && /^\d+$/.test(cols[2])) {
            evidenceOffset1 += 3;
        }
    }

    return evidenceOffset1 > evidenceOffset0 ? 1 : 0;
}

/**
 * Parsing satu baris teks impor siswa Excel secara pintar (Smart Merge & Sole NIS ID)
 * @param {string} row - Baris data tab-separated
 * @param {number} defaultOffset - Offset default hasil deteksi batch (0: Kolom A=NIS, 1: Kolom B=NIS)
 * @param {Map<string, object>|null} existingStudentsMap - Map siswa eksisting
 * @returns {object|null} { rowData, existing, rowOffset } atau null jika baris invalid/header
 */
export function parseStudentImportRow(row, defaultOffset = 0, existingStudentsMap = null) {
    if (!row || !row.trim()) return null;
    const cols = row.split('\t').map(c => (c !== undefined ? c.trim() : ''));
    if (cols.length < 1) return null;

    let rowOffset = defaultOffset;

    // Safety fallback HANYA jika defaultOffset adalah 1 (mode No urut), tapi baris ini terbukti dimulai dengan NIS yang terdaftar di database
    if (rowOffset === 1 && existingStudentsMap && existingStudentsMap.has(cols[0]) && !existingStudentsMap.has(cols[1])) {
        rowOffset = 0;
    }

    const primaryField = STUDENT_SCHEMA.find(f => f.primary) || { index: 0 };
    const rawNis = cols[primaryField.index + rowOffset] ? cols[primaryField.index + rowOffset].trim() : '';

    // Abaikan baris kosong atau baris header
    if (!rawNis || rawNis.toLowerCase() === 'nis' || rawNis.toLowerCase() === 'no' || rawNis.toLowerCase() === 'nomor') {
        return null;
    }

    const cleanNis = String(rawNis);
    const existing = existingStudentsMap ? existingStudentsMap.get(cleanNis) : null;

    // NIS siswa sebagai SATU-SATUNYA ID siswa (Single Source of Truth)
    const rowData = {
        id: cleanNis,
        nis: cleanNis
    };
    let hasContent = false;

    STUDENT_SCHEMA.forEach(field => {
        const colIdx = field.index + rowOffset;
        if (colIdx >= cols.length) return;
        let value = cols[colIdx];
        if (value !== undefined) {
            value = value.trim();
            // PENTING: Hanya set kolom yang benar-benar ada isinya!
            // Jika kolom kosong (''), strip ('-'), atau 'null', JANGAN dimasukkan ke rowData agar data lama tidak tertimpa
            if (value !== '' && value !== '-' && value !== '--' && value.toLowerCase() !== 'null' && value.toLowerCase() !== 'undefined') {
                if (field.key === 'gender') {
                    const gUpper = value.toUpperCase();
                    if (gUpper.startsWith('L')) value = 'L';
                    else if (gUpper.startsWith('P')) value = 'P';
                }
                if (field.key === 'birthDate') {
                    // Normalisasi otomatis: DD/MM/YYYY atau DD-MM-YYYY -> YYYY-MM-DD
                    const dmyMatch = value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
                    if (dmyMatch) {
                        const day = dmyMatch[1].padStart(2, '0');
                        const month = dmyMatch[2].padStart(2, '0');
                        const year = dmyMatch[3];
                        value = `${year}-${month}-${day}`;
                    }
                }
                if (field.key === 'father_phone' && value && !rowData.phone_parent) {
                    rowData.phone_parent = value;
                }
                if (field.key === 'email_siswa' && value && !rowData.email) {
                    rowData.email = value;
                }
                rowData[field.key] = value;
                hasContent = true;
            }
        }
    });

    if (!hasContent && !existing) return null;

    return {
        rowData,
        existing,
        rowOffset
    };
}

function setupImportLogic() {
    const btnPreview = document.getElementById('btn-preview');
    const btnSave = document.getElementById('btn-save-import');
    const pasteArea = document.getElementById('import-paste-area');
    const previewBody = document.getElementById('preview-body');
    const previewContainer = document.getElementById('preview-container');

    let tempImportData = [];

    // TAHAP 1: PREVIEW & FILTER KOSONG (PRESERVASI DATA LAMA)
    btnPreview.addEventListener('click', async () => {
        const rawText = pasteArea.value.trim();
        if (!rawText) return;

        const originalBtnText = btnPreview.innerHTML;
        btnPreview.disabled = true;
        btnPreview.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-2"></i> Menganalisis...`;

        try {
            // Ambil cache master data siswa untuk verifikasi Smart Merge
            let existingStudents = [];
            if (typeof window.getStudentsCache === 'function') {
                try {
                    existingStudents = await window.getStudentsCache();
                } catch (e) {
                    console.warn('[Import] getStudentsCache error:', e);
                }
            }
            if (!existingStudents || existingStudents.length === 0) {
                existingStudents = studentsCache || [];
            }
            if ((!existingStudents || existingStudents.length === 0) && cfClient && cfClient.enabled) {
                try {
                    const resp = await cfClient.getStudents({ limit: 2000, status: 'all' });
                    existingStudents = resp.data || [];
                } catch (e) {
                    console.warn('[Import] cfClient getStudents fallback error:', e);
                }
            }

            const existingMap = new Map();
            if (Array.isArray(existingStudents)) {
                for (const s of existingStudents) {
                    if (s && s.nis) existingMap.set(String(s.nis).trim(), s);
                }
            }

            const rawRows = rawText.split('\n').map(r => r.replace(/\r$/, '')).filter(r => r.trim().length > 0);
            const manualOffsetVal = document.getElementById('import-offset-select')?.value || 'auto';
            const detectedOffset = detectStudentImportOffset(rawRows, existingMap, manualOffsetVal);

            tempImportData = [];
            let html = '';
            let mergeCount = 0;
            let newCount = 0;

            for (const row of rawRows) {
                const parsed = parseStudentImportRow(row, detectedOffset, existingMap);
                if (!parsed) continue;

                const { rowData, existing } = parsed;
                tempImportData.push(rowData);

                if (existing) mergeCount++;
                else newCount++;

                // 1. Render Nama
                let nameDisplay = '';
                if (rowData.name) {
                    if (existing && existing.name && existing.name !== rowData.name) {
                        nameDisplay = `<div class="flex flex-col"><span class="font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-200 inline-block">${window.escapeHTML(rowData.name)}</span><span class="line-through text-slate-400 text-[10px]">(${window.escapeHTML(existing.name)})</span></div>`;
                    } else {
                        nameDisplay = `<span class="font-bold text-slate-800 dark:text-white">${window.escapeHTML(rowData.name)}</span>`;
                    }
                } else if (existing && existing.name) {
                    nameDisplay = `<span class="text-slate-700 dark:text-slate-300 font-medium">${window.escapeHTML(existing.name)}</span> <span class="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800 inline-block ml-1"><i class="fa-solid fa-shield-halved"></i> Data Lama Tetap</span>`;
                } else {
                    nameDisplay = `<span class="text-rose-500 italic text-[11px]">(Kosong - Siswa Baru)</span>`;
                }

                // 2. Render Kelas (Fokus Utama Preservasi: Tidak Boleh Kosong Jika Data Lama Ada)
                let classDisplay = '';
                if (rowData.class) {
                    if (existing && existing.class && existing.class !== rowData.class) {
                        classDisplay = `<div class="flex flex-col"><span class="font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-200 inline-block">${window.escapeHTML(rowData.class)}</span><span class="line-through text-slate-400 text-[10px]">(${window.escapeHTML(existing.class)})</span></div>`;
                    } else {
                        classDisplay = `<span class="font-bold text-slate-800 dark:text-white">${window.escapeHTML(rowData.class)}</span>`;
                    }
                } else if (existing && existing.class) {
                    classDisplay = `<span class="font-bold text-slate-800 dark:text-white">${window.escapeHTML(existing.class)}</span> <span class="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800 inline-block ml-1"><i class="fa-solid fa-shield-halved"></i> Data Lama Tetap</span>`;
                } else {
                    classDisplay = `<span class="text-rose-500 italic text-[11px]">(Kosong - Siswa Baru)</span>`;
                }

                // 3. Render Gender
                let genderDisplay = '';
                const targetGender = rowData.gender || (existing ? existing.gender : '');
                const isGenderOld = !rowData.gender && existing && existing.gender;
                if (targetGender) {
                    genderDisplay = `<span class="font-bold">${window.escapeHTML(targetGender)}</span>${isGenderOld ? ' <span class="text-[10px] text-emerald-600 font-bold ml-1" title="Data Lama Dipertahankan"><i class="fa-solid fa-shield-halved"></i></span>' : ''}`;
                } else {
                    genderDisplay = `<span class="text-slate-400">-</span>`;
                }

                // 4. Render Status Badge
                let statusBadge = '';
                if (existing) {
                    statusBadge = `<span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 whitespace-nowrap"><i class="fa-solid fa-rotate mr-1"></i>Smart Merge</span>`;
                } else {
                    statusBadge = `<span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300 border border-blue-200 dark:border-blue-800 whitespace-nowrap"><i class="fa-solid fa-user-plus mr-1"></i>Siswa Baru</span>`;
                }

                html += `
                <tr class="border-b hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
                    <td class="p-2 font-mono text-blue-600 dark:text-blue-400 font-bold">${window.escapeHTML(rowData.nis)}</td>
                    <td class="p-2">${nameDisplay}</td>
                    <td class="p-2">${classDisplay}</td>
                    <td class="p-2 text-center">${genderDisplay}</td>
                    <td class="p-2">${statusBadge}</td>
                </tr>`;
            }

            previewBody.innerHTML = html;
            previewContainer.classList.remove('hidden');

            const infoOffset = detectedOffset === 1 
                ? ' <span class="text-indigo-600 dark:text-indigo-400 font-semibold bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 rounded border border-indigo-200 dark:border-indigo-800"><i class="fa-solid fa-list-ol mr-1"></i>Format: Kolom A = No Urut, Kolom B = NIS</span>' 
                : ' <span class="text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800"><i class="fa-solid fa-id-card mr-1"></i>Format: Kolom A = NIS Langsung (Standar)</span>';
            document.getElementById('import-info-count').innerHTML = `<b>${tempImportData.length}</b> data siap diproses (${mergeCount} update/merge, ${newCount} baru).${infoOffset}`;
            btnSave.disabled = tempImportData.length === 0;

        } catch (err) {
            console.error('[Import Siswa] Preview error:', err);
            showModernAlert("Gagal Cek Data", err.message, 'error');
        } finally {
            btnPreview.disabled = false;
            btnPreview.innerHTML = originalBtnText;
        }
    });

    // Listener jika user mengganti pilihan dropdown format kolom pertama
    const offsetSelect = document.getElementById('import-offset-select');
    if (offsetSelect) {
        offsetSelect.addEventListener('change', () => {
            if (pasteArea.value.trim().length > 0) {
                btnPreview.click();
            }
        });
    }

    // TAHAP 2: EKSEKUSI SIMPAN (ID = NIS TUNGGAL & DATA LAMA TERJAGA)
    btnSave.addEventListener('click', async () => {
        if (tempImportData.length === 0) return;

        const originalText = btnSave.innerHTML;
        btnSave.disabled = true;
        btnSave.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-2"></i> Memproses...`;

        try {
            // 1. SINKRONISASI KE CLOUDFLARE D1 (MASTER TUNGGAL)
            // Pastikan NIS menjadi ID tunggal untuk setiap data sebelum dikirim
            const payload = tempImportData.map(item => {
                const cleanItem = { ...item };
                cleanItem.id = String(item.nis);
                cleanItem.nis = String(item.nis);
                return cleanItem;
            });

            if (cfClient && cfClient.enabled) {
                await cfClient.bulkSyncStudents(payload);
            }
            const count = payload.length;

            // 2. TRIGGER SYNC METADATA & INVALIDATE CACHE
            if (cfClient && cfClient.enabled) {
                await cfClient.saveSystemSetting('metadata', {
                    lastUpdateStudents: Date.now()
                });
            }
            if (typeof window.invalidateStudentsCache === 'function') {
                window.invalidateStudentsCache();
            }
            if (typeof window.invalidateActiveClassesCache === 'function') {
                window.invalidateActiveClassesCache();
            }

            if (typeof window.logAudit === 'function') {
                window.logAudit('IMPORT_STUDENTS', 'batch', null, { count }, `Import data siswa: ${count} data diproses (Smart Merge - NIS ID SSOT)`);
            }

            document.getElementById('modal-import').classList.add('hidden');
            showModernAlert("Sukses", `Berhasil memproses <b>${count}</b> data siswa dengan Smart Merge.<br>NIS digunakan sebagai ID tunggal & data lama pada kolom kosong tetap dipertahankan.`);

            pasteArea.value = '';
            previewContainer.classList.add('hidden');

            // Refresh Tabel jika sedang membuka kelas
            const cls = document.getElementById('filter-class').value;
            if (cls === 'ALL') loadAllStudents();
            else if (cls) loadStudentsByClass(cls);

        } catch (error) {
            console.error("Import Error:", error);
            showModernAlert("Gagal Import", error.message, 'error');
        } finally {
            btnSave.disabled = false;
            btnSave.innerHTML = originalText;
        }
    });
}

// --- LOGIC SWITCH VIEW (TOGGLE) ---
let isProfileView = false;

window.toggleProfileView = () => {
    const viewDash = document.getElementById('view-dashboard');
    const viewProf = document.getElementById('view-profile');
    const btnText = document.getElementById('btn-toggle-detail');

    isProfileView = !isProfileView;

    if (isProfileView) {
        // Show Profile
        viewDash.classList.add('hidden'); // Sembunyikan Dashboard
        viewProf.classList.remove('hidden', 'translate-x-full', 'opacity-0'); // Munculkan Profile

        // Ubah Teks Tombol Header
        btnText.innerHTML = `<span><i class="fa-solid fa-chart-pie mr-1"></i> Dashboard</span>`;
    } else {
        // Show Dashboard
        viewProf.classList.add('hidden', 'translate-x-full', 'opacity-0');
        viewDash.classList.remove('hidden');

        // Kembalikan Teks Tombol
        btnText.innerHTML = `<span>Lihat Detail</span> <i class="fa-solid fa-angles-right"></i>`;
    }
};

// --- FUNGSI KLIK CARD DASHBOARD ---
// 1. Tombol CATAT (Redirect ke Input dengan NIS)
window.goToInput = () => {
    if (!currentDetailStudentNIS) return;
    window.location.href = `input.html?nis=${currentDetailStudentNIS}`;
};

// 2. Tombol HUBUNGI WALI KELAS (Gantikan Lapor Ortu)
window.contactHomeroom = async () => {
    const cls = document.getElementById('detail-class').innerText;
    if (!cls || cls === '-' || cls === 'KELAS -') { showModernAlert("Info", "Kelas tidak diketahui.", "error"); return; }

    const btn = document.getElementById('btn-action-homeroom');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Loading...';
    btn.disabled = true;

    try {
        // Gunakan cache dari global.js (hemat read Firestore + sudah handle additionalRoles)
        let waliData = await window.getWaliKelasByClass(cls);

        // Jika tidak ditemukan, coba force refresh cache
        if (!waliData) {
            await window.getWaliKelasCache(true);
            waliData = await window.getWaliKelasByClass(cls);
        }

        if (waliData) {
            if (waliData.phone) {
                let num = waliData.phone.replace(/\D/g, '');
                if (num.startsWith('0')) num = '62' + num.slice(1);
                window.open(`https://wa.me/${num}`, '_blank');
            } else {
                showModernAlert("Gagal", `Wali Kelas (${waliData.name}) belum mendaftarkan nomor HP.`, "error");
            }
        } else {
            showModernAlert("Info", "Belum ada Wali Kelas yang terdaftar untuk kelas " + cls, "error");
        }
    } catch (e) {
        console.error(e);
        showModernAlert("Error", "Gagal mencari data Wali Kelas.", "error");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

// --- UPDATE: DETAIL SISWA DENGAN SSOT CALCULATION ---
// --- UPDATE: DETAIL SISWA DENGAN SSOT CALCULATION ---
// --- UPDATE: DETAIL SISWA DENGAN SSOT CALCULATION ---
window.openStudentDetail = async (input) => {
    try {
        let student = null;

        // Cek input: Text (ID/NIS) atau Object (Data Siswa Lengkap)
        if (typeof input === 'string') {
            // Jika string, cari di cache
            student = studentsCache.find(s => s.id === input || s.nis === input);
            if (!student) {
                // Fallback: Coba fetch langsung jika tidak ada di cache (untuk kasus URL param)
                try {
                    if (cfClient && cfClient.enabled) {
                        const cfS = await cfClient.getStudentByNis(input);
                        if (cfS) student = cfS;
                    }
                    if (!student && typeof window.getStudentByNIS === 'function') {
                        student = await window.getStudentByNIS(input);
                    }
                } catch (e) { console.error("Error fetch student detail fallback:", e); }
            }
        } else if (typeof input === 'object' && input !== null) {
            // Jika object, pakai langsung
            student = input;
        }

        if (!student) {
            showToast("Error", "Data siswa tidak ditemukan (Cache/Fetch Failed).", "error");
            return;
        }

        // Set variable global untuk aksi tombol
        currentDetailStudentNIS = student.nis;
        window.currentStudentDetailData = student;

        // Reset View
        isProfileView = true;
        toggleProfileView();

        // Render Data Statis (Nama, Kelas, dll)
        document.getElementById('detail-name').innerText = student.name;
        document.getElementById('detail-initial').innerText = (student.name || '?').charAt(0).toUpperCase();
        document.getElementById('detail-class').innerText = student.class || '-';
        document.getElementById('detail-nis').innerText = student.nis || '-';
        const elNisn = document.getElementById('detail-nisn');
        if (elNisn) elNisn.innerText = student.nisn || '-';

        // Debugging elements
        if (!document.getElementById('detail-note')) console.warn("Element detail-note hilang!");

        // ... (Kode render biodata & WA tetap sama) ...

        // --- LOGIC HAK AKSES TOMBOL DI MODAL DETIL ---
        const userRole = localStorage.getItem('user_role');
        const assignedClass = localStorage.getItem('user_assigned_class');

        const btnPrintRaport = document.getElementById('btn-print-raport');
        const btnPrintSuratKet = document.getElementById('btn-print-surat-keterangan');
        const btnContact = document.getElementById('btn-action-homeroom');

        if (btnPrintRaport) {
            // Default: Show
            btnPrintRaport.classList.remove('hidden');

            // 1. Wali Kelas (Multi-role): Hanya show di kelas perwaliannya
            const isWaliRole = window.hasRole ? window.hasRole('wali_kelas') : userRole === 'wali_kelas';
            const isNoPrintOnly = window.hasRole ?
                (['admin_pks', 'admin_spp', 'guru_mapel'].some(r => window.hasRole(r)) &&
                    !['super_admin', 'kesiswaan', 'staff', 'wali_kelas', 'guru_bk', 'kepala_sekolah'].some(r => window.hasRole(r))) :
                ['admin_pks', 'admin_spp', 'guru_mapel'].includes(userRole);

            if (isWaliRole) {
                if (student.class !== assignedClass) {
                    btnPrintRaport.classList.add('hidden');
                }
            }
            // 2. Admin PKS / SPP / Guru Mapel (tanpa role lain yg boleh): Selalu Hide
            else if (isNoPrintOnly) {
                btnPrintRaport.classList.add('hidden');
            }
        }

        if (btnPrintSuratKet) {
            // Default: Show
            btnPrintSuratKet.classList.remove('hidden');

            const canPrintSurat = window.hasRole ?
                (window.hasRole('staff') || window.hasRole('super_admin') || window.hasRole('kepala_sekolah') || window.hasRole('kesiswaan') || window.hasRole('wakasek_kurikulum') || window.hasRole('wali_kelas')) :
                ['staff', 'super_admin', 'kepala_sekolah', 'kesiswaan', 'wakasek_kurikulum', 'wali_kelas'].includes(userRole);

            if (!canPrintSurat) {
                btnPrintSuratKet.classList.add('hidden');
            }
        }

        if (btnContact) {
            // Default: Show
            btnContact.classList.remove('hidden');

            // 1. Wali Kelas: Hide JIKA siswa adalah anak walinya sendiri
            if (userRole === 'wali_kelas') {
                if (student.class === assignedClass) {
                    btnContact.classList.add('hidden');
                }
            }
        }
        // Format WA (Robust)
        const formatWA = (num) => {
            if (!num || num.trim() === '-' || num.trim() === '') return 'javascript:void(0)';
            let clean = num.toString().replace(/\D/g, ''); // Hapus semua non-digit
            if (clean.startsWith('0')) clean = '62' + clean.slice(1);
            if (clean.startsWith('62')) return `https://wa.me/${clean}`;
            return `https://wa.me/62${clean}`; // Fallback default +62
        };

        const hpSiswa = student.phone_siswa || '-';
        const hpOrtu = student.phone_parent || '-';

        document.getElementById('detail-hp-siswa').innerText = hpSiswa;
        document.getElementById('link-wa-siswa').href = formatWA(student.phone_siswa);

        document.getElementById('detail-hp-ortu').innerText = hpOrtu;
        const linkOrtu = document.getElementById('link-wa-ortu');
        if (linkOrtu) {
            const waUrl = formatWA(student.phone_parent);
            const isValid = waUrl !== 'javascript:void(0)';

            if (isValid) {
                linkOrtu.href = waUrl;
                linkOrtu.onclick = null;
                linkOrtu.classList.add('text-green-600', 'hover:underline', 'cursor-pointer');
                // Warna status menggantikan warna dasar text-slate-600 (urutan CSS Tailwind build)
                linkOrtu.classList.remove('text-slate-400', 'cursor-not-allowed', 'text-slate-600');
            } else {
                linkOrtu.href = "#";
                linkOrtu.onclick = (e) => {
                    e.preventDefault();
                    showModernAlert("Info", "Nomor WA ortu tidak tersedia.", "info");
                };
                linkOrtu.classList.add('text-slate-400', 'cursor-not-allowed');
                linkOrtu.classList.remove('text-green-600', 'hover:underline', 'cursor-pointer', 'text-slate-600');
            }
        }


        // --- GURU WALI DISPLAY LOGIC ---
        const guruWaliContainer = document.getElementById('link-wa-guru-wali');
        const guruWaliSep = document.getElementById('sep-guru-wali');
        const guruWaliNameEl = document.getElementById('detail-guru-wali');

        if (guruWaliContainer && guruWaliSep && guruWaliNameEl) {
            // Reset (Hidden while loading to prevent flickering)
            guruWaliContainer.classList.add('hidden');
            guruWaliSep.classList.add('hidden');
            guruWaliNameEl.innerText = '...';
            guruWaliNameEl.className = "font-medium group-hover:underline"; // Reset class

            // Ambil data Guru Wali dari Cloudflare D1 SSOT (0 Firestore Read)
            (async () => {
                try {
                    let waliData = null;
                    if (cfClient && cfClient.enabled) {
                        const assignList = await cfClient.getGuruWaliAssignments({ student_nis: student.nis });
                        if (Array.isArray(assignList) && assignList.length > 0) {
                            waliData = assignList[0];
                        }
                    }

                    // ALWAYS SHOW (Remove hidden)
                    guruWaliContainer.classList.remove('hidden');
                    guruWaliSep.classList.remove('hidden');

                    if (waliData) {
                        guruWaliNameEl.innerText = waliData.guru_name || 'Tanpa Nama';
                        guruWaliNameEl.classList.remove('text-red-400', 'italic');
                        guruWaliNameEl.classList.add('text-slate-700');

                        // NEW: Check Access for Guru Wali (Enable Print Button)
                        if (auth.currentUser && waliData.guru_uid === auth.currentUser.uid) {
                            const btnPrint = document.getElementById('btn-print-raport');
                            if (btnPrint) btnPrint.classList.remove('hidden');
                        }

                        // Retrieve Phone Number if guru_uid exists
                        if (waliData.guru_uid) {
                            try {
                                const userSnap = await getDoc(doc(db, 'users', waliData.guru_uid));
                                if (userSnap.exists()) {
                                    const userData = userSnap.data();
                                    let phone = userData.phone || userData.hp || null;
                                    if (!phone && userData.linkedTeacherId) {
                                        if (typeof window.getGtkMapCache === 'function') {
                                            const gtkMap = await window.getGtkMapCache();
                                            const teacher = gtkMap[userData.linkedTeacherId] || Object.values(gtkMap).find(t => t.id === userData.linkedTeacherId || t.nik === userData.linkedTeacherId || t.nip === userData.linkedTeacherId);
                                            phone = teacher?.hp || teacher?.phone || null;
                                        } else if (typeof cfClient !== 'undefined' && cfClient.getGtkById) {
                                            const teacher = await cfClient.getGtkById(userData.linkedTeacherId);
                                            phone = teacher?.hp || teacher?.phone || null;
                                        }
                                    }
                                    if (phone) {
                                        const waUrl = formatWA(phone);
                                        guruWaliContainer.href = waUrl;
                                        guruWaliContainer.onclick = null; // Remove preventDefault
                                        guruWaliContainer.classList.add('hover:text-green-600', 'cursor-pointer');
                                        guruWaliContainer.classList.remove('cursor-default');
                                        guruWaliContainer.title = "Chat WhatsApp Guru Wali";
                                        return; // Stop here if success
                                    }
                                }
                            } catch (errPhone) {
                                console.error("Error fetching Guru Wali Phone:", errPhone);
                            }
                        }
                    } else {
                        guruWaliNameEl.innerText = 'Belum memiliki Guru Wali';
                        guruWaliNameEl.classList.add('text-red-400', 'italic');
                        guruWaliNameEl.classList.remove('text-slate-700');
                    }

                    // Default: Disable click if no phone or no assignment
                    guruWaliContainer.href = "#";
                    guruWaliContainer.onclick = (e) => e.preventDefault();
                    guruWaliContainer.classList.remove('hover:text-green-600', 'cursor-pointer');
                    guruWaliContainer.classList.add('cursor-default');

                } catch (eGw) {
                    console.warn("Gagal load guru wali:", eGw);
                }
            })();
        }

        // Hak Akses Dokumen Kartu Keluarga (KK): Super Admin, Admin Dapodik, dan Wali Kelas untuk rombelnya
        const isSuperOrAdmin = window.hasRole ?
            (window.hasRole('super_admin') || window.hasRole('admin')) :
            ['super_admin', 'admin'].includes(userRole);
        const isAdminDapodik = window.hasRole ? window.hasRole('admin_dapodik') : userRole === 'admin_dapodik';
        const isWali = window.hasRole ? window.hasRole('wali_kelas') : userRole === 'wali_kelas';
        const canViewDetailKK = isSuperOrAdmin || isAdminDapodik || (isWali && student.class === assignedClass);
        const safeStudentNameForDetail = window.escapeHTML(student.name || '').replace(/'/g, "\\'");
        let kkDetailVal = student.kk_no || student.kkNumber || student.no_kk || '';
        let kkDetailIsHtml = false;
        if (canViewDetailKK && student.kk_document_url) {
            const rawKkNum = kkDetailVal ? window.escapeHTML(kkDetailVal) : '-';
            kkDetailVal = `<span class="inline-flex items-center gap-1.5 flex-wrap">${rawKkNum} <button type="button" onclick="event.stopPropagation(); window.openKKPreviewAdmin('${student.nis}', '${safeStudentNameForDetail}', '${encodeURIComponent(student.kk_document_url)}', '${student.kk_uploaded_at || ''}')" class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 hover:bg-emerald-200 text-emerald-800 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/80 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 transition cursor-pointer" title="Pratinjau Berkas Foto KK"><i class="fa-solid fa-file-invoice text-emerald-600 dark:text-emerald-400"></i> Buka KK</button></span>`;
            kkDetailIsHtml = true;
        }

        // Render Profil Grid (Biodata Lengkap Dapodik)
        const profileGrid = document.getElementById('full-profile-grid');
        const sections = [
            {
                title: "Identitas Siswa & Dokumen",
                icon: "fa-user",
                fields: [
                    { label: "Nomor Induk Siswa (NIS)", val: student.nis },
                    { label: "NISN", val: student.nisn },
                    { label: "Kelas / Rombel", val: student.class },
                    { label: "Nama Lengkap", val: student.name },
                    { label: "Jenis Kelamin", val: (student.gender === 'L' ? 'Laki-laki (L)' : student.gender === 'P' ? 'Perempuan (P)' : student.gender) },
                    { label: "Tempat, Tgl Lahir", val: (student.birthPlace || student.birthDate) ? `${student.birthPlace || '-'}, ${student.birthDate || '-'}` : '-' },
                    { label: "Agama", val: student.agama },
                    { label: "NIK Siswa", val: student.nik },
                    { label: "No. Kartu Keluarga (KK)", val: kkDetailVal, isHtml: kkDetailIsHtml },
                    { label: "Anak Ke- / Dari", val: (student.child_order || student.jml_saudara_kandung) ? `Anak ke-${student.child_order || '-'} (dari ${student.jml_saudara_kandung ? Number(student.jml_saudara_kandung) + 1 : '-'} bersaudara)` : '-' },
                    { label: "Jml. Saudara Kandung", val: student.jml_saudara_kandung },
                    { label: "No. Akta Kelahiran", val: student.no_akta_lahir },
                    { label: "Sekolah Asal (SMP/MTs)", val: student.sekolah_asal }
                ]
            },
            {
                title: "Kontak & Alamat Domisili",
                icon: "fa-location-dot",
                fields: [
                    { label: "No. HP Siswa", val: student.phone_siswa || student.phone },
                    { label: "E-Mail Siswa", val: student.email_siswa || student.email },
                    { label: "Alamat Rumah", val: student.alamat || student.address },
                    { label: "Dusun / Banjar", val: student.dusun },
                    { label: "Kelurahan / Desa", val: student.kelurahan },
                    { label: "Kecamatan", val: student.kecamatan },
                    { label: "Kode Pos", val: student.kode_pos },
                    { label: "Jenis Tinggal", val: student.jenis_tinggal },
                    { label: "Alat Transportasi", val: student.alat_transportasi },
                    { label: "Jarak ke Sekolah (KM)", val: student.jarak_sekolah_km ? `${student.jarak_sekolah_km} KM` : '-' }
                ]
            },
            {
                title: "Data Ayah Kandung",
                icon: "fa-person",
                fields: [
                    { label: "Nama Ayah", val: student.father || student.fatherName },
                    { label: "NIK Ayah", val: student.father_nik },
                    { label: "No. HP / WA Ayah", val: student.father_phone || student.phone_parent },
                    { label: "Tahun Lahir Ayah", val: student.father_birth_year },
                    { label: "Pendidikan Ayah", val: student.father_education },
                    { label: "Pekerjaan Ayah", val: student.father_job },
                    { label: "Penghasilan Ayah", val: student.father_income }
                ]
            },
            {
                title: "Data Ibu Kandung",
                icon: "fa-person-dress",
                fields: [
                    { label: "Nama Ibu", val: student.mother || student.motherName },
                    { label: "NIK Ibu", val: student.mother_nik },
                    { label: "No. HP / WA Ibu", val: student.mother_phone },
                    { label: "Tahun Lahir Ibu", val: student.mother_birth_year },
                    { label: "Pendidikan Ibu", val: student.mother_education },
                    { label: "Pekerjaan Ibu", val: student.mother_job },
                    { label: "Penghasilan Ibu", val: student.mother_income }
                ]
            },
            {
                title: "Data Wali Murid",
                icon: "fa-user-shield",
                fields: [
                    { label: "Nama Wali", val: student.guardian },
                    { label: "NIK Wali", val: student.guardian_nik },
                    { label: "No. HP / WA Wali", val: student.guardian_phone },
                    { label: "Tahun Lahir Wali", val: student.guardian_birth_year },
                    { label: "Pendidikan Wali", val: student.guardian_education },
                    { label: "Pekerjaan Wali", val: student.guardian_job },
                    { label: "Penghasilan Wali", val: student.guardian_income }
                ]
            },
            {
                title: "Data Fisik & Periodik",
                icon: "fa-weight-scale",
                fields: [
                    { label: "Berat Badan", val: student.berat_badan ? `${student.berat_badan} kg` : '-' },
                    { label: "Tinggi Badan", val: student.tinggi_badan ? `${student.tinggi_badan} cm` : '-' },
                    { label: "Lingkar Kepala", val: student.lingkar_kepala ? `${student.lingkar_kepala} cm` : '-' }
                ]
            },
            {
                title: "Catatan Khusus",
                icon: "fa-note-sticky",
                fields: [
                    { label: "Catatan Sekolah", val: student.note || '-' }
                ]
            }
        ];

        profileGrid.innerHTML = sections.map(sec => `
            <div class="col-span-full bg-slate-100/70 dark:bg-slate-800/70 p-4 rounded-xl border border-slate-200 dark:border-slate-700/60 mt-1">
                <h5 class="text-xs font-black text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <i class="fa-solid ${sec.icon}"></i> ${sec.title}
                </h5>
                <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    ${sec.fields.map(f => {
                        const valText = f.isHtml ? f.val : ((f.val !== undefined && f.val !== null && String(f.val).trim() !== '') ? window.escapeHTML(String(f.val)) : '<span class="text-slate-400 dark:text-slate-600 italic">-</span>');
                        return `
                        <div class="bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200/80 dark:border-slate-800 shadow-sm">
                            <p class="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-0.5">${f.label}</p>
                            <p class="text-slate-800 dark:text-slate-200 font-semibold text-xs truncate" title="${f.isHtml ? '' : (f.val ? window.escapeHTML(String(f.val)) : '')}">${valText}</p>
                        </div>`;
                    }).join('')}
                </div>
            </div>
        `).join('');

        // --- FILTER SEMESTER SETUP (SMART) ---
        // 1. Generate Options & Reset Dropdown
        const filterSelect = document.getElementById('detail-semester-filter');
        if (filterSelect) {
            filterSelect.innerHTML = ''; // Clear

            // Generate Smart Options based on Student Class
            const smartOptions = window.generateSmartFilterOptions(student.class);
            smartOptions.forEach(opt => {
                const el = document.createElement('option');
                el.value = opt.value;
                el.innerText = opt.label;
                filterSelect.appendChild(el);
            });
        }

        // 4. SHOW MODAL IMMEDIATELY
        document.getElementById('modal-detail').classList.remove('hidden');

        // Show Loading State on Stats & History
        const safeSet = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };

        safeSet('stat-pelanggaran', '...');
        safeSet('stat-absensi', 'Loading...');
        safeSet('stat-prestasi', '...');
        safeSet('stat-permisi', '...');

        const loadingHtml = `
            <div class="p-8 text-center text-slate-400 animate-pulse">
                <i class="fa-solid fa-circle-notch fa-spin text-2xl mb-2"></i><br>
                Mengambil Data...
            </div>`;

        const histContainer = document.getElementById('history-list-container');
        if (histContainer) histContainer.innerHTML = loadingHtml;

        const attContainer = document.getElementById('attendance-list-container');
        if (attContainer) attContainer.innerHTML = loadingHtml;

        // 5. ASYNC DATA FETCHING (Awaited to ensure data readiness for Print)
        try {
            // 2. Query Catatan Prestasi & Pelanggaran BK dari Cloudflare D1 (0 Firestore Read)
            const snapRecords = await cfClient.getRecords({ nis: student.nis, limit: 100 });
            const rawRecords = (snapRecords || []).map(d => {
                const timeObj = d.timestamp?.toDate ? d.timestamp.toDate() : (d.timestampIso ? new Date(d.timestampIso) : (d.date ? new Date(d.date) : (d.timestamp ? new Date(d.timestamp) : new Date())));
                return {
                    id: d.id,
                    studentNIS: d.studentNIS || d.student_nis,
                    studentName: d.studentName || d.student_name,
                    studentClass: d.studentClass || d.student_class,
                    category: d.category,
                    type: d.type,
                    points: d.points || 0,
                    desc: d.desc,
                    createdBy: d.createdBy || d.created_by,
                    timestamp: d.timestamp,
                    dateObj: (!isNaN(timeObj.getTime())) ? timeObj : new Date()
                };
            });

            // 3. Query Presensi Siswa Multi-Tahun Murni Supabase (Masa Retensi 3 Tahun)
            let rawAttendance = [];
            try {
                const sbAttRes = await window.fetchStudentAttendanceRange(student.nis, null, null);
                if (sbAttRes && Array.isArray(sbAttRes.rows)) {
                    rawAttendance = sbAttRes.rows.map(r => ({
                        id: `${r.className || student.class}_${r.date}`,
                        dateObj: new Date(r.date),
                        date: r.date,
                        status: r.status,
                        note: r.note || '',
                        hasLetter: !!r.hasLetter,
                        className: r.className || student.class
                    }));
                }
            } catch (sbErr) {
                console.warn('[Students] Supabase attendance fetch notice:', sbErr);
            }

            // SET GLOBAL CACHE
            window.currentStudentRaw = {
                nis: student.nis,
                name: student.name,
                class: student.class,
                nisn: student.nisn,
                student: student,
                records: rawRecords,
                attendance: rawAttendance
            };

            // Trigger Render UI
            if (filterSelect && filterSelect.options.length > 0) {
                filterSelect.selectedIndex = 0;
            }
            if (window.reloadStudentStats) window.reloadStudentStats();

        } catch (errBackground) {
            console.error("Background Fetch Error:", errBackground);
            const histListEl = document.getElementById('history-list-container');
            if (histListEl) {
                histListEl.innerHTML = `
                    <div class="p-8 text-center text-red-500">
                        <i class="fa-solid fa-triangle-exclamation text-2xl mb-2"></i><br>
                        Gagal memuat data detail.
                    </div>`;
            }
        }
    } catch (criticalError) {
        console.error("CRITICAL ERROR openStudentDetail:", criticalError);
        showToast("Gagal", "Gagal membuka detail siswa: " + criticalError.message, "error");
    }
};

// 2. Fungsi Pindah Tab
window.switchTab = (tabId) => {
    // Sembunyikan semua konten
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    // Tampilkan konten target
    document.getElementById(tabId).classList.remove('hidden');

    // Update style tombol aktif
    document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.dataset.target === tabId) {
            btn.classList.add('border-blue-600', 'text-blue-600');
            btn.classList.remove('border-transparent', 'text-slate-500');
        } else {
            btn.classList.remove('border-blue-600', 'text-blue-600');
            btn.classList.add('border-transparent', 'text-slate-500');
        }
    });
};

// --- SMART SEMESTER FILTER LOGIC ---

// 1. Generate Options (Current AY -> Based on Grade Level)
window.generateSmartFilterOptions = (className) => {
    const options = [];
    const now = new Date();
    let currentMonth = now.getMonth(); // 0-11
    let currentYear = now.getFullYear();

    // Determine Current Academic Year
    let ayStartYear = (currentMonth >= 6) ? currentYear : currentYear - 1;
    let ayEndYear = ayStartYear + 1;

    // Default Option: Current Academic Year (Full)
    options.push({
        label: `TA ${ayStartYear}/${ayEndYear} (Saat Ini)`,
        value: `AY_${ayStartYear}_${ayEndYear}`,
        type: 'AY',
        startYear: ayStartYear,
        endYear: ayEndYear,
        isCurrent: true
    });

    // DETERMINE LIMIT BASED ON CLASS
    let limit = 6; // Default (XII or Alumni or Unknown)

    if (className) {
        const cls = className.toUpperCase();
        if (cls.includes('ALUMNI')) {
            limit = 6; // Alumni get full history
        } else if (cls.startsWith('X ') || cls.startsWith('X-') || cls === 'X') {
            limit = 2; // Grade X (Max 2 semesters)
        } else if (cls.startsWith('XI ') || cls.startsWith('XI-') || cls === 'XI') {
            limit = 4; // Grade XI (Max 4 semesters)
        } else if (cls.startsWith('XII ') || cls.startsWith('XII-') || cls === 'XII') {
            limit = 6; // Grade XII (Max 6 semesters)
        }
    }

    // Generate Previous Semesters
    let isGanjil = (currentMonth >= 6);
    let ptrStartYear = ayStartYear;
    let ptrIsGanjil = isGanjil;

    for (let i = 0; i < limit; i++) {
        const semesterName = ptrIsGanjil ? 'Ganjil' : 'Genap';
        const semesterNum = ptrIsGanjil ? '1' : '2';
        const ayLabel = `${ptrStartYear}/${ptrStartYear + 1}`;
        const semType = ptrIsGanjil ? 'ODD' : 'EVEN';

        options.push({
            label: `Smt. ${semesterNum} (${ayLabel})`,
            value: `SEM_${semType}_${ptrStartYear}_${ptrStartYear + 1}`,
            type: 'SEM',
            semType: semType,
            startYear: ptrStartYear,
            endYear: ptrStartYear + 1
        });

        // Move Backward
        if (ptrIsGanjil) {
            ptrIsGanjil = false; // Prev is Even
            ptrStartYear = ptrStartYear - 1; // Prev AY
        } else {
            ptrIsGanjil = true; // Prev is Odd
        }
    }

    return options;
};

// 2. Helper Date Range
window.getSmartRange = (filterValue) => {
    if (!filterValue || filterValue === 'ALL') return null;
    const parts = filterValue.split('_');
    const type = parts[0]; // AY or SEM

    if (type === 'AY') {
        const startY = parseInt(parts[1]);
        const endY = parseInt(parts[2]);
        return {
            start: new Date(`${startY}-07-01T00:00:00`),
            end: new Date(`${endY}-06-30T23:59:59.999`),
            startStr: `${startY}-07-01`,
            endStr: `${endY}-06-30`,
            startYear: startY,
            endYear: endY
        };
    }
    else if (type === 'SEM') {
        const semType = parts[1]; // ODD or EVEN
        const startY = parseInt(parts[2]);
        const endY = parseInt(parts[3]);

        if (semType === 'ODD') {
            // Ganjil: Jul startY - Dec startY
            return {
                start: new Date(`${startY}-07-01T00:00:00`),
                end: new Date(`${startY}-12-31T23:59:59.999`),
                startStr: `${startY}-07-01`,
                endStr: `${startY}-12-31`,
                startYear: startY,
                endYear: endY
            };
        } else {
            // Genap: Jan endY - Jun endY
            return {
                start: new Date(`${endY}-01-01T00:00:00`),
                end: new Date(`${endY}-06-30T23:59:59.999`),
                startStr: `${endY}-01-01`,
                endStr: `${endY}-06-30`,
                startYear: startY,
                endYear: endY
            };
        }
    }
    return null;
};

// --- CORE LOGIC: FILTER & RE-CALCULATE (MURNI SUPABASE & LIVE RECORDS) ---
window.reloadStudentStats = () => {
    const filterSelect = document.getElementById('detail-semester-filter');
    const filterType = filterSelect ? filterSelect.value : null;
    const filterLabel = filterSelect && filterSelect.options[filterSelect.selectedIndex] ? filterSelect.options[filterSelect.selectedIndex].text : 'FILTER TIDAK DIKETAHUI';

    // UPDATE HEADER LABEL
    const headerLabel = document.getElementById('summary-header-label');
    if (headerLabel) headerLabel.innerText = filterLabel.toUpperCase();

    const data = window.currentStudentRaw;
    if (!data) return;

    // Default Stats
    let stats = { violation: 0, achievement: 0, permission: 0, sakit: 0, izin: 0, alpha: 0, dispen: 0 };
    let filteredRecords = [];

    // GET RANGE
    const range = (filterType === 'ALL') ? null : window.getSmartRange(filterType);

    // 1. VIOLATIONS & PRESTASI (Live Firestore Records)
    filteredRecords = (data.records || []).filter(r => {
        if (!range) return true; // ALL
        return r.dateObj >= range.start && r.dateObj <= range.end;
    });

    filteredRecords.forEach(r => {
        if (r.type === 'violation' || r.category === 'Pelanggaran') stats.violation += (Number(r.point) || Number(r.points) || 0);
        if (r.type === 'achievement' || r.category === 'Prestasi') stats.achievement++;
        if (r.type === 'permission' || r.category === 'Permisi') stats.permission++;
    });

    // 2. ATTENDANCE (Murni Supabase SSOT Multi-Tahun)
    const filteredAtt = (data.attendance || []).filter(a => {
        if (!range) return true; // ALL
        return a.dateObj >= range.start && a.dateObj <= range.end;
    });

    filteredAtt.forEach(a => {
        if (a.status === 'S') stats.sakit++;
        else if (a.status === 'I') stats.izin++;
        else if (a.status === 'A') stats.alpha++;
        else if (a.status === 'D') stats.dispen++;
    });

    // UPDATE UI KARTU STATISTIK
    const safeSetText = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };

    // RE-CALC COUNTS
    let countViolations = 0;
    filteredRecords.forEach(r => {
        if (r.type === 'violation' || r.category === 'Pelanggaran') countViolations++;
    });

    safeSetText('stat-pelanggaran', countViolations);
    safeSetText('stat-prestasi', stats.achievement);
    safeSetText('stat-permisi', stats.permission);

    // Update Header Total Poin
    const totalPoinEl = document.getElementById('detail-total-poin');
    if (totalPoinEl) {
        totalPoinEl.innerText = stats.violation;
        if (stats.violation >= 50) totalPoinEl.className = "px-3 py-1 bg-red-100 text-red-600 rounded font-bold font-mono animate-pulse";
        else if (stats.violation >= 20) totalPoinEl.className = "px-3 py-1 bg-red-50 text-red-500 rounded font-bold font-mono";
        else if (stats.violation > 0) totalPoinEl.className = "px-3 py-1 bg-yellow-50 text-yellow-600 rounded font-bold font-mono";
        else totalPoinEl.className = "px-3 py-1 bg-green-50 text-green-600 rounded font-bold font-mono";
    }

    // Absensi
    const absText = `S:${stats.sakit} I:${stats.izin} A:${stats.alpha} D:${stats.dispen}`;
    safeSetText('stat-absensi', absText);

    // Render Lists
    renderLiveHistory(filteredRecords);

    // Render Daftar Presensi (Hanya tampilkan ketidakhadiran non-H untuk daftar catatan)
    const attListToRender = filteredAtt.filter(a => a.status !== 'H');
    attListToRender.sort((a, b) => b.dateObj - a.dateObj);
    renderLiveAttendance(attListToRender);
};

// --- RENDER FUNCTIONS ---
function renderLiveAttendance(attendanceList) {
    const attContainer = document.getElementById('attendance-list-container');
    if (attContainer) {
        if (!attendanceList || attendanceList.length === 0) {
            attContainer.innerHTML = `
            <div class="h-full flex flex-col justify-center items-center text-slate-400 text-center">
                <i class="fa-regular fa-calendar-check text-3xl mb-2 opacity-30"></i>
                <p class="text-sm">Belum ada data presensi.</p>
            </div>`;
        } else {
            // COMPACT SINGLE LINE STYLE (SAME AS ARCHIVE)
            attContainer.innerHTML = attendanceList.map(item => {
                // Item: { date: "YYYY-MM-DD", status: "S", note: "..." }

                // Date Format
                let dateDisplay = item.date;
                try {
                    const d = new Date(item.date);
                    dateDisplay = d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
                } catch (e) { }

                const status = item.status || '?';
                const note = item.note || '-';

                let badgeClass = "bg-slate-100 text-slate-700";
                if (status === 'S') badgeClass = "bg-blue-100 text-blue-700";
                else if (status === 'I') badgeClass = "bg-yellow-100 text-yellow-700";
                else if (status === 'A') badgeClass = "bg-red-100 text-red-700";
                else if (status === 'D') badgeClass = "bg-purple-100 text-purple-700";
                else if (status === 'H') badgeClass = "bg-green-100 text-green-700"; // Hadir usually not shown in list? User requests "History Filter" usually implies "Absent/Issues" or All?
                // If the user wants ALL attendance history including Present, we show it. 
                // But typically "Sakit, Izin, Alpha" are the focus.
                // Assuming we show all that are recorded.

                return `
                <div class="flex items-center gap-3 p-2 hover:bg-slate-50 border-b border-slate-100 last:border-0">
                     <div class="font-mono text-xs font-bold text-slate-500 w-12 shrink-0">${dateDisplay}</div>
                     <span class="w-6 h-6 flex items-center justify-center rounded text-[10px] font-bold ${badgeClass} shrink-0">
                        ${status}
                     </span>
                     <p class="text-[11px] text-slate-600 truncate">${note}</p>
                </div>`;
            }).join('');
        }
    }
}

// --- RENDER FUNCTIONS ---
function renderLiveHistory(records) {
    const activityContainer = document.getElementById('history-list-container');

    // 1. Render Activity
    if (activityContainer) {
        if (!records || records.length === 0) {
            activityContainer.innerHTML = `
            <div class="h-full flex flex-col justify-center items-center text-slate-400 text-center">
                <i class="fa-solid fa-clock-rotate-left text-3xl mb-2 opacity-30"></i>
                <p class="text-sm">Belum ada aktivitas.</p>
            </div>`;
        } else {
            activityContainer.innerHTML = records.map(r => {
                const cat = r.category || r.type || 'Activity';
                const isV = cat === 'Pelanggaran';
                const color = isV ? 'red' : (cat === 'Prestasi' ? 'green' : 'yellow');
                const icon = isV ? 'fa-circle-exclamation' : (cat === 'Prestasi' ? 'fa-medal' : 'fa-person-walking-arrow-right');
                const pts = r.points || r.point || 0;

                let dateDisplay = '-';
                try {
                    const dateObj = (r.dateObj instanceof Date && !isNaN(r.dateObj.getTime()))
                        ? r.dateObj
                        : (r.timestamp?.toDate ? r.timestamp.toDate() : (r.timestampIso ? new Date(r.timestampIso) : (r.date ? new Date(r.date) : (r.timestamp ? new Date(r.timestamp) : null))));
                    if (dateObj && !isNaN(dateObj.getTime())) {
                        dateDisplay = dateObj.toLocaleDateString('id-ID');
                    }
                } catch (e) {
                    console.warn('[Students] Gagal parse tanggal riwayat:', e);
                }

                return `
                 <div class="flex items-start gap-3 p-3 bg-${color}-50 dark:bg-${color}-950/30 rounded-lg border border-${color}-100 dark:border-${color}-900/50 mb-2 last:mb-0">
                     <div class="mt-1 text-${color}-500"><i class="fa-solid ${icon}"></i></div>
                     <div>
                         <p class="text-xs font-bold text-slate-700 dark:text-slate-200">${window.escapeHTML(cat)}</p>
                         <p class="text-[10px] text-slate-500 dark:text-slate-400">${dateDisplay} • ${window.escapeHTML(r.desc || '-')}</p>
                     </div>
                     ${(isV && pts) ? `<div class="ml-auto font-mono font-bold text-${color}-600 dark:text-${color}-400">+${pts}</div>` : ''}
                 </div>
                 `;
            }).join('');
        }
    }
}

function renderArchiveLogs(logs) {
    const attContainer = document.getElementById('attendance-list-container');

    if (attContainer) {
        if (!logs || logs.length === 0) {
            attContainer.innerHTML = `
            <div class="h-full flex flex-col justify-center items-center text-slate-400 text-center">
                <i class="fa-regular fa-folder-open text-3xl mb-2 opacity-30"></i>
                <p class="text-sm">Arsip kosong.</p>
            </div>`;
        } else {
            // COMPACT SINGLE LINE STYLE
            // Format: Date | [Badge] Status | Note
            attContainer.innerHTML = logs.map(logStr => {
                const parts = logStr.split(':');
                const datePart = parts[0] ? parts[0].trim() : '-'; // "YYYY-MM-DD"

                // Format Date nicely (e.g., 07 Jan)
                let dateDisplay = datePart;
                try {
                    const d = new Date(datePart);
                    dateDisplay = d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
                } catch (e) { }

                const contentPart = parts.slice(1).join(':') || '';
                const statusMatch = contentPart.match(/\((.)\)/);
                const status = statusMatch ? statusMatch[1] : '?';
                const note = contentPart.replace(/\(.\)/, '').trim();

                let badgeClass = "bg-slate-100 text-slate-700";
                if (status === 'S') badgeClass = "bg-blue-100 text-blue-700";
                else if (status === 'I') badgeClass = "bg-yellow-100 text-yellow-700";
                else if (status === 'A') badgeClass = "bg-red-100 text-red-700";
                else if (status === 'D') badgeClass = "bg-purple-100 text-purple-700";

                return `
                <div class="flex items-center gap-3 p-2 hover:bg-slate-50 border-b border-slate-100 last:border-0">
                     <div class="font-mono text-xs font-bold text-slate-500 w-12 shrink-0">${dateDisplay}</div>
                     <span class="w-6 h-6 flex items-center justify-center rounded text-[10px] font-bold ${badgeClass} shrink-0">
                        ${status}
                     </span>
                     <p class="text-[11px] text-slate-600 truncate">${window.escapeHTML(note)}</p>
                </div>`;
            }).join('');
        }
    }
}

function setupEventListeners() {
    document.getElementById('filter-class').addEventListener('change', (e) => {
        const val = e.target.value;
        const searchInput = document.getElementById('search-input');

        if (val === 'ALL') {
            loadAllStudents();
            searchInput.value = '';
        } else if (val) {
            loadStudentsByClass(val);
            searchInput.value = '';
        } else {
            document.getElementById('student-table-body').innerHTML = `<tr><td colspan="7" class="px-6 py-12 text-center text-slate-400">Silakan Pilih Kelas.</td></tr>`;
            studentsCache = [];
            searchInput.disabled = true;
            searchInput.placeholder = "Pilih kelas terlebih dahulu...";
        }
    });

    document.getElementById('search-input').addEventListener('input', (e) => {
        const keyword = e.target.value.trim();
        const currentClass = document.getElementById('filter-class').value;

        clearTimeout(searchTimeout);

        searchTimeout = setTimeout(() => {
            if (!keyword) {
                if (currentClass) renderTable(studentsCache);
                else document.getElementById('student-table-body').innerHTML = `<tr><td colspan="5" class="px-6 py-10 text-center text-slate-400">Silakan cari siswa...</td></tr>`;
                return;
            }

            if (currentClass) {
                // KASUS 1: Filter Lokal
                const lowerKey = keyword.toLowerCase();

                const filtered = studentsCache.filter(s => {
                    const sName = (s.name || '').toLowerCase();
                    const sNis = (s.nis || '').toString();
                    return sName.includes(lowerKey) || sNis.includes(lowerKey);
                });

                renderTable(filtered);
            } else {
                // KASUS 2: Search Global
                if (keyword.length >= 3) {
                    searchStudentsGlobal(keyword);
                }
            }
        }, 600);
    });

    // LISTENER TAMBAH SISWA
    document.getElementById('form-add-student').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.querySelector('button[form="form-add-student"]');
        const originalText = btn ? btn.innerText : 'Simpan Data';
        if (btn) { btn.disabled = true; btn.innerText = 'Menyimpan...'; }

        const formData = new FormData(e.target);
        const newData = Object.fromEntries(formData.entries());

        for (const key in newData) {
            if (typeof newData[key] === 'string') newData[key] = newData[key].trim();
        }
        if (newData.father_phone && !newData.phone_parent) {
            newData.phone_parent = newData.father_phone;
        }
        if (newData.email_siswa && !newData.email) {
            newData.email = newData.email_siswa;
        }
        newData.createdAt = serverTimestamp();

        // Validasi format 16 digit NIK/KK & keunikan (tidak boleh sama antara NIK Siswa, NIK Ortu, dan No KK)
        const addValidation = typeof validateStudentIdentityNumbers === 'function'
            ? validateStudentIdentityNumbers({
                nik: newData.nik,
                kk_no: newData.kk_no,
                father_nik: newData.father_nik,
                mother_nik: newData.mother_nik,
                guardian_nik: newData.guardian_nik
            })
            : (window.validateStudentIdentityNumbers ? window.validateStudentIdentityNumbers({
                nik: newData.nik,
                kk_no: newData.kk_no,
                father_nik: newData.father_nik,
                mother_nik: newData.mother_nik,
                guardian_nik: newData.guardian_nik
            }) : { valid: true });

        if (!addValidation.valid) {
            showModernAlert("Peringatan Validasi", addValidation.message, 'warning');
            if (btn) { btn.disabled = false; btn.innerText = originalText; }
            return;
        }

        try {
            if (!newData.nis) throw new Error("NIS wajib diisi!");

            if (cfClient && cfClient.enabled) {
                await cfClient.saveStudent(newData, false);
            }

            if (typeof window.logAudit === 'function') {
                window.logAudit('CREATE_STUDENT', String(newData.nis), null, newData, `Menambahkan siswa baru: ${newData.name} (${newData.class})`);
            }

            // TRIGGER SYNC METADATA & INVALIDATE CACHE
            if (cfClient && cfClient.enabled) {
                await cfClient.saveSystemSetting('metadata', { lastUpdateStudents: Date.now() });
            }
            if (typeof window.invalidateStudentsCache === 'function') {
                window.invalidateStudentsCache();
            }

            document.getElementById('modal-add').classList.add('hidden');
            e.target.reset();

            const currentClass = document.getElementById('filter-class').value;
            if (currentClass === 'ALL') loadAllStudents();
            else if (currentClass === newData.class) loadStudentsByClass(currentClass);

            showModernAlert("Berhasil", "Siswa berhasil disimpan dengan ID: " + newData.nis);

        } catch (err) {
            showModernAlert("Gagal", err.message, 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerText = originalText; }
        }
    });

    // LISTENER EDIT
    document.getElementById('form-edit-student').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.querySelector('button[form="form-edit-student"]');
        const originalText = btn ? btn.innerText : 'Simpan Perubahan';
        if (btn) { btn.disabled = true; btn.innerText = 'Menyimpan...'; }

        const formData = new FormData(e.target);
        const id = formData.get('id');

        const getTrimmed = (key) => {
            const v = formData.get(key);
            return (v !== null && v !== undefined) ? String(v).trim() : '';
        };

        const updates = {
            nisn: getTrimmed('nisn'),
            class: getTrimmed('class'),
            name: getTrimmed('name'),
            gender: formData.get('gender') || 'L',
            birthPlace: getTrimmed('birthPlace'),
            birthDate: getTrimmed('birthDate'),
            agama: getTrimmed('agama'),
            nik: getTrimmed('nik'),
            kk_no: getTrimmed('kk_no'),
            child_order: getTrimmed('child_order'),
            jml_saudara_kandung: getTrimmed('jml_saudara_kandung'),
            no_akta_lahir: getTrimmed('no_akta_lahir'),
            sekolah_asal: getTrimmed('sekolah_asal'),
            phone_siswa: getTrimmed('phone_siswa'),
            email_siswa: getTrimmed('email_siswa'),
            alamat: getTrimmed('alamat'),
            dusun: getTrimmed('dusun'),
            kelurahan: getTrimmed('kelurahan'),
            kecamatan: getTrimmed('kecamatan'),
            kode_pos: getTrimmed('kode_pos'),
            jenis_tinggal: getTrimmed('jenis_tinggal'),
            alat_transportasi: getTrimmed('alat_transportasi'),
            jarak_sekolah_km: getTrimmed('jarak_sekolah_km'),
            father: getTrimmed('father'),
            father_nik: getTrimmed('father_nik'),
            father_phone: getTrimmed('father_phone'),
            father_birth_year: getTrimmed('father_birth_year'),
            father_education: getTrimmed('father_education'),
            father_job: getTrimmed('father_job'),
            father_income: getTrimmed('father_income'),
            mother: getTrimmed('mother'),
            mother_nik: getTrimmed('mother_nik'),
            mother_phone: getTrimmed('mother_phone'),
            mother_birth_year: getTrimmed('mother_birth_year'),
            mother_education: getTrimmed('mother_education'),
            mother_job: getTrimmed('mother_job'),
            mother_income: getTrimmed('mother_income'),
            guardian: getTrimmed('guardian'),
            guardian_nik: getTrimmed('guardian_nik'),
            guardian_phone: getTrimmed('guardian_phone'),
            guardian_birth_year: getTrimmed('guardian_birth_year'),
            guardian_education: getTrimmed('guardian_education'),
            guardian_job: getTrimmed('guardian_job'),
            guardian_income: getTrimmed('guardian_income'),
            berat_badan: getTrimmed('berat_badan'),
            tinggi_badan: getTrimmed('tinggi_badan'),
            lingkar_kepala: getTrimmed('lingkar_kepala'),
            note: getTrimmed('note')
        };
        if (updates.father_phone) {
            updates.phone_parent = updates.father_phone;
        }
        if (updates.email_siswa) {
            updates.email = updates.email_siswa;
        }

        // Ambil data lama dari cache untuk audit trail & preservasi identitas pokok
        let oldData = null;
        if (typeof studentsCache !== 'undefined' && studentsCache) {
            oldData = studentsCache.find(s => String(s.id) === String(id) || String(s.nis) === String(id));
        }
        if (!oldData && typeof currentEditStudentData !== 'undefined' && currentEditStudentData) {
            oldData = currentEditStudentData;
        }

        // Preservasi identitas pokok jika field dibiarkan kosong saat hanya mengubah salah satu data
        if (!updates.name && oldData?.name) updates.name = oldData.name;
        if (!updates.class && oldData?.class) updates.class = oldData.class;
        if (!updates.gender && oldData?.gender) updates.gender = oldData.gender;

        // Validasi data kependudukan ramah parsial (allowPartial: true)
        const editValidation = typeof validateStudentIdentityNumbers === 'function'
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

        if (!editValidation.valid) {
            showToast("Peringatan Validasi", editValidation.message, "warning");
            if (btn) { btn.disabled = false; btn.innerText = originalText; }
            return;
        }

        try {

            if (cfClient && cfClient.enabled) {
                await cfClient.saveStudent({ ...updates, nis: id }, true);
            }

            if (typeof window.logAudit === 'function') {
                window.logAudit('UPDATE_STUDENT', id, oldData, updates, `Memperbarui data siswa: ${updates.name} (${updates.class})`);
            }

            // TRIGGER SYNC METADATA & INVALIDATE CACHE
            if (cfClient && cfClient.enabled) {
                await cfClient.saveSystemSetting('metadata', { lastUpdateStudents: Date.now() });
            }
            if (typeof window.invalidateStudentsCache === 'function') {
                window.invalidateStudentsCache();
            }

            const idx = studentsCache.findIndex(s => s.id === id);
            if (idx !== -1) {
                studentsCache[idx] = { ...studentsCache[idx], ...updates };
                renderTable(studentsCache);
            }

            document.getElementById('modal-edit').classList.add('hidden');

        } catch (err) {
            showToast("Gagal", "Gagal update: " + err.message, "error");
        } finally {
            if (btn) { btn.disabled = false; btn.innerText = originalText; }
        }
    });

    window.openEditStudent = async (id) => {
        let s = studentsCache.find(x => x.id === id || x.nis === id);
        if (!s) {
            try {
                if (cfClient && cfClient.enabled) {
                    const cfS = await cfClient.getStudentByNis(id);
                    if (cfS) { fillEditForm(id, cfS); return; }
                }
            } catch (e) {}
            if (typeof window.getStudentByNIS === 'function') {
                const cached = await window.getStudentByNIS(id);
                if (cached) { fillEditForm(id, cached); return; }
            }
        } else {
            fillEditForm(id, s);
        }
    };

    window.openMutateStudent = (id) => {
        window.openEditStudent(id);
        setTimeout(() => {
            const inputClass = document.getElementById('edit-class');
            if (inputClass) {
                inputClass.focus();
                inputClass.select();
            }
            if (typeof showToast === 'function') {
                showToast("Mutasi Siswa", "Ubah kolom kelas siswa menjadi 'MUTASI', 'PINDAH', atau 'KELUAR' untuk memutasi siswa ini.", "info");
            } else if (typeof showModernAlert === 'function') {
                showModernAlert("Mutasi Siswa", "Silakan ubah kelas siswa menjadi 'MUTASI', 'PINDAH', atau 'KELUAR' untuk memutasi siswa.");
            }
        }, 300);
    };

    function fillEditForm(id, s) {
        document.getElementById('edit-id').value = id;
        const setVal = (elmId, val) => {
            const el = document.getElementById(elmId);
            if (el) el.value = (val !== undefined && val !== null) ? val : '';
        };

        setVal('edit-nis', s.nis);
        setVal('edit-nisn', s.nisn);
        setVal('edit-class', s.class);
        setVal('edit-name', s.name);
        setVal('edit-gender', (String(s.gender || '').toUpperCase().startsWith('P')) ? 'P' : 'L');
        setVal('edit-birthPlace', s.birthPlace);
        setVal('edit-birthDate', s.birthDate);
        setVal('edit-agama', s.agama);
        setVal('edit-nik', s.nik);
        setVal('edit-kk_no', s.kk_no || s.kkNumber || s.no_kk);
        setVal('edit-child_order', s.child_order || s.childOrder);
        setVal('edit-jml_saudara_kandung', s.jml_saudara_kandung);
        setVal('edit-no_akta_lahir', s.no_akta_lahir);
        setVal('edit-sekolah_asal', s.sekolah_asal);
        setVal('edit-phone_siswa', s.phone_siswa || s.phone);
        setVal('edit-email_siswa', s.email_siswa || s.email);
        setVal('edit-alamat', s.alamat || s.address);
        setVal('edit-dusun', s.dusun);
        setVal('edit-kelurahan', s.kelurahan);
        setVal('edit-kecamatan', s.kecamatan);
        setVal('edit-kode_pos', s.kode_pos);
        setVal('edit-jenis_tinggal', s.jenis_tinggal);
        setVal('edit-alat_transportasi', s.alat_transportasi);
        setVal('edit-jarak_sekolah_km', s.jarak_sekolah_km);
        setVal('edit-father', s.father || s.fatherName);
        setVal('edit-father_nik', s.father_nik);
        setVal('edit-father_phone', s.father_phone || s.phone_parent);
        setVal('edit-father_birth_year', s.father_birth_year);
        setVal('edit-father_education', s.father_education);
        setVal('edit-father_job', s.father_job);
        setVal('edit-father_income', s.father_income);
        setVal('edit-mother', s.mother || s.motherName);
        setVal('edit-mother_nik', s.mother_nik);
        setVal('edit-mother_phone', s.mother_phone);
        setVal('edit-mother_birth_year', s.mother_birth_year);
        setVal('edit-mother_education', s.mother_education);
        setVal('edit-mother_job', s.mother_job);
        setVal('edit-mother_income', s.mother_income);
        setVal('edit-guardian', s.guardian);
        setVal('edit-guardian_nik', s.guardian_nik);
        setVal('edit-guardian_phone', s.guardian_phone);
        setVal('edit-guardian_birth_year', s.guardian_birth_year);
        setVal('edit-guardian_education', s.guardian_education);
        setVal('edit-guardian_job', s.guardian_job);
        setVal('edit-guardian_income', s.guardian_income);
        setVal('edit-berat_badan', s.berat_badan);
        setVal('edit-tinggi_badan', s.tinggi_badan);
        setVal('edit-lingkar_kepala', s.lingkar_kepala);
        setVal('edit-note', s.note);

        setupEditStudentPhotoSection(s);

        document.getElementById('modal-edit').classList.remove('hidden');
    }
}

let currentEditStudentData = null;

function setupEditStudentPhotoSection(s) {
    currentEditStudentData = s;
    const imgEl = document.getElementById('edit-student-photo-img');
    const placeholderEl = document.getElementById('edit-student-photo-placeholder');
    const badgeEl = document.getElementById('edit-student-photo-badge');
    const descEl = document.getElementById('edit-student-photo-desc');
    const btnDelete = document.getElementById('btn-delete-student-photo-admin');
    const btnUpload = document.getElementById('btn-upload-student-photo-admin');
    const btnUploadText = document.getElementById('btn-upload-student-photo-admin-text');

    const canUploadPhoto = window.hasRole ?
        (window.hasRole('super_admin') || window.hasRole('staff') || window.hasRole('kesiswaan') || window.hasRole('admin')) :
        ['super_admin', 'staff', 'kesiswaan', 'admin'].includes(localStorage.getItem('user_role'));

    if (btnUpload) {
        if (canUploadPhoto) btnUpload.classList.remove('hidden');
        else btnUpload.classList.add('hidden');
    }

    const photoUrl = s.activePhotoUrl || s.photo_url || s.photoUrl;

    if (btnUploadText) {
        btnUploadText.textContent = photoUrl ? 'Ganti Foto' : 'Unggah Foto';
    }

    if (photoUrl) {
        if (imgEl) {
            imgEl.src = photoUrl;
            imgEl.classList.remove('hidden');
        }
        if (placeholderEl) placeholderEl.classList.add('hidden');
        if (badgeEl) {
            badgeEl.textContent = 'Foto Aktif';
            badgeEl.className = 'px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-emerald-500 text-white';
        }
        if (descEl) descEl.textContent = 'Pasfoto resmi aktif di Kartu Pelajar Digital (E-KTS).';
        if (btnDelete) btnDelete.classList.remove('hidden');
    } else {
        if (imgEl) {
            imgEl.src = '';
            imgEl.classList.add('hidden');
        }
        if (placeholderEl) placeholderEl.classList.remove('hidden');
        if (badgeEl) {
            badgeEl.textContent = 'Belum Ada Foto';
            badgeEl.className = 'px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-slate-500 text-white';
        }
        if (descEl) descEl.textContent = 'Siswa belum memiliki pasfoto resmi di sistem Cloudflare R2.';
        if (btnDelete) btnDelete.classList.add('hidden');
    }

    // Async cek status D1 terkini jika online
    if (typeof cfClient !== 'undefined' && cfClient && cfClient.enabled && s.nis) {
        cfClient.getStudentPhotoInfo(s.nis).then(res => {
            if (res && res.success && res.data && currentEditStudentData?.nis === s.nis) {
                const liveActiveUrl = res.data.active_photo_url;
                if (liveActiveUrl) {
                    s.activePhotoUrl = liveActiveUrl;
                    if (imgEl) {
                        const fullUrl = liveActiveUrl.startsWith('http') ? liveActiveUrl : `${CLOUDFLARE_CONFIG?.WORKER_URL || ''}${liveActiveUrl}`;
                        imgEl.src = fullUrl;
                        imgEl.classList.remove('hidden');
                    }
                    if (placeholderEl) placeholderEl.classList.add('hidden');
                    if (badgeEl) {
                        badgeEl.textContent = 'Foto Aktif';
                        badgeEl.className = 'px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-emerald-500 text-white';
                    }
                    if (descEl) descEl.textContent = 'Pasfoto resmi aktif di Kartu Pelajar Digital (E-KTS).';
                    if (btnDelete) btnDelete.classList.remove('hidden');
                    if (btnUploadText) btnUploadText.textContent = 'Ganti Foto';
                } else {
                    s.activePhotoUrl = null;
                    if (imgEl) {
                        imgEl.src = '';
                        imgEl.classList.add('hidden');
                    }
                    if (placeholderEl) placeholderEl.classList.remove('hidden');
                    if (badgeEl) {
                        badgeEl.textContent = 'Belum Ada Foto';
                        badgeEl.className = 'px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-slate-500 text-white';
                    }
                    if (descEl) descEl.textContent = 'Siswa belum memiliki pasfoto resmi di sistem Cloudflare R2.';
                    if (btnDelete) btnDelete.classList.add('hidden');
                    if (btnUploadText) btnUploadText.textContent = 'Unggah Foto';
                }
            }
        }).catch(() => {});
    }
}

/**
 * Hapus Pasfoto Siswa oleh Super Admin / Admin
 * Dilengkapi dialog konfirmasi keamanan wajib mengetik kata 'HAPUS' (OWASP ASVS Destructive Guard)
 */
window.deleteStudentPhotoAdmin = async function () {
    if (!currentEditStudentData || !currentEditStudentData.nis) {
        if (typeof showToast === 'function') showToast('Peringatan', 'Data siswa tidak ditemukan.', 'warning');
        else alert('Data siswa tidak ditemukan.');
        return;
    }

    const studentName = currentEditStudentData.name || 'Siswa ini';
    const nis = currentEditStudentData.nis;
    let confirmed = false;

    if (typeof Swal !== 'undefined') {
        const { value: confirmText, isConfirmed } = await Swal.fire({
            title: 'Hapus Pasfoto Siswa?',
            html: `Tindakan ini akan menghapus pasfoto resmi <b>${escapeHTML(studentName)}</b> dari Cloudflare R2 dan kartu pelajar akan kembali ke avatar bawaan sekolah.<br><br><span class="text-xs text-rose-600 dark:text-rose-400 font-bold">Ketik kata <b>HAPUS</b> di bawah untuk mengonfirmasi:</span>`,
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

    const btnDelete = document.getElementById('btn-delete-student-photo-admin');
    if (btnDelete) {
        btnDelete.disabled = true;
        btnDelete.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Menghapus...';
    }

    try {
        if (!cfClient || !cfClient.enabled) {
            throw new Error('Layanan Cloudflare API tidak tersedia.');
        }

        const res = await cfClient.deleteStudentPhoto(nis);
        if (!res || res.success === false) {
            throw new Error(res?.error || 'Gagal menghapus pasfoto siswa.');
        }

        // Update local object & cache
        currentEditStudentData.activePhotoUrl = null;
        currentEditStudentData.pendingPhotoUrl = null;
        currentEditStudentData.photoStatus = 'none';

        const cachedStudent = studentsCache?.find(x => String(x.nis) === String(nis) || String(x.id) === String(nis));
        if (cachedStudent) {
            cachedStudent.activePhotoUrl = null;
            cachedStudent.pendingPhotoUrl = null;
            cachedStudent.photoStatus = 'none';
        }

        setupEditStudentPhotoSection(currentEditStudentData);

        if (typeof window.getStudentsCache === 'function') {
            window.getStudentsCache(true).catch(() => {});
        }

        if (typeof Swal !== 'undefined') {
            Swal.fire({
                icon: 'success',
                title: 'Pasfoto Dihapus',
                text: `Pasfoto resmi ${studentName} berhasil dihapus dari sistem.`,
                confirmButtonColor: '#059669',
                timer: 2000
            });
        } else if (typeof showToast === 'function') {
            showToast('Sukses', 'Pasfoto siswa berhasil dihapus.', 'success');
        } else {
            alert('Pasfoto siswa berhasil dihapus.');
        }

    } catch (err) {
        console.error('[AdminDeletePhoto Error]:', err);
        if (typeof Swal !== 'undefined') {
            Swal.fire({
                icon: 'error',
                title: 'Gagal Menghapus Foto',
                text: err.message || 'Terjadi kesalahan sistem.',
                confirmButtonColor: '#4f46e5'
            });
        } else {
            alert('Gagal menghapus pasfoto: ' + err.message);
        }
    } finally {
        if (btnDelete) {
            btnDelete.disabled = false;
            btnDelete.innerHTML = '<i class="fa-solid fa-trash-can text-xs"></i> Hapus Foto Siswa';
        }
    }
};

// =================================================================
// UNGGAH & GANTI PASFOTO SISWA OLEH STAF / ADMIN (AUTO-VERIFIED)
// =================================================================
let studentCropImage = null;
let studentCropZoom = 1;
let studentCropOffsetX = 0;
let studentCropOffsetY = 0;
let isDraggingStudentCrop = false;
let studentDragStartX = 0;
let studentDragStartY = 0;
let targetCropStudent = null;

window.openStudentPhotoCropModal = function (studentIdOrNis) {
    const userRole = localStorage.getItem('user_role');
    const canUpload = window.hasRole ?
        (window.hasRole('super_admin') || window.hasRole('staff') || window.hasRole('kesiswaan') || window.hasRole('admin')) :
        ['super_admin', 'staff', 'kesiswaan', 'admin'].includes(userRole);

    if (!canUpload) {
        if (typeof showToast === 'function') {
            showToast('Akses Ditolak', 'Hanya Staf Tata Usaha, Kesiswaan, dan Super Admin yang berhak mengunggah foto siswa.', 'error');
        } else {
            alert('Akses Ditolak: Anda tidak memiliki izin untuk mengunggah foto siswa.');
        }
        return;
    }

    let student = null;
    if (studentIdOrNis) {
        student = (typeof studentsCache !== 'undefined' ? studentsCache : []).find(s => s.id === studentIdOrNis || s.nis === studentIdOrNis);
    }
    if (!student) {
        student = currentEditStudentData;
    }
    if (!student || !student.nis) {
        if (typeof showToast === 'function') {
            showToast('Peringatan', 'Pilih siswa terlebih dahulu untuk mengunggah pasfoto.', 'warning');
        } else {
            alert('Pilih siswa terlebih dahulu.');
        }
        return;
    }

    targetCropStudent = student;
    studentCropImage = null;
    studentCropZoom = 1;
    studentCropOffsetX = 0;
    studentCropOffsetY = 0;

    const fileInput = document.getElementById('input-student-crop-file');
    if (fileInput) fileInput.value = '';

    const previewArea = document.getElementById('student-crop-preview-area');
    if (previewArea) previewArea.classList.add('hidden');

    const uploadStatus = document.getElementById('student-crop-upload-status');
    if (uploadStatus) uploadStatus.classList.add('hidden');

    const submitBtn = document.getElementById('btn-submit-student-crop-photo');
    if (submitBtn) submitBtn.disabled = true;

    const subtitleEl = document.getElementById('student-crop-subtitle');
    if (subtitleEl) {
        subtitleEl.textContent = `Pasfoto untuk ${student.name || 'Siswa'} (NIS: ${student.nis})`;
    }

    const modal = document.getElementById('modal-student-crop-photo');
    if (modal) modal.classList.remove('hidden');
};

window.closeStudentCropPhotoModal = function () {
    const modal = document.getElementById('modal-student-crop-photo');
    if (modal) modal.classList.add('hidden');
    studentCropImage = null;
};

window.handleStudentCropFileSelect = function (event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        if (typeof showToast === 'function') {
            showToast('Format Salah', 'File yang dipilih harus berupa file gambar (JPG/PNG/WebP).', 'warning');
        } else {
            alert('File yang dipilih harus berupa file gambar (JPG/PNG/WebP).');
        }
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            studentCropImage = img;
            studentCropZoom = 1;
            studentCropOffsetX = 0;
            studentCropOffsetY = 0;

            const previewArea = document.getElementById('student-crop-preview-area');
            const submitBtn = document.getElementById('btn-submit-student-crop-photo');
            if (previewArea) previewArea.classList.remove('hidden');
            if (submitBtn) submitBtn.disabled = false;

            const modal = document.getElementById('modal-student-crop-photo');
            if (modal) modal.classList.remove('hidden');

            initStudentCropDragging();
            drawStudentCropCanvas();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
};

function initStudentCropDragging() {
    const canvas = document.getElementById('student-crop-canvas');
    if (!canvas || canvas.dataset.dragInited) return;
    canvas.dataset.dragInited = 'true';

    canvas.addEventListener('mousedown', (e) => {
        isDraggingStudentCrop = true;
        studentDragStartX = e.clientX - studentCropOffsetX;
        studentDragStartY = e.clientY - studentCropOffsetY;
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDraggingStudentCrop) return;
        studentCropOffsetX = e.clientX - studentDragStartX;
        studentCropOffsetY = e.clientY - studentDragStartY;
        drawStudentCropCanvas();
    });

    window.addEventListener('mouseup', () => { isDraggingStudentCrop = false; });

    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            isDraggingStudentCrop = true;
            studentDragStartX = e.touches[0].clientX - studentCropOffsetX;
            studentDragStartY = e.touches[0].clientY - studentCropOffsetY;
        }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
        if (!isDraggingStudentCrop || e.touches.length !== 1) return;
        studentCropOffsetX = e.touches[0].clientX - studentDragStartX;
        studentCropOffsetY = e.touches[0].clientY - studentDragStartY;
        drawStudentCropCanvas();
    }, { passive: true });

    window.addEventListener('touchend', () => { isDraggingStudentCrop = false; });
    window.addEventListener('touchcancel', () => { isDraggingStudentCrop = false; });
}

function drawStudentCropCanvas() {
    const canvas = document.getElementById('student-crop-canvas');
    if (!canvas || !studentCropImage) return;

    canvas.width = 300;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const scale = Math.max(canvas.width / studentCropImage.width, canvas.height / studentCropImage.height) * studentCropZoom;
    const w = studentCropImage.width * scale;
    const h = studentCropImage.height * scale;
    const x = (canvas.width - w) / 2 + studentCropOffsetX;
    const y = (canvas.height - h) / 2 + studentCropOffsetY;

    ctx.drawImage(studentCropImage, x, y, w, h);
}

window.zoomStudentCropPhoto = function (delta) {
    studentCropZoom = Math.min(Math.max(0.5, studentCropZoom + delta), 3.0);
    drawStudentCropCanvas();
};

window.resetStudentCropPhoto = function () {
    studentCropZoom = 1;
    studentCropOffsetX = 0;
    studentCropOffsetY = 0;
    drawStudentCropCanvas();
};

window.submitStudentCroppedPhoto = async function () {
    const canvas = document.getElementById('student-crop-canvas');
    if (!canvas || !studentCropImage || !targetCropStudent || !targetCropStudent.nis) return;

    const btnSubmit = document.getElementById('btn-submit-student-crop-photo');
    const uploadStatus = document.getElementById('student-crop-upload-status');
    if (btnSubmit) btnSubmit.disabled = true;
    if (uploadStatus) uploadStatus.classList.remove('hidden');

    try {
        const base64Data = canvas.toDataURL('image/webp', 0.85);

        if (!cfClient || !cfClient.enabled) {
            throw new Error('Layanan Cloudflare API tidak tersedia.');
        }

        const result = await cfClient.uploadStudentPhoto({
            nis: targetCropStudent.nis,
            photoBase64: base64Data,
            format: 'webp',
            autoVerify: true
        });

        if (!result || !result.success) {
            throw new Error(result?.error || result?.message || 'Gagal menyimpan foto siswa.');
        }

        const newPhotoUrl = result.active_photo_url;
        targetCropStudent.activePhotoUrl = newPhotoUrl;
        targetCropStudent.photo_url = newPhotoUrl;
        targetCropStudent.photoUrl = newPhotoUrl;
        targetCropStudent.pendingPhotoUrl = null;
        if (result.public_token) {
            targetCropStudent.public_token = result.public_token;
            targetCropStudent.photoPublicToken = result.public_token;
        }

        // Perbarui di cache siswa
        if (typeof studentsCache !== 'undefined' && Array.isArray(studentsCache)) {
            const cachedIdx = studentsCache.findIndex(x => x.nis === targetCropStudent.nis || x.id === targetCropStudent.id);
            if (cachedIdx !== -1) {
                studentsCache[cachedIdx].activePhotoUrl = newPhotoUrl;
                studentsCache[cachedIdx].photo_url = newPhotoUrl;
                studentsCache[cachedIdx].photoUrl = newPhotoUrl;
            }
        }

        // Sinkronisasi ke modal KTS jika terbuka
        if (typeof currentKtsStudent !== 'undefined' && currentKtsStudent && currentKtsStudent.nis === targetCropStudent.nis) {
            currentKtsStudent.activePhotoUrl = newPhotoUrl;
            currentKtsStudent.photo_url = newPhotoUrl;
            currentKtsStudent.photoUrl = newPhotoUrl;
            if (typeof renderKtsPreviewCard === 'function') {
                renderKtsPreviewCard();
            }
        }

        // Refresh cache latar belakang
        if (typeof window.getStudentsCache === 'function') {
            window.getStudentsCache(true).catch(() => {});
        }

        // Perbarui tampilan di form modal edit jika sedang terbuka
        if (currentEditStudentData && currentEditStudentData.nis === targetCropStudent.nis) {
            setupEditStudentPhotoSection(targetCropStudent);
        }

        window.closeStudentCropPhotoModal();

        if (typeof showToast === 'function') {
            showToast('Sukses', 'Pasfoto resmi siswa berhasil diperbarui dan aktif.', 'success');
        } else {
            alert('Pasfoto resmi siswa berhasil diperbarui.');
        }
    } catch (err) {
        console.error('[StudentPhotoUpload]', err);
        const errMsg = err?.message || 'Gagal mengunggah foto siswa.';
        if (typeof showToast === 'function') {
            showToast('Gagal Unggah', errMsg, 'error');
        } else {
            alert('Gagal mengunggah foto: ' + errMsg);
        }
    } finally {
        if (btnSubmit) btnSubmit.disabled = false;
        if (uploadStatus) uploadStatus.classList.add('hidden');
    }
};


// --- OPTIMIZED GURU WALI FETCHING (BATCH + CACHE) ---
async function fetchGuruWaliForTable(students) {
    if (!students || students.length === 0) return;

    // 1. Identify what we need to fetch
    // Get unique NIS from current page
    const uniqueNIS = [...new Set(students.map(s => s.nis).filter(Boolean))];
    const toFetch = [];

    // 2. Render Cached Data Immediately & Build Fetch List
    uniqueNIS.forEach(nis => {
        let cached = GURU_WALI_CACHE.get(nis);
        if (cached === undefined && GURU_WALI_ALL_LOADED) {
            GURU_WALI_CACHE.set(nis, null);
            cached = null;
        }
        if (cached !== undefined) {
            // If cached (either name or null), update UI immediately
            updateGuruWaliCell(nis, cached);
        } else {
            // If not in cache, add to fetch list
            toFetch.push(nis);
        }
    });

    // If everything is cached, we are done! 0 Reads.
    if (toFetch.length === 0) return;

    // 3. Batch Fetch dari Cloudflare D1 SSOT (0 Firestore Read)
    try {
        if (cfClient && cfClient.enabled) {
            const uniqueClasses = [...new Set(students.map(s => s.class).filter(Boolean))];
            const isSingleClass = uniqueClasses.length === 1;
            const filterParam = isSingleClass ? { class: uniqueClasses[0] } : {};

            const assignments = await cfClient.getGuruWaliAssignments(filterParam);
            const assignMap = new Map();
            (assignments || []).forEach(a => {
                const sNis = String(a.student_nis || a.studentNis || a.nis || '').trim();
                if (sNis) {
                    const gName = a.guru_name || a.guruName || '-';
                    assignMap.set(sNis, gName);
                    GURU_WALI_CACHE.set(sNis, gName);
                }
            });

            if (!isSingleClass) {
                GURU_WALI_ALL_LOADED = true;
            }

            toFetch.forEach(nis => {
                const sNis = String(nis).trim();
                const guruName = assignMap.has(sNis) ? assignMap.get(sNis) : null;
                GURU_WALI_CACHE.set(nis, guruName);
                updateGuruWaliCell(nis, guruName);
            });
        }
    } catch (e) {
        console.error("Err fetch table GW from D1", e);
    }
}

function updateGuruWaliCell(nis, name) {
    const el = document.getElementById(`gw-${nis}`);
    if (!el) return;

    if (name) {
        el.innerText = name;
        el.classList.remove('italic', 'text-slate-400', 'text-xs');
        el.classList.add('text-sm', 'text-slate-700', 'font-medium', 'text-blue-600', 'dark:text-blue-400');
    } else {
        el.innerText = '-';
        el.classList.remove('italic');
    }
}

// --- URL PARAMETER HANDLING (AUTO OPEN FROM DASHBOARD/GURU WALI) ---
document.addEventListener('DOMContentLoaded', async () => {
    // Wait a bit for auth and other things to settle if needed, 
    // but usually calling openStudentDetail after table load is safer.
    // However, table load might take time. We can try to fetch directly if param exists.

    const urlParams = new URLSearchParams(window.location.search);
    const targetNIS = urlParams.get('nis');
    const action = urlParams.get('action');

    if (targetNIS && action === 'print') {
        console.log("Auto-opening print for NIS:", targetNIS);

        // Polling to wait for functions to be defined
        const checkReady = setInterval(() => {
            if (window.openStudentDetail && window.openPrintModal) {
                clearInterval(checkReady);

                // Fetch student data manually since table might not have it yet
                // Or just try to open if functions handle it. 
                // openStudentDetail expects a student OBJECT usually, or at least we need to find it in the loaded list.
                // CURRENT IMPLEMENTATION of openStudentDetail takes a STUDENT OBJECT (see line 2043: window.openStudentDetail = async function (student) ...)
                // We need to fetch the student first.

                // Let's modify openStudentDetail to accept NIS string OR object? 
                // Or just fetch here.

                fetchStudentAndOpen(targetNIS);
            }
        }, 500);
    }
});

async function fetchStudentAndOpen(nis) {
    try {
        let studentData = null;

        // Prioritas: Cloudflare D1
        if (cfClient && cfClient.enabled) {
            try {
                studentData = await cfClient.getStudentByNis(nis);
            } catch (e) {}
        }

        // Prioritas 2: Global / Local Cache
        if (!studentData && typeof window.getStudentByNIS === 'function') {
            studentData = await window.getStudentByNIS(nis);
        }

        if (studentData) {
            await window.openStudentDetail(studentData);

            // Open Print Modal slightly after
            setTimeout(() => {
                if (window.openPrintModal) window.openPrintModal();
            }, 1000);
        } else {
            console.warn("Siswa not found for auto-print:", nis);
        }
    } catch (e) {
        console.error("Error auto-opening student:", e);
    }
}

// ==========================================
// --- FITUR MIGRASI NIS SISWA (SUPER ADMIN) ---
// ==========================================

let migrateStudentsList = [];
let selectedMigrateStudent = null;

// Helper: Custom Confirm Modal untuk Siswa Page
function showConfirmModal(message, title = 'Konfirmasi', type = 'warning') {
    return new Promise((resolve) => {
        const modal = document.getElementById('modal-generic-confirm');
        if (!modal) {
            if (typeof window.showConfirmModal === 'function' && window.showConfirmModal !== showConfirmModal) {
                return resolve(window.showConfirmModal(message, title, type));
            }
            resolve(false);
            return;
        }

        const iconBg = document.getElementById('confirm-icon-bg');
        const icon = document.getElementById('confirm-icon');
        const titleEl = document.getElementById('confirm-title');
        const msgEl = document.getElementById('confirm-msg');
        const btnOk = document.getElementById('btn-confirm-ok');
        const btnCancel = document.getElementById('btn-confirm-cancel');

        if (type === 'danger') {
            iconBg.className = "w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4 text-red-600";
            icon.className = "fa-solid fa-trash text-3xl";
            btnOk.className = "px-5 py-2.5 rounded-lg font-bold text-white bg-red-600 hover:bg-red-700 shadow-lg transition-transform active:scale-95";
        } else {
            iconBg.className = "w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4 text-amber-600";
            icon.className = "fa-solid fa-question text-3xl";
            btnOk.className = "px-5 py-2.5 rounded-lg font-bold text-white bg-amber-600 hover:bg-amber-700 shadow-lg transition-transform active:scale-95";
        }

        titleEl.innerText = title;
        msgEl.innerHTML = message;
        modal.classList.remove('hidden');

        // Reset listener
        const newBtnOk = btnOk.cloneNode(true);
        const newBtnCancel = btnCancel.cloneNode(true);
        btnOk.parentNode.replaceChild(newBtnOk, btnOk);
        btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);

        newBtnOk.addEventListener('click', () => {
            modal.classList.add('hidden');
            resolve(true);
        });

        newBtnCancel.addEventListener('click', () => {
            modal.classList.add('hidden');
            resolve(false);
        });
    });
}

// 1. Logika Switch Tab
window.switchStudentTab = (tabName) => {
    const tabList = document.getElementById('tab-student-list');
    const tabMigrate = document.getElementById('tab-student-migrate');
    const btnList = document.getElementById('tab-btn-list');
    const btnMigrate = document.getElementById('tab-btn-migrate');

    if (tabName === 'list') {
        if (tabList) tabList.classList.remove('hidden');
        if (tabList) tabList.classList.add('block');
        if (tabMigrate) tabMigrate.classList.remove('block');
        if (tabMigrate) tabMigrate.classList.add('hidden');

        if (btnList) btnList.className = "pb-3 text-sm font-bold border-b-2 border-blue-600 text-blue-600 transition-all";
        if (btnMigrate) btnMigrate.className = "pb-3 text-sm font-bold border-b-2 border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300 transition-all";
    } else {
        window.clearMigrateSelection();

        if (tabList) tabList.classList.remove('block');
        if (tabList) tabList.classList.add('hidden');
        if (tabMigrate) tabMigrate.classList.remove('hidden');
        if (tabMigrate) tabMigrate.classList.add('block');

        if (btnList) btnList.className = "pb-3 text-sm font-bold border-b-2 border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300 transition-all";
        if (btnMigrate) btnMigrate.className = "pb-3 text-sm font-bold border-b-2 border-blue-600 text-blue-600 transition-all";
    }
};

// 2. Logika Pemilihan & Autocomplete Siswa Migrasi
window.initMigrateStudentList = async () => {
    const dropdown = document.getElementById('migrate-student-dropdown');
    if (!dropdown) return;
    dropdown.innerHTML = `<div class="p-3 text-xs text-slate-500 dark:text-slate-400 text-center"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Memuat data siswa...</div>`;
    dropdown.classList.remove('hidden');

    try {
        migrateStudentsList = await window.getStudentsCache();
        renderMigrateStudentDropdown(migrateStudentsList.slice(0, 10));
    } catch (e) {
        console.error("Gagal memuat daftar siswa untuk migrasi:", e);
        dropdown.innerHTML = `<div class="p-3 text-xs text-red-500 text-center">Gagal memuat data: ${e.message}</div>`;
    }
};

window.filterMigrateStudentList = (keyword) => {
    const kw = String(keyword || '').trim().toLowerCase();
    const dropdown = document.getElementById('migrate-student-dropdown');
    if (!dropdown) return;

    if (!kw) {
        renderMigrateStudentDropdown(migrateStudentsList.slice(0, 10));
        return;
    }

    const filtered = migrateStudentsList.filter(s => {
        return String(s.nis || '').toLowerCase().includes(kw) || 
               String(s.name || '').toLowerCase().includes(kw) || 
               String(s.class || '').toLowerCase().includes(kw);
    });

    renderMigrateStudentDropdown(filtered.slice(0, 20));
};

function renderMigrateStudentDropdown(list) {
    const dropdown = document.getElementById('migrate-student-dropdown');
    if (!dropdown) return;

    if (list.length === 0) {
        dropdown.innerHTML = `<div class="p-3 text-xs text-slate-400 italic text-center">Siswa tidak ditemukan</div>`;
        return;
    }

    let html = '';
    list.forEach(s => {
        html += `
        <div onclick="window.selectMigrateStudent('${s.nis}')" 
            class="px-4 py-2.5 hover:bg-blue-50 dark:hover:bg-slate-700/50 cursor-pointer text-sm text-slate-700 dark:text-slate-200 border-b border-slate-100 dark:border-slate-700/50 last:border-b-0 flex items-center justify-between">
            <div>
                <span class="font-bold text-slate-900 dark:text-white">${window.escapeHTML(s.name)}</span>
                <span class="text-xs text-slate-500 dark:text-slate-400 ml-1">(${window.escapeHTML(s.class)})</span>
            </div>
            <span class="font-mono text-xs text-blue-600 dark:text-blue-400 font-semibold">${window.escapeHTML(s.nis)}</span>
        </div>`;
    });
    dropdown.innerHTML = html;
}

window.selectMigrateStudent = (nis) => {
    const student = migrateStudentsList.find(s => String(s.nis) === String(nis));
    if (!student) return;

    selectedMigrateStudent = student;
    
    const infoBox = document.getElementById('migrate-selected-info');
    if (infoBox) {
        infoBox.innerHTML = `
            <div class="flex items-center justify-between">
                <div>
                    <p class="font-bold text-slate-900 dark:text-white">Siswa Terpilih:</p>
                    <p class="text-xs mt-0.5 text-slate-700 dark:text-slate-300">Nama: <span class="font-semibold">${window.escapeHTML(student.name)}</span></p>
                    <p class="text-xs text-slate-700 dark:text-slate-300">Kelas: <span class="font-semibold">${window.escapeHTML(student.class)}</span></p>
                    <p class="text-xs text-slate-700 dark:text-slate-300">NIS Sementara: <span class="font-mono font-bold text-blue-600 dark:text-blue-400">${window.escapeHTML(student.nis)}</span></p>
                </div>
                <button onclick="window.clearMigrateSelection()" class="text-xs text-red-500 hover:underline">Batal</button>
            </div>
        `;
        infoBox.classList.remove('hidden');
    }

    const searchInput = document.getElementById('input-migrate-student-search');
    if (searchInput) searchInput.value = `${student.name} (${student.class})`;
    
    const dropdown = document.getElementById('migrate-student-dropdown');
    if (dropdown) dropdown.classList.add('hidden');

    const inputNewNIS = document.getElementById('input-new-nis');
    if (inputNewNIS) {
        inputNewNIS.disabled = false;
        inputNewNIS.value = '';
        inputNewNIS.focus();

        inputNewNIS.oninput = () => {
            const val = inputNewNIS.value.trim();
            const btn = document.getElementById('btn-exec-migrate-nis');
            if (btn) btn.disabled = !(val && /^\d+$/.test(val) && val.length >= 4);
        };
    }
};

window.clearMigrateSelection = () => {
    selectedMigrateStudent = null;
    const infoBox = document.getElementById('migrate-selected-info');
    if (infoBox) infoBox.classList.add('hidden');
    
    const searchInput = document.getElementById('input-migrate-student-search');
    if (searchInput) searchInput.value = '';
    
    const inputNewNIS = document.getElementById('input-new-nis');
    if (inputNewNIS) {
        inputNewNIS.disabled = true;
        inputNewNIS.value = '';
    }
    
    const btn = document.getElementById('btn-exec-migrate-nis');
    if (btn) btn.disabled = true;
};

// Tutup dropdown autocomplete jika klik di luar input
document.addEventListener('click', (e) => {
    const searchInput = document.getElementById('input-migrate-student-search');
    const dropdown = document.getElementById('migrate-student-dropdown');
    if (searchInput && dropdown && !searchInput.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.add('hidden');
    }
});

// 3. Helper Internal Migrasi NIS (Single)
async function performSingleMigration(oldNIS, newNIS, studentName, studentClass) {
    // --- STEP 0: VALIDASI RBAC SUPER ADMIN (Defense in Depth) ---
    const isSuperAdminExec = (window.hasRole ? window.hasRole('super_admin') : false) || 
                             (localStorage.getItem('user_role') === 'super_admin');
    if (!isSuperAdminExec) {
        throw new Error('Akses ditolak. Hanya Super Admin yang berwenang melakukan migrasi NIS.');
    }

    // --- STEP 1: VALIDASI KEUNIKAN NIS BARU ---
    let existingNewStudent = null;
    if (cfClient && cfClient.enabled) {
        try {
            existingNewStudent = await cfClient.getStudentByNis(newNIS);
        } catch (e) {}
    }
    if (!existingNewStudent && typeof window.getStudentByNIS === 'function') {
        existingNewStudent = await window.getStudentByNIS(newNIS);
    }
    if (existingNewStudent) {
        throw new Error(`NIS Resmi "${newNIS}" sudah terdaftar atas nama siswa: ${existingNewStudent.name || newNIS}`);
    }

    // --- STEP 2: DUPLIKASI DATA DI KOLEKSI DENGAN DOC ID = NIS ---
    
    // A. students (Cloudflare D1 Primary)
    let studentData = null;
    if (cfClient && cfClient.enabled) {
        try {
            studentData = await cfClient.getStudentByNis(oldNIS);
        } catch (e) {}
    }
    if (!studentData && typeof window.getStudentByNIS === 'function') {
        studentData = await window.getStudentByNIS(oldNIS);
    }
    if (!studentData) {
        throw new Error(`Data master siswa dengan NIS ${oldNIS} tidak ditemukan di database.`);
    }
    const studentDataNew = {
        ...studentData,
        nis: newNIS,
        updatedAt: new Date().toISOString()
    };

    // --- STEP 2.5: PINDAHKAN SELURUH DATA RELASI DI CLOUDFLARE D1 SSOT ---
    try {
        if (cfClient && cfClient.enabled) {
            await Promise.all([
                cfClient.moveStudentRecordsNIS(oldNIS, newNIS),
                cfClient.moveBkActionsNIS(oldNIS, newNIS),
                cfClient.movePerwalianNIS(oldNIS, newNIS),
                cfClient.moveWalikelasNotesNIS(oldNIS, newNIS),
                cfClient.movePermisiNIS(oldNIS, newNIS),
                cfClient.moveRaporScoresNIS(oldNIS, newNIS),
                cfClient.movePeminatanResponseNIS(oldNIS, newNIS),
                cfClient.moveJurnalPresensiNIS(oldNIS, newNIS),
                cfClient.moveNotificationTokensNIS(oldNIS, newNIS)
            ]);
            console.log(`[Migration] All Cloudflare D1 tables NIS migrated: ${oldNIS} -> ${newNIS}`);
        }
    } catch (cfErr) {
        console.warn('[Migration] Gagal move NIS di Cloudflare D1:', cfErr);
    }

    // --- STEP 3: UPDATE HISTORI MUTASI KELAS & AKUN SISWA (FIRESTORE) ---
    const classTransferDocs = [];
    const transferDataList = [];
    try {
        const qTransfers = query(collection(db, 'class_transfers'), where('nis', '==', oldNIS));
        const snapTransfers = await getDocs(qTransfers);
        snapTransfers.forEach(docSnap => {
            classTransferDocs.push(docSnap.ref);
            transferDataList.push(docSnap.data());
        });
    } catch (eTransfer) {
        console.warn('[Migration] Query class_transfers warning:', eTransfer);
    }

    // Cek apakah ada akun pengguna / pengurus siswa di Firestore users
    const userDocsToUpdate = [];
    try {
        const qUsersNis = query(collection(db, PATHS.users), where('nis', '==', oldNIS));
        const snapUsersNis = await getDocs(qUsersNis);
        snapUsersNis.forEach(docSnap => userDocsToUpdate.push(docSnap.ref));
    } catch (eUser) {
        console.warn('[Migration] Query users NIS warning:', eUser);
    }

    // Cek sesi siswa di student_sessions jika ada
    const studentSessionDocs = [];
    try {
        const qSessions = query(collection(db, 'student_sessions'), where('nis', '==', oldNIS));
        const snapSessions = await getDocs(qSessions);
        snapSessions.forEach(docSnap => studentSessionDocs.push(docSnap.ref));
    } catch (eSession) {
        console.warn('[Migration] Query student_sessions warning:', eSession);
    }

    // --- STEP 4: EKSEKUSI PENULISAN BATCH FIRESTORE (Log Mutasi, User, Session & Sync Metadata) ---
    const batches = [];
    let currentBatch = writeBatch(db);
    let opCount = 0;

    const addOp = (fn) => {
        fn(currentBatch);
        opCount++;
        if (opCount >= 400) {
            batches.push(currentBatch);
            currentBatch = writeBatch(db);
            opCount = 0;
        }
    };

    // Update referensi NIS pada log mutasi kelas
    classTransferDocs.forEach(ref => addOp(batch => batch.update(ref, { nis: newNIS })));
    // Update referensi NIS pada akun pengguna Firestore
    userDocsToUpdate.forEach(ref => addOp(batch => batch.update(ref, { nis: newNIS })));
    // Update referensi NIS pada sesi siswa
    studentSessionDocs.forEach(ref => addOp(batch => batch.update(ref, { nis: newNIS })));

    // Jalankan batch Firestore jika ada dokumen yang diperbarui
    if (opCount > 0) batches.push(currentBatch);
    for (const batch of batches) {
        await batch.commit();
    }

    // Sync metadata lastUpdateStudents ke Cloudflare D1 (0 Firestore Write)
    if (window.cfClient && window.cfClient.enabled) {
        try {
            await window.cfClient.saveSystemSetting('metadata', {
                lastUpdateStudents: Date.now()
            });
        } catch (eMeta) {
            console.warn('[Migration] Gagal sync metadata ke D1:', eMeta);
        }
    }

    // --- STEP 5: EKSEKUSI DI SUPABASE (SSOT) ---
    const sbClient = supabase || window.supabase;
    if (!sbClient) throw new Error('Supabase client belum siap');
    
    // A. Update voting Duta SHAKTI
    try {
        const { error: sbError } = await sbClient
            .from('duta_suara_masuk')
            .update({ nis_pemilih: newNIS })
            .eq('nis_pemilih', oldNIS);
        if (sbError) console.warn('[Migration Supabase] Duta suara warning:', sbError.message);
    } catch (e) {
        console.warn('[Migration Supabase] Duta suara exception:', e.message);
    }

    // B. Update NIS di tabel Penilaian Guru Mapel (Scores - Rincian Nilai)
    try {
        const { error: sbScoresErr } = await sbClient
            .from('guru_mapel_scores')
            .update({ student_nis: newNIS })
            .eq('student_nis', oldNIS);
        if (sbScoresErr) console.warn('[Migration Supabase] Guru mapel scores warning:', sbScoresErr.message);
    } catch (e) {
        console.warn('[Migration Supabase] Guru mapel scores exception:', e.message);
    }

    // C. Update NIS di tabel Penilaian Guru Mapel (Summaries - Rangkuman & CP)
    try {
        const { error: sbSummariesErr } = await sbClient
            .from('guru_mapel_summaries')
            .update({ student_nis: newNIS })
            .eq('student_nis', oldNIS);
        if (sbSummariesErr) console.warn('[Migration Supabase] Guru mapel summaries warning:', sbSummariesErr.message);
    } catch (e) {
        console.warn('[Migration Supabase] Guru mapel summaries exception:', e.message);
    }

    // D. Update NIS di tabel Keuangan (finance_transactions)
    try {
        const { data: txList, error: txFetchErr } = await sbClient
            .from('finance_transactions')
            .select('*')
            .eq('student_nis', oldNIS);

        if (txFetchErr) {
            console.warn('[Migration Supabase] Finance fetch warning:', txFetchErr.message);
        } else if (txList && txList.length > 0) {
            const updatedTxs = txList.map(tx => ({
                ...tx,
                id: `${newNIS}_${tx.year}_${tx.month}`,
                student_nis: newNIS,
                updated_at: new Date().toISOString()
            }));

            // Upsert records dengan ID baru
            const { error: txUpsertErr } = await sbClient.from('finance_transactions').upsert(updatedTxs, { onConflict: 'id' });
            if (txUpsertErr) {
                console.warn('[Migration Supabase] Finance upsert warning:', txUpsertErr.message);
            } else {
                // Hapus record lama
                const oldIds = txList.map(tx => tx.id);
                const { error: txDelErr } = await sbClient.from('finance_transactions').delete().in('id', oldIds);
                if (txDelErr) console.warn('[Migration Supabase] Finance delete old warning:', txDelErr.message);
            }
        }
    } catch (e) {
        console.warn('[Migration Supabase] Finance exception:', e.message);
    }

    // E. Update NIS di tabel Presensi Siswa (siswa_presensi)
    try {
        const { error: sbPresensiErr } = await sbClient
            .from('siswa_presensi')
            .update({ student_nis: newNIS, updated_at: new Date().toISOString() })
            .eq('student_nis', oldNIS);
        if (sbPresensiErr) console.warn('[Migration Supabase] Presensi warning:', sbPresensiErr.message);
    } catch (e) {
        console.warn('[Migration Supabase] Presensi exception:', e.message);
    }

    // F. Update NIS di tabel Perpustakaan: Sirkulasi Peminjaman (lib_sirkulasi)
    try {
        const { error: sbSirkulasiErr } = await sbClient
            .from('lib_sirkulasi')
            .update({ peminjam_id: newNIS, updated_at: new Date().toISOString() })
            .eq('peminjam_type', 'siswa')
            .eq('peminjam_id', oldNIS);
        if (sbSirkulasiErr) console.warn('[Migration Supabase] Lib sirkulasi warning:', sbSirkulasiErr.message);
    } catch (e) {
        console.warn('[Migration Supabase] Lib sirkulasi exception:', e.message);
    }

    // G. Update NIS di tabel Perpustakaan: Buku Tamu Pengunjung (lib_pengunjung)
    try {
        const { error: sbPengunjungErr } = await sbClient
            .from('lib_pengunjung')
            .update({ identitas_id: newNIS })
            .eq('tipe_pengunjung', 'siswa')
            .eq('identitas_id', oldNIS);
        if (sbPengunjungErr) console.warn('[Migration Supabase] Lib pengunjung warning:', sbPengunjungErr.message);
    } catch (e) {
        console.warn('[Migration Supabase] Lib pengunjung exception:', e.message);
    }

    // H. Update NIS di tabel Perpustakaan: Surat Bebas Pustaka (lib_bebas_pustaka)
    try {
        const { error: sbBebasPustakaErr } = await sbClient
            .from('lib_bebas_pustaka')
            .update({ student_nis: newNIS })
            .eq('student_nis', oldNIS);
        if (sbBebasPustakaErr) console.warn('[Migration Supabase] Lib bebas pustaka warning:', sbBebasPustakaErr.message);
    } catch (e) {
        console.warn('[Migration Supabase] Lib bebas pustaka exception:', e.message);
    }

    // I. Update NIS di tabel Masukan & Saran (masukkan_saran)
    try {
        const { error: sbSaranErr } = await sbClient
            .from('masukkan_saran')
            .update({ sender_uid: newNIS })
            .eq('sender_role', 'siswa')
            .eq('sender_uid', oldNIS);
        if (sbSaranErr) console.warn('[Migration Supabase] Masukan saran warning:', sbSaranErr.message);
    } catch (e) {
        console.warn('[Migration Supabase] Masukan saran exception:', e.message);
    }

    // --- STEP 6: SINKRONISASI MASTER SISWA DI CLOUDFLARE D1 (SSOT) ---
    if (cfClient && cfClient.enabled) {
        try {
            await cfClient.deleteStudent(oldNIS);
            await cfClient.saveStudent({ ...studentDataNew, nis: newNIS });
            console.log(`[Migration] Master student moved in D1: ${oldNIS} -> ${newNIS}`);
        } catch (cfErr) {
            console.warn('[Migration] Cloudflare D1 master student sync warning:', cfErr);
            throw new Error(`Gagal memperbarui master siswa di Cloudflare D1: ${cfErr.message}`);
        }
    }

    // --- STEP 7: AUDIT LOG ---
    if (typeof window.logAudit === 'function') {
        window.logAudit('MIGRATE_STUDENT_NIS', newNIS, { oldNIS }, { newNIS }, `Migrasi NIS Siswa ${studentName} dari ${oldNIS} ke ${newNIS} secara komprehensif`);
    }
}

// 4. Fungsi Utama Migrasi NIS (Single)
window.executeMigrateNIS = async () => {
    if (!selectedMigrateStudent) return;

    // RBAC Guard: Hanya Super Admin yang boleh eksekusi migrasi NIS
    const isSuperAdminExec = (window.hasRole ? window.hasRole('super_admin') : false) || 
                             (localStorage.getItem('user_role') === 'super_admin');
    if (!isSuperAdminExec) {
        showToast('Akses Ditolak', 'Hanya Super Admin yang dapat menjalankan migrasi NIS.', 'error');
        return;
    }
    
    const oldNIS = String(selectedMigrateStudent.nis).trim();
    const newNIS = document.getElementById('input-new-nis').value.trim();
    const studentClass = String(selectedMigrateStudent.class || '').trim();

    if (!newNIS) return showToast('Peringatan', 'Masukkan NIS Baru.', 'warning');
    if (!/^\d+$/.test(newNIS)) return showToast('Peringatan', 'NIS Baru wajib berupa angka saja.', 'warning');
    if (newNIS.length < 4) return showToast('Peringatan', 'NIS Baru minimal 4 karakter.', 'warning');
    if (oldNIS === newNIS) return showToast('Peringatan', 'NIS Baru harus berbeda dengan NIS Lama.', 'warning');

    const confirmed = await showConfirmModal(
        `<div class="text-left text-sm space-y-2">
            <p>Siswa: <b>${window.escapeHTML(selectedMigrateStudent.name)}</b></p>
            <p>Dari NIS Sementara: <b class="text-blue-600 font-mono">${window.escapeHTML(oldNIS)}</b></p>
            <p>Ke NIS Resmi Baru: <b class="text-green-600 font-mono">${window.escapeHTML(newNIS)}</b></p>
            <p class="text-xs text-red-500 font-semibold mt-3">
                <i class="fa-solid fa-triangle-exclamation mr-1"></i> PENTING - PEMINDAHAN MENYELURUH (3 DATABASE):<br>
                Tindakan ini akan memindahkan master data siswa Dapodik (Cloudflare D1), catatan disiplin BK & agregat poin, catatan perwalian wali kelas & guru wali, alur permisi, nilai E-Rapor & respon kuesioner peminatan (D1), presensi jurnal mengajar guru (D1), token notifikasi/passkey (D1), riwayat presensi harian siswa (Supabase), penilaian rincian & CP guru mapel (Supabase), transaksi iuran SPP (Supabase), voting Duta CERDAS (Supabase), sirkulasi peminjaman, buku tamu & bebas pustaka Perpustakaan (Supabase), aspirasi/masukan saran (Supabase), serta histori mutasi & akun login pengurus (Firestore).
            </p>
        </div>`,
        'Konfirmasi Migrasi NIS Menyeluruh',
        'warning'
    );
    if (!confirmed) return;

    const btnExec = document.getElementById('btn-exec-migrate-nis');
    const originalText = btnExec.innerHTML;
    btnExec.disabled = true;
    btnExec.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> Memproses...`;

    try {
        await performSingleMigration(oldNIS, newNIS, selectedMigrateStudent.name, studentClass);

        // Invalidate Local Cache
        window.invalidateStudentsCache();
        if (typeof window.invalidateStudentAggregatesCache === 'function') {
            window.invalidateStudentAggregatesCache();
        }
        try {
            localStorage.removeItem('simas_kelas_list_cache');
            localStorage.removeItem('simas_show_alumni_cache');
        } catch (e) {}

        showModernAlert("Sukses Migrasi", `NIS Siswa <b>${window.escapeHTML(selectedMigrateStudent.name)}</b> berhasil dipindahkan secara sempurna ke seluruh basis data:<br>Dari <b>${oldNIS}</b> ke <b>${newNIS}</b>.`);
        window.clearMigrateSelection();
        window.switchStudentTab('list');

    } catch (error) {
        console.error("Migration Error:", error);
        showModernAlert("Gagal Migrasi", error.message, 'error');
    } finally {
        btnExec.disabled = false;
        btnExec.innerHTML = originalText;
    }
};

// 4.1. Toggle Tooltip Info Penjelasan Migrasi NIS
window.toggleMigrateInfoTooltip = (e) => {
    if (e) {
        e.stopPropagation();
        e.preventDefault();
    }
    const tooltip = document.getElementById('tooltip-migrate-info');
    if (!tooltip) return;
    const isHidden = tooltip.classList.contains('invisible') || tooltip.style.visibility === 'hidden' || (typeof window !== 'undefined' && window.getComputedStyle && window.getComputedStyle(tooltip).visibility === 'hidden');
    if (isHidden) {
        tooltip.classList.remove('invisible', 'opacity-0', 'pointer-events-none');
        tooltip.classList.add('visible', 'opacity-100', 'pointer-events-auto');
        tooltip.style.visibility = 'visible';
        tooltip.style.opacity = '1';
        tooltip.style.pointerEvents = 'auto';
    } else {
        tooltip.classList.remove('visible', 'opacity-100', 'pointer-events-auto');
        tooltip.classList.add('invisible', 'opacity-0', 'pointer-events-none');
        tooltip.style.visibility = '';
        tooltip.style.opacity = '';
        tooltip.style.pointerEvents = '';
    }
};

// Listener global untuk menutup tooltip saat klik di luar atau tombol Escape
if (typeof document !== 'undefined') {
    document.addEventListener('click', (e) => {
        const tooltip = document.getElementById('tooltip-migrate-info');
        const btn = document.getElementById('btn-migrate-info-tooltip');
        if (tooltip && btn && !btn.contains(e.target) && !tooltip.contains(e.target)) {
            tooltip.classList.remove('visible', 'opacity-100', 'pointer-events-auto');
            tooltip.classList.add('invisible', 'opacity-0', 'pointer-events-none');
            tooltip.style.visibility = '';
            tooltip.style.opacity = '';
            tooltip.style.pointerEvents = '';
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const tooltip = document.getElementById('tooltip-migrate-info');
            if (tooltip) {
                tooltip.classList.remove('visible', 'opacity-100', 'pointer-events-auto');
                tooltip.classList.add('invisible', 'opacity-0', 'pointer-events-none');
                tooltip.style.visibility = '';
                tooltip.style.opacity = '';
                tooltip.style.pointerEvents = '';
            }
        }
    });
}

// 5. Fungsi Switch Mode Migrasi
window.switchMigrateMode = (mode) => {
    const btnSingle = document.getElementById('btn-migrate-mode-single');
    const btnBulk = document.getElementById('btn-migrate-mode-bulk');
    const containerSingle = document.getElementById('migrate-single-container');
    const containerBulk = document.getElementById('migrate-bulk-container');

    if (mode === 'single') {
        if (btnSingle) btnSingle.className = "text-xs font-bold text-blue-600 border-b-2 border-blue-600 pb-1.5 transition-all";
        if (btnBulk) btnBulk.className = "text-xs font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 pb-1.5 transition-all";
        if (containerSingle) containerSingle.classList.remove('hidden');
        if (containerBulk) containerBulk.classList.add('hidden');
    } else {
        if (btnSingle) btnSingle.className = "text-xs font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 pb-1.5 transition-all";
        if (btnBulk) btnBulk.className = "text-xs font-bold text-blue-600 border-b-2 border-blue-600 pb-1.5 transition-all";
        if (containerSingle) containerSingle.classList.add('hidden');
        if (containerBulk) containerBulk.classList.remove('hidden');
        
        window.initMigrateStudentList();
    }
};

// 6. Fungsi Preview Migrasi Massal
let tempMigrateBulkData = [];

window.previewMigrateBulk = async () => {
    const pasteArea = document.getElementById('import-migrate-bulk-paste');
    const rawText = pasteArea ? pasteArea.value.trim() : '';
    if (!rawText) {
        return showToast('Peringatan', 'Masukkan data terlebih dahulu.', 'warning');
    }

    const previewContainer = document.getElementById('migrate-bulk-preview-container');
    const previewBody = document.getElementById('migrate-bulk-preview-body');
    const btnExec = document.getElementById('btn-exec-migrate-nis-bulk');
    const infoCount = document.getElementById('migrate-bulk-info-count');
    const resultContainer = document.getElementById('migrate-bulk-result-container');

    if (resultContainer) {
        resultContainer.classList.add('hidden');
        resultContainer.innerHTML = '';
    }

    const rows = rawText.split('\n');
    tempMigrateBulkData = [];
    let html = '';
    let readyCount = 0;
    let errorCount = 0;

    // Pastikan list siswa di-cache dengan benar
    const studentsCache = await window.getStudentsCache();

    // Set untuk mendeteksi duplikasi NIS Baru antar-baris dalam satu batch paste
    const usedNewNISSet = new Set();

    rows.forEach((row, index) => {
        const cols = row.split('\t');
        let oldNIS = cols[0] ? cols[0].trim() : '';
        let newNIS = cols[1] ? cols[1].trim() : '';

        // Skip jika keduanya kosong
        if (!oldNIS && !newNIS) return;

        // Skip header jika terikut
        if (oldNIS.toLowerCase() === 'nis lama' || oldNIS.toLowerCase() === 'nis sementara') return;

        let status = 'Siap';
        let statusClass = 'text-green-600 dark:text-green-400 font-bold';
        let studentName = '-';
        let studentClass = '-';

        // Cari siswa berdasarkan NIS lama
        const student = studentsCache.find(s => String(s.nis).trim() === oldNIS);

        if (!student) {
            status = 'Siswa tidak ditemukan';
            statusClass = 'text-red-500 font-semibold';
            errorCount++;
        } else {
            studentName = student.name || '-';
            studentClass = student.class || '-';

            // Validasi NIS Baru
            if (!newNIS) {
                status = 'NIS Baru kosong';
                statusClass = 'text-red-500 font-semibold';
                errorCount++;
            } else if (!/^\d+$/.test(newNIS)) {
                status = 'Format NIS Baru salah (angka saja)';
                statusClass = 'text-red-500 font-semibold';
                errorCount++;
            } else if (newNIS.length < 4) {
                status = 'NIS Baru minimal 4 karakter';
                statusClass = 'text-red-500 font-semibold';
                errorCount++;
            } else if (oldNIS === newNIS) {
                status = 'NIS Baru sama dengan NIS Lama';
                statusClass = 'text-red-500 font-semibold';
                errorCount++;
            } else {
                // Cek apakah NIS Baru sudah digunakan oleh siswa lain di cache
                const duplicateStudent = studentsCache.find(s => String(s.nis).trim() === newNIS);
                if (duplicateStudent) {
                    status = `NIS Baru sudah terdaftar (${duplicateStudent.name})`;
                    statusClass = 'text-red-500 font-semibold';
                    errorCount++;
                } else if (usedNewNISSet.has(newNIS)) {
                    // Validasi duplikasi NIS Baru antar-baris dalam batch paste ini
                    status = 'NIS Baru duplikat dengan baris lain di daftar ini';
                    statusClass = 'text-red-500 font-semibold';
                    errorCount++;
                }
            }
        }

        // Tandai NIS Baru yang sudah digunakan dalam batch ini
        if (newNIS) usedNewNISSet.add(newNIS);

        const isReady = (status === 'Siap');
        if (isReady) readyCount++;

        const rowId = `migrate-row-${index}`;
        tempMigrateBulkData.push({
            id: rowId,
            oldNIS,
            newNIS,
            name: studentName,
            class: studentClass,
            status,
            isValid: isReady
        });

        html += `
        <tr id="${rowId}" class="border-b dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="p-3 font-mono font-bold text-slate-500 dark:text-slate-400">${window.escapeHTML(oldNIS)}</td>
            <td class="p-3 font-semibold text-slate-800 dark:text-slate-200">${window.escapeHTML(studentName)}</td>
            <td class="p-3 text-slate-600 dark:text-slate-400">${window.escapeHTML(studentClass)}</td>
            <td class="p-3 font-mono font-bold text-blue-600 dark:text-blue-400">${window.escapeHTML(newNIS)}</td>
            <td class="p-3 ${statusClass}" data-field="status">${window.escapeHTML(status)}</td>
            <td class="p-3 text-center">
                <button onclick="window.removeMigrateBulkRow('${rowId}')" class="text-red-500 hover:text-red-700 transition-colors p-1" title="Hapus dari daftar">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </td>
        </tr>`;
    });

    if (previewBody) {
        previewBody.innerHTML = html || `<tr><td colspan="6" class="p-4 text-center text-slate-400 italic">Format data tidak dikenali atau kosong.</td></tr>`;
    }
    if (previewContainer) previewContainer.classList.remove('hidden');
    if (infoCount) infoCount.innerText = `${readyCount} siap dimigrasikan, ${errorCount} bermasalah.`;

    if (btnExec) btnExec.disabled = (readyCount === 0);
};

window.removeMigrateBulkRow = (rowId) => {
    const rowEl = document.getElementById(rowId);
    if (rowEl) rowEl.remove();

    tempMigrateBulkData = tempMigrateBulkData.filter(item => item.id !== rowId);

    const readyCount = tempMigrateBulkData.filter(item => item.isValid).length;
    const errorCount = tempMigrateBulkData.filter(item => !item.isValid).length;

    const infoCount = document.getElementById('migrate-bulk-info-count');
    const btnExec = document.getElementById('btn-exec-migrate-nis-bulk');
    
    if (infoCount) infoCount.innerText = `${readyCount} siap dimigrasikan, ${errorCount} bermasalah.`;
    if (btnExec) btnExec.disabled = (readyCount === 0);
};

// 7. Fungsi Eksekusi Migrasi Massal
window.executeMigrateNISBulk = async () => {
    const validItems = tempMigrateBulkData.filter(item => item.isValid);
    if (validItems.length === 0) return;

    // RBAC Guard: Hanya Super Admin yang boleh eksekusi migrasi NIS massal
    const isSuperAdminExec = (window.hasRole ? window.hasRole('super_admin') : false) || 
                             (localStorage.getItem('user_role') === 'super_admin');
    if (!isSuperAdminExec) {
        showToast('Akses Ditolak', 'Hanya Super Admin yang dapat menjalankan migrasi NIS massal.', 'error');
        return;
    }

    const confirmed = await showConfirmModal(
        `<div class="text-left text-sm space-y-2">
            <p>Anda akan memigrasikan <b class="text-blue-600 font-mono">${validItems.length}</b> siswa secara massal.</p>
            <p class="text-xs text-red-500 font-semibold mt-3">
                <i class="fa-solid fa-triangle-exclamation mr-1"></i> PENTING - PEMINDAHAN MENYELURUH (3 DATABASE):<br>
                Proses ini akan memperbarui master data siswa (Cloudflare D1), catatan BK & agregat poin, perwalian wali/guru wali, nilai E-Rapor & respon kuesioner peminatan (D1), presensi jurnal mengajar guru (D1), token notifikasi/passkey (D1), presensi harian SIMAS (Supabase), penilaian rincian & CP guru mapel (Supabase), SPP keuangan (Supabase), voting Duta CERDAS (Supabase), sirkulasi & bebas pustaka Perpustakaan (Supabase), masukan/saran (Supabase), serta histori mutasi & akun pengguna (Firestore).
            </p>
        </div>`,
        'Konfirmasi Migrasi Massal Menyeluruh',
        'warning'
    );
    if (!confirmed) return;

    const btnExec = document.getElementById('btn-exec-migrate-nis-bulk');
    const progressContainer = document.getElementById('migrate-bulk-progress-container');
    const progressTitle = document.getElementById('migrate-bulk-progress-title');
    const progressPercent = document.getElementById('migrate-bulk-progress-percent');
    const progressBar = document.getElementById('migrate-bulk-progress-bar');
    const progressLogs = document.getElementById('migrate-bulk-progress-logs');
    const resultContainer = document.getElementById('migrate-bulk-result-container');
    const pasteArea = document.getElementById('import-migrate-bulk-paste');

    if (btnExec) btnExec.disabled = true;
    if (pasteArea) pasteArea.disabled = true;
    if (progressContainer) progressContainer.classList.remove('hidden');
    if (progressLogs) progressLogs.innerHTML = '';
    if (resultContainer) {
        resultContainer.classList.add('hidden');
        resultContainer.innerHTML = '';
    }

    let successCount = 0;
    let failedMigrations = [];

    const total = validItems.length;

    for (let i = 0; i < total; i++) {
        const item = validItems[i];
        const percent = Math.round((i / total) * 100);

        if (progressTitle) progressTitle.innerText = `Memproses (${i + 1}/${total}): ${item.name}`;
        if (progressPercent) progressPercent.innerText = `${percent}%`;
        if (progressBar) progressBar.style.width = `${percent}%`;

        // Update status di baris tabel preview
        const rowEl = document.getElementById(item.id);
        if (rowEl) {
            const statusCell = rowEl.querySelector('[data-field="status"]');
            if (statusCell) {
                statusCell.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-blue-500 mr-1"></i> Memproses...`;
                statusCell.className = 'p-3 text-blue-500 font-semibold';
            }
        }

        // Tulis log progress awal
        const logItem = document.createElement('div');
        logItem.className = 'text-[11px] mb-1';
        logItem.innerHTML = `<span class="text-slate-400">[${i + 1}/${total}]</span> Memproses <b class="text-slate-700 dark:text-slate-300">${window.escapeHTML(item.name)}</b> (${item.oldNIS} &rarr; ${item.newNIS})...`;
        if (progressLogs) {
            progressLogs.appendChild(logItem);
            progressLogs.scrollTop = progressLogs.scrollHeight;
        }

        try {
            await performSingleMigration(item.oldNIS, item.newNIS, item.name, item.class);
            successCount++;

            if (rowEl) {
                const statusCell = rowEl.querySelector('[data-field="status"]');
                if (statusCell) {
                    statusCell.innerHTML = `<i class="fa-solid fa-circle-check text-green-600 mr-1"></i> Sukses`;
                    statusCell.className = 'p-3 text-green-600 dark:text-green-400 font-bold';
                }
            }

            logItem.innerHTML += ` <span class="text-green-600 dark:text-green-400 font-bold"><i class="fa-solid fa-circle-check"></i> SUKSES</span>`;

        } catch (err) {
            console.error(`Migration failed for ${item.name} (${item.oldNIS}):`, err);
            
            failedMigrations.push({
                nisLama: item.oldNIS,
                nisBaru: item.newNIS,
                nama: item.name,
                kelas: item.class,
                error: err.message
            });

            if (rowEl) {
                const statusCell = rowEl.querySelector('[data-field="status"]');
                if (statusCell) {
                    statusCell.innerHTML = `<i class="fa-solid fa-circle-xmark text-red-500 mr-1"></i> Gagal`;
                    statusCell.className = 'p-3 text-red-500 font-bold';
                }
            }

            logItem.innerHTML += ` <span class="text-red-500 font-bold"><i class="fa-solid fa-circle-xmark"></i> GAGAL: ${window.escapeHTML(err.message)}</span>`;
        }
    }

    if (progressTitle) progressTitle.innerText = `Selesai memproses ${total} siswa.`;
    if (progressPercent) progressPercent.innerText = `100%`;
    if (progressBar) progressBar.style.width = `100%`;

    window.invalidateStudentsCache();
    if (typeof window.invalidateStudentAggregatesCache === 'function') {
        window.invalidateStudentAggregatesCache();
    }
    try {
        localStorage.removeItem('simas_kelas_list_cache');
        localStorage.removeItem('simas_show_alumni_cache');
    } catch (e) {}

    if (resultContainer) {
        resultContainer.classList.remove('hidden');
        
        let resultHtml = `
        <div class="flex items-center justify-between mb-2">
            <h4 class="font-bold text-slate-800 dark:text-white"><i class="fa-solid fa-chart-pie mr-1 text-blue-500"></i> Ringkasan Hasil Migrasi Massal:</h4>
            <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">SELESAI</span>
        </div>
        <div class="grid grid-cols-3 gap-2 text-center font-bold mb-3">
            <div class="p-2 bg-slate-100 dark:bg-slate-800 rounded">
                <div class="text-xs text-slate-500">Total Data</div>
                <div class="text-lg text-slate-800 dark:text-white">${total}</div>
            </div>
            <div class="p-2 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 rounded border border-emerald-100 dark:border-emerald-900/50">
                <div class="text-xs text-emerald-500">Sukses</div>
                <div class="text-lg">${successCount}</div>
            </div>
            <div class="p-2 bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300 rounded border border-red-100 dark:border-red-900/50">
                <div class="text-xs text-red-500">Gagal</div>
                <div class="text-lg">${failedMigrations.length}</div>
            </div>
        </div>`;

        if (failedMigrations.length > 0) {
            resultContainer.className = "p-4 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/10 text-xs space-y-3";
            resultHtml += `
            <div class="border-t border-red-200 dark:border-red-900/50 pt-2 animate-fade-in">
                <div class="font-bold text-red-700 dark:text-red-400 mb-1.5"><i class="fa-solid fa-triangle-exclamation mr-1"></i> Daftar Migrasi yang Gagal:</div>
                <div class="max-h-40 overflow-y-auto custom-scrollbar space-y-1.5 pr-1">`;
            
            failedMigrations.forEach((fm, idx) => {
                resultHtml += `
                <div class="p-2 rounded bg-white dark:bg-slate-800 border border-red-100 dark:border-red-900/30 flex justify-between items-start gap-3">
                    <div>
                        <span class="font-bold text-slate-800 dark:text-white font-mono">${idx+1}. [${fm.nisLama} &rarr; ${fm.nisBaru}]</span> 
                        <span class="text-slate-600 dark:text-slate-400 font-semibold">${fm.nama} (${fm.class})</span>
                    </div>
                    <div class="text-red-500 font-medium text-right">${window.escapeHTML(fm.error)}</div>
                </div>`;
            });
            
            resultHtml += `
                </div>
            </div>`;
        } else {
            resultContainer.className = "p-4 rounded-lg border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/20 text-xs space-y-3";
            resultHtml += `
            <div class="text-emerald-700 dark:text-emerald-300 font-semibold text-center flex items-center justify-center gap-1">
                <i class="fa-solid fa-circle-check text-base"></i> Semua data berhasil dimigrasikan secara sempurna!
            </div>`;
        }

        resultContainer.innerHTML = resultHtml;
    }

    if (typeof window.logAudit === 'function') {
        window.logAudit('MIGRATE_STUDENTS_BULK', 'bulk', null, { total, success: successCount, failed: failedMigrations.length }, `Migrasi massal NIS: ${successCount} sukses, ${failedMigrations.length} gagal dari total ${total} data.`);
    }

    if (btnExec) btnExec.disabled = true;
    if (pasteArea) {
        pasteArea.disabled = false;
        pasteArea.value = '';
    }
    tempMigrateBulkData = [];
    
    showModernAlert("Migrasi Selesai", `Proses migrasi massal selesai.<br>Sukses: <b>${successCount}</b> | Gagal: <b>${failedMigrations.length}</b>.`);
};

// Helper internal: Hitung ulang ringkasan status presensi
function summarizeAttendanceRecords(recordsObj) {
    const summary = { H: 0, S: 0, I: 0, D: 0, A: 0 };
    Object.values(recordsObj || {}).forEach(rec => {
        const status = String(rec?.status || 'H').toUpperCase();
        if (summary[status] !== undefined) summary[status]++;
        else summary.H++;
    });
    return summary;
}

// --- ONE-CLICK BULK MIGRATION KE CLOUDFLARE D1 ---
window.syncAllStudentsToCloudflare = async function () {
    const isSuperAdmin = window.hasRole ? window.hasRole('super_admin') : localStorage.getItem('user_role') === 'super_admin';
    if (!isSuperAdmin) {
        if (typeof window.showToast === 'function') {
            window.showToast("Akses Ditolak", "Hanya Super Admin yang dapat menjalankan sinkronisasi massal ke Cloudflare.", "error");
        } else {
            alert("Hanya Super Admin yang dapat menjalankan sinkronisasi massal ke Cloudflare.");
        }
        return;
    }

    const confirmed = typeof window.showConfirmModal === 'function'
        ? await window.showConfirmModal(
            "Sinkronisasi Siswa ke Cloudflare D1",
            "Apakah Anda yakin ingin menyinkronkan seluruh data master siswa dari Firestore ke Cloudflare D1 Serverless SQL? Operasi ini akan memastikan seluruh database Edge ter-update identik.",
            "Mulai Sinkronisasi",
            "Batal"
        )
        : confirm("Apakah Anda yakin ingin menyinkronkan seluruh data master siswa dari Firestore ke Cloudflare D1?");
    
    if (!confirmed) return;

    if (typeof window.showToast === 'function') {
        window.showToast("Sinkronisasi Master", "Mengambil data siswa dari Cloudflare D1...", "info");
    }

    try {
        const allStudents = typeof window.getStudentsCache === 'function' 
            ? await window.getStudentsCache(true) 
            : (await cfClient.getStudents({ limit: 2000 }));

        if (!allStudents || allStudents.length === 0) {
            if (typeof window.showToast === 'function') {
                window.showToast("Data Kosong", "Tidak ada data siswa ditemukan.", "warning");
            }
            return;
        }

        const total = allStudents.length;
        let synced = 0;
        const chunkSize = 50;

        for (let i = 0; i < total; i += chunkSize) {
            const chunk = allStudents.slice(i, i + chunkSize);
            await cfClient.bulkSyncStudents(chunk);
            synced += chunk.length;
            if (typeof window.showToast === 'function') {
                window.showToast("Progres Sinkronisasi", `Tersinkronisasi ${synced} dari ${total} siswa...`, "info");
            }
        }

        if (typeof window.logAudit === 'function') {
            window.logAudit('BULK_SYNC_STUDENTS_CF', 'all', null, { total }, `Sinkronisasi massal ${total} siswa ke Cloudflare D1 berhasil.`);
        }

        // Paksa refresh cache
        if (typeof window.getStudentsCache === 'function') {
            await window.getStudentsCache(true);
        }

        if (typeof window.showAlertModal === 'function') {
            await window.showAlertModal(
                "Sinkronisasi Selesai!",
                `Sebanyak <b>${synced}</b> data siswa berhasil diimpor dan disinkronkan ke Cloudflare D1 Serverless SQL (0 Firestore Read untuk akses selanjutnya).`,
                "success"
            );
        } else {
            alert(`Sebanyak ${synced} data siswa berhasil diimpor ke Cloudflare D1.`);
        }

        // Refresh tabel siswa
        const cls = document.getElementById('filter-class')?.value;
        if (cls === 'ALL') loadAllStudents();
        else if (cls) loadStudentsByClass(cls);

    } catch (err) {
        console.error("[BulkSync] Gagal migrasi ke Cloudflare D1:", err);
        if (typeof window.showAlertModal === 'function') {
            window.showAlertModal("Gagal Sinkronisasi", "Terjadi kesalahan saat migrasi ke Cloudflare D1: " + err.message, "error");
        } else {
            alert("Gagal sinkronisasi: " + err.message);
        }
    }
};

// =====================================================================
// MODAL PRATINJAU KTS INTERAKTIF & INFORMASI PUBLIK (PANEL DATA SISWA)
// =====================================================================

let currentKtsStudent = null;
let currentKtsSideView = 'front';
let currentKtsPhotoToken = '';

/**
 * Buka Modal Pratinjau KTS & Informasi Publik Hasil Scan QR
 * Hak Akses: Super Admin, Staff (Tata Usaha), dan Kesiswaan
 */
window.openKtsPreviewModal = async function (studentIdOrNis) {
    if (!studentIdOrNis) return;

    // Proteksi Otorisasi RBAC: Hanya Super Admin, Staff Tata Usaha, dan Kesiswaan
    const currentRole = localStorage.getItem('user_role');
    const isAllowed = window.hasRole ?
        (window.hasRole('super_admin') || window.hasRole('staff') || window.hasRole('kesiswaan')) :
        ['super_admin', 'staff', 'kesiswaan'].includes(currentRole);

    if (!isAllowed) {
        if (typeof showAlertModal === 'function') {
            showAlertModal('Akses Ditolak', 'Pencetakan dan pratinjau Kartu Pelajar dari panel ini hanya diizinkan untuk Super Admin, Staff Tata Usaha, dan Kesiswaan. Wali Kelas dapat mencetak kartu melalui Portal Wali Kelas.', 'error');
        } else {
            alert('Akses Ditolak: Anda tidak memiliki izin mengakses pratinjau kartu pelajar dari panel ini.');
        }
        return;
    }

    let student = null;
    if (typeof window.getStudentsCache === 'function') {
        try {
            const allStudents = await window.getStudentsCache();
            student = allStudents.find(s => String(s.nis) === String(studentIdOrNis) || String(s.id) === String(studentIdOrNis));
        } catch (e) {
            console.warn('[KTS Preview Admin] Gagal cari dari cache:', e);
        }
    }

    if (!student && studentsCache && Array.isArray(studentsCache)) {
        student = studentsCache.find(s => String(s.nis) === String(studentIdOrNis) || String(s.id) === String(studentIdOrNis));
    }

    if (!student && cfClient && cfClient.enabled) {
        try {
            student = await cfClient.getStudentByNis(studentIdOrNis);
        } catch (e) {
            console.warn('[KTS Preview Admin] Gagal cari dari cfClient:', e);
        }
    }

    if (!student) {
        if (typeof showAlertModal === 'function') {
            showAlertModal('Peringatan', 'Data siswa tidak ditemukan untuk pratinjau kartu.', 'warning');
        } else {
            alert('Data siswa tidak ditemukan.');
        }
        return;
    }

    currentKtsStudent = student;
    currentKtsSideView = 'front';

    // Muat data info foto dan public token terbaru dari server
    try {
        if (cfClient && cfClient.enabled) {
            const photoInfoRes = await cfClient.getStudentPhotoInfo(student.nis);
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
        console.warn('[KTS Preview Admin] Gagal memuat info foto realtime:', e);
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
    if (pubClass) pubClass.textContent = student.class || '-';

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
        const studentCls = student.class || '';
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

    // Link Uji Halaman Publik
    const testLink = document.getElementById('link-test-public-card');
    if (testLink) {
        testLink.href = `${window.location.origin}/kartu-shakti.html?id=${encodeURIComponent(currentKtsPhotoToken)}`;
    }

    // Render Visual Kartu
    window.setKtsSideView('front');

    window.openModal('modal-kts-preview');

    // Reset posisi scroll kolom kanan ke puncak teratas
    const rightColEl = document.getElementById('modal-kts-preview-right');
    if (rightColEl) {
        rightColEl.scrollTop = 0;
    }

    // Delegasikan event wheel di area kiri desktop ke kolom kanan
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

    // Pastikan kalkulasi skala kartu langsung terpicu
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

    if (currentKtsPhotoToken) currentKtsStudent.photoPublicToken = currentKtsPhotoToken;

    renderBox.innerHTML = '';
    const cardData = buildKtsScreenCardMarkup(currentKtsStudent, currentKtsSideView);
    renderBox.innerHTML = cardData.html;

    if (currentKtsSideView === 'front' && cardData.qrId) {
        const token = currentKtsPhotoToken || currentKtsStudent.photoPublicToken || currentKtsStudent.cardToken || currentKtsStudent;
        renderKtsQrCode(cardData.qrId, token, { width: 74, height: 74 });
    }

    // Auto-scale kartu agar proporsional persis seperti gambar
    const cardEl = renderBox.querySelector('.kts-card-wrapper');
    if (cardEl && typeof updateKtsCardScale === 'function') {
        updateKtsCardScale(cardEl);
    }
}

/**
 * Cetak KTS Siswa yang Sedang Dibuka di Modal
 */
window.printCurrentKtsModal = async function () {
    if (!currentKtsStudent) return;
    await printSingleKts(currentKtsStudent, 'both', 'print-single-kts-container');
};

/**
 * Unduh Gambar KTS PNG dari Modal Siswa (SSOT CR-80 HD 300 DPI)
 */
window.downloadKtsModalPng = async function (side = 'both') {
    if (!currentKtsStudent) return;

    if (typeof showToast === 'function') {
        showToast('Mengunduh Kartu', 'Menyiapkan berkas Kartu Pelajar HD (Depan & Belakang)...', 'info');
    }

    if (typeof StudentCardRenderer?.downloadKtsPng === 'function') {
        await StudentCardRenderer.downloadKtsPng(currentKtsStudent, side || 'both');
    } else if (typeof downloadKtsPng === 'function') {
        await downloadKtsPng(currentKtsStudent, side || 'both');
    }
};

/**
 * Cetak Kartu Pelajar (E-KTS) dari Panel Admin Siswa (Membuka Modal Pratinjau Terlebih Dahulu)
 */
window.printStudentKtsAdmin = async function (studentIdOrNis) {
    await window.openKtsPreviewModal(studentIdOrNis);
};

/**
 * Buka Pratinjau Dokumen Foto KK Siswa untuk Admin Dapodik, Wali Kelas, dan Super Admin
 */
window.openKKPreviewAdmin = function (nis, studentName, encodedUrl, uploadedAt) {
    const rawUrl = decodeURIComponent(encodedUrl || '');
    if (!rawUrl) {
        if (typeof showToast === 'function') {
            showToast('Peringatan', 'Tautan dokumen foto KK belum tersedia.', 'warning');
        } else {
            alert('Tautan dokumen foto KK belum tersedia.');
        }
        return;
    }

    const modal = document.getElementById('modal-preview-kk-admin');
    const titleEl = document.getElementById('modal-preview-kk-admin-title');
    const subtitleEl = document.getElementById('modal-preview-kk-admin-subtitle');
    const imgEl = document.getElementById('modal-preview-kk-admin-img');
    const driveLinkEl = document.getElementById('modal-preview-kk-admin-drivelink');
    const metaEl = document.getElementById('modal-preview-kk-admin-meta');

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
window.closeKKPreviewAdmin = function () {
    const modal = document.getElementById('modal-preview-kk-admin');
    if (modal) modal.classList.add('hidden');
    const imgEl = document.getElementById('modal-preview-kk-admin-img');
    if (imgEl) imgEl.src = '';
};

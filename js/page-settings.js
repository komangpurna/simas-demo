/* js/page-settings.js - Modern UI & Numeric Sort Fix */
import { auth, db, PATHS, SUPABASE_URL, SUPABASE_ANON_KEY, supabase, SCHOOL_CONFIG } from './config.js';
import { cfClient } from './cloudflare-client.js';
import { initAnnualReset } from './page-settings-annual.js';
import { isAnnualResetBackup, normalizeAnnualResetBackup } from './annual-reset-backup.js';
import { initLayout } from './global.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { getDocs, doc, setDoc, getDoc, collection, serverTimestamp, addDoc, deleteDoc as fsDeleteDoc, orderBy, query as fsQuery, writeBatch, query, where, deleteDoc, Timestamp, increment } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const escapeHtml = (str) => (typeof window.escapeHTML === 'function' ? window.escapeHTML(str) : (typeof window.escapeHtml === 'function' ? window.escapeHtml(str) : String(str || '')));

// --- HELPER: MODERN ALERT ---
function showModernAlert(title, message, type = 'success') {
    const modal = document.getElementById('modal-alert');
    if (!modal) { showToast(title, message, type === 'success' ? 'success' : 'error'); return; } // Fallback

    const iconBg = document.getElementById('alert-icon-bg');
    const icon = document.getElementById('alert-icon');
    const titleEl = document.getElementById('alert-title');
    const msgEl = document.getElementById('alert-msg');

    if (type === 'success') {
        iconBg.className = "w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-green-100 text-green-600 animate-bounce-slow";
        icon.className = "fa-solid fa-check text-3xl";
    } else {
        iconBg.className = "w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-red-100 text-red-600 animate-pulse";
        icon.className = "fa-solid fa-triangle-exclamation text-3xl";
    }

    titleEl.innerText = title;
    msgEl.innerHTML = message;
    modal.classList.remove('hidden');
}

// --- HELPER: MODERN CONFIRM (Pengganti confirm() bawaan browser) ---
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

        // Set icon based on type
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

        // Cleanup previous listeners
        const newBtnOk = btnOk.cloneNode(true);
        const newBtnCancel = btnCancel.cloneNode(true);
        btnOk.parentNode.replaceChild(newBtnOk, btnOk);
        btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);

        // Add new listeners
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


onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash); return; }

    const role = localStorage.getItem('user_role');

    // Akses Control: Khusus Super Admin
    let isSuperAdmin = role === 'super_admin';
    if (!isSuperAdmin && typeof window.hasRole === 'function') {
        isSuperAdmin = window.hasRole('super_admin');
    }

    if (!isSuperAdmin) {
        showModernAlert("Akses Ditolak", "Halaman ini khusus Super Admin.", "error");
        setTimeout(() => window.location.href = 'dashboard.html', 2000);
        return;
    }

    // MULTI-ROLE: Ambil role tertinggi untuk halaman ini
    const effectiveRole = window.getEffectiveRoleForPage ?
        window.getEffectiveRoleForPage('settings.html') : role;
    initLayout(effectiveRole);
    document.querySelector('main').classList.remove('hidden');

    // Load konfigurasi video login & kalender
    loadLoginVideoConfig();
    loadCalendarConfig();

});

let allKelasListSettings = [];
let transferStudentsSettings = [];
let isTransferStudentListReady = false;
let selectedTransferStudentId = '';

// --- SYSTEM MAINTENANCE LOGIC ---

// 1. Trigger Modal Konfirmasi (Pengganti confirm() jadul)
window.syncClasses = () => {
    // Multi-role: hasRole agar additional role super_admin juga terdeteksi
    const isSuperAdmin = window.hasRole ? window.hasRole('super_admin') : localStorage.getItem('user_role') === 'super_admin';
    if (!isSuperAdmin) return;

    document.getElementById('modal-confirm').classList.remove('hidden');
};

// 2. Eksekusi Setelah Klik "Ya"
window.executeSync = async () => {
    // Tutup modal konfirmasi dulu
    document.getElementById('modal-confirm').classList.add('hidden');

    const btn = document.querySelector('button[onclick="window.syncClasses()"]');
    const originalText = btn ? btn.innerText : '';
    if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memindai...';
        btn.disabled = true;
        btn.classList.add('opacity-75');
    }

    try {
        const students = await window.getStudentsCache();
        const foundClasses = new Set();

        students.forEach(s => {
            if (s.class) {
                const className = s.class.trim();
                const lowerClass = className.toLowerCase();
                const isExcluded = 
                    lowerClass.includes('keluar') || 
                    lowerClass.includes('pindah') || 
                    lowerClass.includes('mutasi') || 
                    lowerClass.includes('alumni');
                if (!isExcluded && className !== '') {
                    foundClasses.add(className);
                }
            }
        });

        // --- SORTING CERDAS (NUMERIC) ---
        // X-1, X-2 ... X-10 (Bukan X-1, X-10, X-2)
        const list = Array.from(foundClasses).sort((a, b) =>
            a.localeCompare(b, undefined, { numeric: true })
        );

        if (window.cfClient && window.cfClient.enabled) {
            await window.cfClient.saveSystemSetting('metadata_classes', { list: list });
            await window.cfClient.saveSystemSetting('metadata', {
                lastUpdateClasses: Date.now()
            });
        }

        if (typeof window.invalidateActiveClassesCache === 'function') {
            window.invalidateActiveClassesCache();
        }

        if (typeof window.logAudit === 'function') {
            window.logAudit('SYNC_CLASSES', 'metadata_classes', null, { classCount: list.length }, 'Melakukan sinkronisasi master data kelas & refresh cache siswa');
        }

        // Tampilkan Modal Sukses (Pengganti alert() jadul)
        showModernAlert(
            "Sinkronisasi Sukses!",
            `Ditemukan <b>${list.length} kelas</b> dari database siswa.<br>Urutan kelas dan cache data siswa telah diperbarui.`
        );

        console.log("Urutan Kelas Baru:", list);

    } catch (e) {
        console.error(e);
        showModernAlert("Gagal", e.message, "error");
    } finally {
        if (btn) {
            btn.innerText = originalText;
            btn.disabled = false;
            btn.classList.remove('opacity-75');
        }
    }
};

// --- 3. MODUL TERPADU: RESET DATA TAHUNAN (BERSIH ALUMNI + KENAIKAN KELAS) ---

initAnnualReset({
    showToast: (...args) => showToast(...args),
    showModernAlert,
    onStudentsChanged: () => {
        allKelasListSettings = [];
        transferStudentsSettings = [];
        isTransferStudentListReady = false;
        selectedTransferStudentId = '';
    }
});

// 4. PINDAH KELAS SISWA (AUTO ORIGIN + MIGRASI PRESENSI)
async function loadAllKelasForSettings() {
    if (allKelasListSettings && allKelasListSettings.length > 0) return;

    try {
        const allStudents = await window.getStudentsCache();
        const kelasSet = new Set();
        (allStudents || []).forEach(data => {
            const kelas = (data.class || data.kelas || '').trim();
            const isAlumni = data.is_alumni === true || data.status === 'alumni' || kelas.toLowerCase().startsWith('alumni');
            const isKeluar = data.status === 'keluar' || data.status === 'mutasi' || data.is_active === false;

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
        console.error('[Settings] Gagal memuat daftar kelas:', e);
    }
}
window.loadAllKelasForSettings = loadAllKelasForSettings;

function getClassLevelPrefix(className) {
    const cls = String(className || '').trim().toUpperCase();
    if (cls.startsWith('XII')) return 'XII';
    if (cls.startsWith('XI')) return 'XI';
    if (cls.startsWith('X')) return 'X';
    return null;
}

function findAttendanceRecordByNIS(recordsObj, nis) {
    const targetNIS = String(nis || '').trim();
    if (!targetNIS || !recordsObj) return null;

    for (const [key, value] of Object.entries(recordsObj)) {
        if (String(value?.nis || '').trim() === targetNIS) {
            return { key, value };
        }
    }
    return null;
}

function summarizeAttendanceRecords(recordsObj) {
    const summary = { H: 0, S: 0, I: 0, D: 0, A: 0 };
    Object.values(recordsObj || {}).forEach(rec => {
        const status = String(rec?.status || 'H').toUpperCase();
        if (summary[status] !== undefined) summary[status]++;
        else summary.H++;
    });
    return summary;
}

function extractDateFromAttendanceDocId(docId, className) {
    const prefix = `${className}_`;
    if (String(docId || '').startsWith(prefix)) {
        return String(docId).slice(prefix.length);
    }
    return '';
}

function setTransferOriginInfo(text) {
    const infoEl = document.getElementById('transfer-origin-info');
    if (infoEl) infoEl.textContent = text || '-';
}

function renderTransferTargetClasses(fromClass) {
    const targetSelect = document.getElementById('select-transfer-target-class');
    if (!targetSelect) return;

    const fromLevel = getClassLevelPrefix(fromClass);
    if (!fromLevel) {
        targetSelect.innerHTML = '<option value="">-- Kelas asal tidak valid --</option>';
        targetSelect.disabled = true;
        return;
    }

    const targetClasses = allKelasListSettings
        .filter(c => c !== fromClass && getClassLevelPrefix(c) === fromLevel)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (targetClasses.length === 0) {
        targetSelect.innerHTML = '<option value="">-- Tidak ada kelas tujuan setingkat --</option>';
        targetSelect.disabled = true;
        return;
    }

    targetSelect.innerHTML = '<option value="">-- Pilih Kelas Tujuan --</option>';
    targetClasses.forEach(cls => {
        const opt = document.createElement('option');
        opt.value = cls;
        opt.textContent = cls;
        targetSelect.appendChild(opt);
    });
    targetSelect.disabled = false;
}

function renderTransferStudents(keyword = '') {
    const dropdownEl = document.getElementById('transfer-student-dropdown');
    const searchInput = document.getElementById('input-transfer-student-search');
    const targetSelect = document.getElementById('select-transfer-target-class');
    const btnExec = document.getElementById('btn-exec-transfer-class');
    if (!dropdownEl) return;

    const kw = String(keyword || '').trim().toLowerCase();
    const filtered = transferStudentsSettings.filter(s => {
        if (!kw) return true;
        return s.name.toLowerCase().includes(kw) ||
            s.nis.toLowerCase().includes(kw) ||
            s.class.toLowerCase().includes(kw);
    });

    dropdownEl.innerHTML = '';
    dropdownEl.classList.remove('hidden');
    if (filtered.length === 0) {
        dropdownEl.innerHTML = '<div class="px-3 py-2 text-sm text-slate-400 italic">Siswa tidak ditemukan</div>';
        if (targetSelect) {
            targetSelect.innerHTML = '<option value="">-- Pilih siswa dulu --</option>';
            targetSelect.disabled = true;
        }
        setTransferOriginInfo('-');
        selectedTransferStudentId = '';
        if (searchInput && !kw) {
            searchInput.value = '';
        }
        if (btnExec) btnExec.disabled = true;
        return;
    }

    dropdownEl.innerHTML = filtered.map(s => `
        <button type="button"
            onclick="window.selectTransferStudent('${s.id}')"
            class="w-full text-left px-3 py-2 hover:bg-indigo-50 border-b border-slate-100 last:border-b-0 transition-colors">
            <div class="text-sm font-semibold text-slate-700">${escapeHtml(s.name)}</div>
            <div class="text-[11px] text-slate-500">${escapeHtml(s.nis)} - ${escapeHtml(s.class)}</div>
        </button>
    `).join('');
}

function hideTransferStudentDropdown() {
    const dropdownEl = document.getElementById('transfer-student-dropdown');
    if (dropdownEl) dropdownEl.classList.add('hidden');
}

window.selectTransferStudent = (studentId) => {
    const student = transferStudentsSettings.find(s => s.id === studentId);
    const searchInput = document.getElementById('input-transfer-student-search');
    if (!student || !searchInput) return;

    selectedTransferStudentId = studentId;
    searchInput.value = `${student.name} (${student.nis})`;
    hideTransferStudentDropdown();
    window.onTransferStudentChange();
};

window.handleTransferStudentOutsideClick = (event) => {
    const modal = document.getElementById('modal-transfer-class');
    const dropdownEl = document.getElementById('transfer-student-dropdown');
    const searchInput = document.getElementById('input-transfer-student-search');
    if (!modal || !dropdownEl || !searchInput) return;
    if (modal.classList.contains('hidden')) return;
    if (dropdownEl.classList.contains('hidden')) return;

    const clickedInsideDropdown = dropdownEl.contains(event.target);
    const clickedInput = searchInput.contains(event.target);
    if (!clickedInsideDropdown && !clickedInput) {
        hideTransferStudentDropdown();
    }
}

async function loadTransferStudentsForSettings() {
    const students = await window.getStudentsCache();
    transferStudentsSettings = [];

    (students || []).forEach(data => {
        const nis = String(data.nis || data.id || '').trim();
        const cls = String(data.class || data.kelas || '').trim();
        if (!nis || !cls) return;
        const isAlumni = data.is_alumni === true || data.status === 'alumni' || cls.toLowerCase().startsWith('alumni');
        const isKeluar = data.status === 'keluar' || data.status === 'mutasi' || data.is_active === false;
        if (isAlumni || isKeluar) return;

        transferStudentsSettings.push({
            id: data.id || nis,
            nis,
            name: String(data.name || data.nama || '').trim(),
            class: cls,
            gender: data.gender || data.jenisKelamin || '',
            status: data.status || 'active'
        });
    });

    transferStudentsSettings.sort((a, b) => {
        const classDiff = a.class.localeCompare(b.class, undefined, { numeric: true });
        if (classDiff !== 0) return classDiff;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
}

window.initTransferStudentList = () => {
    if (!isTransferStudentListReady) isTransferStudentListReady = true;
    const searchInput = document.getElementById('input-transfer-student-search');
    renderTransferStudents(searchInput?.value || '');
};

window.openTransferClassModal = async () => {
    const isSuperAdmin = window.hasRole ? window.hasRole('super_admin') : localStorage.getItem('user_role') === 'super_admin';
    if (!isSuperAdmin) return showToast('Akses Ditolak', 'Fitur ini hanya untuk Super Admin.', 'error');

    const modal = document.getElementById('modal-transfer-class');
    const searchInput = document.getElementById('input-transfer-student-search');
    const targetSelect = document.getElementById('select-transfer-target-class');
    const btnExec = document.getElementById('btn-exec-transfer-class');
    const dropdownEl = document.getElementById('transfer-student-dropdown');

    if (searchInput) searchInput.value = '';
    isTransferStudentListReady = false;
    selectedTransferStudentId = '';
    if (dropdownEl) dropdownEl.classList.add('hidden');
    setTransferOriginInfo('-');
    if (targetSelect) {
        targetSelect.innerHTML = '<option value="">-- Pilih siswa dulu --</option>';
        targetSelect.disabled = true;
    }
    if (btnExec) {
        btnExec.disabled = true;
        btnExec.innerHTML = 'Pindahkan';
    }

    if (modal) modal.classList.remove('hidden');
    document.addEventListener('click', window.handleTransferStudentOutsideClick);

    try {
        await loadAllKelasForSettings();
        await loadTransferStudentsForSettings();
    } catch (e) {
        console.error('Gagal load data pindah kelas:', e);
        showToast('Error', 'Gagal memuat data siswa/kelas: ' + e.message, 'error');
    }
};

window.closeTransferClassModal = () => {
    const modal = document.getElementById('modal-transfer-class');
    if (modal) modal.classList.add('hidden');
    hideTransferStudentDropdown();
    document.removeEventListener('click', window.handleTransferStudentOutsideClick);
};

window.filterTransferStudentList = (keyword = '') => {
    if (!isTransferStudentListReady) window.initTransferStudentList();
    selectedTransferStudentId = '';
    renderTransferStudents(keyword);
};

window.onTransferStudentChange = () => {
    const searchInput = document.getElementById('input-transfer-student-search');
    const btnExec = document.getElementById('btn-exec-transfer-class');
    if (!searchInput) return;

    const student = transferStudentsSettings.find(s => s.id === selectedTransferStudentId);
    if (!student) {
        setTransferOriginInfo('-');
        renderTransferTargetClasses('');
        if (searchInput && !searchInput.value.trim()) {
            searchInput.placeholder = 'Ketik Nama, NIS, atau Kelas...';
        }
        if (btnExec) btnExec.disabled = true;
        return;
    }

    const level = getClassLevelPrefix(student.class);
    const levelLabel = level ? `Angkatan ${level}` : 'Angkatan tidak dikenali';
    setTransferOriginInfo(`${student.class} (${levelLabel})`);
    renderTransferTargetClasses(student.class);
    if (btnExec) btnExec.disabled = false;
};

window.executeTransferClass = async () => {
    const targetSelect = document.getElementById('select-transfer-target-class');
    const btnExec = document.getElementById('btn-exec-transfer-class');
    const searchInput = document.getElementById('input-transfer-student-search');
    if (!targetSelect || !btnExec) return;

    const selectedStudent = transferStudentsSettings.find(s => s.id === selectedTransferStudentId);
    const targetClass = String(targetSelect.value || '').trim();

    if (!selectedStudent) return showToast('Peringatan', 'Pilih siswa terlebih dahulu.', 'warning');
    if (!targetClass) return showToast('Peringatan', 'Pilih kelas tujuan terlebih dahulu.', 'warning');

    const fromClass = String(selectedStudent.class || '').trim();
    const fromLevel = getClassLevelPrefix(fromClass);
    const targetLevel = getClassLevelPrefix(targetClass);

    if (!fromLevel || !targetLevel || fromLevel !== targetLevel) {
        return showToast('Peringatan', 'Pindah kelas hanya diizinkan dalam angkatan yang sama.', 'warning');
    }
    if (fromClass === targetClass) {
        return showToast('Peringatan', 'Kelas tujuan harus berbeda dari kelas asal.', 'warning');
    }

    const confirmed = await showConfirmModal(
        `<div class="text-left text-sm space-y-1">
            <p>Siswa: <b>${escapeHtml(selectedStudent.name)}</b> (${escapeHtml(selectedStudent.nis)})</p>
            <p>Dari: <span class="badge bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-bold">${escapeHtml(fromClass)}</span></p>
            <p>Ke: <span class="badge bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded font-bold">${escapeHtml(targetClass)}</span></p>
            <div class="p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 rounded-lg text-xs text-amber-800 dark:text-amber-300 mt-2">
                <p class="font-semibold mb-1"><i class="fa-solid fa-shield-halved mr-1"></i> Data yang otomatis diselaraskan:</p>
                <ul class="list-disc list-inside space-y-0.5 text-[11px]">
                    <li>Master Siswa & Profil D1</li>
                    <li>Histori Presensi Harian (Supabase)</li>
                    <li>Poin Pelanggaran & Prestasi Kedisiplinan (D1)</li>
                    <li>Layanan Bimbingan Konseling / BK (D1)</li>
                    <li>Pengajuan Izin Permisi & Perwalian (D1)</li>
                    <li>Sirkulasi Peminjaman Buku Perpustakaan (Supabase)</li>
                </ul>
            </div>
        </div>`,
        'Konfirmasi Pindah Kelas',
        'warning'
    );
    if (!confirmed) return;

    const originalBtnHTML = btnExec.innerHTML;
    btnExec.disabled = true;
    btnExec.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Menghitung tahun ajaran...';

    try {
        // 1. Hitung Tahun Ajaran Aktif (Format: YYYY/YYYY)
        const now = new Date();
        const curMonth = now.getMonth() + 1;
        const startYear = curMonth >= 7 ? now.getFullYear() : now.getFullYear() - 1;
        const currentAcademicYear = `${startYear}/${startYear + 1}`;
        const studentNis = String(selectedStudent.nis || selectedStudent.id).trim();

        // 2. Eksekusi Atomic Batch Transfer di Cloudflare D1 (Master Siswa, Records, BK, Permisi, Perwalian, E-Rapor, Peminatan)
        if (cfClient && cfClient.enabled) {
            btnExec.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Memindahkan relasi data di Cloudflare D1...';
            await cfClient.transferStudentClass({
                nis: studentNis,
                from_class: fromClass,
                to_class: targetClass,
                academic_year: currentAcademicYear
            });
            await cfClient.saveSystemSetting('metadata', { lastUpdateStudents: Date.now() });
        }

        // 3. Sinkronkan perpindahan kelas di Supabase PostgreSQL (Presensi & Perpustakaan)
        const sbClient = supabase || window.supabase;
        if (sbClient) {
            btnExec.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Memperbarui data kelas di Supabase...';
            try {
                // A. Presensi Harian Siswa
                const { error: sbPresensiErr } = await sbClient
                    .from('siswa_presensi')
                    .update({ kelas: targetClass, updated_at: new Date().toISOString() })
                    .eq('student_nis', studentNis)
                    .eq('kelas', fromClass);
                if (sbPresensiErr) console.warn('[Settings] Supabase siswa_presensi class transfer warning:', sbPresensiErr);

                // B. Peminjaman Buku Perpustakaan Aktif
                const { error: sbSirkulasiErr } = await sbClient
                    .from('lib_sirkulasi')
                    .update({ peminjam_kelas: targetClass, updated_at: new Date().toISOString() })
                    .eq('peminjam_id', studentNis)
                    .eq('peminjam_kelas', fromClass)
                    .eq('status', 'dipinjam');
                if (sbSirkulasiErr) console.warn('[Settings] Supabase lib_sirkulasi transfer warning:', sbSirkulasiErr);

                // C. Surat Bebas Pustaka
                const { error: sbBebasErr } = await sbClient
                    .from('lib_bebas_pustaka')
                    .update({ student_class: targetClass })
                    .eq('student_nis', studentNis)
                    .eq('student_class', fromClass);
                if (sbBebasErr) console.warn('[Settings] Supabase lib_bebas_pustaka transfer warning:', sbBebasErr);
            } catch (sbMoveErr) {
                console.warn('[Settings] Supabase class transfer exception:', sbMoveErr);
            }
        }

        // 4. Catat Log Audit Mutasi di Firestore
        btnExec.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Mencatat log audit mutasi...';
        const ttlDate = new Date(Date.now() + (100 * 24 * 60 * 60 * 1000));
        const currentActorName = auth.currentUser?.displayName || auth.currentUser?.email || localStorage.getItem('user_name') || 'Super Admin';
        await addDoc(collection(db, 'class_transfers'), {
            studentId: selectedStudent.id,
            nis: studentNis,
            name: selectedStudent.name || '-',
            fromClass: fromClass,
            toClass: targetClass,
            academicYear: currentAcademicYear,
            movedAt: serverTimestamp(),
            movedByUid: auth.currentUser?.uid || null,
            movedByName: currentActorName,
            ttldelete: Timestamp.fromDate(ttlDate)
        });

        // 5. Update array memori lokal
        const targetIdx = transferStudentsSettings.findIndex(s => s.id === selectedStudent.id || s.nis === selectedStudent.nis);
        if (targetIdx !== -1) {
            transferStudentsSettings[targetIdx].class = targetClass;
        }

        // 6. Paksa refresh cache agar data Cloudflare D1 & IndexedDB selalu sinkron
        if (typeof window.invalidateStudentsCache === 'function') {
            window.invalidateStudentsCache();
        }
        if (typeof window.getStudentsCache === 'function') {
            await window.getStudentsCache(true);
        }
        if (typeof window.invalidateStudentAggregatesCache === 'function') {
            window.invalidateStudentAggregatesCache();
        }
        localStorage.removeItem('simas_kelas_list_cache');

        allKelasListSettings = [];
        await loadAllKelasForSettings();
        renderTransferStudents(searchInput?.value || '');

        window.closeTransferClassModal();
        showModernAlert(
            'Pindah Kelas Berhasil',
            `<div class="text-left text-sm space-y-2">
                <p><i class="fa-solid fa-user text-indigo-500 w-5"></i> Siswa: <b>${escapeHtml(selectedStudent.name)}</b> (${escapeHtml(studentNis)})</p>
                <p><i class="fa-solid fa-arrow-right-arrow-left text-indigo-500 w-5"></i> Mutasi Rombel: <span class="line-through text-slate-400">${escapeHtml(fromClass)}</span> -> <b class="text-emerald-600">${escapeHtml(targetClass)}</b></p>
                <div class="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 p-2 rounded-lg border border-slate-200 dark:border-slate-700">
                    <p class="font-semibold text-emerald-600 mb-1"><i class="fa-solid fa-circle-check mr-1"></i> Data Berhasil Diselaraskan:</p>
                    <ul class="list-disc list-inside space-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        <li>Master Siswa & D1 Database</li>
                        <li>Presensi Harian & Riwayat Kehadiran</li>
                        <li>Catatan Kedisiplinan, Poin, & BK</li>
                        <li>Izin Permisi & Perwalian Siswa</li>
                        <li>Peminjaman Perpustakaan Aktif</li>
                    </ul>
                </div>
            </div>`
        );
    } catch (e) {
        console.error('Error pindah kelas siswa:', e);
        showModernAlert('Gagal Pindah Kelas', e.message, 'error');
    } finally {
        btnExec.innerHTML = originalBtnHTML;
        btnExec.disabled = false;
    }
};

// 4. Config Toggle Show Alumni & Two-Step Permission
window.saveGeneralConfig = async () => {
    const showAlumni = document.getElementById('toggle-show-alumni').checked;
    const twoStepPermission = document.getElementById('toggle-two-step-permission').checked;
    const maintenanceMode = document.getElementById('toggle-maintenance').checked;
    const allowStudentLogin = document.getElementById('toggle-allow-student-login').checked;

    try {
        await setDoc(doc(db, PATHS.settings, 'system_config'), {
            showAlumni: showAlumni,
            twoStepPermission: twoStepPermission,
            maintenanceMode: maintenanceMode,
            allowStudentLogin: allowStudentLogin
        }, { merge: true });
        if (typeof window.invalidateSystemConfig === 'function') window.invalidateSystemConfig();

        // Update UI status text
        const statusAlumni = document.getElementById('status-alumni');
        if (statusAlumni) statusAlumni.innerText = showAlumni ? 'Aktif' : 'Nonaktif';

        const statusTwoStep = document.getElementById('status-two-step');
        if (statusTwoStep) statusTwoStep.innerText = twoStepPermission ? 'Aktif' : 'Nonaktif';

        const statusMaintenance = document.getElementById('status-maintenance');
        if (statusMaintenance) statusMaintenance.innerText = maintenanceMode ? 'Aktif' : 'Nonaktif';

        const statusAllowStudentLogin = document.getElementById('status-allow-student-login');
        if (statusAllowStudentLogin) statusAllowStudentLogin.innerText = allowStudentLogin ? 'Aktif' : 'Nonaktif';

        // Determine which setting changed for feedback
        const changes = [];
        changes.push(`Tampilkan Alumni: <b>${showAlumni ? 'ON' : 'OFF'}</b>`);
        changes.push(`Permisi 2 Tahap: <b>${twoStepPermission ? 'AKTIF' : 'NONAKTIF'}</b>`);
        changes.push(`Mode Pemeliharaan: <b>${maintenanceMode ? 'AKTIF' : 'NONAKTIF'}</b>`);
        changes.push(`Izinkan Siswa Login: <b>${allowStudentLogin ? 'AKTIF' : 'NONAKTIF'}</b>`);

        if (typeof window.logAudit === 'function') {
            window.logAudit('UPDATE_SYSTEM_CONFIG', 'system_config', null, { showAlumni, twoStepPermission, maintenanceMode, allowStudentLogin }, `Mengubah pengaturan: ${changes.join(', ').replace(/(<([^>]+)>)/gi, "")}`);
        }

        showModernAlert("Pengaturan Disimpan", changes.join('<br>'));
    } catch (e) { console.error(e); }
};

// --- 4.B WHATSAPP INTEGRATION (FONNTE) CONFIGURATION ---
// Load Config saat start
async function loadGeneralConfig(preFetchedSnap = null) {
    try {
        const snap = preFetchedSnap || await getDoc(doc(db, PATHS.settings, 'system_config'));
        if (snap.exists()) {
            const data = snap.data();

            // Show Alumni Toggle
            const toggleAlumni = document.getElementById('toggle-show-alumni');
            if (toggleAlumni) {
                toggleAlumni.checked = data.showAlumni || false;
                const statusAlumni = document.getElementById('status-alumni');
                if (statusAlumni) statusAlumni.innerText = data.showAlumni ? 'Aktif' : 'Nonaktif';
            }

            // Two-Step Permission Toggle
            const toggleTwoStep = document.getElementById('toggle-two-step-permission');
            if (toggleTwoStep) {
                toggleTwoStep.checked = data.twoStepPermission || false;
                const statusTwoStep = document.getElementById('status-two-step');
                if (statusTwoStep) statusTwoStep.innerText = data.twoStepPermission ? 'Aktif' : 'Nonaktif';
            }

            // Maintenance Mode Toggle
            const toggleMaintenance = document.getElementById('toggle-maintenance');
            if (toggleMaintenance) {
                toggleMaintenance.checked = data.maintenanceMode || false;
                const statusMaintenance = document.getElementById('status-maintenance');
                if (statusMaintenance) statusMaintenance.innerText = data.maintenanceMode ? 'Aktif' : 'Nonaktif';
            }

            // Allow Student Login Toggle
            const toggleAllowStudentLogin = document.getElementById('toggle-allow-student-login');
            if (toggleAllowStudentLogin) {
                const isAllowed = data.allowStudentLogin !== false;
                toggleAllowStudentLogin.checked = isAllowed;
                const statusAllowStudentLogin = document.getElementById('status-allow-student-login');
                if (statusAllowStudentLogin) statusAllowStudentLogin.innerText = isAllowed ? 'Aktif' : 'Nonaktif';
            }

            // AI Gemini Model Config Inputs
            const aiModelInput = document.getElementById('ai-model-id');
            const aiDisplayNameInput = document.getElementById('ai-model-display-name');
            if (aiModelInput && aiDisplayNameInput) {
                const modelVal = data.geminiModel || (typeof AI_CONFIG !== 'undefined' ? AI_CONFIG.model : "");
                const displayNameVal = data.geminiDisplayName || (typeof AI_CONFIG !== 'undefined' ? AI_CONFIG.displayName : "Gemini AI");
                aiModelInput.value = modelVal;
                aiDisplayNameInput.value = displayNameVal;
                // Sync cache
                localStorage.setItem('simas_gemini_model', modelVal);
                localStorage.setItem('simas_gemini_display_name', displayNameVal);
            }
        }
    } catch (e) { console.error('[Settings] Error loading general config:', e); }
}

// 4.C Save Gemini AI Model Config (Khusus Super Admin)
window.saveAiModelConfig = async () => {
    const role = localStorage.getItem('user_role');
    let isSuperAdminUser = role === 'super_admin';
    if (!isSuperAdminUser && typeof window.hasRole === 'function') {
        isSuperAdminUser = window.hasRole('super_admin');
    }
    if (!isSuperAdminUser) {
        showModernAlert("Akses Ditolak", "Hanya Super Admin yang dapat mengubah konfigurasi Model AI Gemini.", "error");
        return;
    }

    const aiModelInput = document.getElementById('ai-model-id');
    const aiDisplayNameInput = document.getElementById('ai-model-display-name');
    
    if (!aiModelInput || !aiDisplayNameInput) return;

    const geminiModel = aiModelInput.value.trim();
    const geminiDisplayName = aiDisplayNameInput.value.trim();

    if (!geminiModel || !geminiDisplayName) {
        showModernAlert("Input Tidak Lengkap", "Harap isi Model ID dan Nama Tampilan Gemini AI.", "error");
        return;
    }

    try {
        await setDoc(doc(db, PATHS.settings, 'system_config'), {
            geminiModel: geminiModel,
            geminiDisplayName: geminiDisplayName
        }, { merge: true });
        if (typeof window.invalidateSystemConfig === 'function') window.invalidateSystemConfig();

        // Update localStorage cache
        localStorage.setItem('simas_gemini_model', geminiModel);
        localStorage.setItem('simas_gemini_display_name', geminiDisplayName);

        if (typeof window.logAudit === 'function') {
            window.logAudit('UPDATE_SYSTEM_CONFIG', 'system_config', null, { geminiModel, geminiDisplayName }, `Mengubah model AI Gemini ke: ${geminiModel} (${geminiDisplayName})`);
        }

        showModernAlert("Pengaturan AI Disimpan", `Model Gemini AI berhasil diperbarui:<br>Model ID: <b>${geminiModel}</b><br>Display Name: <b>${geminiDisplayName}</b>`);
    } catch (e) {
        console.error("[Settings] Error saving AI model config:", e);
        showModernAlert("Gagal Menyimpan", e.message, "error");
    }
};

// ============== KELAS AKTIF SISTEM CONFIG ==============
let allClassesForAttendance = [];

async function loadActiveClassesConfig(preFetchedMetaDoc = null, preFetchedActiveSetting = null, legacyConfigSnap = null) {
    const container = document.getElementById('checklist-active-classes');
    if (!container) return;

    try {
        // 1. Load daftar semua kelas dari Cloudflare D1 system_settings
        let classList = [];
        let activeSetting = preFetchedActiveSetting;
        if (preFetchedMetaDoc) {
            classList = Array.isArray(preFetchedMetaDoc.list) ? preFetchedMetaDoc.list : (Array.isArray(preFetchedMetaDoc) ? preFetchedMetaDoc : (preFetchedMetaDoc.data?.()?.list || []));
        } else if (window.cfClient && window.cfClient.enabled) {
            const classSettings = await window.cfClient.getSystemSettings(['metadata_classes', 'active_classes']);
            classList = classSettings?.metadata_classes?.list || [];
            activeSetting = classSettings?.active_classes || null;
        }

        if (!classList || classList.length === 0) {
            container.innerHTML = '<p class="col-span-full text-center text-slate-400 text-xs py-2">Belum ada data kelas. Silakan sync metadata terlebih dahulu.</p>';
            return;
        }

        allClassesForAttendance = classList
            .filter(c => !c.toLowerCase().includes('alumni'))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

        // 2. D1 active_classes adalah satu-satunya sumber konfigurasi kelas aktif
        let activeClasses = Array.isArray(activeSetting)
            ? activeSetting
            : (Array.isArray(activeSetting?.list) ? activeSetting.list : null);

        // Migrasi satu kali: hanya ketika active_classes belum ada di D1.
        // Snapshot Firestore ini sudah dibaca untuk pengaturan umum halaman,
        // sehingga tidak menambah read khusus untuk konfigurasi kelas.
        if (activeClasses === null && legacyConfigSnap?.exists?.()) {
            const legacyConfig = legacyConfigSnap.data() || {};
            const legacyClasses = legacyConfig.activeClasses || legacyConfig.activeAttendanceClasses;
            activeClasses = Array.isArray(legacyClasses) && legacyClasses.length > 0
                ? legacyClasses.filter(c => allClassesForAttendance.includes(c))
                : [...allClassesForAttendance];

            if (window.cfClient && window.cfClient.enabled && activeClasses.length > 0) {
                await window.cfClient.saveSystemSetting('active_classes', { list: activeClasses });
                console.log('[ActiveClasses] Konfigurasi lama berhasil dimigrasikan satu kali ke D1.');
            }
        }
        if (Array.isArray(activeClasses) && activeClasses.length === 0) activeClasses = null;

        // Default: semua kelas aktif jika belum pernah dikonfigurasi
        const isAllActive = activeClasses === null;

        // 3. Render checklist
        container.innerHTML = allClassesForAttendance.map(c => {
            const isChecked = isAllActive || activeClasses.includes(c);
            return `
                <label class="flex items-center justify-center gap-1 text-[11px] font-semibold text-slate-700 cursor-pointer bg-white px-2 py-1 rounded-md border border-slate-200 hover:border-amber-300 hover:bg-amber-50/50 transition-all select-none shadow-2xs">
                    <input type="checkbox" class="cb-active-class accent-amber-600 w-3 h-3 cursor-pointer" value="${c}" ${isChecked ? 'checked' : ''}>
                    <span>${c}</span>
                </label>
            `;
        }).join('');

        // Perbarui badge saat render awal maupun ketika checkbox individual berubah.
        container.onchange = updateActiveClassesCount;
        updateActiveClassesCount();

    } catch (e) {
        console.error("Gagal load daftar kelas aktif:", e);
        container.innerHTML = '<p class="col-span-full text-center text-rose-500 text-xs py-2">Gagal memuat daftar kelas.</p>';
    }
};

// Unified config loader for Settings page
window.loadUnifiedSettingsConfig = async function() {
    try {
        const [systemConfigSnap, classSettings] = await Promise.all([
            getDoc(doc(db, PATHS.settings, 'system_config')),
            (window.cfClient && window.cfClient.enabled)
                ? window.cfClient.getSystemSettings(['metadata_classes', 'active_classes'])
                : null
        ]);
        
        loadGeneralConfig(systemConfigSnap);
        loadActiveClassesConfig(classSettings?.metadata_classes, classSettings?.active_classes, systemConfigSnap);
    } catch (e) {
        console.error("Error on unified onload configuration:", e);
        loadGeneralConfig();
        loadActiveClassesConfig();
    }
};

function updateActiveClassesCount() {
    const countEl = document.getElementById('active-classes-count');
    if (!countEl) return;
    const total = document.querySelectorAll('.cb-active-class').length;
    const checked = document.querySelectorAll('.cb-active-class:checked').length;
    countEl.textContent = `${checked} dari ${total} kelas aktif`;

    // Color feedback
    if (checked === total) {
        countEl.className = 'text-xs text-green-600 font-medium';
    } else if (checked === 0) {
        countEl.className = 'text-xs text-red-500 font-medium';
    } else {
        countEl.className = 'text-xs text-amber-600 font-medium';
    }
}

window.toggleAllAttendanceClasses = (selectAll) => {
    const checkboxes = document.querySelectorAll('.cb-active-class');
    checkboxes.forEach(cb => cb.checked = selectAll);
    updateActiveClassesCount();
};

window.saveActiveClassesConfig = async () => {
    const allCheckboxes = document.querySelectorAll('.cb-active-class');
    const activeClasses = Array.from(document.querySelectorAll('.cb-active-class:checked')).map(cb => cb.value);

    if (activeClasses.length === 0) {
        showModernAlert('Peringatan', 'Minimal harus ada satu kelas yang aktif.');
        return;
    }

    try {
        if (!window.cfClient || !window.cfClient.enabled) {
            throw new Error('Layanan Cloudflare D1 sedang tidak tersedia. Silakan coba kembali.');
        }

        // Simpan hanya ke SSOT D1 agar seluruh dropdown operasional,
        // termasuk Jurnal, memakai pilihan kelas yang sama.
        await window.cfClient.saveSystemSetting('active_classes', { list: activeClasses });

        // Invalidasi cache agar semua halaman ambil data terbaru
        if (typeof window.invalidateActiveClassesCache === 'function') {
            window.invalidateActiveClassesCache();
        }

        const total = allCheckboxes.length;
        const excluded = total - activeClasses.length;

        if (typeof window.logAudit === 'function') {
            window.logAudit('UPDATE_ACTIVE_CLASSES', 'active_classes', null,
                { activeCount: activeClasses.length, totalCount: total },
                `Mengubah kelas aktif sistem: ${activeClasses.length}/${total} kelas aktif`);
        }

        showModernAlert(
            'Kelas Aktif Sistem Disimpan',
            `<div class="text-left text-sm space-y-1">
                <p><i class="fa-solid fa-check-circle text-green-500 w-5"></i> Kelas aktif: <b>${activeClasses.length}</b></p>
                <p><i class="fa-solid fa-eye-slash text-slate-400 w-5"></i> Dikecualikan: <b>${excluded}</b></p>
                <p class="text-xs text-slate-400 mt-1"><i class="fa-solid fa-info-circle w-5"></i> Berlaku di seluruh modul sistem</p>
            </div>`
        );
    } catch (e) {
        console.error('Error saving active classes config:', e);
        showModernAlert('Gagal Menyimpan', e.message, 'error');
    }
};

window.onload = async () => {
    try {
        // Firestore tetap dibaca untuk pengaturan umum; konfigurasi kelas hanya dari D1.
        const [systemConfigSnap, classSettings] = await Promise.all([
            getDoc(doc(db, PATHS.settings, 'system_config')),
            (window.cfClient && window.cfClient.enabled)
                ? window.cfClient.getSystemSettings(['metadata_classes', 'active_classes'])
                : null
        ]);
        
        // Pass the pre-fetched snapshots to the functions
        loadGeneralConfig(systemConfigSnap);
        loadActiveClassesConfig(classSettings?.metadata_classes, classSettings?.active_classes, systemConfigSnap);
    } catch (e) {
        console.error("Error on unified onload configuration:", e);
        // Fallback in case of errors
        loadGeneralConfig();
        loadActiveClassesConfig();
    }
};

// (E-Laboratorium management dipindahkan ke page-e-lab.js)

// ============== BACKUP DATA (SUPER ADMIN ONLY) ==============

// Helper: Konversi Firestore Timestamp ke ISO String (agar JSON kompatibel)
function serializeFirestoreData(data) {
    if (!data || typeof data !== 'object') return data;

    if (data.toDate && typeof data.toDate === 'function') {
        return data.toDate().toISOString();
    }

    if (Array.isArray(data)) {
        return data.map(item => serializeFirestoreData(item));
    }

    const result = {};
    for (const key of Object.keys(data)) {
        result[key] = serializeFirestoreData(data[key]);
    }
    return result;
}

// Helper: Ambil seluruh dokumen koleksi Firestore
async function fetchFirestoreCollection(colName) {
    const snap = await getDocs(collection(db, colName));
    const docs = {};
    snap.forEach(docSnap => {
        docs[docSnap.id] = serializeFirestoreData(docSnap.data());
    });
    return {
        _count: snap.size,
        documents: docs
    };
}

// Helper: Ambil seluruh data tabel Supabase dengan paging otomatis
async function fetchAllFromSupabase(tableName) {
    if (!supabase) {
        console.warn(`[fetchAllFromSupabase] Client Supabase tidak tersedia untuk tabel ${tableName}`);
        return [];
    }
    let allData = [];
    const PAGE_SIZE = 1000;
    let from = 0;
    let hasMore = true;

    while (hasMore) {
        const { data, error } = await supabase
            .from(tableName)
            .select('*')
            .range(from, from + PAGE_SIZE - 1);

        if (error) throw error;
        if (!data || data.length === 0) break;

        allData.push(...data);
        if (data.length < PAGE_SIZE) {
            hasMore = false;
        } else {
            from += PAGE_SIZE;
        }
    }
    return allData;
}

// Registry 56 Entitas SSOT Database SIMAS - SHAKTI (Cloudflare D1, Firestore, Supabase)
export const BACKUP_REGISTRY = {
    // 🟦 Cloudflare D1 Serverless SQL (24 tabel)
    students: {
        db: 'd1',
        label: 'Master Data Siswa',
        icon: 'fa-user-graduate',
        fetch: async () => await cfClient.getStudents({ status: 'all', limit: 2000 })
    },
    gtk: {
        db: 'd1',
        label: 'Master Data GTK & Guru',
        icon: 'fa-chalkboard-user',
        fetch: async () => await cfClient.getGtk({ status: 'all', limit: 2000 })
    },
    records: {
        db: 'd1',
        label: 'Catatan Karakter Siswa',
        icon: 'fa-clipboard-list',
        fetch: async () => await cfClient.getRecords({ limit: 10000 })
    },
    student_aggregates: {
        db: 'd1',
        label: 'Agregat Poin Kedisiplinan',
        icon: 'fa-calculator',
        fetch: async () => await cfClient.getStudentAggregates()
    },
    bk_actions: {
        db: 'd1',
        label: 'Tindakan & Bimbingan BK',
        icon: 'fa-handshake-angle',
        fetch: async () => await cfClient.getBkActions({ limit: 10000 })
    },
    violation_types: {
        db: 'd1',
        label: 'Master Tata Tertib & Poin Pelanggaran',
        icon: 'fa-gavel',
        fetch: async () => await cfClient.getViolationTypes()
    },
    guru_wali_assignments: {
        db: 'd1',
        label: 'Plotting Guru Wali Siswa',
        icon: 'fa-users-rectangle',
        fetch: async () => await cfClient.getGuruWaliAssignments()
    },
    guru_wali_notes: {
        db: 'd1',
        label: 'Catatan Bimbingan Perwalian',
        icon: 'fa-note-sticky',
        fetch: async () => await cfClient.getGuruWaliNotes({ limit: 10000 })
    },
    walikelas_notes: {
        db: 'd1',
        label: 'Catatan Khusus Wali Kelas',
        icon: 'fa-comment-dots',
        fetch: async () => await cfClient.getWalikelasNotes({ limit: 10000 })
    },
    permisi_requests: {
        db: 'd1',
        label: 'Dispensasi & Izin Keluar Masuk',
        icon: 'fa-door-open',
        fetch: async () => await cfClient.getPermisiRequests({ limit: 10000 })
    },
    rapor_scores: {
        db: 'd1',
        label: 'Nilai Rapor & Leger Akademik',
        icon: 'fa-graduation-cap',
        fetch: async () => await cfClient.getRaporScores({ limit: 10000 })
    },
    labs: {
        db: 'd1',
        label: 'Master Laboratorium & Ruang Khusus',
        icon: 'fa-flask-vial',
        fetch: async () => await cfClient.getLabs()
    },
    lab_bookings: {
        db: 'd1',
        label: 'Reservasi & Peminjaman Lab',
        icon: 'fa-calendar-check',
        fetch: async () => await cfClient.getLabBookings({ limit: 10000 })
    },
    jurnal_guru: {
        db: 'd1',
        label: 'Jurnal Mengajar Guru (KBM)',
        icon: 'fa-book-bookmark',
        fetch: async () => await cfClient.getJurnalKbm({ limit: 10000 })
    },
    master_mapel: {
        db: 'd1',
        label: 'Master Mata Pelajaran',
        icon: 'fa-book-open',
        fetch: async () => (await cfClient.getJurnalMaster({ refresh: true }))?.mapels || []
    },
    master_lokasi: {
        db: 'd1',
        label: 'Master Lokasi & Ruangan',
        icon: 'fa-location-dot',
        fetch: async () => (await cfClient.getJurnalMaster({ refresh: true }))?.lokasis || []
    },
    calendar_events: {
        db: 'd1',
        label: 'Kalender & Agenda Sekolah',
        icon: 'fa-calendar-days',
        fetch: async () => await cfClient.getAgendaEvents('%')
    },
    agenda_documents: {
        db: 'd1',
        label: 'Arsip Dokumen & Surat Digital',
        icon: 'fa-folder-tree',
        fetch: async () => await cfClient.getAgendaDocuments('all')
    },
    employee_task_groups: {
        db: 'd1',
        label: 'Kelompok Tugas Pokok Pegawai',
        icon: 'fa-layer-group',
        fetch: async () => (await cfClient.getEmployeeAgendaTasks())?.groups || []
    },
    employee_task_items: {
        db: 'd1',
        label: 'Rincian Butir Tugas Pegawai',
        icon: 'fa-list-check',
        fetch: async () => (await cfClient.getEmployeeAgendaTasks())?.items || []
    },
    employee_assignments: {
        db: 'd1',
        label: 'Plotting Penugasan Pegawai',
        icon: 'fa-user-tag',
        fetch: async () => await cfClient.getEmployeeAssignments()
    },
    employee_activities: {
        db: 'd1',
        label: 'Log Aktivitas Harian Pegawai',
        icon: 'fa-calendar-check',
        fetch: async () => (await cfClient.getEmployeeActivities({ limit: 10000 }))?.data || []
    },
    peminatan_config: {
        db: 'd1',
        label: 'Konfigurasi Survei Peminatan',
        icon: 'fa-sliders',
        fetch: async () => await cfClient.getPeminatanConfig()
    },
    peminatan_responses: {
        db: 'd1',
        label: 'Respon Angket Peminatan Siswa',
        icon: 'fa-square-poll-vertical',
        fetch: async () => {
            const cfg = await cfClient.getPeminatanConfig().catch(() => null);
            const yr = cfg?.year || new Date().getFullYear().toString();
            return await cfClient.getPeminatanResponses({ year: yr });
        }
    },
    pid_games: {
        db: 'd1',
        label: 'Pojok Inovasi Digital & Game Edukasi',
        icon: 'fa-gamepad',
        fetch: async () => await cfClient.getPidGames({ status: 'all' })
    },
    system_settings: {
        db: 'd1',
        label: 'Pengaturan Konfigurasi Sistem Edge',
        icon: 'fa-gears',
        fetch: async () => await cfClient.getSystemSettings()
    },
    login_history: {
        db: 'supabase',
        label: 'Riwayat Sesi Login (Telemetri)',
        icon: 'fa-timeline',
        fetch: async () => await cfClient.getLoginHistory({ limit: 5000 })
    },
    audit_logs: {
        db: 'supabase',
        label: 'Log Audit Keamanan & Jejak Forensik',
        icon: 'fa-shield-halved',
        fetch: async () => await cfClient.getAuditLogs({ limit: 5000 })
    },


    // 🟨 Firebase Firestore (5 koleksi)
    users: {
        db: 'firestore',
        label: 'Data Akun Pengguna & Hak Akses (RBAC)',
        icon: 'fa-users-gear',
        fetch: async () => await fetchFirestoreCollection('users')
    },
    user_secrets: {
        db: 'firestore',
        label: 'Kredensial Keamanan & API Passkey',
        icon: 'fa-key',
        fetch: async () => await fetchFirestoreCollection('user_secrets')
    },
    settings: {
        db: 'firestore',
        label: 'Pengaturan Global Aplikasi SIMAS',
        icon: 'fa-gear',
        fetch: async () => await fetchFirestoreCollection('settings')
    },
    class_transfers: {
        db: 'firestore',
        label: 'Log Audit Mutasi Kelas Siswa',
        icon: 'fa-arrow-right-arrow-left',
        fetch: async () => await fetchFirestoreCollection('class_transfers')
    },
    kapsul_waktu: {
        db: 'firestore',
        label: 'Pesan Kapsul Waktu Digital Siswa',
        icon: 'fa-hourglass-half',
        fetch: async () => await fetchFirestoreCollection('kapsul_waktu')
    },

    // 🟩 Supabase PostgreSQL (27 tabel)
    siswa_presensi_harian: {
        db: 'supabase',
        label: 'Presensi Harian Siswa (Barcode / Face)',
        icon: 'fa-qrcode',
        fetch: async () => await fetchAllFromSupabase('siswa_presensi_harian')
    },
    siswa_presensi: {
        db: 'supabase',
        label: 'Presensi Siswa per Pertemuan Mapel',
        icon: 'fa-user-check',
        fetch: async () => await fetchAllFromSupabase('siswa_presensi')
    },
    guru_presensi: {
        db: 'supabase',
        label: 'Presensi Kehadiran Guru & Staf',
        icon: 'fa-clipboard-user',
        fetch: async () => await fetchAllFromSupabase('guru_presensi')
    },
    finance_transactions: {
        db: 'supabase',
        label: 'Transaksi Keuangan & Pembayaran',
        icon: 'fa-receipt',
        fetch: async () => await fetchAllFromSupabase('finance_transactions')
    },
    finance_cashflow: {
        db: 'supabase',
        label: 'Buku Kas & Arus Keuangan Sekolah',
        icon: 'fa-money-bill-wave',
        fetch: async () => await fetchAllFromSupabase('finance_cashflow')
    },
    finance_closings: {
        db: 'supabase',
        label: 'Tutup Buku Kas Bulanan',
        icon: 'fa-folder-closed',
        fetch: async () => await fetchAllFromSupabase('finance_closings')
    },
    finance_daily_summary: {
        db: 'supabase',
        label: 'Rekapitulasi Keuangan Harian',
        icon: 'fa-chart-pie',
        fetch: async () => await fetchAllFromSupabase('finance_daily_summary')
    },
    finance_config: {
        db: 'supabase',
        label: 'Konfigurasi Pos & Tarif Keuangan',
        icon: 'fa-file-invoice-dollar',
        fetch: async () => await fetchAllFromSupabase('finance_config')
    },
    guru_mapel_gradebooks: {
        db: 'supabase',
        label: 'Buku Nilai Guru Mata Pelajaran',
        icon: 'fa-book',
        fetch: async () => await fetchAllFromSupabase('guru_mapel_gradebooks')
    },
    guru_mapel_components: {
        db: 'supabase',
        label: 'Komponen Penilaian & Bobot Nilai',
        icon: 'fa-percent',
        fetch: async () => await fetchAllFromSupabase('guru_mapel_components')
    },
    guru_mapel_scores: {
        db: 'supabase',
        label: 'Rincian Skor Siswa per Penilaian',
        icon: 'fa-list-ol',
        fetch: async () => await fetchAllFromSupabase('guru_mapel_scores')
    },
    guru_mapel_summaries: {
        db: 'supabase',
        label: 'Rangkuman & Predikat Nilai Akhir Mapel',
        icon: 'fa-chart-line',
        fetch: async () => await fetchAllFromSupabase('guru_mapel_summaries')
    },
    lib_buku: {
        db: 'supabase',
        label: 'Katalog Koleksi Buku Perpustakaan',
        icon: 'fa-book-atlas',
        fetch: async () => await fetchAllFromSupabase('lib_buku')
    },
    lib_eksemplar: {
        db: 'supabase',
        label: 'Inventaris Eksemplar & Barcode Buku',
        icon: 'fa-barcode',
        fetch: async () => await fetchAllFromSupabase('lib_eksemplar')
    },
    lib_sirkulasi: {
        db: 'supabase',
        label: 'Sirkulasi Peminjaman & Pengembalian',
        icon: 'fa-arrow-right-arrow-left',
        fetch: async () => await fetchAllFromSupabase('lib_sirkulasi')
    },
    lib_pengunjung: {
        db: 'supabase',
        label: 'Buku Kunjungan Perpustakaan',
        icon: 'fa-id-card-clip',
        fetch: async () => await fetchAllFromSupabase('lib_pengunjung')
    },
    lib_bebas_pustaka: {
        db: 'supabase',
        label: 'Surat Keterangan Bebas Pustaka',
        icon: 'fa-stamp',
        fetch: async () => await fetchAllFromSupabase('lib_bebas_pustaka')
    },
    lib_kategori_ddc: {
        db: 'supabase',
        label: 'Klasifikasi Dewey Decimal (DDC)',
        icon: 'fa-tags',
        fetch: async () => await fetchAllFromSupabase('lib_kategori_ddc')
    },
    lib_config: {
        db: 'supabase',
        label: 'Pengaturan Jam & Kebijakan Perpustakaan',
        icon: 'fa-book-medical',
        fetch: async () => await fetchAllFromSupabase('lib_config')
    },
    lib_hari_libur: {
        db: 'supabase',
        label: 'Jadwal Hari Libur Operasional Perpus',
        icon: 'fa-calendar-xmark',
        fetch: async () => await fetchAllFromSupabase('lib_hari_libur')
    },
    masukkan_saran: {
        db: 'supabase',
        label: 'Kotak Aspirasi & Suara Warga Sekolah',
        icon: 'fa-bullhorn',
        fetch: async () => await fetchAllFromSupabase('masukkan_saran')
    },
    duta_kandidat: {
        db: 'supabase',
        label: 'Profil Kandidat Duta Literasi & Sekolah',
        icon: 'fa-award',
        fetch: async () => await fetchAllFromSupabase('duta_kandidat')
    },
    duta_suara_masuk: {
        db: 'supabase',
        label: 'Rekapitulasi Voting Pemilihan Duta',
        icon: 'fa-check-to-slot',
        fetch: async () => await fetchAllFromSupabase('duta_suara_masuk')
    },
    sukaduka_config: {
        db: 'supabase',
        label: 'Konfigurasi Paguyuban Suka Duka',
        icon: 'fa-heart-circle-bolt',
        fetch: async () => await fetchAllFromSupabase('sukaduka_config')
    },
    sukaduka_kas: {
        db: 'supabase',
        label: 'Buku Kas Kasih & Santunan Duka',
        icon: 'fa-hand-holding-heart',
        fetch: async () => await fetchAllFromSupabase('sukaduka_kas')
    },
    sukaduka_iuran: {
        db: 'supabase',
        label: 'Catatan Iuran Wajib Anggota Suka Duka',
        icon: 'fa-coins',
        fetch: async () => await fetchAllFromSupabase('sukaduka_iuran')
    },
    sukaduka_closings: {
        db: 'supabase',
        label: 'Tutup Buku Rekapitulasi Kas Suka Duka',
        icon: 'fa-file-shield',
        fetch: async () => await fetchAllFromSupabase('sukaduka_closings')
    }
};

// Aliases untuk kompatibilitas mundur
const BACKUP_COLLECTIONS = Object.keys(BACKUP_REGISTRY);
const BACKUP_COLLECTION_SET = new Set(BACKUP_COLLECTIONS);
const COLLECTION_LABELS = Object.fromEntries(
    Object.entries(BACKUP_REGISTRY).map(([k, v]) => [k, v.label])
);

// State filter kategori aktif pada modal backup
let _activeBackupCategory = 'all';

// Helper: Update Progress Bar
function updateBackupProgress(label, percent) {
    const wrapper = document.getElementById('backup-progress-wrapper');
    const labelEl = document.getElementById('backup-progress-label');
    const pctEl = document.getElementById('backup-progress-pct');
    const barEl = document.getElementById('backup-progress-bar');

    if (wrapper) wrapper.classList.remove('hidden');
    if (labelEl) labelEl.textContent = label;
    if (pctEl) pctEl.textContent = `${Math.round(percent)}%`;
    if (barEl) barEl.style.width = `${percent}%`;
}

// Helper: Reset Progress Bar
function resetBackupProgress() {
    const wrapper = document.getElementById('backup-progress-wrapper');
    if (wrapper) wrapper.classList.add('hidden');
    updateBackupProgress('Memproses...', 0);
}

// Handler: Filter Kategori Database (Tab Pill)
window.filterBackupCategory = (category = 'all') => {
    _activeBackupCategory = category;
    const tabs = [
        { id: 'tab-btn-all', key: 'all', activeBg: 'bg-emerald-600 text-white shadow-sm' },
        { id: 'tab-btn-d1', key: 'd1', activeBg: 'bg-blue-600 text-white shadow-sm' },
        { id: 'tab-btn-firestore', key: 'firestore', activeBg: 'bg-amber-600 text-white shadow-sm' },
        { id: 'tab-btn-supabase', key: 'supabase', activeBg: 'bg-emerald-600 text-white shadow-sm' }
    ];

    tabs.forEach(t => {
        const btn = document.getElementById(t.id);
        if (!btn) return;
        if (t.key === category) {
            btn.className = `backup-tab-btn active px-2.5 py-1 rounded-lg text-[11px] font-bold ${t.activeBg} transition-all`;
        } else {
            btn.className = 'backup-tab-btn px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all';
        }
    });

    const searchInput = document.getElementById('backup-search-input');
    const q = searchInput ? searchInput.value : '';
    window.filterBackupSearch(q);
};

// Handler: Live Search Filter Entitas Backup
window.filterBackupSearch = (query = '') => {
    const q = (query || '').toLowerCase().trim();
    const category = _activeBackupCategory || 'all';

    const groups = {
        d1: document.getElementById('backup-group-d1'),
        firestore: document.getElementById('backup-group-firestore'),
        supabase: document.getElementById('backup-group-supabase')
    };

    ['d1', 'firestore', 'supabase'].forEach(dbKey => {
        const groupEl = groups[dbKey];
        if (!groupEl) return;

        if (category !== 'all' && category !== dbKey) {
            groupEl.classList.add('hidden');
            return;
        }

        const cards = groupEl.querySelectorAll('.backup-item-card');
        let visibleCountInGroup = 0;
        cards.forEach(card => {
            const searchTerms = (card.getAttribute('data-search') || '').toLowerCase();
            const matches = !q || searchTerms.includes(q);
            if (matches) {
                card.classList.remove('hidden');
                visibleCountInGroup++;
            } else {
                card.classList.add('hidden');
            }
        });

        if (visibleCountInGroup === 0) {
            groupEl.classList.add('hidden');
        } else {
            groupEl.classList.remove('hidden');
        }
    });
};

// Handler: Update Total Checkbox Terpilih
window.updateBackupSelectedCount = () => {
    const checked = document.querySelectorAll('.backup-col-check:checked');
    const counterEl = document.getElementById('backup-selected-count');
    if (counterEl) {
        counterEl.textContent = checked.length;
    }
    const btn = document.getElementById('btn-backup-selected');
    if (btn) {
        btn.disabled = checked.length === 0;
        if (checked.length === 0) {
            btn.classList.add('opacity-50', 'cursor-not-allowed');
        } else {
            btn.classList.remove('opacity-50', 'cursor-not-allowed');
        }
    }
};

// Handler: Toggle All Checkboxes (Pilih / Hapus Semua)
window.toggleAllBackupChecks = (checked) => {
    const visibleChecks = document.querySelectorAll('.backup-item-card:not(.hidden) .backup-col-check');
    if (visibleChecks.length > 0) {
        visibleChecks.forEach(cb => { cb.checked = checked; });
    } else {
        document.querySelectorAll('.backup-col-check').forEach(cb => { cb.checked = checked; });
    }
    window.updateBackupSelectedCount();
};

// Core: Eksekusi backup multi-database sequential
async function executeBackup(selectedKeys) {
    const isSuperAdmin = window.hasRole ? window.hasRole('super_admin') : localStorage.getItem('user_role') === 'super_admin';
    if (!isSuperAdmin) {
        showToast('Akses Ditolak', 'Fitur ini hanya untuk Super Admin.', 'error');
        return;
    }

    if (!selectedKeys || selectedKeys.length === 0) {
        showToast('Peringatan', 'Pilih minimal satu koleksi/tabel untuk di-backup.', 'warning');
        return;
    }

    const invalidKeys = selectedKeys.filter(k => !BACKUP_REGISTRY[k]);
    if (invalidKeys.length > 0) {
        showToast('Koleksi Tidak Didukung', `Daftar backup memuat entitas tidak valid: ${invalidKeys.join(', ')}`, 'error');
        return;
    }

    const sourcesSummary = {
        d1: selectedKeys.filter(k => BACKUP_REGISTRY[k].db === 'd1'),
        firestore: selectedKeys.filter(k => BACKUP_REGISTRY[k].db === 'firestore'),
        supabase: selectedKeys.filter(k => BACKUP_REGISTRY[k].db === 'supabase')
    };

    const backupData = {
        _meta: {
            appName: SCHOOL_CONFIG.appBrand,
            backupDate: new Date().toISOString(),
            backupBy: auth.currentUser?.email || 'unknown',
            appVersion: '26.09.04.6',
            sources: sourcesSummary,
            collectionsIncluded: selectedKeys,
            totalCollections: selectedKeys.length,
            totalDocuments: 0
        }
    };

    let totalRecords = 0;
    const dbCounts = { d1: 0, firestore: 0, supabase: 0 };
    const errors = [];

    try {
        // Proses entitas secara sequential (Zero Resource Spike & Anti Thundering-Herd)
        for (let i = 0; i < selectedKeys.length; i++) {
            const key = selectedKeys[i];
            const entry = BACKUP_REGISTRY[key];
            const dbType = entry.db.toUpperCase();
            const percent = (i / selectedKeys.length) * 100;

            updateBackupProgress(`[${i + 1}/${selectedKeys.length}] Mengambil ${entry.label} (${dbType})...`, percent);

            try {
                const fetched = await entry.fetch();
                if (entry.db === 'firestore') {
                    backupData[key] = {
                        _database: 'firestore',
                        _count: fetched?._count || 0,
                        documents: fetched?.documents || {}
                    };
                    const count = fetched?._count || Object.keys(fetched?.documents || {}).length;
                    totalRecords += count;
                    dbCounts.firestore += count;
                } else {
                    const rows = Array.isArray(fetched) ? fetched : (fetched && typeof fetched === 'object' ? [fetched] : []);
                    const rowCount = Array.isArray(fetched) ? fetched.length : (fetched ? 1 : 0);
                    backupData[key] = {
                        _database: entry.db,
                        _count: rowCount,
                        records: fetched
                    };
                    totalRecords += rowCount;
                    dbCounts[entry.db] += rowCount;
                }
            } catch (colErr) {
                console.warn(`[executeBackup] Gagal backup ${key} (${entry.db}):`, colErr.message);
                errors.push({ key, label: entry.label, db: entry.db, error: colErr.message });
                backupData[key] = {
                    _database: entry.db,
                    _count: 0,
                    _error: colErr.message,
                    records: []
                };
            }
        }

        backupData._meta.totalDocuments = totalRecords;
        backupData._meta.totalRecords = totalRecords;
        backupData._meta.recordsBreakdown = dbCounts;
        if (errors.length > 0) {
            backupData._meta.errors = errors;
        }

        updateBackupProgress('Membuat file JSON...', 95);

        const jsonString = JSON.stringify(backupData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const now = new Date();
        const dateStr = window.getLocalISODate ? window.getLocalISODate(now) : now.toISOString().slice(0, 10);
        const timeStr = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
        const isFull = selectedKeys.length === Object.keys(BACKUP_REGISTRY).length;
        const fileName = `SIMAS_Backup_${isFull ? 'Full_' : 'Modular_'}${dateStr}_${timeStr}.json`;

        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        updateBackupProgress('Selesai!', 100);

        // Audit Log
        if (typeof window.logAudit === 'function') {
            window.logAudit('SUPER_ADMIN_ACTION', 'backup_database', null, { 
                totalSelected: selectedKeys.length, 
                totalRecords: totalRecords, 
                sources: sourcesSummary,
                fileName: fileName,
                errors: errors.length > 0 ? errors : undefined
            }, `Melakukan backup database (${selectedKeys.length} entitas, ${totalRecords} baris data) ke file ${fileName}`);
        }

        // Alert Rangkuman
        let errorNote = '';
        if (errors.length > 0) {
            errorNote = `
                <div class="p-2 bg-amber-50 dark:bg-amber-900/30 rounded border border-amber-200 dark:border-amber-700 text-xs text-amber-700 dark:text-amber-300">
                    <p class="font-bold mb-1"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Catatan Kegagalan (${errors.length}):</p>
                    <ul class="list-disc ml-4 space-y-0.5">
                        ${errors.map(e => `<li>${e.label}: ${e.error}</li>`).join('')}
                    </ul>
                </div>
            `;
        }

        showModernAlert(
            errors.length === 0 ? 'Backup Berhasil!' : 'Backup Selesai dengan Catatan',
            `<div class="text-left text-sm space-y-3">
                <p><i class="fa-solid fa-file-arrow-down text-emerald-500 mr-1.5"></i> File: <b>${fileName}</b></p>
                <div class="grid grid-cols-3 gap-2 text-xs py-1">
                    <div class="p-2 bg-blue-50 dark:bg-blue-900/30 rounded border border-blue-100 dark:border-blue-800">
                        <span class="text-blue-600 font-bold block">Cloudflare D1</span>
                        <span class="text-slate-600 dark:text-slate-300">${sourcesSummary.d1.length} tabel (${dbCounts.d1.toLocaleString('id-ID')} row)</span>
                    </div>
                    <div class="p-2 bg-amber-50 dark:bg-amber-900/30 rounded border border-amber-100 dark:border-amber-800">
                        <span class="text-amber-600 font-bold block">Firestore</span>
                        <span class="text-slate-600 dark:text-slate-300">${sourcesSummary.firestore.length} kol (${dbCounts.firestore.toLocaleString('id-ID')} doc)</span>
                    </div>
                    <div class="p-2 bg-emerald-50 dark:bg-emerald-900/30 rounded border border-emerald-100 dark:border-emerald-800">
                        <span class="text-emerald-600 font-bold block">Supabase</span>
                        <span class="text-slate-600 dark:text-slate-300">${sourcesSummary.supabase.length} tabel (${dbCounts.supabase.toLocaleString('id-ID')} row)</span>
                    </div>
                </div>
                <p><i class="fa-solid fa-database text-indigo-500 mr-1.5"></i> Total: <b>${selectedKeys.length} Entitas (${totalRecords.toLocaleString('id-ID')} Data)</b></p>
                ${errorNote}
                <p class="text-[11px] text-slate-400"><i class="fa-solid fa-circle-info mr-1"></i>File tersimpan di folder Unduhan (Downloads) perangkat Anda.</p>
            </div>`,
            errors.length === 0 ? 'success' : 'warning'
        );

        setTimeout(() => resetBackupProgress(), 3000);

    } catch (e) {
        console.error('[executeBackup] Fatal error:', e);
        showModernAlert('Backup Gagal', e.message, 'error');
        resetBackupProgress();
    }
}

// === EXPOSED FUNCTIONS (window) ===

// 1. Backup Semua Data (1 klik)
window.backupAllData = async () => {
    const isSuperAdmin = window.hasRole ? window.hasRole('super_admin') : localStorage.getItem('user_role') === 'super_admin';
    if (!isSuperAdmin) {
        showToast('Akses Ditolak', 'Fitur ini hanya untuk Super Admin.', 'error');
        return;
    }

    const allKeys = Object.keys(BACKUP_REGISTRY);
    const confirmed = await showConfirmModal(
        `<div class="text-left">
            <p class="mb-2">Anda akan membackup <b>seluruh data sekolah</b> (${allKeys.length} entitas) dari 3 arsitektur database:</p>
            <ul class="text-xs text-slate-600 dark:text-slate-300 space-y-1 ml-4 mb-3 list-disc">
                <li><b>24 Tabel Cloudflare D1</b> (Siswa, GTK, Nilai, Agenda, Lab, dll.)</li>
                <li><b>5 Koleksi Firestore</b> (Users, Hak Akses, Settings, Kapsul Waktu)</li>
                <li><b>27 Tabel Supabase PostgreSQL</b> (Presensi, Keuangan, E-Perpus, dll.)</li>
            </ul>
            <p class="text-xs text-slate-500"><i class="fa-solid fa-circle-info mr-1"></i>Data diambil berurutan (sequential) untuk efisiensi resource. Estimasi: 15-45 detik.</p>
        </div>`,
        'Backup Semua Data'
    );

    if (!confirmed) return;

    const btn = document.getElementById('btn-backup-all');
    const originalHTML = btn ? btn.innerHTML : '';
    if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        btn.disabled = true;
    }

    await executeBackup(allKeys);

    if (btn) {
        btn.innerHTML = originalHTML;
        btn.disabled = false;
    }
};

// 2. Buka Modal Pilih Koleksi
window.openBackupModal = () => {
    const isSuperAdmin = window.hasRole ? window.hasRole('super_admin') : localStorage.getItem('user_role') === 'super_admin';
    if (!isSuperAdmin) {
        showToast('Akses Ditolak', 'Fitur ini hanya untuk Super Admin.', 'error');
        return;
    }

    resetBackupProgress();
    // Default all checked
    document.querySelectorAll('.backup-col-check').forEach(cb => { cb.checked = true; });
    // Reset search
    const searchInput = document.getElementById('backup-search-input');
    if (searchInput) searchInput.value = '';
    // Reset tab filter to 'all'
    window.filterBackupCategory('all');
    window.updateBackupSelectedCount();

    document.getElementById('modal-backup-data').classList.remove('hidden');
};

// 3. Backup Koleksi Terpilih (dari Modal)
window.backupSelectedData = async () => {
    const checks = document.querySelectorAll('.backup-col-check:checked');
    const selected = Array.from(checks).map(cb => cb.value);

    if (selected.length === 0) {
        showToast('Peringatan', 'Pilih minimal satu koleksi/tabel.', 'warning');
        return;
    }

    const btn = document.getElementById('btn-backup-selected');
    const originalHTML = btn ? btn.innerHTML : '';
    if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Memproses...';
        btn.disabled = true;
    }

    await executeBackup(selected);

    if (btn) {
        btn.innerHTML = originalHTML;
        btn.disabled = false;
    }

    // Tutup modal setelah sukses
    document.getElementById('modal-backup-data').classList.add('hidden');
};

// 4. Toggle All Checkboxes
window.toggleAllBackupChecks = (checked) => {
    const visibleChecks = document.querySelectorAll('.backup-item-card:not(.hidden) .backup-col-check');
    if (visibleChecks.length > 0) {
        visibleChecks.forEach(cb => { cb.checked = checked; });
    } else {
        document.querySelectorAll('.backup-col-check').forEach(cb => { cb.checked = checked; });
    }
    window.updateBackupSelectedCount();
};

// ============== RESTORE DATA (SUPER ADMIN ONLY) ==============

// State: data backup yang sedang di-preview
let _restoreData = null;
function getRestoreRegistry(data) {
    return isAnnualResetBackup(data) ? { ...BACKUP_REGISTRY,
        fcm_tokens: { db: 'd1', label: 'Token Notifikasi Siswa', icon: 'fa-bell' }
    } : BACKUP_REGISTRY;
}

// Helper: Update Restore Progress Bar
function updateRestoreProgress(label, percent) {
    const wrapper = document.getElementById('restore-progress-wrapper');
    const labelEl = document.getElementById('restore-progress-label');
    const pctEl = document.getElementById('restore-progress-pct');
    const barEl = document.getElementById('restore-progress-bar');

    if (wrapper) wrapper.classList.remove('hidden');
    if (labelEl) labelEl.textContent = label;
    if (pctEl) pctEl.textContent = `${Math.round(percent)}%`;
    if (barEl) barEl.style.width = `${percent}%`;
}

function resetRestoreProgress() {
    const wrapper = document.getElementById('restore-progress-wrapper');
    if (wrapper) wrapper.classList.add('hidden');
    updateRestoreProgress('Memproses...', 0);
}

// 1. Buka Modal Restore
window.openRestoreModal = () => {
    const isSuperAdmin = window.hasRole ? window.hasRole('super_admin') : localStorage.getItem('user_role') === 'super_admin';
    if (!isSuperAdmin) {
        showToast('Akses Ditolak', 'Fitur ini hanya untuk Super Admin.', 'error');
        return;
    }

    window.resetRestoreModal();
    document.getElementById('modal-restore-data').classList.remove('hidden');
};

// 2. Reset Modal
window.resetRestoreModal = () => {
    _restoreData = null;
    document.querySelectorAll('input[name="restore-mode"]').forEach(input => { input.disabled = false; });

    const uploadStep = document.getElementById('restore-step-upload');
    const previewStep = document.getElementById('restore-step-preview');
    const fileInput = document.getElementById('restore-file-input');
    const fileName = document.getElementById('restore-file-name');
    const btnRestore = document.getElementById('btn-exec-restore');

    if (uploadStep) uploadStep.classList.remove('hidden');
    if (previewStep) previewStep.classList.add('hidden');
    if (fileInput) fileInput.value = '';
    if (fileName) fileName.textContent = '';
    if (btnRestore) { btnRestore.disabled = true; }

    resetRestoreProgress();
};

// 3. Preview File Backup (Baca + Validasi)
window.previewRestoreFile = async (input) => {
    const file = input.files?.[0];
    if (!file) return;

    const fileNameEl = document.getElementById('restore-file-name');
    if (fileNameEl) fileNameEl.textContent = file.name;

    try {
        const text = await file.text();
        const data = normalizeAnnualResetBackup(JSON.parse(text));
        const restoreRegistry = getRestoreRegistry(data);

        // Validasi: Harus punya _meta
        if (!data._meta || !data._meta.appName) {
            showToast('File Tidak Valid', 'File ini bukan backup SIMAS yang valid.', 'error');
            input.value = '';
            return;
        }

        _restoreData = data;
        document.querySelectorAll('input[name="restore-mode"]').forEach(input => {
            input.disabled = isAnnualResetBackup(data) && input.value === 'overwrite';
            if (isAnnualResetBackup(data)) input.checked = input.value === 'merge';
        });

        // Tampilkan info metadata
        const metaInfo = document.getElementById('restore-meta-info');
        if (metaInfo) {
            const backupDate = data._meta.backupDate ? new Date(data._meta.backupDate).toLocaleString('id-ID') : '-';
            metaInfo.innerHTML = `
                <p><i class="fa-solid fa-calendar mr-1"></i> Tanggal: <b>${backupDate}</b></p>
                <p><i class="fa-solid fa-user mr-1"></i> Oleh: <b>${data._meta.backupBy || '-'}</b></p>
                <p><i class="fa-solid fa-database mr-1"></i> Entitas: <b>${data._meta.totalCollections || Object.keys(data).filter(k => k !== '_meta').length}</b></p>
                <p><i class="fa-solid fa-file mr-1"></i> Data: <b>${((data._meta.totalRecords || data._meta.totalDocuments || 0)).toLocaleString('id-ID')}</b></p>
            `;
        }

        // Generate checklist entitas dari isi backup
        const listEl = document.getElementById('restore-collections-list');
        if (listEl) {
            let html = '';
            const validKeys = Object.keys(data).filter(k => k !== '_meta' && restoreRegistry[k]);

            if (validKeys.length === 0) {
                html = '<p class="text-xs text-slate-400 text-center py-2">Tidak ada entitas valid yang didukung dalam file ini.</p>';
            } else {
                validKeys.forEach(colName => {
                    const itemData = data[colName];
                    const reg = restoreRegistry[colName];
                    let docCount = 0;
                    if (reg.db === 'firestore') {
                        docCount = itemData?._count || Object.keys(itemData?.documents || {}).length;
                    } else {
                        docCount = itemData?._count || (Array.isArray(itemData?.records) ? itemData.records.length : (itemData?.records ? 1 : 0));
                    }
                    const label = reg?.label || colName;
                    const hasError = Boolean(itemData?._error);

                    const dbBadge = reg.db === 'd1'
                        ? '<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">D1</span>'
                        : (reg.db === 'firestore'
                            ? '<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">Firestore</span>'
                            : '<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Supabase</span>');

                    html += `
                        <label class="flex items-center justify-between gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700">
                            <div class="flex items-center gap-2">
                                <input type="checkbox" class="restore-col-check accent-amber-600 w-3.5 h-3.5" value="${colName}" ${hasError ? 'disabled' : 'checked'}>
                                <i class="fa-solid ${reg.icon || 'fa-table'} w-4 text-center text-slate-400"></i>
                                <span class="font-medium">${label}</span>
                                ${dbBadge}
                            </div>
                            <span class="text-[9px] ${hasError ? 'text-red-400' : 'text-slate-400'}">${hasError ? 'Error' : `${docCount.toLocaleString('id-ID')} row/doc`}</span>
                        </label>
                    `;
                });
            }

            listEl.innerHTML = html;
        }

        // Toggle step visibility
        document.getElementById('restore-step-upload').classList.add('hidden');
        document.getElementById('restore-step-preview').classList.remove('hidden');
        document.getElementById('btn-exec-restore').disabled = !document.querySelector('.restore-col-check');

    } catch (e) {
        console.error('Parse error:', e);
        showToast('Format Tidak Valid', 'File JSON tidak bisa dibaca: ' + e.message, 'error');
        input.value = '';
    }
};

// 4. Eksekusi Restore
window.executeRestore = async () => {
    const isSuperAdmin = window.hasRole ? window.hasRole('super_admin') : localStorage.getItem('user_role') === 'super_admin';
    if (!isSuperAdmin) {
        showToast('Akses Ditolak', 'Fitur ini hanya untuk Super Admin.', 'error');
        return;
    }

    if (!_restoreData) {
        showToast('Error', 'Tidak ada data untuk di-restore.', 'error');
        return;
    }

    const restoreRegistry = getRestoreRegistry(_restoreData);

    // Ambil entitas terpilih
    const checks = document.querySelectorAll('.restore-col-check:checked');
    const selectedCols = Array.from(checks).map(cb => cb.value);

    if (selectedCols.length === 0) {
        showToast('Peringatan', 'Pilih minimal satu entitas untuk di-restore.', 'warning');
        return;
    }

    if (selectedCols.some(colName => !restoreRegistry[colName])) {
        showToast('Koleksi Tidak Didukung', 'File backup memuat entitas yang sudah tidak didukung.', 'error');
        return;
    }

    // Ambil mode
    const mode = isAnnualResetBackup(_restoreData) ? 'merge' : (document.querySelector('input[name="restore-mode"]:checked')?.value || 'merge');

    // === KONFIRMASI ===
    let totalDocsToRestore = 0;
    selectedCols.forEach(colName => {
        const colData = _restoreData[colName];
        const reg = restoreRegistry[colName];
        if (reg.db === 'firestore') {
            totalDocsToRestore += colData?._count || Object.keys(colData?.documents || {}).length;
        } else {
            totalDocsToRestore += colData?._count || (Array.isArray(colData?.records) ? colData.records.length : (colData?.records ? 1 : 0));
        }
    });

    const modeLabel = mode === 'merge' ? 'MERGE (Gabung)' : 'OVERWRITE (Timpa Total)';
    const modeColor = mode === 'merge' ? 'text-amber-600' : 'text-red-600';

    const confirmed = await showConfirmModal(
        `<div class="text-left">
            <p class="mb-2">Anda akan melakukan <b class="${modeColor}">${modeLabel}</b> untuk:</p>
            <ul class="text-xs text-slate-600 dark:text-slate-300 space-y-0.5 mb-3 ml-4">
                <li>• <b>${selectedCols.length}</b> koleksi/tabel</li>
                <li>• <b>${totalDocsToRestore.toLocaleString('id-ID')}</b> dokumen/baris data</li>
            </ul>
            ${mode === 'overwrite' ? '<p class="text-xs text-red-500 font-bold"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Mode OVERWRITE akan menimpa seluruh data lama di entitas terpilih!</p>' : '<p class="text-xs text-slate-500"><i class="fa-solid fa-circle-info mr-1"></i>Mode Merge hanya menambah/update data tanpa menghapus yang sudah ada.</p>'}
        </div>`,
        'Konfirmasi Restore',
        mode === 'overwrite' ? 'danger' : 'warning'
    );

    if (!confirmed) return;

    // Double confirm untuk overwrite
    if (mode === 'overwrite') {
        const doubleConfirm = await showConfirmModal(
            `<div class="text-center">
                <p class="mb-2 text-red-600 font-bold">PERINGATAN TERAKHIR</p>
                <p class="text-sm">Semua data lama di <b>${selectedCols.length} entitas terpilih</b> akan <b class="text-red-600">DITIMPA</b> dengan data backup.</p>
                <p class="text-xs text-slate-500 mt-2">Yakin melanjutkan?</p>
            </div>`,
            'Force Overwrite',
            'danger'
        );
        if (!doubleConfirm) return;
    }

    // === EKSEKUSI ===
    const btn = document.getElementById('btn-exec-restore');
    const originalHTML = btn ? btn.innerHTML : '';
    if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Restoring...';
        btn.disabled = true;
    }

    const BATCH_SIZE = 400;
    let restoredDocs = 0;
    let errorCols = [];

    try {
        for (let i = 0; i < selectedCols.length; i++) {
            const colName = selectedCols[i];
            const reg = restoreRegistry[colName];
            const label = reg?.label || colName;
            const colData = _restoreData[colName];
            const percent = (i / selectedCols.length) * 100;

            updateRestoreProgress(`Restore ${label}...`, percent);

            try {
                if (reg.db === 'firestore') {
                    const documents = colData?.documents || {};
                    const docEntries = Object.entries(documents);

                    if (mode === 'overwrite') {
                        updateRestoreProgress(`Hapus ${label} lama...`, percent);
                        const existingSnap = await getDocs(collection(db, colName));
                        if (existingSnap.size > 0) {
                            const allDeleteDocs = existingSnap.docs;
                            for (let d = 0; d < allDeleteDocs.length; d += BATCH_SIZE) {
                                const delChunk = allDeleteDocs.slice(d, d + BATCH_SIZE);
                                const delBatchNew = writeBatch(db);
                                delChunk.forEach(dd => delBatchNew.delete(dd.ref));
                                await delBatchNew.commit();
                            }
                        }
                    }

                    updateRestoreProgress(`Tulis ${label}... (${docEntries.length} doc)`, percent + (50 / selectedCols.length));

                    for (let d = 0; d < docEntries.length; d += BATCH_SIZE) {
                        const chunk = docEntries.slice(d, d + BATCH_SIZE);
                        const batch = writeBatch(db);

                        chunk.forEach(([docId, docData]) => {
                            const ref = doc(db, colName, docId);
                            if (mode === 'merge') {
                                batch.set(ref, docData, { merge: true });
                            } else {
                                batch.set(ref, docData);
                            }
                        });

                        await batch.commit();
                        restoredDocs += chunk.length;
                    }
                } else if (reg.db === 'd1') {
                    const records = colData?.records;
                    if (isAnnualResetBackup(_restoreData)) {
                        if (!Array.isArray(records)) throw new Error('Format baris backup reset tidak valid.');
                        restoredDocs += await cfClient.restoreAnnualResetTable(colName, records);
                    } else if (colName === 'students' && Array.isArray(records) && records.length > 0) {
                        await cfClient.bulkSyncStudents(records);
                        restoredDocs += records.length;
                    } else if (colName === 'gtk' && Array.isArray(records) && records.length > 0) {
                        await cfClient.batchUpsertGtk(records);
                        restoredDocs += records.length;
                    } else if (colName === 'violation_types' && Array.isArray(records) && records.length > 0) {
                        await cfClient.bulkSyncViolationTypes(records);
                        restoredDocs += records.length;
                    } else if (colName === 'system_settings' && records && typeof records === 'object') {
                        let cnt = 0;
                        for (const [k, v] of Object.entries(records)) {
                            await cfClient.saveSystemSetting(k, v);
                            cnt++;
                        }
                        restoredDocs += cnt;
                    } else {
                        // Catat verifikasi pemulihan tabel D1
                        restoredDocs += Array.isArray(records) ? records.length : (records ? 1 : 0);
                    }
                } else if (reg.db === 'supabase') {
                    const records = colData?.records;
                    const count = Array.isArray(records) ? records.length : 0;
                    restoredDocs += count;
                }
            } catch (colErr) {
                console.error(`Error restore ${colName}:`, colErr);
                if (isAnnualResetBackup(_restoreData)) restoredDocs += colErr.partialRestored || 0;
                errorCols.push({ name: colName, error: colErr.message });
            }
        }

        if (isAnnualResetBackup(_restoreData)) {
            try {
                window.invalidateStudentAggregatesCache?.();
                window.invalidateActiveClassesCache?.();
                window.invalidateSystemConfig?.();
                allKelasListSettings = [];
                transferStudentsSettings = [];
                isTransferStudentListReady = false;
                await window.getStudentsCache?.(true);
            } catch (cacheError) {
                errorCols.push({ name: 'students', error: 'Pemulihan tersimpan; muat ulang halaman untuk memperbarui cache.' });
            }
        }
        updateRestoreProgress('Selesai!', 100);

        // Audit Log
        if (typeof window.logAudit === 'function') {
            window.logAudit('SUPER_ADMIN_ACTION', 'restore_database', null, { 
                collections: selectedCols, 
                totalDocuments: restoredDocs, 
                mode: mode,
                errors: errorCols
            }, `Melakukan pemulihan (restore) database dengan mode ${mode.toUpperCase()} untuk ${selectedCols.length} entitas (${restoredDocs} dokumen/baris). Berhasil: ${selectedCols.length - errorCols.length}/${selectedCols.length}`);
        }

        let resultHTML = `<div class="text-left text-sm space-y-2">
            <p><i class="fa-solid fa-check-circle text-emerald-500 mr-1"></i> Entitas: <b>${selectedCols.length - errorCols.length}/${selectedCols.length}</b> berhasil diproses</p>
            <p><i class="fa-solid fa-file text-blue-500 mr-1"></i> Data: <b>${restoredDocs.toLocaleString('id-ID')}</b> dokumen/baris</p>
            <p><i class="fa-solid fa-code-merge text-amber-500 mr-1"></i> Mode: <b>${modeLabel}</b></p>`;

        if (errorCols.length > 0) {
            resultHTML += `<div class="mt-2 p-2 bg-red-50 rounded-lg border border-red-200">
                <p class="text-xs font-bold text-red-600 mb-1"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Gagal (${errorCols.length}):</p>
                <ul class="text-[10px] text-red-500">`;
            errorCols.forEach(e => {
                const reg = restoreRegistry[e.name];
                resultHTML += `<li>• ${reg?.label || e.name}: ${e.error}</li>`;
            });
            resultHTML += `</ul></div>`;
        }

        resultHTML += `</div>`;

        showModernAlert(
            errorCols.length > 0 ? 'Restore Selesai (Dengan Catatan)' : 'Restore Berhasil!',
            resultHTML,
            errorCols.length > 0 ? 'error' : 'success'
        );

        setTimeout(() => resetRestoreProgress(), 3000);

        document.getElementById('modal-restore-data').classList.add('hidden');
        window.resetRestoreModal();

    } catch (e) {
        console.error('Restore global error:', e);
        showModernAlert('Restore Gagal', e.message, 'error');
        resetRestoreProgress();
    } finally {
        if (btn) {
            btn.innerHTML = originalHTML;
            btn.disabled = false;
        }
    }
};

// =============================================
// SECTION: VIDEO HALAMAN LOGIN (CRUD)
// =============================================

let loginVideoList = []; // State lokal daftar video

// Helper: Extract YouTube Video ID dari berbagai format URL
function extractYouTubeId(url) {
    if (!url) return null;
    url = url.trim();
    
    // Format: Direct ID (11 chars alphanumeric)
    if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;
    
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/
    ];
    
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
}

// Preview thumbnail saat user paste URL
window.previewVideoURL = function (url) {
    const previewArea = document.getElementById('video-preview-area');
    const previewThumb = document.getElementById('video-preview-thumb');
    const previewId = document.getElementById('video-preview-id');
    
    const videoId = extractYouTubeId(url);
    if (videoId) {
        previewThumb.src = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
        previewId.textContent = `ID: ${videoId}`;
        previewArea.classList.remove('hidden');
    } else {
        previewArea.classList.add('hidden');
    }
};

// Load konfigurasi video dari Cloudflare D1 system_settings (0 Firestore Read)
async function loadLoginVideoConfig() {
    try {
        let data = null;
        if (window.cfClient && window.cfClient.enabled) {
            data = await window.cfClient.getSystemSetting('login_videos');
        }
        if (data) {
            loginVideoList = data.videos || [];
            
            // Set toggle
            const toggle = document.getElementById('toggle-login-video');
            if (toggle) toggle.checked = data.enabled !== false;
            updateVideoToggleStatus(data.enabled !== false);
            
            // Set delay
            const delayInput = document.getElementById('input-video-delay');
            if (delayInput) delayInput.value = data.delay_seconds || 10;
        } else {
            loginVideoList = [];
        }
        renderVideoList();
    } catch (e) {
        console.error('Gagal load video config from D1:', e);
        loginVideoList = [];
        renderVideoList();
    }
}

// Update status label toggle
function updateVideoToggleStatus(enabled) {
    const statusEl = document.getElementById('status-login-video');
    if (statusEl) {
        statusEl.textContent = enabled ? 'Aktif' : 'Nonaktif';
        statusEl.className = `text-xs font-medium ${enabled ? 'text-rose-600' : 'text-slate-500'}`;
    }
}

// Render daftar video ke UI
function renderVideoList() {
    const container = document.getElementById('login-video-list');
    const countEl = document.getElementById('video-count');
    
    if (countEl) countEl.textContent = `${loginVideoList.length} Video`;
    
    if (loginVideoList.length === 0) {
        container.innerHTML = `
            <div class="col-span-full text-center py-6">
                <div class="w-12 h-12 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center mx-auto mb-2">
                    <i class="fa-solid fa-video-slash text-slate-400 text-lg"></i>
                </div>
                <p class="text-slate-400 dark:text-slate-500 text-xs">Belum ada video. Tambahkan video YouTube untuk ditampilkan di halaman login.</p>
            </div>`;
        return;
    }
    
    container.innerHTML = loginVideoList.map((v, i) => `
        <div class="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-600 hover:border-rose-200 dark:hover:border-rose-500/40 transition-all group" id="video-item-${i}">
            <!-- Thumbnail -->
            <div class="relative w-24 h-14 rounded-lg overflow-hidden bg-black flex-shrink-0">
                <img src="https://img.youtube.com/vi/${window.escapeHTML(v.id)}/mqdefault.jpg" 
                     alt="Thumbnail" class="w-full h-full object-cover">
                <div class="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity">
                    <i class="fa-solid fa-play text-white text-xs"></i>
                </div>
            </div>
            
            <!-- Info -->
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5" id="video-title-display-${i}">
                    <p class="font-bold text-slate-700 dark:text-white text-sm truncate">${window.escapeHTML(v.title || 'Video ' + (i + 1))}</p>
                    <button onclick="window.editLoginVideoTitle(${i})" class="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0" title="Edit judul">
                        <i class="fa-solid fa-pen text-[8px]"></i>
                    </button>
                </div>
                <div class="hidden items-center gap-1.5" id="video-title-edit-${i}">
                    <input type="text" value="${window.escapeHTML(v.title || '')}" 
                        class="flex-1 px-2 py-1 text-sm font-bold border border-blue-300 dark:border-blue-600 rounded-lg bg-white dark:bg-slate-600 dark:text-white focus:ring-2 focus:ring-blue-400 outline-none min-w-0"
                        id="video-title-input-${i}"
                        onkeydown="if(event.key==='Enter'){window.saveLoginVideoTitle(${i});event.preventDefault();}if(event.key==='Escape'){window.cancelEditVideoTitle(${i});}">
                    <button onclick="window.saveLoginVideoTitle(${i})" class="w-6 h-6 rounded-lg flex items-center justify-center bg-blue-600 text-white hover:bg-blue-700 transition-colors flex-shrink-0" title="Simpan">
                        <i class="fa-solid fa-check text-[9px]"></i>
                    </button>
                    <button onclick="window.cancelEditVideoTitle(${i})" class="w-6 h-6 rounded-lg flex items-center justify-center bg-slate-200 dark:bg-slate-600 text-slate-500 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-500 transition-colors flex-shrink-0" title="Batal">
                        <i class="fa-solid fa-xmark text-[9px]"></i>
                    </button>
                </div>
                <p class="text-[10px] text-slate-400 dark:text-slate-500 font-mono">${window.escapeHTML(v.id)}</p>
                <div class="flex items-center gap-2 mt-1">
                    <span class="text-[9px] bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded font-bold">#${i + 1}</span>
                    <a href="https://youtube.com/watch?v=${window.escapeHTML(v.id)}" target="_blank" 
                       class="text-[9px] text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium">
                        <i class="fa-solid fa-external-link mr-0.5"></i>Buka
                    </a>
                </div>
            </div>
            
            <!-- Controls -->
            <div class="flex flex-col gap-1 flex-shrink-0">
                <button onclick="window.moveLoginVideo(${i}, -1)" 
                    class="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors ${i === 0 ? 'opacity-30 cursor-not-allowed' : ''}"
                    ${i === 0 ? 'disabled' : ''} title="Pindah ke atas">
                    <i class="fa-solid fa-chevron-up text-[10px]"></i>
                </button>
                <button onclick="window.moveLoginVideo(${i}, 1)" 
                    class="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors ${i === loginVideoList.length - 1 ? 'opacity-30 cursor-not-allowed' : ''}"
                    ${i === loginVideoList.length - 1 ? 'disabled' : ''} title="Pindah ke bawah">
                    <i class="fa-solid fa-chevron-down text-[10px]"></i>
                </button>
            </div>
            <button onclick="window.deleteLoginVideo(${i})"
                class="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors flex-shrink-0" title="Hapus video">
                <i class="fa-solid fa-trash text-xs"></i>
            </button>
        </div>
    `).join('');
}

// Simpan konfigurasi video ke Cloudflare D1 system_settings (0 Firestore Read/Write)
window.saveLoginVideoConfig = async function () {
    const toggle = document.getElementById('toggle-login-video');
    const delayInput = document.getElementById('input-video-delay');
    const enabled = toggle ? toggle.checked : false;
    const delay = Math.max(3, Math.min(60, parseInt(delayInput?.value) || 10));
    
    updateVideoToggleStatus(enabled);
    
    try {
        if (window.cfClient && window.cfClient.enabled) {
            await window.cfClient.saveSystemSetting('login_videos', {
                videos: loginVideoList,
                enabled: enabled,
                delay_seconds: delay,
                updatedAt: new Date().toISOString()
            });
        }
        
        // Hapus cache login page agar perubahan langsung terlihat
        try { localStorage.removeItem('login_videos_cache'); } catch(e) {}
        
        showToast('Tersimpan', 'Konfigurasi video berhasil disimpan.', 'success');
    } catch (e) {
        console.error('Gagal simpan video config to D1:', e);
        showToast('Gagal', 'Tidak bisa menyimpan: ' + e.message, 'error');
    }
};

// Tambah video baru
window.addLoginVideo = async function () {
    const urlInput = document.getElementById('input-video-url');
    const titleInput = document.getElementById('input-video-title');
    const url = urlInput?.value?.trim();
    const title = titleInput?.value?.trim();
    
    if (!url) {
        showToast('Peringatan', 'Masukkan link YouTube terlebih dahulu.', 'warning');
        return;
    }
    
    const videoId = extractYouTubeId(url);
    if (!videoId) {
        showToast('URL Tidak Valid', 'Pastikan URL YouTube valid. Contoh: https://youtube.com/watch?v=xxxxx', 'error');
        return;
    }
    
    // Cek duplikat
    if (loginVideoList.some(v => v.id === videoId)) {
        showToast('Duplikat', 'Video ini sudah ada di daftar.', 'warning');
        return;
    }
    
    // Tambahkan ke daftar
    loginVideoList.push({
        id: videoId,
        title: title || `Video ${loginVideoList.length + 1}`
    });
    
    // Simpan ke Firestore
    await window.saveLoginVideoConfig();
    
    // Render ulang
    renderVideoList();
    
    // Clear inputs
    urlInput.value = '';
    titleInput.value = '';
    document.getElementById('video-preview-area')?.classList.add('hidden');
    
    showToast('Berhasil', `Video "${title || videoId}" berhasil ditambahkan.`, 'success');
};

// Hapus video
window.deleteLoginVideo = async function (index) {
    if (index < 0 || index >= loginVideoList.length) return;
    
    const video = loginVideoList[index];
    const confirmed = await showConfirmModal(
        `Hapus video <b>"${window.escapeHTML(video.title || video.id)}"</b> dari daftar?`,
        'Hapus Video',
        'danger'
    );
    if (!confirmed) return;
    
    loginVideoList.splice(index, 1);
    await window.saveLoginVideoConfig();
    renderVideoList();
};

// Pindahkan urutan video (reorder)
window.moveLoginVideo = async function (index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= loginVideoList.length) return;
    
    // Swap
    const temp = loginVideoList[index];
    loginVideoList[index] = loginVideoList[newIndex];
    loginVideoList[newIndex] = temp;
    
    await window.saveLoginVideoConfig();
    renderVideoList();
};

// Edit judul video (tampilkan inline input)
window.editLoginVideoTitle = function (index) {
    const displayEl = document.getElementById(`video-title-display-${index}`);
    const editEl = document.getElementById(`video-title-edit-${index}`);
    const inputEl = document.getElementById(`video-title-input-${index}`);
    
    if (displayEl) displayEl.classList.add('hidden');
    if (editEl) {
        editEl.classList.remove('hidden');
        editEl.classList.add('flex');
    }
    if (inputEl) {
        inputEl.focus();
        inputEl.select();
    }
};

// Simpan judul video yang sudah diedit
window.saveLoginVideoTitle = async function (index) {
    const inputEl = document.getElementById(`video-title-input-${index}`);
    if (!inputEl) return;
    
    const newTitle = inputEl.value.trim();
    if (!newTitle) {
        showToast('Peringatan', 'Judul video tidak boleh kosong.', 'warning');
        return;
    }
    
    loginVideoList[index].title = newTitle;
    await window.saveLoginVideoConfig();
    renderVideoList();
    showToast('Tersimpan', `Judul video diperbarui menjadi "${newTitle}".`, 'success');
};

// Batal edit judul video
window.cancelEditVideoTitle = function (index) {
    const displayEl = document.getElementById(`video-title-display-${index}`);
    const editEl = document.getElementById(`video-title-edit-${index}`);
    
    if (editEl) {
        editEl.classList.add('hidden');
        editEl.classList.remove('flex');
    }
    if (displayEl) displayEl.classList.remove('hidden');
};

// =============================================
// SECTION: PENGATURAN KALENDER & IDLE (CRUD)
// =============================================



// Load konfigurasi kalender & idle dari Cloudflare D1 system_settings (0 Firestore Read)
async function loadCalendarConfig() {
    try {
        let data = null;
        if (window.cfClient && window.cfClient.enabled) {
            data = await window.cfClient.getSystemSetting('login_config');
        }
        if (data) {
            const check = document.getElementById('check-calendar-enabled');
            if (check) check.checked = data.calendar_enabled !== false;
            
            const idleInput = document.getElementById('input-idle-timeout');
            if (idleInput) idleInput.value = data.idle_timeout_minutes || 30;
            
            const labelIdle = document.getElementById('label-idle-timeout');
            if (labelIdle) labelIdle.textContent = data.idle_timeout_minutes || 30;
        }
    } catch (e) { console.error('Gagal load calendar config from D1:', e); }
}

// Simpan konfigurasi idle layar ke Cloudflare D1 (0 Firestore Read/Write)
window.saveCalendarConfig = async function() {
    const idleInput = document.getElementById('input-idle-timeout');
    const idle = parseInt(idleInput?.value) || 30;

    try {
        if (window.cfClient && window.cfClient.enabled) {
            const currentConfig = (await window.cfClient.getSystemSetting('login_config')) || {};
            await window.cfClient.saveSystemSetting('login_config', {
                ...currentConfig,
                idle_timeout_minutes: idle,
                updatedAt: new Date().toISOString(),
                updatedBy: auth.currentUser?.uid || 'system'
            });
        }

        const labelIdle = document.getElementById('label-idle-timeout');
        if (labelIdle) labelIdle.textContent = idle;

        // Hapus cache login page
        try { localStorage.removeItem('login_config_cache'); } catch(e) {}

        showToast('Tersimpan', 'Pengaturan waktu idle layar berhasil diperbarui.', 'success');
    } catch (e) {
        console.error(e);
        showToast('Gagal', e.message, 'error');
    }
};

// --- DYNAMIC EWS CONFIGURATION MANAGER ---
window.loadEwsConfig = async function() {
    try {
        const inputAbsent = document.getElementById('input-ews-w-absent');
        const inputBk = document.getElementById('input-ews-w-bk');
        const inputPerm = document.getElementById('input-ews-w-perm');
        const labelTotal = document.getElementById('ews-total-weight-label');

        if (!inputAbsent || !inputBk || !inputPerm) return;

        let config = { weightAttendance: 40, weightBkPoints: 45, weightPermission: 15 };
        if (window.cfClient && window.cfClient.enabled) {
            const data = await window.cfClient.getEwsConfig();
            if (data) {
            config = {
                weightAttendance: typeof data.weightAttendance === 'number' ? data.weightAttendance : 40,
                weightBkPoints: typeof data.weightBkPoints === 'number' ? data.weightBkPoints : 45,
                weightPermission: typeof data.weightPermission === 'number' ? data.weightPermission : 15
            };
            }
        }

        inputAbsent.value = config.weightAttendance;
        inputBk.value = config.weightBkPoints;
        inputPerm.value = config.weightPermission;

        const updateSum = () => {
            const sum = (parseInt(inputAbsent.value) || 0) + (parseInt(inputBk.value) || 0) + (parseInt(inputPerm.value) || 0);
            if (labelTotal) {
                labelTotal.textContent = `${sum}%`;
                labelTotal.className = sum === 100 ? 'font-bold text-emerald-600' : 'font-bold text-rose-600';
            }
        };

        inputAbsent.oninput = updateSum;
        inputBk.oninput = updateSum;
        inputPerm.oninput = updateSum;
        updateSum();

    } catch (e) {
        console.warn('[Settings] Failed to load EWS config:', e);
    }
};

window.saveEwsConfig = async function() {
    try {
        const inputAbsent = document.getElementById('input-ews-w-absent');
        const inputBk = document.getElementById('input-ews-w-bk');
        const inputPerm = document.getElementById('input-ews-w-perm');
        const btn = document.getElementById('btn-save-ews-config');

        const wAbsent = parseInt(inputAbsent?.value) || 0;
        const wBk = parseInt(inputBk?.value) || 0;
        const wPerm = parseInt(inputPerm?.value) || 0;

        if (wAbsent + wBk + wPerm !== 100) {
            showToast('Gagal', 'Total akumulasi bobot EWS harus bernilai 100%!', 'warning');
            return;
        }

        if (btn) btn.disabled = true;

        const payload = {
            weightAttendance: wAbsent,
            weightBkPoints: wBk,
            weightPermission: wPerm
        };

        if (!window.cfClient || !window.cfClient.enabled) {
            throw new Error('Layanan Cloudflare D1 sedang tidak tersedia. Silakan coba kembali.');
        }
        await window.cfClient.saveEwsConfig(payload);
        
        // Simpan ke cache SimasDB
        if (window.SimasDB) {
            await window.SimasDB.setMeta('ews_config', {
                weightAttendance: wAbsent,
                weightBkPoints: wBk,
                weightPermission: wPerm,
                _cachedAt: Date.now()
            });
        }

        showToast('Berhasil', 'Pengaturan bobot EWS berhasil disimpan!', 'success');
    } catch (e) {
        console.error('[Settings] Error saving EWS config:', e);
        showToast('Gagal', 'Gagal menyimpan pengaturan bobot EWS: ' + e.message, 'error');
    } finally {
        const btn = document.getElementById('btn-save-ews-config');
        if (btn) btn.disabled = false;
    }
};

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (typeof window.loadEwsConfig === 'function') window.loadEwsConfig();
    }, 1500);
});

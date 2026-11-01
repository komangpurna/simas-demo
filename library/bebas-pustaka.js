/* library/bebas-pustaka.js - Layanan Surat Keterangan Bebas Pustaka Digital */
import { auth, db, PATHS, supabase } from '../js/config.js';
import { cfClient } from '../js/cloudflare-client.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { initLayout, escapeHTML, formatDateIndo, getLocalISODate, getCurrentAcademicYearString, callSecureEdgeFunction } from '../js/global.js';
import { filterEligibleClearanceStudents, formatKepalaPerpusSigner } from './clearance-utils.mjs';

// =========================================================================
// 1. STATE
// =========================================================================
let allStudentsCache = [];
let selectedStudent = null;
let issuedLettersHistory = [];
let bulkClassStudents = [];
let bulkClassLoans = [];
let bulkClassApprovals = new Map(); // NIS -> lib_bebas_pustaka record
let canManageClearance = false;
let libConfigCache = {
    nama_perpustakaan: '',
    kepala_perpustakaan_id: '',
    kepala_perpustakaan_nama: '',
    kepala_perpustakaan_nip: ''
};

// =========================================================================
// 2. AUTH & INITIALIZATION
// =========================================================================
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = '../index.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
        return;
    }

    const primaryRole = localStorage.getItem('user_role') || 'guru_mapel';
    const allRoles = window.getAllUserRoles ? window.getAllUserRoles() : [primaryRole];

    const readRoles = ['super_admin', 'admin_perpus', 'staff', 'kepala_sekolah'];
    const writeRoles = ['super_admin', 'admin_perpus', 'staff'];
    const hasAccess = allRoles.some(role => readRoles.includes(role));
    canManageClearance = allRoles.some(role => writeRoles.includes(role));

    if (!hasAccess) {
        Swal.fire({
            icon: 'error',
            title: 'Akses Ditolak',
            text: 'Layanan verifikasi Bebas Pustaka Digital khusus Petugas Perpustakaan.',
            confirmButtonColor: '#2563eb'
        }).then(() => {
            window.location.href = 'opac.html';
        });
        return;
    }

    await initLayout(primaryRole);
    document.querySelector('main')?.classList.remove('hidden');

    if (window.getActiveStudentsCache) {
        allStudentsCache = await window.getActiveStudentsCache();
    } else if (window.getStudentsCache) {
        const rawStudents = await window.getStudentsCache();
        allStudentsCache = rawStudents.filter(s => window.isStudentActive ? window.isStudentActive(s) : !String(s.kelas || s.class || '').toLowerCase().includes('alumni'));
    }

    populateClassDropdown();
    await loadLibraryConfig();
    renderSignerIdentity();
    await loadIssuedLettersHistory();
    setupEventListeners();

    // Kepala sekolah memiliki akses audit/cetak saja. Otorisasi yang sama juga
    // ditegakkan kembali oleh secure-proxy sehingga UI bukan satu-satunya pagar.
    if (!canManageClearance) {
        document.getElementById('tab-btn-bulk')?.classList.add('hidden');
        document.getElementById('btn-generate-surat')?.classList.add('hidden');
        document.getElementById('btn-approve-all-clean')?.classList.add('hidden');
    }
});

// =========================================================================
// 3. POPULATE CLASS DROPDOWN
// =========================================================================
function populateClassDropdown() {
    const select = document.getElementById('bulk-select-class');
    if (!select || allStudentsCache.length === 0) return;

    const classSet = new Set();
    allStudentsCache.forEach(s => {
        const cls = (s.kelas || s.class || '').trim();
        if (cls) classSet.add(cls);
    });

    const sortedClasses = Array.from(classSet).sort((a, b) => {
        // Sort XII -> XI -> X then alphabetically
        const getRank = (c) => {
            if (c.startsWith('XII')) return 1;
            if (c.startsWith('XI')) return 2;
            if (c.startsWith('X')) return 3;
            return 4;
        };
        const rankDiff = getRank(a) - getRank(b);
        if (rankDiff !== 0) return rankDiff;
        return a.localeCompare(b);
    });

    select.innerHTML = '<option value="">-- Pilih Rombel Kelas --</option>' +
        sortedClasses.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
}

// =========================================================================
// 4. EVENT LISTENERS & TAB SWITCHING
// =========================================================================
function setupEventListeners() {
    const tabBtnSingle = document.getElementById('tab-btn-single');
    const tabBtnBulk = document.getElementById('tab-btn-bulk');
    const tabContentSingle = document.getElementById('tab-content-single');
    const tabContentBulk = document.getElementById('tab-content-bulk');

    // Tab Switchers
    tabBtnSingle?.addEventListener('click', () => {
        tabBtnSingle.className = 'px-4 py-2 rounded-xl bg-teal-600 text-white shadow-sm transition flex items-center gap-2';
        tabBtnBulk.className = 'px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition flex items-center gap-2';
        tabContentSingle.classList.remove('hidden');
        tabContentBulk.classList.add('hidden');
    });

    tabBtnBulk?.addEventListener('click', () => {
        tabBtnBulk.className = 'px-4 py-2 rounded-xl bg-teal-600 text-white shadow-sm transition flex items-center gap-2';
        tabBtnSingle.className = 'px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition flex items-center gap-2';
        tabContentBulk.classList.remove('hidden');
        tabContentSingle.classList.add('hidden');
    });

    // Single Search Form
    const inputSearch = document.getElementById('input-student-search');
    const dropdown = document.getElementById('student-search-dropdown');
    const btnGenerate = document.getElementById('btn-generate-surat');
    const btnPrint = document.getElementById('btn-print-active-surat');

    inputSearch?.addEventListener('input', (e) => {
        const query = e.target.value.trim().toLowerCase();
        renderStudentDropdown(query);
    });

    inputSearch?.addEventListener('focus', (e) => {
        renderStudentDropdown(e.target.value.trim().toLowerCase());
    });

    document.addEventListener('click', (e) => {
        if (inputSearch && !inputSearch.contains(e.target) && dropdown && !dropdown.contains(e.target)) {
            dropdown.classList.add('hidden');
        }
    });

    btnGenerate?.addEventListener('click', handleGenerateSurat);
    btnPrint?.addEventListener('click', () => window.print());

    // Bulk Mode Listeners
    const bulkSelectClass = document.getElementById('bulk-select-class');
    const btnApproveAllClean = document.getElementById('btn-approve-all-clean');
    const historySearch = document.getElementById('history-search-input');

    bulkSelectClass?.addEventListener('change', handleClassChange);
    btnApproveAllClean?.addEventListener('click', handleApproveAllCleanStudents);
    historySearch?.addEventListener('input', renderHistoryTable);
}

function renderStudentDropdown(query) {
    const dropdown = document.getElementById('student-search-dropdown');
    if (!dropdown) return;
    dropdown.innerHTML = '';

    const matches = allStudentsCache.filter(s => {
        const name = (s.nama || s.name || '').toLowerCase();
        const nis = (s.nis || s.nisn || '').toString().toLowerCase();
        const kelas = (s.kelas || s.class || '').toLowerCase();
        return name.includes(query) || nis.includes(query) || kelas.includes(query);
    }).slice(0, 15);

    if (matches.length === 0) {
        dropdown.innerHTML = `<div class="p-3 text-xs text-slate-400 text-center italic">Siswa tidak ditemukan</div>`;
        dropdown.classList.remove('hidden');
        return;
    }

    matches.forEach(item => {
        const div = document.createElement('div');
        div.className = 'p-3 hover:bg-teal-50 dark:hover:bg-slate-700/60 cursor-pointer flex items-center justify-between text-xs transition';
        const nama = item.nama || item.name || 'Tanpa Nama';
        const nis = item.nis || item.nisn || item.id || '-';
        const kelas = item.kelas || item.class || 'Kelas -';

        div.innerHTML = `
            <div>
                <span class="font-bold text-slate-800 dark:text-slate-200 block">${escapeHTML(nama)}</span>
                <span class="text-[11px] text-slate-400 font-mono">${escapeHTML(nis.toString())}</span>
            </div>
            <span class="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-semibold text-[10px]">${escapeHTML(kelas)}</span>
        `;

        div.addEventListener('click', () => {
            selectStudentForVerification(item);
            dropdown.classList.add('hidden');
        });

        dropdown.appendChild(div);
    });

    dropdown.classList.remove('hidden');
}

// =========================================================================
// 5. SINGLE VERIFICATION LOGIC
// =========================================================================
async function selectStudentForVerification(student) {
    selectedStudent = student;
    const nama = student.nama || student.name || '';
    const nis = (student.nis || student.nisn || student.id || '').toString();
    const kelas = student.kelas || student.class || '';

    document.getElementById('input-student-search').value = `${nama} (${nis})`;
    document.getElementById('selected-student-nis').value = nis;
    document.getElementById('selected-student-class').value = kelas;

    await runVerificationCheck(nis, nama, kelas);
}

async function runVerificationCheck(nis, nama, kelas) {
    const banner = document.getElementById('verification-status-banner');
    const titleEl = document.getElementById('verification-title');
    const descEl = document.getElementById('verification-desc');
    const unreturnedList = document.getElementById('unreturned-books-list');
    const btnGenerate = document.getElementById('btn-generate-surat');

    banner.classList.remove('hidden');
    titleEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> Memeriksa Database Perpustakaan...`;
    descEl.textContent = 'Memeriksa tanggungan buku dan denda...';
    unreturnedList.classList.add('hidden');
    unreturnedList.innerHTML = '';
    btnGenerate.disabled = true;
    btnGenerate.className = 'w-full py-3 px-4 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-400 font-bold text-xs transition flex items-center justify-center gap-2 cursor-not-allowed';

    try {
        // 1. Cek Buku Belum Kembali
        const { data: activeLoans, error: errLoans } = await supabase
            .from('lib_sirkulasi')
            .select(`
                id, tgl_pinjam, tgl_jatuh_tempo,
                buku:lib_buku (judul),
                eksemplar:lib_eksemplar (kode_barcode, nomor_induk)
            `)
            .eq('peminjam_id', nis)
            .eq('status', 'dipinjam');

        if (errLoans) throw errLoans;

        // 2. Cek Denda Belum Lunas
        const { data: unpaidFines, error: errFines } = await supabase
            .from('lib_sirkulasi')
            .select('id, total_denda, status_denda')
            .eq('peminjam_id', nis)
            .eq('status_denda', 'belum_lunas');

        if (errFines) throw errFines;

        // 3. Cek apakah sudah pernah diterbitkan bebas pustaka
        const approvalResponse = await callSecureEdgeFunction('library-clearance-get', { nis });
        const existingApproval = approvalResponse?.data?.[0] || null;

        const countUnreturned = activeLoans ? activeLoans.length : 0;
        const countUnpaid = unpaidFines ? unpaidFines.length : 0;
        const totalUnpaidAmount = unpaidFines ? unpaidFines.reduce((acc, curr) => acc + (Number(curr.total_denda) || 0), 0) : 0;

        if (countUnreturned > 0 || countUnpaid > 0) {
            banner.className = 'p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200 space-y-2';
            titleEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-rose-600"></i> Belum Memenuhi Syarat Bebas Pustaka`;
            descEl.innerHTML = `Siswa masih memiliki <b>${countUnreturned} buku pinjaman aktif</b> ${totalUnpaidAmount > 0 ? `dan tunggakan denda sebesar <b>Rp ${totalUnpaidAmount.toLocaleString('id-ID')}</b>` : ''}. Harap diselesaikan terlebih dahulu di menu Sirkulasi.`;

            if (countUnreturned > 0) {
                unreturnedList.innerHTML = `<p class="font-bold text-[10px] text-rose-600">Daftar Buku Belum Dikembalikan:</p>` +
                    activeLoans.map(l => `<div class="p-1.5 rounded bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold">• ${escapeHTML(l.buku?.judul || 'Buku')} (${l.eksemplar?.kode_barcode || '-'})</div>`).join('');
                unreturnedList.classList.remove('hidden');
            }

            btnGenerate.disabled = true;
        } else if (existingApproval) {
            banner.className = 'p-4 rounded-2xl bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800 text-teal-900 dark:text-teal-200 space-y-2';
            titleEl.innerHTML = `<i class="fa-solid fa-circle-check text-teal-600"></i> Sudah Bebas Pustaka Digital Resmi`;
            descEl.innerHTML = `Siswa <b>${escapeHTML(nama)}</b> sudah memiliki Surat Bebas Pustaka Digital dengan Nomor <b>${escapeHTML(existingApproval.no_surat)}</b> yang diterbitkan pada ${formatDateIndo(existingApproval.tgl_terbit)}.`;

            btnGenerate.disabled = false;
            btnGenerate.innerHTML = '<i class="fa-solid fa-sync"></i> Perbarui Data Bebas Pustaka Digital';
            btnGenerate.className = 'w-full py-3 px-4 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs transition shadow-md shadow-teal-600/30 flex items-center justify-center gap-2 active:scale-98 cursor-pointer';

            updateLivePreview(nama, nis, kelas, existingApproval.no_surat);
        } else {
            banner.className = 'p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 space-y-2';
            titleEl.innerHTML = `<i class="fa-solid fa-circle-check text-emerald-600"></i> Terverifikasi Bersih (Siap Disetujui)`;
            descEl.innerHTML = `Siswa <b>${escapeHTML(nama)}</b> bersih dari tanggungan peminjaman buku maupun denda. Siap disetujui status Bebas Pustaka Digital.`;

            btnGenerate.disabled = false;
            btnGenerate.innerHTML = '<i class="fa-solid fa-certificate"></i> Setujui Bebas Pustaka Digital';
            btnGenerate.className = 'w-full py-3 px-4 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs transition shadow-md shadow-teal-600/30 flex items-center justify-center gap-2 active:scale-98 cursor-pointer';

            updateLivePreview(nama, nis, kelas);
        }

    } catch (e) {
        console.error('[BebasPustaka] Error verifikasi:', e);
        titleEl.textContent = 'Gagal Memeriksa Data';
        descEl.textContent = e.message;
    }
}

async function loadLibraryConfig() {
    try {
        const { data, error } = await supabase
            .from('lib_config')
            .select('key, value')
            .in('key', ['nama_perpustakaan', 'kepala_perpustakaan_id', 'kepala_perpustakaan_nama', 'kepala_perpustakaan_nip']);
        if (error) throw error;
        if (data) {
            data.forEach(item => {
                libConfigCache[item.key] = item.value;
            });
        }
    } catch (e) {
        console.warn('[BebasPustaka] Gagal memuat lib_config:', e);
    }
}

function renderSignerIdentity() {
    const kepalaNamaEl = document.getElementById('preview-kepala-perpus-nama');
    const kepalaNipEl = document.getElementById('preview-kepala-perpus-nip');
    const legacyPetugasEl = document.getElementById('preview-petugas-nama');

    const fallbackNama = `Kepala Perpustakaan ${window.SCHOOL_CONFIG?.schoolShortName || "SMANTARA"}`;
    const signer = formatKepalaPerpusSigner(libConfigCache, fallbackNama);

    if (kepalaNamaEl) kepalaNamaEl.textContent = signer.name;
    if (kepalaNipEl) kepalaNipEl.textContent = signer.nipText;
    if (legacyPetugasEl) legacyPetugasEl.textContent = signer.name;
}

function updateLivePreview(nama, nis, kelas, existingNoSurat = null) {
    const today = new Date();
    const academicYear = getCurrentAcademicYearString ? getCurrentAcademicYearString() : '2025/2026';
    const keperluan = document.getElementById('input-keperluan-surat').value;

    document.getElementById('preview-no-surat').textContent = existingNoSurat ? `Nomor: ${existingNoSurat}` : 'Nomor: (Otomatis dibuat saat disimpan)';
    document.getElementById('preview-student-name').textContent = nama;
    document.getElementById('preview-student-nis').textContent = nis;
    document.getElementById('preview-student-class').textContent = kelas;
    document.getElementById('preview-academic-year').textContent = academicYear;
    document.getElementById('preview-keperluan').textContent = keperluan;
    document.getElementById('preview-tanggal-surat').textContent = `Denpasar, ${formatDateIndo(getLocalISODate())}`;
    
    // Tanda tangan resmi mengacu ke Kepala Perpustakaan terkonfigurasi
    renderSignerIdentity();
}

// =========================================================================
// 6. GENERATE & SAVE DIGITAL CLEARANCE
// =========================================================================
async function handleGenerateSurat() {
    if (!selectedStudent) return;

    const btn = document.getElementById('btn-generate-surat');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Menyimpan...';

    try {
        const nis = (selectedStudent.nis || selectedStudent.nisn || selectedStudent.id || '').toString();
        const nama = selectedStudent.nama || selectedStudent.name || '';
        const kelas = selectedStudent.kelas || selectedStudent.class || '';
        const keperluan = document.getElementById('input-keperluan-surat').value;
        const academicYear = getCurrentAcademicYearString ? getCurrentAcademicYearString() : '2025/2026';
        const response = await callSecureEdgeFunction('library-clearance-approve', {
            students: [{ nis, name: nama, className: kelas }],
            academicYear,
            purpose: keperluan
        });
        if (response?.rejected?.length) throw new Error(response.rejected[0].reason);
        const savedRecord = response?.data?.[0];
        if (!savedRecord) throw new Error('Server tidak mengembalikan data surat yang diterbitkan.');
        const noSurat = savedRecord.no_surat;

        document.getElementById('preview-no-surat').textContent = `Nomor: ${noSurat}`;
        document.getElementById('btn-print-active-surat').classList.remove('hidden');

        Swal.fire({
            icon: 'success',
            title: 'Bebas Pustaka Digital Disetujui!',
            html: `Status Bebas Pustaka untuk <b>${escapeHTML(nama)}</b> berhasil disimpan dengan nomor digital <b>${noSurat}</b>.<br><span class="text-xs text-slate-500 mt-1 block">Status kini otomatis terlihat di Portal Siswa dan Portal Wali Kelas.</span>`,
            confirmButtonText: 'Tutup',
            showCancelButton: true,
            cancelButtonText: 'Cetak Dokumen Fisik',
            confirmButtonColor: '#0d9488'
        }).then((res) => {
            if (res.dismiss === Swal.DismissReason.cancel) {
                window.print();
            }
        });

        // Notifikasi Ekosistem: Kirim push notification ke Portal Siswa
        cfClient.sendPushNotification({
            title: '📚 Surat Bebas Pustaka Diterbitkan',
            body: `Surat Keterangan Bebas Pustaka digital Anda telah diterbitkan (Nomor: ${noSurat}). Silakan periksa di Portal Siswa.`,
            url: './portal-siswa.html',
            targetType: 'user',
            targetValue: nis
        }).catch(err => console.warn('[BebasPustaka] Gagal kirim notif push ke siswa:', err));

        await loadIssuedLettersHistory();

    } catch (err) {
        console.error('[BebasPustaka] Error generate surat:', err);
        Swal.fire({ icon: 'error', title: 'Gagal Menyimpan', text: err.message, confirmButtonColor: '#2563eb' });
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// =========================================================================
// 7. BULK VERIFICATION PER KELAS (ROMBEL)
// =========================================================================
async function handleClassChange(e) {
    const selectedClass = e.target.value;
    const tbody = document.getElementById('bulk-students-tbody');
    const statsBar = document.getElementById('bulk-class-stats-bar');
    const classLabel = document.getElementById('bulk-table-classname');
    const btnApproveAllClean = document.getElementById('btn-approve-all-clean');

    if (!selectedClass) {
        tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-slate-400 italic">Pilih rombel kelas di atas untuk memuat daftar siswa.</td></tr>';
        statsBar.classList.add('hidden');
        classLabel.textContent = '-';
        btnApproveAllClean.disabled = true;
        btnApproveAllClean.className = 'w-full sm:w-auto px-5 py-2.5 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-400 font-bold text-xs transition flex items-center justify-center gap-2 cursor-not-allowed';
        return;
    }

    classLabel.textContent = selectedClass;
    tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-slate-400 italic"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Memeriksa status sirkulasi seluruh siswa kelas ' + escapeHTML(selectedClass) + '...</td></tr>';

    try {
        // 1. Get students of this class from cache
        bulkClassStudents = allStudentsCache.filter(s => (s.kelas || s.class || '').trim() === selectedClass);
        const nisList = bulkClassStudents.map(s => String(s.nis || s.id || '').trim()).filter(Boolean);

        if (nisList.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-slate-400 italic">Tidak ada siswa terdaftar di rombel ini.</td></tr>';
            return;
        }

        // 2. Fetch active loans for this class in 1 query
        const { data: loansData, error: errLoans } = await supabase
            .from('lib_sirkulasi')
            .select('id, peminjam_id, status, status_denda, total_denda')
            .in('peminjam_id', nisList);

        if (errLoans) throw errLoans;

        bulkClassLoans = loansData || [];

        // 3. Fetch existing clearance approvals for this class in 1 query
        const approvalsResponse = await callSecureEdgeFunction('library-clearance-get', { nisList });
        const approvalsData = approvalsResponse?.data || [];

        bulkClassApprovals.clear();
        (approvalsData || []).forEach(a => bulkClassApprovals.set(String(a.student_nis), a));

        // Group loans and fines per student
        const loansMap = new Map();
        const finesMap = new Map();

        (loansData || []).forEach(l => {
            const nis = String(l.peminjam_id);
            if (l.status === 'dipinjam') {
                loansMap.set(nis, (loansMap.get(nis) || 0) + 1);
            }
            if (l.status_denda === 'belum_lunas') {
                finesMap.set(nis, (finesMap.get(nis) || 0) + (Number(l.total_denda) || 0));
            }
        });

        // 4. Render Rows & Calculate Stats
        let countTotal = bulkClassStudents.length;
        let countApproved = 0;
        let countClean = 0;
        let countBurden = 0;
        const cleanToApproveNISList = [];

        const rowsHtml = bulkClassStudents.map((s, idx) => {
            const nis = String(s.nis || s.id || '').trim();
            const nama = s.nama || s.name || '-';
            const activeLoansCount = loansMap.get(nis) || 0;
            const unpaidFinesAmount = finesMap.get(nis) || 0;
            const approval = bulkClassApprovals.get(nis);

            const hasBurden = activeLoansCount > 0 || unpaidFinesAmount > 0;
            const isApproved = !!approval;

            if (isApproved) {
                countApproved++;
            } else if (hasBurden) {
                countBurden++;
            } else {
                countClean++;
                cleanToApproveNISList.push({ nis, nama, kelas: selectedClass });
            }

            // Loan Badge
            const loanBadge = activeLoansCount === 0
                ? '<span class="px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 font-bold text-[10px]">0 Buku (Bersih)</span>'
                : `<span class="px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 font-bold text-[10px]">${activeLoansCount} Buku Aktif</span>`;

            // Fine Badge
            const fineBadge = unpaidFinesAmount === 0
                ? '<span class="px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 font-bold text-[10px]">Rp 0 (Lunas)</span>'
                : `<span class="px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 font-bold text-[10px]">Rp ${unpaidFinesAmount.toLocaleString('id-ID')}</span>`;

            // Status Column
            let statusCol;
            let actionBtn;

            if (isApproved) {
                statusCol = `
                    <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 text-teal-700 dark:text-teal-300 font-bold text-[11px]" title="${escapeHTML(approval.no_surat)}">
                        <i class="fa-solid fa-circle-check text-teal-500"></i> Bebas Pustaka
                    </div>
                `;
                actionBtn = canManageClearance ? `
                    <button onclick="window.revokeStudentClearance(${escapeHTML(JSON.stringify(nis))}, ${escapeHTML(JSON.stringify(nama))})" class="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200 dark:border-rose-800 font-semibold text-[10px] transition" title="Cabut Status Bebas Pustaka">
                        <i class="fa-solid fa-ban"></i> Cabut
                    </button>
                ` : '<span class="text-slate-400 text-[10px] italic">Lihat saja</span>';
            } else if (hasBurden) {
                statusCol = `
                    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 font-semibold text-[10px]">
                        <i class="fa-solid fa-circle-exclamation"></i> Ada Tanggungan
                    </span>
                `;
                actionBtn = `<span class="text-slate-400 text-[10px] italic">Selesaikan Buku/Denda</span>`;
            } else {
                statusCol = `
                    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 font-semibold text-[10px]">
                        Belum Diterbitkan
                    </span>
                `;
                actionBtn = canManageClearance ? `
                    <button onclick="window.approveSingleStudentBulk(${escapeHTML(JSON.stringify(nis))}, ${escapeHTML(JSON.stringify(nama))}, ${escapeHTML(JSON.stringify(selectedClass))})" class="px-2.5 py-1 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-bold text-[10px] transition shadow-sm" title="Setujui Bebas Pustaka">
                        <i class="fa-solid fa-check"></i> Setujui Digital
                    </button>
                ` : '<span class="text-slate-400 text-[10px] italic">Belum diterbitkan</span>';
            }

            return `
                <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition">
                    <td class="px-4 py-3 text-center text-slate-400">${idx + 1}</td>
                    <td class="px-4 py-3 font-bold text-slate-800 dark:text-white">${escapeHTML(nama)}</td>
                    <td class="px-4 py-3 font-mono text-slate-500 dark:text-slate-400">${escapeHTML(nis)}</td>
                    <td class="px-4 py-3 text-center whitespace-nowrap">${loanBadge}</td>
                    <td class="px-4 py-3 text-center whitespace-nowrap">${fineBadge}</td>
                    <td class="px-4 py-3 text-center whitespace-nowrap">${statusCol}</td>
                    <td class="px-4 py-3 text-center whitespace-nowrap">${actionBtn}</td>
                </tr>
            `;
        }).join('');

        tbody.innerHTML = rowsHtml;

        // Update Stats Bar
        document.getElementById('stat-bulk-total').textContent = countTotal;
        document.getElementById('stat-bulk-approved').textContent = countApproved;
        document.getElementById('stat-bulk-clean').textContent = countClean;
        document.getElementById('stat-bulk-burden').textContent = countBurden;
        statsBar.classList.remove('hidden');

        // Enable / Disable Batch Approve Button
        if (canManageClearance && countClean > 0) {
            btnApproveAllClean.disabled = false;
            btnApproveAllClean.className = 'w-full sm:w-auto px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs transition shadow-md shadow-teal-600/30 flex items-center justify-center gap-2 active:scale-98 cursor-pointer';
            btnApproveAllClean.setAttribute('data-clean-count', countClean);
        } else {
            btnApproveAllClean.disabled = true;
            btnApproveAllClean.className = 'w-full sm:w-auto px-5 py-2.5 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-400 font-bold text-xs transition flex items-center justify-center gap-2 cursor-not-allowed';
        }

    } catch (e) {
        console.error('[BebasPustaka] Gagal load status rombel:', e);
        tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-rose-500">Gagal memuat status sirkulasi rombel: ' + escapeHTML(e.message) + '</td></tr>';
    }
}

// 8. APPROVE ALL CLEAN STUDENTS IN CLASS (BATCH)
async function handleApproveAllCleanStudents() {
    const selectedClass = document.getElementById('bulk-select-class').value;
    if (!selectedClass) return;

    const keperluan = document.getElementById('bulk-keperluan').value;
    const academicYear = getCurrentAcademicYearString ? getCurrentAcademicYearString() : '2025/2026';

    // Gunakan hasil verifikasi terakhir untuk menghitung kandidat di UI. Backend
    // akan melakukan verifikasi ulang tepat sebelum penerbitan untuk mencegah race.
    const cleanStudents = filterEligibleClearanceStudents(
        bulkClassStudents,
        bulkClassLoans,
        new Set(bulkClassApprovals.keys())
    );

    if (cleanStudents.length === 0) {
        Swal.fire({ icon: 'info', title: 'Sudah Selesai', text: 'Semua siswa di kelas ini yang bersih dari pinjaman sudah memiliki status Bebas Pustaka.', confirmButtonColor: '#0d9488' });
        return;
    }

    const confirm = await Swal.fire({
        icon: 'question',
        title: 'Setujui Massal Bebas Pustaka?',
        html: `Apakah Anda yakin ingin menyetujui status Bebas Pustaka Digital untuk <b>${cleanStudents.length} siswa</b> di kelas <b>${escapeHTML(selectedClass)}</b>?`,
        showCancelButton: true,
        confirmButtonText: `Ya, Setujui (${cleanStudents.length} Siswa)`,
        cancelButtonText: 'Batal',
        confirmButtonColor: '#0d9488'
    });

    if (!confirm.isConfirmed) return;

    const btn = document.getElementById('btn-approve-all-clean');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Memproses...';

    try {
        const students = cleanStudents.map(s => ({
            nis: String(s.nis || s.id || '').trim(),
            name: s.nama || s.name || '',
            className: selectedClass
        }));
        const response = await callSecureEdgeFunction('library-clearance-approve', {
            students,
            academicYear,
            purpose: keperluan
        });
        const issuedCount = response?.data?.length || 0;
        const rejectedCount = response?.rejected?.length || 0;

        if (issuedCount === 0) {
            throw new Error(response?.rejected?.[0]?.reason || 'Tidak ada siswa yang dapat diterbitkan status bebas pustakanya.');
        }

        Swal.fire({
            icon: 'success',
            title: 'Berhasil Disetujui Massal!',
            text: `${issuedCount} siswa kelas ${selectedClass} berhasil disetujui.${rejectedCount ? ` ${rejectedCount} siswa dilewati karena status tanggungan berubah.` : ''}`,
            confirmButtonColor: '#0d9488'
        });

        // Notifikasi Ekosistem: Kirim push notification ke setiap siswa yang diterbitkan suratnya
        if (Array.isArray(response?.data)) {
            response.data.forEach(item => {
                const itemNis = item.nis || item.student_nis;
                const itemNoSurat = item.no_surat || '';
                if (itemNis) {
                    cfClient.sendPushNotification({
                        title: '📚 Surat Bebas Pustaka Diterbitkan',
                        body: `Surat Keterangan Bebas Pustaka digital Anda telah diterbitkan${itemNoSurat ? ` (Nomor: ${itemNoSurat})` : ''}. Silakan periksa di Portal Siswa.`,
                        url: './portal-siswa.html',
                        targetType: 'user',
                        targetValue: itemNis
                    }).catch(err => console.warn('[BebasPustaka] Gagal kirim notif batch ke siswa:', err));
                }
            });
        }

        await handleClassChange({ target: { value: selectedClass } });
        await loadIssuedLettersHistory();

    } catch (e) {
        console.error('[BebasPustaka] Error batch approve:', e);
        Swal.fire({ icon: 'error', title: 'Gagal Memproses', text: e.message, confirmButtonColor: '#2563eb' });
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-square-check"></i> Setujui Semua Siswa Bersih (Batch)';
    }
}

// 9. APPROVE SINGLE STUDENT FROM BULK TABLE
window.approveSingleStudentBulk = async function (nis, nama, kelas) {
    const keperluan = document.getElementById('bulk-keperluan')?.value || 'Pengambilan Ijazah / Kelulusan';
    const academicYear = getCurrentAcademicYearString ? getCurrentAcademicYearString() : '2025/2026';

    try {
        const response = await callSecureEdgeFunction('library-clearance-approve', {
            students: [{ nis, name: nama, className: kelas }],
            academicYear,
            purpose: keperluan
        });
        if (response?.rejected?.length) throw new Error(response.rejected[0].reason);
        const savedRecord = response?.data?.[0];
        if (!savedRecord) throw new Error('Server tidak mengembalikan data surat yang diterbitkan.');

        // Notifikasi Ekosistem: Kirim push notification ke siswa
        cfClient.sendPushNotification({
            title: '📚 Surat Bebas Pustaka Diterbitkan',
            body: `Surat Keterangan Bebas Pustaka digital Anda telah diterbitkan (Nomor: ${savedRecord.no_surat}). Silakan periksa di Portal Siswa.`,
            url: './portal-siswa.html',
            targetType: 'user',
            targetValue: String(nis).trim()
        }).catch(err => console.warn('[BebasPustaka] Gagal kirim notif ke siswa:', err));

        Swal.fire({
            icon: 'success',
            title: 'Bebas Pustaka Disetujui!',
            html: `Siswa <b>${escapeHTML(nama)}</b> berhasil disetujui bebas pustaka dengan nomor <b>${escapeHTML(savedRecord.no_surat)}</b>.`,
            timer: 2000,
            showConfirmButton: false
        });

        await handleClassChange({ target: { value: kelas } });
        await loadIssuedLettersHistory();

    } catch (e) {
        console.error('[BebasPustaka] Gagal setujui:', e);
        Swal.fire({ icon: 'error', title: 'Gagal', text: e.message, confirmButtonColor: '#2563eb' });
    }
};

// 10. REVOKE CLEARANCE STATUS
window.revokeStudentClearance = async function (nis, nama) {
    const confirm = await Swal.fire({
        icon: 'warning',
        title: 'Cabut Status Bebas Pustaka?',
        html: `Apakah Anda yakin ingin mencabut status Bebas Pustaka untuk <b>${escapeHTML(nama)}</b> (NIS: ${nis})?`,
        showCancelButton: true,
        confirmButtonText: 'Ya, Cabut Status',
        cancelButtonText: 'Batal',
        confirmButtonColor: '#e11d48'
    });

    if (!confirm.isConfirmed) return;

    try {
        await callSecureEdgeFunction('library-clearance-revoke', { nis });

        Swal.fire({
            icon: 'success',
            title: 'Status Dicabut',
            text: `Status bebas pustaka ${nama} telah dinonaktifkan.`,
            timer: 2000,
            showConfirmButton: false
        });

        const curClass = document.getElementById('bulk-select-class')?.value;
        if (curClass) await handleClassChange({ target: { value: curClass } });
        await loadIssuedLettersHistory();

    } catch (e) {
        console.error('[BebasPustaka] Gagal cabut:', e);
        Swal.fire({ icon: 'error', title: 'Gagal', text: e.message, confirmButtonColor: '#2563eb' });
    }
};

// =========================================================================
// 11. HISTORY LIST & RE-PRINT
// =========================================================================
async function loadIssuedLettersHistory() {
    try {
        const response = await callSecureEdgeFunction('library-clearance-history', {});
        issuedLettersHistory = (response?.data || []).slice(0, 100);
        renderHistoryTable();

    } catch (e) {
        console.error('[BebasPustaka] Error load history:', e);
        const tbody = document.getElementById('history-surat-tbody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-rose-500">Gagal memuat riwayat.</td></tr>';
    }
}

function renderHistoryTable() {
    const tbody = document.getElementById('history-surat-tbody');
    const searchVal = (document.getElementById('history-search-input')?.value || '').toLowerCase().trim();
    const countInfo = document.getElementById('history-count-info');

    if (!tbody) return;

    let filtered = issuedLettersHistory.filter(row => {
        if (!searchVal) return true;
        const no = (row.no_surat || '').toLowerCase();
        const nama = (row.student_name || '').toLowerCase();
        const nis = (row.student_nis || '').toLowerCase();
        const kelas = (row.student_class || '').toLowerCase();

        return no.includes(searchVal) || nama.includes(searchVal) || nis.includes(searchVal) || kelas.includes(searchVal);
    });

    if (countInfo) countInfo.textContent = `Menampilkan ${filtered.length} dari ${issuedLettersHistory.length} data bebas pustaka`;

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-slate-400 italic">Belum ada riwayat surat bebas pustaka digital.</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(row => `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition">
            <td class="px-5 py-3.5 font-mono font-bold text-teal-600 dark:text-teal-400 whitespace-nowrap">${escapeHTML(row.no_surat)}</td>
            <td class="px-5 py-3.5">
                <div class="font-bold text-slate-800 dark:text-white">${escapeHTML(row.student_name)}</div>
                <div class="text-[10px] text-slate-400 font-mono">NIS: ${escapeHTML(row.student_nis)}</div>
            </td>
            <td class="px-5 py-3.5 font-semibold text-slate-700 dark:text-slate-300">${escapeHTML(row.student_class)}</td>
            <td class="px-5 py-3.5 whitespace-nowrap text-slate-600 dark:text-slate-400">${formatDateIndo(row.tgl_terbit)}</td>
            <td class="px-5 py-3.5 text-slate-600 dark:text-slate-400 text-xs">${escapeHTML(row.petugas_nama || 'Petugas Perpus')}</td>
            <td class="px-5 py-3.5 text-center whitespace-nowrap">
                <span class="px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 font-bold text-[10px] inline-flex items-center gap-1">
                    <i class="fa-solid fa-circle-check"></i> Digital Resmi
                </span>
            </td>
            <td class="px-5 py-3.5 text-center whitespace-nowrap">
                <div class="flex items-center justify-center gap-1.5">
                    <button onclick="window.reprintHistorySurat(${row.id})" class="px-2.5 py-1 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300 border border-teal-200 dark:border-teal-800 font-bold text-[11px] transition flex items-center gap-1" title="Lihat / Cetak Dokumen">
                        <i class="fa-solid fa-eye"></i> E-Surat
                    </button>
                    ${canManageClearance ? `
                        <button onclick="window.revokeStudentClearance(${escapeHTML(JSON.stringify(String(row.student_nis || '')))}, ${escapeHTML(JSON.stringify(row.student_name || ''))})" class="w-7 h-7 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200 dark:border-rose-800 flex items-center justify-center text-xs transition" title="Cabut Status">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    ` : ''}
                </div>
            </td>
        </tr>
    `).join('');
}

window.reprintHistorySurat = function (historyId) {
    const item = issuedLettersHistory.find(h => h.id === historyId);
    if (!item) return;

    // Switch to single tab to view preview
    document.getElementById('tab-btn-single')?.click();

    document.getElementById('preview-no-surat').textContent = `Nomor: ${item.no_surat}`;
    document.getElementById('preview-student-name').textContent = item.student_name;
    document.getElementById('preview-student-nis').textContent = item.student_nis;
    document.getElementById('preview-student-class').textContent = item.student_class;
    document.getElementById('preview-academic-year').textContent = item.tahun_ajaran || '2025/2026';
    document.getElementById('preview-keperluan').textContent = item.keperluan;
    document.getElementById('preview-tanggal-surat').textContent = `Denpasar, ${formatDateIndo(item.tgl_terbit)}`;
    
    // Tanda tangan resmi mengacu ke Kepala Perpustakaan terkonfigurasi
    renderSignerIdentity();

    document.getElementById('btn-print-active-surat').classList.remove('hidden');
    document.getElementById('printable-surat').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

/* library/laporan.js - Laporan Statistik & Akreditasi Perpustakaan */
import { auth, db, PATHS, supabase } from '../js/config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { initLayout, escapeHTML, formatDateIndo, getLocalISODate, callSecureEdgeFunction } from '../js/global.js';
import { fetchAllSupabaseRows } from '../js/supabase-pagination.mjs';

// =========================================================================
// 1. STATE & DATA
// =========================================================================
let currentActiveTab = 'ddc';
let allDDCData = [];
let allBooksData = [];
let allSirkulasiData = [];
let canManageLibraryReport = false;

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
    
    // RBAC: super_admin, admin_perpus, kepala_sekolah, staff
    const allowedRoles = ['super_admin', 'admin_perpus', 'kepala_sekolah', 'staff'];
    const hasAccess = allRoles.some(r => allowedRoles.includes(r));
    canManageLibraryReport = allRoles.some(r => ['super_admin', 'admin_perpus', 'staff'].includes(r));

    if (!hasAccess) {
        Swal.fire({
            icon: 'error',
            title: 'Akses Ditolak',
            text: 'Halaman Laporan Statistik Perpustakaan hanya untuk Petugas dan Kepala Sekolah.',
            confirmButtonColor: '#2563eb'
        }).then(() => {
            window.location.href = 'opac.html';
        });
        return;
    }

    await initLayout(primaryRole);
    document.querySelector('main')?.classList.remove('hidden');

    await loadAllLibraryReportData();
    setupLaporanEventListeners();
});

// =========================================================================
// 3. LOAD RAW DATA
// =========================================================================
async function loadAllLibraryReportData() {
    try {
        // 1. DDC
        const { data: ddc } = await supabase.from('lib_kategori_ddc').select('*').order('kode', { ascending: true });
        allDDCData = ddc || [];

        // 2. Buku & Eksemplar
        allBooksData = await fetchAllSupabaseRows((from, to) => supabase
            .from('lib_buku')
            .select('*')
            .is('archived_at', null)
            .order('id', { ascending: true })
            .range(from, to));

        // 3. Sirkulasi
        allSirkulasiData = await fetchAllSupabaseRows((from, to) => supabase
            .from('lib_sirkulasi')
            .select(`
                *,
                buku:lib_buku (judul, pengarang)
            `)
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, to));

        // Populate Year Filter
        populateYearFilter();

        // Render Active Tab
        renderActiveLaporanTab();

    } catch (e) {
        console.error('[Laporan] Error load data:', e);
    }
}

function populateYearFilter() {
    const select = document.getElementById('select-filter-tahun-sirkulasi');
    if (!select) return;

    const currentYear = new Date().getFullYear();
    const years = [currentYear, currentYear - 1, currentYear - 2];

    select.innerHTML = years.map(y => `<option value="${y}">Tahun ${y}</option>`).join('');
    select.addEventListener('change', renderSirkulasiMonthlyReport);
}

// =========================================================================
// 4. TAB SWITCHING
// =========================================================================
window.switchLaporanTab = function (tabName) {
    currentActiveTab = tabName;
    const tabs = ['ddc', 'sirkulasi', 'top', 'denda'];

    tabs.forEach(t => {
        const btn = document.getElementById(`tab-btn-${t}`);
        const content = document.getElementById(`tab-content-${t}`);

        if (t === tabName) {
            btn.className = "laporan-tab-btn flex-1 min-w-[140px] px-4 py-2.5 rounded-xl text-xs font-bold transition-all bg-blue-600 text-white shadow-sm flex items-center justify-center gap-2";
            content.classList.remove('hidden');
        } else {
            btn.className = "laporan-tab-btn flex-1 min-w-[140px] px-4 py-2.5 rounded-xl text-xs font-bold transition-all text-slate-500 hover:text-slate-800 dark:hover:text-white flex items-center justify-center gap-2";
            content.classList.add('hidden');
        }
    });

    renderActiveLaporanTab();
};

function renderActiveLaporanTab() {
    if (currentActiveTab === 'ddc') renderDDCDistributionReport();
    else if (currentActiveTab === 'sirkulasi') renderSirkulasiMonthlyReport();
    else if (currentActiveTab === 'top') renderTopReadersAndBooks();
    else if (currentActiveTab === 'denda') renderDendaReport();
}

function setupLaporanEventListeners() {
    document.getElementById('btn-export-current-laporan')?.addEventListener('click', exportActiveReportToExcel);
}

// =========================================================================
// 5. TAB 1: DISTRIBUSI DDC
// =========================================================================
function renderDDCDistributionReport() {
    const tbody = document.getElementById('ddc-distribution-tbody');
    const mainClasses = [
        { code: '000', name: 'Karya Umum, Komputer & Informasi' },
        { code: '100', name: 'Filsafat & Psikologi' },
        { code: '200', name: 'Agama & Teologi' },
        { code: '300', name: 'Ilmu-ilmu Sosial & Pendidikan' },
        { code: '400', name: 'Bahasa & Linguistik' },
        { code: '500', name: 'Sains Murni & Alam' },
        { code: '600', name: 'Teknologi & Ilmu Terapan' },
        { code: '700', name: 'Kesenian, Hiburan & Olahraga' },
        { code: '800', name: 'Kesusastraan / Karya Fiksi' },
        { code: '900', name: 'Sejarah, Geografi & Biografi' }
    ];

    let grandTotalJudul = 0;
    let grandTotalEksemplar = 0;

    const stats = mainClasses.map(c => {
        const prefix = c.code.charAt(0);
        const matchingBooks = allBooksData.filter(b => (b.kategori_ddc || '').toString().startsWith(prefix));
        
        const countJudul = matchingBooks.length;
        const countEksemplar = matchingBooks.reduce((acc, curr) => acc + (curr.total_eksemplar || 0), 0);

        grandTotalJudul += countJudul;
        grandTotalEksemplar += countEksemplar;

        return {
            code: c.code,
            name: c.name,
            countJudul,
            countEksemplar
        };
    });

    document.getElementById('tfoot-total-judul').textContent = grandTotalJudul.toLocaleString('id-ID');
    document.getElementById('tfoot-total-eksemplar').textContent = grandTotalEksemplar.toLocaleString('id-ID');

    tbody.innerHTML = stats.map(s => {
        const pct = grandTotalEksemplar > 0 ? ((s.countEksemplar / grandTotalEksemplar) * 100).toFixed(1) : '0.0';

        return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition">
                <td class="px-5 py-3.5 font-mono font-bold text-blue-600 dark:text-blue-400">${s.code}</td>
                <td class="px-5 py-3.5 font-bold text-slate-800 dark:text-slate-200">${s.name}</td>
                <td class="px-5 py-3.5 text-center font-bold text-slate-700 dark:text-slate-300">${s.countJudul.toLocaleString('id-ID')}</td>
                <td class="px-5 py-3.5 text-center font-bold text-indigo-600 dark:text-indigo-400">${s.countEksemplar.toLocaleString('id-ID')}</td>
                <td class="px-5 py-3.5 text-center">
                    <div class="flex items-center justify-center gap-2">
                        <div class="w-16 bg-slate-100 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                            <div class="bg-blue-600 h-1.5 rounded-full" style="width: ${pct}%"></div>
                        </div>
                        <span class="font-mono text-[11px] font-semibold text-slate-600 dark:text-slate-400">${pct}%</span>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// =========================================================================
// 6. TAB 2: REKAP SIRKULASI BULANAN
// =========================================================================
function renderSirkulasiMonthlyReport() {
    const tbody = document.getElementById('sirkulasi-monthly-tbody');
    const selectedYear = parseInt(document.getElementById('select-filter-tahun-sirkulasi')?.value || new Date().getFullYear(), 10);
    const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

    const monthlyStats = months.map((monthName, idx) => {
        const monthNum = String(idx + 1).padStart(2, '0');
        const monthPrefix = `${selectedYear}-${monthNum}`;

        const monthLoans = allSirkulasiData.filter(s => (s.tgl_pinjam || '').startsWith(monthPrefix));
        const siswaLoans = monthLoans.filter(s => s.peminjam_type === 'siswa').length;
        const guruLoans = monthLoans.filter(s => s.peminjam_type === 'guru').length;
        const returned = monthLoans.filter(s => s.status === 'kembali').length;
        const late = monthLoans.filter(s => (s.hari_terlambat || 0) > 0).length;

        return {
            month: monthName,
            siswa: siswaLoans,
            guru: guruLoans,
            returned: returned,
            late: late,
            total: monthLoans.length
        };
    });

    tbody.innerHTML = monthlyStats.map(m => `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition">
            <td class="px-5 py-3.5 font-bold text-slate-800 dark:text-white">${m.month}</td>
            <td class="px-5 py-3.5 text-center font-semibold text-blue-600">${m.siswa}</td>
            <td class="px-5 py-3.5 text-center font-semibold text-purple-600">${m.guru}</td>
            <td class="px-5 py-3.5 text-center font-semibold text-emerald-600">${m.returned}</td>
            <td class="px-5 py-3.5 text-center font-semibold ${m.late > 0 ? 'text-rose-600' : 'text-slate-400'}">${m.late}</td>
            <td class="px-5 py-3.5 text-center font-black text-slate-800 dark:text-white">${m.total}</td>
        </tr>
    `).join('');
}

// =========================================================================
// 7. TAB 3: TOP READERS & TOP BOOKS
// =========================================================================
function renderTopReadersAndBooks() {
    const readersListEl = document.getElementById('top-readers-list');
    const booksListEl = document.getElementById('top-books-list');

    // 1. Top Readers Siswa
    const studentBorrowCounts = {};
    allSirkulasiData.forEach(s => {
        if (s.peminjam_type === 'siswa' && s.peminjam_nama) {
            const key = `${s.peminjam_nama}___${s.peminjam_id}___${s.peminjam_kelas || '-'}`;
            studentBorrowCounts[key] = (studentBorrowCounts[key] || 0) + 1;
        }
    });

    const sortedStudents = Object.entries(studentBorrowCounts)
        .map(([key, count]) => {
            const [nama, nis, kelas] = key.split('___');
            return { nama, nis, kelas, count };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

    if (sortedStudents.length === 0) {
        readersListEl.innerHTML = '<div class="p-4 text-center text-slate-400 text-xs italic">Belum ada riwayat peminjaman siswa.</div>';
    } else {
        readersListEl.innerHTML = sortedStudents.map((st, idx) => `
            <div class="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-700/60 flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <div class="w-7 h-7 rounded-xl ${idx < 3 ? 'bg-amber-500 text-white font-black' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold'} flex items-center justify-center text-xs">
                        ${idx + 1}
                    </div>
                    <div>
                        <div class="font-bold text-slate-900 dark:text-white text-xs">${escapeHTML(st.nama)}</div>
                        <div class="text-[10px] text-slate-400">${escapeHTML(st.kelas)} &bull; NIS: ${escapeHTML(st.nis)}</div>
                    </div>
                </div>
                <span class="px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-extrabold text-[11px]">
                    ${st.count}x Pinjam
                </span>
            </div>
        `).join('');
    }

    // 2. Top Books
    const bookBorrowCounts = {};
    allSirkulasiData.forEach(s => {
        if (s.buku_id) {
            const judul = s.buku?.judul || 'Buku';
            bookBorrowCounts[judul] = (bookBorrowCounts[judul] || 0) + 1;
        }
    });

    const sortedBooks = Object.entries(bookBorrowCounts)
        .map(([judul, count]) => ({ judul, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

    if (sortedBooks.length === 0) {
        booksListEl.innerHTML = '<div class="p-4 text-center text-slate-400 text-xs italic">Belum ada riwayat peminjaman buku.</div>';
    } else {
        booksListEl.innerHTML = sortedBooks.map((bk, idx) => `
            <div class="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-700/60 flex items-center justify-between">
                <div class="flex items-center gap-3 min-w-0 pr-2">
                    <div class="w-7 h-7 rounded-xl ${idx < 3 ? 'bg-blue-600 text-white font-black' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold'} flex items-center justify-center text-xs shrink-0">
                        ${idx + 1}
                    </div>
                    <div class="min-w-0">
                        <div class="font-bold text-slate-900 dark:text-white text-xs truncate" title="${escapeHTML(bk.judul)}">${escapeHTML(bk.judul)}</div>
                    </div>
                </div>
                <span class="px-2.5 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-extrabold text-[11px] shrink-0">
                    ${bk.count}x Dipinjam
                </span>
            </div>
        `).join('');
    }
}

// =========================================================================
// 8. TAB 4: REKAP DENDA
// =========================================================================
function renderDendaReport() {
    const tbody = document.getElementById('rekap-denda-tbody');
    const finedLoans = allSirkulasiData.filter(s => (s.hari_terlambat || 0) > 0 || (Number(s.total_denda) || 0) > 0);

    if (finedLoans.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-slate-400 italic">Tidak ada catatan denda keterlambatan buku.</td></tr>';
        return;
    }

    tbody.innerHTML = finedLoans.map(row => {
        const isLunas = row.status_denda === 'lunas' || row.status_denda === 'bebas_denda';
        let badgeDenda = '';
        if (row.status_denda === 'bebas_denda') {
            badgeDenda = `<span class="px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 font-bold text-[10px] border border-blue-200">Bebas Denda</span>`;
        } else if (row.status_denda === 'lunas') {
            badgeDenda = `<span class="px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 font-bold text-[10px] border border-emerald-200">Lunas</span>`;
        } else {
            badgeDenda = `<span class="px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-600 font-bold text-[10px] border border-rose-200">Belum Lunas</span>`;
        }

        return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition">
                <td class="px-5 py-3.5">
                    <div class="font-bold text-slate-900 dark:text-white">${escapeHTML(row.peminjam_nama)}</div>
                    <div class="text-[10px] text-slate-400 font-mono">${escapeHTML(row.peminjam_id)} (${escapeHTML(row.peminjam_kelas || row.peminjam_type)})</div>
                </td>
                <td class="px-5 py-3.5 font-medium text-slate-800 dark:text-slate-200">${escapeHTML(row.buku?.judul || '-')}</td>
                <td class="px-5 py-3.5 text-slate-600 dark:text-slate-400">${row.hari_terlambat || 0} Hari</td>
                <td class="px-5 py-3.5 font-bold ${(Number(row.total_denda) || 0) > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'}">Rp ${(Number(row.total_denda) || 0).toLocaleString('id-ID')}</td>
                <td class="px-5 py-3.5">${badgeDenda}</td>
                <td class="px-5 py-3.5 text-center">
                    ${!isLunas && canManageLibraryReport ? `
                        <button onclick="window.markDendaLunas(${row.id})" class="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] transition shadow-sm">
                            Tandai Lunas
                        </button>
                    ` : `<span class="text-slate-400 text-xs italic">${!isLunas ? 'Mode audit' : '-'}</span>`}
                </td>
            </tr>
        `;
    }).join('');
}

window.markDendaLunas = async function (sirkulasiId) {
    if (!canManageLibraryReport) return;
    const { isConfirmed } = await Swal.fire({
        title: 'Pelunasan Denda?',
        text: 'Tandai denda keterlambatan ini sebagai Lunas?',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Ya, Tandai Lunas',
        cancelButtonText: 'Batal',
        confirmButtonColor: '#10b981'
    });

    if (!isConfirmed) return;

    try {
        await callSecureEdgeFunction('library-fine-settle', { circulationId: sirkulasiId });

        Swal.fire({ icon: 'success', title: 'Lunas', text: 'Status denda berhasil diperbarui.', timer: 1500, showConfirmButton: false });
        await loadAllLibraryReportData();

    } catch (e) {
        console.error('[Laporan] Error mark lunas:', e);
        Swal.fire({ icon: 'error', title: 'Gagal', text: e.message, confirmButtonColor: '#2563eb' });
    }
};

// =========================================================================
// 9. EXCEL EXPORT (SHEETJS)
// =========================================================================
function exportActiveReportToExcel() {
    try {
        let rows = [];
        let sheetName = 'Laporan';

        if (currentActiveTab === 'ddc') {
            sheetName = 'Distribusi_DDC';
            const mainClasses = [
                { code: '000', name: 'Karya Umum, Komputer & Informasi' },
                { code: '100', name: 'Filsafat & Psikologi' },
                { code: '200', name: 'Agama & Teologi' },
                { code: '300', name: 'Ilmu-ilmu Sosial & Pendidikan' },
                { code: '400', name: 'Bahasa & Linguistik' },
                { code: '500', name: 'Sains Murni & Alam' },
                { code: '600', name: 'Teknologi & Ilmu Terapan' },
                { code: '700', name: 'Kesenian, Hiburan & Olahraga' },
                { code: '800', name: 'Kesusastraan / Karya Fiksi' },
                { code: '900', name: 'Sejarah, Geografi & Biografi' }
            ];

            rows = mainClasses.map(c => {
                const matching = allBooksData.filter(b => (b.kategori_ddc || '').toString().startsWith(c.code.charAt(0)));
                return {
                    'Kelas DDC': c.code,
                    'Klasifikasi Bidang Ilmu': c.name,
                    'Jumlah Judul': matching.length,
                    'Jumlah Eksemplar Fisik': matching.reduce((acc, curr) => acc + (curr.total_eksemplar || 0), 0)
                };
            });
        } else if (currentActiveTab === 'sirkulasi') {
            sheetName = 'Rekap_Sirkulasi';
            rows = allSirkulasiData.map((s, idx) => ({
                'No': idx + 1,
                'Kode Transaksi': s.kode_transaksi,
                'Peminjam': s.peminjam_nama,
                'Tipe': s.peminjam_type,
                'Kelas/Jabatan': s.peminjam_kelas || '-',
                'Judul Buku': s.buku?.judul || '-',
                'Tgl Pinjam': s.tgl_pinjam,
                'Tgl Jatuh Tempo': s.tgl_jatuh_tempo,
                'Tgl Kembali': s.tgl_kembali || '-',
                'Status': s.status,
                'Terlambat (Hari)': s.hari_terlambat || 0,
                'Denda (Rp)': s.total_denda || 0
            }));
        } else if (currentActiveTab === 'denda') {
            sheetName = 'Rekap_Denda';
            rows = allSirkulasiData.filter(s => (Number(s.total_denda) || 0) > 0).map((s, idx) => ({
                'No': idx + 1,
                'Peminjam': s.peminjam_nama,
                'NIS/NIP': s.peminjam_id,
                'Judul Buku': s.buku?.judul || '-',
                'Hari Terlambat': s.hari_terlambat || 0,
                'Nominal Denda (Rp)': s.total_denda || 0,
                'Status Denda': s.status_denda || 'belum_lunas'
            }));
        } else {
            sheetName = 'Top_Peminjam';
            const studentCounts = {};
            allSirkulasiData.forEach(s => {
                if (s.peminjam_type === 'siswa' && s.peminjam_nama) {
                    studentCounts[s.peminjam_nama] = (studentCounts[s.peminjam_nama] || 0) + 1;
                }
            });
            rows = Object.entries(studentCounts).map(([nama, count], idx) => ({
                'Peringkat': idx + 1,
                'Nama Siswa': nama,
                'Total Kali Meminjam': count
            })).sort((a, b) => b['Total Kali Meminjam'] - a['Total Kali Meminjam']);
        }

        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
        XLSX.writeFile(wb, `Laporan_${sheetName}_SMANTARA_${getLocalISODate()}.xlsx`);

    } catch (e) {
        console.error('[Laporan] Error export Excel:', e);
        Swal.fire({ icon: 'error', title: 'Gagal Export', text: e.message, confirmButtonColor: '#2563eb' });
    }
}

/**
 * page-sarpras-aduan.js - Controller Halaman Aduan & Usulan Sarpras SIMAS SMAGESA
 * Single Source of Truth (SSOT): Cloudflare D1 via cfClient (/api/sarpras/reports)
 * Standar: OWASP Top 10, ASVS Level 1 & 2, Action & Security Parity
 */

import cfClient from './cloudflare-client.js';

// State Module
let userUid = '';
let userRole = 'guru_mapel';
let userName = "Civitas SMANTARA";
let isManager = false;
let isWaka = false;
let roomsList = [];
let reportsList = [];
let currentFilter = {
    search: '',
    status: '',
    category: '',
    urgency: ''
};
let searchDebounceTimer = null;

// Toast Helper
function showToast(title, msg, type = 'info') {
    if (typeof window.showToast === 'function') {
        window.showToast(title, msg, type);
    } else {
        console.log(`[${type}] ${title}: ${msg}`);
    }
}

// Cek Wewenang Pengelola Sarpras
function isSarprasManager() {
    if (typeof window.hasRole === 'function') {
        return window.hasRole('super_admin') || window.hasRole('sarpras') || window.hasRole('admin_sarpras');
    }
    const role = localStorage.getItem('user_role');
    return ['super_admin', 'sarpras', 'admin_sarpras'].includes(role);
}

// =========================================================================
// 1. Inisialisasi Modul & Otentikasi
// =========================================================================

function applyUserContext() {
    userUid = localStorage.getItem('user_uid') || '';
    userRole = localStorage.getItem('user_role') || 'guru_mapel';
    userName = localStorage.getItem('user_name') || "Civitas SMANTARA";

    isManager = isSarprasManager();
    isWaka = userRole === 'sarpras' || userRole === 'super_admin';

    // Update Header User Name & Tanggal
    const headerUserName = document.getElementById('header-user-name');
    if (headerUserName) {
        const roleLabel = getRoleLabel(userRole);
        headerUserName.textContent = `${userName} (${roleLabel})`;
    }

    const headerDate = document.getElementById('header-date-display');
    if (headerDate) {
        const now = new Date();
        const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Makassar' };
        headerDate.textContent = now.toLocaleDateString('id-ID', options) + ' WITA';
    }
}

async function initPage() {
    applyUserContext();
    setupEventListeners();

    // Segera tampilkan konten utama agar tidak blank screen
    const mainEl = document.querySelector('main');
    if (mainEl) mainEl.classList.remove('hidden');

    try {
        await Promise.all([loadRooms(), loadReports()]);
    } catch (err) {
        console.error('[SarprasAduan] Init error:', err);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPage);
} else {
    initPage();
}

function getRoleLabel(role) {
    const map = {
        super_admin: 'Super Admin',
        kepala_sekolah: 'Kepala Sekolah',
        sarpras: 'Wakasek Sarpras',
        admin_sarpras: 'Admin Sarpras',
        kurikulum: 'Kurikulum',
        guru_mapel: 'Guru Mapel',
        wali_kelas: 'Wali Kelas',
        staff: 'Staf / Tendik',
        siswa: 'Siswa / OSIS'
    };
    return map[role] || role || 'Pengguna';
}

// =========================================================================
// 2. Setup Event Listeners
// =========================================================================

function setupEventListeners() {
    // Filter Pencarian Debounced
    const filterSearch = document.getElementById('filter-search');
    if (filterSearch) {
        filterSearch.addEventListener('input', (e) => {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                currentFilter.search = e.target.value.trim();
                renderReportsTable();
            }, 300);
        });
    }

    // Filter Dropdown
    const filterStatus = document.getElementById('filter-status');
    if (filterStatus) {
        filterStatus.addEventListener('change', (e) => {
            currentFilter.status = e.target.value;
            renderReportsTable();
        });
    }

    const filterCategory = document.getElementById('filter-category');
    if (filterCategory) {
        filterCategory.addEventListener('change', (e) => {
            currentFilter.category = e.target.value;
            renderReportsTable();
        });
    }

    const filterUrgency = document.getElementById('filter-urgency');
    if (filterUrgency) {
        filterUrgency.addEventListener('change', (e) => {
            currentFilter.urgency = e.target.value;
            renderReportsTable();
        });
    }

    // Submit Form Aduan
    const formReport = document.getElementById('form-report');
    if (formReport) {
        formReport.addEventListener('submit', handleReportFormSubmit);
    }

    // Submit Form Disposisi
    const formDisposition = document.getElementById('form-disposition');
    if (formDisposition) {
        formDisposition.addEventListener('submit', handleDispositionFormSubmit);
    }

    // Checkbox 1-Klik RKAS
    const checkCreateRkas = document.getElementById('check-create-rkas');
    const rkasFormFields = document.getElementById('rkas-form-fields');
    if (checkCreateRkas && rkasFormFields) {
        checkCreateRkas.addEventListener('change', (e) => {
            if (e.target.checked) {
                rkasFormFields.classList.remove('hidden');
            } else {
                rkasFormFields.classList.add('hidden');
            }
        });
    }
}

// =========================================================================
// 3. Load Data & Render
// =========================================================================

async function loadRooms() {
    try {
        roomsList = await cfClient.getSarprasRooms();
        const selectRoom = document.getElementById('report-input-room');
        if (selectRoom) {
            selectRoom.innerHTML = '<option value="">-- Pilih Ruangan Terkait (Opsional) --</option>';
            roomsList.forEach(r => {
                const opt = document.createElement('option');
                opt.value = r.id;
                opt.textContent = `${r.kode} - ${r.nama} (${r.gedung || r.kategori_ruang})`;
                selectRoom.appendChild(opt);
            });
        }
    } catch (err) {
        console.warn('[SarprasAduan] Load rooms warning:', err);
    }
}

async function loadReports() {
    const tbody = document.getElementById('table-reports-body');
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="py-12 text-center text-slate-400">
                    <i class="fa-solid fa-spinner fa-spin text-2xl text-emerald-500 mb-2"></i>
                    <p class="text-xs">Memuat daftar aduan sarpras...</p>
                </td>
            </tr>
        `;
    }

    try {
        reportsList = await cfClient.getSarprasReports({});
        updateKpiMetrics();
        renderReportsTable();
    } catch (err) {
        console.error('[SarprasAduan] Load reports error:', err);
        showToast('Error', err.message || 'Gagal memuat daftar aduan', 'error');
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="py-8 text-center text-rose-500">
                        <i class="fa-solid fa-triangle-exclamation text-2xl mb-2"></i>
                        <p class="text-xs font-semibold">Gagal memuat data: ${escapeHtml(err.message || 'Kesalahan server')}</p>
                    </td>
                </tr>
            `;
        }
    }
}

function updateKpiMetrics() {
    const total = reportsList.length;
    const pending = reportsList.filter(r => r.status === 'submitted').length;
    const inProgress = reportsList.filter(r => r.status === 'reviewed' || r.status === 'in_progress').length;
    const resolved = reportsList.filter(r => r.status === 'resolved').length;

    const elTotal = document.getElementById('kpi-total-reports');
    const elPending = document.getElementById('kpi-pending-reports');
    const elProgress = document.getElementById('kpi-progress-reports');
    const elResolved = document.getElementById('kpi-resolved-reports');

    if (elTotal) elTotal.textContent = total;
    if (elPending) elPending.textContent = pending;
    if (elProgress) elProgress.textContent = inProgress;
    if (elResolved) elResolved.textContent = resolved;
}

function renderReportsTable() {
    const tbody = document.getElementById('table-reports-body');
    const counterText = document.getElementById('reports-counter-text');
    if (!tbody) return;

    // Filter memori
    let filtered = reportsList.filter(r => {
        if (currentFilter.status && r.status !== currentFilter.status) return false;
        if (currentFilter.category && r.category !== currentFilter.category) return false;
        if (currentFilter.urgency && r.urgency !== currentFilter.urgency) return false;
        if (currentFilter.search) {
            const s = currentFilter.search.toLowerCase();
            const matchTitle = (r.title || '').toLowerCase().includes(s);
            const matchDesc = (r.description || '').toLowerCase().includes(s);
            const matchNum = (r.report_number || '').toLowerCase().includes(s);
            const matchName = (r.reporter_name || '').toLowerCase().includes(s);
            const matchRoom = (r.room_name || '').toLowerCase().includes(s);
            if (!matchTitle && !matchDesc && !matchNum && !matchName && !matchRoom) return false;
        }
        return true;
    });

    if (counterText) {
        counterText.textContent = `Menampilkan ${filtered.length} dari ${reportsList.length} total laporan`;
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="py-12 text-center text-slate-400">
                    <div class="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 mx-auto mb-2 text-xl">
                        <i class="fa-solid fa-inbox"></i>
                    </div>
                    <p class="font-bold text-slate-600 dark:text-slate-300">Belum ada data aduan</p>
                    <p class="text-xs text-slate-400 mt-0.5">Silakan sesuaikan filter atau buat laporan aduan baru.</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filtered.map(r => {
        const isOwner = userUid && r.reporter_uid === userUid;
        const canEditOrDelete = (isOwner && r.status === 'submitted') || isManager;
        const canDispose = isManager;

        // Kategori badge
        const catBadge = getCategoryBadge(r.category);
        // Urgensi badge
        const urgencyBadge = getUrgencyBadge(r.urgency);
        // Status badge
        const statusBadge = getStatusBadge(r.status);

        // Format tanggal
        const dateStr = formatDate(r.created_at);

        return `
            <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                <!-- Tiket & Tanggal -->
                <td class="py-3 px-3 sm:px-4">
                    <span class="font-mono font-bold text-xs text-emerald-600 dark:text-emerald-400 block">${escapeHtml(r.report_number)}</span>
                    <span class="text-[11px] text-slate-400 block mt-0.5">${escapeHtml(dateStr)}</span>
                </td>

                <!-- Pelapor -->
                <td class="py-3 px-3 sm:px-4">
                    <span class="font-semibold text-slate-800 dark:text-white block truncate max-w-[140px]">${escapeHtml(r.reporter_name)}</span>
                    <span class="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">${escapeHtml(getRoleLabel(r.reporter_role))}</span>
                </td>

                <!-- Kategori & Urgensi -->
                <td class="py-3 px-3 sm:px-4">
                    <div class="flex flex-col gap-1 items-start">
                        ${catBadge}
                        ${urgencyBadge}
                    </div>
                </td>

                <!-- Lokasi / Aset -->
                <td class="py-3 px-3 sm:px-4">
                    <span class="font-semibold text-slate-800 dark:text-slate-200 block truncate max-w-[160px]">${escapeHtml(r.room_name || 'Umum / Sekolah')}</span>
                    ${r.item_name ? `<span class="text-[11px] text-slate-400 block truncate max-w-[160px]">${escapeHtml(r.item_name)}</span>` : ''}
                </td>

                <!-- Judul & Uraian -->
                <td class="py-3 px-3 sm:px-4 max-w-[220px]">
                    <span class="font-bold text-slate-800 dark:text-slate-100 block truncate" title="${escapeHtml(r.title)}">${escapeHtml(r.title)}</span>
                    <p class="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5">${escapeHtml(r.description)}</p>
                </td>

                <!-- Status & Disposisi -->
                <td class="py-3 px-3 sm:px-4">
                    <div class="flex flex-col gap-1 items-start">
                        ${statusBadge}
                        ${r.disposition_to ? getDispositionBadge(r.disposition_to) : ''}
                    </div>
                </td>

                <!-- Aksi -->
                <td class="py-3 px-3 sm:px-4 text-center">
                    <div class="flex items-center justify-center gap-1.5 flex-nowrap">
                        <button type="button" onclick="window.viewReportDetail('${r.id}')" class="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center text-xs transition-all" title="Lihat Detail">
                            <i class="fa-solid fa-eye"></i>
                        </button>
                        ${canDispose ? `
                            <button type="button" onclick="window.openDispositionModal('${r.id}')" class="w-7 h-7 rounded-lg bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/60 dark:hover:bg-amber-900/60 text-amber-600 dark:text-amber-400 flex items-center justify-center text-xs transition-all" title="Disposisi Tindak Lanjut">
                                <i class="fa-solid fa-stamp"></i>
                            </button>
                        ` : ''}
                        ${canDispose && !['scheduled', 'in_progress'].includes(r.maintenance_status) && !['resolved', 'rejected'].includes(r.status) ? `
                            <button type="button" onclick="window.createReportMaintenance('${r.id}', this)" class="w-7 h-7 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xs transition-all" title="Buat Tiket Pemeliharaan">
                                <i class="fa-solid fa-screwdriver-wrench"></i>
                            </button>
                        ` : ''}
                        ${canEditOrDelete ? `
                            <button type="button" onclick="window.openEditReportModal('${r.id}')" class="w-7 h-7 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/60 dark:hover:bg-blue-900/60 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xs transition-all" title="Edit Laporan">
                                <i class="fa-solid fa-pen"></i>
                            </button>
                            <button type="button" onclick="window.deleteReport('${r.id}')" class="w-7 h-7 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 flex items-center justify-center text-xs transition-all" title="Batalkan / Hapus">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function getCategoryBadge(cat) {
    if (cat === 'kerusakan_sarana') {
        return '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60">Kerusakan Sarana</span>';
    }
    if (cat === 'kerusakan_gedung') {
        return '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">Kerusakan Gedung</span>';
    }
    return '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/60">Usulan Pengadaan</span>';
}

function getUrgencyBadge(urgency) {
    if (urgency === 'Mendesak') {
        return '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60 flex items-center gap-1"><i class="fa-solid fa-circle text-[6px]"></i> Mendesak</span>';
    }
    if (urgency === 'Sedang') {
        return '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">Sedang</span>';
    }
    return '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">Rendah</span>';
}

function getStatusBadge(status) {
    switch (status) {
        case 'submitted':
            return '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">Menunggu Respon</span>';
        case 'reviewed':
            return '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60">Ditelaah</span>';
        case 'in_progress':
            return '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60">Dikerjakan</span>';
        case 'resolved':
            return '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">Telah Selesai</span>';
        case 'rejected':
            return '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60">Ditolak</span>';
        default:
            return `<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-600">${status}</span>`;
    }
}

function getDispositionBadge(to) {
    if (to === 'rkas') {
        return '<span class="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1"><i class="fa-solid fa-arrow-right text-[8px]"></i> Masuk RKAS</span>';
    }
    if (to === 'pemeliharaan') {
        return '<span class="text-[10px] font-bold text-cyan-600 dark:text-cyan-400 flex items-center gap-1"><i class="fa-solid fa-wrench text-[8px]"></i> Tiket Servis</span>';
    }
    return '';
}

function formatDate(isoStr) {
    if (!isoStr) return '-';
    try {
        const d = new Date(isoStr);
        return d.toLocaleDateString('id-ID', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        return isoStr;
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// =========================================================================
// 4. Modal Handlers: Buat & Edit Aduan
// =========================================================================

window.refreshReports = function () {
    loadReports();
    showToast('Info', 'Memperbarui data aduan...', 'info');
};

window.openCreateReportModal = function () {
    const modal = document.getElementById('modal-report-form');
    const form = document.getElementById('form-report');
    const title = document.getElementById('modal-report-form-title');
    const inputId = document.getElementById('report-form-id');
    const btnSubmit = document.getElementById('btn-save-report');

    if (!modal || !form) return;

    form.reset();
    if (inputId) inputId.value = '';
    if (title) title.textContent = 'Buat Laporan / Usulan Sarpras Baru';
    if (btnSubmit) {
        btnSubmit.innerHTML = '<i class="fa-solid fa-paper-plane text-xs"></i><span>Kirim Laporan</span>';
    }

    modal.classList.remove('hidden');
};

window.openEditReportModal = function (id) {
    const report = reportsList.find(r => r.id === id);
    if (!report) return;

    const modal = document.getElementById('modal-report-form');
    const title = document.getElementById('modal-report-form-title');
    const inputId = document.getElementById('report-form-id');
    const btnSubmit = document.getElementById('btn-save-report');

    if (!modal) return;

    if (inputId) inputId.value = report.id;
    if (title) title.textContent = `Edit Laporan (${report.report_number})`;
    if (btnSubmit) {
        btnSubmit.innerHTML = '<i class="fa-solid fa-check text-xs"></i><span>Simpan Perubahan</span>';
    }

    document.getElementById('report-input-category').value = report.category || 'kerusakan_sarana';
    document.getElementById('report-input-urgency').value = report.urgency || 'Sedang';
    document.getElementById('report-input-room').value = report.room_id || '';
    document.getElementById('report-input-item-name').value = report.item_name || '';
    document.getElementById('report-input-title').value = report.title || '';
    document.getElementById('report-input-description').value = report.description || '';

    modal.classList.remove('hidden');
};

window.closeReportFormModal = function () {
    const modal = document.getElementById('modal-report-form');
    if (modal) modal.classList.add('hidden');
};

async function handleReportFormSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-save-report');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-xs"></i><span>Menyimpan...</span>';
    }

    try {
        const id = document.getElementById('report-form-id').value.trim();
        const category = document.getElementById('report-input-category').value;
        const urgency = document.getElementById('report-input-urgency').value;
        const roomId = document.getElementById('report-input-room').value;
        const itemName = document.getElementById('report-input-item-name').value.trim();
        const title = document.getElementById('report-input-title').value.trim();
        const description = document.getElementById('report-input-description').value.trim();

        // Cari nama ruangan
        const selectedRoom = roomsList.find(r => r.id === roomId);
        const roomName = selectedRoom ? `${selectedRoom.kode} - ${selectedRoom.nama}` : '';

        const payload = {
            category,
            urgency,
            room_id: roomId,
            room_name: roomName,
            item_name: itemName,
            title,
            description
        };

        const isEdit = Boolean(id);
        const res = await cfClient.saveSarprasReport(payload, isEdit, id);

        if (res.success) {
            showToast('Sukses', res.message || 'Laporan berhasil disimpan', 'success');
            window.closeReportFormModal();
            await loadReports();
        } else {
            throw new Error(res.error || 'Gagal menyimpan laporan');
        }
    } catch (err) {
        console.error('[SarprasAduan] Save error:', err);
        showToast('Error', err.message || 'Gagal menyimpan laporan aduan', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}

// =========================================================================
// 5. Modal Handlers: Detail Laporan
// =========================================================================

window.viewReportDetail = function (id) {
    const report = reportsList.find(r => r.id === id);
    if (!report) return;

    const modal = document.getElementById('modal-report-detail');
    if (!modal) return;

    document.getElementById('detail-report-number').textContent = report.report_number;
    document.getElementById('detail-reporter-name').textContent = report.reporter_name;
    document.getElementById('detail-reporter-role').textContent = `${getRoleLabel(report.reporter_role)} ${report.reporter_identity ? '· ' + report.reporter_identity : ''}`;
    document.getElementById('detail-created-at').textContent = formatDate(report.created_at);
    document.getElementById('detail-room-name').textContent = report.room_name || 'Fasilitas Umum / Luar Ruangan';
    document.getElementById('detail-item-name').textContent = report.item_name || 'Tidak ada spesifikasi barang tertentu';
    document.getElementById('detail-title').textContent = report.title;
    document.getElementById('detail-description').textContent = report.description;

    const progress = document.getElementById('detail-maintenance-progress');
    if (progress) {
        const labels = { scheduled: 'Dijadwalkan', in_progress: 'Sedang dikerjakan', completed: 'Selesai', cancelled: 'Dibatalkan' };
        progress.textContent = report.maintenance_ticket
            ? `Tiket ${report.maintenance_ticket}: ${labels[report.maintenance_status] || report.maintenance_status}${report.maintenance_notes ? ' · ' + report.maintenance_notes : ''}`
            : 'Belum ada tiket pemeliharaan terkait.';
    }

    const historyList = document.getElementById('detail-report-history');
    if (historyList) {
        historyList.replaceChildren();
        let history = [];
        try { history = JSON.parse(report.history_json || '[]'); } catch (_) { /* data lama */ }
        if (!Array.isArray(history)) history = [];
        const hasRecordedSubmission = history.some(event => event.status === 'submitted');
        if (!hasRecordedSubmission) {
            history.unshift({ status: 'submitted', changed_at: report.created_at, notes: 'Aduan dibuat' });
        }
        const labels = { submitted: 'Dilaporkan', reviewed: 'Diperiksa', in_progress: 'Dalam penanganan', resolved: 'Selesai', rejected: 'Ditolak' };
        for (const event of history) {
            const item = document.createElement('li');
            item.className = 'text-xs text-slate-600 dark:text-slate-300 py-1 border-b border-slate-100 dark:border-slate-800 last:border-0 flex items-center justify-between gap-2';
            const left = document.createElement('span');
            left.textContent = [labels[event.status] || event.status, event.notes || ''].filter(Boolean).join(': ');
            const right = document.createElement('span');
            right.className = 'text-[10px] text-slate-400 shrink-0 font-medium';
            right.textContent = [formatDate(event.changed_at), event.handler ? `(${event.handler})` : ''].filter(Boolean).join(' ');
            item.appendChild(left);
            item.appendChild(right);
            historyList.appendChild(item);
        }
    }

    // Badges
    const badgeContainer = document.getElementById('detail-badges-container');
    if (badgeContainer) {
        badgeContainer.innerHTML = `
            ${getStatusBadge(report.status)}
            ${getCategoryBadge(report.category)}
            ${getUrgencyBadge(report.urgency)}
        `;
    }

    // Card Disposisi
    const dispCard = document.getElementById('detail-disposition-card');
    if (dispCard) {
        if (report.disposition_notes || report.disposition_to) {
            dispCard.classList.remove('hidden');
            document.getElementById('detail-handled-by').textContent = `Oleh: ${report.handled_by_name || 'Pengelola Sarpras'}`;
            document.getElementById('detail-disposition-notes').textContent = report.disposition_notes || 'Telah diverifikasi tanpa catatan khusus.';
            const dispBadge = document.getElementById('detail-disposition-to-badge');
            if (dispBadge) {
                dispBadge.innerHTML = report.disposition_to ? getDispositionBadge(report.disposition_to) : '';
            }
        } else {
            dispCard.classList.add('hidden');
        }
    }

    modal.classList.remove('hidden');
};

window.closeReportDetailModal = function () {
    const modal = document.getElementById('modal-report-detail');
    if (modal) modal.classList.add('hidden');
};

// =========================================================================
// 6. Modal Handlers: Disposisi Tindak Lanjut (Waka / Admin Sarpras)
// =========================================================================

window.openDispositionModal = function (id) {
    const report = reportsList.find(r => r.id === id);
    if (!report) return;

    const modal = document.getElementById('modal-report-disposition');
    const form = document.getElementById('form-disposition');
    if (!modal || !form) return;

    form.reset();
    document.getElementById('disposition-report-id').value = report.id;
    document.getElementById('disposition-report-number').textContent = report.report_number;
    document.getElementById('disposition-report-title').textContent = report.title;
    document.getElementById('disposition-report-desc').textContent = report.description;

    document.getElementById('disposition-status').value = report.status === 'submitted' ? 'reviewed' : report.status;
    document.getElementById('disposition-to').value = report.disposition_to || '';
    document.getElementById('disposition-notes').value = report.disposition_notes || '';

    // Auto-fill draft RKAS jika ada
    document.getElementById('rkas-draft-year').value = new Date().getFullYear();
    document.getElementById('rkas-draft-price').value = '';

    window.handleDispositionToChange(report.disposition_to || '');

    modal.classList.remove('hidden');
};

window.closeReportDispositionModal = function () {
    const modal = document.getElementById('modal-report-disposition');
    if (modal) modal.classList.add('hidden');
};

window.handleDispositionToChange = function (value) {
    const panel = document.getElementById('panel-rkas-auto-create');
    const check = document.getElementById('check-create-rkas');
    const fields = document.getElementById('rkas-form-fields');

    if (panel) {
        if (value === 'rkas') {
            panel.classList.remove('hidden');
        } else {
            panel.classList.add('hidden');
            if (check) check.checked = false;
            if (fields) fields.classList.add('hidden');
        }
    }
};

async function handleDispositionFormSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-save-disposition');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-xs"></i><span>Memproses...</span>';
    }

    try {
        const id = document.getElementById('disposition-report-id').value.trim();
        const status = document.getElementById('disposition-status').value;
        const dispositionTo = document.getElementById('disposition-to').value;
        const dispositionNotes = document.getElementById('disposition-notes').value.trim();
        const createRkasItem = document.getElementById('check-create-rkas')?.checked || false;

        let rkasData = null;
        if (dispositionTo === 'rkas' && createRkasItem) {
            rkasData = {
                fiscal_year: parseInt(document.getElementById('rkas-draft-year').value, 10) || new Date().getFullYear(),
                funding_source: document.getElementById('rkas-draft-funding').value,
                quantity: parseInt(document.getElementById('rkas-draft-qty').value, 10) || 1,
                unit: document.getElementById('rkas-draft-unit').value || 'Unit',
                priority_scale: parseInt(document.getElementById('rkas-draft-priority').value, 10) || 2,
                estimated_price: parseFloat(document.getElementById('rkas-draft-price').value) || 0
            };
        }

        const payload = {
            status,
            disposition_to: dispositionTo,
            disposition_notes: dispositionNotes,
            create_rkas_item: createRkasItem,
            rkas_data: rkasData
        };

        const res = await cfClient.dispositionSarprasReport(id, payload);
        if (res.success) {
            showToast('Sukses', res.message || 'Disposisi aduan berhasil disimpan', 'success');
            window.closeReportDispositionModal();
            await loadReports();
        } else {
            throw new Error(res.error || 'Gagal menyimpan disposisi');
        }
    } catch (err) {
        console.error('[SarprasAduan] Disposition error:', err);
        showToast('Error', err.message || 'Gagal memproses disposisi', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}

// =========================================================================
// 7. Batal / Hapus Laporan
// =========================================================================

window.deleteReport = async function (id) {
    const report = reportsList.find(r => r.id === id);
    if (!report) return;

    const confirmMsg = `Apakah Anda yakin ingin membatalkan/menghapus laporan tiket "${report.report_number}" (${report.title})?`;
    if (!confirm(confirmMsg)) return;

    try {
        const res = await cfClient.deleteSarprasReport(id);
        if (res.success) {
            showToast('Sukses', 'Laporan aduan berhasil dibatalkan', 'success');
            await loadReports();
        } else {
            throw new Error(res.error || 'Gagal menghapus laporan');
        }
    } catch (err) {
        console.error('[SarprasAduan] Delete error:', err);
        showToast('Error', err.message || 'Gagal menghapus laporan', 'error');
    }
};

window.createReportMaintenance = async function (id, button) {
    const report = reportsList.find(r => r.id === id);
    if (!report || !isManager) return;
    if (button) button.disabled = true;
    try {
        const result = await cfClient.saveSarprasMaintenanceLog({
            source_report_id: report.id,
            title: report.title,
            description: report.description,
            facility_type: report.item_id ? 'item' : 'room',
            room_id: report.room_id || '',
            item_id: report.item_id || '',
            priority: 'sedang'
        });
        if (!result.success) throw new Error(result.error || 'Gagal membuat tiket pemeliharaan');
        showToast('Sukses', result.message || 'Tiket pemeliharaan berhasil dibuat', 'success');
        await loadReports();
    } catch (e) {
        showToast('Gagal', e.message, 'error');
    } finally {
        if (button) button.disabled = false;
    }
};

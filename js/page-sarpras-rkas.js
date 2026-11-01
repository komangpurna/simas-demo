/**
 * page-sarpras-rkas.js - Controller Halaman Perencanaan Anggaran RKAS Sarpras
 * Single Source of Truth (SSOT): Cloudflare D1 via cfClient (/api/sarpras/rkas)
 * Standar: OWASP Top 10, ASVS Level 1 & 2, Action & Security Parity
 */

import cfClient from './cloudflare-client.js';
import { SCHOOL_CONFIG } from './school-config.js';

// State Module
let userUid = '';
let userRole = 'guru_mapel';
let userName = "Civitas SMANTARA";
let isManager = false;
let isWaka = false;
let isKepsek = false;
let isSuperAdmin = false;
let roomsList = [];
let rkasList = [];
let currentFiscalYear = new Date().getFullYear();
let currentFilter = {
    search: '',
    status: '',
    priority_scale: '',
    funding_source: ''
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

    isSuperAdmin = userRole === 'super_admin';
    isWaka = userRole === 'sarpras' || isSuperAdmin;
    isKepsek = userRole === 'kepala_sekolah' || isSuperAdmin;
    isManager = isSarprasManager();

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

    // Sync Dropdown Tahun Anggaran Header & Badge
    const selectFy = document.getElementById('header-select-fiscal-year');
    if (selectFy) {
        selectFy.value = String(currentFiscalYear);
    }
    const badgeFy = document.getElementById('header-fiscal-year-badge');
    if (badgeFy) {
        badgeFy.textContent = String(currentFiscalYear);
    }
}

async function initPage() {
    applyUserContext();
    setupEventListeners();

    // Segera tampilkan konten utama agar tidak blank screen
    const mainEl = document.querySelector('main');
    if (mainEl) mainEl.classList.remove('hidden');

    try {
        await Promise.all([loadRooms(), loadRkasData()]);
    } catch (err) {
        console.error('[SarprasRkas] Init error:', err);
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
        staff: 'Staf / Tendik'
    };
    return map[role] || role || 'Pengguna';
}

function formatRupiah(number) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0
    }).format(number || 0);
}

// =========================================================================
// 2. Setup Event Listeners
// =========================================================================

function setupEventListeners() {
    // Filter Search Debounced
    const filterSearch = document.getElementById('filter-search');
    if (filterSearch) {
        filterSearch.addEventListener('input', (e) => {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                currentFilter.search = e.target.value.trim();
                renderRkasTable();
            }, 300);
        });
    }

    // Filter Dropdown
    const filterPriority = document.getElementById('filter-priority');
    if (filterPriority) {
        filterPriority.addEventListener('change', (e) => {
            currentFilter.priority_scale = e.target.value;
            renderRkasTable();
        });
    }

    const filterFunding = document.getElementById('filter-funding');
    if (filterFunding) {
        filterFunding.addEventListener('change', (e) => {
            currentFilter.funding_source = e.target.value;
            renderRkasTable();
        });
    }

    const filterStatus = document.getElementById('filter-status');
    if (filterStatus) {
        filterStatus.addEventListener('change', (e) => {
            currentFilter.status = e.target.value;
            renderRkasTable();
        });
    }

    // Form RKAS Submit
    const formRkas = document.getElementById('form-rkas');
    if (formRkas) {
        formRkas.addEventListener('submit', handleRkasFormSubmit);
    }

    // Form Approval Submit
    const formApproval = document.getElementById('form-rkas-approval');
    if (formApproval) {
        formApproval.addEventListener('submit', handleApprovalFormSubmit);
    }
}

// =========================================================================
// 3. Load Data & Render
// =========================================================================

async function loadRooms() {
    try {
        roomsList = await cfClient.getSarprasRooms();
        const selectRoom = document.getElementById('rkas-input-room');
        if (selectRoom) {
            selectRoom.innerHTML = '<option value="">-- Seluruh Sekolah / Fasilitas Umum --</option>';
            roomsList.forEach(r => {
                const opt = document.createElement('option');
                opt.value = r.id;
                opt.textContent = `${r.kode} - ${r.nama} (${r.gedung || r.kategori_ruang})`;
                selectRoom.appendChild(opt);
            });
        }
    } catch (err) {
        console.warn('[SarprasRkas] Load rooms warning:', err);
    }
}

async function loadRkasData() {
    const tbody = document.getElementById('table-rkas-body');
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="py-12 text-center text-slate-400">
                    <i class="fa-solid fa-spinner fa-spin text-2xl text-emerald-500 mb-2"></i>
                    <p class="text-xs">Memuat data perencanaan RKAS TA ${currentFiscalYear}...</p>
                </td>
            </tr>
        `;
    }

    try {
        // Ambil data items & summary sekaligus
        const [items, summary] = await Promise.all([
            cfClient.getSarprasRkas({ fiscal_year: currentFiscalYear }),
            cfClient.getSarprasRkasSummary(currentFiscalYear)
        ]);

        rkasList = items || [];
        updateKpiMetrics(summary);
        renderRkasTable();
    } catch (err) {
        console.error('[SarprasRkas] Load error:', err);
        showToast('Error', err.message || 'Gagal memuat data RKAS', 'error');
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" class="py-8 text-center text-rose-500">
                        <i class="fa-solid fa-triangle-exclamation text-2xl mb-2"></i>
                        <p class="text-xs font-semibold">Gagal memuat data: ${escapeHtml(err.message || 'Kesalahan server')}</p>
                    </td>
                </tr>
            `;
        }
    }
}

function updateKpiMetrics(summary) {
    const elTotal = document.getElementById('kpi-total-budget');
    const elTotalDesc = document.getElementById('kpi-total-items-desc');
    const elBos = document.getElementById('kpi-bos-budget');
    const elBosDesc = document.getElementById('kpi-bos-items-desc');
    const elKomite = document.getElementById('kpi-komite-budget');
    const elKomiteDesc = document.getElementById('kpi-komite-items-desc');
    const elRate = document.getElementById('kpi-approval-rate');
    const elRateDesc = document.getElementById('kpi-approval-items-desc');
    const elBar = document.getElementById('kpi-approval-bar');

    const totalBudget = summary?.total_budget || 0;
    const totalItems = summary?.total_items || 0;
    const bosBudget = (summary?.total_bos_reguler || 0) + (summary?.total_bos_kinerja || 0);
    const komiteBudget = (summary?.total_komite || 0) + (summary?.total_dak || 0);
    const approvedItems = (summary?.total_approved || 0);
    const approvalRate = totalItems > 0 ? Math.round((approvedItems / totalItems) * 100) : 0;

    if (elTotal) elTotal.textContent = formatRupiah(totalBudget);
    if (elTotalDesc) elTotalDesc.textContent = `${totalItems} item rencana belanja`;
    if (elBos) elBos.textContent = formatRupiah(bosBudget);
    if (elBosDesc) elBosDesc.textContent = `Reguler: ${formatRupiah(summary?.total_bos_reguler || 0)}`;
    if (elKomite) elKomite.textContent = formatRupiah(komiteBudget);
    if (elKomiteDesc) elKomiteDesc.textContent = `Komite: ${formatRupiah(summary?.total_komite || 0)}`;
    if (elRate) elRate.textContent = `${approvalRate}%`;
    if (elRateDesc) elRateDesc.textContent = `${approvedItems} dari ${totalItems} item disetujui Kepsek`;
    if (elBar) elBar.style.width = `${approvalRate}%`;
}

// Quick Filter Chips Handler
window.applyQuickFilter = function (type) {
    document.querySelectorAll('.chip-filter').forEach(chip => {
        if (chip.dataset.chip === type) {
            chip.className = 'chip-filter active px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800/80 whitespace-nowrap transition';
        } else {
            chip.className = 'chip-filter px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 whitespace-nowrap hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition';
        }
    });

    const selectPriority = document.getElementById('filter-priority');
    const selectFunding = document.getElementById('filter-funding');
    const selectStatus = document.getElementById('filter-status');

    if (type === 'all') {
        currentFilter.priority_scale = '';
        currentFilter.funding_source = '';
        currentFilter.status = '';
        if (selectPriority) selectPriority.value = '';
        if (selectFunding) selectFunding.value = '';
        if (selectStatus) selectStatus.value = '';
    } else if (type === 'p1') {
        currentFilter.priority_scale = '1';
        if (selectPriority) selectPriority.value = '1';
    } else if (type === 'bos_reguler') {
        currentFilter.funding_source = 'BOS Reguler';
        if (selectFunding) selectFunding.value = 'BOS Reguler';
    } else if (type === 'bos_kinerja') {
        currentFilter.funding_source = 'BOS Kinerja';
        if (selectFunding) selectFunding.value = 'BOS Kinerja';
    } else if (type === 'komite') {
        currentFilter.funding_source = 'Komite';
        if (selectFunding) selectFunding.value = 'Komite';
    } else if (type === 'approved_kepsek') {
        currentFilter.status = 'approved_kepsek';
        if (selectStatus) selectStatus.value = 'approved_kepsek';
    } else if (type === 'proposed') {
        currentFilter.status = 'proposed';
        if (selectStatus) selectStatus.value = 'proposed';
    }

    renderRkasTable();
};

window.resetRkasFilters = function () {
    currentFilter = {
        search: '',
        status: '',
        priority_scale: '',
        funding_source: ''
    };
    const sInput = document.getElementById('filter-search');
    const pSelect = document.getElementById('filter-priority');
    const fSelect = document.getElementById('filter-funding');
    const stSelect = document.getElementById('filter-status');
    if (sInput) sInput.value = '';
    if (pSelect) pSelect.value = '';
    if (fSelect) fSelect.value = '';
    if (stSelect) stSelect.value = '';
    window.applyQuickFilter('all');
};

window.handleFiscalYearChange = async function (year) {
    currentFiscalYear = parseInt(year, 10) || new Date().getFullYear();
    const badgeFy = document.getElementById('header-fiscal-year-badge');
    if (badgeFy) badgeFy.textContent = String(currentFiscalYear);
    await loadRkasData();
};

function renderRkasTable() {
    const tbody = document.getElementById('table-rkas-body');
    const counterText = document.getElementById('rkas-counter-text');
    const filteredTotalText = document.getElementById('rkas-filtered-total');
    if (!tbody) return;

    let filtered = rkasList.filter(item => {
        if (currentFilter.status && item.status !== currentFilter.status) return false;
        if (currentFilter.priority_scale && String(item.priority_scale) !== String(currentFilter.priority_scale)) return false;
        if (currentFilter.funding_source && item.funding_source !== currentFilter.funding_source) return false;
        if (currentFilter.search) {
            const s = currentFilter.search.toLowerCase();
            const matchName = (item.item_name || '').toLowerCase().includes(s);
            const matchSpec = (item.specification || '').toLowerCase().includes(s);
            const matchRoom = (item.room_target_name || '').toLowerCase().includes(s);
            const matchProposer = (item.proposed_by_name || '').toLowerCase().includes(s);
            if (!matchName && !matchSpec && !matchRoom && !matchProposer) return false;
        }
        return true;
    });

    const subtotal = filtered.reduce((acc, curr) => acc + (Number(curr.total_budget) || 0), 0);

    if (counterText) {
        counterText.textContent = `Menampilkan ${filtered.length} dari ${rkasList.length} rencana belanja`;
    }
    if (filteredTotalText) {
        filteredTotalText.textContent = formatRupiah(subtotal);
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="py-16 px-4 text-center">
                    <div class="w-16 h-16 rounded-3xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-500 dark:text-emerald-400 flex items-center justify-center text-2xl mx-auto mb-3 shadow-inner border border-emerald-100 dark:border-emerald-800/60">
                        <i class="fa-solid fa-file-invoice-dollar"></i>
                    </div>
                    <h4 class="font-bold text-slate-800 dark:text-white text-base">Belum Ada Rencana Belanja untuk TA ${currentFiscalYear}</h4>
                    <p class="text-xs text-slate-400 max-w-md mx-auto mt-1 mb-4 leading-relaxed">
                        Mulai susun usulan kebutuhan pengadaan atau pemeliharaan sarana & prasarana sekolah agar terakomodasi dalam RKAS.
                    </p>
                    <button type="button" onclick="window.openCreateRkasModal?.()" class="inline-flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl text-xs sm:text-sm shadow-md shadow-emerald-500/20 transition-all hover:scale-102 active:scale-95">
                        <i class="fa-solid fa-plus text-xs"></i>
                        <span>Tambah Rencana Belanja Baru</span>
                    </button>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filtered.map(item => {
        const isOwner = userUid && (item.created_by === userUid || item.proposed_by_uid === userUid);
        const canEditOrDelete = (isOwner && item.status === 'proposed') || isManager;
        const canApprove = isWaka || isKepsek;

        const priorityBadge = getPriorityBadge(item.priority_scale);
        const statusBadge = getRkasStatusBadge(item.status);
        const fundingBadge = getFundingBadge(item.funding_source);

        return `
            <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors border-b border-slate-100 dark:border-slate-800/60">
                <!-- Skala Prioritas -->
                <td class="py-3.5 px-3 sm:px-4 text-center">
                    ${priorityBadge}
                </td>

                <!-- Barang & Spesifikasi -->
                <td class="py-3.5 px-3 sm:px-4 min-w-[200px] max-w-[260px]">
                    <span class="font-bold text-slate-800 dark:text-white block leading-snug" title="${escapeHtml(item.item_name)}">${escapeHtml(item.item_name)}</span>
                    ${item.specification ? `<p class="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5" title="${escapeHtml(item.specification)}">${escapeHtml(item.specification)}</p>` : ''}
                    <div class="mt-1 flex items-center gap-1.5 text-[10px] text-slate-400">
                        <i class="fa-solid fa-user-pen text-[9px] text-emerald-500"></i>
                        <span class="truncate">${escapeHtml(item.proposed_by_name || 'Pengusul')}</span>
                    </div>
                </td>

                <!-- Sasaran Ruang -->
                <td class="py-3.5 px-3 sm:px-4 whitespace-nowrap">
                    <span class="font-semibold text-slate-700 dark:text-slate-200 block truncate max-w-[150px] flex items-center gap-1">
                        <i class="fa-solid fa-door-open text-blue-500 text-xs"></i>
                        <span>${escapeHtml(item.room_target_name || 'Seluruh Sekolah')}</span>
                    </span>
                    <span class="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] text-slate-500 dark:text-slate-400 font-medium">Sem. ${item.semester || 1}</span>
                </td>

                <!-- Volume -->
                <td class="py-3.5 px-3 sm:px-4 text-center font-bold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                    ${item.quantity} <span class="font-normal text-xs text-slate-400">${escapeHtml(item.unit || 'Unit')}</span>
                </td>

                <!-- Harga Satuan -->
                <td class="py-3.5 px-3 sm:px-4 text-right font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap tabular-nums">
                    ${formatRupiah(item.estimated_price)}
                </td>

                <!-- Total Pagu -->
                <td class="py-3.5 px-3 sm:px-4 text-right font-black text-emerald-600 dark:text-emerald-400 whitespace-nowrap tabular-nums text-sm">
                    ${formatRupiah(item.total_budget)}
                </td>

                <!-- Sumber Dana & Standar -->
                <td class="py-3.5 px-3 sm:px-4 whitespace-nowrap">
                    <div class="flex flex-col gap-1 items-start">
                        ${fundingBadge}
                        <span class="text-[10px] text-slate-400 truncate max-w-[130px]" title="${escapeHtml(item.snp_standard)}">${escapeHtml(item.snp_standard || 'Standar Sarpras')}</span>
                    </div>
                </td>

                <!-- Status Alur -->
                <td class="py-3.5 px-3 sm:px-4 whitespace-nowrap">
                    <div class="flex flex-col gap-1 items-start">
                        ${statusBadge}
                        ${item.waka_notes ? `<span class="text-[10px] text-blue-500 truncate max-w-[130px]" title="Waka: ${escapeHtml(item.waka_notes)}"><i class="fa-solid fa-comment-dots"></i> ${escapeHtml(item.waka_notes)}</span>` : ''}
                        ${item.kepsek_notes ? `<span class="text-[10px] text-emerald-500 truncate max-w-[130px]" title="Kepsek: ${escapeHtml(item.kepsek_notes)}"><i class="fa-solid fa-comment-dots"></i> ${escapeHtml(item.kepsek_notes)}</span>` : ''}
                    </div>
                </td>

                <!-- Aksi -->
                <td class="py-3.5 px-3 sm:px-4 text-center whitespace-nowrap">
                    <div class="flex items-center justify-center gap-1.5 flex-nowrap">
                        ${canApprove ? `
                            <button type="button" onclick="window.openApprovalModal('${item.id}')" class="w-8 h-8 rounded-xl bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xs transition-all shadow-2xs" title="Verifikasi / Persetujuan">
                                <i class="fa-solid fa-stamp"></i>
                            </button>
                        ` : ''}
                        ${canEditOrDelete ? `
                            <button type="button" onclick="window.openEditRkasModal('${item.id}')" class="w-8 h-8 rounded-xl bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/60 dark:hover:bg-blue-900/60 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xs transition-all shadow-2xs" title="Edit Rencana">
                                <i class="fa-solid fa-pen"></i>
                            </button>
                            <button type="button" onclick="window.deleteRkasItem('${item.id}')" class="w-8 h-8 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 flex items-center justify-center text-xs transition-all shadow-2xs" title="Hapus Rencana">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function getPriorityBadge(prio) {
    const p = parseInt(prio, 10);
    if (p === 1) {
        return '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border border-rose-300 dark:border-rose-800 shadow-2xs" title="Prioritas 1 (Mendesak)"><span class="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>P1 Mendesak</span>';
    }
    if (p === 2) {
        return '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-800" title="Prioritas 2 (Penting)">P2 Penting</span>';
    }
    return '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700" title="Prioritas 3 (Tambahan)">P3 Tambahan</span>';
}

function getRkasStatusBadge(status) {
    switch (status) {
        case 'proposed':
            return '<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200/70 dark:border-amber-800/50"><i class="fa-solid fa-clock text-[10px]"></i> Draft Usulan</span>';
        case 'verified_waka':
            return '<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200/70 dark:border-blue-800/50"><i class="fa-solid fa-signature text-[10px]"></i> Terverifikasi Waka</span>';
        case 'approved_kepsek':
            return '<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-800/50"><i class="fa-solid fa-circle-check text-[10px]"></i> Disetujui Kepsek</span>';
        case 'realized':
            return '<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200/70 dark:border-purple-800/50"><i class="fa-solid fa-bag-shopping text-[10px]"></i> Terealisasi</span>';
        case 'cancelled':
            return '<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200/70 dark:border-rose-800/50"><i class="fa-solid fa-circle-xmark text-[10px]"></i> Dibatalkan</span>';
        default:
            return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">${escapeHtml(status)}</span>`;
    }
}

function getFundingBadge(funding) {
    if (funding === 'BOS Reguler') {
        return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60"><i class="fa-solid fa-school text-[9px]"></i> BOS Reguler</span>';
    }
    if (funding === 'BOS Kinerja') {
        return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60"><i class="fa-solid fa-star text-[9px]"></i> BOS Kinerja</span>';
    }
    if (funding === 'Komite') {
        return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/60"><i class="fa-solid fa-hand-holding-dollar text-[9px]"></i> Komite</span>';
    }
    if (funding === 'DAK') {
        return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60"><i class="fa-solid fa-building text-[9px]"></i> DAK Fisik</span>';
    }
    return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-600">${escapeHtml(funding || 'Lainnya')}</span>`;
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
// 4. Modal Handlers: Tambah & Edit Item RKAS
// =========================================================================

window.calcRkasTotal = function () {
    const qty = parseInt(document.getElementById('rkas-input-qty')?.value, 10) || 0;
    const unit = document.getElementById('rkas-input-unit')?.value?.trim() || 'Unit';
    const price = parseFloat(document.getElementById('rkas-input-price')?.value) || 0;
    const total = qty * price;
    const display = document.getElementById('rkas-calc-total-display');
    const formulaDisplay = document.getElementById('rkas-calc-formula-display');
    if (display) display.textContent = formatRupiah(total);
    if (formulaDisplay) formulaDisplay.textContent = `${qty} ${unit} × ${formatRupiah(price)}`;
};

window.openCreateRkasModal = function () {
    const modal = document.getElementById('modal-rkas-form');
    const form = document.getElementById('form-rkas');
    const title = document.getElementById('modal-rkas-form-title');
    const inputId = document.getElementById('rkas-form-id');
    const btnSubmit = document.getElementById('btn-save-rkas');

    if (!modal || !form) return;

    form.reset();
    if (inputId) inputId.value = '';
    if (title) title.textContent = 'Tambah Rencana Belanja RKAS Baru';
    if (btnSubmit) {
        btnSubmit.innerHTML = '<i class="fa-solid fa-check text-xs"></i><span>Simpan Usulan RKAS</span>';
    }

    document.getElementById('rkas-input-year').value = currentFiscalYear;
    document.getElementById('rkas-input-qty').value = '1';
    document.getElementById('rkas-input-unit').value = 'Unit';
    document.getElementById('rkas-input-price').value = '';
    document.getElementById('rkas-input-priority').value = '2';
    window.calcRkasTotal();

    modal.classList.remove('hidden');
};

window.openEditRkasModal = function (id) {
    const item = rkasList.find(r => r.id === id);
    if (!item) return;

    const modal = document.getElementById('modal-rkas-form');
    const title = document.getElementById('modal-rkas-form-title');
    const inputId = document.getElementById('rkas-form-id');
    const btnSubmit = document.getElementById('btn-save-rkas');

    if (!modal) return;

    if (inputId) inputId.value = item.id;
    if (title) title.textContent = 'Edit Rencana Belanja RKAS';
    if (btnSubmit) {
        btnSubmit.innerHTML = '<i class="fa-solid fa-check text-xs"></i><span>Simpan Perubahan</span>';
    }

    document.getElementById('rkas-input-year').value = item.fiscal_year || currentFiscalYear;
    document.getElementById('rkas-input-semester').value = item.semester || 1;
    document.getElementById('rkas-input-name').value = item.item_name || '';
    document.getElementById('rkas-input-spec').value = item.specification || '';
    document.getElementById('rkas-input-room').value = item.room_target_id || '';
    document.getElementById('rkas-input-qty').value = item.quantity || 1;
    document.getElementById('rkas-input-unit').value = item.unit || 'Unit';
    document.getElementById('rkas-input-price').value = item.estimated_price || 0;
    document.getElementById('rkas-input-priority').value = item.priority_scale || 2;
    document.getElementById('rkas-input-funding').value = item.funding_source || 'BOS Reguler';
    document.getElementById('rkas-input-snp').value = item.snp_standard || 'Standar 5 - Sarana dan Prasarana';

    window.calcRkasTotal();
    modal.classList.remove('hidden');
};

window.closeRkasFormModal = function () {
    const modal = document.getElementById('modal-rkas-form');
    if (modal) modal.classList.add('hidden');
};

async function handleRkasFormSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-save-rkas');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-xs"></i><span>Menyimpan...</span>';
    }

    try {
        const id = document.getElementById('rkas-form-id').value.trim();
        const fiscal_year = parseInt(document.getElementById('rkas-input-year').value, 10) || currentFiscalYear;
        const semester = parseInt(document.getElementById('rkas-input-semester').value, 10) || 1;
        const item_name = document.getElementById('rkas-input-name').value.trim();
        const specification = document.getElementById('rkas-input-spec').value.trim();
        const room_target_id = document.getElementById('rkas-input-room').value;
        const quantity = parseInt(document.getElementById('rkas-input-qty').value, 10) || 1;
        const unit = document.getElementById('rkas-input-unit').value.trim() || 'Unit';
        const estimated_price = parseFloat(document.getElementById('rkas-input-price').value) || 0;
        const priority_scale = parseInt(document.getElementById('rkas-input-priority').value, 10) || 2;
        const funding_source = document.getElementById('rkas-input-funding').value;
        const snp_standard = document.getElementById('rkas-input-snp').value;

        // Target Ruang
        const selectedRoom = roomsList.find(r => r.id === room_target_id);
        const room_target_name = selectedRoom ? `${selectedRoom.kode} - ${selectedRoom.nama}` : '';

        const payload = {
            fiscal_year,
            semester,
            item_name,
            specification,
            room_target_id,
            room_target_name,
            quantity,
            unit,
            estimated_price,
            priority_scale,
            funding_source,
            snp_standard
        };

        const isEdit = Boolean(id);
        const res = await cfClient.saveSarprasRkasItem(payload, isEdit, id);

        if (res.success) {
            showToast('Sukses', res.message || 'Item RKAS berhasil disimpan', 'success');
            window.closeRkasFormModal();
            await loadRkasData();
        } else {
            throw new Error(res.error || 'Gagal menyimpan rencana belanja RKAS');
        }
    } catch (err) {
        console.error('[SarprasRkas] Save error:', err);
        showToast('Error', err.message || 'Gagal menyimpan rencana belanja', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}

// =========================================================================
// 5. Modal Handlers: Persetujuan Bertingkat RKAS
// =========================================================================

window.openApprovalModal = function (id) {
    const item = rkasList.find(r => r.id === id);
    if (!item) return;

    const modal = document.getElementById('modal-rkas-approval');
    const form = document.getElementById('form-rkas-approval');
    if (!modal || !form) return;

    form.reset();
    document.getElementById('approval-rkas-id').value = item.id;
    document.getElementById('approval-item-title').textContent = item.item_name;
    document.getElementById('approval-item-total').textContent = formatRupiah(item.total_budget);
    document.getElementById('approval-item-funding').textContent = `${item.funding_source} (Prioritas ${item.priority_scale})`;
    document.getElementById('approval-item-room').textContent = item.room_target_name || 'Seluruh Sekolah';

    // Sesuaikan default aksi berdasarkan role
    const selectAction = document.getElementById('approval-action-select');
    if (selectAction) {
        if (isKepsek && !isWaka) {
            selectAction.value = 'approve_kepsek';
        } else {
            selectAction.value = item.status === 'proposed' ? 'verify_waka' : 'approve_kepsek';
        }
    }

    modal.classList.remove('hidden');
};

window.closeRkasApprovalModal = function () {
    const modal = document.getElementById('modal-rkas-approval');
    if (modal) modal.classList.add('hidden');
};

async function handleApprovalFormSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-save-approval');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-xs"></i><span>Memproses...</span>';
    }

    try {
        const id = document.getElementById('approval-rkas-id').value.trim();
        const action = document.getElementById('approval-action-select').value;
        const notes = document.getElementById('approval-notes').value.trim();

        const res = await cfClient.approveSarprasRkasItem(id, { action, notes });
        if (res.success) {
            showToast('Sukses', res.message || 'Status persetujuan RKAS diperbarui', 'success');
            window.closeRkasApprovalModal();
            await loadRkasData();
        } else {
            throw new Error(res.error || 'Gagal memperbarui status persetujuan');
        }
    } catch (err) {
        console.error('[SarprasRkas] Approval error:', err);
        showToast('Error', err.message || 'Gagal memproses keputusan', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}

// =========================================================================
// 6. Hapus Item RKAS
// =========================================================================

window.deleteRkasItem = async function (id) {
    const item = rkasList.find(r => r.id === id);
    if (!item) return;

    const confirmMsg = `Hapus rencana belanja "${item.item_name}" (${formatRupiah(item.total_budget)}) dari RKAS?`;
    if (!confirm(confirmMsg)) return;

    try {
        const res = await cfClient.deleteSarprasRkasItem(id);
        if (res.success) {
            showToast('Sukses', 'Item RKAS berhasil dihapus', 'success');
            await loadRkasData();
        } else {
            throw new Error(res.error || 'Gagal menghapus item');
        }
    } catch (err) {
        console.error('[SarprasRkas] Delete error:', err);
        showToast('Error', err.message || 'Gagal menghapus item RKAS', 'error');
    }
};

// =========================================================================
// 7. Pratinjau & Cetak Lembar Kerja RKAS Resmi A4
// =========================================================================

window.openPrintRkasModal = function () {
    const modal = document.getElementById('modal-print-rkas');
    if (!modal) return;

    // Kop Sekolah & Tanda Tangan dari SCHOOL_CONFIG
    if (SCHOOL_CONFIG) {
        const elInstansi = document.getElementById('kop-instansi');
        const elNamaSekolah = document.getElementById('kop-nama-sekolah');
        const elAlamat = document.getElementById('kop-alamat');
        const elKepsekName = document.getElementById('print-kepsek-name');
        const elKepsekNip = document.getElementById('print-kepsek-nip');

        if (elInstansi) elInstansi.textContent = SCHOOL_CONFIG.provinsi ? `PEMERINTAH PROVINSI ${SCHOOL_CONFIG.provinsi.toUpperCase()} - DINAS PENDIDIKAN` : 'PEMERINTAH PROVINSI BALI - DINAS PENDIDIKAN';
        if (elNamaSekolah) elNamaSekolah.textContent = SCHOOL_CONFIG.nama || "SMA NEGERI NUSANTARA";
        if (elAlamat) elAlamat.textContent = SCHOOL_CONFIG.alamat || "Jl. Raya Culik - Amed, Denpasar, Karangasem, Bali 80852";
        if (elKepsekName) elKepsekName.textContent = SCHOOL_CONFIG.kepsek?.nama || 'I Made Dwi Semaraputra, S.Pd., M.Pd.';
        if (elKepsekNip) elKepsekNip.textContent = `NIP. ${SCHOOL_CONFIG.kepsek?.nip || '19800512 200501 1 008'}`;
    }

    document.getElementById('print-rkas-fiscal-year').textContent = currentFiscalYear;

    const now = new Date();
    document.getElementById('print-date-display').textContent = now.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });

    const tbody = document.getElementById('print-rkas-table-body');
    const grandTotalEl = document.getElementById('print-rkas-grand-total');

    if (tbody) {
        let total = 0;
        tbody.innerHTML = rkasList.map((item, idx) => {
            total += Number(item.total_budget) || 0;
            return `
                <tr class="border-b border-slate-300">
                    <td class="border border-slate-800 p-1.5 text-center">${idx + 1}</td>
                    <td class="border border-slate-800 p-1.5 font-bold">
                        ${escapeHtml(item.item_name)}
                        ${item.specification ? `<div class="font-normal text-[9px] text-slate-600">${escapeHtml(item.specification)}</div>` : ''}
                    </td>
                    <td class="border border-slate-800 p-1.5">${escapeHtml(item.room_target_name || 'Umum Sekolah')}</td>
                    <td class="border border-slate-800 p-1.5 text-center">${item.quantity}</td>
                    <td class="border border-slate-800 p-1.5 text-center">${escapeHtml(item.unit || 'Unit')}</td>
                    <td class="border border-slate-800 p-1.5 text-right">${formatRupiah(item.estimated_price)}</td>
                    <td class="border border-slate-800 p-1.5 text-right font-bold">${formatRupiah(item.total_budget)}</td>
                    <td class="border border-slate-800 p-1.5 text-center">${escapeHtml(item.funding_source)}</td>
                    <td class="border border-slate-800 p-1.5 text-center font-bold">Prio ${item.priority_scale}</td>
                </tr>
            `;
        }).join('');

        if (grandTotalEl) grandTotalEl.textContent = formatRupiah(total);
    }

    modal.classList.remove('hidden');
};

window.closePrintRkasModal = function () {
    const modal = document.getElementById('modal-print-rkas');
    if (modal) modal.classList.add('hidden');
};

window.executePrintRkas = function () {
    window.print();
};

// =========================================================================
// 8. Ekspor Spreadsheet Excel (XLSX)
// =========================================================================

window.exportRkasToExcel = function () {
    if (typeof XLSX === 'undefined') {
        showToast('Error', 'Pustaka Excel belum siap, muat ulang halaman.', 'error');
        return;
    }

    if (rkasList.length === 0) {
        showToast('Info', 'Tidak ada data rencana belanja untuk diekspor.', 'info');
        return;
    }

    try {
        const rows = rkasList.map((item, idx) => ({
            'No': idx + 1,
            'Tahun Anggaran': item.fiscal_year,
            'Semester': item.semester,
            'Skala Prioritas': `Prioritas ${item.priority_scale}`,
            'Nama Barang / Pekerjaan': item.item_name,
            'Spesifikasi': item.specification || '-',
            'Sasaran Ruang': item.room_target_name || 'Umum',
            'Volume': item.quantity,
            'Satuan': item.unit,
            'Harga Satuan (Rp)': item.estimated_price,
            'Total Pagu (Rp)': item.total_budget,
            'Sumber Dana': item.funding_source,
            'Standar SNP': item.snp_standard,
            'Status Persetujuan': item.status,
            'Pengusul': item.proposed_by_name || '-'
        }));

        const worksheet = XLSX.utils.json_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, `RKAS_${currentFiscalYear}`);

        XLSX.writeFile(workbook, `RKAS_Sarpras_SMANTARA_${currentFiscalYear}.xlsx`);
        showToast('Sukses', `Data RKAS TA ${currentFiscalYear} berhasil diekspor ke Excel`, 'success');
    } catch (err) {
        console.error('[SarprasRkas] Export error:', err);
        showToast('Error', 'Gagal mengekspor file Excel', 'error');
    }
};

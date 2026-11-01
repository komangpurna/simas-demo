/**
 * page-sarpras-penggunaan.js - Controller Peminjaman Sarana/Ruangan & Manajemen BMHP
 * Single Source of Truth (SSOT): Cloudflare D1 via cfClient (/api/sarpras/loans, /api/sarpras/bmhp)
 * Standar: OWASP Top 10, ASVS Level 1 & 2, Action & Security Parity
 */

import cfClient from './cloudflare-client.js';

// State Module
let userUid = '';
let userRole = 'guru_mapel';
let userName = "Civitas SMANTARA";
let isManager = false;
let isWaka = false;

let activeTab = 'loans'; // 'loans' or 'bmhp'
let loansList = [];
let bmhpList = [];
let roomsList = [];
let loanableItemsList = [];

let loanFilter = { search: '', loan_type: '', status: '' };
let bmhpFilter = { search: '', category: '', low_stock: false };

let searchDebounceTimer = null;
let conflictDebounceTimer = null;

// Toast Helper
function showToast(title, msg, type = 'info') {
    if (typeof window.showToast === 'function') {
        window.showToast(title, msg, type);
    } else {
        console.log(`[${type}] ${title}: ${msg}`);
    }
}

function isSarprasManager() {
    if (typeof window.hasRole === 'function') {
        return window.hasRole('super_admin') || window.hasRole('sarpras') || window.hasRole('admin_sarpras');
    }
    const role = localStorage.getItem('user_role');
    return ['super_admin', 'sarpras', 'admin_sarpras'].includes(role);
}

function formatRupiah(number) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0
    }).format(number || 0);
}

function formatDateDisplay(isoStr) {
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
// 1. Inisialisasi Modul & Setup
// =========================================================================

function applyUserContext() {
    userUid = localStorage.getItem('user_uid') || '';
    userRole = localStorage.getItem('user_role') || 'guru_mapel';
    userName = localStorage.getItem('user_name') || "Civitas SMANTARA";

    isManager = isSarprasManager();
    isWaka = userRole === 'sarpras' || userRole === 'super_admin';

    const headerUserName = document.getElementById('header-user-name');
    if (headerUserName) {
        headerUserName.textContent = `${userName} (${userRole})`;
    }

    const headerDate = document.getElementById('header-date-display');
    if (headerDate) {
        const now = new Date();
        const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Makassar' };
        headerDate.textContent = now.toLocaleDateString('id-ID', options) + ' WITA';
    }

    // Role-based UI visibility
    const btnBmhpItemModal = document.getElementById('btn-open-bmhp-item-modal');
    if (btnBmhpItemModal) {
        if (isManager) btnBmhpItemModal.classList.remove('hidden');
        else btnBmhpItemModal.classList.add('hidden');
    }
}

async function initPage() {
    applyUserContext();
    setupEventListeners();

    // Segera tampilkan konten utama agar tidak blank screen
    const mainEl = document.querySelector('main');
    if (mainEl) mainEl.classList.remove('hidden');

    try {
        await Promise.all([
            loadMasterDropdowns(),
            loadLoansData(),
            loadBmhpData()
        ]);
    } catch (err) {
        console.error('[SarprasPenggunaan] Init error:', err);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPage);
} else {
    initPage();
}

// =========================================================================
// 2. Setup Event Listeners & Tab Navigation
// =========================================================================

function setupEventListeners() {
    // Filter Loans
    const filterLoanSearch = document.getElementById('filter-loan-search');
    if (filterLoanSearch) {
        filterLoanSearch.addEventListener('input', (e) => {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                loanFilter.search = e.target.value.trim();
                renderLoansTable();
            }, 300);
        });
    }

    const filterLoanType = document.getElementById('filter-loan-type');
    if (filterLoanType) {
        filterLoanType.addEventListener('change', (e) => {
            loanFilter.loan_type = e.target.value;
            renderLoansTable();
        });
    }

    const filterLoanStatus = document.getElementById('filter-loan-status');
    if (filterLoanStatus) {
        filterLoanStatus.addEventListener('change', (e) => {
            loanFilter.status = e.target.value;
            renderLoansTable();
        });
    }

    // Filter BMHP
    const filterBmhpSearch = document.getElementById('filter-bmhp-search');
    if (filterBmhpSearch) {
        filterBmhpSearch.addEventListener('input', (e) => {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                bmhpFilter.search = e.target.value.trim();
                renderBmhpTable();
            }, 300);
        });
    }

    const filterBmhpCat = document.getElementById('filter-bmhp-cat');
    if (filterBmhpCat) {
        filterBmhpCat.addEventListener('change', (e) => {
            bmhpFilter.category = e.target.value;
            renderBmhpTable();
        });
    }

    // Form Submits
    const formLoan = document.getElementById('form-loan');
    if (formLoan) formLoan.addEventListener('submit', handleLoanFormSubmit);

    const formLoanStatus = document.getElementById('form-loan-status');
    if (formLoanStatus) formLoanStatus.addEventListener('submit', handleLoanStatusSubmit);

    const formBmhpItem = document.getElementById('form-bmhp-item');
    if (formBmhpItem) formBmhpItem.addEventListener('submit', handleBmhpItemSubmit);

    const formBmhpTrx = document.getElementById('form-bmhp-trx');
    if (formBmhpTrx) formBmhpTrx.addEventListener('submit', handleBmhpTrxSubmit);
}

window.switchTab = function (tab) {
    activeTab = tab;
    const panelLoans = document.getElementById('panel-tab-loans');
    const panelBmhp = document.getElementById('panel-tab-bmhp');
    const btnLoans = document.getElementById('tab-btn-loans');
    const btnBmhp = document.getElementById('tab-btn-bmhp');
    const btnActionLabel = document.getElementById('btn-tab-action-label');

    if (tab === 'loans') {
        panelLoans.classList.remove('hidden');
        panelBmhp.classList.add('hidden');

        btnLoans.className = 'px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-2 bg-emerald-500 text-slate-950 shadow-xs';
        btnBmhp.className = 'px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-2 text-slate-300 hover:text-white hover:bg-white/10';

        if (btnActionLabel) btnActionLabel.textContent = 'Ajukan Peminjaman';
    } else {
        panelLoans.classList.add('hidden');
        panelBmhp.classList.remove('hidden');

        btnBmhp.className = 'px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-2 bg-emerald-500 text-slate-950 shadow-xs';
        btnLoans.className = 'px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-2 text-slate-300 hover:text-white hover:bg-white/10';

        if (btnActionLabel) btnActionLabel.textContent = isManager ? 'Restock / Mutasi' : 'Ajukan Permintaan BMHP';
    }
};

window.handleMainTabAction = function () {
    if (activeTab === 'loans') {
        window.openCreateLoanModal();
    } else {
        window.openQuickBmhpRequest();
    }
};

window.refreshActiveTabData = function () {
    if (activeTab === 'loans') {
        loadLoansData();
    } else {
        loadBmhpData();
    }
    showToast('Info', 'Memperbarui data...', 'info');
};

// =========================================================================
// 3. Peminjaman: Data & Render
// =========================================================================

async function loadMasterDropdowns() {
    try {
        // Ambil ruangan yang diizinkan untuk dipinjam (Aula, Lab, Lapangan)
        const rooms = await cfClient.getSarprasRooms();
        roomsList = rooms || [];
        const selectRoom = document.getElementById('loan-input-room');
        if (selectRoom) {
            selectRoom.innerHTML = '<option value="">-- Pilih Ruangan / Fasilitas --</option>';
            roomsList.forEach(r => {
                const opt = document.createElement('option');
                opt.value = r.id;
                opt.textContent = `${r.kode} - ${r.nama} (${r.gedung || r.kategori_ruang})`;
                selectRoom.appendChild(opt);
            });
        }

        // Ambil inventaris yang bisa dipinjam bawa (is_loanable = 1)
        const invRes = await cfClient.getSarprasInventory({ condition: 'good', limit: 100 });
        loanableItemsList = (invRes?.data || []).filter(item => item.is_loanable === 1 || item.qty_good > 0);
        const selectItem = document.getElementById('loan-input-item');
        if (selectItem) {
            selectItem.innerHTML = '<option value="">-- Pilih Sarana Bergerak Tersedia --</option>';
            loanableItemsList.forEach(item => {
                const opt = document.createElement('option');
                opt.value = item.id;
                opt.textContent = `${item.inventory_code} - ${item.name} (${item.brand_model || item.unit}) - Sisa Baik: ${item.qty_good}`;
                selectItem.appendChild(opt);
            });
        }
    } catch (err) {
        console.warn('[SarprasPenggunaan] Load dropdowns warning:', err);
    }
}

async function loadLoansData() {
    const tbody = document.getElementById('table-loans-body');
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="py-12 text-center text-slate-400">
                    <i class="fa-solid fa-spinner fa-spin text-2xl text-emerald-500 mb-2"></i>
                    <p class="text-xs">Memuat data peminjaman...</p>
                </td>
            </tr>
        `;
    }

    try {
        loansList = await cfClient.getSarprasLoans({});
        updateLoansKpi();
        renderLoansTable();
    } catch (err) {
        console.error('[SarprasPenggunaan] Load loans error:', err);
        showToast('Error', err.message || 'Gagal memuat peminjaman', 'error');
    }
}

function updateLoansKpi() {
    const total = loansList.length;
    const borrowed = loansList.filter(l => l.status === 'borrowed').length;
    const pending = loansList.filter(l => l.status === 'pending').length;
    const returned = loansList.filter(l => l.status === 'returned').length;

    const elTotal = document.getElementById('kpi-loans-total');
    const elBorrowed = document.getElementById('kpi-loans-borrowed');
    const elPending = document.getElementById('kpi-loans-pending');
    const elReturned = document.getElementById('kpi-loans-returned');

    if (elTotal) elTotal.textContent = total;
    if (elBorrowed) elBorrowed.textContent = borrowed;
    if (elPending) elPending.textContent = pending;
    if (elReturned) elReturned.textContent = returned;
}

function renderLoansTable() {
    const tbody = document.getElementById('table-loans-body');
    if (!tbody) return;

    let filtered = loansList.filter(l => {
        if (loanFilter.loan_type && l.loan_type !== loanFilter.loan_type) return false;
        if (loanFilter.status && l.status !== loanFilter.status) return false;
        if (loanFilter.search) {
            const s = loanFilter.search.toLowerCase();
            const matchCode = (l.loan_code || '').toLowerCase().includes(s);
            const matchBorrower = (l.borrower_name || '').toLowerCase().includes(s);
            const matchPurpose = (l.purpose || '').toLowerCase().includes(s);
            const matchRoom = (l.room_name || '').toLowerCase().includes(s);
            const matchItem = (l.item_name || '').toLowerCase().includes(s);
            if (!matchCode && !matchBorrower && !matchPurpose && !matchRoom && !matchItem) return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="py-12 text-center text-slate-400">
                    <div class="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 mx-auto mb-2 text-xl">
                        <i class="fa-solid fa-calendar-xmark"></i>
                    </div>
                    <p class="font-bold text-slate-600 dark:text-slate-300">Belum ada riwayat peminjaman</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filtered.map(l => {
        const isOwner = userUid && l.borrower_uid === userUid;
        const canEditOrDelete = (isOwner && l.status === 'pending') || isManager;
        const canManageStatus = isManager;

        const typeBadge = l.loan_type === 'room'
            ? '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60">Ruangan</span>'
            : '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/60">Sarana</span>';

        const statusBadge = getLoanStatusBadge(l.status);
        const objName = l.loan_type === 'room' ? (l.room_name || 'Ruangan Sekolah') : (l.item_name || 'Sarana Bergerak');

        return `
            <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                <!-- Kode & Tipe -->
                <td class="py-3 px-3 sm:px-4">
                    <span class="font-mono font-bold text-xs text-emerald-600 dark:text-emerald-400 block">${escapeHtml(l.loan_code)}</span>
                    <div class="mt-1">${typeBadge}</div>
                </td>

                <!-- Peminjam -->
                <td class="py-3 px-3 sm:px-4">
                    <span class="font-bold text-slate-800 dark:text-white block truncate max-w-[140px]">${escapeHtml(l.borrower_name)}</span>
                    <span class="text-[11px] text-slate-400 block">${escapeHtml(l.borrower_phone || l.borrower_role)}</span>
                </td>

                <!-- Objek Fasilitas -->
                <td class="py-3 px-3 sm:px-4">
                    <span class="font-bold text-slate-800 dark:text-slate-100 block truncate max-w-[170px]" title="${escapeHtml(objName)}">${escapeHtml(objName)}</span>
                    ${l.quantity > 1 ? `<span class="text-[10px] font-semibold text-slate-400">Qty: ${l.quantity} Unit</span>` : ''}
                </td>

                <!-- Jadwal Penggunaan -->
                <td class="py-3 px-3 sm:px-4 text-xs whitespace-nowrap">
                    <div class="text-slate-700 dark:text-slate-200 font-semibold flex items-center gap-1.5">
                        <i class="fa-solid fa-play text-[9px] text-emerald-500"></i>
                        <span>${formatDateDisplay(l.start_time)}</span>
                    </div>
                    <div class="text-slate-400 font-normal mt-0.5 flex items-center gap-1.5">
                        <i class="fa-solid fa-flag-checkered text-[9px] text-rose-500"></i>
                        <span>${formatDateDisplay(l.end_time)}</span>
                    </div>
                </td>

                <!-- Keperluan -->
                <td class="py-3 px-3 sm:px-4 max-w-[180px]">
                    <p class="text-xs text-slate-700 dark:text-slate-300 line-clamp-2" title="${escapeHtml(l.purpose)}">${escapeHtml(l.purpose)}</p>
                </td>

                <!-- Status & Kondisi Fisik -->
                <td class="py-3 px-3 sm:px-4">
                    <div class="flex flex-col gap-1 items-start">
                        ${statusBadge}
                        <span class="text-[10px] text-slate-400">Fisik Awal: <b>${escapeHtml(l.initial_condition || 'Baik')}</b></span>
                        ${l.return_condition ? `<span class="text-[10px] text-slate-400">Kembali: <b>${escapeHtml(l.return_condition)}</b></span>` : ''}
                    </div>
                </td>

                <!-- Aksi -->
                <td class="py-3 px-3 sm:px-4 text-center">
                    <div class="flex items-center justify-center gap-1.5 flex-nowrap">
                        ${canManageStatus ? `
                            <button type="button" onclick="window.openLoanStatusModal('${l.id}')" class="w-7 h-7 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xs transition-all" title="Proses Serah Terima / Status">
                                <i class="fa-solid fa-clipboard-check"></i>
                            </button>
                        ` : ''}
                        ${canEditOrDelete ? `
                            <button type="button" onclick="window.deleteLoan('${l.id}')" class="w-7 h-7 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 flex items-center justify-center text-xs transition-all" title="Batalkan Peminjaman">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function getLoanStatusBadge(status) {
    switch (status) {
        case 'pending':
            return '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">Menunggu</span>';
        case 'approved':
            return '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60">Disetujui</span>';
        case 'borrowed':
            return '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60">Sedang Dipinjam</span>';
        case 'returned':
            return '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">Selesai Dikembalikan</span>';
        case 'rejected':
            return '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60">Ditolak</span>';
        default:
            return `<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-600">${status}</span>`;
    }
}

// =========================================================================
// 4. Modal Handlers: Peminjaman Form & Konflik
// =========================================================================

window.handleLoanTypeChange = function (type) {
    const wrapRoom = document.getElementById('wrapper-loan-room');
    const wrapItem = document.getElementById('wrapper-loan-item');
    if (type === 'room') {
        wrapRoom.classList.remove('hidden');
        wrapItem.classList.add('hidden');
    } else {
        wrapRoom.classList.add('hidden');
        wrapItem.classList.remove('hidden');
    }
    window.triggerConflictCheck();
};

window.triggerConflictCheck = function () {
    clearTimeout(conflictDebounceTimer);
    conflictDebounceTimer = setTimeout(async () => {
        const loanType = document.getElementById('loan-input-type').value;
        const roomId = document.getElementById('loan-input-room').value;
        const itemId = document.getElementById('loan-input-item').value;
        const quantity = loanType === 'room' ? 1 : Number(document.getElementById('loan-input-qty')?.value || 1);
        const startTime = document.getElementById('loan-input-start').value;
        const endTime = document.getElementById('loan-input-end').value;
        const loanId = document.getElementById('loan-form-id').value;

        const alertBox = document.getElementById('loan-conflict-alert');
        const alertMsg = document.getElementById('loan-conflict-message');

        if (!startTime || !endTime || !(loanType === 'room' ? roomId : itemId) || !Number.isInteger(quantity) || quantity < 1) {
            if (alertBox) alertBox.classList.add('hidden');
            return;
        }

        try {
            const res = await cfClient.checkSarprasLoanConflict({
                loan_type: loanType,
                room_id: roomId,
                item_id: itemId,
                start_time: startTime,
                end_time: endTime,
                quantity,
                exclude_id: loanId
            });

            if (res.conflict && alertBox && alertMsg) {
                alertBox.classList.remove('hidden');
                alertMsg.textContent = res.message || 'Jadwal atau jumlah tidak tersedia.';
            } else if (alertBox) {
                alertBox.classList.add('hidden');
            }
        } catch (err) {
            console.warn('[Sarpras] Check conflict warning:', err);
        }
    }, 400);
};

window.openCreateLoanModal = function () {
    const modal = document.getElementById('modal-loan-form');
    const form = document.getElementById('form-loan');
    const alertBox = document.getElementById('loan-conflict-alert');
    if (!modal || !form) return;

    form.reset();
    document.getElementById('loan-form-id').value = '';
    if (alertBox) alertBox.classList.add('hidden');

    window.handleLoanTypeChange('room');
    modal.classList.remove('hidden');
};

window.closeLoanFormModal = function () {
    const modal = document.getElementById('modal-loan-form');
    if (modal) modal.classList.add('hidden');
};

async function handleLoanFormSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-save-loan');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-xs"></i><span>Memproses...</span>';
    }

    try {
        const id = document.getElementById('loan-form-id').value.trim();
        const loan_type = document.getElementById('loan-input-type').value;
        const room_id = document.getElementById('loan-input-room').value;
        const item_id = document.getElementById('loan-input-item').value;
        const quantity = parseInt(document.getElementById('loan-input-qty').value, 10) || 1;
        const start_time = document.getElementById('loan-input-start').value;
        const end_time = document.getElementById('loan-input-end').value;
        const borrower_phone = document.getElementById('loan-input-phone').value.trim();
        const purpose = document.getElementById('loan-input-purpose').value.trim();

        // Cari nama ruangan atau nama item
        let room_name = '';
        let item_name = '';

        if (loan_type === 'room') {
            const foundRoom = roomsList.find(r => r.id === room_id);
            room_name = foundRoom ? `${foundRoom.kode} - ${foundRoom.nama}` : '';
            if (!room_id) throw new Error('Silakan pilih ruangan yang ingin dipinjam');
        } else {
            const foundItem = loanableItemsList.find(i => i.id === item_id);
            item_name = foundItem ? `${foundItem.inventory_code} - ${foundItem.name}` : '';
            if (!item_id) throw new Error('Silakan pilih sarana aset yang ingin dipinjam');
        }

        const payload = {
            loan_type,
            room_id,
            room_name,
            item_id,
            item_name,
            quantity,
            start_time,
            end_time,
            borrower_phone,
            purpose
        };

        const isEdit = Boolean(id);
        const res = await cfClient.saveSarprasLoan(payload, isEdit, id);

        if (res.success) {
            showToast('Sukses', res.message || 'Peminjaman berhasil diajukan', 'success');
            window.closeLoanFormModal();
            await loadLoansData();
        } else {
            throw new Error(res.error || 'Gagal menyimpan pengajuan');
        }
    } catch (err) {
        console.error('[SarprasPenggunaan] Save loan error:', err);
        showToast('Error', err.message || 'Gagal mengajukan peminjaman', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}

// =========================================================================
// 5. Modal Handlers: Status & Serah Terima Fisik
// =========================================================================

window.openLoanStatusModal = function (id) {
    const loan = loansList.find(l => l.id === id);
    if (!loan) return;

    const modal = document.getElementById('modal-loan-status');
    const form = document.getElementById('form-loan-status');
    if (!modal || !form) return;

    form.reset();
    document.getElementById('loan-status-id').value = loan.id;
    document.getElementById('loan-status-code-display').textContent = loan.loan_code;
    document.getElementById('status-borrower-name').textContent = loan.borrower_name;
    document.getElementById('status-target-name').textContent = loan.loan_type === 'room' ? loan.room_name : loan.item_name;

    const selectAction = document.getElementById('loan-status-action');
    if (selectAction) {
        const permitted = { pending: ['approve', 'reject', 'cancel'], approved: ['borrow', 'cancel'], borrowed: ['return'] }[loan.status] || [];
        for (const option of selectAction.options) option.hidden = option.disabled = !permitted.includes(option.value);
        selectAction.value = permitted[0] || '';
    }

    document.getElementById('loan-condition-initial').value = loan.initial_condition || 'Baik';
    document.getElementById('loan-condition-return').value = loan.return_condition || 'Baik';
    document.getElementById('loan-handover-notes').value = loan.handover_notes || '';

    modal.classList.remove('hidden');
};

window.closeLoanStatusModal = function () {
    const modal = document.getElementById('modal-loan-status');
    if (modal) modal.classList.add('hidden');
};

async function handleLoanStatusSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-save-loan-status');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-xs"></i><span>Menyimpan...</span>';
    }

    try {
        const id = document.getElementById('loan-status-id').value.trim();
        const action = document.getElementById('loan-status-action').value;
        const initial_condition = document.getElementById('loan-condition-initial').value;
        const return_condition = document.getElementById('loan-condition-return').value;
        const handover_notes = document.getElementById('loan-handover-notes').value.trim();

        const payload = {
            action,
            initial_condition,
            return_condition,
            handover_notes
        };

        const res = await cfClient.updateSarprasLoanStatus(id, payload);
        if (res.success) {
            showToast('Sukses', res.message || 'Status peminjaman diperbarui', 'success');
            window.closeLoanStatusModal();
            await loadLoansData();
        } else {
            throw new Error(res.error || 'Gagal memperbarui status');
        }
    } catch (err) {
        console.error('[SarprasPenggunaan] Status error:', err);
        showToast('Error', err.message || 'Gagal memperbarui status', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}

window.deleteLoan = async function (id) {
    const loan = loansList.find(l => l.id === id);
    if (!loan) return;

    if (!confirm(`Batalkan pengajuan peminjaman "${loan.loan_code}"?`)) return;

    try {
        const res = await cfClient.deleteSarprasLoan(id);
        if (res.success) {
            showToast('Sukses', 'Peminjaman berhasil dibatalkan', 'success');
            await loadLoansData();
        } else {
            throw new Error(res.error || 'Gagal membatalkan peminjaman');
        }
    } catch (err) {
        console.error('[SarprasPenggunaan] Delete loan error:', err);
        showToast('Error', err.message || 'Gagal membatalkan peminjaman', 'error');
    }
};

// =========================================================================
// 6. BMHP: Data & Render
// =========================================================================

async function loadBmhpData() {
    const tbody = document.getElementById('table-bmhp-body');
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="py-12 text-center text-slate-400">
                    <i class="fa-solid fa-spinner fa-spin text-2xl text-emerald-500 mb-2"></i>
                    <p class="text-xs">Memuat katalog persediaan BMHP...</p>
                </td>
            </tr>
        `;
    }

    try {
        bmhpList = await cfClient.getSarprasBmhpItems({});
        updateBmhpKpi();
        renderBmhpTable();
    } catch (err) {
        console.error('[SarprasPenggunaan] Load BMHP error:', err);
        showToast('Error', err.message || 'Gagal memuat katalog BMHP', 'error');
    }
}

function updateBmhpKpi() {
    const total = bmhpList.length;
    const low = bmhpList.filter(b => b.stock_current <= b.stock_minimum).length;
    const safe = total - low;

    const elTotal = document.getElementById('kpi-bmhp-total');
    const elLow = document.getElementById('kpi-bmhp-low');
    const elSafe = document.getElementById('kpi-bmhp-safe');

    if (elTotal) elTotal.textContent = `${total} Item`;
    if (elLow) elLow.textContent = `${low} Item`;
    if (elSafe) elSafe.textContent = `${safe} Item`;
}

function renderBmhpTable() {
    const tbody = document.getElementById('table-bmhp-body');
    if (!tbody) return;

    let filtered = bmhpList.filter(b => {
        if (bmhpFilter.category && b.category !== bmhpFilter.category) return false;
        if (bmhpFilter.low_stock && b.stock_current > b.stock_minimum) return false;
        if (bmhpFilter.search) {
            const s = bmhpFilter.search.toLowerCase();
            const matchName = (b.name || '').toLowerCase().includes(s);
            const matchCode = (b.item_code || '').toLowerCase().includes(s);
            if (!matchName && !matchCode) return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="py-12 text-center text-slate-400">
                    <div class="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 mx-auto mb-2 text-xl">
                        <i class="fa-solid fa-box-open"></i>
                    </div>
                    <p class="font-bold text-slate-600 dark:text-slate-300">Tidak ada barang habis pakai pada filter ini</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filtered.map(b => {
        const isCritical = b.stock_current <= b.stock_minimum;
        const stockBadge = isCritical
            ? `<span class="px-2 py-0.5 rounded-md text-xs font-black bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 border border-rose-300 dark:border-rose-800 animate-pulse">${b.stock_current} ${escapeHtml(b.unit)}</span>`
            : `<span class="px-2 py-0.5 rounded-md text-xs font-black bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800">${b.stock_current} ${escapeHtml(b.unit)}</span>`;

        return `
            <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                <!-- Kode & Kategori -->
                <td class="py-3 px-3 sm:px-4">
                    <span class="font-mono font-bold text-xs text-slate-600 dark:text-slate-400 block">${escapeHtml(b.item_code)}</span>
                    <span class="text-[10px] font-bold uppercase text-indigo-600 dark:text-indigo-400 tracking-wider">${escapeHtml(b.category)}</span>
                </td>

                <!-- Nama Barang -->
                <td class="py-3 px-3 sm:px-4">
                    <span class="font-bold text-slate-800 dark:text-white block">${escapeHtml(b.name)}</span>
                    ${b.notes ? `<p class="text-[11px] text-slate-400 mt-0.5">${escapeHtml(b.notes)}</p>` : ''}
                </td>

                <!-- Satuan -->
                <td class="py-3 px-3 sm:px-4 text-center font-medium text-slate-600 dark:text-slate-300">
                    ${escapeHtml(b.unit)}
                </td>

                <!-- Stok Saat Ini -->
                <td class="py-3 px-3 sm:px-4 text-center">
                    ${stockBadge}
                </td>

                <!-- Batas Minimum -->
                <td class="py-3 px-3 sm:px-4 text-center text-xs text-slate-500 font-semibold">
                    ${b.stock_minimum} ${escapeHtml(b.unit)}
                </td>

                <!-- Harga Satuan -->
                <td class="py-3 px-3 sm:px-4 text-right font-medium text-slate-600 dark:text-slate-300">
                    ${formatRupiah(b.unit_price)}
                </td>

                <!-- Aksi Cepat -->
                <td class="py-3 px-3 sm:px-4 text-center">
                    <div class="flex items-center justify-center gap-1.5 flex-nowrap">
                        <button type="button" onclick="window.openBmhpTrxModal('${b.id}', 'out')" class="px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/60 dark:hover:bg-blue-900/60 text-blue-600 dark:text-blue-400 text-xs font-bold transition-all flex items-center gap-1" title="Keluarkan / Minta Barang">
                            <i class="fa-solid fa-arrow-up-from-bracket text-[10px]"></i>
                            <span>Minta</span>
                        </button>
                        ${isManager ? `
                            <button type="button" onclick="window.openBmhpTrxModal('${b.id}', 'in')" class="px-2 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/60 text-emerald-600 dark:text-emerald-400 text-xs font-bold transition-all flex items-center gap-1" title="Restock Stok Masuk">
                                <i class="fa-solid fa-plus text-[10px]"></i>
                                <span>Restock</span>
                            </button>
                            <button type="button" onclick="window.openEditBmhpItemModal('${b.id}')" class="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center text-xs transition-all" title="Edit Item">
                                <i class="fa-solid fa-pen"></i>
                            </button>
                            <button type="button" onclick="window.deleteBmhpItem('${b.id}')" class="w-7 h-7 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 flex items-center justify-center text-xs transition-all" title="Hapus Item">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

window.toggleLowStockFilter = function () {
    bmhpFilter.low_stock = !bmhpFilter.low_stock;
    const btn = document.getElementById('btn-toggle-low-stock');
    if (btn) {
        if (bmhpFilter.low_stock) {
            btn.classList.add('bg-amber-100', 'text-amber-800', 'dark:bg-amber-950/60', 'dark:text-amber-300');
        } else {
            btn.classList.remove('bg-amber-100', 'text-amber-800', 'dark:bg-amber-950/60', 'dark:text-amber-300');
        }
    }
    renderBmhpTable();
};

// =========================================================================
// 7. Modal Handlers: BMHP Item Master & Mutasi Stok
// =========================================================================

window.openCreateBmhpItemModal = function () {
    const modal = document.getElementById('modal-bmhp-item');
    const form = document.getElementById('form-bmhp-item');
    const title = document.getElementById('modal-bmhp-title');
    if (!modal || !form) return;

    form.reset();
    document.getElementById('bmhp-input-id').value = '';
    if (title) title.textContent = 'Tambah Master Barang Habis Pakai Baru';

    modal.classList.remove('hidden');
};

window.openEditBmhpItemModal = function (id) {
    const item = bmhpList.find(b => b.id === id);
    if (!item) return;

    const modal = document.getElementById('modal-bmhp-item');
    const title = document.getElementById('modal-bmhp-title');
    if (!modal) return;

    document.getElementById('bmhp-input-id').value = item.id;
    if (title) title.textContent = `Edit Master BMHP (${item.item_code})`;

    document.getElementById('bmhp-input-name').value = item.name || '';
    document.getElementById('bmhp-input-category').value = item.category || 'ATK';
    document.getElementById('bmhp-input-unit').value = item.unit || 'Pcs';
    document.getElementById('bmhp-input-stock').value = item.stock_current || 0;
    document.getElementById('bmhp-input-min').value = item.stock_minimum || 5;
    document.getElementById('bmhp-input-price').value = item.unit_price || 0;

    modal.classList.remove('hidden');
};

window.closeBmhpItemModal = function () {
    const modal = document.getElementById('modal-bmhp-item');
    if (modal) modal.classList.add('hidden');
};

async function handleBmhpItemSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-save-bmhp-item');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-xs"></i><span>Menyimpan...</span>';
    }

    try {
        const id = document.getElementById('bmhp-input-id').value.trim();
        const name = document.getElementById('bmhp-input-name').value.trim();
        const category = document.getElementById('bmhp-input-category').value;
        const unit = document.getElementById('bmhp-input-unit').value.trim();
        const stock_current = parseInt(document.getElementById('bmhp-input-stock').value, 10) || 0;
        const stock_minimum = parseInt(document.getElementById('bmhp-input-min').value, 10) || 5;
        const unit_price = parseFloat(document.getElementById('bmhp-input-price').value) || 0;

        const payload = {
            name,
            category,
            unit,
            stock_current,
            stock_minimum,
            unit_price
        };

        const isEdit = Boolean(id);
        const res = await cfClient.saveSarprasBmhpItem(payload, isEdit, id);

        if (res.success) {
            showToast('Sukses', res.message || 'Data BMHP berhasil disimpan', 'success');
            window.closeBmhpItemModal();
            await loadBmhpData();
        } else {
            throw new Error(res.error || 'Gagal menyimpan item BMHP');
        }
    } catch (err) {
        console.error('[SarprasPenggunaan] Save BMHP error:', err);
        showToast('Error', err.message || 'Gagal menyimpan item BMHP', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}

window.deleteBmhpItem = async function (id) {
    const item = bmhpList.find(b => b.id === id);
    if (!item) return;

    if (!confirm(`Nonaktifkan/hapus barang BMHP "${item.name}"?`)) return;

    try {
        const res = await cfClient.deleteSarprasBmhpItem(id);
        if (res.success) {
            showToast('Sukses', 'Barang BMHP berhasil dinonaktifkan', 'success');
            await loadBmhpData();
        } else {
            throw new Error(res.error || 'Gagal menghapus item');
        }
    } catch (err) {
        console.error('[SarprasPenggunaan] Delete BMHP error:', err);
        showToast('Error', err.message || 'Gagal menghapus item BMHP', 'error');
    }
};

window.openBmhpTrxModal = function (itemId, type = 'out') {
    const item = bmhpList.find(b => b.id === itemId);
    if (!item) return;

    const modal = document.getElementById('modal-bmhp-trx');
    const form = document.getElementById('form-bmhp-trx');
    const title = document.getElementById('modal-trx-title');
    const btnLabel = document.getElementById('btn-save-trx-label');
    const badge = document.getElementById('trx-modal-icon-badge');
    const reqWrapper = document.getElementById('trx-requester-wrapper');

    if (!modal || !form) return;

    form.reset();
    document.getElementById('trx-item-id').value = item.id;
    document.getElementById('trx-type').value = type;
    document.getElementById('trx-item-name-display').textContent = item.name;
    document.getElementById('trx-current-stock-display').textContent = `${item.stock_current} ${item.unit}`;

    if (type === 'in') {
        if (title) title.textContent = 'Catat Penerimaan Stok (Restock)';
        if (btnLabel) btnLabel.textContent = 'Tambah Stok Masuk';
        if (badge) {
            badge.className = 'w-8 h-8 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center text-sm font-bold';
            badge.innerHTML = '<i class="fa-solid fa-arrow-down"></i>';
        }
        if (reqWrapper) reqWrapper.classList.add('hidden');
    } else {
        if (title) title.textContent = 'Pengeluaran / Permintaan Barang';
        if (btnLabel) btnLabel.textContent = 'Keluarkan Barang';
        if (badge) {
            badge.className = 'w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-bold';
            badge.innerHTML = '<i class="fa-solid fa-arrow-up"></i>';
        }
        if (reqWrapper) reqWrapper.classList.remove('hidden');
    }

    modal.classList.remove('hidden');
};

window.openQuickBmhpRequest = function () {
    if (bmhpList.length === 0) {
        showToast('Info', 'Belum ada katalog barang BMHP', 'info');
        return;
    }
    window.openBmhpTrxModal(bmhpList[0].id, 'out');
};

window.closeBmhpTrxModal = function () {
    const modal = document.getElementById('modal-bmhp-trx');
    if (modal) modal.classList.add('hidden');
};

async function handleBmhpTrxSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-save-trx');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-xs"></i><span>Menyimpan...</span>';
    }

    try {
        const item_id = document.getElementById('trx-item-id').value.trim();
        const trx_type = document.getElementById('trx-type').value;
        const quantity = parseInt(document.getElementById('trx-quantity').value, 10) || 1;
        const requester_name = document.getElementById('trx-requester')?.value.trim() || userName;
        const notes = document.getElementById('trx-notes').value.trim();

        const payload = {
            item_id,
            trx_type,
            quantity,
            requester_name,
            notes
        };

        const res = await cfClient.recordSarprasBmhpTransaction(payload);
        if (res.success) {
            showToast('Sukses', res.message || 'Mutasi stok berhasil dicatat', 'success');
            window.closeBmhpTrxModal();
            await loadBmhpData();
        } else {
            throw new Error(res.error || 'Gagal mencatat mutasi stok');
        }
    } catch (err) {
        console.error('[SarprasPenggunaan] Trx error:', err);
        showToast('Error', err.message || 'Gagal memproses mutasi stok', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}

// =========================================================================
// 8. Modal Handlers: Riwayat Mutasi BMHP
// =========================================================================

window.openBmhpHistoryModal = async function () {
    const modal = document.getElementById('modal-bmhp-history');
    const tbody = document.getElementById('table-bmhp-history-body');
    if (!modal) return;

    modal.classList.remove('hidden');

    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-400">Memuat log transaksi mutasi...</td></tr>';
        try {
            const trxs = await cfClient.getSarprasBmhpTransactions({});
            if (trxs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-400">Belum ada riwayat transaksi mutasi stok</td></tr>';
                return;
            }

            tbody.innerHTML = trxs.map(t => {
                const isOut = t.trx_type === 'out';
                const badge = isOut
                    ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">Keluar</span>'
                    : '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">Masuk</span>';

                return `
                    <tr class="hover:bg-slate-50 dark:hover:bg-slate-800">
                        <td class="p-2 whitespace-nowrap text-slate-400">${formatDateDisplay(t.created_at)}</td>
                        <td class="p-2 font-bold text-slate-800 dark:text-white">${escapeHtml(t.item_name)}</td>
                        <td class="p-2 text-center">${badge}</td>
                        <td class="p-2 text-center font-bold text-slate-700 dark:text-slate-200">${t.quantity}</td>
                        <td class="p-2 text-slate-600 dark:text-slate-300">${escapeHtml(t.requester_name || t.pic_name || '-')}</td>
                        <td class="p-2 text-slate-400 text-[11px]">${escapeHtml(t.notes || '-')}</td>
                    </tr>
                `;
            }).join('');
        } catch (err) {
            console.error('[SarprasPenggunaan] Load trx history error:', err);
            tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-rose-500 font-semibold">Gagal memuat log transaksi</td></tr>';
        }
    }
};

window.closeBmhpHistoryModal = function () {
    const modal = document.getElementById('modal-bmhp-history');
    if (modal) modal.classList.add('hidden');
};

import cfClient from './cloudflare-client.js';
import { SCHOOL_CONFIG } from './school-config.js';
import { mountMasterSarprasAssets } from './sarpras-master-assets.js';

// State Module
let allRooms = [];
let currentRoomFilter = '';
let currentCategoryFilter = '';
let currentConditionFilter = 'all';
let currentSearch = '';
let currentPage = 1;
const itemsPerPage = 25;
let totalRecords = 0;
let currentItems = [];
let searchDebounceTimeout = null;

// Helper Format Rupiah
function formatRupiah(num) {
    const val = Number(num || 0);
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0
    }).format(val);
}

// Helper Escape HTML
function escapeHTML(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Cek Wewenang Pengelola Sarpras (Super Admin, Waka Sarpras, Admin Sarpras)
function isSarprasManager() {
    if (typeof window.hasRole === 'function') {
        return window.hasRole('super_admin') || window.hasRole('sarpras') || window.hasRole('admin_sarpras');
    }
    const role = localStorage.getItem('user_role');
    return ['super_admin', 'sarpras', 'admin_sarpras'].includes(role);
}

// Inisialisasi Tampilan Berdasarkan Wewenang
function applyRbacUi() {
    const isManager = isSarprasManager();
    const btnCreate = document.getElementById('btn-open-create-modal');
    const btnRooms = document.getElementById('btn-manage-rooms');

    if (btnCreate) {
        if (isManager) btnCreate.classList.remove('hidden');
        else btnCreate.classList.add('hidden');
    }
    if (btnRooms) {
        if (isManager) btnRooms.classList.remove('hidden');
        else btnRooms.classList.add('hidden');
    }

    // Update Header Identitas
    const headerUserName = document.getElementById('header-user-name');
    if (headerUserName) {
        const userName = localStorage.getItem('user_name') || "Civitas SMANTARA";
        const userRole = localStorage.getItem('user_role') || 'Pengguna';
        headerUserName.textContent = `${userName} (${userRole})`;
    }

    const headerDate = document.getElementById('header-date-display');
    if (headerDate) {
        const now = new Date();
        const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Makassar' };
        headerDate.textContent = now.toLocaleDateString('id-ID', options) + ' WITA';
    }
}

// 1. Pemuatan Master Ruangan
async function loadRooms() {
    try {
        const rooms = await cfClient.getSarprasRooms();
        allRooms = Array.isArray(rooms) ? rooms : [];

        // Populate Dropdown Filter
        const selectFilter = document.getElementById('select-room-filter');
        const formRoomSelect = document.getElementById('form-item-room');

        if (selectFilter) {
            let filterHtml = '<option value="">-- Seluruh Ruangan (Global) --</option>';
            allRooms.forEach(r => {
                const gedung = r.gedung ? ` (${escapeHTML(r.gedung)})` : '';
                filterHtml += `<option value="${escapeHTML(r.id)}">${escapeHTML(r.kode)} - ${escapeHTML(r.nama)}${gedung}</option>`;
            });
            selectFilter.innerHTML = filterHtml;
            if (currentRoomFilter) selectFilter.value = currentRoomFilter;
        }

        if (formRoomSelect) {
            let formHtml = '<option value="">-- Pilih Ruangan --</option>';
            allRooms.forEach(r => {
                formHtml += `<option value="${escapeHTML(r.id)}">${escapeHTML(r.kode)} - ${escapeHTML(r.nama)}</option>`;
            });
            formRoomSelect.innerHTML = formHtml;
        }

        renderRoomsList();
    } catch (err) {
        console.error('[Sarpras] Gagal memuat ruangan:', err);
    }
}

// Render Tabel Master Ruangan di Modal
function renderRoomsList() {
    const tbody = document.getElementById('rooms-list-body');
    if (!tbody) return;

    if (allRooms.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-slate-400">Belum ada ruangan terdaftar</td></tr>';
        return;
    }

    const isManager = isSarprasManager();
    let html = '';
    allRooms.forEach(r => {
        html += `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                <td class="py-2 px-3 font-mono font-bold text-amber-600 dark:text-amber-400">${escapeHTML(r.kode)}</td>
                <td class="py-2 px-3 font-medium text-slate-800 dark:text-slate-200">${escapeHTML(r.nama)}</td>
                <td class="py-2 px-3 text-slate-500 capitalize">${escapeHTML(r.kategori_ruang || '-')}</td>
                <td class="py-2 px-3 text-slate-500">${escapeHTML(r.gedung || '-')}</td>
                <td class="py-2 px-3 text-right">
                    ${isManager ? `
                        <button type="button" onclick="window.editRoom('${escapeHTML(r.id)}')" class="p-1 text-slate-400 hover:text-amber-500 transition mr-1" title="Edit Ruangan">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button type="button" onclick="window.deleteRoom('${escapeHTML(r.id)}')" class="p-1 text-slate-400 hover:text-rose-500 transition" title="Hapus Ruangan">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    ` : '<span class="text-slate-400">-</span>'}
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
}

// 2. Pemuatan Data Inventaris & Ringkasan KPI
async function loadSarprasData() {
    const tbody = document.getElementById('inventory-table-body');
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="p-8 text-center text-slate-400 dark:text-slate-500">
                    <i class="fa-solid fa-circle-notch fa-spin text-2xl text-emerald-500 mb-2"></i>
                    <p class="text-xs">Memuat katalog aset sarpras...</p>
                </td>
            </tr>
        `;
    }

    try {
        // Ambil ringkasan KPI dan data inventaris secara paralel
        const offset = (currentPage - 1) * itemsPerPage;
        const [summary, invRes] = await Promise.all([
            cfClient.getSarprasInventorySummary(currentRoomFilter || null),
            cfClient.getSarprasInventory({
                room_id: currentRoomFilter || undefined,
                category_name: currentCategoryFilter || undefined,
                condition: currentConditionFilter !== 'all' ? currentConditionFilter : undefined,
                search: currentSearch || undefined,
                limit: itemsPerPage,
                offset
            })
        ]);

        // Render KPI
        renderKpi(summary);

        // Update Info Banner Ruangan
        updateRoomBanner();

        // Render Tabel Data
        currentItems = Array.isArray(invRes?.data) ? invRes.data : [];
        totalRecords = Number(invRes?.total || 0);
        renderInventoryTable(currentItems);
        renderPagination();

    } catch (err) {
        console.error('[Sarpras] Gagal memuat data inventaris:', err);
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" class="p-8 text-center text-rose-500">
                        <i class="fa-solid fa-triangle-exclamation text-2xl mb-2"></i>
                        <p class="text-xs font-semibold">Gagal memuat data aset: ${escapeHTML(err.message || 'Terjadi kesalahan sistem.')}</p>
                    </td>
                </tr>
            `;
        }
    }
}

// Render KPI Cards
function renderKpi(summary) {
    const s = summary || {};
    const elItems = document.getElementById('kpi-total-items');
    const elUnits = document.getElementById('kpi-total-units');
    const elGood = document.getElementById('kpi-total-good');
    const elMinor = document.getElementById('kpi-total-minor');
    const elMajor = document.getElementById('kpi-total-major');
    const elValue = document.getElementById('kpi-total-value');

    if (elItems) elItems.textContent = (s.total_items || 0).toLocaleString('id-ID');
    if (elUnits) elUnits.textContent = `${(s.total_units || 0).toLocaleString('id-ID')} Unit`;
    if (elGood) elGood.textContent = (s.total_good || 0).toLocaleString('id-ID');
    if (elMinor) elMinor.textContent = (s.total_minor_damage || 0).toLocaleString('id-ID');
    if (elMajor) elMajor.textContent = (s.total_major_damage || 0).toLocaleString('id-ID');
    if (elValue) elValue.textContent = formatRupiah(s.total_estimated_value || 0);
}

// Update Banner Ruangan Terpilih
function updateRoomBanner() {
    const badge = document.getElementById('active-room-badge');
    const title = document.getElementById('active-room-title');
    const subtext = document.getElementById('active-room-subtext');

    if (!currentRoomFilter) {
        if (badge) badge.textContent = 'SELURUH RUANGAN';
        if (title) title.textContent = 'Semua Ruang & Fasilitas Sekolah';
        if (subtext) subtext.textContent = "Memuat seluruh aset sarana dan prasarana terdaftar di SMA Negeri Nusantara.";
        return;
    }

    const room = allRooms.find(r => r.id === currentRoomFilter);
    if (room) {
        if (badge) badge.textContent = room.kode;
        if (title) title.textContent = room.nama;
        const pj = room.penanggung_jawab_nama ? `PJ: ${room.penanggung_jawab_nama}` : 'PJ: Waka Sarpras';
        const gedung = room.gedung ? ` | Gedung: ${room.gedung}` : '';
        if (subtext) subtext.textContent = `${pj}${gedung} | Kategori: ${room.kategori_ruang || 'Umum'}`;
    }
}

// Render Tabel Inventaris
function renderInventoryTable(items) {
    const tbody = document.getElementById('inventory-table-body');
    if (!tbody) return;

    if (!items || items.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="p-8 text-center text-slate-400 dark:text-slate-500">
                    <i class="fa-solid fa-box-open text-2xl mb-2 text-slate-300 dark:text-slate-600"></i>
                    <p class="text-xs">Tidak ada data aset inventaris yang sesuai dengan filter.</p>
                </td>
            </tr>
        `;
        return;
    }

    const isManager = isSarprasManager();
    const startIndex = (currentPage - 1) * itemsPerPage;
    let html = '';

    items.forEach((item, idx) => {
        const no = startIndex + idx + 1;
        const brand = item.brand_model ? `<span class="text-slate-500"> (${escapeHTML(item.brand_model)})</span>` : '';
        const spec = item.specification ? `<p class="text-[11px] text-slate-400 mt-0.5 line-clamp-1">${escapeHTML(item.specification)}</p>` : '';
        const roomName = item.room_name ? escapeHTML(item.room_name) : '-';
        const price = item.price_per_unit ? formatRupiah(item.price_per_unit) : '-';

        // Badge Kondisi
        const goodBadge = item.qty_good > 0 ? `<span class="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 font-bold text-[10px]" title="Kondisi Baik">B: ${item.qty_good}</span>` : '';
        const minorBadge = item.qty_minor_damage > 0 ? `<span class="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 font-bold text-[10px]" title="Rusak Ringan">RR: ${item.qty_minor_damage}</span>` : '';
        const majorBadge = item.qty_major_damage > 0 ? `<span class="px-1.5 py-0.5 rounded bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60 font-bold text-[10px]" title="Rusak Berat">RB: ${item.qty_major_damage}</span>` : '';

        html += `
            <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition">
                <td class="py-2.5 px-3.5 sm:px-4 text-center text-slate-400 font-mono">${no}</td>
                <td class="py-2.5 px-3.5 sm:px-4">
                    <span class="font-mono font-bold text-slate-900 dark:text-white text-xs block">${escapeHTML(item.inventory_code)}</span>
                    ${item.is_loanable ? '<span class="inline-block mt-0.5 px-1.5 py-0.2 rounded bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 text-[10px] font-semibold border border-indigo-200/60"><i class="fa-solid fa-hand-holding-hand text-[9px]"></i> Dapat Dipinjam</span>' : ''}
                </td>
                <td class="py-2.5 px-3.5 sm:px-4">
                    <span class="font-bold text-slate-800 dark:text-slate-100">${escapeHTML(item.name)}</span>${brand}
                    ${spec}
                </td>
                <td class="py-2.5 px-3.5 sm:px-4 text-slate-700 dark:text-slate-300 font-medium">
                    <i class="fa-solid fa-door-open text-xs text-emerald-500 mr-1"></i>
                    ${roomName}
                </td>
                <td class="py-2.5 px-3.5 sm:px-4 text-slate-600 dark:text-slate-400">
                    <span class="px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold text-[11px] border border-slate-200 dark:border-slate-700">${escapeHTML(item.category_name || 'Umum')}</span>
                </td>
                <td class="py-2.5 px-3.5 sm:px-4 text-center">
                    <div class="flex items-center justify-center gap-1 flex-wrap">
                        ${goodBadge}
                        ${minorBadge}
                        ${majorBadge}
                    </div>
                    <div class="text-[10px] text-slate-400 mt-0.5 font-semibold">Total: ${item.qty_total} ${escapeHTML(item.unit || 'Unit')}</div>
                </td>
                <td class="py-2.5 px-3.5 sm:px-4 text-slate-600 dark:text-slate-400 text-xs">
                    <span class="font-bold text-slate-700 dark:text-slate-200">${item.acquisition_year}</span>
                    <span class="block text-[10px] text-slate-400">${escapeHTML(item.funding_source || '-')}</span>
                </td>
                <td class="py-2.5 px-3.5 sm:px-4 text-right font-mono font-semibold text-slate-700 dark:text-slate-300">
                    ${price}
                </td>
                <td class="py-2.5 px-3.5 sm:px-4 text-center">
                    <div class="flex items-center justify-center gap-1">
                        <button type="button" onclick="window.openItemDetail('${escapeHTML(item.id)}')" class="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition" title="Lihat Detail & Riwayat">
                            <i class="fa-solid fa-eye text-xs"></i>
                        </button>
                        ${isManager ? `
                            <button type="button" onclick="window.openConditionModal('${escapeHTML(item.id)}')" class="p-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 transition" title="Ubah Kondisi Fisik">
                                <i class="fa-solid fa-wrench text-xs"></i>
                            </button>
                            <button type="button" onclick="window.openEditItemModal('${escapeHTML(item.id)}')" class="p-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/60 text-amber-600 dark:text-amber-400 transition" title="Edit Barang">
                                <i class="fa-solid fa-pen-to-square text-xs"></i>
                            </button>
                            <button type="button" onclick="window.deleteItem('${escapeHTML(item.id)}')" class="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 transition" title="Hapus Barang">
                                <i class="fa-solid fa-trash text-xs"></i>
                            </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

// Render Kontrol Pagination
function renderPagination() {
    const elInfo = document.getElementById('pagination-info');
    const elPage = document.getElementById('current-page-display');
    const btnPrev = document.getElementById('btn-prev-page');
    const btnNext = document.getElementById('btn-next-page');

    const totalPages = Math.ceil(totalRecords / itemsPerPage) || 1;
    const startItem = totalRecords === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
    const endItem = Math.min(currentPage * itemsPerPage, totalRecords);

    if (elInfo) elInfo.textContent = `Menampilkan ${startItem}-${endItem} dari ${totalRecords.toLocaleString('id-ID')} data aset`;
    if (elPage) elPage.textContent = `${currentPage} / ${totalPages}`;
    if (btnPrev) btnPrev.disabled = currentPage <= 1;
    if (btnNext) btnNext.disabled = currentPage >= totalPages;
}

// 3. Filter Handlers
function handleRoomFilterChange(val) {
    currentRoomFilter = val || '';
    currentPage = 1;
    loadSarprasData();
}

function handleCategoryFilterChange(val) {
    currentCategoryFilter = val || '';
    currentPage = 1;
    loadSarprasData();
}

function handleConditionFilterChange(val) {
    currentConditionFilter = val || 'all';
    currentPage = 1;
    loadSarprasData();
}

function handleSearchInput(val) {
    clearTimeout(searchDebounceTimeout);
    searchDebounceTimeout = setTimeout(() => {
        currentSearch = (val || '').trim();
        currentPage = 1;
        loadSarprasData();
    }, 350);
}

function resetSarprasFilter() {
    currentRoomFilter = '';
    currentCategoryFilter = '';
    currentConditionFilter = 'all';
    currentSearch = '';
    currentPage = 1;

    const selectRoom = document.getElementById('select-room-filter');
    const selectCat = document.getElementById('select-category-filter');
    const selectCond = document.getElementById('select-condition-filter');
    const inputSearch = document.getElementById('input-search');

    if (selectRoom) selectRoom.value = '';
    if (selectCat) selectCat.value = '';
    if (selectCond) selectCond.value = 'all';
    if (inputSearch) inputSearch.value = '';

    loadSarprasData();
}

function changePage(direction) {
    const totalPages = Math.ceil(totalRecords / itemsPerPage) || 1;
    const newPage = currentPage + direction;
    if (newPage >= 1 && newPage <= totalPages) {
        currentPage = newPage;
        loadSarprasData();
    }
}

// 4. Modal Helper
function openModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.remove('hidden');
}

function closeModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.add('hidden');
}

// 5. Form Tambah / Edit Aset Inventaris
function calcFormTotalQty() {
    const g = parseInt(document.getElementById('form-item-qty-good')?.value || 0, 10);
    const mn = parseInt(document.getElementById('form-item-qty-minor')?.value || 0, 10);
    const mj = parseInt(document.getElementById('form-item-qty-major')?.value || 0, 10);
    const total = (isNaN(g) ? 0 : g) + (isNaN(mn) ? 0 : mn) + (isNaN(mj) ? 0 : mj);
    const preview = document.getElementById('form-item-total-preview');
    if (preview) preview.textContent = `Total: ${total} Unit`;
}

function openCreateItemModal() {
    const form = document.getElementById('form-item');
    if (form) form.reset();
    document.getElementById('form-item-id').value = '';
    document.getElementById('modal-item-title').textContent = 'Tambah Aset Sarpras Baru';

    // Set default ruangan jika sedang memfilter ruangan tertentu
    if (currentRoomFilter) {
        const roomSelect = document.getElementById('form-item-room');
        if (roomSelect) roomSelect.value = currentRoomFilter;
    }

    const yearInput = document.getElementById('form-item-year');
    if (yearInput) yearInput.value = new Date().getFullYear();

    calcFormTotalQty();
    openModal('modal-item');
}

function openEditItemModal(itemId) {
    const item = currentItems.find(i => i.id === itemId);
    if (!item) return;

    document.getElementById('form-item-id').value = item.id;
    document.getElementById('modal-item-title').textContent = `Edit Aset: ${item.name}`;

    document.getElementById('form-item-room').value = item.room_id || '';
    document.getElementById('form-item-category').value = item.category_name || 'Perabot';
    document.getElementById('form-item-name').value = item.name || '';
    document.getElementById('form-item-code').value = item.inventory_code || '';
    document.getElementById('form-item-brand').value = item.brand_model || '';
    document.getElementById('form-item-serial').value = item.serial_number || '';
    document.getElementById('form-item-spec').value = item.specification || '';
    document.getElementById('form-item-unit').value = item.unit || 'Unit';
    document.getElementById('form-item-year').value = item.acquisition_year || new Date().getFullYear();
    document.getElementById('form-item-funding').value = item.funding_source || 'BOS Reguler';
    document.getElementById('form-item-price').value = item.price_per_unit || 0;
    document.getElementById('form-item-loanable').checked = Boolean(item.is_loanable);
    document.getElementById('form-item-notes').value = item.notes || '';

    document.getElementById('form-item-qty-good').value = item.qty_good;
    document.getElementById('form-item-qty-minor').value = item.qty_minor_damage;
    document.getElementById('form-item-qty-major').value = item.qty_major_damage;

    calcFormTotalQty();
    openModal('modal-item');
}

async function submitItemForm(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-save-item');
    if (btn) btn.disabled = true;

    try {
        const id = document.getElementById('form-item-id').value.trim();
        const isEdit = Boolean(id);

        const payload = {
            room_id: document.getElementById('form-item-room').value.trim(),
            category_name: document.getElementById('form-item-category').value.trim(),
            name: document.getElementById('form-item-name').value.trim(),
            inventory_code: document.getElementById('form-item-code').value.trim(),
            brand_model: document.getElementById('form-item-brand').value.trim(),
            serial_number: document.getElementById('form-item-serial').value.trim(),
            specification: document.getElementById('form-item-spec').value.trim(),
            unit: document.getElementById('form-item-unit').value.trim() || 'Unit',
            acquisition_year: parseInt(document.getElementById('form-item-year').value, 10),
            funding_source: document.getElementById('form-item-funding').value.trim(),
            price_per_unit: parseFloat(document.getElementById('form-item-price').value) || 0,
            is_loanable: document.getElementById('form-item-loanable').checked ? 1 : 0,
            notes: document.getElementById('form-item-notes').value.trim(),
            qty_good: parseInt(document.getElementById('form-item-qty-good').value, 10) || 0,
            qty_minor_damage: parseInt(document.getElementById('form-item-qty-minor').value, 10) || 0,
            qty_major_damage: parseInt(document.getElementById('form-item-qty-major').value, 10) || 0
        };

        if (isEdit) {
            await cfClient.saveSarprasInventoryItem(payload, true, id);
            if (typeof window.showToast === 'function') window.showToast('Sukses', 'Aset inventaris berhasil diperbarui', 'success');
        } else {
            await cfClient.saveSarprasInventoryItem(payload, false);
            if (typeof window.showToast === 'function') window.showToast('Sukses', 'Aset baru berhasil ditambahkan', 'success');
        }

        closeModal('modal-item');
        loadSarprasData();
    } catch (err) {
        console.error('[Sarpras] Gagal menyimpan barang:', err);
        if (typeof window.showToast === 'function') {
            window.showToast('Gagal', err.message || 'Gagal menyimpan data aset', 'error');
        } else {
            alert('Gagal: ' + (err.message || 'Gagal menyimpan'));
        }
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function deleteItem(itemId) {
    const item = currentItems.find(i => i.id === itemId);
    const itemName = item ? item.name : 'Aset';
    if (!confirm(`Apakah Anda yakin ingin menghapus aset "${itemName}"? Seluruh riwayat kondisi barang ini juga akan dihapus.`)) {
        return;
    }

    try {
        await cfClient.deleteSarprasInventoryItem(itemId);
        if (typeof window.showToast === 'function') window.showToast('Terhapus', `Aset "${itemName}" berhasil dihapus`, 'success');
        loadSarprasData();
    } catch (err) {
        console.error('[Sarpras] Gagal menghapus aset:', err);
        if (typeof window.showToast === 'function') window.showToast('Gagal', err.message || 'Gagal menghapus aset', 'error');
    }
}

// 6. Master Ruangan Handlers
function openRoomsModal() {
    resetRoomForm();
    renderRoomsList();
    openModal('modal-rooms');
}

function resetRoomForm() {
    const form = document.getElementById('form-room');
    if (form) form.reset();
    document.getElementById('form-room-id').value = '';
    document.getElementById('form-room-title').textContent = 'Tambah Ruangan Baru';
    const btnCancel = document.getElementById('btn-cancel-edit-room');
    if (btnCancel) btnCancel.classList.add('hidden');
}

function editRoom(roomId) {
    const room = allRooms.find(r => r.id === roomId);
    if (!room) return;

    document.getElementById('form-room-id').value = room.id;
    document.getElementById('form-room-code').value = room.kode || '';
    document.getElementById('form-room-name').value = room.nama || '';
    document.getElementById('form-room-category').value = room.kategori_ruang || 'kelas';
    document.getElementById('form-room-building').value = room.gedung || '';
    document.getElementById('form-room-pic').value = room.penanggung_jawab_nama || '';

    document.getElementById('form-room-title').textContent = `Edit Ruangan: ${room.nama}`;
    const btnCancel = document.getElementById('btn-cancel-edit-room');
    if (btnCancel) btnCancel.classList.remove('hidden');
}

async function submitRoomForm(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-save-room');
    if (btn) btn.disabled = true;

    try {
        const id = document.getElementById('form-room-id').value.trim();
        const isEdit = Boolean(id);

        const payload = {
            kode: document.getElementById('form-room-code').value.trim().toUpperCase(),
            nama: document.getElementById('form-room-name').value.trim(),
            kategori_ruang: document.getElementById('form-room-category').value.trim(),
            gedung: document.getElementById('form-room-building').value.trim(),
            penanggung_jawab_nama: document.getElementById('form-room-pic').value.trim()
        };

        if (isEdit) {
            await cfClient.saveSarprasRoom(payload, true, id);
            if (typeof window.showToast === 'function') window.showToast('Sukses', 'Ruangan berhasil diperbarui', 'success');
        } else {
            await cfClient.saveSarprasRoom(payload, false);
            if (typeof window.showToast === 'function') window.showToast('Sukses', 'Ruangan baru berhasil ditambahkan', 'success');
        }

        resetRoomForm();
        await loadRooms();
    } catch (err) {
        console.error('[Sarpras] Gagal menyimpan ruangan:', err);
        if (typeof window.showToast === 'function') window.showToast('Gagal', err.message || 'Gagal menyimpan ruangan', 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function deleteRoom(roomId) {
    const room = allRooms.find(r => r.id === roomId);
    const roomName = room ? room.nama : 'Ruangan';
    if (!confirm(`Hapus ruangan "${roomName}"? Pastikan tidak ada aset yang tertaut pada ruangan ini.`)) {
        return;
    }

    try {
        await cfClient.deleteSarprasRoom(roomId);
        if (typeof window.showToast === 'function') window.showToast('Sukses', `Ruangan "${roomName}" berhasil dihapus`, 'success');
        await loadRooms();
        if (currentRoomFilter === roomId) {
            currentRoomFilter = '';
            loadSarprasData();
        }
    } catch (err) {
        console.error('[Sarpras] Gagal menghapus ruangan:', err);
        if (typeof window.showToast === 'function') window.showToast('Gagal', err.message || 'Gagal menghapus ruangan', 'error');
    }
}

// 7. Ubah Kondisi Fisik Barang
function openConditionModal(itemId) {
    const item = currentItems.find(i => i.id === itemId);
    if (!item) return;

    document.getElementById('form-cond-item-id').value = item.id;
    document.getElementById('form-cond-item-name').textContent = item.name;
    document.getElementById('form-cond-item-code').textContent = item.inventory_code;

    const stocks = document.getElementById('form-cond-current-stocks');
    if (stocks) {
        stocks.innerHTML = `
            <span class="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 font-bold">Baik (B): ${item.qty_good}</span>
            <span class="px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-600 font-bold">Rusak Ringan (RR): ${item.qty_minor_damage}</span>
            <span class="px-2 py-0.5 rounded bg-rose-50 dark:bg-rose-950/40 text-rose-600 font-bold">Rusak Berat (RB): ${item.qty_major_damage}</span>
        `;
    }

    document.getElementById('form-cond-qty').value = 1;
    document.getElementById('form-cond-notes').value = '';
    openModal('modal-condition');
}

async function submitConditionForm(e) {
    e.preventDefault();
    const itemId = document.getElementById('form-cond-item-id').value;
    const fromCond = document.getElementById('form-cond-from').value;
    const toCond = document.getElementById('form-cond-to').value;
    const qty = parseInt(document.getElementById('form-cond-qty').value, 10);
    const notes = document.getElementById('form-cond-notes').value.trim();

    if (fromCond === toCond) {
        if (typeof window.showToast === 'function') window.showToast('Peringatan', 'Kondisi asal dan tujuan tidak boleh sama', 'warning');
        return;
    }

    try {
        await cfClient.changeSarprasInventoryCondition(itemId, {
            from_condition: fromCond,
            to_condition: toCond,
            quantity: qty,
            notes
        });

        if (typeof window.showToast === 'function') window.showToast('Sukses', 'Kondisi fisik aset berhasil diperbarui', 'success');
        closeModal('modal-condition');
        loadSarprasData();
    } catch (err) {
        console.error('[Sarpras] Gagal ubah kondisi:', err);
        if (typeof window.showToast === 'function') window.showToast('Gagal', err.message || 'Gagal mengubah kondisi', 'error');
    }
}

// 8. Detail Aset & Riwayat
async function openItemDetail(itemId) {
    const item = currentItems.find(i => i.id === itemId);
    if (!item) return;

    const card = document.getElementById('detail-card-content');
    if (card) {
        card.innerHTML = `
            <div class="bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700/60 space-y-2">
                <div class="flex items-center justify-between">
                    <span class="font-mono font-bold text-xs text-emerald-600 dark:text-emerald-400">${escapeHTML(item.inventory_code)}</span>
                    <span class="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-[10px] font-bold">${escapeHTML(item.category_name || 'Umum')}</span>
                </div>
                <h3 class="text-base font-bold text-slate-800 dark:text-white">${escapeHTML(item.name)}</h3>
                ${item.brand_model ? `<p class="text-xs text-slate-500">Merk / Model: <b>${escapeHTML(item.brand_model)}</b></p>` : ''}
                ${item.serial_number ? `<p class="text-xs text-slate-500 font-mono">SN: <b>${escapeHTML(item.serial_number)}</b></p>` : ''}
                ${item.specification ? `<p class="text-xs text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 p-2 rounded border border-slate-200 dark:border-slate-800">${escapeHTML(item.specification)}</p>` : ''}
                <div class="grid grid-cols-2 gap-2 text-xs text-slate-500 pt-1 border-t border-slate-200 dark:border-slate-700/40">
                    <div>Ruangan: <b class="text-slate-800 dark:text-slate-200">${escapeHTML(item.room_name || '-')}</b></div>
                    <div>Tahun / Sumber: <b class="text-slate-800 dark:text-slate-200">${item.acquisition_year} (${escapeHTML(item.funding_source || '-')})</b></div>
                    <div>Harga Satuan: <b class="text-slate-800 dark:text-slate-200">${formatRupiah(item.price_per_unit || 0)}</b></div>
                    <div>Dapat Dipinjam: <b class="${item.is_loanable ? 'text-emerald-600' : 'text-slate-400'}">${item.is_loanable ? 'Ya (Bisa Keluar Ruang)' : 'Tidak (Aset Tetap Ruang)'}</b></div>
                </div>
            </div>
            <div class="grid grid-cols-3 gap-2 text-center text-xs">
                <div class="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 font-bold text-emerald-700 dark:text-emerald-300">
                    <p class="text-[10px] uppercase">Baik</p>
                    <p class="text-base">${item.qty_good}</p>
                </div>
                <div class="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 font-bold text-amber-700 dark:text-amber-300">
                    <p class="text-[10px] uppercase">Rusak Ringan</p>
                    <p class="text-base">${item.qty_minor_damage}</p>
                </div>
                <div class="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 font-bold text-rose-700 dark:text-rose-300">
                    <p class="text-[10px] uppercase">Rusak Berat</p>
                    <p class="text-base">${item.qty_major_damage}</p>
                </div>
            </div>
        `;
    }

    const histList = document.getElementById('detail-history-list');
    if (histList) {
        histList.innerHTML = '<p class="text-xs text-slate-400 text-center py-2">Memuat riwayat kondisi...</p>';
        try {
            const history = await cfClient.getSarprasInventoryHistory(item.id);
            if (!history || history.length === 0) {
                histList.innerHTML = '<p class="text-xs text-slate-400 text-center py-2">Belum ada riwayat mutasi kondisi fisik.</p>';
            } else {
                let hHtml = '';
                const condLabel = { good: 'Baik', minor_damage: 'Rusak Ringan', major_damage: 'Rusak Berat' };
                history.forEach(h => {
                    hHtml += `
                        <div class="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 text-xs">
                            <div class="flex items-center justify-between text-slate-400 text-[10px]">
                                <span>${h.created_at || '-'}</span>
                                <span>Oleh: <b>${escapeHTML(h.user_name || 'Petugas')}</b></span>
                            </div>
                            <p class="font-bold text-slate-700 dark:text-slate-300 mt-0.5">
                                ${h.quantity} unit: <span class="text-amber-500">${condLabel[h.from_condition] || h.from_condition}</span> &rarr; <span class="text-emerald-500">${condLabel[h.to_condition] || h.to_condition}</span>
                            </p>
                            ${h.notes ? `<p class="text-slate-500 italic mt-0.5">"${escapeHTML(h.notes)}"</p>` : ''}
                        </div>
                    `;
                });
                histList.innerHTML = hHtml;
            }
        } catch (eH) {
            histList.innerHTML = '<p class="text-xs text-rose-400 text-center py-2">Gagal memuat riwayat.</p>';
        }
    }

    openModal('modal-detail');
}

// 9. Cetak Lembar KIR Resmi A4
async function openKirPrintModal() {
    if (!currentRoomFilter) {
        if (typeof window.showToast === 'function') {
            window.showToast('Pilih Ruangan', 'Silakan pilih ruangan spesifik terlebih dahulu pada dropdown filter untuk mencetak lembar KIR.', 'info');
        } else {
            alert('Silakan pilih ruangan spesifik terlebih dahulu untuk mencetak lembar KIR.');
        }
        return;
    }

    try {
        const kirRes = await cfClient.getSarprasKirData(currentRoomFilter);
        const data = kirRes?.data || {};
        const room = data.room || {};
        const items = data.items || [];

        // Update Header Data KIR
        document.getElementById('kir-print-room-name').textContent = room.nama || '-';
        document.getElementById('kir-print-room-code').textContent = room.kode || '-';
        document.getElementById('kir-print-building').textContent = room.gedung || 'Gedung Sekolah';
        document.getElementById('kir-print-room-pic').textContent = room.penanggung_jawab_nama || "Waka Sarpras SMANTARA";

        // Update Tabel KIR
        const tbody = document.getElementById('kir-print-table-body');
        if (tbody) {
            if (items.length === 0) {
                tbody.innerHTML = '<tr><td colspan="9" class="p-4 text-center text-slate-400 italic">Ruangan ini belum memuat catatan barang inventaris.</td></tr>';
            } else {
                let html = '';
                items.forEach((item, idx) => {
                    const brand = item.brand_model ? ` ${item.brand_model}` : '';
                    const spec = item.specification ? ` / ${item.specification}` : '';
                    html += `
                        <tr class="border-b border-slate-300 text-slate-800">
                            <td class="border border-slate-400 py-1 px-1.5 text-center">${idx + 1}</td>
                            <td class="border border-slate-400 py-1 px-2 font-bold">${escapeHTML(item.name)}</td>
                            <td class="border border-slate-400 py-1 px-2">${escapeHTML(brand + spec)}</td>
                            <td class="border border-slate-400 py-1 px-2 font-mono">${escapeHTML(item.inventory_code)}</td>
                            <td class="border border-slate-400 py-1 px-1 text-center font-bold">${item.qty_total}</td>
                            <td class="border border-slate-400 py-1 px-1 text-center text-emerald-700">${item.qty_good}</td>
                            <td class="border border-slate-400 py-1 px-1 text-center text-amber-700">${item.qty_minor_damage}</td>
                            <td class="border border-slate-400 py-1 px-1 text-center text-rose-700">${item.qty_major_damage}</td>
                            <td class="border border-slate-400 py-1 px-2 text-center">${item.acquisition_year} / ${escapeHTML(item.funding_source || '-')}</td>
                        </tr>
                    `;
                });
                tbody.innerHTML = html;
            }
        }

        // Tanggal dan Pejabat Pengesahan
        const now = new Date();
        const options = { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Makassar' };
        document.getElementById('kir-print-date').textContent = `Denpasar, ${now.toLocaleDateString('id-ID', options)}`;

        if (SCHOOL_CONFIG && SCHOOL_CONFIG.headmasterName) {
            document.getElementById('kir-print-kepsek-name').textContent = SCHOOL_CONFIG.headmasterName;
        }
        if (SCHOOL_CONFIG && SCHOOL_CONFIG.headmasterNIP) {
            document.getElementById('kir-print-kepsek-nip').textContent = `NIP. ${SCHOOL_CONFIG.headmasterNIP}`;
        }

        if (room.penanggung_jawab_nama) {
            document.getElementById('kir-print-waka-name').textContent = room.penanggung_jawab_nama;
        } else {
            document.getElementById('kir-print-waka-name').textContent = 'Waka Bidang Sarpras';
        }

        openModal('modal-print-kir');
    } catch (err) {
        console.error('[Sarpras] Gagal mengambil data KIR:', err);
        if (typeof window.showToast === 'function') window.showToast('Gagal', 'Gagal memuat data KIR ruangan', 'error');
    }
}

function printCurrentRoomKir() {
    openKirPrintModal();
}

function printKirArea() {
    window.print();
}

// 10. Cetak Label Barcode / QR Code Fisik
async function openQrPrintModal() {
    const itemsToPrint = currentItems;
    if (!itemsToPrint || itemsToPrint.length === 0) {
        if (typeof window.showToast === 'function') window.showToast('Tidak Ada Data', 'Tidak ada aset yang terdaftar pada filter aktif saat ini.', 'warning');
        return;
    }

    const grid = document.getElementById('qr-labels-grid');
    if (!grid) return;

    grid.innerHTML = '<p class="text-xs text-slate-400 col-span-3 text-center py-4">Membuat kode QR...</p>';
    openModal('modal-print-qr');

    let html = '';
    itemsToPrint.forEach((item, idx) => {
        const canvasId = `qr-canvas-${idx}`;
        html += `
            <div class="border-2 border-slate-800 p-2.5 rounded-lg bg-white text-slate-900 flex flex-col justify-between text-left shadow-xs">
                <div class="border-b border-slate-300 pb-1 mb-1.5 flex items-center justify-between">
                    <span class="text-[9px] font-black uppercase tracking-wider text-slate-800">SMANTARA SARPRAS</span>
                    <span class="text-[8px] font-mono font-bold text-slate-500">${item.acquisition_year}</span>
                </div>
                <div class="flex items-center gap-2">
                    <canvas id="${canvasId}" class="w-16 h-16 shrink-0 border border-slate-200 p-0.5 rounded"></canvas>
                    <div class="min-w-0 flex-1">
                        <p class="text-[10px] font-mono font-bold text-slate-950 truncate">${escapeHTML(item.inventory_code)}</p>
                        <p class="text-[11px] font-bold text-slate-900 line-clamp-1 leading-tight">${escapeHTML(item.name)}</p>
                        <p class="text-[9px] text-slate-600 truncate mt-0.5"><i class="fa-solid fa-door-open text-[8px]"></i> ${escapeHTML(item.room_name || '-')}</p>
                    </div>
                </div>
            </div>
        `;
    });
    grid.innerHTML = html;

    // Render Canvas QR Code menggunakan pustaka QRCode
    setTimeout(() => {
        itemsToPrint.forEach((item, idx) => {
            const canvas = document.getElementById(`qr-canvas-${idx}`);
            if (canvas && typeof QRCode !== 'undefined') {
                const qrText = `SMANTARA:${item.inventory_code}|${item.name}|${item.room_name || ''}`;
                QRCode.toCanvas(canvas, qrText, { width: 64, margin: 1 }, (err) => {
                    if (err) console.error('Gagal generate QR:', err);
                });
            }
        });
    }, 100);
}

function printQrArea() {
    window.print();
}

// 11. Ekspor Spreadsheet Excel (.xlsx)
function exportSarprasExcel() {
    if (!currentItems || currentItems.length === 0) {
        if (typeof window.showToast === 'function') window.showToast('Data Kosong', 'Tidak ada data untuk diekspor.', 'warning');
        return;
    }

    if (typeof XLSX === 'undefined') {
        alert('Pustaka SheetJS belum termuat.');
        return;
    }

    const rows = currentItems.map((item, idx) => ({
        'No': idx + 1,
        'Kode Inventaris': item.inventory_code,
        'Nama Barang': item.name,
        'Merk / Model': item.brand_model || '-',
        'Nomor Seri': item.serial_number || '-',
        'Spesifikasi': item.specification || '-',
        'Ruangan': item.room_name || '-',
        'Kategori': item.category_name || 'Umum',
        'Kondisi Baik (B)': item.qty_good,
        'Kondisi Rusak Ringan (RR)': item.qty_minor_damage,
        'Kondisi Rusak Berat (RB)': item.qty_major_damage,
        'Total Unit': item.qty_total,
        'Satuan': item.unit || 'Unit',
        'Tahun Perolehan': item.acquisition_year,
        'Sumber Dana': item.funding_source || '-',
        'Harga Satuan (Rp)': item.price_per_unit || 0,
        'Total Nilai (Rp)': (item.qty_total || 0) * (item.price_per_unit || 0),
        'Dapat Dipinjam': item.is_loanable ? 'Ya' : 'Tidak',
        'Catatan': item.notes || '-'
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Inventaris Sarpras');

    const dateStr = new Date().toISOString().split('T')[0];
    const roomPrefix = currentRoomFilter ? `_${currentRoomFilter}` : '';
    XLSX.writeFile(wb, `Katalog_Inventaris_SMANTARA${roomPrefix}_${dateStr}.xlsx`);

    if (typeof window.showToast === 'function') {
        window.showToast('Sukses Ekspor', 'Berkas Excel berhasil diunduh.', 'success');
    }
}

// Register Global Window Handlers (Kepatuhan Audit 6 check-syntax.js)
window.loadSarprasData = loadSarprasData;
window.handleRoomFilterChange = handleRoomFilterChange;
window.handleCategoryFilterChange = handleCategoryFilterChange;
window.handleConditionFilterChange = handleConditionFilterChange;
window.handleSearchInput = handleSearchInput;
window.resetSarprasFilter = resetSarprasFilter;
window.changePage = changePage;
window.openModal = openModal;
window.closeModal = closeModal;
window.calcFormTotalQty = calcFormTotalQty;
window.openCreateItemModal = openCreateItemModal;
window.openEditItemModal = openEditItemModal;
window.submitItemForm = submitItemForm;
window.deleteItem = deleteItem;
window.openRoomsModal = openRoomsModal;
window.resetRoomForm = resetRoomForm;
window.editRoom = editRoom;
window.submitRoomForm = submitRoomForm;
window.deleteRoom = deleteRoom;
window.openConditionModal = openConditionModal;
window.submitConditionForm = submitConditionForm;
window.openItemDetail = openItemDetail;
window.openKirPrintModal = openKirPrintModal;
window.printCurrentRoomKir = printCurrentRoomKir;
window.printKirArea = printKirArea;
window.openQrPrintModal = openQrPrintModal;
window.printQrArea = printQrArea;
window.exportSarprasExcel = exportSarprasExcel;

// Inisialisasi saat Halaman Selesai Dimuat
async function initPage() {
    applyRbacUi();

    // Segera tampilkan konten utama agar tidak blank screen
    const mainEl = document.querySelector('main');
    if (mainEl) mainEl.classList.remove('hidden');

    try {
        await Promise.all([loadRooms(), loadSarprasData()]);
    } catch (err) {
        console.error('[SarprasInventaris] Init error:', err);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPage);
} else {
    initPage();
}

window.switchSarprasInventoryView = async function (view) {
    const assets = view === 'aset';
    document.getElementById('sarpras-inventory-panel')?.classList.toggle('hidden', assets);
    document.getElementById('sarpras-smsr-assets-panel')?.classList.toggle('hidden', !assets);
    document.getElementById('sarpras-inventory-actions')?.classList.toggle('hidden', assets);
    window.history.replaceState(null, '', assets ? '#aset' : '#inventaris');
    for (const tab of ['inventaris', 'aset']) {
        const btn = document.getElementById(`sarpras-tab-${tab}`);
        if (btn) {
            const isCurrent = (tab === 'aset') === assets;
            btn.setAttribute('aria-pressed', String(isCurrent));
            btn.classList.toggle('bg-emerald-600', isCurrent);
            btn.classList.toggle('text-white', isCurrent);
            btn.classList.toggle('shadow-sm', isCurrent);
            btn.classList.toggle('bg-white', !isCurrent);
            btn.classList.toggle('dark:bg-slate-900', !isCurrent);
            btn.classList.toggle('text-slate-600', !isCurrent);
            btn.classList.toggle('dark:text-slate-300', !isCurrent);
        }
    }
    if (assets) {
        try {
            await mountMasterSarprasAssets();
        } catch (error) {
            if (window.showToast) window.showToast('Data aset belum dimuat', error.message, 'warning');
        }
    }
};

if (window.location.hash === '#aset') window.switchSarprasInventoryView('aset');

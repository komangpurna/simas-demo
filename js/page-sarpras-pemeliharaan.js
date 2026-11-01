/**
 * js/page-sarpras-pemeliharaan.js
 * Controller Modul Pemeliharaan Sarpras & Tiket Servis
 * Standar: OWASP Top 10, Cloudflare D1 SSOT, 0 Firestore Read/Write
 */

import cfClient from './cloudflare-client.js';
import { SCHOOL_CONFIG } from './school-config.js';

// --- State Lokal Halaman ---
let currentUser = {
    uid: localStorage.getItem('user_uid') || '',
    name: localStorage.getItem('user_name') || 'Pengguna',
    role: localStorage.getItem('user_role') || 'guest'
};

let activeTab = 'tickets'; // 'tickets' | 'schedules'
let ticketsData = [];
let schedulesData = [];
let roomsList = [];
let inventoryList = [];

// Helper Format Rupiah
function formatRupiah(amount) {
    const val = Number(amount) || 0;
    return 'Rp ' + val.toLocaleString('id-ID');
}

// Helper Format Tanggal
function formatDateIndo(dateStr) {
    if (!dateStr) return '-';
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleDateString('id-ID', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });
    } catch {
        return dateStr;
    }
}

// Cek hak akses pengelola sarpras
function isSarprasManager() {
    const role = currentUser.role;
    return ['admin', 'superadmin', 'sarpras', 'admin_sarpras', 'kepsek'].includes(role) ||
        Boolean(window.hasRole && (window.hasRole('sarpras') || window.hasRole('admin_sarpras') || window.hasRole('admin')));
}

// Inisialisasi Halaman
async function initPage() {
    // Sinkronkan data pengguna terkini
    currentUser.uid = localStorage.getItem('user_uid') || '';
    currentUser.name = localStorage.getItem('user_name') || localStorage.getItem('user_email') || 'Pengguna';
    currentUser.role = localStorage.getItem('user_role') || 'guest';

    // Tampilkan informasi di header
    const nameEl = document.getElementById('header-user-name');
    if (nameEl) nameEl.textContent = `${currentUser.name} (${currentUser.role})`;

    const dateEl = document.getElementById('header-date-display');
    if (dateEl) {
        const today = new Date();
        dateEl.textContent = today.toLocaleDateString('id-ID', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });
    }

    // Segera tampilkan konten utama agar tidak blank screen
    const mainEl = document.querySelector('main');
    if (mainEl) mainEl.classList.remove('hidden');

    try {
        // Muat master ruangan & inventaris untuk form dropdown
        await loadRoomsAndInventory();

        // Muat data tiket & jadwal
        await Promise.all([
            loadTickets(),
            loadSchedules()
        ]);
    } catch (err) {
        console.error('[SarprasPemeliharaan] Init error:', err);
    }
}

// Muat Master Ruangan & Inventaris
async function loadRoomsAndInventory() {
    try {
        const [rooms, items] = await Promise.all([
            cfClient.getSarprasRooms().catch(() => []),
            cfClient.getSarprasInventory({ limit: 500 }).catch(() => [])
        ]);

        roomsList = rooms || [];
        inventoryList = items || [];

        // Isi dropdown ruangan pada modal tiket
        const ticketRoomSel = document.getElementById('ticket-input-room');
        const schedRoomSel = document.getElementById('sched-input-room');

        const roomOptions = roomsList.map(r => `<option value="${r.id}">${r.kode} - ${r.nama}</option>`).join('');

        if (ticketRoomSel) {
            ticketRoomSel.innerHTML = '<option value="">-- Pilih Ruangan / Lokasi --</option>' + roomOptions;
        }
        if (schedRoomSel) {
            schedRoomSel.innerHTML = '<option value="">-- Seluruh Lingkungan Sekolah / Umum --</option>' + roomOptions;
        }
    } catch (e) {
        console.warn('[Sarpras Pemeliharaan] Gagal memuat master ruangan/inventaris:', e.message);
    }
}

// Tangani perubahan dropdown ruangan pada modal tiket (filter item di ruangan terpilih)
window.handleTicketRoomChange = function (roomId) {
    const itemSel = document.getElementById('ticket-input-item');
    if (!itemSel) return;

    if (!roomId) {
        itemSel.innerHTML = '<option value="">-- Umum / Fasilitas Ruang --</option>';
        return;
    }

    const filtered = inventoryList.filter(item => String(item.room_id) === String(roomId));
    if (filtered.length === 0) {
        itemSel.innerHTML = '<option value="">-- Tidak ada aset spesifik di ruangan ini --</option>';
    } else {
        itemSel.innerHTML = '<option value="">-- Umum / Fasilitas Ruang --</option>' +
            filtered.map(i => `<option value="${i.id}">${i.kode_barang} - ${i.nama_barang}</option>`).join('');
    }
};

// =========================================================================
// 🔄 TAB SWITCHER & HEADER ACTIONS
// =========================================================================

window.switchTab = function (tabName) {
    activeTab = tabName;

    const panelTickets = document.getElementById('panel-tab-tickets');
    const panelSchedules = document.getElementById('panel-tab-schedules');
    const btnTickets = document.getElementById('tab-btn-tickets');
    const btnSchedules = document.getElementById('tab-btn-schedules');
    const btnActionLabel = document.getElementById('btn-tab-action-label');

    if (tabName === 'tickets') {
        panelTickets?.classList.remove('hidden');
        panelSchedules?.classList.add('hidden');

        btnTickets?.classList.add('bg-amber-500', 'text-slate-950', 'shadow-xs');
        btnTickets?.classList.remove('text-slate-300', 'hover:text-white', 'hover:bg-white/10');

        btnSchedules?.classList.remove('bg-amber-500', 'text-slate-950', 'shadow-xs');
        btnSchedules?.classList.add('text-slate-300', 'hover:text-white', 'hover:bg-white/10');

        if (btnActionLabel) btnActionLabel.textContent = 'Buat Tiket Servis';
    } else {
        panelTickets?.classList.add('hidden');
        panelSchedules?.classList.remove('hidden');

        btnSchedules?.classList.add('bg-amber-500', 'text-slate-950', 'shadow-xs');
        btnSchedules?.classList.remove('text-slate-300', 'hover:text-white', 'hover:bg-white/10');

        btnTickets?.classList.remove('bg-amber-500', 'text-slate-950', 'shadow-xs');
        btnTickets?.classList.add('text-slate-300', 'hover:text-white', 'hover:bg-white/10');

        if (btnActionLabel) btnActionLabel.textContent = 'Tambah Jadwal Preventif';
    }
};

window.handleMainTabAction = function () {
    if (!isSarprasManager()) {
        showToast('Akses Terbatas', 'Hanya Petugas atau Waka Sarpras yang dapat menambah data pemeliharaan.', 'warning');
        return;
    }

    if (activeTab === 'tickets') {
        window.openTicketFormModal?.();
    } else {
        window.openScheduleFormModal?.();
    }
};

window.refreshActiveTabData = async function () {
    if (activeTab === 'tickets') {
        await loadTickets();
    } else {
        await loadSchedules();
    }
    showToast('Data Diperbarui', 'Data pemeliharaan berhasil disegarkan.', 'success');
};

// =========================================================================
// 🎫 TAB 1: TIKET SERVIS & PERBAIKAN FISIK
// =========================================================================

async function loadTickets() {
    try {
        const tickets = await cfClient.getSarprasMaintenanceLogs({ limit: 300 });
        ticketsData = tickets || [];
        updateTicketKpis();
        window.filterTickets?.();
    } catch (e) {
        console.error('[loadTickets Error]', e);
        const tbody = document.getElementById('table-ticket-body');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-rose-500">Gagal memuat tiket: ${e.message}</td></tr>`;
        }
    }
}

function updateTicketKpis() {
    let activeCount = 0;
    let urgentCount = 0;
    let completedCount = 0;
    let totalCost = 0;

    ticketsData.forEach(t => {
        if (t.status === 'scheduled' || t.status === 'in_progress') activeCount++;
        if (['darurat', 'tinggi'].includes(t.priority) && t.status !== 'completed' && t.status !== 'cancelled') urgentCount++;
        if (t.status === 'completed') {
            completedCount++;
            totalCost += Number(t.actual_cost) || Number(t.cost_estimate) || 0;
        }
    });

    const activeEl = document.getElementById('kpi-active-tickets');
    const urgentEl = document.getElementById('kpi-urgent-tickets');
    const completedEl = document.getElementById('kpi-completed-tickets');
    const costEl = document.getElementById('kpi-total-cost');

    if (activeEl) activeEl.textContent = activeCount;
    if (urgentEl) urgentEl.textContent = urgentCount;
    if (completedEl) completedEl.textContent = completedCount;
    if (costEl) costEl.textContent = formatRupiah(totalCost);
}

window.filterTickets = function () {
    const statusVal = document.getElementById('filter-ticket-status')?.value || '';
    const typeVal = document.getElementById('filter-ticket-type')?.value || '';
    const priorityVal = document.getElementById('filter-ticket-priority')?.value || '';
    const searchVal = (document.getElementById('search-ticket-keyword')?.value || '').toLowerCase().trim();

    const filtered = ticketsData.filter(t => {
        if (statusVal && t.status !== statusVal) return false;
        if (typeVal && t.maintenance_type !== typeVal) return false;
        if (priorityVal && t.priority !== priorityVal) return false;
        if (searchVal) {
            const num = (t.ticket_number || '').toLowerCase();
            const title = (t.title || '').toLowerCase();
            const tech = (t.technician_name || '').toLowerCase();
            const room = (t.room_name || '').toLowerCase();
            const item = (t.item_name || '').toLowerCase();
            if (!num.includes(searchVal) && !title.includes(searchVal) && !tech.includes(searchVal) && !room.includes(searchVal) && !item.includes(searchVal)) {
                return false;
            }
        }
        return true;
    });

    renderTicketTable(filtered);
};

function renderTicketTable(items) {
    const tbody = document.getElementById('table-ticket-body');
    if (!tbody) return;

    if (!items || items.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="py-12 text-center text-slate-400">
                    <i class="fa-solid fa-clipboard-check text-2xl text-slate-300 dark:text-slate-600 mb-2"></i>
                    <p class="text-xs font-semibold">Tidak ada tiket pemeliharaan yang sesuai filter</p>
                </td>
            </tr>
        `;
        return;
    }

    const rows = items.map(t => {
        // Badge Prioritas
        let priorityBadge = '';
        if (t.priority === 'darurat') {
            priorityBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500 text-white animate-pulse">Darurat</span>';
        } else if (t.priority === 'tinggi') {
            priorityBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">Tinggi</span>';
        } else if (t.priority === 'sedang') {
            priorityBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">Sedang</span>';
        } else {
            priorityBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">Rendah</span>';
        }

        // Badge Status
        let statusBadge = '';
        if (t.status === 'scheduled') {
            statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60">Terjadwal</span>';
        } else if (t.status === 'in_progress') {
            statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">Dikerjakan</span>';
        } else if (t.status === 'completed') {
            statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">Selesai</span>';
        } else {
            statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-500">Batal</span>';
        }

        // Tipe Pekerjaan Tag
        let typeLabel = 'Korektif';
        if (t.maintenance_type === 'preventive') typeLabel = 'Preventif Rutin';
        else if (t.maintenance_type === 'emergency') typeLabel = 'Darurat';

        // Fasilitas Objek
        const facilityDisplay = t.item_name
            ? `<div class="font-bold text-slate-800 dark:text-white">${t.item_name}</div><div class="text-[11px] text-slate-400">${t.room_name || 'Ruang Tertentu'}</div>`
            : `<div class="font-bold text-slate-800 dark:text-white">${t.room_name || 'Fasilitas Sekolah'}</div><div class="text-[11px] text-slate-400">Umum / Gedung</div>`;

        // Biaya Est & Riil
        const estCostDisplay = formatRupiah(t.cost_estimate);
        const actualCostDisplay = t.status === 'completed' && t.actual_cost > 0
            ? `<span class="font-bold text-emerald-600 dark:text-emerald-400">${formatRupiah(t.actual_cost)}</span>`
            : `<span class="text-slate-400 text-xs">Est: ${estCostDisplay}</span>`;

        // Action Buttons
        const canManage = isSarprasManager();
        let actions = `
            <div class="flex items-center justify-center gap-1">
        `;

        if (canManage && t.status !== 'completed' && t.status !== 'cancelled') {
            actions += `
                <button type="button" onclick="window.openTicketCompleteModal?.('${t.id}')" class="px-2.5 py-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg text-xs font-bold transition-all shadow-xs flex items-center gap-1" title="Selesaikan Pekerjaan">
                    <i class="fa-solid fa-check"></i>
                    <span class="hidden sm:inline">Selesai</span>
                </button>
                <button type="button" onclick="window.editTicket?.('${t.id}')" class="w-7 h-7 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs flex items-center justify-center transition-all" title="Edit Tiket">
                    <i class="fa-solid fa-pen"></i>
                </button>
            `;
        }

        if (t.proof_url) {
            actions += `
                <a href="${t.proof_url}" target="_blank" rel="noopener noreferrer" class="w-7 h-7 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 hover:bg-blue-100 rounded-lg text-xs flex items-center justify-center transition-all" title="Buka Bukti Nota / Foto">
                    <i class="fa-solid fa-arrow-up-right-from-square"></i>
                </a>
            `;
        }

        if (canManage) {
            actions += `
                <button type="button" onclick="window.deleteTicket?.('${t.id}')" class="w-7 h-7 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 text-rose-600 rounded-lg text-xs flex items-center justify-center transition-all" title="Hapus Tiket">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            `;
        }

        actions += `</div>`;

        return `
            <tr class="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                <td class="py-3 px-4 whitespace-nowrap">
                    <div class="font-mono font-bold text-amber-600 dark:text-amber-400 text-xs">${t.ticket_number}</div>
                    <div class="text-[11px] text-slate-400">${formatDateIndo(t.scheduled_date || t.created_at)}</div>
                </td>
                <td class="py-3 px-4">
                    ${facilityDisplay}
                </td>
                <td class="py-3 px-4">
                    <p class="font-medium text-slate-800 dark:text-white line-clamp-1">${t.title}</p>
                    <span class="inline-block text-[10px] text-slate-400 font-medium">Tipe: ${typeLabel} · ${t.funding_source || 'BOS'}</span>
                </td>
                <td class="py-3 px-4 whitespace-nowrap">
                    <div class="font-medium text-slate-700 dark:text-slate-300">${t.technician_name || '-'}</div>
                    <div class="text-[11px] text-slate-400">${t.technician_contact || ''}</div>
                </td>
                <td class="py-3 px-4 text-right whitespace-nowrap">
                    ${actualCostDisplay}
                </td>
                <td class="py-3 px-4 text-center whitespace-nowrap">
                    <div class="flex flex-col items-center gap-1">
                        ${statusBadge}
                        ${priorityBadge}
                    </div>
                </td>
                <td class="py-3 px-4 text-center whitespace-nowrap">
                    ${actions}
                </td>
            </tr>
        `;
    }).join('');

    tbody.innerHTML = rows;
}

// Buka Modal Form Tiket (Tambah Baru)
window.openTicketFormModal = function () {
    const modal = document.getElementById('modal-ticket-form');
    const form = document.getElementById('form-ticket');
    if (!modal || !form) return;

    form.reset();
    document.getElementById('ticket-input-id').value = '';
    document.getElementById('ticket-input-source-report-id').value = '';
    document.getElementById('modal-ticket-form-title').textContent = 'Buat Tiket Pemeliharaan';
    document.getElementById('btn-save-ticket').querySelector('span').textContent = 'Terbitkan Tiket';

    // Set tanggal hari ini sebagai default target pengerjaan
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('ticket-input-scheduled-date').value = today;

    // Reset dropdown item aset
    window.handleTicketRoomChange?.('');

    modal.classList.remove('hidden');
};

window.closeTicketFormModal = function () {
    document.getElementById('modal-ticket-form')?.classList.add('hidden');
};

// Edit Tiket
window.editTicket = function (ticketId) {
    const t = ticketsData.find(item => item.id === ticketId);
    if (!t) return;

    window.openTicketFormModal?.();

    document.getElementById('modal-ticket-form-title').textContent = `Edit Tiket ${t.ticket_number}`;
    document.getElementById('btn-save-ticket').querySelector('span').textContent = 'Perbarui Tiket';

    document.getElementById('ticket-input-id').value = t.id;
    document.getElementById('ticket-input-source-report-id').value = t.source_report_id || '';
    document.getElementById('ticket-input-title').value = t.title || '';
    document.getElementById('ticket-input-type').value = t.maintenance_type || 'corrective';
    document.getElementById('ticket-input-priority').value = t.priority || 'sedang';
    document.getElementById('ticket-input-room').value = t.room_id || '';

    window.handleTicketRoomChange?.(t.room_id || '');
    if (t.item_id) {
        document.getElementById('ticket-input-item').value = t.item_id;
    }

    document.getElementById('ticket-input-technician').value = t.technician_name || '';
    document.getElementById('ticket-input-scheduled-date').value = t.scheduled_date || '';
    document.getElementById('ticket-input-cost-est').value = t.cost_estimate || 0;
    document.getElementById('ticket-input-funding').value = t.funding_source || 'BOS Reguler';
    document.getElementById('ticket-input-desc').value = t.description || '';
};

// Buka Modal Selesaikan Tiket
window.openTicketCompleteModal = function (ticketId) {
    const t = ticketsData.find(item => item.id === ticketId);
    if (!t) return;

    const modal = document.getElementById('modal-ticket-complete');
    if (!modal) return;

    document.getElementById('complete-ticket-id').value = t.id;
    document.getElementById('complete-ticket-code').textContent = t.ticket_number;
    document.getElementById('complete-job-title').textContent = t.title;
    document.getElementById('complete-facility-name').textContent = t.item_name || t.room_name || 'Fasilitas Sekolah';

    const today = new Date().toISOString().split('T')[0];
    document.getElementById('complete-date').value = today;
    document.getElementById('complete-actual-cost').value = t.actual_cost > 0 ? t.actual_cost : (t.cost_estimate || 0);
    document.getElementById('complete-proof-url').value = t.proof_url || '';
    document.getElementById('complete-notes').value = t.completion_notes || '';

    modal.classList.remove('hidden');
};

window.closeTicketCompleteModal = function () {
    document.getElementById('modal-ticket-complete')?.classList.add('hidden');
};

// Hapus Tiket
window.deleteTicket = async function (ticketId) {
    const t = ticketsData.find(item => item.id === ticketId);
    if (!t) return;

    if (!confirm(`Apakah Anda yakin ingin menghapus tiket pemeliharaan ${t.ticket_number} (${t.title})?`)) {
        return;
    }

    try {
        await cfClient.deleteSarprasMaintenanceLog(ticketId);
        showToast('Berhasil', `Tiket ${t.ticket_number} berhasil dihapus.`, 'success');
        await loadTickets();
    } catch (e) {
        showToast('Error', e.message || 'Gagal menghapus tiket.', 'error');
    }
};

// =========================================================================
// 📅 TAB 2: JADWAL PREVENTIF BERKALA
// =========================================================================

async function loadSchedules() {
    try {
        const schedules = await cfClient.getSarprasMaintenanceSchedules();
        schedulesData = schedules || [];
        updateScheduleKpis();
        window.filterSchedules?.();
    } catch (e) {
        console.error('[loadSchedules Error]', e);
        const tbody = document.getElementById('table-schedule-body');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-rose-500">Gagal memuat jadwal: ${e.message}</td></tr>`;
        }
    }
}

function updateScheduleKpis() {
    let totalCount = schedulesData.length;
    let dueCount = 0;
    let activeCount = 0;
    let estAnnualTotal = 0;

    const now = new Date();
    const thirtyDaysLater = new Date();
    thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);

    schedulesData.forEach(s => {
        if (s.is_active) activeCount++;
        if (s.next_due_date) {
            const dueDate = new Date(s.next_due_date);
            if (!isNaN(dueDate.getTime()) && dueDate <= thirtyDaysLater) {
                dueCount++;
            }
        }

        // Hitung estimasi tahunan berdasarkan frekuensi
        const cost = Number(s.estimated_cost_per_service) || 0;
        if (s.frequency === 'monthly') estAnnualTotal += (cost * 12);
        else if (s.frequency === 'quarterly') estAnnualTotal += (cost * 4);
        else if (s.frequency === 'biannual') estAnnualTotal += (cost * 2);
        else estAnnualTotal += cost;
    });

    const totalEl = document.getElementById('kpi-total-schedules');
    const dueEl = document.getElementById('kpi-due-schedules');
    const activeEl = document.getElementById('kpi-active-schedules');
    const annualEl = document.getElementById('kpi-est-annual-cost');

    if (totalEl) totalEl.textContent = totalCount;
    if (dueEl) dueEl.textContent = dueCount;
    if (activeEl) activeEl.textContent = activeCount;
    if (annualEl) annualEl.textContent = formatRupiah(estAnnualTotal);
}

window.filterSchedules = function () {
    const searchVal = (document.getElementById('search-schedule-keyword')?.value || '').toLowerCase().trim();

    const filtered = schedulesData.filter(s => {
        if (searchVal) {
            const name = (s.schedule_name || '').toLowerCase();
            const vendor = (s.vendor_name || '').toLowerCase();
            const room = (s.room_name || '').toLowerCase();
            if (!name.includes(searchVal) && !vendor.includes(searchVal) && !room.includes(searchVal)) {
                return false;
            }
        }
        return true;
    });

    renderScheduleTable(filtered);
};

function renderScheduleTable(items) {
    const tbody = document.getElementById('table-schedule-body');
    if (!tbody) return;

    if (!items || items.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="py-12 text-center text-slate-400">
                    <i class="fa-solid fa-calendar-xmark text-2xl text-slate-300 dark:text-slate-600 mb-2"></i>
                    <p class="text-xs font-semibold">Belum ada program jadwal pemeliharaan preventif</p>
                </td>
            </tr>
        `;
        return;
    }

    const now = new Date();
    const rows = items.map(s => {
        // Frekuensi Tag
        let freqLabel = 'Triwulanan';
        if (s.frequency === 'monthly') freqLabel = 'Bulanan (1 Bln)';
        else if (s.frequency === 'quarterly') freqLabel = 'Triwulanan (3 Bln)';
        else if (s.frequency === 'biannual') freqLabel = 'Semesteran (6 Bln)';
        else if (s.frequency === 'annual') freqLabel = 'Tahunan (1 Thn)';

        // Cek Jatuh Tempo
        let dueClass = 'text-slate-700 dark:text-slate-300 font-semibold';
        let dueWarning = '';
        if (s.next_due_date) {
            const d = new Date(s.next_due_date);
            if (!isNaN(d.getTime())) {
                const diffDays = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
                if (diffDays < 0) {
                    dueClass = 'text-rose-600 dark:text-rose-400 font-bold';
                    dueWarning = '<span class="inline-block text-[10px] text-rose-500 font-bold animate-pulse">Lewat Jatuh Tempo!</span>';
                } else if (diffDays <= 14) {
                    dueClass = 'text-amber-600 dark:text-amber-400 font-bold';
                    dueWarning = `<span class="inline-block text-[10px] text-amber-500 font-semibold">${diffDays} hari lagi</span>`;
                }
            }
        }

        const canManage = isSarprasManager();
        let actions = `
            <div class="flex items-center justify-center gap-1">
        `;

        if (canManage) {
            actions += `
                <button type="button" onclick="window.generateTicketFromSchedule?.('${s.id}')" class="px-2.5 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center gap-1" title="Konversi Menjadi Tiket Servis">
                    <i class="fa-solid fa-play text-[10px]"></i>
                    <span class="hidden sm:inline">Servis Sekarang</span>
                </button>
                <button type="button" onclick="window.editSchedule?.('${s.id}')" class="w-7 h-7 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs flex items-center justify-center transition-all" title="Edit Jadwal">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button type="button" onclick="window.deleteSchedule?.('${s.id}')" class="w-7 h-7 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 text-rose-600 rounded-lg text-xs flex items-center justify-center transition-all" title="Hapus Jadwal">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            `;
        }

        actions += `</div>`;

        return `
            <tr class="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                <td class="py-3 px-4">
                    <div class="font-bold text-slate-800 dark:text-white">${s.schedule_name}</div>
                    <div class="text-[11px] text-slate-400 line-clamp-1">${s.notes || 'Pemeriksaan fisik preventif'}</div>
                </td>
                <td class="py-3 px-4 whitespace-nowrap">
                    <span class="font-medium text-slate-700 dark:text-slate-300">${s.room_name || 'Seluruh Sekolah'}</span>
                </td>
                <td class="py-3 px-4 text-center whitespace-nowrap">
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/60">
                        ${freqLabel}
                    </span>
                </td>
                <td class="py-3 px-4 whitespace-nowrap">
                    <span class="font-medium text-slate-700 dark:text-slate-300">${s.vendor_name || '-'}</span>
                </td>
                <td class="py-3 px-4 whitespace-nowrap">
                    <span class="text-xs text-slate-500">${formatDateIndo(s.last_performed_at)}</span>
                </td>
                <td class="py-3 px-4 whitespace-nowrap">
                    <div class="${dueClass}">${formatDateIndo(s.next_due_date)}</div>
                    ${dueWarning}
                </td>
                <td class="py-3 px-4 text-right whitespace-nowrap font-medium">
                    ${formatRupiah(s.estimated_cost_per_service)}
                </td>
                <td class="py-3 px-4 text-center whitespace-nowrap">
                    ${actions}
                </td>
            </tr>
        `;
    }).join('');

    tbody.innerHTML = rows;
}

// Buka Modal Form Jadwal Preventif
window.openScheduleFormModal = function () {
    const modal = document.getElementById('modal-schedule-form');
    const form = document.getElementById('form-schedule');
    if (!modal || !form) return;

    form.reset();
    document.getElementById('sched-input-id').value = '';
    document.getElementById('modal-schedule-title').textContent = 'Tambah Jadwal Pemeliharaan Preventif';

    // Tanggal default: 1 bulan dari sekarang
    const nextDate = new Date();
    nextDate.setMonth(nextDate.getMonth() + 1);
    document.getElementById('sched-input-due').value = nextDate.toISOString().split('T')[0];

    modal.classList.remove('hidden');
};

window.closeScheduleFormModal = function () {
    document.getElementById('modal-schedule-form')?.classList.add('hidden');
};

// Edit Jadwal
window.editSchedule = function (schedId) {
    const s = schedulesData.find(item => item.id === schedId);
    if (!s) return;

    window.openScheduleFormModal?.();
    document.getElementById('modal-schedule-title').textContent = 'Edit Jadwal Preventif';

    document.getElementById('sched-input-id').value = s.id;
    document.getElementById('sched-input-name').value = s.schedule_name || '';
    document.getElementById('sched-input-freq').value = s.frequency || 'quarterly';
    document.getElementById('sched-input-due').value = s.next_due_date || '';
    document.getElementById('sched-input-room').value = s.room_id || '';
    document.getElementById('sched-input-vendor').value = s.vendor_name || '';
    document.getElementById('sched-input-cost').value = s.estimated_cost_per_service || 0;
    document.getElementById('sched-input-notes').value = s.notes || '';
};

// Konversi Jadwal Menjadi Tiket Servis
window.generateTicketFromSchedule = async function (schedId) {
    const s = schedulesData.find(item => item.id === schedId);
    if (!s) return;

    if (!confirm(`Terbitkan tiket servis pekerjaan untuk program "${s.schedule_name}" sekarang?`)) {
        return;
    }

    try {
        const res = await cfClient.generateSarprasMaintenanceTicketFromSchedule(schedId);
        showToast('Tiket Diterbitkan', res.message || 'Tiket pemeliharaan preventif berhasil dibuat.', 'success');
        // Refresh kedua tab
        await Promise.all([loadTickets(), loadSchedules()]);
        // Arahkan ke tab tiket untuk melihat hasilnya
        window.switchTab?.('tickets');
    } catch (e) {
        showToast('Error', e.message || 'Gagal menerbitkan tiket dari jadwal.', 'error');
    }
};

// Hapus Jadwal Preventif
window.deleteSchedule = async function (schedId) {
    const s = schedulesData.find(item => item.id === schedId);
    if (!s) return;

    if (!confirm(`Hapus jadwal pemeliharaan preventif "${s.schedule_name}"?`)) {
        return;
    }

    try {
        await cfClient.deleteSarprasMaintenanceSchedule(schedId);
        showToast('Berhasil', 'Jadwal pemeliharaan berhasil dihapus.', 'success');
        await loadSchedules();
    } catch (e) {
        showToast('Error', e.message || 'Gagal menghapus jadwal.', 'error');
    }
};

// =========================================================================
// 📨 FORM SUBMISSION HANDLERS
// =========================================================================

// Form Tiket Submit
document.getElementById('form-ticket')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const id = document.getElementById('ticket-input-id')?.value;
    const isEdit = Boolean(id);

    const payload = {
        title: document.getElementById('ticket-input-title')?.value.trim(),
        source_report_id: document.getElementById('ticket-input-source-report-id')?.value.trim(),
        maintenance_type: document.getElementById('ticket-input-type')?.value,
        priority: document.getElementById('ticket-input-priority')?.value,
        room_id: document.getElementById('ticket-input-room')?.value,
        item_id: document.getElementById('ticket-input-item')?.value,
        facility_type: document.getElementById('ticket-input-item')?.value ? 'item' : 'room',
        technician_name: document.getElementById('ticket-input-technician')?.value.trim(),
        scheduled_date: document.getElementById('ticket-input-scheduled-date')?.value,
        cost_estimate: parseFloat(document.getElementById('ticket-input-cost-est')?.value) || 0,
        funding_source: document.getElementById('ticket-input-funding')?.value,
        description: document.getElementById('ticket-input-desc')?.value.trim()
    };

    const btnSubmit = document.getElementById('btn-save-ticket');
    if (btnSubmit) btnSubmit.disabled = true;

    try {
        const res = await cfClient.saveSarprasMaintenanceLog(payload, isEdit, id);
        showToast('Sukses', res.message || 'Tiket pemeliharaan berhasil disimpan.', 'success');
        window.closeTicketFormModal?.();
        await loadTickets();
    } catch (err) {
        showToast('Error', err.message || 'Gagal menyimpan tiket.', 'error');
    } finally {
        if (btnSubmit) btnSubmit.disabled = false;
    }
});

// Form Selesaikan Tiket Submit
document.getElementById('form-ticket-complete')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const ticketId = document.getElementById('complete-ticket-id')?.value;
    if (!ticketId) return;

    const payload = {
        status: 'completed',
        completion_date: document.getElementById('complete-date')?.value,
        actual_cost: parseFloat(document.getElementById('complete-actual-cost')?.value) || 0,
        proof_url: document.getElementById('complete-proof-url')?.value.trim(),
        completion_notes: document.getElementById('complete-notes')?.value.trim()
    };

    const btnSubmit = document.getElementById('btn-save-complete');
    if (btnSubmit) btnSubmit.disabled = true;

    try {
        const res = await cfClient.saveSarprasMaintenanceLog(payload, true, ticketId);
        showToast('Pekerjaan Selesai', res.message || 'Pekerjaan pemeliharaan ditandai selesai.', 'success');
        window.closeTicketCompleteModal?.();
        await loadTickets();
    } catch (err) {
        showToast('Error', err.message || 'Gagal menyelesaikan tiket.', 'error');
    } finally {
        if (btnSubmit) btnSubmit.disabled = false;
    }
});

// Form Jadwal Submit
document.getElementById('form-schedule')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const id = document.getElementById('sched-input-id')?.value;
    const isEdit = Boolean(id);

    const payload = {
        schedule_name: document.getElementById('sched-input-name')?.value.trim(),
        frequency: document.getElementById('sched-input-freq')?.value,
        next_due_date: document.getElementById('sched-input-due')?.value,
        room_id: document.getElementById('sched-input-room')?.value,
        facility_type: 'room',
        vendor_name: document.getElementById('sched-input-vendor')?.value.trim(),
        estimated_cost_per_service: parseFloat(document.getElementById('sched-input-cost')?.value) || 0,
        notes: document.getElementById('sched-input-notes')?.value.trim()
    };

    const btnSubmit = document.getElementById('btn-save-schedule');
    if (btnSubmit) btnSubmit.disabled = true;

    try {
        const res = await cfClient.saveSarprasMaintenanceSchedule(payload, isEdit, id);
        showToast('Sukses', res.message || 'Jadwal servis preventif berhasil disimpan.', 'success');
        window.closeScheduleFormModal?.();
        await loadSchedules();
    } catch (err) {
        showToast('Error', err.message || 'Gagal menyimpan jadwal.', 'error');
    } finally {
        if (btnSubmit) btnSubmit.disabled = false;
    }
});

// Helper Notifikasi Toast Global
function showToast(title, message, type = 'info') {
    if (window.showToast) {
        window.showToast(title, message, type);
    } else {
        alert(`[${type.toUpperCase()}] ${title}: ${message}`);
    }
}

// Lifecycle Init saat DOM Siap
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPage);
} else {
    initPage();
}

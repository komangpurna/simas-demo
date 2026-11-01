/**
 * page-rkas-komite.js - Controller Modul RKAS Komite SIMAS SMAGESA
 * Single Source of Truth (SSOT): Supabase PostgreSQL (rkas_komite_headers, rkas_komite_items, finance_cashflow)
 * Standar: OWASP Top 10, ASVS Level 1 & 2, Action & Security Parity, 0 Kuota Firestore
 */

import { auth, supabase, SCHOOL_CONFIG } from './config.js';
import { initLayout } from './global.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

// State Modul
let currentUser = null;
let userRole = 'admin_spp';
let userName = 'Bendahara Komite';
let currentFiscalYear = new Date().getFullYear();
let currentVersionType = 'murni'; // 'murni' | 'perubahan'
let activeViewMode = 'matrix'; // 'matrix' | 'realization'

let rkasHeader = null;
let rkasItems = [];
let cashflowExpenses = [];
let parsedImportData = null;
let itemToDelete = null;
let pendingApprovalAction = null;

// Helper Notifikasi Toast
function showToast(title, msg, type = 'info') {
    if (typeof window.showToast === 'function') {
        window.showToast(title, msg, type);
    } else {
        alert(`[${type.toUpperCase()}] ${title}: ${msg}`);
    }
}

// Format Rupiah
function formatRupiah(num) {
    const val = Number(num) || 0;
    return 'Rp ' + val.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Format Angka Bersih dari Input Rupiah
function parseCurrencyString(val) {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    const clean = String(val).replace(/[^0-9,-]/g, '').replace(',', '.');
    const num = parseFloat(clean);
    return isNaN(num) ? 0 : num;
}

// Format Input Currency Secara Interaktif
window.formatCurrencyInput = (inputEl) => {
    if (!inputEl) return;
    const rawVal = inputEl.value;
    const num = parseCurrencyString(rawVal);
    if (rawVal.trim() === '' || isNaN(num)) {
        inputEl.value = '';
        return;
    }
    inputEl.value = num.toLocaleString('id-ID');
};

// Cek Hak Akses Pengelola Keuangan Komite
function canManageRkas() {
    if (typeof window.hasRole === 'function') {
        return window.hasRole('super_admin') || window.hasRole('admin_spp');
    }
    return ['super_admin', 'admin_spp'].includes(userRole);
}

function isPrincipal() {
    if (typeof window.hasRole === 'function') {
        return window.hasRole('super_admin') || window.hasRole('kepala_sekolah');
    }
    return ['super_admin', 'kepala_sekolah'].includes(userRole);
}

// =========================================================================
// 1. Inisialisasi Modul & Otentikasi
// =========================================================================
document.addEventListener('DOMContentLoaded', async () => {
    try {
        if (typeof initLayout === 'function') {
            await initLayout();
        }

        // Tampilkan tanggal hari ini
        const dateEl = document.getElementById('header-date-display');
        if (dateEl) {
            dateEl.textContent = new Date().toLocaleDateString('id-ID', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
            });
        }

        onAuthStateChanged(auth, async (user) => {
            if (user) {
                currentUser = user;
                userName = user.displayName || user.email || 'Pengelola Komite';
                userRole = localStorage.getItem('user_role') || 'admin_spp';

                const nameEl = document.getElementById('header-user-name');
                if (nameEl) nameEl.textContent = userName;

                // Set default tahun anggaran
                const yearSelect = document.getElementById('filter-fiscal-year');
                if (yearSelect) {
                    currentFiscalYear = parseInt(yearSelect.value, 10) || new Date().getFullYear();
                }

                await loadRkasData();

                // Buka kontainer utama
                const mainEl = document.querySelector('main');
                if (mainEl) mainEl.classList.remove('hidden');
            } else {
                window.location.href = 'index.html';
            }
        });
    } catch (err) {
        console.error('[RKAS] Inisialisasi Gagal:', err);
        showToast('Error', 'Gagal memuat modul RKAS: ' + err.message, 'error');
    }
});

// =========================================================================
// 2. Load & Sync Data RKAS dari Supabase
// =========================================================================
export async function loadRkasData() {
    try {
        if (!supabase) {
            showToast('Error', 'Koneksi database belum terinisialisasi.', 'error');
            return;
        }

        const headerId = `${currentFiscalYear}_${currentVersionType}`;

        // 1. Ambil Header RKAS
        const { data: headerData, error: headerErr } = await supabase
            .from('rkas_komite_headers')
            .select('*')
            .eq('id', headerId)
            .maybeSingle();

        if (headerErr) throw headerErr;

        if (headerData) {
            rkasHeader = headerData;
        } else {
            // Inisialisasi objek header default di memory
            rkasHeader = {
                id: headerId,
                year: currentFiscalYear,
                version_type: currentVersionType,
                revision_no: 0,
                status: 'draft',
                silpa_prev_year: 0,
                penerimaan_current_year: 0,
                total_penerimaan: 0,
                total_belanja: 0,
                committee_chair_name: 'I Gede Sukasari, S.ST.',
                notes: ''
            };
        }

        // 2. Ambil Item RKAS
        const { data: itemsData, error: itemsErr } = await supabase
            .from('rkas_komite_items')
            .select('*')
            .eq('header_id', headerId)
            .order('no_urut', { ascending: true });

        if (itemsErr) throw itemsErr;
        rkasItems = Array.isArray(itemsData) ? itemsData : [];

        // 3. Ambil Realisasi Pengeluaran Kas dari finance_cashflow
        const { data: cashflowData, error: cfErr } = await supabase
            .from('finance_cashflow')
            .select('*')
            .eq('type', 'keluar')
            .like('date_str', `${currentFiscalYear}%`);

        if (!cfErr && Array.isArray(cashflowData)) {
            cashflowExpenses = cashflowData;
        } else {
            cashflowExpenses = [];
        }

        // 4. Render Seluruh Komponen Antarmuka
        renderHeaderBadges();
        renderApprovalCard();
        renderKpis();
        renderSectionA();
        renderSectionB();
        populateParentKegiatanDropdown();

    } catch (err) {
        console.error('[RKAS] Load Data Error:', err);
        showToast('Error', 'Gagal memuat data RKAS: ' + err.message, 'error');
    }
}
window.refreshRkasData = loadRkasData;

// =========================================================================
// 3. Rendering Antarmuka (Badges, Approval, KPI, Section A & B)
// =========================================================================
function renderHeaderBadges() {
    const versionBadge = document.getElementById('badge-version-type');
    if (versionBadge) {
        versionBadge.textContent = currentVersionType === 'perubahan' ? 'RKAS Perubahan' : 'RKAS Murni';
        if (currentVersionType === 'perubahan') {
            versionBadge.className = 'px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 uppercase tracking-wide';
        } else {
            versionBadge.className = 'px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 uppercase tracking-wide';
        }
    }

    const statusBadge = document.getElementById('badge-rkas-status');
    if (statusBadge) {
        const st = rkasHeader?.status || 'draft';
        if (st === 'approved_committee') {
            statusBadge.textContent = 'Disetujui Komite';
            statusBadge.className = 'px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
        } else if (st === 'reviewed_principal') {
            statusBadge.textContent = 'Diketahui Kepala Sekolah';
            statusBadge.className = 'px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30';
        } else if (st === 'signed_treasurer') {
            statusBadge.textContent = 'Ditandatangani Bendahara';
            statusBadge.className = 'px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30';
        } else {
            statusBadge.textContent = 'Draft (Belum Sah)';
            statusBadge.className = 'px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30';
        }
    }

    // Toggle Tombol Salin dari RKAS Murni
    const btnClone = document.getElementById('btn-clone-murni');
    if (btnClone) {
        if (currentVersionType === 'perubahan' && rkasItems.length === 0) {
            btnClone.classList.remove('hidden');
        } else {
            btnClone.classList.add('hidden');
        }
    }
}

function renderApprovalCard() {
    const st = rkasHeader?.status || 'draft';

    // 1. Step Bendahara
    const stepTIcon = document.getElementById('step-treasurer-icon');
    const stepTName = document.getElementById('step-treasurer-name');
    const stepTMeta = document.getElementById('step-treasurer-meta');
    if (rkasHeader?.signed_treasurer_by) {
        if (stepTIcon) {
            stepTIcon.className = 'w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xs shrink-0 font-bold';
            stepTIcon.innerHTML = '<i class="fa-solid fa-check"></i>';
        }
        if (stepTName) stepTName.textContent = rkasHeader.signed_treasurer_by;
        if (stepTMeta) stepTMeta.textContent = 'Ditandatangani: ' + new Date(rkasHeader.signed_treasurer_at).toLocaleDateString('id-ID');
    } else {
        if (stepTIcon) {
            stepTIcon.className = 'w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center text-xs shrink-0 font-bold';
            stepTIcon.textContent = '1';
        }
        if (stepTName) stepTName.textContent = userName || 'Bendahara Komite';
        if (stepTMeta) stepTMeta.textContent = 'Belum ditandatangani';
    }

    // 2. Step Kepala Sekolah
    const stepPIcon = document.getElementById('step-principal-icon');
    const stepPName = document.getElementById('step-principal-name');
    const stepPMeta = document.getElementById('step-principal-meta');
    const principalDefaultName = SCHOOL_CONFIG.principalName || 'I Wayan Suteja, S.Pd., M.Pd.';
    if (rkasHeader?.reviewed_principal_by) {
        if (stepPIcon) {
            stepPIcon.className = 'w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xs shrink-0 font-bold';
            stepPIcon.innerHTML = '<i class="fa-solid fa-check"></i>';
        }
        if (stepPName) stepPName.textContent = rkasHeader.reviewed_principal_by;
        if (stepPMeta) stepPMeta.textContent = 'Diketahui: ' + new Date(rkasHeader.reviewed_principal_at).toLocaleDateString('id-ID');
    } else {
        if (stepPIcon) {
            stepPIcon.className = 'w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center text-xs shrink-0 font-bold';
            stepPIcon.textContent = '2';
        }
        if (stepPName) stepPName.textContent = principalDefaultName;
        if (stepPMeta) stepPMeta.textContent = st === 'signed_treasurer' ? 'Menunggu telaah' : 'Menunggu tanda tangan bendahara';
    }

    // 3. Step Ketua Komite
    const stepCIcon = document.getElementById('step-committee-icon');
    const stepCName = document.getElementById('step-committee-name');
    const stepCMeta = document.getElementById('step-committee-meta');
    const chairName = rkasHeader?.committee_chair_name || 'I Gede Sukasari, S.ST.';
    if (rkasHeader?.approved_committee_by) {
        if (stepCIcon) {
            stepCIcon.className = 'w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xs shrink-0 font-bold';
            stepCIcon.innerHTML = '<i class="fa-solid fa-check-double"></i>';
        }
        if (stepCName) stepCName.textContent = chairName;
        if (stepCMeta) stepCMeta.textContent = 'Disetujui: ' + new Date(rkasHeader.approved_committee_at).toLocaleDateString('id-ID');
    } else {
        if (stepCIcon) {
            stepCIcon.className = 'w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center text-xs shrink-0 font-bold';
            stepCIcon.textContent = '3';
        }
        if (stepCName) stepCName.textContent = chairName;
        if (stepCMeta) stepCMeta.textContent = st === 'reviewed_principal' ? 'Menunggu persetujuan' : 'Menunggu telaah kepala sekolah';
    }

    // Tombol Aksi Pengesahan Dinamis
    const actionContainer = document.getElementById('approval-action-container');
    if (!actionContainer) return;
    actionContainer.innerHTML = '';

    if (canManageRkas() && st === 'draft') {
        actionContainer.innerHTML = `
            <button type="button" onclick="window.promptApproval('sign_treasurer')" class="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 active:scale-95">
                <i class="fa-solid fa-pen-nib text-xs"></i>
                <span>Tandatangani (Bendahara)</span>
            </button>
        `;
    } else if (isPrincipal() && st === 'signed_treasurer') {
        actionContainer.innerHTML = `
            <button type="button" onclick="window.promptApproval('review_principal')" class="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 active:scale-95">
                <i class="fa-solid fa-stamp text-xs"></i>
                <span>Ketahui (Kepala Sekolah)</span>
            </button>
        `;
    } else if ((canManageRkas() || isPrincipal()) && st === 'reviewed_principal') {
        actionContainer.innerHTML = `
            <button type="button" onclick="window.promptApproval('approve_committee')" class="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 active:scale-95">
                <i class="fa-solid fa-check-double text-xs"></i>
                <span>Setujui (Ketua Komite)</span>
            </button>
        `;
    } else if (st === 'approved_committee') {
        actionContainer.innerHTML = `
            <span class="px-3 py-1 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 rounded-xl text-xs font-bold flex items-center gap-1.5">
                <i class="fa-solid fa-circle-check text-emerald-500"></i>
                <span>RKAS Sah &amp; Berlaku</span>
            </span>
        `;
    }
}

function renderKpis() {
    const totalIncome = Number(rkasHeader?.total_penerimaan) || 0;
    
    // Hitung total belanja dari item detail atau kegiatan
    let totalBudget = 0;
    (Array.isArray(rkasItems) ? rkasItems : []).forEach(item => {
        if (item.item_type === 'belanja_detail') {
            totalBudget += Number(item.jumlah) || 0;
        } else if (item.item_type === 'kegiatan') {
            // Jika kegiatan belum punya child belanja detail, gunakan jumlah kegiatan
            const hasDetail = rkasItems.some(d => d.item_type === 'belanja_detail' && d.parent_kegiatan_id === item.id);
            if (!hasDetail) {
                totalBudget += Number(item.jumlah) || 0;
            }
        }
    });

    const balanceBudget = totalIncome - totalBudget;

    // Hitung total realisasi kas riil dari finance_cashflow
    let totalRealized = 0;
    (Array.isArray(cashflowExpenses) ? cashflowExpenses : []).forEach(cf => {
        totalRealized += Number(cf.amount) || 0;
    });

    const elIncome = document.getElementById('kpi-total-income');
    if (elIncome) elIncome.textContent = formatRupiah(totalIncome);

    const elBudget = document.getElementById('kpi-total-budget');
    if (elBudget) elBudget.textContent = formatRupiah(totalBudget);

    const elBalance = document.getElementById('kpi-balance-budget');
    if (elBalance) {
        elBalance.textContent = formatRupiah(balanceBudget);
        elBalance.className = balanceBudget >= 0 
            ? 'text-sm sm:text-lg font-black text-emerald-600 dark:text-emerald-400 leading-tight font-mono'
            : 'text-sm sm:text-lg font-black text-rose-600 dark:text-rose-400 leading-tight font-mono';
    }

    const elRealized = document.getElementById('kpi-total-realized');
    if (elRealized) elRealized.textContent = formatRupiah(totalRealized);
}

function renderSectionA() {
    const silpa = Number(rkasHeader?.silpa_prev_year) || 0;
    const income = Number(rkasHeader?.penerimaan_current_year) || 0;
    const total = silpa + income;

    const labelSilpa = document.getElementById('label-silpa');
    if (labelSilpa) labelSilpa.textContent = `SILPA ${currentFiscalYear - 1}`;

    const labelIncome = document.getElementById('label-income');
    if (labelIncome) labelIncome.textContent = `PENERIMAAN ${currentFiscalYear}`;

    const valSilpa = document.getElementById('val-silpa');
    if (valSilpa) valSilpa.textContent = formatRupiah(silpa);

    const valIncome = document.getElementById('val-income');
    if (valIncome) valIncome.textContent = formatRupiah(income);

    const valTotal = document.getElementById('val-total-income');
    if (valTotal) valTotal.textContent = formatRupiah(total);
}

function renderSectionB() {
    renderMatrixView();
    renderRealizationView();
}

function renderMatrixView() {
    const tbody = document.getElementById('rkas-table-tbody');
    if (!tbody) return;

    if (!rkasItems || rkasItems.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="11" class="px-4 py-8 text-center text-slate-400 dark:text-slate-500 italic">
                    Belum ada data belanja untuk RKAS tahun ${currentFiscalYear} (${currentVersionType.toUpperCase()}).<br>
                    Silakan klik <strong>Tambah Kegiatan</strong> atau <strong>Import Excel</strong>.
                </td>
            </tr>
        `;
        document.getElementById('tfoot-total-belanja').textContent = 'Rp 0';
        document.getElementById('tfoot-total-tahap-1').textContent = 'Rp 0';
        document.getElementById('tfoot-total-tahap-2').textContent = 'Rp 0';
        return;
    }

    let grandTotalBelanja = 0;
    let grandTotalTahap1 = 0;
    let grandTotalTahap2 = 0;

    let html = '';
    (Array.isArray(rkasItems) ? rkasItems : []).forEach((item, idx) => {
        const type = item.item_type;
        const no = item.no_urut || (idx + 1);
        const kodeRek = item.kode_rekening || '';
        const kodeProg = item.kode_program || '';
        const uraian = item.uraian || '';
        const volume = Number(item.volume) || 0;
        const satuan = item.satuan || '';
        const tarif = Number(item.tarif_harga) || 0;
        const jumlah = Number(item.jumlah) || 0;
        const t1 = Number(item.tahap_1) || 0;
        const t2 = Number(item.tahap_2) || 0;

        let rowClass = 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200';
        let uraianClass = 'pl-8 font-normal text-slate-600 dark:text-slate-300';
        let isKegiatan = false;

        if (type === 'standar') {
            rowClass = 'bg-rose-100/90 dark:bg-rose-950/70 font-bold text-rose-950 dark:text-rose-100 border-t border-rose-300 dark:border-rose-900';
            uraianClass = 'font-bold text-rose-950 dark:text-rose-100';
        } else if (type === 'program') {
            rowClass = 'bg-emerald-100/80 dark:bg-emerald-950/60 font-semibold text-emerald-950 dark:text-emerald-100';
            uraianClass = 'pl-2 font-bold text-emerald-900 dark:text-emerald-200';
        } else if (type === 'sub_program') {
            rowClass = 'bg-amber-100/80 dark:bg-amber-950/60 font-semibold text-amber-950 dark:text-amber-100';
            uraianClass = 'pl-4 font-semibold text-amber-900 dark:text-amber-200';
        } else if (type === 'kegiatan') {
            rowClass = 'bg-sky-100/80 dark:bg-sky-950/60 font-bold text-sky-950 dark:text-sky-100';
            uraianClass = 'pl-6 font-bold text-sky-900 dark:text-sky-200 flex items-center gap-1.5';
            isKegiatan = true;
            grandTotalTahap1 += t1;
            grandTotalTahap2 += t2;
        } else if (type === 'belanja_detail') {
            rowClass = 'hover:bg-slate-50 dark:hover:bg-slate-800/40 text-slate-700 dark:text-slate-300';
            uraianClass = 'pl-8 font-normal text-slate-600 dark:text-slate-300';
            grandTotalBelanja += jumlah;
        }

        html += `
            <tr class="${rowClass}">
                <td class="px-2.5 py-1.5 text-center font-mono border-r border-slate-200 dark:border-slate-800">${no}</td>
                <td class="px-2.5 py-1.5 font-mono text-[11px] border-r border-slate-200 dark:border-slate-800">${kodeRek}</td>
                <td class="px-2.5 py-1.5 font-mono text-[11px] border-r border-slate-200 dark:border-slate-800">${kodeProg}</td>
                <td class="px-3.5 py-1.5 border-r border-slate-200 dark:border-slate-800">
                    <div class="${uraianClass}">
                        ${isKegiatan ? '<i class="fa-solid fa-caret-right text-sky-500"></i>' : ''}
                        <span>${escapeHtml(uraian)}</span>
                    </div>
                </td>
                <td class="px-2 py-1.5 text-center font-mono border-r border-slate-200 dark:border-slate-800">${volume > 0 ? volume : ''}</td>
                <td class="px-2 py-1.5 text-center border-r border-slate-200 dark:border-slate-800">${escapeHtml(satuan)}</td>
                <td class="px-2 py-1.5 text-right font-mono border-r border-slate-200 dark:border-slate-800">${tarif > 0 ? formatRupiah(tarif) : ''}</td>
                <td class="px-3 py-1.5 text-right font-mono font-bold border-r border-slate-200 dark:border-slate-800">${jumlah > 0 ? formatRupiah(jumlah) : '-'}</td>
                <td class="px-2 py-1.5 text-right font-mono border-r border-slate-200 dark:border-slate-800 text-sky-800 dark:text-sky-300 font-semibold">${t1 > 0 ? formatRupiah(t1) : ''}</td>
                <td class="px-2 py-1.5 text-right font-mono border-r border-slate-200 dark:border-slate-800 text-sky-800 dark:text-sky-300 font-semibold">${t2 > 0 ? formatRupiah(t2) : ''}</td>
                <td class="px-2 py-1.5 text-center">
                    <div class="flex items-center justify-center gap-1">
                        ${isKegiatan ? `
                            <button type="button" onclick="window.openAddDetailModal('${item.id}')" class="p-1 text-emerald-600 hover:text-emerald-700 dark:text-emerald-400" title="Tambah Rincian Item Belanja">
                                <i class="fa-solid fa-plus-circle text-xs"></i>
                            </button>
                        ` : ''}
                        ${(type === 'kegiatan' || type === 'belanja_detail') ? `
                            <button type="button" onclick="window.confirmDeleteItem('${item.id}', '${escapeHtml(uraian)}')" class="p-1 text-rose-500 hover:text-rose-700 dark:text-rose-400" title="Hapus Item">
                                <i class="fa-solid fa-trash-can text-xs"></i>
                            </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;

    const tfBelanja = document.getElementById('tfoot-total-belanja');
    if (tfBelanja) tfBelanja.textContent = formatRupiah(grandTotalBelanja);

    const tfT1 = document.getElementById('tfoot-total-tahap-1');
    if (tfT1) tfT1.textContent = formatRupiah(grandTotalTahap1);

    const tfT2 = document.getElementById('tfoot-total-tahap-2');
    if (tfT2) tfT2.textContent = formatRupiah(grandTotalTahap2);
}

function renderRealizationView() {
    const tbody = document.getElementById('realization-table-tbody');
    if (!tbody) return;

    // Filter hanya item yang bertipe 'kegiatan'
    const kegiatanList = (Array.isArray(rkasItems) ? rkasItems : []).filter(item => item.item_type === 'kegiatan');

    if (kegiatanList.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" class="px-4 py-8 text-center text-slate-400 dark:text-slate-500 italic">
                    Belum ada pos kegiatan RKAS yang terdaftar.
                </td>
            </tr>
        `;
        return;
    }

    let totPagu = 0;
    let totT1 = 0;
    let totT2 = 0;
    let totActual = 0;
    let totRemaining = 0;

    let html = '';
    kegiatanList.forEach((keg, idx) => {
        const pagu = Number(keg.jumlah) || 0;
        const t1 = Number(keg.tahap_1) || 0;
        const t2 = Number(keg.tahap_2) || 0;

        // Hitung realisasi dari finance_cashflow yang tertaut ke keg.id atau mencocokkan uraian
        let actual = 0;
        (Array.isArray(cashflowExpenses) ? cashflowExpenses : []).forEach(cf => {
            if (cf.rkas_kegiatan_id === keg.id || (cf.description && cf.description.toLowerCase().includes(keg.uraian.toLowerCase()))) {
                actual += Number(cf.amount) || 0;
            }
        });

        const remaining = pagu - actual;
        const percent = pagu > 0 ? ((actual / pagu) * 100).toFixed(1) : 0;
        const isOverBudget = remaining < 0;

        totPagu += pagu;
        totT1 += t1;
        totT2 += t2;
        totActual += actual;
        totRemaining += remaining;

        const statusBadge = isOverBudget
            ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800">Over-Budget</span>`
            : percent >= 100
                ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800">Terealisasi Penuh</span>`
                : `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">Aman</span>`;

        html += `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40 text-slate-700 dark:text-slate-200">
                <td class="px-3 py-2 text-center font-mono">${idx + 1}</td>
                <td class="px-3 py-2 font-mono text-[11px]">${keg.kode_program || '-'}</td>
                <td class="px-3.5 py-2 font-bold text-slate-800 dark:text-slate-100">${escapeHtml(keg.uraian)}</td>
                <td class="px-3 py-2 text-right font-mono font-bold text-indigo-700 dark:text-indigo-300">${formatRupiah(pagu)}</td>
                <td class="px-2.5 py-2 text-right font-mono text-sky-700 dark:text-sky-300">${formatRupiah(t1)}</td>
                <td class="px-2.5 py-2 text-right font-mono text-sky-700 dark:text-sky-300">${formatRupiah(t2)}</td>
                <td class="px-3 py-2 text-right font-mono font-bold text-amber-600 dark:text-amber-400">${formatRupiah(actual)}</td>
                <td class="px-3 py-2 text-right font-mono font-bold ${isOverBudget ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}">${formatRupiah(remaining)}</td>
                <td class="px-3 py-2 text-center font-mono font-bold ${isOverBudget ? 'text-rose-600' : ''}">${percent}%</td>
                <td class="px-3 py-2 text-center">${statusBadge}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;

    const tfPagu = document.getElementById('tfoot-real-pagu');
    if (tfPagu) tfPagu.textContent = formatRupiah(totPagu);

    const tfT1 = document.getElementById('tfoot-real-t1');
    if (tfT1) tfT1.textContent = formatRupiah(totT1);

    const tfT2 = document.getElementById('tfoot-real-t2');
    if (tfT2) tfT2.textContent = formatRupiah(totT2);

    const tfAct = document.getElementById('tfoot-real-actual');
    if (tfAct) tfAct.textContent = formatRupiah(totActual);

    const tfRem = document.getElementById('tfoot-real-remaining');
    if (tfRem) {
        tfRem.textContent = formatRupiah(totRemaining);
        tfRem.className = totRemaining < 0 ? 'px-3 py-3 text-right font-mono font-bold text-rose-300' : 'px-3 py-3 text-right font-mono font-bold text-emerald-300';
    }

    const tfPct = document.getElementById('tfoot-real-percent');
    if (tfPct) {
        const grandPct = totPagu > 0 ? ((totActual / totPagu) * 100).toFixed(1) : 0;
        tfPct.textContent = `${grandPct}%`;
    }
}

function populateParentKegiatanDropdown() {
    const selectEl = document.getElementById('input-belanja-parent-kegiatan');
    if (!selectEl) return;

    selectEl.innerHTML = '<option value="">-- Pilih Pos Kegiatan --</option>';
    const kegiatanList = (Array.isArray(rkasItems) ? rkasItems : []).filter(item => item.item_type === 'kegiatan');

    kegiatanList.forEach(keg => {
        const opt = document.createElement('option');
        opt.value = keg.id;
        opt.textContent = `${keg.kode_program ? keg.kode_program + ' ' : ''}${keg.uraian}`;
        selectEl.appendChild(opt);
    });
}

// =========================================================================
// 4. Pengalihan Tab & Mode Tampilan
// =========================================================================
window.handleFilterChange = async () => {
    const yearSelect = document.getElementById('filter-fiscal-year');
    if (yearSelect) {
        currentFiscalYear = parseInt(yearSelect.value, 10);
    }
    await loadRkasData();
};

window.switchVersionTab = async (version) => {
    currentVersionType = version;
    const btnMurni = document.getElementById('btn-tab-murni');
    const btnPerubahan = document.getElementById('btn-tab-perubahan');

    if (version === 'murni') {
        btnMurni?.classList.add('bg-white', 'dark:bg-slate-900', 'text-slate-800', 'dark:text-white', 'shadow-2xs');
        btnMurni?.classList.remove('text-slate-600', 'dark:text-slate-400');
        btnPerubahan?.classList.remove('bg-white', 'dark:bg-slate-900', 'text-slate-800', 'dark:text-white', 'shadow-2xs');
        btnPerubahan?.classList.add('text-slate-600', 'dark:text-slate-400');
    } else {
        btnPerubahan?.classList.add('bg-white', 'dark:bg-slate-900', 'text-slate-800', 'dark:text-white', 'shadow-2xs');
        btnPerubahan?.classList.remove('text-slate-600', 'dark:text-slate-400');
        btnMurni?.classList.remove('bg-white', 'dark:bg-slate-900', 'text-slate-800', 'dark:text-white', 'shadow-2xs');
        btnMurni?.classList.add('text-slate-600', 'dark:text-slate-400');
    }

    await loadRkasData();
};

window.switchViewMode = (mode) => {
    activeViewMode = mode;
    const btnMatrix = document.getElementById('btn-view-matrix');
    const btnReal = document.getElementById('btn-view-realization');
    const containerMatrix = document.getElementById('view-matrix-container');
    const containerReal = document.getElementById('view-realization-container');

    if (mode === 'matrix') {
        btnMatrix?.classList.add('bg-white', 'dark:bg-slate-900', 'text-slate-800', 'dark:text-white', 'shadow-2xs');
        btnMatrix?.classList.remove('text-slate-600', 'dark:text-slate-400');
        btnReal?.classList.remove('bg-white', 'dark:bg-slate-900', 'text-slate-800', 'dark:text-white', 'shadow-2xs');
        btnReal?.classList.add('text-slate-600', 'dark:text-slate-400');
        containerMatrix?.classList.remove('hidden');
        containerReal?.classList.add('hidden');
    } else {
        btnReal?.classList.add('bg-white', 'dark:bg-slate-900', 'text-slate-800', 'dark:text-white', 'shadow-2xs');
        btnReal?.classList.remove('text-slate-600', 'dark:text-slate-400');
        btnMatrix?.classList.remove('bg-white', 'dark:bg-slate-900', 'text-slate-800', 'dark:text-white', 'shadow-2xs');
        btnMatrix?.classList.add('text-slate-600', 'dark:text-slate-400');
        containerReal?.classList.remove('hidden');
        containerMatrix?.classList.add('hidden');
    }
};

// =========================================================================
// 5. Modal & Form Handlers (Pemasukan, Kegiatan, Rincian Belanja)
// =========================================================================
window.openIncomeModal = () => {
    const silpaInput = document.getElementById('input-silpa-amount');
    const incomeInput = document.getElementById('input-income-amount');
    const previewEl = document.getElementById('preview-total-income-modal');

    const silpa = Number(rkasHeader?.silpa_prev_year) || 0;
    const income = Number(rkasHeader?.penerimaan_current_year) || 0;

    if (silpaInput) silpaInput.value = silpa ? silpa.toLocaleString('id-ID') : '';
    if (incomeInput) incomeInput.value = income ? income.toLocaleString('id-ID') : '';
    if (previewEl) previewEl.textContent = formatRupiah(silpa + income);

    document.getElementById('modal-income-form')?.classList.remove('hidden');
};

window.saveIncomeSettings = async (e) => {
    e.preventDefault();
    try {
        const silpa = parseCurrencyString(document.getElementById('input-silpa-amount')?.value);
        const income = parseCurrencyString(document.getElementById('input-income-amount')?.value);
        const total = silpa + income;
        const nowIso = new Date().toISOString();

        const headerId = `${currentFiscalYear}_${currentVersionType}`;
        const payload = {
            id: headerId,
            year: currentFiscalYear,
            version_type: currentVersionType,
            silpa_prev_year: silpa,
            penerimaan_current_year: income,
            total_penerimaan: total,
            updated_at: nowIso
        };

        const { error } = await supabase
            .from('rkas_komite_headers')
            .upsert([payload]);

        if (error) throw error;

        if (typeof window.logAudit === 'function') {
            window.logAudit('UPDATE_RKAS_INCOME', headerId, null, payload, `Mengubah pagu penerimaan RKAS ${currentFiscalYear} (${currentVersionType}): SILPA Rp ${silpa.toLocaleString('id-ID')}, Penerimaan Rp ${income.toLocaleString('id-ID')}`);
        }

        showToast('Berhasil', 'Pagu penerimaan RKAS berhasil diperbarui!');
        document.getElementById('modal-income-form')?.classList.add('hidden');
        await loadRkasData();
    } catch (err) {
        console.error('[RKAS] Save Income Error:', err);
        showToast('Error', 'Gagal menyimpan penerimaan: ' + err.message, 'error');
    }
};

window.openKegiatanModal = () => {
    document.getElementById('input-kegiatan-id').value = '';
    document.getElementById('input-kegiatan-uraian').value = '';
    document.getElementById('input-kegiatan-tahap-1').value = '';
    document.getElementById('input-kegiatan-tahap-2').value = '';
    document.getElementById('preview-total-kegiatan-modal').textContent = 'Rp 0';

    document.getElementById('modal-kegiatan-form')?.classList.remove('hidden');
};

window.calcKegiatanTotalModal = () => {
    const t1 = parseCurrencyString(document.getElementById('input-kegiatan-tahap-1')?.value);
    const t2 = parseCurrencyString(document.getElementById('input-kegiatan-tahap-2')?.value);
    const el = document.getElementById('preview-total-kegiatan-modal');
    if (el) el.textContent = formatRupiah(t1 + t2);
};

window.saveKegiatan = async (e) => {
    e.preventDefault();
    try {
        const idVal = document.getElementById('input-kegiatan-id')?.value;
        const kodeProg = document.getElementById('input-kegiatan-kode-program')?.value || '';
        const uraian = document.getElementById('input-kegiatan-uraian')?.value.trim();
        const t1 = parseCurrencyString(document.getElementById('input-kegiatan-tahap-1')?.value);
        const t2 = parseCurrencyString(document.getElementById('input-kegiatan-tahap-2')?.value);
        const jumlah = t1 + t2;

        if (!uraian) {
            showToast('Peringatan', 'Uraian nama kegiatan wajib diisi.', 'warning');
            return;
        }

        const headerId = `${currentFiscalYear}_${currentVersionType}`;
        const nowIso = new Date().toISOString();
        const nextNo = (rkasItems.length > 0 ? Math.max(...rkasItems.map(i => i.no_urut || 0)) : 0) + 1;
        const itemId = idVal || ('keg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6));

        const payload = {
            id: itemId,
            header_id: headerId,
            no_urut: nextNo,
            item_type: 'kegiatan',
            kode_program: kodeProg,
            kode_rekening: '',
            uraian: uraian,
            volume: 0,
            satuan: '',
            tarif_harga: 0,
            jumlah: jumlah,
            tahap_1: t1,
            tahap_2: t2,
            updated_at: nowIso
        };

        const { error } = await supabase
            .from('rkas_komite_items')
            .upsert([payload]);

        if (error) throw error;

        showToast('Berhasil', 'Pos kegiatan RKAS berhasil disimpan!');
        document.getElementById('modal-kegiatan-form')?.classList.add('hidden');
        await loadRkasData();
    } catch (err) {
        console.error('[RKAS] Save Kegiatan Error:', err);
        showToast('Error', 'Gagal menyimpan kegiatan: ' + err.message, 'error');
    }
};

window.openAddDetailModal = (parentKegiatanId) => {
    document.getElementById('input-belanja-id').value = '';
    const parentSelect = document.getElementById('input-belanja-parent-kegiatan');
    if (parentSelect && parentKegiatanId) {
        parentSelect.value = parentKegiatanId;
    }
    document.getElementById('input-belanja-kode-rek').value = '';
    document.getElementById('input-belanja-uraian').value = '';
    document.getElementById('input-belanja-volume').value = '1';
    document.getElementById('input-belanja-satuan').value = '';
    document.getElementById('input-belanja-tarif').value = '';
    document.getElementById('preview-total-belanja-modal').textContent = 'Rp 0';

    document.getElementById('modal-belanja-form')?.classList.remove('hidden');
};

window.calcBelanjaTotalModal = () => {
    const vol = parseFloat(document.getElementById('input-belanja-volume')?.value) || 0;
    const tarif = parseCurrencyString(document.getElementById('input-belanja-tarif')?.value);
    const total = vol * tarif;
    const el = document.getElementById('preview-total-belanja-modal');
    if (el) el.textContent = formatRupiah(total);
};

window.saveBelanjaItem = async (e) => {
    e.preventDefault();
    try {
        const idVal = document.getElementById('input-belanja-id')?.value;
        const parentId = document.getElementById('input-belanja-parent-kegiatan')?.value;
        const kodeRek = document.getElementById('input-belanja-kode-rek')?.value.trim();
        const uraian = document.getElementById('input-belanja-uraian')?.value.trim();
        const vol = parseFloat(document.getElementById('input-belanja-volume')?.value) || 1;
        const satuan = document.getElementById('input-belanja-satuan')?.value.trim();
        const tarif = parseCurrencyString(document.getElementById('input-belanja-tarif')?.value);
        const jumlah = vol * tarif;

        if (!parentId || !kodeRek || !uraian || !satuan || tarif <= 0) {
            showToast('Peringatan', 'Harap lengkapi seluruh rincian belanja dengan benar.', 'warning');
            return;
        }

        const parentKeg = rkasItems.find(i => i.id === parentId);
        const kodeProg = parentKeg?.kode_program || '';

        const headerId = `${currentFiscalYear}_${currentVersionType}`;
        const nowIso = new Date().toISOString();
        const nextNo = (rkasItems.length > 0 ? Math.max(...rkasItems.map(i => i.no_urut || 0)) : 0) + 1;
        const itemId = idVal || ('item_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6));

        const payload = {
            id: itemId,
            header_id: headerId,
            no_urut: nextNo,
            item_type: 'belanja_detail',
            kode_program: kodeProg,
            kode_rekening: kodeRek,
            uraian: uraian,
            volume: vol,
            satuan: satuan,
            tarif_harga: tarif,
            jumlah: jumlah,
            tahap_1: 0,
            tahap_2: 0,
            parent_kegiatan_id: parentId,
            updated_at: nowIso
        };

        const { error } = await supabase
            .from('rkas_komite_items')
            .upsert([payload]);

        if (error) throw error;

        showToast('Berhasil', 'Rincian item belanja berhasil disimpan!');
        document.getElementById('modal-belanja-form')?.classList.add('hidden');
        await loadRkasData();
    } catch (err) {
        console.error('[RKAS] Save Belanja Error:', err);
        showToast('Error', 'Gagal menyimpan rincian: ' + err.message, 'error');
    }
};

// =========================================================================
// 6. Konfirmasi Hapus Item
// =========================================================================
window.confirmDeleteItem = (itemId, uraian) => {
    itemToDelete = itemId;
    const txtEl = document.getElementById('modal-delete-text');
    if (txtEl) {
        txtEl.innerHTML = `Apakah Anda yakin ingin menghapus <strong>"${escapeHtml(uraian)}"</strong>? Seluruh sub-rincian terkait juga akan terhapus.`;
    }
    document.getElementById('modal-confirm-delete')?.classList.remove('hidden');
};

window.executeDeleteItem = async () => {
    if (!itemToDelete) return;
    try {
        // Hapus item dan detail anaknya (jika ada)
        const { error } = await supabase
            .from('rkas_komite_items')
            .delete()
            .or(`id.eq.${itemToDelete},parent_kegiatan_id.eq.${itemToDelete}`);

        if (error) throw error;

        showToast('Berhasil', 'Item RKAS berhasil dihapus.');
        document.getElementById('modal-confirm-delete')?.classList.add('hidden');
        itemToDelete = null;
        await loadRkasData();
    } catch (err) {
        console.error('[RKAS] Delete Error:', err);
        showToast('Error', 'Gagal menghapus item: ' + err.message, 'error');
    }
};

// =========================================================================
// 7. Salin dari RKAS Murni ke RKAS Perubahan (1-Klik Clone)
// =========================================================================
window.openCloneModal = () => {
    document.getElementById('modal-clone-rkas')?.classList.remove('hidden');
};

window.executeCloneMurni = async () => {
    try {
        const sourceHeaderId = `${currentFiscalYear}_murni`;
        const targetHeaderId = `${currentFiscalYear}_perubahan`;

        // 1. Ambil data RKAS Murni
        const { data: sourceHeader, error: hErr } = await supabase
            .from('rkas_komite_headers')
            .select('*')
            .eq('id', sourceHeaderId)
            .maybeSingle();

        if (hErr) throw hErr;
        if (!sourceHeader) {
            showToast('Peringatan', `Data RKAS Murni tahun ${currentFiscalYear} belum tersedia untuk disalin.`, 'warning');
            return;
        }

        const { data: sourceItems, error: iErr } = await supabase
            .from('rkas_komite_items')
            .select('*')
            .eq('header_id', sourceHeaderId);

        if (iErr) throw iErr;

        const nowIso = new Date().toISOString();

        // 2. Duplikasi Header ke Perubahan
        const newHeader = {
            ...sourceHeader,
            id: targetHeaderId,
            version_type: 'perubahan',
            revision_no: (sourceHeader.revision_no || 0) + 1,
            status: 'draft',
            signed_treasurer_by: null,
            signed_treasurer_at: null,
            reviewed_principal_by: null,
            reviewed_principal_at: null,
            approved_committee_by: null,
            approved_committee_at: null,
            updated_at: nowIso
        };

        const { error: insHErr } = await supabase
            .from('rkas_komite_headers')
            .upsert([newHeader]);

        if (insHErr) throw insHErr;

        // 3. Mapping ID lama ke ID baru agar parent_kegiatan_id tetap sinkron
        const idMap = {};
        const newItems = (Array.isArray(sourceItems) ? sourceItems : []).map(item => {
            const newId = 'perubahan_' + item.id;
            idMap[item.id] = newId;
            return {
                ...item,
                id: newId,
                header_id: targetHeaderId,
                updated_at: nowIso
            };
        });

        // Set parent_kegiatan_id baru
        newItems.forEach(item => {
            if (item.parent_kegiatan_id && idMap[item.parent_kegiatan_id]) {
                item.parent_kegiatan_id = idMap[item.parent_kegiatan_id];
            }
        });

        if (newItems.length > 0) {
            const { error: insIErr } = await supabase
                .from('rkas_komite_items')
                .insert(newItems);
            if (insIErr) throw insIErr;
        }

        showToast('Berhasil', `Berhasil menyalin data dari RKAS Murni ke RKAS Perubahan (${newItems.length} item).`);
        document.getElementById('modal-clone-rkas')?.classList.add('hidden');
        await loadRkasData();
    } catch (err) {
        console.error('[RKAS] Clone Error:', err);
        showToast('Error', 'Gagal menyalin RKAS: ' + err.message, 'error');
    }
};

// =========================================================================
// 8. Workflow Pengesahan / Approval Bertingkat (3 Pihak)
// =========================================================================
window.promptApproval = (actionType) => {
    pendingApprovalAction = actionType;
    const titleEl = document.getElementById('modal-approval-title');
    const descEl = document.getElementById('modal-approval-desc');

    if (actionType === 'sign_treasurer') {
        if (titleEl) titleEl.textContent = 'Tanda Tangan Bendahara Komite';
        if (descEl) descEl.textContent = 'Dengan menandatangani, Anda menyatakan draf RKAS ini telah disusun sesuai perencanaan dan siap ditelaah Kepala Sekolah.';
    } else if (actionType === 'review_principal') {
        if (titleEl) titleEl.textContent = 'Telaah Kepala Sekolah';
        if (descEl) descEl.textContent = 'Dengan menyetujui, Anda menyatakan RKAS ini telah diketahui dan memenuhi standar mutu operasional sekolah untuk diteruskan ke Ketua Komite.';
    } else if (actionType === 'approve_committee') {
        if (titleEl) titleEl.textContent = 'Persetujuan Ketua Komite Sekolah';
        if (descEl) descEl.textContent = 'Dengan menyahkan, RKAS ini resmi disetujui sebagai acuan sah realisasi anggaran partisipasi masyarakat sekolah.';
    }

    document.getElementById('modal-approval')?.classList.remove('hidden');
};

window.executeApproval = async () => {
    if (!pendingApprovalAction) return;
    try {
        const headerId = `${currentFiscalYear}_${currentVersionType}`;
        const nowIso = new Date().toISOString();
        let updatePayload = { updated_at: nowIso };

        if (pendingApprovalAction === 'sign_treasurer') {
            updatePayload.status = 'signed_treasurer';
            updatePayload.signed_treasurer_by = userName;
            updatePayload.signed_treasurer_at = nowIso;
        } else if (pendingApprovalAction === 'review_principal') {
            updatePayload.status = 'reviewed_principal';
            updatePayload.reviewed_principal_by = userName;
            updatePayload.reviewed_principal_at = nowIso;
        } else if (pendingApprovalAction === 'approve_committee') {
            updatePayload.status = 'approved_committee';
            updatePayload.approved_committee_by = userName;
            updatePayload.approved_committee_at = nowIso;
        }

        const { error } = await supabase
            .from('rkas_komite_headers')
            .update(updatePayload)
            .eq('id', headerId);

        if (error) throw error;

        if (typeof window.logAudit === 'function') {
            window.logAudit('APPROVE_RKAS', headerId, null, updatePayload, `Pengesahan RKAS ${currentFiscalYear} (${currentVersionType}): aksi ${pendingApprovalAction} oleh ${userName}`);
        }

        showToast('Berhasil', 'Pengesahan RKAS berhasil dicatat!');
        document.getElementById('modal-approval')?.classList.add('hidden');
        pendingApprovalAction = null;
        await loadRkasData();
    } catch (err) {
        console.error('[RKAS] Approval Error:', err);
        showToast('Error', 'Gagal memproses pengesahan: ' + err.message, 'error');
    }
};

// =========================================================================
// 9. Import File Excel (.xlsx) dengan SheetJS
// =========================================================================
window.openImportModal = () => {
    parsedImportData = null;
    const fileInput = document.getElementById('input-import-file');
    if (fileInput) fileInput.value = '';
    document.getElementById('import-preview-wrapper')?.classList.add('hidden');
    document.getElementById('btn-confirm-import')?.setAttribute('disabled', 'true');
    document.getElementById('modal-import-excel')?.classList.remove('hidden');
};

window.handleImportFileSelected = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (typeof XLSX === 'undefined') {
        showToast('Error', 'Pustaka SheetJS (XLSX) belum siap dimuat.', 'error');
        return;
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
        try {
            const data = new Uint8Array(evt.target.result);
            const workbook = XLSX.read(data, { type: 'array' });

            // Cari sheet bernama 'RKAS' (atau sheet pertama)
            let sheetName = workbook.SheetNames.find(n => n.toUpperCase() === 'RKAS');
            if (!sheetName) sheetName = workbook.SheetNames[0];

            const worksheet = workbook.Sheets[sheetName];
            const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

            parseExcelRkasRows(rawRows);
        } catch (err) {
            console.error('[RKAS] Parse Excel Error:', err);
            showToast('Error', 'Gagal membaca berkas Excel: ' + err.message, 'error');
        }
    };
    reader.readAsArrayBuffer(file);
};

function parseExcelRkasRows(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        showToast('Peringatan', 'Berkas Excel kosong atau tidak terbaca.', 'warning');
        return;
    }

    let silpa = 0;
    let income = 0;
    const items = [];

    let isSectionBelanja = false;
    let currentParentKegiatanId = null;

    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!Array.isArray(r) || r.length === 0) continue;

        const rowText = r.map(c => String(c).trim()).join(' ').toUpperCase();

        // 1. Ekstrak Bagian A: Penerimaan (SILPA & Penerimaan Komite)
        if (rowText.includes('SILPA')) {
            for (let c = 0; c < r.length; c++) {
                const val = parseCurrencyString(r[c]);
                if (val > 1000) { silpa = val; break; }
            }
        }
        if (rowText.includes('PENERIMAAN') && !rowText.includes('TOTAL') && !rowText.includes('PESERTA DIDIK')) {
            for (let c = 0; c < r.length; c++) {
                const val = parseCurrencyString(r[c]);
                if (val > 1000) { income = val; break; }
            }
        }

        // 2. Deteksi Awal Bagian B: Belanja
        if (rowText.includes('B. BELANJA') || (rowText.includes('KODE REKENING') && rowText.includes('URAIAN'))) {
            isSectionBelanja = true;
            continue;
        }

        if (isSectionBelanja) {
            // Kolom Excel:
            // 0: No Urut, 1: Kode Rekening, 2: Kode Program, 3: Uraian, 4: Volume, 5: Satuan, 6: Tarif, 7: Jumlah, 8: Tahap 1, 9: Tahap 2
            const colNo = parseInt(String(r[0]).trim(), 10);
            const colKodeRek = String(r[1] || '').trim();
            const colKodeProg = String(r[2] || '').trim();
            const colUraian = String(r[3] || '').trim();
            const colVol = parseFloat(String(r[4] || '').replace(',', '.')) || 0;
            const colSatuan = String(r[5] || '').trim();
            const colTarif = parseCurrencyString(r[6]);
            const colJumlah = parseCurrencyString(r[7]);
            const colT1 = parseCurrencyString(r[8]);
            const colT2 = parseCurrencyString(r[9]);

            if (!colUraian && !colKodeRek && !colKodeProg) continue;
            if (rowText.includes('JUMLAH BELANJA') || rowText.includes('TOTAL')) continue;

            // Klasifikasi Tipe Item
            let itemType = 'belanja_detail';
            let parentId = currentParentKegiatanId;

            if (colKodeRek === '') {
                // Baris tanpa kode rekening adalah baris header hirarki
                if (colKodeProg.match(/^\d{2}\.$/)) {
                    itemType = 'standar';
                    currentParentKegiatanId = null;
                } else if (colKodeProg.match(/^\d{2}\.\d{2}\.?$/)) {
                    itemType = 'program';
                    currentParentKegiatanId = null;
                } else if (colKodeProg.match(/^\d{2}\.\d{2}\.\d{2}\.?$/) && (colT1 > 0 || colT2 > 0 || colVol === 0)) {
                    // Cek apakah ini Kegiatan (memiliki alokasi tahap atau nama kegiatan operasional)
                    if (colT1 > 0 || colT2 > 0 || !colUraian.toLowerCase().startsWith('pelaksanaan kegiatan')) {
                        itemType = 'kegiatan';
                        const generatedId = 'keg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
                        currentParentKegiatanId = generatedId;
                        parentId = generatedId;
                    } else {
                        itemType = 'sub_program';
                        currentParentKegiatanId = null;
                    }
                } else {
                    itemType = 'kegiatan';
                    const generatedId = 'keg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
                    currentParentKegiatanId = generatedId;
                    parentId = generatedId;
                }
            } else {
                itemType = 'belanja_detail';
                parentId = currentParentKegiatanId;
            }

            const itemId = itemType === 'kegiatan' ? parentId : ('item_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));

            items.push({
                id: itemId,
                no_urut: colNo || (items.length + 1),
                item_type: itemType,
                kode_program: colKodeProg,
                kode_rekening: colKodeRek,
                uraian: colUraian,
                volume: colVol,
                satuan: colSatuan,
                tarif_harga: colTarif,
                jumlah: colJumlah || (colVol * colTarif) || (colT1 + colT2),
                tahap_1: colT1,
                tahap_2: colT2,
                parent_kegiatan_id: parentId
            });
        }
    }

    parsedImportData = { silpa, income, items };

    // Tampilkan Pratinjau
    const previewWrapper = document.getElementById('import-preview-wrapper');
    const badgeEl = document.getElementById('import-preview-badge');
    const tbody = document.getElementById('import-preview-tbody');
    const btnConfirm = document.getElementById('btn-confirm-import');

    if (badgeEl) badgeEl.textContent = `${items.length} Baris Belanja (SILPA: ${formatRupiah(silpa)}, Pemasukan: ${formatRupiah(income)})`;

    if (tbody) {
        tbody.innerHTML = items.slice(0, 15).map(item => `
            <tr>
                <td class="p-2">${item.no_urut}</td>
                <td class="p-2 font-mono text-[11px]">${item.kode_rekening || item.kode_program}</td>
                <td class="p-2 font-semibold truncate max-w-xs">${escapeHtml(item.uraian)}</td>
                <td class="p-2 text-right font-mono">${formatRupiah(item.jumlah)}</td>
            </tr>
        `).join('') + (items.length > 15 ? `<tr><td colspan="4" class="p-2 text-center text-slate-400 italic">... dan ${items.length - 15} baris lainnya</td></tr>` : '');
    }

    if (previewWrapper) previewWrapper.classList.remove('hidden');
    if (btnConfirm) btnConfirm.removeAttribute('disabled');
}

window.commitImportExcel = async () => {
    if (!parsedImportData || !parsedImportData.items || parsedImportData.items.length === 0) {
        showToast('Peringatan', 'Tidak ada data belanja yang siap diterapkan.', 'warning');
        return;
    }

    try {
        const headerId = `${currentFiscalYear}_${currentVersionType}`;
        const nowIso = new Date().toISOString();
        const { silpa, income, items } = parsedImportData;
        const totalIncome = silpa + income;

        // 1. Simpan Header
        const headerPayload = {
            id: headerId,
            year: currentFiscalYear,
            version_type: currentVersionType,
            silpa_prev_year: silpa,
            penerimaan_current_year: income,
            total_penerimaan: totalIncome,
            status: 'draft',
            updated_at: nowIso
        };

        const { error: hErr } = await supabase
            .from('rkas_komite_headers')
            .upsert([headerPayload]);

        if (hErr) throw hErr;

        // 2. Bersihkan item belanja lama pada versi & tahun terpilih
        await supabase
            .from('rkas_komite_items')
            .delete()
            .eq('header_id', headerId);

        // 3. Masukkan item baru secara bertahap (batch per 50 item)
        const batchSize = 50;
        for (let i = 0; i < items.length; i += batchSize) {
            const chunk = items.slice(i, i + batchSize).map(item => ({
                ...item,
                header_id: headerId,
                created_at: nowIso,
                updated_at: nowIso
            }));

            const { error: chunkErr } = await supabase
                .from('rkas_komite_items')
                .insert(chunk);

            if (chunkErr) throw chunkErr;
        }

        if (typeof window.logAudit === 'function') {
            window.logAudit('IMPORT_RKAS_EXCEL', headerId, null, { totalItems: items.length }, `Import ${items.length} baris RKAS Komite dari berkas Excel untuk tahun ${currentFiscalYear} (${currentVersionType})`);
        }

        showToast('Berhasil', `Berhasil mengimpor ${items.length} baris RKAS Komite!`);
        document.getElementById('modal-import-excel')?.classList.add('hidden');
        await loadRkasData();

    } catch (err) {
        console.error('[RKAS] Commit Import Error:', err);
        showToast('Error', 'Gagal menerapkan impor: ' + err.message, 'error');
    }
};

// =========================================================================
// 10. Ekspor Excel Spreadsheet (.xlsx)
// =========================================================================
window.exportRkasExcel = () => {
    if (typeof XLSX === 'undefined') {
        showToast('Error', 'Pustaka SheetJS (XLSX) belum tersedia.', 'error');
        return;
    }

    try {
        const rows = [];

        // Header Dokumen
        rows.push([`RENCANA KEGIATAN DAN ANGGARAN SEKOLAH (RKAS) - KOMITE`]);
        rows.push([`SMA NEGERI NUSANTARA - KABUPATEN KARANGASEM`]);
        rows.push([`TAHUN ANGGARAN ${currentFiscalYear} (${currentVersionType.toUpperCase()})`]);
        rows.push([`Sumber Dana : Dana Partisipasi Masyarakat (KOMITE)`]);
        rows.push([]);

        // Bagian A: Penerimaan
        rows.push(['A. PENERIMAAN']);
        rows.push(['No. Kode', 'Uraian Penerima', 'Jumlah']);
        rows.push(['', `SILPA ${currentFiscalYear - 1}`, Number(rkasHeader?.silpa_prev_year) || 0]);
        rows.push(['', `PENERIMAAN ${currentFiscalYear}`, Number(rkasHeader?.penerimaan_current_year) || 0]);
        rows.push(['TOTAL', 'Total Penerimaan', Number(rkasHeader?.total_penerimaan) || 0]);
        rows.push([]);

        // Bagian B: Belanja
        rows.push(['B. BELANJA']);
        rows.push([
            'No. Urut',
            'Kode Rekening',
            'Kode Program',
            'Uraian',
            'Volume',
            'Satuan',
            'Tarif Harga',
            'Jumlah',
            'Tahap 1',
            'Tahap 2'
        ]);

        (Array.isArray(rkasItems) ? rkasItems : []).forEach(item => {
            rows.push([
                item.no_urut || '',
                item.kode_rekening || '',
                item.kode_program || '',
                item.uraian || '',
                item.volume > 0 ? item.volume : '',
                item.satuan || '',
                item.tarif_harga > 0 ? item.tarif_harga : '',
                item.jumlah > 0 ? item.jumlah : '',
                item.tahap_1 > 0 ? item.tahap_1 : '',
                item.tahap_2 > 0 ? item.tahap_2 : ''
            ]);
        });

        // Tanda Tangan 3 Pihak di Bawah Dokumen
        rows.push([]);
        rows.push([]);
        rows.push([
            '',
            '',
            'Mengetahui,',
            '',
            '',
            '',
            "Denpasar, " + new Date().toLocaleDateString('id-ID'),
            ''
        ]);
        rows.push([
            '',
            'Bendahara Komite,',
            "Kepala SMA Negeri Nusantara,",
            '',
            '',
            '',
            'Ketua Komite Sekolah,'
        ]);
        rows.push([]);
        rows.push([]);
        rows.push([]);
        rows.push([
            '',
            userName || 'Bendahara Komite',
            SCHOOL_CONFIG.principalName || 'I Wayan Suteja, S.Pd., M.Pd.',
            '',
            '',
            '',
            rkasHeader?.committee_chair_name || 'I Gede Sukasari, S.ST.'
        ]);
        rows.push([
            '',
            '',
            'NIP. ' + (SCHOOL_CONFIG.principalNIP || '19681231 199512 1 024'),
            ''
        ]);

        const worksheet = XLSX.utils.aoa_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'RKAS');

        const fileName = `RKAS_KOMITE_SMANTARA_${currentFiscalYear}_${currentVersionType.toUpperCase()}.xlsx`;
        XLSX.writeFile(workbook, fileName);

        showToast('Berhasil', 'Berkas Excel RKAS berhasil diunduh: ' + fileName);
    } catch (err) {
        console.error('[RKAS] Export Excel Error:', err);
        showToast('Error', 'Gagal mengekspor berkas Excel: ' + err.message, 'error');
    }
};

// =========================================================================
// 11. Cetak Lembar Dokumen Resmi RKAS (Kop Sekolah & Tanda Tangan 3 Pihak)
// =========================================================================
window.printOfficialRkas = () => {
    try {
        const kopUrl = SCHOOL_CONFIG.kopPath || 'assets/kop.png';
        const principalName = SCHOOL_CONFIG.principalName || 'I Wayan Suteja, S.Pd., M.Pd.';
        const principalNIP = SCHOOL_CONFIG.principalNIP || '19681231 199512 1 024';
        const chairName = rkasHeader?.committee_chair_name || 'I Gede Sukasari, S.ST.';

        const printWin = window.open('', '_blank');
        if (!printWin) {
            showToast('Peringatan', 'Harap izinkan pop-up jendela untuk mencetak dokumen.', 'warning');
            return;
        }

        let tableRowsHtml = '';
        (Array.isArray(rkasItems) ? rkasItems : []).forEach(item => {
            const isStandar = item.item_type === 'standar';
            const isProg = item.item_type === 'program';
            const isSubProg = item.item_type === 'sub_program';
            const isKeg = item.item_type === 'kegiatan';

            let rowBg = '';
            let uraianStyle = 'padding-left: 24px;';
            if (isStandar) {
                rowBg = 'background-color: #ffe4e6; font-weight: bold;';
                uraianStyle = 'padding-left: 4px; font-weight: bold;';
            } else if (isProg) {
                rowBg = 'background-color: #d1fae5; font-weight: bold;';
                uraianStyle = 'padding-left: 10px; font-weight: bold;';
            } else if (isSubProg) {
                rowBg = 'background-color: #fef3c7; font-weight: 600;';
                uraianStyle = 'padding-left: 16px; font-weight: 600;';
            } else if (isKeg) {
                rowBg = 'background-color: #e0f2fe; font-weight: bold;';
                uraianStyle = 'padding-left: 20px; font-weight: bold;';
            }

            tableRowsHtml += `
                <tr style="${rowBg}">
                    <td style="border: 1px solid #333; padding: 4px; text-align: center;">${item.no_urut || ''}</td>
                    <td style="border: 1px solid #333; padding: 4px; font-family: monospace;">${item.kode_rekening || ''}</td>
                    <td style="border: 1px solid #333; padding: 4px; font-family: monospace;">${item.kode_program || ''}</td>
                    <td style="border: 1px solid #333; padding: 4px; ${uraianStyle}">${escapeHtml(item.uraian)}</td>
                    <td style="border: 1px solid #333; padding: 4px; text-align: center;">${item.volume > 0 ? item.volume : ''}</td>
                    <td style="border: 1px solid #333; padding: 4px; text-align: center;">${escapeHtml(item.satuan)}</td>
                    <td style="border: 1px solid #333; padding: 4px; text-align: right; font-family: monospace;">${item.tarif_harga > 0 ? formatRupiah(item.tarif_harga) : ''}</td>
                    <td style="border: 1px solid #333; padding: 4px; text-align: right; font-family: monospace; font-weight: bold;">${item.jumlah > 0 ? formatRupiah(item.jumlah) : '-'}</td>
                    <td style="border: 1px solid #333; padding: 4px; text-align: right; font-family: monospace;">${item.tahap_1 > 0 ? formatRupiah(item.tahap_1) : ''}</td>
                    <td style="border: 1px solid #333; padding: 4px; text-align: right; font-family: monospace;">${item.tahap_2 > 0 ? formatRupiah(item.tahap_2) : ''}</td>
                </tr>
            `;
        });

        const printContent = `
            <!DOCTYPE html>
            <html lang="id">
            <head>
                <meta charset="UTF-8">
                <title>Cetak RKAS Komite - ${currentFiscalYear}</title>
                <style>
                    @page { size: A4 landscape; margin: 15mm; }
                    body { font-family: Arial, sans-serif; font-size: 10px; color: #111; margin: 0; padding: 0; }
                    .header-kop { text-align: center; margin-bottom: 12px; border-bottom: 2px double #000; padding-bottom: 8px; }
                    .header-kop img { max-width: 100%; height: auto; max-height: 90px; }
                    .doc-title { text-align: center; margin: 10px 0; }
                    .doc-title h2 { margin: 0 0 4px 0; font-size: 13px; text-transform: uppercase; }
                    .doc-title p { margin: 0; font-size: 11px; }
                    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
                    th { border: 1px solid #333; padding: 6px; background-color: #f1f5f9; text-align: center; font-size: 10px; text-transform: uppercase; }
                    .sig-table { margin-top: 30px; width: 100%; border: none; }
                    .sig-table td { border: none; text-align: center; vertical-align: top; width: 33.3%; }
                </style>
            </head>
            <body>
                <div class="header-kop">
                    <img src="${kopUrl}" alt="Kop Sekolah" onerror="this.style.display='none'">
                    <div><strong>PEMERINTAH PROVINSI BALI - DINAS PENDIDIKAN KEPEMUDAAN DAN OLAHRAGA</strong></div>
                    <div style="font-size: 12px; font-weight: bold;">SMA NEGERI NUSANTARA</div>
                    <div style="font-size: 9px;">${SCHOOL_CONFIG.schoolAddress || "Jalan Raya Tista - Singaraja, Kec. Denpasar, Kab. Karangasem"}</div>
                </div>

                <div class="doc-title">
                    <h2>RENCANA KEGIATAN DAN ANGGARAN SEKOLAH (RKAS) KOMITE</h2>
                    <p>TAHUN ANGGARAN ${currentFiscalYear} - <strong>${currentVersionType.toUpperCase()}</strong></p>
                    <p>Sumber Dana: Dana Partisipasi Masyarakat (KOMITE)</p>
                </div>

                <div style="margin-top: 10px; margin-bottom: 4px;"><strong>A. PENERIMAAN</strong></div>
                <table>
                    <thead>
                        <tr><th style="width: 80px;">No. Kode</th><th>Uraian Sumber Dana</th><th style="width: 140px;">Jumlah</th></tr>
                    </thead>
                    <tbody>
                        <tr><td>-</td><td>SILPA Tahun ${currentFiscalYear - 1}</td><td style="text-align: right; font-family: monospace;">${formatRupiah(rkasHeader?.silpa_prev_year)}</td></tr>
                        <tr><td>-</td><td>PENERIMAAN Iuran Komite Tahun ${currentFiscalYear}</td><td style="text-align: right; font-family: monospace;">${formatRupiah(rkasHeader?.penerimaan_current_year)}</td></tr>
                        <tr style="font-weight: bold; background-color: #f1f5f9;"><td>TOTAL</td><td>Total Penerimaan</td><td style="text-align: right; font-family: monospace;">${formatRupiah(rkasHeader?.total_penerimaan)}</td></tr>
                    </tbody>
                </table>

                <div style="margin-top: 14px; margin-bottom: 4px;"><strong>B. BELANJA</strong></div>
                <table>
                    <thead>
                        <tr>
                            <th rowspan="2" style="width: 30px;">No</th>
                            <th rowspan="2" style="width: 100px;">Kode Rekening</th>
                            <th rowspan="2" style="width: 70px;">Kode Program</th>
                            <th rowspan="2">Uraian Belanja</th>
                            <th colspan="3">Rincian Perhitungan</th>
                            <th rowspan="2" style="width: 90px;">Jumlah</th>
                            <th colspan="2">Tahap</th>
                        </tr>
                        <tr>
                            <th style="width: 40px;">Vol</th>
                            <th style="width: 50px;">Sat</th>
                            <th style="width: 75px;">Tarif</th>
                            <th style="width: 75px;">Tahap 1</th>
                            <th style="width: 75px;">Tahap 2</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRowsHtml}
                    </tbody>
                </table>

                <table class="sig-table">
                    <tr>
                        <td>
                            Mengetahui,<br>
                            <strong>Bendahara Komite,</strong><br><br><br><br>
                            <u>${userName || 'Bendahara Komite'}</u>
                        </td>
                        <td>
                            Mengesahkan,<br>
                            <strong>Kepala SMA Negeri Nusantara,</strong><br><br><br><br>
                            <u>${principalName}</u><br>
                            NIP. ${principalNIP}
                        </td>
                        <td>
                            Denpasar, ${new Date().toLocaleDateString('id-ID')}<br>
                            Menyetujui,<br>
                            <strong>Ketua Komite Sekolah,</strong><br><br><br><br>
                            <u>${chairName}</u>
                        </td>
                    </tr>
                </table>

                <script>
                    window.onload = function() {
                        setTimeout(() => { window.print(); }, 400);
                    };
                </script>
            </body>
            </html>
        `;

        printWin.document.open();
        printWin.document.write(printContent);
        printWin.document.close();

    } catch (err) {
        console.error('[RKAS] Print Error:', err);
        showToast('Error', 'Gagal mencetak dokumen: ' + err.message, 'error');
    }
};

// Sanitasi XSS
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

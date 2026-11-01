import { sarprasStore, callSarprasAction } from './sarpras-master-assets-client.mjs';
window.smsrSarpras = window.masterSarpras = window.smsrSarpras || window.masterSarpras || {};
/**
 * js/page-sarpras.js - Logika Manajemen Sarana & Prasarana Terpadu SIMAS 2
 * 
 * Mencakup:
 * 1. Master Data (Tanah, Bangunan, Barang Multi-Stok, Kelompok Barang, Jenis Bantuan)
 * 2. Alur Pengadaan (Permintaan / Usulan Barang Baru & Habis Pakai)
 * 3. Alur Penggunaan (Peminjaman Aktif & Pengembalian Atomik via Edge RPC)
 * 4. Alur Pemeliharaan (Pelaporan Kerusakan Fasilitas & Tindakan Perbaikan)
 * 5. Pelaporan & Ekspor (Cetak Berkop Resmi Sekolah & Ekspor Excel via SheetJS)
 * 6. Database SSOT: Cloudflare D1 & Worker Otorisasi
 * 
 * Versi: 26.09.09.1
 */

import { auth, SCHOOL_CONFIG } from './config.js';
import {
    initLayout,
    showToast,
    escapeHTML,
    formatDateIndo,
    getLocalISODate,
    getWitaISODate,
    hasRole,
    getAllUserRoles,
    getLocalCache
} from './global.js';

// =========================================================================
// STATE MANAGEMENT
// =========================================================================
let currentUser = null;
let isSarprasAdmin = false;
let currentFetchSeq = 0;
let lastFocusedElement = null;

let dataTanah = [];
let dataBangunan = [];
let dataBarang = [];
let dataKelompok = [];
let dataBantuan = [];
let dataPermintaan = [];
let dataPeminjaman = [];
let dataPerbaikan = [];
let dataGTK = [];

let activeTab = 'dashboard';
let activeMasterSubtab = 'barang';
let activePinjamSubtab = 'aktif';

// =========================================================================
// INITIALIZATION & AUTH GUARD
// =========================================================================
let assetsMounted = false;
let assetsMounting = null;
export async function mountSmsrSarprasAssets() {
    if (assetsMounted) return;
    if (assetsMounting) return assetsMounting;
    assetsMounting = (async () => {
        if (auth.authStateReady) await auth.authStateReady();
        if (!auth.currentUser) throw new Error('Silakan masuk untuk memuat data aset sekolah.');
        currentUser = auth.currentUser;
        const roles = getAllUserRoles ? getAllUserRoles() : [];
        isSarprasAdmin = roles.some(role => ['super_admin', 'sarpras', 'admin_sarpras'].includes(role));
        document.getElementById('btn-add-smsr-asset')?.classList.toggle('hidden', !isSarprasAdmin);
        await loadAllSarprasData();
        setupGlobalModalAccessibility();
        window.smsrSarpras.switchSarprasTab('master', false);
        window.smsrSarpras.switchMasterSubtab('tanah');
        assetsMounted = true;
    })();
    try { await assetsMounting; } finally { assetsMounting = null; }
}
export const mountMasterSarprasAssets = mountSmsrSarprasAssets;

function handleHashNavigation() {
    const hash = window.location.hash.replace('#', '').toLowerCase();
    if (['dashboard', 'master', 'pengadaan', 'peminjaman', 'pemeliharaan', 'laporan'].includes(hash)) {
        window.smsrSarpras.switchSarprasTab(hash, false);
    }
}

// =========================================================================
// DATA FETCHING & SYNCHRONIZATION (D1)
// =========================================================================
function renderTableSkeleton(tbodyId, cols = 10, rows = 5) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    let html = '';
    for (let i = 0; i < rows; i++) {
        html += '<tr class="animate-pulse">';
        for (let c = 0; c < cols; c++) {
            const widthClass = c === 0 ? 'w-6 mx-auto' : (c === 2 ? 'w-3/4' : (c === 1 ? 'w-16' : 'w-20'));
            html += `<td class="py-3 px-3"><div class="h-3.5 ${widthClass} bg-slate-200 dark:bg-slate-700/60 rounded"></div></td>`;
        }
        html += '</tr>';
    }
    tbody.innerHTML = html;
}

async function loadAllSarprasData() {
    const fetchSeq = ++currentFetchSeq;

    // Tampilkan skeleton loading state
    renderTableSkeleton('table-body-barang', 10, 5);
    renderTableSkeleton('table-body-bangunan', 9, 4);
    renderTableSkeleton('table-body-tanah', 8, 4);
    renderTableSkeleton('table-body-permintaan', 9, 5);
    renderTableSkeleton('table-body-pinjam-aktif', 9, 5);
    renderTableSkeleton('table-body-perbaikan', 9, 5);

    try {
        const [
            resKelompok, resBantuan, resTanah, resBangunan, resBarang,
            resPermintaan, resPeminjaman, resPerbaikan
        ] = await Promise.all([
            sarprasStore.from('sarpras_kelompok_barang').select('*').order('kode'),
            sarprasStore.from('sarpras_jenis_bantuan').select('*').order('kode'),
            sarprasStore.from('sarpras_tanah').select('*').order('kode'),
            sarprasStore.from('sarpras_bangunan').select('*').order('kode'),
            sarprasStore.from('sarpras_barang').select('*').order('kode'),
            sarprasStore.from('sarpras_permintaan').select('*').order('tanggal', { ascending: false }),
            sarprasStore.from('sarpras_peminjaman').select('*').order('tanggal_pinjam', { ascending: false }),
            sarprasStore.from('sarpras_perbaikan').select('*').order('tanggal', { ascending: false })
        ]);

        // Cek jika ada fetch baru yang mendahului
        if (fetchSeq !== currentFetchSeq) {
            console.log('[Sarpras] Mengabaikan hasil fetch lama (sequence outdated).');
            return;
        }

        const errors = [];
        if (resKelompok.error) errors.push('Kelompok Barang'); else dataKelompok = resKelompok.data || [];
        if (resBantuan.error) errors.push('Jenis Bantuan'); else dataBantuan = resBantuan.data || [];
        if (resTanah.error) errors.push('Aset Tanah'); else dataTanah = resTanah.data || [];
        if (resBangunan.error) errors.push('Aset Bangunan'); else dataBangunan = resBangunan.data || [];
        if (resBarang.error) errors.push('Aset Barang'); else dataBarang = resBarang.data || [];
        if (resPermintaan.error) errors.push('Permintaan Pengadaan'); else dataPermintaan = resPermintaan.data || [];
        if (resPeminjaman.error) errors.push('Peminjaman'); else dataPeminjaman = resPeminjaman.data || [];
        if (resPerbaikan.error) errors.push('Perbaikan Fasilitas'); else dataPerbaikan = resPerbaikan.data || [];

        if (errors.length === 8) throw new Error('Data aset D1 belum siap atau tidak dapat dimuat.');
        if (errors.length > 0) {
            console.warn('[Sarpras] Sebagian data gagal dimuat:', errors);
            showToast('Peringatan Data', `Gagal memuat: ${errors.join(', ')}. Menampilkan data yang tersedia.`, 'warning');
        }

        // Update UI
        populateFilterDropdowns();
        renderAllViews();

        // Preload data master GTK untuk dropdown pemohon (0 Firestore Read, SSOT Cloudflare D1)
        ensureGTKLoaded().catch(() => {});
    } catch (err) {
        console.error('[Sarpras] Gagal total memuat data:', err);
        showToast('Kesalahan Jaringan', 'Gagal memuat data Sarpras dari server. Silakan coba lagi.', 'error');
        renderAllViews();
        throw err;
    }
}

// Helper memuat data master GTK untuk form pengadaan (0 Firestore Read, SSOT Cloudflare D1)
async function ensureGTKLoaded() {
    if (Array.isArray(dataGTK) && dataGTK.length > 0) return dataGTK;
    if (typeof window.getTeachersCache === 'function') {
        try {
            dataGTK = (await window.getTeachersCache()) || [];
            return dataGTK;
        } catch (e) {
            console.warn('[Sarpras] Gagal memuat data GTK:', e);
        }
    }
    return [];
}

window.smsrSarpras.reloadSarprasData = async function () {
    const icon = document.getElementById('sarpras-refresh-icon');
    if (icon) icon.classList.add('fa-spin');
    try {
        await loadAllSarprasData();
        showToast('Berhasil Sinkron', 'Data Sarpras berhasil disinkronkan dengan server.', 'success');
    } catch (err) {
        showToast('Gagal Sinkron', 'Gagal menyegarkan data Sarpras. Periksa koneksi internet Anda.', 'error');
    } finally {
        if (icon) {
            setTimeout(() => icon.classList.remove('fa-spin'), 400);
        }
    }
};

function setButtonLoading(btn, isLoading, loadingText = 'Memproses...') {
    if (!btn) return;
    if (isLoading) {
        btn.disabled = true;
        btn.dataset.originalHtml = btn.innerHTML;
        btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin mr-1.5"></i> ${loadingText}`;
    } else {
        btn.disabled = false;
        if (btn.dataset.originalHtml) {
            btn.innerHTML = btn.dataset.originalHtml;
        }
    }
}

function populateFilterDropdowns() {
    // Dropdown Kelompok di Filter Barang
    const selKel = document.getElementById('filter-barang-kelompok');
    if (selKel) {
        const currentVal = selKel.value;
        selKel.innerHTML = '<option value="">Semua Kelompok Barang</option>' +
            dataKelompok.map(k => `<option value="${escapeHTML(k.jenis_barang)}">${escapeHTML(k.jenis_barang)}</option>`).join('');
        selKel.value = currentVal;
    }

    // Dropdown Bantuan di Filter Barang
    const selBant = document.getElementById('filter-barang-bantuan');
    if (selBant) {
        const currentVal = selBant.value;
        selBant.innerHTML = '<option value="">Semua Jenis Bantuan</option>' +
            dataBantuan.map(b => `<option value="${escapeHTML(b.nama)}">${escapeHTML(b.nama)}</option>`).join('');
        selBant.value = currentVal;
    }
}

function renderAllViews() {
    renderDashboard();
    renderMasterViews();
    renderPermintaanTable();
    renderPeminjamanViews();
    renderPerbaikanTable();
    renderLaporanCounts();
}

// =========================================================================
// TAB SWITCHING
// =========================================================================
window.smsrSarpras.switchSarprasTab = function (tabName, updateHash = false) {
    activeTab = tabName;
    if (updateHash) window.location.hash = tabName;

    // Update buttons
    document.querySelectorAll('.sarpras-tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    const targetBtn = document.getElementById(`tab-btn-${tabName}`);
    if (targetBtn) {
        targetBtn.classList.add('active');
        try {
            targetBtn.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
        } catch (e) {}
    }

    // Update section visibility
    ['dashboard', 'master', 'pengadaan', 'peminjaman', 'pemeliharaan', 'laporan'].forEach(sec => {
        const el = document.getElementById(`tab-content-${sec}`);
        if (el) {
            if (sec === tabName) {
                el.classList.remove('hidden');
            } else {
                el.classList.add('hidden');
            }
        }
    });

    if (tabName === 'dashboard') renderDashboard();
};

window.smsrSarpras.switchMasterSubtab = function (subtab) {
    activeMasterSubtab = subtab;

    // Subtab buttons
    ['barang', 'bangunan', 'tanah', 'kelompok', 'bantuan'].forEach(s => {
        const btn = document.getElementById(`subtab-btn-${s}`);
        const view = document.getElementById(`master-view-${s}`);
        if (btn && view) {
            if (s === subtab) {
                btn.className = 'sarpras-subtab-btn active px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all';
                view.classList.remove('hidden');
            } else {
                btn.className = 'sarpras-subtab-btn px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all';
                view.classList.add('hidden');
            }
        }
    });

    // Update label tombol tambah
    const labelMap = {
        barang: 'Tambah Barang',
        bangunan: 'Tambah Bangunan',
        tanah: 'Tambah Tanah',
        kelompok: 'Tambah Kelompok',
        bantuan: 'Tambah Bantuan'
    };
    const addLabel = document.getElementById('btn-add-master-label');
    if (addLabel) addLabel.textContent = labelMap[subtab] || 'Tambah Data';
};

window.smsrSarpras.switchPinjamSubtab = function (subtab) {
    activePinjamSubtab = subtab;
    const btnAktif = document.getElementById('subtab-btn-pinjam-aktif');
    const btnRiwayat = document.getElementById('subtab-btn-pinjam-riwayat');
    const viewAktif = document.getElementById('pinjam-view-aktif');
    const viewRiwayat = document.getElementById('pinjam-view-riwayat');

    if (subtab === 'aktif') {
        if (btnAktif) btnAktif.className = 'px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-800 text-white transition-all';
        if (btnRiwayat) btnRiwayat.className = 'px-3 py-1.5 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all border border-slate-200 dark:border-slate-700';
        if (viewAktif) viewAktif.classList.remove('hidden');
        if (viewRiwayat) viewRiwayat.classList.add('hidden');
    } else {
        if (btnRiwayat) btnRiwayat.className = 'px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-800 text-white transition-all';
        if (btnAktif) btnAktif.className = 'px-3 py-1.5 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all border border-slate-200 dark:border-slate-700';
        if (viewRiwayat) viewRiwayat.classList.remove('hidden');
        if (viewAktif) viewAktif.classList.add('hidden');
    }
};

// =========================================================================
// TAB 1: DASHBOARD RENDERER
// =========================================================================
function renderDashboard() {
    const pinjamAktif = dataPeminjaman.filter(p => p.status === 'Dipinjam');
    const perbaikanAktif = dataPerbaikan.filter(r => r.status !== 'Selesai');
    const permintaanPending = dataPermintaan.filter(p => p.status === 'Menunggu');

    // Update Badge Counter di Nav Header
    updateBadge('badge-pinjam-active', pinjamAktif.length);
    updateBadge('badge-perbaikan-pending', perbaikanAktif.length);
    updateBadge('badge-permintaan-pending', permintaanPending.length);

    // Update KPI Stat Cards
    setText('stat-jenis-bantuan', dataBantuan.length);
    setText('stat-aset-tanah', dataTanah.length);
    setText('stat-aset-bangunan', dataBangunan.length);
    setText('stat-aset-barang', dataBarang.length);
    setText('stat-peminjaman-aktif', pinjamAktif.length);
    setText('stat-perbaikan-aktif', perbaikanAktif.length);

    const todayWita = getWitaISODate();
    const currentUserName = getCurrentUserName().toLowerCase().trim();

    // List Pinjaman Aktif di Dashboard
    const loanContainer = document.getElementById('dash-active-loans-list');
    if (loanContainer) {
        if (pinjamAktif.length === 0) {
            loanContainer.innerHTML = '<div class="text-center py-8 text-xs text-slate-400"><i class="fa-solid fa-circle-check text-emerald-500 text-2xl mb-2 block"></i>Semua barang sudah dikembalikan. Tidak ada pinjaman aktif.</div>';
        } else {
            loanContainer.innerHTML = pinjamAktif.slice(0, 5).map(p => {
                const tglBatas = p.tanggal_kembali_rencana ? p.tanggal_kembali_rencana.substring(0, 10) : '';
                const isOverdue = tglBatas && tglBatas < todayWita;
                const isDueToday = tglBatas && tglBatas === todayWita;

                const isPeminjamLogin = (p.nama_peminjam || '').toLowerCase().trim() === currentUserName;
                const canReturn = isSarprasAdmin || isPeminjamLogin;

                return `
                    <div class="p-3 rounded-xl border ${isOverdue ? 'border-rose-300 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/20' : (isDueToday ? 'border-amber-300 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20' : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40')} flex items-center justify-between text-xs gap-3">
                        <div class="min-w-0">
                            <div class="font-bold text-slate-800 dark:text-slate-100 truncate">${escapeHTML(p.nama_barang)} <span class="font-normal text-slate-500">(${p.jumlah} unit)</span></div>
                            <div class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">Peminjam: <strong class="text-slate-700 dark:text-slate-300">${escapeHTML(p.nama_peminjam)}</strong></div>
                            <div class="text-[10px] mt-0.5 ${isOverdue ? 'text-rose-600 dark:text-rose-400 font-bold' : (isDueToday ? 'text-amber-600 dark:text-amber-400 font-bold' : 'text-slate-400')}">
                                Batas: ${tglBatas ? formatDateIndo(tglBatas) : '-'} ${isOverdue ? '(TERLAMBAT)' : (isDueToday ? '(HARI INI)' : '')}
                            </div>
                        </div>
                        ${canReturn ? `
                            <button onclick="window.smsrSarpras.openModalKembalikan('${p.id}')" class="shrink-0 px-2.5 py-1.5 bg-emerald-600 text-white rounded-lg font-bold text-[11px] hover:bg-emerald-700 shadow-sm transition-all active:scale-95 flex items-center gap-1">
                                <i class="fa-solid fa-arrow-rotate-left text-[10px]"></i> Kembalikan
                            </button>
                        ` : ''}
                    </div>
                `;
            }).join('');
        }
    }

    // List Perbaikan Fasilitas Aktif di Dashboard
    const repairContainer = document.getElementById('dash-active-repairs-list');
    if (repairContainer) {
        if (perbaikanAktif.length === 0) {
            repairContainer.innerHTML = '<div class="text-center py-8 text-xs text-slate-400"><i class="fa-solid fa-shield-check text-emerald-500 text-2xl mb-2 block"></i>Seluruh fasilitas dalam kondisi baik. Tidak ada laporan kerusakan aktif.</div>';
        } else {
            repairContainer.innerHTML = perbaikanAktif.slice(0, 5).map(r => {
                return `
                    <div class="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 flex items-center justify-between text-xs gap-3">
                        <div class="min-w-0">
                            <div class="font-bold text-slate-800 dark:text-slate-100 truncate">${escapeHTML(r.lokasi_fasilitas || 'Fasilitas Sekolah')}</div>
                            <div class="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5 line-clamp-1">${escapeHTML(r.deskripsi_kerusakan)}</div>
                            <div class="text-[10px] text-slate-400 mt-0.5">Pelapor: ${escapeHTML(r.nama_pelapor)} &bull; ${formatDateIndo(r.tanggal)}</div>
                        </div>
                        <span class="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${r.status === 'Dalam Proses' ? 'bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300' : 'bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300'}">
                            ${escapeHTML(r.status)}
                        </span>
                    </div>
                `;
            }).join('');
        }
    }
}

function updateBadge(id, count) {
    const el = document.getElementById(id);
    if (el) {
        if (count > 0) {
            el.textContent = count;
            el.classList.remove('hidden');
        } else {
            el.classList.add('hidden');
        }
    }
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

// =========================================================================
// TAB 2: MASTER ASET RENDERERS
// =========================================================================
function renderMasterViews() {
    renderMasterBarang();
    renderMasterBangunan();
    renderMasterTanah();
    renderMasterKelompok();
    renderMasterBantuan();
}

window.smsrSarpras.filterBarang = function () {
    renderMasterBarang();
};

window.smsrSarpras.resetFilterBarang = function () {
    const selKel = document.getElementById('filter-barang-kelompok');
    if (selKel) selKel.value = '';
    const selBant = document.getElementById('filter-barang-bantuan');
    if (selBant) selBant.value = '';
    const searchInput = document.getElementById('search-barang');
    if (searchInput) {
        searchInput.value = '';
        const clearBtn = document.getElementById('btn-clear-search-barang');
        if (clearBtn) clearBtn.classList.add('hidden');
    }
    renderMasterBarang();
};

window.smsrSarpras.handleSearchBarangInput = function (input) {
    const clearBtn = document.getElementById('btn-clear-search-barang');
    if (clearBtn) {
        if (input.value && input.value.trim().length > 0) clearBtn.classList.remove('hidden');
        else clearBtn.classList.add('hidden');
    }
    window.smsrSarpras.filterBarang();
};

window.smsrSarpras.clearSearch = function (inputId, callback) {
    const input = document.getElementById(inputId);
    if (input) {
        input.value = '';
        const clearBtn = document.getElementById(`btn-clear-${inputId}`);
        if (clearBtn) clearBtn.classList.add('hidden');
        input.focus();
        if (typeof callback === 'function') callback();
    }
};

function renderMasterBarang() {
    const tbody = document.getElementById('table-body-barang');
    if (!tbody) return;

    const filterKel = document.getElementById('filter-barang-kelompok')?.value || '';
    const filterBant = document.getElementById('filter-barang-bantuan')?.value || '';
    const q = (document.getElementById('search-barang')?.value || '').trim().toLowerCase();

    // 1. Kasus Database Kosong
    if (dataBarang.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" class="text-center py-12">
                    <div class="max-w-sm mx-auto flex flex-col items-center text-center">
                        <div class="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xl mb-3 shadow-sm">
                            <i class="fa-solid fa-boxes-stacked"></i>
                        </div>
                        <h4 class="text-sm font-bold text-slate-800 dark:text-white">Belum ada aset barang</h4>
                        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-4">Data aset barang yang ditambahkan akan muncul di sini.</p>
                        ${isSarprasAdmin ? `
                            <button onclick="window.smsrSarpras.openAddBarangModal()" class="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-1.5 active:scale-95">
                                <i class="fa-solid fa-plus text-xs"></i> Tambah Barang
                            </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    const filtered = dataBarang.filter(b => {
        const matchKel = !filterKel || b.jenis_barang === filterKel;
        const matchBant = !filterBant || b.jenis_bantuan_nama === filterBant;
        const matchQ = !q || (b.nama && b.nama.toLowerCase().includes(q)) || (b.kode && b.kode.toLowerCase().includes(q));
        return matchKel && matchBant && matchQ;
    });

    // 2. Data Kosong Karena Filter
    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" class="text-center py-12">
                    <div class="max-w-sm mx-auto flex flex-col items-center text-center">
                        <div class="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 flex items-center justify-center text-xl mb-3 shadow-sm">
                            <i class="fa-solid fa-magnifying-glass"></i>
                        </div>
                        <h4 class="text-sm font-bold text-slate-800 dark:text-white">Tidak ada aset yang sesuai filter</h4>
                        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-4">Coba ubah filter kelompok, bantuan, atau kata pencarian.</p>
                        <button onclick="window.smsrSarpras.resetFilterBarang()" class="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 active:scale-95">
                            <i class="fa-solid fa-rotate-left text-xs"></i> Reset Filter
                        </button>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filtered.map((b, i) => {
        const total = b.jumlah_total !== undefined && b.jumlah_total !== null ? b.jumlah_total : (b.jumlah || 0);
        const tersedia = b.jumlah_tersedia !== undefined && b.jumlah_tersedia !== null ? b.jumlah_tersedia : (b.jumlah || 0);
        const dipinjam = b.jumlah_dipinjam || 0;
        const rusakHilang = (b.jumlah_rusak || 0) + (b.jumlah_hilang || 0);

        return `
            <tr class="hover:bg-blue-50/30 dark:hover:bg-slate-700/30 transition-colors">
                <td class="py-2.5 px-3 text-center font-medium text-slate-500 dark:text-slate-400">${i + 1}</td>
                <td class="py-2.5 px-3 font-mono font-bold text-blue-600 dark:text-blue-400 whitespace-nowrap">${escapeHTML(b.kode)}</td>
                <td class="py-2.5 px-3 font-semibold text-slate-800 dark:text-slate-100">
                    <div class="max-w-[200px] lg:max-w-xs truncate" title="${escapeHTML(b.nama)}">${escapeHTML(b.nama)}</div>
                </td>
                <td class="py-2.5 px-3 text-slate-600 dark:text-slate-300">${escapeHTML(b.jenis_barang || '-')}</td>
                <td class="py-2.5 px-3 text-center text-slate-500 dark:text-slate-400 tabular-nums">${escapeHTML(b.tahun || '-')}</td>
                <td class="py-2.5 px-3 text-right tabular-nums">
                    <div class="font-bold ${tersedia <= 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'}">
                        ${tersedia} <span class="text-[10px] font-normal text-slate-400">tersedia</span>
                    </div>
                    <div class="text-[10px] text-slate-400">Total: ${total} ${dipinjam > 0 ? `&bull; Pinjam: ${dipinjam}` : ''} ${rusakHilang > 0 ? `&bull; Rusak: ${rusakHilang}` : ''}</div>
                </td>
                <td class="py-2.5 px-3 text-right text-slate-700 dark:text-slate-300 font-mono text-xs tabular-nums">${b.harga_satuan ? 'Rp ' + Number(b.harga_satuan).toLocaleString('id-ID') : '-'}</td>
                <td class="py-2.5 px-3 text-slate-600 dark:text-slate-300 text-[11px]">${escapeHTML(b.jenis_bantuan_nama || '-')}</td>
                <td class="py-2.5 px-3 text-slate-500 dark:text-slate-400 text-[11px] max-w-[140px] truncate" title="${escapeHTML(b.keterangan || '')}">${escapeHTML(b.keterangan || '-')}</td>
                <td class="py-2.5 px-3 text-center">
                    ${isSarprasAdmin ? `
                        <div class="flex items-center justify-center gap-1">
                            <button onclick="window.smsrSarpras.openEditBarangModal('${b.id}')" class="w-8 h-8 flex items-center justify-center text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-slate-700 rounded-lg transition-all" title="Edit Barang" aria-label="Edit ${escapeHTML(b.nama)}">
                                <i class="fa-solid fa-pen-to-square text-xs"></i>
                            </button>
                            <button onclick="window.smsrSarpras.deleteRecord('sarpras_barang', '${b.id}', '${escapeHTML(b.nama)}')" class="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-700 rounded-lg transition-all" title="Hapus Barang" aria-label="Hapus ${escapeHTML(b.nama)}">
                                <i class="fa-solid fa-trash-can text-xs"></i>
                            </button>
                        </div>
                    ` : '<span class="text-slate-400">-</span>'}
                </td>
            </tr>
        `;
    }).join('');
}

function renderMasterBangunan() {
    const tbody = document.getElementById('table-body-bangunan');
    if (!tbody) return;

    if (dataBangunan.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="text-center py-12">
                    <div class="max-w-sm mx-auto flex flex-col items-center text-center">
                        <div class="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 flex items-center justify-center text-xl mb-3 shadow-sm">
                            <i class="fa-solid fa-building"></i>
                        </div>
                        <h4 class="text-sm font-bold text-slate-800 dark:text-white">Belum ada aset bangunan</h4>
                        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-4">Data gedung atau ruang bangunan akan muncul di sini.</p>
                        ${isSarprasAdmin ? `
                            <button onclick="window.smsrSarpras.openAddBangunanModal()" class="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-1.5 active:scale-95">
                                <i class="fa-solid fa-plus text-xs"></i> Tambah Bangunan
                            </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = dataBangunan.map((b, i) => `
        <tr class="hover:bg-blue-50/30 dark:hover:bg-slate-700/30 transition-colors">
            <td class="py-2.5 px-3 text-center font-medium text-slate-500 dark:text-slate-400">${i + 1}</td>
            <td class="py-2.5 px-3 font-mono font-bold text-amber-600 dark:text-amber-400 whitespace-nowrap">${escapeHTML(b.kode)}</td>
            <td class="py-2.5 px-3 font-semibold text-slate-800 dark:text-slate-100">${escapeHTML(b.nama)}</td>
            <td class="py-2.5 px-3 text-slate-600 dark:text-slate-300 tabular-nums">${escapeHTML(b.tahun || '-')}</td>
            <td class="py-2.5 px-3 text-slate-600 dark:text-slate-300 tabular-nums">${escapeHTML(b.luas || '-')}</td>
            <td class="py-2.5 px-3 text-center font-bold text-slate-800 dark:text-slate-100 tabular-nums">${b.jumlah_ruang || 1}</td>
            <td class="py-2.5 px-3 text-slate-600 dark:text-slate-300 text-[11px]">${escapeHTML(b.jenis_bantuan_nama || '-')}</td>
            <td class="py-2.5 px-3 text-slate-500 dark:text-slate-400 text-[11px] max-w-[140px] truncate" title="${escapeHTML(b.keterangan || '')}">${escapeHTML(b.keterangan || '-')}</td>
            <td class="py-2.5 px-3 text-center">
                ${isSarprasAdmin ? `
                    <div class="flex items-center justify-center gap-1">
                        <button onclick="window.smsrSarpras.openEditBangunanModal('${b.id}')" class="w-8 h-8 flex items-center justify-center text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-slate-700 rounded-lg transition-all" title="Edit Bangunan" aria-label="Edit ${escapeHTML(b.nama)}">
                            <i class="fa-solid fa-pen-to-square text-xs"></i>
                        </button>
                        <button onclick="window.smsrSarpras.deleteRecord('sarpras_bangunan', '${b.id}', '${escapeHTML(b.nama)}')" class="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-700 rounded-lg transition-all" title="Hapus Bangunan" aria-label="Hapus ${escapeHTML(b.nama)}">
                            <i class="fa-solid fa-trash-can text-xs"></i>
                        </button>
                    </div>
                ` : '<span class="text-slate-400">-</span>'}
            </td>
        </tr>
    `).join('');
}

function renderMasterTanah() {
    const tbody = document.getElementById('table-body-tanah');
    if (!tbody) return;

    if (dataTanah.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="text-center py-12">
                    <div class="max-w-sm mx-auto flex flex-col items-center text-center">
                        <div class="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xl mb-3 shadow-sm">
                            <i class="fa-solid fa-map-location-dot"></i>
                        </div>
                        <h4 class="text-sm font-bold text-slate-800 dark:text-white">Belum ada aset tanah</h4>
                        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-4">Data sertifikat dan persil tanah sekolah akan muncul di sini.</p>
                        ${isSarprasAdmin ? `
                            <button onclick="window.smsrSarpras.openAddTanahModal()" class="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-1.5 active:scale-95">
                                <i class="fa-solid fa-plus text-xs"></i> Tambah Tanah
                            </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = dataTanah.map((t, i) => `
        <tr class="hover:bg-blue-50/30 dark:hover:bg-slate-700/30 transition-colors">
            <td class="py-2.5 px-3 text-center font-medium text-slate-500 dark:text-slate-400">${i + 1}</td>
            <td class="py-2.5 px-3 font-mono font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">${escapeHTML(t.kode)}</td>
            <td class="py-2.5 px-3 font-semibold text-slate-800 dark:text-slate-100">${escapeHTML(t.nama)}</td>
            <td class="py-2.5 px-3 text-slate-600 dark:text-slate-300 tabular-nums">${escapeHTML(t.luas || '-')}</td>
            <td class="py-2.5 px-3 text-slate-600 dark:text-slate-300">${escapeHTML(t.lokasi || '-')}</td>
            <td class="py-2.5 px-3 text-slate-600 dark:text-slate-300 font-medium">${escapeHTML(t.status_kepemilikan || 'Milik Sendiri')}</td>
            <td class="py-2.5 px-3 text-slate-600 dark:text-slate-300 text-[11px]">${escapeHTML(t.jenis_bantuan_nama || '-')}</td>
            <td class="py-2.5 px-3 text-center">
                ${isSarprasAdmin ? `
                    <div class="flex items-center justify-center gap-1">
                        <button onclick="window.smsrSarpras.openEditTanahModal('${t.id}')" class="w-8 h-8 flex items-center justify-center text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-slate-700 rounded-lg transition-all" title="Edit Tanah" aria-label="Edit ${escapeHTML(t.nama)}">
                            <i class="fa-solid fa-pen-to-square text-xs"></i>
                        </button>
                        <button onclick="window.smsrSarpras.deleteRecord('sarpras_tanah', '${t.id}', '${escapeHTML(t.nama)}')" class="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-700 rounded-lg transition-all" title="Hapus Tanah" aria-label="Hapus ${escapeHTML(t.nama)}">
                            <i class="fa-solid fa-trash-can text-xs"></i>
                        </button>
                    </div>
                ` : '<span class="text-slate-400">-</span>'}
            </td>
        </tr>
    `).join('');
}

function renderMasterKelompok() {
    const tbody = document.getElementById('table-body-kelompok');
    if (!tbody) return;

    if (dataKelompok.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center py-12">
                    <div class="max-w-sm mx-auto flex flex-col items-center text-center">
                        <div class="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xl mb-3 shadow-sm">
                            <i class="fa-solid fa-layer-group"></i>
                        </div>
                        <h4 class="text-sm font-bold text-slate-800 dark:text-white">Belum ada kelompok barang</h4>
                        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-4">Kategori barang inventaris akan muncul di sini.</p>
                        ${isSarprasAdmin ? `
                            <button onclick="window.smsrSarpras.openAddKelompokModal()" class="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-1.5 active:scale-95">
                                <i class="fa-solid fa-plus text-xs"></i> Tambah Kelompok
                            </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = dataKelompok.map((k, i) => `
        <tr class="hover:bg-blue-50/30 dark:hover:bg-slate-700/30 transition-colors">
            <td class="py-2.5 px-3 text-center font-medium text-slate-500 dark:text-slate-400">${i + 1}</td>
            <td class="py-2.5 px-3 font-mono font-bold text-slate-600 dark:text-slate-300 whitespace-nowrap">${escapeHTML(k.kode)}</td>
            <td class="py-2.5 px-3 font-semibold text-slate-800 dark:text-slate-100">${escapeHTML(k.jenis_barang)}</td>
            <td class="py-2.5 px-3 text-slate-500 dark:text-slate-400 text-[11px]">${escapeHTML(k.keterangan || '-')}</td>
            <td class="py-2.5 px-3 text-center">
                ${isSarprasAdmin ? `
                    <div class="flex items-center justify-center gap-1">
                        <button onclick="window.smsrSarpras.openEditKelompokModal('${k.id}')" class="w-8 h-8 flex items-center justify-center text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-slate-700 rounded-lg transition-all" title="Edit Kelompok" aria-label="Edit ${escapeHTML(k.jenis_barang)}">
                            <i class="fa-solid fa-pen-to-square text-xs"></i>
                        </button>
                        <button onclick="window.smsrSarpras.deleteRecord('sarpras_kelompok_barang', '${k.id}', '${escapeHTML(k.jenis_barang)}')" class="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-700 rounded-lg transition-all" title="Hapus Kelompok" aria-label="Hapus ${escapeHTML(k.jenis_barang)}">
                            <i class="fa-solid fa-trash-can text-xs"></i>
                        </button>
                    </div>
                ` : '<span class="text-slate-400">-</span>'}
            </td>
        </tr>
    `).join('');
}

function renderMasterBantuan() {
    const tbody = document.getElementById('table-body-bantuan');
    if (!tbody) return;

    if (dataBantuan.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center py-12">
                    <div class="max-w-sm mx-auto flex flex-col items-center text-center">
                        <div class="w-12 h-12 rounded-2xl bg-cyan-50 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400 flex items-center justify-center text-xl mb-3 shadow-sm">
                            <i class="fa-solid fa-hand-holding-heart"></i>
                        </div>
                        <h4 class="text-sm font-bold text-slate-800 dark:text-white">Belum ada jenis bantuan</h4>
                        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-4">Sumber pendanaan / jenis bantuan akan muncul di sini.</p>
                        ${isSarprasAdmin ? `
                            <button onclick="window.smsrSarpras.openAddBantuanModal()" class="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-1.5 active:scale-95">
                                <i class="fa-solid fa-plus text-xs"></i> Tambah Bantuan
                            </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = dataBantuan.map((b, i) => `
        <tr class="hover:bg-blue-50/30 dark:hover:bg-slate-700/30 transition-colors">
            <td class="py-2.5 px-3 text-center font-medium text-slate-500 dark:text-slate-400">${i + 1}</td>
            <td class="py-2.5 px-3 font-mono font-bold text-slate-600 dark:text-slate-300 whitespace-nowrap">${escapeHTML(b.kode)}</td>
            <td class="py-2.5 px-3 font-semibold text-slate-800 dark:text-slate-100">${escapeHTML(b.nama)}</td>
            <td class="py-2.5 px-3 text-slate-500 dark:text-slate-400 text-[11px]">${escapeHTML(b.keterangan || '-')}</td>
            <td class="py-2.5 px-3 text-center">
                ${isSarprasAdmin ? `
                    <div class="flex items-center justify-center gap-1">
                        <button onclick="window.smsrSarpras.openEditBantuanModal('${b.id}')" class="w-8 h-8 flex items-center justify-center text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-slate-700 rounded-lg transition-all" title="Edit Bantuan" aria-label="Edit ${escapeHTML(b.nama)}">
                            <i class="fa-solid fa-pen-to-square text-xs"></i>
                        </button>
                        <button onclick="window.smsrSarpras.deleteRecord('sarpras_jenis_bantuan', '${b.id}', '${escapeHTML(b.nama)}')" class="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-700 rounded-lg transition-all" title="Hapus Bantuan" aria-label="Hapus ${escapeHTML(b.nama)}">
                            <i class="fa-solid fa-trash-can text-xs"></i>
                        </button>
                    </div>
                ` : '<span class="text-slate-400">-</span>'}
            </td>
        </tr>
    `).join('');
}

// =========================================================================
// TAB 3: PENGADAAN (PERMINTAAN BARANG)
// =========================================================================
window.smsrSarpras.filterPermintaan = function () {
    renderPermintaanTable();
};

function renderPermintaanTable() {
    const tbody = document.getElementById('table-body-permintaan');
    if (!tbody) return;

    const filterStatus = document.getElementById('filter-permintaan-status')?.value || '';
    const filtered = filterStatus ? dataPermintaan.filter(p => p.status === filterStatus) : dataPermintaan;

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-slate-400">Belum ada usulan pengadaan barang.</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map((p, i) => {
        const badgeColor = {
            'Menunggu': 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
            'Disetujui': 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
            'Ditolak': 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800',
            'Selesai': 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
        }[p.status] || 'bg-slate-100 text-slate-700 border-slate-200';

        return `
            <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-700/30 transition-colors">
                <td class="py-2.5 px-3 text-center font-medium text-slate-500 dark:text-slate-400">${i + 1}</td>
                <td class="py-2.5 px-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">${p.tanggal ? formatDateIndo(p.tanggal) : '-'}</td>
                <td class="py-2.5 px-3">
                    <div class="font-bold text-slate-800 dark:text-slate-100">${escapeHTML(p.nama_pemohon)}</div>
                    <div class="text-[10px] text-slate-400">${escapeHTML(p.role_pemohon || 'Guru')} ${p.nip_nis ? '&bull; ' + escapeHTML(p.nip_nis) : ''}</div>
                </td>
                <td class="py-2.5 px-3 font-semibold text-slate-800 dark:text-slate-100">${escapeHTML(p.nama_barang)}</td>
                <td class="py-2.5 px-3 text-center font-bold text-slate-800 dark:text-slate-100">${p.jumlah}</td>
                <td class="py-2.5 px-3 text-slate-600 dark:text-slate-300">${escapeHTML(p.keperluan || '-')}</td>
                <td class="py-2.5 px-3 text-center">
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold border ${badgeColor}">
                        ${escapeHTML(p.status)}
                    </span>
                </td>
                <td class="py-2.5 px-3 text-slate-500 dark:text-slate-400 text-[11px]">${escapeHTML(p.keterangan || '-')}</td>
                <td class="py-2.5 px-3 text-center">
                    ${isSarprasAdmin ? `
                        <div class="flex items-center justify-center gap-1">
                            ${p.status === 'Menunggu' ? `
                                <button onclick="window.smsrSarpras.updateStatusPermintaan('${p.id}', 'Disetujui')" class="p-1 text-emerald-600 hover:text-emerald-800 dark:text-emerald-400" title="Setujui Usulan" aria-label="Setujui Usulan">
                                    <i class="fa-solid fa-check-circle text-sm"></i>
                                </button>
                                <button onclick="window.smsrSarpras.updateStatusPermintaan('${p.id}', 'Ditolak')" class="p-1 text-rose-600 hover:text-rose-800 dark:text-rose-400" title="Tolak Usulan" aria-label="Tolak Usulan">
                                    <i class="fa-solid fa-times-circle text-sm"></i>
                                </button>
                            ` : ''}
                            ${p.status === 'Disetujui' ? `
                                <button onclick="window.smsrSarpras.updateStatusPermintaan('${p.id}', 'Selesai')" class="p-1 text-blue-600 hover:text-blue-800 dark:text-blue-400" title="Tandai Selesai Pengadaan" aria-label="Selesaikan Pengadaan">
                                    <i class="fa-solid fa-box-check text-sm"></i>
                                </button>
                            ` : ''}
                            <button onclick="window.smsrSarpras.deleteRecord('sarpras_permintaan', '${p.id}', 'Permintaan ${escapeHTML(p.nama_barang)}')" class="p-1 text-slate-400 hover:text-rose-600" title="Hapus Usulan" aria-label="Hapus Usulan">
                                <i class="fa-solid fa-trash-can text-xs"></i>
                            </button>
                        </div>
                    ` : '<span class="text-slate-400">-</span>'}
                </td>
            </tr>
        `;
    }).join('');
}

window.smsrSarpras.updateStatusPermintaan = async function (id, newStatus) {
    if (!isSarprasAdmin) {
        showToast('Akses Ditolak', 'Hanya pengelola Sarpras atau Pimpinan yang dapat mengubah status usulan.', 'warning');
        return;
    }

    try {
        const res = await callSarprasAction('sarpras-update-permintaan-status', {
            permintaan_id: id,
            status: newStatus
        });

        if (res && res.error) {
            throw new Error(res.error);
        }

        showToast('Berhasil', `Status usulan pengadaan berhasil diubah menjadi: ${newStatus}`, 'success');
        await loadAllSarprasData();
    } catch (err) {
        console.error('[Sarpras] Gagal update status permintaan:', err);
        showToast('Gagal Memperbarui', `Gagal mengubah status: ${err.message || err}`, 'error');
    }
};

// =========================================================================
// TAB 4: PENGGUNAAN (PEMINJAMAN & PENGEMBALIAN ATOMIK)
// =========================================================================
window.smsrSarpras.filterPeminjaman = function () {
    renderPeminjamanViews();
};

function renderPeminjamanViews() {
    const q = (document.getElementById('search-peminjaman')?.value || '').toLowerCase().trim();
    const todayWita = getWitaISODate();
    const currentUserName = getCurrentUserName().toLowerCase().trim();

    // 1. View Aktif
    const tbodyAktif = document.getElementById('table-body-pinjam-aktif');
    if (tbodyAktif) {
        const aktif = dataPeminjaman.filter(p => p.status === 'Dipinjam' &&
            (!q || (p.nama_peminjam && p.nama_peminjam.toLowerCase().includes(q)) || (p.nama_barang && p.nama_barang.toLowerCase().includes(q))));

        if (aktif.length === 0) {
            tbodyAktif.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-slate-400">Semua barang sudah dikembalikan. Tidak ada pinjaman aktif.</td></tr>';
        } else {
            tbodyAktif.innerHTML = aktif.map((p, i) => {
                const tglBatas = p.tanggal_kembali_rencana ? p.tanggal_kembali_rencana.substring(0, 10) : '';
                const isOverdue = tglBatas && tglBatas < todayWita;
                const isDueToday = tglBatas && tglBatas === todayWita;

                const isPeminjamLogin = (p.nama_peminjam || '').toLowerCase().trim() === currentUserName;
                const canReturn = isSarprasAdmin || isPeminjamLogin;

                return `
                    <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-700/30 transition-colors ${isOverdue ? 'bg-rose-50/30 dark:bg-rose-950/20' : ''}">
                        <td class="py-2.5 px-3 text-center font-medium text-slate-500 dark:text-slate-400">${i + 1}</td>
                        <td class="py-2.5 px-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">${p.tanggal_pinjam ? formatDateIndo(p.tanggal_pinjam) : '-'}</td>
                        <td class="py-2.5 px-3">
                            <div class="font-bold text-slate-800 dark:text-slate-100">${escapeHTML(p.nama_peminjam)}</div>
                            <div class="text-[10px] text-slate-400">${escapeHTML(p.role_peminjam || 'Guru')} ${p.nip_nis ? '&bull; ' + escapeHTML(p.nip_nis) : ''}</div>
                        </td>
                        <td class="py-2.5 px-3 font-semibold text-slate-800 dark:text-slate-100">${escapeHTML(p.nama_barang)}</td>
                        <td class="py-2.5 px-3 text-center font-bold text-slate-800 dark:text-slate-100">${p.jumlah}</td>
                        <td class="py-2.5 px-3 whitespace-nowrap font-medium ${isOverdue ? 'text-rose-600 dark:text-rose-400 font-bold' : (isDueToday ? 'text-amber-600 dark:text-amber-400 font-bold' : 'text-slate-600 dark:text-slate-300')}">
                            ${tglBatas ? formatDateIndo(tglBatas) : '-'}
                            ${isOverdue ? '<span class="block text-[9px] uppercase tracking-wider text-rose-500 font-bold">Terlambat</span>' : ''}
                            ${isDueToday ? '<span class="block text-[9px] uppercase tracking-wider text-amber-500 font-bold">Jatuh Tempo Hari Ini</span>' : ''}
                        </td>
                        <td class="py-2.5 px-3 text-center">
                            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${isOverdue ? 'bg-rose-100 text-rose-800 border border-rose-200' : 'bg-amber-100 text-amber-800 border border-amber-200'}">
                                Dipinjam
                            </span>
                        </td>
                        <td class="py-2.5 px-3 text-slate-500 dark:text-slate-400 text-[11px]">${escapeHTML(p.keterangan || '-')}</td>
                        <td class="py-2.5 px-3 text-center">
                            ${canReturn ? `
                                <button onclick="window.smsrSarpras.openModalKembalikan('${p.id}')" class="px-2.5 py-1 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 shadow-sm transition-all active:scale-95" aria-label="Kembalikan barang ${escapeHTML(p.nama_barang)}">
                                    <i class="fa-solid fa-arrow-rotate-left mr-1"></i> Kembalikan
                                </button>
                            ` : '<span class="text-slate-400 text-[11px]">-</span>'}
                        </td>
                    </tr>
                `;
            }).join('');
        }
    }

    // 2. View Riwayat
    const tbodyRiwayat = document.getElementById('table-body-pinjam-riwayat');
    if (tbodyRiwayat) {
        const riwayat = dataPeminjaman.filter(p => p.status === 'Dikembalikan' &&
            (!q || (p.nama_peminjam && p.nama_peminjam.toLowerCase().includes(q)) || (p.nama_barang && p.nama_barang.toLowerCase().includes(q))));

        if (riwayat.length === 0) {
            tbodyRiwayat.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-slate-400">Belum ada riwayat pengembalian barang.</td></tr>';
        } else {
            tbodyRiwayat.innerHTML = riwayat.map((p, i) => `
                <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-700/30 transition-colors">
                    <td class="py-2.5 px-3 text-center font-medium text-slate-500 dark:text-slate-400">${i + 1}</td>
                    <td class="py-2.5 px-3 font-semibold text-slate-800 dark:text-slate-100">${escapeHTML(p.nama_peminjam)}</td>
                    <td class="py-2.5 px-3 font-medium text-slate-700 dark:text-slate-200">${escapeHTML(p.nama_barang)}</td>
                    <td class="py-2.5 px-3 text-center font-bold text-slate-800 dark:text-slate-100">${p.jumlah}</td>
                    <td class="py-2.5 px-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">${p.tanggal_pinjam ? formatDateIndo(p.tanggal_pinjam) : '-'}</td>
                    <td class="py-2.5 px-3 text-emerald-700 dark:text-emerald-400 font-semibold whitespace-nowrap">${p.tanggal_kembali_realisasi ? formatDateIndo(p.tanggal_kembali_realisasi) : '-'}</td>
                    <td class="py-2.5 px-3 text-center">
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                            ${escapeHTML(p.kondisi_kembali || 'Baik')}
                        </span>
                    </td>
                    <td class="py-2.5 px-3 text-slate-500 dark:text-slate-400 text-[11px]">${escapeHTML(p.keterangan || '-')}</td>
                </tr>
            `).join('');
        }
    }
}

// Modal Konfirmasi Pengembalian Barang
window.smsrSarpras.openModalKembalikan = function (id) {
    const p = dataPeminjaman.find(item => item.id === id);
    if (!p) return;

    openModal('Konfirmasi Pengembalian Barang', `
        <form onsubmit="window.smsrSarpras.submitKembalikan(event, '${p.id}')">
            <div class="space-y-4 text-xs">
                <div class="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl border border-blue-100 dark:border-blue-900/40">
                    <div class="font-bold text-slate-800 dark:text-slate-100 text-sm">${escapeHTML(p.nama_barang)} (${p.jumlah} unit)</div>
                    <div class="text-slate-600 dark:text-slate-300 mt-1">Peminjam: <strong>${escapeHTML(p.nama_peminjam)}</strong></div>
                    <div class="text-slate-500 dark:text-slate-400 text-[11px]">Tanggal Pinjam: ${formatDateIndo(p.tanggal_pinjam)}</div>
                </div>

                <div>
                    <label for="kembali-tanggal" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Tanggal Dikembalikan</label>
                    <input type="date" id="kembali-tanggal" value="${getWitaISODate()}" required
                        class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs focus:bg-white focus:ring-2 focus:ring-blue-500">
                </div>

                <div>
                    <label for="kembali-kondisi" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Kondisi Barang Saat Kembali</label>
                    <select id="kembali-kondisi" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs focus:bg-white focus:ring-2 focus:ring-blue-500">
                        <option value="Baik" selected>Baik (Lengkap & Berfungsi Normal)</option>
                        <option value="Rusak Ringan">Rusak Ringan (Perlu Servis Minor)</option>
                        <option value="Rusak Berat">Rusak Berat (Tidak Berfungsi)</option>
                        <option value="Hilang / Tidak Lengkap">Hilang / Komponen Kurang</option>
                    </select>
                </div>

                <div>
                    <label for="kembali-keterangan" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Catatan Pengembalian (Opsional)</label>
                    <textarea id="kembali-keterangan" rows="2" placeholder="Kondisi fisik, kelengkapan kabel, dll..."
                        class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs focus:bg-white focus:ring-2 focus:ring-blue-500"></textarea>
                </div>

                <div class="flex gap-2 pt-2">
                    <button type="submit" class="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 shadow transition-all active:scale-95">
                        <i class="fa-solid fa-check mr-1"></i> Simpan Pengembalian
                    </button>
                    <button type="button" onclick="window.smsrSarpras.closeModal()" class="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-all">
                        Batal
                    </button>
                </div>
            </div>
        </form>
    `);
};

window.smsrSarpras.submitKembalikan = async function (e, id) {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    setButtonLoading(submitBtn, true, 'Memproses...');
    const tglKembali = document.getElementById('kembali-tanggal').value;
    const kondisi = document.getElementById('kembali-kondisi').value;
    const ket = document.getElementById('kembali-keterangan').value.trim();

    try {
        const res = await callSarprasAction('sarpras-kembalikan-barang', {
            peminjaman_id: id,
            tanggal_kembali_realisasi: tglKembali,
            kondisi_kembali: kondisi,
            keterangan: ket
        });

        if (res && res.error) {
            throw new Error(res.error);
        }

        showToast('Berhasil', 'Barang berhasil dikembalikan dan alokasi stok inventaris telah diperbarui secara aman.', 'success');
        window.smsrSarpras.closeModal();
        await loadAllSarprasData();
    } catch (err) {
        console.error('[Sarpras] Gagal mengembalikan barang:', err);
        showToast('Pengembalian Gagal', `Gagal memproses pengembalian: ${err.message || err}`, 'error');
    } finally {
        setButtonLoading(submitBtn, false);
    }
};

// =========================================================================
// TAB 5: PEMELIHARAAN (PERBAIKAN FASILITAS)
// =========================================================================
window.smsrSarpras.filterPerbaikan = function () {
    renderPerbaikanTable();
};

window.smsrSarpras.handlePerbaikanPeriodeChange = function (val) {
    const monthInput = document.getElementById('filter-perbaikan-bulan');
    if (val === 'custom') {
        if (monthInput) {
            monthInput.classList.remove('hidden');
            monthInput.focus();
        }
    } else {
        if (monthInput) {
            monthInput.classList.add('hidden');
            monthInput.value = '';
        }
        renderPerbaikanTable();
    }
};

window.smsrSarpras.handleSearchPerbaikanInput = function (input) {
    const clearBtn = document.getElementById('btn-clear-search-perbaikan');
    if (clearBtn) {
        if (input.value && input.value.trim().length > 0) clearBtn.classList.remove('hidden');
        else clearBtn.classList.add('hidden');
    }
    window.smsrSarpras.filterPerbaikan();
};

window.smsrSarpras.resetFilterPerbaikan = function () {
    const selPeriode = document.getElementById('filter-perbaikan-periode');
    if (selPeriode) selPeriode.value = '';
    const monthInput = document.getElementById('filter-perbaikan-bulan');
    if (monthInput) {
        monthInput.value = '';
        monthInput.classList.add('hidden');
    }
    const selStatus = document.getElementById('filter-perbaikan-status');
    if (selStatus) selStatus.value = '';
    const searchInput = document.getElementById('search-perbaikan');
    if (searchInput) {
        searchInput.value = '';
        const clearBtn = document.getElementById('btn-clear-search-perbaikan');
        if (clearBtn) clearBtn.classList.add('hidden');
    }
    renderPerbaikanTable();
};

function renderPerbaikanTable() {
    const tbody = document.getElementById('table-body-perbaikan');
    if (!tbody) return;

    const periodeVal = document.getElementById('filter-perbaikan-periode')?.value || '';
    const customBulan = document.getElementById('filter-perbaikan-bulan')?.value || '';
    const filterStatus = document.getElementById('filter-perbaikan-status')?.value || '';
    const searchQ = (document.getElementById('search-perbaikan')?.value || '').trim().toLowerCase();

    // 1. Kasus Database Kosong
    if (dataPerbaikan.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="text-center py-12">
                    <div class="max-w-sm mx-auto flex flex-col items-center text-center">
                        <div class="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xl mb-3 shadow-sm">
                            <i class="fa-solid fa-screwdriver-wrench"></i>
                        </div>
                        <h4 class="text-sm font-bold text-slate-800 dark:text-white">Belum ada laporan kerusakan</h4>
                        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-4">Laporan kerusakan fasilitas akan muncul di sini.</p>
                        <button onclick="window.smsrSarpras.openModalPerbaikan()" class="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-1.5 active:scale-95">
                            <i class="fa-solid fa-plus text-xs"></i> Lapor Kerusakan
                        </button>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonthStr = String(now.getMonth() + 1).padStart(2, '0');
    const currentYearMonth = `${currentYear}-${currentMonthStr}`;

    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevYear = prevMonthDate.getFullYear();
    const prevMonthStr = String(prevMonthDate.getMonth() + 1).padStart(2, '0');
    const prevYearMonth = `${prevYear}-${prevMonthStr}`;

    const filtered = dataPerbaikan.filter(r => {
        let matchPeriode = true;
        if (periodeVal === 'bulan-ini') {
            matchPeriode = r.tanggal && r.tanggal.startsWith(currentYearMonth);
        } else if (periodeVal === 'bulan-lalu') {
            matchPeriode = r.tanggal && r.tanggal.startsWith(prevYearMonth);
        } else if (periodeVal === 'tahun-ini') {
            matchPeriode = r.tanggal && r.tanggal.startsWith(String(currentYear));
        } else if (periodeVal === 'custom' && customBulan) {
            matchPeriode = r.tanggal && r.tanggal.startsWith(customBulan);
        } else if (customBulan) {
            matchPeriode = r.tanggal && r.tanggal.startsWith(customBulan);
        }

        const matchStatus = !filterStatus || r.status === filterStatus;

        const matchSearch = !searchQ || (
            (r.nama_pelapor && r.nama_pelapor.toLowerCase().includes(searchQ)) ||
            (r.lokasi_fasilitas && r.lokasi_fasilitas.toLowerCase().includes(searchQ)) ||
            (r.deskripsi_kerusakan && r.deskripsi_kerusakan.toLowerCase().includes(searchQ)) ||
            (r.tindakan && r.tindakan.toLowerCase().includes(searchQ))
        );

        return matchPeriode && matchStatus && matchSearch;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="text-center py-12">
                    <div class="max-w-sm mx-auto flex flex-col items-center text-center">
                        <div class="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 flex items-center justify-center text-xl mb-3 shadow-sm">
                            <i class="fa-solid fa-magnifying-glass"></i>
                        </div>
                        <h4 class="text-sm font-bold text-slate-800 dark:text-white">Tidak ada laporan yang sesuai filter</h4>
                        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-4">Coba ubah periode, status, atau kata pencarian.</p>
                        <button onclick="window.smsrSarpras.resetFilterPerbaikan()" class="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 active:scale-95">
                            <i class="fa-solid fa-rotate-left text-xs"></i> Reset Filter
                        </button>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filtered.map((r, i) => {
        const statusBadge = {
            'Menunggu': 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
            'Dalam Proses': 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800',
            'Selesai': 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
        }[r.status] || 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700';

        const tingBadge = {
            'Ringan': 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800',
            'Sedang': 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 font-semibold',
            'Berat': 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 font-bold'
        }[r.tingkat_kerusakan] || 'bg-slate-100 text-slate-700';

        return `
            <tr class="hover:bg-blue-50/30 dark:hover:bg-slate-700/30 transition-colors">
                <td class="py-2.5 px-3 text-center font-medium text-slate-500 dark:text-slate-400">${i + 1}</td>
                <td class="py-2.5 px-3 text-slate-600 dark:text-slate-300 whitespace-nowrap tabular-nums">${r.tanggal ? formatDateIndo(r.tanggal) : '-'}</td>
                <td class="py-2.5 px-3 font-semibold text-slate-800 dark:text-slate-100">
                    <div>${escapeHTML(r.nama_pelapor)}</div>
                    <div class="text-[10px] text-slate-400 font-normal">${escapeHTML(r.role_pelapor || 'Guru')}</div>
                </td>
                <td class="py-2.5 px-3 font-bold text-blue-700 dark:text-blue-400">${escapeHTML(r.lokasi_fasilitas || '-')}</td>
                <td class="py-2.5 px-3 text-slate-700 dark:text-slate-300">
                    <div class="max-w-[200px] lg:max-w-xs line-clamp-2" title="${escapeHTML(r.deskripsi_kerusakan)}">${escapeHTML(r.deskripsi_kerusakan)}</div>
                </td>
                <td class="py-2.5 px-3 text-center">
                    <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] ${tingBadge}">
                        ${escapeHTML(r.tingkat_kerusakan || 'Ringan')}
                    </span>
                </td>
                <td class="py-2.5 px-3 text-center">
                    <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${statusBadge}">
                        <span class="w-1.5 h-1.5 rounded-full ${r.status === 'Selesai' ? 'bg-emerald-500' : (r.status === 'Dalam Proses' ? 'bg-blue-500' : 'bg-amber-500')}"></span>
                        ${escapeHTML(r.status)}
                    </span>
                </td>
                <td class="py-2.5 px-3 text-slate-600 dark:text-slate-400 text-[11px] max-w-[160px] truncate" title="${escapeHTML(r.tindakan || '')}">${escapeHTML(r.tindakan || '-')}</td>
                <td class="py-2.5 px-3 text-center">
                    ${isSarprasAdmin ? `
                        <div class="flex items-center justify-center gap-1">
                            <button onclick="window.smsrSarpras.openTanganiPerbaikanModal('${r.id}')" class="px-2.5 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-lg text-xs font-bold transition-all flex items-center gap-1" title="Perbarui Tindakan" aria-label="Tangani Kerusakan">
                                <i class="fa-solid fa-wrench text-[10px]"></i> <span>Tangani</span>
                            </button>
                            <button onclick="window.smsrSarpras.deleteRecord('sarpras_perbaikan', '${r.id}', 'Laporan ${escapeHTML(r.lokasi_fasilitas)}')" class="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-700 rounded-lg transition-all" title="Hapus Laporan" aria-label="Hapus Laporan">
                                <i class="fa-solid fa-trash-can text-xs"></i>
                            </button>
                        </div>
                    ` : '<span class="text-slate-400">-</span>'}
                </td>
            </tr>
        `;
    }).join('');
}

window.smsrSarpras.openTanganiPerbaikanModal = function (id) {
    const r = dataPerbaikan.find(item => item.id === id);
    if (!r) return;

    openModal('Tangani Laporan Kerusakan', `
        <form onsubmit="window.smsrSarpras.submitTanganiPerbaikan(event, '${r.id}')">
            <div class="space-y-4 text-xs">
                <div class="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                    <div class="font-bold text-slate-800 dark:text-slate-100 text-sm">${escapeHTML(r.lokasi_fasilitas)}</div>
                    <div class="text-slate-600 dark:text-slate-300 mt-1">${escapeHTML(r.deskripsi_kerusakan)}</div>
                    <div class="text-slate-400 text-[11px] mt-1">Pelapor: ${escapeHTML(r.nama_pelapor)} &bull; ${formatDateIndo(r.tanggal)}</div>
                </div>

                <div>
                    <label for="tangani-status" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Status Perbaikan</label>
                    <select id="tangani-status" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs focus:bg-white focus:ring-2 focus:ring-blue-500">
                        <option value="Menunggu" ${r.status === 'Menunggu' ? 'selected' : ''}>Menunggu Penanganan</option>
                        <option value="Dalam Proses" ${r.status === 'Dalam Proses' ? 'selected' : ''}>Dalam Proses Servis / Pembelian Sparepart</option>
                        <option value="Selesai" ${r.status === 'Selesai' ? 'selected' : ''}>Selesai Diperbaiki</option>
                    </select>
                </div>

                <div>
                    <label for="tangani-tindakan" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Tindakan Penanganan / Servis</label>
                    <textarea id="tangani-tindakan" rows="3" required placeholder="Contoh: Penggantian power supply dan pembersihan kipas pendingin..."
                        class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs focus:bg-white focus:ring-2 focus:ring-blue-500">${escapeHTML(r.tindakan || '')}</textarea>
                </div>

                <div>
                    <label for="tangani-keterangan" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Keterangan / Biaya / Teknisi (Opsional)</label>
                    <input type="text" id="tangani-keterangan" value="${escapeHTML(r.keterangan || '')}" placeholder="Ditangani teknisi Pak Made..."
                        class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs focus:bg-white focus:ring-2 focus:ring-blue-500">
                </div>

                <div class="flex gap-2 pt-2">
                    <button type="submit" class="flex-1 py-2.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 shadow transition-all active:scale-95">
                        <i class="fa-solid fa-save mr-1"></i> Simpan Penanganan
                    </button>
                    <button type="button" onclick="window.smsrSarpras.closeModal()" class="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-all">
                        Batal
                    </button>
                </div>
            </div>
        </form>
    `);
};

window.smsrSarpras.submitTanganiPerbaikan = async function (e, id) {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    setButtonLoading(submitBtn, true, 'Menyimpan...');
    const status = document.getElementById('tangani-status').value;
    const tindakan = document.getElementById('tangani-tindakan').value.trim();
    const keterangan = document.getElementById('tangani-keterangan').value.trim();
    const tanggalSelesai = status === 'Selesai' ? getWitaISODate() : null;

    try {
        const { error } = await sarprasStore.from('sarpras_perbaikan').update({
            status,
            tindakan,
            keterangan,
            tanggal_selesai: tanggalSelesai,
            updated_at: new Date().toISOString()
        }).eq('id', id);

        if (error) throw error;
        showToast('Berhasil', 'Data penanganan perbaikan fasilitas berhasil disimpan.', 'success');
        window.smsrSarpras.closeModal();
        await loadAllSarprasData();
    } catch (err) {
        console.error('[Sarpras] Gagal simpan tindakan:', err);
        showToast('Gagal Menyimpan', `Gagal menyimpan tindakan: ${err.message}`, 'error');
    } finally {
        setButtonLoading(submitBtn, false);
    }
};

// =========================================================================
// TAB 6: LAPORAN & CETAK BERKOP RESMI SEKOLAH
// =========================================================================
function renderLaporanCounts() {
    setText('rep-tanah-count', `${dataTanah.length} data terdaftar`);
    setText('rep-bangunan-count', `${dataBangunan.length} gedung terdaftar`);
    setText('rep-barang-count', `${dataBarang.length} item inventaris`);
    setText('rep-permintaan-count', `${dataPermintaan.length} usulan`);
    setText('rep-peminjaman-count', `${dataPeminjaman.length} transaksi`);
    setText('rep-perbaikan-count', `${dataPerbaikan.length} catatan servis`);
}

window.smsrSarpras.previewPrintLaporan = function (type) {
    const printArea = document.getElementById('print-area');
    if (!printArea) return;

    const modal = document.getElementById('print-modal-container');
    if (modal) modal.classList.remove('hidden');

    const school = SCHOOL_CONFIG || {};
    const schoolName = school.schoolNameUpper || 'SMK NEGERI 1 SUKAWATI';
    const schoolAddress = school.schoolAddress || 'Jalan SMKI, Batubulan, Sukawati, Gianyar, Bali';

    let docTitle = '';
    let tableHeaders = '';
    let tableRows = '';

    if (type === 'tanah') {
        docTitle = 'BUKU INDUK REGISTER ASET TANAH SEKOLAH';
        tableHeaders = `
            <tr>
                <th style="border: 1px solid #000; padding: 6px; text-align: center;">No</th>
                <th style="border: 1px solid #000; padding: 6px;">Kode</th>
                <th style="border: 1px solid #000; padding: 6px;">Nama Aset Tanah</th>
                <th style="border: 1px solid #000; padding: 6px;">Luas (m²)</th>
                <th style="border: 1px solid #000; padding: 6px;">Lokasi</th>
                <th style="border: 1px solid #000; padding: 6px;">Status Kepemilikan</th>
                <th style="border: 1px solid #000; padding: 6px;">Jenis Bantuan</th>
            </tr>
        `;
        tableRows = dataTanah.map((t, i) => `
            <tr>
                <td style="border: 1px solid #000; padding: 5px; text-align: center;">${i + 1}</td>
                <td style="border: 1px solid #000; padding: 5px; font-family: monospace;">${escapeHTML(t.kode)}</td>
                <td style="border: 1px solid #000; padding: 5px; font-weight: bold;">${escapeHTML(t.nama)}</td>
                <td style="border: 1px solid #000; padding: 5px;">${escapeHTML(t.luas || '-')}</td>
                <td style="border: 1px solid #000; padding: 5px;">${escapeHTML(t.lokasi)}</td>
                <td style="border: 1px solid #000; padding: 5px;">${escapeHTML(t.status_kepemilikan || 'Milik Sendiri')}</td>
                <td style="border: 1px solid #000; padding: 5px;">${escapeHTML(t.jenis_bantuan_nama || '-')}</td>
            </tr>
        `).join('');
    } else if (type === 'bangunan') {
        docTitle = 'BUKU INDUK REGISTER ASET BANGUNAN & GEDUNG';
        tableHeaders = `
            <tr>
                <th style="border: 1px solid #000; padding: 6px; text-align: center;">No</th>
                <th style="border: 1px solid #000; padding: 6px;">Kode</th>
                <th style="border: 1px solid #000; padding: 6px;">Nama Bangunan / Gedung</th>
                <th style="border: 1px solid #000; padding: 6px; text-align: center;">Tahun</th>
                <th style="border: 1px solid #000; padding: 6px;">Luas (m²)</th>
                <th style="border: 1px solid #000; padding: 6px; text-align: center;">Jml Ruang</th>
                <th style="border: 1px solid #000; padding: 6px;">Jenis Bantuan</th>
                <th style="border: 1px solid #000; padding: 6px;">Keterangan</th>
            </tr>
        `;
        tableRows = dataBangunan.map((b, i) => `
            <tr>
                <td style="border: 1px solid #000; padding: 5px; text-align: center;">${i + 1}</td>
                <td style="border: 1px solid #000; padding: 5px; font-family: monospace;">${escapeHTML(b.kode)}</td>
                <td style="border: 1px solid #000; padding: 5px; font-weight: bold;">${escapeHTML(b.nama)}</td>
                <td style="border: 1px solid #000; padding: 5px; text-align: center;">${escapeHTML(b.tahun || '-')}</td>
                <td style="border: 1px solid #000; padding: 5px;">${escapeHTML(b.luas || '-')}</td>
                <td style="border: 1px solid #000; padding: 5px; text-align: center;">${b.jumlah_ruang || 1}</td>
                <td style="border: 1px solid #000; padding: 5px;">${escapeHTML(b.jenis_bantuan_nama || '-')}</td>
                <td style="border: 1px solid #000; padding: 5px;">${escapeHTML(b.keterangan || '-')}</td>
            </tr>
        `).join('');
    } else if (type === 'barang') {
        docTitle = 'BUKU REGISTER INVENTARIS BARANG & PERLENGKAPAN';
        tableHeaders = `
            <tr>
                <th style="border: 1px solid #000; padding: 6px; text-align: center;">No</th>
                <th style="border: 1px solid #000; padding: 6px;">Kode</th>
                <th style="border: 1px solid #000; padding: 6px;">Nama Barang</th>
                <th style="border: 1px solid #000; padding: 6px;">Jenis</th>
                <th style="border: 1px solid #000; padding: 6px; text-align: center;">Tahun</th>
                <th style="border: 1px solid #000; padding: 6px; text-align: center;">Total</th>
                <th style="border: 1px solid #000; padding: 6px; text-align: center;">Tersedia</th>
                <th style="border: 1px solid #000; padding: 6px; text-align: center;">Dipinjam</th>
                <th style="border: 1px solid #000; padding: 6px; text-align: right;">Harga Satuan</th>
                <th style="border: 1px solid #000; padding: 6px;">Sumber Dana</th>
            </tr>
        `;
        tableRows = dataBarang.map((b, i) => {
            const tot = b.jumlah_total !== undefined && b.jumlah_total !== null ? b.jumlah_total : (b.jumlah || 0);
            const ter = b.jumlah_tersedia !== undefined && b.jumlah_tersedia !== null ? b.jumlah_tersedia : (b.jumlah || 0);
            const dip = b.jumlah_dipinjam || 0;
            return `
                <tr>
                    <td style="border: 1px solid #000; padding: 5px; text-align: center;">${i + 1}</td>
                    <td style="border: 1px solid #000; padding: 5px; font-family: monospace;">${escapeHTML(b.kode)}</td>
                    <td style="border: 1px solid #000; padding: 5px; font-weight: bold;">${escapeHTML(b.nama)}</td>
                    <td style="border: 1px solid #000; padding: 5px;">${escapeHTML(b.jenis_barang || '-')}</td>
                    <td style="border: 1px solid #000; padding: 5px; text-align: center;">${escapeHTML(b.tahun || '-')}</td>
                    <td style="border: 1px solid #000; padding: 5px; text-align: center; font-weight: bold;">${tot}</td>
                    <td style="border: 1px solid #000; padding: 5px; text-align: center;">${ter}</td>
                    <td style="border: 1px solid #000; padding: 5px; text-align: center;">${dip}</td>
                    <td style="border: 1px solid #000; padding: 5px; text-align: right;">${b.harga_satuan ? 'Rp ' + Number(b.harga_satuan).toLocaleString('id-ID') : '-'}</td>
                    <td style="border: 1px solid #000; padding: 5px;">${escapeHTML(b.jenis_bantuan_nama || '-')}</td>
                </tr>
            `;
        }).join('');
    } else if (type === 'permintaan') {
        docTitle = 'LAPORAN REKAPITULASI PENGADAAN & PERMINTAAN BARANG';
        tableHeaders = `
            <tr>
                <th style="border: 1px solid #000; padding: 6px; text-align: center;">No</th>
                <th style="border: 1px solid #000; padding: 6px;">Tanggal</th>
                <th style="border: 1px solid #000; padding: 6px;">Nama Pemohon</th>
                <th style="border: 1px solid #000; padding: 6px;">Barang Yang Diminta</th>
                <th style="border: 1px solid #000; padding: 6px; text-align: center;">Jumlah</th>
                <th style="border: 1px solid #000; padding: 6px;">Keperluan</th>
                <th style="border: 1px solid #000; padding: 6px; text-align: center;">Status</th>
            </tr>
        `;
        tableRows = dataPermintaan.map((p, i) => `
            <tr>
                <td style="border: 1px solid #000; padding: 5px; text-align: center;">${i + 1}</td>
                <td style="border: 1px solid #000; padding: 5px;">${formatDateIndo(p.tanggal)}</td>
                <td style="border: 1px solid #000; padding: 5px;">${escapeHTML(p.nama_pemohon)} (${escapeHTML(p.role_pemohon || 'Guru')})</td>
                <td style="border: 1px solid #000; padding: 5px; font-weight: bold;">${escapeHTML(p.nama_barang)}</td>
                <td style="border: 1px solid #000; padding: 5px; text-align: center; font-weight: bold;">${p.jumlah}</td>
                <td style="border: 1px solid #000; padding: 5px;">${escapeHTML(p.keperluan || '-')}</td>
                <td style="border: 1px solid #000; padding: 5px; text-align: center;">${escapeHTML(p.status)}</td>
            </tr>
        `).join('');
    } else if (type === 'peminjaman') {
        docTitle = 'LAPORAN SIRKULASI & PEMINJAMAN SARANA PRASARANA';
        tableHeaders = `
            <tr>
                <th style="border: 1px solid #000; padding: 6px; text-align: center;">No</th>
                <th style="border: 1px solid #000; padding: 6px;">Tgl Pinjam</th>
                <th style="border: 1px solid #000; padding: 6px;">Nama Peminjam</th>
                <th style="border: 1px solid #000; padding: 6px;">Barang</th>
                <th style="border: 1px solid #000; padding: 6px; text-align: center;">Jml</th>
                <th style="border: 1px solid #000; padding: 6px;">Batas Kembali</th>
                <th style="border: 1px solid #000; padding: 6px; text-align: center;">Status</th>
                <th style="border: 1px solid #000; padding: 6px;">Tgl Realisasi</th>
            </tr>
        `;
        tableRows = dataPeminjaman.map((p, i) => `
            <tr>
                <td style="border: 1px solid #000; padding: 5px; text-align: center;">${i + 1}</td>
                <td style="border: 1px solid #000; padding: 5px;">${formatDateIndo(p.tanggal_pinjam)}</td>
                <td style="border: 1px solid #000; padding: 5px;">${escapeHTML(p.nama_peminjam)}</td>
                <td style="border: 1px solid #000; padding: 5px; font-weight: bold;">${escapeHTML(p.nama_barang)}</td>
                <td style="border: 1px solid #000; padding: 5px; text-align: center;">${p.jumlah}</td>
                <td style="border: 1px solid #000; padding: 5px;">${p.tanggal_kembali_rencana ? formatDateIndo(p.tanggal_kembali_rencana) : '-'}</td>
                <td style="border: 1px solid #000; padding: 5px; text-align: center;">${escapeHTML(p.status)}</td>
                <td style="border: 1px solid #000; padding: 5px;">${p.tanggal_kembali_realisasi ? formatDateIndo(p.tanggal_kembali_realisasi) : '-'}</td>
            </tr>
        `).join('');
    } else if (type === 'perbaikan') {
        docTitle = 'LAPORAN PEMELIHARAAN & PERBAIKAN FASILITAS SEKOLAH';
        tableHeaders = `
            <tr>
                <th style="border: 1px solid #000; padding: 6px; text-align: center;">No</th>
                <th style="border: 1px solid #000; padding: 6px;">Tgl Lapor</th>
                <th style="border: 1px solid #000; padding: 6px;">Pelapor</th>
                <th style="border: 1px solid #000; padding: 6px;">Lokasi Fasilitas</th>
                <th style="border: 1px solid #000; padding: 6px;">Deskripsi Kerusakan</th>
                <th style="border: 1px solid #000; padding: 6px; text-align: center;">Status</th>
                <th style="border: 1px solid #000; padding: 6px;">Tindakan Penanganan</th>
            </tr>
        `;
        tableRows = dataPerbaikan.map((r, i) => `
            <tr>
                <td style="border: 1px solid #000; padding: 5px; text-align: center;">${i + 1}</td>
                <td style="border: 1px solid #000; padding: 5px;">${formatDateIndo(r.tanggal)}</td>
                <td style="border: 1px solid #000; padding: 5px;">${escapeHTML(r.nama_pelapor)}</td>
                <td style="border: 1px solid #000; padding: 5px; font-weight: bold;">${escapeHTML(r.lokasi_fasilitas)}</td>
                <td style="border: 1px solid #000; padding: 5px;">${escapeHTML(r.deskripsi_kerusakan)}</td>
                <td style="border: 1px solid #000; padding: 5px; text-align: center;">${escapeHTML(r.status)}</td>
                <td style="border: 1px solid #000; padding: 5px;">${escapeHTML(r.tindakan || '-')}</td>
            </tr>
        `).join('');
    }

    const tglCetak = getWitaISODate();

    printArea.innerHTML = `
        <div style="font-family: Arial, sans-serif; color: #000; line-height: 1.4;">
            <!-- KOP SURAT RESMI -->
            <div style="text-align: center; margin-bottom: 14px;">
                <img src="${SCHOOL_CONFIG?.kopPath || 'assets/kop.png'}" alt="Kop Surat Resmi" style="width: 100%; max-width: 100%; height: auto; object-fit: contain; display: block; margin: 0 auto;" onerror="this.onerror=null; this.src='assets/kop.png';">
            </div>

            <!-- JUDUL DOKUMEN -->
            <div style="text-align: center; margin-bottom: 16px;">
                <div style="font-size: 13px; font-weight: bold; text-decoration: underline;">${docTitle}</div>
                <div style="font-size: 10px; color: #555; margin-top: 3px;">Dicetak pada: ${formatDateIndo(tglCetak)}</div>
            </div>

            <!-- TABEL DATA -->
            <table style="width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 24px;">
                <thead style="background-color: #f1f5f9;">
                    ${tableHeaders}
                </thead>
                <tbody>
                    ${tableRows || '<tr><td colspan="10" style="text-align: center; padding: 12px; border: 1px solid #000;">Tidak ada data.</td></tr>'}
                </tbody>
            </table>

            <!-- LEMBAR TANDA TANGAN -->
            <div style="display: flex; justify-content: space-between; margin-top: 30px; font-size: 11px;">
                <div style="text-align: center; width: 220px;">
                    <div>Mengetahui,</div>
                    <div style="margin-bottom: 60px;">Kepala ${schoolName}</div>
                    <div style="font-weight: bold; text-decoration: underline;">${school.headmasterName || '-'}</div>
                    <div>NIP. ${school.headmasterNIP || '-'}</div>
                </div>
                <div style="text-align: center; width: 220px;">
                    <div>${school.schoolCity || 'Sukawati'}, ${formatDateIndo(tglCetak)}</div>
                    <div style="margin-bottom: 60px;">Pengelola Sarana & Prasarana</div>
                    <div style="font-weight: bold; text-decoration: underline;">Petugas Sarpras</div>
                    <div>NIP. -</div>
                </div>
            </div>
        </div>
    `;
};

window.smsrSarpras.executePrint = function () {
    window.print();
};

window.smsrSarpras.closePrintModal = function () {
    const modal = document.getElementById('print-modal-container');
    if (modal) modal.classList.add('hidden');
};

// =========================================================================
// EXCEL EXPORT (SHEETJS)
// =========================================================================
window.smsrSarpras.exportExcelLaporan = function (type, onlyFiltered = false) {
    if (typeof XLSX === 'undefined') {
        showToast('Library Belum Siap', 'Library Excel belum siap. Silakan periksa koneksi atau muat ulang halaman.', 'error');
        return;
    }

    let exportData = [];
    const tglFile = getWitaISODate();
    let fileName = `Laporan_Sarpras_${type}_${tglFile}.xlsx`;

    if (type === 'tanah') {
        exportData = dataTanah.map((t, i) => ({
            'No': i + 1,
            'Kode': t.kode,
            'Nama Aset Tanah': t.nama,
            'Luas (m2)': t.luas || '-',
            'Lokasi': t.lokasi,
            'Status Kepemilikan': t.status_kepemilikan || 'Milik Sendiri',
            'Jenis Bantuan': t.jenis_bantuan_nama || '-'
        }));
    } else if (type === 'bangunan') {
        exportData = dataBangunan.map((b, i) => ({
            'No': i + 1,
            'Kode': b.kode,
            'Nama Bangunan / Gedung': b.nama,
            'Tahun Pembangunan': b.tahun || '-',
            'Luas (m2)': b.luas || '-',
            'Jumlah Ruang': b.jumlah_ruang || 1,
            'Jenis Bantuan': b.jenis_bantuan_nama || '-',
            'Keterangan': b.keterangan || '-'
        }));
    } else if (type === 'barang') {
        let sourceList = dataBarang;
        if (onlyFiltered) {
            const filterKel = document.getElementById('filter-barang-kelompok')?.value || '';
            const filterBant = document.getElementById('filter-barang-bantuan')?.value || '';
            const q = (document.getElementById('search-barang')?.value || '').trim().toLowerCase();
            sourceList = dataBarang.filter(b => {
                const matchKel = !filterKel || b.jenis_barang === filterKel;
                const matchBant = !filterBant || b.jenis_bantuan_nama === filterBant;
                const matchQ = !q || (b.nama && b.nama.toLowerCase().includes(q)) || (b.kode && b.kode.toLowerCase().includes(q));
                return matchKel && matchBant && matchQ;
            });
        }

        exportData = sourceList.map((b, i) => {
            const tot = b.jumlah_total !== undefined && b.jumlah_total !== null ? b.jumlah_total : (b.jumlah || 0);
            const ter = b.jumlah_tersedia !== undefined && b.jumlah_tersedia !== null ? b.jumlah_tersedia : (b.jumlah || 0);
            const dip = b.jumlah_dipinjam || 0;
            const rsk = b.jumlah_rusak || 0;
            const hlg = b.jumlah_hilang || 0;

            return {
                'No': i + 1,
                'Kode': b.kode,
                'Nama Barang': b.nama,
                'Jenis / Kelompok': b.jenis_barang,
                'Tahun': b.tahun || '-',
                'Total Stok': tot,
                'Stok Tersedia': ter,
                'Stok Dipinjam': dip,
                'Stok Rusak': rsk,
                'Stok Hilang': hlg,
                'Harga Satuan (Rp)': b.harga_satuan || 0,
                'Jenis Bantuan': b.jenis_bantuan_nama || '-',
                'Keterangan': b.keterangan || '-'
            };
        });
    } else if (type === 'permintaan') {
        exportData = dataPermintaan.map((p, i) => ({
            'No': i + 1,
            'Tanggal': p.tanggal,
            'Nama Pemohon': p.nama_pemohon,
            'Role': p.role_pemohon,
            'Nama Barang': p.nama_barang,
            'Jumlah': p.jumlah,
            'Keperluan': p.keperluan || '-',
            'Status': p.status,
            'Keterangan': p.keterangan || '-'
        }));
    } else if (type === 'peminjaman') {
        exportData = dataPeminjaman.map((p, i) => ({
            'No': i + 1,
            'Tgl Pinjam': p.tanggal_pinjam,
            'Nama Peminjam': p.nama_peminjam,
            'Barang': p.nama_barang,
            'Jumlah': p.jumlah,
            'Batas Kembali': p.tanggal_kembali_rencana || '-',
            'Status': p.status,
            'Tgl Kembali Realisasi': p.tanggal_kembali_realisasi || '-',
            'Kondisi Kembali': p.kondisi_kembali || '-',
            'Keterangan': p.keterangan || '-'
        }));
    } else if (type === 'perbaikan') {
        exportData = dataPerbaikan.map((r, i) => ({
            'No': i + 1,
            'Tanggal Lapor': r.tanggal,
            'Pelapor': r.nama_pelapor,
            'Lokasi Fasilitas': r.lokasi_fasilitas,
            'Deskripsi Kerusakan': r.deskripsi_kerusakan,
            'Tingkat Kerusakan': r.tingkat_kerusakan,
            'Status': r.status,
            'Tindakan Penanganan': r.tindakan || '-',
            'Keterangan': r.keterangan || '-'
        }));
    }

    if (exportData.length === 0) {
        showToast('Data Kosong', 'Tidak ada data untuk diekspor ke Excel.', 'warning');
        return;
    }

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data Sarpras');
    XLSX.writeFile(wb, fileName);
    showToast('Berhasil Ekspor', `File Excel "${fileName}" berhasil diunduh.`, 'success');
};

window.smsrSarpras.exportExcelPermintaan = function () {
    window.smsrSarpras.exportExcelLaporan('permintaan');
};

window.smsrSarpras.exportExcelPerbaikan = function () {
    window.smsrSarpras.exportExcelLaporan('perbaikan');
};

// =========================================================================
// ACCESSIBILITY & MODAL SYSTEM HELPERS
// =========================================================================
function setupGlobalModalAccessibility() {
    // Tangani tombol Escape global
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modal = document.getElementById('modal-container');
            if (modal && !modal.classList.contains('hidden')) {
                window.smsrSarpras.closeModal();
                return;
            }
            const printModal = document.getElementById('print-modal-container');
            if (printModal && !printModal.classList.contains('hidden')) {
                window.smsrSarpras.closePrintModal();
            }
        }
    });

    // Focus trap di dalam modal form
    const container = document.getElementById('modal-container');
    if (container) {
        container.addEventListener('keydown', (e) => {
            if (e.key !== 'Tab') return;
            const focusableEls = container.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
            if (focusableEls.length === 0) return;

            const firstEl = focusableEls[0];
            const lastEl = focusableEls[focusableEls.length - 1];

            if (e.shiftKey) {
                if (document.activeElement === firstEl) {
                    lastEl.focus();
                    e.preventDefault();
                }
            } else {
                if (document.activeElement === lastEl) {
                    firstEl.focus();
                    e.preventDefault();
                }
            }
        });
    }

    // Delegasi klik di luar wrapper pemohon untuk menutup dropdown
    document.addEventListener('click', (e) => {
        const wrapper = document.getElementById('prmt-pemohon-wrapper');
        if (wrapper && !wrapper.contains(e.target)) {
            window.smsrSarpras.hidePemohonDropdown();
        }
    });
}

function openModal(title, html) {
    lastFocusedElement = document.activeElement;
    const titleEl = document.getElementById('modal-title');
    const bodyEl = document.getElementById('modal-body');
    const container = document.getElementById('modal-container');

    if (titleEl && bodyEl && container) {
        titleEl.textContent = title;
        bodyEl.innerHTML = html;
        container.classList.remove('hidden');

        // Initial focus pada elemen input/button pertama
        setTimeout(() => {
            const firstInput = bodyEl.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])');
            if (firstInput) firstInput.focus();
        }, 50);
    }
}

window.smsrSarpras.closeModal = function () {
    const container = document.getElementById('modal-container');
    if (container) container.classList.add('hidden');
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
        try {
            lastFocusedElement.focus();
        } catch (e) {}
    }
};

function genKode(prefix, list) {
    let maxNum = 0;
    list.forEach(item => {
        if (item.kode && item.kode.startsWith(prefix)) {
            const num = parseInt(item.kode.replace(prefix, ''), 10);
            if (!isNaN(num) && num > maxNum) maxNum = num;
        }
    });
    return `${prefix}${String(maxNum + 1).padStart(4, '0')}`;
}

// =========================================================================
// MODAL FORMS: MASTER DATA (ADD / EDIT)
// =========================================================================
window.smsrSarpras.openAddModalCurrentSubtab = function () {
    if (activeMasterSubtab === 'barang') window.smsrSarpras.openAddBarangModal();
    else if (activeMasterSubtab === 'bangunan') window.smsrSarpras.openAddBangunanModal();
    else if (activeMasterSubtab === 'tanah') window.smsrSarpras.openAddTanahModal();
    else if (activeMasterSubtab === 'kelompok') window.smsrSarpras.openAddKelompokModal();
    else if (activeMasterSubtab === 'bantuan') window.smsrSarpras.openAddBantuanModal();
};

// 1. FORM ASET BARANG (MULTI-STOK)
window.smsrSarpras.openAddBarangModal = function () {
    const nextKode = genKode('BR', dataBarang);
    renderBarangFormModal(null, nextKode);
};

window.smsrSarpras.openEditBarangModal = function (id) {
    const b = dataBarang.find(item => item.id === id);
    if (!b) return;
    renderBarangFormModal(b, b.kode);
};

function renderBarangFormModal(b, kode) {
    const optKel = dataKelompok.map(k => `<option value="${escapeHTML(k.jenis_barang)}" ${b && b.jenis_barang === k.jenis_barang ? 'selected' : ''}>${escapeHTML(k.jenis_barang)}</option>`).join('');
    const optBant = dataBantuan.map(j => `<option value="${escapeHTML(j.nama)}" ${b && b.jenis_bantuan_nama === j.nama ? 'selected' : ''}>${escapeHTML(j.nama)}</option>`).join('');

    const totalStok = b ? (b.jumlah_total !== undefined && b.jumlah_total !== null ? b.jumlah_total : (b.jumlah || 0)) : 1;
    const dipinjam = b ? (b.jumlah_dipinjam || 0) : 0;
    const rusak = b ? (b.jumlah_rusak || 0) : 0;
    const hilang = b ? (b.jumlah_hilang || 0) : 0;

    openModal(b ? 'Edit Aset Barang' : 'Tambah Aset Barang Baru', `
        <form onsubmit="window.smsrSarpras.submitBarangForm(event, '${b ? b.id : ''}')">
            <div class="space-y-3 text-xs">
                ${b ? `
                    <div class="p-2.5 rounded-xl bg-blue-50/70 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/40 text-[11px] text-slate-600 dark:text-slate-300">
                        <div class="font-bold text-slate-800 dark:text-slate-100 mb-1">Status Alokasi Stok Saat Ini:</div>
                        <div class="grid grid-cols-4 gap-2 text-center">
                            <div class="bg-white dark:bg-slate-800 p-1 rounded border border-slate-200 dark:border-slate-700">Total: <strong class="text-blue-600">${totalStok}</strong></div>
                            <div class="bg-white dark:bg-slate-800 p-1 rounded border border-slate-200 dark:border-slate-700">Tersedia: <strong class="text-emerald-600">${b.jumlah_tersedia ?? b.jumlah ?? 0}</strong></div>
                            <div class="bg-white dark:bg-slate-800 p-1 rounded border border-slate-200 dark:border-slate-700">Dipinjam: <strong class="text-amber-600">${dipinjam}</strong></div>
                            <div class="bg-white dark:bg-slate-800 p-1 rounded border border-slate-200 dark:border-slate-700">Rusak/Hilang: <strong class="text-rose-600">${rusak + hilang}</strong></div>
                        </div>
                    </div>
                ` : ''}

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label for="brg-kode" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Kode Barang</label>
                        <input type="text" id="brg-kode" value="${escapeHTML(kode)}" required class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono font-bold">
                    </div>
                    <div>
                        <label for="brg-tanggal" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Tanggal Perolehan</label>
                        <input type="date" id="brg-tanggal" value="${b ? (b.tanggal_perolehan || getWitaISODate()) : getWitaISODate()}" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">
                    </div>
                </div>

                <div>
                    <label for="brg-nama" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Nama Barang</label>
                    <input type="text" id="brg-nama" value="${b ? escapeHTML(b.nama) : ''}" placeholder="Contoh: Komputer PC Lab 1" required class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label for="brg-jenis" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Kelompok / Jenis</label>
                        <select id="brg-jenis" required class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">
                            <option value="">-- Pilih Kelompok --</option>
                            ${optKel}
                            <option value="Elektronik" ${b && b.jenis_barang === 'Elektronik' ? 'selected' : ''}>Elektronik</option>
                            <option value="Meubelair" ${b && b.jenis_barang === 'Meubelair' ? 'selected' : ''}>Meubelair</option>
                            <option value="Lainnya" ${b && b.jenis_barang === 'Lainnya' ? 'selected' : ''}>Lainnya</option>
                        </select>
                    </div>
                    <div>
                        <label for="brg-tahun" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Tahun Perolehan</label>
                        <input type="text" id="brg-tahun" value="${b ? escapeHTML(b.tahun || '') : new Date().getFullYear()}" placeholder="2026" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label for="brg-jumlah" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Jumlah Total Unit (Stok)</label>
                        <input type="number" id="brg-jumlah" value="${totalStok}" min="${dipinjam + rusak + hilang}" required class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-bold">
                        ${b && (dipinjam + rusak + hilang) > 0 ? `<div class="text-[10px] text-slate-400 mt-0.5">Min: ${dipinjam + rusak + hilang} (karena ada unit teralokasi)</div>` : ''}
                    </div>
                    <div>
                        <label for="brg-harga" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Harga Satuan (Rp)</label>
                        <input type="number" id="brg-harga" value="${b ? (b.harga_satuan || '') : ''}" placeholder="0" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">
                    </div>
                </div>

                <div>
                    <label for="brg-bantuan" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Jenis Bantuan / Sumber Dana</label>
                    <select id="brg-bantuan" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">
                        <option value="-">-- Pilih Sumber Dana --</option>
                        ${optBant}
                        <option value="DAK" ${b && b.jenis_bantuan_nama === 'DAK' ? 'selected' : ''}>DAK</option>
                        <option value="BOS Reguler" ${b && b.jenis_bantuan_nama === 'BOS Reguler' ? 'selected' : ''}>BOS Reguler</option>
                        <option value="Komite" ${b && b.jenis_bantuan_nama === 'Komite' ? 'selected' : ''}>Komite</option>
                    </select>
                </div>

                <div>
                    <label for="brg-ket" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Keterangan Tambahan</label>
                    <textarea id="brg-ket" rows="2" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">${b ? escapeHTML(b.keterangan || '') : ''}</textarea>
                </div>

                <div class="flex gap-2 pt-2">
                    <button type="submit" class="flex-1 py-2.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 shadow transition-all active:scale-95">
                        <i class="fa-solid fa-save mr-1"></i> Simpan Barang
                    </button>
                    <button type="button" onclick="window.smsrSarpras.closeModal()" class="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-all">
                        Batal
                    </button>
                </div>
            </div>
        </form>
    `);
}

window.smsrSarpras.submitBarangForm = async function (e, id) {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    setButtonLoading(submitBtn, true, 'Menyimpan...');

    const totalBaru = parseInt(document.getElementById('brg-jumlah').value, 10) || 0;
    const existing = id ? dataBarang.find(item => item.id === id) : null;

    let dipinjam = 0;
    let rusak = 0;
    let hilang = 0;
    let tersedia = totalBaru;

    if (existing) {
        dipinjam = existing.jumlah_dipinjam || 0;
        rusak = existing.jumlah_rusak || 0;
        hilang = existing.jumlah_hilang || 0;
        const totalAlokasi = dipinjam + rusak + hilang;

        if (totalBaru < totalAlokasi) {
            setButtonLoading(submitBtn, false);
            showToast('Stok Tidak Valid', `Jumlah total (${totalBaru}) tidak boleh lebih kecil dari unit yang sedang teralokasi (${totalAlokasi}: Dipinjam ${dipinjam}, Rusak ${rusak}, Hilang ${hilang}).`, 'warning');
            return;
        }
        tersedia = totalBaru - totalAlokasi;
    }

    const payload = {
        kode: document.getElementById('brg-kode').value.trim(),
        nama: document.getElementById('brg-nama').value.trim(),
        jenis_barang: document.getElementById('brg-jenis').value,
        tahun: document.getElementById('brg-tahun').value.trim(),
        jumlah_total: totalBaru,
        jumlah_tersedia: tersedia,
        jumlah_dipinjam: dipinjam,
        jumlah_rusak: rusak,
        jumlah_hilang: hilang,
        jumlah: tersedia, // Sinkronisasi kolom warisan
        harga_satuan: parseFloat(document.getElementById('brg-harga').value) || 0,
        jenis_bantuan_nama: document.getElementById('brg-bantuan').value,
        tanggal_perolehan: document.getElementById('brg-tanggal').value || getWitaISODate(),
        keterangan: document.getElementById('brg-ket').value.trim(),
        updated_at: new Date().toISOString()
    };

    try {
        if (id) {
            const { error } = await sarprasStore.from('sarpras_barang').update(payload).eq('id', id);
            if (error) throw error;
            showToast('Berhasil', 'Aset barang berhasil diperbarui.', 'success');
        } else {
            const { error } = await sarprasStore.from('sarpras_barang').insert([payload]);
            if (error) throw error;
            showToast('Berhasil', 'Aset barang baru berhasil ditambahkan.', 'success');
        }
        window.smsrSarpras.closeModal();
        await loadAllSarprasData();
    } catch (err) {
        console.error('[Sarpras] Gagal simpan barang:', err);
        showToast('Gagal Menyimpan', `Gagal menyimpan aset barang: ${err.message}`, 'error');
    } finally {
        setButtonLoading(submitBtn, false);
    }
};

// 2. FORM ASET BANGUNAN
window.smsrSarpras.openAddBangunanModal = function () {
    const nextKode = genKode('AB', dataBangunan);
    renderBangunanFormModal(null, nextKode);
};

window.smsrSarpras.openEditBangunanModal = function (id) {
    const b = dataBangunan.find(item => item.id === id);
    if (!b) return;
    renderBangunanFormModal(b, b.kode);
};

function renderBangunanFormModal(b, kode) {
    const optBant = dataBantuan.map(j => `<option value="${escapeHTML(j.nama)}" ${b && b.jenis_bantuan_nama === j.nama ? 'selected' : ''}>${escapeHTML(j.nama)}</option>`).join('');

    openModal(b ? 'Edit Aset Bangunan' : 'Tambah Aset Bangunan Baru', `
        <form onsubmit="window.smsrSarpras.submitBangunanForm(event, '${b ? b.id : ''}')">
            <div class="space-y-3 text-xs">
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label for="bgn-kode" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Kode Bangunan</label>
                        <input type="text" id="bgn-kode" value="${escapeHTML(kode)}" required class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono font-bold">
                    </div>
                    <div>
                        <label for="bgn-tahun" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Tahun Pembangunan</label>
                        <input type="text" id="bgn-tahun" value="${b ? escapeHTML(b.tahun || '') : ''}" placeholder="2020" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">
                    </div>
                </div>

                <div>
                    <label for="bgn-nama" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Nama Bangunan / Gedung</label>
                    <input type="text" id="bgn-nama" value="${b ? escapeHTML(b.nama) : ''}" placeholder="Contoh: Gedung RKB 1" required class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label for="bgn-luas" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Luas (m²)</label>
                        <input type="text" id="bgn-luas" value="${b ? escapeHTML(b.luas || '') : ''}" placeholder="500" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">
                    </div>
                    <div>
                        <label for="bgn-ruang" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Jumlah Ruang</label>
                        <input type="number" id="bgn-ruang" value="${b ? (b.jumlah_ruang || 1) : 1}" min="1" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-bold">
                    </div>
                </div>

                <div>
                    <label for="bgn-bantuan" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Jenis Bantuan</label>
                    <select id="bgn-bantuan" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">
                        <option value="-">-- Pilih Sumber Dana --</option>
                        ${optBant}
                        <option value="DAK" ${b && b.jenis_bantuan_nama === 'DAK' ? 'selected' : ''}>DAK</option>
                        <option value="APBD" ${b && b.jenis_bantuan_nama === 'APBD' ? 'selected' : ''}>APBD</option>
                    </select>
                </div>

                <div>
                    <label for="bgn-ket" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Keterangan</label>
                    <textarea id="bgn-ket" rows="2" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">${b ? escapeHTML(b.keterangan || '') : ''}</textarea>
                </div>

                <div class="flex gap-2 pt-2">
                    <button type="submit" class="flex-1 py-2.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 shadow transition-all active:scale-95">
                        <i class="fa-solid fa-save mr-1"></i> Simpan Bangunan
                    </button>
                    <button type="button" onclick="window.smsrSarpras.closeModal()" class="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-all">
                        Batal
                    </button>
                </div>
            </div>
        </form>
    `);
}

window.smsrSarpras.submitBangunanForm = async function (e, id) {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    setButtonLoading(submitBtn, true, 'Menyimpan...');
    const payload = {
        kode: document.getElementById('bgn-kode').value.trim(),
        nama: document.getElementById('bgn-nama').value.trim(),
        tahun: document.getElementById('bgn-tahun').value.trim(),
        luas: document.getElementById('bgn-luas').value.trim(),
        jumlah_ruang: parseInt(document.getElementById('bgn-ruang').value, 10) || 1,
        jenis_bantuan_nama: document.getElementById('bgn-bantuan').value,
        keterangan: document.getElementById('bgn-ket').value.trim(),
        updated_at: new Date().toISOString()
    };

    try {
        if (id) {
            const { error } = await sarprasStore.from('sarpras_bangunan').update(payload).eq('id', id);
            if (error) throw error;
            showToast('Berhasil', 'Aset bangunan berhasil diperbarui.', 'success');
        } else {
            const { error } = await sarprasStore.from('sarpras_bangunan').insert([payload]);
            if (error) throw error;
            showToast('Berhasil', 'Aset bangunan baru berhasil ditambahkan.', 'success');
        }
        window.smsrSarpras.closeModal();
        await loadAllSarprasData();
    } catch (err) {
        console.error('[Sarpras] Gagal simpan bangunan:', err);
        showToast('Gagal Menyimpan', `Gagal menyimpan aset bangunan: ${err.message}`, 'error');
    } finally {
        setButtonLoading(submitBtn, false);
    }
};

// 3. FORM ASET TANAH
window.smsrSarpras.openAddTanahModal = function () {
    const nextKode = genKode('AT', dataTanah);
    renderTanahFormModal(null, nextKode);
};

window.smsrSarpras.openEditTanahModal = function (id) {
    const t = dataTanah.find(item => item.id === id);
    if (!t) return;
    renderTanahFormModal(t, t.kode);
};

function renderTanahFormModal(t, kode) {
    const optBant = dataBantuan.map(j => `<option value="${escapeHTML(j.nama)}" ${t && t.jenis_bantuan_nama === j.nama ? 'selected' : ''}>${escapeHTML(j.nama)}</option>`).join('');

    openModal(t ? 'Edit Aset Tanah' : 'Tambah Aset Tanah Baru', `
        <form onsubmit="window.smsrSarpras.submitTanahForm(event, '${t ? t.id : ''}')">
            <div class="space-y-3 text-xs">
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label for="tnh-kode" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Kode Tanah</label>
                        <input type="text" id="tnh-kode" value="${escapeHTML(kode)}" required class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono font-bold">
                    </div>
                    <div>
                        <label for="tnh-luas" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Luas (m²)</label>
                        <input type="text" id="tnh-luas" value="${t ? escapeHTML(t.luas || '') : ''}" placeholder="Contoh: 15000" required class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">
                    </div>
                </div>

                <div>
                    <label for="tnh-nama" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Nama Tanah / Sertifikat</label>
                    <input type="text" id="tnh-nama" value="${t ? escapeHTML(t.nama) : ''}" placeholder="Contoh: Tanah Kampus Utama Batubulan" required class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">
                </div>

                <div>
                    <label for="tnh-lokasi" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Lokasi / Alamat</label>
                    <input type="text" id="tnh-lokasi" value="${t ? escapeHTML(t.lokasi || '') : ''}" placeholder="Jl. SMKI Batubulan..." required class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label for="tnh-status" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Status Kepemilikan</label>
                        <select id="tnh-status" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">
                            <option value="Milik Sendiri / Pemprov" ${t && t.status_kepemilikan === 'Milik Sendiri / Pemprov' ? 'selected' : ''}>Milik Sendiri / Pemprov</option>
                            <option value="Hak Pakai" ${t && t.status_kepemilikan === 'Hak Pakai' ? 'selected' : ''}>Hak Pakai</option>
                            <option value="Sewa" ${t && t.status_kepemilikan === 'Sewa' ? 'selected' : ''}>Sewa</option>
                            <option value="Pinjam Pakai" ${t && t.status_kepemilikan === 'Pinjam Pakai' ? 'selected' : ''}>Pinjam Pakai</option>
                        </select>
                    </div>
                    <div>
                        <label for="tnh-bantuan" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Jenis Bantuan</label>
                        <select id="tnh-bantuan" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">
                            <option value="-">-- Pilih Sumber --</option>
                            ${optBant}
                            <option value="Pemerintah Daerah" ${t && t.jenis_bantuan_nama === 'Pemerintah Daerah' ? 'selected' : ''}>Pemerintah Daerah</option>
                            <option value="Hibah" ${t && t.jenis_bantuan_nama === 'Hibah' ? 'selected' : ''}>Hibah</option>
                        </select>
                    </div>
                </div>

                <div>
                    <label for="tnh-ket" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Keterangan / Nomor Sertifikat</label>
                    <textarea id="tnh-ket" rows="2" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">${t ? escapeHTML(t.keterangan || '') : ''}</textarea>
                </div>

                <div class="flex gap-2 pt-2">
                    <button type="submit" class="flex-1 py-2.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 shadow transition-all active:scale-95">
                        <i class="fa-solid fa-save mr-1"></i> Simpan Tanah
                    </button>
                    <button type="button" onclick="window.smsrSarpras.closeModal()" class="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-all">
                        Batal
                    </button>
                </div>
            </div>
        </form>
    `);
}

window.smsrSarpras.submitTanahForm = async function (e, id) {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    setButtonLoading(submitBtn, true, 'Menyimpan...');
    const payload = {
        kode: document.getElementById('tnh-kode').value.trim(),
        nama: document.getElementById('tnh-nama').value.trim(),
        luas: document.getElementById('tnh-luas').value.trim(),
        lokasi: document.getElementById('tnh-lokasi').value.trim(),
        status_kepemilikan: document.getElementById('tnh-status').value,
        jenis_bantuan_nama: document.getElementById('tnh-bantuan').value,
        keterangan: document.getElementById('tnh-ket').value.trim(),
        updated_at: new Date().toISOString()
    };

    try {
        if (id) {
            const { error } = await sarprasStore.from('sarpras_tanah').update(payload).eq('id', id);
            if (error) throw error;
            showToast('Berhasil', 'Aset tanah berhasil diperbarui.', 'success');
        } else {
            const { error } = await sarprasStore.from('sarpras_tanah').insert([payload]);
            if (error) throw error;
            showToast('Berhasil', 'Aset tanah baru berhasil ditambahkan.', 'success');
        }
        window.smsrSarpras.closeModal();
        await loadAllSarprasData();
    } catch (err) {
        console.error('[Sarpras] Gagal simpan tanah:', err);
        showToast('Gagal Menyimpan', `Gagal menyimpan aset tanah: ${err.message}`, 'error');
    } finally {
        setButtonLoading(submitBtn, false);
    }
};

// 4. FORM KELOMPOK BARANG
window.smsrSarpras.openAddKelompokModal = function () {
    const nextKode = genKode('KB', dataKelompok);
    renderKelompokFormModal(null, nextKode);
};

window.smsrSarpras.openEditKelompokModal = function (id) {
    const k = dataKelompok.find(item => item.id === id);
    if (!k) return;
    renderKelompokFormModal(k, k.kode);
};

function renderKelompokFormModal(k, kode) {
    openModal(k ? 'Edit Kelompok Barang' : 'Tambah Kelompok Barang Baru', `
        <form onsubmit="window.smsrSarpras.submitKelompokForm(event, '${k ? k.id : ''}')">
            <div class="space-y-3 text-xs">
                <div>
                    <label for="klp-kode" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Kode Kelompok</label>
                    <input type="text" id="klp-kode" value="${escapeHTML(kode)}" required class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono font-bold">
                </div>
                <div>
                    <label for="klp-nama" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Nama Kelompok / Kategori</label>
                    <input type="text" id="klp-nama" value="${k ? escapeHTML(k.jenis_barang) : ''}" placeholder="Contoh: Alat Musik Tradisional Bali" required class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">
                </div>
                <div>
                    <label for="klp-ket" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Keterangan</label>
                    <textarea id="klp-ket" rows="2" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">${k ? escapeHTML(k.keterangan || '') : ''}</textarea>
                </div>
                <div class="flex gap-2 pt-2">
                    <button type="submit" class="flex-1 py-2.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 shadow transition-all active:scale-95">
                        <i class="fa-solid fa-save mr-1"></i> Simpan Kelompok
                    </button>
                    <button type="button" onclick="window.smsrSarpras.closeModal()" class="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-all">
                        Batal
                    </button>
                </div>
            </div>
        </form>
    `);
}

window.smsrSarpras.submitKelompokForm = async function (e, id) {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    setButtonLoading(submitBtn, true, 'Menyimpan...');
    const payload = {
        kode: document.getElementById('klp-kode').value.trim(),
        jenis_barang: document.getElementById('klp-nama').value.trim(),
        keterangan: document.getElementById('klp-ket').value.trim(),
        updated_at: new Date().toISOString()
    };

    try {
        if (id) {
            const { error } = await sarprasStore.from('sarpras_kelompok_barang').update(payload).eq('id', id);
            if (error) throw error;
            showToast('Berhasil', 'Kelompok barang berhasil diperbarui.', 'success');
        } else {
            const { error } = await sarprasStore.from('sarpras_kelompok_barang').insert([payload]);
            if (error) throw error;
            showToast('Berhasil', 'Kelompok barang baru berhasil ditambahkan.', 'success');
        }
        window.smsrSarpras.closeModal();
        await loadAllSarprasData();
    } catch (err) {
        console.error('[Sarpras] Gagal simpan kelompok:', err);
        showToast('Gagal Menyimpan', `Gagal menyimpan kelompok barang: ${err.message}`, 'error');
    } finally {
        setButtonLoading(submitBtn, false);
    }
};

// 5. FORM JENIS BANTUAN
window.smsrSarpras.openAddBantuanModal = function () {
    const nextKode = genKode('JB', dataBantuan);
    renderBantuanFormModal(null, nextKode);
};

window.smsrSarpras.openEditBantuanModal = function (id) {
    const b = dataBantuan.find(item => item.id === id);
    if (!b) return;
    renderBantuanFormModal(b, b.kode);
};

function renderBantuanFormModal(b, kode) {
    openModal(b ? 'Edit Jenis Bantuan' : 'Tambah Jenis Bantuan Baru', `
        <form onsubmit="window.smsrSarpras.submitBantuanForm(event, '${b ? b.id : ''}')">
            <div class="space-y-3 text-xs">
                <div>
                    <label for="bnt-kode" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Kode Bantuan</label>
                    <input type="text" id="bnt-kode" value="${escapeHTML(kode)}" required class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono font-bold">
                </div>
                <div>
                    <label for="bnt-nama" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Nama Sumber Bantuan / Dana</label>
                    <input type="text" id="bnt-nama" value="${b ? escapeHTML(b.nama) : ''}" placeholder="Contoh: DAK Fisik Reguler SMK" required class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">
                </div>
                <div>
                    <label for="bnt-ket" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Keterangan</label>
                    <textarea id="bnt-ket" rows="2" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">${b ? escapeHTML(b.keterangan || '') : ''}</textarea>
                </div>
                <div class="flex gap-2 pt-2">
                    <button type="submit" class="flex-1 py-2.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 shadow transition-all active:scale-95">
                        <i class="fa-solid fa-save mr-1"></i> Simpan Bantuan
                    </button>
                    <button type="button" onclick="window.smsrSarpras.closeModal()" class="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-all">
                        Batal
                    </button>
                </div>
            </div>
        </form>
    `);
}

window.smsrSarpras.submitBantuanForm = async function (e, id) {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    setButtonLoading(submitBtn, true, 'Menyimpan...');
    const payload = {
        kode: document.getElementById('bnt-kode').value.trim(),
        nama: document.getElementById('bnt-nama').value.trim(),
        keterangan: document.getElementById('bnt-ket').value.trim(),
        updated_at: new Date().toISOString()
    };

    try {
        if (id) {
            const { error } = await sarprasStore.from('sarpras_jenis_bantuan').update(payload).eq('id', id);
            if (error) throw error;
            showToast('Berhasil', 'Jenis bantuan berhasil diperbarui.', 'success');
        } else {
            const { error } = await sarprasStore.from('sarpras_jenis_bantuan').insert([payload]);
            if (error) throw error;
            showToast('Berhasil', 'Jenis bantuan baru berhasil ditambahkan.', 'success');
        }
        window.smsrSarpras.closeModal();
        await loadAllSarprasData();
    } catch (err) {
        console.error('[Sarpras] Gagal simpan bantuan:', err);
        showToast('Gagal Menyimpan', `Gagal menyimpan jenis bantuan: ${err.message}`, 'error');
    } finally {
        setButtonLoading(submitBtn, false);
    }
};

// =========================================================================
// MODAL FORMS: ALUR TRANSAKSI (PERMINTAAN, PINJAM, PERBAIKAN)
// =========================================================================

// HELPER NAMA PENGGUNA LOGIN
function getCurrentUserName() {
    const cachedName = currentUser?.uid ? localStorage.getItem(`cached_user_name_${currentUser.uid}`) : null;
    return cachedName || currentUser?.displayName || currentUser?.email?.split('@')[0] || '';
}

// FORM AJUKAN PERMINTAAN BARANG
window.smsrSarpras.openModalPermintaan = function () {
    const currentName = getCurrentUserName();
    const optBarang = dataBarang.map(b => `<option value="${escapeHTML(b.nama)}">${escapeHTML(b.nama)}</option>`).join('');

    ensureGTKLoaded();

    openModal('Form Usulan Pengadaan / Permintaan Barang', `
        <form onsubmit="window.smsrSarpras.submitPermintaan(event)">
            <div class="space-y-3 text-xs">
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label for="prmt-tanggal" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Tanggal Usulan</label>
                        <input type="date" id="prmt-tanggal" value="${getWitaISODate()}" required
                            class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">
                    </div>
                    <div>
                        <label for="prmt-role" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Peran Pemohon</label>
                        <select id="prmt-role" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">
                            <option value="Guru" selected>Guru / Tenaga Pendidik</option>
                            <option value="Staff TU">Staf Tata Usaha</option>
                            <option value="Wali Kelas">Wali Kelas</option>
                            <option value="Kepala Lab">Kepala Laboratorium</option>
                        </select>
                    </div>
                </div>

                <div>
                    <label for="prmt-pemohon" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Nama Pemohon</label>
                    <div class="relative" id="prmt-pemohon-wrapper">
                        <div class="relative">
                            <input type="text" id="prmt-pemohon" value="${escapeHTML(currentName)}" required placeholder="Ketik atau pilih nama pemohon..."
                                autocomplete="off"
                                onfocus="window.smsrSarpras.showPemohonDropdown()"
                                oninput="window.smsrSarpras.filterPemohonDropdown()"
                                class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs pr-8 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white dark:focus:bg-slate-800 transition-all">
                            <button type="button" onclick="window.smsrSarpras.togglePemohonDropdown(event)" tabindex="-1" title="Buka daftar nama pemohon" aria-label="Buka daftar nama pemohon"
                                class="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none p-1">
                                <i id="prmt-pemohon-icon" class="fa-solid fa-chevron-down text-xs transition-transform duration-200"></i>
                            </button>
                        </div>
                        <div id="prmt-pemohon-dropdown"
                            class="hidden absolute left-0 right-0 top-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl max-h-48 overflow-y-auto z-50 divide-y divide-slate-100 dark:divide-slate-700/60">
                        </div>
                    </div>
                </div>

                <div>
                    <label for="prmt-barang" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Nama Barang Yang Diusulkan</label>
                    <input type="text" id="prmt-barang" list="list-barang-suggest" placeholder="Pilih atau ketik barang baru..." required
                        class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">
                    <datalist id="list-barang-suggest">
                        ${optBarang}
                    </datalist>
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label for="prmt-jumlah" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Jumlah</label>
                        <input type="number" id="prmt-jumlah" value="1" min="1" required
                            class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-bold">
                    </div>
                    <div>
                        <label for="prmt-keperluan" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Keperluan</label>
                        <input type="text" id="prmt-keperluan" placeholder="Praktik KBM / Administrasi..."
                            class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">
                    </div>
                </div>

                <div>
                    <label for="prmt-ket" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Keterangan / Alasan Tambahan</label>
                    <textarea id="prmt-ket" rows="2" placeholder="Spesifikasi teknis, urgensi kebutuhan..."
                        class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs"></textarea>
                </div>

                <div class="flex gap-2 pt-2">
                    <button type="submit" class="flex-1 py-2.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 shadow transition-all active:scale-95">
                        <i class="fa-solid fa-paper-plane mr-1"></i> Kirim Usulan Pengadaan
                    </button>
                    <button type="button" onclick="window.smsrSarpras.closeModal()" class="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-all">
                        Batal
                    </button>
                </div>
            </div>
        </form>
    `);

    // Hubungkan delegasi event click pada dropdown pemohon
    setupPemohonDropdownDelegation();
};

window.smsrSarpras.submitPermintaan = async function (e) {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    setButtonLoading(submitBtn, true, 'Mengajukan...');
    const payload = {
        tanggal: document.getElementById('prmt-tanggal').value,
        nama_pemohon: document.getElementById('prmt-pemohon').value.trim(),
        role_pemohon: document.getElementById('prmt-role').value,
        nama_barang: document.getElementById('prmt-barang').value.trim(),
        jumlah: parseInt(document.getElementById('prmt-jumlah').value, 10) || 1,
        keperluan: document.getElementById('prmt-keperluan').value.trim(),
        status: 'Menunggu',
        keterangan: document.getElementById('prmt-ket').value.trim(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    try {
        const { error } = await sarprasStore.from('sarpras_permintaan').insert([payload]);
        if (error) throw error;
        showToast('Berhasil', 'Usulan pengadaan barang berhasil diajukan.', 'success');
        window.smsrSarpras.closeModal();
        await loadAllSarprasData();
    } catch (err) {
        console.error('[Sarpras] Gagal ajukan permintaan:', err);
        showToast('Gagal Mengajukan', `Gagal mengajukan usulan: ${err.message}`, 'error');
    } finally {
        setButtonLoading(submitBtn, false);
    }
};

// =========================================================================
// SEARCHABLE COMBOBOX PEMOHON PENGADAAN (EVENT DELEGATION ANTI-XSS)
// =========================================================================
function setupPemohonDropdownDelegation() {
    const dropdown = document.getElementById('prmt-pemohon-dropdown');
    if (!dropdown) return;

    dropdown.onclick = (e) => {
        const item = e.target.closest('[data-pemohon-name]');
        if (!item) return;
        const name = item.getAttribute('data-pemohon-name') || '';
        const role = item.getAttribute('data-pemohon-role') || '';
        window.smsrSarpras.selectPemohonOption(name, role);
    };
}

window.smsrSarpras.showPemohonDropdown = async function () {
    const dropdown = document.getElementById('prmt-pemohon-dropdown');
    const icon = document.getElementById('prmt-pemohon-icon');
    if (!dropdown) return;
    dropdown.classList.remove('hidden');
    if (icon) icon.classList.add('rotate-180');
    await ensureGTKLoaded();
    window.smsrSarpras.filterPemohonDropdown();
};

window.smsrSarpras.hidePemohonDropdown = function () {
    const dropdown = document.getElementById('prmt-pemohon-dropdown');
    const icon = document.getElementById('prmt-pemohon-icon');
    if (dropdown) dropdown.classList.add('hidden');
    if (icon) icon.classList.remove('rotate-180');
};

window.smsrSarpras.togglePemohonDropdown = function (e) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    const dropdown = document.getElementById('prmt-pemohon-dropdown');
    if (dropdown && !dropdown.classList.contains('hidden')) {
        window.smsrSarpras.hidePemohonDropdown();
    } else {
        const input = document.getElementById('prmt-pemohon');
        if (input) input.focus();
        window.smsrSarpras.showPemohonDropdown();
    }
};

window.smsrSarpras.filterPemohonDropdown = function () {
    const input = document.getElementById('prmt-pemohon');
    const dropdown = document.getElementById('prmt-pemohon-dropdown');
    if (!input || !dropdown) return;

    const query = input.value.trim().toLowerCase();
    const currentName = getCurrentUserName();

    let html = '';

    // 1. Opsi Akun Login Saat Ini
    const isCurrentMatch = !query || currentName.toLowerCase().includes(query);
    if (currentName && isCurrentMatch) {
        const safeCurrentName = escapeHTML(currentName);
        html += `
            <div class="px-3 py-1.5 bg-blue-50/80 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-bold text-[10px] uppercase tracking-wider flex items-center justify-between border-b border-blue-100 dark:border-blue-900/40">
                <span><i class="fa-solid fa-user-check mr-1.5"></i>Akun Anda (Login)</span>
                <span class="text-[9px] lowercase font-normal opacity-75">Klik untuk memilih</span>
            </div>
            <div data-pemohon-name="${safeCurrentName}" data-pemohon-role=""
                class="px-3 py-2 hover:bg-blue-50 dark:hover:bg-slate-700/60 cursor-pointer flex items-center justify-between transition-colors">
                <div class="flex items-center gap-2">
                    <div class="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-300 flex items-center justify-center font-bold text-[10px]">
                        ${escapeHTML(currentName.charAt(0).toUpperCase())}
                    </div>
                    <div>
                        <div class="font-bold text-slate-800 dark:text-slate-100 text-xs">${safeCurrentName}</div>
                        <div class="text-[10px] text-slate-400">Pengguna login aktif</div>
                    </div>
                </div>
                <span class="text-[10px] bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 px-1.5 py-0.5 rounded font-semibold">Default</span>
            </div>
        `;
    }

    // 2. Daftar Pegawai / GTK dari D1
    const cleanGTK = (dataGTK || []).filter(g => {
        const name = g.name || g.nama || '';
        if (!name) return false;
        if (currentName && name.toLowerCase().trim() === currentName.toLowerCase().trim()) return false;
        if (!query) return true;
        const nip = g.nip || '';
        const jab = g.jabatan || g.jenis_ptk || '';
        return name.toLowerCase().includes(query) || nip.toLowerCase().includes(query) || jab.toLowerCase().includes(query);
    });

    if (cleanGTK.length > 0) {
        html += `
            <div class="px-3 py-1 bg-slate-50 dark:bg-slate-900/70 text-slate-500 font-semibold text-[10px] uppercase border-y border-slate-100 dark:border-slate-800 flex justify-between items-center">
                <span>Daftar GTK / Pegawai Sekolah</span>
                <span>${cleanGTK.length} Ditemukan</span>
            </div>
        `;
        const displayList = cleanGTK.slice(0, 35);
        displayList.forEach(g => {
            const name = g.name || g.nama || '';
            const safeName = escapeHTML(name);
            const jab = g.jabatan || g.jenis_ptk || (g.role ? g.role.toUpperCase() : 'GTK');
            const safeJab = escapeHTML(jab);
            const nip = g.nip ? `NIP: ${escapeHTML(g.nip)}` : '';

            html += `
                <div data-pemohon-name="${safeName}" data-pemohon-role="${safeJab}"
                    class="px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/60 cursor-pointer flex items-center justify-between transition-colors border-b border-slate-50 dark:border-slate-800/50 last:border-0">
                    <div class="flex items-center gap-2 min-w-0">
                        <div class="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center font-bold text-[10px] shrink-0">
                            ${escapeHTML(name.charAt(0).toUpperCase())}
                        </div>
                        <div class="truncate">
                            <div class="font-medium text-slate-800 dark:text-slate-200 text-xs truncate">${safeName}</div>
                            <div class="text-[10px] text-slate-400 truncate">${safeJab} ${nip ? '• ' + nip : ''}</div>
                        </div>
                    </div>
                    <i class="fa-solid fa-chevron-right text-[10px] text-slate-300 ml-2 shrink-0"></i>
                </div>
            `;
        });
        if (cleanGTK.length > 35) {
            html += `<div class="px-3 py-1.5 text-center text-[10px] text-slate-400 italic bg-slate-50/50">Menampilkan 35 dari ${cleanGTK.length} orang. Ketik nama lebih spesifik...</div>`;
        }
    }

    if (!html) {
        html = `
            <div class="p-4 text-center text-slate-400 text-xs">
                <i class="fa-solid fa-user-xmark text-lg mb-1 block opacity-50"></i>
                Tidak ditemukan pegawai dengan nama "<strong>${escapeHTML(query)}</strong>"<br>
                <span class="text-[10px] text-slate-500">Anda tetap dapat menggunakan nama ini untuk diajukan.</span>
            </div>
        `;
    }

    dropdown.innerHTML = html;
};

window.smsrSarpras.selectPemohonOption = function (name, roleSuggestion = '') {
    const input = document.getElementById('prmt-pemohon');
    if (input) {
        input.value = name;
    }

    if (roleSuggestion) {
        const roleSel = document.getElementById('prmt-role');
        if (roleSel) {
            const sLower = roleSuggestion.toLowerCase();
            if (sLower.includes('wali kelas')) {
                roleSel.value = 'Wali Kelas';
            } else if (sLower.includes('lab') || sLower.includes('laboratorium') || sLower.includes('bengkel')) {
                roleSel.value = 'Kepala Lab';
            } else if (sLower.includes('tata usaha') || sLower.includes('tu') || sLower.includes('administrasi') || sLower.includes('staf') || sLower.includes('staff') || sLower.includes('tendik')) {
                roleSel.value = 'Staff TU';
            } else if (sLower.includes('guru') || sLower.includes('pendidik')) {
                roleSel.value = 'Guru';
            }
        }
    }

    window.smsrSarpras.hidePemohonDropdown();
};

// FORM PINJAM BARANG (TRANSAKSI ATOMIK VIA EDGE PROXY)
window.smsrSarpras.openModalPinjam = function () {
    const currentName = getCurrentUserName();
    const optBarang = dataBarang.map(b => {
        const tersedia = b.jumlah_tersedia !== undefined && b.jumlah_tersedia !== null ? b.jumlah_tersedia : (b.jumlah || 0);
        return `<option value="${b.id}" data-stok="${tersedia}">${escapeHTML(b.nama)} (Tersedia: ${tersedia} unit)</option>`;
    }).join('');

    const todayWita = getWitaISODate();

    openModal('Form Peminjaman Barang / Sarana', `
        <form onsubmit="window.smsrSarpras.submitPinjam(event)">
            <div class="space-y-3 text-xs">
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label for="pjm-tanggal" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Tanggal Pinjam</label>
                        <input type="date" id="pjm-tanggal" value="${todayWita}" required
                            class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">
                    </div>
                    <div>
                        <label for="pjm-kembali" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Rencana Tgl Kembali</label>
                        <input type="date" id="pjm-kembali" value="${todayWita}" required
                            class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">
                    </div>
                </div>

                <div>
                    <label for="pjm-nama" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Nama Peminjam (Guru / Siswa / Tamu)</label>
                    <input type="text" id="pjm-nama" value="${escapeHTML(currentName)}" required placeholder="Ketik nama peminjam..."
                        class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">
                </div>

                <div>
                    <label for="pjm-barang" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Pilih Barang</label>
                    <select id="pjm-barang" required onchange="window.smsrSarpras.updateStokPinjamInfo()"
                        class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-medium">
                        <option value="">-- Pilih Barang Dari Inventaris --</option>
                        ${optBarang}
                    </select>
                    <div id="pjm-stok-info" class="text-[11px] text-slate-500 dark:text-slate-400 mt-1"></div>
                </div>

                <div>
                    <label for="pjm-jumlah" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Jumlah Pinjam</label>
                    <input type="number" id="pjm-jumlah" value="1" min="1" required
                        class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-bold">
                </div>

                <div>
                    <label for="pjm-ket" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Keperluan / Keterangan</label>
                    <textarea id="pjm-ket" rows="2" placeholder="Keperluan presentasi di kelas XII DKV 1..."
                        class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs"></textarea>
                </div>

                <div class="flex gap-2 pt-2">
                    <button type="submit" class="flex-1 py-2.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 shadow transition-all active:scale-95">
                        <i class="fa-solid fa-check mr-1"></i> Simpan Peminjaman
                    </button>
                    <button type="button" onclick="window.smsrSarpras.closeModal()" class="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-all">
                        Batal
                    </button>
                </div>
            </div>
        </form>
    `);
};

window.smsrSarpras.updateStokPinjamInfo = function () {
    const sel = document.getElementById('pjm-barang');
    const info = document.getElementById('pjm-stok-info');
    if (!sel || !info) return;

    const b = dataBarang.find(item => item.id === sel.value);
    if (b) {
        const tersedia = b.jumlah_tersedia !== undefined && b.jumlah_tersedia !== null ? b.jumlah_tersedia : (b.jumlah || 0);
        info.innerHTML = `Stok tersedia saat ini: <strong class="${tersedia <= 0 ? 'text-rose-600' : 'text-emerald-600'}">${tersedia} unit</strong>`;
    } else {
        info.textContent = '';
    }
};

window.smsrSarpras.submitPinjam = async function (e) {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const barangId = document.getElementById('pjm-barang').value;
    const itemBarang = dataBarang.find(b => b.id === barangId);

    if (!itemBarang) {
        showToast('Validasi Gagal', 'Silakan pilih barang yang valid dari daftar inventaris.', 'warning');
        return;
    }

    const jumlahPinjam = parseInt(document.getElementById('pjm-jumlah').value, 10) || 1;
    const tersedia = itemBarang.jumlah_tersedia !== undefined && itemBarang.jumlah_tersedia !== null ? itemBarang.jumlah_tersedia : (itemBarang.jumlah || 0);

    if (jumlahPinjam > tersedia) {
        showToast('Stok Tidak Cukup', `Stok barang tidak mencukupi! Tersedia saat ini hanya ${tersedia} unit.`, 'warning');
        return;
    }

    setButtonLoading(submitBtn, true, 'Memproses Peminjaman...');

    try {
        const res = await callSarprasAction('sarpras-pinjam-barang', {
            barang_id: barangId,
            nama_peminjam: document.getElementById('pjm-nama').value.trim(),
            role_peminjam: 'Guru',
            jumlah: jumlahPinjam,
            tanggal_pinjam: document.getElementById('pjm-tanggal').value,
            tanggal_kembali_rencana: document.getElementById('pjm-kembali').value,
            keterangan: document.getElementById('pjm-ket').value.trim()
        });

        if (res && res.error) {
            throw new Error(res.error);
        }

        showToast('Berhasil Dipinjam', 'Peminjaman berhasil dicatat dan alokasi stok inventaris diperbarui secara atomik.', 'success');
        window.smsrSarpras.closeModal();
        await loadAllSarprasData();
    } catch (err) {
        console.error('[Sarpras] Gagal memproses peminjaman:', err);
        showToast('Peminjaman Gagal', `Gagal memproses pinjaman: ${err.message || err}`, 'error');
    } finally {
        setButtonLoading(submitBtn, false);
    }
};

// FORM LAPOR KERUSAKAN FASILITAS
window.smsrSarpras.openModalPerbaikan = function () {
    const currentName = getCurrentUserName();

    openModal('Form Lapor Kerusakan Fasilitas Sekolah', `
        <form onsubmit="window.smsrSarpras.submitPerbaikan(event)">
            <div class="space-y-3 text-xs">
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label for="prb-tanggal" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Tanggal Lapor</label>
                        <input type="date" id="prb-tanggal" value="${getWitaISODate()}" required
                            class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">
                    </div>
                    <div>
                        <label for="prb-tingkat" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Tingkat Kerusakan</label>
                        <select id="prb-tingkat" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">
                            <option value="Ringan" selected>Ringan (Dapat Digunakan Sebagian)</option>
                            <option value="Sedang">Sedang (Perlu Penanganan Cepat)</option>
                            <option value="Berat">Berat (Tidak Dapat Beroperasi / Berbahaya)</option>
                        </select>
                    </div>
                </div>

                <div>
                    <label for="prb-pelapor" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Nama Pelapor</label>
                    <input type="text" id="prb-pelapor" value="${escapeHTML(currentName)}" required
                        class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">
                </div>

                <div>
                    <label for="prb-lokasi" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Lokasi Fasilitas / Ruangan</label>
                    <input type="text" id="prb-lokasi" placeholder="Contoh: Lab Komputer 2 / Toilet Siswa Lantai 2" required
                        class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">
                </div>

                <div>
                    <label for="prb-deskripsi" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Deskripsi Kerusakan</label>
                    <textarea id="prb-deskripsi" rows="3" required placeholder="Jelaskan kondisi kerusakan fisik, indikasi masalah..."
                        class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs"></textarea>
                </div>

                <div>
                    <label for="prb-tindakan" class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Tindakan Sementara / Catatan (Opsional)</label>
                    <input type="text" id="prb-tindakan" placeholder="Kabel sudah dicabut / area sudah dipasangi tanda..."
                        class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">
                </div>

                <div class="flex gap-2 pt-2">
                    <button type="submit" class="flex-1 py-2.5 bg-rose-600 text-white rounded-xl font-bold hover:bg-rose-700 shadow transition-all active:scale-95">
                        <i class="fa-solid fa-triangle-exclamation mr-1"></i> Kirim Laporan Kerusakan
                    </button>
                    <button type="button" onclick="window.smsrSarpras.closeModal()" class="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-all">
                        Batal
                    </button>
                </div>
            </div>
        </form>
    `);
};

window.smsrSarpras.submitPerbaikan = async function (e) {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    setButtonLoading(submitBtn, true, 'Mengirim Laporan...');
    const payload = {
        tanggal: document.getElementById('prb-tanggal').value,
        nama_pelapor: document.getElementById('prb-pelapor').value.trim(),
        role_pelapor: 'Guru',
        lokasi_fasilitas: document.getElementById('prb-lokasi').value.trim(),
        deskripsi_kerusakan: document.getElementById('prb-deskripsi').value.trim(),
        tingkat_kerusakan: document.getElementById('prb-tingkat').value,
        tindakan: document.getElementById('prb-tindakan').value.trim(),
        status: 'Menunggu',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    try {
        const { error } = await sarprasStore.from('sarpras_perbaikan').insert([payload]);
        if (error) throw error;
        showToast('Berhasil', 'Laporan kerusakan fasilitas berhasil dikirim ke pengelola Sarpras.', 'success');
        window.smsrSarpras.closeModal();
        await loadAllSarprasData();
    } catch (err) {
        console.error('[Sarpras] Gagal kirim laporan perbaikan:', err);
        showToast('Gagal Mengirim', `Gagal mengirim laporan: ${err.message}`, 'error');
    } finally {
        setButtonLoading(submitBtn, false);
    }
};

// =========================================================================
// GENERIC & ATOMIC DELETE HANDLER
// =========================================================================
window.smsrSarpras.deleteRecord = async function (table, id, name) {
    if (!isSarprasAdmin) {
        showToast('Akses Ditolak', 'Hanya pengelola Sarpras atau Super Admin yang dapat menghapus data.', 'warning');
        return;
    }

    if (!confirm(`Apakah Anda yakin ingin menghapus data "${name}"? Tindakan ini tidak dapat dibatalkan.`)) return;

    try {
        // Jika menghapus barang, gunakan Edge Proxy atomik untuk memvalidasi peminjaman aktif
        if (table === 'sarpras_barang') {
            const res = await callSarprasAction('sarpras-hapus-aset', { barang_id: id });
            if (res && res.error) {
                throw new Error(res.error);
            }
        } else {
            const { error } = await sarprasStore.from(table).delete().eq('id', id);
            if (error) throw error;
        }

        showToast('Berhasil Dihapus', `Data "${name}" berhasil dihapus dari sistem.`, 'success');
        await loadAllSarprasData();
    } catch (err) {
        console.error(`[Sarpras] Gagal hapus data dari ${table}:`, err);
        showToast('Gagal Menghapus', `Tidak dapat menghapus data: ${err.message || err}`, 'error');
    }
};

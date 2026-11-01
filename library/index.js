/* library/index.js - Dashboard Sirkulasi Cepat Perpustakaan */
import { auth, db, PATHS, supabase, resolvePhotoUrl } from '../js/config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { initLayout, escapeHTML, formatDateIndo, getLocalISODate, callSecureEdgeFunction } from '../js/global.js';
import { addLoanDays, countChargeableLateDays } from './circulation-utils.mjs';
import { extractNisFromQrInput, extractCardTokenFromQrInput, resolveNisFromQrInput, isQrInputSettled } from '../js/utils.mjs';

// =========================================================================
// DATE FORMAT HELPERS: dd/mm/yyyy ↔ ISO yyyy-mm-dd
// =========================================================================
function formatToIndoDmy(isoStr) {
    if (!isoStr || !/^\d{4}-\d{2}-\d{2}$/.test(isoStr)) return '';
    const [y, m, d] = isoStr.split('-');
    return `${d}/${m}/${y}`;
}

function parseIndoDmyToIso(dmyStr) {
    if (!dmyStr || typeof dmyStr !== 'string') return null;
    const str = dmyStr.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    const match = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
    if (match) {
        const d = parseInt(match[1], 10);
        const m = parseInt(match[2], 10);
        const y = parseInt(match[3], 10);
        if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2100) {
            return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        }
    }
    return null;
}
// =========================================================================
// 1. STATE & GLOBAL CONFIGURATION
// =========================================================================
let libConfig = {
    max_pinjam_siswa: 3,
    max_pinjam_guru: 5,
    enable_max_pinjam_siswa: true,
    enable_max_pinjam_guru: true,
    durasi_pinjam_siswa_hari: 7,
    durasi_pinjam_guru_hari: 14,
    enable_durasi_siswa: true,
    enable_durasi_guru: true,
    max_perpanjangan: 1,
    enable_max_perpanjangan: true,
    tarif_denda_per_hari: 1000,
    enable_denda: true,
    abaikan_hari_libur: true,
    prefix_nomor_induk: ''
};

let allStudentsCache = [];
let allTeachersCache = [];
let activeSirkulasiList = [];
let currentReturnTransaction = null;
let currentBorrower = null;
let currentSelectedBook = null;
let currentReturnBorrower = null;
let currentReturnBorrowerLoans = [];
let activeReturnMode = 'borrower';
let libraryHolidays = new Set();
let canManageCirculation = false;

function normalizeLibraryIdentifier(value) {
    const identifier = String(value || '').trim();
    return /^[A-Za-z0-9._/ -]{1,80}$/.test(identifier) ? identifier : '';
}

/**
 * Dapatkan 2 huruf inisial nama peminjam (guru/siswa) dengan menyaring gelar akademik
 */
export function getBorrowerInitials(name) {
    if (!name || typeof name !== 'string') return 'P';
    let clean = name.trim();
    // Hapus gelar dan singkatan akademik umum di awal/akhir nama
    const titleRegex = /\b(Drs|Dra|Dr|Prof|Ir|H|Hj|M\.Pd|S\.Pd|M\.Si|S\.T|S\.Ag|S\.Kom|M\.M|Gr|S\.E|S\.P|M\.P)\b\.?/gi;
    let filtered = clean.replace(titleRegex, ' ');

    filtered = filtered.replace(/[^a-zA-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!filtered) {
        filtered = clean.replace(/[^a-zA-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();
    }
    if (!filtered) return 'P';

    const parts = filtered.split(' ').filter(Boolean);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return filtered.slice(0, 2).toUpperCase();
}

/**
 * Render elemen pasfoto peminjam dengan validasi OWASP ASVS Level 2
 * (sanitasi URL, pemblokiran skema berbahaya, dan graceful fallback inisial)
 */
export function renderBorrowerAvatar(imgEl, fallbackEl, initialsEl, photoUrl, name) {
    if (!imgEl || !fallbackEl) return;
    const initials = getBorrowerInitials(name);
    if (initialsEl) initialsEl.textContent = initials;

    let resolved = photoUrl ? resolvePhotoUrl(photoUrl) : '';
    // OWASP Security: tolak skema berbahaya
    if (resolved && !/^(https?:|\/|data:image\/)/i.test(resolved)) {
        resolved = '';
    }

    if (resolved) {
        imgEl.src = resolved;
        imgEl.classList.remove('hidden');
        fallbackEl.classList.add('hidden');
    } else {
        imgEl.src = '';
        imgEl.classList.add('hidden');
        fallbackEl.classList.remove('hidden');
    }
}

/**
 * Ekstraksi & pencocokan peminjam dari scan barcode kartu atau teks pencarian
 * Mendukung scanning NIP Guru, NIS Siswa, maupun scan URL QR kartu fisik
 */
export function extractBorrowerFromInput(rawQuery, typeHint = null) {
    if (!rawQuery || typeof rawQuery !== 'string') return null;
    let query = rawQuery.trim();
    if (!query) return null;

    // 1. Ekstraksi / dekripsi jika input berasal dari barcode/QR kartu siswa (e.g. kartu-shakti.html?id=kts_..., kts_..., atau ?nis=...)
    let extractedNis = '';
    try {
        if (typeof extractNisFromQrInput === 'function') {
            extractedNis = extractNisFromQrInput(query);
        } else if (typeof window !== 'undefined' && typeof window.extractNisFromQrInput === 'function') {
            extractedNis = window.extractNisFromQrInput(query);
        }
    } catch (_) {}

    if (!extractedNis && (query.includes('kartu-shakti.html') || query.startsWith('kts_'))) {
        const urlMatch = query.match(/[?&]nis=([^&#\s]+)/) || query.match(/[?&]id=([^&#\s]+)/);
        if (urlMatch) extractedNis = decodeURIComponent(urlMatch[1]).trim();
    }

    const queryLower = query.toLowerCase();
    const nisLower = (extractedNis || '').toLowerCase();

    // 2. Cek di Master GTK / Guru (Cloudflare D1 SSOT cache)
    if (typeHint !== 'siswa' && Array.isArray(allTeachersCache) && allTeachersCache.length > 0) {
        const matchedTeacher = allTeachersCache.find(t => {
            const nip = String(t.nip || '').trim().toLowerCase();
            const nik = String(t.nik || '').trim().toLowerCase();
            const id = String(t.id || '').trim().toLowerCase();
            const nama = String(t.nama || t.name || '').trim().toLowerCase();
            return (nip && nip === queryLower) ||
                   (nik && nik === queryLower) ||
                   (id && id === queryLower) ||
                   (nama && nama === queryLower);
        });
        if (matchedTeacher) {
            return { item: matchedTeacher, type: 'guru' };
        }
    }

    // 3. Cek di Master Siswa Aktif (Mendukung pencocokan NIS hasil dekripsi QR, NIS polos, NISN, ID, atau Nama)
    if (typeHint !== 'guru' && Array.isArray(allStudentsCache) && allStudentsCache.length > 0) {
        const matchedStudent = allStudentsCache.find(s => {
            const nis = String(s.nis || '').trim().toLowerCase();
            const nisn = String(s.nisn || '').trim().toLowerCase();
            const id = String(s.id || '').trim().toLowerCase();
            const nama = String(s.nama || s.name || '').trim().toLowerCase();
            return (nis && (nis === nisLower || nis === queryLower)) ||
                   (nisn && (nisn === nisLower || nisn === queryLower)) ||
                   (id && (id === nisLower || id === queryLower)) ||
                   (nama && nama === queryLower);
        });
        if (matchedStudent) {
            return { item: matchedStudent, type: 'siswa' };
        }
    }

    return null;
}

/**
 * Versi async extractBorrowerFromInput: token QR kartu (kts_ / public token) diterjemahkan dulu
 * menjadi NIS oleh Worker, karena kunci token kartu hanya ada di server.
 */
export async function resolveBorrowerFromInput(rawQuery, typeHint = null) {
    if (extractCardTokenFromQrInput(rawQuery)) {
        const nis = await resolveNisFromQrInput(rawQuery);
        return nis ? extractBorrowerFromInput(nis, 'siswa') : null;
    }
    return extractBorrowerFromInput(rawQuery, typeHint);
}

window.getBorrowerInitials = getBorrowerInitials;
window.renderBorrowerAvatar = renderBorrowerAvatar;
window.extractBorrowerFromInput = extractBorrowerFromInput;
window.resolveBorrowerFromInput = resolveBorrowerFromInput;

// =========================================================================
// 2. AUTHENTICATION & RBAC GUARD
// =========================================================================
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = '../index.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
        return;
    }

    const primaryRole = localStorage.getItem('user_role') || 'guru_mapel';
    const allRoles = window.getAllUserRoles ? window.getAllUserRoles() : [primaryRole];
    
    // Periksa hak akses sirkulasi (super_admin, admin_perpus, staff, kepala_sekolah)
    const allowedRoles = ['super_admin', 'admin_perpus', 'staff', 'kepala_sekolah'];
    const hasAccess = allRoles.some(r => allowedRoles.includes(r));
    canManageCirculation = allRoles.some(r => ['super_admin', 'admin_perpus', 'staff'].includes(r));

    if (!hasAccess) {
        Swal.fire({
            icon: 'error',
            title: 'Akses Ditolak',
            text: 'Halaman Sirkulasi hanya dapat diakses oleh Petugas / Admin Perpustakaan.',
            confirmButtonColor: '#2563eb'
        }).then(() => {
            window.location.href = 'opac.html';
        });
        return;
    }

    await initLayout(primaryRole);
    document.querySelector('main')?.classList.remove('hidden');

    // Inisialisasi Data Modul
    await loadLibraryConfig();
    await loadInitialMasterData();
    await loadDashboardStats();
    await loadSirkulasiData();
    setupEventListeners();
    applyCirculationPermissionUI();
});

// =========================================================================
// 3. LOAD CONFIGURATION & MASTER DATA
// =========================================================================
async function loadLibraryConfig() {
    try {
        const [{ data, error }, { data: holidaysData, error: holidaysError }] = await Promise.all([
            supabase.from('lib_config').select('key, value'),
            supabase.from('lib_opac_hari_libur').select('tanggal')
        ]);
        if (!error && data) {
            data.forEach(item => {
                if (item.key === 'tarif_denda_per_hari') {
                    const num = Number(item.value);
                    libConfig[item.key] = (!isNaN(num) && num >= 0) ? num : 1000;
                } else if (item.key === 'max_perpanjangan') {
                    const num = parseInt(item.value, 10);
                    libConfig[item.key] = (!isNaN(num) && num >= 0) ? num : libConfig[item.key];
                } else if (item.key === 'durasi_pinjam_siswa_hari' || item.key === 'durasi_pinjam_guru_hari' || item.key === 'max_pinjam_siswa' || item.key === 'max_pinjam_guru') {
                    const num = parseInt(item.value, 10);
                    libConfig[item.key] = (!isNaN(num) && num > 0) ? num : libConfig[item.key];
                } else if (item.key === 'abaikan_hari_libur' || item.key.startsWith('enable_')) {
                    libConfig[item.key] = item.value === 'true';
                } else {
                    libConfig[item.key] = item.value;
                }
            });
        }
        if (!holidaysError) {
            libraryHolidays = new Set((holidaysData || []).map(item => item.tanggal).filter(Boolean));
        }

        const tarifEl = document.getElementById('display-tarif-denda');
        if (tarifEl) {
            if (libConfig.enable_denda === false) {
                tarifEl.innerHTML = '<span class="text-emerald-600 dark:text-emerald-400 font-bold">Bebas Denda (Nonaktif)</span>';
            } else {
                tarifEl.textContent = `Rp ${Number(libConfig.tarif_denda_per_hari).toLocaleString('id-ID')} / hari`;
            }
        }
    } catch (e) {
        console.warn('[Library] Gagal memuat konfigurasi lib_config:', e);
    }
}

function applyCirculationPermissionUI() {
    if (canManageCirculation) return;

    ['btn-submit-pinjam', 'btn-confirm-return', 'btn-perpanjang'].forEach(id => {
        const button = document.getElementById(id);
        if (!button) return;
        button.disabled = true;
        button.classList.add('opacity-50', 'cursor-not-allowed');
        button.title = 'Mode audit: Kepala Sekolah hanya dapat melihat data sirkulasi.';
    });
}

async function loadInitialMasterData() {
    try {
        // Ambil cache Siswa Aktif & Guru dari Helper Global (menghormati konfigurasi showAlumni di Pengaturan)
        if (window.getActiveStudentsCache) {
            allStudentsCache = await window.getActiveStudentsCache();
        } else if (window.getStudentsCache) {
            const rawStudents = await window.getStudentsCache();
            allStudentsCache = rawStudents.filter(s => window.isStudentActive ? window.isStudentActive(s) : !String(s.kelas || s.class || '').toLowerCase().includes('alumni'));
        }
        if (window.getTeachersCache) {
            allTeachersCache = await window.getTeachersCache();
        }
    } catch (e) {
        console.warn('[Library] Error load master cache:', e);
    }
}

// =========================================================================
// 4. DASHBOARD STATS
// =========================================================================
async function loadDashboardStats() {
    try {
        const todayStr = getLocalISODate();

        // 1. Total Judul Buku
        const { count: countJudul } = await supabase
            .from('lib_buku')
            .select('*', { count: 'exact', head: true })
            .is('archived_at', null);

        // 2. Total Eksemplar & Tersedia
        const { data: eksemplarData } = await supabase
            .from('lib_eksemplar')
            .select('status')
            .is('archived_at', null);

        let totalEksemplar = 0;
        let totalTersedia = 0;
        let totalDipinjam = 0;

        if (eksemplarData) {
            totalEksemplar = eksemplarData.length;
            totalTersedia = eksemplarData.filter(e => e.status === 'tersedia').length;
            totalDipinjam = eksemplarData.filter(e => e.status === 'dipinjam').length;
        }

        // 3. Sirkulasi Terlambat
        const { data: terlambatData } = await supabase
            .from('lib_sirkulasi')
            .select('id')
            .eq('status', 'dipinjam')
            .lt('tgl_jatuh_tempo', todayStr);

        const countTerlambat = terlambatData ? terlambatData.length : 0;

        // 4. Pengunjung Hari Ini
        const { count: countPengunjung } = await supabase
            .from('lib_pengunjung')
            .select('*', { count: 'exact', head: true })
            .eq('tanggal', todayStr);

        // Update UI
        document.getElementById('stat-total-judul').textContent = (countJudul || 0).toLocaleString('id-ID');
        document.getElementById('stat-total-eksemplar').textContent = totalEksemplar.toLocaleString('id-ID');
        document.getElementById('stat-sedang-dipinjam').textContent = totalDipinjam.toLocaleString('id-ID');
        document.getElementById('stat-terlambat').textContent = countTerlambat.toLocaleString('id-ID');
        document.getElementById('stat-tersedia').textContent = totalTersedia.toLocaleString('id-ID');
        document.getElementById('stat-pengunjung-today').textContent = (countPengunjung || 0).toLocaleString('id-ID');

    } catch (e) {
        console.error('[Library] Gagal load statistik dashboard:', e);
    }
}

// =========================================================================
// 5. EVENT LISTENERS & SEARCH AUTOCOMPLETE
// =========================================================================
function setupEventListeners() {
    const inputPeminjamSearch = document.getElementById('input-peminjam-search');
    const peminjamDropdown = document.getElementById('peminjam-dropdown');
    const inputBookBarcode = document.getElementById('input-book-barcode');
    const formPeminjaman = document.getElementById('form-peminjaman');
    const inputReturnBarcode = document.getElementById('input-return-barcode');
    const btnConfirmReturn = document.getElementById('btn-confirm-return');
    const btnPerpanjang = document.getElementById('btn-perpanjang');
    const searchSirkulasi = document.getElementById('search-sirkulasi');
    const filterStatusSirkulasi = document.getElementById('filter-status-sirkulasi');
    const btnExportSirkulasi = document.getElementById('btn-export-sirkulasi');
    const btnRefreshSirkulasi = document.getElementById('btn-refresh-sirkulasi');

    // Inisialisasi Tanggal Pinjam Default (Hari Ini) — Format dd/mm/yyyy
    const today = getLocalISODate();
    const tglPinjamEl = document.getElementById('input-tgl-pinjam');
    const tglPinjamPicker = document.getElementById('input-tgl-pinjam-picker');
    const tglTempoEl = document.getElementById('input-tgl-jatuh-tempo');
    const tglTempoPicker = document.getElementById('input-tgl-jatuh-tempo-picker');

    if (tglPinjamEl) {
        tglPinjamEl.value = formatToIndoDmy(today);
        tglPinjamEl.addEventListener('input', () => {
            const iso = parseIndoDmyToIso(tglPinjamEl.value);
            if (iso && tglPinjamPicker) tglPinjamPicker.value = iso;
            if (iso) updateDueDateBasedOnBorrower();
        });
    }
    if (tglPinjamPicker) {
        tglPinjamPicker.value = today;
        tglPinjamPicker.addEventListener('change', () => {
            if (tglPinjamPicker.value) {
                tglPinjamEl.value = formatToIndoDmy(tglPinjamPicker.value);
                updateDueDateBasedOnBorrower();
            }
        });
    }
    if (tglTempoEl) {
        tglTempoEl.addEventListener('input', () => {
            const iso = parseIndoDmyToIso(tglTempoEl.value);
            if (iso && tglTempoPicker) tglTempoPicker.value = iso;
        });
    }
    if (tglTempoPicker) {
        tglTempoPicker.addEventListener('change', () => {
            if (tglTempoPicker.value) {
                tglTempoEl.value = formatToIndoDmy(tglTempoPicker.value);
            }
        });
    }

    // Radio Peminjam Type change
    document.querySelectorAll('input[name="peminjam_type"]').forEach(radio => {
        radio.addEventListener('change', () => {
            resetBorrowerSelection();
            inputPeminjamSearch.focus();
        });
    });

    // Peminjam Search (Live dropdown & Fast-Scan Barcode NIP / Kartu)
    inputPeminjamSearch.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const val = inputPeminjamSearch.value.trim();
            if (!val) return;
            const resolved = await resolveBorrowerFromInput(val);
            if (resolved) {
                const targetRadio = document.querySelector(`input[name="peminjam_type"][value="${resolved.type}"]`);
                if (targetRadio && !targetRadio.checked) {
                    targetRadio.checked = true;
                }
                await selectBorrower(resolved.item, resolved.type);
                peminjamDropdown.classList.add('hidden');
                document.getElementById('input-book-barcode')?.focus();
            }
        }
    });

    inputPeminjamSearch.addEventListener('input', async (e) => {
        const rawVal = e.target.value;
        const type = document.querySelector('input[name="peminjam_type"]:checked')?.value || 'siswa';

        // Auto-resolve jika input berasal dari barcode scanner fisik (URL QR kartu, token kts_, NIP guru, atau barcode NIS siswa)
        const trimmedVal = rawVal.trim();
        if (trimmedVal.includes('kartu-shakti.html') || trimmedVal.startsWith('kts_') || /^\d{4,}$/.test(trimmedVal)) {
            if (extractCardTokenFromQrInput(trimmedVal) && !(await isQrInputSettled(inputPeminjamSearch, trimmedVal))) return;
            const resolved = await resolveBorrowerFromInput(trimmedVal);
            if (resolved) {
                const targetRadio = document.querySelector(`input[name="peminjam_type"][value="${resolved.type}"]`);
                if (targetRadio && !targetRadio.checked) {
                    targetRadio.checked = true;
                }
                await selectBorrower(resolved.item, resolved.type);
                peminjamDropdown.classList.add('hidden');
                document.getElementById('input-book-barcode')?.focus();
                return;
            }
        }

        const query = rawVal.trim().toLowerCase();
        renderPeminjamDropdown(query, type);
    });

    inputPeminjamSearch.addEventListener('focus', (e) => {
        const type = document.querySelector('input[name="peminjam_type"]:checked')?.value || 'siswa';
        renderPeminjamDropdown(e.target.value.trim().toLowerCase(), type);
    });

    document.addEventListener('click', (e) => {
        if (!inputPeminjamSearch.contains(e.target) && !peminjamDropdown.contains(e.target)) {
            peminjamDropdown.classList.add('hidden');
        }
    });

    // Scan Barcode Buku Peminjaman
    inputBookBarcode.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const barcode = inputBookBarcode.value.trim();
            if (!barcode) return;
            await lookupBookForBorrowing(barcode);
        }
    });

    // Submit Peminjaman
    formPeminjaman.addEventListener('submit', handleProcessBorrowing);

    // Return Mode Peminjam Events
    const inputReturnPeminjamSearch = document.getElementById('input-return-peminjam-search');
    const returnPeminjamDropdown = document.getElementById('return-peminjam-dropdown');
    const inputReturnVerifyBarcode = document.getElementById('input-return-verify-barcode');

    if (inputReturnPeminjamSearch) {
        inputReturnPeminjamSearch.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const val = inputReturnPeminjamSearch.value.trim();
                if (!val) return;
                const resolved = await resolveBorrowerFromInput(val);
                if (resolved) {
                    const targetRadio = document.querySelector(`input[name="return_peminjam_type"][value="${resolved.type}"]`);
                    if (targetRadio && !targetRadio.checked) {
                        targetRadio.checked = true;
                    }
                    await selectReturnBorrower(resolved.item, resolved.type);
                    returnPeminjamDropdown.classList.add('hidden');
                }
            }
        });

        inputReturnPeminjamSearch.addEventListener('input', async (e) => {
            const rawVal = e.target.value;
            const type = document.querySelector('input[name="return_peminjam_type"]:checked')?.value || 'siswa';

            const trimmedVal = rawVal.trim();
            if (trimmedVal.includes('kartu-shakti.html') || trimmedVal.startsWith('kts_') || /^\d{4,}$/.test(trimmedVal)) {
                if (extractCardTokenFromQrInput(trimmedVal) && !(await isQrInputSettled(inputReturnPeminjamSearch, trimmedVal))) return;
                const resolved = await resolveBorrowerFromInput(trimmedVal);
                if (resolved) {
                    const targetRadio = document.querySelector(`input[name="return_peminjam_type"][value="${resolved.type}"]`);
                    if (targetRadio && !targetRadio.checked) {
                        targetRadio.checked = true;
                    }
                    await selectReturnBorrower(resolved.item, resolved.type);
                    returnPeminjamDropdown.classList.add('hidden');
                    return;
                }
            }

            const query = rawVal.trim().toLowerCase();
            renderReturnPeminjamDropdown(query, type);
        });

        inputReturnPeminjamSearch.addEventListener('focus', (e) => {
            const type = document.querySelector('input[name="return_peminjam_type"]:checked')?.value || 'siswa';
            renderReturnPeminjamDropdown(e.target.value.trim().toLowerCase(), type);
        });
    }

    document.querySelectorAll('input[name="return_peminjam_type"]').forEach(radio => {
        radio.addEventListener('change', () => {
            window.resetReturnBorrowerSelection();
            document.getElementById('input-return-peminjam-search')?.focus();
        });
    });

    document.addEventListener('click', (e) => {
        if (inputReturnPeminjamSearch && returnPeminjamDropdown && !inputReturnPeminjamSearch.contains(e.target) && !returnPeminjamDropdown.contains(e.target)) {
            returnPeminjamDropdown.classList.add('hidden');
        }
    });

    if (inputReturnVerifyBarcode) {
        inputReturnVerifyBarcode.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const barcode = inputReturnVerifyBarcode.value.trim();
                if (!barcode) return;
                await handleVerifyReturnBarcode(barcode);
            }
        });
    }

    // Scan Barcode Pengembalian Cepat (Mode 2)
    if (inputReturnBarcode) {
        inputReturnBarcode.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const barcode = inputReturnBarcode.value.trim();
                if (!barcode) return;
                await lookupTransactionForReturn(barcode);
            }
        });
    }

    // Konfirmasi Pengembalian
    btnConfirmReturn.addEventListener('click', handleProcessReturn);

    // Perpanjangan Masa Pinjam
    btnPerpanjang.addEventListener('click', handleProcessExtension);

    // Filter & Search Sirkulasi Table
    searchSirkulasi.addEventListener('input', renderSirkulasiTable);
    filterStatusSirkulasi.addEventListener('change', renderSirkulasiTable);
    btnRefreshSirkulasi.addEventListener('click', async () => {
        btnRefreshSirkulasi.querySelector('i').classList.add('fa-spin');
        await loadDashboardStats();
        await loadSirkulasiData();
        btnRefreshSirkulasi.querySelector('i').classList.remove('fa-spin');
    });

    btnExportSirkulasi.addEventListener('click', exportSirkulasiToExcel);
}

// =========================================================================
// 6. BORROWER SELECTION & VALIDATION
// =========================================================================
function renderPeminjamDropdown(query, type) {
    const dropdown = document.getElementById('peminjam-dropdown');
    dropdown.innerHTML = '';

    let matches = [];
    if (type === 'siswa') {
        matches = allStudentsCache.filter(s => {
            const name = (s.nama || s.name || '').toLowerCase();
            const nis = (s.nis || s.nisn || '').toString().toLowerCase();
            const kelas = (s.kelas || s.class || '').toLowerCase();
            return name.includes(query) || nis.includes(query) || kelas.includes(query);
        }).slice(0, 15);
    } else {
        matches = allTeachersCache.filter(t => {
            const name = (t.nama || t.name || '').toLowerCase();
            const nip = (t.nip || '').toString().toLowerCase();
            return name.includes(query) || nip.includes(query);
        }).slice(0, 15);
    }

    if (matches.length === 0) {
        dropdown.innerHTML = `<div class="p-3 text-xs text-slate-400 text-center italic">Tidak ada data ${type} yang cocok</div>`;
        dropdown.classList.remove('hidden');
        return;
    }

    matches.forEach(item => {
        const div = document.createElement('div');
        div.className = 'p-3 hover:bg-blue-50 dark:hover:bg-slate-700/60 cursor-pointer flex items-center justify-between text-xs transition-colors';
        
        const nama = item.nama || item.name || 'Tanpa Nama';
        const idVal = item.nis || item.nisn || item.nip || item.id || '-';
        const sub = type === 'siswa' ? (item.kelas || item.class || 'Kelas -') : (item.jabatan || 'Guru / Staf');

        const fotoVal = item.foto || item.photo_url || item.activePhotoUrl || item.active_photo_url || item.photoUrl || '';
        const initials = getBorrowerInitials(nama);
        const resolvedPhoto = fotoVal ? resolvePhotoUrl(fotoVal) : '';
        const safePhoto = (resolvedPhoto && /^(https?:|\/|data:image\/)/i.test(resolvedPhoto)) ? escapeHTML(resolvedPhoto) : '';

        div.innerHTML = `
            <div class="flex items-center gap-2.5 min-w-0">
                <div class="w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-slate-100 dark:bg-slate-700 flex items-center justify-center border border-slate-200 dark:border-slate-600">
                    ${safePhoto ? `<img src="${safePhoto}" alt="${escapeHTML(nama)}" class="w-full h-full object-cover" onerror="this.remove()">` : ''}
                    <span class="text-[10px] font-bold text-slate-500 dark:text-slate-300 select-none">${initials}</span>
                </div>
                <div class="min-w-0">
                    <span class="font-bold text-slate-800 dark:text-slate-200 block truncate">${escapeHTML(nama)}</span>
                    <span class="text-[11px] text-slate-400 font-mono block truncate">${escapeHTML(idVal.toString())}</span>
                </div>
            </div>
            <span class="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-semibold text-[10px] shrink-0 ml-2">${escapeHTML(sub)}</span>
        `;

        div.addEventListener('click', () => {
            selectBorrower(item, type);
            dropdown.classList.add('hidden');
        });

        dropdown.appendChild(div);
    });

    dropdown.classList.remove('hidden');
}

async function selectBorrower(item, type) {
    const nama = item.nama || item.name || '';
    const idVal = (item.nis || item.nisn || item.nip || item.id || '').toString();
    const kelasVal = type === 'siswa' ? (item.kelas || item.class || '') : (item.jabatan || 'Guru');
    const fotoVal = item.foto || item.photo_url || item.activePhotoUrl || item.active_photo_url || item.photoUrl || '';

    currentBorrower = {
        type: type,
        id: idVal,
        nama: nama,
        kelas: kelasVal,
        foto: fotoVal
    };

    document.getElementById('input-peminjam-search').value = `${nama} (${idVal})`;
    document.getElementById('input-peminjam-kelas').value = kelasVal;
    document.getElementById('input-peminjam-id').value = idVal;
    document.getElementById('input-peminjam-nama').value = nama;

    // Render Cardlet Verifikasi Visual Foto Peminjam
    const photoCardlet = document.getElementById('peminjam-photo-cardlet');
    if (photoCardlet) {
        photoCardlet.classList.remove('hidden');
        const cardletName = document.getElementById('peminjam-cardlet-name');
        const cardletBadge = document.getElementById('peminjam-cardlet-badge');
        const cardletId = document.getElementById('peminjam-cardlet-id');
        const cardletSub = document.getElementById('peminjam-cardlet-sub');
        const imgEl = document.getElementById('peminjam-photo-img');
        const fallbackEl = document.getElementById('peminjam-photo-fallback');
        const initialsEl = document.getElementById('peminjam-photo-initials');

        if (cardletName) cardletName.textContent = nama;
        if (cardletBadge) {
            if (type === 'guru') {
                cardletBadge.className = 'px-2 py-0.5 rounded-full bg-purple-50 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 font-bold text-[10px]';
                cardletBadge.textContent = 'Guru / Staf';
            } else {
                cardletBadge.className = 'px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-bold text-[10px]';
                cardletBadge.textContent = 'Siswa';
            }
        }
        if (cardletId) cardletId.textContent = type === 'guru' ? (idVal ? `NIP. ${idVal}` : 'NIP. -') : (idVal ? `NIS. ${idVal}` : 'NIS. -');
        if (cardletSub) cardletSub.textContent = kelasVal || (type === 'guru' ? "Guru / PTK SMANTARA" : 'Siswa');

        renderBorrowerAvatar(imgEl, fallbackEl, initialsEl, fotoVal, nama);
    }

    updateDueDateBasedOnBorrower();
    await checkBorrowerQuotaAndOverdues(idVal, type);
    document.getElementById('input-book-barcode')?.focus();
}

function resetBorrowerSelection() {
    currentBorrower = null;
    document.getElementById('input-peminjam-search').value = '';
    document.getElementById('input-peminjam-kelas').value = '';
    document.getElementById('input-peminjam-id').value = '';
    document.getElementById('input-peminjam-nama').value = '';
    document.getElementById('peminjam-status-banner')?.classList.add('hidden');
    document.getElementById('peminjam-photo-cardlet')?.classList.add('hidden');
}

window.resetBorrowerSelection = resetBorrowerSelection;

function updateDueDateBasedOnBorrower() {
    const tglPinjamRaw = document.getElementById('input-tgl-pinjam').value;
    const tglPinjamVal = parseIndoDmyToIso(tglPinjamRaw) || getLocalISODate();
    const type = document.querySelector('input[name="peminjam_type"]:checked')?.value || 'siswa';
    const isDurationEnabled = type === 'siswa' ? (libConfig.enable_durasi_siswa !== false) : (libConfig.enable_durasi_guru !== false);

    let dueDateIso;
    if (!isDurationEnabled) {
        // Mode Bebas Durasi: Jatuh tempo default diberikan longgar (365 hari ke depan)
        dueDateIso = addLoanDays(tglPinjamVal, 365, {
            ignoreHolidays: false,
            holidays: libraryHolidays
        });
    } else {
        const durationDays = type === 'siswa' ? libConfig.durasi_pinjam_siswa_hari : libConfig.durasi_pinjam_guru_hari;
        dueDateIso = addLoanDays(tglPinjamVal, durationDays, {
            ignoreHolidays: libConfig.abaikan_hari_libur,
            holidays: libraryHolidays
        });
    }

    // Tulis tanggal jatuh tempo dalam format dd/mm/yyyy dan sinkronisasi hidden picker
    document.getElementById('input-tgl-jatuh-tempo').value = formatToIndoDmy(dueDateIso);
    const tempoPicker = document.getElementById('input-tgl-jatuh-tempo-picker');
    if (tempoPicker) tempoPicker.value = dueDateIso;
}

async function checkBorrowerQuotaAndOverdues(peminjamId, type) {
    const banner = document.getElementById('peminjam-status-banner');
    const statusText = document.getElementById('peminjam-status-text');
    const activeLoans = document.getElementById('peminjam-active-loans');

    try {
        const { data, error } = await supabase
            .from('lib_sirkulasi')
            .select('id, tgl_jatuh_tempo, status')
            .eq('peminjam_id', peminjamId)
            .eq('status', 'dipinjam');

        if (error) throw error;

        const isQuotaEnabled = type === 'siswa' ? (libConfig.enable_max_pinjam_siswa !== false) : (libConfig.enable_max_pinjam_guru !== false);
        const isDurationEnabled = type === 'siswa' ? (libConfig.enable_durasi_siswa !== false) : (libConfig.enable_durasi_guru !== false);
        const maxQuota = type === 'siswa' ? libConfig.max_pinjam_siswa : libConfig.max_pinjam_guru;
        const totalActive = data ? data.length : 0;
        const todayStr = getLocalISODate();
        const hasOverdue = isDurationEnabled && data ? data.some(d => d.tgl_jatuh_tempo < todayStr) : false;

        banner.classList.remove('hidden');
        if (isQuotaEnabled) {
            activeLoans.textContent = `${totalActive} / ${maxQuota} Buku`;
        } else {
            activeLoans.textContent = `${totalActive} / ∞ Buku (Bebas Kuota)`;
        }

        if (hasOverdue) {
            banner.className = 'text-[11px] p-2.5 rounded-xl bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 flex items-center justify-between font-medium';
            statusText.innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-1"></i> Peminjam memiliki buku yang <b>terlambat</b>! Harap selesaikan terlebih dahulu.`;
        } else if (isQuotaEnabled && totalActive >= maxQuota) {
            banner.className = 'text-[11px] p-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 flex items-center justify-between font-medium';
            statusText.innerHTML = `<i class="fa-solid fa-circle-exclamation mr-1"></i> Batas maksimal peminjaman (${maxQuota} buku) telah tercapai.`;
        } else {
            banner.className = 'text-[11px] p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 flex items-center justify-between font-medium';
            if (isQuotaEnabled) {
                statusText.innerHTML = `<i class="fa-solid fa-circle-check mr-1"></i> Kuota pinjam masih tersedia (${maxQuota - totalActive} buku lagi).`;
            } else {
                statusText.innerHTML = `<i class="fa-solid fa-circle-check mr-1"></i> Mode Bebas Kuota: Peminjam dapat meminjam tanpa batas maksimal buku.`;
            }
        }
    } catch (e) {
        console.warn('[Library] Error check quota:', e);
    }
}

// =========================================================================
// 7. BOOK LOOKUP & BORROW TRANSACTION
// =========================================================================
async function lookupBookForBorrowing(barcodeOrNomorInduk) {
    try {
        const safeIdentifier = normalizeLibraryIdentifier(barcodeOrNomorInduk);
        if (!safeIdentifier) {
            Swal.fire({ icon: 'warning', title: 'Format Barcode Tidak Valid', text: 'Gunakan barcode atau nomor induk yang tercetak pada buku.', confirmButtonColor: '#2563eb' });
            return;
        }
        const previewCard = document.getElementById('book-preview-card');
        previewCard.classList.add('hidden');

        // Cari di lib_eksemplar join lib_buku
        const { data, error } = await supabase
            .from('lib_eksemplar')
            .select(`
                id, nomor_induk, kode_barcode, copy_number, call_number_lengkap, status, kondisi, lokasi_spesifik,
                buku:lib_buku (id, judul, pengarang, penerbit, lokasi_rak, cover_url)
            `)
            .or(`kode_barcode.eq.${safeIdentifier},nomor_induk.eq.${safeIdentifier}`)
            .is('archived_at', null)
            .single();

        if (error || !data) {
            Swal.fire({
                icon: 'warning',
                title: 'Buku Tidak Ditemukan',
                text: `Barcode / Nomor Induk "${barcodeOrNomorInduk}" tidak terdaftar di database perpustakaan.`,
                confirmButtonColor: '#2563eb'
            });
            return;
        }

        if (data.status === 'dipinjam') {
            Swal.fire({
                icon: 'error',
                title: 'Buku Sedang Dipinjam',
                text: `Eksemplar "${data.nomor_induk}" saat ini tercatat sedang dipinjam oleh peminjam lain.`,
                confirmButtonColor: '#2563eb'
            });
            return;
        }

        if (data.status === 'hilang' || data.status === 'rusak_berat') {
            Swal.fire({
                icon: 'warning',
                title: 'Kondisi Buku Tidak Memungkinkan',
                text: `Status buku ini adalah "${data.status}". Tidak dapat dipinjamkan.`,
                confirmButtonColor: '#2563eb'
            });
            return;
        }

        currentSelectedBook = data;
        document.getElementById('selected-eksemplar-id').value = data.id;
        document.getElementById('selected-buku-id').value = data.buku?.id || '';
        document.getElementById('preview-book-title').textContent = data.buku?.judul || 'Tanpa Judul';
        document.getElementById('preview-book-author').textContent = data.buku?.pengarang || 'Pengarang Tidak Diketahui';
        document.getElementById('preview-book-call').textContent = data.call_number_lengkap || '-';
        document.getElementById('preview-book-copy').textContent = `Copy ${data.copy_number}`;
        document.getElementById('preview-book-rak').textContent = `Rak: ${data.buku?.lokasi_rak || data.lokasi_spesifik || '-'}`;
        
        previewCard.classList.remove('hidden');

    } catch (e) {
        console.error('[Library] Error lookup book:', e);
    }
}

async function handleProcessBorrowing(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-submit-pinjam');
    const originalText = btn.innerHTML;

    if (!canManageCirculation) {
        Swal.fire({ icon: 'info', title: 'Mode Audit', text: 'Akun ini hanya memiliki akses baca sirkulasi.', confirmButtonColor: '#2563eb' });
        return;
    }

    if (!currentBorrower || !currentBorrower.id) {
        Swal.fire({ icon: 'warning', title: 'Peminjam Belum Dipilih', text: 'Pilih siswa atau guru peminjam terlebih dahulu.', confirmButtonColor: '#2563eb' });
        return;
    }

    if (!currentSelectedBook || !currentSelectedBook.id) {
        Swal.fire({ icon: 'warning', title: 'Buku Belum Dipilih', text: 'Scan atau masukkan barcode eksemplar buku yang valid.', confirmButtonColor: '#2563eb' });
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Memproses...';

    try {
        const todayStr = parseIndoDmyToIso(document.getElementById('input-tgl-pinjam').value) || getLocalISODate();
        const dueDateStr = parseIndoDmyToIso(document.getElementById('input-tgl-jatuh-tempo').value);
        const response = await callSecureEdgeFunction('library-circulation-borrow', {
            eksemplarId: currentSelectedBook.id,
            borrowerType: currentBorrower.type,
            borrowerId: currentBorrower.id,
            borrowerName: currentBorrower.nama,
            borrowerClass: currentBorrower.kelas,
            loanDate: todayStr,
            dueDate: dueDateStr
        });
        const savedTransaction = response?.data;
        if (!savedTransaction?.id) throw new Error('Server tidak mengembalikan transaksi peminjaman.');
        const kodeTransaksi = savedTransaction.kode_transaksi;

        Swal.fire({
            icon: 'success',
            title: 'Peminjaman Berhasil!',
            html: `
                <div class="text-left text-xs space-y-1 mt-2">
                    <p><b>Kode:</b> ${kodeTransaksi}</p>
                    <p><b>Peminjam:</b> ${escapeHTML(currentBorrower.nama)}</p>
                    <p><b>Judul:</b> ${escapeHTML(currentSelectedBook.buku?.judul || '')}</p>
                    <p><b>Jatuh Tempo:</b> ${formatDateIndo(dueDateStr)}</p>
                </div>
            `,
            confirmButtonColor: '#2563eb'
        });

        // Reset Form
        document.getElementById('input-book-barcode').value = '';
        document.getElementById('book-preview-card').classList.add('hidden');
        currentSelectedBook = null;

        // Refresh Data
        await loadDashboardStats();
        await loadSirkulasiData();
        await checkBorrowerQuotaAndOverdues(currentBorrower.id, currentBorrower.type);

    } catch (err) {
        console.error('[Library] Gagal memproses peminjaman:', err);
        Swal.fire({ icon: 'error', title: 'Gagal Meminjam', text: err.message || 'Terjadi kesalahan sistem.', confirmButtonColor: '#2563eb' });
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// =========================================================================
// 8. RETURN & EXTENSION LOGIC (ANTI-TERTUKAR & FAST SCAN)
// =========================================================================

/**
 * Switch mode pengembalian antara Cari Peminjam (Anti-Tertukar) dan Scan Barcode Cepat
 */
window.switchReturnMode = function (mode) {
    activeReturnMode = mode;
    const btnBorrower = document.getElementById('btn-return-mode-borrower');
    const btnBarcode = document.getElementById('btn-return-mode-barcode');
    const panelBorrower = document.getElementById('return-panel-borrower');
    const panelBarcode = document.getElementById('return-panel-barcode');
    const infoBox = document.getElementById('return-info-box');
    const borrowerHint = document.getElementById('return-borrower-hint');
    const scanHint = document.getElementById('return-scan-hint');

    if (infoBox) infoBox.classList.add('hidden');
    currentReturnTransaction = null;

    const activeClass = 'flex-1 py-2 px-3 rounded-lg font-bold transition text-center bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm border border-slate-200/60 dark:border-slate-600/60 flex items-center justify-center gap-1.5';
    const inactiveClass = 'flex-1 py-2 px-3 rounded-lg font-semibold transition text-center text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 flex items-center justify-center gap-1.5';

    if (mode === 'borrower') {
        panelBorrower?.classList.remove('hidden');
        panelBarcode?.classList.add('hidden');
        if (btnBorrower) btnBorrower.className = activeClass;
        if (btnBarcode) btnBarcode.className = inactiveClass;
        if (!currentReturnBorrower) {
            borrowerHint?.classList.remove('hidden');
        } else {
            borrowerHint?.classList.add('hidden');
        }
        scanHint?.classList.add('hidden');
        document.getElementById('input-return-peminjam-search')?.focus();
    } else {
        panelBorrower?.classList.add('hidden');
        panelBarcode?.classList.remove('hidden');
        if (btnBarcode) btnBarcode.className = activeClass;
        if (btnBorrower) btnBorrower.className = inactiveClass;
        borrowerHint?.classList.add('hidden');
        scanHint?.classList.remove('hidden');
        document.getElementById('input-return-barcode')?.focus();
    }
};

function renderReturnPeminjamDropdown(query, type) {
    const dropdown = document.getElementById('return-peminjam-dropdown');
    if (!dropdown) return;
    dropdown.innerHTML = '';

    let matches = [];
    if (type === 'siswa') {
        matches = allStudentsCache.filter(s => {
            const name = (s.nama || s.name || '').toLowerCase();
            const nis = (s.nis || s.nisn || '').toString().toLowerCase();
            const kelas = (s.kelas || s.class || '').toLowerCase();
            return name.includes(query) || nis.includes(query) || kelas.includes(query);
        }).slice(0, 15);
    } else {
        matches = allTeachersCache.filter(t => {
            const name = (t.nama || t.name || '').toLowerCase();
            const nip = (t.nip || '').toString().toLowerCase();
            return name.includes(query) || nip.includes(query);
        }).slice(0, 15);
    }

    if (matches.length === 0) {
        dropdown.innerHTML = `<div class="p-3 text-xs text-slate-400 text-center italic">Tidak ada data ${type} yang cocok</div>`;
        dropdown.classList.remove('hidden');
        return;
    }

    matches.forEach(item => {
        const div = document.createElement('div');
        div.className = 'p-3 hover:bg-emerald-50 dark:hover:bg-slate-700/60 cursor-pointer flex items-center justify-between text-xs transition-colors';
        
        const nama = item.nama || item.name || 'Tanpa Nama';
        const idVal = item.nis || item.nisn || item.nip || item.id || '-';
        const sub = type === 'siswa' ? (item.kelas || item.class || 'Kelas -') : (item.jabatan || 'Guru / Staf');

        const fotoVal = item.foto || item.photo_url || item.activePhotoUrl || item.active_photo_url || item.photoUrl || '';
        const initials = getBorrowerInitials(nama);
        const resolvedPhoto = fotoVal ? resolvePhotoUrl(fotoVal) : '';
        const safePhoto = (resolvedPhoto && /^(https?:|\/|data:image\/)/i.test(resolvedPhoto)) ? escapeHTML(resolvedPhoto) : '';

        div.innerHTML = `
            <div class="flex items-center gap-2.5 min-w-0">
                <div class="w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-slate-100 dark:bg-slate-700 flex items-center justify-center border border-slate-200 dark:border-slate-600">
                    ${safePhoto ? `<img src="${safePhoto}" alt="${escapeHTML(nama)}" class="w-full h-full object-cover" onerror="this.remove()">` : ''}
                    <span class="text-[10px] font-bold text-slate-500 dark:text-slate-300 select-none">${initials}</span>
                </div>
                <div class="min-w-0">
                    <span class="font-bold text-slate-800 dark:text-slate-200 block truncate">${escapeHTML(nama)}</span>
                    <span class="text-[11px] text-slate-400 font-mono block truncate">${escapeHTML(idVal.toString())}</span>
                </div>
            </div>
            <span class="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-semibold text-[10px] shrink-0 ml-2">${escapeHTML(sub)}</span>
        `;

        div.addEventListener('click', () => {
            selectReturnBorrower(item, type);
            dropdown.classList.add('hidden');
        });

        dropdown.appendChild(div);
    });

    dropdown.classList.remove('hidden');
}

async function selectReturnBorrower(item, type) {
    const nama = item.nama || item.name || '';
    const idVal = (item.nis || item.nisn || item.nip || item.id || '').toString();
    const kelasVal = type === 'siswa' ? (item.kelas || item.class || '') : (item.jabatan || 'Guru');
    const fotoVal = item.foto || item.photo_url || item.activePhotoUrl || item.active_photo_url || item.photoUrl || '';

    currentReturnBorrower = {
        type: type,
        id: idVal,
        nama: nama,
        kelas: kelasVal,
        foto: fotoVal
    };

    document.getElementById('input-return-peminjam-search').value = `${nama} (${idVal})`;
    document.getElementById('return-selected-borrower-name').textContent = `${nama} (${idVal})`;
    document.getElementById('return-selected-borrower-sub').textContent = `${kelasVal} • ${type.toUpperCase()}`;
    document.getElementById('return-borrower-hint')?.classList.add('hidden');
    document.getElementById('return-borrower-active-loans-box').classList.remove('hidden');
    document.getElementById('input-return-peminjam-search').classList.add('hidden');

    // Render Avatar Peminjam di Box Pengembalian
    const returnImg = document.getElementById('return-borrower-img');
    const returnFallback = document.getElementById('return-borrower-fallback');
    const returnInitials = document.getElementById('return-borrower-initials');
    renderBorrowerAvatar(returnImg, returnFallback, returnInitials, fotoVal, nama);

    await loadBorrowerActiveLoansForReturn(idVal);
    document.getElementById('input-return-verify-barcode')?.focus();
}

window.resetReturnBorrowerSelection = function () {
    currentReturnBorrower = null;
    currentReturnBorrowerLoans = [];
    document.getElementById('input-return-peminjam-search').value = '';
    document.getElementById('input-return-peminjam-search').classList.remove('hidden');
    document.getElementById('return-borrower-active-loans-box').classList.add('hidden');
    document.getElementById('return-info-box').classList.add('hidden');
    document.getElementById('return-borrower-hint')?.classList.remove('hidden');
    currentReturnTransaction = null;
};

async function loadBorrowerActiveLoansForReturn(borrowerId) {
    const listEl = document.getElementById('return-borrower-loans-list');
    if (!listEl) return;
    listEl.innerHTML = '<div class="p-3 text-center text-slate-400 text-xs italic"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Memeriksa pinjaman aktif...</div>';

    try {
        const { data, error } = await supabase
            .from('lib_sirkulasi')
            .select(`
                *,
                buku:lib_buku (id, judul, pengarang, lokasi_rak),
                eksemplar:lib_eksemplar (id, nomor_induk, kode_barcode, copy_number, call_number_lengkap)
            `)
            .eq('peminjam_id', String(borrowerId))
            .eq('status', 'dipinjam')
            .order('tgl_jatuh_tempo', { ascending: true });

        if (error) throw error;
        currentReturnBorrowerLoans = data || [];

        if (currentReturnBorrowerLoans.length === 0) {
            listEl.innerHTML = `
                <div class="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 text-center text-xs text-slate-400">
                    <i class="fa-solid fa-circle-check text-emerald-500 text-base mb-1"></i>
                    <p class="font-bold text-slate-700 dark:text-slate-200">Tidak Ada Pinjaman Aktif</p>
                    <p class="text-[11px] mt-0.5">${escapeHTML(currentReturnBorrower?.nama || 'Peminjam')} tidak memiliki tanggungan buku yang sedang dipinjam.</p>
                </div>
            `;
            return;
        }

        const todayStr = getLocalISODate();

        listEl.innerHTML = currentReturnBorrowerLoans.map(loan => {
            const isLate = loan.tgl_jatuh_tempo && loan.tgl_jatuh_tempo < todayStr;
            const barcode = loan.eksemplar?.kode_barcode || loan.eksemplar?.nomor_induk || '-';

            return `
                <div class="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 hover:border-emerald-500/60 transition flex items-center justify-between gap-2 text-xs">
                    <div class="min-w-0 flex-1">
                        <div class="font-bold text-slate-800 dark:text-white truncate">${escapeHTML(loan.buku?.judul || 'Buku')}</div>
                        <div class="text-[11px] text-slate-400 font-mono flex items-center gap-1.5 mt-0.5 flex-wrap">
                            <span class="text-blue-600 dark:text-blue-400 font-bold">${escapeHTML(barcode)}</span>
                            <span>•</span>
                            <span class="${isLate ? 'text-rose-600 font-bold' : ''}">Tempo: ${loan.tgl_jatuh_tempo || '-'}</span>
                        </div>
                    </div>
                    <button type="button" onclick="window.prepareReturnForTransaction(${loan.id})"
                        class="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] transition shrink-0 shadow-sm flex items-center gap-1">
                        <i class="fa-solid fa-arrow-down-to-bracket"></i> Kembalikan
                    </button>
                </div>
            `;
        }).join('');

    } catch (e) {
        console.error('[Library] Error load borrower active loans:', e);
        listEl.innerHTML = '<div class="p-3 text-center text-rose-500 text-xs">Gagal memuat pinjaman peminjam.</div>';
    }
}

/**
 * Verifikasi barcode yang disodorkan siswa saat proses pengembalian (Anti-Tertukar)
 */
async function handleVerifyReturnBarcode(barcode) {
    if (!currentReturnBorrower) {
        Swal.fire({ icon: 'warning', title: 'Pilih Peminjam Terlebih Dahulu', text: 'Pilih siswa atau guru peminjam sebelum melakukan verifikasi.', confirmButtonColor: '#2563eb' });
        return;
    }

    const inputVerify = document.getElementById('input-return-verify-barcode');
    if (inputVerify) inputVerify.value = '';
    const safeBarcode = normalizeLibraryIdentifier(barcode);
    if (!safeBarcode) {
        Swal.fire({ icon: 'warning', title: 'Format Barcode Tidak Valid', text: 'Gunakan barcode atau nomor induk yang tercetak pada buku.', confirmButtonColor: '#2563eb' });
        return;
    }

    // 1. Cek apakah barcode ini cocok dengan salah satu buku yang dipinjam peminjam ini
    const matchedLoan = currentReturnBorrowerLoans.find(loan => {
        const bCode = (loan.eksemplar?.kode_barcode || '').toLowerCase();
        const nInduk = (loan.eksemplar?.nomor_induk || '').toLowerCase();
        const search = safeBarcode.toLowerCase();
        return bCode === search || nInduk === search;
    });

    if (matchedLoan) {
        // Cocok! Buka form penyelesaian return
        window.prepareReturnForTransaction(matchedLoan.id);
        return;
    }

    // 2. Jika TIDAK cocok dengan daftar pinjaman peminjam ini, cek apakah barcode ini sedang dipinjam oleh SISWA LAIN!
    try {
        const { data: eksemplar, error: eksErr } = await supabase
            .from('lib_eksemplar')
            .select('id, nomor_induk, kode_barcode, buku:lib_buku (id, judul)')
            .or(`kode_barcode.eq.${safeBarcode},nomor_induk.eq.${safeBarcode}`)
            .is('archived_at', null)
            .single();

        if (eksErr || !eksemplar) {
            Swal.fire({
                icon: 'error',
                title: 'Barcode Tidak Dikenali',
                text: `Tidak ditemukan buku dengan barcode "${barcode}".`,
                confirmButtonColor: '#2563eb'
            });
            return;
        }

        // Cek transaksi pinjaman aktif untuk eksemplar ini
        const { data: otherLoan, error: loanErr } = await supabase
            .from('lib_sirkulasi')
            .select('*')
            .eq('eksemplar_id', eksemplar.id)
            .eq('status', 'dipinjam')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (otherLoan) {
            // DETEKSI BUKU TERTUKAR!
            const hasil = await Swal.fire({
                icon: 'warning',
                title: '⚠️ Peringatan: Buku Tertukar!',
                html: `
                    <div class="text-left text-xs space-y-2">
                        <p class="text-slate-600 dark:text-slate-300">Buku fisik yang disodorkan:</p>
                        <div class="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800">
                            <p class="font-bold text-slate-800 dark:text-white">${escapeHTML(eksemplar.buku?.judul || 'Buku')}</p>
                            <p class="font-mono text-[11px] text-slate-500">Barcode: ${escapeHTML(eksemplar.kode_barcode || eksemplar.nomor_induk)}</p>
                        </div>
                        <div class="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 font-semibold">
                            Buku ini tercatat dipinjam oleh: <b>${escapeHTML(otherLoan.peminjam_nama)} (${escapeHTML(otherLoan.peminjam_kelas || otherLoan.peminjam_type)})</b>
                            <br><span class="text-[11px] font-normal text-rose-600">Bukan milik ${escapeHTML(currentReturnBorrower.nama)}!</span>
                        </div>
                        <p class="text-[11px] text-slate-400">Apakah Anda ingin memproses pengembalian atas nama peminjam aslinya (${escapeHTML(otherLoan.peminjam_nama)})?</p>
                    </div>
                `,
                showCancelButton: true,
                confirmButtonText: `Kembalikan atas nama ${escapeHTML(otherLoan.peminjam_nama)}`,
                cancelButtonText: 'Batalkan (Minta Siswa Menukar)',
                confirmButtonColor: '#10b981',
                cancelButtonColor: '#64748b'
            });

            if (hasil.isConfirmed) {
                // Proses return untuk otherLoan
                window.prepareReturnForTransaction(otherLoan.id, { ...otherLoan, eksemplar });
            }
        } else {
            // Buku ada di database tapi statusnya sedang tidak dipinjam
            Swal.fire({
                icon: 'info',
                title: 'Buku Tidak Sedang Dipinjam',
                text: `Buku "${eksemplar.buku?.judul || eksemplar.nomor_induk}" saat ini berstatus tersedia di rak. Bukan tanggungan ${currentReturnBorrower.nama}.`,
                confirmButtonColor: '#2563eb'
            });
        }

    } catch (err) {
        console.error('[Library] Error check swap book:', err);
    }
}

/**
 * Siapkan data transaksi pengembalian untuk ditampilkan di Return Info Box
 */
window.prepareReturnForTransaction = async function (sirkulasiId, preloadedData = null) {
    const infoBox = document.getElementById('return-info-box');
    const hintBox = document.getElementById('return-scan-hint');

    let sirkulasi = preloadedData;
    if (!sirkulasi) {
        sirkulasi = currentReturnBorrowerLoans.find(l => l.id === sirkulasiId);
    }

    if (!sirkulasi) {
        try {
            const { data, error } = await supabase
                .from('lib_sirkulasi')
                .select(`
                    *,
                    buku:lib_buku (id, judul, pengarang, lokasi_rak),
                    eksemplar:lib_eksemplar (id, nomor_induk, kode_barcode, copy_number)
                `)
                .eq('id', sirkulasiId)
                .single();

            if (error || !data) throw error;
            sirkulasi = data;
        } catch (e) {
            console.error('[Library] Gagal memuat detail sirkulasi:', e);
            return;
        }
    }

    currentReturnTransaction = sirkulasi;

    // Hitung Keterlambatan & Denda
    const todayStr = getLocalISODate();
    const isDurationEnabled = sirkulasi.peminjam_type === 'siswa'
        ? (libConfig.enable_durasi_siswa !== false)
        : (libConfig.enable_durasi_guru !== false);
    const lateDays = isDurationEnabled
        ? countChargeableLateDays(sirkulasi.tgl_jatuh_tempo, todayStr, {
            ignoreHolidays: libConfig.abaikan_hari_libur,
            holidays: libraryHolidays
        })
        : 0;

    const isDendaEnabled = libConfig.enable_denda !== false;
    const rawTarif = (sirkulasi.tarif_denda_per_hari !== null && sirkulasi.tarif_denda_per_hari !== undefined)
        ? Number(sirkulasi.tarif_denda_per_hari)
        : Number(libConfig.tarif_denda_per_hari);
    const tarifDenda = isDendaEnabled ? (Number.isNaN(rawTarif) ? 1000 : rawTarif) : 0;
    const totalDenda = lateDays * tarifDenda;

    // Render Return Box
    document.getElementById('return-book-title').textContent = sirkulasi.buku?.judul || sirkulasi.eksemplar?.buku?.judul || 'Buku';
    const barcodeDisplay = document.getElementById('return-book-barcode-display');
    if (barcodeDisplay) {
        barcodeDisplay.textContent = `Barcode: ${sirkulasi.eksemplar?.kode_barcode || sirkulasi.eksemplar?.nomor_induk || '-'}`;
    }
    document.getElementById('return-borrower-name').textContent = `${sirkulasi.peminjam_nama} (${sirkulasi.peminjam_kelas || sirkulasi.peminjam_type})`;
    document.getElementById('return-borrow-date').textContent = formatDateIndo(sirkulasi.tgl_pinjam);
    document.getElementById('return-late-days').textContent = lateDays > 0 ? `${lateDays} Hari` : 'Tepat Waktu (0 Hari)';
    document.getElementById('return-fine-amount').textContent = !isDendaEnabled
        ? 'Bebas Denda (Rp 0)'
        : (totalDenda > 0 ? `Rp ${totalDenda.toLocaleString('id-ID')}` : 'Rp 0');

    const dendaContainer = document.getElementById('return-denda-container');
    if (totalDenda > 0) {
        dendaContainer.className = 'p-3 rounded-xl bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200 text-xs font-bold';
    } else {
        dendaContainer.className = 'p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 text-xs font-medium';
    }

    currentReturnTransaction.calculatedLateDays = lateDays;
    currentReturnTransaction.calculatedTotalFine = totalDenda;

    document.getElementById('return-borrower-hint')?.classList.add('hidden');
    if (hintBox) hintBox.classList.add('hidden');
    if (infoBox) {
        infoBox.classList.remove('hidden');
        infoBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
};

/**
 * Pengembalian Mode 2: Scan Barcode Cepat
 */
async function lookupTransactionForReturn(barcode) {
    try {
        const safeBarcode = normalizeLibraryIdentifier(barcode);
        if (!safeBarcode) {
            Swal.fire({ icon: 'warning', title: 'Format Barcode Tidak Valid', text: 'Gunakan barcode atau nomor induk yang tercetak pada buku.', confirmButtonColor: '#2563eb' });
            return;
        }
        const infoBox = document.getElementById('return-info-box');
        const hintBox = document.getElementById('return-scan-hint');
        document.getElementById('return-borrower-hint')?.classList.add('hidden');
        if (infoBox) infoBox.classList.add('hidden');
        if (hintBox) hintBox.classList.remove('hidden');

        // Cari eksemplar
        const { data: eksemplar, error: eksError } = await supabase
            .from('lib_eksemplar')
            .select('id, nomor_induk, kode_barcode, buku:lib_buku (id, judul)')
            .or(`kode_barcode.eq.${safeBarcode},nomor_induk.eq.${safeBarcode}`)
            .is('archived_at', null)
            .single();

        if (eksError || !eksemplar) {
            Swal.fire({ icon: 'warning', title: 'Barcode Tidak Dikenali', text: `Tidak ditemukan buku dengan barcode "${barcode}".`, confirmButtonColor: '#2563eb' });
            return;
        }

        // Cari transaksi peminjaman aktif untuk eksemplar ini
        const { data: sirkulasi, error: sirkError } = await supabase
            .from('lib_sirkulasi')
            .select('*')
            .eq('eksemplar_id', eksemplar.id)
            .eq('status', 'dipinjam')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (sirkError || !sirkulasi) {
            Swal.fire({
                icon: 'info',
                title: 'Buku Tidak Sedang Dipinjam',
                text: `Buku "${eksemplar.buku?.judul || eksemplar.nomor_induk}" saat ini berstatus tersedia di perpustakaan.`,
                confirmButtonColor: '#2563eb'
            });
            return;
        }

        await window.prepareReturnForTransaction(sirkulasi.id, { ...sirkulasi, eksemplar });

    } catch (e) {
        console.error('[Library] Error lookup return transaction:', e);
    }
}

async function handleProcessReturn() {
    if (!currentReturnTransaction) return;

    if (!canManageCirculation) {
        Swal.fire({ icon: 'info', title: 'Mode Audit', text: 'Akun ini hanya memiliki akses baca sirkulasi.', confirmButtonColor: '#2563eb' });
        return;
    }

    const btn = document.getElementById('btn-confirm-return');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Proses...';

    try {
        const todayStr = getLocalISODate();
        const condition = document.getElementById('return-condition').value || 'baik';
        const response = await callSecureEdgeFunction('library-circulation-return', {
            circulationId: currentReturnTransaction.id,
            returnDate: todayStr,
            condition
        });
        const returnedTransaction = response?.data;
        if (!returnedTransaction?.id) throw new Error('Server tidak mengembalikan transaksi pengembalian.');
        const lateDays = Number(returnedTransaction.hari_terlambat) || 0;
        const totalFine = Number(returnedTransaction.total_denda) || 0;

        Swal.fire({
            icon: 'success',
            title: 'Buku Berhasil Dikembalikan!',
            html: `
                <div class="text-left text-xs space-y-1 mt-2">
                    <p><b>Judul:</b> ${escapeHTML(currentReturnTransaction.eksemplar?.buku?.judul || currentReturnTransaction.buku?.judul || '')}</p>
                    <p><b>Peminjam:</b> ${escapeHTML(currentReturnTransaction.peminjam_nama)}</p>
                    <p><b>Kondisi:</b> ${condition}</p>
                    ${totalFine > 0 ? `<p class="text-rose-600 font-bold"><b>Denda Terlambat:</b> Rp ${totalFine.toLocaleString('id-ID')}</p>` : '<p class="text-emerald-600 font-bold">Bebas Denda</p>'}
                </div>
            `,
            confirmButtonColor: '#10b981'
        });

        // Reset Form
        const inputReturn = document.getElementById('input-return-barcode');
        if (inputReturn) inputReturn.value = '';
        document.getElementById('return-info-box')?.classList.add('hidden');
        if (activeReturnMode === 'barcode') {
            document.getElementById('return-scan-hint')?.classList.remove('hidden');
            document.getElementById('return-borrower-hint')?.classList.add('hidden');
        } else {
            document.getElementById('return-scan-hint')?.classList.add('hidden');
            if (!currentReturnBorrower) {
                document.getElementById('return-borrower-hint')?.classList.remove('hidden');
            } else {
                document.getElementById('return-borrower-hint')?.classList.add('hidden');
            }
        }

        // Jika dalam mode borrower, refresh list pinjaman siswa tersebut
        if (currentReturnBorrower) {
            await loadBorrowerActiveLoansForReturn(currentReturnBorrower.id);
        }

        currentReturnTransaction = null;

        await loadDashboardStats();
        await loadSirkulasiData();

    } catch (err) {
        console.error('[Library] Gagal memproses pengembalian:', err);
        Swal.fire({ icon: 'error', title: 'Gagal Pengembalian', text: err.message || 'Terjadi kesalahan sistem.', confirmButtonColor: '#2563eb' });
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

async function handleProcessExtension() {
    if (!currentReturnTransaction) return;

    if (!canManageCirculation) {
        Swal.fire({ icon: 'info', title: 'Mode Audit', text: 'Akun ini hanya memiliki akses baca sirkulasi.', confirmButtonColor: '#2563eb' });
        return;
    }

    const isExtensionLimitEnabled = libConfig.enable_max_perpanjangan !== false;
    if (isExtensionLimitEnabled && currentReturnTransaction.perpanjangan_ke >= libConfig.max_perpanjangan) {
        Swal.fire({
            icon: 'warning',
            title: 'Batas Perpanjangan Tercapai',
            text: `Buku ini sudah pernah diperpanjang ${currentReturnTransaction.perpanjangan_ke} kali (Batas maksimal: ${libConfig.max_perpanjangan}x). Harus dikembalikan terlebih dahulu.`,
            confirmButtonColor: '#2563eb'
        });
        return;
    }

    const isDurationEnabled = currentReturnTransaction.peminjam_type === 'siswa'
        ? (libConfig.enable_durasi_siswa !== false)
        : (libConfig.enable_durasi_guru !== false);
    if (isDurationEnabled && currentReturnTransaction.calculatedLateDays > 0) {
        Swal.fire({
            icon: 'warning',
            title: 'Peminjaman Sudah Terlambat',
            text: 'Buku yang sudah lewat jatuh tempo tidak dapat diperpanjang secara otomatis. Harap selesaikan pengembalian dan denda terlebih dahulu.',
            confirmButtonColor: '#2563eb'
        });
        return;
    }

    const durationDays = currentReturnTransaction.peminjam_type === 'siswa' ? libConfig.durasi_pinjam_siswa_hari : libConfig.durasi_pinjam_guru_hari;
    const { isConfirmed } = await Swal.fire({
        title: 'Perpanjang Peminjaman?',
        text: isDurationEnabled
            ? `Masa pinjam akan diperpanjang sesuai durasi standar (${durationDays} hari ke depan).`
            : `Masa pinjam akan diperpanjang (Mode durasi fleksibel aktif).`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Ya, Perpanjang',
        cancelButtonText: 'Batal',
        confirmButtonColor: '#2563eb'
    });

    if (!isConfirmed) return;

    try {
        const response = await callSecureEdgeFunction('library-circulation-extend', {
            circulationId: currentReturnTransaction.id
        });
        const extendedTransaction = response?.data;
        if (!extendedTransaction?.id) throw new Error('Server tidak mengembalikan transaksi perpanjangan.');
        const newDueDateStr = extendedTransaction.tgl_jatuh_tempo;

        Swal.fire({
            icon: 'success',
            title: 'Berhasil Diperpanjang!',
            text: `Tanggal jatuh tempo baru: ${formatDateIndo(newDueDateStr)}`,
            confirmButtonColor: '#2563eb'
        });

        document.getElementById('input-return-barcode').value = '';
        document.getElementById('return-info-box')?.classList.add('hidden');
        if (activeReturnMode === 'barcode') {
            document.getElementById('return-scan-hint')?.classList.remove('hidden');
            document.getElementById('return-borrower-hint')?.classList.add('hidden');
        } else {
            document.getElementById('return-scan-hint')?.classList.add('hidden');
            if (!currentReturnBorrower) {
                document.getElementById('return-borrower-hint')?.classList.remove('hidden');
            } else {
                document.getElementById('return-borrower-hint')?.classList.add('hidden');
            }
        }
        currentReturnTransaction = null;

        await loadSirkulasiData();

    } catch (e) {
        console.error('[Library] Error perpanjang sirkulasi:', e);
        Swal.fire({ icon: 'error', title: 'Gagal', text: e.message || 'Terjadi kesalahan sistem.', confirmButtonColor: '#2563eb' });
    }
}

// =========================================================================
// 9. LOAD & RENDER SIRKULASI TABLE
// =========================================================================
async function loadSirkulasiData() {
    try {
        const { data, error } = await supabase
            .from('lib_sirkulasi')
            .select(`
                *,
                buku:lib_buku (judul, pengarang, cover_url),
                eksemplar:lib_eksemplar (nomor_induk, kode_barcode, copy_number)
            `)
            .order('created_at', { ascending: false })
            .limit(200);

        if (error) throw error;
        activeSirkulasiList = data || [];
        renderSirkulasiTable();

    } catch (e) {
        console.error('[Library] Error load sirkulasi data:', e);
        const tbody = document.getElementById('sirkulasi-table-body');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-rose-500">Gagal memuat data sirkulasi buku.</td></tr>';
        }
    }
}

function renderSirkulasiTable() {
    const tbody = document.getElementById('sirkulasi-table-body');
    const searchVal = (document.getElementById('search-sirkulasi')?.value || '').toLowerCase().trim();
    const filterStatus = document.getElementById('filter-status-sirkulasi')?.value || 'dipinjam';
    const countInfo = document.getElementById('sirkulasi-count-info');
    const todayStr = getLocalISODate();

    let filtered = activeSirkulasiList.filter(row => {
        const isLate = row.status === 'dipinjam' && row.tgl_jatuh_tempo < todayStr;

        // Filter status
        if (filterStatus === 'dipinjam' && row.status !== 'dipinjam') return false;
        if (filterStatus === 'terlambat' && !isLate) return false;
        if (filterStatus === 'kembali' && row.status !== 'kembali') return false;

        // Filter search
        if (searchVal) {
            const borrower = (row.peminjam_nama || '').toLowerCase();
            const nis = (row.peminjam_id || '').toLowerCase();
            const judul = (row.buku?.judul || '').toLowerCase();
            const barcode = (row.eksemplar?.kode_barcode || row.eksemplar?.nomor_induk || '').toLowerCase();
            const kode = (row.kode_transaksi || '').toLowerCase();

            return borrower.includes(searchVal) || nis.includes(searchVal) || judul.includes(searchVal) || barcode.includes(searchVal) || kode.includes(searchVal);
        }

        return true;
    });

    if (countInfo) countInfo.textContent = `Menampilkan ${filtered.length} dari ${activeSirkulasiList.length} transaksi`;

    if (filtered.length === 0) {
        let emptyTitle = 'Tidak Ada Transaksi';
        let emptyDesc = 'Tidak ada data transaksi sirkulasi yang sesuai dengan filter.';
        let iconClass = 'fa-inbox';

        if (searchVal) {
            emptyTitle = 'Pencarian Tidak Ditemukan';
            emptyDesc = `Tidak ada transaksi yang cocok dengan kata kunci "${escapeHTML(searchVal)}".`;
            iconClass = 'fa-magnifying-glass';
        } else if (filterStatus === 'dipinjam') {
            emptyTitle = 'Tidak Ada Peminjaman Aktif';
            emptyDesc = 'Saat ini seluruh buku perpustakaan berada di rak atau telah dikembalikan.';
            iconClass = 'fa-circle-check text-emerald-500';
        } else if (filterStatus === 'terlambat') {
            emptyTitle = 'Nihil Keterlambatan';
            emptyDesc = 'Tidak ada peminjaman yang melewati tanggal jatuh tempo. Semua sirkulasi tepat waktu!';
            iconClass = 'fa-calendar-check text-emerald-500';
        } else if (filterStatus === 'kembali') {
            emptyTitle = 'Belum Ada Riwayat Kembali';
            emptyDesc = 'Belum ada catatan buku yang dikembalikan pada periode ini.';
            iconClass = 'fa-clock-rotate-left';
        }

        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="p-8 text-center text-slate-400 dark:text-slate-500">
                    <div class="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-2.5 text-base">
                        <i class="fa-solid ${iconClass}"></i>
                    </div>
                    <p class="text-xs font-bold text-slate-700 dark:text-slate-200">${emptyTitle}</p>
                    <p class="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 max-w-sm mx-auto">${emptyDesc}</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filtered.map(row => {
        const isLate = row.status === 'dipinjam' && row.tgl_jatuh_tempo < todayStr;
        let badgeStatus = '';

        if (row.status === 'kembali') {
            badgeStatus = `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 font-bold text-[10px] border border-emerald-200 dark:border-emerald-800"><i class="fa-solid fa-check text-[9px]"></i> Kembali</span>`;
        } else if (isLate) {
            badgeStatus = `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 font-bold text-[10px] border border-rose-200 dark:border-rose-800 animate-pulse"><i class="fa-solid fa-clock-rotate-left text-[9px]"></i> Terlambat</span>`;
        } else {
            badgeStatus = `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 font-bold text-[10px] border border-blue-200 dark:border-blue-800"><i class="fa-solid fa-book-open text-[9px]"></i> Dipinjam</span>`;
        }

        const dendaText = Number(row.total_denda) > 0
            ? `<div class="text-[10px] font-bold text-rose-600 dark:text-rose-400 mt-1 flex items-center gap-1"><i class="fa-solid fa-circle-exclamation text-[9px]"></i> Denda: Rp ${Number(row.total_denda).toLocaleString('id-ID')} (${row.status_denda})</div>`
            : '';

        const barcodeVal = row.eksemplar?.kode_barcode || row.eksemplar?.nomor_induk || '-';

        return `
            <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/60 transition-colors">
                <td class="px-5 py-3.5">
                    <div class="font-bold text-slate-800 dark:text-white text-sm">${escapeHTML(row.peminjam_nama)}</div>
                    <div class="text-[11px] text-slate-400 dark:text-slate-500 flex items-center gap-1.5 font-mono mt-0.5">
                        <span class="font-semibold">${escapeHTML(row.peminjam_id)}</span> &bull; <span>${escapeHTML(row.peminjam_kelas || row.peminjam_type)}</span>
                    </div>
                </td>
                <td class="px-5 py-3.5">
                    <div class="font-semibold text-slate-800 dark:text-slate-200 text-sm truncate max-w-xs" title="${escapeHTML(row.buku?.judul || '')}">${escapeHTML(row.buku?.judul || 'Buku')}</div>
                    <div class="text-[11px] text-slate-400 dark:text-slate-500 font-mono mt-0.5 flex items-center gap-1">
                        <span class="text-blue-600 dark:text-blue-400 font-bold">${escapeHTML(barcodeVal)}</span>
                        <span>(Copy ${row.eksemplar?.copy_number || 1})</span>
                    </div>
                </td>
                <td class="px-5 py-3.5 text-slate-600 dark:text-slate-400 whitespace-nowrap text-xs">
                    ${formatDateIndo(row.tgl_pinjam)}
                </td>
                <td class="px-5 py-3.5 whitespace-nowrap text-xs ${isLate ? 'text-rose-600 dark:text-rose-400 font-bold' : 'text-slate-600 dark:text-slate-400 font-medium'}">
                    ${formatDateIndo(row.tgl_jatuh_tempo)}
                    ${row.perpanjangan_ke > 0 ? `<span class="text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 px-1.5 py-0.5 rounded ml-1 font-sans font-semibold">Perpanjang ${row.perpanjangan_ke}x</span>` : ''}
                </td>
                <td class="px-5 py-3.5 whitespace-nowrap">
                    <div>${badgeStatus}</div>
                    ${dendaText}
                </td>
                <td class="px-5 py-3.5 text-center whitespace-nowrap">
                    ${row.status === 'dipinjam' ? `
                        <button onclick="window.quickReturnFromTable('${escapeHTML(barcodeVal)}')" class="px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 font-bold text-xs transition inline-flex items-center gap-1.5 shadow-sm" title="Proses Pengembalian">
                            <i class="fa-solid fa-arrow-down-to-bracket"></i>
                            <span>Kembali</span>
                        </button>
                    ` : `
                        <span class="text-xs text-slate-400 dark:text-slate-500 font-medium italic">Selesai (${formatDateIndo(row.tgl_kembali)})</span>
                    `}
                </td>
            </tr>
        `;
    }).join('');
}

window.quickReturnFromTable = function (barcode) {
    const inputReturn = document.getElementById('input-return-barcode');
    if (inputReturn) {
        inputReturn.value = barcode;
        inputReturn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        lookupTransactionForReturn(barcode);
    }
};

// =========================================================================
// 10. EXPORT TO EXCEL (SHEETJS)
// =========================================================================
function exportSirkulasiToExcel() {
    if (!activeSirkulasiList || activeSirkulasiList.length === 0) {
        Swal.fire({ icon: 'info', title: 'Data Kosong', text: 'Tidak ada data sirkulasi yang dapat diekspor.', confirmButtonColor: '#2563eb' });
        return;
    }

    try {
        const rows = activeSirkulasiList.map((item, idx) => ({
            'No': idx + 1,
            'Kode Transaksi': item.kode_transaksi,
            'Tipe Peminjam': item.peminjam_type.toUpperCase(),
            'ID / NIS / NIP': item.peminjam_id,
            'Nama Peminjam': item.peminjam_nama,
            'Kelas / Jabatan': item.peminjam_kelas || '-',
            'Barcode Eksemplar': item.eksemplar?.kode_barcode || item.eksemplar?.nomor_induk || '-',
            'Judul Buku': item.buku?.judul || '-',
            'Pengarang': item.buku?.pengarang || '-',
            'Tanggal Pinjam': item.tgl_pinjam,
            'Tanggal Jatuh Tempo': item.tgl_jatuh_tempo,
            'Tanggal Kembali': item.tgl_kembali || '-',
            'Status': item.status,
            'Hari Terlambat': item.hari_terlambat || 0,
            'Total Denda (Rp)': item.total_denda || 0,
            'Status Denda': item.status_denda || 'bebas_denda',
            'Kondisi Kembali': item.kondisi_kembali || '-'
        }));

        const worksheet = XLSX.utils.json_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Sirkulasi Perpustakaan");

        const fileName = `Sirkulasi_Perpustakaan_SMANTARA_${getLocalISODate()}.xlsx`;
        XLSX.writeFile(workbook, fileName);

    } catch (e) {
        console.error('[Library] Gagal export Excel:', e);
        Swal.fire({ icon: 'error', title: 'Export Gagal', text: e.message || 'Terjadi kesalahan saat membuat berkas Excel.', confirmButtonColor: '#2563eb' });
    }
}

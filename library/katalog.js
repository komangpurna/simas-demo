/* library/katalog.js - Manajemen Bibliografi & Eksemplar Buku Perpustakaan */
import { auth, db, PATHS, supabase, SCHOOL_CONFIG } from '../js/config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { initLayout, escapeHTML, formatDateIndo, getLocalISODate, callSecureEdgeFunction } from '../js/global.js';
import { fetchAllSupabaseRows } from '../js/supabase-pagination.mjs';

// =========================================================================
// 1. STATE & MASTER DATA
// =========================================================================
let ddcCategories = [];
let booksList = [];
let currentBookForEksemplar = null;
let currentEksemplarList = [];
let selectedEksemplarIds = new Set();
let bulkSelectedBookIds = new Set();
let bulkPrintBooksList = [];
let canManageCatalog = false;
let appConfig = {
    prefix_nomor_induk: '',
    nama_perpustakaan: "Perpustakaan Widya Shakti SMANTARA"
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
    
    // RBAC: super_admin, admin_perpus, staff, kepala_sekolah
    const allowedRoles = ['super_admin', 'admin_perpus', 'staff', 'kepala_sekolah'];
    const hasAccess = allRoles.some(r => allowedRoles.includes(r));
    canManageCatalog = allRoles.some(r => ['super_admin', 'admin_perpus', 'staff'].includes(r));

    if (!hasAccess) {
        Swal.fire({
            icon: 'error',
            title: 'Akses Ditolak',
            text: 'Halaman ini khusus Petugas / Admin Perpustakaan.',
            confirmButtonColor: '#2563eb'
        }).then(() => {
            window.location.href = 'opac.html';
        });
        return;
    }

    await initLayout(primaryRole);
    document.querySelector('main')?.classList.remove('hidden');

    initHeaderProfile(user, primaryRole);
    await loadAppConfig();
    await loadDDCCategories();
    await loadBooksList();
    setupEventListeners();
    applyCatalogPermissionUI();
});

function initHeaderProfile(user, primaryRole) {
    const elName = document.getElementById('header-user-name');
    const elDate = document.getElementById('header-date-display');
    if (elName) {
        const storedName = localStorage.getItem('user_name') || user.displayName || 'Petugas Perpustakaan';
        elName.textContent = storedName;
    }
    if (elDate) {
        elDate.textContent = formatDateIndo(getLocalISODate());
    }
}

function updateCatalogKPIs() {
    const totalJudul = booksList.length;
    let totalEksemplar = 0;
    let totalTersedia = 0;
    let totalHabis = 0;

    booksList.forEach(b => {
        const total = Number(b.total_eksemplar) || 0;
        const tersedia = Number(b.eksemplar_tersedia) || 0;
        totalEksemplar += total;
        totalTersedia += tersedia;
        if (tersedia <= 0) totalHabis++;
    });

    const elTotalJudul = document.getElementById('kpi-total-judul');
    const elTotalEksemplar = document.getElementById('kpi-total-eksemplar');
    const elTotalTersedia = document.getElementById('kpi-total-tersedia');
    const elTotalHabis = document.getElementById('kpi-total-habis');

    if (elTotalJudul) elTotalJudul.textContent = totalJudul.toLocaleString('id-ID');
    if (elTotalEksemplar) elTotalEksemplar.textContent = totalEksemplar.toLocaleString('id-ID');
    if (elTotalTersedia) elTotalTersedia.textContent = totalTersedia.toLocaleString('id-ID');
    if (elTotalHabis) elTotalHabis.textContent = totalHabis.toLocaleString('id-ID');
}

function applyCatalogPermissionUI() {
    if (canManageCatalog) return;
    ['btn-import-excel', 'btn-open-add-book', 'btn-save-book', 'btn-submit-eksemplar'].forEach(id => {
        const button = document.getElementById(id);
        if (!button) return;
        button.disabled = true;
        button.classList.add('opacity-50', 'cursor-not-allowed');
        button.title = 'Mode audit: akun ini hanya dapat melihat dan mencetak katalog.';
    });
}

// =========================================================================
// 3. LOAD CONFIG & DDC CATEGORIES
// =========================================================================
async function loadAppConfig() {
    try {
        const { data, error } = await supabase.from('lib_config').select('key, value');
        if (!error && data) {
            data.forEach(item => {
                if (item.key === 'prefix_nomor_induk') appConfig.prefix_nomor_induk = item.value;
                if (item.key === 'nama_perpustakaan') appConfig.nama_perpustakaan = item.value;
            });
        }
    } catch (e) {
        console.warn('[Katalog] Error load config:', e);
    }
}

async function loadDDCCategories() {
    try {
        const { data, error } = await supabase
            .from('lib_kategori_ddc')
            .select('*')
            .order('kode', { ascending: true });

        if (error) throw error;
        ddcCategories = data || [];

        // Populate Select DDC di form dan filter
        const selectForm = document.getElementById('input-ddc');
        const selectFilter = document.getElementById('filter-ddc');

        if (selectForm) {
            selectForm.innerHTML = '<option value="">-- Pilih Klasifikasi DDC --</option>' +
                ddcCategories.map(d => `<option value="${d.kode}">${d.kode} - ${escapeHTML(d.nama)}</option>`).join('');
        }

        if (selectFilter) {
            selectFilter.innerHTML = '<option value="">Semua Kelas DDC (000 - 900)</option>' +
                ddcCategories.map(d => `<option value="${d.kode}">${d.kode} - ${escapeHTML(d.nama)}</option>`).join('');
        }

    } catch (e) {
        console.error('[Katalog] Gagal load kategori DDC:', e);
    }
}

// =========================================================================
// 4. CALL NUMBER GENERATOR, ONLINE LOOKUP & SMART NLP DDC CLASSIFIER
// =========================================================================
let ddcDebounceTimer = null;
let onlineLookupDebounceTimer = null;
let isLookingUpOnline = false;

/**
 * Standar Nasional Call Number:
 * Format 3 Baris:
 * [Kode DDC]
 * [3 Huruf Kapital Nama Pengarang - Berdasarkan Tajuk Nama Belakang / Standar Perpusnas RI]
 * [1 Huruf Kecil Judul Buku]
 * Contoh: 510 PUR m, 813 HIR l
 */
function generateNationalCallNumber(ddcCode, authorName, title) {
    if (!ddcCode) return '';

    // 1. Tiga huruf pengarang standar perpustakaan (Cutter Code)
    let authorCode = 'XXX';
    if (window.LibraryAuthor && typeof window.LibraryAuthor.getAuthorCallCode === 'function') {
        authorCode = window.LibraryAuthor.getAuthorCallCode(authorName);
    } else if (authorName && authorName.trim()) {
        const cleanAuthor = authorName.trim().replace(/[^a-zA-Z]/g, '');
        if (cleanAuthor.length >= 3) {
            authorCode = cleanAuthor.substring(0, 3).toUpperCase();
        } else {
            authorCode = cleanAuthor.toUpperCase().padEnd(3, 'X');
        }
    }

    // 2. Satu huruf kecil judul
    let titleCode = 'x';
    if (title && title.trim()) {
        const cleanTitle = title.trim().replace(/[^a-zA-Z]/g, '');
        if (cleanTitle.length > 0) {
            titleCode = cleanTitle.charAt(0).toLowerCase();
        }
    }

    return `${ddcCode} ${authorCode} ${titleCode}`;
}

function updateAuthorStandardHelper() {
    const inputPengarang = document.getElementById('input-pengarang');
    const helperBox = document.getElementById('author-standard-helper');
    const previewEl = document.getElementById('author-standard-preview');
    const badgeEl = document.getElementById('author-code-badge');
    const btnFormat = document.getElementById('btn-format-author');
    if (!inputPengarang || !helperBox || !previewEl || !badgeEl) return;

    const val = inputPengarang.value.trim();
    if (!val || val.length < 2 || !window.LibraryAuthor) {
        helperBox.classList.add('hidden');
        if (btnFormat) btnFormat.classList.add('hidden');
        return;
    }

    const parsed = window.LibraryAuthor.parse(val);
    if (!parsed || parsed.rawName === 'Anonim') {
        helperBox.classList.add('hidden');
        if (btnFormat) btnFormat.classList.add('hidden');
        return;
    }

    const targetHeading = parsed.standardTajuk || parsed.standardName;
    previewEl.textContent = targetHeading;
    badgeEl.textContent = `Call: ${parsed.authorCode}`;

    // Tampilkan bantuan standarisasi jika input belum berformat inversi standar
    const isAlreadyFormatted = val.toLowerCase() === targetHeading.toLowerCase()
        || (parsed.isAlreadyInverted && Boolean(parsed.surname && val.toLowerCase().startsWith(parsed.surname.toLowerCase() + ',')));
    if (!isAlreadyFormatted && !parsed.isCorporate) {
        helperBox.classList.remove('hidden');
        if (btnFormat) btnFormat.classList.remove('hidden');
    } else {
        helperBox.classList.add('hidden');
        if (btnFormat) btnFormat.classList.add('hidden');
    }
}

window.applyStandardAuthorFormat = function () {
    const inputPengarang = document.getElementById('input-pengarang');
    if (!inputPengarang || !inputPengarang.value.trim() || !window.LibraryAuthor) return;

    const parsed = window.LibraryAuthor.parse(inputPengarang.value);
    if (parsed && (parsed.standardTajuk || parsed.standardName)) {
        inputPengarang.value = parsed.standardTajuk || parsed.standardName;
        updateAuthorStandardHelper();
        updateAutoCallNumber();
        if (window.showToast) {
            window.showToast('Standarisasi Berhasil', `Nama pengarang diselaraskan: ${inputPengarang.value} (Call: ${parsed.authorCode})`, 'success');
        }
    }
};

function updateAutoCallNumber() {
    const ddc = document.getElementById('input-ddc').value;
    const author = document.getElementById('input-pengarang').value;
    const title = document.getElementById('input-judul').value;

    const callNumber = generateNationalCallNumber(ddc, author, title);
    document.getElementById('input-call-number').value = callNumber;
}

/**
 * Online Book Database Auto-Lookup (Google Books & Open Library API)
 * Mencari metadata buku secara global dan mengisi otomatis formulir + DDC
 */
window.triggerOnlineBookLookup = async function (force = true) {
    const inputJudul = document.getElementById('input-judul');
    const inputIsbn = document.getElementById('input-isbn');
    const spinner = document.getElementById('lookup-loading-spinner');
    const topSpinner = document.getElementById('lookup-spinner');
    const banner = document.getElementById('lookup-result-banner');
    const bannerTitle = document.getElementById('lookup-banner-title');
    const bannerDetail = document.getElementById('lookup-banner-detail');
    const coverContainer = document.getElementById('lookup-cover-container');
    const coverImg = document.getElementById('lookup-cover-img');

    const query = inputIsbn?.value.trim() || inputJudul?.value.trim() || '';
    if (!query || query.length < 3) {
        if (force && window.showToast) window.showToast('Pencarian Online', 'Ketik minimal 3 karakter judul atau nomor ISBN untuk mencari online', 'warning');
        return;
    }

    if (!window.SmartDDC || typeof window.SmartDDC.lookupOnline !== 'function') {
        runSmartDDCClassifier();
        return;
    }

    try {
        isLookingUpOnline = true;
        if (spinner) spinner.classList.remove('hidden');
        if (topSpinner) topSpinner.classList.remove('hidden');

        const result = await window.SmartDDC.lookupOnline(query);

        if (result && result.found) {
            const inputPengarang = document.getElementById('input-pengarang');
            const inputPengarangTambahan = document.getElementById('input-pengarang-tambahan');
            const inputPenerbit = document.getElementById('input-penerbit');
            const inputTahun = document.getElementById('input-tahun-terbit');

            // Auto-fill fields
            if (result.judul && (!inputJudul.value || force)) {
                inputJudul.value = result.judul;
            }
            if (result.pengarang && (!inputPengarang.value || force)) {
                let authorToSet = result.pengarang;
                if (window.LibraryAuthor && typeof window.LibraryAuthor.parse === 'function') {
                    const parsed = window.LibraryAuthor.parse(authorToSet);
                    if (!parsed.isCorporate && parsed.standardTajuk) {
                        authorToSet = parsed.standardTajuk;
                    }
                }
                inputPengarang.value = authorToSet;
                updateAuthorStandardHelper();
            }
            if (result.pengarangTambahan && (!inputPengarangTambahan.value || force)) {
                inputPengarangTambahan.value = result.pengarangTambahan;
            }
            if (result.penerbit && (!inputPenerbit.value || force)) {
                inputPenerbit.value = result.penerbit;
            }
            if (result.tahunTerbit && (!inputTahun.value || force)) {
                inputTahun.value = result.tahunTerbit;
            }
            if (result.isbn && inputIsbn && (!inputIsbn.value || force)) {
                inputIsbn.value = result.isbn;
            }

            // Apply DDC if found online
            if (result.ddc && result.ddc.kode) {
                window.applyDDCChip(result.ddc.kode, result.ddc.nama);
            } else {
                runSmartDDCClassifier();
            }

            updateAutoCallNumber();

            // Show success banner
            if (banner) {
                banner.classList.remove('hidden');
                if (bannerTitle) {
                    bannerTitle.innerHTML = `<i class="fa-solid fa-circle-check text-emerald-500"></i> Data Berhasil Dimuat dari ${result.source}`;
                }
                if (bannerDetail) {
                    const ddcInfo = result.ddc ? `DDC: <strong>${result.ddc.kode} - ${result.ddc.nama}</strong>` : 'Klasifikasi DDC disesuaikan';
                    bannerDetail.innerHTML = `Pengarang: <strong>${escapeHTML(result.pengarang || '-')}</strong>, Penerbit: <strong>${escapeHTML(result.penerbit || '-')}</strong> (${escapeHTML(result.tahunTerbit || '-')}). ${ddcInfo}`;
                }

                if (result.coverUrl && coverContainer && coverImg) {
                    coverImg.src = result.coverUrl;
                    coverContainer.classList.remove('hidden');
                } else if (coverContainer) {
                    coverContainer.classList.add('hidden');
                }
            }

            if (force && window.showToast) {
                window.showToast('Data Ditemukan', `Data buku "${result.judul}" berhasil dimuat dari ${result.source}!`, 'success');
            }
        } else {
            // Online search returned nothing -> Fallback to Smart NLP AI
            if (banner) banner.classList.add('hidden');
            runSmartDDCClassifier();
            if (force && window.showToast) {
                window.showToast('Data Tidak Ditemukan', 'Data online tidak ditemukan. Menggunakan analisis Smart NLP AI lokal.', 'info');
            }
        }
    } catch (err) {
        console.warn('Online lookup error:', err);
        runSmartDDCClassifier();
    } finally {
        isLookingUpOnline = false;
        if (spinner) spinner.classList.add('hidden');
        if (topSpinner) topSpinner.classList.add('hidden');
    }
};

/**
 * Smart NLP AI Classifier Integration
 * Mendeteksi klasifikasi DDC secara cerdas dari input judul & metadata (Sub-5ms, Offline)
 */
function triggerSmartDDCClassifier() {
    clearTimeout(ddcDebounceTimer);
    ddcDebounceTimer = setTimeout(() => {
        runSmartDDCClassifier();
    }, 250);
}

function runSmartDDCClassifier() {
    if (!window.SmartDDC || typeof window.SmartDDC.classify !== 'function') return;

    const title = document.getElementById('input-judul')?.value || '';
    const author = document.getElementById('input-pengarang')?.value || '';
    const publisher = document.getElementById('input-penerbit')?.value || '';
    const currentDDC = document.getElementById('input-ddc')?.value || '';

    const recBox = document.getElementById('ddc-recommendation-box');
    const chipsContainer = document.getElementById('ddc-chips-container');
    const statusText = document.getElementById('ddc-nlp-status');

    if (!recBox || !chipsContainer) return;

    if (!title.trim() || title.trim().length < 3) {
        recBox.classList.add('hidden');
        chipsContainer.innerHTML = '';
        return;
    }

    const recommendations = window.SmartDDC.classify(title, author, publisher);

    if (!recommendations || recommendations.length === 0) {
        recBox.classList.add('hidden');
        chipsContainer.innerHTML = '';
        return;
    }

    // Render recommendation chips
    recBox.classList.remove('hidden');
    if (statusText) statusText.textContent = 'Klik chip untuk memilih DDC';

    chipsContainer.innerHTML = recommendations.map((rec, idx) => {
        const isSelected = currentDDC === rec.kode;
        let badgeColor = 'bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200 border-blue-300 dark:border-blue-700';
        let scoreBadge = 'bg-blue-600 text-white';

        if (rec.confidence >= 80) {
            badgeColor = isSelected
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-600/30'
                : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/50 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700';
            scoreBadge = isSelected ? 'bg-white text-emerald-700' : 'bg-emerald-600 text-white';
        } else if (rec.confidence >= 55) {
            badgeColor = isSelected
                ? 'bg-amber-600 text-white border-amber-600 shadow-md shadow-amber-600/30'
                : 'bg-amber-50 hover:bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:hover:bg-amber-900/50 dark:text-amber-300 border-amber-300 dark:border-amber-700';
            scoreBadge = isSelected ? 'bg-white text-amber-700' : 'bg-amber-600 text-white';
        } else {
            badgeColor = isSelected
                ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-600/30'
                : 'bg-slate-50 hover:bg-slate-100 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600';
            scoreBadge = isSelected ? 'bg-white text-blue-700' : 'bg-blue-500 text-white';
        }

        const starIcon = idx === 0 ? '<i class="fa-solid fa-sparkles text-[10px] text-amber-500 mr-1"></i>' : '';

        return `
            <button type="button" data-ddc-recommendation-index="${idx}"
                class="px-2.5 py-1 rounded-xl text-xs font-semibold border transition flex items-center gap-1.5 shadow-sm ${badgeColor}"
                title="Kecocokan: ${escapeHTML(rec.reason)} (${rec.confidence}%)">
                ${starIcon}
                <span class="font-mono font-bold">${escapeHTML(rec.kode)}</span> - <span>${escapeHTML(rec.nama)}</span>
                <span class="px-1.5 py-0.5 rounded-full text-[9px] font-bold ${scoreBadge}">${rec.confidence}%</span>
            </button>
        `;
    }).join('');

    chipsContainer.querySelectorAll('[data-ddc-recommendation-index]').forEach(button => {
        button.addEventListener('click', () => {
            const recommendation = recommendations[Number(button.dataset.ddcRecommendationIndex)];
            if (recommendation) window.applyDDCChip(recommendation.kode, recommendation.nama);
        });
    });
}

window.applyDDCChip = function (kode, nama) {
    const selectForm = document.getElementById('input-ddc');
    const statusText = document.getElementById('ddc-nlp-status');
    if (!selectForm) return;

    // Check if option exists in selectForm, if not dynamically add it
    let exists = false;
    for (let i = 0; i < selectForm.options.length; i++) {
        if (selectForm.options[i].value === String(kode)) {
            exists = true;
            break;
        }
    }

    if (!exists) {
        const newOpt = document.createElement('option');
        newOpt.value = kode;
        newOpt.textContent = `${kode} - ${nama || kode}`;
        selectForm.appendChild(newOpt);
    }

    selectForm.value = String(kode);
    updateAutoCallNumber();

    if (statusText) {
        statusText.innerHTML = `<span class="text-emerald-600 dark:text-emerald-400 font-bold"><i class="fa-solid fa-check mr-1"></i> DDC ${kode} dipilih!</span>`;
    }

    // Re-render chips to reflect selection state
    runSmartDDCClassifier();
};

// =========================================================================
// 5. EVENT LISTENERS
// =========================================================================
function setupEventListeners() {
    const btnOpenAdd = document.getElementById('btn-open-add-book');
    const formBook = document.getElementById('form-book');
    const inputDDC = document.getElementById('input-ddc');
    const inputPengarang = document.getElementById('input-pengarang');
    const inputJudul = document.getElementById('input-judul');
    const inputPenerbit = document.getElementById('input-penerbit');
    const inputIsbn = document.getElementById('input-isbn');
    const searchKatalog = document.getElementById('search-katalog');
    const filterDDC = document.getElementById('filter-ddc');
    const filterKoleksi = document.getElementById('filter-koleksi');
    const formAddEksemplar = document.getElementById('form-add-eksemplar');
    const btnImportExcel = document.getElementById('btn-import-excel');
    const btnExportKatalog = document.getElementById('btn-export-katalog');

    btnOpenAdd.addEventListener('click', () => openBookModal());
    inputDDC.addEventListener('change', () => {
        updateAutoCallNumber();
        runSmartDDCClassifier();
    });

    inputPengarang.addEventListener('input', () => {
        updateAuthorStandardHelper();
        updateAutoCallNumber();
        triggerSmartDDCClassifier();
    });

    inputPengarang.addEventListener('blur', () => {
        const val = inputPengarang.value.trim();
        if (val && window.LibraryAuthor) {
            const parsed = window.LibraryAuthor.parse(val);
            // Jika nama perorangan dan belum berformat inversi standar, standarisasi otomatis tajuk perpustakaan
            if (!parsed.isCorporate && !parsed.isAlreadyInverted && parsed.standardTajuk && parsed.standardTajuk !== val) {
                inputPengarang.value = parsed.standardTajuk;
                updateAuthorStandardHelper();
                updateAutoCallNumber();
            }
        }
    });

    inputJudul.addEventListener('input', () => {
        updateAutoCallNumber();
        triggerSmartDDCClassifier();
    });

    inputJudul.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            window.triggerOnlineBookLookup(true);
        }
    });

    let isbnScanDebounceTimer = null;
    if (inputIsbn) {
        inputIsbn.addEventListener('input', () => {
            clearTimeout(isbnScanDebounceTimer);
            const cleanIsbn = inputIsbn.value.trim().replace(/[-\s]/g, '');
            // Jika digit barcode scanner/input mencapai standar ISBN-10 atau ISBN-13
            if (cleanIsbn.length === 10 || cleanIsbn.length === 13) {
                isbnScanDebounceTimer = setTimeout(() => {
                    window.triggerOnlineBookLookup(false);
                }, 350);
            }
        });

        inputIsbn.addEventListener('change', () => {
            if (inputIsbn.value.trim().length >= 8) {
                window.triggerOnlineBookLookup(false);
            }
        });

        inputIsbn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                clearTimeout(isbnScanDebounceTimer);
                window.triggerOnlineBookLookup(true);
            }
        });
    }

    const inputHarga = document.getElementById('input-harga');
    if (inputHarga) {
        inputHarga.addEventListener('input', (e) => {
            const raw = e.target.value.replace(/\D/g, '');
            e.target.value = raw ? parseInt(raw, 10).toLocaleString('id-ID') : '';
        });
    }

    const inputEksHarga = document.getElementById('input-eks-harga');
    if (inputEksHarga) {
        inputEksHarga.addEventListener('input', (e) => {
            const raw = e.target.value.replace(/\D/g, '');
            e.target.value = raw ? parseInt(raw, 10).toLocaleString('id-ID') : '';
        });
    }

    if (inputPenerbit) {
        inputPenerbit.addEventListener('input', triggerSmartDDCClassifier);
    }

    formBook.addEventListener('submit', handleSaveBook);
    formAddEksemplar.addEventListener('submit', handleAddEksemplar);

    const inputEksQty = document.getElementById('input-eks-qty');
    if (inputEksQty) {
        inputEksQty.addEventListener('input', updateEksemplarQtyHelper);
        inputEksQty.addEventListener('change', updateEksemplarQtyHelper);
    }

    const inputEksNomorInduk = document.getElementById('input-eks-nomor-induk');
    if (inputEksNomorInduk) {
        inputEksNomorInduk.addEventListener('input', updateEksemplarQtyHelper);
    }

    const checkBarcodeSame = document.getElementById('check-barcode-same-as-nib');
    const inputEksBarcode = document.getElementById('input-eks-barcode');
    if (checkBarcodeSame && inputEksBarcode) {
        checkBarcodeSame.addEventListener('change', (e) => {
            if (e.target.checked) {
                inputEksBarcode.value = inputEksNomorInduk?.value.trim() || '';
                inputEksBarcode.readOnly = true;
                inputEksBarcode.classList.add('bg-slate-100', 'dark:bg-slate-800/60');
            } else {
                inputEksBarcode.readOnly = false;
                inputEksBarcode.classList.remove('bg-slate-100', 'dark:bg-slate-800/60');
                inputEksBarcode.focus();
            }
            updateEksemplarQtyHelper();
        });
    }

    searchKatalog.addEventListener('input', renderBooksTable);
    filterDDC.addEventListener('change', renderBooksTable);
    filterKoleksi.addEventListener('change', renderBooksTable);

    const btnResetFilter = document.getElementById('btn-reset-filter');
    if (btnResetFilter) {
        btnResetFilter.addEventListener('click', () => {
            if (searchKatalog) searchKatalog.value = '';
            if (filterDDC) filterDDC.value = '';
            if (filterKoleksi) filterKoleksi.value = '';
            renderBooksTable();
        });
    }

    btnImportExcel.addEventListener('click', handleOpenImportModal);
    btnExportKatalog.addEventListener('click', exportBooksToExcel);

    const btnBulkPrintModal = document.getElementById('btn-open-bulk-print');
    if (btnBulkPrintModal) {
        btnBulkPrintModal.addEventListener('click', openBulkPrintModal);
    }

    const btnExecBulkPrint = document.getElementById('btn-execute-bulk-print');
    if (btnExecBulkPrint) {
        btnExecBulkPrint.addEventListener('click', executeBulkPrint);
    }

    const btnSelectAllBulk = document.getElementById('btn-select-all-bulk-books');
    if (btnSelectAllBulk) {
        btnSelectAllBulk.addEventListener('click', selectAllBulkBooks);
    }

    const btnDeselectAllBulk = document.getElementById('btn-deselect-all-bulk-books');
    if (btnDeselectAllBulk) {
        btnDeselectAllBulk.addEventListener('click', deselectAllBulkBooks);
    }

    const searchBulkBooks = document.getElementById('search-bulk-books');
    if (searchBulkBooks) {
        searchBulkBooks.addEventListener('input', renderBulkPrintBookList);
    }

    const checkAllEksemplar = document.getElementById('check-all-eksemplar');
    if (checkAllEksemplar) {
        checkAllEksemplar.addEventListener('change', handleCheckAllEksemplar);
    }

    document.querySelectorAll('input[name="bulk-print-format"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            updateBulkPrintFormatUI(e.target.value);
        });
    });
}

// =========================================================================
// 6. BOOK CRUD & MODAL
// =========================================================================
function openBookModal(book = null) {
    const modal = document.getElementById('modal-book-form');
    const titleEl = document.getElementById('modal-book-title');
    const form = document.getElementById('form-book');
    const recBox = document.getElementById('ddc-recommendation-box');
    const chipsContainer = document.getElementById('ddc-chips-container');
    const statusText = document.getElementById('ddc-nlp-status');
    const banner = document.getElementById('lookup-result-banner');
    const coverContainer = document.getElementById('lookup-cover-container');

    form.reset();
    if (banner) banner.classList.add('hidden');
    if (coverContainer) coverContainer.classList.add('hidden');
    if (recBox) recBox.classList.add('hidden');
    if (chipsContainer) chipsContainer.innerHTML = '';
    if (statusText) statusText.textContent = 'Klik chip untuk memilih';

    if (book) {
        titleEl.textContent = 'Edit Data Bibliografi Buku';
        document.getElementById('form-book-id').value = book.id;
        document.getElementById('input-judul').value = book.judul || '';
        document.getElementById('input-pengarang').value = book.pengarang || '';
        document.getElementById('input-pengarang-tambahan').value = book.pengarang_tambahan || '';

        // Ensure DDC option exists if it was custom
        const selectDDC = document.getElementById('input-ddc');
        if (selectDDC && book.kategori_ddc) {
            let found = false;
            for (let i = 0; i < selectDDC.options.length; i++) {
                if (selectDDC.options[i].value === String(book.kategori_ddc)) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                const opt = document.createElement('option');
                opt.value = book.kategori_ddc;
                opt.textContent = `${book.kategori_ddc} - ${book.ddc?.nama || book.kategori_ddc}`;
                selectDDC.appendChild(opt);
            }
            selectDDC.value = book.kategori_ddc;
        }

        document.getElementById('input-call-number').value = book.call_number_dasar || '';
        document.getElementById('input-penerbit').value = book.penerbit || '';
        document.getElementById('input-kota-terbit').value = book.kota_terbit || '';
        document.getElementById('input-tahun-terbit').value = book.tahun_terbit || '';
        document.getElementById('input-isbn').value = book.isbn || '';
        const inputHarga = document.getElementById('input-harga');
        if (inputHarga) {
            inputHarga.value = (book.harga && Number(book.harga) > 0) ? Math.round(Number(book.harga)).toLocaleString('id-ID') : '';
        }
        document.getElementById('input-lokasi-rak').value = book.lokasi_rak || '';
        document.getElementById('input-tipe-koleksi').value = book.tipe_koleksi || 'Sirkulasi';
    } else {
        titleEl.textContent = 'Tambah Data Bibliografi Buku';
        document.getElementById('form-book-id').value = '';
        const inputHarga = document.getElementById('input-harga');
        if (inputHarga) inputHarga.value = '';
        document.getElementById('input-tipe-koleksi').value = 'Sirkulasi';
    }

    updateAuthorStandardHelper();
    modal.classList.remove('hidden');
    if (book) {
        document.getElementById('input-judul')?.focus();
    } else {
        // Otomatis arahkan kursor ke input ISBN agar siap ditembak barcode scanner
        setTimeout(() => document.getElementById('input-isbn')?.focus(), 150);
    }
}

async function handleSaveBook(e) {
    e.preventDefault();
    if (!canManageCatalog) return;
    const btn = document.getElementById('btn-save-book');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Menyimpan...';

    try {
        const bookId = document.getElementById('form-book-id').value;
        const judul = document.getElementById('input-judul').value.trim();
        let pengarang = document.getElementById('input-pengarang').value.trim();
        const pengarangTambahan = document.getElementById('input-pengarang-tambahan').value.trim();
        const ddc = document.getElementById('input-ddc').value;
        const callNumber = document.getElementById('input-call-number').value.trim();
        const penerbit = document.getElementById('input-penerbit').value.trim();
        const kotaTerbit = document.getElementById('input-kota-terbit').value.trim();
        const tahunTerbit = parseInt(document.getElementById('input-tahun-terbit').value, 10) || null;
        const isbn = document.getElementById('input-isbn').value.trim();
        const inputHargaVal = document.getElementById('input-harga')?.value || '';
        const harga = parseFloat(inputHargaVal.replace(/\./g, '').replace(/,/g, '.')) || 0;
        const lokasiRak = document.getElementById('input-lokasi-rak').value.trim();
        const tipeKoleksi = document.getElementById('input-tipe-koleksi').value;

        // Validasi kolom wajib (Mandatory Requirements)
        if (!judul) {
            Swal.fire({ icon: 'warning', title: 'Judul Wajib Diisi', text: 'Silakan isi judul lengkap buku.', confirmButtonColor: '#2563eb' });
            btn.disabled = false;
            btn.innerHTML = originalText;
            document.getElementById('input-judul')?.focus();
            return;
        }
        if (!pengarang) {
            Swal.fire({ icon: 'warning', title: 'Pengarang Wajib Diisi', text: 'Silakan isi nama pengarang utama buku (atau "Anonim").', confirmButtonColor: '#2563eb' });
            btn.disabled = false;
            btn.innerHTML = originalText;
            document.getElementById('input-pengarang')?.focus();
            return;
        }
        if (!ddc) {
            Swal.fire({ icon: 'warning', title: 'DDC Wajib Dipilih', text: 'Silakan tentukan klasifikasi DDC buku.', confirmButtonColor: '#2563eb' });
            btn.disabled = false;
            btn.innerHTML = originalText;
            document.getElementById('input-ddc')?.focus();
            return;
        }
        if (!penerbit) {
            Swal.fire({ icon: 'warning', title: 'Penerbit Wajib Diisi', text: 'Silakan lengkapi nama penerbit buku (atau "-" jika tidak tertera di buku fisik).', confirmButtonColor: '#2563eb' });
            btn.disabled = false;
            btn.innerHTML = originalText;
            document.getElementById('input-penerbit')?.focus();
            return;
        }
        if (!kotaTerbit) {
            Swal.fire({ icon: 'warning', title: 'Kota Terbit Wajib Diisi', text: 'Silakan lengkapi kota tempat penerbitan buku (atau "-" jika tidak tertera).', confirmButtonColor: '#2563eb' });
            btn.disabled = false;
            btn.innerHTML = originalText;
            document.getElementById('input-kota-terbit')?.focus();
            return;
        }
        if (!tahunTerbit || isNaN(tahunTerbit) || tahunTerbit < 1000 || tahunTerbit > 2200) {
            Swal.fire({ icon: 'warning', title: 'Tahun Terbit Wajib Diisi', text: 'Silakan isi tahun terbit yang valid berupa 4 digit angka (antara 1000 s.d. 2200).', confirmButtonColor: '#2563eb' });
            btn.disabled = false;
            btn.innerHTML = originalText;
            document.getElementById('input-tahun-terbit')?.focus();
            return;
        }

        // Standarisasi tajuk perpustakaan saat simpan jika belum terinversi
        if (pengarang && window.LibraryAuthor) {
            const parsed = window.LibraryAuthor.parse(pengarang);
            if (!parsed.isCorporate && !parsed.isAlreadyInverted && parsed.standardTajuk) {
                pengarang = parsed.standardTajuk;
            }
        }

        const payload = {
            judul,
            pengarang,
            pengarang_tambahan: pengarangTambahan,
            kategori_ddc: ddc,
            call_number_dasar: callNumber,
            penerbit,
            kota_terbit: kotaTerbit,
            tahun_terbit: tahunTerbit,
            isbn,
            harga,
            lokasi_rak: lokasiRak,
            tipe_koleksi: tipeKoleksi,
            created_by: auth.currentUser?.email || 'admin_perpus',
            updated_at: new Date().toISOString()
        };

        if (bookId) {
            // Update
            let updateRes = await supabase
                .from('lib_buku')
                .update(payload)
                .eq('id', bookId);

            // Backward compatibility fallback jika kolom harga belum ada di database Supabase remote
            if (updateRes.error) {
                const errStr = (updateRes.error.message || '') + (updateRes.error.details || '');
                if (updateRes.error.code === '42703' || /column.*harga.*not exist|harga/i.test(errStr)) {
                    console.warn('[Katalog] Kolom harga belum ada di tabel lib_buku remote. Menyimpan tanpa kolom harga...');
                    delete payload.harga;
                    if (harga > 0) {
                        payload.catatan = (payload.catatan ? payload.catatan + ' | ' : '') + `Harga: Rp ${Math.round(harga).toLocaleString('id-ID')}`;
                    }
                    const retryRes = await supabase.from('lib_buku').update(payload).eq('id', bookId);
                    if (retryRes.error) throw retryRes.error;
                } else {
                    throw updateRes.error;
                }
            }
            Swal.fire({ icon: 'success', title: 'Berhasil Diperbarui', text: 'Data bibliografi buku berhasil diperbarui.', confirmButtonColor: '#2563eb' });
        } else {
            // Insert
            payload.total_eksemplar = 0;
            payload.eksemplar_tersedia = 0;
            let insertRes = await supabase
                .from('lib_buku')
                .insert([payload])
                .select()
                .single();

            let data = insertRes.data;
            if (insertRes.error) {
                const errStr = (insertRes.error.message || '') + (insertRes.error.details || '');
                if (insertRes.error.code === '42703' || /column.*harga.*not exist|harga/i.test(errStr)) {
                    console.warn('[Katalog] Kolom harga belum ada di tabel lib_buku remote. Menyimpan tanpa kolom harga...');
                    delete payload.harga;
                    if (harga > 0) {
                        payload.catatan = (payload.catatan ? payload.catatan + ' | ' : '') + `Harga: Rp ${Math.round(harga).toLocaleString('id-ID')}`;
                    }
                    const retryRes = await supabase.from('lib_buku').insert([payload]).select().single();
                    if (retryRes.error) throw retryRes.error;
                    data = retryRes.data;
                } else {
                    throw insertRes.error;
                }
            }

            // Pastikan nilai harga lokal tersinkron ke object data
            if (data && harga > 0 && (data.harga === undefined || data.harga === null)) {
                data.harga = harga;
            }

            // Buka langsung modal eksemplar agar admin bisa menambahkan salinan fisik
            Swal.fire({
                icon: 'success',
                title: 'Buku Ditambahkan!',
                text: 'Data judul buku tersimpan. Tambahkan eksemplar fisik buku sekarang?',
                showCancelButton: true,
                confirmButtonText: 'Tambah Eksemplar',
                cancelButtonText: 'Nanti Saja',
                confirmButtonColor: '#2563eb'
            }).then((res) => {
                if (res.isConfirmed && data) {
                    openEksemplarModal(data);
                }
            });
        }

        document.getElementById('modal-book-form').classList.add('hidden');
        await loadBooksList();

    } catch (e) {
        console.error('[Katalog] Error save book:', e);
        Swal.fire({ icon: 'error', title: 'Gagal Menyimpan', text: e.message || 'Terjadi kesalahan sistem.', confirmButtonColor: '#2563eb' });
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// =========================================================================
// 7. LOAD & RENDER BOOKS LIST
// =========================================================================
async function loadBooksList() {
    try {
        booksList = await fetchAllSupabaseRows((from, to) => supabase
            .from('lib_buku')
            .select(`
                *,
                ddc:lib_kategori_ddc (kode, nama)
            `)
            .is('archived_at', null)
            .order('id', { ascending: false })
            .range(from, to));
        updateCatalogKPIs();
        renderBooksTable();

    } catch (e) {
        console.error('[Katalog] Gagal memuat daftar buku:', e);
        const tbody = document.getElementById('katalog-table-body');
        if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-rose-500">Gagal memuat katalog buku.</td></tr>';
    }
}

function renderBooksTable() {
    const tbody = document.getElementById('katalog-table-body');
    const searchVal = (document.getElementById('search-katalog')?.value || '').toLowerCase().trim();
    const filterDDCVal = document.getElementById('filter-ddc')?.value || '';
    const filterKoleksiVal = document.getElementById('filter-koleksi')?.value || '';
    const countInfo = document.getElementById('katalog-count-info');

    let filtered = booksList.filter(book => {
        if (filterDDCVal && book.kategori_ddc !== filterDDCVal) return false;
        if (filterKoleksiVal && book.tipe_koleksi !== filterKoleksiVal) return false;

        if (searchVal) {
            const judul = (book.judul || '').toLowerCase();
            const pengarang = (book.pengarang || '').toLowerCase();
            const penerbit = (book.penerbit || '').toLowerCase();
            const isbn = (book.isbn || '').toLowerCase();
            const callNumber = (book.call_number_dasar || '').toLowerCase();

            return judul.includes(searchVal) || pengarang.includes(searchVal) || penerbit.includes(searchVal) || isbn.includes(searchVal) || callNumber.includes(searchVal);
        }

        return true;
    });

    if (countInfo) countInfo.textContent = `Menampilkan ${filtered.length} dari ${booksList.length} judul buku`;

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="p-12 text-center">
                    <div class="max-w-xs mx-auto flex flex-col items-center">
                        <div class="w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-900/30 text-blue-500 flex items-center justify-center mb-3 text-2xl shadow-sm">
                            <i class="fa-solid fa-book-open"></i>
                        </div>
                        <h4 class="font-bold text-sm text-slate-800 dark:text-slate-200 mb-1">Tidak Ada Data Buku</h4>
                        <p class="text-xs text-slate-400 mb-4">Tidak ada judul buku yang cocok dengan pencarian atau filter yang aktif saat ini.</p>
                        <button onclick="document.getElementById('btn-open-add-book').click()" class="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs transition shadow-md shadow-blue-600/30 flex items-center gap-2">
                            <i class="fa-solid fa-plus"></i> Tambah Judul Buku
                        </button>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filtered.map(b => {
        const ddcNama = b.ddc?.nama || 'DDC';
        const stokBadge = b.eksemplar_tersedia > 0
            ? `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-bold text-[10px] border border-emerald-200 dark:border-emerald-800/60 shadow-2xs whitespace-nowrap"><i class="fa-solid fa-circle-check text-[9px]"></i> ${b.eksemplar_tersedia} / ${b.total_eksemplar} Tersedia</span>`
            : `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 font-bold text-[10px] border border-rose-200 dark:border-rose-800/60 shadow-2xs whitespace-nowrap"><i class="fa-solid fa-circle-xmark text-[9px]"></i> Habis (${b.total_eksemplar})</span>`;

        const rawRak = (b.lokasi_rak || '').trim();
        const cleanRak = rawRak ? (rawRak.toLowerCase().startsWith('rak') ? rawRak : `Rak ${rawRak}`) : '';

        return `
            <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors group">
                <td class="py-3 px-4 align-top">
                    <div class="font-bold text-slate-900 dark:text-white text-xs leading-snug line-clamp-2" title="${escapeHTML(b.judul)}">${escapeHTML(b.judul)}</div>
                    <div class="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mt-1 flex-wrap">
                        <span class="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300 font-medium">
                            <i class="fa-solid fa-user-pen text-[10px] text-blue-500"></i>
                            <span>${escapeHTML(b.pengarang || 'Anonim')}</span>
                        </span>
                        ${b.isbn ? `<span class="opacity-40 select-none">&bull;</span><span class="font-mono text-[10px] text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-200/60 dark:border-slate-700">ISBN: ${escapeHTML(b.isbn)}</span>` : ''}
                    </div>
                </td>
                <td class="py-3 px-3.5 align-top whitespace-nowrap">
                    <div class="flex items-center gap-1.5">
                        <span class="px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-mono font-bold text-[11px] border border-blue-200 dark:border-blue-800/60">${escapeHTML(b.kategori_ddc || '-')}</span>
                        <span class="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[120px]" title="${escapeHTML(ddcNama)}">${escapeHTML(ddcNama)}</span>
                    </div>
                </td>
                <td class="py-3 px-3.5 align-top whitespace-nowrap">
                    <span class="inline-block font-mono font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 px-2 py-0.5 rounded-md text-xs tracking-wide">${escapeHTML(b.call_number_dasar || '-')}</span>
                </td>
                <td class="py-3 px-3.5 align-top">
                    <div class="text-xs font-semibold text-slate-800 dark:text-slate-200 leading-snug line-clamp-2 max-w-[240px]" title="${escapeHTML(b.penerbit || '-')}">${escapeHTML(b.penerbit || '-')}</div>
                    <div class="text-[11px] text-slate-400 mt-1 flex items-center gap-1.5 flex-wrap">
                        <span>${b.tahun_terbit ? escapeHTML(String(b.tahun_terbit)) : '-'}</span>
                        ${cleanRak ? `<span class="opacity-40 select-none">&bull;</span><span class="text-slate-500 dark:text-slate-400 inline-flex items-center gap-1"><i class="fa-solid fa-layer-group text-[9px] text-slate-400"></i>${escapeHTML(cleanRak)}</span>` : ''}
                        ${b.harga && Number(b.harga) > 0 ? `<span class="opacity-40 select-none">&bull;</span><span class="font-bold text-emerald-600 dark:text-emerald-400 font-mono text-[10px]">Rp ${Math.round(Number(b.harga)).toLocaleString('id-ID')}</span>` : ''}
                    </div>
                </td>
                <td class="py-3 px-3.5 align-top text-center whitespace-nowrap">
                    ${stokBadge}
                </td>
                <td class="py-3 px-4 align-top text-center whitespace-nowrap sticky right-0 bg-white group-hover:bg-slate-50 dark:bg-slate-900 dark:group-hover:bg-slate-800 transition-colors shadow-[-6px_0_10px_-4px_rgba(0,0,0,0.05)] border-l border-slate-100 dark:border-slate-800/60 z-10">
                    <div class="flex items-center justify-center gap-1.5">
                        <button onclick="window.openEksemplarModalById(${b.id})" class="px-2.5 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 font-bold text-xs transition active:scale-95 flex items-center gap-1.5 shadow-2xs" title="Kelola Eksemplar Fisik & Cetak Label">
                            <i class="fa-solid fa-copy text-indigo-500"></i> <span>Eksemplar (${b.total_eksemplar})</span>
                        </button>
                        ${canManageCatalog ? `
                        <button onclick="window.editBookById(${b.id})" class="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-slate-700 flex items-center justify-center text-xs transition active:scale-95 border border-slate-200/60 dark:border-slate-700" title="Edit Bibliografi">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button onclick="window.deleteBookById(${b.id})" class="w-8 h-8 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 hover:bg-rose-100 flex items-center justify-center text-xs transition active:scale-95 border border-rose-200/60 dark:border-rose-800/60" title="Arsipkan Judul">
                            <i class="fa-solid fa-box-archive"></i>
                        </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

window.editBookById = function (bookId) {
    const book = booksList.find(b => b.id === bookId);
    if (book) openBookModal(book);
};

window.deleteBookById = async function (bookId) {
    if (!canManageCatalog) return;
    const book = booksList.find(b => b.id === bookId);
    if (!book) return;

    const { isConfirmed } = await Swal.fire({
        title: 'Arsipkan Judul Buku?',
        html: `Arsipkan buku <b>"${escapeHTML(book.judul)}"</b>?<br><span class="text-slate-500 text-xs">Judul hilang dari OPAC, tetapi seluruh riwayat sirkulasi tetap tersimpan.</span>`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Ya, Arsipkan',
        cancelButtonText: 'Batal',
        confirmButtonColor: '#e11d48'
    });

    if (!isConfirmed) return;

    try {
        await callSecureEdgeFunction('library-catalog-archive', { bookId });

        Swal.fire({ icon: 'success', title: 'Diarsipkan', text: 'Buku diarsipkan tanpa menghapus riwayat sirkulasi.', confirmButtonColor: '#2563eb' });
        await loadBooksList();
    } catch (e) {
        console.error('[Katalog] Gagal mengarsipkan buku:', e);
        Swal.fire({ icon: 'error', title: 'Gagal Mengarsipkan', text: e.message || 'Terjadi kesalahan.', confirmButtonColor: '#2563eb' });
    }
};

// =========================================================================
// 8. EKSEMPLAR FISIK & LABEL PRINTING
// =========================================================================
window.openEksemplarModalById = function (bookId) {
    const book = booksList.find(b => b.id === bookId);
    if (book) openEksemplarModal(book);
};

async function openEksemplarModal(book) {
    currentBookForEksemplar = book;
    selectedEksemplarIds.clear();

    const checkAll = document.getElementById('check-all-eksemplar');
    if (checkAll) {
        checkAll.checked = false;
        checkAll.indeterminate = false;
    }

    const modal = document.getElementById('modal-eksemplar');
    document.getElementById('modal-eksemplar-book-title').textContent = book.judul;
    document.getElementById('modal-eksemplar-call').textContent = `CALL: ${book.call_number_dasar || '-'} | Rak: ${book.lokasi_rak || '-'}`;

    const inputEksHarga = document.getElementById('input-eks-harga');
    if (inputEksHarga) {
        inputEksHarga.value = (book.harga && Number(book.harga) > 0) ? Math.round(Number(book.harga)).toLocaleString('id-ID') : '';
    }

    modal.classList.remove('hidden');
    await loadEksemplarForCurrentBook();
    await generateNextEksemplarDefaults();
}

async function loadEksemplarForCurrentBook() {
    if (!currentBookForEksemplar) return;

    try {
        const { data, error } = await supabase
            .from('lib_eksemplar')
            .select('*')
            .eq('buku_id', currentBookForEksemplar.id)
            .is('archived_at', null)
            .order('copy_number', { ascending: true });

        if (error) throw error;
        currentEksemplarList = data || [];

        document.getElementById('count-modal-eksemplar').textContent = currentEksemplarList.length;
        renderEksemplarTable();

    } catch (e) {
        console.error('[Katalog] Error load eksemplar:', e);
    }
}

function updateEksemplarQtyHelper() {
    const qtyInput = document.getElementById('input-eks-qty');
    const helperEl = document.getElementById('eks-qty-helper');
    const previewCountEl = document.getElementById('eks-qty-preview-count');
    const previewRangeEl = document.getElementById('eks-qty-preview-range');
    const nibPreviewEl = document.getElementById('eks-nib-preview-range');
    const btnText = document.getElementById('btn-submit-eksemplar-text');
    const labelNomorInduk = document.getElementById('label-eks-nomor-induk');
    const inputNomor = document.getElementById('input-eks-nomor-induk');
    const inputBarcode = document.getElementById('input-eks-barcode');
    const checkBarcodeSame = document.getElementById('check-barcode-same-as-nib');

    const qty = Math.max(1, parseInt(qtyInput?.value, 10) || 1);
    const currentCount = currentEksemplarList ? currentEksemplarList.length : 0;
    const startCopy = currentCount + 1;
    const endCopy = currentCount + qty;

    if (btnText) {
        btnText.textContent = qty > 1 ? `Tambah ${qty} Copy` : 'Tambah Copy';
    }

    if (labelNomorInduk) {
        labelNomorInduk.textContent = qty > 1 ? 'NIB Pertama (Awal)' : 'Nomor Induk / NIB Pertama';
    }

    // Sync barcode with NIB when checkbox is checked
    if (checkBarcodeSame?.checked && inputNomor && inputBarcode) {
        inputBarcode.value = inputNomor.value.trim();
    }

    // Calculate NIB range preview
    const baseNib = (inputNomor?.value || '').trim();
    let nibPreviewText = baseNib || '?';
    if (qty > 1 && baseNib) {
        const lastNib = generateSequenceItem(baseNib, qty - 1, endCopy);
        nibPreviewText = `${baseNib} s.d. ${lastNib}`;
    }

    if (previewCountEl) previewCountEl.textContent = qty;
    if (previewRangeEl) {
        previewRangeEl.textContent = qty > 1
            ? `Copy c.${startCopy} s.d. c.${endCopy}`
            : `Copy c.${startCopy}`;
    }
    if (nibPreviewEl) nibPreviewEl.textContent = nibPreviewText;
}

function generateSequenceItem(baseStr, indexOffset, copyNum) {
    if (!baseStr || !baseStr.trim()) {
        // Fallback: pure sequential number padded to 5 digits
        return String(copyNum).padStart(5, '0');
    }

    if (indexOffset === 0) return baseStr.trim();

    // Smart sequential: detect trailing digits and increment
    // e.g. "01500" -> "01501", "00005" -> "00006", "LIB-069074" -> "LIB-069075"
    const match = baseStr.trim().match(/^(.*?)([\d]+)$/);
    if (match) {
        const prefix = match[1];
        const numStr = match[2];
        const startNum = parseInt(numStr, 10);
        const nextNum = startNum + indexOffset;
        const paddedNextNum = String(nextNum).padStart(numStr.length, '0');
        return `${prefix}${paddedNextNum}`;
    }

    return `${baseStr.trim()}-${indexOffset + 1}`;
}

/**
 * Suggest the next NIB based on the highest existing nomor_induk in
 * the current book's eksemplar list (smart continuation).
 * If no eksemplar exists, suggest from the global highest NIB or fallback to "00001".
 */
async function getSuggestedNextNomorInduk() {
    try {
        // 1. Try to derive from current book's existing eksemplar
        if (currentEksemplarList && currentEksemplarList.length > 0) {
            const lastEks = currentEksemplarList[currentEksemplarList.length - 1];
            const lastNib = (lastEks.nomor_induk || '').trim();
            if (lastNib) {
                return generateSequenceItem(lastNib, 1, currentEksemplarList.length + 1);
            }
        }

        // 2. Fallback: query the global max nomor_induk across all eksemplar (1 read)
        const { data, error } = await supabase
            .from('lib_eksemplar')
            .select('nomor_induk')
            .is('archived_at', null)
            .order('nomor_induk', { ascending: false })
            .limit(1);

        if (!error && data && data.length > 0) {
            const globalMax = (data[0].nomor_induk || '').trim();
            if (globalMax) {
                return generateSequenceItem(globalMax, 1, 1);
            }
        }
    } catch (e) {
        console.warn('[Katalog] Error get suggested NIB:', e);
    }

    // 3. Ultimate fallback
    return '00001';
}

async function generateNextEksemplarDefaults() {
    const qtyInput = document.getElementById('input-eks-qty');
    if (qtyInput) qtyInput.value = '1';

    const suggestedNib = await getSuggestedNextNomorInduk();

    const inputNomor = document.getElementById('input-eks-nomor-induk');
    const inputBarcode = document.getElementById('input-eks-barcode');
    const checkBarcodeSame = document.getElementById('check-barcode-same-as-nib');

    if (inputNomor) inputNomor.value = suggestedNib;
    // Sync barcode = NIB when checkbox is checked
    if (inputBarcode) {
        inputBarcode.value = (checkBarcodeSame?.checked) ? suggestedNib : suggestedNib;
    }

    const inputEksHarga = document.getElementById('input-eks-harga');
    if (inputEksHarga) {
        const bookHarga = currentBookForEksemplar?.harga;
        inputEksHarga.value = (bookHarga && Number(bookHarga) > 0) ? Math.round(Number(bookHarga)).toLocaleString('id-ID') : '';
    }

    updateEksemplarQtyHelper();
}

function updateModalEksemplarSelectionUI() {
    const total = currentEksemplarList ? currentEksemplarList.length : 0;
    const selectedCount = selectedEksemplarIds.size;
    const badge = document.getElementById('selected-eks-badge');
    const badgeCount = document.getElementById('selected-eks-count');
    const checkAll = document.getElementById('check-all-eksemplar');
    const text2in1 = document.getElementById('text-print-2in1');
    const textSpine = document.getElementById('text-print-spine');
    const textBarcode = document.getElementById('text-print-barcode');

    if (badge && badgeCount) {
        if (selectedCount > 0) {
            badge.classList.remove('hidden');
            badgeCount.textContent = selectedCount;
        } else {
            badge.classList.add('hidden');
        }
    }

    if (checkAll) {
        checkAll.checked = total > 0 && selectedCount === total;
        checkAll.indeterminate = selectedCount > 0 && selectedCount < total;
    }

    if (text2in1) {
        text2in1.textContent = selectedCount > 0 ? `Cetak 2-in-1 (${selectedCount} Terpilih)` : 'Cetak Stiker 2-in-1';
    }
    if (textSpine) {
        textSpine.textContent = selectedCount > 0 ? `Stiker Punggung (${selectedCount} Terpilih)` : 'Stiker Punggung';
    }
    if (textBarcode) {
        textBarcode.textContent = selectedCount > 0 ? `Barcode Saja (${selectedCount} Terpilih)` : 'Barcode Saja';
    }
}

function handleCheckAllEksemplar(e) {
    const isChecked = e.target.checked;
    if (isChecked) {
        currentEksemplarList.forEach(item => selectedEksemplarIds.add(item.id));
    } else {
        selectedEksemplarIds.clear();
    }
    const checkboxes = document.querySelectorAll('.check-eksemplar-item');
    checkboxes.forEach(cb => {
        cb.checked = isChecked;
    });
    updateModalEksemplarSelectionUI();
}

window.toggleSelectEksemplar = function (eksemplarId, isChecked) {
    if (isChecked) {
        selectedEksemplarIds.add(eksemplarId);
    } else {
        selectedEksemplarIds.delete(eksemplarId);
    }
    updateModalEksemplarSelectionUI();
};

function getSelectedOrAllEksemplar() {
    if (!currentEksemplarList || currentEksemplarList.length === 0) return [];
    if (selectedEksemplarIds.size > 0) {
        return currentEksemplarList.filter(e => selectedEksemplarIds.has(e.id));
    }
    return currentEksemplarList;
}

function renderEksemplarTable() {
    const tbody = document.getElementById('modal-eksemplar-tbody');
    if (currentEksemplarList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="p-6 text-center text-slate-400 italic">Belum ada eksemplar fisik untuk judul ini. Silakan tambahkan copy di atas.</td></tr>';
        updateModalEksemplarSelectionUI();
        return;
    }

    tbody.innerHTML = currentEksemplarList.map(e => {
        let statusBadge = '';
        if (e.status === 'tersedia') {
            statusBadge = `<span class="px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 font-bold text-[10px] border border-emerald-200">Tersedia</span>`;
        } else if (e.status === 'dipinjam') {
            statusBadge = `<span class="px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 font-bold text-[10px] border border-amber-200">Dipinjam</span>`;
        } else {
            statusBadge = `<span class="px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 font-bold text-[10px] border border-rose-200">${e.status}</span>`;
        }

        const isChecked = selectedEksemplarIds.has(e.id);
        const hargaDisplay = (e.harga && Number(e.harga) > 0)
            ? `Rp ${Math.round(Number(e.harga)).toLocaleString('id-ID')}`
            : '-';

        return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition ${isChecked ? 'bg-blue-50/40 dark:bg-blue-900/20' : ''}">
                <td class="px-3 py-2.5 text-center">
                    <input type="checkbox" class="check-eksemplar-item w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 cursor-pointer" data-id="${e.id}" ${isChecked ? 'checked' : ''} onchange="window.toggleSelectEksemplar(${e.id}, this.checked)">
                </td>
                <td class="px-3 py-2.5 font-bold text-slate-800 dark:text-white">c.${e.copy_number}</td>
                <td class="px-3 py-2.5 font-mono text-slate-700 dark:text-slate-300 font-semibold">${escapeHTML(e.nomor_induk)}</td>
                <td class="px-3 py-2.5 font-mono text-blue-600 dark:text-blue-400 font-bold">${escapeHTML(e.kode_barcode)}</td>
                <td class="px-3 py-2.5 font-mono text-slate-600 dark:text-slate-400">${escapeHTML(e.call_number_lengkap)}</td>
                <td class="px-3 py-2.5 font-mono text-right text-slate-700 dark:text-slate-300 font-bold whitespace-nowrap">${hargaDisplay}</td>
                <td class="px-3 py-2.5 whitespace-nowrap">
                    ${statusBadge}
                    <span class="text-[10px] text-slate-400 ml-1">(${e.kondisi})</span>
                </td>
                <td class="px-3 py-2.5 text-center whitespace-nowrap">
                    <div class="flex items-center justify-center gap-1">
                        <button onclick="window.printSingleTwoInOneLabel(${e.id})" class="px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-bold border border-blue-200" title="Cetak Stiker 2-in-1 (Call Number + Barcode)">
                            <i class="fa-solid fa-tags"></i> 2-in-1
                        </button>
                        <button onclick="window.printSingleSpineLabel(${e.id})" class="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold" title="Cetak Stiker Punggung Saja">
                            <i class="fa-solid fa-tag"></i> Stiker
                        </button>
                        <button onclick="window.printSingleBarcode(${e.id})" class="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold" title="Cetak Barcode Saja">
                            <i class="fa-solid fa-barcode"></i> Barcode
                        </button>
                        ${canManageCatalog && e.status !== 'dipinjam' ? `
                            <button onclick="window.deleteEksemplarById(${e.id})" class="w-6 h-6 rounded bg-rose-50 text-rose-600 hover:bg-rose-100 flex items-center justify-center text-[10px]" title="Hapus Copy">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    updateModalEksemplarSelectionUI();
}

async function handleAddEksemplar(e) {
    e.preventDefault();
    if (!canManageCatalog) return;
    if (!currentBookForEksemplar) return;

    const qtyInput = document.getElementById('input-eks-qty');
    const qty = Math.max(1, parseInt(qtyInput?.value, 10) || 1);

    const btn = document.getElementById('btn-submit-eksemplar');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Menyimpan...';

    try {
        const baseNomorInduk = document.getElementById('input-eks-nomor-induk').value.trim();
        const checkBarcodeSame = document.getElementById('check-barcode-same-as-nib');
        const baseBarcode = checkBarcodeSame?.checked ? baseNomorInduk : document.getElementById('input-eks-barcode').value.trim();
        const sumber = document.getElementById('input-eks-sumber').value;
        const inputEksHargaVal = document.getElementById('input-eks-harga')?.value || '';
        const parsedEksHarga = parseFloat(inputEksHargaVal.replace(/\./g, '').replace(/,/g, '.'));
        const itemHarga = !isNaN(parsedEksHarga) ? parsedEksHarga : (Number(currentBookForEksemplar.harga) || 0);
        const currentCount = currentEksemplarList ? currentEksemplarList.length : 0;

        const payloads = [];
        for (let i = 0; i < qty; i++) {
            const nextCopyNumber = currentCount + 1 + i;
            const callNumberLengkap = `${currentBookForEksemplar.call_number_dasar} c.${nextCopyNumber}`;
            const nomorInduk = generateSequenceItem(baseNomorInduk, i, nextCopyNumber);
            const barcode = checkBarcodeSame?.checked ? nomorInduk : generateSequenceItem(baseBarcode, i, nextCopyNumber);

            payloads.push({
                buku_id: currentBookForEksemplar.id,
                nomor_induk: nomorInduk,
                kode_barcode: barcode,
                copy_number: nextCopyNumber,
                call_number_lengkap: callNumberLengkap,
                sumber_pengadaan: sumber,
                harga: itemHarga,
                kondisi: 'baik',
                status: 'tersedia'
            });
        }

        const { error } = await supabase.from('lib_eksemplar').insert(payloads);
        if (error) throw error;

        // Trigger database menyinkronkan total dan stok tersedia secara atomik.
        const newTotal = currentCount + qty;

        await loadEksemplarForCurrentBook();
        await generateNextEksemplarDefaults();
        await loadBooksList();

        Swal.fire({
            icon: 'success',
            title: 'Eksemplar Berhasil Ditambahkan!',
            text: `Sebanyak ${qty} eksemplar fisik buku (Copy c.${currentCount + 1}${qty > 1 ? ` s.d. c.${newTotal}` : ''}) berhasil didaftarkan.`,
            timer: 2000,
            showConfirmButton: false
        });

    } catch (err) {
        console.error('[Katalog] Error tambah eksemplar:', err);
        Swal.fire({
            icon: 'error',
            title: 'Gagal Tambah Eksemplar',
            text: err.message || 'Periksa apakah Nomor Induk / Barcode sudah digunakan.',
            confirmButtonColor: '#2563eb'
        });
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

window.deleteEksemplarById = async function (eksemplarId) {
    if (!canManageCatalog) return;
    const eks = currentEksemplarList.find(e => e.id === eksemplarId);
    if (!eks) return;

    const { isConfirmed } = await Swal.fire({
        title: 'Arsipkan Eksemplar?',
        text: `Arsipkan salinan Copy ${eks.copy_number} (${eks.nomor_induk}) tanpa menghapus riwayatnya?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Ya, Arsipkan',
        cancelButtonText: 'Batal',
        confirmButtonColor: '#e11d48'
    });

    if (!isConfirmed) return;

    try {
        await callSecureEdgeFunction('library-copy-archive', { copyId: eksemplarId });

        await loadEksemplarForCurrentBook();
        await loadBooksList();

    } catch (e) {
        console.error('[Katalog] Error delete eksemplar:', e);
        Swal.fire({ icon: 'error', title: 'Gagal', text: e.message, confirmButtonColor: '#2563eb' });
    }
};

// =========================================================================
// 9. PRINTING SPINE LABELS & BARCODES
// =========================================================================
function generateSpineLabelHTML(eksemplar, book) {
    const callParts = (eksemplar.call_number_lengkap || '').split(' ');
    const ddc = callParts[0] || book.kategori_ddc || '000';
    const authorCode = callParts[1] || 'XXX';
    const titleCode = callParts[2] || 'x';
    const copyCode = `c.${eksemplar.copy_number || 1}`;

    return `
        <div class="spine-label">
            <div style="font-size: 8px; font-weight: 800; text-transform: uppercase; border-bottom: 1px solid #000; padding-bottom: 2px;">
                ${SCHOOL_CONFIG.schoolNameUpper}
            </div>
            <div style="margin: auto 0; line-height: 1.25;">
                <div style="font-size: 14px; font-weight: 900; font-family: monospace;">${ddc}</div>
                <div style="font-size: 13px; font-weight: 800; font-family: monospace; letter-spacing: 1px;">${authorCode}</div>
                <div style="font-size: 13px; font-weight: 700; font-family: monospace;">${titleCode}</div>
                <div style="font-size: 11px; font-weight: 600; font-family: monospace; color: #333; margin-top: 2px;">${copyCode}</div>
            </div>
            <div style="font-size: 7px; font-weight: 600; border-top: 1px solid #000; padding-top: 2px;">
                ${appConfig.nama_perpustakaan}
            </div>
        </div>
    `;
}

function generateBarcodeCardHTML(eksemplar, book) {
    const barcodeId = `barcode-svg-${eksemplar.id}`;
    return `
        <div class="barcode-card">
            <div style="font-size: 8px; font-weight: 800; text-transform: uppercase; margin-bottom: 2px;">
                PERPUSTAKAAN ${SCHOOL_CONFIG.schoolShortName}
            </div>
            <div style="font-size: 9px; font-weight: 700; max-width: 5.5cm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px;">
                ${escapeHTML(book.judul || '-')}
            </div>
            <svg id="${barcodeId}" style="max-height: 1.4cm; width: 100%;"></svg>
            <div style="font-size: 8px; font-family: monospace; font-weight: 700; margin-top: 1px;">
                ${escapeHTML(eksemplar.nomor_induk)}
            </div>
        </div>
    `;
}

function generateTwoInOneLabelHTML(eksemplar, book) {
    const barcodeId = `barcode-2in1-svg-${eksemplar.id}`;
    const callNumber = eksemplar.call_number_lengkap || `${book.call_number_dasar || '-'} c.${eksemplar.copy_number}`;

    return `
        <div class="two-in-one-label">
            <div style="font-size: 13px; font-weight: 900; font-family: monospace; letter-spacing: 0.5px; border-bottom: 1px dashed #94a3b8; padding-bottom: 2px; width: 100%; text-align: center;">
                ${escapeHTML(callNumber)}
            </div>
            <div style="margin: 2px 0; width: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                <svg id="${barcodeId}" style="max-height: 1.6cm; width: 95%;"></svg>
            </div>
            <div style="font-size: 8px; font-weight: 700; color: #334155; width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-top: 1px dashed #cbd5e1; padding-top: 2px;">
                ${escapeHTML(book.judul || '-')}
            </div>
        </div>
    `;
}

function startPrintProcess(format, htmlContent, renderCallback) {
    const printArea = document.getElementById('print-area');
    const printContent = document.getElementById('print-content');
    if (!printArea || !printContent) return;

    if (format === 'spine') {
        printContent.className = "p-2 grid grid-cols-4 gap-3";
    } else {
        printContent.className = "p-2 grid grid-cols-3 gap-3";
    }

    printContent.innerHTML = htmlContent;
    printArea.classList.remove('hidden');

    if (typeof renderCallback === 'function') {
        renderCallback();
    }

    // Give browser sufficient time to compute layout & barcode SVGs
    setTimeout(() => {
        window.print();
    }, 250);
}

window.addEventListener('afterprint', () => {
    const printArea = document.getElementById('print-area');
    if (printArea) printArea.classList.add('hidden');
});

window.printAllTwoInOneLabels = function () {
    const listToPrint = getSelectedOrAllEksemplar();
    if (!listToPrint || listToPrint.length === 0) {
        Swal.fire({ icon: 'warning', title: 'Belum Ada Eksemplar', text: 'Tambahkan atau pilih eksemplar terlebih dahulu sebelum mencetak stiker.', confirmButtonColor: '#2563eb' });
        return;
    }

    const html = listToPrint.map(e => generateTwoInOneLabelHTML(e, currentBookForEksemplar)).join('');
    startPrintProcess('2in1', html, () => {
        listToPrint.forEach(e => {
            try {
                JsBarcode(`#barcode-2in1-svg-${e.id}`, e.kode_barcode, {
                    format: "CODE128",
                    height: 35,
                    fontSize: 11,
                    fontOptions: "bold",
                    margin: 0,
                    displayValue: true
                });
            } catch (err) {
                console.warn('[JsBarcode] Error rendering 2-in-1 barcode:', err);
            }
        });
    });
};

window.printSingleTwoInOneLabel = function (eksemplarId) {
    const eks = currentEksemplarList.find(e => e.id === eksemplarId);
    if (!eks) return;

    const html = generateTwoInOneLabelHTML(eks, currentBookForEksemplar);
    startPrintProcess('2in1', html, () => {
        try {
            JsBarcode(`#barcode-2in1-svg-${eks.id}`, eks.kode_barcode, {
                format: "CODE128",
                height: 35,
                fontSize: 11,
                fontOptions: "bold",
                margin: 0,
                displayValue: true
            });
        } catch (err) { }
    });
};

window.printAllSpineLabels = function () {
    const listToPrint = getSelectedOrAllEksemplar();
    if (!listToPrint || listToPrint.length === 0) {
        Swal.fire({ icon: 'warning', title: 'Belum Ada Eksemplar', text: 'Tambahkan atau pilih eksemplar terlebih dahulu sebelum mencetak stiker.', confirmButtonColor: '#2563eb' });
        return;
    }

    const html = listToPrint.map(e => generateSpineLabelHTML(e, currentBookForEksemplar)).join('');
    startPrintProcess('spine', html);
};

window.printSingleSpineLabel = function (eksemplarId) {
    const eks = currentEksemplarList.find(e => e.id === eksemplarId);
    if (!eks) return;

    const html = generateSpineLabelHTML(eks, currentBookForEksemplar);
    startPrintProcess('spine', html);
};

window.printAllBarcodes = function () {
    const listToPrint = getSelectedOrAllEksemplar();
    if (!listToPrint || listToPrint.length === 0) return;

    const html = listToPrint.map(e => generateBarcodeCardHTML(e, currentBookForEksemplar)).join('');
    startPrintProcess('barcode', html, () => {
        listToPrint.forEach(e => {
            try {
                JsBarcode(`#barcode-svg-${e.id}`, e.kode_barcode, {
                    format: "CODE128",
                    height: 30,
                    fontSize: 10,
                    margin: 0,
                    displayValue: true
                });
            } catch (err) {
                console.warn('[JsBarcode] Error rendering barcode:', err);
            }
        });
    });
};

window.printSingleBarcode = function (eksemplarId) {
    const eks = currentEksemplarList.find(e => e.id === eksemplarId);
    if (!eks) return;

    const html = generateBarcodeCardHTML(eks, currentBookForEksemplar);
    startPrintProcess('barcode', html, () => {
        try {
            JsBarcode(`#barcode-svg-${eks.id}`, eks.kode_barcode, {
                format: "CODE128",
                height: 30,
                fontSize: 10,
                margin: 0,
                displayValue: true
            });
        } catch (err) { }
    });
};

// =========================================================================
// 10. CROSS-BOOK BULK LABEL & BARCODE PRINTING
// =========================================================================
function openBulkPrintModal() {
    const modal = document.getElementById('modal-bulk-print');
    if (!modal) return;

    // Filter books with total_eksemplar > 0
    bulkPrintBooksList = booksList.filter(b => (b.total_eksemplar || 0) > 0);

    if (bulkPrintBooksList.length === 0) {
        Swal.fire({
            icon: 'info',
            title: 'Belum Ada Eksemplar',
            text: 'Belum ada judul buku yang memiliki eksemplar fisik untuk dicetak.',
            confirmButtonColor: '#2563eb'
        });
        return;
    }

    // Select all available books by default
    bulkSelectedBookIds = new Set(bulkPrintBooksList.map(b => b.id));

    const searchInput = document.getElementById('search-bulk-books');
    if (searchInput) searchInput.value = '';

    renderBulkPrintBookList();
    updateBulkPrintEstimates();
    updateBulkPrintFormatUI('2in1');

    modal.classList.remove('hidden');
}

function updateBulkPrintFormatUI(selectedVal) {
    const cards = {
        '2in1': document.getElementById('label-opt-2in1'),
        'spine': document.getElementById('label-opt-spine'),
        'barcode': document.getElementById('label-opt-barcode')
    };

    Object.keys(cards).forEach(key => {
        const el = cards[key];
        if (!el) return;
        if (key === selectedVal) {
            el.className = 'p-3.5 rounded-2xl border-2 border-blue-500 bg-blue-50/50 dark:bg-blue-950/30 cursor-pointer flex flex-col justify-between transition hover:border-blue-600';
        } else {
            el.className = 'p-3.5 rounded-2xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 cursor-pointer flex flex-col justify-between transition hover:border-blue-400';
        }
    });
}

function renderBulkPrintBookList() {
    const container = document.getElementById('bulk-books-list-container');
    if (!container) return;

    const query = (document.getElementById('search-bulk-books')?.value || '').toLowerCase().trim();

    const filtered = bulkPrintBooksList.filter(b => {
        if (!query) return true;
        const judul = (b.judul || '').toLowerCase();
        const pengarang = (b.pengarang || '').toLowerCase();
        const ddc = String(b.kategori_ddc || '').toLowerCase();
        const call = (b.call_number_dasar || '').toLowerCase();
        return judul.includes(query) || pengarang.includes(query) || ddc.includes(query) || call.includes(query);
    });

    if (filtered.length === 0) {
        container.innerHTML = '<div class="p-6 text-center text-slate-400 italic">Tidak ada buku yang sesuai dengan pencarian.</div>';
        return;
    }

    container.innerHTML = filtered.map(b => {
        const isChecked = bulkSelectedBookIds.has(b.id);
        return `
            <label class="p-2.5 flex items-center justify-between gap-3 hover:bg-slate-100/70 dark:hover:bg-slate-800/60 rounded-xl cursor-pointer transition">
                <div class="flex items-center gap-3 min-w-0">
                    <input type="checkbox" class="bulk-book-checkbox w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500 cursor-pointer" data-id="${b.id}" ${isChecked ? 'checked' : ''} onchange="window.toggleBulkBookSelection(${b.id}, this.checked)">
                    <div class="min-w-0">
                        <p class="font-bold text-slate-800 dark:text-white truncate text-xs">${escapeHTML(b.judul)}</p>
                        <p class="text-[10px] text-slate-400 truncate">
                            <span class="font-mono text-blue-600 dark:text-blue-400 font-bold">${escapeHTML(b.call_number_dasar || b.kategori_ddc)}</span> &bull; ${escapeHTML(b.pengarang || 'Anonim')}
                        </p>
                    </div>
                </div>
                <span class="px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-bold text-[10px] border border-indigo-200 dark:border-indigo-800 shrink-0">
                    ${b.total_eksemplar || 0} Eksemplar
                </span>
            </label>
        `;
    }).join('');
}

window.toggleBulkBookSelection = function (bookId, isChecked) {
    if (isChecked) {
        bulkSelectedBookIds.add(bookId);
    } else {
        bulkSelectedBookIds.delete(bookId);
    }
    updateBulkPrintEstimates();
};

function selectAllBulkBooks() {
    bulkPrintBooksList.forEach(b => bulkSelectedBookIds.add(b.id));
    renderBulkPrintBookList();
    updateBulkPrintEstimates();
}

function deselectAllBulkBooks() {
    bulkSelectedBookIds.clear();
    renderBulkPrintBookList();
    updateBulkPrintEstimates();
}

function updateBulkPrintEstimates() {
    const summaryBooks = document.getElementById('bulk-summary-books-count');
    const summaryCopies = document.getElementById('bulk-summary-copies-count');

    const selectedBooks = bulkPrintBooksList.filter(b => bulkSelectedBookIds.has(b.id));
    const totalCopies = selectedBooks.reduce((sum, b) => sum + (b.total_eksemplar || 0), 0);

    if (summaryBooks) summaryBooks.textContent = selectedBooks.length;
    if (summaryCopies) summaryCopies.textContent = totalCopies;
}

async function executeBulkPrint() {
    if (bulkSelectedBookIds.size === 0) {
        Swal.fire({
            icon: 'warning',
            title: 'Pilih Judul Buku',
            text: 'Silakan pilih minimal 1 judul buku untuk dicetak stikernya.',
            confirmButtonColor: '#2563eb'
        });
        return;
    }

    const btn = document.getElementById('btn-execute-bulk-print');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Menyiapkan Data...';

    try {
        const selectedIds = Array.from(bulkSelectedBookIds);
        const format = document.querySelector('input[name="bulk-print-format"]:checked')?.value || '2in1';

        // Load all eksemplar for selected books
        const { data: eksemplarList, error } = await supabase
            .from('lib_eksemplar')
            .select(`
                *,
                buku:lib_buku (id, judul, pengarang, kategori_ddc, call_number_dasar, lokasi_rak)
            `)
            .in('buku_id', selectedIds)
            .is('archived_at', null)
            .order('buku_id', { ascending: true })
            .order('copy_number', { ascending: true });

        if (error) throw error;

        if (!eksemplarList || eksemplarList.length === 0) {
            Swal.fire({
                icon: 'info',
                title: 'Tidak Ada Eksemplar',
                text: 'Tidak ditemukan eksemplar fisik pada buku terpilih.',
                confirmButtonColor: '#2563eb'
            });
            return;
        }

        // Hide modal bulk print
        document.getElementById('modal-bulk-print')?.classList.add('hidden');

        let html = '';
        if (format === '2in1') {
            html = eksemplarList.map(e => generateTwoInOneLabelHTML(e, e.buku || booksList.find(b => b.id === e.buku_id) || {})).join('');
            startPrintProcess('2in1', html, () => {
                eksemplarList.forEach(e => {
                    try {
                        JsBarcode(`#barcode-2in1-svg-${e.id}`, e.kode_barcode, {
                            format: "CODE128",
                            height: 35,
                            fontSize: 11,
                            fontOptions: "bold",
                            margin: 0,
                            displayValue: true
                        });
                    } catch (err) {
                        console.warn('[JsBarcode] Error bulk render 2-in-1 barcode:', err);
                    }
                });
            });

        } else if (format === 'spine') {
            html = eksemplarList.map(e => generateSpineLabelHTML(e, e.buku || booksList.find(b => b.id === e.buku_id) || {})).join('');
            startPrintProcess('spine', html);

        } else if (format === 'barcode') {
            html = eksemplarList.map(e => generateBarcodeCardHTML(e, e.buku || booksList.find(b => b.id === e.buku_id) || {})).join('');
            startPrintProcess('barcode', html, () => {
                eksemplarList.forEach(e => {
                    try {
                        JsBarcode(`#barcode-svg-${e.id}`, e.kode_barcode, {
                            format: "CODE128",
                            height: 30,
                            fontSize: 10,
                            margin: 0,
                            displayValue: true
                        });
                    } catch (err) {
                        console.warn('[JsBarcode] Error bulk render barcode:', err);
                    }
                });
            });
        }

    } catch (err) {
        console.error('[Katalog] Error bulk print:', err);
        Swal.fire({
            icon: 'error',
            title: 'Gagal Memproses Cetak Massal',
            text: err.message || 'Terjadi kesalahan sistem.',
            confirmButtonColor: '#2563eb'
        });
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// =========================================================================
// 10. MASS IMPORT & EXPORT EXCEL
// =========================================================================
function handleOpenImportModal() {
    Swal.fire({
        title: 'Import Massal Judul Buku',
        html: `
            <div class="text-left text-xs space-y-3">
                <p class="text-slate-500">Unggah berkas Excel (.xlsx / .xls / .csv) berisi daftar buku untuk diimpor secara otomatis.</p>
                <div class="p-3 bg-blue-50 dark:bg-blue-900/30 rounded-xl text-blue-700 dark:text-blue-300">
                    <p class="font-bold mb-1">Format Kolom Excel:</p>
                    <p class="font-mono text-[11px]">Judul | Pengarang | DDC | Penerbit | Tahun | ISBN | Rak | Tipe</p>
                </div>
                <div>
                    <a href="javascript:void(0)" onclick="window.downloadImportTemplate()" class="text-blue-600 dark:text-blue-400 font-bold hover:underline">
                        <i class="fa-solid fa-download mr-1"></i> Unduh Template Excel Contoh
                    </a>
                </div>
                <input type="file" id="import-excel-file" accept=".xlsx, .xls, .csv" class="w-full text-xs border p-2 rounded-xl">
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Mulai Import',
        cancelButtonText: 'Batal',
        confirmButtonColor: '#2563eb',
        preConfirm: () => {
            const fileInput = document.getElementById('import-excel-file');
            if (!fileInput.files || fileInput.files.length === 0) {
                Swal.showValidationMessage('Silakan pilih berkas Excel terlebih dahulu');
                return false;
            }
            return fileInput.files[0];
        }
    }).then(async (result) => {
        if (result.isConfirmed && result.value) {
            await processExcelImport(result.value);
        }
    });
}

window.downloadImportTemplate = function () {
    const templateData = [
        {
            'Judul': 'Laskar Pelangi',
            'Pengarang': 'Andrea Hirata',
            'DDC': '813',
            'Penerbit': 'Bentang Pustaka',
            'Kota': 'Yogyakarta',
            'Tahun': 2005,
            'ISBN': '978-979-1227-78-0',
            'Harga': 75000,
            'Lokasi Rak': 'Rak Sastra 01',
            'Tipe Koleksi': 'Sirkulasi'
        },
        {
            'Judul': 'Matematika SMA Kelas X',
            'Pengarang': 'Sukino',
            'DDC': '510',
            'Penerbit': 'Erlangga',
            'Kota': 'Jakarta',
            'Tahun': 2022,
            'ISBN': '978-602-434-112-9',
            'Harga': 95000,
            'Lokasi Rak': 'Rak Sains 03',
            'Tipe Koleksi': 'Sirkulasi'
        }
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template Buku");
    XLSX.writeFile(wb, "Template_Import_Buku_Perpustakaan_SMANTARA.xlsx");
};

async function processExcelImport(file) {
    Swal.fire({
        title: 'Mengimpor Data...',
        html: 'Sedang membaca dan memproses berkas Excel...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[firstSheetName];
        const rawJson = XLSX.utils.sheet_to_json(sheet);

        if (!rawJson || rawJson.length === 0) {
            throw new Error('Berkas Excel kosong atau tidak terbaca.');
        }

        const newBooks = [];
        rawJson.forEach(row => {
            const judul = row['Judul'] || row['judul'] || row['JUDUL'] || '';
            let pengarang = row['Pengarang'] || row['pengarang'] || row['PENGARANG'] || 'Anonim';
            if (pengarang && pengarang !== 'Anonim' && window.LibraryAuthor) {
                const parsed = window.LibraryAuthor.parse(pengarang);
                if (!parsed.isCorporate && !parsed.isAlreadyInverted && parsed.standardTajuk) {
                    pengarang = parsed.standardTajuk;
                }
            }
            const ddc = String(row['DDC'] || row['ddc'] || '000').trim();
            const penerbit = String(row['Penerbit'] || row['penerbit'] || '-').trim();
            const kota = String(row['Kota'] || row['kota'] || '-').trim();
            const tahun = parseInt(row['Tahun'] || row['tahun'], 10) || new Date().getFullYear();
            const isbn = String(row['ISBN'] || row['isbn'] || '').trim();
            const rawHarga = row['Harga'] || row['harga'] || row['HARGA'] || 0;
            const parsedHarga = typeof rawHarga === 'number' ? rawHarga : (parseFloat(String(rawHarga).replace(/[^0-9.]/g, '')) || 0);
            const rak = row['Lokasi Rak'] || row['rak'] || '';
            const tipe = row['Tipe Koleksi'] || row['tipe'] || 'Sirkulasi';

            if (judul) {
                const callNumber = generateNationalCallNumber(ddc, pengarang, judul);
                newBooks.push({
                    judul,
                    pengarang,
                    kategori_ddc: ddc,
                    call_number_dasar: callNumber,
                    penerbit,
                    kota_terbit: kota,
                    tahun_terbit: tahun,
                    isbn,
                    harga: parsedHarga,
                    lokasi_rak: rak,
                    tipe_koleksi: tipe,
                    total_eksemplar: 0,
                    eksemplar_tersedia: 0,
                    created_by: auth.currentUser?.email || 'admin_import'
                });
            }
        });

        if (newBooks.length === 0) {
            throw new Error('Tidak ditemukan kolom "Judul" yang valid di berkas Excel.');
        }

        // Insert batch ke Supabase (dengan fallback jika kolom harga belum ada di database)
        let { error } = await supabase.from('lib_buku').insert(newBooks);
        if (error) {
            const errStr = (error.message || '') + (error.details || '');
            if (error.code === '42703' || /column.*harga.*not exist|harga/i.test(errStr)) {
                console.warn('[Katalog] Kolom harga belum ada di lib_buku saat import, mengulang tanpa kolom harga...');
                const strippedBooks = newBooks.map(b => {
                    const copy = { ...b };
                    delete copy.harga;
                    return copy;
                });
                const retryRes = await supabase.from('lib_buku').insert(strippedBooks);
                if (retryRes.error) throw retryRes.error;
            } else {
                throw error;
            }
        }

        Swal.fire({
            icon: 'success',
            title: 'Import Berhasil!',
            text: `Sebanyak ${newBooks.length} judul buku berhasil ditambahkan ke database.`,
            confirmButtonColor: '#2563eb'
        });

        await loadBooksList();

    } catch (err) {
        console.error('[Katalog] Error import Excel:', err);
        Swal.fire({ icon: 'error', title: 'Gagal Import', text: err.message || 'Gagal memproses berkas.', confirmButtonColor: '#2563eb' });
    }
}

function exportBooksToExcel() {
    if (!booksList || booksList.length === 0) {
        Swal.fire({ icon: 'info', title: 'Data Kosong', text: 'Tidak ada katalog buku untuk diekspor.', confirmButtonColor: '#2563eb' });
        return;
    }

    try {
        const rows = booksList.map((b, idx) => ({
            'No': idx + 1,
            'Judul Buku': b.judul,
            'Pengarang': b.pengarang,
            'Pengarang Tambahan': b.pengarang_tambahan || '',
            'DDC': b.kategori_ddc,
            'Kategori DDC': b.ddc?.nama || '',
            'Call Number Dasar': b.call_number_dasar,
            'Penerbit': b.penerbit || '',
            'Kota Terbit': b.kota_terbit || '',
            'Tahun Terbit': b.tahun_terbit || '',
            'ISBN': b.isbn || '',
            'Harga (Rp)': (b.harga && Number(b.harga) > 0) ? Math.round(Number(b.harga)) : 0,
            'Lokasi Rak': b.lokasi_rak || '',
            'Tipe Koleksi': b.tipe_koleksi,
            'Total Eksemplar': b.total_eksemplar || 0,
            'Eksemplar Tersedia': b.eksemplar_tersedia || 0
        }));

        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Katalog Bibliografi");
        XLSX.writeFile(wb, `Katalog_Buku_Perpustakaan_SMANTARA_${getLocalISODate()}.xlsx`);

    } catch (e) {
        console.error('[Katalog] Error export Excel:', e);
        Swal.fire({ icon: 'error', title: 'Gagal Export', text: e.message, confirmButtonColor: '#2563eb' });
    }
}

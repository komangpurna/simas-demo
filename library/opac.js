/* library/opac.js - Online Public Access Catalog Perpustakaan */
import { auth, db, PATHS, supabase } from '../js/config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { initLayout, escapeHTML, formatDateIndo, getLocalISODate } from '../js/global.js';
import { countChargeableLateDays } from './circulation-utils.mjs';
import { fetchAllSupabaseRows } from '../js/supabase-pagination.mjs';

// =========================================================================
// 1. STATE & OPAC DATA
// =========================================================================
let allBooks = [];
let activeDDCFilter = '';
let currentSearchTerm = '';
let myPeminjamId = ''; // NIS (siswa) atau NIP (guru/staff) user yang login
let publicLibraryHolidays = new Set();
let opacIgnoreHolidays = true;

// =========================================================================
// 2. AUTH & INITIALIZATION
// =========================================================================
const urlParams = new URLSearchParams(window.location.search);
const isEmbed = urlParams.get('mode') === 'popup' || urlParams.get('embed') === '1' || window.self !== window.top;

if (isEmbed) {
    document.documentElement.classList.add('is-embed-mode');
    document.body.classList.add('opac-embed-mode');
    const appLayout = document.getElementById('app-layout');
    if (appLayout) {
        appLayout.innerHTML = '';
        appLayout.style.display = 'none';
    }

    // Keyboard ESC listener untuk mengirim sinyal penutupan ke parent window
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            window.parent.postMessage({ action: 'close-opac-modal' }, '*');
        }
    });
}

onAuthStateChanged(auth, async (user) => {
    // Jika bukan embed/popup, inisialisasi layout SIMAS penuh dengan sidebar & navbar
    if (!isEmbed) {
        const primaryRole = localStorage.getItem('user_role') || 'siswa';
        await initLayout(primaryRole);
    }
    
    document.querySelector('main')?.classList.remove('hidden');

    // Resolve identitas peminjam untuk fitur "Pinjaman Saya" (hanya jika bukan embed mode)
    if (user && !isEmbed) {
        myPeminjamId = await resolveMyPeminjamId(user, localStorage.getItem('user_role') || 'siswa');
    }

    await loadOPACBooks();
    setupOPACEventListeners();

    // Load Pinjaman Saya jika user teridentifikasi dan bukan mode embed
    if (myPeminjamId && !isEmbed) {
        await loadMyLoans();
    }
});

// =========================================================================
// 3. LOAD OPAC BOOKS
// =========================================================================
async function loadOPACBooks() {
    try {
        const [booksData, { data: holidayData, error: holidayError }, { data: fineConfig }] = await Promise.all([
            fetchAllSupabaseRows((from, to) => supabase
                .from('lib_opac_buku')
                .select('*')
                .order('id', { ascending: false })
                .range(from, to)),
            supabase.from('lib_opac_hari_libur').select('tanggal'),
            supabase.from('lib_config').select('value').eq('key', 'abaikan_hari_libur').maybeSingle()
        ]);
        allBooks = booksData;
        if (!holidayError) {
            publicLibraryHolidays = new Set((holidayData || []).map(item => item.tanggal).filter(Boolean));
        }
        opacIgnoreHolidays = fineConfig?.value !== 'false';
        renderOPACBooksGrid();

    } catch (e) {
        console.error('[OPAC] Error load books:', e);
        const grid = document.getElementById('opac-books-grid');
        if (grid) {
            grid.innerHTML = '<div class="p-8 text-center text-rose-500 col-span-full">Gagal memuat katalog buku online.</div>';
        }
    }
}

// =========================================================================
// 4. EVENT LISTENERS
// =========================================================================
function setupOPACEventListeners() {
    const searchInput = document.getElementById('opac-search-input');
    const btnSearch = document.getElementById('btn-search-opac');
    const sortSelect = document.getElementById('opac-sort');
    const btnResetDDC = document.getElementById('btn-reset-ddc-filter');

    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            currentSearchTerm = e.target.value.trim().toLowerCase();
            renderOPACBooksGrid();
        }, 300);
    });

    btnSearch.addEventListener('click', () => {
        currentSearchTerm = searchInput.value.trim().toLowerCase();
        renderOPACBooksGrid();
    });

    sortSelect.addEventListener('change', renderOPACBooksGrid);

    btnResetDDC.addEventListener('click', () => {
        window.filterByDDC('');
    });
}

// =========================================================================
// 5. DDC FILTER HANDLER
// =========================================================================
window.filterByDDC = function (ddcPrefix) {
    activeDDCFilter = ddcPrefix;
    const btnReset = document.getElementById('btn-reset-ddc-filter');
    const ddcButtons = document.querySelectorAll('.ddc-filter-btn');

    ddcButtons.forEach(btn => {
        const code = btn.getAttribute('data-ddc');
        if (code === ddcPrefix) {
            // Latar terpilih menggantikan latar dasar (urutan CSS Tailwind build)
            btn.classList.remove('bg-white', 'dark:bg-slate-800');
            btn.classList.add('ring-2', 'ring-blue-600', 'bg-blue-50/50', 'dark:bg-blue-900/30');
        } else {
            btn.classList.remove('ring-2', 'ring-blue-600', 'bg-blue-50/50', 'dark:bg-blue-900/30');
            btn.classList.add('bg-white', 'dark:bg-slate-800');
        }
    });

    if (ddcPrefix) {
        btnReset.classList.remove('hidden');
    } else {
        btnReset.classList.add('hidden');
    }

    renderOPACBooksGrid();
};

// =========================================================================
// 6. RENDER BOOKS GRID
// =========================================================================
function renderOPACBooksGrid() {
    const grid = document.getElementById('opac-books-grid');
    const sortVal = document.getElementById('opac-sort')?.value || 'newest';
    const resultTitle = document.getElementById('opac-result-title');
    const totalCountEl = document.getElementById('opac-total-count');

    // 1. Filter
    let filtered = allBooks.filter(book => {
        // Filter DDC
        if (activeDDCFilter) {
            const bookDDC = (book.kategori_ddc || '').toString();
            // Match class 000, 100, 200, etc.
            if (!bookDDC.startsWith(activeDDCFilter.charAt(0))) return false;
        }

        // Filter Search Term
        if (currentSearchTerm) {
            const judul = (book.judul || '').toLowerCase();
            const pengarang = (book.pengarang || '').toLowerCase();
            const penerbit = (book.penerbit || '').toLowerCase();
            const isbn = (book.isbn || '').toLowerCase();
            const ddcNama = (book.ddc_nama || '').toLowerCase();
            const callNumber = (book.call_number_dasar || '').toLowerCase();

            return judul.includes(currentSearchTerm) || pengarang.includes(currentSearchTerm) || penerbit.includes(currentSearchTerm) || isbn.includes(currentSearchTerm) || ddcNama.includes(currentSearchTerm) || callNumber.includes(currentSearchTerm);
        }

        return true;
    });

    // 2. Sort
    filtered.sort((a, b) => {
        if (sortVal === 'title_asc') {
            return (a.judul || '').localeCompare(b.judul || '');
        } else if (sortVal === 'author_asc') {
            return (a.pengarang || '').localeCompare(b.pengarang || '');
        } else if (sortVal === 'available_desc') {
            return (b.eksemplar_tersedia || 0) - (a.eksemplar_tersedia || 0);
        } else {
            // Newest by ID
            return (b.id || 0) - (a.id || 0);
        }
    });

    // 3. Update Title & Counts
    if (totalCountEl) totalCountEl.textContent = filtered.length;
    if (resultTitle) {
        if (activeDDCFilter) {
            resultTitle.innerHTML = `Koleksi DDC <b>${activeDDCFilter}</b> (<span id="opac-total-count">${filtered.length}</span> Judul)`;
        } else if (currentSearchTerm) {
            resultTitle.innerHTML = `Hasil Pencarian "<b>${escapeHTML(currentSearchTerm)}</b>" (<span id="opac-total-count">${filtered.length}</span> Judul)`;
        } else {
            resultTitle.innerHTML = `Semua Koleksi Buku (<span id="opac-total-count">${filtered.length}</span> Judul)`;
        }
    }

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full p-12 text-center bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700">
                <i class="fa-solid fa-book-skull text-4xl text-slate-300 dark:text-slate-600 mb-3"></i>
                <h4 class="font-bold text-slate-700 dark:text-slate-200 text-sm">Tidak Ditemukan Buku</h4>
                <p class="text-xs text-slate-400 mt-1">Coba gunakan kata kunci pencarian yang lain atau reset filter DDC.</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = filtered.map(b => {
        const isAvailable = (b.eksemplar_tersedia || 0) > 0;
        const availableBadge = isAvailable
            ? `<span class="px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 font-bold text-[10px] border border-emerald-200 dark:border-emerald-800 flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Tersedia (${b.eksemplar_tersedia})</span>`
            : `<span class="px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 font-bold text-[10px] border border-rose-200 dark:border-rose-800">Sedang Dipinjam</span>`;

        return `
            <div class="bg-white dark:bg-slate-800 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-700 shadow-sm hover:shadow-xl hover:border-blue-500/50 transition-all flex flex-col justify-between group">
                <div>
                    <!-- Top Category & Status -->
                    <div class="flex items-center justify-between gap-2 mb-3">
                        <span class="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 font-mono font-bold text-[10px]">
                            ${escapeHTML(b.kategori_ddc)}
                        </span>
                        ${availableBadge}
                    </div>

                    <!-- Book Title -->
                    <h4 class="font-extrabold text-sm text-slate-900 dark:text-white line-clamp-2 leading-snug group-hover:text-blue-600 transition" title="${escapeHTML(b.judul)}">
                        ${escapeHTML(b.judul)}
                    </h4>

                    <!-- Author -->
                    <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-1">
                        <i class="fa-solid fa-user-pen text-[10px] text-slate-400 mr-1"></i> ${escapeHTML(b.pengarang || 'Anonim')}
                    </p>

                    <!-- Details preview -->
                    <div class="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700/60 text-[11px] text-slate-400 space-y-1">
                        <div class="flex items-center justify-between font-mono">
                            <span>Call Number:</span>
                            <span class="font-bold text-slate-700 dark:text-slate-300">${escapeHTML(b.call_number_dasar || '-')}</span>
                        </div>
                        <div class="flex items-center justify-between">
                            <span>Lokasi Rak:</span>
                            <span class="font-semibold text-slate-700 dark:text-slate-300">${escapeHTML(b.lokasi_rak || 'Rak Umum')}</span>
                        </div>
                    </div>
                </div>

                <!-- Action Button -->
                <div class="mt-4 pt-3">
                    <button onclick="window.showBookDetail(${b.id})" class="w-full py-2 px-3 rounded-xl bg-slate-50 dark:bg-slate-700/60 hover:bg-blue-600 hover:text-white dark:hover:bg-blue-600 text-slate-700 dark:text-slate-200 font-bold text-xs transition-all flex items-center justify-center gap-1.5 shadow-sm">
                        <i class="fa-solid fa-circle-info"></i> Lihat Rincian & Stok
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// =========================================================================
// 7. MODAL DETAIL BUKU & REALTIME EKSEMPLAR
// =========================================================================
window.showBookDetail = async function (bookId) {
    const book = allBooks.find(b => b.id === bookId);
    if (!book) return;

    const modal = document.getElementById('modal-opac-detail');
    const tbody = document.getElementById('detail-eksemplar-tbody');

    // Populate Metadata
    document.getElementById('detail-book-ddc-badge').textContent = `DDC ${book.kategori_ddc} - ${book.ddc_nama || ''}`;
    document.getElementById('detail-book-title').textContent = book.judul;
    document.getElementById('detail-book-author').textContent = book.pengarang_tambahan ? `${book.pengarang} (${book.pengarang_tambahan})` : (book.pengarang || 'Anonim');
    document.getElementById('detail-book-call').textContent = book.call_number_dasar || '-';
    document.getElementById('detail-book-rak').textContent = book.lokasi_rak || 'Rak Sirkulasi';
    document.getElementById('detail-book-penerbit').textContent = book.penerbit || '-';
    document.getElementById('detail-book-tahun').textContent = book.tahun_terbit ? `${book.tahun_terbit} (${book.kota_terbit || '-'})` : '-';
    document.getElementById('detail-book-isbn').textContent = book.isbn || '-';
    document.getElementById('detail-book-tipe').textContent = book.tipe_koleksi || 'Sirkulasi';
    document.getElementById('detail-book-stock-summary').textContent = `${book.eksemplar_tersedia} / ${book.total_eksemplar} Tersedia`;

    tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-slate-400 italic"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Memeriksa status eksemplar...</td></tr>';
    modal.classList.remove('hidden');

    try {
        // View OPAC hanya mengekspos status publik; nomor inventaris, barcode,
        // harga, dan sumber pengadaan tetap menjadi data internal petugas.
        const { data: eksemplarList, error } = await supabase
            .from('lib_opac_eksemplar')
            .select('buku_id, copy_number, call_number_lengkap, status, kondisi, tgl_jatuh_tempo')
            .eq('buku_id', book.id)
            .order('copy_number', { ascending: true });

        if (error) throw error;

        if (!eksemplarList || eksemplarList.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-slate-400 italic">Belum ada salinan fisik yang terdaftar untuk judul ini.</td></tr>';
            return;
        }

        tbody.innerHTML = eksemplarList.map(e => {
            let statusText = '';
            if (e.status === 'tersedia') {
                statusText = `<span class="px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 font-bold text-[10px] border border-emerald-200">Tersedia di Rak</span>`;
            } else if (e.status === 'dipinjam') {
                const dueDateText = e.tgl_jatuh_tempo ? ` (sd ${formatDateIndo(e.tgl_jatuh_tempo)})` : '';
                statusText = `<span class="px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 font-bold text-[10px] border border-amber-200">Dipinjam${dueDateText}</span>`;
            } else {
                statusText = `<span class="px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 font-bold text-[10px] border border-rose-200">${e.status}</span>`;
            }

            return `
                <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition text-xs">
                    <td class="px-4 py-2.5 font-bold text-slate-800 dark:text-white">Copy ${e.copy_number}</td>
                    <td class="px-4 py-2.5 text-slate-600 dark:text-slate-400 capitalize">${escapeHTML((e.kondisi || '-').replaceAll('_', ' '))}</td>
                    <td class="px-4 py-2.5 font-mono text-blue-600 dark:text-blue-400 font-bold">${escapeHTML(e.call_number_lengkap || '-')}</td>
                    <td class="px-4 py-2.5 text-right whitespace-nowrap">${statusText}</td>
                </tr>
            `;
        }).join('');

    } catch (e) {
        console.error('[OPAC] Error load eksemplar detail:', e);
        tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-rose-500">Gagal memuat status eksemplar.</td></tr>';
    }
};

// =========================================================================
// 8. PINJAMAN SAYA - RESOLVE USER IDENTITY
// =========================================================================
/**
 * Resolve peminjam_id (NIS untuk siswa, NIP untuk guru/staff) dari user yang login.
 * Hemat Firestore read: hanya 1 read (users doc) + 1 read opsional (teacher doc via cache).
 */
async function resolveMyPeminjamId(user, role) {
    try {
        // 1. Cek apakah siswa (ada session NIS dari portal siswa)
        const studentNIS = sessionStorage.getItem('student_nis');
        if (studentNIS) return studentNIS;

        // 2. Cek apakah guru/staff (resolve NIP via getLinkedTeacherForUser cache)
        if (window.getLinkedTeacherForUser) {
            // Ambil userData dari Firestore (1 read, sudah dilakukan oleh initLayout)
            const userDocRef = doc(db, PATHS.users, user.uid);
            const userSnap = await getDoc(userDocRef);
            const userData = userSnap.exists() ? userSnap.data() : {};

            const teacherObj = await window.getLinkedTeacherForUser(user, userData);
            if (teacherObj && teacherObj.data) {
                const nip = teacherObj.data.nip || '';
                if (nip) return nip;
            }

            // Fallback: NIP dari userData langsung
            if (userData.nip) return userData.nip;
        }

        return '';
    } catch (e) {
        console.warn('[OPAC] Error resolve peminjam ID:', e);
        return '';
    }
}

// =========================================================================
// 9. PINJAMAN SAYA - LOAD & RENDER
// =========================================================================
async function loadMyLoans() {
    const section = document.getElementById('section-pinjaman-saya');
    const activePanel = document.getElementById('my-loans-active-panel');
    const historyPanel = document.getElementById('my-loans-history-panel');
    const countActive = document.getElementById('my-loans-count-active');
    const countReturned = document.getElementById('my-loans-count-returned');

    if (!myPeminjamId || !section) return;

    // Tampilkan section
    section.classList.remove('hidden');

    try {
        const { data, error } = await supabase
            .from('lib_sirkulasi')
            .select(`
                *,
                buku:lib_buku (id, judul, pengarang, penerbit, lokasi_rak),
                eksemplar:lib_eksemplar (id, nomor_induk, kode_barcode, copy_number)
            `)
            .eq('peminjam_id', String(myPeminjamId))
            .order('created_at', { ascending: false });

        if (error) throw error;

        const allLoans = data || [];
        const activeLoans = allLoans.filter(l => l.status === 'dipinjam');
        const returnedLoans = allLoans.filter(l => l.status === 'kembali');

        // Update counts
        if (countActive) countActive.textContent = activeLoans.length;
        if (countReturned) countReturned.textContent = returnedLoans.length;

        // Render Active Loans
        renderMyActiveLoans(activePanel, activeLoans);
        // Render History
        renderMyHistoryLoans(historyPanel, returnedLoans);

    } catch (e) {
        console.error('[OPAC] Error load my loans:', e);
        if (activePanel) activePanel.innerHTML = '<div class="p-6 text-center text-rose-500 text-xs">Gagal memuat data pinjaman.</div>';
    }
}

function renderMyActiveLoans(container, loans) {
    if (!container) return;

    if (loans.length === 0) {
        container.innerHTML = `
            <div class="p-8 text-center text-slate-400">
                <i class="fa-solid fa-book-bookmark text-3xl mb-2 text-slate-300 dark:text-slate-600"></i>
                <p class="text-xs font-medium">Tidak ada buku yang sedang dipinjam saat ini.</p>
                <p class="text-[10px] text-slate-400 mt-0.5">Jelajahi katalog di bawah dan pinjam buku di meja sirkulasi perpustakaan.</p>
            </div>
        `;
        return;
    }

    const todayStr = getLocalISODate();

    container.innerHTML = loans.map(l => {
        const isLate = l.tgl_jatuh_tempo && l.tgl_jatuh_tempo < todayStr;
        const lateDays = isLate
            ? countChargeableLateDays(l.tgl_jatuh_tempo, todayStr, {
                ignoreHolidays: opacIgnoreHolidays,
                holidays: publicLibraryHolidays
            })
            : 0;
        const rawTarif = (l.tarif_denda_per_hari !== null && l.tarif_denda_per_hari !== undefined)
            ? Number(l.tarif_denda_per_hari)
            : 1000;
        const tarifVal = Number.isNaN(rawTarif) ? 1000 : rawTarif;
        const dendaEst = lateDays * tarifVal;

        return `
            <div class="p-3.5 sm:p-4 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition flex flex-col sm:flex-row justify-between sm:items-center gap-2">
                <div class="min-w-0">
                    <div class="font-bold text-slate-800 dark:text-white text-xs sm:text-sm leading-tight truncate">${escapeHTML(l.buku?.judul || 'Buku')}</div>
                    <div class="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span><i class="fa-solid fa-user-pen text-[10px] text-blue-500 mr-0.5"></i>${escapeHTML(l.buku?.pengarang || 'Anonim')}</span>
                        <span class="text-slate-300 dark:text-slate-600">&bull;</span>
                        <span class="font-mono text-slate-400 dark:text-slate-500">${escapeHTML(l.eksemplar?.kode_barcode || l.eksemplar?.nomor_induk || '-')}</span>
                    </div>
                    <div class="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex flex-wrap items-center gap-2">
                        <span>Pinjam: <b>${formatDateIndo(l.tgl_pinjam) || '-'}</b></span>
                        <span class="text-slate-300 dark:text-slate-600">&bull;</span>
                        <span class="${isLate ? 'text-rose-600 dark:text-rose-400 font-bold' : ''}">Jatuh Tempo: <b>${formatDateIndo(l.tgl_jatuh_tempo) || '-'}</b></span>
                    </div>
                </div>
                <div class="shrink-0 text-left sm:text-right">
                    ${isLate ? `
                        <span class="px-2.5 py-1 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 font-bold text-[10px] inline-flex items-center gap-1">
                            <i class="fa-solid fa-triangle-exclamation"></i> Terlambat ${lateDays} Hari
                        </span>
                        <div class="text-[10px] ${dendaEst > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'} font-bold mt-1">${dendaEst > 0 ? `Est. Denda: Rp ${dendaEst.toLocaleString('id-ID')}` : 'Bebas Denda'}</div>
                    ` : `
                        <span class="px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800 font-bold text-[10px] inline-flex items-center gap-1">
                            <i class="fa-solid fa-clock"></i> Masa Pinjam Aktif
                        </span>
                    `}
                </div>
            </div>
        `;
    }).join('');
}

function renderMyHistoryLoans(container, loans) {
    if (!container) return;

    if (loans.length === 0) {
        container.innerHTML = '<div class="p-6 text-center text-slate-400 dark:text-slate-500 italic text-xs">Belum ada riwayat pengembalian buku.</div>';
        return;
    }

    container.innerHTML = loans.map(l => {
        const hadFine = l.total_denda && Number(l.total_denda) > 0;
        return `
            <div class="p-3 sm:p-3.5 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition flex flex-col sm:flex-row justify-between sm:items-center gap-1.5 text-xs">
                <div class="min-w-0">
                    <div class="font-semibold text-slate-800 dark:text-slate-200 truncate">${escapeHTML(l.buku?.judul || 'Buku')}</div>
                    <div class="text-[10px] text-slate-400 dark:text-slate-500 flex flex-wrap items-center gap-1.5 mt-0.5">
                        <span>Pinjam: ${formatDateIndo(l.tgl_pinjam) || '-'}</span>
                        <span class="text-slate-300 dark:text-slate-600">&bull;</span>
                        <span>Kembali: ${formatDateIndo(l.tgl_kembali) || '-'}</span>
                        ${hadFine ? `<span class="text-slate-300 dark:text-slate-600">&bull;</span><span class="text-amber-600 dark:text-amber-400 font-bold">Denda: Rp ${Number(l.total_denda).toLocaleString('id-ID')}</span>` : ''}
                    </div>
                </div>
                <span class="shrink-0 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 font-bold text-[10px] border border-emerald-200 dark:border-emerald-800 inline-flex items-center gap-1">
                    <i class="fa-solid fa-check-circle text-[9px]"></i> Kembali
                </span>
            </div>
        `;
    }).join('');
}

// =========================================================================
// 10. PINJAMAN SAYA - TAB SWITCH
// =========================================================================
window.switchMyLoanTab = function (tab) {
    const activePanel = document.getElementById('my-loans-active-panel');
    const historyPanel = document.getElementById('my-loans-history-panel');
    const btnActive = document.getElementById('btn-my-tab-active');
    const btnHistory = document.getElementById('btn-my-tab-history');

    if (tab === 'active') {
        activePanel.classList.remove('hidden');
        historyPanel.classList.add('hidden');
        btnActive.className = 'flex-1 py-2.5 text-xs font-bold text-blue-700 dark:text-blue-400 border-b-2 border-blue-600 transition';
        btnHistory.className = 'flex-1 py-2.5 text-xs font-bold text-slate-400 dark:text-slate-500 border-b-2 border-transparent hover:text-slate-600 transition';
    } else {
        activePanel.classList.add('hidden');
        historyPanel.classList.remove('hidden');
        btnActive.className = 'flex-1 py-2.5 text-xs font-bold text-slate-400 dark:text-slate-500 border-b-2 border-transparent hover:text-slate-600 transition';
        btnHistory.className = 'flex-1 py-2.5 text-xs font-bold text-blue-700 dark:text-blue-400 border-b-2 border-blue-600 transition';
    }
};

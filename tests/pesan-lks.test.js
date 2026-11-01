/**
 * tests/pesan-lks.test.js
 * Unit Test Khusus Modul Matriks Pesan LKS (Admin Kelas) & Sinkronisasi Penjualan Buku (Admin LKS / Super Admin)
 * Memverifikasi: RBAC, Paritas Otorisasi, Tabel Matriks Siswa x Buku, Distribusi Bertahap, dan Pemilihan Rombel Dinamis
 */

const fs = require('fs');
const path = require('path');

describe('Modul Pesan LKS & Sinkronisasi Penjualan Buku', () => {
    const htmlPath = path.resolve(process.cwd(), 'pesan-lks.html');
    const jsPath = path.resolve(process.cwd(), 'js/page-pesan-lks.js');
    const globalJsPath = path.resolve(process.cwd(), 'js/global.js');
    const penjualanBukuHtmlPath = path.resolve(process.cwd(), 'penjualan-buku.html');
    const pagePenjualanBukuJsPath = path.resolve(process.cwd(), 'js/page-penjualan-buku.js');

    test('1. Integritas HTML Pesan LKS: Elemen Utama, Matriks 2 Tab & Aturan Anti-Nesting Modal', () => {
        expect(fs.existsSync(htmlPath)).toBe(true);
        const html = fs.readFileSync(htmlPath, 'utf8');

        // Layout injection & Access denied
        expect(html).toContain('id="app-layout"');
        expect(html).toContain('id="access-denied-container"');
        expect(html).toContain('<main');

        // Header Actions (Tombol Saran Global Feedback & Refresh Data)
        expect(html).toContain('id="btn-global-chat-feedback"');
        expect(html).toContain('openGlobalFeedbackModal');
        expect(html).toContain('id="btn-refresh"');

        // 3 KPI Cards Matriks (Total Nilai Tagihan menggantikan distribusi serah terima fisik)
        expect(html).toContain('id="kpi-total-students"');
        expect(html).toContain('id="kpi-total-ordered-books"');
        expect(html).toContain('id="kpi-total-matrix-value"');
        expect(html).not.toContain('id="kpi-total-received-books"');

        // Tab buttons & panels (Tab 1: Matriks Pemesanan, Tab 2: Rekap & Kwitansi Siswa - Distribusi dihapus)
        expect(html).toContain('id="tab-btn-matrix-order"');
        expect(html).not.toContain('id="tab-btn-matrix-distribution"');
        expect(html).toContain('id="tab-btn-matrix-rekap"');
        expect(html).toContain('id="tab-panel-matrix-order"');
        expect(html).not.toContain('id="tab-panel-matrix-distribution"');
        expect(html).toContain('id="tab-panel-matrix-rekap"');

        // Tabel Matriks
        expect(html).toContain('id="table-order-matrix"');
        expect(html).not.toContain('id="table-distribution-matrix"');
        expect(html).toContain('id="table-rekap-body"');

        // Modal di luar <main> (Modal Anti-Nesting Mandate)
        const mainCloseIndex = html.indexOf('</main>');
        const modalConfirmIndex = html.indexOf('id="modal-confirm-matrix"');

        expect(mainCloseIndex).toBeGreaterThan(-1);
        expect(modalConfirmIndex).toBeGreaterThan(mainCloseIndex);
    });

    test('2. Anti-Overlapping Icon Mandate & Desain Sticky Header Matriks', () => {
        const html = fs.readFileSync(htmlPath, 'utf8');

        // Memastikan tidak ada leading icon tumpang tindih pada input atau select
        expect(html).not.toMatch(/id="header-class-select"[^>]*pl-(?:9|10)/);

        // Memastikan kolom nama siswa memiliki sticky position untuk scroll horisontal mulus
        expect(html).toContain('sticky left-0');
        expect(html).toMatch(/sticky\s+(?:left-0\s+)?sm:left-10|sticky\s+left-10/);
    });

    test('3. Konfigurasi RBAC di global.js: Menu & Izin Akses Halaman', () => {
        const globalJs = fs.readFileSync(globalJsPath, 'utf8');

        // Pastikan pesan_lks terdaftar di MENU_CONFIG admin_kelas dan super_admin
        expect(globalJs).toMatch(/'admin_kelas':\s*\[[^\]]*'pesan_lks'[^\]]*\]/);
        expect(globalJs).toContain("'pesan_lks'");

        // Pastikan PAGE_ACCESS_CONFIG untuk pesan-lks.html hanya mengizinkan admin_kelas dan super_admin
        expect(globalJs).toContain("'pesan-lks.html': {");
        expect(globalJs).toMatch(/'pesan-lks\.html':\s*\{[^}]*'super_admin':\s*'rw'/);
        expect(globalJs).toMatch(/'pesan-lks\.html':\s*\{[^}]*'admin_kelas':\s*'rw'/);
        expect(globalJs).toMatch(/'pesan-lks\.html':\s*\{[^}]*'admin_lks':\s*'x'/);
        expect(globalJs).toMatch(/'pesan-lks\.html':\s*\{[^}]*'siswa':\s*'x'/);
    });

    test('4. Sinkronisasi di penjualan-buku.html: Tab, Penghapusan Card/Banner Redundan & Kolom Pemenuhan Pesanan Kelas', () => {
        const html = fs.readFileSync(penjualanBukuHtmlPath, 'utf8');

        expect(html).toContain('id="tab-btn-orders"');
        expect(html).toContain('id="tab-panel-orders"');
        expect(html).toContain('id="orders-badge-count"');
        expect(html).toContain('id="table-orders-body"');

        // Banner teks, 3 Kartu KPI & filter status telah dihapus agar tampilan ringkas langsung ke tabel data
        expect(html).not.toContain('id="kpi-orders-total-qty"');
        expect(html).not.toContain('id="kpi-orders-delivered-qty"');
        expect(html).not.toContain('id="kpi-orders-deficit-qty"');
        expect(html).not.toContain('Monitoring Selisih Pemesanan vs Distribusi Kelas');

        // Header Kolom Pemenuhan Buku (Dipesan, Sudah Diberikan, Selisih Kebutuhan)
        expect(html).toContain('Dipesan');
        expect(html).toContain('Sudah Diberikan');
        expect(html).toContain('Selisih Kebutuhan');
    });

    test('5. Logika Modul Matriks di js/page-pesan-lks.js', () => {
        expect(fs.existsSync(jsPath)).toBe(true);
        const jsContent = fs.readFileSync(jsPath, 'utf8');

        // Verifikasi fungsi-fungsi esensial diekspor
        expect(jsContent).toContain('export function formatRupiah(');
        expect(jsContent).toContain('export function getGradeRoman(');
        expect(jsContent).toContain('export function extractGradeFromClassName(');
        expect(jsContent).toContain('export function switchTab(');
        expect(jsContent).toContain('export function calculateMatrixSummary(');
        expect(jsContent).toContain('export function onMatrixOrderCheckChanged(');
        expect(jsContent).toContain('export function toggleDistributionStatus(');
        expect(jsContent).toContain('export async function saveClassMatrixData(');
        expect(jsContent).toContain('export async function syncMatrixToMasterBookOrders(');
        expect(jsContent).toContain('export async function initPesanLksPage(');

        // Verifikasi SSOT Cloudflare D1 key
        expect(jsContent).toContain("BOOK_SALES_D1_KEY = 'book_sales_lks_data'");
        expect(jsContent).toContain("ORDERS_D1_KEY = 'book_orders_data'");
    });

    test('6. Logika Manajemen Pesanan di js/page-penjualan-buku.js', () => {
        const jsContent = fs.readFileSync(pagePenjualanBukuJsPath, 'utf8');

        // Memastikan fungsi persetujuan, penolakan, fulfillment, dan perhitungan pemenuhan tersedia
        expect(jsContent).toContain('export function renderOrdersManagementTable()');
        expect(jsContent).toContain('export function getDeliveredQtyForOrder(');
        expect(jsContent).toContain('export function updateOrdersKpis()');
        expect(jsContent).toContain('window.approveClassOrder = async function');
        expect(jsContent).toContain('window.rejectClassOrder = async function');
        expect(jsContent).toContain('window.fulfillClassOrder = async function');
        expect(jsContent).toContain('window.getDeliveredQtyForOrder = getDeliveredQtyForOrder;');
        expect(jsContent).toContain('window.updateOrdersKpis = updateOrdersKpis;');
        expect(jsContent).toContain('window.onOrderStatusFilterChanged');
        expect(jsContent).toContain("ORDERS_D1_KEY = 'book_orders_data'");
    });

    test('7. Kontrol Rombel Dinamis: Super Admin Bebas Pilih Rombel, Admin Kelas Terkunci', () => {
        const html = fs.readFileSync(htmlPath, 'utf8');
        const jsContent = fs.readFileSync(jsPath, 'utf8');

        // HTML memiliki pemilih rombel di header dan badge rombel aktif
        expect(html).toContain('id="header-superadmin-class-picker"');
        expect(html).toContain('id="header-class-select"');
        expect(html).toContain('id="header-class-name"');

        // JS memiliki logika percabangan pemilihan rombel
        expect(jsContent).toContain('export async function getMasterClasses(');
        expect(jsContent).toContain('export async function onActiveClassChanged(');
        expect(jsContent).toContain("effectiveRole === 'super_admin'");
        expect(jsContent).toContain("pickerSuperAdmin.classList.remove('hidden')");
    });

    test('8. Struktur Data Matriks dan Siklus Hidup Penyerahan Fisik Bertahap', () => {
        const jsContent = fs.readFileSync(jsPath, 'utf8');

        // Memastikan status penyerahan fisik mencatat timestamp dan status boolean
        expect(jsContent).toContain('currentMatrixData[nis]?.books?.[subject]');
        expect(jsContent).toContain('entry.received = newStatus;');
        expect(jsContent).toContain('entry.receivedAt = newStatus ? new Date().toISOString() : null;');
        expect(jsContent).toContain('toggleAllColumnOrders');
        expect(jsContent).toContain('markAllColumnReceived');
    });

    test('9. Optimalisasi Antarmuka Mobile (HP): Sticky Bar, Mode Kartu Siswa, Pencarian & Salin Tagihan WA', () => {
        const html = fs.readFileSync(htmlPath, 'utf8');
        const jsContent = fs.readFileSync(jsPath, 'utf8');

        // Sticky Summary Bar khusus layar HP
        expect(html).toContain('id="mobile-quick-summary-bar"');
        expect(html).toContain('id="mobile-quick-books"');
        expect(html).toContain('id="mobile-quick-value"');

        // Kontainer Kartu Siswa di kedua tab aktif (Tab Distribusi telah dihapus)
        expect(html).toContain('id="cards-matrix-order-list"');
        expect(html).not.toContain('id="cards-matrix-dist-list"');
        expect(html).toContain('id="cards-rekap-list"');

        // Input pencarian siswa & toggle view di toolbar
        expect(html).toContain('input-student-search');
        expect(html).toContain('btn-view-cards-toggle');
        expect(html).toContain('btn-view-table-toggle');

        // Fungsi-fungsi pembantu UX mobile di JS
        expect(jsContent).toContain('export function setViewMode(');
        expect(jsContent).toContain('export function onStudentSearchInput(');
        expect(jsContent).toContain('export function clearStudentSearch(');
        expect(jsContent).toContain('export function toggleStudentAllBooks(');
        expect(jsContent).toContain('export function markStudentAllReceived(');
        expect(jsContent).toContain('export function copyStudentBillSummary(');

        // Verifikasi ekspos ke window
        expect(jsContent).toContain('window.setViewMode = setViewMode;');
        expect(jsContent).toContain('window.onStudentSearchInput = onStudentSearchInput;');
        expect(jsContent).toContain('window.clearStudentSearch = clearStudentSearch;');
        expect(jsContent).toContain('window.toggleStudentAllBooks = toggleStudentAllBooks;');
        expect(jsContent).toContain('window.markStudentAllReceived = markStudentAllReceived;');
        expect(jsContent).toContain('window.copyStudentBillSummary = copyStudentBillSummary;');
    });

    test('10. Tata Letak Total Buku & Tagihan di Bawah Nama Siswa (NIS Dihilangkan)', () => {
        const html = fs.readFileSync(htmlPath, 'utf8');
        const jsContent = fs.readFileSync(jsPath, 'utf8');

        // Di HTML: Header matriks pemesanan tidak boleh memiliki kolom terpisah Total Buku & Total Tagihan di kanan
        expect(html).not.toMatch(/id="table-matrix-order-header-row"[^>]*>[\s\S]*<th[^>]*>Total Buku<\/th>/i);
        expect(html).not.toMatch(/id="table-matrix-order-header-row"[^>]*>[\s\S]*<th[^>]*>Total Tagihan<\/th>/i);
        expect(html).toContain('Total Buku & Tagihan');

        // Di JS renderMatrixOrderTable:
        // - Nama siswa memuat total buku (eks) dan total tagihan singkat
        // - Kolom nama siswa tidak memuat label NIS di antarmuka
        const orderTableSnippet = jsContent.match(/function renderMatrixOrderTable\(\)[\s\S]*?\n\}/)?.[0] || '';
        expect(orderTableSnippet).toContain('${studentTotalBooks} eks');
        expect(orderTableSnippet).toContain('${formatShortPrice(studentTotalValue)}');
        expect(orderTableSnippet).not.toContain('NIS:');

        // Di JS renderMatrixOrderCards:
        // - Kartu siswa juga memuat total buku dan tagihan ringkas 1 baris
        // - Kartu siswa tidak memuat label NIS di antarmuka
        const orderCardsSnippet = jsContent.match(/function renderMatrixOrderCards\(\)[\s\S]*?\n\}/)?.[0] || '';
        expect(orderCardsSnippet).toContain('${studentTotalBooks} eks');
        expect(orderCardsSnippet).toContain('${formatShortPrice(studentTotalValue)}');
        expect(orderCardsSnippet).not.toContain('NIS:');
    });

    test('11. Top Synchronized Scrollbar & Tombol Geser Horizontal Cepat Matriks', () => {
        const html = fs.readFileSync(htmlPath, 'utf8');
        const jsContent = fs.readFileSync(jsPath, 'utf8');

        // HTML memuat kontainer scrollbar atas tersinkronisasi di Tab 1 Matriks Pemesanan
        expect(html).toContain('id="top-scrollbar-container-order"');
        expect(html).toContain('id="top-scrollbar-track-order"');
        expect(html).not.toContain('id="top-scrollbar-container-dist"');
        expect(html).not.toContain('id="top-scrollbar-track-dist"');

        // HTML memuat tombol geser horisontal cepat pada matriks pemesanan
        expect(html).toMatch(/scrollMatrixHorizontally\?\.?\('table-order-matrix',\s*-?(?:280|350)\)/);
        expect(html).toContain('id="btn-scroll-matrix-left"');
        expect(html).toContain('id="btn-scroll-matrix-right"');
        expect(html).not.toContain("scrollMatrixHorizontally?.('table-distribution-matrix'");

        // JS mengekspor dan mengimplementasikan fungsi sinkronisasi scroll
        expect(jsContent).toContain('export function scrollMatrixHorizontally(');
        expect(jsContent).toContain('export function syncTopScrollbar(');
        expect(jsContent).toContain('export function syncAllMatrixScrollbars(');

        // Window exports terpasang
        expect(jsContent).toContain('window.scrollMatrixHorizontally = scrollMatrixHorizontally;');
        expect(jsContent).toContain('window.syncTopScrollbar = syncTopScrollbar;');
        expect(jsContent).toContain('window.syncAllMatrixScrollbars = syncAllMatrixScrollbars;');
    });

    test('12. Perampingan Lebar Header Mapel & Penghapusan Tombol Centang Semua / X pada Matriks Pemesanan', () => {
        const jsContent = fs.readFileSync(jsPath, 'utf8');

        // Fungsi renderMatrixOrderTable harus memiliki header mapel yang ramping
        const orderTableSnippet = jsContent.match(/function renderMatrixOrderTable\(\)[\s\S]*?\n\}/)?.[0] || '';
        expect(orderTableSnippet).toContain('min-w-[64px]');
        expect(orderTableSnippet).toContain('line-clamp-2');

        // Tombol [✓ Semua] dan [✕] di header kolom pemesanan telah dihapus sesuai instruksi
        expect(orderTableSnippet).not.toContain('[✓ Semua]');
        expect(orderTableSnippet).not.toContain('toggleAllColumnOrders');

        // Fungsi renderMatrixDistributionTable juga memiliki header mapel yang lebih ramping
        const distTableSnippet = jsContent.match(/function renderMatrixDistributionTable\(\)[\s\S]*?\n\}/)?.[0] || '';
        expect(distTableSnippet).toContain('min-w-[76px]');
        expect(distTableSnippet).toContain('line-clamp-2');
    });

    test('13. Default Mode Tabel, Hapus Petunjuk LKS, Sembunyikan No di HP, Format Mapel & Harga Singkat', () => {
        const html = fs.readFileSync(htmlPath, 'utf8');
        const jsContent = fs.readFileSync(jsPath, 'utf8');

        // 1. Petunjuk pemesanan LKS telah dihapus dari HTML
        expect(html).not.toContain('Petunjuk Pemesanan Buku LKS Rombel:');
        expect(html).toContain('id="matrix-order-status-badge"');

        // 2. Default tampil dalam mode tabel (kontainer kartu default hidden, kontainer tabel aktif)
        expect(html).toContain('id="container-matrix-order-cards" class="hidden space-y-2.5"');
        expect(html).toContain('id="container-matrix-order-table" class="space-y-1.5"');
        expect(jsContent).toContain("let currentViewMode = 'table';");

        // 3. Kolom No disembunyikan di HP (hidden sm:table-cell) & sticky Nama Siswa left-0 sm:left-10
        expect(html).toContain('hidden sm:table-cell');
        expect(jsContent).toContain('hidden sm:table-cell');
        expect(jsContent).toContain('sticky left-0 sm:left-10');

        // 4. Kolom nama dibuat lebih pendek dengan truncate
        expect(jsContent).toContain('min-w-[105px] max-w-[125px]');
        expect(jsContent).toContain('truncate');

        // 5. Format nama mapel panjang [depan]...[belakang]
        expect(jsContent).toContain('export function formatSubjectDisplayName(');
        expect(jsContent).toContain('formatSubjectDisplayName(book.subject)');
        // 6. Format harga singkat (17rb, 23rb, dst.)
        expect(jsContent).toContain('export function formatShortPrice(');
        expect(jsContent).toContain('formatShortPrice(book.harga)');
    });

    test('14. Deteksi Realisasi Buku LKS: Perhitungan Selisih Kebutuhan Otomatis dari Transaksi Penjualan Tanpa Kerja Ganda', () => {
        const jsPenjualanContent = fs.readFileSync(pagePenjualanBukuJsPath, 'utf8');

        // Memastikan formula realisasi dan KPI menghitung pesanan vs transaksi net secara SSOT
        expect(jsPenjualanContent).toContain('export function getDeliveredQtyForOrder(order)');
        expect(jsPenjualanContent).toContain('export function updateOrdersKpis()');
        expect(jsPenjualanContent).toContain('const diff = orderedQty - deliveredQty;');
        expect(jsPenjualanContent).toContain('Kurang ${diff} eks');
        expect(jsPenjualanContent).toContain('Lengkap (0)');
    });

    test('15. Ergonomi Mobile: Tombol Simpan di Atas Tabel & Alert Unsaved Changes saat Pemesanan Belum Disimpan', () => {
        const html = fs.readFileSync(htmlPath, 'utf8');
        const jsContent = fs.readFileSync(jsPath, 'utf8');

        // 1. Verifikasi tombol simpan sebelah atas di toolbar telah dihapus agar tidak ada tombol ganda
        expect(html).not.toContain('id="btn-save-matrix-toolbar"');

        // Tombol simpan di header disembunyikan di mobile (hidden sm:flex) agar tidak ada tombol dobel/tripel
        expect(html).toMatch(/id="btn-save-matrix"[^>]*class="[^"]*hidden sm:flex[^"]*"/);

        // 2. Verifikasi alert bar atas (top save bar) yang menjadi satu-satunya tombol simpan saat ada perubahan
        expect(html).toContain('id="top-save-bar-order"');
        expect(html).toContain('Terdapat perubahan pemesanan yang belum disimpan!');
        expect(html).toContain('fa-circle-exclamation text-amber-300 animate-bounce');
        expect(html).toContain('id="btn-top-save-order"');
        expect(html).toContain('Simpan Sekarang');

        // 3. Verifikasi fungsi state setMatrixOrderDirty & proteksi navigasi beforeunload
        expect(jsContent).toContain('export function setMatrixOrderDirty(dirty)');
        expect(jsContent).toContain("topSaveBar.classList.remove('hidden')");
        expect(jsContent).toContain("btnSaveHeader.classList.add('ring-2', 'ring-emerald-300')");
        expect(jsContent).toContain("window.addEventListener('beforeunload'");
        expect(jsContent).toContain('window.setMatrixOrderDirty = setMatrixOrderDirty;');
        expect(jsContent).toContain('window.isMatrixOrderDirty = () => isMatrixOrderDirty;');
    });

    test('16. Format Compact Tab Kartu Siswa di HP: Mapel & Harga 1 Baris Sejajar & Grid 2 Kolom', () => {
        const jsContent = fs.readFileSync(jsPath, 'utf8');

        // Verifikasi fungsi renderMatrixOrderCards menghasilkan chip 1 baris (mapel + harga berdampingan)
        const orderCardsSnippet = jsContent.match(/function renderMatrixOrderCards\(\)[\s\S]*?\n\}/)?.[0] || '';
        expect(orderCardsSnippet).toBeTruthy();

        // 1. Grid tetap muat 2 card mapel per baris di HP (grid-cols-2) dengan gap rapat hemat ruang
        expect(orderCardsSnippet).toContain('grid grid-cols-2 sm:grid-cols-3 gap-1 sm:gap-1.5');

        // 2. Chip mapel dan harga berada dalam 1 baris sejajar (flex items-center justify-between)
        expect(orderCardsSnippet).toContain('flex items-center justify-between gap-1 leading-none');

        // 3. Nama mapel menggunakan format displayName ringkas dan harga singkat formatShortPrice
        expect(orderCardsSnippet).toContain('formatSubjectDisplayName(book.subject)');
        expect(orderCardsSnippet).toContain('formatShortPrice(book.harga)');

        // 4. Checkbox dan chip berukuran ultra-compact pendek dan touch-friendly
        expect(orderCardsSnippet).toContain('py-1 px-1.5 sm:py-1.5 sm:px-2 rounded-lg');
        expect(orderCardsSnippet).toContain('w-3.5 h-3.5');

        // 5. Header kartu siswa (nama siswa, rekap eks & total harga) kini 1 baris sejajar (anti 2-baris vertikal)
        expect(orderCardsSnippet).toContain('min-w-0 flex-1 flex items-center gap-1.5 truncate');
        expect(orderCardsSnippet).toContain('leading-none');
    });

    test('17. Format Ultra-Compact Baris Tabel Matriks Pemesanan: Jarak Antar Baris Pendek & Hemat Ruang Vertikal', () => {
        const html = fs.readFileSync(htmlPath, 'utf8');
        const jsContent = fs.readFileSync(jsPath, 'utf8');

        // 1. CSS styling tabel matriks membatasi padding vertikal sel rapat
        expect(html).toContain('#table-order-matrix tbody td');
        expect(html).toContain('padding-top: 3px !important;');
        expect(html).toContain('padding-bottom: 3px !important;');

        // 2. JS renderMatrixOrderTable menggunakan padding compact dan label touch ringkas
        const orderTableSnippet = jsContent.match(/function renderMatrixOrderTable\(\)[\s\S]*?\n\}/)?.[0] || '';
        expect(orderTableSnippet).toContain('py-0.5 sm:py-1');
        expect(orderTableSnippet).toContain('w-6 h-6 sm:w-7 sm:h-7');
        expect(orderTableSnippet).toContain('leading-tight');
    });

    test('18. Paritas Kolom Footer & Header Matriks: Presisi Scrolling Horisontal Tanpa Colspan Rusak di Layar HP', () => {
        const jsContent = fs.readFileSync(jsPath, 'utf8');

        const orderTableSnippet = jsContent.match(/function renderMatrixOrderTable\(\)[\s\S]*?\n\}/)?.[0] || '';
        expect(orderTableSnippet).toBeTruthy();

        // 1. Footer tidak boleh menggunakan colspan="2" karena kolom No di-hide di layar HP
        expect(orderTableSnippet).not.toContain('<td colspan="2"');

        // 2. Footer kolom No menggunakan hidden sm:table-cell persis seperti header dan body
        expect(orderTableSnippet).toContain('hidden sm:table-cell py-1 px-1.5 sm:px-2 text-center');

        // 3. Footer kolom TOTAL sejajar dengan kolom Nama Siswa (sticky left-0 sm:left-10)
        expect(orderTableSnippet).toContain('sticky left-0 sm:left-10 z-30');
        expect(orderTableSnippet).toContain('min-w-[105px] max-w-[125px] sm:min-w-[190px]');
    });

    test('19. Mode Mobile Ergonomi: Tombol Saran di Samping Garis Tiga Atas & 3 Kartu KPI Tersembunyi di Layar HP', () => {
        const html = fs.readFileSync(htmlPath, 'utf8');
        const globalJs = fs.readFileSync(globalJsPath, 'utf8');

        // 1. Tombol Saran di header kartu modul disembunyikan di HP (hidden sm:flex) agar tidak memadati header kartu
        expect(html).toMatch(/id="btn-global-chat-feedback"[^>]*class="[^"]*hidden sm:flex/);

        // 2. 3 Kartu KPI di bawah header disembunyikan di HP (hidden sm:grid) agar langsung fokus ke matriks
        expect(html).toMatch(/class="[^"]*hidden sm:grid[^"]*grid-cols-3[^"]*"/);
        expect(html).toContain('id="kpi-total-students"');
        expect(html).toContain('id="kpi-total-ordered-books"');
        expect(html).toContain('id="kpi-total-matrix-value"');

        // 3. Global JS injectChatIcon menginjeksi mobile-chat-feedback-btn di samping tombol hamburger garis tiga (menuBtn)
        expect(globalJs).toContain('chatBtn.id = \'mobile-chat-feedback-btn\';');
        expect(globalJs).toContain('menuBtn.parentNode.insertBefore(chatBtn, menuBtn);');
        // Pastikan injeksi mobile nav tidak terblokir oleh keberadaan btn-global-chat-feedback di desktop
        const injectFn = globalJs.match(/function injectChatIcon\(\)\s*\{[\s\S]*?\n\}/)?.[0] || '';
        expect(injectFn).toBeTruthy();
        const mobileNavIndex = injectFn.indexOf('mobileNav.querySelector(\'button\')');
        const desktopCheckIndex = injectFn.indexOf("document.getElementById('btn-global-chat-feedback')");
        expect(mobileNavIndex).toBeGreaterThan(-1);
        expect(desktopCheckIndex).toBeGreaterThan(mobileNavIndex);
    });

    test('20. Minimalisme Header & Paritas UI Mobile: Judul Ringkas Pesan LKS, Superadmin Picker Bersih, & Kartu (HP) 1 Baris', () => {
        const html = fs.readFileSync(htmlPath, 'utf8');
        const jsContent = fs.readFileSync(jsPath, 'utf8');

        // 1. Judul halaman disederhanakan menjadi "Pesan LKS"
        expect(html).toContain('<span>Pesan LKS</span>');
        expect(html).not.toContain('<span>Pesan & Distribusi Buku LKS Siswa</span>');

        // 2. Dropdown pemilih rombel Super Admin tidak memiliki label teks "Rombel:" agar tetap minimalis
        const superadminPicker = html.match(/id="header-superadmin-class-picker"[^>]*>[\s\S]*?<\/div>/)?.[0] || '';
        expect(superadminPicker).toBeTruthy();
        expect(superadminPicker).not.toContain('>Rombel:<');
        expect(superadminPicker).toContain('id="header-class-select"');

        // 3. Tombol Kartu (HP) di toolbar memiliki whitespace-nowrap agar tidak terpotong 2 baris teks
        const cardsToggle = html.match(/class="[^"]*btn-view-cards-toggle[^"]*"[\s\S]*?<\/button>/)?.[0] || '';
        expect(cardsToggle).toBeTruthy();
        expect(cardsToggle).toContain('whitespace-nowrap');
        expect(cardsToggle).toContain('Kartu (HP)');

        // 4. Tombol navigasi kiri kanan terpasang dan memiliki event listener eksplisit di JS
        expect(html).toContain('id="btn-scroll-matrix-left"');
        expect(html).toContain('id="btn-scroll-matrix-right"');
        expect(jsContent).toContain("btnScrollLeft.addEventListener('click'");
        expect(jsContent).toContain("btnScrollRight.addEventListener('click'");
    });

    test('21. Resiliensi Tab 2 Tagihan Mobile: Empty State Ramah Anti-Blank, Tombol CTA Pemesanan, Kartu HP Tanpa NIS & Sticky Header', () => {
        const html = fs.readFileSync(htmlPath, 'utf8');
        const jsContent = fs.readFileSync(jsPath, 'utf8');

        // 1. Verifikasi Tombol Scroll Horisontal di Toolbar Tab 2 (Rekap Tagihan)
        expect(html).toContain('id="btn-scroll-rekap-left"');
        expect(html).toContain('id="btn-scroll-rekap-right"');
        expect(html).toContain('id="table-rekap"');
        expect(jsContent).toContain("btnRekapLeft.addEventListener('click'");
        expect(jsContent).toContain("btnRekapRight.addEventListener('click'");

        // 2. Verifikasi Empty State Ramah Anti-Blank di Tabel & Kartu Tagihan saat Belum Ada Pesanan
        const rekapTableSnippet = jsContent.match(/function renderMatrixRekapTable\(\)[\s\S]*?\n\}/)?.[0] || '';
        const rekapCardsSnippet = jsContent.match(/function renderMatrixRekapCards\(\)[\s\S]*?\n\}/)?.[0] || '';

        expect(rekapTableSnippet).toContain('Belum Ada Buku yang Dipesan');
        expect(rekapTableSnippet).toContain('Buka Tab Pemesanan Sekarang');
        expect(rekapTableSnippet).toContain("window.switchTab('matrix-order')");

        expect(rekapCardsSnippet).toContain('Belum Ada Tagihan Buku');
        expect(rekapCardsSnippet).toContain('Buka Tab Pemesanan Sekarang');
        expect(rekapCardsSnippet).toContain("window.switchTab('matrix-order')");

        // 3. Verifikasi Kartu Tagihan HP Tanpa Label NIS, Ikon WhatsApp Emerald, & Baris Ringkas Siswa Tanpa Pesanan
        expect(rekapCardsSnippet).not.toContain('NIS:');
        expect(rekapCardsSnippet).toContain('fa-brands fa-whatsapp');
        expect(rekapCardsSnippet).toContain('Salin Tagihan (WA)');
        expect(rekapCardsSnippet).toContain('Tidak memesan');

        // 4. Verifikasi Sticky Header & Cell Nama Siswa pada Tabel Tagihan (Anti-Hilang saat Geser di HP)
        expect(html).toMatch(/<th[^>]*sticky left-0 sm:left-12[^>]*>Nama Siswa<\/th>/);
        expect(rekapTableSnippet).toContain('sticky left-0 sm:left-12 z-10 bg-white dark:bg-slate-900 border-r');

        // 5. Verifikasi Sinkronisasi Mode saat Switch Tab & Default Cards di Mobile
        const switchTabSnippet = jsContent.match(/function switchTab\(tabKey\)[\s\S]*?\n\}/)?.[0] || '';
        expect(switchTabSnippet).toContain('setViewMode(currentViewMode);');

        const initSnippet = jsContent.match(/function initPesanLksPage\(\)[\s\S]*?\n\}/)?.[0] || '';
        expect(initSnippet).toContain("window.innerWidth < 640");
        expect(initSnippet).toContain("currentViewMode = isMobileDevice ? 'cards' : 'table'");
    });

    test('22. Kontras Tinggi & Pengelompokan Optgroup Dropdown Pemilih Rombel Super Admin di Header (Anti-Invisible Options Mandate)', () => {
        const html = fs.readFileSync(htmlPath, 'utf8');
        const cssPath = path.resolve(process.cwd(), 'css/style.css');
        const cssContent = fs.readFileSync(cssPath, 'utf8');
        const jsContent = fs.readFileSync(jsPath, 'utf8');

        // 1. Verifikasi elemen select di pesan-lks.html memiliki skema gelap & utility class kontras
        const selectTag = html.match(/<select id="header-class-select"[\s\S]*?<\/select>/)?.[0] || '';
        expect(selectTag).toContain('id="header-class-select"');
        expect(selectTag).toContain('[color-scheme:dark]');
        expect(selectTag).toContain('[&>option]:bg-slate-800');
        expect(selectTag).toContain('[&>option]:text-white');

        // 2. Verifikasi aturan CSS eksplisit di css/style.css untuk browser desktop/mobile
        expect(cssContent).toMatch(/select#header-class-select[\s\S]*?color-scheme:\s*dark\s*!important;/);
        expect(cssContent).toMatch(/#header-class-select option[\s\S]*?background-color:\s*#1e293b\s*!important;/);
        expect(cssContent).toMatch(/#header-class-select option[\s\S]*?color:\s*#ffffff\s*!important;/);
        expect(cssContent).toMatch(/#header-class-select optgroup[\s\S]*?background-color:\s*#0f172a\s*!important;/);

        // 3. Verifikasi grouping optgroup & class kontras di js/page-pesan-lks.js
        const initSnippet = jsContent.match(/function initPesanLksPage\(\)[\s\S]*?\n\}/)?.[0] || '';
        expect(initSnippet).toContain("renderGroup('Kelas X'");
        expect(initSnippet).toContain("renderGroup('Kelas XI'");
        expect(initSnippet).toContain("renderGroup('Kelas XII'");
        expect(initSnippet).toContain('<optgroup label=');
        expect(initSnippet).toContain('class="bg-slate-800 text-white font-medium"');
    });

    test('23. Dropdown Pemilih Semester Pemesanan LKS & Mode Histori Read-Only', () => {
        const html = fs.readFileSync(htmlPath, 'utf8');
        const jsContent = fs.readFileSync(jsPath, 'utf8');
        const cssContent = fs.readFileSync(path.resolve(process.cwd(), 'css/style.css'), 'utf8');

        // 1. Verifikasi elemen dropdown semester di pesan-lks.html
        expect(html).toContain('id="header-semester-picker"');
        expect(html).toContain('id="header-semester-select"');
        expect(html).toContain('window.onActiveSemesterChanged');
        expect(html).toContain('value="1"');
        expect(html).toContain('value="2"');
        expect(html).toContain('Semester 1 (Ganjil)');
        expect(html).toContain('Semester 2 (Genap)');

        // 2. Verifikasi badge visual histori read-only di pesan-lks.html
        expect(html).toContain('id="badge-history-readonly"');
        expect(html).toContain('Histori (Read-Only)');

        // 3. Verifikasi aturan CSS kontras tinggi untuk dropdown semester di style.css
        expect(cssContent).toMatch(/select#header-semester-select[\s\S]*?color-scheme:\s*dark\s*!important;/);
        expect(cssContent).toMatch(/#header-semester-select option[\s\S]*?background-color:\s*#1e293b\s*!important;/);
        expect(cssContent).toMatch(/#header-semester-select option[\s\S]*?color:\s*#ffffff\s*!important;/);

        // 4. Verifikasi implementasi helper di js/page-pesan-lks.js
        expect(jsContent).toContain('export function getRunningSemester(');
        expect(jsContent).toContain('export function buildMatrixStorageKey(');
        expect(jsContent).toContain('export function applyHistoryReadOnlyState(');
        expect(jsContent).toContain('export async function onActiveSemesterChanged(');

        // 5. Verifikasi kunci penyimpanan memuat semester (_sem1 / _sem2)
        expect(jsContent).toMatch(/`book_matrix_\${safeClass}_sem\${sem}`/);

        // 6. Verifikasi proteksi read-only: saveClassMatrixData & handler mutasi
        expect(jsContent).toContain('if (isHistoryReadOnly) {');
        expect(jsContent).toContain('isSubmittingMatrix || isHistoryReadOnly');

        // 7. Verifikasi filter periode semester buku di loadClassDataAndRender
        expect(jsContent).toContain('b.periode || b.semester');
        expect(jsContent).toContain("activeSemester === '1'");
        expect(jsContent).toContain("activeSemester === '2'");

        // 8. Verifikasi fallback migrasi kompatibilitas membaca kunci lama jika kunci semester belum ada
        expect(jsContent).toContain('targetSem === getRunningSemester()');
        expect(jsContent).toContain('const oldSafeKey = `book_matrix_${normalizeKey(className).replace(/\\s+/g, \'_\')}`;');
    });
});



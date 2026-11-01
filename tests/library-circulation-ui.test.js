/** @jest-environment jsdom */
const fs = require('node:fs');
const path = require('node:path');

describe('Sirkulasi & Peminjaman Buku UI/UX (library/index.html & library/index.js)', () => {
    let htmlContent;

    beforeAll(() => {
        htmlContent = fs.readFileSync(path.join(__dirname, '../library/index.html'), 'utf8');
    });

    beforeEach(() => {
        document.documentElement.innerHTML = htmlContent;
    });

    test('1. Header memuat judul sirkulasi dan tombol katalog sebagai aksi sekunder', () => {
        const h1 = document.querySelector('h1');
        expect(h1).not.toBeNull();
        expect(h1.textContent).toContain('Sirkulasi & Peminjaman Buku');

        const opacLink = document.querySelector('a[href="opac.html"]');
        expect(opacLink).not.toBeNull();
        expect(opacLink.textContent).toContain('Katalog OPAC');

        const katalogLink = document.querySelector('a[href="katalog.html"]');
        expect(katalogLink).not.toBeNull();
        expect(katalogLink.textContent).toContain('Kelola Katalog Buku');

        expect(katalogLink.className).not.toContain('bg-blue-600');
        expect(katalogLink.className).toContain('bg-white');
    });

    test('2. Keenam kartu statistik sirkulasi tersedia dengan ID yang valid dan penekanan status', () => {
        const stats = [
            'stat-total-judul',
            'stat-total-eksemplar',
            'stat-sedang-dipinjam',
            'stat-terlambat',
            'stat-tersedia',
            'stat-pengunjung-today'
        ];

        stats.forEach(id => {
            const el = document.getElementById(id);
            expect(el).not.toBeNull();
            expect(el.textContent.trim()).toBe('0');
        });

        const dipinjamEl = document.getElementById('stat-sedang-dipinjam');
        expect(dipinjamEl.className).toContain('text-amber-600');

        const terlambatEl = document.getElementById('stat-terlambat');
        expect(terlambatEl.className).toContain('text-rose-600');

        const tersediaEl = document.getElementById('stat-tersedia');
        expect(tersediaEl.className).toContain('text-emerald-600');
    });

    test('3. Panel Peminjaman memiliki 3 langkah kerja jelas, segmented radio, dan label tetap', () => {
        const formPinjam = document.getElementById('form-peminjaman');
        expect(formPinjam).not.toBeNull();

        const radioSiswa = document.querySelector('input[name="peminjam_type"][value="siswa"]');
        const radioGuru = document.querySelector('input[name="peminjam_type"][value="guru"]');
        expect(radioSiswa).not.toBeNull();
        expect(radioGuru).not.toBeNull();
        expect(radioSiswa.checked).toBe(true);

        const inputSearch = document.getElementById('input-peminjam-search');
        const inputKelas = document.getElementById('input-peminjam-kelas');
        const dropdownPeminjam = document.getElementById('peminjam-dropdown');
        const statusBanner = document.getElementById('peminjam-status-banner');

        expect(inputSearch).not.toBeNull();
        expect(inputKelas).not.toBeNull();
        expect(inputKelas.hasAttribute('readonly')).toBe(true);
        expect(dropdownPeminjam).not.toBeNull();
        expect(dropdownPeminjam.classList.contains('hidden')).toBe(true);
        expect(statusBanner).not.toBeNull();

        const inputBarcode = document.getElementById('input-book-barcode');
        const previewCard = document.getElementById('book-preview-card');
        const previewTitle = document.getElementById('preview-book-title');

        expect(inputBarcode).not.toBeNull();
        expect(previewCard).not.toBeNull();
        expect(previewTitle).not.toBeNull();

        const inputTglPinjam = document.getElementById('input-tgl-pinjam');
        const inputTglTempo = document.getElementById('input-tgl-jatuh-tempo');
        const btnSubmit = document.getElementById('btn-submit-pinjam');

        expect(inputTglPinjam).not.toBeNull();
        expect(inputTglTempo).not.toBeNull();
        expect(btnSubmit).not.toBeNull();
        expect(btnSubmit.textContent).toContain('Proses Peminjaman Buku');
        expect(btnSubmit.className).toContain('bg-blue-600');
    });

    test('4. Panel Pengembalian memiliki kontrol mode ganti, guidance hint, anti-tertukar, dan aksi spesifik', () => {
        const btnModeBorrower = document.getElementById('btn-return-mode-borrower');
        const btnModeBarcode = document.getElementById('btn-return-mode-barcode');
        const panelBorrower = document.getElementById('return-panel-borrower');
        const panelBarcode = document.getElementById('return-panel-barcode');

        expect(btnModeBorrower).not.toBeNull();
        expect(btnModeBarcode).not.toBeNull();
        expect(panelBorrower).not.toBeNull();
        expect(panelBarcode).not.toBeNull();
        expect(panelBarcode.classList.contains('hidden')).toBe(true);

        const borrowerHint = document.getElementById('return-borrower-hint');
        expect(borrowerHint).not.toBeNull();
        expect(borrowerHint.textContent).toContain('Pilih Peminjam Terlebih Dahulu');

        const verifyBarcode = document.getElementById('input-return-verify-barcode');
        const activeLoansList = document.getElementById('return-borrower-loans-list');
        const returnInfoBox = document.getElementById('return-info-box');

        expect(verifyBarcode).not.toBeNull();
        expect(activeLoansList).not.toBeNull();
        expect(returnInfoBox).not.toBeNull();
        expect(returnInfoBox.classList.contains('hidden')).toBe(true);

        const btnConfirmReturn = document.getElementById('btn-confirm-return');
        const btnPerpanjang = document.getElementById('btn-perpanjang');

        expect(btnConfirmReturn).not.toBeNull();
        expect(btnConfirmReturn.textContent).toContain('Proses Pengembalian');
        expect(btnPerpanjang).not.toBeNull();
        expect(btnPerpanjang.textContent).toContain('Perpanjang');

        const tarifEl = document.getElementById('display-tarif-denda');
        expect(tarifEl).not.toBeNull();
    });

    test('5. Tabel Transaksi Sirkulasi memiliki toolbar sejajar dan tabel terstruktur', () => {
        const searchInput = document.getElementById('search-sirkulasi');
        const filterStatus = document.getElementById('filter-status-sirkulasi');
        const btnExport = document.getElementById('btn-export-sirkulasi');
        const btnRefresh = document.getElementById('btn-refresh-sirkulasi');
        const tableBody = document.getElementById('sirkulasi-table-body');
        const countInfo = document.getElementById('sirkulasi-count-info');

        expect(searchInput).not.toBeNull();
        expect(filterStatus).not.toBeNull();
        expect(filterStatus.children.length).toBe(4);
        expect(btnExport).not.toBeNull();
        expect(btnRefresh).not.toBeNull();
        expect(tableBody).not.toBeNull();
        expect(countInfo).not.toBeNull();

        const optionValues = Array.from(filterStatus.options).map(o => o.value);
        expect(optionValues).toEqual(['dipinjam', 'terlambat', 'kembali', 'semua']);
    });

    test('6. Input pencarian formulir bebas dari ikon kaca pembesar yang menutupi placeholder', () => {
        const inputPeminjam = document.getElementById('input-peminjam-search');
        const inputReturn = document.getElementById('input-return-peminjam-search');
        const inputSirkulasi = document.getElementById('search-sirkulasi');

        // Pastikan tidak ada elemen i dengan fa-magnifying-glass di dalam kontainer input terkait
        expect(inputPeminjam.parentElement.querySelector('.fa-magnifying-glass')).toBeNull();
        expect(inputReturn.parentElement.querySelector('.fa-magnifying-glass')).toBeNull();
        expect(inputSirkulasi.parentElement.querySelector('.fa-magnifying-glass')).toBeNull();

        // Pastikan padding menggunakan px-3.5 agar teks placeholder bersih dan leluasa
        expect(inputPeminjam.className).toContain('px-3.5');
        expect(inputReturn.className).toContain('px-3.5');
        expect(inputSirkulasi.className).toContain('px-3.5');
    });

    test('7. Input barcode memiliki padding-left yang lapang dan dropdown filter bebas clipping teks', () => {
        const inputBookBarcode = document.getElementById('input-book-barcode');
        const inputReturnVerify = document.getElementById('input-return-verify-barcode');
        const inputReturnBarcode = document.getElementById('input-return-barcode');
        const filterStatus = document.getElementById('filter-status-sirkulasi');
        const returnCondition = document.getElementById('return-condition');

        // Pastikan input barcode memiliki style padding-left minimal 48px agar tidak menimpa icon barcode
        expect(inputBookBarcode.getAttribute('style')).toContain('padding-left: 48px');
        expect(inputReturnVerify.getAttribute('style')).toContain('padding-left: 48px');
        expect(inputReturnBarcode.getAttribute('style')).toContain('padding-left: 48px');

        // Pastikan select filter dan return-condition bebas clipping vertikal (padding-top: 0 dan height: 40px)
        expect(filterStatus.getAttribute('style')).toContain('padding-top: 0');
        expect(filterStatus.getAttribute('style')).toContain('height: 40px');
        expect(returnCondition.getAttribute('style')).toContain('padding-top: 0');
        expect(returnCondition.getAttribute('style')).toContain('height: 40px');
    });

    test('8. Input tanggal menggunakan format dd/mm/yyyy dengan hidden calendar picker', () => {
        const tglPinjam = document.getElementById('input-tgl-pinjam');
        const tglTempo = document.getElementById('input-tgl-jatuh-tempo');

        // Pastikan input tanggal adalah type="text" dengan placeholder dd/mm/yyyy
        expect(tglPinjam.getAttribute('type')).toBe('text');
        expect(tglPinjam.getAttribute('placeholder')).toBe('dd/mm/yyyy');
        expect(tglPinjam.getAttribute('maxlength')).toBe('10');

        expect(tglTempo.getAttribute('type')).toBe('text');
        expect(tglTempo.getAttribute('placeholder')).toBe('dd/mm/yyyy');
        expect(tglTempo.getAttribute('maxlength')).toBe('10');

        // Pastikan hidden date picker tersedia untuk akses kalender
        const pinjamPicker = document.getElementById('input-tgl-pinjam-picker');
        const tempoPicker = document.getElementById('input-tgl-jatuh-tempo-picker');

        expect(pinjamPicker).not.toBeNull();
        expect(pinjamPicker.getAttribute('type')).toBe('date');
        expect(pinjamPicker.style.opacity).toBe('0');

        expect(tempoPicker).not.toBeNull();
        expect(tempoPicker.getAttribute('type')).toBe('date');
        expect(tempoPicker.style.opacity).toBe('0');
    });
});

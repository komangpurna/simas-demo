/**
 * tests/library-isbn-price.test.js
 * Unit test for ISBN Barcode-first Auto Lookup, Book Price (Harga), and Eksemplar Price Inheritance
 */

function cleanIsbnDigits(isbn) {
    if (!isbn) return '';
    return String(isbn).trim().replace(/[-\s]/g, '');
}

function isStandardIsbnLength(cleanIsbn) {
    return cleanIsbn.length === 10 || cleanIsbn.length === 13;
}

function parseBookPrice(rawVal) {
    if (rawVal === undefined || rawVal === null || rawVal === '') return 0;
    if (typeof rawVal === 'number') return isNaN(rawVal) ? 0 : Math.max(0, rawVal);
    const cleaned = String(rawVal).replace(/\./g, '').replace(/,/g, '.').replace(/[^0-9.]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : Math.max(0, num);
}

function formatRupiah(num) {
    if (!num || Number(num) <= 0) return '-';
    return `Rp ${Math.round(Number(num)).toLocaleString('id-ID')}`;
}

function buildBookPayload({ judul, pengarang, isbn, harga, catatan = '' }) {
    return {
        judul,
        pengarang,
        isbn: isbn ? isbn.trim() : '',
        harga: parseBookPrice(harga),
        catatan
    };
}

function applyMissingColumnFallback(payload) {
    const fallbackPayload = { ...payload };
    const harga = fallbackPayload.harga || 0;
    delete fallbackPayload.harga;
    if (harga > 0) {
        fallbackPayload.catatan = (fallbackPayload.catatan ? fallbackPayload.catatan + ' | ' : '') + `Harga: Rp ${Math.round(harga).toLocaleString('id-ID')}`;
    }
    return fallbackPayload;
}

function generateEksemplarPayloads({ book, qty, baseNomorInduk, baseBarcode, checkBarcodeSame = true, inputHarga }) {
    const payloads = [];
    const itemHarga = inputHarga !== undefined && inputHarga !== ''
        ? parseBookPrice(inputHarga)
        : (book.harga || 0);

    for (let i = 0; i < qty; i++) {
        const nextCopyNumber = i + 1;
        const nomorInduk = `${baseNomorInduk}-${String(nextCopyNumber).padStart(3, '0')}`;
        const barcode = checkBarcodeSame ? nomorInduk : `${baseBarcode}-${String(nextCopyNumber).padStart(3, '0')}`;

        payloads.push({
            buku_id: book.id,
            nomor_induk: nomorInduk,
            kode_barcode: barcode,
            copy_number: nextCopyNumber,
            harga: itemHarga,
            kondisi: 'baik',
            status: 'tersedia'
        });
    }
    return payloads;
}

describe('Manajemen Katalog Perpustakaan: Barcode-First ISBN & Dokumentasi Harga Buku', () => {
    describe('1. Deteksi Barcode Scanner & Digit ISBN Standar', () => {
        test('Membersihkan karakter pemisah hyphen dan spasi pada ISBN-13', () => {
            expect(cleanIsbnDigits('978-602-434-112-9')).toBe('9786024341129');
            expect(isStandardIsbnLength(cleanIsbnDigits('978-602-434-112-9'))).toBe(true);
        });

        test('Mendeteksi ISBN-10 yang valid untuk pemindaian barcode', () => {
            expect(cleanIsbnDigits('0-306-40615-2')).toBe('0306406152');
            expect(isStandardIsbnLength(cleanIsbnDigits('0-306-40615-2'))).toBe(true);
        });

        test('Input parsial di bawah 10 digit tidak memicu auto-lookup prematur', () => {
            expect(isStandardIsbnLength(cleanIsbnDigits('978602'))).toBe(false);
            expect(isStandardIsbnLength(cleanIsbnDigits('12345'))).toBe(false);
        });
    });

    describe('2. Konversi & Pemformatan Nilai Harga Buku (Rupiah)', () => {
        test('Parsing string harga dengan titik pemisah ribuan', () => {
            expect(parseBookPrice('75.000')).toBe(75000);
            expect(parseBookPrice('Rp 125.500')).toBe(125500);
            expect(parseBookPrice('1.500.000')).toBe(1500000);
        });

        test('Handling input angka murni, string kosong, dan non-angka', () => {
            expect(parseBookPrice(85000)).toBe(85000);
            expect(parseBookPrice('')).toBe(0);
            expect(parseBookPrice(null)).toBe(0);
            expect(parseBookPrice('invalid-text')).toBe(0);
        });

        test('Format tampilan Rupiah untuk tabel katalog dan eksemplar', () => {
            expect(formatRupiah(75000)).toBe('Rp 75.000');
            expect(formatRupiah(1250000)).toBe('Rp 1.250.000');
            expect(formatRupiah(0)).toBe('-');
            expect(formatRupiah(null)).toBe('-');
        });
    });

    describe('3. Payload Buku & Fallback Kompatibilitas Database Remote', () => {
        test('Menyusun payload buku dengan kolom harga', () => {
            const payload = buildBookPayload({
                judul: 'Laskar Pelangi',
                pengarang: 'Hirata, Andrea',
                isbn: '9789791227780',
                harga: '75.000'
            });

            expect(payload.harga).toBe(75000);
            expect(payload.isbn).toBe('9789791227780');
        });

        test('Fallback otomatis memindahkan harga ke catatan jika kolom harga belum termigrasi di database remote', () => {
            const initial = buildBookPayload({
                judul: 'Laskar Pelangi',
                pengarang: 'Hirata, Andrea',
                isbn: '9789791227780',
                harga: '75.000'
            });

            const fallback = applyMissingColumnFallback(initial);
            expect(fallback.harga).toBeUndefined();
            expect(fallback.catatan).toBe('Harga: Rp 75.000');
        });
    });

    describe('4. Pewarisan Harga dari Buku Master ke Eksemplar Fisik', () => {
        test('Eksemplar otomatis mewarisi harga dari buku master bila input copy kosong', () => {
            const book = { id: 101, judul: 'Fisika Dasar', harga: 85000 };
            const copies = generateEksemplarPayloads({
                book,
                qty: 2,
                baseNomorInduk: '00100',
                checkBarcodeSame: true
            });

            expect(copies).toHaveLength(2);
            expect(copies[0].harga).toBe(85000);
            expect(copies[1].harga).toBe(85000);
            expect(copies[0].nomor_induk).toBe('00100-001');
            expect(copies[0].kode_barcode).toBe('00100-001');
        });

        test('Eksemplar dapat menggunakan harga satuan kustom yang berbeda dari master', () => {
            const book = { id: 101, judul: 'Fisika Dasar', harga: 85000 };
            const copies = generateEksemplarPayloads({
                book,
                qty: 1,
                baseNomorInduk: '00200',
                checkBarcodeSame: true,
                inputHarga: '95.000'
            });
            expect(copies).toHaveLength(1);
            expect(copies[0].harga).toBe(95000);
        });
    });

    describe('5. Validasi Kolom Wajib Master Bibliografi Buku (Penerbit, Kota Terbit, Tahun Terbit)', () => {
        function validateBookMandatoryFields({ judul, pengarang, ddc, penerbit, kotaTerbit, tahunTerbit }) {
            const errors = [];
            if (!judul || !judul.trim()) errors.push('Judul Wajib Diisi');
            if (!pengarang || !pengarang.trim()) errors.push('Pengarang Wajib Diisi');
            if (!ddc || !String(ddc).trim()) errors.push('DDC Wajib Dipilih');
            if (!penerbit || !penerbit.trim()) errors.push('Penerbit Wajib Diisi');
            if (!kotaTerbit || !kotaTerbit.trim()) errors.push('Kota Terbit Wajib Diisi');
            const year = parseInt(tahunTerbit, 10);
            if (!tahunTerbit || isNaN(year) || year < 1000 || year > 2200) {
                errors.push('Tahun Terbit Wajib Diisi');
            }
            return {
                isValid: errors.length === 0,
                errors
            };
        }

        test('Validasi berhasil saat seluruh kolom wajib (Judul, Pengarang, DDC, Penerbit, Kota, Tahun) terisi lengkap', () => {
            const res = validateBookMandatoryFields({
                judul: 'Laskar Pelangi',
                pengarang: 'Andrea Hirata',
                ddc: '813',
                penerbit: 'Bentang Pustaka',
                kotaTerbit: 'Yogyakarta',
                tahunTerbit: 2005
            });
            expect(res.isValid).toBe(true);
            expect(res.errors).toHaveLength(0);
        });

        test('Validasi gagal jika Penerbit, Kota Terbit, atau Tahun Terbit kosong', () => {
            const resMissing = validateBookMandatoryFields({
                judul: 'Matematika SMA',
                pengarang: 'Sukino',
                ddc: '510',
                penerbit: '',
                kotaTerbit: '',
                tahunTerbit: ''
            });
            expect(resMissing.isValid).toBe(false);
            expect(resMissing.errors).toContain('Penerbit Wajib Diisi');
            expect(resMissing.errors).toContain('Kota Terbit Wajib Diisi');
            expect(resMissing.errors).toContain('Tahun Terbit Wajib Diisi');
        });

        test('Validasi gagal jika Tahun Terbit di luar batas wajar (1000 - 2200)', () => {
            const resInvalidYear = validateBookMandatoryFields({
                judul: 'Buku Kuno',
                pengarang: 'Anonim',
                ddc: '000',
                penerbit: 'Percetakan Sekolah',
                kotaTerbit: 'Amlapura',
                tahunTerbit: 99
            });
            expect(resInvalidYear.isValid).toBe(false);
            expect(resInvalidYear.errors).toContain('Tahun Terbit Wajib Diisi');
        });
    });
});

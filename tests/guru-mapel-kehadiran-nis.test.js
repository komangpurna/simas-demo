const fs = require('fs');
const path = require('path');

describe('Portal Guru Mapel - Sembunyikan Kolom NIS pada Tab Kehadiran', () => {
    let pageJsCode;

    beforeAll(() => {
        pageJsCode = fs.readFileSync(path.join(__dirname, '../js/page-guru-mapel.js'), 'utf8');
    });

    test('1. Verifikasi header kolom NIS pada tabel kehadiran menggunakan kelas hidden', () => {
        // Memastikan th NIS memiliki kelas hidden dan identifier col-presensi-nis
        expect(pageJsCode).toMatch(/<th\s+rowspan="3"\s+class="hidden\s+col-presensi-nis">NIS<\/th>/);
    });

    test('2. Verifikasi sel data baris siswa kolom NIS pada tabel kehadiran menggunakan kelas hidden', () => {
        // Memastikan td NIS disembunyikan menggunakan kelas hidden dan mempertahankan col-presensi-nis
        expect(pageJsCode).toMatch(/<td\s+class="hidden\s+col-presensi-nis">\$\{escapeHTML\(r\.nis\)\}<\/td>/);
    });

    test('3. Verifikasi sel NIS tidak lagi menggunakan kelas sm:table-cell agar tersembunyi di semua ukuran layar', () => {
        // Memastikan tidak ada col-presensi-nis yang memakai sm:table-cell
        expect(pageJsCode).not.toMatch(/class="[^"]*sm:table-cell[^"]*col-presensi-nis[^"]*"/);
        expect(pageJsCode).not.toMatch(/class="[^"]*col-presensi-nis[^"]*sm:table-cell[^"]*"/);
    });
});

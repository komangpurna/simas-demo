/**
 * tests/library-katalog-table-header.test.js
 * Unit Test: Perapian Tabel Katalog Buku & Hero Header Modul Perpustakaan
 */

const fs = require('fs');
const path = require('path');

describe('Perapian Tabel Katalog Buku & Hero Header Perpustakaan', () => {
    let katalogHtml;
    let katalogJs;

    beforeAll(() => {
        const rootDir = path.resolve(__dirname, '..');
        katalogHtml = fs.readFileSync(path.join(rootDir, 'library/katalog.html'), 'utf8');
        katalogJs = fs.readFileSync(path.join(rootDir, 'library/katalog.js'), 'utf8');
    });

    describe('1. Integritas Header Halaman & Kelompok Tombol Aksi', () => {
        test('Memiliki hero header terstruktur standar kartu gelap bg-slate-900', () => {
            expect(katalogHtml).toContain('class="premium-header bg-slate-900 border border-slate-800 text-white rounded-2xl');
        });

        test('Memuat elemen identitas pengguna dan tanggal di header', () => {
            expect(katalogHtml).toContain('id="header-user-name"');
            expect(katalogHtml).toContain('id="header-date-display"');
        });

        test('Menyederhanakan tombol aksi dengan segmented pill untuk ekspor/impor', () => {
            expect(katalogHtml).toContain('id="btn-open-bulk-print"');
            expect(katalogHtml).toContain('id="btn-export-katalog"');
            expect(katalogHtml).toContain('id="btn-import-excel"');
            expect(katalogHtml).toContain('id="btn-open-add-book"');
        });

        test('Memuat 4 kartu metrik KPI cepat perpustakaan', () => {
            expect(katalogHtml).toContain('id="kpi-total-judul"');
            expect(katalogHtml).toContain('id="kpi-total-eksemplar"');
            expect(katalogHtml).toContain('id="kpi-total-tersedia"');
            expect(katalogHtml).toContain('id="kpi-total-habis"');
        });
    });

    describe('2. Responsivitas Toolbar & Tabel Anti-Overflow', () => {
        test('Toolbar filter memiliki tombol reset pencarian', () => {
            expect(katalogHtml).toContain('id="btn-reset-filter"');
        });

        test('Header tabel menerapkan kolom aksi sticky right', () => {
            expect(katalogHtml).toMatch(/<th[^>]*sticky right-0[^>]*>Aksi<\/th>/);
        });

        test('Seluruh dialog modal berada di luar <main> sebagai top-level siblings (PRD Rule 7)', () => {
            const mainClosingIdx = katalogHtml.indexOf('</main>');
            const modalFormIdx = katalogHtml.indexOf('id="modal-book-form"');
            const modalEksIdx = katalogHtml.indexOf('id="modal-eksemplar"');
            const modalBulkIdx = katalogHtml.indexOf('id="modal-bulk-print"');

            expect(mainClosingIdx).toBeGreaterThan(0);
            expect(modalFormIdx).toBeGreaterThan(mainClosingIdx);
            expect(modalEksIdx).toBeGreaterThan(mainClosingIdx);
            expect(modalBulkIdx).toBeGreaterThan(mainClosingIdx);
        });
    });

    describe('3. Logika JavaScript & Perapian Kolom (library/katalog.js)', () => {
        test('Mengimplementasikan updateCatalogKPIs untuk sinkronisasi 4 metrik', () => {
            expect(katalogJs).toContain('function updateCatalogKPIs()');
            expect(katalogJs).toContain("document.getElementById('kpi-total-judul')");
            expect(katalogJs).toContain("document.getElementById('kpi-total-eksemplar')");
            expect(katalogJs).toContain("document.getElementById('kpi-total-tersedia')");
            expect(katalogJs).toContain("document.getElementById('kpi-total-habis')");
        });

        test('Mengeliminasi whitespace-nowrap pada penerbit panjang & menerapkan line-clamp-2', () => {
            expect(katalogJs).toContain('line-clamp-2');
            expect(katalogJs).toContain('max-w-[240px]');
        });

        test('Memperbaiki bug teks berulang "Rak Rak"', () => {
            expect(katalogJs).toMatch(/rawRak\.toLowerCase\(\)\.startsWith\(['"]rak['"]\)\s*\?\s*rawRak\s*:\s*`Rak \${rawRak}`/);
        });

        test('Menerapkan kelas sticky right pada kolom aksi di baris tabel', () => {
            expect(katalogJs).toContain('sticky right-0');
        });

        test('Menghubungkan event listener tombol reset filter', () => {
            expect(katalogJs).toContain("document.getElementById('btn-reset-filter')");
        });
    });
});

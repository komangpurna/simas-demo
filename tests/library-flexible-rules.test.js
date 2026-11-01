/**
 * tests/library-flexible-rules.test.js
 * Unit test untuk memastikan toggle aktif/nonaktif batasan operasional perpustakaan
 * bekerja dengan benar dan tersinkronisasi di seluruh modul terkait.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pengaturanHtml = fs.readFileSync(path.join(root, 'library/pengaturan.html'), 'utf8');
const pengaturanJs = fs.readFileSync(path.join(root, 'library/pengaturan.js'), 'utf8');
const indexJs = fs.readFileSync(path.join(root, 'library/index.js'), 'utf8');
const opacJs = fs.readFileSync(path.join(root, 'library/opac.js'), 'utf8');
const portalSiswaJs = fs.readFileSync(path.join(root, 'js/page-portal-siswa.js'), 'utf8');
const waliKelasJs = fs.readFileSync(path.join(root, 'js/page-wali-kelas.js'), 'utf8');
const migrationSql = fs.readFileSync(path.join(root, 'supabase/migrations/202609110002_library_flexible_rules_toggle.sql'), 'utf8');

describe('Fleksibilitas Aturan Operasional Perpustakaan (Toggle Per Form)', () => {

    test('1. library/pengaturan.html memiliki seluruh toggle switch batasan', () => {
        const requiredToggles = [
            'cfg-toggle-max-pinjam-siswa',
            'cfg-toggle-max-pinjam-guru',
            'cfg-toggle-durasi-siswa',
            'cfg-toggle-durasi-guru',
            'cfg-toggle-denda',
            'cfg-toggle-max-perpanjangan'
        ];

        requiredToggles.forEach(id => {
            expect(pengaturanHtml).toContain(`id="${id}"`);
        });
    });

    test('2. library/pengaturan.js mendefinisikan TOGGLE_FIELDS dan menyinkronkan status toggle', () => {
        const requiredKeys = [
            'enable_max_pinjam_siswa',
            'enable_max_pinjam_guru',
            'enable_durasi_siswa',
            'enable_durasi_guru',
            'enable_denda',
            'enable_max_perpanjangan'
        ];

        requiredKeys.forEach(key => {
            expect(pengaturanJs).toContain(key);
        });

        expect(pengaturanJs).toContain('function syncToggleFieldUI');
        expect(pengaturanJs).toContain('updates.push');
    });

    test('3. library/index.js mendukung bypass batasan saat toggle dinonaktifkan', () => {
        expect(indexJs).toContain('enable_max_pinjam_siswa');
        expect(indexJs).toContain('enable_max_pinjam_guru');
        expect(indexJs).toContain('enable_durasi_siswa');
        expect(indexJs).toContain('enable_durasi_guru');
        expect(indexJs).toContain('enable_denda');
        expect(indexJs).toContain('enable_max_perpanjangan');

        // Kuota bebas
        expect(indexJs).toContain('Bebas Kuota');
        // Bebas denda
        expect(indexJs).toContain('Bebas Denda');
    });

    test('4. library/opac.js, page-portal-siswa.js, dan page-wali-kelas.js tidak mereset tarif denda 0 ke 1000', () => {
        // opac.js
        expect(opacJs).not.toMatch(/dendaEst\s*=\s*lateDays\s*\*\s*\(Number\(l\.tarif_denda_per_hari\)\s*\|\|\s*1000\)/);
        // page-portal-siswa.js
        expect(portalSiswaJs).not.toMatch(/dendaEst\s*=\s*lateDays\s*\*\s*\(Number\(l\.tarif_denda_per_hari\)\s*\|\|\s*1000\)/);
        // page-wali-kelas.js
        expect(waliKelasJs).not.toMatch(/totalDendaTertunggak\s*\+=\s*lateDays\s*\*\s*\(Number\(l\.tarif_denda_per_hari\)\s*\|\|\s*1000\)/);
    });

    test('5. Migrasi SQL memuat definisi RPC lib_borrow_copy, lib_return_copy, dan lib_extend_loan dengan dukungan toggle', () => {
        expect(migrationSql).toContain('enable_max_pinjam_siswa');
        expect(migrationSql).toContain('enable_denda');
        expect(migrationSql).toContain('enable_durasi_siswa');
        expect(migrationSql).toContain('enable_max_perpanjangan');

        expect(migrationSql).toContain('CREATE OR REPLACE FUNCTION public.lib_borrow_copy');
        expect(migrationSql).toContain('CREATE OR REPLACE FUNCTION public.lib_return_copy');
        expect(migrationSql).toContain('CREATE OR REPLACE FUNCTION public.lib_extend_loan');
    });
});

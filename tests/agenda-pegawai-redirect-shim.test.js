/**
 * Unit & Integration Test: Verifikasi Redirect Shim agenda-pegawai.html
 * Memastikan kompatibilitas mundur (backward-compatibility) pengalihan instan
 * dari URL lama agenda-pegawai.html ke modul baru e-kinerja-tendik.html
 * tanpa merusak query param, hash fragment, maupun riwayat tombol Back browser.
 */

const fs = require('fs');
const path = require('path');

describe('Kompatibilitas Mundur: Redirect Shim agenda-pegawai.html -> e-kinerja-tendik.html', () => {
    const rootDir = path.resolve(__dirname, '..');
    const shimPath = path.join(rootDir, 'agenda-pegawai.html');
    let shimContent;

    beforeAll(() => {
        expect(fs.existsSync(shimPath)).toBe(true);
        shimContent = fs.readFileSync(shimPath, 'utf8');
    });

    test('1. Berkas agenda-pegawai.html berstatus fisik ada dan memuat meta refresh ke e-kinerja-tendik.html', () => {
        expect(shimContent).toContain('<meta http-equiv="refresh" content="0; url=e-kinerja-tendik.html">');
        expect(shimContent).toContain('<title>Mengalihkan ke E-Kinerja Tendik - SIMAS SMAGESA</title>');
    });

    test('2. Memuat skrip JavaScript inline IIFE untuk instant redirection dengan preservasi search query dan hash', () => {
        expect(shimContent).toContain("var target = 'e-kinerja-tendik.html' + window.location.search + window.location.hash;");
        expect(shimContent).toContain('window.location.replace(target);');
    });

    test('3. Memuat tombol manual alternatif dengan sinkronisasi search query dan hash jika JS lambat', () => {
        expect(shimContent).toContain('id="btn-redirect-manual"');
        expect(shimContent).toContain('href="e-kinerja-tendik.html"');
        expect(shimContent).toContain("manualBtn.href = 'e-kinerja-tendik.html' + window.location.search + window.location.hash;");
        expect(shimContent).toContain('Buka E-Kinerja Tendik');
    });

    test('4. Memuat penjelasan ramah pengguna terkait migrasi resmi modul ke E-Kinerja Tendik', () => {
        expect(shimContent).toContain('E-Kinerja Tendik');
        expect(shimContent).toContain('Mengalihkan ke E-Kinerja Tendik...');
    });
});

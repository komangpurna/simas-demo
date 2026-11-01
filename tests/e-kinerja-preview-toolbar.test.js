/**
 * tests/e-kinerja-preview-toolbar.test.js
 *
 * Verifikasi Sistemik Bilah Kontrol Pratinjau Terpadu (Unified Preview Action Bar):
 * 1. Saklar orientasi (Portrait & Landscape) dipindahkan ke dekat kontainer iframe pratinjau
 *    (bukan di toolbar konfigurasi paling atas) pada e-kinerja.html dan e-kinerja-tendik.html.
 * 2. Bilah pratinjau memuat kontrol terpadu:
 *    - Saklar Orientasi Segmented Control
 *    - Badge Dimensi/Ukuran Kertas A4 Dinamis
 *    - Tombol Perbarui Pratinjau
 *    - Tombol Cepat Sekunder Cetak / PDF
 * 3. Toolbar konfigurasi konten (atas) bebas dari saklar orientasi dan memuat kontrol pemilihan
 *    periode serta drawer kegiatan dalam tata letak kompak.
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Verifikasi Bilah Kontrol Pratinjau Terpadu E-Kinerja Guru & Tendik', () => {
    const rootDir = path.resolve(__dirname, '..');
    const guruHtmlPath = path.join(rootDir, 'e-kinerja.html');
    const tendikHtmlPath = path.join(rootDir, 'e-kinerja-tendik.html');
    const bebanKerjaJsPath = path.join(rootDir, 'js', 'page-beban-kerja.js');
    const tendikJsPath = path.join(rootDir, 'js', 'page-e-kinerja-tendik.js');

    test('1. e-kinerja.html: Saklar orientasi berada di dekat iframe pratinjau, bukan di toolbar paling atas', () => {
        const html = fs.readFileSync(guruHtmlPath, 'utf8');

        // Modal cetak rekap estetik ada
        expect(html).toContain('id="modal-rekap-aesthetic-print"');

        // Iframe pratinjau ada
        expect(html).toContain('id="rekap-aesthetic-preview-frame"');

        // Saklar orientasi ada
        expect(html).toContain('id="btn-rekap-orient-portrait"');
        expect(html).toContain('id="btn-rekap-orient-landscape"');

        // Saklar orientasi berada di blok pratinjau (setelah panel tanda tangan)
        const signCanvasIdx = html.indexOf('id="rekap-signature-canvas"');
        const portraitBtnIdx = html.indexOf('id="btn-rekap-orient-portrait"');
        const previewFrameIdx = html.indexOf('id="rekap-aesthetic-preview-frame"');

        expect(signCanvasIdx).toBeGreaterThan(-1);
        expect(portraitBtnIdx).toBeGreaterThan(signCanvasIdx);
        expect(previewFrameIdx).toBeGreaterThan(portraitBtnIdx);

        // Header toolbar pratinjau terpadu memuat tombol perbarui & cetak sekunder
        expect(html).toContain('id="rekap-preview-scale-hint"');
        expect(html).toContain('onclick="window.workloadRefreshAestheticPreview()"');
        expect(html).toContain('onclick="window.workloadPrintAestheticReport()"');
    });

    test('2. e-kinerja-tendik.html: Saklar orientasi berada di dekat iframe pratinjau, bukan di toolbar paling atas', () => {
        const html = fs.readFileSync(tendikHtmlPath, 'utf8');

        // Modal cetak butir tugas tendik ada
        expect(html).toContain('id="modal-employee-butir-print"');

        // Iframe pratinjau ada
        expect(html).toContain('id="emp-print-preview-frame"');

        // Saklar orientasi ada
        expect(html).toContain('id="btn-emp-print-orient-portrait"');
        expect(html).toContain('id="btn-emp-print-orient-landscape"');

        // Saklar orientasi berada di blok pratinjau (setelah panel tanda tangan)
        const signCanvasIdx = html.indexOf('id="emp-print-signature-canvas"');
        const portraitBtnIdx = html.indexOf('id="btn-emp-print-orient-portrait"');
        const previewFrameIdx = html.indexOf('id="emp-print-preview-frame"');

        expect(signCanvasIdx).toBeGreaterThan(-1);
        expect(portraitBtnIdx).toBeGreaterThan(signCanvasIdx);
        expect(previewFrameIdx).toBeGreaterThan(portraitBtnIdx);

        // Header toolbar pratinjau terpadu memuat tombol perbarui, cetak sekunder, dan scale hint
        expect(html).toContain('id="emp-print-scale-hint"');
        expect(html).toContain('onclick="window.refreshEmpPrintPreview()"');
        expect(html).toContain('onclick="window.printEmployeeButirReport()"');
    });

    test('3. js/page-beban-kerja.js: updateOrientationButtonsUI memperbarui teks dimensi A4 secara dinamis', () => {
        const js = fs.readFileSync(bebanKerjaJsPath, 'utf8');

        expect(js).toContain("el('rekap-preview-scale-hint')");
        expect(js).toContain("A4 Landscape (297 × 210 mm)");
        expect(js).toContain("A4 Portrait (210 × 297 mm)");
    });

    test('4. js/page-e-kinerja-tendik.js: updateEmpPrintOrientationUI memperbarui teks dimensi A4 secara dinamis dan mengekspor refreshEmpPrintPreview', () => {
        const js = fs.readFileSync(tendikJsPath, 'utf8');

        expect(js).toContain("document.getElementById('emp-print-scale-hint')");
        expect(js).toContain("A4 Landscape (297 × 210 mm)");
        expect(js).toContain("A4 Portrait (210 × 297 mm)");
        expect(js).toContain("window.refreshEmpPrintPreview");
    });
});

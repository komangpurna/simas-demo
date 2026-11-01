/**
 * tests/workload-plan-toolbar-hbg.test.js
 *
 * Verifikasi Sistemik Toolbar Rencana Kerja 3 Tombol & Penyembunyian HBG
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Workload Plan Toolbar & HBG Visibility Integrity', () => {
    const htmlPath = path.resolve(process.cwd(), 'e-kinerja.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    test('Toolbar rencana memiliki container aksi dengan 5 tombol terpadu (3 slot aktif dinamis)', () => {
        expect(htmlContent).toContain('id="btn-sync-kbm-schedule"');
        expect(htmlContent).toContain('id="btn-apply-template-mobile"');
        expect(htmlContent).toContain('id="btn-save-as-template-mobile"');
        expect(htmlContent).toContain('id="btn-submit-plan"');
        expect(htmlContent).toContain('id="btn-reopen-plan"');
    });

    test('Tombol btn-reopen-plan berada di dalam toolbar berdampingan dengan btn-save-as-template-mobile', () => {
        const toolbarStart = htmlContent.indexOf('id="plan-toolbar"');
        const toolbarEnd = htmlContent.indexOf('id="plan-sync-required-banner"');
        expect(toolbarStart).toBeGreaterThan(-1);
        expect(toolbarEnd).toBeGreaterThan(toolbarStart);

        const toolbarSnippet = htmlContent.substring(toolbarStart, toolbarEnd);
        expect(toolbarSnippet).toContain('id="btn-save-as-template-mobile"');
        expect(toolbarSnippet).toContain('id="btn-reopen-plan"');
        expect(toolbarSnippet).toContain('id="btn-submit-plan"');
    });

    test('Banner status rencana tidak lagi memuat tombol raksasa duplikat btn-reopen-plan', () => {
        const bannerStart = htmlContent.indexOf('id="plan-status-banner"');
        const bannerEnd = htmlContent.indexOf('id="plan-duty-summary-container"');
        expect(bannerStart).toBeGreaterThan(-1);
        expect(bannerEnd).toBeGreaterThan(bannerStart);

        const bannerSnippet = htmlContent.substring(bannerStart, bannerEnd);
        // btn-reopen-plan tidak boleh ada di dalam banner lagi
        expect(bannerSnippet).not.toContain('id="btn-reopen-plan"');
    });

    test('Kontrol HBG (study-day-control-box) terdefinisi dengan elemen dropdown select yang tepat', () => {
        expect(htmlContent).toContain('id="study-day-control-box"');
        expect(htmlContent).toContain('id="select-workload-study-day"');
    });
});

/**
 * tests/workload-plan-mobile-layout-sync.test.js
 * ====================================================================
 * Test Suite: Validasi Tata Letak Mobile Tab Rencana & Respon Instan Sinkron KBM
 * Memverifikasi:
 * 1. Tombol 'tab-plan-toolbar' disembunyikan pada mobile (hidden sm:flex).
 * 2. Toolbar rencana (#plan-toolbar) mengimplementasikan grid 2-kolom mobile yang rapi.
 * 3. Tombol Sinkron Jadwal KBM memiliki tactile feedback & membuka modal seketika (0ms).
 * 4. Tombol template mobile (#btn-apply-template-mobile & #btn-save-as-template-mobile) tersedia.
 * 5. Tombol 'Ubah ke Draf' (#btn-reopen-plan) pada banner beradaptasi w-full di mobile.
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Suite Pengujian Tata Letak Mobile Tab Rencana & Respon Instan Sinkron KBM', () => {
    const root = path.resolve(__dirname, '..');
    const eKinerjaHtml = fs.readFileSync(path.join(root, 'e-kinerja.html'), 'utf8');
    const pageBebanKerjaJs = fs.readFileSync(path.join(root, 'js', 'page-beban-kerja.js'), 'utf8');

    test('1. e-kinerja.html: tab-plan-toolbar hanya tampil di desktop (hidden sm:flex) agar mobile bersih', () => {
        expect(eKinerjaHtml).toContain('id="tab-plan-toolbar" class="hidden sm:flex');
    });

    test('2. e-kinerja.html: plan-toolbar menyediakan tombol dengan ID dan layout mobile yang rapi', () => {
        expect(eKinerjaHtml).toContain('id="plan-toolbar"');
        expect(eKinerjaHtml).toContain('id="btn-sync-kbm-schedule"');
        expect(eKinerjaHtml).toContain('id="icon-sync-kbm-schedule"');
        expect(eKinerjaHtml).toContain('id="text-sync-kbm-schedule"');
        expect(eKinerjaHtml).not.toContain('id="btn-export-plan-word"');
        expect(eKinerjaHtml).toContain('id="btn-apply-template-mobile"');
        expect(eKinerjaHtml).toContain('id="btn-save-as-template-mobile"');
        expect(eKinerjaHtml).toContain('id="select-workload-study-day"');
        expect(eKinerjaHtml).toContain('id="study-day-auto-badge"');
    });

    test('3. e-kinerja.html: banner status rencana responsif dengan tombol reopen w-full di mobile', () => {
        expect(eKinerjaHtml).toContain('id="plan-status-banner"');
        expect(eKinerjaHtml).toContain('id="btn-reopen-plan"');
        expect(eKinerjaHtml).toMatch(/id="btn-reopen-plan"[^>]*class="[^"]*w-full sm:w-auto/);
    });

    test('4. js/page-beban-kerja.js: syncScheduleModal membuka modal secara instan (0ms) sebelum roundtrip jaringan', () => {
        const syncModalFn = pageBebanKerjaJs.substring(pageBebanKerjaJs.indexOf('async function syncScheduleModal()'));
        const modalOpenIdx = syncModalFn.indexOf("modal.classList.remove('hidden')");
        const initNetCallIdx = syncModalFn.indexOf("cfInitializeWorkloadWeek");

        expect(modalOpenIdx).toBeGreaterThan(-1);
        expect(initNetCallIdx).toBeGreaterThan(-1);
        // Memastikan modal dibuka TERLEBIH DAHULU sebelum pemanggilan API inisialisasi jaringan
        expect(modalOpenIdx).toBeLessThan(initNetCallIdx);
    });

    test('5. js/page-beban-kerja.js: syncScheduleModal memberikan tactile feedback (disabled + animate-spin)', () => {
        expect(pageBebanKerjaJs).toContain('btnSync.disabled = true;');
        expect(pageBebanKerjaJs).toContain('animate-spin text-indigo-500');
    });

    test('6. js/page-beban-kerja.js: updatePlanToolbarVisibility mengontrol tombol apply template mobile', () => {
        expect(pageBebanKerjaJs).toContain("btnApplyMobile = el('btn-apply-template-mobile')");
        expect(pageBebanKerjaJs).toContain("btnApplyMobile.classList.add('hidden', '!hidden')");
    });
});

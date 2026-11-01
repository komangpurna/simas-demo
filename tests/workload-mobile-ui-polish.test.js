/**
 * tests/workload-mobile-ui-polish.test.js
 * ====================================================================
 * Suite Pengujian Unit: Optimalisasi UI Mobile Beban Kerja,
 * Penyederhanaan Teks Istirahat, dan Anti-Truncation Layout
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Suite Pengujian: UI Mobile & Nomenklatur Istirahat Modul Beban Kerja', () => {
    const rootDir = path.resolve(__dirname, '..');
    const calcPath = path.join(rootDir, 'js', 'workload-calc.js');
    const pagePath = path.join(rootDir, 'js', 'page-beban-kerja.js');
    const workerPath = path.join(rootDir, 'cloudflare', 'worker.js');
    const htmlPath = path.join(rootDir, 'e-kinerja.html');

    const calcCode = fs.readFileSync(calcPath, 'utf8');
    const pageCode = fs.readFileSync(pagePath, 'utf8');
    const workerCode = fs.readFileSync(workerPath, 'utf8');
    const htmlCode = fs.readFileSync(htmlPath, 'utf8');

    test('1. DEFAULT_WORKLOAD_POLICY & Worker breaks menggunakan "Istirahat" tanpa embel-embel angka/resmi', () => {
        // Di js/workload-calc.js
        expect(calcCode).toMatch(/breaks:\s*Object\.freeze\(\[\s*\{\s*name:\s*'Istirahat'/);
        expect(calcCode).not.toContain("name: 'Istirahat 1'");
        expect(calcCode).not.toContain("name: 'Istirahat 2'");
        expect(calcCode).not.toContain("name: 'Istirahat Resmi'");

        // Di cloudflare/worker.js
        expect(workerCode).toContain('name: "Istirahat"');
        expect(workerCode).not.toContain('name: "Istirahat 1"');
        expect(workerCode).not.toContain('name: "Istirahat 2"');
    });

    test('2. WORKLOAD_DUTIES_CONFIG & MAIN_DUTIES_PERMEN_11_2025 memuat mobileName yang ringkas untuk 5 tugas pokok', () => {
        expect(calcCode).toContain("mobileName: '1. Pembelajaran (KBM)'");
        expect(calcCode).toContain("mobileName: '2. Perencanaan'");
        expect(calcCode).toContain("mobileName: '3. Penilaian'");
        expect(calcCode).toContain("mobileName: '4. Pembimbingan'");
        expect(calcCode).toContain("mobileName: '5. Tugas Tambahan'");

        expect(pageCode).toContain("mobileName: '1. Pembelajaran (KBM)'");
        expect(pageCode).toContain("mobileName: '2. Perencanaan'");
        expect(pageCode).toContain("mobileName: '3. Penilaian'");
        expect(pageCode).toContain("mobileName: '4. Pembimbingan'");
        expect(pageCode).toContain("mobileName: '5. Tugas Tambahan'");
    });

    test('3. Card Komposisi Tugas Pokok: item ke-5 Tugas Tambahan menggunakan col-span-2 di mobile agar seimbang', () => {
        expect(pageCode).toContain("d.code === 'TUGAS_TAMBAHAN' ? 'col-span-2 sm:col-span-1' : 'col-span-1'");
        expect(pageCode).toContain('<span class="sm:hidden">${escapeHTML(d.mobileName || d.shortName || d.name)}</span>');
        expect(pageCode).toContain('<span class="hidden sm:inline">${escapeHTML(d.shortName || d.name)}</span>');
    });

    test('4. updatePlanToolbarVisibility & updateRealisasiToolbarVisibility tidak membocorkan tombol ke tampilan mobile', () => {
        // Pastikan updatePlanToolbarVisibility mempertahankan hidden di mobile
        expect(pageCode).toContain("planToolbar.classList.add('hidden', 'sm:flex')");
        expect(pageCode).toContain("planToolbar.classList.remove('!hidden', 'flex')");

        // Pastikan updateRealisasiToolbarVisibility mempertahankan hidden di mobile
        expect(pageCode).toContain("realisasiToolbar.classList.add('hidden', 'md:flex')");
        expect(pageCode).toContain("realisasiToolbar.classList.remove('!hidden', 'flex')");
    });

    test('5. Header accordion hari kerja 1 baris compact di mobile dengan tombol + Cuti dan + HBG', () => {
        // Container 1 baris compact sejajar
        expect(pageCode).toContain('flex items-center justify-between gap-2 px-3 sm:px-4 py-2 sm:py-2.5 bg-slate-50 dark:bg-slate-800/60');

        // Tombol aksi pendek di mobile: + Cuti (desktop: + Cuti/Izin)
        expect(pageCode).toContain('+ Cuti<span class="hidden sm:inline">/Izin</span></span>');
        expect(pageCode).toMatch(/button[^>]*workloadMarkDayLeave[^>]*whitespace-nowrap[^>]*active:scale-95[^>]*cursor-pointer[^>]*shrink-0/s);

        // Tombol aksi Hari Belajar Guru: + HBG (bukan + MGMP)
        expect(pageCode).toContain('<span>+ HBG</span>');
        expect(pageCode).not.toContain('<span>+ MGMP</span>');
    });

    test('6. e-kinerja.html: banner istirahat dan badge HBG otomatis mobile telah dioptimalkan', () => {
        // Banner istirahat tanpa kata "Resmi"
        expect(htmlCode).toContain('<strong>Istirahat:</strong>');
        expect(htmlCode).not.toContain('<strong>Istirahat Resmi:</strong>');

        // Badge otomatis HBG tersembunyi di mobile agar hemat tempat (hidden sm:inline-block)
        expect(htmlCode).toContain('id="study-day-auto-badge" role="status" class="hidden sm:inline-block');
    });

    test('7. e-kinerja.html: Tombol Sinkron KBM, Terapkan, dan Simpan Template tertata dalam 1 baris (grid 3 kolom) di mobile', () => {
        expect(htmlCode).toContain('grid grid-cols-3 sm:flex sm:items-center gap-1.5');
        expect(htmlCode).toContain('id="btn-sync-kbm-schedule"');
        expect(htmlCode).toContain('id="btn-apply-template-mobile"');
        expect(htmlCode).toContain('id="btn-save-as-template-mobile"');
        expect(htmlCode).toMatch(/span id="text-sync-kbm-schedule"[^>]*font-bold whitespace-nowrap/);
    });

    test('8. e-kinerja.html: Header modul E-Kinerja Guru muat 1 baris di mobile dengan teks "Permen 11/2025"', () => {
        expect(htmlCode).toContain('<span class="sm:hidden">Permen 11/2025</span>');
        expect(htmlCode).toContain('<span class="hidden sm:inline">Permendikdasmen 11/2025</span>');
        expect(htmlCode).toContain('id="badge-plan-status"');
    });

    test('9. Baris kegiatan mobile hanya ada tombol edit, tombol hapus tersembunyi di mobile dan tersedia di modal edit rencana', () => {
        // Baris item rencana: tombol delete tersembunyi di mobile (< sm)
        expect(pageCode).toContain('window.workloadOpenPlanItemModal(${i}, \'${slot.id}\')');
        expect(pageCode).toMatch(/button onclick="window\.workloadDeletePlanItem\('\$\{slot\.id\}'\)" class="hidden sm:inline-block/);

        // Modal edit rencana: ada tombol hapus di footer modal
        expect(htmlCode).toContain('id="btn-delete-plan-item"');
        expect(htmlCode).toContain('onclick="window.workloadDeletePlanItemFromModal()"');
        expect(pageCode).toContain('window.workloadDeletePlanItemFromModal = deletePlanItemFromModal');
    });

    test('10. Banner status rencana difinalisasi/disetujui: tepat 2 baris di mobile (judul/keterangan & tombol)', () => {
        // Kontainer judul & badge tidak membungkus turun baris baru di mobile
        expect(htmlCode).toContain('id="plan-status-banner-title"');
        expect(htmlCode).toContain('<span class="sm:hidden">Rencana Difinalisasi</span>');
        expect(htmlCode).toContain('id="plan-status-banner-badge" class="shrink-0 whitespace-nowrap');

        // Teks responsif pada render JS
        expect(pageCode).toContain('<span class="sm:hidden">Rencana Difinalisasi</span>');
        expect(pageCode).toContain('<span class="sm:hidden">Rencana Disetujui</span>');
        expect(pageCode).toContain('<span class="sm:hidden">Rencana Ditinjau</span>');
    });

    test('11. Komposisi Tugas Pokok auto-collapse di tampilan mobile', () => {
        const { resolveDutySummaryCollapsed } = require('./workload-guru-utils.js');
        // Saat mobile (isMobile = true), default auto collapse (true) meskipun draft
        expect(resolveDutySummaryCollapsed('draft', null, true)).toBe(true);
        expect(resolveDutySummaryCollapsed('needs_revision', null, true)).toBe(true);

        // Di desktop (isMobile = false), tetap terbuka saat draft
        expect(resolveDutySummaryCollapsed('draft', null, false)).toBe(false);

        // Override manual tetap diutamakan
        expect(resolveDutySummaryCollapsed('draft', false, true)).toBe(false);
        expect(resolveDutySummaryCollapsed('approved', true, false)).toBe(true);
    });
});

/**
 * tests/workload-plan-duty-summary.test.js
 *
 * Pengujian Unit Komprehensif: Ringkasan Komposisi Rencana Tugas Pokok Guru
 * Sesuai Permendikdasmen No. 11/2025 (Pasal 3 & 4) terhadap Target Standar 37,5 Jam (2.250 Menit)
 *
 * Verifikasi:
 * 1. Fungsi murni calculateDutyAllocationSummary di js/workload-calc.js
 * 2. Akurasi kalkulasi persentase beban kerja 5 Unsur Tugas Pokok Guru
 * 3. Akurasi kalkulasi ekuivalensi JP (1 JP SMA = 45 menit) & dukungan jp_count
 * 4. Resolusi kode tugas pokok (segment -> activity -> catalog -> fallback is_teaching)
 * 5. Penanganan segmen Hari Libur / Dispensasi Sekolah (HOLIDAY)
 * 6. Edge cases: 0 segmen, alokasi berlebih (> 2.250 menit), data tidak lengkap
 * 7. Integritas elemen DOM #plan-duty-summary-container di e-kinerja.html
 * 8. Pendaftaran window.workloadRenderPlanDutySummary & integrasi renderPlanTab di js/page-beban-kerja.js
 */

const fs = require('node:fs');
const path = require('node:path');
const {
    calculateDutyAllocationSummary,
    WORKLOAD_DUTIES_CONFIG,
    DEFAULT_WORKLOAD_POLICY
} = require('./workload-guru-utils.js');

describe('Ringkasan Alokasi Tugas Pokok Guru (Permendikdasmen No. 11/2025)', () => {
    const rootDir = path.resolve(__dirname, '..');
    const htmlPath = path.join(rootDir, 'e-kinerja.html');
    const pageJsPath = path.join(rootDir, 'js', 'page-beban-kerja.js');

    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const pageJsContent = fs.readFileSync(pageJsPath, 'utf8');

    describe('1. Integritas Konfigurasi Tugas Pokok (SSOT)', () => {
        test('WORKLOAD_DUTIES_CONFIG mendefinisikan 5 tugas pokok resmi Permendikdasmen No. 11/2025', () => {
            expect(Array.isArray(WORKLOAD_DUTIES_CONFIG)).toBe(true);
            expect(WORKLOAD_DUTIES_CONFIG.length).toBe(5);

            const expectedCodes = [
                'PELAKSANAAN_KBM',
                'PERENCANAAN',
                'PENILAIAN',
                'PEMBIMBINGAN',
                'TUGAS_TAMBAHAN'
            ];

            const actualCodes = WORKLOAD_DUTIES_CONFIG.map(d => d.code);
            expect(actualCodes).toEqual(expectedCodes);

            // Verifikasi metadata visual
            WORKLOAD_DUTIES_CONFIG.forEach(duty => {
                expect(duty.name).toBeTruthy();
                expect(duty.fullName).toBeTruthy();
                expect(duty.icon).toBeTruthy();
                expect(duty.bgClass).toMatch(/^bg-/);
                expect(duty.textClass).toMatch(/^text-/);
            });
        });
    });

    describe('2. Logika Matematis calculateDutyAllocationSummary', () => {
        test('Menghitung alokasi proporsional 100% penuh (2.250 menit) dengan 5 tugas pokok', () => {
            const segments = [
                // 1. KBM: 24 JP = 1.080 menit (48%)
                { id: 's1', category_code: 'PELAKSANAAN_KBM', planned_minutes: 1080, jp_count: 24, is_teaching: 1 },
                // 2. Perencanaan: 450 menit (20%)
                { id: 's2', category_code: 'PERENCANAAN', planned_minutes: 450 },
                // 3. Penilaian: 270 menit (12%)
                { id: 's3', category_code: 'PENILAIAN', planned_minutes: 270 },
                // 4. Pembimbingan: 180 menit (8%)
                { id: 's4', category_code: 'PEMBIMBINGAN', planned_minutes: 180 },
                // 5. Tugas Tambahan: 270 menit (12%)
                { id: 's5', category_code: 'TUGAS_TAMBAHAN', planned_minutes: 270 }
            ];

            const result = calculateDutyAllocationSummary(segments, [], [], 2250);

            expect(result.targetMinutes).toBe(2250);
            expect(result.totalPlannedMinutes).toBe(2250);
            expect(result.totalPercentage).toBe(100);
            expect(result.remainingMinutes).toBe(0);
            expect(result.remainingPercentage).toBe(0);

            const kbm = result.duties.find(d => d.code === 'PELAKSANAAN_KBM');
            expect(kbm.plannedMinutes).toBe(1080);
            expect(kbm.equivalentJp).toBe(24);
            expect(kbm.percentage).toBe(48.0);

            const rencana = result.duties.find(d => d.code === 'PERENCANAAN');
            expect(rencana.plannedMinutes).toBe(450);
            expect(rencana.equivalentJp).toBe(10);
            expect(rencana.percentage).toBe(20.0);

            const nilai = result.duties.find(d => d.code === 'PENILAIAN');
            expect(nilai.plannedMinutes).toBe(270);
            expect(nilai.equivalentJp).toBe(6);
            expect(nilai.percentage).toBe(12.0);

            const bimbing = result.duties.find(d => d.code === 'PEMBIMBINGAN');
            expect(bimbing.plannedMinutes).toBe(180);
            expect(bimbing.equivalentJp).toBe(4);
            expect(bimbing.percentage).toBe(8.0);

            const tambahan = result.duties.find(d => d.code === 'TUGAS_TAMBAHAN');
            expect(tambahan.plannedMinutes).toBe(270);
            expect(tambahan.equivalentJp).toBe(6);
            expect(tambahan.percentage).toBe(12.0);
        });

        test('Menangani alokasi parsial: total menit < 2.250 menyisakan remainingMinutes & remainingPercentage', () => {
            const segments = [
                // Hanya input KBM 24 JP = 1.080 menit (48%)
                { id: 's1', category_code: 'PELAKSANAAN_KBM', planned_minutes: 1080 }
            ];

            const result = calculateDutyAllocationSummary(segments, [], [], 2250);

            expect(result.totalPlannedMinutes).toBe(1080);
            expect(result.totalPercentage).toBe(48.0);
            expect(result.remainingMinutes).toBe(1170); // 2250 - 1080
            expect(result.remainingPercentage).toBe(52.0);

            const kbm = result.duties.find(d => d.code === 'PELAKSANAAN_KBM');
            expect(kbm.plannedMinutes).toBe(1080);
            expect(kbm.percentage).toBe(48.0);

            const rencana = result.duties.find(d => d.code === 'PERENCANAAN');
            expect(rencana.plannedMinutes).toBe(0);
            expect(rencana.percentage).toBe(0);
        });

        test('Menangani alokasi berlebih (> 2.250 menit) tanpa nilai negatif', () => {
            const segments = [
                { id: 's1', category_code: 'PELAKSANAAN_KBM', planned_minutes: 1350 }, // 30 JP = 60%
                { id: 's2', category_code: 'PERENCANAAN', planned_minutes: 600 },     // 26.7%
                { id: 's3', category_code: 'TUGAS_TAMBAHAN', planned_minutes: 540 }   // 24%
            ];

            const result = calculateDutyAllocationSummary(segments, [], [], 2250);

            expect(result.totalPlannedMinutes).toBe(2490);
            expect(result.totalPercentage).toBe(110.7);
            expect(result.remainingMinutes).toBe(0);
            expect(result.remainingPercentage).toBe(0);
        });

        test('Menangani segmen 0 atau kosong dengan aman (0 crash, 0 NaN)', () => {
            const result = calculateDutyAllocationSummary([], [], [], 2250);

            expect(result.targetMinutes).toBe(2250);
            expect(result.totalPlannedMinutes).toBe(0);
            expect(result.totalPercentage).toBe(0);
            expect(result.remainingMinutes).toBe(2250);
            expect(result.remainingPercentage).toBe(100);
            expect(result.duties.every(d => d.plannedMinutes === 0 && d.percentage === 0)).toBe(true);
        });

        test('Mendukung resolusi cascading: segment -> activity -> catalog -> fallback is_teaching', () => {
            const activities = [
                { id: 'act_1', category_code: 'PENILAIAN' },
                { id: 'act_2', catalog_id: 'cat_custom', category_code: 'PEMBIMBINGAN' }
            ];

            const catalog = [
                { id: 'cat_wali', category_code: 'TUGAS_TAMBAHAN' }
            ];

            const segments = [
                // Melalui activity_id
                { id: 's1', activity_id: 'act_1', planned_minutes: 90 },
                // Melalui activity_id -> catalog
                { id: 's2', activity_id: 'act_2', planned_minutes: 90 },
                // Melalui catalog_id langsung
                { id: 's3', catalog_id: 'cat_wali', planned_minutes: 90 },
                // Melalui fallback is_teaching
                { id: 's4', is_teaching: 1, planned_minutes: 90 },
                // Melalui default fallback
                { id: 's5', title: 'Aktivitas Umum', planned_minutes: 90 }
            ];

            const result = calculateDutyAllocationSummary(segments, activities, catalog, 2250);

            const nilai = result.duties.find(d => d.code === 'PENILAIAN');
            expect(nilai.plannedMinutes).toBe(90);

            const bimbing = result.duties.find(d => d.code === 'PEMBIMBINGAN');
            expect(bimbing.plannedMinutes).toBe(90);

            const tambahan = result.duties.find(d => d.code === 'TUGAS_TAMBAHAN');
            expect(tambahan.plannedMinutes).toBe(90);

            const kbm = result.duties.find(d => d.code === 'PELAKSANAAN_KBM');
            expect(kbm.plannedMinutes).toBe(90);

            const rencana = result.duties.find(d => d.code === 'PERENCANAAN');
            expect(rencana.plannedMinutes).toBe(90);
        });

        test('Menghitung hari libur / dispensasi sekolah secara terpisah tanpa merusak statistik tugas pokok', () => {
            const segments = [
                { id: 's1', is_holiday: true, planned_minutes: 450 },
                { id: 's2', category_code: 'PELAKSANAAN_KBM', planned_minutes: 1080 }
            ];

            const result = calculateDutyAllocationSummary(segments, [], [], 2250);

            expect(result.holidayMinutes).toBe(450);
            expect(result.holidayPercentage).toBe(20.0);
            expect(result.totalPlannedMinutes).toBe(1530); // 450 + 1080
            expect(result.totalPercentage).toBe(68.0);

            const kbm = result.duties.find(d => d.code === 'PELAKSANAAN_KBM');
            expect(kbm.plannedMinutes).toBe(1080);
            expect(kbm.percentage).toBe(48.0);
        });
    });

    describe('3. Verifikasi DOM HTML & Integrasi Skrip Halaman', () => {
        test('e-kinerja.html memuat kontainer #plan-duty-summary-container tepat di atas #weekly-plan-accordion', () => {
            expect(htmlContent).toContain('id="plan-duty-summary-container"');
            expect(htmlContent).toContain('id="weekly-plan-accordion"');

            const summaryPos = htmlContent.indexOf('id="plan-duty-summary-container"');
            const accordionPos = htmlContent.indexOf('id="weekly-plan-accordion"');

            expect(summaryPos).toBeGreaterThan(0);
            expect(accordionPos).toBeGreaterThan(0);
            expect(summaryPos).toBeLessThan(accordionPos);
        });

        test('js/page-beban-kerja.js mengekspos window.workloadRenderPlanDutySummary dan memanggilnya di renderPlanTab', () => {
            expect(pageJsContent).toContain('window.workloadRenderPlanDutySummary = renderPlanDutySummary;');
            expect(pageJsContent).toContain('function renderPlanDutySummary()');
            expect(pageJsContent).toContain('renderPlanDutySummary();');
        });

        test('renderPlanDutySummary merender komponen multi-segment bar dan chip statistik tugas pokok', () => {
            expect(pageJsContent).toContain('Komposisi Tugas Pokok');
            expect(pageJsContent).toMatch(/Permendikdasmen (?:No\. )?11\/2025/);
            expect(pageJsContent).toContain('calculateDutyAllocationSummary(');
            expect(pageJsContent).toContain('formatDurationDisplay(');
        });

        test('switchTab di js/page-beban-kerja.js hanya memunculkan #kpi-summary-strip saat tab-today aktif', () => {
            expect(pageJsContent).toContain("if (tabId === 'tab-today')");
            expect(pageJsContent).toContain("kpiStrip.classList.remove('hidden')");
            expect(pageJsContent).toContain("kpiStrip.classList.add('hidden')");
        });

        test('#kpi-summary-strip di e-kinerja.html berada di dalam tab-content-today (di bawah 4 tab navigasi)', () => {
            const todayIndex = htmlContent.indexOf('id="tab-content-today"');
            const kpiIndex = htmlContent.indexOf('id="kpi-summary-strip"');
            const planIndex = htmlContent.indexOf('id="tab-content-plan"');
            expect(todayIndex).toBeGreaterThan(-1);
            expect(kpiIndex).toBeGreaterThan(todayIndex);
            expect(kpiIndex).toBeLessThan(planIndex);
        });

        test('#kpi-summary-strip mengadopsi 1 unified compact grid 3-kolom pada mobile dan 3 kartu terpisah pada desktop', () => {
            expect(htmlContent).toContain('id="kpi-summary-strip" class="grid grid-cols-3 md:grid-cols-3 gap-0 md:gap-2 mb-1 bg-white dark:bg-slate-900 md:bg-transparent md:dark:bg-transparent rounded-xl md:rounded-none border border-slate-100 dark:border-slate-800 md:border-0 shadow-2xs md:shadow-none divide-x divide-slate-100 dark:divide-slate-800 md:divide-x-0 overflow-hidden md:overflow-visible"');
            expect(htmlContent).toContain('id="kpi-planned-minutes"');
            expect(htmlContent).toContain('id="kpi-actual-minutes"');
            expect(htmlContent).toContain('id="kpi-teaching-jp"');
            expect(htmlContent).toContain('id="bar-planned-progress"');
            expect(htmlContent).toContain('id="kpi-verified-status"');
            expect(htmlContent).toContain('id="kpi-teaching-status"');
        });

        test('Toolbar Penyusunan Rencana Kerja Mingguan di e-kinerja.html menggunakan tata letak ultra compact', () => {
            expect(htmlContent).toContain('Penyusunan Rencana Kerja Mingguan');
            expect(htmlContent).toContain('id="tab-content-plan" class="tab-workload-panel hidden space-y-2.5 transition-opacity duration-200"');
            expect(htmlContent).toContain('id="weekly-plan-accordion" class="space-y-2.5"');
        });
    });

    describe('4. Interaktivitas Klik 5 Grid & Expand Durasi/JP per Kategori Kegiatan', () => {
        test('calculateDutyAllocationSummary menghasilkan struktur categories dan availableCatalog per tugas pokok', () => {
            const segments = [
                // 2 kegiatan KBM berbeda (KBM intrakurikuler dan KBM P5)
                { id: 's1', catalog_id: 'cat_kbm', category_code: 'PELAKSANAAN_KBM', planned_minutes: 360, jp_count: 8, day_of_week: 1, start_time: '07:30', end_time: '13:30', title: 'KBM Kimia XII-1' },
                { id: 's2', catalog_id: 'cat_kbm_p5', category_code: 'PELAKSANAAN_KBM', planned_minutes: 180, jp_count: 4, day_of_week: 2, start_time: '07:30', end_time: '10:30', title: 'Fasilitasi P5 Kebhinekaan' },
                // 1 kegiatan Perencanaan (Modul Ajar)
                { id: 's3', catalog_id: 'cat_rencana_modul', category_code: 'PERENCANAAN', planned_minutes: 450, day_of_week: 5, start_time: '07:30', end_time: '15:30', title: 'Penyusunan Modul Ajar Kimia' }
            ];

            const catalog = [
                { id: 'cat_kbm', name: 'KBM Tatap Muka Intrakurikuler', category_code: 'PELAKSANAAN_KBM', description: 'KBM kelas' },
                { id: 'cat_kbm_p5', name: 'Pembelajaran Kokurikuler (P5)', category_code: 'PELAKSANAAN_KBM', description: 'P5' },
                { id: 'cat_kbm_ekstra', name: 'Pembelajaran Ekstrakurikuler', category_code: 'PELAKSANAAN_KBM', description: 'Ekstra' },
                { id: 'cat_rencana_modul', name: 'Pembuatan Modul Ajar / RPP', category_code: 'PERENCANAAN', description: 'Modul ajar' },
                { id: 'cat_rencana_kurikulum', name: 'Pengkajian Kurikulum Satuan Pendidikan', category_code: 'PERENCANAAN', description: 'Kurikulum' }
            ];

            const result = calculateDutyAllocationSummary(segments, [], catalog, 2250);

            const kbmDuty = result.duties.find(d => d.code === 'PELAKSANAAN_KBM');
            expect(kbmDuty.plannedMinutes).toBe(540);
            expect(kbmDuty.equivalentJp).toBe(12);
            expect(Array.isArray(kbmDuty.categories)).toBe(true);
            expect(kbmDuty.categories.length).toBe(2);

            // Kategori 1: cat_kbm (360m / 8 JP)
            const catKbm = kbmDuty.categories.find(c => c.id === 'cat_kbm');
            expect(catKbm).toBeDefined();
            expect(catKbm.plannedMinutes).toBe(360);
            expect(catKbm.equivalentJp).toBe(8);
            expect(catKbm.segmentsCount).toBe(1);
            expect(catKbm.segments[0].title).toBe('KBM Kimia XII-1');

            // Kategori 2: cat_kbm_p5 (180m / 4 JP)
            const catP5 = kbmDuty.categories.find(c => c.id === 'cat_kbm_p5');
            expect(catP5).toBeDefined();
            expect(catP5.plannedMinutes).toBe(180);
            expect(catP5.equivalentJp).toBe(4);

            // availableCatalog memuat kategori standar yang belum dialokasikan (cat_kbm_ekstra)
            expect(Array.isArray(kbmDuty.availableCatalog)).toBe(true);
            expect(kbmDuty.availableCatalog.some(c => c.id === 'cat_kbm_ekstra')).toBe(true);
            expect(kbmDuty.availableCatalog.some(c => c.id === 'cat_kbm')).toBe(false);

            // Perencanaan: 1 kategori aktif (cat_rencana_modul), 1 katalog belum dialokasikan
            const rencanaDuty = result.duties.find(d => d.code === 'PERENCANAAN');
            expect(rencanaDuty.categories.length).toBe(1);
            expect(rencanaDuty.categories[0].plannedMinutes).toBe(450);
            expect(rencanaDuty.categories[0].equivalentJp).toBe(10);
            expect(rencanaDuty.availableCatalog.some(c => c.id === 'cat_rencana_kurikulum')).toBe(true);
        });

        test('js/page-beban-kerja.js mengimplementasikan toggleDutyExpand dan mendaftarkannya ke window global scope', () => {
            expect(pageJsContent).toContain('export function toggleDutyExpand(dutyCode)');
            expect(pageJsContent).toContain('window.workloadToggleDutyExpand = toggleDutyExpand;');
            expect(pageJsContent).toContain('window.workloadToggleDutyExpand(');
            expect(pageJsContent).toContain('id="plan-duty-expanded-panel"');
        });

        test('renderPlanDutySummary menyediakan event click interaktif pada masing-masing 5 grid card dan progress bar', () => {
            expect(pageJsContent).toContain("onclick=\"window.workloadToggleDutyExpand('${d.code}')\"");
            expect(pageJsContent).toContain('role="button"');
            expect(pageJsContent).toContain('cursor-pointer');
            expect(pageJsContent).toContain('fa-chevron-down');
            expect(pageJsContent).toContain('fa-chevron-up');
        });
    });
});



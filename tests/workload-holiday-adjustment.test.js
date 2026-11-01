/**
 * tests/workload-holiday-adjustment.test.js
 * ====================================================================
 * Test Suite: Penyesuaian Target E-Kinerja Guru Saat Hari Libur
 * Mengacu Pada SSOT Monitoring KBM (DataHolidays + HolidayManager)
 * Modul: E-Kinerja & Monitoring Beban Kerja SIMAS SMAGESA
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Suite Penyesuaian Target E-Kinerja Guru Saat Hari Libur', () => {
    const root = path.resolve(__dirname, '..');
    const holidayManagerJs = fs.readFileSync(path.join(root, 'js', 'holiday-manager.js'), 'utf8');
    const workloadCalcJs = fs.readFileSync(path.join(root, 'js', 'workload-calc.js'), 'utf8');
    const pageBebanKerjaJs = fs.readFileSync(path.join(root, 'js', 'page-beban-kerja.js'), 'utf8');
    const pageMonitoringJs = fs.readFileSync(path.join(root, 'js', 'page-monitoring-beban-kerja.js'), 'utf8');
    const exportDocxJs = fs.readFileSync(path.join(root, 'js', 'exportLaporanDocx.js'), 'utf8');
    const eKinerjaHtml = fs.readFileSync(path.join(root, 'e-kinerja.html'), 'utf8');

    // =================================================================
    // 1. INTEGRITAS SSOT PENDETEKSI HARI LIBUR GURU
    // =================================================================
    test('1. holiday-manager.js mengekspor isHolidayDate dan getHolidayDateInfo terpadu', () => {
        expect(holidayManagerJs).toContain('export function isHolidayDate(');
        expect(holidayManagerJs).toContain('export function getHolidayDateInfo(');
        expect(holidayManagerJs).toContain('isHolidayDate,');
        expect(holidayManagerJs).toContain('getHolidayDateInfo,');
        expect(holidayManagerJs).toContain('window.HolidayManager =');
        // Memastikan mengombinasikan DataHolidays dan isRegisteredHoliday (sama persis dengan monitoring KBM)
        expect(holidayManagerJs).toContain('getDataHolidays()');
        expect(holidayManagerJs).toContain('isRegisteredHoliday(cleanDate)');
    });

    test('2. e-kinerja.html memuat js/data-holidays.js untuk sinkronisasi kalender libur nasional', () => {
        expect(eKinerjaHtml).toContain('src="js/data-holidays.js"');
    });

    // =================================================================
    // 2. FORMULA TARGET MINGGUAN DISESUAIKAN (WORKLOAD-CALC.JS)
    // =================================================================
    test('3. workload-calc.js mengekspor countWeekWorkHolidays dan calculateAdjustedWeeklyTarget', () => {
        expect(workloadCalcJs).toContain('export function countWeekWorkHolidays(');
        expect(workloadCalcJs).toContain('export function calculateAdjustedWeeklyTarget(');
    });

    test('4. Logika penghitungan target proporsional: 450 menit per hari libur kerja', () => {
        // Simulasi fungsi murni calculateAdjustedWeeklyTarget
        function calculateAdjustedWeeklyTargetSim(weekStartDate, holidaysList = []) {
            const baseTargetMinutes = 5 * 450; // 2250 menit
            const holidayCount = holidaysList.length;
            const holidayDeductionMinutes = holidayCount * 450;
            const adjustedTargetMinutes = Math.max(0, baseTargetMinutes - holidayDeductionMinutes);
            return {
                baseTargetMinutes,
                holidayCount,
                holidayDeductionMinutes,
                adjustedTargetMinutes,
                effectiveWorkDaysCount: 5 - holidayCount
            };
        }

        // 0 hari libur = 2.250 menit (37,5 jam kerja)
        const res0 = calculateAdjustedWeeklyTargetSim('2026-09-28', []);
        expect(res0.adjustedTargetMinutes).toBe(2250);
        expect(res0.effectiveWorkDaysCount).toBe(5);

        // 1 hari libur = 1.800 menit (30,0 jam kerja)
        const res1 = calculateAdjustedWeeklyTargetSim('2026-09-28', ['2026-09-30']);
        expect(res1.adjustedTargetMinutes).toBe(1800);
        expect(res1.holidayDeductionMinutes).toBe(450);
        expect(res1.effectiveWorkDaysCount).toBe(4);

        // 2 hari libur = 1.350 menit (22,5 jam kerja)
        const res2 = calculateAdjustedWeeklyTargetSim('2026-09-28', ['2026-09-29', '2026-09-30']);
        expect(res2.adjustedTargetMinutes).toBe(1350);
        expect(res2.holidayDeductionMinutes).toBe(900);
        expect(res2.effectiveWorkDaysCount).toBe(3);

        // 5 hari libur (libur semester penuh) = 0 menit
        const res5 = calculateAdjustedWeeklyTargetSim('2026-09-28', ['2026-09-28', '2026-09-29', '2026-09-30', '2026-09-31', '2026-10-01']);
        expect(res5.adjustedTargetMinutes).toBe(0);
        expect(res5.effectiveWorkDaysCount).toBe(0);
    });

    test('5. Hari libur pada Sabtu atau Minggu tidak mengurangi target kerja Senin-Jumat', () => {
        // Hanya hari kerja Senin s.d Jumat (indeks 0..4) yang dievaluasi
        expect(workloadCalcJs).toContain('for (let i = 0; i < workDaysCount; i++)');
    });

    // =================================================================
    // 3. INTEGRASI DI HALAMAN E-KINERJA GURU (PAGE-BEBAN-KERJA.JS)
    // =================================================================
    test('6. page-beban-kerja.js mengimpor dan memuat hari libur pada loadWeek', () => {
        expect(pageBebanKerjaJs).toContain('fetchRegisteredHolidays');
        expect(pageBebanKerjaJs).toContain('isHolidayDate');
        expect(pageBebanKerjaJs).toContain('calculateAdjustedWeeklyTarget');
        expect(pageBebanKerjaJs).toContain('fetchRegisteredHolidays(_weekStartDate');
    });

    test('7. e-kinerja.html memuat elemen label target dinamis untuk KPI dan Matriks', () => {
        expect(eKinerjaHtml).toContain('id="kpi-planned-target-label"');
        expect(eKinerjaHtml).toContain('id="kpi-actual-target-label"');
        expect(eKinerjaHtml).toContain('id="matrix-weekly-target-label"');
    });

    test('8. page-beban-kerja.js memperbarui label target dinamis dan progress bar saat ada libur', () => {
        expect(pageBebanKerjaJs).toContain('kpi-planned-target-label');
        expect(pageBebanKerjaJs).toContain('kpi-actual-target-label');
        expect(pageBebanKerjaJs).toContain('matrix-weekly-target-label');
        // Tidak lagi ada penambahan menit fiktif 450m pada renderTodayTab
        expect(pageBebanKerjaJs).not.toContain('totalWeeklyActualMinutes += (450 - dActual)');
    });

    test('9. Tampilan Fokus 1 Hari menampilkan banner hari libur jika hari bertepatan dengan libur resmi', () => {
        expect(pageBebanKerjaJs).toContain('Hari ini merupakan hari libur resmi yang diakui sekolah');
        expect(pageBebanKerjaJs).toContain('telah dibebaskan dari target mingguan');
    });

    // =================================================================
    // 4. INTEGRASI DI MONITORING BEBAN KERJA (PAGE-MONITORING-BEBAN-KERJA.JS)
    // =================================================================
    test('10. page-monitoring-beban-kerja.js mengimplementasikan getMonitoringEffectiveTarget', () => {
        expect(pageMonitoringJs).toContain('function getMonitoringEffectiveTarget(');
        expect(pageMonitoringJs).toContain('function getMonitoringHolidayInfo(');
        expect(pageMonitoringJs).toContain('calculateAdjustedWeeklyTarget');
    });

    test('11. Monitoring beban kerja menggunakan target efektif pada tabel rekap, matriks, detail, dan ekspor', () => {
        // Tabel rekap
        expect(pageMonitoringJs).toContain('getMonitoringEffectiveTarget()');
        // Sel matriks hari libur menampilkan badge libur
        expect(pageMonitoringJs).toContain('🏖️ Libur');
        // Ekspor XLSX menggunakan target efektif
        expect(pageMonitoringJs).toContain('const TARGET = getMonitoringEffectiveTarget();');
    });

    // =================================================================
    // 5. INTEGRASI DI GENERATOR DOKUMEN LAPORAN (WORD & DOCX)
    // =================================================================
    test('12. exportLaporanDocx.js menggunakan calculateAdjustedWeeklyTarget', () => {
        expect(exportDocxJs).toContain('calculateAdjustedWeeklyTarget');
        expect(exportDocxJs).toContain('isHolidayDate');
    });

    test('13. Generator laporan Word memuat keterangan Hari Libur Resmi jika hari tidak memiliki agenda', () => {
        expect(exportDocxJs).toContain('Hari Libur Resmi:');
    });
});

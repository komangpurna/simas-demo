/**
 * tests/workload-holiday-template-skip.test.js
 * ====================================================================
 * Test Suite: Deteksi & Auto-Skip Hari Libur Resmi pada Template E-Kinerja Guru
 * Mengacu Pada SSOT SIMAS SMAGESA (PRD 23.15, 23.21 & Permendikdasmen 11/2025)
 * Memverifikasi:
 * 1. Backend Cloudflare Worker (apply-template, deduplicate-plan, sync-schedule)
 * 2. Antarmuka Modal Terapkan Template & Accordion Hari Libur (e-kinerja.html & page-beban-kerja.js)
 * 3. Ekspor Dokumen DOCX Laporan Realisasi Beban Kerja (exportLaporanDocx.js)
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Suite Deteksi & Auto-Skip Hari Libur Resmi pada Template E-Kinerja Guru', () => {
    const root = path.resolve(__dirname, '..');
    const workerJs = fs.readFileSync(path.join(root, 'cloudflare', 'worker.js'), 'utf8');
    const eKinerjaHtml = fs.readFileSync(path.join(root, 'e-kinerja.html'), 'utf8');
    const pageBebanKerjaJs = fs.readFileSync(path.join(root, 'js', 'page-beban-kerja.js'), 'utf8');
    const exportDocxJs = fs.readFileSync(path.join(root, 'js', 'exportLaporanDocx.js'), 'utf8');

    // =================================================================
    // 1. BACKEND CLOUDFLARE WORKER: AUTO-SKIP & BERSIHKAN HARI LIBUR
    // =================================================================
    test('1. worker.js pada POST /api/workload/apply-template mengidentifikasi hari libur resmi dan cuti', () => {
        expect(workerJs).toContain('path === "/api/workload/apply-template"');
        expect(workerJs).toContain('holidayDatesSet');
        expect(workerJs).toContain('category = \'libur\' OR color = \'rose\'');
        expect(workerJs).toContain('leaveDatesSet');
        // Auto-skip item template pada hari libur resmi atau hari cuti
        expect(workerJs).toContain('if (holidayDatesSet.has(dateStr) || leaveDatesSet.has(dateStr))');
        expect(workerJs).toContain('skippedHolidaysCount++');
    });

    test('2. worker.js pada apply-template mode replace_existing membersihkan segmen draf non-log di hari libur', () => {
        expect(workerJs).toContain('if (replace_existing)');
        // Mempertahankan segmen cuti/izin
        expect(workerJs).toContain('s.is_leave === 1 || s.catalog_id === \'cat_cuti_izin\'');
        expect(workerJs).toContain('batchStatements.push(env.DB.prepare("DELETE FROM plan_time_segments WHERE id = ?")');
        // Meneruskan holiday_dates ke performDeduplicatePlanWl
        expect(workerJs).toContain('holiday_dates: Array.from(holidayDatesSet)');
    });

    test('3. worker.js menyertakan informasi skipped_holidays pada respon sukses apply-template', () => {
        expect(workerJs).toContain('skipped_holidays: skippedHolidaysCount');
        expect(workerJs).toContain('kegiatan hari libur dilewati');
    });

    test('4. performDeduplicatePlanWl di worker.js secara otomatis membersihkan draf rencana tanpa log di hari libur', () => {
        expect(workerJs).toContain('async function performDeduplicatePlanWl(db, plan_version_id, work_week_id, options = {})');
        expect(workerJs).toContain('holidayDatesSet.has(s.date) && s.has_log === 0 && !isLeaveSeg && !isHolidaySeg');
        expect(workerJs).toContain('idsToDelete.add(s.id)');
    });

    test('5. POST /api/workload/sync-schedule di worker.js otomatis melewati KBM pada hari libur resmi', () => {
        expect(workerJs).toContain('path === "/api/workload/sync-schedule"');
        expect(workerJs).toContain('if (holidayDatesSet.has(s.date))');
        expect(workerJs).toContain('skippedCount++;');
    });

    // =================================================================
    // 2. ANTARMUKA MODAL & UI FEEDBACK (E-KINERJA.HTML & PAGE-BEBAN-KERJA.JS)
    // =================================================================
    test('6. e-kinerja.html memuat elemen peringatan hari libur pada modal apply template (#apply-template-holiday-alert)', () => {
        expect(eKinerjaHtml).toContain('id="modal-apply-template"');
        expect(eKinerjaHtml).toContain('id="apply-template-holiday-alert"');
    });

    test('7. page-beban-kerja.js openApplyTemplateModal mendeteksi hari libur pekan aktif dan merender alert edukatif', () => {
        expect(pageBebanKerjaJs).toContain('apply-template-holiday-alert');
        expect(pageBebanKerjaJs).toContain('isHolidayDate(dStr)');
        expect(pageBebanKerjaJs).toContain('getHolidayDateInfo(dStr)');
        expect(pageBebanKerjaJs).toContain('Pekan ini memiliki');
        expect(pageBebanKerjaJs).toContain('hari libur resmi:');
        expect(pageBebanKerjaJs).toContain('Kegiatan template pada hari libur otomatis dilewati');
    });

    test('8. confirmApplyTemplate mengirimkan daftar tanggal libur resmi (holiday_dates) dan mengecualikan hari libur dari pencocokan identik', () => {
        expect(pageBebanKerjaJs).toContain('effectiveTemplateItems = templateItems.filter(');
        expect(pageBebanKerjaJs).toContain('!holidaySet.has(targetDate)');
        expect(pageBebanKerjaJs).toContain('holiday_dates: weekHolidays');
    });

    test('9. Accordion Tab Rencana menampilkan peringatan dan tombol pembersihan cepat jika terdeteksi rencana draf tersimpan di hari libur', () => {
        expect(pageBebanKerjaJs).toContain('ghostSegments = daySegments.filter(s => !s.is_holiday');
        expect(pageBebanKerjaJs).toContain('Terdeteksi');
        expect(pageBebanKerjaJs).toContain('kegiatan rencana tersimpan di hari libur ini');
        expect(pageBebanKerjaJs).toContain('window.workloadClearHolidayDraftItems');
    });

    test('10. Fungsi window.workloadClearHolidayDraftItems didefinisikan dan mengeksekusi cfCleanWorkloadHolidayDrafts', () => {
        expect(pageBebanKerjaJs).toContain('async function clearHolidayDraftItems(dateStr)');
        expect(pageBebanKerjaJs).toContain('window.workloadClearHolidayDraftItems = clearHolidayDraftItems');
        expect(pageBebanKerjaJs).toContain('cfCleanWorkloadHolidayDrafts');
    });

    // =================================================================
    // 3. PENYELARASAN PADA SINKRONISASI aSc TIMETABLES
    // =================================================================
    test('11. loadAndRenderSchedulePreview menandai sesi jadwal KBM pada hari libur sebagai is_holiday_blocked', () => {
        expect(pageBebanKerjaJs).toContain('const isDayHoliday = isHolidayDate(dayDate)');
        expect(pageBebanKerjaJs).toContain('is_holiday_blocked: isDayHoliday');
        expect(pageBebanKerjaJs).toContain('selected: !alreadyInPlan && !isHoliday');
    });

    test('12. renderSyncScheduleUI menampilkan badge Libur Resmi dan menonaktifkan centang jadwal di hari libur', () => {
        expect(pageBebanKerjaJs).toContain('Libur Resmi</span>');
        expect(pageBebanKerjaJs).toContain('it.is_holiday_blocked');
        expect(pageBebanKerjaJs).toContain('toggleSelectAllSync');
        expect(pageBebanKerjaJs).toContain('!it.is_holiday_blocked');
    });

    test('13. confirmSyncSchedule mengirimkan holiday_dates ke backend', () => {
        expect(pageBebanKerjaJs).toContain('holiday_dates: weekHolidays');
    });

    // =================================================================
    // 4. EKSPOR DOKUMEN WORD (EXPORTLAPORANDOCX.JS)
    // =================================================================
    test('14. exportLaporanDocx.js memprioritaskan keterangan Hari Libur Resmi jika hari berstatus libur dan belum ada realisasi', () => {
        expect(exportDocxJs).toContain('const isHol = isHolidayDate(dayDate);');
        expect(exportDocxJs).toContain('if (isHol && dayLogs.length === 0)');
        expect(exportDocxJs).toContain('Hari Libur Resmi:');
        expect(exportDocxJs).toContain('status: \'Libur Resmi\'');
    });
});

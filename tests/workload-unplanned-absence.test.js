const fs = require('fs');
const path = require('path');

describe('E-Kinerja Unplanned Absence Feature Suite (Sakit/Cuti/Izin di Luar Rencana)', () => {
    const rootDir = path.resolve(__dirname, '..');
    const htmlPath = path.join(rootDir, 'e-kinerja.html');
    const pageBebanKerjaPath = path.join(rootDir, 'js', 'page-beban-kerja.js');
    const exportDocxPath = path.join(rootDir, 'js', 'exportLaporanDocx.js');

    let htmlContent;
    let bebanKerjaContent;
    let exportDocxContent;

    beforeAll(() => {
        htmlContent = fs.readFileSync(htmlPath, 'utf8');
        bebanKerjaContent = fs.readFileSync(pageBebanKerjaPath, 'utf8');
        exportDocxContent = fs.readFileSync(exportDocxPath, 'utf8');
    });

    test('1. e-kinerja.html memuat tombol aksi tidak terlaksana pada header agenda harian', () => {
        expect(htmlContent).toContain('id="btn-day-unplanned-absence"');
        expect(htmlContent).toContain('id="label-btn-day-unplanned-absence"');
        expect(htmlContent).toContain('window.workloadOpenUnplannedAbsenceModal()');
    });

    test('2. e-kinerja.html memuat banner status harian tidak terlaksana', () => {
        expect(htmlContent).toContain('id="unplanned-absence-day-banner"');
        expect(htmlContent).toContain('id="unplanned-absence-banner-type-badge"');
        expect(htmlContent).toContain('id="unplanned-absence-banner-notes"');
    });

    test('3. e-kinerja.html memuat modal dialog #modal-unplanned-absence di luar <main> (Modal Anti-Nesting Mandate)', () => {
        expect(htmlContent).toContain('id="modal-unplanned-absence"');
        expect(htmlContent).toContain('id="form-unplanned-absence"');
        expect(htmlContent).toContain('id="unplanned-absence-type"');
        expect(htmlContent).toContain('id="unplanned-absence-notes"');
        expect(htmlContent).toContain('id="btn-cancel-unplanned-absence"');
        expect(htmlContent).toContain('id="btn-submit-unplanned-absence"');

        // Pastikan modal berada setelah penutup </main>
        const mainCloseIndex = htmlContent.indexOf('</main>');
        const modalIndex = htmlContent.indexOf('id="modal-unplanned-absence"');
        expect(mainCloseIndex).toBeGreaterThan(0);
        expect(modalIndex).toBeGreaterThan(mainCloseIndex);
    });

    test('4. Dropdown alasan memuat pilihan Sakit, Cuti, dan Izin', () => {
        expect(htmlContent).toContain('<option value="Sakit"');
        expect(htmlContent).toContain('<option value="Cuti"');
        expect(htmlContent).toContain('<option value="Izin"');
    });

    test('5. js/page-beban-kerja.js mendaftarkan seluruh handler global di window', () => {
        expect(bebanKerjaContent).toContain('window.workloadOpenUnplannedAbsenceModal = openUnplannedAbsenceModal;');
        expect(bebanKerjaContent).toContain('window.workloadCloseUnplannedAbsenceModal = closeUnplannedAbsenceModal;');
        expect(bebanKerjaContent).toContain('window.workloadSubmitUnplannedAbsence = submitUnplannedAbsence;');
        expect(bebanKerjaContent).toContain('window.workloadCancelUnplannedAbsence = cancelUnplannedAbsence;');
    });

    test('6. js/page-beban-kerja.js mengimplementasikan logika submit, cancel, dan UI updater', () => {
        expect(bebanKerjaContent).toContain('function openUnplannedAbsenceModal(');
        expect(bebanKerjaContent).toContain('function closeUnplannedAbsenceModal(');
        expect(bebanKerjaContent).toContain('async function submitUnplannedAbsence(');
        expect(bebanKerjaContent).toContain('async function cancelUnplannedAbsence(');
        expect(bebanKerjaContent).toContain('function updateUnplannedAbsenceUI(');
    });

    test('7. Format obstacle_notes mengikuti standar [Jenis] Keterangan', () => {
        expect(bebanKerjaContent).toContain('`[${type}] ${rawNotes}`');
        expect(bebanKerjaContent).toContain("/^\\[(Sakit|Cuti|Izin)\\]/i");
    });

    test('8. js/exportLaporanDocx.js memformat status dan hasil untuk kegiatan tidak terlaksana karena Sakit/Cuti/Izin', () => {
        expect(exportDocxContent).toContain("/^\\[(Sakit|Cuti|Izin)\\]\\s*(.*)/i");
        expect(exportDocxContent).toContain("Tidak Terlaksana (${absenceMatch[1]})");
        expect(exportDocxContent).toContain("Tidak terlaksana (${absenceMatch[1]}). Alasan:");
    });

    test('9. renderWeeklyMatrixView menyediakan tombol akses cepat Sakit/Cuti/Izin pada header baris hari', () => {
        expect(bebanKerjaContent).toContain("window.workloadOpenUnplannedAbsenceModal(${i})");
        expect(bebanKerjaContent).toContain("fa-calendar-xmark");
        expect(bebanKerjaContent).toContain("Tandai hari ini Tidak Terlaksana (Sakit/Cuti/Izin)");
    });

    test('10. renderWeeklyMatrixView menampilkan badge status interaktif saat hari tersebut memiliki log tidak terlaksana Sakit/Cuti/Izin', () => {
        expect(bebanKerjaContent).toContain("Hari ini tercatat Tidak Terlaksana (${escapeHTML(absType)}). Klik untuk ubah atau batalkan status");
        expect(bebanKerjaContent).toContain("<span>${escapeHTML(absType)}</span>");
    });

    test('11. submitUnplannedAbsence mengambil teacherId dari _weekData?.week?.teacher_id (bukan hanya getEffectiveTeacherId yang bernilai null bagi guru reguler)', () => {
        expect(bebanKerjaContent).toContain('const teacherId = _weekData?.week?.teacher_id || _weekData?.teacher_id || getEffectiveTeacherId()');
        expect(bebanKerjaContent).toContain('const planLinks = _weekData?.plan_links || _weekData?.plan_log_links || [];');
    });
});



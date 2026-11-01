/**
 * tests/workload-premature-report-guard.test.js
 * ====================================================================
 * Unit Test: Proteksi Penandaan Kegiatan Terlaksana Sebelum Jam Berakhir
 * & Alur Upload Foto Bukti serta Simpan Draf
 * Sesuai kesepakatan:
 * 1. Hari lampau: Bebas dilaporkan kapan saja.
 * 2. Hari masa depan: Ditolak tegas.
 * 3. Hari ini (WITA):
 *    - Sebelum jam berakhir: Guru dapat klik titik tiga (•••) untuk upload
 *      foto dan Simpan Draf. Tombol finalisasi laporan disembunyikan.
 *    - Setelah jam berakhir (toleransi 10 menit): Simpan Draf disembunyikan,
 *      cukup tombol perubahan/penyelesaian laporan (Simpan/Perbarui Laporan).
 * 4. UI: Menampilkan tombol disabled jam + tombol titik tiga (•••) draf saat prematur.
 * 5. Backend Worker: Mengizinkan status_execution: 'draft' sebelum jam berakhir,
 *    namun menolak HTTP 422 untuk status realisasi final sebelum waktunya.
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');
const {
    canReportActivityNow,
    timeStringToMinutes,
    minutesToTimeString
} = require('./workload-guru-utils');

describe('Workload Premature Report Guard & Draft Flow', () => {
    const root = path.resolve(__dirname, '..');
    const pageBebanKerjaJsPath = path.join(root, 'js', 'page-beban-kerja.js');
    const workerJsPath = path.join(root, 'cloudflare', 'worker.js');
    const eKinerjaHtmlPath = path.join(root, 'e-kinerja.html');

    const pageBebanKerjaJsContent = fs.readFileSync(pageBebanKerjaJsPath, 'utf8');
    const workerJsContent = fs.readFileSync(workerJsPath, 'utf8');
    const eKinerjaHtmlContent = fs.readFileSync(eKinerjaHtmlPath, 'utf8');

    describe('1. Logika Kalkulasi & Validator canReportActivityNow', () => {
        const mockToday = '2026-09-28';

        test('a. Hari lampau (date < today) selalu diizinkan dilaporkan kapan saja', () => {
            const res = canReportActivityNow('2026-09-27', '12:00', 5, timeStringToMinutes('08:00'), mockToday);
            expect(res.allowed).toBe(true);
        });

        test('b. Hari masa depan (date > today) ditolak tegas', () => {
            const res = canReportActivityNow('2026-09-29', '12:00', 5, timeStringToMinutes('15:00'), mockToday);
            expect(res.allowed).toBe(false);
            expect(res.reason).toContain('Tidak dapat melaporkan kegiatan untuk tanggal masa depan');
        });

        test('c. Hari ini, waktu saat ini jauh sebelum jam berakhir kegiatan (misal jam 10:00 vs selesai 12:00) ditolak untuk laporan final', () => {
            // Selesai 12:00, toleransi 5 menit => mulai boleh lapor 11:55
            // Jam sekarang: 10:00
            const res = canReportActivityNow(mockToday, '12:00', 5, timeStringToMinutes('10:00'), mockToday);
            expect(res.allowed).toBe(false);
            expect(res.allowedTimeStr).toBe('11:55');
            expect(res.reason).toContain('Kegiatan belum berakhir');
            expect(res.reason).toContain('11:55 WITA');
        });

        test('d. Hari ini, waktu saat ini 1 menit sebelum batas toleransi (misal 11:54 vs batas 11:55) ditolak', () => {
            const res = canReportActivityNow(mockToday, '12:00', 5, timeStringToMinutes('11:54'), mockToday);
            expect(res.allowed).toBe(false);
            expect(res.allowedTimeStr).toBe('11:55');
            expect(res.reason).toContain('11:55 WITA');
        });

        test('e. Hari ini, tepat pada jam batas toleransi (misal 11:55 vs batas 11:55) diizinkan', () => {
            const res = canReportActivityNow(mockToday, '12:00', 5, timeStringToMinutes('11:55'), mockToday);
            expect(res.allowed).toBe(true);
            expect(res.allowedTimeStr).toBe('11:55');
        });

        test('f. Hari ini, setelah jam berakhir kegiatan (misal 12:15 vs selesai 12:00) diizinkan', () => {
            const res = canReportActivityNow(mockToday, '12:00', 5, timeStringToMinutes('12:15'), mockToday);
            expect(res.allowed).toBe(true);
            expect(res.allowedTimeStr).toBe('11:55');
        });

        test('g. Kegiatan tanpa endTimeStr atau format tidak valid tetap aman (fallback diizinkan)', () => {
            const resNull = canReportActivityNow(mockToday, null, 5, timeStringToMinutes('10:00'), mockToday);
            expect(resNull.allowed).toBe(true);

            const resEmpty = canReportActivityNow(mockToday, '', 5, timeStringToMinutes('10:00'), mockToday);
            expect(resEmpty.allowed).toBe(true);
        });

        test('h. Penanganan batas toleransi awal hari (misal selesai 00:03 toleransi 5m tidak menghasilkan menit negatif)', () => {
            const res = canReportActivityNow(mockToday, '00:03', 5, 0, mockToday);
            expect(res.allowed).toBe(true);
            expect(res.allowedTimeStr).toBe('00:00');
        });
    });

    describe('2. Backend Worker (cloudflare/worker.js) Proteksi HTTP 422 & Izin Draf', () => {
        test('a. Memiliki validasi penolakan tanggal di masa depan', () => {
            expect(workerJsContent).toContain('if (date > todayWita)');
            expect(workerJsContent).toContain('Tanggal pelaksanaan tidak boleh di masa depan');
        });

        test('b. Memvalidasi kegiatan belum berakhir HANYA jika bukan draf (status_execution !== "draft")', () => {
            expect(workerJsContent).toContain('if (date === todayWita && status_execution !== "draft")');
            expect(workerJsContent).toContain('let activityEndTime = body.end_time || (Array.isArray(segments) && segments[0]?.end_time) || null;');
            expect(workerJsContent).toContain('SELECT end_time FROM plan_time_segments WHERE activity_id = ? LIMIT 1');
        });

        test('c. Menghitung toleransi 10 menit sebelum end_time dan membandingkan dengan waktu WITA saat ini', () => {
            expect(workerJsContent).toContain('const allowedMinutes = Math.max(0, endMinutes - 10);');
            expect(workerJsContent).toContain('if (currentMinutes < allowedMinutes)');
            expect(workerJsContent).toContain('Kegiatan belum berakhir. Pelaporan realisasi baru dapat dilakukan mulai pukul');
        });

        test('d. Durasi aktual bernilai 0 untuk laporan berstatus draf', () => {
            expect(workerJsContent).toContain('status_execution === "tidak_terlaksana" || status_execution === "draft"');
            expect(workerJsContent).toContain('const isDraft = status_execution === "draft";');
            expect(workerJsContent).toContain('const segDur = isDraft ? 0 :');
        });
    });

    describe('3. Integrasi Frontend (js/page-beban-kerja.js & e-kinerja.html)', () => {
        test('a. canReportActivityNow diekspor dan didaftarkan pada window', () => {
            expect(pageBebanKerjaJsContent).toContain('export function canReportActivityNow(');
            expect(pageBebanKerjaJsContent).toContain('window.workloadCanReportActivityNow = canReportActivityNow;');
        });

        test('b. quickReportComplete memvalidasi canReportActivityNow dan menolak aksi prematur dengan toast peringatan', () => {
            expect(pageBebanKerjaJsContent).toContain('const reportCheck = canReportActivityNow(segDate, seg.end_time, 5);');
            expect(pageBebanKerjaJsContent).toContain('if (!reportCheck.allowed)');
            expect(pageBebanKerjaJsContent).toContain("showToast(reportCheck.reason, 'warning');");
        });

        test('c. e-kinerja.html memiliki tombol Simpan Draf (#btn-draft-workload-log) dan tombol submit (#btn-submit-workload-log)', () => {
            expect(eKinerjaHtmlContent).toContain('id="btn-draft-workload-log"');
            expect(eKinerjaHtmlContent).toContain('id="btn-submit-workload-log"');
            expect(eKinerjaHtmlContent).toContain('window.workloadSaveLogDraft()');
        });

        test('d. Matriks Mingguan (Gantt Matrix) memunculkan titik tiga (•••) saat prematur untuk upload foto & draf', () => {
            expect(pageBebanKerjaJsContent).toContain('window.workloadOpenLogModal(\'${seg.activity_id}\', false, \'draft\', ${i})');
            expect(pageBebanKerjaJsContent).toContain('title="Upload Foto & Simpan Draf"');
            expect(pageBebanKerjaJsContent).toContain('cursor-not-allowed opacity-60');
            expect(pageBebanKerjaJsContent).toContain('<i class="fa-solid fa-clock"></i>');
        });

        test('e. Matriks Mobile memunculkan titik tiga (•••) saat prematur untuk upload foto & draf', () => {
            expect(pageBebanKerjaJsContent).toContain('window.workloadOpenLogModal(\'${seg.activity_id}\', false, \'draft\', ${i})');
        });

        test('f. Tampilan Fokus Harian memunculkan tombol upload foto & draf saat prematur', () => {
            expect(pageBebanKerjaJsContent).toContain('window.workloadOpenLogModal(\'${seg.activity_id}\', false, \'draft\')');
            expect(pageBebanKerjaJsContent).toContain('Upload Foto & Simpan Draf');
        });

        test('g. openLogModal: saat prematur memunculkan Simpan Draf dan menyembunyikan tombol submit', () => {
            expect(pageBebanKerjaJsContent).toContain('btnDraft.classList.remove(\'hidden\');');
            expect(pageBebanKerjaJsContent).toContain('btnSubmit.classList.add(\'hidden\');');
            expect(pageBebanKerjaJsContent).toContain('Draf Realisasi Kegiatan');
        });

        test('h. openLogModal & openEditLogModal: saat waktu sudah lewat, menyembunyikan Simpan Draf dan memunculkan tombol perubahan', () => {
            expect(pageBebanKerjaJsContent).toContain('btnDraft.classList.add(\'hidden\');');
            expect(pageBebanKerjaJsContent).toContain('btnSubmit.classList.remove(\'hidden\');');
        });

        test('i. saveLog memvalidasi jam kegiatan belum berakhir hanya jika status bukan draf', () => {
            expect(pageBebanKerjaJsContent).toContain('if (!isDraft)');
            expect(pageBebanKerjaJsContent).toContain('const reportCheck = canReportActivityNow(payload.date, activityEndTime, 5);');
        });
    });
});

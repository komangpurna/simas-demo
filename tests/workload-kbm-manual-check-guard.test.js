/**
 * @jest-environment jsdom
 * 
 * tests/workload-kbm-manual-check-guard.test.js
 * Unit Test untuk Proteksi Integritas Data KBM & Pencegahan Centang Manual pada E-Kinerja Guru
 * 
 * Memastikan bahwa:
 * 1. Kegiatan tatap muka KBM (PELAKSANAAN_KBM / cat_kbm / is_teaching) dideteksi secara akurat oleh isTeachingActivity().
 * 2. 1-Klik centang cepat (quickReportComplete) memblokir KBM dengan pesan penolakan integritas jurnal digital.
 * 3. Tampilan Gantt Matrix, Today Focus, dan Day Timeline meniadakan tombol centang manual untuk KBM dan menyajikan tombol Sinkron Jurnal.
 * 4. Pilihan status formulir (syncLogStatusOptions) meniadakan opsi 'terlaksana' untuk rencana KBM.
 * 5. Form submission (saveLog) menolak pengiriman status manual 'terlaksana' untuk kegiatan KBM terencana baru (!existingLogId).
 * 6. Backend API Cloudflare Worker (POST /api/workload/logs) memblokir HTTP 422 jika KBM terencana dibuat secara manual (!isExistingLog).
 * 7. Mode perbarui realisasi KBM (openEditLogModal) mengunci field waktu dan status, namun mengizinkan pembaruan foto/keterangan dengan tombol 'Simpan Perubahan'.
 * 8. Template UI modal e-kinerja.html memiliki banner informatif log-kbm-notice dengan tombol aksi cepat.
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Workload KBM Manual Check Guard & Journal Digital Integrity Suite', () => {
    const rootDir = path.resolve(__dirname, '..');
    const pageBebanKerjaJs = fs.readFileSync(path.join(rootDir, 'js/page-beban-kerja.js'), 'utf8');
    const workerJs = fs.readFileSync(path.join(rootDir, 'cloudflare/worker.js'), 'utf8');
    const eKinerjaHtml = fs.readFileSync(path.join(rootDir, 'e-kinerja.html'), 'utf8');

    test('1. Terdapat fungsi pembantu isTeachingActivity yang mendeteksi KBM secara komprehensif', () => {
        expect(pageBebanKerjaJs).toContain('export function isTeachingActivity(segOrAct)');
        expect(pageBebanKerjaJs).toContain('window.workloadIsTeachingActivity = isTeachingActivity;');

        // Memastikan kriteria KBM yang dicek:
        expect(pageBebanKerjaJs).toContain("segOrAct.catalog_id === 'cat_kbm'");
        expect(pageBebanKerjaJs).toContain("segOrAct.category_code === 'PELAKSANAAN_KBM'");
    });

    test('2. quickReportComplete memiliki guard KBM yang memblokir centang manual KBM', () => {
        expect(pageBebanKerjaJs).toContain('if (isTeachingActivity(seg))');
        expect(pageBebanKerjaJs).toContain(
            "showToast('Kegiatan tatap muka KBM tidak dapat dicentang manual. Realisasi otomatis disinkronkan dari Jurnal Mengajar Digital demi menjaga integritas data.', 'warning')"
        );
    });

    test('3. Matriks mingguan (Gantt Matrix) meniadakan centang manual KBM dan meniadakan tombol sinkron manual (0 manual writes)', () => {
        // Pada renderWeekMatrix:
        expect(pageBebanKerjaJs).toContain('const isKbm = isTeachingActivity(seg);');
        expect(pageBebanKerjaJs).not.toContain('button type="button" onclick="event.stopPropagation(); window.workloadSyncFromJournal()"');
        expect(pageBebanKerjaJs).toContain("window.workloadOpenLogModal('${seg.activity_id}', false, 'tidak_terlaksana'");
    });

    test('4. Tab Hari Ini (Today Focus & Timeline) meniadakan centang KBM dan menyediakan tautan langsung Isi Jurnal', () => {
        // Pada renderTodayTab & Focus View:
        expect(pageBebanKerjaJs).toContain('<span>Isi Jurnal</span>');
        expect(pageBebanKerjaJs).not.toContain('<span>Sinkron Jurnal</span>');

        // Pada renderDayTimeline:
        expect(pageBebanKerjaJs).toContain('jurnal.html');
        expect(pageBebanKerjaJs).toContain('Integritas Data: Realisasi KBM tidak dapat dicentang manual, otomatis disinkronkan dari Jurnal Digital.');
    });

    test('5. syncLogStatusOptions meniadakan opsi terlaksana manual jika isKbmPlan bernilai true', () => {
        expect(pageBebanKerjaJs).toContain('export function syncLogStatusOptions(isSlotReplacement = false, selectedValue = \'terlaksana\', isKbmPlan = false)');
        expect(pageBebanKerjaJs).toContain('else if (isKbmPlan)');
        expect(pageBebanKerjaJs).toContain('<option value="tidak_terlaksana">Tidak Terlaksana (0 Menit)</option>');
        expect(pageBebanKerjaJs).toContain('<option value="diganti">Diganti Kegiatan Lain</option>');
    });

    test('6. openLogModal dan openEditLogModal mendeteksi isKbmPlan dan menampilkan banner log-kbm-notice', () => {
        // openLogModal
        expect(pageBebanKerjaJs).toContain('const isKbmPlan = !isUnplanned && Boolean(planActivityId) && (isTeachingActivity(seg) || isTeachingActivity(act));');
        expect(pageBebanKerjaJs).toContain('syncLogStatusOptions(isSlotReplacement, effectiveStatus, isKbmPlan);');
        expect(pageBebanKerjaJs).toContain("kbmNoticeEl.classList.remove('hidden')");

        // openEditLogModal
        expect(pageBebanKerjaJs).toContain('const isKbmPlan = !isUnplanned && Boolean(planActId) && (isTeachingActivity(planSeg) || isTeachingActivity(planAct));');
        expect(pageBebanKerjaJs).toContain('syncLogStatusOptions(false, statusExec, isKbmPlan);');
    });

    test('7. saveLog di frontend memblokir pembuatan baru jika KBM terencana disimpan manual sebagai terlaksana', () => {
        expect(pageBebanKerjaJs).toContain('if (planId && !isUnplanned && statusExec === \'terlaksana\' && !existingLogId)');
        expect(pageBebanKerjaJs).toContain('if (isTeachingActivity(seg) || isTeachingActivity(act))');
        expect(pageBebanKerjaJs).toContain(
            "showToast('Kegiatan tatap muka KBM tidak dapat dicentang atau dilaporkan secara manual. Realisasi otomatis disinkronkan dari Jurnal Mengajar Digital demi menjaga integritas data.', 'warning', 6000);"
        );
    });

    test('8. Backend Cloudflare Worker (POST /api/workload/logs) menolak HTTP 422 untuk pembuatan baru KBM terlaksana namun izinkan perbarui log yang ada', () => {
        expect(workerJs).toContain('if (effectivePlanActId && Number(is_unplanned) === 0 && status_execution === "terlaksana")');
        expect(workerJs).toContain('if (!isExistingLog)');
        expect(workerJs).toContain('planAct.catalog_id === "cat_kbm" ||');
        expect(workerJs).toContain('planAct.category_code === "PELAKSANAAN_KBM"');
        expect(workerJs).toContain(
            'return errorResponse(\n' +
            '                                        "Realisasi kegiatan tatap muka KBM tidak dapat dicentang atau dilaporkan secara manual. Data wajib disinkronkan dari Jurnal Mengajar Digital demi menjaga integritas data.",\n' +
            '                                        422,\n' +
            '                                        request\n' +
            '                                    );'
        );
    });

    test('9. openEditLogModal mengunci jam dan status KBM namun menyajikan tombol Simpan Perubahan untuk update foto/keterangan', () => {
        expect(pageBebanKerjaJs).toContain('const isJournalKbmLog = (log.id || \'\').startsWith(\'wl_jurnal_\') || (isKbmPlan && log.status_execution === \'terlaksana\');');
        expect(pageBebanKerjaJs).toContain('startInp.readOnly = true;');
        expect(pageBebanKerjaJs).toContain('endInp.readOnly = true;');
        expect(pageBebanKerjaJs).toContain("submitBtnLabel.textContent = 'Simpan Perubahan';");
    });

    test('10. Modal e-kinerja.html memiliki banner informatif log-kbm-notice dengan tautan Buka Jurnal tanpa tombol sinkron manual', () => {
        expect(eKinerjaHtml).toContain('id="log-kbm-notice"');
        expect(eKinerjaHtml).toContain('Integritas Data: Realisasi KBM Terencana');
        expect(eKinerjaHtml).toContain('Otomatis dari Jurnal');
        expect(eKinerjaHtml).toContain('Jurnal Mengajar Digital');
        expect(eKinerjaHtml).toContain('Buka Jurnal Mengajar Digital');
        expect(eKinerjaHtml).not.toContain('Sinkronkan Realisasi Sekarang');
        expect(eKinerjaHtml).not.toContain('window.workloadSyncFromJournal()');
    });
});

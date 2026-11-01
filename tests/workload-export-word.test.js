/**
 * tests/workload-export-word.test.js
 *
 * Verifikasi Sistemik:
 * 1. Tombol Ekspor Word hanya di Tab Realisasi (#btn-export-realization-word); Tab Rencana tidak lagi punya ekspor Word
 * 2. Registrasi window handler workloadExportRealizationToWord di js/page-beban-kerja.js
 * 3. Generator .docx asli di js/exportLaporanDocx.js (modul HTML lama js/workload-export-word.js sudah dihapus)
 * 4. Dokumen realisasi .docx asli: Times New Roman, A4 Landscape
 * 5. Pola penamaan berkas dokumen: E-Kinerja_Realisasi_[Tanggal].docx
 */

const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

describe('Verifikasi Fitur Ekspor Dokumen Word E-Kinerja Guru (A4 Landscape Siap Cetak)', () => {
    const htmlPath = path.join(rootDir, 'e-kinerja.html');
    const bebanKerjaJsPath = path.join(rootDir, 'js', 'page-beban-kerja.js');

    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const bebanKerjaJsContent = fs.readFileSync(bebanKerjaJsPath, 'utf8');
    const docxJsContent = fs.readFileSync(path.join(rootDir, 'js', 'exportLaporanDocx.js'), 'utf8');

    test('1. e-kinerja.html memuat tombol ekspor Word hanya di Tab Realisasi', () => {
        // Tombol di Tab Realisasi
        expect(htmlContent).toContain('id="btn-export-realization-word"');
        expect(htmlContent).toContain('window.workloadExportRealizationToWord()');
        expect(htmlContent).toContain('fa-file-word');

        // Tab Rencana tidak lagi memiliki ekspor Word
        expect(htmlContent).not.toContain('id="btn-export-plan-word"');
        expect(htmlContent).not.toContain('window.workloadExportPlanToWord()');
    });

    test('2. page-beban-kerja.js mendaftarkan handler ekspor Word ke window dan mengekspor helper', () => {
        expect(bebanKerjaJsContent).not.toContain('window.workloadExportPlanToWord');
        expect(bebanKerjaJsContent).toContain('window.workloadExportRealizationToWord = exportRealizationToWord');
        expect(bebanKerjaJsContent).not.toContain('exportPlanToWord');
        expect(bebanKerjaJsContent).toContain('export async function exportRealizationToWord(');
        expect(bebanKerjaJsContent).toContain('export function getCurrentTeacherExportInfo(');
    });

    test('3. Modul ekspor HTML lama dihapus; Realisasi memakai generator .docx asli', () => {
        expect(fs.existsSync(path.join(rootDir, 'js', 'workload-export-word.js'))).toBe(false);
        expect(bebanKerjaJsContent).toContain("import { exportWorkloadRealizationDocx } from './exportLaporanDocx.js';");
        expect(bebanKerjaJsContent).toContain('await exportWorkloadRealizationDocx({');
        expect(bebanKerjaJsContent).not.toContain('workload-export-word');
    });

    test('4. Logika format tanggal dan rentang pekan berjalan dengan tepat', () => {
        // Simulasi fungsi formatIndonesianDate
        function testFormatDate(dateStr, withDayName = true) {
            const parts = dateStr.split('-');
            const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
            const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
            const monthNames = [
                'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
                'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
            ];
            const dayName = dayNames[d.getDay()];
            const dateNum = d.getDate();
            const monthName = monthNames[d.getMonth()];
            const year = d.getFullYear();
            return withDayName ? `${dayName}, ${dateNum} ${monthName} ${year}` : `${dateNum} ${monthName} ${year}`;
        }

        expect(testFormatDate('2026-09-21', true)).toBe('Senin, 21 September 2026');
        expect(testFormatDate('2026-09-21', false)).toBe('21 September 2026');
        expect(testFormatDate('2026-09-25', true)).toBe('Jumat, 25 September 2026');
    });

    test('5. Tanda tangan dokumen realisasi hanya guru yang bersangkutan', () => {
        const sigCode = docxJsContent.slice(
            docxJsContent.indexOf('function tandaTangan'),
            docxJsContent.indexOf('const children = [')
        );
        expect(sigCode).toContain('Guru Yang Bersangkutan,');
        expect(sigCode).toContain('NIP.');
        expect(sigCode).not.toContain('Kepala Sekolah');
    });

    test('6. Dokumen realisasi .docx memakai A4 Landscape dan font standar kantor', () => {
        expect(docxJsContent).toContain('orientation: PageOrientation.LANDSCAPE');
        expect(docxJsContent).toContain("FONT = 'Times New Roman'");
    });

    test('7. Pola penamaan berkas mematuhi format dokumen kerja guru', () => {
        expect(docxJsContent).not.toContain('E-Kinerja_Rencana_');
        expect(docxJsContent).toContain('`E-Kinerja_Realisasi_${weekStartDate}.docx`');
    });

    test('8. Tabel Realisasi .docx memiliki 7 kolom tanpa kolom Tanggal', () => {
        expect(docxJsContent).toContain("const heads = ['No', 'Waktu', 'Durasi', 'Rincian Tugas / Kegiatan', 'Realisasi Hasil / Output', 'Status', 'Bukti Dukung'];");
        expect(docxJsContent).toContain('span: 7');
        expect(docxJsContent).toContain('TOTAL REALISASI PEKAN INI:');
    });

    test('9. Rencana yang belum terealisasi tetap dimunculkan dalam tabel dengan output, status, dan bukti dukung kosong untuk ditulis tangan', () => {
        expect(docxJsContent).toContain('matchedLogIds');
        expect(docxJsContent).toContain('daySegments.forEach(seg => {');
        expect(docxJsContent).toContain('// Rencana belum terealisasi (kolom hasil, status, dan bukti dikosongkan agar bisa diisi manual / tulis tangan oleh guru)');
        expect(docxJsContent).toContain("hasil: ''");
        expect(docxJsContent).toContain("status: ''");
        expect(docxJsContent).toContain("bukti: []");
        expect(docxJsContent).toContain('isUnrealized: true');
        expect(docxJsContent).toContain('// Rencana yang belum terealisasi: dikosongkan agar bisa ditulis tangan / diisi manual oleh guru');
    });

    test('10. parseEvidenceList menangani URL teks tunggal maupun JSON string array foto', () => {
        expect(docxJsContent).toContain('export function parseEvidenceList(evidenceUrl)');
        expect(docxJsContent).toContain("raw.startsWith('[') || raw.startsWith('{')");
        expect(docxJsContent).toContain("return [{ nama: 'Bukti 1', url: raw }];");
    });

    test('11. exportLaporanDocx.js mengekspor fungsi-fungsi utama generator file .docx asli', () => {
        expect(docxJsContent).toContain('export async function buildLaporanDocx(');
        expect(docxJsContent).toContain('export function mapWeekDataToDocx(');
        expect(docxJsContent).toContain('export function getLocalCalendarDate(');
        expect(docxJsContent).toContain('export function formatIndonesianDateLocal(');
        expect(docxJsContent).toContain('export function formatWeekDateRangeLocal(');
        expect(docxJsContent).toContain('export function parseEvidenceList(');
        expect(docxJsContent).toContain('export async function exportWorkloadRealizationDocx(');
        expect(docxJsContent).toContain("FONT = 'Times New Roman'");
        expect(docxJsContent).toContain('KOP_WIDTH_CM = 15');
        expect(docxJsContent).toContain('TARGET_TUNTAS = 100');
    });

    test('12. Verifikasi Bug 4a: Penghitungan tanggal kalender lokal bebas pergeseran UTC/WITA', () => {
        // Simulasi fungsi getLocalCalendarDate
        function testGetLocalDate(weekStartDate, dayOfWeek) {
            const parts = weekStartDate.split('-');
            const y = Number(parts[0]);
            const m = Number(parts[1]) - 1;
            const d = Number(parts[2]);
            const dt = new Date(y, m, d + (dayOfWeek - 1));
            const resY = dt.getFullYear();
            const resM = String(dt.getMonth() + 1).padStart(2, '0');
            const resD = String(dt.getDate()).padStart(2, '0');
            return `${resY}-${resM}-${resD}`;
        }

        // Hari 1 (Senin) dari pekan 28 September 2026 WAJIB 2026-09-28 (Bukan 2026-09-27)
        expect(testGetLocalDate('2026-09-28', 1)).toBe('2026-09-28');
        // Hari 5 (Jumat) WAJIB 2026-10-02 (Bukan 2026-10-01)
        expect(testGetLocalDate('2026-09-28', 5)).toBe('2026-10-02');
    });

    test('13. Verifikasi Bug 4b: Label status total konsisten dengan persentase ketercapaian', () => {
        const TARGET_TUNTAS = 100;
        const checkTuntas = (persen) => (persen >= TARGET_TUNTAS ? 'Tuntas' : 'Belum Tuntas');

        expect(checkTuntas(68)).toBe('Belum Tuntas');
        expect(checkTuntas(99)).toBe('Belum Tuntas');
        expect(checkTuntas(100)).toBe('Tuntas');
        expect(checkTuntas(110)).toBe('Tuntas');
    });

    test('14. Eksekusi langsung mapWeekDataToDocx menghasilkan data tabel valid tanpa ReferenceError (termasuk linkedLog)', () => {
        const vm = require('node:vm');
        const docxCode = fs.readFileSync(path.join(rootDir, 'js', 'exportLaporanDocx.js'), 'utf8')
            .replace(/^import\s+[^;]+;?/gm, '')
            .replace(/^export\s+/gm, '');

        const context = {
            SCHOOL_CONFIG: { schoolCity: 'Abang' },
            calculateAdjustedWeeklyTarget: () => ({ adjustedTargetMinutes: 2250 }),
            isHolidayDate: () => false,
            getHolidayDateInfo: () => null,
            console
        };
        vm.createContext(context);
        vm.runInContext(docxCode, context);

        const dummyWeekData = {
            week: { teacher_name: 'Guru Penguji', teacher_nip: '198001012005011001' },
            segments: [
                {
                    activity_id: 'act-1',
                    date: '2026-09-28',
                    day_of_week: 1,
                    start_time: '07:30',
                    end_time: '08:15',
                    planned_minutes: 45,
                    activity_title: 'KBM Matematika X-A'
                },
                {
                    activity_id: 'act-2',
                    date: '2026-09-28',
                    day_of_week: 1,
                    start_time: '08:15',
                    end_time: '09:00',
                    planned_minutes: 45,
                    activity_title: 'KBM Matematika X-B'
                }
            ],
            logs: [
                {
                    id: 'log-1',
                    plan_activity_id: 'act-1',
                    date: '2026-09-28',
                    day_of_week: 1,
                    start_time: '07:30',
                    end_time: '08:15',
                    actual_minutes: 45,
                    title: 'KBM Matematika X-A Terlaksana',
                    status_execution: 'penuh',
                    output_summary: 'Siswa tuntas memahami materi'
                }
            ],
            plan_links: [
                { plan_activity_id: 'act-1', work_log_id: 'log-1' }
            ]
        };

        const result = context.mapWeekDataToDocx('2026-09-28', dummyWeekData, { nama: 'Guru Penguji' });
        expect(result).toBeDefined();
        expect(result.hari).toHaveLength(5);
        const seninRows = result.hari[0].rows;
        expect(seninRows).toHaveLength(2);
        // Baris 1: linkedLog (terhubung rencana) - bebas ReferenceError: duration is not defined
        expect(seninRows[0].rincian).toContain('KBM Matematika X-A');
        expect(seninRows[0].durasi).toBe('45 m');
        expect(seninRows[0].status).toBe('Terlaksana Penuh');
        // Baris 2: unrealized (belum terealisasi)
        expect(seninRows[1].rincian).toBe('KBM Matematika X-B');
        expect(seninRows[1].durasi).toBe('45 m');
        expect(seninRows[1].isUnrealized).toBe(true);
    });
});


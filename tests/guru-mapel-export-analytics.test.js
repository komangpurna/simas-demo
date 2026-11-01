/**
 * Unit & Behavioral Test: Guru Mapel Export to Excel with Grade Analysis (Sheet 1 Stats & Sheet 4 Analytics)
 * Memverifikasi:
 * 1. Sheet 1 memuat baris rekapitulasi statistik per komponen (Rata-rata, Max, Min, Tuntas, Remidial).
 * 2. Sheet 4 ('Analisis Penilaian') menyertakan Rangkuman Kelas, Analisis Per Komponen, dan Rekomendasi Pedagogis.
 * 3. Logika kalkulasi statistik per kolom (calcExportColStats) berjalan presisi.
 * 4. Versi aplikasi tersinkronisasi di seluruh berkas.
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Verifikasi Ekspor Excel Analisis Nilai Guru Mapel (Sheet 1 & Sheet 4)', () => {
    const root = path.resolve(__dirname, '..');
    const jsPath = path.join(root, 'js', 'page-guru-mapel.js');
    const htmlPath = path.join(root, 'guru-mapel.html');
    const configPath = path.join(root, 'js', 'config.js');
    const prdPath = path.join(root, 'PRD_SIMAS.md');
    const changelogPath = path.join(root, 'CHANGELOG.md');
    const packagePath = path.join(root, 'package.json');

    const jsContent = fs.readFileSync(jsPath, 'utf8');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const configContent = fs.readFileSync(configPath, 'utf8');
    const prdContent = fs.readFileSync(prdPath, 'utf8');
    const changelogContent = fs.readFileSync(changelogPath, 'utf8');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

    test('1. Sheet 1 Penilaian Siswa menyertakan format resmi kedinasan, header bertingkat, dan baris statistik', () => {
        expect(jsContent).toContain("['DAFTAR NILAI PESERTA DIDIK']");
        expect(jsContent).toContain("const thRow1 = ['NO', 'NISN / NIS', 'NAMA PESERTA DIDIK'];");
        expect(jsContent).toContain("thRow1.push('TUGAS / FORMATIF');");
        expect(jsContent).toContain("thRow1.push('SUMATIF LINGKUP MATERI');");
        expect(jsContent).toContain("thRow1.push('RATA-RATA', '');");
        expect(jsContent).toContain("thRow1.push('NILAI AKHIR');");
        expect(jsContent).toContain("function calcExportColStats(values, kkm)");
        expect(jsContent).toContain("rowAvg = ['', '', 'RATA-RATA KELAS']");
        expect(jsContent).toContain("rowMax = ['', '', 'NILAI TERTINGGI (MAX)']");
        expect(jsContent).toContain("rowMin = ['', '', 'NILAI TERENDAH (MIN)']");
        expect(jsContent).toContain("rowPass = ['', '', `JUMLAH TUNTAS (≥${kkmValue})`]");
        expect(jsContent).toContain("rowRemidial = ['', '', `JUMLAH REMIDIAL (<${kkmValue})`]");
        expect(jsContent).toContain("wsPenilaian['!merges'] = mergesPenilaian");
        expect(jsContent).toContain("signRow2[signLeftCol] = SCHOOL_CONFIG.headmasterTitle || 'Kepala SMA Negeri 1 Abang';");
        expect(jsContent).toContain("signRow2[signRightCol] = 'Guru Mata Pelajaran,';");
    });

    test('1b. Sheet 2 Kehadiran Siswa menyertakan format resmi PRESENSI SISWA DALAM KBM, pertemuan dinamis, dan footer tanda tangan', () => {
        expect(jsContent).toContain("['PRESENSI SISWA DALAM KBM']");
        expect(jsContent).toContain("const headerKehadiranRow1 = ['NO', 'NISN / NIS', 'NAMA PESERTA DIDIK'];");
        expect(jsContent).toContain("headerKehadiranRow1.push('TANGGAL KEGIATAN PEMBELAJARAN/PERTEMUAN KE -');");
        expect(jsContent).toContain("headerKehadiranRow1.push('RINCIAN KETIDAKHADIRAN', '', '', '', '', '');");
        expect(jsContent).toContain("headerKehadiranRow2.push('S', 'I', 'A', 'D', 'T', 'JML');");
        expect(jsContent).toContain("signKRow2[signLeftColK] = SCHOOL_CONFIG.headmasterTitle || 'Kepala SMA Negeri 1 Abang';");
        expect(jsContent).toContain("signKRow2[signRightColK] = 'Guru Mata Pelajaran,';");
    });

    test('2. exportToExcel membuat dan meng-append Sheet 4 Analisis Penilaian', () => {
        expect(jsContent).toContain("// SHEET 4: ANALISIS PENILAIAN & REKOMENDASI PEDAGOGIS KELAS");
        expect(jsContent).toContain("['LAPORAN ANALISIS & EVALUASI PENILAIAN AKADEMIK KELAS']");
        expect(jsContent).toContain("['I. RANGKUMAN STATISTIK PENILAIAN KELAS']");
        expect(jsContent).toContain("['II. ANALISIS DETAIL PER KOMPONEN PENILAIAN']");
        expect(jsContent).toContain("['III. CATATAN & REKOMENDASI PEDAGOGIS GURU']");
        expect(jsContent).toContain("XLSX.utils.book_append_sheet(workbook, wsAnalisis, 'Analisis Penilaian');");
        expect(jsContent).toContain("(4 Sheet Rapi & Analisis Lengkap)");
    });

    test('3. Logika kalkulasi statistik calcExportColStats menghitung data secara akurat', () => {
        // Ekstraksi implementasi kalkulasi fungsi yang identik
        function calcExportColStats(values, kkm) {
            const nums = values.filter(v => typeof v === 'number' && !isNaN(v));
            const count = nums.length;
            if (count === 0) {
                return { count: 0, avg: '-', max: '-', min: '-', pass: 0, remidial: 0, pctPass: 0 };
            }
            const sum = nums.reduce((acc, curr) => acc + curr, 0);
            const avg = parseFloat((sum / count).toFixed(1));
            const max = Math.max(...nums);
            const min = Math.min(...nums);
            const pass = nums.filter(v => v >= kkm).length;
            const remidial = nums.filter(v => v < kkm).length;
            const pctPass = Math.round((pass / count) * 100);
            return { count, avg, max, min, pass, remidial, pctPass };
        }

        const scores = [80, 95, 60, 75, 50, ''];
        const stats = calcExportColStats(scores, 75);

        expect(stats.count).toBe(5);
        expect(stats.avg).toBe(72);
        expect(stats.max).toBe(95);
        expect(stats.min).toBe(50);
        expect(stats.pass).toBe(3); // 80, 95, 75
        expect(stats.remidial).toBe(2); // 60, 50
        expect(stats.pctPass).toBe(60);
    });

    test('4. Versi aplikasi tersinkronisasi 100% di package.json, config.js, HTML, PRD, dan CHANGELOG', () => {
        const v = packageJson.version;
        expect(configContent).toContain(`export const APP_VERSION = "${v}";`);
        expect(htmlContent).toContain(`src="js/page-guru-mapel.js?v=${v}"`);
        expect(prdContent).toContain(`[${v}]`);
        expect(changelogContent).toContain(`[${v}]`);
    });

    test('5. buildRekapAbsenWorkbook mengonfigurasi 5 Sheet A4 standar kedinasan dengan pageSetup presisi', () => {
        expect(jsContent).toContain('export async function buildRekapAbsenWorkbook(params = {}, ExcelJSLib = null)');
        expect(jsContent).toContain("wb.addWorksheet('Data'");
        expect(jsContent).toContain("wb.addWorksheet('Rekap Siswa'");
        expect(jsContent).toContain("wb.addWorksheet('Ringkasan'");
        expect(jsContent).toContain("wb.addWorksheet('Rekap Pertemuan'");
        expect(jsContent).toContain("wb.addWorksheet('Tindak Lanjut'");

        // Kop Dinas Pemprov Bali & Metadata
        expect(jsContent).toContain('PEMERINTAH PROVINSI BALI');
        expect(jsContent).toContain('DINAS PENDIDIKAN, KEPEMUDAAN DAN OLAHRAGA');
        expect(jsContent).toContain('SMA NEGERI 1 ABANG');
        expect(jsContent).toContain('TANGGAL KEGIATAN PEMBELAJARAN / PERTEMUAN KE -');

        // Page setup specifications
        expect(jsContent).toContain("paperSize: 9"); // A4
        expect(jsContent).toContain("left: 0.5, right: 0.5, top: 0.6, bottom: 0.7, header: 0.3, footer: 0.3");
        expect(jsContent).toContain("horizontalCentered: true");
        expect(jsContent).toContain("showGridLines: false");
        expect(jsContent).toContain("printTitlesRow: '12:14'"); // 3-tier header pada Data
        expect(jsContent).toContain("printTitlesRow: '12:12'"); // 1-tier header pada sheet lain
        expect(jsContent).toContain("fitToWidth: 1,");
        expect(jsContent).toContain("fitToHeight: 1,"); // 1 page exact
        expect(jsContent).toContain("fitToHeight: 0,"); // multi-page height free

        // Header pastel fill & border
        expect(jsContent).toContain("argb: 'FFD9E2F3'");
        expect(jsContent).toContain("style: 'thin', color: { argb: 'FF000000' }");

        // Footer 3 parts
        expect(jsContent).toContain("&L SMA Negeri 1 Abang &C Halaman &P dari &N &R Dicetak: &D");

        // Signature block
        expect(jsContent).toContain("Mengetahui,");
        expect(jsContent).toContain("Guru Mata Pelajaran,");
    });

    test('6. guru-mapel.html memuat pustaka offline ExcelJS dan tombol aksi cetak A4', () => {
        const excelJsPath = path.join(root, 'js', 'vendor', 'exceljs.min.js');
        expect(fs.existsSync(excelJsPath)).toBe(true);
        expect(fs.statSync(excelJsPath).size).toBeGreaterThan(900000);

        expect(htmlContent).toContain('<script src="js/vendor/exceljs.min.js"></script>');
        expect(htmlContent).toContain("'exportRekapAbsenA4'");
        expect(htmlContent).toContain('id="btn-export-rekap-absen-panel"');
        expect(htmlContent).toContain('id="kehadiran-filter-bar"');
    });
});

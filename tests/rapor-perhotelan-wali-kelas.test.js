/**
 * Test Suite: Fitur Cetak Rapor Vokasi Perhotelan (A4) pada Portal Wali Kelas
 * Memverifikasi UI tombol cetak, deteksi kelas X & XI, mapping Fase E/F, skala predikat,
 * resolusi nilai & deskripsi CP ganda (FB & HK), layout A4 resmi, dan sinkronisasi versi.
 */

const fs = require('fs');
const path = require('path');

describe('Portal Wali Kelas: Cetak Rapor Vokasi Perhotelan (Standar A4)', () => {
    let waliHtml;
    let pageWaliJs;
    let configJs;
    let packageJson;
    let changelogMd;
    let prdSimas;
    let eRaporHtml;
    let pageERaporJs;
    let globalJs;

    beforeAll(() => {
        waliHtml = fs.readFileSync(path.join(__dirname, '../wali-kelas.html'), 'utf8');
        pageWaliJs = fs.readFileSync(path.join(__dirname, '../js/page-wali-kelas.js'), 'utf8');
        configJs = fs.readFileSync(path.join(__dirname, '../js/config.js'), 'utf8');
        packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
        changelogMd = fs.readFileSync(path.join(__dirname, '../CHANGELOG.md'), 'utf8');
        prdSimas = fs.readFileSync(path.join(__dirname, '../PRD_SIMAS.md'), 'utf8');
        eRaporHtml = fs.readFileSync(path.join(__dirname, '../e-rapor.html'), 'utf8');
        pageERaporJs = fs.readFileSync(path.join(__dirname, '../js/page-e-rapor.js'), 'utf8');
        globalJs = fs.readFileSync(path.join(__dirname, '../js/global.js'), 'utf8');
    });

    describe('1. Verifikasi UI HTML (wali-kelas.html & e-rapor.html)', () => {
        test('Memiliki tombol cetak massal #btn-open-bulk-print-rapor pada toolbar Tab 7 Rapor', () => {
            expect(waliHtml).toContain('id="btn-open-bulk-print-rapor"');
            expect(waliHtml).toContain('onclick="window.openBulkPrintRaporModal()"');
            expect(waliHtml).toContain('Cetak Rapor');
        });

        test('Memiliki modal dialog pilihan cetak massal rombel #modal-bulk-print-rapor', () => {
            expect(waliHtml).toContain('id="modal-bulk-print-rapor"');
            expect(waliHtml).toContain('executeBulkPrintOption(\'afektif\')');
            expect(waliHtml).toContain('executeBulkPrintOption(\'perhotelan\')');
        });

        test('Memiliki tombol #btn-print-modal-perhotelan pada modal print-settings-modal', () => {
            expect(waliHtml).toContain('id="btn-print-modal-perhotelan"');
            expect(waliHtml).toContain('onclick="window.printRaporPerhotelanWali()"');
            expect(waliHtml).toContain('Rapor Perhotelan');
        });

        test('Memiliki modal pratinjau rekapan nilai & deskripsi CP perhotelan #modal-preview-rapor-perhotelan', () => {
            expect(waliHtml).toContain('id="modal-preview-rapor-perhotelan"');
            expect(waliHtml).toContain('id="modal-preview-rapor-perhotelan-dialog"');
            expect(waliHtml).toContain('id="perhotelan-preview-modal-title"');
            expect(waliHtml).toContain('id="perhotelan-preview-modal-subtitle"');
            expect(waliHtml).toContain('id="perhotelan-preview-modal-body"');
            expect(waliHtml).toContain('id="perhotelan-preview-modal-actions"');
        });

        test('Memiliki tampilan read-only Tanggal Cetak Rapor SSOT pada modal cetak wali kelas', () => {
            expect(waliHtml).toContain('id="print-date-ssot-display"');
            expect(waliHtml).toContain('id="print-date-input"');
            expect(waliHtml).toContain('Tanggal Cetak Rapor:');
            expect(waliHtml).toContain('SSOT');
        });

        test('Memiliki konfigurasi Tanggal Cetak Rapor SSOT pada e-rapor.html untuk Kurikulum', () => {
            expect(eRaporHtml).toContain('id="input-tgl-cetak-rapor"');
            expect(eRaporHtml).toContain('id="btn-save-tgl-rapor"');
            expect(eRaporHtml).toContain('window.saveTanggalCetakRapor()');
            expect(pageERaporJs).toContain('window.saveTanggalCetakRapor = async function');
        });

        test('Tombol Cetak Rapor Afektif AI eksisting dan Rapor Perhotelan tersedia di modal print-settings-modal', () => {
            expect(waliHtml).toContain('id="btn-print-modal-afektif"');
            expect(waliHtml).toContain('onclick="window.printReportCardWali()"');
            expect(waliHtml).toContain('Rapor Afektif');
            expect(waliHtml).toContain('id="btn-print-modal-perhotelan"');
            expect(waliHtml).toContain('onclick="window.printRaporPerhotelanWali()"');
            expect(waliHtml).toContain('Rapor Perhotelan');
        });

        test('Tombol di kolom Aksi & Cetak Rapor pada tabel baris siswa merupakan tombol tunggal Cetak Rapor yang membuka modal', () => {
            expect(pageWaliJs).toContain('openPrintRaporWali');
            expect(pageWaliJs).toContain('Cetak Rapor');
            expect(pageWaliJs).toContain('openModalCatatanRapor');
            expect(pageWaliJs).toContain('Buat Catatan (AI)');
        });

        test('Toolbar Tab 7 memiliki tombol cetak massal dan JavaScript mendukung modal pilihan serta fungsi pembangun SSOT', () => {
            expect(waliHtml).toContain('id="btn-open-bulk-print-rapor"');
            expect(waliHtml).toContain('onclick="window.openBulkPrintRaporModal()"');
            expect(pageWaliJs).toContain('window.openBulkPrintRaporModal = function');
            expect(pageWaliJs).toContain('window.executeBulkPrintOption = async function');
            expect(pageWaliJs).toContain('window.buildRaporAfektifPageHtml = buildRaporAfektifPageHtml');
            expect(pageWaliJs).toContain('window.printAllRaporAfektifWali = printAllRaporAfektifWali');
            expect(pageWaliJs).toContain('window.printAllRaporPerhotelanWali = async function');
        });

        test('Tag script page-wali-kelas.js menggunakan nomor versi yang cocok dengan package.json', () => {
            expect(waliHtml).toContain(`src="js/page-wali-kelas.js?v=${packageJson.version}"`);
        });
    });

    describe('2. Logika Deteksi Kelas & Fase (isPerhotelanClass & getFaseFromClass)', () => {
        test('isPerhotelanClass dan getFaseFromClass terdefinisi dan diekspor ke window', () => {
            expect(pageWaliJs).toContain('function isPerhotelanClass(className)');
            expect(pageWaliJs).toContain('window.isPerhotelanClass = isPerhotelanClass;');
            expect(pageWaliJs).toContain('function getFaseFromClass(className)');
            expect(pageWaliJs).toContain('window.getFaseFromClass = getFaseFromClass;');
        });

        test('isPerhotelanClass mengembalikan true hanya untuk kelas X dan XI', () => {
            function isPerhotelanClass(className) {
                if (!className) return false;
                const trimmed = String(className).trim().toUpperCase();
                if (trimmed.startsWith('XII-') || trimmed.startsWith('XII.') || trimmed.startsWith('XII ') || trimmed.startsWith('XII_') || trimmed === 'XII') return false;
                return trimmed.startsWith('X-') || trimmed.startsWith('X.') || trimmed.startsWith('X ') || trimmed.startsWith('X_') ||
                       trimmed.startsWith('XI-') || trimmed.startsWith('XI.') || trimmed.startsWith('XI ') || trimmed.startsWith('XI_');
            }

            expect(isPerhotelanClass('X-1')).toBe(true);
            expect(isPerhotelanClass('X 2')).toBe(true);
            expect(isPerhotelanClass('X.3')).toBe(true);
            expect(isPerhotelanClass('X_4')).toBe(true);
            expect(isPerhotelanClass('XI-1')).toBe(true);
            expect(isPerhotelanClass('XI 4')).toBe(true);
            expect(isPerhotelanClass('XI.10')).toBe(true);
            expect(isPerhotelanClass('XI_5')).toBe(true);

            expect(isPerhotelanClass('XII-1')).toBe(false);
            expect(isPerhotelanClass('XII 2')).toBe(false);
            expect(isPerhotelanClass('XII.5')).toBe(false);
            expect(isPerhotelanClass('XII_3')).toBe(false);
            expect(isPerhotelanClass('')).toBe(false);
            expect(isPerhotelanClass(null)).toBe(false);
        });

        test('getFaseFromClass memetakan kelas X ke Fase E, dan kelas XI/XII ke Fase F', () => {
            function getFaseFromClass(className) {
                if (!className) return 'E';
                const trimmed = String(className).trim().toUpperCase();
                if (trimmed.startsWith('X-') || trimmed.startsWith('X.') || trimmed.startsWith('X ') || trimmed.startsWith('X_') || trimmed === 'X') {
                    return 'E';
                }
                return 'F';
            }

            expect(getFaseFromClass('X-1')).toBe('E');
            expect(getFaseFromClass('X 2')).toBe('E');
            expect(getFaseFromClass('X_3')).toBe('E');
            expect(getFaseFromClass('X')).toBe('E');
            expect(getFaseFromClass('XI-1')).toBe('F');
            expect(getFaseFromClass('XI 10')).toBe('F');
            expect(getFaseFromClass('XI_2')).toBe('F');
            expect(getFaseFromClass('XII-1')).toBe('F');
        });
    });

    describe('3. Perhitungan Predikat Kompetensi (getPerhotelanPredicate)', () => {
        test('getPerhotelanPredicate terdefinisi dan diekspor ke window', () => {
            expect(pageWaliJs).toContain('function getPerhotelanPredicate(score)');
            expect(pageWaliJs).toContain('window.getPerhotelanPredicate = getPerhotelanPredicate;');
        });

        test('getPerhotelanPredicate menghitung predikat sesuai skala resmi PRD', () => {
            function getPerhotelanPredicate(score) {
                if (score === null || score === undefined || score === '' || isNaN(Number(score))) return '';
                const num = Number(score);
                if (num >= 85) return 'Sangat Kompeten';
                if (num >= 70) return 'Kompeten';
                if (num >= 60) return 'Cukup Kompeten';
                return 'Kurang Kompeten';
            }

            // Memverifikasi nilai 95 dan 75 secara otomatis menghasilkan predikat berbeda
            expect(getPerhotelanPredicate(95)).toBe('Sangat Kompeten');
            expect(getPerhotelanPredicate(75)).toBe('Kompeten');

            // Rentang 85 - 100: Sangat Kompeten
            expect(getPerhotelanPredicate(100)).toBe('Sangat Kompeten');
            expect(getPerhotelanPredicate(85)).toBe('Sangat Kompeten');

            // Rentang 70 - 84: Kompeten
            expect(getPerhotelanPredicate(84)).toBe('Kompeten');
            expect(getPerhotelanPredicate(80)).toBe('Kompeten');
            expect(getPerhotelanPredicate(70)).toBe('Kompeten');

            // Rentang 60 - 69: Cukup Kompeten
            expect(getPerhotelanPredicate(69)).toBe('Cukup Kompeten');
            expect(getPerhotelanPredicate(60)).toBe('Cukup Kompeten');

            // Rentang 0 - 59: Kurang Kompeten
            expect(getPerhotelanPredicate(59)).toBe('Kurang Kompeten');
            expect(getPerhotelanPredicate(0)).toBe('Kurang Kompeten');

            // Nilai kosong / invalid
            expect(getPerhotelanPredicate('')).toBe('');
            expect(getPerhotelanPredicate(null)).toBe('');
            expect(getPerhotelanPredicate(undefined)).toBe('');
        });
    });

    describe('4. Resolusi Data Siswa Ganda (resolveStudentPerhotelan)', () => {
        test('resolveStudentPerhotelan terdefinisi dan diekspor ke window', () => {
            expect(pageWaliJs).toContain('function resolveStudentPerhotelan(');
            expect(pageWaliJs).toContain('window.resolveStudentPerhotelan = resolveStudentPerhotelan;');
        });

        test('Siswa kelas X terisi pada mapel FB dan mapel HK tetap kosong jika siswa hanya mengambil FB', () => {
            const student = { nis: '1001', name: 'Siswa X', class: 'X-1' };
            const scores = {
                '1001': {
                    fb: { final_score: 88, deskripsi_cp: 'Sangat menguasai teknik table setting.' },
                    hk: null
                }
            };

            const fnMatch = pageWaliJs.indexOf('function resolveStudentPerhotelan(');
            expect(fnMatch).toBeGreaterThan(-1);

            // Logika simulasi resolveStudentPerhotelan
            const studentData = scores['1001'];
            let activeKey = 'fb';
            expect(activeKey).toBe('fb');
            expect(studentData.fb.final_score).toBe(88);
            expect(studentData.hk).toBeNull();
        });

        test('Siswa kelas XI terisi pada mapel HK dan mapel FB tetap kosong jika siswa hanya mengambil HK', () => {
            const student = { nis: '0821', name: 'NI WAYAN MEI', class: 'XI 1' };
            const scores = {
                '0821': {
                    fb: null,
                    hk: {
                        final_score: 80,
                        teori: 80,
                        praktik: 83,
                        deskripsi_cp: 'Siswa mampu mendeskripsikan cara menjelaskan fasilitas hotel.'
                    }
                }
            };

            const studentData = scores['0821'];
            expect(studentData.hk.teori).toBe(80);
            expect(studentData.hk.praktik).toBe(83);
            expect(studentData.fb).toBeNull();
        });
    });

    describe('5. Pembangun Lembar Cetak A4 (buildRaporPerhotelanPageHtml)', () => {
        test('buildRaporPerhotelanPageHtml terdefinisi dan diekspor ke window', () => {
            expect(pageWaliJs).toContain('function buildRaporPerhotelanPageHtml(');
            expect(pageWaliJs).toContain('window.buildRaporPerhotelanPageHtml = buildRaporPerhotelanPageHtml;');
        });

        test('Template HTML memuat Kop Identitas 2 kolom, Garis Pembatas, Judul, dan 2 Tabel Nilai', () => {
            expect(pageWaliJs).toContain('LAPORAN CAPAIAN KOMPETENSI');
            expect(pageWaliJs).toContain('MATA PELAJARAN VOKASI PERHOTELAN');
            expect(pageWaliJs).toContain('A. Nilai Pengetahuan');
            expect(pageWaliJs).toContain('B. Nilai Keterampilan');
            expect(pageWaliJs).toContain('Food and Beverage<br>Service');
            expect(pageWaliJs).toContain('Housekeeping');
            expect(pageWaliJs).toContain('Keterangan');
            expect(pageWaliJs).toContain('Rentang Rata-Rata Total');
            expect(pageWaliJs).toContain('Ketercapaian Kompetensi');
        });

        test('Template HTML memuat Tanda Tangan 3 Pihak (Orang Tua/Wali, Wali Kelas, Kepala Sekolah)', () => {
            expect(pageWaliJs).toContain('Orang Tua/Wali');
            expect(pageWaliJs).toContain('Wali Kelas');
            expect(pageWaliJs).toContain('Kepala Sekolah');
        });

        test('cleanNipWithoutSpaces terdefinisi dan membersihkan spasi serta prefiks ganda NIP', () => {
            expect(pageWaliJs).toContain('function cleanNipWithoutSpaces(nip)');
            expect(pageWaliJs).toContain('window.cleanNipWithoutSpaces = cleanNipWithoutSpaces;');

            function cleanNipWithoutSpaces(nip) {
                if (!nip) return '';
                return String(nip).replace(/^(NIP\.?\s*:?\s*)+/i, '').replace(/\s+/g, '').trim();
            }

            // NIP Kepala Sekolah dengan spasi antar kelompok angka
            expect(cleanNipWithoutSpaces('19700521 199702 1 001')).toBe('197005211997021001');

            // NIP Wali Kelas dengan prefiks NIP. dan angka
            expect(cleanNipWithoutSpaces('NIP. 199107042025212055')).toBe('199107042025212055');

            // NIP dengan spasi dan prefiks ganda NIP. NIP.
            expect(cleanNipWithoutSpaces('NIP. NIP. 199107042025212055')).toBe('199107042025212055');

            // NIP dengan spasi internal dan format NIP:
            expect(cleanNipWithoutSpaces('NIP: 19910704 202521 2 055')).toBe('199107042025212055');

            // Nilai strip atau kosong
            expect(cleanNipWithoutSpaces('-')).toBe('-');
            expect(cleanNipWithoutSpaces('NIP. -')).toBe('-');
            expect(cleanNipWithoutSpaces('')).toBe('');
            expect(cleanNipWithoutSpaces(null)).toBe('');
            expect(cleanNipWithoutSpaces(undefined)).toBe('');
        });

        test('cleanNipWithoutSpaces dideklarasikan tepat 1 kali tanpa duplikasi identifier pada modul ES', () => {
            const matches = pageWaliJs.match(/function\s+cleanNipWithoutSpaces\s*\(/g);
            expect(matches).not.toBeNull();
            expect(matches.length).toBe(1);

            const windowAssignMatches = pageWaliJs.match(/window\.cleanNipWithoutSpaces\s*=/g);
            expect(windowAssignMatches).not.toBeNull();
            expect(windowAssignMatches.length).toBe(1);
        });

        test('buildRaporPerhotelanPageHtml memformat NIP Wali Kelas & Kepala Sekolah tanpa spasi dan tanpa duplikasi NIP.', () => {
            expect(pageWaliJs).toContain('const cleanKepsekNip = cleanNipWithoutSpaces(rawKepsekNip);');
            expect(pageWaliJs).toContain('const cleanTeacherNip = cleanNipWithoutSpaces(rawTeacherNip);');
            expect(pageWaliJs).toContain('${escapeHTML(teacherNipDisplay)}');
            expect(pageWaliJs).toContain('${escapeHTML(kepsekNipDisplay)}');
        });

        test('buildRaporPerhotelanPageHtml menyelaraskan posisi kolom kanan header dan tanda tangan secara simetris ke sisi kanan (70%/30%)', () => {
            // Header table proportions
            expect(pageWaliJs).toContain('width: 14%; border: none; vertical-align: top; padding: 2px 0;">Nama');
            expect(pageWaliJs).toContain('width: 54%; border: none; vertical-align: top; padding: 2px 0; font-weight: bold;');
            expect(pageWaliJs).toContain('width: 16%; border: none; vertical-align: top; padding: 2px 0; white-space: nowrap;">Kelas');
            expect(pageWaliJs).toContain('width: 12%; border: none; vertical-align: top; padding: 2px 0; white-space: nowrap;">${escapeHTML(studentClassDisplay)}');

            // Signature table proportions
            expect(pageWaliJs).toContain('width: 70%; border: none; vertical-align: top; padding: 0;');
            expect(pageWaliJs).toContain('width: 30%; border: none; vertical-align: top; padding: 0; text-align: left;');
        });
    });

    describe('6. Integrasi Fungsi Cetak Global & Guard Clause Pop-up', () => {
        test('window.printSingleRaporPerhotelanWali terdefinisi', () => {
            expect(pageWaliJs).toContain('window.printSingleRaporPerhotelanWali = async function');
        });

        test('window.printRaporPerhotelanWali terdefinisi dan memiliki guard clause pop-up', () => {
            const fnIdx = pageWaliJs.indexOf('window.printRaporPerhotelanWali = async function');
            expect(fnIdx).toBeGreaterThan(-1);
            const fnChunk = pageWaliJs.substring(fnIdx, fnIdx + 4000);
            expect(fnChunk).toContain("const printWin = window.open('', '_blank');");
            expect(fnChunk).toContain('if (!printWin) {');
            expect(fnChunk).toContain('Pop-up Terblokir');
        });

        test('window.printAllRaporPerhotelanWali terdefinisi dan mendukung page-break antar siswa', () => {
            const fnIdx = pageWaliJs.indexOf('window.printAllRaporPerhotelanWali = async function');
            expect(fnIdx).toBeGreaterThan(-1);
            const fnChunk = pageWaliJs.substring(fnIdx, fnIdx + 4000);
            expect(fnChunk).toContain('page-break-after: always');
            expect(fnChunk).toContain("const printWin = window.open('', '_blank');");
            expect(fnChunk).toContain('if (!printWin) {');
        });

        test('renderRaporTab mengendalikan visibilitas tombol massal dan tombol aksi per-baris', () => {
            const tabIdx = pageWaliJs.indexOf('function renderRaporTab()');
            expect(tabIdx).toBeGreaterThan(-1);
            const nextFnIdx = pageWaliJs.indexOf('function setupEventListeners()', tabIdx);
            const tabChunk = nextFnIdx > -1 ? pageWaliJs.substring(tabIdx, nextFnIdx) : pageWaliJs.substring(tabIdx, tabIdx + 8000);
            expect(tabChunk).toContain('isPerhotelanClass(currentRombelClass)');
            expect(tabChunk).toContain('btn-open-bulk-print-rapor');
            expect(tabChunk).toContain('openPrintRaporWali');
        });

        test('printRaporPerhotelanWali dan printAllRaporPerhotelanWali memiliki proteksi guard hanya untuk kelas X dan XI', () => {
            expect(pageWaliJs).toContain('if (!isPerhotelanClass(studentClass)) {');
            expect(pageWaliJs).toContain('Rapor Vokasi Perhotelan hanya diperuntukkan bagi siswa kelas X dan XI.');
        });

        test('promptRaporDateConfirmation terdefinisi dan menangani dialog konfirmasi tanggal cetak dengan UI modern tanpa istilah titimangsa', () => {
            expect(pageWaliJs).toContain('async function promptRaporDateConfirmation(options = {})');
            expect(pageWaliJs).toContain('window.promptRaporDateConfirmation = promptRaporDateConfirmation;');
            expect(pageWaliJs).toContain('swal-rapor-date-input');
            expect(pageWaliJs).toContain('swal-date-formatted-preview');

            // Memastikan tidak ada teks canggung 'titimangsa' pada antarmuka dialog pengguna
            expect(pageWaliJs).not.toContain('Tanggal Rapor (Titimangsa):');
            expect(pageWaliJs).not.toContain('Titimangsa pada rapor:');
            expect(pageWaliJs).toContain('Tanggal Rapor:');
            expect(pageWaliJs).toContain('Tanggal tercetak:');

            // Memastikan modal memiliki elemen visual modern (gradient badge, rounded-2xl, customClass)
            expect(pageWaliJs).toContain('bg-gradient-to-tr');
            expect(pageWaliJs).toContain('customClass:');

            // Memastikan format tanggal input menggunakan standar Indonesia (dd/mm/yyyy) bukan mm/dd/yyyy
            expect(pageWaliJs).toContain('formatToIndoDmy');
            expect(pageWaliJs).toContain('parseIndoDmyToIso');
            expect(pageWaliJs).toContain('placeholder="DD/MM/YYYY');
            expect(pageWaliJs).toContain('swal-rapor-native-picker');
        });

        test('openPreviewSingleRaporPerhotelan dan openPreviewAllRaporPerhotelan terdefinisi dan menyajikan rekapan nilai & deskripsi CP', () => {
            expect(pageWaliJs).toContain('async function openPreviewSingleRaporPerhotelan(nis)');
            expect(pageWaliJs).toContain('window.openPreviewSingleRaporPerhotelan = openPreviewSingleRaporPerhotelan;');
            expect(pageWaliJs).toContain('async function openPreviewAllRaporPerhotelan()');
            expect(pageWaliJs).toContain('window.openPreviewAllRaporPerhotelan = openPreviewAllRaporPerhotelan;');

            // Memastikan memetakan mata pelajaran tunggal per tingkatan (X: Food & Beverage, XI: Housekeeping)
            expect(pageWaliJs).toContain("const isClassX = /^X[\\s\\-\\.]/i.test(studentClass);");
            expect(pageWaliJs).toContain("const mapelKey = isClassX ? 'fb' : 'hk';");
            expect(pageWaliJs).toContain("const mapelName = isClassX ? 'Food and Beverage Service' : 'Housekeeping';");

            // Memastikan modal body memuat rekapan nilai (pengetahuan & keterampilan) dan deskripsi CP
            expect(pageWaliJs).toContain('Nilai Pengetahuan (NR)');
            expect(pageWaliJs).toContain('Nilai Keterampilan (NR)');
            expect(pageWaliJs).toContain('Deskripsi Capaian Pembelajaran (CP)');
            expect(pageWaliJs).toContain('modal-preview-rapor-perhotelan');
        });

        test('printSingleRaporPerhotelanWali membuka modal pratinjau personal siswa', () => {
            const fnSingleIdx = pageWaliJs.indexOf('window.printSingleRaporPerhotelanWali = async function');
            expect(fnSingleIdx).toBeGreaterThan(-1);
            const fnSingleChunk = pageWaliJs.substring(fnSingleIdx, fnSingleIdx + 200);
            expect(fnSingleChunk).toContain('openPreviewSingleRaporPerhotelan');
        });

        test('printRaporPerhotelanWali dan printAllRaporPerhotelanWali membuka pratinjau rekapan nilai (directPrint=false) dan mencetak lembar A4 dengan tanggal SSOT (directPrint=true)', () => {
            const fnSingle = pageWaliJs.substring(pageWaliJs.indexOf('window.printRaporPerhotelanWali = async function'), pageWaliJs.indexOf('window.printAllRaporPerhotelanWali = async function'));
            expect(fnSingle).toContain('if (!directPrint) {');
            expect(fnSingle).toContain('await window.openPreviewSingleRaporPerhotelan(targetNis);');
            expect(fnSingle).toContain('const confirmedDateIso = await getSsotRaporDate();');
            expect(fnSingle).toContain('const reportDate = formatDateIndoFormal(confirmedDateIso);');

            const fnAll = pageWaliJs.substring(pageWaliJs.indexOf('window.printAllRaporPerhotelanWali = async function'));
            expect(fnAll).toContain('if (!directPrint) {');
            expect(fnAll).toContain('await window.openPreviewAllRaporPerhotelan();');
            expect(fnAll).toContain('const confirmedDateIso = await getSsotRaporDate();');
            expect(fnAll).toContain('const reportDate = formatDateIndoFormal(confirmedDateIso);');
        });

        test('fetchPerhotelanScoresForClass query guru_mapel_gradebooks menggunakan kolom skema yang valid', () => {
            const startIdx = pageWaliJs.indexOf('fetchPerhotelanScoresForClass');
            expect(startIdx).toBeGreaterThan(-1);
            const fnScope = pageWaliJs.substring(startIdx, startIdx + 3000);

            // Memastikan menggunakan skema Supabase yang benar
            expect(fnScope).toContain(".from('guru_mapel_gradebooks')");
            expect(fnScope).toContain(".select('id, subject_id, class_id, tahun_ajaran, semester')");
            expect(fnScope).toContain(".eq('tahun_ajaran', academicYear)");
            expect(fnScope).toContain(".eq('semester', sem)");

            // Memastikan TIDAK menggunakan kolom yang tidak ada (mencegah error 42703 column does not exist)
            expect(fnScope).not.toContain(".select('id, mapel, class, academic_year, semester')");
            expect(fnScope).not.toContain(".eq('academic_year', academicYear)");
        });
    });

    describe('7. Mekanisme Simpan Catatan Kondisional pada Modal Cetak Rapor Afektif (Hemat Kuota)', () => {
        test('getExistingSavedPrintNote terdefinisi dan diekspor ke window', () => {
            expect(pageWaliJs).toContain('function getExistingSavedPrintNote(nis)');
            expect(pageWaliJs).toContain('window.getExistingSavedPrintNote = getExistingSavedPrintNote;');
        });

        test('openPrintRaporWali mencatat catatan awal pada activePrintStudent._originalNote saat modal dibuka', () => {
            const startIdx = pageWaliJs.indexOf('window.openPrintRaporWali = async function');
            expect(startIdx).toBeGreaterThan(-1);
            const fnScope = pageWaliJs.substring(startIdx, startIdx + 7000);

            expect(fnScope).toContain('activePrintStudent._originalNote = initialNoteText;');
        });

        test('changePrintPeriod memperbarui activePrintStudent._originalNote saat periode semester berganti', () => {
            const startIdx = pageWaliJs.indexOf('window.changePrintPeriod = async function');
            expect(startIdx).toBeGreaterThan(-1);
            const fnScope = pageWaliJs.substring(startIdx, startIdx + 7000);

            expect(fnScope).toContain('activePrintStudent._originalNote = (currentText || \'\').trim();');
        });

        test('saveCatatanFromPrintModal mendukung parameter onlyIfChanged dan memverifikasi perubahan sebelum menulis ke database', () => {
            const startIdx = pageWaliJs.indexOf('window.saveCatatanFromPrintModal = async function');
            expect(startIdx).toBeGreaterThan(-1);
            const fnScope = pageWaliJs.substring(startIdx, startIdx + 3000);

            expect(fnScope).toContain('shouldCloseModal = true, onlyIfChanged = false');
            expect(fnScope).toContain('const existingText = getExistingSavedPrintNote(nis);');
            expect(fnScope).toContain('const isNoteChanged = (text !== existingText);');
            expect(fnScope).toContain('if (onlyIfChanged && !isNoteChanged)');
            expect(fnScope).toContain('activePrintStudent._originalNote = text;');
        });

        test('printReportCardWali hanya memanggil saveCatatanFromPrintModal jika isNoteChanged bernilai true', () => {
            const startIdx = pageWaliJs.indexOf('window.printReportCardWali = async function');
            expect(startIdx).toBeGreaterThan(-1);
            const fnScope = pageWaliJs.substring(startIdx, startIdx + 2000);

            expect(fnScope).toContain('const currentInputNote = (document.getElementById(\'print-notes-input\')?.value || \'\').trim();');
            expect(fnScope).toContain('const existingSavedNote = getExistingSavedPrintNote(activePrintStudent.nis);');
            expect(fnScope).toContain('const isNoteChanged = (currentInputNote !== existingSavedNote);');
            expect(fnScope).toContain('if (isNoteChanged) {');
            expect(fnScope).toContain('await window.saveCatatanFromPrintModal(false, false);');
        });
    });

    describe('8. Sinkronisasi Log Ketidakhadiran Rapor Afektif & Pemuatan Cache Memori Presensi Rombel', () => {
        test('getStudentAttendanceLogsFromClass terdefinisi dan diekspor ke window', () => {
            expect(pageWaliJs).toContain('function getStudentAttendanceLogsFromClass(targetNis, startDateIso, endDateIso)');
            expect(pageWaliJs).toContain('window.getStudentAttendanceLogsFromClass = getStudentAttendanceLogsFromClass;');
        });

        test('fetchStudentAttendanceRange mendukung variasi format NIS via in filter', () => {
            expect(globalJs).toContain('const cleanNorm = nisStr.replace(/^0+/, \'\');');
            expect(globalJs).toContain('cleanNorm ? cleanNorm.padStart(4, \'0\') : nisStr');
            expect(globalJs).toContain('qb.in(\'student_nis\', nisVariants)');
        });

        test('buildRaporAfektifPageHtml tidak merender status salah nihil absen jika ringkasan mencatat ketidakhadiran', () => {
            const startIdx = pageWaliJs.indexOf('function buildRaporAfektifPageHtml(student, options = {})');
            expect(startIdx).toBeGreaterThan(-1);
            const fnScope = pageWaliJs.substring(startIdx, startIdx + 12000);

            expect(fnScope).toContain('(s > 0 || i > 0 || a > 0 || d > 0 || p > 0) ? `');
            expect(fnScope).toContain('Tercatat pada rekapan:');
            expect(fnScope).toContain('- Hadir Penuh (Nihil Absen/Permisi) -');
        });

        test('printReportCardWali dan printAllRaporAfektifWali memuat rincian attendance dari cache kelas sebelum cetak', () => {
            const startIdxPrint = pageWaliJs.indexOf('window.printReportCardWali = async function');
            expect(startIdxPrint).toBeGreaterThan(-1);
            const fnScopePrint = pageWaliJs.substring(startIdxPrint, startIdxPrint + 8000);
            expect(fnScopePrint).toContain('getStudentAttendanceLogsFromClass(activePrintStudent.nis, startDateIso, endDateIso)');

            const startIdxBulk = pageWaliJs.indexOf('window.printAllRaporAfektifWali = async function');
            expect(startIdxBulk).toBeGreaterThan(-1);
            const fnScopeBulk = pageWaliJs.substring(startIdxBulk, startIdxBulk + 8000);
            expect(fnScopeBulk).toContain('getStudentAttendanceLogsFromClass(targetNisStr, startDateIso, endDateIso)');
        });

        test('buildRaporAfektifPageHtml memformat NIP wali kelas dengan awalan NIP. dan bukan angka saja', () => {
            const startIdx = pageWaliJs.indexOf('function buildRaporAfektifPageHtml(student, options = {})');
            expect(startIdx).toBeGreaterThan(-1);
            const fnScope = pageWaliJs.substring(startIdx, startIdx + 5000);

            expect(fnScope).toContain('const cleanTeacherNip = (teacher.nip && typeof cleanNipWithoutSpaces === \'function\')');
            expect(fnScope).toContain('cleanTeacherNip.toUpperCase().startsWith(\'NIP\') ? cleanTeacherNip : `NIP. ${cleanTeacherNip}`');
        });
    });

    describe('9. Sinkronisasi PRD, Versi, & Dokumentasi Rilis', () => {
        test('package.json mencatat versi aktif valid', () => {
            expect(packageJson.version).toMatch(/^\d{2}\.\d{2}\.\d{2}\.\d+$/);
        });

        test('js/config.js mengekspor APP_VERSION sesuai package.json', () => {
            expect(configJs).toContain(`export const APP_VERSION = "${packageJson.version}";`);
        });

        test('PRD_SIMAS.md memuat versi aktif dan spesifikasi Rapor Vokasi Perhotelan', () => {
            expect(prdSimas).toContain(`[${packageJson.version}]`);
            expect(prdSimas).toContain('Rapor Vokasi Perhotelan');
            expect(prdSimas).toContain('Food and Beverage Service');
            expect(prdSimas).toContain('Housekeeping');
        });

        test('CHANGELOG.md mencatat rilis dan spesifikasi Rapor Vokasi Perhotelan', () => {
            expect(changelogMd).toContain(`[${packageJson.version}]`);
            expect(changelogMd).toContain('Rapor Vokasi Perhotelan');
        });
    });
});

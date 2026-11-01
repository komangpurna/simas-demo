/**
 * Test Suite: Sinkronisasi Poin Pelanggaran & Konteks AI pada Modal Catatan Rapor Wali Kelas
 * Memverifikasi eliminasi bug poin 0 dan akurasi indikator preview pada modal-catatan-rapor
 */

const fs = require('fs');
const path = require('path');

describe('Sinkronisasi Poin Pelanggaran & Konteks AI pada Modal Catatan Rapor Wali Kelas', () => {
    let pageWaliJs;
    let waliHtml;
    let packageJson;
    let configJs;
    let prdSimas;
    let changelog;

    beforeAll(() => {
        pageWaliJs = fs.readFileSync(path.join(__dirname, '../js/page-wali-kelas.js'), 'utf8');
        waliHtml = fs.readFileSync(path.join(__dirname, '../wali-kelas.html'), 'utf8');
        packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
        configJs = fs.readFileSync(path.join(__dirname, '../js/config.js'), 'utf8');
        prdSimas = fs.readFileSync(path.join(__dirname, '../PRD_SIMAS.md'), 'utf8');
        changelog = fs.readFileSync(path.join(__dirname, '../CHANGELOG.md'), 'utf8');
    });

    describe('1. Verifikasi Integrasi Asinkron & Skema Agregat D1 di openModalCatatanRapor', () => {
        test('openModalCatatanRapor dideklarasikan sebagai fungsi asinkron (async)', () => {
            expect(pageWaliJs).toContain('window.openModalCatatanRapor = async function (nis)');
        });

        test('openModalCatatanRapor mengekstrak properti standar Cloudflare D1 SQL (points, achievement_count, permission_count)', () => {
            const fnIdx = pageWaliJs.indexOf('window.openModalCatatanRapor = async function');
            expect(fnIdx).toBeGreaterThan(-1);
            const fnBody = pageWaliJs.substring(fnIdx, fnIdx + 8000);

            expect(fnBody).toContain('agg.points');
            expect(fnBody).toContain('agg.poinPelanggaran');
            expect(fnBody).toContain('agg.achievement_count');
            expect(fnBody).toContain('agg.permission_count');
            expect(fnBody).toContain('currentPermissionCounts[targetNisStr]');
        });

        test('openModalCatatanRapor memanggil ensureStudentRecords untuk memuat data live D1 (0 Firestore Read)', () => {
            const fnIdx = pageWaliJs.indexOf('window.openModalCatatanRapor = async function');
            const fnBody = pageWaliJs.substring(fnIdx, fnIdx + 8000);

            expect(fnBody).toContain('const liveRecords = await ensureStudentRecords(student);');
            expect(fnBody).toContain('activePrintStudent.records = liveRecords;');
        });

        test('openModalCatatanRapor memiliki fallback dinamis menghitung poin dari rincian catatan pelanggaran', () => {
            const fnIdx = pageWaliJs.indexOf('window.openModalCatatanRapor = async function');
            const fnBody = pageWaliJs.substring(fnIdx, fnIdx + 8000);

            expect(fnBody).toContain("r.type === 'pelanggaran' || r.category === 'Pelanggaran' || (r.points && Number(r.points) > 0 && r.type !== 'prestasi' && r.category !== 'Prestasi')");
            expect(fnBody).toContain('if (calculatedPoints > 0 && (poin === 0 || isNaN(poin)))');
            expect(fnBody).toContain("document.getElementById('rapor-preview-poin').textContent = poin;");
        });
    });

    describe('2. Verifikasi Prioritas Elemen Pratinjau pada generateCatatanRaporAI', () => {
        test('generateCatatanRaporAI mendeteksi status isRaporModalOpen', () => {
            const aiIdx = pageWaliJs.indexOf('window.generateCatatanRaporAI = async function');
            expect(aiIdx).toBeGreaterThan(-1);
            const aiBody = pageWaliJs.substring(aiIdx, aiIdx + 4000);

            expect(aiBody).toContain("const isRaporModalOpen = !document.getElementById('modal-catatan-rapor')?.classList.contains('hidden');");
        });

        test('generateCatatanRaporAI membaca rapor-preview-poin saat modal catatan rapor terbuka', () => {
            const aiIdx = pageWaliJs.indexOf('window.generateCatatanRaporAI = async function');
            const aiBody = pageWaliJs.substring(aiIdx, aiIdx + 4000);

            expect(aiBody).toContain("isRaporModalOpen ? document.getElementById('rapor-preview-poin') : document.getElementById('print-preview-poin')");
            expect(aiBody).toContain("isRaporModalOpen ? document.getElementById('rapor-preview-alpha') : document.getElementById('print-preview-alpha')");
            expect(aiBody).toContain("isRaporModalOpen ? document.getElementById('rapor-preview-prestasi') : document.getElementById('print-preview-prestasi')");
            expect(aiBody).toContain("isRaporModalOpen ? document.getElementById('rapor-preview-permisi') : document.getElementById('print-preview-permisi')");
        });
    });

    describe('3. Verifikasi Interaktivitas Dropdown Semester & Tahun Ajaran (onRaporModalPeriodChange)', () => {
        test('onRaporModalPeriodChange didefinisikan secara global di window', () => {
            expect(pageWaliJs).toContain('window.onRaporModalPeriodChange = async function ()');
        });

        test('wali-kelas.html mengikat event onchange ke window.onRaporModalPeriodChange()', () => {
            expect(waliHtml).toContain('id="rapor-academic-year" onchange="window.onRaporModalPeriodChange()"');
            expect(waliHtml).toContain('id="rapor-semester" onchange="window.onRaporModalPeriodChange()"');
        });
    });

    describe('4. Simulasi Logika Kalkulasi Agregat Poin Cloudflare D1', () => {
        test('Dapat mengekstrak poin dari objek respons Cloudflare D1 student_aggregates', () => {
            const mockD1Agg = {
                nis: '12345',
                points: 25,
                violation_count: 3,
                achievement_count: 1,
                permission_count: 2
            };

            const poin = Number(mockD1Agg.totalPoints ?? mockD1Agg.poinPelanggaran ?? mockD1Agg.points ?? mockD1Agg.poin ?? 0);
            const prestasi = Number(mockD1Agg.totalPrestasi ?? mockD1Agg.prestasiCount ?? mockD1Agg.achievement_count ?? 0);
            const permisi = Number(mockD1Agg.totalPermisi ?? mockD1Agg.permission_count ?? 0);

            expect(poin).toBe(25);
            expect(prestasi).toBe(1);
            expect(permisi).toBe(2);
        });

        test('Dapat menghitung fallback poin jika agregat statis bernilai 0 tetapi records memiliki pelanggaran', () => {
            const mockD1AggEmpty = { nis: '12345', points: 0 };
            let poin = Number(mockD1AggEmpty.points || 0);

            const mockRecords = [
                { type: 'pelanggaran', category: 'Tata Tertib', points: 10 },
                { type: 'pelanggaran', category: 'Kerapian', points: 5 },
                { type: 'prestasi', category: 'Akademik', points: 0 }
            ];

            const calculatedPoints = mockRecords
                .filter(r => r.type === 'pelanggaran' || r.category === 'Pelanggaran' || (r.points && Number(r.points) > 0 && r.type !== 'prestasi'))
                .reduce((sum, r) => sum + Number(r.points || 0), 0);

            if (calculatedPoints > 0 && poin === 0) {
                poin = calculatedPoints;
            }

            expect(poin).toBe(15);
        });
    });

    describe('5. Verifikasi Konsistensi Nomor Versi SSOT', () => {
        test('package.json memuat versi semantik yang valid', () => {
            expect(packageJson.version).toMatch(/^\d{2}\.\d{2}\.\d{2}\.\d+$/);
        });

        test('js/config.js APP_VERSION sinkron dengan package.json', () => {
            expect(configJs).toMatch(new RegExp(`APP_VERSION\\s*=\\s*["']${packageJson.version}["']`));
        });

        test('PRD_SIMAS.md memuat dokumentasi rilis rapor wali kelas', () => {
            expect(prdSimas).toContain('Catatan Rapor Wali Kelas');
        });

        test('CHANGELOG.md memuat dokumentasi rilis 26.10.23.3', () => {
            expect(changelog).toContain('## [1.2.512] / [26.10.23.3] - 2026-10-23');
        });
    });
});

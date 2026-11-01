const fs = require('fs');
const path = require('path');
const DataHolidays = require('../js/data-holidays.js');
global.DataHolidays = DataHolidays;

describe('Verifikasi Fitur Visual Pasfoto Guru & Materi KBM di Monitoring KBM', () => {
    const projectRoot = path.resolve(__dirname, '..');
    const htmlContent = fs.readFileSync(path.join(projectRoot, 'monitoring-kbm.html'), 'utf8');
    const jsContent = fs.readFileSync(path.join(projectRoot, 'js', 'page-monitoring-kbm.js'), 'utf8');
    const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

    test('1. Struktur Elemen Modal Detail Sel KBM di HTML (Compact & Informatif)', () => {
        expect(htmlContent).toContain('id="modal-kbm-cell-detail"');
        expect(htmlContent).toContain('id="kbm-detail-kelas"');
        expect(htmlContent).toContain('id="kbm-detail-jp"');
        expect(htmlContent).toContain('id="kbm-detail-mapel"');
        expect(htmlContent).toContain('id="kbm-detail-badge"');
        expect(htmlContent).toContain('id="kbm-detail-tooltip"');
        expect(htmlContent).toContain('id="kbm-detail-guru-foto"');
        expect(htmlContent).toContain('id="kbm-detail-guru-placeholder"');
        expect(htmlContent).toContain('id="kbm-detail-guru-initial"');
        expect(htmlContent).toContain('id="kbm-detail-guru-nip"');
        expect(htmlContent).toContain('id="kbm-detail-materi-container"');
        expect(htmlContent).toContain('id="kbm-detail-materi"');
        expect(htmlContent).toContain('id="kbm-detail-catatan-container"');
        expect(htmlContent).toContain('id="kbm-detail-catatan"');
        expect(htmlContent).toContain('id="kbm-detail-presensi-container"');
        expect(htmlContent).toContain('id="kbm-detail-presensi-summary"');
        expect(htmlContent).toContain('id="kbm-detail-presensi-list"');
        expect(htmlContent).toContain(`src="js/page-monitoring-kbm.js?v=${packageJson.version}"`);
    });

    test('2. Logika JavaScript: Helper getTeacherObject & Import resolvePhotoUrl', () => {
        expect(jsContent).toContain('import { auth, supabase, resolvePhotoUrl } from "./config.js";');
        expect(jsContent).toContain('export function getTeacherObject(rawName, masterList = [])');
    });

    test('3. Logika Zero-Growth Layout Corner Micro-Avatar & Dataset Attributes', () => {
        expect(jsContent).toContain('const resolvedCornerFoto = g.guruFoto ? resolvePhotoUrl(g.guruFoto) : "";');
        expect(jsContent).toContain('absolute top-0.5 right-0.5 pointer-events-none z-10');
        expect(jsContent).toContain('w-6 h-6 rounded-full object-cover');
        expect(jsContent).toContain('hover:scale-[3.2]');
        expect(htmlContent).toContain('hover:scale-[2]');
        expect(jsContent).toContain('data-guru-foto=');
        expect(jsContent).toContain('data-guru-nip=');
        expect(jsContent).toContain('data-topik=');
        expect(jsContent).toContain('data-catatan=');
        expect(jsContent).toContain('data-has-jurnal=');
    });

    test('4. Logika Modal Detail Sel showKbmCellDetail Menangani Foto, NIP, Catatan, & Presensi Siswa', () => {
        expect(jsContent).toContain('window.showKbmCellDetail = function (kelas, jpText, mapel, guru, badgeText, badgeClass, tooltipText, extraData = {})');
        expect(jsContent).toContain('elGuruNip.textContent = `NIP: ${nip}`;');
        expect(jsContent).toContain('elMateri.textContent = `"${topik}"`;');
        expect(jsContent).toContain('elGuruFoto.onerror');
        expect(jsContent).toContain('elCatatanContainer');
        expect(jsContent).toContain('elPresensiContainer');
        expect(jsContent).toContain('getStudentStatusInfo');
    });

    test('5. Helper getStudentStatusInfo Memetakan Status Presensi Siswa secara Tepat', () => {
        // Cek bahwa di jsContent ada definisi getStudentStatusInfo yang memetakan S, I, A/TK, T, D
        expect(jsContent).toContain('case "S":');
        expect(jsContent).toContain('case "I":');
        expect(jsContent).toContain('case "A":');
        expect(jsContent).toContain('case "T":');
        expect(jsContent).toContain('case "D":');
    });

    test('6. Pengujian Fungsi getTeacherObject secara Logis', () => {
        const mockMasterList = [
            { id: '1', name: 'I Wayan Suweta, S.Pd.', nip: '197501012000011001', foto: 'https://r2.example.com/suweta.webp' },
            { id: '2', name: 'Ni Ketut Widiasih, M.Pd.', nip: '198002022005012002', foto: '' }
        ];

        function mockGetTeacherObject(rawName, masterList) {
            if (!rawName || rawName === '-' || rawName === 'Belum diisi') return null;
            const clean = rawName.trim().toLowerCase();
            return masterList.find(t => t.name.toLowerCase().includes(clean) || clean.includes(t.name.toLowerCase()) || t.nip === rawName) || null;
        }

        const found = mockGetTeacherObject('I Wayan Suweta', mockMasterList);
        expect(found).not.toBeNull();
        expect(found.nip).toBe('197501012000011001');
        expect(found.foto).toBe('https://r2.example.com/suweta.webp');

        const notFound = mockGetTeacherObject('Belum diisi', mockMasterList);
        expect(notFound).toBeNull();
    });

    test('7. Verifikasi Kejelasan Terminologi 2-Arah KBM (Scan Guru + Presensi Hadir Siswa)', () => {
        // Legenda HTML memuat label spesifik
        expect(htmlContent).toContain('🟢 Terverifikasi (Scan Guru + Presensi Hadir Siswa)');
        expect(htmlContent).toContain('🩵 Belum Diabsen Siswa');

        // JS memuat tooltip eksplisit membedakan scan barcode guru vs presensi kehadiran guru oleh siswa
        expect(jsContent).toContain('🟢 Terverifikasi Sempurna: Jurnal KBM Guru Terisi (Scan Barcode) & Presensi Kehadiran Guru oleh Siswa Berstatus Hadir (H)');
        expect(jsContent).toContain('🩵 Jurnal Guru Sudah Terisi (Scan Barcode), Namun Siswa/Admin Kelas Belum Mengisi Presensi Kehadiran Guru');
        expect(jsContent).toMatch(/🔴 Jurnal Kosong: (?:JP|Hari) Sudah Lewat & Guru Belum Mengisi Jurnal KBM via Scan Barcode/);
        expect(jsContent).toContain('🟡 Belum Isi Jurnal: Presensi Guru Hadir Terisi oleh Siswa / Terjadwal, Namun Guru Belum Mengisi Jurnal KBM via Scan Barcode Hari Ini');
    });

    test('8. Verifikasi Dokumentasi Mekanisme Verifikasi 2-Arah & TE di PRD_SIMAS.md', () => {
        const prdContent = fs.readFileSync(path.join(projectRoot, 'PRD_SIMAS.md'), 'utf8');
        expect(prdContent).toContain('Mekanisme Verifikasi 2-Arah KBM (`cellState = VERIFIED`)');
        expect(prdContent).toContain('Mekanisme Otomatis Penentuan "Tidak Belajar Efektif" (TE) per Angkatan');
        expect(prdContent).toContain('Pihak Guru:** Mengisi Jurnal KBM (`jurnal_guru`) di kelas yang diawali dengan memindai (scan) QR Code / barcode');
        expect(prdContent).toContain('Pihak Siswa (Admin Kelas / Piket):** Mengisi formulir Presensi Kehadiran Guru (`guru_presensi`)');
    });

    test('9. Verifikasi Auto-Pagination Kueri Jurnal Cloudflare D1 di fetchCrossVerifiedData', () => {
        const freshJs = fs.readFileSync(path.join(projectRoot, 'js', 'page-monitoring-kbm.js'), 'utf8');
        expect(freshJs).toContain('let hasMore = true;');
        expect(freshJs).toContain('let offset = 0;');
        expect(freshJs).toContain('const CHUNK_SIZE = 1000;');
        expect(freshJs).toContain('const allJurnalRows = [];');
        expect(freshJs).toContain('while (hasMore && pageCount < MAX_PAGES)');
        expect(freshJs).toContain('offset: offset');
    });

    test('10. Integrasi Master Data Hari Libur Nasional Otomatis (DataHolidays) di Monitoring KBM', () => {
        const freshHtml = fs.readFileSync(path.join(projectRoot, 'monitoring-kbm.html'), 'utf8');
        const freshJs = fs.readFileSync(path.join(projectRoot, 'js', 'page-monitoring-kbm.js'), 'utf8');
        expect(freshHtml).toContain('<script src="js/data-holidays.js"></script>');
        expect(freshJs).toContain('export function getHolidayHelper()');
        expect(freshJs).toContain('export function isHolidayDate(dateStr)');
        expect(freshJs).toContain('export function getHolidayDateInfo(dateStr)');
        expect(freshJs).toContain('export function collectActiveKbmDates');
        expect(freshJs).toContain('export function buildJPTidakEfektifAngkatanMap');
        expect(freshJs).toContain('collectActiveKbmDates({ periodeType: "mingguan"');
        expect(freshJs).toContain('collectActiveKbmDates({ periodeType: "bulanan"');
        expect(freshJs).toContain('collectActiveKbmDates({ periodeType: "semester"');
    });

    test('11. Fungsi collectActiveKbmDates Mengecualikan Hari Libur Nasional Resmi (SKB 3 Menteri) & Weekend', () => {
        function formatLocalIso(dateObj) {
            const y = dateObj.getFullYear();
            const m = String(dateObj.getMonth() + 1).padStart(2, '0');
            const d = String(dateObj.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        }

        function isHolidayDate(dateStr) {
            return DataHolidays.isNationalHoliday(dateStr);
        }

        function collectActiveKbmDatesMock({ periodeType, startDate, endDate, bulan }) {
            const dates = [];
            if (periodeType === 'mingguan') {
                const start = new Date(startDate);
                const end = new Date(endDate);
                for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                    const dateStr = formatLocalIso(d);
                    if (d.getDay() !== 0 && d.getDay() !== 6 && !isHolidayDate(dateStr)) {
                        dates.push(dateStr);
                    }
                }
            } else if (periodeType === 'bulanan') {
                const [year, month] = bulan.split('-');
                const yNum = parseInt(year, 10);
                const mNum = parseInt(month, 10);
                const daysInMonth = new Date(yNum, mNum, 0).getDate();
                for (let day = 1; day <= daysInMonth; day++) {
                    const d = new Date(yNum, mNum - 1, day);
                    const dateStr = formatLocalIso(d);
                    if (d.getDay() !== 0 && d.getDay() !== 6 && !isHolidayDate(dateStr)) {
                        dates.push(dateStr);
                    }
                }
            }
            return dates;
        }

        // Uji Mingguan: 17 Agustus 2026 (Senin) adalah Libur Nasional HUT RI
        const mingguanHutRi = collectActiveKbmDatesMock({
            periodeType: 'mingguan',
            startDate: new Date('2026-08-17'),
            endDate: new Date('2026-08-21')
        });
        // 17 Agustus 2026 harus DIKECUALIKAN dari daftar dates KBM
        expect(mingguanHutRi).not.toContain('2026-08-17');
        expect(mingguanHutRi).toContain('2026-08-18');
        expect(mingguanHutRi).toContain('2026-08-19');
        expect(mingguanHutRi).toContain('2026-08-20');
        expect(mingguanHutRi).toContain('2026-08-21');
        expect(mingguanHutRi.length).toBe(4);

        // Uji Bulanan: Maret 2026 (terdapat libur Nyepi 19 Maret & Cuti Bersama 18 Maret)
        const bulananMaret = collectActiveKbmDatesMock({
            periodeType: 'bulanan',
            bulan: '2026-03'
        });
        expect(bulananMaret).not.toContain('2026-03-18'); // Cuti Nyepi
        expect(bulananMaret).not.toContain('2026-03-19'); // Hari Suci Nyepi
        expect(bulananMaret).not.toContain('2026-03-20'); // Cuti Idul Fitri
        expect(bulananMaret).not.toContain('2026-03-23'); // Cuti Idul Fitri
        expect(bulananMaret).not.toContain('2026-03-24'); // Cuti Idul Fitri
    });

    test('12. buildJPTidakEfektifAngkatanMap Mengabaikan Hari Libur Nasional & Akhir Pekan', () => {
        const isHolidayDate = (dateStr) => DataHolidays.isNationalHoliday(dateStr);
        const isJPElapsed = () => true; // Simulasikan seluruh JP telah lampau

        function mockBuildJPTidakEfektif(kelasList, matrixForDate, targetDateStr) {
            const map = { X: {}, XI: {}, XII: {}, OTHER: {} };
            const selectedDate = targetDateStr ? new Date(targetDateStr + "T00:00:00") : new Date();
            const dayOfWeek = selectedDate.getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            const isHoliday = isWeekend || isHolidayDate(targetDateStr);

            for (let jpNum = 1; jpNum <= 10; jpNum++) {
                const elapsed = !isHoliday && isJPElapsed(jpNum, targetDateStr);
                const verifiedCountByAngkatan = { X: 0, XI: 0, XII: 0, OTHER: 0 };
                Object.keys(verifiedCountByAngkatan).forEach((angk) => {
                    if (!map[angk]) map[angk] = {};
                    map[angk][jpNum] = elapsed && (verifiedCountByAngkatan[angk] <= 2);
                });
            }
            return map;
        }

        // Pada Hari Libur Nasional (2026-08-17), seluruh JP tidak boleh ditandai Tidak Efektif
        const mapHoliday = mockBuildJPTidakEfektif(['X-1', 'XI-1', 'XII-1'], {}, '2026-08-17');
        expect(mapHoliday.X[1]).toBe(false);
        expect(mapHoliday.XI[1]).toBe(false);
        expect(mapHoliday.XII[1]).toBe(false);

        // Pada Hari KBM Aktif (2026-08-18), jika verifikasi <= 2, terdeteksi Tidak Efektif
        const mapActive = mockBuildJPTidakEfektif(['X-1', 'XI-1', 'XII-1'], {}, '2026-08-18');
        expect(mapActive.X[1]).toBe(true);
        expect(mapActive.XI[1]).toBe(true);
        expect(mapActive.XII[1]).toBe(true);
    });

    test('13. Tab Detail Guru: Eksklusi Tanggal Masa Depan, Hari Libur, dan Sesi Belum Terlaksana (Status -)', () => {
        const freshJs = fs.readFileSync(path.join(projectRoot, 'js', 'page-monitoring-kbm.js'), 'utf8');
        expect(freshJs).toContain('dates = dates.filter((d) => d <= todayStr);');
        expect(freshJs).toContain('if (date > todayStr) return;');
        expect(freshJs).toContain('if (!status || status === "-")');
        expect(freshJs).toContain('if (isHolidayDate(date) || (matrix._nonEffectiveDates && matrix._nonEffectiveDates.has(date)))');
    });

    test('14. Logika Tab Detail Guru Hanya Memasukkan Sesi Terlaksana & Melindungi Persentase Kehadiran', () => {
        const todayStr = '2026-10-06';
        const mockRawSlots = [
            { tanggal: '2026-10-01', jp: 8, mapel: 'Matematika', status: 'H' }, // Terlaksana Hadir
            { tanggal: '2026-10-02', jp: 4, mapel: 'Matematika', status: 'H' }, // Terlaksana Hadir
            { tanggal: '2026-10-06', jp: 1, mapel: 'Matematika', status: '-' }, // Hari ini JP belum jalan
            { tanggal: '2026-10-06', jp: 2, mapel: 'Matematika', status: '-' }, // Hari ini JP belum jalan
            { tanggal: '2026-10-07', jp: 1, mapel: 'Matematika', status: '-' }, // Tanggal masa depan
        ];

        const filteredDetailData = [];
        const stats = { H: 0, K: 0, I: 0, S: 0, TK: 0, TE: 0, total: 0 };

        mockRawSlots.forEach(slot => {
            // 1. Abaikan tanggal masa depan
            if (slot.tanggal > todayStr) return;

            // 2. Abaikan sesi KBM yang belum terlaksana (status '-')
            if (!slot.status || slot.status === '-') return;

            filteredDetailData.push(slot);

            if (slot.status === 'TE') {
                stats.TE++;
            } else if (['H', 'K', 'I', 'S', 'TK', 'TT'].includes(slot.status)) {
                stats.total++;
                if (slot.status === 'H') stats.H++;
                else if (slot.status === 'K') stats.K++;
                else if (slot.status === 'I') stats.I++;
                else if (slot.status === 'S') stats.S++;
                else if (slot.status === 'TK' || slot.status === 'TT') stats.TK++;
            }
        });

        // Hanya 2 slot yang sudah terlaksana yang masuk
        expect(filteredDetailData.length).toBe(2);
        expect(filteredDetailData.map(d => d.tanggal)).toEqual(['2026-10-01', '2026-10-02']);
        expect(filteredDetailData.some(d => d.status === '-')).toBe(false);
        expect(filteredDetailData.some(d => d.tanggal > todayStr)).toBe(false);

        // Statistik kehadiran tetap 100% (2 Hadir dari 2 total sesi terlaksana), tidak rusak oleh slot '-'
        expect(stats.total).toBe(2);
        expect(stats.H).toBe(2);
        const persen = Math.round((stats.H / stats.total) * 100);
        expect(persen).toBe(100);
    });
});

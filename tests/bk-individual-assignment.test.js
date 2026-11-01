/**
 * tests/bk-individual-assignment.test.js
 * ====================================================================
 * Test Suite: Integritas Pembagian Rombel Guru BK Perorangan & Kesetaraan Alur KBM
 * Memvalidasi:
 * 1. Parser XML (asc-schedule-parser.js) memetakan guru BK perorangan secara seragam seperti guru mapel lainnya tanpa entitas khusus generic TIM BK.
 * 2. Halaman Jurnal (page-jurnal.js) memperlakukan guru BK 100% sama dengan guru mapel lainnya.
 * 3. Halaman E-Rapor (page-e-rapor.js) menyelaraskan mapel BK langsung dari XML per rombel tanpa branching khusus BK.
 * 4. Halaman Presensi Guru (page-presensi-guru.js) mengizinkan pengisian presensi guru BK sesuai jadwal definitif tanpa generic TIM BK.
 * 5. Halaman Beban Kerja (page-beban-kerja.js) mencocokkan guru BK secara langsung via normalisasi nama.
 * ====================================================================
 */

const fs = require('fs');
const path = require('path');

describe('Suite Integritas Pembagian Rombel Guru BK Perorangan & Kesetaraan Alur KBM', () => {
    const root = path.resolve(__dirname, '..');
    const ascScheduleParserJs = fs.readFileSync(path.join(root, 'js', 'asc-schedule-parser.js'), 'utf8');
    const pageJurnalJs = fs.readFileSync(path.join(root, 'js', 'page-jurnal.js'), 'utf8');
    const pageBebanKerjaJs = fs.readFileSync(path.join(root, 'js', 'page-beban-kerja.js'), 'utf8');
    const pageERaporJs = fs.readFileSync(path.join(root, 'js', 'page-e-rapor.js'), 'utf8');
    const pagePresensiGuruJs = fs.readFileSync(path.join(root, 'js', 'page-presensi-guru.js'), 'utf8');

    describe('1. Parser Jadwal XML (asc-schedule-parser.js)', () => {
        test('tidak lagi memiliki perkondisian dummy TIM_BK atau branching khusus isBkSubject', () => {
            expect(ascScheduleParserJs).not.toContain("id: 'TIM_BK'");
            expect(ascScheduleParserJs).not.toContain("const isBkSubject =");
        });

        test('memetakan guru pengampu langsung dari lessons ke kelas masing-masing', () => {
            expect(ascScheduleParserJs).toContain('const guruList = Array.from(guruMap.values()).map(g => ({');
        });
    });

    describe('2. Halaman Jurnal Mengajar (page-jurnal.js)', () => {
        test('tidak memiliki isBkPlaceholder atau percabangan khusus TIM BK', () => {
            expect(pageJurnalJs).not.toContain('isBkPlaceholder');
            expect(pageJurnalJs).not.toContain("rawTrimmed.toUpperCase().includes('TIM BK')");
            expect(pageJurnalJs).not.toContain("slot.guruNama.toUpperCase().includes('TIM BK')");
        });

        test('getTeachersForClass mengembalikan pengampu kelas murni dari jadwal XML & master', () => {
            expect(pageJurnalJs).not.toContain('let hasBk = false;');
            expect(pageJurnalJs).toContain('if (teacherNames.length === 0) {');
        });

        test('compareWithActualSchedule memvalidasi guru dan mapel secara langsung & universal', () => {
            expect(pageJurnalJs).toContain('const isGuruMatch = scheduledGurus.some(schedG => {');
            expect(pageJurnalJs).toContain('const isMapelMatch = scheduledMapels.some(schedM => {');
            expect(pageJurnalJs).not.toContain('isBkSlot');
            expect(pageJurnalJs).not.toContain('isUserGuruBk');
        });
    });

    describe('3. Halaman Beban Kerja (page-beban-kerja.js)', () => {
        test('findTeacherInParsedSchedule mencocokkan guru perorangan langsung tanpa fallback generic TIM BK', () => {
            expect(pageBebanKerjaJs).not.toContain("tName.includes('TIM BK')");
            expect(pageBebanKerjaJs).not.toContain('// Match 4: Guru BK fallback ke entitas generic TIM BK');
        });
    });

    describe('4. Halaman E-Rapor (page-e-rapor.js)', () => {
        test('syncMapelFromXML memproses seluruh mata pelajaran termasuk BK secara seragam dari guruList XML', () => {
            expect(pageERaporJs).not.toContain("const isBk = mName.toUpperCase().includes('BIMBINGAN')");
            expect(pageERaporJs).not.toContain('previousRealBk');
            expect(pageERaporJs).not.toContain('[Grup] TIM BK');
        });
    });

    describe('5. Halaman Presensi Guru (page-presensi-guru.js)', () => {
        test('memperlakukan mapel BK dan guru BK seragam dengan mapel umum lainnya', () => {
            expect(pagePresensiGuruJs).not.toContain("isItemBK");
            expect(pagePresensiGuruJs).not.toContain("Guru Anggota TIM BK");
            expect(pagePresensiGuruJs).not.toContain("guruNama.toUpperCase().includes('TIM BK')");
        });
    });

    describe('6. Simulasi Logika Pengisian Jurnal Guru BK Perorangan', () => {
        test('guru BK A (Sujana) dan guru BK B (Suardana) mengisi jurnal sesuai rombel jadwal definitif masing-masing', () => {
            const mockScheduleMap = {
                'XII-1': {
                    1: {
                        1: { jp: 1, mapel: 'Bimbingan dan Konseling', guruNama: 'I Ketut Sujana, S.Pd' },
                        2: { jp: 2, mapel: 'Bimbingan dan Konseling', guruNama: 'I Ketut Sujana, S.Pd' }
                    }
                },
                'XII-3': {
                    1: {
                        1: { jp: 1, mapel: 'Bimbingan dan Konseling', guruNama: 'I Kadek Suardana, S.Pd.' },
                        2: { jp: 2, mapel: 'Bimbingan dan Konseling', guruNama: 'I Kadek Suardana, S.Pd.' }
                    }
                }
            };

            function simulateMatch(className, day, jpList, guruInput, mapelInput) {
                const daySlots = mockScheduleMap[className]?.[day] || {};
                const expectedSlots = jpList.map(j => daySlots[j]).filter(Boolean);
                const schedGurus = Array.from(new Set(expectedSlots.map(s => s.guruNama)));
                const schedMapels = Array.from(new Set(expectedSlots.map(s => s.mapel)));

                const isGuruMatch = schedGurus.includes(guruInput);
                const isMapelMatch = schedMapels.includes(mapelInput);
                return isGuruMatch && isMapelMatch;
            }

            // Sujana di XII-1: MATCH
            expect(simulateMatch('XII-1', 1, [1, 2], 'I Ketut Sujana, S.Pd', 'Bimbingan dan Konseling')).toBe(true);

            // Suardana mencoba mengisi di XII-1 (bukan kelasnya): TIDAK MATCH
            expect(simulateMatch('XII-1', 1, [1, 2], 'I Kadek Suardana, S.Pd.', 'Bimbingan dan Konseling')).toBe(false);

            // Suardana di XII-3: MATCH
            expect(simulateMatch('XII-3', 1, [1, 2], 'I Kadek Suardana, S.Pd.', 'Bimbingan dan Konseling')).toBe(true);

            // Sujana mencoba mengisi di XII-3 (bukan kelasnya): TIDAK MATCH
            expect(simulateMatch('XII-3', 1, [1, 2], 'I Ketut Sujana, S.Pd', 'Bimbingan dan Konseling')).toBe(false);
        });
    });
});

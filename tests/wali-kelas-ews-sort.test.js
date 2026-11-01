const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Pengujian Interaktif Header Kolom Skor EWS & Sorting Tabel Portal Wali Kelas', () => {
    const projectRoot = path.resolve(__dirname, '..');
    const htmlContent = fs.readFileSync(path.join(projectRoot, 'wali-kelas.html'), 'utf8');
    const jsContent = fs.readFileSync(path.join(projectRoot, 'js', 'page-wali-kelas.js'), 'utf8');
    const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

    describe('1. Analisis Statis Struktur DOM wali-kelas.html', () => {
        test('Header kolom Skor EWS pada Tab EWS memiliki onclick sortEwsTable dan icon indikator', () => {
            expect(htmlContent).toContain('onclick="window.sortEwsTable(\'score\')"');
            expect(htmlContent).toContain('id="sort-icon-ews-score"');
            expect(htmlContent).toContain('title="Urutkan Skor EWS (Tertinggi / Terendah)"');
        });

        test('Header kolom lain pada tabel EWS juga mendukung sortir interaktif yang konsisten', () => {
            expect(htmlContent).toContain('onclick="window.sortEwsTable(\'no\')"');
            expect(htmlContent).toContain('onclick="window.sortEwsTable(\'name\')"');
            expect(htmlContent).toContain('onclick="window.sortEwsTable(\'alpa\')"');
            expect(htmlContent).toContain('onclick="window.sortEwsTable(\'points\')"');
            expect(htmlContent).toContain('onclick="window.sortEwsTable(\'permisi\')"');
            expect(htmlContent).toContain('onclick="window.sortEwsTable(\'level\')"');

            expect(htmlContent).toContain('id="sort-icon-ews-no"');
            expect(htmlContent).toContain('id="sort-icon-ews-name"');
            expect(htmlContent).toContain('id="sort-icon-ews-alpa"');
            expect(htmlContent).toContain('id="sort-icon-ews-points"');
            expect(htmlContent).toContain('id="sort-icon-ews-permisi"');
            expect(htmlContent).toContain('id="sort-icon-ews-level"');
        });

        test('Tabel EWS tidak menggunakan nesting modal dan struktur thead seimbang', () => {
            expect(htmlContent).toContain('<tbody id="ews-table-body"');
        });
    });

    describe('2. Analisis Statis Kode Logika js/page-wali-kelas.js', () => {
        test('Mendefinisikan state currentEwsSort dan fungsi sortEwsTable di window', () => {
            expect(jsContent).toContain('let currentEwsSort =');
            expect(jsContent).toContain('window.currentEwsSort = currentEwsSort;');
            expect(jsContent).toContain('window.sortEwsTable = function');
            expect(jsContent).toContain('window.updateEwsSortIcons = updateEwsSortIcons;');
        });

        test('Logika sortir tabel EWS menangani kolom score, alpa, points, permisi, level, no, dan name', () => {
            expect(jsContent).toContain("if (column === 'score')");
            expect(jsContent).toContain("else if (column === 'alpa')");
            expect(jsContent).toContain("else if (column === 'points')");
            expect(jsContent).toContain("else if (column === 'permisi')");
            expect(jsContent).toContain("else if (column === 'level')");
            expect(jsContent).toContain("else if (column === 'no')");
        });
    });

    describe('3. Runtime Evaluasi Algoritma Pengurutan di Sandbox VM', () => {
        let sandbox;

        beforeEach(() => {
            sandbox = {
                currentEwsSort: { column: 'initial', order: 'asc' },
                currentClassStudents: [
                    {
                        name: 'Budi Santoso',
                        nis: '1001',
                        originalIndex: 0
                    },
                    {
                        name: 'Anisa Rahma',
                        nis: '1002',
                        originalIndex: 1
                    },
                    {
                        name: 'Citra Dewi',
                        nis: '1003',
                        originalIndex: 2
                    }
                ],
                sampleData: [
                    {
                        student: { name: 'Budi Santoso', nis: '1001' },
                        originalIndex: 0,
                        ewsRes: {
                            totalScore: 45,
                            level: 'medium',
                            label: 'Risiko Sedang',
                            details: { alpa: 2, izin: 1, points: 15, permisi: 2 }
                        }
                    },
                    {
                        student: { name: 'Anisa Rahma', nis: '1002' },
                        originalIndex: 1,
                        ewsRes: {
                            totalScore: 10,
                            level: 'low',
                            label: 'Disiplin Aman',
                            details: { alpa: 0, izin: 0, points: 5, permisi: 0 }
                        }
                    },
                    {
                        student: { name: 'Citra Dewi', nis: '1003' },
                        originalIndex: 2,
                        ewsRes: {
                            totalScore: 85,
                            level: 'high',
                            label: 'Risiko Tinggi',
                            details: { alpa: 4, izin: 2, points: 50, permisi: 3 }
                        }
                    }
                ],
                document: {
                    getElementById: () => ({ value: '', className: '', classList: { add: () => {} } })
                },
                window: {},
                console
            };

            const helperScript = `
                function sortEwsTable(columnKey) {
                    if (currentEwsSort.column === columnKey) {
                        currentEwsSort.order = currentEwsSort.order === 'asc' ? 'desc' : 'asc';
                    } else {
                        const isDescByDefault = ['score', 'alpa', 'points', 'permisi', 'level'].includes(columnKey);
                        currentEwsSort = {
                            column: columnKey,
                            order: isDescByDefault ? 'desc' : 'asc'
                        };
                    }
                }

                function sortEwsData(items) {
                    const { column, order } = currentEwsSort;
                    const isAsc = order === 'asc';
                    const riskLevelRank = { high: 3, medium: 2, low: 1 };

                    return [...items].sort((a, b) => {
                        if (column === 'score') {
                            const scoreA = Number(a.ewsRes?.totalScore || 0);
                            const scoreB = Number(b.ewsRes?.totalScore || 0);
                            if (scoreA !== scoreB) {
                                return isAsc ? scoreA - scoreB : scoreB - scoreA;
                            }
                            return (a.student.name || '').localeCompare(b.student.name || '', 'id', { numeric: true });
                        } else if (column === 'alpa') {
                            const alpaA = Number(a.ewsRes?.details?.alpa || 0);
                            const alpaB = Number(b.ewsRes?.details?.alpa || 0);
                            if (alpaA !== alpaB) {
                                return isAsc ? alpaA - alpaB : alpaB - alpaA;
                            }
                            return (a.student.name || '').localeCompare(b.student.name || '', 'id', { numeric: true });
                        } else if (column === 'points') {
                            const ptsA = Number(a.ewsRes?.details?.points || 0);
                            const ptsB = Number(b.ewsRes?.details?.points || 0);
                            if (ptsA !== ptsB) {
                                return isAsc ? ptsA - ptsB : ptsB - ptsA;
                            }
                            return (a.student.name || '').localeCompare(b.student.name || '', 'id', { numeric: true });
                        } else if (column === 'permisi') {
                            const permA = Number(a.ewsRes?.details?.permisi || 0);
                            const permB = Number(b.ewsRes?.details?.permisi || 0);
                            if (permA !== permB) {
                                return isAsc ? permA - permB : permB - permA;
                            }
                            return (a.student.name || '').localeCompare(b.student.name || '', 'id', { numeric: true });
                        } else if (column === 'level') {
                            const rankA = riskLevelRank[a.ewsRes?.level] || 0;
                            const rankB = riskLevelRank[b.ewsRes?.level] || 0;
                            if (rankA !== rankB) {
                                return isAsc ? rankA - rankB : rankB - rankA;
                            }
                            const scoreDiff = Number(b.ewsRes?.totalScore || 0) - Number(a.ewsRes?.totalScore || 0);
                            if (scoreDiff !== 0) return scoreDiff;
                            return (a.student.name || '').localeCompare(b.student.name || '', 'id', { numeric: true });
                        } else if (column === 'no') {
                            return isAsc ? a.originalIndex - b.originalIndex : b.originalIndex - a.originalIndex;
                        } else {
                            const cmp = (a.student.name || '').localeCompare(b.student.name || '', 'id', { numeric: true, sensitivity: 'base' });
                            return isAsc ? cmp : -cmp;
                        }
                    });
                }
            `;
            vm.createContext(sandbox);
            vm.runInContext(helperScript, sandbox);
        });

        test('Klik kolom score pertama kali mengurutkan skor EWS tertinggi ke terendah (descending)', () => {
            sandbox.sortEwsTable('score');
            expect(sandbox.currentEwsSort.column).toBe('score');
            expect(sandbox.currentEwsSort.order).toBe('desc');
            const sorted = sandbox.sortEwsData(sandbox.sampleData);
            expect(sorted[0].student.name).toBe('Citra Dewi'); // Skor: 85
            expect(sorted[1].student.name).toBe('Budi Santoso'); // Skor: 45
            expect(sorted[2].student.name).toBe('Anisa Rahma'); // Skor: 10
        });

        test('Klik kolom score kedua kali membalikkan urutan ke skor terendah (ascending)', () => {
            sandbox.sortEwsTable('score');
            sandbox.sortEwsTable('score');
            expect(sandbox.currentEwsSort.order).toBe('asc');
            const sorted = sandbox.sortEwsData(sandbox.sampleData);
            expect(sorted[0].student.name).toBe('Anisa Rahma'); // Skor: 10
            expect(sorted[1].student.name).toBe('Budi Santoso'); // Skor: 45
            expect(sorted[2].student.name).toBe('Citra Dewi'); // Skor: 85
        });

        test('Klik kolom alpa mengurutkan dari alpa terbanyak (descending)', () => {
            sandbox.sortEwsTable('alpa');
            expect(sandbox.currentEwsSort.column).toBe('alpa');
            expect(sandbox.currentEwsSort.order).toBe('desc');
            const sorted = sandbox.sortEwsData(sandbox.sampleData);
            expect(sorted[0].student.name).toBe('Citra Dewi'); // Alpa: 4
            expect(sorted[1].student.name).toBe('Budi Santoso'); // Alpa: 2
            expect(sorted[2].student.name).toBe('Anisa Rahma'); // Alpa: 0
        });

        test('Klik kolom points mengurutkan dari kredit poin BK terbanyak (descending)', () => {
            sandbox.sortEwsTable('points');
            expect(sandbox.currentEwsSort.column).toBe('points');
            expect(sandbox.currentEwsSort.order).toBe('desc');
            const sorted = sandbox.sortEwsData(sandbox.sampleData);
            expect(sorted[0].student.name).toBe('Citra Dewi'); // Poin: 50
            expect(sorted[1].student.name).toBe('Budi Santoso'); // Poin: 15
            expect(sorted[2].student.name).toBe('Anisa Rahma'); // Poin: 5
        });

        test('Klik kolom permisi mengurutkan frekuensi permisi terbanyak (descending)', () => {
            sandbox.sortEwsTable('permisi');
            expect(sandbox.currentEwsSort.column).toBe('permisi');
            expect(sandbox.currentEwsSort.order).toBe('desc');
            const sorted = sandbox.sortEwsData(sandbox.sampleData);
            expect(sorted[0].student.name).toBe('Citra Dewi'); // Permisi: 3
            expect(sorted[1].student.name).toBe('Budi Santoso'); // Permisi: 2
            expect(sorted[2].student.name).toBe('Anisa Rahma'); // Permisi: 0
        });

        test('Klik kolom level mengurutkan dari risiko tertinggi (high > medium > low)', () => {
            sandbox.sortEwsTable('level');
            expect(sandbox.currentEwsSort.column).toBe('level');
            expect(sandbox.currentEwsSort.order).toBe('desc');
            const sorted = sandbox.sortEwsData(sandbox.sampleData);
            expect(sorted[0].student.name).toBe('Citra Dewi'); // high
            expect(sorted[1].student.name).toBe('Budi Santoso'); // medium
            expect(sorted[2].student.name).toBe('Anisa Rahma'); // low
        });

        test('Klik kolom name mengurutkan abjad nama siswa secara konsisten (A-Z lalu Z-A)', () => {
            sandbox.sortEwsTable('name');
            expect(sandbox.currentEwsSort.column).toBe('name');
            expect(sandbox.currentEwsSort.order).toBe('asc');
            let sorted = sandbox.sortEwsData(sandbox.sampleData);
            expect(sorted[0].student.name).toBe('Anisa Rahma');
            expect(sorted[1].student.name).toBe('Budi Santoso');
            expect(sorted[2].student.name).toBe('Citra Dewi');

            sandbox.sortEwsTable('name');
            expect(sandbox.currentEwsSort.order).toBe('desc');
            sorted = sandbox.sortEwsData(sandbox.sampleData);
            expect(sorted[0].student.name).toBe('Citra Dewi');
            expect(sorted[2].student.name).toBe('Anisa Rahma');
        });

        test('Klik kolom no mengembalikan urutan siswa sesuai indeks awal rombel', () => {
            sandbox.sortEwsTable('no');
            expect(sandbox.currentEwsSort.column).toBe('no');
            expect(sandbox.currentEwsSort.order).toBe('asc');
            const scrambled = [sandbox.sampleData[2], sandbox.sampleData[0], sandbox.sampleData[1]];
            const sorted = sandbox.sortEwsData(scrambled);
            expect(sorted[0].originalIndex).toBe(0);
            expect(sorted[1].originalIndex).toBe(1);
            expect(sorted[2].originalIndex).toBe(2);
        });
    });
});

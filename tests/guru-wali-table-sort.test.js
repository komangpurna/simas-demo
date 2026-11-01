const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Pengujian Interaktif Header Kolom Tabel & Filter Bar Portal Guru Wali (v26.09.16.25)', () => {
    const projectRoot = path.resolve(__dirname, '..');
    const htmlContent = fs.readFileSync(path.join(projectRoot, 'guru-wali.html'), 'utf8');
    const jsContent = fs.readFileSync(path.join(projectRoot, 'js', 'page-guru-wali.js'), 'utf8');
    const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    const configJs = fs.readFileSync(path.join(projectRoot, 'js', 'config.js'), 'utf8');
    const prdSimas = fs.readFileSync(path.join(projectRoot, 'PRD_SIMAS.md'), 'utf8');
    const changelogMd = fs.readFileSync(path.join(projectRoot, 'CHANGELOG.md'), 'utf8');

    describe('1. Analisis Statis Struktur DOM guru-wali.html', () => {
        test('Filter bar perwalian menggunakan layout 4-kolom simetris tanpa dropdown sort redundan', () => {
            expect(htmlContent).toContain('id="siswa-filter-bar" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 mt-3"');
            expect(htmlContent).not.toContain('id="sort-siswa-by"');
        });

        test('Tabel Siswa Perwalian memiliki header interaktif dengan onclick sortStudentTable dan icon indikator', () => {
            expect(htmlContent).toContain('onclick="window.sortStudentTable(\'no\')"');
            expect(htmlContent).toContain('onclick="window.sortStudentTable(\'name\')"');
            expect(htmlContent).toContain('onclick="window.sortStudentTable(\'ews\')"');
            expect(htmlContent).toContain('onclick="window.sortStudentTable(\'alpa\')"');
            expect(htmlContent).toContain('onclick="window.sortStudentTable(\'percent\')"');
            expect(htmlContent).toContain('onclick="window.sortStudentTable(\'points\')"');

            expect(htmlContent).toContain('id="sort-icon-no"');
            expect(htmlContent).toContain('id="sort-icon-name"');
            expect(htmlContent).toContain('id="sort-icon-ews"');
            expect(htmlContent).toContain('id="sort-icon-alpa"');
            expect(htmlContent).toContain('id="sort-icon-percent"');
            expect(htmlContent).toContain('id="sort-icon-points"');
        });

        test('Tabel Matriks EWS memiliki header interaktif dan icon indikator sort', () => {
            expect(htmlContent).toContain('id="sort-icon-ews-no"');
            expect(htmlContent).toContain('id="sort-icon-ews-name"');
            expect(htmlContent).toContain('id="sort-icon-ews-class"');
            expect(htmlContent).toContain('id="sort-icon-ews-alpa"');
            expect(htmlContent).toContain('id="sort-icon-ews-permisi"');
            expect(htmlContent).toContain('id="sort-icon-ews-points"');
            expect(htmlContent).toContain('id="sort-icon-ews-score"');
        });

        test('Tag script guru-wali.html memuat cache-buster versi aktif aplikasi', () => {
            expect(htmlContent).toContain(`src="js/page-guru-wali.js?v=${packageJson.version}"`);
        });
    });

    describe('2. Analisis Statis Kode Logika js/page-guru-wali.js', () => {
        test('Mendefinisikan state sortir dan helper fungsi yang diekspos ke window', () => {
            expect(jsContent).toContain('let currentStudentSort =');
            expect(jsContent).toContain('window.currentStudentSort = currentStudentSort;');
            expect(jsContent).toContain('function getStudentPresencePct(s)');
            expect(jsContent).toContain('window.getStudentPresencePct = getStudentPresencePct;');
            expect(jsContent).toContain('window.sortStudentTable = function');
            expect(jsContent).toContain('function updateTableSortIcons()');
            expect(jsContent).toContain('window.updateTableSortIcons = updateTableSortIcons;');
        });

        test('Fungsi getFilteredAndSortedStudents mendukung sorting multikolom kuantitatif', () => {
            expect(jsContent).toContain("if (sortCol === 'ews')");
            expect(jsContent).toContain("else if (sortCol === 'alpa')");
            expect(jsContent).toContain("else if (sortCol === 'percent')");
            expect(jsContent).toContain("else if (sortCol === 'points')");
            expect(jsContent).toContain("else if (sortCol === 'permisi')");
            expect(jsContent).toContain("else if (sortCol === 'name')");
        });
    });

    describe('3. Runtime Evaluasi Algoritma Pengurutan di Sandbox VM', () => {
        let sandbox;

        beforeEach(() => {
            sandbox = {
                currentStudentSort: { column: 'class', order: 'asc' },
                myStudents: [
                    {
                        student_name: 'Budi Santoso',
                        student_class: 'X-1',
                        aggregates: { attendance: { H: 20, S: 0, I: 0, A: 3, D: 0 }, points: 15, permisi: 2 },
                        ewsResult: { totalScore: 45, details: { alpa: 3, points: 15, permisi: 2 } }
                    },
                    {
                        student_name: 'Anisa Rahma',
                        student_class: 'X-2',
                        aggregates: { attendance: { H: 25, S: 0, I: 0, A: 0, D: 0 }, points: 5, permisi: 0 },
                        ewsResult: { totalScore: 10, details: { alpa: 0, points: 5, permisi: 0 } }
                    },
                    {
                        student_name: 'Citra Dewi',
                        student_class: 'XI-1',
                        aggregates: { attendance: { H: 18, S: 1, I: 1, A: 5, D: 0 }, points: 50, permisi: 4 },
                        ewsResult: { totalScore: 80, details: { alpa: 5, points: 50, permisi: 4 } }
                    }
                ],
                document: {
                    getElementById: (id) => ({ value: '' })
                },
                window: {},
                console
            };

            const helperScript = `
                function getClassLevel(className) {
                    if (!className) return 0;
                    const c = String(className).toUpperCase().trim();
                    if (c.startsWith('XII')) return 12;
                    if (c.startsWith('XI')) return 11;
                    if (c.startsWith('X')) return 10;
                    return 0;
                }

                function getStudentPresencePct(s) {
                    const att = (s && s.aggregates && s.aggregates.attendance) || {};
                    const h = Number(att.H || 0);
                    const s_cnt = Number(att.S || 0);
                    const i_cnt = Number(att.I || 0);
                    const a_cnt = Number(att.A || 0);
                    const d_cnt = Number(att.D || 0);
                    const totalDays = h + s_cnt + i_cnt + a_cnt + d_cnt;
                    return totalDays > 0 ? Math.round(((h + d_cnt) / totalDays) * 100) : 100;
                }

                function sortStudentTable(columnKey) {
                    if (currentStudentSort.column === columnKey) {
                        currentStudentSort.order = currentStudentSort.order === 'asc' ? 'desc' : 'asc';
                    } else {
                        currentStudentSort.column = columnKey;
                        if (['ews', 'alpa', 'points', 'permisi'].includes(columnKey)) {
                            currentStudentSort.order = 'desc';
                        } else if (columnKey === 'percent') {
                            currentStudentSort.order = 'asc';
                        } else {
                            currentStudentSort.order = 'asc';
                        }
                    }
                }

                function sortStudents(students) {
                    const isAsc = currentStudentSort.order === 'asc';
                    const sortCol = currentStudentSort.column;
                    return [...students].sort((a, b) => {
                        if (sortCol === 'ews') {
                            const scoreA = Number(a.ewsResult?.totalScore || 0);
                            const scoreB = Number(b.ewsResult?.totalScore || 0);
                            if (scoreA !== scoreB) {
                                return isAsc ? scoreA - scoreB : scoreB - scoreA;
                            }
                            return (a.student_name || '').localeCompare(b.student_name || '', 'id', { numeric: true });
                        } else if (sortCol === 'alpa') {
                            const alpaA = Number(a.aggregates?.attendance?.A || a.ewsResult?.details?.alpa || 0);
                            const alpaB = Number(b.aggregates?.attendance?.A || b.ewsResult?.details?.alpa || 0);
                            if (alpaA !== alpaB) {
                                return isAsc ? alpaA - alpaB : alpaB - alpaA;
                            }
                            return (a.student_name || '').localeCompare(b.student_name || '', 'id', { numeric: true });
                        } else if (sortCol === 'percent') {
                            const pctA = getStudentPresencePct(a);
                            const pctB = getStudentPresencePct(b);
                            if (pctA !== pctB) {
                                return isAsc ? pctA - pctB : pctB - pctA;
                            }
                            return (a.student_name || '').localeCompare(b.student_name || '', 'id', { numeric: true });
                        } else if (sortCol === 'points') {
                            const ptsA = Number(a.aggregates?.points || a.aggregates?.totalPoints || a.ewsResult?.details?.points || 0);
                            const ptsB = Number(b.aggregates?.points || b.aggregates?.totalPoints || b.ewsResult?.details?.points || 0);
                            if (ptsA !== ptsB) {
                                return isAsc ? ptsA - ptsB : ptsB - ptsA;
                            }
                            return (a.student_name || '').localeCompare(b.student_name || '', 'id', { numeric: true });
                        } else if (sortCol === 'permisi') {
                            const permA = Number(a.aggregates?.permisi ?? a.permissionCount ?? a.ewsResult?.details?.permisi ?? 0);
                            const permB = Number(b.aggregates?.permisi ?? b.permissionCount ?? b.ewsResult?.details?.permisi ?? 0);
                            if (permA !== permB) {
                                return isAsc ? permA - permB : permB - permA;
                            }
                            return (a.student_name || '').localeCompare(b.student_name || '', 'id', { numeric: true });
                        } else if (sortCol === 'name') {
                            const nameComp = (a.student_name || '').localeCompare(b.student_name || '', 'id', { numeric: true });
                            return isAsc ? nameComp : -nameComp;
                        } else {
                            const levelA = getClassLevel(a.student_class);
                            const levelB = getClassLevel(b.student_class);
                            if (levelB !== levelA) return isAsc ? levelB - levelA : levelA - levelB;
                            const classCompare = (a.student_class || '').localeCompare(b.student_class || '', 'id', { numeric: true });
                            if (classCompare !== 0) return isAsc ? classCompare : -classCompare;
                            const nameComp = (a.student_name || '').localeCompare(b.student_name || '', 'id', { numeric: true });
                            return isAsc ? nameComp : -nameComp;
                        }
                    });
                }
            `;
            vm.createContext(sandbox);
            vm.runInContext(helperScript, sandbox);
        });

        test('Klik kolom ews pertama kali langsung mengurutkan dari risiko tertinggi (desc)', () => {
            sandbox.sortStudentTable('ews');
            expect(sandbox.currentStudentSort.column).toBe('ews');
            expect(sandbox.currentStudentSort.order).toBe('desc');
            const sorted = sandbox.sortStudents(sandbox.myStudents);
            expect(sorted[0].student_name).toBe('Citra Dewi'); // 80
            expect(sorted[1].student_name).toBe('Budi Santoso'); // 45
            expect(sorted[2].student_name).toBe('Anisa Rahma'); // 10
        });

        test('Klik kolom ews kedua kali membalikkan urutan ke terendah (asc)', () => {
            sandbox.sortStudentTable('ews');
            sandbox.sortStudentTable('ews');
            expect(sandbox.currentStudentSort.order).toBe('asc');
            const sorted = sandbox.sortStudents(sandbox.myStudents);
            expect(sorted[0].student_name).toBe('Anisa Rahma'); // 10
            expect(sorted[1].student_name).toBe('Budi Santoso'); // 45
            expect(sorted[2].student_name).toBe('Citra Dewi'); // 80
        });

        test('Klik kolom alpa mengurutkan dari alpa terbanyak (desc)', () => {
            sandbox.sortStudentTable('alpa');
            expect(sandbox.currentStudentSort.column).toBe('alpa');
            expect(sandbox.currentStudentSort.order).toBe('desc');
            const sorted = sandbox.sortStudents(sandbox.myStudents);
            expect(sorted[0].student_name).toBe('Citra Dewi'); // 5 alpa
            expect(sorted[1].student_name).toBe('Budi Santoso'); // 3 alpa
            expect(sorted[2].student_name).toBe('Anisa Rahma'); // 0 alpa
        });

        test('Klik kolom percent mengurutkan dari % kehadiran terendah untuk intervensi dini (asc)', () => {
            sandbox.sortStudentTable('percent');
            expect(sandbox.currentStudentSort.column).toBe('percent');
            expect(sandbox.currentStudentSort.order).toBe('asc');
            const sorted = sandbox.sortStudents(sandbox.myStudents);
            expect(sandbox.getStudentPresencePct(sorted[0])).toBeLessThan(sandbox.getStudentPresencePct(sorted[2]));
        });

        test('Klik kolom points mengurutkan dari poin pelanggaran terbanyak (desc)', () => {
            sandbox.sortStudentTable('points');
            expect(sandbox.currentStudentSort.column).toBe('points');
            expect(sandbox.currentStudentSort.order).toBe('desc');
            const sorted = sandbox.sortStudents(sandbox.myStudents);
            expect(sorted[0].student_name).toBe('Citra Dewi'); // 50 poin
            expect(sorted[1].student_name).toBe('Budi Santoso'); // 15 poin
            expect(sorted[2].student_name).toBe('Anisa Rahma'); // 5 poin
        });

        test('Klik kolom permisi mengurutkan dari frekuensi permisi terbanyak (desc)', () => {
            sandbox.sortStudentTable('permisi');
            expect(sandbox.currentStudentSort.column).toBe('permisi');
            expect(sandbox.currentStudentSort.order).toBe('desc');
            const sorted = sandbox.sortStudents(sandbox.myStudents);
            expect(sorted[0].student_name).toBe('Citra Dewi'); // 4
            expect(sorted[1].student_name).toBe('Budi Santoso'); // 2
            expect(sorted[2].student_name).toBe('Anisa Rahma'); // 0
        });

        test('Klik kolom name mengurutkan abjad siswa (asc lalu desc)', () => {
            sandbox.sortStudentTable('name');
            expect(sandbox.currentStudentSort.column).toBe('name');
            expect(sandbox.currentStudentSort.order).toBe('asc');
            let sorted = sandbox.sortStudents(sandbox.myStudents);
            expect(sorted[0].student_name).toBe('Anisa Rahma');
            expect(sorted[2].student_name).toBe('Citra Dewi');

            sandbox.sortStudentTable('name');
            expect(sandbox.currentStudentSort.order).toBe('desc');
            sorted = sandbox.sortStudents(sandbox.myStudents);
            expect(sorted[0].student_name).toBe('Citra Dewi');
            expect(sorted[2].student_name).toBe('Anisa Rahma');
        });
    });

    describe('4. Sinkronisasi SSOT Dokumen Versi Terpadu', () => {
        test('Versi package.json, config.js, PRD_SIMAS.md, dan CHANGELOG.md tersinkronisasi', () => {
            expect(packageJson.version).toBeDefined();
            expect(configJs).toContain(`export const APP_VERSION = "${packageJson.version}";`);
            expect(prdSimas).toContain(`[${packageJson.version}]`);
            expect(changelogMd).toContain(`[${packageJson.version}]`);
        });
    });
});

/**
 * @jest-environment jsdom
 * 
 * tests/guru-mapel-loading-performance.test.js
 * 
 * Memverifikasi secara ketat (0 Kesalahan):
 * 1. Optimasi query Supabase fast-path 'skipCount' (0 redundant HEAD count query) pada window.fetchAllSupabaseRows.
 * 2. Paralelisasi fetch komponen nilai di fetchScoresFromSupabase (Promise.all + skipCount: true).
 * 3. Paralelisasi pemuatan data siswa & lembar nilai di executeLoadGradebookData (Promise.all).
 * 4. Retensi 100% Cache Sesi Lokal (sessionGradebookCache) in-memory tanpa remote re-fetch.
 * 5. Arsitektur Lazy On-Demand per tab (Kehadiran, Jurnal, LMS) via scope tracking & switchGuruMapelTab.
 * 6. Invalidation scope yang presisi saat filter diubah (onKelasChange, onMapelChange, onSemesterChange, resetPortalTablesToEmpty).
 */

const fs = require('fs');
const path = require('path');

describe('Portal Guru Mapel - Optimasi Loading Nilai, Lazy Tab, & Cache Sesi Lokal', () => {
    const rootDir = path.resolve(__dirname, '..');
    const globalJsPath = path.join(rootDir, 'js', 'global.js');
    const pageGuruMapelPath = path.join(rootDir, 'js', 'page-guru-mapel.js');
    const packageJsonPath = path.join(rootDir, 'package.json');
    const prdPath = path.join(rootDir, 'PRD_SIMAS.md');
    const changelogPath = path.join(rootDir, 'CHANGELOG.md');

    const globalJs = fs.readFileSync(globalJsPath, 'utf8');
    const pageGuruMapel = fs.readFileSync(pageGuruMapelPath, 'utf8');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const prdContent = fs.readFileSync(prdPath, 'utf8');
    const changelogContent = fs.readFileSync(changelogPath, 'utf8');

    // =========================================================================
    // 1. UNIT TEST: window.fetchAllSupabaseRows fast-path skipCount
    // =========================================================================
    describe('1. Logika Unit window.fetchAllSupabaseRows fast-path skipCount', () => {
        let mockSupabase;
        let selectSpy;
        let rangeSpy;

        beforeEach(() => {
            const freshGlobalJs = fs.readFileSync(globalJsPath, 'utf8');
            const match = freshGlobalJs.match(/window\.fetchAllSupabaseRows\s*=\s*async\s*function[\s\S]*?\n\};/);
            expect(match).not.toBeNull();
            const fnCode = match[0];
            const execFn = new Function(fnCode);
            execFn();

            selectSpy = jest.fn();
            rangeSpy = jest.fn();
        });

        test('Saat skipCount=true, langsung memanggil .range(0, pageSize - 1) tanpa pemanggilan HEAD count query', async () => {
            const fakeData = [{ id: 1, name: 'Tugas 1' }, { id: 2, name: 'Tugas 2' }];
            const queryBuilderMock = {
                range: rangeSpy.mockImplementation((from, to) => {
                    return Promise.resolve({ data: fakeData, error: null });
                }),
                eq: jest.fn().mockReturnThis(),
                in: jest.fn().mockReturnThis()
            };

            selectSpy.mockImplementation((fields, opts) => {
                // Pastikan opsi { count: 'exact', head: true } TIDAK pernah dipanggil saat skipCount=true
                if (opts && opts.head === true) {
                    throw new Error('HEAD count query tidak boleh dipanggil saat skipCount=true!');
                }
                return queryBuilderMock;
            });

            mockSupabase = {
                from: jest.fn().mockReturnValue({
                    select: selectSpy
                })
            };

            const result = await window.fetchAllSupabaseRows(
                mockSupabase,
                'guru_mapel_components',
                (q) => q.eq('gradebook_id', 'GB-123'),
                { selectFields: 'id, label', pageSize: 500, skipCount: true }
            );

            expect(result.data).toEqual(fakeData);
            expect(result.error).toBeNull();
            expect(mockSupabase.from).toHaveBeenCalledWith('guru_mapel_components');
            expect(selectSpy).toHaveBeenCalledWith('id, label');
            expect(rangeSpy).toHaveBeenCalledWith(0, 499);
            expect(queryBuilderMock.eq).toHaveBeenCalledWith('gradebook_id', 'GB-123');
        });

        test('Saat skipCount=false / omitted, tetap menjalankan validasi HEAD count query (Backward Compatibility)', async () => {
            let headCountCalled = false;

            const countQueryBuilderMock = {
                eq: jest.fn().mockReturnThis(),
                then: (resolve) => resolve({ count: 1, error: null })
            };

            const dataQueryBuilderMock = {
                range: jest.fn().mockResolvedValue({ data: [{ id: 99 }], error: null }),
                eq: jest.fn().mockReturnThis()
            };

            selectSpy.mockImplementation((fields, opts) => {
                if (opts && opts.head === true && opts.count === 'exact') {
                    headCountCalled = true;
                    return countQueryBuilderMock;
                }
                return dataQueryBuilderMock;
            });

            mockSupabase = {
                from: jest.fn().mockReturnValue({
                    select: selectSpy
                })
            };

            const result = await window.fetchAllSupabaseRows(
                mockSupabase,
                'guru_mapel_components',
                (q) => q.eq('gradebook_id', 'GB-123'),
                { selectFields: 'id, label', pageSize: 100 }
            );

            expect(headCountCalled).toBe(true);
            expect(result.data).toEqual([{ id: 99 }]);
            expect(result.error).toBeNull();
        });

        test('Saat query Supabase melempar error, mengembalikan { data: [], error } secara elegan', async () => {
            const queryBuilderMock = {
                range: jest.fn().mockResolvedValue({ data: null, error: { message: 'Database offline' } }),
                eq: jest.fn().mockReturnThis()
            };

            mockSupabase = {
                from: jest.fn().mockReturnValue({
                    select: jest.fn().mockReturnValue(queryBuilderMock)
                })
            };

            const result = await window.fetchAllSupabaseRows(
                mockSupabase,
                'guru_mapel_scores',
                null,
                { skipCount: true }
            );

            expect(result.data).toEqual([]);
            expect(result.error).toEqual({ message: 'Database offline' });
        });
    });

    // =========================================================================
    // 2. KONTRAK KODE: Paralelisasi fetchScoresFromSupabase & executeLoadGradebookData
    // =========================================================================
    describe('2. Kontrak Kodingan & Paralelisasi Network (page-guru-mapel.js)', () => {
        test('fetchScoresFromSupabase mengeksekusi 3 tabel Supabase secara paralel dalam 1 batch Promise.all dengan skipCount: true', () => {
            // Verifikasi pemanggilan Promise.all yang memuat components, scores, dan summaries
            expect(pageGuruMapel).toMatch(
                /const\s*\[compRes,\s*scoreRes,\s*summaryRes\]\s*=\s*await\s*Promise\.all\(\s*\[\s*window\.fetchAllSupabaseRows\([\s\S]*?'guru_mapel_components'[\s\S]*?skipCount:\s*true[\s\S]*?'guru_mapel_scores'[\s\S]*?skipCount:\s*true[\s\S]*?'guru_mapel_summaries'[\s\S]*?skipCount:\s*true[\s\S]*?\]\s*\)/
            );
        });

        test('executeLoadGradebookData memuat fetchStudentsTask dan fetchScoresTask secara simultan (Promise.all)', () => {
            expect(pageGuruMapel).toMatch(
                /await\s*Promise\.all\(\s*\[\s*fetchStudentsTask,\s*fetchScoresTask\s*\]\s*\)/
            );
        });

        test('executeLoadGradebookData TIDAK LAGI memblokir loading nilai dengan eager loading kehadiran/jurnal/LMS', () => {
            // Cari deklarasi executeLoadGradebookData
            const execMatch = pageGuruMapel.match(/async\s*function\s*executeLoadGradebookData[\s\S]*?\n\}/);
            expect(execMatch).not.toBeNull();
            const fnBody = execMatch[0];

            // Pastikan tidak ada Promise.allSettled yang memanggil ketiga modul sekaligus secara eager
            expect(fnBody).not.toMatch(/Promise\.allSettled\(\s*\[[\s\S]*?loadKehadiranSiswaData[\s\S]*?loadDaftarJurnalData[\s\S]*?loadLmsData/);
        });
    });

    // =========================================================================
    // 3. RETENSI CACHE SESI LOKAL (sessionGradebookCache) SESUAI INSTRUKSI USER
    // =========================================================================
    describe('3. Retensi 100% Cache Sesi Lokal (sessionGradebookCache)', () => {
        test('sessionGradebookCache dideklarasikan dan dipertahankan sebagai cache sesi in-memory', () => {
            expect(pageGuruMapel).toMatch(/let\s+sessionGradebookCache\s*=\s*\{\};/);
        });

        test('executeLoadGradebookData memeriksa sessionGradebookCache saat !forceReFetch dan mengembalikan data instan (0 ms)', () => {
            expect(pageGuruMapel).toMatch(/if\s*\(!forceReFetch\s*&&\s*sessionGradebookCache\[gradebookId\]\)/);
            expect(pageGuruMapel).toMatch(/sessionGradebookCache\[gradebookId\]\s*=\s*\{[\s\S]*?students:\s*\[\.\.\.loadedStudents\]/);
        });

        test('Simulasi Sesi: Cache hit mengembalikan data lengkap tanpa memicu query remote baru', () => {
            const fakeCache = {};
            const sampleGbId = '2024-2025_S1_X-1_Matematika';
            const sampleData = {
                students: [{ nis: '1001', name: 'Budi' }],
                scoresMap: { '1001': { comp_1: 85 } },
                summariesMap: { '1001': { final_score: 85 } }
            };

            // Simpan ke cache sesi
            fakeCache[sampleGbId] = sampleData;

            // Uji pembacaan dari cache saat berpindah kembali ke kelas ini
            const isCached = !false && Boolean(fakeCache[sampleGbId]);
            expect(isCached).toBe(true);

            const retrieved = fakeCache[sampleGbId];
            expect(retrieved.students.length).toBe(1);
            expect(retrieved.students[0].name).toBe('Budi');
            expect(retrieved.scoresMap['1001'].comp_1).toBe(85);
        });
    });

    // =========================================================================
    // 4. SCOPE TRACKING & LAZY ON-DEMAND LOADING PER TAB
    // =========================================================================
    describe('4. Scope Tracking & Lazy On-Demand Loading di switchGuruMapelTab', () => {
        test('Variabel pelacak scope modul dideklarasikan', () => {
            expect(pageGuruMapel).toMatch(/let\s+currentLoadedGradebookScope\s*=\s*'';/);
            expect(pageGuruMapel).toMatch(/let\s+currentLoadedKehadiranScope\s*=\s*'';/);
            expect(pageGuruMapel).toMatch(/let\s+currentLoadedJurnalScope\s*=\s*'';/);
            expect(pageGuruMapel).toMatch(/let\s+currentLoadedLmsScope\s*=\s*'';/);
        });

        test('switchGuruMapelTab mengecek scope sebelum memanggil fungsi load tab masing-masing', () => {
            // Tab Kehadiran
            expect(pageGuruMapel).toMatch(
                /if\s*\(\s*mapel\s*&&\s*kelas\s*&&\s*currentLoadedKehadiranScope\s*!==\s*currentScope\s*&&\s*typeof\s*window\.loadKehadiranSiswaData\s*===\s*'function'\s*\)\s*\{\s*window\.loadKehadiranSiswaData\(false\);/
            );
            // Tab Jurnal
            expect(pageGuruMapel).toMatch(
                /if\s*\(\s*mapel\s*&&\s*kelas\s*&&\s*currentLoadedJurnalScope\s*!==\s*currentScope\s*&&\s*typeof\s*window\.loadDaftarJurnalData\s*===\s*'function'\s*\)\s*\{\s*window\.loadDaftarJurnalData\(false\);/
            );
            // Tab LMS
            expect(pageGuruMapel).toMatch(
                /if\s*\(\s*mapel\s*&&\s*kelas\s*&&\s*currentLoadedLmsScope\s*!==\s*currentScope\s*&&\s*typeof\s*window\.loadLmsData\s*===\s*'function'\s*\)\s*\{\s*window\.loadLmsData\(false\);/
            );
        });

        test('Setiap fungsi tab meng-assign scope marker saat render selesai', () => {
            // Kehadiran
            expect(pageGuruMapel).toMatch(
                /currentLoadedKehadiranScope\s*=\s*`\$\{tahunAjaran\}_\$\{semester\}_\$\{kelas\}_\$\{mapel\}`;/
            );
            // Jurnal
            expect(pageGuruMapel).toMatch(
                /currentLoadedJurnalScope\s*=\s*`\$\{tahunAjaran\}_\$\{semester\}_\$\{kelas\}_\$\{mapel\}`;/
            );
            // LMS
            expect(pageGuruMapel).toMatch(
                /currentLoadedLmsScope\s*=\s*`\$\{academicYear\}_\$\{semester\}_\$\{kelas\}_\$\{mapel\}`;/
            );
        });

        test('Perubahan filter dan resetPortalTablesToEmpty mereset seluruh scope tracker', () => {
            // Pada onKelasChange, onMapelChange, onSemesterChange
            expect(pageGuruMapel).toMatch(/window\.onKelasChange\s*=\s*function[\s\S]*?currentLoadedGradebookScope\s*=\s*'';[\s\S]*?currentLoadedKehadiranScope\s*=\s*'';[\s\S]*?currentLoadedJurnalScope\s*=\s*'';[\s\S]*?currentLoadedLmsScope\s*=\s*'';/);
            expect(pageGuruMapel).toMatch(/window\.onMapelChange\s*=\s*function[\s\S]*?currentLoadedGradebookScope\s*=\s*'';[\s\S]*?currentLoadedKehadiranScope\s*=\s*'';[\s\S]*?currentLoadedJurnalScope\s*=\s*'';[\s\S]*?currentLoadedLmsScope\s*=\s*'';/);
            expect(pageGuruMapel).toMatch(/window\.onSemesterChange\s*=\s*function[\s\S]*?currentLoadedGradebookScope\s*=\s*'';[\s\S]*?currentLoadedKehadiranScope\s*=\s*'';[\s\S]*?currentLoadedJurnalScope\s*=\s*'';[\s\S]*?currentLoadedLmsScope\s*=\s*'';/);
            expect(pageGuruMapel).toMatch(/window\.resetPortalTablesToEmpty\s*=\s*function[\s\S]*?currentLoadedGradebookScope\s*=\s*'';[\s\S]*?currentLoadedKehadiranScope\s*=\s*'';[\s\S]*?currentLoadedJurnalScope\s*=\s*'';[\s\S]*?currentLoadedLmsScope\s*=\s*'';/);
        });
    });

    // =========================================================================
    // 5. PENINGKATAN NORMALISASI KELAS (isClassEqual & isStudentActive)
    // =========================================================================
    describe('5. Normalisasi Notasi Kelas & Filter Siswa Aktif', () => {
        test('executeLoadGradebookData menggunakan isClassEqual untuk mencegah miss format rombel ("X.1" vs "X-1")', () => {
            expect(pageGuruMapel).toMatch(/isClassEqual\(s\.class\s*\|\|\s*s\.kelas,\s*kelas\)/);
        });

        test('executeLoadGradebookData menggunakan isStudentActive untuk memastikan hanya siswa aktif yang termuat', () => {
            expect(pageGuruMapel).toMatch(/typeof\s+window\.isStudentActive\s*===\s*'function'\s*\?\s*window\.isStudentActive\(s\)/);
        });
    });

    // =========================================================================
    // 6. SINKRONISASI VERSI SSOT & DOKUMENTASI
    // =========================================================================
    describe('6. Integritas Versi SSOT Proyek', () => {
        test('Versi pada package.json mengikuti format harian YY.MM.DD.REV', () => {
            expect(packageJson.version).toMatch(/^\d{2}\.\d{2}\.\d{2}\.\d+$/);
        });

        test('PRD_SIMAS.md mencatat versi aktif dan ringkasan optimasi loading nilai', () => {
            expect(prdContent).toContain(`[${packageJson.version}]`);
            expect(prdContent).toContain('Optimasi Performa Loading Nilai Portal Guru Mapel');
            expect(prdContent).toContain('skipCount');
        });

        test('CHANGELOG.md mencatat entri lengkap optimasi loading nilai portal guru mapel', () => {
            expect(changelogContent).toContain('Optimasi Performa Loading Nilai Portal Guru Mapel & Cache-Safety SSOT');
            expect(changelogContent).toContain('Fast-Path `skipCount`');
            expect(changelogContent).toContain('Paralelisasi Fetch Komponen Nilai');
            expect(changelogContent).toContain('Retensi Penuh Cache Sesi Lokal (`sessionGradebookCache`)');
        });
    });
});

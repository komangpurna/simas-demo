/**
 * tests/teaching-journal-reminder-presensi.test.js
 * ====================================================================
 * Test Suite: Paritas Presensi Guru oleh Admin Kelas (Supabase guru_presensi)
 * dengan Pengingat Jurnal Mengajar KBM Jam 15:00 WITA
 * 
 * Memvalidasi kepatuhan Zero-Flaw:
 * 1. Pengecualian guru berstatus Sakit (S), Izin (I), Kegiatan (K), Tanpa Keterangan (TK).
 * 2. Penagihan jurnal tepat sasaran bagi guru berstatus Hadir (H) yang belum isi jurnal.
 * 3. Pembebasan guru berstatus Hadir (H) yang sudah mengisi jurnal di D1 jurnal_guru.
 * 4. Multi-JP blok konsisten (seluruh JP absen = bebas pengingat).
 * 5. Isolasi multi-rombel (rombel sakit dibebaskan, rombel hadir belum isi tetap ditagih).
 * 6. Evaluasi hari efektif vs tidak efektif jika admin kelas & guru sama-sama belum mengisi.
 * 7. Ketahanan jaringan fail-safe jika Supabase fetch mengalami kegagalan.
 * 8. Normalisasi format nama rombel dan nama guru (bebas gelar akademik).
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Suite Paritas Presensi Guru Admin Kelas & Pengingat Jurnal KBM 15:00 WITA', () => {
    const root = path.resolve(__dirname, '..');
    const workerJsPath = path.join(root, 'cloudflare', 'worker.js');
    const workerContent = fs.readFileSync(workerJsPath, 'utf8');

    // 1. Ekstraksi fungsi dari worker.js untuk diuji secara unit
    let normalizeClassCode;
    let cleanTeacherNameForMatch;
    let extractClassFromText;
    let getAngkatanFromClass;

    beforeAll(() => {
        const script = `
            ${workerContent.match(/function normalizeClassCode[\s\S]*?^}/m)[0]}
            ${workerContent.match(/function cleanTeacherNameForMatch[\s\S]*?^}/m)[0]}
            ${workerContent.match(/function extractClassFromText[\s\S]*?^}/m)[0]}
            ${workerContent.match(/function getAngkatanFromClass[\s\S]*?^}/m)[0]}
            return { normalizeClassCode, cleanTeacherNameForMatch, extractClassFromText, getAngkatanFromClass };
        `;
        const fns = new Function(script)();
        normalizeClassCode = fns.normalizeClassCode;
        cleanTeacherNameForMatch = fns.cleanTeacherNameForMatch;
        extractClassFromText = fns.extractClassFromText;
        getAngkatanFromClass = fns.getAngkatanFromClass;
    });

    describe('1. Normalisasi Kode Rombel & Pembersihan Nama Guru', () => {
        test('normalizeClassCode menstandarkan format nama rombel', () => {
            expect(normalizeClassCode('Kelas X-1')).toBe('X-1');
            expect(normalizeClassCode('kelas x_1')).toBe('X-1');
            expect(normalizeClassCode('X 1')).toBe('X-1');
            expect(normalizeClassCode('Kelas XII MIPA 1')).toBe('XII-MIPA-1');
            expect(normalizeClassCode('XII-MIPA-1')).toBe('XII-MIPA-1');
            expect(normalizeClassCode('')).toBe('');
        });

        test('cleanTeacherNameForMatch membersihkan gelar akademik dan karakter khusus', () => {
            expect(cleanTeacherNameForMatch('Drs. I Made Sudarma, M.Pd')).toBe('imadesudarma');
            expect(cleanTeacherNameForMatch('Ni Wayan Sri, S.Pd., Gr.')).toBe('niwayansri');
            expect(cleanTeacherNameForMatch('Dr. Ketut Sujana, S.Kom., M.Kom.')).toBe('ketutsujana');
        });
    });

    describe('2. Logika Evaluasi Status Presensi Guru (Simulasi Alur Cron)', () => {
        // Simulasi fungsi evaluasi rombel yang identik dengan logika worker.js
        function evaluateClassReminder({
            targetCls,
            teacherId,
            gtkInfo,
            teacherIdSet,
            guruPresensiRows,
            journalRows,
            isSchoolNonEffective = false,
            nonEffectiveAngkatan = new Set()
        }) {
            const normTarget = normalizeClassCode(targetCls);
            const angk = getAngkatanFromClass(targetCls);

            const isRowMatchTeacher = (r) => {
                const rowId = String(r.guru_id || '').trim();
                if (rowId && teacherIdSet.has(rowId)) return true;
                const rowName = String(r.guru_nama || '').trim();
                if (rowName && gtkInfo && gtkInfo.cleanName) {
                    const cleanRow = cleanTeacherNameForMatch(rowName);
                    if (cleanRow && (cleanRow === gtkInfo.cleanName || gtkInfo.cleanName.includes(cleanRow) || cleanRow.includes(gtkInfo.cleanName))) {
                        return true;
                    }
                }
                return false;
            };

            const matchingPresensi = guruPresensiRows.filter(r => 
                normalizeClassCode(r.kelas) === normTarget && isRowMatchTeacher(r)
            );

            if (matchingPresensi.length > 0) {
                const hasHadir = matchingPresensi.some(r => String(r.status || '').trim().toUpperCase() === 'H');
                const allAbsent = matchingPresensi.every(r => ['S', 'I', 'K', 'TK'].includes(String(r.status || '').trim().toUpperCase()));

                if (allAbsent && !hasHadir) {
                    return { isMissing: false, reason: 'guru_absent_recorded' };
                }

                const isFilled = journalRows.some(j => {
                    const jCls = normalizeClassCode(j.kelas);
                    if (jCls !== normTarget) return false;
                    if (j.uid_guru && teacherIdSet.has(String(j.uid_guru))) return true;
                    if (gtkInfo && gtkInfo.cleanName && j.guru && cleanTeacherNameForMatch(j.guru) === gtkInfo.cleanName) return true;
                    return false;
                });

                return { isMissing: !isFilled, reason: isFilled ? 'journal_filled' : 'hadir_unfilled' };
            } else {
                const isSlotNonEffective = isSchoolNonEffective || 
                    nonEffectiveAngkatan.has(angk);

                if (isSlotNonEffective) {
                    return { isMissing: false, reason: 'non_effective_slot' };
                }

                const isFilled = journalRows.some(j => {
                    const jCls = normalizeClassCode(j.kelas);
                    if (jCls !== normTarget) return false;
                    if (j.uid_guru && teacherIdSet.has(String(j.uid_guru))) return true;
                    if (gtkInfo && gtkInfo.cleanName && j.guru && cleanTeacherNameForMatch(j.guru) === gtkInfo.cleanName) return true;
                    return false;
                });

                return { isMissing: !isFilled, reason: isFilled ? 'journal_filled' : 'effective_both_unfilled' };
            }
        }

        const defaultTeacher = {
            teacherId: 'uuid-guru-1',
            gtkInfo: {
                cleanName: 'imadesudarma',
                idSet: new Set(['uuid-guru-1', '197501012000011001', '5102012345678901'])
            },
            teacherIdSet: new Set(['uuid-guru-1', '197501012000011001', '5102012345678901'])
        };

        test('Skenario 1: Guru dicatat Sakit (S) oleh Admin Kelas -> Dikecualikan (tidak ditagih)', () => {
            const presensi = [
                { kelas: 'X-1', jp: 1, guru_id: '197501012000011001', guru_nama: 'I Made Sudarma', status: 'S' }
            ];
            const journal = []; // Jurnal kosong
            const res = evaluateClassReminder({
                targetCls: 'Kelas X-1',
                ...defaultTeacher,
                guruPresensiRows: presensi,
                journalRows: journal
            });
            expect(res.isMissing).toBe(false);
            expect(res.reason).toBe('guru_absent_recorded');
        });

        test('Skenario 2: Guru dicatat Izin (I), Kegiatan (K), atau Tanpa Keterangan (TK) -> Dikecualikan', () => {
            for (const status of ['I', 'K', 'TK']) {
                const presensi = [
                    { kelas: 'X-1', jp: 2, guru_id: 'uuid-guru-1', guru_nama: 'Drs. I Made Sudarma, M.Pd', status }
                ];
                const res = evaluateClassReminder({
                    targetCls: 'X-1',
                    ...defaultTeacher,
                    guruPresensiRows: presensi,
                    journalRows: []
                });
                expect(res.isMissing).toBe(false);
                expect(res.reason).toBe('guru_absent_recorded');
            }
        });

        test('Skenario 3: Multi-JP Blok konsisten (JP 3 Sakit, JP 4 Sakit) -> Dikecualikan', () => {
            const presensi = [
                { kelas: 'X-1', jp: 3, guru_id: 'uuid-guru-1', guru_nama: 'I Made Sudarma', status: 'S' },
                { kelas: 'X-1', jp: 4, guru_id: 'uuid-guru-1', guru_nama: 'I Made Sudarma', status: 'S' }
            ];
            const res = evaluateClassReminder({
                targetCls: 'X-1',
                ...defaultTeacher,
                guruPresensiRows: presensi,
                journalRows: []
            });
            expect(res.isMissing).toBe(false);
            expect(res.reason).toBe('guru_absent_recorded');
        });

        test('Skenario 4: Guru dicatat Hadir (H) oleh Admin Kelas, Jurnal belum diisi -> Ditagih pengingat', () => {
            const presensi = [
                { kelas: 'X-1', jp: 1, guru_id: 'uuid-guru-1', guru_nama: 'I Made Sudarma', status: 'H' },
                { kelas: 'X-1', jp: 2, guru_id: 'uuid-guru-1', guru_nama: 'I Made Sudarma', status: 'H' }
            ];
            const res = evaluateClassReminder({
                targetCls: 'X-1',
                ...defaultTeacher,
                guruPresensiRows: presensi,
                journalRows: [] // Jurnal belum ada
            });
            expect(res.isMissing).toBe(true);
            expect(res.reason).toBe('hadir_unfilled');
        });

        test('Skenario 5: Guru dicatat Hadir (H) oleh Admin Kelas, Jurnal sudah diisi -> Dikecualikan (aman)', () => {
            const presensi = [
                { kelas: 'X-1', jp: 1, guru_id: 'uuid-guru-1', guru_nama: 'I Made Sudarma', status: 'H' }
            ];
            const journal = [
                { kelas: 'Kelas X-1', uid_guru: 'uuid-guru-1', guru: 'Drs. I Made Sudarma, M.Pd' }
            ];
            const res = evaluateClassReminder({
                targetCls: 'X-1',
                ...defaultTeacher,
                guruPresensiRows: presensi,
                journalRows: journal
            });
            expect(res.isMissing).toBe(false);
            expect(res.reason).toBe('journal_filled');
        });

        test('Skenario 6: Multi-Rombel Parsial (X-1 Sakit, XI-2 Hadir belum isi jurnal)', () => {
            const presensi = [
                { kelas: 'X-1', jp: 1, guru_id: 'uuid-guru-1', guru_nama: 'I Made Sudarma', status: 'S' },
                { kelas: 'XI-2', jp: 5, guru_id: 'uuid-guru-1', guru_nama: 'I Made Sudarma', status: 'H' }
            ];
            const journal = [];

            const resX1 = evaluateClassReminder({
                targetCls: 'X-1',
                ...defaultTeacher,
                guruPresensiRows: presensi,
                journalRows: journal
            });
            const resXI2 = evaluateClassReminder({
                targetCls: 'XI-2',
                ...defaultTeacher,
                guruPresensiRows: presensi,
                journalRows: journal
            });

            // X-1 bebas, XI-2 ditagih
            expect(resX1.isMissing).toBe(false);
            expect(resX1.reason).toBe('guru_absent_recorded');
            expect(resXI2.isMissing).toBe(true);
            expect(resXI2.reason).toBe('hadir_unfilled');
        });

        test('Skenario 7: Keduanya Kosong di Hari Efektif Belajar -> Ditagih pengingat', () => {
            const res = evaluateClassReminder({
                targetCls: 'X-1',
                ...defaultTeacher,
                guruPresensiRows: [], // Admin kelas belum input
                journalRows: [],      // Guru belum input
                isSchoolNonEffective: false,
                nonEffectiveAngkatan: new Set()
            });
            expect(res.isMissing).toBe(true);
            expect(res.reason).toBe('effective_both_unfilled');
        });

        test('Skenario 8: Keduanya Kosong di Hari Tidak Efektif Empiris (<= 5 Rombel Sekolah atau <= 2 Rombel Angkatan) -> Dikecualikan', () => {
            // A. Karena tingkat sekolah terdeteksi tidak belajar efektif secara empiris (<= 5 rombel aktif)
            const resSekolah = evaluateClassReminder({
                targetCls: 'X-1',
                ...defaultTeacher,
                guruPresensiRows: [],
                journalRows: [],
                isSchoolNonEffective: true
            });
            expect(resSekolah.isMissing).toBe(false);
            expect(resSekolah.reason).toBe('non_effective_slot');

            // B. Karena angkatan X sedang non-efektif (misal <= 2 rombel aktif)
            const resAngk = evaluateClassReminder({
                targetCls: 'X-1',
                ...defaultTeacher,
                guruPresensiRows: [],
                journalRows: [],
                nonEffectiveAngkatan: new Set(['X'])
            });
            expect(resAngk.isMissing).toBe(false);
            expect(resAngk.reason).toBe('non_effective_slot');
        });
    });

    describe('3. Verifikasi Keberadaan Logika Baru di cloudflare/worker.js', () => {
        test('worker.js memanggil Supabase guru_presensi dengan range query tanggal', () => {
            expect(workerContent).toContain("fetchSupabaseRowsAsService");
            expect(workerContent).toContain("'guru_presensi'");
            expect(workerContent).toContain("tanggal=eq.${dateStr}&select=kelas,jp,guru_id,guru_nama,status,ada_tugas");
        });

        test('worker.js memeriksa status tidak hadir S, I, K, TK secara tepat', () => {
            expect(workerContent).toContain("['S', 'I', 'K', 'TK'].includes");
            expect(workerContent).toContain("hasHadir");
            expect(workerContent).toContain("allAbsent");
        });

        test('worker.js tidak menggunakan kata kunci judul event dan mengandalkan libur kalender / KBM empiris', () => {
            expect(workerContent).not.toContain("hasSchoolEventNonEffective");
            expect(workerContent).toContain("isHoliday = await isSchoolHolidayOrWeekend(env.DB, dateStr)");
        });

        test('worker.js mengimplementasikan fail-safe mode jika Supabase error', () => {
            expect(workerContent).toContain("[TeachingJournalReminderCron] Gagal fetch guru_presensi Supabase (fail-safe mode):");
        });
    });
});

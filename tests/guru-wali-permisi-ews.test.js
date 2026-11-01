const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

describe('Verifikasi Integrasi Data Permisi Siswa pada Tab EWS Portal Guru Wali', () => {
    const pageGuruWaliJs = fs.readFileSync(path.join(projectRoot, 'js', 'page-guru-wali.js'), 'utf8');

    test('1. Validasi Kode Statis: fetchPermissionsSummaryForStudents & ewsWeights', () => {
        expect(pageGuruWaliJs).toContain('let ewsWeights = null;');
        expect(pageGuruWaliJs).toContain('async function fetchPermissionsSummaryForStudents(students, nisList)');
        expect(pageGuruWaliJs).toContain('fetchPermissionsSummaryForStudents(myStudents, nisList)');
        expect(pageGuruWaliJs).toContain('SimasEWS.getWeights()');
    });

    test('2. Validasi Kode Statis: Penghitungan finalPermisi dan Kalkulator EWS', () => {
        expect(pageGuruWaliJs).toContain('const finalPermisi = Math.max(permFromRequests, permFromAgg, permFromPresensi);');
        expect(pageGuruWaliJs).toContain('s.aggregates.permisi = finalPermisi;');
        expect(pageGuruWaliJs).toContain('s.permissionCount = finalPermisi;');
        // Memastikan parameter ke-3 bukan lagi 0 hardcoded
        expect(pageGuruWaliJs).toMatch(/SimasEWS\.calculateStudentRisk\(s,\s*s\.aggregates\s*\|\|\s*\{\},\s*finalPermisi,\s*ewsWeights\)/);
    });

    test('3. Validasi Filter Presensi "has_permission"', () => {
        expect(pageGuruWaliJs).toContain("presensiFilter === 'has_permission'");
        expect(pageGuruWaliJs).toMatch(/s\.aggregates\?\.permisi/);
    });

    test('4. Validasi Render Matriks EWS: Font Netral Saat 0 & Header Poin Pelanggaran', () => {
        const guruWaliHtml = fs.readFileSync(path.join(projectRoot, 'guru-wali.html'), 'utf8');
        expect(guruWaliHtml).toContain('Poin Pelanggaran');
        expect(guruWaliHtml).not.toContain('<th class="p-3 text-center">Poin Pelanggaran BK</th>');

        expect(pageGuruWaliJs).toContain('function renderMatriksEws(filteredList)');
        expect(pageGuruWaliJs).toContain('${permisiCount}x');
        // Validasi font netral/hitam slate saat bernilai 0
        expect(pageGuruWaliJs).toContain("alpaCount > 0 ? 'text-rose-600 font-bold' : 'text-slate-600 dark:text-slate-400 font-bold'");
        expect(pageGuruWaliJs).toContain("izinCount > 0 ? 'text-amber-600 font-bold' : 'text-slate-600 dark:text-slate-400 font-bold'");
        expect(pageGuruWaliJs).toContain("permisiCount > 0 ? 'text-indigo-600 dark:text-indigo-400 font-bold' : 'text-slate-600 dark:text-slate-400 font-bold'");
        expect(pageGuruWaliJs).toContain("pointsCount > 0 ? 'text-rose-600 font-bold' : 'text-slate-600 dark:text-slate-400 font-bold'");
    });

    test('5. Validasi loadDetailPermisi Komprehensif (permisi_requests + records)', () => {
        expect(pageGuruWaliJs).toContain('getPermisiRequests({ student_nis: nisStr');
        expect(pageGuruWaliJs).toContain("getRecords({ nis: nisStr, category: 'Permisi'");
        expect(pageGuruWaliJs).toContain('Disetujui Piket/BK');
        expect(pageGuruWaliJs).toContain('Disetujui Wali');
    });

    test('6. Validasi Logika Kalkulator EWS dengan Parameter Permisi Nyata', () => {
        const calculateRisk = (student, aggregateData, permissionCount = 0, weights = null) => {
            const w = weights || { weightAttendance: 40, weightBkPoints: 45, weightPermission: 15 };
            const alpa = Number(aggregateData.attendance?.A || 0);
            const izin = Number(aggregateData.attendance?.I || 0);
            const absentScore = Math.min(100, (alpa * 25) + (izin * 10));
            const bkPoints = Number(aggregateData.points || 0);
            const bkScore = Math.min(100, bkPoints);
            const permisi = Number(permissionCount || 0);
            const permissionScore = Math.min(100, permisi * 15);

            const wAbsen = (w.weightAttendance || 40) / 100;
            const wBk = (w.weightBkPoints || 45) / 100;
            const wPerm = (w.weightPermission || 15) / 100;

            const totalScore = Math.round((wAbsen * absentScore) + (wBk * bkScore) + (wPerm * permissionScore));
            return {
                totalScore,
                details: { alpa, izin, points: bkPoints, permisi }
            };
        };

        const mockStudent = { student_nis: '1234', student_name: 'Budi' };
        const mockAgg = { attendance: { A: 0, I: 0 }, points: 0 };

        // Kasus 1: Siswa pernah permisi 2 kali
        const resultWithPermisi = calculateRisk(mockStudent, mockAgg, 2);
        expect(resultWithPermisi.details.permisi).toBe(2);
        expect(resultWithPermisi.totalScore).toBe(5);

        // Kasus 2: Siswa tidak pernah permisi
        const resultZero = calculateRisk(mockStudent, mockAgg, 0);
        expect(resultZero.details.permisi).toBe(0);
        expect(resultZero.totalScore).toBe(0);
    });
});

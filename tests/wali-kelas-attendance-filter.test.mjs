/**
 * tests/wali-kelas-attendance-filter.test.mjs
 * Unit test logika perhitungan rentang tanggal filter rekapitulasi presensi siswa rombel
 */

describe('Pengujian Logika Filter Periode Rekapitulasi Presensi (loadMonthlyAttendanceRekap)', () => {
    function calculateAttendanceDateRange(periodKey, academicRange) {
        let startIso = '';
        let endIso = '';
        let labelText = '';

        if (!periodKey || periodKey === 'FULL_YEAR') {
            startIso = academicRange.minDateIso;
            endIso = academicRange.maxDateIso;
            labelText = `Rekapitulasi 1 Tahun Ajaran (${academicRange.academicYearStr})`;
        } else if (periodKey === 'SEMESTER_GANJIL') {
            startIso = `${academicRange.startYear}-07-01`;
            endIso = `${academicRange.startYear}-12-31`;
            labelText = `Rekapitulasi Semester Ganjil (Juli - Des ${academicRange.startYear})`;
        } else if (periodKey === 'SEMESTER_GENAP') {
            startIso = `${academicRange.endYear}-01-01`;
            endIso = `${academicRange.endYear}-06-30`;
            labelText = `Rekapitulasi Semester Genap (Jan - Jun ${academicRange.endYear})`;
        } else {
            const [y, m] = periodKey.split('-');
            const yearNum = parseInt(y, 10);
            const monthNum = parseInt(m, 10);
            const lastDay = new Date(yearNum, monthNum, 0).getDate();
            startIso = `${y}-${m}-01`;
            endIso = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
            const monthNamesIndo = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
            labelText = `Rekapitulasi Bulan ${monthNamesIndo[monthNum] || ''} ${y}`;
        }

        return { startIso, endIso, labelText };
    }

    const academicRange = {
        startYear: 2026,
        endYear: 2027,
        academicYearStr: '2026/2027',
        minDateIso: '2026-07-01',
        maxDateIso: '2027-06-30'
    };

    test('Filter FULL_YEAR menghasilkan rentang 1 tahun ajaran penuh', () => {
        const res = calculateAttendanceDateRange('FULL_YEAR', academicRange);
        expect(res.startIso).toBe('2026-07-01');
        expect(res.endIso).toBe('2027-06-30');
        expect(res.labelText).toBe('Rekapitulasi 1 Tahun Ajaran (2026/2027)');
    });

    test('Filter null / kosong otomatis fallback ke 1 tahun ajaran penuh', () => {
        const res = calculateAttendanceDateRange('', academicRange);
        expect(res.startIso).toBe('2026-07-01');
        expect(res.endIso).toBe('2027-06-30');
    });

    test('Filter SEMESTER_GANJIL menghasilkan rentang Juli - Desember tahun awal', () => {
        const res = calculateAttendanceDateRange('SEMESTER_GANJIL', academicRange);
        expect(res.startIso).toBe('2026-07-01');
        expect(res.endIso).toBe('2026-12-31');
        expect(res.labelText).toBe('Rekapitulasi Semester Ganjil (Juli - Des 2026)');
    });

    test('Filter SEMESTER_GENAP menghasilkan rentang Januari - Juni tahun akhir tanpa merusak tanggal', () => {
        const res = calculateAttendanceDateRange('SEMESTER_GENAP', academicRange);
        expect(res.startIso).toBe('2027-01-01');
        expect(res.endIso).toBe('2027-06-30');
        expect(res.labelText).toBe('Rekapitulasi Semester Genap (Jan - Jun 2027)');
        expect(res.startIso).not.toContain('NaN');
        expect(res.endIso).not.toContain('NaN');
    });

    test('Filter Bulan 2026-09 (September 2026 - 30 hari) menghasilkan rentang tanggal valid', () => {
        const res = calculateAttendanceDateRange('2026-09', academicRange);
        expect(res.startIso).toBe('2026-09-01');
        expect(res.endIso).toBe('2026-09-30');
        expect(res.labelText).toBe('Rekapitulasi Bulan September 2026');
    });

    test('Filter Bulan 2026-08 (Agustus 2026 - 31 hari) menghasilkan rentang tanggal valid', () => {
        const res = calculateAttendanceDateRange('2026-08', academicRange);
        expect(res.startIso).toBe('2026-08-01');
        expect(res.endIso).toBe('2026-08-31');
        expect(res.labelText).toBe('Rekapitulasi Bulan Agustus 2026');
    });

    test('Filter Bulan 2027-02 (Februari 2027 - 28 hari) menghasilkan rentang tanggal valid', () => {
        const res = calculateAttendanceDateRange('2027-02', academicRange);
        expect(res.startIso).toBe('2027-02-01');
        expect(res.endIso).toBe('2027-02-28');
        expect(res.labelText).toBe('Rekapitulasi Bulan Februari 2027');
    });
});

describe('Pengujian Logika Sorting Rekapitulasi Presensi (renderAttendanceRekapTable & sortAttendanceRekap)', () => {
    function sortRekapData(data, sortConfig) {
        const { column, order } = sortConfig;
        const isAsc = order === 'asc';

        return [...data].sort((a, b) => {
            let valA = a[column];
            let valB = b[column];

            if (column === 'no') {
                valA = a.originalIndex ?? a.no ?? 0;
                valB = b.originalIndex ?? b.no ?? 0;
            }

            if (typeof valA === 'string' && typeof valB === 'string') {
                const cmp = valA.localeCompare(valB, 'id', { numeric: true, sensitivity: 'base' });
                return isAsc ? cmp : -cmp;
            }

            const numA = Number(valA ?? 0);
            const numB = Number(valB ?? 0);
            if (numA !== numB) {
                return isAsc ? numA - numB : numB - numA;
            }

            return (a.name || '').localeCompare(b.name || '', 'id', { numeric: true });
        });
    }

    const sampleStudents = [
        { originalIndex: 1, no: 1, name: 'Budi Santoso', H: 18, S: 1, I: 0, A: 2, D: 0, P: 0, percent: 86 },
        { originalIndex: 2, no: 2, name: 'Agus Pratama', H: 20, S: 0, I: 0, A: 0, D: 1, P: 0, percent: 100 },
        { originalIndex: 3, no: 3, name: 'Citra Kirana', H: 15, S: 3, I: 1, A: 1, D: 0, P: 2, percent: 75 }
    ];

    test('Sort Alpa (A) descending menempatkan siswa dengan Alpa terbanyak di atas', () => {
        const sorted = sortRekapData(sampleStudents, { column: 'A', order: 'desc' });
        expect(sorted[0].name).toBe('Budi Santoso'); // A: 2
        expect(sorted[1].name).toBe('Citra Kirana'); // A: 1
        expect(sorted[2].name).toBe('Agus Pratama'); // A: 0
    });

    test('Sort Sakit (S) descending menempatkan siswa dengan Sakit terbanyak di atas', () => {
        const sorted = sortRekapData(sampleStudents, { column: 'S', order: 'desc' });
        expect(sorted[0].name).toBe('Citra Kirana'); // S: 3
        expect(sorted[1].name).toBe('Budi Santoso'); // S: 1
        expect(sorted[2].name).toBe('Agus Pratama'); // S: 0
    });

    test('Sort Hadir (H) ascending menempatkan siswa dengan Hadir tersedikit di atas', () => {
        const sorted = sortRekapData(sampleStudents, { column: 'H', order: 'asc' });
        expect(sorted[0].name).toBe('Citra Kirana'); // H: 15
        expect(sorted[1].name).toBe('Budi Santoso'); // H: 18
        expect(sorted[2].name).toBe('Agus Pratama'); // H: 20
    });

    test('Sort % Kehadiran (percent) descending menempatkan siswa dengan persentase tertinggi di atas', () => {
        const sorted = sortRekapData(sampleStudents, { column: 'percent', order: 'desc' });
        expect(sorted[0].name).toBe('Agus Pratama'); // 100%
        expect(sorted[1].name).toBe('Budi Santoso'); // 86%
        expect(sorted[2].name).toBe('Citra Kirana'); // 75%
    });

    test('Sort Nama Siswa ascending menempatkan nama secara alfabetis A-Z', () => {
        const sorted = sortRekapData(sampleStudents, { column: 'name', order: 'asc' });
        expect(sorted[0].name).toBe('Agus Pratama');
        expect(sorted[1].name).toBe('Budi Santoso');
        expect(sorted[2].name).toBe('Citra Kirana');
    });

    test('Sort Nomor Urut (no) mengembalikan ke urutan daftar absen awal', () => {
        const scrambled = [sampleStudents[2], sampleStudents[0], sampleStudents[1]];
        const sorted = sortRekapData(scrambled, { column: 'no', order: 'asc' });
        expect(sorted[0].name).toBe('Budi Santoso');
        expect(sorted[1].name).toBe('Agus Pratama');
        expect(sorted[2].name).toBe('Citra Kirana');
    });
});

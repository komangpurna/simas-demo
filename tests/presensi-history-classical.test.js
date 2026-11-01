const fs = require('fs');
const path = require('path');

describe('Presensi Siswa History - Classical Attendance Percentage Logic & Integration', () => {
    // Helper function reproducing the SSOT logic in js/page-presensi.js
    function calculateAttendanceStats(summary) {
        const sum = summary || { H: 0, S: 0, I: 0, D: 0, A: 0 };
        const h = Number(sum.H) || 0;
        const s = Number(sum.S) || 0;
        const i = Number(sum.I) || 0;
        const d = Number(sum.D) || 0;
        const a = Number(sum.A) || 0;
        const total = h + s + i + d + a;
        const hadirCount = h + d;
        const rawPct = total > 0 ? ((hadirCount / total) * 100) : 0;
        const attPct = parseFloat(rawPct.toFixed(1));
        const attPctFormatted = total > 0
            ? (Number.isInteger(attPct) ? `${attPct}%` : `${attPct.toFixed(1)}%`)
            : '0%';

        let tier = 'emerald';
        if (attPct < 80) {
            tier = 'rose';
        } else if (attPct < 90) {
            tier = 'amber';
        }

        return { total, hadirCount, attPct, attPctFormatted, tier };
    }

    function getAttendanceBadgeClass(tier) {
        if (tier === 'rose') {
            return 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300 border border-rose-300 dark:border-rose-700';
        }
        if (tier === 'amber') {
            return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-300 dark:border-amber-700';
        }
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700';
    }

    test('Menghitung kehadiran klasikal rombel secara akurat (H + D dihitung hadir)', () => {
        // Rombel 36 siswa selama 20 hari efektif (total 720 kemungkinan kehadiran)
        // H: 650, S: 20, I: 10, D: 30, A: 10
        // Hadir riil = 650 + 30 = 680 dari 720 -> 94.4%
        const classSummary = { H: 650, S: 20, I: 10, D: 30, A: 10 };
        const stats = calculateAttendanceStats(classSummary);

        expect(stats.total).toBe(720);
        expect(stats.hadirCount).toBe(680);
        expect(stats.attPctFormatted).toBe('94.4%');
        expect(stats.tier).toBe('emerald');
        expect(getAttendanceBadgeClass(stats.tier)).toContain('emerald');
    });

    test('Menghitung kehadiran klasikal sempurna (100%)', () => {
        const classSummary = { H: 700, S: 0, I: 0, D: 20, A: 0 };
        const stats = calculateAttendanceStats(classSummary);

        expect(stats.total).toBe(720);
        expect(stats.hadirCount).toBe(720);
        expect(stats.attPctFormatted).toBe('100%');
        expect(stats.tier).toBe('emerald');
    });

    test('Menetapkan tier warna amber untuk kehadiran klasikal 80% s.d. <90%', () => {
        // H: 600, S: 40, I: 40, D: 20, A: 20 -> 620 dari 720 = 86.1%
        const classSummary = { H: 600, S: 40, I: 40, D: 20, A: 20 };
        const stats = calculateAttendanceStats(classSummary);

        expect(stats.attPctFormatted).toBe('86.1%');
        expect(stats.tier).toBe('amber');
        expect(getAttendanceBadgeClass(stats.tier)).toContain('amber');
    });

    test('Menetapkan tier warna rose untuk kehadiran klasikal di bawah 80%', () => {
        // H: 500, S: 80, I: 60, D: 30, A: 50 -> 530 dari 720 = 73.6%
        const classSummary = { H: 500, S: 80, I: 60, D: 30, A: 50 };
        const stats = calculateAttendanceStats(classSummary);

        expect(stats.attPctFormatted).toBe('73.6%');
        expect(stats.tier).toBe('rose');
        expect(getAttendanceBadgeClass(stats.tier)).toContain('rose');
    });

    test('Kalkulasi kehadiran klasikal harian (Detail Harian) dengan 36 siswa', () => {
        // Hari tertentu: 32 Hadir, 2 Dispensasi, 1 Sakit, 1 Izin, 0 Alpha -> 34 hadir dari 36 (94.4%)
        const dailySummary = { H: 32, S: 1, I: 1, D: 2, A: 0 };
        const stats = calculateAttendanceStats(dailySummary);

        expect(stats.total).toBe(36);
        expect(stats.hadirCount).toBe(34);
        expect(stats.attPctFormatted).toBe('94.4%');
        expect(stats.tier).toBe('emerald');
    });

    test('Integritas js/page-presensi.js: mengekspos getAttendanceSummaryStats dan getAttendanceBadgeClass', () => {
        const presensiJs = fs.readFileSync(path.resolve(__dirname, '../js/page-presensi.js'), 'utf8');

        expect(presensiJs).toContain('window.getAttendanceSummaryStats = getAttendanceSummaryStats;');
        expect(presensiJs).toContain('window.getAttendanceBadgeClass = getAttendanceBadgeClass;');
        expect(presensiJs).toContain('function getAttendanceSummaryStats(');
        expect(presensiJs).toContain('function getAttendanceBadgeClass(');
    });

    test('Integritas js/page-presensi.js: loadRecapSemester menyajikan baris TOTAL dan Kehadiran Klasikal', () => {
        const presensiJs = fs.readFileSync(path.resolve(__dirname, '../js/page-presensi.js'), 'utf8');

        // Pastikan loadRecapSemester memiliki akumulasi totalH s.d. totalA
        expect(presensiJs).toMatch(/async function loadRecapSemester\(\)[\s\S]*?let totalH = 0, totalS = 0, totalI = 0, totalD = 0, totalA = 0;/);
        // Pastikan terdapat baris TOTAL 8 kolom
        expect(presensiJs).toMatch(/async function loadRecapSemester\(\)[\s\S]*?<td class="[^"]*">TOTAL<\/td>/);
        expect(presensiJs).toMatch(/async function loadRecapSemester\(\)[\s\S]*?Kehadiran Klasikal:/);
    });

    test('Integritas js/page-presensi.js: loadRecapMonthly menyajikan baris TOTAL dan Kehadiran Klasikal', () => {
        const presensiJs = fs.readFileSync(path.resolve(__dirname, '../js/page-presensi.js'), 'utf8');

        // Pastikan loadRecapMonthly memiliki akumulasi totalH s.d. totalA
        expect(presensiJs).toMatch(/async function loadRecapMonthly\(\)[\s\S]*?let totalH = 0, totalS = 0, totalI = 0, totalD = 0, totalA = 0;/);
        // Pastikan terdapat baris TOTAL 8 kolom
        expect(presensiJs).toMatch(/async function loadRecapMonthly\(\)[\s\S]*?<td class="[^"]*">TOTAL<\/td>/);
        expect(presensiJs).toMatch(/async function loadRecapMonthly\(\)[\s\S]*?Kehadiran Klasikal:/);
    });

    test('Integritas js/page-presensi.js: loadDailyDetail menyajikan ringkasan dan Kehadiran Klasikal', () => {
        const presensiJs = fs.readFileSync(path.resolve(__dirname, '../js/page-presensi.js'), 'utf8');

        expect(presensiJs).toMatch(/async function loadDailyDetail\(\)[\s\S]*?let dayH = 0, dayS = 0, dayI = 0, dayD = 0, dayA = 0;/);
        expect(presensiJs).toMatch(/async function loadDailyDetail\(\)[\s\S]*?Kehadiran Klasikal:/);
        expect(presensiJs).toMatch(/async function loadDailyDetail\(\)[\s\S]*?Rekap Harian:/);
    });
});

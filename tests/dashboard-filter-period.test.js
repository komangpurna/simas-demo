/**
 * Unit & Behavioral Tests: Dashboard Filter Period Refactoring
 * Memverifikasi opsi filter periode Dashboard:
 * 1. Hari Ini (today)
 * 2. Mingguan (week: 7 hari terakhir inklusif)
 * 3. Bulanan (month: 30 hari terakhir inklusif - default aktif)
 * 4. Semester (semester: awal semester berjalan s.d. hari ini)
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Dashboard Filter Periode Refactoring (Hari Ini, Mingguan, Bulanan, Semester)', () => {
    const rootDir = path.resolve(__dirname, '..');
    const dashboardHtml = fs.readFileSync(path.join(rootDir, 'dashboard.html'), 'utf8');
    const dashboardJs = fs.readFileSync(path.join(rootDir, 'js', 'page-dashboard.js'), 'utf8');

    test('1. dashboard.html mendeklarasikan ke-4 tombol filter dengan label dan data-filter yang benar', () => {
        expect(dashboardHtml).toContain('data-filter="today"');
        expect(dashboardHtml).toContain('data-filter="week"');
        expect(dashboardHtml).toContain('data-filter="month"');
        expect(dashboardHtml).toContain('data-filter="semester"');

        // Memastikan label tombol UI baru
        expect(dashboardHtml).toMatch(/data-filter="today"[\s\S]*?>\s*Hari Ini\s*<\/button>/);
        expect(dashboardHtml).toMatch(/data-filter="week"[\s\S]*?>\s*Mingguan\s*<\/button>/);
        expect(dashboardHtml).toMatch(/data-filter="month"[\s\S]*?>\s*Bulanan\s*<\/button>/);
        expect(dashboardHtml).toMatch(/data-filter="semester"[\s\S]*?>\s*Semester\s*<\/button>/);

        // Memastikan filter lama (last_month / Bln Lalu / Mgg Ini) telah dibersihkan
        expect(dashboardHtml).not.toContain('data-filter="last_month"');
        expect(dashboardHtml).not.toContain('setFilterPeriode(\'last_month\')');
        expect(dashboardHtml).not.toContain('Bln Lalu');
        expect(dashboardHtml).not.toContain('Mgg Ini');
    });

    test('2. Tombol "Bulanan" menjadi default aktif di markup dashboard.html', () => {
        // Tombol month memiliki class active-filter
        expect(dashboardHtml).toMatch(/data-filter="month"[^>]*class="[^"]*active-filter[^"]*"/);
        // Tombol week tidak memiliki class active-filter
        expect(dashboardHtml).not.toMatch(/data-filter="week"[^>]*class="[^"]*active-filter[^"]*"/);
    });

    test('3. Elemen catatan periode diagram pelanggaran eksis dengan id="violation-chart-period-note"', () => {
        expect(dashboardHtml).toContain('id="violation-chart-period-note"');
        expect(dashboardHtml).toContain('*Data berdasarkan catatan 30 hari terakhir');
    });

    test('4. js/page-dashboard.js menginisialisasi currentFilterPeriode ke "month" secara default', () => {
        expect(dashboardJs).toMatch(/let\s+currentFilterPeriode\s*=\s*['"]month['"];/);
    });

    test('5. Perhitungan rentang tanggal getFilterDateRange akurat sesuai spesifikasi bisnis', () => {
        // Ekstrak fungsi getFilterDateRange dan getCurrentSemesterRange dari js/page-dashboard.js
        const mockEnv = {
            getCurrentSemesterRange: (refDate = new Date()) => {
                const year = refDate.getFullYear();
                const semType = refDate.getMonth() >= 6 ? '1' : '2';
                return semType === '1'
                    ? { startDate: `${year}-07-01`, endDate: `${year}-12-31`, semesterLabel: 'Semester Ganjil' }
                    : { startDate: `${year}-01-01`, endDate: `${year}-06-30`, semesterLabel: 'Semester Genap' };
            }
        };

        const evalFunc = new Function('getCurrentSemesterRange', `
            ${dashboardJs.slice(dashboardJs.indexOf('function getFilterDateRange'), dashboardJs.indexOf('// Helper: Get filter label text'))}
            return getFilterDateRange;
        `);

        const getFilterDateRange = evalFunc(mockEnv.getCurrentSemesterRange);

        // a) Hari Ini (today)
        const todayRange = getFilterDateRange('today');
        expect(todayRange.start.getDate()).toBe(todayRange.end.getDate());
        expect(todayRange.start.getMonth()).toBe(todayRange.end.getMonth());
        expect(todayRange.start.getFullYear()).toBe(todayRange.end.getFullYear());

        // b) Mingguan (week): 7 hari terakhir (start = today - 6 hari)
        const weekRange = getFilterDateRange('week');
        const diffWeekDays = Math.round((weekRange.end - weekRange.start) / (1000 * 60 * 60 * 24));
        expect(diffWeekDays).toBe(7); // Dari H-6 00:00 s.d. H 23:59:59 = 7 hari kalender

        // c) Bulanan (month): 30 hari terakhir (start = today - 29 hari)
        const monthRange = getFilterDateRange('month');
        const diffMonthDays = Math.round((monthRange.end - monthRange.start) / (1000 * 60 * 60 * 24));
        expect(diffMonthDays).toBe(30); // Dari H-29 00:00 s.d. H 23:59:59 = 30 hari kalender

        // d) Semester (semester): Awal semester s.d. hari ini
        const semesterRange = getFilterDateRange('semester');
        const now = new Date();
        const expectedSemStart = now.getMonth() >= 6 ? new Date(now.getFullYear(), 6, 1) : new Date(now.getFullYear(), 0, 1);
        expect(semesterRange.start.getFullYear()).toBe(expectedSemStart.getFullYear());
        expect(semesterRange.start.getMonth()).toBe(expectedSemStart.getMonth());
        expect(semesterRange.start.getDate()).toBe(expectedSemStart.getDate());
        expect(semesterRange.end.getDate()).toBe(now.getDate());
    });

    test('6. getFilterLabel memetakan nilai filter ke nama yang benar', () => {
        const evalLabelFunc = new Function(`
            ${dashboardJs.slice(dashboardJs.indexOf('function getFilterLabel'), dashboardJs.indexOf('window.getFilterDateRange'))}
            return getFilterLabel;
        `);
        const getFilterLabel = evalLabelFunc();

        expect(getFilterLabel('today')).toBe('Hari Ini');
        expect(getFilterLabel('week')).toBe('Mingguan');
        expect(getFilterLabel('month')).toBe('Bulanan');
        expect(getFilterLabel('semester')).toBe('Semester');
    });

    test('7. setFilterPeriode menangani pembaruan teks violation-chart-period-note secara dinamis', () => {
        expect(dashboardJs).toContain("const noteEl = document.getElementById('violation-chart-period-note')");
        expect(dashboardJs).toContain("filter === 'today'");
        expect(dashboardJs).toContain("filter === 'week'");
        expect(dashboardJs).toContain("filter === 'semester'");
    });
});

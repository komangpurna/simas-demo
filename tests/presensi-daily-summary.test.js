const fs = require('fs');
const path = require('path');

describe('Presensi Siswa Daily Summary - Percentage & Sorting Logic', () => {
    // Helper function reproducing the SSOT logic in js/page-presensi.js
    function calculateAttendanceStats(summary) {
        const sum = summary || { H: 0, S: 0, I: 0, D: 0, A: 0 };
        const total = (sum.H || 0) + (sum.S || 0) + (sum.I || 0) + (sum.D || 0) + (sum.A || 0);
        const hadirCount = (sum.H || 0) + (sum.D || 0);
        const attPct = total > 0 ? ((hadirCount / total) * 100) : 0;
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

    function sortDailySummaryRows(rawRows, field, dir) {
        return [...rawRows].sort((a, b) => {
            if (field === 'percentage') {
                const statA = calculateAttendanceStats(a.summary);
                const statB = calculateAttendanceStats(b.summary);

                if (statA.attPct !== statB.attPct) {
                    return dir === 'asc' ? statA.attPct - statB.attPct : statB.attPct - statA.attPct;
                }
                return (a.class || '').localeCompare(b.class || '', undefined, { numeric: true });
            } else {
                const cmp = (a.class || '').localeCompare(b.class || '', undefined, { numeric: true });
                return dir === 'asc' ? cmp : -cmp;
            }
        });
    }

    test('Menghitung persentase kehadiran dengan benar (H + D dihitung hadir)', () => {
        // Kelas 36 siswa: 34 Hadir, 1 Dispen, 1 Sakit -> 35 hadir dari 36
        const stat = calculateAttendanceStats({ H: 34, S: 1, I: 0, D: 1, A: 0 });
        expect(stat.total).toBe(36);
        expect(stat.hadirCount).toBe(35);
        expect(stat.attPctFormatted).toBe('97.2%');
        expect(stat.tier).toBe('emerald');
    });

    test('Menghitung kehadiran 100% dan format bilangan bulat tanpa desimal', () => {
        const stat = calculateAttendanceStats({ H: 36, S: 0, I: 0, D: 0, A: 0 });
        expect(stat.total).toBe(36);
        expect(stat.attPct).toBe(100);
        expect(stat.attPctFormatted).toBe('100%');
        expect(stat.tier).toBe('emerald');
    });

    test('Menetapkan tier warna amber untuk kehadiran 80% s.d. <90%', () => {
        // 30 Hadir dari 36 -> 83.3%
        const stat = calculateAttendanceStats({ H: 30, S: 2, I: 2, D: 0, A: 2 });
        expect(stat.attPctFormatted).toBe('83.3%');
        expect(stat.tier).toBe('amber');
    });

    test('Menetapkan tier warna rose untuk kehadiran kritis <80%', () => {
        // 25 Hadir dari 36 -> 69.4%
        const stat = calculateAttendanceStats({ H: 25, S: 5, I: 2, D: 0, A: 4 });
        expect(stat.attPctFormatted).toBe('69.4%');
        expect(stat.tier).toBe('rose');
    });

    test('Menangani data presensi kosong (0 siswa)', () => {
        const stat = calculateAttendanceStats({ H: 0, S: 0, I: 0, D: 0, A: 0 });
        expect(stat.total).toBe(0);
        expect(stat.attPctFormatted).toBe('0%');
        expect(stat.tier).toBe('rose');
    });

    test('Mengurutkan baris rekap berdasarkan persentase kehadiran (DESC dan ASC)', () => {
        const mockRows = [
            { class: 'X-1', summary: { H: 30, S: 6, I: 0, D: 0, A: 0 } }, // 83.3%
            { class: 'X-2', summary: { H: 36, S: 0, I: 0, D: 0, A: 0 } }, // 100%
            { class: 'X-3', summary: { H: 25, S: 5, I: 2, D: 0, A: 4 } }  // 69.4%
        ];

        // Sort DESC (kehadiran tertinggi di atas)
        const sortedDesc = sortDailySummaryRows(mockRows, 'percentage', 'desc');
        expect(sortedDesc[0].class).toBe('X-2'); // 100%
        expect(sortedDesc[1].class).toBe('X-1'); // 83.3%
        expect(sortedDesc[2].class).toBe('X-3'); // 69.4%

        // Sort ASC (kehadiran terendah di atas)
        const sortedAsc = sortDailySummaryRows(mockRows, 'percentage', 'asc');
        expect(sortedAsc[0].class).toBe('X-3'); // 69.4%
        expect(sortedAsc[1].class).toBe('X-1'); // 83.3%
        expect(sortedAsc[2].class).toBe('X-2'); // 100%
    });

    test('Mengurutkan baris rekap berdasarkan kelas (ASC dan DESC)', () => {
        const mockRows = [
            { class: 'X-10', summary: { H: 36, S: 0, I: 0, D: 0, A: 0 } },
            { class: 'X-1', summary: { H: 36, S: 0, I: 0, D: 0, A: 0 } },
            { class: 'X-2', summary: { H: 36, S: 0, I: 0, D: 0, A: 0 } }
        ];

        // Sort ASC natural numeric (X-1, X-2, X-10)
        const sortedAsc = sortDailySummaryRows(mockRows, 'class', 'asc');
        expect(sortedAsc.map(r => r.class)).toEqual(['X-1', 'X-2', 'X-10']);

        // Sort DESC
        const sortedDesc = sortDailySummaryRows(mockRows, 'class', 'desc');
        expect(sortedDesc.map(r => r.class)).toEqual(['X-10', 'X-2', 'X-1']);
    });

    test('Integritas template presensi.html: kolom % Kehadiran berada tepat setelah Kelas dan memiliki handler sort', () => {
        const html = fs.readFileSync(path.resolve(__dirname, '../presensi.html'), 'utf8');

        // Pastikan th Kelas memiliki handler sort
        expect(html).toContain("onclick=\"window.toggleDailySummarySort('class')\"");
        expect(html).toContain('id="sort-icon-class"');

        // Pastikan th % Kehadiran ada dan memiliki handler sort
        expect(html).toContain("onclick=\"window.toggleDailySummarySort('percentage')\"");
        expect(html).toContain('id="sort-icon-percentage"');
        expect(html).toContain('% Kehadiran');

        // Pastikan urutan: Kelas mendahului % Kehadiran, dan % Kehadiran mendahului H
        const classIdx = html.indexOf("onclick=\"window.toggleDailySummarySort('class')\"");
        const pctIdx = html.indexOf("onclick=\"window.toggleDailySummarySort('percentage')\"");
        const hMatch = html.match(/>\s*H\s*<\/th>/);
        const hIdx = hMatch ? hMatch.index : -1;

        expect(classIdx).toBeGreaterThan(-1);
        expect(pctIdx).toBeGreaterThan(classIdx);
        expect(hIdx).toBeGreaterThan(pctIdx);
    });

    test('Integritas js/page-presensi.js: mengekspos fungsi sorting dan state', () => {
        const js = fs.readFileSync(path.resolve(__dirname, '../js/page-presensi.js'), 'utf8');

        expect(js).toContain('window.dailySummarySortField');
        expect(js).toContain('window.toggleDailySummarySort');
        expect(js).toContain('renderDailySummaryRows');
        expect(js).toContain('updateDailySummarySortIcons');
    });

    test('Integritas js/global.js: mengekspos window.calculateAttendanceStats dan window.getWitaISODate', () => {
        const globalJs = fs.readFileSync(path.resolve(__dirname, '../js/global.js'), 'utf8');

        expect(globalJs).toContain('window.calculateAttendanceStats = function');
        expect(globalJs).toContain('export const calculateAttendanceStats = window.calculateAttendanceStats;');
        expect(globalJs).toContain('window.getWitaISODate = function');
        expect(globalJs).toContain('export const getWitaISODate = window.getWitaISODate;');
    });
});

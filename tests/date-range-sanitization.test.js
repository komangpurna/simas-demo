const fs = require('fs');
const path = require('path');

describe('Date Range Sanitization & Month End Calculation', () => {
    function sanitizeDateIso(dateStr) {
        if (!dateStr || typeof dateStr !== 'string') return dateStr;
        const parts = dateStr.trim().split('-');
        if (parts.length === 3) {
            const y = parseInt(parts[0], 10);
            const m = parseInt(parts[1], 10);
            let d = parseInt(parts[2], 10);
            if (!isNaN(y) && !isNaN(m) && !isNaN(d) && m >= 1 && m <= 12) {
                const maxDays = new Date(y, m, 0).getDate();
                if (d > maxDays) d = maxDays;
                if (d < 1) d = 1;
                return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            }
        }
        return dateStr;
    }

    test('Mengoreksi 2026-09-31 menjadi 2026-09-30 (September hanya 30 hari)', () => {
        expect(sanitizeDateIso('2026-09-31')).toBe('2026-09-30');
    });

    test('Mengoreksi 2026-02-31 menjadi 2026-02-28 (Februari non-kabisat)', () => {
        expect(sanitizeDateIso('2026-02-31')).toBe('2026-02-28');
    });

    test('Mengoreksi 2024-02-31 menjadi 2024-02-29 (Februari tahun kabisat)', () => {
        expect(sanitizeDateIso('2024-02-31')).toBe('2024-02-29');
    });

    test('Mempertahankan tanggal valid 2026-08-31 (Agustus 31 hari)', () => {
        expect(sanitizeDateIso('2026-08-31')).toBe('2026-08-31');
    });

    test('Mempertahankan tanggal tengah bulan valid 2026-09-15', () => {
        expect(sanitizeDateIso('2026-09-15')).toBe('2026-09-15');
    });

    test('Memastikan page-wali-kelas.js tidak lagi memiliki endIso hardcoded -31', () => {
        const waliCode = fs.readFileSync(path.join(__dirname, '../js/page-wali-kelas.js'), 'utf8');
        expect(waliCode).not.toMatch(/endIso = `\$\{y\}-\$\{m\}-31`/);
        expect(waliCode).toMatch(/new Date\(yearNum, monthNum, 0\)\.getDate\(\)/);
    });

    test('Memastikan page-portal-siswa.js tidak lagi memiliki endDate hardcoded -31', () => {
        const portalCode = fs.readFileSync(path.join(__dirname, '../js/page-portal-siswa.js'), 'utf8');
        expect(portalCode).not.toMatch(/endDate = `\$\{monthVal\}-31`/);
        expect(portalCode).toMatch(/new Date\(parseInt\(y, 10\), parseInt\(m, 10\), 0\)\.getDate\(\)/);
    });
});

import { addLoanDays, countChargeableLateDays, parseISODateUTC } from './circulation-utils.mjs';

describe('library circulation date utilities', () => {
    test('menolak tanggal ISO yang tidak valid', () => {
        expect(parseISODateUTC('2026-02-30')).toBeNull();
        expect(parseISODateUTC('24-08-2026')).toBeNull();
    });

    test('mengabaikan akhir pekan dan hari libur saat menghitung denda', () => {
        expect(countChargeableLateDays('2026-08-21', '2026-08-26', {
            ignoreHolidays: true,
            holidays: new Set(['2026-08-25']),
        })).toBe(2);
    });

    test('menghitung semua hari ketika pengabaian libur dimatikan', () => {
        expect(countChargeableLateDays('2026-08-21', '2026-08-24', {
            ignoreHolidays: false,
        })).toBe(3);
    });

    test('menambah durasi pinjam berdasarkan hari kerja', () => {
        expect(addLoanDays('2026-08-21', 2, {
            ignoreHolidays: true,
            holidays: new Set(['2026-08-24']),
        })).toBe('2026-08-26');
    });
});

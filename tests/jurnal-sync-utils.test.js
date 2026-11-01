const {
  getStoredAggregatePoints,
  isDashboardActiveStudent,
} = require('./jurnal-sync-utils');

describe('Student and aggregate utilities', () => {
  test('menghitung hanya rombel aktif dengan aturan yang sama seperti dashboard', () => {
    expect(isDashboardActiveStudent({ class: 'XI-1' })).toBe(true);
    expect(isDashboardActiveStudent({ class: 'Alumni 2025' })).toBe(false);
    expect(isDashboardActiveStudent({ class: 'NON_AKTIF' })).toBe(false);
    expect(isDashboardActiveStudent({ class: '' })).toBe(false);
  });

  test('menormalisasi alias poin lama tanpa menurunkan total yang sudah tersimpan', () => {
    expect(getStoredAggregatePoints({ points: 10, totalPoints: 25, poinPelanggaran: 25 })).toBe(25);
    expect(getStoredAggregatePoints({ points: -5 })).toBe(0);
    expect(getStoredAggregatePoints({})).toBe(0);
  });
});

/**
 * tests/finance-arrears-active-tagihan.test.js
 * Unit Test: Modul Keuangan - Pemisahan Tagihan Aktif (Bulan Berjalan, Hijau) & Tunggakan (Bulan Lalu, Merah)
 * Memastikan:
 * 1. Header tabel menampilkan Tagihan Aktif (Hijau) / Tunggakan (Merah).
 * 2. Tab tunggakan mengabaikan batasan tanggal jatuh tempo (systemDueDate) untuk bulan berjalan.
 * 3. Bulan berjalan diformat hijau, bulan lalu diformat merah.
 * 4. Teks WA Wali dan ekspor Excel memisahkan rincian secara transparan.
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Modul Keuangan: Pemisahan Tagihan Aktif & Tunggakan', () => {
    const rootDir = path.resolve(__dirname, '..');
    const jsFile = path.join(rootDir, 'js', 'page-keuangan.js');
    const jsContent = fs.readFileSync(jsFile, 'utf8');

    test('1. switchReportMode dan loadArrearsReport mengatur header Tunggakan (merah) / Tagihan Aktif (hijau)', () => {
        expect(jsContent).toContain('Tunggakan</span> <span class="text-slate-400 font-normal">/</span> <span class="text-emerald-600 dark:text-emerald-400 font-bold">Tagihan Aktif');
        expect(jsContent).toContain('text-rose-600 dark:text-rose-400 font-bold');
        expect(jsContent).toContain('text-emerald-600 dark:text-emerald-400 font-bold');
    });

    test('2. loadArrearsReport mengabaikan tanggal jatuh tempo (systemDueDate) pada tab tunggakan', () => {
        // Memastikan tidak ada pengujian "isDue = dueDate < now" yang memblokir bulan berjalan
        const loadArrearsMatch = jsContent.match(/window\.loadArrearsReport = async \(\) => \{([\s\S]*?)\n\};/);
        expect(loadArrearsMatch).toBeTruthy();
        const loadArrearsCode = loadArrearsMatch[1];

        expect(loadArrearsCode).toContain('Abaikan batasan tanggal jatuh tempo (systemDueDate)');
        expect(loadArrearsCode).not.toContain('const isDue = dueDate < now;');
        expect(loadArrearsCode).toContain('const isCurrentMonth = (currY === currentYear && currM === currentMonth);');
    });

    test('3. Objek unpaidItems menyimpan flag isCurrent dan merender warna semantik hijau/merah', () => {
        // Item menyimpan isCurrent
        expect(jsContent).toContain('isCurrent: isCurrentMonth');
        expect(jsContent).toContain('arrearsItems: unpaidItems.filter(i => !i.isCurrent)');
        expect(jsContent).toContain('activeItems: unpaidItems.filter(i => i.isCurrent)');

        // Format span warna: hijau untuk bulan berjalan, merah untuk tunggakan
        expect(jsContent).toContain('item.isCurrent');
        expect(jsContent).toContain('text-emerald-600 dark:text-emerald-400 font-semibold');
        expect(jsContent).toContain('text-red-600 dark:text-red-400 font-medium');

        // Badge tunggal: merah jika ada tunggakan, hijau jika hanya tagihan aktif bulan berjalan (tanpa badge +Aktif)
        expect(jsContent).toContain('arrearsCount > 0');
        expect(jsContent).toContain('text-red-600 dark:text-red-400 bg-red-50');
        expect(jsContent).toContain('text-emerald-600 dark:text-emerald-400 bg-emerald-50');
        expect(jsContent).not.toContain('+${activeCount} Aktif');
    });

    test('4. Integrasi pesan WhatsApp dan Export Excel membedakan status Aktif vs Tunggakan', () => {
        // Di copyArrearsToWA
        expect(jsContent).toContain('*LAPORAN TUNGGAKAN & TAGIHAN AKTIF KELAS');
        expect(jsContent).toContain('${arrears} Nunggak + ${active} Aktif');
        expect(jsContent).toContain('${active} Bln Aktif');

        // Di exportArrearsToExcel
        expect(jsContent).toContain('LAPORAN TUNGGAKAN & TAGIHAN AKTIF KELAS');
        expect(jsContent).toContain('STATUS & RINCIAN BULAN');
        expect(jsContent).toContain('(Aktif)');
        expect(jsContent).toContain('(Nunggak)');

        // Di sendArrearsToWali
        expect(jsContent).toContain('${arrears} Tunggakan + ${active} Tagihan Aktif');
        expect(jsContent).toContain('${active} Tagihan Aktif');
    });
});

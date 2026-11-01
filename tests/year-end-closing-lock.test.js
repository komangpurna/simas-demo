/**
 * Unit Test: Tutup Buku Tahunan Keuangan & Suka-Duka
 * - Tutup buku tahun berjalan mulai 1 Desember, berurutan, tidak boleh ganda
 * - Transaksi setelah tutup buku dibukukan ke 1 Januari tahun berikutnya
 * - Kunci hapus/ubah transaksi pada tahun buku tertutup
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Tutup Buku Tahunan: Keuangan & Suka-Duka', () => {
    const rootDir = path.resolve(__dirname, '..');
    const keuanganJs = fs.readFileSync(path.join(rootDir, 'js', 'page-keuangan.js'), 'utf8');
    const sukadukaJs = fs.readFileSync(path.join(rootDir, 'sukaduka', 'suka-duka.js'), 'utf8');
    const proxyTs = fs.readFileSync(path.join(rootDir, 'supabase', 'functions', 'secure-proxy', 'index.ts'), 'utf8');

    test('1. Keuangan: jendela tutup buku mulai Desember, berurutan, dan migrasi 2026 wajib dikunci', () => {
        expect(keuanganJs).toContain('function isFinanceClosingWindowOpen(year)');
        expect(keuanganJs).toContain('now.getMonth() === 11');
        expect(keuanganJs).toContain('function getNextFinanceClosingYear()');
        expect(keuanganJs).toContain('Tutup buku harus berurutan.');
        expect(keuanganJs).toContain('Kunci data migrasi SPP');
    });

    test('2. Keuangan: eksekusi memvalidasi ulang angka & memakai insert (anti tutup buku ganda)', () => {
        const execStart = keuanganJs.indexOf('window.executeYearEndClosing = async');
        const execBody = keuanganJs.slice(execStart, execStart + 4000);
        expect(execBody).toContain('await refreshClosedYearsList();');
        expect(execBody).toContain('computeFinanceClosingSummary(year)');
        expect(execBody).toContain('Data kas berubah sejak pratinjau dibuka.');
        expect(execBody).toContain(".from('finance_closings')\n                .insert({");
        expect(execBody).not.toContain('.upsert(');
    });

    test('3. Keuangan: pembayaran SPP pasca tutup buku dibukukan ke 1 Januari tahun berikutnya', () => {
        expect(keuanganJs).toContain('function getFinancePostingDateStr(realDateStr)');
        expect(keuanganJs).toContain('return `${year + 1}-01-01`;');
        expect(keuanganJs).toContain('const todayStr = getFinancePostingDateStr(realTodayStr);');
    });

    test('4. Keuangan: kunci hapus SPP berdasarkan tanggal bayar (bukan tahun tagihan)', () => {
        expect(keuanganJs).toContain('function getPaymentBookYears(record, y, m)');
        expect(keuanganJs).toContain('getLockedPaymentBookYear(existingRecord, targetDelete.year, targetDelete.month)');
        expect(keuanganJs).not.toContain('if (closedYearsList.includes(targetDelete.year))');
    });

    test('5. Keuangan: laporan harian & ringkasan kasir tetap menampilkan pembayaran pada hari riil', () => {
        expect(keuanganJs).toContain(".eq('date_str', `${dateValYear + 1}-01-01`)");
        expect(keuanganJs).toContain(".eq('date_str', `${todayYear + 1}-01-01`)");
    });

    test('6. Keuangan: rekonsiliasi & kunci data migrasi ditolak pada tahun buku tertutup', () => {
        expect(keuanganJs).toContain('Buku kas harian tahun tersebut tidak dapat disinkronkan ulang.');
        expect(keuanganJs).toContain('Data migrasi tidak dapat dikunci ulang.');
    });

    test('7. Suka-Duka (server): tutup buku divalidasi & dihitung ulang di Edge Function', () => {
        const start = proxyTs.indexOf('case "sukaduka-tutup-buku"');
        const body = proxyTs.slice(start, start + 6000);
        expect(body).toContain('currentWitaMonth === 12');
        expect(body).toContain('sudah ditutup sebelumnya.');
        expect(body).toContain('Tutup buku harus berurutan.');
        expect(body).toContain('sumSukadukaKasRange(');
        expect(body).toContain('.insert({');
        expect(body).not.toContain('.upsert(');
    });

    test('8. Suka-Duka (server): transaksi baru memakai tanggal pembukuan & hapus di tahun tertutup ditolak', () => {
        expect(proxyTs).toContain('async function getSukadukaPostingDateStr()');
        expect(proxyTs).toContain('const tanggalBuku = await getSukadukaPostingDateStr();');
        expect(proxyTs).toContain('const tanggalDenda = await getSukadukaPostingDateStr();');
        expect(proxyTs).toContain('const tanggalMutasi = tanggal || await getSukadukaPostingDateStr();');
        expect(proxyTs).toContain('const kasYear = await getSukadukaKasYear(iuranRecord?.kas_id);');
        expect(proxyTs).toContain('const kasYear = await getSukadukaKasYear(id);');
        expect(proxyTs).toContain('function sukadukaClosedYearResponse(year: number)');
    });

    test('9. Suka-Duka (klien): saldo berjalan dihitung setahun penuh sebelum filter bulan & data dipaginasi', () => {
        expect(sukadukaJs).toContain('async function fetchSukaDukaKasRows(');
        expect(sukadukaJs).toContain("window.fetchAllSupabaseRows(");
        const balanceIdx = sukadukaJs.indexOf('const balancedData = data.map(');
        const filterIdx = sukadukaJs.indexOf('balancedData.filter(');
        expect(balanceIdx).toBeGreaterThan(-1);
        expect(filterIdx).toBeGreaterThan(balanceIdx);
    });

    test('10. Suka-Duka (klien): wizard menutup tahun berurutan & mulai 1 Desember', () => {
        expect(sukadukaJs).toContain('async function getNextSukaDukaClosingYear()');
        expect(sukadukaJs).toContain('now.getMonth() === 11');
        expect(sukadukaJs).not.toContain('Anda dapat menutup buku tahun berjalan kapan saja');
    });
});

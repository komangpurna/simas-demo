import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

describe('SSOT Presensi & Paritas Kehadiran Siswa', () => {
    const globalJsPath = path.join(projectRoot, 'js', 'global.js');
    const portalHtmlPath = path.join(projectRoot, 'portal-siswa.html');
    const portalJsPath = path.join(projectRoot, 'js', 'page-portal-siswa.js');
    const waliKelasHtmlPath = path.join(projectRoot, 'wali-kelas.html');
    const waliKelasJsPath = path.join(projectRoot, 'js', 'page-wali-kelas.js');
    const presensiHtmlPath = path.join(projectRoot, 'presensi.html');
    const presensiJsPath = path.join(projectRoot, 'js', 'page-presensi.js');

    const globalJs = fs.readFileSync(globalJsPath, 'utf8');
    const portalHtml = fs.readFileSync(portalHtmlPath, 'utf8');
    const portalJs = fs.readFileSync(portalJsPath, 'utf8');
    const waliKelasHtml = fs.readFileSync(waliKelasHtmlPath, 'utf8');
    const waliKelasJs = fs.readFileSync(waliKelasJsPath, 'utf8');
    const presensiHtml = fs.readFileSync(presensiHtmlPath, 'utf8');
    const presensiJs = fs.readFileSync(presensiJsPath, 'utf8');

    // Ekstrak dan evaluasi fungsi calculateAttendanceStats secara murni
    const fnMatch = globalJs.match(/window\.calculateAttendanceStats\s*=\s*function\s*\([\s\S]*?\n\};/);
    let calculateAttendanceStats;
    if (fnMatch) {
        const fnCode = fnMatch[0].replace('window.calculateAttendanceStats = ', '').replace(/;\s*$/, '');
        calculateAttendanceStats = new Function(`return (${fnCode});`)();
    }

    test('1. calculateAttendanceStats terdefinisi di global.js dan mengembalikan formula resmi SIMAS', () => {
        expect(typeof calculateAttendanceStats).toBe('function');
    });

    test('2. Skenario Hadir Penuh (20 H, 0 Absen) menghasilkan 100% dan tier emerald', () => {
        const stats = calculateAttendanceStats({ H: 20, S: 0, I: 0, D: 0, A: 0 });
        expect(stats.total).toBe(20);
        expect(stats.hadirCount).toBe(20);
        expect(stats.attPct).toBe(100);
        expect(stats.attPctRounded).toBe(100);
        expect(stats.attPctFormatted).toBe('100%');
        expect(stats.tier).toBe('emerald');
        expect(stats.includeSakit).toBe(false);
    });

    test('3. Skenario Dispensasi: D dihitung sebagai kehadiran sah (H + D)', () => {
        const stats = calculateAttendanceStats({ H: 18, S: 0, I: 0, D: 2, A: 0 });
        expect(stats.total).toBe(20);
        expect(stats.hadirCount).toBe(20);
        expect(stats.attPct).toBe(100);
        expect(stats.attPctRounded).toBe(100);
        expect(stats.attPctFormatted).toBe('100%');
        expect(stats.tier).toBe('emerald');
    });

    test('4. Skenario Sakit, Izin, Dispen, dan Alpa pada Mode Standar', () => {
        // 15 H + 1 D = 16 Hadir. Total: 15 + 2 S + 1 I + 1 D + 1 A = 20 hari (16/20 = 80%)
        const stats = calculateAttendanceStats({ H: 15, S: 2, I: 1, D: 1, A: 1 });
        expect(stats.total).toBe(20);
        expect(stats.hadirCount).toBe(16);
        expect(stats.attPct).toBe(80);
        expect(stats.attPctRounded).toBe(80);
        expect(stats.attPctFormatted).toBe('80%');
        expect(stats.tier).toBe('amber');
    });

    test('5. Skenario Belum Ada Data (0 hari) menghasilkan 0%', () => {
        const statsEmpty = calculateAttendanceStats({ H: 0, S: 0, I: 0, D: 0, A: 0 });
        expect(statsEmpty.total).toBe(0);
        expect(statsEmpty.hadirCount).toBe(0);
        expect(statsEmpty.attPct).toBe(0);
        expect(statsEmpty.attPctRounded).toBe(0);
        expect(statsEmpty.attPctFormatted).toBe('0%');

        const statsNull = calculateAttendanceStats(null);
        expect(statsNull.total).toBe(0);
        expect(statsNull.attPct).toBe(0);
        expect(statsNull.attPctFormatted).toBe('0%');
    });

    test('6. Skenario Format Desimal Presisi & Pembulatan attPctRounded', () => {
        // 13 Hadir dari 14 total = 92.857...% -> 92.9%, bulat = 93%
        const stats = calculateAttendanceStats({ H: 13, S: 1, I: 0, D: 0, A: 0 });
        expect(stats.total).toBe(14);
        expect(stats.hadirCount).toBe(13);
        expect(stats.attPct).toBe(92.9);
        expect(stats.attPctRounded).toBe(93);
        expect(stats.attPctFormatted).toBe('92.9%');
        expect(stats.tier).toBe('emerald');
    });

    test('7. Skenario Mode Peraturan Akademik: includeSakit = true memperlakukan S sebagai Hadir (H + D + S)', () => {
        // 15 H, 5 S, 0 I, 0 D, 0 A (Total 20)
        // Standar: 15/20 = 75% (tier rose)
        const statsStd = calculateAttendanceStats({ H: 15, S: 5, I: 0, D: 0, A: 0 });
        expect(statsStd.hadirCount).toBe(15);
        expect(statsStd.attPct).toBe(75);
        expect(statsStd.tier).toBe('rose');

        // Mode Akademik: (15 + 5)/20 = 100% (tier emerald)
        const statsAkad = calculateAttendanceStats({ H: 15, S: 5, I: 0, D: 0, A: 0 }, { includeSakit: true });
        expect(statsAkad.hadirCount).toBe(20);
        expect(statsAkad.attPct).toBe(100);
        expect(statsAkad.attPctRounded).toBe(100);
        expect(statsAkad.attPctFormatted).toBe('100%');
        expect(statsAkad.tier).toBe('emerald');
        expect(statsAkad.includeSakit).toBe(true);
    });

    test('8. portal-siswa.html memiliki kartu ke-6 stat-persen dan grid responsif 6 kolom', () => {
        expect(portalHtml).toContain('id="card-stat-persen"');
        expect(portalHtml).toContain('id="stat-persen"');
        expect(portalHtml).toContain('id="stat-persen-label"');
        expect(portalHtml).toContain('lg:grid-cols-6');
    });

    test('9. page-portal-siswa.js memanggil updatePresensiPersenUI dengan SSOT', () => {
        expect(portalJs).toContain('function updatePresensiPersenUI(currentStats)');
        expect(portalJs).toContain('window.calculateAttendanceStats(currentStats)');
        expect(portalJs).toContain('updatePresensiPersenUI(cachedPresensi.stats);');
        expect(portalJs).toContain('updatePresensiPersenUI(stats);');
    });

    test('10. wali-kelas.html dan page-wali-kelas.js memiliki toggle switch dan handler onToggleIncludeSakitRekap', () => {
        expect(waliKelasHtml).toContain('id="toggle-include-sakit-rekap"');
        expect(waliKelasHtml).toContain('window.onToggleIncludeSakitRekap(this.checked)');
        expect(waliKelasJs).toContain('window.onToggleIncludeSakitRekap = function');
        expect(waliKelasJs).toContain('localStorage.setItem(\'simas_presensi_include_sakit\'');
    });

    test('11. presensi.html dan page-presensi.js memiliki toggle switch dan handler onToggleIncludeSakitHistory', () => {
        expect(presensiHtml).toContain('id="toggle-include-sakit-history"');
        expect(presensiHtml).toContain('window.onToggleIncludeSakitHistory(this.checked)');
        expect(presensiJs).toContain('window.onToggleIncludeSakitHistory = function');
        expect(presensiJs).toContain('getPresensiIncludeSakitPref');
        expect(presensiJs).toContain('getAttendanceSummaryStats(s, { includeSakit })');
    });
});

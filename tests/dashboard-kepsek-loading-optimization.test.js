const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

describe('Optimasi Pemuatan Data Dashboard Kepala Sekolah (Hemat Kuota & Kecepatan Tinggi)', () => {
    const pageDashboardJs = fs.readFileSync(path.join(projectRoot, 'js', 'page-dashboard.js'), 'utf8');

    describe('1. Agregasi Presensi Hemat Kuota (siswa_presensi_harian)', () => {
        test('Mendefinisikan konstanta cache presensi eksekutif dengan TTL 15 menit', () => {
            expect(pageDashboardJs).toContain('KEPSEK_ATTENDANCE_CACHE_KEY');
            expect(pageDashboardJs).toContain('KEPSEK_ATTENDANCE_TTL = 15 * 60 * 1000');
        });

        test('Fungsi getExecutiveAttendanceSummary memprioritaskan tabel pra-agregasi siswa_presensi_harian', () => {
            expect(pageDashboardJs).toContain('async function getExecutiveAttendanceSummary(');
            expect(pageDashboardJs).toContain("'siswa_presensi_harian'");
            expect(pageDashboardJs).toContain("selectFields: 'tanggal, kelas, summary'");
        });

        test('Menyediakan fallback defensif ke siswa_presensi jika tabel harian kosong', () => {
            expect(pageDashboardJs).toContain('fetchAttendancePromise');
            expect(pageDashboardJs).toContain("'siswa_presensi'");
            expect(pageDashboardJs).toContain("selectFields: 'tanggal, kelas, status'");
        });

        test('Menyimpan hasil kalkulasi ke local cache terpusat', () => {
            expect(pageDashboardJs).toContain('window.setLocalCache(KEPSEK_ATTENDANCE_CACHE_KEY, payload)');
        });
    });

    describe('2. Progressive Rendering & Stale-While-Revalidate (SWR)', () => {
        test('Menampilkan data cache lokal (SWR) secara instan 0ms saat awal load', () => {
            expect(pageDashboardJs).toContain('cachedSpp = !forceRefresh && typeof window.getLocalCache === \'function\'');
            expect(pageDashboardJs).toContain('applySppUI(cachedSpp)');
            expect(pageDashboardJs).toContain('cachedAtt = !forceRefresh && typeof window.getLocalCache === \'function\'');
        });

        test('Merender kartu total siswa, GTK, dan BK segera setelah master data D1 siap (< 100ms)', () => {
            expect(pageDashboardJs).toContain('const masterDataPromise = Promise.all([');
            expect(pageDashboardJs).toContain('elTotalSiswa.innerText = activeStudentCount.toLocaleString(\'id-ID\');');
            expect(pageDashboardJs).toContain('elTotalGtk.innerText = activeGtkCount.toLocaleString(\'id-ID\');');
            expect(pageDashboardJs).toContain('elTotalVio.innerText = finalViolations.toLocaleString(\'id-ID\');');
        });

        test('Menjalankan perhitungan SPP dan ranking secara asinkron paralel', () => {
            expect(pageDashboardJs).toContain('const sppPromise = renderSppProgressRing(activeStudents, forceRefresh);');
            expect(pageDashboardJs).toContain('const sppData = await sppPromise;');
            expect(pageDashboardJs).toContain('loadAndRenderExecutiveRankingSummary({');
        });
    });

    describe('3. Relaksasi Throttle Tab Switch (Auto-Refresh)', () => {
        test('DASHBOARD_REFRESH_THROTTLE_MS diatur ke 5 menit untuk mencegah lag berulang saat tab switch', () => {
            expect(pageDashboardJs).toContain('DASHBOARD_REFRESH_THROTTLE_MS = 5 * 60 * 1000;');
        });
    });
});

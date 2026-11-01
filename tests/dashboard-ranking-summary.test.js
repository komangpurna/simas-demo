const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

describe('Ringkasan Ranking Kinerja Rombel Kelas pada Dashboard Kepala Sekolah & Akses 24/7', () => {
    const dashboardHtml = fs.readFileSync(path.join(projectRoot, 'dashboard.html'), 'utf8');
    const pageDashboardJs = fs.readFileSync(path.join(projectRoot, 'js', 'page-dashboard.js'), 'utf8');
    const pageRankingJs = fs.readFileSync(path.join(projectRoot, 'js', 'page-ranking-kelas.js'), 'utf8');
    const globalJs = fs.readFileSync(path.join(projectRoot, 'js', 'global.js'), 'utf8');
    const rankingHtml = fs.readFileSync(path.join(projectRoot, 'ranking-kelas.html'), 'utf8');

    describe('1. Struktur Antarmuka Widget Ranking Kelas di Dashboard (dashboard.html)', () => {
        test('Memuat section ringkasan ranking kinerja kelas dengan ID yang tepat', () => {
            expect(dashboardHtml).toContain('id="section-ranking-kelas-summary"');
            expect(dashboardHtml).toContain('Ranking Kinerja Rombel Kelas');
            expect(dashboardHtml).toContain('Semester Berjalan');
        });

        test('Memiliki tombol tautan langsung ke halaman ranking-kelas.html di header section', () => {
            expect(dashboardHtml).toMatch(/<a\s+href="ranking-kelas\.html"[^>]*>[\s\S]*?Papan Ranking Lengkap/);
        });

        test('Memiliki indikator loader dan kontainer konten ranking yang terisolasi', () => {
            expect(dashboardHtml).toContain('id="ranking-summary-loading"');
            expect(dashboardHtml).toContain('id="ranking-summary-content"');
        });

        test('Memiliki kontainer podium Top 3 dan tabel mini leaderboard Top 5', () => {
            expect(dashboardHtml).toContain('id="ranking-summary-podium"');
            expect(dashboardHtml).toContain('id="ranking-summary-table-body"');
            expect(dashboardHtml).toContain('id="ranking-summary-total-info"');
        });

        test('Bilah Akses Cepat Eksekutif memuat tombol pintasan ke ranking-kelas.html', () => {
            expect(dashboardHtml).toMatch(/<a\s+href="ranking-kelas\.html"[^>]*class="[^"]*bg-amber-50[^"]*"[^>]*>[\s\S]*?<i class="fa-solid fa-trophy"><\/i>\s*Ranking Kelas\s*<\/a>/);
        });

        test('Footer mini leaderboard memiliki tautan ke ranking-kelas.html untuk seluruh rombel', () => {
            expect(dashboardHtml).toMatch(/<a\s+href="ranking-kelas\.html"[^>]*>[\s\S]*?Lihat Peringkat Seluruh Rombel di Papan Ranking Lengkap/);
        });
    });

    describe('2. Logika Agregasi & Rendering Dashboard (js/page-dashboard.js)', () => {
        test('loadKepalaSekolahDashboard memicu pemanggilan loadAndRenderExecutiveRankingSummary', () => {
            expect(pageDashboardJs).toContain('loadAndRenderExecutiveRankingSummary({');
        });

        test('Mendefinisikan fungsi loadAndRenderExecutiveRankingSummary dan mengekspornya ke window', () => {
            expect(pageDashboardJs).toContain('async function loadAndRenderExecutiveRankingSummary(');
            expect(pageDashboardJs).toContain('window.loadAndRenderExecutiveRankingSummary = loadAndRenderExecutiveRankingSummary;');
        });

        test('Menerapkan optimasi cache cross-tab SSOT (localStorage & sessionStorage simas_class_ranking_summary_cache)', () => {
            expect(pageDashboardJs).toContain("localStorage.getItem('simas_class_ranking_summary_cache')");
            expect(pageDashboardJs).toContain("sessionStorage.getItem('simas_class_ranking_summary_cache')");
            expect(pageDashboardJs).toContain("localStorage.setItem('simas_class_ranking_summary_cache'");
        });

        test('Mendukung kartu Top 3 Juara (Emas, Perak, Perunggu) dengan navigasi ke ranking-kelas.html', () => {
            expect(pageDashboardJs).toContain('Juara 1 (Emas)');
            expect(pageDashboardJs).toContain('Juara 2 (Perak)');
            expect(pageDashboardJs).toContain('Juara 3 (Perunggu)');
            expect(pageDashboardJs).toContain("onclick=\"window.location.href='ranking-kelas.html'\"");
        });

        test('Menghasilkan baris tabel Top 5 dengan tombol Detail yang mengarah ke ranking-kelas.html', () => {
            expect(pageDashboardJs).toContain('href="ranking-kelas.html"');
            expect(pageDashboardJs).toContain('Detail');
        });

        test('Kalkulasi fallback menyelaraskan 4 pilar (Kehadiran, SPP, Disiplin BK, Perpustakaan) dengan bobot SSOT', () => {
            expect(pageDashboardJs).toContain('libScore * normW.library');
            expect(pageDashboardJs).toContain('agg.violationPoints || agg.points || agg.violationCount');
            expect(pageDashboardJs).toContain('expectedSppMonths');
            expect(pageDashboardJs).toContain('paidKeySet');
        });

        test('renderSppProgressRing menyertakan studentDebtMap dan paidRecords untuk paritas SSOT', () => {
            expect(pageDashboardJs).toContain('studentDebtMap[normStudentNIS] = totalStudentDebt;');
            expect(pageDashboardJs).toContain('studentDebtMap,');
            expect(pageDashboardJs).toContain('paidRecords');
        });
    });

    describe('3. Hak Akses Penuh 24/7 Kepala Sekolah pada Halaman Ranking Kelas', () => {
        test('isRankingKelasAllowedForUser di global.js mengecualikan kepala_sekolah dari blokir dinamis', () => {
            expect(globalJs).toContain("if (allRoles.includes('super_admin') || allRoles.includes('kepala_sekolah')) return true;");
        });

        test('checkUserRankingPermission di js/page-ranking-kelas.js memberikan izin mutlak kepada kepala_sekolah', () => {
            expect(pageRankingJs).toContain("if (allRoles.includes('super_admin') || allRoles.includes('kepala_sekolah')) return true;");
        });

        test('Jadwal pembatasan waktu (WITA) mengecualikan Kepala Sekolah sebagai privileged access', () => {
            expect(pageRankingJs).toContain("const isKepalaSekolah = allRoles.includes('kepala_sekolah');");
            expect(pageRankingJs).toContain("const isPrivilegedAccess = isSuperAdmin || isKepalaSekolah;");
            expect(pageRankingJs).toContain("if (!scheduleInfo.isOpen && !isPrivilegedAccess)");
            expect(pageRankingJs).toContain("if (!scheduleInfo.isOpen && isPrivilegedAccess)");
        });

        test('Banner status jadwal di ranking-kelas.html memuat span id super-admin-banner-title untuk penyesuaian pimpinan', () => {
            expect(rankingHtml).toContain('id="super-admin-banner-title"');
            expect(pageRankingJs).toContain("Akses Penuh Kepala Sekolah Aktif:");
        });

        test('Menyimpan simas_class_ranking_summary_cache pada recomputeRankings untuk konsistensi SSOT', () => {
            expect(pageRankingJs).toContain("localStorage.setItem('simas_class_ranking_summary_cache'");
            expect(pageRankingJs).toContain("sessionStorage.setItem('simas_class_ranking_summary_cache'");
        });

        test('scripts/sync-version.js memuat canonical page script untuk dashboard.html', () => {
            const syncVersionJs = fs.readFileSync(path.join(__dirname, '../scripts/sync-version.js'), 'utf8');
            expect(syncVersionJs).toContain("'dashboard.html': 'js/page-dashboard.js'");
        });
    });
});

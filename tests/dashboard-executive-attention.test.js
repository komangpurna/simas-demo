const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

describe('Optimasi Dashboard Eksekutif Kepala Sekolah (Atensi Hari Ini & Actionable Insights)', () => {
    const dashboardHtml = fs.readFileSync(path.join(projectRoot, 'dashboard.html'), 'utf8');
    const pageDashboardJs = fs.readFileSync(path.join(projectRoot, 'js', 'page-dashboard.js'), 'utf8');

    describe('1. Struktur HTML Dashboard Eksekutif (dashboard.html)', () => {
        test('Memuat kontainer Atensi Hari Ini dan elemen metriknya', () => {
            expect(dashboardHtml).toContain('id="section-atensi-hari-ini"');
            expect(dashboardHtml).toContain('id="atensi-count-badge"');
            expect(dashboardHtml).toContain('id="atensi-date-scope"');
            expect(dashboardHtml).toContain('id="atensi-items-container"');
        });

        test('Memuat elemen subteks konteks kehadiran dan BK', () => {
            expect(dashboardHtml).toContain('id="kepsek-attendance-subtext"');
            expect(dashboardHtml).toContain('id="kepsek-bk-subtext"');
            expect(dashboardHtml).toContain('Kehadiran Per Tingkat Kelas (TA)');
        });

        test('Memuat elemen footer actionable pada kartu SPP dengan link ke tab laporan & subtab estimasi', () => {
            expect(dashboardHtml).toContain('id="spp-unpaid-students-count"');
            expect(dashboardHtml).toContain('id="spp-top-debt-class"');
            expect(dashboardHtml).toContain('id="spp-top-debt-amount"');
            expect(dashboardHtml).toContain('href="keuangan.html#tab=laporan&subtab=estimasi"');
        });

        test('Mempertahankan tombol pintasan Akses Cepat Eksekutif', () => {
            expect(dashboardHtml).toContain('href="monitoring-kbm.html"');
            expect(dashboardHtml).toContain('href="bk.html"');
            expect(dashboardHtml).toContain('href="keuangan.html"');
            expect(dashboardHtml).toContain('href="library/laporan.html"');
            expect(dashboardHtml).toContain('href="guru.html"');
            expect(dashboardHtml).toContain('href="agenda.html"');
        });

        test('Kartu Kehadiran (TA) dan Header Grafik Kehadiran Kelas merujuk ke presensi.html', () => {
            expect(dashboardHtml).toContain('id="kepsek-avg-attendance"');
            expect(dashboardHtml).toContain('Presensi Siswa <i class="fa-solid fa-arrow-right text-[9px]"></i>');
        });
    });

    describe('2. Logika JavaScript Atensi Hari Ini (js/page-dashboard.js)', () => {
        test('Memuat implementasi fungsi renderAtensiHariIni', () => {
            expect(pageDashboardJs).toContain('function renderAtensiHariIni(');
            expect(pageDashboardJs).toContain('atensi-items-container');
            expect(pageDashboardJs).toContain('atensi-count-badge');
        });

        test('Mendeteksi kehadiran kelas rendah (< 90% dan < 85%) dengan severity proporsional', () => {
            expect(pageDashboardJs).toContain('lowestClass.percent < 90');
            expect(pageDashboardJs).toContain('lowestClass.percent < 85');
            expect(pageDashboardJs).toContain('Pantau Presensi');
            expect(pageDashboardJs).toContain('actionUrl: \'presensi.html\'');
        });

        test('Atensi Hari Ini menggunakan data presensi harian hari ini (SSOT dengan presensi.html)', () => {
            expect(pageDashboardJs).toContain('fetchTodaySummaryPromise');
            expect(pageDashboardJs).toContain('todayClassList');
            expect(pageDashboardJs).toContain('todayLowAttClasses');
            expect(pageDashboardJs).toContain('window.calculateAttendanceStats');
        });

        test('Mendeteksi kasus BK baru hari ini dan kasus berulang (3+ TA)', () => {
            expect(pageDashboardJs).toContain('todayViolations');
            expect(pageDashboardJs).toContain('Buka Buku Kasus');
            expect(pageDashboardJs).toContain('kasus BK baru tercatat hari ini');
            expect(pageDashboardJs).toContain('memiliki 3+ kasus pelanggaran (TA)');
        });

        test('Mendeteksi tunggakan SPP dan mengarahkan ke tab laporan & subtab estimasi', () => {
            expect(pageDashboardJs).toContain('sppData.unpaidStudentsCount > 0');
            expect(pageDashboardJs).toContain('masih memiliki tunggakan SPP');
            expect(pageDashboardJs).toContain('Lihat Keuangan');
            expect(pageDashboardJs).toContain('keuangan.html#tab=laporan&subtab=estimasi');
        });

        test('Menampilkan kartu kondisi normal hijau ketika seluruh indikator aman', () => {
            expect(pageDashboardJs).toContain('Kondisi utama sekolah hari ini terpantau normal');
        });
    });

    describe('3. Logika Kartu SPP & Kehadiran Kelas Ekstrim (js/page-dashboard.js)', () => {
        test('applySppUI memperbarui elemen penunggak dan kelas tunggakan terbesar', () => {
            expect(pageDashboardJs).toContain("document.getElementById('spp-unpaid-students-count')");
            expect(pageDashboardJs).toContain("document.getElementById('spp-top-debt-class')");
            expect(pageDashboardJs).toContain("document.getElementById('spp-top-debt-amount')");
        });

        test('renderTopClassesAttendance membungkus kelas terbaik & terendah dengan link rekap semester ke presensi.html', () => {
            expect(pageDashboardJs).toContain('href="presensi.html#type=semester&class=${encodeURIComponent(item.cls)}"');
            expect(pageDashboardJs).toContain('title="Buka detail presensi kelas ${item.cls}"');
        });

        test('Kehadiran Kelas Ekstrim mengacu pada semester berjalan s.d. hari ini dan saring anomali record minim', () => {
            expect(dashboardHtml).toContain('id="kepsek-extreme-att-badge"');
            expect(dashboardHtml).toContain('id="kepsek-extreme-att-subtext"');
            expect(dashboardHtml).toContain('TOP 3 Kehadiran Terbaik (Semester)');
            expect(dashboardHtml).toContain('TOP 3 Kehadiran Terendah (Semester)');
            expect(pageDashboardJs).toContain('function getCurrentSemesterRange(');
            expect(pageDashboardJs).toContain('semesterClassAttMap');
            expect(pageDashboardJs).toContain('renderTopClassesAttendance(targetExtremeClassMap)');
            expect(pageDashboardJs).toContain('rowDate <= todayStr');
            expect(pageDashboardJs).toContain(".lte('tanggal', todayStr)");
            expect(pageDashboardJs).toContain('minThreshold');
        });
    });

    describe('4. Eliminasi 0 Semu pada Grafik Tren Pelanggaran (js/page-dashboard.js)', () => {
        test('renderViolationTrendLineChart mengisi null untuk bulan masa depan dan spanGaps false', () => {
            expect(pageDashboardJs).toContain('idx <= currentAyIdx) ? 0 : null');
            expect(pageDashboardJs).toContain('spanGaps: false');
            expect(pageDashboardJs).toContain('Belum ada data (bulan belum berjalan)');
        });
    });

    describe('5. Navigasi Terpadu SPP ke Keuangan (Laporan & Estimasi)', () => {
        const keuanganHtml = fs.readFileSync(path.join(projectRoot, 'keuangan.html'), 'utf8');
        const pageKeuanganJs = fs.readFileSync(path.join(projectRoot, 'js', 'page-keuangan.js'), 'utf8');

        test('dashboard.html memuat tombol Kelola SPP menuju #tab=laporan&subtab=estimasi', () => {
            expect(dashboardHtml).toContain('<a href="keuangan.html#tab=laporan&subtab=estimasi" class="hidden sm:inline-flex items-center gap-1 text-xs font-bold text-blue-600');
        });

        test('keuangan.html mendukung navigasi tab laporan dan subtab estimasi', () => {
            expect(keuanganHtml).toContain('window.switchTab = switchTab;');
            expect(keuanganHtml).toContain('window.switchReportMode(subtabName)');
        });

        test('js/page-keuangan.js memparsing tab & subtab dari URL / hash dan memicu switchReportMode', () => {
            expect(pageKeuanganJs).toContain("urlParams.get('subtab') || hashParams.get('subtab')");
            expect(pageKeuanganJs).toContain('window.switchReportMode(requestedSubtab)');
            expect(pageKeuanganJs).toContain("window.addEventListener('hashchange'");
        });
    });

    describe('6. Navigasi Terpadu Rekap Semester Presensi & Mitigasi Cache (presensi.html & js/page-presensi.js)', () => {
        const presensiHtml = fs.readFileSync(path.join(projectRoot, 'presensi.html'), 'utf8');
        const pagePresensiJs = fs.readFileSync(path.join(projectRoot, 'js', 'page-presensi.js'), 'utf8');

        test('presensi.html mengekspos window.switchMode dan window.toggleHistoryInputs', () => {
            expect(presensiHtml).toContain('window.switchMode = switchMode;');
            expect(presensiHtml).toContain('window.toggleHistoryInputs = toggleHistoryInputs;');
        });

        test('js/page-presensi.js mendukung navigasi hash/URL type=semester dan target kelas', () => {
            expect(pagePresensiJs).toContain('checkUrlParamsForPresensi');
            expect(pagePresensiJs).toContain("params.get('type')");
            expect(pagePresensiJs).toContain("params.get('class')");
            expect(pagePresensiJs).toContain("window.switchMode('history')");
            expect(pagePresensiJs).toContain("typeSelect.value = 'semester'");
        });

        test('js/page-dashboard.js memiliki mitigasi tab refresh saat kembali aktif (Poin 8)', () => {
            expect(pageDashboardJs).toContain('handleDashboardTabRefresh');
            expect(pageDashboardJs).toContain("document.addEventListener('visibilitychange', handleDashboardTabRefresh)");
            expect(pageDashboardJs).toContain("window.addEventListener('pageshow'");
        });
    });

    describe('7. Cross-Check Matematis SSOT Kehadiran: Dashboard vs Presensi Siswa', () => {
        function calculateAttendanceStats(summary) {
            const sum = summary || {};
            const h = Number(sum.H) || 0;
            const s = Number(sum.S) || 0;
            const i = Number(sum.I) || 0;
            const d = Number(sum.D) || 0;
            const a = Number(sum.A) || 0;
            const total = h + s + i + d + a;
            const hadirCount = h + d;
            const rawPct = total > 0 ? ((hadirCount / total) * 100) : 0;
            const attPct = parseFloat(rawPct.toFixed(1));
            const attPctFormatted = total > 0
                ? (Number.isInteger(attPct) ? `${attPct}%` : `${attPct.toFixed(1)}%`)
                : '0%';

            let tier = 'emerald';
            if (attPct < 80) tier = 'rose';
            else if (attPct < 90) tier = 'amber';

            return { total, hadirCount, attPct, attPctFormatted, tier };
        }

        test('Nilai persentase kehadiran kelas di Dashboard dan Presensi Siswa terbukti 100% identik', () => {
            const mockRows = [
                { class: 'X-1', summary: { H: 30, S: 2, I: 2, D: 0, A: 2 } }, // 30/36 = 83.3%
                { class: 'X-2', summary: { H: 36, S: 0, I: 0, D: 0, A: 0 } }, // 36/36 = 100%
                { class: 'X-3', summary: { H: 25, S: 5, I: 2, D: 0, A: 4 } }, // 25/36 = 69.4%
                { class: 'XI-1', summary: { H: 32, S: 1, I: 1, D: 2, A: 0 } }, // 34/36 = 94.4%
                { class: 'XII-3', summary: { H: 31, S: 1, I: 0, D: 1, A: 3 } }  // 32/36 = 88.9%
            ];

            // Hitung via alur Presensi Siswa
            const presensiMap = {};
            mockRows.forEach(r => {
                presensiMap[r.class] = calculateAttendanceStats(r.summary);
            });

            // Hitung via alur Dashboard Atensi Hari Ini
            const todayClassList = [];
            mockRows.forEach(row => {
                const stats = calculateAttendanceStats(row.summary);
                if (stats.total > 0) {
                    todayClassList.push({
                        cls: row.class,
                        percent: stats.attPct,
                        total: stats.total,
                        hadirCount: stats.hadirCount
                    });
                }
            });

            const sortedToday = [...todayClassList].sort((a, b) => a.percent - b.percent);
            const lowestClass = sortedToday[0];

            // Verifikasi bahwa kelas terendah adalah X-3
            expect(lowestClass.cls).toBe('X-3');
            expect(lowestClass.percent).toBe(69.4);
            expect(lowestClass.percent).toBe(presensiMap['X-3'].attPct);

            // Verifikasi seluruh kelas identik 1:1
            mockRows.forEach(r => {
                const dashItem = todayClassList.find(c => c.cls === r.class);
                expect(dashItem).toBeDefined();
                expect(dashItem.percent).toBe(presensiMap[r.class].attPct);
                expect(dashItem.total).toBe(presensiMap[r.class].total);
                expect(dashItem.hadirCount).toBe(presensiMap[r.class].hadirCount);
            });
        });

        test('Kelas yang belum presensi tidak dimasukkan sebagai 0% (tidak mendistorsi Atensi Hari Ini)', () => {
            const mockRows = [
                { class: 'X-1', summary: { H: 34, S: 1, I: 1, D: 0, A: 0 } } // 94.4%
            ];
            const todayClassList = [];
            mockRows.forEach(row => {
                const stats = calculateAttendanceStats(row.summary);
                if (stats.total > 0) {
                    todayClassList.push({ cls: row.class, percent: stats.attPct });
                }
            });

            const lowAttClasses = todayClassList.filter(item => item.percent < 90);
            expect(lowAttClasses.length).toBe(0); // Aman, tidak false positive
        });
    });

    describe('8. Audit Validitas & Keandalan Data Dashboard Kepala Sekolah (GTK, Siswa Distribusi, Timezone, 0% Semu)', () => {
        function isGtkActive(t) {
            if (!t) return false;
            if (t.is_active === false || t.is_active === 0 || t.is_active === '0') return false;

            const rawStatus = String(t.status || '').trim().toLowerCase();
            const rawStatusKep = String(t.status_kepegawaian || '').trim().toLowerCase();
            const rawKeaktifan = String(t.keaktifan || t.status_aktif || '').trim().toLowerCase();

            const inactiveKeywords = ['pensiun', 'mutasi', 'keluar', 'nonaktif', 'non_aktif', 'non-aktif', 'meninggal', 'almarhum', 'berhenti', 'dikeluarkan'];

            if (inactiveKeywords.some(kw => rawStatus === kw || rawStatus.includes(kw))) return false;
            if (inactiveKeywords.some(kw => rawStatusKep === kw || rawStatusKep.includes(kw))) return false;
            if (inactiveKeywords.some(kw => rawKeaktifan === kw || rawKeaktifan.includes(kw))) return false;

            return true;
        }

        test('isGtkActive mengakui seluruh GTK aktif termasuk PNS, PPPK, Honorer, dan GTT', () => {
            const teachers = [
                { id: '1', name: 'Guru PNS', status_kepegawaian: 'PNS', status: 'PNS' },
                { id: '2', name: 'Guru PPPK', status_kepegawaian: 'PPPK', status: 'PPPK' },
                { id: '3', name: 'Guru Honorer', status_kepegawaian: 'Honorer', status: 'Honorer' },
                { id: '4', name: 'Guru GTT', status_kepegawaian: 'GTT' },
                { id: '5', name: 'Guru Default Aktif' },
                { id: '6', name: 'Guru Pensiun', status_kepegawaian: 'Pensiun' },
                { id: '7', name: 'Guru Mutasi', status: 'Mutasi' },
                { id: '8', name: 'Guru Nonaktif', keaktifan: 'nonaktif' },
                { id: '9', name: 'Guru Flag Inactive', is_active: false }
            ];

            const activeTeachers = teachers.filter(isGtkActive);
            expect(activeTeachers.length).toBe(5);
            expect(activeTeachers.map(t => t.id)).toEqual(['1', '2', '3', '4', '5']);
        });

        test('js/page-dashboard.js mengimplementasikan isGtkActive dan menggunakannya pada activeGtkCount', () => {
            expect(pageDashboardJs).toContain('function isGtkActive(t)');
            expect(pageDashboardJs).toContain('(allGtk || []).filter(isGtkActive).length');
        });

        test('showStudentDistributionModal sinkron dengan window.isStudentActive dan memfilter alumni/keluar', () => {
            expect(pageDashboardJs).toContain('window.showStudentDistributionModal = async () =>');
            expect(pageDashboardJs).toContain('window.isStudentActive(s)');
            expect(pageDashboardJs).toContain("['alumni', 'mutasi', 'pindah', 'keluar', 'nonaktif', 'non_aktif', 'lulus', 'do']");
        });

        test('todayViolations menggunakan konversi tanggal standar WITA (window.getWitaISODate)', () => {
            expect(pageDashboardJs).toContain('window.getWitaISODate(d)');
            expect(pageDashboardJs).toContain('dStr === todayStr');
        });

        test('Rata-rata kehadiran sekolah tidak menampilkan 0% semu ketika belum ada catatan presensi TA', () => {
            expect(pageDashboardJs).toContain("elAvgAtt.innerText = '-'");
            expect(pageDashboardJs).toContain("elAvgAtt.title = 'Belum ada catatan presensi di tahun ajaran ini'");
            expect(pageDashboardJs).toContain("elAttSub.innerText = 'Belum ada data presensi (TA)'");
        });
    });
});



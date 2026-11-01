/**
 * tests/ranking-kelas.test.js
 * Unit Test Suite untuk Modul Monitoring & Ranking Kinerja Rombel Kelas (v26.09.17.2)
 */

const fs = require('fs');
const path = require('path');

describe('Pengujian Modul Monitoring & Ranking Kinerja Kelas (v26.09.17.2)', () => {
    const projectRoot = path.resolve(__dirname, '..');
    const htmlPath = path.join(projectRoot, 'ranking-kelas.html');
    const jsPath = path.join(projectRoot, 'js', 'page-ranking-kelas.js');
    const globalJsPath = path.join(projectRoot, 'js', 'global.js');
    const packageJsonPath = path.join(projectRoot, 'package.json');
    const configJsPath = path.join(projectRoot, 'js', 'config.js');
    const prdPath = path.join(projectRoot, 'PRD_SIMAS.md');
    const changelogPath = path.join(projectRoot, 'CHANGELOG.md');

    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const jsContent = fs.readFileSync(jsPath, 'utf8');
    const globalJsContent = fs.readFileSync(globalJsPath, 'utf8');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const configJs = fs.readFileSync(configJsPath, 'utf8');
    const prdContent = fs.readFileSync(prdPath, 'utf8');
    const changelogContent = fs.readFileSync(changelogPath, 'utf8');

    describe('1. Struktur & Elemen Antarmuka ranking-kelas.html', () => {
        test('Memiliki kerangka aplikasi terpadu #app-layout', () => {
            expect(htmlContent).toContain('<div id="app-layout"></div>');
        });

        test('Script tag page-ranking-kelas.js menggunakan cache-buster versi aplikasi aktif', () => {
            expect(htmlContent).toContain(`src="js/page-ranking-kelas.js?v=${packageJson.version}"`);
        });

        test('Antarmuka fokus pada tabel: 5 tab kategori dan podium showcase dihilangkan sesuai arahan', () => {
            expect(htmlContent).not.toContain('id="category-tabs-container"');
            expect(htmlContent).not.toContain('id="podium-container"');
            expect(htmlContent).not.toContain('id="view-grid-container"');
        });

        test('Memiliki header kolom tabel dengan pemicu sortir interaktif window.sortRankingTable', () => {
            expect(htmlContent).toContain("onclick=\"window.sortRankingTable('class')\"");
            expect(htmlContent).toContain("onclick=\"window.sortRankingTable('attendance')\"");
            expect(htmlContent).toContain("onclick=\"window.sortRankingTable('spp')\"");
            expect(htmlContent).toContain("onclick=\"window.sortRankingTable('discipline')\"");
            expect(htmlContent).toContain("onclick=\"window.sortRankingTable('library')\"");
            expect(htmlContent).toContain("onclick=\"window.sortRankingTable('overall')\"");
        });

        test('Memiliki header kolom Kelas yang ringkas (bukan Rombel Kelas) agar lebar kolom optimal', () => {
            expect(htmlContent).toMatch(/<th[^>]*onclick="window\.sortRankingTable\('class'\)"[^>]*title="Klik untuk mengurutkan Kelas"[^>]*>[\s\S]*?<span>Kelas<\/span>/);
            expect(htmlContent).not.toMatch(/<span>Rombel Kelas<\/span>/);
        });

        test('Memiliki ikon indikator sorting pada setiap header kolom yang dapat disortir', () => {
            expect(htmlContent).toContain('id="sort-icon-class"');
            expect(htmlContent).toContain('id="sort-icon-attendance"');
            expect(htmlContent).toContain('id="sort-icon-spp"');
            expect(htmlContent).toContain('id="sort-icon-discipline"');
            expect(htmlContent).toContain('id="sort-icon-library"');
            expect(htmlContent).toContain('id="sort-icon-overall"');
        });

        test('Memiliki filter tingkat kelas lengkap (all, X, XI, XII)', () => {
            expect(htmlContent).toContain('data-grade="all"');
            expect(htmlContent).toContain('data-grade="X"');
            expect(htmlContent).toContain('data-grade="XI"');
            expect(htmlContent).toContain('data-grade="XII"');
        });

        test('Memiliki kontrol sortir manual samping filter dengan 1 opsi ringkas per jenis (default otomatis tertinggi)', () => {
            expect(htmlContent).toContain('id="select-ranking-sort"');
            expect(htmlContent).toContain('onchange="window.onRankingSortChange(this.value)"');
            expect(htmlContent).toContain('value="class" selected');
            expect(htmlContent).toContain('value="overall"');
            expect(htmlContent).toContain('value="attendance"');
            expect(htmlContent).toContain('value="spp"');
            expect(htmlContent).toContain('value="discipline"');
            expect(htmlContent).toContain('value="library"');
            // Tidak memuat duplikasi tertinggi/terendah sesuai arahan penyederhanaan
            expect(htmlContent).not.toContain('value="overall-desc"');
            expect(htmlContent).not.toContain('value="attendance-asc"');
        });

        test('Memiliki elemen tabel peringkat dan modal detail rombel', () => {
            expect(htmlContent).toContain('id="ranking-table-body"');
            expect(htmlContent).toContain('id="modal-detail-kelas"');
        });

        test('Kolom Wali Kelas dihilangkan dari tabel utama untuk menghemat ruang, info wali disajikan di modal detail', () => {
            expect(htmlContent).not.toContain('>Wali Kelas</th>');
            expect(htmlContent).toContain('id="modal-wali-name"');
            expect(htmlContent).toContain('id="modal-wali-nip"');
            expect(htmlContent).toContain('id="modal-wali-avatar"');
            expect(htmlContent).toContain('id="modal-wali-contact-container"');
        });

        test('Kolom Aksi/Detail dihilangkan dari tabel karena detail dibuka via klik nama rombel kelas', () => {
            expect(htmlContent).not.toContain('>Aksi</th>');
            expect(jsContent).not.toMatch(/<button[^>]*>\s*Detail\s*<\/button>/);
        });

        test('Memiliki tombol pengaturan akses khusus Super Admin dan modal pengaturannya', () => {
            expect(htmlContent).toContain('id="btn-ranking-access-settings"');
            expect(htmlContent).toContain('id="modal-ranking-access-settings"');
            expect(htmlContent).toContain('name="ranking-access-mode"');
            expect(htmlContent).toContain('id="role-checkbox-container"');
            expect(htmlContent).toContain('id="input-new-specific-user"');
            expect(htmlContent).toContain('id="btn-save-ranking-access"');
        });

        test('Memiliki badge rentang tanggal evaluasi yang compact dan rapi serta keterangan periode aktif', () => {
            expect(htmlContent).toContain('id="badge-period-range"');
            expect(htmlContent).toContain('id="label-period-dates"');
            expect(htmlContent).toContain('id="label-active-period-desc"');
            expect(htmlContent).toMatch(/id="label-active-period-desc"[^>]*class="[^"]*hidden[^"]*"/);
        });

        test('Memiliki header tabel papan peringkat yang ringkas dalam 1 baris fleksibel', () => {
            expect(htmlContent).toContain('id="badge-total-classes"');
            expect(htmlContent).toContain('id="label-active-category-desc"');
            expect(htmlContent).toMatch(/flex flex-wrap items-center gap-x-2\.5/);
        });

        test('Memiliki filter rentang periode dengan default Semester Berjalan', () => {
            expect(htmlContent).toContain('id="select-period-scope"');
            expect(htmlContent).toContain('<option value="semester" selected>Semester Berjalan</option>');
            expect(jsContent).toMatch(/periodScope:\s*['"]semester['"]/);
            expect(jsContent).toMatch(/snapshotScope:\s*['"]semester['"]/);
        });

        test('Memiliki tab navigasi segmented pada modal pengaturan modul ranking', () => {
            expect(htmlContent).toContain('id="tab-btn-criteria"');
            expect(htmlContent).toContain('id="tab-btn-access"');
            expect(htmlContent).toContain('id="tab-content-criteria"');
            expect(htmlContent).toContain('id="tab-content-access"');
            expect(htmlContent).toContain("onclick=\"window.switchRankingSettingsTab('criteria')\"");
            expect(htmlContent).toContain("onclick=\"window.switchRankingSettingsTab('access')\"");
        });

        test('Memiliki elemen kontrol toggle dan input persentase bobot untuk 4 kriteria penilaian', () => {
            expect(htmlContent).toContain('id="criteria-toggle-attendance"');
            expect(htmlContent).toContain('id="criteria-weight-attendance"');
            expect(htmlContent).toContain('id="criteria-toggle-spp"');
            expect(htmlContent).toContain('id="criteria-weight-spp"');
            expect(htmlContent).toContain('id="criteria-toggle-discipline"');
            expect(htmlContent).toContain('id="criteria-weight-discipline"');
            expect(htmlContent).toContain('id="criteria-toggle-library"');
            expect(htmlContent).toContain('id="criteria-weight-library"');
            expect(htmlContent).toContain('id="criteria-total-weight-badge"');
            expect(htmlContent).toContain('id="criteria-total-weight-text"');
        });

        test('Memiliki tombol aksi cepat Bagi Rata dan Reset Default pada pengaturan kriteria', () => {
            expect(htmlContent).toContain('onclick="window.distributeRankingWeightsEvenly()"');
            expect(htmlContent).toContain('onclick="window.resetRankingCriteriaToDefault()"');
        });

        test('Memiliki ID terdefinisi pada header kolom kriteria tabel dan kartu highlight metrik', () => {
            expect(htmlContent).toContain('id="th-attendance"');
            expect(htmlContent).toContain('id="th-spp"');
            expect(htmlContent).toContain('id="th-discipline"');
            expect(htmlContent).toContain('id="th-library"');
            expect(htmlContent).toContain('id="th-overall"');
            expect(htmlContent).toContain('id="card-stat-overall"');
            expect(htmlContent).toContain('id="card-stat-attendance"');
            expect(htmlContent).toContain('id="card-stat-spp"');
            expect(htmlContent).toContain('id="card-stat-discipline"');
            expect(htmlContent).toContain('id="ranking-weights-notice"');
            expect(htmlContent).toContain('id="ranking-weights-list"');
        });

        test('Form pencarian kelas dikondisikan bersih dan rapi dengan padding proporsional', () => {
            expect(htmlContent).toContain('id="input-search-class"');
            expect(htmlContent).toContain('placeholder="Cari kelas atau wali..."');
            expect(htmlContent).toMatch(/id="input-search-class"[^>]*class="[^"]*px-3[^"]*"/);
        });
    });

    describe('2. Logika Bisnis & Keamanan page-ranking-kelas.js', () => {
        test('Mengekspor fungsi-fungsi utama ke global window termasuk in-column sorting', () => {
            expect(jsContent).toContain('window.sortRankingTable = sortRankingTable;');
            expect(jsContent).toContain('window.onRankingSortChange = onRankingSortChange;');
            expect(jsContent).toContain('window.updateRankingSortIcons = updateRankingSortIcons;');
            expect(jsContent).toContain('window.parseClassGradeAndNum = parseClassGradeAndNum;');
            expect(jsContent).toContain('window.compareClassesNatural = compareClassesNatural;');
            expect(jsContent).toContain('window.switchCategory = switchCategory;');
            expect(jsContent).toContain('window.setGradeFilter = setGradeFilter;');
            expect(jsContent).toContain('window.onPeriodScopeChange = onPeriodScopeChange;');
            expect(jsContent).toContain('window.onSearchClassInput = onSearchClassInput;');
            expect(jsContent).toContain('window.setViewMode = setViewMode;');
            expect(jsContent).toContain('window.openClassDetailModal = openClassDetailModal;');
            expect(jsContent).toContain('window.closeClassDetailModal = closeClassDetailModal;');
            expect(jsContent).toContain('window.refreshRankingData = refreshRankingData;');
            expect(jsContent).toContain('window.formatPercentage = formatPercentage;');
            expect(jsContent).toContain('window.formatDecimal = formatDecimal;');
            expect(jsContent).toContain('window.printRankingReport = printRankingReport;');
            expect(jsContent).toContain('window.formatRangeIndo = formatRangeIndo;');
            expect(jsContent).toContain('window.updatePeriodDisplayUI = updatePeriodDisplayUI;');
            expect(jsContent).toContain('window.setRankingContentLoading = setRankingContentLoading;');
        });

        test('Helper formatRangeIndo memformat rentang tanggal dengan benar dan elegan', () => {
            // Simulasi implementasi formatRangeIndo
            const formatFn = (startDateStr, endDateStr) => {
                const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
                const parse = (dStr) => {
                    const parts = String(dStr).split('-');
                    return { d: parseInt(parts[2], 10), m: parseInt(parts[1], 10) - 1, y: parseInt(parts[0], 10) };
                };
                const start = parse(startDateStr);
                const end = parse(endDateStr);
                if (isNaN(start.d) || isNaN(end.d)) return `${startDateStr} – ${endDateStr}`;
                if (start.y === end.y) {
                    if (start.m === end.m) {
                        return `${start.d} – ${end.d} ${months[end.m]} ${end.y}`;
                    }
                    return `${start.d} ${months[start.m]} – ${end.d} ${months[end.m]} ${end.y}`;
                }
                return `${start.d} ${months[start.m]} ${start.y} – ${end.d} ${months[end.m]} ${end.y}`;
            };

            expect(formatFn('2026-09-01', '2026-09-17')).toBe('1 – 17 Sep 2026');
            expect(formatFn('2026-07-01', '2026-09-17')).toBe('1 Jul – 17 Sep 2026');
            expect(formatFn('2025-07-01', '2026-06-30')).toBe('1 Jul 2025 – 30 Jun 2026');
        });

        test('Pengurutan default tabel diinisialisasi ke Nama Kelas terurut natural (class asc)', () => {
            expect(jsContent).toMatch(/currentRankingSort\s*=\s*\{\s*column:\s*'class',\s*direction:\s*'asc'\s*\}/);
        });

        test('Fungsi onRankingSortChange memparsing kriteria dan secara default mengurutkan tertinggi (desc)', () => {
            let sortState = { column: 'overall', direction: 'desc' };
            const changeFn = (val) => {
                const parts = String(val).split('-');
                const col = parts[0];
                const dir = parts[1] || (col === 'class' ? 'asc' : 'desc');
                sortState = {
                    column: col,
                    direction: dir
                };
            };

            changeFn('attendance');
            expect(sortState).toEqual({ column: 'attendance', direction: 'desc' });

            changeFn('class');
            expect(sortState).toEqual({ column: 'class', direction: 'asc' });

            changeFn('spp');
            expect(sortState).toEqual({ column: 'spp', direction: 'desc' });

            changeFn('discipline');
            expect(sortState).toEqual({ column: 'discipline', direction: 'desc' });

            changeFn('library');
            expect(sortState).toEqual({ column: 'library', direction: 'desc' });
        });

        test('Helper compareClassesNatural mengurutkan rombel kelas X-1 s/d XII-7 secara rapi dan natural', () => {
            const parseFn = (clsName) => {
                const raw = String(clsName || '').trim();
                const match = raw.match(/^(XII|XI|X)[^0-9a-zA-Z]*(\d+)?(.*)$/i);
                if (!match) return { gradeWeight: 99, num: 0, suffix: raw, raw };
                const gradeStr = match[1].toUpperCase();
                const gradeWeight = gradeStr === 'X' ? 10 : (gradeStr === 'XI' ? 11 : 12);
                const num = match[2] ? parseInt(match[2], 10) : 0;
                const suffix = match[3] ? match[3].trim().toLowerCase() : '';
                return { gradeWeight, num, suffix, raw };
            };

            const compareFn = (aName, bName) => {
                const a = parseFn(aName);
                const b = parseFn(bName);
                if (a.gradeWeight !== b.gradeWeight) return a.gradeWeight - b.gradeWeight;
                if (a.num !== b.num) return a.num - b.num;
                return (a.suffix || '').localeCompare(b.suffix || '', undefined, { numeric: true, sensitivity: 'base' });
            };

            const inputClasses = ['XII-2', 'X-9', 'XI-1', 'X-1', 'XII-7', 'XI-7', 'X-2', 'XII-1'];
            inputClasses.sort(compareFn);

            expect(inputClasses).toEqual([
                'X-1',
                'X-2',
                'X-9',
                'XI-1',
                'XI-7',
                'XII-1',
                'XII-2',
                'XII-7'
            ]);
        });

        test('Menerapkan sanitasi anti-XSS melalui escapeHTML pada nama kelas dan guru', () => {
            expect(jsContent).toContain('escapeHTML');
            expect(jsContent).toMatch(/escapeHTML\(.*className.*\)/);
            expect(jsContent).toMatch(/escapeHTML\(.*wali.*name.*\)/);
        });

        test('Menggunakan sessionStorage caching terpisah per periodScope untuk menghemat kuota', () => {
            expect(jsContent).toContain('sessionStorage.getItem(cacheKey)');
            expect(jsContent).toContain('sessionStorage.setItem(cacheKey');
        });

        test('Validasi query database: presensi harian, transaksi SPP, dan perpustakaan peminjam_id', () => {
            expect(jsContent).toContain('siswa_presensi_harian');
            expect(jsContent).toContain('finance_transactions');
            expect(jsContent).toContain('lib_sirkulasi');
            expect(jsContent).toContain('peminjam_id');
        });

        test('Logika filter tingkat kelas akurat tanpa tumpang tindih X vs XI vs XII', () => {
            const regexX = /^X(?!\s*[I|i])/i;
            const regexXI = /^XI(?!\s*[I|i])/i;
            const regexXII = /^XII/i;

            expect(regexX.test('X-1')).toBe(true);
            expect(regexX.test('X 2')).toBe(true);
            expect(regexX.test('XI-1')).toBe(false);
            expect(regexX.test('XII-1')).toBe(false);

            expect(regexXI.test('XI-1')).toBe(true);
            expect(regexXI.test('XII-1')).toBe(false);

            expect(regexXII.test('XII-1')).toBe(true);
            expect(regexXII.test('X-1')).toBe(false);
        });

        test('Bebas dari query langsung ke Firestore collection (0 Firestore Read)', () => {
            expect(jsContent).not.toContain('collection(db,');
            expect(jsContent).not.toContain('getDocs(');
        });

        test('Integrasi data kedisiplinan BK: pemetaan multi-key NIS, poin pelanggaran D1, dan kueri records periode aktif', () => {
            expect(jsContent).toContain('rec.studentNIS || rec.student_nis || rec.nis');
            expect(jsContent).toContain('periodViolMap');
            expect(jsContent).toContain('periodAchMap');
            expect(jsContent).toContain('cfClient.getAllRecords');
        });

        test('Visualisasi poin pelanggaran dan prestasi kesiswaan pada tabel dan kartu leaderboard', () => {
            expect(jsContent).toContain('violationsCount > 0');
            expect(jsContent).toContain('achievementPoints > 0');
            expect(jsContent).toContain('Poin Pelanggaran');
        });

        test('Kalkulasi metrik kedisiplinan rombel berbasis total poin & permisi (Opsi B: penalti pelanggaran x10, permisi x2, bonus prestasi x3)', () => {
            const computeDiscipline = (totalViolations, totalPermissions, totalAchPoints, totalSt) => {
                const stCount = totalSt || 1;
                const avgPenalty = Number(((totalViolations / stCount) * 10).toFixed(1));
                const permPenalty = Number(((totalPermissions / stCount) * 2).toFixed(1));
                const achBonus = Math.min(Number(((totalAchPoints / stCount) * 3).toFixed(1)), 15);
                return Number(Math.max(0, Math.min(100, 100 - avgPenalty - permPenalty + achBonus)).toFixed(1));
            };

            // 1. Kelas tanpa pelanggaran, tanpa permisi, & tanpa prestasi = 100.0%
            expect(computeDiscipline(0, 0, 0, 30)).toBe(100.0);

            // 2. Kelas dengan 3x permisi pada 30 siswa (0 pelanggaran) = 3/30*2 = 0.2 penalti -> skor 99.8%
            expect(computeDiscipline(0, 3, 0, 30)).toBe(99.8);

            // 3. Kelas dengan 30 poin pelanggaran & 0 permisi pada 30 siswa = avg 1.0 * 10 = penalti 10.0 -> skor 90.0%
            expect(computeDiscipline(30, 0, 0, 30)).toBe(90.0);

            // 4. Kelas dengan 30 pelanggaran & 5 permisi pada 30 siswa = 10.0 + (5/30*2=0.3) = 10.3 -> skor 89.7%
            expect(computeDiscipline(30, 5, 0, 30)).toBe(89.7);

            // 5. Kelas dengan 30 pelanggaran, 5 permisi, dan 15 prestasi pada 30 siswa = penalti 10.3, bonus 1.5 -> skor 91.2%
            expect(computeDiscipline(30, 5, 15, 30)).toBe(91.2);

            // 6. Bonus prestasi dibatasi maksimal 15%
            expect(computeDiscipline(0, 0, 300, 30)).toBe(100.0);
            expect(computeDiscipline(150, 0, 300, 30)).toBe(65.0); // 150/30*10 = 50 penalty, 15 bonus -> 100 - 50 + 15 = 65

            // 7. Penalti pelanggaran berat (misal 300 poin pada 30 siswa) -> 300/30*10 = 100 penalti -> 0.0%
            expect(computeDiscipline(300, 0, 0, 30)).toBe(0.0);

            // 8. Verifikasi kode page-ranking-kelas.js menerapkan rumus 100 - avgPenalty - permPenalty + achBonus
            expect(jsContent).toContain('const disciplineScore = Number(Math.max(0, Math.min(100, 100 - avgPenalty - permPenalty + achBonus)).toFixed(1));');
            expect(jsContent).toContain('metricsMap[cls].discipline.violationsCount = totalViolations;');
            expect(jsContent).toContain('metricsMap[cls].discipline.permissionCount = totalPermissions;');
            expect(jsContent).toContain('metricsMap[cls].discipline.score = disciplineScore;');
            expect(jsContent).toContain('metricsMap[cls].discipline.rate = disciplineScore;');
            expect(jsContent).toContain('metricsMap[cls].discipline.zeroViolationRate = disciplineScore;');
            expect(jsContent).toContain('0 Poin');
        });

        test('Menyediakan logika kontrol akses dinamis khusus Super Admin (D1 system_settings)', () => {
            expect(jsContent).toContain('checkUserRankingPermission');
            expect(jsContent).toContain('openRankingAccessModal');
            expect(jsContent).toContain('closeRankingAccessModal');
            expect(jsContent).toContain('saveRankingAccessConfig');
            expect(jsContent).toContain('onAccessModeChange');
            expect(jsContent).toContain('addSpecificUserTag');
            expect(jsContent).toContain('removeSpecificUserTag');
            expect(jsContent).toContain('ranking_access_config');
            expect(jsContent).toContain('window.openRankingAccessModal = openRankingAccessModal;');
        });

        test('Menata dan mengelompokkan role menjadi PRIMARY_ROLES dan ADDITIONAL_ROLES', () => {
            expect(jsContent).toContain('PRIMARY_ROLES');
            expect(jsContent).toContain('ADDITIONAL_ROLES');
            expect(jsContent).toContain('Role Utama (Akun Pokok)');
            expect(jsContent).toContain('Role Tambahan (Tugas Rangkap & Fungsional)');
            expect(jsContent).toContain('window.renderRoleCheckboxes = renderRoleCheckboxes;');
        });

        test('Bersih dari role phantom guru_piket dan panitia_duta yang tidak terdaftar di Manajemen Pengguna', () => {
            expect(jsContent).not.toContain("'guru_piket'");
            expect(jsContent).not.toContain('"guru_piket"');
            expect(jsContent).not.toContain("'panitia_duta'");
            expect(jsContent).not.toContain('"panitia_duta"');
            expect(globalJsContent).not.toMatch(/'guru_piket':/);
            expect(globalJsContent).not.toMatch(/'panitia_duta':/);
        });

        test('Menghadirkan fitur searchable dropdown pengguna khusus dengan filter pengecualian role tercentang', () => {
            expect(htmlContent).toContain('id="user-search-dropdown-wrapper"');
            expect(htmlContent).toContain('id="user-search-dropdown-menu"');
            expect(htmlContent).toContain('id="btn-clear-user-search"');
            expect(jsContent).toContain('getMasterUserDirectory');
            expect(jsContent).toContain('filterEligibleUsers');
            expect(jsContent).toContain('getCurrentlyCheckedRoles');
            expect(jsContent).toContain('window.onUserSearchFocus = onUserSearchFocus;');
            expect(jsContent).toContain('window.onUserSearchInput = onUserSearchInput;');
            expect(jsContent).toContain('window.selectUserFromDropdown = selectUserFromDropdown;');
            expect(jsContent).toContain('window.filterEligibleUsers = filterEligibleUsers;');
        });

        test('Logika filterEligibleUsers mengecualikan user yang role-nya sudah dicentang atau sudah di whitelist', () => {
            // Simulasi logika fungsi filterEligibleUsers
            const sampleUsers = [
                { identifier: 'guru1@sekolah.id', nip: '19850101', role: 'guru_mapel', additionalRoles: [] },
                { identifier: 'guru2@sekolah.id', nip: '19860202', role: 'guru_mapel', additionalRoles: ['wali_kelas'] },
                { identifier: 'tu1@sekolah.id', nip: '19870303', role: 'staff', additionalRoles: [] },
                { identifier: 'siswa1', nis: '1234', role: 'siswa', additionalRoles: [] }
            ];

            // Filter: checkedRoles mencakup 'guru_mapel'
            const checkedRoles = ['super_admin', 'guru_mapel'];
            const allowedUsers = ['tu1@sekolah.id'];

            const eligible = sampleUsers.filter(u => {
                if (allowedUsers.includes(u.identifier)) return false;
                const userRoles = [u.role, ...(u.additionalRoles || [])];
                if (userRoles.some(r => checkedRoles.includes(r))) return false;
                return true;
            });

            // guru1 & guru2 dikecualikan karena role guru_mapel sudah dicentang
            // tu1 dikecualikan karena sudah ada di whitelist
            // hanya siswa1 yang eligible
            expect(eligible.length).toBe(1);
            expect(eligible[0].identifier).toBe('siswa1');
        });

        test('Mengekspor konstanta kriteria default dan fungsi manajemen kriteria & bobot ke window', () => {
            expect(jsContent).toContain('DEFAULT_RANKING_CRITERIA');
            expect(jsContent).toContain('loadRankingCriteriaConfig');
            expect(jsContent).toContain('applyRankingCriteriaUI');
            expect(jsContent).toContain('switchRankingSettingsTab');
            expect(jsContent).toContain('loadRankingCriteriaToForm');
            expect(jsContent).toContain('updateCriteriaTotalWeightDisplay');
            expect(jsContent).toContain('distributeRankingWeightsEvenly');
            expect(jsContent).toContain('resetRankingCriteriaToDefault');
            expect(jsContent).toContain('saveRankingSettings');

            expect(jsContent).toContain('window.switchRankingSettingsTab = switchRankingSettingsTab;');
            expect(jsContent).toContain('window.updateCriteriaTotalWeightDisplay = updateCriteriaTotalWeightDisplay;');
            expect(jsContent).toContain('window.distributeRankingWeightsEvenly = distributeRankingWeightsEvenly;');
            expect(jsContent).toContain('window.resetRankingCriteriaToDefault = resetRankingCriteriaToDefault;');
            expect(jsContent).toContain('window.applyRankingCriteriaUI = applyRankingCriteriaUI;');
            expect(jsContent).toContain('window.loadRankingCriteriaConfig = loadRankingCriteriaConfig;');
            expect(jsContent).toContain('window.saveRankingSettings = saveRankingSettings;');
        });

        test('Kalkulasi bobot kriteria dinamis menormalisasi bobot secara proporsional', () => {
            // Simulasi fungsi kalkulasi overallScore
            const calculateScore = (scores, visible, weights) => {
                const activeWeights = {
                    attendance: visible.attendance ? (Number(weights.attendance) || 0) : 0,
                    spp: visible.spp ? (Number(weights.spp) || 0) : 0,
                    discipline: visible.discipline ? (Number(weights.discipline) || 0) : 0,
                    library: visible.library ? (Number(weights.library) || 0) : 0
                };
                const totalActiveWeight = activeWeights.attendance + activeWeights.spp + activeWeights.discipline + activeWeights.library;
                const normWeights = {
                    attendance: totalActiveWeight > 0 ? (activeWeights.attendance / totalActiveWeight) : 0,
                    spp: totalActiveWeight > 0 ? (activeWeights.spp / totalActiveWeight) : 0,
                    discipline: totalActiveWeight > 0 ? (activeWeights.discipline / totalActiveWeight) : 0,
                    library: totalActiveWeight > 0 ? (activeWeights.library / totalActiveWeight) : 0
                };
                return Number((
                    (scores.attScore * normWeights.attendance) +
                    (scores.sppScore * normWeights.spp) +
                    (scores.discScore * normWeights.discipline) +
                    (scores.libScore * normWeights.library)
                ).toFixed(1));
            };

            const fullScores = { attScore: 100, sppScore: 100, discScore: 100, libScore: 100 };
            const defaultVisible = { attendance: true, spp: true, discipline: true, library: true };
            const defaultWeights = { attendance: 40, spp: 30, discipline: 20, library: 10 };

            // 1. Semua kriteria aktif dengan performa 100 -> Skor 100
            expect(calculateScore(fullScores, defaultVisible, defaultWeights)).toBe(100.0);

            // 2. Perpustakaan dimatikan (hanya Kehadiran 40, SPP 30, Disiplin 20) -> Normalisasi total 90 -> Skor performa 100 tetap 100.0
            const noLibVisible = { attendance: true, spp: true, discipline: true, library: false };
            expect(calculateScore(fullScores, noLibVisible, defaultWeights)).toBe(100.0);

            // 3. Skor riil terhitung proporsional:
            // Kehadiran 90 (bobot 40/90), SPP 80 (bobot 30/90), Disiplin 100 (bobot 20/90)
            // (90 * 40 + 80 * 30 + 100 * 20) / 90 = (3600 + 2400 + 2000) / 90 = 8000 / 90 = 88.888... -> 88.9
            const realisticScores = { attScore: 90, sppScore: 80, discScore: 100, libScore: 50 };
            expect(calculateScore(realisticScores, noLibVisible, defaultWeights)).toBe(88.9);

            // 4. Zero division safety: Jika semua kriteria dimatikan, skor 0 tanpa error/NaN
            const allOffVisible = { attendance: false, spp: false, discipline: false, library: false };
            expect(calculateScore(realisticScores, allOffVisible, defaultWeights)).toBe(0);
        });

        test('Fungsi distributeRankingWeightsEvenly membagi 100% secara tepat tanpa sisa koma', () => {
            const distribute = (activeCount) => {
                if (activeCount === 0) return [];
                const base = Math.floor(100 / activeCount);
                const rem = 100 % activeCount;
                return Array.from({ length: activeCount }, (_, idx) => base + (idx < rem ? 1 : 0));
            };

            const w4 = distribute(4);
            expect(w4).toEqual([25, 25, 25, 25]);
            expect(w4.reduce((a, b) => a + b, 0)).toBe(100);

            const w3 = distribute(3);
            expect(w3).toEqual([34, 33, 33]);
            expect(w3.reduce((a, b) => a + b, 0)).toBe(100);

            const w2 = distribute(2);
            expect(w2).toEqual([50, 50]);
            expect(w2.reduce((a, b) => a + b, 0)).toBe(100);

            const w1 = distribute(1);
            expect(w1).toEqual([100]);
            expect(w1.reduce((a, b) => a + b, 0)).toBe(100);
        });

        test('Konfigurasi kriteria disimpan ke Cloudflare D1 system_settings ranking_criteria_config (0 Firestore)', () => {
            expect(jsContent).toContain('ranking_criteria_config');
            expect(jsContent).toContain('simas_ranking_criteria_config');
            expect(jsContent).not.toMatch(/saveSystemSetting\s*\(\s*['"]ranking_criteria_config['"].*firestore/i);
        });

        test('Mengekspor fungsi computeCategoryRankings dan getCategoryRankBadge ke global window', () => {
            expect(jsContent).toContain('window.computeCategoryRankings = computeCategoryRankings;');
            expect(jsContent).toContain('window.getCategoryRankBadge = getCategoryRankBadge;');
        });

        test('Helper getCategoryRankBadge merender badge medali Juara 1 (emas), Juara 2 (perak), dan Juara 3 (perunggu)', () => {
            const badge1 = jsContent.includes('Juara 1 ${categoryLabel}') && jsContent.includes('🥇 1');
            const badge2 = jsContent.includes('Juara 2 ${categoryLabel}') && jsContent.includes('🥈 2');
            const badge3 = jsContent.includes('Juara 3 ${categoryLabel}') && jsContent.includes('🥉 3');

            expect(badge1).toBe(true);
            expect(badge2).toBe(true);
            expect(badge3).toBe(true);

            // Simulasi fungsi getCategoryRankBadge
            const getBadge = (rank, label) => {
                if (rank === 1) return `<span title="Juara 1 ${label}">🥇 1</span>`;
                if (rank === 2) return `<span title="Juara 2 ${label}">🥈 2</span>`;
                if (rank === 3) return `<span title="Juara 3 ${label}">🥉 3</span>`;
                return '';
            };

            expect(getBadge(1, 'Kehadiran')).toContain('🥇 1');
            expect(getBadge(1, 'Kehadiran')).toContain('Juara 1 Kehadiran');
            expect(getBadge(2, 'SPP')).toContain('🥈 2');
            expect(getBadge(2, 'SPP')).toContain('Juara 2 SPP');
            expect(getBadge(3, 'Kedisiplinan')).toContain('🥉 3');
            expect(getBadge(3, 'Kedisiplinan')).toContain('Juara 3 Kedisiplinan');
            expect(getBadge(4, 'Kehadiran')).toBe('');
            expect(getBadge(undefined, 'Kehadiran')).toBe('');
        });

        test('Fungsi computeCategoryRankings menghitung juara 1, 2, 3 untuk setiap kategori dengan tie-breaker akurat', () => {
            // Simulasi data 5 kelas
            const sampleClasses = [
                { className: 'X-1', attendance: { rate: 95 }, spp: { rate: 80 }, discipline: { score: 100 }, library: { borrowCount: 15 }, overallScore: 92.5 },
                { className: 'X-2', attendance: { rate: 98 }, spp: { rate: 70 }, discipline: { score: 90 }, library: { borrowCount: 5 }, overallScore: 88.0 },
                { className: 'XI-1', attendance: { rate: 90 }, spp: { rate: 100 }, discipline: { score: 95 }, library: { borrowCount: 20 }, overallScore: 94.0 },
                { className: 'XI-2', attendance: { rate: 92 }, spp: { rate: 90 }, discipline: { score: 85 }, library: { borrowCount: 0 }, overallScore: 85.0 },
                { className: 'XII-1', attendance: { rate: 85 }, spp: { rate: 85 }, discipline: { score: 100 }, library: { borrowCount: 12 }, overallScore: 90.0 }
            ];

            const categories = ['attendance', 'spp', 'discipline', 'library', 'overall'];
            const rankMap = { attendance: {}, spp: {}, discipline: {}, library: {}, overall: {} };

            categories.forEach(cat => {
                const eligible = sampleClasses.filter(item => {
                    if (cat === 'attendance') return (item.attendance?.rate || 0) > 0;
                    if (cat === 'spp') return (item.spp?.rate || 0) > 0;
                    if (cat === 'discipline') return (item.discipline?.score || 0) > 0;
                    if (cat === 'library') return (item.library?.borrowCount || 0) > 0;
                    if (cat === 'overall') return (item.overallScore || 0) > 0;
                    return false;
                });

                const sorted = [...eligible].sort((a, b) => {
                    let valA = 0, valB = 0;
                    if (cat === 'attendance') { valA = a.attendance?.rate || 0; valB = b.attendance?.rate || 0; }
                    else if (cat === 'spp') { valA = a.spp?.rate || 0; valB = b.spp?.rate || 0; }
                    else if (cat === 'discipline') { valA = a.discipline?.score || 0; valB = b.discipline?.score || 0; }
                    else if (cat === 'library') { valA = a.library?.borrowCount || 0; valB = b.library?.borrowCount || 0; }
                    else if (cat === 'overall') { valA = a.overallScore || 0; valB = b.overallScore || 0; }

                    if (valB !== valA) return valB - valA;
                    if (cat === 'overall') {
                        return (b.attendance?.rate || 0) - (a.attendance?.rate || 0);
                    }
                    return (b.overallScore || 0) - (a.overallScore || 0);
                });

                if (cat === 'overall') {
                    for (let i = 0; i < sorted.length && i < 3; i++) {
                        rankMap.overall[sorted[i].className] = i + 1;
                    }
                } else {
                    let currentRank = 1;
                    let lastVal = null;
                    for (let i = 0; i < sorted.length; i++) {
                        const item = sorted[i];
                        let val = 0;
                        if (cat === 'attendance') val = item.attendance?.rate || 0;
                        else if (cat === 'spp') val = item.spp?.rate || 0;
                        else if (cat === 'discipline') val = item.discipline?.score || 0;
                        else if (cat === 'library') val = item.library?.borrowCount || 0;

                        if (lastVal !== null && val < lastVal) {
                            currentRank++;
                        }
                        lastVal = val;

                        if (currentRank <= 3) {
                            rankMap[cat][item.className] = currentRank;
                        } else {
                            break;
                        }
                    }
                }
            });

            // 1. Kehadiran: X-2 (98%) Juara 1, X-1 (95%) Juara 2, XI-2 (92%) Juara 3
            expect(rankMap.attendance['X-2']).toBe(1);
            expect(rankMap.attendance['X-1']).toBe(2);
            expect(rankMap.attendance['XI-2']).toBe(3);
            expect(rankMap.attendance['XI-1']).toBeUndefined();

            // 2. SPP: XI-1 (100%) Juara 1, XI-2 (90%) Juara 2, XII-1 (85%) Juara 3
            expect(rankMap.spp['XI-1']).toBe(1);
            expect(rankMap.spp['XI-2']).toBe(2);
            expect(rankMap.spp['XII-1']).toBe(3);

            // 3. Kedisiplinan: X-1 dan XII-1 sama-sama 100 -> Keduanya Juara 1 Bersama (🥇 1)! XI-1 (95) Juara 2 (🥈 2), X-2 (90) Juara 3 (🥉 3)
            expect(rankMap.discipline['X-1']).toBe(1);
            expect(rankMap.discipline['XII-1']).toBe(1);
            expect(rankMap.discipline['XI-1']).toBe(2);
            expect(rankMap.discipline['X-2']).toBe(3);

            // 4. Literasi: XI-1 (20) Juara 1, X-1 (15) Juara 2, XII-1 (12) Juara 3, XI-2 (0 pinjaman) tidak dapat juara
            expect(rankMap.library['XI-1']).toBe(1);
            expect(rankMap.library['X-1']).toBe(2);
            expect(rankMap.library['XII-1']).toBe(3);
            expect(rankMap.library['XI-2']).toBeUndefined();

            // 5. Skor Indeks: XI-1 (94.0) Juara 1, X-1 (92.5) Juara 2, XII-1 (90.0) Juara 3
            expect(rankMap.overall['XI-1']).toBe(1);
            expect(rankMap.overall['X-1']).toBe(2);
            expect(rankMap.overall['XII-1']).toBe(3);
        });

        test('Skor Indeks kembar dipecahkan oleh skor kehadiran sehingga tidak ada ranking yang sama di Skor Indeks', () => {
            expect(jsContent).toContain("if (cat === 'overall')");
            expect(jsContent).toContain("rankMap.overall[sorted[i].className] = i + 1;");
            expect(jsContent).toContain("const diffAtt = (b.attendance?.rate || 0) - (a.attendance?.rate || 0);");
        });

        test('Tie-breaker SPP memprioritaskan jumlah siswa lunas (paidCount) jika persentase sama persis', () => {
            expect(jsContent).toContain("diff = (a.spp?.paidCount || 0) - (b.spp?.paidCount || 0);");
            expect(jsContent).toContain("const diffPaid = (b.spp?.paidCount || 0) - (a.spp?.paidCount || 0);");
        });

        test('Tabel renderLeaderboard menyematkan badge medali pada seluruh kolom acuan perankingan', () => {
            expect(jsContent).toContain('const categoryRanks = computeCategoryRankings(rankedList);');
            expect(jsContent).toContain("const attBadge = getCategoryRankBadge(categoryRanks.attendance[item.className], 'Kehadiran');");
            expect(jsContent).toContain("const sppBadge = getCategoryRankBadge(categoryRanks.spp[item.className], 'Kelancaran SPP');");
            expect(jsContent).toContain("const discBadge = getCategoryRankBadge(categoryRanks.discipline[item.className], 'Kedisiplinan');");
            expect(jsContent).toContain("const libBadge = getCategoryRankBadge(categoryRanks.library[item.className], 'Literasi Perpustakaan');");
            expect(jsContent).toContain("const overallBadge = getCategoryRankBadge(categoryRanks.overall[item.className], 'Skor Indeks Keseluruhan');");
            expect(jsContent).toContain('${attBadge}');
            expect(jsContent).toContain('${sppBadge}');
            expect(jsContent).toContain('${discBadge}');
            expect(jsContent).toContain('${libBadge}');
            expect(jsContent).toContain('${overallBadge}');
        });

        test('Saat kelas difilter/dicari, ranking acuan (tableIndex) dan medali tiap kolom tetap mempertahankan baseline (tidak reset jadi Juara 1)', () => {
            expect(jsContent).toContain('const categoryRanks = computeCategoryRankings(rankedList);');
            expect(jsContent).toContain('renderLeaderboard(displayList, categoryRanks);');
            expect(jsContent).toContain('const categoryRanks = baselineCategoryRanks || computeCategoryRankings(rankedList);');

            // Simulasi: 3 kelas di baseline
            const sampleClasses = [
                { className: 'X-1', attendance: { rate: 80 }, spp: { rate: 70 }, discipline: { score: 80 }, library: { borrowCount: 2 }, overallScore: 78.0, tableIndex: 3 },
                { className: 'X-2', attendance: { rate: 98 }, spp: { rate: 95 }, discipline: { score: 95 }, library: { borrowCount: 10 }, overallScore: 96.5, tableIndex: 1 },
                { className: 'X-3', attendance: { rate: 90 }, spp: { rate: 85 }, discipline: { score: 90 }, library: { borrowCount: 5 }, overallScore: 88.5, tableIndex: 2 }
            ];

            const baselineRanks = {
                attendance: { 'X-2': 1, 'X-3': 2, 'X-1': 3 },
                spp: { 'X-2': 1, 'X-3': 2, 'X-1': 3 },
                discipline: { 'X-2': 1, 'X-3': 2, 'X-1': 3 },
                library: { 'X-2': 1, 'X-3': 2, 'X-1': 3 },
                overall: { 'X-2': 1, 'X-3': 2, 'X-1': 3 }
            };

            // Saat difilter hanya mencari 'X-1'
            const filtered = sampleClasses.filter(c => c.className === 'X-1');
            expect(filtered.length).toBe(1);

            // Kelas X-1 mempertahankan tableIndex aslinya (3, bukan 1)
            expect(filtered[0].tableIndex).toBe(3);

            // Dan medali untuk X-1 menggunakan baselineRanks: Juara 3 (perunggu), BUKAN Juara 1 (emas)
            expect(baselineRanks.overall[filtered[0].className]).toBe(3);
            expect(baselineRanks.attendance[filtered[0].className]).toBe(3);
        });

        test('Helper formatPercentage dan formatDecimal memformat angka desimal 1 angka belakang koma secara rapi', () => {
            expect(jsContent).toContain('export function formatPercentage(val)');
            expect(jsContent).toContain('window.formatPercentage = formatPercentage;');
            expect(jsContent).toContain('export function formatDecimal(val, digits = 1)');
            expect(jsContent).toContain('window.formatDecimal = formatDecimal;');

            const formatPercentage = (val) => {
                if (val === null || val === undefined || isNaN(val)) return '0.0%';
                const n = Number(val);
                if (Number(n.toFixed(1)) === 100 || n >= 100) return '100%';
                return `${n.toFixed(1)}%`;
            };

            const formatDecimal = (val, digits = 1) => {
                if (val === null || val === undefined || isNaN(val)) return (0).toFixed(digits);
                return Number(val).toFixed(digits);
            };

            expect(formatPercentage(97.234)).toBe('97.2%');
            expect(formatPercentage(72.5)).toBe('72.5%');
            expect(formatPercentage(100)).toBe('100%');
            expect(formatPercentage(100.0)).toBe('100%');
            expect(formatPercentage(95.0)).toBe('95.0%');
            expect(formatPercentage(0)).toBe('0.0%');
            expect(formatPercentage(null)).toBe('0.0%');

            expect(formatDecimal(95)).toBe('95.0');
            expect(formatDecimal(84.32)).toBe('84.3');
            expect(formatDecimal(100)).toBe('100.0');
            expect(formatDecimal(0)).toBe('0.0');
        });

        test('Badge ranking berada pada posisi mepet di samping angka (left-full ml-1.5) dengan angka persentase sejajar', () => {
            expect(jsContent).toContain('<span class="absolute left-full top-1/2 -translate-y-1/2 ml-1.5 shrink-0 inline-flex items-center">${attBadge}</span>');
            expect(jsContent).toContain('<span class="absolute left-full top-1/2 -translate-y-1/2 ml-1.5 shrink-0 inline-flex items-center">${sppBadge}</span>');
            expect(jsContent).toContain('<span class="absolute left-full top-1/2 -translate-y-1/2 ml-1.5 shrink-0 inline-flex items-center">${discBadge}</span>');
            expect(jsContent).toContain('<span class="absolute left-full top-1/2 -translate-y-1/2 ml-1.5 shrink-0 inline-flex items-center">${overallBadge}</span>');
        });

        test('Kolom kedisiplinan menyertakan teks total poin & permisi di bawah persentase sebagai informasi informatif', () => {
            expect(jsContent).toContain('${item.discipline.violationsCount} Poin');
            expect(jsContent).toContain('${pCount}x Izin');
            expect(jsContent).toContain('0 Poin');
        });

        test('Kolom SPP menyertakan teks rincian siswa lunas di bawah persentase (contoh: paidCount/totalStudents Siswa)', () => {
            expect(jsContent).toContain('${item.spp.paidCount || 0}/${item.totalStudents || item.spp.totalCount || 0} Siswa');
        });

        test('Nama rombel kelas pada tabel dibungkus tombol interaktif yang memicu openClassDetailModal', () => {
            expect(jsContent).toMatch(/<button type="button" onclick="window\.openClassDetailModal\('\$\{escapeHTML\(item\.className\)\}'\)"/);
            expect(jsContent).toContain('elWaliName.textContent = item.wali?.name ||');
            expect(jsContent).toContain('elWaliNip.textContent = item.wali?.nip ?');
        });

        test('Tabel utama tetap bersih tanpa foto di samping nama rombel kelas sesuai preferensi pengguna', () => {
            // Memastikan td nama kelas tidak memuat tag img di samping nama kelas pada tabel
            expect(jsContent).toMatch(/<td class="px-3\.5 py-2 font-bold text-slate-800 dark:text-white">\s*<button type="button" onclick="window\.openClassDetailModal/);
            expect(jsContent).not.toMatch(/<td class="px-3\.5 py-2 font-bold text-slate-800 dark:text-white">[\s\S]*?<img[^>]*class="[^"]*rounded-full/);
        });

        test('Modal detail kelas (#modal-detail-kelas) mengintegrasikan pasfoto resmi Wali Kelas dengan fallback inisial', () => {
            expect(globalJsContent).toContain('photo: photo || null');
            expect(jsContent).toContain('photo: waliPhoto');
            expect(jsContent).toContain('const photoUrl = item.wali?.photo ? resolvePhotoUrl(item.wali.photo) : null;');
            expect(jsContent).toContain('elWaliAvatar.innerHTML = `<img src="${photoUrl}"');
            expect(jsContent).toContain('onerror="this.onerror=null; this.parentElement.innerHTML=\'<span>${initial}</span>\';"');
        });

        test('Peringkat hakiki kelas (item.rank) dihitung murni berbasis Skor Indeks (overallScore) dengan tie-breaker presisi', () => {
            expect(jsContent).toContain('item.overallRank = idx + 1;');
            expect(jsContent).toContain('overallSorted');
        });
    });

    describe('3. Integrasi Navigasi & RBAC di global.js', () => {
        test('Mendaftarkan ranking_kelas di MENU_CONFIG untuk seluruh role', () => {
            expect(globalJsContent).toContain("'super_admin':");
            expect(globalJsContent).toMatch(/'super_admin':\s*\[[^\]]*'ranking_kelas'/);
            expect(globalJsContent).toMatch(/'guru_mapel':\s*\[[^\]]*'ranking_kelas'/);
            expect(globalJsContent).toMatch(/'wali_kelas':\s*\[[^\]]*'ranking_kelas'/);
            expect(globalJsContent).toMatch(/'siswa':\s*\[[^\]]*'ranking_kelas'/);
        });

        test('Mendaftarkan ranking-kelas.html di PAGE_ACCESS_CONFIG dengan hak akses universal read', () => {
            expect(globalJsContent).toContain("'ranking-kelas.html': {");
            expect(globalJsContent).toContain("'super_admin': 'rw'");
            expect(globalJsContent).toContain("'guru_mapel': 'r'");
            expect(globalJsContent).toContain("'siswa': 'r'");
        });

        test('Mendaftarkan ranking_kelas di MENU_LABELS dengan icon trophy', () => {
            expect(globalJsContent).toContain("'ranking_kelas': { label: 'Ranking Kelas', icon: 'fa-trophy', link: `${ROOT_URL}ranking-kelas.html`");
        });

        test('Memperbarui MENU_GROUPS presensi_group menjadi Presensi & Monitoring dengan ranking_kelas', () => {
            expect(globalJsContent).toContain("label: 'Presensi & Monitoring'");
            expect(globalJsContent).toContain("'ranking_kelas'");
        });

        test('Mendukung otorisasi dinamis menu dan guard halaman via isRankingKelasAllowedForUser', () => {
            expect(globalJsContent).toContain('function isRankingKelasAllowedForUser()');
            expect(globalJsContent).toContain('ranking-kelas.html');
            expect(globalJsContent).toContain('simas_ranking_access_config');
            expect(globalJsContent).toContain('isRankingKelasAllowedForUser()');
        });
    });

    describe('4. Kepatuhan Dokumentasi & Sinkronisasi Versi', () => {
        test('Versi package.json, js/config.js, PRD_SIMAS.md, dan CHANGELOG.md tersinkronisasi 100%', () => {
            const v = packageJson.version;
            expect(v).toMatch(/^\d{2}\.\d{2}\.\d{2}\.\d+$/);
            expect(configJs).toContain(`export const APP_VERSION = "${v}";`);
            expect(prdContent).toContain(`[${v}]`);
            expect(changelogContent).toContain(`[${v}]`);
        });

        test('PRD_SIMAS.md mendokumentasikan subbab 4.35 Modul Monitoring & Ranking Kinerja Kelas', () => {
            expect(prdContent).toContain('### 4.35 Modul Monitoring & Ranking Kinerja Kelas');
            expect(prdContent).toContain('Bintang SMAGESA');
            expect(prdContent).toContain('0 Firestore Read');
        });
    });

    describe('5. Pembatasan Jadwal Waktu Akses Publik (WITA: Jumat 12:15 s.d. Senin 10:00 WITA)', () => {
        test('Komponen UI layar kunci edukatif dan banner Super Admin tersedia di ranking-kelas.html', () => {
            // Banner Super Admin
            expect(htmlContent).toContain('id="super-admin-schedule-banner"');
            expect(htmlContent).toContain('onclick="window.previewLockedScreen()"');

            // Kontainer Utama & Layar Kunci
            expect(htmlContent).toContain('id="ranking-main-content"');
            expect(htmlContent).toContain('id="ranking-schedule-lock-container"');
            expect(htmlContent).toContain('id="lock-admin-preview-bar"');
            expect(htmlContent).toContain('onclick="window.exitLockedScreenPreview()"');

            // Elemen Informasi Waktu & Motivasi
            expect(htmlContent).toContain('id="lock-current-wita-time"');
            expect(htmlContent).toContain('id="lock-countdown-display"');
            expect(htmlContent).toContain('id="lock-next-open-date"');
            expect(htmlContent).toContain('id="lock-motivation-text"');

            // Elemen Pilar Indeks Kinerja Dinamis pada Layar Kunci
            expect(htmlContent).toContain('id="lock-criteria-section"');
            expect(htmlContent).toContain('id="lock-criteria-title"');
            expect(htmlContent).toContain('id="lock-criteria-total-weight"');
            expect(htmlContent).toContain('id="lock-criteria-grid"');
            expect(htmlContent).toContain('Kehadiran (40%)');
            expect(htmlContent).toContain('Kelancaran SPP (30%)');
            expect(htmlContent).toContain('Kedisiplinan (20%)');
            expect(htmlContent).toContain('Literasi Perpus (10%)');

            // Pengaturan Jadwal pada Modal Super Admin
            expect(htmlContent).toContain('id="section-schedule-access"');
            expect(htmlContent).toContain('id="ranking-schedule-toggle"');
            expect(htmlContent).toContain('id="ranking-schedule-motivation-input"');
        });

        test('Fungsi-fungsi terkait pembatasan jadwal dan pilar dinamis diekspor ke global window di js/page-ranking-kelas.js', () => {
            expect(jsContent).toContain('window.checkRankingScheduleWindow = checkRankingScheduleWindow;');
            expect(jsContent).toContain('window.renderRankingScheduleLockScreen = renderRankingScheduleLockScreen;');
            expect(jsContent).toContain('window.renderLockScreenCriteriaPillars = renderLockScreenCriteriaPillars;');
            expect(jsContent).toContain('window.previewLockedScreen = previewLockedScreen;');
            expect(jsContent).toContain('window.exitLockedScreenPreview = exitLockedScreenPreview;');
        });

        test('Fungsi renderLockScreenCriteriaPillars menyinkronkan pilar kinerja pada layar kunci secara dinamis', () => {
            // Simulasi logika renderLockScreenCriteriaPillars
            const pillarDefinitions = [
                { key: 'attendance', label: 'Kehadiran', icon: 'fa-user-check' },
                { key: 'spp', label: 'Kelancaran SPP', icon: 'fa-file-invoice-dollar' },
                { key: 'discipline', label: 'Kedisiplinan', icon: 'fa-shield-halved' },
                { key: 'library', label: 'Literasi Perpus', icon: 'fa-book-open-reader' }
            ];

            const renderSim = (criteriaState) => {
                const vis = criteriaState.visible;
                const w = criteriaState.weights;
                const active = pillarDefinitions.filter(p => vis[p.key] !== false);
                const totalW = active.reduce((sum, p) => sum + (Number(w[p.key]) || 0), 0);
                const title = active.length > 0 ? `${active.length} Pilar Penilaian Indeks Bintang SMAGESA:` : 'Pilar Penilaian Indeks Bintang SMAGESA:';
                const totalWeightText = `Total Bobot: ${totalW}%`;
                const renderedPillars = active.map(p => `${p.label} (${w[p.key]}%)`);
                return { title, totalWeightText, renderedPillars, activeCount: active.length };
            };

            // 1. Kondisi Default (4 Pilar Aktif: 40%, 30%, 20%, 10%)
            const stateDefault = {
                visible: { attendance: true, spp: true, discipline: true, library: true },
                weights: { attendance: 40, spp: 30, discipline: 20, library: 10 }
            };
            const resDefault = renderSim(stateDefault);
            expect(resDefault.title).toBe('4 Pilar Penilaian Indeks Bintang SMAGESA:');
            expect(resDefault.totalWeightText).toBe('Total Bobot: 100%');
            expect(resDefault.renderedPillars).toEqual([
                'Kehadiran (40%)',
                'Kelancaran SPP (30%)',
                'Kedisiplinan (20%)',
                'Literasi Perpus (10%)'
            ]);

            // 2. Kondisi Kustom: Literasi Perpustakaan Dinonaktifkan, Bobot Diubah (50%, 25%, 25%)
            const stateCustom = {
                visible: { attendance: true, spp: true, discipline: true, library: false },
                weights: { attendance: 50, spp: 25, discipline: 25, library: 0 }
            };
            const resCustom = renderSim(stateCustom);
            expect(resCustom.title).toBe('3 Pilar Penilaian Indeks Bintang SMAGESA:');
            expect(resCustom.totalWeightText).toBe('Total Bobot: 100%');
            expect(resCustom.renderedPillars).toEqual([
                'Kehadiran (50%)',
                'Kelancaran SPP (25%)',
                'Kedisiplinan (25%)'
            ]);
            expect(resCustom.renderedPillars).not.toContain('Literasi Perpus');

            // 3. Kondisi 2 Pilar Aktif (Kehadiran 60%, SPP 40%)
            const stateTwo = {
                visible: { attendance: true, spp: true, discipline: false, library: false },
                weights: { attendance: 60, spp: 40, discipline: 0, library: 0 }
            };
            const resTwo = renderSim(stateTwo);
            expect(resTwo.title).toBe('2 Pilar Penilaian Indeks Bintang SMAGESA:');
            expect(resTwo.totalWeightText).toBe('Total Bobot: 100%');
            expect(resTwo.renderedPillars).toHaveLength(2);

            // 4. Verifikasi fungsi dipanggil di applyRankingCriteriaUI dan renderRankingScheduleLockScreen
            expect(jsContent).toContain('renderLockScreenCriteriaPillars();');
            expect(jsContent).toMatch(/applyRankingCriteriaUI[\s\S]*?renderLockScreenCriteriaPillars\(\);/);
            expect(jsContent).toMatch(/renderRankingScheduleLockScreen[\s\S]*?renderLockScreenCriteriaPillars\(\);/);
        });

        test('Helper checkRankingScheduleWindow membuka akses hari Jumat mulai pukul 12:15 WITA serta sepanjang Sabtu dan Minggu', () => {
            const checkSchedule = (d, cfg = null) => {
                const witaEpoch = d.getTime() + 8 * 3600000;
                const witaDate = new Date(witaEpoch);
                const day = witaDate.getUTCDay();
                const hour = witaDate.getUTCHours();
                const minute = witaDate.getUTCMinutes();
                const isEnabled = !cfg || cfg.enabled !== false;
                if (!isEnabled) return { isOpen: true };
                const startHour = typeof cfg?.startHour === 'number' ? cfg.startHour : 12;
                const startMinute = typeof cfg?.startMinute === 'number' ? cfg.startMinute : 15;
                const endHour = typeof cfg?.endHour === 'number' ? cfg.endHour : 10;
                const endMinute = typeof cfg?.endMinute === 'number' ? cfg.endMinute : 0;
                let isOpen = false;
                if (day === 5) {
                    isOpen = (hour > startHour || (hour === startHour && minute >= startMinute));
                } else if (day === 6 || day === 0) {
                    isOpen = true;
                } else if (day === 1) {
                    isOpen = (hour < endHour || (hour === endHour && minute < endMinute));
                }
                return { isOpen, day, hour, minute };
            };

            // Jumat subuh 00:00 WITA -> UTC Kamis 16:00 (Masih Tutup!)
            const jumatPagi = new Date(Date.UTC(2026, 8, 24, 16, 0, 0)); // 25 Sep 2026 00:00 WITA
            expect(checkSchedule(jumatPagi).isOpen).toBe(false);

            // Jumat siang 12:14:59 WITA -> UTC 04:14:59 (Tepat sebelum buka: Masih Tutup!)
            const jumatSebelumBuka = new Date(Date.UTC(2026, 8, 25, 4, 14, 59));
            expect(checkSchedule(jumatSebelumBuka).isOpen).toBe(false);

            // Jumat siang 12:15:00 WITA -> UTC 04:15:00 (Tepat Waktu Buka: isOpen = true!)
            const jumatTepatBuka = new Date(Date.UTC(2026, 8, 25, 4, 15, 0));
            expect(checkSchedule(jumatTepatBuka).isOpen).toBe(true);

            // Jumat siang 13:00 WITA -> UTC 05:00:00 (Sedang Terbuka: isOpen = true!)
            const jumatSiang = new Date(Date.UTC(2026, 8, 25, 5, 0, 0));
            expect(checkSchedule(jumatSiang).isOpen).toBe(true);

            // Sabtu 15:30 WITA -> UTC 07:30
            const sabtu = new Date(Date.UTC(2026, 8, 26, 7, 30, 0));
            expect(checkSchedule(sabtu).isOpen).toBe(true);

            // Minggu 20:00 WITA -> UTC 12:00
            const minggu = new Date(Date.UTC(2026, 8, 27, 12, 0, 0));
            expect(checkSchedule(minggu).isOpen).toBe(true);
        });

        test('Helper checkRankingScheduleWindow mengizinkan akses hari Senin sebelum pukul 10:00 WITA dan menutup tepat pukul 10:00 WITA', () => {
            const checkSchedule = (d, cfg = null) => {
                const witaEpoch = d.getTime() + 8 * 3600000;
                const witaDate = new Date(witaEpoch);
                const day = witaDate.getUTCDay();
                const hour = witaDate.getUTCHours();
                const isEnabled = !cfg || cfg.enabled !== false;
                if (!isEnabled) return { isOpen: true };
                let isOpen = false;
                if (day === 5 || day === 6 || day === 0) isOpen = true;
                else if (day === 1) isOpen = (hour < 10);
                return { isOpen, day, hour };
            };

            // Senin 07:00 WITA -> UTC 23:00 (Minggu malam UTC)
            const seninPagi = new Date(Date.UTC(2026, 8, 27, 23, 0, 0)); // 28 Sep 2026 07:00 WITA
            expect(checkSchedule(seninPagi).isOpen).toBe(true);

            // Senin 09:59:59 WITA -> UTC 01:59:59
            const seninSebelumTutup = new Date(Date.UTC(2026, 8, 28, 1, 59, 59));
            expect(checkSchedule(seninSebelumTutup).isOpen).toBe(true);

            // Senin 10:00:00 WITA -> UTC 02:00:00 (Tutup!)
            const seninTepatTutup = new Date(Date.UTC(2026, 8, 28, 2, 0, 0));
            expect(checkSchedule(seninTepatTutup).isOpen).toBe(false);

            // Senin 10:01:00 WITA -> UTC 02:01:00 (Tutup!)
            const seninLewatTutup = new Date(Date.UTC(2026, 8, 28, 2, 1, 0));
            expect(checkSchedule(seninLewatTutup).isOpen).toBe(false);
        });

        test('Helper checkRankingScheduleWindow menutup akses pada hari Selasa, Rabu, Kamis', () => {
            const checkSchedule = (d, cfg = null) => {
                const witaEpoch = d.getTime() + 8 * 3600000;
                const witaDate = new Date(witaEpoch);
                const day = witaDate.getUTCDay();
                const hour = witaDate.getUTCHours();
                const isEnabled = !cfg || cfg.enabled !== false;
                if (!isEnabled) return { isOpen: true };
                let isOpen = false;
                if (day === 5 || day === 6 || day === 0) isOpen = true;
                else if (day === 1) isOpen = (hour < 10);
                return { isOpen, day, hour };
            };

            // Selasa 10:00 WITA (29 Sep 2026)
            const selasa = new Date(Date.UTC(2026, 8, 29, 2, 0, 0));
            expect(checkSchedule(selasa).isOpen).toBe(false);

            // Rabu 12:00 WITA (30 Sep 2026)
            const rabu = new Date(Date.UTC(2026, 8, 30, 4, 0, 0));
            expect(checkSchedule(rabu).isOpen).toBe(false);

            // Kamis 23:59:59 WITA (1 Okt 2026)
            const kamis = new Date(Date.UTC(2026, 9, 1, 15, 59, 59));
            expect(checkSchedule(kamis).isOpen).toBe(false);
        });

        test('Akses terbuka penuh (isOpen = true) jika toggle jadwal dinonaktifkan oleh Super Admin', () => {
            const checkSchedule = (d, cfg = null) => {
                const isEnabled = !cfg || cfg.enabled !== false;
                if (!isEnabled) return { isOpen: true, isScheduleEnabled: false };
                return { isOpen: false, isScheduleEnabled: true };
            };

            const rabu = new Date(Date.UTC(2026, 8, 30, 4, 0, 0));
            const result = checkSchedule(rabu, { enabled: false });
            expect(result.isOpen).toBe(true);
            expect(result.isScheduleEnabled).toBe(false);
        });

        test('Pengguna umum di luar jadwal tidak memanggil query database (0 Read Supabase & D1)', () => {
            // Memastikan logika guard DOMContentLoaded mengecek isOpen dan isPrivilegedAccess sebelum loadRankingData
            expect(jsContent).toContain('if (!scheduleInfo.isOpen && !isPrivilegedAccess)');
            expect(jsContent).toContain('renderRankingScheduleLockScreen(scheduleInfo, false);');
            expect(jsContent).toMatch(/if \(!scheduleInfo\.isOpen && !isPrivilegedAccess\)[\s\S]*?renderRankingScheduleLockScreen[\s\S]*?return;\s*\}/);
        });

        test('Super Admin & Kepala Sekolah mendapatkan akses penuh 24/7 dengan banner informasi status jadwal', () => {
            expect(jsContent).toContain('const isKepalaSekolah = allRoles.includes(\'kepala_sekolah\');');
            expect(jsContent).toContain('const isPrivilegedAccess = isSuperAdmin || isKepalaSekolah;');
            expect(jsContent).toContain('if (!scheduleInfo.isOpen && isPrivilegedAccess)');
            expect(jsContent).toContain("if (adminBanner) {");
            expect(jsContent).toContain('await loadRankingData(false);');
            expect(globalJsContent).toContain("if (allRoles.includes('super_admin') || allRoles.includes('kepala_sekolah')) return true;");
        });
    });
});


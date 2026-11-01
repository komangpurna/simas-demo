/**
 * tests/workload-monthly-recap.test.js
 * ====================================================================
 * Test Suite: Verifikasi Fitur Tab Rekap Realisasi Bulanan E-Kinerja Guru
 * & Cetak Estetik ala Canva (Permendikdasmen No. 11/2025)
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Suite Pengujian Tab Rekap Realisasi Bulanan E-Kinerja Guru', () => {
    const root = path.resolve(__dirname, '..');
    const workerPath = path.join(root, 'cloudflare', 'worker.js');
    const clientPath = path.join(root, 'js', 'cloudflare-client.js');
    const pageHtmlPath = path.join(root, 'e-kinerja.html');
    const pageJsPath = path.join(root, 'js', 'page-beban-kerja.js');

    const workerContent = fs.readFileSync(workerPath, 'utf8');
    const clientContent = fs.readFileSync(clientPath, 'utf8');
    const pageHtmlContent = fs.readFileSync(pageHtmlPath, 'utf8');
    const pageJsContent = fs.readFileSync(pageJsPath, 'utf8');

    describe('1. Verifikasi Backend Endpoint & Keamanan ASVS Level 2', () => {
        test('Route /api/workload/monthly-recap terdaftar di cloudflare/worker.js', () => {
            expect(workerContent).toContain('/api/workload/monthly-recap');
        });

        test('Route monthly-recap memverifikasi token dan otorisasi manajerial serta whitelist VIP (Super Admin, Kepsek, & Guru VIP - ASVS Level 2)', () => {
            const freshWorkerContent = fs.readFileSync(workerPath, 'utf8');
            expect(freshWorkerContent).toMatch(/if\s*\(!isVipUser\)/);
            expect(freshWorkerContent).toContain('Akses Terbatas: Modul Rekapitulasi Realisasi merupakan fitur eksklusif SIMAS VIP');
        });

        test('Backend mengelompokkan 5 Tugas Pokok Permendikdasmen No. 11/2025', () => {
            expect(workerContent).toContain('PELAKSANAAN_KBM');
            expect(workerContent).toContain('PERENCANAAN');
            expect(workerContent).toContain('PENILAIAN');
            expect(workerContent).toContain('PEMBIMBINGAN');
            expect(workerContent).toContain('TUGAS_TAMBAHAN');
            expect(workerContent).toContain('Pelaksanaan Pembelajaran (KBM Tatap Muka)');
            expect(workerContent).toContain('Perencanaan Pembelajaran (Modul Ajar, Prota, Promes, MGMP)');
            expect(workerContent).toContain('Penilaian Hasil Pembelajaran (Asesmen & Evaluasi)');
            expect(workerContent).toContain('Pembimbingan & Pelatihan Siswa (Ekskul, BK, P5)');
            expect(workerContent).toContain('Pelaksanaan Tugas Tambahan (Wali Kelas, Pembina, Piket, Upacara)');
        });

        test('Backend menghitung metrik durasi, JP tatap muka, dan verifikasi', () => {
            expect(workerContent).toContain('total_minutes');
            expect(workerContent).toContain('grand_total_hours_formatted');
            expect(workerContent).toContain('total_teaching_jp');
            expect(workerContent).toContain('effective_days_count');
            expect(workerContent).toContain('verification_percentage');
        });
    });

    describe('2. Verifikasi API Client (js/cloudflare-client.js)', () => {
        test('Fungsi cfGetWorkloadMonthlyRecap diekspor dan diikat ke window', () => {
            expect(clientContent).toContain('export async function cfGetWorkloadMonthlyRecap');
            expect(clientContent).toContain('window.cfGetWorkloadMonthlyRecap = cfGetWorkloadMonthlyRecap');
        });

        test('Fungsi klien memanggil endpoint dengan query params month dan teacher_id', () => {
            expect(clientContent).toContain('/api/workload/monthly-recap?');
            expect(clientContent).toContain('month=${encodeURIComponent(month)}');
            expect(clientContent).toContain('teacher_id=${encodeURIComponent(teacherId)}');
        });
    });

    describe('3. Verifikasi UI & DOM Integrity di e-kinerja.html', () => {
        test('Tombol tab Rekap Realisasi (#tab-btn-rekap) tampil di semua layar (termasuk mobile) dan berada setelah tab rencana (#tab-btn-plan)', () => {
            const freshHtml = fs.readFileSync(pageHtmlPath, 'utf8');
            expect(freshHtml).toContain('id="tab-btn-rekap"');
            expect(freshHtml).toContain("workloadSwitchTab('tab-rekap')");
            expect(freshHtml).toContain('Rekap Realisasi');
            // Memastikan memiliki class responsive flex dan tidak lagi tersembunyi di mobile (tanpa hidden md:flex)
            expect(freshHtml).not.toMatch(/id="tab-btn-rekap"[^>]*class="[^"]*hidden\s+md:flex/);
            expect(freshHtml).toMatch(/id="tab-btn-rekap"[^>]*class="[^"]*flex/);
            // Memastikan urutan tab tombol: Rencana sebelum Rekap Realisasi
            const planBtnIdx = freshHtml.indexOf('id="tab-btn-plan"');
            const rekapBtnIdx = freshHtml.indexOf('id="tab-btn-rekap"');
            expect(planBtnIdx).toBeGreaterThan(-1);
            expect(rekapBtnIdx).toBeGreaterThan(planBtnIdx);
            // Memastikan urutan kontainer: tab-content-plan sebelum tab-content-rekap
            const planContentIdx = freshHtml.indexOf('id="tab-content-plan"');
            const rekapContentIdx = freshHtml.indexOf('id="tab-content-rekap"');
            expect(planContentIdx).toBeGreaterThan(-1);
            expect(rekapContentIdx).toBeGreaterThan(planContentIdx);
        });

        test('Fungsi switchTab mendukung akses tab Rekap Realisasi di HP/mobile tanpa fallback paksa < 768px', () => {
            const freshJs = fs.readFileSync(pageJsPath, 'utf8');
            expect(freshJs).not.toMatch(/tabId\s*===\s*'tab-rekap'\s*&&\s*typeof\s*window\s*!==\s*'undefined'\s*&&\s*window\.innerWidth\s*&&\s*window\.innerWidth\s*<\s*768/);
        });

        test('Panel konten rekap (#tab-content-rekap) tersedia dengan toolbar filter', () => {
            const freshHtml = fs.readFileSync(pageHtmlPath, 'utf8');
            expect(freshHtml).toContain('id="tab-content-rekap"');
            expect(freshHtml).toContain('id="select-rekap-month"');
            expect(freshHtml).toContain('id="select-rekap-year"');
            expect(freshHtml).toContain('workloadNavMonth(-1)');
            expect(freshHtml).toContain('workloadNavMonth(1)');
            expect(freshHtml).toContain('workloadSetCurrentMonth()');
            expect(freshHtml).toContain('workloadReloadMonthlyRecap()');
        });

        test('Container kartu metrik summary, progress bar, dan accordion kategori tersedia dalam tata letak compact mini-tiles & slim strip', () => {
            const freshHtml = fs.readFileSync(pageHtmlPath, 'utf8');
            const freshJs = fs.readFileSync(pageJsPath, 'utf8');

            expect(freshHtml).toContain('id="rekap-metric-hours"');
            expect(freshHtml).toContain('id="rekap-metric-jp"');
            expect(freshHtml).toContain('id="rekap-metric-activities"');
            expect(freshHtml).toContain('id="rekap-segmented-bar"');
            expect(freshHtml).toContain('id="rekap-categories-container"');

            // Memastikan tata letak compact mini-tiles & slim strip (hemat ruang vertikal)
            expect(freshHtml).toContain('COMPACT MINI TILES');
            expect(freshHtml).toContain('COMPACT SLIM STRIP');
            expect(freshHtml).toContain('h-1.5 w-full bg-slate-100');
            expect(freshJs).toContain('text-[10px]');
        });

        test('Modal cetak estetik (#modal-rekap-aesthetic-print) mematuhi Rule Anti-Nesting (di luar <main>)', () => {
            const freshHtml = fs.readFileSync(pageHtmlPath, 'utf8');
            expect(freshHtml).toContain('id="modal-rekap-aesthetic-print"');
            
            const mainClosingIdx = freshHtml.indexOf('</main>');
            const modalPrintIdx = freshHtml.indexOf('id="modal-rekap-aesthetic-print"');
            
            expect(mainClosingIdx).toBeGreaterThan(-1);
            expect(modalPrintIdx).toBeGreaterThan(mainClosingIdx);
        });

        test('Modal cetak estetik memiliki saklar orientasi, drawer checklist kegiatan, kanvas tanda tangan dan iframe preview', () => {
            const freshHtml = fs.readFileSync(pageHtmlPath, 'utf8');
            expect(freshHtml).toContain('id="btn-rekap-orient-portrait"');
            expect(freshHtml).toContain('id="btn-rekap-orient-landscape"');
            expect(freshHtml).toContain('id="panel-report-act-drawer"');
            expect(freshHtml).toContain('id="rekap-signature-canvas"');
            expect(freshHtml).toContain('id="rekap-aesthetic-preview-frame"');
            expect(freshHtml).toContain('workloadClearRekapSignature()');
            expect(freshHtml).toContain('workloadPrintAestheticReport()');
        });
    });

    describe('4. Verifikasi Handler & Global Window Bindings di js/page-beban-kerja.js', () => {
        test('Fungsi-fungsi navigasi dan render rekap terikat pada window', () => {
            const freshJs = fs.readFileSync(pageJsPath, 'utf8');
            expect(freshJs).toContain('window.workloadNavMonth = workloadNavMonth');
            expect(freshJs).toContain('window.workloadOnMonthChange = workloadOnMonthChange');
            expect(freshJs).toContain('window.workloadSetCurrentMonth = workloadSetCurrentMonth');
            expect(freshJs).toContain('window.workloadReloadMonthlyRecap = workloadReloadMonthlyRecap');
            expect(freshJs).toContain('window.workloadToggleRekapCategory = workloadToggleRekapCategory');
        });

        test('Kategori rekap realisasi pada awal load berada dalam status tertutup/collapsed (tidak auto-expand Pelaksanaan Pembelajaran)', () => {
            const freshJs = fs.readFileSync(pageJsPath, 'utf8');
            expect(freshJs).toContain('let _rekapExpandedCategories = new Set();');
            expect(freshJs).not.toContain("let _rekapExpandedCategories = new Set(['PELAKSANAAN_KBM']);");
        });

        test('Fungsi cetak estetik per kategori, drawer checklist, dan foto lokal terikat pada window', () => {
            const freshJs = fs.readFileSync(pageJsPath, 'utf8');
            expect(freshJs).toContain('window.workloadOpenCategoryReport = workloadOpenCategoryReport');
            expect(freshJs).toContain('window.workloadSetReportOrientation = workloadSetReportOrientation');
            expect(freshJs).toContain('window.workloadToggleReportActivityDrawer = workloadToggleReportActivityDrawer');
            expect(freshJs).toContain('window.workloadToggleReportSelectAll = workloadToggleReportSelectAll');
            expect(freshJs).toContain('window.workloadToggleReportActivity = workloadToggleReportActivity');
            expect(freshJs).toContain('window.workloadUploadLocalPhoto = workloadUploadLocalPhoto');
            expect(freshJs).toContain('window.workloadRemoveLocalPhoto = workloadRemoveLocalPhoto');
            expect(freshJs).toContain('window.workloadOpenMonthlyAestheticPrint = workloadOpenMonthlyAestheticPrint');
            expect(freshJs).toContain('window.workloadCloseAestheticPrintModal = workloadCloseAestheticPrintModal');
            expect(freshJs).toContain('window.workloadClearRekapSignature = workloadClearRekapSignature');
            expect(freshJs).toContain('window.workloadRefreshAestheticPreview = workloadRefreshAestheticPreview');
            expect(freshJs).toContain('window.workloadPrintAestheticReport = workloadPrintAestheticReport');
        });

        test('Fungsi template HTML cetak infografis memuat styling Canva, header instansi, banner kategori, dan area TTD', () => {
            const freshJs = fs.readFileSync(pageJsPath, 'utf8');
            expect(freshJs).toContain('buildAestheticCategoryReportHtml');
            expect(freshJs).toContain('buildAestheticMonthlyReportHtml');
            expect(freshJs).toContain('Permendikdasmen No. 11/2025');
            expect(freshJs).toContain('rekap-signature-canvas');
        });

        test('Cetak infografis guru memakai tanggal Indonesia, badge jumlah kegiatan, batas 4 kegiatan, foto utuh, dan periode mingguan', () => {
            const freshJs = fs.readFileSync(pageJsPath, 'utf8');
            const sharedJs = fs.readFileSync(path.join(__dirname, '../js/rekap-infographic.js'), 'utf8');
            expect(sharedJs).toContain('export function formatRekapPrintDate(ymd)');
            expect(sharedJs).toContain('esc(formatRekapPrintDate(act.date))');
            expect(freshJs).toContain('const catBadgeCode = `${selectedActivities.length} Kegiatan`;');
            expect(freshJs).toContain('export const REKAP_MAX_REPORT_ACTIVITIES = 4;');
            expect(freshJs).toContain('.slice(0, REKAP_MAX_REPORT_ACTIVITIES)');
            expect(freshJs).toContain('export const REKAP_MAX_REPORT_PHOTOS = 5;');
            expect(freshJs).toContain('return buildRekapInfographicHtml({');
            expect(sharedJs).toContain('object-fit: contain;');
            expect(sharedJs).toContain('export function getRekapMonthWeeks(month)');
            expect(sharedJs).toContain('export function rekapCardWeight(photoCount)');
            expect(freshJs).toContain('window.workloadSetReportPeriodWeek = workloadSetReportPeriodWeek');
            expect(sharedJs).toContain('isGenericCaption(p?.caption)');
        });

        test('Cetak infografis guru: subtitle sub kegiatan bersih tanpa nomor dan kurung (Sub Kegiatan dari Pelaksanaan Tugas Tambahan)', () => {
            const freshJs = fs.readFileSync(pageJsPath, 'utf8');
            expect(freshJs).toContain('export function cleanRekapCategoryName(cat)');
            expect(freshJs).toContain('const catCleanName = cleanRekapCategoryName(cat);');
            expect(freshJs).toContain('const catSubDesc = subCatalogItem ? `Sub Kegiatan dari ${catCleanName}`');
            expect(freshJs).toContain('window.cleanRekapCategoryName = cleanRekapCategoryName;');

            // Verifikasi logika regex pembersihan nama kategori
            const cleanFn = (name) => String(name || '').replace(/^\d+\.\s*/, '').replace(/\s*\([^)]*\)$/, '').trim();
            expect(cleanFn('5. Pelaksanaan Tugas Tambahan (Wali Kelas, Pembina, Piket, Upacara)')).toBe('Pelaksanaan Tugas Tambahan');
            expect(cleanFn('1. Pelaksanaan Pembelajaran (KBM Tatap Muka)')).toBe('Pelaksanaan Pembelajaran');
            expect(cleanFn('2. Perencanaan Pembelajaran (Modul Ajar, Prota, Promes, MGMP)')).toBe('Perencanaan Pembelajaran');
        });

        test('Cetak infografis guru: NIP di bawah nama guru, header bulan bersih tanpa "Sebulan Penuh", dan titimangsa tanggal cetak riil', () => {
            const freshJs = fs.readFileSync(pageJsPath, 'utf8');
            const sharedJs = fs.readFileSync(path.join(__dirname, '../js/rekap-infographic.js'), 'utf8');

            // 1. Format NIP & Tampilan Profil Bawah Nama
            expect(sharedJs).toContain('export function formatRekapNip(nip)');
            expect(sharedJs).toContain('formatRekapNip(person.nip)');
            expect(freshJs).toContain('const formattedNip = formatRekapNip(teacherNip);');
            expect(freshJs).toContain('role: formattedNip');

            // 2. Header pill bulan bersih tanpa "Sebulan Penuh" dan tanpa ikon/angka 1
            expect(sharedJs).toContain('.replace(/^sebulan penuh\\s*[·•-]?\\s*/i, \'\')');
            expect(sharedJs).toContain('<div class="period-pill"><span>${esc(headerPeriodText)}</span></div>');

            // 3. Titimangsa footer tanggal cetak riil
            expect(freshJs).toContain('const now = new Date();');
            expect(freshJs).toContain('const printDay = now.getDate();');
            expect(freshJs).toContain('const printMonth = REKAP_MONTH_NAMES[now.getMonth()] || \'\';');
            expect(freshJs).toContain('const printYear = now.getFullYear();');
            expect(freshJs).toContain('const titimangsaStr = `${schoolCity}, ${printDay} ${printMonth} ${printYear}`;');
        });

        test('Cetak infografis guru: logo 36px, teks sekolah 10.5pt, pill 36px vertikal, dan font dinamis judul (maks 2 baris)', () => {
            const sharedJs = fs.readFileSync(path.join(__dirname, '../js/rekap-infographic.js'), 'utf8');

            // 1. Logo 36px & Teks Sekolah 10.5pt
            expect(sharedJs).toContain('.brand img { width: 36px; height: 36px;');
            expect(sharedJs).toContain('font-size: 10.5pt; font-weight: 800;');

            // 2. Pill Bulan Selaras 36px
            expect(sharedJs).toContain('.period-pill { display: inline-flex; align-items: center; justify-content: center; height: 36px;');

            // 3. Helper computeRekapTitleFontSize & Line Clamp 2
            expect(sharedJs).toContain('export function computeRekapTitleFontSize');
            expect(sharedJs).toContain('-webkit-line-clamp: 2; line-clamp: 2;');
            expect(sharedJs).toContain('word-break: break-word;');

            // Evaluasi logika dinamis computeRekapTitleFontSize
            const computeFn = (title, isLandscape) => {
                const len = String(title || '').trim().length;
                if (len <= 28) return isLandscape ? '18pt' : '20pt';
                if (len <= 50) return isLandscape ? '14pt' : '15pt';
                if (len <= 75) return isLandscape ? '11.5pt' : '12.5pt';
                return isLandscape ? '10pt' : '11pt';
            };
            expect(computeFn('Guru Piket Sekolah', false)).toBe('20pt');
            expect(computeFn('Penyusunan Perangkat Pembelajaran dan Modul Ajar', false)).toBe('15pt');
            expect(computeFn('Pengelolaan Laboratorium Komputer dan Jaringan Internet Sekolah', false)).toBe('12.5pt');
            expect(computeFn('Pelaksanaan Program Penguatan Profil Pelajar Pancasila (P5) dan Ekstrakurikuler Wajib Gerakan Pramuka Sekolah', false)).toBe('11pt');
            expect(computeFn('Pelaksanaan Program Penguatan Profil Pelajar Pancasila (P5) dan Ekstrakurikuler Wajib Gerakan Pramuka Sekolah', true)).toBe('10pt');
        });

        test('Cetak infografis guru: durasi kegiatan di samping tanggal (⏱ durasi), tanpa rentang jam, tanda disetujui dihilangkan (chips kosong), dan penyesuaian font dinamis caption panjang anti-terpotong', () => {
            const freshJs = fs.readFileSync(pageJsPath, 'utf8');
            const sharedJs = fs.readFileSync(path.join(__dirname, '../js/rekap-infographic.js'), 'utf8');

            // 1. Durasi di samping tanggal dan chips kosong (tanpa tanda disetujui)
            expect(freshJs).toContain('timeStr: `⏱ ${durStr}${jpTxt}`,');
            expect(freshJs).toContain('chips: [],');

            // 2. Helper computeRekapActivityTitleStyle diekspor
            expect(sharedJs).toContain('export function computeRekapActivityTitleStyle');

            // 3. Template mengaplikasikan titleStyle dinamis pada elemen h3.title
            expect(sharedJs).toContain('const titleStyle = computeRekapActivityTitleStyle(act.title, tier);');
            expect(sharedJs).toMatch(/<h3 class="title"\$\{titleStyle \?/);

            // 4. Verifikasi logika dinamis ukuran font berdasarkan panjang judul
            const titleStyleFn = (title) => {
                const len = String(title || '').trim().length;
                if (len > 70) return 'font-size: 7.2pt; line-height: 1.18; -webkit-line-clamp: 4;';
                if (len > 45) return 'font-size: 8pt; line-height: 1.2; -webkit-line-clamp: 3;';
                return '';
            };

            // Judul pendek (< 45 chars): font bawaan
            expect(titleStyleFn('Mengawasi Piket')).toBe('');
            // Judul sedang (46 - 70 chars): font 8pt, line clamp 3
            expect(titleStyleFn('Mengontrol kedisiplinan siswa ketika mengikuti Jam Belajar Mengajar')).toBe('font-size: 8pt; line-height: 1.2; -webkit-line-clamp: 3;');
            // Judul panjang (> 70 chars): font 7.2pt, line clamp 4
            expect(titleStyleFn('Menjadi petugas di meja piket untuk mengontrol siswa yang berencana permisi keluar sekolah')).toBe('font-size: 7.2pt; line-height: 1.18; -webkit-line-clamp: 4;');
        });
    });

    describe('5. Verifikasi Penyembunyian Toolbar Realisasi (Gantt, Fokus, Sinkron, Ekspor Word) di Tab Rekap', () => {
        test('Fungsi updateRealisasiToolbarVisibility diekspor dan terikat ke window', () => {
            const freshJsContent = fs.readFileSync(pageJsPath, 'utf8');
            expect(freshJsContent).toContain('export function updateRealisasiToolbarVisibility');
            expect(freshJsContent).toContain('window.workloadUpdateRealisasiToolbarVisibility = updateRealisasiToolbarVisibility');
        });

        test('Toolbar realisasi (#tab-realisasi-toolbar) disembunyikan dengan display none dan pembersihan md:flex saat di luar tab-today', () => {
            const freshJsContent = fs.readFileSync(pageJsPath, 'utf8');
            expect(freshJsContent).toContain("realisasiToolbar.classList.add('hidden', '!hidden')");
            expect(freshJsContent).toMatch(/realisasiToolbar\.classList\.remove\([^)]*'md:flex'/);
            expect(freshJsContent).toContain("realisasiToolbar.style.display = 'none'");
        });

        test('renderRekapTab, renderPlanTab, renderTemplatesTab, dan renderRegulasiTab memanggil updateRealisasiToolbarVisibility', () => {
            const freshJsContent = fs.readFileSync(pageJsPath, 'utf8');
            expect(freshJsContent).toMatch(/function renderRekapTab[^{]*\{[\s\S]*?updateRealisasiToolbarVisibility\(\)/);
            expect(freshJsContent).toMatch(/function renderPlanTab[^{]*\{[\s\S]*?updateRealisasiToolbarVisibility\(\)/);
            expect(freshJsContent).toMatch(/function renderTemplatesTab[^{]*\{[\s\S]*?updateRealisasiToolbarVisibility\(\)/);
            expect(freshJsContent).toMatch(/function renderRegulasiTab[^{]*\{[\s\S]*?updateRealisasiToolbarVisibility\(\)/);
        });
    });

    describe('6. Verifikasi Pembatasan Hak Akses VIP (Super Admin & Kepala Sekolah) dan Modal Early Access', () => {
        test('Tombol tab Rekap Realisasi (#tab-btn-rekap) memuat badge VIP', () => {
            const freshHtml = fs.readFileSync(pageHtmlPath, 'utf8');
            expect(freshHtml).toContain('id="tab-btn-rekap"');
            expect(freshHtml).toContain('VIP');
            expect(freshHtml).toContain('fa-crown');
        });

        test('Modal pemberitahuan fitur premium (#modal-rekap-premium-notice) berdiri mandiri di luar <main> (Anti-Nesting)', () => {
            const freshHtml = fs.readFileSync(pageHtmlPath, 'utf8');
            expect(freshHtml).toContain('id="modal-rekap-premium-notice"');
            expect(freshHtml).toContain('SIMAS VIP');
            expect(freshHtml).toContain('Rekapitulasi Kinerja & Portofolio');
            expect(freshHtml).toContain('Akses terbatas dan dalam tahap pengembangan.');
            
            const mainClosingIdx = freshHtml.indexOf('</main>');
            const modalNoticeIdx = freshHtml.indexOf('id="modal-rekap-premium-notice"');
            expect(mainClosingIdx).toBeGreaterThan(-1);
            expect(modalNoticeIdx).toBeGreaterThan(mainClosingIdx);
        });

        test('Fungsi-fungsi kontrol akses VIP diekspor dan terikat ke window di js/page-beban-kerja.js', () => {
            const freshJs = fs.readFileSync(pageJsPath, 'utf8');
            expect(freshJs).toContain('export function canAccessMonthlyRecap');
            expect(freshJs).toContain('export function openRekapPremiumModal');
            expect(freshJs).toContain('export function closeRekapPremiumModal');
            expect(freshJs).toContain('window.workloadCanAccessMonthlyRecap = canAccessMonthlyRecap');
            expect(freshJs).toContain('window.workloadOpenRekapPremiumModal = openRekapPremiumModal');
            expect(freshJs).toContain('window.workloadCloseRekapPremiumModal = closeRekapPremiumModal');
        });

        test('switchTab dan renderRekapTab mengadang akses non-Super Admin/Kepsek dengan modal premium', () => {
            const freshJs = fs.readFileSync(pageJsPath, 'utf8');
            expect(freshJs).toMatch(/tabId\s*===\s*'tab-rekap'\s*&&\s*!canAccessMonthlyRecap\(\)[\s\S]*?openRekapPremiumModal\(\)/);
            expect(freshJs).toMatch(/function renderRekapTab[^{]*\{[\s\S]*?!canAccessMonthlyRecap\(\)[\s\S]*?openRekapPremiumModal\(\)/);
        });
    });
});

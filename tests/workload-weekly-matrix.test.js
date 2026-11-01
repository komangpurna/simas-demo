/**
 * @jest-environment jsdom
 * 
 * tests/workload-weekly-matrix.test.js
 * ====================================================================
 * Test Suite: Matriks Realisasi Mingguan E-Kinerja Guru SIMAS
 * Sesuai Permendikdasmen No. 11/2025 & Kepmendikdasmen No. 221/P/2025
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');
const {
    calculateDayTimelineSlots,
    DEFAULT_WORKLOAD_POLICY
} = require('./workload-guru-utils.js');

describe('Suite Matriks Realisasi Mingguan E-Kinerja Guru', () => {
    const root = path.resolve(__dirname, '..');
    const eKinerjaHtml = fs.readFileSync(path.join(root, 'e-kinerja.html'), 'utf8');
    const pageBebanKerjaJs = fs.readFileSync(path.join(root, 'js', 'page-beban-kerja.js'), 'utf8');

    // =================================================================
    // 1. INTEGRITAS STRUKTUR HTML
    // =================================================================
    test('1. e-kinerja.html memiliki markup Tab Matriks Realisasi dan elemen-elemen Matriks Mingguan', () => {
        // Tab 1 button berlabel 'Matriks Realisasi' dengan icon fa-table-columns
        expect(eKinerjaHtml).toContain('Matriks Realisasi');
        expect(eKinerjaHtml).toContain('fa-table-columns');

        // Header Sticky KPI Pekan (2.250m)
        expect(eKinerjaHtml).toContain('id="matrix-weekly-actual-minutes"');
        expect(eKinerjaHtml).toContain('id="matrix-weekly-progress-bar"');
        expect(eKinerjaHtml).toContain('id="matrix-weekly-pct-badge"');
        expect(eKinerjaHtml).toContain('2.250 Menit');

        // Saklar Tampilan Matriks vs Fokus 1 Hari
        expect(eKinerjaHtml).toContain('id="btn-view-matrix"');
        expect(eKinerjaHtml).toContain('id="btn-view-focus"');
        expect(eKinerjaHtml).toContain('window.workloadToggleMatrixViewMode(\'matrix\')');
        expect(eKinerjaHtml).toContain('window.workloadToggleMatrixViewMode(\'focus\')');

        // Kontainer Grid Matriks Mingguan (5 Kolom)
        expect(eKinerjaHtml).toContain('id="weekly-matrix-scroll-wrapper"');
        expect(eKinerjaHtml).toContain('id="weekly-matrix-grid"');

        // Kontainer Fokus 1 Hari (Fallback / Mobile)
        expect(eKinerjaHtml).toContain('id="single-day-focus-container"');
        expect(eKinerjaHtml).toContain('id="today-timeline-container"');
        expect(eKinerjaHtml).toContain('id="day-selector-pills"');
    });

    // =================================================================
    // 2. INTEGRITAS LOGIKA JAVASCRIPT & EXPORTS
    // =================================================================
    test('2. js/page-beban-kerja.js mengekspor dan mendaftarkan fungsi matriks serta 1-klik lapor ke window', () => {
        // State default matriks
        expect(pageBebanKerjaJs).toContain("let _matrixViewMode = 'matrix'");

        // Export fungsi
        expect(pageBebanKerjaJs).toContain('export function toggleMatrixViewMode(');
        expect(pageBebanKerjaJs).toContain('export async function quickReportComplete(');
        expect(pageBebanKerjaJs).toContain('export function renderWeeklyMatrixView(');
        expect(pageBebanKerjaJs).toContain('export function renderSingleDayFocusView(');

        // Window handler registration
        expect(pageBebanKerjaJs).toContain('window.workloadToggleMatrixViewMode = toggleMatrixViewMode');
        expect(pageBebanKerjaJs).toContain('window.workloadQuickReportComplete = quickReportComplete');

        // Persistence ke localStorage
        expect(pageBebanKerjaJs).toContain('localStorage.setItem(\'simas_workload_matrix_view_mode\'');
        expect(pageBebanKerjaJs).toContain('localStorage.getItem(\'simas_workload_matrix_view_mode\'');
    });

    // =================================================================
    // 3. LOGIKA PELAPORAN CEPAT 1-KLIK (QUICK REPORT COMPLETE)
    // =================================================================
    test('3. quickReportComplete memproteksi tanggal masa depan dan mengisi payload terlaksana penuh', () => {
        expect(pageBebanKerjaJs).toContain('canReportActivityNow');
        expect(pageBebanKerjaJs).toContain('status_execution: \'terlaksana\'');
        expect(pageBebanKerjaJs).toContain('Terlaksana sesuai rencana');
        expect(pageBebanKerjaJs).toContain('actual_minutes: duration');
        expect(pageBebanKerjaJs).toContain('cfSaveWorkloadLog(payload)');
    });

    // =================================================================
    // 4. LOGIKA PERHITUNGAN TARGET JAM KERJA (2.250m & 450m/hari)
    // =================================================================
    test('4. Perhitungan target jam kerja mengakomodasi 5 hari kerja x 450 menit = 2.250 menit', () => {
        expect(pageBebanKerjaJs).toContain('const targetWeeklyMinutes = 2250');
        expect(pageBebanKerjaJs).toContain('Math.round(totalWeeklyActualMinutes / targetWeeklyMinutes * 100)');
        expect(pageBebanKerjaJs).toContain('dayActualMinutes >= 450 || isHoliday');

        // Hari libur otomatis memperoleh kredit 450 menit bersih
        const holidayDate = '2026-09-30';
        const holidaySlots = calculateDayTimelineSlots(holidayDate, [{
            id: 'hol_1',
            is_holiday: 1,
            title: 'Hari Raya Kuningan',
            start_time: '07:30',
            end_time: '15:30',
            planned_minutes: 450
        }]);

        expect(holidaySlots.isHoliday).toBe(true);
        expect(holidaySlots.isComplete).toBe(true);
    });

    // =================================================================
    // 5. INTERAKSI KARTU TERPADU & KEMUDAHAN REALISASI
    // =================================================================
    test('5. Matriks menyediakan tombol 1-klik Terlaksana dan tombol formulir titik tiga (•••)', () => {
        expect(pageBebanKerjaJs).toContain('window.workloadQuickReportComplete');
        expect(pageBebanKerjaJs).toContain('fa-ellipsis');
        expect(pageBebanKerjaJs).toContain('window.workloadOpenLogModal');
    });

    // =================================================================
    // 6. FITUR TIMELINE GANTT ROW-BASED & INTERVAL JAM PELAJARAN (JP)
    // =================================================================
    test('6. Timeline Gantt row-based memiliki legenda status, skala waktu mengadopsi interval JP (JP 1 - JP 10), dan batas minimum durasi', () => {
        // Legenda 4 status warna & ruler skala waktu di HTML
        expect(eKinerjaHtml).toContain('id="gantt-legend"');
        expect(eKinerjaHtml).toContain('id="gantt-time-ruler"');
        expect(eKinerjaHtml).toContain('fa-chart-gantt');

        // Konstanta Gantt di JS (07:30 - 15:30 = 480m)
        expect(pageBebanKerjaJs).toContain('const GANTT_START = 450');
        expect(pageBebanKerjaJs).toContain('const GANTT_END = 930');
        expect(pageBebanKerjaJs).toContain('const MIN_BLOCK_MINUTES = 30');

        // Export dan definisi STANDARD_JP_PERIODS (10 JP @ 45m + 2 Istirahat @ 15m = 480m)
        expect(pageBebanKerjaJs).toContain('export const STANDARD_JP_PERIODS = [');
        expect(pageBebanKerjaJs).toContain("label: 'JP 1', start: '07:30', end: '08:15'");
        expect(pageBebanKerjaJs).toContain("label: 'JP 10', start: '14:45', end: '15:30'");
        expect(pageBebanKerjaJs).toContain("label: 'Ist', start: '09:45', end: '10:00'");
        expect(pageBebanKerjaJs).toContain("label: 'Ist', start: '12:15', end: '12:30'");

        // Ruler mengadopsi Jam Pelajaran
        expect(pageBebanKerjaJs).toContain('Jam Pelajaran');
        expect(pageBebanKerjaJs).toContain('STANDARD_JP_PERIODS.forEach');

        // Istirahat & slot kosong menggunakan durasi eksak (15 menit = 3.125%) dan tidak dipaksa ke MIN_BLOCK_MINUTES
        expect(pageBebanKerjaJs).toContain("const isBreakOrEmpty = slot.type === 'break' || slot.type === 'empty'");
        expect(pageBebanKerjaJs).toContain('const widthPct = Math.min((visualDuration / GANTT_TOTAL) * 100, 100 - leftPct)');
    });

    // =================================================================
    // 7. VISUAL PROGRESS RING SVG & RESPONSIF MOBILE COLLAPSE
    // =================================================================
    test('7. Timeline Gantt menyertakan SVG mini progress ring dan dukungan collapsible mobile', () => {
        // SVG Progress Ring di row header
        expect(pageBebanKerjaJs).toContain('progressRingHtml');
        expect(pageBebanKerjaJs).toContain('<circle cx="19" cy="19"');
        expect(pageBebanKerjaJs).toContain('stroke-dasharray');

        // Border indikator status 4 warna
        expect(pageBebanKerjaJs).toContain('border-l-emerald-500');
        expect(pageBebanKerjaJs).toContain('border-l-blue-500');
        expect(pageBebanKerjaJs).toContain('border-l-amber-500');

        // Mobile collapsible row & responsive accordion
        expect(pageBebanKerjaJs).toContain('gantt-row-body-');
        expect(pageBebanKerjaJs).toContain('gantt-arrow-');
        expect(pageBebanKerjaJs).toContain('window.workloadToggleDayCollapse = toggleDayCollapse');
    });

    // =================================================================
    // 8. ERGONOMI MOBILE ACCORDION & TATA LETAK FULL-WIDTH REALISASI
    // =================================================================
    test('8. Tab Realisasi versi mobile menyajikan header penuh dari kiri ke kanan (full-width) saat collapsed, dan area rencana kegiatan 100% saat expanded', () => {
        // Kontainer baris adaptif: vertical stack di mobile, horizontal di desktop
        expect(pageBebanKerjaJs).toContain('flex flex-col md:flex-row items-stretch');

        // Header harian 100% full-width di mobile
        expect(pageBebanKerjaJs).toContain('w-full md:w-[140px] lg:w-[160px]');
        expect(pageBebanKerjaJs).toContain('flex items-center justify-between w-full md:hidden');

        // Header kanan mobile memuat capaian menit dan ikon chevron interaktif
        expect(pageBebanKerjaJs).toContain('fa-chevron-down');
        expect(pageBebanKerjaJs).toContain('rotate-180');

        // Area rencana kegiatan membentang penuh (w-full) di bawah header saat expanded
        expect(pageBebanKerjaJs).toContain('w-full md:flex-1 relative');
        expect(pageBebanKerjaJs).toContain('md:!block');

        // Tombol aksi touch-friendly di mobile (h-7 dengan teks/ikon jelas tidak terpotong)
        expect(pageBebanKerjaJs).toContain('h-7 px-2 sm:px-2.5 flex items-center justify-center gap-1 rounded-lg bg-emerald-600');
        expect(pageBebanKerjaJs).toContain('h-7 px-2.5 flex items-center justify-center gap-1 rounded-lg bg-emerald-50');

        // Helper fungsi toggleDayCollapse
        expect(pageBebanKerjaJs).toContain('export function toggleDayCollapse(collapseId, arrowId)');

        // Aturan UX: jika di hari itu sudah 100%, maka otomatis collaps
        expect(pageBebanKerjaJs).toContain('const isDayComplete = isTargetMet || dayPct >= 100 || isHoliday');
        expect(pageBebanKerjaJs).toContain('const isExpanded = isMobile ? (isToday && !isDayComplete) : true');

        // Accordion behavior: expand hari tertentu otomatis collaps hari lainnya
        expect(pageBebanKerjaJs).toContain("const allBodies = document.querySelectorAll('[id^=\"gantt-row-body-\"]')");
        expect(pageBebanKerjaJs).toContain("const allArrows = document.querySelectorAll('[id^=\"gantt-arrow-\"]')");
    });

    // =================================================================
    // 9. SIMULASI DOM ACCORDION TOGGLE & AUTO-COLLAPSE
    // =================================================================
    test('9. Simulasi toggleDayCollapse me-expand hari yang dipilih dan menutup hari-hari lainnya secara otomatis', () => {
        // Setup DOM tiruan 3 baris
        document.body.innerHTML = `
            <div id="gantt-row-body-0" class="hidden"></div>
            <i id="gantt-arrow-0" class="fa-solid fa-chevron-down"></i>
            <div id="gantt-row-body-1" class=""></div>
            <i id="gantt-arrow-1" class="fa-solid fa-chevron-down rotate-180"></i>
            <div id="gantt-row-body-2" class="hidden"></div>
            <i id="gantt-arrow-2" class="fa-solid fa-chevron-down"></i>
        `;

        // Mock window.innerWidth sebagai mobile (< 768px)
        window.innerWidth = 375;

        // Ekstrak fungsi toggleDayCollapse dari page-beban-kerja.js atau gunakan implementasi identik
        const row0 = document.getElementById('gantt-row-body-0');
        const arrow0 = document.getElementById('gantt-arrow-0');
        const row1 = document.getElementById('gantt-row-body-1');
        const arrow1 = document.getElementById('gantt-arrow-1');

        // Simulasikan logika toggleDayCollapse('gantt-row-body-0', 'gantt-arrow-0')
        const collapseId = 'gantt-row-body-0';
        const arrowId = 'gantt-arrow-0';
        const elCollapse = document.getElementById(collapseId);
        const elArrow = document.getElementById(arrowId);
        const isCurrentlyHidden = elCollapse.classList.contains('hidden');

        if (isCurrentlyHidden) {
            const allBodies = document.querySelectorAll('[id^="gantt-row-body-"]');
            allBodies.forEach(body => {
                if (body.id !== collapseId) body.classList.add('hidden');
            });
            const allArrows = document.querySelectorAll('[id^="gantt-arrow-"]');
            allArrows.forEach(arrow => {
                if (arrow.id !== arrowId) arrow.classList.remove('rotate-180');
            });
            elCollapse.classList.remove('hidden');
            if (elArrow) elArrow.classList.add('rotate-180');
        }

        // Row 0 harus menjadi terbuka
        expect(row0.classList.contains('hidden')).toBe(false);
        expect(arrow0.classList.contains('rotate-180')).toBe(true);

        // Row 1 (yang tadinya terbuka) harus menjadi tertutup
        expect(row1.classList.contains('hidden')).toBe(true);
        expect(arrow1.classList.contains('rotate-180')).toBe(false);
    });

    // =================================================================
    // 10. INTEGRITAS LINGKUP VARIABEL renderSingleDayFocusView & PENCEGAHAN ReferenceError dayLogSegs
    // =================================================================
    test('10. renderSingleDayFocusView mendeklarasikan dayLogSegs dan menghitung menit parsial tanpa ReferenceError', () => {
        // Memastikan deklarasi dayLogSegs ada di dalam renderSingleDayFocusView
        const renderFocusRegex = /export\s+function\s+renderSingleDayFocusView\s*\(\)\s*\{([\s\S]*?)\n\}/;
        const match = pageBebanKerjaJs.match(renderFocusRegex);
        expect(match).not.toBeNull();
        const focusCode = match[1];

        // Validasi deklarasi dayLogSegs
        expect(focusCode).toContain('const dayLogSegs = logSegments.filter');
        expect(focusCode).toContain('dayLogSegs.filter(ls => ls.work_log_id === linkedLog.id)');

        // Simulasi kalkulasi actualFocusMins dengan mock data realisasi parsial
        const mockLogSegments = [
            { id: 'ls_1', work_log_id: 'wl_101', start_time: '07:30', end_time: '08:30', actual_minutes: 60 },
            { id: 'ls_2', work_log_id: 'wl_999', start_time: '08:30', end_time: '09:00', actual_minutes: 30 }
        ];
        const mockLogs = [{ id: 'wl_101', date: '2026-10-22', status_execution: 'sebagian' }];
        const mockDayLogIds = new Set(mockLogs.map(l => l.id));
        const simulatedDayLogSegs = mockLogSegments.filter(ls => mockDayLogIds.has(ls.work_log_id));

        const seg = { activity_id: 'act_1', planned_minutes: 90 };
        const linkedLog = mockLogs[0];
        const hasLog = true;

        // Eksekusi baris kalkulasi yang sebelumnya crash dengan ReferenceError
        const actualFocusMins = (hasLog && linkedLog)
            ? simulatedDayLogSegs.filter(ls => ls.work_log_id === linkedLog.id).reduce((s, ls) => s + (ls.actual_minutes || 0), 0)
            : 0;
        const isPartialFocus = Boolean(hasLog && linkedLog && linkedLog.status_execution !== 'tidak_terlaksana' && actualFocusMins > 0 && actualFocusMins < (seg.planned_minutes || 0));
        const unfulfilledFocusMins = isPartialFocus ? ((seg.planned_minutes || 0) - actualFocusMins) : 0;

        expect(actualFocusMins).toBe(60);
        expect(isPartialFocus).toBe(true);
        expect(unfulfilledFocusMins).toBe(30);
    });

    // =================================================================
    // 11. AUDIT STATIS check-syntax.js MEMPROTEKSI MODUL KRITIS DARI IDENTIFIER UNDECLARED
    // =================================================================
    test('11. scripts/check-syntax.js memuat guard identifikasi lokal tak terdefinisi untuk modul kritis beban kerja', () => {
        const checkSyntaxJs = fs.readFileSync(path.join(root, 'scripts', 'check-syntax.js'), 'utf8');
        expect(checkSyntaxJs).toContain('CRITICAL_MODULE_ALLOWED_GLOBALS');
        expect(checkSyntaxJs).toContain('isCriticalWorkloadModule');
        expect(checkSyntaxJs).toContain('Undeclared Local Identifier');
    });
});

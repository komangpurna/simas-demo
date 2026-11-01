const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

describe('Validasi Fitur Rekapitulasi Kehadiran Mapel Semester di Jurnal Mengajar (Ghost Pill 1-Baris & Expand Lega)', () => {
    const jurnalHtml = fs.readFileSync(path.join(projectRoot, 'jurnal.html'), 'utf8');
    const pageJurnalJs = fs.readFileSync(path.join(projectRoot, 'js', 'page-jurnal.js'), 'utf8');

    describe('1. Kebersihan DOM & Integrasi Anti-Popup (jurnal.html)', () => {
        test('Modal popover overlay lama #modal-student-recap dihapus bersih dari DOM agar tidak mengganggu presensi', () => {
            expect(jurnalHtml).not.toContain('id="modal-student-recap"');
            expect(jurnalHtml).not.toContain('id="student-recap-overlay"');
            expect(jurnalHtml).not.toContain('id="student-recap-content"');
        });

        test('Kontainer daftar siswa #student-list tersedia untuk menampung inline accordion', () => {
            expect(jurnalHtml).toContain('id="student-list"');
            expect(jurnalHtml).toContain('id="presensi-summary"');
        });
    });

    describe('2. Struktur Baris Siswa Normal: Ghost Pill 1-Baris & Anti-Truncate (js/page-jurnal.js)', () => {
        test('Nama siswa bebas dari truncate dan menggunakan break-words min-w-0 flex-1 agar nama panjang tidak terpotong titik-titik', () => {
            expect(pageJurnalJs).toContain('break-words text-left min-w-0 flex-1 leading-tight student-name');
            expect(pageJurnalJs).not.toContain('truncate text-left student-name');
        });

        test('Menampilkan Ghost Pill persentase 1 baris bersama nama di ujung kanan sebelum tombol presensi', () => {
            expect(pageJurnalJs).toContain('student-ghost-pill');
            expect(pageJurnalJs).toContain('id="recap-ghost-pill-${s.id}"');
            expect(pageJurnalJs).toContain('opacity-60 hover:opacity-100');
            expect(pageJurnalJs).toContain('--%');
        });
    });

    describe('3. Struktur Panel Expand 2-Baris Lega (Tanpa Persentase di Dalam Expand)', () => {
        test('Panel expand tidak memuat persentase (karena sudah dipindah ke baris utama sebagai ghost pill)', () => {
            expect(pageJurnalJs).toContain('student-recap-panel');
            expect(pageJurnalJs).toContain('id="student-recap-panel-${s.id}"');
            expect(pageJurnalJs).not.toContain('id="recap-panel-badge-${s.id}"');
        });

        test('Baris 1 panel expand memuat 6 counter status (H, S, I, A, D, T) yang lebih lebar & alert alpa', () => {
            expect(pageJurnalJs).toContain('id="recap-panel-h-${s.id}"');
            expect(pageJurnalJs).toContain('id="recap-panel-s-${s.id}"');
            expect(pageJurnalJs).toContain('id="recap-panel-i-${s.id}"');
            expect(pageJurnalJs).toContain('id="recap-panel-a-${s.id}"');
            expect(pageJurnalJs).toContain('id="recap-panel-d-${s.id}"');
            expect(pageJurnalJs).toContain('id="recap-panel-t-${s.id}"');
            expect(pageJurnalJs).toContain('id="recap-panel-alert-${s.id}"');
        });

        test('Baris 2 panel expand memuat 5 pertemuan terakhir format d/m: Status dengan label Riwayat', () => {
            expect(pageJurnalJs).toContain('id="recap-panel-recent-${s.id}"');
            expect(pageJurnalJs).toContain('formatDMDate');
            expect(pageJurnalJs).toContain('${dm}:');
            expect(pageJurnalJs).toContain('Riwayat:');
            expect(pageJurnalJs).not.toContain('Riwayat Lampau:');
        });

        test('Fungsi formatDMDate menghasilkan format d/m secara akurat', () => {
            const fnMatch = pageJurnalJs.match(/function formatDMDate\([\s\S]*?^\}/m);
            expect(fnMatch).not.toBeNull();
            const formatDMDate = new Function(`${fnMatch[0]}; return formatDMDate;`)();
            expect(formatDMDate('2026-10-12')).toBe('12/10');
            expect(formatDMDate('2026-10-05')).toBe('5/10');
            expect(formatDMDate('12-10-2026')).toBe('12/10');
            expect(formatDMDate(null)).toBe('-');
        });
    });

    describe('4. Logika Interaksi Accordion, Auto-Collapse 10 Detik & Reaktivitas', () => {
        test('Mendefinisikan fungsi kontrol accordion dan auto-collapse 10 detik', () => {
            expect(pageJurnalJs).toContain('STUDENT_RECAP_AUTO_COLLAPSE_MS = 10000');
            expect(pageJurnalJs).toContain('window.studentRecapCollapseTimer');
            expect(pageJurnalJs).toContain('window.closeAllStudentRecapPanels');
            expect(pageJurnalJs).toContain('window.toggleStudentRecapPanel');
            expect(pageJurnalJs).toContain('window.openStudentRecapPanel');
            expect(pageJurnalJs).toContain('window.updateOpenStudentRecapPanel');
        });

        test('Mendukung interaksi klik toggle pada baris siswa dan ghost pill', () => {
            expect(pageJurnalJs).toContain('window.handleStudentRowClick(this)');
            expect(pageJurnalJs).toContain("window.handleStudentRowClick(this.closest('.student-row'))");
            expect(pageJurnalJs).toContain('window.activeExpandedStudentId === sId');
        });

        test('Memperbarui ghost pill persentase dan counter panel secara dinamis di dalam window.setAttendance', () => {
            expect(pageJurnalJs).toContain('window.updateStudentRecapBadge(id)');
            expect(pageJurnalJs).toContain('window.updateOpenPopoverIfMatching(id)');
        });

        test('Menerapkan styling semantik warna transparan pada updateStudentRecapBadge (ghost pill)', () => {
            expect(pageJurnalJs).toContain('bg-emerald-500/10');
            expect(pageJurnalJs).toContain('bg-amber-500/10');
            expect(pageJurnalJs).toContain('bg-rose-500/10');
        });

        test('Menerapkan formula kehadiran murni dan threshold warna status', () => {
            expect(pageJurnalJs).toMatch(/Math\.round\(\(counts\.H\s*\/\s*totalMeetings\)\s*\*\s*100\)/);
            expect(pageJurnalJs).toContain("statusColor = 'rose'");
            expect(pageJurnalJs).toContain("statusColor = 'amber'");
            expect(pageJurnalJs).toContain("statusColor = 'emerald'");
            expect(pageJurnalJs).toContain('counts.A > 0');
        });
    });
});

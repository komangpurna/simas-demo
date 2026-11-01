/**
 * tests/workload-overtime-real-display.test.js
 * ====================================================================
 * Unit Test: Tampilan Data Riil Jam Kerja Lebih (Lembur) & Auto-Adjust
 * Durasi Tugas Tambahan Tanpa Pemotongan Sepihak (Anti-Truncation Mandate).
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');
const {
    calculateDayTimelineSlots,
    DEFAULT_WORKLOAD_POLICY
} = require('./workload-guru-utils.js');

describe('Transparansi Data Riil Beban Kerja & Dukungan Jam Kerja Lebih (Anti-Truncation)', () => {
    const root = path.resolve(__dirname, '..');
    const pageBebanKerjaPath = path.join(root, 'js', 'page-beban-kerja.js');
    const workloadCalcPath = path.join(root, 'js', 'workload-calc.js');

    const pageContent = fs.readFileSync(pageBebanKerjaPath, 'utf8');
    const calcContent = fs.readFileSync(workloadCalcPath, 'utf8');

    test('1. Kasus Hari Kamis Riil: Kegiatan 14:00–23:00 (540m) tampil utuh tanpa terpotong di 15:30', () => {
        const thursdaySegments = [
            {
                id: 'seg_1',
                date: '2026-10-29',
                start_time: '07:30',
                end_time: '09:45',
                planned_minutes: 135,
                title: 'Menginput nilai asesmen ke dalam buku nilai'
            },
            {
                id: 'seg_2',
                date: '2026-10-29',
                start_time: '10:00',
                end_time: '11:30',
                planned_minutes: 90,
                title: 'KBM Biologi (XI-2)'
            },
            {
                id: 'seg_3',
                date: '2026-10-29',
                start_time: '11:30',
                end_time: '14:00',
                planned_minutes: 135,
                title: 'KBM Biologi (XI-3)'
            },
            {
                id: 'seg_4',
                date: '2026-10-29',
                start_time: '14:00',
                end_time: '23:00',
                planned_minutes: 540,
                title: 'Mengkoordinasikan pelaksanaan Projek/P5 atau kegiatan kokurikuler sesuai kebijakan kurikulum yang berlaku.'
            }
        ];

        const timeline = calculateDayTimelineSlots('2026-10-29', thursdaySegments);

        // Cari slot kegiatan ke-4
        const p5Slot = timeline.slots.find(s => s.id === 'seg_4');
        expect(p5Slot).toBeDefined();
        expect(p5Slot.startTime).toBe('14:00');
        expect(p5Slot.endTime).toBe('23:00'); // Tidak boleh dipotong jadi 15:30!
        expect(p5Slot.durationMinutes).toBe(540); // Durasi riil 540m
        expect(p5Slot.isOvertime).toBe(true); // Ditandai lembur / luar jam reguler

        // Verifikasi paritas total menit: seluruh slot kegiatan dijumlahkan harus tepat 900 menit
        const totalActivityMinutesInSlots = timeline.slots
            .filter(s => s.type === 'activity')
            .reduce((sum, s) => sum + s.durationMinutes, 0);

        expect(totalActivityMinutesInSlots).toBe(900);
        expect(timeline.totalPlannedMinutes).toBe(900);
        expect(totalActivityMinutesInSlots).toBe(timeline.totalPlannedMinutes);
        expect(timeline.emptyMinutes).toBe(0);
        expect(timeline.isComplete).toBe(true);
    });

    test('2. Kegiatan dinas sore (misal 14:45–16:15) tampil utuh dan diakomodir', () => {
        const segments = [
            {
                id: 'seg_sore',
                date: '2026-10-28',
                start_time: '14:45',
                end_time: '16:15',
                planned_minutes: 90,
                title: 'Pendampingan siswa lomba'
            }
        ];

        const timeline = calculateDayTimelineSlots('2026-10-28', segments);
        const soreSlot = timeline.slots.find(s => s.id === 'seg_sore');
        expect(soreSlot).toBeDefined();
        expect(soreSlot.startTime).toBe('14:45');
        expect(soreSlot.endTime).toBe('16:15');
        expect(soreSlot.durationMinutes).toBe(90);
        expect(soreSlot.isOvertime).toBe(true);
    });

    test('3. Kode page-beban-kerja.js mengimplementasikan durasi default 1 JP (45m) dan memproteksi jam akhir murni guru agar durasi katalog mingguan (540m) tidak membanjiri jam kerja', () => {
        // SSOT Permen 11/2025 & Pure Time: Form rencana baru menggunakan default 1 JP (45m) dan memproteksi jam akhir yang diisi guru
        expect(pageContent).toContain('const defaultPlanDurMin = 45;');
        expect(pageContent).toContain('!currentEnd && start && endInput');
    });

    test('4. UI Accordion menampilkan badge Luar Jam Reguler untuk transparansi pengguna', () => {
        expect(pageContent).toContain('Luar Jam Reguler');
        expect(pageContent).toContain('isOvertime');
    });

    test('5. Algoritma workload-calc.js tidak memotong segmentEnd pada workEndMin secara sepihak', () => {
        expect(calcContent).toContain('const segmentEnd = nextBreak ? nextBreak.startMin : maxActEnd;');
        expect(calcContent).toContain('isOvertime: subEnd > workEndMin');
    });
});

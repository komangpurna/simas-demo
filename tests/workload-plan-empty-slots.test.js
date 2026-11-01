/**
 * tests/workload-plan-empty-slots.test.js
 * ====================================================================
 * Test Suite: Deteksi & Visualisasi Slot Jam Kosong, Istirahat Resmi,
 * Penanda Libur Sekolah, dan Proteksi Pengesahan Rencana Mingguan Guru.
 * Kepatuhan: Permendikdasmen No. 11/2025 (450 menit bersih per hari kerja)
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');
const {
    calculateDayTimelineSlots,
    validateWeeklyPlanCompleteness,
    getDayDateString,
    DEFAULT_WORKLOAD_POLICY
} = require('./workload-guru-utils.js');

describe('Suite Pengujian Slot Jam Kosong & Kelengkapan Rencana Mingguan Guru', () => {
    const root = path.resolve(__dirname, '..');
    const pageBebanKerjaJs = fs.readFileSync(path.join(root, 'js', 'page-beban-kerja.js'), 'utf8');

    // =================================================================
    // 1. KALKULASI CELAH WAKTU PADA HARI KOSONG
    // =================================================================
    test('1. Hari kosong tanpa segmen menghasilkan 3 slot kosong dan 2 jeda istirahat resmi (total 450 menit kosong)', () => {
        const dateStr = '2026-09-28'; // Hari Senin
        const result = calculateDayTimelineSlots(dateStr, []);

        expect(result.isHoliday).toBe(false);
        expect(result.isComplete).toBe(false);
        expect(result.emptySlotsCount).toBe(3);
        expect(result.emptyMinutes).toBe(450); // 135 + 135 + 180 = 450m

        // Memastikan slot tersusun rapi secara kronologis
        expect(result.slots).toHaveLength(5);
        expect(result.slots[0]).toMatchObject({ type: 'empty', startTime: '07:30', endTime: '09:45', durationMinutes: 135 });
        expect(result.slots[1]).toMatchObject({ type: 'break', startTime: '09:45', endTime: '10:00', durationMinutes: 15 });
        expect(result.slots[2]).toMatchObject({ type: 'empty', startTime: '10:00', endTime: '12:15', durationMinutes: 135 });
        expect(result.slots[3]).toMatchObject({ type: 'break', startTime: '12:15', endTime: '12:30', durationMinutes: 15 });
        expect(result.slots[4]).toMatchObject({ type: 'empty', startTime: '12:30', endTime: '15:30', durationMinutes: 180 });
    });

    // =================================================================
    // 2. KALKULASI CELAH WAKTU PADA HARI TERISI SEBAGIAN
    // =================================================================
    test('2. Hari terisi sebagian memisahkan slot kegiatan, istirahat, dan slot kosong yang tersisa', () => {
        const dateStr = '2026-09-28';
        const daySegments = [
            {
                id: 'seg_1',
                date: dateStr,
                start_time: '07:30',
                end_time: '09:45',
                planned_minutes: 135,
                activity_title: 'KBM Matematika XII-A'
            },
            {
                id: 'seg_2',
                date: dateStr,
                start_time: '12:30',
                end_time: '14:00',
                planned_minutes: 90,
                activity_title: 'Penyusunan Modul Ajar'
            }
        ];

        const result = calculateDayTimelineSlots(dateStr, daySegments);

        expect(result.isHoliday).toBe(false);
        expect(result.isComplete).toBe(false);
        expect(result.totalPlannedMinutes).toBe(225); // 135 + 90
        expect(result.emptyMinutes).toBe(225); // 135 + 90 = 225m kosong (10:00-12:15 dan 14:00-15:30)
        expect(result.emptySlotsCount).toBe(2);

        // Slot 0: Kegiatan 1 (07:30 - 09:45)
        expect(result.slots[0].type).toBe('activity');
        expect(result.slots[0].startTime).toBe('07:30');
        expect(result.slots[0].endTime).toBe('09:45');

        // Slot 1: Istirahat 1 (09:45 - 10:00)
        expect(result.slots[1].type).toBe('break');
        expect(result.slots[1].startTime).toBe('09:45');
        expect(result.slots[1].endTime).toBe('10:00');

        // Slot 2: Jam Kosong 1 (10:00 - 12:15)
        expect(result.slots[2].type).toBe('empty');
        expect(result.slots[2].startTime).toBe('10:00');
        expect(result.slots[2].endTime).toBe('12:15');
        expect(result.slots[2].durationMinutes).toBe(135);

        // Slot 3: Istirahat 2 (12:15 - 12:30)
        expect(result.slots[3].type).toBe('break');
        expect(result.slots[3].startTime).toBe('12:15');
        expect(result.slots[3].endTime).toBe('12:30');

        // Slot 4: Kegiatan 2 (12:30 - 14:00)
        expect(result.slots[4].type).toBe('activity');
        expect(result.slots[4].startTime).toBe('12:30');
        expect(result.slots[4].endTime).toBe('14:00');

        // Slot 5: Jam Kosong 2 (14:00 - 15:30)
        expect(result.slots[5].type).toBe('empty');
        expect(result.slots[5].startTime).toBe('14:00');
        expect(result.slots[5].endTime).toBe('15:30');
        expect(result.slots[5].durationMinutes).toBe(90);
    });

    // =================================================================
    // 3. KALKULASI PADA HARI TERISI PENUH (0 SLOT KOSONG)
    // =================================================================
    test('3. Hari yang terisi penuh 450 menit bersih dinyatakan lengkap (isComplete: true, emptySlotsCount: 0)', () => {
        const dateStr = '2026-09-29';
        const daySegments = [
            { id: 'seg_1', date: dateStr, start_time: '07:30', end_time: '09:45', planned_minutes: 135, title: 'KBM Sesi 1' },
            { id: 'seg_2', date: dateStr, start_time: '10:00', end_time: '12:15', planned_minutes: 135, title: 'KBM Sesi 2' },
            { id: 'seg_3', date: dateStr, start_time: '12:30', end_time: '15:30', planned_minutes: 180, title: 'Tugas Tambahan & Administrasi' }
        ];

        const result = calculateDayTimelineSlots(dateStr, daySegments);

        expect(result.isHoliday).toBe(false);
        expect(result.isComplete).toBe(true);
        expect(result.emptySlotsCount).toBe(0);
        expect(result.emptyMinutes).toBe(0);
        expect(result.totalPlannedMinutes).toBe(450);
    });

    // =================================================================
    // 4. PENANGANAN HARI LIBUR / DISPENSASI RESMI SEKOLAH
    // =================================================================
    test('4. Hari yang ditandai Libur / Dispensasi Resmi Sekolah tidak menghasilkan slot kosong dan isComplete: true', () => {
        const dateStr = '2026-09-30';
        const daySegments = [
            {
                id: 'seg_holiday',
                date: dateStr,
                start_time: '07:30',
                end_time: '15:30',
                planned_minutes: 450,
                title: 'Libur / Dispensasi Resmi Sekolah',
                category_code: 'TUGAS_TAMBAHAN'
            }
        ];

        const result = calculateDayTimelineSlots(dateStr, daySegments);

        expect(result.isHoliday).toBe(true);
        expect(result.isComplete).toBe(true);
        expect(result.emptySlotsCount).toBe(0);
        expect(result.emptyMinutes).toBe(0);
        expect(result.slots).toHaveLength(1);
        expect(result.slots[0].type).toBe('holiday');
    });

    // =================================================================
    // 5. VALIDASI KELENGKAPAN MINGGUAN (PROTEKSI SUBMIT/PENGESAHAN)
    // =================================================================
    test('5. validateWeeklyPlanCompleteness menolak pengesahan jika masih ada slot kosong pada hari kerja non-libur', () => {
        const weekStartDate = '2026-09-28';
        // Rencana minggu hanya mengisi hari Senin penuh, hari lainnya kosong
        const segments = [
            { id: 'seg_1', date: '2026-09-28', start_time: '07:30', end_time: '09:45', planned_minutes: 135 },
            { id: 'seg_2', date: '2026-09-28', start_time: '10:00', end_time: '12:15', planned_minutes: 135 },
            { id: 'seg_3', date: '2026-09-28', start_time: '12:30', end_time: '15:30', planned_minutes: 180 }
        ];

        const completeness = validateWeeklyPlanCompleteness(weekStartDate, segments);

        expect(completeness.isValid).toBe(false);
        expect(completeness.incompleteDays.length).toBe(4); // Selasa, Rabu, Kamis, Jumat belum lengkap
        expect(completeness.totalEmptyMinutes).toBe(450 * 4); // 1800m
        expect(completeness.message).toMatch(/belum dapat (disahkan|difinalisasi\/diajukan|difinalisasi|diajukan) karena masih terdapat/);
        expect(completeness.message).toContain('Selasa');
    });

    test('6. validateWeeklyPlanCompleteness meloloskan rencana jika seluruh hari terisi penuh atau ditandai libur', () => {
        const weekStartDate = '2026-09-28';
        const segments = [];

        // 4 hari kerja aktif (Senin - Kamis) terisi penuh
        for (let i = 0; i < 4; i++) {
            const dt = getDayDateString(weekStartDate, i);
            segments.push(
                { id: `s_${i}_1`, date: dt, start_time: '07:30', end_time: '09:45', planned_minutes: 135 },
                { id: `s_${i}_2`, date: dt, start_time: '10:00', end_time: '12:15', planned_minutes: 135 },
                { id: `s_${i}_3`, date: dt, start_time: '12:30', end_time: '15:30', planned_minutes: 180 }
            );
        }

        // Hari ke-5 (Jumat, indeks 4) ditandai libur sekolah
        const fridayDate = getDayDateString(weekStartDate, 4);
        segments.push({
            id: 'seg_fri_holiday',
            date: fridayDate,
            start_time: '07:30',
            end_time: '15:30',
            planned_minutes: 450,
            title: 'Libur / Dispensasi Resmi Sekolah'
        });

        const completeness = validateWeeklyPlanCompleteness(weekStartDate, segments);

        expect(completeness.isValid).toBe(true);
        expect(completeness.incompleteDays).toHaveLength(0);
        expect(completeness.totalEmptyMinutes).toBe(0);
        expect(completeness.message).toContain('telah lengkap terisi');
    });

    // =================================================================
    // 7. INTEGRASI DI SISI FRONTEND (js/page-beban-kerja.js)
    // =================================================================
    test('7. js/page-beban-kerja.js memanggil calculateDayTimelineSlots dan validateWeeklyPlanCompleteness', () => {
        expect(pageBebanKerjaJs).toContain('calculateDayTimelineSlots');
        expect(pageBebanKerjaJs).toContain('validateWeeklyPlanCompleteness');
        expect(pageBebanKerjaJs).toContain('window.workloadMarkDayHoliday = markDayHoliday;');
        expect(pageBebanKerjaJs).toContain('openPlanItemModal(dayIndex, existingId = null, defaultStartTime = null, defaultEndTime = null)');
        expect(pageBebanKerjaJs).toMatch(/(?:const|let)\s+completeness\s*=\s*validateWeeklyPlanCompleteness/);
        expect(pageBebanKerjaJs).toContain('Cuti/Izin');
        expect(pageBebanKerjaJs).toContain('Slot Jam Kosong');
    });

    test('8. Header kartu hari tidak lagi memuat tombol generic Tambah dan fungsi markDayHoliday membersihkan segmen lama serta mendefinisikan dayName', () => {
        // Tombol generic Tambah di header kartu hari sudah dihapus karena slot kosong sudah memiliki tombol Isi Kegiatan
        expect(pageBebanKerjaJs).not.toMatch(/<button onclick="window\.workloadOpenPlanItemModal\(\$\{i\}\)" class="[^"]*"><i class="fa-solid fa-plus mr-1"><\/i>Tambah<\/button>/);
        expect(pageBebanKerjaJs).toContain("window.workloadOpenPlanItemModal(${i}, null, '${slot.startTime}', '${slot.endTime}')");

        // Fungsi markDayHoliday mendefinisikan dayName dan menghapus segmen lama secara atomik via clear_date
        expect(pageBebanKerjaJs).toContain("const dayName = DAY_NAMES[dayIndex] || 'Hari Ini';");
        expect(pageBebanKerjaJs).toContain("clear_date: dayDate");
    });

    // =================================================================
    // 9. PROTEKSI JAM ISTIRAHAT KETIKA KEGIATAN MELINTASI JEDA RESMI
    // =================================================================
    test('9. Kegiatan yang melintasi jam istirahat (09:00 - 11:00) otomatis dipecah dan slot istirahat tetap utuh di timeline', () => {
        const dateStr = '2026-09-28';
        const crossBreakSegments = [
            {
                id: 'seg_cross_break',
                date: dateStr,
                start_time: '09:00',
                end_time: '11:00',
                planned_minutes: 105, // 45m sebelum istirahat + 60m setelah istirahat (istirahat 15m tidak dihitung beban kerja)
                activity_title: 'Projek P5 Terpadu'
            }
        ];

        const result = calculateDayTimelineSlots(dateStr, crossBreakSegments);

        // Memastikan slot break tetap utuh dan tepat berada di 09:45 - 10:00
        const breakSlot1 = result.slots.find(s => s.type === 'break' && s.startTime === '09:45');
        const breakSlot2 = result.slots.find(s => s.type === 'break' && s.startTime === '12:15');
        expect(breakSlot1).toBeDefined();
        expect(breakSlot1.endTime).toBe('10:00');
        expect(breakSlot1.durationMinutes).toBe(15);
        expect(breakSlot2).toBeDefined();
        expect(breakSlot2.endTime).toBe('12:30');
        expect(breakSlot2.durationMinutes).toBe(15);

        // Segmen kegiatan dipecah di sekitar istirahat: 09:00-09:45 dan 10:00-11:00
        const actSlots = result.slots.filter(s => s.type === 'activity');
        expect(actSlots.length).toBeGreaterThanOrEqual(2);
        expect(actSlots[0]).toMatchObject({ startTime: '09:00', endTime: '09:45', durationMinutes: 45 });
        expect(actSlots[1]).toMatchObject({ startTime: '10:00', endTime: '11:00', durationMinutes: 60 });

        // Total durasi terencana bersih: 45 + 60 = 105 menit
        expect(result.totalPlannedMinutes).toBe(105);
        // Total kosong: 90 (07:30-09:00) + 75 (11:00-12:15) + 180 (12:30-15:30) = 345 menit
        expect(result.emptyMinutes).toBe(345);
        expect(result.totalPlannedMinutes + result.emptyMinutes).toBe(450);
    });
});

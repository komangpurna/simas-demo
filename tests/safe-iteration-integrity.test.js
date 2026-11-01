/**
 * tests/safe-iteration-integrity.test.js
 * ==============================================================================
 * Suite Pengujian Unit Jest: Proteksi Integritas Iterasi Aman & Anti TypeError
 * Menjamin tidak ada fungsi analisis objek yang diperlakukan sebagai array mentah
 * di seluruh halaman aplikasi SIMAS SMAGESA.
 * ==============================================================================
 */

const fs = require('node:fs');
const path = require('node:path');
const { calculateDayTimelineSlots } = require('./workload-guru-utils.js');

describe('Proteksi Integritas Iterasi Aman (Safe Iteration & Anti-TypeError Guard)', () => {
    const rootDir = path.resolve(__dirname, '..');
    const sourceDirs = ['js', 'library', 'sukaduka', 'duta', 'pid'];

    // 1. Audit Statis Seluruh Berkas Sumber
    test('1. Tidak ada berkas JavaScript yang menampung calculateDayTimelineSlots langsung ke variabel "slots"', () => {
        const violations = [];

        sourceDirs.forEach(dirName => {
            const dirPath = path.join(rootDir, dirName);
            if (!fs.existsSync(dirPath)) return;

            const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.js') && !f.includes('.test.'));
            files.forEach(fileName => {
                const filePath = path.join(dirPath, fileName);
                const content = fs.readFileSync(filePath, 'utf8');

                // Cari pola const/let/var slots = calculateDayTimelineSlots(...)
                const directSlotsRegex = /(?:const|let|var)\s+slots\s*=\s*calculateDayTimelineSlots\s*\(/;
                if (directSlotsRegex.test(content)) {
                    violations.push(`${dirName}/${fileName}: menggunakan 'const slots = calculateDayTimelineSlots(...)'`);
                }
            });
        });

        expect(violations).toEqual([]);
    });

    test('2. Seluruh pemanggil calculateDayTimelineSlots di kode produksi mengekstrak properti .slots secara aman', () => {
        const pageBebanKerjaPath = path.join(rootDir, 'js', 'page-beban-kerja.js');
        const pageMonitoringPath = path.join(rootDir, 'js', 'page-monitoring-beban-kerja.js');
        const workloadCalcPath = path.join(rootDir, 'js', 'workload-calc.js');

        const pageBebanKerjaContent = fs.readFileSync(pageBebanKerjaPath, 'utf8');
        const pageMonitoringContent = fs.readFileSync(pageMonitoringPath, 'utf8');
        const workloadCalcContent = fs.readFileSync(workloadCalcPath, 'utf8');

        // page-beban-kerja.js wajib mengekstrak .slots
        expect(pageBebanKerjaContent).toMatch(/dayTimeline\.slots/);

        // page-monitoring-beban-kerja.js wajib mengekstrak .slots dengan fallback array
        expect(pageMonitoringContent).toContain('const dayTimeline = calculateDayTimelineSlots(');
        expect(pageMonitoringContent).toContain('Array.isArray(dayTimeline?.slots)');

        // workload-calc.js internal calculation wajib menggunakan .slots
        expect(workloadCalcContent).toContain('dayTimeline.slots');
    });

    // 2. Kontrak Objek Hasil Analisis calculateDayTimelineSlots
    describe('Kontrak Runtime calculateDayTimelineSlots', () => {
        test('3. Mengembalikan objek yang memiliki properti slots berupa Array pada pekan normal', () => {
            const mockSegs = [
                { id: 'seg_1', start_time: '07:30', end_time: '09:00', planned_minutes: 90, activity_title: 'KBM Matematika', is_teaching: 1 },
                { id: 'seg_2', start_time: '10:00', end_time: '12:15', planned_minutes: 135, activity_title: 'Perencanaan Modul Ajar' }
            ];

            const result = calculateDayTimelineSlots('2026-09-28', mockSegs);

            expect(result).toBeDefined();
            expect(typeof result).toBe('object');
            expect(Array.isArray(result.slots)).toBe(true);
            expect(result.slots.length).toBeGreaterThan(0);
            expect(result.isHoliday).toBe(false);
            expect(result.totalPlannedMinutes).toBe(225);
        });

        test('4. Objek hasil memiliki method forEach bawaan yang aman dipanggil langsung', () => {
            const mockSegs = [
                { id: 'seg_1', start_time: '07:30', end_time: '09:00', planned_minutes: 90, activity_title: 'KBM Fisika', is_teaching: 1 }
            ];

            const timeline = calculateDayTimelineSlots('2026-09-28', mockSegs);
            expect(typeof timeline.forEach).toBe('function');

            const slotTypes = [];
            // Memastikan timeline.forEach() mengeksekusi callback tanpa melempar TypeError
            expect(() => {
                timeline.forEach(slot => {
                    slotTypes.push(slot.type);
                });
            }).not.toThrow();

            expect(slotTypes).toContain('activity');
        });

        test('5. Objek hasil mendukung iterasi protokol Symbol.iterator (for..of loop)', () => {
            const mockSegs = [
                { id: 'seg_1', start_time: '07:30', end_time: '09:00', planned_minutes: 90, activity_title: 'KBM Kimia', is_teaching: 1 }
            ];

            const timeline = calculateDayTimelineSlots('2026-09-28', mockSegs);
            expect(typeof timeline[Symbol.iterator]).toBe('function');

            const collected = [];
            for (const slot of timeline) {
                collected.push(slot);
            }

            expect(collected.length).toBe(timeline.slots.length);
        });

        test('6. Aman dipanggil dengan segmen kosong ([]) tanpa melempar galat', () => {
            const timeline = calculateDayTimelineSlots('2026-09-28', []);

            expect(timeline).toBeDefined();
            expect(Array.isArray(timeline.slots)).toBe(true);
            expect(timeline.totalPlannedMinutes).toBe(0);
            expect(typeof timeline.forEach).toBe('function');

            let count = 0;
            expect(() => {
                timeline.forEach(() => { count++; });
            }).not.toThrow();
            expect(count).toBeGreaterThan(0); // Berisi slot empty dan breaks
        });

        test('7. Menangani hari libur resmi sekolah secara resilient', () => {
            const holidaySegs = [
                { id: 'seg_hol', start_time: '07:30', end_time: '15:30', is_holiday: 1, title: 'Hari Raya Kuningan' }
            ];

            const holidayTimeline = calculateDayTimelineSlots('2026-09-28', holidaySegs);
            expect(holidayTimeline.isHoliday).toBe(true);
            expect(Array.isArray(holidayTimeline.slots)).toBe(true);
            expect(holidayTimeline.slots[0].type).toBe('holiday');
            expect(typeof holidayTimeline.forEach).toBe('function');

            const titles = [];
            holidayTimeline.forEach(s => titles.push(s.title));
            expect(titles).toContain('Hari Raya Kuningan');
        });

        test('8. Seluruh slot memiliki atribut kalkulasi numerik yang valid (startMin, endMin, durationMinutes)', () => {
            const mockSegs = [
                { id: 'seg_1', start_time: '07:30', end_time: '08:15', planned_minutes: 45, activity_title: 'Upacara Bendera' }
            ];

            const timeline = calculateDayTimelineSlots('2026-09-28', mockSegs);
            timeline.slots.forEach(slot => {
                expect(typeof slot.startMin).toBe('number');
                expect(typeof slot.endMin).toBe('number');
                expect(typeof slot.durationMinutes).toBe('number');
                expect(slot.endMin).toBeGreaterThanOrEqual(slot.startMin);
                expect(slot.durationMinutes).toBe(slot.endMin - slot.startMin);
            });
        });
    });

    // 3. Simulasi Rendering DOM Gantt Timeline (Anti-Crash Test)
    describe('Simulasi Rendering Timeline Supervisi (page-monitoring-beban-kerja.js)', () => {
        const GANTT_START = 7 * 60 + 30; // 450m
        const GANTT_END = 15 * 60 + 30;   // 930m
        const GANTT_TOTAL = GANTT_END - GANTT_START; // 480m

        function renderMockGanttSlots(dayDateStr, daySegs, dayLogs = []) {
            const dayTimeline = calculateDayTimelineSlots(dayDateStr, daySegs, { canEdit: false });
            const slots = Array.isArray(dayTimeline?.slots) ? dayTimeline.slots : (Array.isArray(dayTimeline) ? dayTimeline : []);

            let slotsHtml = '';
            slots.forEach(slot => {
                const startMins = slot.startMin !== undefined ? slot.startMin : GANTT_START;
                const dur = slot.durationMinutes || 0;
                const leftPct = Math.max(0, Math.min(100, ((startMins - GANTT_START) / GANTT_TOTAL) * 100));
                const widthPct = Math.max(1, Math.min(100 - leftPct, (dur / GANTT_TOTAL) * 100));

                if (slot.type === 'break') {
                    slotsHtml += `<div class="slot-break" style="left:${leftPct}%; width:${widthPct}%">${slot.name || 'Istirahat'}</div>`;
                } else if (slot.type === 'empty' || slot.type === 'empty_slot') {
                    slotsHtml += `<div class="slot-empty" style="left:${leftPct}%; width:${widthPct}%">Kosong ${dur}m</div>`;
                } else if (slot.type === 'holiday' || dayTimeline?.isHoliday) {
                    slotsHtml += `<div class="slot-holiday" style="left:0%; width:100%">${slot.title || 'Libur'}</div>`;
                } else {
                    const slotTitle = slot.title || 'Kegiatan';
                    const matchingLog = dayLogs.find(l => l.title === slotTitle);
                    const isRealized = !!matchingLog;
                    slotsHtml += `<div class="slot-activity" style="left:${leftPct}%; width:${widthPct}%">${slotTitle} ${isRealized ? '✓' : ''}</div>`;
                }
            });

            return slotsHtml;
        }

        test('9. Render Gantt berhasil tanpa error pada hari dengan kegiatan tatap muka KBM', () => {
            const segs = [
                { id: 'kbm_1', start_time: '08:15', end_time: '09:45', planned_minutes: 90, activity_title: 'KBM Biologi', is_teaching: 1 }
            ];
            expect(() => {
                const html = renderMockGanttSlots('2026-09-28', segs);
                expect(html).toContain('KBM Biologi');
                expect(html).toContain('slot-break');
            }).not.toThrow();
        });

        test('10. Render Gantt berhasil tanpa error pada hari tanpa kegiatan sama sekali (0 rencana)', () => {
            expect(() => {
                const html = renderMockGanttSlots('2026-09-28', []);
                expect(html).toContain('slot-empty');
                expect(html).toContain('slot-break');
            }).not.toThrow();
        });

        test('11. Render Gantt berhasil tanpa error pada hari libur resmi sekolah', () => {
            const holidaySegs = [
                { id: 'hol_1', start_time: '07:30', end_time: '15:30', is_holiday: 1, title: 'Libur Hari Nyepi' }
            ];
            expect(() => {
                const html = renderMockGanttSlots('2026-09-28', holidaySegs);
                expect(html).toContain('slot-holiday');
                expect(html).toContain('Libur Hari Nyepi');
            }).not.toThrow();
        });

        test('12. Render Gantt mencocokkan realisasi harian dan mendukung catatan kendala tanpa error', () => {
            const segs = [
                { id: 'act_1', start_time: '10:00', end_time: '11:30', planned_minutes: 90, activity_title: 'Penyusunan Asesmen Formatif' }
            ];
            const logs = [
                { id: 'log_1', title: 'Penyusunan Asesmen Formatif', status_execution: 'terkendala', obstacle_notes: 'Jaringan internet sekolah sedang maintenance' }
            ];

            expect(() => {
                const html = renderMockGanttSlots('2026-09-28', segs, logs);
                expect(html).toContain('Penyusunan Asesmen Formatif');
                expect(html).toContain('✓');
            }).not.toThrow();
        });
    });

    // 4. Proteksi Objek Payload Presensi Siswa (Anti TypeError (records || []).filter)
    describe('Proteksi Integritas Objek Presensi (page-presensi.js)', () => {
        test('13. Objek payload presensi "records" di js/page-presensi.js tidak dipanggil langsung dengan method array dan diekstraksi via Object.values', () => {
            const presensiPath = path.join(rootDir, 'js', 'page-presensi.js');
            const presensiContent = fs.readFileSync(presensiPath, 'utf8');

            // Dilarang keras memanggil method array langsung pada records:
            expect(presensiContent).not.toMatch(/\(records\s*\|\|\s*\[\]\)\.filter\(/);
            expect(presensiContent).not.toMatch(/\brecords\.filter\(/);

            // Wajib mengekstrak record list menggunakan Object.values(records)
            expect(presensiContent).toContain('Object.values(records');

            // Simulasi objek records presensi (key-value map)
            const mockRecords = {
                'std_1': { id: 'std_1', nis: '1001', name: 'Ni Kadek Dita', status: 'H' },
                'std_2': { id: 'std_2', nis: '1002', name: 'Ni Made Ayu', status: 'A' },
                'std_3': { id: 'std_3', nis: '1003', name: 'I Wayan Budi', status: 'S' }
            };

            const recordList = Array.isArray(mockRecords) ? mockRecords : Object.values(mockRecords || {});
            const alphaStudents = recordList.filter(r => r && r.status === 'A').map(r => ({ nis: r.nis, name: r.name }));

            expect(alphaStudents).toEqual([{ nis: '1002', name: 'Ni Made Ayu' }]);
        });
    });
});


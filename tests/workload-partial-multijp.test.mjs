import { readFileSync } from 'node:fs';

describe('Workload Multi-JP Partial Realization Integrity', () => {
    test('calculateEndTimeWithBreaks memperhitungkan jam istirahat untuk 90m (2 JP)', () => {
        // Simulasi kalkulasi jam selesai dengan istirahat sekolah
        const STANDARD_JP_PERIODS = [
            { code: 'JP-6', start: '11:30', end: '12:15' },
            { code: 'ISTIRAHAT-2', start: '12:15', end: '12:30', isBreak: true },
            { code: 'JP-7', start: '12:30', end: '13:15' }
        ];

        function parseTime(t) {
            const [h, m] = (t || '').split(':').map(Number);
            return (h || 0) * 60 + (m || 0);
        }

        function minutesToTimeString(m) {
            const h = Math.floor(m / 60);
            const min = m % 60;
            return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
        }

        function calculateEndTimeWithBreaks(startTime, targetDuration) {
            let cur = parseTime(startTime);
            let needed = targetDuration;
            while (needed > 0) {
                const brk = STANDARD_JP_PERIODS.find(b => b.isBreak && cur >= parseTime(b.start) && cur < parseTime(b.end));
                if (brk) {
                    cur = parseTime(brk.end);
                    continue;
                }
                const nextBrk = STANDARD_JP_PERIODS
                    .filter(b => b.isBreak && parseTime(b.start) > cur)
                    .sort((a, b) => parseTime(a.start) - parseTime(b.start))[0];
                if (nextBrk) {
                    const avail = parseTime(nextBrk.start) - cur;
                    if (needed <= avail) {
                        cur += needed;
                        needed = 0;
                    } else {
                        needed -= avail;
                        cur = parseTime(nextBrk.end);
                    }
                } else {
                    cur += needed;
                    needed = 0;
                }
            }
            return minutesToTimeString(cur);
        }

        expect(calculateEndTimeWithBreaks('11:30', 90)).toBe('13:15');
        expect(calculateEndTimeWithBreaks('11:30', 45)).toBe('12:15');
    });

    test('deteksi isLogPartialForMultiSlot memisahkan sub-slot yang terlaksana dari sub-slot belum lapor', () => {
        function parseTime(t) {
            const [h, m] = (t || '').split(':').map(Number);
            return (h || 0) * 60 + (m || 0);
        }

        const actStartMins = parseTime('11:30');
        const actEndMins = parseTime('13:15');
        const actPlannedMins = 90;

        // Log hanya tercatat 45 menit (11:30 - 12:15)
        const linkedLog = { id: 'log-1', status_execution: 'terlaksana' };
        const dayLogSegs = [{ work_log_id: 'log-1', start_time: '11:30', end_time: '12:15', actual_minutes: 45 }];

        const segLogItems = dayLogSegs.filter(ls => ls.work_log_id === linkedLog.id && ls.start_time && ls.end_time);
        const logStartMin = Math.min(...segLogItems.map(ls => parseTime(ls.start_time)));
        const logEndMin = Math.max(...segLogItems.map(ls => parseTime(ls.end_time)));
        const logActualMins = segLogItems.reduce((s, ls) => s + (ls.actual_minutes || 0), 0);

        // Sub-slot 1: JP 6 (11:30 - 12:15)
        const slot1Start = parseTime('11:30');
        const slot1End = parseTime('12:15');
        const isMultiSlotPlan1 = actStartMins < slot1Start || actEndMins > slot1End;
        expect(isMultiSlotPlan1).toBe(true);

        const isLogPartialForMultiSlot1 = Boolean(
            linkedLog && isMultiSlotPlan1 && linkedLog.status_execution !== 'tidak_terlaksana' && (
                logEndMin < actEndMins || logStartMin > actStartMins || logActualMins < actPlannedMins
            )
        );
        expect(isLogPartialForMultiSlot1).toBe(true);

        const slot1HasLog = Boolean(linkedLog && (
            linkedLog.status_execution === 'tidak_terlaksana' ||
            !isLogPartialForMultiSlot1 ||
            (Math.max(logStartMin, slot1Start) < Math.min(logEndMin, slot1End))
        ));
        expect(slot1HasLog).toBe(true);

        // Sub-slot 2: JP 7 (12:30 - 13:15)
        const slot2Start = parseTime('12:30');
        const slot2End = parseTime('13:15');
        const isMultiSlotPlan2 = actStartMins < slot2Start || actEndMins > slot2End;
        expect(isMultiSlotPlan2).toBe(true);

        const isLogPartialForMultiSlot2 = Boolean(
            linkedLog && isMultiSlotPlan2 && linkedLog.status_execution !== 'tidak_terlaksana' && (
                logEndMin < actEndMins || logStartMin > actStartMins || logActualMins < actPlannedMins
            )
        );
        expect(isLogPartialForMultiSlot2).toBe(true);

        const slot2HasLog = Boolean(linkedLog && (
            linkedLog.status_execution === 'tidak_terlaksana' ||
            !isLogPartialForMultiSlot2 ||
            (Math.max(logStartMin, slot2Start) < Math.min(logEndMin, slot2End))
        ));
        // Sub-slot 2 TIDAK dicakup oleh log -> hasLog = false!
        expect(slot2HasLog).toBe(false);
    });

    test('page-beban-kerja.js memuat mekanisme konfirmasi durasi rencana dan async selectLogCatalog', () => {
        const js = readFileSync(new URL('../js/page-beban-kerja.js', import.meta.url), 'utf8');

        // Pastikan selectLogCatalog didefinisikan sebagai fungsi async
        expect(js).toContain('export async function selectLogCatalog(catalogId)');
        expect(js).toContain('await onLogCatalogChange(true);');
        expect(js).toContain('async function onLogCatalogChange(autoAdjustTime = false)');

        // Pastikan perlindungan jam akhir murni guru terpasang (tanpa menimpa durasi yang sudah diisi)
        expect(js).toContain("const currentEnd = (endInput?.value || '').trim();");
        expect(js).toContain('if (!currentEnd && start && durMin > 0 && endInput)');

        // Pastikan logika slotHasLog dan isLogPartialForMultiSlot terpasang di gantt rendering dan mobile view
        expect(js).toContain('const isLogPartialForMultiSlot = Boolean(');
        expect(js).toContain('const slotHasLog = Boolean(hasLog && (');
        expect(js).toContain('window.workloadSelectLogCatalog = selectLogCatalog;');
    });
});

import { readFileSync } from 'node:fs';

// workload-calc.js adalah ESM browser tanpa "type": "module", jadi dimuat dari sumbernya langsung
const calcSrc = readFileSync(new URL('../js/workload-calc.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const { detectShiftedRealizations, subtractTimeRanges } = new Function(`${calcSrc}\nreturn { detectShiftedRealizations, subtractTimeRanges };`)();

// Rencana Jumat sore yang sudah difinalisasi
const slots = [
    { type: 'activity', startTime: '10:00', endTime: '12:30', segment: { activity_id: 'pagi' } },
    { type: 'activity', startTime: '12:30', endTime: '13:30', segment: { activity_id: 'a' } },
    { type: 'activity', startTime: '13:30', endTime: '14:30', segment: { activity_id: 'b' } },
    { type: 'activity', startTime: '14:30', endTime: '15:30', segment: { activity_id: 'c' } }
];

test('rencana diganti rapat 12:30–15:30: realisasi melebar, rencana yang beririsan ditandai', () => {
    const dayLogs = [
        { id: 'log-rapat', title: 'Rapat Dinas', status_execution: 'diganti' },
        { id: 'log-c', title: 'C', status_execution: 'tidak_terlaksana' }
    ];
    const dayLogSegs = [{ work_log_id: 'log-rapat', start_time: '12:30', end_time: '15:30', actual_minutes: 180 }];
    const planLinks = [
        { plan_activity_id: 'a', work_log_id: 'log-rapat', link_type: 'substitution' },
        { plan_activity_id: 'c', work_log_id: 'log-c' }
    ];

    const { shifted, overlapped } = detectShiftedRealizations(slots, dayLogs, dayLogSegs, planLinks);

    expect([...shifted.keys()]).toEqual(['a']);
    expect(shifted.get('a')).toMatchObject({ logId: 'log-rapat', startMin: 750, endMin: 930 });
    expect(overlapped.get('a')).toMatchObject({ isOwn: true });
    expect(overlapped.get('b')).toMatchObject({ isOwn: false, logId: 'log-rapat' });
    expect(overlapped.get('c')).toMatchObject({ isOwn: false });
    expect(overlapped.has('pagi')).toBe(false);
});

test('realisasi penuh/parsial di dalam slot rencana tidak dianggap bergeser', () => {
    const dayLogs = [{ id: 'l1', title: 'A', status_execution: 'terlaksana' }];
    const planLinks = [{ plan_activity_id: 'a', work_log_id: 'l1' }];
    const full = detectShiftedRealizations(slots, dayLogs, [{ work_log_id: 'l1', start_time: '12:30', end_time: '13:30' }], planLinks);
    const partial = detectShiftedRealizations(slots, dayLogs, [{ work_log_id: 'l1', start_time: '12:30', end_time: '13:00' }], planLinks);
    expect(full.shifted.size + full.overlapped.size).toBe(0);
    expect(partial.shifted.size + partial.overlapped.size).toBe(0);
});

test('slot dengan realisasi aktif sendiri tidak dipindah ke lajur irisan', () => {
    const dayLogs = [
        { id: 'l1', title: 'Rapat', status_execution: 'diganti' },
        { id: 'l2', title: 'B', status_execution: 'terlaksana' }
    ];
    const dayLogSegs = [
        { work_log_id: 'l1', start_time: '12:30', end_time: '14:00' },
        { work_log_id: 'l2', start_time: '13:30', end_time: '14:30' }
    ];
    const planLinks = [{ plan_activity_id: 'a', work_log_id: 'l1' }, { plan_activity_id: 'b', work_log_id: 'l2' }];
    const { overlapped } = detectShiftedRealizations(slots, dayLogs, dayLogSegs, planLinks);
    expect(overlapped.has('b')).toBe(false);
    expect(overlapped.has('c')).toBe(false);
});

test('draf dan tidak terlaksana tidak menggeser bar realisasi', () => {
    const dayLogs = [{ id: 'l1', title: 'Rapat', status_execution: 'draft' }];
    const dayLogSegs = [{ work_log_id: 'l1', start_time: '12:30', end_time: '15:30' }];
    const res = detectShiftedRealizations(slots, dayLogs, dayLogSegs, [{ plan_activity_id: 'a', work_log_id: 'l1' }]);
    expect(res.shifted.size).toBe(0);
});

test('subtractTimeRanges memotong slot kosong yang tertutup realisasi', () => {
    expect(subtractTimeRanges(780, 930, [{ startMin: 750, endMin: 840 }])).toEqual([{ startMin: 840, endMin: 930 }]);
    expect(subtractTimeRanges(780, 930, [{ startMin: 800, endMin: 820 }])).toEqual([{ startMin: 780, endMin: 800 }, { startMin: 820, endMin: 930 }]);
    expect(subtractTimeRanges(780, 930, [{ startMin: 750, endMin: 930 }])).toEqual([]);
    expect(subtractTimeRanges(780, 930, [])).toEqual([{ startMin: 780, endMin: 930 }]);
});

test('matriks realisasi memakai jam aktual untuk bar & lajur tipis untuk rencana yang beririsan', () => {
    const js = readFileSync(new URL('../js/page-beban-kerja.js', import.meta.url), 'utf8');
    expect(js).toContain('detectShiftedRealizations(dayTimeline.slots, dayLogs, dayLogSegs, planLinks)');
    expect(js).toContain('style="left: ${barLeftPct}%; width: ${barWidthPct}%"');
    expect(js).toContain('absolute bottom-px h-[10px]');
});

test('KBM multi-JP yang melintasi istirahat resmi tidak dianggap bergeser dan tidak memunculkan strip abu-abu', () => {
    // KBM 3 JP: 08:15–10:45 terpotong istirahat 09:45–10:00
    const breakCrossingSlots = [
        { type: 'activity', startTime: '08:15', endTime: '09:45', segment: { activity_id: 'kbm-mat', start_time: '08:15', end_time: '10:45' } },
        { type: 'break', startTime: '09:45', endTime: '10:00' },
        { type: 'activity', startTime: '10:00', endTime: '10:45', segment: { activity_id: 'kbm-mat', start_time: '08:15', end_time: '10:45' } }
    ];
    const dayLogs = [{ id: 'log-kbm', title: 'Matematika XII-A', status_execution: 'terlaksana' }];
    const dayLogSegs = [{ work_log_id: 'log-kbm', start_time: '08:15', end_time: '10:45', actual_minutes: 135 }];
    const planLinks = [{ plan_activity_id: 'kbm-mat', work_log_id: 'log-kbm' }];

    const { shifted, overlapped } = detectShiftedRealizations(breakCrossingSlots, dayLogs, dayLogSegs, planLinks);
    expect(shifted.size).toBe(0);
    expect(overlapped.size).toBe(0);
});

test('KBM multi-JP yang melintasi istirahat dengan realisasi parsial tidak dianggap bergeser', () => {
    const breakCrossingSlots = [
        { type: 'activity', startTime: '08:15', endTime: '09:45', segment: { activity_id: 'kbm-mat', start_time: '08:15', end_time: '10:45' } },
        { type: 'break', startTime: '09:45', endTime: '10:00' },
        { type: 'activity', startTime: '10:00', endTime: '10:45', segment: { activity_id: 'kbm-mat', start_time: '08:15', end_time: '10:45' } }
    ];
    const dayLogs = [{ id: 'log-kbm', title: 'Matematika XII-A', status_execution: 'sebagian' }];
    const dayLogSegs = [{ work_log_id: 'log-kbm', start_time: '08:15', end_time: '10:00', actual_minutes: 90 }];
    const planLinks = [{ plan_activity_id: 'kbm-mat', work_log_id: 'log-kbm' }];

    const { shifted, overlapped } = detectShiftedRealizations(breakCrossingSlots, dayLogs, dayLogSegs, planLinks);
    expect(shifted.size).toBe(0);
    expect(overlapped.size).toBe(0);
});

test('matriks realisasi menyatukan balok kegiatan melintasi istirahat dan mencegah duplikasi rendering', () => {
    const js = readFileSync(new URL('../js/page-beban-kerja.js', import.meta.url), 'utf8');
    expect(js).toContain('const renderedPlanActivityIds = new Set();');
    expect(js).toContain('if (activityId && renderedPlanActivityIds.has(activityId))');
    expect(js).toContain('style="left: ${actLeftPct}%; width: ${actWidthPct}%"');
});

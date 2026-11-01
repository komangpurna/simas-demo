/** @jest-environment node */
import { getLmsReadingState } from '../js/lms-reading.mjs';
import { normalizeLmsScheduleTime, formatLmsScheduleTime } from '../js/lms-schedule.mjs';

describe('LMS Reading State & Schedule Guards (Anti-Invalid-Time-Value)', () => {
    test('paket materi nonaktif (material_enabled: 0, kuis saja) dengan URL eksternal tidak melempar Invalid time value saat siswa belum membuka', () => {
        expect(() => {
            const res = getLmsReadingState({
                resource_type: 'link',
                resource_url: 'https://example.com/eksternal',
                material_enabled: 0,
                quiz_enabled: 1
            }, {});
            expect(res.reading_complete).toBe(true);
            expect(res.reading_completed_at).toBe('');
            expect(res.reading_required_seconds).toBe(0);
        }).not.toThrow();
    });

    test('paket materi eksternal (link/gdrive) belum dibuka siswa tidak menghasilkan Invalid time value', () => {
        expect(() => {
            const res = getLmsReadingState({
                resource_type: 'gdrive',
                resource_url: 'https://drive.google.com/file/d/sample/view',
                material_enabled: 1,
                minimum_read_seconds: 300
            }, {});
            expect(res.reading_complete).toBe(false);
            expect(res.reading_completed_at).toBe('');
            expect(res.reading_remaining_seconds).toBe(300);
        }).not.toThrow();
    });

    test('paket materi eksternal yang sudah selesai membaca mengembalikan waktu ISO yang valid', () => {
        const now = Date.now();
        const openedAt = new Date(now - 400 * 1000).toISOString();
        const res = getLmsReadingState({
            resource_type: 'link',
            resource_url: 'https://example.com/latihan',
            material_enabled: 1,
            minimum_read_seconds: 300
        }, { my_first_opened_at: openedAt }, now);

        expect(res.reading_complete).toBe(true);
        expect(res.reading_remaining_seconds).toBe(0);
        expect(res.reading_completed_at).toBe(new Date(Date.parse(openedAt) + 300 * 1000).toISOString());
    });

    test('timestamp SQLite D1 dengan mikrodetik diparsing dengan benar tanpa menghasilkan string kosong', () => {
        const rawTime = '2026-10-16T12:00:00.123456Z';
        const normalized = normalizeLmsScheduleTime(rawTime);
        expect(normalized).toBeTruthy();
        expect(normalized).toBe(new Date(rawTime).toISOString());
    });

    test('formatLmsScheduleTime tidak pernah melempar pengecualian untuk masukan anomali', () => {
        expect(formatLmsScheduleTime(null)).toBe('-');
        expect(formatLmsScheduleTime('')).toBe('-');
        expect(formatLmsScheduleTime('tanggal-rusak')).toBe('-');
        expect(formatLmsScheduleTime('2026-13-45T99:99:99Z')).toBe('-');
    });
});

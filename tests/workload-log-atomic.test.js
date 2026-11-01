const vm = require('node:vm');
const { journalHarness } = require('./helpers/lms-journal-harness.cjs');

describe('Workload log persistence with real SQLite transactions', () => {
    let h;
    const route = '/api/workload/logs';

    function payload(overrides = {}) {
        return {
            id: 'log', work_week_id: 'week', teacher_id: 'gtk-guru',
            date: '2026-01-15', day_of_week: 4, title: 'Rapat pengganti KBM',
            catalog_id: 'cat_test_rapat', plan_activity_id: 'activity',
            status_execution: 'diganti', substitute_notes: 'Penugasan rapat',
            output_summary: 'Hasil rapat', evidence_url: 'https://example.test/bukti.jpg',
            segments: [{ start_time: '10:00', end_time: '11:00', actual_minutes: 60 }],
            ...overrides
        };
    }

    function snapshot() {
        return Object.fromEntries(['work_logs', 'work_log_segments', 'plan_log_links', 'plan_time_segments']
            .map(table => [table, h.sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]));
    }

    function failAt(event, table, condition = '') {
        h.sqlite.exec(`CREATE TRIGGER fail_write BEFORE ${event} ON ${table}
            ${condition ? `WHEN ${condition}` : ''}
            BEGIN SELECT RAISE(ABORT, 'simulated persistence failure'); END;`);
    }

    beforeEach(() => {
        h = journalHarness();
        h.sqlite.exec(`PRAGMA foreign_keys = ON;
            INSERT INTO activity_catalog(id,code,category_code,category_name,name)
                VALUES ('cat_test_rapat','TEST_RAPAT','PERENCANAAN','Perencanaan','Rapat');
            UPDATE plan_time_segments SET start_time='07:30',end_time='09:00',planned_minutes=90 WHERE id='segment';`);
    });

    afterEach(() => h.sqlite.close());

    test('a 90-minute KBM plan may be replaced by a completed 60-minute meeting at different times', async () => {
        const before = snapshot().plan_time_segments;
        const result = await h.request(route, payload());
        expect(result.httpStatus).toBe(200);
        expect(result.data.actual_minutes).toBe(60);
        expect(h.sqlite.prepare('SELECT title,status_execution,evidence_url FROM work_logs').get())
            .toMatchObject({ title: 'Rapat pengganti KBM', status_execution: 'diganti', evidence_url: payload().evidence_url });
        expect(h.sqlite.prepare('SELECT start_time,end_time,actual_minutes FROM work_log_segments').get())
            .toMatchObject({ start_time: '10:00', end_time: '11:00', actual_minutes: 60 });
        expect(h.sqlite.prepare('SELECT plan_activity_id,link_type,reason_notes FROM plan_log_links').get())
            .toMatchObject({ plan_activity_id: 'activity', link_type: 'substitution', reason_notes: 'Penugasan rapat' });
        expect(snapshot().plan_time_segments).toEqual(before);
    });

    test('editing and retrying a linked report preserves its identity without duplicating minutes', async () => {
        expect((await h.request(route, payload())).httpStatus).toBe(200);
        const update = payload({ id: undefined, title: 'Rapat diperbarui',
            segments: [{ start_time: '10:00', end_time: '10:45', actual_minutes: 45 }] });
        for (let attempt = 0; attempt < 2; attempt++) {
            const result = await h.request(route, update);
            expect(result.httpStatus).toBe(200);
            expect(result.data).toMatchObject({ log_id: 'log', actual_minutes: 45 });
        }
        expect(snapshot().work_logs).toHaveLength(1);
        expect(snapshot().work_log_segments).toHaveLength(1);
        expect(snapshot().plan_log_links).toHaveLength(1);
        expect(h.sqlite.prepare('SELECT SUM(actual_minutes) AS minutes FROM work_log_segments').get().minutes).toBe(45);
    });

    test('a substitution draft retains its replacement link and evidence with zero actual minutes until finalized', async () => {
        vm.runInContext("Date.now = () => Date.parse('2026-01-15T02:15:00Z')", h.context); // 10:15 WITA.
        const plannedSegments = snapshot().plan_time_segments;
        const draft = payload({ status_execution: 'draft', draft_status_execution: 'diganti' });
        for (let attempt = 0; attempt < 2; attempt++) {
            const result = await h.request(route, draft);
            expect(result.httpStatus).toBe(200);
            expect(result.data.actual_minutes).toBe(0);
            expect(snapshot().work_logs).toHaveLength(1);
            expect(snapshot().work_logs[0]).toMatchObject({ status_execution: 'draft', catalog_id: 'cat_test_rapat',
                title: 'Rapat pengganti KBM', evidence_url: draft.evidence_url });
            expect(snapshot().work_log_segments).toHaveLength(1);
            expect(snapshot().work_log_segments[0]).toMatchObject({ start_time: '10:00', end_time: '11:00', actual_minutes: 0 });
            expect(snapshot().plan_log_links).toHaveLength(1);
            expect(snapshot().plan_log_links[0]).toMatchObject({ link_type: 'substitution', reason_notes: 'Penugasan rapat' });
        }
        const savedDraft = snapshot();
        expect((await h.request(route, payload())).httpStatus).toBe(422);
        expect(snapshot()).toEqual(savedDraft);
        vm.runInContext("Date.now = () => Date.parse('2026-01-15T03:10:00Z')", h.context); // 11:10 WITA.
        const finalized = await h.request(route, payload());
        expect(finalized.httpStatus).toBe(200);
        expect(finalized.data.actual_minutes).toBe(60);
        expect(snapshot().work_logs[0].status_execution).toBe('diganti');
        expect(snapshot().work_log_segments[0].actual_minutes).toBe(60);
        expect(snapshot().plan_log_links[0].link_type).toBe('substitution');
        expect(snapshot().plan_time_segments).toEqual(plannedSegments);
    });

    test('switching a substitution draft back to the planned activity clears the replacement link', async () => {
        expect((await h.request(route, payload({ status_execution: 'draft', draft_status_execution: 'diganti' }))).httpStatus).toBe(200);
        const result = await h.request(route, payload({ status_execution: 'draft', substitute_notes: '' }));
        expect(result.httpStatus).toBe(200);
        expect(result.data.actual_minutes).toBe(0);
        expect(snapshot().plan_log_links[0]).toMatchObject({ link_type: 'fulfillment', reason_notes: '' });
    });

    test.each([
        ['draft', 0, 'fulfillment'],
        ['tidak_terlaksana', 0, 'fulfillment'],
        ['sebagian', 30, 'fulfillment'],
        ['terlaksana', 60, 'fulfillment'],
        ['diganti', 60, 'substitution']
    ])('editing to %s retains the existing status and duration rules', async (status, minutes, linkType) => {
        expect((await h.request(route, payload())).httpStatus).toBe(200);
        const result = await h.request(route, payload({ status_execution: status, obstacle_notes: 'Keterangan pelaksanaan',
            segments: [{ start_time: '10:00', end_time: '11:00', actual_minutes: status === 'sebagian' ? 30 : 60 }] }));
        expect(result.httpStatus).toBe(200);
        expect(result.data.actual_minutes).toBe(minutes);
        const state = snapshot();
        expect(state.work_logs[0].status_execution).toBe(status);
        expect(state.work_log_segments.reduce((sum, segment) => sum + segment.actual_minutes, 0)).toBe(minutes);
        expect(state.work_log_segments).toHaveLength(status === 'tidak_terlaksana' ? 0 : 1);
        expect(state.plan_log_links[0].link_type).toBe(linkType);
    });

    test('unplanned work and the start/end payload format remain supported', async () => {
        const result = await h.request(route, payload({ plan_activity_id: undefined, is_unplanned: 1,
            status_execution: 'terlaksana', segments: [], start_time: '09:30', end_time: '10:30' }));
        expect(result.httpStatus).toBe(200);
        expect(result.data.actual_minutes).toBe(45); // Official break 09:45-10:00 remains excluded.
        expect(snapshot().work_log_segments[0].actual_minutes).toBe(45);
        expect(snapshot().plan_log_links).toHaveLength(0);
    });

    test('planned non-KBM work can still be completed in multiple sessions', async () => {
        h.sqlite.exec(`UPDATE plan_activities SET catalog_id='cat_test_rapat',category_code='PERENCANAAN' WHERE id='activity';
            UPDATE plan_time_segments SET is_teaching=0 WHERE id='segment';`);
        const result = await h.request(route, payload({ status_execution: 'terlaksana', segments: [
            { start_time: '10:00', end_time: '10:30', actual_minutes: 30 },
            { start_time: '12:30', end_time: '13:30', actual_minutes: 60 }
        ] }));
        expect(result.httpStatus).toBe(200);
        expect(result.data.actual_minutes).toBe(90);
        expect(snapshot().work_log_segments).toHaveLength(2);
        expect(h.sqlite.prepare('SELECT SUM(actual_minutes) AS minutes FROM work_log_segments').get().minutes).toBe(90);
        expect(snapshot().plan_log_links[0].link_type).toBe('fulfillment');
    });

    test('automatically verified reports remain editable and deletable in Mode Mandiri', async () => {
        h.sqlite.prepare('INSERT INTO system_settings(key,value) VALUES (?,?)')
            .run('workload_policy_config', JSON.stringify({ require_log_verification: 0 }));
        expect((await h.request(route, payload())).httpStatus).toBe(200);
        expect(snapshot().work_logs[0]).toMatchObject({ verification_status: 'verified', verified_by_uid: 'system_auto_policy' });
        expect((await h.request(route, payload({ title: 'Rapat diperbarui' }))).httpStatus).toBe(200);
        expect(snapshot().work_logs[0].title).toBe('Rapat diperbarui');
        expect((await h.request(`${route}/log`, null, h.actor, 'DELETE')).httpStatus).toBe(200);
        expect(snapshot().work_logs).toHaveLength(0);
    });

    test.each([
        ['work_log_segments', "NEW.start_time = '10:30'"],
        ['plan_log_links', '']
    ])('a failure inserting %s leaves no partial report or minutes', async (table, condition) => {
        const before = snapshot();
        failAt('INSERT', table, condition);
        const result = await h.request(route, payload({ segments: [
            { start_time: '10:00', end_time: '10:30', actual_minutes: 30 },
            { start_time: '10:30', end_time: '11:00', actual_minutes: 30 }
        ] }));
        expect(result.httpStatus).toBe(500);
        expect(snapshot()).toEqual(before);
    });

    test('a failed edit restores the original title, evidence, minutes and link', async () => {
        expect((await h.request(route, payload())).httpStatus).toBe(200);
        const before = snapshot();
        failAt('INSERT', 'work_log_segments');
        const result = await h.request(route, payload({ title: 'Perubahan gagal', evidence_url: '',
            segments: [{ start_time: '10:00', end_time: '10:45', actual_minutes: 45 }] }));
        expect(result.httpStatus).toBe(500);
        expect(snapshot()).toEqual(before);
    });

    test('successful duplicate cleanup retains only the updated report', async () => {
        expect((await h.request(route, payload())).httpStatus).toBe(200);
        seedDuplicate();
        const result = await h.request(route, payload());
        expect(result.httpStatus).toBe(200);
        expect(snapshot().work_logs.map(log => log.id)).toEqual(['log']);
        expect(snapshot().work_log_segments).toHaveLength(1);
        expect(snapshot().plan_log_links).toHaveLength(1);
    });

    function seedDuplicate() {
        h.sqlite.exec(`INSERT INTO work_logs(id,work_week_id,teacher_id,date,day_of_week,title,catalog_id)
                VALUES ('legacy-log','week','gtk-guru','2026-01-14',3,'Laporan lama','cat_test_rapat');
            INSERT INTO work_log_segments(id,work_log_id,start_time,end_time,actual_minutes)
                VALUES ('legacy-segment','legacy-log','12:30','13:00',30);
            INSERT INTO plan_log_links(id,plan_activity_id,work_log_id)
                VALUES ('legacy-link','activity','legacy-log');`);
    }

    test('a failure cleaning duplicates rolls back the edit and preserves both original reports', async () => {
        expect((await h.request(route, payload())).httpStatus).toBe(200);
        seedDuplicate();
        const before = snapshot();
        failAt('DELETE', 'work_logs', "OLD.id = 'legacy-log'");
        const result = await h.request(route, payload({ title: 'Perubahan gagal' }));
        expect(result.httpStatus).toBe(500);
        expect(snapshot()).toEqual(before);
    });

    test('deleting a report removes its link and minutes together', async () => {
        expect((await h.request(route, payload())).httpStatus).toBe(200);
        const before = snapshot().plan_time_segments;
        const result = await h.request(`${route}/log`, null, h.actor, 'DELETE');
        expect(result.httpStatus).toBe(200);
        expect(snapshot()).toMatchObject({ work_logs: [], work_log_segments: [], plan_log_links: [], plan_time_segments: before });
    });

    test.each(['work_log_segments', 'work_logs'])('a failure deleting %s preserves the report and all its related data', async table => {
        expect((await h.request(route, payload())).httpStatus).toBe(200);
        const before = snapshot();
        failAt('DELETE', table);
        const result = await h.request(`${route}/log`, null, h.actor, 'DELETE');
        expect(result.httpStatus).toBe(500);
        expect(snapshot()).toEqual(before);
    });

    test.each(['week', 'log', 'manual-verification'])('%s protection still rejects edits and deletions without changing data', async lock => {
        expect((await h.request(route, payload())).httpStatus).toBe(200);
        if (lock === 'week') h.sqlite.exec("UPDATE work_weeks SET is_locked=1 WHERE id='week'");
        if (lock === 'log') h.sqlite.exec("UPDATE work_logs SET is_locked=1 WHERE id='log'");
        if (lock === 'manual-verification') {
            h.sqlite.exec("UPDATE work_logs SET verification_status='verified',verified_by_uid='kepsek' WHERE id='log'");
        }
        const before = snapshot();
        expect((await h.request(route, payload({ title: 'Tidak boleh berubah' }))).httpStatus).toBe(403);
        // The existing DELETE endpoint checks log and manual verification locks.
        if (lock !== 'week') {
            expect((await h.request(`${route}/log`, null, h.actor, 'DELETE')).httpStatus).toBe(403);
        }
        expect(snapshot()).toEqual(before);
    });
});

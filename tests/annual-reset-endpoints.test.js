const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function harness() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(read('cloudflare/schema.sql'));
    const state = { sqlite, queries: [], failSQL: null, failFirestore: false, users: new Map(), config: null, auditLogs: [],
        auth: { valid: true, user: { uid: 'admin', role: 'super_admin' } } };
    const prepare = (sql, args = []) => ({
        bind: (...values) => prepare(sql, values),
        execute() {
            state.queries.push(sql);
            if (state.failSQL && sql.includes(state.failSQL)) throw new Error('Injected database failure');
            return sqlite.prepare(sql).run(...args);
        },
        async run() { return { meta: this.execute() }; },
        async all() { state.queries.push(sql); return { results: sqlite.prepare(sql).all(...args) }; },
        async first() { state.queries.push(sql); return sqlite.prepare(sql).get(...args) || null; }
    });
    const DB = { prepare, async batch(statements) {
        sqlite.exec('BEGIN');
        try { const result = statements.map(stmt => ({ meta: stmt.execute() })); sqlite.exec('COMMIT'); return result; }
        catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    } };
    const context = vm.createContext({ URL, URLSearchParams, Request, Response, Headers,
        console: { log() {}, warn() {}, error() {} },
        fetch: async (url, options = {}) => {
            if (url.includes('/rest/v1/audit_logs')) {
                const body = JSON.parse(options.body || '{}');
                state.auditLogs.push(body);
                return new Response('[]', { status: 201 });
            }
            if (state.failFirestore) return new Response(JSON.stringify({ error: { message: 'Firestore unavailable' } }), { status: 503 });
            if (url.endsWith('/settings/system_config')) return state.config
                ? new Response(JSON.stringify({ fields: state.config })) : new Response('{}', { status: 404 });
            const body = JSON.parse(options.body || '{}');
            if (url.endsWith(':runQuery')) {
                const field = body.structuredQuery.where.fieldFilter.field.fieldPath;
                return new Response(JSON.stringify(Array.from(state.users.values()).filter(user => field === 'role'
                    ? user.fields.role.stringValue === 'wali_kelas'
                    : user.fields.additionalRoles?.arrayValue?.values?.some(v => v.stringValue === 'wali_kelas')).map(document => ({ document }))));
            }
            if (url.endsWith(':commit')) {
                for (const write of body.writes) {
                    const id = write.update.name.split('/').pop();
                    if (id === 'system_config') state.config = { ...(state.config || {}), ...write.update.fields };
                    else {
                        const user = state.users.get(id);
                        if (write.currentDocument.updateTime !== user.updateTime) return new Response('{}', { status: 409 });
                        user.fields = { ...user.fields, ...write.update.fields };
                        user.updateTime = '2026-09-05T12:00:00Z';
                    }
                }
                return new Response('{}');
            }
            throw new Error('Unexpected network request: ' + url);
        }
    });
    vm.runInContext(read('cloudflare/worker.js').replace('export default {', 'globalThis.worker = {'), context);
    context.getAuth = () => state.auth;
    vm.runInContext('verifyFirebaseToken = async () => getAuth()', context);
    state.call = async (body, params = null, route = '/api/students/annual-reset') => {
        const request = new Request('https://worker.test' + route + (params ? '?' + new URLSearchParams(params) : ''),
            body ? { method: 'POST', headers: { Authorization: 'Bearer synthetic' }, body: JSON.stringify(body) } : { headers: { Authorization: 'Bearer synthetic' } });
        const result = await context.worker.fetch(request, { DB }, {});
        return { status: result.status, ...await result.json() };
    };
    state.student = (nis, cls, status = 'active') => sqlite.prepare('INSERT INTO students(nis,name,class,status,dapodik_data) VALUES (?,?,?,?,?)')
        .run(nis, 'Synthetic ' + nis, cls, status, JSON.stringify({ class: cls, rombel_saat_ini: cls, untouched: 'keep' }));
    state.record = (id, nis, cls) => sqlite.prepare('INSERT INTO records(id,student_nis,student_class,category,date,timestamp) VALUES (?,?,?,?,?,?)')
        .run(id, nis, cls, 'Pelanggaran', '2026-01-01', '2026-01-01T00:00:00Z');
    state.prepareCleanup = (extra = {}) => state.call({ action: 'prepare_cleanup', operationId: 'cleanup:00000000-0000-0000-0000-000000000001', classes: ['XII.1'], ...extra });
    state.preparePromotion = (extra = {}) => state.call({ action: 'prepare_promotion', academicYear: '2025/2026', ...extra });
    state.commit = operation => state.call({ action: 'commit', operationId: operation.operationId,
        snapshotToken: operation.options?.snapshotToken, backupAcknowledged: true });
    state.cleanupSnapshots = () => context.cleanupAnnualResetSnapshots(DB);
    return state;
}

describe('Annual reset: actual Worker endpoints and SQLite transactions', () => {
    let h;
    beforeEach(() => { h = harness(); });
    afterEach(() => h.sqlite.close());

    test('mixed class: only alumni and their NIS-scoped records are removed', async () => {
        h.student('1', 'XII.1', 'alumni'); h.student('2', 'XII.1');
        h.record('a', '1', 'XI.1'); h.record('b', '2', 'XII.1'); h.record('orphan', '999', 'XII.1');
        const prepared = await h.prepareCleanup();
        expect(prepared.success).toBe(true);
        expect(prepared.totalStudents).toBe(1);
        expect(h.sqlite.prepare('SELECT count(*) n FROM students').get().n).toBe(2);
        const result = await h.commit(prepared);
        expect(result.status).toBe('completed');
        expect(h.sqlite.prepare('SELECT nis FROM students').all().map(r => r.nis)).toEqual(['2']);
        expect(h.sqlite.prepare('SELECT id FROM records ORDER BY id').all().map(r => r.id)).toEqual(['b', 'orphan']);
        const backup = await h.call(null, { operationId: prepared.operationId });
        expect(backup.rows.some(r => r.table_name === 'records' && r.row_key === 'a')).toBe(true);
    });

    test('regular class is never cleared when it contains no alumni', async () => {
        h.student('1', 'XII.1');
        expect((await h.prepareCleanup()).success).toBe(false);
        expect(h.sqlite.prepare('SELECT count(*) n FROM students').get().n).toBe(1);
    });

    test('all selected classes share one transaction; optional records/BK are retained', async () => {
        h.student('1', 'Alumni A', 'alumni'); h.student('2', 'Alumni B', 'alumni');
        h.record('a', '1', 'X.1');
        const op = await h.prepareCleanup({ classes: ['Alumni A', 'Alumni B'], delete_records: false, delete_bk: false });
        h.failSQL = 'DELETE FROM "students"';
        expect((await h.commit(op)).success).toBe(false);
        expect(h.sqlite.prepare('SELECT count(*) n FROM students').get().n).toBe(2);
        h.failSQL = null;
        expect((await h.commit(op)).status).toBe('completed');
        expect(h.sqlite.prepare('SELECT count(*) n FROM records').get().n).toBe(1);
    });

    test('push tokens are backed up by owner, never deleted by teacher class', async () => {
        h.student('1', 'XII.1', 'alumni');
        const insert = h.sqlite.prepare('INSERT INTO fcm_tokens(id,user_id,token,assigned_class) VALUES (?,?,?,?)');
        insert.run('s', '1', 'student-device', 'XII.1'); insert.run('t', 'teacher', 'teacher-device', 'XII.1');
        const op = await h.prepareCleanup();
        await h.commit(op);
        expect(h.sqlite.prepare('SELECT id FROM fcm_tokens').all().map(r => r.id)).toEqual(['t']);
        const backup = await h.call(null, { operationId: op.operationId });
        expect(backup.rows.some(r => r.table_name === 'fcm_tokens' && r.row_key === 's')).toBe(true);
    });

    test.each(['addition', 'edit', 'deletion'])('changed related data (%s) aborts the entire cleanup', async change => {
        h.student('1', 'XII.1', 'alumni'); h.record('a', '1', 'XII.1');
        const op = await h.prepareCleanup();
        if (change === 'addition') h.record('b', '1', 'XII.1');
        if (change === 'edit') h.sqlite.exec("UPDATE records SET points = 10 WHERE id = 'a'");
        if (change === 'deletion') h.sqlite.exec("DELETE FROM records WHERE id = 'a'");
        const result = await h.commit(op);
        expect(result.success).toBe(false);
        expect(result.status).toBe(409);
        expect(h.sqlite.prepare('SELECT count(*) n FROM students').get().n).toBe(1);
    });

    test('server requires backup acknowledgement; cached legacy clients fail closed', async () => {
        h.student('1', 'X.1');
        const op = await h.preparePromotion();
        expect((await h.call({ action: 'commit', operationId: op.operationId })).status).toBe(400);
        for (const route of ['/api/students/promote-classes', '/api/students/cleanup-alumni-class']) {
            expect((await h.call({ academicYear: '2025/2026', class: 'X.1' }, null, route)).status).toBe(409);
        }
        expect(h.sqlite.prepare('SELECT class FROM students').get().class).toBe('X.1');
    });

    test('same-year retry and duplicate commit never promote a second time', async () => {
        h.student('1', 'X.1');
        const op = await h.preparePromotion();
        expect(op.success).toBe(true);
        await h.commit(op); await h.commit(op);
        const again = await h.preparePromotion();
        expect(again.operationId).toBe(op.operationId);
        expect(again.status).toBe('committed');
        expect(h.sqlite.prepare('SELECT class FROM students').get().class).toBe('XI.1');
        expect((await h.preparePromotion({ academicYear: '2026/2027' })).status).toBe(409);
    });

    test('inactive students and existing alumni remain unchanged; valid grades advance once', async () => {
        for (const [nis, cls, status] of [['1','X.1','keluar'],['2','XI.2','mutasi'],['3','XII.3','alumni'],['4','X-1','aktif'],['5','XI.1','active'],['6','xii 2','active']]) h.student(nis, cls, status);
        const op = await h.preparePromotion();
        expect(op.totalStudents).toBe(3);
        await h.commit(op);
        expect(h.sqlite.prepare('SELECT class,status FROM students ORDER BY nis').all()).toEqual([
            { class: 'X.1', status: 'keluar' }, { class: 'XI.2', status: 'mutasi' }, { class: 'XII.3', status: 'alumni' },
            { class: 'XI-1', status: 'active' }, { class: 'XII.1', status: 'active' }, { class: 'Alumni xii 2 (2025/2026)', status: 'alumni' }
        ]);
        const dapodik = JSON.parse(h.sqlite.prepare("SELECT dapodik_data FROM students WHERE nis='4'").get().dapodik_data);
        expect(dapodik.rombel_saat_ini).toBe('XI-1'); expect(dapodik.untouched).toBe('keep');
    });

    test('failure after updating 151 students rolls back all grades, GTK and operation status', async () => {
        for (let i = 0; i < 151; i++) h.student(String(i), 'X.1');
        const op = await h.preparePromotion();
        h.failSQL = 'UPDATE gtk SET';
        expect((await h.commit(op)).success).toBe(false);
        expect(h.sqlite.prepare("SELECT count(*) n FROM students WHERE class='X.1'").get().n).toBe(151);
        expect(h.sqlite.prepare('SELECT status FROM annual_reset_operations').get().status).toBe('prepared');
        h.failSQL = null;
        expect((await h.commit(op)).promotedCount).toBe(151);
    });

    test.each(['foo/bar', '2025/2025', '2025/2027', '', '2025/26'])('rejects invalid academic year %s before snapshot', async academicYear => {
        h.student('1', 'XII.1');
        expect((await h.preparePromotion({ academicYear })).status).toBe(400);
        expect(h.sqlite.prepare('SELECT class FROM students').get().class).toBe('XII.1');
    });

    test('legacy Firestore history also prevents duplicate promotion', async () => {
        h.student('1', 'X.1');
        h.config = { lastAcademicYearPromoted: { stringValue: '2025/2026' } };
        expect((await h.preparePromotion()).status).toBe(409);
    });

    test('Firestore failure remains pending and can finish without repeating promotion', async () => {
        h.student('1', 'X.1');
        h.users.set('teacher', { name: 'projects/smagesa/databases/(default)/documents/users/teacher', updateTime: '2026-01-01T00:00:00Z',
            fields: { role: { stringValue: 'guru_bk' }, additionalRoles: { arrayValue: { values: [{ stringValue: 'wali_kelas' }, { stringValue: 'admin_perpus' }] } }, assignedClass: { stringValue: 'X.1' } } });
        const op = await h.preparePromotion(); await h.commit(op);
        h.failFirestore = true;
        expect((await h.call({ action: 'finalize', operationId: op.operationId })).success).toBe(false);
        expect(h.sqlite.prepare('SELECT status FROM annual_reset_operations').get().status).toBe('committed');
        h.failFirestore = false;
        expect((await h.call({ action: 'finalize', operationId: op.operationId })).status).toBe('completed');
        const teacher = h.users.get('teacher');
        expect(teacher.fields.role.stringValue).toBe('guru_bk');
        expect(teacher.fields.additionalRoles.arrayValue.values).toEqual([{ stringValue: 'admin_perpus' }]);
        expect(h.sqlite.prepare('SELECT class FROM students').get().class).toBe('XI.1');
    });

    test('restore really writes raw D1 columns and preserves unrelated rows', async () => {
        h.student('1', 'XII.1', 'alumni'); h.student('2', 'X.2');
        h.sqlite.exec("UPDATE students SET birth_place='Abang', violation_points=17 WHERE nis='1'");
        const op = await h.prepareCleanup();
        const backup = await h.call(null, { operationId: op.operationId }); await h.commit(op);
        const rows = backup.rows.filter(r => r.table_name === 'students').map(r => JSON.parse(r.data));
        expect((await h.call({ action: 'restore', table: 'students', records: rows })).restored).toBe(1);
        expect(h.sqlite.prepare("SELECT birth_place,violation_points FROM students WHERE nis='1'").get()).toEqual({ birth_place: 'Abang', violation_points: 17 });
        expect(h.sqlite.prepare("SELECT class FROM students WHERE nis='2'").get().class).toBe('X.2');
        expect((await h.call({ action: 'restore', table: 'system_settings', records: rows })).status).toBe(400);
    });

    test('backup and mutation endpoints require verified super admin', async () => {
        h.auth.user.role = 'guru_mapel';
        expect((await h.preparePromotion()).status).toBe(403);
        expect((await h.call(null, {})).status).toBe(403);
        h.auth.valid = false;
        expect((await h.preparePromotion()).status).toBe(401);
    });

    test('all 12 cleanup tables round-trip through snapshot and real restore without column loss', async () => {
        h.student('0001', 'XII.1', 'alumni'); h.student('unrelated', 'X.2');
        const tables = { student_aggregates: 'student_nis', records: 'student_nis', bk_actions: 'student_nis',
            rapor_scores: 'nis', permisi_requests: 'student_nis', guru_wali_assignments: 'student_nis',
            guru_wali_notes: 'student_nis', walikelas_notes: 'student_nis', peminatan_responses: 'nis', fcm_tokens: 'user_id',
            student_photos: 'nis' };
        for (const [table, nisColumn] of Object.entries(tables)) {
            const columns = h.sqlite.prepare(`PRAGMA table_info(${table})`).all();
            const row = { [nisColumn]: '0001' };
            for (const column of columns) if ((column.notnull && column.dflt_value === null) || column.pk) {
                row[column.name] ??= column.type.includes('INT') ? 1 : `${table}_${column.name}`;
            }
            const keys = Object.keys(row);
            h.sqlite.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => row[k]));
        }
        const op = await h.prepareCleanup();
        expect(op.options.tables).toHaveLength(12);
        const backup = await h.call(null, { operationId: op.operationId });
        expect(new Set(backup.rows.map(r => r.table_name)).size).toBe(12);
        expect((await h.commit(op)).status).toBe('completed');
        for (const row of backup.rows) {
            const value = JSON.parse(row.data);
            const result = await h.call({ action: 'restore', table: row.table_name, records: [value] });
            expect(result.restored).toBe(1);
            const pk = (row.table_name === 'students' || row.table_name === 'student_photos') ? 'nis' : row.table_name === 'student_aggregates' ? 'student_nis' : 'id';
            expect(h.sqlite.prepare(`SELECT * FROM ${row.table_name} WHERE ${pk}=?`).get(row.row_key)).toEqual(value);
        }
        expect(h.sqlite.prepare("SELECT class FROM students WHERE nis='unrelated'").get().class).toBe('X.2');
    });

    test('fresh snapshot invalidates old commit token, and changed students remain protected', async () => {
        h.student('1', 'X.1');
        const old = await h.preparePromotion();
        h.sqlite.exec("UPDATE students SET class='X.2' WHERE nis='1'");
        const fresh = await h.preparePromotion({ refresh: true });
        expect(fresh.options.snapshotToken).not.toBe(old.options.snapshotToken);
        expect((await h.commit(old)).status).toBe(409);
        expect((await h.commit(fresh)).status).toBe('committed');
        expect(h.sqlite.prepare('SELECT class FROM students').get().class).toBe('XI.2');
    });

    test('concurrent preparations and commits replay one promotion identity', async () => {
        h.student('1', 'X.1');
        const prepared = await Promise.all([h.preparePromotion(), h.preparePromotion()]);
        expect(prepared.every(r => r.success)).toBe(true);
        const result = await Promise.all([h.commit(prepared[0]), h.commit(prepared[1])]);
        expect(result.every(r => r.status === 'committed')).toBe(true);
        expect(h.sqlite.prepare('SELECT class FROM students').get().class).toBe('XI.1');
        expect(h.auditLogs.some(log => log.action === 'CLASS_PROMOTION')).toBe(true);
    });

    test('large cohort uses bounded SQL and backup pages have no omissions or duplicates', async () => {
        for (let i = 0; i < 501; i++) h.student(String(i).padStart(5, '0'), 'X.1');
        h.queries.length = 0;
        const op = await h.preparePromotion();
        expect(h.queries.length).toBeLessThan(50);
        let cursor = null;
        const keys = [];
        do {
            const page = await h.call(null, { operationId: op.operationId, ...(cursor ? { cursor } : {}) });
            expect(page.rows.length).toBeLessThanOrEqual(200);
            keys.push(...page.rows.filter(r => r.table_name === 'students').map(r => r.row_key));
            cursor = page.nextCursor;
        } while (cursor);
        expect(keys).toHaveLength(501); expect(new Set(keys).size).toBe(501);
        h.queries.length = 0;
        expect((await h.commit(op)).promotedCount).toBe(501);
        expect(h.queries.length).toBeLessThan(50);
    });

    test('corrupt Dapodik JSON cannot cause partial promotion', async () => {
        h.student('1', 'X.1'); h.student('2', 'XI.1');
        h.sqlite.exec("UPDATE students SET dapodik_data='not json' WHERE nis='2'");
        const op = await h.preparePromotion();
        expect((await h.commit(op)).status).toBe('committed');
        expect(JSON.parse(h.sqlite.prepare("SELECT dapodik_data FROM students WHERE nis='2'").get().dapodik_data).class).toBe('XII.1');
    });

    test('new staff assignment is not overwritten during finalization', async () => {
        h.student('1', 'X.1');
        h.users.set('teacher', { name: 'projects/smagesa/databases/(default)/documents/users/teacher', updateTime: '2026-01-01T00:00:00Z',
            fields: { role: { stringValue: 'wali_kelas' }, assignedClass: { stringValue: 'X.1' } } });
        const op = await h.preparePromotion(); await h.commit(op);
        h.users.get('teacher').fields.assignedClass.stringValue = 'XI.3';
        expect((await h.call({ action: 'finalize', operationId: op.operationId })).status).toBe(409);
        expect(h.users.get('teacher').fields.assignedClass.stringValue).toBe('XI.3');
    });

    test('restore never rebinds a device which now belongs to another account', async () => {
        h.sqlite.prepare('INSERT INTO fcm_tokens(id,user_id,token) VALUES (?,?,?)').run('device', 'new-owner', 'token');
        const result = await h.call({ action: 'restore', table: 'fcm_tokens', records: [{ id: 'device', user_id: 'old-owner', token: 'token' }] });
        expect(result.success).toBe(false);
        expect(h.sqlite.prepare('SELECT user_id FROM fcm_tokens').get().user_id).toBe('new-owner');
    });

    test('retention expires only snapshots, retaining locks and pending recovery data', async () => {
        h.student('1', 'X.1');
        const pending = await h.preparePromotion(); await h.commit(pending);
        h.student('2', 'XII.1', 'alumni');
        const done = await h.prepareCleanup(); await h.commit(done);
        h.sqlite.exec("UPDATE annual_reset_operations SET created_at=datetime('now','-31 days')");
        await h.cleanupSnapshots();
        expect(h.sqlite.prepare('SELECT count(*) n FROM annual_reset_snapshots WHERE operation_id=?').get(done.operationId).n).toBe(0);
        expect(h.sqlite.prepare('SELECT count(*) n FROM annual_reset_snapshots WHERE operation_id=?').get(pending.operationId).n).toBeGreaterThan(0);
        expect(h.sqlite.prepare('SELECT count(*) n FROM annual_reset_operations').get().n).toBe(2);
        expect((await h.call(null, { operationId: done.operationId })).status).toBe(410);
    });
});

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const migration = read('cloudflare/migrations/202609040002_optimize_records_timestamp_indexes.sql');
const source = read('cloudflare/worker.js');

function harness({ migrated = true, forceError = null } = {}) {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(read('cloudflare/migrations/202608290005_add_records_aggregates_and_bk_actions.sql'));
    for (const file of ['202608310001_optimize_d1_indexes.sql', '202609030001_d1_performance_indexes.sql']) {
        for (const sql of read(`cloudflare/migrations/${file}`).match(/CREATE INDEX[^;]+ ON records\([^;]+;/g) || []) sqlite.exec(sql);
    }
    if (migrated) sqlite.exec(migration);
    const insert = sqlite.prepare(`INSERT INTO records
        (id, student_nis, student_name, student_class, category, date, timestamp, status, points, desc)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    sqlite.exec('BEGIN');
    for (let i = 0; i < 600; i++) {
        insert.run(`r${i}`, String(i % 20), `Siswa ${i % 20}`, `X-${i % 4}`,
            ['Pelanggaran', 'Prestasi', 'Permisi'][Math.floor(i / 7) % 3],
            `2026-09-${String(i % 5 + 1).padStart(2, '0')}`,
            new Date(Date.UTC(2026, 8, 1) + i * 60000).toISOString(),
            ['active', 'active', 'active', 'deleted', '', null][i % 6], i % 10, `Catatan ${i}`);
    }
    sqlite.exec('COMMIT');
    const queries = [];
    let ignoreIndex = false;
    const prepare = (sql, args = []) => ({
        bind: (...values) => prepare(sql, values),
        all: async () => {
            const actualSql = ignoreIndex ? sql.replace(/ INDEXED BY \w+/, '') : sql;
            queries.push({ sql: actualSql, args });
            if (forceError) throw forceError;
            try {
                return { results: sqlite.prepare(actualSql).all(...args) };
            } catch (cause) {
                // D1 may wrap the underlying SQLite diagnostic in Error.cause.
                throw new Error('D1_ERROR: query failed', { cause });
            }
        }
    });
    const context = vm.createContext({ URL, URLSearchParams, Request, Response, Headers,
        console: { log() {}, warn() {}, error() {} } });
    vm.runInContext(source.replace('export default {', 'globalThis.workerHandler = {'), context);
    // GET /api/records kini mensyaratkan login staf; test ini fokus pada query & indeks
    vm.runInContext('verifyFirebaseToken = async () => ({ valid: true, user: { uid: "staff", role: "guru_bk", additionalRoles: [], isAnonymous: false } });', context);
    const get = async (params = {}, baseline = false) => {
        ignoreIndex = baseline;
        const response = await context.workerHandler.fetch(
            new Request(`https://worker.test/api/records?${new URLSearchParams(params)}`), { DB: { prepare } }, {});
        return { status: response.status, body: await response.json() };
    };
    return { sqlite, queries, get };
}

const feeds = [
    ['active', {}, 'idx_records_active_ts'],
    ['category', { category: 'Pelanggaran' }, 'idx_records_active_cat_ts'],
    ['class', { class: 'X-1' }, 'idx_records_active_class_ts'],
    ['class-category', { class: 'X-1', category: 'Pelanggaran' }, 'idx_records_active_class_cat_ts']
];

describe('Records Worker queries against real SQLite', () => {
    let h;
    beforeEach(() => { h = harness(); });
    afterEach(() => h.sqlite.close());

    test.each(feeds)('%s uses the intended index without a temporary sort in both directions', async (_, filters, index) => {
        for (const order of ['ASC', 'DESC']) {
            const result = await h.get({ ...filters, order, limit: 10, offset: 3 });
            expect(result.status).toBe(200);
            const query = h.queries.at(-1);
            const plan = h.sqlite.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.args).map(r => r.detail).join('\n');
            expect(plan).toContain(`USING INDEX ${index}`);
            expect(plan).not.toContain('TEMP B-TREE');
            expect(result).toEqual(await h.get({ ...filters, order, limit: 10, offset: 3 }, true));
        }
    });

    test('migration is repeatable and leaves every stored record untouched', () => {
        const before = h.sqlite.prepare('SELECT * FROM records ORDER BY id').all();
        h.sqlite.exec(migration);
        h.sqlite.exec(migration);
        expect(h.sqlite.prepare('SELECT * FROM records ORDER BY id').all()).toEqual(before);
    });

    test.each([
        { date_start: '2026-09-02' }, { date_end: '2026-09-03' },
        { category: 'Pelanggaran', date_start: '2026-09-02', date_end: '2026-09-04' },
        { class: 'X-1', category: 'Pelanggaran', date_start: '2026-09-02' },
        { nis: ' 1 ' }, { student_nis: '1', class: 'X-1', category: 'Pelanggaran' }
    ])('retains planner choice and filters for %j', async filters => {
        const result = await h.get({ ...filters, limit: 1000 });
        expect(result.status).toBe(200);
        expect(h.queries.at(-1).sql).not.toContain('INDEXED BY');
        expect(result.body.data.length).toBeGreaterThan(0);
        for (const row of result.body.data) {
            expect(row.status).toBe('active');
            if (filters.date_start) expect(row.date >= filters.date_start).toBe(true);
            if (filters.date_end) expect(row.date <= filters.date_end).toBe(true);
            if (filters.category) expect(row.category).toBe(filters.category);
            if (filters.class) expect(row.studentClass).toBe(filters.class);
            if (filters.nis || filters.student_nis) expect(row.studentNIS).toBe('1');
        }
    });

    test('ALL, empty filters, defaults, empty results, and response fields stay compatible', async () => {
        const normal = await h.get();
        expect(normal.body.total).toBe(100);
        expect(await h.get({ class: 'ALL', category: 'ALL' })).toEqual(normal);
        expect(await h.get({ class: '', category: '', nis: '', date_start: '', date_end: '' })).toEqual(normal);
        expect(await h.get({ category: 'missing' })).toEqual({ status: 200, body: { success: true, total: 0, data: [] } });
        expect(normal.body.data[0]).toMatchObject({
            id: expect.any(String), studentNIS: expect.any(String), studentName: expect.any(String),
            studentClass: expect.any(String), category: expect.any(String), points: expect.any(Number),
            desc: expect.any(String), date: expect.any(String), timestampIso: expect.any(String),
            timestamp: { seconds: expect.any(Number) }, status: 'active'
        });
        expect(normal).toEqual(await h.get({}, true));
    });

    test.each(feeds)('%s remains available before the timestamp migration is installed', async (_, filters) => {
        const old = harness({ migrated: false });
        try {
            const result = await old.get(filters);
            expect(result.status).toBe(200);
            expect(old.queries).toHaveLength(2);
            expect(old.queries[1].sql).not.toContain('INDEXED BY');
            expect(result).toEqual(await old.get(filters, true));
        } finally { old.sqlite.close(); }
    });

    test('unrelated database failures are not hidden or retried', async () => {
        const failed = harness({ forceError: new Error('D1_ERROR: database unavailable') });
        try {
            expect((await failed.get()).status).toBe(500);
            expect(failed.queries).toHaveLength(1);
        } finally { failed.sqlite.close(); }
    });

    test('equal timestamps retain all matching records in timestamp order across pages', async () => {
        h.sqlite.exec("UPDATE records SET timestamp = '2026-09-01T00:00:00.000Z' WHERE id IN ('r0','r1','r2','r6','r7','r8')");
        for (const order of ['ASC', 'DESC']) {
            const all = (await h.get({ order, limit: 1000 })).body.data;
            const before = (await h.get({ order, limit: 1000 }, true)).body.data;
            // ORDER BY timestamp has never specified an order within equal timestamps.
            expect(all.map(r => r.id).sort()).toEqual(before.map(r => r.id).sort());
            expect(all.map(r => r.timestampIso)).toEqual(before.map(r => r.timestampIso));
            const first = (await h.get({ order, limit: 5 })).body.data;
            const second = (await h.get({ order, limit: 5, offset: 5 })).body.data;
            expect([...first, ...second]).toEqual(all.slice(0, 10));
        }
    });
});

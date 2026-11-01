/**
 * tests/route-access-guard.test.js
 *
 * Guard akses terpusat (resolveRouteAccessPolicy / enforceRouteAccessPolicy) pada worker.js:
 * rute data siswa, BK, perwalian, permisi, rapor, peminatan & PID yang sebelumnya terbuka tanpa login.
 * Menjalankan worker.js sungguhan di atas SQLite in-memory.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const MIGRATION_SECRET = 'test-migration-secret';
const JURNAL_API_KEY = 'test-jurnal-key';

const ANON = { valid: false, error: 'Missing or invalid Authorization header' };
const staff = (role, extra = {}) => ({ valid: true, user: { uid: 'u-' + role, role, additionalRoles: [], isAnonymous: false, claims: {}, ...extra } });
const student = nis => ({ valid: true, user: { uid: 'anon-' + nis, role: '', additionalRoles: [], isAnonymous: true,
    claims: { studentVerified: true, studentNis: nis, studentClass: 'XII.1' } } });

function harness() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(read('cloudflare/schema.sql'));
    for (const f of fs.readdirSync(path.join(__dirname, '..', 'cloudflare/migrations')).sort()) {
        try { sqlite.exec(read('cloudflare/migrations/' + f)); } catch (_) {}
    }
    const insert = (sql, ...args) => { try { sqlite.prepare(sql).run(...args); } catch (_) {} };
    insert("INSERT INTO students(nis,name,class,status) VALUES (?,?,?,?)", '1001', 'Siswa A', 'XII.1', 'active');
    insert("INSERT INTO students(nis,name,class,status) VALUES (?,?,?,?)", '1002', 'Siswa B', 'XII.1', 'active');
    insert("INSERT INTO records(id,student_nis,student_name,student_class,category,date,timestamp,status) VALUES (?,?,?,?,?,?,?,?)",
        'r1', '1001', 'Siswa A', 'XII.1', 'Pelanggaran', '2026-01-01', '2026-01-01T00:00:00Z', 'active');
    insert("INSERT INTO records(id,student_nis,student_name,student_class,category,date,timestamp,status) VALUES (?,?,?,?,?,?,?,?)",
        'r2', '1002', 'Siswa B', 'XII.1', 'Pelanggaran', '2026-01-02', '2026-01-02T00:00:00Z', 'active');

    const prepare = (sql, args = []) => ({
        bind: (...v) => prepare(sql, v),
        async run() { return { meta: sqlite.prepare(sql).run(...args) }; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        async first() { return sqlite.prepare(sql).get(...args) || null; }
    });
    const DB = { prepare, async batch(s) { return Promise.all(s.map(x => x.run())); }, async exec(sql) { sqlite.exec(sql); } };
    const bucket = { async get() { return null; }, async put() {}, async delete() {}, async list() { return { objects: [], truncated: false }; } };
    const context = vm.createContext({ URL, URLSearchParams, Request, Response, Headers, crypto, atob, btoa, TextEncoder, TextDecoder, FormData, Blob,
        setTimeout, clearTimeout, console: { log() {}, warn() {}, error() {}, info() {} },
        fetch: async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }) });
    vm.runInContext(read('cloudflare/worker.js').replace('export default {', 'globalThis.worker = {'), context);
    const state = { sqlite, auth: ANON };
    context.getAuth = () => state.auth;
    vm.runInContext('verifyFirebaseToken = async () => getAuth();', context);
    const env = { DB, STUDENT_PHOTOS_BUCKET: bucket, GTK_PHOTOS_BUCKET: bucket, MIGRATION_SECRET, JURNAL_API_KEY };
    state.call = async (method, route, body, headers = {}) => {
        const init = { method, headers: { 'Content-Type': 'application/json', ...headers } };
        if (body !== undefined) init.body = JSON.stringify(body);
        const res = await context.worker.fetch(new Request('https://worker.test' + route, init), env, { waitUntil() {} });
        let json = {};
        try { json = JSON.parse(await res.text()); } catch (_) {}
        return { status: res.status, json };
    };
    return state;
}

// Rute yang kini wajib login (method, path, body)
const GUARDED = [
    ['GET', '/api/records'], ['GET', '/api/records/stats'], ['GET', '/api/records/top-violators'],
    ['GET', '/api/records/class-aggregates'], ['GET', '/api/records/r1'],
    ['GET', '/api/bk-actions'], ['GET', '/api/bk-actions/stats'], ['GET', '/api/bk-actions/student-context/1001'], ['GET', '/api/bk-actions/x'],
    ['POST', '/api/bk-actions', { student_nis: '1001' }], ['PUT', '/api/bk-actions/x', {}], ['DELETE', '/api/bk-actions/x'],
    ['GET', '/api/student-aggregates'], ['GET', '/api/student-aggregates/1001'], ['POST', '/api/student-aggregates/recalculate', {}],
    ['GET', '/api/perwalian/assignments'], ['GET', '/api/perwalian/notes'], ['GET', '/api/walikelas/notes'],
    ['GET', '/api/permisi'], ['POST', '/api/permisi', { student_nis: '1001', reason: 'x' }],
    ['GET', '/api/rapor/scores'], ['GET', '/api/rapor/rekap'],
    ['PUT', '/api/peminatan/config', {}], ['GET', '/api/peminatan/status?nis=1001'],
    ['GET', '/api/peminatan/responses'], ['GET', '/api/peminatan/responses/2026/1001'],
    ['POST', '/api/peminatan/responses', { nis: '1001', name: 'A' }], ['DELETE', '/api/peminatan/responses/2026/1001'],
    ['POST', '/api/peminatan/responses/move', {}],
    ['POST', '/api/pid-games', {}], ['PUT', '/api/pid-games/1', {}], ['DELETE', '/api/pid-games/1'], ['PUT', '/api/pid-games/config', {}], ['POST', '/api/pid-games/config', {}],
    ['POST', '/api/migrate/bk-actions', {}], ['POST', '/api/migrate/perwalian', {}], ['POST', '/api/migrate/permisi', {}],
    ['POST', '/api/migrate/schema-records-bk', {}], ['POST', '/api/migrate/schema-notifications', {}],
    ['POST', '/api/bk-actions/move-nis', {}], ['POST', '/api/perwalian/move-nis', {}], ['POST', '/api/walikelas/move-nis', {}],
    ['POST', '/api/permisi/move-nis', {}], ['POST', '/api/rapor/move-nis', {}], ['POST', '/api/peminatan/move-nis', {}],
    ['POST', '/api/peminatan/responses/move-nis', {}], ['POST', '/api/jurnal/move-nis', {}], ['POST', '/api/notifications/move-nis', {}]
];

// Rute publik by-design yang TIDAK boleh ikut terkunci (dipakai halaman tanpa login)
const STILL_PUBLIC = [
    ['GET', '/api/agenda/events'], ['GET', '/api/jurnal/master'], ['GET', '/api/jurnal/settings'],
    ['GET', '/api/pid-games'], ['GET', '/api/pid-games/config'], ['GET', '/api/pid-games/teachers'],
    ['GET', '/api/peminatan/config'], ['GET', '/api/rapor/config'], ['GET', '/api/yearbook/classes'],
    ['GET', '/api/labs'], ['GET', '/api/violation-types'], ['PUT', '/api/jurnal/1', {}],
    ['POST', '/api/pid-games/ai-generate', {}]
];

describe('Guard akses terpusat Worker', () => {
    let h;
    beforeEach(() => { h = harness(); });
    afterEach(() => h.sqlite.close());

    test('tanpa login: semua rute sensitif ditolak 401', async () => {
        const leaks = [];
        for (const [m, p, b] of GUARDED) {
            const res = await h.call(m, p, b);
            if (res.status !== 401) leaks.push(`${m} ${p} -> ${res.status}`);
        }
        expect(leaks).toEqual([]);
    });

    test('rute publik by-design tetap dapat diakses tanpa login', async () => {
        const blocked = [];
        for (const [m, p, b] of STILL_PUBLIC) {
            const res = await h.call(m, p, b);
            if (res.status === 401 || res.status === 403) blocked.push(`${m} ${p} -> ${res.status}`);
        }
        expect(blocked).toEqual([]);
    });

    test('staf dengan berbagai peran (termasuk di luar STAFF_AND_TEACHER_ROLES) tetap dapat mengakses rute staf', async () => {
        for (const role of ['guru_mapel', 'guru_bk', 'wali_kelas', 'kesiswaan', 'admin_dapodik', 'tendik', 'admin_lks', 'bk']) {
            h.auth = staff(role);
            for (const [m, p] of [['GET', '/api/records/stats'], ['GET', '/api/bk-actions/stats'], ['GET', '/api/records']]) {
                const res = await h.call(m, p);
                expect([role, m, p, res.status]).toEqual([role, m, p, 200]);
            }
        }
    });

    test('peran ditambahkan lewat additionalRoles juga diakui', async () => {
        h.auth = staff('', { additionalRoles: ['wali_kelas'] });
        expect((await h.call('GET', '/api/records/stats')).status).toBe(200);
    });

    test('akun non-anonim tanpa peran (mis. daftar mandiri) atau berperan siswa ditolak 403', async () => {
        h.auth = staff('');
        expect((await h.call('GET', '/api/records/stats')).status).toBe(403);
        h.auth = staff('siswa');
        expect((await h.call('GET', '/api/records/stats')).status).toBe(403);
    });

    test('siswa: hanya data miliknya sendiri, filter dipaksa ke NIS sesi', async () => {
        h.auth = student('1001');
        const own = await h.call('GET', '/api/records?student_nis=1001');
        expect(own.status).toBe(200);
        expect(own.json.data.map(r => r.studentNIS)).toEqual(['1001']);

        // Tanpa filter: tetap hanya miliknya (bukan seluruh sekolah)
        const noFilter = await h.call('GET', '/api/records');
        expect(noFilter.status).toBe(200);
        expect(noFilter.json.data.map(r => r.studentNIS)).toEqual(['1001']);

        expect((await h.call('GET', '/api/records?student_nis=1002')).status).toBe(403);
        expect((await h.call('GET', '/api/records?nis=1002')).status).toBe(403);
        expect((await h.call('GET', '/api/student-aggregates/1001')).status).toBe(200);
        expect((await h.call('GET', '/api/student-aggregates/1002')).status).toBe(403);
        expect((await h.call('GET', '/api/peminatan/status?nis=1001')).status).toBe(200);
        expect((await h.call('GET', '/api/peminatan/status?nis=1002')).status).toBe(403);
    });

    test('siswa: rute yang dipakai portal siswa tetap berfungsi', async () => {
        h.auth = student('1001');
        for (const p of ['/api/bk-actions?nis=1001&limit=20', '/api/perwalian/assignments?student_nis=1001',
            '/api/perwalian/notes?student_nis=1001&limit=50', '/api/permisi?student_nis=1001&date=2026-10-11']) {
            const res = await h.call('GET', p);
            expect([p, res.status]).toEqual([p, 200]);
        }
    });

    test('siswa: tidak dapat membuka rute khusus staf', async () => {
        h.auth = student('1001');
        for (const [m, p, b] of [['GET', '/api/records/stats'], ['GET', '/api/bk-actions/student-context/1001'],
            ['DELETE', '/api/bk-actions/x'], ['GET', '/api/rapor/scores'], ['GET', '/api/peminatan/responses'], ['POST', '/api/pid-games', {}]]) {
            expect([m, p, (await h.call(m, p, b)).status]).toEqual([m, p, 403]);
        }
    });

    test('siswa: kirim permisi & kuesioner hanya atas NIS sendiri', async () => {
        h.auth = student('1001');
        expect((await h.call('POST', '/api/permisi', { student_nis: '1002', reason: 'x' })).status).toBe(403);
        const okPermisi = await h.call('POST', '/api/permisi', { id: 'p1', student_nis: '1001', student_class: '', reason: 'Izin keluar' });
        expect([200, 201]).toContain(okPermisi.status);
        expect((await h.call('POST', '/api/peminatan/responses', { nis: '1002', name: 'B' })).status).toBe(403);
        const okPem = await h.call('POST', '/api/peminatan/responses', { nis: '1001', name: 'A', year: '2026' });
        expect([200, 201]).toContain(okPem.status);
    });

    test('migrasi & pindah NIS: hanya Super Admin atau MIGRATION_SECRET', async () => {
        h.auth = staff('kesiswaan');
        expect((await h.call('POST', '/api/bk-actions/move-nis', {})).status).toBe(403);
        expect((await h.call('POST', '/api/migrate/permisi', {})).status).toBe(403);

        h.auth = staff('guru_mapel', { additionalRoles: ['super_admin'] });
        expect((await h.call('POST', '/api/migrate/permisi', { items: [] })).status).not.toBe(403);

        h.auth = ANON;
        expect((await h.call('POST', '/api/migrate/permisi', { items: [] }, { 'X-Migration-Key': MIGRATION_SECRET })).status).not.toBe(401);
    });

    test('JURNAL_API_KEY (pernah tertanam di kode klien) tidak lagi membuka rute yang dijaga', async () => {
        h.auth = ANON;
        expect((await h.call('GET', '/api/records', undefined, { 'X-Sync-Key': JURNAL_API_KEY })).status).toBe(401);
        expect((await h.call('POST', '/api/migrate/permisi', {}, { 'X-Api-Key': JURNAL_API_KEY })).status).toBe(401);
    });

    test('simpan pengaturan sistem: tolak anonim/siswa/JURNAL_API_KEY, izinkan staf', async () => {
        h.auth = ANON;
        expect((await h.call('POST', '/api/settings/ranking_access_config', { value: { mode: 'open' } })).status).toBe(401);
        expect((await h.call('PUT', '/api/settings/finance_rates', { value: {} }, { 'X-Sync-Key': JURNAL_API_KEY })).status).toBe(401);
        h.auth = student('1001');
        expect((await h.call('POST', '/api/settings/ranking_access_config', { value: { mode: 'open' } })).status).toBe(403);
        h.auth = staff('admin_kelas');
        expect((await h.call('POST', '/api/settings/book_orders_data', { value: { orders: [] } })).status).toBe(200);
        // Membaca pengaturan tetap publik (dipakai halaman login)
        h.auth = ANON;
        expect((await h.call('GET', '/api/settings')).status).toBe(200);
    });

    test('staf PID dapat menyimpan konfigurasi & game', async () => {
        h.auth = staff('guru_mapel');
        expect((await h.call('PUT', '/api/pid-games/config', { allowed_subjects: [] })).status).toBe(200);
    });
});

describe('Frontend PID mengirim token login & tidak lagi menanam sync key', () => {
    const admin = read('pid/admin.js');
    const portal = read('pid/portalpid.html');

    test('kunci JURNAL_API_KEY tidak lagi tertanam di kode klien', () => {
        expect(admin).not.toMatch(/smagesa_jurnal_key/);
        expect(portal).not.toMatch(/smagesa_jurnal_key/);
    });

    test('seluruh operasi tulis panel admin PID memakai header ber-token', () => {
        const writes = admin.match(/method: '(POST|PUT|DELETE)'[^}]*}/g) || [];
        expect(writes.length).toBe(5);
        for (const w of writes) expect(w).toContain('getAuthJsonHeaders()');
    });

    test('form ajukan/edit game di portal PID memakai header ber-token', () => {
        expect(portal).toContain("const pidHeaders = { 'Content-Type': 'application/json', ...(pidToken ? { 'Authorization': `Bearer ${pidToken}` } : {}) };");
        expect((portal.match(/headers: pidHeaders/g) || []).length).toBe(2);
    });
});

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const { generateKeyPairSync, sign, webcrypto } = require('node:crypto');
const { JSDOM } = require('jsdom');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const source = read('cloudflare/worker.js');
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'local-test', alg: 'RS256', use: 'sig' };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const firestoreFields = obj => Object.fromEntries(Object.entries(obj).map(([key, value]) => [key,
    Array.isArray(value) ? { arrayValue: { values: value.map(item => ({ stringValue: item })) } } : { stringValue: value }
]));

function harness() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(read('cloudflare/migrations/202608290005_add_records_aggregates_and_bk_actions.sql'));
    sqlite.exec(read('cloudflare/migrations/202610190001_expand_records_achievement_fields.sql'));
    const profiles = new Map([
        ['owner', { name: 'Guru Pemilik', role: 'guru_mapel' }],
        ['other', { name: 'Guru Lain', role: 'guru_mapel' }],
        ['admin', { name: 'Administrator', role: 'super_admin' }],
        ['multi', { name: 'Admin Tambahan', role: 'guru_mapel', additionalRoles: ['super_admin'] }],
        ['student', { name: 'Siswa', role: 'siswa' }],
        ['head', { name: 'Kepala Sekolah', role: 'kepala_sekolah' }],
        ['unknown', { name: 'Tanpa Penugasan', role: '' }]
    ]);
    const queries = [];
    const execute = (sql, args, mode) => {
        queries.push(sql);
        const statement = sqlite.prepare(sql);
        if (mode === 'all') return { results: statement.all(...args) };
        if (mode === 'first') return statement.get(...args) || null;
        return { meta: { changes: Number(statement.run(...args).changes) } };
    };
    const prepare = (sql, args = []) => ({ sql, args,
        bind: (...values) => prepare(sql, values),
        first: async () => execute(sql, args, 'first'),
        all: async () => execute(sql, args, 'all'),
        run: async () => execute(sql, args, 'run')
    });
    const DB = { prepare, batch: async statements => {
        sqlite.exec('BEGIN');
        try {
            const results = statements.map(stmt => execute(stmt.sql, stmt.args, 'run'));
            sqlite.exec('COMMIT');
            return results;
        } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    } };
    const network = jest.fn(async url => {
        if (url.includes('/service_accounts/v1/jwk/')) return new Response(JSON.stringify({ keys: [jwk] }));
        const match = url.match(/\/documents\/users\/([^/?]+)$/);
        if (match) {
            const profile = profiles.get(decodeURIComponent(match[1]));
            return new Response(JSON.stringify(profile ? { fields: firestoreFields(profile) } : {}), { status: profile ? 200 : 404 });
        }
        throw new Error('Unexpected external request: ' + url);
    });
    const context = vm.createContext({ URL, URLSearchParams, Request, Response, Headers,
        TextEncoder, TextDecoder, crypto: webcrypto, atob, btoa, fetch: network,
        console: { log() {}, warn() {}, error() {} }
    });
    // Keep the real authentication, signature verification, routing and SQL.
    vm.runInContext(source.replace('export default {', 'globalThis.worker = {'), context);
    const token = (uid, { anonymous = false, expired = false } = {}) => {
        const now = Math.floor(Date.now() / 1000);
        const data = `${encode({ alg: 'RS256', kid: jwk.kid })}.${encode({
            iss: 'https://securetoken.google.com/smagesa', aud: 'smagesa', sub: uid, user_id: uid,
            iat: now - 3600, auth_time: now - 3600, exp: expired ? now - 3600 : now + 3600,
            email: `${uid}@example.test`, firebase: { sign_in_provider: anonymous ? 'anonymous' : 'password' }
        })}`;
        return `${data}.${sign('RSA-SHA256', Buffer.from(data), keys.privateKey).toString('base64url')}`;
    };
    const send = async (route, { method = 'GET', body, bearer } = {}) => {
        const response = await context.worker.fetch(new Request(`https://worker.test${route}`, {
            method, headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {})
        }), { DB }, {});
        return { status: response.status, body: await response.json() };
    };
    const add = (id, owner = 'owner', nis = '001', points = 30, legacyName = 'Guru Pemilik') => {
        sqlite.prepare(`INSERT INTO records (id,student_nis,student_name,student_class,category,points,date,timestamp,reporter_uid,reporter_name,created_by)
            VALUES (?,?,'Siswa Dummy','X-1','Pelanggaran',?,'2026-09-06','2026-09-06T00:00:00Z',?,?,?)`)
            .run(id, nis, points, owner, legacyName, legacyName);
    };
    return { sqlite, profiles, queries, token, send, add, network, context, DB,
        snapshot: () => JSON.stringify({ records: sqlite.prepare('SELECT * FROM records ORDER BY id').all(),
            aggregates: sqlite.prepare('SELECT * FROM student_aggregates ORDER BY student_nis').all() }) };
}

const routes = [
    ['/api/records/a', 'DELETE', undefined],
    ['/api/records/batch-delete', 'POST', { ids: ['a'] }],
    ['/api/records/a', 'PUT', { points: 0, status: 'deleted' }],
    ['/api/records', 'POST', { id: 'a', student_nis: '001', points: 0 }],
    ['/api/records/move-nis', 'POST', { old_nis: '001', new_nis: '002' }],
    ['/api/migrate/records', 'POST', { records: [] }]
];

describe('Records authorization: actual Worker, signed Firebase-shaped JWTs and SQLite', () => {
    let h;
    beforeEach(() => { h = harness(); h.add('a'); });
    afterEach(() => h.sqlite.close());

    test.each(routes)('%s %s rejects missing and malformed credentials before querying D1', async (route, method, body) => {
        const before = h.snapshot();
        for (const bearer of [undefined, 'invalid-token']) {
            expect((await h.send(route, { method, body, bearer })).status).toBe(401);
        }
        expect(h.queries).toHaveLength(0);
        expect(h.snapshot()).toBe(before);
    });

    test.each(['student', 'head', 'unknown'])('%s cannot delete records', async uid => {
        const before = h.snapshot();
        expect((await h.send('/api/records/a', { method: 'DELETE', bearer: h.token(uid) })).status).toBe(403);
        expect(h.snapshot()).toBe(before);
    });

    test('anonymous, expired and invalidly signed tokens cannot delete records', async () => {
        const before = h.snapshot();
        const valid = h.token('owner');
        for (const [bearer, status] of [
            [h.token('owner', { anonymous: true }), 403],
            [h.token('owner', { expired: true }), 401],
            [valid.slice(0, valid.lastIndexOf('.') + 1) + Buffer.alloc(256).toString('base64url'), 401]
        ]) expect((await h.send('/api/records/a', { method: 'DELETE', bearer })).status).toBe(status);
        expect(h.snapshot()).toBe(before);
    });

    test('owner can delete after changing name; aggregates reflect remaining records', async () => {
        h.profiles.set('owner', { name: 'Nama Baru', role: 'guru_mapel' });
        h.add('b', 'other', '001', 20);
        const result = await h.send('/api/records/a', { method: 'DELETE', bearer: h.token('owner') });
        expect(result.status).toBe(200);
        expect(result.body.success).toBe(true);
        expect(h.sqlite.prepare('SELECT id FROM records').all().map(r => r.id)).toEqual(['b']);
        expect(h.sqlite.prepare('SELECT points, violation_count FROM student_aggregates').get()).toMatchObject({ points: 20, violation_count: 1 });
    });

    test('matching display name cannot override a different recorded UID', async () => {
        h.profiles.set('other', { name: 'Guru Pemilik', role: 'guru_mapel' });
        const before = h.snapshot();
        expect((await h.send('/api/records/a', { method: 'DELETE', bearer: h.token('other') })).status).toBe(403);
        expect(h.snapshot()).toBe(before);
    });

    test('legacy records keep the existing owner-name policy only when UID is absent', async () => {
        h.add('legacy', '', '002');
        expect((await h.send('/api/records/legacy', { method: 'DELETE', bearer: h.token('other') })).status).toBe(403);
        expect((await h.send('/api/records/legacy', { method: 'DELETE', bearer: h.token('owner') })).status).toBe(200);
    });

    test.each(['admin', 'multi'])('%s can remove another author record', async uid => {
        expect((await h.send('/api/records/a', { method: 'DELETE', bearer: h.token(uid) })).status).toBe(200);
        expect(h.sqlite.prepare('SELECT count(*) n FROM records').get().n).toBe(0);
    });

    test('mixed-ownership batch rejects all rows before deleting anything', async () => {
        h.add('b', 'other');
        const before = h.snapshot();
        expect((await h.send('/api/records/batch-delete', { method: 'POST', body: { ids: ['a', 'b'] }, bearer: h.token('owner') })).status).toBe(403);
        expect(h.snapshot()).toBe(before);
    });

    test('authorized batch handles multiple students, duplicate/missing IDs and normal response fields', async () => {
        h.add('b', 'other', '002');
        const result = await h.send('/api/records/batch-delete', { method: 'POST', body: { ids: ['a', 'b', 'a', 'missing'] }, bearer: h.token('admin') });
        expect(result.status).toBe(200);
        expect(result.body).toMatchObject({ success: true, deletedCount: 3, message: expect.any(String) });
        expect(h.sqlite.prepare('SELECT count(*) n FROM records').get().n).toBe(0);
        expect(h.sqlite.prepare('SELECT points FROM student_aggregates').all().map(r => r.points)).toEqual([0, 0]);
    });

    test.each([{}, { ids: [] }, { ids: { nis: '001' } }, { ids: [null] }])('invalid batch body is rejected safely: %j', async body => {
        const before = h.snapshot();
        expect((await h.send('/api/records/batch-delete', { method: 'POST', body, bearer: h.token('admin') })).status).toBe(400);
        expect(h.snapshot()).toBe(before);
    });

    test('POST cannot claim another author; owner can still save and edit normally', async () => {
        const payload = { id: 'new', student_nis: '003', student_name: 'Dummy', category: 'Prestasi', points: 5,
            reporter_uid: 'admin', reporter_name: 'Administrator', created_by: 'Administrator' };
        expect((await h.send('/api/records', { method: 'POST', body: payload, bearer: h.token('owner') })).status).toBe(201);
        expect(h.sqlite.prepare("SELECT reporter_uid,created_by FROM records WHERE id='new'").get())
            .toMatchObject({ reporter_uid: 'owner', created_by: 'Guru Pemilik' });
        expect((await h.send('/api/records/new', { method: 'PUT', body: { desc: 'Koreksi', reporter_uid: 'other' }, bearer: h.token('owner') })).status).toBe(200);
        expect(h.sqlite.prepare("SELECT reporter_uid,desc FROM records WHERE id='new'").get()).toMatchObject({ reporter_uid: 'owner', desc: 'Koreksi' });
    });

    test('PUT and POST-upsert cannot overwrite someone else record; mixed POST inserts nothing', async () => {
        const before = h.snapshot();
        expect((await h.send('/api/records/a', { method: 'PUT', body: { points: 0 }, bearer: h.token('other') })).status).toBe(403);
        expect((await h.send('/api/records', { method: 'POST', body: [{ id: 'new', student_nis: '002' }, { id: 'a', student_nis: '001' }], bearer: h.token('other') })).status).toBe(403);
        expect(h.snapshot()).toBe(before);
    });

    test('admin upsert preserves the original author and owner retains delete access', async () => {
        expect((await h.send('/api/records', { method: 'POST', body: { id: 'a', student_nis: '001', points: 45 }, bearer: h.token('admin') })).status).toBe(201);
        expect(h.sqlite.prepare("SELECT reporter_uid FROM records WHERE id='a'").get().reporter_uid).toBe('owner');
        expect((await h.send('/api/records/a', { method: 'DELETE', bearer: h.token('owner') })).status).toBe(200);
    });

    test('migration remains available to Super Admin only', async () => {
        const body = { old_nis: '001', new_nis: '009' };
        expect((await h.send('/api/records/move-nis', { method: 'POST', body, bearer: h.token('owner') })).status).toBe(403);
        expect((await h.send('/api/records/move-nis', { method: 'POST', body, bearer: h.token('admin') })).status).toBe(200);
        expect(h.sqlite.prepare("SELECT student_nis FROM records WHERE id='a'").get().student_nis).toBe('009');
        expect((await h.send('/api/migrate/records', { method: 'POST', body: { records: [] }, bearer: h.token('owner') })).status).toBe(403);
        expect((await h.send('/api/migrate/records', { method: 'POST', body: { records: [] }, bearer: h.token('admin') })).status).toBe(200);
    });

    test('client automatically carries existing login token without changing its delete interface', async () => {
        const tokenGetter = jest.fn(async () => h.token('owner'));
        const clientContext = vm.createContext({ URLSearchParams, console, setTimeout, clearTimeout,
            auth: { currentUser: { getIdToken: tokenGetter } }, CLOUDFLARE_CONFIG: { workerUrl: 'https://worker.test' },
            fetch: (url, options) => h.context.worker.fetch(new Request(url, options), { DB: h.DB }, {})
        });
        const clientCode = read('js/cloudflare-client.js')
            .replace(/^\s*import\s+[^;]+;?/gm, '')
            .replace('export const cfClient =', 'globalThis.cfClient =')
            .replace(/^\s*export\s+default\s+[^;]+;?/gm, '')
            .replace(/^\s*export\s+(const|let|var|function\*?|class|async\s+function\*?)\s+/gm, '$1 ')
            .replace(/^\s*export\s*\{[^}]*\};?/gm, '');
        vm.runInContext(clientCode, clientContext);
        expect((await clientContext.cfClient.deleteRecord('a')).success).toBe(true);
        expect(tokenGetter).toHaveBeenCalledTimes(1);
        h.add('batch');
        expect((await clientContext.cfClient.batchDeleteRecords(['batch'])).success).toBe(true);
    });

    test('GET feeds, stats and detail retain their response contracts for signed-in staff', async () => {
        const bearer = h.token('owner');
        expect((await h.send('/api/records?student_nis=001', { bearer })).body.data).toHaveLength(1);
        expect((await h.send('/api/records/a', { bearer })).body.data.id).toBe('a');
        expect((await h.send('/api/records/stats', { bearer })).body.data).toEqual({ violation: 1, achievement: 0, permission: 0 });
    });

    test('GET feeds, stats and detail reject anonymous visitors, student-role and role-less accounts', async () => {
        for (const route of ['/api/records?student_nis=001', '/api/records/a', '/api/records/stats']) {
            expect((await h.send(route)).status).toBe(401);
            expect((await h.send(route, { bearer: h.token('student') })).status).toBe(403);
            expect((await h.send(route, { bearer: h.token('unknown') })).status).toBe(403);
        }
    });

    test('unrelated health endpoint stays public without any network lookup', async () => {
        expect((await h.send('/api/health')).status).toBe(200);
        expect(h.network).not.toHaveBeenCalled();
    });

    test('Input page keeps owner buttons and the existing confirmation/success flow', async () => {
        const dom = new JSDOM(read('input.html'), { url: 'https://worker.test/input.html', runScripts: 'outside-only' });
        const win = dom.window;
        try {
            const records = [
                { id: 'a', reporterUID: 'owner', createdBy: 'Nama Lama', category: 'Pelanggaran', date: '2026-09-06' },
                { id: 'other', reporterUID: 'other', createdBy: 'Guru Pemilik', category: 'Pelanggaran', date: '2026-09-06' },
                { id: 'legacy', reporterUID: '', createdBy: 'Guru Pemilik', category: 'Prestasi', date: '2026-09-06' }
            ];
            win.auth = { currentUser: { uid: 'owner' } };
            win.onAuthStateChanged = () => {};
            win.showToast = jest.fn();
            win.hasRole = () => false;
            win.escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, '');
            win.cfClient = {
                getRecords: jest.fn(async () => records),
                deleteRecord: jest.fn(async id => {
                    const result = await h.send(`/api/records/${id}`, { method: 'DELETE', bearer: h.token('owner') });
                    if (result.status !== 200) throw new Error(result.body.error);
                    return result.body;
                })
            };
            win.eval(read('js/page-input.js').replace(/^import .*;\r?$/gm, '') + '\ncurrentUserName = "Guru Pemilik";');
            win.document.getElementById('filter-date-start').value = '2026-09-01';
            win.document.getElementById('filter-date-end').value = '2026-09-06';
            await win.loadHistoryByFilter();
            const rows = win.document.querySelectorAll('#history-table-body tr');
            expect(rows[0].querySelector('button[title="Hapus"]')).not.toBeNull();
            expect(rows[1].querySelector('button[title="Hapus"]')).toBeNull();
            expect(rows[2].querySelector('button[title="Hapus"]')).not.toBeNull();

            win.loadHistoryByFilter = jest.fn();
            win.loadRecentSideFeed = jest.fn();
            win.deleteActivity('a', '001', 30, 'Pelanggaran');
            expect(win.document.getElementById('modal-confirm-delete').classList.contains('hidden')).toBe(false);
            expect(win.document.getElementById('delete-confirm-text').textContent).toContain('30');
            expect(win.cfClient.deleteRecord).not.toHaveBeenCalled();
            await win.executeDeleteActivity();
            expect(win.cfClient.deleteRecord).toHaveBeenCalledWith('a');
            expect(win.document.getElementById('modal-confirm-delete').classList.contains('hidden')).toBe(true);
            expect(win.document.getElementById('btn-confirm-delete-action').disabled).toBe(false);
            expect(win.showToast).toHaveBeenCalledWith('Berhasil', expect.any(String), 'success');
            expect(win.loadHistoryByFilter).toHaveBeenCalledTimes(1);
            expect(win.loadRecentSideFeed).toHaveBeenCalledTimes(1);

            // Verifikasi editActivity: Non-owner ditolak, owner diizinkan
            win.cfClient.getRecordById = jest.fn(async id => records.find(item => item.id === id) || null);
            win.switchMainTab = jest.fn();
            win.switchInputType = jest.fn();
            win.showToast.mockClear();

            await win.editActivity('other');
            expect(win.showToast).toHaveBeenCalledWith('Akses Ditolak', expect.any(String), 'error');
            expect(win.switchMainTab).not.toHaveBeenCalled();

            await win.editActivity('a');
            expect(win.switchMainTab).toHaveBeenCalledWith('input');
        } finally { win.close(); }
    }, 15000);

    test('POST and GET support full structured achievement fields with team participation', async () => {
        const payload = {
            id: 'ach-1',
            student_nis: '001',
            student_name: 'Siswa Juara',
            student_class: 'XII-MIPA-1',
            category: 'Prestasi',
            points: 0,
            date: '2026-10-19',
            competition_name: 'Olimpiade Sains Nasional',
            organizer: 'Kemendikbudristek',
            level: 'Nasional',
            field: 'Riset & KIR',
            rank: 'Juara 1',
            participation_type: 'Beregu',
            team_name: 'Tim KIR Smagesa',
            mentor_name: 'Drs. Pembina',
            certificate_no: 'SK/OSN/2026/001',
            evidence_url: 'https://drive.google.com/file/d/test-osn/view',
            desc: 'Meraih Juara 1 Nasional KIR Bidang Ilmu Hayati'
        };
        const postRes = await h.send('/api/records', { method: 'POST', body: payload, bearer: h.token('owner') });
        expect(postRes.status).toBe(201);

        const getRes = await h.send('/api/records/ach-1', { bearer: h.token('owner') });
        expect(getRes.status).toBe(200);
        expect(getRes.body.data).toMatchObject({
            id: 'ach-1',
            studentNIS: '001',
            category: 'Prestasi',
            competitionName: 'Olimpiade Sains Nasional',
            organizer: 'Kemendikbudristek',
            level: 'Nasional',
            field: 'Riset & KIR',
            rank: 'Juara 1',
            participationType: 'Beregu',
            teamName: 'Tim KIR Smagesa',
            mentorName: 'Drs. Pembina',
            certificateNo: 'SK/OSN/2026/001',
            evidenceUrl: 'https://drive.google.com/file/d/test-osn/view'
        });
    });
});


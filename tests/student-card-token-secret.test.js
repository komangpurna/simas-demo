/**
 * tests/student-card-token-secret.test.js
 *
 * Kunci token QR kartu (kts_) dulu tertanam di js/utils.mjs sehingga siapa pun dapat membuat token untuk
 * NIS mana saja lalu membaca kartu publik (NISN & tanggal lahir = kredensial login siswa).
 * Kini kunci hanya ada di Worker secret CARD_TOKEN_SECRET; browser staf menerjemahkan QR lewat
 * /api/students/resolve-card. Test ini menjalankan worker.js sungguhan di atas SQLite.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const { loadWorkerLibModule } = require('./helpers/worker-source.cjs');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const SECRET = 'synthetic-card-token-secret-for-tests';
const LEGACY_LEAKED_TOKEN_FOR_12345 = 'kts_dfca9ce4b8bdc2f4e2999e42b5a3551c';
const { encryptSecureCardToken } = loadWorkerLibModule('lib/secure-card-token.js');

function harness() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(read('cloudflare/schema.sql'));
    const prepare = (sql, args = []) => ({
        bind: (...values) => prepare(sql, values),
        async run() { return { meta: sqlite.prepare(sql).run(...args) }; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        async first() { return sqlite.prepare(sql).get(...args) || null; }
    });
    const DB = { prepare, async batch(stmts) { return Promise.all(stmts.map(s => s.run())); } };
    const context = vm.createContext({ URL, URLSearchParams, Request, Response, Headers, crypto, atob, btoa, TextEncoder, TextDecoder,
        console: { log() {}, warn() {}, error() {} },
        fetch: async () => new Response('[]', { status: 200 }) });
    vm.runInContext(read('cloudflare/worker.js').replace('export default {', 'globalThis.worker = {'), context);
    const state = { sqlite, auth: { valid: false, error: 'no firebase' } };
    context.getAuth = () => state.auth;
    vm.runInContext('verifyFirebaseToken = async () => getAuth();', context);
    state.call = async (route, env = {}) => {
        const res = await context.worker.fetch(new Request('https://worker.test' + route, { headers: { Authorization: 'Bearer synthetic' } }), { DB, ...env }, { waitUntil() {} });
        const json = await res.json().catch(() => ({}));
        return { ...json, status: res.status };
    };
    sqlite.prepare('INSERT INTO students(nis,name,class,status,birth_date,nisn) VALUES (?,?,?,?,?,?)')
        .run('12345', 'Synthetic', 'XII.1', 'active', '2008-01-01', '0012345678');
    sqlite.prepare("INSERT INTO student_photos(nis, public_token, status) VALUES (?, ?, 'none')")
        .run('12345', 'a1b2c3d4e5f60718293a4b5c6d7e8f90abcdef');
    return state;
}

const STAFF = { valid: true, user: { uid: 'tu', role: 'admin_spp', additionalRoles: [], isAnonymous: false } };
const STUDENT = { valid: true, user: { uid: 'anon', role: '', additionalRoles: [], isAnonymous: true, claims: {} } };

describe('Token QR kartu memakai CARD_TOKEN_SECRET (kunci tidak lagi di browser)', () => {
    let h;
    beforeEach(() => { h = harness(); });
    afterEach(() => h.sqlite.close());

    test('kartu publik menolak token buatan kunci lama yang bocor', async () => {
        const res = await h.call(`/api/students/public-card/${LEGACY_LEAKED_TOKEN_FOR_12345}`, { CARD_TOKEN_SECRET: SECRET });
        expect(res.status).toBe(404);
    });

    test('kartu publik menerima kts_ dari secret server dan public_token acak', async () => {
        const token = encryptSecureCardToken('12345', SECRET);
        expect((await h.call(`/api/students/public-card/${token}`, { CARD_TOKEN_SECRET: SECRET })).status).toBe(200);
        expect((await h.call('/api/students/public-card/a1b2c3d4e5f60718293a4b5c6d7e8f90abcdef')).status).toBe(200);
    });

    test('tanpa CARD_TOKEN_SECRET, token kts_ apa pun ditolak (fail closed)', async () => {
        const token = encryptSecureCardToken('12345', SECRET);
        expect((await h.call(`/api/students/public-card/${token}`)).status).toBe(404);
    });

    test('resolve-card: staf mendapat NIS dari kts_ maupun public_token', async () => {
        h.auth = STAFF;
        const env = { CARD_TOKEN_SECRET: SECRET };
        const byKts = await h.call(`/api/students/resolve-card/${encryptSecureCardToken('12345', SECRET)}`, env);
        expect(byKts).toMatchObject({ status: 200, data: { nis: '12345', name: 'Synthetic', class: 'XII.1' } });
        const byPublic = await h.call('/api/students/resolve-card/a1b2c3d4e5f60718293a4b5c6d7e8f90abcdef', env);
        expect(byPublic).toMatchObject({ status: 200, data: { nis: '12345' } });
        expect((await h.call(`/api/students/resolve-card/${LEGACY_LEAKED_TOKEN_FOR_12345}`, env)).status).toBe(404);
    });

    test('resolve-card: tanpa login 401, sesi anonim/siswa 403', async () => {
        const path = `/api/students/resolve-card/${encryptSecureCardToken('12345', SECRET)}`;
        expect((await h.call(path, { CARD_TOKEN_SECRET: SECRET })).status).toBe(401);
        h.auth = STUDENT;
        expect((await h.call(path, { CARD_TOKEN_SECRET: SECRET })).status).toBe(403);
    });
});

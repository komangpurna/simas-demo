/**
 * tests/student-session-secret.test.js
 *
 * Token sesi siswa (X-Student-Token) ditandatangani HMAC dengan Worker secret SESSION_SECRET.
 * Dulu ada nilai cadangan yang di-hardcode di worker.js sehingga siapa pun yang membaca kode dapat
 * memalsukan token untuk NIS mana saja. Test ini memastikan tidak ada lagi kunci cadangan (fail closed).
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const LEAKED_SECRET = 'simas-smagesa-edge-student-session-secret-2026-v1';

function forgeToken(secret, payload = {}) {
    const body = Buffer.from(JSON.stringify({
        nis: '12345', name: 'Synthetic', class: 'XII.1',
        exp: Math.floor(Date.now() / 1000) + 600, ...payload
    })).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    return `${body}.${sig}`;
}

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
    const context = vm.createContext({ URL, URLSearchParams, Request, Response, Headers, crypto: globalThis.crypto, atob, btoa, TextEncoder, TextDecoder,
        console: { log() {}, warn() {}, error() {} },
        fetch: async () => new Response('[]', { status: 200 }) });
    vm.runInContext(read('cloudflare/worker.js').replace('export default {', 'globalThis.worker = {'), context);
    const state = { sqlite, auth: { valid: false, error: 'no firebase' } };
    context.getAuth = () => state.auth;
    // Hanya verifikasi Firebase yang dipalsukan; verifikasi token sesi siswa memakai kode asli.
    vm.runInContext('verifyFirebaseToken = async () => getAuth(); setFirebaseCustomClaims = async () => {};', context);
    state.call = async (route, { env = {}, headers = {}, body = null } = {}) => {
        const request = new Request('https://worker.test' + route, body
            ? { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }
            : { method: 'GET', headers });
        const res = await context.worker.fetch(request, { DB, ...env }, { waitUntil() {} });
        const text = await res.text();
        let json = {};
        try { json = JSON.parse(text); } catch (_) {}
        return { ...json, status: res.status };
    };
    sqlite.prepare('INSERT INTO students(nis,name,class,status,birth_date) VALUES (?,?,?,?,?)')
        .run('12345', 'Synthetic', 'XII.1', 'active', '2008-01-01');
    return state;
}

describe('Token sesi siswa wajib memakai SESSION_SECRET (tanpa kunci hardcode)', () => {
    let h;
    beforeEach(() => { h = harness(); });
    afterEach(() => h.sqlite.close());

    test('kunci lama yang pernah di-hardcode tidak ada lagi di kode Worker', () => {
        expect(read('cloudflare/worker.js')).not.toContain(LEAKED_SECRET);
    });

    test('tanpa SESSION_SECRET, token apa pun ditolak', async () => {
        const res = await h.call('/api/students/12345', { headers: { 'X-Student-Token': forgeToken(LEAKED_SECRET) } });
        expect(res.status).toBe(401);
    });

    test('dengan SESSION_SECRET, token yang ditandatangani kunci lama ditolak', async () => {
        const env = { SESSION_SECRET: 'synthetic-session-secret' };
        const res = await h.call('/api/students/12345', { env, headers: { 'X-Student-Token': forgeToken(LEAKED_SECRET) } });
        expect(res.status).toBe(401);
    });

    test('dengan SESSION_SECRET, token sah hanya membuka data NIS miliknya', async () => {
        const env = { SESSION_SECRET: 'synthetic-session-secret' };
        const token = forgeToken(env.SESSION_SECRET);
        const own = await h.call('/api/students/12345', { env, headers: { 'X-Student-Token': token } });
        expect(own.status).toBe(200);
        const other = await h.call('/api/students/99999', { env, headers: { 'X-Student-Token': token } });
        expect(other.status).toBe(401);
    });

    test('verify-credentials menolak menerbitkan token bila SESSION_SECRET belum dipasang', async () => {
        h.auth = { valid: true, user: { uid: 'anon', isAnonymous: true, claims: {} } };
        const body = { nis: '12345', birthDate: '2008-01-01' };
        const missing = await h.call('/api/students/verify-credentials', { body });
        expect(missing.status).toBe(503);

        const env = { SESSION_SECRET: 'synthetic-session-secret' };
        const ok = await h.call('/api/students/verify-credentials', { env, body });
        expect(ok.status).toBe(200);
        const reuse = await h.call('/api/students/12345', { env, headers: { 'X-Student-Token': ok.token } });
        expect(reuse.status).toBe(200);
    });
});

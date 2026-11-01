const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const { webcrypto } = require('node:crypto');

// Jalankan fungsi Worker sebenarnya dan SQL sebenarnya; tidak menyalin logikanya.
const source = fs.readFileSync(path.join(__dirname, '../cloudflare/worker.js'), 'utf8');
function harness({ oldSchema = false } = {}) {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec("CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT)");
    if (oldSchema) sqlite.exec(fs.readFileSync(path.join(__dirname, '../cloudflare/migrations/202608290002_notifications.sql'), 'utf8'));
    let queryCount = 0;
    const queries = [];
    const execute = (sql, args, mode) => {
        queryCount++;
        queries.push({ sql, args });
        const statement = sqlite.prepare(sql);
        if (mode === 'all') return { results: statement.all(...args) };
        if (mode === 'first') return statement.get(...args) || null;
        const result = statement.run(...args);
        return { meta: { changes: Number(result.changes) } };
    };
    const prepare = (sql, args = []) => ({
        sql, args,
        bind: (...values) => prepare(sql, values),
        all: async () => execute(sql, args, 'all'),
        first: async () => execute(sql, args, 'first'),
        run: async () => execute(sql, args, 'run')
    });
    const DB = { prepare, batch: async statements => {
        sqlite.exec('BEGIN');
        try {
            const results = statements.map(statement => execute(statement.sql, statement.args, 'run'));
            sqlite.exec('COMMIT');
            return results;
        } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    } };
    const fetchMock = jest.fn(async () => new Response(JSON.stringify({ name: 'fcm/accepted' })));
    const context = vm.createContext({ console, URL, URLSearchParams, Request, Response, Headers,
        TextEncoder, TextDecoder, AbortSignal, crypto: webcrypto, fetch: fetchMock, atob, btoa, setTimeout, clearTimeout });
    vm.runInContext(source.replace('export default {', 'const workerHandler = {') + `
        globalThis.testApi = { createNotificationJob, processPendingNotifications, ensureNotificationTables,
            classifyFcmError, normalizePushUrl, sha256Id, workerHandler,
            setUser: user => { verifyFirebaseToken = async () => ({ valid: true, user }); } };
        googleAccessTokenCache.set('https://www.googleapis.com/auth/firebase.messaging', { token: 'test-oauth', expiresAt: Infinity });
    `, context);
    const env = { DB };
    const api = context.testApi;
    return { sqlite, env, api, fetchMock, queries, queryCount: () => queryCount,
        addToken: (id, uid = 'A', role = 'guru_mapel', additional = '[]', className = 'X.1') =>
            sqlite.prepare('INSERT INTO fcm_tokens (id, user_id, token, role, additional_roles, assigned_class) VALUES (?, ?, ?, ?, ?, ?)')
                .run(id, uid, `token-${id}`.padEnd(90, 'x'), role, additional, className),
        job: (targetType = 'all', targetValue = '') => api.createNotificationJob(env, 'admin', { title: 'Pengingat', body: 'Isi pesan', url: './agenda.html', targetType, targetValue }) };
}

describe('Push outbox: delivery safety against real SQLite', () => {
    let h;
    beforeEach(async () => { h = harness(); await h.api.ensureNotificationTables(h.env); });
    afterEach(() => h.sqlite.close());

    test('auto-upgrade database lama idempotent dan tidak menghapus token/antrean', async () => {
        const old = harness({ oldSchema: true });
        try {
            old.addToken('old');
            await old.api.ensureNotificationTables(old.env);
            await old.api.ensureNotificationTables(old.env);
            expect(old.sqlite.prepare('SELECT COUNT(*) AS n FROM fcm_tokens').get().n).toBe(1);
            expect(old.sqlite.prepare('PRAGMA table_info(notification_deliveries)').all().map(row => row.name)).toEqual(expect.arrayContaining(['recipient_uid', 'claim_id', 'lease_until', 'next_attempt_at']));
        } finally { old.sqlite.close(); }
    });

    test('broadcast 650 token utuh; role di luar 500 pertama dan additional role ikut terpilih', async () => {
        for (let i = 0; i < 650; i++) h.addToken(String(i), `user${i}`, i === 649 ? 'wali_kelas' : 'guru_mapel', i === 648 ? '["wali_kelas"]' : '[]');
        h.sqlite.prepare('UPDATE fcm_tokens SET additional_roles = ? WHERE id = ?').run('invalid json', '0');
        expect((await h.job()).targetCount).toBe(650);
        expect((await h.job('role', 'wali_kelas')).targetCount).toBe(2);
        expect((await h.job('class', 'X.1')).targetCount).toBe(650);
    });

    test('job dan seluruh delivery atomik bila INSERT gagal', async () => {
        h.addToken('1');
        h.sqlite.exec("CREATE TRIGGER abort_delivery BEFORE INSERT ON notification_deliveries BEGIN SELECT RAISE(ABORT, 'test rollback'); END");
        await expect(h.job()).rejects.toThrow('test rollback');
        expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM notification_jobs').get().n).toBe(0);
    });

    test.each([
        ['payload INVALID_ARGUMENT', 400, 'INVALID_ARGUMENT', 'google.rpc.BadRequest', 'INVALID_ARGUMENT', false, 'failed'],
        ['token ambigu INVALID_ARGUMENT', 400, 'INVALID_ARGUMENT', 'google.firebase.fcm.v1.FcmError', 'INVALID_ARGUMENT', false, 'failed'],
        ['generic NOT_FOUND', 404, 'NOT_FOUND', '', '', false, 'failed'],
        ['sender mismatch', 403, 'PERMISSION_DENIED', 'google.firebase.fcm.v1.FcmError', 'SENDER_ID_MISMATCH', false, 'failed'],
        ['token explicitly UNREGISTERED', 404, 'NOT_FOUND', 'google.firebase.fcm.v1.FcmError', 'UNREGISTERED', true, 'failed'],
        ['temporary unavailable', 503, 'UNAVAILABLE', '', '', false, 'pending'],
        ['quota exceeded', 429, 'RESOURCE_EXHAUSTED', '', '', false, 'pending'],
        ['auth error', 401, 'UNAUTHENTICATED', '', '', false, 'pending']
    ])('%s: tidak salah mendeteksi perangkat mati', async (_, status, code, type, detailCode, removed, expectedStatus) => {
        h.addToken('1');
        await h.job();
        h.fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: { status: code,
            message: 'test', details: type ? [{ '@type': `type.googleapis.com/${type}`, errorCode: detailCode }] : [] } }),
            { status, headers: { 'Retry-After': '600' } }));
        const before = Date.now();
        await h.api.processPendingNotifications(h.env);
        expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM fcm_tokens').get().n).toBe(removed ? 0 : 1);
        expect(h.queries.filter(query => /^\s*DELETE FROM fcm_tokens\b/.test(query.sql))).toHaveLength(removed ? 1 : 0);
        const delivery = h.sqlite.prepare('SELECT * FROM notification_deliveries').get();
        expect(delivery.status).toBe(expectedStatus);
        expect(delivery.attempts).toBe(1);
        if (expectedStatus === 'pending') {
            expect(delivery.next_attempt_at).toBeGreaterThanOrEqual(before + 600000);
            await h.api.processPendingNotifications(h.env);
            expect(h.fetchMock).toHaveBeenCalledTimes(1);
        }
    });

    test('dua dispatcher serentak tidak mengirim satu delivery dua kali', async () => {
        for (let i = 0; i < 60; i++) h.addToken(String(i));
        await h.job();
        await Promise.all([h.api.processPendingNotifications(h.env), h.api.processPendingNotifications(h.env)]);
        const tokens = h.fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).message.token);
        expect(tokens).toHaveLength(60);
        expect(new Set(tokens).size).toBe(60);
        expect(h.sqlite.prepare("SELECT COUNT(*) AS n FROM notification_deliveries WHERE status='sent'").get().n).toBe(60);
    });

    test('payload data-only, URL aman, UID penerima dan job ID tetap disertakan', async () => {
        h.addToken('1');
        const job = await h.job();
        const before = h.queryCount();
        await h.api.processPendingNotifications(h.env);
        expect(h.queryCount() - before).toBeLessThan(15);
        expect(h.queries.some(query => /^\s*DELETE FROM fcm_tokens\b/.test(query.sql))).toBe(false);
        const message = JSON.parse(h.fetchMock.mock.calls[0][1].body).message;
        expect(message.notification).toBeUndefined();
        expect(message.data).toMatchObject({ recipientUid: 'A', jobId: job.jobId, url: 'https://smagesa.web.app/agenda.html' });
        expect(h.api.normalizePushUrl('//evil.example/path')).toBe('https://smagesa.web.app/dashboard.html');
        expect(h.api.normalizePushUrl('javascript:alert(1)')).toBe('https://smagesa.web.app/dashboard.html');
    });

    test('persetujuan booking lab membuat lonceng dan mengirim push ke seluruh perangkat pemohon', async () => {
        h.sqlite.exec(`CREATE TABLE labs (id TEXT PRIMARY KEY, koordinator_uid TEXT, koordinator_nama TEXT);
            CREATE TABLE lab_bookings (id TEXT PRIMARY KEY, lab_id TEXT, lab_nama TEXT, tanggal TEXT,
                jam_mulai INTEGER, jam_selesai INTEGER, pemohon_uid TEXT, pemohon_nama TEXT, status TEXT,
                alasan_penolakan TEXT, diproses_oleh TEXT, diproses_pada TEXT, updated_at TEXT);
            INSERT INTO labs VALUES ('lab1', 'coordinator', 'Koordinator');
            INSERT INTO lab_bookings (id, lab_id, lab_nama, tanggal, jam_mulai, jam_selesai, pemohon_uid, status)
                VALUES ('booking1', 'lab1', 'Laboratorium TIK', '2026-10-14', 1, 3, 'A', 'pending');`);
        h.addToken('phone'); h.addToken('desktop'); h.addToken('other', 'B');
        h.api.setUser({ uid: 'coordinator', role: 'guru_mapel' });
        const pending = [];
        const response = await h.api.workerHandler.fetch(new Request('https://worker.test/api/lab-bookings/booking1', {
            method: 'PUT', body: JSON.stringify({ status: 'approved' }), headers: { 'Content-Type': 'application/json' }
        }), h.env, { waitUntil: promise => pending.push(promise) });
        expect(response.status).toBe(200);
        await Promise.all(pending);
        expect(h.sqlite.prepare('SELECT status FROM lab_bookings').get().status).toBe('approved');
        expect(h.sqlite.prepare("SELECT recipient_uid FROM notification_deliveries WHERE status='inapp'").get().recipient_uid).toBe('A');
        expect(h.fetchMock).toHaveBeenCalledTimes(2);
        for (const [, init] of h.fetchMock.mock.calls) {
            const message = JSON.parse(init.body).message;
            expect(message.data).toMatchObject({ title: '🧪 Status Booking Lab', recipientUid: 'A', url: 'https://smagesa.web.app/e-lab.html' });
            expect(message.data.body).toContain('disetujui');
        }
    });

    test('pending pemilik A dibatalkan saat akun B register, token dan perangkat A lain tetap ada', async () => {
        const token = 'valid-device-token'.padEnd(100, 'x');
        const tokenId = await h.api.sha256Id(token);
        h.addToken(tokenId);
        h.sqlite.prepare('UPDATE fcm_tokens SET token = ? WHERE id = ?').run(token, tokenId);
        h.addToken('another-device');
        await h.job('user', 'A');
        h.api.setUser({ uid: 'B', role: 'guru_mapel' });
        const response = await h.api.workerHandler.fetch(new Request('https://worker.test/api/push/register', {
            method: 'POST', body: JSON.stringify({ token }), headers: { 'Content-Type': 'application/json' }
        }), h.env, { waitUntil: () => {} });
        expect(response.status).toBe(200);
        expect(h.sqlite.prepare('SELECT user_id FROM fcm_tokens WHERE id = ?').get(tokenId).user_id).toBe('B');
        expect(h.sqlite.prepare('SELECT status FROM notification_deliveries WHERE token_id = ?').get(tokenId).status).toBe('cancelled');
        expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM fcm_tokens').get().n).toBe(2);
        await h.api.processPendingNotifications(h.env);
        expect(h.fetchMock).toHaveBeenCalledTimes(1);
        expect(JSON.parse(h.fetchMock.mock.calls[0][1].body).message.token).not.toBe(token);
        await h.job('user', 'B');
        await h.api.processPendingNotifications(h.env);
        expect(JSON.parse(h.fetchMock.mock.calls[1][1].body).message.data.recipientUid).toBe('B');
    }, 15000);

    test('snapshot UID mencegah kirim apabila binding berubah lewat jalur lain', async () => {
        h.addToken('1'); await h.job('user', 'A');
        h.sqlite.exec("UPDATE fcm_tokens SET user_id = 'B'");
        await h.api.processPendingNotifications(h.env);
        expect(h.fetchMock).not.toHaveBeenCalled();
        expect(h.sqlite.prepare('SELECT status FROM notification_deliveries').get().status).toBe('cancelled');
    });

    test('lease aktif tidak dicuri, lease kedaluwarsa dipulihkan', async () => {
        h.addToken('1'); await h.job();
        h.sqlite.prepare("UPDATE notification_deliveries SET status = 'processing', claim_id = 'old', lease_until = ?, attempts = 1").run(Date.now() + 60000);
        await h.api.processPendingNotifications(h.env);
        expect(h.fetchMock).not.toHaveBeenCalled();
        h.sqlite.exec('UPDATE notification_deliveries SET lease_until = 1');
        await h.api.processPendingNotifications(h.env);
        expect(h.fetchMock).toHaveBeenCalledTimes(1);
        expect(h.sqlite.prepare('SELECT attempts FROM notification_deliveries').get().attempts).toBe(2);
    });

    test('retry kelima berhenti tanpa mencabut token dan menuntaskan ringkasan job', async () => {
        h.addToken('1'); await h.job();
        h.sqlite.exec('UPDATE notification_deliveries SET attempts = 4');
        h.fetchMock.mockRejectedValue(new Error('network interrupted'));
        await h.api.processPendingNotifications(h.env);
        expect(h.sqlite.prepare('SELECT status, attempts FROM notification_deliveries').get()).toMatchObject({ status: 'failed', attempts: 5 });
        expect(h.sqlite.prepare('SELECT status, failure_count FROM notification_jobs').get()).toMatchObject({ status: 'completed', failure_count: 1 });
        expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM fcm_tokens').get().n).toBe(1);
    });

    test('lease habis pada percobaan terakhir tetap menyelesaikan status job tanpa kirim ulang', async () => {
        h.addToken('1'); await h.job();
        h.sqlite.exec("UPDATE notification_deliveries SET attempts = 5, status = 'processing', lease_until = 1");
        await h.api.processPendingNotifications(h.env);
        expect(h.fetchMock).not.toHaveBeenCalled();
        expect(h.sqlite.prepare('SELECT status FROM notification_jobs').get().status).toBe('completed');
    });

    test('sukses login ulang akun yang sama tidak membatalkan antreannya', async () => {
        const token = 'same-owner-token'.padEnd(100, 'x');
        const id = await h.api.sha256Id(token);
        h.addToken(id);
        h.sqlite.prepare('UPDATE fcm_tokens SET token = ? WHERE id = ?').run(token, id);
        await h.job();
        h.api.setUser({ uid: 'A', role: 'guru_mapel' });
        await h.api.workerHandler.fetch(new Request('https://worker.test/api/push/register', { method: 'POST', body: JSON.stringify({ token }) }), h.env, {});
        expect(h.sqlite.prepare('SELECT status FROM notification_deliveries').get().status).toBe('pending');
        await h.api.processPendingNotifications(h.env);
        expect(h.fetchMock).toHaveBeenCalledTimes(1);
    });

    test('UNREGISTERED terlambat tidak menghapus token yang sudah berpindah ke B', async () => {
        h.addToken('1'); await h.job();
        h.fetchMock.mockImplementation(async () => {
            h.sqlite.exec("UPDATE fcm_tokens SET user_id = 'B'");
            return new Response(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{
                '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED'
            }] } }), { status: 404 });
        });
        await h.api.processPendingNotifications(h.env);
        expect(h.sqlite.prepare('SELECT user_id FROM fcm_tokens').get().user_id).toBe('B');
    });

    test('cleanup batch memakai primary key dan mempertahankan token valid maupun registrasi baru', async () => {
        for (const id of ['expired-1', 'expired-2', 'valid', 'refreshed']) h.addToken(id);
        // Token milik akun lain tidak menjadi kandidat cleanup batch ini.
        for (let i = 0; i < 200; i++) h.addToken(`other-${i}`, 'B');
        await h.job('user', 'A');
        const tokenIds = new Map(h.sqlite.prepare("SELECT token, id FROM fcm_tokens WHERE user_id = 'A'")
            .all().map(row => [row.token, row.id]));
        h.fetchMock.mockImplementation(async (_, init) => {
            const id = tokenIds.get(JSON.parse(init.body).message.token);
            if (id === 'valid') return new Response(JSON.stringify({ name: 'fcm/accepted' }));
            if (id === 'refreshed') {
                h.sqlite.exec("UPDATE fcm_tokens SET updated_at = datetime(updated_at, '+1 second') WHERE id = 'refreshed'");
            }
            return new Response(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{
                '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED'
            }] } }), { status: 404 });
        });

        await h.api.processPendingNotifications(h.env);
        expect(h.sqlite.prepare("SELECT id FROM fcm_tokens WHERE user_id = 'A' ORDER BY id").all()
            .map(row => row.id)).toEqual(['refreshed', 'valid']);
        expect(h.sqlite.prepare("SELECT COUNT(*) AS n FROM fcm_tokens WHERE user_id = 'B'").get().n).toBe(200);
        const cleanups = h.queries.filter(query => /^\s*DELETE FROM fcm_tokens\b/.test(query.sql));
        expect(cleanups).toHaveLength(1);
        const cleanup = cleanups[0];
        const plan = h.sqlite.prepare(`EXPLAIN QUERY PLAN ${cleanup.sql}`).all(...cleanup.args)
            .map(row => row.detail).join('\n');
        expect(plan).toMatch(/SEARCH fcm_tokens USING INDEX .+ \(id=\?\)/);
        expect(plan).not.toContain('SCAN fcm_tokens');
    });

    test('tombol nonaktif menghentikan enqueue dan pengiriman token yang sudah terdaftar', async () => {
        h.addToken('1'); await h.job();
        h.sqlite.exec(`INSERT INTO system_settings VALUES ('push_config', '{"enabled":false}')`);
        expect((await h.job()).reason).toBe('disabled');
        expect((await h.api.processPendingNotifications(h.env)).disabled).toBe(true);
        expect(h.fetchMock).not.toHaveBeenCalled();
        expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM fcm_tokens').get().n).toBe(1);
    });
});

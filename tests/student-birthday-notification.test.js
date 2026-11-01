const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const { webcrypto } = require('node:crypto');

// Menjalankan cron ulang tahun siswa dengan SQL sebenarnya (node:sqlite) dan Firestore tiruan.
const source = fs.readFileSync(path.join(__dirname, '../cloudflare/worker.js'), 'utf8');

function harness({ homerooms = {} } = {}) {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
        CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT, updated_at DATETIME);
        CREATE TABLE students (nis TEXT PRIMARY KEY, name TEXT, class TEXT, birth_date TEXT, status TEXT);
        CREATE TABLE guru_wali_assignments (id TEXT PRIMARY KEY, guru_uid TEXT, student_nis TEXT, academic_year TEXT);
    `);
    const queries = [];
    const execute = (sql, args, mode) => {
        const statement = sqlite.prepare(sql);
        if (mode === 'all') return { results: statement.all(...args) };
        if (mode === 'first') return statement.get(...args) || null;
        const result = statement.run(...args);
        return { meta: { changes: Number(result.changes) } };
    };
    const prepare = (sql, args = []) => ({
        sql, args,
        bind: (...values) => prepare(sql, values),
        all: async () => { queries.push(sql); return execute(sql, args, 'all'); },
        first: async () => execute(sql, args, 'first'),
        run: async () => execute(sql, args, 'run')
    });
    const DB = {
        prepare,
        batch: async statements => statements.map(statement => /^\s*(SELECT|WITH)/i.test(statement.sql)
            ? execute(statement.sql, statement.args, 'all')
            : execute(statement.sql, statement.args, 'run'))
    };
    const firestoreQueries = [];
    const fetchMock = jest.fn(async (url, init = {}) => {
        if (String(url).includes(':runQuery')) {
            const query = JSON.parse(init.body).structuredQuery;
            firestoreQueries.push(query);
            const values = query.where?.fieldFilter?.value?.arrayValue?.values?.map(v => v.stringValue) || [];
            const uid = values.map(v => homerooms[v]).find(Boolean);
            return new Response(JSON.stringify(uid ? [{ document: {
                name: `projects/p/databases/(default)/documents/users/${uid}`,
                fields: { role: { stringValue: 'wali_kelas' }, assignedClass: { stringValue: values[0] } }
            } }] : []));
        }
        return new Response('{}', { status: 404 });
    });
    const context = vm.createContext({ console: { ...console, log: () => {}, warn: () => {} }, URL, URLSearchParams, Request, Response, Headers,
        TextEncoder, TextDecoder, AbortSignal, crypto: webcrypto, fetch: fetchMock, atob, btoa, setTimeout, clearTimeout });
    vm.runInContext(source.replace('export default {', 'const workerHandler = {') + `
        googleAccessTokenCache.set('https://www.googleapis.com/auth/cloud-platform', { token: 'test', expiresAt: Infinity });
        globalThis.testApi = { processStudentBirthdayNotificationCron, birthdayMonthDayKeys, parseStudentBirthDate };
    `, context);
    const env = { DB };
    const api = context.testApi;
    const inbox = () => sqlite.prepare(`
        SELECT d.recipient_uid AS uid, j.title, j.body, j.url FROM notification_deliveries d
        JOIN notification_jobs j ON j.id = d.job_id WHERE d.status = 'inapp' ORDER BY d.recipient_uid
    `).all();
    return { sqlite, env, api, inbox, firestoreQueries, queries };
}

describe('birthdayMonthDayKeys & parseStudentBirthDate', () => {
    const h = harness();
    afterAll(() => h.sqlite.close());

    test('29 Februari diberi ucapan 28 Februari pada tahun bukan kabisat saja', () => {
        expect(Array.from(h.api.birthdayMonthDayKeys('2027-02-28'))).toEqual(['02-28', '02-29']);
        expect(Array.from(h.api.birthdayMonthDayKeys('2028-02-28'))).toEqual(['02-28']);
        expect(Array.from(h.api.birthdayMonthDayKeys('2028-02-29'))).toEqual(['02-29']);
        expect(Array.from(h.api.birthdayMonthDayKeys('2027-03-01'))).toEqual(['03-01']);
    });

    test('format ISO, DD-MM-YYYY, dan DD/MM/YYYY dikenali', () => {
        expect({ ...h.api.parseStudentBirthDate('2009-10-13') }).toEqual({ year: 2009, monthDay: '10-13' });
        expect({ ...h.api.parseStudentBirthDate('13-10-2009') }).toEqual({ year: 2009, monthDay: '10-13' });
        expect({ ...h.api.parseStudentBirthDate('3/1/2010') }).toEqual({ year: 2010, monthDay: '01-03' });
        expect(h.api.parseStudentBirthDate('')).toBeNull();
    });
});

describe('processStudentBirthdayNotificationCron', () => {
    test('wali kelas & guru wali menerima satu ringkasan; siswa nonaktif dan tahun ajaran lama diabaikan', async () => {
        const h = harness({ homerooms: { 'XI.3': 'wali-xi3' } });
        try {
            h.sqlite.exec(`
                INSERT INTO students VALUES
                    ('1', 'Ayu', 'XI.3', '2009-10-13', 'aktif'),
                    ('2', 'Budi', 'XI.3', '13/10/2010', 'aktif'),
                    ('3', 'Citra', 'XI.3', '2009-10-14', 'aktif'),
                    ('4', 'Dewa', 'XII.1', '2008-10-13', 'alumni'),
                    ('5', 'Eka', 'X.2', '2010-10-13', 'aktif');
                INSERT INTO guru_wali_assignments VALUES
                    ('gw-baru_1', 'gw-baru', '1', '2026/2027'),
                    ('gw-lama_1', 'gw-lama', '1', '2025/2026'),
                    ('wali-xi3_2', 'wali-xi3', '2', '2026/2027'),
                    ('gw-baru_5', 'gw-baru', '5', '2026/2027');
            `);
            const result = await h.api.processStudentBirthdayNotificationCron(h.env, '2026-10-13');
            expect(result).toMatchObject({ processed: true, birthdayCount: 3, recipientCount: 2, jobsCreated: 2 });

            const rows = h.inbox();
            expect(rows.map(r => r.uid)).toEqual(['gw-baru', 'wali-xi3']);
            const wali = rows.find(r => r.uid === 'wali-xi3');
            expect(wali.body).toContain('2 siswa');
            expect(wali.body).toContain('Ayu (XI.3, 17 th)');
            expect(wali.body).toContain('Budi (XI.3, 16 th)');
            expect(wali.url).toContain('wali-kelas.html');
            const guruWali = rows.find(r => r.uid === 'gw-baru');
            expect(guruWali.body).toContain('Ayu');
            expect(guruWali.body).toContain('Eka (X.2, 16 th)');
            expect(guruWali.url).toContain('guru-wali.html');

            // Lookup wali kelas hanya untuk rombel yang ada siswa berulang tahun (X.2 tanpa wali → 1 query fallback role)
            const queriedClasses = h.firestoreQueries
                .map(q => q.where.fieldFilter.value.arrayValue?.values?.[0]?.stringValue).filter(Boolean);
            expect(queriedClasses.sort()).toEqual(['X.2', 'XI.3']);
            expect(h.firestoreQueries.length).toBe(3);
        } finally { h.sqlite.close(); }
    });

    test('tidak ada siswa berulang tahun → tanpa Firestore read dan tanpa notifikasi', async () => {
        const h = harness();
        try {
            h.sqlite.exec(`INSERT INTO students VALUES ('1', 'Ayu', 'XI.3', '2009-05-01', 'aktif');`);
            const result = await h.api.processStudentBirthdayNotificationCron(h.env, '2026-10-13');
            expect(result).toMatchObject({ processed: true, birthdayCount: 0 });
            expect(h.firestoreQueries.length).toBe(0);
        } finally { h.sqlite.close(); }
    });

    test('lebih dari 5 siswa: seluruh nama lengkap tetap ditampilkan', async () => {
        const h = harness();
        try {
            const names = ['Ni Luh Putu Ayu Lestari', 'I Made Budi Santika', 'Kadek Citra Dewi', 'Komang Dharma Putra',
                'Ketut Eka Wijaya', 'Gede Fajar Pratama', 'Putu Gita Maharani'];
            names.forEach((name, i) => {
                h.sqlite.prepare("INSERT INTO students VALUES (?, ?, 'XII.2', '2008-10-13', 'aktif')").run(String(i), name);
                h.sqlite.prepare("INSERT INTO guru_wali_assignments VALUES (?, 'gw', ?, '2026/2027')").run(`gw_${i}`, String(i));
            });
            await h.api.processStudentBirthdayNotificationCron(h.env, '2026-10-13');
            const body = h.inbox()[0].body;
            expect(body).toContain('7 siswa');
            names.forEach(name => expect(body).toContain(`${name} (XII.2, 18 th)`));
            expect(body).not.toContain('lainnya');
        } finally { h.sqlite.close(); }
    });

    test('guru wali dari penugasan tahun ajaran sebelumnya tetap menerima (bimbingan 3 tahun)', async () => {
        const h = harness();
        try {
            h.sqlite.exec(`
                INSERT INTO students VALUES ('1', 'Ayu', 'XII.3', '2008-10-13', 'aktif');
                INSERT INTO guru_wali_assignments VALUES ('gw_1', 'gw-sejak-kelas-x', '1', '2024/2025');
            `);
            await h.api.processStudentBirthdayNotificationCron(h.env, '2026-10-13');
            expect(h.inbox().map(r => r.uid)).toEqual(['gw-sejak-kelas-x']);
        } finally { h.sqlite.close(); }
    });

    test('siswa 29 Februari diucapkan 28 Februari pada tahun bukan kabisat', async () => {
        const h = harness();
        try {
            h.sqlite.exec(`
                INSERT INTO students VALUES ('1', 'Ayu', 'XI.3', '2008-02-29', 'aktif');
                INSERT INTO guru_wali_assignments VALUES ('gw_1', 'gw', '1', '2026/2027');
            `);
            const result = await h.api.processStudentBirthdayNotificationCron(h.env, '2027-02-28');
            expect(result.birthdayCount).toBe(1);
            expect(h.inbox()[0].body).toContain('Ayu (XI.3, 19 th)');
        } finally { h.sqlite.close(); }
    });
});

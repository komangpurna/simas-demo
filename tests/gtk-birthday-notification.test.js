const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const { webcrypto } = require('node:crypto');

// Menjalankan cron ulang tahun GTK dengan SQL sebenarnya (node:sqlite) dan D1 context.
const source = fs.readFileSync(path.join(__dirname, '../cloudflare/worker.js'), 'utf8');

function harness() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
        CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT, updated_at DATETIME);
        CREATE TABLE gtk (
            id TEXT PRIMARY KEY,
            nik TEXT,
            nip TEXT,
            nuptk TEXT,
            name TEXT NOT NULL,
            gender TEXT DEFAULT 'L',
            jenis_ptk TEXT,
            role TEXT DEFAULT 'guru_mapel',
            birth_date TEXT,
            status TEXT DEFAULT 'active'
        );
        CREATE TABLE IF NOT EXISTS notification_jobs (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            url TEXT DEFAULT './dashboard.html',
            target_type TEXT NOT NULL,
            target_value TEXT DEFAULT '',
            status TEXT DEFAULT 'pending',
            sent_count INTEGER DEFAULT 0,
            failure_count INTEGER DEFAULT 0,
            created_by TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            processed_at TEXT
        );
        CREATE TABLE IF NOT EXISTS notification_deliveries (
            id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL,
            token_id TEXT NOT NULL,
            token TEXT,
            recipient_uid TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            created_at TEXT DEFAULT (datetime('now'))
        );
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

    const fetchMock = jest.fn(async () => new Response('{}', { status: 404 }));
    const context = vm.createContext({
        console: { ...console, log: () => {}, warn: () => {} },
        URL, URLSearchParams, Request, Response, Headers,
        TextEncoder, TextDecoder, AbortSignal, crypto: webcrypto,
        fetch: fetchMock, atob, btoa, setTimeout, clearTimeout
    });

    vm.runInContext(source.replace('export default {', 'const workerHandler = {') + `
        globalThis.testApi = {
            processGtkBirthdayNotificationCron,
            formatGtkSalutation,
            birthdayMonthDayKeys,
            parseStudentBirthDate,
            acquireDailyCronJobLock
        };
    `, context);

    const env = { DB };
    const api = context.testApi;
    const allJobs = () => sqlite.prepare(`
        SELECT id, title, body, url, target_type, target_value FROM notification_jobs ORDER BY created_at ASC
    `).all();
    const deliveries = () => sqlite.prepare(`
        SELECT d.recipient_uid, d.status, j.title, j.body, j.url, j.target_type, j.target_value
        FROM notification_deliveries d
        JOIN notification_jobs j ON j.id = d.job_id
        ORDER BY d.recipient_uid ASC
    `).all();

    return { sqlite, env, api, allJobs, deliveries, queries };
}

describe('formatGtkSalutation', () => {
    const h = harness();
    afterAll(() => h.sqlite.close());

    test('memberi sapaan Bapak untuk gender L dan Ibu untuk gender P', () => {
        expect(h.api.formatGtkSalutation('I Made Sudarta, S.Pd.', 'L')).toBe('Bapak I Made Sudarta, S.Pd.');
        expect(h.api.formatGtkSalutation('Ni Wayan Sri Dewi, M.Pd.', 'P')).toBe('Ibu Ni Wayan Sri Dewi, M.Pd.');
    });

    test('tidak menduplikasi jika nama sudah diawali sapaan Bapak / Ibu', () => {
        expect(h.api.formatGtkSalutation('Bapak Drs. I Ketut Jelantik', 'L')).toBe('Bapak Drs. I Ketut Jelantik');
        expect(h.api.formatGtkSalutation('Ibu Dra. Ni Made Rai', 'P')).toBe('Ibu Dra. Ni Made Rai');
        expect(h.api.formatGtkSalutation('Bpk. Putu Arsana', 'L')).toBe('Bpk. Putu Arsana');
    });

    test('menangani nama kosong atau gender tidak terdefinisi', () => {
        expect(h.api.formatGtkSalutation('', 'L')).toBe('');
        expect(h.api.formatGtkSalutation('Komang Widana', '')).toBe('Komang Widana');
    });
});

describe('processGtkBirthdayNotificationCron', () => {
    test('1 GTK berulang tahun: membuat notifikasi ke role pimpinan (dengan usia) dan ucapan personal (tanpa usia)', async () => {
        const h = harness();
        try {
            h.sqlite.exec(`
                INSERT INTO gtk (id, nik, nip, name, gender, jenis_ptk, role, birth_date, status) VALUES
                    ('gtk_1', '5105010101850001', '198510130001', 'I Made Sudarta, S.Pd.', 'L', 'Guru Matematika', 'guru_mapel', '1985-10-13', 'active');
            `);

            const result = await h.api.processGtkBirthdayNotificationCron(h.env, '2026-10-13');
            expect(result).toMatchObject({ processed: true, birthdayCount: 1, jobsCreated: 2 });

            const jobs = h.allJobs();
            expect(jobs.length).toBe(2);

            // Job 1: Khusus Kepala Sekolah & Super Admin
            const adminJob = jobs.find(j => j.target_type === 'role');
            expect(adminJob).toBeDefined();
            expect(adminJob.target_value).toBe('kepala_sekolah,super_admin');
            expect(adminJob.title).toBe('🎂 Ulang Tahun GTK Hari Ini');
            expect(adminJob.url).toContain('gtk.html');
            expect(adminJob.body).toContain('Bapak I Made Sudarta, S.Pd.');
            expect(adminJob.body).toContain('Guru Matematika');
            expect(adminJob.body).toContain('41 th'); // 2026 - 1985 = 41
            expect(adminJob.body).toContain('Jangan lupa sampaikan ucapan selamat dan doa terbaik! 🎂🎉');

            // Job 2: Ucapan Personal ke GTK bersangkutan
            const personalJob = jobs.find(j => j.target_type === 'user');
            expect(personalJob).toBeDefined();
            expect(personalJob.target_value).toBe('gtk_1');
            expect(personalJob.title).toBe('🎉 Selamat Ulang Tahun!');
            expect(personalJob.url).toContain('dashboard.html');
            expect(personalJob.body).toContain('Selamat Ulang Tahun, Bapak I Made Sudarta, S.Pd.!');
            expect(personalJob.body).toContain('Semoga panjang umur, sehat selalu, serta sukses dan bahagia bersama keluarga besar SMAGESA. 🎂🎉');
            // Menghormati kesopanan & privasi: tidak menyebut angka usia pada ucapan ke GTK
            expect(personalJob.body).not.toContain('41 th');
            expect(personalJob.body).not.toContain('41 tahun');
        } finally {
            h.sqlite.close();
        }
    });

    test('lebih dari 1 GTK berulang tahun: pimpinan menerima 1 ringkasan gabungan dan tiap GTK menerima ucapan personal', async () => {
        const h = harness();
        try {
            h.sqlite.exec(`
                INSERT INTO gtk (id, nik, nip, name, gender, jenis_ptk, role, birth_date, status) VALUES
                    ('gtk_1', '5105010101850001', '198510130001', 'I Made Sudarta, S.Pd.', 'L', 'Guru Matematika', 'guru_mapel', '1985-10-13', 'active'),
                    ('gtk_2', '5105010101900002', '199010130002', 'Ni Wayan Sri Dewi, S.Kom.', 'P', 'Staff Tata Usaha', 'staff', '13/10/1990', 'active'),
                    ('gtk_3', '5105010101880003', '198810140003', 'I Ketut Jelantik, M.Pd.', 'L', 'Guru Bahasa Bali', 'guru_mapel', '1988-10-14', 'active');
            `);

            const result = await h.api.processGtkBirthdayNotificationCron(h.env, '2026-10-13');
            expect(result).toMatchObject({ processed: true, birthdayCount: 2, jobsCreated: 3 });

            const jobs = h.allJobs();
            expect(jobs.length).toBe(3);

            // Ringkasan pimpinan memuat kedua nama GTK dan usia masing-masing
            const adminJob = jobs.find(j => j.target_type === 'role');
            expect(adminJob.body).toContain('Hari ini 2 GTK berulang tahun');
            expect(adminJob.body).toContain('Bapak I Made Sudarta, S.Pd. (Guru Matematika, 41 th)');
            expect(adminJob.body).toContain('Ibu Ni Wayan Sri Dewi, S.Kom. (Staff Tata Usaha, 36 th)');

            // Tiap GTK mendapatkan job personal masing-masing
            const personalJobs = jobs.filter(j => j.target_type === 'user');
            expect(personalJobs.length).toBe(2);
            expect(personalJobs.map(j => j.target_value).sort()).toEqual(['gtk_1', 'gtk_2']);
        } finally {
            h.sqlite.close();
        }
    });

    test('GTK nonaktif / pensiun / mutasi diabaikan', async () => {
        const h = harness();
        try {
            h.sqlite.exec(`
                INSERT INTO gtk (id, nik, nip, name, gender, jenis_ptk, role, birth_date, status) VALUES
                    ('gtk_pensiun', '510501', '19601013', 'Drs. I Wayan Pensiun', 'L', 'Guru Fisika', 'guru_mapel', '1960-10-13', 'pensiun'),
                    ('gtk_mutasi', '510502', '19751013', 'Ni Made Mutasi, M.Pd.', 'P', 'Guru Biologi', 'guru_mapel', '1975-10-13', 'mutasi'),
                    ('gtk_inactive', '510503', '19801013', 'I Ketut Nonaktif', 'L', 'Staff', 'staff', '1980-10-13', 'inactive');
            `);

            const result = await h.api.processGtkBirthdayNotificationCron(h.env, '2026-10-13');
            expect(result).toMatchObject({ processed: true, birthdayCount: 0, jobsCreated: 0 });
            expect(h.allJobs().length).toBe(0);
        } finally {
            h.sqlite.close();
        }
    });

    test('GTK kelahiran 29 Februari diberi ucapan tanggal 28 Februari pada tahun non-kabisat', async () => {
        const h = harness();
        try {
            h.sqlite.exec(`
                INSERT INTO gtk (id, nik, nip, name, gender, jenis_ptk, role, birth_date, status) VALUES
                    ('gtk_kabisat', '5105010101960001', '199602290001', 'Putu Kabisat, S.Pd.', 'L', 'Guru Olahraga', 'guru_mapel', '1996-02-29', 'active');
            `);

            // 2027 bukan tahun kabisat -> 28 Februari memicu ucapan
            const result = await h.api.processGtkBirthdayNotificationCron(h.env, '2027-02-28');
            expect(result.birthdayCount).toBe(1);

            const adminJob = h.allJobs().find(j => j.target_type === 'role');
            expect(adminJob.body).toContain('Bapak Putu Kabisat, S.Pd. (Guru Olahraga, 31 th)');
        } finally {
            h.sqlite.close();
        }
    });

    test('tidak ada GTK berulang tahun: aman dan menghasilkan 0 notifikasi', async () => {
        const h = harness();
        try {
            h.sqlite.exec(`
                INSERT INTO gtk (id, name, gender, birth_date, status) VALUES
                    ('gtk_1', 'I Wayan Saja', 'L', '1990-01-01', 'active');
            `);

            const result = await h.api.processGtkBirthdayNotificationCron(h.env, '2026-10-13');
            expect(result).toMatchObject({ processed: true, birthdayCount: 0, jobsCreated: 0 });
            expect(h.allJobs().length).toBe(0);
        } finally {
            h.sqlite.close();
        }
    });

    test('idempotensi lock harian acquireDailyCronJobLock: tidak mengeksekusi dua kali pada hari yang sama', async () => {
        const h = harness();
        try {
            // Pemanggilan pertama pada 2026-10-18: sukses memperoleh lock
            const firstLock = await h.api.acquireDailyCronJobLock(h.env.DB, 'gtk_birthday', '2026-10-18');
            expect(firstLock).toBe(true);

            // Pemanggilan kedua pada tanggal yang sama: terkunci (false)
            const secondLock = await h.api.acquireDailyCronJobLock(h.env.DB, 'gtk_birthday', '2026-10-18');
            expect(secondLock).toBe(false);

            // Berganti hari ke 2026-10-19: sukses memperoleh lock baru
            const nextDayLock = await h.api.acquireDailyCronJobLock(h.env.DB, 'gtk_birthday', '2026-10-19');
            expect(nextDayLock).toBe(true);
        } finally {
            h.sqlite.close();
        }
    });
});

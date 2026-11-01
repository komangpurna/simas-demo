/**
 * tests/supabase-rls-lockdown-priority1.test.js
 * Unit Test Verifikasi Arsitektur Lockdown RLS 5 Tabel Supabase (Prioritas 1)
 * Standar: OWASP Top 10 (A01: Broken Access Control), ASVS Level 1 & 2
 *
 * Menguji kepatuhan:
 * 1. Skrip migrasi 202610280001_lockdown_telemetry_rkas_sukaduka_closings.sql
 * 2. Helper getSupabaseServerKey di cloudflare/worker.js
 * 3. Paritas 7 titik pemanggilan telemetri di cloudflare/worker.js
 * 4. Isolasi tabel di js/supabase-secure-fetch.mjs
 */

const fs = require('fs');
const path = require('path');

describe('Lockdown RLS 5 Tabel Supabase (Prioritas 1)', () => {
    const rootDir = path.resolve(__dirname, '..');
    const migrationPath = path.join(rootDir, 'supabase', 'migrations', '202610280001_lockdown_telemetry_rkas_sukaduka_closings.sql');
    const workerPath = path.join(rootDir, 'cloudflare', 'worker.js');
    const secureFetchPath = path.join(rootDir, 'js', 'supabase-secure-fetch.mjs');

    test('1. Skrip migrasi lockdown mendefinisikan 5 tabel dan mencabut akses anon/authenticated', () => {
        expect(fs.existsSync(migrationPath)).toBe(true);
        const sql = fs.readFileSync(migrationPath, 'utf8');

        // Pastikan ke-5 tabel terdaftar
        const expectedTables = [
            'rkas_komite_headers',
            'rkas_komite_items',
            'sukaduka_closings',
            'login_history',
            'audit_logs'
        ];
        expectedTables.forEach(table => {
            expect(sql).toContain(`'${table}'`);
        });

        // Verifikasi konstruksi RLS tegas
        expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
        expect(sql).toContain('DROP POLICY IF EXISTS');
        expect(sql).toContain('REVOKE ALL ON TABLE public.%I FROM anon, authenticated');
        expect(sql).toContain('GRANT ALL ON TABLE public.%I TO service_role');
        expect(sql).toContain("NOTIFY pgrst, 'reload schema'");

        // Tidak boleh ada policy USING (true) aktif di luar komentar prosedur rollback
        const linesWithoutComments = sql
            .split('\n')
            .filter(line => !line.trim().startsWith('--'))
            .join('\n');

        expect(linesWithoutComments).not.toContain('CREATE POLICY');
        expect(linesWithoutComments).not.toContain('USING (true)');
    });

    test('2. cloudflare/worker.js mendefinisikan helper getSupabaseServerKey', () => {
        const workerSrc = fs.readFileSync(workerPath, 'utf8');
        expect(workerSrc).toContain('function getSupabaseServerKey(env)');

        // Ekstraksi fungsi untuk pengujian unit fungsional
        const helperMatch = workerSrc.match(/function getSupabaseServerKey\(env\)[\s\S]*?return\s*\([^)]+\)\.trim\(\);\s*\}/);
        expect(helperMatch).not.toBeNull();

        const DEFAULT_SUPABASE_ANON_KEY = 'fallback_anon_key';
        const getSupabaseServerKey = new Function('env', 'DEFAULT_SUPABASE_ANON_KEY', `
            ${helperMatch[0]}
            return getSupabaseServerKey(env);
        `);

        // Skenario A: Ada SUPABASE_SERVICE_ROLE_KEY di env
        const envWithService = {
            SUPABASE_SERVICE_ROLE_KEY: 'secret_service_role_123',
            SUPABASE_ANON_KEY: 'public_anon_456'
        };
        expect(getSupabaseServerKey(envWithService, DEFAULT_SUPABASE_ANON_KEY)).toBe('secret_service_role_123');

        // Skenario B: SUPABASE_SERVICE_ROLE_KEY kosong -> fallback ke SUPABASE_ANON_KEY
        const envWithAnonOnly = {
            SUPABASE_ANON_KEY: 'public_anon_456'
        };
        expect(getSupabaseServerKey(envWithAnonOnly, DEFAULT_SUPABASE_ANON_KEY)).toBe('public_anon_456');

        // Skenario C: env null/kosong -> fallback ke DEFAULT_SUPABASE_ANON_KEY
        expect(getSupabaseServerKey({}, DEFAULT_SUPABASE_ANON_KEY)).toBe('fallback_anon_key');
    });

    test('3. Seluruh 7 titik pemanggilan Supabase telemetri di worker.js menggunakan getSupabaseServerKey(env)', () => {
        const workerSrc = fs.readFileSync(workerPath, 'utf8');

        // 1. recordAuditLog
        const recordAuditSection = workerSrc.slice(
            workerSrc.indexOf('async function recordAuditLog(env,'),
            workerSrc.indexOf('async function recordAuditLog(env,') + 1200
        );
        expect(recordAuditSection).toContain('const supabaseKey = getSupabaseServerKey(env);');

        // 2 & 3. GET & POST /api/login-history
        const loginGetIdx = workerSrc.indexOf('if (path === "/api/login-history" && method === "GET")');
        const loginPostIdx = workerSrc.indexOf('if (path === "/api/login-history" && method === "POST")');
        const auditGetIdx = workerSrc.indexOf('if (path === "/api/audit-logs" && method === "GET")');
        const auditPostIdx = workerSrc.indexOf('if (path === "/api/audit-logs" && method === "POST")');
        const migrateIdx = workerSrc.indexOf('if (path === "/api/migrate/telemetry" && method === "POST")');

        expect(loginGetIdx).toBeGreaterThan(0);
        expect(loginPostIdx).toBeGreaterThan(0);
        expect(auditGetIdx).toBeGreaterThan(0);
        expect(auditPostIdx).toBeGreaterThan(0);
        expect(migrateIdx).toBeGreaterThan(0);

        const loginHistGetSection = workerSrc.slice(loginGetIdx, loginPostIdx);
        expect(loginHistGetSection).toContain('const supabaseKey = getSupabaseServerKey(env);');

        const loginHistPostSection = workerSrc.slice(loginPostIdx, auditGetIdx);
        expect(loginHistPostSection).toContain('const supabaseKey = getSupabaseServerKey(env);');

        // 4. GET /api/audit-logs
        const auditLogsGetSection = workerSrc.slice(auditGetIdx, auditPostIdx);
        expect(auditLogsGetSection).toContain('const supabaseKey = getSupabaseServerKey(env);');

        // 5. POST /api/migrate/telemetry
        const migrateSection = workerSrc.slice(migrateIdx, migrateIdx + 3000);
        expect(migrateSection).toContain('const supabaseKey = getSupabaseServerKey(env);');

        // 6 & 7. performAutoCleanup (login_history & audit_logs)
        const cleanupSection = workerSrc.slice(
            workerSrc.indexOf('async function performAutoCleanup(env)'),
            workerSrc.indexOf('async function performAutoCleanup(env)') + 1500
        );
        // Memastikan ada 2 kemunculan getSupabaseServerKey di bagian cleanup
        const cleanupKeyMatches = cleanupSection.match(/const supabaseKey = getSupabaseServerKey\(env\);/g) || [];
        expect(cleanupKeyMatches.length).toBe(2);
    });

    test('4. Ke-5 tabel sensitif tidak ada di PUBLIC_READ_TABLES js/supabase-secure-fetch.mjs', () => {
        const secureFetchSrc = fs.readFileSync(secureFetchPath, 'utf8');

        // Ambil isi Set PUBLIC_READ_TABLES
        const publicReadMatch = secureFetchSrc.match(/const PUBLIC_READ_TABLES = new Set\(\[([\s\S]*?)\]\);/);
        expect(publicReadMatch).not.toBeNull();

        const publicTablesStr = publicReadMatch[1];
        const sensitiveTables = [
            'rkas_komite_headers',
            'rkas_komite_items',
            'sukaduka_closings',
            'login_history',
            'audit_logs'
        ];

        sensitiveTables.forEach(table => {
            expect(publicTablesStr).not.toContain(`'${table}'`);
        });
    });
});

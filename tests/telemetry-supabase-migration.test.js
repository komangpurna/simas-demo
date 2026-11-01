/**
 * tests/telemetry-supabase-migration.test.js
 * Unit Test Verifikasi Arsitektur Migrasi Telemetri (login_history & audit_logs) ke Supabase PostgreSQL
 */

const fs = require('fs');
const path = require('path');

describe('Verifikasi Migrasi Telemetri ke Supabase PostgreSQL', () => {
    const workerPath = path.join(__dirname, '../cloudflare/worker.js');
    const wranglerPath = path.join(__dirname, '../cloudflare/wrangler.toml');
    const migrationSqlPath = path.join(__dirname, '../supabase/migrations/202610060001_create_telemetry_tables.sql');
    const migrationScriptPath = path.join(__dirname, '../scripts/migrate_telemetry_to_supabase.mjs');
    const pageSettingsPath = path.join(__dirname, '../js/page-settings.js');
    const settingsHtmlPath = path.join(__dirname, '../settings.html');

    test('1. Interval Cron Outbox di wrangler.toml harus berjarak 10 menit (*/10 * * * *)', () => {
        const wranglerContent = fs.readFileSync(wranglerPath, 'utf8');
        expect(wranglerContent).toContain('"*/10 * * * *"');
        expect(wranglerContent).not.toContain('"* * * * *"');
    });

    test('2. Skema DDL Supabase PostgreSQL harus mendefinisikan tabel, indeks, dan RLS secara lengkap', () => {
        expect(fs.existsSync(migrationSqlPath)).toBe(true);
        const sql = fs.readFileSync(migrationSqlPath, 'utf8');

        // Tabel login_history
        expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.login_history');
        expect(sql).toContain('idx_login_history_login_at');
        expect(sql).toContain('idx_login_history_role');
        expect(sql).toContain('idx_login_history_uid');

        // Tabel audit_logs
        expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.audit_logs');
        expect(sql).toContain('idx_audit_logs_timestamp');
        expect(sql).toContain('idx_audit_logs_action');
        expect(sql).toContain('idx_audit_logs_actor_uid');

        // RLS
        expect(sql).toContain('ALTER TABLE public.login_history ENABLE ROW LEVEL SECURITY');
        expect(sql).toContain('ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY');
        expect(sql).toContain('Allow anon and auth read on login_history');
        expect(sql).toContain('Allow anon and auth insert on login_history');
        expect(sql).toContain('Allow anon and auth read on audit_logs');
        expect(sql).toContain('Allow anon and auth insert on audit_logs');
    });

    test('3. recordAuditLog di Cloudflare Worker harus menulis langsung ke Supabase PostgREST (0 D1 Writes)', () => {
        const workerContent = fs.readFileSync(workerPath, 'utf8');
        expect(workerContent).toMatch(/async function recordAuditLog\(env,/);
        expect(workerContent).toContain('/rest/v1/audit_logs');
        expect(workerContent).toContain('resolution=merge-duplicates');
        // Tidak ada lagi prepared statement INSERT INTO audit_logs di dalam helper recordAuditLog
        const recordAuditFnMatch = workerContent.match(/async function recordAuditLog[\s\S]*?\n\}/);
        expect(recordAuditFnMatch).not.toBeNull();
        expect(recordAuditFnMatch[0]).not.toContain('env.DB.prepare');
    });

    test('4. Endpoint /api/login-history (GET & POST) di Worker harus terhubung ke Supabase', () => {
        const workerContent = fs.readFileSync(workerPath, 'utf8');
        expect(workerContent).toContain('/rest/v1/login_history');
        expect(workerContent).toContain('GET /api/login-history');
        expect(workerContent).toContain('POST /api/login-history');
    });

    test('5. Endpoint /api/audit-logs (GET & POST) di Worker harus terhubung ke Supabase', () => {
        const workerContent = fs.readFileSync(workerPath, 'utf8');
        expect(workerContent).toContain('/rest/v1/audit_logs');
        expect(workerContent).toContain('GET /api/audit-logs');
        expect(workerContent).toContain('POST /api/audit-logs');
    });

    test('6. Rolling retention auto cleanup harus membersihkan data kedaluwarsa di Supabase', () => {
        const workerContent = fs.readFileSync(workerPath, 'utf8');
        expect(workerContent).toContain('/rest/v1/login_history?login_at=lt.');
        expect(workerContent).toContain('/rest/v1/audit_logs?timestamp=lt.');
    });

    test('7. Skrip migrasi batch D1 ke Supabase harus ada dan berformat ES Module valid', () => {
        expect(fs.existsSync(migrationScriptPath)).toBe(true);
        const script = fs.readFileSync(migrationScriptPath, 'utf8');
        expect(script).toContain('checkSupabaseTable');
        expect(script).toContain('insertBatchToSupabase');
        expect(script).toContain('resolution=merge-duplicates');
    });

    test('8. Modul Backup di js/page-settings.js dan settings.html harus mengidentifikasi telemetri sebagai database Supabase', () => {
        const pageSettingsContent = fs.readFileSync(pageSettingsPath, 'utf8');
        expect(pageSettingsContent).toMatch(/login_history:\s*\{[\s\S]*?db:\s*'supabase'/);
        expect(pageSettingsContent).toMatch(/audit_logs:\s*\{[\s\S]*?db:\s*'supabase'/);

        const settingsHtmlContent = fs.readFileSync(settingsHtmlPath, 'utf8');
        expect(settingsHtmlContent).toContain('data-db="supabase" data-search="riwayat log sesi login user login_history"');
        expect(settingsHtmlContent).toContain('data-db="supabase" data-search="log audit keamanan owasp asvs audit_logs"');
    });
});

-- ====================================================================
-- SIMAS SMAGESA - SUPABASE POSTGRESQL MIGRATION
-- Telemetri & Log Jejak Audit: login_history & audit_logs
-- Single Source of Truth (SSOT)
-- ====================================================================

-- 1. TABEL RIWAYAT SESI LOGIN (login_history)
CREATE TABLE IF NOT EXISTS public.login_history (
    id TEXT PRIMARY KEY,
    uid TEXT NOT NULL,
    email TEXT,
    name TEXT,
    role TEXT,
    login_at TEXT NOT NULL,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- Indeks performa kueri B-Tree
CREATE INDEX IF NOT EXISTS idx_login_history_login_at ON public.login_history(login_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_history_role ON public.login_history(role);
CREATE INDEX IF NOT EXISTS idx_login_history_uid ON public.login_history(uid);

-- 2. TABEL LOG AUDIT KEAMANAN (audit_logs - ASVS Level 1 & 2)
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    target_id TEXT,
    actor_uid TEXT,
    actor_name TEXT,
    old_data TEXT,
    new_data TEXT,
    details TEXT,
    timestamp TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- Indeks performa kueri B-Tree
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON public.audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_uid ON public.audit_logs(actor_uid);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target_id ON public.audit_logs(target_id);

-- 3. ROW LEVEL SECURITY (RLS) & HAK AKSES API
ALTER TABLE public.login_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Izinkan akses penuh untuk anon & authenticated (diamankan secara ketat oleh Cloudflare Worker API Gateway)
DROP POLICY IF EXISTS "Allow anon and auth read on login_history" ON public.login_history;
CREATE POLICY "Allow anon and auth read on login_history" ON public.login_history
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Allow anon and auth insert on login_history" ON public.login_history;
CREATE POLICY "Allow anon and auth insert on login_history" ON public.login_history
    FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon and auth delete on login_history" ON public.login_history;
CREATE POLICY "Allow anon and auth delete on login_history" ON public.login_history
    FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Allow anon and auth update on login_history" ON public.login_history;
CREATE POLICY "Allow anon and auth update on login_history" ON public.login_history
    FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon and auth read on audit_logs" ON public.audit_logs;
CREATE POLICY "Allow anon and auth read on audit_logs" ON public.audit_logs
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Allow anon and auth insert on audit_logs" ON public.audit_logs;
CREATE POLICY "Allow anon and auth insert on audit_logs" ON public.audit_logs
    FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon and auth delete on audit_logs" ON public.audit_logs;
CREATE POLICY "Allow anon and auth delete on audit_logs" ON public.audit_logs
    FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Allow anon and auth update on audit_logs" ON public.audit_logs;
CREATE POLICY "Allow anon and auth update on audit_logs" ON public.audit_logs
    FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- Refresh PostgREST Schema Cache
NOTIFY pgrst, 'reload schema';

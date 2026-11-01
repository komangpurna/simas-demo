-- =====================================================================
-- SIMAS SMAGESA - SUPABASE POSTGRESQL MIGRATION
-- 202610280001_lockdown_telemetry_rkas_sukaduka_closings.sql
-- Standar Keamanan: OWASP Top 10 (A01: Broken Access Control) & ASVS Level 1 & 2
--
-- Mengunci rapat 5 tabel sensitif yang sebelumnya memiliki policy 'anon'
-- terbuka (USING (true)):
-- 1. rkas_komite_headers (Keuangan RKAS Komite)
-- 2. rkas_komite_items   (Rincian Belanja RKAS Komite)
-- 3. sukaduka_closings   (Kunci Tutup Buku Tahunan Suka Duka)
-- 4. login_history       (Riwayat Sesi Login Pengguna / Telemetri)
-- 5. audit_logs          (Log Audit Forensik & Jejak Mutasi Data)
--
-- Seluruh akses tabel di atas kini EKSKLUSIF melalui role 'service_role'
-- (Supabase Edge Function 'secure-proxy' & Cloudflare Worker API Gateway).
-- Pengguna dengan anon key publik dari browser ditolak 100% oleh PostgREST.
-- =====================================================================

DO $$
DECLARE
  target_table TEXT;
  existing_policy RECORD;
  protected_tables TEXT[] := ARRAY[
    'rkas_komite_headers',
    'rkas_komite_items',
    'sukaduka_closings',
    'login_history',
    'audit_logs'
  ];
BEGIN
  FOREACH target_table IN ARRAY protected_tables LOOP
    -- Pastikan tabel ada di schema public sebelum memproses
    IF to_regclass(format('public.%I', target_table)) IS NULL THEN
      RAISE NOTICE 'Tabel public.% tidak ditemukan, melewati...', target_table;
      CONTINUE;
    END IF;

    -- 1. Aktifkan Row Level Security (RLS) secara tegas
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target_table);

    -- 2. Hapus seluruh policy yang ada saat ini (membersihkan policy lama yang longgar)
    FOR existing_policy IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = target_table
    LOOP
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON public.%I',
        existing_policy.policyname,
        target_table
      );
    END LOOP;

    -- 3. Cabut semua hak akses tabel dari role anon & authenticated
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', target_table);

    -- 4. Berikan hak penuh hanya kepada service_role
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', target_table);

    RAISE NOTICE 'Tabel public.% berhasil dikunci ke mode service_role only.', target_table;
  END LOOP;
END
$$;

-- Refresh schema cache PostgREST agar perubahan hak akses langsung aktif
NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- PROSEDUR ROLLBACK DARURAT (Hanya dijalankan jika ada kendala sistem):
-- =====================================================================
-- GRANT ALL ON public.rkas_komite_headers TO anon, authenticated;
-- CREATE POLICY "Allow read rkas_komite_headers" ON public.rkas_komite_headers FOR SELECT USING (true);
-- CREATE POLICY "Allow write rkas_komite_headers" ON public.rkas_komite_headers FOR ALL USING (true) WITH CHECK (true);
--
-- GRANT ALL ON public.rkas_komite_items TO anon, authenticated;
-- CREATE POLICY "Allow read rkas_komite_items" ON public.rkas_komite_items FOR SELECT USING (true);
-- CREATE POLICY "Allow write rkas_komite_items" ON public.rkas_komite_items FOR ALL USING (true) WITH CHECK (true);
--
-- GRANT ALL ON public.sukaduka_closings TO anon, authenticated;
-- CREATE POLICY "Allow anonymous read sukaduka_closings" ON public.sukaduka_closings FOR SELECT USING (true);
-- CREATE POLICY "Allow anonymous write sukaduka_closings" ON public.sukaduka_closings FOR ALL USING (true) WITH CHECK (true);
--
-- GRANT ALL ON public.login_history TO anon, authenticated;
-- CREATE POLICY "Allow anon and auth read on login_history" ON public.login_history FOR SELECT TO anon, authenticated USING (true);
-- CREATE POLICY "Allow anon and auth insert on login_history" ON public.login_history FOR INSERT TO anon, authenticated WITH CHECK (true);
-- CREATE POLICY "Allow anon and auth delete on login_history" ON public.login_history FOR DELETE TO anon, authenticated USING (true);
-- CREATE POLICY "Allow anon and auth update on login_history" ON public.login_history FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
--
-- GRANT ALL ON public.audit_logs TO anon, authenticated;
-- CREATE POLICY "Allow anon and auth read on audit_logs" ON public.audit_logs FOR SELECT TO anon, authenticated USING (true);
-- CREATE POLICY "Allow anon and auth insert on audit_logs" ON public.audit_logs FOR INSERT TO anon, authenticated WITH CHECK (true);
-- CREATE POLICY "Allow anon and auth delete on audit_logs" ON public.audit_logs FOR DELETE TO anon, authenticated USING (true);
-- CREATE POLICY "Allow anon and auth update on audit_logs" ON public.audit_logs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
-- NOTIFY pgrst, 'reload schema';

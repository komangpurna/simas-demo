-- supabase/migrations/202608140004_fix_security_advisor_rls.sql
-- Optimasi Keamanan Database & Penyelesaian Peringatan Supabase Security Advisor
-- 1. Mengamankan fungsi SECURITY DEFINER rls_auto_enable dari RPC publik (anon/authenticated)
-- 2. Membersihkan redundansi RLS policy ganda (SELECT + ALL) pada seluruh tabel baru

-- =========================================================================
-- 1. AMANKAN FUNGSI SECURITY DEFINER (rls_auto_enable)
-- =========================================================================
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc p 
        JOIN pg_namespace n ON p.pronamespace = n.oid 
        WHERE n.nspname = 'public' AND p.proname = 'rls_auto_enable'
    ) THEN
        REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
        REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon;
        REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM authenticated;
        GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO service_role, postgres;
    END IF;
END $$;

-- =========================================================================
-- 2. OPTIMASI & DEDUPLIKASI RLS POLICY: MODUL GURU MAPEL
-- =========================================================================
DROP POLICY IF EXISTS "Allow anonymous read gradebooks" ON public.guru_mapel_gradebooks;
DROP POLICY IF EXISTS "Allow anonymous write gradebooks" ON public.guru_mapel_gradebooks;
DROP POLICY IF EXISTS "Allow anon all gradebooks" ON public.guru_mapel_gradebooks;
CREATE POLICY "Allow anon all gradebooks" ON public.guru_mapel_gradebooks FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anonymous read components" ON public.guru_mapel_components;
DROP POLICY IF EXISTS "Allow anonymous write components" ON public.guru_mapel_components;
DROP POLICY IF EXISTS "Allow anon all components" ON public.guru_mapel_components;
CREATE POLICY "Allow anon all components" ON public.guru_mapel_components FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anonymous read scores" ON public.guru_mapel_scores;
DROP POLICY IF EXISTS "Allow anonymous write scores" ON public.guru_mapel_scores;
DROP POLICY IF EXISTS "Allow anon all scores" ON public.guru_mapel_scores;
CREATE POLICY "Allow anon all scores" ON public.guru_mapel_scores FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anonymous read summaries" ON public.guru_mapel_summaries;
DROP POLICY IF EXISTS "Allow anonymous write summaries" ON public.guru_mapel_summaries;
DROP POLICY IF EXISTS "Allow anon all summaries" ON public.guru_mapel_summaries;
CREATE POLICY "Allow anon all summaries" ON public.guru_mapel_summaries FOR ALL USING (true) WITH CHECK (true);

-- =========================================================================
-- 3. OPTIMASI & DEDUPLIKASI RLS POLICY: MODUL KEUANGAN (SPP & KAS KOMITE)
-- =========================================================================
DROP POLICY IF EXISTS "Allow read finance_transactions" ON public.finance_transactions;
DROP POLICY IF EXISTS "Allow write finance_transactions" ON public.finance_transactions;
DROP POLICY IF EXISTS "Allow full access finance_transactions" ON public.finance_transactions;
CREATE POLICY "Allow full access finance_transactions" ON public.finance_transactions FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow read finance_daily_summary" ON public.finance_daily_summary;
DROP POLICY IF EXISTS "Allow write finance_daily_summary" ON public.finance_daily_summary;
DROP POLICY IF EXISTS "Allow full access finance_daily_summary" ON public.finance_daily_summary;
CREATE POLICY "Allow full access finance_daily_summary" ON public.finance_daily_summary FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow read finance_cashflow" ON public.finance_cashflow;
DROP POLICY IF EXISTS "Allow write finance_cashflow" ON public.finance_cashflow;
DROP POLICY IF EXISTS "Allow full access finance_cashflow" ON public.finance_cashflow;
CREATE POLICY "Allow full access finance_cashflow" ON public.finance_cashflow FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow read finance_closings" ON public.finance_closings;
DROP POLICY IF EXISTS "Allow write finance_closings" ON public.finance_closings;
DROP POLICY IF EXISTS "Allow full access finance_closings" ON public.finance_closings;
CREATE POLICY "Allow full access finance_closings" ON public.finance_closings FOR ALL USING (true) WITH CHECK (true);

-- =========================================================================
-- 4. OPTIMASI & DEDUPLIKASI RLS POLICY: MODUL PRESENSI GURU & SISWA
-- =========================================================================
DROP POLICY IF EXISTS "Allow public read guru_presensi" ON public.guru_presensi;
DROP POLICY IF EXISTS "Allow public all guru_presensi" ON public.guru_presensi;
DROP POLICY IF EXISTS "Allow full access guru_presensi" ON public.guru_presensi;
CREATE POLICY "Allow full access guru_presensi" ON public.guru_presensi FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public read siswa_presensi_harian" ON public.siswa_presensi_harian;
DROP POLICY IF EXISTS "Allow public all siswa_presensi_harian" ON public.siswa_presensi_harian;
DROP POLICY IF EXISTS "Allow full access siswa_presensi_harian" ON public.siswa_presensi_harian;
CREATE POLICY "Allow full access siswa_presensi_harian" ON public.siswa_presensi_harian FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public read siswa_presensi" ON public.siswa_presensi;
DROP POLICY IF EXISTS "Allow public all siswa_presensi" ON public.siswa_presensi;
DROP POLICY IF EXISTS "Allow full access siswa_presensi" ON public.siswa_presensi;
CREATE POLICY "Allow full access siswa_presensi" ON public.siswa_presensi FOR ALL USING (true) WITH CHECK (true);

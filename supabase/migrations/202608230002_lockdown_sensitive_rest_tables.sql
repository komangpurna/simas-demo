-- =====================================================================
-- LOCKDOWN GLOBAL SUPABASE POSTGREST
-- Jalankan HANYA setelah secure-proxy dan adapter hosting versi ini aktif.
-- Semua tabel sensitif tidak lagi memiliki policy anon/authenticated;
-- secure-proxy memakai service_role setelah memverifikasi Firebase JWT + role.
-- =====================================================================

DO $$
DECLARE
  target_table TEXT;
  existing_policy RECORD;
  protected_tables TEXT[] := ARRAY[
    'duta_kandidat',
    'duta_suara_masuk',
    'finance_cashflow',
    'finance_closings',
    'finance_daily_summary',
    'finance_transactions',
    'guru_mapel_components',
    'guru_mapel_gradebooks',
    'guru_mapel_scores',
    'guru_mapel_summaries',
    'guru_presensi',
    'lib_bebas_pustaka',
    'lib_buku',
    'lib_config',
    'lib_eksemplar',
    'lib_kategori_ddc',
    'lib_pengunjung',
    'lib_sirkulasi',
    'masukkan_saran',
    'siswa_presensi',
    'siswa_presensi_harian',
    'sukaduka_config',
    'sukaduka_iuran',
    'sukaduka_kas'
  ];
BEGIN
  FOREACH target_table IN ARRAY protected_tables LOOP
    IF to_regclass(format('public.%I', target_table)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target_table);

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
  END LOOP;
END
$$;

-- Hanya data katalog/non-sensitif berikut yang memang dibutuhkan halaman
-- publik tanpa sesi Firebase. Tidak ada public-write policy yang dibuat.
CREATE POLICY "Secure public read duta candidates"
  ON public.duta_kandidat FOR SELECT USING (true);

CREATE POLICY "Secure public read library books"
  ON public.lib_buku FOR SELECT USING (true);

CREATE POLICY "Secure public read library config"
  ON public.lib_config FOR SELECT USING (true);

CREATE POLICY "Secure public read library copies"
  ON public.lib_eksemplar FOR SELECT USING (true);

CREATE POLICY "Secure public read library DDC"
  ON public.lib_kategori_ddc FOR SELECT USING (true);

COMMENT ON POLICY "Secure public read duta candidates" ON public.duta_kandidat
  IS 'Kandidat bersifat publik; semua operasi tulis wajib melalui secure-proxy.';
COMMENT ON POLICY "Secure public read library books" ON public.lib_buku
  IS 'Metadata OPAC bersifat publik; semua operasi tulis wajib melalui secure-proxy.';

-- Fungsi retensi menggunakan SECURITY DEFINER dan sebelumnya dapat dipanggil
-- oleh anon. Itu memungkinkan siapa pun memicu penghapusan arsip sebelum jadwal
-- pg_cron. Jadwal berjalan sebagai pemilik fungsi dan tidak memerlukan grant ini.
REVOKE ALL ON FUNCTION public.cleanup_old_siswa_presensi() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_old_guru_presensi() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_old_duta_votes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_old_masukkan_saran() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_old_guru_mapel_grades() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_old_finance_records() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_old_sukaduka_records() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_all_expired_simas_data() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.cleanup_old_siswa_presensi() TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_guru_presensi() TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_duta_votes() TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_masukkan_saran() TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_guru_mapel_grades() TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_finance_records() TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_sukaduka_records() TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_all_expired_simas_data() TO service_role;

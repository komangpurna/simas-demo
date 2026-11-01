-- ====================================================================
-- MIGRATION: RETENSI DATA MODUL PERPUSTAKAAN OTOMATIS VIA PG_CRON
-- Database: PostgreSQL Supabase (elrmzlicuuglnoeedusr)
-- Author: SIMAS SMAGESA Development Team
-- Date: 2026-09-05
-- Version: [26.09.05.4]
-- ====================================================================

-- 1. AKTIFKAN EKSTENSI PG_CRON (Idempotent)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ====================================================================
-- 2. FUNGSI PEMBERSIHAN DATA LAMA PERPUSTAKAAN (Retensi: 3 Tahun / Masa Studi SMA)
-- ====================================================================
CREATE OR REPLACE FUNCTION public.cleanup_old_library_records()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_pengunjung INT := 0;
    deleted_bebas_pustaka INT := 0;
    deleted_sirkulasi INT := 0;
    cutoff_date DATE;
BEGIN
    cutoff_date := (CURRENT_DATE - INTERVAL '3 years')::DATE;

    -- 1. Hapus riwayat buku tamu digital (lib_pengunjung) > 3 tahun (memanfaatkan idx_lib_pengunjung_tanggal)
    DELETE FROM public.lib_pengunjung
    WHERE tanggal < cutoff_date;
    GET DIAGNOSTICS deleted_pengunjung = ROW_COUNT;

    -- 2. Hapus arsip surat bebas pustaka (lib_bebas_pustaka) alumni > 3 tahun
    DELETE FROM public.lib_bebas_pustaka
    WHERE tgl_terbit < cutoff_date;
    GET DIAGNOSTICS deleted_bebas_pustaka = ROW_COUNT;

    -- 3. Hapus arsip sirkulasi peminjaman (lib_sirkulasi) > 3 tahun
    -- SYARAT KETAT: Hanya transaksi yang SUDAH SELESAI & LUNAS / BEBAS DENDA
    -- Peminjaman yang masih aktif ('dipinjam') atau menunggak denda ('belum_lunas') TIDAK BOLEH dihapus!
    DELETE FROM public.lib_sirkulasi
    WHERE status = 'kembali'
      AND status_denda != 'belum_lunas'
      AND (
          status_denda IN ('bebas_denda', 'lunas')
          OR COALESCE(total_denda, 0) <= 0
      )
      AND COALESCE(tgl_kembali, tgl_pinjam) < cutoff_date;
    GET DIAGNOSTICS deleted_sirkulasi = ROW_COUNT;

    RETURN jsonb_build_object(
        'module', 'perpustakaan',
        'status', 'success',
        'cutoff_date', cutoff_date,
        'deleted_visitors_rows', deleted_pengunjung,
        'deleted_clearance_rows', deleted_bebas_pustaka,
        'deleted_circulation_rows', deleted_sirkulasi,
        'total_deleted_rows', (deleted_pengunjung + deleted_bebas_pustaka + deleted_sirkulasi),
        'executed_at', NOW()
    );
END;
$$;

-- ====================================================================
-- 3. PERBARUI MASTER RUNNER FUNCTION (SEKALIGUS MEMICU PERPUSTAKAAN)
-- ====================================================================
CREATE OR REPLACE FUNCTION public.cleanup_all_expired_simas_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    res_siswa jsonb;
    res_guru jsonb;
    res_duta jsonb;
    res_saran jsonb;
    res_grades jsonb;
    res_finance jsonb;
    res_sukaduka jsonb;
    res_library jsonb;
BEGIN
    res_siswa := public.cleanup_old_siswa_presensi();
    res_guru := public.cleanup_old_guru_presensi();
    res_duta := public.cleanup_old_duta_votes();
    res_saran := public.cleanup_old_masukkan_saran();
    res_grades := public.cleanup_old_guru_mapel_grades();
    res_finance := public.cleanup_old_finance_records();
    res_sukaduka := public.cleanup_old_sukaduka_records();
    res_library := public.cleanup_old_library_records();

    RETURN jsonb_build_object(
        'status', 'success',
        'executed_at', NOW(),
        'results', jsonb_build_object(
            'siswa_presensi', res_siswa,
            'guru_presensi', res_guru,
            'duta_votes', res_duta,
            'masukkan_saran', res_saran,
            'guru_mapel_grades', res_grades,
            'finance', res_finance,
            'sukaduka', res_sukaduka,
            'perpustakaan', res_library
        )
    );
END;
$$;

-- ====================================================================
-- 4. DAFTARKAN JADWAL OTOMATIS VIA PG_CRON (Idempotent Loop)
-- Tanggal 1 awal bulan pukul 02:35 WITA (18:35 UTC) - Staggered 5 menit setelah suka duka
-- ====================================================================
DO $$
DECLARE
    job_rec RECORD;
BEGIN
    FOR job_rec IN 
        SELECT jobname FROM cron.job 
        WHERE jobname = 'auto-cleanup-library-records'
    LOOP
        PERFORM cron.unschedule(job_rec.jobname);
    END LOOP;

    PERFORM cron.schedule(
        'auto-cleanup-library-records',
        '35 18 1 * *',
        $cron$SELECT public.cleanup_old_library_records();$cron$
    );
END $$;

-- ====================================================================
-- 5. HARDENING HAK AKSES EKSEKUSI (OWASP TOP 10 & ASVS LEVEL 2)
-- ====================================================================
REVOKE ALL ON FUNCTION public.cleanup_old_library_records() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_library_records() TO service_role;

REVOKE ALL ON FUNCTION public.cleanup_all_expired_simas_data() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_all_expired_simas_data() TO service_role;

-- ====================================================================
-- MIGRATION: RETENSI DATA MULTI-TABEL OTOMATIS VIA PG_CRON
-- Database: PostgreSQL Supabase (elrmzlicuuglnoeedusr)
-- Author: SIMAS SMAGESA Development Team
-- Date: 2026-08-15
-- Version: 1.1.313 / [26.08.15.16]
-- ====================================================================

-- 1. AKTIFKAN EKSTENSI PG_CRON
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ====================================================================
-- 2. FUNGSI-FUNGSI PEMBERSIHAN DATA BERKALA (ROLLING DATA RETENTION)
-- ====================================================================

-- A. PRESENSI SISWA (Retensi: 3 Tahun / Masa Studi SMA)
CREATE OR REPLACE FUNCTION public.cleanup_old_siswa_presensi()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_detail INT := 0;
    deleted_header INT := 0;
    cutoff_date DATE;
BEGIN
    cutoff_date := (CURRENT_DATE - INTERVAL '3 years')::DATE;

    DELETE FROM public.siswa_presensi
    WHERE tanggal < cutoff_date;
    GET DIAGNOSTICS deleted_detail = ROW_COUNT;

    DELETE FROM public.siswa_presensi_harian
    WHERE tanggal < cutoff_date;
    GET DIAGNOSTICS deleted_header = ROW_COUNT;

    RETURN jsonb_build_object(
        'module', 'siswa_presensi',
        'status', 'success',
        'cutoff_date', cutoff_date,
        'deleted_detail_rows', deleted_detail,
        'deleted_header_rows', deleted_header,
        'executed_at', NOW()
    );
END;
$$;

-- B. PRESENSI MENGAJAR GURU (Retensi: 3 Tahun)
CREATE OR REPLACE FUNCTION public.cleanup_old_guru_presensi()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_count INT := 0;
    cutoff_date DATE;
BEGIN
    cutoff_date := (CURRENT_DATE - INTERVAL '3 years')::DATE;

    DELETE FROM public.guru_presensi
    WHERE tanggal < cutoff_date;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'module', 'guru_presensi',
        'status', 'success',
        'cutoff_date', cutoff_date,
        'deleted_rows', deleted_count,
        'executed_at', NOW()
    );
END;
$$;

-- C. PEMILIHAN DUTA SHAKTI (Retensi: 6 Bulan)
CREATE OR REPLACE FUNCTION public.cleanup_old_duta_votes()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_votes INT := 0;
    cutoff_timestamp TIMESTAMPTZ;
BEGIN
    cutoff_timestamp := NOW() - INTERVAL '6 months';

    DELETE FROM public.duta_suara_masuk
    WHERE created_at < cutoff_timestamp;
    GET DIAGNOSTICS deleted_votes = ROW_COUNT;

    RETURN jsonb_build_object(
        'module', 'duta_suara_masuk',
        'status', 'success',
        'cutoff_timestamp', cutoff_timestamp,
        'deleted_votes_rows', deleted_votes,
        'executed_at', NOW()
    );
END;
$$;

-- D. KOTAK SARAN & ASPIRASI (Retensi: 1 Tahun untuk status selesai/ditolak, 2 Tahun untuk semua arsip)
CREATE OR REPLACE FUNCTION public.cleanup_old_masukkan_saran()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_resolved INT := 0;
    deleted_archive INT := 0;
    cutoff_resolved TIMESTAMPTZ;
    cutoff_archive TIMESTAMPTZ;
BEGIN
    cutoff_resolved := NOW() - INTERVAL '1 year';
    cutoff_archive := NOW() - INTERVAL '2 years';

    -- 1. Hapus tiket yang sudah berstatus 'selesai' atau 'ditolak' yang berumur > 1 tahun
    DELETE FROM public.masukkan_saran
    WHERE status IN ('selesai', 'ditolak')
      AND created_at < cutoff_resolved;
    GET DIAGNOSTICS deleted_resolved = ROW_COUNT;

    -- 2. Hapus seluruh riwayat saran lama yang berumur > 2 tahun
    DELETE FROM public.masukkan_saran
    WHERE created_at < cutoff_archive;
    GET DIAGNOSTICS deleted_archive = ROW_COUNT;

    RETURN jsonb_build_object(
        'module', 'masukkan_saran',
        'status', 'success',
        'deleted_resolved_rows', deleted_resolved,
        'deleted_archive_rows', deleted_archive,
        'total_deleted_rows', (deleted_resolved + deleted_archive),
        'executed_at', NOW()
    );
END;
$$;

-- E. PORTAL NILAI GURU MAPEL (Retensi: 3 Tahun / Masa Studi SMA)
-- Menghapus gradebooks lama > 3 tahun (Komponen, Nilai Siswa, & Ringkasan otomatis terhapus via ON DELETE CASCADE)
CREATE OR REPLACE FUNCTION public.cleanup_old_guru_mapel_grades()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_gradebooks INT := 0;
    cutoff_timestamp TIMESTAMPTZ;
BEGIN
    cutoff_timestamp := NOW() - INTERVAL '3 years';

    DELETE FROM public.guru_mapel_gradebooks
    WHERE updated_at < cutoff_timestamp;
    GET DIAGNOSTICS deleted_gradebooks = ROW_COUNT;

    RETURN jsonb_build_object(
        'module', 'guru_mapel_grades',
        'status', 'success',
        'cutoff_timestamp', cutoff_timestamp,
        'deleted_gradebooks_rows', deleted_gradebooks,
        'note', 'Child tables (components, scores, summaries) cascaded automatically',
        'executed_at', NOW()
    );
END;
$$;

-- F. KEUANGAN SPP & KAS KOMITE (Retensi: 5 Tahun / Standar Audit Keuangan)
-- Catatan: Tabel tutup buku tahunan `finance_closings` tidak dihapus (disimpan permanen)
CREATE OR REPLACE FUNCTION public.cleanup_old_finance_records()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_tx INT := 0;
    deleted_cashflow INT := 0;
    deleted_daily INT := 0;
    cutoff_timestamp TIMESTAMPTZ;
    cutoff_date_str TEXT;
BEGIN
    cutoff_timestamp := NOW() - INTERVAL '5 years';
    cutoff_date_str := (CURRENT_DATE - INTERVAL '5 years')::TEXT;

    -- 1. Hapus transaksi SPP siswa > 5 tahun
    DELETE FROM public.finance_transactions
    WHERE created_at < cutoff_timestamp
       OR (payment_date IS NOT NULL AND payment_date < cutoff_timestamp);
    GET DIAGNOSTICS deleted_tx = ROW_COUNT;

    -- 2. Hapus mutasi arus kas komite > 5 tahun
    DELETE FROM public.finance_cashflow
    WHERE created_at < cutoff_timestamp;
    GET DIAGNOSTICS deleted_cashflow = ROW_COUNT;

    -- 3. Hapus ringkasan harian SPP > 5 tahun
    DELETE FROM public.finance_daily_summary
    WHERE date_str < cutoff_date_str;
    GET DIAGNOSTICS deleted_daily = ROW_COUNT;

    RETURN jsonb_build_object(
        'module', 'finance',
        'status', 'success',
        'cutoff_timestamp', cutoff_timestamp,
        'deleted_transactions_rows', deleted_tx,
        'deleted_cashflow_rows', deleted_cashflow,
        'deleted_daily_summary_rows', deleted_daily,
        'executed_at', NOW()
    );
END;
$$;

-- G. DANA SOSIAL SUKA DUKA GURU (Retensi: 5 Tahun)
-- Catatan: Tabel master `sukaduka_config` diproteksi (tidak dihapus)
CREATE OR REPLACE FUNCTION public.cleanup_old_sukaduka_records()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_iuran INT := 0;
    deleted_kas INT := 0;
    cutoff_date DATE;
BEGIN
    cutoff_date := (CURRENT_DATE - INTERVAL '5 years')::DATE;

    -- 1. Hapus riwayat iuran > 5 tahun
    DELETE FROM public.sukaduka_iuran
    WHERE tanggal_bayar < cutoff_date;
    GET DIAGNOSTICS deleted_iuran = ROW_COUNT;

    -- 2. Hapus arus kas suka duka > 5 tahun
    DELETE FROM public.sukaduka_kas
    WHERE tanggal < cutoff_date;
    GET DIAGNOSTICS deleted_kas = ROW_COUNT;

    RETURN jsonb_build_object(
        'module', 'sukaduka',
        'status', 'success',
        'cutoff_date', cutoff_date,
        'deleted_iuran_rows', deleted_iuran,
        'deleted_kas_rows', deleted_kas,
        'executed_at', NOW()
    );
END;
$$;

-- ====================================================================
-- 3. MASTER RUNNER FUNCTION (EKSEKUSI SELURUH PEMBERSIHAN SEKALIGUS)
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
BEGIN
    res_siswa := public.cleanup_old_siswa_presensi();
    res_guru := public.cleanup_old_guru_presensi();
    res_duta := public.cleanup_old_duta_votes();
    res_saran := public.cleanup_old_masukkan_saran();
    res_grades := public.cleanup_old_guru_mapel_grades();
    res_finance := public.cleanup_old_finance_records();
    res_sukaduka := public.cleanup_old_sukaduka_records();

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
            'sukaduka', res_sukaduka
        )
    );
END;
$$;

-- ====================================================================
-- 4. DAFTARKAN JADWAL OTOMATIS VIA PG_CRON
-- Berjalan setiap tanggal 1 awal bulan pukul 02:00 - 02:30 WITA (18:00 - 18:30 UTC)
-- Format cron: Minute Hour DayOfMonth Month DayOfWeek
-- ====================================================================

-- 4.1 Hapus jadwal lama jika ada (Idempotent)
DO $$
DECLARE
    job_record RECORD;
BEGIN
    FOR job_record IN 
        SELECT jobname FROM cron.job 
        WHERE jobname IN (
            'auto-cleanup-presensi-siswa-3thn',
            'auto-cleanup-siswa-presensi',
            'auto-cleanup-guru-presensi',
            'auto-cleanup-duta-votes',
            'auto-cleanup-masukkan-saran',
            'auto-cleanup-guru-mapel-grades',
            'auto-cleanup-finance-records',
            'auto-cleanup-sukaduka-records'
        )
    LOOP
        PERFORM cron.unschedule(job_record.jobname);
    END LOOP;
END $$;

-- 4.2 Daftarkan jadwal pembersihan masing-masing tabel (Staggered per 5 menit)
-- 1. Presensi Siswa: Tanggal 1 pukul 02:00 WITA (18:00 UTC)
SELECT cron.schedule(
    'auto-cleanup-siswa-presensi',
    '0 18 1 * *',
    $$SELECT public.cleanup_old_siswa_presensi();$$
);

-- 2. Presensi Guru: Tanggal 1 pukul 02:05 WITA (18:05 UTC)
SELECT cron.schedule(
    'auto-cleanup-guru-presensi',
    '5 18 1 * *',
    $$SELECT public.cleanup_old_guru_presensi();$$
);

-- 3. Suara Duta SHAKTI: Tanggal 1 pukul 02:10 WITA (18:10 UTC) - Retensi 6 Bulan
SELECT cron.schedule(
    'auto-cleanup-duta-votes',
    '10 18 1 * *',
    $$SELECT public.cleanup_old_duta_votes();$$
);

-- 4. Kotak Masukan & Saran: Tanggal 1 pukul 02:15 WITA (18:15 UTC)
SELECT cron.schedule(
    'auto-cleanup-masukkan-saran',
    '15 18 1 * *',
    $$SELECT public.cleanup_old_masukkan_saran();$$
);

-- 5. Portal Nilai Guru Mapel: Tanggal 1 pukul 02:20 WITA (18:20 UTC)
SELECT cron.schedule(
    'auto-cleanup-guru-mapel-grades',
    '20 18 1 * *',
    $$SELECT public.cleanup_old_guru_mapel_grades();$$
);

-- 6. Keuangan SPP & Kas Komite: Tanggal 1 pukul 02:25 WITA (18:25 UTC)
SELECT cron.schedule(
    'auto-cleanup-finance-records',
    '25 18 1 * *',
    $$SELECT public.cleanup_old_finance_records();$$
);

-- 7. Suka Duka Guru: Tanggal 1 pukul 02:30 WITA (18:30 UTC)
SELECT cron.schedule(
    'auto-cleanup-sukaduka-records',
    '30 18 1 * *',
    $$SELECT public.cleanup_old_sukaduka_records();$$
);

-- ====================================================================
-- 5. GRANT PERMISSIONS RPC (Bisa dipanggil manual oleh Admin via Supabase Client)
-- ====================================================================
GRANT EXECUTE ON FUNCTION public.cleanup_old_siswa_presensi() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_guru_presensi() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_duta_votes() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_masukkan_saran() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_guru_mapel_grades() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_finance_records() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_sukaduka_records() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_all_expired_simas_data() TO anon, authenticated, service_role;

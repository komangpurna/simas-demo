-- Migrasi: 202609110002_library_flexible_rules_toggle.sql
-- Tujuan: Memberikan fleksibilitas operasional bagi perpustakaan baru (bebas kuota, bebas durasi, bebas denda, unlimited perpanjangan)

-- 1. Inisialisasi Kunci Konfigurasi Toggle Default (Jika Belum Ada)
INSERT INTO public.lib_config (key, value, keterangan)
VALUES
  ('enable_max_pinjam_siswa', 'true', 'Status aktif pembatasan kuota pinjam siswa (true/false)'),
  ('enable_max_pinjam_guru', 'true', 'Status aktif pembatasan kuota pinjam guru (true/false)'),
  ('enable_durasi_siswa', 'true', 'Status aktif batas durasi pinjam siswa (true/false)'),
  ('enable_durasi_guru', 'true', 'Status aktif batas durasi pinjam guru (true/false)'),
  ('enable_denda', 'true', 'Status aktif pemberlakuan sanksi denda keterlambatan (true/false)'),
  ('enable_max_perpanjangan', 'true', 'Status aktif pembatasan perpanjangan buku (true/false)')
ON CONFLICT (key) DO NOTHING;

-- 2. Update Fungsi: lib_borrow_copy dengan Dukungan Toggle Aturan
CREATE OR REPLACE FUNCTION public.lib_borrow_copy(
  p_eksemplar_id BIGINT,
  p_peminjam_type TEXT,
  p_peminjam_id TEXT,
  p_peminjam_nama TEXT,
  p_peminjam_kelas TEXT,
  p_tgl_pinjam DATE,
  p_tgl_jatuh_tempo DATE,
  p_petugas_uid TEXT
)
RETURNS public.lib_sirkulasi
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  selected_copy public.lib_eksemplar%ROWTYPE;
  selected_book public.lib_buku%ROWTYPE;
  active_count INTEGER;
  max_quota INTEGER;
  quota_enabled BOOLEAN;
  duration_enabled BOOLEAN;
  fine_enabled BOOLEAN;
  fine_rate NUMERIC(10, 2);
  transaction_code TEXT;
  local_today DATE := (NOW() AT TIME ZONE 'Asia/Singapore')::DATE;
  result_row public.lib_sirkulasi%ROWTYPE;
BEGIN
  p_peminjam_type := LOWER(TRIM(COALESCE(p_peminjam_type, '')));
  p_peminjam_id := TRIM(COALESCE(p_peminjam_id, ''));
  p_peminjam_nama := TRIM(COALESCE(p_peminjam_nama, ''));

  IF p_peminjam_type NOT IN ('siswa', 'guru') THEN
    RAISE EXCEPTION 'Tipe peminjam harus siswa atau guru' USING ERRCODE = '22023';
  END IF;

  IF p_peminjam_id = '' OR p_peminjam_nama = '' THEN
    RAISE EXCEPTION 'Identitas peminjam tidak boleh kosong' USING ERRCODE = '22023';
  END IF;

  IF p_tgl_pinjam IS NULL OR p_tgl_pinjam <> local_today THEN
    RAISE EXCEPTION 'Tanggal pinjam harus hari ini' USING ERRCODE = '22007';
  END IF;

  IF p_tgl_jatuh_tempo IS NULL OR p_tgl_jatuh_tempo < p_tgl_pinjam THEN
    RAISE EXCEPTION 'Tanggal jatuh tempo tidak valid' USING ERRCODE = '22007';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_peminjam_type || ':' || p_peminjam_id, 0));

  SELECT * INTO selected_copy
  FROM public.lib_eksemplar
  WHERE id = p_eksemplar_id
  FOR UPDATE;

  IF NOT FOUND OR selected_copy.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Eksemplar tidak ditemukan atau sudah diarsipkan' USING ERRCODE = 'P0002';
  END IF;

  IF selected_copy.status <> 'tersedia' THEN
    RAISE EXCEPTION 'Eksemplar tidak tersedia untuk dipinjam' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO selected_book
  FROM public.lib_buku
  WHERE id = selected_copy.buku_id
  FOR SHARE;

  IF NOT FOUND OR selected_book.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Judul buku sudah diarsipkan' USING ERRCODE = 'P0001';
  END IF;

  IF LOWER(COALESCE(selected_book.tipe_koleksi, 'sirkulasi')) <> 'sirkulasi' THEN
    RAISE EXCEPTION 'Tipe koleksi ini hanya dapat dibaca di perpustakaan' USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*)::INTEGER INTO active_count
  FROM public.lib_sirkulasi
  WHERE peminjam_type = p_peminjam_type
    AND peminjam_id = p_peminjam_id
    AND status = 'dipinjam';

  -- Cek toggle batasan kuota peminjaman
  SELECT COALESCE(value = 'true', TRUE)
  INTO quota_enabled
  FROM public.lib_config
  WHERE key = CASE WHEN p_peminjam_type = 'siswa' THEN 'enable_max_pinjam_siswa' ELSE 'enable_max_pinjam_guru' END;
  quota_enabled := COALESCE(quota_enabled, TRUE);

  IF quota_enabled THEN
    SELECT CASE
      WHEN value ~ '^\d+$' THEN value::INTEGER
      ELSE CASE WHEN p_peminjam_type = 'siswa' THEN 3 ELSE 5 END
    END
    INTO max_quota
    FROM public.lib_config
    WHERE key = CASE WHEN p_peminjam_type = 'siswa' THEN 'max_pinjam_siswa' ELSE 'max_pinjam_guru' END;

    max_quota := COALESCE(max_quota, CASE WHEN p_peminjam_type = 'siswa' THEN 3 ELSE 5 END);

    IF active_count >= max_quota THEN
      RAISE EXCEPTION 'Batas maksimal peminjaman (% buku) telah tercapai', max_quota USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Cek toggle durasi pinjam untuk blokir peminjaman saat ada buku terlambat
  SELECT COALESCE(value = 'true', TRUE)
  INTO duration_enabled
  FROM public.lib_config
  WHERE key = CASE WHEN p_peminjam_type = 'siswa' THEN 'enable_durasi_siswa' ELSE 'enable_durasi_guru' END;
  duration_enabled := COALESCE(duration_enabled, TRUE);

  IF duration_enabled AND EXISTS (
    SELECT 1
    FROM public.lib_sirkulasi
    WHERE peminjam_type = p_peminjam_type
      AND peminjam_id = p_peminjam_id
      AND status = 'dipinjam'
      AND tgl_jatuh_tempo < local_today
  ) THEN
    RAISE EXCEPTION 'Peminjam memiliki buku terlambat yang harus diselesaikan terlebih dahulu' USING ERRCODE = 'P0001';
  END IF;

  -- Cek toggle denda keterlambatan
  SELECT COALESCE(value = 'true', TRUE)
  INTO fine_enabled
  FROM public.lib_config
  WHERE key = 'enable_denda';
  fine_enabled := COALESCE(fine_enabled, TRUE);

  IF fine_enabled THEN
    SELECT CASE WHEN value ~ '^\d+(\.\d+)?$' THEN value::NUMERIC ELSE 1000 END
    INTO fine_rate
    FROM public.lib_config
    WHERE key = 'tarif_denda_per_hari';
    fine_rate := COALESCE(fine_rate, 1000);
  ELSE
    fine_rate := 0;
  END IF;

  transaction_code := 'PINJ-' || TO_CHAR(p_tgl_pinjam, 'YYYYMMDD') || '-'
    || UPPER(SUBSTRING(MD5(CLOCK_TIMESTAMP()::TEXT || RANDOM()::TEXT || p_eksemplar_id::TEXT), 1, 12));

  INSERT INTO public.lib_sirkulasi (
    kode_transaksi, eksemplar_id, buku_id,
    peminjam_type, peminjam_id, peminjam_nama, peminjam_kelas,
    tgl_pinjam, tgl_jatuh_tempo, status,
    tarif_denda_per_hari, petugas_pinjam_uid
  ) VALUES (
    transaction_code, selected_copy.id, selected_copy.buku_id,
    p_peminjam_type, p_peminjam_id, p_peminjam_nama, NULLIF(TRIM(p_peminjam_kelas), ''),
    p_tgl_pinjam, p_tgl_jatuh_tempo, 'dipinjam',
    fine_rate, NULLIF(TRIM(p_petugas_uid), '')
  )
  RETURNING * INTO result_row;

  UPDATE public.lib_eksemplar
  SET status = 'dipinjam', updated_at = NOW()
  WHERE id = selected_copy.id;

  RETURN result_row;
END;
$$;

-- 3. Update Fungsi: lib_return_copy dengan Dukungan Toggle Bebas Denda
CREATE OR REPLACE FUNCTION public.lib_return_copy(
  p_sirkulasi_id BIGINT,
  p_tgl_kembali DATE,
  p_kondisi TEXT,
  p_petugas_uid TEXT
)
RETURNS public.lib_sirkulasi
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  circulation public.lib_sirkulasi%ROWTYPE;
  ignore_holidays BOOLEAN;
  fine_enabled BOOLEAN;
  late_days INTEGER;
  total_fine NUMERIC(12, 2);
  copy_status TEXT;
  local_today DATE := (NOW() AT TIME ZONE 'Asia/Singapore')::DATE;
  result_row public.lib_sirkulasi%ROWTYPE;
BEGIN
  p_kondisi := LOWER(TRIM(COALESCE(p_kondisi, 'baik')));
  IF p_kondisi NOT IN ('baik', 'rusak_ringan', 'rusak_berat', 'hilang') THEN
    RAISE EXCEPTION 'Kondisi pengembalian tidak valid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO circulation
  FROM public.lib_sirkulasi
  WHERE id = p_sirkulasi_id
  FOR UPDATE;

  IF NOT FOUND OR circulation.status <> 'dipinjam' THEN
    RAISE EXCEPTION 'Transaksi tidak ditemukan atau buku sudah dikembalikan' USING ERRCODE = 'P0001';
  END IF;

  IF p_tgl_kembali IS NULL OR p_tgl_kembali <> local_today OR p_tgl_kembali < circulation.tgl_pinjam THEN
    RAISE EXCEPTION 'Tanggal pengembalian tidak valid' USING ERRCODE = '22007';
  END IF;

  SELECT COALESCE(value = 'true', TRUE)
  INTO ignore_holidays
  FROM public.lib_config
  WHERE key = 'abaikan_hari_libur';
  ignore_holidays := COALESCE(ignore_holidays, TRUE);

  SELECT COALESCE(value = 'true', TRUE)
  INTO fine_enabled
  FROM public.lib_config
  WHERE key = 'enable_denda';
  fine_enabled := COALESCE(fine_enabled, TRUE);

  late_days := public.lib_count_chargeable_days(
    circulation.tgl_jatuh_tempo,
    p_tgl_kembali,
    ignore_holidays
  );

  IF fine_enabled THEN
    total_fine := late_days * COALESCE(circulation.tarif_denda_per_hari, 0);
  ELSE
    total_fine := 0;
  END IF;

  copy_status := CASE WHEN p_kondisi IN ('rusak_berat', 'hilang') THEN p_kondisi ELSE 'tersedia' END;

  UPDATE public.lib_sirkulasi
  SET
    tgl_kembali = p_tgl_kembali,
    status = 'kembali',
    hari_terlambat = late_days,
    total_denda = total_fine,
    status_denda = CASE WHEN total_fine > 0 THEN 'belum_lunas' ELSE 'bebas_denda' END,
    kondisi_kembali = p_kondisi,
    petugas_kembali_uid = NULLIF(TRIM(p_petugas_uid), ''),
    updated_at = NOW()
  WHERE id = circulation.id
  RETURNING * INTO result_row;

  UPDATE public.lib_eksemplar
  SET status = copy_status, kondisi = p_kondisi, updated_at = NOW()
  WHERE id = circulation.eksemplar_id;

  RETURN result_row;
END;
$$;

-- 4. Update Fungsi: lib_extend_loan dengan Dukungan Toggle Perpanjangan & Durasi
CREATE OR REPLACE FUNCTION public.lib_extend_loan(
  p_sirkulasi_id BIGINT,
  p_petugas_uid TEXT
)
RETURNS public.lib_sirkulasi
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  circulation public.lib_sirkulasi%ROWTYPE;
  max_extensions INTEGER;
  max_ext_enabled BOOLEAN;
  duration_days INTEGER;
  duration_enabled BOOLEAN;
  ignore_holidays BOOLEAN;
  local_today DATE := (NOW() AT TIME ZONE 'Asia/Singapore')::DATE;
  result_row public.lib_sirkulasi%ROWTYPE;
BEGIN
  SELECT * INTO circulation
  FROM public.lib_sirkulasi
  WHERE id = p_sirkulasi_id
  FOR UPDATE;

  IF NOT FOUND OR circulation.status <> 'dipinjam' THEN
    RAISE EXCEPTION 'Transaksi tidak ditemukan atau sudah selesai' USING ERRCODE = 'P0001';
  END IF;

  -- Cek toggle durasi pinjam untuk perpanjangan buku terlambat
  SELECT COALESCE(value = 'true', TRUE)
  INTO duration_enabled
  FROM public.lib_config
  WHERE key = CASE WHEN circulation.peminjam_type = 'siswa' THEN 'enable_durasi_siswa' ELSE 'enable_durasi_guru' END;
  duration_enabled := COALESCE(duration_enabled, TRUE);

  IF duration_enabled AND circulation.tgl_jatuh_tempo < local_today THEN
    RAISE EXCEPTION 'Buku yang sudah terlambat tidak dapat diperpanjang' USING ERRCODE = 'P0001';
  END IF;

  -- Cek toggle batas maksimal perpanjangan
  SELECT COALESCE(value = 'true', TRUE)
  INTO max_ext_enabled
  FROM public.lib_config WHERE key = 'enable_max_perpanjangan';
  max_ext_enabled := COALESCE(max_ext_enabled, TRUE);

  IF max_ext_enabled THEN
    SELECT CASE WHEN value ~ '^\d+$' THEN value::INTEGER ELSE 1 END
    INTO max_extensions FROM public.lib_config WHERE key = 'max_perpanjangan';
    max_extensions := COALESCE(max_extensions, 1);

    IF circulation.perpanjangan_ke >= max_extensions THEN
      RAISE EXCEPTION 'Batas maksimal perpanjangan (% kali) telah tercapai', max_extensions USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT CASE WHEN value ~ '^\d+$' THEN value::INTEGER ELSE 7 END
  INTO duration_days
  FROM public.lib_config
  WHERE key = CASE
    WHEN circulation.peminjam_type = 'siswa' THEN 'durasi_pinjam_siswa_hari'
    ELSE 'durasi_pinjam_guru_hari'
  END;
  duration_days := COALESCE(duration_days, CASE WHEN circulation.peminjam_type = 'siswa' THEN 7 ELSE 14 END);

  SELECT COALESCE(value = 'true', TRUE)
  INTO ignore_holidays FROM public.lib_config WHERE key = 'abaikan_hari_libur';
  ignore_holidays := COALESCE(ignore_holidays, TRUE);

  UPDATE public.lib_sirkulasi
  SET
    tgl_jatuh_tempo = public.lib_add_loan_days(circulation.tgl_jatuh_tempo, duration_days, ignore_holidays),
    perpanjangan_ke = circulation.perpanjangan_ke + 1,
    updated_at = NOW()
  WHERE id = circulation.id
  RETURNING * INTO result_row;

  RETURN result_row;
END;
$$;

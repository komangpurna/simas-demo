-- =====================================================================
-- HARDENING MODUL PERPUSTAKAAN
-- - transaksi sirkulasi atomik
-- - riwayat tidak terhapus lewat cascade
-- - stok diturunkan dari eksemplar melalui trigger
-- - constraint integritas dan katalog publik terbatas
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.lib_hari_libur (
  tanggal DATE PRIMARY KEY,
  nama VARCHAR(150) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.lib_hari_libur ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.lib_buku
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by VARCHAR(100);

ALTER TABLE public.lib_eksemplar
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by VARCHAR(100);

ALTER TABLE public.lib_sirkulasi
  ADD COLUMN IF NOT EXISTS denda_lunas_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS denda_lunas_by VARCHAR(100);

-- Riwayat transaksi adalah data audit. Judul/eksemplar yang pernah dipakai
-- tidak boleh menghapus transaksi secara tidak sengaja.
ALTER TABLE public.lib_eksemplar
  DROP CONSTRAINT IF EXISTS lib_eksemplar_buku_id_fkey,
  ADD CONSTRAINT lib_eksemplar_buku_id_fkey
    FOREIGN KEY (buku_id) REFERENCES public.lib_buku(id) ON DELETE RESTRICT;

ALTER TABLE public.lib_sirkulasi
  DROP CONSTRAINT IF EXISTS lib_sirkulasi_eksemplar_id_fkey,
  DROP CONSTRAINT IF EXISTS lib_sirkulasi_buku_id_fkey,
  ADD CONSTRAINT lib_sirkulasi_eksemplar_id_fkey
    FOREIGN KEY (eksemplar_id) REFERENCES public.lib_eksemplar(id) ON DELETE RESTRICT,
  ADD CONSTRAINT lib_sirkulasi_buku_id_fkey
    FOREIGN KEY (buku_id) REFERENCES public.lib_buku(id) ON DELETE RESTRICT;

-- NOT VALID menjaga migrasi tetap aman terhadap data historis lama, tetapi
-- constraint langsung berlaku untuk insert/update baru.
ALTER TABLE public.lib_buku
  DROP CONSTRAINT IF EXISTS chk_lib_buku_stock_nonnegative,
  DROP CONSTRAINT IF EXISTS chk_lib_buku_available_not_above_total,
  DROP CONSTRAINT IF EXISTS chk_lib_buku_year,
  ADD CONSTRAINT chk_lib_buku_stock_nonnegative
    CHECK (total_eksemplar >= 0 AND eksemplar_tersedia >= 0) NOT VALID,
  ADD CONSTRAINT chk_lib_buku_available_not_above_total
    CHECK (eksemplar_tersedia <= total_eksemplar) NOT VALID,
  ADD CONSTRAINT chk_lib_buku_year
    CHECK (tahun_terbit IS NULL OR tahun_terbit BETWEEN 1000 AND 2200) NOT VALID;

ALTER TABLE public.lib_eksemplar
  DROP CONSTRAINT IF EXISTS chk_lib_eksemplar_copy_number,
  DROP CONSTRAINT IF EXISTS chk_lib_eksemplar_price,
  DROP CONSTRAINT IF EXISTS chk_lib_eksemplar_status,
  DROP CONSTRAINT IF EXISTS chk_lib_eksemplar_condition,
  ADD CONSTRAINT chk_lib_eksemplar_copy_number
    CHECK (copy_number > 0) NOT VALID,
  ADD CONSTRAINT chk_lib_eksemplar_price
    CHECK (harga >= 0) NOT VALID,
  ADD CONSTRAINT chk_lib_eksemplar_status
    CHECK (status IN ('tersedia', 'dipinjam', 'rusak_berat', 'hilang')) NOT VALID,
  ADD CONSTRAINT chk_lib_eksemplar_condition
    CHECK (kondisi IN ('baik', 'rusak_ringan', 'rusak_berat', 'hilang')) NOT VALID;

ALTER TABLE public.lib_sirkulasi
  DROP CONSTRAINT IF EXISTS chk_lib_sirkulasi_type,
  DROP CONSTRAINT IF EXISTS chk_lib_sirkulasi_status,
  DROP CONSTRAINT IF EXISTS chk_lib_sirkulasi_fine_status,
  DROP CONSTRAINT IF EXISTS chk_lib_sirkulasi_dates,
  DROP CONSTRAINT IF EXISTS chk_lib_sirkulasi_nonnegative,
  ADD CONSTRAINT chk_lib_sirkulasi_type
    CHECK (peminjam_type IN ('siswa', 'guru')) NOT VALID,
  ADD CONSTRAINT chk_lib_sirkulasi_status
    CHECK (status IN ('dipinjam', 'kembali')) NOT VALID,
  ADD CONSTRAINT chk_lib_sirkulasi_fine_status
    CHECK (status_denda IN ('bebas_denda', 'belum_lunas', 'lunas')) NOT VALID,
  ADD CONSTRAINT chk_lib_sirkulasi_dates
    CHECK (
      tgl_jatuh_tempo >= tgl_pinjam
      AND (tgl_kembali IS NULL OR tgl_kembali >= tgl_pinjam)
    ) NOT VALID,
  ADD CONSTRAINT chk_lib_sirkulasi_nonnegative
    CHECK (
      perpanjangan_ke >= 0
      AND hari_terlambat >= 0
      AND tarif_denda_per_hari >= 0
      AND total_denda >= 0
    ) NOT VALID;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.lib_sirkulasi
    WHERE status = 'dipinjam'
    GROUP BY eksemplar_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Migrasi perpustakaan dihentikan: terdapat eksemplar dengan lebih dari satu pinjaman aktif. Selesaikan duplikat sebelum menjalankan ulang.';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_lib_sirkulasi_one_active_copy
  ON public.lib_sirkulasi(eksemplar_id)
  WHERE status = 'dipinjam';

CREATE UNIQUE INDEX IF NOT EXISTS uq_lib_eksemplar_active_copy_number
  ON public.lib_eksemplar(buku_id, copy_number)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_lib_buku_active
  ON public.lib_buku(id) WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_lib_eksemplar_active_book
  ON public.lib_eksemplar(buku_id, status) WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_lib_sirkulasi_active_borrower
  ON public.lib_sirkulasi(peminjam_type, peminjam_id, tgl_jatuh_tempo)
  WHERE status = 'dipinjam';

CREATE OR REPLACE FUNCTION public.refresh_lib_buku_stock(p_buku_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_buku_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.lib_buku AS book
  SET
    total_eksemplar = stock.total_count,
    eksemplar_tersedia = stock.available_count,
    updated_at = NOW()
  FROM (
    SELECT
      COUNT(*)::INTEGER AS total_count,
      COUNT(*) FILTER (WHERE status = 'tersedia')::INTEGER AS available_count
    FROM public.lib_eksemplar
    WHERE buku_id = p_buku_id
      AND archived_at IS NULL
  ) AS stock
  WHERE book.id = p_buku_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_refresh_lib_buku_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_lib_buku_stock(OLD.buku_id);
    RETURN OLD;
  END IF;

  PERFORM public.refresh_lib_buku_stock(NEW.buku_id);
  IF TG_OP = 'UPDATE' AND OLD.buku_id IS DISTINCT FROM NEW.buku_id THEN
    PERFORM public.refresh_lib_buku_stock(OLD.buku_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lib_eksemplar_refresh_stock ON public.lib_eksemplar;
CREATE TRIGGER trg_lib_eksemplar_refresh_stock
AFTER INSERT OR DELETE OR UPDATE OF buku_id, status, archived_at
ON public.lib_eksemplar
FOR EACH ROW
EXECUTE FUNCTION public.trg_refresh_lib_buku_stock();

DO $$
DECLARE
  target_book RECORD;
BEGIN
  FOR target_book IN SELECT id FROM public.lib_buku LOOP
    PERFORM public.refresh_lib_buku_stock(target_book.id);
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.lib_count_chargeable_days(
  p_start_exclusive DATE,
  p_end_inclusive DATE,
  p_ignore_holidays BOOLEAN
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_start_exclusive IS NULL
      OR p_end_inclusive IS NULL
      OR p_end_inclusive <= p_start_exclusive THEN 0
    ELSE COUNT(*)::INTEGER
  END
  FROM generate_series(
    p_start_exclusive + 1,
    GREATEST(p_start_exclusive, p_end_inclusive),
    INTERVAL '1 day'
  ) AS day_value
  WHERE NOT p_ignore_holidays
     OR (
       EXTRACT(ISODOW FROM day_value) BETWEEN 1 AND 5
       AND NOT EXISTS (
         SELECT 1
         FROM public.lib_hari_libur holiday
         WHERE holiday.tanggal = day_value::DATE
       )
     );
$$;

CREATE OR REPLACE FUNCTION public.lib_add_loan_days(
  p_start_date DATE,
  p_days INTEGER,
  p_ignore_holidays BOOLEAN
)
RETURNS DATE
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  result_date DATE := p_start_date;
  added_days INTEGER := 0;
BEGIN
  IF p_start_date IS NULL OR p_days IS NULL OR p_days < 1 THEN
    RAISE EXCEPTION 'Tanggal awal dan jumlah hari pinjam harus valid' USING ERRCODE = '22023';
  END IF;

  WHILE added_days < p_days LOOP
    result_date := result_date + 1;
    IF NOT p_ignore_holidays OR (
      EXTRACT(ISODOW FROM result_date) BETWEEN 1 AND 5
      AND NOT EXISTS (
        SELECT 1 FROM public.lib_hari_libur holiday WHERE holiday.tanggal = result_date
      )
    ) THEN
      added_days := added_days + 1;
    END IF;
  END LOOP;

  RETURN result_date;
END;
$$;

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
  fine_rate NUMERIC(10, 2);
  transaction_code TEXT;
  local_today DATE := (NOW() AT TIME ZONE 'Asia/Singapore')::DATE;
  result_row public.lib_sirkulasi%ROWTYPE;
BEGIN
  p_peminjam_type := LOWER(TRIM(COALESCE(p_peminjam_type, '')));
  p_peminjam_id := TRIM(COALESCE(p_peminjam_id, ''));
  p_peminjam_nama := TRIM(COALESCE(p_peminjam_nama, ''));

  IF p_peminjam_type NOT IN ('siswa', 'guru')
    OR p_peminjam_id = ''
    OR p_peminjam_nama = '' THEN
    RAISE EXCEPTION 'Identitas peminjam tidak valid' USING ERRCODE = '22023';
  END IF;

  IF p_tgl_pinjam IS NULL OR p_tgl_jatuh_tempo IS NULL OR p_tgl_jatuh_tempo < p_tgl_pinjam THEN
    RAISE EXCEPTION 'Tanggal peminjaman atau jatuh tempo tidak valid' USING ERRCODE = '22007';
  END IF;

  -- Serialisasi seluruh peminjaman untuk peminjam yang sama agar kuota tidak
  -- dapat ditembus oleh dua perangkat secara bersamaan.
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

  IF EXISTS (
    SELECT 1
    FROM public.lib_sirkulasi
    WHERE peminjam_type = p_peminjam_type
      AND peminjam_id = p_peminjam_id
      AND status = 'dipinjam'
      AND tgl_jatuh_tempo < local_today
  ) THEN
    RAISE EXCEPTION 'Peminjam memiliki buku terlambat yang harus diselesaikan terlebih dahulu' USING ERRCODE = 'P0001';
  END IF;

  SELECT CASE WHEN value ~ '^\d+(\.\d+)?$' THEN value::NUMERIC ELSE 1000 END
  INTO fine_rate
  FROM public.lib_config
  WHERE key = 'tarif_denda_per_hari';
  fine_rate := COALESCE(fine_rate, 1000);

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

  late_days := public.lib_count_chargeable_days(
    circulation.tgl_jatuh_tempo,
    p_tgl_kembali,
    ignore_holidays
  );
  total_fine := late_days * COALESCE(circulation.tarif_denda_per_hari, 0);
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
  duration_days INTEGER;
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

  IF circulation.tgl_jatuh_tempo < local_today THEN
    RAISE EXCEPTION 'Buku yang sudah terlambat tidak dapat diperpanjang' USING ERRCODE = 'P0001';
  END IF;

  SELECT CASE WHEN value ~ '^\d+$' THEN value::INTEGER ELSE 1 END
  INTO max_extensions FROM public.lib_config WHERE key = 'max_perpanjangan';
  max_extensions := COALESCE(max_extensions, 1);

  IF circulation.perpanjangan_ke >= max_extensions THEN
    RAISE EXCEPTION 'Batas maksimal perpanjangan (% kali) telah tercapai', max_extensions USING ERRCODE = 'P0001';
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

CREATE OR REPLACE FUNCTION public.lib_archive_book(
  p_buku_id BIGINT,
  p_petugas_uid TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM 1 FROM public.lib_buku WHERE id = p_buku_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Judul buku tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.lib_sirkulasi
    WHERE buku_id = p_buku_id AND status = 'dipinjam'
  ) THEN
    RAISE EXCEPTION 'Judul masih memiliki eksemplar yang sedang dipinjam' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.lib_eksemplar
  SET archived_at = NOW(), archived_by = NULLIF(TRIM(p_petugas_uid), ''), updated_at = NOW()
  WHERE buku_id = p_buku_id AND archived_at IS NULL;

  UPDATE public.lib_buku
  SET archived_at = NOW(), archived_by = NULLIF(TRIM(p_petugas_uid), ''), updated_at = NOW()
  WHERE id = p_buku_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.lib_archive_copy(
  p_eksemplar_id BIGINT,
  p_petugas_uid TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  copy_row public.lib_eksemplar%ROWTYPE;
BEGIN
  SELECT * INTO copy_row
  FROM public.lib_eksemplar
  WHERE id = p_eksemplar_id
  FOR UPDATE;

  IF NOT FOUND OR copy_row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Eksemplar tidak ditemukan atau sudah diarsipkan' USING ERRCODE = 'P0002';
  END IF;

  IF copy_row.status = 'dipinjam' OR EXISTS (
    SELECT 1 FROM public.lib_sirkulasi
    WHERE eksemplar_id = copy_row.id AND status = 'dipinjam'
  ) THEN
    RAISE EXCEPTION 'Eksemplar sedang dipinjam dan tidak dapat diarsipkan' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.lib_eksemplar
  SET archived_at = NOW(), archived_by = NULLIF(TRIM(p_petugas_uid), ''), updated_at = NOW()
  WHERE id = copy_row.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.lib_settle_fine(
  p_sirkulasi_id BIGINT,
  p_petugas_uid TEXT
)
RETURNS public.lib_sirkulasi
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result_row public.lib_sirkulasi%ROWTYPE;
BEGIN
  UPDATE public.lib_sirkulasi
  SET
    status_denda = 'lunas',
    denda_lunas_at = NOW(),
    denda_lunas_by = NULLIF(TRIM(p_petugas_uid), ''),
    updated_at = NOW()
  WHERE id = p_sirkulasi_id
    AND status = 'kembali'
    AND total_denda > 0
    AND status_denda = 'belum_lunas'
  RETURNING * INTO result_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Denda tidak ditemukan, belum dapat dilunasi, atau sudah lunas' USING ERRCODE = 'P0001';
  END IF;
  RETURN result_row;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_lib_buku_stock(BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lib_borrow_copy(BIGINT, TEXT, TEXT, TEXT, TEXT, DATE, DATE, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lib_return_copy(BIGINT, DATE, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lib_extend_loan(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lib_archive_book(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lib_archive_copy(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lib_settle_fine(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_refresh_lib_buku_stock() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.refresh_lib_buku_stock(BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.lib_borrow_copy(BIGINT, TEXT, TEXT, TEXT, TEXT, DATE, DATE, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.lib_return_copy(BIGINT, DATE, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.lib_extend_loan(BIGINT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.lib_archive_book(BIGINT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.lib_archive_copy(BIGINT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.lib_settle_fine(BIGINT, TEXT) TO service_role;

-- Tabel dasar menyimpan metadata internal. OPAC hanya mendapat view dengan
-- kolom yang memang dibutuhkan pengguna.
DROP POLICY IF EXISTS "Secure public read library books" ON public.lib_buku;
DROP POLICY IF EXISTS "Secure public read library copies" ON public.lib_eksemplar;
DROP POLICY IF EXISTS "Allow public read on lib_buku" ON public.lib_buku;
DROP POLICY IF EXISTS "Allow public read on lib_eksemplar" ON public.lib_eksemplar;
DROP POLICY IF EXISTS "Allow all modify on lib_buku" ON public.lib_buku;
DROP POLICY IF EXISTS "Allow all modify on lib_eksemplar" ON public.lib_eksemplar;
DROP POLICY IF EXISTS "Allow public read on lib_sirkulasi" ON public.lib_sirkulasi;
DROP POLICY IF EXISTS "Allow all modify on lib_sirkulasi" ON public.lib_sirkulasi;
DROP POLICY IF EXISTS "Allow public read on lib_pengunjung" ON public.lib_pengunjung;
DROP POLICY IF EXISTS "Allow all modify on lib_pengunjung" ON public.lib_pengunjung;
DROP POLICY IF EXISTS "Allow public read on lib_bebas_pustaka" ON public.lib_bebas_pustaka;
DROP POLICY IF EXISTS "Allow all modify on lib_bebas_pustaka" ON public.lib_bebas_pustaka;
DROP POLICY IF EXISTS "Allow all modify on lib_config" ON public.lib_config;
DROP POLICY IF EXISTS "Allow all modify on lib_kategori_ddc" ON public.lib_kategori_ddc;

CREATE OR REPLACE VIEW public.lib_opac_buku
WITH (security_barrier = true)
AS
SELECT
  book.id,
  book.judul,
  book.pengarang,
  book.pengarang_tambahan,
  book.penerbit,
  book.tahun_terbit,
  book.kota_terbit,
  book.isbn,
  book.issn,
  book.bahasa,
  book.kategori_ddc,
  ddc.nama AS ddc_nama,
  book.call_number_dasar,
  book.lokasi_rak,
  book.deskripsi_fisik,
  book.subjek,
  book.tipe_koleksi,
  book.total_eksemplar,
  book.eksemplar_tersedia,
  book.cover_url
FROM public.lib_buku book
LEFT JOIN public.lib_kategori_ddc ddc ON ddc.kode = book.kategori_ddc
WHERE book.archived_at IS NULL;

CREATE OR REPLACE VIEW public.lib_opac_eksemplar
WITH (security_barrier = true)
AS
SELECT
  copy.buku_id,
  copy.copy_number,
  copy.call_number_lengkap,
  copy.status,
  copy.kondisi,
  (
    SELECT circulation.tgl_jatuh_tempo
    FROM public.lib_sirkulasi circulation
    WHERE circulation.eksemplar_id = copy.id
      AND circulation.status = 'dipinjam'
    ORDER BY circulation.created_at DESC
    LIMIT 1
  ) AS tgl_jatuh_tempo
FROM public.lib_eksemplar copy
WHERE copy.archived_at IS NULL;

CREATE OR REPLACE VIEW public.lib_opac_hari_libur
WITH (security_barrier = true)
AS
SELECT tanggal
FROM public.lib_hari_libur;

REVOKE ALL ON
  public.lib_buku,
  public.lib_eksemplar,
  public.lib_sirkulasi,
  public.lib_pengunjung,
  public.lib_bebas_pustaka,
  public.lib_hari_libur
FROM anon, authenticated;
GRANT SELECT ON public.lib_opac_buku, public.lib_opac_eksemplar, public.lib_opac_hari_libur TO anon, authenticated;

COMMENT ON VIEW public.lib_opac_buku IS
  'Metadata bibliografi publik tanpa catatan internal, pembuat, atau status arsip.';
COMMENT ON VIEW public.lib_opac_eksemplar IS
  'Status salinan publik tanpa barcode, nomor inventaris, harga, atau sumber pengadaan.';
COMMENT ON VIEW public.lib_opac_hari_libur IS
  'Tanggal libur yang dipakai OPAC untuk menampilkan estimasi denda secara konsisten.';

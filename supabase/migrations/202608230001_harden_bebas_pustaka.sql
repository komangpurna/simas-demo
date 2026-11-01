-- Harden status bebas pustaka: semua akses kini melalui secure-proxy yang
-- memverifikasi Firebase ID token dan role pengguna. Service role tetap bypass RLS.

DROP POLICY IF EXISTS "Allow public read on lib_bebas_pustaka" ON lib_bebas_pustaka;
DROP POLICY IF EXISTS "Allow all modify on lib_bebas_pustaka" ON lib_bebas_pustaka;

-- student_nis merepresentasikan satu status aktif. Bersihkan duplikat lama
-- secara deterministik (pertahankan record terbaru) sebelum membuat constraint.
WITH ranked_clearances AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY student_nis
      ORDER BY created_at DESC NULLS LAST, id DESC
    ) AS row_number
  FROM lib_bebas_pustaka
)
DELETE FROM lib_bebas_pustaka AS clearance
USING ranked_clearances AS ranked
WHERE clearance.id = ranked.id
  AND ranked.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_lib_bebas_pustaka_student_nis
  ON lib_bebas_pustaka(student_nis);

-- Status lama yang sudah bertentangan dengan data sirkulasi tidak boleh tetap
-- dianggap sah oleh portal. Penerbitan ulang dapat dilakukan setelah tanggungan
-- diselesaikan.
DELETE FROM lib_bebas_pustaka AS clearance
WHERE EXISTS (
  SELECT 1
  FROM lib_sirkulasi AS circulation
  WHERE circulation.peminjam_id = clearance.student_nis
    AND (
      LOWER(COALESCE(circulation.status, '')) = 'dipinjam'
      OR LOWER(COALESCE(circulation.status_denda, '')) = 'belum_lunas'
    )
);

-- Kunci advisory yang sama dipakai oleh kedua tabel agar penerbitan clearance
-- dan perubahan sirkulasi untuk satu NIS tidak lolos bersamaan (TOCTOU/race).
CREATE OR REPLACE FUNCTION enforce_clearance_has_no_library_burden()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.student_nis, 0));

  IF EXISTS (
    SELECT 1
    FROM lib_sirkulasi AS circulation
    WHERE circulation.peminjam_id = NEW.student_nis
      AND (
        LOWER(COALESCE(circulation.status, '')) = 'dipinjam'
        OR LOWER(COALESCE(circulation.status_denda, '')) = 'belum_lunas'
      )
  ) THEN
    RAISE EXCEPTION 'Siswa % masih memiliki pinjaman aktif atau denda belum lunas', NEW.student_nis
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_clearance_has_no_burden ON lib_bebas_pustaka;
CREATE TRIGGER trg_enforce_clearance_has_no_burden
BEFORE INSERT OR UPDATE OF student_nis, status_verifikasi
ON lib_bebas_pustaka
FOR EACH ROW
EXECUTE FUNCTION enforce_clearance_has_no_library_burden();

CREATE OR REPLACE FUNCTION prevent_library_burden_after_clearance()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.peminjam_id, 0));

  IF (
    LOWER(COALESCE(NEW.status, '')) = 'dipinjam'
    OR LOWER(COALESCE(NEW.status_denda, '')) = 'belum_lunas'
  ) AND EXISTS (
    SELECT 1
    FROM lib_bebas_pustaka AS clearance
    WHERE clearance.student_nis = NEW.peminjam_id
      AND LOWER(COALESCE(clearance.status_verifikasi, 'disetujui')) = 'disetujui'
  ) THEN
    RAISE EXCEPTION 'Status bebas pustaka siswa % harus dicabut sebelum membuat tanggungan baru', NEW.peminjam_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_burden_after_clearance ON lib_sirkulasi;
CREATE TRIGGER trg_prevent_burden_after_clearance
BEFORE INSERT OR UPDATE OF peminjam_id, status, status_denda
ON lib_sirkulasi
FOR EACH ROW
EXECUTE FUNCTION prevent_library_burden_after_clearance();

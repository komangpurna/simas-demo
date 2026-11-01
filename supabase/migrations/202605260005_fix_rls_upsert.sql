-- supabase/migrations/202605260005_fix_rls_upsert.sql
-- Memperbaiki RLS Policy agar operasi UPSERT (INSERT + UPDATE) berfungsi
-- untuk tabel duta_suara_masuk dari klien anonim (anon key).
-- 
-- Masalah: Upsert memerlukan policy UPDATE selain INSERT.
-- Solusi : Tambahkan policy UPDATE dan pastikan policy SELECT/INSERT tetap ada.

-- 1. Drop policy lama agar tidak duplikasi
DROP POLICY IF EXISTS "Allow anonymous insert votes"  ON duta_suara_masuk;
DROP POLICY IF EXISTS "Allow anonymous read votes"    ON duta_suara_masuk;
DROP POLICY IF EXISTS "Allow anonymous update votes"  ON duta_suara_masuk;
DROP POLICY IF EXISTS "Allow anonymous delete votes"  ON duta_suara_masuk;

-- 2. Buat ulang semua policy yang diperlukan untuk operasi voting
-- SELECT: Semua pengguna boleh membaca data suara (untuk statistik)
CREATE POLICY "Allow anonymous read votes"
    ON duta_suara_masuk FOR SELECT
    USING (true);

-- INSERT: Semua pengguna boleh mengirim suara baru
CREATE POLICY "Allow anonymous insert votes"
    ON duta_suara_masuk FOR INSERT
    WITH CHECK (true);

-- UPDATE: Diperlukan oleh operasi UPSERT saat siswa mengganti pilihan
CREATE POLICY "Allow anonymous update votes"
    ON duta_suara_masuk FOR UPDATE
    USING (true)
    WITH CHECK (true);

-- 3. Pastikan juga tabel duta_kandidat punya policy CRUD lengkap untuk admin
DROP POLICY IF EXISTS "Allow anonymous read candidates"   ON duta_kandidat;
DROP POLICY IF EXISTS "Allow anonymous insert candidates"  ON duta_kandidat;
DROP POLICY IF EXISTS "Allow anonymous update candidates"  ON duta_kandidat;
DROP POLICY IF EXISTS "Allow anonymous delete candidates"  ON duta_kandidat;

CREATE POLICY "Allow anonymous read candidates"
    ON duta_kandidat FOR SELECT USING (true);

CREATE POLICY "Allow anonymous insert candidates"
    ON duta_kandidat FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow anonymous update candidates"
    ON duta_kandidat FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "Allow anonymous delete candidates"
    ON duta_kandidat FOR DELETE USING (true);

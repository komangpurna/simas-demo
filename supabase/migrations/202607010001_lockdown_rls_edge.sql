-- supabase/migrations/202607010001_lockdown_rls_edge.sql
-- Mengunci rapat semua akses tulis (INSERT, UPDATE, DELETE) untuk klien anonim (anon key)
-- Semua perubahan data sensitif dialihkan melalui Supabase Edge Functions (service_role)

-- =========================================================================
-- 1. LOCKDOWN TABEL duta_kandidat
-- =========================================================================
ALTER TABLE duta_kandidat ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anonymous read candidates"   ON duta_kandidat;
DROP POLICY IF EXISTS "Allow anonymous insert candidates"  ON duta_kandidat;
DROP POLICY IF EXISTS "Allow anonymous update candidates"  ON duta_kandidat;
DROP POLICY IF EXISTS "Allow anonymous delete candidates"  ON duta_kandidat;

-- SELECT tetap diizinkan agar menu pemilihan duta bisa memuat nama & foto kandidat
CREATE POLICY "Allow anonymous read candidates" ON duta_kandidat FOR SELECT USING (true);
-- INSERT, UPDATE, DELETE ditutup total untuk anon (hanya service_role / postgres yang bisa)

-- =========================================================================
-- 2. LOCKDOWN TABEL duta_suara_masuk
-- =========================================================================
ALTER TABLE duta_suara_masuk ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anonymous read votes"    ON duta_suara_masuk;
DROP POLICY IF EXISTS "Allow anonymous insert votes"  ON duta_suara_masuk;
DROP POLICY IF EXISTS "Allow anonymous update votes"  ON duta_suara_masuk;
DROP POLICY IF EXISTS "Allow anonymous delete votes"  ON duta_suara_masuk;

-- SELECT tetap diizinkan untuk statistik hasil suara secara realtime
CREATE POLICY "Allow anonymous read votes" ON duta_suara_masuk FOR SELECT USING (true);
-- INSERT, UPDATE, DELETE ditutup total untuk anon

-- =========================================================================
-- 3. LOCKDOWN TABEL sukaduka_config, sukaduka_kas, sukaduka_iuran
-- =========================================================================
ALTER TABLE sukaduka_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE sukaduka_kas ENABLE ROW LEVEL SECURITY;
ALTER TABLE sukaduka_iuran ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anonymous read config" ON sukaduka_config;
DROP POLICY IF EXISTS "Allow anonymous write config" ON sukaduka_config;
DROP POLICY IF EXISTS "Allow anonymous read kas" ON sukaduka_kas;
DROP POLICY IF EXISTS "Allow anonymous write kas" ON sukaduka_kas;
DROP POLICY IF EXISTS "Allow anonymous read iuran" ON sukaduka_iuran;
DROP POLICY IF EXISTS "Allow anonymous write iuran" ON sukaduka_iuran;

-- SELECT tetap diizinkan agar guru/pegawai bisa melihat riwayat iuran & buku kas
CREATE POLICY "Allow anonymous read config" ON sukaduka_config FOR SELECT USING (true);
CREATE POLICY "Allow anonymous read kas" ON sukaduka_kas FOR SELECT USING (true);
CREATE POLICY "Allow anonymous read iuran" ON sukaduka_iuran FOR SELECT USING (true);
-- Modifikasi (ALL) ditutup total untuk anon

-- =========================================================================
-- 4. LOCKDOWN TABEL masukkan_saran
-- =========================================================================
ALTER TABLE masukkan_saran ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anonymous read masukkan_saran" ON masukkan_saran;
DROP POLICY IF EXISTS "Allow anonymous insert masukkan_saran" ON masukkan_saran;
DROP POLICY IF EXISTS "Allow anonymous update masukkan_saran" ON masukkan_saran;
DROP POLICY IF EXISTS "Allow anonymous delete masukkan_saran" ON masukkan_saran;

-- SELECT tetap diizinkan untuk memuat daftar masukan
CREATE POLICY "Allow anonymous read masukkan_saran" ON masukkan_saran FOR SELECT USING (true);
-- INSERT, UPDATE, DELETE ditutup total untuk anon

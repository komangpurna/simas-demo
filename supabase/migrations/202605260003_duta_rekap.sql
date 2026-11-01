-- supabase/migrations/202605260003_duta_rekap.sql
-- Menambahkan kolom role_pemilih pada duta_suara_masuk dan skor_rekam_jejak pada duta_kandidat

-- 1. Menambahkan kolom role_pemilih ke duta_suara_masuk (jika belum ada)
ALTER TABLE duta_suara_masuk ADD COLUMN IF NOT EXISTS role_pemilih TEXT DEFAULT 'siswa';

-- 2. Menambahkan kolom skor_rekam_jejak ke duta_kandidat (jika belum ada)
ALTER TABLE duta_kandidat ADD COLUMN IF NOT EXISTS skor_rekam_jejak NUMERIC DEFAULT 0;

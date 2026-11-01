-- supabase/migrations/202605260004_duta_fields.sql
-- Menambahkan kolom kelas, prestasi, dan catatan_lain pada tabel duta_kandidat

ALTER TABLE duta_kandidat ADD COLUMN IF NOT EXISTS kelas TEXT;
ALTER TABLE duta_kandidat ADD COLUMN IF NOT EXISTS prestasi TEXT;
ALTER TABLE duta_kandidat ADD COLUMN IF NOT EXISTS catatan_lain TEXT;

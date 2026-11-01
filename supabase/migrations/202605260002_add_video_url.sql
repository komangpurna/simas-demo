-- supabase/migrations/202605260002_add_video_url.sql
-- Menambahkan kolom video_url ke tabel duta_kandidat untuk mendukung media nominasi siswa

ALTER TABLE duta_kandidat 
ADD COLUMN IF NOT EXISTS video_url TEXT;

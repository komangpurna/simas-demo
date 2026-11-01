-- supabase/migrations/202606240002_add_source_url.sql
-- Menambahkan kolom source_url ke tabel masukkan_saran

ALTER TABLE masukkan_saran ADD COLUMN IF NOT EXISTS source_url TEXT;

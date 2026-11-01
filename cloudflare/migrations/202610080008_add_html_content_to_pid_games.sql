-- ====================================================================
-- SIMAS SMAGESA - CLOUDFLARE D1 DATABASE MIGRATION
-- Modul: Portal Game Interaktif (PID Games)
-- Penambahan dukungan hosting kode HTML mandiri karya guru
-- ====================================================================

-- Tambahkan kolom source_type ('url' atau 'html') dan html_content (kode HTML mentah)
ALTER TABLE pid_games ADD COLUMN source_type TEXT DEFAULT 'url';
ALTER TABLE pid_games ADD COLUMN html_content TEXT;

-- supabase/migrations/202608080002_update_masukkan_status_check.sql
-- Memperbarui constraint status pada tabel masukkan_saran agar mendukung variasi status baru

ALTER TABLE masukkan_saran DROP CONSTRAINT IF EXISTS masukkan_saran_status_check;

ALTER TABLE masukkan_saran ADD CONSTRAINT masukkan_saran_status_check 
    CHECK (status IN ('baru', 'proses', 'direncanakan', 'butuh_info', 'selesai', 'ditolak'));

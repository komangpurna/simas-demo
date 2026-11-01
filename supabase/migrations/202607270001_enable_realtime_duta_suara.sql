-- supabase/migrations/202607270001_enable_realtime_duta_suara.sql
-- Mengaktifkan Supabase Realtime pada tabel duta_suara_masuk
-- Diperlukan agar panel admin Duta SHAKTI menerima update suara secara live

-- Tambahkan tabel duta_suara_masuk ke Supabase Realtime publication
-- Ini memungkinkan client JS mendengarkan perubahan data via WebSocket
ALTER PUBLICATION supabase_realtime ADD TABLE duta_suara_masuk;

-- Set REPLICA IDENTITY agar Realtime mengirimkan data lengkap saat UPDATE/DELETE
-- (default 'DEFAULT' hanya mengirim primary key, 'FULL' mengirimkan seluruh kolom)
ALTER TABLE duta_suara_masuk REPLICA IDENTITY FULL;

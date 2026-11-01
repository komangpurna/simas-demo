-- supabase/migrations/202608210001_add_target_and_public_report_fields.sql
-- Menambahkan kolom target_recipient, reporter_type, dan contact_info ke tabel masukkan_saran

ALTER TABLE masukkan_saran ADD COLUMN IF NOT EXISTS target_recipient TEXT DEFAULT 'all';
ALTER TABLE masukkan_saran ADD COLUMN IF NOT EXISTS reporter_type TEXT DEFAULT 'internal';
ALTER TABLE masukkan_saran ADD COLUMN IF NOT EXISTS contact_info TEXT;

-- Index untuk mempercepat filter berdasarkan tujuan dan status
CREATE INDEX IF NOT EXISTS idx_masukkan_saran_target_recipient ON masukkan_saran (target_recipient);
CREATE INDEX IF NOT EXISTS idx_masukkan_saran_status ON masukkan_saran (status);
CREATE INDEX IF NOT EXISTS idx_masukkan_saran_created_at ON masukkan_saran (created_at DESC);

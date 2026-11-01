-- supabase/migrations/202609100001_add_replies_to_masukkan_saran.sql
-- Menambahkan kolom replies (JSONB) ke tabel masukkan_saran untuk mendukung riwayat percakapan/tanggapan timbal balik dua arah

ALTER TABLE public.masukkan_saran 
ADD COLUMN IF NOT EXISTS replies JSONB DEFAULT '[]'::jsonb;

-- Index pada updated_at untuk mempercepat query filtering dan pengecekan badge NEW
CREATE INDEX IF NOT EXISTS idx_masukkan_saran_updated_at ON public.masukkan_saran (updated_at DESC);

-- Index pada sender_uid untuk query pencarian masukan personal pengirim
CREATE INDEX IF NOT EXISTS idx_masukkan_saran_sender_uid ON public.masukkan_saran (sender_uid);

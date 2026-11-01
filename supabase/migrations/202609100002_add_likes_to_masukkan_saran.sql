-- Migrasi: Menambahkan kolom likes ke tabel masukkan_saran
-- Digunakan untuk menyimpan array UID pengguna yang menyukai / mendukung aspirasi (dukungan komunitas)
-- Format data: JSONB array string UID, contoh: '["uid_1", "uid_2"]'::jsonb

ALTER TABLE public.masukkan_saran 
ADD COLUMN IF NOT EXISTS likes JSONB DEFAULT '[]'::jsonb;

-- Index GIN pada likes untuk query analitik berkinerja tinggi (opsional bila diperlukan pencarian containment)
CREATE INDEX IF NOT EXISTS idx_masukkan_saran_likes_gin ON public.masukkan_saran USING gin (likes);

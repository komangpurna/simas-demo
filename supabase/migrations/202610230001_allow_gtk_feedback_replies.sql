-- supabase/migrations/202610230001_allow_gtk_feedback_replies.sql
-- Memastikan kolom replies dan index pada tabel masukkan_saran optimal untuk partisipasi diskusi seluruh GTK

-- 1. Pastikan kolom replies (JSONB) tersedia dengan nilai default array kosong
ALTER TABLE public.masukkan_saran 
ADD COLUMN IF NOT EXISTS replies JSONB DEFAULT '[]'::jsonb;

-- 2. Pastikan kolom likes (JSONB) tersedia
ALTER TABLE public.masukkan_saran 
ADD COLUMN IF NOT EXISTS likes JSONB DEFAULT '[]'::jsonb;

-- 3. Tambahkan GIN index untuk pencarian/query JSONB replies dan likes yang efisien
CREATE INDEX IF NOT EXISTS idx_masukkan_saran_replies_gin ON public.masukkan_saran USING gin (replies);
CREATE INDEX IF NOT EXISTS idx_masukkan_saran_likes_gin ON public.masukkan_saran USING gin (likes);

-- 4. Index performa status dan updated_at
CREATE INDEX IF NOT EXISTS idx_masukkan_saran_status ON public.masukkan_saran (status);
CREATE INDEX IF NOT EXISTS idx_masukkan_saran_updated_at ON public.masukkan_saran (updated_at DESC);

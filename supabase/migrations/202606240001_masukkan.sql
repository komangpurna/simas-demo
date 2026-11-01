-- supabase/migrations/202606240001_masukkan.sql
-- Skema Database Modul Masukan & Saran Siswa/Guru (Tabel: masukkan_saran)

CREATE TABLE IF NOT EXISTS masukkan_saran (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'baru' CHECK (status IN ('baru', 'selesai', 'ditolak')),
    sender_uid TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    sender_email TEXT,
    sender_role TEXT,
    sender_roles TEXT[],
    response_text TEXT,
    response_by_uid TEXT,
    response_by_name TEXT,
    responded_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Mengaktifkan Row Level Security (RLS)
ALTER TABLE masukkan_saran ENABLE ROW LEVEL SECURITY;

-- Menghapus policy lama jika ada
DROP POLICY IF EXISTS "Allow anonymous read masukkan_saran" ON masukkan_saran;
DROP POLICY IF EXISTS "Allow anonymous insert masukkan_saran" ON masukkan_saran;
DROP POLICY IF EXISTS "Allow anonymous update masukkan_saran" ON masukkan_saran;
DROP POLICY IF EXISTS "Allow anonymous delete masukkan_saran" ON masukkan_saran;

-- Membuat policy baru untuk klien anonim (firebase auth dikontrol di frontend)
CREATE POLICY "Allow anonymous read masukkan_saran" ON masukkan_saran FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert masukkan_saran" ON masukkan_saran FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update masukkan_saran" ON masukkan_saran FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow anonymous delete masukkan_saran" ON masukkan_saran FOR DELETE USING (true);

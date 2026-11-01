-- supabase/migrations/202605260001_duta_shakti.sql
-- Skema Database Modul Pemilihan Duta SHAKTI 2026

-- 1. Membuat tabel kandidat (duta_kandidat)
CREATE TABLE IF NOT EXISTS duta_kandidat (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nama TEXT NOT NULL,
    kategori TEXT NOT NULL, -- Sehat, Humanis, Agamais, Kreatif, Trampil, Inovatif
    foto_url TEXT
);

-- 2. Membuat tabel suara_masuk (duta_suara_masuk)
CREATE TABLE IF NOT EXISTS duta_suara_masuk (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nis_pemilih TEXT NOT NULL,
    nama_pemilih TEXT NOT NULL,
    kelas_pemilih TEXT NOT NULL,
    id_kandidat UUID NOT NULL REFERENCES duta_kandidat(id) ON DELETE CASCADE,
    kategori TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Menambahkan UNIQUE CONSTRAINT untuk proteksi mutlak (1 NIS hanya bisa memilih 1 kandidat per kategori)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'unique_nis_kategori'
    ) THEN
        ALTER TABLE duta_suara_masuk ADD CONSTRAINT unique_nis_kategori UNIQUE (nis_pemilih, kategori);
    END IF;
END $$;

-- 4. Kebijakan Row Level Security (RLS) untuk akses anonim publik
ALTER TABLE duta_kandidat ENABLE ROW LEVEL SECURITY;
ALTER TABLE duta_suara_masuk ENABLE ROW LEVEL SECURITY;

-- DROP POLICY jika sudah ada untuk menghindari duplikasi saat migrasi dijalankan ulang
DROP POLICY IF EXISTS "Allow anonymous read candidates" ON duta_kandidat;
DROP POLICY IF EXISTS "Allow anonymous insert votes" ON duta_suara_masuk;
DROP POLICY IF EXISTS "Allow anonymous read votes" ON duta_suara_masuk;

-- Membuat Policy Baru
CREATE POLICY "Allow anonymous read candidates" ON duta_kandidat FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert votes" ON duta_suara_masuk FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous read votes" ON duta_suara_masuk FOR SELECT USING (true);

-- 5. Seeding data kandidat awal jika kosong (Demo & Pengujian Instan)
INSERT INTO duta_kandidat (nama, kategori, foto_url)
SELECT 'I Gede Aditya Wiranata', 'Sehat', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&h=300'
WHERE NOT EXISTS (SELECT 1 FROM duta_kandidat WHERE nama = 'I Gede Aditya Wiranata');

INSERT INTO duta_kandidat (nama, kategori, foto_url)
SELECT 'Ni Putu Evelyn Pradnya', 'Sehat', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=300&h=300'
WHERE NOT EXISTS (SELECT 1 FROM duta_kandidat WHERE nama = 'Ni Putu Evelyn Pradnya');

INSERT INTO duta_kandidat (nama, kategori, foto_url)
SELECT 'I Komang Purna Wijaya', 'Humanis', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&h=300'
WHERE NOT EXISTS (SELECT 1 FROM duta_kandidat WHERE nama = 'I Komang Purna Wijaya');

INSERT INTO duta_kandidat (nama, kategori, foto_url)
SELECT 'Ni Made Ayu Saraswati', 'Humanis', 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=300&h=300'
WHERE NOT EXISTS (SELECT 1 FROM duta_kandidat WHERE nama = 'Ni Made Ayu Saraswati');

INSERT INTO duta_kandidat (nama, kategori, foto_url)
SELECT 'I Ketut Dharma Yasa', 'Agamais', 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&w=300&h=300'
WHERE NOT EXISTS (SELECT 1 FROM duta_kandidat WHERE nama = 'I Ketut Dharma Yasa');

INSERT INTO duta_kandidat (nama, kategori, foto_url)
SELECT 'Ni Luh Gede Krisna Dewi', 'Agamais', 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=300&h=300'
WHERE NOT EXISTS (SELECT 1 FROM duta_kandidat WHERE nama = 'Ni Luh Gede Krisna Dewi');

INSERT INTO duta_kandidat (nama, kategori, foto_url)
SELECT 'I Wayan Juniantara', 'Kreatif', 'https://images.unsplash.com/photo-1519345182560-3f2917c472ef?auto=format&fit=crop&w=300&h=300'
WHERE NOT EXISTS (SELECT 1 FROM duta_kandidat WHERE nama = 'I Wayan Juniantara');

INSERT INTO duta_kandidat (nama, kategori, foto_url)
SELECT 'Ni Kadek Windasari', 'Kreatif', 'https://images.unsplash.com/photo-1554151228-14d9def656e4?auto=format&fit=crop&w=300&h=300'
WHERE NOT EXISTS (SELECT 1 FROM duta_kandidat WHERE nama = 'Ni Kadek Windasari');

INSERT INTO duta_kandidat (nama, kategori, foto_url)
SELECT 'I Nyoman Triadi Putra', 'Trampil', 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=300&h=300'
WHERE NOT EXISTS (SELECT 1 FROM duta_kandidat WHERE nama = 'I Nyoman Triadi Putra');

INSERT INTO duta_kandidat (nama, kategori, foto_url)
SELECT 'Ni Nyoman Sukmawati', 'Trampil', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&h=300'
WHERE NOT EXISTS (SELECT 1 FROM duta_kandidat WHERE nama = 'Ni Nyoman Sukmawati');

INSERT INTO duta_kandidat (nama, kategori, foto_url)
SELECT 'I Made Bagus Wisesa', 'Inovatif', 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=300&h=300'
WHERE NOT EXISTS (SELECT 1 FROM duta_kandidat WHERE nama = 'I Made Bagus Wisesa');

INSERT INTO duta_kandidat (nama, kategori, foto_url)
SELECT 'Ni Ketut Intan Rahmawati', 'Inovatif', 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=300&h=300'
WHERE NOT EXISTS (SELECT 1 FROM duta_kandidat WHERE nama = 'Ni Ketut Intan Rahmawati');

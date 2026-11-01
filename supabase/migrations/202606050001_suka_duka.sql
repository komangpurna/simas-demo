-- supabase/migrations/202606050001_suka_duka.sql
-- Skema Database Modul Iuran Suka-Duka Guru & Pegawai

-- 1. Membuat tabel konfigurasi (sukaduka_config)
CREATE TABLE IF NOT EXISTS sukaduka_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Membuat tabel arus kas (sukaduka_kas)
CREATE TABLE IF NOT EXISTS sukaduka_kas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipe TEXT NOT NULL CHECK (tipe IN ('masuk', 'keluar')),
    kategori TEXT NOT NULL, -- 'iuran_bulanan', 'donasi', 'santunan_pernikahan', 'santunan_duka', 'santunan_sakit', 'lain_lain'
    jumlah NUMERIC(12,2) NOT NULL,
    tanggal DATE NOT NULL DEFAULT CURRENT_DATE,
    keterangan TEXT,
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Membuat tabel pembayaran iuran (sukaduka_iuran)
CREATE TABLE IF NOT EXISTS sukaduka_iuran (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guru_id TEXT NOT NULL, -- ID Dokumen Firestore Guru (Menjamin unik bahkan jika tanpa NIP)
    anggota_nama TEXT NOT NULL, -- Denormalisasi nama untuk pencarian dan export cepat
    anggota_nip TEXT, -- NIP (Opsional, jika guru/pegawai memilikinya)
    bulan_tahun TEXT NOT NULL, -- Format 'YYYY-MM' (Contoh: '2026-06')
    jumlah NUMERIC(12,2) NOT NULL,
    tanggal_bayar DATE NOT NULL DEFAULT CURRENT_DATE,
    kas_id UUID REFERENCES sukaduka_kas(id) ON DELETE CASCADE, -- Hubungan ke arus kas masuk
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT unique_guru_id_bulan_tahun UNIQUE (guru_id, bulan_tahun)
);

-- 4. Kebijakan Row Level Security (RLS) untuk akses anonim publik (SSO Firebase Auth divalidasi di Frontend)
ALTER TABLE sukaduka_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE sukaduka_kas ENABLE ROW LEVEL SECURITY;
ALTER TABLE sukaduka_iuran ENABLE ROW LEVEL SECURITY;

-- DROP POLICY jika sudah ada
DROP POLICY IF EXISTS "Allow anonymous read config" ON sukaduka_config;
DROP POLICY IF EXISTS "Allow anonymous write config" ON sukaduka_config;
DROP POLICY IF EXISTS "Allow anonymous read kas" ON sukaduka_kas;
DROP POLICY IF EXISTS "Allow anonymous write kas" ON sukaduka_kas;
DROP POLICY IF EXISTS "Allow anonymous read iuran" ON sukaduka_iuran;
DROP POLICY IF EXISTS "Allow anonymous write iuran" ON sukaduka_iuran;

-- Membuat Policy Baru (All operations)
CREATE POLICY "Allow anonymous read config" ON sukaduka_config FOR SELECT USING (true);
CREATE POLICY "Allow anonymous write config" ON sukaduka_config FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow anonymous read kas" ON sukaduka_kas FOR SELECT USING (true);
CREATE POLICY "Allow anonymous write kas" ON sukaduka_kas FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow anonymous read iuran" ON sukaduka_iuran FOR SELECT USING (true);
CREATE POLICY "Allow anonymous write iuran" ON sukaduka_iuran FOR ALL USING (true) WITH CHECK (true);

-- 5. Seeding data awal nominal iuran (Default: Rp 50.000)
INSERT INTO sukaduka_config (key, value)
SELECT 'nominal_iuran', '50000'
WHERE NOT EXISTS (SELECT 1 FROM sukaduka_config WHERE key = 'nominal_iuran');

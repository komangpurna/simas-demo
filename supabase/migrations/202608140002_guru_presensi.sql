-- supabase/migrations/202608140002_guru_presensi.sql
-- Skema Database Modul Presensi Guru Harian (guru_presensi) SIMAS SHAKTI (Supabase PostgreSQL)

-- 1. Tabel Presensi Guru (guru_presensi)
CREATE TABLE IF NOT EXISTS guru_presensi (
    id VARCHAR(64) PRIMARY KEY, -- Format: {kelas_slug}_{tanggal}_{jp}, contoh: XII_IPA_1_2026-08-14_1
    kelas VARCHAR(50) NOT NULL,
    tanggal DATE NOT NULL,
    jp SMALLINT NOT NULL CHECK (jp >= 1 AND jp <= 10),
    mapel VARCHAR(150) NOT NULL,
    guru_id VARCHAR(100),
    guru_nama VARCHAR(200) NOT NULL,
    status VARCHAR(10) NOT NULL, -- 'H', 'I', 'S', 'K', 'TK'
    ada_tugas BOOLEAN DEFAULT NULL, -- true/false untuk I/S, null untuk H/K/TK
    created_by VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT uq_guru_presensi_slot UNIQUE (kelas, tanggal, jp)
);

-- 2. Indexing untuk Kueri Super Cepat & Ringan Egress
CREATE INDEX IF NOT EXISTS idx_guru_presensi_kelas_tanggal ON guru_presensi(kelas, tanggal);
CREATE INDEX IF NOT EXISTS idx_guru_presensi_tanggal ON guru_presensi(tanggal);
CREATE INDEX IF NOT EXISTS idx_guru_presensi_guru_id ON guru_presensi(guru_id);
CREATE INDEX IF NOT EXISTS idx_guru_presensi_guru_nama ON guru_presensi(guru_nama);
CREATE INDEX IF NOT EXISTS idx_guru_presensi_status ON guru_presensi(status);

-- 3. Row Level Security (RLS)
ALTER TABLE guru_presensi ENABLE ROW LEVEL SECURITY;

-- Drop Policy lama jika ada
DROP POLICY IF EXISTS "Allow read guru_presensi" ON guru_presensi;
DROP POLICY IF EXISTS "Allow write guru_presensi" ON guru_presensi;

-- Policies Akses Klien
CREATE POLICY "Allow read guru_presensi" ON guru_presensi FOR SELECT USING (true);
CREATE POLICY "Allow write guru_presensi" ON guru_presensi FOR ALL USING (true) WITH CHECK (true);

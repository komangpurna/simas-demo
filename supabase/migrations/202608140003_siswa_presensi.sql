-- supabase/migrations/202608140003_siswa_presensi.sql
-- Skema Database Modul Presensi Siswa Harian & Agregat (siswa_presensi & siswa_presensi_harian)
-- SIMAS SHAKTI (Supabase PostgreSQL)

-- 1. TABEL HEADER / SUMMARY PRESENSI KELAS HARIAN
CREATE TABLE IF NOT EXISTS public.siswa_presensi_harian (
    id VARCHAR(100) PRIMARY KEY, -- Format: '{kelas}_{tanggal}' misal 'X-1_2026-08-14'
    kelas VARCHAR(50) NOT NULL,
    tanggal DATE NOT NULL,
    summary JSONB NOT NULL DEFAULT '{"H":0,"S":0,"I":0,"D":0,"A":0}'::jsonb,
    total_students INT DEFAULT 0,
    recorded_by VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT unique_presensi_harian_kelas_tanggal UNIQUE (kelas, tanggal)
);

-- Indeks Kecepatan Tinggi untuk siswa_presensi_harian
CREATE INDEX IF NOT EXISTS idx_presensi_harian_tanggal ON public.siswa_presensi_harian (tanggal);
CREATE INDEX IF NOT EXISTS idx_presensi_harian_kelas ON public.siswa_presensi_harian (kelas);
CREATE INDEX IF NOT EXISTS idx_presensi_harian_kelas_tanggal ON public.siswa_presensi_harian (kelas, tanggal);

-- 2. TABEL DETAIL PRESENSI SISWA (GRANULAR STATUS PER SISWA)
CREATE TABLE IF NOT EXISTS public.siswa_presensi (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kelas VARCHAR(50) NOT NULL,
    tanggal DATE NOT NULL,
    student_nis VARCHAR(30) NOT NULL,
    student_name VARCHAR(150),
    status VARCHAR(5) NOT NULL DEFAULT 'H', -- 'H', 'S', 'I', 'A', 'D', 'P'
    note TEXT DEFAULT '',
    has_letter BOOLEAN DEFAULT FALSE,
    recorded_by VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT unique_siswa_presensi_nis_tanggal UNIQUE (student_nis, tanggal)
);

-- Indeks Kecepatan Tinggi untuk siswa_presensi
CREATE INDEX IF NOT EXISTS idx_siswa_presensi_kelas_tanggal ON public.siswa_presensi (kelas, tanggal);
CREATE INDEX IF NOT EXISTS idx_siswa_presensi_nis_tanggal ON public.siswa_presensi (student_nis, tanggal);
CREATE INDEX IF NOT EXISTS idx_siswa_presensi_tanggal ON public.siswa_presensi (tanggal);
CREATE INDEX IF NOT EXISTS idx_siswa_presensi_nis ON public.siswa_presensi (student_nis);
CREATE INDEX IF NOT EXISTS idx_siswa_presensi_status ON public.siswa_presensi (status);

-- 3. ENABLE ROW LEVEL SECURITY & POLICIES (Konsisten dengan guru_presensi & finance)
ALTER TABLE public.siswa_presensi_harian ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.siswa_presensi ENABLE ROW LEVEL SECURITY;

-- Drop policies jika sudah ada sebelumnya agar idempotent
DROP POLICY IF EXISTS "Allow public read siswa_presensi_harian" ON public.siswa_presensi_harian;
DROP POLICY IF EXISTS "Allow public all siswa_presensi_harian" ON public.siswa_presensi_harian;
DROP POLICY IF EXISTS "Allow public read siswa_presensi" ON public.siswa_presensi;
DROP POLICY IF EXISTS "Allow public all siswa_presensi" ON public.siswa_presensi;

-- Create Policies
CREATE POLICY "Allow public read siswa_presensi_harian" 
ON public.siswa_presensi_harian FOR SELECT USING (true);

CREATE POLICY "Allow public all siswa_presensi_harian" 
ON public.siswa_presensi_harian FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow public read siswa_presensi" 
ON public.siswa_presensi FOR SELECT USING (true);

CREATE POLICY "Allow public all siswa_presensi" 
ON public.siswa_presensi FOR ALL USING (true) WITH CHECK (true);

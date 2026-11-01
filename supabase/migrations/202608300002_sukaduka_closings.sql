-- supabase/migrations/202608300001_sukaduka_closings.sql
-- Skema Database Tutup Buku Tahunan Suka Duka Guru & Pegawai SIMAS SHAKTI (Supabase PostgreSQL)

-- 1. Membuat tabel tutup buku tahunan (sukaduka_closings)
CREATE TABLE IF NOT EXISTS sukaduka_closings (
    id TEXT PRIMARY KEY, -- Format: {year} e.g. "2025"
    year INT NOT NULL UNIQUE,
    saldo_akhir NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_income NUMERIC(15,2) DEFAULT 0,
    total_expense NUMERIC(15,2) DEFAULT 0,
    closed_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    closed_by VARCHAR(200),
    summary JSONB DEFAULT '{}'::jsonb
);

-- Indexing untuk query cepat
CREATE INDEX IF NOT EXISTS idx_sukaduka_closings_year ON sukaduka_closings(year);

-- 2. Kebijakan Row Level Security (RLS)
ALTER TABLE sukaduka_closings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anonymous read sukaduka_closings" ON sukaduka_closings;
DROP POLICY IF EXISTS "Allow anonymous write sukaduka_closings" ON sukaduka_closings;

CREATE POLICY "Allow anonymous read sukaduka_closings" ON sukaduka_closings FOR SELECT USING (true);
CREATE POLICY "Allow anonymous write sukaduka_closings" ON sukaduka_closings FOR ALL USING (true) WITH CHECK (true);
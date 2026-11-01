-- supabase/migrations/202608080001_guru_mapel_grades.sql
-- Skema Database Modul Portal Guru Mapel (Input Nilai Tugas, Sumatif, & SAS/SAT)

-- 1. Tabel Utama Gradebook (guru_mapel_gradebooks)
CREATE TABLE IF NOT EXISTS guru_mapel_gradebooks (
    id TEXT PRIMARY KEY, -- Format: {tahun_ajaran}_{semester}_{class_id}_{subject_id}
    tahun_ajaran VARCHAR(20) NOT NULL,
    semester VARCHAR(5) NOT NULL, -- '1' atau '2'
    class_id VARCHAR(50) NOT NULL,
    subject_id VARCHAR(100) NOT NULL,
    teacher_nip VARCHAR(50),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT unique_gradebook_scope UNIQUE (tahun_ajaran, semester, class_id, subject_id)
);

-- 2. Tabel Komponen Penilaian (guru_mapel_components)
CREATE TABLE IF NOT EXISTS guru_mapel_components (
    id BIGSERIAL PRIMARY KEY,
    gradebook_id TEXT NOT NULL REFERENCES guru_mapel_gradebooks(id) ON DELETE CASCADE,
    component_type VARCHAR(20) NOT NULL, -- 'tugas', 'sumatif', 'sas', 'sat'
    label VARCHAR(100) NOT NULL,
    sequence INT DEFAULT 1,
    is_optional BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT unique_component_label UNIQUE (gradebook_id, component_type, label)
);

-- 3. Tabel Nilai Per Siswa dan Komponen (guru_mapel_scores)
CREATE TABLE IF NOT EXISTS guru_mapel_scores (
    id BIGSERIAL PRIMARY KEY,
    gradebook_id TEXT NOT NULL REFERENCES guru_mapel_gradebooks(id) ON DELETE CASCADE,
    student_nis VARCHAR(50) NOT NULL,
    component_id BIGINT NOT NULL REFERENCES guru_mapel_components(id) ON DELETE CASCADE,
    score NUMERIC(5,2) DEFAULT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT unique_student_component_score UNIQUE (gradebook_id, student_nis, component_id)
);

-- 4. Tabel Ringkasan Nilai Akhir & Deskripsi CP (guru_mapel_summaries)
CREATE TABLE IF NOT EXISTS guru_mapel_summaries (
    id BIGSERIAL PRIMARY KEY,
    gradebook_id TEXT NOT NULL REFERENCES guru_mapel_gradebooks(id) ON DELETE CASCADE,
    student_nis VARCHAR(50) NOT NULL,
    tugas_avg NUMERIC(5,2) DEFAULT NULL,
    sumatif_avg NUMERIC(5,2) DEFAULT NULL,
    sas_sat_score NUMERIC(5,2) DEFAULT NULL,
    final_score NUMERIC(5,2) DEFAULT NULL,
    deskripsi_cp TEXT DEFAULT '',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT unique_student_summary UNIQUE (gradebook_id, student_nis)
);

-- 5. Kebijakan Row Level Security (RLS)
ALTER TABLE guru_mapel_gradebooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE guru_mapel_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE guru_mapel_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE guru_mapel_summaries ENABLE ROW LEVEL SECURITY;

-- Drop Policy lama jika ada
DROP POLICY IF EXISTS "Allow anonymous read gradebooks" ON guru_mapel_gradebooks;
DROP POLICY IF EXISTS "Allow anonymous write gradebooks" ON guru_mapel_gradebooks;
DROP POLICY IF EXISTS "Allow anonymous read components" ON guru_mapel_components;
DROP POLICY IF EXISTS "Allow anonymous write components" ON guru_mapel_components;
DROP POLICY IF EXISTS "Allow anonymous read scores" ON guru_mapel_scores;
DROP POLICY IF EXISTS "Allow anonymous write scores" ON guru_mapel_scores;
DROP POLICY IF EXISTS "Allow anonymous read summaries" ON guru_mapel_summaries;
DROP POLICY IF EXISTS "Allow anonymous write summaries" ON guru_mapel_summaries;

-- Policy All Operations (Anon Key)
CREATE POLICY "Allow anonymous read gradebooks" ON guru_mapel_gradebooks FOR SELECT USING (true);
CREATE POLICY "Allow anonymous write gradebooks" ON guru_mapel_gradebooks FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow anonymous read components" ON guru_mapel_components FOR SELECT USING (true);
CREATE POLICY "Allow anonymous write components" ON guru_mapel_components FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow anonymous read scores" ON guru_mapel_scores FOR SELECT USING (true);
CREATE POLICY "Allow anonymous write scores" ON guru_mapel_scores FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow anonymous read summaries" ON guru_mapel_summaries FOR SELECT USING (true);
CREATE POLICY "Allow anonymous write summaries" ON guru_mapel_summaries FOR ALL USING (true) WITH CHECK (true);

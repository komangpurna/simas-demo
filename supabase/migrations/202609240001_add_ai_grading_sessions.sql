-- supabase/migrations/202609240001_add_ai_grading_sessions.sql
-- Tabel Sesi Koreksi Asesmen Siswa Otomatis Berbasis AI (Supabase Fallback / Resilient Storage)
-- ID format: {kelas}_{timestamp} (contoh: X-E1_1727148400000)

CREATE TABLE IF NOT EXISTS ai_grading_sessions (
    id TEXT PRIMARY KEY,
    teacher_id TEXT,
    kelas VARCHAR(50) NOT NULL,
    mapel VARCHAR(100) NOT NULL,
    semester VARCHAR(5) NOT NULL,
    tahun_ajaran VARCHAR(20) NOT NULL,
    title TEXT NOT NULL,
    total_max_score NUMERIC(5,2) DEFAULT 100,
    questions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    submissions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_grading_sessions_teacher ON ai_grading_sessions(teacher_id);
CREATE INDEX IF NOT EXISTS idx_ai_grading_sessions_kelas_mapel ON ai_grading_sessions(kelas, mapel);

ALTER TABLE ai_grading_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon read ai_grading_sessions" ON ai_grading_sessions;
DROP POLICY IF EXISTS "Allow anon write ai_grading_sessions" ON ai_grading_sessions;
CREATE POLICY "Allow anon read ai_grading_sessions" ON ai_grading_sessions FOR SELECT USING (true);
CREATE POLICY "Allow anon write ai_grading_sessions" ON ai_grading_sessions FOR ALL USING (true) WITH CHECK (true);

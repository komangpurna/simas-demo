-- cloudflare/migrations/202609240001_add_ai_grading_sessions.sql
-- Tabel Sesi Koreksi Asesmen Siswa Otomatis Berbasis AI (Cloudflare D1 SSOT)
-- ID format: {kelas}_{timestamp} (contoh: X-E1_1727148400000)

CREATE TABLE IF NOT EXISTS ai_grading_sessions (
    id TEXT PRIMARY KEY,
    teacher_id TEXT,
    kelas TEXT NOT NULL,
    mapel TEXT NOT NULL,
    semester TEXT NOT NULL,
    tahun_ajaran TEXT NOT NULL,
    title TEXT NOT NULL,
    total_max_score REAL DEFAULT 100,
    questions_json TEXT NOT NULL DEFAULT '[]',
    submissions_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_grading_teacher ON ai_grading_sessions(teacher_id);
CREATE INDEX IF NOT EXISTS idx_ai_grading_kelas_mapel ON ai_grading_sessions(kelas, mapel);

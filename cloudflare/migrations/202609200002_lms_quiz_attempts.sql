-- Percobaan asesmen: salinan soal, jawaban, dan hasil pemeriksaan guru.
CREATE TABLE IF NOT EXISTS lms_quiz_attempts (
    id TEXT PRIMARY KEY,
    material_id TEXT NOT NULL REFERENCES lms_materials(id) ON DELETE CASCADE,
    student_nis TEXT NOT NULL,
    student_name TEXT NOT NULL,
    student_class TEXT NOT NULL,
    quiz_snapshot TEXT NOT NULL,
    answers TEXT NOT NULL DEFAULT '{}',
    result TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress', 'pending_review', 'graded')),
    score INTEGER,
    revision INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    expires_at TEXT,
    submitted_at TEXT,
    reviewed_at TEXT,
    reviewed_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_lms_quiz_student ON lms_quiz_attempts(material_id, student_nis, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lms_quiz_active ON lms_quiz_attempts(material_id, student_nis) WHERE status = 'in_progress';
CREATE INDEX IF NOT EXISTS idx_lms_quiz_retention ON lms_quiz_attempts(started_at);

-- ====================================================================
-- Migrasi LMS Kuis Formatif / CBT Anti-Kecurangan
-- Menambahkan kolom penguncian attempt, counter pelanggaran, dan log telemetry
-- ====================================================================

ALTER TABLE lms_quiz_attempts ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lms_quiz_attempts ADD COLUMN lock_reason TEXT;
ALTER TABLE lms_quiz_attempts ADD COLUMN violation_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lms_quiz_attempts ADD COLUMN violations_log TEXT NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_lms_quiz_locked ON lms_quiz_attempts(material_id, is_locked) WHERE is_locked = 1;

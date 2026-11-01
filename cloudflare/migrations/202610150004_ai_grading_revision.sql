-- Revision/client_updated_at columns are added idempotently by ensureAiAssessmentStorage
-- after PRAGMA table_info; SQLite cannot conditionally add a column in static SQL.
CREATE INDEX IF NOT EXISTS idx_ai_grading_owner_updated ON ai_grading_sessions(teacher_id, updated_at);

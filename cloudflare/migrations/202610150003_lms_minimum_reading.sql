-- Completed work remains valid; new reading needs five minutes.
ALTER TABLE lms_materials ADD COLUMN minimum_read_seconds INTEGER NOT NULL DEFAULT 300;
ALTER TABLE lms_progress ADD COLUMN reading_completed_at TEXT NOT NULL DEFAULT '';
UPDATE lms_progress SET reading_completed_at = COALESCE(NULLIF(completed_at, ''), first_opened_at, '')
WHERE status = 'completed';

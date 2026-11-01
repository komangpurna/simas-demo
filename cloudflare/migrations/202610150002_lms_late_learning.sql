-- Apply before the Worker release. Deadline completion is computed from server time.
ALTER TABLE lms_materials ADD COLUMN teaching_completed_at TEXT DEFAULT '';
ALTER TABLE lms_progress ADD COLUMN late_started_at TEXT DEFAULT '';
ALTER TABLE lms_progress ADD COLUMN late_cutoff_at TEXT DEFAULT '';

-- The historical manual-completion instant was not stored. Start that boundary
-- at migration time; an earlier known due_date still takes precedence in code.
UPDATE lms_materials SET teaching_completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE is_teaching_completed = 1 AND COALESCE(teaching_completed_at, '') = '';

-- Existing published lessons, including today's, switch on deployment. Future
-- deadlines are also evaluated from server time on every read (no cron delay).
UPDATE lms_materials SET
    is_teaching_completed = 1,
    teaching_completed_at = CASE
        WHEN julianday(teaching_completed_at) < julianday(CASE WHEN length(due_date) = 10
            THEN due_date || 'T15:59:59.999Z' ELSE due_date END) THEN teaching_completed_at
        ELSE CASE WHEN length(due_date) = 10 THEN due_date || 'T15:59:59.999Z' ELSE due_date END END
WHERE is_published IN (1, 2)
    AND (is_published = 1 OR julianday(publish_at) <= julianday('now'))
    AND julianday(CASE WHEN length(due_date) = 10 THEN due_date || 'T15:59:59.999Z' ELSE due_date END) <= julianday('now');

-- Older attempts were capped by the lesson's deadline. Restore only that cap;
-- retain the original start and each quiz's own time allowance, never reset it.
UPDATE lms_quiz_attempts SET expires_at = CASE
    WHEN CAST(json_extract(quiz_snapshot, '$.time_limit_minutes') AS REAL) > 0
        THEN strftime('%Y-%m-%dT%H:%M:%fZ', julianday(started_at)
            + CAST(json_extract(quiz_snapshot, '$.time_limit_minutes') AS REAL) / 1440.0)
    ELSE NULL END
WHERE status = 'in_progress' AND json_valid(quiz_snapshot)
    AND EXISTS (SELECT 1 FROM lms_materials m WHERE m.id = lms_quiz_attempts.material_id
        AND julianday(lms_quiz_attempts.expires_at) = julianday(CASE WHEN length(m.due_date) = 10
            THEN m.due_date || 'T15:59:59.999Z' ELSE m.due_date END))
    AND (COALESCE(CAST(json_extract(quiz_snapshot, '$.time_limit_minutes') AS REAL), 0) = 0
        OR julianday(started_at) + CAST(json_extract(quiz_snapshot, '$.time_limit_minutes') AS REAL) / 1440.0 > julianday(expires_at));

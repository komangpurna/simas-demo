-- Extend existing indexes instead of retaining duplicate prefix indexes.
-- All notification/delivery rows and read states are preserved.
DROP INDEX IF EXISTS idx_notification_deliveries_recipient_created;
CREATE INDEX idx_notification_deliveries_recipient_created
ON notification_deliveries(recipient_uid, created_at, job_id);

DROP INDEX IF EXISTS idx_notification_jobs_type_created;
CREATE INDEX idx_notification_jobs_type_created
ON notification_jobs(target_type, created_at, target_value, id);

DROP INDEX IF EXISTS idx_notification_jobs_personal_target;
CREATE INDEX idx_notification_jobs_personal_target
ON notification_jobs(target_type, target_value, created_at, id);

-- Only class notifications need this index. Preserve the legacy normalization
-- exactly, including the separate exact-match path in the Worker query.
CREATE INDEX IF NOT EXISTS idx_notification_jobs_class_inbox
ON notification_jobs(
    target_type,
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(target_value), 'kelas', ''), ' ', ''), '-', ''), '.', ''), '_', ''),
    created_at, id
) WHERE target_type IN ('class', 'class_admin');

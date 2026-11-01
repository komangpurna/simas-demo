-- Inbox Notification Center membaca notification_jobs dalam jendela 60 hari terakhir
-- (lihat NOTIFICATION_INBOX_WINDOW di worker.js). Worker juga membuat index ini
-- secara idempotent melalui ensureNotificationTables.
CREATE INDEX IF NOT EXISTS idx_notification_jobs_created ON notification_jobs(created_at);

-- Inbox Notification Center (GET /api/notifications/inbox) tidak lagi memindai seluruh
-- notification_jobs (yang berisi notifikasi pribadi semua pengguna). Kandidat diambil dari:
--   1. baris delivery milik pembaca  -> idx_notification_deliveries_recipient_created
--   2. job pribadi lama tanpa baris delivery -> idx_notification_jobs_personal_target
--   3. job siaran per tipe target    -> idx_notification_jobs_type_created
-- Worker juga membuat index ini secara idempotent melalui ensureNotificationTables.
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_recipient_created ON notification_deliveries(recipient_uid, created_at);
CREATE INDEX IF NOT EXISTS idx_notification_jobs_type_created ON notification_jobs(target_type, created_at);
CREATE INDEX IF NOT EXISTS idx_notification_jobs_personal_target ON notification_jobs(target_type, target_value, created_at);

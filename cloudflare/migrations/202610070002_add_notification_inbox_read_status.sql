-- Migrasi D1: Menambahkan kolom is_read dan read_at pada notification_deliveries untuk Notification Center Inbox
ALTER TABLE notification_deliveries ADD COLUMN is_read INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notification_deliveries ADD COLUMN read_at TEXT DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_recipient_read ON notification_deliveries(recipient_uid, is_read, created_at DESC);

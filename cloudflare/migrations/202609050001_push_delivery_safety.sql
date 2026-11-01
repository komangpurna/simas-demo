-- Jalankan sebelum deploy Worker baru pada database lama, sekali saja.
-- Worker juga mendukung upgrade idempotent melalui PRAGMA table_info.
-- Jika auto-upgrade Worker sudah berjalan, jangan jalankan ALTER ini ulang.
ALTER TABLE notification_deliveries ADD COLUMN recipient_uid TEXT NOT NULL DEFAULT '';
ALTER TABLE notification_deliveries ADD COLUMN claim_id TEXT NOT NULL DEFAULT '';
ALTER TABLE notification_deliveries ADD COLUMN lease_until INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notification_deliveries ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_notification_delivery_due
ON notification_deliveries(status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS idx_notification_delivery_token ON notification_deliveries(token_id, status);

-- Cloudflare D1 notification infrastructure for SIMAS SMAGESA.
CREATE TABLE IF NOT EXISTS fcm_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    role TEXT DEFAULT '',
    additional_roles TEXT DEFAULT '[]',
    assigned_class TEXT DEFAULT '',
    display_name TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    telegram_chat_id TEXT DEFAULT '',
    device_type TEXT DEFAULT 'unknown',
    user_agent TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fcm_tokens_user_id ON fcm_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_fcm_tokens_role ON fcm_tokens(role);
CREATE INDEX IF NOT EXISTS idx_fcm_tokens_assigned_class ON fcm_tokens(assigned_class);

CREATE TABLE IF NOT EXISTS notification_jobs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    url TEXT DEFAULT './dashboard.html',
    target_type TEXT NOT NULL,
    target_value TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    sent_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    created_by TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    processed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_notification_jobs_status ON notification_jobs(status, created_at);

CREATE TABLE IF NOT EXISTS notification_deliveries (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    token_id TEXT NOT NULL,
    token TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    attempts INTEGER DEFAULT 0,
    error TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    processed_at TEXT,
    FOREIGN KEY (job_id) REFERENCES notification_jobs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_pending ON notification_deliveries(status, created_at);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_job ON notification_deliveries(job_id, status);

CREATE TABLE IF NOT EXISTS agenda_notification_queue (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    title TEXT NOT NULL,
    change_type TEXT NOT NULL,
    processed INTEGER DEFAULT 0,
    created_by TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    processed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_agenda_notification_pending ON agenda_notification_queue(processed, created_at);

CREATE TABLE IF NOT EXISTS notification_channel_log (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    dedupe_key TEXT NOT NULL,
    target TEXT DEFAULT '',
    status TEXT NOT NULL,
    created_by TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notification_channel_dedupe
ON notification_channel_log(channel, dedupe_key, created_at);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
    id TEXT PRIMARY KEY,
    failure_count INTEGER DEFAULT 0,
    window_started_at INTEGER NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

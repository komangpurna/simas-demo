-- ====================================================================
-- SIMAS SMAGESA - CLOUDFLARE D1 TELEMETRY & AUDIT TABLES
-- ====================================================================

-- 1. Tabel Login History (Riwayat Aktivitas Login)
CREATE TABLE IF NOT EXISTS login_history (
    id TEXT PRIMARY KEY,
    uid TEXT NOT NULL,
    email TEXT,
    name TEXT,
    role TEXT,
    login_at TEXT NOT NULL,       -- Format ISO 8601 string
    user_agent TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_login_history_login_at ON login_history(login_at);
CREATE INDEX IF NOT EXISTS idx_login_history_role ON login_history(role);
CREATE INDEX IF NOT EXISTS idx_login_history_uid ON login_history(uid);

-- 2. Tabel Audit Logs (Jejak Audit Keamanan & Mutasi Data)
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    target_id TEXT,
    actor_uid TEXT,
    actor_name TEXT,
    old_data TEXT,                -- Format JSON string
    new_data TEXT,                -- Format JSON string
    details TEXT,
    timestamp TEXT NOT NULL,      -- Format ISO 8601 string
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_uid ON audit_logs(actor_uid);

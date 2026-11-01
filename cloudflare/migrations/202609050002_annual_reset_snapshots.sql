-- Additive only. Worker also creates these lazily on the protected annual-reset endpoint.
-- Operation IDs (including promotion year) remain after recovery snapshots expire.
CREATE TABLE IF NOT EXISTS annual_reset_operations (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    academic_year TEXT,
    status TEXT NOT NULL CHECK(status IN ('prepared','committed','completed')),
    actor_uid TEXT NOT NULL,
    options TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    committed_at TEXT,
    completed_at TEXT
);
CREATE TABLE IF NOT EXISTS annual_reset_snapshots (
    operation_id TEXT NOT NULL,
    table_name TEXT NOT NULL,
    row_key TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (operation_id, table_name, row_key)
) WITHOUT ROWID;

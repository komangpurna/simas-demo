-- Optional LMS journal bridge. Existing journals and LMS progress remain unchanged.
CREATE TABLE IF NOT EXISTS lms_journal_links (
    journal_id TEXT PRIMARY KEY REFERENCES jurnal_guru(id) ON DELETE CASCADE,
    scope_key TEXT NOT NULL UNIQUE,
    teacher_id TEXT NOT NULL,
    plan_segment_id TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 1,
    request_id TEXT NOT NULL,
    snapshot_hash TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    evidence_token TEXT NOT NULL,
    signed_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS lms_journal_evidence (
    token TEXT PRIMARY KEY,
    journal_id TEXT NOT NULL REFERENCES jurnal_guru(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(journal_id, revision)
);
CREATE TABLE IF NOT EXISTS lms_activity_events (
    id TEXT PRIMARY KEY,
    material_id TEXT NOT NULL REFERENCES lms_materials(id) ON DELETE CASCADE,
    student_nis TEXT NOT NULL,
    action TEXT NOT NULL,
    occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lms_activity_period ON lms_activity_events(material_id, occurred_at, student_nis);
CREATE INDEX IF NOT EXISTS idx_lms_journal_teacher ON lms_journal_links(teacher_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lms_journal_request ON lms_journal_links(request_id);

-- Penetapan HBG per versi rencana, terikat minggu dan guru melalui weekly_plan_versions.
CREATE TABLE IF NOT EXISTS workload_study_days (
    plan_version_id TEXT PRIMARY KEY REFERENCES weekly_plan_versions(id) ON DELETE CASCADE,
    manual_day_index INTEGER CHECK (manual_day_index BETWEEN 0 AND 4),
    resolution_json TEXT NOT NULL,
    updated_by_uid TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

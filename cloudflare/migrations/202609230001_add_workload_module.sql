-- ====================================================================
-- SIMAS SMAGESA - MIGRATION: MODUL BEBAN KERJA GURU
-- Migration File: 202609230001_add_workload_module.sql
-- Sesuai: Permendikdasmen No. 11/2025 & Kepmendikdasmen No. 221/P/2025
-- ====================================================================

-- 1. Master Regulasi Beban Kerja & Ekuivalensi (workload_rulesets)
CREATE TABLE IF NOT EXISTS workload_rulesets (
    id TEXT PRIMARY KEY,
    rule_code TEXT NOT NULL UNIQUE,
    document_source TEXT NOT NULL,
    pasal_ref TEXT NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    target_unit TEXT NOT NULL,
    equivalency_jp INTEGER DEFAULT 0,
    max_equivalency_jp INTEGER DEFAULT 0,
    min_teaching_jp INTEGER DEFAULT 0,
    min_bk_rombel INTEGER DEFAULT 0,
    combination_restriction TEXT,
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    verification_status TEXT DEFAULT 'verified',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_workload_rules_code ON workload_rulesets(rule_code);
CREATE INDEX IF NOT EXISTS idx_workload_rules_cat ON workload_rulesets(category);

-- 2. Kebijakan Jam Kerja Sekolah Berversi (school_work_policies)
CREATE TABLE IF NOT EXISTS school_work_policies (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL DEFAULT 'smagesa',
    policy_name TEXT NOT NULL,
    work_days_count INTEGER NOT NULL DEFAULT 5,
    normal_daily_minutes INTEGER NOT NULL DEFAULT 450,
    normal_weekly_minutes INTEGER NOT NULL DEFAULT 2250,
    work_start_time TEXT NOT NULL DEFAULT '07:30',
    work_end_time TEXT NOT NULL DEFAULT '15:30',
    breaks_json TEXT NOT NULL DEFAULT '[{"name":"Istirahat 1","start":"09:45","end":"10:00","minutes":15},{"name":"Istirahat 2","start":"12:15","end":"12:30","minutes":15}]',
    jp_duration_minutes INTEGER NOT NULL DEFAULT 45,
    timezone TEXT NOT NULL DEFAULT 'Asia/Makassar',
    weekly_reporting_deadline TEXT NOT NULL DEFAULT 'end_of_week',
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    authorized_by TEXT,
    legal_basis_doc TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_school_policies_active ON school_work_policies(school_id, is_active);

-- 3. Penyesuaian Kalender Kerja Resmi (work_calendar_overrides)
CREATE TABLE IF NOT EXISTS work_calendar_overrides (
    id TEXT PRIMARY KEY,
    policy_id TEXT NOT NULL,
    date TEXT NOT NULL,
    day_type TEXT NOT NULL, -- 'holiday', 'half_day', 'special_event'
    title TEXT NOT NULL,
    reduction_minutes INTEGER NOT NULL DEFAULT 450,
    document_no TEXT NOT NULL,
    approved_by_uid TEXT NOT NULL,
    approved_by_name TEXT NOT NULL,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (policy_id) REFERENCES school_work_policies(id)
);

CREATE INDEX IF NOT EXISTS idx_cal_overrides_date ON work_calendar_overrides(date);

-- 4. Katalog Aktivitas Guru (activity_catalog) - 5 Kelompok Kegiatan Pokok
CREATE TABLE IF NOT EXISTS activity_catalog (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    category_code TEXT NOT NULL, -- 'PERENCANAAN', 'PELAKSANAAN_KBM', 'PENILAIAN', 'PEMBIMBINGAN', 'TUGAS_TAMBAHAN'
    category_name TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    default_duration_minutes INTEGER DEFAULT 45,
    is_teaching INTEGER DEFAULT 0,
    requires_evidence INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_act_cat_category ON activity_catalog(category_code, sort_order);

-- 5. Penugasan Tugas Tambahan Guru Berbasis SK (teacher_assignments)
CREATE TABLE IF NOT EXISTS teacher_assignments (
    id TEXT PRIMARY KEY,
    teacher_id TEXT NOT NULL, -- Relasi ke gtk.id
    user_uid TEXT,
    assignment_type TEXT NOT NULL, -- 'wakasek', 'kepala_lab', 'kepala_perpus', 'wali_kelas', 'guru_wali', 'pembina_osis', 'pembina_ekstra', 'guru_piket', 'koordinator_pkb'
    title TEXT NOT NULL,
    sk_number TEXT NOT NULL,
    sk_date TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    scope_target TEXT, -- Kelas / Rombel / Nama Lab
    equivalency_jp INTEGER DEFAULT 0,
    rule_code TEXT,
    status TEXT DEFAULT 'active', -- 'active', 'expired', 'revoked'
    verification_status TEXT DEFAULT 'verified',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (teacher_id) REFERENCES gtk(id)
);

CREATE INDEX IF NOT EXISTS idx_teach_asg_teacher ON teacher_assignments(teacher_id, status);
CREATE INDEX IF NOT EXISTS idx_teach_asg_type ON teacher_assignments(assignment_type);

-- 6. Root Minggu Kerja Guru (work_weeks)
CREATE TABLE IF NOT EXISTS work_weeks (
    id TEXT PRIMARY KEY,
    teacher_id TEXT NOT NULL,
    school_id TEXT NOT NULL DEFAULT 'smagesa',
    week_start_date TEXT NOT NULL, -- YYYY-MM-DD (Senin)
    week_end_date TEXT NOT NULL,   -- YYYY-MM-DD (Jumat)
    academic_year TEXT NOT NULL,   -- misal '2026/2027'
    semester TEXT NOT NULL,        -- 'Ganjil' | 'Genap'
    policy_id TEXT NOT NULL,
    target_minutes INTEGER NOT NULL DEFAULT 2250,
    approved_adjustment_minutes INTEGER NOT NULL DEFAULT 0,
    adjustment_reason TEXT,
    active_plan_version_id TEXT,
    is_locked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(teacher_id, week_start_date),
    FOREIGN KEY (teacher_id) REFERENCES gtk(id),
    FOREIGN KEY (policy_id) REFERENCES school_work_policies(id)
);

CREATE INDEX IF NOT EXISTS idx_work_weeks_teacher_start ON work_weeks(teacher_id, week_start_date);
CREATE INDEX IF NOT EXISTS idx_work_weeks_start ON work_weeks(week_start_date);

-- 7. Versi Rencana Kerja Mingguan (weekly_plan_versions)
CREATE TABLE IF NOT EXISTS weekly_plan_versions (
    id TEXT PRIMARY KEY,
    work_week_id TEXT NOT NULL,
    version_number INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'draft', -- 'draft', 'submitted', 'approved', 'revision_requested'
    revision_lock INTEGER NOT NULL DEFAULT 1,
    total_planned_minutes INTEGER NOT NULL DEFAULT 0,
    submitted_at TEXT,
    submitted_by_uid TEXT,
    reviewed_at TEXT,
    reviewed_by_uid TEXT,
    reviewed_by_name TEXT,
    review_notes TEXT,
    revision_reason TEXT,
    snapshot_data TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(work_week_id, version_number),
    FOREIGN KEY (work_week_id) REFERENCES work_weeks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_plan_versions_week ON weekly_plan_versions(work_week_id, version_number);
CREATE INDEX IF NOT EXISTS idx_plan_versions_status ON weekly_plan_versions(status);

-- 8. Identitas Kegiatan Rencana yang Stabil Lintas Revisi (plan_activities)
CREATE TABLE IF NOT EXISTS plan_activities (
    id TEXT PRIMARY KEY,
    work_week_id TEXT NOT NULL,
    catalog_id TEXT NOT NULL,
    assignment_id TEXT,
    title TEXT NOT NULL,
    category_code TEXT NOT NULL,
    origin_source TEXT NOT NULL DEFAULT 'manual', -- 'schedule', 'template', 'manual', 'directive'
    schedule_occurrence_id TEXT,
    is_cancelled INTEGER NOT NULL DEFAULT 0,
    cancellation_reason TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (work_week_id) REFERENCES work_weeks(id) ON DELETE CASCADE,
    FOREIGN KEY (catalog_id) REFERENCES activity_catalog(id),
    FOREIGN KEY (assignment_id) REFERENCES teacher_assignments(id)
);

CREATE INDEX IF NOT EXISTS idx_plan_act_week ON plan_activities(work_week_id);

-- 9. Slot Waktu Rincian Rencana per Versi (plan_time_segments)
CREATE TABLE IF NOT EXISTS plan_time_segments (
    id TEXT PRIMARY KEY,
    plan_version_id TEXT NOT NULL,
    activity_id TEXT NOT NULL,
    date TEXT NOT NULL,         -- YYYY-MM-DD nyata
    day_of_week INTEGER NOT NULL, -- 1=Senin s.d. 5=Jumat
    start_time TEXT NOT NULL,   -- HH:MM
    end_time TEXT NOT NULL,     -- HH:MM
    planned_minutes INTEGER NOT NULL,
    is_teaching INTEGER NOT NULL DEFAULT 0,
    jp_count INTEGER DEFAULT 0,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (plan_version_id) REFERENCES weekly_plan_versions(id) ON DELETE CASCADE,
    FOREIGN KEY (activity_id) REFERENCES plan_activities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_plan_seg_version ON plan_time_segments(plan_version_id, date);
CREATE INDEX IF NOT EXISTS idx_plan_seg_activity ON plan_time_segments(activity_id);
CREATE INDEX IF NOT EXISTS idx_plan_seg_date_time ON plan_time_segments(date, start_time);

-- 10. Template Mingguan Rutin Guru (weekly_templates & weekly_template_items)
CREATE TABLE IF NOT EXISTS weekly_templates (
    id TEXT PRIMARY KEY,
    teacher_id TEXT NOT NULL,
    template_name TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    total_estimated_minutes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (teacher_id) REFERENCES gtk(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_weekly_temp_teacher ON weekly_templates(teacher_id);

CREATE TABLE IF NOT EXISTS weekly_template_items (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    day_of_week INTEGER NOT NULL, -- 1 s.d. 5
    catalog_id TEXT NOT NULL,
    title TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    estimated_minutes INTEGER NOT NULL,
    is_teaching INTEGER NOT NULL DEFAULT 0,
    jp_count INTEGER DEFAULT 0,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (template_id) REFERENCES weekly_templates(id) ON DELETE CASCADE,
    FOREIGN KEY (catalog_id) REFERENCES activity_catalog(id)
);

CREATE INDEX IF NOT EXISTS idx_temp_items_template ON weekly_template_items(template_id, day_of_week);

-- 11. Entitas Realisasi Aktual Pekerjaan (work_logs)
CREATE TABLE IF NOT EXISTS work_logs (
    id TEXT PRIMARY KEY,
    work_week_id TEXT NOT NULL,
    teacher_id TEXT NOT NULL,
    date TEXT NOT NULL,          -- YYYY-MM-DD nyata
    day_of_week INTEGER NOT NULL,
    title TEXT NOT NULL,
    catalog_id TEXT NOT NULL,
    is_unplanned INTEGER NOT NULL DEFAULT 0,
    output_summary TEXT,
    evidence_url TEXT,
    status_execution TEXT NOT NULL DEFAULT 'terlaksana',
    obstacle_notes TEXT,
    verification_status TEXT NOT NULL DEFAULT 'unverified', -- 'unverified', 'verified', 'rejected'
    verified_at TEXT,
    verified_by_uid TEXT,
    verified_by_name TEXT,
    verification_notes TEXT,
    is_locked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (work_week_id) REFERENCES work_weeks(id),
    FOREIGN KEY (teacher_id) REFERENCES gtk(id),
    FOREIGN KEY (catalog_id) REFERENCES activity_catalog(id)
);

CREATE INDEX IF NOT EXISTS idx_work_logs_week ON work_logs(work_week_id, date);
CREATE INDEX IF NOT EXISTS idx_work_logs_teacher_date ON work_logs(teacher_id, date);
CREATE INDEX IF NOT EXISTS idx_work_logs_verification ON work_logs(verification_status);

-- 12. Sesi Pelaksanaan Aktual Riil (work_log_segments)
CREATE TABLE IF NOT EXISTS work_log_segments (
    id TEXT PRIMARY KEY,
    work_log_id TEXT NOT NULL,
    start_time TEXT NOT NULL, -- HH:MM
    end_time TEXT NOT NULL,   -- HH:MM
    actual_minutes INTEGER NOT NULL,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (work_log_id) REFERENCES work_logs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_log_segments_log ON work_log_segments(work_log_id);

-- 13. Relasi Rencana ↔ Realisasi (plan_log_links)
CREATE TABLE IF NOT EXISTS plan_log_links (
    id TEXT PRIMARY KEY,
    plan_activity_id TEXT NOT NULL,
    work_log_id TEXT NOT NULL,
    link_type TEXT NOT NULL DEFAULT 'fulfillment', -- 'fulfillment', 'substitution', 'partial', 'not_done'
    reason_notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(plan_activity_id, work_log_id),
    FOREIGN KEY (plan_activity_id) REFERENCES plan_activities(id) ON DELETE CASCADE,
    FOREIGN KEY (work_log_id) REFERENCES work_logs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_plan_log_plan ON plan_log_links(plan_activity_id);
CREATE INDEX IF NOT EXISTS idx_plan_log_log ON plan_log_links(work_log_id);

-- 14. Log Jejak Audit Beban Kerja (workload_audit_logs)
CREATE TABLE IF NOT EXISTS workload_audit_logs (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL, -- 'plan_version', 'work_log', 'policy', 'assignment'
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL,      -- 'create', 'update', 'submit', 'approve', 'request_revision', 'verify', 'reject', 'override'
    actor_uid TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    details TEXT,              -- JSON String
    timestamp TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_workload_audit_entity ON workload_audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_workload_audit_actor ON workload_audit_logs(actor_uid);
CREATE INDEX IF NOT EXISTS idx_workload_audit_time ON workload_audit_logs(timestamp);

-- 15. Pendelegasian Wewenang Pemeriksaan (workload_delegations)
CREATE TABLE IF NOT EXISTS workload_delegations (
    id TEXT PRIMARY KEY,
    delegator_uid TEXT NOT NULL,
    delegatee_uid TEXT NOT NULL,
    delegatee_name TEXT NOT NULL,
    permission_scope TEXT NOT NULL DEFAULT 'review_all', -- 'review_all', 'review_plan', 'review_logs'
    sk_number TEXT NOT NULL,
    valid_from TEXT NOT NULL,
    valid_until TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', -- 'active', 'revoked', 'expired'
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_workload_delegation_delegatee ON workload_delegations(delegatee_uid, status, valid_until);
 
-- 16. Master Butir Tugas Dinamis Wakil Kepala Sekolah (waka_duty_items)
CREATE TABLE IF NOT EXISTS waka_duty_items (
    id TEXT PRIMARY KEY,
    waka_type TEXT NOT NULL,           -- 'kurikulum' | 'kesiswaan' | 'sarpras' | 'humas'
    duty_number INTEGER NOT NULL,      -- Urutan butir tugas (1, 2, 3...)
    duty_title TEXT NOT NULL,          -- Judul / uraian ringkas butir tugas
    duty_description TEXT DEFAULT '',  -- Deskripsi ruang lingkup / rincian tugas
    is_active INTEGER DEFAULT 1,       -- 1 = aktif, 0 = nonaktif
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_waka_duty_type ON waka_duty_items(waka_type, is_active, duty_number);

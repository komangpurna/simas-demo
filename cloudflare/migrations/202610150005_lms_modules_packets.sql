CREATE TABLE IF NOT EXISTS lms_modules (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL REFERENCES lms_topics(id) ON DELETE CASCADE,
    teacher_id TEXT NOT NULL, teacher_name TEXT NOT NULL,
    subject_name TEXT NOT NULL, class_name TEXT NOT NULL,
    title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    is_visible INTEGER NOT NULL DEFAULT 1 CHECK(is_visible IN (0,1)),
    publish_at TEXT NOT NULL DEFAULT '', due_date TEXT NOT NULL DEFAULT '',
    is_teaching_completed INTEGER NOT NULL DEFAULT 0 CHECK(is_teaching_completed IN (0,1)),
    teaching_completed_at TEXT NOT NULL DEFAULT '', order_index INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 0, last_request_id TEXT NOT NULL DEFAULT '',
    is_deleted INTEGER NOT NULL DEFAULT 0 CHECK(is_deleted IN (0,1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
ALTER TABLE lms_materials ADD COLUMN module_id TEXT REFERENCES lms_modules(id);
ALTER TABLE lms_materials ADD COLUMN material_enabled INTEGER DEFAULT NULL CHECK(material_enabled IN (0,1));
ALTER TABLE lms_materials ADD COLUMN quiz_enabled INTEGER DEFAULT NULL CHECK(quiz_enabled IN (0,1));
ALTER TABLE lms_materials ADD COLUMN instructions TEXT NOT NULL DEFAULT '';
ALTER TABLE lms_materials ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0 CHECK(is_archived IN (0,1));
CREATE INDEX IF NOT EXISTS idx_lms_modules_scope ON lms_modules(class_name,subject_name,teacher_id,topic_id,order_index);
CREATE INDEX IF NOT EXISTS idx_lms_packet_module ON lms_materials(module_id,is_archived,order_index);

-- Keep every original packet ID: attempts, discussion and progress are untouched.
INSERT OR IGNORE INTO lms_modules(id,topic_id,teacher_id,teacher_name,subject_name,class_name,title,
    is_visible,publish_at,due_date,is_teaching_completed,teaching_completed_at,order_index,created_at,updated_at)
SELECT 'legacy_' || id,topic_id,teacher_id,teacher_name,subject_name,class_name,title,
    CASE WHEN is_published=0 THEN 0 ELSE 1 END,publish_at,due_date,is_teaching_completed,
    teaching_completed_at,order_index,created_at,updated_at FROM lms_materials WHERE module_id IS NULL;
UPDATE lms_materials SET module_id='legacy_' || id,
    material_enabled=CASE WHEN resource_type='quiz' THEN 0 ELSE 1 END,
    quiz_enabled=CASE WHEN resource_type='quiz' THEN 1 ELSE 0 END,
    instructions=CASE WHEN resource_type='quiz' THEN content_description ELSE '' END
WHERE module_id IS NULL;

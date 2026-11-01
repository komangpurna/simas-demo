-- Match the existing case/whitespace-insensitive student learning-path filters.
-- Keep separate class-only and class/subject indexes so both views retain their
-- ORDER BY order_index, created_at without a temporary sort.
CREATE INDEX IF NOT EXISTS idx_lms_mat_class_norm_order
ON lms_materials(LOWER(TRIM(class_name)), order_index, created_at)
WHERE is_published IN (1, 2) AND is_archived = 0;

CREATE INDEX IF NOT EXISTS idx_lms_mat_class_subject_norm_order
ON lms_materials(LOWER(TRIM(class_name)), LOWER(TRIM(subject_name)), order_index, created_at)
WHERE is_published IN (1, 2) AND is_archived = 0;

CREATE INDEX IF NOT EXISTS idx_lms_top_class_norm_order
ON lms_topics(LOWER(TRIM(class_name)), order_index, created_at);

CREATE INDEX IF NOT EXISTS idx_lms_top_class_subject_norm_order
ON lms_topics(LOWER(TRIM(class_name)), LOWER(TRIM(subject_name)), order_index, created_at);

-- Cover both discussion counts without loading other students' comment rows.
CREATE INDEX IF NOT EXISTS idx_lms_disc_mat_visible_user
ON lms_discussions(material_id, is_hidden, user_id, user_role);

-- Preserve pinned-first/oldest-first discussion ordering through the index.
CREATE INDEX IF NOT EXISTS idx_lms_disc_mat_visible_order
ON lms_discussions(material_id, is_hidden, is_pinned DESC, created_at ASC);

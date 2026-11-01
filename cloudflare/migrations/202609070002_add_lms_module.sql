-- ====================================================================
-- SIMAS SMAGESA - CLOUDFLARE D1 DATABASE MIGRATION
-- 202609070002_add_lms_module.sql
-- Modul LMS: Topik, Modul Materi, Progres Siswa, Durasi Aktif & Forum Diskusi
-- Dilengkapi Indeks Akselerasi, Constraint Integritas & Indeks Auto-Cleanup 3 Tahun
-- ====================================================================

-- 1. Tabel Topik / Bab Pembelajaran (lms_topics)
CREATE TABLE IF NOT EXISTS lms_topics (
    id TEXT PRIMARY KEY,
    teacher_id TEXT NOT NULL,
    teacher_name TEXT NOT NULL,
    subject_name TEXT NOT NULL,
    class_name TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    order_index INTEGER DEFAULT 0,
    academic_year TEXT DEFAULT '2026/2027',
    semester TEXT DEFAULT 'Ganjil',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lms_top_teacher ON lms_topics(teacher_id);
CREATE INDEX IF NOT EXISTS idx_lms_top_class_subject ON lms_topics(class_name, subject_name);
CREATE INDEX IF NOT EXISTS idx_lms_top_created ON lms_topics(created_at);

-- 2. Tabel Modul & Materi Pembelajaran (lms_materials)
CREATE TABLE IF NOT EXISTS lms_materials (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL,
    teacher_id TEXT NOT NULL,
    teacher_name TEXT NOT NULL,
    subject_name TEXT NOT NULL,
    class_name TEXT NOT NULL,
    title TEXT NOT NULL,
    content_description TEXT DEFAULT '',
    resource_type TEXT DEFAULT 'gdrive', -- 'gdrive', 'youtube', 'link', 'text'
    resource_url TEXT DEFAULT '',
    is_published INTEGER DEFAULT 1 CHECK (is_published IN (0, 1, 2)), -- 0: Draft, 1: Published, 2: Scheduled
    publish_at TEXT DEFAULT '',          -- Waktu rilis terjadwal (ISO 8601 / WITA)
    allow_discussion INTEGER DEFAULT 0 CHECK (allow_discussion IN (0, 1)), -- 0: Nonaktif, 1: Aktif
    discussion_prompt TEXT DEFAULT '',   -- Pertanyaan pemantik acuan diskusi
    due_date TEXT DEFAULT '',            -- Batas target penyelesaian (YYYY-MM-DD)
    is_teaching_completed INTEGER DEFAULT 0 CHECK (is_teaching_completed IN (0, 1)), -- Status pembahasan guru
    order_index INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (topic_id) REFERENCES lms_topics(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lms_mat_topic ON lms_materials(topic_id);
CREATE INDEX IF NOT EXISTS idx_lms_mat_class_subj ON lms_materials(class_name, subject_name);
CREATE INDEX IF NOT EXISTS idx_lms_mat_teacher ON lms_materials(teacher_id);
CREATE INDEX IF NOT EXISTS idx_lms_mat_published ON lms_materials(is_published);
CREATE INDEX IF NOT EXISTS idx_lms_mat_class_published ON lms_materials(class_name, is_published, subject_name);
CREATE INDEX IF NOT EXISTS idx_lms_mat_learning_path ON lms_materials(class_name, subject_name, is_published, topic_id, order_index);
CREATE INDEX IF NOT EXISTS idx_lms_mat_created ON lms_materials(created_at);

-- 3. Tabel Progres Pembelajaran Siswa (lms_progress)
CREATE TABLE IF NOT EXISTS lms_progress (
    id TEXT PRIMARY KEY,
    material_id TEXT NOT NULL,
    topic_id TEXT NOT NULL,
    student_nis TEXT NOT NULL,
    student_name TEXT NOT NULL,
    student_class TEXT NOT NULL,
    status TEXT DEFAULT 'opened' CHECK (status IN ('opened', 'completed')),
    first_opened_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT DEFAULT '',
    last_accessed_at TEXT DEFAULT (datetime('now')),
    active_seconds_total INTEGER DEFAULT 0, -- Total akumulasi detik belajar aktif
    session_count INTEGER DEFAULT 0,        -- Total sesi pembukaan modul
    last_session_id TEXT DEFAULT '',        -- ID sesi terakhir (idempotensi durasi)
    last_session_seconds INTEGER DEFAULT 0, -- Detik terlapor terakhir pada sesi berjalan
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(material_id, student_nis),
    FOREIGN KEY (material_id) REFERENCES lms_materials(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lms_prog_mat ON lms_progress(material_id);
CREATE INDEX IF NOT EXISTS idx_lms_prog_nis ON lms_progress(student_nis);
CREATE INDEX IF NOT EXISTS idx_lms_prog_class ON lms_progress(student_class);
CREATE INDEX IF NOT EXISTS idx_lms_prog_status ON lms_progress(status);
CREATE INDEX IF NOT EXISTS idx_lms_prog_mat_nis ON lms_progress(material_id, student_nis);
CREATE INDEX IF NOT EXISTS idx_lms_prog_mat_student_status ON lms_progress(material_id, student_nis, status);
CREATE INDEX IF NOT EXISTS idx_lms_prog_created ON lms_progress(created_at);

-- 4. Tabel Ruang Diskusi Terstruktur (lms_discussions)
CREATE TABLE IF NOT EXISTS lms_discussions (
    id TEXT PRIMARY KEY,
    material_id TEXT NOT NULL,
    parent_id TEXT DEFAULT NULL,       -- NULL: Komentar Pokok, Non-NULL: Balasan Komentar
    user_id TEXT NOT NULL,             -- NIP/UID Guru atau NIS Siswa
    user_name TEXT NOT NULL,
    user_role TEXT NOT NULL,           -- 'guru' atau 'siswa'
    content TEXT NOT NULL,
    is_pinned INTEGER DEFAULT 0 CHECK (is_pinned IN (0, 1)),       -- 1: Disematkan oleh Guru
    is_hidden INTEGER DEFAULT 0 CHECK (is_hidden IN (0, 1)),       -- 1: Disembunyikan oleh Moderator
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (material_id) REFERENCES lms_materials(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES lms_discussions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lms_disc_mat ON lms_discussions(material_id);
CREATE INDEX IF NOT EXISTS idx_lms_disc_parent ON lms_discussions(parent_id);
CREATE INDEX IF NOT EXISTS idx_lms_disc_user ON lms_discussions(user_id);
CREATE INDEX IF NOT EXISTS idx_lms_disc_pinned ON lms_discussions(is_pinned);
CREATE INDEX IF NOT EXISTS idx_lms_disc_created ON lms_discussions(created_at);
CREATE INDEX IF NOT EXISTS idx_lms_disc_mat_hidden_parent ON lms_discussions(material_id, is_hidden, parent_id);

-- ====================================================================
-- TRIGGERS INTEGRITAS DATA & KASKADE
-- ====================================================================

-- Validasi Nilai Boolean/Enum Materi LMS
CREATE TRIGGER IF NOT EXISTS trg_lms_materials_validate_insert
BEFORE INSERT ON lms_materials
WHEN NEW.is_published NOT IN (0, 1, 2)
  OR NEW.allow_discussion NOT IN (0, 1)
  OR NEW.is_teaching_completed NOT IN (0, 1)
BEGIN
    SELECT RAISE(ABORT, 'Nilai status materi LMS harus 0 (Draft), 1 (Published), atau 2 (Scheduled)');
END;

CREATE TRIGGER IF NOT EXISTS trg_lms_materials_validate_update
BEFORE UPDATE OF is_published, allow_discussion, is_teaching_completed ON lms_materials
WHEN NEW.is_published NOT IN (0, 1, 2)
  OR NEW.allow_discussion NOT IN (0, 1)
  OR NEW.is_teaching_completed NOT IN (0, 1)
BEGIN
    SELECT RAISE(ABORT, 'Nilai status materi LMS harus 0 (Draft), 1 (Published), atau 2 (Scheduled)');
END;

-- Validasi Status Progres LMS
CREATE TRIGGER IF NOT EXISTS trg_lms_progress_validate_insert
BEFORE INSERT ON lms_progress
WHEN NEW.status NOT IN ('opened', 'completed')
BEGIN
    SELECT RAISE(ABORT, 'Status progres LMS tidak valid (harus opened atau completed)');
END;

CREATE TRIGGER IF NOT EXISTS trg_lms_progress_validate_update
BEFORE UPDATE OF status ON lms_progress
WHEN NEW.status NOT IN ('opened', 'completed')
BEGIN
    SELECT RAISE(ABORT, 'Status progres LMS tidak valid (harus opened atau completed)');
END;

-- Validasi Integritas Forum Diskusi
CREATE TRIGGER IF NOT EXISTS trg_lms_discussions_validate_insert
BEFORE INSERT ON lms_discussions
WHEN NEW.is_pinned NOT IN (0, 1)
    OR NEW.is_hidden NOT IN (0, 1)
    OR (
        NEW.parent_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM lms_discussions WHERE id = NEW.parent_id)
    )
BEGIN
    SELECT RAISE(ABORT, 'Nilai atau induk diskusi LMS tidak valid');
END;

CREATE TRIGGER IF NOT EXISTS trg_lms_discussions_validate_update
BEFORE UPDATE OF is_pinned, is_hidden, parent_id ON lms_discussions
WHEN NEW.is_pinned NOT IN (0, 1)
    OR NEW.is_hidden NOT IN (0, 1)
    OR (
        NEW.parent_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM lms_discussions WHERE id = NEW.parent_id)
    )
BEGIN
    SELECT RAISE(ABORT, 'Nilai atau induk diskusi LMS tidak valid');
END;

-- Kaskade Penghapusan Anak Tanggapan Diskusi
CREATE TRIGGER IF NOT EXISTS trg_lms_discussions_delete_children
AFTER DELETE ON lms_discussions
BEGIN
    DELETE FROM lms_discussions WHERE parent_id = OLD.id;
END;

PRAGMA optimize;

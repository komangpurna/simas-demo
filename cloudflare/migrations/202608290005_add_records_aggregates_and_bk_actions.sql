-- ====================================================================
-- MIGRATION: 202608290005_add_records_aggregates_and_bk_actions.sql
-- Description: Menambahkan tabel records, student_aggregates, dan bk_actions
-- ====================================================================

-- 1. Tabel Records (Pelanggaran, Prestasi, Permisi Siswa)
CREATE TABLE IF NOT EXISTS records (
    id TEXT PRIMARY KEY,
    student_nis TEXT NOT NULL,
    student_name TEXT,
    student_class TEXT,
    category TEXT NOT NULL,       -- 'Pelanggaran' | 'Prestasi' | 'Permisi'
    type TEXT,                    -- Jenis/Pasal Pelanggaran, Tingkat Prestasi, atau Detail Permisi
    points INTEGER DEFAULT 0,
    desc TEXT,
    reporter_uid TEXT,
    reporter_name TEXT,
    date TEXT NOT NULL,           -- Format 'YYYY-MM-DD'
    timestamp TEXT NOT NULL,       -- Format ISO 8601 string
    photo_url TEXT,
    status TEXT DEFAULT 'active',
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_by TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_records_student_nis ON records(student_nis);
CREATE INDEX IF NOT EXISTS idx_records_category ON records(category);
CREATE INDEX IF NOT EXISTS idx_records_date ON records(date);
CREATE INDEX IF NOT EXISTS idx_records_timestamp ON records(timestamp);
CREATE INDEX IF NOT EXISTS idx_records_student_category ON records(student_nis, category);
CREATE INDEX IF NOT EXISTS idx_records_created_at ON records(created_at);

-- 2. Tabel Student Aggregates (Agregat Poin & Statistik Kedisiplinan Siswa)
CREATE TABLE IF NOT EXISTS student_aggregates (
    student_nis TEXT PRIMARY KEY,
    points INTEGER DEFAULT 0,
    violation_count INTEGER DEFAULT 0,
    achievement_count INTEGER DEFAULT 0,
    permission_count INTEGER DEFAULT 0,
    last_record_at TEXT,
    last_updated TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_student_aggregates_points ON student_aggregates(points);

-- 3. Tabel BK Actions (Layanan Kasus BK & Timeline Follow-up)
CREATE TABLE IF NOT EXISTS bk_actions (
    id TEXT PRIMARY KEY,
    student_nis TEXT NOT NULL,
    student_name TEXT,
    student_class TEXT,
    problem TEXT,                 -- Deskripsi Masalah/Kasus Siswa
    bimbingan_type TEXT DEFAULT 'Pribadi', -- 'Pribadi' | 'Sosial' | 'Belajar' | 'Karir'
    service_type TEXT,            -- 'Konseling Individu' | 'Panggilan Orang Tua' | 'Bimbingan Kelompok' | 'Home Visit' | 'Konferensi Kasus' | 'Alih Tangan Kasus'
    date TEXT NOT NULL,           -- 'YYYY-MM-DD' (Tanggal kasus / tanggal follow-up terakhir)
    status TEXT DEFAULT 'Dalam Pantauan', -- 'Dalam Pantauan' | 'Selesai'
    notes TEXT,
    counselor_name TEXT,
    counselor_uid TEXT,
    follow_up_history TEXT DEFAULT '[]', -- JSON Array: [ { bimbinganType, serviceType, date, notes, counselorName, timestamp } ]
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bk_actions_student_nis ON bk_actions(student_nis);
CREATE INDEX IF NOT EXISTS idx_bk_actions_status ON bk_actions(status);
CREATE INDEX IF NOT EXISTS idx_bk_actions_date ON bk_actions(date);
CREATE INDEX IF NOT EXISTS idx_bk_actions_created_at ON bk_actions(created_at);

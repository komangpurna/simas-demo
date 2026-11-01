-- Migrasi D1: Menambahkan Tabel Modul Buku Tahunan (Yearbook) Kelas XII & Arsip Abadi PDF
-- Standar: SSOT, Zero Bloat, Indexing optimal untuk query per tahun ajaran & rombel

-- 1. Tabel Profil Yearbook Siswa
CREATE TABLE IF NOT EXISTS yearbook_profiles (
    nis TEXT PRIMARY KEY,
    academic_year TEXT NOT NULL,
    casual_photo_url TEXT,
    quote TEXT,
    ambition TEXT,
    dream_campus TEXT,
    social_media TEXT, -- JSON string: { "instagram": "", "tiktok": "", "spotify": "" }
    status TEXT DEFAULT 'draft', -- draft, submitted, approved
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_yearbook_profiles_year ON yearbook_profiles(academic_year);
CREATE INDEX IF NOT EXISTS idx_yearbook_profiles_status ON yearbook_profiles(status);

-- 2. Tabel Pesan Kenangan Antar Siswa (Digital Autograph / Wall of Memories)
CREATE TABLE IF NOT EXISTS yearbook_messages (
    id TEXT PRIMARY KEY,
    academic_year TEXT NOT NULL,
    target_nis TEXT NOT NULL,
    sender_nis TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    sender_class TEXT NOT NULL,
    message TEXT NOT NULL,
    is_approved INTEGER DEFAULT 0, -- 0: pending review siswa, 1: disetujui untuk dicetak
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_yearbook_messages_target ON yearbook_messages(target_nis, academic_year);
CREATE INDEX IF NOT EXISTS idx_yearbook_messages_sender ON yearbook_messages(sender_nis);
CREATE INDEX IF NOT EXISTS idx_yearbook_messages_approved ON yearbook_messages(target_nis, is_approved);

-- 3. Tabel Katalog Arsip Master PDF Buku Tahunan (Abadi & Publik)
CREATE TABLE IF NOT EXISTS yearbook_archives (
    academic_year TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    batch_name TEXT,
    theme_name TEXT,
    cover_url TEXT,
    pdf_url TEXT NOT NULL,
    total_students INTEGER DEFAULT 0,
    is_public INTEGER DEFAULT 1,
    published_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_yearbook_archives_public ON yearbook_archives(is_public);

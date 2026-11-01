-- ====================================================================
-- SIMAS SMAGESA - CLOUDFLARE D1 DATABASE MIGRATION
-- Modul: Peminatan Siswa & Portal Game Interaktif (PID Games)
-- ====================================================================

-- 1. Tabel PID Games (Katalog Game Edukatif)
CREATE TABLE IF NOT EXISTS pid_games (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL,          -- JSON array string misal '["kreativitas"]' atau string 'kreativitas'
    subject TEXT,                    -- Mata pelajaran terkait
    url TEXT NOT NULL,
    thumbnail_url TEXT,
    author TEXT,
    is_active INTEGER DEFAULT 1,     -- 1: aktif, 0: nonaktif/arsip
    review_status TEXT DEFAULT 'approved', -- 'pending', 'approved', 'rejected'
    review_note TEXT,
    submitted_by_uid TEXT,
    submitted_by_name TEXT,
    submitted_by_role TEXT,
    submitted_at TEXT,
    reviewed_by_uid TEXT,
    reviewed_by_name TEXT,
    reviewed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pid_games_active ON pid_games(is_active, review_status);
CREATE INDEX IF NOT EXISTS idx_pid_games_category ON pid_games(category);
CREATE INDEX IF NOT EXISTS idx_pid_games_created ON pid_games(created_at);

-- 2. Tabel Peminatan Config (Bank Soal, Bobot, Layout, Status Kuesioner)
CREATE TABLE IF NOT EXISTS peminatan_config (
    id TEXT PRIMARY KEY,             -- Default 'questions'
    is_active INTEGER DEFAULT 1,     -- 1: Buka, 0: Tutup
    layout TEXT DEFAULT 'classic',   -- 'classic' atau 'wizard'
    items TEXT NOT NULL,             -- JSON array bank soal kuesioner
    weights TEXT,                    -- JSON object bobot aspek
    updated_by TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 3. Tabel Peminatan Responses (Respon Kuesioner Siswa per Tahun)
CREATE TABLE IF NOT EXISTS peminatan_responses (
    id TEXT PRIMARY KEY,             -- Format '${year}_${nis}' misal '2026_0968'
    year TEXT NOT NULL,              -- Tahun kalender kuesioner misal '2026'
    ta TEXT,                         -- Tahun Ajaran misal '2025/2026'
    nis TEXT NOT NULL,
    name TEXT NOT NULL,
    class TEXT,
    recommendation TEXT,             -- Hasil rekomendasi misal 'IPA', 'IPS', 'Bahasa'
    scores TEXT NOT NULL,            -- JSON object skor per aspek & total
    responses TEXT NOT NULL,         -- JSON object jawaban per butir soal
    submitted_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_peminatan_year_nis ON peminatan_responses(year, nis);
CREATE INDEX IF NOT EXISTS idx_peminatan_nis ON peminatan_responses(nis);
CREATE INDEX IF NOT EXISTS idx_peminatan_class ON peminatan_responses(class);
CREATE INDEX IF NOT EXISTS idx_peminatan_recommendation ON peminatan_responses(recommendation);
CREATE INDEX IF NOT EXISTS idx_peminatan_year ON peminatan_responses(year);

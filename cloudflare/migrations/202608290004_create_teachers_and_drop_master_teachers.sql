-- ============================================================================
-- Migration: 202608290004_create_teachers_and_drop_master_teachers.sql
-- Tujuan: Membuat Tabel Master Teachers Lengkap (Pure SSOT) di Cloudflare D1
--         dan Menghapus Tabel Sementara master_teachers
-- ============================================================================

CREATE TABLE IF NOT EXISTS teachers (
    id TEXT PRIMARY KEY,                          -- NIK (16 digit), NIP, atau ID dokumen
    nik TEXT,
    nip TEXT,
    nuptk TEXT,
    name TEXT NOT NULL,
    gender TEXT DEFAULT 'L',                      -- 'L' / 'P'
    birth_place TEXT,
    birth_date TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    jenis_ptk TEXT DEFAULT 'Pendidik',            -- 'Guru Mapel', 'Guru BK', 'Kepala Sekolah', 'TAS', dll.
    status_kepegawaian TEXT DEFAULT 'Honorer',    -- 'PNS', 'PPPK', 'GTT', 'PTT', 'Honorer'
    pendidikan_terakhir TEXT,
    mapel TEXT,
    role TEXT DEFAULT 'guru_mapel',
    telegram_chat_id TEXT,
    notes TEXT,
    status TEXT DEFAULT 'active',                -- 'active' / 'inactive' / 'pensiun' / 'mutasi'
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_teachers_nik ON teachers(nik);
CREATE INDEX IF NOT EXISTS idx_teachers_nip ON teachers(nip);
CREATE INDEX IF NOT EXISTS idx_teachers_nuptk ON teachers(nuptk);
CREATE INDEX IF NOT EXISTS idx_teachers_name ON teachers(name);
CREATE INDEX IF NOT EXISTS idx_teachers_email ON teachers(email);
CREATE INDEX IF NOT EXISTS idx_teachers_status ON teachers(status);

-- 1. Migrasikan data yang ada di master_teachers ke teachers (jika ada)
INSERT OR IGNORE INTO teachers (id, nik, nip, nuptk, name, email, role, mapel, status, created_at, updated_at)
SELECT uid AS id, '' AS nik, nip, '' AS nuptk, nama AS name, email, role, mapel, status, created_at, updated_at
FROM master_teachers;

-- 2. Hapus tabel master_teachers lama (Jurnal Mengajar murni SSOT ke tabel teachers)
DROP TABLE IF EXISTS master_teachers;

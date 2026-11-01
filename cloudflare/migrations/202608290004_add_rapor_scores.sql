-- Migration: 202608290004_add_rapor_scores.sql
-- Menambahkan tabel rapor_scores untuk migrasi penuh Modul E-Rapor ke Cloudflare D1 (SSOT)

CREATE TABLE IF NOT EXISTS rapor_scores (
    id TEXT PRIMARY KEY,                       -- Format deterministik: {class}_{nis}_{tahun_ajaran}
    nis TEXT NOT NULL,                         -- NIS Siswa (FK students.nis)
    name TEXT NOT NULL,                        -- Nama Lengkap Siswa
    class TEXT NOT NULL,                       -- Nama Kelas (misal: XII-1, X-5)
    tahun_ajaran TEXT NOT NULL,                -- Tahun Ajaran (misal: 2026/2027)
    scores_teori TEXT DEFAULT '{}',            -- JSON serialized: { [safeMapelKey]: number }
    scores_praktik TEXT DEFAULT '{}',          -- JSON serialized: { [safeMapelKey]: number }
    teacher_info_teori TEXT DEFAULT '{}',      -- JSON: { [safeMapelKey]: { uid, name, updated_at } }
    teacher_info_praktik TEXT DEFAULT '{}',    -- JSON: { [safeMapelKey]: { uid, name, updated_at } }
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, -- Timestamp pembuatan record
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP  -- Timestamp perubahan terakhir
);

-- Indeks performa untuk query cepat rekap leger, kelas, dan siswa
CREATE INDEX IF NOT EXISTS idx_rapor_scores_class_ta ON rapor_scores(class, tahun_ajaran);
CREATE INDEX IF NOT EXISTS idx_rapor_scores_nis ON rapor_scores(nis);
CREATE INDEX IF NOT EXISTS idx_rapor_scores_ta ON rapor_scores(tahun_ajaran);

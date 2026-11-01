-- ====================================================================
-- SIMAS SMAGESA - CLOUDFLARE D1 DATABASE SCHEMA MIGRATION
-- Migration: Add Perwalian Guru Wali, Catatan Rapor Wali Kelas, & Permisi Siswa
-- Version: 202608290006
-- ====================================================================

-- 1. Tabel Penugasan Guru Wali ↔ Siswa Binaan
CREATE TABLE IF NOT EXISTS guru_wali_assignments (
    id TEXT PRIMARY KEY,             -- Format: {guru_uid}_{student_nis}
    guru_uid TEXT NOT NULL,
    guru_name TEXT NOT NULL,
    guru_nip TEXT DEFAULT '',
    student_nis TEXT NOT NULL,
    student_name TEXT NOT NULL,
    student_class TEXT NOT NULL,
    academic_year TEXT NOT NULL,     -- Contoh: '2026/2027'
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_guru_wali_assign_guru ON guru_wali_assignments(guru_uid, academic_year);
CREATE INDEX IF NOT EXISTS idx_guru_wali_assign_student ON guru_wali_assignments(student_nis);
CREATE INDEX IF NOT EXISTS idx_guru_wali_assign_class ON guru_wali_assignments(student_class);

-- 2. Tabel Catatan Pembinaan & Mentoring Guru Wali
CREATE TABLE IF NOT EXISTS guru_wali_notes (
    id TEXT PRIMARY KEY,             -- UUID
    guru_uid TEXT NOT NULL,
    guru_name TEXT NOT NULL,
    student_nis TEXT NOT NULL,
    student_name TEXT NOT NULL,
    student_class TEXT NOT NULL,
    date TEXT NOT NULL,              -- YYYY-MM-DD
    category TEXT DEFAULT 'Umum',    -- Akademik, Karakter, Kedisiplinan, Sosial, Umum
    notes TEXT NOT NULL,
    follow_up TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_guru_wali_notes_student ON guru_wali_notes(student_nis, date);
CREATE INDEX IF NOT EXISTS idx_guru_wali_notes_guru ON guru_wali_notes(guru_uid);
CREATE INDEX IF NOT EXISTS idx_guru_wali_notes_date ON guru_wali_notes(date);

-- 3. Tabel Catatan Narasi Rapor Wali Kelas (Semester)
CREATE TABLE IF NOT EXISTS walikelas_notes (
    id TEXT PRIMARY KEY,             -- Format: {student_nis}_{academic_year}_{semester}
    student_nis TEXT NOT NULL,
    student_name TEXT NOT NULL,
    student_class TEXT NOT NULL,
    academic_year TEXT NOT NULL,     -- Contoh: '2026/2027'
    semester TEXT NOT NULL,          -- '1' / '2' atau 'Ganjil' / 'Genap'
    notes TEXT NOT NULL,             -- Narasi Rapor Wali Kelas (termasuk hasil generate AI Gemini)
    academic_notes TEXT DEFAULT '',
    character_notes TEXT DEFAULT '',
    attendance_notes TEXT DEFAULT '',
    created_by_uid TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_walikelas_notes_lookup ON walikelas_notes(student_nis, academic_year, semester);
CREATE INDEX IF NOT EXISTS idx_walikelas_notes_class ON walikelas_notes(student_class, academic_year, semester);

-- 4. Tabel Alur Permisi Siswa 2 Tahap
CREATE TABLE IF NOT EXISTS permisi_requests (
    id TEXT PRIMARY KEY,             -- UUID
    student_nis TEXT NOT NULL,
    student_name TEXT NOT NULL,
    student_class TEXT NOT NULL,
    permission_type TEXT NOT NULL,   -- Sakit, Keperluan Keluarga, Dinas/Lomba, Lainnya
    reason TEXT NOT NULL,
    date TEXT NOT NULL,              -- YYYY-MM-DD
    time_out TEXT NOT NULL,          -- Jam Keluar misal '09:30'
    time_in TEXT DEFAULT '',         -- Jam Kembali / Estimasi
    status TEXT DEFAULT 'pending_wali', -- 'pending_wali', 'wali_approved', 'wali_rejected', 'approved', 'rejected'
    wali_approved_by TEXT DEFAULT '',
    wali_approved_at TEXT DEFAULT '',
    wali_note TEXT DEFAULT '',
    piket_approved_by TEXT DEFAULT '',
    piket_approved_at TEXT DEFAULT '',
    piket_note TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_permisi_date_status ON permisi_requests(date, status);
CREATE INDEX IF NOT EXISTS idx_permisi_student ON permisi_requests(student_nis, date);
CREATE INDEX IF NOT EXISTS idx_permisi_class_date ON permisi_requests(student_class, date);

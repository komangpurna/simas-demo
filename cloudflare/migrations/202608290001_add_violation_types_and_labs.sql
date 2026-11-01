-- ====================================================================
-- SIMAS SMAGESA - MIGRATION 202608290001
-- Penambahan Tabel Master Jenis Pelanggaran (violation_types)
-- dan E-Laboratorium (labs & lab_bookings) di Cloudflare D1
-- ====================================================================

-- 1. Tabel Master Jenis Pelanggaran (violation_types)
CREATE TABLE IF NOT EXISTS violation_types (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT DEFAULT 'Umum', -- Pelanggaran Ringan, Pelanggaran Sedang, Pelanggaran Berat, Umum
    points INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_violation_types_code ON violation_types(code);
CREATE INDEX IF NOT EXISTS idx_violation_types_category ON violation_types(category);

-- 2. Tabel Master Ruang Laboratorium (labs)
CREATE TABLE IF NOT EXISTS labs (
    id TEXT PRIMARY KEY,
    nama TEXT NOT NULL,
    deskripsi TEXT,
    urutan INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_labs_urutan ON labs(urutan);

-- 3. Tabel Pengajuan & Jadwal Peminjaman Lab (lab_bookings)
CREATE TABLE IF NOT EXISTS lab_bookings (
    id TEXT PRIMARY KEY,
    lab_id TEXT NOT NULL,
    lab_nama TEXT,
    tanggal TEXT NOT NULL,       -- Format YYYY-MM-DD
    jam_mulai INTEGER NOT NULL,  -- JP Mulai (1-10)
    jam_selesai INTEGER NOT NULL,-- JP Selesai (1-10)
    kelas TEXT NOT NULL,
    kegiatan TEXT NOT NULL,
    catatan TEXT,
    pemohon_uid TEXT NOT NULL,
    pemohon_nama TEXT,
    status TEXT DEFAULT 'pending', -- pending, approved, rejected, conflict, auto_rejected
    alasan_penolakan TEXT,
    diajukan_pada TEXT DEFAULT (datetime('now')),
    diproses_pada TEXT,
    diproses_oleh TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lab_bookings_tanggal ON lab_bookings(tanggal);
CREATE INDEX IF NOT EXISTS idx_lab_bookings_lab_id ON lab_bookings(lab_id);
CREATE INDEX IF NOT EXISTS idx_lab_bookings_status ON lab_bookings(status);
CREATE INDEX IF NOT EXISTS idx_lab_bookings_pemohon_uid ON lab_bookings(pemohon_uid);

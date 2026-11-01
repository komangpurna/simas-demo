-- Migrasi D1: Menambahkan Tabel student_photos untuk Kartu Siswa Digital & Manajemen Foto R2
CREATE TABLE IF NOT EXISTS student_photos (
    nis TEXT PRIMARY KEY,
    active_photo_url TEXT,
    pending_photo_url TEXT,
    status TEXT DEFAULT 'none', -- none, pending, verified, rejected
    rejection_reason TEXT,
    public_token TEXT UNIQUE,
    uploaded_at TEXT,
    verified_at TEXT,
    verified_by_uid TEXT,
    verified_by_name TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_student_photos_token ON student_photos(public_token);
CREATE INDEX IF NOT EXISTS idx_student_photos_status ON student_photos(status);

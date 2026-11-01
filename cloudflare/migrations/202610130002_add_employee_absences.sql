-- ====================================================================
-- SIMAS SMAGESA - MIGRATION: TABEL KETIDAKHADIRAN PEGAWAI TENDIK (SAKIT / CUTI / IZIN)
-- Migration File: 202610130002_add_employee_absences.sql
-- ====================================================================

CREATE TABLE IF NOT EXISTS employee_absences (
    id TEXT PRIMARY KEY,
    user_uid TEXT NOT NULL,
    gtk_id TEXT,
    tanggal TEXT NOT NULL,
    jenis TEXT NOT NULL,
    alasan TEXT NOT NULL,
    created_by_uid TEXT NOT NULL,
    created_by_name TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_employee_absences_date_gtk ON employee_absences (tanggal, gtk_id);
CREATE INDEX IF NOT EXISTS idx_employee_absences_date_user ON employee_absences (tanggal, user_uid);

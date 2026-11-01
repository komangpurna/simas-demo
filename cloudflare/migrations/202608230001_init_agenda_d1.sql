-- ====================================================================
-- SIMAS SMAGESA - CLOUDFLARE D1 MIGRATION
-- Migration ID: 202608230001_init_agenda_d1.sql
-- Modul: Agenda Kegiatan Sekolah & Arsip Dokumen Google Drive
-- ====================================================================

-- 1. Tabel Calendar Events (Agenda Kegiatan Sekolah)
CREATE TABLE IF NOT EXISTS calendar_events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT,
    location TEXT,
    category TEXT DEFAULT 'umum',
    description TEXT,
    color TEXT DEFAULT 'blue',
    created_by TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 2. Index Tanggal & Kategori Agenda
CREATE INDEX IF NOT EXISTS idx_events_date ON calendar_events(date);
CREATE INDEX IF NOT EXISTS idx_events_category ON calendar_events(category);

-- 3. Tabel Agenda Documents (Arsip & Dokumen Google Drive)
CREATE TABLE IF NOT EXISTS agenda_documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT DEFAULT 'umum',
    drive_url TEXT NOT NULL,
    file_type TEXT DEFAULT 'pdf',
    uploaded_by TEXT NOT NULL,
    uploader_name TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 4. Index Kategori Dokumen
CREATE INDEX IF NOT EXISTS idx_docs_category ON agenda_documents(category);

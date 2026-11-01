-- ====================================================================
-- SIMAS SMAGESA - CLOUDFLARE D1 DATABASE MIGRATION
-- Modul: Jurnal Mengajar Guru & Master Data SSOT
-- ====================================================================

-- 1. Tabel Jurnal Guru
CREATE TABLE IF NOT EXISTS jurnal_guru (
    id TEXT PRIMARY KEY,
    tanggal TEXT NOT NULL,           -- Format YYYY-MM-DD
    kelas TEXT NOT NULL,             -- Contoh 'X.1', 'XI.2', 'XII.3'
    guru TEXT NOT NULL,              -- Nama lengkap guru
    uid_guru TEXT,                   -- UID akun guru di SIMAS / Firebase
    mapel TEXT NOT NULL,             -- Mata Pelajaran
    topik TEXT,                      -- Materi / Topik pembelajaran
    catatan TEXT,                    -- Catatan / Refleksi KBM
    jp TEXT,                         -- JSON array string JP, misal '[1,2]' atau '1-2'
    lokasi_mengajar TEXT,            -- Ruang / Lab / Kelas
    foto_url TEXT,                   -- URL foto Google Drive / Cloud
    ttd TEXT,                        -- Base64 Signature string
    koordinat TEXT,                  -- JSON string GPS {latitude, longitude, accuracy}
    presensi_detail TEXT,            -- JSON array string siswa tidak hadir/status kehadiran
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_jurnal_tanggal ON jurnal_guru(tanggal);
CREATE INDEX IF NOT EXISTS idx_jurnal_kelas ON jurnal_guru(kelas);
CREATE INDEX IF NOT EXISTS idx_jurnal_guru ON jurnal_guru(guru);
CREATE INDEX IF NOT EXISTS idx_jurnal_mapel ON jurnal_guru(mapel);
CREATE INDEX IF NOT EXISTS idx_jurnal_kelas_tanggal ON jurnal_guru(kelas, tanggal);
CREATE INDEX IF NOT EXISTS idx_jurnal_guru_kelas ON jurnal_guru(guru, kelas);
CREATE INDEX IF NOT EXISTS idx_jurnal_guru_mapel_kelas ON jurnal_guru(guru, mapel, kelas);

-- 2. Tabel Master Mapel
CREATE TABLE IF NOT EXISTS master_mapel (
    id TEXT PRIMARY KEY,
    nama_mapel TEXT NOT NULL,
    sumber TEXT DEFAULT 'manual',    -- 'xml', 'manual', 'dapodik'
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_master_mapel_nama ON master_mapel(nama_mapel);

-- 3. Tabel Master Lokasi Pembelajaran
CREATE TABLE IF NOT EXISTS master_lokasi (
    id TEXT PRIMARY KEY,
    nama_lokasi TEXT NOT NULL,
    urutan INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_master_lokasi_urutan ON master_lokasi(urutan);

-- 4. Tabel Master Guru (SSOT Caching di D1)
CREATE TABLE IF NOT EXISTS master_teachers (
    uid TEXT PRIMARY KEY,
    nama TEXT NOT NULL,
    nip TEXT,
    email TEXT,
    role TEXT DEFAULT 'guru_mapel',
    mapel TEXT,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_master_teachers_nama ON master_teachers(nama);
CREATE INDEX IF NOT EXISTS idx_master_teachers_status ON master_teachers(status);

-- 5. Tabel System Settings (Key-Value Store untuk Konfigurasi & Motivasi)
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,             -- Plain string atau JSON serialized
    updated_at TEXT DEFAULT (datetime('now'))
);

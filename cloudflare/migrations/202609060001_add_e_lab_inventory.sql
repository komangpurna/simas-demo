-- ====================================================================
-- SIMAS SMAGESA - MIGRATION 202609060001
-- Penambahan Fitur Inventaris E-Laboratorium (Barang Tidak Habis Pakai)
-- Master Kategori, Master Lokasi, Data Barang & Riwayat Kondisi
-- Database: Cloudflare D1 (simas-smagesa-d1)
-- ====================================================================

-- 1. Penambahan Kolom pada Tabel labs (Master Ruang Laboratorium)
-- Menambahkan kode singkatan lab (contoh: TIK, BIO, FIS) dan penugasan Kepala Lab (UID)
ALTER TABLE labs ADD COLUMN kode TEXT;
ALTER TABLE labs ADD COLUMN kepala_lab_uid TEXT;
ALTER TABLE labs ADD COLUMN kepala_lab_nama TEXT;

-- 2. Tabel Master Kategori Barang Inventaris (inventory_categories)
CREATE TABLE IF NOT EXISTS inventory_categories (
    id TEXT PRIMARY KEY,
    lab_id TEXT NOT NULL,
    name TEXT NOT NULL,
    code TEXT NOT NULL,           -- Short code untuk kode inventaris (misal: OPT, PC, ALAT)
    is_active INTEGER DEFAULT 1,  -- 1: Aktif, 0: Dinonaktifkan
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (lab_id) REFERENCES labs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_inv_cat_lab ON inventory_categories(lab_id, is_active);
CREATE INDEX IF NOT EXISTS idx_inv_cat_code ON inventory_categories(code);

-- 3. Tabel Master Lokasi Penyimpanan Barang (inventory_locations)
CREATE TABLE IF NOT EXISTS inventory_locations (
    id TEXT PRIMARY KEY,
    lab_id TEXT NOT NULL,
    name TEXT NOT NULL,           -- Misal: Lemari Mikroskop, Rak Alat Fisika 1, Gudang
    is_active INTEGER DEFAULT 1,  -- 1: Aktif, 0: Dinonaktifkan
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (lab_id) REFERENCES labs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_inv_loc_lab ON inventory_locations(lab_id, is_active);

-- 4. Tabel Data Barang Inventaris (inventory_items)
-- Konsep: 1 record = 1 kelompok/jenis barang, dengan kuantitas kondisi
CREATE TABLE IF NOT EXISTS inventory_items (
    id TEXT PRIMARY KEY,
    inventory_code TEXT NOT NULL UNIQUE, -- Format: LAB-{KODE_LAB}-{KODE_KAT}-{TAHUN}-{SEQ:001}
    lab_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    name TEXT NOT NULL,
    specification TEXT DEFAULT '',
    location_id TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'Unit',   -- Unit, Set, Pcs, Buah, Pasang
    qty_good INTEGER NOT NULL DEFAULT 0,
    qty_minor_damage INTEGER NOT NULL DEFAULT 0,
    qty_major_damage INTEGER NOT NULL DEFAULT 0,
    qty_total INTEGER NOT NULL DEFAULT 0,
    acquisition_year INTEGER NOT NULL,
    funding_source TEXT DEFAULT 'BOS Reguler',
    notes TEXT DEFAULT '',
    created_by TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (lab_id) REFERENCES labs(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES inventory_categories(id),
    FOREIGN KEY (location_id) REFERENCES inventory_locations(id)
);

CREATE INDEX IF NOT EXISTS idx_inv_items_lab ON inventory_items(lab_id);
CREATE INDEX IF NOT EXISTS idx_inv_items_category ON inventory_items(category_id);
CREATE INDEX IF NOT EXISTS idx_inv_items_location ON inventory_items(location_id);
CREATE INDEX IF NOT EXISTS idx_inv_items_code ON inventory_items(inventory_code);
CREATE INDEX IF NOT EXISTS idx_inv_items_year ON inventory_items(acquisition_year);

-- 5. Tabel Riwayat Mutasi Kondisi Barang (inventory_condition_history)
CREATE TABLE IF NOT EXISTS inventory_condition_history (
    id TEXT PRIMARY KEY,
    inventory_item_id TEXT NOT NULL,
    from_condition TEXT NOT NULL, -- good, minor_damage, major_damage
    to_condition TEXT NOT NULL,   -- good, minor_damage, major_damage
    quantity INTEGER NOT NULL,
    notes TEXT DEFAULT '',
    user_id TEXT NOT NULL,
    user_name TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_inv_hist_item ON inventory_condition_history(inventory_item_id, created_at DESC);

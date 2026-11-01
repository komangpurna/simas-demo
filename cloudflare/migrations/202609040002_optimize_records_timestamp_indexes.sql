-- ====================================================================
-- SIMAS SMAGESA - CLOUDFLARE D1 DATABASE MIGRATION
-- Migration: 202609040002_optimize_records_timestamp_indexes.sql
-- Tujuan: Optimasi Kuota Read D1, Eliminasi 371:1 & 95:1 Scan Ratio pada Tabel records
-- ====================================================================

-- GET /api/records memilih indeks ini dengan INDEXED BY untuk feed tanpa
-- filter tanggal/NIS. Query rentang tanggal/NIS tetap memakai query planner.
-- Terapkan sebelum deploy Worker; definisi yang sama tersedia di schema.sql
-- dan endpoint bootstrap schema-records-bk. Migrasi ini tidak mengubah data.

-- 1. Index untuk riwayat catatan aktif urut timestamp terbaru (Solusi Query #1: 374k -> ~1.5k rows read)
CREATE INDEX IF NOT EXISTS idx_records_active_ts ON records(timestamp DESC) WHERE status = 'active';

-- 2. Index untuk filter kategori urut timestamp terbaru (Solusi Query #7: rasio 95:1 -> 1:1)
CREATE INDEX IF NOT EXISTS idx_records_active_cat_ts ON records(category, timestamp DESC) WHERE status = 'active';

-- 3. Index untuk filter rombel kelas urut timestamp terbaru (Mencegah filesort saat wali kelas/guru memantau kelas)
CREATE INDEX IF NOT EXISTS idx_records_active_class_ts ON records(student_class, timestamp DESC) WHERE status = 'active';

-- 4. Index untuk filter rombel kelas + kategori urut timestamp terbaru
CREATE INDEX IF NOT EXISTS idx_records_active_class_cat_ts ON records(student_class, category, timestamp DESC) WHERE status = 'active';

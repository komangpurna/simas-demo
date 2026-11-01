-- ====================================================================
-- SIMAS SMAGESA - CLOUDFLARE D1 DATABASE MIGRATION
-- Migration: 202608310001_optimize_d1_indexes.sql
-- Tujuan: Optimasi Kuota Read D1 melalui Composite Indexing
-- ====================================================================

-- 1. Optimasi Pagination & Filter Siswa (Status, Kelas, Nama)
-- Mengeliminasi in-memory sorting scan ~2.100 baris per pagination request
CREATE INDEX IF NOT EXISTS idx_students_status_class_name ON students(status, class, name);
CREATE INDEX IF NOT EXISTS idx_students_class_status ON students(class, status);

-- 2. Optimasi Filter & Agregasi Rekap Kedisiplinan Siswa (records)
-- Mengeliminasi ratio scan 295:1 pada query filter tanggal & kategori
CREATE INDEX IF NOT EXISTS idx_records_cat_stat_date_ts ON records(category, status, date, timestamp);
CREATE INDEX IF NOT EXISTS idx_records_stat_date ON records(status, date);

-- 3. Optimasi Master GTK (Status, Nama)
-- Mempercepat query data guru aktif secara langsung via index
CREATE INDEX IF NOT EXISTS idx_gtk_status_name ON gtk(status, name);

-- 4. Optimasi Jurnal Guru (Kombinasi Guru, Mapel, Kelas, Tanggal)
-- Mempercepat pencarian riwayat topik pembelajaran terakhir
CREATE INDEX IF NOT EXISTS idx_jurnal_guru_mapel_kelas_tgl ON jurnal_guru(guru, mapel, kelas, tanggal);

-- ====================================================================
-- SIMAS SMAGESA - CLOUDFLARE D1 DATABASE MIGRATION
-- Migration: 202609030001_d1_performance_indexes.sql
-- Tujuan: Optimasi Kuota Read D1, Eliminasi 539:1 Scan Ratio & Memory Filesort
-- ====================================================================

-- 1. Normalisasi status record lama jika ada yang kosong/null
UPDATE records SET status = 'active' WHERE status IS NULL OR status = '';

-- 2. Partial & Composite Index pada records untuk eliminasi scan 539:1 & full table scan rombel
CREATE INDEX IF NOT EXISTS idx_records_active_cat_date_ts ON records(category, date DESC, timestamp DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_records_active_class_cat_date ON records(student_class, category, date DESC, timestamp DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_records_active_date_cat ON records(date, category) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_records_active_nis_ts ON records(student_nis, timestamp DESC) WHERE status = 'active';

-- 3. Composite Index pada jurnal_guru untuk eliminasi memory filesort
CREATE INDEX IF NOT EXISTS idx_jurnal_tgl_created ON jurnal_guru(tanggal DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jurnal_kelas_tgl_created ON jurnal_guru(kelas, tanggal DESC, created_at DESC);

-- 4. Composite Index pada guru_wali_assignments untuk sorting penugasan
CREATE INDEX IF NOT EXISTS idx_guru_wali_class_name ON guru_wali_assignments(student_class ASC, student_name ASC);

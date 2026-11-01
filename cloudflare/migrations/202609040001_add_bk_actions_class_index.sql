-- ====================================================================
-- SIMAS SMAGESA - CLOUDFLARE D1 DATABASE MIGRATION
-- Migration: 202609040001_add_bk_actions_class_index.sql
-- Tujuan: Optimasi Query Filter Riwayat BK berdasarkan Kelas & Tanggal
-- ====================================================================

CREATE INDEX IF NOT EXISTS idx_bk_actions_student_class ON bk_actions(student_class);
CREATE INDEX IF NOT EXISTS idx_bk_actions_date_class ON bk_actions(date DESC, student_class);

-- ====================================================================
-- SIMAS SMAGESA - CLOUDFLARE D1 DATABASE MIGRATION
-- Migration: 202609070001_optimize_jurnal_and_assignments.sql
-- Tujuan: Optimasi Indeks Komposit Histori Jurnal Guru (Eliminasi Scan Ratio 30:1 & Temp Filesort)
-- ====================================================================

-- 1. Composite Index pada jurnal_guru untuk histori topik terakhir guru + mapel + kelas
CREATE INDEX IF NOT EXISTS idx_jurnal_guru_mapel_kelas_tgl_created 
ON jurnal_guru(guru, mapel, kelas, tanggal DESC, created_at DESC);

-- 2. Composite Index fallback pada jurnal_guru untuk histori topik guru + kelas (tanpa mapel)
CREATE INDEX IF NOT EXISTS idx_jurnal_guru_kelas_tgl_created 
ON jurnal_guru(guru, kelas, tanggal DESC, created_at DESC);

-- ====================================================================
-- SIMAS SMAGESA - CLOUDFLARE D1 DATABASE MIGRATION
-- Migration: 202609280002_optimize_audit_logs_and_jurnal_indexes.sql
-- Tujuan: Optimasi Indeks D1 untuk Eliminasi Full Table Scan pada Audit Logs
--         dan Akselerasi Filter Pencarian Jurnal Mengajar
-- ====================================================================

-- 1. Indexing Tabel audit_logs
-- Mencegah Full Table Scan (9.5k+ rows read per query) pada filter target_id, created_at, dan actor_name
CREATE INDEX IF NOT EXISTS idx_audit_logs_target_id ON audit_logs(target_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_name ON audit_logs(actor_name);

-- 2. Indexing Tabel jurnal_guru
-- Mengakselerasi filter berbasis guru (NIP/UID) dan lokasi mengajar
CREATE INDEX IF NOT EXISTS idx_jurnal_uid_guru ON jurnal_guru(uid_guru);
CREATE INDEX IF NOT EXISTS idx_jurnal_lokasi_mengajar ON jurnal_guru(lokasi_mengajar);

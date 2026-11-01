-- ====================================================================
-- SIMAS SMAGESA - CLOUDFLARE D1 DATABASE MIGRATION
-- Migration: 202609090003_optimize_d1_student_search_and_notifications.sql
-- Tujuan: Optimasi Kuota Read & Latensi D1 melalui Expression Indexing
-- Siswa per Kelas dan Covering Indexing Antrean Notifikasi
-- ====================================================================

-- 1. Optimasi Pencarian Siswa Berdasarkan Kelas
-- Mengeliminasi Full Table Scan (rasio 36:1) dan in-memory filesort (USE TEMP B-TREE FOR ORDER BY)
-- Mendukung pencocokan case-insensitive, whitespace-trimmed, dan pengurutan langsung name ASC.
CREATE INDEX IF NOT EXISTS idx_students_class_expr_name 
ON students(LOWER(TRIM(class)), name ASC);

-- 2. Optimasi Pemulihan Lease Terputus Notifikasi
-- Memungkinkan B-Tree range search langsung pada baris berstatus 'processing' yang lease-nya kadaluarsa.
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_lease 
ON notification_deliveries(status, lease_until);

-- 3. Optimasi Klaim Notifikasi Antrean Umum (FIFO Outbox Tanpa Job ID)
-- Covering index yang melayani subquery klaim 100% dari index tanpa memory filesort.
CREATE INDEX IF NOT EXISTS idx_notification_claim_order 
ON notification_deliveries(status, created_at, id, next_attempt_at);

-- 4. Optimasi Klaim Notifikasi Spesifik Job (FIFO Outbox dengan Job ID)
-- Covering index khusus klaim dengan filter job_id tanpa evaluasi disjungsi (? = '' OR job_id = ?).
CREATE INDEX IF NOT EXISTS idx_notification_claim_job 
ON notification_deliveries(job_id, status, created_at, id, next_attempt_at);

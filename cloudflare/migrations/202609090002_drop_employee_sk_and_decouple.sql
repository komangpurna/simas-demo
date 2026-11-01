-- ====================================================================
-- SIMAS SMAGESA - MIGRATION: DECOUPLING PENUGASAN PEGAWAI DARI EMPLOYEE_SK
-- Migration File: 202609090002_drop_employee_sk_and_decouple.sql
-- ====================================================================

-- 1. Nonaktifkan Indeks Spesifik SK yang Tidak Lagi Digunakan
DROP INDEX IF EXISTS idx_employee_sk_tahun;
DROP INDEX IF EXISTS idx_task_groups_sk;
DROP INDEX IF EXISTS idx_emp_asg_sk;

-- 2. Pastikan Indeks Urutan Kelompok Penugasan Terbentuk
CREATE INDEX IF NOT EXISTS idx_task_groups_urutan ON employee_task_groups(urutan);

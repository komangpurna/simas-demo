-- Migration: Tambah kolom status_execution dan obstacle_notes pada tabel work_logs
-- Dijalankan pada 2026-09-28 untuk mendukung pelaporan realisasi dan catatan kendala sesuai Permendikdasmen 11/2025

ALTER TABLE work_logs ADD COLUMN status_execution TEXT DEFAULT 'terlaksana';
ALTER TABLE work_logs ADD COLUMN obstacle_notes TEXT;

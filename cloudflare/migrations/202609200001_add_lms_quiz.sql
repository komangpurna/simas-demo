-- ====================================================================
-- SIMAS SMAGESA - CLOUDFLARE D1 DATABASE MIGRATION
-- 202609200001_add_lms_quiz.sql
-- Modul Kuis Formatif LMS: Pilihan Ganda & Isian Singkat
-- Zero-Extra-Table: Memperkaya lms_materials dan lms_progress
-- ====================================================================

-- 1. Tambah kolom quiz_payload pada lms_materials
-- Menyimpan JSON array butir soal (pertanyaan, tipe 'mc' / 'short', opsi, kunci jawaban, KKM, timer)
ALTER TABLE lms_materials ADD COLUMN quiz_payload TEXT DEFAULT '';

-- 2. Tambah kolom quiz_score dan quiz_answers pada lms_progress
-- Menyimpan skor numerik 0-100 dan JSON ringkasan jawaban siswa
ALTER TABLE lms_progress ADD COLUMN quiz_score INTEGER DEFAULT NULL;
ALTER TABLE lms_progress ADD COLUMN quiz_answers TEXT DEFAULT '';

-- Indeks akselerasi pencarian progres kuis per materi dan skor
CREATE INDEX IF NOT EXISTS idx_lms_prog_mat_score ON lms_progress(material_id, quiz_score);

PRAGMA optimize;

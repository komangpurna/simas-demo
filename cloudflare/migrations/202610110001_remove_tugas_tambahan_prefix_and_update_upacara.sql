-- =================================================================
-- MIGRATION: 202610110001_remove_tugas_tambahan_prefix_and_update_upacara.sql
-- Penyesuaian Nama Master Katalog Beban Kerja Guru (Permendikdasmen No. 11/2025):
-- 1. Menghapus prefix 'Tugas Tambahan: ' agar langsung ke inti nama kegiatan
-- 2. Mengubah nama Upacara Bendera menjadi 'Upacara Bendera / Apel Pagi (selain Senin)'
-- =================================================================

-- 1. Hapus prefix 'Tugas Tambahan: ' pada seluruh katalog penugasan
UPDATE activity_catalog 
SET name = SUBSTR(name, 17) 
WHERE name LIKE 'Tugas Tambahan: %';

-- 2. Sesuaikan nama Upacara Bendera untuk membedakannya dari Upacara Senin otomatis
UPDATE activity_catalog 
SET name = 'Upacara Bendera / Apel Pagi (selain Senin)',
    description = 'Mengikuti upacara bendera hari besar nasional/peringatan khusus atau apel pagi pembinaan karakter bersama seluruh siswa dan guru di luar hari Senin'
WHERE id = 'cat_upacara' OR name = 'Upacara Bendera / Apel Pagi (Hari Senin)';

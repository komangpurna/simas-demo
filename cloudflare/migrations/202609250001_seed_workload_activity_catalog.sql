-- ====================================================================
-- SIMAS SMAGESA - MIGRATION: SEED KATALOG AKTIVITAS BEBAN KERJA GURU
-- Migration File: 202609250001_seed_workload_activity_catalog.sql
-- Sesuai: Permendikdasmen No. 11/2025 & Kepmendikdasmen No. 221/P/2025
-- ====================================================================

INSERT INTO activity_catalog (
    id, code, category_code, category_name, name, description,
    default_duration_minutes, is_teaching, requires_evidence, sort_order, is_active, created_at
) VALUES 
(
    'cat_kbm', 'kbm', 'PELAKSANAAN_KBM', 'Pelaksanaan Pembelajaran',
    'KBM Tatap Muka (Intrakurikuler)', 'Kegiatan belajar mengajar tatap muka di kelas atau laboratorium',
    45, 1, 0, 1, 1, datetime('now')
),
(
    'cat_bk', 'bk', 'PEMBIMBINGAN', 'Pembimbingan & Konseling',
    'Layanan Bimbingan & Konseling (BK)', 'Layanan bimbingan klasikal, kelompok, dan konseling individual',
    45, 0, 0, 2, 1, datetime('now')
),
(
    'cat_evaluasi', 'evaluasi', 'PERENCANAAN', 'Perencanaan & Asesmen',
    'Perencanaan & Evaluasi Pembelajaran / Asesmen', 'Penyusunan modul ajar, materi, kisi-kisi, dan pengolahan nilai/asesmen',
    45, 0, 0, 3, 1, datetime('now')
),
(
    'cat_wali_kelas', 'wali_kelas', 'TUGAS_TAMBAHAN', 'Tugas Tambahan',
    'Tugas Tambahan: Wali Kelas', 'Pengelolaan kelas perwalian, pembinaan siswa, dan administrasi raport',
    45, 0, 0, 4, 1, datetime('now')
),
(
    'cat_pembina_osis', 'pembina_osis', 'TUGAS_TAMBAHAN', 'Tugas Tambahan',
    'Tugas Tambahan: Pembina OSIS', 'Pembimbingan kegiatan kesiswaan dan keorganisasian OSIS/MPK',
    45, 0, 0, 5, 1, datetime('now')
),
(
    'cat_piket', 'piket', 'TUGAS_TAMBAHAN', 'Tugas Tambahan',
    'Tugas Piket Sekolah', 'Piket harian, ketertiban lingkungan, dan penerimaan tamu dinas',
    45, 0, 0, 6, 1, datetime('now')
),
(
    'cat_ekstra', 'ekstrakurikuler', 'PEMBIMBINGAN', 'Pembimbingan & Konseling',
    'Pembina Kegiatan Ekstrakurikuler', 'Pelatihan dan pembimbingan bakat minat siswa dalam ekskul',
    45, 0, 0, 7, 1, datetime('now')
),
(
    'cat_mgmp', 'mgmp', 'PERENCANAAN', 'Perencanaan & Asesmen',
    'Pengembangan Keprofesian Berkelanjutan (MGMP / PKB)', 'Pertemuan forum MGMP sekolah/kabupaten dan pelatihan mandiri',
    45, 0, 0, 8, 1, datetime('now')
),
(
    'cat_administrasi', 'administrasi', 'PENILAIAN', 'Penilaian & Evaluasi',
    'Tugas Penunjang & Administrasi Guru', 'Penyusunan laporan kinerja, administrasi kepegawaian, dan rapat dinas',
    45, 0, 0, 9, 1, datetime('now')
)
ON CONFLICT(id) DO UPDATE SET
    code = excluded.code,
    category_code = excluded.category_code,
    category_name = excluded.category_name,
    name = excluded.name,
    description = excluded.description,
    default_duration_minutes = excluded.default_duration_minutes,
    is_teaching = excluded.is_teaching,
    requires_evidence = excluded.requires_evidence,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active;

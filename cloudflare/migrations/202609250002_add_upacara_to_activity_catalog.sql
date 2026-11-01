-- ====================================================================
-- SIMAS SMAGESA - MIGRATION: SEED UPACARA BENDERA KE KATALOG AKTIVITAS
-- Migration File: 202609250002_add_upacara_to_activity_catalog.sql
-- Sesuai: Permendikdasmen No. 11/2025 & Jadwal Rutin SMAGESA (Senin JP 1)
-- ====================================================================

INSERT INTO activity_catalog (
    id, code, category_code, category_name, name, description,
    default_duration_minutes, is_teaching, requires_evidence, sort_order, is_active, created_at
) VALUES (
    'cat_upacara', 'upacara', 'TUGAS_TAMBAHAN', 'Tugas Tambahan',
    'Upacara Bendera / Apel Pagi', 'Kegiatan upacara bendera hari Senin dan pembinaan apel bersama seluruh siswa dan guru',
    45, 0, 0, 10, 1, datetime('now')
)
ON CONFLICT(id) DO NOTHING;

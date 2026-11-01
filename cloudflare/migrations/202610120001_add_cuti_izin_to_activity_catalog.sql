-- ====================================================================
-- SIMAS SMAGESA - MIGRATION: KATALOG AKTIVITAS CUTI/IZIN GURU
-- Migration File: 202610120001_add_cuti_izin_to_activity_catalog.sql
-- Penegasan Kategori Resmi & Master Data Cuti/Izin Guru (Permendikdasmen No. 11/2025)
-- ====================================================================

INSERT INTO activity_catalog (
    id, code, category_code, category_name, name, description,
    default_duration_minutes, is_teaching, requires_evidence, sort_order, is_active, created_at
) VALUES (
    'cat_cuti_izin', 'cuti_izin', 'CUTI_IZIN', 'Cuti / Izin Resmi Guru',
    'Cuti / Izin Resmi Guru', 'Hari kerja yang ditandai Cuti atau Izin resmi (0 menit direncanakan, bebas pemenuhan jam kerja sesuai regulasi)',
    0, 0, 0, 999, 1, datetime('now')
)
ON CONFLICT(id) DO UPDATE SET
    code = excluded.code,
    category_code = excluded.category_code,
    category_name = excluded.category_name,
    name = excluded.name,
    description = excluded.description,
    is_active = 1;

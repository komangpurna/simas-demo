-- ====================================================================
-- SIMAS SMAGESA - MIGRATION 202609080001
-- Penambahan Kolom Koordinator Laboratorium pada Tabel labs
-- Menugaskan Koordinator per-lab (berdasarkan akun guru ber-UID)
-- Database: Cloudflare D1 (simas-smagesa-d1)
-- ====================================================================

-- 1. Penambahan Kolom koordinator_uid dan koordinator_nama pada tabel labs
ALTER TABLE labs ADD COLUMN koordinator_uid TEXT;
ALTER TABLE labs ADD COLUMN koordinator_nama TEXT;

-- 2. Penambahan Index Pencarian Berdasarkan Koordinator
CREATE INDEX IF NOT EXISTS idx_labs_koordinator ON labs(koordinator_uid);

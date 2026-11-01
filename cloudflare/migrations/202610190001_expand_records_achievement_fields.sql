-- ====================================================================
-- MIGRATION: 202610190001_expand_records_achievement_fields.sql
-- Description: Menambahkan kolom terstruktur untuk pencatatan prestasi siswa
-- ====================================================================

ALTER TABLE records ADD COLUMN competition_name TEXT;
ALTER TABLE records ADD COLUMN organizer TEXT;
ALTER TABLE records ADD COLUMN level TEXT;
ALTER TABLE records ADD COLUMN field TEXT;
ALTER TABLE records ADD COLUMN rank TEXT;
ALTER TABLE records ADD COLUMN participation_type TEXT DEFAULT 'Individu';
ALTER TABLE records ADD COLUMN team_name TEXT;
ALTER TABLE records ADD COLUMN mentor_name TEXT;
ALTER TABLE records ADD COLUMN certificate_no TEXT;
ALTER TABLE records ADD COLUMN evidence_url TEXT;

CREATE INDEX IF NOT EXISTS idx_records_field ON records(field);
CREATE INDEX IF NOT EXISTS idx_records_level ON records(level);
CREATE INDEX IF NOT EXISTS idx_records_rank ON records(rank);
CREATE INDEX IF NOT EXISTS idx_records_competition ON records(competition_name);

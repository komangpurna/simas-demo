-- ====================================================================
-- SIMAS SMAGESA - CLOUDFLARE D1 MIGRATION
-- Migration: 202610290001_add_description_and_archived_to_agenda_documents.sql
-- Penambahan kolom description dan is_archived pada tabel agenda_documents
-- ====================================================================

ALTER TABLE agenda_documents ADD COLUMN description TEXT;
ALTER TABLE agenda_documents ADD COLUMN is_archived INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_docs_archived ON agenda_documents(is_archived);

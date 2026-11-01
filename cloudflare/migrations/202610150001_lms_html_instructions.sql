-- Additive migration: keep existing raw HTML and progress unchanged.
-- Run through D1 migrations once, before deploying the matching Worker.
ALTER TABLE lms_materials ADD COLUMN html_instructions TEXT NOT NULL DEFAULT '';

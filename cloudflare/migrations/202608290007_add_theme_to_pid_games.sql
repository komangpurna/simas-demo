-- Migration: Add theme column to pid_games table for AI-driven visual themes
ALTER TABLE pid_games ADD COLUMN theme TEXT;

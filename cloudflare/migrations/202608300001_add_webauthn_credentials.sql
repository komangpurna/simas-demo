-- Migration: 202608300001_add_webauthn_credentials.sql
-- Standar Keamanan OWASP ASVS Level 2 & FIDO2 WebAuthn Passkey Storage

CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    email TEXT NOT NULL,
    public_key TEXT NOT NULL,
    algorithm INTEGER DEFAULT -7,
    sign_count INTEGER DEFAULT 0,
    device_name TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_webauthn_user_id ON webauthn_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_webauthn_email ON webauthn_credentials(email);

CREATE TABLE IF NOT EXISTS webauthn_challenges (
    challenge TEXT PRIMARY KEY,
    user_id TEXT DEFAULT '',
    email TEXT DEFAULT '',
    type TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenge_created ON webauthn_challenges(created_at);

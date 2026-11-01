-- supabase/migrations/202608300001_finance_config.sql
-- =========================================================================
-- TABEL KONFIGURASI KEUANGAN (finance_config)
-- Single Source of Truth untuk Tarif SPP (finance_rates) & Jatuh Tempo (finance_config)
-- =========================================================================

CREATE TABLE IF NOT EXISTS finance_config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security (RLS) - Zero Trust Lockdown
-- Seluruh pembacaan dan penulisan konfigurasi keuangan WAJIB melalui
-- Supabase Edge Function secure-proxy dengan verifikasi Firebase ID Token + RBAC.
ALTER TABLE finance_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read finance_config" ON finance_config;
DROP POLICY IF EXISTS "Allow write finance_config" ON finance_config;

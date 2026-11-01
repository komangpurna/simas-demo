-- supabase/migrations/202608140001_finance_system.sql
-- Skema Database Modul Keuangan SPP & Kas Komite SIMAS SHAKTI (Supabase PostgreSQL)

-- 1. Tabel Transaksi SPP Per Siswa (finance_transactions)
CREATE TABLE IF NOT EXISTS finance_transactions (
    id TEXT PRIMARY KEY, -- Format: {student_nis}_{year}_{month}
    transaction_id VARCHAR(100), -- Format: TRX-...
    student_nis VARCHAR(50) NOT NULL,
    student_name VARCHAR(200),
    student_class VARCHAR(50),
    year INT NOT NULL,
    month INT NOT NULL,
    amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    payment_date TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    date_str VARCHAR(15), -- Format: YYYY-MM-DD
    type VARCHAR(20) NOT NULL DEFAULT 'paid', -- 'paid' / 'manual_debt'
    teller_name VARCHAR(200),
    teller_uid VARCHAR(100),
    payment_method VARCHAR(50) DEFAULT 'tunai',
    notes TEXT DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Indexing Transaksi SPP untuk Kueri Super Cepat & Ringan Egress
CREATE INDEX IF NOT EXISTS idx_fin_tx_student_nis ON finance_transactions(student_nis);
CREATE INDEX IF NOT EXISTS idx_fin_tx_date_str ON finance_transactions(date_str);
CREATE INDEX IF NOT EXISTS idx_fin_tx_year_month ON finance_transactions(year, month);
CREATE INDEX IF NOT EXISTS idx_fin_tx_student_class ON finance_transactions(student_class);
CREATE INDEX IF NOT EXISTS idx_fin_tx_type ON finance_transactions(type);

-- 2. Tabel Arus Kas Manual Komite (finance_cashflow)
CREATE TABLE IF NOT EXISTS finance_cashflow (
    id TEXT PRIMARY KEY,
    date_str VARCHAR(15) NOT NULL,
    type VARCHAR(10) NOT NULL, -- 'in' / 'out'
    category VARCHAR(100) NOT NULL,
    amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    description TEXT DEFAULT '',
    officer_name VARCHAR(200),
    officer_uid VARCHAR(100),
    is_closing_record BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fin_cashflow_date_str ON finance_cashflow(date_str);
CREATE INDEX IF NOT EXISTS idx_fin_cashflow_type ON finance_cashflow(type);

-- 3. Tabel Tutup Buku Tahunan (finance_closings)
CREATE TABLE IF NOT EXISTS finance_closings (
    id TEXT PRIMARY KEY, -- Format: {year} e.g. "2025"
    year INT NOT NULL UNIQUE,
    saldo_akhir NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_income NUMERIC(15,2) DEFAULT 0,
    total_expense NUMERIC(15,2) DEFAULT 0,
    closed_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    closed_by VARCHAR(200),
    summary JSONB DEFAULT '{}'::jsonb
);

-- 4. Tabel Ringkasan Harian SPP (finance_daily_summary)
CREATE TABLE IF NOT EXISTS finance_daily_summary (
    id VARCHAR(20) PRIMARY KEY, -- Format: YYYY-MM-DD
    date_str VARCHAR(20),
    total_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    transaction_count INT NOT NULL DEFAULT 0,
    is_migration BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Row Level Security (RLS)
ALTER TABLE finance_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_cashflow ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_closings ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_daily_summary ENABLE ROW LEVEL SECURITY;

-- Drop Policy lama jika ada
DROP POLICY IF EXISTS "Allow read finance_transactions" ON finance_transactions;
DROP POLICY IF EXISTS "Allow write finance_transactions" ON finance_transactions;
DROP POLICY IF EXISTS "Allow read finance_cashflow" ON finance_cashflow;
DROP POLICY IF EXISTS "Allow write finance_cashflow" ON finance_cashflow;
DROP POLICY IF EXISTS "Allow read finance_closings" ON finance_closings;
DROP POLICY IF EXISTS "Allow write finance_closings" ON finance_closings;
DROP POLICY IF EXISTS "Allow read finance_daily_summary" ON finance_daily_summary;
DROP POLICY IF EXISTS "Allow write finance_daily_summary" ON finance_daily_summary;

-- Policies Akses Penuh untuk Klien Terverifikasi
CREATE POLICY "Allow read finance_transactions" ON finance_transactions FOR SELECT USING (true);
CREATE POLICY "Allow write finance_transactions" ON finance_transactions FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read finance_cashflow" ON finance_cashflow FOR SELECT USING (true);
CREATE POLICY "Allow write finance_cashflow" ON finance_cashflow FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read finance_closings" ON finance_closings FOR SELECT USING (true);
CREATE POLICY "Allow write finance_closings" ON finance_closings FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read finance_daily_summary" ON finance_daily_summary FOR SELECT USING (true);
CREATE POLICY "Allow write finance_daily_summary" ON finance_daily_summary FOR ALL USING (true) WITH CHECK (true);

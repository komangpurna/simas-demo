-- supabase/migrations/202610220001_rkas_komite.sql
-- Skema Database Modul RKAS Komite (Rencana Kegiatan dan Anggaran Sekolah - Komite) SIMAS SHAKTI (Supabase PostgreSQL)
-- Standar: OWASP Top 10, ASVS Level 1 & 2, Action & Security Parity, 0 Kuota Firestore

-- 1. Tabel Header RKAS Komite (rkas_komite_headers)
CREATE TABLE IF NOT EXISTS public.rkas_komite_headers (
    id VARCHAR(100) PRIMARY KEY, -- Format: {year}_{version_type} (e.g. '2026_murni', '2026_perubahan')
    year INT NOT NULL,
    version_type VARCHAR(20) NOT NULL DEFAULT 'murni', -- 'murni' / 'perubahan'
    revision_no INT NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'draft', -- 'draft', 'signed_treasurer', 'reviewed_principal', 'approved_committee'
    silpa_prev_year NUMERIC(15,2) NOT NULL DEFAULT 0,
    penerimaan_current_year NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_penerimaan NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_belanja NUMERIC(15,2) NOT NULL DEFAULT 0,
    treasurer_name VARCHAR(200) DEFAULT '',
    signed_treasurer_by VARCHAR(200),
    signed_treasurer_at TIMESTAMP WITH TIME ZONE,
    principal_name VARCHAR(200) DEFAULT '',
    reviewed_principal_by VARCHAR(200),
    reviewed_principal_at TIMESTAMP WITH TIME ZONE,
    committee_chair_name VARCHAR(200) DEFAULT 'I Gede Sukasari, S.ST.',
    approved_committee_by VARCHAR(200),
    approved_committee_at TIMESTAMP WITH TIME ZONE,
    notes TEXT DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rkas_komite_headers_year_version ON public.rkas_komite_headers(year, version_type);
CREATE INDEX IF NOT EXISTS idx_rkas_komite_headers_status ON public.rkas_komite_headers(status);

-- 2. Tabel Item Belanja & Hirarki RKAS Komite (rkas_komite_items)
CREATE TABLE IF NOT EXISTS public.rkas_komite_items (
    id TEXT PRIMARY KEY,
    header_id VARCHAR(100) NOT NULL REFERENCES public.rkas_komite_headers(id) ON DELETE CASCADE,
    no_urut INT NOT NULL DEFAULT 1,
    item_type VARCHAR(30) NOT NULL, -- 'standar', 'program', 'sub_program', 'kegiatan', 'belanja_detail'
    kode_program VARCHAR(50) DEFAULT '', -- e.g. '03.', '03.02', '03.02.01', '03.03.07'
    kode_rekening VARCHAR(50) DEFAULT '', -- e.g. '5.1.02.01.01.0012'
    uraian TEXT NOT NULL DEFAULT '',
    volume NUMERIC(12,2) DEFAULT 0,
    satuan VARCHAR(50) DEFAULT '',
    tarif_harga NUMERIC(15,2) DEFAULT 0,
    jumlah NUMERIC(15,2) DEFAULT 0,
    tahap_1 NUMERIC(15,2) DEFAULT 0,
    tahap_2 NUMERIC(15,2) DEFAULT 0,
    parent_kegiatan_id TEXT DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rkas_komite_items_header ON public.rkas_komite_items(header_id);
CREATE INDEX IF NOT EXISTS idx_rkas_komite_items_type ON public.rkas_komite_items(item_type);
CREATE INDEX IF NOT EXISTS idx_rkas_komite_items_parent ON public.rkas_komite_items(parent_kegiatan_id);
CREATE INDEX IF NOT EXISTS idx_rkas_komite_items_no_urut ON public.rkas_komite_items(no_urut);

-- 3. Tambahkan kolom rkas_kegiatan_id pada finance_cashflow
ALTER TABLE public.finance_cashflow 
ADD COLUMN IF NOT EXISTS rkas_kegiatan_id TEXT DEFAULT NULL;

COMMENT ON COLUMN public.finance_cashflow.rkas_kegiatan_id IS 'ID Pos Kegiatan RKAS Komite terkait (rkas_komite_items.id)';
CREATE INDEX IF NOT EXISTS idx_fin_cashflow_rkas_kegiatan_id ON public.finance_cashflow(rkas_kegiatan_id);

-- 4. Row Level Security (RLS)
ALTER TABLE public.rkas_komite_headers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rkas_komite_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read rkas_komite_headers" ON public.rkas_komite_headers;
DROP POLICY IF EXISTS "Allow write rkas_komite_headers" ON public.rkas_komite_headers;
DROP POLICY IF EXISTS "Allow read rkas_komite_items" ON public.rkas_komite_items;
DROP POLICY IF EXISTS "Allow write rkas_komite_items" ON public.rkas_komite_items;

CREATE POLICY "Allow read rkas_komite_headers" ON public.rkas_komite_headers FOR SELECT USING (true);
CREATE POLICY "Allow write rkas_komite_headers" ON public.rkas_komite_headers FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read rkas_komite_items" ON public.rkas_komite_items FOR SELECT USING (true);
CREATE POLICY "Allow write rkas_komite_items" ON public.rkas_komite_items FOR ALL USING (true) WITH CHECK (true);

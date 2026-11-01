-- =====================================================================
-- MIGRATION: 202609140001_add_no_bukti_to_finance_cashflow.sql
-- PENAMBAHAN DOKUMENTASI NO. BUKTI (BUKTI KAS / KUITANSI) PADA FINANCE_CASHFLOW
-- =====================================================================

-- 1. Tambah kolom no_bukti pada tabel finance_cashflow (nilai default '')
ALTER TABLE public.finance_cashflow 
ADD COLUMN IF NOT EXISTS no_bukti VARCHAR(100) DEFAULT '';

-- 2. Berikan komentar dokumentasi pada kolom no_bukti
COMMENT ON COLUMN public.finance_cashflow.no_bukti IS 'Nomor bukti fisik mutasi kas / kuitansi / BKK / BKM';

-- 3. Tambahkan index untuk optimasi pencarian no_bukti
CREATE INDEX IF NOT EXISTS idx_fin_cashflow_no_bukti ON public.finance_cashflow(no_bukti);

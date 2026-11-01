-- supabase/migrations/202608140005_fix_cashflow_category_default.sql
-- Menetapkan default value 'Umum' untuk kolom category pada tabel finance_cashflow

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'finance_cashflow' 
          AND column_name = 'category'
    ) THEN
        ALTER TABLE public.finance_cashflow ALTER COLUMN category SET DEFAULT 'Umum';
    END IF;
END $$;

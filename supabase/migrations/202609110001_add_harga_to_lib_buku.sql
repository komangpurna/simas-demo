-- =====================================================================
-- MIGRATION: 202609110001_add_harga_to_lib_buku.sql
-- PENAMBAHAN DOKUMENTASI HARGA BUKU / NILAI ASET PADA MASTER BIBLIOGRAFI
-- =====================================================================

-- 1. Tambah kolom harga pada tabel master lib_buku (nilai default 0)
ALTER TABLE public.lib_buku 
ADD COLUMN IF NOT EXISTS harga NUMERIC(12, 2) DEFAULT 0;

-- 2. Berikan komentar dokumentasi pada kolom harga
COMMENT ON COLUMN public.lib_buku.harga IS 'Harga buku per unit / estimasi nilai aset pengadaan buku perpustakaan (Rp)';

-- 3. Tambahkan constraint non-negatif jika belum ada
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'chk_lib_buku_harga_nonnegative'
    ) THEN
        ALTER TABLE public.lib_buku 
        ADD CONSTRAINT chk_lib_buku_harga_nonnegative CHECK (harga >= 0);
    END IF;
END $$;

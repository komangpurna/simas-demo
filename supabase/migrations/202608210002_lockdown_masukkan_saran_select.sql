-- supabase/migrations/202608210002_lockdown_masukkan_saran_select.sql
-- Mengunci total akses SELECT pada tabel masukkan_saran dari klien publik/anonim (anon key)
-- Semua pembacaan daftar laporan WAJIB melalui Supabase Edge Functions 'secure-proxy' (action: get-feedbacks)
-- yang memverifikasi secara kriptografis bahwa user memiliki 1 dari 5 peran pimpinan resmi.

ALTER TABLE public.masukkan_saran ENABLE ROW LEVEL SECURITY;

-- 1. Hapus policy SELECT anonim publik
DROP POLICY IF EXISTS "Allow anonymous read masukkan_saran" ON public.masukkan_saran;
DROP POLICY IF EXISTS "Allow anon all masukkan_saran" ON public.masukkan_saran;
DROP POLICY IF EXISTS "Allow full access masukkan_saran" ON public.masukkan_saran;

-- 2. Pastikan tidak ada policy anonim yang terbuka untuk tabel masukkan_saran
-- Hanya service_role (Edge Functions / Backend) dan postgres (superuser) yang dapat mengakses

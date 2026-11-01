-- supabase/migrations/202610130001_add_keterangan_to_guru_presensi.sql
-- Tambah kolom keterangan (deskripsi kegiatan untuk status K) pada tabel guru_presensi.

ALTER TABLE guru_presensi ADD COLUMN IF NOT EXISTS keterangan TEXT DEFAULT NULL;

-- Muat ulang schema cache PostgREST agar kolom baru langsung dikenali API.
NOTIFY pgrst, 'reload schema';

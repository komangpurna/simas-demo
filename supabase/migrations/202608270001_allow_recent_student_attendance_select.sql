-- =====================================================================
-- IZINKAN BACA PRESENSI SISWA TERBARU (HARI INI & KEMARIN)
-- Digunakan oleh aplikasi Jurnal Mengajar untuk auto pre-fill kehadiran kelas
-- =====================================================================

CREATE POLICY "Secure public read recent siswa_presensi"
  ON public.siswa_presensi FOR SELECT
  USING (tanggal >= CURRENT_DATE - INTERVAL '2 days');

COMMENT ON POLICY "Secure public read recent siswa_presensi" ON public.siswa_presensi
  IS 'Mengizinkan pembacaan presensi harian siswa terbaru oleh Jurnal Mengajar';

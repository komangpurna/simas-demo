-- Migration File: 202610070001_optimize_d1_performance_indexes.sql
-- Optimasi performa kueri Cloudflare D1 modul Beban Kerja Guru & Rekap Rencana

-- Mengoptimalkan kueri:
-- SELECT pts.*, ... FROM plan_time_segments pts WHERE pts.plan_version_id = ? ORDER BY pts.date ASC, pts.start_time ASC
-- Menghilangkan in-memory sorting pada 750+ eksekusi kueri mingguan
CREATE INDEX IF NOT EXISTS idx_plan_seg_ver_date_start ON plan_time_segments(plan_version_id, date ASC, start_time ASC);

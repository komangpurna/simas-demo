-- ========================================================
-- SIMAS DEMO - FULL SUPABASE DATABASE SCHEMA MIGRATION
-- Otomatis digabungkan dari 41 berkas migrasi resmi
-- ========================================================

-- >>> MIGRATION: 202605260001_duta_shakti.sql >>>
-- supabase/migrations/202605260001_duta_shakti.sql
-- Skema Database Modul Pemilihan Duta SHAKTI 2026

-- 1. Membuat tabel kandidat (duta_kandidat)
CREATE TABLE IF NOT EXISTS duta_kandidat (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nama TEXT NOT NULL,
    kategori TEXT NOT NULL, -- Sehat, Humanis, Agamais, Kreatif, Trampil, Inovatif
    foto_url TEXT
);

-- 2. Membuat tabel suara_masuk (duta_suara_masuk)
CREATE TABLE IF NOT EXISTS duta_suara_masuk (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nis_pemilih TEXT NOT NULL,
    nama_pemilih TEXT NOT NULL,
    kelas_pemilih TEXT NOT NULL,
    id_kandidat UUID NOT NULL REFERENCES duta_kandidat(id) ON DELETE CASCADE,
    kategori TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Menambahkan UNIQUE CONSTRAINT untuk proteksi mutlak (1 NIS hanya bisa memilih 1 kandidat per kategori)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'unique_nis_kategori'
    ) THEN
        ALTER TABLE duta_suara_masuk ADD CONSTRAINT unique_nis_kategori UNIQUE (nis_pemilih, kategori);
    END IF;
END $$;

-- 4. Kebijakan Row Level Security (RLS) untuk akses anonim publik
ALTER TABLE duta_kandidat ENABLE ROW LEVEL SECURITY;
ALTER TABLE duta_suara_masuk ENABLE ROW LEVEL SECURITY;

-- DROP POLICY jika sudah ada untuk menghindari duplikasi saat migrasi dijalankan ulang
DROP POLICY IF EXISTS "Allow anonymous read candidates" ON duta_kandidat;
DROP POLICY IF EXISTS "Allow anonymous insert votes" ON duta_suara_masuk;
DROP POLICY IF EXISTS "Allow anonymous read votes" ON duta_suara_masuk;

-- Membuat Policy Baru
CREATE POLICY "Allow anonymous read candidates" ON duta_kandidat FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert votes" ON duta_suara_masuk FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous read votes" ON duta_suara_masuk FOR SELECT USING (true);

-- 5. Seeding data kandidat awal jika kosong (Demo & Pengujian Instan)
INSERT INTO duta_kandidat (nama, kategori, foto_url)
SELECT 'I Gede Aditya Wiranata', 'Sehat', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&h=300'
WHERE NOT EXISTS (SELECT 1 FROM duta_kandidat WHERE nama = 'I Gede Aditya Wiranata');

INSERT INTO duta_kandidat (nama, kategori, foto_url)
SELECT 'Ni Putu Evelyn Pradnya', 'Sehat', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=300&h=300'
WHERE NOT EXISTS (SELECT 1 FROM duta_kandidat WHERE nama = 'Ni Putu Evelyn Pradnya');

INSERT INTO duta_kandidat (nama, kategori, foto_url)
SELECT 'I Komang Purna Wijaya', 'Humanis', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&h=300'
WHERE NOT EXISTS (SELECT 1 FROM duta_kandidat WHERE nama = 'I Komang Purna Wijaya');

INSERT INTO duta_kandidat (nama, kategori, foto_url)
SELECT 'Ni Made Ayu Saraswati', 'Humanis', 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=300&h=300'
WHERE NOT EXISTS (SELECT 1 FROM duta_kandidat WHERE nama = 'Ni Made Ayu Saraswati');

INSERT INTO duta_kandidat (nama, kategori, foto_url)
SELECT 'I Ketut Dharma Yasa', 'Agamais', 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&w=300&h=300'
WHERE NOT EXISTS (SELECT 1 FROM duta_kandidat WHERE nama = 'I Ketut Dharma Yasa');

INSERT INTO duta_kandidat (nama, kategori, foto_url)
SELECT 'Ni Luh Gede Krisna Dewi', 'Agamais', 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=300&h=300'
WHERE NOT EXISTS (SELECT 1 FROM duta_kandidat WHERE nama = 'Ni Luh Gede Krisna Dewi');

INSERT INTO duta_kandidat (nama, kategori, foto_url)
SELECT 'I Wayan Juniantara', 'Kreatif', 'https://images.unsplash.com/photo-1519345182560-3f2917c472ef?auto=format&fit=crop&w=300&h=300'
WHERE NOT EXISTS (SELECT 1 FROM duta_kandidat WHERE nama = 'I Wayan Juniantara');

INSERT INTO duta_kandidat (nama, kategori, foto_url)
SELECT 'Ni Kadek Windasari', 'Kreatif', 'https://images.unsplash.com/photo-1554151228-14d9def656e4?auto=format&fit=crop&w=300&h=300'
WHERE NOT EXISTS (SELECT 1 FROM duta_kandidat WHERE nama = 'Ni Kadek Windasari');

INSERT INTO duta_kandidat (nama, kategori, foto_url)
SELECT 'I Nyoman Triadi Putra', 'Trampil', 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=300&h=300'
WHERE NOT EXISTS (SELECT 1 FROM duta_kandidat WHERE nama = 'I Nyoman Triadi Putra');

INSERT INTO duta_kandidat (nama, kategori, foto_url)
SELECT 'Ni Nyoman Sukmawati', 'Trampil', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&h=300'
WHERE NOT EXISTS (SELECT 1 FROM duta_kandidat WHERE nama = 'Ni Nyoman Sukmawati');

INSERT INTO duta_kandidat (nama, kategori, foto_url)
SELECT 'I Made Bagus Wisesa', 'Inovatif', 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=300&h=300'
WHERE NOT EXISTS (SELECT 1 FROM duta_kandidat WHERE nama = 'I Made Bagus Wisesa');

INSERT INTO duta_kandidat (nama, kategori, foto_url)
SELECT 'Ni Ketut Intan Rahmawati', 'Inovatif', 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=300&h=300'
WHERE NOT EXISTS (SELECT 1 FROM duta_kandidat WHERE nama = 'Ni Ketut Intan Rahmawati');


-- >>> MIGRATION: 202605260002_add_video_url.sql >>>
-- supabase/migrations/202605260002_add_video_url.sql
-- Menambahkan kolom video_url ke tabel duta_kandidat untuk mendukung media nominasi siswa

ALTER TABLE duta_kandidat 
ADD COLUMN IF NOT EXISTS video_url TEXT;


-- >>> MIGRATION: 202605260003_duta_rekap.sql >>>
-- supabase/migrations/202605260003_duta_rekap.sql
-- Menambahkan kolom role_pemilih pada duta_suara_masuk dan skor_rekam_jejak pada duta_kandidat

-- 1. Menambahkan kolom role_pemilih ke duta_suara_masuk (jika belum ada)
ALTER TABLE duta_suara_masuk ADD COLUMN IF NOT EXISTS role_pemilih TEXT DEFAULT 'siswa';

-- 2. Menambahkan kolom skor_rekam_jejak ke duta_kandidat (jika belum ada)
ALTER TABLE duta_kandidat ADD COLUMN IF NOT EXISTS skor_rekam_jejak NUMERIC DEFAULT 0;


-- >>> MIGRATION: 202605260004_duta_fields.sql >>>
-- supabase/migrations/202605260004_duta_fields.sql
-- Menambahkan kolom kelas, prestasi, dan catatan_lain pada tabel duta_kandidat

ALTER TABLE duta_kandidat ADD COLUMN IF NOT EXISTS kelas TEXT;
ALTER TABLE duta_kandidat ADD COLUMN IF NOT EXISTS prestasi TEXT;
ALTER TABLE duta_kandidat ADD COLUMN IF NOT EXISTS catatan_lain TEXT;


-- >>> MIGRATION: 202605260005_fix_rls_upsert.sql >>>
-- supabase/migrations/202605260005_fix_rls_upsert.sql
-- Memperbaiki RLS Policy agar operasi UPSERT (INSERT + UPDATE) berfungsi
-- untuk tabel duta_suara_masuk dari klien anonim (anon key).
-- 
-- Masalah: Upsert memerlukan policy UPDATE selain INSERT.
-- Solusi : Tambahkan policy UPDATE dan pastikan policy SELECT/INSERT tetap ada.

-- 1. Drop policy lama agar tidak duplikasi
DROP POLICY IF EXISTS "Allow anonymous insert votes"  ON duta_suara_masuk;
DROP POLICY IF EXISTS "Allow anonymous read votes"    ON duta_suara_masuk;
DROP POLICY IF EXISTS "Allow anonymous update votes"  ON duta_suara_masuk;
DROP POLICY IF EXISTS "Allow anonymous delete votes"  ON duta_suara_masuk;

-- 2. Buat ulang semua policy yang diperlukan untuk operasi voting
-- SELECT: Semua pengguna boleh membaca data suara (untuk statistik)
CREATE POLICY "Allow anonymous read votes"
    ON duta_suara_masuk FOR SELECT
    USING (true);

-- INSERT: Semua pengguna boleh mengirim suara baru
CREATE POLICY "Allow anonymous insert votes"
    ON duta_suara_masuk FOR INSERT
    WITH CHECK (true);

-- UPDATE: Diperlukan oleh operasi UPSERT saat siswa mengganti pilihan
CREATE POLICY "Allow anonymous update votes"
    ON duta_suara_masuk FOR UPDATE
    USING (true)
    WITH CHECK (true);

-- 3. Pastikan juga tabel duta_kandidat punya policy CRUD lengkap untuk admin
DROP POLICY IF EXISTS "Allow anonymous read candidates"   ON duta_kandidat;
DROP POLICY IF EXISTS "Allow anonymous insert candidates"  ON duta_kandidat;
DROP POLICY IF EXISTS "Allow anonymous update candidates"  ON duta_kandidat;
DROP POLICY IF EXISTS "Allow anonymous delete candidates"  ON duta_kandidat;

CREATE POLICY "Allow anonymous read candidates"
    ON duta_kandidat FOR SELECT USING (true);

CREATE POLICY "Allow anonymous insert candidates"
    ON duta_kandidat FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow anonymous update candidates"
    ON duta_kandidat FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "Allow anonymous delete candidates"
    ON duta_kandidat FOR DELETE USING (true);


-- >>> MIGRATION: 202606050001_suka_duka.sql >>>
-- supabase/migrations/202606050001_suka_duka.sql
-- Skema Database Modul Iuran Suka-Duka Guru & Pegawai

-- 1. Membuat tabel konfigurasi (sukaduka_config)
CREATE TABLE IF NOT EXISTS sukaduka_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Membuat tabel arus kas (sukaduka_kas)
CREATE TABLE IF NOT EXISTS sukaduka_kas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipe TEXT NOT NULL CHECK (tipe IN ('masuk', 'keluar')),
    kategori TEXT NOT NULL, -- 'iuran_bulanan', 'donasi', 'santunan_pernikahan', 'santunan_duka', 'santunan_sakit', 'lain_lain'
    jumlah NUMERIC(12,2) NOT NULL,
    tanggal DATE NOT NULL DEFAULT CURRENT_DATE,
    keterangan TEXT,
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Membuat tabel pembayaran iuran (sukaduka_iuran)
CREATE TABLE IF NOT EXISTS sukaduka_iuran (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guru_id TEXT NOT NULL, -- ID Dokumen Firestore Guru (Menjamin unik bahkan jika tanpa NIP)
    anggota_nama TEXT NOT NULL, -- Denormalisasi nama untuk pencarian dan export cepat
    anggota_nip TEXT, -- NIP (Opsional, jika guru/pegawai memilikinya)
    bulan_tahun TEXT NOT NULL, -- Format 'YYYY-MM' (Contoh: '2026-06')
    jumlah NUMERIC(12,2) NOT NULL,
    tanggal_bayar DATE NOT NULL DEFAULT CURRENT_DATE,
    kas_id UUID REFERENCES sukaduka_kas(id) ON DELETE CASCADE, -- Hubungan ke arus kas masuk
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT unique_guru_id_bulan_tahun UNIQUE (guru_id, bulan_tahun)
);

-- 4. Kebijakan Row Level Security (RLS) untuk akses anonim publik (SSO Firebase Auth divalidasi di Frontend)
ALTER TABLE sukaduka_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE sukaduka_kas ENABLE ROW LEVEL SECURITY;
ALTER TABLE sukaduka_iuran ENABLE ROW LEVEL SECURITY;

-- DROP POLICY jika sudah ada
DROP POLICY IF EXISTS "Allow anonymous read config" ON sukaduka_config;
DROP POLICY IF EXISTS "Allow anonymous write config" ON sukaduka_config;
DROP POLICY IF EXISTS "Allow anonymous read kas" ON sukaduka_kas;
DROP POLICY IF EXISTS "Allow anonymous write kas" ON sukaduka_kas;
DROP POLICY IF EXISTS "Allow anonymous read iuran" ON sukaduka_iuran;
DROP POLICY IF EXISTS "Allow anonymous write iuran" ON sukaduka_iuran;

-- Membuat Policy Baru (All operations)
CREATE POLICY "Allow anonymous read config" ON sukaduka_config FOR SELECT USING (true);
CREATE POLICY "Allow anonymous write config" ON sukaduka_config FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow anonymous read kas" ON sukaduka_kas FOR SELECT USING (true);
CREATE POLICY "Allow anonymous write kas" ON sukaduka_kas FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow anonymous read iuran" ON sukaduka_iuran FOR SELECT USING (true);
CREATE POLICY "Allow anonymous write iuran" ON sukaduka_iuran FOR ALL USING (true) WITH CHECK (true);

-- 5. Seeding data awal nominal iuran (Default: Rp 50.000)
INSERT INTO sukaduka_config (key, value)
SELECT 'nominal_iuran', '50000'
WHERE NOT EXISTS (SELECT 1 FROM sukaduka_config WHERE key = 'nominal_iuran');


-- >>> MIGRATION: 202606240001_masukkan.sql >>>
-- supabase/migrations/202606240001_masukkan.sql
-- Skema Database Modul Masukan & Saran Siswa/Guru (Tabel: masukkan_saran)

CREATE TABLE IF NOT EXISTS masukkan_saran (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'baru' CHECK (status IN ('baru', 'selesai', 'ditolak')),
    sender_uid TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    sender_email TEXT,
    sender_role TEXT,
    sender_roles TEXT[],
    response_text TEXT,
    response_by_uid TEXT,
    response_by_name TEXT,
    responded_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Mengaktifkan Row Level Security (RLS)
ALTER TABLE masukkan_saran ENABLE ROW LEVEL SECURITY;

-- Menghapus policy lama jika ada
DROP POLICY IF EXISTS "Allow anonymous read masukkan_saran" ON masukkan_saran;
DROP POLICY IF EXISTS "Allow anonymous insert masukkan_saran" ON masukkan_saran;
DROP POLICY IF EXISTS "Allow anonymous update masukkan_saran" ON masukkan_saran;
DROP POLICY IF EXISTS "Allow anonymous delete masukkan_saran" ON masukkan_saran;

-- Membuat policy baru untuk klien anonim (firebase auth dikontrol di frontend)
CREATE POLICY "Allow anonymous read masukkan_saran" ON masukkan_saran FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert masukkan_saran" ON masukkan_saran FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update masukkan_saran" ON masukkan_saran FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow anonymous delete masukkan_saran" ON masukkan_saran FOR DELETE USING (true);


-- >>> MIGRATION: 202606240002_add_source_url.sql >>>
-- supabase/migrations/202606240002_add_source_url.sql
-- Menambahkan kolom source_url ke tabel masukkan_saran

ALTER TABLE masukkan_saran ADD COLUMN IF NOT EXISTS source_url TEXT;


-- >>> MIGRATION: 202607010001_lockdown_rls_edge.sql >>>
-- supabase/migrations/202607010001_lockdown_rls_edge.sql
-- Mengunci rapat semua akses tulis (INSERT, UPDATE, DELETE) untuk klien anonim (anon key)
-- Semua perubahan data sensitif dialihkan melalui Supabase Edge Functions (service_role)

-- =========================================================================
-- 1. LOCKDOWN TABEL duta_kandidat
-- =========================================================================
ALTER TABLE duta_kandidat ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anonymous read candidates"   ON duta_kandidat;
DROP POLICY IF EXISTS "Allow anonymous insert candidates"  ON duta_kandidat;
DROP POLICY IF EXISTS "Allow anonymous update candidates"  ON duta_kandidat;
DROP POLICY IF EXISTS "Allow anonymous delete candidates"  ON duta_kandidat;

-- SELECT tetap diizinkan agar menu pemilihan duta bisa memuat nama & foto kandidat
CREATE POLICY "Allow anonymous read candidates" ON duta_kandidat FOR SELECT USING (true);
-- INSERT, UPDATE, DELETE ditutup total untuk anon (hanya service_role / postgres yang bisa)

-- =========================================================================
-- 2. LOCKDOWN TABEL duta_suara_masuk
-- =========================================================================
ALTER TABLE duta_suara_masuk ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anonymous read votes"    ON duta_suara_masuk;
DROP POLICY IF EXISTS "Allow anonymous insert votes"  ON duta_suara_masuk;
DROP POLICY IF EXISTS "Allow anonymous update votes"  ON duta_suara_masuk;
DROP POLICY IF EXISTS "Allow anonymous delete votes"  ON duta_suara_masuk;

-- SELECT tetap diizinkan untuk statistik hasil suara secara realtime
CREATE POLICY "Allow anonymous read votes" ON duta_suara_masuk FOR SELECT USING (true);
-- INSERT, UPDATE, DELETE ditutup total untuk anon

-- =========================================================================
-- 3. LOCKDOWN TABEL sukaduka_config, sukaduka_kas, sukaduka_iuran
-- =========================================================================
ALTER TABLE sukaduka_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE sukaduka_kas ENABLE ROW LEVEL SECURITY;
ALTER TABLE sukaduka_iuran ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anonymous read config" ON sukaduka_config;
DROP POLICY IF EXISTS "Allow anonymous write config" ON sukaduka_config;
DROP POLICY IF EXISTS "Allow anonymous read kas" ON sukaduka_kas;
DROP POLICY IF EXISTS "Allow anonymous write kas" ON sukaduka_kas;
DROP POLICY IF EXISTS "Allow anonymous read iuran" ON sukaduka_iuran;
DROP POLICY IF EXISTS "Allow anonymous write iuran" ON sukaduka_iuran;

-- SELECT tetap diizinkan agar guru/pegawai bisa melihat riwayat iuran & buku kas
CREATE POLICY "Allow anonymous read config" ON sukaduka_config FOR SELECT USING (true);
CREATE POLICY "Allow anonymous read kas" ON sukaduka_kas FOR SELECT USING (true);
CREATE POLICY "Allow anonymous read iuran" ON sukaduka_iuran FOR SELECT USING (true);
-- Modifikasi (ALL) ditutup total untuk anon

-- =========================================================================
-- 4. LOCKDOWN TABEL masukkan_saran
-- =========================================================================
ALTER TABLE masukkan_saran ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anonymous read masukkan_saran" ON masukkan_saran;
DROP POLICY IF EXISTS "Allow anonymous insert masukkan_saran" ON masukkan_saran;
DROP POLICY IF EXISTS "Allow anonymous update masukkan_saran" ON masukkan_saran;
DROP POLICY IF EXISTS "Allow anonymous delete masukkan_saran" ON masukkan_saran;

-- SELECT tetap diizinkan untuk memuat daftar masukan
CREATE POLICY "Allow anonymous read masukkan_saran" ON masukkan_saran FOR SELECT USING (true);
-- INSERT, UPDATE, DELETE ditutup total untuk anon


-- >>> MIGRATION: 202607270001_enable_realtime_duta_suara.sql >>>
-- supabase/migrations/202607270001_enable_realtime_duta_suara.sql
-- Mengaktifkan Supabase Realtime pada tabel duta_suara_masuk
-- Diperlukan agar panel admin Duta SHAKTI menerima update suara secara live

-- Tambahkan tabel duta_suara_masuk ke Supabase Realtime publication
-- Ini memungkinkan client JS mendengarkan perubahan data via WebSocket
ALTER PUBLICATION supabase_realtime ADD TABLE duta_suara_masuk;

-- Set REPLICA IDENTITY agar Realtime mengirimkan data lengkap saat UPDATE/DELETE
-- (default 'DEFAULT' hanya mengirim primary key, 'FULL' mengirimkan seluruh kolom)
ALTER TABLE duta_suara_masuk REPLICA IDENTITY FULL;


-- >>> MIGRATION: 202608080001_guru_mapel_grades.sql >>>
-- supabase/migrations/202608080001_guru_mapel_grades.sql
-- Skema Database Modul Portal Guru Mapel (Input Nilai Tugas, Sumatif, & SAS/SAT)

-- 1. Tabel Utama Gradebook (guru_mapel_gradebooks)
CREATE TABLE IF NOT EXISTS guru_mapel_gradebooks (
    id TEXT PRIMARY KEY, -- Format: {tahun_ajaran}_{semester}_{class_id}_{subject_id}
    tahun_ajaran VARCHAR(20) NOT NULL,
    semester VARCHAR(5) NOT NULL, -- '1' atau '2'
    class_id VARCHAR(50) NOT NULL,
    subject_id VARCHAR(100) NOT NULL,
    teacher_nip VARCHAR(50),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT unique_gradebook_scope UNIQUE (tahun_ajaran, semester, class_id, subject_id)
);

-- 2. Tabel Komponen Penilaian (guru_mapel_components)
CREATE TABLE IF NOT EXISTS guru_mapel_components (
    id BIGSERIAL PRIMARY KEY,
    gradebook_id TEXT NOT NULL REFERENCES guru_mapel_gradebooks(id) ON DELETE CASCADE,
    component_type VARCHAR(20) NOT NULL, -- 'tugas', 'sumatif', 'sas', 'sat'
    label VARCHAR(100) NOT NULL,
    sequence INT DEFAULT 1,
    is_optional BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT unique_component_label UNIQUE (gradebook_id, component_type, label)
);

-- 3. Tabel Nilai Per Siswa dan Komponen (guru_mapel_scores)
CREATE TABLE IF NOT EXISTS guru_mapel_scores (
    id BIGSERIAL PRIMARY KEY,
    gradebook_id TEXT NOT NULL REFERENCES guru_mapel_gradebooks(id) ON DELETE CASCADE,
    student_nis VARCHAR(50) NOT NULL,
    component_id BIGINT NOT NULL REFERENCES guru_mapel_components(id) ON DELETE CASCADE,
    score NUMERIC(5,2) DEFAULT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT unique_student_component_score UNIQUE (gradebook_id, student_nis, component_id)
);

-- 4. Tabel Ringkasan Nilai Akhir & Deskripsi CP (guru_mapel_summaries)
CREATE TABLE IF NOT EXISTS guru_mapel_summaries (
    id BIGSERIAL PRIMARY KEY,
    gradebook_id TEXT NOT NULL REFERENCES guru_mapel_gradebooks(id) ON DELETE CASCADE,
    student_nis VARCHAR(50) NOT NULL,
    tugas_avg NUMERIC(5,2) DEFAULT NULL,
    sumatif_avg NUMERIC(5,2) DEFAULT NULL,
    sas_sat_score NUMERIC(5,2) DEFAULT NULL,
    final_score NUMERIC(5,2) DEFAULT NULL,
    deskripsi_cp TEXT DEFAULT '',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT unique_student_summary UNIQUE (gradebook_id, student_nis)
);

-- 5. Kebijakan Row Level Security (RLS)
ALTER TABLE guru_mapel_gradebooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE guru_mapel_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE guru_mapel_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE guru_mapel_summaries ENABLE ROW LEVEL SECURITY;

-- Drop Policy lama jika ada
DROP POLICY IF EXISTS "Allow anonymous read gradebooks" ON guru_mapel_gradebooks;
DROP POLICY IF EXISTS "Allow anonymous write gradebooks" ON guru_mapel_gradebooks;
DROP POLICY IF EXISTS "Allow anonymous read components" ON guru_mapel_components;
DROP POLICY IF EXISTS "Allow anonymous write components" ON guru_mapel_components;
DROP POLICY IF EXISTS "Allow anonymous read scores" ON guru_mapel_scores;
DROP POLICY IF EXISTS "Allow anonymous write scores" ON guru_mapel_scores;
DROP POLICY IF EXISTS "Allow anonymous read summaries" ON guru_mapel_summaries;
DROP POLICY IF EXISTS "Allow anonymous write summaries" ON guru_mapel_summaries;

-- Policy All Operations (Anon Key)
CREATE POLICY "Allow anonymous read gradebooks" ON guru_mapel_gradebooks FOR SELECT USING (true);
CREATE POLICY "Allow anonymous write gradebooks" ON guru_mapel_gradebooks FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow anonymous read components" ON guru_mapel_components FOR SELECT USING (true);
CREATE POLICY "Allow anonymous write components" ON guru_mapel_components FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow anonymous read scores" ON guru_mapel_scores FOR SELECT USING (true);
CREATE POLICY "Allow anonymous write scores" ON guru_mapel_scores FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow anonymous read summaries" ON guru_mapel_summaries FOR SELECT USING (true);
CREATE POLICY "Allow anonymous write summaries" ON guru_mapel_summaries FOR ALL USING (true) WITH CHECK (true);


-- >>> MIGRATION: 202608080002_update_masukkan_status_check.sql >>>
-- supabase/migrations/202608080002_update_masukkan_status_check.sql
-- Memperbarui constraint status pada tabel masukkan_saran agar mendukung variasi status baru

ALTER TABLE masukkan_saran DROP CONSTRAINT IF EXISTS masukkan_saran_status_check;

ALTER TABLE masukkan_saran ADD CONSTRAINT masukkan_saran_status_check 
    CHECK (status IN ('baru', 'proses', 'direncanakan', 'butuh_info', 'selesai', 'ditolak'));


-- >>> MIGRATION: 202608140001_finance_system.sql >>>
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


-- >>> MIGRATION: 202608140002_guru_presensi.sql >>>
-- supabase/migrations/202608140002_guru_presensi.sql
-- Skema Database Modul Presensi Guru Harian (guru_presensi) SIMAS SHAKTI (Supabase PostgreSQL)

-- 1. Tabel Presensi Guru (guru_presensi)
CREATE TABLE IF NOT EXISTS guru_presensi (
    id VARCHAR(64) PRIMARY KEY, -- Format: {kelas_slug}_{tanggal}_{jp}, contoh: XII_IPA_1_2026-08-14_1
    kelas VARCHAR(50) NOT NULL,
    tanggal DATE NOT NULL,
    jp SMALLINT NOT NULL CHECK (jp >= 1 AND jp <= 10),
    mapel VARCHAR(150) NOT NULL,
    guru_id VARCHAR(100),
    guru_nama VARCHAR(200) NOT NULL,
    status VARCHAR(10) NOT NULL, -- 'H', 'I', 'S', 'K', 'TK'
    ada_tugas BOOLEAN DEFAULT NULL, -- true/false untuk I/S, null untuk H/K/TK
    created_by VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT uq_guru_presensi_slot UNIQUE (kelas, tanggal, jp)
);

-- 2. Indexing untuk Kueri Super Cepat & Ringan Egress
CREATE INDEX IF NOT EXISTS idx_guru_presensi_kelas_tanggal ON guru_presensi(kelas, tanggal);
CREATE INDEX IF NOT EXISTS idx_guru_presensi_tanggal ON guru_presensi(tanggal);
CREATE INDEX IF NOT EXISTS idx_guru_presensi_guru_id ON guru_presensi(guru_id);
CREATE INDEX IF NOT EXISTS idx_guru_presensi_guru_nama ON guru_presensi(guru_nama);
CREATE INDEX IF NOT EXISTS idx_guru_presensi_status ON guru_presensi(status);

-- 3. Row Level Security (RLS)
ALTER TABLE guru_presensi ENABLE ROW LEVEL SECURITY;

-- Drop Policy lama jika ada
DROP POLICY IF EXISTS "Allow read guru_presensi" ON guru_presensi;
DROP POLICY IF EXISTS "Allow write guru_presensi" ON guru_presensi;

-- Policies Akses Klien
CREATE POLICY "Allow read guru_presensi" ON guru_presensi FOR SELECT USING (true);
CREATE POLICY "Allow write guru_presensi" ON guru_presensi FOR ALL USING (true) WITH CHECK (true);


-- >>> MIGRATION: 202608140003_siswa_presensi.sql >>>
-- supabase/migrations/202608140003_siswa_presensi.sql
-- Skema Database Modul Presensi Siswa Harian & Agregat (siswa_presensi & siswa_presensi_harian)
-- SIMAS SHAKTI (Supabase PostgreSQL)

-- 1. TABEL HEADER / SUMMARY PRESENSI KELAS HARIAN
CREATE TABLE IF NOT EXISTS public.siswa_presensi_harian (
    id VARCHAR(100) PRIMARY KEY, -- Format: '{kelas}_{tanggal}' misal 'X-1_2026-08-14'
    kelas VARCHAR(50) NOT NULL,
    tanggal DATE NOT NULL,
    summary JSONB NOT NULL DEFAULT '{"H":0,"S":0,"I":0,"D":0,"A":0}'::jsonb,
    total_students INT DEFAULT 0,
    recorded_by VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT unique_presensi_harian_kelas_tanggal UNIQUE (kelas, tanggal)
);

-- Indeks Kecepatan Tinggi untuk siswa_presensi_harian
CREATE INDEX IF NOT EXISTS idx_presensi_harian_tanggal ON public.siswa_presensi_harian (tanggal);
CREATE INDEX IF NOT EXISTS idx_presensi_harian_kelas ON public.siswa_presensi_harian (kelas);
CREATE INDEX IF NOT EXISTS idx_presensi_harian_kelas_tanggal ON public.siswa_presensi_harian (kelas, tanggal);

-- 2. TABEL DETAIL PRESENSI SISWA (GRANULAR STATUS PER SISWA)
CREATE TABLE IF NOT EXISTS public.siswa_presensi (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kelas VARCHAR(50) NOT NULL,
    tanggal DATE NOT NULL,
    student_nis VARCHAR(30) NOT NULL,
    student_name VARCHAR(150),
    status VARCHAR(5) NOT NULL DEFAULT 'H', -- 'H', 'S', 'I', 'A', 'D', 'P'
    note TEXT DEFAULT '',
    has_letter BOOLEAN DEFAULT FALSE,
    recorded_by VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT unique_siswa_presensi_nis_tanggal UNIQUE (student_nis, tanggal)
);

-- Indeks Kecepatan Tinggi untuk siswa_presensi
CREATE INDEX IF NOT EXISTS idx_siswa_presensi_kelas_tanggal ON public.siswa_presensi (kelas, tanggal);
CREATE INDEX IF NOT EXISTS idx_siswa_presensi_nis_tanggal ON public.siswa_presensi (student_nis, tanggal);
CREATE INDEX IF NOT EXISTS idx_siswa_presensi_tanggal ON public.siswa_presensi (tanggal);
CREATE INDEX IF NOT EXISTS idx_siswa_presensi_nis ON public.siswa_presensi (student_nis);
CREATE INDEX IF NOT EXISTS idx_siswa_presensi_status ON public.siswa_presensi (status);

-- 3. ENABLE ROW LEVEL SECURITY & POLICIES (Konsisten dengan guru_presensi & finance)
ALTER TABLE public.siswa_presensi_harian ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.siswa_presensi ENABLE ROW LEVEL SECURITY;

-- Drop policies jika sudah ada sebelumnya agar idempotent
DROP POLICY IF EXISTS "Allow public read siswa_presensi_harian" ON public.siswa_presensi_harian;
DROP POLICY IF EXISTS "Allow public all siswa_presensi_harian" ON public.siswa_presensi_harian;
DROP POLICY IF EXISTS "Allow public read siswa_presensi" ON public.siswa_presensi;
DROP POLICY IF EXISTS "Allow public all siswa_presensi" ON public.siswa_presensi;

-- Create Policies
CREATE POLICY "Allow public read siswa_presensi_harian" 
ON public.siswa_presensi_harian FOR SELECT USING (true);

CREATE POLICY "Allow public all siswa_presensi_harian" 
ON public.siswa_presensi_harian FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow public read siswa_presensi" 
ON public.siswa_presensi FOR SELECT USING (true);

CREATE POLICY "Allow public all siswa_presensi" 
ON public.siswa_presensi FOR ALL USING (true) WITH CHECK (true);


-- >>> MIGRATION: 202608140004_fix_security_advisor_rls.sql >>>
-- supabase/migrations/202608140004_fix_security_advisor_rls.sql
-- Optimasi Keamanan Database & Penyelesaian Peringatan Supabase Security Advisor
-- 1. Mengamankan fungsi SECURITY DEFINER rls_auto_enable dari RPC publik (anon/authenticated)
-- 2. Membersihkan redundansi RLS policy ganda (SELECT + ALL) pada seluruh tabel baru

-- =========================================================================
-- 1. AMANKAN FUNGSI SECURITY DEFINER (rls_auto_enable)
-- =========================================================================
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc p 
        JOIN pg_namespace n ON p.pronamespace = n.oid 
        WHERE n.nspname = 'public' AND p.proname = 'rls_auto_enable'
    ) THEN
        REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
        REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon;
        REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM authenticated;
        GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO service_role, postgres;
    END IF;
END $$;

-- =========================================================================
-- 2. OPTIMASI & DEDUPLIKASI RLS POLICY: MODUL GURU MAPEL
-- =========================================================================
DROP POLICY IF EXISTS "Allow anonymous read gradebooks" ON public.guru_mapel_gradebooks;
DROP POLICY IF EXISTS "Allow anonymous write gradebooks" ON public.guru_mapel_gradebooks;
DROP POLICY IF EXISTS "Allow anon all gradebooks" ON public.guru_mapel_gradebooks;
CREATE POLICY "Allow anon all gradebooks" ON public.guru_mapel_gradebooks FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anonymous read components" ON public.guru_mapel_components;
DROP POLICY IF EXISTS "Allow anonymous write components" ON public.guru_mapel_components;
DROP POLICY IF EXISTS "Allow anon all components" ON public.guru_mapel_components;
CREATE POLICY "Allow anon all components" ON public.guru_mapel_components FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anonymous read scores" ON public.guru_mapel_scores;
DROP POLICY IF EXISTS "Allow anonymous write scores" ON public.guru_mapel_scores;
DROP POLICY IF EXISTS "Allow anon all scores" ON public.guru_mapel_scores;
CREATE POLICY "Allow anon all scores" ON public.guru_mapel_scores FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anonymous read summaries" ON public.guru_mapel_summaries;
DROP POLICY IF EXISTS "Allow anonymous write summaries" ON public.guru_mapel_summaries;
DROP POLICY IF EXISTS "Allow anon all summaries" ON public.guru_mapel_summaries;
CREATE POLICY "Allow anon all summaries" ON public.guru_mapel_summaries FOR ALL USING (true) WITH CHECK (true);

-- =========================================================================
-- 3. OPTIMASI & DEDUPLIKASI RLS POLICY: MODUL KEUANGAN (SPP & KAS KOMITE)
-- =========================================================================
DROP POLICY IF EXISTS "Allow read finance_transactions" ON public.finance_transactions;
DROP POLICY IF EXISTS "Allow write finance_transactions" ON public.finance_transactions;
DROP POLICY IF EXISTS "Allow full access finance_transactions" ON public.finance_transactions;
CREATE POLICY "Allow full access finance_transactions" ON public.finance_transactions FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow read finance_daily_summary" ON public.finance_daily_summary;
DROP POLICY IF EXISTS "Allow write finance_daily_summary" ON public.finance_daily_summary;
DROP POLICY IF EXISTS "Allow full access finance_daily_summary" ON public.finance_daily_summary;
CREATE POLICY "Allow full access finance_daily_summary" ON public.finance_daily_summary FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow read finance_cashflow" ON public.finance_cashflow;
DROP POLICY IF EXISTS "Allow write finance_cashflow" ON public.finance_cashflow;
DROP POLICY IF EXISTS "Allow full access finance_cashflow" ON public.finance_cashflow;
CREATE POLICY "Allow full access finance_cashflow" ON public.finance_cashflow FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow read finance_closings" ON public.finance_closings;
DROP POLICY IF EXISTS "Allow write finance_closings" ON public.finance_closings;
DROP POLICY IF EXISTS "Allow full access finance_closings" ON public.finance_closings;
CREATE POLICY "Allow full access finance_closings" ON public.finance_closings FOR ALL USING (true) WITH CHECK (true);

-- =========================================================================
-- 4. OPTIMASI & DEDUPLIKASI RLS POLICY: MODUL PRESENSI GURU & SISWA
-- =========================================================================
DROP POLICY IF EXISTS "Allow public read guru_presensi" ON public.guru_presensi;
DROP POLICY IF EXISTS "Allow public all guru_presensi" ON public.guru_presensi;
DROP POLICY IF EXISTS "Allow full access guru_presensi" ON public.guru_presensi;
CREATE POLICY "Allow full access guru_presensi" ON public.guru_presensi FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public read siswa_presensi_harian" ON public.siswa_presensi_harian;
DROP POLICY IF EXISTS "Allow public all siswa_presensi_harian" ON public.siswa_presensi_harian;
DROP POLICY IF EXISTS "Allow full access siswa_presensi_harian" ON public.siswa_presensi_harian;
CREATE POLICY "Allow full access siswa_presensi_harian" ON public.siswa_presensi_harian FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public read siswa_presensi" ON public.siswa_presensi;
DROP POLICY IF EXISTS "Allow public all siswa_presensi" ON public.siswa_presensi;
DROP POLICY IF EXISTS "Allow full access siswa_presensi" ON public.siswa_presensi;
CREATE POLICY "Allow full access siswa_presensi" ON public.siswa_presensi FOR ALL USING (true) WITH CHECK (true);


-- >>> MIGRATION: 202608140005_fix_cashflow_category_default.sql >>>
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


-- >>> MIGRATION: 202608150001_retention_pg_cron_all_tables.sql >>>
-- ====================================================================
-- MIGRATION: RETENSI DATA MULTI-TABEL OTOMATIS VIA PG_CRON
-- Database: PostgreSQL Supabase (elrmzlicuuglnoeedusr)
-- Author: SIMAS SMAGESA Development Team
-- Date: 2026-08-15
-- Version: 1.1.313 / [26.08.15.16]
-- ====================================================================

-- 1. AKTIFKAN EKSTENSI PG_CRON
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ====================================================================
-- 2. FUNGSI-FUNGSI PEMBERSIHAN DATA BERKALA (ROLLING DATA RETENTION)
-- ====================================================================

-- A. PRESENSI SISWA (Retensi: 3 Tahun / Masa Studi SMA)
CREATE OR REPLACE FUNCTION public.cleanup_old_siswa_presensi()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_detail INT := 0;
    deleted_header INT := 0;
    cutoff_date DATE;
BEGIN
    cutoff_date := (CURRENT_DATE - INTERVAL '3 years')::DATE;

    DELETE FROM public.siswa_presensi
    WHERE tanggal < cutoff_date;
    GET DIAGNOSTICS deleted_detail = ROW_COUNT;

    DELETE FROM public.siswa_presensi_harian
    WHERE tanggal < cutoff_date;
    GET DIAGNOSTICS deleted_header = ROW_COUNT;

    RETURN jsonb_build_object(
        'module', 'siswa_presensi',
        'status', 'success',
        'cutoff_date', cutoff_date,
        'deleted_detail_rows', deleted_detail,
        'deleted_header_rows', deleted_header,
        'executed_at', NOW()
    );
END;
$$;

-- B. PRESENSI MENGAJAR GURU (Retensi: 3 Tahun)
CREATE OR REPLACE FUNCTION public.cleanup_old_guru_presensi()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_count INT := 0;
    cutoff_date DATE;
BEGIN
    cutoff_date := (CURRENT_DATE - INTERVAL '3 years')::DATE;

    DELETE FROM public.guru_presensi
    WHERE tanggal < cutoff_date;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'module', 'guru_presensi',
        'status', 'success',
        'cutoff_date', cutoff_date,
        'deleted_rows', deleted_count,
        'executed_at', NOW()
    );
END;
$$;

-- C. PEMILIHAN DUTA SHAKTI (Retensi: 6 Bulan)
CREATE OR REPLACE FUNCTION public.cleanup_old_duta_votes()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_votes INT := 0;
    cutoff_timestamp TIMESTAMPTZ;
BEGIN
    cutoff_timestamp := NOW() - INTERVAL '6 months';

    DELETE FROM public.duta_suara_masuk
    WHERE created_at < cutoff_timestamp;
    GET DIAGNOSTICS deleted_votes = ROW_COUNT;

    RETURN jsonb_build_object(
        'module', 'duta_suara_masuk',
        'status', 'success',
        'cutoff_timestamp', cutoff_timestamp,
        'deleted_votes_rows', deleted_votes,
        'executed_at', NOW()
    );
END;
$$;

-- D. KOTAK SARAN & ASPIRASI (Retensi: 1 Tahun untuk status selesai/ditolak, 2 Tahun untuk semua arsip)
CREATE OR REPLACE FUNCTION public.cleanup_old_masukkan_saran()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_resolved INT := 0;
    deleted_archive INT := 0;
    cutoff_resolved TIMESTAMPTZ;
    cutoff_archive TIMESTAMPTZ;
BEGIN
    cutoff_resolved := NOW() - INTERVAL '1 year';
    cutoff_archive := NOW() - INTERVAL '2 years';

    -- 1. Hapus tiket yang sudah berstatus 'selesai' atau 'ditolak' yang berumur > 1 tahun
    DELETE FROM public.masukkan_saran
    WHERE status IN ('selesai', 'ditolak')
      AND created_at < cutoff_resolved;
    GET DIAGNOSTICS deleted_resolved = ROW_COUNT;

    -- 2. Hapus seluruh riwayat saran lama yang berumur > 2 tahun
    DELETE FROM public.masukkan_saran
    WHERE created_at < cutoff_archive;
    GET DIAGNOSTICS deleted_archive = ROW_COUNT;

    RETURN jsonb_build_object(
        'module', 'masukkan_saran',
        'status', 'success',
        'deleted_resolved_rows', deleted_resolved,
        'deleted_archive_rows', deleted_archive,
        'total_deleted_rows', (deleted_resolved + deleted_archive),
        'executed_at', NOW()
    );
END;
$$;

-- E. PORTAL NILAI GURU MAPEL (Retensi: 3 Tahun / Masa Studi SMA)
-- Menghapus gradebooks lama > 3 tahun (Komponen, Nilai Siswa, & Ringkasan otomatis terhapus via ON DELETE CASCADE)
CREATE OR REPLACE FUNCTION public.cleanup_old_guru_mapel_grades()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_gradebooks INT := 0;
    cutoff_timestamp TIMESTAMPTZ;
BEGIN
    cutoff_timestamp := NOW() - INTERVAL '3 years';

    DELETE FROM public.guru_mapel_gradebooks
    WHERE updated_at < cutoff_timestamp;
    GET DIAGNOSTICS deleted_gradebooks = ROW_COUNT;

    RETURN jsonb_build_object(
        'module', 'guru_mapel_grades',
        'status', 'success',
        'cutoff_timestamp', cutoff_timestamp,
        'deleted_gradebooks_rows', deleted_gradebooks,
        'note', 'Child tables (components, scores, summaries) cascaded automatically',
        'executed_at', NOW()
    );
END;
$$;

-- F. KEUANGAN SPP & KAS KOMITE (Retensi: 5 Tahun / Standar Audit Keuangan)
-- Catatan: Tabel tutup buku tahunan `finance_closings` tidak dihapus (disimpan permanen)
CREATE OR REPLACE FUNCTION public.cleanup_old_finance_records()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_tx INT := 0;
    deleted_cashflow INT := 0;
    deleted_daily INT := 0;
    cutoff_timestamp TIMESTAMPTZ;
    cutoff_date_str TEXT;
BEGIN
    cutoff_timestamp := NOW() - INTERVAL '5 years';
    cutoff_date_str := (CURRENT_DATE - INTERVAL '5 years')::TEXT;

    -- 1. Hapus transaksi SPP siswa > 5 tahun
    DELETE FROM public.finance_transactions
    WHERE created_at < cutoff_timestamp
       OR (payment_date IS NOT NULL AND payment_date < cutoff_timestamp);
    GET DIAGNOSTICS deleted_tx = ROW_COUNT;

    -- 2. Hapus mutasi arus kas komite > 5 tahun
    DELETE FROM public.finance_cashflow
    WHERE created_at < cutoff_timestamp;
    GET DIAGNOSTICS deleted_cashflow = ROW_COUNT;

    -- 3. Hapus ringkasan harian SPP > 5 tahun
    DELETE FROM public.finance_daily_summary
    WHERE date_str < cutoff_date_str;
    GET DIAGNOSTICS deleted_daily = ROW_COUNT;

    RETURN jsonb_build_object(
        'module', 'finance',
        'status', 'success',
        'cutoff_timestamp', cutoff_timestamp,
        'deleted_transactions_rows', deleted_tx,
        'deleted_cashflow_rows', deleted_cashflow,
        'deleted_daily_summary_rows', deleted_daily,
        'executed_at', NOW()
    );
END;
$$;

-- G. DANA SOSIAL SUKA DUKA GURU (Retensi: 5 Tahun)
-- Catatan: Tabel master `sukaduka_config` diproteksi (tidak dihapus)
CREATE OR REPLACE FUNCTION public.cleanup_old_sukaduka_records()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_iuran INT := 0;
    deleted_kas INT := 0;
    cutoff_date DATE;
BEGIN
    cutoff_date := (CURRENT_DATE - INTERVAL '5 years')::DATE;

    -- 1. Hapus riwayat iuran > 5 tahun
    DELETE FROM public.sukaduka_iuran
    WHERE tanggal_bayar < cutoff_date;
    GET DIAGNOSTICS deleted_iuran = ROW_COUNT;

    -- 2. Hapus arus kas suka duka > 5 tahun
    DELETE FROM public.sukaduka_kas
    WHERE tanggal < cutoff_date;
    GET DIAGNOSTICS deleted_kas = ROW_COUNT;

    RETURN jsonb_build_object(
        'module', 'sukaduka',
        'status', 'success',
        'cutoff_date', cutoff_date,
        'deleted_iuran_rows', deleted_iuran,
        'deleted_kas_rows', deleted_kas,
        'executed_at', NOW()
    );
END;
$$;

-- ====================================================================
-- 3. MASTER RUNNER FUNCTION (EKSEKUSI SELURUH PEMBERSIHAN SEKALIGUS)
-- ====================================================================
CREATE OR REPLACE FUNCTION public.cleanup_all_expired_simas_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    res_siswa jsonb;
    res_guru jsonb;
    res_duta jsonb;
    res_saran jsonb;
    res_grades jsonb;
    res_finance jsonb;
    res_sukaduka jsonb;
BEGIN
    res_siswa := public.cleanup_old_siswa_presensi();
    res_guru := public.cleanup_old_guru_presensi();
    res_duta := public.cleanup_old_duta_votes();
    res_saran := public.cleanup_old_masukkan_saran();
    res_grades := public.cleanup_old_guru_mapel_grades();
    res_finance := public.cleanup_old_finance_records();
    res_sukaduka := public.cleanup_old_sukaduka_records();

    RETURN jsonb_build_object(
        'status', 'success',
        'executed_at', NOW(),
        'results', jsonb_build_object(
            'siswa_presensi', res_siswa,
            'guru_presensi', res_guru,
            'duta_votes', res_duta,
            'masukkan_saran', res_saran,
            'guru_mapel_grades', res_grades,
            'finance', res_finance,
            'sukaduka', res_sukaduka
        )
    );
END;
$$;

-- ====================================================================
-- 4. DAFTARKAN JADWAL OTOMATIS VIA PG_CRON
-- Berjalan setiap tanggal 1 awal bulan pukul 02:00 - 02:30 WITA (18:00 - 18:30 UTC)
-- Format cron: Minute Hour DayOfMonth Month DayOfWeek
-- ====================================================================

-- 4.1 Hapus jadwal lama jika ada (Idempotent)
DO $$
DECLARE
    job_record RECORD;
BEGIN
    FOR job_record IN 
        SELECT jobname FROM cron.job 
        WHERE jobname IN (
            'auto-cleanup-presensi-siswa-3thn',
            'auto-cleanup-siswa-presensi',
            'auto-cleanup-guru-presensi',
            'auto-cleanup-duta-votes',
            'auto-cleanup-masukkan-saran',
            'auto-cleanup-guru-mapel-grades',
            'auto-cleanup-finance-records',
            'auto-cleanup-sukaduka-records'
        )
    LOOP
        PERFORM cron.unschedule(job_record.jobname);
    END LOOP;
END $$;

-- 4.2 Daftarkan jadwal pembersihan masing-masing tabel (Staggered per 5 menit)
-- 1. Presensi Siswa: Tanggal 1 pukul 02:00 WITA (18:00 UTC)
SELECT cron.schedule(
    'auto-cleanup-siswa-presensi',
    '0 18 1 * *',
    $$SELECT public.cleanup_old_siswa_presensi();$$
);

-- 2. Presensi Guru: Tanggal 1 pukul 02:05 WITA (18:05 UTC)
SELECT cron.schedule(
    'auto-cleanup-guru-presensi',
    '5 18 1 * *',
    $$SELECT public.cleanup_old_guru_presensi();$$
);

-- 3. Suara Duta SHAKTI: Tanggal 1 pukul 02:10 WITA (18:10 UTC) - Retensi 6 Bulan
SELECT cron.schedule(
    'auto-cleanup-duta-votes',
    '10 18 1 * *',
    $$SELECT public.cleanup_old_duta_votes();$$
);

-- 4. Kotak Masukan & Saran: Tanggal 1 pukul 02:15 WITA (18:15 UTC)
SELECT cron.schedule(
    'auto-cleanup-masukkan-saran',
    '15 18 1 * *',
    $$SELECT public.cleanup_old_masukkan_saran();$$
);

-- 5. Portal Nilai Guru Mapel: Tanggal 1 pukul 02:20 WITA (18:20 UTC)
SELECT cron.schedule(
    'auto-cleanup-guru-mapel-grades',
    '20 18 1 * *',
    $$SELECT public.cleanup_old_guru_mapel_grades();$$
);

-- 6. Keuangan SPP & Kas Komite: Tanggal 1 pukul 02:25 WITA (18:25 UTC)
SELECT cron.schedule(
    'auto-cleanup-finance-records',
    '25 18 1 * *',
    $$SELECT public.cleanup_old_finance_records();$$
);

-- 7. Suka Duka Guru: Tanggal 1 pukul 02:30 WITA (18:30 UTC)
SELECT cron.schedule(
    'auto-cleanup-sukaduka-records',
    '30 18 1 * *',
    $$SELECT public.cleanup_old_sukaduka_records();$$
);

-- ====================================================================
-- 5. GRANT PERMISSIONS RPC (Bisa dipanggil manual oleh Admin via Supabase Client)
-- ====================================================================
GRANT EXECUTE ON FUNCTION public.cleanup_old_siswa_presensi() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_guru_presensi() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_duta_votes() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_masukkan_saran() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_guru_mapel_grades() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_finance_records() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_sukaduka_records() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_all_expired_simas_data() TO anon, authenticated, service_role;


-- >>> MIGRATION: 202608210001_add_target_and_public_report_fields.sql >>>
-- supabase/migrations/202608210001_add_target_and_public_report_fields.sql
-- Menambahkan kolom target_recipient, reporter_type, dan contact_info ke tabel masukkan_saran

ALTER TABLE masukkan_saran ADD COLUMN IF NOT EXISTS target_recipient TEXT DEFAULT 'all';
ALTER TABLE masukkan_saran ADD COLUMN IF NOT EXISTS reporter_type TEXT DEFAULT 'internal';
ALTER TABLE masukkan_saran ADD COLUMN IF NOT EXISTS contact_info TEXT;

-- Index untuk mempercepat filter berdasarkan tujuan dan status
CREATE INDEX IF NOT EXISTS idx_masukkan_saran_target_recipient ON masukkan_saran (target_recipient);
CREATE INDEX IF NOT EXISTS idx_masukkan_saran_status ON masukkan_saran (status);
CREATE INDEX IF NOT EXISTS idx_masukkan_saran_created_at ON masukkan_saran (created_at DESC);


-- >>> MIGRATION: 202608210002_lockdown_masukkan_saran_select.sql >>>
﻿-- supabase/migrations/202608210002_lockdown_masukkan_saran_select.sql
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


-- >>> MIGRATION: 202608220001_perpustakaan_system.sql >>>
-- =====================================================================
-- MIGRATION: 202608220001_perpustakaan_system.sql
-- MODUL PERPUSTAKAAN SEKOLAH (STANDAR PERPUSTAKAAN NASIONAL RI)
-- =====================================================================

-- 1. TABEL KLASIFIKASI DDC (DEWEY DECIMAL CLASSIFICATION)
CREATE TABLE IF NOT EXISTS lib_kategori_ddc (
    kode VARCHAR(10) PRIMARY KEY,
    nama VARCHAR(255) NOT NULL,
    keterangan TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. TABEL KATALOG DATA BIBLIOGRAFI BUKU
CREATE TABLE IF NOT EXISTS lib_buku (
    id BIGSERIAL PRIMARY KEY,
    judul TEXT NOT NULL,
    pengarang VARCHAR(255) NOT NULL,
    pengarang_tambahan TEXT,
    penerbit VARCHAR(255),
    tahun_terbit INTEGER,
    kota_terbit VARCHAR(100),
    isbn VARCHAR(50),
    issn VARCHAR(50),
    bahasa VARCHAR(50) DEFAULT 'Indonesia',
    kategori_ddc VARCHAR(10) NOT NULL REFERENCES lib_kategori_ddc(kode) ON UPDATE CASCADE,
    call_number_dasar VARCHAR(100) NOT NULL,
    lokasi_rak VARCHAR(100),
    deskripsi_fisik VARCHAR(100),
    subjek TEXT,
    tipe_koleksi VARCHAR(50) DEFAULT 'Sirkulasi',
    total_eksemplar INTEGER DEFAULT 0,
    eksemplar_tersedia INTEGER DEFAULT 0,
    cover_url TEXT,
    catatan TEXT,
    created_by VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. TABEL EKSEMPLAR FISIK BUKU
CREATE TABLE IF NOT EXISTS lib_eksemplar (
    id BIGSERIAL PRIMARY KEY,
    buku_id BIGINT NOT NULL REFERENCES lib_buku(id) ON DELETE CASCADE,
    nomor_induk VARCHAR(50) NOT NULL UNIQUE,
    kode_barcode VARCHAR(50) NOT NULL UNIQUE,
    copy_number INTEGER NOT NULL DEFAULT 1,
    call_number_lengkap VARCHAR(120) NOT NULL,
    kondisi VARCHAR(30) DEFAULT 'baik',
    status VARCHAR(30) DEFAULT 'tersedia',
    sumber_pengadaan VARCHAR(100) DEFAULT 'BOS',
    tgl_pengadaan DATE DEFAULT CURRENT_DATE,
    harga NUMERIC(12,2) DEFAULT 0,
    lokasi_spesifik VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. TABEL SIRKULASI PEMINJAMAN & PENGEMBALIAN
CREATE TABLE IF NOT EXISTS lib_sirkulasi (
    id BIGSERIAL PRIMARY KEY,
    kode_transaksi VARCHAR(50) NOT NULL UNIQUE,
    eksemplar_id BIGINT NOT NULL REFERENCES lib_eksemplar(id) ON DELETE CASCADE,
    buku_id BIGINT NOT NULL REFERENCES lib_buku(id) ON DELETE CASCADE,
    peminjam_type VARCHAR(20) NOT NULL,
    peminjam_id VARCHAR(50) NOT NULL,
    peminjam_nama VARCHAR(255) NOT NULL,
    peminjam_kelas VARCHAR(50),
    tgl_pinjam DATE NOT NULL DEFAULT CURRENT_DATE,
    tgl_jatuh_tempo DATE NOT NULL,
    tgl_kembali DATE,
    perpanjangan_ke INTEGER DEFAULT 0,
    status VARCHAR(30) DEFAULT 'dipinjam',
    hari_terlambat INTEGER DEFAULT 0,
    tarif_denda_per_hari NUMERIC(10,2) DEFAULT 1000,
    total_denda NUMERIC(12,2) DEFAULT 0,
    status_denda VARCHAR(30) DEFAULT 'bebas_denda',
    catatan_kembali TEXT,
    kondisi_kembali VARCHAR(30) DEFAULT 'baik',
    petugas_pinjam_uid VARCHAR(100),
    petugas_kembali_uid VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. TABEL PENGUNJUNG / BUKU TAMU DIGITAL
CREATE TABLE IF NOT EXISTS lib_pengunjung (
    id BIGSERIAL PRIMARY KEY,
    tanggal DATE NOT NULL DEFAULT CURRENT_DATE,
    waktu TIME NOT NULL DEFAULT CURRENT_TIME,
    tipe_pengunjung VARCHAR(20) NOT NULL,
    identitas_id VARCHAR(50),
    nama VARCHAR(255) NOT NULL,
    kelas_jabatan VARCHAR(100),
    keperluan VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. TABEL BEBAS PUSTAKA (SURAT KETERANGAN BEBAS PERPUSTAKAAN)
CREATE TABLE IF NOT EXISTS lib_bebas_pustaka (
    id BIGSERIAL PRIMARY KEY,
    no_surat VARCHAR(100) NOT NULL UNIQUE,
    student_nis VARCHAR(50) NOT NULL,
    student_name VARCHAR(255) NOT NULL,
    student_class VARCHAR(50) NOT NULL,
    tahun_ajaran VARCHAR(50) NOT NULL,
    keperluan VARCHAR(100) DEFAULT 'Pengambilan Ijazah / Kelulusan',
    tgl_terbit DATE NOT NULL DEFAULT CURRENT_DATE,
    status_verifikasi VARCHAR(30) DEFAULT 'disetujui',
    catatan TEXT,
    petugas_nama VARCHAR(255),
    petugas_uid VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. TABEL PENGATURAN OPERASIONAL PERPUSTAKAAN
CREATE TABLE IF NOT EXISTS lib_config (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    keterangan TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================================
-- INDEXING (OPTIMASI PERFORMA & QUERY CEPAT)
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_lib_buku_ddc ON lib_buku(kategori_ddc);
CREATE INDEX IF NOT EXISTS idx_lib_buku_judul ON lib_buku(judul);
CREATE INDEX IF NOT EXISTS idx_lib_buku_pengarang ON lib_buku(pengarang);
CREATE INDEX IF NOT EXISTS idx_lib_eksemplar_buku ON lib_eksemplar(buku_id);
CREATE INDEX IF NOT EXISTS idx_lib_eksemplar_barcode ON lib_eksemplar(kode_barcode);
CREATE INDEX IF NOT EXISTS idx_lib_eksemplar_nomor_induk ON lib_eksemplar(nomor_induk);
CREATE INDEX IF NOT EXISTS idx_lib_eksemplar_status ON lib_eksemplar(status);
CREATE INDEX IF NOT EXISTS idx_lib_sirkulasi_eksemplar ON lib_sirkulasi(eksemplar_id);
CREATE INDEX IF NOT EXISTS idx_lib_sirkulasi_buku ON lib_sirkulasi(buku_id);
CREATE INDEX IF NOT EXISTS idx_lib_sirkulasi_peminjam ON lib_sirkulasi(peminjam_id);
CREATE INDEX IF NOT EXISTS idx_lib_sirkulasi_status ON lib_sirkulasi(status);
CREATE INDEX IF NOT EXISTS idx_lib_sirkulasi_jatuh_tempo ON lib_sirkulasi(tgl_jatuh_tempo);
CREATE INDEX IF NOT EXISTS idx_lib_pengunjung_tanggal ON lib_pengunjung(tanggal);
CREATE INDEX IF NOT EXISTS idx_lib_bebas_pustaka_nis ON lib_bebas_pustaka(student_nis);

-- =====================================================================
-- DATA SEEDING (10 KELAS UTAMA DDC STANDAR PERPUSNAS)
-- =====================================================================
INSERT INTO lib_kategori_ddc (kode, nama, keterangan) VALUES
('000', 'Karya Umum & Komputer', 'Ilmu Perpustakaan, Komputer, Informasi, Jurnalistik & Ensiklopedia'),
('100', 'Filsafat & Psikologi', 'Logika, Etika, Psikologi, & Teori Berpikir'),
('200', 'Agama', 'Pendidikan Agama Islam, Hindu, Kristen, Katolik, Buddha, Konghucu & Teologi'),
('300', 'Ilmu-ilmu Sosial', 'Sosiologi, Politik, Ekonomi, Hukum, Pendidikan, Kebudayaan & Adat Istiadat'),
('400', 'Bahasa', 'Bahasa Indonesia, Bahasa Inggris, Bahasa Daerah Bali, & Linguistik'),
('500', 'Sains Murni & Alam', 'Matematika, Astronomi, Fisika, Kimia, Biologi, Botani, & Zoologi'),
('600', 'Teknologi & Terapan', 'Kedokteran, Rekayasa Teknik, Pertanian, Tata Boga, Manajemen, & Bisnis'),
('700', 'Kesenian & Olahraga', 'Seni Rupa, Seni Musik, Fotografi, Hiburan, Rekreasi, Permainan, & Olahraga'),
('800', 'Kesusastraan / Sastra', 'Sastra Indonesia, Puisi, Prosa, Fiksi, Novel, Drama, & Sastra Asing'),
('900', 'Sejarah & Geografi', 'Geografi, Atlas, Biografi Tokoh, Sejarah Indonesia, & Sejarah Dunia')
ON CONFLICT (kode) DO UPDATE SET 
    nama = EXCLUDED.nama,
    keterangan = EXCLUDED.keterangan;

-- SUB-KLASIFIKASI POPULER SEKOLAH
INSERT INTO lib_kategori_ddc (kode, nama, keterangan) VALUES
('004', 'Ilmu Komputer & TI', 'Pemrograman, Hardware, Jaringan Komputer, & Sistem Informasi'),
('294.5', 'Agama Hindu', 'Kitab Suci Weda, Tatwa, Susila, & Upacara Hindu'),
('297', 'Agama Islam', 'Al-Qur''an, Hadis, Fiqih, Aqidah, & Sejarah Kebudayaan Islam'),
('410', 'Bahasa Indonesia', 'Tata Bahasa, EYD, Kosakata, & Kemahiran Berbahasa Indonesia'),
('420', 'Bahasa Inggris', 'Grammar, Vocabulary, Reading, & Conversation Bahasa Inggris'),
('510', 'Matematika', 'Aljabar, Geometri, Trigonometri, Kalkulus, & Statistika'),
('530', 'Fisika', 'Mekanika, Listrik, Magnet, Termodinamika, & Fisika Modern'),
('540', 'Kimia', 'Struktur Atom, Ikatan Kimia, Stoikiometri, & Reaksi Kimia'),
('570', 'Biologi', 'Sel, Genetika, Ekologi, Evolusi, & Keanekaragaman Hayati'),
('813', 'Fiksi Indonesia', 'Novel, Cerpen, & Cerita Rakyat Nusantara'),
('959.8', 'Sejarah Indonesia', 'Sejarah Kuno, Kolonial, Kemerdekaan, & Reformasi')
ON CONFLICT (kode) DO NOTHING;

-- DEFAULT CONFIGURATION
INSERT INTO lib_config (key, value, keterangan) VALUES
('max_pinjam_siswa', '3', 'Maksimal jumlah eksemplar buku yang boleh dipinjam oleh siswa secara bersamaan'),
('max_pinjam_guru', '5', 'Maksimal jumlah eksemplar buku yang boleh dipinjam oleh guru / staf'),
('durasi_pinjam_siswa_hari', '7', 'Durasi peminjaman standar untuk siswa (hari kalender)'),
('durasi_pinjam_guru_hari', '14', 'Durasi peminjaman standar untuk guru (hari kalender)'),
('max_perpanjangan', '1', 'Batas maksimal perpanjangan masa pinjam per buku'),
('tarif_denda_per_hari', '1000', 'Nominal denda keterlambatan per buku per hari (Rp)'),
('abaikan_hari_libur', 'true', 'Jika true, denda tidak dihitung pada hari Sabtu dan Minggu'),
('prefix_nomor_induk', 'SMG-LIB', 'Awalan kode nomor induk / inventaris otomatis'),
('nama_perpustakaan', 'Perpustakaan Widya Shakti SMAGESA', 'Nama resmi perpustakaan sekolah')
ON CONFLICT (key) DO NOTHING;

-- =====================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =====================================================================
ALTER TABLE lib_kategori_ddc ENABLE ROW LEVEL SECURITY;
ALTER TABLE lib_buku ENABLE ROW LEVEL SECURITY;
ALTER TABLE lib_eksemplar ENABLE ROW LEVEL SECURITY;
ALTER TABLE lib_sirkulasi ENABLE ROW LEVEL SECURITY;
ALTER TABLE lib_pengunjung ENABLE ROW LEVEL SECURITY;
ALTER TABLE lib_bebas_pustaka ENABLE ROW LEVEL SECURITY;
ALTER TABLE lib_config ENABLE ROW LEVEL SECURITY;

-- 1. lib_kategori_ddc: Read All, Write Authenticated/Anon
CREATE POLICY "Allow public read on lib_kategori_ddc" ON lib_kategori_ddc FOR SELECT USING (true);
CREATE POLICY "Allow all modify on lib_kategori_ddc" ON lib_kategori_ddc FOR ALL USING (true) WITH CHECK (true);

-- 2. lib_buku: Read All (OPAC), Write All
CREATE POLICY "Allow public read on lib_buku" ON lib_buku FOR SELECT USING (true);
CREATE POLICY "Allow all modify on lib_buku" ON lib_buku FOR ALL USING (true) WITH CHECK (true);

-- 3. lib_eksemplar: Read All, Write All
CREATE POLICY "Allow public read on lib_eksemplar" ON lib_eksemplar FOR SELECT USING (true);
CREATE POLICY "Allow all modify on lib_eksemplar" ON lib_eksemplar FOR ALL USING (true) WITH CHECK (true);

-- 4. lib_sirkulasi: Read All, Write All
CREATE POLICY "Allow public read on lib_sirkulasi" ON lib_sirkulasi FOR SELECT USING (true);
CREATE POLICY "Allow all modify on lib_sirkulasi" ON lib_sirkulasi FOR ALL USING (true) WITH CHECK (true);

-- 5. lib_pengunjung: Read All, Write All
CREATE POLICY "Allow public read on lib_pengunjung" ON lib_pengunjung FOR SELECT USING (true);
CREATE POLICY "Allow all modify on lib_pengunjung" ON lib_pengunjung FOR ALL USING (true) WITH CHECK (true);

-- 6. lib_bebas_pustaka: Read All, Write All
CREATE POLICY "Allow public read on lib_bebas_pustaka" ON lib_bebas_pustaka FOR SELECT USING (true);
CREATE POLICY "Allow all modify on lib_bebas_pustaka" ON lib_bebas_pustaka FOR ALL USING (true) WITH CHECK (true);

-- 7. lib_config: Read All, Write All
CREATE POLICY "Allow public read on lib_config" ON lib_config FOR SELECT USING (true);
CREATE POLICY "Allow all modify on lib_config" ON lib_config FOR ALL USING (true) WITH CHECK (true);


-- >>> MIGRATION: 202608220002_expand_ddc_master.sql >>>
-- =====================================================================
-- MIGRATION: 202608220002_expand_ddc_master.sql
-- EXPAND MASTER DDC KLASIFIKASI PERPUSTAKAAN (STANDAR PERPUSNAS & SMA)
-- =====================================================================

INSERT INTO lib_kategori_ddc (kode, nama, keterangan) VALUES
-- KELAS 000: KARYA UMUM & KOMPUTER
('005', 'Pemrograman & Data Komputer', 'Bahasa Pemrograman, Struktur Data, Rekayasa Perangkat Lunak & Sistem Operasi'),
('070', 'Media Massa, Jurnalistik & Penerbitan', 'Jurnalistik, Redaksi Berita, Penyiaran, dan Media Massa'),

-- KELAS 100: FILSAFAT & PSIKOLOGI
('150', 'Psikologi Umum', 'Perilaku Manusia, Kepribadian, Emosi, Kesehatan Mental, & Pengembangan Diri'),
('160', 'Logika & Berpikir Kritis', 'Penalaran Logis, Silogisme, Argumen, & Berpikir Kritis'),
('170', 'Etika & Moral', 'Budi Pekerti, Etika Profesi, Nilai Moral, & Karakter'),

-- KELAS 200: AGAMA
('230', 'Agama Kristen & Katolik', 'Alkitab, Teologi Kristen/Katolik, Sakramen, & Sejarah Gereja'),
('294.3', 'Agama Buddha', 'Tripitaka, Dharma Buddha, Meditasi, & Ajaran Sang Buddha'),
('299.5', 'Agama Konghucu', 'Sishu Wujing, Ajaran Konfusianisme, & Kebajikan'),

-- KELAS 300: ILMU-ILMU SOSIAL
('301', 'Sosiologi & Antropologi', 'Struktur Sosial, Konflik, Interaksi Masyarakat, & Etnografi'),
('320', 'Ilmu Politik & PKn', 'Pendidikan Pancasila, Kewarganegaraan, Konstitusi, Demokrasi, & Hubungan Internasional'),
('330', 'Ilmu Ekonomi & Bisnis', 'Ekonomi Mikro, Makro, Pasar, Perbankan, Pajak, Koperasi, & Kebijakan Fiskal'),
('340', 'Ilmu Hukum', 'Hukum Perdata, Pidana, Tata Negara, Pengadilan, & Hak Asasi Manusia'),
('370', 'Pendidikan & Pembelajaran', 'Pedagogi, Kurikulum, Metode Pembelajaran, Evaluasi Pendidikan, & BK'),
('390', 'Adat Istiadat, Budaya & Tradisi', 'Tradisi Nusantara, Budaya Bali, Upacara Adat, & Folklor'),

-- KELAS 400: BAHASA & LINGUISTIK
('499.22', 'Bahasa Daerah Bali & Nusantara', 'Bahasa Bali, Aksara Bali, Anggah-Ungguh Basa, Sastra Daerah'),
('492.7', 'Bahasa Arab', 'Tata Bahasa Arab, Nahwu, Shorof, & Percakapan'),
('495.6', 'Bahasa Jepang', 'Hiragana, Katakana, Kanji, Bunpou, & Percakapan Jepang'),

-- KELAS 500: SAINS MURNI & ALAM
('512', 'Aljabar (Algebra)', 'Aljabar Linear, Matriks, Vektor, Sistem Persamaan Linear, Polinomial'),
('513', 'Aritmetika & Teori Bilangan', 'Operasi Hitung, Teori Bilangan, Aritmetika Sosial, Bilangan Prima'),
('514', 'Topologi', 'Topologi Ruang Metrik, Kontinuitas, Himpunan Terbuka & Tertutup'),
('515', 'Analisis (Kalkulus & Diferensial)', 'Kalkulus, Limit, Turunan, Integral, Persamaan Diferensial, Deret'),
('516', 'Geometri & Trigonometri', 'Geometri Bidang, Bangun Ruang, Dimensi Tiga, Trigonometri, Transformasi'),
('518', 'Analisis Numerik & Komputasi', 'Metode Numerik, Komputasi Matematika, Interpolasi, Algoritma Numerik'),
('519', 'Probabilitas & Statistika', 'Statistika, Peluang, Kombinatorika, Distribusi Probabilitas, Analisis Data'),
('520', 'Astronomi & Tata Surya', 'Tata Surya, Bintang, Galaksi, Kosmologi, Teleskop, Bumi & Antariksa'),
('531', 'Mekanika Klasik', 'Kinematika, Dinamika Gerak, Hukum Newton, Fluida, Elastisitas'),
('537', 'Kelistrikan & Magnetisme', 'Listrik Statis, Arus Listrik, Elektromagnetik, Rangkaian RLC'),
('541', 'Kimia Fisik & Teoretis', 'Termokimia, Kinetika Reaksi, Elektrokimia, Kesetimbangan Kimia'),
('547', 'Kimia Organik', 'Senyawa Karbon, Hidrokarbon, Polimer, Gugus Fungsi, Biokimia'),
('576', 'Genetika & Biologi Molekuler', 'DNA, RNA, Sintesis Protein, Hukum Mendel, Rekayasa Genetika'),
('577', 'Ekologi & Lingkungan Hidup', 'Ekosistem, Rantai Makanan, Konservasi Alam, Adiwiyata, Pencemaran'),

-- KELAS 600: TEKNOLOGI & TERAPAN
('610', 'Kedokteran & Ilmu Kesehatan', 'Anatomi Manusia, Gizi, Farmasi, P3K, Pola Hidup Sehat'),
('620', 'Teknik & Rekayasa', 'Teknik Mesin, Elektro, Robotika, Elektronika, Arduino, Mekatronika'),
('630', 'Pertanian & Agroteknologi', 'Bercocok Tanam, Hidroponik, Tanaman Hias, Agribisnis, Peternakan'),
('640', 'Tata Boga & Kesejahteraan Keluarga', 'Kuliner, Resep Masakan, Tata Busana, Gizi Keluarga, Prakarya'),
('650', 'Manajemen, Akuntansi & Bisnis', 'Akuntansi, Jurnal Pembukuan, Manajemen Bisnis, Pemasaran, PKWU'),

-- KELAS 700: KESENIAN & OLAHRAGA
('740', 'Seni Rupa, Desain & Gambar', 'Desain Grafis, DKV, Menggambar, Seni Lukis, Kriya, Prakarya, Batik'),
('780', 'Seni Musik', 'Notasi Musik, Harmoni, Paduan Suara, Alat Musik, Seni Tari Tradisional Bali'),
('796', 'Olahraga & Pendidikan Jasmani (PJOK)', 'Sepak Bola, Voli, Basket, Bulu Tangkis, Atletik, Pencak Silat, Kebugaran'),

-- KELAS 800: KESUSASTRAAN / SASTRA
('810', 'Sastra Indonesia', 'Puisi, Pantun, Cerpen, Naskah Drama, Apresiasi Sastra Indonesia'),
('820', 'Sastra Asing (Inggris & Terjemahan)', 'Sastra Dunia, English Classic Literature, Novel Terjemahan'),

-- KELAS 900: SEJARAH & GEOGRAFI
('909', 'Sejarah Dunia & Peradaban', 'Peradaban Kuno, Revolusi Industri, Perang Dunia, Sejarah Global'),
('910', 'Geografi & Peta', 'Peta, Atlas, SIG, Atmosfer, Litosfer, Kependudukan, Wilayah Tata Ruang'),
('920', 'Biografi & Otobiografi Tokoh', 'Riwayat Hidup Tokoh Pahlawan, Presiden, Ilmuwan, & Tokoh Inspiratif')
ON CONFLICT (kode) DO UPDATE SET
    nama = EXCLUDED.nama,
    keterangan = EXCLUDED.keterangan;


-- >>> MIGRATION: 202608230001_harden_bebas_pustaka.sql >>>
-- Harden status bebas pustaka: semua akses kini melalui secure-proxy yang
-- memverifikasi Firebase ID token dan role pengguna. Service role tetap bypass RLS.

DROP POLICY IF EXISTS "Allow public read on lib_bebas_pustaka" ON lib_bebas_pustaka;
DROP POLICY IF EXISTS "Allow all modify on lib_bebas_pustaka" ON lib_bebas_pustaka;

-- student_nis merepresentasikan satu status aktif. Bersihkan duplikat lama
-- secara deterministik (pertahankan record terbaru) sebelum membuat constraint.
WITH ranked_clearances AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY student_nis
      ORDER BY created_at DESC NULLS LAST, id DESC
    ) AS row_number
  FROM lib_bebas_pustaka
)
DELETE FROM lib_bebas_pustaka AS clearance
USING ranked_clearances AS ranked
WHERE clearance.id = ranked.id
  AND ranked.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_lib_bebas_pustaka_student_nis
  ON lib_bebas_pustaka(student_nis);

-- Status lama yang sudah bertentangan dengan data sirkulasi tidak boleh tetap
-- dianggap sah oleh portal. Penerbitan ulang dapat dilakukan setelah tanggungan
-- diselesaikan.
DELETE FROM lib_bebas_pustaka AS clearance
WHERE EXISTS (
  SELECT 1
  FROM lib_sirkulasi AS circulation
  WHERE circulation.peminjam_id = clearance.student_nis
    AND (
      LOWER(COALESCE(circulation.status, '')) = 'dipinjam'
      OR LOWER(COALESCE(circulation.status_denda, '')) = 'belum_lunas'
    )
);

-- Kunci advisory yang sama dipakai oleh kedua tabel agar penerbitan clearance
-- dan perubahan sirkulasi untuk satu NIS tidak lolos bersamaan (TOCTOU/race).
CREATE OR REPLACE FUNCTION enforce_clearance_has_no_library_burden()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.student_nis, 0));

  IF EXISTS (
    SELECT 1
    FROM lib_sirkulasi AS circulation
    WHERE circulation.peminjam_id = NEW.student_nis
      AND (
        LOWER(COALESCE(circulation.status, '')) = 'dipinjam'
        OR LOWER(COALESCE(circulation.status_denda, '')) = 'belum_lunas'
      )
  ) THEN
    RAISE EXCEPTION 'Siswa % masih memiliki pinjaman aktif atau denda belum lunas', NEW.student_nis
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_clearance_has_no_burden ON lib_bebas_pustaka;
CREATE TRIGGER trg_enforce_clearance_has_no_burden
BEFORE INSERT OR UPDATE OF student_nis, status_verifikasi
ON lib_bebas_pustaka
FOR EACH ROW
EXECUTE FUNCTION enforce_clearance_has_no_library_burden();

CREATE OR REPLACE FUNCTION prevent_library_burden_after_clearance()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.peminjam_id, 0));

  IF (
    LOWER(COALESCE(NEW.status, '')) = 'dipinjam'
    OR LOWER(COALESCE(NEW.status_denda, '')) = 'belum_lunas'
  ) AND EXISTS (
    SELECT 1
    FROM lib_bebas_pustaka AS clearance
    WHERE clearance.student_nis = NEW.peminjam_id
      AND LOWER(COALESCE(clearance.status_verifikasi, 'disetujui')) = 'disetujui'
  ) THEN
    RAISE EXCEPTION 'Status bebas pustaka siswa % harus dicabut sebelum membuat tanggungan baru', NEW.peminjam_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_burden_after_clearance ON lib_sirkulasi;
CREATE TRIGGER trg_prevent_burden_after_clearance
BEFORE INSERT OR UPDATE OF peminjam_id, status, status_denda
ON lib_sirkulasi
FOR EACH ROW
EXECUTE FUNCTION prevent_library_burden_after_clearance();


-- >>> MIGRATION: 202608230002_lockdown_sensitive_rest_tables.sql >>>
-- =====================================================================
-- LOCKDOWN GLOBAL SUPABASE POSTGREST
-- Jalankan HANYA setelah secure-proxy dan adapter hosting versi ini aktif.
-- Semua tabel sensitif tidak lagi memiliki policy anon/authenticated;
-- secure-proxy memakai service_role setelah memverifikasi Firebase JWT + role.
-- =====================================================================

DO $$
DECLARE
  target_table TEXT;
  existing_policy RECORD;
  protected_tables TEXT[] := ARRAY[
    'duta_kandidat',
    'duta_suara_masuk',
    'finance_cashflow',
    'finance_closings',
    'finance_daily_summary',
    'finance_transactions',
    'guru_mapel_components',
    'guru_mapel_gradebooks',
    'guru_mapel_scores',
    'guru_mapel_summaries',
    'guru_presensi',
    'lib_bebas_pustaka',
    'lib_buku',
    'lib_config',
    'lib_eksemplar',
    'lib_kategori_ddc',
    'lib_pengunjung',
    'lib_sirkulasi',
    'masukkan_saran',
    'siswa_presensi',
    'siswa_presensi_harian',
    'sukaduka_config',
    'sukaduka_iuran',
    'sukaduka_kas'
  ];
BEGIN
  FOREACH target_table IN ARRAY protected_tables LOOP
    IF to_regclass(format('public.%I', target_table)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target_table);

    FOR existing_policy IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = target_table
    LOOP
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON public.%I',
        existing_policy.policyname,
        target_table
      );
    END LOOP;
  END LOOP;
END
$$;

-- Hanya data katalog/non-sensitif berikut yang memang dibutuhkan halaman
-- publik tanpa sesi Firebase. Tidak ada public-write policy yang dibuat.
CREATE POLICY "Secure public read duta candidates"
  ON public.duta_kandidat FOR SELECT USING (true);

CREATE POLICY "Secure public read library books"
  ON public.lib_buku FOR SELECT USING (true);

CREATE POLICY "Secure public read library config"
  ON public.lib_config FOR SELECT USING (true);

CREATE POLICY "Secure public read library copies"
  ON public.lib_eksemplar FOR SELECT USING (true);

CREATE POLICY "Secure public read library DDC"
  ON public.lib_kategori_ddc FOR SELECT USING (true);

COMMENT ON POLICY "Secure public read duta candidates" ON public.duta_kandidat
  IS 'Kandidat bersifat publik; semua operasi tulis wajib melalui secure-proxy.';
COMMENT ON POLICY "Secure public read library books" ON public.lib_buku
  IS 'Metadata OPAC bersifat publik; semua operasi tulis wajib melalui secure-proxy.';

-- Fungsi retensi menggunakan SECURITY DEFINER dan sebelumnya dapat dipanggil
-- oleh anon. Itu memungkinkan siapa pun memicu penghapusan arsip sebelum jadwal
-- pg_cron. Jadwal berjalan sebagai pemilik fungsi dan tidak memerlukan grant ini.
REVOKE ALL ON FUNCTION public.cleanup_old_siswa_presensi() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_old_guru_presensi() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_old_duta_votes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_old_masukkan_saran() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_old_guru_mapel_grades() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_old_finance_records() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_old_sukaduka_records() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_all_expired_simas_data() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.cleanup_old_siswa_presensi() TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_guru_presensi() TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_duta_votes() TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_masukkan_saran() TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_guru_mapel_grades() TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_finance_records() TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_sukaduka_records() TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_all_expired_simas_data() TO service_role;


-- >>> MIGRATION: 202608240001_library_circulation_hardening.sql >>>
-- =====================================================================
-- HARDENING MODUL PERPUSTAKAAN
-- - transaksi sirkulasi atomik
-- - riwayat tidak terhapus lewat cascade
-- - stok diturunkan dari eksemplar melalui trigger
-- - constraint integritas dan katalog publik terbatas
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.lib_hari_libur (
  tanggal DATE PRIMARY KEY,
  nama VARCHAR(150) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.lib_hari_libur ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.lib_buku
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by VARCHAR(100);

ALTER TABLE public.lib_eksemplar
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by VARCHAR(100);

ALTER TABLE public.lib_sirkulasi
  ADD COLUMN IF NOT EXISTS denda_lunas_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS denda_lunas_by VARCHAR(100);

-- Riwayat transaksi adalah data audit. Judul/eksemplar yang pernah dipakai
-- tidak boleh menghapus transaksi secara tidak sengaja.
ALTER TABLE public.lib_eksemplar
  DROP CONSTRAINT IF EXISTS lib_eksemplar_buku_id_fkey,
  ADD CONSTRAINT lib_eksemplar_buku_id_fkey
    FOREIGN KEY (buku_id) REFERENCES public.lib_buku(id) ON DELETE RESTRICT;

ALTER TABLE public.lib_sirkulasi
  DROP CONSTRAINT IF EXISTS lib_sirkulasi_eksemplar_id_fkey,
  DROP CONSTRAINT IF EXISTS lib_sirkulasi_buku_id_fkey,
  ADD CONSTRAINT lib_sirkulasi_eksemplar_id_fkey
    FOREIGN KEY (eksemplar_id) REFERENCES public.lib_eksemplar(id) ON DELETE RESTRICT,
  ADD CONSTRAINT lib_sirkulasi_buku_id_fkey
    FOREIGN KEY (buku_id) REFERENCES public.lib_buku(id) ON DELETE RESTRICT;

-- NOT VALID menjaga migrasi tetap aman terhadap data historis lama, tetapi
-- constraint langsung berlaku untuk insert/update baru.
ALTER TABLE public.lib_buku
  DROP CONSTRAINT IF EXISTS chk_lib_buku_stock_nonnegative,
  DROP CONSTRAINT IF EXISTS chk_lib_buku_available_not_above_total,
  DROP CONSTRAINT IF EXISTS chk_lib_buku_year,
  ADD CONSTRAINT chk_lib_buku_stock_nonnegative
    CHECK (total_eksemplar >= 0 AND eksemplar_tersedia >= 0) NOT VALID,
  ADD CONSTRAINT chk_lib_buku_available_not_above_total
    CHECK (eksemplar_tersedia <= total_eksemplar) NOT VALID,
  ADD CONSTRAINT chk_lib_buku_year
    CHECK (tahun_terbit IS NULL OR tahun_terbit BETWEEN 1000 AND 2200) NOT VALID;

ALTER TABLE public.lib_eksemplar
  DROP CONSTRAINT IF EXISTS chk_lib_eksemplar_copy_number,
  DROP CONSTRAINT IF EXISTS chk_lib_eksemplar_price,
  DROP CONSTRAINT IF EXISTS chk_lib_eksemplar_status,
  DROP CONSTRAINT IF EXISTS chk_lib_eksemplar_condition,
  ADD CONSTRAINT chk_lib_eksemplar_copy_number
    CHECK (copy_number > 0) NOT VALID,
  ADD CONSTRAINT chk_lib_eksemplar_price
    CHECK (harga >= 0) NOT VALID,
  ADD CONSTRAINT chk_lib_eksemplar_status
    CHECK (status IN ('tersedia', 'dipinjam', 'rusak_berat', 'hilang')) NOT VALID,
  ADD CONSTRAINT chk_lib_eksemplar_condition
    CHECK (kondisi IN ('baik', 'rusak_ringan', 'rusak_berat', 'hilang')) NOT VALID;

ALTER TABLE public.lib_sirkulasi
  DROP CONSTRAINT IF EXISTS chk_lib_sirkulasi_type,
  DROP CONSTRAINT IF EXISTS chk_lib_sirkulasi_status,
  DROP CONSTRAINT IF EXISTS chk_lib_sirkulasi_fine_status,
  DROP CONSTRAINT IF EXISTS chk_lib_sirkulasi_dates,
  DROP CONSTRAINT IF EXISTS chk_lib_sirkulasi_nonnegative,
  ADD CONSTRAINT chk_lib_sirkulasi_type
    CHECK (peminjam_type IN ('siswa', 'guru')) NOT VALID,
  ADD CONSTRAINT chk_lib_sirkulasi_status
    CHECK (status IN ('dipinjam', 'kembali')) NOT VALID,
  ADD CONSTRAINT chk_lib_sirkulasi_fine_status
    CHECK (status_denda IN ('bebas_denda', 'belum_lunas', 'lunas')) NOT VALID,
  ADD CONSTRAINT chk_lib_sirkulasi_dates
    CHECK (
      tgl_jatuh_tempo >= tgl_pinjam
      AND (tgl_kembali IS NULL OR tgl_kembali >= tgl_pinjam)
    ) NOT VALID,
  ADD CONSTRAINT chk_lib_sirkulasi_nonnegative
    CHECK (
      perpanjangan_ke >= 0
      AND hari_terlambat >= 0
      AND tarif_denda_per_hari >= 0
      AND total_denda >= 0
    ) NOT VALID;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.lib_sirkulasi
    WHERE status = 'dipinjam'
    GROUP BY eksemplar_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Migrasi perpustakaan dihentikan: terdapat eksemplar dengan lebih dari satu pinjaman aktif. Selesaikan duplikat sebelum menjalankan ulang.';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_lib_sirkulasi_one_active_copy
  ON public.lib_sirkulasi(eksemplar_id)
  WHERE status = 'dipinjam';

CREATE UNIQUE INDEX IF NOT EXISTS uq_lib_eksemplar_active_copy_number
  ON public.lib_eksemplar(buku_id, copy_number)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_lib_buku_active
  ON public.lib_buku(id) WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_lib_eksemplar_active_book
  ON public.lib_eksemplar(buku_id, status) WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_lib_sirkulasi_active_borrower
  ON public.lib_sirkulasi(peminjam_type, peminjam_id, tgl_jatuh_tempo)
  WHERE status = 'dipinjam';

CREATE OR REPLACE FUNCTION public.refresh_lib_buku_stock(p_buku_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_buku_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.lib_buku AS book
  SET
    total_eksemplar = stock.total_count,
    eksemplar_tersedia = stock.available_count,
    updated_at = NOW()
  FROM (
    SELECT
      COUNT(*)::INTEGER AS total_count,
      COUNT(*) FILTER (WHERE status = 'tersedia')::INTEGER AS available_count
    FROM public.lib_eksemplar
    WHERE buku_id = p_buku_id
      AND archived_at IS NULL
  ) AS stock
  WHERE book.id = p_buku_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_refresh_lib_buku_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_lib_buku_stock(OLD.buku_id);
    RETURN OLD;
  END IF;

  PERFORM public.refresh_lib_buku_stock(NEW.buku_id);
  IF TG_OP = 'UPDATE' AND OLD.buku_id IS DISTINCT FROM NEW.buku_id THEN
    PERFORM public.refresh_lib_buku_stock(OLD.buku_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lib_eksemplar_refresh_stock ON public.lib_eksemplar;
CREATE TRIGGER trg_lib_eksemplar_refresh_stock
AFTER INSERT OR DELETE OR UPDATE OF buku_id, status, archived_at
ON public.lib_eksemplar
FOR EACH ROW
EXECUTE FUNCTION public.trg_refresh_lib_buku_stock();

DO $$
DECLARE
  target_book RECORD;
BEGIN
  FOR target_book IN SELECT id FROM public.lib_buku LOOP
    PERFORM public.refresh_lib_buku_stock(target_book.id);
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.lib_count_chargeable_days(
  p_start_exclusive DATE,
  p_end_inclusive DATE,
  p_ignore_holidays BOOLEAN
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_start_exclusive IS NULL
      OR p_end_inclusive IS NULL
      OR p_end_inclusive <= p_start_exclusive THEN 0
    ELSE COUNT(*)::INTEGER
  END
  FROM generate_series(
    p_start_exclusive + 1,
    GREATEST(p_start_exclusive, p_end_inclusive),
    INTERVAL '1 day'
  ) AS day_value
  WHERE NOT p_ignore_holidays
     OR (
       EXTRACT(ISODOW FROM day_value) BETWEEN 1 AND 5
       AND NOT EXISTS (
         SELECT 1
         FROM public.lib_hari_libur holiday
         WHERE holiday.tanggal = day_value::DATE
       )
     );
$$;

CREATE OR REPLACE FUNCTION public.lib_add_loan_days(
  p_start_date DATE,
  p_days INTEGER,
  p_ignore_holidays BOOLEAN
)
RETURNS DATE
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  result_date DATE := p_start_date;
  added_days INTEGER := 0;
BEGIN
  IF p_start_date IS NULL OR p_days IS NULL OR p_days < 1 THEN
    RAISE EXCEPTION 'Tanggal awal dan jumlah hari pinjam harus valid' USING ERRCODE = '22023';
  END IF;

  WHILE added_days < p_days LOOP
    result_date := result_date + 1;
    IF NOT p_ignore_holidays OR (
      EXTRACT(ISODOW FROM result_date) BETWEEN 1 AND 5
      AND NOT EXISTS (
        SELECT 1 FROM public.lib_hari_libur holiday WHERE holiday.tanggal = result_date
      )
    ) THEN
      added_days := added_days + 1;
    END IF;
  END LOOP;

  RETURN result_date;
END;
$$;

CREATE OR REPLACE FUNCTION public.lib_borrow_copy(
  p_eksemplar_id BIGINT,
  p_peminjam_type TEXT,
  p_peminjam_id TEXT,
  p_peminjam_nama TEXT,
  p_peminjam_kelas TEXT,
  p_tgl_pinjam DATE,
  p_tgl_jatuh_tempo DATE,
  p_petugas_uid TEXT
)
RETURNS public.lib_sirkulasi
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  selected_copy public.lib_eksemplar%ROWTYPE;
  selected_book public.lib_buku%ROWTYPE;
  active_count INTEGER;
  max_quota INTEGER;
  fine_rate NUMERIC(10, 2);
  transaction_code TEXT;
  local_today DATE := (NOW() AT TIME ZONE 'Asia/Singapore')::DATE;
  result_row public.lib_sirkulasi%ROWTYPE;
BEGIN
  p_peminjam_type := LOWER(TRIM(COALESCE(p_peminjam_type, '')));
  p_peminjam_id := TRIM(COALESCE(p_peminjam_id, ''));
  p_peminjam_nama := TRIM(COALESCE(p_peminjam_nama, ''));

  IF p_peminjam_type NOT IN ('siswa', 'guru')
    OR p_peminjam_id = ''
    OR p_peminjam_nama = '' THEN
    RAISE EXCEPTION 'Identitas peminjam tidak valid' USING ERRCODE = '22023';
  END IF;

  IF p_tgl_pinjam IS NULL OR p_tgl_jatuh_tempo IS NULL OR p_tgl_jatuh_tempo < p_tgl_pinjam THEN
    RAISE EXCEPTION 'Tanggal peminjaman atau jatuh tempo tidak valid' USING ERRCODE = '22007';
  END IF;

  -- Serialisasi seluruh peminjaman untuk peminjam yang sama agar kuota tidak
  -- dapat ditembus oleh dua perangkat secara bersamaan.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_peminjam_type || ':' || p_peminjam_id, 0));

  SELECT * INTO selected_copy
  FROM public.lib_eksemplar
  WHERE id = p_eksemplar_id
  FOR UPDATE;

  IF NOT FOUND OR selected_copy.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Eksemplar tidak ditemukan atau sudah diarsipkan' USING ERRCODE = 'P0002';
  END IF;

  IF selected_copy.status <> 'tersedia' THEN
    RAISE EXCEPTION 'Eksemplar tidak tersedia untuk dipinjam' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO selected_book
  FROM public.lib_buku
  WHERE id = selected_copy.buku_id
  FOR SHARE;

  IF NOT FOUND OR selected_book.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Judul buku sudah diarsipkan' USING ERRCODE = 'P0001';
  END IF;

  IF LOWER(COALESCE(selected_book.tipe_koleksi, 'sirkulasi')) <> 'sirkulasi' THEN
    RAISE EXCEPTION 'Tipe koleksi ini hanya dapat dibaca di perpustakaan' USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*)::INTEGER INTO active_count
  FROM public.lib_sirkulasi
  WHERE peminjam_type = p_peminjam_type
    AND peminjam_id = p_peminjam_id
    AND status = 'dipinjam';

  SELECT CASE
    WHEN value ~ '^\d+$' THEN value::INTEGER
    ELSE CASE WHEN p_peminjam_type = 'siswa' THEN 3 ELSE 5 END
  END
  INTO max_quota
  FROM public.lib_config
  WHERE key = CASE WHEN p_peminjam_type = 'siswa' THEN 'max_pinjam_siswa' ELSE 'max_pinjam_guru' END;

  max_quota := COALESCE(max_quota, CASE WHEN p_peminjam_type = 'siswa' THEN 3 ELSE 5 END);

  IF active_count >= max_quota THEN
    RAISE EXCEPTION 'Batas maksimal peminjaman (% buku) telah tercapai', max_quota USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.lib_sirkulasi
    WHERE peminjam_type = p_peminjam_type
      AND peminjam_id = p_peminjam_id
      AND status = 'dipinjam'
      AND tgl_jatuh_tempo < local_today
  ) THEN
    RAISE EXCEPTION 'Peminjam memiliki buku terlambat yang harus diselesaikan terlebih dahulu' USING ERRCODE = 'P0001';
  END IF;

  SELECT CASE WHEN value ~ '^\d+(\.\d+)?$' THEN value::NUMERIC ELSE 1000 END
  INTO fine_rate
  FROM public.lib_config
  WHERE key = 'tarif_denda_per_hari';
  fine_rate := COALESCE(fine_rate, 1000);

  transaction_code := 'PINJ-' || TO_CHAR(p_tgl_pinjam, 'YYYYMMDD') || '-'
    || UPPER(SUBSTRING(MD5(CLOCK_TIMESTAMP()::TEXT || RANDOM()::TEXT || p_eksemplar_id::TEXT), 1, 12));

  INSERT INTO public.lib_sirkulasi (
    kode_transaksi, eksemplar_id, buku_id,
    peminjam_type, peminjam_id, peminjam_nama, peminjam_kelas,
    tgl_pinjam, tgl_jatuh_tempo, status,
    tarif_denda_per_hari, petugas_pinjam_uid
  ) VALUES (
    transaction_code, selected_copy.id, selected_copy.buku_id,
    p_peminjam_type, p_peminjam_id, p_peminjam_nama, NULLIF(TRIM(p_peminjam_kelas), ''),
    p_tgl_pinjam, p_tgl_jatuh_tempo, 'dipinjam',
    fine_rate, NULLIF(TRIM(p_petugas_uid), '')
  )
  RETURNING * INTO result_row;

  UPDATE public.lib_eksemplar
  SET status = 'dipinjam', updated_at = NOW()
  WHERE id = selected_copy.id;

  RETURN result_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.lib_return_copy(
  p_sirkulasi_id BIGINT,
  p_tgl_kembali DATE,
  p_kondisi TEXT,
  p_petugas_uid TEXT
)
RETURNS public.lib_sirkulasi
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  circulation public.lib_sirkulasi%ROWTYPE;
  ignore_holidays BOOLEAN;
  late_days INTEGER;
  total_fine NUMERIC(12, 2);
  copy_status TEXT;
  local_today DATE := (NOW() AT TIME ZONE 'Asia/Singapore')::DATE;
  result_row public.lib_sirkulasi%ROWTYPE;
BEGIN
  p_kondisi := LOWER(TRIM(COALESCE(p_kondisi, 'baik')));
  IF p_kondisi NOT IN ('baik', 'rusak_ringan', 'rusak_berat', 'hilang') THEN
    RAISE EXCEPTION 'Kondisi pengembalian tidak valid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO circulation
  FROM public.lib_sirkulasi
  WHERE id = p_sirkulasi_id
  FOR UPDATE;

  IF NOT FOUND OR circulation.status <> 'dipinjam' THEN
    RAISE EXCEPTION 'Transaksi tidak ditemukan atau buku sudah dikembalikan' USING ERRCODE = 'P0001';
  END IF;

  IF p_tgl_kembali IS NULL OR p_tgl_kembali <> local_today OR p_tgl_kembali < circulation.tgl_pinjam THEN
    RAISE EXCEPTION 'Tanggal pengembalian tidak valid' USING ERRCODE = '22007';
  END IF;

  SELECT COALESCE(value = 'true', TRUE)
  INTO ignore_holidays
  FROM public.lib_config
  WHERE key = 'abaikan_hari_libur';
  ignore_holidays := COALESCE(ignore_holidays, TRUE);

  late_days := public.lib_count_chargeable_days(
    circulation.tgl_jatuh_tempo,
    p_tgl_kembali,
    ignore_holidays
  );
  total_fine := late_days * COALESCE(circulation.tarif_denda_per_hari, 0);
  copy_status := CASE WHEN p_kondisi IN ('rusak_berat', 'hilang') THEN p_kondisi ELSE 'tersedia' END;

  UPDATE public.lib_sirkulasi
  SET
    tgl_kembali = p_tgl_kembali,
    status = 'kembali',
    hari_terlambat = late_days,
    total_denda = total_fine,
    status_denda = CASE WHEN total_fine > 0 THEN 'belum_lunas' ELSE 'bebas_denda' END,
    kondisi_kembali = p_kondisi,
    petugas_kembali_uid = NULLIF(TRIM(p_petugas_uid), ''),
    updated_at = NOW()
  WHERE id = circulation.id
  RETURNING * INTO result_row;

  UPDATE public.lib_eksemplar
  SET status = copy_status, kondisi = p_kondisi, updated_at = NOW()
  WHERE id = circulation.eksemplar_id;

  RETURN result_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.lib_extend_loan(
  p_sirkulasi_id BIGINT,
  p_petugas_uid TEXT
)
RETURNS public.lib_sirkulasi
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  circulation public.lib_sirkulasi%ROWTYPE;
  max_extensions INTEGER;
  duration_days INTEGER;
  ignore_holidays BOOLEAN;
  local_today DATE := (NOW() AT TIME ZONE 'Asia/Singapore')::DATE;
  result_row public.lib_sirkulasi%ROWTYPE;
BEGIN
  SELECT * INTO circulation
  FROM public.lib_sirkulasi
  WHERE id = p_sirkulasi_id
  FOR UPDATE;

  IF NOT FOUND OR circulation.status <> 'dipinjam' THEN
    RAISE EXCEPTION 'Transaksi tidak ditemukan atau sudah selesai' USING ERRCODE = 'P0001';
  END IF;

  IF circulation.tgl_jatuh_tempo < local_today THEN
    RAISE EXCEPTION 'Buku yang sudah terlambat tidak dapat diperpanjang' USING ERRCODE = 'P0001';
  END IF;

  SELECT CASE WHEN value ~ '^\d+$' THEN value::INTEGER ELSE 1 END
  INTO max_extensions FROM public.lib_config WHERE key = 'max_perpanjangan';
  max_extensions := COALESCE(max_extensions, 1);

  IF circulation.perpanjangan_ke >= max_extensions THEN
    RAISE EXCEPTION 'Batas maksimal perpanjangan (% kali) telah tercapai', max_extensions USING ERRCODE = 'P0001';
  END IF;

  SELECT CASE WHEN value ~ '^\d+$' THEN value::INTEGER ELSE 7 END
  INTO duration_days
  FROM public.lib_config
  WHERE key = CASE
    WHEN circulation.peminjam_type = 'siswa' THEN 'durasi_pinjam_siswa_hari'
    ELSE 'durasi_pinjam_guru_hari'
  END;
  duration_days := COALESCE(duration_days, CASE WHEN circulation.peminjam_type = 'siswa' THEN 7 ELSE 14 END);

  SELECT COALESCE(value = 'true', TRUE)
  INTO ignore_holidays FROM public.lib_config WHERE key = 'abaikan_hari_libur';
  ignore_holidays := COALESCE(ignore_holidays, TRUE);

  UPDATE public.lib_sirkulasi
  SET
    tgl_jatuh_tempo = public.lib_add_loan_days(circulation.tgl_jatuh_tempo, duration_days, ignore_holidays),
    perpanjangan_ke = circulation.perpanjangan_ke + 1,
    updated_at = NOW()
  WHERE id = circulation.id
  RETURNING * INTO result_row;

  RETURN result_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.lib_archive_book(
  p_buku_id BIGINT,
  p_petugas_uid TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM 1 FROM public.lib_buku WHERE id = p_buku_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Judul buku tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.lib_sirkulasi
    WHERE buku_id = p_buku_id AND status = 'dipinjam'
  ) THEN
    RAISE EXCEPTION 'Judul masih memiliki eksemplar yang sedang dipinjam' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.lib_eksemplar
  SET archived_at = NOW(), archived_by = NULLIF(TRIM(p_petugas_uid), ''), updated_at = NOW()
  WHERE buku_id = p_buku_id AND archived_at IS NULL;

  UPDATE public.lib_buku
  SET archived_at = NOW(), archived_by = NULLIF(TRIM(p_petugas_uid), ''), updated_at = NOW()
  WHERE id = p_buku_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.lib_archive_copy(
  p_eksemplar_id BIGINT,
  p_petugas_uid TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  copy_row public.lib_eksemplar%ROWTYPE;
BEGIN
  SELECT * INTO copy_row
  FROM public.lib_eksemplar
  WHERE id = p_eksemplar_id
  FOR UPDATE;

  IF NOT FOUND OR copy_row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Eksemplar tidak ditemukan atau sudah diarsipkan' USING ERRCODE = 'P0002';
  END IF;

  IF copy_row.status = 'dipinjam' OR EXISTS (
    SELECT 1 FROM public.lib_sirkulasi
    WHERE eksemplar_id = copy_row.id AND status = 'dipinjam'
  ) THEN
    RAISE EXCEPTION 'Eksemplar sedang dipinjam dan tidak dapat diarsipkan' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.lib_eksemplar
  SET archived_at = NOW(), archived_by = NULLIF(TRIM(p_petugas_uid), ''), updated_at = NOW()
  WHERE id = copy_row.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.lib_settle_fine(
  p_sirkulasi_id BIGINT,
  p_petugas_uid TEXT
)
RETURNS public.lib_sirkulasi
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result_row public.lib_sirkulasi%ROWTYPE;
BEGIN
  UPDATE public.lib_sirkulasi
  SET
    status_denda = 'lunas',
    denda_lunas_at = NOW(),
    denda_lunas_by = NULLIF(TRIM(p_petugas_uid), ''),
    updated_at = NOW()
  WHERE id = p_sirkulasi_id
    AND status = 'kembali'
    AND total_denda > 0
    AND status_denda = 'belum_lunas'
  RETURNING * INTO result_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Denda tidak ditemukan, belum dapat dilunasi, atau sudah lunas' USING ERRCODE = 'P0001';
  END IF;
  RETURN result_row;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_lib_buku_stock(BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lib_borrow_copy(BIGINT, TEXT, TEXT, TEXT, TEXT, DATE, DATE, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lib_return_copy(BIGINT, DATE, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lib_extend_loan(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lib_archive_book(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lib_archive_copy(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lib_settle_fine(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_refresh_lib_buku_stock() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.refresh_lib_buku_stock(BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.lib_borrow_copy(BIGINT, TEXT, TEXT, TEXT, TEXT, DATE, DATE, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.lib_return_copy(BIGINT, DATE, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.lib_extend_loan(BIGINT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.lib_archive_book(BIGINT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.lib_archive_copy(BIGINT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.lib_settle_fine(BIGINT, TEXT) TO service_role;

-- Tabel dasar menyimpan metadata internal. OPAC hanya mendapat view dengan
-- kolom yang memang dibutuhkan pengguna.
DROP POLICY IF EXISTS "Secure public read library books" ON public.lib_buku;
DROP POLICY IF EXISTS "Secure public read library copies" ON public.lib_eksemplar;
DROP POLICY IF EXISTS "Allow public read on lib_buku" ON public.lib_buku;
DROP POLICY IF EXISTS "Allow public read on lib_eksemplar" ON public.lib_eksemplar;
DROP POLICY IF EXISTS "Allow all modify on lib_buku" ON public.lib_buku;
DROP POLICY IF EXISTS "Allow all modify on lib_eksemplar" ON public.lib_eksemplar;
DROP POLICY IF EXISTS "Allow public read on lib_sirkulasi" ON public.lib_sirkulasi;
DROP POLICY IF EXISTS "Allow all modify on lib_sirkulasi" ON public.lib_sirkulasi;
DROP POLICY IF EXISTS "Allow public read on lib_pengunjung" ON public.lib_pengunjung;
DROP POLICY IF EXISTS "Allow all modify on lib_pengunjung" ON public.lib_pengunjung;
DROP POLICY IF EXISTS "Allow public read on lib_bebas_pustaka" ON public.lib_bebas_pustaka;
DROP POLICY IF EXISTS "Allow all modify on lib_bebas_pustaka" ON public.lib_bebas_pustaka;
DROP POLICY IF EXISTS "Allow all modify on lib_config" ON public.lib_config;
DROP POLICY IF EXISTS "Allow all modify on lib_kategori_ddc" ON public.lib_kategori_ddc;

CREATE OR REPLACE VIEW public.lib_opac_buku
WITH (security_barrier = true)
AS
SELECT
  book.id,
  book.judul,
  book.pengarang,
  book.pengarang_tambahan,
  book.penerbit,
  book.tahun_terbit,
  book.kota_terbit,
  book.isbn,
  book.issn,
  book.bahasa,
  book.kategori_ddc,
  ddc.nama AS ddc_nama,
  book.call_number_dasar,
  book.lokasi_rak,
  book.deskripsi_fisik,
  book.subjek,
  book.tipe_koleksi,
  book.total_eksemplar,
  book.eksemplar_tersedia,
  book.cover_url
FROM public.lib_buku book
LEFT JOIN public.lib_kategori_ddc ddc ON ddc.kode = book.kategori_ddc
WHERE book.archived_at IS NULL;

CREATE OR REPLACE VIEW public.lib_opac_eksemplar
WITH (security_barrier = true)
AS
SELECT
  copy.buku_id,
  copy.copy_number,
  copy.call_number_lengkap,
  copy.status,
  copy.kondisi,
  (
    SELECT circulation.tgl_jatuh_tempo
    FROM public.lib_sirkulasi circulation
    WHERE circulation.eksemplar_id = copy.id
      AND circulation.status = 'dipinjam'
    ORDER BY circulation.created_at DESC
    LIMIT 1
  ) AS tgl_jatuh_tempo
FROM public.lib_eksemplar copy
WHERE copy.archived_at IS NULL;

CREATE OR REPLACE VIEW public.lib_opac_hari_libur
WITH (security_barrier = true)
AS
SELECT tanggal
FROM public.lib_hari_libur;

REVOKE ALL ON
  public.lib_buku,
  public.lib_eksemplar,
  public.lib_sirkulasi,
  public.lib_pengunjung,
  public.lib_bebas_pustaka,
  public.lib_hari_libur
FROM anon, authenticated;
GRANT SELECT ON public.lib_opac_buku, public.lib_opac_eksemplar, public.lib_opac_hari_libur TO anon, authenticated;

COMMENT ON VIEW public.lib_opac_buku IS
  'Metadata bibliografi publik tanpa catatan internal, pembuat, atau status arsip.';
COMMENT ON VIEW public.lib_opac_eksemplar IS
  'Status salinan publik tanpa barcode, nomor inventaris, harga, atau sumber pengadaan.';
COMMENT ON VIEW public.lib_opac_hari_libur IS
  'Tanggal libur yang dipakai OPAC untuk menampilkan estimasi denda secara konsisten.';


-- >>> MIGRATION: 202608270001_allow_recent_student_attendance_select.sql >>>
-- =====================================================================
-- IZINKAN BACA PRESENSI SISWA TERBARU (HARI INI & KEMARIN)
-- Digunakan oleh aplikasi Jurnal Mengajar untuk auto pre-fill kehadiran kelas
-- =====================================================================

CREATE POLICY "Secure public read recent siswa_presensi"
  ON public.siswa_presensi FOR SELECT
  USING (tanggal >= CURRENT_DATE - INTERVAL '2 days');

COMMENT ON POLICY "Secure public read recent siswa_presensi" ON public.siswa_presensi
  IS 'Mengizinkan pembacaan presensi harian siswa terbaru oleh Jurnal Mengajar';


-- >>> MIGRATION: 202608300001_finance_config.sql >>>
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


-- >>> MIGRATION: 202608300002_sukaduka_closings.sql >>>
-- supabase/migrations/202608300001_sukaduka_closings.sql
-- Skema Database Tutup Buku Tahunan Suka Duka Guru & Pegawai SIMAS SHAKTI (Supabase PostgreSQL)

-- 1. Membuat tabel tutup buku tahunan (sukaduka_closings)
CREATE TABLE IF NOT EXISTS sukaduka_closings (
    id TEXT PRIMARY KEY, -- Format: {year} e.g. "2025"
    year INT NOT NULL UNIQUE,
    saldo_akhir NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_income NUMERIC(15,2) DEFAULT 0,
    total_expense NUMERIC(15,2) DEFAULT 0,
    closed_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    closed_by VARCHAR(200),
    summary JSONB DEFAULT '{}'::jsonb
);

-- Indexing untuk query cepat
CREATE INDEX IF NOT EXISTS idx_sukaduka_closings_year ON sukaduka_closings(year);

-- 2. Kebijakan Row Level Security (RLS)
ALTER TABLE sukaduka_closings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anonymous read sukaduka_closings" ON sukaduka_closings;
DROP POLICY IF EXISTS "Allow anonymous write sukaduka_closings" ON sukaduka_closings;

CREATE POLICY "Allow anonymous read sukaduka_closings" ON sukaduka_closings FOR SELECT USING (true);
CREATE POLICY "Allow anonymous write sukaduka_closings" ON sukaduka_closings FOR ALL USING (true) WITH CHECK (true);

-- >>> MIGRATION: 202609050001_library_retention_pg_cron.sql >>>
-- ====================================================================
-- MIGRATION: RETENSI DATA MODUL PERPUSTAKAAN OTOMATIS VIA PG_CRON
-- Database: PostgreSQL Supabase (elrmzlicuuglnoeedusr)
-- Author: SIMAS SMAGESA Development Team
-- Date: 2026-09-05
-- Version: [26.09.05.4]
-- ====================================================================

-- 1. AKTIFKAN EKSTENSI PG_CRON (Idempotent)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ====================================================================
-- 2. FUNGSI PEMBERSIHAN DATA LAMA PERPUSTAKAAN (Retensi: 3 Tahun / Masa Studi SMA)
-- ====================================================================
CREATE OR REPLACE FUNCTION public.cleanup_old_library_records()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_pengunjung INT := 0;
    deleted_bebas_pustaka INT := 0;
    deleted_sirkulasi INT := 0;
    cutoff_date DATE;
BEGIN
    cutoff_date := (CURRENT_DATE - INTERVAL '3 years')::DATE;

    -- 1. Hapus riwayat buku tamu digital (lib_pengunjung) > 3 tahun (memanfaatkan idx_lib_pengunjung_tanggal)
    DELETE FROM public.lib_pengunjung
    WHERE tanggal < cutoff_date;
    GET DIAGNOSTICS deleted_pengunjung = ROW_COUNT;

    -- 2. Hapus arsip surat bebas pustaka (lib_bebas_pustaka) alumni > 3 tahun
    DELETE FROM public.lib_bebas_pustaka
    WHERE tgl_terbit < cutoff_date;
    GET DIAGNOSTICS deleted_bebas_pustaka = ROW_COUNT;

    -- 3. Hapus arsip sirkulasi peminjaman (lib_sirkulasi) > 3 tahun
    -- SYARAT KETAT: Hanya transaksi yang SUDAH SELESAI & LUNAS / BEBAS DENDA
    -- Peminjaman yang masih aktif ('dipinjam') atau menunggak denda ('belum_lunas') TIDAK BOLEH dihapus!
    DELETE FROM public.lib_sirkulasi
    WHERE status = 'kembali'
      AND status_denda != 'belum_lunas'
      AND (
          status_denda IN ('bebas_denda', 'lunas')
          OR COALESCE(total_denda, 0) <= 0
      )
      AND COALESCE(tgl_kembali, tgl_pinjam) < cutoff_date;
    GET DIAGNOSTICS deleted_sirkulasi = ROW_COUNT;

    RETURN jsonb_build_object(
        'module', 'perpustakaan',
        'status', 'success',
        'cutoff_date', cutoff_date,
        'deleted_visitors_rows', deleted_pengunjung,
        'deleted_clearance_rows', deleted_bebas_pustaka,
        'deleted_circulation_rows', deleted_sirkulasi,
        'total_deleted_rows', (deleted_pengunjung + deleted_bebas_pustaka + deleted_sirkulasi),
        'executed_at', NOW()
    );
END;
$$;

-- ====================================================================
-- 3. PERBARUI MASTER RUNNER FUNCTION (SEKALIGUS MEMICU PERPUSTAKAAN)
-- ====================================================================
CREATE OR REPLACE FUNCTION public.cleanup_all_expired_simas_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    res_siswa jsonb;
    res_guru jsonb;
    res_duta jsonb;
    res_saran jsonb;
    res_grades jsonb;
    res_finance jsonb;
    res_sukaduka jsonb;
    res_library jsonb;
BEGIN
    res_siswa := public.cleanup_old_siswa_presensi();
    res_guru := public.cleanup_old_guru_presensi();
    res_duta := public.cleanup_old_duta_votes();
    res_saran := public.cleanup_old_masukkan_saran();
    res_grades := public.cleanup_old_guru_mapel_grades();
    res_finance := public.cleanup_old_finance_records();
    res_sukaduka := public.cleanup_old_sukaduka_records();
    res_library := public.cleanup_old_library_records();

    RETURN jsonb_build_object(
        'status', 'success',
        'executed_at', NOW(),
        'results', jsonb_build_object(
            'siswa_presensi', res_siswa,
            'guru_presensi', res_guru,
            'duta_votes', res_duta,
            'masukkan_saran', res_saran,
            'guru_mapel_grades', res_grades,
            'finance', res_finance,
            'sukaduka', res_sukaduka,
            'perpustakaan', res_library
        )
    );
END;
$$;

-- ====================================================================
-- 4. DAFTARKAN JADWAL OTOMATIS VIA PG_CRON (Idempotent Loop)
-- Tanggal 1 awal bulan pukul 02:35 WITA (18:35 UTC) - Staggered 5 menit setelah suka duka
-- ====================================================================
DO $$
DECLARE
    job_rec RECORD;
BEGIN
    FOR job_rec IN 
        SELECT jobname FROM cron.job 
        WHERE jobname = 'auto-cleanup-library-records'
    LOOP
        PERFORM cron.unschedule(job_rec.jobname);
    END LOOP;

    PERFORM cron.schedule(
        'auto-cleanup-library-records',
        '35 18 1 * *',
        $cron$SELECT public.cleanup_old_library_records();$cron$
    );
END $$;

-- ====================================================================
-- 5. HARDENING HAK AKSES EKSEKUSI (OWASP TOP 10 & ASVS LEVEL 2)
-- ====================================================================
REVOKE ALL ON FUNCTION public.cleanup_old_library_records() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_library_records() TO service_role;

REVOKE ALL ON FUNCTION public.cleanup_all_expired_simas_data() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_all_expired_simas_data() TO service_role;


-- >>> MIGRATION: 202609100001_add_replies_to_masukkan_saran.sql >>>
-- supabase/migrations/202609100001_add_replies_to_masukkan_saran.sql
-- Menambahkan kolom replies (JSONB) ke tabel masukkan_saran untuk mendukung riwayat percakapan/tanggapan timbal balik dua arah

ALTER TABLE public.masukkan_saran 
ADD COLUMN IF NOT EXISTS replies JSONB DEFAULT '[]'::jsonb;

-- Index pada updated_at untuk mempercepat query filtering dan pengecekan badge NEW
CREATE INDEX IF NOT EXISTS idx_masukkan_saran_updated_at ON public.masukkan_saran (updated_at DESC);

-- Index pada sender_uid untuk query pencarian masukan personal pengirim
CREATE INDEX IF NOT EXISTS idx_masukkan_saran_sender_uid ON public.masukkan_saran (sender_uid);


-- >>> MIGRATION: 202609100002_add_likes_to_masukkan_saran.sql >>>
﻿-- Migrasi: Menambahkan kolom likes ke tabel masukkan_saran
-- Digunakan untuk menyimpan array UID pengguna yang menyukai / mendukung aspirasi (dukungan komunitas)
-- Format data: JSONB array string UID, contoh: '["uid_1", "uid_2"]'::jsonb

ALTER TABLE public.masukkan_saran 
ADD COLUMN IF NOT EXISTS likes JSONB DEFAULT '[]'::jsonb;

-- Index GIN pada likes untuk query analitik berkinerja tinggi (opsional bila diperlukan pencarian containment)
CREATE INDEX IF NOT EXISTS idx_masukkan_saran_likes_gin ON public.masukkan_saran USING gin (likes);


-- >>> MIGRATION: 202609110001_add_harga_to_lib_buku.sql >>>
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


-- >>> MIGRATION: 202609110002_library_flexible_rules_toggle.sql >>>
-- Migrasi: 202609110002_library_flexible_rules_toggle.sql
-- Tujuan: Memberikan fleksibilitas operasional bagi perpustakaan baru (bebas kuota, bebas durasi, bebas denda, unlimited perpanjangan)

-- 1. Inisialisasi Kunci Konfigurasi Toggle Default (Jika Belum Ada)
INSERT INTO public.lib_config (key, value, keterangan)
VALUES
  ('enable_max_pinjam_siswa', 'true', 'Status aktif pembatasan kuota pinjam siswa (true/false)'),
  ('enable_max_pinjam_guru', 'true', 'Status aktif pembatasan kuota pinjam guru (true/false)'),
  ('enable_durasi_siswa', 'true', 'Status aktif batas durasi pinjam siswa (true/false)'),
  ('enable_durasi_guru', 'true', 'Status aktif batas durasi pinjam guru (true/false)'),
  ('enable_denda', 'true', 'Status aktif pemberlakuan sanksi denda keterlambatan (true/false)'),
  ('enable_max_perpanjangan', 'true', 'Status aktif pembatasan perpanjangan buku (true/false)')
ON CONFLICT (key) DO NOTHING;

-- 2. Update Fungsi: lib_borrow_copy dengan Dukungan Toggle Aturan
CREATE OR REPLACE FUNCTION public.lib_borrow_copy(
  p_eksemplar_id BIGINT,
  p_peminjam_type TEXT,
  p_peminjam_id TEXT,
  p_peminjam_nama TEXT,
  p_peminjam_kelas TEXT,
  p_tgl_pinjam DATE,
  p_tgl_jatuh_tempo DATE,
  p_petugas_uid TEXT
)
RETURNS public.lib_sirkulasi
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  selected_copy public.lib_eksemplar%ROWTYPE;
  selected_book public.lib_buku%ROWTYPE;
  active_count INTEGER;
  max_quota INTEGER;
  quota_enabled BOOLEAN;
  duration_enabled BOOLEAN;
  fine_enabled BOOLEAN;
  fine_rate NUMERIC(10, 2);
  transaction_code TEXT;
  local_today DATE := (NOW() AT TIME ZONE 'Asia/Singapore')::DATE;
  result_row public.lib_sirkulasi%ROWTYPE;
BEGIN
  p_peminjam_type := LOWER(TRIM(COALESCE(p_peminjam_type, '')));
  p_peminjam_id := TRIM(COALESCE(p_peminjam_id, ''));
  p_peminjam_nama := TRIM(COALESCE(p_peminjam_nama, ''));

  IF p_peminjam_type NOT IN ('siswa', 'guru') THEN
    RAISE EXCEPTION 'Tipe peminjam harus siswa atau guru' USING ERRCODE = '22023';
  END IF;

  IF p_peminjam_id = '' OR p_peminjam_nama = '' THEN
    RAISE EXCEPTION 'Identitas peminjam tidak boleh kosong' USING ERRCODE = '22023';
  END IF;

  IF p_tgl_pinjam IS NULL OR p_tgl_pinjam <> local_today THEN
    RAISE EXCEPTION 'Tanggal pinjam harus hari ini' USING ERRCODE = '22007';
  END IF;

  IF p_tgl_jatuh_tempo IS NULL OR p_tgl_jatuh_tempo < p_tgl_pinjam THEN
    RAISE EXCEPTION 'Tanggal jatuh tempo tidak valid' USING ERRCODE = '22007';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_peminjam_type || ':' || p_peminjam_id, 0));

  SELECT * INTO selected_copy
  FROM public.lib_eksemplar
  WHERE id = p_eksemplar_id
  FOR UPDATE;

  IF NOT FOUND OR selected_copy.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Eksemplar tidak ditemukan atau sudah diarsipkan' USING ERRCODE = 'P0002';
  END IF;

  IF selected_copy.status <> 'tersedia' THEN
    RAISE EXCEPTION 'Eksemplar tidak tersedia untuk dipinjam' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO selected_book
  FROM public.lib_buku
  WHERE id = selected_copy.buku_id
  FOR SHARE;

  IF NOT FOUND OR selected_book.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Judul buku sudah diarsipkan' USING ERRCODE = 'P0001';
  END IF;

  IF LOWER(COALESCE(selected_book.tipe_koleksi, 'sirkulasi')) <> 'sirkulasi' THEN
    RAISE EXCEPTION 'Tipe koleksi ini hanya dapat dibaca di perpustakaan' USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*)::INTEGER INTO active_count
  FROM public.lib_sirkulasi
  WHERE peminjam_type = p_peminjam_type
    AND peminjam_id = p_peminjam_id
    AND status = 'dipinjam';

  -- Cek toggle batasan kuota peminjaman
  SELECT COALESCE(value = 'true', TRUE)
  INTO quota_enabled
  FROM public.lib_config
  WHERE key = CASE WHEN p_peminjam_type = 'siswa' THEN 'enable_max_pinjam_siswa' ELSE 'enable_max_pinjam_guru' END;
  quota_enabled := COALESCE(quota_enabled, TRUE);

  IF quota_enabled THEN
    SELECT CASE
      WHEN value ~ '^\d+$' THEN value::INTEGER
      ELSE CASE WHEN p_peminjam_type = 'siswa' THEN 3 ELSE 5 END
    END
    INTO max_quota
    FROM public.lib_config
    WHERE key = CASE WHEN p_peminjam_type = 'siswa' THEN 'max_pinjam_siswa' ELSE 'max_pinjam_guru' END;

    max_quota := COALESCE(max_quota, CASE WHEN p_peminjam_type = 'siswa' THEN 3 ELSE 5 END);

    IF active_count >= max_quota THEN
      RAISE EXCEPTION 'Batas maksimal peminjaman (% buku) telah tercapai', max_quota USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Cek toggle durasi pinjam untuk blokir peminjaman saat ada buku terlambat
  SELECT COALESCE(value = 'true', TRUE)
  INTO duration_enabled
  FROM public.lib_config
  WHERE key = CASE WHEN p_peminjam_type = 'siswa' THEN 'enable_durasi_siswa' ELSE 'enable_durasi_guru' END;
  duration_enabled := COALESCE(duration_enabled, TRUE);

  IF duration_enabled AND EXISTS (
    SELECT 1
    FROM public.lib_sirkulasi
    WHERE peminjam_type = p_peminjam_type
      AND peminjam_id = p_peminjam_id
      AND status = 'dipinjam'
      AND tgl_jatuh_tempo < local_today
  ) THEN
    RAISE EXCEPTION 'Peminjam memiliki buku terlambat yang harus diselesaikan terlebih dahulu' USING ERRCODE = 'P0001';
  END IF;

  -- Cek toggle denda keterlambatan
  SELECT COALESCE(value = 'true', TRUE)
  INTO fine_enabled
  FROM public.lib_config
  WHERE key = 'enable_denda';
  fine_enabled := COALESCE(fine_enabled, TRUE);

  IF fine_enabled THEN
    SELECT CASE WHEN value ~ '^\d+(\.\d+)?$' THEN value::NUMERIC ELSE 1000 END
    INTO fine_rate
    FROM public.lib_config
    WHERE key = 'tarif_denda_per_hari';
    fine_rate := COALESCE(fine_rate, 1000);
  ELSE
    fine_rate := 0;
  END IF;

  transaction_code := 'PINJ-' || TO_CHAR(p_tgl_pinjam, 'YYYYMMDD') || '-'
    || UPPER(SUBSTRING(MD5(CLOCK_TIMESTAMP()::TEXT || RANDOM()::TEXT || p_eksemplar_id::TEXT), 1, 12));

  INSERT INTO public.lib_sirkulasi (
    kode_transaksi, eksemplar_id, buku_id,
    peminjam_type, peminjam_id, peminjam_nama, peminjam_kelas,
    tgl_pinjam, tgl_jatuh_tempo, status,
    tarif_denda_per_hari, petugas_pinjam_uid
  ) VALUES (
    transaction_code, selected_copy.id, selected_copy.buku_id,
    p_peminjam_type, p_peminjam_id, p_peminjam_nama, NULLIF(TRIM(p_peminjam_kelas), ''),
    p_tgl_pinjam, p_tgl_jatuh_tempo, 'dipinjam',
    fine_rate, NULLIF(TRIM(p_petugas_uid), '')
  )
  RETURNING * INTO result_row;

  UPDATE public.lib_eksemplar
  SET status = 'dipinjam', updated_at = NOW()
  WHERE id = selected_copy.id;

  RETURN result_row;
END;
$$;

-- 3. Update Fungsi: lib_return_copy dengan Dukungan Toggle Bebas Denda
CREATE OR REPLACE FUNCTION public.lib_return_copy(
  p_sirkulasi_id BIGINT,
  p_tgl_kembali DATE,
  p_kondisi TEXT,
  p_petugas_uid TEXT
)
RETURNS public.lib_sirkulasi
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  circulation public.lib_sirkulasi%ROWTYPE;
  ignore_holidays BOOLEAN;
  fine_enabled BOOLEAN;
  late_days INTEGER;
  total_fine NUMERIC(12, 2);
  copy_status TEXT;
  local_today DATE := (NOW() AT TIME ZONE 'Asia/Singapore')::DATE;
  result_row public.lib_sirkulasi%ROWTYPE;
BEGIN
  p_kondisi := LOWER(TRIM(COALESCE(p_kondisi, 'baik')));
  IF p_kondisi NOT IN ('baik', 'rusak_ringan', 'rusak_berat', 'hilang') THEN
    RAISE EXCEPTION 'Kondisi pengembalian tidak valid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO circulation
  FROM public.lib_sirkulasi
  WHERE id = p_sirkulasi_id
  FOR UPDATE;

  IF NOT FOUND OR circulation.status <> 'dipinjam' THEN
    RAISE EXCEPTION 'Transaksi tidak ditemukan atau buku sudah dikembalikan' USING ERRCODE = 'P0001';
  END IF;

  IF p_tgl_kembali IS NULL OR p_tgl_kembali <> local_today OR p_tgl_kembali < circulation.tgl_pinjam THEN
    RAISE EXCEPTION 'Tanggal pengembalian tidak valid' USING ERRCODE = '22007';
  END IF;

  SELECT COALESCE(value = 'true', TRUE)
  INTO ignore_holidays
  FROM public.lib_config
  WHERE key = 'abaikan_hari_libur';
  ignore_holidays := COALESCE(ignore_holidays, TRUE);

  SELECT COALESCE(value = 'true', TRUE)
  INTO fine_enabled
  FROM public.lib_config
  WHERE key = 'enable_denda';
  fine_enabled := COALESCE(fine_enabled, TRUE);

  late_days := public.lib_count_chargeable_days(
    circulation.tgl_jatuh_tempo,
    p_tgl_kembali,
    ignore_holidays
  );

  IF fine_enabled THEN
    total_fine := late_days * COALESCE(circulation.tarif_denda_per_hari, 0);
  ELSE
    total_fine := 0;
  END IF;

  copy_status := CASE WHEN p_kondisi IN ('rusak_berat', 'hilang') THEN p_kondisi ELSE 'tersedia' END;

  UPDATE public.lib_sirkulasi
  SET
    tgl_kembali = p_tgl_kembali,
    status = 'kembali',
    hari_terlambat = late_days,
    total_denda = total_fine,
    status_denda = CASE WHEN total_fine > 0 THEN 'belum_lunas' ELSE 'bebas_denda' END,
    kondisi_kembali = p_kondisi,
    petugas_kembali_uid = NULLIF(TRIM(p_petugas_uid), ''),
    updated_at = NOW()
  WHERE id = circulation.id
  RETURNING * INTO result_row;

  UPDATE public.lib_eksemplar
  SET status = copy_status, kondisi = p_kondisi, updated_at = NOW()
  WHERE id = circulation.eksemplar_id;

  RETURN result_row;
END;
$$;

-- 4. Update Fungsi: lib_extend_loan dengan Dukungan Toggle Perpanjangan & Durasi
CREATE OR REPLACE FUNCTION public.lib_extend_loan(
  p_sirkulasi_id BIGINT,
  p_petugas_uid TEXT
)
RETURNS public.lib_sirkulasi
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  circulation public.lib_sirkulasi%ROWTYPE;
  max_extensions INTEGER;
  max_ext_enabled BOOLEAN;
  duration_days INTEGER;
  duration_enabled BOOLEAN;
  ignore_holidays BOOLEAN;
  local_today DATE := (NOW() AT TIME ZONE 'Asia/Singapore')::DATE;
  result_row public.lib_sirkulasi%ROWTYPE;
BEGIN
  SELECT * INTO circulation
  FROM public.lib_sirkulasi
  WHERE id = p_sirkulasi_id
  FOR UPDATE;

  IF NOT FOUND OR circulation.status <> 'dipinjam' THEN
    RAISE EXCEPTION 'Transaksi tidak ditemukan atau sudah selesai' USING ERRCODE = 'P0001';
  END IF;

  -- Cek toggle durasi pinjam untuk perpanjangan buku terlambat
  SELECT COALESCE(value = 'true', TRUE)
  INTO duration_enabled
  FROM public.lib_config
  WHERE key = CASE WHEN circulation.peminjam_type = 'siswa' THEN 'enable_durasi_siswa' ELSE 'enable_durasi_guru' END;
  duration_enabled := COALESCE(duration_enabled, TRUE);

  IF duration_enabled AND circulation.tgl_jatuh_tempo < local_today THEN
    RAISE EXCEPTION 'Buku yang sudah terlambat tidak dapat diperpanjang' USING ERRCODE = 'P0001';
  END IF;

  -- Cek toggle batas maksimal perpanjangan
  SELECT COALESCE(value = 'true', TRUE)
  INTO max_ext_enabled
  FROM public.lib_config WHERE key = 'enable_max_perpanjangan';
  max_ext_enabled := COALESCE(max_ext_enabled, TRUE);

  IF max_ext_enabled THEN
    SELECT CASE WHEN value ~ '^\d+$' THEN value::INTEGER ELSE 1 END
    INTO max_extensions FROM public.lib_config WHERE key = 'max_perpanjangan';
    max_extensions := COALESCE(max_extensions, 1);

    IF circulation.perpanjangan_ke >= max_extensions THEN
      RAISE EXCEPTION 'Batas maksimal perpanjangan (% kali) telah tercapai', max_extensions USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT CASE WHEN value ~ '^\d+$' THEN value::INTEGER ELSE 7 END
  INTO duration_days
  FROM public.lib_config
  WHERE key = CASE
    WHEN circulation.peminjam_type = 'siswa' THEN 'durasi_pinjam_siswa_hari'
    ELSE 'durasi_pinjam_guru_hari'
  END;
  duration_days := COALESCE(duration_days, CASE WHEN circulation.peminjam_type = 'siswa' THEN 7 ELSE 14 END);

  SELECT COALESCE(value = 'true', TRUE)
  INTO ignore_holidays FROM public.lib_config WHERE key = 'abaikan_hari_libur';
  ignore_holidays := COALESCE(ignore_holidays, TRUE);

  UPDATE public.lib_sirkulasi
  SET
    tgl_jatuh_tempo = public.lib_add_loan_days(circulation.tgl_jatuh_tempo, duration_days, ignore_holidays),
    perpanjangan_ke = circulation.perpanjangan_ke + 1,
    updated_at = NOW()
  WHERE id = circulation.id
  RETURNING * INTO result_row;

  RETURN result_row;
END;
$$;


-- >>> MIGRATION: 202609140001_add_no_bukti_to_finance_cashflow.sql >>>
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


-- >>> MIGRATION: 202609240001_add_ai_grading_sessions.sql >>>
-- supabase/migrations/202609240001_add_ai_grading_sessions.sql
-- Tabel Sesi Koreksi Asesmen Siswa Otomatis Berbasis AI (Supabase Fallback / Resilient Storage)
-- ID format: {kelas}_{timestamp} (contoh: X-E1_1727148400000)

CREATE TABLE IF NOT EXISTS ai_grading_sessions (
    id TEXT PRIMARY KEY,
    teacher_id TEXT,
    kelas VARCHAR(50) NOT NULL,
    mapel VARCHAR(100) NOT NULL,
    semester VARCHAR(5) NOT NULL,
    tahun_ajaran VARCHAR(20) NOT NULL,
    title TEXT NOT NULL,
    total_max_score NUMERIC(5,2) DEFAULT 100,
    questions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    submissions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_grading_sessions_teacher ON ai_grading_sessions(teacher_id);
CREATE INDEX IF NOT EXISTS idx_ai_grading_sessions_kelas_mapel ON ai_grading_sessions(kelas, mapel);

ALTER TABLE ai_grading_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon read ai_grading_sessions" ON ai_grading_sessions;
DROP POLICY IF EXISTS "Allow anon write ai_grading_sessions" ON ai_grading_sessions;
CREATE POLICY "Allow anon read ai_grading_sessions" ON ai_grading_sessions FOR SELECT USING (true);
CREATE POLICY "Allow anon write ai_grading_sessions" ON ai_grading_sessions FOR ALL USING (true) WITH CHECK (true);


-- >>> MIGRATION: 202610060001_create_telemetry_tables.sql >>>
-- ====================================================================
-- SIMAS SMAGESA - SUPABASE POSTGRESQL MIGRATION
-- Telemetri & Log Jejak Audit: login_history & audit_logs
-- Single Source of Truth (SSOT)
-- ====================================================================

-- 1. TABEL RIWAYAT SESI LOGIN (login_history)
CREATE TABLE IF NOT EXISTS public.login_history (
    id TEXT PRIMARY KEY,
    uid TEXT NOT NULL,
    email TEXT,
    name TEXT,
    role TEXT,
    login_at TEXT NOT NULL,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- Indeks performa kueri B-Tree
CREATE INDEX IF NOT EXISTS idx_login_history_login_at ON public.login_history(login_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_history_role ON public.login_history(role);
CREATE INDEX IF NOT EXISTS idx_login_history_uid ON public.login_history(uid);

-- 2. TABEL LOG AUDIT KEAMANAN (audit_logs - ASVS Level 1 & 2)
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    target_id TEXT,
    actor_uid TEXT,
    actor_name TEXT,
    old_data TEXT,
    new_data TEXT,
    details TEXT,
    timestamp TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- Indeks performa kueri B-Tree
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON public.audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_uid ON public.audit_logs(actor_uid);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target_id ON public.audit_logs(target_id);

-- 3. ROW LEVEL SECURITY (RLS) & HAK AKSES API
ALTER TABLE public.login_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Izinkan akses penuh untuk anon & authenticated (diamankan secara ketat oleh Cloudflare Worker API Gateway)
DROP POLICY IF EXISTS "Allow anon and auth read on login_history" ON public.login_history;
CREATE POLICY "Allow anon and auth read on login_history" ON public.login_history
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Allow anon and auth insert on login_history" ON public.login_history;
CREATE POLICY "Allow anon and auth insert on login_history" ON public.login_history
    FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon and auth delete on login_history" ON public.login_history;
CREATE POLICY "Allow anon and auth delete on login_history" ON public.login_history
    FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Allow anon and auth update on login_history" ON public.login_history;
CREATE POLICY "Allow anon and auth update on login_history" ON public.login_history
    FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon and auth read on audit_logs" ON public.audit_logs;
CREATE POLICY "Allow anon and auth read on audit_logs" ON public.audit_logs
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Allow anon and auth insert on audit_logs" ON public.audit_logs;
CREATE POLICY "Allow anon and auth insert on audit_logs" ON public.audit_logs
    FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon and auth delete on audit_logs" ON public.audit_logs;
CREATE POLICY "Allow anon and auth delete on audit_logs" ON public.audit_logs
    FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Allow anon and auth update on audit_logs" ON public.audit_logs;
CREATE POLICY "Allow anon and auth update on audit_logs" ON public.audit_logs
    FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- Refresh PostgREST Schema Cache
NOTIFY pgrst, 'reload schema';


-- >>> MIGRATION: 202610130001_add_keterangan_to_guru_presensi.sql >>>
-- supabase/migrations/202610130001_add_keterangan_to_guru_presensi.sql
-- Tambah kolom keterangan (deskripsi kegiatan untuk status K) pada tabel guru_presensi.

ALTER TABLE guru_presensi ADD COLUMN IF NOT EXISTS keterangan TEXT DEFAULT NULL;

-- Muat ulang schema cache PostgREST agar kolom baru langsung dikenali API.
NOTIFY pgrst, 'reload schema';


-- >>> MIGRATION: 202610150001_lock_ai_grading_sessions.sql >>>
-- D1 is the single cloud source. Historical fallback data remains intact.
-- Firebase identity cannot be verified by the former public PostgREST policies.
ALTER TABLE public.ai_grading_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon read ai_grading_sessions" ON public.ai_grading_sessions;
DROP POLICY IF EXISTS "Allow anon write ai_grading_sessions" ON public.ai_grading_sessions;
REVOKE ALL ON TABLE public.ai_grading_sessions FROM anon, authenticated;


-- >>> MIGRATION: 202610220001_rkas_komite.sql >>>
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


-- >>> MIGRATION: 202610230001_allow_gtk_feedback_replies.sql >>>
-- supabase/migrations/202610230001_allow_gtk_feedback_replies.sql
-- Memastikan kolom replies dan index pada tabel masukkan_saran optimal untuk partisipasi diskusi seluruh GTK

-- 1. Pastikan kolom replies (JSONB) tersedia dengan nilai default array kosong
ALTER TABLE public.masukkan_saran 
ADD COLUMN IF NOT EXISTS replies JSONB DEFAULT '[]'::jsonb;

-- 2. Pastikan kolom likes (JSONB) tersedia
ALTER TABLE public.masukkan_saran 
ADD COLUMN IF NOT EXISTS likes JSONB DEFAULT '[]'::jsonb;

-- 3. Tambahkan GIN index untuk pencarian/query JSONB replies dan likes yang efisien
CREATE INDEX IF NOT EXISTS idx_masukkan_saran_replies_gin ON public.masukkan_saran USING gin (replies);
CREATE INDEX IF NOT EXISTS idx_masukkan_saran_likes_gin ON public.masukkan_saran USING gin (likes);

-- 4. Index performa status dan updated_at
CREATE INDEX IF NOT EXISTS idx_masukkan_saran_status ON public.masukkan_saran (status);
CREATE INDEX IF NOT EXISTS idx_masukkan_saran_updated_at ON public.masukkan_saran (updated_at DESC);


-- >>> MIGRATION: 202610280001_lockdown_telemetry_rkas_sukaduka_closings.sql >>>
-- =====================================================================
-- SIMAS SMAGESA - SUPABASE POSTGRESQL MIGRATION
-- 202610280001_lockdown_telemetry_rkas_sukaduka_closings.sql
-- Standar Keamanan: OWASP Top 10 (A01: Broken Access Control) & ASVS Level 1 & 2
--
-- Mengunci rapat 5 tabel sensitif yang sebelumnya memiliki policy 'anon'
-- terbuka (USING (true)):
-- 1. rkas_komite_headers (Keuangan RKAS Komite)
-- 2. rkas_komite_items   (Rincian Belanja RKAS Komite)
-- 3. sukaduka_closings   (Kunci Tutup Buku Tahunan Suka Duka)
-- 4. login_history       (Riwayat Sesi Login Pengguna / Telemetri)
-- 5. audit_logs          (Log Audit Forensik & Jejak Mutasi Data)
--
-- Seluruh akses tabel di atas kini EKSKLUSIF melalui role 'service_role'
-- (Supabase Edge Function 'secure-proxy' & Cloudflare Worker API Gateway).
-- Pengguna dengan anon key publik dari browser ditolak 100% oleh PostgREST.
-- =====================================================================

DO $$
DECLARE
  target_table TEXT;
  existing_policy RECORD;
  protected_tables TEXT[] := ARRAY[
    'rkas_komite_headers',
    'rkas_komite_items',
    'sukaduka_closings',
    'login_history',
    'audit_logs'
  ];
BEGIN
  FOREACH target_table IN ARRAY protected_tables LOOP
    -- Pastikan tabel ada di schema public sebelum memproses
    IF to_regclass(format('public.%I', target_table)) IS NULL THEN
      RAISE NOTICE 'Tabel public.% tidak ditemukan, melewati...', target_table;
      CONTINUE;
    END IF;

    -- 1. Aktifkan Row Level Security (RLS) secara tegas
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target_table);

    -- 2. Hapus seluruh policy yang ada saat ini (membersihkan policy lama yang longgar)
    FOR existing_policy IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = target_table
    LOOP
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON public.%I',
        existing_policy.policyname,
        target_table
      );
    END LOOP;

    -- 3. Cabut semua hak akses tabel dari role anon & authenticated
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', target_table);

    -- 4. Berikan hak penuh hanya kepada service_role
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', target_table);

    RAISE NOTICE 'Tabel public.% berhasil dikunci ke mode service_role only.', target_table;
  END LOOP;
END
$$;

-- Refresh schema cache PostgREST agar perubahan hak akses langsung aktif
NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- PROSEDUR ROLLBACK DARURAT (Hanya dijalankan jika ada kendala sistem):
-- =====================================================================
-- GRANT ALL ON public.rkas_komite_headers TO anon, authenticated;
-- CREATE POLICY "Allow read rkas_komite_headers" ON public.rkas_komite_headers FOR SELECT USING (true);
-- CREATE POLICY "Allow write rkas_komite_headers" ON public.rkas_komite_headers FOR ALL USING (true) WITH CHECK (true);
--
-- GRANT ALL ON public.rkas_komite_items TO anon, authenticated;
-- CREATE POLICY "Allow read rkas_komite_items" ON public.rkas_komite_items FOR SELECT USING (true);
-- CREATE POLICY "Allow write rkas_komite_items" ON public.rkas_komite_items FOR ALL USING (true) WITH CHECK (true);
--
-- GRANT ALL ON public.sukaduka_closings TO anon, authenticated;
-- CREATE POLICY "Allow anonymous read sukaduka_closings" ON public.sukaduka_closings FOR SELECT USING (true);
-- CREATE POLICY "Allow anonymous write sukaduka_closings" ON public.sukaduka_closings FOR ALL USING (true) WITH CHECK (true);
--
-- GRANT ALL ON public.login_history TO anon, authenticated;
-- CREATE POLICY "Allow anon and auth read on login_history" ON public.login_history FOR SELECT TO anon, authenticated USING (true);
-- CREATE POLICY "Allow anon and auth insert on login_history" ON public.login_history FOR INSERT TO anon, authenticated WITH CHECK (true);
-- CREATE POLICY "Allow anon and auth delete on login_history" ON public.login_history FOR DELETE TO anon, authenticated USING (true);
-- CREATE POLICY "Allow anon and auth update on login_history" ON public.login_history FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
--
-- GRANT ALL ON public.audit_logs TO anon, authenticated;
-- CREATE POLICY "Allow anon and auth read on audit_logs" ON public.audit_logs FOR SELECT TO anon, authenticated USING (true);
-- CREATE POLICY "Allow anon and auth insert on audit_logs" ON public.audit_logs FOR INSERT TO anon, authenticated WITH CHECK (true);
-- CREATE POLICY "Allow anon and auth delete on audit_logs" ON public.audit_logs FOR DELETE TO anon, authenticated USING (true);
-- CREATE POLICY "Allow anon and auth update on audit_logs" ON public.audit_logs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
-- NOTIFY pgrst, 'reload schema';



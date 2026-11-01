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

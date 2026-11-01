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

-- ====================================================================
-- SIMAS SMAGESA - MIGRATION: SEED KATALOG AKTIVITAS BEBAN KERJA GURU
-- Migration File: 202609260001_expand_activity_catalog_permen_11_2025_sma.sql
-- Sesuai: Permendikdasmen No. 11/2025 (Khusus Satuan Pendidikan SMA)
-- 5 Kegiatan Pokok (Pasal 3):
-- 1. Merencanakan pembelajaran/pembimbingan (Pasal 4)
-- 2. Melaksanakan pembelajaran/pembimbingan (Pasal 5 & 13)
-- 3. Menilai hasil pembelajaran/pembimbingan (Pasal 7)
-- 4. Membimbing dan melatih murid (Pasal 8, 9, 14)
-- 5. Melaksanakan tugas tambahan yang melekat (Pasal 10, 11, Lampiran)
-- ====================================================================

INSERT INTO activity_catalog (
    id, code, category_code, category_name, name, description,
    default_duration_minutes, is_teaching, requires_evidence, sort_order, is_active, created_at
) VALUES 
-- 1. MERENCANAKAN PEMBELAJARAN ATAU PEMBIMBINGAN (Pasal 4)
(
    'cat_rencana_kurikulum', 'rencana_kurikulum', 'PERENCANAAN', 'Merencanakan Pembelajaran/Pembimbingan',
    'Pengkajian Kurikulum Satuan Pendidikan (CP, TP, ATP, KOSP)', 'Pengkajian dan pemetaan capaian pembelajaran, tujuan pembelajaran, alur tujuan pembelajaran, dan kurikulum operasional sekolah (KOSP)',
    45, 0, 0, 101, 1, datetime('now')
),
(
    'cat_rencana_modul', 'rencana_modul', 'PERENCANAAN', 'Merencanakan Pembelajaran/Pembimbingan',
    'Pembuatan Modul Ajar / RPP / RPL Bimbingan Konseling', 'Penyusunan rencana pelaksanaan pembelajaran (RPP), modul ajar terpadu, atau rencana pelayanan bimbingan konseling (RPL BK) sesuai standar proses',
    45, 0, 0, 102, 1, datetime('now')
),
(
    'cat_evaluasi', 'rencana_perangkat', 'PERENCANAAN', 'Merencanakan Pembelajaran/Pembimbingan',
    'Penyusunan Perangkat Ajar, Bahan Ajar, LKPD & Kisi-Kisi', 'Pengembangan media instruksional, materi bahan ajar digital/cetak, lembar kerja murid, serta instrumen kisi-kisi pembelajaran',
    45, 0, 0, 103, 1, datetime('now')
),

-- 2. MELAKSANAKAN PEMBELAJARAN ATAU PEMBIMBINGAN (Pasal 5, 13)
(
    'cat_kbm', 'kbm_intrakurikuler', 'PELAKSANAAN_KBM', 'Melaksanakan Pembelajaran/Pembimbingan',
    'KBM Tatap Muka Intrakurikuler di Kelas / Laboratorium', 'Interaksi tatap muka langsung antara guru dan murid dalam pembelajaran mata pelajaran sesuai struktur kurikulum SMA (24–40 Jam Tatap Muka/minggu)',
    45, 1, 0, 201, 1, datetime('now')
),
(
    'cat_kbm_p5', 'kbm_kokurikuler_p5', 'PELAKSANAAN_KBM', 'Melaksanakan Pembelajaran/Pembimbingan',
    'Pembelajaran Kokurikuler (Projek Penguatan Profil Pelajar Pancasila / P5)', 'Fasilitasi pembelajaran berbasis projek interdisipliner penguatan karakter dan kompetensi profil pelajar Pancasila',
    45, 1, 0, 202, 1, datetime('now')
),
(
    'cat_kbm_ekstra', 'kbm_ekstrakurikuler', 'PELAKSANAAN_KBM', 'Melaksanakan Pembelajaran/Pembimbingan',
    'Pembelajaran Ekstrakurikuler', 'Pelaksanaan kegiatan pembelajaran dan pelatihan ekstrakurikuler terstruktur sesuai minat bakat murid',
    45, 0, 0, 203, 1, datetime('now')
),
(
    'cat_bk', 'layanan_bk', 'PELAKSANAAN_KBM', 'Melaksanakan Pembelajaran/Pembimbingan',
    'Pelaksanaan Pembimbingan Bimbingan & Konseling (BK)', 'Layanan bimbingan klasikal, bimbingan kelompok, konseling individual, dan bimbingan lintas kelas untuk mendukung kemandirian murid (minimal 5 rombel/tahun)',
    45, 0, 0, 204, 1, datetime('now')
),

-- 3. MENILAI HASIL PEMBELAJARAN ATAU PEMBIMBINGAN (Pasal 7)
(
    'cat_nilai_formatif', 'asesmen_formatif', 'PENILAIAN', 'Menilai Hasil Pembelajaran/Pembimbingan',
    'Pelaksanaan Asesmen Formatif (Penilaian Proses & Diagnostik)', 'Pengumpulan informasi secara berkala selama proses KBM untuk memantau kemajuan belajar murid, kuis harian, dan umpan balik langsung',
    45, 0, 0, 301, 1, datetime('now')
),
(
    'cat_nilai_sumatif', 'asesmen_sumatif', 'PENILAIAN', 'Menilai Hasil Pembelajaran/Pembimbingan',
    'Pelaksanaan Asesmen Sumatif (Lingkup Materi, STS, SAS, SAT/Ujian)', 'Pengujian dan pengukuran pencapaian hasil belajar murid pada akhir lingkup materi, asesmen tengah semester, atau akhir semester/tahun',
    90, 0, 0, 302, 1, datetime('now')
),
(
    'cat_nilai_olah', 'pengolahan_nilai', 'PENILAIAN', 'Menilai Hasil Pembelajaran/Pembimbingan',
    'Pengolahan Nilai Rapor, Remedial, dan Pengayaan', 'Analisis ketuntasan tujuan pembelajaran, pelaksanaan program remedial bagi murid belum tuntas, dan program pengayaan',
    45, 0, 0, 303, 1, datetime('now')
),
(
    'cat_nilai_bk', 'evaluasi_bk', 'PENILAIAN', 'Menilai Hasil Pembelajaran/Pembimbingan',
    'Evaluasi Hasil Layanan Bimbingan & Konseling (BK)', 'Penilaian ketercapaian tujuan layanan BK, analisis sosiometri/angket kebutuhan murid, dan tindak lanjut konseling',
    45, 0, 0, 304, 1, datetime('now')
),
(
    'cat_administrasi', 'administrasi_nilai', 'PENILAIAN', 'Menilai Hasil Pembelajaran/Pembimbingan',
    'Pengadministrasian Nilai, Buku Nilai Guru Mapel & Pelaporan', 'Penginputan nilai ke sistem buku nilai/e-rapor, penyusunan deskripsi capaian kompetensi, dan pelaporan hasil belajar',
    45, 0, 0, 305, 1, datetime('now')
),

-- 4. MEMBIMBING DAN MELATIH MURID (Pasal 8, 9, 14)
(
    'cat_bimbing_guru_wali', 'guru_wali', 'PEMBIMBINGAN', 'Membimbing dan Melatih Murid',
    'Pendampingan Murid Dampingan sebagai Guru Wali', 'Melaksanakan pendampingan akademik, pengembangan kompetensi, keterampilan, dan karakter murid dampingan secara berkelanjutan (Ekuivalensi 2 Jam Tatap Muka/minggu)',
    90, 0, 0, 401, 1, datetime('now')
),
(
    'cat_bimbing_p5', 'pendampingan_p5', 'PEMBIMBINGAN', 'Membimbing dan Melatih Murid',
    'Fasilitasi & Pendampingan Murid dalam Projek Kokurikuler (P5)', 'Membimbing dan melatih murid dalam menggali tema projek, memecahkan masalah kontekstual, dan menyusun pameran karya P5',
    90, 0, 0, 402, 1, datetime('now')
),
(
    'cat_ekstra', 'bimbingan_ekstrakurikuler', 'PEMBIMBINGAN', 'Membimbing dan Melatih Murid',
    'Pembimbingan & Pelatihan Murid dalam Ekstrakurikuler', 'Melatih keterampilan teknis, kepemimpinan, dan kedisiplinan murid dalam bidang ekstrakurikuler sekolah (Ekuivalensi 2 Jam Tatap Muka/minggu)',
    90, 0, 0, 403, 1, datetime('now')
),
(
    'cat_bimbing_lomba', 'pembimbingan_lomba', 'PEMBIMBINGAN', 'Membimbing dan Melatih Murid',
    'Pembimbingan Siswa Persiapan Lomba / Olimpiade / Prestasi', 'Pelatihan intensif dan pendampingan murid berbakat dalam ajang OSN, O2SN, FLS2N, debat, karya tulis ilmiah, dan kompetisi akademik/non-akademik',
    90, 0, 0, 404, 1, datetime('now')
),

-- 5. MELAKSANAKAN TUGAS TAMBAHAN YANG MELEKAT (Pasal 10, 11, Lampiran)
-- A. Tugas Tambahan Utama (Ekuivalensi 12 Jam TM / 3 Rombel BK - Pasal 15 ayat 1)
(
    'cat_tt_waka', 'waka_sekolah', 'TUGAS_TAMBAHAN', 'Melaksanakan Tugas Tambahan',
    'Tugas Tambahan: Wakil Kepala Sekolah (Waka)', 'Membantu Kepala Sekolah dalam bidang Kurikulum, Kesiswaan, Sarana Prasarana, atau Humas (Ekuivalensi 12 Jam Tatap Muka/minggu)',
    540, 0, 0, 501, 1, datetime('now')
),
(
    'cat_tt_kepala_perpus', 'kepala_perpustakaan', 'TUGAS_TAMBAHAN', 'Melaksanakan Tugas Tambahan',
    'Tugas Tambahan: Kepala Perpustakaan Sekolah', 'Pengelolaan layanan sirkulasi, literasi, pengadaan koleksi, dan pengembangan perpustakaan sekolah (Ekuivalensi 12 Jam Tatap Muka/minggu)',
    540, 0, 0, 502, 1, datetime('now')
),
(
    'cat_tt_kepala_lab', 'kepala_laboratorium', 'TUGAS_TAMBAHAN', 'Melaksanakan Tugas Tambahan',
    'Tugas Tambahan: Kepala Laboratorium Sekolah', 'Pengelolaan sarana laboratorium IPA, Laboratorium Komputer, atau Laboratorium Bahasa (Ekuivalensi 12 Jam Tatap Muka/minggu)',
    540, 0, 0, 503, 1, datetime('now')
),
(
    'cat_tt_gpk', 'guru_pembimbing_khusus', 'TUGAS_TAMBAHAN', 'Melaksanakan Tugas Tambahan',
    'Tugas Tambahan: Guru Pembimbing Khusus (GPK) Inklusif', 'Pendampingan murid berkebutuhan khusus pada satuan pendidikan yang menyelenggarakan pendidikan inklusif (Ekuivalensi 6 Jam Tatap Muka/minggu)',
    270, 0, 0, 504, 1, datetime('now')
),
-- B. Tugas Tambahan Lain (Ekuivalensi Kumulatif Maksimal 6 Jam TM / Lampiran)
(
    'cat_wali_kelas', 'wali_kelas', 'TUGAS_TAMBAHAN', 'Melaksanakan Tugas Tambahan',
    'Tugas Tambahan: Wali Kelas SMA', 'Pengelolaan administrasi kelas binaan, presensi, pembinaan murid, hubungan dengan orang tua/wali murid, dan buku rapor (Ekuivalensi 2 Jam Tatap Muka/minggu)',
    90, 0, 0, 505, 1, datetime('now')
),
(
    'cat_pembina_osis', 'pembina_osis', 'TUGAS_TAMBAHAN', 'Melaksanakan Tugas Tambahan',
    'Tugas Tambahan: Pembina OSIS / MPK', 'Pembimbingan organisasi kesiswaan, kepemimpinan siswa, musyawarah perwakilan kelas, dan program kerja OSIS (Ekuivalensi 2 Jam Tatap Muka/minggu)',
    90, 0, 0, 506, 1, datetime('now')
),
(
    'cat_tt_koor_pkb', 'koordinator_pkb', 'TUGAS_TAMBAHAN', 'Melaksanakan Tugas Tambahan',
    'Tugas Tambahan: Koordinator Pengembangan Kompetensi Guru', 'Pengelolaan dan koordinasi program pengembangan keprofesian berkelanjutan di satuan pendidikan (Ekuivalensi 2 Jam Tatap Muka/minggu)',
    90, 0, 0, 507, 1, datetime('now')
),
(
    'cat_piket', 'guru_piket', 'TUGAS_TAMBAHAN', 'Melaksanakan Tugas Tambahan',
    'Tugas Tambahan: Guru Piket Sekolah', 'Menjaga ketertiban lingkungan sekolah, mencatat presensi harian, mengoordinasikan kelas saat guru berhalangan, dan menerima tamu dinas (Ekuivalensi 1 Jam Tatap Muka/minggu)',
    45, 0, 0, 508, 1, datetime('now')
),
(
    'cat_tt_koor_p5', 'koordinator_p5', 'TUGAS_TAMBAHAN', 'Melaksanakan Tugas Tambahan',
    'Tugas Tambahan: Koordinator Pembelajaran Berbasis Projek (P5)', 'Mengoordinasikan perancangan tema, modul projek, dan asesmen P5 lintas mata pelajaran (Ekuivalensi 2 Jam Tatap Muka per rombel)',
    90, 0, 0, 509, 1, datetime('now')
),
(
    'cat_tt_koor_inklusi', 'koordinator_inklusi', 'TUGAS_TAMBAHAN', 'Melaksanakan Tugas Tambahan',
    'Tugas Tambahan: Koordinator Pendidikan Inklusi', 'Mengoordinasikan program identifikasi, asesmen awal, dan akomodasi pembelajaran ramah murid berkebutuhan khusus (Ekuivalensi 2 Jam Tatap Muka/minggu)',
    90, 0, 0, 510, 1, datetime('now')
),
(
    'cat_tt_tppk', 'tppk_sekolah', 'TUGAS_TAMBAHAN', 'Melaksanakan Tugas Tambahan',
    'Tugas Tambahan: Tim Pencegahan & Penanganan Kekerasan (TPPK)', 'Satuan tugas pencegahan kekerasan, perlindungan pendidik dan tenaga kependidikan di lingkungan sekolah (Ekuivalensi 1–2 Jam Tatap Muka/minggu)',
    90, 0, 0, 511, 1, datetime('now')
),
(
    'cat_tt_panitia_acara', 'panitia_acara', 'TUGAS_TAMBAHAN', 'Melaksanakan Tugas Tambahan',
    'Tugas Tambahan: Pengurus Kepanitiaan Acara Sekolah (Ketua/Sekretaris/Bendahara)', 'Kepanitiaan acara resmi di satuan pendidikan seperti HUT Sekolah, MPLS, Ujian Sekolah, atau Pelepasan Siswa (Ekuivalensi 1 Jam Tatap Muka/minggu)',
    45, 0, 0, 512, 1, datetime('now')
),
(
    'cat_tt_organisasi_profesi', 'pengurus_organisasi_profesi', 'TUGAS_TAMBAHAN', 'Melaksanakan Tugas Tambahan',
    'Tugas Tambahan: Pengurus Organisasi Profesi Pendidik (PGRI / IGI)', 'Kepengurusan aktif organisasi profesi guru di tingkat nasional (3 JP), provinsi (2 JP), atau kabupaten/kota (1 JP)',
    45, 0, 0, 513, 1, datetime('now')
),
(
    'cat_mgmp', 'koordinator_mgmp', 'TUGAS_TAMBAHAN', 'Melaksanakan Tugas Tambahan',
    'Tugas Tambahan: Koordinator MGMP Kabupaten / Gugus', 'Mengoordinasikan kegiatan musyawarah guru mata pelajaran untuk peningkatan mutu pembelajaran (Ekuivalensi 1 Jam Tatap Muka/minggu)',
    45, 0, 0, 514, 1, datetime('now')
),
(
    'cat_tt_narasumber', 'narasumber_pelatihan', 'TUGAS_TAMBAHAN', 'Melaksanakan Tugas Tambahan',
    'Tugas Tambahan: Instruktur / Narasumber / Fasilitator Nasional', 'Menjadi narasumber/fasilitator program pengembangan kompetensi tingkat nasional bidang pendidikan (Ekuivalensi 1 Jam Tatap Muka/minggu)',
    45, 0, 0, 515, 1, datetime('now')
),
(
    'cat_tt_peserta_pelatihan', 'peserta_pkb_kombel', 'TUGAS_TAMBAHAN', 'Melaksanakan Tugas Tambahan',
    'Peserta Program PKB Terstruktur / Komunitas Belajar (Kombel)', 'Mengikuti pelatihan terstruktur atau kegiatan berbagi praktik baik di Komunitas Belajar sekolah/MGMP (Ekuivalensi 1 Jam Tatap Muka/minggu)',
    45, 0, 0, 516, 1, datetime('now')
),
(
    'cat_upacara', 'upacara_apel', 'TUGAS_TAMBAHAN', 'Melaksanakan Tugas Tambahan',
    'Upacara Bendera Hari Senin & Apel Pembinaan Karakter', 'Mengikuti upacara bendera mingguan hari Senin, pembina upacara, dan apel pagi pembinaan karakter bersama seluruh siswa dan guru',
    45, 0, 0, 517, 1, datetime('now')
),
(
    'cat_tt_dinas', 'tugas_kedinasan_pimpinan', 'TUGAS_TAMBAHAN', 'Melaksanakan Tugas Tambahan',
    'Tugas Kedinasan / Penugasan Khusus dari Pimpinan (Pasal 19)', 'Penugasan kedinasan di bidang pendidikan yang diberikan oleh Kepala Dinas Pendidikan atau Kepala Sekolah yang diakui dalam pemenuhan beban kerja 37,5 jam/minggu',
    45, 0, 0, 518, 1, datetime('now')
)
ON CONFLICT(id) DO UPDATE SET
    code = excluded.code,
    category_code = excluded.category_code,
    category_name = excluded.category_name,
    name = excluded.name,
    description = excluded.description,
    default_duration_minutes = excluded.default_duration_minutes,
    is_teaching = excluded.is_teaching,
    requires_evidence = excluded.requires_evidence,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active;

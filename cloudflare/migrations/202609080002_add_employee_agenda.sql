-- ====================================================================
-- SIMAS SMAGESA - MIGRATION: MODUL AGENDA PEGAWAI & PENUGASAN SK
-- Migration File: 202609080002_add_employee_agenda.sql
-- ====================================================================

-- 1. Master SK Penugasan Pegawai
CREATE TABLE IF NOT EXISTS employee_sk (
    id TEXT PRIMARY KEY,
    nomor_sk TEXT NOT NULL,
    judul TEXT NOT NULL,
    tanggal_sk TEXT NOT NULL,
    tahun_anggaran INTEGER NOT NULL,
    pejabat_penetap TEXT NOT NULL,
    nip_pejabat TEXT NOT NULL,
    file_drive_url TEXT,
    status TEXT DEFAULT 'active',
    catatan TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_employee_sk_tahun ON employee_sk(tahun_anggaran, status);

-- 2. Kelompok Penugasan SK (9 Kelompok)
CREATE TABLE IF NOT EXISTS employee_task_groups (
    id TEXT PRIMARY KEY,
    sk_id TEXT NOT NULL,
    kode_kelompok TEXT NOT NULL,
    nama_kelompok TEXT NOT NULL,
    urutan INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (sk_id) REFERENCES employee_sk(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_groups_sk ON employee_task_groups(sk_id, urutan);

-- 3. Butir Uraian Tugas per Kelompok (10 Butir per Kelompok)
CREATE TABLE IF NOT EXISTS employee_task_items (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    kode_butir TEXT NOT NULL,
    uraian_tugas TEXT NOT NULL,
    urutan INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (group_id) REFERENCES employee_task_groups(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_items_group ON employee_task_items(group_id, urutan);

-- 4. Pemetaan Penugasan Pegawai (Assignments)
CREATE TABLE IF NOT EXISTS employee_assignments (
    id TEXT PRIMARY KEY,
    sk_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    employee_name TEXT NOT NULL,
    employee_nip TEXT,
    employee_nik TEXT,
    gtk_id TEXT,
    user_uid TEXT,
    peran_rincian TEXT,
    is_assistant INTEGER DEFAULT 0,
    custom_task_scope TEXT,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (sk_id) REFERENCES employee_sk(id),
    FOREIGN KEY (group_id) REFERENCES employee_task_groups(id)
);

CREATE INDEX IF NOT EXISTS idx_emp_asg_user_uid ON employee_assignments(user_uid, status);
CREATE INDEX IF NOT EXISTS idx_emp_asg_gtk_id ON employee_assignments(gtk_id);
CREATE INDEX IF NOT EXISTS idx_emp_asg_group ON employee_assignments(group_id);
CREATE INDEX IF NOT EXISTS idx_emp_asg_sk ON employee_assignments(sk_id);

-- 5. Realisasi Aktivitas Harian Pegawai
CREATE TABLE IF NOT EXISTS employee_activities (
    id TEXT PRIMARY KEY,
    assignment_id TEXT,
    employee_name TEXT NOT NULL,
    user_uid TEXT NOT NULL,
    tanggal TEXT NOT NULL,
    jam_mulai TEXT NOT NULL,
    jam_selesai TEXT NOT NULL,
    durasi_efektif_menit INTEGER NOT NULL,
    sumber_kegiatan TEXT NOT NULL,
    task_item_id TEXT,
    dl_surat_tugas TEXT,
    dl_lokasi TEXT,
    tambahan_dasar TEXT,
    uraian_kegiatan TEXT NOT NULL,
    hasil_output TEXT,
    bukti_url TEXT,
    status TEXT DEFAULT 'submitted',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (assignment_id) REFERENCES employee_assignments(id),
    FOREIGN KEY (task_item_id) REFERENCES employee_task_items(id)
);

CREATE INDEX IF NOT EXISTS idx_emp_act_user_tanggal ON employee_activities(user_uid, tanggal, jam_mulai);
CREATE INDEX IF NOT EXISTS idx_emp_act_tanggal ON employee_activities(tanggal);
CREATE INDEX IF NOT EXISTS idx_emp_act_sumber ON employee_activities(sumber_kegiatan);
CREATE INDEX IF NOT EXISTS idx_emp_act_assignment ON employee_activities(assignment_id);

-- 6. Log Koreksi & Jejak Audit Aktivitas Pegawai
CREATE TABLE IF NOT EXISTS employee_activity_history (
    id TEXT PRIMARY KEY,
    activity_id TEXT NOT NULL,
    action TEXT NOT NULL,
    old_data TEXT,
    new_data TEXT,
    actor_uid TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_emp_act_hist_act ON employee_activity_history(activity_id, created_at DESC);

-- ====================================================================
-- SEED DATA: SK NOMOR B.10.400.3.8./64/SMAN 1 ABANG/DIKPORA TAHUN 2026
-- ====================================================================

-- Master SK
INSERT OR IGNORE INTO employee_sk (id, nomor_sk, judul, tanggal_sk, tahun_anggaran, pejabat_penetap, nip_pejabat, status, catatan)
VALUES (
    'sk_2026_tendik',
    'B.10.400.3.8./64/SMAN 1 ABANG/DIKPORA',
    'PENUGASAN TENAGA KEPENDIDIKAN SMA NEGERI 1 ABANG TAHUN 2026',
    '2026-01-05',
    2026,
    'I PUTU SUWETA',
    '19700521 199702 1 001',
    'active',
    'Tanggal badan SK: 5 Januari 2026; Tanggal lampiran SK: 2 Januari 2026.'
);

-- 9 Kelompok Penugasan SK
INSERT OR IGNORE INTO employee_task_groups (id, sk_id, kode_kelompok, nama_kelompok, urutan) VALUES
('grp_01_keuangan', 'sk_2026_tendik', '01', 'Pengelola Keuangan', 1),
('grp_02_bmd', 'sk_2026_tendik', '02', 'Pengelola Pemanfaatan Barang Milik Daerah (BMD)', 2),
('grp_03_data', 'sk_2026_tendik', '03', 'Pengelola Data', 3),
('grp_04_kepegawaian', 'sk_2026_tendik', '04', 'Pengelola Kepegawaian', 4),
('grp_05_kesiswaan', 'sk_2026_tendik', '05', 'Pengadministrasi Kesiswaan', 5),
('grp_06_kurikulum', 'sk_2026_tendik', '06', 'Pengadministrasi Kurikulum', 6),
('grp_07_umum', 'sk_2026_tendik', '07', 'Pengadministrasi Umum', 7),
('grp_08_perpus', 'sk_2026_tendik', '08', 'Pengadministrasi Perpustakaan', 8),
('grp_09_keamanan', 'sk_2026_tendik', '09', 'Petugas Keamanan', 9);

-- 10 Butir Uraian Tugas per Kelompok (90 Butir Tugas Lengkap)
INSERT OR IGNORE INTO employee_task_items (id, group_id, kode_butir, uraian_tugas, urutan) VALUES
-- 1. Pengelola Keuangan
('task_01_a', 'grp_01_keuangan', 'a', 'Menyusun perencanaan keuangan sekolah bersama tim manajemen sekolah', 1),
('task_01_b', 'grp_01_keuangan', 'b', 'Mengelola anggaran sekolah sesuai RKAS dan ketentuan yang berlaku', 2),
('task_01_c', 'grp_01_keuangan', 'c', 'Melaksanakan administrasi keuangan sekolah secara tertib, transparan, dan akuntabel', 3),
('task_01_d', 'grp_01_keuangan', 'd', 'Melakukan pencatatan seluruh transaksi penerimaan dan pengeluaran keuangan', 4),
('task_01_e', 'grp_01_keuangan', 'e', 'Menyusun laporan keuangan sekolah secara berkala dan incidental', 5),
('task_01_f', 'grp_01_keuangan', 'f', 'Mengelola dana BOS/BOP/sumber dana lain sesuai regulasi', 6),
('task_01_g', 'grp_01_keuangan', 'g', 'Menyiapkan dokumen pertanggungjawaban keuangan', 7),
('task_01_h', 'grp_01_keuangan', 'h', 'Menyimpan dan mengarsipkan dokumen keuangan', 8),
('task_01_i', 'grp_01_keuangan', 'i', 'Mendukung pelaksanaan program peningkatan mutu pembelajaran melalui pengelolaan keuangan yang efektif', 9),
('task_01_j', 'grp_01_keuangan', 'j', 'Melaksanakan tugas lain yang diberikan kepala sekolah sesuai bidangnya', 10),

-- 2. Pengelola Pemanfaatan BMD
('task_02_a', 'grp_02_bmd', 'a', 'Melakukan inventarisasi barang milik daerah di lingkungan sekolah', 1),
('task_02_b', 'grp_02_bmd', 'b', 'Mengelola data aset sekolah secara tertib dan sistematis', 2),
('task_02_c', 'grp_02_bmd', 'c', 'Mengatur pemanfaatan sarana dan prasarana sekolah', 3),
('task_02_d', 'grp_02_bmd', 'd', 'Menyusun laporan penggunaan dan kondisi barang milik daerah', 4),
('task_02_e', 'grp_02_bmd', 'e', 'Melaksanakan pencatatan mutasi barang', 5),
('task_02_f', 'grp_02_bmd', 'f', 'Mengawasi penggunaan aset sekolah agar sesuai fungsi', 6),
('task_02_g', 'grp_02_bmd', 'g', 'Menjaga keamanan dan kelayakan barang milik daerah', 7),
('task_02_h', 'grp_02_bmd', 'h', 'Berkoordinasi dengan pihak terkait dalam pengelolaan asset', 8),
('task_02_i', 'grp_02_bmd', 'i', 'Mendukung kelancaran kegiatan pembelajaran melalui pengelolaan sarpras', 9),
('task_02_j', 'grp_02_bmd', 'j', 'Melaksanakan tugas lain yang diberikan kepala sekolah', 10),

-- 3. Pengelola Data
('task_03_a', 'grp_03_data', 'a', 'Mengelola data pokok pendidikan sekolah', 1),
('task_03_b', 'grp_03_data', 'b', 'Melakukan input, validasi, dan pemutakhiran data secara berkala', 2),
('task_03_c', 'grp_03_data', 'c', 'Menyusun basis data sekolah yang akurat dan terintegrasi', 3),
('task_03_d', 'grp_03_data', 'd', 'Menjaga keamanan dan kerahasiaan data sekolah', 4),
('task_03_e', 'grp_03_data', 'e', 'Menyajikan data untuk kebutuhan perencanaan dan evaluasi', 5),
('task_03_f', 'grp_03_data', 'f', 'Mendukung sistem informasi manajemen sekolah', 6),
('task_03_g', 'grp_03_data', 'g', 'Menyusun laporan data pendidikan sekolah', 7),
('task_03_h', 'grp_03_data', 'h', 'Berkoordinasi dengan unit kerja terkait', 8),
('task_03_i', 'grp_03_data', 'i', 'Menjamin ketersediaan data untuk peningkatan mutu pembelajaran', 9),
('task_03_j', 'grp_03_data', 'j', 'Melaksanakan tugas lain dari kepala sekolah', 10),

-- 4. Pengelola Kepegawaian
('task_04_a', 'grp_04_kepegawaian', 'a', 'Mengelola administrasi kepegawaian guru dan tenaga kependidikan', 1),
('task_04_b', 'grp_04_kepegawaian', 'b', 'Menyusun data induk kepegawaian', 2),
('task_04_c', 'grp_04_kepegawaian', 'c', 'Mengelola arsip kepegawaian', 3),
('task_04_d', 'grp_04_kepegawaian', 'd', 'Mengelola data kehadiran dan kedisiplinan pegawai', 4),
('task_04_e', 'grp_04_kepegawaian', 'e', 'Mengelola administrasi mutasi dan penugasan', 5),
('task_04_f', 'grp_04_kepegawaian', 'f', 'Mengelola dokumen pengembangan karier dan kompetensi', 6),
('task_04_g', 'grp_04_kepegawaian', 'g', 'Menyusun laporan kepegawaian secara berkala', 7),
('task_04_h', 'grp_04_kepegawaian', 'h', 'Mendukung sistem manajemen SDM sekolah', 8),
('task_04_i', 'grp_04_kepegawaian', 'i', 'Menjamin tertib administrasi kepegawaian', 9),
('task_04_j', 'grp_04_kepegawaian', 'j', 'Melaksanakan tugas lain dari kepala sekolah', 10),

-- 5. Pengadministrasi Kesiswaan
('task_05_a', 'grp_05_kesiswaan', 'a', 'Mengelola administrasi murid', 1),
('task_05_b', 'grp_05_kesiswaan', 'b', 'Mengelola data penerimaan murid baru', 2),
('task_05_c', 'grp_05_kesiswaan', 'c', 'Mengelola administrasi mutasi murid', 3),
('task_05_d', 'grp_05_kesiswaan', 'd', 'Mengelola data kehadiran murid', 4),
('task_05_e', 'grp_05_kesiswaan', 'e', 'Mengelola arsip kesiswaan', 5),
('task_05_f', 'grp_05_kesiswaan', 'f', 'Menyusun laporan kesiswaan', 6),
('task_05_g', 'grp_05_kesiswaan', 'g', 'Mendukung layanan murid', 7),
('task_05_h', 'grp_05_kesiswaan', 'h', 'Mendukung pelaksanaan program kesiswaan', 8),
('task_05_i', 'grp_05_kesiswaan', 'i', 'Mendukung kegiatan pembinaan karakter murid', 9),
('task_05_j', 'grp_05_kesiswaan', 'j', 'Melaksanakan tugas lain dari kepala sekolah', 10),

-- 6. Pengadministrasi Kurikulum
('task_06_a', 'grp_06_kurikulum', 'a', 'Mengelola administrasi kurikulum sekolah', 1),
('task_06_b', 'grp_06_kurikulum', 'b', 'Mengelola dokumen KOSP', 2),
('task_06_c', 'grp_06_kurikulum', 'c', 'Mengelola jadwal pembelajaran', 3),
('task_06_d', 'grp_06_kurikulum', 'd', 'Mengelola pembagian tugas mengajar guru', 4),
('task_06_e', 'grp_06_kurikulum', 'e', 'Mengelola administrasi asesmen', 5),
('task_06_f', 'grp_06_kurikulum', 'f', 'Mengelola arsip kurikulum', 6),
('task_06_g', 'grp_06_kurikulum', 'g', 'Menyusun laporan bidang kurikulum', 7),
('task_06_i', 'grp_06_kurikulum', 'h', 'Mendukung implementasi pembelajaran', 8),
('task_06_h', 'grp_06_kurikulum', 'i', 'Mendukung pelaksanaan Kokurikuler', 9),
('task_06_j', 'grp_06_kurikulum', 'j', 'Melaksanakan tugas lain dari kepala sekolah', 10),

-- 7. Pengadministrasi Umum
('task_07_a', 'grp_07_umum', 'a', 'Mengelola administrasi umum sekolah', 1),
('task_07_b', 'grp_07_umum', 'b', 'Mengelola surat-menyurat sekolah', 2),
('task_07_c', 'grp_07_umum', 'c', 'Mengelola arsip dan dokumen sekolah', 3),
('task_07_d', 'grp_07_umum', 'd', 'Mengelola buku agenda dan ekspedisi', 4),
('task_07_e', 'grp_07_umum', 'e', 'Mengelola layanan administrasi harian', 5),
('task_07_f', 'grp_07_umum', 'f', 'Menyiapkan dokumen rapat dan kegiatan sekolah', 6),
('task_07_g', 'grp_07_umum', 'g', 'Mendukung kegiatan manajemen sekolah', 7),
('task_07_h', 'grp_07_umum', 'h', 'Menjaga tertib administrasi umum', 8),
('task_07_i', 'grp_07_umum', 'i', 'Mendukung pelayanan publik sekolah', 9),
('task_07_j', 'grp_07_umum', 'j', 'Melaksanakan tugas lain dari kepala sekolah', 10),

-- 8. Pengadministrasi Perpustakaan
('task_08_a', 'grp_08_perpus', 'a', 'Mengelola administrasi perpustakaan sekolah', 1),
('task_08_b', 'grp_08_perpus', 'b', 'Mengelola koleksi buku dan bahan pustaka', 2),
('task_08_c', 'grp_08_perpus', 'c', 'Mengelola layanan peminjaman dan pengembalian buku', 3),
('task_08_d', 'grp_08_perpus', 'd', 'Mengelola katalog dan sistem informasi perpustakaan', 4),
('task_08_e', 'grp_08_perpus', 'e', 'Mengelola arsip perpustakaan', 5),
('task_08_f', 'grp_08_perpus', 'f', 'Mendukung program literasi sekolah', 6),
('task_08_g', 'grp_08_perpus', 'g', 'Menyusun laporan perpustakaan', 7),
('task_08_h', 'grp_08_perpus', 'h', 'Menjaga ketertiban dan kenyamanan perpustakaan', 8),
('task_08_i', 'grp_08_perpus', 'i', 'Mendukung pembelajaran berbasis literasi', 9),
('task_08_j', 'grp_08_perpus', 'j', 'Melaksanakan tugas lain dari kepala sekolah', 10),

-- 9. Petugas Keamanan
('task_09_a', 'grp_09_keamanan', 'a', 'Menjaga keamanan lingkungan sekolah', 1),
('task_09_b', 'grp_09_keamanan', 'b', 'Mengatur ketertiban keluar-masuk lingkungan sekolah', 2),
('task_09_c', 'grp_09_keamanan', 'c', 'Melakukan pengawasan area sekolah', 3),
('task_09_d', 'grp_09_keamanan', 'd', 'Melaksanakan patroli keamanan', 4),
('task_09_e', 'grp_09_keamanan', 'e', 'Menjaga aset dan sarana prasarana sekolah', 5),
('task_09_f', 'grp_09_keamanan', 'f', 'Mengantisipasi gangguan keamanan', 6),
('task_09_g', 'grp_09_keamanan', 'g', 'Berkoordinasi dengan pihak terkait dalam penanganan keamanan', 7),
('task_09_h', 'grp_09_keamanan', 'h', 'Mendukung terciptanya lingkungan belajar yang aman dan kondusif', 8),
('task_09_i', 'grp_09_keamanan', 'i', 'Melaksanakan pelaporan kejadian keamanan', 9),
('task_09_j', 'grp_09_keamanan', 'j', 'Melaksanakan tugas lain dari kepala sekolah', 10);

-- Seeding Pemetaan 17 Pegawai Lampiran SK
INSERT OR IGNORE INTO employee_assignments (id, sk_id, group_id, employee_name, employee_nip, peran_rincian, is_assistant, status) VALUES
('asg_2026_mudita', 'sk_2026_tendik', 'grp_01_keuangan', 'I Wayan Mudita, A.Md., Kom.', '199108152020121006', 'Bendahara BOS', 0, 'active'),
('asg_2026_indra', 'sk_2026_tendik', 'grp_01_keuangan', 'I Kadek Indra Surya Arta, S.H.', '199504142025211001', 'Pembantu Bendahara Gaji', 1, 'active'),
('asg_2026_maysa', 'sk_2026_tendik', 'grp_01_keuangan', 'K. Agus Maysa Upadana, S.E', NULL, 'Pembantu Bendahara Komite', 1, 'active'),
('asg_2026_wiradnyana', 'sk_2026_tendik', 'grp_01_keuangan', 'I Kadek Wiradnyana, S.Ak.', NULL, 'Pembantu Bendahara Komite', 1, 'active'),
('asg_2026_sulidra', 'sk_2026_tendik', 'grp_02_bmd', 'I Made Sulidra, S.E.', '197503012025211003', 'Pengelola Pemanfaatan BMD', 0, 'active'),
('asg_2026_katon', 'sk_2026_tendik', 'grp_03_data', 'I Kadek Katon Agustina', '200008142025211001', 'Pengelola Data', 0, 'active'),
('asg_2026_wiratama', 'sk_2026_tendik', 'grp_03_data', 'I Gede Wiratama', NULL, 'Pembantu Pengelola Data', 1, 'active'),
('asg_2026_pandu', 'sk_2026_tendik', 'grp_04_kepegawaian', 'I Komang Pandu Tanaya, S.H.', '199505232025211081', 'Pengelola Kepegawaian', 0, 'active'),
('asg_2026_edi', 'sk_2026_tendik', 'grp_04_kepegawaian', 'I Made Edi Putrawan, S.Kom.', NULL, 'Pembantu Pengelola Kepegawaian', 1, 'active'),
('asg_2026_yudiasa', 'sk_2026_tendik', 'grp_05_kesiswaan', 'I Gede Yudiasa', '199901292025211054', 'Pengadministrasi Kesiswaan', 0, 'active'),
('asg_2026_ogie', 'sk_2026_tendik', 'grp_05_kesiswaan', 'Kadek Ogie Surya Martha, S.H.', NULL, 'Pembantu Pengadministrasi Kesiswaan', 1, 'active'),
('asg_2026_betit', 'sk_2026_tendik', 'grp_06_kurikulum', 'I Kadek Betit Pranata Suma, S.H.', NULL, 'Pengadministrasi Kurikulum', 0, 'active'),
('asg_2026_dwi', 'sk_2026_tendik', 'grp_06_kurikulum', 'I Komang Dwi Permana Putra', NULL, 'Pengadministrasi Kurikulum', 0, 'active'),
('asg_2026_lilik', 'sk_2026_tendik', 'grp_07_umum', 'Ni Ketut Lilik Juliawati', '199307072025212028', 'Pengadministrasi Umum', 0, 'active'),
('asg_2026_yudika', 'sk_2026_tendik', 'grp_08_perpus', 'I Made Yudika Ade Bawa', '199212142025211002', 'Pengadministrasi Perpustakaan', 0, 'active'),
('asg_2026_nuria', 'sk_2026_tendik', 'grp_09_keamanan', 'I Ketut Nuria', NULL, 'Petugas Keamanan', 0, 'active'),
('asg_2026_bagiana', 'sk_2026_tendik', 'grp_09_keamanan', 'I Wayan Bagiana', NULL, 'Petugas Keamanan', 0, 'active');

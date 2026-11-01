-- ====================================================================
-- SIMAS SMAGESA - CLOUDFLARE D1 DATABASE SCHEMA
-- Pilot Project: Modul Agenda Sekolah & Dokumen Kegiatan
-- ====================================================================

-- 1. Tabel Calendar Events (Agenda Kegiatan Sekolah)
CREATE TABLE IF NOT EXISTS calendar_events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    date TEXT NOT NULL,           -- Format YYYY-MM-DD
    time TEXT,                    -- Contoh '08:00 - 10:00' atau '08:00'
    location TEXT,
    category TEXT DEFAULT 'umum', -- umum, akademik, kesiswaan, dinas, rapat
    description TEXT,
    color TEXT DEFAULT 'blue',    -- blue, emerald, amber, rose, purple, indigo
    created_by TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_date ON calendar_events(date);
CREATE INDEX IF NOT EXISTS idx_events_category ON calendar_events(category);

-- 2. Tabel Agenda Documents (Arsip & Panduan Google Drive)
CREATE TABLE IF NOT EXISTS agenda_documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT DEFAULT 'umum', -- kalender_pendidikan, juknis, surat_edaran, sk, panduan, umum
    drive_url TEXT NOT NULL,
    file_type TEXT DEFAULT 'pdf', -- pdf, doc, sheet, slide, link
    description TEXT,
    is_archived INTEGER DEFAULT 0,
    uploaded_by TEXT NOT NULL,
    uploader_name TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_docs_category ON agenda_documents(category);
CREATE INDEX IF NOT EXISTS idx_docs_archived ON agenda_documents(is_archived);

-- 3 & 4. Telemetri & Log Audit (login_history & audit_logs)
-- [SSOT SUPABASE] Tabel login_history dan audit_logs kini dikelola 100% secara Single Source of Truth
-- di Supabase PostgreSQL untuk melindungi kuota penulisan baris harian (rows_written) Cloudflare D1.
-- Lihat skema DDL di: supabase/migrations/202610060001_create_telemetry_tables.sql

-- 5. Tabel Students (Master Data Siswa & Profil Dapodik)
CREATE TABLE IF NOT EXISTS students (
    nis TEXT PRIMARY KEY,
    nisn TEXT,
    name TEXT NOT NULL,
    gender TEXT,                  -- 'L' atau 'P'
    class TEXT,                   -- Contoh 'X.1', 'XI.2', 'XII.3'
    birth_place TEXT,
    birth_date TEXT,              -- Format YYYY-MM-DD
    nik TEXT,
    status TEXT DEFAULT 'active', -- active, mutasi, keluar, alumni
    violation_points INTEGER DEFAULT 0,
    dapodik_data TEXT,            -- Format JSON string untuk seluruh 48 atribut Dapodik
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_students_class ON students(class);
CREATE INDEX IF NOT EXISTS idx_students_status ON students(status);
CREATE INDEX IF NOT EXISTS idx_students_nisn ON students(nisn);
CREATE INDEX IF NOT EXISTS idx_students_nik ON students(nik);
CREATE INDEX IF NOT EXISTS idx_students_birth_date ON students(birth_date);
CREATE INDEX IF NOT EXISTS idx_students_name ON students(name);
CREATE INDEX IF NOT EXISTS idx_students_status_class_name ON students(status, class, name);
CREATE INDEX IF NOT EXISTS idx_students_class_status ON students(class, status);
CREATE INDEX IF NOT EXISTS idx_students_status_class ON students(status, class);
CREATE INDEX IF NOT EXISTS idx_students_class_expr_name ON students(LOWER(TRIM(class)), name ASC);

-- 5.1 Tabel Student Photos (Foto Resmi, Staging Pending, & Token Verifikasi Kartu Siswa Digital)
CREATE TABLE IF NOT EXISTS student_photos (
    nis TEXT PRIMARY KEY,
    active_photo_url TEXT,
    pending_photo_url TEXT,
    status TEXT DEFAULT 'none', -- none, pending, verified, rejected
    rejection_reason TEXT,
    public_token TEXT UNIQUE,
    uploaded_at TEXT,
    verified_at TEXT,
    verified_by_uid TEXT,
    verified_by_name TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_student_photos_token ON student_photos(public_token);
CREATE INDEX IF NOT EXISTS idx_student_photos_status ON student_photos(status);

-- 6. Tabel Violation Types (Master Jenis Pelanggaran & Poin BK)
CREATE TABLE IF NOT EXISTS violation_types (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT DEFAULT 'Umum', -- Pelanggaran Ringan, Pelanggaran Sedang, Pelanggaran Berat, Umum
    points INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_violation_types_code ON violation_types(code);
CREATE INDEX IF NOT EXISTS idx_violation_types_category ON violation_types(category);

-- 7. Tabel Labs (Master Ruang Laboratorium)
CREATE TABLE IF NOT EXISTS labs (
    id TEXT PRIMARY KEY,
    nama TEXT NOT NULL,
    deskripsi TEXT,
    urutan INTEGER DEFAULT 0,
    kode TEXT,
    kepala_lab_uid TEXT,        -- Legacy UID kepala lab per lab (dipertahankan untuk kompatibilitas data lama)
    kepala_lab_nama TEXT,       -- Legacy nama kepala lab
    koordinator_uid TEXT,       -- UID akun guru yang ditugaskan sebagai koordinator lab ini
    koordinator_nama TEXT,      -- Nama guru yang ditugaskan sebagai koordinator lab ini
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_labs_urutan ON labs(urutan);
CREATE INDEX IF NOT EXISTS idx_labs_koordinator ON labs(koordinator_uid);

-- 8. Tabel Lab Bookings (Pengajuan & Jadwal Peminjaman Lab)
CREATE TABLE IF NOT EXISTS lab_bookings (
    id TEXT PRIMARY KEY,
    lab_id TEXT NOT NULL,
    lab_nama TEXT,
    tanggal TEXT NOT NULL,       -- Format YYYY-MM-DD
    jam_mulai INTEGER NOT NULL,  -- JP Mulai (1-10)
    jam_selesai INTEGER NOT NULL,-- JP Selesai (1-10)
    kelas TEXT NOT NULL,
    kegiatan TEXT NOT NULL,
    catatan TEXT,
    pemohon_uid TEXT NOT NULL,
    pemohon_nama TEXT,
    status TEXT DEFAULT 'pending', -- pending, approved, rejected, conflict, auto_rejected
    alasan_penolakan TEXT,
    diajukan_pada TEXT DEFAULT (datetime('now')),
    diproses_pada TEXT,
    diproses_oleh TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lab_bookings_tanggal ON lab_bookings(tanggal);
CREATE INDEX IF NOT EXISTS idx_lab_bookings_lab_id ON lab_bookings(lab_id);
CREATE INDEX IF NOT EXISTS idx_lab_bookings_status ON lab_bookings(status);
CREATE INDEX IF NOT EXISTS idx_lab_bookings_pemohon_uid ON lab_bookings(pemohon_uid);

-- 8b. Tabel Master Kategori Barang Inventaris Lab (inventory_categories)
CREATE TABLE IF NOT EXISTS inventory_categories (
    id TEXT PRIMARY KEY,
    lab_id TEXT NOT NULL,
    name TEXT NOT NULL,
    code TEXT NOT NULL,           -- Short code untuk kode inventaris (misal: OPT, PC, ALAT)
    is_active INTEGER DEFAULT 1,  -- 1: Aktif, 0: Dinonaktifkan
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (lab_id) REFERENCES labs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_inv_cat_lab ON inventory_categories(lab_id, is_active);
CREATE INDEX IF NOT EXISTS idx_inv_cat_code ON inventory_categories(code);

-- 8c. Tabel Master Lokasi Penyimpanan Barang Lab (inventory_locations)
CREATE TABLE IF NOT EXISTS inventory_locations (
    id TEXT PRIMARY KEY,
    lab_id TEXT NOT NULL,
    name TEXT NOT NULL,           -- Misal: Lemari Mikroskop, Rak Alat Fisika 1, Gudang
    is_active INTEGER DEFAULT 1,  -- 1: Aktif, 0: Dinonaktifkan
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (lab_id) REFERENCES labs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_inv_loc_lab ON inventory_locations(lab_id, is_active);

-- 8d. Tabel Data Barang Inventaris Lab (inventory_items)
CREATE TABLE IF NOT EXISTS inventory_items (
    id TEXT PRIMARY KEY,
    inventory_code TEXT NOT NULL UNIQUE, -- Format: LAB-{KODE_LAB}-{KODE_KAT}-{TAHUN}-{SEQ:001}
    lab_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    name TEXT NOT NULL,
    specification TEXT DEFAULT '',
    location_id TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'Unit',   -- Unit, Set, Pcs, Buah, Pasang
    qty_good INTEGER NOT NULL DEFAULT 0,
    qty_minor_damage INTEGER NOT NULL DEFAULT 0,
    qty_major_damage INTEGER NOT NULL DEFAULT 0,
    qty_total INTEGER NOT NULL DEFAULT 0,
    acquisition_year INTEGER NOT NULL,
    funding_source TEXT DEFAULT 'BOS Reguler',
    notes TEXT DEFAULT '',
    created_by TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (lab_id) REFERENCES labs(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES inventory_categories(id),
    FOREIGN KEY (location_id) REFERENCES inventory_locations(id)
);

CREATE INDEX IF NOT EXISTS idx_inv_items_lab ON inventory_items(lab_id);
CREATE INDEX IF NOT EXISTS idx_inv_items_category ON inventory_items(category_id);
CREATE INDEX IF NOT EXISTS idx_inv_items_location ON inventory_items(location_id);
CREATE INDEX IF NOT EXISTS idx_inv_items_code ON inventory_items(inventory_code);
CREATE INDEX IF NOT EXISTS idx_inv_items_year ON inventory_items(acquisition_year);

-- 8e. Tabel Riwayat Mutasi Kondisi Barang (inventory_condition_history)
CREATE TABLE IF NOT EXISTS inventory_condition_history (
    id TEXT PRIMARY KEY,
    inventory_item_id TEXT NOT NULL,
    from_condition TEXT NOT NULL, -- good, minor_damage, major_damage
    to_condition TEXT NOT NULL,   -- good, minor_damage, major_damage
    quantity INTEGER NOT NULL,
    notes TEXT DEFAULT '',
    user_id TEXT NOT NULL,
    user_name TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_inv_hist_item ON inventory_condition_history(inventory_item_id, created_at DESC);

-- 9. Registrasi perangkat FCM. Token tetap terikat setelah logout dan akan
-- dipindahkan secara atomik ketika akun berbeda login pada browser yang sama.
CREATE TABLE IF NOT EXISTS fcm_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    role TEXT DEFAULT '',
    additional_roles TEXT DEFAULT '[]',
    assigned_class TEXT DEFAULT '',
    display_name TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    telegram_chat_id TEXT DEFAULT '',
    device_type TEXT DEFAULT 'unknown',
    user_agent TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fcm_tokens_user_id ON fcm_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_fcm_tokens_role ON fcm_tokens(role);
CREATE INDEX IF NOT EXISTS idx_fcm_tokens_assigned_class ON fcm_tokens(assigned_class);

-- 10. Outbox Web Push. Satu job memiliki delivery terpisah agar pengiriman
-- dapat dilanjutkan oleh Cron Worker tanpa kehilangan pesan ketika request putus.
CREATE TABLE IF NOT EXISTS notification_jobs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    url TEXT DEFAULT './dashboard.html',
    target_type TEXT NOT NULL,
    target_value TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    sent_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    created_by TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    processed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_notification_jobs_status ON notification_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_notification_jobs_type_created ON notification_jobs(target_type, created_at, target_value, id);
CREATE INDEX IF NOT EXISTS idx_notification_jobs_personal_target ON notification_jobs(target_type, target_value, created_at, id);
CREATE INDEX IF NOT EXISTS idx_notification_jobs_class_inbox ON notification_jobs(target_type, REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(target_value), 'kelas', ''), ' ', ''), '-', ''), '.', ''), '_', ''), created_at, id) WHERE target_type IN ('class', 'class_admin');

CREATE TABLE IF NOT EXISTS notification_deliveries (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    token_id TEXT NOT NULL,
    token TEXT NOT NULL,
    recipient_uid TEXT NOT NULL DEFAULT '',
    claim_id TEXT NOT NULL DEFAULT '',
    lease_until INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    status TEXT DEFAULT 'pending',
    attempts INTEGER DEFAULT 0,
    error TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    processed_at TEXT,
    is_read INTEGER NOT NULL DEFAULT 0,
    read_at TEXT DEFAULT '',
    FOREIGN KEY (job_id) REFERENCES notification_jobs(id) ON DELETE CASCADE
);


CREATE INDEX IF NOT EXISTS idx_notification_deliveries_pending ON notification_deliveries(status, created_at);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_job ON notification_deliveries(job_id, status);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_job_recipient ON notification_deliveries(job_id, recipient_uid, is_read);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_recipient_created ON notification_deliveries(recipient_uid, created_at, job_id);
CREATE INDEX IF NOT EXISTS idx_notification_delivery_due ON notification_deliveries(status, next_attempt_at, created_at);

CREATE INDEX IF NOT EXISTS idx_notification_delivery_token ON notification_deliveries(token_id, status);
CREATE INDEX IF NOT EXISTS idx_notification_claim_order ON notification_deliveries(status, created_at, id, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_notification_claim_job ON notification_deliveries(job_id, status, created_at, id, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_lease ON notification_deliveries(status, lease_until);

-- 11. Perubahan agenda diringkas oleh Cron 08:00 WITA sebelum dikirim ke staf.
CREATE TABLE IF NOT EXISTS agenda_notification_queue (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    title TEXT NOT NULL,
    change_type TEXT NOT NULL,
    processed INTEGER DEFAULT 0,
    created_by TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    processed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_agenda_notification_pending ON agenda_notification_queue(processed, created_at);

-- 12. Log kanal eksternal untuk idempotensi/cooldown WA dan Telegram.
CREATE TABLE IF NOT EXISTS notification_channel_log (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    dedupe_key TEXT NOT NULL,
    target TEXT DEFAULT '',
    status TEXT NOT NULL,
    created_by TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notification_channel_dedupe
ON notification_channel_log(channel, dedupe_key, created_at);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
    id TEXT PRIMARY KEY,
    failure_count INTEGER DEFAULT 0,
    window_started_at INTEGER NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 12. Tabel Jurnal Guru (Jurnal Mengajar Harian & Presensi KBM)
CREATE TABLE IF NOT EXISTS jurnal_guru (
    id TEXT PRIMARY KEY,
    tanggal TEXT NOT NULL,           -- Format YYYY-MM-DD
    kelas TEXT NOT NULL,             -- Contoh 'X.1', 'XI.2', 'XII.3'
    guru TEXT NOT NULL,              -- Nama lengkap guru
    uid_guru TEXT,                   -- UID akun guru di SIMAS / Firebase
    mapel TEXT NOT NULL,             -- Mata Pelajaran
    topik TEXT,                      -- Materi / Topik pembelajaran
    catatan TEXT,                    -- Catatan / Refleksi KBM
    jp TEXT,                         -- JSON array string JP, misal '[1,2]' atau '1-2'
    lokasi_mengajar TEXT,            -- Ruang / Lab / Kelas
    foto_url TEXT,                   -- URL foto Google Drive / Cloud
    ttd TEXT,                        -- Base64 Signature string
    koordinat TEXT,                  -- JSON string GPS {latitude, longitude, accuracy}
    presensi_detail TEXT,            -- JSON array string siswa tidak hadir/status kehadiran
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_jurnal_tanggal ON jurnal_guru(tanggal);
CREATE INDEX IF NOT EXISTS idx_jurnal_kelas ON jurnal_guru(kelas);
CREATE INDEX IF NOT EXISTS idx_jurnal_guru ON jurnal_guru(guru);
CREATE INDEX IF NOT EXISTS idx_jurnal_mapel ON jurnal_guru(mapel);
CREATE INDEX IF NOT EXISTS idx_jurnal_kelas_tanggal ON jurnal_guru(kelas, tanggal);
CREATE INDEX IF NOT EXISTS idx_jurnal_tgl_created ON jurnal_guru(tanggal DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jurnal_kelas_tgl_created ON jurnal_guru(kelas, tanggal DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jurnal_guru_kelas ON jurnal_guru(guru, kelas);
CREATE INDEX IF NOT EXISTS idx_jurnal_guru_mapel_kelas ON jurnal_guru(guru, mapel, kelas);
CREATE INDEX IF NOT EXISTS idx_jurnal_guru_mapel_kelas_tgl ON jurnal_guru(guru, mapel, kelas, tanggal);
CREATE INDEX IF NOT EXISTS idx_jurnal_guru_mapel_kelas_tgl_created ON jurnal_guru(guru, mapel, kelas, tanggal DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jurnal_guru_kelas_tgl_created ON jurnal_guru(guru, kelas, tanggal DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jurnal_uid_guru ON jurnal_guru(uid_guru);
CREATE INDEX IF NOT EXISTS idx_jurnal_lokasi_mengajar ON jurnal_guru(lokasi_mengajar);

-- 13. Tabel Master Mapel
CREATE TABLE IF NOT EXISTS master_mapel (
    id TEXT PRIMARY KEY,
    nama_mapel TEXT NOT NULL,
    sumber TEXT DEFAULT 'manual',    -- 'xml', 'manual', 'dapodik'
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_master_mapel_nama ON master_mapel(nama_mapel);

-- 14. Tabel Master Lokasi Pembelajaran
CREATE TABLE IF NOT EXISTS master_lokasi (
    id TEXT PRIMARY KEY,
    nama_lokasi TEXT NOT NULL,
    urutan INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_master_lokasi_urutan ON master_lokasi(urutan);

-- 15. Tabel Master GTK (Guru & Tenaga Kependidikan - Pure SSOT di Cloudflare D1)
CREATE TABLE IF NOT EXISTS gtk (
    id TEXT PRIMARY KEY,                          -- NIK (16 digit), NIP, atau ID dokumen
    nik TEXT,
    nip TEXT,
    nuptk TEXT,
    name TEXT NOT NULL,
    gender TEXT DEFAULT 'L',                      -- 'L' / 'P'
    birth_place TEXT,
    birth_date TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    jenis_ptk TEXT DEFAULT 'Pendidik',            -- 'Guru Mapel', 'Guru BK', 'Kepala Sekolah', 'Tenaga Kependidikan', dll.
    status_kepegawaian TEXT DEFAULT 'Honorer',    -- 'PNS', 'PPPK', 'GTT', 'PTT', 'Honorer'
    pendidikan_terakhir TEXT,
    mapel TEXT,
    role TEXT DEFAULT 'guru_mapel',
    telegram_chat_id TEXT,
    notes TEXT,
    foto TEXT,                                   -- URL pasfoto profil resmi GTK di Cloudflare R2 (/api/photos/gtk/...)
    status TEXT DEFAULT 'active',                -- 'active' / 'inactive' / 'pensiun' / 'mutasi'
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gtk_nik ON gtk(nik);
CREATE INDEX IF NOT EXISTS idx_gtk_nip ON gtk(nip);
CREATE INDEX IF NOT EXISTS idx_gtk_nuptk ON gtk(nuptk);
CREATE INDEX IF NOT EXISTS idx_gtk_name ON gtk(name);
CREATE INDEX IF NOT EXISTS idx_gtk_email ON gtk(email);
CREATE INDEX IF NOT EXISTS idx_gtk_status ON gtk(status);
CREATE INDEX IF NOT EXISTS idx_gtk_status_name ON gtk(status, name);

-- 16. Tabel System Settings (Key-Value Store untuk Konfigurasi & Motivasi)
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,             -- Plain string atau JSON serialized
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 17. Tabel Rapor Scores (Nilai Teori & Praktik Siswa Kelas XII)
CREATE TABLE IF NOT EXISTS rapor_scores (
    id TEXT PRIMARY KEY,          -- Format: {kelas}_{nis}_{tahun_ajaran} misal 'XII.1_12345_2026-2027'
    nis TEXT NOT NULL,
    name TEXT NOT NULL,
    class TEXT NOT NULL,
    tahun_ajaran TEXT NOT NULL,
    scores_teori TEXT DEFAULT '{}',       -- JSON string mapel -> score
    scores_praktik TEXT DEFAULT '{}',     -- JSON string mapel -> score
    teacher_info_teori TEXT DEFAULT '{}', -- JSON string mapel -> { uid, name, updated_at }
    teacher_info_praktik TEXT DEFAULT '{}', -- JSON string mapel -> { uid, name, updated_at }
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 18. Tabel PID Games (Katalog Game Edukatif)
CREATE TABLE IF NOT EXISTS pid_games (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL,          -- JSON array string misal '["kreativitas"]' atau string 'kreativitas'
    subject TEXT,                    -- Mata pelajaran terkait
    url TEXT NOT NULL,
    thumbnail_url TEXT,
    author TEXT,
    theme TEXT,                      -- JSON string tema visual AI misal '{"bg_gradient":"...","pattern_style":"..."}'
    is_active INTEGER DEFAULT 1,     -- 1: aktif, 0: nonaktif/arsip
    review_status TEXT DEFAULT 'approved', -- 'pending', 'approved', 'rejected'
    review_note TEXT,
    submitted_by_uid TEXT,
    submitted_by_name TEXT,
    submitted_by_role TEXT,
    submitted_at TEXT,
    reviewed_by_uid TEXT,
    reviewed_by_name TEXT,
    reviewed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pid_games_active ON pid_games(is_active, review_status);
CREATE INDEX IF NOT EXISTS idx_pid_games_category ON pid_games(category);
CREATE INDEX IF NOT EXISTS idx_pid_games_created ON pid_games(created_at);

-- 19. Tabel Peminatan Config (Bank Soal, Bobot, Layout, Status Kuesioner)
CREATE TABLE IF NOT EXISTS peminatan_config (
    id TEXT PRIMARY KEY,             -- Default 'questions'
    is_active INTEGER DEFAULT 1,     -- 1: Buka, 0: Tutup
    layout TEXT DEFAULT 'classic',   -- 'classic' atau 'wizard'
    items TEXT NOT NULL,             -- JSON array bank soal kuesioner
    weights TEXT,                    -- JSON object bobot aspek
    updated_by TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 20. Tabel Peminatan Responses (Respon Kuesioner Siswa per Tahun)
CREATE TABLE IF NOT EXISTS peminatan_responses (
    id TEXT PRIMARY KEY,             -- Format '${year}_${nis}' misal '2026_0968'
    year TEXT NOT NULL,              -- Tahun kalender kuesioner misal '2026'
    ta TEXT,                         -- Tahun Ajaran misal '2025/2026'
    nis TEXT NOT NULL,
    name TEXT NOT NULL,
    class TEXT,
    recommendation TEXT,             -- Hasil rekomendasi misal 'IPA', 'IPS', 'Bahasa'
    scores TEXT NOT NULL,            -- JSON object skor per aspek & total
    responses TEXT NOT NULL,         -- JSON object jawaban per butir soal
    submitted_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_peminatan_year_nis ON peminatan_responses(year, nis);
CREATE INDEX IF NOT EXISTS idx_peminatan_nis ON peminatan_responses(nis);
CREATE INDEX IF NOT EXISTS idx_peminatan_class ON peminatan_responses(class);
CREATE INDEX IF NOT EXISTS idx_peminatan_recommendation ON peminatan_responses(recommendation);
CREATE INDEX IF NOT EXISTS idx_peminatan_year ON peminatan_responses(year);

-- 21. Tabel Records (Pelanggaran, Prestasi, Permisi Siswa)
CREATE TABLE IF NOT EXISTS records (
    id TEXT PRIMARY KEY,
    student_nis TEXT NOT NULL,
    student_name TEXT,
    student_class TEXT,
    category TEXT NOT NULL,       -- 'Pelanggaran' | 'Prestasi' | 'Permisi'
    type TEXT,                    -- Jenis/Pasal Pelanggaran, Tingkat Prestasi, atau Detail Permisi
    points INTEGER DEFAULT 0,
    desc TEXT,
    reporter_uid TEXT,
    reporter_name TEXT,
    date TEXT NOT NULL,           -- Format 'YYYY-MM-DD'
    timestamp TEXT NOT NULL,       -- Format ISO 8601 string
    photo_url TEXT,
    competition_name TEXT,
    organizer TEXT,
    level TEXT,
    field TEXT,
    rank TEXT,
    participation_type TEXT DEFAULT 'Individu',
    team_name TEXT,
    mentor_name TEXT,
    certificate_no TEXT,
    evidence_url TEXT,
    status TEXT DEFAULT 'active',
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_by TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_records_student_nis ON records(student_nis);
CREATE INDEX IF NOT EXISTS idx_records_category ON records(category);
CREATE INDEX IF NOT EXISTS idx_records_date ON records(date);
CREATE INDEX IF NOT EXISTS idx_records_timestamp ON records(timestamp);
CREATE INDEX IF NOT EXISTS idx_records_student_category ON records(student_nis, category);
CREATE INDEX IF NOT EXISTS idx_records_created_at ON records(created_at);
CREATE INDEX IF NOT EXISTS idx_records_field ON records(field);
CREATE INDEX IF NOT EXISTS idx_records_level ON records(level);
CREATE INDEX IF NOT EXISTS idx_records_rank ON records(rank);
CREATE INDEX IF NOT EXISTS idx_records_competition ON records(competition_name);
CREATE INDEX IF NOT EXISTS idx_records_cat_stat_date_ts ON records(category, status, date, timestamp);
CREATE INDEX IF NOT EXISTS idx_records_stat_date ON records(status, date);
CREATE INDEX IF NOT EXISTS idx_records_active_cat_date_ts ON records(category, date DESC, timestamp DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_records_active_class_cat_date ON records(student_class, category, date DESC, timestamp DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_records_active_date_cat ON records(date, category) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_records_active_nis_ts ON records(student_nis, timestamp DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_records_active_ts ON records(timestamp DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_records_active_cat_ts ON records(category, timestamp DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_records_active_class_ts ON records(student_class, timestamp DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_records_active_class_cat_ts ON records(student_class, category, timestamp DESC) WHERE status = 'active';

-- 22. Tabel Student Aggregates (Agregat Poin & Statistik Kedisiplinan Siswa)
CREATE TABLE IF NOT EXISTS student_aggregates (
    student_nis TEXT PRIMARY KEY,
    points INTEGER DEFAULT 0,
    violation_count INTEGER DEFAULT 0,
    achievement_count INTEGER DEFAULT 0,
    permission_count INTEGER DEFAULT 0,
    last_record_at TEXT,
    last_updated TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_student_aggregates_points ON student_aggregates(points);

-- 23. Tabel BK Actions (Layanan Kasus BK & Timeline Follow-up)
CREATE TABLE IF NOT EXISTS bk_actions (
    id TEXT PRIMARY KEY,
    student_nis TEXT NOT NULL,
    student_name TEXT,
    student_class TEXT,
    problem TEXT,                 -- Deskripsi Masalah/Kasus Siswa
    bimbingan_type TEXT DEFAULT 'Pribadi', -- 'Pribadi' | 'Sosial' | 'Belajar' | 'Karir'
    service_type TEXT,            -- 'Konseling Individu' | 'Panggilan Orang Tua' | 'Bimbingan Kelompok' | 'Home Visit' | 'Konferensi Kasus' | 'Alih Tangan Kasus'
    date TEXT NOT NULL,           -- 'YYYY-MM-DD' (Tanggal kasus / tanggal follow-up terakhir)
    status TEXT DEFAULT 'Dalam Pantauan', -- 'Dalam Pantauan' | 'Selesai'
    notes TEXT,
    counselor_name TEXT,
    counselor_uid TEXT,
    follow_up_history TEXT DEFAULT '[]', -- JSON Array: [ { bimbinganType, serviceType, date, notes, counselorName, timestamp } ]
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bk_actions_student_nis ON bk_actions(student_nis);
CREATE INDEX IF NOT EXISTS idx_bk_actions_status ON bk_actions(status);
CREATE INDEX IF NOT EXISTS idx_bk_actions_date ON bk_actions(date);
CREATE INDEX IF NOT EXISTS idx_bk_actions_created_at ON bk_actions(created_at);

-- 24. Tabel Guru Wali Assignments (Penugasan Guru Wali ↔ Siswa Binaan)
CREATE TABLE IF NOT EXISTS guru_wali_assignments (
    id TEXT PRIMARY KEY,             -- Format: {guru_uid}_{student_nis}
    guru_uid TEXT NOT NULL,
    guru_name TEXT NOT NULL,
    guru_nip TEXT DEFAULT '',
    student_nis TEXT NOT NULL,
    student_name TEXT NOT NULL,
    student_class TEXT NOT NULL,
    academic_year TEXT NOT NULL,     -- Contoh: '2026/2027'
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_guru_wali_assign_guru ON guru_wali_assignments(guru_uid, academic_year);
CREATE INDEX IF NOT EXISTS idx_guru_wali_assign_student ON guru_wali_assignments(student_nis);
CREATE INDEX IF NOT EXISTS idx_guru_wali_assign_class ON guru_wali_assignments(student_class);
CREATE INDEX IF NOT EXISTS idx_guru_wali_class_name ON guru_wali_assignments(student_class ASC, student_name ASC);

-- 25. Tabel Guru Wali Notes (Catatan Pembinaan & Mentoring Guru Wali)
CREATE TABLE IF NOT EXISTS guru_wali_notes (
    id TEXT PRIMARY KEY,             -- UUID
    guru_uid TEXT NOT NULL,
    guru_name TEXT NOT NULL,
    student_nis TEXT NOT NULL,
    student_name TEXT NOT NULL,
    student_class TEXT NOT NULL,
    date TEXT NOT NULL,              -- YYYY-MM-DD
    category TEXT DEFAULT 'Umum',    -- Akademik, Karakter, Kedisiplinan, Sosial, Umum
    notes TEXT NOT NULL,
    follow_up TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_guru_wali_notes_student ON guru_wali_notes(student_nis, date);
CREATE INDEX IF NOT EXISTS idx_guru_wali_notes_guru ON guru_wali_notes(guru_uid);
CREATE INDEX IF NOT EXISTS idx_guru_wali_notes_date ON guru_wali_notes(date);

-- 26. Tabel Walikelas Notes (Catatan Narasi Rapor Wali Kelas per Semester)
CREATE TABLE IF NOT EXISTS walikelas_notes (
    id TEXT PRIMARY KEY,             -- Format: {student_nis}_{academic_year}_{semester}
    student_nis TEXT NOT NULL,
    student_name TEXT NOT NULL,
    student_class TEXT NOT NULL,
    academic_year TEXT NOT NULL,     -- Contoh: '2026/2027'
    semester TEXT NOT NULL,          -- '1' / '2' atau 'Ganjil' / 'Genap'
    notes TEXT NOT NULL,             -- Narasi Rapor Wali Kelas (termasuk hasil generate AI Gemini)
    academic_notes TEXT DEFAULT '',
    character_notes TEXT DEFAULT '',
    attendance_notes TEXT DEFAULT '',
    created_by_uid TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_walikelas_notes_lookup ON walikelas_notes(student_nis, academic_year, semester);
CREATE INDEX IF NOT EXISTS idx_walikelas_notes_class ON walikelas_notes(student_class, academic_year, semester);

-- 27. Tabel Permisi Requests (Alur Pengajuan Permisi Siswa 2 Tahap)
CREATE TABLE IF NOT EXISTS permisi_requests (
    id TEXT PRIMARY KEY,             -- UUID
    student_nis TEXT NOT NULL,
    student_name TEXT NOT NULL,
    student_class TEXT NOT NULL,
    permission_type TEXT NOT NULL,   -- Sakit, Keperluan Keluarga, Dinas/Lomba, Lainnya
    reason TEXT NOT NULL,
    date TEXT NOT NULL,              -- YYYY-MM-DD
    time_out TEXT NOT NULL,          -- Jam Keluar misal '09:30'
    time_in TEXT DEFAULT '',         -- Jam Kembali / Estimasi
    status TEXT DEFAULT 'pending_wali', -- 'pending_wali', 'wali_approved', 'wali_rejected', 'approved', 'rejected'
    wali_approved_by TEXT DEFAULT '',
    wali_approved_at TEXT DEFAULT '',
    wali_note TEXT DEFAULT '',
    piket_approved_by TEXT DEFAULT '',
    piket_approved_at TEXT DEFAULT '',
    piket_note TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_permisi_date_status ON permisi_requests(date, status);
CREATE INDEX IF NOT EXISTS idx_permisi_student ON permisi_requests(student_nis, date);
CREATE INDEX IF NOT EXISTS idx_permisi_class_date ON permisi_requests(student_class, date);


-- Annual reset recovery / idempotency
-- Additive only. Worker also creates these lazily on the protected annual-reset endpoint.
-- Operation IDs (including promotion year) remain after recovery snapshots expire.
CREATE TABLE IF NOT EXISTS annual_reset_operations (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    academic_year TEXT,
    status TEXT NOT NULL CHECK(status IN ('prepared','committed','completed')),
    actor_uid TEXT NOT NULL,
    options TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    committed_at TEXT,
    completed_at TEXT
);
CREATE TABLE IF NOT EXISTS annual_reset_snapshots (
    operation_id TEXT NOT NULL,
    table_name TEXT NOT NULL,
    row_key TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (operation_id, table_name, row_key)
) WITHOUT ROWID;

-- ====================================================================
-- MODUL LMS: TOPIK, MATERI, PROGRES SISWA & FORUM DISKUSI
-- Dilengkapi Indeks Akselerasi, Constraint Integritas & Indeks Auto-Cleanup 3 Tahun
-- ====================================================================

-- 1. Tabel Topik / Bab Pembelajaran (lms_topics)
CREATE TABLE IF NOT EXISTS lms_topics (
    id TEXT PRIMARY KEY,
    teacher_id TEXT NOT NULL,
    teacher_name TEXT NOT NULL,
    subject_name TEXT NOT NULL,
    class_name TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    order_index INTEGER DEFAULT 0,
    academic_year TEXT DEFAULT '2026/2027',
    semester TEXT DEFAULT 'Ganjil',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lms_top_teacher ON lms_topics(teacher_id);
CREATE INDEX IF NOT EXISTS idx_lms_top_class_subject ON lms_topics(class_name, subject_name);
CREATE INDEX IF NOT EXISTS idx_lms_top_created ON lms_topics(created_at);
CREATE INDEX IF NOT EXISTS idx_lms_top_class_norm_order ON lms_topics(LOWER(TRIM(class_name)), order_index, created_at);
CREATE INDEX IF NOT EXISTS idx_lms_top_class_subject_norm_order ON lms_topics(LOWER(TRIM(class_name)), LOWER(TRIM(subject_name)), order_index, created_at);

-- Modul owns the schedule/visibility; lms_materials stores its Bahan Ajar packets.
CREATE TABLE IF NOT EXISTS lms_modules (
    id TEXT PRIMARY KEY, topic_id TEXT NOT NULL REFERENCES lms_topics(id) ON DELETE CASCADE,
    teacher_id TEXT NOT NULL, teacher_name TEXT NOT NULL, subject_name TEXT NOT NULL, class_name TEXT NOT NULL,
    title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', is_visible INTEGER NOT NULL DEFAULT 1 CHECK(is_visible IN (0,1)),
    publish_at TEXT NOT NULL DEFAULT '', due_date TEXT NOT NULL DEFAULT '',
    is_teaching_completed INTEGER NOT NULL DEFAULT 0 CHECK(is_teaching_completed IN (0,1)),
    teaching_completed_at TEXT NOT NULL DEFAULT '', order_index INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 0, last_request_id TEXT NOT NULL DEFAULT '', is_deleted INTEGER NOT NULL DEFAULT 0 CHECK(is_deleted IN (0,1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lms_modules_scope ON lms_modules(class_name,subject_name,teacher_id,topic_id,order_index);
-- 2. Bahan Ajar (packet IDs are preserved for historical student work)
CREATE TABLE IF NOT EXISTS lms_materials (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL,
    teacher_id TEXT NOT NULL,
    teacher_name TEXT NOT NULL,
    subject_name TEXT NOT NULL,
    class_name TEXT NOT NULL,
    title TEXT NOT NULL,
    content_description TEXT DEFAULT '',
    resource_type TEXT DEFAULT 'gdrive', -- 'gdrive', 'youtube', 'link', 'text'
    resource_url TEXT DEFAULT '',
    quiz_payload TEXT DEFAULT '',
    module_id TEXT REFERENCES lms_modules(id),
    material_enabled INTEGER DEFAULT NULL CHECK(material_enabled IN (0,1)),
    quiz_enabled INTEGER DEFAULT NULL CHECK(quiz_enabled IN (0,1)),
    instructions TEXT NOT NULL DEFAULT '',
    is_archived INTEGER NOT NULL DEFAULT 0 CHECK(is_archived IN (0,1)),
    is_published INTEGER DEFAULT 1 CHECK (is_published IN (0, 1, 2)), -- 0: Draft, 1: Published, 2: Scheduled
    publish_at TEXT DEFAULT '',          -- Waktu rilis terjadwal (ISO 8601 / WITA)
    allow_discussion INTEGER DEFAULT 0 CHECK (allow_discussion IN (0, 1)), -- 0: Nonaktif, 1: Aktif
    discussion_prompt TEXT DEFAULT '',   -- Pertanyaan pemantik acuan diskusi
    due_date TEXT DEFAULT '',            -- Target selesai ISO UTC; legacy YYYY-MM-DD = akhir hari WITA
    minimum_read_seconds INTEGER NOT NULL DEFAULT 300,
    is_teaching_completed INTEGER DEFAULT 0 CHECK (is_teaching_completed IN (0, 1)), -- Status pembahasan guru
    teaching_completed_at TEXT DEFAULT '', -- Waktu selesai manual dari server
    order_index INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (topic_id) REFERENCES lms_topics(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lms_mat_topic ON lms_materials(topic_id);
CREATE INDEX IF NOT EXISTS idx_lms_packet_module ON lms_materials(module_id,is_archived,order_index);
CREATE INDEX IF NOT EXISTS idx_lms_mat_class_subj ON lms_materials(class_name, subject_name);
CREATE INDEX IF NOT EXISTS idx_lms_mat_teacher ON lms_materials(teacher_id);
CREATE INDEX IF NOT EXISTS idx_lms_mat_published ON lms_materials(is_published);
CREATE INDEX IF NOT EXISTS idx_lms_mat_class_published ON lms_materials(class_name, is_published, subject_name);
CREATE INDEX IF NOT EXISTS idx_lms_mat_learning_path ON lms_materials(class_name, subject_name, is_published, topic_id, order_index);
CREATE INDEX IF NOT EXISTS idx_lms_mat_created ON lms_materials(created_at);
CREATE INDEX IF NOT EXISTS idx_lms_mat_class_norm_order ON lms_materials(LOWER(TRIM(class_name)), order_index, created_at) WHERE is_published IN (1, 2) AND is_archived = 0;
CREATE INDEX IF NOT EXISTS idx_lms_mat_class_subject_norm_order ON lms_materials(LOWER(TRIM(class_name)), LOWER(TRIM(subject_name)), order_index, created_at) WHERE is_published IN (1, 2) AND is_archived = 0;

-- 3. Tabel Progres Pembelajaran Siswa (lms_progress)
CREATE TABLE IF NOT EXISTS lms_progress (
    id TEXT PRIMARY KEY,
    material_id TEXT NOT NULL,
    topic_id TEXT NOT NULL,
    student_nis TEXT NOT NULL,
    student_name TEXT NOT NULL,
    student_class TEXT NOT NULL,
    quiz_score INTEGER DEFAULT NULL,
    quiz_answers TEXT DEFAULT '',
    status TEXT DEFAULT 'opened' CHECK (status IN ('opened', 'completed')),
    first_opened_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT DEFAULT '',
    last_accessed_at TEXT DEFAULT (datetime('now')),
    active_seconds_total INTEGER DEFAULT 0, -- Total akumulasi detik belajar aktif
    session_count INTEGER DEFAULT 0,        -- Total sesi pembukaan modul
    last_session_id TEXT DEFAULT '',        -- ID sesi terakhir (idempotensi durasi)
    last_session_seconds INTEGER DEFAULT 0, -- Detik terlapor terakhir pada sesi berjalan
    late_started_at TEXT DEFAULT '',       -- Aktivitas susulan pertama
    late_cutoff_at TEXT DEFAULT '',        -- Batas tepat waktu saat susulan tercatat
    reading_completed_at TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(material_id, student_nis),
    FOREIGN KEY (material_id) REFERENCES lms_materials(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lms_prog_mat ON lms_progress(material_id);
CREATE INDEX IF NOT EXISTS idx_lms_prog_nis ON lms_progress(student_nis);
CREATE INDEX IF NOT EXISTS idx_lms_prog_class ON lms_progress(student_class);
CREATE INDEX IF NOT EXISTS idx_lms_prog_status ON lms_progress(status);
CREATE INDEX IF NOT EXISTS idx_lms_prog_mat_nis ON lms_progress(material_id, student_nis);
CREATE INDEX IF NOT EXISTS idx_lms_prog_mat_score ON lms_progress(material_id, quiz_score);
CREATE INDEX IF NOT EXISTS idx_lms_prog_mat_student_status ON lms_progress(material_id, student_nis, status);
CREATE INDEX IF NOT EXISTS idx_lms_prog_created ON lms_progress(created_at);

-- 4. Tabel Ruang Diskusi Terstruktur (lms_discussions)
CREATE TABLE IF NOT EXISTS lms_discussions (
    id TEXT PRIMARY KEY,
    material_id TEXT NOT NULL,
    parent_id TEXT DEFAULT NULL,       -- NULL: Komentar Pokok, Non-NULL: Balasan Komentar
    user_id TEXT NOT NULL,             -- NIP/UID Guru atau NIS Siswa
    user_name TEXT NOT NULL,
    user_role TEXT NOT NULL,           -- 'guru' atau 'siswa'
    content TEXT NOT NULL,
    is_pinned INTEGER DEFAULT 0 CHECK (is_pinned IN (0, 1)),       -- 1: Disematkan oleh Guru
    is_hidden INTEGER DEFAULT 0 CHECK (is_hidden IN (0, 1)),       -- 1: Disembunyikan oleh Moderator
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (material_id) REFERENCES lms_materials(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES lms_discussions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lms_disc_mat ON lms_discussions(material_id);
CREATE INDEX IF NOT EXISTS idx_lms_disc_parent ON lms_discussions(parent_id);
CREATE INDEX IF NOT EXISTS idx_lms_disc_user ON lms_discussions(user_id);
CREATE INDEX IF NOT EXISTS idx_lms_disc_pinned ON lms_discussions(is_pinned);
CREATE INDEX IF NOT EXISTS idx_lms_disc_created ON lms_discussions(created_at);
CREATE INDEX IF NOT EXISTS idx_lms_disc_mat_hidden_parent ON lms_discussions(material_id, is_hidden, parent_id);
CREATE INDEX IF NOT EXISTS idx_lms_disc_mat_visible_user ON lms_discussions(material_id, is_hidden, user_id, user_role);
CREATE INDEX IF NOT EXISTS idx_lms_disc_mat_visible_order ON lms_discussions(material_id, is_hidden, is_pinned DESC, created_at ASC);

-- ====================================================================
-- TRIGGERS INTEGRITAS DATA & KASKADE
-- ====================================================================

-- Validasi Nilai Boolean/Enum Materi LMS
CREATE TRIGGER IF NOT EXISTS trg_lms_materials_validate_insert
BEFORE INSERT ON lms_materials
WHEN NEW.is_published NOT IN (0, 1, 2)
  OR NEW.allow_discussion NOT IN (0, 1)
  OR NEW.is_teaching_completed NOT IN (0, 1)
BEGIN
    SELECT RAISE(ABORT, 'Nilai status materi LMS harus 0 (Draft), 1 (Published), atau 2 (Scheduled)');
END;

CREATE TRIGGER IF NOT EXISTS trg_lms_materials_validate_update
BEFORE UPDATE OF is_published, allow_discussion, is_teaching_completed ON lms_materials
WHEN NEW.is_published NOT IN (0, 1, 2)
  OR NEW.allow_discussion NOT IN (0, 1)
  OR NEW.is_teaching_completed NOT IN (0, 1)
BEGIN
    SELECT RAISE(ABORT, 'Nilai status materi LMS harus 0 (Draft), 1 (Published), atau 2 (Scheduled)');
END;

-- Validasi Status Progres LMS
CREATE TRIGGER IF NOT EXISTS trg_lms_progress_validate_insert
BEFORE INSERT ON lms_progress
WHEN NEW.status NOT IN ('opened', 'completed')
BEGIN
    SELECT RAISE(ABORT, 'Status progres LMS tidak valid (harus opened atau completed)');
END;

CREATE TRIGGER IF NOT EXISTS trg_lms_progress_validate_update
BEFORE UPDATE OF status ON lms_progress
WHEN NEW.status NOT IN ('opened', 'completed')
BEGIN
    SELECT RAISE(ABORT, 'Status progres LMS tidak valid (harus opened atau completed)');
END;

-- Validasi Integritas Forum Diskusi
CREATE TRIGGER IF NOT EXISTS trg_lms_discussions_validate_insert
BEFORE INSERT ON lms_discussions
WHEN NEW.is_pinned NOT IN (0, 1)
    OR NEW.is_hidden NOT IN (0, 1)
    OR (
        NEW.parent_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM lms_discussions WHERE id = NEW.parent_id)
    )
BEGIN
    SELECT RAISE(ABORT, 'Nilai atau induk diskusi LMS tidak valid');
END;

CREATE TRIGGER IF NOT EXISTS trg_lms_discussions_validate_update
BEFORE UPDATE OF is_pinned, is_hidden, parent_id ON lms_discussions
WHEN NEW.is_pinned NOT IN (0, 1)
    OR NEW.is_hidden NOT IN (0, 1)
    OR (
        NEW.parent_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM lms_discussions WHERE id = NEW.parent_id)
    )
BEGIN
    SELECT RAISE(ABORT, 'Nilai atau induk diskusi LMS tidak valid');
END;

-- Kaskade Penghapusan Anak Tanggapan Diskusi
CREATE TRIGGER IF NOT EXISTS trg_lms_discussions_delete_children
AFTER DELETE ON lms_discussions
BEGIN
    DELETE FROM lms_discussions WHERE parent_id = OLD.id;
END;

-- ====================================================================
-- 35. Modul Agenda Pegawai & Penugasan Tugas Pokok (Employee Daily Agenda & Assignments)
-- ====================================================================

-- 35a. Kelompok Penugasan Pegawai (9 Kelompok Bidang Tugas)
CREATE TABLE IF NOT EXISTS employee_task_groups (
    id TEXT PRIMARY KEY,
    kode_kelompok TEXT NOT NULL,
    nama_kelompok TEXT NOT NULL,
    urutan INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_task_groups_urutan ON employee_task_groups(urutan);

-- 35b. Butir Uraian Tugas per Kelompok (10 Butir per Kelompok)
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

-- 35c. Pemetaan Penugasan Pegawai (Assignments)
CREATE TABLE IF NOT EXISTS employee_assignments (
    id TEXT PRIMARY KEY,
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
    FOREIGN KEY (group_id) REFERENCES employee_task_groups(id)
);

CREATE INDEX IF NOT EXISTS idx_emp_asg_user_uid ON employee_assignments(user_uid, status);
CREATE INDEX IF NOT EXISTS idx_emp_asg_gtk_id ON employee_assignments(gtk_id);
CREATE INDEX IF NOT EXISTS idx_emp_asg_group ON employee_assignments(group_id);

-- 35e. Realisasi Aktivitas Harian Pegawai
CREATE TABLE IF NOT EXISTS employee_activities (
    id TEXT PRIMARY KEY,
    assignment_id TEXT,
    employee_name TEXT NOT NULL,
    user_uid TEXT NOT NULL,
    gtk_id TEXT,
    group_id TEXT,
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
    is_outside_duty INTEGER DEFAULT 0,
    status TEXT DEFAULT 'submitted',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (assignment_id) REFERENCES employee_assignments(id),
    FOREIGN KEY (task_item_id) REFERENCES employee_task_items(id)
);

CREATE INDEX IF NOT EXISTS idx_emp_act_user_tanggal ON employee_activities(user_uid, tanggal, jam_mulai);
CREATE INDEX IF NOT EXISTS idx_emp_act_gtk_tanggal ON employee_activities(gtk_id, tanggal);
CREATE INDEX IF NOT EXISTS idx_emp_act_tanggal ON employee_activities(tanggal);
CREATE INDEX IF NOT EXISTS idx_emp_act_sumber ON employee_activities(sumber_kegiatan);
CREATE INDEX IF NOT EXISTS idx_emp_act_assignment ON employee_activities(assignment_id);

-- 35f. Catatan Ketidakhadiran Resmi Pegawai Tendik (Sakit / Cuti / Izin)
CREATE TABLE IF NOT EXISTS employee_absences (
    id TEXT PRIMARY KEY,
    user_uid TEXT NOT NULL,
    gtk_id TEXT,
    tanggal TEXT NOT NULL,
    jenis TEXT NOT NULL,
    alasan TEXT NOT NULL,
    created_by_uid TEXT NOT NULL,
    created_by_name TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_employee_absences_date_gtk ON employee_absences (tanggal, gtk_id);
CREATE INDEX IF NOT EXISTS idx_employee_absences_date_user ON employee_absences (tanggal, user_uid);

-- 35g. Log Koreksi & Jejak Audit Aktivitas Pegawai
-- [SSOT SUPABASE] Jejak riwayat koreksi aktivitas pegawai kini dilebur secara Single Source of Truth
-- ke dalam tabel public.audit_logs di Supabase PostgreSQL (action: 'EMPLOYEE_ACTIVITY_*').

-- 36. Modul Buku Tahunan (Yearbook) Siswa Kelas XII & Katalog Arsip PDF Master Abadi
CREATE TABLE IF NOT EXISTS yearbook_profiles (
    nis TEXT PRIMARY KEY,
    academic_year TEXT NOT NULL,
    casual_photo_url TEXT,
    quote TEXT,
    ambition TEXT,
    dream_campus TEXT,
    social_media TEXT, -- JSON string: { "instagram": "", "tiktok": "", "spotify": "" }
    status TEXT DEFAULT 'draft', -- draft, submitted, approved
    is_published INTEGER NOT NULL DEFAULT 1, -- 0: disembunyikan admin dari galeri publik & cetak
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_yearbook_profiles_year ON yearbook_profiles(academic_year);
CREATE INDEX IF NOT EXISTS idx_yearbook_profiles_status ON yearbook_profiles(status);

CREATE TABLE IF NOT EXISTS yearbook_messages (
    id TEXT PRIMARY KEY,
    academic_year TEXT NOT NULL,
    target_nis TEXT NOT NULL,
    sender_nis TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    sender_class TEXT NOT NULL,
    message TEXT NOT NULL,
    is_approved INTEGER DEFAULT 0, -- 0: pending review, 1: disetujui untuk dicetak
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_yearbook_messages_target ON yearbook_messages(target_nis, academic_year);
CREATE INDEX IF NOT EXISTS idx_yearbook_messages_sender ON yearbook_messages(sender_nis);
CREATE INDEX IF NOT EXISTS idx_yearbook_messages_approved ON yearbook_messages(target_nis, is_approved);

CREATE TABLE IF NOT EXISTS yearbook_archives (
    academic_year TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    batch_name TEXT,
    theme_name TEXT,
    cover_url TEXT,
    pdf_url TEXT NOT NULL,
    total_students INTEGER DEFAULT 0,
    is_public INTEGER DEFAULT 1,
    published_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_yearbook_archives_public ON yearbook_archives(is_public);

-- Percobaan asesmen: salinan soal, jawaban, dan hasil pemeriksaan guru.
CREATE TABLE IF NOT EXISTS lms_quiz_attempts (
    id TEXT PRIMARY KEY,
    material_id TEXT NOT NULL REFERENCES lms_materials(id) ON DELETE CASCADE,
    student_nis TEXT NOT NULL,
    student_name TEXT NOT NULL,
    student_class TEXT NOT NULL,
    quiz_snapshot TEXT NOT NULL,
    answers TEXT NOT NULL DEFAULT '{}',
    result TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress', 'pending_review', 'graded')),
    score INTEGER,
    revision INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    expires_at TEXT,
    submitted_at TEXT,
    reviewed_at TEXT,
    reviewed_by TEXT,
    is_locked INTEGER NOT NULL DEFAULT 0,
    lock_reason TEXT,
    violation_count INTEGER NOT NULL DEFAULT 0,
    violations_log TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_lms_quiz_student ON lms_quiz_attempts(material_id, student_nis, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lms_quiz_active ON lms_quiz_attempts(material_id, student_nis) WHERE status = 'in_progress';
CREATE INDEX IF NOT EXISTS idx_lms_quiz_locked ON lms_quiz_attempts(material_id, is_locked) WHERE is_locked = 1;
CREATE INDEX IF NOT EXISTS idx_lms_quiz_retention ON lms_quiz_attempts(started_at);

-- ====================================================================
-- 37. MODUL BEBAN KERJA GURU (Workload Planning, Realization, and Review)
-- Sesuai Permendikdasmen No. 11/2025 & Kebijakan Jam Kerja Sekolah SMAGESA
-- ====================================================================

-- 37a. Master Regulasi Beban Kerja & Ekuivalensi (workload_rulesets)
CREATE TABLE IF NOT EXISTS workload_rulesets (
    id TEXT PRIMARY KEY,
    rule_code TEXT NOT NULL UNIQUE,
    document_source TEXT NOT NULL,
    pasal_ref TEXT NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    target_unit TEXT NOT NULL,
    equivalency_jp INTEGER DEFAULT 0,
    max_equivalency_jp INTEGER DEFAULT 0,
    min_teaching_jp INTEGER DEFAULT 0,
    min_bk_rombel INTEGER DEFAULT 0,
    combination_restriction TEXT,
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    verification_status TEXT DEFAULT 'verified',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_workload_rules_code ON workload_rulesets(rule_code);
CREATE INDEX IF NOT EXISTS idx_workload_rules_cat ON workload_rulesets(category);

-- 37b. Kebijakan Jam Kerja Sekolah Berversi (school_work_policies)
CREATE TABLE IF NOT EXISTS school_work_policies (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL DEFAULT 'smagesa',
    policy_name TEXT NOT NULL,
    work_days_count INTEGER NOT NULL DEFAULT 5,
    normal_daily_minutes INTEGER NOT NULL DEFAULT 450,
    normal_weekly_minutes INTEGER NOT NULL DEFAULT 2250,
    work_start_time TEXT NOT NULL DEFAULT '07:30',
    work_end_time TEXT NOT NULL DEFAULT '15:30',
    breaks_json TEXT NOT NULL DEFAULT '[{"name":"Istirahat 1","start":"09:45","end":"10:00","minutes":15},{"name":"Istirahat 2","start":"12:15","end":"12:30","minutes":15}]',
    jp_duration_minutes INTEGER NOT NULL DEFAULT 45,
    timezone TEXT NOT NULL DEFAULT 'Asia/Makassar',
    weekly_reporting_deadline TEXT NOT NULL DEFAULT 'end_of_week',
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    authorized_by TEXT,
    legal_basis_doc TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_school_policies_active ON school_work_policies(school_id, is_active);

-- 37c. Penyesuaian Kalender Kerja Resmi (work_calendar_overrides)
CREATE TABLE IF NOT EXISTS work_calendar_overrides (
    id TEXT PRIMARY KEY,
    policy_id TEXT NOT NULL,
    date TEXT NOT NULL,
    day_type TEXT NOT NULL,
    title TEXT NOT NULL,
    reduction_minutes INTEGER NOT NULL DEFAULT 450,
    document_no TEXT NOT NULL,
    approved_by_uid TEXT NOT NULL,
    approved_by_name TEXT NOT NULL,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (policy_id) REFERENCES school_work_policies(id)
);

CREATE INDEX IF NOT EXISTS idx_cal_overrides_date ON work_calendar_overrides(date);

-- 37d. Katalog Aktivitas Guru (activity_catalog)
CREATE TABLE IF NOT EXISTS activity_catalog (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    category_code TEXT NOT NULL,
    category_name TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    default_duration_minutes INTEGER DEFAULT 45,
    is_teaching INTEGER DEFAULT 0,
    requires_evidence INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_act_cat_category ON activity_catalog(category_code, sort_order);

-- 37e. Penugasan Tugas Tambahan Guru Berbasis SK (teacher_assignments)
CREATE TABLE IF NOT EXISTS teacher_assignments (
    id TEXT PRIMARY KEY,
    teacher_id TEXT NOT NULL,
    user_uid TEXT,
    assignment_type TEXT NOT NULL,
    title TEXT NOT NULL,
    sk_number TEXT NOT NULL,
    sk_date TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    scope_target TEXT,
    equivalency_jp INTEGER DEFAULT 0,
    rule_code TEXT,
    status TEXT DEFAULT 'active',
    verification_status TEXT DEFAULT 'verified',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (teacher_id) REFERENCES gtk(id)
);

CREATE INDEX IF NOT EXISTS idx_teach_asg_teacher ON teacher_assignments(teacher_id, status);
CREATE INDEX IF NOT EXISTS idx_teach_asg_type ON teacher_assignments(assignment_type);

-- 37f. Root Minggu Kerja Guru (work_weeks)
CREATE TABLE IF NOT EXISTS work_weeks (
    id TEXT PRIMARY KEY,
    teacher_id TEXT NOT NULL,
    school_id TEXT NOT NULL DEFAULT 'smagesa',
    week_start_date TEXT NOT NULL,
    week_end_date TEXT NOT NULL,
    academic_year TEXT NOT NULL,
    semester TEXT NOT NULL,
    policy_id TEXT NOT NULL,
    target_minutes INTEGER NOT NULL DEFAULT 2250,
    approved_adjustment_minutes INTEGER NOT NULL DEFAULT 0,
    adjustment_reason TEXT,
    active_plan_version_id TEXT,
    is_locked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(teacher_id, week_start_date),
    FOREIGN KEY (teacher_id) REFERENCES gtk(id),
    FOREIGN KEY (policy_id) REFERENCES school_work_policies(id)
);

CREATE INDEX IF NOT EXISTS idx_work_weeks_teacher_start ON work_weeks(teacher_id, week_start_date);
CREATE INDEX IF NOT EXISTS idx_work_weeks_start ON work_weeks(week_start_date);

-- 37g. Versi Rencana Kerja Mingguan (weekly_plan_versions)
CREATE TABLE IF NOT EXISTS weekly_plan_versions (
    id TEXT PRIMARY KEY,
    work_week_id TEXT NOT NULL,
    version_number INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'draft',
    revision_lock INTEGER NOT NULL DEFAULT 1,
    total_planned_minutes INTEGER NOT NULL DEFAULT 0,
    submitted_at TEXT,
    submitted_by_uid TEXT,
    reviewed_at TEXT,
    reviewed_by_uid TEXT,
    reviewed_by_name TEXT,
    review_notes TEXT,
    revision_reason TEXT,
    snapshot_data TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(work_week_id, version_number),
    FOREIGN KEY (work_week_id) REFERENCES work_weeks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_plan_versions_week ON weekly_plan_versions(work_week_id, version_number);
CREATE INDEX IF NOT EXISTS idx_plan_versions_status ON weekly_plan_versions(status);

-- 37h. Identitas Kegiatan Rencana yang Stabil Lintas Revisi (plan_activities)
-- Penetapan HBG per versi; tidak tercampur antar guru/perangkat atau revisi rencana.
CREATE TABLE IF NOT EXISTS workload_study_days (
    plan_version_id TEXT PRIMARY KEY REFERENCES weekly_plan_versions(id) ON DELETE CASCADE,
    manual_day_index INTEGER CHECK (manual_day_index BETWEEN 0 AND 4),
    resolution_json TEXT NOT NULL,
    updated_by_uid TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plan_activities (
    id TEXT PRIMARY KEY,
    work_week_id TEXT NOT NULL,
    catalog_id TEXT NOT NULL,
    assignment_id TEXT,
    title TEXT NOT NULL,
    category_code TEXT NOT NULL,
    origin_source TEXT NOT NULL DEFAULT 'manual',
    schedule_occurrence_id TEXT,
    is_cancelled INTEGER NOT NULL DEFAULT 0,
    cancellation_reason TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (work_week_id) REFERENCES work_weeks(id) ON DELETE CASCADE,
    FOREIGN KEY (catalog_id) REFERENCES activity_catalog(id),
    FOREIGN KEY (assignment_id) REFERENCES teacher_assignments(id)
);

CREATE INDEX IF NOT EXISTS idx_plan_act_week ON plan_activities(work_week_id);

-- 37i. Slot Waktu Rincian Rencana per Versi (plan_time_segments)
CREATE TABLE IF NOT EXISTS plan_time_segments (
    id TEXT PRIMARY KEY,
    plan_version_id TEXT NOT NULL,
    activity_id TEXT NOT NULL,
    date TEXT NOT NULL,
    day_of_week INTEGER NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    planned_minutes INTEGER NOT NULL,
    is_teaching INTEGER NOT NULL DEFAULT 0,
    jp_count INTEGER DEFAULT 0,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (plan_version_id) REFERENCES weekly_plan_versions(id) ON DELETE CASCADE,
    FOREIGN KEY (activity_id) REFERENCES plan_activities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_plan_seg_version ON plan_time_segments(plan_version_id, date);
CREATE INDEX IF NOT EXISTS idx_plan_seg_ver_date_start ON plan_time_segments(plan_version_id, date ASC, start_time ASC);
CREATE INDEX IF NOT EXISTS idx_plan_seg_activity ON plan_time_segments(activity_id);
CREATE INDEX IF NOT EXISTS idx_plan_seg_date_time ON plan_time_segments(date, start_time);

-- 37j. Template Mingguan Rutin Guru (weekly_templates & weekly_template_items)
CREATE TABLE IF NOT EXISTS weekly_templates (
    id TEXT PRIMARY KEY,
    teacher_id TEXT NOT NULL,
    template_name TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    total_estimated_minutes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (teacher_id) REFERENCES gtk(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_weekly_temp_teacher ON weekly_templates(teacher_id);

CREATE TABLE IF NOT EXISTS weekly_template_items (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    day_of_week INTEGER NOT NULL,
    catalog_id TEXT NOT NULL,
    title TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    estimated_minutes INTEGER NOT NULL,
    is_teaching INTEGER NOT NULL DEFAULT 0,
    jp_count INTEGER DEFAULT 0,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (template_id) REFERENCES weekly_templates(id) ON DELETE CASCADE,
    FOREIGN KEY (catalog_id) REFERENCES activity_catalog(id)
);

CREATE INDEX IF NOT EXISTS idx_temp_items_template ON weekly_template_items(template_id, day_of_week);

-- 37k. Entitas Realisasi Aktual Pekerjaan (work_logs)
CREATE TABLE IF NOT EXISTS work_logs (
    id TEXT PRIMARY KEY,
    work_week_id TEXT NOT NULL,
    teacher_id TEXT NOT NULL,
    date TEXT NOT NULL,
    day_of_week INTEGER NOT NULL,
    title TEXT NOT NULL,
    catalog_id TEXT NOT NULL,
    is_unplanned INTEGER NOT NULL DEFAULT 0,
    output_summary TEXT,
    evidence_url TEXT,
    status_execution TEXT NOT NULL DEFAULT 'terlaksana',
    obstacle_notes TEXT,
    verification_status TEXT NOT NULL DEFAULT 'unverified',
    verified_at TEXT,
    verified_by_uid TEXT,
    verified_by_name TEXT,
    verification_notes TEXT,
    is_locked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (work_week_id) REFERENCES work_weeks(id),
    FOREIGN KEY (teacher_id) REFERENCES gtk(id),
    FOREIGN KEY (catalog_id) REFERENCES activity_catalog(id)
);

CREATE INDEX IF NOT EXISTS idx_work_logs_week ON work_logs(work_week_id, date);
CREATE INDEX IF NOT EXISTS idx_work_logs_teacher_date ON work_logs(teacher_id, date);
CREATE INDEX IF NOT EXISTS idx_work_logs_verification ON work_logs(verification_status);

-- 37l. Sesi Pelaksanaan Aktual Riil (work_log_segments)
CREATE TABLE IF NOT EXISTS work_log_segments (
    id TEXT PRIMARY KEY,
    work_log_id TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    actual_minutes INTEGER NOT NULL,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (work_log_id) REFERENCES work_logs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_log_segments_log ON work_log_segments(work_log_id);

-- 37m. Relasi Rencana ↔ Realisasi (plan_log_links)
CREATE TABLE IF NOT EXISTS plan_log_links (
    id TEXT PRIMARY KEY,
    plan_activity_id TEXT NOT NULL,
    work_log_id TEXT NOT NULL,
    link_type TEXT NOT NULL DEFAULT 'fulfillment',
    reason_notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(plan_activity_id, work_log_id),
    FOREIGN KEY (plan_activity_id) REFERENCES plan_activities(id) ON DELETE CASCADE,
    FOREIGN KEY (work_log_id) REFERENCES work_logs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_plan_log_plan ON plan_log_links(plan_activity_id);
CREATE INDEX IF NOT EXISTS idx_plan_log_log ON plan_log_links(work_log_id);

-- 37n. Log Jejak Audit Beban Kerja (workload_audit_logs)
-- [SSOT SUPABASE] Jejak riwayat audit beban kerja/E-Kinerja kini dilebur secara Single Source of Truth
-- ke dalam tabel public.audit_logs di Supabase PostgreSQL (action: 'WORKLOAD_*').

-- 37o. Pendelegasian Wewenang Pemeriksaan (workload_delegations)
CREATE TABLE IF NOT EXISTS workload_delegations (
    id TEXT PRIMARY KEY,
    delegator_uid TEXT NOT NULL,
    delegatee_uid TEXT NOT NULL,
    delegatee_name TEXT NOT NULL,
    permission_scope TEXT NOT NULL DEFAULT 'review_all',
    sk_number TEXT NOT NULL,
    valid_from TEXT NOT NULL,
    valid_until TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_workload_delegation_delegatee ON workload_delegations(delegatee_uid, status, valid_until);

-- 37p. Master Butir Tugas Dinamis Wakil Kepala Sekolah (waka_duty_items)
CREATE TABLE IF NOT EXISTS waka_duty_items (
    id TEXT PRIMARY KEY,
    waka_type TEXT NOT NULL,           -- 'kurikulum' | 'kesiswaan' | 'sarpras' | 'humas'
    duty_number INTEGER NOT NULL,      -- Urutan butir tugas (1, 2, 3...)
    duty_title TEXT NOT NULL,          -- Judul / uraian ringkas butir tugas
    duty_description TEXT DEFAULT '',  -- Deskripsi ruang lingkup / rincian tugas
    is_active INTEGER DEFAULT 1,       -- 1 = aktif, 0 = nonaktif
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_waka_duty_type ON waka_duty_items(waka_type, is_active, duty_number);

-- 38. Sesi Koreksi Asesmen Siswa Otomatis Berbasis Gemini AI (ai_grading_sessions)
CREATE TABLE IF NOT EXISTS ai_grading_sessions (
    id TEXT PRIMARY KEY, -- Format: {kelas}_{timestamp}
    teacher_id TEXT,
    kelas TEXT NOT NULL,
    mapel TEXT NOT NULL,
    semester TEXT NOT NULL,
    tahun_ajaran TEXT NOT NULL,
    title TEXT NOT NULL,
    total_max_score REAL DEFAULT 100,
    questions_json TEXT NOT NULL DEFAULT '[]',
    submissions_json TEXT NOT NULL DEFAULT '{}',
    revision INTEGER NOT NULL DEFAULT 0,
    client_updated_at TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_grading_teacher ON ai_grading_sessions(teacher_id);
CREATE INDEX IF NOT EXISTS idx_ai_grading_kelas_mapel ON ai_grading_sessions(kelas, mapel);



-- Optional LMS journal bridge. Existing journals and LMS progress remain unchanged.
CREATE TABLE IF NOT EXISTS lms_journal_links (
    journal_id TEXT PRIMARY KEY REFERENCES jurnal_guru(id) ON DELETE CASCADE,
    scope_key TEXT NOT NULL UNIQUE,
    teacher_id TEXT NOT NULL,
    plan_segment_id TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 1,
    request_id TEXT NOT NULL,
    snapshot_hash TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    evidence_token TEXT NOT NULL,
    signed_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS lms_journal_evidence (
    token TEXT PRIMARY KEY,
    journal_id TEXT NOT NULL REFERENCES jurnal_guru(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(journal_id, revision)
);
CREATE TABLE IF NOT EXISTS lms_activity_events (
    id TEXT PRIMARY KEY,
    material_id TEXT NOT NULL REFERENCES lms_materials(id) ON DELETE CASCADE,
    student_nis TEXT NOT NULL,
    action TEXT NOT NULL,
    occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lms_activity_period ON lms_activity_events(material_id, occurred_at, student_nis);
CREATE INDEX IF NOT EXISTS idx_lms_journal_teacher ON lms_journal_links(teacher_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lms_journal_request ON lms_journal_links(request_id);

-- Indeks Performa Query D1 (LMS Quiz Attempts, Records & Students)
CREATE INDEX IF NOT EXISTS idx_lms_quiz_student_status ON lms_quiz_attempts(material_id, student_nis, status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_records_status_date_cat ON records(status, date, category);
CREATE INDEX IF NOT EXISTS idx_students_status_class_name ON students(status, class, name);

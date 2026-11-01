# ☁️ Cloudflare D1 & Worker API - SIMAS SMAGESA

Dokumentasi dan arsip kode implementasi **Cloudflare D1 (Serverless Edge SQL)** dan **Cloudflare Worker API Gateway** untuk ekosistem aplikasi SIMAS SMAGESA (SMA Negeri 1 Abang).

---

## 📁 Struktur Berkas

```
cloudflare/
├── README.md                          # Dokumentasi, panduan setup, dan arsip query
├── schema.sql                         # Skema database DDL gabungan untuk D1
├── worker.js                          # Entry point Worker API Gateway (router + handler yang belum dipecah)
├── lib/                               # Modul ES hasil refaktor bertahap (di-import worker.js)
│   ├── http.js                        # CORS whitelist, header keamanan, jsonResponse/errorResponse
│   ├── secure-card-token.js           # Token kartu pelajar kts_ (XXTEA + FNV-1a)
│   └── messaging-format.js            # Normalisasi nomor WA & escape HTML Telegram
├── wrangler.toml                      # Konfigurasi deployment Wrangler CLI
└── migrations/
    ├── 202608230001_init_agenda_d1.sql # Arsip migrasi SQL inisialisasi modul Agenda
    └── 202608290002_notifications.sql  # FCM token registry, outbox, cron agenda, channel log
```

---

## 🚀 Panduan Eksekusi SQL di Cloudflare D1 Console

### Penetapan Hari Belajar Guru (22 Oktober 2026)

Rilis perbaikan HBG memerlukan Worker dan frontend baru serta migrasi
`migrations/202610220002_workload_study_days.sql`. Migrasi aman dijalankan ulang;
mutasi pertama juga dapat membuat tabel secara idempotent. GET minggu tetap
read-only dan tidak membuat tabel. Pilihan browser lama sengaja diabaikan karena
kuncinya memakai akun admin, bukan identitas guru yang dikelola.

`POST /api/workload/study-day` menerima `work_week_id`, `plan_version_id`,
`revision_lock`, dan `manual_day_index` (0–4 atau `null` untuk otomatis).
`GET /api/workload/week` mengembalikan `study_day` dengan status `auto`, `manual`,
`needs_selection`, `unavailable`, atau `exempt`. Pilihan dan snapshot penetapan
tersimpan per versi rencana. Pengajuan memeriksa ulang kegiatan HBG di server;
snapshot dan perubahan status disimpan dalam satu transaksi.

Master jadwal berasal dari `system_settings.schedule_config`. Deteksi otomatis
memerlukan ekspor aSc lengkap dan pemetaan guru yang tidak ambigu. Hari libur
memakai data nasional, kalender D1 dan view publik tanggal `lib_opac_hari_libur`
Supabase (sumbernya tetap `lib_hari_libur`) melalui konfigurasi Worker yang sudah
ada. Tabel dasar sengaja tertutup bagi anon/authenticated; HBG tidak memerlukan
perubahan izin atau service key baru. Jika pemeriksaan HBG gagal, GET minggu
tetap mengembalikan rencana, versi dan segmennya dengan status HBG `unavailable`;
Sinkron KBM tetap dapat berjalan. Penyimpanan HBG/pengajuan tetap memeriksa
kalender secara ketat dan tidak menganggap kegagalan sebagai kalender kosong.

Jika menjalankan manual via Web Dashboard ([dash.cloudflare.com](https://dash.cloudflare.com/)):
1. Buka **Storage & Databases** &rarr; **D1 SQL Database** &rarr; klik **`simas-smagesa-db`** &rarr; tab **Console**.
2. Jalankan perintah di bawah ini **satu per satu** per klik **Execute**:

### Perintah 1:
```sql
CREATE TABLE IF NOT EXISTS calendar_events (id TEXT PRIMARY KEY, title TEXT NOT NULL, date TEXT NOT NULL, time TEXT, location TEXT, category TEXT DEFAULT 'umum', description TEXT, color TEXT DEFAULT 'blue', created_by TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
```

### Perintah 2:
```sql
CREATE INDEX IF NOT EXISTS idx_events_date ON calendar_events(date);
```

### Perintah 3:
```sql
CREATE TABLE IF NOT EXISTS agenda_documents (id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT DEFAULT 'umum', drive_url TEXT NOT NULL, file_type TEXT DEFAULT 'pdf', uploaded_by TEXT NOT NULL, uploader_name TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
```

### Perintah 4:
```sql
CREATE INDEX IF NOT EXISTS idx_docs_category ON agenda_documents(category);
```

---

## ⚙️ Konfigurasi Cloudflare Worker (`simas-smagesa-api`)

### Upgrade push outbox September 2026

Perubahan perlu dirilis bersama `sw.js`, `push-worker.js`, `firebase-messaging-sw.js`,
dan klien push. Rilis frontend lebih dahulu agar browser dapat menyimpan UID pemilik
dan menangani payload data-only sebelum Worker baru mengirimnya.

Database lama dapat memakai `migrations/202609050001_push_delivery_safety.sql` sekali
sebelum deploy Worker. Alternatifnya, Worker memeriksa `PRAGMA table_info` dan
menambahkan kolom yang belum ada secara idempotent; jangan menjalankan ulang ALTER
migrasi manual setelah auto-upgrade. Database baru memakai `schema.sql`.

Cron outbox kini berjalan setiap menit. Setiap invocation mengklaim paling banyak
40 delivery dengan lease dua menit dan paling banyak empat koneksi FCM paralel.
Retry memakai backoff, jitter, dan Retry-After; token hanya dicabut untuk detail
UNREGISTERED. Pengiriman ke FCM yang sukses berarti diterima penyedia, belum bukti
tampil/dibaca di HP. Status `cancelled` berarti binding berubah, bukan perangkat rusak.

Pembersihan token hanya dijalankan bila hasil FCM berisi `UNREGISTERED`. Query
mencari ID token melalui primary key; UID dan `updated_at` tetap diperiksa agar
hasil kirim lama tidak mencabut registrasi yang baru di-refresh atau berpindah
akun. Batch tanpa token invalid tidak menjalankan query DELETE. Optimasi ini
tidak memerlukan migrasi database.

Push sistem tetap ditampilkan ketika SIMAS sedang aktif; toast dan lonceng hanya
menyinkronkan halaman. ACK dari tab foreground tidak membatalkan `showNotification`.
Registrasi token melakukan retry untuk gangguan jaringan/D1 dan diperiksa lagi saat
kembali online atau aktif (maksimal setiap lima menit setelah sukses, 30 detik setelah
gagal). Izin browser baru dilaporkan aktif setelah token tersimpan di backend;
kegagalan menampilkan banner **Hubungkan Ulang**. Penantian service worker dibatasi
15 detik, dan update skrip worker beserta impor melewati cache HTTP.

Logout tidak mencabut token. Registrasi akun lain membatalkan antrean lama dalam
transaksi yang sama dengan rebind. Browser memeriksa UID payload baru dan menyimpan
500 job terakhir (maksimal tujuh hari) untuk deduplikasi. Pesan versi lama yang
sudah diserahkan ke FCM tanpa UID tidak dapat ditarik kembali; pemeriksaan UID
berlaku setelah frontend diperbarui dan payload baru digunakan. Kegagalan jaringan
setelah FCM menerima pesan tetap bisa menyebabkan retry; sistem memakai semantik
at-least-once dengan deduplikasi browser, bukan jaminan exactly-once.

Tes server: `npm run test:unit -- --runInBand tests/push-delivery-safety.test.js js/push-lifecycle.test.mjs`
(Node 22.13+ untuk SQLite bawaan). Tes browser: jalankan server lokal, lalu
`npx cypress run --spec cypress/e2e/push-delivery-safety.cy.js --config supportFile=false,trashAssetsBeforeRuns=false`.

### Indeks daftar catatan dashboard/BK

`GET /api/records` memakai `INDEXED BY` untuk daftar tanpa filter tanggal/NIS:
`idx_records_active_ts` (semua aktif), `idx_records_active_cat_ts` (kategori),
`idx_records_active_class_ts` (kelas), atau `idx_records_active_class_cat_ts`
(kelas + kategori). Ini mencegah indeks lama `(status, date)` memicu pengurutan
seluruh catatan aktif sebelum `LIMIT`. Filter tanggal/NIS tetap diserahkan ke
query planner agar indeks yang lebih selektif dapat digunakan.

Terapkan `migrations/202609040002_optimize_records_timestamp_indexes.sql`
sebelum deploy Worker. CI sudah menerapkan migrasi lebih dahulu. Jika indeks
pilihan belum tersedia pada database lama, Worker mengulang query asli tanpa
`INDEXED BY`; kegagalan database lainnya tetap dilaporkan. Tidak ada migrasi
atau normalisasi data yang dijalankan saat membaca daftar.

Filter, `ORDER BY timestamp`, `LIMIT/OFFSET`, dan bentuk respons tetap sama.
Urutan di antara timestamp yang identik tidak ditentukan oleh kontrak SQL lama;
perubahan ini tidak menambahkan aturan pengurutan baru.

Validasi lokal (Node 22.13+):
`npm run test:unit -- --runInBand tests/records-query-indexes.test.js`.
Tes mengeksekusi Worker dan SQL sebenarnya, memeriksa `EXPLAIN QUERY PLAN`,
kesetaraan hasil, pagination, dan fallback migrasi. Penghematan `rows_read`
produksi perlu diukur di D1 setelah deployment.

### Optimasi pembacaan LMS (16 Oktober 2026)

`migrations/202610160001_lms_read_query_indexes.sql` menambahkan enam indeks
tanpa mengubah data. Indeks ekspresi materi/topik mengikuti pencocokan
`LOWER(TRIM(class_name))` dan `LOWER(TRIM(subject_name))` yang sudah dipakai
Worker. Jalur semua mapel dan satu mapel memiliki indeks masing-masing agar
urutan `order_index, created_at` tidak membutuhkan pengurutan sementara.
Indeks materi hanya mencakup bahan ajar terbit/terjadwal yang tidak diarsipkan.
Indeks diskusi mencakup penghitungan partisipasi per siswa serta urutan komentar
yang disematkan lebih dahulu. Filter komentar tersembunyi tetap berlaku.

Memulai, membuka kembali, dan mengulang kuis kini memeriksa learning path sekali
per request, menghemat dua SELECT berulang. Pemeriksaan sesi, kelas, materi
terkunci, dan minimum membaca tetap berjalan. Tidak ada cache progres lintas
request; perubahan prasyarat diperiksa lagi pada request berikutnya.

CI menerapkan migrasi D1 sebelum deployment Worker. Worker tetap dapat membaca
database yang belum mendapat indeks ini; indeks tidak dipaksakan dengan
`INDEXED BY`. `schema.sql` juga memuat definisinya untuk database baru.
Indeks menambah penyimpanan dan pemeliharaan saat menulis, sehingga penghematan
`rows_read` dan dampak `rows_written` produksi perlu diukur setelah rilis.

Validasi lokal (Node 22.13+):
`npm run test:unit -- --runInBand tests/lms-query-indexes.test.js tests/lms-quiz.test.js tests/lms-minimum-reading.test.mjs tests/lms-late-learning.test.mjs`.
Tes mengeksekusi SQL Worker sebenarnya, membandingkan isi/urutan sebelum dan
sesudah migrasi, memeriksa query plan, serta memastikan progres dan diskusi
terbaru tetap terbaca.

### Optimasi pencarian notifikasi per kelas (16 Oktober 2026)

Kandidat inbox kini memisahkan siaran umum/agenda, role, dan kelas. Pencarian
kelas memakai nilai persis serta ekspresi normalisasi lama melalui indeks,
sehingga tidak perlu memeriksa notifikasi kelas lain. Identitas UID/NIS,
delivery yang sudah ada, role gabungan, jendela 60 hari, batas 40 pesan,
urutan, dan status baca tetap memakai aturan yang sama. Jalur tandai dibaca
dan tandai semua dibaca memakai kandidat yang sama dengan inbox.

`migrations/202610160002_notification_inbox_covering_indexes.sql` membangun
ulang tiga indeks dengan tambahan kolom agar kandidat dapat dibaca langsung
dari indeks. Indeks lama diganti, bukan disimpan sebagai indeks duplikat.
Satu indeks tambahan hanya mencakup job `class`/`class_admin`. Migrasi tidak
mengubah pesan atau status baca dan dapat diulang. `schema.sql` serta bootstrap
Worker memuat definisi yang sama untuk database baru. Database lama tetap
dapat dilayani sebelum migrasi; manfaat penuh muncul setelah indeks diperbarui.

Tes `tests/notification-inbox-visibility.test.js` membandingkan hasil terhadap
query sebelumnya untuk siswa dan staf, memeriksa status baca serta migrasi,
dan menguji 2.500 pesan kelas lain. Jumlah kunjungan kandidat pada fixture turun
dari setidaknya 1.250/2.500 (siswa/admin kelas) menjadi kurang dari 50.
Ini pengukuran SQLite lokal, bukan angka `rows_read` atau latency D1 produksi.

### Konfigurasi awal

1. **Bindings:**
   * Di dashboard Worker **`simas-smagesa-api`** &rarr; **Settings** &rarr; **Variables and Bindings** &rarr; **D1 Database Bindings**:
     * **Variable name:** `DB` *(Wajib huruf kapital)*
     * **D1 database:** `simas-smagesa-db`
2. **Deploy Kode:**
   * Tempelkan seluruh isi berkas `cloudflare/worker.js` ke menu **Edit code** Worker &rarr; klik **Deploy** (atau via CLI: `cd cloudflare && npx wrangler deploy`).

3. **Secrets notifikasi (wajib, jangan simpan di Firestore/browser):**
   ```bash
   wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL
   wrangler secret put GOOGLE_PRIVATE_KEY
   wrangler secret put TELEGRAM_BOT_TOKEN
   wrangler secret put TELEGRAM_WEBHOOK_SECRET
   wrangler secret put FONNTE_TOKEN
   ```
   **Secret sesi siswa (wajib):** kunci HMAC untuk token `X-Student-Token`. Tanpa secret ini
   verifikasi login siswa (`/api/students/verify-credentials`) menolak dengan 503 dan token siswa
   tidak diterima. Isi dengan nilai acak, jangan diketik manual:
   ```bash
   node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64url'))" | npx wrangler secret put SESSION_SECRET
   ```
   Mengganti nilainya membatalkan semua token siswa lama (siswa cukup verifikasi NIS ulang).

   **Secret token kartu pelajar (wajib):** kunci token QR kartu `kts_...`. Kunci ini hanya boleh ada
   di Worker, jangan pernah disalin ke kode browser. SPP dan perpustakaan menerjemahkan QR lewat
   `GET /api/students/resolve-card/:token` (khusus staf). Tanpa secret ini token `kts_` tidak
   diterbitkan maupun diterima (kartu ber-`public_token` tetap berfungsi):
   ```bash
   node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64url'))" | npx wrangler secret put CARD_TOKEN_SECRET
   ```
   **Jangan ganti nilainya setelah kartu dicetak:** QR `kts_` pada kartu lama akan berhenti berlaku.

   `GOOGLE_PRIVATE_KEY` dan email berasal dari service account yang memiliki izin
   minimum `Firebase Cloud Messaging API Admin`, `Firebase Authentication Admin`,
   dan `Cloud Datastore User`. Gunakan service account khusus Worker, bukan akun
   deploy berizin luas. FCM tetap dipakai sebagai transport push gratis; tidak ada
   Firebase Cloud Function yang diperlukan.

4. **GitHub Actions:** tambahkan repository secrets `CLOUDFLARE_API_TOKEN` dan
   `CLOUDFLARE_ACCOUNT_ID`. Workflow `deploy.yml` akan menerapkan migrasi D1
   dan Worker terlebih dahulu, baru kemudian Firebase Hosting/Firestore.

---

## 🛡️ Standar Keamanan & Endpoint API

| Method | Endpoint | Deskripsi | Hak Akses (RBAC) |
|---|---|---|---|
| `GET` | `/` atau `/api/health` | Health check status serverless D1 | Publik |
| `GET` | `/api/agenda/events?year=YYYY&month=MM` | Mengambil agenda kegiatan bulanan | Publik / Auth |
| `POST` | `/api/agenda/events` | Menambah agenda baru | Manager (`Bearer <token>`) |
| `PUT` | `/api/agenda/events/:id` | Mengubah data agenda | Manager (`Bearer <token>`) |
| `DELETE` | `/api/agenda/events/:id` | Menghapus agenda | Manager (`Bearer <token>`) |
| `GET` | `/api/agenda/documents?category=all` | Mengambil daftar dokumen Google Drive | Publik / Auth |
| `POST` | `/api/agenda/documents` | Menambah dokumen baru | Manager (`Bearer <token>`) |
| `PUT` | `/api/agenda/documents/:id` | Mengubah data dokumen | Manager (`Bearer <token>`) |
| `DELETE` | `/api/agenda/documents/:id` | Menghapus dokumen | Manager (`Bearer <token>`) |
| `GET` | `/api/login-history` | Mengambil riwayat log login pengguna | Super Admin (`Bearer <token>`) |
| `POST` | `/api/login-history` | Mencatat log login baru | Auth / Client |
| `GET` | `/api/audit-logs` | Mengambil log audit keamanan | Super Admin (`Bearer <token>`) |
| `POST` | `/api/audit-logs` | Mencatat jejak audit mutasi | Auth / Client |
| `POST` | `/api/push/register` | Mendaftarkan/rebind token perangkat ke UID aktif | Auth |
| `POST` | `/api/push/send` | Membuat job push pada D1 outbox | Staf/Guru; broadcast semua hanya Super Admin |
| `POST` | `/api/notify/wa` | Mengirim WA tanpa mengekspos secret provider | Staf/Guru |
| `POST` | `/api/notify/telegram` | Mengirim pesan Telegram | Staf/Guru |
| `POST` | `/api/telegram/configure-webhook` | Mendaftarkan webhook + secret token | Super Admin |

---

## ⏰ Otomatisasi Pembersihan Data Berkala & Supabase Keep-Alive (Cron Trigger)

Dikelola otomatis melalui Cloudflare Worker `scheduled` event:
* **Setiap 2 menit**: melanjutkan delivery push yang masih pending.
* **08:00 WITA / 00:00 UTC**: mengirim ringkasan perubahan agenda.
* **02:00 WITA / 18:00 UTC**: menjalankan retensi data D1 & Supabase Keep-Alive:
  * **`login_history`**: Retensi **1 Bulan (30 Hari)**
  * **`audit_logs`**: Retensi **3 Bulan (90 Hari)**
  * **`calendar_events`**: Retensi **3 Tahun**
  * **`Supabase Keep-Alive`**: Mengirim *lightweight ping query* ke Supabase REST API untuk mencegah database gratis (*free tier*) masuk ke mode *paused/sleep* saat masa libur sekolah panjang.

---

## 🔄 Panduan Revisi / Penambahan Modul di Masa Depan
1. Buat berkas migrasi baru di folder `cloudflare/migrations/` (misal: `202608240001_add_lab_module.sql`).
2. Tambahkan handler route baru pada `cloudflare/worker.js`.
3. Tambahkan fungsi pemanggilan pada client helper frontend di `js/cloudflare-client.js`.

## 🧩 Refaktor Bertahap `worker.js` → `lib/`
Di Cloudflare tetap **satu Worker** (`simas-smagesa-api`): `wrangler deploy` dan `npm run deploy:worker` membundel `worker.js` beserta modul `lib/` menjadi satu skrip.

Aturan setiap tahap pemindahan:
1. Pindahkan kode **verbatim** (tanpa mengubah logika) ke modul `lib/<domain>.js` dengan *named export* (tanpa `export default`), lalu `import { ... } from './lib/<domain>.js'` di `worker.js`. Satu domain per rilis.
2. `npm run check:worker` — memastikan tidak ada identifier yang lupa di-import, binding import tidak ditimpa, dan bundel esbuild berhasil (otomatis jalan sebelum `npm run test:unit` dan sebelum deploy API).
3. `npm run test:worker:smoke` — menjalankan Worker di workerd lokal dan membandingkan respons dengan `tests/fixtures/worker-smoke.golden.json` (juga dijalankan CI sebelum deploy). Rekam ulang dengan `-- --update` **hanya** bila perubahan perilaku disengaja.
4. Jalankan tes Jest yang menyentuh Worker. Tes lama yang membaca `cloudflare/worker.js` otomatis menerima sumber "datar" (worker.js + modul `lib/`) via `tests/helpers/worker-source-setup.cjs`; tes modul baru memakai `loadWorkerLibModule()` dari `tests/helpers/worker-source.cjs`.
5. Deploy bertahap; bila error naik setelah rilis: `npx wrangler rollback` dari folder `cloudflare/`.

# Reset tahunan: protokol aman (26.09.05.7)

Modul pengaturan memakai `GET/POST /api/students/annual-reset`, khusus Firebase Super Admin (termasuk additional role). Endpoint siswa, mutasi, import, records, dan notifikasi yang lain mempertahankan kontraknya.

- `prepare_cleanup`: satu `operationId` berawalan `cleanup:`, `classes`, dan checkbox `delete_records`/`delete_bk`. Snapshot berdasarkan NIS target disimpan ke D1 tanpa mengubah data sumber.
- `prepare_promotion`: `academicYear` berurutan (misalnya `2025/2026`). ID `promotion:2025/2026` tetap untuk semua retry. Riwayat Firestore lama dan operasi D1 yang sudah commit mencegah reset berulang. Persiapan juga menyimpan field role/penugasan akun wali kelas melalui Firebase token pemanggil, tanpa credential baru.
- `GET ?operationId=...&cursor=...`: snapshot berhalaman (200 baris). Format unduhan mengikuti registry restore. Token snapshot harus tetap sama di seluruh halaman.
- `commit`: membutuhkan `operationId`, `snapshotToken`, `backupAcknowledged: true`. Snapshot dan data terkini dicocokkan dalam transaksi yang sama dengan seluruh DELETE/UPDATE, metadata, audit dan status operasi. Penambahan/perubahan/penghapusan sejak snapshot membatalkan batch. Retry operasi committed tidak mengubah jenjang lagi.
- `finalize`: menyelesaikan field penugasan Firestore menggunakan precondition updateTime. Kegagalan tetap berstatus committed dan dapat dilanjutkan; completed tidak dijalankan lagi. Data akun yang sudah mendapat penugasan baru tidak ditimpa.
- `restore`: allowlist 12 tabel D1 reset, maksimum 100 baris per request, hanya upsert/merge. Kolom mentah database dipertahankan; seluruh request dibatalkan jika satu baris gagal. Restore tidak membuka kembali penguncian tahun promosi. File lama dinormalisasi oleh frontend.
- `GET` tanpa ID: 20 operasi terakhir untuk unduh ulang backup dan melanjutkan penyelesaian. Cron harian menghapus snapshot prepared/completed >30 hari, mempertahankan identitas operasi serta snapshot committed yang masih menunggu Firestore.

Tabel `annual_reset_operations` dan `annual_reset_snapshots` tersedia dalam `migrations/202609050002_annual_reset_snapshots.sql` dan `schema.sql`. Migrasi hanya menambah tabel; endpoint juga menjalankan CREATE IF NOT EXISTS sehingga rollout tidak bergantung pada migrasi manual.

Urutan rilis: deploy Worker, lalu frontend beserta kedua modul JS pengaturan yang baru. Tab dengan kode reset lama mendapat pesan untuk memuat ulang (HTTP 409), tanpa perubahan data. Smoke test baca-saja: buka riwayat reset dengan akun Super Admin. Pengujian mutasi lokal: `node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/annual-reset-endpoints.test.js tests/annual-reset-ui.test.js`.

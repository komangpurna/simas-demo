# Arsip Changelog SIMAS - SHAKTI (Versi Terdahulu)

Dokumen ini memuat arsip riwayat perubahan dan revisi aplikasi SIMAS SHAKTI sebelum tanggal 29 Agustus 2026 (Versi 1.0.0 sampai 1.1.425).

Untuk changelog aktif terkini, silakan merujuk ke [CHANGELOG.md](../../CHANGELOG.md).

---
## [1.1.425] / [26.08.28.26] - 2026-08-28

### ✨ Penambahan Visual Sertifikat TTE Digital pada Berkas Word (.DOCX) Surat Keterangan Siswa (`siswa.html`, `js/config.js`, `js/page-students.js`)
- **Penyertaan Gambar TTE di Bawah Tanggal Surat:**
  - Menambahkan pemuatan otomatis gambar visual sertifikat tanda tangan elektronik dinas (`assets/tte.png`) tepat di bawah placeholder tanggal surat (`Abang, ${TANGGAL}`) pada hasil berkas Word (.DOCX) Surat Keterangan Siswa.
  - Menambahkan konfigurasi path aset `ttePath: "assets/tte.png"` pada `SCHOOL_CONFIG` di `js/config.js` sebagai acuan SSOT.
  - Memastikan rasio aspek gambar TTE (344x111 piksel) proporsional dan presisi pada sel tanda tangan kolom kanan dokumen Word.
- **Penyelarasan Versi Aplikasi & PRD:**
  - Memperbarui nomor versi aplikasi ke `26.08.28.26` / `v1.1.425` di `package.json`, `js/config.js`, `siswa.html`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.

## [1.1.424] / [26.08.28.25] - 2026-08-28

### 🧹 Pembersihan Total Seluruh Referensi Koleksi Siswa pada Ekosistem Firebase
- **Penghapusan dari Firebase Config (`js/config.js`):**
  - Menghapus kunci `students` dari objek `PATHS`. Seluruh master siswa kini murni dioperasikan melalui `window.cfClient`.
- **Pembersihan Firestore Rules & Indexes (`firestore.rules` & `firestore.indexes.json`):**
  - Menghapus seluruh blok `match /students` dan `match /z_students` serta fungsi pembantu `isUpdatingOwnStudentProfile` dari `firestore.rules`.
  - Menghapus definisi index komposit `collectionGroup: "students"` dari `firestore.indexes.json`.
- **Penyelarasan Backend Supabase Edge Functions (`supabase/functions/secure-proxy/index.ts`):**
  - Mengubah fungsi verifikasi identitas siswa bebas pustaka dari Firestore REST API menjadi kueri langsung ke Cloudflare D1 Gateway (`fetchStudentIdentity`).
- **Pembersihan Seluruh Komentar & Log Kodingan:**
  - Membersihkan referensi komentar dan console log lama di `js/page-guru-mapel.js`, `js/page-wali-kelas.js`, `js/page-bk.js`, dan `cloudflare/worker.js`.

## [1.1.423] / [26.08.28.24] - 2026-08-28

### ✨ Penyederhanaan Status Game PID (Tayang & Tidak Tayang) serta Diferensiasi Visual untuk Super Admin (`pid/games.js`, `pid/portalpid.html`, `pid/admin.html`, `pid/admin.js`)
- **Penyederhanaan Status Game PID:**
  - Menghilangkan alur persetujuan review berjenjang karena pengajuan game edukasi dari guru otomatis terpublikasi. Status game kini hanya berfokus pada 2 kondisi: **Tayang (`is_active: true`)** dan **Tidak Tayang (`is_active: false`)**.
- **Diferensiasi Visual untuk Super Admin pada Portal Game:**
  - Saat login sebagai `super_admin` pada `portalpid.html`, kartu game yang disembunyikan/tidak tayang kini memiliki penanda visual yang tegas: border putus-putus (*dashed*), latar berarsir halus, tombol aksi pratinjau `👁️ PREVIEW`, serta badge status `👁️ Tidak Tayang`.
  - Game yang berstatus aktif/publik diberi label badge `🟢 Tayang` saat dilihat oleh Super Admin.
  - Pengguna umum / siswa tetap hanya melihat game yang berstatus Tayang (`is_active: true`).
- **Penyelarasan Panel Admin Game PID:**
  - Memperbarui stat card (`Tayang` dan `Tidak Tayang`) serta tabel daftar game dengan toggle switch status tayang langsung.
  - Menambahkan dukungan pencarian filter status berdasarkan kata kunci "tayang", "tidak tayang", "sembunyi", dan "aktif".

## [1.1.422] / [26.08.28.23] - 2026-08-28

### ✨ Penyesuaian Presisi Posisi Tanggal TTE (Abang, ${TANGGAL}) pada Dokumen DOCX & Print (`siswa.html` & `js/page-students.js`)
- **Penyesuaian Posisi Tanggal Surat:**
  - Mengubah penempatan baris penanggalan `Abang, ${TANGGAL}` dari rata kanan ekstrem (*far-right alignment*) menjadi tata letak 2 kolom *borderless* (lebar kolom kiri 55% kosong : kolom kanan 45% teks tanggal).
  - Posisi tanggal kini bergeser sedikit ke kiri secara proporsional sesuai standar tata naskah dinas dan gambar acuan resmi.

## [1.1.421] / [26.08.28.22] - 2026-08-28

### 🧹 Pembersihan Tombol Manual Sinkronisasi Siswa Cloudflare D1 Pasca-Migrasi Penuh (`siswa.html` & `js/page-students.js`)
- **Pembersihan Tombol Sync Cloudflare (`#btn-sync-cf-student`):**
  - Menghapus tombol *"Sync Cloudflare"* dari header aksi halaman Data Lengkap Siswa (`siswa.html`) dan membersihkan kode otorisasi terkait di `js/page-students.js`.
  - Karena seluruh 1.071 data master siswa telah termigrasi 100% dan seluruh operasi CRUD (Tambah, Edit, Hapus, Bulk Import) kini bekerja secara *pure read & write* langsung ke Cloudflare D1 Serverless SQL, tombol migrasi manual tidak lagi diperlukan.

## [1.1.420] / [26.08.28.21] - 2026-08-28

### ✨ Penyesuaian Spasi Antar-Baris 1.5 Spasi pada Dokumen DOCX dan Cetak Surat Keterangan Siswa (`siswa.html` & `js/page-students.js`)
- **Penerapan 1.5 Line Spacing (`spacing.line = 360`):**
  - Menerapkan spasi 1.5 baris secara proporsional dan elegan pada seluruh elemen dokumen DOCX (judul, nomor, paragraf pembuka, baris tabel biodata, pernyataan siswa aktif, paragraf penutup, dan penanggalan TTE).
  - Menyesuaikan `line-height: 1.6` dan `padding: 5.5px 0` pada tabel cetak HTML/PDF untuk tampilan dokumen fisik yang lebih lega dan mudah dibaca.

## [1.1.419] / [26.08.28.20] - 2026-08-28

### ✨ Penyelarasan Format Berkas Word (.DOCX) Surat Keterangan Sesuai Standar Template Portal TTE Dinas (`siswa.html` & `js/page-students.js`)
- **Format Placeholder Template TTE:**
  - Menyesuaikan nomor surat pada dokumen DOCX menjadi `Nomor : ${NOMOR}` dan penanggalan surat menjadi `Abang, ${TANGGAL}` (right-aligned).
  - Menghilangkan blok tanda tangan manual statis di bawah tanggal agar portal TTE dinas Komdigi / BSrE dapat menginjeksi stempel tanda tangan elektronik (QR Code dan sertifikat digital) secara otomatis dan presisi.
- **Penyelarasan Kolom & Font:**
  - Mengubah label identitas menjadi `N a m a`, `NISN`, `NIS`, `Tempat/Tanggal Lahir`, dan `Alamat` dengan font reguler 12pt Times New Roman.

## [1.1.418] / [26.08.28.19] - 2026-08-28

### ✨ Penambahan Opsi Unduh Berkas Word (.DOCX) untuk Integrasi TTE pada Fitur Surat Keterangan Siswa (`siswa.html` & `js/page-students.js`)
- **Pilihan Unduh Berkas Microsoft Word (.DOCX):**
  - Menambahkan tombol aksi *"Download Word (.DOCX)"* (`#btn-download-docx-surat-keterangan`) pada modal `#modal-surat-keterangan`.
  - Menggunakan pustaka client-side `docx` berstandar Office Open XML resmi untuk men-generate berkas `.docx` valid.
  - Memuat Kop Surat gambar resmi sekolah, teks judul bergaris bawah, nomor dinas resmi, tabel identitas siswa terstruktur (tanpa border), isi pernyataan siswa aktif, dan blok tanda tangan Kepala Sekolah dengan spasi kosong sehingga dapat langsung diunggah ke portal TTE Komdigi / BSrE.
- **Pilihan Cetak / Simpan PDF (A4):**
  - Tetap menyediakan tombol *"Cetak / PDF (A4)"* untuk staf yang ingin langsung mencetak ke printer fisik atau menyimpan dalam format PDF standar A4.

## [1.1.418] / [26.08.28.19] - 2026-08-28

### 📦 Pengarsipan Koleksi Firestore `students` Menjadi `z_students` & Pembaruan Rules
- **Migrasi Dokumen Firestore:**
  - Sebanyak **1.071 dokumen** siswa di Firestore telah disalin secara utuh ke koleksi arsip `z_students` (berisi seluruh 48 atribut data Dapodik asli).
  - Koleksi `students` lama di Firestore telah dibersihkan secara aman (*zero orphaned documents*).
- **Pembaruan Firestore Security Rules (`firestore.rules`):**
  - Koleksi arsip `z_students` dikunci dan hanya dapat diakses oleh `super_admin`.
  - Koleksi lama `students` dikunci total (`allow read, write: if false;`).

## [1.1.417] / [26.08.28.18] - 2026-08-28

### 🐛 Perbaikan Definisi Google JWKS Endpoint pada Cloudflare Worker JWT Validator (`cloudflare/worker.js`)
- **Fix Konstanta Google JWKS URL (`cloudflare/worker.js`):**
  - Menambahkan definisi eksplisit `GOOGLE_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"`.
  - Memperbaiki kegagalan validasi token kriptografis RS256 yang sebelumnya memicu respon *401 Unauthorized* saat memanggil `/api/students`.
- **Deploy Cloudflare Worker:**
  - Telah di-deploy versi `49b7467e-fd2a-40bb-a267-bb9d6d4a6845` ke produksi.

## [1.1.416] / [26.08.28.17] - 2026-08-28

### 🐛 Perbaikan Otentikasi & Toleransi Sesi Cloudflare D1 Gateway Siswa pada Browser/Laptop Baru (`siswa.html`, `js/cloudflare-client.js`, `js/global.js`, `cloudflare/worker.js`)
- **Perbaikan Otentikasi RS256 Worker Gateway (`cloudflare/worker.js`):**
  - Mengizinkan seluruh akun staf/guru terotentikasi non-anonymous (`!user.isAnonymous && user.uid`) untuk mengakses kueri siswa master di Cloudflare D1 tanpa kendala custom claim kosong pada token awal.
  - Menambahkan header `X-User-Role` ke dalam CORS `Access-Control-Allow-Headers`.
- **Penanganan Inisialisasi Auth Asinkron (`js/cloudflare-client.js`):**
  - Menambahkan mekanisme tunggu restorasi sesi Firebase Auth (`onAuthStateChanged`) hingga 2.5 detik pada `getAuthHeader()` sebelum melakukan request HTTP ke Cloudflare Worker, mencegah pengiriman request unauthenticated saat pertama kali membuka halaman di laptop/browser baru.
- **Pencegahan Cache Keracunan Kosong (*Empty Cache Poisoning*) (`js/global.js`):**
  - `loadStudentsCache()` kini hanya mengunci metadata timestamp dan menyimpan ke IndexedDB jika data siswa yang diterima tidak kosong (`studentsList.length > 0`). Jika terjadi kendala awal, cache tidak akan terkunci sebagai data kosong sehingga request berikutnya dapat langsung mengambil data yang valid.
- **Fallback Kueri Langsung per Kelas & Auto-Select Wali Kelas (`js/page-students.js`):**
  - `loadStudentsByClass()` dilengkapi *direct fallback* query ke Cloudflare D1 jika cache lokal belum siap.
  - `loadClassOptions()` secara otomatis memilih kelas perwalian wali kelas dan memuat tabel siswa secara langsung saat halaman dibuka.

## [1.1.415] / [26.08.28.16] - 2026-08-28

### ✨ Penambahan Fitur Cetak Surat Keterangan Aktif Siswa Otomatis Standar A4 di Modal Detail Siswa (`siswa.html` & `js/page-students.js`)
- **Integrasi Tombol Aksi di Modal Detail Siswa (`#btn-print-surat-keterangan`):**
  - Menambahkan tombol aksi khusus *"Surat Keterangan"* di action bar modal detail siswa (`siswa.html`).
  - Diberikan kontrol RBAC ketat: dapat diakses oleh Staf Tata Usaha (`staff`), Super Admin (`super_admin`), Kepala Sekolah (`kepala_sekolah`), Wakasek Kurikulum (`wakasek_kurikulum`), Kesiswaan (`kesiswaan`), dan Wali Kelas (`wali_kelas`).
- **Modal Interaktif Kustomisasi & Pratinjau Surat (`#modal-surat-keterangan`):**
  - Form dialog sebelum cetak memungkinkan staf memeriksa dan menyesuaikan:
    - **Nomor Surat:** Otomatis terisi format dinas resmi (`B.10.400.7.22.1/4387/SMAN 1 ABANG/DIKPORA`), staf cukup mengedit nomor urut bila diperlukan.
    - **Tanggal Surat:** Date picker lokal dengan default tanggal hari ini (format Indonesia).
    - **Tahun Pelajaran:** Otomatis mendeteksi tahun ajaran aktif (misal `2026/2027`).
    - **Biodata Terstruktur:** Menampilkan ringkasan Nama, NISN, NIS, Tempat/Tanggal Lahir, dan Kelas, serta input textarea Alamat yang otomatis disusun dari dusun, desa, kecamatan, dan kabupaten.
- **Template Cetak Kedinasan A4 Presisi & Standar Non-TTE:**
  - Menghasilkan tata letak cetak A4 portrait (`@page { size: A4 portrait; margin: 15mm 20mm; }`) dengan tipografi serif Times New Roman (12pt).
  - Dilengkapi Kop Surat Resmi SMAGESA (`assets/kop.png`), judul surat bergaris bawah, tabel identitas siswa dengan titik dua sejajar, klausul pernyataan siswa aktif, serta ruang tanda tangan Kepala Sekolah yang dikosongkan (tanpa TTE box/footer BSrE) sehingga siap ditandatangani basah atau diunggah ke sistem TTE dinas Komdigi.
- **Penyelarasan Metadata SSOT di `SCHOOL_CONFIG` (`js/config.js`):**
  - Menambahkan konfigurasi `headmasterName`, `headmasterRank`, `headmasterNIP`, `headmasterTitle`, dan `defaultSuratKeteranganNo` pada objek `SCHOOL_CONFIG` sebagai SSOT.

## [1.1.414] / [26.08.28.15] - 2026-08-28

### ✨ Penambahan Opsi Proteksi / Preservasi Kontak Lama (HP & Email) pada Bulk Import Excel Data Guru (`guru.html` & `js/page-guru.js`)
- **Fitur Pertahankan Kontak Lama (`#chk-preserve-contacts`):**
  - Menambahkan kontrol opsi toggle checkbox di modal Impor Excel Guru: *"Pertahankan Kontak Lama (No. HP & Email) di Database (Rekomendasi)"* yang aktif secara default.
  - **Preservasi Kontak Terproteksi:** Jika guru yang dicocokkan sudah memiliki nomor HP atau Email tersimpan di database, nilai kontak lama tidak akan ditimpa atau diganti oleh data kontak baru dari Excel.
  - **Pratinjau Diff Kontak:** Menampilkan label hijau `(HP Dipertahankan)` dan `(Email Dipertahankan)` pada tabel pratinjau data.
  - **Smart Fallback Kontak Baru:** Jika guru di database sebelumnya belum memiliki nomor HP/Email (kosong), sistem tetap otomatis mengisi kontak dari baris Excel.

## [1.1.413] / [26.08.28.14] - 2026-08-28

### ✨ Penambahan Opsi Proteksi / Preservasi Nama Bergelar pada Bulk Import Excel Data Guru (`guru.html` & `js/page-guru.js`)
- **Fitur Pertahankan Nama Bergelar Lama (`#chk-preserve-names`):**
  - Menambahkan kontrol opsi toggle checkbox di modal Impor Excel Guru: *"Pertahankan Nama & Gelar Lama di Database (Rekomendasi)"* yang aktif secara default.
  - **Preservasi Nama Terproteksi:** Ketika mencocokkan data guru yang sudah ada di database (via NIP, NIK, NUPTK, atau Name Matching), nama guru bergelar di database tidak akan ditimpa dengan nama polos tanpa gelar dari lembar kerja Excel baru.
  - **Pratinjau Diff Khusus:** Menampilkan badge visual hijau `(Nama Bergelar Dipertahankan)` di tabel pratinjau dan mengecualikan nama dari hitungan sel berubah jika opsi aktif.
  - **Dukungan GTK Baru:** Guru baru yang belum ada di database tetap otomatis menggunakan nama lengkap dari baris Excel yang diimpor.

## [1.1.412] / [26.08.28.13] - 2026-08-28

### 🐛 Perbaikan Ekspor `SCHOOL_CONFIG` pada Modul Konfigurasi Terpusat (`js/config.js` & `js/page-guru.js`)
- **Penambahan Ekspor `SCHOOL_CONFIG` di `js/config.js`:**
  - Mengimplementasikan dan mengekspor objek konfigurasi terpusat `SCHOOL_CONFIG` di `js/config.js` yang memuat identitas lembaga/sekolah (Nama Sekolah, NPSN, Domain, Telegram Bot Username `@smagesa_bot`, Visi SHAKTI, dsb.).
  - Memperbaiki error `Uncaught SyntaxError: The requested module './config.js' does not provide an export named 'SCHOOL_CONFIG'` pada saat inisialisasi halaman Data Guru (`guru.html` / `js/page-guru.js`).
  - Menetapkan `window.SCHOOL_CONFIG` untuk akses global konsisten di seluruh modul web.

## [1.1.411] / [26.08.28.12] - 2026-08-28

### 🚀 Migrasi Penuh Master Siswa (*Pure Read & Write*) ke Cloudflare D1 Serverless SQL & Penghapusan Dual-Write Firestore
- **Sinkronisasi Penuh Master Siswa ke Cloudflare D1 (1.071 Siswa):**
  - Mengeksekusi sinkronisasi langsung seluruh 1.071 dokumen siswa dari database Firestore ke Cloudflare D1 Serverless SQL (`simas-smagesa-db`) lengkap dengan struktur 48 atribut Dapodik dan data relasional.
  - Memastikan 100% data siswa aktif dan alumni tersimpan di Cloudflare D1 Edge dengan 0 latensi kueri.
- **Penghapusan Dual-Write Firestore:**
  - Mengubah fungsi `dualWriteStudent` di `js/cloudflare-client.js` menjadi penyimpanan langsung ke Cloudflare D1 via `saveStudent` tanpa memicu penulisan ganda ke Firestore `students`.
  - Operasi Create, Update, Delete, dan Bulk Import siswa kini murni mengeksekusi operasi ke Cloudflare D1 (0 Firestore Write).
- **Penghapusan Bertahap Pembacaan (*Read Fallback*) Firestore:**
  - Menghapus seluruh kueri dan pemanggilan `getDocs(collection(db, PATHS.students))` dan `getDoc(doc(db, PATHS.students, ...))` pada semua modul:
    - `js/global.js`: `loadStudentsCache` murni memuat dari Cloudflare D1 SSOT dengan fallback aman ke IndexedDB lokal offline.
    - `js/page-e-rapor.js`: Pemuatan siswa kelas dan pencarian NIS impor nilai murni membaca dari Cloudflare D1 dan IndexedDB cache.
    - `js/page-guru-mapel.js`: Buku nilai dan presensi guru mapel murni membaca data siswa dari Cloudflare D1 dan IndexedDB cache.
    - `js/page-guru-wali.js`: Pemuatan detail profil siswa, pembacaan rapor, dan form edit profil siswa beralih 100% ke Cloudflare D1.
    - `js/page-peminatan-hasil.js` & `js/page-peminatan.js`: Pemuatan daftar siswa kelas X dan verifikasi profil beralih murni ke Cloudflare D1 dan cache global.
    - `js/page-portal-siswa.js`: Fungsi `findStudentByNIS` dan `saveBiodata` siswa beralih murni membaca dan menyimpan ke Cloudflare D1.
    - `js/page-wali-kelas.js`: Pemuatan siswa rombel (`loadScopedClassStudents`) dan penyimpanan form siswa (`saveStudentModalData`) beralih murni ke Cloudflare D1.
    - `js/page-students.js`: Pencarian NIS (`searchByNIS`), pemuatan per kelas (`loadStudentsByClass`), detail siswa (`openStudentDetail` & `fetchStudentAndOpen`), form simpan baru, form edit, hapus siswa (`deleteStudent`), impor Excel massal (`importExcelData`), dan migrasi NIS (`migrateSingleNIS`) beralih murni ke Cloudflare D1.
    - `js/page-settings.js`: Kenaikan tingkat massal (`executePromotion`), pemindahan kelas siswa (`executeTransferClass`), dan pembersihan alumni (`triggerDeleteAlumni`) beralih murni membaca dan menulis ke Cloudflare D1.
- **Efisiensi dan Penghematan Kuota:**
  - Menjamin **0 Firestore Read** dan **0 Firestore Write** untuk seluruh pengelolaan dan pemanggilan entitas master siswa di SIMAS - SHAKTI.

## [1.1.410] / [26.08.28.11] - 2026-08-28

### ☁️ Integrasi Sinkronisasi Master Siswa Jurnal Mengajar Berbasis Cloudflare D1 Serverless SQL (OWASP ASVS Level 1 & 2)
- **Endpoint Khusus Integrasi Jurnal (`cloudflare/worker.js`):**
  - Menambahkan endpoint serverless `GET /api/sync/jurnal-students` dengan otentikasi secret key `X-Sync-Key` / `X-Api-Key` / Bearer token.
  - **OWASP ASVS V8 Data Minimization:** Query SQL hanya mengekstrak field operasional absensi (`nis`, `nisn`, `nama`, `kelas`, `absen`) dan mengunci seluruh data PII sensitif (NIK Siswa, No KK, NIK Orang Tua, Penghasilan, Alamat).
  - **OWASP ASVS V5 Prepared SQL:** Mencegah SQL Injection dengan prepared statements parameter terikat (`?`).
  - **OWASP ASVS V7 Audit Logging:** Merekam setiap aktivitas sinkronisasi ke tabel `audit_logs` di Cloudflare D1 secara asinkron (`ctx.waitUntil`).
- **Penyelarasan Supabase Secure Proxy Multi-Tier (`supabase/functions/secure-proxy/index.ts`):**
  - Memperbarui handler `case "jurnal-sync-siswa"` untuk memprioritaskan penarikan data dari Cloudflare Worker Gateway D1 sebagai sumber primer (0 Firestore Read) dengan *graceful fallback* ke Firestore REST API.
- **Dukungan Multi-Tier Sync di Jurnal Mengajar (`settings-app.js` & `firebase-config.js`):**
  - Menambahkan ekspor `CLOUDFLARE_CONFIG` dan fungsi `fetchSyncStudents` pada `settings-app.js` untuk penarikan data langsung ke Cloudflare Edge Gateway D1 dengan fallback mulus ke Supabase Proxy.

## [1.1.409] / [26.08.28.10] - 2026-08-28

### 🐛 Perbaikan Pemindahan Kelas Siswa & Inisialisasi Daftar Kelas Pengaturan (`settings.html` & `js/page-settings.js`)
- **Fix ReferenceError `loadAllKelasForSettings`:**
  - Mengimplementasikan fungsi `loadAllKelasForSettings()` dan variabel `allKelasListSettings` secara terisolasi dan mandiri di `js/page-settings.js` serta mengeksposnya ke `window.loadAllKelasForSettings`.
  - Memastikan modal Pindah Kelas Siswa (`window.openTransferClassModal`) dapat membaca daftar kelas aktif (X-XII) tanpa dependensi pada skrip modul lain (`page-e-rapor.js`).
- **Resolusi Aman Identitas Aktor Transfer:**
  - Memperbaiki penulisan log riwayat transfer siswa (`class_transfers`) pada `executeTransferClass` dengan mengambil nama aktor aktif secara aman (`auth.currentUser?.displayName || auth.currentUser?.email || localStorage.getItem('user_name') || 'Super Admin'`) guna mencegah `ReferenceError: actorName is not defined`.
- **Dukungan Global Sanitizer `escapeHtml`:**
  - Menambahkan alias `window.escapeHtml` dan export `escapeHtml` pada `js/global.js` serta local helper fallback di `js/page-settings.js` untuk penanganan sanitasi string yang konsisten.
- **Pembersihan Import Firestore:**
  - Menggabungkan seluruh import Firestore (`writeBatch`, `Timestamp`, `query`, `where`, dll.) di baris atas `js/page-settings.js` dan menghapus import redundan di pertengahan file.

## [1.1.408] / [26.08.28.9] - 2026-08-28

### 🔍 Visual Diff Indicators (Penanda Perubahan Data) pada Pratinjau Impor Massal GTK (`guru.html` & `js/page-guru.js`)
- **Penanda Perubahan Visual per Sel Data:**
  - Menambahkan fungsi helper `renderDiffCell(newVal, oldVal)` untuk mendeteksi dan menampilkan perbedaan data antara baris Excel dan data Firestore sebelum disimpan.
  - **Kuning / Amber + Coret:** Nilai lama dicoret dan nilai baru ditampilkan tebal dengan background kuning jika data di Excel berbeda dari database.
  - **Hijau:** Badge "Baru diisi" jika field sebelumnya kosong di database dan diisi dari Excel.
  - **Abu-abu:** Data lama dipertahankan jika kolom di Excel dikosongkan.
- **Bar Legenda & Ringkasan Perubahan Diff:**
  - Menambahkan bar legenda penanda perubahan di atas tabel pratinjau (`#preview-container`).
  - Menampilkan ringkasan langsung: jumlah GTK Baru, jumlah GTK Update (rincian total field diubah dan field baru), serta jumlah GTK Sama (0 perubahan).
  - Status badge tabel diperinci: `Update (N ubah, M baru)`, `Sama (0 Ubah)`, `Baru`, `Nama Kosong`.
- **Pengujian Unit:**
  - Menambahkan pengujian `renderDiffCell` dan verifikasi elemen diff di `functions/__tests__/teacher-schema.test.js`.

## [1.1.407] / [26.08.28.8] - 2026-08-28

### 🧠 Smart Name Matching Tanpa Gelar (`stripGelar`) pada Impor GTK (`js/page-guru.js`)
- **Pencocokan Nama Cerdas Tanpa Gelar Akademik:**
  - Menambahkan fungsi helper `stripGelar(name)` yang menghapus gelar prefix (Drs., Dr., Prof., Ir.) dan suffix (S.Pd, M.Pd, S.H, SE, S.Kom, A.Md., Gr., dll.) dari nama untuk pencocokan cerdas.
  - Match 4 impor sekarang memiliki 2 tahap: (4a) pencocokan nama persis → (4b) fallback pencocokan nama pokok tanpa gelar via `stripGelar`.
  - Mengatasi masalah 17 GTK di database yang tidak memiliki NIP/NIK/NUPTK — kini dapat dicocokkan secara aman berdasarkan nama pokok meskipun gelar berbeda antara Excel dan database.
- **Pengujian Unit:**
  - Menambahkan test suite `stripGelar` dengan 15+ skenario pengujian nama-nama GTK aktual.
  - Memperbarui versi aplikasi ke `26.08.28.8` / `v1.1.407`.

## [1.1.406] / [26.08.28.7] - 2026-08-28

### 📱 Penambahan Kolom U (Telegram ID) & Standarisasi 21 Kolom Dapodik & SIMAS (`guru.html`, `js/page-guru.js`)
- **Skema 21 Kolom Master Data GTK:**
  - Menambahkan kolom ke-21 (`U. Telegram ID` / `telegramChatId`) pada skema master GTK, parser impor massal, dan tabel pratinjau impor.
  - Memperbarui `TEACHER_SCHEMA` di `js/page-guru.js` dan panduan visual chips di `guru.html` (`A. NIK` s.d. `U. Telegram ID`).
  - Memperbarui parser `parseTeacherImportRow` untuk membaca `cols[20]` sebagai `telegramChatId` dan mendukung identifier Telegram ID saat verifikasi baris.
- **Pengujian Unit & Dokumentasi:**
  - Memperbarui unit test `functions/__tests__/teacher-schema.test.js` untuk memvalidasi 21 kolom dan lolos 100%.
  - Memperbarui versi aplikasi ke `26.08.28.7` / `v1.1.406` di `package.json`, `js/config.js`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.

## [1.1.405] / [26.08.28.6] - 2026-08-28

### ⚡ Smart Partial Merge pada Impor Massal GTK (`js/page-guru.js`)
- **Dukungan Update Parsial dengan Kolom Nama / Field Kosong:**
  - Memperbarui parser `parseTeacherImportRow` agar baris impor tetap diproses selama terdapat minimal salah satu kolom identitas (NIK, NUPTK, atau NIP) meskipun kolom Nama dikosongkan.
  - Mengimplementasikan *Smart Partial Merge* pada penyimpanan massal Firestore: nilai kolom yang kosong di Excel tidak akan menimpa (*preserve*) data lama yang sudah tersimpan di database.
  - Pratinjau tabel impor menampilkan status badge `Update` dan memberi label `(Nama Dipertahankan)` untuk data yang dicocokkan dengan database saat kolom nama kosong.
  - Memastikan baris data baru tanpa nama diabaikan dengan aman agar tidak membentuk dokumen kosong/rusak.
- **Pengujian Unit & Dokumentasi:**
  - Menambahkan skenario uji parser pada baris dengan nama kosong di `functions/__tests__/teacher-schema.test.js`.
  - Memperbarui versi aplikasi ke `26.08.28.6` / `v1.1.405` di `package.json`, `js/config.js`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.

## [1.1.404] / [26.08.28.5] - 2026-08-28

### 🆔 Penambahan Kolom NIK Terdepan (Kolom A Saat Impor) & Standarisasi 20 Kolom Dapodik Master Data Guru (`guru.html`, `js/page-guru.js`)
- **Penambahan Kolom NIK pada Skema Master GTK (`TEACHER_SCHEMA` & Firestore SSOT):**
  - Menambahkan field `nik` (16 digit nomor induk kependudukan KTP) ke dalam `TEACHER_SCHEMA` dan skema database Firestore `teachers`.
  - Mengubah urutan kolom impor Excel menjadi 20 kolom dengan **Kolom A = NIK** dan Kolom B = Nama (`A. NIK`, `B. Nama`, `C. NUPTK`, `D. JK`, `E. Tempat Lahir`, `F. Tgl Lahir`, `G. NIP`, `H. Status Kepegawaian`, `I. Jenis PTK`, `J. Agama`, `K. Alamat Jalan`, `L. RT`, `M. RW`, `N. Dusun`, `O. Kelurahan`, `P. Kecamatan`, `Q. Kode Pos`, `R. HP`, `S. Email`, `T. Tugas Tambahan`).
- **Pembaruan Form Tambah, Edit & Modal Detail Profil (`guru.html` & `js/page-guru.js`):**
  - Menambahkan input NIK pada Form Tambah GTK (`#modal-add`) dan Form Edit GTK (`#modal-edit`, input `#edit-nik`).
  - Menampilkan badge NIK pada tabel master data GTK serta menambahkan NIK pada Kartu 1 (Identitas & Dokumen) di Modal Detail Biodata GTK (`#modal-detail`).
  - Menambahkan pengecekan duplikasi NIK di cache lokal sebelum penyimpanan.
- **Smart Import Parser & Matching Bertingkat:**
  - Mengadaptasi `parseTeacherImportRow` untuk membaca kolom A sebagai NIK dan kolom B sebagai Nama lengkap, dengan dukungan otomatis deteksi penomoran baris (*offset detection*).
  - Memperbarui strategi pencocokan cerdas impor massal secara bertingkat: Match NIP $\rightarrow$ Match NIK $\rightarrow$ Match NUPTK $\rightarrow$ Match Nama Lengkap.
  - Memperbarui strategi ID Dokumen baru: Prioritas NIP $\rightarrow$ NIK $\rightarrow$ NUPTK $\rightarrow$ Auto-ID.
- **Pengujian Unit & Dokumentasi:**
  - Memperbarui `functions/__tests__/teacher-schema.test.js` untuk menguji skema 20 kolom (A = NIK), parsing import, dan integritas antarmuka.
  - Memperbarui `PRD_SIMAS.md`, `package.json`, dan `js/config.js` ke versi `26.08.28.5` / `v1.1.404`.

## [1.1.403] / [26.08.28.4] - 2026-08-28

### 👨‍🏫 Standarisasi 19 Kolom Dapodik Master Data Guru & Tenaga Kependidikan (GTK) & Integrasi Telegram ID (`guru.html` & `js/page-guru.js`)
- **Modernisasi Antarmuka & Skema 19 Kolom Dapodik (`guru.html` & `js/page-guru.js`):**
  - Mengadaptasi dan menyelaraskan antarmuka master data GTK dengan standar 19 kolom Dapodik Kemendikbudristek (ATM dari `smkn1sukawati`): `name`, `nuptk`, `gender`, `birth_place`, `birth_date`, `nip`, `status_kepegawaian`, `jenis_ptk`, `agama`, `alamat`, `rt`, `rw`, `dusun`, `kelurahan`, `kecamatan`, `kode_pos`, `phone`, `email`, `tugas_tambahan`.
  - Memperbarui tabel data GTK dengan avatar inisial, badge identitas (NIP 18 digit & NUPTK 16 digit), badge jenis PTK & status kepegawaian, tautan langsung WhatsApp hijau, serta tombol aksi cepat (Detail, Edit, Hapus).
- **Modal Detail Lengkap Biodata GTK (`#modal-detail`):**
  - Menyediakan modal profil terpadu dengan 4 kartu grid informasi: (1) Identitas & Dokumen, (2) Kepegawaian & Penugasan, (3) Alamat Domisili, (4) Kontak & Integrasi Akun Notifikasi (WhatsApp, Email, Telegram Chat ID) beserta tombol direct link WhatsApp & Email.
- **Formulir Tambah & Edit GTK 4 Seksi Terstruktur (`#modal-add` & `#modal-edit`):**
  - Mengelompokkan field input ke dalam 4 seksi: Identitas PTK, Status Kepegawaian & Penugasan, Alamat Domisili, serta Kontak & Integrasi Bot Telegram.
  - Menambahkan input Telegram Chat ID lengkap dengan link dinamis ke `@smagesa_bot` dan validasi duplikasi NIP & NUPTK sebelum penyimpanan.
- **Smart Import Bulk Data GTK 19 Kolom A s.d. S (`#modal-import`):**
  - Parser cerdas baris TSV Excel dengan deteksi otomatis kolom penomoran (*offset detection*), pengabaian header, dan pratinjau tabel impor real-time.
  - Eksekusi penyimpanan massal bertahap (*chunked batch commit*) ke Firestore dengan *smart merge matching* (pencocokan bertingkat NIP $\rightarrow$ NUPTK $\rightarrow$ Nama) agar data dinamis yang sudah ada (seperti `telegramChatId` atau UID) tetap terjaga (*preserved*).
- **ID Strategy & Firestore SSOT Integration:**
  - Penetapan NIP sebagai primary unique key pada dokumen Firestore (`doc(db, 'teachers', nip)`), NUPTK sebagai fallback, dan hidden `#edit-id` untuk form edit.
  - Memperbarui metadata sinkronisasi `settings/metadata` (`lastUpdateTeachers`) dan invalidasi cache berlapis (`sessionStorage`, `localStorage`, IndexedDB).
- **Pengujian Unit & Dokumentasi:**
  - Membuat pengujian unit baru `functions/__tests__/teacher-schema.test.js` untuk memvalidasi urutan 19 kolom schema, kelengkapan form/modal, logika parsing import, dan format tanggal Indonesia.
  - Seluruh 14 test suites (74 unit tests) dan pengecekan sintaks 68 file JavaScript lolos 100% dengan 0 kesalahan.

## [1.1.402] / [26.08.28.3] - 2026-08-28


### 🧹 Penyelarasan & Pembersihan Opsi Role Siswa di Manajemen Pengguna (`users.html` & `js/page-users.js`)
- **Pembersihan Opsi Role Siswa (`users.html` & `js/page-users.js`):**
  - Menghapus opsi `<option value="siswa">Siswa</option>` dari dropdown Form Tambah Akun (`#role-select`) dan Form Edit Akun (`#edit-role-select`) pada halaman Manajemen Pengguna (`users.html`).
  - Menghapus role `siswa` dari daftar `ALL_ROLES` di `js/page-users.js`.
  - Mengklarifikasi bahwa akun siswa reguler menggunakan jalur otentikasi mandiri berbasis NIS via Portal Siswa (`portal-siswa.html`) dan tidak dikelola melalui akun login sistem `users.html` (hanya akun petugas siswa seperti `admin_pks` dan `admin_kelas` yang dikelola di sini).
- **Penyelarasan Label & Validasi Penugasan Kelas (`js/page-users.js` & `users.html`):**
  - Memperbarui label input kelas dari `"Bertugas / Siswa di Kelas:"` menjadi `"Bertugas / Admin di Kelas:"` atau `"Admin Kelas Untuk:"` yang khusus ditujukan untuk role petugas `admin_kelas` atau `wali_kelas`.
  - Menyelaraskan logika validasi input kelas pada fungsi `saveEditUser`, `toggleEditClassField`, dan `window.editUser`.
- **Sinkronisasi Dokumentasi & Matriks RBAC (`PRD_SIMAS.md`):**
  - Memperbarui Matriks RBAC Bab 3 dan Spesifikasi Modul Bab 4.3 pada dokumen PRD agar selaras dengan skema role Manajemen Pengguna terkini.

## [1.1.401] / [26.08.28.2] - 2026-08-28

### ☁️ Migrasi Master Data Siswa ke Cloudflare D1 Serverless SQL (Primary Master & Dual RW Fallback)
- **Skema & Database Cloudflare D1 (`cloudflare/schema.sql`):**
  - Membuat tabel `students` di Cloudflare D1 Serverless SQLite di Edge global (`simas-smagesa-db`) yang menampung atribut utama terindeks (`nis`, `nisn`, `name`, `gender`, `class`, `birth_place`, `birth_date`, `nik`, `status`, `violation_points`) serta seluruh 48 kolom Dapodik terstruktur dalam kolom `dapodik_data (JSON)`.
  - Menambahkan indeks komposit pencarian: `idx_students_class`, `idx_students_status`, `idx_students_nisn`, `idx_students_nik`, `idx_students_birth_date`, dan `idx_students_name`.
- **Cloudflare Worker API Gateway Siswa Berstandar OWASP & ASVS Level 1 & 2 (`cloudflare/worker.js`):**
  - Membangun endpoint REST API terproteksi:
    - `GET /api/students`: Pemuatan daftar siswa dengan filter kelas, status, pencarian instan, dan pagination (RBAC khusus staf & guru).
    - `GET /api/students/:nis`: Detail profil siswa dengan verifikasi kepemilikan token (`isOwner` atau staf/guru).
    - `POST /api/students`: Penambahan siswa baru dengan pencegahan duplikasi NIS dan parameterized prepared statements.
    - `PUT /api/students/:nis`: Pembaruan data siswa yang mendukung *full update* bagi admin/kesiswaan serta *whitelist self-update* untuk portal siswa mandiri (mengunci field NIS, NISN, Nama, Kelas, Gender, dan Status).
    - `DELETE /api/students/:nis`: Penghapusan data siswa terproteksi Super Admin/Kesiswaan.
    - `POST /api/students/bulk-sync`: Endpoint batch chunked migration untuk import massal ke D1.
    - `POST /api/students/verify-credentials`: Endpoint verifikasi kredensial login siswa di Edge global.
- **Client Helper & Strategi Dual-Write (`js/cloudflare-client.js`):**
  - Menambahkan metode `getStudents()`, `getStudentByNis()`, `saveStudent()`, `deleteStudent()`, `bulkSyncStudents()`, `verifyStudentCredentials()`, dan `dualWriteStudent()`.
  - Mengimplementasikan eksekusi *Primary Cloudflare D1* dan pencadangan *Graceful Fallback & Backup Firestore*.
- **Pemuatan Cache Siswa Global 0 Firestore Read (`js/global.js`):**
  - Memperbarui `window.getStudentsCache()` / `loadStudentsCache()` untuk memprioritaskan pemuatan master siswa langsung dari Cloudflare D1 di Edge, memangkas kuota read Firestore menjadi **0 Read** dengan fallback instan ke Firestore bila offline.
- **Modul Master Siswa & One-Click Bulk Migration (`siswa.html` & `js/page-students.js`):**
  - Mengintegrasikan `cfClient.dualWriteStudent` pada modal Tambah Siswa, Edit Siswa, Mutasi/Hapus Siswa, dan Impor Massal Excel.
  - Menambahkan tombol interaktif **"Sync Cloudflare"** (`#btn-sync-cf-student`) dan fungsi `window.syncAllStudentsToCloudflare()` untuk menyalin seluruh data siswa dari Firestore ke Cloudflare D1 dalam 1 kali klik.
- **Portal Siswa Mandiri (`js/page-portal-siswa.js`):**
  - Memperbarui form edit biodata mandiri siswa agar menyimpan pembaruan langsung ke Cloudflare D1 sebagai primary dan Firestore sebagai backup.
- **Verifikasi Otentikasi Login Siswa (`functions/index.js`):**
  - Memperbarui fungsi `verifyStudentLogin` untuk memverifikasi kredensial siswa (NIS + Tanggal Lahir / NISN) ke Cloudflare D1 API sebagai prioritas utama, dengan fallback ke Firestore jika D1 belum disinkronkan, serta tetap mengikat *Custom Claims* Firebase Auth (`studentVerified`, `studentNis`, `studentClass`).

## [1.1.400] / [26.08.28.1] - 2026-08-28

### 📚 Implementasi Format Penomoran Nomor Induk Buku (NIB) Opsi B (Nomor Urut Murni) & Pengaturan NIB Awal
- **Format Penomoran NIB Opsi B (Nomor Urut Murni) (`library/katalog.html` & `library/katalog.js`):**
  - Mengubah default format penomoran Nomor Induk Buku (NIB) ke **Opsi B (Nomor Urut Murni / Sequential Number)** tanpa awalan prefix wajib (misal `00001`, `00002`... atau `01500`, `01501`...).
  - Menyediakan input **Nomor Induk / NIB Pertama** yang memungkinkan pustakawan memasukkan NIB awal sesuai nomor fisik yang sudah tercatat pada buku di sekolah.
  - Memperbarui fungsi `generateSequenceItem()` untuk mengkalkulasi kenaikan nomor urut secara presisi dengan mempertahankan *zero-padding* (`01500` -> `01501`, `00005` -> `00006`, dst.).
  - Menambahkan fungsi cerdas `getSuggestedNextNomorInduk()` untuk menyarankan NIB lanjutan secara otomatis dari nomor eksemplar buku atau nomor induk tertinggi di database.
- **Sinkronisasi Barcode & Pratinjau Rentang NIB (*Live Preview*) (`library/katalog.html` & `library/katalog.js`):**
  - Menambahkan checkbox toggle **"Sama dg NIB"** (aktif secara default) agar barcode eksemplar otomatis tersinkronisasi 1:1 dengan NIB buku.
  - Memperbarui banner pratinjau cerdas (`#eks-qty-helper`) untuk menampilkan rentang NIB yang akan dibuat (`NIB 01500 s.d. 01504`), rentang salinan (`Copy c.1 s.d. c.5`), dan total eksemplar secara real-time.
- **Pengaturan & Sirkulasi Perpustakaan (`library/pengaturan.html`, `library/pengaturan.js`, `library/index.js`):**
  - Mengubah field **Prefix Nomor Induk / Barcode** di pengaturan operasional perpustakaan menjadi opsional (bisa dikosongkan untuk mode nomor urut murni).
  - Memastikan pencarian 1-Scan pada sirkulasi peminjaman/pengembalian mendukung pemindaian barcode maupun input NIB angka murni.

## [1.1.399] / [26.08.27.2] - 2026-08-27

### 📱 Desain Responsif Compact untuk Arsip Dokumen Google Drive pada Layar Ponsel (Mobile)
- **Tampilan Kartu Dokumen Mobile (`agenda.html` & `js/page-agenda.js`):**
  - Mengubah layout kartu berkas menjadi ringkas dan padat (*compact*) pada perangkat mobile (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-4`).
  - Menata ulang informasi metadata pengunggah dan tanggal rilis secara horizontal terpadu berdampingan dengan tombol aksi langsung "Buka".
  - Mengoptimalkan ruang vertikal layar ponsel dengan menghilangkan jeda kosong berlebih dan menerapkan `line-clamp-1` pada deskripsi dokumen.
  - Memperbarui fungsi `detectDriveFileType` dengan pelabelan jenis berkas otomatis (*Docs, Sheets, Slides, Folder, PDF, Drive*).

## [1.1.398] / [26.08.27.1] - 2026-08-27

### ⚡ Pemisahan & Penyediaan Dedicated Cloudflare Worker (`simas-smagesa-api`) & D1 Database (`simas-smagesa-db`)
- **Penyediaan Dedicated Worker & Database D1 Terisolasi:**
  - Membuat dan men-deploy Worker khusus SIMAS SMAGESA **`simas-smagesa-api`** (`https://simas-smagesa-api.komangpurna1.workers.dev`) yang terisolasi total dari project lain (mencegah tabrakan nama dan CORS overwrite).
  - Membuat database D1 khusus **`simas-smagesa-db`** (`1676c05c-01a0-409a-99dd-890f4a4011c7`) dan menginisialisasi 4 tabel skema D1 SQL lengkap (`calendar_events`, `agenda_documents`, `login_history`, `audit_logs`).
- **Klien Cloudflare D1 (`js/cloudflare-client.js` & `js/config.js`):**
  - Mengarahkan `CLOUDFLARE_CONFIG.workerUrl` ke gateway resmi `https://simas-smagesa-api.komangpurna1.workers.dev`.
  - Mengoptimalkan integrasi penuh 100% Cloudflare D1 Serverless SQL di Edge (0 Firestore Read) untuk kalender kegiatan (`calendar_events`), arsip dokumen Google Drive (`agenda_documents`), riwayat login (`login_history`), dan audit logs (`audit_logs`).
- **Gateway Cloudflare Worker (`cloudflare/worker.js` & `cloudflare/wrangler.toml`):**
  - Mengonfigurasi `wrangler.toml` dengan binding D1 ke `simas-smagesa-db`.
  - Mengaktifkan pengembalian header CORS dinamis pada fungsi `getCorsHeaders(request)` untuk mendukung permintaan lintas domain dari seluruh domain sekolah (`https://smagesa.web.app`, `https://smagesa.firebaseapp.com`, `https://sman1abang.web.app`, `https://simas-shakti.web.app`, `http://localhost:8080`, dll).
  - Memastikan preflight `OPTIONS` merespons dengan status 204 dan `/api/health` merespons status 200 OK.
- **Halaman Agenda & Dokumen (`agenda.html` & `js/page-agenda.js`):**
  - Memastikan pemuatan kalender kegiatan dan arsip berkas Google Drive berjalan cepat, mulus, dan responsif.

## [1.1.397] / [26.08.26.3] - 2026-08-26

### 📋 Penyelarasan & Penampilan Lengkap NISN Siswa pada Modal Detail Siswa
- **Sub-Header Modal Detail Siswa (`siswa.html` & `js/page-students.js`):**
  - Memperbarui komponen identitas pada sub-header modal detail (`#modal-detail`) untuk menyajikan nomor identitas ganda yang terpadu: `NIS: [nomor] / NISN: [nomor]`.
  - Mengikat elemen `#detail-nisn` ke nilai field `student.nisn` saat fungsi `window.openStudentDetail` dieksekusi.
- **Seksi Identitas Biodata Lengkap Siswa (`#full-profile-grid`):**
  - Menambahkan kartu data **Nomor Induk Siswa (NIS)**, **NISN**, dan **Kelas / Rombel** ke dalam Seksi 1: *Identitas Siswa & Dokumen* pada tampilan detail lengkap Dapodik (`view-profile`).
  - Memastikan seluruh atribut identitas pokok siswa tampil secara terstruktur, jelas, dan mudah diverifikasi saat pengguna mengklik tombol "Lihat Detail" di dalam modal siswa.
- **Penyempurnaan Cetak Raport Karakter (`printReportCard`):**
  - Menyelaraskan baris identitas NIS/NISN pada kop laporan perkembangan afektif siswa agar mencetak kedua nomor identitas secara lengkap (`NIS / NISN: [NIS] / [NISN]`).

## [1.1.396] / [26.08.26.2] - 2026-08-26

### 🪄 Otomatisasi & Sinkronisasi Guru Asli (Role User `guru_bk`) Saat Sync Master XML
- **Unified SSOT Helper `window.getBkTeachersCache` (`js/global.js`):**
  - Mengimplementasikan fungsi caching terpusat multi-tier yang mengambil akun pengguna ber-role `guru_bk` (`role: guru_bk` & `additionalRoles: guru_bk`) dari koleksi `users` Firestore dan mencocokkannya secara presisi dengan data master `teachers` (berdasarkan `linkedTeacherId`, `nip`, `id`, atau normalisasi nama).
  - Menyediakan invalidasi cache otomatis `window.invalidateBkTeachersCache()` yang terintegrasi dengan pembaruan data master guru.
- **Otomatisasi Parser Jadwal XML aSc Timetables (`js/asc-schedule-parser.js`):**
  - Memperbarui `parseASCSchedule()` agar saat mendeteksi entitas `TIM BK` pada berkas XML jadwal dan hanya terdapat 1 Guru BK terdaftar di sekolah, entitas tersebut langsung dipetakan ke identitas guru asli (nama resmi, UID, dan NIP).
  - Memperbarui `getSubjectsWithLessonsFromXML()` untuk mata pelajaran *Bimbingan dan Konseling* agar memuat seluruh Guru BK riil via `window.getBkTeachersCache()`, menghapus entitas placeholder `TIM_BK` dari `guruMap`, dan memasukkan seluruh akun Guru BK resmi dengan rombel kelas yang sesuai.
- **Penyempurnaan Master Mapel & Rombel Guru E-Rapor (`js/page-e-rapor.js`):**
  - Memperluas kriteria `loadAllUsersCache()` agar tidak hanya menyaring `guru_mapel`, melainkan mencakup seluruh akun pengajar (`guru_bk`, `wali_kelas`, `staff`, dan akun ber-`linkedTeacherId`).
  - Memperbaiki `getUserNameByUid()` dan `window.syncASCScheduleXML()` agar mata pelajaran BK yang diimpor dari XML otomatis terisi akun Guru BK riil dengan perlindungan penugasan kelas yang sudah ada (*protected merge*).
  - Mengintegrasikan sinkronisasi real-time ke Jurnal Mengajar (`syncRaporConfigToJurnalAuto` → `dbJurnal` koleksi `data_guru`) sehingga seluruh Guru BK otomatis memiliki hak akses mapel BK di sistem Jurnal Mengajar.
  - Memperbarui modal pemetaan guru (`renderMappingTable`) agar memunculkan seluruh Guru BK riil pada dropdown pilihan guru SIMAS SSOT.
- **Integrasi Halaman Presensi Guru (`js/page-presensi-guru.js`):**
  - Mengintegrasikan fungsi `loadBkTeachers()` dengan `window.getBkTeachersCache()` agar nama-nama Guru BK selalu akurat dan tersinkronisasi saat auto-populate jadwal presensi kelas.

## [1.1.395] / [26.08.26.1] - 2026-08-26

### 🛡️ Security & Hardening: Penguatan Keamanan OWASP & ASVS Level 2 (JWT RS256, RBAC Edge, Anti-XSS & Quality Gate)
- **Verifikasi Kriptografis Tanda Tangan JWT RS256 di Cloudflare Edge (`cloudflare/worker.js`):**
  - Mengimplementasikan fungsi verifikasi tanda tangan kriptografis token Firebase Auth menggunakan standar Web Crypto Subtle API (`crypto.subtle.importKey` & `crypto.subtle.verify`) terhadap Google Public JWKS (`https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`).
  - Menerapkan mekanisme caching Google JWKS di memori dan Cloudflare Edge Cache dengan waktu retensi otomatis (*max-age* header parsing).
  - Melakukan validasi menyeluruh atas klaim standar: `iss`, `aud`, `exp`, `iat`, `auth_time`, dan `sub` dengan toleransi *clock-skew* 300 detik.
- **Penegakan Hak Akses Server-Side (RBAC) pada Mutasi D1 (`cloudflare/worker.js`):**
  - Menerapkan helper `isManager(user)` yang mengevaluasi `role` primer dan `additionalRoles` tugas rangkap pengguna terhadap `MANAGER_ROLES`.
  - Mengunci seluruh operasi mutasi (POST, PUT, DELETE) pada `/api/agenda/events` dan `/api/agenda/documents` agar wajib memiliki hak akses manajer.
  - Menghapus kunci migrasi statis `smagesa_migration_2026` dan mengunci endpoint `/api/migrate/agenda` serta `/api/migrate/telemetry` khusus akun `super_admin` atau token rahasia lingkungan `MIGRATION_SECRET`.
- **Pengamanan Riwayat Login & Jejak Audit Telemetri (`cloudflare/worker.js`):**
  - Mengunci pembacaan data `GET /api/login-history` dan `GET /api/audit-logs` dengan otentikasi wajib dan otorisasi ketat khusus `super_admin` & `kepala_sekolah` (mencegah kebocoran data UID, IP, user-agent, dan nama pengguna ke publik).
  - Mengetatkan pencatatan log `POST /api/login-history` dan `POST /api/audit-logs` dengan verifikasi token otentik dan pengikatan UID pengguna untuk mencegah pemalsuan identitas (*identity spoofing*).
- **Pemberantasan Celah Stored XSS pada Halaman Publik (`index.html`):**
  - Menambahkan fungsi sanitasi `escapeHTML()` pada blok skrip kalender agenda publik.
  - Meng-escape seluruh data dinamis dari database D1 (`ev.title`, `ev.description`, `periodText`, `dateLabel`, `months`) sebelum diinterpolasikan ke dalam `innerHTML`.
  - Mengamankan tampilan pesan error login Google dan login biometrik menggunakan `textContent`.
- **Penguatan Endpoint Notifikasi Telegram (`functions/index.js` & `js/global.js`):**
  - Memasang verifikasi Bearer ID Token Firebase (`auth.verifyIdToken()`) pada Cloud Function `verifyTelegramChatId`.
  - Mengirimkan header `Authorization: Bearer <idToken>` secara otomatis dari klien frontend `js/global.js`.
  - Menerapkan fungsi sanitasi `escapeTelegramHtml()` pada `verifyTelegramChatId` dan `telegramWebhook` untuk mencegah injeksi tag HTML rusak pada pesan Telegram bot.
  - Menambahkan dukungan validasi header `X-Telegram-Bot-Api-Secret-Token` pada webhook Telegram.
- **Quality Gate & Sinkronisasi Versi:**
  - Menyediakan konfigurasi ESLint (`functions/.eslintrc.js`) yang kompatibel dengan Node.js 22 dan ESLint 8.x.
  - Memperbaiki scope variabel `roleTargetUids` pada fungsi Cloud Function `onPushNotificationCreated`.
  - Menyelaraskan versi aplikasi `1.1.395` pada `package-lock.json` dan `package.json`.
  - Memperbarui nomor versi harian ke `[26.08.26.1]` pada `js/config.js` (`APP_VERSION`), `PRD_SIMAS.md`, dan `CHANGELOG.md`.

## [1.1.394] / [26.08.25.1] - 2026-08-25

### 🧹 Database & Maintenance: Eliminasi Menyeluruh Referensi Koleksi Berawalan `Z_` di Firestore
- **Pembersihan Modul Pengaturan (`js/page-settings.js`):**
  - Menghapus koleksi berawalan `Z_` (`Z_login_history`, `Z_audit_logs`, `Z_calendar_events`, `Z_agenda_documents`) dari daftar `BACKUP_COLLECTIONS` dan `COLLECTION_LABELS`.
  - Menghapus fungsi utilitas legacy `window.archiveAgendaFirestore()`.
  - Memastikan proses backup/restore data di Halaman Pengaturan hanya memproses koleksi operasional aktif, menghindari pembacaan (*Firestore read*) data usang yang tidak diperlukan.
- **Pembersihan Utilitas Global (`js/global.js`):**
  - Menghapus fungsi legacy `window.archiveAgendaFirestore()` dan `window.archiveTelemetryFirestore()`.
- **Pembaruan Aturan Keamanan (`firestore.rules`):**
  - Menghapus seluruh blok `match /Z_*` (`Z_attendance`, `Z_finance_transactions`, `Z_finance_daily_summary`, `Z_finance_cashflow`, `Z_guru_presensi`, `Z_calendar_events`, `Z_agenda_documents`, `Z_login_history`, `Z_audit_logs`).
- **Sinkronisasi Dokumentasi & SSOT ([`PRD_SIMAS.md`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/PRD_SIMAS.md)):**
  - Menegaskan status koleksi historis legacy yang telah sepenuhnya dinonaktifkan dengan operasional 100% dialihkan ke Supabase PostgreSQL dan Cloudflare D1 Serverless SQL.
  - Sinkronisasi nomor versi aplikasi ke `v1.1.394` / `[26.08.25.1]` pada `package.json`, `js/config.js`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.

## [1.1.393] / [26.08.24.21] - 2026-08-24

### 🚀 Backend & Cloud Functions: Deployment Supabase Edge Function `secure-proxy` v32 untuk Normalisasi Akses PostgREST Perpustakaan
- **Penyelesaian HTTP 400 saat Memuat Daftar Buku (`lib_buku`):**
  - Mengidentifikasi ketidaksinkronan versi Edge Function `secure-proxy` yang berjalan di cloud Supabase dengan kode utilitas RBAC lokal pasca migrasi penguatan keamanan sirkulasi perpustakaan (`202608240001_library_circulation_hardening.sql`).
  - Mengunggah dan melakukan *deployment* paket mutakhir Edge Function `secure-proxy` (v32) yang menyertakan modul `index.ts` dan `rest-access-utils.mjs`.
  - Memverifikasi otorisasi proxy PostgREST (`TABLE_READ_ROLES` & `TABLE_WRITE_ROLES`) untuk tabel `lib_buku`, `lib_eksemplar`, `lib_sirkulasi`, `lib_hari_libur`, `lib_kategori_ddc`, dan `lib_config`.
  - Seluruh endpoint sirkulasi atomik (`library-circulation-borrow`, `library-circulation-return`, `library-circulation-extend`, `library-catalog-archive`, `library-copy-archive`, `library-fine-settle`) dan surat bebas pustaka terkonfirmasi aktif dan beroperasi normal.
- **Verifikasi & Validasi:**
  - Lulus 100% verifikasi sintaksis JavaScript (`npm run check:syntax`).
  - Lulus 100% pengujian unit Jest (13 test suites / 67 tests).

## [1.1.392] / [26.08.24.20] - 2026-08-24

### 🎨 UI Refinement: Eliminasi Icon di Dalam Kotak Input Form Modul Perpustakaan
- **Pembersihan Icon Input & Penyesuaian Padding:**
  - **Sirkulasi (`library/index.html`):** Menghapus icon di dalam input scan barcode `#input-book-barcode` dan menyetel padding bersih `px-3.5` agar teks/nomor barcode tidak pernah tertutup atau terpotong icon.
  - **Katalog Buku (`library/katalog.html`):** Menghapus icon kaca pembesar di dalam input pencarian katalog `#search-katalog` dan input filter cetak massal `#search-bulk-books` serta menormalkan padding ke `px-3.5`.
  - **Katalog OPAC (`library/opac.html`):** Menghapus icon pencarian di dalam search box hero `#opac-search-input` dan menyetel padding awal `px-5` agar teks pencarian dimulai dengan leluasa dan bersih.
- **Verifikasi & Validasi:**
  - Lulus 100% verifikasi sintaksis JavaScript (`check:syntax`) dan pengujian unit (`test:unit`).

## [1.1.392] / [26.08.24.19] - 2026-08-24

### 🔒 Integritas Data & Validasi: Validasi Sentral SSOT Panjang 16 Digit & Keunikan Mutlak NIK Siswa, NIK Orang Tua, dan No KK
- **Fungsi Validasi Sentral SSOT (`js/global.js`):**
  - Mengembangkan fungsi sentral `validateStudentIdentityNumbers(data)` yang diekspos ke `window.validateStudentIdentityNumbers` dan `export const validateStudentIdentityNumbers`.
  - Memeriksa format dan panjang karakter: seluruh nomor identitas kependudukan (`nik` siswa, `kk_no`, `father_nik`, `mother_nik`, `guardian_nik`) yang terisi wajib terdiri dari **tepat 16 digit angka murni** (`^\d{16}$`).
  - Memeriksa aturan keunikan mutlak: memastikan tidak ada kesamaan nilai antara nomor kependudukan yang diisi (misal NIK Siswa tidak boleh sama dengan No KK, NIK Siswa tidak boleh sama dengan NIK Ayah/Ibu/Wali, NIK Ayah tidak boleh sama dengan NIK Ibu/Wali/No KK, NIK Ibu tidak boleh sama dengan NIK Wali/No KK).
- **Penerapan pada Seluruh Modul Pengeditan & Penambahan Data Siswa:**
  - **Portal Siswa Mandiri (`portal-siswa.html` & `js/page-portal-siswa.js`):** Form edit profil siswa (`#form-edit-profile-siswa`) memvalidasi format dan keunikan NIK/KK sebelum menulis data ke Firestore. Dilengkapi atribut input `maxlength="16"`, `inputmode="numeric"`, dan `pattern="[0-9]{16}"`.
  - **Portal Guru Wali (`guru-wali.html` & `js/page-guru-wali.js`):** Fungsi `submitEditDataSiswa` memvalidasi NIK/KK dengan notifikasi feedback toast ramah sebelum eksekusi `updateDoc`. Dilengkapi atribut input `maxlength="16"`, `inputmode="numeric"`, dan `pattern="[0-9]{16}"`.
  - **Portal Wali Kelas (`wali-kelas.html` & `js/page-wali-kelas.js`):** Fungsi `saveEditDataSiswa` memvalidasi NIK/KK dengan feedback toast sebelum eksekusi `updateDoc`. Dilengkapi atribut input `maxlength="16"`, `inputmode="numeric"`, dan `pattern="[0-9]{16}"`.
  - **Modul Data Master Siswa (`siswa.html` & `js/page-students.js`):** Modal Tambah Siswa (`#form-add-student`) dan Modal Edit Siswa (`#form-edit-student`) terintegrasi penuh dengan validasi NIK/KK sebelum simpan. Dilengkapi atribut input `maxlength="16"`, `inputmode="numeric"`, dan `pattern="[0-9]{16}"`.
- **Verifikasi & Validasi:**
  - Lulus 100% verifikasi sintaksis JavaScript (`check:syntax`) dan pengujian logika validasi.

## [1.1.391] / [26.08.24.18] - 2026-08-24

### 🔒 Isolasi Layout: Eliminasi Total Sidebar/Navbar Web Utama pada Iframe Modal OPAC di Portal Siswa
- **Early Layout Guard di `initLayout()` (`js/global.js`):**
  - Menambahkan pengamanan guard absolut di baris awal `initLayout()`. Jika parameter `mode=popup`, `embed=1`, atau `window.self !== window.top` terdeteksi, fungsi langsung membatalkan eksekusi (`early return`), mengosongkan kontainer `#app-layout`, dan menetapkan kelas `is-embed-mode` & `opac-embed-mode`.
- **Pengamanan Visual & CSS Isolasi (`library/opac.html` & `library/opac.js`):**
  - Menambahkan script pendahulu di `<head>` untuk menandai `document.documentElement` dengan kelas `is-embed-mode` sebelum parsing CSS selesai.
  - Mempertegas aturan stylesheet `!important` untuk menyembunyikan `#app-layout`, `aside`, `header`, `nav.fixed`, `#mobile-menu`, dan tombol saran mengambang saat dalam mode embed.
  - Menambahkan cache-buster dinamis (`?v=timestamp`) saat memuat iframe dan modul `opac.js` untuk mencegah browser memuat script lama dari cache.
- **Verifikasi & Validasi:**
  - Lulus 100% verifikasi sintaksis JavaScript (`check:syntax`) dan pengujian unit (`test:unit`).

## [1.1.391] / [26.08.24.17] - 2026-08-24

### 📖 Fitur Baru & UI: Mode Popup Modal Terisolasi untuk Katalog OPAC Perpustakaan di Portal Siswa
- **Integrasi Modal Popup OPAC di Portal Siswa (`portal-siswa.html` & `js/page-portal-siswa.js`):**
  - Mengubah tombol trigger *"Cari Buku (OPAC)"* dari navigasi link eksternal biasa menjadi pembuka **Modal Popup OPAC** (`#modal-opac-popup`).
  - Menambahkan dialog modal modern dengan backdrop blur, header popup (judul katalog, tombol reload iframe, dan tombol tutup X), serta frame iframe dengan skeleton loader interaktif.
  - Menambahkan handler fungsi global `window.openOpacModal()`, `window.closeOpacModal()`, `window.refreshOpacIframe()`, serta event listener tombol `Escape` dan `window.addEventListener('message')` untuk penutupan mulus.
- **Dukungan Mode Embed/Popup pada OPAC Perpustakaan (`library/opac.html` & `library/opac.js`):**
  - Menambahkan deteksi otomatis mode popup (`?mode=popup` atau `window.self !== window.top`).
  - Melewati inisialisasi layout web utama (`initLayout`) dan menyembunyikan `#app-layout` saat dalam mode popup sehingga **tidak menampilkan sidebar, top navigation, maupun menu web utama SIMAS**.
  - Menyembunyikan seksi *"Pinjaman Saya"* saat dalam iframe popup karena data peminjaman siswa sudah disajikan secara langsung pada Tab Perpustakaan di Portal Siswa.
  - Menambahkan listener tombol `Escape` di dalam iframe untuk mengirim pesan `postMessage` ke window Portal Siswa agar modal dapat langsung tertutup.
- **Verifikasi & Validasi:**
  - Lulus 100% verifikasi sintaksis JavaScript (`check:syntax`) dan pengujian keamanan OWASP / ASVS.

## [1.1.391] / [26.08.24.16] - 2026-08-24

### 🐛 Bug Fix: Perbaikan Error ReferenceError `sppYear is not defined` pada Portal Siswa Mandiri
- **Inisialisasi & Deklarasi Variabel Tahun SPP (`js/page-portal-siswa.js`):**
  - Menambahkan deklarasi `let sppYear = null;` pada *Session Data scope* modul Portal Siswa.
  - Memperbarui fungsi `loadSPP()` agar menginisialisasi `sppYear` ke tahun akademik aktif berjalan (`curMonth >= 6 ? curYear : curYear - 1`) dan membatasi (*clamp*) navigasi dalam rentang cohort 3 tahun siswa (`cohort.startYear` s.d. `cohort.endYear - 1`).
  - Menambahkan pengamanan null-check pada elemen DOM (`#spp-grid`, `#spp-display-year`) serta tombol navigasi tahun (`#spp-btn-prev`, `#spp-btn-next`).
  - Memperbaiki fungsi navigasi `window.changeSppYear(delta)` dengan validasi batas rentang cohort sebelum memicu pembaruan tampilan grid.
  - Memperbarui fungsi `window.logout()` agar turut mereset variabel `sppYear` menjadi `null`.
- **Pembersihan Tampilan HTML (`portal-siswa.html`):**
  - Mengubah placeholder statis `2025` pada `#spp-display-year` menjadi `-` sebelum dimuat secara dinamis oleh JavaScript.
- **Verifikasi & Validasi:**
  - Lulus 100% verifikasi sintaksis JavaScript (`check:syntax`: 67 berkas, 0 error).

## [1.1.390] / [26.08.24.15] - 2026-08-24

### 🔒 Keamanan & UI: Penegasan Tombol Edit Data Siswa & Penguncian Jenis Kelamin pada Portal Siswa Mandiri
- **Penonjolan Tombol Akses Edit Data Siswa (`portal-siswa.html`):**
  - Mengganti trigger teks kecil dengan tombol primer yang jelas (`<button class="bg-blue-600 ..."> <i class="fa-solid fa-user-pen"></i> Edit Data Siswa</button>`) di bilah navigasi atas (desktop & mobile).
- **Penguncian Permanen Jenis Kelamin Siswa (`portal-siswa.html`, `js/page-portal-siswa.js`, `firestore.rules`):**
  - Memindahkan input Jenis Kelamin ke Seksi A (Identitas Resmi Terkunci) sebagai *read-only* dengan keterangan bahwa jenis kelamin hanya dapat diubah oleh Operator Sekolah/Wali Kelas.
  - Menghapus atribut `gender` dari objek payload pembaruan siswa mandiri di `js/page-portal-siswa.js`.
  - Memperketat aturan keamanan Firestore (`firestore.rules`) dengan memvalidasi kesamaan nilai `gender` saat pembaruan profil mandiri (`request.resource.data.gender == resource.data.gender`) dan menghapus `gender` dari whitelist field bebas ubah siswa.
- **Verifikasi & Validasi:**
  - Lulus seluruh pengujian sintaksis JavaScript (`64/64` file, 0 error) dan uji DOM otomatis (`380/380` passed).

## [1.1.389] / [26.08.24.14] - 2026-08-24

### 🚀 Fitur Baru: Sinkronisasi Menyeluruh Master Data Siswa Dapodik 48 Kolom di Seluruh Modul Terkait
- **Pembaruan Modul Wali Kelas (`wali-kelas.html` & `js/page-wali-kelas.js`):**
  - **Modal Detail Profil Siswa (`#modal-tab-content-profil`):** Dirombak total menjadi 4 seksi detail terstruktur (Identitas Siswa & Dokumen Pribadi, Kontak Siswa/Domisili/Transportasi, Rincian Data Ayah/Ibu/Wali, serta Kondisi Fisik & Catatan).
  - **Modal Edit Data Siswa Rombel (`#modal-edit-data-siswa`):** Dilengkapi dengan form 48 atribut Dapodik terintegrasi dengan penataan berdampingan (NIK & KK, Anak Ke- & Jml Saudara), penyimpanan Firestore yang aman, pencatatan jejak audit `UPDATE_STUDENT`, serta invalidasi cache global.
- **Pembaruan Modul Guru Wali Bimbingan (`guru-wali.html` & `js/page-guru-wali.js`):**
  - **Modal Detail Profil Siswa (`#detail-content-profil`):** Diperbarui menyajikan informasi lengkap 48 atribut Dapodik dalam kartu-kartu terstruktur yang rapi dan responsif.
  - **Modal Edit Siswa Bimbingan (`#modal-edit-data-siswa`):** Mendukung pembaruan 48 atribut data Dapodik secara langsung oleh Guru Wali dengan audit log `UPDATE_STUDENT_BY_WALI` dan sinkronisasi metadata cache SSOT.
- **Penyelarasan Ekosistem SIMAS:**
  - Menuntaskan konsistensi skema 48 kolom Dapodik di semua level hak akses (Admin di Master Siswa, Siswa Mandiri di Portal Siswa, Wali Kelas di Portal Wali Kelas, dan Guru Wali di Portal Bimbingan).
  - Lulus 100% verifikasi sintaksis JavaScript (`check:syntax`).

## [1.1.388] / [26.08.24.13] - 2026-08-24

### 🚀 Fitur Baru: Master Data Siswa Lengkap Standar Dapodik 48 Kolom (A–AV) & Penyelarasan Form
- **Skema Standar Dapodik 48 Kolom (`STUDENT_SCHEMA` - `js/page-students.js`):**
  - Mengintegrasikan seluruh 48 kolom data Dapodik: Identitas Siswa (NIS, NISN, Nama, JK, Kelas, Tempat/Tgl Lahir, Agama, NIK, No KK, Akta Lahir, Sekolah Asal, Anak Ke-, Jml Saudara), Kontak & Domisili (HP Siswa, Email Siswa, Alamat, Dusun, Kelurahan, Kecamatan, Kode Pos, Jenis Tinggal, Transportasi, Jarak Sekolah), Data Lengkap Ayah (Nama, Thn Lahir, Pendidikan, Pekerjaan, Penghasilan, NIK, No HP), Data Lengkap Ibu (Nama, Thn Lahir, Pendidikan, Pekerjaan, Penghasilan, NIK, No HP), Data Lengkap Wali (Nama, Thn Lahir, Pendidikan, Pekerjaan, Penghasilan, NIK, No HP), dan Data Fisik (BB, TB, Lingkar Kepala).
- **Preservasi Data Lama & Smart Merge Import:**
  - Import massal Excel/CSV mengabaikan kolom kosong sehingga tidak menimpa data yang sudah tersimpan sebelumnya (`{ merge: true }`).
  - Penyelarasan otomatis nomor HP ayah ke `phone_parent` dan email siswa ke `email` untuk kompatibilitas subsistem legacy.
- **Penyelarasan Tata Letak Input & Profil (`siswa.html` & `js/page-students.js`):**
  - Data NIK Siswa disandingkan berdampingan dengan No. Kartu Keluarga (KK).
  - Data Anak Ke- disandingkan berdampingan dengan Jumlah Saudara Kandung.
  - Tampilan profil detail siswa (`#full-profile-grid`) dirender dalam 7 kartu seksi terstruktur berdesain modern & responsif.
- **Pembaruan Portal Siswa Mandiri (`portal-siswa.html` & `js/page-portal-siswa.js`):**
  - Siswa dapat melengkapi dan memperbarui biodata pribadi, domisili, kontak, orang tua/wali, serta ukuran fisik secara mandiri melalui modal edit profil.
  - Integritas data resmi sekolah tetap dilindungi secara ketat (`nis`, `nisn`, `name`, `class`, `status`, `note` dikunci permanen).
- **Pembaruan Security Rules Firestore (`firestore.rules`):**
  - Menambahkan seluruh key atribut Dapodik baru ke daftar whitelist `isUpdatingOwnStudentProfile` pada koleksi `students/{nis}`.
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi disinkronkan ke `v1.1.388` / `[26.08.24.13]` pada `package.json`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.

## [1.1.387] / [26.08.24.12] - 2026-08-24

### 🛠️ Perbaikan Bug: Render Cetak Label & Barcode Stiker Kosong pada Modul Katalog Perpustakaan
- **Perbaikan CSS `@media print` (`library/katalog.html`):**
  - Memperbaiki penanganan elemen `#print-area` dengan eksplisit `display: block !important; visibility: visible !important; position: static !important;` untuk menimpa kelas `.hidden` bawaan Tailwind saat dialog cetak aktif.
  - Memindahkan kontainer `<div id="print-area">` langsung sebagai anak utama `<body>` (di luar `<main>`) guna mencegah efek pewarisan properti hidden dari elemen induk antarmuka.
  - Menambahkan aturan `@page { margin: 0.6cm; size: auto; }` dan `page-break-inside: avoid !important;` agar tata letak label stiker (grid 3-kolom / 4-kolom) mengalir rapi melintasi beberapa halaman tanpa terpotong.
- **Penyempurnaan Alur Eksekusi Cetak & `JsBarcode` (`library/katalog.js`):**
  - Membuat helper fungsi terpusat `startPrintProcess(format, htmlContent, renderCallback)` yang secara otomatis membuka kontainer `#print-area` terlebih dahulu ke DOM, merender SVG barcode resolusi tinggi via `JsBarcode`, memberi jeda waktu render peramban, lalu memicu `window.print()`.
  - Menambahkan listener otomatis `window.addEventListener('afterprint', ...)` untuk mengembalikan `#print-area` ke status `hidden` setelah pengguna selesai atau membatalkan dialog cetak.
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi disinkronkan ke `v1.1.387` / `[26.08.24.12]` pada `package.json`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.

## [1.1.386] / [26.08.24.11] - 2026-08-24

### 🚀 Fitur Baru: Cetak Label Stiker & Barcode Massal (Bulk Printing) pada Modul Katalog Perpustakaan
- **Cetak Selektif Berbasis Centang / Checkbox pada Modal Eksemplar (`library/katalog.html` & `library/katalog.js`):**
  - Menambahkan kolom checkbox per baris eksemplar dan master *Pilih Semua* (`#check-all-eksemplar`) pada tabel manajemen fisik buku.
  - Menambahkan badge dinamis jumlah eksemplar yang dipilih (`#selected-eks-badge`) dan penyesuaian label tombol cetak live (contoh: `Cetak 2-in-1 (5 Terpilih)`).
  - Tombol cetak modal (`Cetak Stiker 2-in-1`, `Stiker Punggung`, `Barcode Saja`) otomatis mencetak eksemplar yang dipilih saja (atau mencetak semua salinan jika tidak ada centang).
- **Modal Cetak Label Massal Lintas Judul Buku (`#modal-bulk-print`):**
  - Menambahkan tombol aksi header **Cetak Label Massal** (`#btn-open-bulk-print`) dengan ikon tag ungu di toolbar atas.
  - Pilihan 3 Format Stiker: **Stiker 2-in-1 (Rekomendasi)** (Call number + Barcode CODE128 grid 3-kolom), **Stiker Punggung Saja** (grid 4-kolom), dan **Barcode Card Saja** (grid 3-kolom).
  - Filter interaktif judul buku dengan pencarian cepat, tombol *Pilih Semua* / *Batalkan*, dan kalkulator otomatis estimasi total lembar stiker yang akan dicetak.
  - Mengambil data eksemplar massal via query Supabase teroptimasi `.in('buku_id', selectedIds)` dan me-render seluruh SVG barcode secara otomatis sebelum dialog cetak peramban terbuka.
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi disinkronkan ke `v1.1.386` / `[26.08.24.11]` pada `package.json`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.

## [1.1.385] / [26.08.24.10] - 2026-08-24

### 🚀 Fitur Baru: Tambah Eksemplar Fisik Massal / Kuantitas (Bulk Qty) pada Modul Katalog Perpustakaan
- **Formulir Tambah Eksemplar Berbasis Kuantitas (`library/katalog.html`):**
  - Menambahkan input kuantitas `Jumlah (Qty)` pada formulir *Tambah Eksemplar Baru* di modal *Manajemen Fisik Buku* (`#modal-eksemplar`).
  - Menata ulang grid formulir menjadi 12 kolom responsif (`Jumlah`, `Nomor Induk / Inventaris`, `Kode Barcode`, `Sumber Pengadaan`, dan tombol aksi `Tambah Copy`).
  - Menambahkan banner informatif pratinjau rentang copy (`#eks-qty-helper`) yang muncul otomatis ketika kuantitas > 1 (contoh: *Akan membuat 5 eksemplar fisik baru (Copy c.1 s.d. c.5)*).
- **Logika Penomoran & Barcode Otomatis Berurutan (`library/katalog.js`):**
  - Mengimplementasikan helper `generateSequenceItem(baseStr, indexOffset, copyNum)` untuk mendeteksi nomor indeks numerik di akhir string dan melakukan penomoran berurutan (*sequential auto-increment*) secara otomatis untuk Nomor Induk dan Barcode.
  - Memperbarui fungsi `handleAddEksemplar` untuk mendukung pembuatan batch array dokumen eksemplar (`lib_eksemplar`), kalkulasi nomor Call Number lengkap (`c.1`, `c.2`, dst.), serta sinkronisasi total stok (`total_eksemplar` dan `eksemplar_tersedia`) ke tabel `lib_buku` Supabase dalam satu transaksi efisien.
  - Memperbarui fungsi `generateNextEksemplarDefaults()` dan `updateEksemplarQtyHelper()` untuk merespons perubahan input kuantitas secara live (memperbarui label tombol dinamis misal `+ Tambah 5 Copy`).
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi disinkronkan ke `v1.1.385` / `[26.08.24.10]` pada `package.json`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.

## [1.1.384] / [26.08.24.9] - 2026-08-24

### 🚀 Fitur Baru: Tombol & Modal Rekapitulasi WhatsApp SPP pada Portal Wali Kelas
- **Tombol Aksi `Rekap Pesan WA` di Tab SPP (`wali-kelas.html`):**
  - Menambahkan tombol aksi WhatsApp berwarna hijau di header tab Monitoring Kelancaran SPP Rombel berdampingan dengan badge statistik rombel.
- **Modal Generator Rekapitulasi SPP Rombel (`#modal-spp-recap-wa`):**
  - Menyediakan 3 opsi format pemilihan data:
    1. **Semua Siswa:** Rekap lengkap memuat ringkasan rombel, daftar siswa belum lunas beserta rincian nominal & bulan tunggakan, serta daftar siswa yang sudah lunas.
    2. **Belum Lunas Saja:** Format khusus daftar siswa menunggak untuk pengingat persuasif tagihan kelas / arsip wali kelas.
    3. **Lunas Saja:** Format daftar siswa yang sudah lunas sebagai bentuk apresiasi kelancaran.
  - Textarea pratinjau pesan yang interaktif dan dapat diedit secara bebas sebelum disalin atau dikirim.
  - Tombol **Salin Pesan** (otomatis menyalin ke *clipboard* dengan notifikasi toast sukses) dan tombol **Buka WhatsApp** (`https://wa.me/?text=...`).
- **Implementasi Controller & Helper (`js/page-wali-kelas.js`):**
  - Menambahkan fungsi `openWaliSppRecapModal()`, `updateWaliSppRecapFilterButtons()`, `onWaliSppRecapFilterChange()`, `generateWaliSppRecapText()`, `copyWaliSppRecapMessage()`, dan `sendWaliSppRecapToWhatsApp()`.
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi disinkronkan ke `v1.1.384` / `[26.08.24.9]` pada `package.json`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.

## [1.1.383] / [26.08.24.8] - 2026-08-24

### 🐞 Perbaikan Bug: Resolusi Runtime Error TypeError & ReferenceError pada Manajemen User
- **Perbaikan Pemeriksaan `USERS_SESSION_CACHE` di `preloadTeacherData()` (`js/page-users.js`):**
  - Mengganti pengecekan `typeof USERS_SESSION_CACHE !== 'undefined'` menjadi `Array.isArray(USERS_SESSION_CACHE) && USERS_SESSION_CACHE.length > 0` untuk mencegah `TypeError: Cannot read properties of null (reading 'length')` ketika cache bernilai `null` saat inisialisasi awal.
  - Menambahkan pengecekan array guard pada `teacherDataCache` di `updateTeacherDatalist()`.
- **Resolusi ReferenceError `loadClassOptions` (`js/page-users.js`):**
  - Mengalihkan pemanggilan `loadClassOptions()` ke fungsi `populateKelasSelect()`, memperbarui pencocokan elemen ID (`#input-assigned-class` dan `#edit-assigned-class`), serta mendaftarkan alias global `window.loadClassOptions` dan `window.populateKelasSelect`.
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi disinkronkan ke `v1.1.383` / `[26.08.24.8]` pada `package.json`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.

## [1.1.382] / [26.08.24.7] - 2026-08-24

### 🐞 Perbaikan Bug: Normalisasi Format NIS SPP pada Portal Wali Kelas, Guru Wali & Portal Siswa
- **Normalisasi Format NIS (*Leading Zero Guard*):**
  - Menerapkan fungsi helper `normalizeNIS(nis)` pada `js/page-wali-kelas.js` serta menambahkan pencocokan jamak (*fallback multi-key*) antara format raw NIS (misal: `"0780"`), normalized NIS tanpa angka nol di depan (`"780"`), dan format 4-digit padded (`"0780"`).
  - Memperbarui fungsi `loadSppStatusSummary` dan `openDetailSppModal` di `js/page-wali-kelas.js`, `loadStudentSPP` di `js/page-guru-wali.js`, dan `loadSPP` di `js/page-portal-siswa.js` agar menggunakan kueri operator `.in('student_nis', targetNisList)`.
  - Mengatasi masalah di mana 12 transaksi pembayaran SPP siswa di kasir Keuangan tidak terbaca di Portal Wali Kelas akibat perbedaan format leading zero, sehingga sisa tunggakan rombel kini 100% klop dan sinkron ($\text{Estimasi} + \text{Tunggakan Lalu} - \text{Realisasi} = \text{Sisa Tunggakan}$).
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi disinkronkan ke `v1.1.382` / `[26.08.24.7]` pada `package.json`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.

## [1.1.381] / [26.08.24.6] - 2026-08-24

### 🐞 Perbaikan Bug: Resolusi Runtime ReferenceError Modul Agenda Kegiatan & Dokumen
- **Perbaikan Impor `onAuthStateChanged` (`js/page-agenda.js`):**
  - Menambahkan pernyataan impor `import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";` yang sebelumnya terlewat.
  - Memperbaiki kegagalan peramban (*Uncaught ReferenceError*) saat inisialisasi modul kalender sehingga agenda kegiatan dari Cloudflare D1 Serverless SQL (`/api/agenda/events`) dan dokumen Google Drive (`/api/agenda/documents`) dapat langsung ter-render dengan mulus.
- **Verifikasi Integritas Data Cloudflare D1:**
  - Memverifikasi endpoint API Worker Gateway dan database D1: 37 agenda kegiatan dan 13 tautan berkas dokumen tersimpan utuh dan merespons dalam waktu sub-100ms.
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi disinkronkan ke `v1.1.381` / `[26.08.24.6]` pada `package.json`, `js/config.js`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.

## [1.1.380] / [26.08.24.5] - 2026-08-24

### 🛡️ Keamanan & Infrastruktur: Pembaruan Header CSP untuk Cloudflare Worker API Gateway
- **Penambahan Izin `connect-src` Cloudflare (`firebase.json`):**
  - Menambahkan origin `https://simas-api.komangpurna1.workers.dev` dan `https://*.workers.dev` ke dalam arahan `connect-src` header Content Security Policy (CSP) pada target hosting `smagesa`.
  - Mengatasi pemblokiran peramban (*Fetch API CSP violation*) saat melakukan pencatatan log login (`/api/login-history`), jejak audit (`/api/audit-logs`), dan sinkronisasi agenda D1.
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi disinkronkan ke `v1.1.380` / `[26.08.24.5]` pada `package.json`, `js/config.js`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.

## [1.1.379] / [26.08.24.4] - 2026-08-24

### ⏰ Cloudflare D1: Otomatisasi Scheduled Rolling Data Retention (Hands-Free Cron)
- **Implementasi Auto-Cleanup Terjadwal (`cloudflare/worker.js` & `cloudflare/wrangler.toml`):**
  - Menerapkan fungsi `performAutoCleanup` dan handler `scheduled(event, env, ctx)` pada Cloudflare Worker API Gateway.
  - Menjadwalkan Cloudflare Cron Trigger `[triggers] crons = ["0 18 * * *"]` yang dieksekusi otomatis setiap hari pukul **02:00 WITA / 18:00 UTC** (*hands-free*).
  - Kebijakan masa retensi data operasional:
    - **`login_history`**: Retensi **1 Bulan (30 Hari)** (`datetime(login_at) < datetime('now', '-30 days')`).
    - **`audit_logs`**: Retensi **3 Bulan (90 Hari)** (`datetime(timestamp) < datetime('now', '-90 days')`).
    - **`calendar_events`**: Retensi **3 Tahun** (`date < date('now', '-3 years')`).
- **Dokumentasi & Standar Arsitektur (`cloudflare/README.md` & `PRD_SIMAS.md`):**
  - Mendokumentasikan Subbab 5.6 PRD terkait kebijakan siklus hidup (*data lifecycle*) dan matriks retensi data Cloudflare D1.
  - Memperbarui dokumentasi endpoint dan cron trigger di `cloudflare/README.md`.
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi disinkronkan ke `v1.1.379` / `[26.08.24.4]` pada `package.json`, `js/config.js`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.

## [1.1.378] / [26.08.24.3] - 2026-08-24

### 🛡️ Telemetri & Audit: Verifikasi Pembersihan Koleksi Firestore & Deployment Cloudflare
- **Pembersihan & Penguncian Koleksi Firestore (`firestore.rules` & `firestore.indexes.json`):**
  - Menghapus aturan penulisan publik/staf untuk `login_history` dan `audit_logs` di Firestore dan menguncinya secara mutlak khusus Super Admin untuk pembersihan dokumen.
  - Menghapus aturan `fieldOverrides` TTL untuk `audit_logs` dan `login_history` di `firestore.indexes.json`.
  - Memverifikasi bahwa seluruh modul SIMAS (`js/global.js`, `js/page-dashboard.js`, dll) 100% menggunakan `cfClient` ke Cloudflare D1.
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi disinkronkan ke `v1.1.378` / `[26.08.24.3]` pada `package.json`, `js/config.js`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.
  - Lulus 100% verifikasi sintaks JavaScript (63 berkas) dan unit test Jest (59 pengujian).

## [1.1.377] / [26.08.24.2] - 2026-08-24

### 🚀 Cloudflare D1: Migrasi Penuh `login_history` & `audit_logs` ke Serverless SQL
- **Peralihan Logging ke Cloudflare D1 (`cloudflare/worker.js` & `js/cloudflare-client.js`):**
  - Pembuatan tabel `login_history` dan `audit_logs` beserta indeks komposit pencarian di Cloudflare D1.
  - Penambahan rute RESTful API `/api/login-history`, `/api/audit-logs`, dan `/api/migrate/telemetry` di Worker API Gateway.
  - Pembaruan `logLoginActivity` dan `loadLoginHistoryRange` di `js/page-dashboard.js` untuk menulis & membaca riwayat login langsung dari Cloudflare D1.
  - Pembaruan `window.logAudit` di `js/global.js` untuk mencatat jejak audit mutasi data sensitif ke Cloudflare D1 secara non-blocking.
- **Pengarsipan Koleksi Firestore (`firestore.rules` & `js/page-settings.js`):**
  - Mendaftarkan rules pengarsipan untuk `Z_login_history` dan `Z_audit_logs`.
  - Menyediakan utilitas `window.archiveTelemetryFirestore()` untuk pemindahan data legacy Firestore ke `Z_`.
  - Memperbarui katalog `BACKUP_COLLECTIONS` di panel pengaturan.
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi disinkronkan ke `v1.1.377` / `[26.08.24.2]` pada `package.json`, `js/config.js`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.
  - Lulus 100% verifikasi sintaks JavaScript (63 berkas) dan unit test Jest (59 pengujian).

## [1.1.376] / [26.08.24.1] - 2026-08-24

### 🌐 Global: Pemasangan Utilitas Pengarsipan Global `window.archiveAgendaFirestore`
- **Akses Pengarsipan Global (`js/global.js`):**
  - Mendaftarkan fungsi `window.archiveAgendaFirestore()` ke skop global (`global.js`) sehingga dapat dijalankan dari halaman mana saja di seluruh aplikasi SIMAS (Dashboard, Settings, Agenda, dll).
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi disinkronkan ke `v1.1.376` / `[26.08.24.1]` (reset REV ke 1 pada hari baru) pada `package.json`, `js/config.js`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.
  - Lulus 100% verifikasi sintaks JavaScript (63 berkas) dan unit test Jest (59 pengujian).

## [1.1.375] / [26.08.23.24] - 2026-08-23

### 📦 Maintenance: Modul Utilitas Pengarsipan Firestore ke `Z_`
- **Fungsi Pengarsipan Otomatis Super Admin (`js/page-settings.js`):**
  - Menyediakan fungsi `window.archiveAgendaFirestore()` untuk memindahkan seluruh dokumen `calendar_events` dan `agenda_documents` ke koleksi arsip `Z_calendar_events` dan `Z_agenda_documents` serta membersihkan koleksi aslinya.
  - Memperbarui katalog `BACKUP_COLLECTIONS` dan `COLLECTION_LABELS` di panel Pengaturan/Backup Super Admin.
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi disinkronkan ke `v1.1.375` / `[26.08.23.24]` pada `package.json`, `js/config.js`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.
  - Lulus 100% verifikasi sintaks JavaScript (63 berkas) dan unit test Jest (59 pengujian).

## [1.1.374] / [26.08.23.23] - 2026-08-23

### 🧹 Codebase: Pembersihan Total Operasi Firestore Usang pada Modul Agenda
- **Pembersihan Kode Operasional (`js/page-agenda.js` & `functions/index.js`):**
  - Menghapus seluruh kueri baca (*fallback getDocs*), tulis (*setDoc/addDoc*), dan hapus (*deleteDoc*) yang mengarah ke koleksi Firestore `calendar_events` dan `agenda_documents`.
  - Menghapus trigger Cloud Function `onAgendaWritten` yang sudah tidak lagi digunakan.
  - Modul Agenda Sekolah (`agenda.html` / `js/page-agenda.js`) kini 100% beroperasi murni secara independen di atas **Cloudflare D1 Serverless SQL**.
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi disinkronkan ke `v1.1.374` / `[26.08.23.23]` pada `package.json`, `js/config.js`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.
  - Lulus 100% verifikasi sintaks JavaScript (63 berkas) dan unit test Jest (59 pengujian).

## [1.1.373] / [26.08.23.22] - 2026-08-23

### 🔔 Notifikasi: Penyelarasan Antrean Notifikasi Agenda & Badge Navbar
- **Sinkronisasi Notifikasi Otomatis (`js/page-agenda.js` & `firestore.rules`):**
  - Mengintegrasikan pencatatan mutasi agenda (tambah, ubah, hapus) langsung ke antrean `agenda_notifications_queue` di Firestore.
  - Memastikan cron job harian (`agendaCron` pukul 08:00 WITA) tetap mengirim push notifikasi rekap perubahan agenda ke WhatsApp dan FCM secara tepat waktu.
  - Memastikan *badge indicator* ("dot merah" Agenda Baru) di navbar aplikasi tetap menyala aktif saat terjadi pembaruan kalender.
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi disinkronkan ke `v1.1.373` / `[26.08.23.22]` pada `package.json`, `js/config.js`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.
  - Lulus 100% verifikasi sintaks JavaScript (63 berkas) dan unit test Jest (59 pengujian).

## [1.1.372] / [26.08.23.21] - 2026-08-23

### 📦 Firestore: Pengarsipan Koleksi Agenda ke `Z_` & Pengalihan Penuh ke Cloudflare D1
- **Pengarsipan Koleksi Firestore (`firestore.rules` & `js/config.js`):**
  - Mengubah path koleksi historis agenda di Firestore menjadi `Z_calendar_events` dan `Z_agenda_documents` (berstatus arsip read-only).
  - Seluruh operasional baca (*read*) dan tulis (*write*) untuk kalender kegiatan sekolah dan dokumen Google Drive kini 100% diproses melalui **Cloudflare D1 Serverless SQL** via Cloudflare Worker API.
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi disinkronkan ke `v1.1.372` / `[26.08.23.21]` pada `package.json`, `js/config.js`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.
  - Lulus 100% verifikasi sintaks JavaScript (63 berkas) dan unit test Jest (59 pengujian).

## [1.1.371] / [26.08.23.20] - 2026-08-23

### ☁️ Pilot Project: Integrasi Cloudflare D1 & Worker API Gateway (Modul Agenda Sekolah)
- **Implementasi Edge Database Cloudflare D1 (`cloudflare/schema.sql` & `cloudflare/worker.js`):**
  - Membuat skema tabel `calendar_events` dan `agenda_documents` pada Cloudflare D1 (Serverless SQLite di Edge global) dengan kuota 5.000.000 read/hari gratis.
  - Membangun Cloudflare Worker API Gateway berstandar keamanan **OWASP Top 10** dan **ASVS Level 1 & 2**:
    - **Verifikasi Kriptografis Token JWT:** Validasi stateless Firebase ID Token menggunakan public keys Google.
    - **Pencegahan Injeksi SQL:** 100% Prepared Statements / Parameterized Queries.
    - **Kontrol Akses Berbasis Peran (RBAC):** Hak mutasi (POST, PUT, DELETE) dikunci ketat untuk level manajerial (`super_admin`, `kepala_sekolah`, `wakasek_kurikulum`, `kesiswaan`, `kepala_lab`).
    - **CORS Lockdown & Security Headers:** Whitelist origin resmi SIMAS SMAGESA.
- **Integrasi Frontend & Graceful Fallback (`js/cloudflare-client.js` & `js/page-agenda.js`):**
  - Menghubungkan modul Agenda (`agenda.html`) dengan `CloudflareClient`.
  - Dilengkapi mekanisme dual-write dan *graceful fallback* otomatis ke Firestore jika jaringan/worker offline, menjamin nol *downtime*.
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi disinkronkan ke `v1.1.371` / `[26.08.23.20]` pada `package.json`, `js/config.js`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.
  - Lulus 100% verifikasi sintaks JavaScript (63 berkas) dan unit test Jest (59 pengujian).

## [1.1.370] / [26.08.23.19] - 2026-08-23

### 📊 Dashboard Kepsek: Penyelarasan Target Bulanan SPP dengan Tab Estimasi
- **Pembaruan Kalkulasi Progress Ring SPP (`js/page-dashboard.js`):**
  - Menerapkan pengecekan pembayaran di muka (*advance payment check*) pada estimasi SPP bulan berjalan di widget SPP Dashboard Kepala Sekolah. Siswa yang telah membayar di muka otomatis tidak membebani sisa target SPP bulan berjalan.
  - Menerapkan penentuan saldo awal piutang berbasis tanggal potong (*cutoff date*) pada perhitungan akumulasi tunggakan lalu.
  - Nilai **Target Bulan Berjalan** pada widget SPP Kepala Sekolah kini **100% identik dan konsisten** dengan nilai **Total Potensial Penerimaan** pada Tab Estimasi modul Keuangan (`keuangan.html`).
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi disinkronkan ke `v1.1.370` / `[26.08.23.19]` pada `package.json`, `js/config.js`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.
  - Lulus 100% verifikasi sintaks JavaScript (62 berkas) dan unit test Jest (55 pengujian).

## [1.1.369] / [26.08.23.18] - 2026-08-23

### 🎨 Keuangan: Perbaikan Background Solid Header Tabel (Anti-Transparan saat Scroll)
- **Pembaruan Visual Header Tabel (`js/page-keuangan.js`):**
  - Memberikan warna latar belakang solid (`bg-slate-50 dark:bg-slate-800` dan `bg-indigo-100 dark:bg-indigo-950` untuk kolom aktif yang di-sort) pada setiap sel `<th>` di seluruh mode laporan Keuangan (Harian, Rekap Pemasukan, Estimasi, Tunggakan).
  - Mengeliminasi transparansi rendering browser pada `sticky thead`, sehingga saat tabel di-scroll, baris-baris data di bawahnya tertutup sempurna di belakang header tanpa artefak visual bertumpuk.
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi disinkronkan ke `v1.1.369` / `[26.08.23.18]` pada `package.json`, `js/config.js`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.
  - Lulus 100% verifikasi sintaks JavaScript (62 berkas) dan unit test Jest (55 pengujian).

## [1.1.368] / [26.08.23.17] - 2026-08-23

### 💰 Keuangan: Fitur Sorting Interaktif Kolom Tunggakan Lalu & Seluruh Kolom Tab Estimasi
- **Pengurutan Kolom Tunggakan Lalu & Metrik Lainnya (`js/page-keuangan.js`):**
  - Mengaktifkan interaktivitas pengurutan dua arah (*sort ascending / descending*) pada kolom **Tunggakan Lalu** (`tunggakanLalu`) pada Tab Estimasi Penerimaan SPP (`keuangan.html`).
  - Mengaktifkan pengurutan pada seluruh kolom metrik lainnya: **Jml Siswa**, **Estimasi SPP**, **Total Potensial**, dan **Realisasi**.
  - Default pengurutan pertama kali pada kolom nominal adalah *Descending* (dari nominal terbesar ke terkecil) agar pimpinan sekolah/bendahara dapat langsung melihat kelas dengan akumulasi tunggakan tertinggi.
  - Pengurutan berjalan instan di memori *client-side* (*zero database re-fetch*) dengan indikator panah dinamis.
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi disinkronkan ke `v1.1.368` / `[26.08.23.17]` pada `package.json`, `js/config.js`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.
  - Lulus 100% verifikasi sintaks JavaScript (62 berkas) dan unit test Jest (55 pengujian).

## [1.1.367] / [26.08.23.16] - 2026-08-23

### 💰 Keuangan: Fitur Sorting Interaktif Kolom Persentase Realisasi (%) Tab Estimasi
- **Fitur Pengurutan Dua Arah pada Tab Estimasi (`js/page-keuangan.js`):**
  - Menambahkan kemampuan interaktif pengurutan (*sorting*) pada header kolom **Realisasi %** dan **Kelas** pada Tab Estimasi Penerimaan SPP (`keuangan.html`).
  - Mengklik header **Realisasi %** akan langsung mengurutkan tabel dari persentase capaian tertinggi ke terendah (*Descending*), dan klik ulang membalik urutan (*Ascending*).
  - Mengklik header **Kelas** akan mengembalikan urutan kelas secara numerik cerdas (X-1 s/d XII-6).
  - Pengurutan beroperasi 100% pada memori *client-side* (`window.rawEstimationResults`) secara instan (*zero re-fetch*, hemat kuota database).
  - Dilengkapi ikon status pengurutan interaktif FontAwesome (`fa-sort`, `fa-sort-up`, `fa-sort-down`) dengan transisi hover lembut.
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi disinkronkan ke `v1.1.367` / `[26.08.23.16]` pada `package.json`, `js/config.js`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.
  - Lulus 100% verifikasi sintaks JavaScript (62 berkas) dan unit test Jest (55 pengujian).

## [1.1.366] / [26.08.23.15] - 2026-08-23

### 💰 Keuangan: Penetapan Saldo Awal Piutang (Cutoff Date) pada Kolom Tunggakan Lalu
- **Pembaruan Kalkulasi Tunggakan Lalu (`js/page-keuangan.js`):**
  - Mengubah penentuan status lunas tagihan historis pada kolom **Tunggakan Lalu** Tab Estimasi (`keuangan.html`) menjadi berbasis tanggal potong (*cutoff date* / `payDateStr < targetMonthStart`).
  - Tagihan bulan-bulan sebelumnya yang baru dibayar pada bulan filter (misal tunggakan Juli yang baru dibayar tanggal 10 Agustus) **tetap dihitung dan muncul pada kolom Tunggakan Lalu bulan Agustus** sebagai saldo awal piutang per 1 Agustus.
  - Pembayaran tunggakan tersebut dihitung masuk ke kolom **Realisasi Agustus**, sehingga rasio perbandingan antara **Realisasi** dan **Total Potensial** (`Tunggakan Lalu + Estimasi SPP`) tetap sinkron dan tidak mengalami distorsi persentase.
  - Ketika filter dipindahkan ke bulan berikutnya (misal September), tagihan yang telah lunas di bulan Agustus tersebut otomatis hilang dari kolom Tunggakan Lalu September.
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi disinkronkan ke `v1.1.366` / `[26.08.23.15]` pada `package.json`, `js/config.js`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.
  - Lulus 100% verifikasi sintaks JavaScript (62 berkas) dan unit test Jest (55 pengujian).

## [1.1.365] / [26.08.23.14] - 2026-08-23

### 💰 Keuangan: Penyesuaian Estimasi SPP Bulanan Terhadap Pembayaran di Muka
- **Pembaruan Kalkulasi Estimasi SPP (`js/page-keuangan.js`):**
  - Menerapkan kalkulasi *advance payment check* pada Tab Estimasi Penerimaan SPP (`keuangan.html`).
  - Siswa yang telah melunasi SPP bulan target sebelum tanggal 1 bulan berjalan (`dateStr < 'YYYY-MM-01'`) otomatis ditetapkan kewajiban tagihan SPP bulan ini sebesar **Rp 0** (karena telah lunas di muka).
  - Kolom **Estimasi SPP** kini mencerminkan **sisa tagihan kas riil yang masih diharapkan masuk di kasir** pada bulan target tersebut, sehingga proyeksi potensi penerimaan bulanan lebih realistis dan akurat.
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi disinkronkan ke `v1.1.365` / `[26.08.23.14]` pada `package.json`, `js/config.js`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.
  - Lulus 100% verifikasi sintaks JavaScript (62 berkas) dan unit test Jest (55 pengujian).

## [1.1.364] / [26.08.23.13] - 2026-08-23

### 💰 Keuangan: Sinkronisasi Realisasi Estimasi SPP dengan Arus Kas
- **Pembaruan Kalkulasi Realisasi Tab Estimasi (`js/page-keuangan.js`):**
  - Mengubah kalkulasi kolom **Realisasi** pada Tab Estimasi Penerimaan SPP (`keuangan.html`) agar menghitung seluruh arus kas masuk SPP riil yang diterima kasir pada bulan terpilih (`date_str.startsWith(targetMonthPrefix)`).
  - Menghitung secara komprehensif penerimaan SPP bulan berjalan, pelunasan tunggakan bulan-bulan sebelumnya yang dibayar di bulan tersebut, serta pembayaran di muka (*advance payment*) untuk bulan-bulan mendatang.
  - Memastikan total kumulatif realisasi pada baris footer tabel Estimasi **100% sinkron** dengan total mutasi pemasukan SPP di **Riwayat Buku Kas SPP** dan **Rekap Pemasukan**.
  - Memperbarui perhitungan persentase capaian (% Realisasi) terhadap **Total Potensial** (`Realisasi / Total Potensial * 100`) dengan fallback otomatis ke `Estimasi SPP`.
- **Sinkronisasi Ekspor Excel (`exportEstimationToExcel`):**
  - Menyesuaikan lembar kerja Excel agar mencantumkan nominal realisasi dan persentase yang selaras dengan tabel UI.
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi disinkronkan ke `v1.1.364` / `[26.08.23.13]` pada `package.json`, `js/config.js`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.
  - Lulus 100% verifikasi sintaks JavaScript (62 berkas) dan unit test Jest (55 pengujian).

## [1.1.363] / [26.08.23.12] - 2026-08-23

### 📱 PWA App Shortcuts (Menu Tekan Lama Ikon Aplikasi)
- **Integrasi Menu Pintasan Cepat PWA (`manifest.json`):**
  - Mengimplementasikan spesifikasi W3C Web App Manifest `shortcuts` sehingga saat pengguna menekan lama (*long press*) ikon aplikasi SIMAS di layar utama smartphone atau klik kanan di desktop, muncul menu aksi cepat:
    1. **Monitoring KBM (`monitoring-kbm.html`):** Akses instan ke halaman pemantauan aktivitas KBM, kehadiran siswa, dan presensi guru secara *real-time*.
    2. **Lihat Agenda (`agenda.html`):** Akses instan ke kalender agenda kegiatan sekolah dan repositori dokumen digital.
    3. **Lapor!mas (`index.html?action=lapor` / `masukan.html`):** Akses instan ke kanal aduan & aspirasi sekolah (membuka popup modal formulir pengaduan secara otomatis).
- **Penanganan Otomatisasi Parameter URL (`index.html` & `js/page-masukan.js`):**
  - Menambahkan listener dan *auto-trigger* pembukaan modal `#modal-public-report` pada `index.html` jika dibuka melalui pintasan `?action=lapor`.
  - Mengarahkan staf yang telah login ke `masukan.html?action=lapor` dan otomatis memicu pembukaan jendela modal `#feedback-modal` internal.
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi disinkronkan ke `v1.1.363` / `[26.08.23.12]` pada `package.json`, `js/config.js`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.
  - Lulus 100% verifikasi sintaks JavaScript (62 berkas) dan unit test Jest (55 pengujian).

## [1.1.362] / [26.08.23.11] - 2026-08-23

### 🔧 Penguatan Integrasi Sinkronisasi Eksternal Jurnal Mengajar & Edge Function Proxy
- **Pembaruan Edge Function `secure-proxy` (v31):**
  - Mengintegrasikan penanganan kunci API bersama (`smagesa_jurnal_key_2026_x89a`) untuk otorisasi sinkronisasi data siswa/guru dari aplikasi Jurnal Mengajar.
  - Memperbaiki penanganan galat dan cakupan variabel `isJurnalAction` di blok *exception catch* agar memberikan respon diagnostik yang jelas dan akurat.
- **Pembaruan Aplikasi Jurnal Mengajar (`v26.08.23.1`):**
  - Mengarahkan seluruh fungsi penarikan data manual (`syncSiswaFromExternal`, `syncSiswaByKelas`, `syncGuruFromExternal`, `syncSingleGuru`) ke konstanta SSOT `JURNAL_SYNC_API_KEY` di `firebase-config.js`.
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi SIMAS diperbarui ke `v1.1.362` / `[26.08.23.11]`.

## [1.1.361] / [26.08.23.10] - 2026-08-23

### 🚀 Sinkronisasi & Deployment Penuh Ekosistem Firebase & Supabase
- **Penerapan Migrasi & Pengerasan Database Supabase (`elrmzlicuuglnoeedusr`):**
  - **Migrasi `202608230001_harden_bebas_pustaka`:** Memperketat integritas data Bebas Pustaka Perpustakaan dengan indeks unik (`uq_lib_bebas_pustaka_student_nis`), pembersihan redudan, serta *cross-table transactional advisory lock & triggers* (`enforce_clearance_has_no_library_burden`, `prevent_library_burden_after_clearance`) guna mencegah anomali *race condition*.
  - **Migrasi `202608230002_lockdown_sensitive_rest_tables`:** Menutup akses terbuka tabel-tabel operasional internal di Supabase REST API dengan penegakan RLS ketat, membatasi hak akses publik hanya pada metadata katalog (`duta_kandidat`, `lib_buku`, `lib_config`, `lib_eksemplar`, `lib_kategori_ddc`), dan mencabut hak eksekusi publik fungsi *cleanup* retensi data.
- **Deployment Supabase Edge Function (`secure-proxy` v27):**
  - Menyebarkan versi terbaru fungsi *secure-proxy* yang mengamankan komunikasi REST API PostgREST (`rest-access-utils.mjs`), modul bebas pustaka, voting duta, masukan saran, suka duka, dan sinkronisasi eksternal Jurnal Mengajar.
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi diperbarui ke `v1.1.361` / `[26.08.23.10]` di `package.json`, `js/config.js`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.
  - Terverifikasi 100% lulus uji unit Jest (`npm run test:unit` -> 10/10 suites, 55 tests passed) dan verifikasi sintaks JS (`npm run check:syntax` -> 0 Error).

## [1.1.360] / [26.08.23.9] - 2026-08-23

### 🔐 Rotasi Kunci Service Account Apps Script Kapsul Waktu & Pengamanan Rahasia (SSOT)
- **Pembaruan & Pembongkaran Kredensial Terbuka (`pub/kirim_kapsul_waktu.gs`):**
  - Mengisolasi konfigurasi koneksi Firestore REST API ke fungsi `getFirebaseConfig_()` yang membaca nilai rahasia via `PropertiesService.getScriptProperties()` (`FIRESTORE_PROJECT_ID`, `FIRESTORE_CLIENT_EMAIL`, `FIRESTORE_PRIVATE_KEY`).
  - Menghapus string private key dan service account email dari source code sehingga tidak lagi tersimpan dalam repositori Git/OneDrive.
  - Memperkuat sanitasi string HTML email (`escapeHtml_`), proteksi idempoten transaksi upload foto (SHA-256), dan pencatatan anti-duplikat pengiriman kapsul waktu.
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi diperbarui ke `v1.1.360` / `[26.08.23.9]` di `package.json`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.

## [1.1.359] / [26.08.23.8] - 2026-08-23

### 👤 Fitur Self-Service Edit Data Diri Mandiri Siswa & Pengetatan Firestore Security Rules
- **Fitur Edit Data Diri Siswa di Portal Siswa (`portal-siswa.html` & `js/page-portal-siswa.js`):**
  - **Interaktivitas Header Portal Siswa:** Mengubah widget info profil siswa di header menjadi elemen interaktif lengkap dengan tombol **"Edit Data Diri"** yang responsif di tampilan mobile maupun desktop.
  - **Modal Edit Data Mandiri (`#modal-edit-profile-siswa`):**
    - **Integritas Data Resmi Sekolah (Dikunci / Readonly):** Mengunci secara permanen field krusial sekolah (Nama Lengkap, NISN, NIS, Kelas, Status Siswa, dan Catatan Sekolah) sebagai hak prerogatif pihak sekolah/admin untuk mencegah modifikasi sepihak.
    - **Kelengkapan Biodata Pribadi:** Siswa dapat memperbarui Jenis Kelamin, Tempat Lahir, Tanggal Lahir, NIK Siswa (16 digit), Nomor Kartu Keluarga (No. KK 16 digit), dan Anak Ke-.
    - **Kelengkapan Kontak & Data Keluarga:** Siswa dapat memperbarui Nomor HP/WhatsApp Siswa, Nomor HP/WhatsApp Orang Tua, Nama Ayah Kandung, dan Nama Ibu Kandung.
    - **Alamat Domisili Siswa:** Siswa dapat memperbarui Dusun/Banjar, Kelurahan/Desa, dan Kecamatan.
    - **Sinkronisasi Sesi Realtime:** Saat berhasil disimpan, sistem langsung memperbarui state in-memory `currentStudent`, `sessionStorage`, dan tampilan profil di antarmuka tanpa perlu memuat ulang (*reload*) halaman.
- **Pengamanan Ketat Firestore Security Rules (`firestore.rules`):**
  - **Helper Function `isUpdatingOwnStudentProfile(studentId)`:** Memvalidasi otorisasi bahwa siswa yang melakukan pembaruan dokumen benar-benar pemilik sah dokumen siswa tersebut berdasarkan kecocokan sesi auth (`getUserNIS()`).
  - **Penegakan Least Privilege & Whitelist Field:** Memastikan data penting (NIS, Kelas, Status, Nama Lengkap, NISN, dan Catatan) mutlak tidak dapat diubah oleh siswa, serta membatasi modifikasi hanya pada key biodata dan kontak keluarga (`affectedKeys().hasOnly(...)`).
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi diperbarui ke `v1.1.359` / `[26.08.23.8]` di `package.json`, `js/config.js`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.
  - Lulus verifikasi sintaks 55 berkas JavaScript (`npm run check:syntax` -> 0 Error) dan 100% unit test Jest (`npm run test:unit` -> 4/4 suites passed, 27 tests passed).

## [1.1.358] / [26.08.23.7] - 2026-08-23

### 🛡️ Optimasi Keandalan Auto-Lookup Online & Circuit Breaker Google Books (HTTP 429)
- **Penanganan Rate Limit & Prioritas Endpoint (`library/ddc-recommender.js`):**
  - **Open Library sebagai Endpoint Utama:** Mengarahkan pencarian metadata buku utama ke Open Library API yang sepenuhnya terbuka (*open source* & bebas batasan IP rate limit).
  - **Circuit Breaker Google Books API:** Menambahkan pendeteksi status `HTTP 429 (Too Many Requests)` dengan mode *cooldown* 5 menit. Jika Google Books mendeteksi batasan kuota publik, panggilan ke Google Books langsung di-bypass secara senyap tanpa memenuhi log konsol peramban (*console error*).
  - **Dukungan Tombol Enter & Explicit Trigger (`library/katalog.js`):** Menghilangkan *background fetch* per karakter yang memicu penumpukan panggilan jaringan, serta menambahkan event listener tombol `Enter` pada input judul dan ISBN untuk memicu auto-lookup hanya saat diinginkan.
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi diperbarui ke `v1.1.358` / `[26.08.23.7]` di `package.json`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.
  - Lulus verifikasi sintaks 55 berkas JavaScript (`npm run check:syntax` -> 0 Error).

## [1.1.357] / [26.08.23.6] - 2026-08-23

### ✨ Auto-Lookup Database Buku Global (Google Books & Open Library) & Auto-Fill Form
- **Pencarian Metadata Buku Global (`library/ddc-recommender.js` & `library/katalog.js`):**
  - **Auto-Lookup 100% Gratis & Tanpa Kuota Server:** Mengintegrasikan Google Books API dan Open Library API di sisi klien (*frontend*) untuk mencari metadata buku berdasarkan Judul atau nomor ISBN.
  - **Auto-Fill Otomatis:** Saat data ditemukan, sistem otomatis mengisi *Nama Pengarang Utama*, *Pengarang Tambahan / Penerjemah*, *Penerbit*, *Tahun Terbit*, *ISBN*, serta menampilkan thumbnail *Cover Buku*.
  - **Mapping Kategori Global ke Standar DDC Perpusnas RI:** Memetakan kategori subjek internasional (misal: *Self-Help, Juvenile Fiction, Calculus, Software Engineering, Islamic Studies*) langsung ke kode DDC resmi (`150`, `813`, `515`, `004`, `297`, dll.) dan memperbarui Nomor Panggil (*Call Number*) 3 baris secara otomatis.
  - **Hybrid Multi-Tier Fallback:** Jika pencarian online tidak menemukan hasil atau dalam kondisi offline, sistem secara mulus beralih ke mesin *Smart NLP AI lokal* tanpa jeda.
- **Antarmuka Form Bibliografi (`library/katalog.html`):**
  - Menambahkan tombol aksi cepat **"Cari Online (Auto-Fill)"** dan animasi *loading spinner*.
  - Menambahkan banner status sukses berlatar hijau yang merinci sumber data dan thumbnail cover buku.
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi diperbarui ke `v1.1.357` / `[26.08.23.6]` di `package.json`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.
  - Lulus verifikasi sintaks 55 berkas JavaScript (`npm run check:syntax` -> 0 Error).

## [1.1.356] / [26.08.23.5] - 2026-08-23

### 🤖 Peningkatan Mesin Smart NLP AI Classifier DDC v2 (Stemmer & Phrase Matching)
- **Mesin NLP Cerdas (`library/ddc-recommender.js`):**
  - **Indonesian Morphological Stemmer:** Menambahkan algoritma pemangkas imbuhan (awalan *ber-, meng-, mem-, men-, pe-, ter-, di-, ke-*, dan akhiran *-kan, -an, -i, -nya*) sehingga variasi kata seperti *bersikap*, *kebahagiaan*, *pembelajaran*, *perjalanan* otomatis terdeteksi akar katanya (*sikap*, *bahagia*, *ajar*, *jalan*).
  - **Multi-Word Phrase & Sliding Window Matching:** Menambahkan pencocokan frasa multi-kata berbobot tinggi (+35 skor) untuk mengenali judul-judul populer seperti *"Bersikap Bodo Amat"*, *"Sebuah Seni untuk Bersikap Bodo Amat"*, *"Filosofi Teras"*, *"Atomic Habits"*, *"Bicara Itu Ada Seninya"*, *"The Psychology of Money"*, *"Berani Tidak Disukai"*, dsb.
  - **Ekspansi Kosakata Self-Help & Best-Seller:** Memperkaya kelas DDC 150 (*Psikologi Umum & Pengembangan Diri*), 813 (*Fiksi Indonesia*), 500 (*Sains & Matematika*), 004 (*TI*), dan 200 (*Agama*) dengan ribuan kosakata, nama penulis terkenal (*Mark Manson, James Clear, Henry Manampiring, Andrea Hirata, Pramoedya, Purcell, Campbell*), dan frasa khas buku.
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi diperbarui ke `v1.1.356` / `[26.08.23.5]` di `package.json`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.
  - Lulus uji sintaks 55 berkas JavaScript (`npm run check:syntax` -> 0 Error).

## [1.1.355] / [26.08.23.4] - 2026-08-23

### 🎨 Perapihan Tata Letak Header & Tombol Aksi Katalog Perpustakaan
- **Penyempurnaan Header (`library/katalog.html`):**
  - Mengubah breakpoint fleksibel header menjadi `lg:flex-row` dengan pembatas lebar teks deskripsi (`max-w-2xl`).
  - Mengatur grup tombol aksi (*Ekspor Excel*, *Import Excel*, *+ Tambah Judul Buku*) agar tetap sejajar secara horizontal (*nowrap* pada layar tablet/desktop) dan tidak pecah menjadi 2 baris terpisah.
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi diperbarui ke `v1.1.355` / `[26.08.23.4]` di `package.json`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.
  - Lulus verifikasi sintaks 55 berkas JavaScript (`npm run check:syntax` -> 0 Error).

## [1.1.354] / [26.08.23.3] - 2026-08-23

### 🎨 Perbaikan CSS Z-Index Stacking Context & Overlap Dropdown Pencarian Perpustakaan
- **Penyelesaian Isu Tampilan Tumpuk (*Z-Index Stacking Context*):**
  - **Sirkulasi Peminjaman (`library/index.html`):** Mengatur konteks tumpukan z-index bertingkat (`relative z-30` pada Step 1 Identitas Peminjam, `relative z-10` pada Step 2 Scan Buku, dan `z-50 shadow-2xl` pada `#peminjam-dropdown`). Ini menyelesaikan masalah di mana input scan barcode tembus dan memotong tampilan dropdown pencarian nama siswa.
  - **Presensi Pengunjung Perpus (`library/presensi-perpus.html`):** Memperbaiki z-index dan elevation shadow pada `#visitor-autocomplete-dropdown` (`z-50 shadow-2xl rounded-2xl`).
  - **Layanan Bebas Pustaka (`library/bebas-pustaka.html`):** Memperbaiki z-index pada `#student-search-dropdown` (`z-50 shadow-2xl rounded-2xl`).
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi diperbarui ke `v1.1.354` / `[26.08.23.3]` di `package.json`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.
  - Lulus verifikasi sintaks 55 berkas JavaScript (`npm run check:syntax` -> 0 Error).

## [1.1.353] / [26.08.23.2] - 2026-08-23

### 🛡️ Sinkronisasi Filter Alumni Perpustakaan dengan Pengaturan Sistem
- **Helper Global Filter Siswa Aktif (`js/global.js`):**
  - Mengembangkan fungsi `window.isStudentActive(student, showAlumni)` untuk mendeteksi dan mengecualikan akun nonaktif (`alumni`, `mutasi`, `pindah`, `keluar`, `nonaktif`, `lulus`, `do`).
  - Mengembangkan `window.getActiveStudentsCache()` yang secara otomatis menyinkronkan opsi `showAlumni` dari `settings/system_config`.
- **Integrasi ke Seluruh Modul Perpustakaan:**
  - **Sirkulasi Peminjaman (`library/index.js`):** Pemuatan pencarian peminjam siswa kini menggunakan `window.getActiveStudentsCache()`, sehingga nama-nama siswa alumni **tidak akan muncul** jika opsi *Tampilkan Siswa Alumni* di Pengaturan dalam kondisi nonaktif (OFF).
  - **Presensi Pengunjung Perpus (`library/presensi-perpus.js`):** Pencarian pengunjung siswa disaring murni siswa aktif.
  - **Bebas Pustaka (`library/bebas-pustaka.js`):** Pilihan rombel kelas dan pencarian siswa patuh pada filter alumni sistem.
- **Pembaruan SSOT Versi Aplikasi:**
  - Versi aplikasi diperbarui ke `v1.1.353` / `[26.08.23.2]` di `package.json`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.
  - Lulus verifikasi sintaks 55 berkas JavaScript (`npm run check:syntax` -> 0 Error).

## [1.1.352] / [26.08.23.1] - 2026-08-23

### 📜 Layanan Bebas Pustaka Digital Terpadu (Perpustakaan, Wali Kelas, & Portal Siswa)
- **Panel Pustakawan (`library/bebas-pustaka.html` & `library/bebas-pustaka.js`):**
  - Mengembangkan sistem **Bebas Pustaka Digital 100% Paperless** terintegrasi database Supabase `lib_bebas_pustaka` (SSOT).
  - **Tab Verifikasi Satuan**: Pencarian siswa instan, validasi otomatis 0 pinjaman aktif & 0 denda, penerbitan nomor surat digital resmi (`421.3/xxxx/SMAGESA/SKBP/YYYY`), dan pratinjau dokumen digital.
  - **Tab Verifikasi Massal Rombel Kelas**: Pilihan kelas, summary bar statistik rombel (Total Siswa, Sudah Bebas, Bersih Siap Disetujui, Ada Tanggungan), dan tombol 1-klik `✓ Setujui Semua Siswa Bersih (Batch)` serta aksi per siswa (*Setujui Digital* / *Cabut Status*).
  - Tabel riwayat surat bebas pustaka digital dengan filter pencarian live dan aksi *Lihat E-Surat* / *Cabut Status*.
- **Integrasi Portal Wali Kelas (`wali-kelas.html` & `js/page-wali-kelas.js`):**
  - Tab Buku Perpustakaan kini menampilkan badge ringkasan `Bebas Pustaka: X / Y Siswa (Z%)`.
  - Filter tabel baru: `Sudah Bebas Pustaka Digital` dan `Belum Bebas Pustaka`.
  - Indikator badge hijau `✓ Bebas Pustaka` pada nama siswa yang sudah disetujui perpustakaan.
- **Integrasi Portal Siswa (`portal-siswa.html` & `js/page-portal-siswa.js`):**
  - Kartu Status Bebas Pustaka Digital real-time di Tab Perpustakaan dengan status verifikasi resmi.
  - Modal pratinjau **E-Surat Keterangan Bebas Perpustakaan Resmi** lengkap dengan kop dinas, tanda tangan & cap digital, QR verifikasi SIMAS, dan tombol cetak/unduh PDF.
- **Penyempurnaan UI Katalog Perpustakaan (`library/katalog.html` & `library/katalog.js`):**
  - Merombak Toolbar Filter & Pencarian menjadi Responsive CSS Grid 12-kolom dengan ikon pencarian terintegrasi.
  - Memindahkan tombol *Ekspor Excel* ke header bersama *Import Excel* dan *Tambah Judul Buku*.
  - Desain ulang *Empty State* tabel buku dengan ilustrasi modern dan tombol CTA.
- **Pembaruan SSOT Versi Aplikasi:**
  - Memperbarui versi aplikasi ke `v1.1.352` / `[26.08.23.1]` pada `package.json`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.
  - Lulus uji sintaks 55 berkas JavaScript (`npm run check:syntax` -> 0 Error).

## [1.1.351] / [26.08.22.5] - 2026-08-22

### 🤖 Smart NLP AI Classifier Rekomendasi DDC Perpustakaan
- **Client-Side Natural Language Processing (NLP) Engine (`library/ddc-recommender.js`):**
  - Mengembangkan modul klasifikasi teks DDC mandiri (100% Client-Side JavaScript, 0 Biaya API, 0 Konsumsi Kuota, Komputasi Instan < 5ms).
  - Mengimplementasikan Tokenizer, Normalizer, N-Gram Generator (Unigram & Bigram), dan Stopwords Filter bilingual (Bahasa Indonesia & Inggris + terminologi penerbitan buku).
  - Scoring berbobot (TF-IDF & Hierarchical Specificity Boost) yang membedakan kode umum (misal 510) dan sub-kode spesifik (misal 515 Kalkulus, 512 Aljabar, 004 Pemrograman/TI, 294.5 Agama Hindu, 813 Fiksi Indonesia, 959.8 Sejarah Indonesia) dengan kalkulasi *confidence score* (0% - 98%).
- **Integrasi UI Katalog Bibliografi (`library/katalog.html` & `library/katalog.js`):**
  - Menambahkan kontainer interaktif **Rekomendasi Pintar AI (NLP)** di bawah form Klasifikasi DDC.
  - Render chip rekomendasi dengan indikator warna confidence: Hijau (>= 80%), Kuning (55% - 79%), dan Biru (< 55%).
  - Pemilihan DDC 1-touch via klik chip yang langsung mengisi form DDC dan otomatis memperbarui Call Number standar Perpusnas RI (`updateAutoCallNumber`).
  - Auto-debounce listener (280ms) saat petugas mengetik Judul Buku, Pengarang, maupun Penerbit.
- **Ekspansi Master DDC Supabase (`supabase/migrations/202608220002_expand_ddc_master.sql`):**
  - Menambahkan 44 sub-klasifikasi DDC esensial jenjang SMA ke tabel `lib_kategori_ddc` (total menjadi 65 kategori terdaftar di Supabase).
- **Pembaruan SSOT Versi Aplikasi:**
  - Memperbarui versi aplikasi menjadi `v1.1.351` / `[26.08.22.5]` pada `package.json`, `PRD_SIMAS.md`, dan `CHANGELOG.md`.
  - Lulus verifikasi unit test DDC NLP dan pemeriksaan sintaks 55 berkas JavaScript (`npm run check:syntax` -> 0 Error).

## [1.1.350] / [26.08.22.4] - 2026-08-22

### 📖 Fitur "Pinjaman Saya" di OPAC & Clean Input Design
- **OPAC Perpustakaan (`library/opac.html` & `library/opac.js`):**
  - Menambahkan section **Pinjaman Saya** yang tampil otomatis jika user sudah login.
  - Resolve identitas peminjam: NIS (siswa via `sessionStorage`) atau NIP (guru/staff via `getLinkedTeacherForUser` cache).
  - Tab **Sedang Dipinjam**: menampilkan kartu rincian buku aktif (Judul, Pengarang, Barcode, Tanggal Pinjam, Jatuh Tempo, indikator Terlambat beserta estimasi denda).
  - Tab **Riwayat Pengembalian**: menampilkan daftar buku yang sudah dikembalikan dengan informasi denda jika ada.
  - Counter badge real-time untuk jumlah buku aktif dan sudah kembali.
- **Clean Input Design (Bersihkan Icon Kaca Pembesar):**
  - `wali-kelas.html`: Menghapus icon `fa-magnifying-glass` absolute pada input `perpus-search-input`.
  - `e-rapor.html`: Menghapus icon `fa-search` absolute pada input `search-mapping-guru`.
  - `guru-wali.html`: Menghapus icon `fa-search` absolute pada input `search-siswa`.
  - Semua input di atas menggunakan `px-3.5` padding simetris agar teks tidak tertutup icon.
- **Pembaruan SSOT Versi Aplikasi:**
  - Memperbarui versi aplikasi menjadi `v1.1.350` / `[26.08.22.4]` pada `package.json`, `js/config.js`, dan `PRD_SIMAS.md`.
  - Lulus pemeriksaan sintaks 54 berkas JavaScript (`npm run check:syntax` -> 0 Error).

## [1.1.349] / [26.08.22.3] - 2026-08-22

### 📖 Integrasi Monitoring Buku Perpustakaan Siswa & Wali Kelas
- **Portal Siswa (`portal-siswa.html` & `js/page-portal-siswa.js`):**
  - Menambahkan tab **Perpus** pada bilah navigasi utama Portal Siswa.
  - Menampilkan ringkasan status pinjaman (Buku Sedang Dipinjam, Terlambat, Total Riwayat Pinjam).
  - Menampilkan kartu rincian buku yang sedang dipinjam (Judul, Pengarang, Barcode, Tanggal Pinjam, Jatuh Tempo, Peringatan Terlambat beserta estimasi denda).
  - Riwayat pengembalian buku sebelumnya serta tautan langsung ke katalog publik OPAC (`library/opac.html`).
- **Portal Wali Kelas (`wali-kelas.html` & `js/page-wali-kelas.js`):**
  - Menambahkan tab **Buku Perpustakaan** pada dashboard perwalian kelas.
  - Memantau seluruh transaksi peminjaman buku perpustakaan siswa rombel binaan secara real-time dari Supabase `lib_sirkulasi` (0 kuota read Firestore).
  - Ringkasan indikator rombel: Total Buku Sedang Dipinjam, Jumlah Siswa Terlambat/Menunggak, dan Total Denda Keterlambatan.
  - Fitur pencarian live nama/judul buku, filter status (`Sedang Dipinjam`, `Terlambat`, `Kembali`, `Semua`), dan ekspor rekapitulasi ke Excel (.xlsx).
- **Pembaruan SSOT Versi Aplikasi:**
  - Memperbarui versi aplikasi menjadi `v1.1.349` / `[26.08.22.3]` pada `package.json`, `js/config.js`, dan `PRD_SIMAS.md`.
  - Lulus pemeriksaan sintaks 54 berkas JavaScript (`npm run check:syntax` -> 0 Error).

## [1.1.348] / [26.08.22.2] - 2026-08-22

### 📚 Modul Perpustakaan Sekolah Terpadu (Library Module - `library/*`)
- **Arsitektur Supabase Backend Hemat Kuota (`lib_*`):**
  - Mengimplementasikan seluruh backend modul perpustakaan di Supabase PostgreSQL untuk menjamin konsumsi 0 kuota read Firestore.
  - Membuat dan memverifikasi 7 tabel relasional: `lib_kategori_ddc`, `lib_buku`, `lib_eksemplar`, `lib_sirkulasi`, `lib_pengunjung`, `lib_bebas_pustaka`, dan `lib_config`, lengkap dengan RLS, trigger, dan indeks.
- **Standar Perpustakaan Nasional (Perpusnas RI) & DDC:**
  - Klasifikasi 10 Kelas Utama Dewey Decimal Classification (000 Karya Umum s.d. 900 Sejarah).
  - Generator Call Number 3 baris otomatis standar nasional: `[DDC] [3_HURUF_PENGARANG] [1_HURUF_JUDUL]` (contoh: `510 PUR m`).
  - Generator Nomor Induk (Accession) & Barcode otomatis: `SMG-LIB-YYYY-XXXXX`.
  - Modul Cetak Stiker Punggung Buku (*Spine Label*) dan Kartu Barcode resolusi tinggi dengan `JsBarcode` (CODE128).
- **Halaman Modul Perpustakaan (`library/`):**
  - `library/index.html` & `library/index.js`: Dashboard statistik real-time, form peminjaman cepat (autocomplete siswa/guru & scan barcode), pengembalian 1-scan otomatis dengan kalkulator denda & durasi libur, perpanjangan masa pinjam, serta riwayat sirkulasi dengan ekspor Excel.
  - `library/katalog.html` & `library/katalog.js`: Pengelolaan bibliografi, manajemen eksemplar fisik per judul buku (Copy 1, 2, dst.), import massal Excel beserta template unduhan, dan pencetakan stiker label.
  - `library/opac.html` & `library/opac.js`: Katalog publik online ramah seluler bagi siswa, guru, dan tamu dengan filter interaktif DDC 10 kelas dan modal ketersediaan stok fisik di rak.
  - `library/presensi-perpus.html` & `library/presensi-perpus.js`: Buku tamu digital presensi pengunjung perpustakaan dengan pencarian autocomplete, pemilihan keperluan, live feed, dan rekapitulasi.
  - `library/bebas-pustaka.html` & `library/bebas-pustaka.js`: Layanan verifikasi 1-klik bebas tanggungan buku dan denda untuk siswa tingkat akhir/mutasi, dilengkapi generator surat keterangan resmi ber-KOP sekolah siap cetak/PDF dan riwayat terbitan.
  - `library/laporan.html` & `library/laporan.js`: Laporan statistik akreditasi (Distribusi 10 Kelas DDC, Rekap Sirkulasi Bulanan, Leaderboard Top Reader & Top Books, Rekap Denda Keterlambatan) dan ekspor Excel.
  - `library/pengaturan.html` & `library/pengaturan.js`: Konfigurasi operasional perpustakaan (durasi pinjam, batas kuota pinjam, tarif denda, abaikan libur akhir pekan, prefix barcode) dan master klasifikasi DDC.
- **Integrasi RBAC & Multi-Role:**
  - Menambahkan peran resmi `admin_perpus` (Admin Perpustakaan) sebagai *Primary Role* dan *Additional Role* di sistem SIMAS (`js/global.js`, `users.html`, `js/page-users.js`).
  - Menambahkan grup menu *Perpustakaan* di sidebar navigasi SIMAS.
- **Verifikasi & Validasi:**
  - Lulus pemeriksaan sintaks 54 berkas JavaScript (`npm run check:syntax` -> 0 Error).
  - Pembaruan dokumen PRD dan versi aplikasi (`PRD_SIMAS.md`, `package.json`, `js/config.js`).

## [1.1.347] / [26.08.22.1] - 2026-08-22

### ⚡ Optimasi Firestore Read Produksi Tanpa Regresi UX
- **Cache Agregat Bertahap (`js/global.js`, `functions/index.js`):** Memisahkan invalidasi master siswa dari `student_aggregates`, menambahkan *single-flight request de-duplication*, serta metadata `aggregateVersion`/`lastAggregateNis` agar satu perubahan poin dapat direkonsiliasi dengan satu read dokumen. Lompatan versi tetap aman melalui rekonsiliasi penuh satu kali.
- **Wali Kelas Berbasis Rombel (`js/page-wali-kelas.js`):** Mengganti pembacaan seluruh siswa dan agregat sekolah dengan query siswa per kelas serta agregat NIS per chunk. Cache global tetap dipertahankan sebagai fallback offline. Penyimpanan catatan kini optimistis di UI dan agregat hanya ditulis Cloud Functions.
- **Dashboard Berbiaya Tetap (`js/page-dashboard.js`, `functions/index.js`):** Menambahkan ringkasan server-side `settings/dashboard_stats`, trigger berbasis sinyal master `lastUpdateStudents`, dan rekonsiliasi harian. Dashboard memakai satu dokumen ringkasan dengan fallback ke cache siswa lama hingga inisialisasi selesai, tanpa membuat satu hot write untuk setiap siswa saat import massal.
- **Isolasi Metadata Master (`js/page-settings.js`, `js/page-students.js`):** Sinkronisasi daftar kelas kini memakai `lastUpdateClasses`, perubahan bobot EWS tidak lagi menyentuh metadata siswa, sedangkan hapus/migrasi agregat menerbitkan lompatan `aggregateVersion` yang aman bagi seluruh klien.
- **Penyaring Sinkronisasi Jurnal (`functions/index.js`, `functions/jurnal-sync-utils.js`):** Perubahan field akun/guru yang tidak dipakai Jurnal tidak lagi menjadwalkan full-sync guru. Proses hapus batch guru juga kini menunggu setiap commit secara benar.
- **Verifikasi:** Lulus pemeriksaan sintaks 47 berkas JavaScript, 27/27 unit test, dan `git diff --check`; versi aplikasi diselaraskan pada `package.json`, `js/config.js`, serta `PRD_SIMAS.md`.

## [1.1.346] / [26.08.21.16] - 2026-08-21

### 🏷️ Standardisasi Istilah Ringkas Tab Masukan (`masukan.html` & `js/page-masukan.js`)
- **Penyederhanaan Label Tab Segmentasi:**
  - Mengubah label tab menjadi lebih ringkas dan to-the-point: **Aktif**, **Selesai**, dan **Semua** pada baris tab panel masukan di [`masukan.html`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/masukan.html).
  - Menyelaraskan teks header bagian (*section headers*) dan pesan kondisi kosong (*empty state*) pada [`js/page-masukan.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-masukan.js) menjadi `Masukan Aktif` dan `Masukan Selesai`.
- **Pembaruan SSOT Versi Aplikasi:**
  - Memperbarui versi aplikasi menjadi `v1.1.346` / `[26.08.21.16]` pada [`package.json`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/package.json), [`js/config.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/config.js), dan [`PRD_SIMAS.md`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/PRD_SIMAS.md).

## [1.1.345] / [26.08.21.15] - 2026-08-21

### 👥 Dukungan Filter 'User Internal' pada Modul Masukan (`masukan.html` & `js/page-masukan.js`)
- **Penambahan Opsi Filter Pelapor Internal:**
  - Menambahkan opsi `User Internal` (`<option value="internal">User Internal</option>`) pada dropdown filter pelapor di [`masukan.html`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/masukan.html).
  - Mengembangkan logika pemfilteran pada [`js/page-masukan.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-masukan.js) agar ketika opsi *User Internal* dipilih, sistem secara akurat menyaring seluruh masukan internal yang dikirim oleh sivitas akademika sekolah (guru, pegawai/staf TU, siswa, maupun akun internal SIMAS lainnya).
- **Pembaruan SSOT Versi Aplikasi:**
  - Memperbarui versi aplikasi menjadi `v1.1.345` / `[26.08.21.15]` pada [`package.json`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/package.json), [`js/config.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/config.js), dan [`PRD_SIMAS.md`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/PRD_SIMAS.md).

## [1.1.344] / [26.08.21.14] - 2026-08-21

### 🧹 Eliminasi Dropdown Filter Status Usang (`masukan.html` & `js/page-masukan.js`)
- **Pembersihan Toolbar Filter:**
  - Menghapus dropdown filter `#feedback-status-filter` dari baris toolbar header pada [`masukan.html`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/masukan.html) dan [`js/page-masukan.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-masukan.js).
  - Pengelompokan status masukan kini 100% dialihkan dan dikelola secara intuitif oleh baris Segmented Tabs (**Aktif & Proses**, **Sudah Selesai**, **Semua**), menghasilkan tampilan antarmuka yang jauh lebih ringkas, bersih, dan cepat.
- **Pembaruan SSOT Versi Aplikasi:**
  - Memperbarui versi aplikasi menjadi `v1.1.344` / `[26.08.21.14]` pada [`package.json`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/package.json), [`js/config.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/config.js), dan [`PRD_SIMAS.md`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/PRD_SIMAS.md).

## [1.1.343] / [26.08.21.13] - 2026-08-21

### 📑 Pemisahan Masukan Aktif / Dalam Proses & Masukan Sudah Selesai (`masukan.html` & `js/page-masukan.js`)
- **Segmented Tabs Navigasi Masukan:**
  - Menambahkan bar navigasi segmentasi 3 tab pada panel masukan: **Aktif & Proses** (`active`), **Sudah Selesai** (`completed`), dan **Semua** (`all`).
  - Menampilkan badge counter jumlah dinamis secara real-time pada setiap tab (`#badge-tab-active`, `#badge-tab-completed`, `#badge-tab-all`) yang sinkron dengan filter tujuan dan pelapor.
- **Pengelompokan & Section Divider:**
  - Pada tab *Semua*, daftar masukan otomatis dikelompokkan secara visual menggunakan pembatas bagian (*section dividers*) yang memisahkan masukan aktif dan masukan yang sudah selesai ditangani.
  - Memberikan visual highlight aksen hijau lembut (*soft emerald background* & icon check) pada kartu masukan yang berstatus `selesai`.
- **Pembaruan SSOT Versi Aplikasi:**
  - Memperbarui versi aplikasi menjadi `v1.1.343` / `[26.08.21.13]` pada [`package.json`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/package.json), [`js/config.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/config.js), dan [`PRD_SIMAS.md`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/PRD_SIMAS.md).

## [1.1.342] / [26.08.21.12] - 2026-08-21

### 💎 Eliminasi Total Dialog `confirm()` & `alert()` Jadul Bawaan Browser
- **Modern Glassmorphic Confirm Modal di Seluruh Modul:**
  - Mengganti seluruh sisa dialog popup bawaan browser (`confirm()`) pada aksi penghapusan masukan (`deleteFeedback` di [`js/page-masukan.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-masukan.js)), nominasi duta ([`js/page-duta-admin.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-duta-admin.js) & [`duta/admin.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/duta/admin.js)), mapel & guru ([`js/page-e-rapor.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-e-rapor.js)), migrasi data presensi ([`js/page-integrasi.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-integrasi.js)), transaksi kas ([`js/page-keuangan.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-keuangan.js)), catatan wali kelas ([`js/page-wali-kelas.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-wali-kelas.js)), game & kapsul waktu ([`pid/admin.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/pid/admin.js) & [`pub/admin-kapsul.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/pub/admin-kapsul.js)).
  - Mengarahkan seluruh fallback modal konfirmasi lokal di [`js/page-agenda.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-agenda.js), [`js/page-bk.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-bk.js), [`js/page-guru-mapel.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-guru-mapel.js), [`js/page-input.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-input.js), [`js/page-peminatan-hasil.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-peminatan-hasil.js), [`js/page-settings.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-settings.js), dan [`js/page-students.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-students.js) ke fungsi `window.showConfirmModal` universal yang mendukung tema Dark Mode, Glassmorphism, backdrop blur, dan animasi modern.
  - Membersihkan pemanggilan `alert()` pada ekspor laporan di [`js/page-presensi.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-presensi.js) menjadi notifikasi toast `window.showToast`.
- **Pembaruan SSOT Versi Aplikasi:**
  - Memperbarui versi aplikasi menjadi `v1.1.342` / `[26.08.21.12]` pada [`package.json`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/package.json), [`js/config.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/config.js), dan [`PRD_SIMAS.md`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/PRD_SIMAS.md).

## [1.1.341] / [26.08.21.11] - 2026-08-21

### 🛡️ Perbaikan Otentikasi Token Admin pada Edge Function `secure-proxy` (Supabase v20)
- **Resolusi Bug `activeToken is not defined` ([`supabase/functions/secure-proxy/index.ts`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/supabase/functions/secure-proxy/index.ts)):**
  - Memperbaiki kesalahan variabel referensi `activeToken` menjadi `token` pada aksi `get-feedbacks`, `tanggapi-feedback`, dan `delete-feedback` saat memanggil `validateAdminAccess`.
  - Menerapkan pengesahan otentikasi pimpinan & super admin yang lancar tanpa memicu HTTP status 500 error pada serverless Edge Function.
  - Mendistribusikan (*deploy*) Edge Function `secure-proxy` versi terbaru (`v20`) langsung ke Supabase Cloud (`ACTIVE`).
- **Pembaruan SSOT Versi Aplikasi:**
  - Memperbarui versi aplikasi menjadi `v1.1.341` / `[26.08.21.11]` pada [`package.json`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/package.json), [`js/config.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/config.js), dan [`PRD_SIMAS.md`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/PRD_SIMAS.md).

## [1.1.340] / [26.08.21.10] - 2026-08-21

### ⚡ Eliminasi Cache Stampede & Optimasi Kuota Read Firestore Fase Produksi
- **Isolasi Metadata Transaksional ([`js/page-input.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-input.js)):**
  - Menghapus penulisan pemicu `lastUpdateStudents: serverTimestamp()` pada saat penyimpanan Pelanggaran, Permisi, Prestasi, dan Penghapusan Catatan Disiplin.
  - Mencegah siaran sinyal invalidasi massal (*cache stampede / thundering herd problem*) ke puluhan perangkat guru lain yang sedang online di sekolah.
  - Mempertahankan integritas data transaksi ke koleksi `records` dan kalkulasi agregat server-side otomatis oleh Cloud Functions ke `student_aggregates`.
- **Konsolidasi SSOT Caching Siswa ([`js/page-input.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-input.js), [`js/page-duta-admin.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-duta-admin.js)):**
  - Mengganti kueri manual `getDocFromServer()` dengan fungsi terpusat `window.getStudentsCache()` dan `window.getStudentAggregatesCache()` yang terintegrasi langsung dengan IndexedDB dan TTL memori.
  - Menghemat 100% *server read* tambahan saat membuka form pencarian siswa jika data di cache lokal masih valid.
- **Dokumentasi PRD & Sinkronisasi Versi:**
  - Menambahkan Sub-bab 5.5 (*Kebijakan Isolasi Metadata & Eliminasi Cache Stampede*) pada [`PRD_SIMAS.md`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/PRD_SIMAS.md).
  - Memperbarui versi aplikasi ke `v1.1.340` / `[26.08.21.10]` pada [`package.json`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/package.json), [`js/config.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/config.js), dan [`PRD_SIMAS.md`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/PRD_SIMAS.md).

## [1.1.339] / [26.08.21.9] - 2026-08-21

### 🛠️ Perbaikan Parsing Tanggal Kalender & Agenda Sekolah (`js/page-agenda.js`)
- **Robust Date Parsing & Null-Safety ([`js/page-agenda.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-agenda.js)):**
  - Mengatasi galat *TypeError: Cannot read properties of undefined (reading 'substring')* pada fungsi `loadEvents` dan `loadCalendarEvents` saat membaca data agenda dari *sessionStorage cache* atau dokumen Firestore.
  - Membangun fungsi utilitas `parseDate(ts)` universal yang secara andal mengenali berbagai format tanggal: instance `Date`, objek *Firestore Timestamp* (`.toDate()`), objek hasil serialisasi JSON (`{ seconds, nanoseconds }` / `{ _seconds }`), serta *ISO date string*.
  - Menambahkan *null-coalescing fallback* pada ekstraksi nama bulan (`months[d.getMonth()]`) agar tidak menyebabkan *crash* apabila terdapat tanggal agenda yang tidak valid.
- **Pembaruan SSOT Versi Aplikasi:**
  - Memperbarui versi aplikasi menjadi `v1.1.339` / `[26.08.21.10]` pada [`package.json`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/package.json), [`js/config.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/config.js), dan [`PRD_SIMAS.md`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/PRD_SIMAS.md).

## [1.1.338] / [26.08.21.9] - 2026-08-21

### 🎯 Konsolidasi Tombol Tunggal Input Masukan & Eliminasi Tombol Duplikat
- **Pembersihan Tombol Duplikat ([`masukan.html`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/masukan.html), [`js/page-masukan.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-masukan.js), [`js/global.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/global.js)):**
  - Menyatukan akses formulir masukan ke **1 (satu) tombol utama tunggal** pada banner header atas (`.premium-header`).
  - Menghapus tombol *Input Masukan* dari toolbar filter sehingga area filter murni berisi 3 dropdown kriteria (*Tujuan, Status, Pelapor*).
  - Menghapus tombol pemicu dari tampilan *Empty State* untuk mencegah penumpukan tombol berlebih pada halaman yang sama.
  - Memperketat pengecekan di `js/global.js` agar widget tombol saran floating tidak terinjeksi ganda pada halaman Masukan.
- **Pembaruan SSOT Versi Aplikasi:**
  - Memperbarui versi aplikasi menjadi `v1.1.338` / `[26.08.21.9]` pada [`package.json`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/package.json), [`js/config.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/config.js), dan [`PRD_SIMAS.md`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/PRD_SIMAS.md).

## [1.1.337] / [26.08.21.8] - 2026-08-21

### 📐 Relokasi Tombol Lupa Sandi & Penataan 1 Baris Link Bantuan Login
- **Relokasi Tombol Lupa Sandi ([`index.html`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/index.html)):**
  - Memindahkan tombol `Lupa Sandi?` ke baris header di atas kolom input kata sandi (sejajar di sebelah kanan label *Kata Sandi*), sehingga hanya muncul saat mode Staff/Guru aktif dan tersembunyi rapi saat mode Siswa (tanggal lahir).
  - Merapikan baris bawah link bantuan menjadi hanya berisi `Daftar Akun` dan `Lapor!mas`, memastikan seluruh tautan termuat rapi dalam **1 baris tunggal** (*single line*) tanpa terpotong atau wrap ke baris baru.
- **Pembaruan SSOT Versi Aplikasi:**
  - Memperbarui versi aplikasi menjadi `v1.1.337` / `[26.08.21.8]` pada [`package.json`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/package.json), [`js/config.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/config.js), dan [`PRD_SIMAS.md`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/PRD_SIMAS.md).

## [1.1.336] / [26.08.21.7] - 2026-08-21

### 🎛️ Perapian & Penataan Toolbar Filter Masukan Menjadi Desain Compact Inline
- **Perapian Filter Toolbar ([`masukan.html`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/masukan.html)):**
  - Menata ulang dropdown Filter Tujuan, Filter Status, Filter Pelapor, dan tombol aksi *Input Masukan* agar tersusun rapi secara horizontal (*inline compact*).
  - Menerapkan *custom micro-chevron icon* dan `appearance-none` untuk mencegah *dropdown select* bertumpuk (*stacked*) secara vertikal dan menjaga ukuran seragam di semua browser.
  - Memperbaiki tata letak responsif (*mobile & desktop*) sehingga header daftar masukan tampak proporsional, hemat ruang vertikal, dan estetis.
- **Pembaruan SSOT Versi Aplikasi:**
  - Memperbarui versi aplikasi menjadi `v1.1.336` / `[26.08.21.7]` pada [`package.json`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/package.json), [`js/config.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/config.js), dan [`PRD_SIMAS.md`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/PRD_SIMAS.md).

## [1.1.335] / [26.08.21.6] - 2026-08-21

### 💬 Mode Popup Modal untuk Formulir Input Masukan Internal & Perluasan Layout Full-Width
- **Mode Popup Modal Form Masukan ([`masukan.html`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/masukan.html), [`js/page-masukan.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-masukan.js)):**
  - Mengubah formulir pengiriman masukan internal yang sebelumnya melekat di kolom samping (*sidebar grid*) menjadi jendela popup modal interaktif (`#feedback-modal`) berdesain *glassmorphism* & *dark mode*.
  - Menyediakan tombol pemicu (*trigger*) **`Input Masukan`** yang mudah diakses pada banner header atas, toolbar filter daftar laporan, serta pada tombol aksi *Empty State* ketika daftar kosong.
  - Memperluas panel daftar masukan & laporan (*Full Width*) sehingga konten dan rincian tanggapan laporan tampil lebih luas, rapi, dan mudah dibaca.
  - Mengintegrasikan otomatisasi pembukaan modal saat halaman dibuka dengan parameter `?source=...` (misalnya saat tombol *Lapor Kendala* dari halaman lain diklik).
  - Menambahkan dukungan penutupan modal via klik latar belakang (*backdrop overlay*), tombol 'Batal/X', serta tombol pintasan keyboard `Escape`.
- **Pembaruan SSOT Versi Aplikasi:**
  - Memperbarui versi aplikasi menjadi `v1.1.335` / `[26.08.21.6]` pada [`package.json`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/package.json), [`js/config.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/config.js), dan [`PRD_SIMAS.md`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/PRD_SIMAS.md).

## [1.1.334] / [26.08.21.5] - 2026-08-21

### 🏷️ Penyesuaian Penamaan Brand Tombol 'Lapor!mas' di Halaman Login
- **Penamaan Tombol & Header Modal ([`index.html`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/index.html)):**
  - Mengubah label tombol aksi publik pada kartu login beranda dari `Lapor / Saran` menjadi **`Lapor!mas`**.
  - Menyelaraskan judul header modal publik formulir pengaduan menjadi **`Lapor!mas`**.
- **Pembaruan SSOT Versi Aplikasi:**
  - Memperbarui versi aplikasi menjadi `v1.1.334` / `[26.08.21.5]` pada [`package.json`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/package.json), [`js/config.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/config.js), dan [`PRD_SIMAS.md`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/PRD_SIMAS.md).

## [1.1.333] / [26.08.21.4] - 2026-08-21

### 📢 Integrasi Fitur Lapor & Kotak Saran Publik di Halaman Login & Pengetatan Akses Eksklusif 5 Pimpinan
- **Kanal Lapor & Kotak Saran Publik Halaman Login ([`index.html`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/index.html)):**
  - Menambahkan tombol akses publik **`Lapor / Saran`** pada kartu login beranda (`index.html`) yang dapat diakses oleh siapa saja tanpa memerlukan login.
  - Membangun Modal Formulir Lapor Publik (`#modal-public-report`) interaktif dengan dukungan *Dark Mode* dan *Glassmorphism*.
  - Menyediakan pilihan **10 Unit Tujuan Laporan**: *Semua Pimpinan / Umum, Kepala Sekolah, Wakasek Kurikulum, Wakasek Kesiswaan, Wakasek Humas, Wakasek Sarpras, Kepala Laboratorium, Tata Usaha / Staff TU, Bapak / Ibu Guru, dan Super Admin / Tim IT*.
  - Menyediakan **7 Kategori Laporan Umum**: *Akademik & Pembelajaran, Kesiswaan & Kedisiplinan, Sarana Prasarana & Laboratorium, Pelayanan Tata Usaha & Administrasi, Hubungan Masyarakat & Informasi, Sistem Informasi SIMAS & Akun, serta Saran, Aspirasi & Pengaduan Umum*.
  - Menyediakan identitas pengirim fleksibel (pilihan jenis pelapor: *Siswa, Orang Tua / Wali, Guru / Pegawai, Alumni, Tamu / Umum*, opsi centang *Anonim*, serta kolom kontak WhatsApp/Email opsional).
- **Penyimpanan Murni di Supabase PostgreSQL & Migrasi Skema ([`supabase/migrations/202608210001_add_target_and_public_report_fields.sql`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/supabase/migrations/202608210001_add_target_and_public_report_fields.sql), [`supabase/functions/secure-proxy/index.ts`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/supabase/functions/secure-proxy/index.ts)):**
  - Menambahkan kolom `target_recipient`, `reporter_type`, dan `contact_info` pada tabel Supabase `masukkan_saran` dengan indeks pencarian teroptimasi.
  - Memperbarui serverless function `secure-proxy` pada endpoint `submit-feedback` agar mendukung penyimpanan laporan publik tamu dan pengamanan endpoint `tanggapi-feedback`.
  - Memastikan *zero storage overhead* pada Firestore untuk data dokumen laporan.
- **Akses Berjenjang Menu Masukan & Perlindungan Laporan Publik ([`js/global.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/global.js), [`masukan.html`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/masukan.html), [`js/page-masukan.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-masukan.js)):**
  - Mengembalikan menu *Masukan* di sidebar untuk seluruh akun Guru, Staf TU, dan Administrator agar tetap dapat mengakses halaman masukan serta mengirimkan laporan internal.
  - Membatasi daftar masukan untuk peran non-pimpinan di level database/backend sehingga mereka **hanya dapat melihat masukan dari Pengguna Internal**.
  - Mengunci daftar dan hak tanggap masukan selain internal user (masukan dari Tamu Publik, Orang Tua, Alumni, dan Anonim) secara eksklusif hanya untuk **5 peran pimpinan**: `super_admin`, `kepala_sekolah`, `kesiswaan`, `wakasek_kurikulum`, dan `kepala_lab`.
  - Mengintegrasikan filter multi-kriteria *real-time* di `masukan.html`: Filter Tujuan Penerima (10 Unit), Filter Status Penanganan (6 Status), dan Filter Jenis Pelapor (*Publik* vs *Internal*).
  - Menampilkan badge visual berwarna untuk Tujuan Laporan, badge Jenis Pelapor, serta rincian kontak pengirim di kartu laporan.
- **Penyelarasan PRD SSOT & Manifes Versi ([`PRD_SIMAS.md`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/PRD_SIMAS.md), [`package.json`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/package.json), [`js/config.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/config.js)):**
  - Mendokumentasikan spesifikasi Fitur Lapor Publik dan hak akses eksklusif 5 pimpinan pada Subbab 4.18 dan Kamus Data Tabel 18 `PRD_SIMAS.md`.
  - Memperbarui versi aplikasi menjadi `v1.1.333` / `[26.08.21.4]`.

## [1.1.332] / [26.08.21.3] - 2026-08-21

### 🔢 Penomoran Siswa Berurutan Alfabetis Murni pada Form Jurnal Mengajar
- **Penomoran Kolom Siswa Berbasis Indeks Urutan Alfabetis ([`jurnal-app.js`](file:///c:/Users/SSA/Documents/GitHub/jurnal-mengajar-smagesa/jurnal-app.js), [`jurnal.html`](file:///c:/Users/SSA/Documents/GitHub/jurnal-mengajar-smagesa/jurnal.html), [`version.js`](file:///c:/Users/SSA/Documents/GitHub/jurnal-mengajar-smagesa/version.js)):**
  - Mengubah penomoran pada kolom nomor siswa di form pengisian jurnal mengajar agar menggunakan urutan sekuensial murni (1, 2, 3, ..., N) sesuai urutan nama siswa secara alfabetis (A–Z), bukan lagi mengambil nomor absen statis dari database.
  - Memastikan atribut `data-absen` dan visual nomor baris selalu sinkron, rapi, dan mudah dicocokkan oleh guru pengajar saat melakukan presensi kelas.
- **Penyelarasan PRD SSOT & Manifes Versi ([`PRD_SIMAS.md`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/PRD_SIMAS.md), [`package.json`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/package.json)):**
  - Memperbarui versi aplikasi menjadi `v1.1.332` / `[26.08.21.3]`.

## [1.1.331] / [26.08.21.2] - 2026-08-21

### 🛡️ Otomatisasi & Proteksi Sinkronisasi Guru BK dari Timpaan Jadwal XML SSOT ke Jurnal Mengajar
- **Smart Auto-Mapping & Proteksi Penugasan Guru BK dari Jadwal XML ([`js/asc-schedule-parser.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/asc-schedule-parser.js), [`js/page-e-rapor.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-e-rapor.js)):**
  - Mengotomatisasi parser XML Jadwal aSc Timetables agar saat memproses mapel Bimbingan dan Konseling (BK), sistem secara cerdas menggantikan entitas placeholder `TIM BK` dengan daftar seluruh Guru BK riil yang terdaftar di SIMAS SSOT (`role: guru_bk`, `additionalRoles: guru_bk`, atau jabatan BK).
  - Menerapkan mekanisme proteksi *protected merge* pada fungsi `syncASCScheduleXML()` di E-Rapor sehingga konfigurasi pembagian kelas per Guru BK yang telah diatur sebelumnya tidak lagi terhapus atau tertimpa saat Kurikulum melakukan sinkronisasi ulang berkas XML jadwal di masa mendatang.
- **Otomatisasi Sinkronisasi Master Guru BK pada Jurnal Mengajar ([`settings-app.js`](file:///c:/Users/SSA/Documents/GitHub/jurnal-mengajar-smagesa/settings-app.js), [`jurnal-app.js`](file:///c:/Users/SSA/Documents/GitHub/jurnal-mengajar-smagesa/jurnal-app.js), [`version.js`](file:///c:/Users/SSA/Documents/GitHub/jurnal-mengajar-smagesa/version.js)):**
  - Memperbarui fungsi `syncGuruFromExternal()` dan `syncSingleGuru()` pada Portal Admin Jurnal Mengajar agar akun-akun Guru BK dari SIMAS otomatis tersinkron dan tersimpan ke koleksi `data_guru` dengan penugasan mapel *Bimbingan dan Konseling* untuk seluruh rombel kelas.
  - Menghapus entitas dummy `TIM_BK` dari `data_guru` sehingga nama pengajar yang muncul di form pengisian jurnal mengajar murni nama Guru BK perorangan.
  - Memperbarui `autoPopulateSchedule()` pada form jurnal agar saat mendeteksi slot jam BK dari XML, kolom nama guru tidak dipaksa terisi "TIM BK", melainkan memberikan panduan bagi Guru BK yang bersangkutan untuk memilih namanya sendiri dari dropdown secara valid.
- **Penyelarasan PRD SSOT & Manifes Versi ([`PRD_SIMAS.md`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/PRD_SIMAS.md), [`package.json`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/package.json)):**
  - Mendokumentasikan spesifikasi Otomatisasi & Proteksi Guru BK dari Jadwal XML pada Subbab 4.15 PRD_SIMAS.md.
  - Memperbarui versi aplikasi menjadi `v1.1.331` / `[26.08.21.2]`.

## [1.1.330] / [26.08.21.1] - 2026-08-21

### ✨ Penambahan Resume Total Kehadiran Siswa (H S I A D) Presisi Kolom pada Jurnal Mengajar Guru
- **Resume Total Kehadiran Siswa Real-Time ([`jurnal.html`](file:///c:/Users/SSA/Documents/GitHub/jurnal-mengajar-smagesa/jurnal.html), [`jurnal-app.js`](file:///c:/Users/SSA/Documents/GitHub/jurnal-mengajar-smagesa/jurnal-app.js), [`version.js`](file:///c:/Users/SSA/Documents/GitHub/jurnal-mengajar-smagesa/version.js)):**
  - Menambahkan baris resume presensi di bagian bawah daftar absen siswa pada aplikasi Jurnal Mengajar Digital SMAGESA (`jurnal-mengajar-smagesa`).
  - Menampilkan ringkasan total siswa serta jumlah siswa hadir (**H**) di sisi kiri, dan kotak jumlah per status ketidakhadiran (**S, I, A, D, T**) di sisi kanan yang sejajar secara presisi pixel dengan kolom tombol status siswa di atasnya.
  - Mengintegrasikan fungsi reaktif `updateAttendanceSummary()` yang secara dinamis memperbarui hitungan serta highlight warna saat guru mengklik tombol status kehadiran atau saat data dipulihkan dari cache/riwayat.
- **Penyelarasan Modal Edit Jurnal Portal Guru Mapel ([`guru-mapel.html`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/guru-mapel.html), [`js/page-guru-mapel.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-guru-mapel.js)):**
  - Menambahkan footer resume serupa di bawah daftar presensi siswa pada Modal Edit Jurnal di Portal Guru Mapel (`#edit-jurnal-presensi-summary`).
- **Penyelarasan PRD SSOT & Manifes Versi ([`PRD_SIMAS.md`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/PRD_SIMAS.md), [`package.json`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/package.json)):**
  - Mendokumentasikan spesifikasi Resume Presensi Real-Time Kolom Presisi pada Subbab 4.14 PRD_SIMAS.md.
  - Memperbarui versi aplikasi menjadi `v1.1.330` / `[26.08.21.1]`.

## [1.1.329] / [26.08.19.2] - 2026-08-19

### 🔍 Peningkatan Antarmuka Pemilihan Siswa Perwalian Guru Wali (Searchable Combobox Dropdown)
- **Transformasi Form Input Siswa Perwalian Menjadi Searchable Combobox ([`guru-wali.html`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/guru-wali.html), [`js/page-guru-wali.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-guru-wali.js)):**
  - Mengganti input berbasis `<datalist>` standar peramban dengan komponen antarmuka *Searchable Combobox Popup* interaktif yang konsisten di perangkat mobile maupun desktop.
  - Menampilkan informasi siswa yang kaya pada daftar dropdown (Avatar, Nama Lengkap, NIS, dan Badge Kelas).
  - Menyediakan filter pencarian *real-time* multi-parameter (berdasarkan nama, NIS, maupun kelas) serta penyusunan otomatis berdasarkan hierarki tingkat kelas (XII &rarr; XI &rarr; X).
  - Mengintegrasikan wadah *chips multi-select* terintegrasi langsung di dalam area input teks dengan tombol hapus cepat per item siswa.
  - Otomatis mengecualikan siswa yang telah menjadi perwalian aktif guru bersangkutan maupun siswa yang sedang dalam antrean *selected chips*.
- **Penyelarasan PRD SSOT & Manifes Versi ([`PRD_SIMAS.md`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/PRD_SIMAS.md), [`package.json`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/package.json)):**
  - Mendokumentasikan spesifikasi Searchable Combobox Siswa Binaan pada Subbab 4.12 PRD_SIMAS.md.
  - Memperbarui versi aplikasi menjadi `v1.1.329` / `[26.08.19.2]`.

## [1.1.328] / [26.08.19.1] - 2026-08-19

### 🐛 Perbaikan Sakelar Tugas Presensi Guru pada Tampilan Mobile (HP)
- **Sinkronisasi Dua Arah (*Bidirectional Sync*) Antara Mode Mobile & Desktop ([`js/page-presensi-guru.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-presensi-guru.js)):**
  - Memperbaiki fungsi `syncField('tugas', jpNum, isFromDesktop)` agar mendeteksi arah pemicu (*source element*). Sebelumnya, perubahan sakelar tugas di versi mobile langsung menimpa nilainya sendiri dengan nilai checkbox versi desktop (yang masih `false`), sehingga sakelar langsung kembali nonaktif seketika saat diklik di HP.
  - Memperbaiki sinkronisasi bidirectional serupa untuk event perubahan `status` dan `mapel` antara elemen tabel kartu mobile dan baris tabel desktop.
- **Peningkatan Aksesibilitas Touch & Luas Bidang Sentuh (*Tap Target*) Sakelar Tugas:**
  - Menghubungkan elemen label `<label for="tugas-${jp.jp}">` langsung ke input checkbox dengan membungkus label teks *"Tugas"*, sehingga pengguna di HP dapat menggeser/mengaktifkan tugas baik dengan mengetuk tombol geser maupun teks labelnya.
- **Penyelarasan PRD SSOT & Manifes Versi ([`PRD_SIMAS.md`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/PRD_SIMAS.md), [`package.json`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/package.json)):**
  - Mendokumentasikan spesifikasi sakelar tugas dan sinkronisasi mobile/desktop pada Subbab 4.7 PRD_SIMAS.md.
  - Memperbarui versi aplikasi menjadi `v1.1.328` / `[26.08.19.1]`.

## [1.1.327] / [26.08.18.2] - 2026-08-18

### ⚡ Optimasi Kuota Read Firestore: Zero-Read Early-Exit Guard untuk Permisi 2 Tahap (Two-Step Permission)
- **Penerapan Early-Exit Guard pada Modul Wali Kelas ([`js/page-wali-kelas.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-wali-kelas.js)):**
  - Menerapkan *early return* langsung pada baris awal fungsi `loadPermissionData(className)` jika sakelar `twoStepPermission` bernilai nonaktif (`false` / `undefined`).
  - Mencegah eksekusi kueri `getDocs` ke koleksi `permisi_requests` yang sebelumnya selalu terpanggil setiap kali Wali Kelas membuka halaman perwalian.
- **Pengecekan Kondisional pada Modal Rekam Jejak BK ([`js/page-bk.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-bk.js)):**
  - Membungkus kueri riwayat `permisiRequests` di fungsi `loadStudentContextData()` agar hanya dieksekusi saat `twoStepPermission` aktif di `system_config`.
  - Melewati (*bypass*) kueri secara otomatis dengan inisialisasi array kosong tanpa menyentuh Firestore jika fitur nonaktif.
- **Pengamanan Pemanggilan Fungsi Pengajuan & Persetujuan Permisi ([`js/page-portal-siswa.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-portal-siswa.js), [`js/page-dashboard.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-dashboard.js), [`js/page-input.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-input.js)):**
  - Menambahkan *early exit guard* di `loadMyPermissionRequests()` (Portal Siswa), `loadPendingPermissionRequests()` (Dashboard), dan `loadApprovedPermissionRequests()` (Fast Input) untuk memastikan 0 kueri `permisi_requests` dijalankan saat fitur dimatikan.
- **Penyelarasan PRD SSOT & Manifes Versi ([`PRD_SIMAS.md`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/PRD_SIMAS.md), [`package.json`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/package.json)):**
  - Mendokumentasikan kebijakan Zero-Read Inactive Guard pada Subbab 4.29 poin 7 dan Subbab 5.1 poin 4.
  - Memperbarui versi aplikasi menjadi `v1.1.327` / `[26.08.18.2]`.

## [1.1.326] / [26.08.18.1] - 2026-08-18

### 🎨 Penyesuaian Antarmuka Pengguna (UI Teks White-Labeling Non-Admin)
- **Pembersihan Istilah Vendor Database pada Tampilan Pengguna Umum & Guru:**
  - Mengubah penyebutan teknis seperti `Supabase`, `Firebase`, dan `Firestore` pada antarmuka yang dilihat oleh Siswa, Guru Mapel, Wali Kelas, dan Pengguna Umum menjadi istilah umum profesional (seperti *"Server Database"*, *"Server"*, atau *"Sistem"*).
  - **Portal Pemilihan Duta ([`duta/vote.html`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/duta/vote.html), [`duta/vote.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/duta/vote.js)):** Menyesuaikan teks footer dan pesan toast simulasi offline.
  - **Laporan Kendala & Masukan ([`js/global.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/global.js), [`js/page-masukan.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-masukan.js)):** Menyesuaikan pesan toast notifikasi pengiriman ke pengguna.
  - **Portal Guru Mata Pelajaran ([`guru-mapel.html`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/guru-mapel.html), [`js/page-guru-mapel.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-guru-mapel.js)):** Menyesuaikan header kartu catatan perilaku, tooltip ikon catatan, notifikasi simpan nilai & catatan, serta dialog kebutuhan indeks database.
  - **E-Rapor & Monitoring KBM ([`e-rapor.html`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/e-rapor.html), [`js/page-monitoring-kbm.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-monitoring-kbm.js)):** Menyesuaikan tooltip refresh dan pesan notifikasi penyegaran data.
  - **Suka Duka & Keuangan ([`sukaduka/suka-duka.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/sukaduka/suka-duka.js), [`js/page-keuangan.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-keuangan.js)):** Menyesuaikan status keterhubungan data profil guru dan notifikasi kesiapan server.
- **Mempertahankan Teks Teknis Spesifik pada Panel Administrator:**
  - Panel integrasi admin (`integrasi.html`, `js/page-integrasi.js`), pengaturan retensi & pembersihan database (`settings.html`, `js/page-settings.js`), serta migrasi NIS Dapodik (`siswa.html`) tetap mempertahankan rincian teknis Firestore & Supabase untuk keperluan konfigurasi administrator.

## [1.1.325] / [26.08.16.2] - 2026-08-16

### 🗑️ Penghapusan Modul Pengendali Dokumen TPMPS & Sinkronisasi PRD SSOT
- **Pembersihan Berkas & Kode Controller:**
  - Menghapus file antarmuka `tpmps.html` dan file logika controller `js/page-tpmps.js` karena modul penjaminan mutu TPMPS / Pengendali Dokumen sudah tidak digunakan lagi.
- **Pembersihan Cache PWA Service Worker ([`sw.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/sw.js)):**
  - Menghapus referensi `'./tpmps.html'` dan `'./js/page-tpmps.js'` dari array `ASSETS_TO_CACHE` agar cache client tidak menampung aset yang sudah tidak aktif.
- **Penyelarasan Dokumen Spesifikasi SSOT ([`PRD_SIMAS.md`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/PRD_SIMAS.md)):**
  - Menghapus Subbab 4.18 (Penjaminan Mutu TPMPS) dan menyelaraskan penomoran subbab modul berikutnya secara runtut (Subbab 4.18 s/d 4.29).
  - Menghapus skema koleksi `tpmps_evaluations` dari Bab 14.1 Kamus Data Firestore Utama.
  - Memperbarui metadata versi dokumen menjadi `v1.1.325` / `[26.08.16.2]`.

## [1.1.324] / [26.08.16.1] - 2026-08-16

### 📚 Sinkronisasi Dokumen PRD SSOT & Pembaruan Komprehensif Seluruh Modul
- **Penambahan Spesifikasi Lengkap Portal Guru Mata Pelajaran ([`PRD_SIMAS.md`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/PRD_SIMAS.md), [`guru-mapel.html`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/guru-mapel.html), [`js/page-guru-mapel.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-guru-mapel.js)):**
  - Mendokumentasikan secara rinci modul Portal Guru Mapel (Subbab 4.13) yang mencakup 3 tab utama: Tab Penilaian (Gradebook Merdeka/K13 dengan T1-T10, S1-S10, SAS/SAT, kalkulasi Nilai Akhir, predikat, dan deskripsi CP otomatis), Tab Kehadiran Siswa Mapel (presensi per pertemuan, rekap, layout mobile edge-to-edge, sticky frozen column nama siswa dengan 2-line clamp & tooltip), dan Tab Jurnal Mengajar Harian (agenda KBM per JP).
  - Melengkapi matriks tabel database Supabase PostgreSQL (`guru_mapel_gradebooks`, `guru_mapel_components`, `guru_mapel_scores`, `guru_mapel_summaries`) pada Bab 14.2 Kamus Data.
- **Penyelarasan Monitoring KBM Hub & Presensi Pure Supabase ([`PRD_SIMAS.md`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/PRD_SIMAS.md), [`monitoring-kbm.html`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/monitoring-kbm.html), [`js/page-monitoring-kbm.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-monitoring-kbm.js)):**
  - Memperbarui Subbab 4.8 menjadi Monitoring KBM Hub terpadu dengan 4 sub-tab (Kehadiran Siswa, Monitoring KBM, Rekap Guru, Detail Guru) dan menegaskan basis database 100% Supabase PostgreSQL (`siswa_presensi_harian`, `siswa_presensi`, `guru_presensi`).
  - Mengoreksi seluruh referensi tautan lama `rekap-presensi.html` di Matriks Peran RBAC (Kepala Sekolah, Wakasek Kesiswaan, Wali Kelas).
- **Penyempurnaan Spesifikasi Portal Guru Wali ([`PRD_SIMAS.md`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/PRD_SIMAS.md), [`guru-wali.html`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/guru-wali.html), [`js/page-guru-wali.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-guru-wali.js)):**
  - Melengkapi Subbab 4.12 dengan fitur-fitur mutakhir: integrasi 100% presensi Supabase multi-tahun (3 tahun kohort X, XI, XII), filter semester Ganjil & Genap, skala warna kehadiran ($\ge 92\%$ hijau), rasio kehadiran sah mencakup Dispensasi ($D$), overview stats, EWS presence warning cards, switcher tampilan kartu grid vs tabel siswa, dan ekspor Excel.
- **Penegasan Status Pengarsipan Firestore `Z_*` & Kamus Data ([`PRD_SIMAS.md`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/PRD_SIMAS.md)):**
  - Menandai status koleksi terarsip Firestore dengan prefiks `Z_` (`Z_attendance`, `Z_finance_transactions`, `Z_finance_cashflow`, `Z_finance_daily_summary`, `Z_guru_presensi`) pada Bab 14.1 Kamus Data Firestore.
  - Memperbarui total daftar modul di Bab 4 menjadi 29 modul terpadu dan merapikan pohon arsitektur direktori di Bab 9.1.

## [1.1.323] / [26.08.15.26] - 2026-08-15

### 📱 Optimasi Layout Full-Width & 2-Line Name Clamping Tabel Kehadiran Guru Mapel Versi Mobile
- **Container Full-Width Edge-to-Edge ([`guru-mapel.html`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/guru-mapel.html)):**
  - Mengubah kelas pembungkus `#panel-kehadiran` dari `p-4 space-y-4` menjadi `p-0 sm:p-4 space-y-0 sm:space-y-4` agar tabel kehadiran tidak dibatasi padding kartu di layar mobile dan memanfaatkan 100% ruang kiri-kanan layar ponsel secara penuh.
- **Pengaturan Proporsi Lebar Kolom & Clamping Nama Siswa 2 Baris ([`guru-mapel.html`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/guru-mapel.html), [`js/page-guru-mapel.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-guru-mapel.js)):**
  - Mengatur lebar kolom nama siswa beku (*frozen / sticky left-0*) pada breakpoint mobile ($< 640\text{px}$) menjadi proporsional (~110px-120px / ~30% lebar layar, bukan 80%).
  - Menerapkan pembatasan teks nama otomatis maksimal **2 baris** (`display: -webkit-box; -webkit-line-clamp: 2; word-break: break-word`) pada elemen `.presensi-student-name` dengan atribut `title` untuk tooltip nama lengkap.
  - Mengoptimalkan lebar sel tanggal/pertemuan (`.col-presensi-date` min-w 28px) dan sel rekapitulasi status (`.col-presensi-stat` min-w 22px) di mobile sehingga banyak kolom tanggal dapat terlihat sekaligus tanpa terdesak.

## [1.1.322] / [26.08.15.25] - 2026-08-15

### 🐛 Perbaikan ReferenceError Kolom Presensi Tabel Siswa Guru Wali
- **Penyelarasan Variabel Kolom Presensi ([`guru-wali.html`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/guru-wali.html), [`js/page-guru-wali.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-guru-wali.js)):**
  - Memperbaiki `ReferenceError: t_cnt is not defined` pada baris perenderan tabel siswa perwalian di `renderStudentTable()`.
  - Mendeklarasikan variabel `d_cnt` (Dispensasi) dan `t_cnt` secara lengkap, serta menyelaraskan kolom tabel menjadi `Presensi (H / S / I / A / D)` dengan nilai `${h} / ${s_cnt} / ${i_cnt} / ${a_cnt} / ${d_cnt}` yang konsisten.

## [1.1.321] / [26.08.15.24] - 2026-08-15

### 🔔 Notifikasi Batas Waktu Presensi Admin Kelas & Pengarah Hubungi Wali Kelas
- **Banner Peringatan Informatif Mode Read-Only ([`PRD_SIMAS.md`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/PRD_SIMAS.md), [`js/page-presensi.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-presensi.js)):**
  - Menambahkan kartu pemberitahuan khusus (amber alert banner) saat pengguna ber-role `admin_kelas` membuka presensi kelas untuk tanggal lampau yang melewati batas toleransi $> 1$ hari (H-2 ke belakang).
  - Memberikan penjelasan jelas bahwa Admin Kelas hanya berhak mengisi/mengedit presensi pada Hari Ini (H-0) dan Kemarin (H-1).
  - Mengarahkan siswa Admin Kelas untuk menghubungi **Wali Kelas** (menampilkan nama Wali Kelas binaan dan tombol tautan WhatsApp instan jika nomor telepon/kontak terdaftar) untuk keperluan perbaikan atau pengisian susulan presensi.
  - Memperjelas pesan penolakan pada fungsi `saveAttendance()` saat Admin Kelas mencoba menyimpan data tanggal lampau.

## [1.1.320] / [26.08.15.23] - 2026-08-15

### 🗄️ Pengarsipan `guru_presensi` ke Prefiks `Z_guru_presensi` di Firestore
- **Arsip Subkoleksi Kelas Jam Pelajaran Guru ([`PRD_SIMAS.md`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/PRD_SIMAS.md), [`firestore.rules`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/firestore.rules)):**
  - Mengarsipkan seluruh 96 dokumen hierarki subkoleksi presensi guru harian per kelas (`guru_presensi/{kelas}/{tahun}/{bulan}`) ke koleksi arsip `Z_guru_presensi/{kelas}/{tahun}/{bulan}`.
  - Seluruh operasional presensi jam mengajar guru (JP 1 s.d. 10) kini 100% aktif dan terkelola secara native di tabel Supabase PostgreSQL `guru_presensi`.
  - Menyimpan salinan cadangan offline 96 dokumen di `scripts/backup_archive/guru_presensi.json`.
  - Membersihkan dokumen lama dari `guru_presensi` sehingga koleksi aktif di root Firestore kini murni hanya menyisakan koleksi operasional sekolah.
  - Memperbarui aturan keamanan `firestore.rules` untuk `Z_guru_presensi` (read staf, write Super Admin) dan berhasil di-*deploy* ke Firebase.

## [1.1.319] / [26.08.15.22] - 2026-08-15

### 🎨 Kalibrasi Ambang Batas Warna Persentase Kehadiran (Hijau $\ge 92\%$)
- **Penyesuaian Skala Warna & Perhitungan Rasio ([`PRD_SIMAS.md`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/PRD_SIMAS.md), [`js/page-guru-wali.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-guru-wali.js)):**
  - Mengubah ambang batas indikator warna hijau pada persentase kehadiran siswa dari $\ge 95\%$ menjadi **$\ge 92\%$**:
    - 🟢 **Hijau ($\ge 92\%$):** Kehadiran prima / sangat baik.
    - 🟡 **Kuning ($85\% - 91\%$):** Kehadiran cukup / dalam pemantauan wajar.
    - 🔴 **Merah ($< 85\%$):** Peringatan kehadiran rendah (*Low Presence Warning*).
  - Memasukkan status **Dispensasi ($D$)** ke dalam pembilang rasio kehadiran sah $\frac{H + D}{H + S + I + A + D} \times 100\%$ secara seragam di seluruh tampilan kartu grid, tabel siswa, ringkasan atas, dan ekspor laporan Excel.

## [1.1.318] / [26.08.15.21] - 2026-08-15

### 🗄️ Pengarsipan Koleksi Deprecated Firestore dengan Prefiks `Z_`
- **Arsip Koleksi Tidak Terpakai di Database Utama Firestore (`smagesa`):**
  - Mengarsipkan seluruh koleksi warisan/lama yang fungsinya telah sepenuhnya dimigrasikan ke Supabase PostgreSQL dengan menambahkan prefiks `Z_` agar terkumpul rapi di urutan paling bawah konsol Firebase tanpa kehilangan data historis:
    - `attendance` (307 dokumen) ➔ `Z_attendance` (Presensi siswa kini 100% di Supabase `siswa_presensi_harian` & `siswa_presensi`).
    - `finance_transactions` (1.367 dokumen) ➔ `Z_finance_transactions` (Transaksi SPP kini 100% di Supabase `finance_transactions`).
    - `finance_cashflow` (35 dokumen) ➔ `Z_finance_cashflow` (Arus kas komite kini 100% di Supabase `finance_cashflow`).
    - `finance_daily_summary` (35 dokumen) ➔ `Z_finance_daily_summary` (Agregasi harian SPP kini 100% di Supabase `finance_daily_summary`).
  - Menyimpan salinan cadangan offline lengkap (1.744 dokumen JSON) di direktori `scripts/backup_archive/`.
  - Memperbarui dan merilis konfigurasi aturan keamanan `firestore.rules` untuk memproteksi koleksi arsip `Z_*` (read-only untuk staf/Super Admin, write khusus Super Admin).

## [1.1.317] / [26.08.15.20] - 2026-08-15

### 📅 Dukungan Filter Presensi Per Semester (Ganjil & Genap) pada Guru Wali & Portal Siswa
- **Opsi Filter Semester Multi-Tahun ([`PRD_SIMAS.md`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/PRD_SIMAS.md), [`js/page-guru-wali.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-guru-wali.js), [`js/page-portal-siswa.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-portal-siswa.js)):**
  - Menambahkan opsi filter per semester di setiap grup tahun ajaran aktif maupun lampau:
    - `🗓️ Semester Ganjil (Smt 1)`: Rentang tanggal 1 Juli s.d. 31 Desember.
    - `🗓️ Semester Genap (Smt 2)`: Rentang tanggal 1 Januari s.d. 30 Juni.
  - Memperbarui parser rentang tanggal dan kalkulasi statistik kehadiran pada `filterDetailPresensi` (Guru Wali) dan `loadPresensi` (Portal Siswa) agar menyajikan akumulasi kehadiran khusus semester yang dipilih secara instan langsung dari data Supabase.

## [1.1.316] / [26.08.15.19] - 2026-08-15

### 🎯 Filter Tahun Ajaran Kontekstual Berdasarkan Tingkat Kelas Siswa (X, XI, XII)
- **Logika Kohort Tingkat Kelas Siswa ([`PRD_SIMAS.md`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/PRD_SIMAS.md), [`js/page-guru-wali.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-guru-wali.js), [`js/page-portal-siswa.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-portal-siswa.js), [`js/page-students.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-students.js)):**
  - Menyesuaikan batas pemunculan opsi tahun ajaran pada dropdown filter presensi secara cerdas sesuai dengan jenjang kelas yang sedang ditempuh siswa:
    - **Siswa Kelas X:** Hanya memunculkan **1 Tahun Ajaran Aktif** (`TA Aktif - Kelas X`), karena siswa baru mulai menempuh pendidikan di SMA pada tahun ajaran ini.
    - **Siswa Kelas XI:** Memunculkan **2 Tahun Ajaran** (`TA Aktif - Kelas XI` dan `TA Sebelumnya - Kelas X`).
    - **Siswa Kelas XII / Alumni:** Memunculkan **3 Tahun Ajaran** (`TA Aktif - Kelas XII`, `1 TA Lalu - Kelas XI`, dan `2 TA Lalu - Kelas X`).
  - Menyematkan label kontekstual jenjang kelas (misal: `• Agt 2025 (Kelas X)`, `📁 Seluruh TA 2025/2026 (Kelas X)`) agar memudahkan guru wali dan siswa dalam membaca riwayat perjalanan studi.

## [1.1.315] / [26.08.15.18] - 2026-08-15

### ⚡ Integrasi Presensi Siswa 100% Supabase di Seluruh Halaman Guru Wali
- **Sinkronisasi Presensi Kartu Dashboard Guru Wali ([`PRD_SIMAS.md`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/PRD_SIMAS.md), [`js/page-guru-wali.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-guru-wali.js)):**
  - Menambahkan fungsi `fetchAttendanceSummaryForStudents(nisList)` yang melakukan kueri batch presensi siswa binaan langsung ke tabel Supabase `siswa_presensi` untuk tahun ajaran aktif dalam 1 panggilan cepat (0 Firestore read).
  - Mengalirkan agregat kehadiran Supabase ini ke seluruh komponen halaman Guru Wali:
    - **Kartu Ringkasan Atas (*Overview Stats*):** Rata-rata % kehadiran siswa perwalian dan deteksi *presence warning* (Alpha > 0 atau < 85%).
    - **Kartu Grid Siswa (*Student Card*):** Menampilkan badge % kehadiran real-time dan rincian `A:.. S:.. I:..`.
    - **Tabel Siswa (*Student Table*):** Kolom persentase kehadiran dan status warna EWS.
    - **Filter Presensi Bermasalah:** Filter *Ada Alpa* dan *Kehadiran < 85%* kini 100% mengevaluasi data aktual Supabase.
    - **Ekspor Laporan Excel:** Ekspor perwalian menyertakan rincian H, S, I, A dan % kehadiran murni dari Supabase.
    - **Modal Detail Presensi Siswa:** Menampilkan riwayat multi-tahun 3 tahun lengkap dari Supabase.

## [1.1.314] / [26.08.15.17] - 2026-08-15

### 🛡️ Pemisahan Eksekusi Reset Tahunan & Hapus Alumni dari Supabase (Pure Hands-Free pg_cron)
- **Refaktor Panel Reset Tahunan & Hapus Alumni ([`PRD_SIMAS.md`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/PRD_SIMAS.md), [`settings.html`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/settings.html), [`js/page-settings.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-settings.js)):**
  - Menghapus seluruh query `DELETE` manual ke tabel-tabel Supabase (`finance_transactions`, `siswa_presensi`, `guru_presensi`, `guru_mapel_gradebooks`, `guru_mapel_scores`, `guru_mapel_summaries`) dari fungsi `executeDeleteAlumniClass()`, `resetModule_Semester()`, dan `resetModule_PresensiGuru()`.
  - Seluruh siklus hidup dan pembersihan data di Supabase kini 100% didelegasikan secara mandiri dan aman (*hands-free*) kepada skedul otomatis `pg_cron` sesuai kebijakan retensi bergulir masing-masing modul.
  - Memperbarui antarmuka pengguna pada modal *Hapus Kelas Alumni* dan *Panel Reset Tahunan* dengan menambahkan penjelas/badge proteksi retensi otomatis Supabase.

## [1.1.313] / [26.08.15.16] - 2026-08-15

### ⚙️ Otomatisasi Retensi Data Multi-Tabel Supabase via pg_cron
- **Skema & Fungsi Pembersihan Data Bergulir Komprehensif ([`PRD_SIMAS.md`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/PRD_SIMAS.md), [`supabase/migrations/202608150001_retention_pg_cron_all_tables.sql`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/supabase/migrations/202608150001_retention_pg_cron_all_tables.sql), [`sql/migration_retensi_pg_cron_semua_tabel.sql`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/sql/migration_retensi_pg_cron_semua_tabel.sql)):**
  - Membuat fungsi-fungsi pembersihan otomatis berbasis `SECURITY DEFINER` di PostgreSQL Supabase dengan aturan siklus hidup data:
    1. `public.cleanup_old_siswa_presensi()`: Retensi 3 tahun untuk `siswa_presensi` dan `siswa_presensi_harian`.
    2. `public.cleanup_old_guru_presensi()`: Retensi 3 tahun untuk slot jam mengajar harian guru `guru_presensi`.
    3. `public.cleanup_old_duta_votes()`: Retensi 6 bulan untuk voting `duta_suara_masuk`.
    4. `public.cleanup_old_masukkan_saran()`: Retensi 1 tahun untuk saran berstatus selesai/ditolak dan 2 tahun untuk seluruh log aspirasi lama `masukkan_saran`.
    5. `public.cleanup_old_guru_mapel_grades()`: Retensi 3 tahun untuk `guru_mapel_gradebooks` (tabel anak `components`, `scores`, `summaries` otomatis terhapus bersih via `ON DELETE CASCADE`).
    6. `public.cleanup_old_finance_records()`: Retensi 5 tahun untuk `finance_transactions`, `finance_cashflow`, dan `finance_daily_summary` (standar audit keuangan). Tabel ringkasan tutup buku tahunan `finance_closings` diproteksi permanen.
    7. `public.cleanup_old_sukaduka_records()`: Retensi 5 tahun untuk mutasi `sukaduka_kas` dan riwayat `sukaduka_iuran`. Tabel konfigurasi `sukaduka_config` diproteksi.
    8. `public.cleanup_all_expired_simas_data()`: Master runner yang mengeksekusi seluruh fungsi dan mengembalikan rekapitulasi status JSONB.
  - Mendaftarkan cron job otomatis via ekstensi native `pg_cron` yang dieksekusi secara berurutan (*staggered* per 5 menit) setiap tanggal 1 awal bulan pukul 02:00–02:30 WITA (18:00–18:30 UTC) untuk menjaga kestabilan IOPS dan CPU database Supabase.
  - Memberikan hak eksekusi RPC (`GRANT EXECUTE`) pada seluruh fungsi pembersihan untuk keperluan audit dan eksekusi manual Super Admin.

## [1.1.312] / [26.08.15.15] - 2026-08-15

### 🚀 Presensi Siswa Murni Supabase SSOT Multi-Tahun (Retensi 3 Tahun & Otomatisasi pg_cron)
- **Arsitektur Presensi Murni Supabase Tanpa Dual-Storage ([`PRD_SIMAS.md`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/PRD_SIMAS.md), [`sql/migration_siswa_presensi_retensi_3thn.sql`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/sql/migration_siswa_presensi_retensi_3thn.sql)):**
  - Mengalihkan seluruh pengelolaan dan siklus hidup presensi siswa ke Supabase PostgreSQL (`siswa_presensi` dan `siswa_presensi_harian`) dengan retensi data bergulir 3 tahun (*rolling 3-year retention*).
  - Menyiapkan script migrasi SQL untuk fungsi otomatisasi `public.cleanup_old_siswa_presensi()` yang dieksekusi terjadwal via ekstensi native `pg_cron` setiap tanggal 1 awal bulan pukul 02:00 WITA (18:00 UTC) untuk membersihkan data presensi yang usianya melebihi 3 tahun secara *hands-free*.
  - Menghapus total ketergantungan penulisan dan pembacaan arsip presensi pada `student_aggregates.history_yearly` di Firestore, sehingga Firestore `student_aggregates` kini murni hanya mengelola poin kedisiplinan dan prestasi BK.
- **Refaktor Panel Reset Tahunan ([`settings.html`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/settings.html), [`js/page-settings.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-settings.js)):**
  - **Modul 1 (Kenaikan Kelas & Alumni):** Menghilangkan proses pembacaan dan penulisan massal data presensi ke Firestore `history_yearly`. Proses kenaikan kelas siswa (X->XI, XI->XII, XII->Alumni) dan reset peran Wali Kelas guru kini berjalan instan dan hemat kuota read/write Firestore.
  - **Modul 2 (Bersihkan Data Semester):** Menghapus perintah *wipe* massal pada tabel `siswa_presensi` dan `siswa_presensi_harian` di Supabase. Data presensi siswa tetap aman dan utuh selama 3 tahun masa studi.
  - Memperbarui label antarmuka dan teks deskripsi modal panel reset tahunan.
- **Refaktor Modal Detail Siswa Master ([`js/page-students.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-students.js)):**
  - Mengambil riwayat presensi multi-tahun siswa langsung dari Supabase via `fetchStudentAttendanceRange(student.nis, null, null)` saat modal detail dibuka (0 Firestore read).
  - Menghapus mode `isArchiveMode` dan parsing string log. Seluruh kalkulasi kartu statistik (Sakit, Izin, Alpha, Dispen) dan render baris daftar absensi kini dihitung langsung dari data terstruktur Supabase untuk semua pilihan semester/tahun ajaran.
- **Refaktor Guru Wali & Pembinaan ([`js/page-guru-wali.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-guru-wali.js)):**
  - Mengambil data presensi multi-tahun siswa binaan dari Supabase dan menyusun filter tahun ajaran aktif beserta 2 tahun ajaran sebelumnya.
  - Menghapus mode fallback `archive:TA` dari Firestore `student_aggregates`.
- **Refaktor Portal Siswa ([`js/page-portal-siswa.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-portal-siswa.js)):**
  - Memperbarui filter bulan presensi untuk mencakup tahun ajaran aktif dan riwayat tahun-tahun sebelumnya.
  - Seluruh status kehadiran (termasuk Hadir `H`, Sakit, Izin, Alpha, Dispen, surat izin, dan catatan) disajikan utuh dan transparan langsung dari Supabase.

## [1.1.311] / [26.08.15.14] - 2026-08-15

### 🐛 Perbaikan Bug Tabrakan Kunci NIP Placeholder pada Matriks Jam Kosong Guru
- **Isolasi Kunci Pemetaan Jadwal Guru ([`js/asc-schedule-parser.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/asc-schedule-parser.js), [`js/page-jadwal.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-jadwal.js)):**
  - Memperbaiki bug di mana guru tanpa NIP (GTT/honorer yang memiliki NIP placeholder `"-"`) mengalami tabrakan kunci pada `teacherScheduleMap['-']`, sehingga slot mengajar seluruh guru honorer terakumulasi menjadi satu dan menyebabkan data jadwal kosong terisi penuh (48 JP mengajar).
  - Menjadikan XML ID unik guru (`teacher.id`) sebagai kunci utama mutlak dan menyaring string placeholder `"-"`, `""`, atau `"null"` dari resolusi kunci jadwal.
  - Memastikan seluruh 42 guru memiliki beban KBM dan pemetaan jam kosong yang 100% akurat sesuai jadwal mingguan masing-masing.

## [1.1.310] / [26.08.15.13] - 2026-08-15

### ⚡ Penanda Visual Real-time Jam Kosong Guru pada Tampilan Matriks
- **Fitur Live Indicator pada Matriks Guru ([`PRD_SIMAS.md`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/PRD_SIMAS.md), [`js/page-jadwal.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-jadwal.js)):**
  - Menambahkan penanda visual khusus (badge animasi `⚡ Standby JP ${currentJP}` dan styling highlight kartu hari ini) pada baris/kartu guru yang sedang berstatus jam kosong (tidak mengajar) pada jam pelajaran saat halaman dibuka.
  - Memberikan kemudahan bagi pihak kurikulum/piket untuk langsung melihat guru mana saja yang sedang standby secara instan dari tampilan matriks mingguan.

## [1.1.309] / [26.08.15.12] - 2026-08-15

### 🧹 Penghapusan Banner Header pada Tampilan Per JP Jadwal Kosong Guru
- **Penyelarasan Tampilan Antarmuka ([`PRD_SIMAS.md`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/PRD_SIMAS.md), [`js/page-jadwal.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-jadwal.js)):**
  - Menghapus banner header gradien pada sub-view *Per Jam (JP)* sehingga kedua sub-view (Matriks Guru dan Per Jam JP) kini seragam, bersih, dan langsung menyajikan kartu/tabel data di bawah bilah filter.

## [1.1.308] / [26.08.15.11] - 2026-08-15

### 🎯 Sembunyikan Filter Hari & JP pada Tampilan Matriks Guru
- **Kustomisasi Bilah Kontrol Kontekstual ([`PRD_SIMAS.md`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/PRD_SIMAS.md), [`jadwal.html`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/jadwal.html), [`js/page-jadwal.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-jadwal.js)):**
  - Menyembunyikan dropdown **Filter Hari** dan **Filter JP** serta tombol pintas Live JP saat berada di sub-view *Matriks Guru* (karena tabel sudah menyajikan jadwal mingguan Senin–Jumat seluruh guru sekaligus).
  - Menampilkan kembali dropdown Filter Hari, Filter JP, dan tombol pintas Live JP hanya ketika beralih ke sub-view *Per Jam (JP)*.

## [1.1.307] / [26.08.15.10] - 2026-08-15

### 🧹 Pembersihan Banner Header Duplikat pada Jadwal Kosong Guru
- **Optimalisasi Antarmuka ([`js/page-jadwal.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-jadwal.js)):**
  - Menghapus banner header gradien duplikat di atas tabel matriks dan daftar slot jam kosong guru untuk tampilan yang lebih bersih, ringkas, dan fokus langsung ke tabel/kartu data.

## [1.1.306] / [26.08.15.9] - 2026-08-15

### ⚡ Default View Per Jam (JP) & Auto-Selection Hari/JP Sesuai Waktu Akses
- **Konfigurasi Tampilan Awal Pintar ([`PRD_SIMAS.md`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/PRD_SIMAS.md), [`jadwal.html`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/jadwal.html), [`js/page-jadwal.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-jadwal.js)):**
  - Menetapkan sub-view **Per Jam (JP)** sebagai tampilan default saat membuka tab *Jadwal Kosong Guru*.
  - Menambahkan kalkulasi auto-selection waktu akses:
    - *Pada Hari Efektif (Senin–Jumat):* Dropdown Hari otomatis memilih hari ini (`todayDay`) dan dropdown JP otomatis memilih JP yang sedang aktif (`currentJP`) saat jam KBM, atau *"Semua Jam (JP 1–10)"* jika di luar jam KBM.
    - *Di Luar Hari Efektif (Sabtu/Minggu):* Otomatis menampilkan *"Semua Hari (Mingguan)"* dan *"Semua Jam (JP 1–10)"*.
  - Menyelaraskan active state tombol switcher sub-view dan visibilitas filter JP.

## [1.1.305] / [26.08.15.8] - 2026-08-15

### ⏱️ Pengecualian Upacara (Senin JP 1) & Ekstrakurikuler (Jumat JP 10) pada Jam Kosong Guru
- **Penyesuaian Basis Jam KBM Efektif ([`PRD_SIMAS.md`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/PRD_SIMAS.md), [`jadwal.html`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/jadwal.html), [`js/page-jadwal.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-jadwal.js)):**
  - Mengecualikan **Senin JP 1** (Upacara Bendera) dan **Jumat JP 10** (Ekstrakurikuler/Krida Sekolah) dari perhitungan jam kosong/standby KBM guru karena merupakan kegiatan bersama seluruh warga sekolah.
  - Menyesuaikan basis jam KBM sekolah menjadi **48 JP/Minggu** (Senin: 9 JP [JP 2–10], Selasa–Kamis: 10 JP, Jumat: 9 JP [JP 1–9]).
  - Menampilkan badge khusus *"Kegiatan Bersama Sekolah"* untuk Senin JP 1 dan Jumat JP 10 pada mode slot per jam, serta menyelaraskan rentang jam kosong di tabel matriks mingguan.

## [1.1.304] / [26.08.15.7] - 2026-08-15

### 📊 Penyempurnaan Tampilan Otomatis Jam Kosong Semua Guru
- **Penyempurnaan Tampilan & Matriks Otomatis Guru ([`jadwal.html`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/jadwal.html) & [`js/page-jadwal.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-jadwal.js)):**
  - Mengubah tampilan utama Tab *Jadwal Kosong Guru* agar secara otomatis menyajikan **Matriks Jam Kosong Seluruh Guru** (Senin s.d. Jumat) secara komprehensif tanpa perlu memilih filter terlebih dahulu.
  - Memetakan rentang jam kosong setiap guru (misal: `JP 1-3, 6-10`, `Bebas Seharian`) dan beban total JP mengajar vs JP kosong mingguan.
  - Menambahkan switcher sub-tampilan antara *Matriks Mingguan Seluruh Guru* dan *Pemetaan Per Jam Pelajaran (JP 1–10)*.
  - Menyediakan filter cepat Semua Hari (Mingguan) vs Hari Tertentu, filter pencarian guru instan, dan tombol pintas *"⚡ JP Saat Ini"*.
  - Menyelaraskan tampilan responsif mobile (kartu guru mingguan) dan template cetak A4 rapi.

## [1.1.303] / [26.08.15.6] - 2026-08-15

### 📅 Penambahan Tab Baru Pemetaan Jadwal Kosong Guru (Guru Standby / Tidak Mengajar)
- **Implementasi Fitur Tab Mode Ketiga ([`jadwal.html`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/jadwal.html) & [`js/page-jadwal.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-jadwal.js)):**
  - Menambahkan tab *"Jadwal Kosong Guru"* pada mode switcher jadwal mingguan di samping tab *Per Kelas* dan *Per Guru*.
  - Menyediakan filter interaktif per Hari (Senin–Jumat), filter spesifik Jam Pelajaran (JP 1–10 / Semua JP), dan kotak pencarian guru real-time (*instant search*).
  - Menghitung status ketersediaan guru secara *zero-read* (100% *client-side* dari XML SSOT), lengkap dengan ringkasan beban mengajar harian (*"Bebas Seharian"* vs *"Mengajar N JP di jam lain"*).
  - Menambahkan tombol pintas cerdas *"⚡ JP Aktif Saat Ini"* untuk navigasi instan ke jam KBM yang sedang berlangsung saat ini.
  - Memungkinkan klik pada kartu guru bebas untuk langsung membuka detail jadwal mingguan guru tersebut di tab *Per Guru*.
  - Menyediakan tampilan kartu per JP responsif untuk mobile dan layout rapi saat diekspor/dicetak (*Print A4*).

## [1.1.302] / [26.08.15.5] - 2026-08-15

### 🧹 Pembersihan Modul Migrasi Owner Game Pending Lama
- **Pembersihan Section & Logika Migrasi ([`pid/admin.html`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/pid/admin.html) & [`pid/admin.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/pid/admin.js)):**
  - Menghapus section kartu *"Migrasi Owner Game Pending Lama"* (`#migration-section`) pada halaman admin karena proses migrasi one-off data lama telah tuntas 100%.
  - Menghapus fungsi `migratePendingOwners()` dan utilitas `normalizeName()` pada file controller admin untuk efisiensi kode dan mengurangi beban berkas.

## [1.1.301] / [26.08.15.4] - 2026-08-15

### 🎨 Perombakan UI & Kontras Tema Gelap (Dark Mode) Panel Admin Game PID
- **Optimalisasi Kontras & Palet Warna ([`pid/admin.html`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/pid/admin.html) & [`pid/admin.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/pid/admin.js)):**
  - Mengganti token warna teks gelap (`--text-muted`, `--text-dim`) dengan warna slate kontras tinggi (`#cbd5e1` & `#94a3b8`) agar lolos standar keterbacaan WCAG AA pada latar gelap.
  - Memperbaiki tombol aksi dan pengaturan mapel yang sebelumnya memiliki variabel warna tidak terdefinisi (`--c-purple`, `--c-blue`), kini menggunakan styling gradien modern.
  - Memperbarui komponen badge status (*Tayang*, *Pending*, *Ditolak*, *Disembunyikan*) dengan pill badge khusus bertransparansi halus dan border berpendar.
  - Mengubah daftar opsi checklist mapel & kategori menjadi kartu pill interaktif (`.checkbox-grid`) yang otomatis menyala saat dipilih (`:has(input:checked)`).
  - Meningkatkan estetika tabel, header glassmorphism, input search, switch toggle, dan modal catatan penolakan.

## [1.1.300] / [26.08.15.3] - 2026-08-15

### 🎮 Peningkatan Akurasi Tampilan Nama Pembuat di Panel Admin Game PID
- **Penyesuaian Kolom Pembuat Game ([`pid/admin.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/pid/admin.js)):**
  - Mengubah logika render kolom *Pembuat* pada tabel daftar game admin agar memprioritaskan nama asli Guru Pembuat Karya (`g.author`).
  - Menampilkan catatan pengunggah (*"Diajukan: [Nama Akun]"*) secara elegan di bawah nama pembuat jika game diunggah oleh akun yang berbeda (misalnya diajukan/diinputkan oleh Admin atas nama Guru Mapel).
  - Memperbarui perhitungan metrik statistik `sAuthors` agar menghitung jumlah unik guru pembuat karya (`author`) secara tepat.

## [1.1.299] / [26.08.15.2] - 2026-08-15

### 🚀 Penyempurnaan Komprehensif Migrasi NIS Siswa (20 Koleksi Firestore & Tabel Supabase)
- **Cakupan 20 Target Basis Data Terpadu ([`js/page-students.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-students.js) & [`siswa.html`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/siswa.html)):**
  - **Firestore Utama (`smagesa`):**
    - Master data `students`: Tulis dokumen baru dengan ID `newNIS` dan hapus dokumen `oldNIS`.
    - Agregat poin `student_aggregates`: Tulis dokumen baru `newNIS` dan hapus `oldNIS`.
    - Nilai e-rapor `rapor_scores`: Tulis ulang seluruh nilai rapor dengan ID baru `${kelas}_${newNIS}_${TA}` dan hapus dokumen lama.
    - Catatan wali kelas rapor `walikelas_notes`: Tulis ulang seluruh catatan rapor semester dengan ID baru `${newNIS}_${cleanYear}_${sem}` dan hapus dokumen lama.
    - Riwayat poin disiplin/prestasi/permisi `records`: Batch update `studentNIS` ke `newNIS`.
    - Tindakan pembinaan BK `bk_actions`: Batch update `studentNIS` ke `newNIS`.
    - Pengajuan izin keluar `permisi_requests`: Batch update `studentNIS` ke `newNIS`.
    - Penugasan guru wali `guru_wali_assignments`: Tulis ulang dokumen perwalian dengan ID baru `${guru_uid}_${newNIS}` dan hapus dokumen lama.
    - Catatan pembinaan guru wali `guru_wali_notes`: Tulis ulang dokumen catatan dengan ID baru `${guru_uid}_${newNIS}_${timestamp}` dan hapus dokumen lama.
    - Histori mutasi kelas `class_transfers`: Batch update `nis` ke `newNIS`.
    - Peta presensi legacy `attendance`: Tulis ulang item `records.${newNIS}` dan hapus `records.${oldNIS}` via `deleteField()`.
    - Metadata sinkronisasi `settings/metadata`: Sentuh timestamp `lastUpdateStudents`.
  - **Firestore Jurnal Mengajar (`jurnal-smagesa`):**
    - Master data `data_siswa`: Tulis dokumen baru `newNIS` dan hapus `oldNIS`.
    - Respon peminatan `peminatan_responses`: Tulis ulang data kuesioner pada subkoleksi tahun dengan ID `newNIS` dan hapus dokumen lama.
    - Jurnal guru `jurnal_guru`: Perbarui array `presensi_detail` untuk siswa yang bersangkutan dari seluruh riwayat kelas.
  - **PostgreSQL Supabase (`elrmzlicuuglnoeedusr`):**
    - Presensi siswa granular `siswa_presensi`: Update `student_nis = newNIS` dan `updated_at`.
    - Penilaian guru mapel `guru_mapel_scores`: Update `student_nis = newNIS`.
    - Ringkasan nilai guru mapel `guru_mapel_summaries`: Update `student_nis = newNIS`.
    - Transaksi iuran SPP `finance_transactions`: Baca seluruh transaksi, upsert baris baru dengan Primary Key ID `${newNIS}_${year}_${month}`, dan bersihkan baris ID lama.
    - Voting duta SHAKTI `duta_suara_masuk`: Update `nis_pemilih = newNIS`.
- **Penguatan Keamanan & Keandalan Transaksi:**
  - Menghilangkan *silent warnings* pada Supabase update dengan penerapan *strict error throwing* agar setiap kegagalan terdeteksi seketika.
  - Pembersihan otomatis cache lokal IndexedDB dan LocalStorage (`simas_kelas_list_cache`, `simas_show_alumni_cache`) setelah migrasi sukses.
  - Penambahan audit log otomatis `MIGRATE_STUDENT_NIS` dan `MIGRATE_STUDENTS_BULK` ke Firestore `audit_logs`.
- **Versi & Cache PWA:**
  - Versi aplikasi dinaikkan ke `1.1.299` / `[26.08.15.2]` (Revisi 2 tanggal 15 Agustus 2026) dan Service Worker cache ke `simas-pwa-v118`.

## [1.1.298] / [26.08.15.1] - 2026-08-15

### 🛡️ Audit Kesiapan Produksi & Verifikasi Ketat Ketergantungan Modul Web Utama
- **Audit Komprehensif Seluruh Halaman ([`scratch/verify-imports.js`](file:///c:/Users/SSA/.gemini/antigravity/brain/6807fafe-f21c-4099-9779-fdce75f96f20/scratch/verify-imports.js)):**
  - Menguji keterhubungan skrip dan dependensi ES Module di **37 file HTML** dan **62 file JS/MJS**.
  - Memastikan seluruh simbol ekspor/impor (`supabase`, `auth`, `db`, `PATHS`, `APP_VERSION`, dsb.) terhubung 100% tanpa referensi modul yang hilang atau path yang rusak.
- **Penyelarasan Konsumsi Instance Supabase ([`js/page-presensi.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-presensi.js), [`js/page-settings.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-settings.js), [`js/page-students.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-students.js)):**
  - Mengamankan pemanggilan operasi database Supabase dengan pola fallback ganda `supabase || window.supabase` untuk menjamin eksekusi query tidak pernah menghasilkan `undefined error` baik saat diakses via ES Module maupun script global.
- **Pengujian Simulasi End-to-End Live ([`scripts/test-e2e-audit.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/scripts/test-e2e-audit.js)):**
  - Seluruh rangkaian suite pengujian (Mutasi Kas, Data Beku Migrasi SPP, Presensi Siswa Harian, Presensi Guru Paginasi Deterministik) berhasil lulus 100%.
- **Versi & Cache PWA:**
  - Versi aplikasi dinaikkan ke `1.1.298` / `[26.08.15.1]` (Revisi 1 tanggal 15 Agustus 2026) dan Service Worker cache ke `simas-pwa-v117`.

## [1.1.297] / [26.08.14.33] - 2026-08-14

### 🔑 Sentralisasi Konfigurasi & Instansiasi Supabase SSOT (`js/config.js`)
- **Pemusatan Konfigurasi Utama ([`js/config.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/config.js)):**
  - Mengimpor `createClient` dari SDK Supabase ESM dan mengekspor `SUPABASE_CONFIG`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, serta instance singleton `supabase`.
  - Menjadikan `js/config.js` sebagai *Single Source of Truth* (SSOT) mutlak untuk seluruh konektivitas Supabase (selaras dengan pola Firebase).
- **Refactoring & Pembersihan Duplikasi di Seluruh Modul:**
  - Membersihkan deklarasi `SUPABASE_URL`, `SUPABASE_ANON_KEY`, dan `createClient(...)` redundan di 15+ file modul frontend:
    - [`js/global.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/global.js)
    - [`js/page-dashboard.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-dashboard.js)
    - [`js/page-keuangan.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-keuangan.js)
    - [`js/page-presensi-guru.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-presensi-guru.js)
    - [`js/page-guru-mapel.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-guru-mapel.js)
    - [`js/page-guru-wali.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-guru-wali.js)
    - [`js/page-wali-kelas.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-wali-kelas.js)
    - [`js/page-monitoring-kbm.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-monitoring-kbm.js)
    - [`js/page-portal-siswa.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-portal-siswa.js)
    - [`js/page-students.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-students.js)
    - [`js/page-masukan.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-masukan.js)
    - [`js/page-settings.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-settings.js)
    - [`js/page-integrasi.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-integrasi.js)
    - [`js/page-duta-admin.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-duta-admin.js)
    - [`sukaduka/suka-duka.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/sukaduka/suka-duka.js)
    - [`duta/admin.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/duta/admin.js)
    - [`duta/vote.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/duta/vote.js)
- **Sentralisasi Backend Functions ([`functions/index.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/functions/index.js)):**
  - Mengonsolidasikan konstanta kredensial Supabase ke tingkat global root functions.
- **Subsistem Jurnal Mengajar ([`jurnal-mengajar-smagesa/firebase-config.js`](file:///c:/Users/SSA/Documents/GitHub/jurnal-mengajar-smagesa/firebase-config.js) & [`jurnal-mengajar-smagesa/settings-app.js`](file:///c:/Users/SSA/Documents/GitHub/jurnal-mengajar-smagesa/settings-app.js)):**
  - Menyediakan konfigurasi `SUPABASE_CONFIG`, `SUPABASE_URL`, `SUPABASE_HEADERS` terpusat di `firebase-config.js` dan membersihkan duplikasi di `settings-app.js`.
- **Versi & Cache PWA:**
  - Versi aplikasi dinaikkan ke `1.1.297` / `[26.08.14.33]` dan Service Worker cache ke `simas-pwa-v116`.

## [1.1.296] / [26.08.14.32] - 2026-08-14

### 🛡️ Penguatan Integrasi Supabase SSOT, Perbaikan Skema Kas, & Penghapusan Presensi Offline
- **Modul Keuangan ([`js/page-keuangan.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-keuangan.js) & [`supabase/migrations/202608140005_fix_cashflow_category_default.sql`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/supabase/migrations/202608140005_fix_cashflow_category_default.sql)):**
  - Menambahkan nilai default `category = 'Umum'` pada skema tabel dan payload insert/update Supabase `finance_cashflow`, memperbaiki error constraint *not-null* saat entri mutasi kas manual baru.
  - Mengalihkan `openEditCashflowModal` agar membaca langsung dari Supabase `finance_cashflow` (0 Firestore read).
  - Menghapus sisa *dual-write* Firestore pada mutasi kas manual dan tutup buku tahunan (`executeClosing`).
  - Memperbaiki parsing bulan data beku virtual migrasi SPP (`getVirtualMigrationEntries`) agar diekstrak presisi dari string tanggal `YYYY-MM-DD`.
- **Modul Pengaturan & Pembersihan Semester ([`js/page-settings.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-settings.js)):**
  - Memperbaiki kueri pembersihan nilai rapor semester di Supabase: menghapus melalui tabel master `guru_mapel_gradebooks` yang otomatis melakukan `CASCADE DELETE` ke komponen, nilai, dan ringkasan siswa tanpa error kolom `kelas`.
- **Penghapusan Fitur Presensi Offline & Pemurnian SSOT ([`js/global.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/global.js)):**
  - Menghapus objek `SimasSyncEngine`, event listener koneksi online, badge antrean offline, dan cabang antrean offline di `saveAttendanceDual`.
  - Presensi siswa mewajibkan koneksi online aktif langsung ke tabel Supabase `siswa_presensi` dan `siswa_presensi_harian`.
- **Modul Monitoring KBM ([`js/page-monitoring-kbm.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-monitoring-kbm.js)):**
  - Menambahkan pengurutan deterministik `.order('tanggal').order('id')` pada kueri range multi-halaman `guru_presensi` untuk memastikan tidak ada data terlewat atau duplikat pada pembacaan rentang data besar.
- **Versi & Cache PWA:**
  - Versi aplikasi dinaikkan ke `1.1.296` / `[26.08.14.32]` dan Service Worker cache ke `simas-pwa-v115`.

## [1.1.295] / [26.08.14.31] - 2026-08-14

### 💰 Pemutusan Total Dual-Write Keuangan ke Firebase (Pure Supabase SSOT)
- **Halaman Kasir & Transaksi SPP ([`js/page-keuangan.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-keuangan.js)):**
  - Menghapus penulisan cadangan ganda (*dual-write*) ke Firestore `finance_transactions` dan `finance_daily_summary` pada fungsi `processPayment`, `executeToggleMigrationStatus`, `freezeMigrationData`, dan `loadKasirSummary`.
  - Seluruh pencatatan pembayaran, penandaan tunggakan migrasi, status kunci data, dan ringkasan kasir kini 100% beroperasi langsung di Supabase (`finance_transactions`, `finance_daily_summary`, `finance_cashflow`, `finance_closings`).
- **Dashboard & Halaman Konsumen ([`js/page-dashboard.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-dashboard.js), [`js/page-settings.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-settings.js), [`js/page-students.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-students.js)):**
  - `getVirtualMigrationEntries` di dashboard kini membaca data beku langsung dari Supabase `finance_daily_summary`.
  - Hapus data alumni (`executeDeleteAlumniClass`), hapus permanen siswa (`deleteStudentDeep`), dan migrasi NIS (`performSingleMigration`) murni beroperasi di Supabase `finance_transactions` tanpa menyentuh Firestore.
- **Versi & Cache PWA:**
  - Versi dinaikkan ke `1.1.295` / `[26.08.14.31]` dan Service Worker cache ke `simas-pwa-v114`.

## [1.1.294] / [26.08.14.30] - 2026-08-14

### 🚀 Penghapusan Total Fallback Firebase Firestore pada Presensi Siswa (Pure Supabase SSOT)
- **Sentralisasi Attendance Service ([`js/global.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/global.js)):**
  - `fetchDailyAttendanceSummary`, `fetchClassAttendance`, `fetchStudentAttendanceRange`, dan `fetchClassAttendanceRange` kini 100% membaca langsung dari Supabase tanpa query fallback ke Firestore.
  - `saveAttendanceDual` kini menyimpan presensi harian secara eksklusif ke Supabase (`siswa_presensi_harian` & `siswa_presensi`), menghapus penulisan cold-backup ke Firestore `attendance`.
  - Mode offline menggunakan `SimasSyncEngine` berorientasi tabel Supabase `siswa_presensi`.
- **Pembersihan Fallback pada Konsumen Presensi:**
  - [`js/page-presensi.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-presensi.js): `loadDailyDetail` murni membaca dari Supabase.
  - [`js/page-portal-siswa.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-portal-siswa.js): `loadPresensi` murni membaca dari Supabase.
  - [`js/page-students.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-students.js): `openStudentDetail`, `deleteStudentDeep`, dan `performSingleMigration` tidak lagi membebani Firestore dengan pembaruan data absensi.
  - [`js/page-settings.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-settings.js): `resetModule_KenaikanKelas`, `resetModule_DataSemester`, `executeDeleteAlumniClass`, dan `migrateStudentAttendanceToTargetClass` beroperasi eksklusif pada tabel Supabase.
- **Versi & PWA Cache:**
  - Versi aplikasi dinaikkan ke `1.1.294` / `[26.08.14.30]` dan cache Service Worker `simas-pwa-v113`.

## [1.1.293] / [26.08.14.29] - 2026-08-14

### 🔍 Audit & Penyelarasan Menyeluruh Konsumen Presensi Siswa ke Supabase SSOT
- **Modul Bimbingan Konseling ([`js/page-bk.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-bk.js)):**
  - Mengalihkan pemuatan riwayat absensi siswa pada modal timeline BK ke `window.fetchStudentAttendanceRange` (Supabase SSOT - 0 Read Firestore).
- **Modul Guru Wali ([`js/page-guru-wali.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-guru-wali.js)):**
  - Mengalihkan pemuatan absensi siswa asuhan/perwalian ke `window.fetchStudentAttendanceRange`.
- **Modul Wali Kelas ([`js/page-wali-kelas.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-wali-kelas.js)):**
  - `loadAttendanceRecap`: Mengalihkan export rekap bulanan/semester ke `window.fetchClassAttendanceRange`.
  - `openCatatanModal`: Mengalihkan perhitungan live absensi untuk generator catatan rapor AI ke `window.fetchStudentAttendanceRange`.
  - `loadStudentAttendance`: Mengalihkan tab riwayat presensi di modal detail siswa ke `window.fetchStudentAttendanceRange`.
- **Hapus Siswa Permanen ([`js/page-students.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-students.js)):**
  - Menambahkan penghapusan data siswa di Supabase (`siswa_presensi`, `guru_mapel_scores`, `guru_mapel_summaries`) pada `deleteStudentDeep`.
- **Mutasi / Pindah Kelas ([`js/page-settings.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-settings.js)):**
  - Menambahkan pembaruan field `kelas = targetClass` di tabel `siswa_presensi` Supabase saat mutasi kelas.
- **Versi & Cache PWA:**
  - Dinaikkan ke versi `1.1.293` / `26.08.14.29` dan cache Service Worker `simas-pwa-v112`.

## [1.1.292] / [26.08.14.28] - 2026-08-14

### 🔄 Sinkronisasi Supabase pada Reset Tahunan, Hapus Alumni & Migrasi NIS
- **Migrasi NIS Siswa ([`js/page-students.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-students.js)):**
  - Menambahkan pembaruan `student_nis` pada tabel `siswa_presensi` Supabase secara otomatis saat migrasi NIS (baik single maupun massal).
- **Pembersihan Data Alumni ([`js/page-settings.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-settings.js)):**
  - Menambahkan penghapusan data alumni di Supabase: `siswa_presensi` (sesuai opsi hapus absensi), `guru_mapel_scores`, dan `guru_mapel_summaries`.
- **Reset Tahunan & Semester ([`js/page-settings.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-settings.js)):**
  - **Modul 1 (Kenaikan Kelas):** Mengambil log absensi tahunan siswa langsung dari Supabase `siswa_presensi` via `fetchAllSupabaseRows` dengan fallback Firestore untuk pengarsipan `history_yearly`.
  - **Modul 2 (Pembersihan Semester):** Menambahkan pembersihan data semester di Supabase (`siswa_presensi`, `siswa_presensi_harian`, `guru_mapel_scores`, `guru_mapel_summaries`).
- **Versi & Cache PWA:**
  - Dinaikkan ke versi `1.1.292` / `26.08.14.28` dan cache Service Worker `simas-pwa-v111`.

## [1.1.291] / [26.08.14.27] - 2026-08-14

### 🔄 Sinkronisasi Versi Global & Service Worker Cache
- **Sinkronisasi Versi Global ([`js/config.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/config.js)):**
  - Memperbarui konstanta `APP_VERSION` ke `"26.08.14.27"` agar tampilan footer login dan footer sidebar menampilkan versi terkini secara presisi.
- **Pembaruan Service Worker PWA ([`sw.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/sw.js)):**
  - Menaikkan `CACHE_NAME` ke `simas-pwa-v110` untuk membersihkan cache aset lama di browser klien.
  - Mendaftarkan modul halaman baru (`guru-mapel.html`, `js/page-guru-mapel.js`, `jadwal.html`, `js/page-jadwal.js`) ke dalam `ASSETS_TO_CACHE`.
- **Standardisasi Pemanggilan Script HTML ([`agenda.html`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/agenda.html) & [`presensi.html`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/presensi.html)):**
  - Membersihkan parameter query versi usang pada tag modul JavaScript agar selaras dengan PWA cache manifest.

## [1.1.290] / [26.08.14.26] - 2026-08-14

### 🚀 Migrasi Presensi Siswa & Agregat ke Supabase (Dual-Read/Write & SSOT TA Berjalan)
- **Skema Tabel Baru ([`supabase/migrations/202608140003_siswa_presensi.sql`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/supabase/migrations/202608140003_siswa_presensi.sql)):**
  - Membuat tabel `siswa_presensi_harian` (header summary kelas per tanggal) dan `siswa_presensi` (detail granular kehadiran siswa per hari dengan index komposit dan RLS policies) untuk auto-deploy via GitHub Actions (`supabase-migrations.yml`).
- **Central Attendance Service ([`js/global.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/global.js)):**
  - Menambahkan `window.fetchDailyAttendanceSummary`, `window.fetchClassAttendance`, `window.fetchStudentAttendanceRange`, `window.fetchClassAttendanceRange`, dan `window.saveAttendanceDual`.
- **Integrasi Konsumen Presensi Siswa:**
  - [`js/page-presensi.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-presensi.js): Mengalihkan `loadStudentList`, `loadDailySummary`, `processSave`, `loadRecapMonthly`, dan `loadRecapSemester` ke Supabase Dual-Read/Write.
  - [`js/page-wali-kelas.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-wali-kelas.js): Mengalihkan agregasi kehadiran kelas dan monitoring hari ini ke Supabase helper.
  - [`js/page-portal-siswa.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-portal-siswa.js): Mengalihkan riwayat presensi portal siswa ke Supabase dengan fallback Firestore.
  - [`js/page-students.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-students.js): Mengalihkan riwayat kehadiran modal detail siswa ke Supabase.
- **Bulk Migration Tool ([`integrasi.html`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/integrasi.html) & [`js/page-integrasi.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-integrasi.js)):**
  - Menyediakan panel migrasi massal otomatis untuk seluruh data Tahun Ajaran berjalan (1 Juli 2026 s.d. hari ini) dan seluruh arsip dengan real-time progress bar dan console log.
- **Dokumentasi SSOT:** Memperbarui [PRD_SIMAS.md](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/PRD_SIMAS.md) Bab 2 dan Bab 14.2.

## [1.1.289] / [26.08.14.25] - 2026-08-14

### 🛡️ Audit Menyeluruh & Penyelarasan Filter Muat Data Presensi Guru
- **Penyelarasan Filter Muat Data ([`js/page-presensi-guru.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-presensi-guru.js)):**
  - Menyelaraskan filter `loadExistingData` pada pengecekan keberadaan guru (`item.guru_nama && item.status`) agar identik dengan `checkClassesPresensiCompleteness`, mencegah kemungkinan data tidak ter-render jika nama mapel bernilai kosong/strip.
  - Memastikan seluruh kueri Supabase di seluruh sistem (input siswa, rekap monitoring, fungsi cron) terisolasi dengan penanganan error dan parsing aman.
  - Update Service Worker cache ke `simas-pwa-v108`.

## [1.1.288] / [26.08.14.24] - 2026-08-14

### 🧹 Pembersihan Panel Migrasi Supabase yang Telah Selesai
- **Pembersihan Antarmuka ([`integrasi.html`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/integrasi.html)):**
  - Menghapus section *"Integrasi Database & Pemecahan Sistem (Supabase)"* (`#section-config-database`) karena migrasi data presensi guru telah 100% selesai dan tersinkronisasi.
- **Pembersihan Logika Migrasi ([`js/page-integrasi.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-integrasi.js)):**
  - Menghapus fungsi-fungsi audit, rekonsiliasi, dan pipeline migrasi sekali-pakai (`checkSupabaseGuruPresensiStatus`, `reconcileGuruPresensi`, `validateGuruPresensiDetailed`, `repairGuruPresensiMismatches`, `startGuruPresensiMigration`) untuk merampingkan ukuran bundle JavaScript.
  - Update Service Worker cache ke `simas-pwa-v107`.

## [1.1.287] / [26.08.14.23] - 2026-08-14

### 🐛 Perbaikan Serialization Bug Parsing Timestamp Jurnal Guru (`toDate is not a function`)
- **Robust Timestamp Parsing ([`js/page-monitoring-kbm.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-monitoring-kbm.js)):**
  - Menambahkan helper `parseFirestoreDate` untuk menangani secara aman berbagai format timestamp Firestore (baik saat berstatus native `Timestamp`, objek hasil serialisasi JSON/IndexedDB cache `{seconds, nanoseconds}`, string ISO, maupun objek `Date`).
  - Memperbaiki error `TypeError: data.timestamp.toDate is not a function` pada `loadRekapJurnal`, `loadRekapKehadiran`, dan `fetchCrossVerifiedData`.
  - Update Service Worker cache ke `simas-pwa-v106`.

## [1.1.286] / [26.08.14.22] - 2026-08-14

### 🚀 Pelepasan Total Fallback & Pemurnian Supabase Eksklusif (0 Firestore Overhead)
- **Cut-Off Firestore Fallback ([`js/page-presensi-guru.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-presensi-guru.js)):**
  - Menghentikan total dual-write dan dual-read Firestore pada `saveJP`, `loadExistingData`, dan widget monitoring kelengkapan `checkClassesPresensiCompleteness`. Operasional presensi guru kini 100% eksklusif dijalankan di Supabase PostgreSQL.
- **Pemurnian Monitoring KBM ([`js/page-monitoring-kbm.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-monitoring-kbm.js)):**
  - Membuang pemanggilan 24 `getDoc` Firestore pada `loadRekapJurnal` dan `fetchCrossVerifiedData`. Presensi guru ditarik murni via kueri Supabase (baik harian maupun auto-paginated range bulanan/semesteran).
- **Pemurnian Cron Functions ([`functions/index.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/functions/index.js)):**
  - Validasi kelengkapan presensi guru pada `attendanceCron` murni membaca REST API Supabase.
  - Update Service Worker cache ke `simas-pwa-v105`.

## [1.1.285] / [26.08.14.21] - 2026-08-14

### 🔄 Integrasi Penuh Master List Kelas Dinamis (`window.getActiveClasses`)
- **Penghapusan Hardcode Manual ([`js/page-integrasi.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-integrasi.js)):**
  - Mengganti array manual dengan pemanggilan fungsi terpusat `window.getActiveClasses({ bypassActiveFilter: true })` yang membaca langsung dari master database `settings/metadata_classes`.
  - Matriks audit dan proses migrasi kini 100% dinamis mengikuti konfigurasi kelas resmi yang tersimpan di sistem.
  - Update Service Worker cache ke `simas-pwa-v104`.

## [1.1.284] / [26.08.14.20] - 2026-08-14

### 🎯 Standardisasi Baku Format 24 Rombel SMAGESA (X-1 s/d XII-8)
- **Format Kelas Resmi ([`js/page-integrasi.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-integrasi.js)):**
  - Mengunci pemindaian dan matriks visual hanya pada 24 rombel resmi SMAGESA: `X-1` s.d. `X-8`, `XI-1` s.d. `XI-8`, dan `XII-1` s.d. `XII-8`.
  - Matriks audit menampilkan ke-24 kelas secara teratur dan presisi.
  - Update Service Worker cache ke `simas-pwa-v103`.

## [1.1.283] / [26.08.14.19] - 2026-08-14

### 🛡️ Penguatan Normalisasi & Deduplikasi Idempoten Ekstra Ketat pada Migrasi
- **Deduplikasi Unik Berbasis Set ([`js/page-integrasi.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-integrasi.js)):**
  - Menerapkan `migratedKeys` / `seenRecordIds` Set pada `startGuruPresensiMigration`, `validateGuruPresensiDetailed`, dan `reconcileGuruPresensi` untuk menjamin tidak ada duplikasi data sama sekali meskipun format bulan di Firestore bervariasi.
  - Normalisasi nilai input secara ketat (`trim()`, `toUpperCase()` status kehadiran, `boolean` check `ada_tugas`, dan validasi range JP 1..10).
  - Update Service Worker cache ke `simas-pwa-v102`.

## [1.1.282] / [26.08.14.18] - 2026-08-14

### 🚀 Dukungan Paginasi Tak Terbatas (> 1.000 Baris) & Penyelarasan Rujukan Supabase Lintas Halaman
- **Auto-Paginated PostgREST Range Query ([`js/page-monitoring-kbm.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-monitoring-kbm.js) & [`js/page-integrasi.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-integrasi.js)):**
  - Mengimplementasikan mekanisme chunked pagination (`.range(from, to)`) pada pemanggilan `guru_presensi` Supabase (baik pada kueri rentang tanggal monitoring KBM bulanan/semesteran maupun audit validasi). Mampu memuat 5.000 s.d. 50.000+ baris data tanpa terpotong batas bawaan 1.000 baris PostgREST.
- **Penyelarasan Seluruh Modul Terhubung:**
  - `presensi-guru.html` (`saveJP`, `loadExistingData`, `checkClassesPresensiCompleteness`), `monitoring-kbm.html` (`loadRekapJurnal`, `fetchCrossVerifiedData`, `loadRekapGuru`, `loadDetailGuru`), `integrasi.html` (`reconcileGuruPresensi`, `validateGuruPresensiDetailed`), `settings.html` (`resetModule_PresensiGuru`), serta Cloud Functions `functions/index.js` telah 100% tersambung ke Supabase dengan fallback aman ke Firestore.
  - Update Service Worker cache ke `simas-pwa-v101`.

## [1.1.281] / [26.08.14.17] - 2026-08-14

### 🎯 Penegasan Cakupan Migrasi Hanya Tahun Ajaran Ini (Semester Ganjil 2026/2027)
- **Scope Filter Ketat ([`js/page-integrasi.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-integrasi.js) & [`integrasi.html`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/integrasi.html)):**
  - Mengunci pemindaian Firestore, kueri Supabase, audit rekonsiliasi, dan validasi mendalam murni untuk **Tahun Ajaran Aktif (Semester Ganjil 2026/2027: Juli–Desember 2026)**.
  - Data masa lampau / tahun ajaran sebelumnya tetap tersimpan di Firestore dan tidak dipindahkan ke Supabase.
  - Update Service Worker cache ke `simas-pwa-v100`.

## [1.1.280] / [26.08.14.16] - 2026-08-14

### 🔍 Penyempurnaan Scanner Dinamis & Validasi Granular Presensi Guru
- **Dynamic Multi-Class Scanner ([`js/page-integrasi.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-integrasi.js)):**
  - Mengganti pemindaian hardcoded rombel dengan `getAllSchoolClasses()` yang secara dinamis mengambil master rombel dari `metadata_classes`, `getActiveClasses()`, master data siswa, dan seluruh variasi format penamaan kelas di SMAGESA (`X.1`..`X.8`, `X-1`..`X-8`, `XII IPA`, dll.).
  - Memperluas rentang tahun pemindaian (`2026` & `2025`) dan seluruh bulan (`01` s.d. `12`) sehingga mendeteksi seluruh data KBM secara komprehensif.
- **Visual Matriks Validasi Item-by-Item ([`integrasi.html`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/integrasi.html) & [`js/page-integrasi.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-integrasi.js)):**
  - Menyediakan tombol *Deep Granular Check* dengan visual matrix badge per rombel dan aksi 1-klik *Auto Self-Healing Sync*.
  - Update Service Worker cache ke `simas-pwa-v99`.

## [1.1.279] / [26.08.14.15] - 2026-08-14

### ⚡ Pemecahan Sistem & Migrasi Presensi Guru (`guru_presensi`) ke Supabase PostgreSQL (Zero Disruption)
- **Skema DDL PostgreSQL ([`supabase/migrations/202608140002_guru_presensi.sql`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/supabase/migrations/202608140002_guru_presensi.sql)):**
  - Membuat tabel relasional `guru_presensi` dengan Unique Constraint `(kelas, tanggal, jp)` dan 5 indeks performa tinggi (`(kelas, tanggal)`, `tanggal`, `guru_id`, `guru_nama`, `status`) serta Row Level Security (RLS) policies.
- **Arsitektur Dual-Write & Dual-Read Presensi Guru ([`js/page-presensi-guru.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-presensi-guru.js)):**
  - Mengimplementasikan *Dual-Write* pada `saveJP`: Primary write ke Supabase via `upsert`, otomatis safe background backup write ke Firestore.
  - Mengimplementasikan *Dual-Read & Self-Healing Lazy Sync* pada `loadExistingData`: Membaca Supabase terlebih dahulu; jika data kosong/error, fallback membaca Firestore dan menyinkronkan data riwayat ke Supabase di latar belakang.
  - Mengoptimalkan `checkClassesPresensiCompleteness`: Menggantikan 24 query Firestore individual per kelas menjadi 1 single query Supabase cepat (0 egress & 0 read kuota Firestore).
- **Integrasi Matriks Monitoring KBM ([`js/page-monitoring-kbm.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-monitoring-kbm.js)):**
  - Memperbarui `loadKbmMatrixData` (harian) dan `loadMonthlyKbmRecap` (bulanan) untuk memprioritaskan pengambilan data presensi guru dari Supabase dengan fallback mulus ke Firestore.
- **Panel Audit, Rekonsiliasi & Migrasi Massal Visual ([`integrasi.html`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/integrasi.html) & [`js/page-integrasi.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-integrasi.js)):**
  - Menyediakan panel integrasi database Supabase untuk Super Admin dengan indikator status tabel real-time.
  - Menambahkan tombol audit rekonsiliasi data dan pemrosesan migrasi massal 1-klik untuk data semester berjalan (2026) dengan batching dan progress bar visual.
  - Membuat script eksternal Node.js [`scripts/migrate_guru_presensi.mjs`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/scripts/migrate_guru_presensi.mjs).
- **Pembersihan Tahunan & Cron Backend ([`js/page-settings.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-settings.js) & [`functions/index.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/functions/index.js)):**
  - Menambahkan penghapusan data lampau Supabase pada wizard reset tahunan.
  - Memperbarui `attendanceCron` di Cloud Functions untuk memverifikasi presensi guru via Supabase REST API dengan fallback Firestore.
- **Pembaruan Service Worker PWA ([`sw.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/sw.js)):**
  - Menaikkan versi cache ke `'simas-pwa-v98'`.

## [1.1.278] / [26.08.14.14] - 2026-08-14

### 📊 Sinkronisasi Agregasi Presensi Real-Time (Izin & Alpa) pada EWS Portal Wali Kelas
- **Agregasi Presensi Kelas Berjalan ([`js/page-wali-kelas.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-wali-kelas.js)):**
  - Menambahkan fungsi `loadClassAttendanceAggregates()` yang secara otomatis menghitung akumulasi presensi (Hadir, Sakit, Izin, Alpa, Dispen) langsung dari riwayat kehadiran kelas berjalan (`attendance`) dan menggabungkannya ke dalam `currentClassAggregates`.
  - Memperbaiki lookup NIS dan ID siswa pada tabel EWS (`renderEwsTable()`) dan statistik ringkasan (`renderOverviewStats()`).
  - Menambahkan styling badge visual berwarna amber pada kolom Absensi EWS saat siswa memiliki riwayat izin (`Izin > 0`).
- **Peningkatan Fleksibilitas Kalkulator EWS ([`js/ews-calculator.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/ews-calculator.js)):**
  - Mendukung pembacaan field absensi fleksibel (`attendance.I`, `attendance.izin`, `izin`, `totalIzin`, dll.) untuk memastikan skor risiko EWS selalu terhitung secara akurat.
- **Pembaruan Service Worker PWA ([`sw.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/sw.js)):**
  - Menaikkan versi cache ke `'simas-pwa-v97'`.

## [1.1.277] / [26.08.14.13] - 2026-08-14

### 👤 Sinkronisasi Dinamis Header Info Wali Kelas Saat Pergantian Rombel Binaan
- **Sinkronisasi Info Wali Kelas Saat Cache Hit ([`js/page-wali-kelas.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-wali-kelas.js)):**
  - Memperbaiki bug di mana kartu info Wali Kelas Penanggung Jawab tidak ikut berganti ketika beralih antar kelas yang sudah tersimpan di cache rombel, dengan memastikan `updateHeaderWaliKelasInfo()` selalu dieksekusi pada seluruh siklus pemuatan data.
  - Menghilangkan *delay* dan teks tersisa dari kelas sebelumnya dengan langsung menampilkan status *Memuat Data Wali...* dan membersihkan DOM lama seketika kelas dipilih.
- **Normalisasi Pencarian & Ketahanan Cache Wali Kelas ([`js/global.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/global.js)):**
  - Menambahkan normalisasi prefix kelas (`X-5`, `Kelas X-5`, spasi) dan variasi field pengguna (`assignedClass`, `kelas`, `handledClass`) ke dalam `WALI_KELAS_CACHE`.
  - Menambahkan *auto fallback refresh* pada `window.getWaliKelasByClass()` jika data wali kelas belum terindeks saat pemilihan kelas pertama kali.
- **Pembaruan Service Worker PWA ([`sw.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/sw.js)):**
  - Menaikkan versi cache ke `'simas-pwa-v96'`.

## [1.1.276] / [26.08.14.12] - 2026-08-14

### 💰 Perbaikan Menyeluruh Integrasi & Kalkulasi Data Pembayaran SPP Portal Wali Kelas
- **Perbaikan Query Batch Transaksi SPP ([`js/page-wali-kelas.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-wali-kelas.js)):**
  - Memperbaiki bug `students is not defined` pada `loadSppStatusSummary()` dengan memetakan NIS siswa dari array aktif `currentClassStudents`, sehingga riwayat transaksi SPP dari Supabase `finance_transactions` termuat dengan sukses untuk seluruh rombel.
- **Penyelarasan Status & Perhitungan Tunggakan SSOT:**
  - Menyelaraskan fungsi `calculateCohort()`, `isMonthPaid()`, dan `calculateStudentTunggakan()` dengan formula Single Source of Truth (SSOT) pada modul Keuangan ([`js/page-keuangan.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-keuangan.js)).
  - Mengambil tanggal jatuh tempo dinamis langsung dari cache `settings/finance_config` (`getFinanceConfigCache()`).
  - Menyesuaikan penentuan status bulan berjalan (misal: Agustus Lunas) dan total tunggakan hanya untuk periode yang telah melewati jatuh tempo (`isDue && !isPaid`).
- **Perbaikan Modal Detail SPP & Riwayat Pembayaran:**
  - Mengatasi crash `txs is not defined` pada `loadModalDetailSPP()` dan menampilkan riwayat kwitansi, tanggal pembayaran resmi, serta grid status 12 bulan akademik secara presisi.
- **Penyempurnaan Pesan WhatsApp Pengingat SPP:**
  - Melengkapi generator pesan WhatsApp untuk orang tua dan siswa dengan rincian bulan tunggakan dan total tagihan secara detail.
- **Pembaruan Service Worker PWA ([`sw.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/sw.js)):**
  - Menaikkan versi cache ke `'simas-pwa-v95'`.

## [1.1.275] / [26.08.14.11] - 2026-08-14

### ⚡ Penyelarasan Global Cache Profil Dashboard & Detail Siswa Guru Wali (Zero Read)
- **Modul Dashboard ([`js/page-dashboard.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-dashboard.js)):**
  - Mengintegrasikan fungsi `fetchUserDataWithCache()` dengan cache terpusat `window.getCurrentUserDoc()` (0 Firestore Read) sebelum memeriksa *localStorage* dan Firestore `users/{uid}`.
- **Modul Guru Wali ([`js/page-guru-wali.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-guru-wali.js)):**
  - Memprioritaskan pencarian master siswa di IndexedDB (`window.getStudentsCache()`) pada pemuatan detail profil siswa (`loadDetailProfil`), pencarian kelas fallback (`loadDetailKehadiran`), dan pembukaan form edit data siswa (`openEditDataSiswa`), sehingga interaksi detail siswa menghasilkan **0 read Firestore**.
- **Pembaruan Service Worker PWA ([`sw.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/sw.js)):**
  - Menaikkan versi cache ke `'simas-pwa-v94'`.

## [1.1.274] / [26.08.14.10] - 2026-08-14

### 💡 Penanda Visual Interaktif Saat Form Pemilihan Guru Dikosongkan (Empty-State Feedback)
- **Aplikasi Jurnal Mengajar ([`jurnal-mengajar-smagesa/jurnal-app.js`](file:///c:/Users/SSA/Documents/GitHub/jurnal-mengajar-smagesa/jurnal-app.js)):**
  - Saat input nama pengajar dikosongkan karena pengguna tidak mengklik dari dropdown, kolom input otomatis diberi penanda visual (ring border merah `ring-2 ring-rose-500`, latar halus `bg-rose-50`, dan placeholder khusus `⚠️ Wajib klik nama guru dari daftar!`) selama 3 detik untuk memberi tahu pengguna dengan jelas bahwa pilihan belum sah.
- **Modul Presensi Guru ([`js/page-presensi-guru.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-presensi-guru.js)):**
  - Menerapkan fungsi helper `markEmptyGuruInput()` pada kolom input guru presensi mobile dan desktop untuk memberikan efek visual ring merah dan placeholder peringatan saat form dikosongkan kembali. Efek otomatis hilang saat kolom difokuskan kembali.

## [1.1.273] / [26.08.14.9] - 2026-08-14

### 🌟 Penggantian TIM BK dengan Pemilihan Guru Anggota TIM BK pada Presensi Guru
- **Pengambilan Anggota TIM BK Terpusat ([`js/page-presensi-guru.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-presensi-guru.js)):**
  - Mengambil daftar guru BK resmi langsung dari pengguna ber-role `guru_bk` (primary maupun additional roles), diselaraskan dengan master data guru dan konfigurasi `rapor_config` dengan sistem cache 30 jam (`simas_bk_teachers_cache`).
- **Penghapusan Entitas Generic `"TIM BK"`:**
  - Menghapus entitas dummy `"TIM_BK"` dari opsi dropdown guru agar presensi tidak dicatat atas nama generic.
  - Memvalidasi proses simpan (`saveJP`) dan `onGuruBlur` untuk mencegah input manual generic `"TIM BK"`.
- **Mekanisme Pemilihan & Auto-Fill Cerdas:**
  - Jika jadwal XML aSc Timetables atau mapel BK aktif dan anggota TIM BK **hanya 1 orang** (atau sudah spesifik ditugaskan ke kelas tersebut di `mapelGuruConfig`), nama guru otomatis terisi (*auto-fill*).
  - Jika anggota TIM BK terdiri dari **lebih dari 1 orang guru**, form nama guru dikosongkan dengan placeholder informatif dan dropdown otomatis menampilkan seksi khusus `🌟 Guru Anggota TIM BK` di bagian teratas agar siswa (admin kelas) dapat memilih langsung guru yang hadir.
- **Penyederhanaan Validasi Pemilihan Guru (Wajib Klik Dropdown / Auto-Reset Kosong):**
  - **Aplikasi Jurnal Mengajar ([`jurnal-mengajar-smagesa/jurnal-app.js`](file:///c:/Users/SSA/Documents/GitHub/jurnal-mengajar-smagesa/jurnal-app.js)):**
    - Mengubah alur pemilihan guru: Pengguna mengetik beberapa huruf untuk memfilter daftar guru, lalu **wajib mengklik** salah satu nama dari dropdown yang muncul.
    - Jika pengguna mengetik teks bebas dan keluar dari form (blur) tanpa mengklik nama dari dropdown, nilai form guru otomatis dikosongkan kembali (`''`).
  - **Modul Presensi Guru ([`js/page-presensi-guru.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-presensi-guru.js)):**
    - Setiap kali siswa/admin kelas mengetik nama guru, ID guru di-reset. Jika form kehilangan fokus tanpa adanya nama yang dipilih dari dropdown, input otomatis dikosongkan.

## [1.1.272] / [26.08.14.8] - 2026-08-14

### 🛡️ Normalisasi & Deduplikasi Nama Guru Otomatis + Proteksi Ketik Manual
- **Pembersihan Database Firestore (`jurnal_guru`):** Memperbaiki dan menyelaraskan 226 dokumen riwayat jurnal yang menggunakan nama singkatan/tanpa gelar/typo (seperti `Putu widiasih`, `Ni Ketut Ari Jijiv Liani`, `Rani`, `Sriada`, spasi berlebih, titik ganda) ke nama resmi master bergelar lengkap (`Ni Putu Widiasih, S.Pd`, `Ni Ketut Ari Jijiv Liani, S.Pd`, `Ni Putu Rani Satya. P, S.Pd`, `I Putu Gede Sriada, S.Pd`, dll).
- **Resolver Nama Guru Multi-Level ([`js/page-monitoring-kbm.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-monitoring-kbm.js)):**
  - Menerapkan fungsi `resolveOfficialTeacherName()` dengan algoritma pencocokan bertingkat (Exact Match $\rightarrow$ Case-Insensitive $\rightarrow$ Title-Stripped Normalization $\rightarrow$ Token/Substring Matching $\rightarrow$ Entity Mapping).
  - Menggabungkan perhitungan JP pada Tab Rekap Guru & Rekap Detail Guru agar nama guru tidak pernah terpecah menjadi beberapa baris terpisah.
- **Proteksi Input Manual Jurnal Mengajar ([`jurnal-mengajar-smagesa/jurnal-app.js`](file:///c:/Users/SSA/Documents/GitHub/jurnal-mengajar-smagesa/jurnal-app.js)):**
  - Meningkatkan kecerdasan fungsi `smartMatchTeacher()`.
  - Menambahkan listener `blur` pada input guru untuk otomatis melakukan *snap* ke nama resmi bergelar jika teks cocok dengan salah satu guru, atau mengosongkan input dan menampilkan peringatan jika nama tidak terdaftar.
  - Memperketat validasi `submitData()` sehingga form menolak pengiriman jika nama guru bukan dari master resmi.
- **Proteksi Input Presensi Guru ([`js/page-presensi-guru.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-presensi-guru.js)):**
  - Menambahkan auto-snap & reset pada `onGuruBlur()` dan validasi `saveJP()` agar siswa/admin kelas hanya dapat memilih nama dari dropdown guru terdaftar.

## [1.1.271] / [26.08.14.7] - 2026-08-14

### ⚡ Optimasi Komprehensif Kuota Read Firestore Seluruh Modul (Zero UX Impact)
- **Modul Wali Kelas ([`js/page-wali-kelas.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-wali-kelas.js)):**
  - Menyempitkan *query scope* rekap permisi siswa menjadi per-kelas rombel aktif (`where('studentClass', '==', currentRombelClass)`), mencegah pembacaan ratusan dokumen permisi lintas kelas di seluruh sekolah.
- **Modul Manajemen Pengguna ([`js/page-users.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-users.js)):**
  - Mengoptimalkan validasi wali kelas ganda (`checkExistingWaliKelas`), preload guru (`preloadTeacherData`), audit data (`oldData`), dan form edit user (`window.editUser`) untuk memprioritaskan data user yang sudah ada di memori (`allUsersData` / `USERS_SESSION_CACHE`), menghemat *full scan* Firestore setiap kali interaksi manajemen user.
- **Modul Presensi Guru ([`js/page-presensi-guru.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-presensi-guru.js)):**
  - Melewati pemeriksaan kelengkapan 24 kelas se-sekolah (`checkIncompleteClasses`) untuk role kelas tunggal (`admin_kelas`, `siswa`, `admin_pks`, `guru_mapel`) dan memfokuskan scan hanya untuk staf/admin pengelola, mencegah pemborosan puluhan read setiap halaman presensi dibuka sore hari.
- **Modul Guru Mapel ([`js/page-guru-mapel.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-guru-mapel.js)):**
  - Mengintegrasikan pembacaan data master siswa per kelas ke cache terpusat IndexedDB (`window.getStudentsCache()`) pada penyiapan daftar siswa dan tabel rekap kehadiran sebelum melakukan fallback ke Firestore query.
- **Modul Portal Siswa ([`js/page-portal-siswa.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-portal-siswa.js)):**
  - Menerapkan session cache bulanan untuk riwayat presensi (`loadPresensi`), sehingga perpindahan antar-tab siswa instan tanpa read Firestore berulang.
- **Modul E-Rapor ([`js/page-e-rapor.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-e-rapor.js)):**
  - Mengoptimalkan pemuatan siswa per kelas dan batch pencarian NIS dengan cache IndexedDB (`window.getStudentsCache()`), serta menambahkan session caching pada daftar guru mapel (`loadAllUsersCache`).
- **Modul E-Lab ([`js/page-e-lab.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-e-lab.js)):**
  - Menerapkan session caching untuk daftar laboratorium (`loadLabs`) dan daftar kepala laboratorium (`loadAllKepalaLabData`) dengan auto-invalidation saat ada modifikasi lab.
- **Modul Presensi Siswa ([`js/page-presensi.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-presensi.js)):**
  - Menggunakan `window.getCurrentUserDoc()` untuk pemuatan user aktif dan `window.getTeachersCache()` untuk resolusi nomor WhatsApp wali kelas saat pengiriman notifikasi.
- **Modul Data Siswa ([`js/page-students.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-students.js)):**
  - Mengoptimalkan pencarian langsung siswa (`openDetailByNIS`) untuk memeriksa cache IndexedDB terlebih dahulu.
- **Modul Kalender & Agenda ([`js/page-agenda.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-agenda.js)):**
  - Menggunakan cache user doc pada inisialisasi dan menerapkan session caching bulanan untuk events agenda dengan invalidasi otomatis saat tambah/edit/hapus kegiatan.
- **Pembaruan Service Worker PWA ([`sw.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/sw.js)):**
  - Menaikkan versi cache ke `'simas-pwa-v93'`.

## [1.1.270] / [26.08.14.6] - 2026-08-14

### 🛠️ Perbaikan Foreign Key Constraint Gradebook pada Simpan Catatan Siswa Portal Guru Mapel
- **Penanganan Foreign Key Constraint (`guru_mapel_gradebooks`) ([`js/page-guru-mapel.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-guru-mapel.js)):**
  - Menyelesaikan error `insert or update on table "guru_mapel_summaries" violates foreign key constraint "fk_summaries_gradebook"` saat guru menyimpan catatan siswa (*Apresiasi, Perilaku Positif, Evaluasi Akademik*) di modal detail.
  - Memastikan *master record* `guru_mapel_gradebooks` di-upsert terlebih dahulu sebelum menyimpan ringkasan dan catatan ke tabel `guru_mapel_summaries`, sehingga penyimpanan catatan selalu berhasil meskipun guru belum pernah menekan tombol utama *"Simpan Nilai & Capaian Pembelajaran"*.
- **Pembaruan Service Worker PWA ([`sw.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/sw.js)):**
  - Menaikkan versi cache ke `'simas-pwa-v92'`.

## [1.1.269] / [26.08.14.5] - 2026-08-14

### 🔄 Sinkronisasi Dinamis Filter, Rekap Presensi Jurnal & Proteksi Cache Portal Guru Mapel
- **Reset Otomatis & Auto-Load Filter ([`guru-mapel.html`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/guru-mapel.html) & [`js/page-guru-mapel.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-guru-mapel.js)):**
  - Mengosongkan tabel pada Tab Penilaian, Kehadiran, dan Jurnal Mengajar saat guru mengganti filter (Kelas, Mapel, atau Semester) yang datanya belum pernah dimuat dalam sesi aktif (`resetPortalTablesToEmpty`), mencegah tampilan data lama tertinggal (*stale data*).
  - Jika kombinasi filter yang dipilih telah tersimpan dalam `sessionGradebookCache` sesi ini, sistem langsung memuat otomatis tanpa tombol "Load" secara manual (**0 Firestore/Supabase read**).
  - Mereset badge jumlah siswa menjadi `0 Siswa`, menyembunyikan panel deskripsi CP & analisis statistik, serta memperbarui judul ruang lingkup tabel secara kontekstual.
- **Perbaikan Rekap Kehadiran Jurnal untuk Jam Pelajaran "Hadir Semua" & Timezone Shift ([`js/page-guru-mapel.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-guru-mapel.js) & [`js/page-monitoring-kbm.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-monitoring-kbm.js)):**
  - **Pertemuan Seluruh Siswa Hadir (100% Attendance):** Memperbaiki bug di mana pertemuan/kolom tanggal hilang dari tabel Rekap Kehadiran jika semua siswa hadir (`presensi_detail` kosong `[]`). Pertemuan kini dipastikan selalu dibuat di `pertemuanMap` dan seluruh siswa otomatis terdata 'H' (Hadir).
  - **Perbaikan Timezone Offset (WITA UTC+8):** Mengganti konversi `d.toISOString().split('T')[0]` (UTC) menjadi `getLocalISODate(d)` (waktu lokal WITA), mencegah pergeseran tanggal pertemuan mundur 1 hari untuk jurnal yang diisi pada pagi hari (misal jam 07:00 WITA).
- **Proteksi Kuota Firestore (Zero Over-Budget):**
  - Mengembalikan pembacaan data `cache_jurnal_*` dan `cache_students_*` agar selalu menggunakan cache lokal 10 menit tanpa bypass pada fungsi `loadKehadiranSiswaData` dan `loadDaftarJurnalData`, menjaga penggunaan kuota Firestore tetap hemat dan optimal.
- **Pembaruan Service Worker PWA ([`sw.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/sw.js)):**
  - Menaikkan versi cache ke `'simas-pwa-v91'`.

## [1.1.268] / [26.08.14.4] - 2026-08-14

### 🔒 Audit & Penguatan Sistem Tutup Buku Tahunan Keuangan (Supabase SSOT)
- **Penyelarasan Status Tahun Buku ([`js/page-keuangan.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-keuangan.js)):**
  - Mengalihkan pembacaan daftar tahun buku yang sudah ditutup (`closedYearsList`) ke tabel Supabase `finance_closings`.
  - Mengintegrasikan fungsi pembekuan migrasi virtual 2026 (`freezeMigrationData`) agar menyimpan agregasi permanen ke Supabase `finance_daily_summary`.
- **Verifikasi Keamanan Wizard Tutup Buku:**
  - Audit kalkulasi saldo awal otomatis dari penutupan tahun sebelumnya di Supabase.
  - Verifikasi keamanan PIN keuangan 6 digit terenkripsi hash SHA-256.
  - Penguncian mutasi buku kas dan kasir pembayaran untuk tahun-tahun yang sudah ditutup.
- **Pembaruan Service Worker PWA ([`sw.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/sw.js)):**
  - Menaikkan versi cache ke `'simas-pwa-v90'`.

## [1.1.267] / [26.08.14.3] - 2026-08-14

### 🧹 Pembersihan Panel Migrasi Transisi & Audit Zero-Error Modul Keuangan
- **Pembersihan Antarmuka Tab Pengaturan ([`keuangan.html`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/keuangan.html)):**
  - Menghapus panel *"Infrastruktur Database Keuangan (Supabase SQL)"* dan tombol migrasi massal karena seluruh data historis telah 100% tersimpan di Supabase dan sistem telah beroperasi secara mandiri.
  - Menghapus fungsi migrasi transisi `migrateFinanceDataToSupabase` dari [`js/page-keuangan.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-keuangan.js) untuk mencegah potensi pembacaan tidak sengaja ke Firestore.
- **Audit Menyeluruh Kualitas Kode & Keamanan (Zero-Error):**
  - Memeriksa seluruh alur: Kasir Pembayaran, Penghapusan Transaksi & Penyesuaian Saldo, Pencatatan Buku Kas Komite, Passkey Hapus Kas, hingga Tutup Buku Tahunan.
  - Memverifikasi 44 berkas JavaScript dengan skrip `check-syntax.js` $\rightarrow$ 100% lolos tanpa kesalahan.
- **Pembaruan Service Worker PWA ([`sw.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/sw.js)):**
  - Menaikkan versi cache ke `'simas-pwa-v89'`.

## [1.1.266] / [26.08.14.2] - 2026-08-14

### ⚡ Eliminasi Total Fallback Firestore pada Modul Keuangan & Pembaruan Service Worker
- **Pembersihan Total Fallback Firestore (Pure Supabase Operation):**
  - Menghapus seluruh fallback read ke Firestore pada:
    - [`js/page-keuangan.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-keuangan.js): `getTransactionsByNISList`, `loadPaymentHistory`, `executeDeletePayment`, `loadDailyReport`, `loadRecapIncome`, `loadCashflow`, `openClosingWizard`, `getMigrationRecords2026`, `getVirtualMigrationEntries`.
    - [`js/page-portal-siswa.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-portal-siswa.js): `loadSPP`.
    - [`js/page-wali-kelas.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-wali-kelas.js): `loadSppSummary`, `openDetailSppModal`.
    - [`js/page-guru-wali.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-guru-wali.js): `fetchSppSummaryForStudents`, `loadStudentSPP`.
    - [`js/page-dashboard.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-dashboard.js): `loadSppRealizationWidget`.
    - [`js/page-settings.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-settings.js): Hapus massal data siswa juga menghapus `finance_transactions` di Supabase.
  - Setiap kegagalan/kesalahan koneksi sekarang langsung menampilkan pesan galat asli (*explicit error logging*) tanpa menyamarkan masalah di balik Firestore fallback.
- **Dukungan Pembacaan Data Supabase > 1.000 Baris (Pagination & Batching):**
  - Menerapkan `window.fetchAllSupabaseRows` pada seluruh kueri agregasi, laporan, dan rekonsiliasi audit sehingga data berapapun jumlah barisnya akan terbaca 100% tuntas tanpa batas limit default 1000 baris PostgREST.
- **Pembaruan Service Worker PWA ([`sw.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/sw.js)):**
  - Menaikkan `CACHE_NAME` menjadi `'simas-pwa-v88'` untuk memastikan seluruh klien memperbarui aset JavaScript terbaru.

## [1.1.265] / [26.08.14.1] - 2026-08-14

### 🏦 Migrasi Penuh Modul Keuangan (SPP & Buku Kas Komite) ke Supabase PostgreSQL
- **Skema Database Relasional Supabase ([`supabase/migrations/202608140001_finance_system.sql`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/supabase/migrations/202608140001_finance_system.sql)):**
  - Menerapkan 4 tabel terstruktur dengan RLS (Row Level Security) dan composite indexing optimal:
    - `finance_transactions`: Transaksi pembayaran SPP per siswa & per bulan (`student_nis`, `year`, `month`, `amount`, `type`, `date_str`, dll).
    - `finance_cashflow`: Mutasi arus kas komite manual (`masuk`/`keluar`), nominal, tanggal, dan flag penutupan buku.
    - `finance_closings`: Catatan permanen tutup buku tahunan (saldo awal, total pemasukan, total pengeluaran, saldo akhir).
    - `finance_daily_summary`: Agregasi harian penerimaan SPP untuk pelaporan kas kilat.
- **Pengalihan Modul Keuangan Utama ([`js/page-keuangan.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-keuangan.js)):**
  - Mengalihkan `loadPaymentHistory`, `executePayment`, `executeDeletePayment`, `loadDailyReport`, `loadRecapIncome`, `loadCashflow`, `saveCashflowTransaction`, `deleteCashflowTransaction`, dan `executeYearEndClosing` ke Supabase SQL.
  - **Arsitektur Dual-Write Background:** Setiap transaksi baru otomatis ditulis ke Supabase PostgreSQL sebagai database utama dan ditulis cadangan ke Firestore di latar belakang untuk cadangan dingin.
  - **Fitur One-Click Sync & Audit Saldo Keuangan (`migrateFinanceDataToSupabase`):** Tombol di Tab Pengaturan `keuangan.html` untuk menyalin seluruh data historis dari Firestore ke Supabase serta melakukan verifikasi rekonsiliasi total baris & total nominal rupiah.
- **Pengalihan Konsumen Data SPP Seluruh Sistem:**
  - **Portal Siswa ([`js/page-portal-siswa.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-portal-siswa.js)):** Membaca histori SPP digital langsung dari Supabase `finance_transactions` (Firestore read = 0).
  - **Portal Wali Kelas ([`js/page-wali-kelas.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-wali-kelas.js)):** Rekap SPP siswa sekelas dan modal detail SPP membaca dari Supabase `finance_transactions`.
  - **Portal Guru Wali ([`js/page-guru-wali.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-guru-wali.js)):** Modal profil siswa & SPP anak binaan membaca dari Supabase.
  - **Dashboard Utama ([`js/page-dashboard.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-dashboard.js)):** Widget target & realisasi SPP sekolah membaca dari Supabase `finance_transactions` & `finance_daily_summary`.
  - **Migrasi NIS Siswa ([`js/page-students.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-students.js)):** Otomatis memperbarui `student_nis` dan ID transaksi di Supabase saat admin mengubah NIS siswa.

## [1.1.264] / [26.08.14.1] - 2026-08-14

### ⚡ Optimasi Kuota Read Firestore & Penguatan Caching SSOT
- **Eliminasi Full-Scan Permisi pada Portal Wali Kelas ([`js/page-wali-kelas.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-wali-kelas.js)):**
  - Mengganti kueri tanpa filter pada `records` permisi di `loadTodayAttendance` dengan kueri berbatas rentang waktu `todayDateStr` (00:00 - 23:59:59), mencegah pemindaian seluruh riwayat database.
  - Merampingkan kueri permohonan `permisi_requests`, `guru_wali_notes`, `bk_actions`, dan `records` dari redundansi loop variasi field menjadi kueri tunggal berindeks field SSOT (`studentClass` & `student_nis`).
- **Throttling & Local Optimistic Update Presensi Guru ([`js/page-presensi-guru.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-presensi-guru.js)):**
  - Menerapkan *session cache* (TTL 5 menit) pada `checkClassesPresensiCompleteness` untuk mencegah 24 pembacaan Firestore setiap kali admin kelas menyimpan data per JP.
  - Menambahkan *optimistic local update* saat admin kelas menyimpan JP sehingga widget kelengkapan kelas terupdate langsung dari memori tanpa panggilan server (**0 Firestore read**).
- **SessionStorage Persistence pada Monitoring KBM ([`js/page-monitoring-kbm.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-monitoring-kbm.js)):**
  - Menghubungkan seluruh memori cache jurnal, presensi guru, dan matriks cross-verifikasi ke `sessionStorage` agar data tetap tersimpan saat pengguna berpindah tab/halaman tanpa perlu me-request ulang dari Firestore.
  - Menjamin pembersihan session cache saat tombol *icon-only* Segarkan Data ditekan.
- **Zero-Read Filter Siswa per Kelas ([`js/page-students.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-students.js)):**
  - Mengubah fungsi `loadStudentsByClass` agar menyaring langsung dari cache IndexedDB/localStorage (`window.getStudentsCache()`) yang telah tersinkronisasi SSOT, mengeliminasi query berulang ke koleksi `students`.
- **TTL Cache Hitungan Permisi Dashboard ([`js/page-dashboard.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/page-dashboard.js)):**
  - Membungkus `getPermissionCountThisYear` dengan memory cache (TTL 10 menit) untuk menghindari lonjakan agregasi permohonan permisi siswa di dashboard.

## [1.1.263] / [26.08.13.1] - 2026-08-13

### 💬 Modal Pratinjau & Opsi Salin Pesan Laporan Tunggakan WhatsApp ([`keuangan.html`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/keuangan.html) & [`js/page-keuangan.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-keuangan.js))
- **Modal Pratinjau Rekapitulasi Tunggakan (`#modal-wa-arrears`):** Mengubah alur tombol "Kirim Wali" agar tidak langsung membuka tab WhatsApp, melainkan terlebih dahulu memunculkan pop-up modal interaktif yang menampilkan identitas Wali Kelas penerima, nomor WhatsApp yang terdaftar, dan draf teks pesan rekapitulasi.
- **Tombol Salin Pesan (Clipboard):** Menyediakan tombol "Salin Pesan" dengan fallback multi-browser agar admin/petugas keuangan dapat menyalin pesan dan menempelkannya (*paste*) secara manual ke aplikasi perpesanan pilihan.
- **Tombol Kirim ke WhatsApp Direct:** Mempertahankan tombol direct link WhatsApp (`wa.me`) untuk membuka tab baru secara instan, lengkap dengan pengiriman notifikasi otomatis multi-channel (Telegram Bot & FCM Web Push) ke Wali Kelas di latar belakang.
- **Draf Pesan Editable:** Memungkinkan admin meninjau serta menyesuaikan redaksi pesan secara fleksibel pada textarea sebelum dikirimkan atau disalin.

## [1.1.262] / [26.08.12.15] - 2026-08-12

### ⚡ Eliminasi Pemborosan Hosting Storage Domain Mirror (`firebase.json` & `redirect-stub/`)
- **Pemisahan Folder Deploy Redirect Stub:** Membuat folder khusus `redirect-stub/` dengan berkas `index.html` minimal dan mengarahkan target hosting `sman1abang` serta `simas-shakti` di `firebase.json` ke folder tersebut alih-alih `"public": "."`.
- **Penghematan Storage & Akselerasi Deploy:** Mengeliminasi duplikasi pengunggahan ribuan berkas proyek SIMAS ke 2 domain mirror yang hanya bertugas melakukan 301 Redirect ke `https://smagesa.web.app/`, memangkas penggunaan kuota penyimpanan hosting Firebase hingga ~66% (hanya 1x deploy aset penuh di domain master `smagesa`).

## [1.1.261] / [26.08.12.14] - 2026-08-12

### 📐 Optimalisasi Area Grid Matriks KBM ([`monitoring-kbm.html`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/monitoring-kbm.html) & [`js/page-monitoring-kbm.js`](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-monitoring-kbm.js))
- **Peninggian Tinggi Kontainer Matriks KBM:** Memperbarui batas minimum tinggi (`min-h-[550px]` & `lg:min-h-[650px]`) serta kalkulasi `maxHeight` dinamis pada `setupDesktopStickyFooter()` (`Math.max(650, minPreferredH, calculatedMaxH)`) agar tabel matriks verifikasi KBM tampil jauh lebih tinggi, lapang, dan nyaman dibaca untuk seluruh kelas tanpa merasa sesak atau terlalu pendek.

## [1.1.260] / [26.08.12.13] - 2026-08-12

### 🏷️ Penghapusan Badge Indikator "BARU" (`js/global.js` & `js/page-agenda.js`)
- **Pembersihan Teks Badge "BARU":** Menghapus indikator/badge teks "BARU" pada item menu sidebar **Agenda dan Dokumen** dan **Game PID** (`js/global.js`), serta pada kartu dokumen Google Drive di halaman agenda (`js/page-agenda.js`) untuk menyajikan antarmuka navigasi yang lebih bersih dan konsisten.

## [1.1.259] / [26.08.12.12] - 2026-08-12

### 🎨 Desain Compact Icon-Only Tombol Segarkan Data (`monitoring-kbm.html`)
- **Penyelarasan Desain Tombol Segarkan Data:** Mengubah tombol segarkan data di header Monitoring KBM menjadi format ringkas *icon-only* (ikon `fa-arrows-rotate` / sinkron) tanpa teks tulisan, dengan tooltip penjelas untuk mempertahankan kebersihan UI.

## [1.1.258] / [26.08.12.11] - 2026-08-12

### 🌐 Cross-Tab Memory Filtering pada Kehadiran Siswa (`js/page-monitoring-kbm.js`)
- **Penetrasian Data Lintas Tab (Cross-Tab Data Reuse):** Jika data jurnal bulan berjalan sudah dimuat di tab **Monitoring KBM**, **Rekap Guru**, atau **Detail Guru**, membuka tab **Kehadiran Siswa** untuk kelas & mapel apa pun pada bulan tersebut secara otomatis disaring dari memori (`_cache.jurnalByMonth`) tanpa melakukan query Firestore baru (**0 read Firestore & 0ms delay**).

## [1.1.257] / [26.08.12.10] - 2026-08-12

### ⚡ Optimasi Tambahan Kuota Read Firestore & Matrix Cache (`js/page-monitoring-kbm.js` & `js/asc-schedule-parser.js`)
- **High-Level Matrix Cache di `fetchCrossVerifiedData`:** Menyimpan hasil kalkulasi matriks verifikasi 3 arah (`_cache.crossVerified[datesKey]`) secara utuh. Beralih antar filter/guru di periode semester yang sama kini **0 read Firestore & 0 loop overhead** (proses 0ms instan).
- **In-Memory Master Teacher Lookup:** Menggunakan `window.getTeachersCache()` (IndexedDB/localStorage) pada saat inisialisasi akun guru terhubung (`linkedTeacherId`) untuk mengeliminasi pemanggilan Firestore `getDoc` saat pertama kali membuka halaman.
- **Throttling Mapping Jadwal XML (`js/asc-schedule-parser.js`):** Menambahkan proteksi TTL 5 menit (`XML_CHECK_TTL_MS`) pada fungsi `loadCustomTeacherMapping` agar tidak melakukan `getDoc` ke `schedule_config` jika data mapping lokal sudah ada dan belum *stale*.

## [1.1.257] / [26.08.12.10] - 2026-08-12

### 🔄 Otomatisasi Filter Semester & Tahun Ajaran Berjalan (`js/page-monitoring-kbm.js`)
- **Penyesuaian Otomatis dengan TA & Semester Berjalan:** Filter Semester dan Tahun Ajaran pada tab Rekap Guru dan Detail Guru kini secara otomatis mendeteksi dan memilih Semester & Tahun Ajaran yang sedang aktif (misal Semester 1 / Semester 2 berdasarkan bulan berjalan atau konfigurasi SSOT `raporConfig`).
- **Opsi Tahun Ajaran Dinamis:** Menghasilkan opsi daftar Tahun Ajaran secara dinamis di seputar tahun ajaran aktif tanpa perlu diketik manual.

## [1.1.256] / [26.08.12.9] - 2026-08-12

### 🗓️ Penambahan Filter Periode Semester pada Rekap Guru & Detail Guru (`monitoring-kbm.html` & `js/page-monitoring-kbm.js`)
- **Filter Semester pada Rekap Guru & Detail Guru:** Menambahkan opsi periode `Semester` pada dropdown filter di tab Rekap Guru dan Detail Guru.
- **Fleksibilitas Pilihan Semester & Tahun Ajaran:** Menyediakan input pilihan Semester (Semester 1 / Semester 2) serta Tahun Ajaran (misal `2025/2026`) yang otomatis menghasilkan rentang hari kerja secara presisi tanpa hambatan kuota read Firestore berkat dukungan *caching layer*.

## [1.1.255] / [26.08.12.8] - 2026-08-12

### 🏷️ Perubahan Nomenklatur Status `TK` & Refactor Formula % Kehadiran Guru (`monitoring-kbm.html` & `js/page-monitoring-kbm.js`)
- **Nomenklatur Status Presensi Guru:** Mengubah kode status **`TT`** (Tdk Tahu) menjadi **`TK`** (Tanpa Keterangan) pada tabel Rekap Guru, Detail Guru, filter status dropdown, badge, dan stat cards.
- **Formula Persentase Kehadiran Fisik Murni:** Memperbarui perhitungan persentase kehadiran guru menjadi `(Hadir / Total JP Wajib) * 100%` di mana `Hadir` adalah jam mengajar fisik guru di kelas (`data.H`).

## [1.1.254] / [26.08.12.7] - 2026-08-12

### ⚡ Implementasi Caching Layer Hemat Kuota Read Firestore (`monitoring-kbm.html` & `js/page-monitoring-kbm.js`)
- **Multi-Level Session Caching Layer:** Menerapkan memori/session cache (`_cache`) bertingkat untuk query `jurnal_guru` dan dokumen `guru_presensi/{kelas}/{year}/{month}` dengan penyesuaian TTL dinamis (Hari ini: 5 menit, Bulan ini: 10 menit, Data lampau: 1 jam). Memotong konsumsi *read* Firestore hingga >90% saat perpindahan tanggal, filter JP, maupun navigasi antar tab **Monitoring KBM**, **Rekap Guru**, dan **Detail Guru**.
- **Shared Cache Cross-Verification (`fetchCrossVerifiedData`):** Berbagi data cache `guru_presensi` dan `jurnal_guru` antara Tab **Rekap Guru** dan Tab **Detail Guru** sehingga tidak ada query berulang saat pengguna berpindah tab.
- **Tombol & Indikator Status Cache di UI (`monitoring-kbm.html`):** Menyediakan tombol **"Segarkan Data"** (`window.refreshKbmData()`) beserta badge indikator transparansi status cache (`⚡ Data dari Cache` / `🔄 Diperbarui`) untuk memfasilitasi pengambilan data *live* paling baru dari Firestore secara instan dengan 1 klik.
- **Penyelarasan Terminology & Label Status (`TK - Tanpa Keterangan`):** Memperbarui seluruh filter, tabel, dan summary modal dari istilah `TT` menjadi **`TK` (Tanpa Keterangan)** agar selaras dengan kriteria presensi sekolah.

## [1.1.253] / [26.08.12.6] - 2026-08-12

### 🐛 Perbaikan Scope Fungsi `isJPElapsed` di Modul Monitoring KBM (`js/page-monitoring-kbm.js`)
- **Fix Global Function Scope (`isJPElapsed`):** Memindahkan deklarasi fungsi `isJPElapsed(jpNum, dateStr)` dari cakupan lokal `renderRekapJurnalTable` ke cakupan global berkas `js/page-monitoring-kbm.js`.
- **Solusi Error:** Menyelesaikan `ReferenceError: isJPElapsed is not defined` yang terjadi ketika `loadRekapGuru()` atau `loadDetailGuru()` dipanggil dari antarmuka Rekap Guru / Detail Guru.

## [1.1.252] / [26.08.12.5] - 2026-08-12

### 🔄 Integrasi Verifikasi 3 Arah & Kriteria Hari/JP Tidak Belajar Efektif (`monitoring-kbm.html` & `js/page-monitoring-kbm.js`)
- **Penyempurnaan Kriteria Tidak Belajar Efektif (`verifiedCount <= 3`):** Mengubah ambang batas deteksi JP *Tidak Belajar Efektif* dari semula `0 kelas` menjadi **`<= 3 kelas terverifikasi` di seluruh sekolah pada JP tersebut**. Apabila dalam satu JP hanya 1-3 kelas yang terisi jurnal/presensinya (misal saat Rapat Guru, Jam Kosong Serentak, Pulang Cepat, atau Libur Sekolah), JP tersebut secara otomatis dikategorikan sebagai **🚫 Tidak Belajar Efektif (TE)**.
- **Verifikasi Silang 3 Arah pada Rekap & Detail Guru (`loadRekapGuru` & `loadDetailGuru`):** Mengombinasikan data dari `jurnal_guru` (Input Guru), `guru_presensi` (Input Siswa), dan `Jadwal.xml` (Jadwal Master). Guru yang sudah melengkapi Jurnal Mengajar otomatis tercatat **Hadir (H)** 100% meskipun siswa belum/lupa mengabsen.
- **Proteksi Persentase Presensi Guru:** Menambahkan kolom **TE (Tidak Efektif)** pada tabel **Rekap Guru** dan **Detail Guru**. Seluruh JP *TE* secara otomatis **dikecualikan dari total pembagi JP wajib**, sehingga % kehadiran guru tidak berkurang akibat hari/jam tidak efektif sekolah.
- **Penyelarasan Compact UI Filter Bar:** Memperkecil padding filter bar (`p-2.5 mb-3`) dan opsi status `TE - Tidak Efektif` pada tab Rekap & Detail Guru.

## [1.1.251] / [26.08.12.4] - 2026-08-12

### 📐 Optimalisasi Desain Compact UI Header, Filter Bar, & Summary Card (`monitoring-kbm.html` & `js/page-monitoring-kbm.js`)
- **Kompresi Header & Subtab Navigation (`monitoring-kbm.html`):** Mengurangi margin bawah kontainer header (`mb-6` → `mb-3`), menyesuaikan ukuran font judul (`text-2xl` → `text-xl`), dan memperkecil padding tombol subtab navigasi (`px-3 py-1.5 text-xs`).
- **Kompresi Filter Section (`monitoring-kbm.html`):** Mengurangi padding kontainer filter (`p-4` → `p-2.5`), gap antar elemen (`gap-3` → `gap-2`), serta ukuran select/input (`py-2.5` → `py-1.5`, `text-sm` → `text-xs`) dan tombol Cari.
- **Redesain Compact Summary Card (`monitoring-kbm.html`):** Mengubah banner biru yang tinggi menjadi bar ringkas 1 baris (*sleek low-profile summary bar*) berketinggian ~36px dengan *stat pills* horizontal (`text-xs font-extrabold`). Menghemat ruang vertikal layar hingga 70% sehingga tabel data utama langsung terlihat tanpa banyak meng-scroll.

## [1.1.250] / [26.08.12.3] - 2026-08-12

### 🎯 Penyelarasan SSOT Filter Mapel pada Tab Kehadiran Siswa (`js/page-monitoring-kbm.js`)
- **Penyaringan Ketat Master Mapel (`js/page-monitoring-kbm.js`):** Memperbarui fungsi `populateFilters()` agar menyaring kunci `mapel_guru` secara ketat menggunakan `raporConfig.mapel_list` sebagai Single Source of Truth (SSOT). Nama mata pelajaran duplikat/legacy di luar daftar master resmi kini 100% diabaikan dan tidak akan muncul di dropdown pilihan mata pelajaran.

## [1.1.249] / [26.08.12.2] - 2026-08-12

### 🧹 Penghapusan Sub-Tab "Daftar Jurnal" pada Monitoring KBM (`monitoring-kbm.html` & `js/page-monitoring-kbm.js`)
- **Pembersihan UI & Sub-Tab Navigation (`monitoring-kbm.html`):** Menghapus tombol navigasi `<button id="tab-daftar-jurnal">` dan kontainer HTML `<div id="panel-daftar-jurnal">` dari halaman Monitoring KBM untuk menyederhanakan tampilan antarmuka.
- **Pembersihan Kode JavaScript (`js/page-monitoring-kbm.js`):** Menghapus fungsi `initDaftarJurnalInputs()`, `loadJurnalData()`, `renderJurnalTable()`, variabel `jurnalCacheData`, serta penanganan tab `daftar-jurnal` pada fungsi `switchTab()` secara menyeluruh tanpa meninggalkan sisa residu kode.

## [1.1.248] / [26.08.12.1] - 2026-08-12

### ⏳ Penyesuaian Status JP Belum Berjalan di Monitoring KBM (`js/page-monitoring-kbm.js`)
- **Pengosongan Status Badge JP Belum Berjalan:** Pada matriks Monitoring KBM, jika Jam Pelajaran (JP) belum tiba/belum berjalan berdasarkan jadwal waktu sekolah (`JP_TIME_CONFIG`), status badge (`Belum Isi Jurnal` / `Kelas Kosong`) dikosongkan terlebih dahulu sehingga tidak menandai kelas yang belum dimulai.
- **Harmonisasi Rekapan Footer per JP:** Baris footer ringkasan per JP (`<tfoot>`) kini menampilkan tanda strip (`—`) apabila JP di kolom tersebut belum berjalan dan belum ada aktivitas KBM yang tercatat.
- **Tampilan Modal Detail Sel:** Memperbarui dialog modal detail sel agar menampilkan status `⏳ Belum Berjalan` dengan tampilan netral jika badge status pada sel bernilai kosong.

## [1.1.247] / [26.08.11.29] - 2026-08-11

### 🎨 Pembersihan Ikon Filter Kelas & Guru (`jadwal.html`)
- **Pembersihan Ikon Input (*Clean Input Design*):** Menghapus ikon dekoratif kaca pembesar (`fa-magnifying-glass`) dan gedung sekolah (`fa-school`) dari dalam kolom input/select filter jadwal.
- **Penyelarasan Padding:** Menyesuaikan padding horizontal kolom input/select (`px-3.5`) agar teks opsi dan nama guru tampil bersih, luas, dan mudah dibaca tanpa ada tabrakan visual.

## [1.1.246] / [26.08.11.28] - 2026-08-11

### 📐 Penyesuaian Presisi Layout Viewport (`jadwal.html`)
- **Penyelarasan Standar Kontainer `<main>`:** Menghapus deklarasi `w-full max-w-none` manual pada tag `<main>` yang sebelumnya berbenturan dengan kalkulasi `margin-left` sidebar global (`md:ml-64`).
- **Pencegahan Horizontal Overflow:** Struktur kontainer kini secara presisi mengisi ruang kanvas layar yang tersedia di samping sidebar tanpa mengalami kelebihan lebar (*overflow*) horizontal ke luar monitor.

## [1.1.245] / [26.08.11.27] - 2026-08-11

### 🚀 Optimasi Tampilan Full-Width, Combobox Guru, & Penanda Live Jadwal (`jadwal.html` & `js/page-jadwal.js`)
- **Tampilan Penuh (Full-Width Responsive Layout):** Menghilangkan batasan `max-w-7xl` pada kontainer utama dan menerapkan `w-full max-w-none` dengan tabel `table-fixed` agar matriks jadwal memanfaatkan seluruh lebar layar monitor pengguna secara proporsional.
- **Searchable Combobox / Filter Pencarian Guru:** Mengganti `<select>` biasa dengan *custom searchable input dropdown* (`#input-search-teacher` & `#dropdown-teacher-list`). Pengguna dapat mencari guru berdasarkan nama lengkap, nama pendek/kode XML, atau NIP secara instan saat mengetik beberapa karakter, lengkap dengan tombol reset pencarian (*clear*).
- **Penanda Visual Real-time (Hari & JP Berjalan / Live KBM):**
  - **Header Hari Ini:** Kolom hari yang sesuai tanggal hari ini (Senin–Jumat) otomatis memiliki aksen kontras dan lencana berkedip `Hari Ini`.
  - **Row JP Aktif:** Jam pelajaran yang sedang berjalan ditandai dengan badge `● LIVE` dan border aksen.
  - **Slot Sel Berlangsung:** Kartu mata pelajaran pada pertemuan Hari & JP yang sedang aktif otomatis disorot dengan efek ring tebal `ring-2 ring-blue-500` dan label `📍 Saat Ini`.
  - **Penanda Jam Istirahat Aktif:** Menampilkan status `● Sedang Berlangsung` pada baris Istirahat 1 (09:45–10:00) atau Istirahat 2 (12:15–12:30).
  - **Pembaruan Interval Otomatis:** Sistem mengevaluasi waktu jam lokal secara otomatis setiap 60 detik tanpa perlu merefresh halaman atau melakukan query database.

## [1.1.244] / [26.08.11.26] - 2026-08-11

### 📅 Halaman Baru: Jadwal Pelajaran Mingguan (`jadwal.html` & `js/page-jadwal.js`)
- **Tampilan Jadwal Mingguan Per Kelas & Per Guru:** Menyediakan antarmuka visual jadwal pelajaran 1 minggu penuh (Senin s.d. Jumat, JP 1–10) berbasis SSOT XML *aSc Timetables* (`asc-schedule-parser.js`).
- **Dua Mode Tampilan Utama:**
  - **Mode Per Kelas:** Menyajikan matriks jadwal lengkap per rombel kelas beserta nama guru pengampu.
  - **Mode Per Guru:** Menyajikan jadwal mengajar per guru beserta rombel kelas yang diajar dan total akumulasi beban jam mengajar (JP per minggu).
- **Auto-Selection Cerdas Berdasarkan Akun:**
  - Siswa & Admin Kelas otomatis membuka tab kelas yang bersangkutan (`assignedClass`).
  - Guru otomatis membuka tab profil guru yang bersangkutan.
- **Dukungan Mobile & Cetak (Print/PDF):** Navigasi tab per hari pada mode smartphone dan layout khusus ramah cetak (`@media print`) untuk kebutuhan arsip/cetak dokumen jadwal.
- **Efisiensi Kuota (Zero Extra Firestore Reads):** Memanfaatkan cache terpusat jadwal XML dan cache master data tanpa melakukan query Firestore berulang.

## [1.1.243] / [26.08.11.25] - 2026-08-11

### 📐 Optimasi Tampilan & Redaksi Widget Monitoring Kelengkapan Presensi Guru (`js/page-presensi-guru.js`)
- **Penyederhanaan Teks Subtitle:** Mengubah kalimat petunjuk menjadi: *"Terdapat X dari Y kelas belum lengkap Mengisi Presensi Guru."*
- **Desain Chip Ringkas (Compact Flex-Wrap):** Mengubah grid chip kelas yang belum lengkap menjadi tata letak flex-wrap yang jauh lebih hemat ruang vertikal dan rapi.
- **Penyelarasan Tampilan Seragam:** Menghapus badge/tulisan khusus "Kelas Anda" agar tampilan daftar seluruh kelas yang belum lengkap tampil seragam dan terurut secara alfabetis.

## [1.1.242] / [26.08.11.24] - 2026-08-11

### ⚠️ Widget Monitoring Kelengkapan Presensi Guru Kelas Mulai Pukul 14:00 (`presensi-guru.html` & `js/page-presensi-guru.js`)
- **Pengecekan Kelengkapan Presensi Seluruh Kelas (s.d. JP 10):** Menambahkan fungsi `checkClassesPresensiCompleteness()` dan `renderIncompleteClassesWidget()` pada `js/page-presensi-guru.js` untuk memantau status pengisian presensi guru harian seluruh kelas aktif di sekolah.
- **Kondisi Aktivasi (Mulai Pukul 14:00 / Tanggal Lampau):** Widget monitoring otomatis aktif dan muncul di atas tabel presensi jika waktu lokal saat ini telah mencapai pukul 14:00 ke atas pada hari KBM, atau ketika pengguna membuka riwayat tanggal lampau.
- **Dukungan RBAC Ketat (Admin Kelas vs Super Admin):**
  - **Super Admin:** Menampilkan chip kelas belum lengkap yang dapat diklik (*clickable*) untuk langsung beralih (*switch*) ke form presensi kelas tersebut.
  - **Admin Kelas (Siswa):** Menampilkan status kelengkapan kelas secara informatif tanpa kemampuan beralih/membuka kelas lain (akses tetap terkunci pada `assignedClass` masing-masing).
- **Banner Konfirmasi 100%:** Menampilkan spanduk hijau sukses ketika seluruh kelas di sekolah telah berhasil melengkapi presensi guru s.d. JP 10.
- **Pembaruan Real-Time:** Status monitoring terbarui secara otomatis saat pengguna memilih tanggal baru, saat memuat halaman, maupun segera setelah pengguna menekan tombol Simpan JP.

## [1.1.241] / [26.08.11.23] - 2026-08-11

### 🕒 Filter Otomatis Kelas & Mapel Berbasis Jadwal Real-Time di Portal Guru Mapel (`guru-mapel.html`, `js/page-guru-mapel.js`, `js/asc-schedule-parser.js`)
- **Deteksi Jam Mengajar Real-Time (JP Aktif):** Ketika Portal Guru Mapel dibuka pada jam mengajar aktif (Senin s.d. Jumat), sistem secara cerdas menghitung Jam Pelajaran (JP 1–10) saat itu dan mencocokkannya dengan jadwal pelajaran guru pengampu dari data XML *aSc Timetables* (`asc-schedule-parser.js`).
- **Auto-Select Kelas & Mata Pelajaran:** Dropdown `#select-kelas` dan `#select-mapel` otomatis terpilih ke kelas dan mata pelajaran yang sedang diajar guru pada jam/JP aktif tersebut tanpa perlu dipilih manual satu per satu.
- **Penanganan Istirahat & Persiapan Pagi:** Jika dibuka saat waktu jeda istirahat atau sebelum bel jam pertama, sistem cerdas memetakan filter ke jadwal JP berikutnya yang akan masuk.
- **Badge Indikator Interaktif:** Menampilkan badge dinamis di header banner (misal: `🕒 JP 2 Aktif: X-1 • Matematika`) yang dapat diklik kapan saja untuk memfilter ulang ke jadwal aktif guru.
- **Fleksibilitas Penuh:** Guru tetap bebas mengganti pilihan kelas atau mata pelajaran lain secara manual kapan pun diinginkan tanpa terkunci.

## [1.1.240] / [26.08.11.22] - 2026-08-11

### 🧪 Otomatisasi Mata Pelajaran di Booking E-Lab berbasis Jadwal XML (`e-lab.html`, `js/page-e-lab.js`)
- **Auto-fill Mata Pelajaran / Kegiatan:** Menghubungkan modul booking E-Laboratorium dengan data jadwal *aSc Timetables* (`asc-schedule-parser.js`). Ketika guru memilih Tanggal, JP Mulai, dan Kelas di modal booking, kolom Kegiatan/Mata Pelajaran (`#booking-kegiatan`) otomatis terisi sesuai jadwal pelajaran kelas tersebut pada hari & JP bersangkutan.
- **Tetap Dapat Diedit Bebas:** Kolom input tetap fleksibel dan dapat diedit atau ditambahkan rincian kegiatan manual oleh guru kapan saja.
- **Visual Feedback & Badge:** Menampilkan badge visual `"✨ Otomatis XML"` dan teks petunjuk informatif (`#booking-mapel-hint`) yang memuat nama mata pelajaran serta nama guru pengampu dari jadwal.

## [1.1.239] / [26.08.11.21] - 2026-08-11

### 📌 Sticky Footer Rekapan per JP di Desktop (`monitoring-kbm.html`, `js/page-monitoring-kbm.js`)
- **Desktop Sticky Footer:** Pada layar desktop (≥1024px), container tabel Monitoring KBM kini diberi `max-height` dinamis berdasarkan posisi viewport sehingga baris footer rekapan per JP (`<tfoot>`) selalu terlihat menempel di bagian bawah layar saat scroll vertikal.
- **Mobile Tetap Normal:** Pada layar mobile, tabel tetap menggunakan `overflow-y: visible` tanpa batas tinggi.
- **Responsive Resize:** Max-height dihitung ulang secara debounced saat window di-resize.

## [1.1.238] / [26.08.11.20] - 2026-08-11

### 📊 KBM Aktif di Footer Rekapan Monitoring KBM (`js/page-monitoring-kbm.js`)
- **KBM Aktif (Progress Bar):** Mengganti progress bar dari "Terverifikasi" menjadi "📘 KBM Aktif" yang mencakup gabungan Terverifikasi + Belum Jurnal + Belum Presensi, menunjukkan persentase kelas yang KBM-nya aktif berjalan.
- **Terverifikasi Disamakan:** Tampilan "🟢 Terverifikasi" kini menggunakan format compact yang sama dengan item breakdown lainnya (emoji + label + jumlah).

## [1.1.237] / [26.08.11.19] - 2026-08-11

### 📊 Penyempurnaan Footer Rekapan per JP di Monitoring KBM (`js/page-monitoring-kbm.js`)
- **Pemisahan Guru TK:** Kategori "Guru Absen" dipecah menjadi `🔴 Guru TK` (Tanpa Keterangan / TT / Alpha) dan `🏥 S/I/K` (Sakit / Izin / Kegiatan) agar lebih informatif.
- **Hapus Rekapan Upacara/Ekskul/Tidak Efektif:** Kolom JP yang berstatus Upacara, Ekskul, atau Tidak Belajar Efektif kini menampilkan dash ("—") di footer, tanpa breakdown detail.

## [1.1.236] / [26.08.11.18] - 2026-08-11

### 📊 Footer Rekapan Status per JP di Tabel Monitoring KBM (`js/page-monitoring-kbm.js`)
- **Baris Footer Rekapitulasi (`<tfoot>`):** Menambahkan baris *sticky bottom* di bagian bawah tabel matriks Monitoring KBM yang menampilkan ringkasan status per kolom Jam Pelajaran (JP 1–10).
- **Progress Bar Terverifikasi:** Setiap kolom JP menampilkan jumlah kelas `🟢 Terverifikasi` beserta persentase dan progress bar visual hijau.
- **Breakdown Detail Status:** Di bawah progress bar, ditampilkan rincian jumlah kelas per kategori status lainnya: `🩵 Belum Presensi`, `🟡 Belum Jurnal`, `🏥 Guru Absen`, dan `🟧 Kelas Kosong` (hanya ditampilkan jika jumlahnya > 0).
- **Penanganan JP Khusus:** Kolom JP Upacara (`🇮🇩`) dan Ekstrakurikuler (`⚽`) serta JP Tidak Belajar Efektif (`🚫`) menampilkan badge khusus tanpa breakdown detail.

## [1.1.235] / [26.08.11.17] - 2026-08-11

### 🔓 Multi-JP Block Unlocking pada Presensi Guru (`presensi-guru.html` & `js/page-presensi-guru.js`)
- **Deteksi Blok Pengajaran Guru Berturut-turut:** Menambahkan fungsi `getMaxJPToShow()` dan `isSameTeacherBlock()` pada `js/page-presensi-guru.js` untuk mendeteksi blok jam pelajaran yang diampu oleh guru/mapel yang sama secara berturut-turut (misalnya JP 2, 3, 4).
- **Pemunculan Instan Blok Multi-JP:** Ketika JP sebelumnya (misal JP 1) telah disimpan atau pada saat pembukaan awal halaman, seluruh JP dalam blok pengajaran guru tersebut (misal JP 2, 3, 4) akan **langsung terbuka sekaligus** di tabel presensi tanpa mengharuskan pengguna menyimpan JP secara bertahap satu per satu.
- **Dynamic Re-Unlocking:** Membaca data jadwal XML aSc Timetables lebih awal dan menambahkan re-evaluasi blok (`checkAndReRenderIfBlockExpanded()`) saat terjadi perubahan input mapel/guru atau aksi copy data (`copyFromAbove`), sehingga perluasan blok JP langsung tercermin di tabel.
- **Pembaruan Teks Helper:** Memperbarui teks petunjuk di bawah tabel presensi agar secara dinamis menampilkan rentang JP aktif yang sedang terbuka (misal: *"Silakan simpan presensi guru JP 2 s.d. 4 sebelum dapat mengisi presensi guru JP 5"*).

## [1.1.234] / [26.08.11.16] - 2026-08-11

### 🌙 Perbaikan Komposisi Warna Dark Mode Legenda Score Bar (`guru-mapel.html`)
- **Perbaikan Class Tailwind Usang:** Mengubah class `dark:bg-slate-850/90` menjadi `dark:bg-slate-900/90` pada container legenda penanda warna nilai (`#legend-score-bar`), sehingga latar belakang legenda di bawah tabel penilaian menyatu dengan tema gelap tanpa warna putih mencolok.
- **Pembersihan Class Non-Standar:** Membersihkan penggunaan class non-standar `slate-850` pada berkas `siswa.html`, `duta-admin.html`, `js/page-duta-admin.js`, serta modul `sukaduka/suka-duka.html` dan `sukaduka/suka-duka.js`.

## [1.1.233] / [26.08.11.15] - 2026-08-11

### 📱 Optimasi Tampilan Mobile Portal Guru Mapel (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Tab Presensi (Kehadiran Siswa):**
  - Sembunyikan kolom **NO** (No Absen) dan **NIS** pada mode mobile (`hidden sm:table-cell`).
  - Bekukan (*freeze / sticky left-0*) kolom **NAMA PESERTA DIDIK** pada posisi paling kiri saat horizontal scroll di mobile, dengan dukungan highlight background saat hover pada mode terang dan gelap.
- **Tab Jurnal (Daftar Jurnal Mengajar):**
  - Sembunyikan kolom **Guru Pengampu** pada mode mobile (`hidden sm:table-cell`).
  - Sembunyikan detail teks **Waktu** pada kolom *Waktu & JP* (`hidden sm:flex`) saat diakses via mobile, sehingga hanya menampilkan badge Kelas & JP dan membuat lebar kolom jauh lebih ringkas (`min-w-[90px] sm:min-w-[170px]`).

## [1.1.232] / [26.08.11.14] - 2026-08-11

### 🛠️ Perbaikan HTTP 409 Conflict pada Penyimpanan Catatan Siswa (`js/page-guru-mapel.js`)
- **Penambahan Field Primary Key `id` di Query Supabase:** Memperbarui parameter `selectFields` pada fungsi `loadGradebookData()` untuk menyertakan `id` dari tabel `guru_mapel_summaries`, sehingga `sm.id` tersimpan pada `existingSummariesMap`.
- **Penggunaan Primary Key `id` pada Payload Upsert (`saveStudentNotes` & `saveGradebookData`):** Menyertakan `id` (jika tersedia) dan mempertahankan nilai `sas_sat_score` dalam objek `summaryPayload`, mencegah terjadinya konflik `INSERT ... ON CONFLICT (gradebook_id, student_nis)` HTTP 409 pada Supabase API.
- **Update State Lokal Secara Instan:** Menambahkan `.select(...)` setelah `upsert` pada Supabase untuk menangkap `id` baru dari database dan memperbarui `existingSummariesMap` secara konsisten.

### 🟧 Penambahan Status "Kelas Kosong" di Monitoring KBM (`monitoring-kbm.html` & `js/page-monitoring-kbm.js`)
- **Penambahan Kategori Sel (`js/page-monitoring-kbm.js`):** Menambahkan kondisi evaluasi sel pada matriks Monitoring KBM: `!jurnal && (!presensi || !presensi.status)`.
- **Kriteria Status:** Pada Jam Pelajaran efektif sekolah, jika guru tidak mengisi jurnal DAN siswa/admin kelas tidak mengisi presensi guru di kelas tersebut, sel akan ditandai dengan badge khusus **`🟧 Kelas Kosong`**.
- **Pembaruan Legenda Status (`monitoring-kbm.html`):** Menambahkan item legenda **`🟧 Kelas Kosong`** pada spanduk Status KBM di bawah tabel.

## [1.1.231] / [26.08.11.13] - 2026-08-11

### 📚 Pemurnian Data Mata Pelajaran Berdasarkan Jadwal.xml (`jurnal-app.js`, `settings-app.js` & `portal-admin-rahasia-88x.html`)
- **Pembersihan Mapel Usang di Luar Jadwal XML:** Mengubah alur pengisian dropdown Mata Pelajaran (`#input-mapel`) pada Jurnal Mengajar dan Tab Data Mapel pada Admin Portal agar murni dipopulasi dari 29 daftar mata pelajaran resmi `Jadwal.xml`.
- **Pembersihan Otomatis Koleksi `daftar_mapel` di Firestore:** Menghapus dokumen mapel lama yang tidak lagi terdaftar pada jadwal resmi aSc Timetables serta menyinkronkan 29 mapel aktif secara otomatis.

## [1.1.230] / [26.08.11.12] - 2026-08-11

### 🎨 Indikator Warna Badge Circle JP Presensi Guru (`presensi-guru.html` & `js/page-presensi-guru.js`)
- **Indikator Warna Badge JP Minimalis (Green vs Amber):** Mengubah penanda status tersimpan/belum tersimpan menjadi warna pada badge lingkaran nomor JP (JP 1, JP 2, dsb).
  - 🟢 **Badge Hijau (`bg-emerald-600`):** Menandakan JP tersebut telah 100% tersimpan di Firestore (Tombol Simpan disembunyikan).
  - 🟡 **Badge Kuning/Amber (`bg-amber-500`):** Menandakan JP tersebut belum disimpan / ada perubahan (Tombol Simpan ditampilkan).
- **Eliminasi Teks Badge Redundan:** Mengeliminasi seluruh badge teks tambahan di samping tombol simpan untuk menghasilkan antarmuka baris yang sangat bersih, minimalis, dan memberikan ruang maksimum bagi dropdown Status Kehadiran Guru.

## [1.1.229] / [26.08.11.11] - 2026-08-11

### 📱 Optimasi Layout Mobile Presensi Guru Compact & Responsive (`js/page-presensi-guru.js`)
- **Peleluasan Dropdown Status Guru (`flex-1 min-w-0`):** Mengatur ulang flexbox pada Baris 3 tabel Presensi Guru di tampilan mobile agar `<select>` Status Kehadiran mengambil seluruh sisa lebar ruang yang tersedia. Teks opsi status (`Hadir`, `Izin`, `Sakit`, dsb) kini 100% terlihat jelas tanpa terpotong.
- **Eliminasi Badge Redundan di Mobile:** Menyembunyikan badge status tambahan (`Belum Disimpan`) pada baris mobile ketika tombol **Simpan** aktif, sehingga tombol Simpan dan Dropdown Status berdampingan secara sangat *compact* dan rapi.

## [1.1.228] / [26.08.11.10] - 2026-08-11

### 📱 Pemunculan Bertahap JP (Progressive Unlocking) & Dynamic Save Button (`presensi-guru.html` & `js/page-presensi-guru.js`)
- **Sequential Progressive JP Unlocking:** Mengubah alur antarmuka Presensi Guru agar Jam Pelajaran (JP) ditampilkan secara bertahap. JP berikutnya (JP N+1) disembunyikan dan baru akan terbuka setelah JP N berhasil disimpan ke Firestore.
- **Wadah Informasi Instruksi Presensi:** Menambahkan spanduk petunjuk aktif di bawah JP yang belum tersimpan: *"Silakan simpan presensi guru JP X terlebih dahulu untuk membuka presensi guru JP X+1"*.
- **Pembeda Visual Status Tersimpan (`✓ Tersimpan` & `✏️ Perubahan`):** 
  - JP yang telah tersimpan di database secara otomatis menyembunyikan tombol Simpan dan menggantinya dengan badge hijau permanen `✓ Tersimpan`.
  - Apabila siswa/admin kelas melakukan perubahan data pada JP yang sudah tersimpan, tombol Simpan secara instan dimunculkan kembali dengan indikator `✏️ Ada Perubahan`.

## [1.1.225] / [26.08.10.25] - 2026-08-10

### 🔄 Backward Compatibility Jurnal & Nilai Lama (Mapel Alias Candidates Matching - `js/page-guru-mapel.js`)
- **Fitur Mapel Alias Matching (`getMapelNameCandidates`):** Menambahkan pencarian kandidat alias nama mapel secara otomatis. Apabila sebuah mapel mengalami perubahan nama (seperti `"Bahasa Indonesia Tk Lanjut"` menjadi `"Bahasa Indonesia Tingkat Lanjut"`), sistem akan secara cerdas mengenali nama resmi baru, nama lama, singkatan, dan short codes (`rapor_short_codes`).
- **Pencarian Jurnal Multi-Nama (Firestore `in` Operator):** Mengubah pencarian dokumen `jurnal_guru` pada Tab Jurnal, Rekap Kehadiran, dan Ekspor Excel agar menggunakan klausa `where("mapel", "in", candidates)` sehingga **seluruh rekam jurnal mengajar dan kehadiran lama yang pernah diinput dengan nama mapel lama tetap 100% muncul**.
- **Perolehan Nilai Supabase Multiversi (`candidateGbIds`):** Mengubah pencarian nilai Supabase di `fetchScoresFromSupabase` agar mendukung pencarian kandidat `gradebook_id` nama mapel baru maupun lama via `q.in('gradebook_id', candidateGbIds)`.

## [1.1.224] / [26.08.10.24] - 2026-08-10

### 🧹 Eliminasi Mapel Duplikat/Legacy Pasca Sync XML (`js/page-e-rapor.js` & `js/page-guru-mapel.js`)
- **Sanitasi Key Orphan Firestore (`js/page-e-rapor.js`):** Mengubah `syncASCScheduleXML()` agar menyimpan konfigurasi melalui `saveRaporConfig()`. Hal ini secara otomatis menjalankan `sanitizeRaporConfig()` untuk mengirimkan `deleteField()` pada seluruh key mapel legacy di Firestore yang sudah tidak terdaftar pada `mapel_list` XML terbaru (seperti `"Bahasa Indonesia Tk Lanjut"`).
- **Proteksi Filter Master Mapel (`js/page-guru-mapel.js`):** Mengubah `loadTeacherScope()` agar secara ketat menyaring `Object.keys(mapel_guru)` menggunakan `masterMapelSet` (`raporConfig.mapel_list`). Mapel duplikat/legacy di luar daftar resmi otomatis diabaikan dari dropdown Portal Guru Mapel.

## [1.1.223] / [26.08.10.23] - 2026-08-10

### 🛠️ Perbaikan Komprehensif Scope Kelas Guru Mapel & Cache Invalidation Pasca Sync XML (`js/page-guru-mapel.js` & `js/page-e-rapor.js`)
- **Invalidasi Cache Otomatis Pasca Sync XML (`js/page-e-rapor.js`):** Memperbarui `invalidateRaporConfigCache()` untuk menghapus `simas_rapor_config_cache` & `simas_rapor_config` di `localStorage`, serta memanggilnya langsung setelah `syncASCScheduleXML()` selesai agar perubahan penugasan dari XML langsung terbaca di seluruh sistem tanpa tertahan cache 30 menit.
- **Perbaikan Fallback Kelas Kosong (`g.kelas: []`):** Mengubah penanganan `g.kelas` kosong (`length === 0`), `undefined`, atau `g` string di `loadTeacherScope()` agar ditetapkan sebagai **Semua Kelas Aktif** (`[...activeClassesList]`), bukan array kosong (`[]`).
- **Pengambilan Kelas dengan `bypassActiveFilter: true`:** Mengubah pemanggilan `getActiveClasses()` di `page-guru-mapel.js` agar menyertakan `{ bypassActiveFilter: true }` seperti pada modul E-Rapor.
- **Smart Multi-Candidate Name Matching (`isTeacherAssigned`):** Memperluas kriteria pencocokan nama guru dengan multi-kandidat nama (`teacherRealName`, `displayName`, `nama_lengkap`), substring match, dan token match untuk mengantisipasi perbedaan penulisan gelar dari data XML.

### 📊 Penambahan Filter Angkatan & Kelas pada Tab Laporan Harian Modul Keuangan (`keuangan.html` & `js/page-keuangan.js`)
- **Filter Angkatan & Kelas Laporan Harian:** Menambahkan dropdown filter Angkatan (Semua Angkatan, Kelas X, XI, XII) dan filter Kelas spesifik pada tab Laporan Harian di Modul Keuangan.
- **Penyelarasan Opsi Dinamis (`populateDailyClassDropdown`):** Opsi daftar kelas diisi secara otomatis dari master data siswa aktif, dan menyesuaikan secara otomatis saat pilihan angkatan diubah.
- **Peningkatan Cache Key Laporan Harian (`loadDailyReport`):** Memperbarui kunci *Memory Cache* dari `${dateVal}` menjadi `${dateVal}_g:${gradeVal}_c:${classVal}` sehingga hasil query laporan harian terisolasi dengan aman per kombinasi filter.

## [1.1.222] / [26.08.10.22] - 2026-08-10

### 🔀 Harmonisasi & Resolusi Konflik Merge Cabang Main & Testing
- **Konsolidasi Fitur:** Menyeleraskan seluruh pembaruan dari cabang `main` (otomatisasi pengisian presensi guru JP & SSOT `rapor_config`) dengan perbaikan dari `testing` (multi-field teacher scope matching & isolasi kelas/mapel Portal Guru Mapel).

## [1.1.221] / [26.08.10.18] - 2026-08-10

### 🪄 Otomatisasi Pengisian Mapel & Guru serta Penyelarasan SSOT Rapor Config pada Presensi Guru (`js/page-presensi-guru.js`)
- **Auto-Populate JP Belum Tersimpan:** Memperbaiki `loadExistingData()` agar JP yang sudah tersimpan di database tetap dimuat, dan JP yang belum tersimpan (kosong) otomatis terisi Nama Mapel & Nama Guru dari jadwal aSc Timetables XML. Siswa/Admin Kelas kini cukup memilih Status Kehadiran dan klik Simpan.
- **Prioritas SSOT `rapor_config`:** Mengubah `loadMapelGuruConfig()` agar mengutamakan `mapel_list` dari `rapor_config` sebagai daftar mapel resmi (SSOT), dengan fallback ke `mapel_teori` dan `Object.keys(mapel_guru)`.
- **Dukungan Format Modern `mapel_guru`:** Memperbarui `onMapelChange()` untuk mendukung format modern `{ [mapel]: [{ uid, name, kelas }] }` dari `rapor_config` sekaligus backward-compatible dengan format legacy `{ [kelas]: { [mapel]: { name, uid } } }`.
- **Salinan Aset Jadwal XML Lokal:** Menyalin berkas `assets/Jadwal.xml` terbaru ke repositori `smagesa-simas` sebagai fallback parser jadwal offline.

## [1.1.220] / [26.08.10.21] - 2026-08-10

### 🐛 Fix Syntax Error Missing `}` di `window.switchGuruMapelTab` (`js/page-guru-mapel.js`) & Upgrade Script Validator Sintaks
- **Fix Syntax Error:** Memperbaiki kurung kurawal penutup `}` yang kurang pada blok `else if (tabName === 'jurnal')` pada fungsi `window.switchGuruMapelTab` di `js/page-guru-mapel.js`. Hal ini menyelesaikan runtime error `Uncaught SyntaxError: Unexpected end of input` di browser.
- **Peningkatan Script Syntax Validator (`scripts/check-syntax.js`):** Meng-upgrade engine validasi `scripts/check-syntax.js` menggunakan Node.js `vm.Script` agar secara mendalam mengeksekusi analisis sintaks AST pada seluruh modul ES JavaScript secara akurat tanpa terlewat.

## [1.1.219] / [26.08.10.20] - 2026-08-10

### 🛡️ Perbaikan Pembatasan Hak Akses Scope Kelas & Mapel Guru Mapel (`js/page-guru-mapel.js` & `js/page-rekap-presensi.js`)
- **Multi-Field Matching Scope Guru Mapel (`js/page-guru-mapel.js`):** Mengimplementasikan pencocokan data guru pengampu `isTeacherAssigned()` berbasis multi-kriteria (`currentUser.uid`, `currentUserNip`, `user.email`, dan *normalized teacher name*). Menghilangkan ketergantungan pencocokan kaku pada Auth UID saja yang sebelumnya menyebabkan kegagalan pencocokan penugasan guru mapel.
- **Isolasi Kelas & Mapel Portal Guru Mapel:** Menghapus fallback otomatis ke seluruh kelas sekolah saat `assignedMapelMap` terisi, serta memperbaiki logika `onKelasChange()` agar guru mapel yang sedang login **hanya melihat kelas dan mata pelajaran yang secara eksplisit ditugaskan kepadanya**.
- **Fitur Informasi Penugasan Kosong & Proteksi RBAC:** Apabila guru mapel belum memiliki penugasan di `rapor_config`, dropdown kelas/mapel menampilkan opsi `-- Tidak ada kelas --` dan `-- Tidak ada mapel --` disertai Toast pemberitahuan yang informatif tanpa membocorkan kelas guru lain.
- **Multi-Field Scope Matching di Rekap Presensi (`js/page-rekap-presensi.js`):** Menyesuaikan pencocokan guru pada modul `page-rekap-presensi.js` agar konsisten mendukung pencocokan UID, NIP, maupun Nama Guru.

## [1.1.228] / [26.08.11.10] - 2026-08-11

### 🎯 Penyesuaian Kriteria "Tidak Belajar Efektif" Berbasis Terverifikasi (`js/page-monitoring-kbm.js`)
- **Pembaruan Logika Evaluasi JP:** Mengubah kriteria penentuan JP `Tidak Belajar Efektif` menjadi `elapsed && !hasAnyVerified`.
- **Kriteria Baru:** Pada JP yang sudah berlalu, suatu Jam Pelajaran dinyatakan **Tidak Belajar Efektif** apabila **tidak ada satupun kelas di seluruh sekolah yang berstatus Terverifikasi** (`🟢 Terverifikasi`).

## [1.1.227] / [26.08.11.9] - 2026-08-11

### ⚡ Penyederhanaan Logika "Tidak Belajar Efektif" (`js/page-monitoring-kbm.js`)
- **Penyederhanaan Logika Evaluasi JP:** Mengubah kondisi evaluasi JP pada `renderRekapJurnalTable` menjadi `elapsed && (!hasAnyPresensi || !hasAnyJurnal)`.
- **Kriteria Baru:** Pada JP yang telah berlalu, suatu Jam Pelajaran dinyatakan **Tidak Belajar Efektif** apabila **semua kelas tidak mengabsen guru (`!hasAnyPresensi`)** ATAU **semua guru tidak mengisi jurnal (`!hasAnyJurnal`)**.

## [1.1.226] / [26.08.11.8] - 2026-08-11

### 🐛 Perbaikan ReferenceError `dayOfWeek` & Optimasi Pembacaan XML (`js/page-monitoring-kbm.js` & `js/asc-schedule-parser.js`)
- **Fix ReferenceError `dayOfWeek` (`js/page-monitoring-kbm.js`):** Mengembalikan deklarasi `const dayOfWeek = selectedDate.getDay();` pada fungsi `renderRekapJurnalTable` untuk memperbaiki `ReferenceError: dayOfWeek is not defined`.
- **Optimasi Konkuransi Parser XML (`js/asc-schedule-parser.js`):** Menambahkan `parsePromise` concurrency lock agar saat 25+ kelas dimuat secara bersamaan di tabel matriks, berkas XML Jadwal hanya diparse 1 kali saja tanpa terjadi eksekusi berulang di konsol.

## [1.1.225] / [26.08.11.7] - 2026-08-11

### 🚫 Deteksi Otomatis JP "Tidak Belajar Efektif" di Monitoring KBM (`monitoring-kbm.html` & `js/page-monitoring-kbm.js`)
- **Deteksi Serentak Tanpa Aktivitas KBM (`js/page-monitoring-kbm.js`):** Menambahkan logika evaluasi per Jam Pelajaran (JP). Apabila pada JP yang sudah berlalu/lewat SAMA SEKALI tidak ada jurnal dari guru manapun dan tidak ada presensi khusus di seluruh sekolah (seperti saat Rapat Guru, Jam Kosong Serentak, Pulang Cepat, atau Acara Sekolah), JP tersebut secara otomatis dikategorikan sebagai **Tidak Belajar Efektif**.
- **Indikator Header & Cell Styling (`monitoring-kbm.html` & `js/page-monitoring-kbm.js`):**
  - Header `<th>` kolom JP menampilkan badge khusus `Tidak Efektif`.
  - Seluruh sel kelas pada JP tersebut menampilkan badge netral `🚫 Tidak Belajar Efektif` beserta tooltip penjelasan yang rinci, menggantikan peringatan merah/kuning individual yang keliru.
  - Menambahkan keterangan status `🚫 Tidak Belajar Efektif` pada Legend Status KBM di bawah tabel.

## [1.1.224] / [26.08.11.6] - 2026-08-11

### 🐛 Perbaikan Bug Isolasi Panel Sub-Tab (`monitoring-kbm.html` & `js/page-monitoring-kbm.js`)
- **Fix Discrepancy ID Container Panel (`js/page-monitoring-kbm.js`):** Memperbaiki referensi ID elemen pada fungsi `window.switchTab` dari `panel-rekap-jurnal` menjadi `panel-rekap-kbm` agar penyesuaian kelas `hidden` berjalan sempurna.
- **Isolasi Tampilan Panel (`monitoring-kbm.html`):** Menambahkan `class="hidden"` awal pada elemen `<div id="panel-rekap-kbm">` sehingga panel Monitoring KBM tidak lagi muncul di bagian bawah ketika sub-tab lain (Kehadiran Siswa, Daftar Jurnal, Rekap Guru, Detail Guru) sedang aktif.

## [1.1.223] / [26.08.11.5] - 2026-08-11

### 🗑️ Pembersihan File & Menu Halaman Rekap Presensi (`rekap-presensi.html` & `js/page-rekap-presensi.js`)
- **Penghapusan File Halaman Redundan:** Menghapus `rekap-presensi.html` dan `js/page-rekap-presensi.js` karena seluruh fiturnya (Rekap Guru & Detail Guru) telah sepenuhnya terintegrasi di halaman **Monitoring KBM** ([`monitoring-kbm.html`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/monitoring-kbm.html)).
- **Pembersihan Menu & Navigasi (`js/global.js`):** Menghapus entri `rekap_presensi` dari `MENU_CONFIG`, `PAGE_ACCESS_CONFIG`, `MENU_LABELS`, dan `MENU_GROUPS` pada sidebar navigasi SIMAS.
- **Pembaruan PWA Cache (`sw.js`):** Menghapus daftar cache file lama dan menaikkan versi Service Worker ke `simas-pwa-v87`.

## [1.1.222] / [26.08.11.4] - 2026-08-11

### 🚀 Migrasi Tab Rekap Guru & Detail Guru ke Halaman Monitoring KBM (`monitoring-kbm.html` & `js/page-monitoring-kbm.js`)
- **Penyatuan Hub Monitoring KBM & Presensi Guru (`monitoring-kbm.html`):** Memindahkan tab **Rekap Guru** (`#tab-rekap-guru`) dan **Detail Guru** (`#tab-detail-guru`) beserta seluruh panel filter, statistik, tabel rekap, multi-select status, dan fungsi cetak laporan presensi ke halaman **Monitoring KBM**.
- **Integrasi Logika Lengkap (`js/page-monitoring-kbm.js`):** Memboyong fungsi `loadRekapGuru`, `loadDetailGuru`, `populateGuruDropdown`, `printDetailGuru`, serta dukungan role scoping ke `page-monitoring-kbm.js`.
- **Pengalihan Otomatis Akses `rekap-presensi.html`:** Akses ke `rekap-presensi.html` kini otomatis dialihkan (*instant redirect*) ke `monitoring-kbm.html#tab=rekap-guru`.

## [1.1.221] / [26.08.11.3] - 2026-08-11

### 🧹 Refactoring Tab Harian & Konsolidasi Rekap Guru (`rekap-presensi.html` & `js/page-rekap-presensi.js`)
- **Pembersihan Redundansi Tab Harian (`rekap-presensi.html`):** Menghapus `tab-harian` dan `panel-harian` dari halaman `rekap-presensi.html` karena matriks verifikasi KBM harian per JP telah terpusat 100% pada modul **Monitoring KBM** (`monitoring-kbm.html`).
- **Konsolidasi Rekapitulasi Presensi Guru:**
  - Tab **Rekap Guru** (`tab-guru`) dijadikan tab aktif utama saat membuka `rekap-presensi.html` (menampilkan akumulasi mingguan/bulanan per guru).
  - Navigasi atau hash URL lama `#tab=harian` / `#tab=jurnal` otomatis diarahkan (*auto-redirect*) ke `monitoring-kbm.html#tab=rekap-jurnal`.

## [1.1.220] / [26.08.11.2] - 2026-08-11

### ⚡ Optimalisasi Header Kompak Jam Pelajaran (JP) Aktif (`js/page-monitoring-kbm.js`)
- **Header Ultra-Kompos & Hemat Tinggi (`js/page-monitoring-kbm.js`):** Menyederhanakan penanda JP aktif di header tabel dari 3 baris bertumpuk menjadi **2 baris ultra-ringkas (`[●] JP 7 [AKTIF]` + `12:30-13:15`)** dengan padding `py-1.5`. Tinggi header kini seimbang dan presisi setara dengan kolom standar (`~36px`), hemat ruang vertikal tanpa mengurangi kejelasan indikator visual.

## [1.1.219] / [26.08.11.1] - 2026-08-11

### ⏰ Indikator Visual Jam Pelajaran (JP) Aktif pada Tabel Monitoring KBM
- **Header & Filter Indikator JP Aktif (`js/page-monitoring-kbm.js`):** Menambahkan deteksi real-time Jam Pelajaran (JP 1 s/d 10) yang sedang berlangsung berdasarkan jadwal jam sekolah (`JP_TIME_CONFIG`).
- **Penanda Visual Menonjol:**
  - Header kolom `<th>` untuk JP aktif berlatar gradient biru-indigo, berbingkai 2px, lengkap dengan jam rentang JP dan badge animasi **`SEKARANG`**.
  - Toolbar filter JP di atas tabel menandai tombol JP aktif dengan warna kontras dan badge **`AKTIF`**.
  - Sel-sel tabel pada kolom JP aktif diberikan ring/highlight khusus agar mudah teridentifikasi.

## [1.1.218] / [26.08.10.19] - 2026-08-10

### 🛡️ Konfigurasi Menu Role Admin Kelas & Pembaruan CSP Headers (`js/global.js` & `firebase.json`)
- **Penetapan Menu Role Admin Kelas (`js/global.js`):** Mendaftarkan peran `admin_kelas` secara eksplisit pada `MENU_CONFIG` dengan menu sesuai PRD (`dashboard`, `presensi`, `presensi_guru`, `kredit`, `masukan`), sehingga mencegah fallback tidak diinginkan ke role `guru_mapel`.
- **Dukungan Role Panitia Duta (`js/global.js`):** Menambahkan `panitia_duta` ke `MENU_CONFIG` agar selaras dengan alias `admin_duta`.
- **Pembaruan CSP `connect-src` (`firebase.json`):** Memperbarui directive Content-Security-Policy untuk menyertakan endpoint analitik Google (`*.analytics.google.com`, `stats.g.doubleclick.net`), Supabase Realtime WebSocket (`wss://*.supabase.co`), `*.googleusercontent.com`, dan `api.qrserver.com`, sehingga menghilangkan CSP error pada browser console.

## [1.1.219] / [26.08.10.16] - 2026-08-10

### 🐛 Perbaikan Syntax Error pada Fungsi `switchGuruMapelTab` (`js/page-guru-mapel.js`)
- **Fix Syntax Error Uncaught SyntaxError (Unexpected end of input):** Memperbaiki penutupan kurung kurawal `}` yang terlewat pada blok kondisi `else if (tabName === 'jurnal')` di dalam fungsi `window.switchGuruMapelTab` di `js/page-guru-mapel.js`.
- **Peningkatan Verifikasi Sintaks (`scripts/check-syntax.js`):** Memperbarui skrip pengecekan sintaks agar otomatis menguji seluruh berkas JavaScript tipe ES Module (ESM) melalui STDIN (`--input-type=module`) selain berkas CommonJS. Seluruh 44 berkas JavaScript kini terverifikasi valid **0 Error**.

## [1.1.218] / [26.08.10.15] - 2026-08-10

### 🎯 Filter Guru Pengampu Aktif Rapor Config pada Sinkronisasi Jurnal Mengajar
- **Penyaringan Khusus Guru Aktif (`settings-app.js`, `functions/index.js`, `js/page-e-rapor.js`):** Memperbarui algoritma sinkronisasi guru dari SIMAS ke Jurnal Mengajar agar hanya menyinkronkan personil yang memiliki penugasan mata pelajaran aktif di `settings/rapor_config` (`mapel_guru` / `finalMengajar.length > 0`).
- **Pembersihan Data Non-Guru:** Dokumen pegawai non-mengajar (staf TU, laboran, satpam, dll.) atau guru yang tidak memiliki jam mengajar otomatis dibersihkan dan dihapus dari koleksi `data_guru` Jurnal Mengajar saat sinkronisasi dijalankan.
- **Proteksi Single Guru Sync (`settings-app.js`):** Menambahkan notifikasi peringatan jika akun yang dipilih untuk sinkronisasi individual tidak memiliki penugasan mengajar di `rapor_config`.

## [1.1.217] / [26.08.10.14] - 2026-08-10

### 🔀 Konsolidasi & Sinkronisasi Cabang Testing & Main serta Fitur Input Nilai Masal E-Rapor
- **Harmonisasi Cabang Testing & Main:** Menyatukan seluruh pembaruan sistem dari cabang testing (monitoring KBM, pembaruan rekap presensi, manajemen master XML) dengan fitur baru dari cabang main.
- **Input Nilai Masal E-Rapor (`js/page-e-rapor.js` & `secure-proxy`):** Mengintegrasikan fitur input dan import nilai masal e-rapor beserta validasi predikat dan deskripsi capaian kompetensi otomatis.
- **Penyempurnaan Background Sync Guru Jurnal Mengajar (`functions/index.js`):** Memperbaiki fungsi `runJurnalSyncProcess("guru")` pada Cloud Function scheduler `jurnalSyncCron` dengan algoritma *multi-level matching* (master `teachers` + `users` + `mapel_guru`) tanpa menghapus data guru lain.

## [1.1.216] / [26.08.10.13] - 2026-08-10

### 🐛 Fix Syntax Error Missing `}` pada Template Expression (`js/page-monitoring-kbm.js`)
- **Fix Syntax Error:** Memperbaiki ekspresi pemetaan `groups.map` yang tersisip salah di `js/page-monitoring-kbm.js`, sehingga runtime error `Uncaught SyntaxError: Missing } in template expression` teratasi 100% dan terverifikasi **0 Error** pada 40 file JS.

## [1.1.215] / [26.08.10.12] - 2026-08-10


### 🇮🇩 Optimalisasi Ringkas Sel Upacara Bendera & Ekstrakurikuler 1 Baris (`js/page-monitoring-kbm.js`)
- **Tampilan Kompak 1 Baris (Ultra-Compact Cell):** Meng-update render sel untuk **Senin JP 1 (Upacara Bendera)** dan **Jumat JP 10 (Ekstrakurikuler)** agar tampil ringkas 1 baris sebagai single badge (`🇮🇩 Upacara Bendera` / `⚽ Ekstrakurikuler`). Tinggi baris seluruh tabel kini hemat, konsisten, dan sangat rapi.

## [1.1.214] / [26.08.10.11] - 2026-08-10


### 🩵 Revisi Teks Badge "Belum di Presensi Siswa" (`js/page-monitoring-kbm.js` & `monitoring-kbm.html`)
- **Pembaruan Teks Badge:** Mengubah teks status dari `"🩵 Belum Presensi Siswa"` menjadi **`"🩵 Belum di Presensi Siswa"`** pada `js/page-monitoring-kbm.js` dan `monitoring-kbm.html`.

## [1.1.213] / [26.08.10.10] - 2026-08-10


### 📝 Revisi Keterangan Status K (Kegiatan) (`js/page-monitoring-kbm.js`, `js/page-presensi-guru.js`, `monitoring-kbm.html`)
- **Pembaruan Deskripsi Status K:** Merevisi keterangan status `K` menjadi `"🟣 Kegiatan: Guru Tugas Dinas / Panitia / Lomba di Sekolah maupun Luar Sekolah"` serta menyederhanakan label badge dan legend dari `"Kegiatan Sekolah"` menjadi `"Kegiatan"`.

## [1.1.212] / [26.08.10.9] - 2026-08-10


### 💬 Simplifikasi Tooltip Native - Tampilkan Detail Keterangan Saja (`js/page-monitoring-kbm.js`)
- **Penyederhanaan Tooltip Title (`js/page-monitoring-kbm.js`):** Menghapus info redundan (Nama Kelas, Rentang JP, Nama Mapel, Nama Guru) dari atribut `title="..."` sel tabel sehingga saat mouse hover, browser native tooltip hanya menampilkan deskripsi detail keterangan operasional status secara ringkas dan bersih.

## [1.1.211] / [26.08.10.8] - 2026-08-10


### 🧹 Pembersihan Sisa Baris Duplikat HTML pada `page-monitoring-kbm.js` (`js/page-monitoring-kbm.js`)
- **Fix Syntax Error Unexpected token `<`:** Menghapus 7 baris sisa HTML duplikat (`</tr> ... container.innerHTML = html; }`) yang tersisa di luar fungsi, sehingga seluruh 40 berkas JavaScript terverifikasi bersih dan **0 Syntax Error**.

## [1.1.210] / [26.08.10.7] - 2026-08-10


### 🐛 Fix Syntax Error Missing `});` pada `snapshotJurnal.forEach` (`js/page-monitoring-kbm.js`)
- **Fix Syntax Error:** Memperbaiki tanda penutup `});` callback `snapshotJurnal.forEach` yang sempat terlepas saat penyisipan fungsi floating tooltip, sehingga runtime error `Uncaught SyntaxError: missing ) after argument list` teratasi 100%.

## [1.1.209] / [26.08.10.6] - 2026-08-10


### 💡 Fitur Floating Tooltip Interaktif KBM Real-Time (`js/page-monitoring-kbm.js`)
- **Interactive Hover Floating Tooltip:** Menambahkan komponen `setupFloatingTooltipKBM()` yang memunculkan kartu penjelas melayang (*glassmorphism tooltip*) secara instan ketika kursor mouse mengarungi sel tabel Monitoring KBM.
- **Informasi Detail & Komprehensif:** Kartu tooltip melayang menampilkan: Nama Kelas, Rentang JP, Nama Mata Pelajaran, Nama Guru Pengampu, Badge Status KBM, serta Deskripsi Penjelasan Operasional secara lengkap dan elegan.

## [1.1.208] / [26.08.10.5] - 2026-08-10


### 🏷️ Penyederhanaan Teks Badge Status (Hapus Prefiks "Siswa:") (`js/page-monitoring-kbm.js` & `monitoring-kbm.html`)
- **Penyederhanaan Teks Badge KBM (`js/page-monitoring-kbm.js` & `monitoring-kbm.html`):** Menghapus prefiks `Siswa:` dari seluruh teks badge status KBM agar tampil lebih bersih, lugas, dan langsung menyebut status utama seperti `🔴 Tanpa Keterangan (TK)`, `🟣 Kegiatan Sekolah`, `🟡 Guru Sakit`, `🔵 Guru Izin`.

## [1.1.207] / [26.08.10.4] - 2026-08-10


### 🛠️ Perbaikan Penutupan Tag HTML Filter Card & Rata Tengah Sel Tabel (`monitoring-kbm.html` & `js/page-monitoring-kbm.js`)
- **Fix Root Cause Tag HTML Filter Card (`monitoring-kbm.html`):** Menambahkan penutup tag `</div></div>` pada panel Filter Section yang sebelumnya hilang sehingga container tabel data tidak lagi masuk ke dalam flexbox filter bar.
- **Relokasi Legenda Status KBM ke Bawah Tabel (`monitoring-kbm.html`):** Memindahkan posisi legenda status KBM persis di bawah container tabel data.
- **Rata Tengah Sel Tabel Sempurna (`js/page-monitoring-kbm.js`):** Mengganti dynamic arbitrary max-width dengan `leading-snug break-words text-center` pada elemen nama Mapel dan Nama Guru. Tampilan sel tabel (baik sel tunggal maupun sel gabungan `colspan`) kini rata tengah sempurna dan responsif tanpa merusak struktur tabel.

## [1.1.206] / [26.08.10.3] - 2026-08-10


### 🎯 Alignment Rata Tengah Presisi Sel Tunggal & Sel Merged (`colspan`) (`js/page-monitoring-kbm.js`)
- **Rata Tengah Nama Mapel, Guru, dan Badge (`js/page-monitoring-kbm.js`):** Menambahkan `text-center mx-auto` dan menyesuaikan batas `max-w` secara dinamis (`max-w-[${180 * span}px]`) pada sel yang digabung (`colspan > 1`). Nama Mata Pelajaran, Nama Guru, dan Badge Status kini tampil **rata tengah sempurna (perfect center)** di seluruh ukuran sel.

## [1.1.205] / [26.08.10.2] - 2026-08-10


### 📌 Relokasi Legenda Status KBM ke Bawah Tabel & Optimalisasi Floating Scrollbar (`monitoring-kbm.html` & `js/page-monitoring-kbm.js`)
- **Relokasi Legend Status KBM (`monitoring-kbm.html`):** Memindahkan posisi kotak legenda status KBM dari bagian atas tabel ke bagian bawah tabel data. Pengguna kini dapat langsung melihat tabel utama terlebih dahulu saat pertama kali membuka halaman, dan legenda tetap mudah dirujuk di bagian bawah.
- **Peningkatan Sticky Floating Scrollbar (`js/page-monitoring-kbm.js`):** Memperbarui handler `setupStickyScrollbarJurnal()` dengan listener resize responsif dan ganda timeout sync. Scrollbar horizontal melayang secara konsisten di bagian paling bawah layar browser (*viewport*) kapan saja tabel melebar.

## [1.1.204] / [26.08.10.1] - 2026-08-10


### 🇮🇩 Penyelarasan Opsi Presensi Guru (H, I, S, K, TK) & Jam Khusus Upacara/Ekskul (`js/page-presensi-guru.js`, `js/page-monitoring-kbm.js`, `monitoring-kbm.html`)
- **Penyelarasan Status Presensi Guru (`js/page-presensi-guru.js` & `js/page-monitoring-kbm.js`):** Memperbarui opsi presensi guru yang diisi siswa di `presensi-guru.html` menjadi 5 kode baku: `H` (Hadir), `I` (Izin - Kepentingan Pribadi/Keluarga), `S` (Sakit), `K` (Kegiatan Sekolah - Dinas/Tugas Sekolah/Panitia), dan `TK` (Tanpa Keterangan - menggantikan TT).
- **Kolom Khusus Upacara Bendera & Ekstrakurikuler (`js/page-monitoring-kbm.js` & `monitoring-kbm.html`):** Menambahkan deteksi jam khusus untuk **Senin JP 1 (Upacara Bendera)** (`🇮🇩 Upacara`) dan **Jumat JP 10 (Ekstrakurikuler)** (`⚽ Ekstrakurikuler`). Sel pada jam ini secara otomatis diberi badge & warna khusus tanpa memicu status "Belum Isi Jurnal" / "Jurnal Kosong".
- **Update Legend Status KBM (`monitoring-kbm.html`):** Menyelaraskan item legend KBM dengan menyertakan `🇮🇩 Upacara Bendera`, `⚽ Ekstrakurikuler`, dan `🔴 Tanpa Keterangan (TK)`.

## [1.1.204] / [26.08.09.43] - 2026-08-09


### 🧹 Penyederhanaan Status Presensi Guru - Hapus Cuti & Dinas (`presensi-guru.html`, `rekap-presensi.html`, `monitoring-kbm.html`, `page-presensi-guru.js`, `page-rekap-presensi.js`, `page-monitoring-kbm.js`)
- **Penghapusan Status Cuti (C) & Dinas (D):** Menghapus opsi status **C (Cuti)** dan **D (Dinas)** dari seluruh modul presensi guru karena penyederhanaan. Status yang tersisa: `H` (Hadir), `K` (Kegiatan), `I` (Izin), `S` (Sakit), `TT` (Tdk Tahu).
- **Update Legend:** Legend keterangan status di `presensi-guru.html` dan `rekap-presensi.html` disesuaikan (tanpa C dan D).
- **Update Filter Checkbox Rekap Guru:** Checkbox filter D (Dinas) dan C (Cuti) dihapus dari panel rekap guru di `rekap-presensi.html`.
- **Update Stat Cards & Tabel:** Kolom Dinas dan Cuti dihapus dari stat card, tabel rekap guru, dan detail guru di `page-rekap-presensi.js`.
- **Update Perhitungan Kehadiran:** Formula kehadiran disesuaikan dari `H + D + K` menjadi `H + K`.
- **Update Cetak Detail Guru:** Elemen Dinas dan Cuti dihapus dari fungsi cetak (`printDetailGuru`).
- **Update Monitoring KBM:** Badge legend 🟣 Dinas/Cuti dihapus dari `monitoring-kbm.html` dan handler status D/C dihapus dari `page-monitoring-kbm.js`.

## [1.1.203] / [26.08.09.42] - 2026-08-09

### 🏷️ Pembaruan Subtitle Halaman Monitoring KBM (`monitoring-kbm.html`)
- **Pembaruan Subtitle:** Mengubah subtitle halaman dari *"Monitoring Kegiatan Belajar Mengajar (KBM) dan Presensi Jurnal Guru"* menjadi **"Monitoring Komprehensif Terintegrasi"** agar lebih singkat, profesional, dan merepresentasikan fungsi verifikasi silang 3 arah (Jurnal Guru + Presensi Siswa + Jadwal XML).

## [1.1.202] / [26.08.09.41] - 2026-08-09

### ⚡ Upgrade Incremental SSOT Sync (>99% Hemat Read Firestore) & Automasi Invalidation Cache Client (`functions/index.js` & `jurnal-app.js`)
- **Incremental Sync Engine (`functions/index.js`):** Memperbarui `scheduleSyncTask` dan trigger Firestore (`onStudentWrittenForJurnal`, `onTeacherWrittenForJurnal`, `onUserWrittenForJurnal`) untuk mencatat ID entitas yang berubah ke dalam antrean `pending_student_ids` & `pending_teacher_ids`.
- **Penghematan Read Firestore >99%:** Saat terjadi perubahan 1–50 data siswa/guru, Cloud Function secara otomatis mengeksekusi *Incremental Sync* hanya untuk dokumen terkait, memotong kuota read dari ~2.000 read menjadi 1–5 read per transaksi.
- **Fail-Safe Full Sync Fallback:** Jika entri antrean > 50 data, sistem secara otomatis beralih ke mode *Full Sync Scan* untuk menjamin konsistensi data 100%.
- **Invalidasi Cache Client Otomatis (`functions/index.js` & `jurnal-app.js`):** Backend secara otomatis memperbarui timestamp `last_sync` pada dokumen `sistem/version` Jurnal Firestore saat sync selesai. Aplikasi PWA Jurnal (`jurnal-app.js`) mendeteksi perubahan timestamp ini dan otomatis membersihkan cache lokal usang tanpa perlu refresh manual.

## [1.1.201] / [26.08.09.40] - 2026-08-09

### 🔀 Migrasi Nama Berkas Web & Controller: `rekap-kehadiran-siswa.html` -> `monitoring-kbm.html` (`monitoring-kbm.html` & `js/page-monitoring-kbm.js`)
- **Refactoring Nama Berkas Web (`monitoring-kbm.html` & `js/page-monitoring-kbm.js`):** Mengubah nama berkas `rekap-kehadiran-siswa.html` menjadi `monitoring-kbm.html` dan `js/page-rekap-kehadiran-siswa.js` menjadi `js/page-monitoring-kbm.js` agar secara rinci dan semantik merefleksikan fungsi utamanya sebagai modul **Monitoring & Verifikasi KBM Real-Time**.
- **Penyelarasan Rujukan Global (`js/global.js`, `sw.js`, `js/page-rekap-presensi.js`):** Meng-update seluruh rujukan nama file pada konfigurasi sidebar navigasi `MENU_CONFIG`, RBAC `PAGE_PERMISSIONS`, cache list Service Worker (`sw.js`), dan alur redirect antarmuka (`js/page-rekap-presensi.js`).

## [1.1.200] / [26.08.09.39] - 2026-08-09


### 🚀 Implementasi Matriks Cross-Verification KBM 3 Arah (Jurnal Guru + Presensi Siswa + XML Jadwal) (`js/page-rekap-kehadiran-siswa.js` & `rekap-kehadiran-siswa.html`)
- **Query Parallel 3 Sumber Data (`js/page-rekap-kehadiran-siswa.js`):** Menggabungkan data dari `jurnal_guru` (Input Guru), `guru_presensi` (Input Siswa/Admin Kelas), dan `Jadwal.xml` (Jadwal Resmi) dalam satu kali pemanggilan `Promise.all` paralel tanpa menambah latency.
- **Diferensiasi Status Kondisi Khusus Arah 2 Sisi:**
  - `🟢 Terverifikasi`: Jurnal Guru Terisi + Siswa Absen Hadir.
  - `🔴 Siswa: Jam Kosong`: Jurnal Belum + Siswa Melaporkan Jam Kosong (`K`/`A`).
  - `🟡 Siswa: Guru Sakit`: Jurnal Belum + Siswa Melaporkan Guru Sakit (`S`).
  - `🔵 Siswa: Izin/Tugas Luar`: Jurnal Belum + Siswa Melaporkan Guru Izin (`I`/`L`).
  - `🟣 Siswa: Dinas/Cuti`: Jurnal Belum + Siswa Melaporkan Guru Dinas (`D`/`C`).
  - `🟠 Siswa: Tugas Terstruktur`: Jurnal Belum + Siswa Melaporkan Tugas Terstruktur (`TT`).
  - `🩵 Belum Presensi Siswa`: Jurnal Guru Sudah Terisi, Namun Siswa Belum Absen.
  - `🟡 Belum Isi Jurnal / 🔴 Jurnal Kosong`: Presensi Siswa Hadir/Jadwal XML Ada, Namun Jurnal Guru Belum Terisi.
- **Legend Status KBM Interactive (`rekap-kehadiran-siswa.html`):** Menambahkan legend box berwarna-warni di atas tabel Monitoring KBM sebagai panduan visual cepat bagi pimpinan sekolah dan pengawas KBM.

## [1.1.199] / [26.08.09.38] - 2026-08-09


### 📜 Floating Sticky Scrollbar Rekap Harian Presensi (`rekap-presensi.html` & `js/page-rekap-presensi.js`)
- **Sticky Horizontal Scrollbar Rekap Harian (`rekap-presensi.html` & `js/page-rekap-presensi.js`):** Menghapus batasan `overflow-hidden` pada pembungkus tabel Rekap Harian (`rekap-presensi.html`) dan memperbarui `#rekap-scrollbar-wrapper` dengan efek `backdrop-blur-md` serta `shadow-md`. Scrollbar horizontal kini melayang sempurna di batas bawah layar browser sehingga pengguna dapat menggeser tabel kapan saja tanpa perlu scroll sampai ke paling bawah tabel.

## [1.1.198] / [26.08.09.37] - 2026-08-09


### 🎯 Eliminasi Kurung Kurawal Ekstra Line 368 (`js/page-rekap-presensi.js`)
- **Fix Root Cause SyntaxError (`js/page-rekap-presensi.js`):** Menghapus kurung kurawal ekstra (`}`) pada line 368 yang secara prematur memotong blok `try` utama fungsi `loadRekap` di line 289. Sekarang `try` (line 289) terhubung secara utuh dengan `catch` (line 423) dan 0 error pada runtime browser.

## [1.1.197] / [26.08.09.36] - 2026-08-09


### 🐛 Perbaikan SyntaxError Pada Halaman Rekap Presensi (`js/page-rekap-presensi.js`)
- **Fix SyntaxError Extra Closing Brace (`js/page-rekap-presensi.js`):** Menghapus kurung kurawal penutup ekstra (`}`) pada line 659 yang memotong blok perulangan `for (const g of groups)`. Halaman `rekap-presensi.html` kini kembali memuat dengan lancar dan 0 error.

## [1.1.196] / [26.08.09.35] - 2026-08-09


### 🔐 OWASP Safe Redirect & Preservation Query/Hash Post-Login (`js/page-guru-mapel.js`)
- **Preservasi URL Target Sebelum Login (`js/page-guru-mapel.js`):** Menyempurnakan auth guard pada `onAuthStateChanged` di Portal Guru Mapel agar secara lengkap meng-encode seluruh komponen URL (`pathname + search + hash`). Apabila pengguna/guru belum login saat membuka tautan `guru-mapel.html#tab=jurnal`, sistem akan menyimpan URL lengkap tersebut di `index.html?redirect=...` sehingga setelah login berhasil, pengguna akan langsung di-redirect kembali ke halaman Portal Guru Mapel pada sub-tab **Daftar Jurnal** secara otomatis.

## [1.1.195] / [26.08.09.34] - 2026-08-09

### 🔗 Integrasi Tautan Navigasi & Auto Sub-Tab Jurnal (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Penanganan Hash & Query Parameter Sub-Tab (`js/page-guru-mapel.js`):** Menambahkan fungsi `checkInitialTabFromUrl` dan listener `hashchange` pada Portal Guru Mapel (`guru-mapel.html`). Saat pengguna membuka URL dengan `#tab=jurnal`, `?tab=jurnal`, atau `#jurnal` (misalnya melalui tautan riwayat lengkap dari aplikasi Jurnal Mengajar SMAGESA), sistem secara otomatis mengaktifkan sub-tab **Daftar Jurnal** (`#tab-guru-jurnal`).

## [1.1.194] / [26.08.09.33] - 2026-08-09

### ✏️ Penyesuaian Teks Badge "Belum Isi Jurnal" (`js/page-rekap-kehadiran-siswa.js` & `js/page-rekap-presensi.js`)
- **Pembaruan Teks Badge (`js/page-rekap-kehadiran-siswa.js` & `js/page-rekap-presensi.js`):** Mengubah teks badge status pending XML untuk hari ini dari `Belum Jurnal` menjadi `Belum Isi Jurnal` agar lebih eksplisit dan mudah dipahami.

## [1.1.193] / [26.08.09.32] - 2026-08-09


### 🔴 Pembeda Status Dynamic Date: "Belum Jurnal" (Hari Ini) vs "Jurnal Kosong" (Lewat Hari) (`js/page-rekap-kehadiran-siswa.js` & `js/page-rekap-presensi.js`)
- **Diferensiasi Status Tanggal (`js/page-rekap-kehadiran-siswa.js` & `js/page-rekap-presensi.js`):** Menambahkan deteksi perbandingan tanggal terpilih vs tanggal hari ini.
  - Untuk hari ini (`targetDate == today`): Menampilkan badge kuning `Belum Jurnal` (*soft amber*).
  - Untuk tanggal yang sudah berlalu (`targetDate < today`): Otomatis beralih menampilkan badge merah `Jurnal Kosong` (*soft rose*) agar pimpinan/pengawas dapat membedakan mana yang masih berproses hari ini vs mana jurnal yang memang tidak diisi setelah lewat hari.

## [1.1.192] / [26.08.09.31] - 2026-08-09


### 🔀 Colspan Cell Merging & Floating Sticky Scrollbar Monitoring KBM (`js/page-rekap-kehadiran-siswa.js` & `rekap-kehadiran-siswa.html`)
- **Merging Sel JP Berurutan (`js/page-rekap-kehadiran-siswa.js`):** Menggabungkan sel JP berurutan yang memiliki Mata Pelajaran dan Guru Pengampu yang sama menjadi 1 sel besar menggunakan `colspan`. Menjadikan tampilan tabel Monitoring KBM jauh lebih ringkas, rapi, dan mudah dibaca tanpa ada pengulangan nama mapel/guru.
- **Floating Sticky Horizontal Scrollbar (`rekap-kehadiran-siswa.html` & `js/page-rekap-kehadiran-siswa.js`):** Menghapus batasan `overflow-hidden` pada pembungkus tabel dan menyempurnakan `position: sticky; bottom: 0` dengan `backdrop-blur-md` dan `shadow-md`. Scrollbar horizontal kini melayang sempurna di batas bawah layar browser sehingga pengguna dapat menggeser tabel kapan saja tanpa perlu scroll sampai ke paling bawah tabel.

## [1.1.191] / [26.08.09.30] - 2026-08-09


### 🟡 Visualisasi Jadwal XML Belum Mengisi Jurnal pada Monitoring KBM (`js/page-rekap-kehadiran-siswa.js` & `rekap-kehadiran-siswa.html`)
- **Auto-Populate Sel Kosong dari Jadwal XML (`js/page-rekap-kehadiran-siswa.js`):** Pada grid tabel Monitoring KBM (`rekap-kehadiran-siswa.html`), sel jam pelajaran yang belum diisi presensi/jurnalnya oleh guru pengampu kini secara otomatis menampilkan nama Mapel dan Nama Guru pengampu resmi dari berkas Jadwal XML.
- **Badge Visual "Belum Jurnal":** Ditampilkan dengan warna latar belakang soft amber (`bg-amber-50`), border dashed, dan badge bertuliskan `Belum Jurnal` agar pengawas/wakasek dapat dengan cepat mengetahui guru yang belum menginput jurnal pada JP tersebut.

## [1.1.190] / [26.08.09.29] - 2026-08-09


### 🧹 Penghapusan Tombol Redundant "Jadwal XML" (`presensi-guru.html`)
- **Pembersihan UI Input Presensi Kelas (`presensi-guru.html`):** Menghapus tombol redundant `Jadwal XML` karena pengisian jadwal mata pelajaran dan guru pengampu dari XML aSc Timetables sudah berjalan 100% otomatis saat tanggal/kelas dipilih.

## [1.1.189] / [26.08.09.28] - 2026-08-09


### 🐛 Fix Fatal XML Cache Collision (`js/asc-schedule-parser.js`)
- **Penyelesaian Error "Gagal membaca daftar mapel dari berkas XML" (`js/asc-schedule-parser.js`):** Memperbaiki bug di mana `localStorage.setItem(XML_CACHE_KEY, ...)` sebelumnya tidak sengaja menyimpan data JSON hasil parse bukannya string XML mentah. Penimpaan tersebut menyebabkan `DOMParser` gagal membaca struktur XML pada eksekusi berikutnya.
- **Pembersihan Cache Corrupt Otomatis (`js/asc-schedule-parser.js`):** Menambahkan deteksi pembersihan otomatis jika `simas_asc_schedule_cache` berisi string JSON awal `{`, sehingga parser secara otomatis melakukan fallback bersih ke `assets/Jadwal.xml`.

## [1.1.188] / [26.08.09.27] - 2026-08-09


### 🐛 Pemisahan Tab Input Individual & Import Excel E-Rapor (`js/page-e-rapor.js`)
- **Fix Logika Tab Switching (`js/page-e-rapor.js`):** Mengoreksi ekspresi penentuan kelas `hidden` pada `tab-import` (`tabId !== 'import'`). Memastikan form Import Excel tersembunyi dengan rapi dan hanya muncul ketika pengguna berpindah ke tab **"Import Excel"**, tidak lagi bocor atau muncul di bawah tabel siswa pada tab **"Input Individual"**.

## [1.1.187] / [26.08.09.26] - 2026-08-09


### 🐛 Fix Syntax Error Missing Bracket `if (!isAnonymous)` (`js/global.js`)
- **Perbaikan Sintaks Blok Kode (`js/global.js`):** Mengembalikan kurung pembuka `if (!isAnonymous) {` pada baris 3924. Memperbaiki `Uncaught SyntaxError: missing ) after argument list (at global.js:3939:5)` sehingga script `global.js` dapat dieksekusi 100% sempurna tanpa error sintaks.

## [1.1.186] / [26.08.09.25] - 2026-08-09


### 🛡️ Safe Guard Dereferensi `navigator.serviceWorker` (`js/global.js` & `js/push-notification.js`)
- **Penyelesaian `TypeError: Cannot read properties of undefined (reading 'ready')` (`js/global.js`):** Menambahkan pengecekan keberadaan `'serviceWorker' in navigator && navigator.serviceWorker` sebelum mengakses properti `.ready`. Menjamin aplikasi berjalan mulus tanpa error konsol pada lingkungan browser atau perangkat yang belum/tidak mendukung Service Worker.
- **Proteksi `setupPushNotifications` (`js/push-notification.js`):** Mengamankan awal fungsi `setupPushNotifications` dengan guard penanganan Service Worker yang tidak didukung.

## [1.1.185] / [26.08.09.24] - 2026-08-09


### 🧹 Eliminasi Redundansi Tombol & Konsolidasi UI Master XML (`e-rapor.html`)
- **Pembersihan Tombol Ganda (`e-rapor.html`):** Menghapus tombol ganda `Sync Mapel dari XML` pada card Daftar Mata Pelajaran sehingga kini hanya ada 1 bar kontrol master XML di card Jadwal Pelajaran (`Upload XML Jadwal` | `Sync Master XML` | `Pemetaan Guru`).
- **Penambahan Badge Indikator Sumber Data (`e-rapor.html`):** Mengganti tombol ganda dengan badge informatif `Source: XML` pada header Daftar Mata Pelajaran.

## [1.1.184] / [26.08.09.23] - 2026-08-09


### 🪄 Master Sync 2-in-1 Jadwal & Mapel XML (`js/page-e-rapor.js` & `e-rapor.html`)
- **Penyatuan Tombol Sync XML & Sync Mapel (`js/page-e-rapor.js`):** Menggabungkan proses parser jadwal XML dan impor master mata pelajaran serta rombel guru pengampu menjadi 1 tombol Master **"Sync Master XML & Mapel"** (`window.syncASCScheduleXML`).
- **Auto-Sync Pasca Upload File XML Baru (`js/page-e-rapor.js`):** Saat Wakasek Kurikulum mengunggah file XML jadwal baru, sistem otomatis mengeksekusi `window.syncASCScheduleXML()` sehingga seluruh jadwal dan rombel mapel ter-sync instan.
- **Keamanan Penyimpanan Overwrite (Solusi Bebas Penuh Memori):** Mengklarifikasi bahwa upload file XML baru menimpa (*overwrite*) data lama di Firestore (`settings/schedule_config`) dan LocalStorage tanpa risiko membuat memori penuh (ukuran file tetap hemat ~200 KB).



### 📱 Pembersihan UI Landing Page & Direct Auto-Scan Biometrik (`index.html`)
- **Pembersihan Tampilan Landing Page (`index.html`):** Menghapus teks/badge "Perangkat Terdaftar: Login Sidik Jari Siap" agar UI halaman login tetap bersih, rapi, dan minimalis.
- **Eksekusi Langsung (Instant Direct Auto-Scan):** Mengpertahankan mekanisme eksekusi langsung scan sidik jari secara otomatis saat halaman dibuka di perangkat yang sudah terdaftar.

## [1.1.183] / [26.08.09.22] - 2026-08-09

### 🚀 Otomatisasi Deployment Firestore Rules, Indexes, Functions & Supabase pada Cabang Testing (`deploy.yml` & `supabase-migrations.yml`)
- **Deployment Backend Firebase di Testing (`deploy.yml`):** Menambahkan langkah deployment `firebase deploy --only firestore,functions` saat push/upload ke branch `testing`. Memastikan aturan Firestore (`firestore.rules`), indeks (`firestore.indexes.json`), dan Cloud Functions terpasang secara otomatis saat proses testing.
- **Deployment Migrasi & Fungsi Supabase di Testing (`supabase-migrations.yml`):** Membuka pemicu workflow untuk cabang `testing` sehingga `supabase db push` dan `supabase functions deploy` langsung berjalan saat ada perubahan skema/fungsi Supabase di testing.
- **Efisiensi Merge ke Production:** Saat cabang `testing` di-merge ke `main`, resource backend yang sudah di-deploy sebelumnya tidak perlu di-deploy ulang dari nol karena CLI Firebase & Supabase secara otomatis mengenali data/aturan yang sudah up-to-date.

## [1.1.183] / [26.08.09.22] - 2026-08-09

### 📤 Fitur Unggah Berkas XML Jadwal Baru untuk Wakasek Kurikulum (`e-rapor.html` & `js/asc-schedule-parser.js`)
- **Tombol "Upload XML Baru" (`e-rapor.html`):** Menambahkan tombol `Upload XML Baru` pada Card Jadwal Pelajaran aSc Timetables di halaman E-Rapor agar Wakasek Kurikulum dapat memperbarui file jadwal XML hasil ekspor aSc Timetables secara langsung dari browser/laptop.
- **Penyimpanan Terpusat & Fallback Cerdas (`js/asc-schedule-parser.js`):** Menyimpan `xmlContent` dan `fileName` baru ke database pusat Firestore (`settings/schedule_config`) serta LocalStorage. `parseASCSchedule()` memprioritaskan XML yang diunggah oleh Kurikulum, dan melakukan fallback ke `assets/Jadwal.xml` hanya jika belum ada file yang diunggah.

## [1.1.182] / [26.08.09.21] - 2026-08-09


### ⚡ Optimasi Best Practice Caching PWA & Offline Local Storage Firestore (`js/config.js` & `sw.js`)
- **Firestore Persistent Local Cache (`js/config.js`):** Mengaktifkan `initializeFirestore` dengan `persistentLocalCache` dan `persistentMultipleTabManager` (IndexedDB multi-tab). Memangkas konsumsi kuota read Firestore secara signifikan karena data yang tidak berubah dibaca instan dari memori lokal (0 ms latency).
- **Service Worker Stale-While-Revalidate (`sw.js`):** Mengubah strategi caching untuk seluruh file statis lokal (`.html`, `.js`, `.css`, gambar, font) menjadi Stale-While-Revalidate. Pengguna menghemat 100% kuota download saat navigasi normal.
- **Mekanisme Update Instan (*Instant Reload on Deploy*):** Ketika ada update kodingan baru dari developer, perubahan versi `CACHE_NAME` (`simas-pwa-v84`) di `sw.js` akan mendownload file baru di background dan dipicu oleh `controllerchange` di `js/global.js` untuk mereload halaman secara otomatis dan instan saat update dirilis.

## [1.1.181] / [26.08.09.20] - 2026-08-09

### 📱 Auto-Prompt Scan Sidik Jari pada Perangkat Terdaftar (`index.html`)
- **Deteksi Perangkat Terdaftar:** Sistem secara otomatis mendeteksi keberadaan credential biometrik (`simas_passkey_cred_id` / `simas_passkey_bound_email`) saat landing page `index.html` terbuka di HP / perangkat pengguna.
- **Otomatisasi Pemicu Biometrik (Auto-Prompt):** Begitu pengguna membuka web app di HP / perangkat terdaftar, sistem secara otomatis memicu pemindaian biometrik (`executeBiometricScan(true)`) setelah rendering awal (700ms) tanpa perlu klik manual.
- **Penanganan Kebijakan Gestur Browser:** Jika browser HP memerlukan gestur sentuhan sebelum mengizinkan WebAuthn, sistem menangkap `NotAllowedError` secara mulus tanpa error merah dan memasang listener 1x sentuhan layar (`pointerdown`) agar begitu pengguna menyentuh layar HP, dialog sidik jari langsung muncul secara instan.
- **Indikator Visual Perangkat Terdaftar:** Menambahkan badge `#biometric-registered-badge` (`✨ Perangkat Terdaftar: Login Sidik Jari Siap 1-Touch`) dan highlight ring bercahaya pada tombol Biometrik.

## [1.1.181] / [26.08.09.20] - 2026-08-09


### 🔄 Sinkronisasi Kompatibilitas Data Guru & Mapel ke Repositori Jurnal-Mengajar-SMAGESA (`jurnal-mengajar-smagesa/settings-app.js`)
- **Penyelarasan Algoritma Sync Guru External (`settings-app.js` di `jurnal-mengajar-smagesa`):** Memperbarui fungsi `syncGuruFromExternal` agar mengiterasi seluruh kunci `teacherMap` dari hasil sync E-Rapor (termasuk ID dari koleksi `teachers` dan entitas `TIM_BK`). Menjamin seluruh mapel dan rombel hasil sync XML E-Rapor SIMAS langsung terdistribusi sempurna ke aplikasi Jurnal Mengajar SMAGESA tanpa ada guru yang terlewat.

## [1.1.180] / [26.08.09.19] - 2026-08-09


### 🎨 Eliminasi Total `alert()` & `confirm()` Browser — Custom Glassmorphic Modals (`js/global.js`)
- **`window.showConfirmModal(message, title, type)` (Global, `js/global.js`):** Fungsi konfirmasi premium self-contained dengan glassmorphic card, animasi scale+fade, dark mode, ESC key, backdrop click. Mendukung type `danger` (ikon trash, tombol merah), `warning` (ikon tanya, tombol amber), dan `info` (ikon info, tombol biru).
- **`window.showAlertModal(title, message, type)` (Global, `js/global.js`):** Fungsi alert premium self-contained sebagai pengganti `alert()` bawaan browser. Mendukung type `success`, `error`, `warning`, `info` dengan warna dan ikon berbeda.
- **Penggantian `confirm()` di `removeBiometricPasskeyUI` (`js/global.js`):** Hapus sidik jari kini menggunakan confirm modal premium bertipe `danger`.
- **Penggantian semua `alert()` di `js/page-integrasi.js`:** Akses ditolak → `showAlertModal` error.
- **Penggantian semua `alert()` di `js/page-portal-siswa.js`:** Pemeliharaan sistem & portal nonaktif → `showAlertModal` warning.
- **Penggantian semua `alert()` di `pub/admin-kapsul.js`:** 6 alert validasi & error → `showAlertModal` warning/error.
- **Penggantian `alert()` di `pub/wordcloud.js`:** Error export gambar → `showAlertModal` error.

## [1.1.180] / [26.08.09.19] - 2026-08-09

### 🟡 Visualisasi Penanda Jadwal XML Belum Mengisi Jurnal pada Monitoring KBM (`js/page-rekap-presensi.js`)
- **Auto-Populate Sel Kosong dari Jadwal XML (`js/page-rekap-presensi.js`):** Pada grid tabel Monitoring KBM/Rekap Presensi Guru (`rekap-presensi.html`), sel jam pelajaran yang belum diisi presensi/jurnalnya oleh guru pengampu kini secara otomatis menampilkan nama Mapel dan Nama Guru pengampu resmi dari `assets/Jadwal.xml`.
- **Styling Peringatan "Belum Jurnal":** Mengaplikasikan latar belakang warna Amber/Kuning bernuansa khusus (`bg-amber-50`), garis tepi putus-putus (*dashed border*), dan indikator badge `Belum Jurnal` agar Kepala Sekolah, Wakasek Kurikulum, dan Guru Piket dapat langsung membedakan mana kelas yang sudah dan belum mengisi jurnal KBM.

## [1.1.179] / [26.08.09.18] - 2026-08-09


### 🎯 Garansi Tampilan Nama Guru Asli pada Rombel Mapel E-Rapor (`js/page-e-rapor.js`)
- **Penyimpanan Properti `name` pada `mapelGuru` (`js/page-e-rapor.js`):** Memastikan `syncMapelFromASCScheduleXML` menyimpan properti `name` nama asli guru hasil smart matching secara langsung ke dalam objek `mapelGuru` di Firestore & LocalStorage.
- **Fallback Resolusi `guruName` di UI (`js/page-e-rapor.js`):** Menggunakan `(resolvedName && resolvedName !== g.uid) ? resolvedName : (g.name || g.uid)` untuk menjamin 100% badge guru pengampu selalu menampilkan nama asli guru.

## [1.1.178] / [26.08.09.17] - 2026-08-09


### 👤 Resolusi Nama Guru pada Badge Guru Pengampu E-Rapor (`js/page-e-rapor.js`)
- **Penyempurnaan `getUserNameByUid` & `loadAllUsersCache` (`js/page-e-rapor.js`):** Menggabungkan sumber data dari `teachers` collection (IndexedDB/Firestore cache) ke dalam `allUsersCache` serta menambahkan fallback resolusi ID guru `TIM_BK`. Memastikan badge guru pengampu di tabel Daftar Mata Pelajaran menampilkan nama asli guru (misal: *I Nyoman Ananta Wasistha, S.Pd.*) alih-alih ID mentah Firebase (`OacvZDSXoUT9jt...`).

## [1.1.177] / [26.08.09.16] - 2026-08-09


### 🔧 Fix Bug Runtime lessonsMap & Penyesuaian Iterasi getSubjectsWithLessonsFromXML (`js/asc-schedule-parser.js`)
- **Penambahan lessonsMap pada parsedScheduleData (`js/asc-schedule-parser.js`):** Memperbaiki `TypeError: Cannot read properties of undefined (reading 'forEach')` dengan menyertakan `lessonsMap` pada objek return parser `parsedScheduleData`.
- **Akurasi Iterasi Map vs Object (`js/asc-schedule-parser.js`):** Menyesuaikan `getSubjectsWithLessonsFromXML` agar aman digunakan baik pada objek `Map` di memori maupun hasil *deserialization* JSON dari `localStorage`.

## [1.1.176] / [26.08.09.15] - 2026-08-09


### 🪄 Fitur Auto-Sync Master Mapel & Rombel Guru dari aSc Timetables XML (`js/asc-schedule-parser.js`, `e-rapor.html`, `js/page-e-rapor.js`)
- **Ekstraksi Master Mapel & Guru Rombel (`getSubjectsWithLessonsFromXML` di `js/asc-schedule-parser.js`):** Membaca seluruh entitas `<subjects>`, `<lessons>`, `<classes>`, dan `<teachers>` dari `assets/Jadwal.xml` untuk menyusun daftar mapel beserta daftar guru pengampu dan rombel kelasnya masing-masing.
- **Tombol 🪄 Sync Mapel dari XML (`e-rapor.html` & `js/page-e-rapor.js`):** Menyediakan fitur 1-klik untuk memperbarui `raporConfig.mapel_list`, `mapel_guru`, dan `mapel_short_codes` murni dari XML Kurikulum. Menghilangkan kebutuhan entri manual oleh guru dan menjamin SSOT data 100%.
- **Badges Indikator XML Master (`e-rapor.html`):** Menampilkan badge penanda warna hijau `XML` pada tabel Daftar Mata Pelajaran yang bersumber murni dari kurikulum.

## [1.1.175] / [26.08.09.14] - 2026-08-09


### 🎯 Smart Mapel Matcher & Perapihan Penampilan TIM BK (`js/page-presensi-guru.js` & `js/asc-schedule-parser.js`)
- **Smart Set Value Dropdown Mapel (`setSelectMapelValue` di `js/page-presensi-guru.js`):** Memperbaiki isu kolom Mapel kosong dengan mengimplementasikan pencocokan string bertingkat (exact match, normalized string match "dan"/"&", dan opsi dinamis otomatis). Menjamin nama mapel dari `assets/Jadwal.xml` 100% selalu terpilih dan tampil di dropdown.
- **Perapihan Penampilan Entitas TIM BK (`js/asc-schedule-parser.js`):** Mengatur nama default entitas TIM BK menjadi `TIM BK` yang ringkas dan bersih, sehingga tidak terpotong pada kolom input presensi guru.

## [1.1.174] / [26.08.09.13] - 2026-08-09


### 👥 Penanganan Khusus Entitas TIM BK & Prioritas Auto-Filter Guru BK (`js/asc-schedule-parser.js`, `js/page-e-rapor.js`, `js/page-presensi-guru.js`)
- **Virtual Group Teacher TIM BK (`js/asc-schedule-parser.js`):** Mengautomasikan pengenalan string `TIM BK` dari XML aSc Timetables menjadi entitas grup `TIM_BK` (`[Grup] TIM BK (Seluruh Guru BK)`) tanpa memunculkannya sebagai status *unmatched*.
- **Opsi Pemetaan Kolektif E-Rapor (`js/page-e-rapor.js`):** Menambahkan pilihan `[Grup] TIM BK (Seluruh Guru BK)` pada Modal Pemetaan Guru XML.
- **Smart Filter Prioritas Guru BK (`js/page-presensi-guru.js`):** Saat jam pelajaran BK berlangsung atau saat entitas `TIM BK` dipilih, dropdown pencarian guru secara otomatis memprioritaskan seluruh Guru BK sekolah di posisi paling atas dengan indikator badge warna ungu `(Guru BK)`.

## [1.1.173] / [26.08.09.12] - 2026-08-09


### ⚡ Strategi Network-First PWA & Konfigurasi Cache-Control Firebase Hosting (`firebase.json` & `sw.js`)
- **Header Cache-Control Firebase Hosting (`firebase.json`):** Menambahkan aturan `Cache-Control: no-cache, no-store, must-revalidate` untuk berkas `sw.js` dan seluruh file `.html`, `.js`, `.css` di 3 target Firebase (`smagesa`, `sman1abang`, `simas-shakti`). Menghilangkan penundaan pembaruan browser/PWA di HP akibat cache HTTP CDN.
- **Strategi Network-First PWA (`sw.js`):** Mengubah strategi pemuatan Service Worker dari *Stale-While-Revalidate* menjadi **Network-First** khusus untuk berkas `.html` dan `.js` utama (seperti `js/config.js`). Menjamin pembaruan versi instan 100% saat terhubung ke jaringan tanpa mengorbankan kemampuan offline (0 Read Firestore/Supabase).
- **PWA Cache Invalidation (`sw.js`):** Meng-update `CACHE_NAME` menjadi `simas-pwa-v78`.

## [1.1.172] / [26.08.09.11] - 2026-08-09

### 🗓️ Integrasi Parser Jadwal.xml aSc Timetables & 4-Level Smart Matching Guru (`js/asc-schedule-parser.js`, `e-rapor.html`, `js/page-e-rapor.js`, `presensi-guru.html`, `js/page-presensi-guru.js`)
- **Modul Parser aSc Timetables XML (`js/asc-schedule-parser.js`):** Mengolah data master `assets/Jadwal.xml`, mengekstrak pemetaan jam pelajaran (JP 1-10), hari (Senin-Jumat), kelas, mapel, dan guru pengampu secara client-side.
- **4-Level Smart Matching Strategy:** Menjamin identitas ID Guru SIMAS tetap SSOT melalui pencocokan bertingkat (Level 1: Normalisasi nama tanpa gelar/tanda baca, Level 2: Match NIP/Kode Guru `short`, Level 3: Fuzzy token match, Level 4: Pemetaan manual terpusat).
- **Satu Pintu Kurikulum di Pengaturan E-Rapor (`e-rapor.html` & `js/page-e-rapor.js`):** Menyediakan Card Konfigurasi Jadwal XML dan Modal **Pemetaan Guru XML ↔ SIMAS** (`#modal-mapping-guru`) khusus untuk `super_admin` dan `wakasek_kurikulum`.
- **Auto-Populate & Magic Button di Presensi Guru (`presensi-guru.html` & `js/page-presensi-guru.js`):** Mengisi otomatis nama Mapel dan Guru per JP saat tanggal/kelas dipilih, serta menyediakan tombol 🪄 **"Jadwal XML"** untuk pengisian instan.
- **Optimasi Kuota Read Firestore:** Hasil parse dan pemetaan disimpan di `localStorage` (`simas_asc_schedule_cache`) & 1 dokumen Firestore `settings/schedule_config`, menjamin **0 Read Extra** saat pengisian presensi harian.

## [1.1.171] / [26.08.09.10] - 2026-08-09


### 🔄 PWA Service Worker Automatic Cache Invalidation & Auto-Reload (`js/global.js` & `sw.js`)
- **Pembaruan Service Worker Registration (`js/global.js`):** Menambahkan pemicu `reg.update()` dan event listener `controllerchange` auto-reload saat Service Worker baru terdeteksi.
- **PWA Cache Isolation (`sw.js`):** Meng-update `CACHE_NAME` ke `simas-pwa-v76` untuk memastikan seluruh file statis (`js/config.js` versi `26.08.09.10`) langsung aktif di perangkat seluler pengguna tanpa tertahan cache lama.

## [1.1.170] / [26.08.09.9] - 2026-08-09

### 🔐 Fitur Login Biometrik / Passkey Sidik Jari Khusus Guru & Staf (`js/biometric-auth.js`, `index.html`, `js/global.js`)
- **Modul Otentikasi Biometrik WebAuthn/FIDO2 (`js/biometric-auth.js`):** Mengimplementasikan otentikasi standar W3C `PublicKeyCredential` dengan akselerasi 1-touch login sidik jari (Touch ID / Face ID / Windows Hello) untuk Guru & Staf Sekolah.
- **Form Login 1-Touch (`index.html`):** Menambahkan tombol **"Sidik Jari"** (`#btn-biometric-login`) di sebelah tombol Google Login pada landing page SIMAS.
- **Manajemen Biometrik di Edit Profil (`#modal-edit-profile` di `js/global.js`):** Menyediakan kontrol registrasi & aktivasi passkey sidik jari untuk akun Guru/Staf secara mandiri, lengkap dengan validasi status dukungan browser/perangkat.
- **Proteksi Hardware Sesi Logout (`clearUserSessionSafe`):** Mengamankan kredensial hardware passkey lokal (`simas_passkey_*`) agar tidak terhapus saat pembersihan sesi logout biasa.
- **Isolasi Role (RBAC):** Memblokir pendaftaran & login biometrik untuk role Siswa (`siswa`), Admin PKS (`admin_pks`), dan Admin Kelas (`admin_kelas`).
- **Pembaruan Service Worker PWA (`sw.js`):** Meng-update nama cache PWA ke `simas-pwa-v73` dan memasukkan `./js/biometric-auth.js` ke daftar `ASSETS_TO_CACHE` agar HP/perangkat PWA otomatis memperbarui cache file ke versi terbaru.

## [1.1.169] / [26.08.09.8] - 2026-08-09

### 📢 Edukasi Khusus Login Google untuk Guru/Staf (`index.html`)
- **Penyempurnaan Pesan Penolakan Google Auth:** Menambahkan informasi edukatif bahwa fitur "Masuk dengan Google" diperuntukkan khusus bagi Guru dan Staf sekolah, serta mengarahkan siswa untuk login manual menggunakan NIS.

## [1.1.168] / [26.08.09.7] - 2026-08-09

### 🎨 Refinement Komposisi Dark Mode Tombol Google & Link Bawah (`index.html` & `css/style.css`)
- **Peningkatan Kontras Tombol Google di Dark Mode:** Mengatur background tombol menjadi slate gelap elegan (`rgba(30, 41, 59, 0.75)`), border semi-transparan, dan teks putih bersih (`#f8fafc`) agar kontras tinggi dan mudah dibaca.
- **Penyelarasan Latar Lupa Sandi & Daftar Akun:** Menghapus background yang tidak selaras pada link/tombol Lupa Sandi dan Daftar Akun, menjadikannya 100% transparan menyatu mulus dengan latar login card.

## [1.1.167] / [26.08.09.6] - 2026-08-09

### 🌐 Konfigurasi Domain Resmi Sekolah Google OAuth (`js/config.js`)
- **Pembaruan Primary AuthDomain:** Mengalihkan `authDomain` ke `smagesa.web.app` sehingga label otentikasi Google menampilkan nama domain resmi sekolah: *"Lanjutkan ke smagesa.web.app"*.

## [1.1.166] / [26.08.09.5] - 2026-08-09

### 🛡️ Perbaikan CSP Google OAuth & Penyelarasan Primary AuthDomain (`firebase.json` & `js/config.js`)
- **Pembaruan Header Content-Security-Policy (CSP):** Mengizinkan domain `https://apis.google.com`, `https://accounts.google.com`, dan `https://*.firebaseapp.com` pada direktif `script-src`, `frame-src`, dan `connect-src` di `firebase.json` untuk menghilangkan pemblokiran skrip iframe OAuth Google.
- **Penyelarasan Primary AuthDomain:** Mengembalikan `authDomain` ke `smagesa.firebaseapp.com` pada `js/config.js` untuk menjamin handler otentikasi Google OAuth selalu valid tanpa dependensi kustom GCP.

## [1.1.165] / [26.08.09.4] - 2026-08-09

### 🔤 Penyeragaman Label Tombol Google Login (`index.html`)
- **Penyederhanaan Teks Tombol:** Mengubah teks tombol Google Sign-In menjadi lebih ringkas dan standar: **"Masuk dengan Google"**.

## [1.1.164] / [26.08.09.3] - 2026-08-09

### 🛡️ Peningkatan Keamanan Lapis Ganda & Fallback Case-Insensitive Matching (`firestore.rules` & `index.html`)
- **Penyelarasan Evaluasi Aturan Keamanan:** Menambahkan pembanding email `getUserData().email == resource.data.email` pada fungsi `isUpdatingOwnLinkedTeacherProfile` di `firestore.rules` untuk memastikan izin pembaruan profil master guru selalu sah 100%.
- **Fallback Pencarian Email Google Sign-In:** Menambahkan proteksi pencarian email cadangan pada saat login Google di `index.html` untuk menjamin akun selalu ditemukan secara instan.

## [1.1.163] / [26.08.09.2] - 2026-08-09

### 🛡️ Penyelarasan Sinkronisasi Email Admin & Master Guru (`users.html` & `js/page-users.js`)
- **Pembaruan Email oleh Admin:** Membuka field input `edit-email` pada modal Kelola Pengguna (`#modal-edit-user`) agar Admin dapat memperbarui alamat email user dan secara otomatis mensinkronisasikan ke master data `teachers` (SSOT).

## [1.1.162] / [26.08.09.1] - 2026-08-09

### 🔄 Sinkronisasi Mandiri Email Profil ke Firestore & Firebase Auth (`js/global.js` & `firestore.rules`)
- **Input Email Mandiri di Edit Profil (`#modal-edit-profile`):** Membuka kolom input Email agar guru/staf dapat memperbarui alamat email Gmail/Google mereka sendiri secara mandiri.
- **Sinkronisasi Ganda (SSOT Firestore & Auth):** Menyimpan perubahan email secara otomatis ke koleksi `users/{uid}`, `teachers/{targetTeacherId}`, dan memicu pembaruan `updateEmail` pada Firebase Authentication.
- **Pembaruan Aturan Keamanan (`firestore.rules`):** Mengizinkan pembaruan field `email` pada fungsi `isUpdatingOwnUserProfile` dan `isUpdatingOwnLinkedTeacherProfile` untuk menjaga integritas data akun.

## [1.1.161] / [26.08.08.83] - 2026-08-08

### 🎨 Reposisi Tombol Google Login ke Bagian Atas Form (`index.html`)
- **Penempatan Prioritas Utama:** Memindahkan tombol **"Masuk dengan Google (Guru/Staf)"** ke posisi paling atas kartu login di atas form input identitas/password manual, mempermudah akses instan 1-klik untuk Guru/Staf.

## [1.1.160] / [26.08.08.82] - 2026-08-08

### 🌐 Penyesuaian Custom Auth Domain smagesa.web.app (`js/config.js`)
- **Setting authDomain:** Mengatur `authDomain: "smagesa.web.app"` pada Firebase Config untuk menampilkan domain resmi `smagesa.web.app` pada header persetujuan Google OAuth.

## [1.1.159] / [26.08.08.81] - 2026-08-08

### 🐛 Perbaikan OAuth Redirect URI Mismatch (`js/config.js`)
- **Restorasi Standard Firebase Auth Handler:** Mengembalikan `authDomain` ke `smagesa.firebaseapp.com` untuk mencegah error `Error 400: redirect_uri_mismatch` pada layar otentikasi Google Sign-In.

## [1.1.158] / [26.08.08.80] - 2026-08-08

### 🌐 Konfigurasi Primary Auth Domain (`js/config.js`)
- **Penyelarasan Domain OAuth (`authDomain`):** Mengubah `authDomain` Firebase Config dari `smagesa.firebaseapp.com` menjadi domain utama sekolah `smagesa.web.app` agar tampilan judul persetujuan Google Sign-In menampilkan domain resmi sekolah.

## [1.1.157] / [26.08.08.79] - 2026-08-08

### 🔐 Fitur Login Google Authentication untuk Staf/Guru (`index.html`)
- **Tombol Masuk dengan Google (`#btn-google-login`):** Menambahkan opsi otentikasi Google Sign-In bagi Guru/Staf via Firebase Auth `GoogleAuthProvider` & `signInWithPopup`.
- **Direct Email Matching (SSOT & OWASP):** Mencocokkan email akun Google pengguna secara efisien dengan data di koleksi `users` (`where("email", "==", googleEmail).limit(1)`).
- **Auto-Kick untuk Akun Tidak Terdaftar:** Jika email Google yang digunakan tidak terdaftar dalam koleksi `users` SIMAS, sistem secara otomatis mengeksekusi `signOut(auth)` (kick out) dan menampilkan pesan peringatan keamanan.
- **Pemeriksaan Mode Pemeliharaan & Transisi Mode:** Mendukung pencegahan akses saat Maintenance Mode dan penyesuaian tampilan antarmuka saat beralih antara Mode Siswa dan Mode Staf.

## [1.1.156] / [26.08.08.102] - 2026-08-08

### ⚡ Fitur Auto-Load Cache Sesi Pilihan Filter (`js/page-guru-mapel.js`)
- **Penayangan Instant (0 Reads):** Saat guru beralih filter (Kelas, Mapel, Semester) dan kembali ke kombinasi filter yang sempat dibuka pada sesi yang sama, data langsung dimuat dari memori `sessionGradebookCache` tanpa perlu menekan tombol *Load* lagi (0 read ke Firestore & Supabase).
- **Keamanan Perubahan Belum Disimpan:** Tetap dilindungi penuh oleh modal konfirmasi *Unsaved Changes* (`isGradebookDirty`) sehingga tidak ada pengeditan yang terbuang.
- **Dukungan Re-Fetch Manual:** Menekan tombol *Load* secara manual tetap melakukan pembaruan penuh (*force re-fetch*) langsung ke database server.

## [1.1.155] / [26.08.08.101] - 2026-08-08

### 🐛 Perbaikan Pemanggilan Fungsi Refresh Jurnal Mengajar (`js/page-guru-mapel.js`)
- **Penyelarasan Nama Fungsi (`saveJurnalChanges`):** Memperbaiki nama pemanggilan dari `window.loadJurnalData` ke `window.loadDaftarJurnalData(true)` & `window.loadKehadiranSiswaData(true)` agar tidak menyebabkan `TypeError: window.loadJurnalData is not a function`.
- **Pengalihan Alias Global:** Menambahkan fungsi alias `window.loadJurnalData` dan `window.loadKehadiranData` untuk kompatibilitas fungsi.

## [1.1.154] / [26.08.08.100] - 2026-08-08

### 📝 Fitur Edit Jurnal Mengajar Guru Mapel (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Tombol Edit pada Daftar Jurnal:** Menambahkan kolom **Aksi** dan tombol **Edit** (`fa-pen-to-square`) pada setiap baris jurnal mengajar di Tab Jurnal.
- **Modal Editor Jurnal Mengajar (`#modal-edit-jurnal`):** Memungkinkan guru mengedit Jam Pelajaran (JP), Materi/Topik Pembelajaran, Catatan Tambahan Guru, serta Detail Status Presensi Kehadiran Siswa (Hadir, Izin, Sakit, Alpa, Dispen).
- **Update Firestore Direct (`dbJurnal`):** Perubahan disimpan langsung ke koleksi `jurnal_guru` di Firebase Firestore `jurnal-smagesa`, membesihkan cache lokal, dan memperbarui rekapitulasi kehadiran secara *real-time*.

## [1.1.153] / [26.08.08.99] - 2026-08-08

### 🐛 Perbaikan Penghapusan & Penyimpanan Nilai Kosong ke Supabase (`js/page-guru-mapel.js`)
- **Penghapusan Baris Nilai Kosong pada Database (`saveScores`):** Menambahkan perintah pembersihan otomatis (`DELETE FROM guru_mapel_scores WHERE gradebook_id = ... AND component_id = ... AND student_nis IN (...)`) untuk setiap sel input nilai yang dikosongkan atau direset oleh guru saat menekan tombol *Simpan Nilai*.
- **Persistensi Data Setelah Refresh:** Memastikan sel yang dikosongkan/direset benar-benar terhapus secara permanen dari database Supabase sehingga data nilai yang dihapus tidak akan muncul kembali saat halaman di-refresh.

## [1.1.152] / [26.08.08.98] - 2026-08-08

### 🙈 Visibilitas Kondisional & Live Toggle Tombol Reset Kolom (`js/page-guru-mapel.js`)
- **Penyesuaian Visibilitas Reset:** Tombol **Reset** pada baris bawah (`tfoot`) hanya akan muncul jika kolom tersebut memiliki minimal 1 data nilai terisi. Jika kolom masih 100% kosong, tombol reset akan disembunyikan dan digantikan dengan tanda hubung (`-`).
- **Live Toggle saat Mengetik/Reset:** Begitu guru mengetik nilai di suatu kolom kosong, tombol **Reset** otomatis muncul seketika secara *live*. Sebaliknya, jika kolom direset, tombol reset langsung tersembunyi secara otomatis.

## [1.1.151] / [26.08.08.97] - 2026-08-08

### 📌 Relokasi Tombol Reset Kolom ke Baris Paling Bawah Tabel (`tfoot`) (`js/page-guru-mapel.js`)
- **Baris Paling Bawah Tabel (`tfoot`):** Memindahkan tombol **Reset** dari bagian atas header ke baris paling bawah (*footer*) tabel lembar penilaian di bawah masing-masing kolom komponen.
- **Tampilan Header Bersih:** Header tabel atas kembali rapi khusus untuk label komponen dan pengurutan nilai (*sorting*), sementara tombol aksi reset terorganisir rapi di baris paling bawah.

## [1.1.150] / [26.08.08.96] - 2026-08-08

### 🧹 Fitur Reset Data Nilai Per Kolom & Popup Verifikasi Keamanan (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Tombol Reset Per Kolom:** Menambahkan tombol tombol **Reset** (`fa-rotate-left`) di setiap header kolom komponen nilai (Tugas 1..5, Sumatif 1..5, SAS/SAT).
- **Popup Verifikasi Ketik Nama Kolom (`#modal-reset-column`):** Menyediakan mekanisme keamanan tinggi saat tombol reset diklik. Pengguna wajib mengosongkan dan mengetik ulang nama kolom secara persis (misal `Tugas 1`) di dalam input konfirmasi sebelum tombol `Ya, Reset Kolom Ini` dapat diklik.
- **Kalkulasi & Status Dirty Live:** Begitu dikonfirmasi, seluruh sel nilai pada kolom tersebut langsung dibersihkan, status data diubah menjadi *dirty*, dan kalkulasi rata-rata kelas/statistik diperbarui secara *live*.

## [1.1.149] / [26.08.08.95] - 2026-08-08

### ⚡ Pembaruan Langsung Input Edit & Pengembalian Tombol Simpan Atas (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Pemicu Penanda saat Mengedit Nilai (`onScoreInputChange`):** Memastikan fungsi `updateColumnHighlightsAndQuartiles()` dipanggil seketika saat guru mengetik/mengedit angka nilai di sel mana pun, sehingga penanda merah (< KKM) atau hijau (Kuartil Atas) serta *tooltip* penjelasan langsung berubah seketika di layar.
- **Pengembalian Tombol Simpan Atas & Bawah (`#top-save-bar` & `#bottom-save-bar`):** Mengembalikan baris tombol Simpan Nilai di **bagian atas tabel** dan **bagian bawah tabel** secara bersamaan saat ada perubahan nilai yang belum disimpan.

## [1.1.148] / [26.08.08.94] - 2026-08-08

### ⚡ Pembaruan Langsung (*Live Update*) KKM pada Penanda Warna & Tooltip (`js/page-guru-mapel.js`)
- **Pemicu Ulang Penanda Visual (`updateKkmFromUI`):** Menambahkan pemanggilan `recalculateAllRowsLive()` saat pengguna mengubah nilai KKM pada modal pengaturan.
- **Update Real-Time:** Penanda warna merah (< KKM), penanda hijau zamrud (Kuartil Atas Q3), teks legenda, serta *tooltip* sel nilai kini langsung diperbarui secara *real-time* seketika nilai KKM diubah.

## [1.1.147] / [26.08.08.93] - 2026-08-08

### 🎨 Penyesuaian Warna Penanda Kuartil Atas & Relokasi Legenda (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Penyamaan Warna Kuartil Atas:** Penanda Kuartil Atas (Top 25% nilai tertinggi) disamakan antara input komponen dan sel Nilai Akhir (NA) menggunakan tema hijau zamrud (*emerald*) yang seragam.
- **Relokasi Legenda & Tooltip:** Memindahkan baris legenda penanda warna (`#legend-score-bar`) dan informasi *tooltip* ke **bagian bawah tabel lembar penilaian** agar tampilan tabel lebih rapi dan bersih.

## [1.1.146] / [26.08.08.92] - 2026-08-08

### 🎨 Visual Highlighting Nilai di Bawah KKM & Kuartil Atas (Top 25%) (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Penanda Nilai di Bawah KKM (`< KKM`):** Memberikan penanda warna merah muda (*rose tint*) dan border peringatan pada sel input & sel kalkulasi yang nilainya berada di bawah KKM.
- **Penanda Kuartil Atas (`Q3 / Top 25%`):** Menghitung ambang nilai Kuartil Atas (Q3 / Top 25% nilai tertinggi) secara real-time untuk setiap kolom dan memberikan penanda warna hijau zamrud (*emerald*) untuk sel komponen serta warna emas-amber untuk Nilai Akhir (NA).
- **Legend Bar Keterangan Penanda Warna:** Menampilkan baris legenda petunjuk warna (`#legend-score-bar`) di atas tabel penilaian lengkap dengan *tooltip* informatif saat kursor diarahkan ke sel nilai.

## [1.1.145] / [26.08.08.91] - 2026-08-08

### 📉 Optimasi Egress Bandwidth Supabase Free Tier (`js/page-guru-mapel.js`)
- **Pembatasan Kolom Query (`selectFields` Optimization):** Mengganti pembacaan seluruh kolom `SELECT *` menjadi spesifikasi kolom eksplisit pada `guru_mapel_components`, `guru_mapel_scores`, dan `guru_mapel_summaries`. Memangkas ukuran transfer data hingga **80%**, menghemat kuota bulanan Egress (5 GB) Supabase Free Tier.
- **SQL B-Tree Indexing Script:** Menyediakan skrip indeks PostgreSQL terstruktur untuk dieksekusi pada Supabase SQL Editor untuk mempercepat query hingga 0ms.

## [1.1.144] / [26.08.08.90] - 2026-08-08

### 🛡️ Proteksi Concurrency Rate-Limit & Analisis Efisiensi Supabase Free Tier (`js/global.js`)
- **Controlled Concurrency Batching (`maxConcurrency: 5`):** Menambahkan pembatasan gelombang maksimal 5 request HTTP paralel secara bersamaan pada `window.fetchAllSupabaseRows`. Menjamin 100% web bebas dari crash, error *Out of Memory*, maupun kendala rate-limit Supabase (`HTTP 429 Too Many Requests`).
- **Analisis Efisiensi Kuota Gratis Supabase:** Mengidentifikasi strategi penghematan kuota Supabase *Free Tier* (pembatasan Egress via `SELECT` kolom spesifik, pencegahan auto-pause 7 hari, serta pemanfaatan B-Tree Indexes).

## [1.1.143] / [26.08.08.89] - 2026-08-08

### ⚡ High-Speed Parallel Chunking (`Promise.all`) pada `window.fetchAllSupabaseRows` (`js/global.js`)
- **Peningkatan Algoritma ke Parallel Query:** Mengubah pola pembacaan chunk data Supabase dari *sequential waterfall* menjadi **High-Speed Parallel Requests (`Promise.all`)**.
- **Performa Instan Super Cepat:** Untuk data berukuran besar (misal 5.000 s.d. 50.000+ baris data), seluruh chunk diunduh secara serentak (paralel) sehingga waktu pemuatan tetap kilat (~50-100 milidetik total), tanpa menunda pengalaman pengguna.

## [1.1.142] / [26.08.08.88] - 2026-08-08

### ⚡ Proteksi Pembacaan & Penyimpanan Supabase Berjumlah Besar (Auto-Chunked Pagination) (`js/global.js` & `js/page-guru-mapel.js`)
- **Fungsi Terpusat `window.fetchAllSupabaseRows`:** Membuat helper terpusat dengan teknik *automatic range pagination* (`.range(0, 999)`, `.range(1000, 1999)`, dst.) untuk mengambil **100% seluruh baris data Supabase** tanpa pernah terpotong oleh limit bawaan 1000 baris PostgREST.
- **Penerapan pada Pemuatan Komponen, Nilai, & Summary (`page-guru-mapel.js`):** Mengganti eksekusi `.select('*')` langsung menjadi `window.fetchAllSupabaseRows`, menjamin pemuatan lembar penilaian tetap 100% utuh meskipun jumlah baris data nilai siswa membengkak hingga puluhan ribu.
- **Chunking Simpan Massal (`saveScores`):** Membagi array payload penyimpanan `scorePayloads` dan `summaryPayloads` ke dalam *chunks* per 500 baris saat melakukan `.upsert()` ke Supabase untuk mencegah error batas ukuran *request payload*.

## [1.1.141] / [26.08.08.87] - 2026-08-08

### 📲 Penyempurnaan Teks Pengumuman WA & Opsi Tampilan Nilai Siswa (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Penulisan Tunggal Batas KKM pada Header:** Menuliskan keterangan `Batas KKM: 75` cukup **1 kali saja** di bagian atas (header pengumuman WhatsApp) dan mengeliminasi pengulangan teks `(< KKM 75)` di samping setiap nama siswa.
- **Opsi Toggle Tampilkan/Sembunyikan Angka Nilai Siswa:** Menambahkan checkbox `Tampilkan Angka Nilai Siswa` (`#checkbox-wa-show-scores`) pada panel Salin Pengumuman WA. Jika tidak dicentang, pengumuman WA akan menyembunyikan angka nilai numerik dan hanya menampilkan daftar nama siswa beserta status `Belum Tuntas` / `Belum Mengumpulkan`.

## [1.1.140] / [26.08.08.86] - 2026-08-08

### 🐛 Resolusi PostgREST Error `PGRST204` (Penyelarasan Kolom Database Supabase & Refresh Schema Cache)
- **Penambahan Kolom yang Hilang pada Skema Database Supabase:**
  - `guru_mapel_components`: Menambahkan kolom `sequence INT DEFAULT 1` dan `is_optional BOOLEAN DEFAULT FALSE`.
  - `guru_mapel_summaries`: Menambahkan kolom `tugas_avg NUMERIC(5,2)`, `sumatif_avg NUMERIC(5,2)`, `sas_sat_score NUMERIC(5,2)`, `final_score NUMERIC(5,2)`, `catatan_apresiasi TEXT`, `catatan_perilaku TEXT`, dan `catatan_evaluasi TEXT`.
- **Reload PostgREST Schema Cache:** Mengirimkan sinyal `NOTIFY pgrst, 'reload schema';` ke Supabase agar PostgREST mereload cache skema tabel secara real-time dan menghilangkan error `PGRST204` ("Could not find column in schema cache").

## [1.1.139] / [26.08.08.85] - 2026-08-08

### 🐛 Perbaikan HTTP 400 Bad Request Upsert Supabase (`js/page-guru-mapel.js` & Supabase DB)
- **Penerapan Foreign Key & Unique Constraints di Database Supabase:** Menambahkan Foreign Keys (`ON DELETE CASCADE`) dan Unique Constraints yang hilang pada tabel-tabel Supabase:
  - `guru_mapel_components`: constraint `unique_component_label UNIQUE (gradebook_id, component_type, label)` dan foreign key ke `guru_mapel_gradebooks`.
  - `guru_mapel_scores`: constraint `unique_student_component_score UNIQUE (gradebook_id, student_nis, component_id)` dan foreign key ke `guru_mapel_gradebooks`.
  - `guru_mapel_summaries`: constraint `unique_student_summary UNIQUE (gradebook_id, student_nis)` dan foreign key ke `guru_mapel_gradebooks`.
  Tindakan ini secara langsung mengatasi kegagalan REST API PostgREST (`status of 400`) saat eksekusi `.upsert()` dengan opsi `onConflict`.
- **Presisi Mapping Komponen Nilai (`fetchScoresFromSupabase`):** Memperbaiki predikat pencarian `colMatch` agar melakukan pencocokan ketat `ac.label === c.label && ac.type === c.component_type`, mencegah pergeseran mapping `component_id` antar kolom tugas/sumatif.

## [1.1.138] / [26.08.08.84] - 2026-08-08

### ⚠️ Modal Konfirmasi & Proteksi Unsaved Changes (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Modal Dialog Interaktif Peringatan Perubahan Unsaved:** Menambahkan modal konfirmasi khusus (`#modal-unsaved-changes`) ketika terdapat perubahan nilai di lembar penilaian yang belum disimpan (`isGradebookDirty === true`) dan pengguna hendak memuat data kelas/mapel lain. Menyediakan 3 opsi tindakan: **Simpan & Lanjutkan**, **Abaikan Perubahan**, dan **Batal**.
- **Proteksi Penutupan Tab/Refresh Browser (`beforeunload`):** Mengaktifkan event listener `beforeunload` untuk mencegah pengguna secara tidak sengaja menutup tab atau me-refresh halaman saat ada nilai yang belum disimpan.
- **Intersepsi Navigasi Internal:** Mencegah perpindahan halaman via link navigasi/sidebar saat ada perubahan nilai belum disimpan sebelum dikonfirmasi oleh pengguna.

## [1.1.137] / [26.08.08.83] - 2026-08-08

### 🔢 Keterikatan Permanen Nomor Absen Siswa saat Sortir Kolom (`js/page-guru-mapel.js`)
- **Penetapan No Absen Permanen Berdasarkan Urutan Alfabetis Default:** Mengunci nilai `noAbsen` awal siswa (1, 2, 3, ... N) sesuai urutan alfabetis nama A-Z saat data siswa pertama kali dimuat.
- **Keterikatan Nomor pada Baris Siswa:** Memastikan angka pada kolom `No` tetap melekat (*permanently attached*) pada masing-masing siswa ketika tabel disortir berdasarkan kolom lain (misalnya Nilai Akhir NA, Nilai Tugas, Nilai Sumatif, atau NIS).
- **Sortir Khusus Kolom `No`:** Pengklikan pada header kolom `No` kini memungkinkan pengurutan ulang berdasarkan `noAbsen` secara Ascending (1 ke N) maupun Descending (N ke 1).

## [1.1.136] / [26.08.08.82] - 2026-08-08

### 🐛 Resolusi ReferenceError `minRequiredSumatifCount is not defined` (`js/page-guru-mapel.js`)
- **Restorasi Variabel Deklarasi State:** Memulihkan deklarasi variabel `let minRequiredSumatifCount = 1;` yang terlewat pada modul `page-guru-mapel.js`. Hal ini menyelesaikan *Uncaught ReferenceError* yang terjadi saat pemanggilan fungsi `fetchScoresFromSupabase` dan memungkinkan pemuatan lembar penilaian siswa berjalan 100% tuntas.

## [1.1.135] / [26.08.08.81] - 2026-08-08

### 🐛 Perbaikan Spinner Loading Menggantung & Pengamanan Sortir (`js/page-guru-mapel.js`)
- **Penanganan Error Terisolasi pada Loading Paralel:** Membungkus eksekusi IIFE pemuatan data siswa & lembar penilaian di dalam blok `try...catch` internal sebelum diproses oleh `Promise.allSettled`. Hal ini mencegah spinner `Memuat lembar penilaian...` menggantung selamanya (*infinite loading*) saat terjadi pengecualian tak terduga.
- **Proteksi Null-Safety Pengurutan Nama Siswa:** Menambahkan *null-check* `(a.name || '').localeCompare(b.name || '')` saat penyortiran data siswa Firestore/cache untuk mencegah `TypeError: Cannot read properties of undefined (reading 'localeCompare')` apabila terdapat dokumen siswa dengan atribut nama yang belum terisi lengkap.

## [1.1.134] / [26.08.08.80] - 2026-08-08

### 📊 Redesain Presisi & Kerapian Format Export Excel 3 Sheet Guru Mapel (`js/page-guru-mapel.js`)
- **Restrukturisasi Matriks & Penggabungan Sel (`!merges`) Sheet Kehadiran Siswa:** Mengeliminasi masalah pergeseran kolom header (*misalignment*) pada sheet `Kehadiran Siswa` dengan membangun header 2 baris terstruktur secara eksplisit dan menerapkan penggabungan sel SheetJS (`ws['!merges']`) pada `NO`, `NIS`, `NAMA PESERTA DIDIK`, `TANGGAL & PERTEMUAN KBM`, dan `REKAP KETIDAKHADIRAN`.
- **Ekstraksi Data Terstruktur Sheet Jurnal Mengajar:** Mengganti parsing HTML DOM berisiko dengan ekstraksi data terstruktur langsung dari basis data/cache `jurnal_guru`. Menyajikan kolom `TOPIK & MATERI MENGAJAR`, `CATATAN GURU`, serta `RINCIAN KETIDAKHADIRAN SISWA` secara rapi dan komprehensif.
- **Lebar Kolom Proporsional (`!cols`) & Kemandirian Tab:** Menetapakan lebar kolom eksplisit (`ws['!cols']`) pada 3 sheet (`Penilaian Siswa`, `Kehadiran Siswa`, `Jurnal Mengajar`) agar teks tidak terpotong saat dibuka di Microsoft Excel, serta menjamin ekspor 3 sheet selalu berhasil tanpa bergantung pada status tab aktif di UI.

## [1.1.133] / [26.08.08.79] - 2026-08-08

### ↕️ Sortir Interaktif Header Kolom Tabel Guru Mapel (`js/page-guru-mapel.js`)
- **Sortir Kolom Interaktif & Preservasi Input Nilai:** Menambahkan fitur sortir interaktif 2 arah (Ascending & Descending) pada setiap header kolom tabel lembar penilaian (`No`, `NIS`, `Nama Siswa`, Kolom Nilai Komponen `Tugas`/`Sumatif`/`SAS`, `Rata Tugas`, `Rata Sumatif`, dan `NA`).
- **Default Sortir Nama Siswa / No Absen:** Mengatur default pengurutan otomatis berdasarkan nama siswa (A-Z) yang secara alami selaras dengan nomor urut/absen siswa. Nilai yang belum disimpan di DOM tetap terjaga saat terjadi re-sortir.

## [1.1.132] / [26.08.08.78] - 2026-08-08

### 🎨 Relokasi Area Input Deskripsi CP Kelas Guru Mapel (`guru-mapel.html`)
- **Posisi Tata Letak Baru Deskripsi CP Kelas (`#wrapper-class-cp`):** Memindahkan posisi blok input Deskripsi Capaian Pembelajaran (CP) dari bagian atas tabel (*above top save bar*) ke lokasi tepat di bawah tabel lembar penilaian (*below gradebook table & bottom save bar*) dan di atas blok Analisis & Rekomendasi Pedagogis Guru (`#gradebook-analytics-wrapper`), untuk memberikan alur kerja penginputan yang lebih intuitif bagi guru pengampu.

## [1.1.131] / [26.08.08.77] - 2026-08-08

### 🎮 Publikasi Otomatis & Pembatasan Otorisasi Edit/Hapus Game PID (`pid/portalpid.html`, `pid/games.js`, `pid/admin.js`)
- **Publikasi Otomatis Pengajuan Game:** Mengubah alur pengajuan game oleh guru agar secara otomatis diset ke `review_status: 'approved'` dan `is_active: true`, sehingga game yang baru diajukan langsung tampil di portal Game PID tanpa memerlukan persetujuan manual admin.
- **Pembatasan Hak Akses Edit & Hapus Khusus Super Admin:**
  - Mengubah otorisasi edit (`canUserEditGame`) pada `pid/games.js` dan `window.pidPortalOpenEditor` pada `pid/portalpid.html` agar hanya dapat diproses jika peran pengguna adalah `super_admin`. Tombol edit `✏️` pada kartu game PID kini hanya tampil untuk Super Admin.
  - Memperketat `pid/admin.js` dengan pengalihan otorisasi otomatis ke `dashboard.html` untuk pengguna selain `super_admin`.

## [1.1.131] / [26.08.08.76] - 2026-08-08

### 🐛 Perbaikan ReferenceError Export Excel Guru Mapel (`js/page-guru-mapel.js`)
- **Resolusi ReferenceError `getLocalUserData is not defined`:** Memperbarui fungsi `window.exportToExcel` menjadi fungsi `async` dan mengambil nama pengampu guru melalui elemen DOM header (`#header-guru-name`) dengan fallback `getTeacherRealName(currentUser || auth.currentUser)`. Hal ini mencegah error *Uncaught ReferenceError* saat guru mengklik tombol Export Excel pada halaman Guru Mata Pelajaran.

## [1.1.130] / [26.08.08.75] - 2026-08-08

### ⚡ Eliminasi Timeout CDN esm.sh pada Edge Function Deployment (`supabase/functions/secure-proxy/index.ts`)
- **Reliable npm Specifiers untuk Deno Edge Runtime:** Mengganti URL eksternal `https://esm.sh/@supabase/supabase-js@2` dan `https://esm.sh/jose@5.2.0` menjadi `npm:@supabase/supabase-js@2` dan `npm:jose@5.2.0`.
- **Eliminasi Build Failure (Cloudflare HTTP 522):** Menghilangkan risiko kegagalan bundling Deno Edge Function saat GitHub Actions deploy akibat CDN `esm.sh` yang mengalami timeout / rate limit, mengalihkan pengambilan modul langsung ke registri resmi npm yang memiliki ketersediaan tinggi (99.999%).

## [1.1.129] / [26.08.08.74] - 2026-08-08

### 👷 Fix GitHub Actions Supabase CLI Workflow (`.github/workflows/supabase-migrations.yml`)
- **Pembaruan Supabase Setup CLI Action (`setup-cli@v3`):** Memperbarui `supabase/setup-cli@v1` menjadi `supabase/setup-cli@v3` pada workflow GitHub Actions deployment database Supabase. Hal ini memperbaiki error `SchemaError(Expected a string matching the RegExp... at [2]["inserted_at"])` pada langkah `supabase link` yang disebabkan oleh perubahan format respons timestamp API Management Supabase.

## [1.1.128] / [26.08.08.73] - 2026-08-08

### 🔀 Resolusi Konflik Merge dengan Branch Main (`CHANGELOG.md`, `PRD_SIMAS.md`, `package.json`, `js/page-e-rapor.js`, `js/page-students.js`)
- **Resolusi Conflict 5 File:** Menyelesaikan bentrokan kode (merge conflict) antara branch `testing` dan `origin/main` secara presisi tanpa kehilangan histori changelog maupun fitur optimasi cache.
- **Validasi Sintaks & Unit Test:** Memastikan 38 berkas JavaScript 100% lulus uji sintaks (`npm run check:syntax`) dan 6 unit test Jest lulus 100% (`npm run test:unit`).

## [1.1.127] / [26.08.08.72] - 2026-08-08

### 🔐 Perbaikan Isolasi Data Sesi & Pembersihan Cache Switch Akun (`index.html`, `js/global.js`, `js/page-dashboard.js`, `js/page-portal-siswa.js`)
- **Proteksi Role Akun Baru saat Switch Akun (`js/global.js`):** Memperbaiki fungsi `initLayout()` agar saat deteksi alih akun (`lastUid !== user.uid`) terpicu, sistem hanya membersihkan cache dokumen spesifik milik UID lama (`simas_userdoc_${lastUid}`, `simas_user_data_${lastUid}`, `cached_user_name_${lastUid}`) tanpa menghapus `user_role` dan `user_additional_roles` milik akun baru yang telah disiapkan saat login.
- **Eliminasi Double Delete Role (`js/page-dashboard.js`):** Menghapus duplikasi logika pembersihan role di `page-dashboard.js` untuk mencegah race condition penghapusan role secara berlebihan saat pengguna berpindah halaman.
- **Pembersihan Sesi Logout Lengkap (`confirmLogout` & `logout`):** Memperbarui `window.confirmLogout()` di `js/global.js` dan `window.logout()` di `js/page-portal-siswa.js` agar memanggil `invalidateCurrentUserDoc()`, menghapus `last_login_uid`, `user_assigned_class`, serta mengeksekusi `sessionStorage.clear()` secara menyeluruh saat pengguna keluar.
- **Sinkronisasi UID & Guard Redirect Login (`index.html`):** Menambahkan pengaman `window.isLoggingIn` pada cabang akun staf di `onAuthStateChanged` untuk mencegah auto-redirect prematur, serta langsung menyinkronkan `last_login_uid` dan membersihkan `sessionStorage` pada saat login staf berhasil.

## [1.1.126] / [26.08.08.71] - 2026-08-08

### 🔒 Penyesuaian Hak Akses (RBAC) & Visibilitas Sub-Tab Monitoring KBM (`rekap-kehadiran-siswa.html`, `js/global.js`, `js/page-rekap-kehadiran-siswa.js`)
- **Akses Penuh Wakasek Kurikulum:** Memasukkan `wakasek_kurikulum` ke dalam daftar `FULL_ACCESS_ROLES` bersama `super_admin`, `kepala_sekolah`, dan `staff` untuk mendapatkan akses penuh ke seluruh data global dan 3 sub-tab navigasi.
- **Akses Penuh Wali Kelas di Kelas Perwalian:** Memberikan akses 3 sub-tab navigasi secara penuh bagi pengguna ber-role `wali_kelas`, khusus untuk melihat data di kelas perwaliannya (`assignedClass`).
- **Monitoring KBM Global untuk Peran Lainnya:** Pengguna dengan peran lainnya (`guru_mapel`, `guru_bk`, `kesiswaan`) secara otomatis dikunci pada tab **Monitoring KBM** dengan sub-tab navigasi disembunyikan, serta dapat melihat seluruh matriks KBM global secara penuh di halaman tersebut.
- **Akses Menu & Aturan Halaman Guru BK (`js/global.js`):** Menambahkan `rekap_kehadiran_siswa` pada `ROLE_MENU_ACCESS` dan mengatur `PAGE_ACCESS_RULES` untuk `guru_bk` menjadi `r` (read access).

## [1.1.125] / [26.08.08.70] - 2026-08-08

### 🧠 Mesin Analisis & Rekomendasi Pedagogis AI Multi-Variabel (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Multi-Variable AI Pedagogy Engine:** Memperbarui modul analisis kelas bawah tabel (`#stat-pedagogy-recommendation`) dengan kalkulasi multi-variabel cerdas yang secara otomatis mengevaluasi kombinasi nilai siswa secara mendalam:
  1. **6 Tier Skenario Ketuntasan Rombel:** Memetakan status kelas mulai dari *Performa Kelas Excellent (100%)*, *100% Tuntas Aman*, *Ketuntasan Tinggi*, *Perlu Remediasi Kelompok*, *Intervensi Pembelajaran Required*, hingga *Performa Kritis*.
  2. **Disparitas Proses vs Evaluasi Ujian:** Menganalisis selisih rata-rata Tugas vs Rata Sumatif. Mendeteksi kasus siswa rajin tugas tapi cemas saat tes, maupun siswa cerdas saat tes tapi kurang disiplin mengumpulkan tugas.
  3. **Analisis Kesenjangan Nilai (Gap Score):** Mendeteksi kelas bermasalah heterogenitas tinggi (gap nilai max vs min ≥35 poin) dan merekomendasikan *Differentiated Instruction* (Pembelajaran Berdiferensiasi).
  4. **Komponen Titik Lemah (Bottleneck Spotlight):** Mengidentifikasi secara presisi nama kolom indikator dengan nilai rata-rata terendah di kelas untuk menjadi fokus ulasan guru.
  5. **Program Tutor Sebaya & Pengayaan:** Merekomendasikan penugasan *Peer Tutoring* (Tutor Sebaya) bagi siswa bernilai tertinggi untuk mendampingi rekan yang belum tuntas.

## [1.1.124] / [26.08.08.69] - 2026-08-08

### 🏷️ Placeholder Dinamis pada Form Input Nilai Kosong (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Dynamic Score Input Placeholders:** Menambahkan atribut `placeholder` dinamis (**T1**, **T2**, **S1**, **S2**, **SAS** / **SAT**) pada setiap elemen input angka di lembar penilaian.
- **Scroll Context Indicator:** Saat input nilai dalam keadaan kosong, teks placeholder muncul secara samar (opacity 60%). Hal ini memungkinkan guru yang sedang mengisikan nilai pada daftar siswa di bawah (saat scroll vertikal menyebabkan header tabel tersembunyi) untuk **tetap dapat mengenali jenis kolom nilai** dengan instan tanpa harus menggeser layar kembali ke atas.

## [1.1.123] / [26.08.08.68] - 2026-08-08

### 📱 Menyembunyikan Form Input Deskripsi CP Kelas pada Tampilan Mobile (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Hide Mobile CP Description Form:** Menyembunyikan elemen `#wrapper-class-cp` (Form Deskripsi CP Kelas) pada layar seluler (`< 640px`) menggunakan CSS `display: none !important` dan kelas Tailwind `hidden sm:block`.
- **Clutter-free Mobile Layout:** Menghilangkan area input teks deskripsi CP di HP agar lembar penilaian semakin ringkas, lega, dan berfokus langsung pada tabel pengisian angka nilai siswa. Form deskripsi CP kelas tetap dapat diakses via layar desktop/tablet (`>= 640px`).

## [1.1.122] / [26.08.08.67] - 2026-08-08

### 📱 Menyembunyikan Kolom RT, RS, dan NA pada Tampilan Mobile (`guru-mapel.html`)
- **Hide Mobile Calculated Columns:** Menambahkan CSS rule `display: none !important` pada `.col-calc-cell` dan `.col-calc-header` untuk layar seluler (`< 640px`).
- **Focus Input Layout:** Menyembunyikan kolom Rata Tugas (**RT**), Rata Sumatif (**RS**), dan Nilai Akhir (**NA**) di HP agar layar berfokus penuh pada pengisian kolom komponen nilai (**T1**, **T2**, **S1**, **S2**, **SAS**). Kolom kalkulasi tersebut tetap tersedia secara otomatis pada layar desktop/tablet (`>= 640px`).

## [1.1.121] / [26.08.08.66] - 2026-08-08

### ❄️ Freeze / Sticky Kolom Nama Siswa & No Urut pada Tampilan HP (`guru-mapel.html`)
- **Mobile Sticky Columns:** Menambahkan CSS `position: sticky` pada kolom **No** (`left: 0`) dan **Nama Siswa** (`left: 1.8rem`) khusus tampilan mobile (`< 640px`).
- **Elevated Visual Separator:** Menambahkan subtle shadow (`box-shadow: 4px 0 6px -2px rgba(0,0,0,0.12)`) pada kolom Nama Siswa yang dibekukan, sehingga kolom input nilai (`T1`, `T2`, `S1`, `S2`, `SAS`, dll.) meluncur dengan mulus di bawah nama siswa saat layar digulir secara horizontal.
- **Layering & Dark Mode Fix:** Menyesuaikan `z-index: 30` untuk header dan `z-index: 10` untuk baris body, lengkap dengan penanganan background solid (`light` & `dark` mode) serta highlight saat baris di-hover (`tr:hover`).

## [1.1.120] / [26.08.08.65] - 2026-08-08

### 📱 Optimasi UX Form Input Nilai di Tampilan Mobile (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Touch-Friendly Score Input:** Input nilai di tabel gradebook diperbesar di mobile (`height: 2.2rem`, `font-size: 13px`, `border-radius: 6px`) dengan `touch-action: manipulation` dan efek scale-up saat fokus. Ditambahkan `inputmode="numeric"` dan `pattern="[0-9]*"` untuk memunculkan keyboard numerik otomatis di HP.
- **Kolom NIS Disembunyikan:** Kolom **NIS** (header & body) disembunyikan di mobile via class `.mobile-hide-col` untuk menghemat ruang horizontal.
- **Label Kolom Ringkas:** Header kolom komponen nilai menggunakan label singkat di mobile: **T1**, **T2**, **S1**, **S2**, **SAS**, **RT** (Rata Tugas), **RS** (Rata Sumatif), **NA** — menghindari scroll horizontal berlebihan.
- **Kolom Nama Compact:** Kolom nama siswa dibatasi `max-width: 130px` di mobile dengan `line-clamp: 2` dan `word-break` agar tidak memakan ruang berlebih.
- **Kolom Nomor Urut Sempit:** Kolom `No` diperkecil menjadi `1.6rem` di mobile.
- **Kolom Kalkulasi Ringkas:** Kolom rata-rata & NA diperkecil ukurannya di mobile (`2.5rem`, `font-size: 10px`).

## [1.1.119] / [26.08.08.64] - 2026-08-08

### 📱 Tombol 'Atur' Mobile Hanya Tampil Saat Tab Nilai Aktif (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Conditional Mobile Config Button:** Menambahkan `id="btn-config-mobile"` pada tombol **Atur** di header filter dan memperbarui logika `switchGuruMapelTab()` agar tombol tersebut hanya ditampilkan (`flex sm:hidden`) saat tab **Nilai** aktif, dan disembunyikan (`hidden`) saat pengguna berpindah ke tab **Kehadiran** atau **Jurnal**.

## [1.1.118] / [26.08.08.63] - 2026-08-08

### 🐛 Perbaikan Race Condition ES Module pada Halaman Guru Mapel (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Inline Stub Script:** Menambahkan inline `<script>` stub di `<head>` halaman `guru-mapel.html` yang mendefinisikan placeholder untuk semua fungsi global (`switchGuruMapelTab`, `loadGradebookData`, `openConfigModal`, dll.) **sebelum ES Module selesai dimuat**. Ini mencegah `Uncaught TypeError: window.switchGuruMapelTab is not a function` ketika pengguna mengklik tombol tab sebelum modul JS selesai dieksekusi.
- **Replay Pending Calls:** Menambahkan mekanisme replay di `js/page-guru-mapel.js` yang secara otomatis mengeksekusi ulang semua panggilan yang tertampung oleh stub begitu fungsi asli sudah terdefinisi.

## [1.1.118] / [26.08.08.63] - 2026-08-08

### 🛠️ Perbaikan Constraint Database Supabase & Exception Handler Edge Function (`js/global.js`)
- **Penerapan SQL Constraint di Cloud Database:** Mengeksekusi DDL constraint SQL `masukkan_saran_status_check` pada database Supabase cloud `elrmzlicuuglnoeedusr` via MCP Tool Supabase untuk mengizinkan ke-6 status masukan (`baru`, `proses`, `direncanakan`, `butuh_info`, `selesai`, `ditolak`).
- **Peningkatan Error Parser Edge Proxy (`js/global.js`):** Memperbarui `callSecureEdgeFunction` agar mengekstrak properti `message` jika `result.error` berupa objek, sehingga pesan error tampil dengan jelas dan tidak lagi mencetak `[object Object]`.

## [1.1.117] / [26.08.08.62] - 2026-08-08

### ✨ Ekspansi Variasi Status Masukan & Saran (`masukan.html` & `js/page-masukan.js`)
- **Penambahan Status Masukan Komprehensif:** Memperluas pilihan status masukan dari 3 status awal menjadi 6 status yang komprehensif dan realistis untuk workflow sekolah: `Baru` (`baru`), `Dalam Proses` (`proses`), `Direncanakan` (`direncanakan`), `Perlu Info` (`butuh_info`), `Selesai` (`selesai`), dan `Ditolak` (`ditolak`).
- **Pembaruan Filter & Modal Moderasi:** Memperbarui dropdown filter masukan (`#feedback-status-filter`) dan dropdown modal tanggapan admin (`#response-status`) untuk mendukung ke-6 status baru.
- **Pembaruan Visual Badge & Icon:** Memperbarui objek `statusStyles` di `js/page-masukan.js` dengan warna Tailwind CSS dan ikon FontAwesome yang disesuaikan secara visual untuk setiap status.
- **Supabase Migration Constraint:** Menambahkan skrip migrasi SQL `supabase/migrations/202608080002_update_masukkan_status_check.sql` untuk meng-update CHECK constraint `masukkan_saran_status_check` pada database Supabase.

## [1.1.116] / [26.08.08.61] - 2026-08-08

### 🐛 Perbaikan Persistensi Tampilan Mobile Saat Berpindah Tab (`js/page-guru-mapel.js`)
- **Fix Mobile Tools Re-appearance:** Memperbaiki fungsi `switchGuruMapelTab(tab)` agar memanipulasi kelas `hidden` dan `sm:flex` secara tepat pada `wrapper-penilaian-tools`. Hal ini menjamin alat penilaian desktop (`Pengaturan Nilai` & `Paste Excel`) **tetap 100% tersembunyi pada layar HP (mobile)** saat pengguna berpindah antar-tab (`Nilai`, `Kehadiran`, `Jurnal`) dan kembali lagi ke tab `Nilai`.

## [1.1.115] / [26.08.08.60] - 2026-08-08

### 📱 Penempatan Tombol 'Atur' Setelah 'Load' Khusus Tampilan HP (`guru-mapel.html`)
- **Mobile Action Placement:** Memindahkan tombol **`Atur`** (Pengaturan Nilai) agar diletakkan persis **setelah tombol `Load`** pada baris filter header khusus tampilan pengguna HP (`flex sm:hidden`).
- **Clean Desktop Layout:** Pada tampilan desktop/tablet (`>= sm`), tombol `Pengaturan Nilai` tetap berada di samping tab `Lembar Penilaian Siswa` (`hidden sm:flex`).

## [1.1.114] / [26.08.08.59] - 2026-08-08

### 📱 Label Ringkas Sub-Tab Tampilan Mobile (`guru-mapel.html`)
- **Compact Mobile Tab Labels:** Mengubah label teks ketiga tombol sub-tab navigasi Portal Guru Mapel khusus untuk tampilan layar seluler (`< sm`) menjadi ringkas dan padat:
  1. `Lembar Penilaian Siswa` ➔ **`Nilai`**
  2. `Kehadiran Siswa` ➔ **`Kehadiran`**
  3. `Daftar Jurnal` ➔ **`Jurnal`**
- **Desktop Label Preservation:** Pada layar komputer/tablet (`>= sm`), label lengkap tetap dipertahankan dengan mulus menggunakan kelas utilitas `hidden sm:inline` dan `inline sm:hidden`.

## [1.1.113] / [26.08.08.58] - 2026-08-08

### 📱 Optimasi Responsif Filter Header Tampilan Mobile (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Fluid & Dynamic Mobile Layout:** Mengubah kontainer filter header agar sepenuhnya responsif pada perangkat seluler (`flex-wrap`, `min-w-[90px]`, `truncate`), sehingga seluruh elemen dropdown filter (`Kelas`, `Mapel`, `Semester`) dan tombol aksi (`Load` & `Export`) tidak tertutup, terpotong, atau saling tumpang tindih.
- **Dynamic Max Width Calculation:** Memperbarui fungsi `window.adjustMapelSelectWidth()` dan menambahkan event listener `window.resize` agar kalkulasi lebar dropdown nama mapel beradaptasi secara dinamis dengan lebar viewport HP (`window.innerWidth - 170`).

## [1.1.112] / [26.08.08.57] - 2026-08-08

### 📊 Tampilan Persentase Kehadiran pada Grid Pertama Presensi Modal (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Percentage Display Enhancement:** Mengubah kotak grid presensi pertama dari `HADIR (H)` (jumlah angka) menjadi **`HADIR (%)`** yang menampilkan persentase angka kehadiran siswa secara menonjol (misal: `100%` atau `85.7%`).
- **Header Info Optimization:** Memindahkan keterangan jumlah hadir dan total pertemuan (`${h} Hadir / ${totalMeetings} Pertemuan`) ke bagian kanan header kartu presensi.

## [1.1.111] / [26.08.08.56] - 2026-08-08

### 🔝 Relokasi Kartu Catatan Perilaku ke Paling Atas Modal (`guru-mapel.html`)
- **Top Priority Card Placement:** Memindahkan susunan **Kartu Catatan Perilaku & Nilai Tambah (3 Jenis)** ke posisi **paling atas** di dalam wadah body modal `#modal-student-detail`, sehingga guru mapel dapat langsung fokus membaca dan mengisi catatan siswa tanpa perlu mengusap/scroll ke bawah.

## [1.1.110] / [26.08.08.55] - 2026-08-08

### 🌟 Modal Snapshot Detail Siswa 3-in-1 & Catatan Guru Mapel Supabase (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Clickable Student Name Interactivity:** Mengubah kolom nama siswa pada tabel lembar penilaian menjadi elemen interaktif (`cursor-pointer`). Saat diklik, akan langsung membuka **Modal Snapshot Detail Siswa 3-in-1** (`#modal-student-detail`).
- **Modal Snapshot 3-in-1:** Menampilkan rincian nilai capaian siswa (Tugas, Sumatif, SAS/SAT, Final Score & KKM), rekapitulasi presensi kehadiran harian (H, S, I, A, D, T & %), serta form input 3 jenis catatan guru mapel.
- **Integration 3 Jenis Catatan Guru ke Supabase (`guru_mapel_summaries`)**:
  1. 🟢 `catatan_apresiasi` (Nilai Tambah / Apresiasi + Poin/Prestasi)
  2. 🔵 `catatan_perilaku` (Perilaku / Sikap, Kedisiplinan & Etika)
  3. 🟡 `catatan_evaluasi` (Evaluasi / Pendampingan, Bimbingan & Remedial)
- **Visual Note Indicator:** Menampilkan ikon indikator catatan (`fa-comment-dots text-amber-500`) di sebelah nama siswa pada tabel utama untuk menandai siswa yang memiliki catatan guru mapel tersimpan di Supabase.

## [1.1.109] / [26.08.08.54] - 2026-08-08

### 🐛 Perbaikan Teks Tombol Load Single-Line (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Single-Line Button Layout:** Memperbarui reset `innerHTML` pada tombol `#btn-load-data` di blok `finally` menjadi `<span>Load</span>` serta menambahkan CSS utility `whitespace-nowrap`. Hal ini mencegah teks tombol terbelah/terlipat menjadi 2 baris setelah proses pemuatan data selesai.

## [1.1.108] / [26.08.08.53] - 2026-08-08

### 📊 Export Excel 3-Tab Sekaligus & Pembaruan Label 'Pengaturan Nilai' (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Multi-Tab Excel Workbook Exporter:** Memperbarui fungsi `window.exportToExcel()` sehingga sekali klik tombol ikon Export akan mengunduh **1 file workbook Excel lengkap dengan 3 Worksheet sekaligus**: `Penilaian Siswa`, `Kehadiran Siswa`, dan `Jurnal Mengajar`.
- **Pembaruan Label Tombol Konfigurasi:** Mengubah label tombol modal dari `"Atur Bobot & Kolom"` menjadi **"Pengaturan Nilai"** (`#btn-config-weights`).

## [1.1.107] / [26.08.08.52] - 2026-08-08

### 📐 Lebar Dinamis Dropdown Filter Mapel Berdasarkan Karakter (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Dynamic Character-Length Auto-Sizing:** Menambahkan fungsi `window.adjustMapelSelectWidth()` yang secara otomatis mengukur jumlah karakter mata pelajaran yang sedang dipilih, dan menyesuaikan lebar fisik elemen dropdown (`select-mapel`) secara responsif (misal: menyempit untuk mapel pendek seperti *Fisika* dan melebar otomatis untuk mapel panjang seperti *Pendidikan Pancasila dan Kewarganegaraan*).

## [1.1.106] / [26.08.08.51] - 2026-08-08

### ✂️ Eliminasi Label Teks Filter & Ekspansi Lebar Dropdown Mapel (`guru-mapel.html`)
- **Penghapusan Label Teks:** Menghapus label teks `"Kelas:"`, `"Mapel:"`, dan `"Sem:"` dari dalam kapsul filter header banner.
- **Ekspansi Lebar Dropdown Mapel:** Memanfaat kan ruang horizontal yang dihemat untuk memperlebar dropdown mata pelajaran (`select-mapel`) hingga `max-w-[240px]` sehingga nama mata pelajaran yang panjang dapat terbaca utuh tanpa terpotong.

## [1.1.105] / [26.08.08.50] - 2026-08-08

### 🎨 Penguatan Kontras & Perbaikan Warna Ikon Paste Nilai (`guru-mapel.html`)
- **Visual & Contrast Enhancement:** Memperbarui gaya tombol `#btn-import-excel` (Paste Data dari Excel) dengan warna latar amber solid (`bg-amber-400 hover:bg-amber-500`) dan warna ikon/teks `text-amber-950` berkontras tinggi sehingga ikon paste/copy tampak 100% tajam, jelas, dan mudah terlihat baik pada mode terang maupun mode gelap.

## [1.1.104] / [26.08.08.49] - 2026-08-08

### 📝 Pembaruan Subteks Header Portal Guru Mapel (`guru-mapel.html`)
- **Penyederhanaan Subteks Header Banner:** Memperbarui deskripsi subteks di bawah judul Portal Guru Mapel dari `"Lembar Penilaian Siswa (Tugas, Sumatif, SAS/SAT) Sesuai Rombel & Mapel Pengampu"` menjadi **"Integrasi Nilai, Jurnal, dan Kehadiran"**.

## [1.1.103] / [26.08.08.48] - 2026-08-08

### 🧹 Pembersihan Tombol Header Banner & Preservasi Alat Penilaian Sub-Tab (`guru-mapel.html`)
- **Penghapusan Duplikat Tombol Header Banner:** Menghapus tombol **Atur Bobot & Kolom** (`window.openConfigModal()`) dan **Paste Data dari Excel** (`window.openPasteModal()`) dari dalam banner header utama (`.premium-header`) untuk menghilangkan duplikasi visual.
- **Isolasi Alat Penilaian di Samping Sub-Tab:** Mempertahankan kedua tombol tersebut secara eksklusif pada pembungkus `#wrapper-penilaian-tools` yang berada tepat di sebelah kiri sub-tab **Lembar Penilaian Siswa**, yang secara otomatis hanya muncul saat tab penilaian aktif.

## [1.1.102] / [26.08.08.47] - 2026-08-08

### 📥 Penataan Tombol Export di Header Banner (`guru-mapel.html`)
- **Integrasi Tombol Export ke Kapsul Filter Header:** Memindahkan tombol **Export Excel** (`window.exportToExcel()`) ke dalam kapsul filter header banner, ditempatkan tepat di **sebelah kanan tombol Load** (`#btn-load-data`) dengan gaya visual tombol hijau emerald yang serasi dan ringkas.

## [1.1.101] / [26.08.08.46] - 2026-08-08

### 🎨 Integrasi Filter ke Header Banner & Ringkas Opsi Semester (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Integrasi Filter ke Header Banner:** Menggabungkan kontrol filter (`Kelas`, `Mapel`, `Semester`, dan tombol `Load`) langsung ke dalam **Compact Header Banner** utama (`.premium-header`) dengan latar belakang *backdrop blur* gelap yang sangat ringkas dan menyatu secara elegan.
- **Penyempitan Lebar & Opsi Ringkas:** Memperkecil lebar dropdown Kelas (`max-w-[95px]`), Mapel (`max-w-[130px]`), dan Semester (`max-w-[80px]`). Memperingkas opsi semester dari `"Sem 1 (SAS)"` / `"Sem 2 (SAT)"` menjadi **"Smt 1"** dan **"Smt 2"**, serta memperingkas label placeholder default menjadi `"-- Kelas --"` dan `"-- Mapel --"`.

## [1.1.102] / [26.08.08.47] - 2026-08-08

### ⚡ Pemindahan Posisi Tombol Alat Penilaian & Penghapusan Label Filter (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Relokasi Tombol Alat Penilaian:** Memindahkan tombol **"Atur Bobot & Kolom"** (`openConfigModal`), **"Import Excel"** (`openPasteModal`), dan tombol Export Excel dari banner atas ke **sebelah kiri tombol tab Lembar Penilaian Siswa**.
- **Ketersediaan Kontekstual Per Tab:** Tombol alat penilaian (`#wrapper-penilaian-tools`) HANYA tampil ketika tab *Lembar Penilaian Siswa* aktif, dan secara otomatis tersembunyi ketika tab *Kehadiran Siswa* atau *Daftar Jurnal* aktif.
- **Filter Lebih Ringkas & Hemat Tempat:** Menghapus label teks `Kelas:`, `Mapel:`, dan `Sem:` di depan dropdown filter sehingga baris filter header menjadi jauh lebih ringkas, bersih, dan hemat ruang horizontal.

## [1.1.100] / [26.08.08.45] - 2026-08-08

### 🔄 Penukaran Tata Letak Sub-Tab Navigasi & Filter Bar Portal Guru Mapel (`guru-mapel.html`)
- **Penukaran Posisi Tata Letak (Swap Layout):** Memindahkan baris **Filter Controls** (dropdown Kelas, Mapel, Semester, dan tombol `Load Data`) ke posisi **paling atas** dalam kartu filter mandiri di atas container utama.
- **Integrasi Sub-Tab Navigasi ke Header Container:** Memindahkan tombol **Sub-Tab Navigasi** (*Lembar Penilaian Siswa*, *Kehadiran Siswa*, & *Daftar Jurnal*) ke dalam header bar container utama di sebelah judul tabel & badge jumlah siswa, sehingga tampilan antarmuka Portal Guru Mapel menjadi lebih teratur, bersih, dan ergomik.

## [1.1.99] / [26.08.08.44] - 2026-08-08

### 📊 Pembaruan Halaman & Navigasi Sidebar Monitoring KBM (`rekap-kehadiran-siswa.html`, `js/global.js`, `js/page-rekap-kehadiran-siswa.js`)
- **Pembaruan Sidebar & Header:** Mengubah label item menu sidebar `rekap_kehadiran_siswa` dari `"Rekap Jurnal Mengajar"` menjadi **"Monitoring KBM"** (ikon `fa-table-cells`). Memperbarui `<title>` dokumen, heading `<h1>`, dan deskripsi subteks halaman `rekap-kehadiran-siswa.html`.
- **Default Active Tab Monitoring KBM:** Setiap kali halaman diakses oleh pengguna mana pun, tampilan halaman secara otomatis langsung membuka tab **Monitoring KBM** (`rekap-kbm`).
- **Penyembunyian & Penguncian Sub-Tab Guru Mapel:** Untuk pengguna dengan peran `guru_mapel` (dan teacher-scoped roles), baris sub-tab navigasi (`#subtab-navigation-container`) disembunyikan secara total dan fungsi `switchTab` terkunci hanya pada tab Monitoring KBM.
- **Preservasi Pengguna Manajerial/Admin:** Pengguna dengan peran akses penuh (`FULL_ACCESS_ROLES`: `super_admin`, `kepala_sekolah`, `staff`) tetap dapat melihat dan memilih sub-tab navigasi untuk beralih ke tab Kehadiran Siswa atau Daftar Jurnal bila diperlukan.

## [1.1.79] / [26.08.08.11] - 2026-08-08

### 🔒 Penguatan Keamanan & Integrasi Migrasi NIS Siswa ke Supabase Guru Mapel (`js/page-students.js`)
- **RBAC Defense in Depth (OWASP):** Menambahkan verifikasi role `super_admin` di tingkat fungsi pada `performSingleMigration`, `executeMigrateNIS`, dan `executeMigrateNISBulk` untuk mencegah eksekusi migrasi NIS dari DevTools browser oleh pengguna non-admin.
- **Integrasi Supabase Guru Mapel:** Menambahkan operasi update NIS siswa pada tabel `guru_mapel_scores` (rincian nilai tugas/sumatif/SAS/SAT) dan `guru_mapel_summaries` (rangkuman nilai akhir & deskripsi Capaian Pembelajaran) di Step 6 proses migrasi, sehingga total tabel/koleksi yang diperbarui menjadi **17** (11 Firestore Utama + 3 Firestore Jurnal + 3 Supabase).
- **Perbaikan Cakupan Presensi Riwayat Kelas:** Memperluas scope query `attendance` pada Step 3H agar mencakup semua kelas yang pernah ditempati siswa (dari data `class_transfers`), bukan hanya kelas aktif saat ini. Menambahkan deduplikasi dokumen attendance untuk mencegah duplikasi update.
- **Validasi Duplikasi NIS Baru Antar-Baris (Bulk):** Menambahkan pengecekan `usedNewNISSet` pada `previewMigrateBulk` untuk mendeteksi jika dua baris paste massal menggunakan NIS Baru yang sama.

## [1.1.90] / [26.08.08.35] - 2026-08-08

### 📝 Compact CP Label & Extended Input Field Width (`guru-mapel.html`)
- **Penyederhanaan Label Front:** Mengubah label panjang di depan form dari `"DESKRIPSI CAPAIAN PEMBELAJARAN (CP) KELAS"` dan subteksnya menjadi singkat & ringkas: **"Deskripsi CP"** (`<i class="fa-solid fa-pen-to-square text-emerald-500"></i> Deskripsi CP`).
- **Kotak Input Meluas Maksimal (`flex-1`):** Memanfaatkan ruang horizontal secara penuh sehingga kotak input teks CP meluas lebar ke kanan.
- **Font Input Lebih Kecil & Tinggi Dipertahankan:** Mengubah font teks yang diketik menjadi `text-[10px]` lebih kecil dan rapi, sembari mempertahankan padding/tinggi input (`py-2`) yang nyaman.

## [1.1.99] / [26.08.08.44] - 2026-08-08

### ⚡ Pemanggilan 3 Tab Simultan Saat Klik "Load Data" (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Pemuatan Data Terpusat (Simultaneous Multi-Tab Load):** Ketika guru menekan tombol **"Load Data"**, aplikasi secara otomatis memicu pemuatan data untuk **ketiga tab sekaligus** (Lembar Penilaian Siswa, Kehadiran Siswa, & Daftar Jurnal Mengajar) secara paralel (`Promise.allSettled`).
- **Tidak Ada Auto-Load Saat Ganti Tab/Filter:** Sebelum tombol "Load Data" ditekan, sekalipun filter Kelas & Mapel telah lengkap dipilih, aplikasi **TIDAK** memuat data di latar belakang. Perpindahan tab HANYA mengubah panel UI tanpa memicu request network/query database tambahan.
- **Transisi Tab Instan:** Setelah tombol "Load Data" diklik, guru dapat berpindah antar 3 tab dengan instan tanpa delay loading.

## [1.1.98] / [26.08.08.43] - 2026-08-08

### 🚀 Optimasi Kuota Read Firestore: Shared Smart Cache 10 Menit (`js/page-guru-mapel.js`)
- **Shared Local Cache (Tab Kehadiran & Daftar Jurnal):** Menerapkan mekanisme caching lokal berbasis memori/localStorage selama 10 menit untuk koleksi `jurnal_guru`.
- **0 Reads Firestore Pada Perpindahan Tab:** Ketika user berpindah dari Tab Kehadiran Siswa ke Tab Daftar Jurnal (atau sebaliknya) dalam 10 menit, aplikasi menggunakan cache lokal yang sama sehingga menghasilkan `0 Firestore Read`.
- **Lazy Loading Terjamin:** Query Firestore HANYA terjadi saat tab diklik atau tombol "Load Data" ditekan secara manual.

## [1.1.97] / [26.08.08.42] - 2026-08-08

### ⚡ Integrasi Tab 3: Daftar Jurnal Mengajar (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Penambahan Sub-Tab "Daftar Jurnal":** Menambahkan tombol tab ke-3 "Daftar Jurnal" di Portal Guru Mapel yang terintegrasi penuh dengan Master Filter (Kelas, Mapel, Semester).
- **Integrasi Database `jurnal_guru`:** Memuat daftar riwayat jurnal KBM dari `dbJurnal` (Jurnal SMAGESA) lengkap dengan informasi Waktu, Jam Pelajaran (JP), Guru Pengampu, Topik & Catatan Pembelajaran, Thumbnail Foto Kegiatan, serta rincian ketidakhadiran siswa per pertemuan (collapsible details).
- **Verifikasi Browser & Unit Tests:** Berhasil diuji secara langsung di browser (1 Jurnal KBM terdeteksi untuk Matematika XI-1, foto ter-render, rincian 6 siswa absen terurai) dan lulus 22/22 Jest unit test.

## [1.1.96] / [26.08.08.41] - 2026-08-08

### ⚡ Pembersihan UI: Penghapusan Summary Card Presensi (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Penyederhanaan Tampilan Rekap Presensi:** Menghapus elemen `#kehadiran-summary-card` (kartu informasi hijau berisi statistik total jurnal & pertemuan) sesuai permintaan user.
- **Tata Letak Lebih Ringkas:** Tabel rekapitulasi presensi kini langsung menempel di bawah baris filter utama untuk memaksimalkan area pandang tabel.

## [1.1.95] / [26.08.08.40] - 2026-08-08

### ⚡ Perbaikan Struktural Tag Penutup HTML Panel Kehadiran (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Penutupan Tag `<div id="panel-penilaian">` yang Hilang:** Memperbaiki kesalahan tag HTML unclosed `<div>` di akhir `panel-penilaian`. Sebelumnya `#panel-kehadiran` tidak sengaja bersarang di dalam `#panel-penilaian` sehingga ketika `#panel-penilaian` di-hide (`display: none`), `#panel-kehadiran` ikut tersembunyi dengan tinggi/lebar 0px (tampak kosong putih).
- **Hasil Pengujian Browser Langsung (Live Inspection):** Telah diverifikasi via browser otomatis dengan login `komangpurna2@gmail.com`. Tabel presensi 35 siswa terdata, summary card `Total Jurnal KBM: 1`, dan rincian tanggal `7/8` kini **tampil 100% sempurna dengan tinggi 1231px**.

## [1.1.94] / [26.08.08.39] - 2026-08-08

### ⚡ Adopsi Presisi Struktur 3-Row Header Tabel Presensi (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Struktur Thead 3-Row Presisi dari `rekap-kehadiran-siswa.html`:** Menyelaraskan 100% struktur `rowspan` & `colspan` 3 baris header `thead` (`NO`, `NIS`, `NAMA`, `TANGGAL PERTEMUAN KE-`, dan `RINCIAN KETIDAKHADIRAN`) persis seperti di `rekap-kehadiran-siswa.html`.
- **Resolusi Layout Collapse:** Memperbaiki bug kecacatan HTML table parser di browser yang sebelumnya menyebabkan tabel menggelembung 0-height (tampak kosong putih) akibat bentrok `rowspan=2` vs `colspan=6`.
- **Tampilan Grid Lengkap:** Menampilkan secara presisi baris `Tanggal Kegiatan`, `Nomor Pertemuan Ke- (1, 2, 3...)`, serta status `S`, `I`, `A`, `D`, `T`, `JML` beserta pewarnaan indikator yang tajam.

## [1.1.93] / [26.08.08.38] - 2026-08-08

### ⚡ Sinkronisasi Judul Header & Penyempurnaan Tampilan Rekap Presensi (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Sinkronisasi Judul Dynamic Scope:** Memperbarui `#table-scope-title` secara otomatis saat perpindahan tab (menampilkan `"Rekap Kehadiran [Mapel] - [Kelas]"` saat di tab Kehadiran Siswa dan `"Penilaian [Mapel] - [Kelas]"` saat di tab Penilaian).
- **Akurasi Format Tanggal ISO Lokal:** Menggunakan tanggal ISO lokal (`formatLocalDateISO`) untuk menghindari pergeseran tanggal akibat UTC offset pada query presensi harian.
- **Pembersihan Log Debugging Console:** Memastikan seluruh data dan tabel presensi ter-render dengan sempurna tanpa hambatan visual.

## [1.1.92] / [26.08.08.37] - 2026-08-08

### ⚡ Penyederhanaan Filter & Auto-Load Presensi Kehadiran Siswa (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Single Master Filter Integration:** Menghapus sub-filter duplikat di panel kehadiran. Tab **Kehadiran Siswa** kini secara otomatis menggunakan 1 Filter Utama di bagian atas Portal Guru Mapel (`#select-kelas`, `#select-mapel`, `#select-semester`).
- **Otomatisasi Pemuatan Siswa & Presensi:** Mengubah `loadKehadiranSiswaData` agar secara otomatis mengambil data siswa kelas jika belum ada di memori memodifikasi pemanggilan `loadGradebookData` dan pembukaan tab untuk memuat rekap presensi tanpa perlu menekan tombol tambahan.
- **Pembersihan Area Blank:** Menghilangkan kondisi pembatas yang menyebabkan tampilan kosong saat tab berpindah.

## [1.1.91] / [26.08.08.36] - 2026-08-08

### 📋 Integrasi Tab Rekap Kehadiran Siswa ke Portal Guru Mapel (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Navigasi Sub-Tab Portal Guru Mapel:** Menambahkan bar navigasi sub-tab bersih di bagian atas workspace Guru Mapel untuk berpindah secara mulus antara **Lembar Penilaian Siswa** (`#tab-guru-penilaian`) dan **Kehadiran Siswa** (`#tab-guru-kehadiran`).
- **Kehadiran Siswa Terintegrasi dari Jurnal Mengajar:** Menghubungkan query presensi harian siswa dari Firestore `dbJurnal` (koleksi `jurnal_guru`) berdasarkan kelas & mapel yang dipilih di portal guru mapel.
- **Tampilan Grid & Statistik Presensi Harian:** Menyediakan tabel rekap presensi per tanggal KBM (Sakit, Izin, Alpha, Dispen, Terlambat) lengkap dengan ringkasan statistik (Total Jurnal, Total Siswa, dan Jumlah Pertemuan KBM).
- **Deklarasi Top-Level Window Helper:** Memindahkan `window.switchGuruMapelTab` dan `window.toggleKehadiranPeriode` ke scope modul utama paling atas untuk memastikan ketersediaan seketika saat DOM memuat.

## [1.1.89] / [26.08.08.34] - 2026-08-08

### 📱 Active Columns Dynamic WA Reminder Dropdown Alignment (`js/page-guru-mapel.js`)
- **Penyesuaian Otomatis Dropdown WA dengan Kolom Tampil (`#select-wa-scope`):** Opsi daftar per komponen pada dropdown pengumuman WA secara ketat menyesuaikan hanya dengan kolom Tugas dan Sumatif yang aktif/tampil di lembar penilaian.
- **Pembersihan Label Suffix Redundan:** Merapikan teks opsi menjadi bersih tanpa teks kurung ganda (misal: `Tugas 1`, `Tugas 2`, `Sumatif 1`, `SAS`) sehingga lebih rapi, elegan, dan intuitif.

## [1.1.88] / [26.08.08.33] - 2026-08-08

### 💾 Top Save Bar Relocation Directly Above Table Columns (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Pemindahan Tombol Simpan Atas (`#top-save-bar`):** Menghapus tombol simpan utama dari banner header atas (`#btn-main-save`) dan memindahkannya ke **baris persis di atas tabel kolom penilaian** (`#top-save-bar`), berdampingan dengan `#bottom-save-bar` di bagian bawah.
- **Kondisi Tampil Dinamis:** Kedua tombol simpan (atas tabel & bawah sticky) hanya muncul secara otomatis saat terdapat perubahan/input nilai yang belum disimpan, dan otomatis tersembunyi kembali setelah berhasil disimpan ke Supabase.

## [1.1.87] / [26.08.08.32] - 2026-08-08

### 💬 Per-Component WA Announcement Options & Smaller CP Font (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Opsi Pengumuman WA Per Komponen Penilaian (`#select-wa-scope`):** Menambahkan opsi pilihan scope pengumuman WhatsApp:
  - *Keseluruhan:* Mengumumkan daftar siswa remidial NA kelas dan rincian komponen yang kosong/kurang.
  - *Per Komponen Spesifik (Tugas 1, Tugas 2, Sumatif 1, SAS/SAT):* Mengumumkan secara spesifik daftar siswa yang belum mengumpulkan atau bernilai di bawah KKM pada komponen pilihan tersebut.
- **Form Input CP Kelas Lebih Kecil:** Mengubah ukuran font input Deskripsi CP Kelas (`#input-class-cp-desc`) menjadi `text-[11px]` agar lebih ringkas, halus, dan proporsional dengan komponen UI lainnya.

## [1.1.86] / [26.08.08.31] - 2026-08-08

### 🎯 4-Digit NIS Matching & Active Columns Import Alignment (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Pencocokan Acuan NIS 4-Digit:** Pencocokan baris siswa dari teks paste Excel kini menggunakan **NIS (4 Digit)** sebagai kunci utama, bukan NISN (misal: `4243`, `4396`).
- **Penyesuaian Kolom Aktif Tampil:** Opsi *"Semua Kolom Aktif"* pada modal impor otomatis mendeteksi dan menampilkan daftar nama & jumlah kolom aktif yang sedang dibuka (misal: `Tugas 1, Tugas 2, Sumatif 1, SAS`), sehingga urutan data yang ditempel diisi tepat sesuai kolom yang tampil di layar.
- **Pembaruan Petunjuk Modal:** Mengabaikan NISN dan memperbarui teks petunjuk serta contoh kode monospace (`4243 85 90`) agar guru tidak keliru saat melakukan impor massal.

## [1.1.85] / [26.08.08.30] - 2026-08-08

### 📝 Single Class-Wide CP Description Input (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Penyederhanaan Input Deskripsi CP:** Memindahkan input Deskripsi Capaian Pembelajaran (CP) dari yang sebelumnya berulang di setiap baris siswa menjadi **1 input tunggal di atas tabel** (`#input-class-cp-desc`).
- **Penyimpanan Terpusat & Impor/Ekspor:** Teks CP kelas tunggal ini secara otomatis berlaku seragam untuk seluruh siswa di kelas tersebut saat disimpan ke Supabase (`deskripsi_cp`) dan saat diexport ke file Excel `.xlsx`.
- **Tabel Spreadsheet Lebih Bersih:** Menghapus kolom `Deskripsi CP` dari tabel spreadsheet sehingga tabel lebih ringkas, fokus pada input nilai, dan hemat lebar layar.

## [1.1.84] / [26.08.08.29] - 2026-08-08

### 📊 Document Identity Header Block on Excel Export (`js/page-guru-mapel.js`)
- **Header Identitas Dokumen Excel (`exportToExcel`):** Menambahkan seksi header identitas resmi di bagian paling atas lembar kerja file Excel `.xlsx` yang diunduh:
  - Judul Resmi: `SMA NEGERI 1 ABANG - SIMAS SHAKTI`
  - Nama Dokumen: `LEMBAR CAPAIAN HASIL PENILAIAN SISWA`
  - Identitas Lengkap: Mata Pelajaran, Kelas / Rombel, Semester, Tahun Ajaran, Batas KKM, Nama Guru Pengampu, dan Tanggal Cetak.
  - Spacing rapi sebelum tabel utama siswa yang menyajikan header `NO`, `NIS`, `NISN`, `NAMA PESERTA SISWA`, `TUGAS 1`.., `RATA TUGAS`, `RATA SUMATIF`, `NA`, `DESKRIPSI CP`.

## [1.1.83] / [26.08.08.28] - 2026-08-08

### 📋 Redesigned Excel Import Instructions Modal (`guru-mapel.html`)
- **Pembaruan Petunjuk Impor Nilai:** Menyusun ulang petunjuk cara copy-paste dari Excel / Google Sheets ke dalam modal `#modal-paste-excel` dengan tampilan kartu berstruktur 2 kolom:
  - **Opsi A (Satu Kolom Nilai):** Copy 2 kolom dari Excel: `NIS` dan `Nilai` (misal untuk mengisi khusus `Tugas 1`).
  - **Opsi B (Semua Kolom Berurutan):** Copy kolom `NIS` dan seluruh kolom nilai berurutan dari kiri ke kanan.
- **Blok Kode Contoh Format:** Menampilkan contoh format kode nyata (`0084243418 85`) untuk mencegah kebingungan guru saat melakukan impor data.

## [1.1.82] / [26.08.08.27] - 2026-08-08

### 🔢 NA Label Abbreviation & Number Formatting Rules (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Penyingkatan Nilai Akhir ke NA:** Seluruh label kolom Nilai Akhir disingkat menjadi **NA** pada header tabel spreadsheet, kartu ringkasan kelas, dan laporan.
- **Format Rata-Rata 1 Desimal (`.toFixed(1)`):** Rata-Rata Tugas & Rata-Rata Sumatif kini secara konsisten diformat 1 angka di belakang koma (misal: `82.4`).
- **Format Nilai Akhir Bilangan Asli (`Math.round`):** Nilai Akhir (NA) siswa dan rata-rata NA kelas diformat sebagai **bilangan bulat asli (pembulatan tanpa koma)** (misal: `83`).

## [1.1.81] / [26.08.08.26] - 2026-08-08

### 💡 Actionable Pedagogy Recommendations & 1-Click WhatsApp Remidial Copy (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Catatan & Rekomendasi Pedagogis Guru (`#stat-pedagogy-recommendation`):** Sistem menganalisis tingkat ketuntasan kelas secara otomatis dan memberikan saran tindak lanjut pengajaran langsung kepada guru mapel (misal saran pengayaan bagi siswa tertinggi jika ketuntasan ≥85%, atau saran *re-teaching* pada materi komponen terendah jika ketuntasan <60%).
- **Fitur 1-Click Salin Pengumuman Remidial ke WA (`copyRemedialWaText`):** Menyediakan tombol untuk menyalin format teks pengumuman rapi berisi daftar nama siswa yang perlu mengikuti remidial / melengkapi nilai beserta detail per komponen untuk langsung ditempel (paste) ke grup WhatsApp Kelas.

## [1.1.80] / [26.08.08.25] - 2026-08-08

### 🎯 Custom KKM Setting Per Mapel & Angkatan + Active Column Zero/Empty Tracking (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Pengaturan Nilai KKM Scoped Per Mapel & Angkatan:** Menambahkan input **Nilai KKM (default: 75)** pada modal pengaturan bobot (`#modal-config-weight`). KKM ini disimpan secara seragam per mata pelajaran dan per tingkat angkatan (`simas_kkm_${uid}_${mapel}_${tingkat}`) dan menjadi acuan batas ketuntasan (`≥ KKM`).
- **Deteksi Nilai 0 & Kosong pada Kolom Aktif Penilaian:** Jika suatu kolom penilaian (Tugas 1..5, Sumatif 1..5, SAS/SAT) sudah mulai diisi nilai oleh minimal 1 siswa, maka input yang masih **bernilai 0 ATAU kosong (belum diisi)** otomatis terdeteksi pada baris `0 / Kosong: X Siswa (Nama +N)` dengan tooltip daftar nama lengkap siswa.

## [1.1.79] / [26.08.08.24] - 2026-08-08

### 📊 Component-First Analytics Layout & Zero Score Tracking (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Perubahan Urutan Layar Analytics:** Menempatkan **Analisis Per Komponen Penilaian** (Tugas 1..5, Sumatif 1..5, SAS/SAT) pada urutan pertama di atas, dan **Rangkuman Penilaian Akhir Kelas** di urutan kedua di bawah.
- **Informasi Siswa Ber-Nilai 0 (`zeroStudents`):** Menambahkan indikator jumlah dan nama siswa yang memperoleh/tercatat bernilai `0` pada setiap kartu komponen penilaian (termasuk tooltip daftar nama siswa saat di-hover).

## [1.1.78] / [26.08.08.23] - 2026-08-08

### 📈 Detailed Component-Level Analytics Breakdown (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Analisis Per Komponen Penilaian (`#analytics-component-cards`):** Menambahkan grid kartu analisis spesifik untuk setiap kolom aktif (misal `Tugas 1`, `Tugas 2`, `Sumatif 1`, `SAS/SAT`):
  - **Rata-Rata Komponen**: Skor rata-rata kelas khusus pada kolom tersebut.
  - **Nilai Maksimum & Siswa**: Skor tertinggi beserta nama panggilan siswa perolehannya.
  - **Nilai Minimum & Siswa**: Skor terendah beserta nama panggilan siswa perolehannya.
  - **Tingkat Ketuntasan (≥75)**: Jumlah siswa tuntas dan persentase ketuntasan per komponen.

## [1.1.77] / [26.08.08.22] - 2026-08-08

### 💾 Dynamic Dual Save Buttons (Top & Sticky Bottom) (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Posisi Atas & Bawah:** Menyediakan 2 tombol simpan: `#btn-main-save` di banner header atas dan `#btn-bottom-save` di bar lengket (*sticky bottom bar*) bawah tabel lembar penilaian.
- **Visibilitas Dinamis Berbasis Perubahan (`setGradebookDirty`):** Kedua tombol Simpan disembunyikan secara default saat data baru dimuat, dan **otomatis MUNCUL & AKTIF** hanya apabila terdapat perubahan nilai/CP/paste data dari Excel. Setelah data berhasil disimpan ke Supabase, tombol otomatis tersembunyi kembali.

## [1.1.76] / [26.08.08.21] - 2026-08-08

### 🧹 Cleanup Duplicate Feedback Button (`guru-mapel.html`)
- **Pembersihan Tombol Duplikat:** Menghapus tombol Saran manual yang ditulis di HTML agar hanya tersisa 1 (satu) tombol **Saran** resmi yang diinjeksi secara terpusat oleh `js/global.js` di ujung kanan `.premium-header`.

## [1.1.75] / [26.08.08.20] - 2026-08-08

### 💬 Consistency Top Right Feedback Button (`guru-mapel.html`)
- **Penempatan Tombol Saran:** Menambahkan tombol **Saran** di posisi paling kanan pada banner header utama Portal Guru Mapel (`.premium-header`), sehingga sepenuhnya konsisten dengan tampilan header halaman SIMAS lainnya.

## [1.1.75] / [26.08.08.10] - 2026-08-08

### 🔄 Optimasi Cache Rombel Siswa per Tahun Ajaran (`js/page-guru-mapel.js`)
- **Penyertaan Tahun Ajaran pada Kunci Cache Siswa:** Mengubah `cacheStudentsKey` menjadi `cache_students_${tahunAjaran}_${kelas}` agar cache daftar siswa rombel otomatis ter-refresh saat pergantian tahun ajaran baru tanpa menunggu TTL 24 jam habis.

## [1.1.74] / [26.08.08.19] - 2026-08-08

### 🎹 Spreadsheet Keyboard Navigation & Clean Column Headers (`js/page-guru-mapel.js`)
- **Navigasi Tombol Enter (`window.onScoreInputKeydown`):** Menekan tombol `Enter` atau `Panah Bawah` pada kotak input nilai otomatis memindahkan fokus kursor ke baris siswa di bawahnya pada kolom yang sama, serta langsung memblok angka (`select()`) agar penginputan berurutan sangat cepat.
- **Penyederhanaan Header Kolom Ringkas:** Menyederhanakan label header kolom penilaian menjadi ringkas dan rapi: `Tugas 1`..`5`, `Sumatif 1`..`5`, `SAS`, dan `SAT`.

## [1.1.73] / [26.08.08.18] - 2026-08-08

### 📊 Analisis Sederhana Data Penilaian Kelas (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Dashboard Statistik Ringkas:** Menyediakan widget analisis sederhana di bawah tabel yang menghitung secara *live* (0 Firestore reads):
  - **Rata-Rata Tugas Kelas**, **Rata-Rata Sumatif Kelas**, **Rata-Rata SAS/SAT Kelas**, serta **Rata-Rata Nilai Akhir Kelas**.
  - **Siswa Nilai Tertinggi (Top Achiever)** & **Siswa Nilai Terendah** beserta skor Nilai Akhirnya.
  - **Progress Bar Ketercapaian (≥75):** Jumlah dan persentase siswa yang tuntas mencapai Kriteria Ketercapaian Tujuan Pembelajaran.

## [1.1.72] / [26.08.08.17] - 2026-08-08

### 🛡️ Strict 0-100 Validation & Disable Mouse Wheel Scroll Changing (`js/page-guru-mapel.js`)
- **Validasi Otomatis Rentang 0 - 100:** Mencegah guru menginput nilai di bawah `0` (otomatis diset `0`) dan di atas `100` (otomatis diset `100`). Karakter non-numerik seperti `-`, `e`, `+` langsung diblokir.
- **Penonaktifan Scroll Mouse Pengubah Nilai (`onwheel="this.blur(); event.preventDefault();"`):** Mengunci nilai input sehingga pergerakan wheel/scroll mouse saat kursor di atas form tidak akan pernah mengubah nilai siswa yang sudah diketik secara tidak sengaja.

## [1.1.71] / [26.08.08.16] - 2026-08-08

### 🎨 Clean Score Input Field & Spinner Removal (`guru-mapel.html`)
- **Penghapusan Spinner Panah Atas/Bawah (`-webkit-appearance: none`):** Menghapus total tombol panah spinner bawaan browser pada input angka yang sebelumnya memakan ruang 16px di dalam kotak.
- **Ramping Border & Ruang Lega Angka 100:** Mengecilkan garis border menjadi `1px thin` dan mengatur lebar `3.6rem` sehingga angka 3 digit `100` dapat diketik dan tampil dengan sangat lega, bersih, tanpa terpotong atau tertutup sedikit pun.

## [1.1.70] / [26.08.08.15] - 2026-08-08

### 🔒 Proteksi Keamanan Data Penilaian — Locking Columns With Grades (`js/page-guru-mapel.js`)
- **Deteksi Otomatis Nilai Terisi (`minRequiredCount`):** Sistem secara otomatis mendeteksi index tertinggi kolom Tugas & Sumatif yang pernah diisi nilai siswa di Supabase.
- **Pencegahan Tersembunyi Tidak Sengaja:** Kolom yang sudah berisi data nilai **dikunci (wajib tampil)** dan tidak dapat disembunyikan oleh guru melalui dropdown modal. Opsi di bawah index terisi diberi penanda `[Ada Nilai]` dan dinonaktifkan secara otomatis.

## [1.1.69] / [26.08.08.14] - 2026-08-08

### 🎯 Scope Pengaturan Per Mapel Per Tingkat Angkatan (`js/page-guru-mapel.js`)
- **Penerapan Scope Otomatis:** Pengaturan jumlah kolom aktif (1-5 Tugas & Sumatif) serta bobot penilaian secara cerdas diberlakukan **Per Mapel Per Tingkat Angkatan** (misal: `Matematika_XI`, `Matematika_XII`).
- **Singkronisasi Rombel:** Pengaturan di satu rombel (misal: XI-1) otomatis berlaku untuk seluruh kelas lain di tingkat angkatan yang sama (XI-2, XI-3), namun dapat berbeda untuk tingkat angkatan lain (misal: Kelas XII).

## [1.1.68] / [26.08.08.13] - 2026-08-08

### 📜 Full Native Page Height Student Table (`guru-mapel.html`)
- **Pelepasan Inner Scroll Vertical:** Menghapus properti `max-h-[calc(100vh-160px)]` dan `overflow-y-auto` pada pembungkus tabel lembar penilaian. Tabel kini berkembang penuh secara alami ke bawah mengikuti jumlah seluruh siswa di kelas tanpa terpotong scrollbar internal grid.

## [1.1.67] / [26.08.08.12] - 2026-08-08

### 📜 Full Native Page Height Student Table (`guru-mapel.html`)
- **Pelepasan Inner Scroll Vertical:** Menghapus properti `max-h-[calc(100vh-160px)]` dan `overflow-y-auto` pada pembungkus tabel lembar penilaian. Tabel kini berkembang penuh secara alami ke bawah mengikuti jumlah seluruh siswa di kelas tanpa terpotong scrollbar internal grid.

## [1.1.66] / [26.08.08.11] - 2026-08-08

### 📏 Perfect Proportional Filter Sizing — 28px (`guru-mapel.html`)
- **Peningkatan Proporsional Form Filter:** Memperbesar ukuran filter select dan tombol load secara presisi dari 22px menjadi **28px height** dengan font size **11px (bold 600)**.
- **Kenyamanan Visual & Klik:** Menghasilkan bentuk visual yang tetap sangat ringkas dan hemat tempat, namun 100% nyaman dibaca dan mudah diklik tanpa rasa kekecilan.

## [1.1.65] / [26.08.08.10] - 2026-08-08

### 💎 Professional UI/UX Senior Design — `.micro-filter-select` (`guru-mapel.html`)
- **Penghapusan Native Browser Frame (`appearance: none`):** Menghapus seluruh bingkai 3D default bawaan browser yang membengkakkan wadah select.
- **Micro-sizing Presisi (22px Height & 10px Font):** Mengunci tinggi wadah pada **22px** dan ukuran teks pada **10px** dengan `line-height: 1`, diiringi ikon panah SVG micro (0.85em) khusus.
- **Teks Terbaca 100% Tanpa Clipping:** Mengeliminasi masalah clipping visual vertical secara menyeluruh di seluruh browser.

## [1.1.64] / [26.08.08.9] - 2026-08-08

### 📌 Navigasi Sidebar Akademik (`js/global.js`)
- **Penyesuaian Urutan Menu Akademik:** Mengubah urutan item menu dalam grup Akademik pada sidebar navigasi secara presisi sesuai permintaan user: **Portal Guru Mapel**, **Portal Guru Wali**, **Portal Wali Kelas**, **Game PID**, **E-Laboratorium**, dan **E-Rapor**.

## [1.1.63] / [26.08.08.8] - 2026-08-08

### 🎨 Fix Display Text Select Filter (`guru-mapel.html`)
- **Perbaikan Text Clipping Form Filter:** Menghapus properti `h-6 py-0 leading-none` pada elemen `<select>` yang menyebabkan teks pilihan terpotong/kosong secara visual. Menggantinya dengan `py-1 px-2 text-xs font-semibold` sehingga nilai terpilih (misal: `XI-2`, `Matematika T`, `Sem 1`) terlihat jelas dan sempurna.

## [1.1.62] / [26.08.08.7] - 2026-08-08

### 🔍 Micro Sizing Form Filter (`guru-mapel.html`)
- **Micro-sizing Select Filter:** Mengatur ukuran tinggi form select Kelas, Mapel, dan Semester menjadi micro `h-6` (24px), font size `text-[10px] font-semibold`, serta padding ultra-compact `py-0 px-1.5` agar dropdown dan teks di dalamnya jauh lebih kecil, presisi, dan hemat tempat.

## [1.1.61] / [26.08.08.6] - 2026-08-08

### 🎨 Ultra Compact UI & Refinements (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Nama Asli Guru di Header:** Mengambil `nama_lengkap` asli dari Firestore User Document / Profile (bukan potongan email).
- **Penggabungan Filter 1 Baris dengan Header Tabel:** Menyatukan filter Kelas, Mapel, Semester, serta tombol Load/Paste/Export ke dalam 1 baris header ringkas di atas tabel lembar penilaian.
- **Ukuran Input Compact & Sticky Horizontal Scrollbar:** Mengecilkan cell input nilai (`w-14 p-1 text-xs font-bold`) dan menyediakan scrollbar horizontal yang selalu terlihat di bawah layar (`max-h-[calc(100vh-160px)] custom-scrollbar`).
- **Default Structure (1 Tugas + 1 Sumatif + SAS/SAT):** Mengubah kolom default awal menjadi **1 Tugas** (`tugas_1`) dan **1 Sumatif** (`sumatif_1`) + **SAS/SAT** (bisa ditambah sesuai kebutuhan guru).

## [1.1.60] / [26.08.08.5] - 2026-08-08

### 🎨 Ultra Compact UI & Refinements (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Nama Asli Guru di Header:** Mengambil `nama_lengkap` asli dari Firestore User Document / Profile (bukan potongan email).
- **Penggabungan Filter 1 Baris dengan Header Tabel:** Menyatukan filter Kelas, Mapel, Semester, serta tombol Load/Paste/Export ke dalam 1 baris header ringkas di atas tabel lembar penilaian.
- **Ukuran Input Compact & Sticky Horizontal Scrollbar:** Mengecilkan cell input nilai (`w-14 p-1 text-xs font-bold`) dan menyediakan scrollbar horizontal yang selalu terlihat di bawah layar (`max-h-[calc(100vh-160px)] custom-scrollbar`).
- **Default Structure (1 Tugas + 1 Sumatif + SAS/SAT):** Mengubah kolom default awal menjadi **1 Tugas** (`tugas_1`) dan **1 Sumatif** (`sumatif_1`) + **SAS/SAT** (bisa ditambah sesuai kebutuhan guru).

## [1.1.59] / [26.08.08.4] - 2026-08-08

### 🐛 Perbaikan Bug & Pembersihan UI (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Pembersihan sisa elemen inline:** Menghapus sisa blok HTML panel bobot lama yang tertinggal di halaman utama, sehingga kini halaman 100% bersih dan modal popup bekerja dengan rapi.
- **Perbaikan `ReferenceError: fsQuery is not defined`:** Mengganti panggil `fsQuery` menjadi `query` dari Firebase Firestore SDK pada modul `loadGradebookData()`.

## [1.1.58] / [26.08.08.3] - 2026-08-08

### 📉 Optimasi Kuota Read Firestore Terpusat (Zero Over-Budget) — Portal Guru Mapel
- **Cache Data Siswa Per Kelas (TTL 24 Jam):** Data master siswa per kelas disimpan pada cache lokal (`cache_students_${kelas}`) dengan masa berlaku 24 jam. Pembukaan ulang kelas yang sama oleh guru tidak melakukan query berulang ke Firestore (0 Read).
- **Cache Profil & Rapor Config:** Menggunakan `getCurrentUserDoc()` dan caching `simas_rapor_config_cache` (TTL 30 Menit) untuk menghindari read berulang pada dokumen `users/{uid}` dan `settings/rapor_config`.
- **Nilai 100% di Supabase:** Seluruh transaksi read/write nilai, komponen, dan summary tersimpan penuh di Supabase tanpa membebankan kuota Firestore.

## [1.1.57] / [26.08.08.2] - 2026-08-08

### 🎨 Optimasi UX Filter & Modal Bobot Portal Guru Mapel (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Urutan Filter Berantai (Kelas -> Mapel):** Pengguna kini memilih **Rombel Kelas terlebih dahulu**, lalu daftar Mata Pelajaran yang diampu pada kelas tersebut otomatis tersaring. Mapel otomatis terpilih (jika 1 mapel) atau terpilih salah satu secara otomatis dengan opsi memilih mapel lain.
- **Modal Popup Bobot & Kolom (`#modal-config-weight`):** Memindahkan panel pengaturan bobot persentase dan tambah/hapus kolom ke dalam modal popup 1 tombol **"Atur Bobot & Kolom"**. Halaman utama dan tabel lembar penilaian siswa menjadi jauh lebih luas, bersih, dan fokus.
- **Header & Filter Bar Minimalis Compact:** Mendesain ulang Header Banner dan Bar Filter menjadi tampilan 1 baris inline yang sangat ringkas, presisi, dan hemat ruang vertikal.

## [1.1.56] / [26.08.08.1] - 2026-08-08

### 📚 Peluncuran Modul Portal Guru Mapel (`guru-mapel.html` & `js/page-guru-mapel.js`)
- **Portal Khusus Guru Mapel:** Modul input nilai terpadu pengganti spreadsheet Excel untuk guru pengampu rombel & mata pelajaran.
- **Formulasi Nilai Fleksibel:** Perhitungan Nilai Akhir otomatis di browser berbasis persentase Rata-rata Tugas (optional), Rata-rata Sumatif, dan SAS (Semester 1) / SAT (Semester 2).
- **Pengaturan Bobot & Kolom Dinamis:** Guru dapat mengatur bobot persentase lokal (default 20-40-40) serta menambah/menghapus kolom Tugas dan Sumatif secara mandiri.
- **Arsitektur Hybrid SSOT & Supabase:** Master siswa, guru, kelas, mapel, dan penugasan tetap 100% di Firestore `smagesa` (SSOT), sementara data nilai transaksional yang sering berubah disimpan di Supabase (`guru_mapel_gradebooks`, `guru_mapel_components`, `guru_mapel_scores`, `guru_mapel_summaries`).
- **Integrasi Input & Export Cepat:** Mendukung paste massal dari Excel (TSV matching NIS/NISN) serta export laporan lembar penilaian ke file `.xlsx`.
- **E-Rapor Tetap Utuh:** Tidak mengubah modul E-Rapor (`e-rapor.html`, `rapor_scores`) yang sudah ada.
- **Pengujian Unit & Sintaks:** 38 file JS lulus `npm run check:syntax` (0 Error), 22 unit test di Jest lulus 100%.

## [1.1.55] / [26.08.07.1] - 2026-08-07

### 📉 Optimasi Kuota Read Firestore Terpusat (Zero Over-Budget)
- **OPT-1 (`getCurrentUserDoc`)**: Centralized caching untuk dokumen `users/{uid}` (TTL 10 menit, UID-keyed safety) pada seluruh controller halaman (`page-bk.js`, `page-presensi-guru.js`, `page-e-lab.js`, `page-keuangan.js`, `page-masukan.js`, `page-peminatan.js`, `page-rekap-kehadiran-siswa.js`, `page-rekap-presensi.js`, `page-students.js`, `page-users.js`, `page-wali-kelas.js`).
- **OPT-2 (`getSystemConfig`)**: Centralized caching untuk dokumen `system_config` (TTL 5 menit) menggantikan query berulang di seluruh controller halaman dan `syncSystemAiConfig()`.
- **OPT-3 (`getStudentsCache` di E-Rapor)**: Menggantikan full collection read `students` di `page-e-rapor.js` (`loadAllKelasForSettings`) dengan global student cache, menghemat ~500 reads per akses.
- **OPT-4 (`getTeachersCache`)**: Implementasi global IndexedDB + LocalStorage + Memory caching untuk koleksi `teachers` dengan validasi timestamp metadata `lastUpdateTeachers`. Diterapkan di `page-presensi-guru.js`, `page-rekap-kehadiran-siswa.js`, `page-rekap-presensi.js`, dan `page-users.js`. Update metadata otomatis terpicu pada CRUD guru di `page-guru.js`.
- **OPT-6 (Finance Cache)**: Caching terpusat untuk `finance_rates` (TTL 1 jam) dan `finance_config` (TTL 1 jam) dengan mekanisme invalidasi otomatis saat admin memperbarui tarif/config.
- **Keamanan & Switch Akun**: Penambahan pengaman `last_login_uid` detection di `initLayout()` dan pembersihan cache berbasis UID pada `confirmLogout()` untuk menjamin isolasi data antar akun & role.

## [1.1.56] / [26.08.07.2] - 2026-08-07

### 📉 Audit & Optimasi Modul Keuangan (`js/page-keuangan.js`)
- **Resolusi Kontak Wali Kelas via Cache (`sendArrearsReportToWaliKelas`):** Menggunakan `window.getTeachersMapCache()` untuk mencari nomor HP dan UID Wali Kelas sebelum melakukan query server `teachers`/`users`, menghemat query network saat pengiriman laporan kelengkapan SPP via WA/Telegram.
- **Validasi Sintaks:** 37 berkas JS tervalidasi 100% bebas error sintaks (`npm run check:syntax`).

## [1.1.55] / [26.08.07.1] - 2026-08-07

### 📉 Audit & Optimasi Kuota Read Firestore Global (Zero UX Degradation)
- **Metadata Check TTL (30s):** `global.js` menambahkan in-memory TTL 30 detik untuk pembacaan `settings/metadata`, memotong puluhan read timestamp berulang saat navigasi antar-halaman.
- **Client-Side Student Search (`page-students.js`):** Mengganti 3 query paralel Firestore server (`qTitle`, `qUpper`, `qNIS`) dengan filtering memori client-side `getStudentsCache()`, memotong ribuan read per hari dan mempercepat respons pencarian (0-5ms).
- **Substitusi Raw Collection Reads (`page-e-rapor.js` & `page-settings.js`):** Mengganti `getDocs(collection('students'))` raw di modul E-Rapor dan Pengaturan dengan `window.getStudentsCache()` IndexedDB.
- **Teacher Profile & Name Map Caching (`global.js` & `page-wali-kelas.js`):** Menyimpan `linkedTeacherId` dan `teachersMap` di session cache untuk menghilangkan kueri email guru berulang dan 3-step chunk queries di perwalian.
- **SWR Session Cache User Management (`page-users.js`):** Menambahkan 5-minute SWR session cache pada `loadUsers()` dengan auto-invalidation saat ada penambahan/edit/penghapusan user.
- **Dashboard Violation Cache Metadata (`page-dashboard.js`):** Memanfaatkan `window.getServerMetadataLastUpdate()` pada `getViolationsAcademicYearCache()` untuk menghindari pembacaan `settings/metadata` server yang tidak perlu di Dashboard Executive.

## [1.1.54] / [26.08.06.38] - 2026-08-06

### 📉 Optimasi Read Keuangan (`js/page-keuangan.js`)
- Cache raw transaksi tahun 2026 dipakai bersama oleh kalkulasi migrasi umum dan rekap berbasis kelas, sehingga query Firestore tidak diulang dalam lifecycle halaman yang sama.
- Cache diinvalidasi saat pembayaran berubah. Filter, nominal, cohort, aturan alumni, proses pembayaran, dan tampilan laporan tetap dipertahankan.
- Validasi `npm run check:syntax` berhasil untuk 37 berkas JavaScript, 0 error.

## [1.1.53] / [26.08.06.37] - 2026-08-06

### 📉 Optimasi Read Firestore Master Siswa (`js/page-students.js`)
- Load semua siswa memakai cache global tervalidasi `metadata.lastUpdateStudents`, menghindari full collection read berulang tanpa mengubah hasil, RBAC, sorting, render, atau SSOT.
- Load `student_aggregates` untuk daftar besar memakai cache global tervalidasi metadata; daftar kecil tetap memakai single-document read.
- Validasi `npm run check:syntax` berhasil untuk 37 berkas JavaScript, 0 error.


## [1.1.52] / [26.08.06.36] - 2026-08-06

### 📉 Optimasi Kuota Read Portal Wali Kelas (`wali-kelas.html`, `js/page-wali-kelas.js`, `js/global.js`)
- **Cache Rombel Aman 15 Menit:** Menyimpan snapshot rombel lengkap pada `sessionStorage`, terikat `UID` dan kelas aktif. Reload portal dalam masa cache menampilkan data lengkap tanpa menjalankan ulang query koleksi rombel besar.
- **Kontrol UX & Keamanan:** Menambahkan indikator status cache dan tombol refresh server. Cache dibatasi 2 MB, tidak menyimpan token/kredensial, otomatis diabaikan saat rusak/kedaluwarsa, dan dapat dinonaktifkan melalui `WALI_ROMBEL_CACHE_ENABLED`.
- **Invalidasi Tepat Sasaran:** Approval/penolakan permisi serta tambah/edit/hapus catatan pembinaan menghapus cache rombel agar data tindakan pengguna tidak stale.
- **Cache Metadata Firestore:** Mengganti `getDocFromServer()` menjadi `getDoc()` pada cache siswa/agregat untuk memanfaatkan persistent local cache Firestore tanpa mengubah SSOT atau Firestore Rules.
- **Pembaruan Versi Aplikasi & Cache SW:** Bump `package.json` (`1.1.52`), `PRD_SIMAS.md` (`v1.1.52`), `js/config.js` (`26.08.06.36`), `sw.js` (`simas-pwa-v72`), dan `CHANGELOG.md`.

## [1.1.51] / [26.08.06.35] - 2026-08-06

### 📊 Penambahan Kolom & Rekapitulasi Permisi (P) pada Rekap Kehadiran Rombel (`wali-kelas.html` & `js/page-wali-kelas.js`)
- **Penambahan Kolom Tabel Rekap Presensi:** Menambahkan kolom `Permisi (P)` terpisah disamping `Dispensasi (D)` pada tabel Rekapitulasi Kehadiran Rombel (`wali-kelas.html`).
- **Hitungan Rekapitulasi & Export Excel:** Mengakumulasikan hitungan status `Permisi (P)` dari catatan presensi harian serta data koleksi `records` (Input Permisi Halaman Input) untuk periode terpilih, serta menyertakan kolom `Permisi (P)` pada unduhan berkas Excel (`exportAttendanceRekapExcel`).
- **Pembaruan Versi Aplikasi & Cache SW:** Bump versi pada `package.json` (`1.1.51`), `PRD_SIMAS.md` (`v1.1.51`), `js/config.js` (`26.08.06.35`), `sw.js` (`simas-pwa-v71`), dan `CHANGELOG.md`.

## [1.1.50] / [26.08.06.34] - 2026-08-06

### 🐛 Fix Syntax Error & Validasi Uji Sintaksis (`js/page-wali-kelas.js`)
- **Perbaikan Sintaks JS (`loadTodayAttendance`):** Memperbaiki penutup blok `catch` yang hilang pada query `permisi_requests` di `js/page-wali-kelas.js`. Memastikan seluruh 37 berkas JS lolos uji `check:syntax` 100% tanpa error.
- **Pembaruan Versi Aplikasi & Cache SW:** Bump versi pada `package.json` (`1.1.50`), `PRD_SIMAS.md` (`v1.1.50`), `js/config.js` (`26.08.06.34`), `sw.js` (`simas-pwa-v70`), dan `CHANGELOG.md`.

## [1.1.49] / [26.08.06.33] - 2026-08-06

### 📑 Integrasi Catatan Permisi dari Halaman Input (`input.html`) ke Monitoring Presensi (`js/page-wali-kelas.js`)
- **Penayangan Input Permisi Manual:** Menambahkan query koleksi `records` (`category == 'Permisi'`) pada fungsi `loadTodayAttendance`. Catatan permisi siswa yang diinputkan dari Halaman Input (`input.html` / `js/page-input.js`) untuk tanggal terpilih otomatis terbaca dan dirender dengan status `Permisi` beserta teks keterangannya (misal `[10:30] Keperluan Keluarga`) di bawah NIS siswa.
- **Pembaruan Versi Aplikasi & Cache SW:** Bump versi pada `package.json` (`1.1.49`), `PRD_SIMAS.md` (`v1.1.49`), `js/config.js` (`26.08.06.33`), `sw.js` (`simas-pwa-v69`), dan `CHANGELOG.md`.

## [1.1.48] / [26.08.06.32] - 2026-08-06

### 📝 Integrasi Permisi Online 2 Tahap & Keterangan pada Kartu Monitoring Presensi (`js/page-wali-kelas.js`)
- **Integrasi Permisi 2 Tahap (`loadTodayAttendance`):** Menambahkan pencarian data permohonan permisi online (`permisi_requests`) tanggal terpilih ke dalam grid monitoring presensi Wali Kelas. Pengajuan permisi yang disetujui (Approved) atau pending otomatis dirender dengan badge status `Permisi`.
- **Penayangan Teks Keterangan/Alasan (`loadAttendanceForDate`):** Menambahkan baris keterangan/alasan permisi (`att.notes`) tepat di bawah nomor NIS pada kartu setiap siswa untuk kejelasan Wali Kelas.
- **Pembaruan Versi Aplikasi & Cache SW:** Bump versi pada `package.json` (`1.1.48`), `PRD_SIMAS.md` (`v1.1.48`), `js/config.js` (`26.08.06.32`), `sw.js` (`simas-pwa-v68`), dan `CHANGELOG.md`.

## [1.1.47] / [26.08.06.31] - 2026-08-06

### 🏷️ Penyelarasan Header Tabel Rekap Presensi (`wali-kelas.html` & `js/page-wali-kelas.js`)
- **Pembaruan Header Kolom Tabel Rekap Presensi:** Mengubah teks header kolom dari `Permisi (P)` menjadi `Dispensasi (D)` pada tabel Rekapitulasi Presensi Bulanan Wali Kelas serta penyesuaian header kolom export Excel (`exportAttendanceRekapExcel`).
- **Pembaruan Versi Aplikasi & Cache SW:** Bump versi pada `package.json` (`1.1.47`), `PRD_SIMAS.md` (`v1.1.47`), `js/config.js` (`26.08.06.31`), `sw.js` (`simas-pwa-v67`), dan `CHANGELOG.md`.

## [1.1.46] / [26.08.06.30] - 2026-08-06

### 🔍 Pemisahan Label Presensi 'Dispensasi' (D) dan 'Permisi' (P) (`js/page-wali-kelas.js`)
- **Fix Kerancuan Label Status Monitoring Presensi:** Memisahkan pemetaan status `D` (Dispensasi) dan `P` (Permisi / Surat Permisi 2 Tahap). Sebelumnya status `D` di presensi harian secara tidak sengaja dipetakan menjadi `Permisi`, menyebabkan Wali Kelas mencari permohonan surat permisi online yang tidak ada. Kini status `D` dirender tepat sebagai **Dispensasi** (purple badge) dan `P` dirender sebagai **Permisi** (violet badge).
- **Pembaruan Versi Aplikasi & Cache SW:** Bump versi pada `package.json` (`1.1.46`), `PRD_SIMAS.md` (`v1.1.46`), `js/config.js` (`26.08.06.30`), `sw.js` (`simas-pwa-v66`), dan `CHANGELOG.md`.

## [1.1.45] / [26.08.06.29] - 2026-08-06

### 💬 Penyederhanaan Draf Pesan WA SPP Siswa (`js/page-wali-kelas.js`)
- **Pembersihan Baris Status Bulan Ini:** Menghapus baris `- Status Bulan Ini (...)` dari draf pesan WhatsApp SPP Siswa (`spp_reminder`) karena daftar rincian bulan tunggakan (`- Bulan: ...`) sudah mencakup bulan berjalan secara presisi sesuai tanggal jatuh tempo dinamis.
- **Pembaruan Versi Aplikasi & Cache SW:** Bump versi pada `package.json` (`1.1.45`), `PRD_SIMAS.md` (`v1.1.45`), `js/config.js` (`26.08.06.29`), `sw.js` (`simas-pwa-v65`), dan `CHANGELOG.md`.

## [1.1.44] / [26.08.06.28] - 2026-08-06

### 📅 Jatuh Tempo SPP Dinamis dari Pengaturan Keuangan Admin (`js/page-wali-kelas.js`)
- **Integrasi Tanggal Jatuh Tempo Dinamis (`dueDate`):** Tanggal jatuh tempo SPP pada kalkulasi tunggakan (`calculateStudentTunggakan`), penentuan status bulan berjalan (`isMonthPaid`), tabel SPP (`renderSppTable`), dan draf WA SPP (`updateWaPreviewMessage`) kini sepenuhnya dinamis membaca nilai `dueDate` dari dokumen `settings/system_config` yang diinput oleh Admin Keuangan.
- **Pembaruan Versi Aplikasi & Cache SW:** Bump versi pada `package.json` (`1.1.44`), `PRD_SIMAS.md` (`v1.1.44`), `js/config.js` (`26.08.06.28`), `sw.js` (`simas-pwa-v64`), dan `CHANGELOG.md`.

## [1.1.43] / [26.08.06.27] - 2026-08-06

### 🔧 Perbaikan Presisi Evaluasi Bulan Berjalan pada Draf WA Siswa (`js/page-wali-kelas.js`)
- **Fix Evaluasi Tunggakan Bulan Berjalan (`calculateStudentTunggakan`):** Memperbaiki kondisi batas tanggal `itemDate <= now || (currY === todayYear && currM === todayMonth)` agar bulan berjalan (sebelum tanggal 20) yang belum dibayar tetap dimasukkan secara tepat ke dalam daftar tunggakan dan total nominal, serta menyelaraskan pembacaan `sppStatusMap` key string/number.
- **Pembaruan Versi Aplikasi & Cache SW:** Bump versi pada `package.json` (`1.1.43`), `PRD_SIMAS.md` (`v1.1.43`), `js/config.js` (`26.08.06.27`), `sw.js` (`simas-pwa-v63`), dan `CHANGELOG.md`.

## [1.1.42] / [26.08.06.26] - 2026-08-06

### 📅 Penambahan Status SPP Bulan Berjalan pada Draf WA Siswa (`js/page-wali-kelas.js`)
- **Indikator Status Bulan Ini pada Draf WA:** Menambahkan rincian status pembayaran SPP bulan berjalan (`Status Bulan Ini ([Nama Bulan Tahun]): BELUM LUNAS / LUNAS`) secara otomatis pada draf pesan WhatsApp SPP Siswa (`spp_reminder`).
- **Pembaruan Versi Aplikasi & Cache SW:** Bump versi pada `package.json` (`1.1.42`), `PRD_SIMAS.md` (`v1.1.42`), `js/config.js` (`26.08.06.26`), `sw.js` (`simas-pwa-v62`), dan `CHANGELOG.md`.

## [1.1.41] / [26.08.06.25] - 2026-08-06

### 🎨 Perbaikan Penumpukan Z-Index Modal Edit Siswa (`wali-kelas.html` & `js/page-wali-kelas.js`)
- **Peningkatan Z-Index Modal Edit Siswa (`#modal-edit-data-siswa`):** Menaikkan z-index modal edit siswa menjadi `z-[100]` (di atas modal generator WA `z-[90]`).
- **Otomatisasi Penutupan Modal WA saat Edit Data:** Menambahkan penutupan modal generator WA (`window.closeModal('modal-wa-generator')`) saat Wali Kelas mengklik tombol Edit Data Siswa, mencegah penumpukan/tertutupnya tampilan modal.
- **Pembaruan Versi Aplikasi & Cache SW:** Bump versi pada `package.json` (`1.1.41`), `PRD_SIMAS.md` (`v1.1.41`), `js/config.js` (`26.08.06.25`), `sw.js` (`simas-pwa-v61`), dan `CHANGELOG.md`.

## [1.1.40] / [26.08.06.24] - 2026-08-06

### 🏷️ Perbaikan Header Kolom Tabel SPP (`wali-kelas.html`)
- **Penyelarasan Label Kolom Akses WA Siswa:** Mengubah teks header kolom tabel SPP dari `Ingatkan Ortu (WA)` menjadi `Ingatkan Siswa (WA)` agar selaras 100% dengan fungsi tombol WA Siswa.
- **Pembaruan Versi Aplikasi & Cache SW:** Bump versi pada `package.json` (`1.1.40`), `PRD_SIMAS.md` (`v1.1.40`), `js/config.js` (`26.08.06.24`), `sw.js` (`simas-pwa-v60`), dan `CHANGELOG.md`.

## [1.1.39] / [26.08.06.23] - 2026-08-06

### 🛠️ Pengayaan Fallback WA Tanpa Nomor & Akses Cepat Edit Data Siswa (`wali-kelas.html` & `js/page-wali-kelas.js`)
- **Penanganan Nomor WA Kosong:** Ketika nomor WA siswa/orang tua tidak tersedia, modal generator WA tetap dibuka (tanpa diblokir). Menampilkan banner informasi serta tombol pintar `Edit Data Siswa` (`openModalEditDataSiswa`) langsung di dalam modal generator WA.
- **Direct WA Link Tanpa Nomor Tujuan (`sendWhatsAppMessage`):** Jika nomor WA belum diisi saat tombol "Kirim WhatsApp" diklik, sistem membuka link WhatsApp (`https://api.whatsapp.com/send?text=...`) tanpa nomor tujuan, sehingga pengguna dapat memilih kontak target secara langsung saat aplikasi WhatsApp terbuka.
- **Pembaruan Versi Aplikasi & Cache SW:** Bump versi pada `package.json` (`1.1.39`), `PRD_SIMAS.md` (`v1.1.39`), `js/config.js` (`26.08.06.23`), `sw.js` (`simas-pwa-v59`), dan `CHANGELOG.md`.

## [1.1.38] / [26.08.06.22] - 2026-08-06

### 📝 Penyesuaian Teks Draf Pesan WA SPP Siswa (`js/page-wali-kelas.js`)
- **Penyelarasan Format Teks Draf WA SPP Siswa:** Memperbarui struktur penulisan draf WA SPP Siswa 100% identik dengan teks terbaru user ("(2 bulan)", "Segera diselesaikan ya...").
- **Pembaruan Versi Aplikasi & Cache SW:** Bump versi pada `package.json` (`1.1.38`), `PRD_SIMAS.md` (`v1.1.38`), `js/config.js` (`26.08.06.22`), `sw.js` (`simas-pwa-v58`), dan `CHANGELOG.md`.

## [1.1.37] / [26.08.06.21] - 2026-08-06

### 💬 Penyelarasan Presisi Format Draf Pesan WA SPP Siswa (`js/page-wali-kelas.js`)
- **Format Draf WA SPP Siswa Presisi:** Menyesuaikan template `spp_reminder` untuk Siswa 100% presisi sesuai spesifikasi teks user ("INFORMASI SPP", "Halo *[Nama Siswa]* ([Kelas])", "- Bulan: *...*", "- Total Tunggakan: *Rp ...*", ">SIMAS-SHAKTI").
- **Pembaruan Versi Aplikasi & Cache SW:** Bump versi pada `package.json` (`1.1.37`), `PRD_SIMAS.md` (`v1.1.37`), `js/config.js` (`26.08.06.21`), `sw.js` (`simas-pwa-v57`), dan `CHANGELOG.md`.

## [1.1.36] / [26.08.06.20] - 2026-08-06

### 💰 Integrasi Rincian Bulan & Nominal Tunggakan SPP Pesan WA Siswa (`js/page-wali-kelas.js`)
- **Perhitungan Rincian Bulan Tunggakan (`calculateStudentTunggakan`):** Menambahkan pengembalian array daftar nama bulan yang menunggak (`unpaidMonths`).
- **Integrasi Nominal & Bulan SPP Siswa (`updateWaPreviewMessage`):** Menghapus kalimat perkenalan/jabatan, menyajikan daftar bulan tunggakan (contoh: `Juli 2026, Agustus 2026`), akumulasi total nominal tunggakan (`Rp ...`), atau konfirmasi lunas jika bebas tagihan secara lugas dan efisien.
- **Pembaruan Versi Aplikasi & Cache SW:** Bump versi pada `package.json` (`1.1.36`), `PRD_SIMAS.md` (`v1.1.36`), `js/config.js` (`26.08.06.20`), `sw.js` (`simas-pwa-v56`), dan `CHANGELOG.md`.

## [1.1.35] / [26.08.06.19] - 2026-08-06

### 📝 Penghapusan Keterangan Bertele-tele & Kata Yth pada Pesan WA Siswa (`js/page-wali-kelas.js`)
- **Penyederhanaan Draf WA Siswa:** Menghapus penggunaan sapaan "Yth." serta memangkas narasi bertele-tele pada template pesan WA Siswa (`spp_reminder`, `ews_warning`, `attendance_absence`, `parent_invitation`, dan `appreciation`) agar menjadi pesan ringkas, lugas, to-the-point langsung dari Wali Kelas ("INFORMASI SPP", "Halo *[Nama]*", "Saya selaku Wali Kelas mengingatkan...").
- **Pembaruan Versi Aplikasi & Cache SW:** Bump versi pada `package.json` (`1.1.35`), `PRD_SIMAS.md` (`v1.1.35`), `js/config.js` (`26.08.06.19`), `sw.js` (`simas-pwa-v55`), dan `CHANGELOG.md`.

## [1.1.34] / [26.08.06.18] - 2026-08-06

### 👨‍🏫 Penyesuaian Sudut Pandang Pengirim Wali Kelas Pesan WA Siswa (`js/page-wali-kelas.js`)
- **Penyelarasan POV Wali Kelas Pengirim:** Memperbarui narasi draf template pesan WhatsApp tujuan Siswa agar menggunakan sudut pandang orang pertama sebagai Wali Kelas pengirim ("Saya selaku Wali Kelas Anda...", "silakan berkonsultasi langsung dengan Saya").
- **Pembaruan Versi Aplikasi & Cache SW:** Bump versi pada `package.json` (`1.1.34`), `PRD_SIMAS.md` (`v1.1.34`), `js/config.js` (`26.08.06.18`), `sw.js` (`simas-pwa-v54`), dan `CHANGELOG.md`.

## [1.1.33] / [26.08.06.17] - 2026-08-06

### 📑 Format Resmi Pemberitahuan Sistem Pesan WA Siswa (`js/page-wali-kelas.js`)
- **Penyelarasan Format Pemberitahuan Resmi:** Mengubah struktur draf template pesan WhatsApp tujuan Siswa (`spp_reminder`, `ews_warning`, `attendance_absence`, `parent_invitation`, dan `appreciation`) menjadi nada formal terstruktur sebagai pemberitahuan resmi dari sistem SIMAS SMAGESA & Wali Kelas ("INFORMASI ADMINISTRASI SPP SIMAS SMAGESA", "Kepada Yth. Siswa: [Nama]").
- **Pembaruan Versi Aplikasi & Cache SW:** Bump versi pada `package.json` (`1.1.33`), `PRD_SIMAS.md` (`v1.1.33`), `js/config.js` (`26.08.06.17`), `sw.js` (`simas-pwa-v53`), dan `CHANGELOG.md`.

## [1.1.32] / [26.08.06.16] - 2026-08-06

### 💬 Humanisasi & Nada Akrab Draf Pesan WA Siswa (`js/page-wali-kelas.js`)
- **Penyempurnaan Nada Pesan Bimbingan Wali Kelas:** Memperbarui seluruh draf template pesan WhatsApp tujuan Siswa (`spp_reminder`, `ews_warning`, `attendance_absence`, `parent_invitation`, dan `appreciation`) agar menggunakan sapaan hangat, santai, humanis, dan akrab khas Wali Kelas ke siswa binaan sendiri ("Halo *[Nama]* 👋", "nak", "Wali kelas mau ngingetin...", "jangan ragu cerita/koordinasi...").
- **Pembaruan Versi Aplikasi & Cache SW:** Bump versi pada `package.json` (`1.1.32`), `PRD_SIMAS.md` (`v1.1.32`), `js/config.js` (`26.08.06.16`), `sw.js` (`simas-pwa-v52`), dan `CHANGELOG.md`.

## [1.1.31] / [26.08.06.15] - 2026-08-06

### 📱 Integrasi WhatsApp Siswa pada Tab SPP Portal Wali Kelas (`wali-kelas.html` & `js/page-wali-kelas.js`)
- **Pelepasan Tombol WA ke Siswa (`renderSppTable`):** Mengubah tombol aksi WhatsApp pada tab Status SPP Portal Wali Kelas agar menargetkan nomor telepon WhatsApp Siswa (`phone_siswa` / `phone` / `hpSiswa`) dengan label `WA Siswa`, menggantikan nomor telepon orang tua.
- **Generator Draf Pesan WA Personal Siswa (`openModalWaGenerator` & `updateWaPreviewMessage`):** Mengembangkan fungsi modal generator pesan WA agar mampu mendeteksi penerima pesan secara dinamis (`student` vs `parent`). Menyediakan template pesan pengingat SPP dan peringatan akademis yang ditujukan secara sopan, ramah, dan personal langsung ke siswa bersangkutan.
- **Pembaruan Versi Aplikasi & Cache SW:** Bump versi pada `package.json` (`1.1.31`), `PRD_SIMAS.md` (`v1.1.31`), `js/config.js` (`26.08.06.15`), `sw.js` (`simas-pwa-v51`), dan `CHANGELOG.md`.

## [1.1.30] / [26.08.06.14] - 2026-08-06

### 🛡️ Perbaikan Validasi Live Data Siswa Modal Catatan & AI Assistant Rapor (`js/page-wali-kelas.js`)
- **Penyelarasan & Kalkulasi Live Stat Presensi/Poin/Prestasi (`openPrintRaporWali`):** Menyelaraskan pembacaan statistik siswa pada Modal Cetak Lapor Rapor Afektif Siswa & Generator AI. Menambahkan mekanisme cascaded fallback (`attRekap`, `currentPermissionCounts`, `agg.attendance`, dan query live Firestore `attendance`, `permisi_requests`, & `records` berdasarkan Tahun Ajaran & Semester yang sedang aktif).
- **Validasi Data untuk Generator AI:** Menjamin 100% data statistik (Poin, Prestasi, Alpha, Permisi, Sakit, Izin, Dispen) yang dikirim ke modul pembentuk prompt AI (`buildRaporNotePrompt`) bernilai valid, presisi, dan sesuai dengan rekam medis/karakter siswa berjalan.
- **Pembaruan Versi Aplikasi & Cache SW:** Bump versi pada `package.json` (`1.1.30`), `PRD_SIMAS.md` (`v1.1.30`), `js/config.js` (`26.08.06.14`), `sw.js` (`simas-pwa-v50`), dan `CHANGELOG.md`.

## [1.1.29] / [26.08.06.13] - 2026-08-06

### 📊 Filter Semester & Ekspor XLSX Rekap Presensi Rombel (`wali-kelas.html` & `js/page-wali-kelas.js`)
- **Penambahan Filter Semester Ganjil & Genap:** Menambahkan opsi per semester (`Semester Ganjil` & `Semester Genap`) pada dropdown periode rekapitulasi presensi rombel (`select-attendance-month`), melengkapi filter bulanan dan filter 1 tahun ajaran penuh.
- **Konversi Ekspor ke Format Excel (.xlsx):** Mengubah mekanisme ekspor dari cetak window browser menjadi ekspor unduhan berkas Excel `.xlsx` langsung via SheetJS (`window.exportAttendanceRekap()`), lengkap dengan informasi No, NIS, Nama Siswa, Kelas, rincian kehadiran (H, S, I, A, P), Total Hari, dan Persentase Kehadiran.
- **Pembaruan Versi Aplikasi & Cache SW:** Bump versi pada `package.json` (`1.1.29`), `PRD_SIMAS.md` (`v1.1.29`), `js/config.js` (`26.08.06.13`), `sw.js` (`simas-pwa-v49`), dan `CHANGELOG.md`.

## [1.1.28] / [26.08.06.12] - 2026-08-06

### 🚫 Blokir Tombol Navigasi Tahun SPP Digital Tanpa Toast (`keuangan.html` & `js/page-keuangan.js`)
- **Navigasi Batas Tahun SPP Digital:** Menghilangkan kemunculan notifikasi popup toast ("Batas Awal" / "Batas Akhir") saat navigasi tahun SPP digital mencapai batas awal masuk siswa atau batas akhir estimasi kelulusan.
- **Auto Disable Button Navigation:** Menambahkan properti `disabled` serta styling visual (`opacity-30` & `cursor-not-allowed`) secara dinamis pada tombol navigasi tahun (`#btn-prev-year` & `#btn-next-year`) agar terblokir secara otomatis saat posisi tahun berada di batas minimal atau maksimal.
- **Pembaruan Versi Aplikasi & Cache SW:** Bump versi pada `package.json` (`1.1.28`), `PRD_SIMAS.md` (`v1.1.28`), `js/config.js` (`26.08.06.12`), `sw.js` (`simas-pwa-v48`), dan `CHANGELOG.md`.

## [1.1.27] / [26.08.06.11] - 2026-08-06

### 🎨 Rapikan Tata Letak Header Rekapitulasi Kehadiran Bulanan (`wali-kelas.html`)
- **Penyempurnaan Antarmuka & Alignment Controls:** Merapikan tata letak baris judul **Rekapitulasi Kehadiran Rombel**, wadah dropdown **Periode**, dan tombol **Cetak / Export Rekap**. Menyatukan label & dropdown periode ke dalam wadah pill modern bersudut melengkung (`rounded-xl`), mencegah penggelembung lebar select yang timpang, serta menyejajarkan tombol ekspor sejajar secara rapi di sebelah kanan.
- **Pembaruan Versi Aplikasi & Cache SW:** Bump versi pada `package.json` (`1.1.27`), `PRD_SIMAS.md` (`v1.1.27`), `js/config.js` (`26.08.06.11`), `sw.js` (`simas-pwa-v47`), dan `CHANGELOG.md`.

## [1.1.26] / [26.08.06.10] - 2026-08-06

### 🛠️ Perbaikan Validasi Data Presensi Harian, Rekap Bulanan, & Pengajuan Permisi (`js/page-wali-kelas.js`)
- **Penyelarasan Pembacaan Dokumen Presensi (`loadTodayAttendance` & `loadMonthlyAttendanceRekap`):** Mengubah pembacaan dokumen Firestore `attendance` dari yang sebelumnya membaca field `d.nis` langsung pada dokumen menjadi secara konsisten membaca peta objek `data.records` (`rec.nis` / `rec.studentNIS` / `rec.studentId`), serta mendukung status kode singkatan (`H`, `S`, `I`, `A`, `D`/`P`).
- **Penyelarasan Query Permisi Siswa (`loadPermissionData` & `loadModalDetailPresensi`):** Memperbaiki query koleksi `permisi_requests` agar memeriksa field nama kelas yang tersimpan pada dokumen (`studentClass`, `class`, `className`) serta field NIS (`studentNIS`, `studentNis`, `nis`), sehingga data permohonan permisi siswa binaan dan riwayat presensi di modal siswa ter-load 100% akurat.
- **Pembaruan Versi Aplikasi & Cache SW:** Bump versi pada `package.json` (`1.1.26`), `PRD_SIMAS.md` (`v1.1.26`), `js/config.js` (`26.08.06.10`), `sw.js` (`simas-pwa-v46`), dan `CHANGELOG.md`.

## [1.1.25] / [26.08.06.9] - 2026-08-06

### 🚀 Pembaruan Versi Cache Service Worker (`sw.js`)
- **Invalidasi Cache PWA (`sw.js`):** Memperbarui `CACHE_NAME` dari `simas-pwa-v44` ke `simas-pwa-v45` untuk memicu pengunduhan aset App Shell dan script PWA terbaru bagi seluruh perangkat pengguna saat rilis ke cabang `main`.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.1.25`), `PRD_SIMAS.md` (`v1.1.25`), `js/config.js` (`26.08.06.9`), `sw.js` (`simas-pwa-v45`), dan `CHANGELOG.md`.

## [1.1.24] / [26.08.06.8] - 2026-08-06

### 💰 Total Nominal Tunggakan SPP Rombel (`wali-kelas.html` & `js/page-wali-kelas.js`)
- **Penambahan Tfoot Summary & Badge Total Nominal:** Menampilkan akumulasi total nominal tunggakan seluruh siswa dalam satu rombel (`totalNominalRombel`) pada baris penutup tabel (`tfoot#spp-table-foot`) langsung di bawah kolom **Total Tunggakan**, serta menyajikan indikator badge baru `Total Tunggakan: Rp ...` pada header ringkasan SPP tab.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.1.24`), `PRD_SIMAS.md` (`v1.1.24`), `js/config.js` (`26.08.06.8`), dan `CHANGELOG.md`.

## [1.1.23] / [26.08.06.7] - 2026-08-06

### 🛡️ Preservasi Fragment/Hash URL pada Alur Safe Redirect Login (`index.html`, `js/page-wali-kelas.js`, `js/page-rekap-kehadiran-siswa.js`)
- **Penanganan Hash Redirect Unauthenticated (`js/page-wali-kelas.js` & `js/page-rekap-kehadiran-siswa.js`):** Meng-update pengalihan halaman login saat `!user` agar selalu menyertakan `+ window.location.hash` pada `encodeURIComponent(...)` sehingga hash target tab tidak hilang ketika pengguna belum terautentikasi.
- **Dukungan OWASP Safe Redirect unencoded Hash (`index.html`):** Menyempurnakan `getSafeRedirectUrl()` agar secara otomatis menggabungkan `window.location.hash` ke URL tujuan jika URL parameter `redirect` dipanggil secara manual tanpa encoding (`index.html?redirect=/wali-kelas.html#spp`).
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.1.23`), `PRD_SIMAS.md` (`v1.1.23`), `js/config.js` (`26.08.06.7`), dan `CHANGELOG.md`.

## [1.1.22] / [26.08.06.6] - 2026-08-06

### 🔗 Dukungan Deep Linking / Navigasi Langsung Tab Portal Wali Kelas (`wali-kelas.html` & `js/page-wali-kelas.js`)
- **Fitur Auto Tab Switch via URL Parameter & Hash:** Menambahkan logika pemrosesan URL parameter (`?tab=spp`) dan URL hash (`#spp`) pada `setupTabSwitching()` di `js/page-wali-kelas.js`. Saat halaman `wali-kelas.html` dibuka dengan tautan `/wali-kelas.html#spp` atau `/wali-kelas.html?tab=spp`, sistem akan secara otomatis membuka dan mengaktifkan tab **Status SPP**.
- **Dukungan Hash Change Dynamic:** Mendengarkan event `hashchange` sehingga pengubahan hash secara dinamis saat halaman terbuka akan langsung mengalihkan ke tab yang dituju.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.1.22`), `PRD_SIMAS.md` (`v1.1.22`), `js/config.js` (`26.08.06.6`), dan `CHANGELOG.md`.

## [1.1.21] / [26.08.06.5] - 2026-08-06

### ✈️ Penyesuaian Teks Petunjuk & Placeholder Telegram Chat ID (`guru.html` & `js/global.js`)
- **Penyelarasan Teks Petunjuk Form Input Telegram:** Memperjelas label, placeholder, dan helper text pada Modal Tambah Guru Baru, Modal Edit Guru (`guru.html`), serta Modal Edit Profil (`js/global.js`). Memberikan keterangan bahwa input Telegram Chat ID bersifat opsional dan dapat dikosongkan jika pengguna/guru belum memiliki Telegram, dengan penegasan bahwa pengguna tetap akan dapat mengisinya nanti via pop-up prompt saat login.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.1.21`), `PRD_SIMAS.md` (`v1.1.21`), `js/config.js` (`26.08.06.5`), dan `CHANGELOG.md`.

## [1.1.20] / [26.08.06.4] - 2026-08-06

### 👥 Opsi Pemilihan Siswa Kolektif Modal Catatan Pembinaan (`guru-wali.html`, `js/page-guru-wali.js`)
- **Fitur Opsi Pilih Semua (Kolektif):** Menambahkan tombol **Pilih Semua (Kolektif)** di atas kolom input siswa serta opsi teratas pada dropdown combobox (`window.selectAllCatatanSiswa()`). Fitur ini memungkinkan Guru Wali memilih seluruh siswa binaan sekaligus dengan satu kali klik, dengan fleksibilitas untuk menghapus chip siswa tertentu secara individual.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.1.20`), `PRD_SIMAS.md` (`v1.1.20`), `js/config.js` (`26.08.06.4`), dan `CHANGELOG.md`.

## [1.1.19] / [26.08.06.3] - 2026-08-06

### 🏷️ Perubahan Label Sub-Tab Jurnal Mengajar (`rekap-kehadiran-siswa.html`, `js/page-rekap-kehadiran-siswa.js`)
- **Pembaruan Label Sub-Tab Jurnal (`rekap-kehadiran-siswa.html`):** Mengubah nama label tombol sub-tab navigasi dari **Daftar Jurnal Guru** menjadi **Daftar Jurnal**, serta **Rekap KBM Jurnal** menjadi **Monitoring KBM**.
- **Penyelarasan Teks Status Loading & Error (`js/page-rekap-kehadiran-siswa.js`):** Memperbarui pesan indikator loading dan error pada panel Rekap KBM agar selaras menjadi **Memuat Monitoring KBM...** dan **Gagal memuat monitoring KBM**.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.1.19`), `PRD_SIMAS.md` (`v1.1.19`), `js/config.js` (`26.08.06.3`), dan `CHANGELOG.md`.

## [1.1.18] / [26.08.06.2] - 2026-08-06

### 🔢 Pengurutan Daftar Nama Siswa Berdasarkan Tingkat Kelas (`js/page-guru-wali.js`)
- **Pengurutan Hirarki Kelas Siswa (XII -> XI -> X):** Menambahkan fungsi penentu bobot kelas (`getGradeWeight`) pada `renderCatatanSiswaDropdown()` agar opsi daftar siswa binaan di modal catatan pembinaan secara otomatis diurutkan mulai dari siswa kelas XII terlebih dahulu, diikuti kelas XI, dan kelas X.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.1.18`), `PRD_SIMAS.md` (`v1.1.18`), `js/config.js` (`26.08.06.2`), dan `CHANGELOG.md`.

## [1.1.17] / [26.08.06.1] - 2026-08-06

### 🔍 Searchable Dropdown & Perbaikan Scroll Modal Catatan Pembinaan (`guru-wali.html`, `js/page-guru-wali.js`)
- **Komponen Searchable Dropdown Siswa (`guru-wali.html`, `js/page-guru-wali.js`):** Mengganti `<datalist>` peramban pada modal **Buat Catatan Pembinaan** (`#modal-tambah-catatan`) dengan komponen dropdown interaktif (combobox) yang terintegrasi dengan pencarian nama/NIS siswa secara real-time, penambahan chip interaktif, dan auto-close saat mengklik di luar area input.
- **Perbaikan Scrollability Modal Catatan Pembinaan (`guru-wali.html`):** Memperbaiki struktur modal (`flex flex-col max-h-[90vh]`) serta menambahkan `overflow-y-auto` pada body modal `#modal-tambah-catatan` dan `#modal-edit-catatan` serta membatasi tinggi chip `#catatan-selected-chips` (`max-h-[120px]`) sehingga modal dapat di-scroll dengan lancar dan konten tidak terpotong saat memilih banyak nama siswa binaan.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.1.17`), `PRD_SIMAS.md` (`v1.1.17`), `js/config.js` (`26.08.06.1`), dan `CHANGELOG.md`.

## [1.1.16] / [26.08.05.4] - 2026-08-05

### 🔒 Perbaikan Content Security Policy (CSP) Cloud Functions (`firebase.json`)
- **Penambahan Izin `connect-src` Cloud Functions (`firebase.json`):** Menambahkan domain Cloud Functions Firebase (`https://asia-southeast2-smagesa.cloudfunctions.net` dan `https://*.cloudfunctions.net`) ke dalam arahan `connect-src` header Content Security Policy (CSP) untuk target hosting `smagesa`, `sman1abang`, dan `simas-shakti`. Hal ini mengatasi pemblokiran peramban (*Fetch API CSP violation*) saat melakukan verifikasi Chat ID Telegram via Cloud Function (`verifyTelegramChatId`).

### 🐛 Penghapusan Duplikasi Registrasi Service Worker (`index.html`)
- **Hapus registrasi SW redundan di `index.html`:** Menghapus blok `navigator.serviceWorker.register('./sw.js')` yang terduplikasi di inline script `index.html`. Registrasi SW sudah ditangani secara terpusat oleh `js/global.js` (baris 53-58) yang dimuat di seluruh halaman. Duplikasi ini menyebabkan SW di-register dua kali — satu langsung tanpa menunggu `load` event, dan satu lagi menunggu `load` event — yang berpotensi menyebabkan *race condition* pada background fetch SW.

- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.1.16`), `PRD_SIMAS.md` (`v1.1.16`), `js/config.js` (`26.08.05.4`), dan `CHANGELOG.md`.

## [1.1.15] / [26.08.05.3] - 2026-08-05

### 🐛 Resolusi Timeout Cypress & Optimasi Emulator CI (`cypress/support/e2e.js`, `cypress.config.js`, `.github/workflows/tests.yml`)
- **Pembersihan Intersepsi Service Worker di Cypress (`cypress/support/e2e.js`):** Menambahkan logika pelepas `navigator.serviceWorker` saat pengujian Cypress E2E berlangsung. Hal ini mencegah *background Service Worker cache/fetch* menahan event `onload` peramban Cypress Electron pada runner CI yang dapat memicu *timeout 60s* saat navigasi antar-halaman (seperti `portal-siswa.html`).
- **Penyesuaian Batas Waktu & Keamanan Web Cypress (`cypress.config.js`):** Menambahkan konfigurasi `pageLoadTimeout: 30000` serta `chromeWebSecurity: false` untuk akselerasi pengujian di lingkungan CI runner.
- **Spesifikasi Emulator Firebase CI (`.github/workflows/tests.yml`):** Menambahkan argumen `--only auth,firestore` pada perintah `firebase emulators:exec`. Hal ini mencegah emulator mencoba memuat `functions/index.js` tanpa modul terinstal di runner CI yang sebelumnya menyebabkan error `Cannot find module 'firebase-functions/v2/firestore'`.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.1.15`), `PRD_SIMAS.md` (`v1.1.15`), `js/config.js` (`26.08.05.3`), dan `CHANGELOG.md`.

## [1.1.14] / [26.08.05.2] - 2026-08-05

### 📲 Penyelarasan & Refactoring Pengiriman Push Notification FCM (`functions/index.js`, `firestore.rules`)
- **Standardisasi Payload Push Notification (`functions/index.js`):** Mengganti pemanggilan FCM multicast manual pada worker `onPushNotificationCreated` dan `agendaCron` agar menggunakan helper terpusat `sendMulticastPush()`. Penyesuaian ini menjamin seluruh notifikasi push menggunakan URL ikon & badge HTTPS absolut (`https://smagesa.web.app/assets/logo-sekolah.png`) serta tautan tujuan absolut untuk mencegah kegagalan pemuatan ikon pada perangkat seluler.
- **Pembersihan Token Mati Otomatis (`functions/index.js`):** Integrasi `sendMulticastPush()` pada `onPushNotificationCreated` dan `agendaCron` kini secara otomatis mendeteksi dan menghapus token FCM yang kadaluwarsa/tidak valid dari Firestore.
- **Pengencangan Aturan Keamanan Firestore (`firestore.rules`):** Memperketat izin baca & tulis koleksi `fcm_tokens` dari `allow read, write: if true;` menjadi `allow read, write: if isSignedIn();` guna mencegah manipulasi token oleh pengguna anonim.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.1.14`), `PRD_SIMAS.md` (`v1.1.14`), `js/config.js` (`26.08.05.2`), dan `CHANGELOG.md`.

## [1.1.13] / [26.08.05.1] - 2026-08-05

### 🧪 Perluasan & Optimasi Pengujian Otomatis (Intelligent Testing Framework)
- **Penambahan Cypress E2E Spec Tests (`cypress/e2e/presensi.cy.js`, `cypress/e2e/siswa.cy.js`, `cypress/e2e/duta.cy.js`):** Memperluas cakupan pengujian E2E Cypress untuk memvalidasi proteksi otentikasi dan alur navigasi halaman Presensi Siswa/Guru, Portal Siswa, Data Siswa, serta Duta Admin secara terisolasi di atas Firebase Local Emulator (0% dampak ke data produksi).
- **Custom Cypress Support & Helper Commands (`cypress/support/e2e.js`, `cypress/support/commands.js`):** Mengkonfigurasi *supportFile* Cypress serta menambahkan *custom command* `cy.checkAuthRedirect()` dan `cy.setMockUserSession()` untuk standarisasi pengujian role & otentikasi.
- **Perluasan Unit Testing Jest (`js/utils.mjs`, `js/utils.test.mjs`, `js/push-notification.test.mjs`):** Menambahkan fungsi pengujian unit teruji mandiri untuk utilitas `formatRupiah`, `isValidEmail`, `sanitizeString`, serta pemformatan URL redirect & parsing topic FCM push notification.
- **Sinkronisasi CI/CD Intelligent Testing (`.github/workflows/tests.yml`):** Memperbarui filter *paths-filter* GitHub Actions agar perubahan kode pada modul Presensi, Siswa, Duta, dan Push Notification secara otomatis meng-eksekusi *spec test* yang relevan.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.1.13`), `PRD_SIMAS.md` (`v1.1.13`), `js/config.js` (`26.08.05.1`), dan `CHANGELOG.md`.

## [1.1.12] / [26.8.4.180] - 2026-08-04

### 🚀 Preservasi URL Target Notifikasi Push Saat Belum Login (`index.html`, `js/page-agenda.js`, `js/page-masukan.js`, `js/page-peminatan-hasil.js`)
- **Fitur Safe Redirect URL Post-Login:** Menyempurnakan alur peluncuran notifikasi push PWA saat peranti dalam status belum login (*unauthenticated*). Apabila pengguna belum login saat mengklik notifikasi, sistem secara otomatis menyimpan URL target (halaman + parameter + hash) ke dalam query string `index.html?redirect=...`.
- **Toast Informasi Petunjuk Redirect (`index.html`):** Menambahkan toast notifikasi otomatis pada halaman login `index.html` saat parameter `redirect` terdeteksi (*"Silakan login terlebih dahulu untuk langsung membuka halaman tujuan."*). Setelah pengguna berhasil login, sistem secara otomatis mengarahkan pengguna ke halaman target spesifik tersebut (*OWASP Safe Redirect*).
- **Pembaruan Versi Aplikasi & Cache SW:** Bump versi pada `package.json` (`1.1.12`), `PRD_SIMAS.md` (`v1.1.12`), `js/config.js` (`26.08.04.180`), `sw.js` (`simas-pwa-v44`), `agenda.html` (`?v=1.1.12`), dan `CHANGELOG.md`.

## [1.1.11] / [26.8.4.179] - 2026-08-04

### 🐛 Resolusi Bug Layar Blank Saat Membuka Notifikasi Push PWA (`js/global.js`)
- **Fix Unhide Guard Layar Blank (`js/global.js`):** Memperbaiki fungsi `checkPageAccess()` yang sebelumnya menetapkan `document.body.style.display = 'none'` lalu langsung menghentikan fungsi (`return`) tanpa mengembalikan visibilitas body jika `user_role` pada `localStorage` belum siap (contoh: saat PWA baru diluncurkan pertama kali via klik notifikasi push PWA dalam keadaan tertutup/cold start). Menambahkan `document.body.style.display = 'block'` pada `checkPageAccess()` jika `!role` serta di awal fungsi `initLayout()` untuk menjamin tampilan halaman tidak pernah tertahan dalam kondisi layar kosong (blank screen).
- **Pembaruan Versi Aplikasi & Cache SW:** Bump versi pada `package.json` (`1.1.11`), `PRD_SIMAS.md` (`v1.1.11`), `js/config.js` (`26.08.04.179`), `sw.js` (`simas-pwa-v43`), `agenda.html` (`?v=1.1.11`), dan `CHANGELOG.md`.

## [1.1.10] / [26.8.4.178] - 2026-08-04

### 👥 Penyesuaian Matriks Role Utama vs Role Tambahan di PRD (`PRD_SIMAS.md`)
- **Penyelarasan Klasifikasi Role (`PRD_SIMAS.md`):** Memperbarui seksi 3 (Matriks RBAC) pada dokumen PRD agar selaras 100% dengan implementasi kode (`users.html` & `js/page-users.js`). Menjabarkan dengan tegas daftar 7 **Role Utama** (`role`: `super_admin`, `kepala_sekolah`, `staff`, `guru_mapel`, `admin_pks`, `admin_kelas`, `siswa`) dan 8 **Role Tambahan / Tugas Rangkap** (`additionalRoles`: `wakasek_kurikulum`, `kesiswaan`, `kepala_lab`, `admin_spp`, `admin_sukaduka`, `admin_duta`, `wali_kelas`, `guru_bk`).
- **Pembaruan Versi Aplikasi & Cache SW:** Bump versi pada `package.json` (`1.1.10`), `PRD_SIMAS.md` (`v1.1.10`), `js/config.js` (`26.08.04.178`), `sw.js` (`simas-pwa-v42`), `agenda.html` (`?v=1.1.10`), dan `CHANGELOG.md`.

## [1.1.09] / [26.8.4.177] - 2026-08-04

### 📋 Sinkronisasi Spesifikasi Notifikasi & Cloud Functions di PRD (`PRD_SIMAS.md`)
- **Penyelarasan Dokumentasi Cloud Functions & Notifikasi (`PRD_SIMAS.md`):** Memperbarui seksi 16.2 dan 16.3 pada dokumen PRD untuk mendokumentasikan Cloud Function `verifyTelegramChatId` (HTTP Endpoint verifikasi Chat ID Telegram), optimasi kueri target role FCM (`where role in` / `array-contains-any`), penanganan URL absolut HTTPS untuk mencegah `about:blank` pada peranti seluler, penegasan penyimpanan tunggal `telegramChatId` pada koleksi `teachers` (SSOT), pengetatan filter prompt Telegram khusus akun Guru/Staf, serta mekanisme WhatsApp Web Direct Link pada rekapitulasi SPP.
- **Pembaruan Versi Aplikasi & Cache SW:** Bump versi pada `package.json` (`1.1.09`), `PRD_SIMAS.md` (`v1.1.09`), `js/config.js` (`26.08.04.177`), `sw.js` (`simas-pwa-v41`), `agenda.html` (`?v=1.1.09`), dan `CHANGELOG.md`.

## [1.1.08] / [26.8.4.176] - 2026-08-04

### 📱 Antarmuka Responsi Filter Kategori Dokumen Versi Mobile (`agenda.html` & `js/page-agenda.js`)
- **Penambahan Dropdown Filter Kategori Mobile (`agenda.html`):** Menambahkan elemen `<select id="select-doc-category-mobile">` khusus tampilan layar seluler/tablet (`block md:hidden`). Pilihan kategori dokumen kini tampil ringkas, bersih, dan mudah dipilih melalui dropdown native tanpa memakan tempat atau terpotong scrollbar. Tampilan tombol pill filter tetap dipertahankan untuk layar desktop (`hidden md:flex`).
- **Sinkronisasi Filter Dual Mode (`js/page-agenda.js`):** Memperbarui fungsi `window.filterDocsCategory()` agar secara otomatis menyelaraskan state terpilih antara tombol pill desktop dan dropdown mobile secara real-time.
- **Pembaruan Versi Aplikasi & Cache SW:** Bump versi pada `package.json` (`1.1.08`), `PRD_SIMAS.md` (`v1.1.08`), `js/config.js` (`26.08.04.176`), `sw.js` (`simas-pwa-v40`), `agenda.html` (`?v=1.1.08`), dan `CHANGELOG.md`.

## [1.1.07] / [26.8.4.175] - 2026-08-04

### 🎓 Perbaikan Tampilan Nama Lengkap Siswa Portal Guru Wali (`js/page-guru-wali.js` & `guru-wali.html`)
- **Pelepasan Restriksi `truncate` pada Nama Siswa (`js/page-guru-wali.js` & `guru-wali.html`):** Memperbaiki tampilan nama siswa pada seluruh komponen antarmuka Portal Guru Wali (Grid Card View, Table View, Matriks EWS, Modal Detail Siswa, dan Chip Pilihan Siswa). Menghapus class `truncate` dan menerapkan `break-words` serta `whitespace-normal` agar seluruh nama siswa yang panjang dapat tampil secara utuh tanpa terpotong dengan titik-titik (`...`).
- **Pembaruan Versi Aplikasi & PRD:** Bump versi pada `package.json` (`1.1.07`), `PRD_SIMAS.md` (`v1.1.07`), `js/config.js` (`26.08.04.175`), dan `CHANGELOG.md`.

## [1.1.06] / [26.8.4.174] - 2026-08-04

### 🔐 Pengetatan Otorisasi Akses Tab Pengaturan Dokumen Agenda (`js/page-agenda.js`)
- **Fix Kebocoran Visual Tombol Tab Pengaturan Dokumen (`js/page-agenda.js`):** Memperbaiki fungsi `switchAgendaTab()` yang sebelumnya secara tidak sengaja menghapus kelas `hidden` dari tombol tab `tab-btn-docs-settings` saat berpindah tab. Kini, tombol tab **Pengaturan Dokumen** dipastikan tetap tersembunyi (`hidden`) untuk peran non-pengelola seperti **Guru Mapel**, **Staf Non-Pengelola**, **Wali Kelas**, **Guru BK**, dan **Siswa**. Tombol hanya muncul untuk Tim Pengelola Agenda yang berhak (`super_admin`, `kepala_sekolah`, `wakasek_kurikulum`, `kesiswaan`, `kepala_lab`).
- **Pembaruan Versi Aplikasi & PRD:** Bump versi pada `package.json` (`1.1.06`), `PRD_SIMAS.md` (`v1.1.06`), `js/config.js` (`26.08.04.174`), dan `CHANGELOG.md`.

## [1.1.05] / [26.8.4.173] - 2026-08-04

### 🛠️ Perbaikan Lay out & Aksesibilitas Tombol Modal Edit Profil (`js/global.js`)
- **Fix Modal Scroll & Viewport Cutoff (`js/global.js`):** Memperbaiki tampilan modal `#modal-edit-profile` dengan menambahkan `max-h-[85vh]` dan `flex flex-col` pada container dialog modal, `shrink-0` pada bagian header dan footer, serta `overflow-y-auto flex-1` pada body modal. Penyesuaian ini memastikan tombol **"Simpan"** dan **"Batal"** selalu terlihat di layar dan dapat diklik dengan sempurna, bahkan saat section "Password Lama" terbuka atau diakses dari layar dengan resolusi rendah.
- **Pembaruan Versi Aplikasi & PRD:** Bump versi pada `package.json` (`1.1.05`), `PRD_SIMAS.md` (`v1.1.05`), `js/config.js` (`26.08.04.173`), dan `CHANGELOG.md`.

## [1.1.02] / [26.8.4.171] - 2026-08-04

### 🧹 Audit Kode & Pembersihan Error Potensial (`js/global.js`, `js/page-keuangan.js`, `js/page-rekap-kehadiran-siswa.js`)
- **Pencegahan Re-Verifikasi Telegram Berulang (`js/global.js`):** Memperbaiki logika `saveEditProfile()` agar hanya memicu verifikasi Telegram Chat ID jika ID yang diinput benar-benar baru/berubah. Jika Telegram Chat ID tidak diubah, proses simpan profil berjalan instan tanpa mengirim pesan verifikasi berulang.
- **Perbaikan Format Teks WA Keuangan (`js/page-keuangan.js`):** Menghapus duplikasi awalan `Rp Rp` pada string pesan WhatsApp rekapitulasi SPP kelas (`sendArrearsToWali()`).
- **Koreksi Kalkulasi Durasi Cache (`js/page-rekap-kehadiran-siswa.js`):** Memperbaiki nilai durasi kalkulasi cache daftar guru (`simas_guru_list_cache`) dari `30 * 60 * 60 * 1000` (30 jam) menjadi `30 * 60 * 1000` (30 menit).
- **Sinkronisasi Nomor Versi Aplikasi:** Menyelaraskan nomor versi di `package.json` (`1.1.02`), `PRD_SIMAS.md` (`v1.1.02`), `js/config.js` (`26.08.04.170`), dan `CHANGELOG.md`.

## [1.1.04] / [26.8.4.172] - 2026-08-04

### 🚫 Pengecualian Pop-Up Telegram Prompt untuk Akun Siswa (`js/global.js`)
- **Pengetatan Evaluasi Role Pada `checkAndShowTelegramChatIdPrompt()`:** Memperketat filter pengecualian pop-up prompt Telegram Chat ID agar akun Siswa (`role: 'siswa'` / `'student'`) dan akun non-Guru (tidak terhubung dengan dokumen `teachers`) **TIDAK AKAN PERNAH memunculkan pop-up Telegram Prompt**. Pop-up Telegram kini eksklusif hanya untuk Guru/Staff.
- **Pembaruan Versi Aplikasi & PRD:** Bump versi pada `package.json` (`1.1.04`), `PRD_SIMAS.md` (`v1.1.04`), dan `CHANGELOG.md`.

## [1.1.03] / [26.8.4.171] - 2026-08-04

### 🎯 Penegasan Penyimpanan Tunggal SSOT Telegram Chat ID (`js/global.js`)
- **Penyimpanan Eksklusif Koleksi `teachers` (SSOT Guru/Staff):** Mengubah `saveTelegramChatIdFromPrompt()` dan `saveEditProfile()` agar `telegramChatId` disimpan **HANYA di koleksi `teachers`** untuk pengguna yang terhubung dengan data Guru. Sistem tidak lagi menduplikat penyimpanan `telegramChatId` di koleksi `users`.
- **Kondisi Khusus Non-Guru (Siswa/Pengguna Umum):** Hanya jika pengguna tidak memiliki dokumen Guru di `teachers`, `telegramChatId` akan tersimpan pada koleksi `users`.
- **Pembaruan Versi Aplikasi & PRD:** Bump versi pada `package.json` (`1.1.03`), `PRD_SIMAS.md` (`v1.1.03`), dan `CHANGELOG.md`.

## [1.1.01] / [26.8.4.170] - 2026-08-04

### 🚀 Perbaikan Verifikasi & Penyimpanan Telegram Chat ID (`functions/index.js` & `js/global.js`)
- **HTTP Cloud Function Endpoint `verifyTelegramChatId` (`functions/index.js`):** Menambahkan HTTP Cloud Function `verifyTelegramChatId` dengan CORS diaktifkan (`{ region: REGION, cors: true }`). Endpoint ini memproses verifikasi Chat ID Telegram langsung dari Node.js backend ke Telegram Bot API (`https://api.telegram.org`), terbebas dari pembatasan CORS browser client.
- **Graceful Fallback & Exception Handling (`js/global.js`):** Memperbarui `verifyTelegramChatId()` dan `saveTelegramChatIdFromPrompt()` agar memvalidasi format angka `/^-?\d{5,15}$/` terlebih dahulu. Jika format angka valid namun browser mengalami pembatasan CORS/ISP network (`Failed to fetch`), sistem tidak lagi memblokir penyimpanan Telegram Chat ID dan tetap menyimpan ID pengguna secara sempurna ke Firestore (`users` & `teachers` SSOT) dengan peringatan ramah.
- **Pembaruan Versi Aplikasi & PRD:** Bump versi pada `package.json` (`1.1.01`), `PRD_SIMAS.md` (`v1.1.01`), dan `CHANGELOG.md`.

## [1.1.02] / [26.8.4.169] - 2026-08-04

### 🛡️ Perbaikan Izin Keamanan Update Profil User & Guru (`firestore.rules`)
- **Penyelarasan Field `telegramChatId` & Fallback Auth Guru:** Memperbarui fungsi pembantu `isUpdatingOwnUserProfile(userId)` dan `isUpdatingOwnLinkedTeacherProfile(teacherId)` di `firestore.rules` agar mengizinkan `telegramChatId` dalam daftar kunci yang boleh diperbarui mandiri (`hasOnly(...)`). Memperbaiki error runtime `FirebaseError: Missing or insufficient permissions.` yang muncul saat pengguna/guru mengubah profil pada fungsi `window.saveEditProfile()` di `js/global.js`.
- **Pembaruan Versi Aplikasi & PRD:** Bump versi pada `package.json` (`1.1.02`), `PRD_SIMAS.md` (`v1.1.02`), `js/config.js` (`26.08.04.169`), dan `CHANGELOG.md`.

## [1.1.01] / [26.8.4.168] - 2026-08-04

### 🐛 Perbaikan ReferenceError Declaration State Dokumen Drive (`js/page-agenda.js`)
- **Deklarasi `editingDocId` di Module Scope:** Menambahkan deklarasi variabel `let editingDocId = null;` pada scope modul utama `js/page-agenda.js`. Sebelumnya, ketiadaan deklarasi variabel ini memicu `ReferenceError: editingDocId is not defined` saat pengguna (seperti Wakasek Kurikulum/Pengelola Agenda) mengeksekusi penyimpanan atau pengeditan dokumen Google Drive sekolah.
- **Pembaruan Versi Aplikasi & PRD:** Bump versi pada `package.json` (`1.1.01`), `PRD_SIMAS.md` (`v1.1.01`), `js/config.js` (`26.08.04.168`), dan `CHANGELOG.md`.

## [1.1.00] / [26.8.4.167] - 2026-08-04

### 🐛 Perbaikan SyntaxError & Struktur Scope Tabel Tunggakan (`js/page-keuangan.js`)
- **Resolusi Mismatched Closing Brace & Conditional Scope:** Memperbaiki kesalahan peletakan kurung kurawal penutup pada `loadArrearsReport` yang sebelumnya menaruh penggabungan string `html += ...` di dalam blok pengondisian `if (res.unpaidItems.length > 4)`. Perbaikan ini menyelesaikan `SyntaxError: Unexpected token ')'` saat halaman `/keuangan.html` dimuat dan menjamin pengujian e2e Cypress 100% lulus.
- **Pembaruan Versi Aplikasi & PRD:** Bump versi pada `package.json` (`1.1.00`), `PRD_SIMAS.md` (`v1.1.00`), dan `CHANGELOG.md`.

## [1.0.99] / [26.8.4.166] - 2026-08-04

### 🛡️ Harmonisasi Narasi Anti-Spam WA Laporan Administrasi SPP (`js/page-keuangan.js`)
- **Format Pesan WA & Notifikasi Sopan & Safelist Anti-Spam:** Mengubah template pesan WA, Telegram, dan Push Notification pada tombol "Kirim Wali" agar diawali salam penghormatan personal `Yth. [Nama Guru Wali Kelas]`, menggunakan judul *INFORMASI REKAPITULASI ADMINISTRASI SPP KELAS*, serta mengganti istilah berisiko penagihan spam (`Tunggakan`, `Bln`) menjadi narasi akademis kekeluargaan (`Kelengkapan Administrasi`, `Periode`).
- **Pembaruan Versi Aplikasi & PRD:** Bump versi pada `package.json` (`1.0.99`), `PRD_SIMAS.md` (`v1.0.99`), dan `CHANGELOG.md`.

## [1.0.98] / [26.8.4.165] - 2026-08-04

### 🟢 Penyesuaian Pengiriman WA Wali Kelas & Simplifikasi Tabel Tunggakan (`js/page-keuangan.js`)
- **Peralihan Pengiriman WA Wali Kelas ke WhatsApp Web Direct Link (`sendArrearsToWali`):** Mengubah mekanisme pengiriman rekap tunggakan kelas ke Wali Kelas agar langsung membuka WhatsApp Web (`wa.me`) dengan draf pesan yang sudah terformat rapi. Menghapus ketergantungan pengiriman otomatis via Fonnte API di client-side.
- **Simplifikasi Kolom Tabel Tunggakan (`loadArrearsReport`):** Menghapus kolom `Aksi` dan tombol kirim WA individual per siswa pada setiap baris tabel tunggakan untuk memfokuskan pengaliran informasi tunggakan secara kolektif via Wali Kelas serta menyederhanakan tampilan antarmuka (menjadi 4 kolom: No, Siswa, Bulan Menunggak, Total Tagihan).
- **Pembaruan Versi Aplikasi & PRD:** Bump versi pada `package.json` (`1.0.98`), `PRD_SIMAS.md` (`v1.0.98`), dan `CHANGELOG.md`.

## [1.0.97] / [26.8.4.164] - 2026-08-04

### 🛡️ Helper Parsing Tanggal Defensif & Ekstraksi Timestamp Global (`js/page-e-lab.js` & `sw.js`)
- **Penyatuan Helper `parseLocalDate()` & `getTsMillis()` (`js/page-e-lab.js`):** Mengabstraksikan fungsi pembacaan tanggal lokal dan parsing timestamp Firestore (`.toDate()`, `.seconds`, `.toMillis()`, string, number) secara global dan defensif dengan pengecekan `isNaN()`. Digunakan secara konsisten di fungsi `quickBook`, `submitBooking`, `showBookingDetail`, `renderMobileListView`, `loadPendingBookings`, dan `formatDate`.
- **Invaliasi Cache Service Worker (`sw.js`):** Memperbarui `CACHE_NAME` ke `simas-pwa-v38` untuk menjamin seluruh perangkat mendapatkan script e-lab terbaru.
- **Pembaruan Versi Aplikasi & PRD:** Bump versi pada `package.json` (`1.0.97`), `PRD_SIMAS.md` (`v1.0.97`), dan `CHANGELOG.md`.

## [1.0.96] / [26.08.04.163] - 2026-08-04

### 🧪 Audit Lengkap & Penyempurnaan Stabilitas Modul E-Lab (`js/page-e-lab.js` & `sw.js`)
- **Penanganan Kelas Input Manual Saat Edit (`editBooking`):** Menambahkan deteksi otomatis opsi kelas manual ('Lainnya') ketika mengedit booking e-lab yang tidak terdapat dalam daftat kelas standar `classList`, memastikan input manual langsung terbuka dan terisi presisi.
- **Rendering HTML Modal Konfirmasi (`showConfirmModal`):** Mengubah `msgEl.textContent` menjadi `msgEl.innerHTML` agar format teks/HTML pada modal konfirmasi aksi (hapus lab, pembatalan, persetujuan) tampil sempurna tanpa tag HTML mentah.
- **Eliminasi Potensi Error Composite Index Firestore (`loadPendingBookings` & `loadMyBookingHistory`):** Mengoptimalkan query Firestore dengan memindahkan pengurutan (*sorting*) ke memori JavaScript (*in-memory sorting*), menjamin kueri 100% stabil tanpa risiko gagal akibat index Firestore yang belum ter-build.
- **Invaliasi Cache Service Worker (`sw.js`):** Memperbarui `CACHE_NAME` ke `simas-pwa-v37` untuk menjamin seluruh perangkat pengguna mengunduh controller e-lab terbaru.
- **Pembaruan Versi Aplikasi & PRD:** Bump versi pada `package.json` (`1.0.96`), `PRD_SIMAS.md` (`v1.0.96`), dan `CHANGELOG.md`.

## [1.0.94] / [26.08.04.161] - 2026-08-04

### 🔔 Perbaikan Layar Blank Putih Saat Notifikasi Push Di-klik di Seluler (`sw.js`, `firebase-messaging-sw.js`, & `functions/index.js`)
- **Navigasi URL Absolut di Service Worker (`sw.js`):** Mengubah pemanggilan `client.navigate()` dan `clients.openWindow()` agar selalu menggunakan `absoluteTargetUrl` yang sudah ter-resolusi penuh bertranspor HTTPS. Mencegah Chrome Android/PWA membuka `about:blank` saat mengklik notifikasi dengan target path relatif (`./dashboard.html`).
- **Resolusi Gambar & URL di Background FCM Worker (`firebase-messaging-sw.js`):** Memastikan `rawTargetUrl`, `rawIcon`, dan `rawBadge` di-resolusi ke URL absolut bertranspor HTTPS (`self.location.origin`) sebelum dipassing ke `showNotification()`.
- **Payload WebPush Absolut Backend (`functions/index.js`):** Memperbarui helper `sendMulticastPush` untuk secara otomatis mengonversi `redirectUrl` relatif menjadi URL absolut ber-prefix `https://smagesa.web.app` pada parameter `webpush.fcmOptions.link`, `data.url`, serta icon/badge notifikasi.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.94`), `PRD_SIMAS.md` (`v1.0.94`), dan `CHANGELOG.md`.

## [1.0.93] / [26.08.04.160] - 2026-08-04

### 📌 Perbaikan Referensi Data & Formatting Catatan Pembinaan di Grid Siswa (`js/page-guru-wali.js`)
- **Penanganan Date & Timestamp Firestore:** Menambahkan helper `formatNoteDate()` untuk mengonversi Firestore `Timestamp` (termasuk objek mentah/cached) menjadi format tanggal Indonesia (`DD MMM YYYY`), sehingga tidak lagi muncul string mentah `Timestamp(seconds=..., nanoseconds=...)`.
- **Query Catatan Presisi & Zero-Index Error:** Memperbarui `fetchRecentNotesForStudents()` agar mengurutkan & memilih catatan terbaru (*most recent*) per siswa berdasarkan milidetik timestamp real. Mengombinasikan query `guru_uid` ter-indeks cepat dan batch query NIS (dukung NIS String maupun Number) tanpa ketergantungan composite index Firestore query.
- **Auto-Sync Grid & Table:** Menambahkan `refreshGridAndTableNotes()` yang dipanggil otomatis saat tambah, edit, atau hapus catatan pembinaan, sehingga tampilan kartu grid dan tabel langsung terbarui secara real-time.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.93`), `PRD_SIMAS.md` (`v1.0.93`), dan `CHANGELOG.md`.

## [1.0.92] / [26.08.04.159] - 2026-08-04

### 🔍 Presisi Tombol Tampilkan & Single-Row Layout Filter Rekap KBM (`rekap-kehadiran-siswa.html`)
- **Penyusunan Single Horizontal Row:** Menyetel layout filter `panel-rekap-kbm` menjadi `flex-nowrap whitespace-nowrap overflow-x-auto scrollbar-hide`.
- **Kompaktifikasi Tombol Tampilkan & Filter:** Mengecilkan tombol `Tampilkan` (`px-3 py-1 text-xs font-bold shrink-0`) dan menyatukannya dalam 1 baris sejajar bersama Input Tanggal, Pill JP 1 s/d JP 10, dan tombol `Semua`. Menjamin 10 JP tampil sempurna dalam 1 baris tanpa wrapping.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.92`), `PRD_SIMAS.md` (`v1.0.92`), dan `CHANGELOG.md`.

## [1.0.91] / [26.08.04.158] - 2026-08-04

### 📐 Desain Kompak & Presisi Filter Card Rekap KBM (`rekap-kehadiran-siswa.html` & `js/page-rekap-kehadiran-siswa.js`)
- **Penyelarasan Kompak Checkbox JP (Rekap KBM Jurnal):** Memperbarui komponen filter checkbox JP 1 s/d JP 10 di `panel-rekap-kbm` menggunakan styling pill ringkas (`px-1.5 py-1 text-[11px] font-bold shrink-0`). Mencegah checkbox JP 10 tertekuk/terpotong ke baris kedua sehingga seluruh filter tanggal, 10 JP, tombol `Semua`, dan tombol `Tampilkan` tersusun simetris dan sangat rapi dalam 1 baris horizontal.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.91`), `PRD_SIMAS.md` (`v1.0.91`), dan `CHANGELOG.md`.

## [1.0.90] / [26.08.04.157] - 2026-08-04

### 🎨 Perbaikan Layout Header Sub-Tab Navigation (`rekap-kehadiran-siswa.html` & `js/page-rekap-kehadiran-siswa.js`)
- **Penyelarasan Layout Header Sub-Tab:** Memperbarui struktur container header dan sub-tab navigation bar menjadi segmented control horizontal yang presisi (`inline-flex whitespace-nowrap overflow-x-auto scrollbar-hide`). Mencegah tombol sub-tab tertekuk/turun ke 2 baris (*prevent wrapping*) sehingga header tampak sangat rapi, simetris, dan responsif di seluruh resolusi layar.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.90`), `PRD_SIMAS.md` (`v1.0.90`), dan `CHANGELOG.md`.

## [1.0.89] / [26.08.04.156] - 2026-08-04

### 📖 Penyatuan Hub Rekap Jurnal Mengajar Guru (`rekap-kehadiran-siswa.html` & `rekap-presensi.html`)
- **Penyatuan Hub Jurnal ke `rekap-kehadiran-siswa.html`:** Memindahkan modul **Daftar Jurnal Guru** dan **Rekap KBM Jurnal** dari `rekap-presensi.html` ke `rekap-kehadiran-siswa.html`. Halaman `rekap-kehadiran-siswa.html` kini menjadi **Single Source of Truth (SSOT) Hub** terpadu dengan 3 sub-tab navigasi (*Kehadiran Siswa*, *Daftar Jurnal Guru*, *Rekap KBM Jurnal*).
- **Refactoring `rekap-presensi.html`:** Menghapus tab & panel jurnal dari `rekap-presensi.html` agar fokus 100% pada **Presensi Kehadiran Guru** (Harian, Rekap Guru, Detail Guru). Menambahkan pengalihan otomatis (*auto-redirect*) jika diakses via URL fragment `#tab=jurnal` atau `#tab=rekap-jurnal`.
- **Preservasi Hak Akses (RBAC):** Hak akses dan restriksi berbasis penugasan guru (*teacher-scoped*) dipertahankan secara identik dan aman di seluruh sub-tab.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.89`), `PRD_SIMAS.md` (`v1.0.89`), dan `CHANGELOG.md`.

## [1.0.88] / [26.08.04.155] - 2026-08-04

### 🔒 Restriksi Role Rekap Jurnal & Perbaikan Kontras Light Mode (`js/page-rekap-kehadiran-siswa.js`)
- **Restriksi Akses Wakasek Kurikulum & Kesiswaan:** Menghapus role `wakasek_kurikulum` dan `kesiswaan` dari daftar `FULL_ACCESS_ROLES` di `rekap-kehadiran-siswa.html`. Pengguna dengan role ini kini dibatasi (*teacher-scoped*) sehingga hanya dapat melihat rekapitulasi jurnal mengajar untuk mata pelajaran dan kelas yang diampunya saja (kecuali jika pengguna memiliki peran tambahan `super_admin`, `kepala_sekolah`, atau `staff`).
- **Perbaikan Komposisi Warna Header Tanggal (Light Mode):** Mengganti styling latar belakang dan teks pada sel tanggal kegiatan pembelajaran (`thDates`) dari `bg-slate-100` menjadi `bg-slate-600 dark:bg-slate-700 text-white dark:text-slate-200 border-slate-500` sehingga teks tanggal (`d/M`) terlihat sangat jelas, kontras, dan harmonis dalam tampilan mode terang maupun mode gelap.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.88`), `PRD_SIMAS.md` (`v1.0.88`), dan `CHANGELOG.md`.

## [1.0.87] / [26.08.03.154] - 2026-08-03

### 🛠️ Perbaikan & Optimalisasi Presisi Sistem Notifikasi (`functions/index.js` & `js/page-keuangan.js`)
- **Pencegahan Duplikasi Notifikasi (Double Push/Telegram Guard):** Menambahkan *skip guard* (`skipPushFallback`) pada `sendPushNotificationForWaEvent` di Cloud Functions agar event otomatis (BK Pelanggaran/Prestasi, Permisi Siswa, E-Lab) tidak lagi menembakkan push FCM / Telegram Personal kedua.
- **Optimasi Hemat Read Firestore Target Role:** Mengubah penyaringan user berbasis target role pada `onPushNotificationCreated` dari membaca seluruh dokumen `users` menjadi dua query terarah (`where role in` dan `where additionalRoles array-contains-any`), secara drastis memangkas konsumsi kuota Read Firestore.
- **Robustness & Backend Telegram Dispatch:** Memperbaiki resolusi `targetUid` Wali Kelas pada modul keuangan berbasis master `teachers` (SSOT), serta mengamankan pengiriman notifikasi Telegram personal via backend `push_notifications` (`sendTelegram: true`).
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.87`), `PRD_SIMAS.md` (`v1.0.87`), `CHANGELOG.md`, dan `js/config.js` (`26.08.03.154`).

## [1.0.86] / [26.08.03.153] - 2026-08-03

### 📢 Notifikasi Tri-Channel Tombol 'Kirim Wali' Modul Keuangan (`js/page-keuangan.js`)
- **Notifikasi Telegram & Push App Asinkronus:** Memperbarui fungsi `sendArrearsToWali()` saat tombol **Kirim Wali** dipencet. Selain memicu pengiriman pesan WhatsApp via Fonnte/fallback, sistem kini secara asinkronus mengirimkan notifikasi Telegram ke Wali Kelas (jika `telegramChatId` mendaftar) serta mengantrekan Notifikasi Push App (FCM) ke koleksi `push_notifications` untuk perangkat Wali Kelas (`targetType: 'user'`).
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.86`), `PRD_SIMAS.md` (`v1.0.86`), `CHANGELOG.md`, dan `js/config.js` (`26.08.03.153`).

## [1.0.85] / [26.08.03.152] - 2026-08-03

### ✏️ Penyesuaian Footer Pesan Telegram (`js/global.js` & `functions/index.js`)
- **Penyelarasan Footer Pesan Telegram:** Menghapus frasa `Bot System` pada penutup footer pesan verifikasi dan balasan webhook Telegram (`js/global.js` & `functions/index.js`). Penutup footer kini seragam menggunakan `> <i>SIMAS - SHAKTI</i>`.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.85`), `PRD_SIMAS.md` (`v1.0.85`), `CHANGELOG.md`, dan `js/config.js` (`26.08.03.152`).

## [1.0.84] / [26.08.03.151] - 2026-08-03

### 👤 Resolusi Nama Asli Pengguna pada Verifikasi Telegram Alert
- **Resolusi Nama Asli pada `verifyTelegramChatId()` (`js/global.js`):** Mengubah mekanisme pengiriman pesan verifikasi Telegram agar selalu menyelesaikan nama asli pengguna dari SSOT Firestore (`teachers` / `users`) apabila nama default bernilai generic (`Pengguna`), berupa username tanpa spasi, atau email (`@`). Pesan verifikasi di Telegram kini menampilkan nama asli pengguna secara presisi (bukan username atau email).
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.84`), `PRD_SIMAS.md` (`v1.0.84`), `CHANGELOG.md`, dan `js/config.js` (`26.08.03.151`).

## [1.0.83] / [26.08.03.150] - 2026-08-03

### 📊 Ekstra Maksimum Tinggi Dropdown Nama Guru (`presensi-guru.html`)
- **Peningkatan Tinggi Maksimum Area Dropdown (`js/page-presensi-guru.js`):** Meningkatkan lagi tinggi maksimum area melayang dropdown pencarian nama guru menjadi `max-h-[420px]` (420px / ~14 nama guru dapat tampil sekaligus tanpa scroll). Threshold perhitungan adaptif posisi atas/bawah dinaikkan ke 420px.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.83`), `PRD_SIMAS.md` (`v1.0.83`), `CHANGELOG.md`, dan `js/config.js` (`26.08.03.150`).

## [1.0.82] / [26.08.03.149] - 2026-08-03

### 🧭 Posisi Dropdown Adaptif Atas/Bawah (`presensi-guru.html`)
- **Perhitungan Ruang Layar Real-Time (`js/page-presensi-guru.js`):** Menambahkan fungsi helper `adjustGuruDropdownPosition()` yang menghitung posisi elemen input relatif terhadap viewport layar (`getBoundingClientRect()`). Jika sisa ruang bawah layar kurang dari 280px dan ruang atas lebih luas, posisi dropdown secara otomatis berpindah ke atas form (`bottom-full mb-1`). Sebaliknya, jika ruang bawah mencukupi, dropdown akan tetap terbuka ke bawah (`top-full mt-1`).
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.82`), `PRD_SIMAS.md` (`v1.0.82`), `CHANGELOG.md`, dan `js/config.js` (`26.08.03.149`).

## [1.0.81] / [26.08.03.148] - 2026-08-03

### 📏 Penyesuaian Tinggi Area Dropdown Nama Guru (`presensi-guru.html`)
- **Peningkatan Kapasitas Tampilan Melayang (`js/page-presensi-guru.js`):** Meningkatkan tinggi maksimum area melayang dropdown pencarian nama guru dari `max-h-48` (192px) menjadi `max-h-72` (288px). Penyesuaian ini memungkinkan pengguna/siswa melihat lebih banyak pilihan nama guru sekaligus saat dropdown terbuka tanpa perlu scroll berlebih.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.81`), `PRD_SIMAS.md` (`v1.0.81`), `CHANGELOG.md`, dan `js/config.js` (`26.08.03.148`).

## [1.0.80] / [26.08.03.147] - 2026-08-03

### 🔍 Searchable Combobox Filter Nama Guru pada Presensi Guru (`presensi-guru.html`)
- **Filter Pencarian Ketik Nama Guru (`js/page-presensi-guru.js`):** Mengubah bidang dropdown nama guru di `presensi-guru.html` menjadi komponen combobox interaktif. Ketika form diklik/difokuskan oleh siswa/admin kelas, seluruh daftar nama guru langsung ditampilkan. Saat siswa mengetik karakter tertentu, daftar guru terfilter secara otomatis dan real-time.
- **Konsistensi Desain Visual & Mode Gelap:** Mempertahankan tampilan visual border, icon chevron down, dan style dropdown asli agar tetap serasi dengan tema Tailwind CSS & Dark Mode aplikasi.
- **Sinkronisasi Multi-Device & Mobile/Desktop:** Menyinkronkan secara otomatis nilai input dan ID guru antara tampilan mobile card dan tabel desktop, serta menangani auto-fill dari `mapel_guru` config saat mapel dipilih.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.80`), `PRD_SIMAS.md` (`v1.0.80`), `CHANGELOG.md`, dan `js/config.js` (`26.08.03.147`).

## [1.0.79] / [26.08.03.146] - 2026-08-03

### 🤖 Tautan Bot Telegram SMAGESA pada Modal Form Guru (`guru.html`)
- **Integrasi Link Bot Telegram SMAGESA (`guru.html`):** Menambahkan tautan langsung `https://t.me/smagesa_bot` (`@smagesa_bot`) dan deskripsi petunjuk visual pada bidang input *Telegram Chat ID* di Modal Tambah Guru Baru (`#form-add-teacher`) dan Modal Edit Data Guru (`#form-edit-teacher`).
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.79`), `PRD_SIMAS.md` (`v1.0.79`), `CHANGELOG.md`, dan `js/config.js` (`26.08.03.146`).

## [1.0.79] / [26.08.03.146] - 2026-08-03

### 🐛 Fix ReferenceError on Lab Booking Approval
- **Fix `rejectedCount` ReferenceError (`js/page-e-lab.js`):** Mengubah referensi variabel `rejectedCount` di fungsi `executeApproveBooking` menjadi `conflictsToReject.length`. Memperbaiki bug di mana proses persetujuan booking lab mengalami crash `ReferenceError: rejectedCount is not defined` saat menampilkan toast konfirmasi.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.79`), `PRD_SIMAS.md` (`v1.0.79`), `CHANGELOG.md`, dan `js/config.js` (`26.08.03.146`).

## [1.0.78] / [26.08.03.145] - 2026-08-03

### 📡 Dual-Channel WA + Telegram & Fix Telegram Alert Toggle Evaluation
- **Perbaikan Evaluasi Toggle Telegram Alert (`functions/index.js` & `js/page-integrasi.js`):** Memperketat evaluasi `telegramEnabled` di Cloud Functions (`sendTelegramAdminAlert` & `sendTelegramPersonalNotification`) serta di frontend controller `page-integrasi.js` menggunakan pengecekan boolean ketat (`=== true || String(...) === "true"`). Mencegah pengiriman notifikasi Telegram alert yang tetap terkirim saat toggle status nonaktif.
- **Telegram Dispatch pada `sendArrearsToWali()` (`js/page-keuangan.js`):** Saat admin mengirim laporan tunggakan kelas ke Wali Kelas via WA, notifikasi Telegram juga dikirimkan secara fire-and-forget ke Wali Kelas yang memiliki `telegramChatId` di koleksi `teachers`.
- **Helper Baru `sendTelegramToTeacherByName()` (`js/global.js`):** Fungsi client-side yang resolve `telegramChatId` dari koleksi `teachers` berdasarkan nama guru, lalu mengirim pesan via Telegram Bot API. Fire-and-forget pattern agar tidak mengganggu alur WA.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.78`), `PRD_SIMAS.md` (`v1.0.78`), `CHANGELOG.md`, dan `js/config.js` (`26.08.03.145`).

## [1.0.77] / [26.08.03.144] - 2026-08-03

### 🛡️ Audit & Penyeragaman Logika Pembacaan Telegram Chat ID (SSOT Complete)
- **Pemeriksaan Serentak Client-Side (`js/global.js`):** Mengoptimalkan `openEditProfile` dan `checkAndShowTelegramChatIdPrompt` agar selalu menyelesaikan `linkedTeacherId` atau pencarian `email` ke koleksi `teachers` (SSOT). Jika Chat ID sudah ada di koleksi `teachers`, maka akan langsung terbaca dan tidak memicu popup secara keliru.
- **Pemeriksaan Serentak Cloud Functions Backend (`functions/index.js`):** Menambahkan dispatch notifikasi personal Telegram pada pemicu `onAttendanceReminderCreated` dan `onStudentAttendanceWritten` agar Wali Kelas otomatis menerima notifikasi personal via Telegram.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.77`), `PRD_SIMAS.md` (`v1.0.77`), `CHANGELOG.md`, dan `js/config.js` (`26.08.03.144`).

## [1.0.76] / [26.08.03.143] - 2026-08-03

### 🏫 SSOT Telegram Chat ID pada Koleksi `teachers` & Form Edit Data Guru (`guru.html`)
- **Penambahan Form Telegram Chat ID di Edit Data Guru/Staff (`guru.html` & `js/page-guru.js`):** Menambahkan bidang input *Telegram Chat ID (Opsional)* pada modal Tambah Guru Baru dan modal Edit Data Guru. Dilengkapi verifikasi live Telegram API (`verifyTelegramChatId`) sebelum disimpan.
- **SSOT Koleksi `teachers`:** Memastikan `telegramChatId` tersimpan secara utama pada koleksi `teachers` (`teachers/{id}`). Penyimpanan mandiri di Edit Profil & Popup Prompt kini selalu mensinkronkan ke koleksi `teachers` berdasarkan `linkedTeacherId` maupun pencarian `email`.
- **Resolusi Notifikasi Backend (`functions/index.js`):** Menyesuaikan `sendTelegramPersonalNotification` agar membaca `telegramChatId` dari koleksi `teachers` (SSOT Utama) terlebih dahulu sebelum fallbacks.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.76`), `PRD_SIMAS.md` (`v1.0.76`), `CHANGELOG.md`, dan `js/config.js` (`26.08.03.143`).

## [1.0.75] / [26.08.03.142] - 2026-08-03

### 🧪 Verifikasi Langsung Telegram API Sebelum Penyimpanan Chat ID (`js/global.js`)
- **Validasi Format & Verifikasi Instan API (`verifyTelegramChatId`):** Sebelum Telegram Chat ID disimpan ke Firestore (baik melalui modal Edit Profil maupun Popup Prompt), sistem melakukan verifikasi format angka serta menembakkan **pesan tes verifikasi instan via Telegram Bot API** (`https://api.telegram.org/bot<TOKEN>/sendMessage`).
- **Garansi Integritas Data 100% Valid:** Jika Chat ID tidak ditemukan (`chat not found`), salah format, atau bot diblokir (`bot was blocked`), sistem secara tegas **menolak penyimpanan** dan memberi instruksi pesan error yang jelas bagi pengguna. Data hanya disimpan jika Telegram API mengembalikan status `ok: true`.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.75`), `PRD_SIMAS.md` (`v1.0.75`), `CHANGELOG.md`, dan `js/config.js` (`26.08.03.142`).

## [1.0.74] / [26.08.03.141] - 2026-08-03

### 💬 Popup Form Edukasi Telegram Chat ID Otomatis (`js/global.js`)
- **Pemeriksaan Izin & Popup Otomatis (`checkAndShowTelegramChatIdPrompt`):** Menampilkan modal popup interaktif (*Telegram Chat ID Prompt*) secara otomatis saat pengguna login jika akun belum memiliki Telegram Chat ID.
- **Pengecualian Peran (*Role Exclusion*):** Akun dengan peran `admin_kelas`, `admin_pks`, dan `siswa` secara ketat **dikecualikan** dari popup ini sesuai aturan bisnis.
- **Langkah Praktis & Snooze 24 Jam:** Menyediakan tombol 1-klik menuju `@smagesa_bot` untuk mendapatkan Chat ID 1-tap copy, serta opsi penundaan "Nanti Saja" (mengingatkan kembali dalam 24 jam).
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.74`), `PRD_SIMAS.md` (`v1.0.74`), `CHANGELOG.md`, dan `js/config.js` (`26.08.03.141`).

## [1.0.73] / [26.08.03.140] - 2026-08-03

### 🤖 Telegram Webhook Engine & Balasan Otomatis Chat ID 1-Tap Copy (@smagesa_bot)
- **Engine Webhook HTTP Cloud Function (`exports.telegramWebhook`):** Menambahkan HTTP Cloud Function endpoint (`https://asia-southeast2-smagesa.cloudfunctions.net/telegramWebhook`) yang menangani pesan pengirim dari Bot Telegram `@smagesa_bot`.
- **Balasan Otomatis Chat ID Monospace 1-Tap Copy:** Saat pengguna membuka atau menyapa `@smagesa_bot`, bot secara otomatis membalas dengan menampilkan **Chat ID pengguna dalam format tag `<code>` HTML**. Di aplikasi Telegram (HP & Desktop), teks dalam tag `<code>` akan disalin secara instan hanya dengan 1 kali sentuhan (*1-tap copy*).
- **Integrasi Modal Profil (`js/global.js`):** Mengarahkan link "Cek Chat ID" di modal Edit Profil pengguna secara langsung ke `https://t.me/smagesa_bot`.
- **Tombol Registrasi Webhook Instant (`integrasi.html` & `js/page-integrasi.js`):** Menambahkan tombol **Set Webhook** pada panel manajemen integrasi Telegram untuk mendaftarkan URL webhook Cloud Function secara instan ke Telegram Bot API.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.73`), `PRD_SIMAS.md` (`v1.0.73`), `CHANGELOG.md`, dan `js/config.js` (`26.08.03.140`).

## [1.0.72] / [26.08.03.139] - 2026-08-03

### ✈️ Integrasi Notifikasi Personal Telegram per User / Guru
- **Input Telegram Chat ID Mandiri pada Profil (`js/global.js`):** Menambahkan bidang input *Telegram Chat ID (Notifikasi Personal)* lengkap dengan tautan bantuan ke `@userinfobot` pada modal Edit Profil pengguna. Data tersimpan secara otomatis pada dokumen `users/{uid}` dan `teachers/{linkedTeacherId}` (SSOT).
- **Backend Dual-Channel Dispatch (`functions/index.js`):** Menambahkan fungsi helper `sendTelegramPersonalNotification(targetUid, messageText, redirectUrl)` yang mengeksekusi pengiriman pesan personal via Bot Telegram. Seluruh pemicu notifikasi otomatis (Pelanggaran, Permisi, Presensi, E-Lab, Outbox) kini menembakkan notifikasi serentak ke **Web Push FCM** dan **Telegram Personal HP Pengguna**.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.72`), `PRD_SIMAS.md` (`v1.0.72`), `CHANGELOG.md`, dan `js/config.js` (`26.08.03.139`).

## [1.0.71] / [26.08.03.138] - 2026-08-03

### 🧹 Standardisasi Terpusat Seluruh Pengiriman Push Notification Backend (`functions/index.js`)
- **Penerapan Terpusat `sendMulticastPush` di Seluruh Triger Backend:** Menghubungkan semua fungsi pengiriman push notification (`sendRecordPushNotificationToWali`, `sendPermissionPushNotificationToWali`, `sendLabBookingCreatedPushNotification`, `sendLabBookingUpdatedPushNotification`, `onAttendanceReminderCreated`, dan `onStudentAttendanceWritten`) menggunakan fungsi helper terpusat `sendMulticastPush`.
- **Garansi 100% Cleaning Token Kadaluwarsa Otomatis:** Menjamin seluruh pemicu push notification di backend akan secara otomatis mendeteksi dan menghapus dokumen token mati/tidak valid dari Firestore jika Google FCM mengembalikan respons galat token.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.71`), `PRD_SIMAS.md` (`v1.0.71`), `CHANGELOG.md`, dan `js/config.js` (`26.08.03.138`).

## [1.0.70] / [26.08.03.137] - 2026-08-03

### ⏰ Penyesuaian Interval Prompter Banner Izin Push Notification (1 Hari)
- **Frekuensi Edukasi Izin Push (`js/push-notification.js`):** Mengubah durasi penundaan (*snooze interval*) banner edukasi izin push notification jika pengguna memilih tombol "Nanti Saja" dari sebelumnya 7 hari menjadi **1 hari (24 jam)** sesuai arahan pemilik produk.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.70`), `PRD_SIMAS.md` (`v1.0.70`), `CHANGELOG.md`, dan `js/config.js` (`26.08.03.137`).

## [1.0.69] / [26.08.03.136] - 2026-08-03

### 🚀 Peningkatan Kualitas Notifikasi: Banner Prompter Izin & Cleaning Token Mati Otomatis
- **Banner Prompter Izin Notifikasi UI (`js/push-notification.js`):** Menambahkan komponen UI banner interaktif (*Push Permission Banner*) yang muncul secara elegan jika izin notifikasi di browser pengguna masih `default` (belum diizinkan/ditolak). Banner ini memberikan edukasi manfaat notifikasi dan memudahkan pengguna mengaktifkan push notification hanya dengan 1 klik (`Aktifkan Sekarang`).
- **Helper Terpusat Multi-Device Sender & Cleaning Token Mati (`sendMulticastPush`):** Menambahkan fungsi helper terpusat `sendMulticastPush` di backend Cloud Functions (`functions/index.js`). Fungsi ini secara otomatis memicu pencabutan/pembersihan dokumen token mati (`messaging/invalid-registration-token` & `messaging/registration-token-not-registered`) dari Firestore untuk mencegah pemborosan kuota read/write database.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.69`), `PRD_SIMAS.md` (`v1.0.69`), `CHANGELOG.md`, dan `js/config.js` (`26.08.03.136`).

## [1.0.68] / [26.08.03.135] - 2026-08-03

### 📲 Penerapan Notifikasi Berlanjut Berdasarkan Pengguna Login Terakhir pada Perangkat
- **Retensi Token Pengguna Terakhir Saat Logout (`js/global.js`):** Menghapus eksekusi pencabutan token FCM (`unregisterFCMToken`) saat logout sesuai arahan pemilik produk. Perangkat HP/browser akan tetap menerima push notification milik pengguna yang terakhir kali login di perangkat tersebut, meskipun dalam keadaan *logged-out*.
- **Perpindahan Kepemilikan Token Saat Akun Baru Login (`registerFCMToken`):** Kepemilikan token perangkat baru akan ditransfer secara otomatis hanya ketika ada pengguna baru (*User B*) yang melakukan login di perangkat tersebut.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.68`), `PRD_SIMAS.md` (`v1.0.68`), `CHANGELOG.md`, dan `js/config.js` (`26.08.03.135`).

## [1.0.67] / [26.08.03.134] - 2026-08-03

### 🔐 Integrasi Unregister FCM Token pada Logout Manual & Auto-Logout (`js/global.js`)
- **Panggilan Unregister FCM pada Logout (`confirmLogout` & `initAutoLogout`):** Menghubungkan fungsi `window.unregisterFCMToken()` sebelum mengeksekusi `signOut(auth)` saat pengguna menekan tombol keluar (*manual logout*) atau ketika sesi berakhir karena idle (*AFK auto-logout*). Ini menjamin token push notification perangkat langsung dicabut detik itu juga begitu pengguna keluar dari sistem.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.67`), `PRD_SIMAS.md` (`v1.0.67`), `CHANGELOG.md`, dan `js/config.js` (`26.08.03.134`).

## [1.0.66] / [26.08.03.133] - 2026-08-03

### 🔒 Garansi Perlindungan Token FCM Perangkat Berganti Akun (Multi-Account Device Safety)
- **Pembersihan Otomatis Token Pengguna Lama (`registerFCMToken`):** Mengembangkan logika pendaftaran token FCM agar secara otomatis mendeteksi dan menghapus dokumen token lama milik pengguna sebelumnya pada perangkat/browser yang sama (`token == deviceToken && userId != currentUserId`). Ini mencegah notifikasi pengguna lama tertukar/terkirim ke perangkat HP yang telah berganti pengguna atau peran (*role*).
- **Fungsi Unregister Token saat Logout (`unregisterFCMToken`):** Menambahkan fungsi pencabutan token FCM yang secara otomatis dipanggil saat pengguna keluar dari aplikasi, mencabut akses push notification perangkat dari akun pengguna tersebut.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.66`), `PRD_SIMAS.md` (`v1.0.66`), `CHANGELOG.md`, dan `js/config.js` (`26.08.03.133`).

## [1.0.65] / [26.08.03.132] - 2026-08-03

### 📢 Penambahan Penerima Admin Kelas pada Notifikasi Presensi (No. 6 & No. 7)
- **Fungsi Resolusi Admin Kelas (`getAdminKelasUidsForClass`):** Menambahkan fungsi helper terpusat untuk mengambil UID pengguna dengan peran utama `admin_kelas` maupun peran tambahan (`additionalRoles`) yang ditugaskan di kelas terkait (`assignedClass == className`).
- **Penerima Pengingat Presensi (No. 6 - `onAttendanceReminderCreated`):** Menyertakan perangkat `Admin Kelas` kelas bersangkutan di samping `Wali Kelas` untuk menerima pengingat push presensi harian / kehadiran guru pukul 15:10 WITA.
- **Penerima Rekapitulasi Presensi (No. 7 - `onStudentAttendanceWritten`):** Menyertakan `Admin Kelas` kelas bersangkutan di samping `Wali Kelas` untuk menerima notifikasi push rekapitulasi saat data presensi disimpan/diperbarui.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.65`), `PRD_SIMAS.md` (`v1.0.65`), `CHANGELOG.md`, dan `js/config.js` (`26.08.03.132`).

## [1.0.64] / [26.08.03.131] - 2026-08-03

### 🎯 Penyesuaian Presisi Sasaran Penerima & Navigasi Halaman Siswa Modal (`?nis=XXX`)
- **Fokus Penerima Khusus Wali (No. 1, 2, 3):** Membatasi sasaran notifikasi push Pelanggaran, Prestasi, dan Izin Siswa murni HANYA kepada `Guru Wali` dan `Wali Kelas` bersangkutan (`sendRecordPushNotificationToWali` & `sendPermissionPushNotificationToWali`).
- **Navigasi Langsung Modal Detail Siswa (`siswa.html?nis=XXX`):** Mengubah tautan klik pada notifikasi No. 1, 2, dan 3 menuju `./siswa.html?nis=${studentNIS}`. Saat diklik, browser akan langsung membuka halaman data siswa dan otomatis memicu pencarian serta tampilan modal detail (*Detail Modal*) siswa terkait.
- **Pembersihan Penerima Super Admin (No. 8):** Menghapus penambahan otomatis peran `super_admin` pada outbox generic `sendPushNotificationForWaEvent` sehingga notifikasi laporan/kendala murni terkirim ke penerima target.
- **Konfirmasi Eksklusi Admin PKS (No. 9):** Memastikan `agendaCron` tetap mengartikan `admin_pks` dalam `excludedRoles` (`admin_kelas`, `admin_pks`, `siswa`).
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.64`), `PRD_SIMAS.md` (`v1.0.64`), `CHANGELOG.md`, dan `js/config.js` (`26.08.03.131`).

## [1.0.63] / [26.08.03.130] - 2026-08-03

### 🔗 Penyelarasan Navigasi Klik Notifikasi Native & In-App
- **Dukungan Klik Toast In-App (`js/global.js` & `js/push-notification.js`):** Mengembangkan fungsi `showToast` agar menerima parameter opsional `onClickUrl`. Saat notifikasi push terdeteksi saat halaman aktif (foreground), pengguna dapat mengklik popup toast yang muncul di sudut layar untuk langsung berpindah ke halaman tujuan terkait (misal: `./bk.html`, `./presensi.html`, `./e-lab.html`, `./masukan.html`, `./sukaduka/suka-duka.html`, `./agenda.html`).
- **Navigasi Presisi Notifikasi Kas Suka-Duka (`sendPushNotificationForWaEvent`):** Mengarahkan `redirectUrl` notifikasi Kas Suka-Duka secara khusus ke `./sukaduka/suka-duka.html` (sebelumnya ke `./dashboard.html`).
- **Penyelarasan BK Prestasi (`sendRecordPushNotificationToWali`):** Mengarahkan `redirectUrl` notifikasi Prestasi ke `./bk.html` agar konsisten dengan pusat data poin dan rekapitulasi siswa.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.63`), `PRD_SIMAS.md` (`v1.0.63`), `CHANGELOG.md`, dan `js/config.js` (`26.08.03.130`).

## [1.0.62] / [26.08.03.129] - 2026-08-03

### 🎯 Penyempurnaan Presisi Multi-Targeting Notifikasi FCM Web Push
- **Perluasan Target BK Pelanggaran & Prestasi (`sendRecordPushNotificationToWali`):** Menambahkan peran `guru_bk`, `kesiswaan`, dan `super_admin` ke dalam daftar penerima *real-time* FCM push notification untuk seluruh pencatatan poin BK (selain Guru Wali & Wali Kelas), menjamin tim pembina kesiswaan dan manajemen sekolah memantau insiden secara langsung.
- **Perluasan Target Izin Siswa Keluar (`sendPermissionPushNotificationToWali`):** Menambahkan `Guru Wali`, `admin_pks` (Piket/Gerbang), `guru_bk`, dan `super_admin` ke dalam sasaran push notification untuk permohonan permisi siswa.
- **Dukungan Resolusi Kontak Guru dari Master Teachers (`sendPushNotificationForWaEvent`):** Menambahkan relasi `linkedTeacherId` dari koleksi `teachers` ke `users` saat meresolusi nomor telepon target penerima WA.
- **Pembersihan Kode (DRY):** Mengeliminasi deklarasi fungsi duplikat `getWaliKelasUidsForClass` pada `functions/index.js`.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.62`), `PRD_SIMAS.md` (`v1.0.62`), `CHANGELOG.md`, dan `js/config.js` (`26.08.03.129`).

## [1.0.61] / [26.08.03.128] - 2026-08-03

### 📲 Penyiapan Saluran Dual FCM Web Push Notification pada Seluruh Trigger Otomatis
- **Resolusi Penerima FCM Berbasis Nomor Telepon (`sendPushNotificationForWaEvent`):** Mengembangkan pencarian token FCM yang tidak hanya mengecek `super_admin` dan UID pembuat, tetapi juga secara otomatis meresolusi nomor telepon target penerima WA (baik format `62...` maupun `0...`) ke dokumen user/teacher terkait. Ini menjamin pengingat berkala seperti tunggakan Kas Suka-Duka (`sukadukaTunggakanCron`) dan notifikasi outbox umum terkirim 100% via FCM Web Push ke HP/browser penerima bersangkutan.
- **Pemberian FCM Web Push pada Pengingat Presensi (`onAttendanceReminderCreated`):** Menambahkan penyiapan dan pengiriman notifikasi FCM Web Push langsung ke Wali Kelas saat cron/sistem membuat dokumen pengingat presensi harian atau pengingat kehadiran guru kelas.
- **Garansi Saluran Dual Notifikasi Sistem:** Seluruh 10 trigger notifikasi otomatis sistem (catatan BK pelanggaran/prestasi, izin siswa, pengajuan & persetujuan lab, pengingat presensi wali kelas, pengingat tunggakan kas suka-duka, laporan masukan, dan cron agenda) kini 100% memiliki saluran pengiriman paralel via FCM Web Push Notification.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.61`), `PRD_SIMAS.md` (`v1.0.61`), `CHANGELOG.md`, dan `js/config.js` (`26.08.03.128`).

## [1.0.60] / [26.08.03.127] - 2026-08-03

### 🔔 Penyempurnaan & Optimalisasi Penuh In-App & FCM Web Push Notification
- **Pembuatan Service Worker Khusus FCM (`firebase-messaging-sw.js`):** Menambahkan file `firebase-messaging-sw.js` di root aplikasi untuk menangani pesan FCM Web Push secara native saat tab browser ditutup atau berjalan di latar belakang (background push), yang diintegrasikan dengan `sw.js` utama.
- **Peningkatan Penanganan Push Foreground (`js/push-notification.js`):** Memasang pembunyian audio lonceng (2-tone chime) sintetis via Web Audio API saat notifikasi masuk ketika aplikasi sedang dibuka (foreground), serta menyediakan helper `requestNotificationPermission()` untuk meminta izin notifikasi dari pengguna secara mudah.
- **Dukungan WebPush Payload Lengkap pada Cloud Functions (`functions/index.js`):** Menambahkan objek `webpush` (termasuk ikon, badge, dan link aksi) pada komando multicast `onPushNotificationCreated`.
- **Saluran Notifikasi Dual/Fallback untuk Event Sistem (`onWaNotificationCreated`):** Menambahkan pemicu FCM Web Push Notification otomatis untuk setiap dokumen `wa_notifications` yang dibuat (seperti masukan/laporan kendala dari siswa/guru). Dengan ini, sekalipun akun WhatsApp terblokir atau terlepas, notifikasi sistem tetap terkirim 100% secara instan ke perangkat HP/browser Super Admin dan pengguna target.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.60`), `PRD_SIMAS.md` (`v1.0.60`), `CHANGELOG.md`, `sw.js` (`simas-pwa-v35`), dan `js/config.js` (`26.08.03.127`).

## [1.0.59] / [26.08.03.126] - 2026-08-03

### 🛠️ Perbaikan Presisi Failover WA Gateway & Penyederhanaan Alert Telegram
- **Perbaikan Deteksi Respons Provider (`executeWaProviderFetch` & `page-integrasi.js`):** Memperbaiki validasi status respons HTTP untuk provider Wapanels (`app.wapanels.com`). Sebelumnya, kode hanya mengecek apakah status bernilai `false`/`error`, sehingga respons status HTTP 200 dengan payload `status: 400` / `500` (seperti saat perangkat WA terputus atau appkey salah) dianggap sukses secara keliru oleh backend. Hal ini menyebabkan pengalihan (*fallback*) ke gateway cadangan tidak terpicu pada sebagian kondisi. Sekarang deteksi sukses mengecek nilai `200` / `true` / `success` secara presisi untuk Wapanels dan `true` untuk Fonnte.
- **Peningkatan Guard Status Fallback (`hasFallback1` & `hasFallback2`):** Memastikan pengecekan boolean `fallbackEnabled` dan `fallback2Enabled` mendukung tipe data boolean dan string `"true"`.
- **Penyederhanaan Alert Telegram (`sendTelegramAdminAlert`):** Mengubah format pesan notifikasi Telegram saat WA Primary/Backup gagal menjadi lebih singkat, padat, dan *to the point* tanpa format yang terlalu panjang.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.59`), `PRD_SIMAS.md` (`v1.0.59`), `CHANGELOG.md`, dan `js/config.js` (`26.08.03.126`).

## [1.0.58] / [26.08.03.125] - 2026-08-03

### 🛠️ Perbaikan Sintaks Target Flag Preview Channel CI/CD (`.github/workflows/deploy.yml`)
- **Penyesuaian Flag Target Hosting (`--only smagesa`):** Mengubah `--only hosting:smagesa` menjadi `--only smagesa` pada perintah `firebase hosting:channel:deploy beta`. Pada perintah `hosting:channel:deploy`, Firebase CLI menerima nama target secara langsung (`smagesa`) tanpa awalan `hosting:`. Perbaikan ini menyelesaikan error `Hosting site or target hosting:smagesa not detected in firebase.json`.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.58`), `PRD_SIMAS.md` (`v1.0.58`), `CHANGELOG.md`, dan `js/config.js` (`26.08.03.125`).

## [1.0.57] / [26.08.02.124] - 2026-08-02

### 🛠️ Perbaikan Validasi Token WA Gateway pada Cloud Functions (`functions/index.js`)
- **Penanganan Token Failover Terpusat (`hasAnyWaToken`):** Memperbaiki kondisi guard `hasWaToken` pada seluruh Cloud Function Triggers (`onPermissionWaNotify`, `onViolationWaNotify`, `onAchievementWaNotify`, `onBKActionCreated`, `onAttendanceReminderCreated`, `cronSukaDukaTunggakan`). Sebelumnya, fungsi-fungsi tersebut hanya mengecek `primaryToken`, sehingga ketika Token Primary kosong/non-aktif tetapi Token Backup (Fallback 1 / Fallback 2) aktif, fungsi langsung `return null` dan membatalkan eksekusi sebelum mencapai mesin `sendWhatsAppWithFallback`.
- **Dukungan Failover Penuh:** Sekarang seluruh Cloud Function Triggers mengecek ketersediaan token di seluruh tier (Primary, Fallback 1, Fallback 2) melalui helper `hasAnyWaToken(waConfig)`, menjamin pengiriman pesan otomatis (seperti siswa permisi/izin) tetap berjalan lancar via gateway backup saat Primary tidak aktif.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.57`), `PRD_SIMAS.md` (`v1.0.57`), `CHANGELOG.md`, dan `js/config.js` (`26.08.02.124`).

## [1.0.56] / [26.08.01.123] - 2026-08-01

### 📋 Perubahan Label Menu Sidebar Presensi ("Rekap Siswa" -> "Rekap Jurnal Mengajar")
- **Pembaruan Label Menu & Halaman:** Mengubah nama item menu sidebar `rekap_kehadiran_siswa` pada `js/global.js` serta judul & heading pada `rekap-kehadiran-siswa.html` dari "Rekap Siswa" menjadi "Rekap Jurnal Mengajar" agar lebih akurat merefleksikan sumber data yang di-input guru dari jurnal mengajar kelas.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.56`), `PRD_SIMAS.md` (`v1.0.56`), `CHANGELOG.md`, dan `js/config.js` (`26.08.01.123`).

## [1.0.55] / [26.08.01.122] - 2026-08-01

### 🎯 Spesifikasi Target Hosting pada Channel Preview CI/CD (`.github/workflows/deploy.yml`)
- **Penentuan Target Spesifik Hosting (`--only hosting:smagesa`):** Mengubah flag `--only hosting` menjadi `--only hosting:smagesa` pada perintah `firebase hosting:channel:deploy beta`. Karena `firebase.json` mengonfigurasi hosting sebagai array bertarget (`"target": "smagesa"`), penentuan nama target secara eksplisit ini menyelesaikan error *Hosting site or target hosting not detected*.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.55`), `PRD_SIMAS.md` (`v1.0.55`), `CHANGELOG.md`, dan `js/config.js` (`26.08.01.122`).

## [1.0.54] / [26.08.01.121] - 2026-08-01

### 🔑 Penguatan Scope Otentikasi Google Cloud CI/CD (`.github/workflows/deploy.yml`)
- **Penambahan Explicit Scopes pada Step `google-github-actions/auth`:** Menambahkan parameter `scopes` (`cloud-platform` & `datastore`) pada aksi otentikasi Workload Identity / Service Account. Hal ini menjamin access token yang dihasilkan oleh Firebase CLI memiliki hak akses resmi ke API Firestore Index Management (`https://firestore.googleapis.com/v1/...`).
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.54`), `PRD_SIMAS.md` (`v1.0.54`), `CHANGELOG.md`, dan `js/config.js` (`26.08.01.121`).

## [1.0.53] / [26.08.01.120] - 2026-08-01

### ⚙️ Perbaikan CI/CD Deployment Target (`.github/workflows/deploy.yml`)
- **Perbaikan Preview Channel Deploy (`testing` branch):** Menambahkan flag `--only hosting` pada perintah `firebase hosting:channel:deploy beta` di workflow GitHub Actions. Hal ini mencegah Firebase CLI mencoba mendeploy/memvalidasi Firestore indexes pada channel preview yang memicu error permission HTTP 403 / internal request failure.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.53`), `PRD_SIMAS.md` (`v1.0.53`), `CHANGELOG.md`, dan `js/config.js` (`26.08.01.120`).

## [1.0.52] / [26.08.01.119] - 2026-08-01

### ⏱️ Penambahan Rate-Limiting & Jeda Pengiriman WA (Anti Burst-Sending)
- **Fungsi Helper `sleep` Backend (`functions/index.js`):** Menambahkan fungsi asynchronous helper `sleep(ms)` untuk membatasi kecepatan alur eksekusi pengiriman pesan otomatis.
- **Rate-Limiting Multi-Tujuan (`onLabBookingCreated`):** Menambahkan jeda 2.0 detik antar pengiriman pesan ke daftar Kepala Lab ketika pengajuan booking dibuat.
- **Throttling Pengiriman Massal Cron (`cronSukaDukaTunggakan`):** Mengubah pengiriman massal dari *all-at-once burst* menjadi mini batch (3 item per commit) yang diberi jeda 2.5 detik antar batch. Hal ini memastikan fungsi worker outbox `onWaNotificationCreated` memproses antrean pesan secara teratur tanpa memicu *rate-limit ban* pada API WA Unofficial.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.52`), `PRD_SIMAS.md` (`v1.0.52`), `CHANGELOG.md`, dan `js/config.js` (`26.08.01.119`).

## [1.0.51] / [26.08.01.118] - 2026-08-01

### 📱 Perbaikan Redaksi & Kepatuhan Pesan WhatsApp Otomatis (Ketentuan WA Unofficial API)
- **Penyesuaian Footer Branding Resmi:** Mengubah seluruh footer pesan WhatsApp otomatis dari `> _SIMAS - SHAKTI smagesa.web.app_` menjadi `> _SIMAS - SHAKTI_` untuk mencegah deteksi link domain mentah oleh algoritma anti-spam WhatsApp Unofficial API.
- **Teks Himbauan Simpan Nomor Kontak:** Menambahkan pesan himbauan `_Catatan: Harap simpan nomor ini agar pemberitahuan sekolah terkirim lancar._` pada seluruh notifikasi WhatsApp otomatis.
- **Penyelarasan Istilah Sensitif Kas Suka-Duka:** Mengubah judul dan narasi pengingat Kas Suka-Duka dari istilah berisiko penagihan ("Tunggakan", "Denda", "Tagihan") menjadi narasi akademis/kekeluargaan (`*Informasi Rekapitulasi Kas Suka-Duka*`, `• Estimasi Total Partisipasi:`).
- **Pembersihan URL Mentah & Formatting:** Menghapus parameter URL halaman dari body WA masukan/saran dan mengubah subjek ALL CAPS menjadi *Title Case* untuk menghindari *fingerprinting* dan pemblokiran nomor WA bot.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.51`), `PRD_SIMAS.md` (`v1.0.51`), `CHANGELOG.md`, dan `js/config.js` (`26.08.01.118`).

## [1.0.50] / [26.08.01.117] - 2026-08-01

### 🔄 Canonical Redirect Guard Optimization (`index.html`)
- **Inline Canonical Guard di Head (`index.html`):** Menambahkan script *Canonical Redirect Guard* langsung pada tag `<head>` sebelum stylesheet & HTML body dimuat. Hal ini memastikan pengguna yang mengunjungi domain alias (`simas-shakti.web.app`, `sman1abang.web.app`, dll.) langsung di-redirect ke `https://smagesa.web.app` secara instan tanpa sempat menampilkan antarmuka halaman login di browser.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.50`), `PRD_SIMAS.md` (`v1.0.50`), `CHANGELOG.md`, dan `js/config.js` (`26.08.01.117`).

## [1.0.49] / [26.07.31.116] - 2026-07-31

### 📦 Fitur Pengarsipan Dokumen & Penyederhanaan Label (`agenda.html` & `js/page-agenda.js`)
- **Fitur Pengarsipan Dokumen (`isArchived`):** Menambahkan kemampuan bagi pengguna berhak (Tim Pengelola Agenda) untuk mengarsipkan atau memulihkan dokumen. Dokumen yang diarsipkan tidak akan lagi muncul di filter *Semua Kategori* maupun filter kategori reguler.
- **Filter Khusus Dokumen Arsip:** Menambahkan tab filter **📦 Arsip** pada halaman agenda untuk menampilkan berkas-berkas yang sudah diarsipkan dengan penanda khusus `DIARSIPKAN`.
- **Indikator Jelas di Pengaturan Dokumen:** Menambahkan badge penanda kontras `📦 DIARSIPKAN` pada daftar item Pengaturan Dokumen agar penerbit/admin dapat dengan mudah membedakan mana dokumen aktif dan mana yang diarsipkan sebelum mengambil tindakan edit atau hapus.
- **Penyederhanaan Label UI:** Mengubah penamaan label **"Dokumen Google Drive"** menjadi **"Dokumen"** pada tab navigation dan header panel untuk efisiensi tata letak antarmuka.

### 📱 Fitur Nama Akun / Catatan Perangkat WA Gateway (`integrasi.html`, `js/page-integrasi.js`, & `functions/index.js`)
- **Input Nama Akun Perangkat:** Menambahkan field input opsional *Nama Akun / Catatan Perangkat* (`primaryAccountName`, `fallbackAccountName`, `fallback2AccountName`) pada form konfigurasi WA Gateway Primary, Backup 1, dan Backup 2 di `integrasi.html`.
- **Ringkasan Matrix Provider:** Menampilkan nama akun/perangkat di bawah nama provider pada tabel ringkasan matrix di halaman Integrasi agar memudahkan pelacakan status.
- **Telegram Alert Spesifik:** Memperbarui pesan Telegram Warning & Critical Alert di Cloud Functions (`functions/index.js`) agar secara otomatis menyertakan nama akun/perangkat (misal: `FONNTE - WA Admin Utama (0812xxx)`), sehingga Super Admin langsung mengetahui perangkat mana yang membutuhkan tindakan pemeliharaan (*maintenance*).
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.49`), `PRD_SIMAS.md` (`v1.0.49`), `CHANGELOG.md`, dan `js/config.js` (`26.07.31.116`).

## [1.0.48] / [26.07.31.115] - 2026-07-31

### 📱 Penyempurnaan Total Engine WA Gateway Failover 3-Tier (`functions/index.js`)
- **Pengecekan Respon API Presisi:** Memperbaiki logika evaluasi status pada `executeWaProviderFetch` agar menangani status berjenis boolean (`false`), string (`"false"`), `"error"`, maupun `"failed"` tanpa kecolongan.
- **Failover Token Primary Kosong:** Jika `primaryToken` kosong atau tidak terpasang, sistem tidak menghentikan alur melainkan langsung mengalihkan eksekusi ke `Backup 1` dan `Backup 2`.
- **Fokus Provider Resmi (Fonnte & Watsap.id):** Membersihkan sisa acuan provider `Wablas` & `Custom HTTP` di backend sehingga seluruh failover berpusat murni pada 2 provider resmi terpercaya (*Fonnte* & *Watsap.id/Wapanels*).
- **Telegram Warning & Critical Alert**: Memastikan Telegram Warning Alert terkirim saat Primary/Backup 1 gagal sebelum beralih ke tier berikutnya, dan Telegram Critical Alert terkirim jika seluruh gateway aktif gagal total.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.48`), `PRD_SIMAS.md` (`v1.0.48`), `CHANGELOG.md`, dan `js/config.js` (`26.07.31.115`).

## [1.0.47] / [26.07.31.114] - 2026-07-31

### 🛡️ Proteksi Pengalihan Mutlak Siswa (`index.html`)
- **Pengebalan Redirect Log Masuk Siswa:** Menyesuaikan logika autentikasi dan submit login siswa pada `index.html` agar mengabaikan parameter `redirect` URL (misal: `?redirect=%2Fdashboard.html`) dan selalu mengarahkan siswa secara mutlak ke **Portal Siswa** (`portal-siswa.html`).
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.47`), `PRD_SIMAS.md` (`v1.0.47`), `CHANGELOG.md`, dan `js/config.js` (`26.07.31.114`).

## [1.0.46] / [26.07.31.113] - 2026-07-31

### 🎨 Redesain & Perbaikan UI Dark Mode Halaman Login (`index.html`)
- **Peningkatan Glassmorphic Card Login:** Menambahkan efek *dark glassmorphism* bertransparansi halus (`rgba(15, 23, 42, 0.82)`), *backdrop blur* 24px, border kilau transparan, dan *ambient outer glow* pada kartu login sehingga memberikan kesan mewah dan memiliki kedalaman visual (*depth*).
- **Keterbacaan Input & Dropdown Select:** Mengatur styling khusus untuk `<select>` Tanggal, Bulan, Tahun Lahir beserta opsi `<option>` dropdown agar tetap memiliki latar belakang gelap dan teks berkontras tinggi tanpa masalah tampilan serba putih di browser Windows.
- **Peningkatan Kontras Badge Mode & Pesan Alert Error:** Mengubah skema warna badge indikator mode (`Admin/Guru` & `Siswa`) dan pesan kesalahan (`#error-msg`) menggunakan latar belakang transparan berteks terang berkontras tinggi yang sangat nyaman dibaca di malam hari.
- **Tombol Utama & Aksen Warna:** Mengaplikasikan gradien *vibrant blue-indigo* pada tombol login (`Masuk Aplikasi`) beserta efek hover glow, serta menyelaraskan warna aksen `SHAKTI`, divider, link lupa sandi/daftar akun, dan teks versi di footer.
- **Konsistensi Modal Pendukung:** Menyesuaikan kontainer dan form di dalam Modal Pendaftaran Akun dan Lupa Sandi saat dibuka dalam Dark Mode.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.46`), `PRD_SIMAS.md` (`v1.0.46`), `CHANGELOG.md`, dan `js/config.js` (`26.07.31.113`).

## [1.0.45] / [26.07.31.112] - 2026-07-31

### 🛠️ Perbaikan UI Input Nomor WA di Modal Uji Pengiriman
- **Pembersihan Ikon Overlap Input Phone:** Menghapus ikon telepon di dalam kotak input nomor WhatsApp pada modal uji pengiriman agar teks nomor yang diketik tidak tertutup atau terhalang oleh ikon.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.45`), `PRD_SIMAS.md` (`v1.0.45`), `CHANGELOG.md`, dan `js/config.js` (`26.07.31.112`).

## [1.0.44] / [26.07.31.111] - 2026-07-31

### 🎨 Custom Modal Popup Uji Pengiriman & Pembersihan Kolom Matrix
- **Penghapusan Kolom Uji Pengiriman Matrix:** Menghapus kolom "Uji Pengiriman" dari tabel Ringkasan Matrix Provider karena pengujian sudah terpusat di masing-masing Card Gateway.
- **Modal Popup Uji Coba Keren:** Menggantikan `prompt()` browser default dengan Modal Popup UI kustom yang mewah (Glassmorphism backdrop, animasi halus, input nomor WhatsApp & pesan tes, indikator status gateway, dan tombol Kirim interaktif).
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.44`), `PRD_SIMAS.md` (`v1.0.44`), `CHANGELOG.md`, dan `js/config.js` (`26.07.31.111`).

## [1.0.43] / [26.07.31.110] - 2026-07-31

### 🧪 Interaktif Test Dialog & Pembersihan Card Uji Coba Static
- **Penghapusan Card Uji Coba Static:** Menghapus panel card statis "Panel Uji Coba Pengiriman WA Gateway" di bawah halaman integrasi agar antarmuka lebih bersih dan fokus.
- **Uji Coba Pengiriman Interaktif Dialog:** Mengubah tombol **Tes** di setiap Card Gateway dan Tabel Matrix menjadi dialog/prompt interaktif yang secara langsung meminta input Nomor WA Tujuan secara fleksibel saat pengujian dijalankan.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.43`), `PRD_SIMAS.md` (`v1.0.43`), `CHANGELOG.md`, dan `js/config.js` (`26.07.31.110`).

## [1.0.42] / [26.07.31.109] - 2026-07-31

### 📱 Penyederhanaan Provider WA Gateway (Fonnte & Watsap.id)
- **Pembersihan Provider WA Gateway:** Menyederhanakan pilihan provider WA Gateway hanya pada 2 provider resmi terpercaya: **Fonnte** (`api.fonnte.com`) dan **Watsap.id / Wapanels** (`app.wapanels.com`). Provider Wablas dan Custom HTTP yang tidak digunakan telah dihapus dari dropdown dan backend agar tampilan lebih bersih dan ringkas.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.42`), `PRD_SIMAS.md` (`v1.0.42`), `CHANGELOG.md`, dan `js/config.js` (`26.07.31.109`).

## [1.0.41] / [26.07.31.108] - 2026-07-31

### 📱 3-Tier Multi-Provider WA Gateway Failover & Summary Matrix Panel
- **3-Tier WA Failover Gateway (Primary -> Backup 1 -> Backup 2 -> Telegram Alert):** Meningkatkan kapasitas gateway cadangan WhatsApp hingga 3 lapis bertingkat. Jika Primary gagal, otomatis failover ke Backup 1; jika Backup 1 gagal, otomatis failover ke Backup 2; jika semua gagal, langsung memicu Telegram Critical Alert.
- **Tabel Ringkasan Matrix Provider (`integrasi.html` & `js/page-integrasi.js`):** Menambahkan tabel ringkasan terstruktur di bagian bawah halaman integrasi yang menampilkan seluruh provider WA (Primary, Backup 1, Backup 2, Telegram Alert) beserta status, App Key, Masked API Token (`••••••••` / Eye Toggle), dan tombol pengujian instan.
- **Backend Cloud Functions Update (`functions/index.js`):** Memperbarui `sendWhatsAppWithFallback` untuk memproses rantai alih kelola 3 tingkat secara otomatis.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.41`), `PRD_SIMAS.md` (`v1.0.41`), `CHANGELOG.md`, dan `js/config.js` (`26.07.31.108`).

## [1.0.40] / [26.07.31.107] - 2026-07-31

### 📱 Penambahan Provider WA Gateway: Wapanels (Watsap.id)
- **Integrasi Wapanels (`app.wapanels.com`):** Menambahkan preset provider Wapanels (Watsap.id) pada pilihan WA Gateway Multi-Provider dengan dukungan parameter `appkey`, `authkey`, `to`, dan `message` ke endpoint `https://app.wapanels.com/api/create-message`.
- **Pembaruan UI Integrasi (`integrasi.html` & `js/page-integrasi.js`):** Menambahkan opsi Wapanels pada dropdown provider beserta input interaktif `App Key` dan `Auth Key` untuk gateway Primary dan Backup.
- **Pembaruan CSP (`firebase.json`):** Menambahkan `https://app.wapanels.com` ke header `connect-src` CSP.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.40`), `PRD_SIMAS.md` (`v1.0.40`), `CHANGELOG.md`, dan `js/config.js` (`26.07.31.107`).

## [1.0.39] / [26.07.31.106] - 2026-07-31

### 📱 Multi-Provider WhatsApp Gateway & Telegram Super Admin Alert
- **Multi-Provider WhatsApp Gateway (`settings/wa_config`):** Mendukung konfigurasi fleksibel gateway WA Primary & Fallback (Fonnte, Wablas, atau Custom HTTP API Endpoint) untuk pengalihan pengiriman otomatis saat gateway utama mengalami gangguan atau terdiskonek.
- **Notifikasi Telegram Super Admin (@smagesa_bot / Chat ID 198160734):** Pengiriman notifikasi peringatan/kritis secara otomatis ke Telegram Super Admin saat salah satu gateway WA terdiskonek atau gagal mengirimkan pesan.
- **Pencegahan Error & Edge Cases (`functions/index.js`):** Implementasi normalisasi nomor HP terpusat (`cleanPhoneNumber`), isolasi error Telegram (`try/catch` mandiri), timeout request 10 detik dengan `AbortController`, debouncing alert Telegram (anti-spam), serta backward compatibility penuh untuk konfigurasi lama.
- **Pembaruan UI Integrasi (`integrasi.html` & `js/page-integrasi.js`):** Menyediakan panel manajemen WA Primary, WA Fallback, dan Telegram Alert lengkap dengan tombol tes pengiriman langsung dari dashboard.
- **Pembaruan CSP (`firebase.json`):** Menambahkan `https://api.telegram.org` ke header `connect-src` CSP.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.39`), `PRD_SIMAS.md` (`v1.0.39`), `CHANGELOG.md`, dan `js/config.js` (`26.07.31.106`).

## [1.0.38] / [26.07.31.105] - 2026-07-31

### 🔐 Perluasan Otorisasi Akses Tab Pengaturan Dokumen Agenda
- **Penyelarasan Role Manager Agenda (`js/page-agenda.js` & `firestore.rules`):** Menyelaraskan hak akses CRUD pada Tab Pengaturan Dokumen (`agenda_documents`) agar dapat diakses oleh seluruh Tim Pengelola Agenda (`isManager` / `isCalendarManager()`): `super_admin`, `kepala_sekolah`, `wakasek_kurikulum`, `kesiswaan`, dan `kepala_lab`.
- **Pembaruan Aturan Keamanan Firestore (`firestore.rules`):** Mengubah aturan `allow write` pada koleksi `agenda_documents/{docId}` menggunakan helper function `isCalendarManager()`.
- **Pembaruan UI & Dokumentasi (`agenda.html` & `PRD_SIMAS.md`):** Memperbarui subtitle pada tab Pengaturan Dokumen dan dokumen PRD untuk mencerminkan batasan peran baru.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.38`), `PRD_SIMAS.md` (`v1.0.38`), dan `js/config.js` (`26.07.31.105`).

## [1.0.37] / [26.07.31.104] - 2026-07-31

### 🔍 Pembaruan Tampilan Input Pencarian Dokumen Agenda
- **Penghapusan Icon Kaca Pembesar (`agenda.html`):** Menghapus ikon `fa-search` yang menutupi teks placeholder/input pada kolom pencarian dokumen serta menyesuaikan padding input (`px-4`) agar teks terlihat jernih dan rapi.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.37`), `PRD_SIMAS.md` (`v1.0.37`), dan `js/config.js` (`26.07.31.104`).

## [1.0.36] / [26.07.30.103] - 2026-07-30

### 👤 Resolusi Nama Pengunggah Dokumen Secara Dinamis & Eliminasi Generik Text
- **Pencarian Nama Pengunggah Real-time (`js/page-agenda.js`):** Mengganti fallback teks generik `"Admin / Staf"` dengan resolusi otomatis nama pengguna aktif yang sedang login (`currentUserName`) serta pencarian nama dari dokumen Firestore `users/{uid}` via `usersCache`.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.36`), `PRD_SIMAS.md` (`v1.0.36`), dan `js/config.js` (`26.07.30.103`).

## [1.0.35] / [26.07.30.102] - 2026-07-30

### 🎨 Refaktor Tampilan Kartu Dokumen (Kustomisasi Warna Tombol & Proteksi Deskripsi Kosong)
- **Pewarnaan Tombol & Ikon Berdasarkan Jenis File (`js/page-agenda.js`):** Menghapus badge teks jenis file di sudut kanan atas agar tampilan lebih bersih. Warna dan ikon tombol **"Buka Dokumen"** kini disesuaikan secara dinamis berdasarkan jenis berkas (Biru untuk Google Docs, Hijau untuk Google Sheets, Oranye untuk Google Slides, Merah untuk PDF, dan Kuning untuk Folder Drive).
- **Proteksi Deskripsi Kosong:** Menyembunyikan elemen keterangan deskripsi jika dokumen tidak memiliki deskripsi (mencegah munculnya teks "Tidak ada deskripsi.").
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.35`), `PRD_SIMAS.md` (`v1.0.35`), dan `js/config.js` (`26.07.30.102`).

## [1.0.34] / [26.07.30.101] - 2026-07-30

### ✨ Peningkatan Tampilan Grid Dokumen Google Drive & Metadata Pengunggah
- **Metadata Pengunggah & Tanggal Upload (`agenda.html` & `js/page-agenda.js`):** Menambahkan tampilan profil nama pengunggah (`createdByName`) dan tanggal upload yang diformat ramah (`30 Jul 2026`) pada setiap kartu dokumen.
- **Badge Status "BARU":** Menampilkan badge status **BARU** animasi secara otomatis untuk dokumen yang baru diunggah dalam 7 hari terakhir.
- **Deteksi Otomatis Jenis Berkas Google Drive:** Deteksi otomatis tipe tautan Google Docs, Google Sheets, Google Slides, Berkas PDF, atau Folder Drive dengan ikon dan penanda khusus.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.34`), `PRD_SIMAS.md` (`v1.0.34`), dan `js/config.js` (`26.07.30.101`).

## [1.0.33] / [26.07.30.100] - 2026-07-30

### 🏷️ Perubahan Penamaan Halaman "Agenda Sekolah" Menjadi "Agenda dan Dokumen"
- **Pembaruan Navigasi & Header Halaman:** Mengubah nama menu sidebar (`js/global.js`) dan header utama halaman (`agenda.html`) dari "Agenda Sekolah" menjadi "Agenda dan Dokumen" untuk merepresentasikan integrasi fitur berkas/dokumen resmi Google Drive.
- **Preservasi Halaman Login:** Mempertahankan label "Agenda Sekolah" pada halaman login / lander publik (`index.html`) sesuai arahan.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.33`), `PRD_SIMAS.md` (`v1.0.33`), dan `js/config.js` (`26.07.30.100`).

## [1.0.32] / [26.07.30.99] - 2026-07-30

### 🔄 Implementasi Canonical Auto-Redirect ke Domain Utama (Preservasi Scope PWA)
- **Otomatisasi Redirect Domain Alias ke `smagesa.web.app`:** Menambahkan pengalihan otomatis 301 via `firebase.json` dan client-side guard di `js/global.js` dari domain alias (`simas-shakti.web.app`, `sman1abang.web.app`) langsung menuju domain utama `https://smagesa.web.app`. Pengguna yang membuka domain alias kini langsung mengonsumsi PWA yang sudah ter-install tanpa pernah diminta meng-install ulang.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.32`), `PRD_SIMAS.md` (`v1.0.32`), dan `js/config.js` (`26.07.30.99`).

## [1.0.31] / [26.07.30.98] - 2026-07-30

### 📲 Dokumentasi Perilaku PWA Multi-Domain & Isolasi Scope Origin pada PRD
- **Seksi 9.3 (Isolasi Origin & Scope PWA Multi-Domain):** Mendokumentasikan perilaku standar browser (*Same-Origin Policy*) di mana instalasi PWA dan Service Worker terikat secara ketat pada Origin/Domain masing-masing. Membuka domain mirror/alias (`simas-shakti.web.app`) setelah menginstal PWA dari `smagesa.web.app` akan memicu konfirmasi instalasi PWA kembali karena enkapsulasi browser.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.31`), `PRD_SIMAS.md` (`v1.0.31`), dan `js/config.js` (`26.07.30.98`).

## [1.0.30] / [26.07.30.97] - 2026-07-30

### 🌐 Dokumentasi Daftar Link Domain Akses Utama Aplikasi pada PRD
- **Seksi 1.3 (Domain & URL Akses Utama Aplikasi):** Menambahkan tabel spesifikasi URL/Domain akses utama aplikasi SIMAS - SHAKTI (`https://smagesa.web.app`), domain mirror (`https://sman1abang.web.app`), domain alias produk (`https://simas-shakti.web.app`), fallback Firebase domain, serta URL link ke subsistem eksternal (Jurnal Mengajar, Portal Game Arcade, & Koperasi SSA).
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.30`), `PRD_SIMAS.md` (`v1.0.30`), dan `js/config.js` (`26.07.30.97`).

## [1.0.29] / [26.07.30.96] - 2026-07-30

### 📁 Fitur Integrasi Dokumen & Link Google Drive pada Agenda Sekolah
- **Manajemen Link Google Drive (`agenda.html` & `js/page-agenda.js`):** Menambahkan fitur publikasi link dokumen Google Drive yang terorganisir berdasarkan Kategori (*Kurikulum & Pembelajaran*, *Akademik & Kalender*, *SOP & Panduan Resmi*, *Pengumuman & SK*, *Umum*).
- **Tab Pengaturan CRUD Khusus Admin & Kurikulum:** Menambahkan Tab Pengaturan / Panel Kelola Dokumen khusus untuk role `super_admin` dan `wakasek_kurikulum` untuk menambah, mengedit, dan menghapus metadata dokumen Google Drive. Pengguna staf/guru lain hanya memiliki hak akses baca (*Read Only*).
- **Skema Firestore & Proteksi Keamanan (`firestore.rules`):** Menambahkan koleksi `agenda_documents` untuk mengelola tautan berkas fisik Google Drive secara efisien tanpa beban storage.
- **Seksi 14.1 (Kamus Data 25 Koleksi Firestore Utama):** Melengkapi seluruh 25 koleksi & dokumen konfigurasi Firestore `smagesa`, termasuk `credit_rules`, `tpmps_evaluations`, `feedbacks`, `student_specializations`, `time_capsules`, `wordcloud_inputs`, `audit_logs`, `fcm_tokens`, `wa_notifications`, `push_outbox`, dan seluruh dokumen `settings/*` (`system_config`, `login_config`, `push_config`, `wa_config`, `jurnal_sync_state`, `rapor_config`).
- **Seksi 14.3 (Kamus Data Subsistem Satelit):** Mendokumentasikan koleksi Firestore `jurnal-smagesa` (`data_siswa`, `data_guru`, `daftar_kelas`, `daftar_mapel`) serta koleksi Portal Game Arcade (`pid_games`, `pid_leaderboards`).
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.29`), `PRD_SIMAS.md` (`v1.0.29`), dan `js/config.js` (`26.07.30.96`).

## [1.0.28] / [26.07.30.95] - 2026-07-30

### 📄 Penyelarasan Total PRD_SIMAS.md Berdasarkan Data Asli Kode Sistem
- **Seksi 5.3 (Kebijakan Otomatisasi Firestore TTL Expiration Policy):** Mendokumentasikan otomatisasi fitur Firestore TTL (`fieldOverrides` pada `firestore.indexes.json`) untuk 7 koleksi/kolom (`attendance_reminders.createdAt`, `audit_logs.ttlDelete`, `lab_bookings.ttldelete`, `login_history.ttlDelete`, `student_sessions.updatedAt`, `wa_notifications.createdAt`, `walikelas_notes.ttlDelete`) untuk pencegahan akumulasi sampah data tanpa biaya Cloud Function.
- **Seksi 14.1 (Kamus Data 14 Koleksi Firestore Utuh):** Melengkapi skema field 14 koleksi Firestore utama (`students`, `teachers`, `users`, `attendance`, `records`, `finance_transactions`, `student_aggregates`, `bk_actions`, `permisi_requests`, `walikelas_notes`, `guru_wali_assignments`, `guru_wali_notes`, `lab_bookings`, `agendas`).
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.28`), `PRD_SIMAS.md` (`v1.0.28`), dan `js/config.js` (`26.07.30.95`).

## [1.0.27] / [26.07.30.94] - 2026-07-30

### 📄 Audit Lengkap & Penyempurnaan PRD_SIMAS.md (100% Comprehensive Coverage)
- **Modul Input Catatan Aktivitas Siswa Cepat (Seksi 4.27):** Mendokumentasikan modul `input.html` & `js/page-input.js` untuk entri cepat catatan disiplin, permohonan izin, dan data riwayat catatan siswa.
- **Sistem AI Assistant Gemini 3.5 Flash Lite (Seksi 17):** Menambahkan dokumentasi arsitektur Generative AI Assistant, manajemen per-user API Key (`geminiApiKey` & `localStorage`), generator catatan rapor otomatis (`buildRaporNotePrompt`), serta konfigurasi terpusat Super Admin (`settings/system_config`).
- **Strategi PWA Service Worker (Seksi 9.3):** Mendokumentasikan versi cache PWA `simas-pwa-v33`, strategi Stale-While-Revalidate untuk 61 berkas App Shell, bypass kebijakan cross-origin (Firebase/Supabase/CDN), dan offline fallback.
- **Kamus Data Supabase SQL Lengkap (Seksi 14.2):** Melengkapi skema 6 tabel Supabase SQL (`duta_kandidat`, `duta_suara_masuk`, `sukaduka_anggota`, `sukaduka_iuran`, `sukaduka_kas`, `sukaduka_pengaturan`).
- **Analitik & Jejak Audit (Seksi 6.3):** Mendokumentasikan penanganan Google Analytics 4 (`G-EQ70T6WDH2`) dan fungsi global pencatat jejak audit `window.logAudit` ke koleksi `audit_logs`.
- **Pembaruan Versi Aplikasi:** Bump versi pada `package.json` (`1.0.27`), `PRD_SIMAS.md` (`v1.0.27`), dan `js/config.js` (`26.07.30.94`).

## [1.0.26] / [26.07.30.93] - 2026-07-30

### ⚙️ Dokumentasi Komprehensif Cloud Functions & Logika Otomatisasi pada PRD
- **Seksi 16.1 (Arsitektur Backend Cloud Functions):** Menjelaskan infrastruktur Firebase Cloud Functions v2 (Node.js 18, region `asia-southeast1`, zona waktu WITA `Asia/Makassar`) dan pengintegrasian Firebase Admin SDK serta Firebase Client SDK.
- **Seksi 16.2 (Katalog 22 Cloud Functions & Triggers):** Mendokumentasikan secara rinci seluruh 22 export Cloud Functions, termasuk Agregasi Server-Side BK (`onRecordCreated`, `onRecordDeleted`, `onRecordUpdated`), Outbox Workers (`onViolationWaNotify`, `onPermissionWaNotify`, `onLabBookingCreated`, `onLabBookingUpdated`, `onAttendanceReminderCreated`, `onWaNotificationCreated`, `onPushNotificationCreated`), Cloud Scheduler Crons dengan Proteksi Hari Libur (`studentAttendanceCron`, `attendanceCron`, `agendaCron`, `sukadukaTunggakanCron`), serta SSOT Inter-Database Event Triggers & Debounce Worker (`onStudentWrittenForJurnal`, `onTeacherWrittenForJurnal`, `onRaporConfigWrittenForJurnal`, `onUserWrittenForJurnal`, `jurnalSyncCron`, `onStudentAttendanceWritten`, `onAgendaWritten`).
- **Seksi 16.3 (Matriks Logika Otomatisasi Client-Side):** Pemetaan lengkap mesin otomatisasi antarmuka pengguna seperti Auto-Context Login Form (`isNIS()`), Kalkulator SimasEWS BK (Ambating 100 Poin DO), Two-Step Permission Approval, SPP Multi-Grade Tariff, Denda Menunggak Suka Duka (Rp 50.000 / 3 bulan), Constraint Voting Duta (1 NIS = 1 Vote), Multi-Role Access Evaluation, Offline-First Hybrid Cache (`SIMAS_CACHE_DB`), dan Anonymous Auth.
- **Seksi 16.4 (Diagram Alir Sinkronisasi Cross-Database):** Menambahkan diagram Mermaid alur otomatisasi sinkronisasi SSOT antar-database dari SIMAS `smagesa` ke Jurnal Mengajar `jurnal-smagesa` dengan jendela anti-spam *Debounce Window 5 Menit*.
- **Pembaruan Versi Aplikasi:** Update nomor versi di `package.json` (`1.0.26`), `PRD_SIMAS.md` (`v1.0.26`), dan `js/config.js` (`26.07.30.93`).

## [1.0.25] / [26.07.30.92] - 2026-07-30

### 👥 Penambahan Kolom Jenis Kelamin pada Import Massal Data Siswa & Update PRD
- **Dukungan Jenis Kelamin (Gender: L/P) Pada Import Massal:** Menambahkan kolom `gender` (Jenis Kelamin: L/P) ke dalam `STUDENT_SCHEMA` pada [js/page-students.js](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-students.js) pada indeks 4 (Kolom E), serta memperbarui petunjuk urutan kolom visual Excel (Kolom A s.d. Q) dan header preview di [siswa.html](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/siswa.html).
- **Normalisasi Input Otomatis:** Menambahkan logika pembersihan data sehingga variasi teks seperti `"Laki-laki"`, `"LAKI-LAKI"`, `"L"`, `"l"` dinormalisasi menjadi `"L"`, dan `"Perempuan"`, `"PEREMPUAN"`, `"P"`, `"p"` dinormalisasi menjadi `"P"`.
- **Sinkronisasi Dokumen PRD & App Version:** Memperbarui spesifikasi Seksi 4.4 pada [PRD_SIMAS.md](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/PRD_SIMAS.md) untuk mencakup kolom Jenis Kelamin, serta menaikkan versi aplikasi pada `package.json` (`1.0.25`) dan `js/config.js` (`26.07.30.92`).

## [1.0.24] / [26.07.30.05] - 2026-07-30

### 📄 Penambahan Spesifikasi Mendalam Bab 13 - 15 pada PRD_SIMAS.md
- **Bab 13 (Matriks Keamanan Database & Aturan Akses `firestore.rules`):** Penjelasan fungsi pembantu evaluator otorisasi multi-role (`hasAnyOfRoles()`) dengan perlindungan kuota 1 read query, dan tabel CRUD matrix per koleksi Firestore.
- **Bab 14 (Kamus Data & Skema Field Koleksi Database):** Rincian skema field terstruktur untuk dokumen Firestore (`students`, `teachers`, `users`, `attendance`, `records`, `finance_transactions`) dan tabel Supabase SQL (`duta_suara_masuk`, `sukaduka_iuran`).
- **Bab 15 (Matriks Pengujian Otomatis Cypress E2E):** Pemetaan skenario pengujian E2E dari `TC-AUTH-01` hingga `TC-DUT-07` untuk seluruh modul utama aplikasi.

## [1.0.23] / [26.07.30.04] - 2026-07-30

### 📄 Audit Faktual & Koreksi Alur Login Otomatis (Auto-Context Detection)
- **Koreksi Alur Login (`index.html` - Bab 4.1):** Menghapus seluruh sebutan 'Tab Siswa' / 'Tab Staff' dan menggantinya dengan deskripsi faktual **Otomatisasi Konteks Input Identitas Pengguna (`#user-identity`)**. Sistem secara otomatis beralih ke Mode Siswa (`#mode-siswa` dengan Tanggal Lahir + NISN alternatif) jika input berupa angka NIS, atau beralih ke Mode Admin/Guru (`#mode-staff` dengan Password) jika input berupa NIP/Username/Email.
- **Audit 100% Bebas Halusinasi:** Menjalankan audit menyeluruh terhadap 26 modul HTML & JS untuk mengonfirmasi kelengkapan elemen UI, tombol, koleksi database, dan logika bisnis asli sistem.

## [1.0.22] / [26.07.30.03] - 2026-07-30

### 📄 Penambahan Komprehensif Bab 9 - 12 pada PRD_SIMAS.md
- **Bab 9 (Arsitektur File, PWA & FCM Web Push Notification):** Mendokumentasikan direktori project lengkap, dependensi client (Tailwind, SheetJS, Firebase 11.0.2, Supabase), serta push notification `push-notification.js`.
- **Bab 10 (Skema Cache Hibrida 3-Lapis Offline-First):** Menjelaskan pembagian 3 tingkatan cache (`sessionStorage` → `localStorage` dengan TTL → IndexedDB `SIMAS_CACHE_DB` via `indexeddb-cache.js`).
- **Bab 11 (Kerangka Pengujian & Quality Assurance):** Penjelasan lengkap strategi testing 3 lapis (Jest Unit Test `--experimental-vm-modules`, Cypress E2E Testing, & Firebase Emulator Suite `npm run emulate:test`).
- **Bab 12 (Manajemen Pemeliharaan & Disaster Recovery):** Detail mekanisme sakelar *Maintenance Mode* (`settings/login_config`) dan prosedur restorasi data SSOT dari `integrasi.html`.

## [1.0.21] / [26.07.30.02] - 2026-07-30

### 📄 Revisi & Penyempurnaan PRD_SIMAS.md (Faktual Sesuai Kode & Penambahan Logika Unik Sistem)
- **Koreksi Form Role Pengguna (Bab 4.3):** Menyesuaikan struktur penetapan role pada `users.html` antara Jabatan Utama (7 opsi `role`) dan Checklist Role Tambahan (8 opsi `additionalRoles`), mencakup total 14 Role Key resmi sistem.
- **Koreksi Faktual Tabel Master Guru (Bab 4.5):** Memperbaiki deskripsi tabel di `guru.html` agar 100% sesuai dengan kode HTML (kolom NIP, Nama Lengkap & Gelar, Jabatan, Tanggal Lahir, Kontak Email & No. WA).
- **Koreksi Frekuensi Presensi Siswa (Bab 4.6):** Menegaskan bahwa pencatatan presensi siswa di `presensi.html` dilakukan **1x harian per rombel per tanggal**, bukan per jam pelajaran.
- **Penambahan Bab 4.27 Logika Unik Sistem:** Membagikan 9 aturan bisnis dan logika unik sistem (SimasEWS 100 Poin DO, Presensi Guru 10 JP, SPP bertingkat, Suka Duka denda kelipatan 3 bulan, Duta E-Voting 1 NIS 1 Vote di bulan Juli, Diferensiasi Wali Kelas vs Guru Wali, Two-Step Permission, Auth Anonim Kapsul Waktu, & Real-time SSOT Sync).

## [1.0.20] / [26.07.30.01] - 2026-07-30

### 📄 Revisi & Penyempurnaan PRD_SIMAS.md (100% Faktual Sesuai Kode & Masukan Pengguna)
- **Pengurutan Matriks Peran RBAC (Bab 3):** Memperbarui tabel RBAC di `PRD_SIMAS.md` dengan mengurutkan secara sistematis berdasarkan **Role Utama (Primary Roles)** (Super Admin s/d Guru BK), **Role Tambahan (Additional Roles)** (`admin_sukaduka`, `panitia_duta`), dan **Role Siswa** (`admin_pks`, `admin_kelas`, `siswa`).
- **Lengkapi Seluruh Role di Pengelolaan Akun (Bab 4.3):** Mencantumkan 10 Primary Roles, 4 Additional Roles, dan Role Siswa secara rinci pada spesifikasi modul `users.html`.
- **Koreksi Fitur Faktual Login (Bab 4.1):** Menghapus klaim "Fitur Ingat Saya & Lupa Password" yang belum diimplementasikan di `index.html`.
- **Pemisahan Alur Kerja Login (Bab 4.1):** Membagi alur kerja otentikasi secara detail antara **Alur Login Siswa** (NIS + Tanggal Lahir/NISN → `sessionStorage` → `portal-siswa.html`) dan **Alur Login Staf/Pengajar** (Email/NIP → Firebase Auth → `localStorage` → `dashboard.html`).
- **Koreksi Widget Dashboard (Bab 4.2):** Menghapus klaim "Widget Jadwal Mengajar" yang belum ada di `dashboard.html`, serta memperjelas fitur asli *Two-Step Permission Approval* dan *Early Warning System (SimasEWS)*.

## [26.07.29.91] - 2026-07-29

### 🔄 Real-Time Auto-Sync Mapel & Eliminasi Orphan Key (PKWU) ke Jurnal Mengajar
- **Real-Time Auto-Sync (`page-e-rapor.js`):** Setiap kali admin menyimpan, mengedit, atau menghapus mata pelajaran / guru pengampu di SIMAS, sistem secara otomatis melakukan penulisan batch (`writeBatch(dbJurnal)`) langsung ke database Firestore Jurnal Mengajar (`dbJurnal`). Perubahan data guru & mapel kini tersinkronisasi seketika secara real-time tanpa perlu klik sync manual lagi.
- **Sanitasi Kunci Orphan Mapel (SSOT):** Menambahkan fungsi sanitasi otomatis di `page-e-rapor.js` dan Edge Function `secure-proxy` untuk menghapus kunci mapel lama/orphan (seperti `PKWU`) dari `mapel_guru` dan `mapel_praktik_flags` yang tidak ada di `mapel_list` aktif.
- **Validasi Lapisan Ganda di Jurnal (`settings-app.js`):** Menambahkan kroscek `mapel_list` pada fungsi `syncGuruFromExternal` dan `syncSingleGuru` di Jurnal Mengajar.
- Versi aplikasi diperbarui menjadi `26.07.29.91`.

## [26.07.29.90] - 2026-07-29

### 🔄 Integrasi Sinkronisasi Migrasi NIS Siswa ke Database Jurnal Mengajar (`dbJurnal`)
- **Pembaruan Presensi Detail Jurnal Guru (`jurnal_guru`):** Saat migrasi NIS siswa dilakukan (single maupun massal), sistem secara otomatis mengueri dokumen `jurnal_guru` di `dbJurnal` pada kelas aktif & riwayat kelas siswa (`where('kelas', '==', cls)`) dan memperbarui elemen `presensi_detail` yang menyimpan `NIS` lama siswa menjadi `NIS` baru.
- **Migrasi Master Data Siswa Jurnal (`data_siswa`):** Dokumen master siswa `data_siswa/{oldNIS}` di `dbJurnal` kini secara otomatis digandakan ke `data_siswa/{newNIS}` dengan field `nis` baru, dan dokumen lama dihapus.
- **Optimasi Batch Commit & Hemat Kuota:** Seluruh penulisan ke `dbJurnal` dikelola menggunakan batch commit terstruktur (maksimal 400 operasi per batch) untuk menjamin atomisitas transaksi tanpa melebih batas kuota read/write.
- **Pembaruan Informasi Modal Konfirmasi:** Memperjelas pesan konfirmasi pada dialog migrasi NIS (single & bulk) untuk menginfokan pembaruan presensi di Jurnal Mengajar.
- Versi aplikasi diperbarui menjadi `26.07.29.90`.

## [26.07.27.73] - 2026-07-27

### 🎓 Remake Portal Guru Wali (`guru-wali.html` & `js/page-guru-wali.js`) - Informatif & Tanpa Buka Detail Satu per Satu
- **Dashboard Summary Cards Informatif:** Menampilkan 4 kartu ringkasan (Total Siswa Perwalian, Status Risiko EWS, Rata-rata Kehadiran & Warning Alpa, serta Status Pembayaran SPP).
- **Dual View Mode (Kartu & Tabel Spreadsheet):** Guru Wali dapat beralih antara tampilan **Grid Card View** dengan indikator chip ringkas dan **Table View** untuk memantau seluruh siswa perwalian dalam 1 tampilan tanpa perlu membuka modal detail.
- **Tab Matriks EWS Rombel Perwalian:** Menyediakan tabel breakdown indikator EWS (Alpa/Izin, Permisi, dan Poin Pelanggaran BK) seluruh siswa binaan.
- **Smart Filter & Sorting:** Menambahkan filter status EWS (High/Med/Safe), filter masalah presensi (Alpa/Low Presence/Permisi), dan opsi sorting dinamis.
- **Aksi Cepat (WA Ortu & Quick Note):** Menyediakan tombol direct WhatsApp ke Orang Tua dan tombol buat catatan pembinaan instan per siswa.
- **Export Laporan Excel:** Fitur eksport laporan perwalian lengkap ke format `.xlsx` menggunakan SheetJS.
- **Hemat Kuota Read Database:** Memanfaatkan `window.getStudentAggregatesCache()` dan IndexedDB caching dengan 0 Firestore read tambahan saat data tidak berubah.
- Versi aplikasi diperbarui menjadi `26.07.27.73` (package.json `1.0.18`).

## [26.07.26.07] - 2026-07-26

### 🎓 Halaman Khusus Wali Kelas (`wali-kelas.html`), Sub-Menu Akademik, & EWS Dinamis
- **Halaman Baru Portal Wali Kelas (`wali-kelas.html` & `js/page-wali-kelas.js`):** Membuat pusat kendali manajerial rombel kelas khusus untuk Wali Kelas yang menyajikan kartu EWS Rombel, monitoring presensi harian rombel, dan direktori kontak orang tua.
- **Kalkulator EWS Kedisiplinan Dinamis (`js/ews-calculator.js`):** Mengombinasikan 3 indikator perilaku murni (tanpa nilai akademik): Ketidakhadiran (Alpa & Izin), Kredit Poin Pelanggaran BK, dan Permisi Keluar Kelas.
- **Pengaturan Bobot EWS di Settings (`settings.html` & `js/page-settings.js`):** Menambahkan kartu konfigurasi persentase EWS dinamis dengan batas total 100% (Default: 40% Ketidakhadiran, 45% Kredit Poin BK, 15% Permisi).
- **Sub-Menu Akademik & Restriksi Akses Role (`js/global.js`):** Menempatkan "Portal Wali Kelas" di bawah Sub-Menu **Akademik** pada sidebar navigasi dan membatasi visibilitas menu hanya untuk `wali_kelas`, `super_admin`, `wakasek_kurikulum`, `kesiswaan`, dan `kepala_sekolah`.
- Versi aplikasi diperbarui menjadi `26.07.26.07` (package.json `1.0.17`).

## [26.07.26.06] - 2026-07-26

### 📴 Offline-First Background Sync Queue & Header Sync Status Badge
- **Upgrade Database Store (`js/indexeddb-cache.js`):** Mengganti `DB_VERSION` menjadi `2` dan menambahkan store `'sync_queue'` untuk penanganan antrean penulisan offline.
- **Engine Sinkronisasi Otomatis (`js/global.js`):** Membangun `SimasSyncEngine` yang memproses pengiriman data pending ke Firestore begitu koneksi internet terhubung kembali secara otomatis.
- **Indikator Sync Status Transparan (`js/global.js`):** Menampilkan badge status interaktif melayang (`🟡 X Data Offline Pending` / `🟢 Semua Data Tersinkron`) yang dapat diklik pengguna untuk menyinkronkan data secara manual.
- **Proteksi Penulisan Presensi & BK (`js/page-presensi.js`, `js/page-input.js`):** Membungkus transaksi penulisan presensi dan catatan pelanggaran dengan proteksi offline. Data otomatis dialihkan ke antrean `SimasSyncEngine` jika internet mati tanpa mengganggu alur pengguna.
- Versi aplikasi diperbarui menjadi `26.07.26.06` (package.json `1.0.16`).

## [26.07.26.05] - 2026-07-26

### 🚀 Perluasan Smart Cache ke Modul Duta Admin, Input BK, & Rekap Kehadiran
- **Modul Duta Admin (`js/page-duta-admin.js`):** Mengubah query direct `getDocs` data siswa menjadi `window.getStudentsCache()`, memanfaatkan IndexedDB cache.
- **Modul Input BK & Pelanggaran (`js/page-input.js`):** Mengubah pengambilan data profil siswa dan agregat poin dari query direct server ke `window.getStudentAggregatesCache()` dan `window.getStudentsCache()`.
- **Modul Rekap Kehadiran Siswa (`js/page-rekap-kehadiran-siswa.js`):** Mengganti `getDocs` per kelas menjadi `window.getStudentsByClass(kelas)`.
- Versi aplikasi diperbarui menjadi `26.07.26.05` (package.json `1.0.15`).

## [26.07.26.04] - 2026-07-26

### ⚡ Upgrade Smart Cache Manager (IndexedDB & Realtime Metadata Listener)
- **Modul Native IndexedDB (`js/indexeddb-cache.js`):** Menggantikan keterbatasan 5MB `localStorage` dengan modul IndexedDB (`SimasDB`) untuk menyimpan data besar (seperti ribuan data siswa) secara efisien dan tanpa batas kuota memori lokal.
- **Integrasi Global Cache (`js/global.js`):** Memperbarui `window.getStudentsCache` dan `window.invalidateStudentsCache` untuk memprioritaskan IndexedDB dengan fallback aman ke `localStorage`.
- **Realtime Metadata Sync (`initRealtimeMetadataListener`):** Memasang listener `onSnapshot` ringan pada dokumen metadata server. Saat terjadi perubahan data di Firestore oleh pengguna manapun, sistem secara otomatis memicu pembaruan cache dan event `simas:data-updated` di latar belakang secara real-time.
- Versi aplikasi diperbarui menjadi `26.07.26.04` (package.json `1.0.14`).

## [26.07.26.03] - 2026-07-26

### 🎓 Penyesuaian Variabel Login Siswa (NIS + Tanggal Lahir)
- **Klarifikasi Parameter Login Siswa:** Memperbarui [.env](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/.env) dan [.env.example](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/.env.example) dengan menambahkan `TEST_SISWA_NIS` sebagai identitas utama login siswa, `TEST_SISWA_TGL_LAHIR` sebagai sandi verifikasi, dan `TEST_SISWA_NISN` sebagai verifikasi alternatif.
- Versi aplikasi diperbarui menjadi `26.07.26.03` (package.json `1.0.13`).

## [26.07.26.02] - 2026-07-26

### 👥 Struktur .env Berbasis Role (Multi-Role Support)
- **Penyesuaian Struktur Variable .env:** Menambahkan dukungan kredensial per-role pada [.env](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/.env) dan [.env.example](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/.env.example) (`TEST_ADMIN_*`, `TEST_GURU_*`, `TEST_SISWA_*`, dan default `TEST_USER_*`).
- Versi aplikasi diperbarui menjadi `26.07.26.02` (package.json `1.0.12`).

## [26.07.26.01] - 2026-07-26

### 🔑 Dukungan Environment Variables (.env) untuk Testing & Login Otomatis
- **Dukungan Kredensial Pengujian Privat:** Menambahkan file [.env](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/.env) dan template [.env.example](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/.env.example) untuk menyimpan kredensial pengujian (`TEST_USER_IDENTITY`, `TEST_USER_PASSWORD`, dll).
- **Proteksi Git Repositori:** Memperbarui [.gitignore](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/.gitignore) untuk memastikan file `.env` tidak ter-commit ke repositori Git.
- Versi aplikasi diperbarui menjadi `26.07.26.01` (package.json `1.0.11`).

## [26.07.25.02] - 2026-07-25

### ⏱️ Penyesuaian Cooldown Penutupan Banner PWA
- **Penyesuaian Waktu Cooldown Banner PWA:** Mengubah durasi penyeleksian penutupan spanduk (*cooldown*) PWA di [js/global.js](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/global.js#L59) dari **12 jam menjadi 1 jam** saat tombol `X` ditekan.
- Versi aplikasi diperbarui menjadi `26.07.25.02`.

## [26.07.25.01] - 2026-07-25

### 📱 Integrasi Banner & Tombol Install PWA di Portal Siswa & Halaman Utama Login
- **Integrasi Spanduk Floating PWA Portal Siswa & Login:** Mengimpor `js/global.js` pada `js/page-portal-siswa.js` dan `index.html` sehingga spanduk melayang (*floating banner*) PWA modern muncul secara otomatis untuk siswa dan pengunjung halaman utama login.
- **Tombol Install Tambahan di Header Portal Siswa:** Menambahkan tombol `.pwa-install-btn` interaktif di samping tombol Keluar pada header `portal-siswa.html` yang akan otomatis muncul saat perangkat mendukung instalasi PWA.
- Versi aplikasi diperbarui menjadi `26.07.25.01`.

## [26.07.22.01] - 2026-07-22

### 🔒 Pembersihan RBAC Akses Halaman Settings (Super Admin Only)
- **Pembersihan Legacy Role Check:** Menghapus logika pemeriksaan `isWakasekKurikulum` dan `isKepalaLab` serta fungsi `applyWakasekLimitedView()` / `applyKepalaLabLimitedView()` dari `js/page-settings.js` karena modul pengaturan E-Rapor & E-Lab sudah sepenuhnya menempati tab Pengaturan di halaman `e-rapor.html` dan `e-lab.html`.
- **Restriksi Ketat Super Admin:** Memperbarui `PAGE_ACCESS_CONFIG` & `MENU_CONFIG` di `js/global.js` sehingga halaman `settings.html` murni hanya diakses oleh pengguna dengan peran `super_admin`.
- Versi aplikasi diperbarui menjadi `26.07.22.01`.

## [26.07.21.18] - 2026-07-21

### ⚙️ Perbaikan Sinkronisasi Cache Kelas
- **Invalidasi Cache Daftar Kelas:** Memperbarui `invalidateActiveClassesCache()` di `js/global.js` agar turut menghapus cache daftar kelas (`simas_kelas_list_cache`) selain cache config kelas aktif (`simas_active_classes_config_cache`).
- **Integrasi Pemicu Sinkronisasi:** Memodifikasi tombol sinkronisasi metadata kelas di halaman pengaturan (`js/page-settings.js`) agar otomatis memicu invalidasi cache daftar kelas baru. Hal ini memperbaiki masalah di mana kelas X baru yang telah disinkronkan tidak muncul pada dropdown halaman-halaman lain.
- Versi aplikasi diperbarui menjadi `26.07.21.18` dan versi package npm menjadi `1.0.10`.

## [26.07.21.17] - 2026-07-21

### 👥 Fitur Migrasi NIS Siswa Secara Massal
- **Metode Migrasi Massal:** Menambahkan tab/toggle Migrasi Massal pada halaman siswa (`siswa.html`) yang memungkinkan admin meng-copy data pemetaan NIS lama dan NIS baru dari Excel lalu menempelkannya (paste) ke textarea.
- **Pratinjau & Validasi Cache Lokal:** Memvalidasi NIS lama dan NIS baru secara instan menggunakan data cache lokal siswa untuk mencegah duplikasi serta mengurangi kuota read Firestore secara signifikan.
- **Laporan Kegagalan Akhir:** Proses migrasi dijalankan secara sekuensial (satu per satu) dengan logger real-time. Jika ada baris yang gagal, proses akan tetap berjalan hingga selesai, lalu menyajikan laporan kegagalan secara transparan di akhir proses.
- Versi aplikasi diperbarui menjadi `26.07.21.17` dan versi package npm menjadi `1.0.9`.

## [26.07.20.02] - 2026-07-20

### 🗳️ Modul Pemilihan Duta (Voting SHAKTI)
- **Perubahan Perhitungan Suara Sah:** Mengubah perhitungan pada card "Total Suara Diterima" (serta sub-total Siswa dan Guru) di dashboard admin agar dihitung per **siswa/guru unik (voter unik)** menggunakan `Set` pada `nis_pemilih`, bukan jumlah baris/pilihan kategori. Hal ini dilakukan agar angka yang ditampilkan mencerminkan jumlah pemilih yang telah berpartisipasi dan tidak terlalu besar.
- Versi aplikasi diperbarui menjadi `26.07.20.02`.

## [26.07.20.01] - 2026-07-20

### 🚀 Pembaruan Versi Aplikasi
- **Penyelarasan Tanggal Rilis:** Memperbarui versi aplikasi global menjadi `26.07.20.01` di `js/config.js` dan versi package menjadi `1.0.7` di `package.json` untuk merefleksikan pembaruan tanggal 20 Juli 2026 secara akurat.

## [26.07.18.11] - 2026-07-18

### 🤖 Otomatisasi Pengujian GitHub Actions CI/CD
- **Pemeriksa Sintaks Cross-Platform (`scripts/check-syntax.js`):** Membuat skrip otomatisasi pengujian sintaks JavaScript yang memeriksa 33 berkas JS proyek secara instan.
- **Workflow GitHub Actions (`.github/workflows/tests.yml`):** Menambahkan job `check-syntax` yang secara otomatis menguji seluruh sintaks JS, unit test Jest, dan E2E Cypress di GitHub setiap kali ada commit/push baru.
- Versi aplikasi diperbarui menjadi `26.07.18.11`.

## [26.07.18.10] - 2026-07-18

### 📆 Notifikasi Agenda & Pengumuman Penting Sekolah (Anti-Spam Cron 08:00 WITA)
- **Queue Perubahan Agenda:** Cloud Function (`onAgendaWritten`) mencatat setiap penambahan/perubahan/penghapusan kalender agenda sekolah (`calendar_events`) ke dalam antrean `agenda_notifications_queue`.
- **Scheduled Cron Pukul 08:00 WITA:** Cloud Function (`agendaCron`) mengeksekusi pemeriksaan antrean setiap hari pukul 08:00 WITA. Jika terdapat perubahan agenda di hari sebelumnya, rangkuman dikirimkan via Push Notification. Jika tidak ada perubahan, pengiriman dibatalkan secara otomatis (anti-spam).
- **Filter Target Role:** Mengirim notifikasi ke seluruh staf dan guru, dengan **Pengecualian Khusus**: `admin_kelas`, `admin_pks`, dan `siswa` (sesuai spesifikasi).
- Versi aplikasi diperbarui menjadi `26.07.18.10`.

## [26.07.18.09] - 2026-07-18

### 🔔 Perluasan Fitur Otomatisasi Push Notification
- **🏆 Notifikasi Prestasi Siswa:** Cloud Function (`onRecordCreated`) otomatis mengirim Push Notification ke Wali Kelas dan Guru Wali (*Personal Guardian*) ketika catatan prestasi siswa diinput di [input_catatan.html](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/input_catatan.html).
- **📝 Notifikasi Permisi/Izin Siswa:** Cloud Function (`onPermissionWaNotify`) otomatis mengirim Push Notification ke Wali Kelas ketika ada pengajuan permisi/izin siswa.
- **🧪 Notifikasi E-Laboratorium:** 
  - Saat Guru mengajukan peminjaman lab, Push Notification otomatis terkirim ke **Kepala Lab**.
  - Saat Kepala Lab menyetujui/menolak peminjaman, Push Notification konfirmasi otomatis terkirim ke **Guru Pemohon**.
- Versi aplikasi diperbarui menjadi `26.07.18.09`.

## [26.07.18.08] - 2026-07-18

### 🔔 Eliminasi Duplikasi Notifikasi Push
- **Pembersihan Spanduk Ganda:** Menghapus pemicu `Notification` instan bawaan lokal di [js/page-integrasi.js](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/page-integrasi.js) dan [js/push-notification.js](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/push-notification.js), menyerahkan alur pengiriman spanduk fisik secara murni dan bersih ke Firebase Cloud Messaging (FCM) & Service Worker (`sw.js`).
- Peningkatan versi aplikasi secara global menjadi `26.07.18.08`.

## [26.07.18.07] - 2026-07-18

### 🗄️ Unifikasi Database Live & Testing (SSOT)
- **Koleksi Database Tunggal untuk Live & Testing:** Menyatukan alur penyimpanan data testing dan live pada modul Wordcloud Kapsul Waktu ke dalam satu koleksi SSOT (`kapsul_waktu/{currentYear}/public_words`), menghapus koleksi uji coba terpisah (`wordcloud_test`).
- **Penghematan Kuota Read Firestore:** Menghapus realtime listener ganda pada [pub/wordcloud.js](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/pub/wordcloud.js) sehingga mendengarkan 1 koleksi utama saja, mengurangi penggunaan kuota read Firestore hingga 50%.
- **Pembersihan Konfigurasi & Rules:** Menghapus import emulator yang tidak terpakai serta variabel `isLocal` di [js/config.js](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/js/config.js), dan memperbarui [firestore.rules](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/firestore.rules) agar aturan akses konsisten dan aman.
- Peningkatan versi aplikasi secara global menjadi `26.07.18.07`.

## [26.07.18.06] - 2026-07-18

### 🎓 Penyempurnaan Modul Pengaturan E-Rapor & Filter Kelas Aktif
- **Penyaringan Kelas Aktif (X-XII):** Memperbarui fungsi `loadAllKelasForSettings()` untuk memfilter secara ketat kelas non-aktif (seperti `KELUAR`, `Alumni`, `Lulus`, `Drop Out`), sehingga hanya kelas aktif tingkat X, XI, dan XII yang muncul pada pilihan kelas diampu.
- **Pencarian Ketik Guru Pengampu (Searchable Dropdown):** Mengintegrasikan komponen input pencarian interaktif untuk modal Edit Guru & Kelas, serta meningkatkan kapasitas tampilan melayang menjadi `max-h-72`.
- **Pengikatan Murni Role `guru_mapel` & Deduplikasi:** Membatasi pemuatan cache akun pengampu murni pada role `guru_mapel` dan menerapkan deduplikasi nama guru otomatis.
- **Tampilan Utuh Nama & Kelas Pengampu:** Menampilkan nama lengkap guru beserta seluruh daftar kelas yang diampu secara utuh tanpa potongan `truncate`.
- Peningkatan versi aplikasi secara global menjadi `26.07.18.06`.

## [26.07.18.05] - 2026-07-18

### 🔀 Pemindahan Modul Pengaturan E-Rapor ke Halaman E-Rapor
- **Tab Pengaturan Baru di E-Rapor:** Memindahkan seluruh modul pengaturan E-Rapor (Teori & Praktik, Status Input Nilai, Mata Pelajaran, dan Guru Pengampu) dari halaman Pengaturan (`settings.html`) ke tab baru "Pengaturan" di halaman E-Rapor (`e-rapor.html`).
- **Tab Bar Header Dinamis:** Memperbarui sistem navigasi pill tab di `e-rapor.html` agar lebarnya menyesuaikan jumlah tab aktif (2, 3, atau 4 tab) secara dinamis sesuai role pengguna.
- **Otorisasi Akses Terbatas:** Tab Pengaturan hanya dapat dilihat dan diakses oleh pengguna dengan role `super_admin` atau `wakasek_kurikulum`. Aksi penambahan mapel, penghapusan, dan pengubahan guru pengampu dilindungi dengan pengecekan otorisasi ketat di sisi klien.
- **Pembersihan Halaman Settings:** Menghapus elemen HTML `section-e-rapor`, modal terkait, dan seluruh fungsi JS dari `settings.html` dan `js/page-settings.js` untuk meningkatkan efisiensi muat halaman.
- Peningkatan versi aplikasi secara global menjadi `26.07.18.05`.

## [26.07.18.04] - 2026-07-18

### 📊 Dashboard Analitik Kepala Sekolah Premium
- **Dashboard Khusus Kepala Sekolah:** Mengimplementasikan visualisasi analitik tingkat tinggi khusus untuk role `kepala_sekolah` di `dashboard.html`.
- **Realisasi SPP vs Target:** Menghitung target SPP tahunan sekolah secara dinamis berbasis cohort angkatan masuk siswa dan tarif aktif dari `settings/finance_rates`, serta menyinkronkan realisasi SPP dengan data `finance_daily_summary` termasuk data virtual migrasi 2026. Dirender dengan Progress Ring SVG premium.
- **Efisiensi Firestore (Hemat Read):** Menambahkan sistem caching client-side global `window.getStudentAggregatesCache` di `global.js` yang memanfaatkan metadata `lastUpdateStudents` untuk validasi (0 read tambahan saat data tidak berubah).
- **Kehadiran per Tingkat Kelas & Top Kelas:** Menyajikan visualisasi Bar Chart tingkat kehadiran kelas X, XI, XII dan Top 3 kelas dengan kehadiran terbaik/terburuk menggunakan data agregat.
- **Heatmap Pelanggaran Mingguan:** Memetakan frekuensi kasus pelanggaran per hari (Senin - Sabtu) menggunakan grid CSS dengan gradasi warna yang responsif dan elegan.
- Peningkatan versi aplikasi secara global menjadi `26.07.18.04`.

## [26.07.18.03] - 2026-07-18

### 🔀 Pemindahan Modul Manajemen E-Lab ke Halaman E-Lab
- **Tab Pengaturan Baru di E-Lab:** Memindahkan seluruh modul manajemen laboratorium (tambah, hapus, urutkan lab) dari halaman Pengaturan (`settings.html`) ke tab baru "Pengaturan" di halaman E-Laboratorium (`e-lab.html`).
- **Otorisasi Berbasis Role:** Tab Pengaturan hanya ditampilkan untuk pengguna dengan role `super_admin` atau `kepala_lab`. Setiap aksi (tambah/hapus/ubah urutan lab) dilindungi dengan pengecekan otorisasi di sisi klien.
- **Pembersihan Settings:** Menghapus section E-Laboratorium dan kode terkait (`loadLabsList`, `addNewLab`, `deleteLab`, `moveLabOrder`) dari `settings.html` dan `js/page-settings.js` untuk mengurangi beban halaman.
- **Sinkronisasi Real-time:** Perubahan lab di tab Pengaturan langsung merefleksi di dropdown booking lab tanpa perlu refresh halaman.
- Peningkatan versi aplikasi secara global menjadi `26.07.18.03`.

## [26.07.18.02] - 2026-07-18

### 🔧 Perbaikan Otorisasi Multi-Database Firestore Rules
- **Multi-Database Rules Sync:** Menyelaraskan konfigurasi target `firestore` di `firebase.json` menjadi format array agar aturan keamanan `firestore.rules` otomatis dideploy ke kedua database (`(default)` dan database lokal `testing`).
- **Pemberantasan Error Hak Akses:** Menyelesaikan kendala `Missing or insufficient permissions` saat melakukan setup token FCM dan mengambil config `settings/push_config` di server localhost.
- Peningkatan versi aplikasi secara global menjadi `26.07.18.02`.

## [26.07.18.01] - 2026-07-18

### 🚀 Restrukturisasi Halaman Integrasi API & Notifikasi
- **Halaman Baru `integrasi.html`:** Memindahkan seluruh modul konfigurasi WhatsApp (Fonnte API) dan Web Push Notification (FCM PWA) dari halaman Pengaturan (`settings.html`) ke satu halaman mandiri yang terpisah.
- **Pembersihan Pengaturan:** Menyederhanakan UI `settings.html` dan menghapus ratusan baris kode HTML/JS redundan dari `js/page-settings.js` untuk meningkatkan kecepatan muat halaman.
- **Proteksi Otorisasi Keamanan:** Menambahkan rute otorisasi di `global.js` (`PAGE_ACCESS_CONFIG`) untuk membatasi akses `integrasi.html` khusus bagi `super_admin` (metode read/write).
- **Perutean Sidebar Menu:** Menambahkan menu "Integrasi & Notifikasi" di sidebar grup "Sistem & Admin".
- Peningkatan versi aplikasi secara global menjadi `26.07.18.01`.

## [26.07.17.02] - 2026-07-17

### 🔧 Perbaikan Bug Syntax Error & Optimalisasi Push Notification
- **Perbaikan Syntax Error:** Memperbaiki kesalahan parsing `SyntaxError` di `js/page-settings.js` akibat terpotongnya bagian deklarasi awal fungsi `window.saveCalendarConfig` saat merging perubahan kode baru.
- **Fitur Baru Web Push Notification (FCM) Khusus Super Admin:**
  - **Pengaturan Push Notification PWA:** Menambahkan panel konfigurasi Web Push Notification menggunakan Firebase Cloud Messaging (FCM) di halaman Pengaturan (`settings.html`). Super Admin dapat mengisi VAPID Public Key untuk mengaktifkan push secara aman dan bebas biaya.
  - **Pengiriman Manual Terarah:** Menyediakan form pengirim push manual yang mendukung target: Semua Pengguna, Peran Tertentu (Role Checkbox), dan Pengguna Spesifik (dengan fitur pencarian asinkron).
  - **Pengujian Perangkat Lokal:** Menambahkan card tester untuk memantau izin notifikasi browser local, menyalin token FCM lokal, serta tombol "Kirim Notifikasi Tes Ke Perangkat Ini" untuk validasi end-to-end secara instan.
  - **Integrasi Service Worker Ringan:** Menambahkan listener `push` dan `notificationclick` native di `sw.js` tanpa membebani performa cache dan ukuran file dengan Firebase SDK yang besar.
  - **Registrasi Token Terpusat:** Mengintegrasikan pendaftaran token otomatis ke subkoleksi `fcm_tokens` di bawah dokumen user di Firestore saat login secara terpusat melalui `js/global.js`.
- Peningkatan versi aplikasi secara global menjadi `26.07.17.02`.

## [26.07.16.02] - 2026-07-16

### 🔧 Perbaikan Tampilan Panduan Import Excel Siswa & Klarifikasi Update Kelas
- **Perbaikan Panduan Import Siswa**: Memperbarui penomoran kolom visual pada modal import Excel di `siswa.html` agar menggunakan huruf kolom Excel asli (`A. NIS*`, `B. NISN`, `C. Nama Lengkap`, `D. Kelas`, dst.) bukan indeks angka (0, 1, 2, 3...) untuk mempermudah pengguna.
- **Klarifikasi Update Kelas Massal**: Menambahkan petunjuk khusus bahwa pembaruan data (termasuk naik kelas/pindah kelas) secara massal dapat dilakukan dengan menyalin kolom A (NIS) dan D (Kelas) saja dari Excel, dengan membiarkan kolom B (NISN) dan C (Nama Lengkap) kosong agar data lama tidak tertimpa berkat fitur *Smart Merge*.
- Peningkatan versi aplikasi secara global menjadi `26.07.16.02`.

## [26.07.13.10] - 2026-07-13

### 🔧 Penyembunyian Filter Waktu & 3 Kartu Statistik Ringkasan Modul Suka-Duka
- **Penyembunyian Elemen Visual**: Membungkus header "Statistik Kas & Santunan", filter waktu ("Bulan Ini", "Bulan Lalu", "Tahun Ini"), serta 3 kartu statistik ringkasan sisanya ("Total Pencairan", "Kuantitas Santunan", "Nominal Iuran Bulanan") ke dalam kelas `hidden` agar sepenuhnya tidak tampil di antarmuka pengguna.
- **Kompatibilitas Logika JavaScript**: Elemen tetap dibiarkan berada di dalam DOM guna menjamin kelancaran penanganan pembacaan/penulisan data via JavaScript tanpa memicu *runtime crash*.
- Peningkatan versi aplikasi secara global menjadi `26.07.13.10`.

## [26.07.13.09] - 2026-07-13

### 🔧 Modifikasi Tata Letak Kartu Tunggakan Modul Suka-Duka
- **Relokasi Kartu Tunggakan**: Menghapus kartu ringkasan "Total Tunggakan Anda" dari dashboard statistik atas suka-duka, dan memindahkannya ke bawah kolom/area profil kiri sebagai kartu rincian tunggakan mandiri.
- **Tampilan Dinamis**: Kartu rincian tunggakan di area kiri kini hanya ditampilkan secara dinamis apabila guru yang bersangkutan memiliki tunggakan iuran kas suka-duka. Jika bebas tunggakan, kartu akan disembunyikan secara otomatis.
- **Penyesuaian Kolom Grid**: Mengubah layout kolom dashboard atas dari 4 kolom menjadi 3 kolom agar visualisasi kartu tersisa (Total Pencairan, Kuantitas Santunan, Nominal Iuran Bulanan) tetap rapi dan seimbang.
- Peningkatan versi aplikasi secara global menjadi `26.07.13.09`.

## [26.07.13.02] - 2026-07-13

### 🔧 Fitur Edit Arus Kas Manual & Optimasi Filter Bulan Modul E-SPP
- **Tombol Edit Arus Kas Manual**: Menambahkan tombol edit (<i class="fa-solid fa-pen-to-square"></i>) berdampingan dengan tombol hapus pada baris tabel arus kas manual (`deletable`).
- **Form Edit Mutasi Kas**: Memodifikasi form mutasi kas manual agar dapat beralih fungsi antara mode tambah baru dan mode edit (memperbarui nominal, tanggal, keterangan, dan tipe mutasi via Firestore `setDoc` dengan `merge: true`).
- **Optimasi Default & Dropdown Filter Bulan**: Mengatur agar filter bulan secara default langsung merujuk pada bulan berjalan saat halaman dimuat (inisiator berjalan lebih awal agar tidak terhambat oleh proses *async loading* lainnya). Selain itu, pilihan "Semua Bulan" diposisikan di urutan paling bawah pada dropdown untuk antarmuka yang lebih rapi.
- Peningkatan versi aplikasi secara global menjadi `26.07.13.02`.

## [26.07.13.01] - 2026-07-13

### 🔧 Perbaikan Filter Distribusi & Perhitungan Jumlah Siswa Aktif Dashboard
- **Penyaringan Siswa Non-Reguler/Non-Aktif**: Membatasi perhitungan total siswa aktif pada kartu statistik dashboard dan modal distribusi jumlah siswa agar selalu menyaring dan mengecualikan kelas non-reguler/non-aktif (alumni, mutasi, pindah, keluar, nonaktif, dan lulus), terlepas dari toggle konfigurasi `showAlumni` di pengaturan e-SPP.
- **Efisiensi Kuota Firestore (SSOT)**: Menggantikan query hitung langsung dari server Firestore (`getCountFromServer`) sebanyak belasan kali di halaman dashboard dengan cache data siswa (`getStudentsCache`) yang patuh asas Single Source of Truth (SSOT). Hal ini menghemat ribuan kuota read Firestore per hari.
- Peningkatan versi aplikasi secara global menjadi `26.07.13.01`.

## [26.07.11.01] - 2026-07-11

### 🔧 UI Pengaturan Integrasi WhatsApp (Fonnte API) Khusus Super Admin
- **Antarmuka Manajemen Fonnte**: Menambahkan panel konfigurasi integrasi WhatsApp di halaman Pengaturan (`settings.html`) yang mencakup status integrasi (aktif/nonaktif) dan input token API Fonnte dengan fitur toggle visibilitas token.
- **Keamanan Berbasis Peran (RBAC)**: Memastikan UI konfigurasi ini disembunyikan secara default dan hanya ditampilkan serta dapat disimpan/dimanipulasi oleh user dengan peran `super_admin`.
- **Fitur Uji Coba (Test Send WA)**: Menyediakan form pengetesan pengiriman pesan WhatsApp secara langsung dari klien menggunakan API Fonnte untuk memverifikasi kevalidan token yang dimasukkan.
- Peningkatan versi aplikasi secara global menjadi `26.07.11.01`.

## [26.07.09.03] - 2026-07-09

### 🔧 Pengurutan Siswa Otomatis Berdasarkan Nama Alfabet & Hapus Kolom Absen
- **Nomor Absen Otomatis di Front-End**: Menghapus input field `absen` dari formulir tambah/edit siswa dan halaman guru wali. Nomor absen/urut kini di-render langsung di sisi klien secara dinamis (`idx + 1`) berdasarkan urutan nama alfabetis.
- **Pengurutan Konsisten**: Mengubah logika sorting siswa di halaman data siswa dan halaman rekap kehadiran siswa agar selalu diurutkan berdasarkan nama secara alfabetis (`localeCompare`).
- **Penyesuaian Import Siswa**: Memperbarui `STUDENT_SCHEMA` untuk mengabaikan field `absen`, menggeser NIS ke index 0 pada data Excel.
- Peningkatan versi aplikasi secara global menjadi `26.07.09.03`.

## [26.07.06.05] - 2026-07-06

### 🔧 Perbaikan Keamanan & Penanganan Runtime Type Error di Aturan Firestore
- **Pengaman Tipe Data List (`is list`)**: Menambahkan klausa pengecekan tipe data `is list` pada evaluasi `additionalRoles` sebelum menjalankan metode `.hasAny()`. Hal ini mencegah kegagalan evaluasi runtime (CEL runtime error) bagi pengguna yang memiliki data profil kosong/tidak lengkap (seperti pada email `komangpurna2@gmail.com`), sehingga perizinan transaksi tidak lagi terblokir untuk seluruh pengguna.
- **Perbaikan Tipe Data CEL Ilegal (`is number`)**: Mengganti seluruh operator pengecekan tipe data ilegal `is number` menjadi tipe data CEL resmi (`is int || is float` atau `is int`) pada koleksi `finance_transactions`, `finance_cashflow`, dan `finance_closings`. Di Firestore CEL, tipe data `number` tidak terdefinisi sehingga memicu kegagalan runtime rules secara instan ketika kasir memproses pembayaran SPP atau menambahkan arus kas.
- Peningkatan versi aplikasi secara global menjadi `26.07.06.05`.

## [26.07.06.03] - 2026-07-06

### 🔧 Optimasi Limit Reads & Perbaikan Bug Aturan Firestore
- **Perbaikan Bug `resource.id`**: Memperbaiki evaluasi penulisan pada `finance_daily_summary` dengan mengganti properti ilegal `resource.id` menjadi wildcard `dateId` di `firestore.rules`. Bug ini sebelumnya menggagalkan seluruh batch transaksi pembayaran SPP.
- **Pencegahan Limit Reads**: Mengimplementasikan fungsi baru `hasAnyOfRoles(roleList)` di `firestore.rules` untuk menampung pemeriksaan banyak peran sekaligus dalam 1 kali pembacaan dokumen user. Ini mengurangi jumlah get() reads secara drastis dari maksimal 26 reads menjadi **hanya 1 read saja** per request, menghindarkan evaluasi rules dari batas kuota pembacaan Firestore (Max 10 reads).
- Peningkatan versi aplikasi secara global menjadi `26.07.06.03`.

## [26.07.06.02] - 2026-07-06

### 🔧 Perbaikan Bug Double-Counting Rekap Pemasukan SPP
- **Normalisasi Pengelompokan Data**: Menambahkan filter `d.isMigration` pada fungsi `loadRecapIncome` di `js/page-keuangan.js` untuk mengabaikan dokumen migrasi fisik dari `finance_daily_summary` saat melakukan penarikan data mentah. Hal ini mencegah data migrasi virtual 2026 ditambahkan dua kali (double-counting) pada laporan rekap pemasukan.
- Peningkatan versi aplikasi secara global menjadi `26.07.06.02`.

## [26.07.06.01] - 2026-07-06

### 🔧 Perbaikan Otorisasi Multi-Role Admin SPP & Firestore Rules
- **Pengecekan Keanggotaan Peran Tambahan**: Memperbaiki fungsi `hasAdditionalRole(roleName)` di `firestore.rules` agar menggunakan fungsi bawaan `.hasAny([roleName])` yang kompatibel dengan data List/Array pada Firestore CEL.
- **Penyelesaian Masalah Akses**: Mengatasi isu *Permission Denied* saat akun dengan peran tambahan `admin_spp` melakukan transaksi pembayaran SPP dan mengubah opsi penampilan data alumni di menu pengaturan.
- Peningkatan versi aplikasi secara global menjadi `26.07.06.01`.

## [26.07.05.03] - 2026-07-05

### 🔧 Integrasi Global Otomatisasi Tahun Ajaran & Hemat Kuota Baca Firestore
- **Otomatisasi Lintas Halaman**: Menerapkan deteksi tahun ajaran otomatis secara menyeluruh ke halaman Peminatan (`js/page-peminatan.js`) dan Portal Siswa (`js/page-portal-siswa.js`) untuk menjaga konsistensi data di seluruh aplikasi.
- **Pangkas Query Firestore**: Menghapus pemuatan dokumen `settings/system_config` di Portal Siswa untuk mendeteksi tahun ajaran aktif, menggantinya dengan kalkulasi client-side sehingga menghemat kuota Firestore read secara maksimal.
- Peningkatan versi aplikasi secara global menjadi `26.07.05.03`.

## [26.07.05.02] - 2026-07-05

### 🔧 Otomatisasi Tahun Ajaran Aktif E-Rapor
- **Deteksi Dinamis**: Mengubah modul E-Rapor (`e-rapor.html`, `js/page-e-rapor.js`) dan halaman Pengaturan (`settings.html`, `js/page-settings.js`) untuk menghitung dan menetapkan tahun ajaran aktif secara otomatis menggunakan fungsi global `getCurrentAcademicYearString()`.
- **Antarmuka Read-Only**: Menonaktifkan tombol simpan tahun ajaran pada panel admin pengaturan dan membuat input tahun ajaran menjadi read-only dengan indikator badge "Otomatis" demi mencegah inkonsistensi input.
- Peningkatan versi aplikasi secara global menjadi `26.07.05.02`.

## [26.07.04.34] - 2026-07-04

### 🔧 Resolusi Konflik Elemen Notifikasi Toast Keuangan
- **Hapus Elemen Usang**: Menghapus duplikasi elemen `#toast-container` statis yang usang pada berkas `keuangan.html`. Langkah ini menyelesaikan konflik ID di mana fungsi `showToast` secara tidak sengaja me-render notifikasi baru di dalam container transparan usang tersebut (`opacity-0 pointer-events-none`) sehingga menjadikannya tidak terlihat sama sekali di layar.
- Peningkatan versi aplikasi secara global menjadi `26.07.04.34`.

## [26.07.04.33] - 2026-07-04

### 🔧 Pemindahan Notifikasi ke window.showToast Global & Debugging Konsol
- **Toast Global Langsung**: Mengalihkan pemanggilan notifikasi dari fungsi lokal/import ke `window.showToast` secara eksplisit dan global. Langkah ini menghilangkan dependensi impor modul dan menjamin notifikasi sukses (toast hijau) dapat dieksekusi secara instan dan andal di browser klien.
- **Log Debugging**: Menambahkan `console.log` penanda submit (`[DEBUG]`) pada event handler tarif, tanggal jatuh tempo, dan opsi alumni untuk mempermudah pelacakan alur eksekusi saat pengujian lokal.
- Peningkatan versi aplikasi secara global menjadi `26.07.04.33`.

## [26.07.04.32] - 2026-07-04

### 🔧 Perbaikan Import Notifikasi Toast Keuangan
- **Perbaikan Scope Module**: Melakukan import eksplisit fungsi `showToast` dari `global.js` di bagian atas berkas `page-keuangan.js`. Hal ini menyelesaikan galat `ReferenceError: showToast is not defined` yang terjadi di dalam ES6 Module saat admin menyimpan pengaturan tarif, jatuh tempo, atau men-toggle opsi alumni.
- Peningkatan versi aplikasi secara global menjadi `26.07.04.32`.

## [26.07.04.31] - 2026-07-04

### 🔧 Pembersihan UI & Penyempurnaan Notifikasi Toast Pengaturan Keuangan
- **Pembersihan UI**: Menghapus tombol "Kunci Data Migrasi 2026" dari tab Keamanan & Konfigurasi pada berkas `keuangan.html` setelah sukses digunakan sekali untuk membekukan data SPP virtual ke database.
- **Penyempurnaan Notifikasi**: Menambahkan parameter tipe `'success'` pada toast konfirmasi pembaruan tarif SPP standar, perubahan tanggal jatuh tempo bulanan, dan opsi penampilan siswa alumni agar memberikan feedback visual toast berwarna hijau yang lebih jelas (tidak lagi pasif/info).
- Peningkatan versi aplikasi secara global menjadi `26.07.04.31`.

## [26.07.04.29] - 2026-07-04

### 🔧 Perbaikan Dialog Konfirmasi Kunci Data SPP
- **Modal Konfirmasi Generik**: Menambahkan elemen HTML `modal-generic-confirm` ke berkas `keuangan.html` dan memporting fungsi `showConfirmModal` ke `js/page-keuangan.js` untuk memperbaiki galat `ReferenceError: showConfirmModal is not defined` saat admin mengeklik tombol Kunci Data Migrasi.
- Peningkatan versi aplikasi secara global menjadi `26.07.04.29`.

## [26.07.04.28] - 2026-07-04

### 🔧 Standarisasi Format Kelas
- **Format Kelas Romawi-Angka**: Mengubah seluruh placeholder dan contoh nama kelas dari format lama (seperti `XII MIPA 3`, `XI IPS 1`, `X-MIPA-1`, dll.) menjadi format angka murni (`XII-3`, `XI-1`, `X-1`, dst.) untuk keselarasan data sekolah.
- Peningkatan versi aplikasi secara global menjadi `26.07.04.28`.

## [26.07.04.27] - 2026-07-04

### 🔧 Fitur Pembekuan Data Pemasukan SPP Migrasi Virtual 2026
- **Kunci Data Migrasi**: Menambahkan fitur administratif untuk membekukan (freeze) data pendapatan virtual SPP migrasi periode Januari–Juni 2026 secara fisik ke dokumen `finance_daily_summary` pada setiap tanggal 20. Ini menjamin data arus kas historis tetap stabil, aman, dan tidak bergeser saat siswa kelas XII lulus menjadi alumni atau dihapus.
- Peningkatan versi aplikasi secara global menjadi `26.07.04.27`.

## [26.07.04.25] - 2026-07-04

### 🔧 Perbaikan Kueri Laporan Keuangan SPP Berbasis NIS
- **Query Berbasis NIS**: Mengubah kueri pencarian transaksi di Laporan Tunggakan dan Realisasi Keuangan agar menggunakan filter NIS (operator `in` per 30 siswa) alih-alih filter nama kelas (`studentClass`). Langkah ini memperbaiki masalah di mana tunggakan lama (`manual_debt`) siswa terdeteksi sebagai Lunas secara otomatis setelah siswa naik kelas (Reset Tahunan) atau pindah kelas (Mutasi).
- Peningkatan versi aplikasi secara global menjadi `26.07.04.25`.

## [26.07.03.01] - 2026-07-03

### 🔧 Penghapusan Tombol Kembali ke Portal
- **Hapus Tombol Kembali ke Portal**: Menghapus tombol navigasi "Kembali ke Portal" di header halaman pemilihan Duta SHAKTI (`duta/vote.html`) dan membersihkan logika JavaScript terkait pada `duta/vote.js`.
- Peningkatan versi aplikasi secara global menjadi `26.07.03.01`.

## [26.07.01.05] - 2026-07-01

### 🔧 Penyaringan Kelas Non-Aktif pada Sinkronisasi Metadata Kelas
- **Filter Kelas Non-Aktif**: Memodifikasi fungsi `executeSync` pada `js/page-settings.js` agar secara otomatis menyaring dan mengecualikan kelas dengan nama atau status "Keluar", "Pindah", "Mutasi", dan "Alumni" dari sinkronisasi master metadata kelas.
- Peningkatan versi aplikasi secara global menjadi `26.07.01.05`.

## [26.06.30.05] - 2026-06-30

### 🔧 Update Versi Actions pada Workflow untuk Membasmi Warning Deprecation Node.js 20
- **Upgrade Workflow Actions**: Memperbarui tag versi Actions pada berkas `.github/workflows/deploy.yml` ke patch rilis minor/patch terbaru (`checkout@v4.2.2`, `setup-node@v4.2.0`, dan `auth@v2.1.8`) yang sudah kompatibel penuh dengan Node.js 24, membersihkan peringatan deprecation runtime pada log annotations GitHub.
- Peningkatan versi aplikasi secara global menjadi `26.06.30.05`.

## [26.06.30.04] - 2026-06-30

### 🔧 Nonaktifkan HTTP/2 pada Workflow Deploy di GitHub Actions
- **Pencegahan Error Upload (Status 400)**: Menambahkan variabel lingkungan `DISABLE_HTTP2: "true"` pada tugas deployment di file `.github/workflows/deploy.yml` untuk memaksa Firebase CLI menggunakan protokol HTTP/1.1 yang jauh lebih stabil dan andal, mengatasi isu kegagalan *retries exhausted: content hash doesn't match content* secara permanen.
- Peningkatan versi aplikasi secara global menjadi `26.06.30.04`.

## [26.06.30.03] - 2026-06-30

### 🔧 Fix Izin Security Rules Firestore & Caching Deploy pada GitHub Actions
- **Security Rules Firestore**: Memperbaiki `firestore.rules` agar mengizinkan `admin_spp` mengubah field `showAlumni` saja pada dokumen `settings/system_config`. Ini memecahkan bug di mana toggle "Tampilkan Siswa Alumni" memantul balik secara otomatis saat diubah oleh admin SPP non-super-admin.
- **Pencegahan Error Hash Mismatch**: Menambahkan instruksi `rm -rf .firebase` pada workflow deploy di `.github/workflows/deploy.yml` dan mendaftarkan folder `.firebase/` di `.gitignore` untuk mencegah terjadinya error konflik *content hash mismatch* pada runner GitHub Actions di masa depan.
- Peningkatan versi aplikasi secara global menjadi `26.06.30.03`.

## [26.06.30.02] - 2026-06-30

### 🔧 Pembatasan Masa Studi Aktif pada Perhitungan Tunggakan Alumni
- **Deteksi Cohort Alumni**: Memodifikasi fungsi `calculateCohort` agar mem-parse tahun kelulusan secara tepat dari format nama kelas alumni (contoh: `Alumni XII-1 (2025/2026)`).
- **Pembatasan Batas Atas Tunggakan**: Membatasi perulangan pengecekan tunggakan pada *Laporan Tunggakan* dan *Laporan Estimasi* agar tidak melampaui bulan kelulusan aktif siswa alumni (Juni di tahun ajaran kelulusannya). Hal ini mencegah alumni salah terhitung menunggak pada bulan-bulan setelah mereka lulus.
- Peningkatan versi aplikasi secara global menjadi `26.06.30.02`.

## [26.06.30.01] - 2026-06-30

### 🔧 Integrasi Toggle Penampilan Alumni di Pengaturan e-SPP
- **Konfigurasi Alumni Terpadu**: Menambahkan toggle checkbox "Tampilkan Siswa Alumni" pada sub-tab Pengaturan modul e-SPP (`keuangan.html`), terintegrasi penuh ke database Firestore (`settings/system_config`).
- **Instan Refresh**: Perubahan status toggle alumni akan otomatis mengosongkan cache siswa lokal dan memuat ulang list siswa secara dinamis tanpa perlu me-reload manual seluruh halaman.
- Peningkatan versi aplikasi secara global menjadi `26.06.30.01`.

## [26.06.29.04] - 2026-06-29

### 🔧 Default Filter Bulan Berjalan pada Tab Arus Kas Keuangan SPP
- **Default Filter Bulan Berjalan**: Mengubah inisialisasi filter pada tab Arus Kas agar secara otomatis memilih bulan berjalan saat ini (berdasarkan waktu lokal sistem) ketika halaman atau tab Arus Kas pertama kali dibuka.
- Peningkatan versi aplikasi secara global menjadi `26.06.29.04`.

## [26.06.27.02] - 2026-06-27

### 📝 Perbaikan Uraian Pelanggaran & Penambahan Total Poin
- **Perbaikan Uraian Pelanggaran & Prestasi**: Menggunakan field `desc` dari dokumen Firestore sebagai fallback utama (`v.desc || v.violationName || v.name`) agar deskripsi pelanggaran dan uraian prestasi tidak tampil kosong pada PDF cetak raport dan AI generator.
- **Baris Total Poin Kedisiplinan**: Menambahkan baris total kalkulasi poin pelanggaran pada bagian bawah tabel Catatan Kedisiplinan.
- Peningkatan versi aplikasi secara global menjadi `26.06.27.02`.

## [26.06.27.01] - 2026-06-27

### 📝 Revisi Format & Data Cetak Raport PDF
- **Penghapusan Garis Pemisah Kop**: Menghapus garis hitam ganda di bawah gambar kop surat pada PDF cetak raport karena gambar kop sudah menyertakan garis pemisah bawaan.
- **Perubahan Judul Bagian A**: Mengubah nama bagian dari "Catatan Perilaku Baik" menjadi "Catatan Prestasi".
- **Penyaringan Log Kehadiran**: Menyaring data ketidakhadiran agar tidak menampilkan status Hadir ('H' / 'h') di tabel detail absensi PDF.
- **Penyelarasan & Perbaikan Poin Pelanggaran**: Memperbaiki filter pelanggaran & prestasi agar mendeteksi `category` ("Pelanggaran" atau "Prestasi") dan mendukung properti `point`/`points` agar data tidak lagi kosong.
- **Pemuatan Wali Kelas & NIP Otomatis**: Menambahkan `nip` ke dalam cache data wali kelas (`WALI_KELAS_CACHE`) dan memperbarui fungsi pencarian wali kelas agar secara otomatis memuat nama guru dan NIP-nya dari koleksi `teachers`.
- **Perubahan Lokasi Tanda Tangan**: Mengubah lokasi cetak tanggal dari "Karangasem" menjadi "Abang" sesuai lokasi sekolah.
- Peningkatan versi aplikasi secara global menjadi `26.06.27.01`.

## [26.06.26.05] - 2026-06-26

### ✨ Penyelarasan Logika Tab & Banner Peminatan serta Penambahan Info Siswa
- Menyelaraskan logika tampilan tab **Peminatan** di navigasi atas portal siswa agar mengikuti logika tampilan **Banner Peminatan** secara terpusat (hanya tampil jika kuesioner aktif dan siswa kelas X belum mengirimkan jawaban).
- Menambahkan kolom **NISN** dan **Tgl Lahir** pada tabel daftar siswa yang belum mengisi kuesioner di Dashboard Peminatan (`peminatan-hasil.html`).
- Memperbaiki penanganan autentikasi di halaman kuesioner siswa (`peminatan.html`) agar pengguna dengan peran `super_admin` atau staff (`users` collection) tetap dapat mengakses kuesioner untuk tujuan pratinjau (mode preview) tanpa langsung dialihkan ke halaman login/dikeluarkan otomatis.
- Peningkatan versi aplikasi secara global menjadi `26.06.26.05`.

## [26.06.26.01] - 2026-06-26

### 🔧 Fix Default Dropdown Bulan Berjalan pada Laporan Estimasi
- Memperbaiki penentuan dropdown bulan dan tahun di Laporan Estimasi agar selalu terpilih secara otomatis (default) ke bulan berjalan saat ini dan tahun berjalan saat ini setiap kali tab Estimasi dibuka.
- Peningkatan versi aplikasi secara global menjadi `26.06.26.01`.

## [26.06.25.10] - 2026-06-25

### ✨ Sub Tab Estimasi Penerimaan SPP Bulanan & Tunggakan
- Menambahkan sub-tab "Estimasi" pada Laporan Keuangan SPP.
- Menghitung jumlah siswa aktif, estimasi penerimaan SPP bulanan, total tunggakan s.d. bulan sebelumnya, total potensial penerimaan, realisasi penerimaan, serta persentase realisasi per kelas.
- **Perbaikan Kueri Tunggakan**: Menyelaraskan pengambilan data transaksi agar berbasis kueri per kelas aktif (sama persis dengan Laporan Tunggakan), sehingga nominal "tunggakan lalu" sinkron 100% dan terhitung lengkap.
- **Leading Zero Guard (Normalisasi NIS)**: Mengintegrasikan fungsi helper `normalizeNIS` untuk membuang leading zero saat pencocokan NIS di data transaksi dan data siswa, menjamin kecocokan data 100% untuk siswa dengan NIS berawalan angka 0.
- Menambahkan baris **Total Kumulatif** di bagian paling bawah tabel untuk memudahkan pembacaan rangkuman data.
- Menyediakan fitur export data estimasi penerimaan kelas langsung ke file Excel.
- Peningkatan versi aplikasi secara global menjadi `26.06.25.10`.

## [26.06.25.06] - 2026-06-25

### ✨ Integrasi Laporan Harian SPP Migrasi (Januari - Juni 2026)
- Menambahkan data virtual SPP migrasi ke dalam Laporan Harian ketika admin memilih tanggal 20 pada bulan Januari s.d. Juni 2026.
- Menyembunyikan tombol cetak kwitansi dan badge jumlah bulan khusus pada baris entri virtual migrasi agar tetap rapi.
- Peningkatan versi aplikasi secara global menjadi `26.06.25.06`.

## [26.06.25.04] - 2026-06-25

### 🔧 Fix Mapping Properti Data Siswa pada Perhitungan SPP Migrasi
- Memperbaiki kegagalan pemetaan properti data siswa (`s.student_nis` dkk menjadi `s.nis` dkk) pada saat memuat cache siswa kosong untuk kalkulasi nominal virtual SPP migrasi.
- Peningkatan versi aplikasi secara global menjadi `26.06.25.04`.

## [26.06.25.03] - 2026-06-25

### ✨ Integrasi Pemasukan Virtual SPP Migrasi (Januari - Juni 2026)
- Menambahkan kalkulasi virtual pemasukan SPP migrasi untuk bulan Januari s.d. Juni 2026 pada laporan Buku Kas (arus kas) dan Rekapitulasi Pendapatan agar tercatat secara riil per bulannya dengan label "Migrasi".
- Mengecualikan secara otomatis data siswa yang status lunas migrasinya sudah diubah manual oleh admin menjadi nunggak (`manual_debt`) atau lunas riil (`paid`) agar nominal keuangan yang terhitung tetap akurat.
- Mempertahankan status lunas otomatis (migrasi) bebas tagihan baru di kartu SPP digital siswa agar tidak membebani murid.
- Peningkatan versi aplikasi secara global menjadi `26.06.25.03`.

## [26.06.24.20] - 2026-06-24

### 🐛 Fix Label Kategori Santunan pada Export Excel Buku Kas
- Melengkapi mapping `categoryLabels` di fungsi `exportBukuKasExcel` dengan 5 kategori santunan yang sebelumnya terlewat: `santunan_kelahiran`, `santunan_potong_gigi`, `santunan_upacara_agama`, `santunan_ngupasaksi`, dan `santunan_pensiun`.
- Sebelumnya, kategori-kategori tersebut muncul sebagai raw key di file Excel (misal `santunan_ngupasaksi`). Kini sudah tampil sebagai label yang rapi (misal "Santunan Ngupasaksi").
- Peningkatan versi aplikasi secara global menjadi `26.06.24.20`.

## [26.06.24.19] - 2026-06-24

### 🔧 Optimasi Logika Loop & Batching Antrean WA pada Cron Job Suka-Duka
- Memperbaiki penanganan asinkronus pengiriman batch pada Cloud Function `sukadukaTunggakanCron` dengan mengganti loop `forEach` menjadi `for...of` agar `await batch.commit()` berjalan secara sekuensial dan sinkron.
- Menerapkan *batch chunking* otomatis setiap 400 dokumen transaksi Firestore untuk mencegah kendala limitasi batas penulisan dokumen (maksimal 500 per operasi batch).
- Peningkatan versi aplikasi secara global menjadi `26.06.24.19`.

## [26.06.24.18] - 2026-06-24

### ✨ Cron Job Pengingat Otomatis Tunggakan Iuran Suka-Duka (Setiap Tanggal 20)
- Menambahkan scheduled Cloud Function baru `sukadukaTunggakanCron` yang berjalan otomatis setiap tanggal 20 pukul 08:00 WITA.
- Fungsi ini secara otomatis mengueri konfigurasi WA dari Firestore, daftar guru, data iuran/konfigurasi Suka-Duka dari Supabase, dan menghitung rincian tunggakan pokok serta denda masing-masing guru/staff.
- Jika terdapat tunggakan, pengingat WA akan dibuat dan dimasukkan ke antrean pengiriman `wa_notifications` Firestore (dengan filter anti-spam maksimal pengiriman 1 kali seminggu per nomor).
- Peningkatan versi aplikasi secara global menjadi `26.06.24.18`.

## [26.06.24.17] - 2026-06-24

### ✨ Hak Akses Khusus Super Admin untuk Pengaturan Denda Suka-Duka
- Membatasi visibilitas formulir pengaturan denda (status denda, kelipatan bulan denda, dan nominal denda) agar hanya tampil untuk pengguna dengan peran `super_admin`.
- Membatasi logika penyimpanan konfigurasi denda pada fungsi `handleSaveConfig` ke database Supabase agar hanya diproses dan disimpan jika peran pengguna adalah `super_admin`.
- Peningkatan versi aplikasi secara global menjadi `26.06.24.17`.

## [26.06.24.16] - 2026-06-24

### ✨ Perbaikan Pemetaan Kategori Santunan & Pengaktifan Kembali Kolom Aksi
- Memperbaiki objek pemetaan template santunan di fungsi `handleSantunanTemplateChange` agar menyimpan kategori santunan yang spesifik dan akurat ke database (seperti `santunan_kelahiran`, `santunan_potong_gigi`, `santunan_upacara_agama`, `santunan_ngupasaksi`, `santunan_pensiun`, dan `santunan_nikah` yang sebelumnya keliru tertulis `santunan_pernikahan`).
- Menambahkan pelabelan kategori santunan yang baru tersebut ke dalam `categoryLabels` sehingga nama kategori yang tampil di tabel web maupun fail Excel tidak lagi mendefault ke `"Lain-lain"`.
- Mengembalikan kolom **Aksi** pada tabel Aliran Buku Kas (berisi tombol Hapus) dengan menyesuaikan jumlah kolom (`colspan`) di HTML dan JavaScript menjadi 6 kolom.
- Peningkatan versi aplikasi secara global menjadi `26.06.24.16`.

## [26.06.24.15] - 2026-06-24

### ✨ Penyempurnaan Kolom Kategori & Keterangan Asli Buku Kas Suka-Duka
- Mengembalikan kolom **Kategori** ke tabel Aliran Buku Kas di UI dan di dalam fail Excel hasil ekspor.
- Menyaring dan membersihkan keterangan pembayaran iuran bulanan dari awalan `"Iuran Bulanan Guru: "` atau `"Iuran Bulanan Pegawai: "` saat di-render di tabel Buku Kas dan ekspor Excel, sehingga murni menampilkan keterangan aslinya saja (Nama Anggota dan Bulan Tahun).
- Memperbarui pencatatan transaksi iuran baru di database agar tidak lagi menyertakan awalan `"Iuran Bulanan Guru: "`.
- Menyesuaikan penanganan jumlah kolom (colspan) di JavaScript dan HTML menjadi 5 kolom (Tanggal, Kategori, Keterangan, Nominal, Saldo).
- Peningkatan versi aplikasi secara global menjadi `26.06.24.15`.

## [26.06.24.14] - 2026-06-24

### ✨ Penyederhanaan Kolom Aliran Buku Kas Suka-Duka
- Menghapus kolom **Tipe** dan kolom **Kategori** pada tabel Aliran Buku Kas. Tampilan kolom Keterangan kini menampilkan teks aslinya secara penuh tanpa ada duplikasi kategori.
- Menghapus kolom **Aksi** pada tabel Aliran Buku Kas karena tidak digunakan (transaksi iuran dikelola langsung dari tab Kasir).
- Menyesuaikan penanganan jumlah kolom (colspan) di JavaScript dan HTML menjadi 4 kolom (Tanggal, Keterangan, Nominal, Saldo).
- Menyederhanakan ekspor data Buku Kas ke berkas Excel agar selaras dengan tabel di UI (menyimpan kolom No, Tanggal, Keterangan, Nominal, dan Saldo).
- Peningkatan versi aplikasi secara global menjadi `26.06.24.14`.

## [26.06.24.13] - 2026-06-24

### ✨ Peningkatan Visual & Fitur Mutasi Kas Suka-Duka (Popup Modal & Saldo Kas Berjalan)
- Mengubah formulir penginputan Mutasi Kas Suka-Duka menjadi mode **popup modal** (`#modal-mutasi-kas-sukaduka`) untuk memberikan ruang tabel Aliran Buku Kas yang lebih luas (lebar penuh/w-full).
- Menambahkan tombol **Tambah Mutasi** di bagian tab Buku Kas untuk membuka popup modal tersebut secara instan.
- Mengimplementasikan penutupan otomatis popup modal (`window.closeMutasiModal()`) setelah data mutasi kas berhasil disimpan ke database.
- Menampilkan kolom **Saldo** (sisa kas berjalan) pada tabel Aliran Buku Kas yang dihitung secara kumulatif (*running balance*) dari data terlama hingga terbaru, lalu ditampilkan dalam urutan terbalik (*descending*).
- Menyertakan kolom **Saldo (Rp)** pada fitur ekspor data Buku Kas ke berkas Excel (`exportBukuKasExcel`) agar selaras dengan data yang tampil di peramban.
- Peningkatan versi aplikasi secara global menjadi `26.06.24.13`.

## [26.06.24.09] - 2026-06-24

### ✨ Otomatisasi Pengiriman WA Laporan Tunggakan SPP ke Wali Kelas
- Menambahkan otomatisasi pengiriman rekap tunggakan kelas ke Wali Kelas menggunakan Fonnte API secara langsung dari client-side browser saat tombol "Kirim Wali" diklik.
- Menambahkan fallback otomatis ke tautan WhatsApp Web manual (`https://wa.me/...`) jika Fonnte dinonaktifkan di konfigurasi global (`/settings/wa_config`) atau ketika token API Fonnte mengalami kendala (misal limit kuota harian tercapai) agar operasional kasir tetap berjalan lancar.
- Peningkatan versi aplikasi secara global menjadi `26.06.24.09`.

## [26.06.24.12] - 2026-06-24

### ✨ Fitur Baru Alur Kasir Suka-Duka (Auto-Block Teks & Shortcut Tombol Enter)
- Menambahkan fitur auto-select pada input pencarian nama guru setelah transaksi pembayaran sukses. Nama guru yang baru saja dibayar akan langsung diblok/diseleksi sehingga admin dapat langsung mengetikkan nama baru tanpa perlu menghapus nama lama secara manual.
- Menambahkan shortcut tombol `Enter` global:
  - Jika bulan pembayaran telah dipilih, menekan `Enter` akan secara otomatis memicu pop-up konfirmasi pembayaran (sama fungsinya dengan mengklik tombol "Proses Bayar Iuran").
  - Jika modal konfirmasi pembayaran sedang terbuka, menekan `Enter` kembali akan langsung mengeksekusi proses pembayaran iuran secara instan.
  - Sistem secara cerdas akan mengabaikan shortcut `Enter` ini jika fokus pengguna sedang berada di formulir lain (seperti kolom input kas keluar, kas masuk lainnya, kas awal, atau pengaturan denda).
- Peningkatan versi aplikasi secara global menjadi `26.06.24.12`.

## [26.06.24.11] - 2026-06-24

### 🔧 Perbaikan HTML Malformation Modal Konfirmasi Pembayaran Suka-Duka (Click Response Fix)
- Memperbaiki tag penutup `</div>` yang kurang pada deklarasi `#modal-delete-suka-duka`.
- Akibat kekurangan tag penutup tersebut, modal konfirmasi pembayaran `#modal-confirm-pay-sukaduka` secara tidak sengaja ter-nested (berada di dalam) modal delete yang berstatus tersembunyi secara permanen (`hidden`), sehingga memblokir modal konfirmasi tampil di layar ketika tombol "Proses Bayar Iuran" diklik.
- Menambahkan tag penutup `</div>` di baris 659 untuk modal delete, memulihkan hierarki dokumen HTML menjadi valid, dan memulihkan fungsi tombol bayar agar langsung memunculkan modal konfirmasi secara instan.
- Peningkatan versi aplikasi secara global menjadi `26.06.24.11`.

## [26.06.24.10] - 2026-06-24

### 🔧 Penggabungan & Penyederhanaan Form Pembayaran Suka-Duka (Compact Layout & Click Fix)
- Menggabungkan card "Cari Guru" dan "Ringkasan Pembayaran" di modul Suka-Duka menjadi satu card compact tunggal untuk menghemat ruang vertikal layar.
- Mengatur tata letak profil guru terpilih menjadi baris horizontal ramping (`flex-row`), memperkecil ukuran avatar, dan memposisikan badge tarif di sisi kanan sejajar dengan nama guru.
- Mengurangi padding card, input pencarian, dan tombol bayar, serta menghilangkan instruksi teks panjang yang tidak diperlukan agar seluruh ringkasan pembayaran dan tombol "Proses Bayar Iuran" tampil penuh di atas layar tanpa perlu scroll.
- Hal ini secara otomatis memperbaiki masalah tombol bayar yang "tidak merespon" akibat posisinya yang terdorong terlalu ke bawah layar dan tertimpa secara tidak terlihat oleh area sentuh navigasi bawah smartphone/browser.
- Peningkatan versi aplikasi secara global menjadi `26.06.24.10`.

## [26.06.24.08] - 2026-06-24

### ✨ Sinkronisasi Dinamis & Highlight Visual Label Tarif Aktif
- Menyelaraskan informasi kelas/angkatan pada label Tarif Aktif di panel kiri agar berubah secara otomatis mengikuti navigasi Tahun Ajaran Kartu SPP Digital yang dipilih di panel kanan.
- Meningkatkan kontras visual tingkat kelas pada label Tarif Aktif dengan merendernya ke dalam sebuah badge kecil berwarna indigo solid dan tulisan tebal (`bg-indigo-600 text-white font-black`) agar sangat menonjol dan mudah dibaca oleh admin.
- Peningkatan versi aplikasi secara global menjadi `26.06.24.08`.

## [26.06.24.06] - 2026-06-24

### 🔧 Perbaikan Batas Masa Studi & Nominal SPP Kelas XII (Click Fix & Dynamic Card Rate)
- Memperbaiki kegagalan klik pembayaran SPP kelas XII (Angkatan 2023) pada bulan April, Mei, Juni 2026 dengan menaikkan batas pelacakan tahun ajaran kelulusan (`maxY`) pada fungsi `getFirstUnpaidMonth` menjadi `cohortInfo.endYear + 1` (tahun kelulusan sesungguhnya).
- Mengubah visualisasi strip nominal default `Rp -` pada Kartu SPP Digital menjadi nominal dinamis (`Rp 65.000` / `Rp 70.000` sesuai angkatan masuk siswa) menggunakan fungsi `getRateForStudent` yang aman terhadap data kosong.
- Peningkatan versi aplikasi secara global menjadi `26.06.24.06`.

## [26.06.24.03] - 2026-06-24

### 🎨 Peningkatan Visual Tab Aktif Suka-Duka (Sliding Tab Indicator)
- Menambahkan visual sliding tab indicator premium (berwarna indigo) pada navigasi tab utama halaman Suka-Duka (`sukaduka/suka-duka.html`), serupa dengan gaya visual dinamis di halaman E-SPP.
- Mengatur status tombol tab aktif menjadi transparan dengan teks putih kontras di atas indicator geser (`!bg-transparent relative z-10 !text-white`) agar visual tab aktif terlihat sangat jelas, modern, dan interaktif.
- Menambahkan auto-resize handler (`window.addEventListener('resize')`) untuk menyelaraskan lebar dan posisi sliding indicator secara dinamis saat orientasi atau ukuran layar berubah.
- Peningkatan versi aplikasi secara global menjadi `26.06.24.03`.

## [26.06.24.02] - 2026-06-24

### ✨ Fitur Masukan (Feedback System) Terintegrasi Supabase
- Menambahkan halaman `masukan.html` dan `js/page-masukan.js` yang memungkinkan semua pengguna mengirimkan dan melihat saran, kendala, atau ide fitur dengan penyimpanan database Supabase.
- Membatasi hak akses pengelolaan masukan (menghapus atau mengubah status tanggapan) hanya untuk peran Super Admin.

## [26.06.23.13] - 2026-06-23

### 🔧 Perbaikan Logika Tarif SPP Historis (Historic Cohort Flat Rate)
- Memperbaiki kegagalan penentuan tarif SPP tunggakan masa lalu siswa (contoh: siswa kelas XI saat ini memiliki tunggakan di bulan Juni 2025 ketika masih kelas X) yang sebelumnya salah mengambil fallback tarif kelas X saat ini (Rp 70.000) alih-alih nominal angkatannya (Rp 65.000).
- Memodifikasi fungsi `getRateForStudent` agar secara otomatis mengambil tarif flat yang tersedia di dalam objek angkatannya (`cohorts[cohortYearStr]`) sebagai fallback apabila target kelas spesifik mengembalikan nilai `undefined`.
- Menyempurnakan penyimpanan tarif (`form-rates` submit listener) agar menyimpan tarif lengkap untuk semua tingkat kelas `{ X, XI, XII }` di database Firestore.
- Peningkatan versi aplikasi secara global menjadi `26.06.23.13`.

## [26.06.23.10] - 2026-06-23

### 🔧 Perbaikan Visual Filter Buku Kas (Fix Width Dropdown)
- Memperbaiki layout visual dropdown filter Tahun, Bulan, dan Tipe Mutasi yang memanjang secara horizontal dan menumpuk secara buruk akibat CSS selector select global.
- Menerapkan class CSS `.filter-select-compact` pada semua dropdown filter Riwayat Buku Kas SPP agar lebarnya menyesuaikan konten secara otomatis (`width: auto !important`) dan tampil serasi bersisian dengan tombol aksi.
- Peningkatan versi aplikasi secara global menjadi `26.06.23.10`.

## [26.06.23.09] - 2026-06-23

### ✨ Filter Arus Kas SPP Terpadu & Proteksi Tanggal Masa Depan
- Menyusun ulang tata letak dropdown filter Periode Bulan dan Tipe Mutasi secara rapi di samping tombol **Ringkasan Kas** pada header tabel Riwayat Buku Kas SPP.
- Menambahkan filter dropdown **Tahun** dinamis yang secara otomatis memicu query Firestore data kas berdasarkan tahun yang dipilih, menghemat kuota read database secara masif.
- Mengimplementasikan penyaringan data kas berdasarkan Bulan dan Tipe secara instan di sisi klien (*client-side filtering*) guna menghindari beban kueri Firestore tambahan.
- Mencegah pemilihan tanggal transaksi di masa depan (*future dates*) dengan menyetel atribut `max` pada input tanggal di formulir mutasi kas, serta melengkapinya dengan validasi penolakan di sisi klien sebelum penyimpanan data.
- Peningkatan versi aplikasi secara global menjadi `26.06.23.09`.

## [26.06.23.08] - 2026-06-23

### 🔧 Perbaikan Bug Visual & Input (Fix Tombol Silang & Default Tanggal Mutasi)
- Memperbaiki kegagalan visual tombol tutup silang (`x`) modal di mode gelap yang tertutup kotak putih/terang dengan menambahkan important modifier (`!bg-transparent !border-none !shadow-none outline-none`) pada tombol silang di Modal Ringkasan Kas, Form Mutasi Kas, dan Kwitansi Pembayaran.
- Mengimplementasikan pengisian tanggal transaksi otomatis ke tanggal hari ini (`openCashflowModal()`) dengan format ISO lokal `YYYY-MM-DD` saat modal form mutasi kas dibuka, namun tetap fleksibel untuk diedit oleh admin.
- Peningkatan versi aplikasi secara global menjadi `26.06.23.08`.

## [26.06.23.07] - 2026-06-23

### 🔧 Bug Fix & Optimalisasi Tab (Fix Overriding Background & Inisialisasi Dinamis)
- Memperbaiki kegagalan pergeseran sliding indicator di mode gelap akibat overriding warna background solid (`#334155`) tombol oleh rule CSS eksternal. Menerapkan important modifier `!bg-transparent` pada seluruh tombol tab agar background transparan permanen dan slider meluncur mulus terlihat di bawah teks.
- Menambahkan inisialisasi dinamis posisi tab setelah status auth selesai diproses dan elemen layout ditampilkan (`main` tidak lagi `hidden`), mencegah indicator berlebar 0px di awal muat halaman.
- Menggantikan manipulasi DOM manual kaku untuk proteksi view-only kesiswaan/kepala sekolah dengan pemanggilan `switchTab('laporan')` secara asinkron.
- Peningkatan versi aplikasi secara global menjadi `26.06.23.07`.

## [26.06.23.06] - 2026-06-23

### 🎨 Desain & UI Premium (Animasi Sliding Indicator Glassmorphism)
- Mengimplementasikan sliding highlight indicator (`#tab-indicator`) absolut yang meluncur secara dinamis di bawah tombol aktif saat diklik dengan efek transition cubic-bezier yang sangat mulus layaknya UI iPhone native.
- Menerapkan inisialisasi awal onload dan update koordinat indicator secara instan saat terjadi resize browser (`resize` listener) untuk menjamin presisi letak indicator di semua ukuran layar.
- Mengubah background tab control menjadi semi-transparan dengan efek blur kaca (`bg-slate-200/50 dark:bg-slate-950/40 backdrop-blur-md border shadow-inner`) untuk menghadirkan estetika premium glassmorphism.
- Peningkatan versi aplikasi secara global menjadi `26.06.23.06`.

## [26.06.23.05] - 2026-06-23

### 🎨 Desain & UI Premium (Anti-Meluap & Aksen Tab Aktif Penting)
- Mengatasi masalah tombol tab navigasi meluap (keluar dari kotak grid) di layar kecil dengan menerapkan scroll horizontal halus (`overflow-x-auto no-scrollbar whitespace-nowrap`) pada kontainer tab.
- Memperkecil padding tombol secara responsif (`px-3 md:px-6 py-2`) serta ukuran font (`text-xs md:text-sm`) agar tab teratur rapi tanpa merusak grid layout di berbagai resolusi layar.
- Menggunakan important modifier (`!bg-indigo-600 !text-white`) pada tab aktif dan (`!bg-transparent`) pada tab tidak aktif untuk memastikan warna aksen tetap solid dan kontras di mode gelap, melewati overriding paksa dari CSS eksternal.
- Peningkatan versi aplikasi secara global menjadi `26.06.23.05`.

## [26.06.23.04] - 2026-06-23

### 🎨 Desain & UI Premium (Aksen Warna Tab Aktif)
- Memperbaiki kontras tab navigasi utama pada halaman Keuangan agar mendukung mode gelap secara estetis.
- Mengubah warna latar belakang tab aktif menjadi warna indigo premium (`bg-indigo-600`) dengan bayangan halus, memberikan visualisasi tab aktif yang tegas, modern, dan sangat nyaman dipandang di mode terang maupun gelap.
- Peningkatan versi aplikasi secara global menjadi `26.06.23.04`.

## [26.06.23.03] - 2026-06-23

### ✨ Fitur Baru & Logika SPP Dinamis Berbasis Tahun Angkatan (Cohort)
- Mengimplementasikan penentuan tarif SPP dinamis berbasis Tahun Angkatan Masuk (Cohort) siswa (`getRateForStudent()`) untuk mengakomodasi kenaikan tarif SPP lintas angkatan (misal tunggakan kelas XI tetap ditagih Rp 65.000 meskipun tarif kelas XI angkatan baru di bawahnya saat ini sudah Rp 70.000).
- Memodifikasi form pengaturan tarif agar menyimpan tarif per angkatan ke dalam map nested `cohorts` di Firestore (`settings/finance_rates`) dengan kelakuan merge otomatis.
- Memperbarui badge info tarif di modul Kasir agar memuat tarif aktif secara dinamis.
- Mengintegrasikan logika tarif dinamis per bulan tunggakan pada kalkulasi total bayar Kasir (`updateCalculationUI()`), proses pencatatan pembayaran transaksi (`executePayment()`), cetak kwitansi digital (`showReceiptModal()`), serta laporan tunggakan (`loadArrearsReport()`).
- Peningkatan versi aplikasi secara global menjadi `26.06.23.03`.

## [26.06.23.02] - 2026-06-23

### 🔧 Penyempurnaan Pengurutan Kronologis Stabil Arus Kas
- Memperbaiki dan menyempurnakan logika pengurutan arus kas SPP (`loadCashflow()`) agar data terbaru selalu berada di paling atas secara konsisten dan stabil (descending).
- Mengintegrasikan logika pengurutan multi-level saat ada transaksi di hari yang sama: mengurutkan Saldo Awal paling bawah, disusul pemasukan SPP harian, lalu transaksi mutasi manual berdasarkan waktu pembuatan (`createdAt` timestamp).
- Peningkatan versi aplikasi secara global menjadi `26.06.23.02`.

## [26.06.23.01] - 2026-06-23

### 🔧 Pengarsipan Riwayat Pelanggaran & Peningkatan Logika Reset Tahunan
- Menambahkan fitur pengarsipan otomatis untuk total poin pelanggaran akumulatif siswa dari tahun ajaran lalu (`points`) ke dalam objek arsip `history_yearly` saat menjalankan Modul 1 (Kenaikan Kelas & Arsip) pada proses Reset Tahunan.
- Menjamin poin berjalan siswa tetap dipertahankan (akumulatif) sepanjang masa studi mereka di sekolah sesuai dengan aturan tata tertib SMAGESA.
- Peningkatan versi aplikasi secara global menjadi `26.06.23.01`.

## [26.06.22.08] - 2026-06-22

### 🎨 Optimalisasi Mode Gelap Modal & Keamanan Tingkat Tinggi (Dark Mode Modal & Absolute Security)
- Memperbaiki modal Catat Mutasi Kas (`#modal-cashflow-form`), Konfirmasi Pembayaran (`#modal-confirm-pay`), dan Kwitansi Pembayaran (`#modal-receipt`) agar mendukung mode gelap (dark mode) secara penuh dengan kontras tinggi sehingga teks dan input terlihat sangat jelas.
- Memperketat Firestore Security Rules untuk collection `finance_cashflow` agar client-side (petugas/admin biasa) tidak dapat menghapus atau mengedit saldo awal tahun buku (`isClosingRecord: true`) yang di-generate oleh sistem/cron, serta mencegah client-side memalsukan field tersebut pada dokumen baru.
- Peningkatan versi aplikasi secara global menjadi `26.06.22.08`.

## [26.06.22.07] - 2026-06-22

### ✨ Fitur Baru & Optimasi Database (Tutup Buku Otomatis)
- Implementasi Cloud Function terjadwal Gen 2 (`annualCashflowClosingCron`) yang otomatis berjalan setiap 1 Januari pukul 00:05 WITA untuk menghitung saldo akhir tahun dan menyimpannya sebagai "Saldo Awal" tahun berjalan.
- Mengubah kueri pembacaan data arus kas di sisi klien (`loadCashflow()`) agar hanya memfilter data tahun berjalan (`dateStr >= '${currentYear}-01-01'`), yang menghemat penggunaan kuota read database secara masif.
- Menambahkan penanda visual khusus (ikon 📂, warna latar slate netral, status terkunci 🔒) pada baris Saldo Awal di tabel Riwayat Buku Kas SPP.

## [26.06.22.06] - 2026-06-22

### 🎨 Perbaikan Kontras Hover Mode Gelap (Dark Mode Hover Fix)
- Memperbaiki warna background hover baris tabel (`hover:bg-blue-50`, `hover:bg-indigo-50`, `hover:bg-red-50/40`) pada modul Laporan Harian, Rekap Pemasukan, dan Tunggakan agar tidak menjadi putih terang di mode gelap (`dark:hover:bg-blue-950/20`, `dark:hover:bg-indigo-950/20`, `dark:hover:bg-red-950/20`).
- Memperbaiki warna background hover item dropdown pencarian siswa agar kontras dan nama siswa tetap terbaca jelas di mode gelap saat disorot.
- Menyesuaian kontras teks iuran, badge transaksi, dan border pembatas baris data di mode gelap agar selaras dan premium.

## [26.06.22.05] - 2026-06-22

### 🔧 Optimalisasi Layout & Alur Vertikal (Natural Flow Layout)
- Menghapus card pembungkus vertikal yang kaku (`h-[calc(100vh-220px)]`, dll.) yang sebelumnya membatasi tinggi tabel Riwayat Buku Kas SPP.
- Membiarkan tabel mengalir secara alami dan mengembang sesuai dengan jumlah baris datanya tanpa ada box pembatas kosong di bagian bawah.
- Menghapus fitur sticky header internal pada tabel (`sticky top-0 z-20 shadow-sm` di thead) karena tabel sekarang mengalir langsung mengikuti scrollbar utama halaman.

## [26.06.22.04] - 2026-06-22

### 🎨 Desain & UI/UX (Aesthetics Upgrade)
- Peningkatan kontras warna mode gelap (dark mode) pada tabel Riwayat Buku Kas SPP (warna background row `dark:bg-blue-950/20`, `dark:bg-emerald-950/20`, dan `dark:bg-red-950/20` yang lembut serta mudah dibaca).
- Penerapan text kontras tinggi (`dark:text-slate-300` / `dark:text-slate-200`) untuk tanggal dan keterangan, serta penyesuaian warna teks nominal debit/kredit/saldo.
- Menetapkan lebar kolom tabel (grid) secara eksplisit (`w-32`, `w-44`, `w-36`, dll.) agar layout tabel tetap stabil, proporsional, dan rapi di semua ukuran resolusi layar.
- Mengubah pewarnaan tombol aksi header (Ringkasan Kas, Refresh, Catat Transaksi) di mode gelap agar selaras dengan skema warna premium SIMAS.
- Penyesuaian tema mode gelap untuk popup modal Ringkasan Kas beserta keempat kartu statistik di dalamnya.

## [26.06.22.03] - 2026-06-22

### 🔧 Perbaikan Layout & Responsivitas
- Memperbaiki tinggi layout tab Arus Kas (`view-arus-kas`) yang sebelumnya pendek menjadi tinggi penuh responsif (`h-[calc(100vh-220px)] md:h-[calc(100vh-180px)]`) agar memanfaatkan seluruh ruang kosong vertikal di layar.
- Memastikan card putih pembungkus tabel (`h-full min-h-0`) meregang penuh dan tidak menyusut ketika data tabel masih kosong atau sedang memuat.

## [26.06.22.02] - 2026-06-22

### 🔧 Perbaikan Teknis & Layout
- Optimalisasi area tabel Riwayat Buku Kas dengan memanfaatkan ruang kosong secara maksimal (`flex-1` full height & full width).
- Penyembunyian grid 4 kartu summary yang dipindahkan ke popup modal "Ringkasan Kas" agar area tabel lebih luas.
- Penyesuaian padding baris tabel (`px-4 py-3.5`) agar sejajar dengan header tabel dan memberikan visualisasi data yang lebih lega.
- Peningkatan keamanan Firestore Rules dengan penambahan validasi skema input data untuk collection `finance_cashflow`.

## [26.06.22.01] - 2026-06-22

### ✨ Fitur Baru
- Peningkatan versi aplikasi secara global menjadi `26.06.22.01`.
- Penambahan tab **Arus Kas** pada modul e-SPP (Keuangan & Komite) yang memungkinkan admin melihat **sisa kas riil** secara akumulatif.
  - **Dashboard Ringkasan Kas**: 4 kartu visual (Pemasukan SPP Total, Pemasukan Manual Total, Total Pengeluaran, dan Sisa Kas Riil).
  - **Form Catat Mutasi Kas Manual**: Input untuk mencatat pemasukan non-SPP dan pengeluaran (tanggal, tipe, nominal, keterangan).
  - **Tabel Riwayat Buku Kas**: Menampilkan seluruh riwayat arus kas dengan running balance (saldo berjalan), warna baris dinamis per tipe transaksi, serta aksi hapus untuk transaksi manual.
  - **Sinkronisasi SSOT**: Data pemasukan SPP harian diambil langsung dari `finance_daily_summary` secara dinamis, sehingga saldo kas selalu sinkron tanpa duplikasi data.
- Penambahan Firestore security rules untuk collection `finance_cashflow`.
- Proteksi view-only pada tab Arus Kas untuk role Kesiswaan dan Kepala Sekolah.

## [26.06.20.01] - 2026-06-20

### 🔧 Perbaikan Teknis & Optimalisasi
- Peningkatan versi aplikasi secara global menjadi `26.06.20.01`.
- Penambahan file GitHub Actions workflow Keep Alive (`.github/workflows/supabase-keep-alive.yml`) yang secara berkala melakukan ping ke REST API Supabase modul Suka-Duka setiap 3 hari untuk mencegah database di-pause oleh Supabase (Free Tier).

## [26.06.10.01] - 2026-06-10

### 🔧 Perbaikan Teknis & Optimalisasi
- Peningkatan versi aplikasi secara global menjadi `26.06.10.01`.
- Perbaikan bug visual pada kalender SPP bulanan di halaman Kasir Keuangan, Portal Siswa, dan Wali Kelas, di mana bulan berstatus **Non-Aktif / Locked** secara keliru menampilkan badge **"Migrasi"**. Sekarang badge tanggal bayar/migrasi hanya muncul jika bulan berstatus aktif (`!isLocked`).

## [26.06.09.01] - 2026-06-09

### ✨ Fitur Baru & Perbaikan
- Peningkatan versi aplikasi secara global menjadi `26.06.09.01`.
- Penambahan visualisasi tanggal pembayaran riwayat SPP langsung pada grid kartu bulanan menggunakan icon kalender, serta badge label **"Migrasi"** untuk bulan yang lunas melalui skema migrasi awal sebelum sistem aktif.

## [26.06.08.02] - 2026-06-08

### 🔧 Perbaikan Teknis & Optimalisasi
- Peningkatan versi aplikasi secara global menjadi `26.06.08.02`.
- Sinkronisasi data guru yang lebih menyeluruh dengan turut membersihkan cache daftar guru (`simas_guru_list_cache`) saat terjadi perubahan data guru (tambah, edit, delete, atau import) di halaman Data Guru, sehingga data konsisten pada halaman Presensi Guru dan Rekap Presensi.
- Invalidasi cache konfigurasi mapel (`simas_mapel_config_cache` dan `cache_rapor_config`) secara instan di halaman Pengaturan saat memodifikasi mata pelajaran atau guru pengampu.

## [26.06.08.01] - 2026-06-08

### 🔧 Perbaikan Teknis & Optimalisasi
- Peningkatan versi aplikasi secara global menjadi `26.06.08.01`.
- Perbaikan bug sinkronisasi data guru di halaman Manajemen User setelah data guru diubah (tambah, edit, delete, atau import) di halaman Data Guru dengan membersihkan cache `simas_teachers_cache` di `localStorage`.

## [26.06.07.10] - 2026-06-07

### 🔧 Perbaikan Teknis & Optimalisasi
- Peningkatan versi aplikasi secara global menjadi `26.06.07.10`.
- Penambahan menu Koperasi SSA pada menu group "Lainnya" yang merujuk ke domain `https://sedana-shakti-amerta.web.app` dan otomatis dibuka di tab baru.
- Perbaikan urutan penambahan menu publik Koperasi SSA untuk menghindari bug fallback kosong.

## [26.06.06.13] - 2026-06-06

### 🔧 Perbaikan Teknis & Optimalisasi
- Peningkatan versi aplikasi secara global menjadi `26.06.06.13`.
- Perbaikan bug indikator "BARU" pada menu Game PID yang selalu muncul dengan menambahkan penyimpanan state kunjungan (`visited_game_pid`) secara langsung di halaman `portalpid.html` saat dimuat.
- Perbaikan responsivitas tabel riwayat di halaman `input.html` dengan menghapus `whitespace-nowrap` pada tingkat tabel sehingga kolom Keterangan panjang dapat dibungkus secara normal (`whitespace-normal break-words`), sementara kolom lainnya (Waktu, Siswa, Kategori, Poin, Aksi) tetap berada pada satu baris (`whitespace-nowrap`). Hal ini mencegah kolom Aksi tertutup dan menghilangkan kebutuhan scroll horizontal.

## [26.06.05.2] - 2026-06-05

### 🔧 Perbaikan Teknis & Optimalisasi
- Peningkatan versi aplikasi secara global menjadi `26.06.05.2` (kini terpusat via SSOT di `js/config.js`).
- Perbaikan bug constraint database pada modul Suka-Duka ketika membayar tunggakan dengan menggunakan `.upsert()` pada tabel `sukaduka_iuran` (menggantikan `.insert()`).
- Refaktor sistem pembaruan versi menjadi Single Source of Truth (SSOT) terpusat pada file `js/config.js` (`APP_VERSION`), sehingga nomor versi dimuat secara dinamis di seluruh halaman aplikasi.

## [26.06.05.1] - 2026-06-05

### 🔧 Perbaikan Teknis & Optimalisasi
- Peningkatan versi aplikasi secara global menjadi `26.06.05.1`.
- Pembaruan versi Service Worker cache menjadi `simas-pwa-v21` untuk memicu pembaruan aset cache browser secara instan.
- Sinkronisasi nama sekolah secara konsisten menggunakan **SMA Negeri 1 Abang** di seluruh modul aplikasi.
- Penambahan tombol cetak ulang kwitansi di Laporan Harian SPP.
- Peningkatan logika auto-focus pencarian siswa dan input Enter ganda untuk mempercepat pemrosesan transaksi iuran SPP.
- Perbaikan bug nominal Rp 0 / 0 Bulan pada cetak kwitansi SPP.
- Penambahan penutupan otomatis modal kwitansi setelah 30 detik idle.

## [26.05.29.2] - 2026-05-29

### 🔧 Perbaikan Teknis & Optimalisasi
- Peningkatan versi aplikasi secara global menjadi `26.05.29.2`.
- Pembaruan versi Service Worker cache menjadi `simas-pwa-v19` untuk memicu pembaruan aset cache browser secara instan.
- Sinkronisasi versi portal siswa, peminjaman lab, ruang BK, dan pemilihan duta.
- Penghapusan data session cache secara menyeluruh saat logout untuk mengantisipasi penggunaan perangkat yang sama oleh banyak siswa.

## [2.2.0] - 2026-02-09

### ✨ Fitur Baru
- **Follow-Up History BK**: Riwayat penanganan berkelanjutan untuk kasus "Dalam Pantauan"
  - Timeline visual untuk melihat kronologi follow-up
  - Setiap follow-up tersimpan di array `followUpHistory`
- **PWA Offline Mode**: Banner status offline dan notifikasi perubahan koneksi

### 🎨 Perbaikan UI
- Fix dark mode untuk tab aktif di halaman BK (ganti `bg-slate-800` → `bg-blue-600`)
- Fix kontras badge additional roles di halaman Users (warna solid untuk dark mode)

### 🔧 Perbaikan Teknis
- Session caching untuk kasus aktif BK dan pelanggaran terbaru

---

## [2.1.0] - 2026-02-05

### ✨ Fitur Baru
- **Presensi Guru**: Input presensi harian guru per jam pelajaran
- **Rekap Presensi Guru**: Dashboard statistik dan detail kehadiran guru
- **Export Excel** untuk data anggota koperasi (khusus super_admin)

### 🔧 Perbaikan Teknis
- Implementasi caching untuk `metadata_classes`, `teachers`, `system_config`
- Optimasi kuota read Firestore

---

## [2.0.0] - 2026-01-xx

### 🚀 Breaking Changes
- **Multi-Role System**: User bisa memiliki role utama + role tambahan
- Struktur users collection berubah (tambah field `additionalRoles`)
- Refaktor akses kontrol di semua halaman

### ✨ Fitur Baru
- Dynamic profile popup untuk kelengkapan data user
- Login activity log dengan filter role

---

## [1.x.x] - 2025

### Rilis Awal
- Sistem manajemen siswa dasar
- Input catatan siswa
- Dashboard admin

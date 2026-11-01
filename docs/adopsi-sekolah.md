# Adopsi SIMAS oleh sekolah lain

Targetnya adalah mempertahankan fitur, layout, navigasi, dan alur yang sudah ada.
Tidak ada profil yang diunduh saat aplikasi dibuka. Persiapan berjalan di komputer
pengembang, lalu memperbarui konfigurasi biasa sebelum build/deploy.

## Yang perlu diubah untuk sekolah baru

1. Buat salinan repositori khusus sekolah baru. Jalankan persiapan di salinan itu.
2. Salin `school.example.json` menjadi `school.local.json` dan isi nilainya.
3. Ganti aset sekolah dengan nama/path yang sama di `assets/`.
4. Periksa pratinjau perubahan, terapkan, lalu siapkan data awal dan deploy.

```powershell
Copy-Item school.example.json school.local.json
npm run school:prepare -- --config school.local.json
npm run school:prepare -- --config school.local.json --apply
```

Perintah pertama hanya melaporkan berkas yang akan berubah. `--apply` menulis
perubahan lokal setelah semua konfigurasi dan sintaks JavaScript diperiksa.
Perintah ini tidak membuat proyek cloud, menghubungi API, mengirim pesan, membaca
data siswa, mengubah database, atau melakukan deployment. Periksa `git diff`
setelah penerapan. Jangan menjalankannya untuk mengganti identitas sekolah aktif.

## Isi profil

- `school`: identitas, alamat, visi, kepala sekolah, domain aplikasi, dan username
  bot. `primaryDomain` hanya hostname, tanpa `https://` atau path. Pastikan NPSN
  benar; persiapan menggunakan nilai ini untuk UI, kartu siswa, dan API kartu.
- `firebase`: konfigurasi **Web App** Firebase milik sekolah baru.
- `supabase`: URL proyek serta **anon JWT key** yang sesuai dengan integrasi
  sistem sekarang, bukan `service_role` atau secret key.
- `cloudflare`: URL/nama Worker, nama/UUID database D1, dan dua nama bucket R2.
- `appsScript`: tiga URL Web App `/exec` milik sekolah baru. Gunakan folder Drive
  sekolah baru. Lihat `google-apps-script/PANDUAN_SETUP_GOOGLE_APPS_SCRIPT.md`.
- `hosting`: ID site produksi di Firebase. Site testing (`stagingSite`) dan alias
  bersifat opsional; kosongkan jika tidak dibutuhkan. Tanpa testing, workflow
  deployment hanya merespons branch `main`.
  Jika tidak memakai custom domain, `school.primaryDomain` adalah `<site>.web.app`.
- `financeStartDate`: tanggal mulai penagihan/perhitungan tunggakan SPP di instalasi
  baru, bukan tanggal bawaan sekolah asal.
- `analyticsId`: ID GA4 sekolah baru; kosong berarti tidak memuat Analytics.

Properti opsional `school` mengikuti nama pada `js/school-config.js`, misalnya
`schoolAddressShort`, `schoolStreetAddress`, `headmasterRank`, `bendaharaKomiteName`,
`ketuaKomiteName`, `defaultSuratKeteranganNo`, `libraryName`, dan `schoolMotto`.
Alamat panjang/pendek mengikuti `schoolAddress` jika tidak diisi. Nama/NIP pejabat
opsional menjadi `-` agar tidak mewarisi pejabat sekolah asal. Nama aplikasi
tetap SIMAS kecuali `school.appName` diisi. Warna dan ukuran antarmuka tetap
mengikuti aplikasi sekarang; perubahan warna tidak diperlukan untuk adopsi.

Profil tidak menampung private key, service account JSON, token Telegram,
Cloudflare API token, atau password. `school.local.json` diabaikan Git. Nilai
konfigurasi Web App dan anon key memang dipakai pada frontend.

## Berkas yang diperbarui otomatis

Persiapan menyesuaikan `school-config.js`, konfigurasi Firebase/Supabase/Worker,
URL Apps Script beserta fallback pada modul, identitas literal di keluaran
JavaScript, API kartu, whitelist CORS Worker/gateway, `wrangler.toml`, target
Firebase, CSP, manifest PWA, alias redirect, pemeriksaan gateway, dan workflow
deployment utama. Layout HTML, CSS, ID elemen, role, dan aturan akses tidak diubah.

Nilai konfigurasi yang masih tersebar tidak harus dipindahkan ke satu modul.
Persiapan memperbarui nilai tersebut secara lokal tanpa menambah dependensi
pemuatan pada halaman. Nama internal cache dan tabel tidak perlu diganti.

## Aset dan layanan yang disiapkan tersendiri

Ganti logo sekolah, logo padded 192/512, badge notifikasi, video logo, kop biasa
dan transparan, cap, tanda tangan, dan TTE. Pertahankan nama, format, proporsi,
serta area transparannya agar ukuran dan komposisi UI/cetakan tetap sama.
Teks di dalam gambar/video tidak dapat diganti dengan konfigurasi JavaScript.

Siapkan Firebase Auth/Firestore beserta rules/indexes, Supabase dan migrations,
Cloudflare D1 beserta schema/migrations, dua bucket R2, Apps Script/Drive, bot
Telegram, dan kredensial notifikasi sesuai fitur yang dipakai. Buat akun admin
awal dan data profil/role yang sesuai, lalu impor siswa, GTK, rombel, mapel,
jadwal, dan pengaturan menggunakan fasilitas sistem yang ada. Jangan menyalin
data siswa, sesi login, atau riwayat transaksi sekolah asal sebagai data awal.

Pasang secrets melalui lingkungan server dan repository sekolah baru. Workflow
hasil persiapan memakai secret `FIREBASE_SERVICE_ACCOUNT`; kredensial Cloudflare
dan Supabase tetap mengikuti nama secret pada workflow terkait. Deploy
`secure-proxy` dan `worker-gateway` ke proyek Supabase baru sebelum frontend.
Daftarkan domain produksi/testing di Firebase Authentication dan integrasi
Google yang dipakai. Periksa juga konfigurasi di dalam masing-masing Apps Script.

Untuk site Firebase yang sama sekali belum pernah dipublikasikan, izinkan
bootstrap riwayat hosting hanya pada deployment pertama:

```powershell
$env:SIMAS_FIRST_DEPLOY = '1'
npx firebase deploy --only hosting,firestore
Remove-Item Env:SIMAS_FIRST_DEPLOY
```

Deployment berikutnya berjalan tanpa variabel itu. Mode pertama hanya menerima
site terdaftar yang manifest dan service worker publiknya sama-sama belum ada;
riwayat site yang sudah dikenal tetap dilindungi. Jalankan build/check biasa
untuk memeriksa artefak sebelum deployment.

## Batas yang sengaja dipertahankan

Aturan WITA, jam kerja, kalender lokal, dan asumsi jenjang SMA tetap seperti
sistem sekarang. Sekolah dengan zona waktu/jenjang/aturan berbeda perlu tinjauan
khusus; mengganti `schoolLevel` saja tidak mengubah seluruh aturan akademik.

Android/TWA adalah paket opsional terpisah. Persiapan mengosongkan
`.well-known/assetlinks.json` pada salinan baru agar tidak mewarisi kepercayaan
paket sekolah asal. Sebelum memakai workflow `build-android`, sesuaikan
`android-twa/twa-manifest.json`, identitas signing, secrets keystore, dan
assetlinks dengan package ID serta sertifikat sekolah baru. PWA web tetap bisa
dipakai tanpa APK.

Tes lama yang secara eksplisit memeriksa nama/domain sekolah asal adalah
baseline repositori ini; sesuaikan ekspektasinya jika dipakai sebagai pipeline
sekolah lain. Pengujian `tests/school-adoption.test.mjs` memeriksa persiapan
salinan baru, isolasi layanan, dan preservasi struktur UI tanpa memakai cloud.
Sebelum operasional, lakukan uji login per role, simpan/baca data, upload foto,
scan/cetak kartu, ekspor, notifikasi, serta instalasi/update PWA di domain baru.

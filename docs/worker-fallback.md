# Jalur cadangan API melalui Supabase

Cloudflare Worker tetap jalur utama. Supabase Edge Function `worker-gateway`
hanya digunakan setelah kegagalan jaringan/timeout koneksi dari perangkat.
Pengguna tidak perlu mengubah DNS, memasang aplikasi, atau memilih operator.
Pemakaian jalur cadangan tetap perlu diuji dari jaringan XL setelah deployment.

## Perilaku klien

- `js/worker-fallback.mjs` memasang adaptor fetch satu kali. Hanya origin Worker
  yang dikonfigurasi dan jalur `/api/` yang ditangani. Firebase, Supabase database,
  Google Apps Script, CDN, dan domain lain tetap memakai fetch sebelumnya.
- Respons HTTP, termasuk 401/403/429/5xx, tidak memicu perpindahan jalur. Kesalahan
  kredensial dan hak akses tidak menjadi alasan memakai Supabase.
- Request baca menunggu header koneksi utama maksimal 5 detik. Kegagalan jaringan
  atau timeout mencoba request itu melalui gateway. Verifikasi kredensial siswa
  juga dapat diulang karena server menimpa klaim untuk identitas yang sama.
  Body Request diklon sebelum percobaan pertama; body stream eksplisit tidak diulang.
- Sebelum permintaan simpan/hapus, apabila jalur utama belum terbukti terjangkau
  dalam satu menit terakhir, klien memeriksa `/api/health` terlebih dahulu. Jika
  koneksi utama gagal, health gateway diperiksa sebelum body dikirim satu kali.
  Probe dibatasi 3 detik dan dibagi oleh permintaan paralel.
  Telemetri keepalive saat halaman ditutup langsung dikirim lewat jalur yang
  sudah dipilih, tanpa menunggu probe yang dapat menghilangkan event unload.
- Jika koneksi putus setelah pengiriman permintaan simpan, hasilnya dianggap
  belum pasti: `api/write-outcome-unknown`. Permintaan itu tidak diputar ulang ke
  jalur lain. Klien Cloudflare juga tidak melakukan retry otomatis untuk kode ini,
  termasuk timeout saat mengunduh body respons dan error gateway setelah write.
  Pengguna perlu memeriksa data sebelum mencoba menyimpan lagi.
- Jalur cadangan yang sudah terbukti menjangkau Worker diingat selama 5 menit
  dalam sessionStorage perangkat itu. Kedaluwarsa atau peristiwa online/perubahan
  koneksi mengembalikan percobaan berikutnya ke Cloudflare. Tidak ada request
  berkala ke Supabase dari pengguna yang jalur utamanya normal.
  Respons/probe dari jaringan lama tidak boleh mengubah pilihan setelah reset;
  pembatalan pemanggil saat probe juga segera menghentikan penantian tanpa
  mengirim body permintaan simpan.
- Batas waktu di atas menjaga respons header. Pembacaan body mengikuti batas
  waktu pemanggil. Fungsi gateway membatasi seluruh prosesnya sampai 60 detik.

`js/config.js` memasang adaptor dan menyediakan URL jalur yang sedang aktif lewat
`CLOUDFLARE_CONFIG.workerUrl/WORKER_URL`. Resolusi foto dari origin Worker juga
mengikuti jalur aktif. Halaman kapsul waktu memasang adaptor yang sama karena
memakai aplikasi Firebase tersendiri tanpa mengimpor config utama.

## Keamanan gateway

Gateway hanya meneruskan permintaan ke
`https://simas-smagesa-api.komangpurna1.workers.dev/api/...`. Parameter query tidak
bisa mengubah host tujuan. Redirect dari upstream tidak diikuti.

Firebase ID token, token siswa, metode, body, query, dan status respons diteruskan.
Worker tetap memverifikasi token dan role untuk setiap endpoint. Gateway tidak
menggunakan service-role Supabase, tidak menyentuh database Supabase, dan tidak
menambahkan kredensial administratif. Header autentikasi tambahan yang memang
disertakan pemanggil tetap diteruskan untuk diperiksa Worker. Cookie, header IP
klien, dan kunci layanan Supabase tidak diteruskan. Origin browser dibatasi ke aplikasi sekolah
dan localhost pengembangan; pemeriksaan CORS tidak menggantikan autentikasi.

`verify_jwt = false` berlaku hanya untuk `worker-gateway`: gateway menerima token
Firebase/siswa yang diperiksa Worker, bukan JWT Supabase. Pengaturan `secure-proxy`
tetap seperti sebelumnya. Semua respons gateway memakai `Cache-Control: no-store`.
Request dan respons masing-masing dibatasi 32 MiB, termasuk pemeriksaan body stream
tanpa Content-Length. Tidak ada token atau body login dalam log gateway.

Header `X-Simas-Gateway: worker-gateway-v1` dan
`X-Simas-Upstream-Reached: 1` membedakan gateway yang berfungsi dari 404 fungsi
yang belum dipasang, 401 platform Supabase, atau kegagalan koneksi upstream.

Traffic gateway berbagi alamat keluar menuju Cloudflare. Pembatasan login tetap
berjalan di Worker, tetapi sumber IP dapat sama untuk beberapa pengguna gateway.
Pantau 429 terutama untuk identitas siswa yang sama; jangan mempercayai header IP
yang dikirim browser untuk melonggarkan pembatasan ini.

## Deployment

1. Deploy fungsi lebih dahulu, menggunakan akun Supabase yang mengelola proyek:

   ```sh
   supabase functions deploy worker-gateway --project-ref elrmzlicuuglnoeedusr
   ```

   `supabase/config.toml` mengatur verifikasi JWT fungsi ini. Workflow
   `.github/workflows/supabase-migrations.yml` juga menjalankan pengujian dan
   men-deploy fungsi baru pada push yang mencakup kode Supabase.

2. Periksa:

   ```text
   https://elrmzlicuuglnoeedusr.supabase.co/functions/v1/worker-gateway/api/health
   ```

   Harus mendapat JSON `status: ok` dan kedua header penanda di atas, termasuk
   ketika Origin permintaan adalah `https://smagesa.web.app`.

3. Deploy frontend melalui alur Firebase Hosting yang ada, bersama cache PWA baru.
   Gateway tidak memerlukan DNS sekolah atau perubahan paket Firebase.
   Workflow frontend memeriksa health, marker gateway, dan CORS lebih dahulu
   lewat `scripts/check-worker-gateway.mjs`. Gateway yang belum siap menghentikan
   publikasi frontend; rilis lama tetap aktif. Setelah gateway selesai dipasang,
   ulangi workflow frontend bila pemeriksaan sempat gagal.
4. Uji dari XL: primary health timeout, gateway health berhasil, login siswa dan
   pemuatan data guru berhasil. Lalu uji Wi-Fi: permintaan API langsung ke Worker
   tanpa invocation gateway. Ganti jaringan dan pastikan jalur utama dicoba lagi.

Jika frontend terbit sebelum fungsi tersedia, koneksi utama yang sehat tetap
berjalan, sedangkan perangkat yang memerlukan gateway mendapat pesan cadangan
belum tersedia. Kode lokal dan pengujian tidak membuktikan deployment sudah aktif.

Supabase hanya menambah invocation/egress ketika gateway dipakai; penggunaan
tetap mengikuti kuota proyek, bukan layanan tanpa batas.

## Validasi

```sh
node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/worker-fallback.test.mjs tests/worker-gateway.test.mjs tests/worker-gateway-readiness.test.mjs tests/student-login-network.test.js
node scripts/check-syntax.js
```

Verifikasi browser dengan CORS aktif dan handler gateway sebenarnya:

```sh
node scripts/test-worker-fallback-server.mjs
# Pada terminal kedua:
node node_modules/cypress/bin/cypress run --headless --browser electron --config-file scripts/cypress-worker-fallback.config.cjs
```

Server hanya mendengar di loopback port 8765/8766, memakai data/token tiruan,
dan tidak mengirim permintaan ke Worker produksi. Pengujian browser menggunakan
timeout produksi untuk koneksi normal dan timeout pendek hanya untuk skenario
yang sengaja mensimulasikan koneksi lambat.

Tes menjalankan transport dan handler sebenarnya, menguji koneksi normal/gagal,
timeout, autentikasi, pembatalan saat body diunduh, kedaluwarsa pilihan jalur,
Request body replay, penolakan origin/redirect/host bebas, batas payload, serta
perlindungan terhadap duplikasi write lewat klien produksi.

### Hasil audit 15 Oktober 2026

- Regresi mencakup 3.784 tes: 3.766 tes pada 266 suite, serta 18 tes ekspor PDF
  yang dijalankan terpisah. Sembilan kegagalan awal berasal dari pergantian versi
  di workspace selama pengujian dan ekspektasi tes cache lama. Setelah versi
  tersinkron dan tes cache memeriksa perilaku sebenarnya, delapan suite terkait
  diuji ulang: 76 tes lolos. Modul cadangan tidak menyebabkan kegagalan regresi.
- Empat suite khusus login, transport, gateway, dan kesiapan rilis: 96 tes lolos.
  Verifikasi akhir metadata/cache setelah versi workspace menjadi `26.10.15.10`:
  24 tes pada dua suite lolos.
- Seluruh 20 tes handler gateway lolos, termasuk pengamanan header respons,
  autentikasi yang diteruskan, batas payload, timeout, dan hasil simpan belum pasti.
- Enam skenario browser lolos dengan CORS aktif dan handler gateway sebenarnya.
  Pemeriksaan kesiapan rilis juga berhasil melewati relay lokal sebenarnya.
- Pemeriksaan terakhir: 117 berkas JavaScript, 694 binding impor, 142 endpoint API,
  dan 173 aset cache tanpa error. Sumber Edge TypeScript/JavaScript dan kedua
  workflow deployment lolos pemeriksaan kompilasi/sintaks.
- Pengujian ini memakai data tiruan. Gateway dan frontend belum di-deploy oleh
  pekerjaan ini; keberhasilan akses dari XL tetap harus diperiksa setelah rilis.

Referensi: [konfigurasi fungsi Supabase](https://supabase.com/docs/guides/functions/function-configuration),
[autentikasi](https://supabase.com/docs/guides/functions/auth),
[routing](https://supabase.com/docs/guides/functions/routing),
[batas runtime](https://supabase.com/docs/guides/functions/limits), serta
[kuota Edge Functions](https://supabase.com/docs/guides/functions/pricing).

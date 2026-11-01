# Penghematan bandwidth Hosting tanpa mengubah antarmuka

Dasar caching diperkenalkan pada 26.10.15.10; pengembangan reuse referensi antar-rilis dicatat pada 26.10.16.4. Pengembangan tersebut diuji lokal dan belum dideploy dari pekerjaan ini.

## Masalah dan batas sasaran

Audit produksi mendapati 172 URL precache dengan 3.256.375 byte body terkompresi. Graph awal portal siswa berisi sekitar 1.451.024 byte; gabungan portal dan precache sekitar 4.135.321 byte per perangkat baru. Ini pengukuran satu rilis dan skenario, bukan ramalan seluruh penggunaan. Header no-store membuat body teks diunduh berulang meskipun pengguna sudah memiliki salinannya.

Cache membantu kunjungan dan rilis berulang. Perangkat baru, cache yang dibersihkan/diusir browser, media baru, serta aset yang benar-benar berubah tetap memakai bandwidth. Tidak ada jaminan semua pola pemakaian muat dalam Spark: panduan Firebase menyebut 10 GB/bulan, sedangkan tabel harga/console pada audit menunjukkan 360 MB/hari. Kuota berlaku pada proyek; verifikasi angka aktif di console sebelum mengubah paket.

## Perilaku yang dipertahankan

- Tidak mengubah layout, resolusi/kualitas gambar, kontrol LMS, aturan akses, endpoint API, atau alur simpan/cetak/ekspor.
- Seluruh daftar offline lama beserta dependency JS/CSS-nya tetap disiapkan. Install dibatasi empat unduhan paralel, menduplikasi URL alias dari body yang sama tanpa mengunduh dua kali.
- Worker baru menunggu aktivasi alami. Tidak ada reload otomatis ketika controller berubah; formulir, kuis, unggahan, login, dan storage pengguna tetap berjalan. Pengguna yang terus membuka tab lama dapat menerima rilis baru setelah menutup tab aplikasi tersebut.
- API, gateway, sesi/token, request berotorisasi, Range, non-GET, dan origin luar tidak masuk cache app-shell.
- Install yang gagal tidak menggantikan rilis offline lengkap sebelumnya. Kegagalan menulis cache tidak membuang respons online yang berhasil.

## Build dan identitas aset

Jalankan build:hosting untuk menghasilkan dist-hosting. Source tidak ditimpa. JS/MJS/CSS diberi nama dengan hash graph dependency; letak direktori dipertahankan agar import.meta.url tetap benar. Impor statis, re-export, dynamic import literal, rujukan HTML/inline module, dan CSS lokal ditulis ulang bersama-sama. Impor yang tidak dapat dipastikan menggagalkan build.

APP_VERSION pada hasil build dibaca dari metadata HTML. Kenaikan nomor versi saja tidak mengganti seluruh graph JavaScript. Alias nama asli berisi byte yang sama dengan saudara hash-nya untuk loader lama.

sw-manifest.js menyimpan SHA-256 byte keluaran, hubungan alias, dan cakupan offline. Worker memverifikasi body sebelum memakai ulang cache rilis sebelumnya. Untuk HTML/JS/MJS/CSS yang hanya berbeda nama hash dependency atau metadata versi HTML, worker mencoba menyusun salinan lokal dari graph rilis lengkap lama. Alias stabil menghubungkan file lama dan baru, termasuk ketika entri hash mendahului alias pada manifest. Body asal harus cocok SHA-256 lama; hasil harus cocok persis SHA-256 byte hasil build baru. Rekonstruksi dibatasi 2 MiB per body; pemetaan ambigu, sumber privat/lintas origin/query, cache tidak lengkap, encoding tidak valid atau perubahan isi lain memakai unduhan biasa. Cache lama tidak ditimpa. Header panjang, encoding dan validator body lama dibuang dari salinan hasil rekonstruksi. Nama hash dan gambar/font publik yang dipatok revisinya memakai cache-first; HTML serta alias JS/CSS tetap memeriksa pembaruan. Query tidak diabaikan secara global.

Graph immutable sebelumnya disimpan minimal 30 hari di .hosting-history untuk dynamic import pada tab yang masih terbuka. Inventaris historis yang diterbitkan berada pada hosting-history.json dan hanya diambil oleh alat deploy. Manifest service worker hanya membawa graph aplikasi saat ini; penambahan ratusan rilis lama tidak menambah ukuran manifest yang diperiksa setiap kunjungan pengguna. Inventaris deploy terikat pada versi/digest manifest aktif dan diverifikasi tersendiri. Sebelum deploy, restore:hosting:history memeriksa manifest publik site tujuan dan memulihkan body hash yang belum ada secara terbatas, dengan SHA-256 dan pemeriksaan perubahan rilis selama pemulihan. Graph yang sedang aktif dipertahankan 30 hari sejak penggantian, termasuk bila rilis sebelumnya sudah lama tidak diperbarui. Kegagalan verifikasi membatalkan upload. Cache branch di CI mempercepat proses ini, lalu disimpan lagi setelah deploy berhasil; keselamatan tab lama tidak bergantung pada cache CI saja. Build menolak symlink yang keluar dari direktori yang dimiliki dan tidak membaca path privat. Hanya .well-known publik yang dikecualikan dari larangan direktori tersembunyi.

## Pengembangan reuse referensi (26.10.16.4)

Perubahan satu dependency bersama bisa mengganti nama hash banyak modul induk dan rujukan HTML, walaupun isi selain rujukannya tetap sama. Worker kini memakai pemetaan alias dari satu rilis lama yang lengkap untuk menyusun byte target, lalu memverifikasi hasilnya. Pemetaan dilakukan satu kali per teks agar penggantian tidak berantai. Rilis lama lain dicoba secara mandiri; graph beberapa rilis tidak dicampur. Cache legacy tetap boleh menyediakan body identik setelah pemeriksaan digest, tetapi tidak menyediakan rekonstruksi referensi tanpa manifest rilis lengkap.

Pengukuran pada salinan source 26.10.16.4 yang dibekukan memakai build sebenarnya, runtime worker sebenarnya, dan verifikasi 332 entri offline pada setiap hasil. Perubahan percobaan hanya komentar pada salinan file; perubahan UI/LMS lain di workspace dikecualikan dari perbandingan.

| Skenario pembaruan | Sebelum reuse referensi | Sesudah | Body disusun dari cache |
| --- | ---: | ---: | ---: |
| Satu perubahan source js/global.js | 2.173.961 byte | 82.500 byte | 91 |
| Satu perubahan source js/lms-quiz-student.mjs | 120.090 byte | 5.562 byte | 2 |
| Nomor versi saja | 0 byte dengan reuse metadata yang sudah ada | tetap 0 byte | 55 HTML |

Angka adalah model body gzip level 6, bukan HAR, ukuran APK/AAB, atau meter billing Firebase. Hasil berlaku untuk skenario tersebut dengan cache asal tersedia. Worker/manifest tetap diperiksa browser; navigasi, konten yang benar-benar berubah, media, perangkat baru dan cache yang hilang tetap memakai transfer. Optimasi ini menyasar pembaruan, tidak mengurangi unduhan awal yang diperlukan agar cakupan offline tetap utuh. Tidak ada minifikasi ulang modul, penurunan kualitas aset, pengurangan cakupan offline, atau perubahan alur antarmuka pada revisi caching ini.

Pengujian runtime mencakup perubahan JS/CSS/HTML sekaligus, graph cyclic import, dynamic import, inline module/query, alias hash lebih dahulu, cache/preimage rusak, marker hilang, pemetaan ambigu, batas ukuran, fallback gagal, dan rollback. Seluruh hasil yang dipakai harus identik digest target. Bukti rinci serta batas pengujian browser dicatat terpisah pada laporan audit.

Hasil akhir: 32 pengujian runtime serta 4.073 unit test pada 287 suite lulus. Chrome nyata memverifikasi 332 digest pada A, B dan rollback A; pembaruan B hanya meminta satu body modul yang berubah. Formulir/pilihan kuis pada dua tab dan localStorage tetap utuh, worker menunggu sampai tab terakhir ditutup, akses offline berhasil termasuk hash lama, API privat melewati cache, dan rollback membutuhkan nol unduhan body aset. Profil browser dan data pengujian bersifat sementara; akun siswa maupun data produksi tidak digunakan. Uji ini tidak mencakup seluruh perangkat Android/iOS atau beban pengguna produksi.

## Header dan bukti Firebase

| Jenis URL | Cache-Control |
| --- | --- |
| HTML, JSON, alias JS/MJS/CSS | public, max-age=0, must-revalidate |
| Nama JS/MJS/CSS dengan 16 karakter hash | public, max-age=31536000, immutable |
| sw.js, sw-manifest.js, push-worker.js, firebase-messaging-sw.js | no-cache, no-store, must-revalidate |

Eksperimen pada preview Firebase terpisah membuktikan lima aset identik mendapat 304 tanpa body dengan revalidation, sedangkan baseline no-store mengirim 200/full body. Setelah satu aset diubah, ETag lama mendapat 200 dengan body baru yang tepat dan ETag baru mendapat 304. Urutan rule general lalu regex immutable juga diuji di Firebase sesungguhnya. Header respons tetap memiliki overhead; 304 bukan klaim nol byte billing. Cache-first yang benar-benar tidak melakukan request menghindari transfer tersebut.

## Perintah pemeriksaan

~~~sh
npm run sync:version
npm run check:syntax
npm run test:unit
npm run test:sw
npm run build:hosting
npm run check:hosting
# Hanya sebelum deploy, pilih site tujuan yang tepat:
npm run restore:hosting:history -- --site smagesa
~~~

predeploy pada kedua target aplikasi menjalankan pemulihan history site masing-masing, build, dan pemeriksaan integritas. Target redirect tetap memakai redirect-stub. Pemeriksa independen memvalidasi digest, body, alias, dependency, query, cakupan offline, batas direktori, dan larangan berkas pengembangan sebelum unggah.

## Penerapan dan pemulihan

Deploy pertama ke format hash dapat memerlukan unduhan migrasi sekali karena rujukan di dalam modul berubah. Jadwalkan rilis di luar jam belajar massal; jangan menghapus cache/storage browser pengguna sebagai langkah migrasi. Uji preview dengan akun fixture terlebih dahulu, termasuk kunjungan dingin/hangat, offline, dua rilis, rollback, multi-tab, draf/kuis aktif, serta cetak/ekspor.

Gunakan alur deploy yang sudah ada setelah gate frontend dan kesiapan backend rilis gabungan lulus. Working tree pada implementasi ini juga memuat perubahan lain dari pekerjaan terpisah; jangan menerbitkan campuran tersebut tanpa pemeriksaan dependensi backendnya. Tidak ada perubahan billing atau downgrade paket otomatis.

Pemulihan cache yang hilang dibatasi 64 MiB total dan 4 MiB per berkas dalam satu proses. Jika riwayat melebihi batas tersebut, deploy dihentikan untuk pemulihan yang ditinjau, bukan membuang hash lama secara diam-diam. Deployment ke target yang sama harus tetap diserialkan melalui concurrency CI yang sudah ada.

Untuk rollback, pulihkan rilis Hosting terakhir yang sehat dengan sw.js dan sw-manifest.js yang berasal dari build yang sama. Pertahankan graph hash lama. Worker menolak install parsial dan tidak memaksa tab aktif berpindah. Jangan menghapus cache aplikasi lain atau storage login/draf.

## Hasil verifikasi

Model keluaran build saat audit (gzip level 6; bukan HAR atau meter billing):

| Skenario | Body terkompresi model |
| --- | ---: |
| Precache pertama: 300 URL, 180 body berbeda | 4.178.780 byte |
| Kenaikan versi saja: 118 aset JS/CSS | 0 byte body JS/CSS baru |
| HTML yang berbeda byte pada kenaikan versi saja (55 dokumen) | 602.973 byte ekuivalen gzip |
| Body HTML baru yang perlu diunduh untuk install versi saja jika rekonstruksi dan cache cocok | 0 byte (55/55 hasil identik SHA-256) |
| Manifest rilis | 11.391 byte |
| Worker (skrip kontrol, tetap diperiksa) | 5.850 byte |

Perbandingan dua build pada salinan source aktual membuktikan seluruh 118 nama hash dan byte JS/CSS tetap sama ketika hanya versi naik dari 10 ke 11. Source versi aktif tidak diubah oleh eksperimen itu. Metadata versi tetap membuat byte HTML rilis baru berbeda, tetapi percobaan dua build aktual membuktikan 55 dari 55 HTML dapat direkonstruksi lokal menjadi SHA-256 yang persis sama. Uji runtime juga membuktikan install yang hanya menaikkan metadata tidak melakukan fetch aset. Tanpa rekonstruksi ini, ekuivalen HTML tersebut adalah 0,60 GB untuk 1.000 perangkat per rilis. Manifest/control script, revalidation saat navigasi, perubahan konten nyata, cache miss, media/runtime, dan overhead protokol masih memakai bandwidth. Model precache pertama tetap sekitar 4,18 GB untuk 1.000 perangkat, sebelum trafik tambahan dan variasi kompresi Firebase.

Precache baru mencakup closure dependency yang lebih lengkap; ukuran cold tidak diklaim turun dibanding precache lama. Penghematan berasal dari reuse sesudah instalasi dan perubahan terarah. Pengukuran byte terkompresi lokal adalah model, terpisah dari meter billing Firebase dan trafik API/media di origin lain. Regresi utama lulus 3.852 tes pada 272 suite. Pengujian browser fixture LMS/kuis lulus 14 skenario; renderer, ekspor/cetak kartu dan font pada graph hasil build lulus 7 skenario. Browser nyata juga memverifikasi install lengkap 300 entri, digest body, halaman pertama tanpa takeover, navigasi berikutnya terkontrol, offline HTML/modul hash, dan API bypass. Gate akhir berhasil diulang terhadap snapshot terakhir setelah pemisahan inventaris history; receipt menyertakan SHA worker dan revisi manifest. Chrome nyata juga menjalankan A → B (metadata versi saja) → rollback A: 300 digest setiap rilis cocok, draf/controller tab aktif tetap utuh, worker menunggu penutupan tab, dan update/rollback masing-masing membutuhkan 0 fetch/0 byte body aset. Skrip kontrol tetap diperiksa; hosting-history.json tidak diminta.

## Rujukan

- https://firebase.google.com/docs/hosting/manage-cache
- https://firebase.google.com/docs/hosting/full-config
- https://firebase.google.com/docs/hosting/usage-quotas-pricing
- https://firebase.google.com/pricing

Validator mencatat satu tautan navigasi yang memang sudah tidak tersedia di source sebelum pekerjaan ini: pub/admin-kapsul.html menuju pub/test-wordcloud.html. Tautan tersebut dipertahankan; dependency aplikasi yang hilang akibat build tetap menggagalkan pemeriksaan.

Pemeriksaan HTTP baca-saja pada smagesa.web.app dan sman1abang.web.app mengonfirmasi jalur legacy-bootstrap berhasil (tiga GET publik per site; tidak ada unggahan atau perubahan produksi).

Batas transisi: index lama yang sudah cached tanpa metadata atau query versi tidak selalu dapat menentukan nomor versi footer; fallback dapat menampilkan dev sampai dokumen hasil build diterima. Bridge query menangani halaman lama yang memiliki query versi. Uji fungsi dan draf tidak bergantung pada label footer tersebut.

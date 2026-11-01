# Proyek Android SIMAS SMAGESA (Trusted Web Activity)

Folder ini berisi konfigurasi untuk membangun aplikasi Android resmi **SIMAS - SHAKTI** (SMA Negeri 1 Abang) menggunakan arsitektur **Trusted Web Activity (TWA)** dari Google.

---

## 1. Spesifikasi Aplikasi

- **Nama Aplikasi:** SIMAS SMAGESA
- **Nama Peluncur (Launcher):** SIMAS
- **Package ID:** `id.sch.sman1abang.simas`
- **Domain Web (Host):** `smagesa.web.app`
- **Warna Tema / Navigasi:** `#0F172A` (Slate 900)
- **Status Bar / Fullscreen:** Standalone (Layar Penuh tanpa baris URL browser)
- **Digital Asset Links:** `https://smagesa.web.app/.well-known/assetlinks.json`

---

## 2. Sertifikat Penandatangan (Keystore)

File keystore lokal digunakan untuk menandatangani paket `.apk` dan `.aab`:
- **Nama Keystore:** `android.keystore`
- **Alias Kunci:** `android`
- **Password Default:** `smagesa123!`
- **Algoritma:** RSA 2048-bit (Validitas 10.000 hari)
- **SHA-256 Fingerprint Saat Ini:**
  ```text
  7F:BF:96:65:86:72:4A:F3:E8:4D:F6:09:ED:3E:62:35:CB:A8:AE:08:9D:0C:75:12:18:60:1B:98:8F:C9:E8:44
  ```

> [!CAUTION]
> **PENTING:** Jangan pernah menghapus file `android.keystore` atau mengunggahnya ke repositori publik. Jika keystore hilang atau berubah, pembaruan aplikasi di perangkat pengguna tidak akan bisa dipasang dan harus di-uninstall terlebih dahulu.

Untuk membuat ulang atau memeriksa fingerprint keystore kapan saja:
```powershell
.\generate-keystore.ps1
```

---

## 3. Cara Membangun APK (Build APK)

### Metode A: Menggunakan Bubblewrap CLI (Rekomendasi Google)

1. Pastikan Anda berada di direktori `android-twa`:
   ```bash
   cd android-twa
   ```
2. Jalankan perintah build Bubblewrap:
   ```bash
   npx @bubblewrap/cli build
   ```
3. Masukkan password keystore saat diminta: `smagesa123!`.
4. Hasil kompilasi:
   - **`app-release-signed.apk`**: File APK siap dibagikan langsung ke pengguna (sideload via WA/Drive).
   - **`app-release-bundle.aab`**: File bundle siap diunggah ke Google Play Console.

---

### Metode B: Menggunakan PWABuilder (Paling Mudah via Web)

Jika tidak ingin menginstal Android SDK di komputer lokal:
1. Buka [PWABuilder.com](https://www.pwabuilder.com/).
2. Masukkan URL: `https://smagesa.web.app`.
3. Klik **Package for Stores** -> pilih **Android**.
4. Masukkan Package ID: `id.sch.sman1abang.simas`.
5. Pada opsi *Signing Key*, pilih *Use Existing* lalu upload file `android.keystore` (atau biarkan PWABuilder membuatkan kunci baru, lalu salin SHA-256 fingerprint barunya ke `.well-known/assetlinks.json`).
6. Unduh file `.apk` / `.aab` yang telah selesai dikompilasi di cloud.

---

### Metode C: Menggunakan GitHub Actions (Otomatis di Cloud)

Repositori ini telah dilengkapi workflow CI/CD non-interaktif pada `.github/workflows/build-android.yml`.
1. Masuk ke tab **Actions** di repositori GitHub Anda.
2. Pilih workflow **Build SIMAS Android (APK & AAB)**.
3. Klik tombol **Run workflow** (dapat mengisi versi aplikasi kustom atau menggunakan default).
4. Setelah proses selesai (~2-3 menit), file APK (`app-release-signed.apk`) dan AAB (`app-release-bundle.aab`) siap diunduh langsung dari bagian **Artifacts**.

#### Jika Setup Android SDK gagal: `Failed to find package 'tools'`
`android-actions/setup-android@v3` memasang `tools platform-tools` secara bawaan. Workflow menetapkan `packages: 'platform-tools'` secara eksplisit karena paket `tools` tidak tersedia. Penerimaan lisensi ditangani langsung oleh action, tanpa langkah manual yang mengasumsikan path `cmdline-tools/latest`.

Setelah perubahan workflow di-commit dan di-push, jalankan **Run workflow** pada branch yang memuat perbaikan. **Re-run jobs** pada run lama tetap menggunakan commit lama.

#### Konfigurasi Rahasia Keystore di GitHub Secrets (Opsional tapi Direkomendasikan)
Agar APK rilis yang dibangun di cloud menggunakan keystore produksi yang sama dengan `assetlinks.json`:
1. Ubah file `android.keystore` menjadi base64:
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("android.keystore")) | Set-Clipboard
   ```
2. Buka GitHub Repo -> **Settings** -> **Secrets and variables** -> **Actions**.
3. Buat New repository secret:
   - Name: `ANDROID_KEYSTORE_BASE64`
   - Secret: *Paste string base64 dari clipboard*
4. Jika tidak diset, GitHub Actions akan otomatis menghasilkan keystore penandatangan default yang valid dan mencatat SHA-256 fingerprint di log build.

---

## 4. Cara Memverifikasi Digital Asset Links

Agar aplikasi Android otomatis menghilangkan bilah URL (*address bar*), verifikasi Google harus berhasil:
1. Deploy berkas `.well-known/assetlinks.json` ke Firebase Hosting:
   ```bash
   firebase deploy --only hosting
   ```
2. Cek apakah berkas dapat diakses di browser:
   `https://smagesa.web.app/.well-known/assetlinks.json`
3. Lakukan tes validasi melalui alat resmi Google:
   [Google Digital Asset Links Statement List Tester](https://developers.google.com/digital-asset-links/tools/generator)
   - Masukkan Hosting: `smagesa.web.app`
   - Masukkan App Package: `id.sch.sman1abang.simas`
   - Masukkan SHA-256 Fingerprint di atas.

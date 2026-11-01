# Panduan Setup Google Apps Script Khusus E-Kinerja Guru

Dokumen ini menjelaskan langkah-langkah membuat **Google Apps Script Web App khusus untuk Modul E-Kinerja Guru**, sehingga **tidak mengganggu Web App Jurnal Mengajar** yang sudah berjalan live saat ini, meskipun tetap memakai akun Google Drive / ruang penyimpanan sekolah yang sama.

---

## 📁 Struktur Penyimpanan Otomatis di Google Drive

Foto bukti dukung E-Kinerja akan otomatis disimpan ke hierarki folder berikut di Google Drive:
```text
Google Drive (My Drive)
  └── E-Kinerja/
        ├── 2026-08/
        ├── 2026-09/
        │     ├── I Komang Purna/
        │     │     ├── bukti_1727500000000_1.jpg
        │     │     └── ...
        │     ├── Guru Lain/
        │     └── ...
        └── 2026-10/
```

> **Keuntungan:** Admin sekolah dapat dengan mudah menghapus folder bulan lama (misal `2026-08`) dalam 1 klik jika ruang memori Google Drive penuh di masa mendatang, tanpa khawatir menyentuh berkas Jurnal Guru.

---

## 🚀 Langkah Penerapan (Hanya 2 Menit)

1. **Buka Google Apps Script:**
   - Kunjungi [https://script.google.com](https://script.google.com) menggunakan **Akun Google yang sama dengan Google Drive sekolah**.
2. **Buat Proyek Baru:**
   - Klik tombol **"New project"** (*Proyek baru*) di pojok kiri atas.
   - Ubah judul proyek (di kiri atas samping ikon Apps Script) menjadi:  
     `SIMAS E-Kinerja Drive Uploader`
3. **Salin Kode:**
   - Buka berkas [`EKinerja_Drive_Uploader.gs`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/google-apps-script/EKinerja_Drive_Uploader.gs) di repositori ini.
   - Hapus semua baris teks default di editor Apps Script (`function myFunction() { ... }`).
   - Tempel (*paste*) seluruh isi berkas `EKinerja_Drive_Uploader.gs` ke editor tersebut.
   - Tekan **Ctrl + S** (atau klik ikon disket) untuk menyimpan.
4. **Deploy sebagai Web App:**
   - Klik tombol biru **"Deploy"** (*Terapkan*) di pojok kanan atas -> pilih **"New deployment"** (*Penerapan baru*).
   - Di panel kiri dialog yang muncul, klik ikon gerigi ⚙️ di samping *Select type* -> pilih **"Web app"**.
   - Isi formulir:
     - **Description:** `SIMAS E-Kinerja Uploader v1.0`
     - **Execute as:** `Me (email akun Anda)`
     - **Who has access:** `Anyone` (*Siapa saja, bahkan anonim*) ⚠️ **PENTING: Jangan pilih "Only myself" agar browser dapat mengunggah foto.**
   - Klik tombol **"Deploy"**.
5. **Otorisasi Izin Google:**
   - Klik tombol **"Authorize access"** (*Izinkan akses*).
   - Pilih akun Google Anda.
   - Jika muncul peringatan *"Google hasn't verified this app"*:
     - Klik **"Advanced"** (*Lanjutan*) di kiri bawah.
     - Klik tautan **"Go to SIMAS E-Kinerja Drive Uploader (unsafe)"**.
     - Klik **"Allow"** (*Izinkan*).
6. **Salin Web App URL:**
   - Salin **Web app URL** yang muncul (format: `https://script.google.com/macros/s/AKfycb.../exec`).
7. **Perbarui Konfigurasi SIMAS:**
   - Buka file [`js/config.js`](file:///c:/Users/SSA/Documents/GitHub/smagesa-simas/js/config.js).
   - Pastikan konstanta `EKINERJA_APPS_SCRIPT_URL` telah terpasang dengan Web App URL aktif:
     ```javascript
     export const EKINERJA_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwGwYmeLUiJUAI-FHK3cDUAddFLtpmnIKRfKX5PyeJRpktj6KlqnAqeKd6ImW3k-x0m/exec';
     ```
   - Selesai! Foto bukti dukung E-Kinerja sekarang menggunakan Web App Google Apps Script tersendiri secara aktif.

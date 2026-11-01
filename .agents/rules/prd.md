---
trigger: always_on
glob: "**/*"
description: Aturan Wajib Memeriksa PRD_SIMAS.md Sebelum Mengubah Kode
---

# Aturan Memeriksa PRD & Manajemen Perubahan

1. **Wajib Memeriksa PRD Sebelum Mengubah Kode:**
   Sebelum membuat, merevisi, atau memperbarui baris kode apa pun di proyek SIMAS SMAGESA, AI Agent **WAJIB** membaca dan memeriksa dokumen [PRD_SIMAS.md](file:///c:/Users/I%20KOMANG%20PURNA/OneDrive/Documents/GitHub/smagesa-simas/PRD_SIMAS.md) sebagai *Single Source of Truth* (SSOT).

2. **Kesesuaian Aturan Bisnis & Spesifikasi:**
   Setiap kodingan yang ditulis harus sesuai dengan spesifikasi modul, batasan hak akses (RBAC), serta strategi optimasi resource (Firestore Read & Supabase *free tier*) yang tertulis di PRD.

3. **Sinkronisasi PRD dan Log Versi Aplikasi:**
   - Jika ada penambahan fitur atau perubahan logika bisnis, dokumen `PRD_SIMAS.md` harus diperbarui terlebih dahulu.
   - Setiap revisi selesai, update nomor versi aplikasi di `package.json` dan di `PRD_SIMAS.md`.
   - Catat ringkasan revisi di `CHANGELOG.md`.

4. **Penomoran Versi Harian (`YY.MM.DD.REV`):**
   - Angka revisi di paling belakang (**REV**) wajib di-reset mulai dari `1` setiap kali berganti hari/tanggal baru (misal tanggal 5 Agustus revisi pertama = `26.08.05.1`).

5. **Otomatisasi Sinkronisasi Versi (SSOT `scripts/sync-version.js`):**
   - Setelah memperbarui versi di `package.json`, AI Agent **WAJIB** menjalankan `npm run sync:version` (atau `node scripts/sync-version.js`).
   - Perintah ini secara otomatis menyelaraskan `package-lock.json`, `js/config.js` (`APP_VERSION`), dan seluruh tag `<script>` / `<link>` cache-buster di puluhan berkas HTML proyek secara instan dan bebas kesalahan (0 human error).
   - Pastikan juga menjalankan `npm run check:syntax` dan `npm run test:unit` sebelum melakukan commit.

6. **Paritas Otorisasi Klien-Server & Siklus Hidup Penuh (Action & Security Parity):**
   - Setiap kali menyediakan tombol aksi di antarmuka (misal *Batalkan*, *Edit*, *Hapus*), AI Agent **WAJIB** memverifikasi bahwa endpoint backend (Cloudflare Worker/Supabase/Firestore) memiliki logika otorisasi yang menerima aksi tersebut (khususnya pemisahan hak pembatalan mandiri pemilik `isOwner` vs persetujuan pengelola `isApprover`).
   - Wajib menyertakan pengujian unit Jest siklus hidup penuh (skenario positif pemilik data, skenario negatif pengguna lain tertolak HTTP 403, dan skenario aksi pengelola) serta meneruskan pesan galat asli server (`e.message`) di frontend agar transparansi terjaga.

7. **Integritas Hierarki DOM & Larangan Tegas Modal Bersarang (DOM Integrity & Anti-Nesting Rule):**
   - Setiap elemen dialog modal overlay (`fixed inset-0`) **WAJIB** berdiri mandiri sebagai *top-level siblings* di luar `<main>` dan **DILARANG KERAS** bersarang (*nested*) di dalam kontainer modal lain atau elemen berstatus `display: none` / `.hidden`.
   - Setiap tag kontainer modal (`<div>`, `<form>`) wajib berimbang sempurna (0 *unclosed tags*).
   - Validasi otomatis wajib terintegrasi pada `scripts/check-syntax.js` (Audit Bagian 7: Modal Anti-Nesting) dan diverifikasi oleh suite pengujian unit Jest (`tests/html-modal-integrity.test.js`) sebelum rilis.

8. **Kewajiban Sinkronisasi Deployment Cloudflare Worker (Worker Deployment & Zero 404 Mandate):**
   - Setiap kali memodifikasi, menambah, atau merevisi rute API di `cloudflare/worker.js`, AI Agent **WAJIB** menjalankan `npm run deploy:worker` untuk mengunggah script ke Cloudflare API live.
   - Dilarang keras menyelesaikan sesi saat berkas `cloudflare/worker.js` lokal belum ter-deploy ke production jika ada perubahan endpoint.
   - Seluruh endpoint API klien (`js/cloudflare-client.js`) wajib diverifikasi oleh Audit Bagian 8 di `scripts/check-syntax.js` dan suite pengujian unit Jest (`tests/workload-endpoint-parity.test.js`) sebelum rilis, serta diuji live fetch untuk menjamin 0 error HTTP 404 Endpoint Not Found.

9. **Larangan Tegas Iterasi Variabel Tanpa Validasi Array & Ketahanan Fungsi Objek (Safe Iteration & Anti-TypeError Mandate):**
   - **DILARANG KERAS** memanggil method array (`.forEach()`, `.map()`, `.filter()`, `.reduce()`, dsb.) secara langsung pada variabel hasil pemanggilan fungsi analisis atau respons API yang bertipe objek (seperti `calculateDayTimelineSlots(...)` yang mengembalikan `{ date, slots, ... }`) tanpa mengekstrak properti array yang benar (`dayTimeline?.slots || []`) atau tanpa validasi `Array.isArray()`.
   - Seluruh fungsi utilitas kalkulasi/analisis wajib mengimplementasikan interface iterabel yang forgiving (`forEach` bawaan dan `[Symbol.iterator]`) agar terlindung dari TypeError seandainya diiterasi langsung.
   - Validasi kepatuhan iterasi aman wajib diverifikasi otomatis oleh Audit Bagian 9 pada `scripts/check-syntax.js` dan suite pengujian unit Jest (`tests/safe-iteration-integrity.test.js`) sebelum rilis untuk menjamin 0% kemungkinan timbulnya galat runtime `TypeError: *.forEach is not a function`.



---
trigger: always_on
glob: "**/*"
description: Aturan Keamanan, Otorisasi RBAC & Paritas Aksi Klien-Server
---

# Aturan Keamanan, Otorisasi RBAC & Paritas Klien-Server (Security & Action Parity)

Untuk mencegah terjadinya error penolakan hak akses (*HTTP 403 Forbidden*) pada aksi pengguna yang sah (seperti pembatalan booking mandiri, pengeditan dokumen milik sendiri, atau penarikan pengajuan), AI Agent **WAJIB** mematuhi prinsip keamanan dan paritas berikut:

## 1. Prinsip Paritas Aksi Klien & Otorisasi Server (Action vs Authorization Parity)
- **Kesesuaian Tombol UI & Izin Backend:**
  Setiap kali tombol aksi mutasi data (*Simpan*, *Edit*, *Batalkan*, *Tolak*, *Setujui*, *Hapus*) ditampilkan di frontend berdasarkan kondisi tertentu (misal `isOwner`, `isCoordinator`, dsb.), AI Agent **WAJIB** memeriksa dan memastikan bahwa endpoint backend API (Cloudflare Worker D1, Supabase RPC/RLS, atau Firestore Rules) **memiliki percabangan logika otorisasi yang menerima aksi tersebut**.
- **Pemisahan Hak Pemilik (*Resource Owner*) vs Pengelola (*Admin / Approver*):**
  - Pemilik data (`isOwner` / `pemohon_uid === user.uid`) berhak melakukan mutasi mandiri yang wajar (misal: membatalkan booking status `cancelled`, mengedit pengajuan yang masih `pending`).
  - Pemilik data dilarang keras melakukan aksi tingkat pengelola (misal: menyetujui jadwalnya sendiri `status: 'approved'`).
  - Backend API harus membedakan aksi pembatalan mandiri (`isOwnerCancelling`) dari aksi persetujuan pengelola (`isApproverAction`), bukan menyatukan seluruh mutasi status di balik satu gerbang otorisasi admin.

## 2. Pengujian Siklus Hidup Penuh (Full Lifecycle Testing Mandatory)
Setiap modul yang memiliki status alur kerja (*draft -> pending -> approved -> cancelled / rejected*) **WAJIB** memiliki pengujian unit Jest yang menguji:
1. **Skenario Positif Pemilik:** Pemilik data berhasil melakukan pembatalan atau pembaruan mandiri.
2. **Skenario Negatif Pengguna Lain:** Pengguna terautentikasi lain yang bukan pemilik dan bukan pengelola wajib ditolak tegas (*HTTP 403 Forbidden*).
3. **Skenario Pengelola:** Admin atau pengelola yang berwenang dapat menyetujui, menolak, atau mencabut data.
4. **Skenario Proteksi Anti-Bentrok / Anti-Eskalasi:** Aturan bisnis spesifik (misal: koordinator tidak boleh setujui booking bentrok) diverifikasi.

## 3. Penyampaian Pesan Galat Asli Server (Transparent Error Propagation)
- Di sisi frontend (JavaScript), **DILARANG KERAS** menyembunyikan respons galat backend di balik pesan generik seperti `"Gagal memproses data"`.
- Selalu teruskan pesan error spesifik dari backend:
  ```javascript
  showToast('Error', e.message || 'Gagal memproses permintaan.', 'error');
  ```
- Ini menjamin bahwa jika terjadi kegagalan otorisasi atau validasi bisnis, pengguna dan pengembang dapat langsung mengetahui akar masalahnya secara instan tanpa menduga-duga.

## 4. Pencegahan Kode Duplikat & Konsistensi State
- Dilarang menduplikasi pemanggilan fungsi penutup modal, pembaruan antarmuka, audit log, atau toast dalam satu alur eksekusi (*single handler*).
- Setiap tindakan pembatalan wajib membersihkan state aktif, memperbarui cache lokal, dan me-refresh tabel data terkait secara sinkron.

## 5. Paritas Deployment Backend & Pencegahan Kesalahan Rute (Deployment & Route Parity)
- Setiap kali menulis atau mengubah endpoint pada backend (`cloudflare/worker.js`), AI Agent **WAJIB** mengeksekusi `npm run deploy:worker` untuk mempublikasikan script ke production Cloudflare.
- Validasi paritas endpoint wajib lolos pada `scripts/check-syntax.js` (Audit 8) dan `tests/workload-endpoint-parity.test.js` sebelum rilis untuk memastikan 0% kemungkinan timbulnya galat runtime `404 Endpoint not found`.


---
trigger: always_on
glob: "**/*"
description: Aturan Desain Sistem Antarmuka, Konsistensi Form UX & Anti-Overlapping (UI Guidelines)
---

# Aturan Desain Sistem Antarmuka, Konsistensi Form UX & Anti-Overlapping (UI Guidelines)

Untuk memastikan konsistensi visual, ergonomi, dan pengalaman pengguna (UX) yang berstandar tinggi di seluruh modul SIMAS SMAGESA, AI Agent **WAJIB** mematuhi pedoman perancangan antarmuka berikut:

---

## 1. Larangan Tegas Menempatkan Leading Icon di Dalam Input (`Anti-Overlapping Icon`)
- **DILARANG KERAS** meletakkan ikon absolut di dalam field input (`relative` + `absolute inset-y-0 left-0` + `pl-9` / `pl-10`) pada elemen `<input>` teks biasa, URL, email, angka, ataupun textarea.
- Pola leading icon absolut di dalam field input sering kali mengakibatkan teks input atau placeholder terpotong, tertimpa, bertumpuk, atau tampak sempit pada layar mobile dan berbagai rendering resolusi font browser.
- Seluruh elemen `<input>` dan `<textarea>` wajib memiliki area ketik yang bersih dan leluasa dengan padding standar horisontal yang seimbang (`px-3` atau `px-3.5`).

---

## 2. Penempatan Ikon Kontekstual yang Benar
Jika suatu field input membutuhkan representasi ikon kontekstual (misalnya ikon link, Google Drive, kalender, buku, user, dll.):
- **Opsi A (Direkomendasikan): Letakkan di Label:**
  Tempatkan ikon di dalam elemen `<label>` di atas input:
  ```html
  <label class="block font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
      <i class="fa-brands fa-google-drive text-emerald-600"></i>
      <span>Tautan Bukti Dukung (Opsional)</span>
  </label>
  ```
- **Opsi B: Letakkan di Tombol Aksi di Luar Input:**
  Tempatkan ikon sebagai bagian dari tombol aksi eksternal di samping input:
  ```html
  <div class="flex items-center gap-2">
      <input type="url" class="flex-1 px-3 py-2 ...">
      <button type="button" class="px-3.5 py-2 ..."><i class="fa-solid fa-arrow-up-right-from-square"></i> Buka</button>
  </div>
  ```

---

## 3. Khusus Input Pencarian / Dropdown Combobox
- Untuk input pencarian (*search field*) atau combobox, tombol pemicu (*trigger* chevron atau tombol reset clear) **WAJIB diletakkan di sebelah kanan** (`right-2` / `pr-9`), BUKAN di sebelah kiri sebagai leading icon yang menghalangi awal ketikan kata kunci.
- Awal pengetikan teks harus selalu dimulai langsung dari tepi kiri input dengan padding yang wajar (`px-3` atau `pl-3.5`).

---

## 4. Standar Status Badges & Dark Mode Native
- **Warna Status Semantik:**
  - Sukses/Approved: `bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60`
  - Pending/Menunggu: `bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/60`
  - Ditolak/Bahaya: `bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800/60`
  - Info/Netral: `bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700`
- Setiap elemen kartu dan kontainer wajib memiliki varian mode gelap `dark:bg-slate-900`, `dark:border-slate-800`, dan `dark:text-white`.

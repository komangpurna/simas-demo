/**
 * Konfigurasi build Tailwind CSS (pengganti Play CDN cdn.tailwindcss.com).
 * Output: css/tailwind.css  ->  npm run build:css
 *
 * PENTING: Tailwind hanya menghasilkan class yang tertulis UTUH di file yang dipindai.
 * Class yang dirakit dinamis (mis. `bg-${color}-50`) wajib didaftarkan di `safelist`.
 *
 * Sengaja TIDAK memakai --minify: minifier mengonversi warna ke hsla() dengan pembulatan
 * sehingga warna bergeser dari hasil Play CDN. Selisih ukurannya hanya ~3 KB (gzip).
 *
 * Urutan class sejenis di hasil build = alfabetis (mis. bg-slate-100 sebelum bg-white).
 * Saat JS menambahkan class status, lepas dulu class dasar yang sejenis (classList.remove)
 * agar class status tidak kalah urutan.
 */
const DYNAMIC_COLORS = 'gray|red|blue|green|yellow|purple|amber|emerald|rose';

module.exports = {
  darkMode: 'class',
  content: [
    './*.html',
    './library/**/*.{html,js,mjs}',
    './sukaduka/**/*.{html,js}',
    './js/**/*.{js,mjs}',
    '!./js/vendor/**',
    '!./**/*.test.{js,mjs}',
  ],
  safelist: [
    // Dipakai oleh: js/page-presensi.js, js/page-input.js, js/page-students.js,
    // js/lms-quiz-student.mjs, input.html
    {
      pattern: new RegExp(`^(bg|text|border)-(${DYNAMIC_COLORS})-(50|100|200|400|500|600|700|800|900|950)$`),
      variants: ['dark'],
    },
    {
      pattern: new RegExp(`^(bg|border)-(${DYNAMIC_COLORS})-(50|800|900|950)\\/(10|20|30|50)$`),
      variants: ['dark'],
    },
    {
      pattern: new RegExp(`^border-(${DYNAMIC_COLORS})-400$`),
      variants: ['focus', 'focus-within'],
    },
  ],
  theme: { extend: {} },
  plugins: [],
};

/**
 * Build Tailwind khusus halaman Duta (duta/*.html, duta-admin.html) yang memakai
 * font Plus Jakarta Sans + Outfit. Output: css/tailwind-duta.css  ->  npm run build:css
 *
 * Memindai sumber yang sama dengan tailwind.config.js karena halaman Duta juga
 * memakai layout global (sidebar, modal, toast) dari js/global.js.
 */
const base = require('./tailwind.config.js');

module.exports = {
  ...base,
  content: [...base.content, './duta/**/*.{html,js}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'sans-serif'],
        outfit: ['Outfit', 'sans-serif'],
      },
    },
  },
};

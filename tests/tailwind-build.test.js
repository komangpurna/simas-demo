/**
 * Mengunci migrasi Tailwind Play CDN -> CSS hasil build (npm run build:css).
 * - Tidak ada halaman yang memuat cdn.tailwindcss.com / js/tailwind-config.js lagi.
 * - Setiap halaman memuat css/tailwind.css (atau css/tailwind-duta.css untuk halaman Duta)
 *   sebagai stylesheet TERAKHIR di <head>, meniru posisi <style> yang dulu disisipkan Play CDN
 *   sehingga utilitas Tailwind tetap menang atas css/style.css.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PAGE_DIRS = ['', 'library', 'sukaduka', 'duta'];

const pages = PAGE_DIRS.flatMap((dir) =>
    fs.readdirSync(path.join(ROOT, dir))
        .filter((f) => f.endsWith('.html'))
        .map((f) => (dir ? `${dir}/${f}` : f))
);

const readPage = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const usesTailwind = (html) => /<link rel="stylesheet" href="(?:\.\.\/)*css\/tailwind(?:-duta)?\.css">/.test(html);

describe('Migrasi Tailwind Play CDN -> build', () => {
    test('tidak ada halaman yang memuat Tailwind Play CDN atau js/tailwind-config.js', () => {
        const offenders = pages.filter((p) => {
            const html = readPage(p);
            return html.includes('cdn.tailwindcss.com') || html.includes('tailwind-config.js') || /tailwind\.config\s*=/.test(html);
        });
        expect(offenders).toEqual([]);
    });

    test('halaman ber-Tailwind memuat CSS build sebagai stylesheet terakhir di <head>', () => {
        const tailwindPages = pages.filter((p) => usesTailwind(readPage(p)));
        expect(tailwindPages.length).toBeGreaterThan(40);

        for (const page of tailwindPages) {
            const html = readPage(page);
            const head = html.slice(0, html.indexOf('</head>'));
            const depth = page.split('/').length - 1;
            const isDuta = page.startsWith('duta');
            const expected = `<link rel="stylesheet" href="${'../'.repeat(depth)}css/tailwind${isDuta ? '-duta' : ''}.css">`;

            expect({ page, hasLink: head.includes(expected) }).toEqual({ page, hasLink: true });

            const afterLink = head.slice(head.indexOf(expected) + expected.length);
            expect({ page, stylesheetAfter: /<link[^>]+rel="stylesheet"|<style\b/i.test(afterLink) })
                .toEqual({ page, stylesheetAfter: false });
        }
    });

    test('file CSS build tersedia dan berisi utilitas inti', () => {
        for (const file of ['css/tailwind.css', 'css/tailwind-duta.css']) {
            const css = fs.readFileSync(path.join(ROOT, file), 'utf8');
            expect(css).toContain('tailwindcss v3');
            expect(css).toContain('.dark\\:bg-slate-900:is(.dark *)');
            expect(css).toContain('.md\\:flex');
        }
    });

    test('class dinamis (bg-${color}-*) tercakup oleh safelist', () => {
        const css = fs.readFileSync(path.join(ROOT, 'css/tailwind.css'), 'utf8');
        for (const cls of ['bg-purple-900\\/20', 'focus-within\\:border-yellow-400', 'text-rose-600', 'bg-yellow-50\\/50', 'border-red-800\\/50']) {
            expect({ cls, present: css.includes(cls) }).toEqual({ cls, present: true });
        }
    });
});

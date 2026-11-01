const fs = require('fs');
const path = require('path');
const vm = require('node:vm');
const acorn = require('acorn');

describe('Standardisasi SSOT Resolusi URL Foto Profil GTK & Pasfoto Siswa (resolvePhotoUrl)', () => {
    const configSource = fs.readFileSync(path.join(__dirname, '../js/config.js'), 'utf8');
    const globalSource = fs.readFileSync(path.join(__dirname, '../js/global.js'), 'utf8');
    const gtkSource = fs.readFileSync(path.join(__dirname, '../js/page-gtk.js'), 'utf8');
    const workerSource = fs.readFileSync(path.join(__dirname, '../cloudflare/worker.js'), 'utf8');
    const studentCardSource = fs.readFileSync(path.join(__dirname, '../js/student-card-renderer.js'), 'utf8');
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
    const configAst = acorn.parse(configSource, { ecmaVersion: 'latest', sourceType: 'module' });
    const declarations = configAst.body.filter(node => node.type === 'ExportNamedDeclaration').map(node => node.declaration);
    const configNode = declarations.find(node => node?.type === 'VariableDeclaration' && node.declarations[0].id.name === 'CLOUDFLARE_CONFIG').declarations[0].init;
    const photoNode = declarations.find(node => node?.type === 'FunctionDeclaration' && node.id.name === 'resolvePhotoUrl');
    const resolverFor = config => vm.runInNewContext(`(${configSource.slice(photoNode.start, photoNode.end)})`, { CLOUDFLARE_CONFIG: config });

    describe('1. Konfigurasi & Fungsi Terpusat di js/config.js', () => {
        test('CLOUDFLARE_CONFIG memiliki alias workerUrl dan WORKER_URL', () => {
            const primary = 'https://simas-smagesa-api.komangpurna1.workers.dev';
            const fallback = 'https://project.supabase.co/functions/v1/worker-gateway';
            let active = primary;
            const config = vm.runInNewContext(`(${configSource.slice(configNode.start, configNode.end)})`, {
                workerPrimaryUrl: primary, workerGatewayUrl: fallback, workerTransport: { get baseUrl() { return active; } }
            });
            expect(config.workerUrl).toBe(primary);
            expect(config.WORKER_URL).toBe(primary);
            active = fallback;
            expect(config.workerUrl).toBe(fallback);
            expect(config.WORKER_URL).toBe(fallback);
            expect(config.primaryWorkerUrl).toBe(primary);
        });

        test('Fungsi resolvePhotoUrl diekspor dan di-bind ke window.resolvePhotoUrl', () => {
            expect(configSource).toContain('export function resolvePhotoUrl(');
            expect(configSource).toContain('window.resolvePhotoUrl = resolvePhotoUrl');
        });

        test('Logika resolusi resolvePhotoUrl menangani berbagai jenis URL dengan tepat', () => {
            const CLOUDFLARE_CONFIG = {
                workerUrl: 'https://simas-smagesa-api.komangpurna1.workers.dev',
                WORKER_URL: 'https://simas-smagesa-api.komangpurna1.workers.dev'
            };

            const resolvePhotoUrl = resolverFor(CLOUDFLARE_CONFIG);

            // Path relatif API GTK
            expect(resolvePhotoUrl('/api/photos/gtk/htfda25WD2xWRTzhKtle.webp?v=174209'))
                .toBe('https://simas-smagesa-api.komangpurna1.workers.dev/api/photos/gtk/htfda25WD2xWRTzhKtle.webp?v=174209');

            // Path relatif tanpa leading slash
            expect(resolvePhotoUrl('api/photos/gtk/htfda25WD2xWRTzhKtle.webp'))
                .toBe('https://simas-smagesa-api.komangpurna1.workers.dev/api/photos/gtk/htfda25WD2xWRTzhKtle.webp');

            // Path relatif siswa
            expect(resolvePhotoUrl('/api/photos/student/active/10234.webp'))
                .toBe('https://simas-smagesa-api.komangpurna1.workers.dev/api/photos/student/active/10234.webp');

            // URL absolut HTTPS eksternal (Unsplash, dsb.) tidak diubah
            expect(resolvePhotoUrl('https://images.unsplash.com/photo-123'))
                .toBe('https://images.unsplash.com/photo-123');

            // Data URL WebP tidak diubah
            expect(resolvePhotoUrl('data:image/webp;base64,UklGRm...'))
                .toBe('data:image/webp;base64,UklGRm...');

            // Blob URL tidak diubah
            expect(resolvePhotoUrl('blob:http://localhost:8082/1234-5678'))
                .toBe('blob:http://localhost:8082/1234-5678');

            // Null, undefined, empty string
            expect(resolvePhotoUrl(null)).toBe('');
            expect(resolvePhotoUrl(undefined)).toBe('');
            expect(resolvePhotoUrl('')).toBe('');
            expect(resolvePhotoUrl('   ')).toBe('');
        });

        test('foto Worker absolut dan relatif mengikuti fallback tanpa mengubah host eksternal', () => {
            const primary = 'https://simas-smagesa-api.komangpurna1.workers.dev';
            const fallback = 'https://project.supabase.co/functions/v1/worker-gateway';
            const resolve = resolverFor({ primaryWorkerUrl: primary, workerUrl: fallback });
            expect(resolve(`${primary}/api/photos/gtk/test.webp?v=1`)).toBe(`${fallback}/api/photos/gtk/test.webp?v=1`);
            expect(resolve('/api/photos/student/test.webp')).toBe(`${fallback}/api/photos/student/test.webp`);
            expect(resolve('https://images.example.test/photo.webp')).toBe('https://images.example.test/photo.webp');
        });
    });

    describe('2. Integrasi Antarmuka di js/global.js', () => {
        test('global.js mengimpor resolvePhotoUrl dari config.js', () => {
            expect(globalSource).toContain('resolvePhotoUrl');
            expect(globalSource).toMatch(/import\s*\{[^}]*resolvePhotoUrl[^}]*\}\s*from\s*['"]\.\/config\.js['"]/);
        });

        test('initLayout me-resolve cachedPhoto', () => {
            expect(globalSource).toContain('resolvePhotoUrl(rawCachedPhoto)');
        });

        test('updateUIAvatars me-resolve photoUrl', () => {
            expect(globalSource).toContain('resolvePhotoUrl(photoUrl)');
        });

        test('openEditProfile me-resolve currentPhotoUrl', () => {
            expect(globalSource).toContain('resolvePhotoUrl(rawPhotoUrl)');
        });

        test('Modal Edit Profil memiliki fallback onerror pada profile-photo-preview-img', () => {
            expect(globalSource).toContain('profile-photo-preview-img');
            expect(globalSource).toContain('profile-photo-preview-placeholder');
            expect(globalSource).toContain("document.getElementById('profile-photo-preview-placeholder')?.classList.remove('hidden')");
        });

        test('saveEditProfile menyimpan resolvedUrl ke localStorage dan memanggil updateUIAvatars', () => {
            expect(globalSource).toContain('resolvePhotoUrl(photoRes.foto_url)');
        });

        test('syncSidebarUserFromDb me-resolve fotoUrl', () => {
            expect(globalSource).toContain('resolvePhotoUrl(rawFotoUrl)');
        });
    });

    describe('3. Integrasi Halaman Master GTK (js/page-gtk.js)', () => {
        test('page-gtk.js mengimpor resolvePhotoUrl dari config.js', () => {
            expect(gtkSource).toMatch(/import\s*\{[^}]*resolvePhotoUrl[^}]*\}\s*from\s*['"]\.\/config\.js['"]/);
        });

        test('Tabel GTK menggunakan resolvePhotoUrl untuk tag avatar', () => {
            expect(gtkSource).toContain('resolvePhotoUrl(t.foto || t.photo_url)');
        });

        test('Modal detail dan edit GTK menggunakan resolvePhotoUrl', () => {
            expect(gtkSource).toContain('resolvePhotoUrl(t.foto || t.photo_url || \'\')');
        });
    });

    describe('4. Integrasi Kartu Pelajar (js/student-card-renderer.js)', () => {
        test('StudentCardRenderer menggunakan resolvePhotoUrl saat normalisasi data foto', () => {
            expect(studentCardSource).toContain('resolvePhotoUrl');
        });
    });

    describe('5. Backend Worker Response', () => {
        test('Worker upload endpoint mengembalikan URL absolut dengan origin request', () => {
            expect(workerSource).toContain('const fullPhotoUrl = `${requestOrigin}${photoUrl}`;');
            expect(workerSource).toContain('foto_url: fullPhotoUrl');
            expect(workerSource).toContain('photo_url: fullPhotoUrl');
            expect(workerSource).toContain('photo_path: photoUrl');
        });
    });

    describe('6. Konsistensi Versi Aplikasi SSOT', () => {
        test('package.json dan js/config.js sinkron dengan versi aplikasi', () => {
            expect(configSource).toContain(`export const APP_VERSION = "${pkg.version}";`);
        });
    });
});

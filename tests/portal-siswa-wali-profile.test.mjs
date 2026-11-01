import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

describe('Profil Wali Kelas & Guru Wali di Portal Siswa (portal-siswa.html)', () => {
    const portalHtmlPath = path.join(projectRoot, 'portal-siswa.html');
    const portalJsPath = path.join(projectRoot, 'js', 'page-portal-siswa.js');
    const workerJsPath = path.join(projectRoot, 'cloudflare', 'worker.js');

    const portalHtml = fs.readFileSync(portalHtmlPath, 'utf8');
    const portalJs = fs.readFileSync(portalJsPath, 'utf8');
    const workerJs = fs.readFileSync(workerJsPath, 'utf8');

    test('1. portal-siswa.html memiliki elemen avatar foto dan thumbnail footer untuk kedua wali', () => {
        // Avatar Card Wali Kelas & Guru Wali
        expect(portalHtml).toContain('id="info-wali-kelas-avatar"');
        expect(portalHtml).toContain('id="info-guru-wali-avatar"');

        // Footer Thumbnails
        expect(portalHtml).toContain('id="foto-wali-kelas-thumb"');
        expect(portalHtml).toContain('id="foto-guru-wali-thumb"');

        // Memastikan elemen penting eksisting tetap dipertahankan
        expect(portalHtml).toContain('id="info-wali-kelas-name"');
        expect(portalHtml).toContain('id="info-wali-kelas-sub"');
        expect(portalHtml).toContain('id="info-wali-kelas-action"');
        expect(portalHtml).toContain('id="info-guru-wali-name"');
        expect(portalHtml).toContain('id="info-guru-wali-sub"');
        expect(portalHtml).toContain('id="info-guru-wali-action"');
        expect(portalHtml).toContain('id="nama-wali-kelas"');
        expect(portalHtml).toContain('id="nama-guru-wali"');
    });

    test('2. portal-siswa.html menyertakan Lightbox Modal pratinjau pasfoto guru', () => {
        expect(portalHtml).toContain('id="modal-preview-teacher-photo"');
        expect(portalHtml).toContain('id="preview-teacher-photo-img"');
        expect(portalHtml).toContain('id="preview-teacher-photo-role"');
        expect(portalHtml).toContain('id="preview-teacher-photo-name"');
        expect(portalHtml).toContain('id="preview-teacher-photo-sub"');
        expect(portalHtml).toContain('window.closeTeacherPhotoModal()');
    });

    test('3. page-portal-siswa.js mengimpor resolvePhotoUrl dan menangani ekstraksi foto', () => {
        // Import check
        expect(portalJs).toMatch(/import\s*\{[^}]*resolvePhotoUrl[^}]*\}\s*from\s*['"]\.\/config\.js['"]/);

        // Ekstraksi foto & nip pada getOrFetchWaliKelasInfo
        expect(portalJs).toContain('foto = result?.foto');
        expect(portalJs).toContain('getGtk({ search: name, limit: 1 })');

        // Ekstraksi foto & nip pada getOrFetchGuruWaliAssignment
        expect(portalJs).toContain('foto = gtkList[0].foto');
        expect(portalJs).toContain('foto: foto');
    });

    test('4. page-portal-siswa.js merender avatar dan thumbnail guru secara responsif', () => {
        expect(portalJs).toContain('renderTeacherAvatar(cardWaliKelasAvatarEl');
        expect(portalJs).toContain('renderTeacherThumb(footerWaliKelasThumbEl');
        expect(portalJs).toContain('renderTeacherAvatar(cardGuruWaliAvatarEl');
        expect(portalJs).toContain('renderTeacherThumb(footerGuruWaliThumbEl');
        expect(portalJs).toContain('window.previewTeacherPhoto');
        expect(portalJs).toContain('window.closeTeacherPhotoModal');
    });

    test('5. cloudflare/worker.js menyertakan foto dan nip pada getAdminUserContact dan endpoint homeroom-contact', () => {
        // Query D1 GTK
        expect(workerJs).toMatch(/SELECT\s+name,\s*phone,\s*nip,\s*foto,\s*telegram_chat_id/i);
        expect(workerJs).toContain('profile.foto = teacherRow.foto');
        expect(workerJs).toContain('profile.nip = teacherRow.nip');

        // Respons JSON homeroom-contact
        expect(workerJs).toContain('nip: homeroom.nip || ""');
        expect(workerJs).toContain('foto: homeroom.foto || ""');
    });

    test('6. Proteksi XSS (ASVS Compliance): skrip berbahaya javascript: diblokir pada URL foto', () => {
        expect(portalJs).toContain("!resolvedPhoto.startsWith('javascript:')");
        expect(portalJs).toContain("!decodedPhoto.startsWith('javascript:')");
    });
});

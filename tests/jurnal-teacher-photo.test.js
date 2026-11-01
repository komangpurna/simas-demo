const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Integrasi Foto Profil GTK Resmi pada Identitas Pengajar Jurnal Mengajar (Scan QR)', () => {
    const rootDir = path.resolve(__dirname, '..');
    const workerPath = path.join(rootDir, 'cloudflare/worker.js');
    const jurnalHtmlPath = path.join(rootDir, 'jurnal.html');
    const pageJurnalPath = path.join(rootDir, 'js/page-jurnal.js');

    const workerCode = fs.readFileSync(workerPath, 'utf8');
    const jurnalHtml = fs.readFileSync(jurnalHtmlPath, 'utf8');
    const pageJurnalJs = fs.readFileSync(pageJurnalPath, 'utf8');

    describe('1. Backend Cloudflare Worker SSOT Query (/api/jurnal/master)', () => {
        test('Query SQL teachersStmt pada GET /api/jurnal/master menyertakan kolom foto dari tabel gtk', () => {
            expect(workerCode).toContain('foto, foto AS photo_url');
            expect(workerCode).toContain('FROM gtk');
            expect(workerCode).toContain("WHERE status = 'active'");
        });
    });

    describe('2. DOM Markup Identitas Pengajar (jurnal.html)', () => {
        test('Menyertakan elemen kartu pratinjau avatar pengajar teacher-profile-preview', () => {
            expect(jurnalHtml).toContain('id="teacher-profile-preview"');
            expect(jurnalHtml).toContain('id="teacher-avatar-display"');
            expect(jurnalHtml).toContain('id="teacher-display-name"');
            expect(jurnalHtml).toContain('id="teacher-display-sub"');
            expect(jurnalHtml).toContain('id="teacher-role-badge"');
            expect(jurnalHtml).toContain('id="teacher-card-status-badge"');
        });

        test('Script page-jurnal.js dimuat dengan query string cache busting yang selaras', () => {
            const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
            expect(jurnalHtml).toContain(`src="js/page-jurnal.js?v=${pkg.version}"`);
        });
    });

    describe('3. Helper Avatar & Keamanan OWASP Anti-XSS (js/page-jurnal.js)', () => {
        let sandbox;

        beforeEach(() => {
            sandbox = {
                window: {},
                document: {
                    getElementById: jest.fn()
                },
                resolvePhotoUrl: (url) => {
                    if (!url) return '';
                    if (url.startsWith('/api/')) return `https://simas-smagesa-api.komangpurna1.workers.dev${url}`;
                    return url;
                }
            };

            // Jalankan fungsi getTeacherInitials dan renderTeacherJournalAvatar di VM
            const initialsMatch = pageJurnalJs.match(/function getTeacherInitials\([\s\S]*?\n\}/);
            const avatarMatch = pageJurnalJs.match(/function renderTeacherJournalAvatar\([\s\S]*?\n\}/);

            expect(initialsMatch).toBeTruthy();
            expect(avatarMatch).toBeTruthy();

            vm.createContext(sandbox);
            vm.runInContext(`
                function escapeHTML(str) {
                    if (!str) return '';
                    return String(str)
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;')
                        .replace(/'/g, '&#039;');
                }
                ${initialsMatch[0]}
                ${avatarMatch[0]}
                this.getTeacherInitials = getTeacherInitials;
                this.renderTeacherJournalAvatar = renderTeacherJournalAvatar;
            `, sandbox);
        });

        test('getTeacherInitials menghasilkan monogram inisial 2 huruf tanpa gelar akademik', () => {
            expect(sandbox.getTeacherInitials('I Komang Purna, S.Pd.')).toBe('IK');
            expect(sandbox.getTeacherInitials('Drs. I Gede Sukadana, M.Pd.')).toBe('IG');
            expect(sandbox.getTeacherInitials('Ni Wayan Widiastuti')).toBe('NW');
            expect(sandbox.getTeacherInitials('Tim BK')).toBe('BK');
        });

        test('renderTeacherJournalAvatar menghasilkan HTML img yang aman dengan fallback inisial', () => {
            const htmlWithPhoto = sandbox.renderTeacherJournalAvatar('/api/photos/gtk/sample.webp', 'I Komang Purna, S.Pd.', 'lg');
            expect(htmlWithPhoto).toContain('<img src="https://simas-smagesa-api.komangpurna1.workers.dev/api/photos/gtk/sample.webp"');
            expect(htmlWithPhoto).toContain('onerror=');
            expect(htmlWithPhoto).toContain('IK'); // Fallback monogram siap pakai saat offline/error

            const htmlNoPhoto = sandbox.renderTeacherJournalAvatar('', 'Ni Wayan Widiastuti', 'sm');
            expect(htmlNoPhoto).not.toContain('<img');
            expect(htmlNoPhoto).toContain('NW');
        });

        test('renderTeacherJournalAvatar menolak skema URL berbahaya (XSS prevention)', () => {
            const maliciousUrl = 'javascript:alert("hacked")';
            const html = sandbox.renderTeacherJournalAvatar(maliciousUrl, 'Hacker', 'sm');
            expect(html).not.toContain('javascript:');
            expect(html).toContain('HA'); // Langsung fallback monogram aman
        });
    });

    describe('4. Integrasi Dropdown & Sinkronisasi Pratinjau Guru', () => {
        test('renderGuruDropdown menyertakan renderTeacherJournalAvatar untuk setiap item guru dengan fallback foto GTK', () => {
            expect(pageJurnalJs).toContain('tFoto = `/api/photos/gtk/${tId}.webp`;');
            expect(pageJurnalJs).toContain('const avatarMini = renderTeacherJournalAvatar(tFoto, t.nama || t.name, \'sm\', tId);');
            expect(pageJurnalJs).toContain('${avatarMini}');
        });

        test('Fungsi updateTeacherPhotoPreview didefinisikan dan dipasang ke window', () => {
            expect(pageJurnalJs).toContain('function updateTeacherPhotoPreview(teacherName)');
            expect(pageJurnalJs).toContain('window.updateTeacherPhotoPreview = updateTeacherPhotoPreview;');
        });

        test('updateTeacherPhotoPreview dipanggil saat auto-detection jadwal KBM dan saat selectGuru', () => {
            expect(pageJurnalJs).toContain('updateTeacherPhotoPreview(selectedGuruName);');
            expect(pageJurnalJs).toContain('updateTeacherPhotoPreview(name);');
            expect(pageJurnalJs).toContain('updateTeacherPhotoPreview(docData.guru);');
        });

        test('subDisplay pada kartu Identitas Pengajar tidak menyertakan info Mapel', () => {
            expect(pageJurnalJs).not.toContain('subDisplay.textContent = `${nip} • Mapel: ${mapelVal}`;');
            expect(pageJurnalJs).not.toContain('subDisplay.textContent = `Mapel: ${mapelVal}`;');
            expect(pageJurnalJs).toContain('subDisplay.textContent = nip;');
        });
    });
});

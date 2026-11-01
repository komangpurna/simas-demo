const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Integrasi Foto Profil Guru pada Popup Sukses Simpan Jurnal (jurnal.html & page-jurnal.js)', () => {
    const rootDir = path.resolve(__dirname, '..');
    const jurnalHtmlPath = path.join(rootDir, 'jurnal.html');
    const pageJurnalPath = path.join(rootDir, 'js/page-jurnal.js');

    const jurnalHtml = fs.readFileSync(jurnalHtmlPath, 'utf8');
    const pageJurnalJs = fs.readFileSync(pageJurnalPath, 'utf8');

    describe('1. DOM & Style Markup (jurnal.html)', () => {
        test('Mempertahankan animasi centang/logo dan menempatkan identitas setelah judul', () => {
            expect(jurnalHtml).toContain('animation: checkIn 3s ease forwards');
            expect(jurnalHtml).toContain('animation: logoAppear 0.6s ease forwards 2.8s, logoFloat 3s ease-in-out infinite 3.4s');
            expect(jurnalHtml.indexOf('id="popup-teacher"')).toBeGreaterThan(jurnalHtml.indexOf('id="popup-title"'));
            expect(jurnalHtml.indexOf('id="popup-teacher"')).toBeLessThan(jurnalHtml.indexOf('id="popup-message"'));
        });

        test('Script page-jurnal.js dimuat dengan versi sinkron', () => {
            const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
            expect(jurnalHtml).toContain(`src="js/page-jurnal.js?v=${pkg.version}"`);
        });
    });

    describe('2. Logika Script & Avatar Helper (js/page-jurnal.js)', () => {
        let sandbox;

        beforeEach(() => {
            const elements = new Map();
            sandbox = {
                window: {},
                document: {
                    getElementById: jest.fn((id) => {
                        if (!elements.has(id)) elements.set(id, {
                            id,
                            classList: {
                                add: jest.fn(),
                                remove: jest.fn()
                            },
                            innerHTML: '',
                            textContent: '',
                            onclick: null
                        });
                        return elements.get(id);
                    })
                },
                resolvePhotoUrl: (url) => {
                    if (!url) return '';
                    if (url.startsWith('/api/')) return `https://simas-smagesa-api.komangpurna1.workers.dev${url}`;
                    return url;
                },
                activeTeachers: [
                    { id: 'GTK001', nama: 'I Komang Purna, S.Pd.', foto: '/api/photos/gtk/GTK001.webp', nip: '198501012010011001', role: 'guru_mapel' },
                    { id: 'GTK002', nama: 'Ni Wayan Widiastuti', foto: '', nip: '199002022015022002', role: 'wali_kelas' },
                    { id: 'TIM_BK', nama: 'Tim BK', foto: '', nip: '', role: 'guru_bk' }
                ],
                safeRenderLucide: jest.fn()
            };

            const escapeMatch = pageJurnalJs.match(/function escapeHTML\([\s\S]*?\n\}/);
            const initialsMatch = pageJurnalJs.match(/function getTeacherInitials\([\s\S]*?\n\}/);
            const avatarMatch = pageJurnalJs.match(/function renderTeacherJournalAvatar\([\s\S]*?\n\}/);
            const profileMatch = pageJurnalJs.match(/function getTeacherProfile\([\s\S]*?\n\}/);

            expect(escapeMatch).toBeTruthy();
            expect(initialsMatch).toBeTruthy();
            expect(avatarMatch).toBeTruthy();
            expect(profileMatch).toBeTruthy();

            vm.createContext(sandbox);
            vm.runInContext(`
                ${escapeMatch[0]}
                ${initialsMatch[0]}
                ${avatarMatch[0]}
                ${profileMatch[0]}
                ${pageJurnalJs.match(/window.showPopup = function[\s\S]*?\n\}/)[0]}
                this.escapeHTML = escapeHTML;
                this.getTeacherInitials = getTeacherInitials;
                this.renderTeacherJournalAvatar = renderTeacherJournalAvatar;
                this.getTeacherProfile = getTeacherProfile;
            `, sandbox);
        });

        test('renderTeacherJournalAvatar memakai foto popup 56px', () => {
            const html = sandbox.renderTeacherJournalAvatar('/api/photos/gtk/GTK001.webp', 'I Komang Purna, S.Pd.', 'popup');
            expect(html).toContain('w-14 h-14');
            expect(html).toContain('min-w-[56px]');
            expect(html).toContain('text-base');
            expect(html).toContain('https://simas-smagesa-api.komangpurna1.workers.dev/api/photos/gtk/GTK001.webp');
        });

        test('getTeacherProfile menemukan guru yang cocok dan menghasilkan photoUrl serta nama resmi', () => {
            const profile = sandbox.getTeacherProfile('I Komang Purna, S.Pd.');
            expect(profile).toBeTruthy();
            expect(profile.displayName).toBe('I Komang Purna, S.Pd.');
            expect(profile.teacherId).toBe('GTK001');
            expect(profile.photoUrl).toBe('/api/photos/gtk/GTK001.webp');
            expect(profile.nip).toContain('198501012010011001');
        });

        test('getTeacherProfile menghasilkan photoUrl fallback otomatis jika foto belum terisi', () => {
            const profile = sandbox.getTeacherProfile('Ni Wayan Widiastuti');
            expect(profile).toBeTruthy();
            expect(profile.photoUrl).toBe('/api/photos/gtk/GTK002.webp');
        });

        test('showPopup menampilkan foto di identitas sambil tetap menjalankan centang/logo asli', () => {
            const teacherProfile = sandbox.getTeacherProfile('I Komang Purna, S.Pd.');
            sandbox.window.showPopup('success', 'Berhasil!', 'Jurnal berhasil disimpan.', null, false, { teacherProfile });
            const icon = sandbox.document.getElementById('popup-icon');
            const teacher = sandbox.document.getElementById('popup-teacher');
            expect(icon.innerHTML).toContain('morph-icon-check');
            expect(icon.innerHTML).toContain('morph-icon-logo');
            expect(icon.innerHTML).not.toContain('GTK001.webp');
            expect(teacher.innerHTML).toContain('GTK001.webp');
            expect(teacher.innerHTML).toContain('Terima kasih');
            expect(teacher.innerHTML).toContain('I Komang Purna, S.Pd.');
            expect(teacher.classList.remove).toHaveBeenCalledWith('hidden');

            sandbox.window.showPopup('success', 'Berhasil!', 'Pesan umum.');
            expect(teacher.innerHTML).toBe('');
            expect(teacher.classList.add).toHaveBeenCalledWith('hidden');
            expect(icon.innerHTML).toContain('morph-icon-logo');
        });

        test('proceedSubmit meneruskan teacherProfile ke showPopup saat sukses simpan jurnal', () => {
            expect(pageJurnalJs).toContain('const teacherProfile = typeof getTeacherProfile === \'function\' ? getTeacherProfile(guru) : null;');
            expect(pageJurnalJs).toContain("showPopup('success', 'Berhasil! 🎉', finalMessage, () => location.reload(), false, { teacherProfile, teacherName: guru });");
        });

        test('Simulasi render avatar di popup aman dari skema script berbahaya (Anti-XSS)', () => {
            const maliciousName = '<script>alert("XSS")</script>';
            const maliciousUrl = 'javascript:alert(1)';
            const html = sandbox.renderTeacherJournalAvatar(maliciousUrl, maliciousName, 'popup');

            expect(html).not.toContain('<script>');
            expect(html).not.toContain('javascript:alert(1)');
            expect(html).toContain('&lt;script&gt;');
        });
    });
});

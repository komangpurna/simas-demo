const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Dana Sosial Suka Duka - Integrasi Pasfoto Resmi Guru GTK & Buku Kas Anggota', () => {
    const rootDir = path.resolve(__dirname, '..');
    const sukaDukaJsPath = path.join(rootDir, 'sukaduka/suka-duka.js');
    const sukaDukaHtmlPath = path.join(rootDir, 'sukaduka/suka-duka.html');
    const packageJsonPath = path.join(rootDir, 'package.json');
    const configJsPath = path.join(rootDir, 'js/config.js');

    let sukaDukaJsCode;
    let sukaDukaHtmlCode;
    let renderTeacherAvatarHTML;

    beforeAll(() => {
        sukaDukaJsCode = fs.readFileSync(sukaDukaJsPath, 'utf8');
        sukaDukaHtmlCode = fs.readFileSync(sukaDukaHtmlPath, 'utf8');

        // Setup sandbox VM untuk mengeksekusi fungsi helper renderTeacherAvatarHTML
        const sandbox = {
            window: {
                escapeHTML: (str) => {
                    if (!str) return '';
                    return String(str)
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;')
                        .replace(/'/g, '&#039;');
                }
            },
            escapeHTML: (str) => {
                if (!str) return '';
                return String(str)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#039;');
            },
            resolvePhotoUrl: (url) => {
                if (!url) return '';
                if (url.startsWith('/api/')) return `https://simas-smagesa-api.komangpurna1.workers.dev${url}`;
                return url;
            }
        };

        const avatarMatch = sukaDukaJsCode.match(/export function renderTeacherAvatarHTML\([\s\S]*?\n\}/);
        expect(avatarMatch).toBeTruthy();

        const cleanAvatarCode = avatarMatch[0].replace('export function', 'function');

        vm.createContext(sandbox);
        vm.runInContext(`${cleanAvatarCode}\nthis.renderTeacherAvatarHTML = renderTeacherAvatarHTML;`, sandbox);
        renderTeacherAvatarHTML = sandbox.renderTeacherAvatarHTML;
    });

    describe('1. Helper Generator Avatar Guru (renderTeacherAvatarHTML)', () => {
        test('merender tag img dengan URL ter-resolve saat guru memiliki foto', () => {
            const teacher = {
                name: 'I Komang Purna, S.Pd.',
                nip: '198801012015011001',
                foto: '/api/photos/gtk/purna.webp'
            };
            const html = renderTeacherAvatarHTML(teacher, 'w-8 h-8', 'rounded-full');
            expect(html).toContain('<img src="https://simas-smagesa-api.komangpurna1.workers.dev/api/photos/gtk/purna.webp"');
            expect(html).toContain('alt="I Komang Purna, S.Pd."');
            expect(html).toContain('w-8 h-8 rounded-full');
            expect(html).toContain('onerror=');
        });

        test('merender monogram inisial bergradien saat guru tidak memiliki foto', () => {
            const teacher = {
                name: 'Dewi Lestari, S.Pd.',
                nip: '199202022020012002',
                foto: null
            };
            const html = renderTeacherAvatarHTML(teacher, 'w-10 h-10', 'rounded-2xl');
            expect(html).not.toContain('<img');
            expect(html).toContain('D');
            expect(html).toContain('bg-gradient-to-tr from-indigo-600 to-violet-500');
            expect(html).toContain('w-10 h-10 rounded-2xl');
        });

        test('menangani nama kosong atau objek teacher null secara aman', () => {
            const htmlNull = renderTeacherAvatarHTML(null);
            expect(htmlNull).toContain('G');

            const htmlEmptyName = renderTeacherAvatarHTML({ name: '' });
            expect(htmlEmptyName).toContain('G');
        });
    });

    describe('2. Kepatuhan Keamanan OWASP ASVS Level 2', () => {
        test('memblokir dan menolak skema berbahaya javascript: pada URL foto', () => {
            const teacherMalicious = {
                name: 'Hacker Name',
                foto: 'javascript:alert(document.cookie)'
            };
            const html = renderTeacherAvatarHTML(teacherMalicious);
            expect(html).not.toContain('<img');
            expect(html).not.toContain('javascript:alert');
            expect(html).toContain('H');
        });

        test('melakukan sanitasi HTML escaping pada nama guru untuk mencegah XSS', () => {
            const teacherXSS = {
                name: '<script>alert("xss")</script>Guru Cerdas',
                foto: null
            };
            const html = renderTeacherAvatarHTML(teacherXSS);
            expect(html).not.toContain('<script>');
            expect(html).not.toContain('&lt;script&gt;');
        });
    });

    describe('3. Integritas Struktur DOM suka-duka.html', () => {
        test('memiliki kontainer avatar profil personal (#guru-profile-avatar-container)', () => {
            expect(sukaDukaHtmlCode).toContain('id="guru-profile-avatar-container"');
        });

        test('memiliki kontainer avatar guru terpilih di kasir (#info-guru-avatar-container)', () => {
            expect(sukaDukaHtmlCode).toContain('id="info-guru-avatar-container"');
        });

        test('memiliki banner header buku kas anggota (#sukaduka-member-header) dengan kontainer avatar (#card-guru-avatar-container) berukuran 48px', () => {
            expect(sukaDukaHtmlCode).toContain('id="sukaduka-member-header"');
            expect(sukaDukaHtmlCode).toContain('id="card-guru-avatar-container"');
            expect(sukaDukaHtmlCode).toContain('w-12 h-12');
            expect(sukaDukaHtmlCode).toContain('width: 48px; height: 48px;');
            expect(sukaDukaHtmlCode).toContain('id="card-guru-name"');
            expect(sukaDukaHtmlCode).toContain('id="card-guru-nip"');
            expect(sukaDukaHtmlCode).toContain('id="card-guru-rate-badge"');
        });

        test('memiliki cache buster versi mutakhir pada pemuatan suka-duka.js', () => {
            const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            expect(sukaDukaHtmlCode).toContain(`suka-duka.js?v=${pkg.version}`);
        });
    });

    describe('4. Integritas Logika Kode suka-duka.js', () => {
        test('mengimpor resolvePhotoUrl dari config.js', () => {
            expect(sukaDukaJsCode).toContain("import { auth, db, PATHS, supabase, SCHOOL_CONFIG, resolvePhotoUrl } from '../js/config.js'");
        });

        test('menampilkan foto profil pada kartu identitas profil guru login (identifyCurrentGuru)', () => {
            expect(sukaDukaJsCode).toContain("document.getElementById('guru-profile-avatar-container')");
            expect(sukaDukaJsCode).toContain("profileAvatarEl.innerHTML = renderTeacherAvatarHTML(currentLoggedGuru");
        });

        test('menampilkan foto profil pada autocomplete kasir (renderTeacherDropdown)', () => {
            expect(sukaDukaJsCode).toContain("const avatarMini = renderTeacherAvatarHTML(t, 'w-7 h-7', 'rounded-full');");
        });

        test('menampilkan foto profil pada kartu buku kas anggota (selectGuruForPayment)', () => {
            expect(sukaDukaJsCode).toContain("document.getElementById('card-guru-avatar-container')");
            expect(sukaDukaJsCode).toContain("cardGuruAvatarContainer.innerHTML = renderTeacherAvatarHTML(teacherObj");
            expect(sukaDukaJsCode).toContain("document.getElementById('info-guru-avatar-container')");
        });

        test('menampilkan foto profil pada tabel pembayaran terkini (refreshRecentPayments)', () => {
            expect(sukaDukaJsCode).toContain("allTeachers.find(t => String(t.id) === String(i.guru_id)");
            expect(sukaDukaJsCode).toContain("renderTeacherAvatarHTML(teacherObj, 'w-7 h-7', 'rounded-full')");
        });

        test('menampilkan foto profil pada laporan bulanan dan rekap tunggakan (refreshLaporanIuran)', () => {
            expect(sukaDukaJsCode).toContain("renderTeacherAvatarHTML(t, 'w-7 h-7', 'rounded-full')");
            expect(sukaDukaJsCode).toContain("renderTeacherAvatarHTML(t, 'w-6 h-6', 'rounded-full')");
        });

        test('menampilkan foto profil pada mutasi kas penerima santunan (renderMutasiTeacherDropdown)', () => {
            expect(sukaDukaJsCode).toContain("renderTeacherAvatarHTML(t, 'w-6 h-6', 'rounded-full')");
        });
    });

    describe('5. Sinkronisasi Versi Aplikasi Harian', () => {
        test('package.json mencatat versi berformat valid YY.MM.DD.REV', () => {
            const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            expect(pkg.version).toMatch(/^\d{2}\.\d{2}\.\d{2}\.\d+$/);
        });

        test('config.js mengekspor APP_VERSION yang tersinkronisasi', () => {
            const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            const configCode = fs.readFileSync(configJsPath, 'utf8');
            expect(configCode).toContain(`export const APP_VERSION = "${pkg.version}";`);
        });
    });
});

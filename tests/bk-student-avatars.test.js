const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Ruang BK - Integrasi Avatar Pasfoto Siswa & OWASP Security', () => {
    const rootDir = path.resolve(__dirname, '..');
    const pageBkPath = path.join(rootDir, 'js/page-bk.js');
    const bkHtmlPath = path.join(rootDir, 'bk.html');
    const workerPath = path.join(rootDir, 'cloudflare/worker.js');

    let pageBkCode;
    let getStudentInitials;
    let renderStudentBkAvatar;

    beforeAll(() => {
        pageBkCode = fs.readFileSync(pageBkPath, 'utf8');

        // Setup sandbox VM untuk menguji helper murni getStudentInitials dan renderStudentBkAvatar
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
            resolvePhotoUrl: (url) => {
                if (!url) return '';
                if (url.startsWith('/api/')) return `https://simas-smagesa-api.komangpurna1.workers.dev${url}`;
                return url;
            }
        };

        // Ekstrak kode helper getStudentInitials dan renderStudentBkAvatar dari page-bk.js
        const initialsMatch = pageBkCode.match(/export function getStudentInitials\([\s\S]*?\n\}/);
        const avatarMatch = pageBkCode.match(/export function renderStudentBkAvatar\([\s\S]*?\n\}/);

        expect(initialsMatch).toBeTruthy();
        expect(avatarMatch).toBeTruthy();

        const cleanInitialsCode = initialsMatch[0].replace('export function', 'function');
        const cleanAvatarCode = avatarMatch[0].replace('export function', 'function');

        vm.createContext(sandbox);
        vm.runInContext(`${cleanInitialsCode}\n${cleanAvatarCode}\nthis.getStudentInitials = getStudentInitials;\nthis.renderStudentBkAvatar = renderStudentBkAvatar;`, sandbox);

        getStudentInitials = sandbox.getStudentInitials;
        renderStudentBkAvatar = sandbox.renderStudentBkAvatar;
    });

    describe('1. Logika Inisial Siswa (getStudentInitials)', () => {
        test('menghasilkan 2 huruf inisial dari nama 2 kata', () => {
            expect(getStudentInitials('Budi Santoso')).toBe('BS');
            expect(getStudentInitials('Ni Kadek')).toBe('NK');
        });

        test('menghasilkan 2 huruf inisial pertama dari nama multi kata', () => {
            expect(getStudentInitials('I Komang Purna')).toBe('IK');
            expect(getStudentInitials('Ni Luh Putu Ayu')).toBe('NL');
        });

        test('menghasilkan 2 huruf awal jika nama hanya 1 kata', () => {
            expect(getStudentInitials('Sujana')).toBe('SU');
            expect(getStudentInitials('Adi')).toBe('AD');
        });

        test('fallback "S" jika nama kosong, null, atau tidak valid', () => {
            expect(getStudentInitials('')).toBe('S');
            expect(getStudentInitials(null)).toBe('S');
            expect(getStudentInitials(undefined)).toBe('S');
        });
    });

    describe('2. Helper Render Avatar Pasfoto Siswa (renderStudentBkAvatar)', () => {
        test('merender elemen img dengan URL teresolusi saat foto tersedia', () => {
            const student = {
                nis: '10234',
                name: 'I Komang Purna',
                class: 'XII-A',
                activePhotoUrl: '/api/photos/student/active/10234.webp'
            };

            const html = renderStudentBkAvatar(student, student.name, { size: 'lg' });
            expect(html).toContain('<img');
            expect(html).toContain('https://simas-smagesa-api.komangpurna1.workers.dev/api/photos/student/active/10234.webp');
            expect(html).toContain('alt="I Komang Purna"');
            expect(html).toContain('w-11 h-11');
            expect(html).toContain('onerror=');
        });

        test('merender fallback monogram inisial saat foto kosong / null', () => {
            const student = {
                nis: '10235',
                name: 'Ni Wayan Sari',
                class: 'XI-B',
                activePhotoUrl: null
            };

            const html = renderStudentBkAvatar(student, student.name, { size: 'md' });
            expect(html).not.toContain('<img');
            expect(html).toContain('NW');
            expect(html).toContain('bg-gradient-to-tr from-blue-600 to-indigo-600');
            expect(html).toContain('w-9 h-9');
        });

        test('mendukung berbagai ukuran presisi (xs, sm, md, lg, xl)', () => {
            const name = 'Test Siswa';
            expect(renderStudentBkAvatar(null, name, { size: 'xs' })).toContain('w-6 h-6');
            expect(renderStudentBkAvatar(null, name, { size: 'sm' })).toContain('w-7 h-7');
            expect(renderStudentBkAvatar(null, name, { size: 'md' })).toContain('w-9 h-9');
            expect(renderStudentBkAvatar(null, name, { size: 'lg' })).toContain('w-11 h-11');
            expect(renderStudentBkAvatar(null, name, { size: 'xl' })).toContain('w-13 h-13');
        });

        test('menyematkan event onclick pratinjau saat clickable = true', () => {
            const student = {
                nis: '10999',
                name: 'Wayan Widia',
                class: 'X-1',
                activePhotoUrl: '/api/photos/student/active/10999.webp'
            };
            const html = renderStudentBkAvatar(student, student.name, { size: 'sm', clickable: true });
            expect(html).toContain('openStudentPhotoPreview');
            expect(html).toContain('10999');
        });
    });

    describe('3. Keamanan OWASP ASVS Level 2 (Anti-XSS)', () => {
        test('menolak dan membersihkan URL berprotokol berbahaya javascript:', () => {
            const maliciousStudent = {
                nis: '99999',
                name: 'Attacker Student',
                class: 'XII-X',
                activePhotoUrl: "javascript:alert('xss')"
            };

            const html = renderStudentBkAvatar(maliciousStudent, maliciousStudent.name);
            expect(html).not.toContain('javascript:');
            // Otomatis fallback ke monogram aman
            expect(html).toContain('AS');
            expect(html).not.toContain('<img');
        });

        test('menolak data:text/html berbahaya', () => {
            const maliciousStudent = {
                nis: '99998',
                name: 'Attacker Two',
                class: 'XII-X',
                activePhotoUrl: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='
            };

            const html = renderStudentBkAvatar(maliciousStudent, maliciousStudent.name);
            expect(html).not.toContain('data:text/html');
            expect(html).not.toContain('<img');
        });

        test('melakukan HTML escaping pada nama siswa', () => {
            const unsafeName = '<img src=x onerror=alert(1)>';
            const html = renderStudentBkAvatar(null, unsafeName);
            expect(html).not.toContain('<img src=x onerror=alert(1)>');
            expect(html).toContain('&lt;img');
        });
    });

    describe('4. Integritas Komponen DOM di bk.html', () => {
        const bkHtml = fs.readFileSync(bkHtmlPath, 'utf8');

        test('bk.html memiliki slot avatar dan kartu profil siswa yang diperbarui', () => {
            expect(bkHtml).toContain('id="student-profile"');
            expect(bkHtml).toContain('id="info-photo-container"');
            expect(bkHtml).toContain('id="info-avatar-slot"');
            expect(bkHtml).toContain('id="info-name"');
            expect(bkHtml).toContain('id="info-class"');
            expect(bkHtml).toContain('id="info-nis"');
            expect(bkHtml).toContain('id="info-points"');
            expect(bkHtml).toContain('id="info-achievement"');
        });

        test('bk.html memiliki slot avatar pada modal detail kasus konseling', () => {
            expect(bkHtml).toContain('id="detail-bk-avatar-slot"');
            expect(bkHtml).toContain('id="detail-bk-name"');
            expect(bkHtml).toContain('id="detail-bk-nis"');
        });

        test('bk.html memiliki modal lightbox pratinjau pasfoto siswa resmi', () => {
            expect(bkHtml).toContain('id="modal-preview-student-photo"');
            expect(bkHtml).toContain('id="preview-student-img"');
            expect(bkHtml).toContain('id="preview-student-fallback"');
            expect(bkHtml).toContain('id="preview-student-initials"');
            expect(bkHtml).toContain('window.closeStudentPhotoPreview()');
        });
    });

    describe('5. Kueri Endpoint Backend Cloudflare Worker (student-context)', () => {
        const workerCode = fs.readFileSync(workerPath, 'utf8');

        test('endpoint student-context melakukan LEFT JOIN ke student_photos', () => {
            expect(workerCode).toContain('path.startsWith("/api/bk-actions/student-context/")');
            expect(workerCode).toContain('LEFT JOIN student_photos sp ON sp.nis = s.nis');
            expect(workerCode).toContain('sp.active_photo_url');
        });
    });
});

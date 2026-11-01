const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Jadwal Pelajaran - Integrasi Avatar Pasfoto Guru & OWASP Security', () => {
    const rootDir = path.resolve(__dirname, '..');
    const pageJadwalPath = path.join(rootDir, 'js/page-jadwal.js');
    const ascParserPath = path.join(rootDir, 'js/asc-schedule-parser.js');
    const jadwalHtmlPath = path.join(rootDir, 'jadwal.html');

    let pageJadwalCode;
    let getTeacherInitials;
    let renderTeacherScheduleAvatar;

    beforeAll(() => {
        pageJadwalCode = fs.readFileSync(pageJadwalPath, 'utf8');

        // Setup sandbox VM untuk mengeksekusi helper murni getTeacherInitials dan renderTeacherScheduleAvatar
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

        // Ekstrak kode helper getTeacherInitials dan renderTeacherScheduleAvatar dari page-jadwal.js
        const initialsMatch = pageJadwalCode.match(/export function getTeacherInitials\([\s\S]*?\n\}/);
        const avatarMatch = pageJadwalCode.match(/export function renderTeacherScheduleAvatar\([\s\S]*?\n\}/);

        expect(initialsMatch).toBeTruthy();
        expect(avatarMatch).toBeTruthy();

        const cleanInitialsCode = initialsMatch[0].replace('export function', 'function');
        const cleanAvatarCode = avatarMatch[0].replace('export function', 'function');

        vm.createContext(sandbox);
        vm.runInContext(`${cleanInitialsCode}\n${cleanAvatarCode}\nthis.getTeacherInitials = getTeacherInitials;\nthis.renderTeacherScheduleAvatar = renderTeacherScheduleAvatar;`, sandbox);

        getTeacherInitials = sandbox.getTeacherInitials;
        renderTeacherScheduleAvatar = sandbox.renderTeacherScheduleAvatar;
    });

    describe('1. Logika Inisial Guru (getTeacherInitials)', () => {
        test('menghasilkan 2 huruf inisial dari nama standar', () => {
            expect(getTeacherInitials('I Komang Purna')).toBe('IK');
            expect(getTeacherInitials('Budi Santoso')).toBe('BS');
            expect(getTeacherInitials('Wayan Suparta')).toBe('WS');
        });

        test('membersihkan gelar akademik umum (Drs, M.Pd, S.Pd, S.T, Gr, Tim, dll)', () => {
            expect(getTeacherInitials('Drs. I Made Wijaya, M.Pd.')).toBe('IM');
            expect(getTeacherInitials('Ni Ketut Sri, S.Pd.')).toBe('NK');
            expect(getTeacherInitials('Dr. Ahmad Yani, M.Si.')).toBe('AY');
            expect(getTeacherInitials('I Gusti Ngurah Rai, S.T., Gr.')).toBe('IG');
            expect(getTeacherInitials('Tim BK')).toBe('BK');
        });

        test('menangani nama 1 kata dengan aman', () => {
            expect(getTeacherInitials('Sukarno')).toBe('SU');
            expect(getTeacherInitials('Haryanto')).toBe('HA');
        });

        test('menangani input kosong atau tidak valid dengan fallback GT', () => {
            expect(getTeacherInitials('')).toBe('GT');
            expect(getTeacherInitials(null)).toBe('GT');
            expect(getTeacherInitials(undefined)).toBe('GT');
        });
    });

    describe('2. Render Avatar Guru (renderTeacherScheduleAvatar)', () => {
        test('merender elemen img jika photoUrl valid dengan fallback hidden', () => {
            const html = renderTeacherScheduleAvatar('/api/photos/gtk/sample-photo.webp', 'I Made Sukadana, S.Pd.', 'sm');

            expect(html).toContain('<img');
            expect(html).toContain('sample-photo.webp');
            expect(html).toContain('loading="lazy"');
            expect(html).toContain('onerror="this.onerror=null;');
            expect(html).toContain('<span>IM</span>');
            expect(html).toContain('w-[22px] h-[22px]');
        });

        test('merender monogram inisial langsung jika foto kosong', () => {
            const html = renderTeacherScheduleAvatar('', 'Ni Wayan Sari', 'sm');

            expect(html).not.toContain('<img');
            expect(html).toContain('bg-gradient-to-tr from-blue-600 to-indigo-600');
            expect(html).toContain('<span>NW</span>');
        });

        test('mematuhi OWASP ASVS Level 2: menolak skema berbahaya (javascript:, data:text/html)', () => {
            const maliciousUrl = 'javascript:alert(document.cookie)';
            const html = renderTeacherScheduleAvatar(maliciousUrl, 'Hacker Teacher', 'sm');

            expect(html).not.toContain('<img');
            expect(html).not.toContain('javascript:');
            expect(html).toContain('<span>HT</span>');
        });

        test('melakukan sanitasi HTML terhadap nama guru pada alt dan title', () => {
            const dangerousName = 'Guru <script>alert("xss")</script>';
            const html = renderTeacherScheduleAvatar('/api/photos/sample.jpg', dangerousName, 'sm');

            expect(html).not.toContain('<script>');
            expect(html).toContain('&lt;script&gt;');
        });

        test('mendukung ukuran avatar xs, sm, md, lg', () => {
            const htmlXS = renderTeacherScheduleAvatar('', 'Guru A', 'xs');
            expect(htmlXS).toContain('w-5 h-5');

            const htmlSM = renderTeacherScheduleAvatar('', 'Guru B', 'sm');
            expect(htmlSM).toContain('w-[22px] h-[22px]');

            const htmlMD = renderTeacherScheduleAvatar('', 'Guru C', 'md');
            expect(htmlMD).toContain('w-7 h-7');

            const htmlLG = renderTeacherScheduleAvatar('', 'Guru D', 'lg');
            expect(htmlLG).toContain('w-11 h-11');
        });
    });

    describe('3. Integrasi pada asc-schedule-parser.js', () => {
        let parserCode;

        beforeAll(() => {
            parserCode = fs.readFileSync(ascParserPath, 'utf8');
        });

        test('menyimpan simasFoto dan foto pada teachersMap', () => {
            expect(parserCode).toContain('simasFoto: matchedSimasTeacher ? (matchedSimasTeacher.foto || \'\') : \'\'');
            expect(parserCode).toContain('foto: matchedSimasTeacher ? (matchedSimasTeacher.foto || \'\') : \'\'');
        });

        test('menyimpan guruFoto pada scheduleMap slot', () => {
            expect(parserCode).toContain('guruFoto: teacherObj ? (teacherObj.simasFoto || \'\') : \'\'');
        });

        test('getAllScheduleTeachers mengembalikan properti foto dan simasFoto', () => {
            expect(parserCode).toContain('foto: t.simasFoto || \'\'');
            expect(parserCode).toContain('simasFoto: t.simasFoto || \'\'');
        });
    });

    describe('4. Integrasi pada UI page-jadwal.js & jadwal.html', () => {
        test('page-jadwal.js mengimpor resolvePhotoUrl dari config.js', () => {
            expect(pageJadwalCode).toMatch(/import\s*\{[^}]*resolvePhotoUrl[^}]*\}\s*from\s*['"]\.\/config\.js['"]/);
        });

        test('renderDesktopClassMatrix menyertakan renderTeacherScheduleAvatar', () => {
            expect(pageJadwalCode).toContain('renderTeacherScheduleAvatar(slot?.guruFoto, guru, \'xs\', slot?.guruId)');
        });

        test('renderMobileClassDayView menyertakan renderTeacherScheduleAvatar', () => {
            expect(pageJadwalCode).toContain('renderTeacherScheduleAvatar(slot?.guruFoto, guru, \'sm\', slot?.guruId)');
        });

        test('renderTeacherDropdownResults menyertakan renderTeacherScheduleAvatar', () => {
            expect(pageJadwalCode).toContain('renderTeacherScheduleAvatar(t.foto || t.simasFoto, t.name, \'sm\', t.simasId)');
        });

        test('renderAllTeachersFreeMatrixHTML menyertakan avatar di tabel desktop dan mobile', () => {
            expect(pageJadwalCode).toContain('renderTeacherScheduleAvatar(t.foto || t.simasFoto, t.name, \'sm\', t.simasId)');
        });

        test('renderFreeTeachersHTML menyertakan avatar di chip guru standby', () => {
            expect(pageJadwalCode).toContain('renderTeacherScheduleAvatar(t.foto || t.simasFoto, t.name, \'xs\', t.simasId)');
        });

        test('jadwal.html menyertakan cache buster versi mutakhir aplikasi', () => {
            const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
            const jadwalHtml = fs.readFileSync(jadwalHtmlPath, 'utf8');
            expect(jadwalHtml).toContain(`js/page-jadwal.js?v=${pkg.version}`);
        });
    });
});

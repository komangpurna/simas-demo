const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Ruang BK - Searchable Combobox Dropdown Pencarian Siswa & Keamanan', () => {
    const rootDir = path.resolve(__dirname, '..');
    const bkHtmlPath = path.join(rootDir, 'bk.html');
    const pageBkPath = path.join(rootDir, 'js/page-bk.js');

    let pageBkCode;
    let filterBkStudents;
    let renderBkStudentDropdownHtml;

    beforeAll(() => {
        pageBkCode = fs.readFileSync(pageBkPath, 'utf8');

        // Setup sandbox VM untuk menguji pure helper filterBkStudents dan renderBkStudentDropdownHtml
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

        const initialsMatch = pageBkCode.match(/export function getStudentInitials\([\s\S]*?\n\}/);
        const avatarMatch = pageBkCode.match(/export function renderStudentBkAvatar\([\s\S]*?\n\}/);
        const filterMatch = pageBkCode.match(/export function filterBkStudents\([\s\S]*?\n\}/);
        const renderDropdownMatch = pageBkCode.match(/export function renderBkStudentDropdownHtml\([\s\S]*?\n\}/);

        expect(initialsMatch).toBeTruthy();
        expect(avatarMatch).toBeTruthy();
        expect(filterMatch).toBeTruthy();
        expect(renderDropdownMatch).toBeTruthy();

        const cleanInitialsCode = initialsMatch[0].replace('export function', 'function');
        const cleanAvatarCode = avatarMatch[0].replace('export function', 'function');
        const cleanFilterCode = filterMatch[0].replace('export function', 'function');
        const cleanRenderDropdownCode = renderDropdownMatch[0].replace('export function', 'function');

        vm.createContext(sandbox);
        vm.runInContext(`
            ${cleanInitialsCode}
            ${cleanAvatarCode}
            ${cleanFilterCode}
            ${cleanRenderDropdownCode}
            this.filterBkStudents = filterBkStudents;
            this.renderBkStudentDropdownHtml = renderBkStudentDropdownHtml;
        `, sandbox);

        filterBkStudents = sandbox.filterBkStudents;
        renderBkStudentDropdownHtml = sandbox.renderBkStudentDropdownHtml;
    });

    describe('1. Integritas DOM Markup di bk.html', () => {
        const bkHtml = fs.readFileSync(bkHtmlPath, 'utf8');

        test('memiliki kontainer pembungkus searchable combobox bk-student-search-container', () => {
            expect(bkHtml).toContain('id="bk-student-search-container"');
            expect(bkHtml).toContain('relative z-40');
        });

        test('memiliki input pencarian student-search dengan autocomplete off dan styling responsif', () => {
            expect(bkHtml).toContain('id="student-search"');
            expect(bkHtml).toContain('placeholder="Ketik nama siswa, NIS, atau kelas..."');
            expect(bkHtml).toContain('autocomplete="off"');
        });

        test('memiliki tombol bersihkan pencarian btn-clear-student-search', () => {
            expect(bkHtml).toContain('id="btn-clear-student-search"');
            expect(bkHtml).toContain('window.clearBkStudentSearch()');
        });

        test('memiliki elemen floating dropdown student-search-dropdown dengan elevasi z-50', () => {
            expect(bkHtml).toContain('id="student-search-dropdown"');
            expect(bkHtml).toContain('absolute left-0 right-0 top-full');
            expect(bkHtml).toContain('z-50');
            expect(bkHtml).toContain('shadow-2xl');
        });

        test('tidak lagi menggunakan datalist HTML5 bawaan yang kaku', () => {
            expect(bkHtml).not.toContain('<datalist id="student-list">');
        });
    });

    describe('2. Logika Filtering Siswa (filterBkStudents)', () => {
        const sampleStudents = [
            { nis: '10201', name: 'I Komang Aditya', class: 'XII-1', violationPoints: 10, achievementPoints: 0 },
            { nis: '10202', name: 'Ni Putu Ayu Pradnya', class: 'XII-1', violationPoints: 0, achievementPoints: 15 },
            { nis: '10305', name: 'I Wayan Budiarta', class: 'XI-2', violationPoints: 25, achievementPoints: 5 },
            { nis: '10410', name: 'Kadek Dwi Santika', class: 'X-3', violationPoints: 0, achievementPoints: 0 }
        ];

        test('mengembalikan semua siswa (hingga batas limit) saat query kosong', () => {
            const res = filterBkStudents(sampleStudents, '');
            expect(res.length).toBe(4);
        });

        test('menyaring siswa berdasarkan nama (case-insensitive)', () => {
            const res = filterBkStudents(sampleStudents, 'aditya');
            expect(res.length).toBe(1);
            expect(res[0].nis).toBe('10201');
        });

        test('menyaring siswa berdasarkan nomor NIS', () => {
            const res = filterBkStudents(sampleStudents, '10305');
            expect(res.length).toBe(1);
            expect(res[0].name).toBe('I Wayan Budiarta');
        });

        test('menyaring siswa berdasarkan kelas / rombel', () => {
            const res = filterBkStudents(sampleStudents, 'XII-1');
            expect(res.length).toBe(2);
        });

        test('mengembalikan array kosong jika tidak ada yang cocok', () => {
            const res = filterBkStudents(sampleStudents, 'TidakAdaNamaIni');
            expect(res.length).toBe(0);
        });
    });

    describe('3. Render Template Dropdown HTML (renderBkStudentDropdownHtml)', () => {
        const sampleStudents = [
            {
                nis: '10201',
                name: 'I Komang Aditya',
                class: 'XII-1',
                violationPoints: 15,
                achievementPoints: 0,
                activePhotoUrl: '/api/photos/student/active/10201.webp'
            },
            {
                nis: '10202',
                name: 'Ni Putu Ayu Pradnya',
                class: 'XII-1',
                violationPoints: 0,
                achievementPoints: 20,
                activePhotoUrl: null
            }
        ];

        test('merender pesan ramah saat daftar siswa kosong', () => {
            const html = renderBkStudentDropdownHtml([], null, 'Zulham');
            expect(html).toContain('Tidak ditemukan siswa dengan kata kunci "Zulham"');
            expect(html).toContain('fa-user-xmark');
        });

        test('merender daftar siswa lengkap dengan avatar, nama, kelas, NIS, dan event onclick', () => {
            const html = renderBkStudentDropdownHtml(sampleStudents, null, '');
            expect(html).toContain('I Komang Aditya');
            expect(html).toContain('XII-1');
            expect(html).toContain('NIS: 10201');
            expect(html).toContain("window.selectStudentFromDropdown('10201')");
            expect(html).toContain("window.selectStudentFromDropdown('10202')");
        });

        test('menampilkan badge poin pelanggaran merah saat violationPoints > 0', () => {
            const html = renderBkStudentDropdownHtml(sampleStudents, null, '');
            expect(html).toContain('bg-red-100');
            expect(html).toContain('15');
            expect(html).toContain('fa-triangle-exclamation');
        });

        test('menampilkan badge poin prestasi hijau saat achievementPoints > 0', () => {
            const html = renderBkStudentDropdownHtml(sampleStudents, null, '');
            expect(html).toContain('bg-emerald-100');
            expect(html).toContain('+20');
            expect(html).toContain('fa-trophy');
        });

        test('menandai siswa aktif terpilih dengan checkmark jika selectedNIS cocok', () => {
            const html = renderBkStudentDropdownHtml(sampleStudents, '10201', '');
            expect(html).toContain('fa-circle-check');
            expect(html).toContain('!bg-blue-50/80');
        });
    });

    describe('4. Keamanan OWASP ASVS Level 2 (Anti-XSS)', () => {
        test('melakukan escaping pada nama siswa dengan muatan serangan script', () => {
            const maliciousStudents = [
                {
                    nis: '99999',
                    name: '<script>alert("xss")</script>',
                    class: '<b>XII-1</b>',
                    violationPoints: 0,
                    achievementPoints: 0,
                    activePhotoUrl: null
                }
            ];

            const html = renderBkStudentDropdownHtml(maliciousStudents, null, '');
            expect(html).not.toContain('<script>');
            expect(html).toContain('&lt;script&gt;');
            expect(html).toContain('&lt;b&gt;XII-1&lt;/b&gt;');
        });

        test('melakukan escaping pada query pencarian kosong/berbahaya pada pesan tidak ditemukan', () => {
            const unsafeQuery = '<img src=x onerror=alert(1)>';
            const html = renderBkStudentDropdownHtml([], null, unsafeQuery);
            expect(html).not.toContain('<img src=x onerror=alert(1)>');
            expect(html).toContain('&lt;img');
        });
    });
});

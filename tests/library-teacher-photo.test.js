const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

describe('Sirkulasi & Presensi Perpustakaan - Verifikasi Visual Pasfoto Guru & Scanner NIP', () => {
    const rootDir = path.resolve(__dirname, '..');
    const indexHtmlPath = path.join(rootDir, 'library/index.html');
    const indexJsPath = path.join(rootDir, 'library/index.js');
    const presensiHtmlPath = path.join(rootDir, 'library/presensi-perpus.html');
    const presensiJsPath = path.join(rootDir, 'library/presensi-perpus.js');

    let indexHtml;
    let indexJs;
    let presensiHtml;
    let presensiJs;

    let getBorrowerInitials;
    let extractBorrowerFromInput;
    let getVisitorInitials;
    let extractVisitorFromInput;
    let resolveBorrowerFromInput;
    let resolveVisitorFromInput;
    const resolvedTokens = [];
    // Kunci token kartu hanya ada di Worker: tes memakai klien palsu untuk /api/students/resolve-card
    const fakeCardClient = {
        async resolveStudentCardToken(token) {
            resolvedTokens.push(token);
            if (token === 'kts_validtoken0000' || token === 'a1b2c3d4e5f60718293a4b5c6d7e8f90abcdef') return { success: true, data: { nis: '12345' } };
            throw new Error('Kartu tidak dikenali atau siswa tidak ditemukan');
        }
    };

    beforeAll(async () => {
        indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
        indexJs = fs.readFileSync(indexJsPath, 'utf8');
        presensiHtml = fs.readFileSync(presensiHtmlPath, 'utf8');
        presensiJs = fs.readFileSync(presensiJsPath, 'utf8');

        const utilsModule = await import('../js/utils.mjs');
        const extractNisFromQrInput = utilsModule.extractNisFromQrInput;
        const extractCardTokenFromQrInput = utilsModule.extractCardTokenFromQrInput;
        const resolveNisFromQrInput = raw => utilsModule.resolveNisFromQrInput(raw, fakeCardClient);

        // Setup sandbox VM untuk test helper murni index.js
        const sandboxIndex = {
            allTeachersCache: [
                { id: 'gtk-1', nip: '197501012000031001', nik: '5107010101750001', nama: 'Dr. I Komang Purna, M.Pd.', jabatan: 'Guru Fisika', foto: 'https://cdn.smagesa.sch.id/photos/guru1.webp' },
                { id: 'gtk-2', nip: '198002022005012002', nik: '5107010202800002', nama: 'Ni Wayan Rai, S.Pd.', jabatan: 'Guru Biologi', foto: null }
            ],
            allStudentsCache: [
                { id: 'stu-1', nis: '12345', nisn: '0012345678', nama: 'I Made Raditya', kelas: 'XII MIPA 1', foto: 'https://cdn.smagesa.sch.id/photos/raditya.webp' }
            ],
            extractNisFromQrInput,
            extractCardTokenFromQrInput,
            resolveNisFromQrInput,
            resolvePhotoUrl: (url) => url || '',
            window: { extractNisFromQrInput }
        };

        const initialsMatch = indexJs.match(/export function getBorrowerInitials\([\s\S]*?\n\}/);
        const extractMatch = indexJs.match(/export function extractBorrowerFromInput\([\s\S]*?\n\}/);
        const resolveMatch = indexJs.match(/export async function resolveBorrowerFromInput\([\s\S]*?\n\}/);
        expect(resolveMatch).toBeTruthy();

        expect(initialsMatch).toBeTruthy();
        expect(extractMatch).toBeTruthy();

        const cleanInitials = initialsMatch[0].replace('export function', 'function');
        const cleanExtract = extractMatch[0].replace('export function', 'function');

        vm.createContext(sandboxIndex);
        vm.runInContext(`${cleanInitials}\n${cleanExtract}\n${resolveMatch[0].replace('export async function', 'async function')}\nthis.getBorrowerInitials = getBorrowerInitials;\nthis.extractBorrowerFromInput = extractBorrowerFromInput;\nthis.resolveBorrowerFromInput = resolveBorrowerFromInput;`, sandboxIndex);

        getBorrowerInitials = sandboxIndex.getBorrowerInitials;
        extractBorrowerFromInput = sandboxIndex.extractBorrowerFromInput;
        resolveBorrowerFromInput = sandboxIndex.resolveBorrowerFromInput;

        // Setup sandbox VM untuk presensi-perpus.js
        const sandboxPresensi = {
            allTeachersCache: sandboxIndex.allTeachersCache,
            allStudentsCache: sandboxIndex.allStudentsCache,
            extractNisFromQrInput,
            extractCardTokenFromQrInput,
            resolveNisFromQrInput,
            resolvePhotoUrl: (url) => url || '',
            window: { extractNisFromQrInput }
        };

        const vInitialsMatch = presensiJs.match(/export function getVisitorInitials\([\s\S]*?\n\}/);
        const vExtractMatch = presensiJs.match(/export function extractVisitorFromInput\([\s\S]*?\n\}/);
        const vResolveMatch = presensiJs.match(/export async function resolveVisitorFromInput\([\s\S]*?\n\}/);
        expect(vResolveMatch).toBeTruthy();

        expect(vInitialsMatch).toBeTruthy();
        expect(vExtractMatch).toBeTruthy();

        const cleanVInitials = vInitialsMatch[0].replace('export function', 'function');
        const cleanVExtract = vExtractMatch[0].replace('export function', 'function');

        vm.createContext(sandboxPresensi);
        vm.runInContext(`${cleanVInitials}\n${cleanVExtract}\n${vResolveMatch[0].replace('export async function', 'async function')}\nthis.getVisitorInitials = getVisitorInitials;\nthis.extractVisitorFromInput = extractVisitorFromInput;\nthis.resolveVisitorFromInput = resolveVisitorFromInput;`, sandboxPresensi);

        getVisitorInitials = sandboxPresensi.getVisitorInitials;
        extractVisitorFromInput = sandboxPresensi.extractVisitorFromInput;
        resolveVisitorFromInput = sandboxPresensi.resolveVisitorFromInput;
    });

    describe('1. Integritas Elemen DOM Visual Verification di HTML', () => {
        test('library/index.html memuat cardlet verifikasi foto peminjam (#peminjam-photo-cardlet)', () => {
            expect(indexHtml).toContain('id="peminjam-photo-cardlet"');
            expect(indexHtml).toContain('id="peminjam-photo-img"');
            expect(indexHtml).toContain('id="peminjam-photo-fallback"');
            expect(indexHtml).toContain('id="peminjam-photo-initials"');
            expect(indexHtml).toContain('id="peminjam-cardlet-name"');
            expect(indexHtml).toContain('id="peminjam-cardlet-badge"');
            expect(indexHtml).toContain('id="peminjam-cardlet-id"');
        });

        test('library/index.html memuat thumbnail foto pada kotak pengembalian peminjam (#return-borrower-photo-thumb)', () => {
            expect(indexHtml).toContain('id="return-borrower-photo-thumb"');
            expect(indexHtml).toContain('id="return-borrower-img"');
            expect(indexHtml).toContain('id="return-borrower-fallback"');
            expect(indexHtml).toContain('id="return-borrower-initials"');
        });

        test('library/presensi-perpus.html memuat cardlet pratinjau pengunjung (#visitor-preview-cardlet)', () => {
            expect(presensiHtml).toContain('id="visitor-preview-cardlet"');
            expect(presensiHtml).toContain('id="visitor-cardlet-img"');
            expect(presensiHtml).toContain('id="visitor-cardlet-fallback"');
            expect(presensiHtml).toContain('id="visitor-cardlet-name"');
            expect(presensiHtml).toContain('id="visitor-cardlet-badge"');
            expect(presensiHtml).toContain('id="btn-reset-visitor-preview"');
        });
    });

    describe('2. Logika Inisial Cerdas & Pembersihan Gelar (getBorrowerInitials & getVisitorInitials)', () => {
        test('menyaring gelar depan (Dr., Drs., dll.) dan belakang (M.Pd., S.Pd.)', () => {
            expect(getBorrowerInitials('Dr. I Komang Purna, M.Pd.')).toBe('IK');
            expect(getBorrowerInitials('Ni Wayan Rai, S.Pd.')).toBe('NW');
            expect(getBorrowerInitials('Budi Santoso')).toBe('BS');
        });

        test('menangani nama tunggal atau fallback aman', () => {
            expect(getBorrowerInitials('Purna')).toBe('PU');
            expect(getBorrowerInitials('')).toBe('P');
            expect(getBorrowerInitials(null)).toBe('P');
        });

        test('getVisitorInitials menghasilkan inisial yang selaras', () => {
            expect(getVisitorInitials('Dr. I Komang Purna, M.Pd.')).toBe('IK');
            expect(getVisitorInitials('I Made Raditya')).toBe('IM');
        });
    });

    describe('3. Fast-Scan Barcode Scanner NIP / NIS Auto-Resolution', () => {
        test('mendeteksi NIP guru dan mengembalikan tipe guru beserta objek lengkap', () => {
            const result = extractBorrowerFromInput('197501012000031001');
            expect(result).not.toBeNull();
            expect(result.type).toBe('guru');
            expect(result.item.nama).toBe('Dr. I Komang Purna, M.Pd.');
            expect(result.item.foto).toBe('https://cdn.smagesa.sch.id/photos/guru1.webp');
        });

        test('mendeteksi NIS siswa dan mengembalikan tipe siswa', () => {
            const result = extractBorrowerFromInput('12345');
            expect(result).not.toBeNull();
            expect(result.type).toBe('siswa');
            expect(result.item.nama).toBe('I Made Raditya');
        });

        test('mendukung input dari barcode scanner berformat URL QR kartu', () => {
            const result = extractBorrowerFromInput('https://smagesa.web.app/kartu-shakti.html?nis=12345');
            expect(result).not.toBeNull();
            expect(result.type).toBe('siswa');
            expect(result.item.nis).toBe('12345');
        });

        test('QR kartu resmi (id=kts_...) diterjemahkan oleh Worker, bukan didekripsi di browser', async () => {
            const qrUrl = 'https://smagesa.web.app/kartu-shakti.html?id=kts_validtoken0000';
            expect(extractBorrowerFromInput(qrUrl)).toBeNull();
            const result = await resolveBorrowerFromInput(qrUrl);
            expect(result).not.toBeNull();
            expect(result.type).toBe('siswa');
            expect(result.item.nis).toBe('12345');
            expect(result.item.nama).toBe('I Made Raditya');
            expect(resolvedTokens).toContain('kts_validtoken0000');
        });

        test('QR kartu ber-public token dan token kts_ polos juga diterjemahkan oleh Worker', async () => {
            const byPublicToken = await resolveBorrowerFromInput('https://smagesa.web.app/kartu-shakti.html?id=a1b2c3d4e5f60718293a4b5c6d7e8f90abcdef');
            expect(byPublicToken?.item.nis).toBe('12345');
            const byRawToken = await resolveBorrowerFromInput('kts_validtoken0000');
            expect(byRawToken?.item.nis).toBe('12345');
        });

        test('token kartu palsu tidak menghasilkan peminjam', async () => {
            expect(await resolveBorrowerFromInput('kts_forgedtoken000')).toBeNull();
        });

        test('NIP / NIS polos tetap diproses lokal tanpa memanggil Worker', async () => {
            const before = resolvedTokens.length;
            expect((await resolveBorrowerFromInput('197501012000031001'))?.type).toBe('guru');
            expect((await resolveBorrowerFromInput('12345'))?.type).toBe('siswa');
            expect(resolvedTokens.length).toBe(before);
        });

        test('extractVisitorFromInput pada presensi mengenali NIP guru secara instan', () => {
            const result = extractVisitorFromInput('197501012000031001');
            expect(result).not.toBeNull();
            expect(result.type).toBe('guru');
            expect(result.item.jabatan).toBe('Guru Fisika');
        });

        test('resolveVisitorFromInput pada presensi menerjemahkan QR kartu resmi (id=kts_...) lewat Worker', async () => {
            const qrUrl = 'https://smagesa.web.app/kartu-shakti.html?id=kts_validtoken0000';
            const result = await resolveVisitorFromInput(qrUrl);
            expect(result).not.toBeNull();
            expect(result.type).toBe('siswa');
            expect(result.item.nis).toBe('12345');
            expect(await resolveVisitorFromInput('kts_forgedtoken000')).toBeNull();
        });
    });

    describe('4. Standar Keamanan OWASP ASVS Level 2', () => {
        test('library/index.js memblokir skema berbahaya javascript: dan data:text/html pada avatar', () => {
            expect(indexJs).toContain('!/^(https?:|\\/|data:image\\/)/i.test(resolved)');
        });

        test('library/presensi-perpus.js memblokir skema berbahaya javascript: pada foto pengunjung', () => {
            expect(presensiJs).toContain('!/^(https?:|\\/|data:image\\/)/i.test(resolved)');
        });
    });

    describe('5. Sinkronisasi Versi Rilis & Cache-Buster', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

        test('library/index.html memuat script tag versi mutakhir', () => {
            expect(indexHtml).toContain(`index.js?v=${pkg.version}`);
        });

        test('library/presensi-perpus.html memuat script tag versi mutakhir', () => {
            expect(presensiHtml).toContain(`presensi-perpus.js?v=${pkg.version}`);
        });

        test('nomor versi berformat YY.MM.DD.REV harian', () => {
            expect(pkg.version).toMatch(/^\d{2}\.\d{2}\.\d{2}\.\d+$/);
        });
    });
});

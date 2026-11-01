/**
 * Unit Test: Kartu Pelajar Digital (E-KTS) & Verifikasi Pasfoto Cloudflare R2
 * Standar: ISO/IEC 7810 ID-1 (CR-80), UU Perlindungan Data Pribadi (PDP), Anti-IDOR & Zero Fake Fallback
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Modul Kartu Pelajar Digital (E-KTS) & Verifikasi Foto', () => {

    // 1. Uji Validitas Skema Database D1 (student_photos)
    test('Skema database student_photos dan indeks token telah didefinisikan dengan benar', () => {
        const schemaPath = path.join(__dirname, '..', 'cloudflare', 'schema.sql');
        const schemaContent = fs.readFileSync(schemaPath, 'utf8');

        expect(schemaContent).toContain('CREATE TABLE IF NOT EXISTS student_photos');
        expect(schemaContent).toContain('active_photo_url TEXT');
        expect(schemaContent).toContain('pending_photo_url TEXT');
        expect(schemaContent).toContain('status TEXT DEFAULT \'pending\'');
        expect(schemaContent).toContain('public_token TEXT UNIQUE');
        expect(schemaContent).toContain('idx_student_photos_token');
        expect(schemaContent).toContain('idx_student_photos_status');
    });

    // 2. Uji File Migrasi D1 SQL
    test('File migrasi D1 untuk student_photos tersedia', () => {
        const migrationPath = path.join(__dirname, '..', 'cloudflare', 'migrations', '202609110001_add_student_photos.sql');
        expect(fs.existsSync(migrationPath)).toBe(true);

        const migrationContent = fs.readFileSync(migrationPath, 'utf8');
        expect(migrationContent).toContain('student_photos');
    });

    // 3. Uji Dimensi Standar Fisik ISO/IEC 7810 ID-1 (CR-80: 85.60mm x 53.98mm)
    test('CSS card-print.css mematuhi dimensi fisik presisi seukuran KTP/BPJS/ATM', () => {
        const cssPath = path.join(__dirname, '..', 'css', 'card-print.css');
        const cssContent = fs.readFileSync(cssPath, 'utf8');

        expect(cssContent).toContain('--kts-width: 85.6mm');
        expect(cssContent).toContain('--kts-height: 53.98mm');
        expect(cssContent).toContain('85.6mm !important');
        expect(cssContent).toContain('53.98mm !important');
        expect(cssContent).toContain('.kts-printable-card');
        expect(cssContent).toContain('.print-kts-bulk-container');
    });

    // 4. Uji Sanitasi Data Publik (UU PDP & ASVS L1/L2)
    test('Data publik E-KTS menyembunyikan informasi sensitif (NIK, Poin Pelanggaran, Kontak Orang Tua)', () => {
        const fullStudentRecord = {
            nis: '10234',
            nisn: '0081234567',
            name: 'I Gede Aditya Pratama',
            class: 'XII-MIPA-1',
            nik: '5107010203040001',
            gender: 'L',
            religion: 'Hindu',
            birthPlace: 'Karangasem',
            birthDate: '2008-04-12',
            parentName: 'I Wayan Sudarma',
            parentPhone: '081234567890',
            violationPoints: 25,
            bkNotes: 'Pernah terlambat 3 kali',
            activePhotoUrl: '/api/photos/student/active/10234.webp',
            photoStatus: 'approved'
        };

        const sanitizePublicCardData = (row) => ({
            name: row.name,
            nis: row.nis,
            nisn: row.nisn,
            class: row.class,
            gender: row.gender,
            religion: row.religion,
            birthPlace: row.birthPlace,
            birthDate: row.birthDate,
            photoUrl: row.activePhotoUrl || null,
            status: 'Aktif',
            verified: true,
            school: 'SMA Negeri 1 Abang',
            npsn: '50102602'
        });

        const publicData = sanitizePublicCardData(fullStudentRecord);

        expect(publicData.name).toBe('I Gede Aditya Pratama');
        expect(publicData.nis).toBe('10234');
        expect(publicData.school).toBe('SMA Negeri 1 Abang');
        expect(publicData.photoUrl).toBe('/api/photos/student/active/10234.webp');

        expect(publicData.nik).toBeUndefined();
        expect(publicData.parentPhone).toBeUndefined();
        expect(publicData.parentName).toBeUndefined();
        expect(publicData.violationPoints).toBeUndefined();
        expect(publicData.bkNotes).toBeUndefined();
    });

    // 5. Uji Logika Dual-Photo State (Pending vs Active)
    test('Foto lama tetap aktif saat siswa mengunggah foto baru yang belum diverifikasi', () => {
        let photoRecord = {
            nis: '10234',
            activePhotoUrl: '/api/photos/student/active/10234_v1.webp',
            pendingPhotoUrl: null,
            status: 'approved'
        };

        const handleStudentUpload = (record, newPhotoUrl) => ({
            ...record,
            pendingPhotoUrl: newPhotoUrl,
            status: 'pending'
        });

        const afterUpload = handleStudentUpload(photoRecord, '/api/photos/student/pending/10234_v2.webp');

        expect(afterUpload.activePhotoUrl).toBe('/api/photos/student/active/10234_v1.webp');
        expect(afterUpload.pendingPhotoUrl).toBe('/api/photos/student/pending/10234_v2.webp');
        expect(afterUpload.status).toBe('pending');

        const handleWaliApproval = (record) => ({
            ...record,
            activePhotoUrl: record.pendingPhotoUrl,
            pendingPhotoUrl: null,
            status: 'approved'
        });

        const afterApproval = handleWaliApproval(afterUpload);
        expect(afterApproval.activePhotoUrl).toBe('/api/photos/student/pending/10234_v2.webp');
        expect(afterApproval.pendingPhotoUrl).toBeNull();
        expect(afterApproval.status).toBe('approved');
    });

    // 6. Uji Penolakan Pasfoto Siswa oleh Wali Kelas
    test('Jika foto baru ditolak, foto lama tetap aktif dan status berubah menjadi rejected', () => {
        const currentRecord = {
            nis: '10234',
            activePhotoUrl: '/api/photos/student/active/10234_v1.webp',
            pendingPhotoUrl: '/api/photos/student/pending/10234_v2.webp',
            status: 'pending'
        };

        const handleWaliRejection = (record, reason) => ({
            ...record,
            pendingPhotoUrl: null,
            status: 'rejected',
            rejectionReason: reason
        });

        const afterRejection = handleWaliRejection(currentRecord, 'Bukan pakaian seragam resmi');

        expect(afterRejection.activePhotoUrl).toBe('/api/photos/student/active/10234_v1.webp');
        expect(afterRejection.pendingPhotoUrl).toBeNull();
        expect(afterRejection.status).toBe('rejected');
        expect(afterRejection.rejectionReason).toBe('Bukan pakaian seragam resmi');
    });

    // 7. Uji Keberadaan Halaman Verifikasi Publik kartu-shakti.html
    test('File kartu-shakti.html tersedia dan berisi elemen verifikasi keaslian publik', () => {
        const publicHtmlPath = path.join(__dirname, '..', 'kartu-shakti.html');
        expect(fs.existsSync(publicHtmlPath)).toBe(true);

        const htmlContent = fs.readFileSync(publicHtmlPath, 'utf8');
        expect(htmlContent).toContain('Kartu Siswa Digital');
        expect(htmlContent).toContain('card-photo'); expect(htmlContent).toContain('card-token');
    });

    // 8. Uji Wrangler Configuration R2 Bucket Binding
    test('Binding Cloudflare R2 bucket STUDENT_PHOTOS_BUCKET terdaftar di wrangler.toml', () => {
        const wranglerPath = path.join(__dirname, '..', 'cloudflare', 'wrangler.toml');
        const wranglerContent = fs.readFileSync(wranglerPath, 'utf8');

        expect(wranglerContent).toContain('STUDENT_PHOTOS_BUCKET');
        expect(wranglerContent).toContain('smagesa-student-photos');
    });

    // 9. Uji Fungsi Ekstraksi Key R2 dari URL
    test('Helper extractStudentPhotoR2Key mengekstrak path objek R2 secara presisi', () => {
        function extractStudentPhotoR2Key(url) {
            if (!url || typeof url !== 'string') return null;
            const match = url.match(/\/api\/photos\/student\/(active|pending)\/([a-zA-Z0-9_\-\.]+\.webp)/);
            if (match) {
                return `${match[1]}/${match[2]}`;
            }
            return null;
        }

        expect(extractStudentPhotoR2Key('/api/photos/student/active/10234.webp?v=1741700000')).toBe('active/10234.webp');
        expect(extractStudentPhotoR2Key('https://smagesa.web.app/api/photos/student/pending/10234_1741700000.webp')).toBe('pending/10234_1741700000.webp');
        expect(extractStudentPhotoR2Key('/api/photos/student/unknown/10234.webp')).toBeNull();
        expect(extractStudentPhotoR2Key(null)).toBeNull();
        expect(extractStudentPhotoR2Key('')).toBeNull();
    });

    // 10. Uji Integrasi Tabel student_photos dalam ANNUAL_RESET_TABLES
    test('Tabel student_photos terdaftar di ANNUAL_RESET_TABLES worker.js dengan relasi NIS', () => {
        const workerPath = path.join(__dirname, '..', 'cloudflare', 'worker.js');
        const workerContent = fs.readFileSync(workerPath, 'utf8');

        expect(workerContent).toContain("student_photos: ['nis', 'nis']");
        expect(workerContent).toContain("deleteStudentPhotosFromR2");
    });

    // 11. Uji Logika Auto-Cleanup Alumni & Orphan di performAutoCleanup
    test('performAutoCleanup memiliki logika query pembersihan foto alumni dan orphan', () => {
        const workerPath = path.join(__dirname, '..', 'cloudflare', 'worker.js');
        const workerContent = fs.readFileSync(workerPath, 'utf8');

        expect(workerContent).toContain("Cleanup Foto & Kartu Siswa Alumni / Orphan");
        expect(workerContent).toContain("FROM student_photos sp");
        expect(workerContent).toContain("LEFT JOIN students s ON sp.nis = s.nis");
        expect(workerContent).toContain("LOWER(TRIM(COALESCE(s.status, ''))) = 'alumni'");
        expect(workerContent).toContain("studentPhotos:");
        expect(workerContent).toContain("studentPhotosR2:");
    });

    // 12. Uji Palet Warna Resmi & Rasio Adaptif Layar Sempit pada CSS card-print.css
    test('CSS card-print.css mengimplementasikan palet warna resmi putih hangat, navy, emas redup, dan rasio kartu adaptif CR-80', () => {
        const cssPath = path.join(__dirname, '..', 'css', 'card-print.css');
        const cssContent = fs.readFileSync(cssPath, 'utf8');

        expect(cssContent).toContain('--kts-bg: #FAFAF7');
        expect(cssContent).toContain('--kts-navy: #0F172A');
        expect(cssContent).toContain('--kts-gold: #B89552');
        expect(cssContent).toContain('--kts-slate: #64748B');
        expect(cssContent).toContain('aspect-ratio: 85.6 / 53.98');
        expect(cssContent).toContain('.kts-face-front');
        expect(cssContent).toContain('.kts-face-back');
        expect(cssContent).toContain('.kts-qr-container');
    });

    // 13. Uji Struktur Sisi Depan dan Sisi Belakang Kartu pada portal-siswa.html
    test('portal-siswa.html mematuhi struktur redesign: QR di sisi depan quick scan, petunjuk flip di luar kartu, NIS/NISN terpisah, dan sisi belakang kaya informasi', () => {
        const portalPath = path.join(__dirname, '..', 'portal-siswa.html');
        const portalContent = fs.readFileSync(portalPath, 'utf8');

        // Pastikan QR box berada di sisi depan (kts-face-front) untuk quick scan
        expect(portalContent).toContain('id="kts-front-qr-box"');

        // Pastikan petunjuk flip berada di luar kartu
        expect(portalContent).toContain('id="student-card-flip-hint"');

        // Pastikan elemen identitas terpisah
        expect(portalContent).toContain('id="kts-front-nis"');
        expect(portalContent).toContain('id="kts-front-nisn"');
        expect(portalContent).toContain('id="kts-front-name"');
        expect(portalContent).toContain('id="kts-front-photo"');

        // Pastikan kop resmi kartu pelajar
        expect(portalContent).toContain('KARTU PELAJAR');
        expect(portalContent).toContain('SMA NEGERI 1 ABANG');

        // Pastikan sisi belakang memuat Visi Satuan Pendidikan & Ikrar Pelajar Indonesia
        expect(portalContent).toContain('SMAGESA SHAKTI &bull; VISI & IKRAR PELAJAR');
        expect(portalContent).toContain('Visi Satuan Pendidikan');
        expect(portalContent).toContain('Ikrar Pelajar Indonesia');
    });

    // 14. Uji Standar Fallback Pasfoto: Menggunakan Siluet Dummy Web2 (Bukan Logo Sekolah)
    test('Kartu siswa yang belum memiliki foto wajib menggunakan siluet avatar dummy (assets/default-avatar.svg) dan bukan logo sekolah', () => {
        const defaultAvatarPath = path.join(__dirname, '..', 'assets', 'default-avatar.svg');
        expect(fs.existsSync(defaultAvatarPath)).toBe(true);

        const avatarSvg = fs.readFileSync(defaultAvatarPath, 'utf8');
        expect(avatarSvg).toContain('<svg');
        expect(avatarSvg).toContain('viewBox="0 0 300 400"');

        // Portal Siswa HTML & JS
        const portalHtml = fs.readFileSync(path.join(__dirname, '..', 'portal-siswa.html'), 'utf8');
        expect(portalHtml).toContain('id="kts-front-photo" src="assets/default-avatar.svg"');
        expect(portalHtml).not.toContain('id="kts-front-photo" src="assets/logo-sekolah.png"');

        const portalJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'page-portal-siswa.js'), 'utf8');
        expect(portalJs).toContain("photoImg.src = 'assets/default-avatar.svg';");
        expect(portalJs).not.toContain("photoImg.src = 'assets/logo-sekolah.png';");

        // Kartu Shakti Verifikasi Publik
        const shaktiHtml = fs.readFileSync(path.join(__dirname, '..', 'kartu-shakti.html'), 'utf8');
        expect(shaktiHtml).toContain('id="card-photo" src="assets/default-avatar.svg"');
        expect(shaktiHtml).not.toContain('id="card-photo" src="assets/logo-sekolah.png"');
        expect(shaktiHtml).toContain("photoImg.src = 'assets/default-avatar.svg';");
        expect(shaktiHtml).not.toContain("photoImg.src = 'assets/logo-sekolah.png';");

        // Modul SSOT StudentCardRenderer, Wali Kelas, & Admin
        const rendererJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'student-card-renderer.js'), 'utf8');
        expect(rendererJs).toContain("assets/default-avatar.svg");
        expect(rendererJs).not.toContain("photoUrl || 'assets/logo-sekolah.png'");
        expect(rendererJs).not.toContain("photoSrc || 'assets/logo-sekolah.png'");

        const waliJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'page-wali-kelas.js'), 'utf8');
        expect(waliJs).toContain("student-card-renderer.js");
        expect(waliJs).not.toContain("photoUrl || 'assets/logo-sekolah.png'");

        const studentsJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'page-students.js'), 'utf8');
        expect(studentsJs).toContain("student-card-renderer.js");
        expect(studentsJs).not.toContain("photoUrl || 'assets/logo-sekolah.png'");
    });

    // 15. Uji Keamanan Token Kartu Anti-IDOR & Anti-Scraping: kunci kts_ hanya ada di Worker secret
    test('Token kartu publik wajib berupa token acak atau kts_ terenkripsi dengan CARD_TOKEN_SECRET, dan kuncinya tidak pernah ada di browser', () => {
        const workerPath = path.join(__dirname, '..', 'cloudflare', 'worker.js');
        const workerContent = fs.readFileSync(workerPath, 'utf8');

        // Enkripsi/dekripsi wajib memakai secret Worker
        expect(workerContent).toContain('function encryptSecureCardToken(nis, secret)');
        expect(workerContent).toContain('function decryptSecureCardToken(token, secret)');
        expect(workerContent).toContain('const secureToken = row.public_token || encryptSecureCardToken(row.nis, env?.CARD_TOKEN_SECRET);');

        // public-card tetap dual-resolution (public_token atau kts_) dengan secret server
        expect(workerContent).toContain('tokenParam.startsWith("kts_")');
        expect(workerContent).toContain('const decryptedNis = decryptSecureCardToken(tokenParam, env.CARD_TOKEN_SECRET);');

        // Pemindai staf (SPP & perpustakaan) menerjemahkan QR lewat endpoint khusus staf
        expect(workerContent).toContain('path.startsWith("/api/students/resolve-card/")');

        // Tidak ada kunci/cipher kartu di kode yang dikirim ke browser
        const leakedKey = /0x534d4147|SMAGESA-SHAKTI-KTS-2026|xxteaBtea|encryptSecureCardToken|decryptSecureCardToken/;
        for (const file of ['js/utils.mjs', 'js/student-card-renderer.js', 'kartu-shakti.html', 'js/page-keuangan.js', 'library/index.js', 'library/presensi-perpus.js']) {
            expect(fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).not.toMatch(leakedKey);
        }
    });

    // 16. Uji Sisi Belakang Kartu (Visi Sekolah, Ikrar Pelajar Indonesia, & Footer Bawah Tanpa QR Operasional Kedua)
    test('Sisi belakang kartu memuat Visi Satuan Pendidikan, Ikrar Pelajar Indonesia, dan Footer di bawah secara presisi', () => {
        // Portal Siswa HTML & JS
        const portalHtml = fs.readFileSync(path.join(__dirname, '..', 'portal-siswa.html'), 'utf8');
        expect(portalHtml).toContain('kts-vision-card');
        expect(portalHtml).toContain('kts-ikrar-card');
        expect(portalHtml).toContain('kts-rules-compact');
        expect(portalHtml).toContain('kts-endorsement-wrapper');
        expect(portalHtml).toContain('Visi Satuan Pendidikan');
        expect(portalHtml).toContain('Ikrar Pelajar Indonesia');

        // Modul SSOT StudentCardRenderer
        const rendererJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'student-card-renderer.js'), 'utf8');
        expect(rendererJs).toContain('Visi Satuan Pendidikan');
        expect(rendererJs).toContain('Ikrar Pelajar Indonesia');
        expect(rendererJs).toContain('kts-vision-card');
        expect(rendererJs).toContain('kts-ikrar-card');
        expect(rendererJs).toContain('SMAGESA SHAKTI &bull; VISI & IKRAR PELAJAR');

        // Wali Kelas JS, Admin Students JS, & Portal Siswa JS mengimpor modul SSOT
        const waliJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'page-wali-kelas.js'), 'utf8');
        expect(waliJs).toContain('student-card-renderer.js');
        expect(waliJs).toContain('renderKtsPrintPairHtml');

        const studentsJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'page-students.js'), 'utf8');
        expect(studentsJs).toContain('student-card-renderer.js');
        expect(studentsJs).toContain('printSingleKts');

        const portalJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'page-portal-siswa.js'), 'utf8');
        expect(portalJs).toContain('student-card-renderer.js');
        expect(portalJs).toContain('renderKtsInteractiveCard');

        // CSS card-print.css
        const cssContent = fs.readFileSync(path.join(__dirname, '..', 'css', 'card-print.css'), 'utf8');
        expect(cssContent).toContain('.kts-vision-card');
        expect(cssContent).toContain('.kts-ikrar-card');
        expect(cssContent).toContain('.kts-rules-compact');
        expect(cssContent).toContain('.kts-endorsement-wrapper');
    });

    // 17. Uji Single Universal QR Code & Smart Scanner Decoder (token kartu diterjemahkan Worker)
    test('Smart auto-parser: NIS polos diproses lokal, token kartu dari URL kartu-shakti / kts_ diterjemahkan lewat Worker', () => {
        const { execFileSync } = require('node:child_process');
        const nodeScript = `
            import { extractNisFromQrInput, extractCardTokenFromQrInput, resolveNisFromQrInput } from './js/utils.mjs';
            const calls = [];
            const fakeClient = {
                async resolveStudentCardToken(token) {
                    calls.push(token);
                    if (token === 'kts_validtoken0000') return { success: true, data: { nis: '12401' } };
                    throw new Error('Kartu tidak dikenali');
                }
            };
            const sampleUrl = 'https://smagesa.web.app/kartu-shakti.html?id=kts_validtoken0000';
            const results = {
                tokenFromUrl: extractCardTokenFromQrInput(sampleUrl),
                tokenFromRaw: extractCardTokenFromQrInput('kts_validtoken0000'),
                tokenFromPlain: extractCardTokenFromQrInput('12401'),
                fromPlain: extractNisFromQrInput('12401'),
                fromLegacyNisUrl: extractNisFromQrInput('https://smagesa.web.app/kartu-shakti.html?nis=12401'),
                fromEmpty: extractNisFromQrInput(''),
                fromNull: extractNisFromQrInput(null),
                resolvedUrl: await resolveNisFromQrInput(sampleUrl, fakeClient),
                resolvedPlain: await resolveNisFromQrInput('12401', fakeClient),
                resolvedForged: await resolveNisFromQrInput('kts_forgedtoken000', fakeClient),
                resolvedNoClient: await resolveNisFromQrInput(sampleUrl, null),
                calls
            };
            console.log(JSON.stringify(results));
        `;

        const rawOutput = execFileSync('node', ['--input-type=module', '-e', nodeScript], {
            cwd: path.join(__dirname, '..'),
            encoding: 'utf8'
        });
        const res = JSON.parse(rawOutput.trim().split('\n').pop());

        // 1. Token kartu dikenali dari URL verifikasi publik maupun token polos
        expect(res.tokenFromUrl).toBe('kts_validtoken0000');
        expect(res.tokenFromRaw).toBe('kts_validtoken0000');
        expect(res.tokenFromPlain).toBe('');

        // 2. NIS polos & URL legacy ?nis= tetap diekstrak lokal
        expect(res.fromPlain).toBe('12401');
        expect(res.fromLegacyNisUrl).toBe('12401');
        expect(res.fromEmpty).toBe('');
        expect(res.fromNull).toBe('');

        // 3. Token kartu diterjemahkan oleh Worker; token palsu / tanpa klien menghasilkan ''
        expect(res.resolvedUrl).toBe('12401');
        expect(res.resolvedPlain).toBe('12401');
        expect(res.resolvedForged).toBe('');
        expect(res.resolvedNoClient).toBe('');
        expect(res.calls).toEqual(['kts_validtoken0000', 'kts_forgedtoken000']);

        // 4. Form SPP dan Perpustakaan memakai resolusi lewat Worker
        const perpusJs = fs.readFileSync(path.join(__dirname, '..', 'library', 'presensi-perpus.js'), 'utf8');
        expect(perpusJs).toContain('resolveNisFromQrInput');
        const sirkulasiJs = fs.readFileSync(path.join(__dirname, '..', 'library', 'index.js'), 'utf8');
        expect(sirkulasiJs).toContain('resolveNisFromQrInput');
        const sppJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'page-keuangan.js'), 'utf8');
        expect(sppJs).toContain('resolveNisFromQrInput');
    });

    // 18. Uji Modul SSOT student-card-renderer.js (Normalisasi Data, Render Depan/Belakang, dan Cetak)
    test('Modul SSOT student-card-renderer.js mengekspor fungsi-fungsi utama dan menghasilkan HTML kartu valid', () => {
        const { execFileSync } = require('node:child_process');
        const nodeScript = `
            import { 
                normalizeStudentCardData, 
                renderKtsFrontHtml, 
                renderKtsBackHtml, 
                renderKtsPrintPairHtml 
            } from './js/student-card-renderer.js';

            const dummyStudent = {
                nis: '10234',
                nisn: '0081234567',
                name: 'Ni Kadek Ayu Lestari',
                class: 'XII-MIPA-1',
                gender: 'P',
                birthPlace: 'Karangasem',
                birthDate: '12 Mei 2008'
            };

            const normalized = normalizeStudentCardData(dummyStudent);
            const frontHtml = renderKtsFrontHtml(dummyStudent, { qrId: 'test-qr-box', mode: 'screen' });
            const backHtml = renderKtsBackHtml(dummyStudent, { mode: 'screen' });
            const printPair = renderKtsPrintPairHtml(dummyStudent, 0, 'both');

            const results = {
                hasNormalizedNis: normalized.nis === '10234',
                hasNormalizedName: normalized.name === 'NI KADEK AYU LESTARI',
                hasNormalizedGender: normalized.gender === 'PEREMPUAN',
                frontContainsQr: frontHtml.includes('test-qr-box'),
                frontContainsPhotoFallback: frontHtml.includes('assets/default-avatar.svg'),
                backContainsVisi: backHtml.includes('Visi Satuan Pendidikan'),
                backContainsIkrar: backHtml.includes('Ikrar Pelajar Indonesia'),
                printHasBothSides: printPair.html.includes('kts-print-front') && printPair.html.includes('kts-print-back')
            };
            console.log(JSON.stringify(results));
        `;

        const rawOutput = execFileSync('node', ['--input-type=module', '-e', nodeScript], {
            cwd: path.join(__dirname, '..'),
            encoding: 'utf8'
        });

        const res = JSON.parse(rawOutput.trim());
        expect(res.hasNormalizedNis).toBe(true);
        expect(res.hasNormalizedName).toBe(true);
        expect(res.hasNormalizedGender).toBe(true);
        expect(res.frontContainsQr).toBe(true);
        expect(res.frontContainsPhotoFallback).toBe(true);
        expect(res.backContainsVisi).toBe(true);
        expect(res.backContainsIkrar).toBe(true);
        expect(res.printHasBothSides).toBe(true);
    });

    // 19. Uji Revisi Sisi Depan: Tanggal Lahir DD MMMM YYYY, Tempat Lahir Kapital Awal Kata, Alamat sampai Level Kecamatan (Alamat, Desa, Kecamatan), Hapus Akreditasi & Berlaku, Sembunyi Kelas & Siswa Aktif pada Cetak
    test('Sisi depan kartu menerapkan tanggal lahir formal DD MMMM YYYY, tempat lahir Title Case, alamat sampai level kecamatan (alamat, desa, kecamatan), menghapus teks akreditasi & berlaku, serta menyembunyikan kelas dan status siswa aktif saat cetak', () => {
        const { execFileSync } = require('node:child_process');
        const nodeScript = `
            import { 
                normalizeStudentCardData, 
                formatBirthDateIndo,
                formatBirthPlace,
                formatStudentCardAddress,
                renderKtsFrontHtml 
            } from './js/student-card-renderer.js';

            const testStudent = {
                nis: '10999',
                nisn: '0098765432',
                name: 'I Wayan Satria Wibawa',
                class: 'X-E-1',
                birthPlace: 'KARANGASEM',
                birthDate: '2008-05-15',
                alamat: 'Banjar Dinas Culik',
                desa: 'Culik',
                kecamatan: 'Abang'
            };

            const normalized = normalizeStudentCardData(testStudent);
            const screenHtml = renderKtsFrontHtml(testStudent, { mode: 'screen' });
            const printHtml = renderKtsFrontHtml(testStudent, { mode: 'print' });

            const addrCase1 = formatStudentCardAddress({ alamat: 'Banjar Dinas Culik', desa: 'Culik', kecamatan: 'Abang' });
            const addrCase2 = formatStudentCardAddress({ alamat: 'BANJAR DINAS LEBAH', kelurahan: 'PURWAKERTI', kecamatan: 'ABANG' });
            const addrCase3 = formatStudentCardAddress({ dusun: 'Br. Dinas Ngis Kelod', desa: 'Tribuana', kecamatan: 'Kec. Abang' });
            const addrCase4 = formatStudentCardAddress({ alamat: 'Jl. Raya Culik, Culik, Abang', desa: 'Culik', kecamatan: 'Abang' });

            const results = {
                formattedBirthDate: formatBirthDateIndo('2008-05-15') === '15 Mei 2008',
                formattedBirthPlaceUpper: formatBirthPlace('KARANGASEM') === 'Karangasem',
                formattedBirthPlaceLower: formatBirthPlace('denpasar') === 'Denpasar',
                formattedBirthPlaceMulti: formatBirthPlace('kubu karangasem') === 'Kubu Karangasem',
                normalizedBirthPlace: normalized.birthPlace === 'Karangasem',
                normalizedTtl: normalized.ttl === 'Karangasem, 15 Mei 2008',
                screenHasTtl: screenHtml.includes('Karangasem, 15 Mei 2008'),
                addrCase1Match: addrCase1 === 'Banjar Dinas Culik, Culik, Abang',
                addrCase2Match: addrCase2 === 'Banjar Dinas Lebah, Purwakerti, Abang',
                addrCase3Match: addrCase3 === 'Br. Dinas Ngis Kelod, Tribuana, Kec. Abang',
                addrCase4Match: addrCase4 === 'Jl. Raya Culik, Culik, Abang',
                hasAddress: normalized.address === 'Banjar Dinas Culik, Culik, Abang',
                screenHasAddress: screenHtml.includes('Banjar Dinas Culik, Culik, Abang'),
                printHasAddress: printHtml.includes('Banjar Dinas Culik, Culik, Abang'),
                screenHasSiswaAktif: screenHtml.includes('SISWA AKTIF'),
                screenOmitsKelas: !screenHtml.includes('X-E-1'),
                printOmitsSiswaAktif: !printHtml.includes('SISWA AKTIF'),
                printOmitsKelas: !printHtml.includes('X-E-1'),
                noAkreditasiInScreen: !screenHtml.includes('AKREDITASI'),
                noAkreditasiInPrint: !printHtml.includes('AKREDITASI'),
                noBerlakuInScreen: !screenHtml.includes('Berlaku selama menjadi siswa aktif'),
                noBerlakuInPrint: !printHtml.includes('Berlaku selama menjadi siswa aktif')
            };
            console.log(JSON.stringify(results));
        `;

        const rawOutput = execFileSync('node', ['--input-type=module', '-e', nodeScript], {
            cwd: path.join(__dirname, '..'),
            encoding: 'utf8'
        });

        const res = JSON.parse(rawOutput.trim());
        expect(res.formattedBirthDate).toBe(true);
        expect(res.formattedBirthPlaceUpper).toBe(true);
        expect(res.formattedBirthPlaceLower).toBe(true);
        expect(res.formattedBirthPlaceMulti).toBe(true);
        expect(res.normalizedBirthPlace).toBe(true);
        expect(res.normalizedTtl).toBe(true);
        expect(res.screenHasTtl).toBe(true);
        expect(res.addrCase1Match).toBe(true);
        expect(res.addrCase2Match).toBe(true);
        expect(res.addrCase3Match).toBe(true);
        expect(res.addrCase4Match).toBe(true);
        expect(res.hasAddress).toBe(true);
        expect(res.screenHasAddress).toBe(true);
        expect(res.printHasAddress).toBe(true);
        expect(res.screenHasSiswaAktif).toBe(true);
        expect(res.screenOmitsKelas).toBe(true);
        expect(res.printOmitsSiswaAktif).toBe(true);
        expect(res.printOmitsKelas).toBe(true);
        expect(res.noAkreditasiInScreen).toBe(true);
        expect(res.noAkreditasiInPrint).toBe(true);
        expect(res.noBerlakuInScreen).toBe(true);
        expect(res.noBerlakuInPrint).toBe(true);
    });

    // 20. Uji Revisi Sisi Belakang & Corak Desain: Watermark Logo Sekolah, Corak Halus, SMAGESA SHAKTI Kanan Atas, Visi Normal, Ikrar Resmi Terbaru, Ketentuan Diperjelas, NIP Lurus Nama Kepsek, serta Ukuran Foto & QR
    test('Sisi belakang kartu dan desain visual mematuhi revisi: watermark logo sekolah, corak halus, SMAGESA SHAKTI kanan atas, visi normal, ikrar resmi, ketentuan lengkap, dan NIP rata kiri sejajar kepala sekolah', () => {
        const { execFileSync } = require('node:child_process');
        const nodeScript = `
            import { 
                renderKtsFrontHtml, 
                renderKtsBackHtml 
            } from './js/student-card-renderer.js';

            const testStudent = {
                nis: '10999',
                nisn: '0098765432',
                name: 'I Wayan Satria Wibawa',
                class: 'X-E-1',
                birthPlace: 'Karangasem',
                birthDate: '2008-05-15',
                alamat: 'Jl. Raya Culik, Banjar Dinas Culik'
            };

            const frontHtml = renderKtsFrontHtml(testStudent, { mode: 'screen' });
            const backHtml = renderKtsBackHtml(testStudent, { mode: 'screen' });

            const results = {
                frontHasPattern: frontHtml.includes('kts-card-pattern-overlay'),
                frontHasWatermark: frontHtml.includes('kts-card-watermark-bg'),
                backHasPattern: backHtml.includes('kts-card-pattern-overlay'),
                backHasWatermark: backHtml.includes('kts-card-watermark-bg'),
                backHasSmagesaShaktiRibbon: backHtml.includes('SMAGESA SHAKTI'),
                backHasKepalaSekolahTitle: backHtml.includes('Kepala SMA Negeri 1 Abang'),
                backHasLeftAlignedSign: backHtml.includes('text-left') && backHtml.includes('items-start'),
                backHasIkrarTerbaru: backHtml.includes('Beriman dan bertakwa kepada Tuhan Yang Maha Esa') && backHtml.includes('Mencintai tanah air Indonesia') && backHtml.includes('Kami, Pelajar Indonesia, berikrar untuk:'),
                backHasKetentuanLengkap: backHtml.includes('Ketentuan Penggunaan Kartu Pelajar') && backHtml.includes('kts-rules-list') && backHtml.includes('Transaksi Pembayaran DPM') && backHtml.includes('Peminjaman Buku, dan lainnya'),
                backHasShaktiSlogan: backHtml.includes('SMAGESA SHAKTI (Anubawa Anukara Antrah)'),
                backHasNipWithoutSpaces: backHtml.includes('NIP. 197005211997021001') && !backHtml.includes('19700521 199702 1 001'),
                backNoAkreditasi: !backHtml.includes('Akreditasi A')
            };
            console.log(JSON.stringify(results));
        `;

        const rawOutput = execFileSync('node', ['--input-type=module', '-e', nodeScript], {
            cwd: path.join(__dirname, '..'),
            encoding: 'utf8'
        });

        const res = JSON.parse(rawOutput.trim());
        expect(res.frontHasPattern).toBe(true);
        expect(res.frontHasWatermark).toBe(true);
        expect(res.backHasPattern).toBe(true);
        expect(res.backHasWatermark).toBe(true);
        expect(res.backHasSmagesaShaktiRibbon).toBe(true);
        expect(res.backHasKepalaSekolahTitle).toBe(true);
        expect(res.backHasLeftAlignedSign).toBe(true);
        expect(res.backHasIkrarTerbaru).toBe(true);
        expect(res.backHasKetentuanLengkap).toBe(true);
        expect(res.backHasShaktiSlogan).toBe(true);
        expect(res.backHasNipWithoutSpaces).toBe(true);
        expect(res.backNoAkreditasi).toBe(true);

        // Uji CSS card-print.css
        const cssContent = fs.readFileSync(path.join(__dirname, '..', 'css', 'card-print.css'), 'utf8');
        expect(cssContent).toContain('.kts-card-pattern-overlay');
        expect(cssContent).toContain('.kts-card-watermark-bg');
        expect(cssContent).toContain('.kts-watermark-img');
        expect(cssContent).toContain('width: 78px');
        expect(cssContent).toContain('height: 104px');
        expect(cssContent).toContain('height: 78px');
        expect(cssContent).toContain('.kts-photo-col');
        expect(cssContent).toContain('font-style: normal !important');

        // Uji portal-siswa.html
        const portalContent = fs.readFileSync(path.join(__dirname, '..', 'portal-siswa.html'), 'utf8');
        expect(portalContent).toContain('kts-card-pattern-overlay');
        expect(portalContent).toContain('kts-card-watermark-bg');
        expect(portalContent).toContain('Kepala SMA Negeri 1 Abang');
        expect(portalContent).toContain('SMAGESA SHAKTI');
        expect(portalContent).toContain('Anubawa Anukara Antrah');
    });

    // 21. Uji Skalabilitas Proporsional Kartu Pelajar (Image-Like Vector Scaling)
    test('StudentCardRenderer mengekspor auto-scaler dan CSS card-print.css mendukung transform scale proporsional seperti gambar', () => {
        const { execFileSync } = require('node:child_process');
        const nodeScript = `
            import { 
                updateKtsCardScale,
                updateAllKtsCardScales,
                initKtsAutoScaler
            } from './js/student-card-renderer.js';

            // Simulasi dummy container DOM
            class MockContainer {
                constructor(width) {
                    this.offsetWidth = width;
                    this.styleProps = {};
                }
                style = {
                    setProperty: (k, v) => { this.styleProps[k] = v; }
                };
            }

            const c440 = new MockContainer(440);
            const s440 = updateKtsCardScale(c440);

            const c330 = new MockContainer(330);
            const s330 = updateKtsCardScale(c330);

            const c220 = new MockContainer(220);
            const s220 = updateKtsCardScale(c220);

            const results = {
                hasUpdateScaleFn: typeof updateKtsCardScale === 'function',
                hasUpdateAllFn: typeof updateAllKtsCardScales === 'function',
                hasInitFn: typeof initKtsAutoScaler === 'function',
                scale440: s440 === 1,
                scale330: Math.abs(s330 - 0.75) < 0.001,
                scale220: Math.abs(s220 - 0.5) < 0.001,
                cssProp440: c440.styleProps['--kts-scale'] === '1',
                cssProp330: c330.styleProps['--kts-scale'] === '0.75',
                cssProp220: c220.styleProps['--kts-scale'] === '0.5'
            };
            console.log(JSON.stringify(results));
        `;

        const rawOutput = execFileSync('node', ['--input-type=module', '-e', nodeScript], {
            cwd: path.join(__dirname, '..'),
            encoding: 'utf8'
        });

        const res = JSON.parse(rawOutput.trim());
        expect(res.hasUpdateScaleFn).toBe(true);
        expect(res.hasUpdateAllFn).toBe(true);
        expect(res.hasInitFn).toBe(true);
        expect(res.scale440).toBe(true);
        expect(res.scale330).toBe(true);
        expect(res.scale220).toBe(true);
        expect(res.cssProp440).toBe(true);
        expect(res.cssProp330).toBe(true);
        expect(res.cssProp220).toBe(true);

        // Uji CSS card-print.css
        const cssContent = fs.readFileSync(path.join(__dirname, '..', 'css', 'card-print.css'), 'utf8');
        expect(cssContent).toContain('--kts-scale');
        expect(cssContent).toContain('transform: scale(var(--kts-scale, 1))');
        expect(cssContent).toContain('.kts-resizing .kts-face');
        expect(cssContent).toContain('width: 440px !important');
        expect(cssContent).toContain('height: 277.42px !important');
    });

    // 22. Uji Generator Canvas HD 300 DPI (CR-80) & Modul Unduh SSOT StudentCardRenderer
    test('StudentCardRenderer mengekspor generator canvas HD 300 DPI dan modul unduh kartu pelajar terpadu SSOT', () => {
        const { execFileSync } = require('node:child_process');
        const nodeScript = `
            import { 
                generateKtsFrontCanvas,
                generateKtsBackCanvas,
                generateKtsBothCanvas,
                downloadKtsPng,
                openKtsDownloadModal,
                closeKtsDownloadModal,
                ensureCardAssetsLoaded,
                renderKtsFrontHtml,
                renderKtsBackHtml
            } from './js/student-card-renderer.js';

            const printFront = renderKtsFrontHtml({ nis: '1234', name: 'Test' }, { mode: 'print' });
            const printBack = renderKtsBackHtml({ nis: '1234', name: 'Test' }, { mode: 'print' });

            const results = {
                hasFrontCanvasFn: typeof generateKtsFrontCanvas === 'function',
                hasBackCanvasFn: typeof generateKtsBackCanvas === 'function',
                hasBothCanvasFn: typeof generateKtsBothCanvas === 'function',
                hasDownloadPngFn: typeof downloadKtsPng === 'function',
                hasOpenModalFn: typeof openKtsDownloadModal === 'function',
                hasCloseModalFn: typeof closeKtsDownloadModal === 'function',
                hasEnsureAssetsFn: typeof ensureCardAssetsLoaded === 'function',
                printFrontHasScaleInner: printFront.includes('kts-print-scale-inner'),
                printBackHasScaleInner: printBack.includes('kts-print-scale-inner')
            };
            console.log(JSON.stringify(results));
        `;

        const rawOutput = execFileSync('node', ['--input-type=module', '-e', nodeScript], {
            cwd: path.join(__dirname, '..'),
            encoding: 'utf8'
        });

        const res = JSON.parse(rawOutput.trim());
        expect(res.hasFrontCanvasFn).toBe(true);
        expect(res.hasBackCanvasFn).toBe(true);
        expect(res.hasBothCanvasFn).toBe(true);
        expect(res.hasDownloadPngFn).toBe(true);
        expect(res.hasOpenModalFn).toBe(true);
        expect(res.hasCloseModalFn).toBe(true);
        expect(res.hasEnsureAssetsFn).toBe(true);
        expect(res.printFrontHasScaleInner).toBe(true);
        expect(res.printBackHasScaleInner).toBe(true);

        // Uji CSS card-print.css memuat aturan .kts-print-scale-inner
        const cssContent = fs.readFileSync(path.join(__dirname, '..', 'css', 'card-print.css'), 'utf8');
        expect(cssContent).toContain('.kts-print-scale-inner');
        expect(cssContent).toContain('transform: scale(0.73527)');

        // Uji integrasi portal-siswa.js dan page-wali-kelas.js
        const portalJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'page-portal-siswa.js'), 'utf8');
        expect(portalJs).toContain('downloadStudentCardPng');
        expect(portalJs).toContain('openKtsDownloadModal');
        expect(portalJs).toContain('downloadKtsPng');

        const waliJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'page-wali-kelas.js'), 'utf8');
        expect(waliJs).toContain('downloadKtsModalPng');
        expect(waliJs).toContain('openKtsDownloadModal');
        expect(waliJs).toContain('downloadKtsPng');
        expect(waliJs).toContain('prepareKtsPrintCards');
    });

    // 23. Uji Validasi Kelas Reguler vs Alumni / Non-Reguler (SSOT isRegularStudentClass & isStudentCardActive)
    test('isRegularStudentClass dan isStudentCardActive membedakan kelas reguler (X, XI, XII) dengan alumni atau non-reguler', () => {
        const { execFileSync } = require('node:child_process');
        const nodeScript = `
            import { 
                isRegularStudentClass,
                isStudentCardActive,
                normalizeStudentCardData
            } from './js/student-card-renderer.js';

            const regularClasses = ['X-1', 'X.1', 'X-A', 'X-E-1', 'X-10', 'XI-1', 'XI.1', 'XI-F1', 'XI-MIPA 1', 'XII-1', 'XII-MIPA 1', 'XII.IPS 2'];
            const alumniClasses = ['Alumni XII-MIPA 1 (2025/2026)', 'ALUMNI XII-IPS 2 (2024/2025)', 'Alumni 2026', 'alumni xii 2'];
            const nonRegularClasses = ['XII-LULUS', 'Mutasi', 'Keluar', 'Pindah', 'Nonaktif', 'DO', 'Drop Out', '-', '', 'Guru', 'Staf', 'Umum'];

            const allRegularValid = regularClasses.every(c => isRegularStudentClass(c) === true);
            const allAlumniInvalid = alumniClasses.every(c => isRegularStudentClass(c) === false);
            const allNonRegularInvalid = nonRegularClasses.every(c => isRegularStudentClass(c) === false);

            const activeStudentInRegular = isStudentCardActive({ nis: '1001', class: 'XII-MIPA 1', status: 'active' });
            const alumniStudent = isStudentCardActive({ nis: '1002', class: 'Alumni XII-MIPA 1 (2025/2026)', status: 'alumni' });
            const inactiveClassStudent = isStudentCardActive({ nis: '1003', class: 'XII-LULUS', status: 'active' });
            const dashClassStudent = isStudentCardActive({ nis: '1004', class: '-', status: 'active' });
            const inactiveStatusStudent = isStudentCardActive({ nis: '1005', class: 'XI-F1', status: 'mutasi' });

            const normRegular = normalizeStudentCardData({ nis: '1001', class: 'XI-F1' });
            const normAlumni = normalizeStudentCardData({ nis: '1002', class: 'Alumni XII-1 (2025/2026)' });
            const normNonRegular = normalizeStudentCardData({ nis: '1003', class: 'Mutasi' });

            const results = {
                allRegularValid,
                allAlumniInvalid,
                allNonRegularInvalid,
                activeStudentInRegular,
                alumniStudent,
                inactiveClassStudent,
                dashClassStudent,
                inactiveStatusStudent,
                normRegularText: normRegular.statusText,
                normRegularLabel: normRegular.statusLabel,
                normRegularIsActive: normRegular.isActive,
                normAlumniText: normAlumni.statusText,
                normAlumniLabel: normAlumni.statusLabel,
                normAlumniIsActive: normAlumni.isActive,
                normNonRegularText: normNonRegular.statusText,
                normNonRegularLabel: normNonRegular.statusLabel,
                normNonRegularIsActive: normNonRegular.isActive
            };
            console.log(JSON.stringify(results));
        `;

        const rawOutput = execFileSync('node', ['--input-type=module', '-e', nodeScript], {
            cwd: path.join(__dirname, '..'),
            encoding: 'utf8'
        });

        const res = JSON.parse(rawOutput.trim());
        expect(res.allRegularValid).toBe(true);
        expect(res.allAlumniInvalid).toBe(true);
        expect(res.allNonRegularInvalid).toBe(true);
        expect(res.activeStudentInRegular).toBe(true);
        expect(res.alumniStudent).toBe(false);
        expect(res.inactiveClassStudent).toBe(false);
        expect(res.dashClassStudent).toBe(false);
        expect(res.inactiveStatusStudent).toBe(false);
        expect(res.normRegularText).toBe('SISWA AKTIF');
        expect(res.normRegularLabel).toBe('Siswa Aktif');
        expect(res.normRegularIsActive).toBe(true);
        expect(res.normAlumniText).toBe('SISWA NONAKTIF');
        expect(res.normAlumniLabel).toBe('Siswa Nonaktif');
        expect(res.normAlumniIsActive).toBe(false);
        expect(res.normNonRegularText).toBe('SISWA NONAKTIF');
        expect(res.normNonRegularLabel).toBe('Siswa Nonaktif');
        expect(res.normNonRegularIsActive).toBe(false);
    });

    // 24. Uji Rendering Kartu Pelajar Digital untuk Siswa Alumni & Non-Reguler (HTML & Cetak)
    test('renderKtsFrontHtml menampilkan SISWA NONAKTIF untuk siswa kelas alumni atau selain reguler, dan tetap menyembunyikannya saat cetak', () => {
        const { execFileSync } = require('node:child_process');
        const nodeScript = `
            import { renderKtsFrontHtml } from './js/student-card-renderer.js';

            const regularStudent = {
                nis: '1001',
                name: 'Ketut Siswa Aktif',
                class: 'XII-MIPA 1'
            };

            const alumniStudent = {
                nis: '1002',
                name: 'Wayan Alumni Hebat',
                class: 'Alumni XII-MIPA 1 (2025/2026)',
                status: 'alumni'
            };

            const nonRegularStudent = {
                nis: '1003',
                name: 'Made Siswa Non-Reguler',
                class: 'Mutasi'
            };

            const screenRegularHtml = renderKtsFrontHtml(regularStudent, { mode: 'screen' });
            const screenAlumniHtml = renderKtsFrontHtml(alumniStudent, { mode: 'screen' });
            const screenNonRegularHtml = renderKtsFrontHtml(nonRegularStudent, { mode: 'screen' });
            const printAlumniHtml = renderKtsFrontHtml(alumniStudent, { mode: 'print' });

            const results = {
                regScreenHasAktif: screenRegularHtml.includes('SISWA AKTIF'),
                regScreenNoNonaktif: !screenRegularHtml.includes('SISWA NONAKTIF'),
                alumniScreenHasNonaktif: screenAlumniHtml.includes('SISWA NONAKTIF'),
                alumniScreenNoAktif: !screenAlumniHtml.includes('SISWA AKTIF'),
                alumniScreenHasInactiveClass: screenAlumniHtml.includes('kts-status-pill-inactive'),
                nonRegScreenHasNonaktif: screenNonRegularHtml.includes('SISWA NONAKTIF'),
                nonRegScreenNoAktif: !screenNonRegularHtml.includes('SISWA AKTIF'),
                alumniPrintOmitsStatus: !printAlumniHtml.includes('SISWA NONAKTIF') && !printAlumniHtml.includes('SISWA AKTIF')
            };
            console.log(JSON.stringify(results));
        `;

        const rawOutput = execFileSync('node', ['--input-type=module', '-e', nodeScript], {
            cwd: path.join(__dirname, '..'),
            encoding: 'utf8'
        });

        const res = JSON.parse(rawOutput.trim());
        expect(res.regScreenHasAktif).toBe(true);
        expect(res.regScreenNoNonaktif).toBe(true);
        expect(res.alumniScreenHasNonaktif).toBe(true);
        expect(res.alumniScreenNoAktif).toBe(true);
        expect(res.alumniScreenHasInactiveClass).toBe(true);
        expect(res.nonRegScreenHasNonaktif).toBe(true);
        expect(res.nonRegScreenNoAktif).toBe(true);
        expect(res.alumniPrintOmitsStatus).toBe(true);
    });

    // 24. Uji Struktur Tata Letak Modal Pratinjau KTS Wali Kelas (Pas 1 Layar & Kolom Kanan Independent Scroll)
    test('Modal dialog KTS wali-kelas.html mengunci kolom kiri pas 1 layar dan kolom kanan independent scroll', () => {
        const waliHtml = fs.readFileSync(path.join(__dirname, '..', 'wali-kelas.html'), 'utf8');
        const cssCard = fs.readFileSync(path.join(__dirname, '..', 'css', 'card-print.css'), 'utf8');
        const waliJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'page-wali-kelas.js'), 'utf8');

        // Memastikan ID modal dan kelas layout modal
        expect(waliHtml).toContain('id="modal-kts-preview"');
        expect(waliHtml).toContain('lg:h-[620px]');
        expect(waliHtml).toContain('id="modal-kts-preview-left"');
        expect(waliHtml).toContain('id="modal-kts-preview-right"');

        // Kolom kiri terkunci 1 layar utuh tanpa overflow luar
        expect(waliHtml).toContain('lg:overflow-hidden grid grid-cols-1 lg:grid-cols-12');
        expect(waliHtml).toContain('kts-preview-modal-stage');

        // Kolom kanan memiliki overflow-y-auto independen dengan custom-scrollbar
        expect(waliHtml).toContain('lg:h-full lg:overflow-y-auto custom-scrollbar');

        // CSS card-print.css mendefinisikan .kts-preview-modal-stage dan .custom-scrollbar
        expect(cssCard).toContain('.kts-preview-modal-stage');
        expect(cssCard).toContain('.custom-scrollbar');
        expect(cssCard).toContain('scrollbar-width: thin');

        // JS page-wali-kelas.js mengatur max-width 400px, reset scrollTop dan delegasi wheel
        expect(waliJs).toContain('style="max-width: 400px; cursor: default;"');
        expect(waliJs).toContain('rightColEl.scrollTop = 0;');
        expect(waliJs).toContain('_ktsWheelDelegated');
    });

    // 25. Uji Kepatuhan Publik kartu-shakti.html & Worker: Alamat Domisili Siswa, Alamat Sekolah Resmi, Website Sekolah, dan Zero Data Kontak Ortu/HP (Kepatuhan UU PDP No. 27/2022)
    test('Halaman kartu-shakti.html dan worker public-card endpoint menampilkan Alamat Domisili Siswa, Alamat Sekolah, Website Resmi, serta patuh UU PDP (Zero Kontak Ortu/No HP)', () => {
        const publicHtml = fs.readFileSync(path.join(__dirname, '..', 'kartu-shakti.html'), 'utf8');
        const workerJs = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'worker.js'), 'utf8');

        // 1. Validasi elemen Alamat Domisili & Alamat Sekolah pada kartu-shakti.html (SSOT)
        expect(publicHtml).toContain('id="card-address"');
        expect(publicHtml).toContain('Alamat Domisili');
        expect(publicHtml).toContain('id="card-school-address"');
        expect(publicHtml).toContain('Sekolah Penerbit Dokumen');
        expect(publicHtml).toContain('{{schoolAddress}}, {{schoolPostalCode}}');
        expect(publicHtml).toContain('SCHOOL_CONFIG?.schoolAddress');

        // 2. Validasi Website Resmi Sekolah di kartu-shakti.html (SSOT)
        expect(publicHtml).toContain('id="btn-school-website"');
        expect(publicHtml).toContain('{{schoolWebsite}}');
        expect(publicHtml).toContain('SCHOOL_CONFIG?.schoolWebsite');

        // 3. Kepatuhan Privasi Data Siswa (UU PDP No. 27/2022):
        // Di halaman publik verifikasi kartu terbuka, DILARANG menampilkan No HP, Nomor Telepon, Nama Ibu, Nama Ayah, atau Data Orang Tua
        expect(publicHtml).not.toContain('card-phone');
        expect(publicHtml).not.toContain('card-parent');
        expect(publicHtml).not.toContain('card-ortu');
        expect(publicHtml).not.toContain('Nomor HP');
        expect(publicHtml).not.toContain('Nama Orang Tua');
        expect(publicHtml).not.toContain('Nama Ayah');
        expect(publicHtml).not.toContain('Nama Ibu');

        // 4. Validasi endpoint Cloudflare Worker (/api/students/public-card/*)
        expect(workerJs).toContain('s.dapodik_data');
        expect(workerJs).toContain('alamat_domisili: formattedStudentAddress');
        expect(workerJs).toContain('sekolah: PUBLIC_SCHOOL_IDENTITY');
        const { PUBLIC_SCHOOL_IDENTITY: identity } = require('./helpers/worker-source.cjs').loadWorkerLibModule('lib/school-identity.js');
        const schoolConfig = fs.readFileSync(path.join(__dirname, '..', 'js/school-config.js'), 'utf8');
        const configValue = key => schoolConfig.match(new RegExp(`${key}:\\s*['"]([^'"]+)`))[1];
        expect(identity.nama).toBe(configValue('schoolName'));
        expect(identity.npsn).toBe(configValue('schoolNPSN'));
        expect(identity.website).toBe(configValue('schoolWebsite'));
        expect(identity.alamat).toBe(`${configValue('schoolAddressFull')} ${configValue('schoolPostalCode')}`);

        // Memastikan worker tidak membocorkan No HP / Nama Ortu di publicCardData
        const publicCardIdx = workerJs.indexOf('const publicCardData = {');
        const publicCardEnd = workerJs.indexOf('const res = jsonResponse({', publicCardIdx);
        const publicCardBlock = workerJs.substring(publicCardIdx, publicCardEnd);

        expect(publicCardBlock).not.toContain('phone');
        expect(publicCardBlock).not.toContain('telepon');
        expect(publicCardBlock).not.toContain('no_hp');
        expect(publicCardBlock).not.toContain('parent');
        expect(publicCardBlock).not.toContain('nama_ayah');
        expect(publicCardBlock).not.toContain('nama_ibu');
        expect(publicCardBlock).not.toContain('nik');
    });

    // 26. Uji Fitur Hapus Foto Siswa oleh Wali Kelas & Super Admin dengan Konfirmasi Ketik Teks "HAPUS"
    test('Wali Kelas dan Super Admin dapat menghapus pasfoto siswa di kartu pelajar dengan konfirmasi ketik HAPUS', () => {
        const workerJs = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'worker.js'), 'utf8');
        const clientJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'cloudflare-client.js'), 'utf8');
        const waliHtml = fs.readFileSync(path.join(__dirname, '..', 'wali-kelas.html'), 'utf8');
        const waliJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'page-wali-kelas.js'), 'utf8');
        const siswaHtml = fs.readFileSync(path.join(__dirname, '..', 'siswa.html'), 'utf8');
        const studentsJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'page-students.js'), 'utf8');

        // 1. Endpoint Cloudflare Worker DELETE /api/students/photo/:nis
        expect(workerJs).toContain('/api/students/photo/');
        expect(workerJs).toContain('DELETE');
        expect(workerJs).toContain('isStaffOrTeacher(user)');
        expect(workerJs).toContain('deleteStudentPhotosFromR2');
        expect(workerJs).toContain('active_photo_url = NULL');
        expect(workerJs).toContain('status = \'none\'');

        // 2. Cloudflare Client SDK
        expect(clientJs).toContain('deleteStudentPhoto(nis)');
        expect(clientJs).toContain('/api/students/photo/');

        // 3. UI Modal KTS Wali Kelas (wali-kelas.html & js/page-wali-kelas.js)
        expect(waliHtml).toContain('id="btn-kts-delete-photo"');
        expect(waliHtml).toContain('window.deleteStudentPhotoWali()');
        expect(waliJs).toContain('window.deleteStudentPhotoWali = async function');
        expect(waliJs).toContain('Ketik kata <b>HAPUS</b>');
        expect(waliJs).toContain('cfClient.deleteStudentPhoto');

        // 4. UI Modal Edit Siswa Admin (siswa.html & js/page-students.js)
        expect(siswaHtml).toContain('id="edit-student-photo-section"');
        expect(siswaHtml).toContain('id="btn-delete-student-photo-admin"');
        expect(siswaHtml).toContain('window.deleteStudentPhotoAdmin()');
        expect(studentsJs).toContain('window.deleteStudentPhotoAdmin = async function');
        expect(studentsJs).toContain('Ketik kata <b>HAPUS</b>');
        expect(studentsJs).toContain('cfClient.deleteStudentPhoto');
    });

    // 27. Uji Integrasi Binding Window & Deklarasi Variabel Kartu Pelajar di Portal Siswa (js/page-portal-siswa.js)
    test('page-portal-siswa.js mendeklarasikan variabel kartu pelajar di lingkup modul dan mengikat fungsi ke window secara lengkap tanpa runtime ReferenceError', () => {
        const portalJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'page-portal-siswa.js'), 'utf8');

        // Deklarasi variabel modul wajib
        expect(portalJs).toMatch(/let\s+studentCardPhotoInfo\s*=\s*null;/);
        expect(portalJs).toMatch(/let\s+cropImageObj\s*=\s*null;/);
        expect(portalJs).toMatch(/let\s+cropScale\s*=\s*1\.0;/);
        expect(portalJs).toMatch(/const\s+initialToken\s*=\s*effectiveToken;/);

        // Definisi fungsi wrapper QR Code
        expect(portalJs).toContain('function renderStudentCardQrCode(target, token)');
        expect(portalJs).toContain('function renderStudentCardFrontQrCode(publicToken)');
        expect(portalJs).toContain('function renderStudentCardBackQrCode(nis)');

        // Window bindings lengkap
        expect(portalJs).toContain('window.loadStudentCardData = loadStudentCardData;');
        expect(portalJs).toContain('window.flipDigitalCard = flipDigitalCard;');
        expect(portalJs).toContain('window.setStudentCardSide = setStudentCardSide;');
        expect(portalJs).toContain('window.renderStudentCardFrontQrCode = renderStudentCardFrontQrCode;');
        expect(portalJs).toContain('window.renderStudentCardBackQrCode = renderStudentCardBackQrCode;');
        expect(portalJs).toContain('window.renderStudentCardQrCode = renderStudentCardQrCode;');
        expect(portalJs).toContain('window.openCropPhotoModal = openCropPhotoModal;');
        expect(portalJs).toContain('window.closeCropPhotoModal = closeCropPhotoModal;');
        expect(portalJs).toContain('window.handlePasfotoFileSelect = handlePasfotoFileSelect;');
        expect(portalJs).toContain('window.zoomCropPhoto = zoomCropPhoto;');
        expect(portalJs).toContain('window.resetCropPhoto = resetCropPhoto;');
        expect(portalJs).toContain('window.submitCroppedPhoto = submitCroppedPhoto;');
        expect(portalJs).toContain('window.downloadStudentCardPng = downloadStudentCardPng;');
        expect(portalJs).toContain('window.openKtsDownloadModal = openKtsDownloadModal;');
        expect(portalJs).toContain('window.printSingleStudentCard = printSingleStudentCard;');
        expect(portalJs).toContain('window.previewPendingPhotoModal = previewPendingPhotoModal;');
        expect(portalJs).toContain('window.closePendingPhotoModal = closePendingPhotoModal;');
    });

    // 28. Uji Real-time Sync Status Pasfoto Rombel & Layout Ultra-Compact Tab Master Siswa Wali Kelas
    test('Wali Kelas memprioritaskan D1 SQL untuk deteksi foto pending dan tabel Master Siswa menerapkan layout ultra-compact', () => {
        const waliJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'page-wali-kelas.js'), 'utf8');
        const waliHtml = fs.readFileSync(path.join(__dirname, '..', 'wali-kelas.html'), 'utf8');
        const workerJs = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'worker.js'), 'utf8');

        // 1. Worker D1 class query mendukung toleransi titik dan strip
        expect(workerJs).toContain("REPLACE(s.class, '-', '.') = REPLACE(?, '-', '.')");

        // 2. JS Wali Kelas memprioritaskan pemanggilan Cloudflare D1
        expect(waliJs).toContain('cfClient.getStudents({ class: className, status: \'all\', limit: 150 })');
        expect(waliJs).toContain('async function syncRombelPhotoStatuses');
        expect(waliJs).toContain('window.syncRombelPhotoStatuses = syncRombelPhotoStatuses;');

        // 3. Layout ultra-compact tabel Master Siswa (nama disempitkan, NIS/NISN bertumpuk vertikal)
        expect(waliJs).toContain('max-w-[125px]');
        expect(waliJs).toContain('truncate max-w-[105px]');
        expect(waliHtml).toContain('text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-tight');
        expect(waliJs).toContain('animate-pulse');
        expect(waliJs).toContain('window.openVerifyPhotoModal');
    });

    // 29. Uji Pratinjau Visual Pasfoto Baru yang Diajukan Siswa di Samping Banner Peninjauan Wali Kelas
    test('Portal Siswa menampilkan thumbnail pratinjau pasfoto yang diajukan di banner pending dan menyediakan modal perbesar foto', () => {
        const portalHtml = fs.readFileSync(path.join(__dirname, '..', 'portal-siswa.html'), 'utf8');
        const portalJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'page-portal-siswa.js'), 'utf8');

        // 1. Banner pending memuat thumbnail pasfoto diajukan dengan rasio 3:4
        expect(portalHtml).toContain('id="student-pending-photo-preview"');
        expect(portalHtml).toContain('window.previewPendingPhotoModal');
        expect(portalHtml).toContain('Foto Diajukan');

        // 2. Modal perbesar pratinjau pasfoto diajukan tersedia
        expect(portalHtml).toContain('id="modal-preview-pending-photo"');
        expect(portalHtml).toContain('id="modal-pending-photo-img"');
        expect(portalHtml).toContain('window.closePendingPhotoModal');

        // 3. JS menangani pembaruan foto pending di banner dan modal zoom
        expect(portalJs).toContain("document.getElementById('student-pending-photo-preview')");
        expect(portalJs).toContain("document.getElementById('modal-pending-photo-img')");
        expect(portalJs).toContain('function previewPendingPhotoModal()');
        expect(portalJs).toContain('function closePendingPhotoModal()');
        expect(portalJs).toContain('window.previewPendingPhotoModal = previewPendingPhotoModal;');
        expect(portalJs).toContain('window.closePendingPhotoModal = closePendingPhotoModal;');
    });

    // 30. Uji Akselerasi Unduh Kartu Pelajar Digital: Cache Sisi Belakang Standar, Cache Font WOFF2, & Paralelisasi Render
    test('StudentCardRenderer, StudentCardFonts, dan StudentCardExport mengimplementasikan akselerasi performa unduh terpadu', () => {
        const { execFileSync } = require('node:child_process');
        const rendererContent = fs.readFileSync(path.join(__dirname, '..', 'js', 'student-card-renderer.js'), 'utf8');
        const fontsContent = fs.readFileSync(path.join(__dirname, '..', 'js', 'student-card-fonts.js'), 'utf8');
        const exportContent = fs.readFileSync(path.join(__dirname, '..', 'js', 'student-card-export.js'), 'utf8');

        // 1. Paralelisasi generateKtsBothCanvas
        expect(rendererContent).toContain('Promise.all([');
        expect(rendererContent).toContain('generateKtsFrontCanvas(student, options)');
        expect(rendererContent).toContain('generateKtsBackCanvas(student, options)');

        // 2. Cache sisi belakang standar & cloneCanvas
        expect(rendererContent).toContain('cachedStandardBackCanvas');
        expect(rendererContent).toContain('cloneCanvas(cachedStandardBackCanvas)');
        expect(rendererContent).toContain('clearKtsBackCanvasCache');

        // 3. Cache Font WOFF2 & paralelisasi fetch font
        expect(fontsContent).toContain('fontCssCache');
        expect(fontsContent).toContain('clearCardFontCssCache');
        expect(fontsContent).toContain('Promise.all(fontRuleCandidates.map(');
        expect(fontsContent).toContain('Promise.all(sheets.map(');

        // 4. Cache modul gambar statis
        expect(exportContent).toContain('staticImageCache');
        expect(exportContent).toContain('clearStaticImageCache');

        // 5. Uji eksekusi modul node ES
        const nodeScript = `
            import { clearKtsBackCanvasCache } from './js/student-card-renderer.js';
            import { clearCardFontCssCache } from './js/student-card-fonts.js';
            import { clearStaticImageCache } from './js/student-card-export.js';

            const results = {
                hasClearBackCache: typeof clearKtsBackCanvasCache === 'function',
                hasClearFontCache: typeof clearCardFontCssCache === 'function',
                hasClearImageCache: typeof clearStaticImageCache === 'function'
            };
            console.log(JSON.stringify(results));
        `;

        const rawOutput = execFileSync('node', ['--input-type=module', '-e', nodeScript], {
            cwd: path.join(__dirname, '..'),
            encoding: 'utf8'
        });

        const res = JSON.parse(rawOutput.trim());
        expect(res.hasClearBackCache).toBe(true);
        expect(res.hasClearFontCache).toBe(true);
        expect(res.hasClearImageCache).toBe(true);
    });

    // 31. Uji Proteksi Otorisasi RBAC Cetak & Pratinjau KTS di Panel Data Siswa (siswa.html / js/page-students.js)
    test('Panel Data Siswa membatasi tombol dan eksekusi cetak KTS hanya untuk super_admin, staff, dan kesiswaan', () => {
        const studentsJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'page-students.js'), 'utf8');

        // 1. Variabel canPrintKts memeriksa peran super_admin, staff, dan kesiswaan
        expect(studentsJs).toContain('const canPrintKts = window.hasRole ?');
        expect(studentsJs).toContain("window.hasRole('super_admin') || window.hasRole('staff') || window.hasRole('kesiswaan')");
        expect(studentsJs).toContain("['super_admin', 'staff', 'kesiswaan'].includes(currentRole)");

        // 2. Tombol KTS di renderTable dibungkus dengan guard canPrintKts dan memanggil openKtsPreviewModal
        expect(studentsJs).toContain('${canPrintKts ? `');
        expect(studentsJs).toContain("window.openKtsPreviewModal('${s.nis || s.id}')");

        // 3. Fungsi eksekusi window.openKtsPreviewModal memiliki proteksi runtime RBAC
        expect(studentsJs).toContain('window.openKtsPreviewModal = async function');
        expect(studentsJs).toContain("Pencetakan dan pratinjau Kartu Pelajar dari panel ini hanya diizinkan untuk Super Admin, Staff Tata Usaha, dan Kesiswaan");

        // 4. Backward compatibility wrapper printStudentKtsAdmin
        expect(studentsJs).toContain('window.printStudentKtsAdmin = async function');
        expect(studentsJs).toContain('await window.openKtsPreviewModal(studentIdOrNis)');
    });

    // 32. Uji Modal Pratinjau Interaktif KTS & Informasi Publik di Panel Siswa (siswa.html & js/page-students.js) Tanpa Edit/Hapus Foto
    test('Panel Siswa menyediakan modal pratinjau interaktif KTS 2-kolom dengan tombol cetak dan unduh PNG tanpa opsi edit/hapus foto', () => {
        const siswaHtml = fs.readFileSync(path.join(__dirname, '..', 'siswa.html'), 'utf8');
        const studentsJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'page-students.js'), 'utf8');

        // 1. Modal KTS Preview ada di siswa.html
        expect(siswaHtml).toContain('id="modal-kts-preview"');
        expect(siswaHtml).toContain('id="kts-card-render-box"');
        expect(siswaHtml).toContain('id="modal-kts-preview-left"');
        expect(siswaHtml).toContain('id="modal-kts-preview-right"');

        // 2. Switcher Sisi Kartu (Depan / Belakang)
        expect(siswaHtml).toContain('id="btn-kts-side-front"');
        expect(siswaHtml).toContain('id="btn-kts-side-back"');
        expect(siswaHtml).toContain("window.setKtsSideView('front')");
        expect(siswaHtml).toContain("window.setKtsSideView('back')");
        expect(siswaHtml).toContain('window.setKtsSideView = window.setKtsSideView || function');

        // 3. Tombol Aksi di Modal: Hanya Unduh PNG dan Cetak KTS (TANPA Edit / Hapus Foto)
        expect(siswaHtml).toContain('window.downloadKtsModalPng');
        expect(siswaHtml).toContain('window.printCurrentKtsModal()');

        // Ekstrak blok modal-kts-preview untuk memastikan tidak ada fitur edit/hapus foto
        const modalStartIndex = siswaHtml.indexOf('id="modal-kts-preview"');
        const modalEndIndex = siswaHtml.indexOf('<!-- Print Area (Hidden) -->', modalStartIndex);
        expect(modalStartIndex).toBeGreaterThan(0);
        expect(modalEndIndex).toBeGreaterThan(modalStartIndex);
        const modalKtsSection = siswaHtml.substring(modalStartIndex, modalEndIndex);

        // Pastikan TIDAK ADA tombol hapus foto maupun edit/upload foto di modal KTS siswa.html
        expect(modalKtsSection).not.toContain('id="btn-kts-delete-photo"');
        expect(modalKtsSection).not.toContain('deleteStudentPhoto');
        expect(modalKtsSection).not.toContain('openCropPhotoModal');
        expect(modalKtsSection).not.toContain('type="file"');
        expect(modalKtsSection).not.toContain('edit-photo');

        // 4. Field Informasi Publik Hasil Scan QR Code
        expect(siswaHtml).toContain('id="pub-info-name"');
        expect(siswaHtml).toContain('id="pub-info-nis-nisn"');
        expect(siswaHtml).toContain('id="pub-info-class"');
        expect(siswaHtml).toContain('id="pub-info-gender"');
        expect(siswaHtml).toContain('id="pub-info-ttl"');
        expect(siswaHtml).toContain('id="pub-info-status"');
        expect(siswaHtml).toContain('id="pub-info-verified"');
        expect(siswaHtml).toContain('id="pub-info-token"');
        expect(siswaHtml).toContain('id="link-test-public-card"');
        expect(siswaHtml).toContain('UU PDP No. 27/2022');

        // 5. Ekspor dan binding window di js/page-students.js
        expect(studentsJs).toContain('window.openKtsPreviewModal = async function');
        expect(studentsJs).toContain('window.closeKtsPreviewModal = function');
        expect(studentsJs).toContain('window.setKtsSideView = function');
        expect(studentsJs).toContain('window.printCurrentKtsModal = async function');
        expect(studentsJs).toContain('window.downloadKtsModalPng = async function');
        expect(studentsJs).toContain('window.printStudentKtsAdmin = async function');
        expect(studentsJs).toContain('renderKtsPreviewCard()');
        expect(studentsJs).toContain('buildKtsScreenCardMarkup');
    });

    // 32. Uji Layout Multi-Line Alamat Siswa Kartu Pelajar (2 Baris Line Clamp & Proteksi Posisi Footer Depan)
    test('Alamat siswa pada kartu pelajar mendukung multi-line 2 baris proporsional tanpa menggeser footer depan', () => {
        const cssContent = fs.readFileSync(path.join(__dirname, '..', 'css', 'card-print.css'), 'utf8');
        const rendererJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'student-card-renderer.js'), 'utf8');
        const portalHtml = fs.readFileSync(path.join(__dirname, '..', 'portal-siswa.html'), 'utf8');

        // 1. CSS card-print.css mengonfigurasi line clamp 2 baris dan proteksi footer
        expect(cssContent).toContain('.kts-identity-address {');
        expect(cssContent).toContain('-webkit-line-clamp: 2 !important;');
        expect(cssContent).toContain('word-break: break-word !important;');
        expect(cssContent).toContain('white-space: normal !important;');
        expect(cssContent).toContain('.kts-front-footer {');
        expect(cssContent).toContain('flex-shrink: 0 !important;');

        // 2. Renderer JS menggunakan line-clamp-2 dan kts-front-footer
        expect(rendererJs).toContain('kts-identity-address text-[9.5px] font-semibold text-[#0F172A] leading-tight block line-clamp-2');
        expect(rendererJs).toContain('kts-front-footer relative z-10 flex items-center justify-between');

        // 3. Portal Siswa HTML selaras
        expect(portalHtml).toContain('id="kts-front-address" class="kts-identity-address text-[9.5px] font-semibold text-[#0F172A] leading-tight block line-clamp-2"');
        expect(portalHtml).toContain('kts-front-footer relative z-10 flex items-center justify-between');
    });
});






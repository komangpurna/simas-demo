const fs = require('fs');
const path = require('path');

describe('Verifikasi Integritas Auth updateProfile & Edit Profil Pengguna', () => {
    const globalPath = path.join(__dirname, '../js/global.js');
    const dashboardPath = path.join(__dirname, '../dashboard.html');
    const globalSource = fs.readFileSync(globalPath, 'utf8');
    const dashboardSource = fs.readFileSync(dashboardPath, 'utf8');

    describe('1. Import Modul Firebase Auth di js/global.js', () => {
        test('global.js mengimpor updateProfile dari modul resmi Firebase Auth SDK', () => {
            const authImportRegex = /import\s*\{([^}]+)\}\s*from\s*["']https:\/\/www\.gstatic\.com\/firebasejs\/11\.0\.2\/firebase-auth\.js["']/;
            const match = globalSource.match(authImportRegex);
            expect(match).not.toBeNull();
            const importedSymbols = match[1].split(',').map(s => s.trim());
            expect(importedSymbols).toContain('updateProfile');
            expect(importedSymbols).toContain('onAuthStateChanged');
            expect(importedSymbols).toContain('signOut');
            expect(importedSymbols).toContain('updateEmail');
            expect(importedSymbols).toContain('updatePassword');
            expect(importedSymbols).toContain('reauthenticateWithCredential');
            expect(importedSymbols).toContain('EmailAuthProvider');
        });
    });

    describe('2. Logika window.saveEditProfile di js/global.js', () => {
        test('saveEditProfile mengecek typeof updateProfile dan membungkus pemanggilan secara aman', () => {
            const saveProfileIdx = globalSource.indexOf('window.saveEditProfile = async function');
            expect(saveProfileIdx).toBeGreaterThan(-1);
            const saveProfileSnippet = globalSource.slice(saveProfileIdx, saveProfileIdx + 10000);

            expect(saveProfileSnippet).toContain('if (newName !== user.displayName)');
            expect(saveProfileSnippet).toContain("typeof updateProfile === 'function'");
            expect(saveProfileSnippet).toContain('updateProfile(user, { displayName: newName })');
            expect(saveProfileSnippet).toContain('.catch(');
        });
    });

    describe('3. Tailwind hasil build (tanpa Play CDN) di dashboard.html', () => {
        test('dashboard.html memuat css/tailwind.css dan tidak lagi memuat cdn.tailwindcss.com', () => {
            expect(dashboardSource).not.toContain('cdn.tailwindcss.com');
            expect(dashboardSource).toContain('<link rel="stylesheet" href="css/tailwind.css">');
        });
    });

    describe('4. Pemeriksaan Import Firestore di Modul Terkait (Audit Statis)', () => {
        test('js/page-guru.js mengimpor fungsi where dari firebase-firestore.js', () => {
            const pageGuruPath = path.join(__dirname, '../js/page-guru.js');
            const pageGuruSource = fs.readFileSync(pageGuruPath, 'utf8');
            const fsImportRegex = /import\s*\{([^}]+)\}\s*from\s*["']https:\/\/www\.gstatic\.com\/firebasejs\/11\.0\.2\/firebase-firestore\.js["']/;
            const match = pageGuruSource.match(fsImportRegex);
            expect(match).not.toBeNull();
            const symbols = match[1].split(',').map(s => s.trim());
            expect(symbols).toContain('where');
        });

        test('js/page-guru-wali.js menggunakan ISO date string untuk updated_at siswa Cloudflare D1', () => {
            const waliPath = path.join(__dirname, '../js/page-guru-wali.js');
            const waliSource = fs.readFileSync(waliPath, 'utf8');
            expect(waliSource).not.toContain('updated_at: serverTimestamp()');
            expect(waliSource).toContain('updated_at: new Date().toISOString()');
        });

        test('scripts/check-syntax.js memuat audit statis fungsi SDK Firebase', () => {
            const checkSyntaxPath = path.join(__dirname, '../scripts/check-syntax.js');
            const checkSyntaxSource = fs.readFileSync(checkSyntaxPath, 'utf8');
            expect(checkSyntaxSource).toContain('FIREBASE_SDK_EXPORTS');
            expect(checkSyntaxSource).toContain('Undeclared Firebase SDK Call');
        });
    });
});

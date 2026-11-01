/**
 * tests/auth-email-verification.test.js
 * ====================================================================
 * Test Suite: Verifikasi Email GTK & Proteksi Kata Sandi Firebase Auth
 * 
 * Memvalidasi:
 * 1. Paritas endpoint API klien & Worker untuk verifikasi email & update password.
 * 2. Proteksi RBAC Super Admin pada endpoint otentikasi.
 * 3. Integrasi pemanggilan setUserEmailVerified saat admin membuat user baru.
 * 4. Ketersediaan tombol batch verifikasi email dan input ubah kata sandi di users.html.
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Suite Verifikasi Email GTK & Proteksi Kata Sandi Firebase Auth', () => {
    const root = path.resolve(__dirname, '..');
    const workerJsPath = path.join(root, 'cloudflare', 'worker.js');
    const clientJsPath = path.join(root, 'js', 'cloudflare-client.js');
    const pageUsersJsPath = path.join(root, 'js', 'page-users.js');
    const usersHtmlPath = path.join(root, 'users.html');

    const workerJs = fs.readFileSync(workerJsPath, 'utf8');
    const clientJs = fs.readFileSync(clientJsPath, 'utf8');
    const pageUsersJs = fs.readFileSync(pageUsersJsPath, 'utf8');
    const usersHtml = fs.readFileSync(usersHtmlPath, 'utf8');

    describe('1. Paritas Endpoint & Metode Klien', () => {
        test('1.1. cfClient memiliki metode setUserEmailVerified', () => {
            expect(clientJs).toContain('async setUserEmailVerified(');
            expect(clientJs).toContain('/api/auth/verify-user-email');
            expect(workerJs).toContain('path === "/api/auth/verify-user-email" && method === "POST"');
        });

        test('1.2. cfClient memiliki metode batchVerifyUserEmails', () => {
            expect(clientJs).toContain('async batchVerifyUserEmails(');
            expect(clientJs).toContain('/api/auth/batch-verify-emails');
            expect(workerJs).toContain('path === "/api/auth/batch-verify-emails" && method === "POST"');
        });

        test('1.3. cfClient memiliki metode setUserPassword', () => {
            expect(clientJs).toContain('async setUserPassword(');
            expect(clientJs).toContain('/api/auth/update-user-password');
            expect(workerJs).toContain('path === "/api/auth/update-user-password" && method === "POST"');
        });
    });

    describe('2. Keamanan & Proteksi Otorisasi RBAC di Worker', () => {
        test('2.1. verify-user-email hanya mengizinkan super_admin', () => {
            const verifyBlock = workerJs.substring(
                workerJs.indexOf('path === "/api/auth/verify-user-email"'),
                workerJs.indexOf('path === "/api/auth/batch-verify-emails"')
            );
            expect(verifyBlock).toContain('await verifyFirebaseToken(request, env)');
            expect(verifyBlock).toContain('isSuperAdmin');
            expect(verifyBlock).toContain('Forbidden: Khusus Super Admin');
            expect(verifyBlock).toContain('setFirebaseUserEmailVerified');
        });

        test('2.2. batch-verify-emails hanya mengizinkan super_admin', () => {
            const batchBlock = workerJs.substring(
                workerJs.indexOf('path === "/api/auth/batch-verify-emails"'),
                workerJs.indexOf('path === "/api/auth/update-user-password"')
            );
            expect(batchBlock).toContain('isSuperAdmin');
            expect(batchBlock).toContain('Forbidden: Khusus Super Admin');
            expect(batchBlock).toContain('setFirebaseUserEmailVerified');
        });

        test('2.3. update-user-password memvalidasi panjang password minimal 6 karakter', () => {
            const passBlock = workerJs.substring(
                workerJs.indexOf('path === "/api/auth/update-user-password"'),
                workerJs.indexOf('// 🔄 ROUTE: BATCH MIGRATION (/api/migrate/agenda)')
            );
            expect(passBlock).toContain('newPassword.length < 6');
            expect(passBlock).toContain('Kata sandi minimal 6 karakter');
            expect(passBlock).toContain('setFirebaseUserPassword');
        });
    });

    describe('3. Integrasi Pembuatan User & Manajemen Pengguna', () => {
        test('3.1. Pembuatan user di page-users.js otomatis menandai emailVerified: true', () => {
            expect(pageUsersJs).toContain('createUserWithEmailAndPassword');
            expect(pageUsersJs).toContain('setUserEmailVerified(newUid, true)');
        });

        test('3.2. Form edit user mendukung pembaruan kata sandi', () => {
            expect(pageUsersJs).toContain('document.getElementById(\'edit-password\')');
            expect(pageUsersJs).toContain('setUserPassword(uid, newPassword)');
            expect(usersHtml).toContain('id="edit-password"');
        });

        test('3.3. Terdapat tombol batch verifikasi email di users.html', () => {
            expect(usersHtml).toContain('id="btn-sync-emails"');
            expect(usersHtml).toContain('window.syncGtkEmailVerification()');
            expect(pageUsersJs).toContain('window.syncGtkEmailVerification = async () =>');
            expect(pageUsersJs).toContain('cfClient.batchVerifyUserEmails(');
        });
    });
});

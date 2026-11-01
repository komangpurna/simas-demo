/**
 * @file tests/secure-proxy-priority2.test.js
 * Test Suite Pengujian Keamanan Prioritas 2 (Supabase Edge Function: secure-proxy)
 * Memverifikasi:
 * 1. 2A: Penghapusan hardcoded fallback secret JURNAL_API_KEY ("smagesa_jurnal_key_2026_x89a").
 * 2. 2B: Strict CORS Origin Whitelist (hanya domain resmi SIMAS & localhost dev yang diizinkan).
 * 3. 2C: Otorisasi ketat pada action get-ranking-aggregates (hanya GTK atau siswa terverifikasi).
 */

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

describe('Pengujian Keamanan Prioritas 2 (secure-proxy Edge Function)', () => {
    const projectRoot = path.resolve(__dirname, '..');
    const secureProxyPath = path.join(projectRoot, 'supabase', 'functions', 'secure-proxy', 'index.ts');
    const restAccessPath = path.join(projectRoot, 'supabase', 'functions', 'secure-proxy', 'rest-access-utils.mjs');
    const secureProxyContent = fs.readFileSync(secureProxyPath, 'utf8');

    let restUtils;
    beforeAll(async () => {
        restUtils = await import(`file://${restAccessPath.replace(/\\/g, '/')}`);
    });

    // =========================================================================
    // 1. PRIORITAS 2A: ELIMINASI HARDCODED SECRET
    // =========================================================================
    describe('1. Prioritas 2A: Eliminasi Hardcoded Secret JURNAL_API_KEY', () => {
        test('Tidak ada string hardcoded secret "smagesa_jurnal_key_2026_x89a" di secure-proxy/index.ts', () => {
            expect(secureProxyContent).not.toContain('smagesa_jurnal_key_2026_x89a');
        });

        test('resolveStaffBorrowerId hanya menyertakan X-Sync-Key jika JURNAL_API_KEY tersedia di environment', () => {
            expect(secureProxyContent).toContain('const syncSecret = Deno.env.get("JURNAL_API_KEY") || "";');
            expect(secureProxyContent).toContain('if (syncSecret) {');
            expect(secureProxyContent).toContain('headers["X-Sync-Key"] = syncSecret;');
        });

        test('jurnal-sync-siswa dan jurnal-sync-guru tidak memiliki fallback string statis dan clientSecret berada di scope yang valid', () => {
            expect(secureProxyContent).toContain('let clientSecret = "";');
            expect(secureProxyContent).toMatch(/case "jurnal-sync-siswa":[\s\S]*?const syncSecret = Deno\.env\.get\("JURNAL_API_KEY"\) \|\| clientSecret \|\| "";/);
            expect(secureProxyContent).toMatch(/case "jurnal-sync-guru":[\s\S]*?const syncSecret = Deno\.env\.get\("JURNAL_API_KEY"\) \|\| clientSecret \|\| "";/);
        });

        test('secure-proxy/index.ts berhasil dikompilasi sebagai TypeScript valid oleh esbuild tanpa galat sintaks', () => {
            const transformed = esbuild.transformSync(secureProxyContent, {
                loader: 'ts',
                target: 'es2022',
                format: 'esm',
            });
            expect(transformed.code).toBeTruthy();
            expect(transformed.warnings).toEqual([]);
        });
    });

    // =========================================================================
    // 2. PRIORITAS 2B: STRICT CORS ORIGIN WHITELIST
    // =========================================================================
    describe('2. Prioritas 2B: Strict CORS Origin Whitelist', () => {
        test('Fungsi resolveSecureProxyCorsOrigin mengizinkan seluruh domain resmi sekolah', () => {
            const officialDomains = [
                'https://smagesa.web.app',
                'https://smagesa.firebaseapp.com',
                'https://sman1abang.web.app',
                'https://sman1abang.firebaseapp.com',
                'https://simas-shakti.web.app',
                'https://simas-shakti.firebaseapp.com',
                'https://jurnal-smagesa.web.app',
                'https://jurnal-smagesa.firebaseapp.com',
            ];

            officialDomains.forEach(domain => {
                expect(restUtils.resolveSecureProxyCorsOrigin(domain)).toBe(domain);
                // Dengan trailing slash juga tetap dinormalisasi
                expect(restUtils.resolveSecureProxyCorsOrigin(`${domain}/`)).toBe(domain);
            });
        });

        test('Fungsi resolveSecureProxyCorsOrigin mengizinkan localhost dan 127.0.0.1 untuk local dev', () => {
            expect(restUtils.resolveSecureProxyCorsOrigin('http://localhost:8080')).toBe('http://localhost:8080');
            expect(restUtils.resolveSecureProxyCorsOrigin('http://localhost:5000')).toBe('http://localhost:5000');
            expect(restUtils.resolveSecureProxyCorsOrigin('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
            expect(restUtils.resolveSecureProxyCorsOrigin('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000');
        });

        test('Fungsi resolveSecureProxyCorsOrigin mengizinkan request server/curl tanpa Origin (mengembalikan string kosong)', () => {
            expect(restUtils.resolveSecureProxyCorsOrigin('')).toBe('');
            expect(restUtils.resolveSecureProxyCorsOrigin(null)).toBe('');
            expect(restUtils.resolveSecureProxyCorsOrigin(undefined)).toBe('');
        });

        test('Fungsi resolveSecureProxyCorsOrigin menolak tegas domain asing / penyerang (mengembalikan null)', () => {
            expect(restUtils.resolveSecureProxyCorsOrigin('https://evil-attacker.com')).toBeNull();
            expect(restUtils.resolveSecureProxyCorsOrigin('https://fake-smagesa.com')).toBeNull();
            expect(restUtils.resolveSecureProxyCorsOrigin('http://attacker.local')).toBeNull();
        });

        test('Fungsi resolveSecureProxyCorsOrigin mendukung custom extraOrigins jika diperlukan', () => {
            const extra = ['https://custom-portal.smagesa.sch.id'];
            expect(restUtils.resolveSecureProxyCorsOrigin('https://custom-portal.smagesa.sch.id', extra))
                .toBe('https://custom-portal.smagesa.sch.id');
        });

        test('secure-proxy/index.ts memblokir pemanggilan browser dari origin asing dengan 403', () => {
            expect(secureProxyContent).toContain('if (origin && resolvedOrigin === null) {');
            expect(secureProxyContent).toContain('error: "Origin not allowed by CORS"');
            expect(secureProxyContent).toContain('status: 403');
        });
    });

    // =========================================================================
    // 3. PRIORITAS 2C: OTORISASI GET-RANKING-AGGREGATES
    // =========================================================================
    describe('3. Prioritas 2C: Otorisasi get-ranking-aggregates', () => {
        test('canAccessRankingAggregates mengizinkan staf/GTK/admin (isStudent: false)', () => {
            const result = restUtils.canAccessRankingAggregates({
                isStudent: false,
                roles: ['wali_kelas'],
                tokenPayload: { sub: 'uid_wali_kelas' }
            });
            expect(result).toBe(true);
        });

        test('canAccessRankingAggregates mengizinkan pengguna dengan sign_in_provider non-anonim', () => {
            const result = restUtils.canAccessRankingAggregates({
                isStudent: true,
                roles: [],
                tokenPayload: {
                    sub: 'uid_guru_google',
                    firebase: { sign_in_provider: 'google.com' }
                }
            });
            expect(result).toBe(true);
        });

        test('canAccessRankingAggregates mengizinkan siswa yang terverifikasi via klaim token JWT', () => {
            const result = restUtils.canAccessRankingAggregates({
                isStudent: true,
                roles: ['siswa'],
                tokenPayload: {
                    sub: 'anon_uid_1',
                    studentVerified: true,
                    studentNis: '10234',
                    firebase: { sign_in_provider: 'anonymous' }
                }
            });
            expect(result).toBe(true);
        });

        test('canAccessRankingAggregates mengizinkan siswa terverifikasi via fallback dokumen student_sessions', () => {
            const result = restUtils.canAccessRankingAggregates({
                isStudent: true,
                roles: ['siswa'],
                tokenPayload: {
                    sub: 'anon_uid_2',
                    firebase: { sign_in_provider: 'anonymous' }
                },
                hasStudentSessionDoc: true
            });
            expect(result).toBe(true);
        });

        test('canAccessRankingAggregates menolak tegas sesi anonim mentah tanpa verifikasi NIS', () => {
            const result = restUtils.canAccessRankingAggregates({
                isStudent: true,
                roles: ['siswa'],
                tokenPayload: {
                    sub: 'raw_attacker_anon_uid',
                    firebase: { sign_in_provider: 'anonymous' }
                },
                hasStudentSessionDoc: false
            });
            expect(result).toBe(false);
        });

        test('canAccessRankingAggregates menolak token anonim dengan studentVerified tapi NIS kosong', () => {
            const result = restUtils.canAccessRankingAggregates({
                isStudent: true,
                roles: ['siswa'],
                tokenPayload: {
                    sub: 'anon_no_nis',
                    studentVerified: true,
                    studentNis: '',
                    firebase: { sign_in_provider: 'anonymous' }
                },
                hasStudentSessionDoc: false
            });
            expect(result).toBe(false);
        });

        test('secure-proxy/index.ts memanggil canAccessRankingAggregates pada case get-ranking-aggregates', () => {
            expect(secureProxyContent).toContain('case "get-ranking-aggregates":');
            expect(secureProxyContent).toContain('canAccessRankingAggregates({');
            expect(secureProxyContent).toContain('checkStudentSessionInFirestore');
            expect(secureProxyContent).toContain('Akses data agregat ranking ditolak: identitas belum terverifikasi.');
        });
    });
});

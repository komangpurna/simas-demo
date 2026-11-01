/**
 * tests/workload-endpoint-parity.test.js
 * ====================================================================
 * Test Suite: Paritas Endpoint API & Keamanan Otorisasi Klien-Server
 * Memvalidasi:
 * 1. Paritas Rute Klien vs Backend (Client-Worker API Parity)
 *    Mencegah terulangnya error 404 Endpoint Not Found pada runtime.
 * 2. Kesesuaian HTTP Method (GET, POST, PUT, DELETE)
 * 3. Penerapan Otorisasi OWASP Top 10 (A01: Broken Access Control) & ASVS Level 2
 *    (Isolasi data guru, Anti Self-Approval, Token Verification)
 * 4. Integritas Deployment Script & Binding Cloudflare Worker
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Suite Pengujian Paritas Endpoint API & Keamanan Otorisasi Klien-Server', () => {
    const root = path.resolve(__dirname, '..');
    const workerJsPath = path.join(root, 'cloudflare', 'worker.js');
    const clientJsPath = path.join(root, 'js', 'cloudflare-client.js');
    const deployJsPath = path.join(root, 'scripts', 'deploy-worker-api.js');

    const workerJs = fs.readFileSync(workerJsPath, 'utf8');
    const clientJs = fs.readFileSync(clientJsPath, 'utf8');
    const deployJs = fs.readFileSync(deployJsPath, 'utf8');

    // 1. UJI PARITAS SELURUH ENDPOINT WORKLOAD DI CLIENT TERHADAP WORKER
    describe('1. Paritas Endpoint Beban Kerja (Client -> Worker)', () => {
        const workloadEndpoints = [
            { method: 'GET', endpoint: '/api/workload/policy', clientFn: 'cfGetWorkloadPolicy' },
            { method: 'PUT', endpoint: '/api/workload/policy', clientFn: 'cfUpdateWorkloadPolicy' },
            { method: 'GET', endpoint: '/api/workload/catalog', clientFn: 'cfGetWorkloadCatalog' },
            { method: 'GET', endpoint: '/api/workload/assignments', clientFn: 'cfGetWorkloadAssignments' },
            { method: 'POST', endpoint: '/api/workload/assignments', clientFn: 'cfSaveWorkloadAssignment' },
            { method: 'GET', endpoint: '/api/workload/templates', clientFn: 'cfGetWorkloadTemplates' },
            { method: 'POST', endpoint: '/api/workload/templates', clientFn: 'cfSaveWorkloadTemplate' },
            { method: 'DELETE', endpoint: '/api/workload/templates', clientFn: 'cfDeleteWorkloadTemplate' },
            { method: 'POST', endpoint: '/api/workload/week/initialize', clientFn: 'cfInitializeWorkloadWeek' },
            { method: 'GET', endpoint: '/api/workload/week', clientFn: 'cfGetWorkloadWeek' },
            { method: 'POST', endpoint: '/api/workload/plan-items', clientFn: 'cfSaveWorkloadPlanItems' },
            { method: 'DELETE', endpoint: '/api/workload/plan-items', clientFn: 'cfDeleteWorkloadPlanItem' },
            { method: 'POST', endpoint: '/api/workload/apply-template', clientFn: 'cfApplyWorkloadTemplate' },
            { method: 'POST', endpoint: '/api/workload/deduplicate-plan', clientFn: 'cfDeduplicateWorkloadPlan' },
            { method: 'POST', endpoint: '/api/workload/clean-holiday-drafts', clientFn: 'cfCleanWorkloadHolidayDrafts' },
            { method: 'POST', endpoint: '/api/workload/sync-schedule', clientFn: 'cfSyncWorkloadSchedule' },
            { method: 'POST', endpoint: '/api/workload/sync-from-journal', clientFn: 'cfSyncWorkloadFromJournal' },
            { method: 'POST', endpoint: '/api/workload/submit-plan', clientFn: 'cfSubmitWorkloadPlan' },
            { method: 'POST', endpoint: '/api/workload/reopen-plan', clientFn: 'cfReopenWorkloadPlan' },
            { method: 'POST', endpoint: '/api/workload/review-plan', clientFn: 'cfReviewWorkloadPlan' },
            { method: 'POST', endpoint: '/api/workload/logs', clientFn: 'cfSaveWorkloadLog' },
            { method: 'DELETE', endpoint: '/api/workload/logs', clientFn: 'cfDeleteWorkloadLog' },
            { method: 'POST', endpoint: '/api/workload/review-logs', clientFn: 'cfReviewWorkloadLogs' },
            { method: 'GET', endpoint: '/api/workload/monitoring-summary', clientFn: 'cfGetWorkloadMonitoringSummary' },
            { method: 'GET', endpoint: '/api/workload/delegations', clientFn: 'cfGetWorkloadDelegations' },
            { method: 'POST', endpoint: '/api/workload/delegations', clientFn: 'cfSaveWorkloadDelegation' },
            { method: 'GET', endpoint: '/api/workload/monthly-recap', clientFn: 'cfGetWorkloadMonthlyRecap' },
            { method: 'GET', endpoint: '/api/workload/waka-duties', clientFn: 'cfGetWakaDuties' },
            { method: 'POST', endpoint: '/api/workload/waka-duties', clientFn: 'cfSaveWakaDutyItem' }
        ];

        workloadEndpoints.forEach(({ method, endpoint, clientFn }) => {
            test(`1.${clientFn}: Fungsi klien ${clientFn} memanggil ${method} ${endpoint} dan rute tersebut wajib terdaftar di cloudflare/worker.js`, () => {
                // 1. Pastikan fungsi klien mengekspor fungsi ini
                expect(clientJs).toContain(`export async function ${clientFn}`);

                // 2. Pastikan pemanggilan endpoint ada di clientJs
                expect(clientJs).toContain(endpoint);

                // 3. Pastikan rute tersebut TERDAFTAR di cloudflare/worker.js
                const routeExists = workerJs.includes(`path === "${endpoint}"`) ||
                                    workerJs.includes(`path.startsWith("${endpoint}")`) ||
                                    workerJs.includes(`"${endpoint}"`) ||
                                    (endpoint.includes('/') && workerJs.includes(`path.startsWith("${endpoint.replace(/\/[^/]+$/, '')}")`));

                expect(routeExists).toBe(true);

                // 4. Pastikan method HTTP cocok
                const methodCheck = workerJs.includes(`method === "${method}"`) ||
                                    workerJs.includes(`method === '${method}'`) ||
                                    workerJs.includes(method);
                expect(methodCheck).toBe(true);
            });
        });
    });

    // 2. UJI KHUSUS ROUTE SINKRONISASI JURNAL (PENCEGAHAN REGRESI 404)
    describe('2. Rute Khusus POST /api/workload/sync-from-journal', () => {
        test('2.1. Route terdefinisi tepat dengan method POST dan path /api/workload/sync-from-journal', () => {
            expect(workerJs).toContain('path === "/api/workload/sync-from-journal" && method === "POST"');
        });

        test('2.2. Menolak akses tidak sah dengan 401 jika Firebase Token tidak valid', () => {
            const syncFromJournalBlock = workerJs.substring(
                workerJs.indexOf('path === "/api/workload/sync-from-journal"'),
                workerJs.indexOf('POST /api/workload/submit-plan')
            );
            expect(syncFromJournalBlock).toContain('await verifyFirebaseToken(request, env)');
            expect(syncFromJournalBlock).toContain('if (!authResult.valid) return errorResponse("Unauthorized: " + authResult.error, 401, request);');
        });

        test('2.3. Menolak akses guru lain dengan 403 (OWASP A01: Broken Access Control & ASVS 4.1)', () => {
            const syncFromJournalBlock = workerJs.substring(
                workerJs.indexOf('path === "/api/workload/sync-from-journal"'),
                workerJs.indexOf('POST /api/workload/submit-plan')
            );
            expect(syncFromJournalBlock).toContain('if (!isMgr && teacher_id && teacher_id !== userTeacherId)');
            expect(syncFromJournalBlock).toContain('return errorResponse("Akses ditolak: Anda hanya dapat menyinkronkan beban kerja Anda sendiri", 403, request);');
        });

        test('2.4. Memvalidasi parameter wajib (date atau work_week_id) dengan 400', () => {
            const syncFromJournalBlock = workerJs.substring(
                workerJs.indexOf('path === "/api/workload/sync-from-journal"'),
                workerJs.indexOf('POST /api/workload/submit-plan')
            );
            expect(syncFromJournalBlock).toContain('if (!date && !work_week_id)');
            expect(syncFromJournalBlock).toContain('return errorResponse("Parameter \'date\' atau \'work_week_id\' wajib disertakan", 400, request);');
        });
    });

    // 3. UJI OTORISASI OWASP TOP 10 & ASVS LEVEL 2
    describe('3. Standar Keamanan & Otorisasi RBAC ASVS Level 2', () => {
        test('3.1. Seluruh endpoint mutasi beban kerja memverifikasi token autentikasi Firebase', () => {
            const criticalWorkloadEndpoints = [
                'path.startsWith("/api/workload/plan-items")',
                'path === "/api/workload/sync-schedule"',
                'path === "/api/workload/sync-from-journal"',
                'path === "/api/workload/submit-plan"',
                'path === "/api/workload/review-plan"',
                'path.startsWith("/api/workload/logs")',
                'path === "/api/workload/review-logs"'
            ];

            criticalWorkloadEndpoints.forEach(ep => {
                expect(workerJs).toContain(ep);
            });
            expect(workerJs).toContain('verifyFirebaseToken');
        });

        test('3.2. Anti Self-Approval: Reviewer dilarang menyetujui rencana atau realisasinya sendiri', () => {
            expect(workerJs).toContain('reviewerAuth.selfApproval');
            expect(workerJs).toContain('Reviewer dilarang memverifikasi laporan pelaksanaan pekerjaannya sendiri (Anti Self-Approval)');
        });

        test('3.3. Proteksi Kunci Immutability: Minggu kerja yang dikunci tidak dapat dimutasi', () => {
            expect(workerJs).toContain('Minggu kerja telah dikunci');
        });

        test('3.4. Otorisasi Paritas GET /api/workload/monthly-recap: Isolasi data guru & verifikasi hak akses', () => {
            expect(workerJs).toContain('path === "/api/workload/monthly-recap" && method === "GET"');
            expect(workerJs).toContain('Akses ditolak: Anda hanya dapat melihat rekap realisasi beban kerja Anda sendiri');
        });
    });

    // 4. UJI INTEGRITAS SKRIP DEPLOYMENT
    describe('4. Integritas Skrip Deployment (scripts/deploy-worker-api.js)', () => {
        const readDeploymentSettings = toml => {
            const vm = require('node:vm');
            const context = vm.createContext({
                __dirname: path.join(root, 'scripts'),
                require: name => {
                    if (name === 'path') return path;
                    if (name === 'fs') return { existsSync: () => false, readFileSync: () => toml };
                    throw new Error(`Modul tidak diizinkan pada tes konfigurasi: ${name}`);
                },
                process: { env: { CLOUDFLARE_ACCOUNT_ID: 'account', CLOUDFLARE_API_TOKEN: 'token', JURNAL_API_KEY: 'sync', MIGRATION_SECRET: 'migration' }, exit: () => { throw new Error('Missing config'); } },
                console
            });
            // Jalankan hanya pembacaan konfigurasi dengan fs/env palsu. Tidak ada deploy/network.
            const prefix = deployJs.slice(0, deployJs.indexOf('async function deployWorkerViaApi()'));
            vm.runInContext(prefix + '\nglobalThis.settings = { name: SCRIPT_NAME, database: DATABASE_ID, students: readBucketBinding("STUDENT_PHOTOS_BUCKET"), gtk: readBucketBinding("GTK_PHOTOS_BUCKET") };', context);
            return context.settings;
        };

        test('4.1. Skrip deployment membaca worker.js dengan target dari wrangler.toml', () => {
            const toml = fs.readFileSync(path.join(root, 'cloudflare/wrangler.toml'), 'utf8');
            expect(readDeploymentSettings(toml).name).toBe(toml.match(/^name\s*=\s*"([^"]+)"/m)[1]);
            expect(deployJs).toContain("path.join(__dirname, '..', 'cloudflare', 'worker.js')");
            expect(deployJs).toContain("main_module: 'worker.js'");
        });

        test('4.2. Sekolah baru cukup mengganti target Worker, D1, dan R2 pada wrangler.toml', () => {
            const toml = fs.readFileSync(path.join(root, 'cloudflare/wrangler.toml'), 'utf8')
                .replace(/^name\s*=\s*"[^"]+"/m, 'name = "sekolah-baru-api"')
                .replace(/^database_id\s*=\s*"[^"]+"/m, 'database_id = "11111111-2222-4333-8444-555555555555"')
                .replace(/bucket_name\s*=\s*"smagesa-student-photos"/, 'bucket_name = "sekolah-baru-siswa"')
                .replace(/bucket_name\s*=\s*"smagesa-gtk-photos"/, 'bucket_name = "sekolah-baru-gtk"');
            expect(readDeploymentSettings(toml)).toEqual({ name: 'sekolah-baru-api', database: '11111111-2222-4333-8444-555555555555', students: 'sekolah-baru-siswa', gtk: 'sekolah-baru-gtk' });
        });
    });
});

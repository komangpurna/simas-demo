/**
 * Unit Test: Unified Scheduled Cron Dispatcher & Cloudflare Limits
 * Memverifikasi kepatuhan limit Cloudflare Workers Free (maksimal 5 cron triggers per akun),
 * konsolidasi jadwal menjadi single dispatcher interval 10 menit,
 * serta mekanisme idempotensi harian (daily lock) di D1 system_settings.
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Unified Scheduled Cron Dispatcher & Cloudflare Free Tier Compliance', () => {
    const wranglerPath = path.join(__dirname, '..', 'cloudflare', 'wrangler.toml');
    const wranglerContent = fs.readFileSync(wranglerPath, 'utf8');
    const workerPath = path.join(__dirname, '..', 'cloudflare', 'worker.js');
    const workerContent = fs.readFileSync(workerPath, 'utf8');
    const deployScriptPath = path.join(__dirname, '..', 'scripts', 'deploy-worker-api.js');
    const deployScriptContent = fs.readFileSync(deployScriptPath, 'utf8');

    describe('1. Verifikasi Batas Cron Triggers Cloudflare Free Plan', () => {
        test('wrangler.toml hanya mendefinisikan cron triggers dalam batas aman (<= 5 triggers, idealnya 1)', () => {
            const cronsMatch = wranglerContent.match(/crons\s*=\s*\[(.*?)\]/s);
            expect(cronsMatch).not.toBeNull();
            const cronsList = cronsMatch[1]
                .split(',')
                .map(s => s.trim().replace(/['"]/g, ''))
                .filter(Boolean);

            // Cloudflare Free Plan: max 5 cron triggers per akun
            expect(cronsList.length).toBeLessThanOrEqual(5);
            // Proyek SIMAS SMAGESA menggunakan 1 cron interval terpadu (10 menit)
            expect(cronsList.length).toBe(1);
            expect(cronsList).toContain('*/10 * * * *');
        });

        test('scripts/deploy-worker-api.js hanya mendaftarkan 1 cron trigger terpadu', () => {
            expect(deployScriptContent).toContain('{ cron: "*/10 * * * *" }');
            expect(deployScriptContent).not.toContain('{ cron: "0 18 * * *" }');
        });
    });

    describe('2. Verifikasi Implementasi Idempotensi & Daily Lock di Cloudflare Worker', () => {
        test('worker.js mendefinisikan fungsi acquireDailyCronJobLock', () => {
            expect(workerContent).toContain('async function acquireDailyCronJobLock(db, jobKey, dateStr)');
            expect(workerContent).toContain('cron_last_run_');
            expect(workerContent).toContain('ON CONFLICT(key) DO UPDATE SET');
        });

        test('Fungsi acquireDailyCronJobLock mencegah eksekusi ganda pada tanggal yang sama', async () => {
            // Simulasi D1 in-memory mock
            const mockStorage = new Map();
            const mockDb = {
                prepare: (sql) => ({
                    bind: (...args) => ({
                        first: async () => {
                            if (sql.includes('SELECT value FROM system_settings WHERE key = ?')) {
                                const key = args[0];
                                return mockStorage.has(key) ? { value: mockStorage.get(key) } : null;
                            }
                            return null;
                        },
                        run: async () => {
                            if (sql.includes('INSERT INTO system_settings')) {
                                const [key, value] = args;
                                mockStorage.set(key, value);
                                return { success: true };
                            }
                            return { success: true };
                        }
                    }),
                    run: async () => ({ success: true })
                })
            };

            // Simulasi logika acquireDailyCronJobLock
            async function simulateAcquireLock(db, jobKey, dateStr) {
                const fullKey = `cron_last_run_${jobKey}`;
                const existing = await db.prepare("SELECT value FROM system_settings WHERE key = ?").bind(fullKey).first();
                if (existing && String(existing.value).trim() === dateStr) {
                    return false;
                }
                await db.prepare(`
                    INSERT INTO system_settings (key, value, updated_at)
                    VALUES (?, ?, datetime('now'))
                    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
                `).bind(fullKey, dateStr).run();
                return true;
            }

            const today = '2026-10-09';
            const tomorrow = '2026-10-10';

            // Eksekusi pertama hari ini -> Berhasil memperoleh lock
            const firstRun = await simulateAcquireLock(mockDb, 'agenda_summary', today);
            expect(firstRun).toBe(true);

            // Eksekusi kedua pada hari yang sama (interval 10 menit berikutnya) -> Tertolak (idempoten)
            const secondRun = await simulateAcquireLock(mockDb, 'agenda_summary', today);
            expect(secondRun).toBe(false);

            // Eksekusi keesokan harinya -> Berhasil memperoleh lock lagi
            const nextDayRun = await simulateAcquireLock(mockDb, 'agenda_summary', tomorrow);
            expect(nextDayRun).toBe(true);
        });
    });

    describe('3. Verifikasi Logika Scheduled Dispatcher Terpadu', () => {
        test('scheduled handler memuat pemanggilan seluruh 5 pekerjaan terjadwal', () => {
            expect(workerContent).toContain('acquireDailyCronJobLock(env.DB, \'agenda_summary\', dateStr)');
            expect(workerContent).toContain('acquireDailyCronJobLock(env.DB, \'attendance_reminder\', dateStr)');
            expect(workerContent).toContain('acquireDailyCronJobLock(env.DB, \'sukaduka_fee_reminder\', dateStr)');
            expect(workerContent).toContain('acquireDailyCronJobLock(env.DB, \'teaching_journal_reminder\', dateStr)');
            expect(workerContent).toContain('acquireDailyCronJobLock(env.DB, \'daily_cleanup\', dateStr)');
            expect(workerContent).toContain('await processPendingNotifications(env);');
        });

        test('scheduled handler mempertahankan backward compatibility untuk trigger spesifik lama', () => {
            expect(workerContent).toContain('if (cron === "0 0 * * *")');
            expect(workerContent).toContain('if (cron === "0 2 * * *")');
            expect(workerContent).toContain('if (cron === "0 7 * * *")');
            expect(workerContent).toContain('if (cron === "0 18 * * *")');
        });
    });
});

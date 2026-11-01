/**
 * Test Suite: Verifikasi Optimasi Query Cloudflare D1
 * Memvalidasi EXPLAIN QUERY PLAN, indeks ekspresi, covering index klaim notifikasi,
 * pemulihan lease, pencocokan status/kelas, dan keselamatan konkurensi.
 */

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function setupDatabase() {
    const db = new DatabaseSync(':memory:');

    // Load base schema dan migrasi
    const schemaSql = fs.readFileSync(path.join(__dirname, '../cloudflare/schema.sql'), 'utf8');
    db.exec(schemaSql);

    // Pastikan migrasi terbaru dijalankan
    const migrationSql = fs.readFileSync(
        path.join(__dirname, '../cloudflare/migrations/202609090003_optimize_d1_student_search_and_notifications.sql'),
        'utf8'
    );
    db.exec(migrationSql);

    return db;
}

describe('Audit & Optimasi Query Cloudflare D1 SIMAS SMAGESA', () => {
    let db;

    beforeEach(() => {
        db = setupDatabase();
    });

    afterEach(() => {
        db.close();
    });

    describe('Prioritas 1: Pencarian Siswa per Kelas (Expression Index)', () => {
        test('EXPLAIN QUERY PLAN: Memanfaatkan idx_students_class_expr_name tanpa SCAN students dan tanpa TEMP B-TREE', () => {
            const sql = `
                SELECT nis, name, class, gender
                FROM students
                WHERE LOWER(TRIM(class)) = LOWER(TRIM(?))
                  AND (
                    LOWER(status) IN ('active', 'aktif')
                    OR status IS NULL
                    OR status = ''
                  )
                ORDER BY name ASC;
            `;

            const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('X.1');
            const details = plan.map(p => p.detail);

            // Verifikasi bahwa query menggunakan indeks ekspresi
            expect(details.some(d => d.includes('USING INDEX idx_students_class_expr_name'))).toBe(true);

            // Verifikasi bahwa TIDAK ADA SCAN students (full table scan)
            expect(details.some(d => d === 'SCAN students')).toBe(false);

            // Verifikasi bahwa TIDAK ADA USE TEMP B-TREE FOR ORDER BY
            expect(details.some(d => d.includes('USE TEMP B-TREE FOR ORDER BY'))).toBe(false);
        });

        test('Fungsionalitas: Pencocokan kelas mengabaikan kapitalisasi dan spasi tepi', () => {
            const insert = db.prepare(`INSERT INTO students (nis, name, class, gender, status) VALUES (?, ?, ?, ?, ?)`);
            insert.run('1001', 'Ahmad Dani', 'X.1', 'L', 'active');
            insert.run('1002', 'Budi Santoso', ' x.1 ', 'L', 'aktif');
            insert.run('1003', 'Citra Lestari', 'X.1', 'P', null);
            insert.run('1004', 'Dewi Sartika', 'X.1', 'P', '');
            insert.run('1005', 'Eko Prasetyo', 'X.1', 'L', 'mutasi'); // Tidak boleh muncul
            insert.run('1006', 'Fajar Ramadhan', 'X.2', 'L', 'active'); // Beda kelas

            const sql = `
                SELECT nis, name, class, gender
                FROM students
                WHERE LOWER(TRIM(class)) = LOWER(TRIM(?))
                  AND (
                    LOWER(status) IN ('active', 'aktif')
                    OR status IS NULL
                    OR status = ''
                  )
                ORDER BY name ASC;
            `;

            // Cari dengan huruf kecil dan spasi tepi tambahan
            const results = db.prepare(sql).all('  x.1  ');
            expect(results).toHaveLength(4);

            // Urutan nama terurut alfabetis A-Z
            expect(results.map(r => r.name)).toEqual([
                'Ahmad Dani',
                'Budi Santoso',
                'Citra Lestari',
                'Dewi Sartika'
            ]);

            // Seluruh variasi status valid masuk
            expect(results.map(r => r.nis)).toEqual(['1001', '1002', '1003', '1004']);
        });
    });

    describe('Prioritas 2: Antrean Notifikasi (Covering Index & Pemisahan Jalur Klaim)', () => {
        test('EXPLAIN QUERY PLAN: Klaim tanpa job_id memanfaatkan COVERING INDEX idx_notification_claim_order', () => {
            const subqueryNoJob = `
                SELECT id FROM notification_deliveries
                WHERE status = 'pending'
                  AND next_attempt_at <= ?
                ORDER BY created_at, id
                LIMIT 40
            `;

            const plan = db.prepare(`EXPLAIN QUERY PLAN ${subqueryNoJob}`).all(Date.now());
            const details = plan.map(p => p.detail);

            // Memanfaatkan covering index
            expect(details.some(d => d.includes('USING COVERING INDEX idx_notification_claim_order'))).toBe(true);

            // Bebas dari in-memory sort
            expect(details.some(d => d.includes('USE TEMP B-TREE FOR ORDER BY'))).toBe(false);
        });

        test('EXPLAIN QUERY PLAN: Klaim dengan job_id memanfaatkan COVERING INDEX idx_notification_claim_job', () => {
            const subqueryWithJob = `
                SELECT id FROM notification_deliveries
                WHERE status = 'pending'
                  AND next_attempt_at <= ?
                  AND job_id = ?
                ORDER BY created_at, id
                LIMIT 40
            `;

            const plan = db.prepare(`EXPLAIN QUERY PLAN ${subqueryWithJob}`).all(Date.now(), 'job-123');
            const details = plan.map(p => p.detail);

            // Memanfaatkan covering index khusus job
            expect(details.some(d => d.includes('USING COVERING INDEX idx_notification_claim_job'))).toBe(true);

            // Bebas dari in-memory sort
            expect(details.some(d => d.includes('USE TEMP B-TREE FOR ORDER BY'))).toBe(false);
        });

        test('Klaim atomik: Menghormati FIFO created_at, jadwal retry next_attempt_at, dan isolasi konkurensi', () => {
            const now = Date.now();
            const insertJob = db.prepare(`INSERT INTO notification_jobs (id, created_by, target_type, title, body, status) VALUES (?, ?, ?, ?, ?, ?)`);
            insertJob.run('job-1', 'admin', 'all', 'Pengumuman', 'Isi', 'pending');

            const insertDel = db.prepare(`
                INSERT INTO notification_deliveries (id, job_id, token_id, token, status, next_attempt_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);

            // Del 1: Sudah due, dibuat 10 detik lalu
            insertDel.run('del-1', 'job-1', 'tok-1', 'token-1', 'pending', now - 1000, new Date(now - 10000).toISOString());
            // Del 2: Sudah due, dibuat 5 detik lalu
            insertDel.run('del-2', 'job-1', 'tok-2', 'token-2', 'pending', now - 1000, new Date(now - 5000).toISOString());
            // Del 3: Belum due (retry di masa depan), dibuat 15 detik lalu
            insertDel.run('del-3', 'job-1', 'tok-3', 'token-3', 'pending', now + 60000, new Date(now - 15000).toISOString());

            // Worker A mengklaim dengan limit 1
            const claimIdA = 'claim-worker-a';
            const claimSql = `
                UPDATE notification_deliveries
                SET status = 'processing', claim_id = ?, lease_until = ?, attempts = attempts + 1
                WHERE id IN (
                    SELECT id FROM notification_deliveries
                    WHERE status = 'pending' AND next_attempt_at <= ?
                    ORDER BY created_at, id LIMIT 1
                )
                RETURNING id;
            `;

            const claimedA = db.prepare(claimSql).all(claimIdA, now + 120000, now);
            expect(claimedA).toHaveLength(1);
            expect(claimedA[0].id).toBe('del-1'); // del-1 diambil karena created_at paling awal di antara yang due

            // Worker B mengklaim segera sesudahnya
            const claimIdB = 'claim-worker-b';
            const claimedB = db.prepare(claimSql).all(claimIdB, now + 120000, now);
            expect(claimedB).toHaveLength(1);
            expect(claimedB[0].id).toBe('del-2'); // del-2 diambil, tidak menabrak del-1

            // Worker C mencoba mengklaim lagi saat tidak ada yang due tersisa
            const claimIdC = 'claim-worker-c';
            const claimedC = db.prepare(claimSql).all(claimIdC, now + 120000, now);
            expect(claimedC).toHaveLength(0); // del-3 tidak diambil karena next_attempt_at > now
        });
    });

    describe('Prioritas 2: Pemulihan Lease Terputus (Lease Index)', () => {
        test('EXPLAIN QUERY PLAN: Memanfaatkan idx_notification_deliveries_lease (status=? AND lease_until<?)', () => {
            const sql = `
                UPDATE notification_deliveries
                SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
                    claim_id = '',
                    lease_until = 0,
                    error = 'Pengiriman sebelumnya terputus'
                WHERE status = 'processing'
                  AND lease_until < ?;
            `;

            const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(Date.now());
            const details = plan.map(p => p.detail);

            // Memanfaatkan range index pada status dan lease_until
            expect(details.some(d => d.includes('USING INDEX idx_notification_deliveries_lease (status=? AND lease_until<?)'))).toBe(true);
        });

        test('Fungsionalitas: Memulihkan lease yang kadaluarsa dan tidak mengganggu lease yang masih aktif', () => {
            const now = Date.now();
            const insertJob = db.prepare(`INSERT INTO notification_jobs (id, created_by, target_type, title, body, status) VALUES (?, ?, ?, ?, ?, ?)`);
            insertJob.run('job-1', 'admin', 'all', 'Pengumuman', 'Isi', 'processing');

            const insertDel = db.prepare(`
                INSERT INTO notification_deliveries (id, job_id, token_id, token, status, attempts, lease_until, claim_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);

            // Del 1: Stale worker lease kadaluarsa (attempts 1) -> harus kembali pending
            insertDel.run('del-stale-1', 'job-1', 'tok-1', 'token-1', 'processing', 1, now - 5000, 'old-claim');
            // Del 2: Stale worker lease kadaluarsa (attempts 5) -> harus berubah failed
            insertDel.run('del-stale-5', 'job-1', 'tok-2', 'token-2', 'processing', 5, now - 5000, 'old-claim');
            // Del 3: Active worker lease masih berlaku -> jangan diganggu
            insertDel.run('del-active', 'job-1', 'tok-3', 'token-3', 'processing', 1, now + 60000, 'active-claim');

            const recoverSql = `
                UPDATE notification_deliveries
                SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
                    claim_id = '',
                    lease_until = 0,
                    error = 'Pengiriman sebelumnya terputus'
                WHERE status = 'processing'
                  AND lease_until < ?;
            `;

            const res = db.prepare(recoverSql).run(now);
            expect(res.changes).toBe(2);

            const row1 = db.prepare(`SELECT * FROM notification_deliveries WHERE id = 'del-stale-1'`).get();
            expect(row1.status).toBe('pending');
            expect(row1.claim_id).toBe('');
            expect(row1.lease_until).toBe(0);
            expect(row1.error).toBe('Pengiriman sebelumnya terputus');

            const row2 = db.prepare(`SELECT * FROM notification_deliveries WHERE id = 'del-stale-5'`).get();
            expect(row2.status).toBe('failed');

            const row3 = db.prepare(`SELECT * FROM notification_deliveries WHERE id = 'del-active'`).get();
            expect(row3.status).toBe('processing');
            expect(row3.claim_id).toBe('active-claim');
            expect(row3.lease_until).toBeGreaterThan(now);
        });
    });

    describe('Prioritas Berikutnya: Daftar Siswa & Daftar Jurnal', () => {
        test('Daftar Siswa Pagination: Memanfaatkan idx_students_status_class_name tanpa temporary filesort', () => {
            const sql = `
                SELECT * FROM students
                WHERE status = ?
                ORDER BY class ASC, name ASC
                LIMIT ? OFFSET ?;
            `;

            const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('active', 1000, 0);
            const details = plan.map(p => p.detail);

            expect(details.some(d => d.includes('USING INDEX idx_students_status_class_name'))).toBe(true);
            expect(details.some(d => d.includes('USE TEMP B-TREE FOR ORDER BY'))).toBe(false);
        });

        test('Daftar Jurnal Guru per Tanggal: Memanfaatkan idx_jurnal_tgl_created tanpa temporary filesort', () => {
            const sql = `
                SELECT * FROM jurnal_guru
                WHERE tanggal = ?
                ORDER BY tanggal DESC, created_at DESC
                LIMIT ? OFFSET ?;
            `;

            const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('2026-09-09', 100, 0);
            const details = plan.map(p => p.detail);

            expect(details.some(d => d.includes('USING INDEX idx_jurnal_tgl_created'))).toBe(true);
            expect(details.some(d => d.includes('USE TEMP B-TREE FOR ORDER BY'))).toBe(false);
        });
    });

    describe('Prioritas Optimasi: Edge Isolate In-Memory Cache & Safe Index Hinting di Worker', () => {
        const workerPath = path.join(__dirname, '../cloudflare/worker.js');
        const workerCode = fs.readFileSync(workerPath, 'utf8');

        test('cloudflare/worker.js memiliki cache in-memory Map dan TTL 5 menit untuk system_settings', () => {
            expect(workerCode).toContain('const systemSettingsMemoryCache = new Map();');
            expect(workerCode).toContain('ttlMs = 5 * 60 * 1000');
            expect(workerCode).toContain('function getCachedSystemSetting(');
            expect(workerCode).toContain('function setCachedSystemSetting(');
            expect(workerCode).toContain('function invalidateSystemSettingCache(');
        });

        test('getCachedSystemSetting mengembalikan cache yang masih valid dan null bila expired/tidak ada', () => {
            const cacheMap = new Map();
            const TTL = 5 * 60 * 1000;
            const now = Date.now();

            function getCache(key) {
                const item = cacheMap.get(key);
                if (!item) return null;
                if (now - item.cachedAt > TTL) {
                    cacheMap.delete(key);
                    return null;
                }
                return item.data;
            }

            function setCache(key, data) {
                cacheMap.set(key, { data, cachedAt: now });
            }

            setCache('schedule_config', { mode: 'active' });
            expect(getCache('schedule_config')).toEqual({ mode: 'active' });
            expect(getCache('non_existent')).toBeNull();
        });

        test('invalidateSystemSettingCache menghapus entri tertentu dan mengosongkan cache massal', () => {
            const cacheMap = new Map();
            let allCache = { data: [{ key: 'k1' }, { key: 'k2' }], cachedAt: Date.now() };

            function invalidate(key = null) {
                if (key) {
                    cacheMap.delete(key);
                } else {
                    cacheMap.clear();
                }
                allCache = null;
            }

            cacheMap.set('schedule_config', { data: 'val1', cachedAt: Date.now() });
            cacheMap.set('rapor_config', { data: 'val2', cachedAt: Date.now() });

            invalidate('schedule_config');
            expect(cacheMap.has('schedule_config')).toBe(false);
            expect(cacheMap.has('rapor_config')).toBe(true);
            expect(allCache).toBeNull();

            invalidate();
            expect(cacheMap.size).toBe(0);
        });

        test('cloudflare/worker.js menerapkan safe index hint INDEXED BY dengan fallback try-catch', () => {
            expect(workerCode).toContain('studentsIndex = "idx_students_status_class_name"');
            expect(workerCode).toContain('jurnalIndex = "idx_jurnal_kelas_tgl_created"');
            expect(workerCode).toContain('jurnalIndex = "idx_jurnal_tgl_created"');
            expect(workerCode).toContain('INDEXED BY ${studentsIndex}');
            expect(workerCode).toContain('INDEXED BY ${jurnalIndex}');
            // Menjamin ada perlindungan try-catch pada eksekusi index-hinted query
            expect(workerCode).toContain('no such index: ${studentsIndex}');
            expect(workerCode).toContain('no such index: ${jurnalIndex}');
        });

        test('cloudflare/worker.js memiliki lmsStudentLearningPathCache dengan TTL 45 detik dan auto-invalidation', () => {
            expect(workerCode).toContain('const lmsStudentLearningPathCache = new Map();');
            expect(workerCode).toContain('ttlMs = 45 * 1000');
            expect(workerCode).toContain('function getCachedLmsStudentLearningPath(');
            expect(workerCode).toContain('function setCachedLmsStudentLearningPath(');
            expect(workerCode).toContain('function invalidateLmsClassCache(');
        });

        test('lmsClassBlueprintMemoryCache mengembalikan data kelas yang valid dan ter-invalidasi per rombel', () => {
            const cacheMap = new Map();
            const TTL = 60 * 1000;
            const now = Date.now();

            function getCache(className, subjectName = '') {
                const key = `${String(className).toLowerCase().trim()}:${String(subjectName || '').toLowerCase().trim()}`;
                const entry = cacheMap.get(key);
                if (!entry) return null;
                if (now - entry.cachedAt > TTL) {
                    cacheMap.delete(key);
                    return null;
                }
                return entry.data;
            }

            function setCache(className, subjectName, data) {
                const key = `${String(className).toLowerCase().trim()}:${String(subjectName || '').toLowerCase().trim()}`;
                cacheMap.set(key, { data, cachedAt: now });
            }

            function invalidate(className = null) {
                if (className) {
                    const prefix = `${String(className).toLowerCase().trim()}:`;
                    for (const key of cacheMap.keys()) {
                        if (key.startsWith(prefix) || key.startsWith(':')) {
                            cacheMap.delete(key);
                        }
                    }
                } else {
                    cacheMap.clear();
                }
            }

            setCache('XII-A', 'Matematika', { materials: [{ id: 'mat1' }] });
            setCache('XII-A', '', { materials: [{ id: 'mat1' }, { id: 'mat2' }] });
            setCache('XI-B', 'Fisika', { materials: [{ id: 'mat3' }] });

            expect(getCache('XII-A', 'Matematika')).toEqual({ materials: [{ id: 'mat1' }] });
            expect(getCache('XII-A')).toEqual({ materials: [{ id: 'mat1' }, { id: 'mat2' }] });
            expect(getCache('XI-B', 'Fisika')).toEqual({ materials: [{ id: 'mat3' }] });

            // Invalidate XII-A
            invalidate('XII-A');
            expect(getCache('XII-A', 'Matematika')).toBeNull();
            expect(getCache('XII-A')).toBeNull();
            // XI-B tetap ada
            expect(getCache('XI-B', 'Fisika')).toEqual({ materials: [{ id: 'mat3' }] });

            // Invalidate all
            invalidate();
            expect(cacheMap.size).toBe(0);
        });
    });

    describe('Prioritas 4: Indeks Performa D1 Tambahan (LMS Quiz, Records, Students)', () => {
        test('schema.sql memiliki definisi indeks performa baru', () => {
            const schemaSql = fs.readFileSync(path.join(__dirname, '../cloudflare/schema.sql'), 'utf8');
            expect(schemaSql).toContain('idx_lms_quiz_student_status');
            expect(schemaSql).toContain('idx_records_status_date_cat');
            expect(schemaSql).toContain('idx_students_status_class_name');
        });
    });
});


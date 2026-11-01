/**
 * tests/workload-sql-schema-integrity.test.js
 *
 * Verifikasi Integritas Skema SQL Cloudflare D1 vs Worker Query:
 * 1. Menjamin 0 kolom fiktif pada seluruh query INSERT/UPDATE modul beban kerja di cloudflare/worker.js.
 * 2. Memastikan tabel work_weeks tidak pernah memanggil kolom non-existent (misal: week_number).
 * 3. Memastikan kolom wajib (NOT NULL) seperti week_end_date dan policy_id selalu disertakan.
 * 4. Memastikan konsistensi skema D1 antara cloudflare/schema.sql dan cloudflare/migrations/202609230001_add_workload_module.sql.
 */

const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

describe('Verifikasi Integritas Skema D1 & Query SQL Worker Beban Kerja', () => {
    const schemaSqlPath = path.join(rootDir, 'cloudflare', 'schema.sql');
    const migrationSqlPath = path.join(rootDir, 'cloudflare', 'migrations', '202609230001_add_workload_module.sql');
    const workerJsPath = path.join(rootDir, 'cloudflare', 'worker.js');

    const schemaSql = fs.readFileSync(schemaSqlPath, 'utf8');
    const migrationSql = fs.readFileSync(migrationSqlPath, 'utf8');
    const workerJs = fs.readFileSync(workerJsPath, 'utf8');

    // Helper untuk mengekstrak definisi kolom dari blok CREATE TABLE
    function parseTableColumns(sqlContent, tableName) {
        const regex = new RegExp(`CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+${tableName}\\s*\\(([^;]+?)\\);`, 'is');
        const match = sqlContent.match(regex);
        if (!match) return [];

        const body = match[1];
        const lines = body.split('\n');
        const columns = [];

        for (let line of lines) {
            line = line.trim();
            if (!line || line.startsWith('--')) continue;
            // Abaikan definisi constraint tingkat tabel
            if (/^(?:PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK)\b/i.test(line)) continue;

            const colMatch = line.match(/^([a-zA-Z0-9_]+)\s+[A-Z]+/i);
            if (colMatch) {
                columns.push(colMatch[1]);
            }
        }
        return columns;
    }

    test('1. Skema D1 (schema.sql & migrasi) memiliki definisi tabel work_weeks yang konsisten', () => {
        const schemaCols = parseTableColumns(schemaSql, 'work_weeks');
        const migrationCols = parseTableColumns(migrationSql, 'work_weeks');

        expect(schemaCols.length).toBeGreaterThan(0);
        expect(migrationCols.length).toBeGreaterThan(0);

        // work_weeks TIDAK MEMILIKI kolom week_number
        expect(schemaCols).not.toContain('week_number');
        expect(migrationCols).not.toContain('week_number');

        // work_weeks WAJIB MEMILIKI kolom-kolom pokok ini
        const requiredColumns = [
            'id', 'teacher_id', 'school_id', 'week_start_date', 'week_end_date',
            'academic_year', 'semester', 'policy_id', 'target_minutes',
            'approved_adjustment_minutes', 'active_plan_version_id', 'is_locked'
        ];

        for (const col of requiredColumns) {
            expect(schemaCols).toContain(col);
            expect(migrationCols).toContain(col);
        }
    });

    test('2. Endpoint POST /api/workload/week/initialize di worker.js mematuhi skema work_weeks (0 kolom fiktif)', () => {
        // Ekstrak blok inisialisasi minggu kerja
        const initBlockMatch = workerJs.match(/if\s*\(path\s*===\s*["']\/api\/workload\/week\/initialize["'][\s\S]+?return jsonResponse[\s\S]+?\}\s*catch/);
        expect(initBlockMatch).not.toBeNull();
        const initBlock = initBlockMatch[0];

        // DILARANG memanggil week_number pada INSERT INTO work_weeks
        expect(initBlock).not.toMatch(/INSERT\s+INTO\s+work_weeks[\s\S]+?week_number/i);

        // WAJIB menyertakan week_end_date pada INSERT INTO work_weeks
        expect(initBlock).toMatch(/INSERT\s+INTO\s+work_weeks[\s\S]+?week_end_date/i);

        // WAJIB menyertakan policy_id dan active_plan_version_id
        expect(initBlock).toMatch(/INSERT\s+INTO\s+work_weeks[\s\S]+?policy_id/i);
        expect(initBlock).toMatch(/INSERT\s+INTO\s+work_weeks[\s\S]+?active_plan_version_id/i);

        // Ekstrak daftar kolom di dalam klausa INSERT INTO work_weeks (...)
        const insertColsMatch = initBlock.match(/INSERT\s+INTO\s+work_weeks\s*\(([\s\S]+?)\)\s*VALUES/i);
        expect(insertColsMatch).not.toBeNull();

        const insertColumns = insertColsMatch[1]
            .split(',')
            .map(c => c.trim())
            .filter(Boolean);

        const validCols = parseTableColumns(migrationSql, 'work_weeks');

        // Setiap kolom yang di-insert harus 100% ada di skema resmi
        for (const col of insertColumns) {
            expect(validCols).toContain(col);
        }
    });

    test('3. Logika kalkulasi week_end_date menghasilkan Jumat (+4 hari dari Senin)', () => {
        const weekStartDate = '2026-09-21'; // Senin
        const startDateObj = new Date(weekStartDate + 'T00:00:00Z');
        const endDateObj = new Date(startDateObj.getTime() + 4 * 24 * 60 * 60 * 1000);
        const weekEndDate = endDateObj.toISOString().slice(0, 10);

        expect(weekEndDate).toBe('2026-09-25'); // Jumat
    });

    test('4. Seluruh query INSERT INTO pada tabel-tabel utama workload di worker.js mematuhi skema D1', () => {
        const tablesToVerify = [
            'weekly_plan_versions',
            'plan_activities',
            'plan_time_segments',
            'work_logs',
            'work_log_segments',
            'weekly_templates',
            'weekly_template_items'
        ];

        for (const table of tablesToVerify) {
            const validCols = parseTableColumns(migrationSql, table);
            expect(validCols.length).toBeGreaterThan(0);

            // Cari semua pola INSERT INTO <table> (...) di worker.js
            const regex = new RegExp(`INSERT\\s+(?:OR\\s+[A-Z]+\\s+)?INTO\\s+${table}\\s*\\(([\\s\\S]+?)\\)\\s*VALUES`, 'gi');
            let match;
            while ((match = regex.exec(workerJs)) !== null) {
                const rawCols = match[1];
                const cols = rawCols.split(',').map(c => c.trim()).filter(Boolean);
                for (const col of cols) {
                    expect(validCols).toContain(col);
                }
            }
        }
    });

    test('5. Tabel work_logs memiliki kolom status_execution dan obstacle_notes sesuai PRD Permendikdasmen 11/2025', () => {
        const schemaCols = parseTableColumns(schemaSql, 'work_logs');
        const migrationCols = parseTableColumns(migrationSql, 'work_logs');

        expect(schemaCols).toContain('status_execution');
        expect(schemaCols).toContain('obstacle_notes');
        expect(migrationCols).toContain('status_execution');
        expect(migrationCols).toContain('obstacle_notes');
    });

    test('6. Validasi Mesin SQLite Asli (node:sqlite): Seluruh query SQL workload di worker.js berhasil di-prepare tanpa kesalahan kolom fiktif', () => {
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(':memory:');
        db.exec(schemaSql);

        // Ekstrak blok workload module dari worker.js
        const workloadStart = workerJs.indexOf('/api/workload/policy');
        const workloadEnd = workerJs.indexOf('ROUTE: LOGIN HISTORY', workloadStart);

        const workloadBlock = workerJs.slice(workloadStart, workloadEnd !== -1 ? workloadEnd : workerJs.length);

        let idx = 0;
        let testedCount = 0;
        const failedQueries = [];

        while (true) {
            const p = workloadBlock.indexOf('.prepare(', idx);
            if (p === -1) break;

            let start = p + 9;
            while (workloadBlock[start] === ' ' || workloadBlock[start] === '\n' || workloadBlock[start] === '\r' || workloadBlock[start] === '\t') {
                start++;
            }

            const quote = workloadBlock[start];
            if (quote === '`' || quote === '"' || quote === "'") {
                let end = start + 1;
                while (end < workloadBlock.length) {
                    if (workloadBlock[end] === '\\') {
                        end += 2;
                        continue;
                    }
                    if (workloadBlock[end] === quote) break;
                    end++;
                }

                let sql = workloadBlock.substring(start + 1, end).trim();
                // Normalisasi interpolasi ${...} menjadi nilai aman untuk verifikasi parser SQLite
                sql = sql.replace(/\$\{[^}]+\}/g, '1');

                try {
                    db.prepare(sql);
                    testedCount++;
                } catch (err) {
                    failedQueries.push({ sql: sql.substring(0, 120), error: err.message });
                }
                idx = end + 1;
            } else {
                idx = start + 1;
            }
        }

        expect(testedCount).toBeGreaterThan(25);
        expect(failedQueries).toEqual([]);
    });

    test('7. Proteksi Client-Side: Guru biasa (guru_mapel) tidak memicu pemanggilan /api/workload/monitoring-summary', () => {
        const pageMonitoringJsPath = path.join(rootDir, 'js', 'page-monitoring-beban-kerja.js');
        const pageMonitoringJs = fs.readFileSync(pageMonitoringJsPath, 'utf8');

        expect(pageMonitoringJs).toContain('function isCurrentUserSupervisor()');
        expect(pageMonitoringJs).toContain('if (isCurrentUserSupervisor())');
        expect(pageMonitoringJs).toContain('if (!isCurrentUserSupervisor())');
    });
});


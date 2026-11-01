/**
 * scripts/drop_migrated_d1_tables.mjs
 * Menghapus tabel telemetri dan log audit yang telah dimigrasikan 100% ke Supabase PostgreSQL SSOT
 * dari database Cloudflare D1:
 * - workload_audit_logs
 * - employee_activity_history
 * - login_history
 * - audit_logs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.join(__dirname, '..', 'cloudflare', '.env');
const env = {};
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
        const [k, v] = line.split('=');
        if (k && v) env[k.trim()] = v.trim();
    });
}

const ACCOUNT_ID = env.CLOUDFLARE_ACCOUNT_ID || '71a9a782cdd840e36c75c00c1ecd84e3';
const API_TOKEN = env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || '';
const DATABASE_ID = '1676c05c-01a0-409a-99dd-890f4a4011c7';

async function queryD1(sql, params = []) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${API_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sql, params })
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Cloudflare D1 Query Error (HTTP ${res.status}): ${text}`);
    }

    const data = await res.json();
    if (!data.success) {
        throw new Error(`Cloudflare D1 Query Failed: ${JSON.stringify(data.errors)}`);
    }

    return data.result?.[0]?.results || [];
}

async function dropTables() {
    console.log("=== MENGHAPUS TABEL YANG TELAH DIMIGRASIKAN DARI CLOUDFLARE D1 ===");

    const tablesToDrop = [
        'workload_audit_logs',
        'employee_activity_history',
        'login_history',
        'audit_logs'
    ];

    for (const tbl of tablesToDrop) {
        console.log(`[D1] Mengeksekusi: DROP TABLE IF EXISTS ${tbl}...`);
        await queryD1(`DROP TABLE IF EXISTS ${tbl}`);
        console.log(`[D1] Berhasil DROP TABLE ${tbl}`);
    }

    // Verifikasi apakah tabel masih ada
    console.log("[D1] Verifikasi sisa tabel di D1...");
    const remaining = await queryD1("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('workload_audit_logs', 'employee_activity_history', 'login_history', 'audit_logs')");
    
    if (remaining.length === 0) {
        console.log("=== SEMUA 4 TABEL BERHASIL DIHAPUS DARI CLOUDFLARE D1 (0 SISA) ===");
    } else {
        console.warn("[PERINGATAN] Tabel masih ditemukan:", remaining);
    }
}

dropTables().catch(err => {
    console.error("FATAL ERROR DROP TABLES:", err);
    process.exit(1);
});

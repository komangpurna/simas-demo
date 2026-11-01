/**
 * scripts/migrate_telemetry_to_supabase.mjs
 * Script Migrasi Data Riwayat Login & Log Audit dari Cloudflare D1 ke Supabase PostgreSQL
 * 
 * Penggunaan:
 * node scripts/migrate_telemetry_to_supabase.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Kredensial Supabase
const SUPABASE_URL = 'https://elrmzlicuuglnoeedusr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVscm16bGljdXVnbG5vZWVkdXNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MzM4MjQsImV4cCI6MjA5NTMwOTgyNH0.Gq0j07cpV2KQp3TnktTHSXU3ZedBR0Uf6TuU_sioEzE';

// Kredensial Cloudflare D1
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

async function checkSupabaseTable(tableName) {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${tableName}?select=id&limit=1`, {
            method: 'GET',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            }
        });
        return res.ok;
    } catch {
        return false;
    }
}

async function insertBatchToSupabase(tableName, rows) {
    if (!rows || rows.length === 0) return 0;

    const res = await fetch(`${SUPABASE_URL}/rest/v1/${tableName}`, {
        method: 'POST',
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify(rows)
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Supabase Insert Error pada ${tableName} (HTTP ${res.status}): ${text}`);
    }

    return rows.length;
}

async function getSupabaseRowCount(tableName) {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${tableName}?select=id`, {
            method: 'HEAD',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Prefer': 'count=exact'
            }
        });
        const range = res.headers.get('content-range');
        if (range) {
            const parts = range.split('/');
            if (parts.length === 2) return parseInt(parts[1], 10);
        }
        return null;
    } catch {
        return null;
    }
}

async function main() {
    console.log('====================================================================');
    console.log('🚀 MIGRASI TELEMETRI & LOG AUDIT DARI D1 KE SUPABASE POSTGRESQL');
    console.log('====================================================================\n');

    // 1. Cek Kesiapan Tabel di Supabase
    console.log('🔍 Memeriksa kesiapan tabel di Supabase...');
    const hasLoginHistory = await checkSupabaseTable('login_history');
    const hasAuditLogs = await checkSupabaseTable('audit_logs');

    if (!hasLoginHistory || !hasAuditLogs) {
        console.error('\n❌ PERHATIAN: Tabel belum tersedia di Supabase!');
        if (!hasLoginHistory) console.error('  - Tabel `login_history` belum ada');
        if (!hasAuditLogs) console.error('  - Tabel `audit_logs` belum ada');
        console.error('\n👉 LANGKAH YANG HARUS DILAKUKAN:');
        console.error('1. Buka Supabase Dashboard > SQL Editor di: https://supabase.com/dashboard/project/elrmzlicuuglnoeedusr/sql');
        console.error('2. Salin seluruh isi berkas: supabase/migrations/202610060001_create_telemetry_tables.sql');
        console.error('3. Tempel di SQL Editor lalu klik "RUN".');
        console.error('4. Jalankan kembali skrip ini: node scripts/migrate_telemetry_to_supabase.mjs\n');
        process.exit(1);
    }

    console.log('✅ Tabel `login_history` dan `audit_logs` telah aktif dan siap di Supabase!\n');

    // 2. Migrasi login_history
    console.log('📦 Menarik data `login_history` dari Cloudflare D1 (Read-Only, 0 Write Quota)...');
    const loginCountRes = await queryD1('SELECT count(*) as total FROM login_history');
    const totalLogin = loginCountRes[0]?.total || 0;
    console.log(`📊 Ditemukan ${totalLogin} baris login_history di Cloudflare D1.`);

    let migratedLogin = 0;
    const batchSize = 100;
    const pageSize = 500;

    for (let offset = 0; offset < totalLogin; offset += pageSize) {
        const rows = await queryD1(`SELECT * FROM login_history ORDER BY login_at ASC LIMIT ${pageSize} OFFSET ${offset}`);
        for (let i = 0; i < rows.length; i += batchSize) {
            const chunk = rows.slice(i, i + batchSize);
            await insertBatchToSupabase('login_history', chunk);
            migratedLogin += chunk.length;
            process.stdout.write(`\r  -> Berhasil memindahkan ${migratedLogin}/${totalLogin} baris login_history...`);
        }
    }
    console.log(`\n✅ Migrasi login_history tuntas: ${migratedLogin} baris dipindahkan.\n`);

    // 3. Migrasi audit_logs
    console.log('📦 Menarik data `audit_logs` dari Cloudflare D1 (Read-Only, 0 Write Quota)...');
    const auditCountRes = await queryD1('SELECT count(*) as total FROM audit_logs');
    const totalAudit = auditCountRes[0]?.total || 0;
    console.log(`📊 Ditemukan ${totalAudit} baris audit_logs di Cloudflare D1.`);

    let migratedAudit = 0;
    for (let offset = 0; offset < totalAudit; offset += pageSize) {
        const rows = await queryD1(`SELECT * FROM audit_logs ORDER BY timestamp ASC LIMIT ${pageSize} OFFSET ${offset}`);
        for (let i = 0; i < rows.length; i += batchSize) {
            const chunk = rows.slice(i, i + batchSize);
            await insertBatchToSupabase('audit_logs', chunk);
            migratedAudit += chunk.length;
            process.stdout.write(`\r  -> Berhasil memindahkan ${migratedAudit}/${totalAudit} baris audit_logs...`);
        }
    }
    console.log(`\n✅ Migrasi audit_logs tuntas: ${migratedAudit} baris dipindahkan.\n`);

    // 4. Verifikasi Jumlah Baris di Supabase
    console.log('🔍 Memverifikasi total baris akhir di Supabase...');
    const verifyLogin = await getSupabaseRowCount('login_history');
    const verifyAudit = await getSupabaseRowCount('audit_logs');
    console.log(`  - Total login_history di Supabase: ${verifyLogin} baris`);
    console.log(`  - Total audit_logs di Supabase   : ${verifyAudit} baris`);

    console.log('\n🎉 SELURUH DATA TELEMETRI BERHASIL DIPINDAHKAN KE SUPABASE POSTGRESQL!');
}

main().catch(err => {
    console.error('\n❌ Terjadi kesalahan saat migrasi:', err.message);
    process.exit(1);
});

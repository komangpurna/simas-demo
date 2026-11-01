/**
 * scripts/migrate_workload_and_employee_logs.mjs
 * Migrasi data lama dari Cloudflare D1 (workload_audit_logs & employee_activity_history)
 * ke tabel tunggal SSOT audit_logs di Supabase PostgreSQL.
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

async function insertSupabaseBatch(table, rows) {
    if (!rows || rows.length === 0) return { inserted: 0 };
    const BATCH_SIZE = 100;
    let totalInserted = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const chunk = rows.slice(i, i + BATCH_SIZE);
        const url = `${SUPABASE_URL}/rest/v1/${table}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates,return=minimal'
            },
            body: JSON.stringify(chunk)
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Supabase Insert Batch Error (HTTP ${res.status}): ${errText}`);
        }
        totalInserted += chunk.length;
        console.log(`[Supabase] Berhasil insert batch ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length} ke ${table}`);
    }
    return { inserted: totalInserted };
}

async function getSupabaseAuditLogsCount() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/audit_logs?select=id`, {
        method: 'HEAD',
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Prefer': 'count=exact'
        }
    });
    const rangeHeader = res.headers.get('content-range');
    if (rangeHeader) {
        const match = rangeHeader.match(/\/(\d+)/);
        if (match) return parseInt(match[1], 10);
    }
    return null;
}

async function runMigration() {
    console.log("=== MEMULAI MIGRASI WORKLOAD_AUDIT_LOGS & EMPLOYEE_ACTIVITY_HISTORY KE SUPABASE AUDIT_LOGS ===");

    const initialSbCount = await getSupabaseAuditLogsCount();
    console.log(`[Supabase] Jumlah audit_logs sebelum migrasi: ${initialSbCount}`);

    // 1. Ambil data workload_audit_logs dari D1
    console.log("[D1] Mengambil data dari workload_audit_logs...");
    const workloadRows = await queryD1("SELECT * FROM workload_audit_logs ORDER BY created_at ASC");
    console.log(`[D1] Ditemukan ${workloadRows.length} baris di workload_audit_logs.`);

    // Mapping ke struktur audit_logs
    const mappedWorkload = workloadRows.map(row => {
        let action = String(row.action || 'UNKNOWN').trim();
        if (!action.startsWith('WORKLOAD_')) {
            action = `WORKLOAD_${action}`;
        }
        return {
            id: `wl_${row.id}`,
            action: action,
            target_id: `${row.entity_type || 'workload'}:${row.entity_id || ''}`,
            actor_uid: row.actor_uid || 'system',
            actor_name: row.actor_name || 'System',
            old_data: null,
            new_data: null,
            details: row.details ? String(row.details).trim() : null,
            timestamp: row.timestamp || new Date().toISOString()
        };
    });

    if (mappedWorkload.length > 0) {
        console.log(`[Supabase] Memasukkan ${mappedWorkload.length} baris workload audit logs ke Supabase...`);
        const resWl = await insertSupabaseBatch('audit_logs', mappedWorkload);
        console.log(`[Supabase] Selesai: ${resWl.inserted} baris workload dimasukkan.`);
    }

    // 2. Ambil data employee_activity_history dari D1
    console.log("[D1] Mengambil data dari employee_activity_history...");
    const employeeRows = await queryD1("SELECT * FROM employee_activity_history ORDER BY created_at ASC");
    console.log(`[D1] Ditemukan ${employeeRows.length} baris di employee_activity_history.`);

    // Mapping ke struktur audit_logs
    const mappedEmployee = employeeRows.map(row => {
        let action = String(row.action || 'UPDATE').trim();
        if (!action.startsWith('EMPLOYEE_ACTIVITY_')) {
            action = `EMPLOYEE_ACTIVITY_${action}`;
        }
        return {
            id: `emp_act_${row.id}`,
            action: action,
            target_id: row.activity_id || null,
            actor_uid: row.actor_uid || 'system',
            actor_name: row.actor_name || 'System',
            old_data: row.old_data ? String(row.old_data).trim() : null,
            new_data: row.new_data ? String(row.new_data).trim() : null,
            details: null,
            timestamp: row.timestamp || new Date().toISOString()
        };
    });

    if (mappedEmployee.length > 0) {
        console.log(`[Supabase] Memasukkan ${mappedEmployee.length} baris employee activity history ke Supabase...`);
        const resEmp = await insertSupabaseBatch('audit_logs', mappedEmployee);
        console.log(`[Supabase] Selesai: ${resEmp.inserted} baris employee dimasukkan.`);
    }

    const finalSbCount = await getSupabaseAuditLogsCount();
    console.log(`[Supabase] Jumlah audit_logs setelah migrasi: ${finalSbCount} (bertambah ${finalSbCount - initialSbCount} baris).`);
    console.log("=== MIGRASI DATA BERHASIL 100% ===");
}

runMigration().catch(err => {
    console.error("FATAL ERROR MIGRATION:", err);
    process.exit(1);
});

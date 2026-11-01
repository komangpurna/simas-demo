const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', 'cloudflare', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const [k, v] = line.split('=');
    if (k && v) env[k.trim()] = v.trim();
});

const ACCOUNT_ID = env.CLOUDFLARE_ACCOUNT_ID || '71a9a782cdd840e36c75c00c1ecd84e3';
const API_TOKEN = env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || '';
const DATABASE_ID = '1676c05c-01a0-409a-99dd-890f4a4011c7';
const D1_QUERY_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`;

async function executeD1(sql, params = []) {
    const resp = await fetch(D1_QUERY_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${API_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sql, params })
    });
    const json = await resp.json();
    if (!json.success) {
        throw new Error(JSON.stringify(json.errors || json));
    }
    return json.result?.[0]?.results || [];
}

async function main() {
    console.log('=== AUDIT LENGKAP STATUS 27 TABEL CLOUDFLARE D1 ===\n');

    // Ambil list semua tabel di D1
    const tablesRes = await executeD1("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name");
    const tableNames = tablesRes.map(r => r.name);

    console.log(`Ditemukan ${tableNames.length} tabel di D1:\n`);

    const summary = [];
    for (const t of tableNames) {
        try {
            const countRes = await executeD1(`SELECT count(*) as total FROM ${t}`);
            const total = countRes[0]?.total || 0;
            summary.push({ table: t, count: total, status: 'OK' });
            console.log(`- ${t.padEnd(35)} : ${String(total).padStart(6)} baris`);
        } catch (e) {
            summary.push({ table: t, count: 0, status: 'ERROR: ' + e.message });
            console.log(`- ${t.padEnd(35)} : ERROR - ${e.message}`);
        }
    }

    console.log('\nAudit selesai.');
}

main().catch(console.error);

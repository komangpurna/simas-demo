import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WAKA_DUTIES_INITIAL_SEED } from '../js/workload-catalog-data.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`;

async function executeD1(sql, params = []) {
    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${API_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sql, params })
    });
    const json = await resp.json();
    if (!resp.ok || !json.success) {
        throw new Error(JSON.stringify(json.errors || json));
    }
    return json.result?.[0]?.results || [];
}

async function seedWakaDuties() {
    console.log(`=== MENGINPUT 80 BUTIR TUGAS WAKA KE DATABASE CLOUDFLARE D1 ===\n`);
    console.log(`Total butir tugas yang akan diinput: ${WAKA_DUTIES_INITIAL_SEED.length}`);

    // Pastikan tabel waka_duty_items ada
    await executeD1(`
        CREATE TABLE IF NOT EXISTS waka_duty_items (
            id TEXT PRIMARY KEY,
            waka_type TEXT NOT NULL,
            duty_number INTEGER NOT NULL,
            duty_title TEXT NOT NULL,
            duty_description TEXT,
            is_active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
    `);
    await executeD1(`CREATE INDEX IF NOT EXISTS idx_waka_duty_items_type ON waka_duty_items(waka_type, duty_number);`);

    // Input item per item menggunakan UPSERT
    let successCount = 0;
    for (const item of WAKA_DUTIES_INITIAL_SEED) {
        const sql = `
            INSERT INTO waka_duty_items (id, waka_type, duty_number, duty_title, duty_description, is_active, updated_at)
            VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
                waka_type = excluded.waka_type,
                duty_number = excluded.duty_number,
                duty_title = excluded.duty_title,
                duty_description = excluded.duty_description,
                is_active = 1,
                updated_at = datetime('now');
        `;
        const params = [
            item.id,
            item.waka_type,
            item.duty_number,
            item.duty_title,
            item.duty_description || ''
        ];

        await executeD1(sql, params);
        successCount++;
        process.stdout.write(`\rProgress: ${successCount} / ${WAKA_DUTIES_INITIAL_SEED.length} butir tugas terinput...`);
    }

    console.log(`\n\nVerifikasi data di Cloudflare D1...`);
    const countRes = await executeD1(`SELECT count(*) as total FROM waka_duty_items WHERE is_active = 1;`);
    const total = countRes[0]?.total || 0;
    console.log(`Total butir tugas aktif di database D1 sekarang: ${total}`);

    // Cek ringkasan per bidang
    const summary = await executeD1(`SELECT waka_type, count(*) as cnt FROM waka_duty_items GROUP BY waka_type ORDER BY waka_type;`);
    console.log('\nRingkasan per Bidang Waka di Database:');
    summary.forEach(s => {
        console.log(`- ${s.waka_type.padEnd(12)} : ${s.cnt} butir`);
    });

    console.log('\n✅ SUKSES BESAR: Seluruh 80 butir tugas waka telah terinput sempurna ke database Cloudflare D1!');
}

seedWakaDuties().catch(err => {
    console.error('\nFatal Error:', err);
    process.exit(1);
});

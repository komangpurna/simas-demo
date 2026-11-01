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

async function applyMigration() {
    console.log("Applying Migration for Records, Student Aggregates & BK Actions to Cloudflare D1...");
    const migrationFile = path.join(__dirname, '..', 'cloudflare', 'migrations', '202608290005_add_records_aggregates_and_bk_actions.sql');
    let sqlContent = fs.readFileSync(migrationFile, 'utf8');

    // Remove comments
    sqlContent = sqlContent.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

    // Split SQL by statement
    const statements = sqlContent
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0);

    const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`;

    for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i] + ';';
        console.log(`Executing [${i + 1}/${statements.length}]: ${stmt.substring(0, 70).replace(/\s+/g, ' ')}...`);

        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ sql: stmt })
        });

        const json = await resp.json();
        if (!resp.ok || !json.success) {
            console.error(`Error executing statement:`, json);
            throw new Error(`Failed to execute statement ${i + 1}`);
        }
    }

    console.log("✅ Berhasil membuat tabel records, student_aggregates, dan bk_actions di Cloudflare D1!");
}

applyMigration().catch(console.error);

const fs = require('fs');
const path = require('path');

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

async function applyMigration() {
    console.log("Applying PID Games HTML Migration to Cloudflare D1...");
    const statements = [
        "ALTER TABLE pid_games ADD COLUMN source_type TEXT DEFAULT 'url';",
        "ALTER TABLE pid_games ADD COLUMN html_content TEXT;"
    ];

    const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`;

    for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        console.log(`Executing [${i + 1}/${statements.length}]: ${stmt}`);

        try {
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
                const errMsg = json.errors?.[0]?.message || JSON.stringify(json);
                if (errMsg.toLowerCase().includes('duplicate column name') || errMsg.toLowerCase().includes('already exists')) {
                    console.log(`⚠️ Kolom sudah ada di D1: ${errMsg}`);
                } else {
                    console.error(`Error executing statement:`, json);
                    throw new Error(`Failed to execute statement ${i + 1}: ${errMsg}`);
                }
            } else {
                console.log(`✅ Statement [${i + 1}] berhasil dieksekusi!`);
            }
        } catch (err) {
            console.warn(`Peringatan eksekusi stmt ${i + 1}:`, err.message);
        }
    }

    console.log("🎉 Migrasi D1 pid_games html_content selesai!");
}

applyMigration().catch(console.error);

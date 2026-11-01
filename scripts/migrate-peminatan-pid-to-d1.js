const fs = require('fs');
const path = require('path');

// 1. Baca Cloudflare Environment
const envPath = path.join(__dirname, '..', 'cloudflare', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const [k, v] = line.split('=');
    if (k && v) env[k.trim()] = v.trim();
});

const ACCOUNT_ID = env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = env.CLOUDFLARE_API_TOKEN;
const DATABASE_ID = '1676c05c-01a0-409a-99dd-890f4a4011c7';
const D1_QUERY_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`;

// 2. Helper fetch Firestore REST API (project jurnal-smagesa)
const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1/projects/jurnal-smagesa/databases/(default)/documents';

function parseFirestoreValue(val) {
    if (!val) return null;
    if (val.stringValue !== undefined) return val.stringValue;
    if (val.integerValue !== undefined) return parseInt(val.integerValue, 10);
    if (val.doubleValue !== undefined) return parseFloat(val.doubleValue);
    if (val.booleanValue !== undefined) return val.booleanValue;
    if (val.timestampValue !== undefined) return val.timestampValue;
    if (val.nullValue !== undefined) return null;
    if (val.arrayValue !== undefined) {
        return (val.arrayValue.values || []).map(parseFirestoreValue);
    }
    if (val.mapValue !== undefined) {
        const obj = {};
        for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
            obj[k] = parseFirestoreValue(v);
        }
        return obj;
    }
    return null;
}

function parseFirestoreDoc(doc) {
    const id = doc.name.split('/').pop();
    const data = { id };
    for (const [k, v] of Object.entries(doc.fields || {})) {
        data[k] = parseFirestoreValue(v);
    }
    return data;
}

async function fetchAllDocuments(collectionPath) {
    let docs = [];
    let pageToken = null;
    do {
        let url = `${FIRESTORE_BASE}/${collectionPath}?pageSize=300`;
        if (pageToken) url += `&pageToken=${pageToken}`;
        const resp = await fetch(url);
        if (!resp.ok) {
            if (resp.status === 404) return [];
            const text = await resp.text();
            throw new Error(`Failed to fetch ${collectionPath}: ${resp.status} ${text}`);
        }
        const json = await resp.json();
        if (json.documents) {
            docs = docs.concat(json.documents.map(parseFirestoreDoc));
        }
        pageToken = json.nextPageToken;
    } while (pageToken);
    return docs;
}

async function fetchDocument(docPath) {
    const url = `${FIRESTORE_BASE}/${docPath}`;
    const resp = await fetch(url);
    if (!resp.ok) {
        if (resp.status === 404) return null;
        const text = await resp.text();
        throw new Error(`Failed to fetch ${docPath}: ${resp.status} ${text}`);
    }
    const json = await resp.json();
    return parseFirestoreDoc(json);
}

async function executeD1Statements(statements, label = '') {
    if (statements.length === 0) return;
    console.log(`[D1] Menyimpan ${statements.length} baris ${label}...`);
    // Batch query statements into chunks
    const chunkSize = 15;
    for (let i = 0; i < statements.length; i += chunkSize) {
        const chunk = statements.slice(i, i + chunkSize);
        for (const stmt of chunk) {
            const resp = await fetch(D1_QUERY_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${API_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ sql: stmt.sql, params: stmt.params })
            });
            const json = await resp.json();
            if (!resp.ok || !json.success) {
                console.error(`Error executing D1 statement:`, json);
                throw new Error(`D1 execution failed`);
            }
        }
    }
}

async function runMigration() {
    console.log("🚀 Memulai Migrasi Data Peminatan & PID Games dari Firestore ke Cloudflare D1...");

    // ==========================================
    // 1. Migrasi PID Games & Config
    // ==========================================
    console.log("\n📦 1. Mengambil data 'pid_games' dari Firestore...");
    const games = await fetchAllDocuments('pid_games');
    console.log(`Ditemukan ${games.length} game.`);

    const gameStmts = [];
    for (const g of games) {
        const catStr = Array.isArray(g.category) ? JSON.stringify(g.category) : (g.category || 'lainnya');
        const isActive = g.is_active !== undefined ? (g.is_active ? 1 : 0) : 1;
        const reviewStatus = g.review_status || 'approved';
        const createdAt = g.created_at || new Date().toISOString();
        const updatedAt = g.updated_at || createdAt;

        gameStmts.push({
            sql: `
                INSERT INTO pid_games (
                    id, title, description, category, subject, url, thumbnail_url,
                    author, is_active, review_status, review_note,
                    submitted_by_uid, submitted_by_name, submitted_by_role, submitted_at,
                    reviewed_by_uid, reviewed_by_name, reviewed_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title, description = excluded.description, category = excluded.category,
                    subject = excluded.subject, url = excluded.url, thumbnail_url = excluded.thumbnail_url,
                    author = excluded.author, is_active = excluded.is_active, review_status = excluded.review_status,
                    updated_at = excluded.updated_at
            `,
            params: [
                g.id,
                String(g.title || '').trim(),
                g.description || '',
                catStr,
                g.subject || 'UMUM',
                String(g.url || '').trim(),
                g.thumbnail_url || null,
                g.author || 'Admin',
                isActive,
                reviewStatus,
                g.review_note || null,
                g.submitted_by_uid || null,
                g.submitted_by_name || null,
                g.submitted_by_role || null,
                g.submitted_at || null,
                g.reviewed_by_uid || null,
                g.reviewed_by_name || null,
                g.reviewed_at || null,
                createdAt,
                updatedAt
            ]
        });
    }
    await executeD1Statements(gameStmts, 'pid_games');

    // Config PID Games
    const pidConfig = await fetchDocument('metadata/pid_games_config');
    if (pidConfig) {
        console.log(`Menyimpan metadata pid_games_config ke D1...`);
        const configVal = JSON.stringify({
            last_updated: pidConfig.last_updated || new Date().toISOString(),
            allowed_subjects: pidConfig.allowed_subjects || ['Umum', 'Ice Breaking']
        });
        await executeD1Statements([{
            sql: `
                INSERT INTO system_settings (key, value, updated_at)
                VALUES ('pid_games_config', ?, datetime('now'))
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
            `,
            params: [configVal]
        }], 'pid_games_config');
    }

    // ==========================================
    // 2. Migrasi Peminatan Config (Bank Soal & Bobot)
    // ==========================================
    console.log("\n📋 2. Mengambil data 'peminatan_config/questions' dari Firestore...");
    const pemConfig = await fetchDocument('peminatan_config/questions');
    if (pemConfig) {
        console.log(`Ditemukan konfigurasi peminatan dengan ${Array.isArray(pemConfig.items) ? pemConfig.items.length : 0} butir soal.`);
        const isActive = pemConfig.isActive !== undefined ? (pemConfig.isActive ? 1 : 0) : 1;
        const layout = pemConfig.layout || 'classic';
        const itemsStr = JSON.stringify(pemConfig.items || []);
        const weightsStr = JSON.stringify(pemConfig.weights || {});
        const updatedBy = pemConfig.updatedBy || 'Admin BK';

        await executeD1Statements([{
            sql: `
                INSERT INTO peminatan_config (id, is_active, layout, items, weights, updated_by, updated_at)
                VALUES ('questions', ?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(id) DO UPDATE SET
                    is_active = excluded.is_active, layout = excluded.layout,
                    items = excluded.items, weights = excluded.weights,
                    updated_by = excluded.updated_by, updated_at = datetime('now')
            `,
            params: [isActive, layout, itemsStr, weightsStr, updatedBy]
        }], 'peminatan_config');
    }

    // ==========================================
    // 3. Migrasi Peminatan Responses
    // ==========================================
    console.log("\n👥 3. Mengambil data 'peminatan_responses/2026/data' dari Firestore...");
    const years = ['2026', '2025', '2024'];
    let totalResponsesMigrated = 0;

    for (const yr of years) {
        const responses = await fetchAllDocuments(`peminatan_responses/${yr}/data`);
        if (responses.length === 0) continue;
        console.log(`Tahun ${yr}: Ditemukan ${responses.length} respon siswa.`);

        const respStmts = [];
        for (const r of responses) {
            const nis = String(r.nis || r.id).trim();
            const id = `${yr}_${nis}`;
            const ta = r.ta || `${yr}/${Number(yr) + 1}`;
            const name = String(r.name || '').trim();
            const className = r.class || '-';
            const recommendation = r.recommendation || '-';
            const scoresStr = JSON.stringify(r.scores || {});
            const responsesStr = JSON.stringify(r.responses || {});
            const submittedAt = r.submittedAt || r.submitted_at || new Date().toISOString();

            respStmts.push({
                sql: `
                    INSERT INTO peminatan_responses (
                        id, year, ta, nis, name, class, recommendation, scores, responses, submitted_at, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
                    ON CONFLICT(id) DO UPDATE SET
                        ta = excluded.ta, name = excluded.name, class = excluded.class,
                        recommendation = excluded.recommendation, scores = excluded.scores,
                        responses = excluded.responses, submitted_at = excluded.submitted_at,
                        updated_at = datetime('now')
                `,
                params: [id, yr, ta, nis, name, className, recommendation, scoresStr, responsesStr, submittedAt]
            });
        }

        await executeD1Statements(respStmts, `peminatan_responses ${yr}`);
        totalResponsesMigrated += responses.length;
    }

    console.log(`\n🎉 SELESAI! Total data berhasil dimigrasikan ke Cloudflare D1:`);
    console.log(`- PID Games: ${games.length} game`);
    console.log(`- Peminatan Config: 1 doc`);
    console.log(`- Peminatan Responses: ${totalResponsesMigrated} respon siswa`);
}

runMigration().catch(console.error);

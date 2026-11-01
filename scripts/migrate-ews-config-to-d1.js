'use strict';

const fs = require('node:fs');
const path = require('node:path');
const firebaseAuth = require('firebase-tools/lib/auth');

const PROJECT_ID = 'smagesa';
const DEFAULT_DATABASE_ID = '1676c05c-01a0-409a-99dd-890f4a4011c7';
const DEFAULT_WEIGHTS = Object.freeze({
    weightAttendance: 40,
    weightBkPoints: 45,
    weightPermission: 15
});

function readEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return {};
    const values = {};
    for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const separatorIndex = line.indexOf('=');
        if (separatorIndex < 1) continue;
        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
        values[key] = value;
    }
    return values;
}

function normalizeWeights(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const normalized = {
        weightAttendance: Number(value.weightAttendance),
        weightBkPoints: Number(value.weightBkPoints),
        weightPermission: Number(value.weightPermission)
    };
    const weights = Object.values(normalized);
    if (!weights.every(item => Number.isInteger(item) && item >= 0 && item <= 100)) return null;
    return weights.reduce((sum, item) => sum + item, 0) === 100 ? normalized : null;
}

function parseFirestoreValue(value) {
    if (!value) return null;
    if (value.integerValue !== undefined) return Number(value.integerValue);
    if (value.doubleValue !== undefined) return Number(value.doubleValue);
    if (value.stringValue !== undefined) return value.stringValue;
    if (value.booleanValue !== undefined) return value.booleanValue;
    if (value.nullValue !== undefined) return null;
    return null;
}

async function getFirebaseAccessToken() {
    const profileDir = process.env.USERPROFILE || process.env.HOME || '';
    const configPath = path.join(profileDir, '.config', 'configstore', 'firebase-tools.json');
    if (!fs.existsSync(configPath)) {
        throw new Error('Sesi Firebase CLI tidak ditemukan. Jalankan firebase login terlebih dahulu.');
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const refreshToken = config.tokens?.refresh_token;
    if (!refreshToken) throw new Error('Refresh token Firebase CLI tidak tersedia. Jalankan firebase login --reauth.');
    const tokenData = await firebaseAuth.getAccessToken(refreshToken, []);
    if (!tokenData?.access_token) throw new Error('Gagal mendapatkan access token Firebase.');
    return tokenData.access_token;
}

async function readFirestoreWeights(accessToken) {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/settings/ews_config`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (response.status === 404) return { weights: { ...DEFAULT_WEIGHTS }, source: 'default' };
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Firestore gagal dibaca (${response.status}): ${body.slice(0, 300)}`);
    }
    const document = await response.json();
    const parsed = {};
    for (const [key, value] of Object.entries(document.fields || {})) {
        parsed[key] = parseFirestoreValue(value);
    }
    const weights = normalizeWeights(parsed);
    if (!weights) throw new Error('Data settings/ews_config ada, tetapi schema atau total bobotnya tidak valid.');
    return { weights, source: 'firestore' };
}

async function main() {
    const repoRoot = path.join(__dirname, '..');
    const fileEnv = readEnvFile(path.join(repoRoot, 'cloudflare', '.env'));
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || fileEnv.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN || fileEnv.CLOUDFLARE_API_TOKEN;
    const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID || fileEnv.CLOUDFLARE_D1_DATABASE_ID || DEFAULT_DATABASE_ID;
    if (!accountId || !apiToken) {
        throw new Error('CLOUDFLARE_ACCOUNT_ID dan CLOUDFLARE_API_TOKEN wajib tersedia di environment atau cloudflare/.env.');
    }

    const d1Url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
    const queryD1 = async (sql, params = []) => {
        const response = await fetch(d1Url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ sql, params })
        });
        const body = await response.json();
        if (!response.ok || !body.success) {
            throw new Error(`D1 query gagal (${response.status}): ${JSON.stringify(body.errors || body)}`);
        }
        return body.result?.[0]?.results || [];
    };

    const existingRows = await queryD1("SELECT value FROM system_settings WHERE key = 'ews_config' LIMIT 1");
    if (existingRows[0]?.value && !process.argv.includes('--force')) {
        let existing = null;
        try { existing = normalizeWeights(JSON.parse(existingRows[0].value)); } catch (e) {}
        if (existing) {
            console.log('✅ D1 ews_config sudah valid; migrasi tidak mengubah data yang ada.');
            return;
        }
    }

    const accessToken = await getFirebaseAccessToken();
    const { weights, source } = await readFirestoreWeights(accessToken);

    await queryD1(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ('ews_config', ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `, [JSON.stringify(weights)]);

    await queryD1(`
        INSERT INTO audit_logs (
            id, action, target_id, actor_uid, actor_name,
            old_data, new_data, details, timestamp, created_at
        ) VALUES (?, 'MIGRATE_EWS_CONFIG', 'ews_config', 'system', 'Migration Script', NULL, ?, ?, ?, datetime('now'))
    `, [
        `audit_ews_migration_${Date.now()}`,
        JSON.stringify(weights),
        `Migrasi konfigurasi EWS dari ${source} ke Cloudflare D1`,
        new Date().toISOString()
    ]);

    const verificationRows = await queryD1("SELECT value, updated_at FROM system_settings WHERE key = 'ews_config' LIMIT 1");
    let verified = null;
    try { verified = normalizeWeights(JSON.parse(verificationRows[0]?.value || 'null')); } catch (e) {}
    if (!verified) throw new Error('Verifikasi pascamigrasi gagal: nilai D1 tidak valid.');

    console.log(`✅ Migrasi EWS selesai dari ${source}; total bobot 100% dan D1 terverifikasi.`);
    console.log('ℹ️ Dokumen Firestore lama tidak dihapus dan tetap menjadi cadangan sementara.');
}

main().catch(error => {
    console.error('❌ Migrasi EWS gagal:', error.message);
    process.exitCode = 1;
});

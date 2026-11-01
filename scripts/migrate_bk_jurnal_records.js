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
    console.log('=== 1. MIGRASI DATA JURNAL GURU (TIM BK -> SUJANA / SUARDANA) ===');

    // Update Sujana (XII-1, XII-2, XII-4)
    const updateSujana = await executeD1(`
        UPDATE jurnal_guru
        SET guru = 'I Ketut Sujana, S.Pd',
            uid_guru = 'Muc1yTJwJ6i87z4LR8Xq'
        WHERE uid_guru = 'TIM_BK' AND kelas IN ('XII-1', 'XII-2', 'XII-4')
    `);
    console.log('Update Sujana selesai.');

    // Update Suardana (XII-3, XII-5, XII-6)
    const updateSuardana = await executeD1(`
        UPDATE jurnal_guru
        SET guru = 'I Kadek Suardana, S.Pd',
            uid_guru = '57X5boReUhI13AGBng77'
        WHERE uid_guru = 'TIM_BK' AND kelas IN ('XII-3', 'XII-5', 'XII-6')
    `);
    console.log('Update Suardana selesai.');

    // Verifikasi jurnal_guru
    const checkRemaining = await executeD1(`
        SELECT count(*) as count FROM jurnal_guru WHERE uid_guru = 'TIM_BK'
    `);
    console.log(`Sisa jurnal TIM_BK: ${checkRemaining[0]?.count || 0}`);

    const verifyJurnals = await executeD1(`
        SELECT id, tanggal, jp, kelas, guru, uid_guru
        FROM jurnal_guru
        WHERE id IN (
            '2026_08-1786406452286', '2026_08-1786680373725', '2026_08-1786685464354',
            '2026_08-1787010593396', '2026_08-1787192633578', '2026_08-1787290052339',
            '2026_08-1787548875571'
        )
        ORDER BY tanggal ASC
    `);
    console.log('Sampel hasil update jurnal:');
    console.table(verifyJurnals);

    console.log('\n=== 2. PEMBARUAN RAPOR_CONFIG DI SYSTEM_SETTINGS ===');
    const settings = await executeD1("SELECT value FROM system_settings WHERE key = 'rapor_config'");
    if (settings.length > 0) {
        const config = JSON.parse(settings[0].value || '{}');
        if (!config.mapel_guru) config.mapel_guru = {};

        // Atur pemetaan definitif BK
        config.mapel_guru['Bimbingan dan Konseling'] = [
            {
                uid: 'Muc1yTJwJ6i87z4LR8Xq',
                name: 'I Ketut Sujana, S.Pd',
                kelas: ['XII-1', 'XII-2', 'XII-4']
            },
            {
                uid: 'YVL5hTfgVhgdHaprasKv7KOtoof1',
                name: 'I Ketut Sujana, S.Pd',
                kelas: ['XII-1', 'XII-2', 'XII-4']
            },
            {
                uid: '57X5boReUhI13AGBng77',
                name: 'I Kadek Suardana, S.Pd',
                kelas: ['XII-3', 'XII-5', 'XII-6']
            },
            {
                uid: 'ApHtdmKQzLfiKGGicxP3xeOJyVm1',
                name: 'I Kadek Suardana, S.Pd',
                kelas: ['XII-3', 'XII-5', 'XII-6']
            }
        ];

        // Jika ada key 'BK', sinkronkan juga
        if (config.mapel_guru['BK']) {
            config.mapel_guru['BK'] = config.mapel_guru['Bimbingan dan Konseling'];
        }

        const updatedJson = JSON.stringify(config);
        await executeD1("UPDATE system_settings SET value = ?, updated_at = datetime('now') WHERE key = 'rapor_config'", [updatedJson]);
        console.log('Pembaruan rapor_config berhasil.');
    }

    console.log('\n=== MIGRASI SELESAI DENGAN SUKSES ===');
}

main().catch(console.error);

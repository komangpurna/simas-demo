const fs = require('fs');
const path = require('path');

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
const D1_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`;

async function executeD1(sql, params = []) {
    const resp = await fetch(D1_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${API_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sql, params })
    });
    const json = await resp.json();
    if (!resp.ok || !json.success) {
        throw new Error(`D1 Error: ${JSON.stringify(json.errors || json)}`);
    }
    return json.result?.[0];
}

function parseFirestoreDoc(doc) {
    if (!doc || !doc.fields) return { id: doc.name ? doc.name.split('/').pop() : '' };
    const res = { id: doc.name ? doc.name.split('/').pop() : '' };
    function parseValue(val) {
        if (!val) return null;
        if (val.stringValue !== undefined) return val.stringValue;
        if (val.integerValue !== undefined) return parseInt(val.integerValue, 10);
        if (val.doubleValue !== undefined) return parseFloat(val.doubleValue);
        if (val.booleanValue !== undefined) return val.booleanValue;
        if (val.timestampValue !== undefined) return val.timestampValue;
        if (val.nullValue !== undefined) return null;
        if (val.arrayValue !== undefined) return (val.arrayValue.values || []).map(parseValue);
        if (val.mapValue !== undefined) {
            const map = {};
            for (const k in (val.mapValue.fields || {})) map[k] = parseValue(val.mapValue.fields[k]);
            return map;
        }
        return null;
    }
    for (const k in doc.fields) res[k] = parseValue(doc.fields[k]);
    res._createTime = doc.createTime;
    res._updateTime = doc.updateTime;
    return res;
}

async function fetchAllFirestoreCollection(projectId, collectionName) {
    let documents = [];
    let pageToken = '';
    let page = 1;
    console.log(`📥 Mengambil data dari Firestore [${projectId}/${collectionName}]...`);
    do {
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionName}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
        const resp = await fetch(url);
        if (!resp.ok) { console.warn(`Warning: HTTP ${resp.status}`); break; }
        const json = await resp.json();
        if (json.documents) {
            const parsed = json.documents.map(parseFirestoreDoc);
            documents.push(...parsed);
            console.log(`   Halaman ${page}: ${parsed.length} dokumen (Total: ${documents.length})`);
        }
        pageToken = json.nextPageToken || '';
        page++;
    } while (pageToken);
    return documents;
}

async function migrateJurnal() {
    console.log("=================================================================");
    console.log("🚀 MIGRASI JURNAL GURU KE CLOUDFLARE D1 (BATCH SIZE = 5)");
    console.log("=================================================================\n");

    const PROJECT_ID = "jurnal-smagesa";
    const journals = await fetchAllFirestoreCollection(PROJECT_ID, "jurnal_guru");
    console.log(`📌 Total ${journals.length} jurnal ditemukan. Memulai insert batch...\n`);

    // Batch size 5 rows × 15 params = 75 SQL variables (well under D1 limit)
    const BATCH_SIZE = 5;
    let insertedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < journals.length; i += BATCH_SIZE) {
        const chunk = journals.slice(i, i + BATCH_SIZE);
        const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))").join(", ");
        const params = [];

        chunk.forEach(j => {
            let tanggal = j.tanggal || '';
            if (!tanggal && j.timestamp) {
                try {
                    const d = new Date(j.timestamp);
                    tanggal = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                } catch (e) { }
            }
            if (!tanggal) {
                const match = j.id.match(/^(\d{4})_(\d{2})/);
                tanggal = match ? `${match[1]}-${match[2]}-01` : new Date().toISOString().split('T')[0];
            }

            params.push(
                j.id,
                tanggal,
                j.kelas || '',
                j.guru || '',
                j.uid_guru || null,
                j.mapel || '',
                j.topik || j.materi_topik || '',
                j.catatan || '',
                j.jp ? (typeof j.jp === 'string' ? j.jp : JSON.stringify(j.jp)) : '[]',
                j.lokasi_mengajar || j.lokasi || '',
                j.foto_url || '',
                j.ttd || null,
                j.koordinat ? (typeof j.koordinat === 'string' ? j.koordinat : JSON.stringify(j.koordinat)) : null,
                j.presensi_detail ? (typeof j.presensi_detail === 'string' ? j.presensi_detail : JSON.stringify(j.presensi_detail)) : (j.presensi ? JSON.stringify(j.presensi) : '[]'),
                j.timestamp || j._createTime || new Date().toISOString()
            );
        });

        try {
            await executeD1(
                `INSERT INTO jurnal_guru (id, tanggal, kelas, guru, uid_guru, mapel, topik, catatan, jp, lokasi_mengajar, foto_url, ttd, koordinat, presensi_detail, created_at, updated_at)
                 VALUES ${placeholders}
                 ON CONFLICT(id) DO UPDATE SET
                    tanggal=excluded.tanggal, kelas=excluded.kelas, guru=excluded.guru,
                    uid_guru=excluded.uid_guru, mapel=excluded.mapel, topik=excluded.topik,
                    catatan=excluded.catatan, jp=excluded.jp, lokasi_mengajar=excluded.lokasi_mengajar,
                    foto_url=excluded.foto_url, ttd=COALESCE(excluded.ttd, jurnal_guru.ttd),
                    koordinat=excluded.koordinat, presensi_detail=excluded.presensi_detail,
                    updated_at=datetime('now');`,
                params
            );
            insertedCount += chunk.length;
        } catch (e) {
            console.error(`   ❌ Error batch ${i}-${i + chunk.length}: ${e.message}`);
            errorCount += chunk.length;
        }

        if ((insertedCount + errorCount) % 100 === 0 || i + BATCH_SIZE >= journals.length) {
            console.log(`   Progres: ${insertedCount}/${journals.length} berhasil (${errorCount} error)...`);
        }
    }

    console.log(`\n🎉 SELESAI! ${insertedCount} jurnal berhasil, ${errorCount} gagal.\n`);

    // Verifikasi
    console.log("📊 VERIFIKASI AKHIR:");
    const tables = ['jurnal_guru', 'master_mapel', 'master_lokasi', 'master_teachers', 'system_settings'];
    for (const t of tables) {
        try {
            const res = await executeD1(`SELECT COUNT(*) AS total FROM ${t};`);
            console.log(`  🔹 [${t}]: ${res?.results?.[0]?.total || 0} baris`);
        } catch (e) {
            console.warn(`  ⚠️ [${t}]: ${e.message}`);
        }
    }
}

migrateJurnal().catch(console.error);

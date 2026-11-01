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
const D1_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`;

async function getAccessToken() {
    try {
        const configPath = path.join(process.env.USERPROFILE || '', '.config', 'configstore', 'firebase-tools.json');
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            return config.tokens?.access_token || '';
        }
    } catch (e) {
        console.warn('Could not read firebase-tools token:', e.message);
    }
    return '';
}

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

async function fetchFirestoreDoc(projectId, docPath, token) {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${docPath}`;
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    const resp = await fetch(url, { headers });
    if (!resp.ok) return null;
    const json = await resp.json();
    return parseFirestoreDoc(json);
}

async function fetchAllFirestoreCollection(projectId, collectionName, token) {
    let documents = [];
    let pageToken = '';
    let page = 1;
    console.log(`📥 Mengambil koleksi Firestore [${projectId}/${collectionName}]...`);
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

    do {
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionName}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
        const resp = await fetch(url, { headers });
        if (!resp.ok) {
            console.warn(`Warning: HTTP ${resp.status}`);
            break;
        }
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

async function runRaporMigration() {
    console.log("=================================================================");
    console.log("🚀 MEMULAI MIGRASI E-RAPOR & JADWAL XML KE CLOUDFLARE D1 (SSOT)");
    console.log("=================================================================\n");

    const token = await getAccessToken();
    console.log(`🔑 Firebase Access Token: ${token ? 'Tersedia ✅' : 'Tidak Ditemukan ⚠️'}\n`);

    // 1. Terapkan D1 Migration SQL
    console.log("1️⃣ Memeriksa & Menerapkan Skema D1 rapor_scores...");
    const migrationFile = path.join(__dirname, '..', 'cloudflare', 'migrations', '202608290004_add_rapor_scores.sql');
    let sqlContent = fs.readFileSync(migrationFile, 'utf8');
    sqlContent = sqlContent.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const statements = sqlContent.split(';').map(s => s.trim()).filter(s => s.length > 0);

    for (const stmt of statements) {
        await executeD1(stmt);
    }
    console.log("   ✅ Skema tabel rapor_scores siap di Cloudflare D1.\n");

    const PROJECT_ID = "smagesa";

    // 2. Migrasi Konfigurasi Rapor (settings/rapor_config)
    console.log("2️⃣ Migrasi settings/rapor_config ke D1 system_settings...");
    try {
        const configDoc = await fetchFirestoreDoc(PROJECT_ID, "settings/rapor_config", token);
        if (configDoc && Object.keys(configDoc).length > 1) {
            delete configDoc.id;
            delete configDoc._createTime;
            delete configDoc._updateTime;
            const configJson = JSON.stringify(configDoc);
            await executeD1(
                "INSERT INTO system_settings (key, value, updated_at) VALUES ('rapor_config', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                [configJson]
            );
            console.log("   ✅ rapor_config berhasil dimigrasikan ke D1 system_settings.");

            // Sync master_mapel di D1 dari mapel_list
            const masterList = configDoc.mapel_list || [];
            if (Array.isArray(masterList) && masterList.length > 0) {
                for (const mapelName of masterList) {
                    if (mapelName) {
                        const mId = mapelName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                        await executeD1(
                            "INSERT INTO master_mapel (id, nama_mapel, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(id) DO UPDATE SET nama_mapel=excluded.nama_mapel, updated_at=excluded.updated_at",
                            [mId, mapelName]
                        );
                    }
                }
                console.log(`   ✅ ${masterList.length} master_mapel berhasil disinkronkan ke D1.`);
            }
        } else {
            console.log("   ℹ️ Tidak ada data settings/rapor_config ditemukan di Firestore.");
        }
    } catch (e) {
        console.warn("   ⚠️ Gagal migrasi rapor_config:", e.message);
    }
    console.log("");

    // 3. Migrasi Konfigurasi Jadwal Pelajaran (settings/schedule_config)
    console.log("3️⃣ Migrasi settings/schedule_config ke D1 system_settings...");
    try {
        const schedDoc = await fetchFirestoreDoc(PROJECT_ID, "settings/schedule_config", token);
        if (schedDoc && Object.keys(schedDoc).length > 1) {
            delete schedDoc.id;
            delete schedDoc._createTime;
            delete schedDoc._updateTime;
            const schedJson = JSON.stringify(schedDoc);
            await executeD1(
                "INSERT INTO system_settings (key, value, updated_at) VALUES ('schedule_config', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                [schedJson]
            );
            console.log("   ✅ schedule_config XML & teacherMapping berhasil dimigrasikan ke D1.");
        } else {
            console.log("   ℹ️ Tidak ada custom schedule_config ditemukan di Firestore.");
        }
    } catch (e) {
        console.warn("   ⚠️ Gagal migrasi schedule_config:", e.message);
    }
    console.log("");

    // 4. Migrasi Nilai Rapor Siswa (rapor_scores)
    console.log("4️⃣ Migrasi koleksi rapor_scores ke tabel D1...");
    try {
        const scoresDocs = await fetchAllFirestoreCollection(PROJECT_ID, "rapor_scores", token);
        console.log(`📌 Total ${scoresDocs.length} dokumen rapor_scores ditemukan.`);

        if (scoresDocs.length > 0) {
            let insertedCount = 0;
            for (let i = 0; i < scoresDocs.length; i += 5) {
                const chunk = scoresDocs.slice(i, i + 5);
                for (const doc of chunk) {
                    const nis = String(doc.nis || doc.studentNIS || '').trim();
                    const name = doc.name || doc.studentName || '';
                    const kelas = doc.class || doc.kelas || '';
                    const ta = doc.tahun_ajaran || '2026/2027';
                    const docId = doc.id || `${kelas}_${nis}_${ta.replace('/', '-')}`;

                    let scoresTeori = {};
                    let scoresPraktik = {};
                    let teacherTeori = {};
                    let teacherPraktik = {};

                    if (doc.scores_teori && typeof doc.scores_teori === 'object') scoresTeori = doc.scores_teori;
                    if (doc.scores_praktik && typeof doc.scores_praktik === 'object') scoresPraktik = doc.scores_praktik;
                    if (doc.teacher_info_teori && typeof doc.teacher_info_teori === 'object') teacherTeori = doc.teacher_info_teori;
                    if (doc.teacher_info_praktik && typeof doc.teacher_info_praktik === 'object') teacherPraktik = doc.teacher_info_praktik;

                    // Support dot notation
                    Object.keys(doc).forEach(key => {
                        if (key.startsWith('scores_teori.')) {
                            scoresTeori[key.replace('scores_teori.', '')] = doc[key];
                        }
                        if (key.startsWith('scores_praktik.')) {
                            scoresPraktik[key.replace('scores_praktik.', '')] = doc[key];
                        }
                    });

                    await executeD1(
                        `INSERT INTO rapor_scores (id, nis, name, class, tahun_ajaran, scores_teori, scores_praktik, teacher_info_teori, teacher_info_praktik, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                         ON CONFLICT(id) DO UPDATE SET
                            scores_teori = excluded.scores_teori,
                            scores_praktik = excluded.scores_praktik,
                            teacher_info_teori = excluded.teacher_info_teori,
                            teacher_info_praktik = excluded.teacher_info_praktik,
                            updated_at = excluded.updated_at`,
                        [
                            docId,
                            nis,
                            name,
                            kelas,
                            ta,
                            JSON.stringify(scoresTeori),
                            JSON.stringify(scoresPraktik),
                            JSON.stringify(teacherTeori),
                            JSON.stringify(teacherPraktik)
                        ]
                    );
                    insertedCount++;
                }
                process.stdout.write(`   Progres: ${insertedCount}/${scoresDocs.length} nilai tersimpan...\r`);
            }
            console.log(`\n   ✅ Berhasil memigrasikan ${insertedCount} data nilai rapor ke Cloudflare D1.`);
        }
    } catch (e) {
        console.error("   ❌ Error migrasi rapor_scores:", e);
    }

    // 5. Verifikasi Data Akhir di Cloudflare D1
    console.log("\n5️⃣ Verifikasi Data di Cloudflare D1:");
    const countScores = await executeD1("SELECT count(*) as total FROM rapor_scores");
    const countSettings = await executeD1("SELECT count(*) as total FROM system_settings WHERE key IN ('rapor_config', 'schedule_config')");
    const countMapel = await executeD1("SELECT count(*) as total FROM master_mapel");

    console.log(`   📊 Total Record rapor_scores di D1    : ${countScores.results?.[0]?.total || 0}`);
    console.log(`   ⚙️ Total System Settings E-Rapor di D1: ${countSettings.results?.[0]?.total || 0}`);
    console.log(`   📚 Total Master Mapel di D1           : ${countMapel.results?.[0]?.total || 0}`);

    console.log("\n=================================================================");
    console.log("🎉 MIGRASI E-RAPOR & JADWAL XML KE CLOUDFLARE D1 SELESAI 100%!");
    console.log("=================================================================");
}

runRaporMigration().catch(console.error);

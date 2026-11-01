const fs = require('fs');
const path = require('path');

// 1. Baca Cloudflare Environment
const envPath = path.join(__dirname, '..', 'cloudflare', '.env');
let env = {};
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

async function run() {
    console.log('🚀 Menerapkan Partial Index dan Composite Index ke Cloudflare D1...');

    // 1. Normalisasi status record lama
    console.log('1. Normalisasi status = active untuk record records yang NULL/kosong...');
    await executeD1(`UPDATE records SET status = 'active' WHERE status IS NULL OR status = ''`);
    console.log('   ✅ Normalisasi status records selesai.');

    // 2. Daftar Indeks Baru
    const indexes = [
        // Records
        `CREATE INDEX IF NOT EXISTS idx_records_active_cat_date_ts ON records(category, date DESC, timestamp DESC) WHERE status = 'active'`,
        `CREATE INDEX IF NOT EXISTS idx_records_active_class_cat_date ON records(student_class, category, date DESC, timestamp DESC) WHERE status = 'active'`,
        `CREATE INDEX IF NOT EXISTS idx_records_active_date_cat ON records(date, category) WHERE status = 'active'`,
        `CREATE INDEX IF NOT EXISTS idx_records_active_nis_ts ON records(student_nis, timestamp DESC) WHERE status = 'active'`,
        
        // Jurnal Guru
        `CREATE INDEX IF NOT EXISTS idx_jurnal_tgl_created ON jurnal_guru(tanggal DESC, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_jurnal_kelas_tgl_created ON jurnal_guru(kelas, tanggal DESC, created_at DESC)`,
        
        // Guru Wali Assignments
        `CREATE INDEX IF NOT EXISTS idx_guru_wali_class_name ON guru_wali_assignments(student_class ASC, student_name ASC)`,

        // LMS Performance Indexes
        `CREATE INDEX IF NOT EXISTS idx_lms_quiz_student_status ON lms_quiz_attempts(material_id, student_nis, status, started_at DESC)`,

        // Records & Students Performance Indexes
        `CREATE INDEX IF NOT EXISTS idx_records_status_date_cat ON records(status, date, category)`,
        `CREATE INDEX IF NOT EXISTS idx_students_status_class_name ON students(status, class, name)`
    ];

    console.log('2. Menerapkan indeks baru...');
    for (const sql of indexes) {
        process.stdout.write(`   Executing: ${sql.substring(0, 65)}... `);
        await executeD1(sql);
        console.log('✅ OK');
    }

    // 3. Verifikasi Indeks
    console.log('\n3. Verifikasi Indeks di Database D1:');
    const recordsIdx = await executeD1(`PRAGMA index_list('records')`);
    console.log(`   - records indexes (${recordsIdx.length}):`, recordsIdx.map(i => i.name).join(', '));

    const jurnalIdx = await executeD1(`PRAGMA index_list('jurnal_guru')`);
    console.log(`   - jurnal_guru indexes (${jurnalIdx.length}):`, jurnalIdx.map(i => i.name).join(', '));

    const gwIdx = await executeD1(`PRAGMA index_list('guru_wali_assignments')`);
    console.log(`   - guru_wali_assignments indexes (${gwIdx.length}):`, gwIdx.map(i => i.name).join(', '));

    console.log('\n🎉 Semua indeks performa berhasil diterapkan di Cloudflare D1!');
}

run().catch(err => {
    console.error('❌ Gagal menerapkan indeks:', err);
    process.exit(1);
});

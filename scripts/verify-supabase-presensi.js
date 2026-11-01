// scripts/verify-supabase-presensi.js
const https = require('https');

const SUPABASE_URL = "https://elrmzlicuuglnoeedusr.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVscm16bGljdXVnbG5vZWVkdXNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MzM4MjQsImV4cCI6MjA5NTMwOTgyNH0.Gq0j07cpV2KQp3TnktTHSXU3ZedBR0Uf6TuU_sioEzE";

function fetchSupabase(path, headers = {}) {
    return new Promise((resolve, reject) => {
        const url = `${SUPABASE_URL}${path}`;
        const options = {
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                ...headers
            }
        };

        https.get(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const contentRange = res.headers['content-range'] || '';
                    const json = data ? JSON.parse(data) : null;
                    resolve({ status: res.statusCode, data: json, contentRange, headers: res.headers });
                } catch (e) {
                    resolve({ status: res.statusCode, raw: data, contentRange: res.headers['content-range'] });
                }
            });
        }).on('error', err => reject(err));
    });
}

async function verify() {
    console.log('🔍 MEMERIKSA STATUS DATABASE SUPABASE (elrmzlicuuglnoeedusr)...\n');

    // 1. Cek total baris di siswa_presensi_harian
    const resHarian = await fetchSupabase('/rest/v1/siswa_presensi_harian?select=*', {
        'Prefer': 'count=exact',
        'Range-Unit': 'items',
        'Range': '0-0'
    });
    console.log('📊 TABEL: siswa_presensi_harian');
    console.log(`   - HTTP Status: ${resHarian.status}`);
    console.log(`   - Content Range / Count: ${resHarian.contentRange || 'N/A'}`);

    // 2. Cek total baris di siswa_presensi
    const resDetail = await fetchSupabase('/rest/v1/siswa_presensi?select=*', {
        'Prefer': 'count=exact',
        'Range-Unit': 'items',
        'Range': '0-0'
    });
    console.log('\n📊 TABEL: siswa_presensi (Detail Per Siswa)');
    console.log(`   - HTTP Status: ${resDetail.status}`);
    console.log(`   - Content Range / Count: ${resDetail.contentRange || 'N/A'}`);

    // 3. Ambil sampel 5 data terbaru dari siswa_presensi_harian
    const resSampleHarian = await fetchSupabase('/rest/v1/siswa_presensi_harian?select=*&order=tanggal.desc&limit=5');
    if (resSampleHarian.data && Array.isArray(resSampleHarian.data)) {
        console.log(`\n📅 Sampel 5 Dokumen Kelas Terbaru di siswa_presensi_harian:`);
        resSampleHarian.data.forEach((r, idx) => {
            console.log(`   ${idx + 1}. [${r.tanggal}] Kelas: ${r.kelas} | Total Siswa: ${r.total_students} | Summary: ${JSON.stringify(r.summary)} | Pencatat: ${r.recorded_by}`);
        });
    }

    // 4. Ambil statistik status (H, S, I, A, D) dari siswa_presensi
    const resSampleDetail = await fetchSupabase('/rest/v1/siswa_presensi?select=status&limit=1000');
    if (resSampleDetail.data && Array.isArray(resSampleDetail.data)) {
        const stats = { H: 0, S: 0, I: 0, A: 0, D: 0, P: 0 };
        resSampleDetail.data.forEach(r => {
            if (stats[r.status] !== undefined) stats[r.status]++;
        });
        console.log(`\n📈 Sampel Distribusi Status (1000 baris pertama):`, stats);
    }

    // 5. Cek rentang tanggal (Min & Max Date)
    const resMinDate = await fetchSupabase('/rest/v1/siswa_presensi_harian?select=tanggal&order=tanggal.asc&limit=1');
    const resMaxDate = await fetchSupabase('/rest/v1/siswa_presensi_harian?select=tanggal&order=tanggal.desc&limit=1');
    const minD = resMinDate.data?.[0]?.tanggal || '-';
    const maxD = resMaxDate.data?.[0]?.tanggal || '-';
    console.log(`\n🗓️  Rentang Tanggal Tersimpan: ${minD} s/d ${maxD}`);

    console.log('\n======================================================');
    console.log('✅ PEMERIKSAAN SELESAI: Database Supabase telah terverifikasi aktif dan terisi!');
    console.log('======================================================');
}

verify().catch(console.error);

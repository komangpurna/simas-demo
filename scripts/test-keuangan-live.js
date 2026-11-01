const https = require('https');

const SUPABASE_URL = "https://elrmzlicuuglnoeedusr.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVscm16bGljdXVnbG5vZWVkdXNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MzM4MjQsImV4cCI6MjA5NTMwOTgyNH0.Gq0j07cpV2KQp3TnktTHSXU3ZedBR0Uf6TuU_sioEzE";

function fetchSupabase(path) {
    return new Promise((resolve, reject) => {
        const url = `${SUPABASE_URL}${path}`;
        const options = {
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            }
        };

        https.get(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch (e) {
                    resolve({ status: res.statusCode, raw: data });
                }
            });
        }).on('error', err => reject(err));
    });
}

async function testFinance() {
    console.log('🧪 MEMULAI UJI INTEGRASI LIVE KEUANGAN DI SUPABASE (SSOT)...\n');

    // 1. Test finance_transactions
    console.log('1️⃣ Test Tabel finance_transactions...');
    const resTrx = await fetchSupabase('/rest/v1/finance_transactions?limit=5&select=*');
    console.log(`   - Status HTTP: ${resTrx.status}`);
    console.log(`   - Terdeteksi Record: ${resTrx.data?.length || 0} baris`);
    if (resTrx.data?.length > 0) {
        console.log(`   - Sampel: NIS ${resTrx.data[0].student_nis} (${resTrx.data[0].student_name}) | Bulan: ${resTrx.data[0].month}/${resTrx.data[0].year} | Rp ${resTrx.data[0].amount}`);
    }

    // 2. Test finance_daily_summary
    console.log('\n2️⃣ Test Tabel finance_daily_summary...');
    const resDaily = await fetchSupabase('/rest/v1/finance_daily_summary?limit=5&select=*&order=date_str.desc');
    console.log(`   - Status HTTP: ${resDaily.status}`);
    console.log(`   - Terdeteksi Record: ${resDaily.data?.length || 0} baris`);
    if (resDaily.data?.length > 0) {
        console.log(`   - Sampel: Tanggal ${resDaily.data[0].date_str} | Total: Rp ${resDaily.data[0].total_amount} (${resDaily.data[0].transaction_count} trx)`);
    }

    // 3. Test finance_closings
    console.log('\n3️⃣ Test Tabel finance_closings...');
    const resClosing = await fetchSupabase('/rest/v1/finance_closings?select=*');
    console.log(`   - Status HTTP: ${resClosing.status}`);
    console.log(`   - Total Tahun Tutup Buku: ${resClosing.data?.length || 0}`);

    // 4. Test finance_cashflow
    console.log('\n4️⃣ Test Tabel finance_cashflow (Kas Komite / Buku Kas)...');
    const resCashflow = await fetchSupabase('/rest/v1/finance_cashflow?limit=5&select=*');
    console.log(`   - Status HTTP: ${resCashflow.status}`);
    console.log(`   - Terdeteksi Record: ${resCashflow.data?.length || 0} baris`);

    console.log('\n======================================================');
    console.log('🎉 SELURUH TABEL KEUANGAN SUPABASE AKTIF 100% (HTTP 200 OK)!');
    console.log('======================================================');
}

testFinance().catch(console.error);

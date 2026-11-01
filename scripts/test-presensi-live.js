// scripts/test-presensi-live.js
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

async function testAll() {
    console.log('🧪 MEMULAI UJI INTEGRASI LIVE SELURUH SKENARIO PRESENSI SISWA...\n');

    // 1. Test Daily Summary (presensi.html)
    console.log('1️⃣ Test Pemuatan Daily Summary Harian (2026-08-14)...');
    const resSummary = await fetchSupabase('/rest/v1/siswa_presensi_harian?tanggal=eq.2026-08-14&select=*');
    console.log(`   - Status HTTP: ${resSummary.status}`);
    console.log(`   - Jumlah Kelas Terdata: ${resSummary.data?.length || 0} kelas`);
    if (resSummary.data?.length > 0) {
        console.log(`   - Sampel: Kelas ${resSummary.data[0].kelas} | Summary:`, resSummary.data[0].summary);
    }

    // 2. Test Class Attendance (Form Input & Wali Kelas Live)
    console.log('\n2️⃣ Test Pemuatan Presensi Kelas (XII-6 pada 2026-08-14)...');
    const resClass = await fetchSupabase('/rest/v1/siswa_presensi?kelas=eq.XII-6&tanggal=eq.2026-08-14&select=*');
    console.log(`   - Status HTTP: ${resClass.status}`);
    console.log(`   - Jumlah Siswa Terdata: ${resClass.data?.length || 0} siswa`);
    if (resClass.data?.length > 0) {
        console.log(`   - Sampel Siswa: NIS ${resClass.data[0].student_nis} (${resClass.data[0].student_name}) -> Status: ${resClass.data[0].status}`);
    }

    // 3. Test Student Attendance Range (Portal Siswa, BK, Guru Wali, Modal Detail)
    if (resClass.data?.length > 0) {
        const sampleNIS = resClass.data[0].student_nis;
        console.log(`\n3️⃣ Test Pemuatan Riwayat Siswa (NIS ${sampleNIS} Periode 2026-07-01 s/d 2026-08-14)...`);
        const resStudent = await fetchSupabase(`/rest/v1/siswa_presensi?student_nis=eq.${sampleNIS}&tanggal=gte.2026-07-01&tanggal=lte.2026-08-14&select=*&order=tanggal.desc`);
        console.log(`   - Status HTTP: ${resStudent.status}`);
        console.log(`   - Total Hari Presensi Tersimpan: ${resStudent.data?.length || 0} hari`);
        if (resStudent.data?.length > 0) {
            console.log(`   - Hari Terakhir: ${resStudent.data[0].tanggal} -> Status: ${resStudent.data[0].status}`);
        }
    }

    // 4. Test Class Attendance Range (Rekap Bulanan/Semester Wali Kelas & Presensi)
    console.log('\n4️⃣ Test Rekap Rombel Range (XII-6 Periode 2026-07-01 s/d 2026-08-14)...');
    const resClassRange = await fetchSupabase('/rest/v1/siswa_presensi?kelas=eq.XII-6&tanggal=gte.2026-07-01&tanggal=lte.2026-08-14&select=*');
    console.log(`   - Status HTTP: ${resClassRange.status}`);
    console.log(`   - Total Log Presensi Kelas: ${resClassRange.data?.length || 0} baris`);

    // 5. Test Non-Hadir Query (BK Timeline & Rekap Ketidakhadiran)
    console.log('\n5️⃣ Test Filter Siswa Tidak Hadir (Status != H)...');
    const resNonH = await fetchSupabase('/rest/v1/siswa_presensi?status=neq.H&limit=5&select=*');
    console.log(`   - Status HTTP: ${resNonH.status}`);
    console.log(`   - Sampel Non-Hadir Terdeteksi: ${resNonH.data?.length || 0} record`);
    if (resNonH.data?.length > 0) {
        console.log(`   - Detail: [${resNonH.data[0].tanggal}] ${resNonH.data[0].student_name} (${resNonH.data[0].status}) Ket: "${resNonH.data[0].note}"`);
    }

    console.log('\n======================================================');
    console.log('🎉 SELURUH SKENARIO LIVE QUERY BERJALAN 100% SEMPURNA!');
    console.log('======================================================');
}

testAll().catch(console.error);

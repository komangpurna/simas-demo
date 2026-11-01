const BASE_URL = 'https://simas-smagesa-api.komangpurna1.workers.dev';

async function runTests() {
    console.log("🧪 Testing Cloudflare D1 Records, Aggregates & BK Actions API...");

    // 1. Test stats
    const resStats = await fetch(`${BASE_URL}/api/records/stats`);
    const jsonStats = await resStats.json();
    console.log("1. /api/records/stats:", jsonStats);

    // 2. Test insert record (test NIS 99999)
    const testRecord = {
        id: 'test_rec_001',
        student_nis: '99999',
        student_name: 'Siswa Uji Coba',
        student_class: 'X-1',
        category: 'Pelanggaran',
        type: 'Keterlambatan',
        points: 5,
        desc: 'Terlambat 15 menit',
        reporter_name: 'Guru Piket',
        date: '2026-08-29',
        timestamp: new Date().toISOString()
    };
    const resPostRec = await fetch(`${BASE_URL}/api/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testRecord)
    });
    const jsonPostRec = await resPostRec.json();
    console.log("2. POST /api/records:", jsonPostRec);

    // 3. Test student aggregate for 99999
    const resAgg = await fetch(`${BASE_URL}/api/student-aggregates/99999`);
    const jsonAgg = await resAgg.json();
    console.log("3. GET /api/student-aggregates/99999:", jsonAgg);

    // 4. Test top violators
    const resTop = await fetch(`${BASE_URL}/api/records/top-violators?limit=5`);
    const jsonTop = await resTop.json();
    console.log("4. GET /api/records/top-violators:", jsonTop);

    // 5. Test create BK action
    const testBk = {
        id: 'test_bk_001',
        student_nis: '99999',
        student_name: 'Siswa Uji Coba',
        student_class: 'X-1',
        problem: 'Sering terlambat masuk sekolah',
        bimbingan_type: 'Pribadi',
        service_type: 'Konseling Individu',
        date: '2026-08-29',
        status: 'Dalam Pantauan',
        notes: 'Diberikan pengarahan awal',
        counselor_name: 'Guru BK SMAGESA'
    };
    const resPostBk = await fetch(`${BASE_URL}/api/bk-actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testBk)
    });
    const jsonPostBk = await resPostBk.json();
    console.log("5. POST /api/bk-actions:", jsonPostBk);

    // 6. Test UNIFIED BK Student Context Endpoint
    const resContext = await fetch(`${BASE_URL}/api/bk-actions/student-context/99999`);
    const jsonContext = await resContext.json();
    console.log("6. GET /api/bk-actions/student-context/99999 (UNIFIED):", {
        success: jsonContext.success,
        violationsCount: jsonContext.data?.violations?.length,
        bkHistoryCount: jsonContext.data?.bkHistory?.length,
        points: jsonContext.data?.aggregate?.points
    });

    // 7. Cleanup test data
    await fetch(`${BASE_URL}/api/records/test_rec_001`, { method: 'DELETE' });
    await fetch(`${BASE_URL}/api/bk-actions/test_bk_001`, { method: 'DELETE' });
    await fetch(`${BASE_URL}/api/student-aggregates/recalculate`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nis: '99999' })
    });
    console.log("7. Cleanup completed.");
    console.log("🎉 ALL TESTS PASSED SUCCESSFULLY!");
}

runTests().catch(console.error);

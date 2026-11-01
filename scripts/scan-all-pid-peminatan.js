async function findAllPeminatanData() {
    const projectId = "jurnal-smagesa";
    console.log("=== SCAN SEMUA DATA PEMINATAN & PID_GAMES ===");

    // 1. PID Games
    const gUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/pid_games?pageSize=300`;
    const gRes = await fetch(gUrl);
    const gJson = await gRes.json();
    console.log(`🎮 pid_games: ${gJson.documents?.length || 0} games`);
    gJson.documents?.forEach(d => {
        const id = d.name.split('/').pop();
        const f = d.fields || {};
        console.log(`   - [${id}] ${f.title?.stringValue || '-'} (${f.category?.arrayValue?.values?.[0]?.stringValue || '-'}) - Active: ${f.is_active?.booleanValue}`);
    });

    // 2. Metadata / pid_games_config
    const mUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/metadata/pid_games_config`;
    const mRes = await fetch(mUrl);
    const mJson = await mRes.json();
    console.log(`⚙️ metadata/pid_games_config:`, mJson.fields);

    // 3. Peminatan Config
    const pcUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/peminatan_config/questions`;
    const pcRes = await fetch(pcUrl);
    const pcJson = await pcRes.json();
    console.log(`📋 peminatan_config/questions: exists = ${pcRes.status === 200}`);

    // 4. Scan Peminatan Responses across multiple possible years
    const possibleYears = [
        '2022', '2023', '2024', '2025', '2026', '2027', '2028',
        '2023-2024', '2024-2025', '2025-2026', '2026-2027',
        '2023_2024', '2024_2025', '2025_2026', '2026_2027'
    ];

    let totalResponses = 0;
    for (const yr of possibleYears) {
        let pageToken = '';
        let countYr = 0;
        do {
            const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/peminatan_responses/${yr}/data?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
            const res = await fetch(url);
            if (res.ok) {
                const json = await res.json();
                if (json.documents) {
                    countYr += json.documents.length;
                }
                pageToken = json.nextPageToken || '';
            } else {
                break;
            }
        } while (pageToken);

        if (countYr > 0) {
            console.log(`📊 peminatan_responses/${yr}/data: ${countYr} siswa responses`);
            totalResponses += countYr;
        }
    }
    console.log(`\nTotal responses peminatan: ${totalResponses}`);
}

findAllPeminatanData().catch(console.error);

async function verify() {
    const cfUrl = 'https://simas-smagesa-api.komangpurna1.workers.dev';

    console.log("=== VERIFIKASI CLOUDFLARE D1 ENDPOINTS ===");

    // 1. PID Games
    const resGames = await fetch(`${cfUrl}/api/pid-games?status=all`);
    const jsonGames = await resGames.json();
    console.log(`1. PID Games (status=all): ${jsonGames.total} game ditemukan.`);
    if (jsonGames.data) {
        jsonGames.data.forEach(g => console.log(`   - [${g.id}] ${g.title} (${g.subject || 'Umum'}) - active: ${g.is_active}`));
    }

    // 2. Peminatan Config
    const resCfg = await fetch(`${cfUrl}/api/peminatan/config`);
    const jsonCfg = await resCfg.json();
    console.log(`2. Peminatan Config: isActive=${jsonCfg.data?.isActive}, layout=${jsonCfg.data?.layout}, totalSoal=${jsonCfg.data?.items?.length}`);

    // 3. Peminatan Responses 2026
    const resResp = await fetch(`${cfUrl}/api/peminatan/responses?year=2026`);
    const jsonResp = await resResp.json();
    console.log(`3. Peminatan Responses 2026: ${jsonResp.total} siswa ditemukan.`);
    if (jsonResp.data && jsonResp.data.length > 0) {
        console.log(`   Sample: NIS ${jsonResp.data[0].nis} - ${jsonResp.data[0].name} (${jsonResp.data[0].class}) -> ${jsonResp.data[0].recommendation}`);
    }

    // 4. Status Check NIS 0968
    const resStat = await fetch(`${cfUrl}/api/peminatan/status?nis=0968`);
    const jsonStat = await resStat.json();
    console.log(`4. Peminatan Status Check (NIS 0968): hasSubmitted=${jsonStat.hasSubmitted}, submission=${jsonStat.submission?.recommendation}`);
}

verify().catch(console.error);

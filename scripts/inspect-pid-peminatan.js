async function inspectCollections() {
    console.log("=== INSPEKSI KOLEKSI PID_GAMES & PEMINATAN ===");

    for (const projectId of ['jurnal-smagesa', 'smagesa']) {
        console.log(`\n🔍 Memeriksa project: ${projectId}`);
        const cols = ['pid_games', 'pid_leaderboards', 'metadata', 'peminatan_config', 'peminatan_responses'];
        for (const col of cols) {
            try {
                const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${col}?pageSize=10`;
                const r = await fetch(url);
                if (r.ok) {
                    const j = await r.json();
                    const count = j.documents?.length || 0;
                    console.log(`  📁 [${col}]: ${count} docs sample (nextPageToken: ${Boolean(j.nextPageToken)})`);
                    if (count > 0) {
                        console.log(`     Sample doc ID: ${j.documents[0].name.split('/').pop()}`);
                    }
                } else {
                    console.log(`  📁 [${col}]: HTTP ${r.status}`);
                }
            } catch (e) {
                console.log(`  📁 [${col}]: Error ${e.message}`);
            }
        }
    }
}

inspectCollections().catch(console.error);

async function inspectDocsStructure() {
    const projectId = "jurnal-smagesa";
    
    // 1. pid_games
    console.log("=== PID_GAMES ===");
    const gUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/pid_games`;
    const gRes = await fetch(gUrl);
    const gJson = await gRes.json();
    console.log("Sample PID Game:", JSON.stringify(gJson.documents?.[0], null, 2));

    // 2. peminatan_config/questions
    console.log("\n=== PEMINATAN_CONFIG / QUESTIONS ===");
    const qUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/peminatan_config/questions`;
    const qRes = await fetch(qUrl);
    const qJson = await qRes.json();
    console.log("Peminatan Config fields:", Object.keys(qJson.fields || {}));

    // 3. peminatan_responses/2026/data
    console.log("\n=== PEMINATAN_RESPONSES / 2026 / DATA ===");
    const rUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/peminatan_responses/2026/data?pageSize=2`;
    const rRes = await fetch(rUrl);
    const rJson = await rRes.json();
    console.log("Sample Response:", JSON.stringify(rJson.documents?.[0], null, 2));
}

inspectDocsStructure().catch(console.error);

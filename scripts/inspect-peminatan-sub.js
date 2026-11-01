async function inspectPeminatanSubcollections() {
    const projectId = "jurnal-smagesa";
    console.log("Checking peminatan_responses years & subcollections...");
    
    // In Firestore REST, list documents in peminatan_responses
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/peminatan_responses`;
    const res = await fetch(url);
    const json = await res.json();
    console.log("peminatan_responses root documents:", json.documents?.map(d => d.name));

    // Try checking known years like 2024, 2025, 2026, 2024/2025, etc.
    const testYears = ['2024', '2025', '2026', '2024-2025', '2025-2026'];
    for (const y of testYears) {
        const subUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/peminatan_responses/${y}/data?pageSize=10`;
        const subRes = await fetch(subUrl);
        if (subRes.ok) {
            const subJson = await subRes.json();
            console.log(`Year [${y}] has ${subJson.documents?.length || 0} responses. (Sample: ${subJson.documents?.[0]?.name?.split('/')?.pop()})`);
        } else {
            console.log(`Year [${y}]: HTTP ${subRes.status}`);
        }
    }
}

inspectPeminatanSubcollections().catch(console.error);

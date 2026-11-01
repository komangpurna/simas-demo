const fs = require('fs');

async function getAccessToken() {
  const config = JSON.parse(fs.readFileSync(process.env.USERPROFILE + '/.config/configstore/firebase-tools.json', 'utf8'));
  return config.tokens.access_token;
}

async function inspectGuruPresensiStructure() {
  const token = await getAccessToken();

  // Check partitions
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/smagesa/databases/(default)/documents:listCollectionIds`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pageSize: 100 })
  });
  const data = await res.json();
  console.log('Root collectionIds:', data.collectionIds);

  // Check if any subcollections exist under guru_presensi
  // In old simas structure, guru_presensi had path: guru_presensi/{kelasId}/{tahunId}/{bulanId}
  // Let's test standard class names like X-1, X-2, XI-1, XII-1 etc.
  const classes = ['X-1', 'X-2', 'X-3', 'X-4', 'XI-1', 'XI-2', 'XI-3', 'XI-4', 'XII-1', 'XII-2', 'XII-3', 'XII-4'];
  for (const cls of classes) {
    const subRes = await fetch(`https://firestore.googleapis.com/v1/projects/smagesa/databases/(default)/documents/guru_presensi/${cls}:listCollectionIds`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const subData = await subRes.json();
    if (subData.collectionIds && subData.collectionIds.length > 0) {
      console.log(`Found subcollections under guru_presensi/${cls}:`, subData.collectionIds);
      for (const year of subData.collectionIds) {
        const yearDocsRes = await fetch(`https://firestore.googleapis.com/v1/projects/smagesa/databases/(default)/documents/guru_presensi/${cls}/${year}`, {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        const yearDocsData = await yearDocsRes.json();
        console.log(`  Docs in guru_presensi/${cls}/${year}:`, yearDocsData.documents?.map(d => d.name));
      }
    }
  }
}

inspectGuruPresensiStructure().catch(console.error);

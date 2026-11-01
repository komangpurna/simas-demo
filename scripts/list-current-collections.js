const fs = require('fs');

async function getAccessToken() {
  const config = JSON.parse(fs.readFileSync(process.env.USERPROFILE + '/.config/configstore/firebase-tools.json', 'utf8'));
  return config.tokens.access_token;
}

async function listCollectionIds(projectId) {
  const token = await getAccessToken();
  console.log(`\n=== LISTING ROOT COLLECTIONS IN FIRESTORE [${projectId}] ===`);
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:listCollectionIds`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  });
  const data = await res.json();
  console.log(data);
  return data.collectionIds || [];
}

async function run() {
  await listCollectionIds('smagesa');
  await listCollectionIds('jurnal-smagesa');
}

run().catch(console.error);

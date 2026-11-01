const fs = require('fs');

async function getAccessToken() {
  const config = JSON.parse(fs.readFileSync(process.env.USERPROFILE + '/.config/configstore/firebase-tools.json', 'utf8'));
  return config.tokens.access_token;
}

async function getAllGuruPresensiDocs() {
  const token = await getAccessToken();
  const allDocs = [];
  const years = ['2020', '2021', '2022', '2023', '2024', '2025', '2026', '2027', '2028', '2029', '2030'];

  for (const yr of years) {
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/smagesa/databases/(default)/documents:runQuery`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: yr, allDescendants: true }]
        }
      })
    });
    const data = await res.json();
    if (Array.isArray(data)) {
      data.forEach(item => {
        if (item.document && item.document.name.includes('/documents/guru_presensi/')) {
          allDocs.push(item.document);
        }
      });
    }
  }

  console.log(`Total guru_presensi docs found across 2020-2030: ${allDocs.length}`);
  return allDocs;
}

getAllGuruPresensiDocs().catch(console.error);

const fs = require('fs');
const path = require('path');

async function getAccessToken() {
  const config = JSON.parse(fs.readFileSync(process.env.USERPROFILE + '/.config/configstore/firebase-tools.json', 'utf8'));
  return config.tokens.access_token;
}

async function scanAllGuruPresensiDocs() {
  const token = await getAccessToken();
  const allDocs = [];

  // Find all classes under guru_presensi
  // We can query all documents in guru_presensi by querying subcollection IDs: '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'
  const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  
  for (const m of months) {
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/smagesa/databases/(default)/documents:runQuery`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: m, allDescendants: true }]
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

  // Also check if any other collectionIds exist under guru_presensi
  // Let's also check if root docs exist in guru_presensi
  console.log(`Found ${allDocs.length} total documents under guru_presensi hierarchy.`);
  allDocs.forEach(d => console.log('  Doc:', d.name.split('/documents/')[1]));

  return allDocs;
}

scanAllGuruPresensiDocs().catch(console.error);

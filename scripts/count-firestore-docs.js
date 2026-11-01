const fs = require('fs');

async function getAccessToken() {
  const config = JSON.parse(fs.readFileSync(process.env.USERPROFILE + '/.config/configstore/firebase-tools.json', 'utf8'));
  return config.tokens.access_token;
}

async function getCollectionStats() {
  const token = await getAccessToken();
  const collections = [
    'attendance',
    'bk_actions',
    'fcm_tokens',
    'finance_cashflow',
    'finance_daily_summary',
    'finance_transactions',
    'guru_presensi',
    'guru_wali_assignments',
    'guru_wali_notes',
    'kapsul_waktu',
    'push_notifications',
    'records',
    'settings',
    'student_aggregates',
    'student_sessions',
    'teachers',
    'users'
  ];

  console.log('=== COUNTING FIRESTORE DOCUMENTS ===\n');

  for (const col of collections) {
    let count = 0;
    let pageToken = undefined;
    let sampleDoc = null;

    try {
      do {
        const url = `https://firestore.googleapis.com/v1/projects/smagesa/databases/(default)/documents/${col}?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`;
        const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
        const data = await res.json();
        if (data.documents) {
          count += data.documents.length;
          if (!sampleDoc && data.documents[0]) {
            sampleDoc = data.documents[0].name.split('/documents/')[1];
          }
        }
        pageToken = data.nextPageToken;
      } while (pageToken);

      console.log(`📁 ${col.padEnd(30)} : ${count.toString().padStart(6)} docs | Sample: ${sampleDoc || '-'}`);
    } catch (e) {
      console.log(`❌ ${col.padEnd(30)} : Error - ${e.message}`);
    }
  }
}

getCollectionStats().catch(console.error);

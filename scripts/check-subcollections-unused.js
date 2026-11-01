const fs = require('fs');

async function getAccessToken() {
  const config = JSON.parse(fs.readFileSync(process.env.USERPROFILE + '/.config/configstore/firebase-tools.json', 'utf8'));
  return config.tokens.access_token;
}

async function checkSubcollectionsOfUnused() {
  const token = await getAccessToken();
  const collections = ['attendance', 'finance_transactions', 'finance_cashflow', 'finance_daily_summary'];

  for (const col of collections) {
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/smagesa/databases/(default)/documents/${col}?pageSize=10`, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data = await res.json();
    if (data.documents) {
      for (const doc of data.documents.slice(0, 3)) {
        const subRes = await fetch(`https://firestore.googleapis.com/v1/${doc.name}:listCollectionIds`, {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        const subData = await subRes.json();
        console.log(`Doc ${doc.name.split('/documents/')[1]} subcollections:`, subData.collectionIds || 'none');
      }
    }
  }
}

checkSubcollectionsOfUnused().catch(console.error);

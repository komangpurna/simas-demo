const fs = require('fs');
const path = require('path');

async function getAccessToken() {
  const config = JSON.parse(fs.readFileSync(process.env.USERPROFILE + '/.config/configstore/firebase-tools.json', 'utf8'));
  return config.tokens.access_token;
}

async function backupCollections() {
  const token = await getAccessToken();
  const collections = ['attendance', 'finance_transactions', 'finance_cashflow', 'finance_daily_summary'];
  const backupDir = path.join(__dirname, 'backup_archive');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  console.log('=== STEP 1: BACKING UP COLLECTIONS TO LOCAL DISK ===\n');

  for (const col of collections) {
    let allDocs = [];
    let pageToken = undefined;

    do {
      const url = `https://firestore.googleapis.com/v1/projects/smagesa/databases/(default)/documents/${col}?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`;
      const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
      const data = await res.json();
      if (data.documents) {
        allDocs.push(...data.documents);
      }
      pageToken = data.nextPageToken;
    } while (pageToken);

    const filePath = path.join(backupDir, `${col}.json`);
    fs.writeFileSync(filePath, JSON.stringify(allDocs, null, 2), 'utf8');
    console.log(`✅ Backed up ${col.padEnd(25)}: ${allDocs.length.toString().padStart(5)} documents -> ${filePath}`);
  }

  console.log('\nBackup completed successfully!');
}

backupCollections().catch(console.error);

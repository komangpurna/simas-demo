const fs = require('fs');

async function getAccessToken() {
  const config = JSON.parse(fs.readFileSync(process.env.USERPROFILE + '/.config/configstore/firebase-tools.json', 'utf8'));
  return config.tokens.access_token;
}

async function checkBkActions() {
  const token = await getAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/smagesa/databases/(default)/documents/bk_actions?pageSize=1000`;
  const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
  const data = await res.json();
  const count = data.documents ? data.documents.length : 0;
  console.log(`[smagesa] Collection 'bk_actions': ${count} docs`);
  if (data.documents && data.documents.length > 0) {
    console.log(`Sample doc (${data.documents[0].name}):`, JSON.stringify(data.documents[0].fields, null, 2));
  }
}

checkBkActions().catch(console.error);

const fs = require('fs');

async function getAccessToken() {
  const config = JSON.parse(fs.readFileSync(process.env.USERPROFILE + '/.config/configstore/firebase-tools.json', 'utf8'));
  return config.tokens.access_token;
}

async function checkSubcollections() {
  const token = await getAccessToken();

  // Check calendar_events subcollections
  console.log('Checking calendar_events...');
  const resCal = await fetch(`https://firestore.googleapis.com/v1/projects/smagesa/databases/(default)/documents/calendar_events?pageSize=10`, {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  const dataCal = await resCal.json();
  console.log('calendar_events root docs:', dataCal);

  // Check collection group query for calendar_events
  const resCalGroup = await fetch(`https://firestore.googleapis.com/v1/projects/smagesa/databases/(default)/documents:runQuery`, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'calendar_events', allDescendants: true }],
        limit: 5
      }
    })
  });
  const dataCalGroup = await resCalGroup.json();
  console.log('calendar_events runQuery allDescendants:', JSON.stringify(dataCalGroup, null, 2));

  // Check guru_presensi collection group query
  const resGuruGroup = await fetch(`https://firestore.googleapis.com/v1/projects/smagesa/databases/(default)/documents:runQuery`, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'guru_presensi', allDescendants: true }],
        limit: 5
      }
    })
  });
  const dataGuruGroup = await resGuruGroup.json();
  console.log('guru_presensi runQuery allDescendants:', JSON.stringify(dataGuruGroup, null, 2));
}

checkSubcollections().catch(console.error);

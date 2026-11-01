const fs = require('fs');

async function getAccessToken() {
  const config = JSON.parse(fs.readFileSync(process.env.USERPROFILE + '/.config/configstore/firebase-tools.json', 'utf8'));
  return config.tokens.access_token;
}

async function inspectCollections() {
  const token = await getAccessToken();
  const collections = [
    'agenda_documents',
    'agenda_notifications_queue',
    'attendance',
    'audit_logs',
    'bk_actions',
    'calendar_events',
    'fcm_tokens',
    'finance_cashflow',
    'finance_daily_summary',
    'finance_transactions',
    'guru_presensi',
    'guru_wali_assignments',
    'guru_wali_notes',
    'kapsul_waktu',
    'lab_bookings',
    'labs',
    'login_history',
    'push_notifications',
    'records',
    'settings',
    'student_aggregates',
    'student_sessions',
    'teachers',
    'users',
    'violation_types'
  ];

  console.log('=== INSPECTING FIRESTORE COLLECTIONS ===\n');

  for (const col of collections) {
    try {
      const res = await fetch(`https://firestore.googleapis.com/v1/projects/smagesa/databases/(default)/documents/${col}?pageSize=5`, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const data = await res.json();
      if (data.documents) {
        console.log(`📁 ${col}: ${data.documents.length} docs shown (hasNextPage: ${!!data.nextPageToken})`);
        // show 1st doc name
        if (data.documents[0]) {
          const docPath = data.documents[0].name.split('/documents/')[1];
          console.log(`   Sample Doc: ${docPath}`);
        }
      } else {
        console.log(`📁 ${col}: 0 docs / empty`);
      }
    } catch (e) {
      console.error(`Error inspecting ${col}:`, e.message);
    }
  }
}

inspectCollections().catch(console.error);

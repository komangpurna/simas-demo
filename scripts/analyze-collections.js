const fs = require('fs');
const path = require('path');

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

function getAllFiles(dir, exts = ['.js', '.html']) {
  let res = [];
  const list = fs.readdirSync(dir);
  for (let file of list) {
    if (['node_modules', '.git', '.agents', 'cypress'].includes(file)) continue;
    const p = path.join(dir, file);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      res = res.concat(getAllFiles(p, exts));
    } else if (exts.some(ext => file.endsWith(ext))) {
      res.push(p);
    }
  }
  return res;
}

const files = getAllFiles('.');
console.log('Total files scanned:', files.length);

collections.forEach(col => {
  let foundIn = [];
  files.forEach(f => {
    if (f.startsWith('scripts' + path.sep)) return;
    const content = fs.readFileSync(f, 'utf8');
    if (content.includes(`'${col}'`) || content.includes(`"${col}"`) || content.includes(`\`${col}\``)) {
      foundIn.push(f);
    }
  });
  console.log(`[${col}] -> ${foundIn.length} files: ${foundIn.slice(0, 5).join(', ')}${foundIn.length > 5 ? '... (' + foundIn.length + ')' : ''}`);
});

const fs = require('fs');
const path = require('path');

const candidates = [
  'attendance',
  'finance_transactions',
  'finance_cashflow',
  'finance_daily_summary',
  'guru_presensi',
  'attendance_reminders',
  'walikelas_notes',
  'rapor_scores',
  'peminatan_config',
  'peminatan_responses',
  'feedback',
  'wa_notifications',
  'class_transfers'
];

function getAllFiles(dir) {
  let res = [];
  const list = fs.readdirSync(dir);
  for (let file of list) {
    if (['node_modules', '.git', '.agents', 'cypress', 'scripts'].includes(file)) continue;
    const p = path.join(dir, file);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      res = res.concat(getAllFiles(p));
    } else if (file.endsWith('.js') || file.endsWith('.html')) {
      res.push(p);
    }
  }
  return res;
}

const files = getAllFiles('.');

console.log('=== USAGE OF CANDIDATES ===\n');

for (const col of candidates) {
  console.log(`\n=========================================`);
  console.log(`Collection: ${col}`);
  let matched = [];
  files.forEach(f => {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, idx) => {
      if (line.includes(`'${col}'`) || line.includes(`"${col}"`) || line.includes(`\`${col}\``)) {
        matched.push({ file: f, line: idx + 1, content: line.trim() });
      }
    });
  });

  console.log(`  Found ${matched.length} references:`);
  matched.forEach(m => console.log(`    ${m.file}:${m.line} -> ${m.content.slice(0, 120)}`));
}

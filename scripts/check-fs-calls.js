const fs = require('fs');
const path = require('path');

const files = fs.readdirSync('js').filter(f => f.endsWith('.js')).map(f => path.join('js', f));

files.forEach(f => {
  const content = fs.readFileSync(f, 'utf8');
  ['attendance', 'finance_transactions', 'finance_cashflow', 'finance_daily_summary', 'guru_presensi'].forEach(col => {
    if (content.includes(`collection(db, '${col}')`) || content.includes(`collection(db, "${col}")`) || content.includes(`doc(db, '${col}'`) || content.includes(`doc(db, "${col}"`)) {
      console.log(`[FIRESTORE CALL] ${f} uses Firestore '${col}'`);
    }
  });
});

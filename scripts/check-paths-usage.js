const fs = require('fs');
const path = require('path');

const jsFiles = fs.readdirSync('js').filter(f => f.endsWith('.js')).map(f => path.join('js', f));

const terms = ['PATHS.attendance', 'PATHS.financeTransactions', 'PATHS.financeCashflow', 'PATHS.financeDailySummary'];

terms.forEach(term => {
  console.log(`\nChecking for ${term}:`);
  jsFiles.forEach(f => {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((l, i) => {
      if (l.includes(term)) {
        console.log(`  ${f}:${i+1} -> ${l.trim()}`);
      }
    });
  });
});

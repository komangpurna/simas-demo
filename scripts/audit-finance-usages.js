const fs = require('fs');
const path = require('path');
const jsDir = path.resolve('js');
const files = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));

const searchTerms = ['finance_transactions', 'financeTransactions', 'finance_daily_summary', 'finance_cashflow', 'finance_closings'];

files.forEach(file => {
  const content = fs.readFileSync(path.join(jsDir, file), 'utf8');
  const lines = content.split('\n');
  const matches = [];
  lines.forEach((line, idx) => {
    if (searchTerms.some(term => line.includes(term))) {
      matches.push({ lineNum: idx + 1, text: line.trim() });
    }
  });
  if (matches.length > 0) {
    console.log('=== ' + file + ' (' + matches.length + ' matches) ===');
    matches.forEach(m => console.log('  L' + m.lineNum + ': ' + m.text.substring(0, 120)));
    console.log('');
  }
});

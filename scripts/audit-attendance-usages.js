// scripts/audit-attendance-usages.js
const fs = require('fs');
const path = require('path');

const jsDir = './js';
const files = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));
const results = {};

files.forEach(file => {
    const content = fs.readFileSync(path.join(jsDir, file), 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
        const l = line.toLowerCase();
        if (
            l.includes('paths.attendance') || 
            l.includes("'attendance'") || 
            l.includes('"attendance"') || 
            l.includes('siswa_presensi') || 
            l.includes('fetchdailyattendance') || 
            l.includes('fetchclassattendance') || 
            l.includes('fetchstudentattendancerange') || 
            l.includes('fetchclassattendancerange') || 
            l.includes('saveattendancedual')
        ) {
            if (!results[file]) results[file] = [];
            results[file].push({ lineNum: idx + 1, text: line.trim() });
        }
    });
});

console.log('--- HASIL AUDIT PENGGUNAAN PRESENSI SISWA DI JS ---\n');
for (const [file, matches] of Object.entries(results)) {
    console.log(`[FILE] ${file} (${matches.length} baris):`);
    matches.forEach(m => {
        console.log(`   L${m.lineNum}: ${m.text.substring(0, 120)}`);
    });
    console.log('');
}

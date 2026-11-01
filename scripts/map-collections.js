const fs = require('fs');
const path = require('path');

const collections = [
  { name: 'attendance', desc: 'Presensi Siswa Harian' },
  { name: 'finance_transactions', desc: 'Transaksi Pembayaran SPP' },
  { name: 'guru_presensi', desc: 'Presensi Harian Guru' },
  { name: 'guru_mapel_scores', desc: 'Nilai Asesmen Guru Mapel' },
  { name: 'guru_mapel_summaries', desc: 'Rekap / Leger Nilai Guru Mapel' },
  { name: 'rapor_scores', desc: 'Nilai E-Rapor Kelas XII' },
  { name: 'permisi_requests', desc: 'Pengajuan & Riwayat Permisi Siswa' },
  { name: 'records', desc: 'Poin Prestasi & Pelanggaran Siswa' },
  { name: 'bk_actions', desc: 'Tindakan Pembinaan BK' },
  { name: 'student_aggregates', desc: 'Agregat Poin Siswa (EWS / Early Warning System)' },
  { name: 'teachers', desc: 'Master Data Guru' },
  { name: 'users', desc: 'Akun Login & Role Pengguna' },
  { name: 'settings', desc: 'Konfigurasi Sistem, Tarif, Metadata' },
  { name: 'labs', desc: 'Master Data Laboratorium' },
  { name: 'lab_bookings', desc: 'Booking Pemakaian Lab' },
  { name: 'guru_wali_assignments', desc: 'Plotting Guru Wali Siswa' },
  { name: 'guru_wali_notes', desc: 'Catatan Bimbingan Guru Wali' },
  { name: 'walikelas_notes', desc: 'Catatan Karakter Wali Kelas' },
  { name: 'login_history', desc: 'Riwayat Log Login User' },
  { name: 'audit_logs', desc: 'Log Audit Keamanan (ASVS)' },
  { name: 'attendance_reminders', desc: 'Antrean WA Pengingat Presensi' },
  { name: 'calendar_events', desc: 'Kalender Agenda Sekolah' },
  { name: 'class_transfers', desc: 'Log Riwayat Mutasi Kelas Siswa' }
];

const jsDir = path.resolve('js');
const files = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));

console.log('=== PEMETAAN STATUS KOLEKSI FIREBASE FIRESTORE ===\n');

collections.forEach(col => {
  const matching = [];
  files.forEach(file => {
    const content = fs.readFileSync(path.join(jsDir, file), 'utf8');
    if (content.includes(`'${col.name}'`) || content.includes(`"${col.name}"`) || (col.name === 'finance_transactions' && content.includes('financeTransactions'))) {
      matching.push(file);
    }
  });

  console.log(`📌 Koleksi: ${col.name} (${col.desc})`);
  console.log(`   Jumlah file aktif yang merujuk: ${matching.length} file`);
  if (matching.length > 0) {
    console.log(`   File: ${matching.join(', ')}`);
  }
  console.log('');
});

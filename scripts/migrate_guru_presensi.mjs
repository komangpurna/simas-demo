/**
 * scripts/migrate_guru_presensi.mjs
 * Script Migrasi Data Presensi Guru Harian dari Firestore ke Supabase PostgreSQL
 * 
 * Cara menjalankan:
 * node scripts/migrate_guru_presensi.mjs
 */

const SUPABASE_URL = 'https://elrmzlicuuglnoeedusr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVscm16bGljdXVnbG5vZWVkdXNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MzM4MjQsImV4cCI6MjA5NTMwOTgyNH0.Gq0j07cpV2KQp3TnktTHSXU3ZedBR0Uf6TuU_sioEzE';

async function upsertToSupabase(records) {
  if (!records || records.length === 0) return { count: 0 };
  
  const res = await fetch(`${SUPABASE_URL}/rest/v1/guru_presensi`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify(records)
  });
  
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Supabase Upsert HTTP ${res.status}: ${errText}`);
  }
  return { count: records.length };
}

async function runMigration() {
  console.log('====================================================');
  console.log('🚀 MEMULAI MIGRASI DATA GURU PRESENSI KE SUPABASE');
  console.log('====================================================\n');

  // Cek apakah tabel guru_presensi siap di Supabase
  try {
    const testRes = await fetch(`${SUPABASE_URL}/rest/v1/guru_presensi?select=id&limit=1`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    if (!testRes.ok) {
      console.error(`⚠️ Tabel 'guru_presensi' belum siap di Supabase (HTTP ${testRes.status}).`);
      console.error(`Silakan jalankan script SQL di supabase/migrations/202608140002_guru_presensi.sql pada SQL Editor Supabase terlebih dahulu.`);
      process.exit(1);
    }
    console.log('✅ Tabel Supabase `guru_presensi` terdeteksi aktif dan siap!');
  } catch (e) {
    console.error('Gagal terhubung ke Supabase:', e.message);
    process.exit(1);
  }

  console.log('\nPetunjuk: Migrasi data presensi guru aktif juga dapat dijalankan secara visual');
  console.log('dengan 1-klik melalui tombol di halaman integrasi.html (Super Admin).');
  console.log('\nMigrasi siap.');
}

runMigration().catch(console.error);

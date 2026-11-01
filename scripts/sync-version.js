#!/usr/bin/env node
/**
 * scripts/sync-version.js
 * Single Source of Truth (SSOT) Application Version Synchronizer
 *
 * Menyelaraskan versi aplikasi secara otomatis dari package.json (SSOT) ke:
 * 1. package-lock.json
 * 2. js/config.js (export const APP_VERSION = "...")
 * 3. Seluruh berkas HTML (tag <script> & <link> cache-buster ?v=YY.MM.DD.REV)
 *
 * Penggunaan:
 *   node scripts/sync-version.js          -> Sinkronkan semua berkas dengan versi di package.json
 *   node scripts/sync-version.js --check  -> Verifikasi apakah semua berkas sudah sinkron (exit 1 jika tidak)
 *   node scripts/sync-version.js 26.09.17.3 -> Set versi baru di package.json dan sinkronkan semua berkas
 *   node scripts/sync-version.js --bump   -> Auto-increment revisi harian (reset ke 1 jika ganti hari)
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const packageLockPath = path.join(rootDir, 'package-lock.json');
const configJsPath = path.join(rootDir, 'js', 'config.js');

const VERSION_REGEX = /^\d{2}\.\d{2}\.\d{2}\.\d+$/;
const VERSION_PARAM_REGEX = /([?&]v=)\d{2}\.\d{2}\.\d{2}\.\d+/g;

function safeWriteFileSync(filePath, content, encoding = 'utf8', retries = 5, delayMs = 150) {
  for (let i = 0; i < retries; i++) {
    try {
      fs.writeFileSync(filePath, content, encoding);
      return;
    } catch (err) {
      if (i === retries - 1) throw err;
      const start = Date.now();
      while (Date.now() - start < delayMs) {
        // synchronous brief sleep for retry against transient file locks
      }
    }
  }
}

const CANONICAL_PAGE_SCRIPTS = {
  'dashboard.html': 'js/page-dashboard.js',
  'guru-mapel.html': 'js/page-guru-mapel.js',
  'guru-wali.html': 'js/page-guru-wali.js',
  'wali-kelas.html': 'js/page-wali-kelas.js',
  'siswa.html': 'js/page-students.js',
  'keuangan.html': 'js/page-keuangan.js',
  'rkas-komite.html': 'js/page-rkas-komite.js',
  'input.html': 'js/page-input.js',
  'e-lab.html': 'js/page-e-lab.js',
  'monitoring-kbm.html': 'js/page-monitoring-kbm.js',
  'jurnal.html': 'js/page-jurnal.js',
  'jurnal-admin.html': 'js/page-jurnal-admin.js',
  'portal-siswa.html': 'js/page-portal-siswa.js',
  'ranking-kelas.html': 'js/page-ranking-kelas.js',
  'agenda.html': 'js/page-agenda.js',
  'agenda-pegawai.html': 'js/page-agenda-pegawai.js',
  'e-kinerja-tendik.html': 'js/page-e-kinerja-tendik.js',
  'dokumen.html': 'js/page-dokumen.js',
  'e-rapor.html': 'js/page-e-rapor.js',
  'gtk.html': 'js/page-gtk.js',
  'jadwal.html': 'js/page-jadwal.js',
  'masukan.html': 'js/page-masukan.js',
  'library/index.html': 'index.js',
  'library/presensi-perpus.html': 'presensi-perpus.js',
  'sukaduka/suka-duka.html': 'suka-duka.js',
  'yearbook.html': 'js/page-yearbook.js',
  'yearbook-admin.html': 'js/page-yearbook-admin.js',
  'penjualan-buku.html': 'js/page-penjualan-buku.js',
  'pesan-lks.html': 'js/page-pesan-lks.js'
};

const IGNORED_DIRS = new Set(['node_modules', 'cypress', 'tests', '.git', '.gemini', 'backup', 'coverage', '.vscode', '.agents', 'templates', 'dist-hosting', '.hosting-history']);

function getWitaDateString() {
  // WITA = UTC + 8
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const witaDate = new Date(utc + (3600000 * 8));
  const yy = String(witaDate.getFullYear()).slice(-2);
  const mm = String(witaDate.getMonth() + 1).padStart(2, '0');
  const dd = String(witaDate.getDate()).padStart(2, '0');
  return `${yy}.${mm}.${dd}`;
}

function calculateBumpedVersion(currentVersion) {
  const todayPrefix = getWitaDateString();
  const parts = (currentVersion || '').split('.');
  if (parts.length === 4) {
    const currentPrefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
    if (currentPrefix === todayPrefix) {
      const rev = parseInt(parts[3], 10) || 0;
      return `${todayPrefix}.${rev + 1}`;
    }
  }
  return `${todayPrefix}.1`;
}

function getAllHtmlFiles(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        getAllHtmlFiles(fullPath, fileList);
      }
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

function run() {
  const args = process.argv.slice(2);
  const isCheckMode = args.includes('--check');
  const isBumpMode = args.includes('--bump');
  const explicitVersion = args.find(a => VERSION_REGEX.test(a));

  if (!fs.existsSync(packageJsonPath)) {
    console.error('❌ Error: package.json tidak ditemukan!');
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  let targetVersion = pkg.version;

  if (explicitVersion) {
    targetVersion = explicitVersion;
  } else if (isBumpMode) {
    targetVersion = calculateBumpedVersion(pkg.version);
  }

  if (!VERSION_REGEX.test(targetVersion)) {
    console.error(`❌ Error: Format versi tidak valid "${targetVersion}". Format wajib YY.MM.DD.REV (contoh: 26.09.17.3)`);
    process.exit(1);
  }

  const htmlFiles = getAllHtmlFiles(rootDir);
  const discrepancies = [];

  // 1. Check / Sync package.json
  if (pkg.version !== targetVersion) {
    if (isCheckMode) {
      discrepancies.push(`package.json version (${pkg.version}) !== target (${targetVersion})`);
    } else {
      pkg.version = targetVersion;
      safeWriteFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
      console.log(`✅ [package.json] versi diperbarui ke ${targetVersion}`);
    }
  }

  // 2. Check / Sync package-lock.json
  if (fs.existsSync(packageLockPath)) {
    const lockRaw = fs.readFileSync(packageLockPath, 'utf8');
    const lock = JSON.parse(lockRaw);
    let lockModified = false;

    if (lock.version !== targetVersion) {
      if (isCheckMode) {
        discrepancies.push(`package-lock.json lock.version (${lock.version}) !== target (${targetVersion})`);
      } else {
        lock.version = targetVersion;
        lockModified = true;
      }
    }

    if (lock.packages && lock.packages[''] && lock.packages[''].version !== targetVersion) {
      if (isCheckMode) {
        discrepancies.push(`package-lock.json packages[""].version (${lock.packages[''].version}) !== target (${targetVersion})`);
      } else {
        lock.packages[''].version = targetVersion;
        lockModified = true;
      }
    }

    if (!isCheckMode && lockModified) {
      safeWriteFileSync(packageLockPath, JSON.stringify(lock, null, 2) + '\n', 'utf8');
      console.log(`✅ [package-lock.json] versi disinkronkan ke ${targetVersion}`);
    }
  }

  // 3. Check / Sync js/config.js
  if (fs.existsSync(configJsPath)) {
    const configContent = fs.readFileSync(configJsPath, 'utf8');
    const appVersionMatch = configContent.match(/export const APP_VERSION = "([^"]+)";/);
    if (!appVersionMatch || appVersionMatch[1] !== targetVersion) {
      if (isCheckMode) {
        discrepancies.push(`js/config.js APP_VERSION (${appVersionMatch ? appVersionMatch[1] : 'NOT FOUND'}) !== target (${targetVersion})`);
      } else {
        const updatedConfig = configContent.replace(
          /export const APP_VERSION = "([^"]+)";/,
          `export const APP_VERSION = "${targetVersion}";`
        );
        safeWriteFileSync(configJsPath, updatedConfig, 'utf8');
        console.log(`✅ [js/config.js] APP_VERSION disinkronkan ke ${targetVersion}`);
      }
    }
  }

  // 4. Check / Sync HTML Files
  let updatedHtmlCount = 0;
  for (const htmlPath of htmlFiles) {
    const relPath = path.relative(rootDir, htmlPath).replace(/\\/g, '/');
    let content = fs.readFileSync(htmlPath, 'utf8');
    let originalContent = content;

    // Check canonical script for this page if declared
    const canonicalScript = CANONICAL_PAGE_SCRIPTS[relPath];
    if (canonicalScript) {
      // Regex matching src="canonicalScript" or src="canonicalScript?v=..."
      const escapedScript = canonicalScript.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const canonicalRegex = new RegExp(`(src=["'])${escapedScript}(?:\\?v=[^"']*)?(["'])`, 'g');
      content = content.replace(canonicalRegex, `$1${canonicalScript}?v=${targetVersion}$2`);
    }

    // Replace all other version query parameters (?v=YY.MM.DD.REV)
    content = content.replace(VERSION_PARAM_REGEX, `$1${targetVersion}`);

    if (content !== originalContent) {
      if (isCheckMode) {
        discrepancies.push(`${relPath} memiliki tag script/link cache-buster yang belum sinkron dengan versi ${targetVersion}`);
      } else {
        safeWriteFileSync(htmlPath, content, 'utf8');
        updatedHtmlCount++;
      }
    }
  }

  if (isCheckMode) {
    if (discrepancies.length > 0) {
      console.error(`\n❌ [SYNC CHECK FAILED] Ditemukan ${discrepancies.length} ketidaksinkronan versi (Target SSOT: ${targetVersion}):`);
      discrepancies.forEach(d => console.error(`   - ${d}`));
      console.error('\n💡 Solusi: Jalankan "npm run sync:version" untuk menyinkronkan seluruh berkas secara otomatis.\n');
      process.exit(1);
    } else {
      console.log(`✅ [SYNC CHECK PASSED] Seluruh berkas (${htmlFiles.length} berkas HTML, config.js, package-lock.json) tersinkronisasi 100% pada versi ${targetVersion}.`);
      process.exit(0);
    }
  } else {
    console.log(`\n🎉 Berhasil menyinkronkan versi ${targetVersion} ke ${updatedHtmlCount} berkas HTML, js/config.js, dan package-lock.json.`);
  }
}

run();

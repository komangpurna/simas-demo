/**
 * scripts/sync-demo-repo.mjs
 * Sinkronisasi otomatis codebase dari smagesa-simas ke repositori simas-demo
 * dengan menerapkan konfigurasi sekolah demo (SMA Negeri Nusantara).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { prepareSchool } from './prepare-school.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = path.resolve(SCRIPT_DIR, '..');

// Argumen CLI
const args = process.argv.slice(2);
function getArg(name) {
    const idx = args.indexOf(name);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
}
const shouldCommit = args.includes('--commit');
const shouldPush = args.includes('--push');
const targetArg = getArg('--target');
const TARGET_ROOT = targetArg ? path.resolve(process.cwd(), targetArg) : path.resolve(SOURCE_ROOT, '..', 'simas-demo');

async function main() {
    console.log('🔄 Memulai sinkronisasi dari smagesa-simas ke simas-demo...');
    console.log(`Source: ${SOURCE_ROOT}`);
    console.log(`Target: ${TARGET_ROOT}`);

    // 1. Verifikasi target repo ada dan memiliki folder .git
    try {
        await fs.access(path.join(TARGET_ROOT, '.git'));
    } catch {
        throw new Error(`Target repo ${TARGET_ROOT} tidak ditemukan atau belum di-clone.`);
    }

    // 2. Baca file profile school.demo.json
    const profilePath = path.join(SOURCE_ROOT, 'school.demo.json');
    const profileRaw = await fs.readFile(profilePath, 'utf8');
    const profile = JSON.parse(profileRaw);

    // 3. Dapatkan daftar tracked files dari git di source
    const trackedOutput = execSync('git ls-files', { cwd: SOURCE_ROOT, encoding: 'utf8' });
    const trackedFiles = trackedOutput.split(/\r?\n/).filter(f => f.trim() && !f.startsWith('.git/'));

    console.log(`📦 Menyalin ${trackedFiles.length} berkas tracked ke simas-demo...`);
    for (const file of trackedFiles) {
        const src = path.join(SOURCE_ROOT, file);
        const dest = path.join(TARGET_ROOT, file);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(src, dest);
    }

    // Salin school.demo.json ke target
    await fs.copyFile(profilePath, path.join(TARGET_ROOT, 'school.demo.json'));

    // 3.1. Pasang Aset Visual Dummy Sekolah (SMANTARA) ke folder assets di target
    const demoAssetsDir = path.join(SOURCE_ROOT, 'assets-demo');
    try {
        const demoAssets = await fs.readdir(demoAssetsDir);
        console.log(`🖼️ Menyalin ${demoAssets.length} aset visual dummy sekolah ke simas-demo/assets...`);
        for (const assetFile of demoAssets) {
            const srcAsset = path.join(demoAssetsDir, assetFile);
            const destAsset = path.join(TARGET_ROOT, 'assets', assetFile);
            await fs.copyFile(srcAsset, destAsset);
        }
        // Hapus video animasi logo lama agar tidak membocorkan identitas SMAGESA di situs demo
        const videoFiles = ['animasilogo.webm', 'animasilogomobile.webm', 'logoonly.webm'];
        for (const vf of videoFiles) {
            try {
                await fs.unlink(path.join(TARGET_ROOT, 'assets', vf));
            } catch {
                // Abaikan jika berkas tidak ditemukan
            }
        }
        console.log('✅ Aset visual dummy sekolah SMANTARA berhasil dipasang ke target demo.');
    } catch (e) {
        console.warn('⚠️ Peringatan saat menyalin aset demo:', e.message);
    }

    // 4. Jalankan prepareSchool dengan apply: true pada target repo
    console.log('⚙️ Menerapkan konfigurasi demo pada simas-demo...');
    const result = await prepareSchool({ root: TARGET_ROOT, profile, apply: true });
    console.log(`✅ Berhasil menerapkan konfigurasi demo (${result.changes.length} berkas disesuaikan).`);

    // 5. Satukan migrasi Supabase ke demo_full_schema.sql di target
    const migDir = path.join(SOURCE_ROOT, 'supabase', 'migrations');
    try {
        const migFiles = (await fs.readdir(migDir)).filter(f => f.endsWith('.sql')).sort();
        let combined = '-- ========================================================\n';
        combined += '-- SIMAS DEMO - FULL SUPABASE DATABASE SCHEMA MIGRATION\n';
        combined += '-- Otomatis digabungkan dari ' + migFiles.length + ' berkas migrasi resmi\n';
        combined += '-- ========================================================\n\n';
        for (const file of migFiles) {
            combined += '-- >>> MIGRATION: ' + file + ' >>>\n';
            combined += await fs.readFile(path.join(migDir, file), 'utf8') + '\n\n';
        }
        await fs.writeFile(path.join(TARGET_ROOT, 'supabase', 'demo_full_schema.sql'), combined);
        console.log(`✅ File skema gabungan supabase/demo_full_schema.sql diperbarui (${migFiles.length} migrasi).`);
    } catch (e) {
        console.warn('⚠️ Gagal membuat demo_full_schema.sql:', e.message);
    }

    // 6. Commit & Push jika diminta
    if (shouldCommit) {
        console.log('📝 Memeriksa perubahan git pada repositori demo...');
        const status = execSync('git status --porcelain', { cwd: TARGET_ROOT, encoding: 'utf8' }).trim();
        if (status) {
            console.log('📤 Menemukan perubahan, melakukan commit...');
            execSync('git add -A', { cwd: TARGET_ROOT, stdio: 'inherit' });
            execSync('git commit -m "chore(sync): sync upstream updates from smagesa-simas [skip ci]"', { cwd: TARGET_ROOT, stdio: 'inherit' });
            if (shouldPush) {
                console.log('🚀 Mendorong (push) perubahan ke repositori remote simas-demo...');
                execSync('git push origin main', { cwd: TARGET_ROOT, stdio: 'inherit' });
                console.log('✅ Berhasil push pembaruan ke GitHub simas-demo!');
            }
        } else {
            console.log('✨ Tidak ada perubahan baru di repositori demo (sudah tersinkronisasi sempurna).');
        }
    }

    console.log('🎉 Sinkronisasi ke simas-demo berhasil selesai!');
}

main().catch(err => {
    console.error('❌ Gagal sinkronisasi:', err.message || err);
    process.exit(1);
});

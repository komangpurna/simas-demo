const client = require('firebase-tools');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

async function main() {
    console.log('🚀 Memulai deployment langsung ke Firebase PRODUKSI (smagesa, simas-shakti, firestore)...');
    try {
        await client.deploy({
            project: 'smagesa',
            only: 'hosting:smagesa,hosting:simas-shakti,firestore',
            cwd: rootDir,
            force: true,
            nonInteractive: true
        });
        console.log('✅ Berhasil deploy ke hosting:smagesa & simas-shakti (https://smagesa.web.app & https://simas-shakti.web.app)!');
    } catch (err) {
        console.error('❌ Gagal deploy produksi:', err.message || err);
        process.exit(1);
    }
}

main();

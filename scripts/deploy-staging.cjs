const client = require('firebase-tools');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

async function main() {
    console.log('🚀 Memulai deployment langsung ke Firebase TESTING / STAGING (sman1abang)...');
    try {
        await client.deploy({
            project: 'smagesa',
            only: 'hosting:sman1abang',
            cwd: rootDir,
            force: true,
            nonInteractive: true
        });
        console.log('✅ Berhasil deploy ke hosting:sman1abang (https://sman1abang.web.app)!');
    } catch (err) {
        console.error('❌ Gagal deploy:', err.message || err);
        process.exit(1);
    }
}

main();

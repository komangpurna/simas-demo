const fs = require('fs');
const path = require('path');

// Kredensial & secret dibaca dari cloudflare/.env (lokal, ter-ignore git) atau environment proses.
const envPath = path.join(__dirname, '..', 'cloudflare', '.env');
const env = { ...process.env };
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split(/\r?\n/).forEach(line => {
        if (!line || line.trim().startsWith('#')) return;
        const idx = line.indexOf('=');
        if (idx > 0) env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    });
}

// [vars] di wrangler.toml adalah sumber tunggal variabel publik Worker (dipakai juga oleh `wrangler deploy` di CI).
const wranglerToml = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'wrangler.toml'), 'utf8');
function readWranglerVar(name) {
    const match = wranglerToml.match(new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, 'm'));
    return match ? match[1] : undefined;
}

function readBucketBinding(binding) {
    const block = wranglerToml.split('[[r2_buckets]]').slice(1)
        .find(value => new RegExp(`^binding\\s*=\\s*"${binding}"`, 'm').test(value));
    return block?.match(/^bucket_name\s*=\s*"([^"]+)"/m)?.[1];
}

function requireValue(name, value) {
    if (!value) {
        console.error(`❌ ${name} belum diisi. Tambahkan ${name}=... ke cloudflare/.env`);
        process.exit(1);
    }
    return value;
}

const ACCOUNT_ID = requireValue('CLOUDFLARE_ACCOUNT_ID', env.CLOUDFLARE_ACCOUNT_ID);
const API_TOKEN = requireValue('CLOUDFLARE_API_TOKEN', env.CLOUDFLARE_API_TOKEN);
const JURNAL_API_KEY = requireValue('JURNAL_API_KEY', env.JURNAL_API_KEY);
const MIGRATION_SECRET = requireValue('MIGRATION_SECRET', env.MIGRATION_SECRET);
const SUPABASE_URL = requireValue('SUPABASE_URL (wrangler.toml)', readWranglerVar('SUPABASE_URL'));
const SUPABASE_ANON_KEY = requireValue('SUPABASE_ANON_KEY (wrangler.toml)', readWranglerVar('SUPABASE_ANON_KEY'));
const SCRIPT_NAME = requireValue('name (wrangler.toml)', readWranglerVar('name'));
const DATABASE_ID = requireValue('database_id (wrangler.toml)', readWranglerVar('database_id'));

async function deployWorkerViaApi() {
    console.log(`Deploying Worker "${SCRIPT_NAME}" to Cloudflare API...`);

    // worker.js meng-import modul cloudflare/lib/*.js. Upload REST hanya menerima satu file di sini,
    // jadi validasi modul lalu bundel dengan esbuild (mesin yang sama dengan `wrangler deploy`).
    const { execFileSync } = require('child_process');
    execFileSync(process.execPath, [path.join(__dirname, 'check-worker-modules.mjs')], { stdio: 'inherit' });
    const esbuild = require('esbuild');
    const bundle = await esbuild.build({
        entryPoints: [path.join(__dirname, '..', 'cloudflare', 'worker.js')],
        bundle: true,
        format: 'esm',
        platform: 'neutral',
        target: 'es2022',
        write: false,
        logLevel: 'silent'
    });
    const workerCode = bundle.outputFiles[0].text;

    const metadata = {
        main_module: 'worker.js',
        compatibility_date: readWranglerVar('compatibility_date'),
        // Pertahankan secret yang dipasang via `wrangler secret put` (GOOGLE_PRIVATE_KEY,
        // TELEGRAM_BOT_TOKEN, SUPABASE_SERVICE_ROLE_KEY, dst.). Tanpa ini, upload via API
        // berisiko menghapus secret sehingga push FCM, Telegram, dan cron gagal diam-diam.
        keep_bindings: ['secret_text', 'secret_key'],
        bindings: [
            {
                type: 'd1',
                name: 'DB',
                id: DATABASE_ID
            },
            {
                type: 'r2_bucket',
                name: 'STUDENT_PHOTOS_BUCKET',
                bucket_name: requireValue('STUDENT_PHOTOS_BUCKET', readBucketBinding('STUDENT_PHOTOS_BUCKET'))
            },
            {
                type: 'r2_bucket',
                name: 'GTK_PHOTOS_BUCKET',
                bucket_name: requireValue('GTK_PHOTOS_BUCKET', readBucketBinding('GTK_PHOTOS_BUCKET'))
            },
            {
                type: 'plain_text',
                name: 'ENVIRONMENT',
                text: 'production'
            },
            {
                type: 'plain_text',
                name: 'FIREBASE_PROJECT_ID',
                text: requireValue('FIREBASE_PROJECT_ID (wrangler.toml)', readWranglerVar('FIREBASE_PROJECT_ID'))
            },
            {
                type: 'plain_text',
                name: 'PUBLIC_WORKER_URL',
                text: requireValue('PUBLIC_WORKER_URL (wrangler.toml)', readWranglerVar('PUBLIC_WORKER_URL'))
            },
            {
                type: 'plain_text',
                name: 'APP_BASE_URL',
                text: readWranglerVar('APP_BASE_URL') || 'https://smagesa.web.app'
            },
            {
                type: 'plain_text',
                name: 'JURNAL_API_KEY',
                text: JURNAL_API_KEY
            },
            {
                type: 'plain_text',
                name: 'MIGRATION_SECRET',
                text: MIGRATION_SECRET
            },
            {
                type: 'plain_text',
                name: 'SUPABASE_URL',
                text: SUPABASE_URL
            },
            {
                type: 'plain_text',
                name: 'SUPABASE_ANON_KEY',
                text: SUPABASE_ANON_KEY
            }
        ]
    };

    const formData = new FormData();
    formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }), 'metadata');
    formData.append('worker.js', new Blob([workerCode], { type: 'application/javascript+module' }), 'worker.js');

    const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${SCRIPT_NAME}`;

    let deploySuccess = false;
    let json = null;
    try {
        const resp = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${API_TOKEN}`
            },
            body: formData
        });

        json = await resp.json();
        if (resp.ok && json.success) {
            deploySuccess = true;
            console.log("✅ Worker berhasil dideploy ke Cloudflare via API!");
            console.log("Worker details:", json.result?.id, json.result?.etag);
        } else {
            console.warn("Direct API upload response:", json?.errors || json);
        }
    } catch (apiErr) {
        console.warn("Direct API upload failed:", apiErr.message);
    }

    if (!deploySuccess) {
        console.log("🔄 Mencoba deployment resmi via Wrangler CLI...");
        const { execSync } = require('child_process');
        const cfDir = path.join(__dirname, '..', 'cloudflare');
        execSync('npx wrangler deploy', {
            cwd: cfDir,
            env: {
                ...process.env,
                CLOUDFLARE_API_TOKEN: API_TOKEN,
                CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID
            },
            stdio: 'inherit'
        });
        console.log("✅ Worker berhasil dideploy via Wrangler CLI!");
    }

    // Update Cron Schedules di Cloudflare API (Interval 10 menit)
    try {
        const scheduleUrl = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${SCRIPT_NAME}/schedules`;
        const schedResp = await fetch(scheduleUrl, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify([
                { cron: "*/10 * * * *" }
            ])
        });
        const schedJson = await schedResp.json();
        if (schedJson.success) {
            console.log("✅ Cron schedules berhasil diperbarui ke interval 10 menit (*/10 * * * *)!");
        } else {
            console.warn("⚠️ Cron schedules warning:", schedJson.errors);
        }
    } catch (schedErr) {
        console.warn("⚠️ Gagal memperbarui cron schedule via API:", schedErr.message);
    }
}


deployWorkerViaApi().catch(error => {
    console.error(error);
    process.exitCode = 1;
});

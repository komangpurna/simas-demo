/**
 * Unit Test: Pusat Notifikasi In-App (Notification Center & Inbox)
 * Memverifikasi logika visual, format waktu, endpoint Cloudflare Worker,
 * serta paritas client-server untuk Notification Bell & Inbox SIMAS SMAGESA.
 */

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// Helper: Ekstrak implementasi fungsi dari js/notification-inbox.js
const inboxSource = fs.readFileSync(path.join(__dirname, '../js/notification-inbox.js'), 'utf8');

function extractFunction(source, fnName) {
    const match = source.match(new RegExp(`export function ${fnName}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`));
    if (!match) throw new Error(`Function ${fnName} not found in source`);
    const fnBody = match[0].replace(`export function ${fnName}`, `function ${fnName}`);
    return new Function(`${fnBody}; return ${fnName};`)();
}

const formatRelativeTime = extractFunction(inboxSource, 'formatRelativeTime');
const getNotificationVisual = extractFunction(inboxSource, 'getNotificationVisual');

describe('Notification Center & Inbox Unit Tests', () => {

    // 1. UJI FORMAT WAKTU RELATIF
    describe('Format Waktu Relatif (formatRelativeTime)', () => {
        test('Mengembalikan string kosong jika input falsy atau tanggal tidak valid', () => {
            expect(formatRelativeTime('')).toBe('');
            expect(formatRelativeTime(null)).toBe('');
            expect(formatRelativeTime('invalid-date')).toBe('');
        });

        test('Menghasilkan "Baru saja" untuk waktu kurang dari 60 detik', () => {
            const now = new Date(Date.now() - 30 * 1000).toISOString();
            expect(formatRelativeTime(now)).toBe('Baru saja');
        });

        test('Menghasilkan "X mnt lalu" untuk waktu kurang dari 60 menit', () => {
            const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
            expect(formatRelativeTime(tenMinutesAgo)).toBe('10 mnt lalu');
        });

        test('Menghasilkan "X jam lalu" untuk waktu kurang dari 24 jam', () => {
            const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
            expect(formatRelativeTime(twoHoursAgo)).toBe('2 jam lalu');
        });

        test('Menghasilkan "Kemarin" untuk waktu 1 hari lalu', () => {
            const yesterday = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
            expect(formatRelativeTime(yesterday)).toBe('Kemarin');
        });

        test('Menghasilkan "X hari lalu" untuk waktu beberapa hari lalu', () => {
            const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
            expect(formatRelativeTime(threeDaysAgo)).toBe('3 hari lalu');
        });
    });

    // 2. UJI KATEGORI VISUAL NOTIFIKASI
    describe('Deteksi Visual Notifikasi (getNotificationVisual)', () => {
        test('Mendeteksi notifikasi E-Laboratorium', () => {
            const visual = getNotificationVisual('Status Booking Lab', 'Pengajuan disetujui', './e-lab.html');
            expect(visual.category).toBe('E-Laboratorium');
            expect(visual.icon).toBe('fa-flask');
        });

        test('Mendeteksi notifikasi Presensi', () => {
            const visual = getNotificationVisual('Pengingat Presensi Kelas', 'Presensi hari ini belum lengkap', './presensi.html');
            expect(visual.category).toBe('Presensi');
            expect(visual.icon).toBe('fa-calendar-check');
        });

        test('Mendeteksi notifikasi Permisi Siswa / Perizinan', () => {
            const visual = getNotificationVisual('📋 Catatan Izin Permisi Siswa', 'I Putu mengajukan izin keluar', './portal-siswa.html');
            expect(visual.category).toBe('Perizinan');
            expect(visual.icon).toBe('fa-person-walking-arrow-right');
        });

        test('Mendeteksi notifikasi Prestasi Siswa', () => {
            const visual = getNotificationVisual('🌟 Catatan Prestasi Siswa Binaan', 'Siswa meraih juara olimpiade', './guru-wali.html');
            expect(visual.category).toBe('Prestasi');
            expect(visual.icon).toBe('fa-trophy');
        });

        test('Mendeteksi notifikasi Kedisiplinan Pelanggaran Siswa / BK', () => {
            const visual = getNotificationVisual('⚠️ Catatan Kedisiplinan Baru', 'Siswa mendapatkan catatan Pelanggaran (+10 poin)', './bk.html');
            expect(visual.category).toBe('Kedisiplinan & BK');
            expect(visual.icon).toBe('fa-shield-halved');
        });

        test('Mendeteksi notifikasi Keuangan & SPP', () => {
            const visual = getNotificationVisual('Rekapitulasi SPP', 'Tunggakan kelas telah diperbarui', './keuangan.html');
            expect(visual.category).toBe('Keuangan');
            expect(visual.icon).toBe('fa-receipt');
        });

        test('Mendeteksi notifikasi Agenda Kegiatan', () => {
            const visual = getNotificationVisual('Agenda Sekolah', 'Rapat dewan guru besok pagi', './agenda.html');
            expect(visual.category).toBe('Agenda');
            expect(visual.icon).toBe('fa-calendar-days');
        });

        test('Memberikan kategori default Informasi untuk topik umum', () => {
            const visual = getNotificationVisual('Pengumuman Sekolah', 'Selamat datang di semester baru', './dashboard.html');
            expect(visual.category).toBe('Informasi');
            expect(visual.icon).toBe('fa-bell');
        });
    });

    // 3. UJI LOGIKA ENDPOINT CLOUDFLARE D1 INBOX & MARK-READ (IN-MEMORY SQLITE)
    describe('Kueri Endpoint Cloudflare D1 Inbox & Mark-Read', () => {
        let sqlite;

        beforeEach(() => {
            sqlite = new DatabaseSync(':memory:');
            // Inisialisasi tabel notifikasi D1
            sqlite.exec(`
                CREATE TABLE notification_jobs (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    body TEXT NOT NULL,
                    url TEXT DEFAULT './dashboard.html',
                    target_type TEXT NOT NULL,
                    target_value TEXT DEFAULT '',
                    status TEXT DEFAULT 'pending',
                    created_by TEXT NOT NULL,
                    created_at TEXT DEFAULT (datetime('now'))
                );

                CREATE TABLE notification_deliveries (
                    id TEXT PRIMARY KEY,
                    job_id TEXT NOT NULL,
                    token_id TEXT NOT NULL,
                    token TEXT NOT NULL,
                    recipient_uid TEXT NOT NULL DEFAULT '',
                    status TEXT DEFAULT 'sent',
                    is_read INTEGER NOT NULL DEFAULT 0,
                    read_at TEXT DEFAULT '',
                    created_at TEXT DEFAULT (datetime('now'))
                );
            `);

            // Seed data notifikasi
            sqlite.exec(`
                INSERT INTO notification_jobs (id, title, body, url, target_type, created_by, created_at)
                VALUES 
                ('job_1', 'Peminjaman Lab Disetujui', 'Lab Komputer 1 telah disetujui', './e-lab.html', 'user', 'admin_1', '2026-10-07 10:00:00'),
                ('job_2', 'Pengingat Presensi', 'Presensi kelas belum lengkap', './presensi.html', 'user', 'admin_1', '2026-10-07 11:00:00');

                INSERT INTO notification_deliveries (id, job_id, token_id, token, recipient_uid, status, is_read, created_at)
                VALUES 
                ('del_1', 'job_1', 'tok_1', 'token_abc', 'guru_123', 'sent', 0, '2026-10-07 10:00:00'),
                ('del_2', 'job_2', 'tok_1', 'token_abc', 'guru_123', 'sent', 0, '2026-10-07 11:00:00'),
                ('del_3', 'job_1', 'tok_2', 'token_xyz', 'guru_999', 'sent', 0, '2026-10-07 10:00:00');
            `);
        });

        test('Kueri inbox mengambil notifikasi yang hanya ditujukan untuk recipient_uid pengguna', () => {
            const query = `
                SELECT 
                    j.id AS id,
                    j.title,
                    j.body,
                    j.url,
                    j.target_type,
                    j.created_at,
                    COALESCE(MAX(d.is_read), 0) AS is_read
                FROM notification_deliveries d
                JOIN notification_jobs j ON j.id = d.job_id
                WHERE d.recipient_uid = ?
                GROUP BY j.id
                ORDER BY j.created_at DESC
            `;
            const rows = sqlite.prepare(query).all('guru_123');
            expect(rows.length).toBe(2);
            expect(rows[0].id).toBe('job_2');
            expect(rows[0].title).toBe('Pengingat Presensi');
            expect(rows[0].is_read).toBe(0);
        });

        test('Kueri unread_count menghitung notifikasi belum dibaca secara tepat', () => {
            const query = `
                SELECT COUNT(DISTINCT j.id) AS unread_count
                FROM notification_deliveries d
                JOIN notification_jobs j ON j.id = d.job_id
                WHERE d.recipient_uid = ? AND COALESCE(d.is_read, 0) = 0
            `;
            const result = sqlite.prepare(query).get('guru_123');
            expect(Number(result.unread_count)).toBe(2);
        });

        test('Tandai notifikasi tunggal sebagai dibaca (mark-read single)', () => {
            sqlite.prepare(`
                UPDATE notification_deliveries
                SET is_read = 1, read_at = datetime('now')
                WHERE recipient_uid = ? AND (job_id = ? OR id = ?)
            `).run('guru_123', 'job_1', 'job_1');

            const check = sqlite.prepare(`
                SELECT is_read FROM notification_deliveries WHERE recipient_uid = 'guru_123' AND job_id = 'job_1'
            `).get();
            expect(check.is_read).toBe(1);

            // job_2 masih belum dibaca
            const check2 = sqlite.prepare(`
                SELECT is_read FROM notification_deliveries WHERE recipient_uid = 'guru_123' AND job_id = 'job_2'
            `).get();
            expect(check2.is_read).toBe(0);
        });

        test('Tandai semua notifikasi sebagai dibaca (mark-read all)', () => {
            sqlite.prepare(`
                UPDATE notification_deliveries
                SET is_read = 1, read_at = datetime('now')
                WHERE recipient_uid = ? AND is_read = 0
            `).run('guru_123');

            const unreadResult = sqlite.prepare(`
                SELECT COUNT(*) as unread FROM notification_deliveries WHERE recipient_uid = 'guru_123' AND is_read = 0
            `).get();
            expect(Number(unreadResult.unread)).toBe(0);
        });
    });

    // 4. PARITAS KODE WORKER & CLIENT
    describe('Paritas Implementasi Worker API & CloudflareClient', () => {
        const workerPath = path.join(__dirname, '../cloudflare/worker.js');
        const clientPath = path.join(__dirname, '../js/cloudflare-client.js');
        const workerContent = fs.readFileSync(workerPath, 'utf8');
        const clientContent = fs.readFileSync(clientPath, 'utf8');

        test('worker.js memiliki rute GET /api/notifications/inbox', () => {
            expect(workerContent).toContain('path === "/api/notifications/inbox" && method === "GET"');
        });

        test('worker.js memiliki rute POST /api/notifications/mark-read', () => {
            expect(workerContent).toContain('path === "/api/notifications/mark-read" && method === "POST"');
        });

        test('cloudflare-client.js memiliki method getNotificationInbox dan markNotificationAsRead', () => {
            expect(clientContent).toContain('async getNotificationInbox()');
            expect(clientContent).toContain("this.request('/api/notifications/inbox')");
            expect(clientContent).toContain('async markNotificationAsRead(id = \'\', markAll = false)');
            expect(clientContent).toContain("this.request('/api/notifications/mark-read'");
        });
    });

    // 5. INTEGRITAS DOM & LARANGAN MODAL BERSARANG
    describe('Integritas DOM UI & Modal Detail', () => {
        const globalJsPath = path.join(__dirname, '../js/global.js');
        const globalContent = fs.readFileSync(globalJsPath, 'utf8');

        test('global.js memuat tombol Lonceng Notifikasi Desktop dan Mobile', () => {
            expect(globalContent).toContain('id="btn-notification-bell-desktop"');
            expect(globalContent).toContain('id="btn-notification-bell-mobile"');
            expect(globalContent).toContain('id="notif-badge-desktop"');
            expect(globalContent).toContain('id="notif-badge-mobile"');
        });

        test('Tombol Lonceng Desktop melayang di sebelah kanan tombol toggle sidebar dan tidak tersembunyi saat collapsed', () => {
            // Memastikan tombol lonceng desktop berada di luar sidebar (melayang di sebelah kanan tombol collapse)
            expect(globalContent).toContain('style="left: calc(100% + 18px); top: 20px;"');
            // Memastikan tidak memiliki class sidebar-text yang membuatnya hilang saat sidebar collapsed
            const desktopBellMatch = globalContent.match(/<button id="btn-notification-bell-desktop"[^>]*>/);
            expect(desktopBellMatch).not.toBeNull();
            expect(desktopBellMatch[0]).not.toContain('sidebar-text');
        });

        test('global.js memuat container panel dan modal detail notifikasi', () => {
            expect(globalContent).toContain('id="notification-center-panel"');
            expect(globalContent).toContain('id="notification-center-backdrop"');
            expect(globalContent).toContain('id="modal-notification-detail"');
        });

        test('modal-notification-detail berdiri mandiri dan memiliki tombol tutup & aksi', () => {
            expect(globalContent).toContain('id="notif-detail-btn-action"');
            expect(globalContent).toContain('window.closeNotificationDetail()');
        });
    });

    // 6. ANIMASI LONCENG NOTIFIKASI (BELL RING SWING ANIMATION)
    describe('Animasi Lonceng Notifikasi (Bell Ring Swing Animation)', () => {
        const styleCssPath = path.join(__dirname, '../css/style.css');
        const styleContent = fs.readFileSync(styleCssPath, 'utf8');

        test('style.css mendefinisikan keyframes bellRing dan kelas utilitas animate-bell-ring', () => {
            expect(styleContent).toContain('@keyframes bellRing');
            expect(styleContent).toContain('.animate-bell-ring');
            expect(styleContent).toContain('transform-origin: top center');
        });

        test('updateNotificationBadges menambahkan class animate-bell-ring saat unreadCount > 0 dan menghapusnya saat 0', () => {
            const { JSDOM } = require('jsdom');
            const dom = new JSDOM(`
                <button id="btn-notification-bell-desktop">
                    <i class="fa-solid fa-bell"></i>
                    <span id="notif-badge-desktop" class="hidden">0</span>
                </button>
                <button id="btn-notification-bell-mobile">
                    <i class="fa-solid fa-bell"></i>
                    <span id="notif-badge-mobile" class="hidden">0</span>
                </button>
                <div id="notif-panel-unread-count" class="hidden"></div>
            `);

            const vm = require('node:vm');
            const context = vm.createContext({
                document: dom.window.document,
                window: dom.window,
                _unreadCount: 0
            });
            const cleanSource = inboxSource
                .replace(/import\s+[^;]+;/g, '')
                .replace(/export\s+/g, '');
            vm.runInContext(cleanSource, context);

            const desktopIcon = dom.window.document.querySelector('#btn-notification-bell-desktop i.fa-bell');
            const mobileIcon = dom.window.document.querySelector('#btn-notification-bell-mobile i.fa-bell');

            // Kasus 1: Notifikasi belum terbaca > 0 -> Lonceng bergoyang (animate-bell-ring)
            context.updateNotificationBadges(5);
            expect(desktopIcon.classList.contains('animate-bell-ring')).toBe(true);
            expect(mobileIcon.classList.contains('animate-bell-ring')).toBe(true);

            // Kasus 2: Notifikasi dibaca semua -> Lonceng diam (animate-bell-ring dihapus)
            context.updateNotificationBadges(0);
            expect(desktopIcon.classList.contains('animate-bell-ring')).toBe(false);
            expect(mobileIcon.classList.contains('animate-bell-ring')).toBe(false);
        });
    });
});

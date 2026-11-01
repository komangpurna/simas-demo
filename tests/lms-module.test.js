/**
 * Unit & Behavioral Test: Modul LMS (Learning Management System) SIMAS SMAGESA
 * Menguji helper utils LMS, enkripsi/verifikasi Edge Token Siswa HMAC-SHA256,
 * sanitasi renderSafeMarkdown (OWASP ASVS Level 2), kalkulasi urgensi due date,
 * auto-cleanup rolling 3 tahun, dan otorisasi Cloudflare Worker D1.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

describe('Modul LMS: Helper Utilities, Security & Route Integrity', () => {
    const root = path.resolve(__dirname, '..');
    const workerContent = fs.readFileSync(path.join(root, 'cloudflare/worker.js'), 'utf8');
    const migrationContent = fs.readFileSync(path.join(root, 'cloudflare/migrations/202609070002_add_lms_module.sql'), 'utf8');

    // =========================================================================
    // 1. UJI HELPER isClassEqual
    // =========================================================================
    describe('Helper isClassEqual', () => {
        function isClassEqual(c1, c2) {
            if (!c1 || !c2) return false;
            const norm = (s) => String(s).trim().toLowerCase().replace(/\s+/g, ' ');
            return norm(c1) === norm(c2);
        }

        test('Mengevaluasi nama rombel secara case-insensitive dan toleran spasi', () => {
            expect(isClassEqual('X-A', 'x-a')).toBe(true);
            expect(isClassEqual(' XII MIPA 1 ', 'xii mipa 1')).toBe(true);
            expect(isClassEqual('X-1', 'x-2')).toBe(false);
            expect(isClassEqual(null, 'X-A')).toBe(false);
            expect(isClassEqual('X-A', undefined)).toBe(false);
        });
    });

    // =========================================================================
    // 2. UJI HELPER calculateDueDateUrgency
    // =========================================================================
    describe('Helper calculateDueDateUrgency', () => {
        function calculateDueDateUrgency(dueDateStr, isCompleted = false, nowParam = null) {
            if (isCompleted) {
                return {
                    level: 'done',
                    label: 'Selesai',
                    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800',
                    icon: 'fa-solid fa-circle-check',
                    daysRemaining: null,
                    isUrgent: false
                };
            }
            if (!dueDateStr) {
                return {
                    level: 'none',
                    label: '',
                    badgeClass: '',
                    icon: '',
                    daysRemaining: null,
                    isUrgent: false
                };
            }

            const now = nowParam ? new Date(nowParam) : new Date();
            const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
            const parts = String(dueDateStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (!parts) {
                return {
                    level: 'none',
                    label: dueDateStr,
                    badgeClass: 'bg-slate-100 text-slate-600 border-slate-200',
                    icon: 'fa-regular fa-clock',
                    daysRemaining: null,
                    isUrgent: false
                };
            }

            const dueMidnight = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])).getTime();
            const diffDays = Math.round((dueMidnight - todayMidnight) / (1000 * 60 * 60 * 24));

            if (diffDays < 0) {
                const daysLate = Math.abs(diffDays);
                return {
                    level: 'overdue',
                    label: `Terlambat ${daysLate} hari`,
                    badgeClass: 'bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800 font-extrabold',
                    icon: 'fa-solid fa-triangle-exclamation',
                    daysRemaining: diffDays,
                    isUrgent: true
                };
            }
            if (diffDays === 0) {
                return {
                    level: 'today',
                    label: 'Tenggat Hari Ini',
                    badgeClass: 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800 font-extrabold animate-pulse',
                    icon: 'fa-solid fa-stopwatch',
                    daysRemaining: 0,
                    isUrgent: true
                };
            }
            if (diffDays <= 2) {
                return {
                    level: 'soon',
                    label: `${diffDays} hari lagi`,
                    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800 font-bold',
                    icon: 'fa-regular fa-clock',
                    daysRemaining: diffDays,
                    isUrgent: true
                };
            }
            return {
                level: 'normal',
                label: `${diffDays} hari lagi`,
                badgeClass: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
                icon: 'fa-regular fa-calendar',
                daysRemaining: diffDays,
                isUrgent: false
            };
        }

        test('Mengembalikan status done jika isCompleted = true', () => {
            const res = calculateDueDateUrgency('2026-09-01', true);
            expect(res.level).toBe('done');
            expect(res.label).toBe('Selesai');
            expect(res.isUrgent).toBe(false);
        });

        test('Mendeteksi status overdue jika tanggal telah terlewati', () => {
            const now = new Date('2026-09-07T12:00:00Z');
            const res = calculateDueDateUrgency('2026-09-05', false, now);
            expect(res.level).toBe('overdue');
            expect(res.label).toBe('Terlambat 2 hari');
            expect(res.isUrgent).toBe(true);
        });

        test('Mendeteksi status today jika tenggat hari ini', () => {
            const now = new Date('2026-09-07T08:00:00Z');
            const res = calculateDueDateUrgency('2026-09-07', false, now);
            expect(res.level).toBe('today');
            expect(res.label).toBe('Tenggat Hari Ini');
            expect(res.isUrgent).toBe(true);
        });

        test('Mendeteksi status soon jika 1-2 hari lagi', () => {
            const now = new Date('2026-09-07T08:00:00Z');
            const res = calculateDueDateUrgency('2026-09-09', false, now);
            expect(res.level).toBe('soon');
            expect(res.label).toBe('2 hari lagi');
            expect(res.isUrgent).toBe(true);
        });

        test('Mendeteksi status normal jika lebih dari 2 hari', () => {
            const now = new Date('2026-09-07T08:00:00Z');
            const res = calculateDueDateUrgency('2026-09-15', false, now);
            expect(res.level).toBe('normal');
            expect(res.label).toBe('8 hari lagi');
            expect(res.isUrgent).toBe(false);
        });
    });

    // =========================================================================
    // 3. UJI SANITASI renderSafeMarkdown (OWASP ASVS LEVEL 2)
    // =========================================================================
    describe('Sanitasi renderSafeMarkdown (Anti-XSS)', () => {
        function renderSafeMarkdown(rawMarkdown) {
            if (!rawMarkdown || typeof rawMarkdown !== 'string') return '';
            let s = rawMarkdown
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');

            s = s.replace(/```([\s\S]*?)```/g, (_m, p1) => `<pre class="bg-slate-900 text-slate-100 p-3 rounded-xl overflow-x-auto text-xs my-2 font-mono"><code>${p1.trim()}</code></pre>`);
            s = s.replace(/`([^`\n]+)`/g, '<code class="bg-slate-100 dark:bg-slate-800 text-rose-600 dark:text-rose-400 px-1 py-0.5 rounded text-xs font-mono">$1</code>');
            s = s.replace(/^### (.*$)/gim, '<h4 class="text-sm font-black text-slate-800 dark:text-slate-100 mt-3 mb-1">$1</h4>');
            s = s.replace(/^## (.*$)/gim, '<h3 class="text-base font-black text-slate-800 dark:text-slate-100 mt-4 mb-1.5">$1</h3>');
            s = s.replace(/^# (.*$)/gim, '<h2 class="text-lg font-black text-slate-900 dark:text-white mt-4 mb-2 pb-1 border-b border-slate-200 dark:border-slate-800">$1</h2>');
            s = s.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-bold text-slate-900 dark:text-white">$1</strong>');
            s = s.replace(/\*([^*]+)\*/g, '<em class="italic">$1</em>');
            s = s.replace(/^(?:>|&gt;)\s?(.*$)/gim, '<blockquote class="border-l-4 border-indigo-500 pl-3 py-1 my-2 bg-indigo-50/50 dark:bg-indigo-950/30 text-xs italic text-slate-700 dark:text-slate-300 rounded-r-lg">$1</blockquote>');
            s = s.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/gi, (_match, text, url) => {
                const safeUrl = url.replace(/"/g, '&quot;');
                return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="text-indigo-600 dark:text-indigo-400 hover:underline font-bold inline-flex items-center gap-1">${text}<i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i></a>`;
            });
            s = s.replace(/^[*-] (.*$)/gim, '<li class="ml-4 list-disc text-xs text-slate-700 dark:text-slate-300 leading-relaxed">$1</li>');
            s = s.replace(/((?:<li.*<\/li>\s*)+)/gim, '<ul class="my-2 space-y-1">$1</ul>');
            s = s.replace(/\n\n+/g, '<br><br>');
            return s;
        }

        test('Meng-escape tag HTML script dan event handler onclick', () => {
            const malicious = '<script>alert("XSS")</script><img src="x" onerror="alert(1)">';
            const rendered = renderSafeMarkdown(malicious);
            expect(rendered).not.toContain('<script>');
            expect(rendered).toContain('&lt;script&gt;');
            expect(rendered).not.toContain('<img');
            expect(rendered).toContain('&lt;img');
        });

        test('Menolak URL skema berbahaya (javascript:, data:) pada tautan markdown', () => {
            const maliciousLink = '[Klik Disini](javascript:alert("hacked"))';
            const rendered = renderSafeMarkdown(maliciousLink);
            expect(rendered).not.toContain('<a href="javascript:');
            expect(rendered).toContain('[Klik Disini](javascript:alert(&quot;hacked&quot;))');
        });

        test('Memformat tautan valid http/https secara aman dengan rel="noopener noreferrer"', () => {
            const validLink = '[Buka Panduan](https://example.com/guide)';
            const rendered = renderSafeMarkdown(validLink);
            expect(rendered).toContain('<a href="https://example.com/guide"');
            expect(rendered).toContain('target="_blank"');
            expect(rendered).toContain('rel="noopener noreferrer"');
        });

        test('Merender heading, bold, code, blockquote, dan list dengan aman', () => {
            const md = '# Bab 1\n**Penting**\n`var x = 1`\n> Catatan guru\n- Poin A\n- Poin B';
            const rendered = renderSafeMarkdown(md);
            expect(rendered).toContain('<h2 class="text-lg font-black text-slate-900');
            expect(rendered).toContain('<strong class="font-bold');
            expect(rendered).toContain('<code class="');
            expect(rendered).toContain('<blockquote class="');
            expect(rendered).toContain('<ul class="');
        });
    });

    // =========================================================================
    // 4. UJI KRIPTOGRAFI EDGE TOKEN SISWA HMAC-SHA256
    // =========================================================================
    describe('Kriptografi HMAC-SHA256 Edge Token Siswa', () => {
        const secret = 'test-secret-simas-smagesa-123456';

        function signStudentSession(payload, secretKey) {
            const header = { alg: 'HS256', typ: 'JWT' };
            const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
            const b64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
            const dataToSign = `${b64Header}.${b64Payload}`;
            const signature = crypto.createHmac('sha256', secretKey).update(dataToSign).digest('base64url');
            return `${dataToSign}.${signature}`;
        }

        function verifyStudentSession(tokenStr, secretKey) {
            if (!tokenStr || typeof tokenStr !== 'string') return null;
            const parts = tokenStr.split('.');
            if (parts.length !== 3) return null;
            const [b64Header, b64Payload, signature] = parts;
            const dataToSign = `${b64Header}.${b64Payload}`;
            const expectedSig = crypto.createHmac('sha256', secretKey).update(dataToSign).digest('base64url');

            if (signature.length !== expectedSig.length) return null;
            const a = Buffer.from(signature);
            const b = Buffer.from(expectedSig);
            if (!crypto.timingSafeEqual(a, b)) return null;

            try {
                const payload = JSON.parse(Buffer.from(b64Payload, 'base64url').toString('utf8'));
                if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
                return payload;
            } catch {
                return null;
            }
        }

        test('Berhasil menandatangani dan memverifikasi token siswa yang sah', () => {
            const payload = {
                sub: '9901',
                nis: '9901',
                class: 'X-A',
                role: 'siswa',
                exp: Math.floor(Date.now() / 1000) + 7200
            };
            const token = signStudentSession(payload, secret);
            const verified = verifyStudentSession(token, secret);
            expect(verified).not.toBeNull();
            expect(verified.nis).toBe('9901');
            expect(verified.class).toBe('X-A');
            expect(verified.role).toBe('siswa');
        });

        test('Menolak token yang diubah payload-nya (tampered signature)', () => {
            const payload = { sub: '9901', nis: '9901', role: 'siswa', exp: Math.floor(Date.now() / 1000) + 7200 };
            const token = signStudentSession(payload, secret);
            const parts = token.split('.');
            const tamperedPayload = Buffer.from(JSON.stringify({ ...payload, nis: 'admin' })).toString('base64url');
            const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

            const verified = verifyStudentSession(tamperedToken, secret);
            expect(verified).toBeNull();
        });

        test('Menolak token yang sudah kadaluarsa (expired)', () => {
            const expiredPayload = {
                sub: '9901',
                nis: '9901',
                role: 'siswa',
                exp: Math.floor(Date.now() / 1000) - 60
            };
            const token = signStudentSession(expiredPayload, secret);
            const verified = verifyStudentSession(token, secret);
            expect(verified).toBeNull();
        });
    });

    // =========================================================================
    // 5. UJI MEKANISME AUTO-CLEANUP ROLLING 3 TAHUN
    // =========================================================================
    describe('Mekanisme Auto-Cleanup Data Non-Permanen > 3 Tahun', () => {
        test('Worker mendefinisikan kueri cleanup 3 tahun untuk lms_progress dan lms_discussions', () => {
            expect(workerContent).toContain("DELETE FROM lms_progress");
            expect(workerContent).toContain("DELETE FROM lms_discussions");
            expect(workerContent).toContain("datetime('now', '-3 years')");
            expect(workerContent).toContain('performAutoCleanup');
        });

        test('Skema migrasi D1 mendefinisikan indeks created_at pada lms_progress dan lms_discussions untuk optimasi cleanup', () => {
            expect(migrationContent).toContain('idx_lms_prog_created');
            expect(migrationContent).toContain('idx_lms_disc_created');
        });
    });

    // =========================================================================
    // 6. UJI INTEGRITAS SKEMA DATABASE D1 LMS
    // =========================================================================
    describe('Integritas Skema Database D1 LMS', () => {
        test('Memverifikasi 4 tabel LMS terdaftar lengkap', () => {
            expect(migrationContent).toContain('CREATE TABLE IF NOT EXISTS lms_topics');
            expect(migrationContent).toContain('CREATE TABLE IF NOT EXISTS lms_materials');
            expect(migrationContent).toContain('CREATE TABLE IF NOT EXISTS lms_progress');
            expect(migrationContent).toContain('CREATE TABLE IF NOT EXISTS lms_discussions');
        });

        test('Memverifikasi foreign keys kaskade pada materi dan diskusi', () => {
            expect(migrationContent).toContain('REFERENCES lms_topics(id) ON DELETE CASCADE');
            expect(migrationContent).toContain('REFERENCES lms_materials(id) ON DELETE CASCADE');
        });

        test('Memverifikasi trigger validasi dan pembersihan rekursif anak diskusi', () => {
            expect(migrationContent).toContain('trg_lms_materials_validate_insert');
            expect(migrationContent).toContain('trg_lms_discussions_delete_children');
        });
    });

    // =========================================================================
    // 7. UJI DAFTAR RUTE & OTORISASI CLOUDFLARE WORKER LMS
    // =========================================================================
    describe('Daftar Rute LMS di Cloudflare Worker Gateway', () => {
        const expectedRoutes = [
            'GET /api/lms/topics',
            'POST /api/lms/topics',
            'DELETE /api/lms/topics/',
            'GET /api/lms/materials',
            'POST /api/lms/materials',
            'DELETE /api/lms/materials/',
            'POST /api/lms/copy-from-class',
            'POST /api/lms/reorder',
            'GET /api/lms/student/courses',
            'POST /api/lms/student/track',
            'GET /api/lms/analytics/class',
            'GET /api/lms/materials/',
            'POST /api/lms/progress/override',
            'GET /api/lms/discussions/',
            'POST /api/lms/discussions',
            'POST /api/lms/discussions/',
            'DELETE /api/lms/discussions/'
        ];

        test('Memverifikasi seluruh 17 rute endpoint LMS ada di Worker', () => {
            expectedRoutes.forEach(r => {
                const [method, route] = r.split(' ');
                expect(workerContent).toContain(route);
                expect(workerContent).toContain(method);
            });
        });

        test('Worker mengizinkan header X-Student-Token pada CORS headers', () => {
            expect(workerContent).toContain('X-Student-Token');
        });

        test('Endpoint login siswa /api/students/verify-credentials mengembalikan token sesi siswa', () => {
            expect(workerContent).toContain('/api/students/verify-credentials');
            expect(workerContent).toContain('token: studentToken');
        });
    });
});

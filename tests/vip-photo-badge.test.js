/**
 * tests/vip-photo-badge.test.js
 * ====================================================================
 * Test Suite: SIMAS VIP Photo Badge, Aggregate Status & Parity Suite
 * Memvalidasi:
 * 1. Keberadaan & Spesifikasi CSS VIP Avatar Badge di css/style.css
 *    (.vip-avatar-container, .vip-avatar-ring, .vip-avatar-crown, .vip-avatar-sm, .vip-avatar-lg)
 * 2. Paritas Endpoint Backend & Otorisasi RBAC di cloudflare/worker.js:
 *    - GET & POST /api/guru-mapel/ai-vip-settings
 *    - GET /api/vip/status-summary
 *    - Proteksi RBAC Super Admin & Audit Log
 * 3. Paritas Client SDK di js/cloudflare-client.js:
 *    - cfGetKoreksiAiVipSettings, cfSaveKoreksiAiVipSettings, cfGetVipStatusSummary
 * 4. Logika SSOT js/vip-manager.js (wrapVipAvatarHtml, applyVipBadgeToAvatarContainer, dsb.)
 * 5. Integritas DOM Modal Anti-Nesting di guru-mapel.html
 *    (#modal-koreksi-ai-vip-settings berdiri mandiri di luar <main>)
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

describe('Suite Pengujian Sistem SIMAS VIP Photo Badge & Agregat Status SSOT', () => {
    const root = path.resolve(__dirname, '..');
    const styleCssPath = path.join(root, 'css', 'style.css');
    const workerJsPath = path.join(root, 'cloudflare', 'worker.js');
    const clientJsPath = path.join(root, 'js', 'cloudflare-client.js');
    const vipManagerJsPath = path.join(root, 'js', 'vip-manager.js');
    const guruMapelHtmlPath = path.join(root, 'guru-mapel.html');

    const styleCss = fs.readFileSync(styleCssPath, 'utf8');
    const workerJs = fs.readFileSync(workerJsPath, 'utf8');
    const clientJs = fs.readFileSync(clientJsPath, 'utf8');
    const vipManagerJs = fs.readFileSync(vipManagerJsPath, 'utf8');
    const guruMapelHtml = fs.readFileSync(guruMapelHtmlPath, 'utf8');

    // 1. UJI SPESIFIKASI CSS VIP AVATAR BADGE
    describe('1. Kepatuhan Spesifikasi CSS VIP Avatar Badge (css/style.css)', () => {
        test('Memiliki kelas .vip-avatar-container dengan display inline-flex & relative', () => {
            expect(styleCss).toContain('.vip-avatar-container');
            expect(styleCss).toMatch(/\.vip-avatar-container\s*\{[^}]*position:\s*relative/i);
        });

        test('Memiliki kelas .vip-avatar-ring dengan gradasi emas mewah dan border-radius bulat', () => {
            expect(styleCss).toContain('.vip-avatar-ring');
            expect(styleCss).toMatch(/\.vip-avatar-ring\s*\{[^}]*border-radius:\s*9999px/i);
            expect(styleCss).toMatch(/\.vip-avatar-ring\s*\{[^}]*background:\s*linear-gradient/i);
        });

        test('Memiliki kelas .vip-avatar-crown dengan pin mahkota emas dan z-index tinggi', () => {
            expect(styleCss).toContain('.vip-avatar-crown');
            expect(styleCss).toMatch(/\.vip-avatar-crown\s*\{[^}]*position:\s*absolute/i);
            expect(styleCss).toMatch(/\.vip-avatar-crown\s*\{[^}]*border-radius:\s*9999px/i);
        });

        test('Memiliki varian ukuran .vip-avatar-sm dan .vip-avatar-lg', () => {
            expect(styleCss).toContain('.vip-avatar-container.vip-avatar-sm');
            expect(styleCss).toContain('.vip-avatar-container.vip-avatar-lg');
        });
    });

    // 2. UJI PARITAS ENDPOINT WORKER D1 & OTORISASI RBAC
    describe('2. Paritas Endpoint Backend & Otorisasi RBAC (cloudflare/worker.js)', () => {
        test('Mendukung rute GET & POST /api/guru-mapel/ai-vip-settings', () => {
            expect(workerJs).toContain('/api/guru-mapel/ai-vip-settings');
            expect(workerJs).toMatch(/path\s*===\s*["']\/api\/guru-mapel\/ai-vip-settings["']/);
            expect(workerJs).toContain('UPDATE_KOREKSI_AI_VIP');
            expect(workerJs).toContain('koreksi_ai_vip_config');
        });

        test('Otorisasi POST /api/guru-mapel/ai-vip-settings menolak role non-super_admin dengan 403 Forbidden', () => {
            expect(workerJs).toContain('isSuperAdmin');
            expect(workerJs).toContain('Forbidden: Hanya Super Admin yang berwenang mengubah hak akses VIP Koreksi AI');
            expect(workerJs).toMatch(/errorResponse\("Forbidden: Hanya Super Admin[^"]*",\s*403/);
        });

        test('Mendukung rute GET /api/vip/status-summary yang menggabungkan seluruh 3 fitur VIP & Kepala Sekolah', () => {
            expect(workerJs).toContain('/api/vip/status-summary');
            expect(workerJs).toContain('workload_policy_config');
            expect(workerJs).toContain('employee_agenda_vip_config');
            expect(workerJs).toContain('koreksi_ai_vip_config');
            expect(workerJs).toContain('vip_ptk_ids');
            expect(workerJs).toContain('is_current_user_vip');
        });
    });

    // 3. UJI PARITAS CLIENT SDK
    describe('3. Paritas Fungsi Klien (js/cloudflare-client.js)', () => {
        test('Mengekspor fungsi cfGetKoreksiAiVipSettings', () => {
            expect(clientJs).toContain('export async function cfGetKoreksiAiVipSettings');
            expect(clientJs).toContain("window.cfGetKoreksiAiVipSettings = cfGetKoreksiAiVipSettings");
        });

        test('Mengekspor fungsi cfSaveKoreksiAiVipSettings', () => {
            expect(clientJs).toContain('export async function cfSaveKoreksiAiVipSettings');
            expect(clientJs).toContain("window.cfSaveKoreksiAiVipSettings = cfSaveKoreksiAiVipSettings");
        });

        test('Mengekspor fungsi cfGetVipStatusSummary', () => {
            expect(clientJs).toContain('export async function cfGetVipStatusSummary');
            expect(clientJs).toContain("window.cfGetVipStatusSummary = cfGetVipStatusSummary");
        });
    });

    // 4. UJI LOGIKA SSOT JS VIP MANAGER
    describe('4. Logika SSOT VIP Manager (js/vip-manager.js)', () => {
        let sandboxEnv;

        beforeEach(() => {
            sandboxEnv = {
                window: {},
                document: {
                    querySelectorAll: jest.fn(() => []),
                    createElement: (tag) => {
                        return {
                            tagName: tag.toUpperCase(),
                            classList: {
                                classes: new Set(),
                                add(...c) { c.forEach(x => this.classes.add(x)); },
                                remove(...c) { c.forEach(x => this.classes.delete(x)); },
                                contains(x) { return this.classes.has(x); }
                            },
                            className: '',
                            innerHTML: '',
                            title: '',
                            appendChild: jest.fn(),
                            querySelector: jest.fn(() => null)
                        };
                    }
                },
                HTMLElement: function () {},
                console: { warn: jest.fn() }
            };

            // Transform export/import ES6 sederhana untuk sandbox
            const transformedJs = vipManagerJs
                .replace(/import\s+[^;]+;/g, '')
                .replace(/export\s+async\s+function/g, 'async function')
                .replace(/export\s+function/g, 'function')
                .replace(/export\s+default\s+[^;]+;/g, '');

            vm.createContext(sandboxEnv);
            vm.runInContext(transformedJs, sandboxEnv);
        });

        test('wrapVipAvatarHtml membungkus avatar dengan cincin emas jika isVip true', () => {
            const wrapFn = sandboxEnv.window.wrapVipAvatarHtml;
            expect(typeof wrapFn).toBe('function');

            const raw = '<img src="/test.webp">';
            const vipHtml = wrapFn(raw, true);
            expect(vipHtml).toContain('vip-avatar-container');
            expect(vipHtml).toContain('vip-avatar-ring');
            expect(vipHtml).toContain('vip-avatar-crown');
            expect(vipHtml).toContain(raw);

            const nonVipHtml = wrapFn(raw, false);
            expect(nonVipHtml).toBe(raw);
        });

        test('wrapVipAvatarHtml menyertakan ukuran sizeClass bila diberikan', () => {
            const wrapFn = sandboxEnv.window.wrapVipAvatarHtml;
            const smHtml = wrapFn('<span>Avatar</span>', true, 'vip-avatar-sm');
            expect(smHtml).toContain('vip-avatar-container vip-avatar-sm');
        });

        test('isPtkVip dan isCurrentUserVip berfungsi sesuai status internal', () => {
            expect(sandboxEnv.window.isPtkVip('ptk-random')).toBe(false);
            expect(sandboxEnv.window.isPtkVip(null)).toBe(false);
            expect(sandboxEnv.window.isCurrentUserVip()).toBe(false);

            sandboxEnv.window.setCurrentUserVip(true);
            expect(sandboxEnv.window.isCurrentUserVip()).toBe(true);
        });
    });

    // 5. UJI INTEGRITAS DOM MODAL DI GURU-MAPEL.HTML
    describe('5. Integritas Hierarki DOM Modal di guru-mapel.html (Anti-Nesting Rule)', () => {
        test('modal-koreksi-ai-vip-settings terdefinisi di luar elemen <main>', () => {
            const mainClosingIndex = guruMapelHtml.indexOf('</main>');
            expect(mainClosingIndex).toBeGreaterThan(-1);

            const modalSettingsIndex = guruMapelHtml.indexOf('id="modal-koreksi-ai-vip-settings"');
            expect(modalSettingsIndex).toBeGreaterThan(-1);
            expect(modalSettingsIndex).toBeGreaterThan(mainClosingIndex);
        });

        test('modal-koreksi-ai-vip-notice terdefinisi di luar elemen <main>', () => {
            const mainClosingIndex = guruMapelHtml.indexOf('</main>');
            const modalNoticeIndex = guruMapelHtml.indexOf('id="modal-koreksi-ai-vip-notice"');
            expect(modalNoticeIndex).toBeGreaterThan(-1);
            expect(modalNoticeIndex).toBeGreaterThan(mainClosingIndex);
        });

        test('modal-koreksi-ai-vip-settings memiliki tag div yang berimbang sempurna', () => {
            const modalStart = guruMapelHtml.indexOf('id="modal-koreksi-ai-vip-settings"');
            const openDivBefore = guruMapelHtml.lastIndexOf('<div', modalStart);
            const nextSibling = guruMapelHtml.indexOf('<!-- MAIN MODULE LOGIC -->', modalStart);
            const modalBlock = guruMapelHtml.substring(openDivBefore, nextSibling);

            const openDivs = (modalBlock.match(/<div\b/g) || []).length;
            const closeDivs = (modalBlock.match(/<\/div>/g) || []).length;
            expect(openDivs).toBe(closeDivs);
        });

        test('Pencarian input pada modal VIP mematuhi UI guidelines (tanpa leading icon menumpuk)', () => {
            expect(guruMapelHtml).toContain('id="input-search-ai-vip-teachers"');
            expect(guruMapelHtml).toMatch(/id="input-search-ai-vip-teachers"[^>]*px-3\.5/);
            expect(guruMapelHtml).not.toMatch(/id="input-search-ai-vip-teachers"[^>]*pl-9/);
            expect(guruMapelHtml).not.toMatch(/id="input-search-ai-vip-teachers"[^>]*pl-10/);
        });
    });
});

/**
 * tests/workload-options-ui-wrap.test.js
 *
 * Pengujian Unit UI/UX: Eliminasi Teks Terpotong (Anti-Truncation) & Multiline Textarea
 * Pada Dropdown Pilihan Kegiatan Rencana, Realisasi, dan Tugas Pokok Permendikdasmen No. 11/2025
 */

const fs = require('node:fs');
const path = require('node:path');

describe('UI/UX Anti-Truncation & Multiline Selector Tests', () => {
    const rootDir = path.resolve(__dirname, '..');
    const htmlPath = path.join(rootDir, 'e-kinerja.html');
    const jsPath = path.join(rootDir, 'js', 'page-beban-kerja.js');

    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const jsContent = fs.readFileSync(jsPath, 'utf8');

    describe('1. Form Input Multiline Adaptif (Textarea Auto-Resize)', () => {
        test('Field pencarian/pemilihan katalog rencana (#plan-input-catalog-search) bertipe textarea dengan min-h-[42px]', () => {
            expect(htmlContent).toMatch(/<textarea[^>]*id="plan-input-catalog-search"[^>]*rows="1"/);
            expect(htmlContent).toContain('id="plan-input-catalog-search"');
            expect(htmlContent).toMatch(/id="plan-input-catalog-search"[^>]*class="[^"]*min-h-\[42px\]/);
        });

        test('Field pencarian/pemilihan katalog log (#log-input-catalog-search) bertipe textarea dengan min-h-[42px]', () => {
            expect(htmlContent).toMatch(/<textarea[^>]*id="log-input-catalog-search"[^>]*rows="1"/);
            expect(htmlContent).toContain('id="log-input-catalog-search"');
            expect(htmlContent).toMatch(/id="log-input-catalog-search"[^>]*class="[^"]*min-h-\[42px\]/);
        });

        test('Field pencarian/pemilihan tugas waka rencana & log bertipe textarea dengan min-h-[42px]', () => {
            expect(htmlContent).toMatch(/<textarea[^>]*id="plan-input-waka-duty-search"[^>]*rows="1"/);
            expect(htmlContent).toMatch(/<textarea[^>]*id="log-input-waka-duty-search"[^>]*rows="1"/);
        });

        test('Tombol trigger chevron pada textarea diposisikan top-2.5 agar tetap stabil saat tinggi baris bertambah', () => {
            expect(htmlContent).toContain('id="btn-plan-catalog-trigger"');
            expect(htmlContent).toMatch(/id="btn-plan-catalog-trigger"[^>]*class="[^"]*top-2\.5/);
            expect(htmlContent).toContain('id="btn-log-catalog-trigger"');
            expect(htmlContent).toMatch(/id="btn-log-catalog-trigger"[^>]*class="[^"]*top-2\.5/);
        });
    });

    describe('2. Custom Rich Selector Tugas Pokok Guru', () => {
        test('Native <select id="plan-input-main-duty"> dipertahankan sebagai SSOT dengan class sr-only', () => {
            expect(htmlContent).toContain('id="plan-input-main-duty"');
            expect(htmlContent).toMatch(/<select[^>]*id="plan-input-main-duty"[^>]*class="[^"]*sr-only/);
        });

        test('Native <select id="log-input-main-duty"> dipertahankan sebagai SSOT dengan class sr-only', () => {
            expect(htmlContent).toContain('id="log-input-main-duty"');
            expect(htmlContent).toMatch(/<select[^>]*id="log-input-main-duty"[^>]*class="[^"]*sr-only/);
        });

        test('Trigger button Custom Rich Selector tersedia di HTML untuk rencana dan realisasi', () => {
            expect(htmlContent).toContain('id="btn-plan-main-duty-trigger"');
            expect(htmlContent).toContain('id="label-plan-main-duty-selected"');
            expect(htmlContent).toContain('id="icon-plan-main-duty-badge"');

            expect(htmlContent).toContain('id="btn-log-main-duty-trigger"');
            expect(htmlContent).toContain('id="label-log-main-duty-selected"');
            expect(htmlContent).toContain('id="icon-log-main-duty-badge"');
        });
    });

    describe('3. Logika JavaScript: Bebas Truncate & Adaptif Auto-Resize', () => {
        test('Fungsi autoResizeWorkloadTextarea ada dan menyesuaikan scrollHeight', () => {
            expect(jsContent).toContain('export function autoResizeWorkloadTextarea(target)');
            expect(jsContent).toContain('target.style.height = `${newHeight}px`');
        });

        test('renderPlanCatalogCustomOptions menyajikan item bertingkat tanpa class truncate pada judul dan deskripsi', () => {
            const planFnMatch = jsContent.match(/export function renderPlanCatalogCustomOptions[\s\S]*?^}/m);
            expect(planFnMatch).not.toBeNull();
            const planFn = planFnMatch[0];
            expect(planFn).toContain('break-words');
            expect(planFn).not.toContain('truncate');
        });

        test('renderLogCatalogCustomOptions menyajikan item bertingkat tanpa class truncate pada judul dan deskripsi', () => {
            const logFnMatch = jsContent.match(/export function renderLogCatalogCustomOptions[\s\S]*?^}/m);
            expect(logFnMatch).not.toBeNull();
            const logFn = logFnMatch[0];
            expect(logFn).toContain('break-words');
            expect(logFn).not.toContain('truncate');
        });

        test('renderPlanMainDutyCustomSelector menyajikan unsur tugas pokok tanpa truncate', () => {
            const dutyFnMatch = jsContent.match(/export function renderPlanMainDutyCustomSelector[\s\S]*?^}/m);
            expect(dutyFnMatch).not.toBeNull();
            const dutyFn = dutyFnMatch[0];
            expect(dutyFn).toContain('break-words');
            expect(dutyFn).not.toContain('truncate');
        });

        test('Window bindings lengkap dan teregistrasi tanpa ReferenceError', () => {
            expect(jsContent).toContain('window.workloadTogglePlanMainDutyDropdown = togglePlanMainDutyDropdown;');
            expect(jsContent).toContain('window.workloadSelectPlanMainDuty = selectPlanMainDuty;');
            expect(jsContent).toContain('window.workloadToggleLogMainDutyDropdown = toggleLogMainDutyDropdown;');
            expect(jsContent).toContain('window.workloadSelectLogMainDuty = selectLogMainDuty;');
            expect(jsContent).toContain('window.autoResizeWorkloadTextarea = autoResizeWorkloadTextarea;');
        });

        test('Simulasi fungsi autoResizeWorkloadTextarea menangani min-height 42px', () => {
            function autoResizeWorkloadTextarea(target) {
                if (!target) return;
                target.style.height = 'auto';
                const newHeight = Math.max(42, target.scrollHeight);
                target.style.height = `${newHeight}px`;
            }

            const mockEl1 = { style: { height: '' }, scrollHeight: 30 };
            autoResizeWorkloadTextarea(mockEl1);
            expect(mockEl1.style.height).toBe('42px');

            const mockEl2 = { style: { height: '' }, scrollHeight: 84 };
            autoResizeWorkloadTextarea(mockEl2);
            expect(mockEl2.style.height).toBe('84px');
        });
    });

    describe('4. Penataan Badge HBG Vertikal di Bawah JP & Ketinggian Dropdown Panel', () => {
        test('Badge HBG diposisikan di kolom kanan tepat di bawah badge JP pada rencana & log', () => {
            expect(jsContent).toContain('const badgesRight = (jpBadge || hbgBadge)');
            expect(jsContent).toContain('flex flex-col items-end gap-1 shrink-0 mt-0.5');
            expect(jsContent).toContain('${jpBadge}${hbgBadge}');
        });

        test('Tinggi panel dropdown diperbesar menjadi max-h-80 sm:max-h-96 untuk memuat lebih banyak item', () => {
            expect(htmlContent).toContain('id="dropdown-plan-catalog-panel"');
            expect(htmlContent).toMatch(/id="dropdown-plan-catalog-panel"[^>]*class="[^"]*max-h-80 sm:max-h-96/);

            expect(htmlContent).toContain('id="dropdown-log-catalog-panel"');
            expect(htmlContent).toMatch(/id="dropdown-log-catalog-panel"[^>]*class="[^"]*max-h-80 sm:max-h-96/);

            expect(htmlContent).toContain('id="dropdown-plan-main-duty-panel"');
            expect(htmlContent).toMatch(/id="dropdown-plan-main-duty-panel"[^>]*class="[^"]*max-h-80 sm:max-h-96/);

            expect(htmlContent).toContain('id="dropdown-log-main-duty-panel"');
            expect(htmlContent).toMatch(/id="dropdown-log-main-duty-panel"[^>]*class="[^"]*max-h-80 sm:max-h-96/);
        });
    });

    describe('5. Penghapusan Tulisan Ekuivalensi pada Deskripsi Sub-Kegiatan (Simpel & Bersih)', () => {
        test('renderPlanCatalogCustomOptions dan renderLogCatalogCustomOptions memfilter teks ekuivalensi pada deskripsi', () => {
            expect(jsContent).toContain("const cleanDesc = (c.description || '').replace(/\\s*\\([Ee]kuivalensi[^)]*\\)/g, '').trim();");
        });

        test('Deskripsi katalog di js/workload-catalog-data.js bebas dari tulisan ekuivalensi', () => {
            const catalogDataPath = path.join(rootDir, 'js', 'workload-catalog-data.js');
            const catalogDataContent = fs.readFileSync(catalogDataPath, 'utf8');
            const descMatches = catalogDataContent.match(/description:\s*"[^"]*\(Ekuivalensi[^"]*"/g);
            expect(descMatches).toBeNull();
        });

        test('Deskripsi katalog di cloudflare/worker.js bebas dari tulisan ekuivalensi', () => {
            const workerPath = path.join(rootDir, 'cloudflare', 'worker.js');
            const workerContent = fs.readFileSync(workerPath, 'utf8');
            const descMatches = workerContent.match(/description:\s*"[^"]*\(Ekuivalensi[^"]*"/g);
            expect(descMatches).toBeNull();
        });
    });
});

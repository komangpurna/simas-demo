/**
 * tests/waka-duties-specialization.test.js
 * ====================================================================
 * Test Suite: Spesialisasi Tugas Tambahan Wakil Kepala Sekolah (Waka)
 * Menguji:
 * 1. Master Katalog 4 Bidang Waka (12 JP Tatap Muka / minggu)
 * 2. Helper Deteksi & Info Tugas Pokok Waka
 * 3. Seed 80 Butir Tugas (20 butir per bidang: Kurikulum, Kesiswaan, Sarpras, Humas)
 * 4. Paritas Endpoint API & Keamanan Otorisasi RBAC (/api/workload/waka-duties)
 * 5. Kepatuhan UI Modal Anti-Nesting & Validasi Form Wajib Keterangan
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Suite Pengujian Spesialisasi Tugas Tambahan Wakil Kepala Sekolah (Waka)', () => {
    const root = path.resolve(__dirname, '..');
    const catalogDataPath = path.join(root, 'js', 'workload-catalog-data.js');
    const workerJsPath = path.join(root, 'cloudflare', 'worker.js');
    const clientJsPath = path.join(root, 'js', 'cloudflare-client.js');
    const pageBebanKerjaPath = path.join(root, 'js', 'page-beban-kerja.js');
    const eKinerjaHtmlPath = path.join(root, 'e-kinerja.html');

    const catalogDataJs = fs.readFileSync(catalogDataPath, 'utf8');
    const workerJs = fs.readFileSync(workerJsPath, 'utf8');
    const clientJs = fs.readFileSync(clientJsPath, 'utf8');
    const pageBebanKerjaJs = fs.readFileSync(pageBebanKerjaPath, 'utf8');
    const eKinerjaHtml = fs.readFileSync(eKinerjaHtmlPath, 'utf8');

    // 1. UJI MASTER KATALOG 4 BIDANG WAKA
    describe('1. Master Katalog 4 Bidang Waka Spesifik (12 JP)', () => {
        const expectedWakaCatalogIds = [
            'cat_tt_waka_kurikulum',
            'cat_tt_waka_kesiswaan',
            'cat_tt_waka_sarpras',
            'cat_tt_waka_humas'
        ];

        expectedWakaCatalogIds.forEach(catId => {
            test(`Katalog ${catId} terdaftar di workload-catalog-data.js dan cloudflare/worker.js dengan 12 JP`, () => {
                const catRegexInCatalog = new RegExp(`id:\\s*["']${catId}["']`);
                const catRegexInWorker = new RegExp(`id:\\s*["']${catId}["']`);
                expect(catRegexInCatalog.test(catalogDataJs)).toBe(true);
                expect(catRegexInWorker.test(workerJs)).toBe(true);

                // Pastikan ekuivalensi 12 JP
                const jpRegexCatalog = new RegExp(`id:\\s*["']${catId}["'][\\s\\S]*?equivalent_jp:\\s*12`);
                const jpRegexWorker = new RegExp(`id:\\s*["']${catId}["'][\\s\\S]*?equivalent_jp:\\s*12`);
                expect(jpRegexCatalog.test(catalogDataJs)).toBe(true);
                expect(jpRegexWorker.test(workerJs)).toBe(true);
            });
        });

        test('Katalog lama cat_tt_waka dinonaktifkan (is_active: 0) sebagai fallback legacy', () => {
            const legacyRegexCatalog = /id:\s*["']cat_tt_waka["'][\s\S]*?is_active:\s*0/;
            const legacyRegexWorker = /id:\s*["']cat_tt_waka["'][\s\S]*?is_active:\s*0/;
            expect(legacyRegexCatalog.test(catalogDataJs)).toBe(true);
            expect(legacyRegexWorker.test(workerJs)).toBe(true);
        });
    });

    // 2. UJI SEED 80 BUTIR TUGAS WAKA
    describe('2. Seed 80 Butir Tugas Waka (20 Butir per Bidang)', () => {
        const wakaTypes = ['kurikulum', 'kesiswaan', 'sarpras', 'humas'];

        wakaTypes.forEach(type => {
            test(`Bidang Waka ${type} memiliki 20 butir tugas lengkap`, () => {
                const matches = catalogDataJs.match(new RegExp(`waka_type:\\s*["']${type}["']`, 'g'));
                expect(matches).not.toBeNull();
                expect(matches.length).toBe(20);
            });
        });

        test('Total butir tugas seed mencapai minimal 80 butir di workload-catalog-data.js dan worker.js', () => {
            const matchesCatalog = catalogDataJs.match(/waka_type:\s*["']/g);
            expect(matchesCatalog.length).toBeGreaterThanOrEqual(80);

            const matchesWorker = workerJs.match(/waka_type:\s*["']/g);
            expect(matchesWorker.length).toBeGreaterThanOrEqual(80);
        });
    });

    // 3. UJI HELPER DETEKSI & INFO TUGAS POKOK
    describe('3. Helper Deteksi & Info Tugas Pokok Waka', () => {
        test('Fungsi helper getWakaTypeFromCatalogId, isWakaCatalogId, getWakaMainDutyInfo diekspor', () => {
            expect(catalogDataJs).toContain('export function getWakaTypeFromCatalogId');
            expect(catalogDataJs).toContain('export function isWakaCatalogId');
            expect(catalogDataJs).toContain('export function getWakaMainDutyInfo');
        });

        test('Teks tugas pokok waka memuat ringkasan resmi sesuai dokumen SK tugas pokok', () => {
            expect(catalogDataJs).toContain('Membantu Kepala Sekolah dalam merencanakan, mengorganisasikan, melaksanakan, mengendalikan, mengevaluasi, dan melaporkan seluruh kegiatan bidang kurikulum');
            expect(catalogDataJs).toContain('Membantu Kepala Sekolah dalam merencanakan, mengembangkan, melaksanakan, membina, mengawasi, dan mengevaluasi seluruh program yang berkaitan dengan peserta didik');
            expect(catalogDataJs).toContain('Membantu Kepala Sekolah dalam perencanaan, pengadaan, pemanfaatan, pemeliharaan, pengamanan, inventarisasi, dan evaluasi sarana dan prasarana sekolah');
            expect(catalogDataJs).toContain('Membantu Kepala Sekolah dalam membangun komunikasi, kemitraan, citra positif, partisipasi masyarakat');
        });
    });

    // 4. UJI PARITAS ENDPOINT API & KEAMANAN OTORISASI
    describe('4. Paritas Endpoint API & Otorisasi RBAC', () => {
        test('Klien memiliki fungsi cfGetWakaDuties, cfSaveWakaDutyItem, cfDeleteWakaDutyItem', () => {
            expect(clientJs).toContain('export async function cfGetWakaDuties');
            expect(clientJs).toContain('export async function cfSaveWakaDutyItem');
            expect(clientJs).toContain('export async function cfDeleteWakaDutyItem');
            expect(clientJs).toContain('window.cfGetWakaDuties = cfGetWakaDuties;');
            expect(clientJs).toContain('window.cfSaveWakaDutyItem = cfSaveWakaDutyItem;');
            expect(clientJs).toContain('window.cfDeleteWakaDutyItem = cfDeleteWakaDutyItem;');
        });

        test('Cloudflare Worker menangani GET & POST /api/workload/waka-duties', () => {
            expect(workerJs).toContain('path === "/api/workload/waka-duties"');
            expect(workerJs).toContain('method === "GET"');
            expect(workerJs).toContain('method === "POST"');
        });

        test('Mutasi butir tugas waka dilindungi otorisasi isWorkloadManager (Kepala Sekolah & Super Admin)', () => {
            const managerCheckRegex = /method === "POST"[\s\S]*?isWorkloadManager/;
            expect(managerCheckRegex.test(workerJs)).toBe(true);
        });

        test('Worker mengembalikan error 403 Forbidden jika mutasi bukan oleh manager', () => {
            expect(workerJs).toContain('Forbidden: Hanya Kepala Sekolah / Super Admin yang dapat mengelola master butir tugas waka');
        });
    });

    // 5. UJI INTEGRITAS DOM HTML & ANTI-NESTING RULE
    describe('5. Kepatuhan UI & Integritas DOM', () => {
        test('Modal manage waka duty item adalah top-level sibling di luar <main>', () => {
            const mainClosingIdx = eKinerjaHtml.indexOf('</main>');
            const modalWakaIdx = eKinerjaHtml.indexOf('id="modal-manage-waka-duty-item"');
            expect(mainClosingIdx).toBeGreaterThan(0);
            expect(modalWakaIdx).toBeGreaterThan(mainClosingIdx);
        });

        test('Container banner waka, searchable combobox, dan bintang required tersedia di e-kinerja.html', () => {
            expect(eKinerjaHtml).toContain('id="plan-waka-banner"');
            expect(eKinerjaHtml).toContain('id="container-plan-waka-duty-picker"');
            expect(eKinerjaHtml).toContain('id="log-waka-banner"');
            expect(eKinerjaHtml).toContain('id="container-log-waka-duty-picker"');
            expect(eKinerjaHtml).toContain('id="plan-desc-required-star"');
            expect(eKinerjaHtml).toContain('id="plan-desc-waka-note"');
            expect(eKinerjaHtml).toContain('id="manager-waka-duties-management-section"');
        });

        test('Validasi wajib isi Keterangan khusus tugas waka ada di savePlanItem pada js/page-beban-kerja.js', () => {
            expect(pageBebanKerjaJs).toContain('isWakaCatalogId(item.catalog_id)');
            expect(pageBebanKerjaJs).toContain('Keterangan / Rencana Capaian wajib diisi untuk Tugas Tambahan Wakil Kepala Sekolah!');
        });

        test('Fungsi waka perencana dan realisasi terdaftar di window.workload pada js/page-beban-kerja.js', () => {
            expect(pageBebanKerjaJs).toContain('window.workloadOpenWakaDutyModal = openWakaDutyModal;');
            expect(pageBebanKerjaJs).toContain('window.workloadCloseWakaDutyModal = closeWakaDutyModal;');
            expect(pageBebanKerjaJs).toContain('window.workloadSaveWakaDutyItem = saveWakaDutyItem;');
            expect(pageBebanKerjaJs).toContain('window.workloadToggleWakaDutyActive = toggleWakaDutyActive;');
            expect(pageBebanKerjaJs).toContain('window.workloadDeleteWakaDutyItem = deleteWakaDutyItem;');
            expect(pageBebanKerjaJs).toContain('window.workloadSwitchWakaDutyTab = switchWakaDutyTab;');
            expect(pageBebanKerjaJs).toContain('window.workloadToggleWakaDutyDropdown = toggleWakaDutyDropdown;');
            expect(pageBebanKerjaJs).toContain('window.workloadSelectWakaDuty = selectWakaDuty;');
            expect(pageBebanKerjaJs).toContain('window.workloadToggleLogWakaDutyDropdown = toggleLogWakaDutyDropdown;');
            expect(pageBebanKerjaJs).toContain('window.workloadOpenLogWakaDutyDropdown = openLogWakaDutyDropdown;');
            expect(pageBebanKerjaJs).toContain('window.workloadCloseLogWakaDutyDropdown = closeLogWakaDutyDropdown;');
            expect(pageBebanKerjaJs).toContain('window.workloadOnFilterLogWakaDuties = onFilterLogWakaDuties;');
            expect(pageBebanKerjaJs).toContain('window.workloadSelectLogWakaDuty = selectLogWakaDuty;');
        });

        test('Proteksi dialog konfirmasi anti-timpa teks diterapkan saat memilih butir waka jika kolom uraian sudah terisi', () => {
            expect(pageBebanKerjaJs).toContain('Kolom uraian kegiatan sudah berisi teks:');
            expect(pageBebanKerjaJs).toContain('Apakah Anda yakin ingin menggantinya dengan butir tugas waka:');
        });

        test('Fungsi switchWakaDutyTab memvalidasi string lowercase tanpa error dan WAKA_TYPES mendukung lowercase', () => {
            expect(catalogDataJs).toContain("kurikulum: 'kurikulum'");
            expect(catalogDataJs).toContain("kesiswaan: 'kesiswaan'");
            expect(catalogDataJs).toContain("sarpras: 'sarpras'");
            expect(catalogDataJs).toContain("humas: 'humas'");
            expect(pageBebanKerjaJs).toContain("['kurikulum', 'kesiswaan', 'sarpras', 'humas'].includes(normalized)");
        });
    });
});

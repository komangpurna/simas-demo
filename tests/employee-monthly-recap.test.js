/** @jest-environment jsdom */
const fs = require('node:fs');
const path = require('node:path');

describe('Rekapitulasi Realisasi Kinerja Tendik (VIP) - Employee Monthly Recap', () => {
    const htmlPath = path.resolve('e-kinerja-tendik.html');
    const jsPath = path.resolve('js/page-e-kinerja-tendik.js');
    const clientPath = path.resolve('js/cloudflare-client.js');
    const workerPath = path.resolve('cloudflare/worker.js');

    test('e-kinerja-tendik.html memuat tombol VIP Rekap Realisasi di header (khusus desktop: hidden md:flex)', () => {
        const html = fs.readFileSync(htmlPath, 'utf8');
        expect(html).toContain('id="btn-employee-monthly-recap-toggle"');
        expect(html).toContain('class="hidden md:flex');
        expect(html).toContain('onclick="window.openEmployeeMonthlyRecapModal()"');
        expect(html).toContain('Rekap Realisasi');
        expect(html).toContain('VIP');
    });

    test('e-kinerja-tendik.html memuat modal Rekap Realisasi Bulanan sebagai top-level sibling di luar main', () => {
        const html = fs.readFileSync(htmlPath, 'utf8');
        expect(html).toContain('id="modal-employee-monthly-recap"');
        expect(html).toContain('id="modal-employee-monthly-recap-content"');
        expect(html).toContain('id="btn-monthly-recap-prev"');
        expect(html).toContain('id="select-monthly-recap-month"');
        expect(html).toContain('id="select-monthly-recap-year"');
        expect(html).toContain('id="btn-monthly-recap-next"');
        expect(html).toContain('id="monthly-recap-segmented-bar"');
        expect(html).toContain('id="monthly-recap-category-legends"');
        expect(html).toContain('id="monthly-recap-items-container"');
        expect(html).not.toContain('id="btn-monthly-recap-export-pdf"');

        // Pastikan modal berada setelah penutup </main>
        const mainCloseIdx = html.indexOf('</main>');
        const modalIdx = html.indexOf('id="modal-employee-monthly-recap"');
        expect(modalIdx).toBeGreaterThan(mainCloseIdx);
    });

    test('e-kinerja-tendik.html memuat modal notice eksklusif SIMAS VIP untuk pegawai non-supervisor', () => {
        const html = fs.readFileSync(htmlPath, 'utf8');
        expect(html).toContain('id="modal-employee-rekap-vip-notice"');
        expect(html).toContain('onclick="window.closeEmployeeRekapVipNoticeModal()"');
        expect(html).toContain('SIMAS VIP');

        // Pastikan modal notice juga berada di luar </main>
        const mainCloseIdx = html.indexOf('</main>');
        const vipModalIdx = html.indexOf('id="modal-employee-rekap-vip-notice"');
        expect(vipModalIdx).toBeGreaterThan(mainCloseIdx);
    });

    test('js/page-e-kinerja-tendik.js mendeklarasikan seluruh fungsi modal rekap bulanan dan notice VIP di window', () => {
        const js = fs.readFileSync(jsPath, 'utf8');
        expect(js).toContain('window.openEmployeeMonthlyRecapModal =');
        expect(js).toContain('window.closeEmployeeMonthlyRecapModal =');
        expect(js).toContain('window.openEmployeeRekapVipNoticeModal =');
        expect(js).toContain('window.closeEmployeeRekapVipNoticeModal =');
        expect(js).toContain('window.navigateMonthlyRecapMonth =');
        expect(js).toContain('window.onMonthlyRecapMonthChange =');
        expect(js).toContain('window.setMonthlyRecapCurrentMonth =');
        expect(js).toContain('window.loadEmployeeMonthlyRecapData =');
        expect(js).toContain('window.toggleMonthlyRecapGroup =');
        expect(js).toContain('window.toggleMonthlyRecapItemDetails =');
        expect(js).toContain('window.openEmployeeButirPrint =');
    });

    test('js/cloudflare-client.js menyediakan method getEmployeeMonthlyRecap', () => {
        const client = fs.readFileSync(clientPath, 'utf8');
        expect(client).toContain('getEmployeeMonthlyRecap(');
        expect(client).toContain('/api/employee-agenda/monthly-recap');
        expect(client).toContain('export async function cfGetEmployeeMonthlyRecap');
    });

    test('cloudflare/worker.js memuat endpoint GET /api/employee-agenda/monthly-recap dengan otorisasi pengawas dan isolasi mode personal', () => {
        const worker = fs.readFileSync(workerPath, 'utf8');
        expect(worker).toContain('path === "/api/employee-agenda/monthly-recap" && method === "GET"');
        expect(worker).toContain('isEmployeeAgendaManager(authResult.user)');
        expect(worker).toContain('groups_distribution');
        expect(worker).toContain('task_items_recap');
        expect(worker).toContain('const isPersonalMode = (qMode === "personal" || url.searchParams.get("self") === "true" || !targetGtkId || !isManager);');
    });

    test('js/page-e-kinerja-tendik.js mengisolasi parameter query ke akun pribadi saat Kepala Sekolah berada di Agenda Saya', () => {
        const js = fs.readFileSync(jsPath, 'utf8');
        expect(js).toContain('const isPersonalMode = !isSupervisor || !isMonitoringMode;');
        expect(js).toContain("queryParams.mode = 'personal';");
        expect(js).toContain("queryParams.self = 'true';");
        expect(js).toContain('queryParams.user_uid = currentUserUid;');
    });

    test('Cetak tendik berupa infografis per butir tugas memakai template bersama guru', () => {
        const js = fs.readFileSync(jsPath, 'utf8');
        const html = fs.readFileSync(htmlPath, 'utf8');
        expect(js).toContain("from './rekap-infographic.js';");
        expect(js).toContain('export function buildEmployeeButirInfographicHtml(data, itemId, options = {})');
        expect(js).toContain('return buildRekapInfographicHtml({');
        expect(js).toContain('parseEvidencePhotos(act.bukti_url)');
        // Batas: maks. 6 kegiatan, maks. 2 foto (cloud + lokal) per kegiatan
        expect(js).toContain('export const EMP_REPORT_MAX_ACTIVITIES = 6;');
        expect(js).toContain('const EMP_REPORT_MAX_PHOTOS = MAX_EMPLOYEE_PHOTOS;');
        // Tombol cetak per butir & modal cetak top-level di luar <main>
        expect(js).toContain("onclick=\"window.openEmployeeButirPrint('${escapeHTML(it.item_id)}')\"");
        expect(html).toContain('id="modal-employee-butir-print"');
        expect(html).toContain('id="emp-print-preview-frame"');
        expect(html).toContain('id="emp-print-period-chips"');
        expect(html).toContain('id="emp-print-signature-canvas"');
        expect(html.indexOf('id="modal-employee-butir-print"')).toBeGreaterThan(html.indexOf('</main>'));
        // Builder lama yang memanggil variabel tak terdefinisi sudah dihapus
        expect(js).not.toContain('photoSectionHtml');
        expect(js).not.toContain('buildEmployeeMonthlyRecapPrintHtml');
    });

    test('cloudflare/worker.js menyertakan bukti_url pada log aktivitas rekap bulanan untuk dokumentasi foto PDF', () => {
        const worker = fs.readFileSync(workerPath, 'utf8');
        expect(worker).toContain('bukti_url: act.bukti_url || "",');
    });

    test('js/cloudflare-client.js mendukung parameter mode, self, user_uid, dan employee_name pada getEmployeeMonthlyRecap', () => {
        const client = fs.readFileSync(clientPath, 'utf8');
        expect(client).toContain("if (filters.mode) params.append('mode', filters.mode);");
        expect(client).toContain("if (filters.self) params.append('self', filters.self);");
        expect(client).toContain("if (filters.user_uid) params.append('user_uid', filters.user_uid);");
    });

    test('cloudflare/worker.js menyaring rekapitulasi realisasi bulanan tendik sesuai kelompok penugasan di SK nya saja', () => {
        const worker = fs.readFileSync(workerPath, 'utf8');
        // Validasi pembatasan kelompok penugasan hanya pada SK yang ditugaskan (assignedGroups)
        expect(worker).toContain('const assignedGroupIdSet = new Set(assignedGroups.map(ag => ag.group_id).filter(Boolean));');
        expect(worker).toContain('targetGroups = allGroups.filter(g => assignedGroupIdSet.has(g.id));');
        expect(worker).toContain('if (assignedGroupIdSet.size > 0 && !targetGroupIdSet.has(resolvedGroupId))');
        expect(worker).toContain('for (const grp of targetGroups)');
    });

    test('Modal cetak tendik mendukung periode mingguan, unggah foto lokal, dan TTD pegawai', () => {
        const js = fs.readFileSync(jsPath, 'utf8');
        expect(js).toContain('window.setEmployeeButirPeriodWeek = function(weekIdx)');
        expect(js).toContain('nextRekapWeekRange(period.isFullMonth ? null : _empPrint.range, weekIdx)');
        expect(js).toContain('window.uploadEmployeeButirLocalPhoto = async function(actId, fileInput)');
        expect(js).toContain('window.clearEmployeeButirSignature = function()');
        expect(js).toContain('window.printEmployeeButirReport = function()');
    });

    test('e-kinerja-tendik.html memuat Tab dan Pane Pengaturan Hak Akses VIP Tendik di modal penugasan', () => {
        const html = fs.readFileSync(htmlPath, 'utf8');
        expect(html).toContain('id="btn-tab-manage-vip"');
        expect(html).toContain('onclick="window.switchManageTab(\'vip\')"');
        expect(html).toContain('id="badge-count-vip"');
        expect(html).toContain('id="pane-manage-vip"');
        expect(html).toContain('id="toggle-vip-all-tendik"');
        expect(html).toContain('id="input-search-vip"');
        expect(html).toContain('id="table-manage-vip-body"');
        expect(html).toContain('id="btn-save-vip-settings"');
    });

    test('js/page-e-kinerja-tendik.js mendeklarasikan seluruh fungsi pengelolaan hak akses VIP di window', () => {
        const js = fs.readFileSync(jsPath, 'utf8');
        expect(js).toContain('window.loadVipSettingsData =');
        expect(js).toContain('window.renderVipEmployeesList =');
        expect(js).toContain('window.toggleVipAllTendik =');
        expect(js).toContain('window.toggleVipEmployeeSelection =');
        expect(js).toContain('window.selectAllVipEmployees =');
        expect(js).toContain('window.filterVipEmployeesList =');
        expect(js).toContain('window.saveVipSettings =');
        // Otorisasi modal rekap untuk tendik VIP
        expect(js).toContain('if (!isSupervisor && !hasEmployeeVipAccess)');
    });

    test('Pengaturan Hak Akses VIP Tendik memfilter murni Tenaga Kependidikan dan menyaring keluar guru/tenaga pendidik', () => {
        const js = fs.readFileSync(jsPath, 'utf8');
        expect(js).toContain('export function isTendikGtk(g)');
        expect(js).toContain('window.isTendikGtk = isTendikGtk;');
        expect(js).toContain('export function getTendikGtkList()');
        expect(js).toContain('window.getTendikGtkList = getTendikGtkList;');
        // Memastikan renderVipEmployeesList dan selectAllVipEmployees menggunakan populasi tendik
        expect(js).toContain('const tendikPopulation = getTendikGtkList();');
        expect(js).toContain("jenisPtk.includes('guru') || jenisPtk.includes('pendidik') || role === 'guru_bk'");
    });

    test('js/cloudflare-client.js menyediakan method dan binding getEmployeeVipSettings & saveEmployeeVipSettings', () => {
        const client = fs.readFileSync(clientPath, 'utf8');
        expect(client).toContain('async getEmployeeVipSettings(');
        expect(client).toContain('async saveEmployeeVipSettings(');
        expect(client).toContain('export async function cfGetEmployeeVipSettings');
        expect(client).toContain('export async function cfSaveEmployeeVipSettings');
        expect(client).toContain('window.cfGetEmployeeVipSettings = cfGetEmployeeVipSettings;');
        expect(client).toContain('window.cfSaveEmployeeVipSettings = cfSaveEmployeeVipSettings;');
    });

    test('cloudflare/worker.js memuat rute GET & POST /api/employee-agenda/vip-settings dan evaluasi akses VIP di monthly-recap', () => {
        const worker = fs.readFileSync(workerPath, 'utf8');
        expect(worker).toContain('path === "/api/employee-agenda/vip-settings"');
        expect(worker).toContain("key = 'employee_agenda_vip_config'");
        expect(worker).toContain("Hanya Super Admin yang berwenang mengubah hak akses VIP Tendik");
        expect(worker).toContain("let userHasVip = isManager;");
        expect(worker).toContain("jenis_ptk LIKE '%Keamanan%'");
    });
});

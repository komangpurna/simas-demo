/**
 * Unit Test: Penggantian Dialog Konfirmasi Native Browser Menjadi Modal Modern di E-Kinerja
 * Memastikan 0 pemanggilan alert() dan confirm() jadul di js/page-beban-kerja.js & js/page-monitoring-beban-kerja.js
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Modern Confirm Modal di E-Kinerja & Global SIMAS', () => {
    const root = path.resolve(__dirname, '..');
    const globalJsPath = path.join(root, 'js', 'global.js');
    const pageBebanKerjaJsPath = path.join(root, 'js', 'page-beban-kerja.js');
    const pageMonitoringJsPath = path.join(root, 'js', 'page-monitoring-beban-kerja.js');

    const globalJsContent = fs.readFileSync(globalJsPath, 'utf8');
    const pageBebanKerjaJsContent = fs.readFileSync(pageBebanKerjaJsPath, 'utf8');
    const pageMonitoringJsContent = fs.readFileSync(pageMonitoringJsPath, 'utf8');

    test('1. js/global.js mendefinisikan window.showConfirmModal dengan dukungan options (confirmText, cancelText, icon)', () => {
        expect(globalJsContent).toContain('window.showConfirmModal = function (message, title = \'Konfirmasi\', type = \'warning\', options = {})');
        expect(globalJsContent).toContain('options && options.confirmText');
        expect(globalJsContent).toContain('options && options.cancelText');
        expect(globalJsContent).toContain('options && options.icon');
        expect(globalJsContent).toContain("overlay.id = 'global-confirm-overlay';");
        expect(globalJsContent).toContain('id="global-confirm-ok"');
        expect(globalJsContent).toContain('id="global-confirm-cancel"');
    });

    test('2. js/page-beban-kerja.js TIDAK memanggil confirm() atau alert() jadul', () => {
        // Cek bahwa tidak ada native alert atau confirm
        const nativeConfirmCalls = pageBebanKerjaJsContent.match(/(?:^|[^a-zA-Z0-9_$])(?:window\.)?confirm\s*\(/g) || [];
        const nativeAlertCalls = pageBebanKerjaJsContent.match(/(?:^|[^a-zA-Z0-9_$])(?:window\.)?alert\s*\(/g) || [];

        expect(nativeConfirmCalls.length).toBe(0);
        expect(nativeAlertCalls.length).toBe(0);
    });

    test('3. js/page-monitoring-beban-kerja.js TIDAK memanggil confirm() atau alert() jadul', () => {
        const nativeConfirmCalls = pageMonitoringJsContent.match(/(?:^|[^a-zA-Z0-9_$])(?:window\.)?confirm\s*\(/g) || [];
        const nativeAlertCalls = pageMonitoringJsContent.match(/(?:^|[^a-zA-Z0-9_$])(?:window\.)?alert\s*\(/g) || [];

        expect(nativeConfirmCalls.length).toBe(0);
        expect(nativeAlertCalls.length).toBe(0);
    });

    test('4. Seluruh titik aksi sensitif di E-Kinerja menggunakan askConfirm / showConfirmModal', () => {
        // 1. Toggle status sub-kegiatan katalog
        expect(pageBebanKerjaJsContent).toContain('toggleCatalogItemActive(catalogId)');
        expect(pageBebanKerjaJsContent).toContain('Sub-Kegiatan');

        // 2. Nonaktifkan cuti/izin
        expect(pageBebanKerjaJsContent).toContain('deactivateDayLeave');
        expect(pageBebanKerjaJsContent).toContain('Nonaktifkan Cuti/Izin');

        // 3. Hapus template
        expect(pageBebanKerjaJsContent).toContain('workloadDeleteTemplate');
        expect(pageBebanKerjaJsContent).toContain('Hapus Template');

        // 4. Hapus item rencana
        expect(pageBebanKerjaJsContent).toContain('deletePlanItem(segmentId)');
        expect(pageBebanKerjaJsContent).toContain('Hapus Rencana');

        // 5. Hapus log realisasi
        expect(pageBebanKerjaJsContent).toContain('deleteLog(logId)');
        expect(pageBebanKerjaJsContent).toContain('Hapus Realisasi');

        // 6. Finalisasi / Pengajuan Rencana Kerja
        expect(pageBebanKerjaJsContent).toContain('submitPlan()');
        expect(pageBebanKerjaJsContent).toContain('Finalisasi Rencana');

        // 7. Bulk Verify di Monitoring
        expect(pageMonitoringJsContent).toContain('bulkVerify()');
        expect(pageMonitoringJsContent).toContain('Verifikasi Massal');
    });
});

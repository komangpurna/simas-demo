/**
 * Unit Test: Penyatuan Halaman E-Kinerja Guru & Relokasi ke Kelompok Agenda
 * Sesuai Permendikdasmen No. 11/2025 & Kepmendikdasmen No. 221/P/2025
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Konsolidasi Modul E-Kinerja Guru & Kelompok Agenda', () => {
    const root = path.resolve(__dirname, '..');
    const globalJsPath = path.join(root, 'js', 'global.js');
    const eKinerjaHtmlPath = path.join(root, 'e-kinerja.html');
    const monitoringHtmlPath = path.join(root, 'monitoring-beban-kerja.html');
    const pageEKinerjaJsPath = path.join(root, 'js', 'page-e-kinerja.js');
    const pageBebanKerjaJsPath = path.join(root, 'js', 'page-beban-kerja.js');

    const globalJsContent = fs.readFileSync(globalJsPath, 'utf8');
    const eKinerjaHtmlContent = fs.readFileSync(eKinerjaHtmlPath, 'utf8');
    const monitoringHtmlContent = fs.readFileSync(monitoringHtmlPath, 'utf8');
    const pageEKinerjaJsContent = fs.readFileSync(pageEKinerjaJsPath, 'utf8');
    const pageBebanKerjaJsContent = fs.readFileSync(pageBebanKerjaJsPath, 'utf8');

    test('1. Modul beban_kerja dipindahkan ke dalam kelompok agenda_group di MENU_GROUPS', () => {
        expect(globalJsContent).toContain("key: 'agenda_group'");
        expect(globalJsContent).toContain("items: ['jadwal', 'agenda', 'agenda_pegawai', 'beban_kerja', 'dokumen', 'siswa', 'guru']");
        expect(globalJsContent).not.toContain("key: 'beban_kerja_group'");
    });

    test('2. MENU_CONFIG mengonsolidasikan beban_kerja dan menghapus monitoring_beban_kerja yang berdiri sendiri', () => {
        const superAdminMatch = globalJsContent.match(/'super_admin':\s*\[([\s\S]*?)\]/);
        expect(superAdminMatch).not.toBeNull();
        expect(superAdminMatch[1]).toContain("'beban_kerja'");
        expect(superAdminMatch[1]).not.toContain("'monitoring_beban_kerja'");

        const kepsekMatch = globalJsContent.match(/'kepala_sekolah':\s*\[([\s\S]*?)\]/);
        expect(kepsekMatch).not.toBeNull();
        expect(kepsekMatch[1]).toContain("'beban_kerja'");
        expect(kepsekMatch[1]).not.toContain("'monitoring_beban_kerja'");

        const kurikulumMatch = globalJsContent.match(/'wakasek_kurikulum':\s*\[([\s\S]*?)\]/);
        expect(kurikulumMatch).not.toBeNull();
        expect(kurikulumMatch[1]).toContain("'beban_kerja'");
        expect(kurikulumMatch[1]).not.toContain("'monitoring_beban_kerja'");
    });

    test('3. e-kinerja.html memiliki Tab dan Panel Monitoring & Supervisi Guru', () => {
        expect(eKinerjaHtmlContent).toContain('id="tab-btn-monitoring"');
        expect(eKinerjaHtmlContent).toContain('id="tab-content-monitoring"');
        expect(eKinerjaHtmlContent).toContain('id="kpi-mon-total-teachers"');
        expect(eKinerjaHtmlContent).toContain('id="table-monitoring-body"');
        expect(eKinerjaHtmlContent).toContain('id="modal-review-plan"');
        expect(eKinerjaHtmlContent).toContain('id="modal-review-logs"');
        expect(eKinerjaHtmlContent).toContain('id="modal-teacher-detail"');
    });

    test('4. monitoring-beban-kerja.html mengalihkan secara instan ke e-kinerja.html?tab=monitoring', () => {
        expect(monitoringHtmlContent).toContain("window.location.replace('e-kinerja.html'");
        expect(monitoringHtmlContent).toContain("tab=monitoring");
    });

    test('5. js/page-e-kinerja.js mengimpor kedua modul dan mengatur hak akses supervisor', () => {
        expect(pageEKinerjaJsContent).toContain("import './page-beban-kerja.js';");
        expect(pageEKinerjaJsContent).toContain("import './page-monitoring-beban-kerja.js';");
        expect(pageEKinerjaJsContent).toContain("isSupervisorRole");
        expect(pageEKinerjaJsContent).toContain("tab-btn-monitoring");
    });

    test('6. js/page-beban-kerja.js memanggil monitoringLoadSummary saat tab-monitoring diaktifkan', () => {
        expect(pageBebanKerjaJsContent).toContain("tabId === 'tab-monitoring'");
        expect(pageBebanKerjaJsContent).toContain("window.monitoringLoadSummary()");
    });

    test('7. js/page-e-kinerja.js mengimpor auth, db, PATHS dari config.js dan doc, getDoc dari firestore CDN (bukan global.js)', () => {
        expect(pageEKinerjaJsContent).toMatch(/import\s*\{[^}]*auth[^}]*\}\s*from\s*['"]\.\/config\.js['"]/);
        expect(pageEKinerjaJsContent).toMatch(/import\s*\{[^}]*PATHS[^}]*\}\s*from\s*['"]\.\/config\.js['"]/);
        expect(pageEKinerjaJsContent).toMatch(/import\s*\{[^}]*getDoc[^}]*\}\s*from\s*['"]https:\/\/www\.gstatic\.com\/firebasejs\/11\.0\.2\/firebase-firestore\.js['"]/);
        expect(pageEKinerjaJsContent).toMatch(/import\s*\{[^}]*initLayout[^}]*\}\s*from\s*['"]\.\/global\.js['"]/);
    });

    test('8. js/page-e-kinerja.js memanggil initLayout dan membuka visibilitas elemen main (unhide)', () => {
        expect(pageEKinerjaJsContent).toContain("initLayout(");
        expect(pageEKinerjaJsContent).toContain("mainEl.classList.remove('hidden')");
    });
});


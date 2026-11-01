/** @jest-environment jsdom */
const fs = require('node:fs');
const path = require('node:path');

describe('Navigasi Agenda dan Dokumen beserta Data Siswa dan GTK', () => {
    let globalJsContent;
    let agendaHtmlContent;

    beforeAll(() => {
        globalJsContent = fs.readFileSync(path.join(__dirname, '../js/global.js'), 'utf8');
        agendaHtmlContent = fs.readFileSync(path.join(__dirname, '../agenda.html'), 'utf8');
    });

    describe('1. Konfigurasi Grup Menu & Submenu di js/global.js', () => {
        test('1.1. MENU_GROUPS menempatkan Jadwal Pelajaran di paling atas kelompok Agenda dan Dokumen serta memperbarui kelompok Akademik', () => {
            expect(globalJsContent).toContain("key: 'agenda_group'");
            expect(globalJsContent).toContain("label: 'Agenda dan Dokumen'");
            expect(globalJsContent).toContain("type: 'group'");
            expect(globalJsContent).toContain("items: ['jadwal', 'agenda', 'agenda_pegawai', 'beban_kerja', 'dokumen', 'siswa', 'guru']");

            expect(globalJsContent).toContain("key: 'akademik'");
            expect(globalJsContent).toContain("items: ['guru_mapel_portal', 'guru_wali', 'wali_kelas', 'game_pid', 'e_lab', 'e_rapor']");
        });

        test('1.2. MENU_LABELS mendefinisikan URL dan label untuk ketiga modul terpisah (dengan migrasi E-Kinerja Tendik)', () => {
            expect(globalJsContent).toContain("'agenda': {");
            expect(globalJsContent).toContain("label: 'Kalender Agenda'");
            expect(globalJsContent).toContain("agenda.html");

            expect(globalJsContent).toContain("'agenda_pegawai': {");
            expect(globalJsContent).toContain("label: 'E-Kinerja Tendik'");
            expect(globalJsContent).toContain("e-kinerja-tendik.html");

            expect(globalJsContent).toContain("'dokumen': {");
            expect(globalJsContent).toContain("label: 'Dokumen'");
            expect(globalJsContent).toContain("dokumen.html");
        });

        test('1.3. Role staff, kepala_sekolah, dan super_admin memiliki ketiga submenu agenda', () => {
            const superAdminMatch = globalJsContent.match(/'super_admin':\s*\[([\s\S]*?)\]/);
            expect(superAdminMatch).not.toBeNull();
            expect(superAdminMatch[1]).toContain("'agenda'");
            expect(superAdminMatch[1]).toContain("'agenda_pegawai'");
            expect(superAdminMatch[1]).toContain("'dokumen'");

            const staffMatch = globalJsContent.match(/'staff':\s*\[([\s\S]*?)\]/);
            expect(staffMatch).not.toBeNull();
            expect(staffMatch[1]).toContain("'agenda'");
            expect(staffMatch[1]).toContain("'agenda_pegawai'");
            expect(staffMatch[1]).toContain("'dokumen'");

            const kepsekMatch = globalJsContent.match(/'kepala_sekolah':\s*\[([\s\S]*?)\]/);
            expect(kepsekMatch).not.toBeNull();
            expect(kepsekMatch[1]).toContain("'agenda'");
            expect(kepsekMatch[1]).toContain("'agenda_pegawai'");
            expect(kepsekMatch[1]).toContain("'dokumen'");
        });

        test('1.4. Role guru_mapel, kesiswaan, wakasek_kurikulum HANYA memiliki agenda dan dokumen (tanpa agenda_pegawai)', () => {
            const guruMapelMatch = globalJsContent.match(/'guru_mapel':\s*\[([\s\S]*?)\]/);
            expect(guruMapelMatch).not.toBeNull();
            expect(guruMapelMatch[1]).toContain("'agenda'");
            expect(guruMapelMatch[1]).toContain("'dokumen'");
            expect(guruMapelMatch[1]).not.toContain("'agenda_pegawai'");

            const kurikulumMatch = globalJsContent.match(/'wakasek_kurikulum':\s*\[([\s\S]*?)\]/);
            expect(kurikulumMatch).not.toBeNull();
            expect(kurikulumMatch[1]).toContain("'agenda'");
            expect(kurikulumMatch[1]).toContain("'dokumen'");
            expect(kurikulumMatch[1]).not.toContain("'agenda_pegawai'");
        });

        test('1.5. PAGE_ACCESS_CONFIG melindungi e-kinerja-tendik.html dan agenda-pegawai.html khusus untuk staff, super_admin, dan kepala_sekolah', () => {
            const pageAccessMatch = globalJsContent.match(/'e-kinerja-tendik\.html':\s*\{([\s\S]*?)\}/);
            expect(pageAccessMatch).not.toBeNull();
            const configStr = pageAccessMatch[1];
            expect(configStr).toContain("'staff': 'rw'");
            expect(configStr).toContain("'kepala_sekolah': 'rw'");
            expect(configStr).toContain("'super_admin': 'rw'");
            expect(configStr).toContain("'guru_mapel': 'x'");
            expect(configStr).toContain("'kesiswaan': 'x'");
            expect(configStr).toContain("'wakasek_kurikulum': 'x'");

            // Backward-compatibility untuk agenda-pegawai.html
            expect(globalJsContent).toContain("'agenda-pegawai.html': {");
        });

        test('1.6. Accordion otomatis terbuka (auto-open) saat halaman aktif berada dalam grup', () => {
            expect(globalJsContent).toContain("const hasActiveItem = visibleItems.some(key => MENU_LABELS[key]?.link === currentHref);");
            expect(globalJsContent).toContain("const isOpen = openGroups.includes(group.key) || hasActiveItem;");
        });
    });

    describe('2. Kompatibilitas Tautan Lama & Pengalihan Cepat (agenda.html & agenda-pegawai.html)', () => {
        test('2.1. agenda.html memuat skrip inline redirection instan di head untuk hash/query lama', () => {
            expect(agendaHtmlContent).toContain("window.location.hash");
            expect(agendaHtmlContent).toContain("window.location.replace('dokumen.html');");
            expect(agendaHtmlContent).toContain("window.location.replace('dokumen.html#settings');");
            expect(agendaHtmlContent).toContain("window.location.replace('e-kinerja-tendik.html' + q);");
        });

        test('2.2. agenda-pegawai.html memuat skrip redirect shim instan ke e-kinerja-tendik.html dengan preservasi query & hash', () => {
            const shimContent = fs.readFileSync(path.join(__dirname, '../agenda-pegawai.html'), 'utf8');
            expect(shimContent).toContain("var target = 'e-kinerja-tendik.html' + window.location.search + window.location.hash;");
            expect(shimContent).toContain("window.location.replace(target);");
            expect(shimContent).toContain('e-kinerja-tendik.html');
        });
    });

    describe('3. Keberadaan Berkas Fisik & PWA Caching', () => {
        test('3.1. Berkas dokumen.html, agenda-pegawai.html, dan e-kinerja-tendik.html eksis secara fisik di root', () => {
            expect(fs.existsSync(path.join(__dirname, '../dokumen.html'))).toBe(true);
            expect(fs.existsSync(path.join(__dirname, '../agenda-pegawai.html'))).toBe(true);
            expect(fs.existsSync(path.join(__dirname, '../e-kinerja-tendik.html'))).toBe(true);
            expect(fs.existsSync(path.join(__dirname, '../agenda.html'))).toBe(true);
        });

        test('3.2. Berkas controller JS dokumen, agenda-pegawai, dan e-kinerja-tendik eksis', () => {
            expect(fs.existsSync(path.join(__dirname, '../js/page-dokumen.js'))).toBe(true);
            expect(fs.existsSync(path.join(__dirname, '../js/page-e-kinerja-tendik.js'))).toBe(true);
            expect(fs.existsSync(path.join(__dirname, '../js/agenda-common.js'))).toBe(true);
        });

        test('3.3. sw.js mendaftarkan berkas-berkas baru di ASSETS_TO_CACHE', () => {
            const swContent = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');
            expect(swContent).toContain("'./agenda.html'");
            expect(swContent).toContain("'./agenda-pegawai.html'");
            expect(swContent).toContain("'./dokumen.html'");
            expect(swContent).toContain("'./js/agenda-common.js'");
            expect(swContent).toContain("'./js/page-dokumen.js'");
            expect(swContent).toContain("'./js/page-agenda-pegawai.js'");
        });
    });
});

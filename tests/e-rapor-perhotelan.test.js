/**
 * Test Suite: Restrukturisasi 2 Tab Utama E-Rapor & Verifikasi Eliminasi Modul Perhotelan
 * Memverifikasi struktur navigasi 2 tab utama (Ujian Sekolah & Pengaturan), dynamic header subnav,
 * modal dialog Import Excel Ujian Sekolah, serta memastikan seluruh artefak modul Perhotelan
 * telah dibersihkan secara tuntas dari e-rapor.html dan js/page-e-rapor.js.
 */

const fs = require('fs');
const path = require('path');

describe('E-Rapor: Restrukturisasi 2 Tab Utama & Eliminasi Modul Perhotelan', () => {
    let eRaporHtml;
    let pageERaporJs;

    beforeAll(() => {
        eRaporHtml = fs.readFileSync(path.join(__dirname, '../e-rapor.html'), 'utf8');
        pageERaporJs = fs.readFileSync(path.join(__dirname, '../js/page-e-rapor.js'), 'utf8');
    });

    describe('1. Verifikasi Struktur Navigasi HTML 2 Tab Utama (e-rapor.html)', () => {
        test('Memiliki 2 Tab Utama di header navigation pills (Ujian Sekolah & Pengaturan)', () => {
            expect(eRaporHtml).toContain('id="tab-main-ujian"');
            expect(eRaporHtml).toContain('id="tab-main-pengaturan"');
            // Memastikan tab perhotelan sudah dihapus
            expect(eRaporHtml).not.toContain('id="tab-main-perhotelan"');
            expect(eRaporHtml).not.toContain("switchMainTab('perhotelan')");
        });

        test('Tab 1: Ujian Sekolah membungkus subnavigasi (Teori, Praktik, Rekap Leger) dan tombol Import Excel modal', () => {
            expect(eRaporHtml).toContain('id="section-ujian-sekolah"');
            expect(eRaporHtml).toContain('id="subnav-ujian-sekolah"');
            expect(eRaporHtml).toContain('id="tab-btn-ujian-teori"');
            expect(eRaporHtml).toContain('id="tab-btn-ujian-praktik"');
            expect(eRaporHtml).toContain('id="tab-btn-ujian-rekap"');
            // Menghilangkan tab bar ganda sub-tab-nav
            expect(eRaporHtml).not.toContain('id="sub-tab-nav"');
            // Tombol modal import
            expect(eRaporHtml).toContain('id="btn-open-modal-import"');
            expect(eRaporHtml).toContain('openModalImportUjian()');
            expect(eRaporHtml).toContain('id="modal-import-ujian"');
            expect(eRaporHtml).toContain('closeModalImportUjian()');
        });

        test('Sub-tab dinamis terintegrasi di dalam header page-header untuk Ujian Sekolah & Pengaturan', () => {
            const headerChunk = eRaporHtml.substring(eRaporHtml.indexOf('id="page-header"'), eRaporHtml.indexOf('id="section-ujian-sekolah"'));
            expect(headerChunk).toContain('id="header-dynamic-subnav"');
            expect(headerChunk).toContain('id="subnav-ujian-sekolah"');
            expect(headerChunk).toContain('id="subnav-pengaturan"');
            expect(headerChunk).not.toContain('id="subnav-perhotelan"');
        });

        test('Seluruh elemen HTML khusus modul Perhotelan telah dieliminasi', () => {
            expect(eRaporHtml).not.toContain('id="section-perhotelan"');
            expect(eRaporHtml).not.toContain('id="subnav-perhotelan"');
            expect(eRaporHtml).not.toContain('id="tab-perhotelan-input"');
            expect(eRaporHtml).not.toContain('id="modal-import-perhotelan"');
            expect(eRaporHtml).not.toContain('id="tab-perhotelan-rekap"');
            expect(eRaporHtml).not.toContain('header-perhotelan');
        });

        test('#section-ujian-sekolah dan #tab-pengaturan berada pada level hirarki sejajar (tidak bersarang/terpotong)', () => {
            const { JSDOM } = require('jsdom');
            const dom = new JSDOM(eRaporHtml);
            const doc = dom.window.document;
            const secUjian = doc.getElementById('section-ujian-sekolah');
            const tabPengaturan = doc.getElementById('tab-pengaturan');
            expect(secUjian).not.toBeNull();
            expect(tabPengaturan).not.toBeNull();
            expect(secUjian.contains(tabPengaturan)).toBe(false);
            expect(secUjian.parentElement).toBe(tabPengaturan.parentElement);
        });
    });

    describe('2. Verifikasi Logika Navigasi & Animated Highlighter (page-e-rapor.js)', () => {
        test('switchMainTab hanya mengelola 2 tab: ujian_sekolah dan pengaturan', () => {
            expect(pageERaporJs).toContain('window.switchMainTab = (mainTab) =>');
            expect(pageERaporJs).toContain("mainTab === 'ujian_sekolah'");
            expect(pageERaporJs).toContain("mainTab === 'pengaturan'");
            expect(pageERaporJs).not.toContain("mainTab === 'perhotelan'");
        });

        test('switchMainTab mengendalikan visibilitas subnav header tanpa subnavPerhotelan', () => {
            expect(pageERaporJs).toContain("subnavUjian.classList.toggle('hidden', mainTab !== 'ujian_sekolah')");
            expect(pageERaporJs).toContain("subnavPengaturan.classList.toggle('hidden', mainTab !== 'pengaturan')");
            expect(pageERaporJs).not.toContain('subnavPerhotelan');
        });

        test('switchUjianSekolahSubTab menangani subnav Ujian Sekolah (teori, praktik, rekap)', () => {
            expect(pageERaporJs).toContain('window.switchUjianSekolahSubTab = (subTab) =>');
            expect(pageERaporJs).toContain("subTab === 'teori'");
            expect(pageERaporJs).toContain("subTab === 'praktik'");
            expect(pageERaporJs).toContain("subTab === 'rekap'");
        });

        test('updateHeaderAndHighlight dikonfigurasi untuk 2 tab utama', () => {
            expect(pageERaporJs).toContain('function updateHeaderAndHighlight(tabKey)');
            expect(pageERaporJs).toContain("activeMainKey = (tabKey === 'pengaturan' ? 'pengaturan' : 'ujian_sekolah')");
            expect(pageERaporJs).not.toContain("activeMainKey === 'perhotelan'");
        });

        test('Kompatibilitas fungsi warisan switchTab dan switchMode tetap terjaga', () => {
            expect(pageERaporJs).toContain('window.switchTab = (tabId) =>');
            expect(pageERaporJs).toContain('window.switchMode = (mode) =>');
            expect(pageERaporJs).toContain('openModalImportUjian()');
        });
    });

    describe('3. Verifikasi Pembersihan Kode Modul Perhotelan (page-e-rapor.js)', () => {
        test('Fungsi dan state input, import, dan rekap perhotelan tidak lagi ada', () => {
            expect(pageERaporJs).not.toContain('window.loadPerhotelanStudentsForInput');
            expect(pageERaporJs).not.toContain('window.savePerhotelanInputScores');
            expect(pageERaporJs).not.toContain('window.previewPerhotelanPasteData');
            expect(pageERaporJs).not.toContain('window.savePerhotelanPasteData');
            expect(pageERaporJs).not.toContain('window.loadPerhotelanRekapData');
            expect(pageERaporJs).not.toContain('window.downloadPerhotelanRekap');
            expect(pageERaporJs).not.toContain('window.switchPerhotelanSubTab');
            expect(pageERaporJs).not.toContain('window.openModalImportPerhotelan');
            expect(pageERaporJs).not.toContain('window.closeModalImportPerhotelan');
            expect(pageERaporJs).not.toContain('loadKelasX_XI');
            expect(pageERaporJs).not.toContain('getPerhotelanMasterMapels');
            expect(pageERaporJs).not.toContain('populatePerhotelanDropdowns');
            expect(pageERaporJs).not.toContain('perhotelanLoadedStudents');
            expect(pageERaporJs).not.toContain('perhotelanPreviewData');
            expect(pageERaporJs).not.toContain('perhotelanRekapData');
        });

        test('applyInputLockMode hanya mengendalikan kontrol Ujian Sekolah', () => {
            expect(pageERaporJs).toContain('btnOpenImportUjian');
            expect(pageERaporJs).not.toContain('btnOpenImportPerhotelan');
            expect(pageERaporJs).not.toContain('btnSavePerhotelan');
        });
    });
});

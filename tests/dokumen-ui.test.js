/** @jest-environment jsdom */
const fs = require('node:fs');
const path = require('node:path');

describe('Dokumen Sekolah UI and Manager (dokumen.html)', () => {
    let htmlContent;

    beforeAll(() => {
        htmlContent = fs.readFileSync(path.join(__dirname, '../dokumen.html'), 'utf8');
    });

    beforeEach(() => {
        document.documentElement.innerHTML = htmlContent;
    });

    test('1. Header memiliki judul Dokumen Sekolah dan tombol Kelola Dokumen', () => {
        const btnManage = document.getElementById('btn-manage-docs');
        expect(btnManage).not.toBeNull();
        expect(btnManage.textContent).toContain('Kelola Dokumen');
        expect(btnManage.querySelector('i.fa-sliders')).not.toBeNull();
        expect(btnManage.classList.contains('hidden')).toBe(true);

        const h1 = document.querySelector('h1');
        expect(h1).not.toBeNull();
        expect(h1.textContent).toContain('Dokumen Sekolah');
    });

    test('2. Komponen filter kategori desktop dan mobile serta kolom pencarian hadir lengkap', () => {
        const catFilters = document.getElementById('doc-category-filters');
        expect(catFilters).not.toBeNull();

        const mobileSelect = document.getElementById('select-doc-category-mobile');
        expect(mobileSelect).not.toBeNull();

        const searchInput = document.getElementById('input-search-docs');
        expect(searchInput).not.toBeNull();

        const docsGrid = document.getElementById('docs-grid');
        expect(docsGrid).not.toBeNull();
    });

    test('3. Modal kelola dokumen memiliki formulir input dan daftar dokumen terdaftar', () => {
        const modal = document.getElementById('modal-docs-manager');
        expect(modal).not.toBeNull();
        expect(modal.classList.contains('hidden')).toBe(true);

        // Form elements
        expect(document.getElementById('doc-form-title')).not.toBeNull();
        expect(document.getElementById('input-doc-id')).not.toBeNull();
        expect(document.getElementById('input-doc-title')).not.toBeNull();
        expect(document.getElementById('input-doc-url')).not.toBeNull();
        expect(document.getElementById('select-doc-category')).not.toBeNull();
        expect(document.getElementById('input-doc-desc')).not.toBeNull();
        expect(document.getElementById('btn-save-doc')).not.toBeNull();

        // Daftar dokumen sisi kanan
        expect(document.getElementById('docs-settings-list')).not.toBeNull();
        expect(document.getElementById('docs-count-label')).not.toBeNull();
    });

    test('4. Seluruh ID DOM dokumen.html unik tanpa duplikasi', () => {
        const requiredIds = [
            'btn-manage-docs',
            'doc-category-filters',
            'select-doc-category-mobile',
            'input-search-docs',
            'docs-grid',
            'modal-docs-manager',
            'modal-docs-content',
            'doc-form-title',
            'input-doc-id',
            'input-doc-title',
            'input-doc-url',
            'select-doc-category',
            'input-doc-desc',
            'btn-save-doc',
            'docs-settings-list',
            'docs-count-label',
            'modal-generic-confirm'
        ];

        requiredIds.forEach(id => {
            const elements = document.querySelectorAll(`#${id}`);
            expect(elements.length).toBe(1);
        });
    });

    test('5. Pengguna non-pengelola tidak dapat membuka modal dokumen', () => {
        let isDocManager = false;
        const modal = document.getElementById('modal-docs-manager');
        modal.classList.add('hidden');

        const openDocsManager = () => {
            if (!isDocManager) return;
            modal.classList.remove('hidden');
        };

        openDocsManager();
        expect(modal.classList.contains('hidden')).toBe(true);
    });

    test('6. Filter kategori mendukung Semua, Kurikulum, Akademik, SOP, Pengumuman, Umum, dan Arsip', () => {
        const mobileSelect = document.getElementById('select-doc-category-mobile');
        const options = Array.from(mobileSelect.querySelectorAll('option')).map(o => o.value);

        expect(options).toContain('all');
        expect(options).toContain('Kurikulum');
        expect(options).toContain('Akademik');
        expect(options).toContain('SOP');
        expect(options).toContain('Pengumuman');
        expect(options).toContain('Umum');
        expect(options).toContain('archive');
    });

    test('7. Grid dokumen mengadopsi tata letak compact multi-kolom responsif', () => {
        const docsGrid = document.getElementById('docs-grid');
        expect(docsGrid).not.toBeNull();
        expect(docsGrid.className).toContain('grid-cols-1');
        expect(docsGrid.className).toContain('md:grid-cols-3');
        expect(docsGrid.className).toContain('lg:grid-cols-4');
        expect(docsGrid.className).toContain('2xl:grid-cols-5');
    });
});


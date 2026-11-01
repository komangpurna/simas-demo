const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

describe('Verifikasi Hierarki Z-Index Modal di guru-wali.html', () => {
    const guruWaliHtml = fs.readFileSync(path.join(projectRoot, 'guru-wali.html'), 'utf8');
    const styleCss = fs.readFileSync(path.join(projectRoot, 'css', 'style.css'), 'utf8');

    test('1. Kelas .z-modal terdefinisi dengan z-index 9999 di style.css', () => {
        expect(styleCss).toMatch(/\.z-modal\s*\{[^}]*z-index:\s*9999/);
    });

    test('2. Modal detail siswa menggunakan kelas z-modal (z-index: 9999)', () => {
        const detailModalMatch = guruWaliHtml.match(/<div[^>]*id=["']modal-detail-siswa["'][^>]*class=["']([^"']*)["']/);
        expect(detailModalMatch).not.toBeNull();
        const classes = detailModalMatch[1];
        expect(classes).toContain('z-modal');
    });

    test('3. Modal konfirmasi hapus siswa memiliki z-index lebih tinggi dari modal detail siswa (z-[10010])', () => {
        const confirmModalMatch = guruWaliHtml.match(/<div[^>]*id=["']modal-confirm-hapus["'][^>]*class=["']([^"']*)["']/);
        expect(confirmModalMatch).not.toBeNull();
        const classes = confirmModalMatch[1];
        expect(classes).toContain('z-[10010]');
        expect(classes).not.toContain('z-[60]');
    });

    test('4. Modal konfirmasi hapus catatan memiliki z-index lebih tinggi dari modal detail siswa (z-[10010])', () => {
        const confirmNoteMatch = guruWaliHtml.match(/<div[^>]*id=["']modal-confirm-hapus-catatan["'][^>]*class=["']([^"']*)["']/);
        expect(confirmNoteMatch).not.toBeNull();
        const classes = confirmNoteMatch[1];
        expect(classes).toContain('z-[10010]');
        expect(classes).not.toContain('z-[80]');
    });

    test('5. Modal edit catatan dan edit data siswa memiliki z-index di atas modal detail siswa (z-[10000])', () => {
        const editCatatanMatch = guruWaliHtml.match(/<div[^>]*id=["']modal-edit-catatan["'][^>]*class=["']([^"']*)["']/);
        expect(editCatatanMatch).not.toBeNull();
        expect(editCatatanMatch[1]).toContain('z-[10000]');

        const editDataMatch = guruWaliHtml.match(/<div[^>]*id=["']modal-edit-data-siswa["'][^>]*class=["']([^"']*)["']/);
        expect(editDataMatch).not.toBeNull();
        expect(editDataMatch[1]).toContain('z-[10000]');
    });

    test('6. Modal tambah catatan distandarkan dengan kelas z-modal', () => {
        const tambahCatatanMatch = guruWaliHtml.match(/<div[^>]*id=["']modal-tambah-catatan["'][^>]*class=["']([^"']*)["']/);
        expect(tambahCatatanMatch).not.toBeNull();
        expect(tambahCatatanMatch[1]).toContain('z-modal');
    });

    test('7. Overview stats menggunakan grid 2 kolom mobile (grid-cols-2 lg:grid-cols-4)', () => {
        expect(guruWaliHtml).toContain('grid grid-cols-2 lg:grid-cols-4');
    });

    test('8. Tab navigasi utama dan detail modal memiliki whitespace-nowrap & shrink-0 untuk horizontal scroll mobile', () => {
        expect(guruWaliHtml).toMatch(/class=["'][^"']*main-tab-btn[^"']*shrink-0\s+whitespace-nowrap/);
        expect(guruWaliHtml).toMatch(/class=["'][^"']*detail-tab[^"']*whitespace-nowrap/);
    });

    test('9. Modal detail siswa menggunakan padding responsif p-2 sm:p-4', () => {
        const detailModalMatch = guruWaliHtml.match(/<div[^>]*id=["']modal-detail-siswa["'][^>]*class=["']([^"']*)["']/);
        expect(detailModalMatch).not.toBeNull();
        expect(detailModalMatch[1]).toContain('p-2 sm:p-4');
    });
});

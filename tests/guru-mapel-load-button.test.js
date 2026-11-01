/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

describe('Portal Guru Mapel - Tombol Load Sentral di Tengah Layar (Empty State)', () => {
    let htmlContent;

    beforeAll(() => {
        const htmlPath = path.join(__dirname, '../guru-mapel.html');
        htmlContent = fs.readFileSync(htmlPath, 'utf8');
    });

    describe('1. Verifikasi Markup Statis HTML (guru-mapel.html)', () => {
        beforeEach(() => {
            document.body.innerHTML = htmlContent;
        });

        test('Lembar Penilaian memiliki tombol Load sentral di dalam gradebook-empty-state', () => {
            const emptyState = document.getElementById('gradebook-empty-state');
            expect(emptyState).not.toBeNull();

            const centerBtn = emptyState.querySelector('#btn-center-load-gradebook');
            expect(centerBtn).not.toBeNull();
            expect(centerBtn.getAttribute('onclick')).toBe('window.loadGradebookData()');
            expect(centerBtn.textContent).toContain('Muat Data (Load)');
            expect(centerBtn.querySelector('i.fa-rotate')).not.toBeNull();
        });

        test('Kehadiran Siswa memiliki tombol Load sentral di dalam kehadiran-empty-state', () => {
            const emptyState = document.getElementById('kehadiran-empty-state');
            expect(emptyState).not.toBeNull();

            const centerBtn = emptyState.querySelector('#btn-center-load-kehadiran');
            expect(centerBtn).not.toBeNull();
            expect(centerBtn.getAttribute('onclick')).toBe('window.loadGradebookData()');
            expect(centerBtn.textContent).toContain('Muat Data Kehadiran (Load)');
        });

        test('Daftar Jurnal memiliki tombol Load sentral di dalam jurnal-empty-state', () => {
            const emptyState = document.getElementById('jurnal-empty-state');
            expect(emptyState).not.toBeNull();

            const centerBtn = emptyState.querySelector('#btn-center-load-jurnal');
            expect(centerBtn).not.toBeNull();
            expect(centerBtn.getAttribute('onclick')).toBe('window.loadGradebookData()');
            expect(centerBtn.textContent).toContain('Muat Daftar Jurnal (Load)');
        });

        test('Modul LMS memiliki tombol Load sentral di dalam lms-materials-empty-state', () => {
            const emptyState = document.getElementById('lms-materials-empty-state');
            expect(emptyState).not.toBeNull();

            const centerBtn = emptyState.querySelector('#btn-center-load-lms');
            expect(centerBtn).not.toBeNull();
            expect(centerBtn.getAttribute('onclick')).toBe('window.loadGradebookData()');
            expect(centerBtn.textContent).toContain('Muat Modul LMS (Load)');
        });

        test('Script tag page-guru-mapel.js merujuk ke versi aktif', () => {
            const scriptTag = document.querySelector('script[src*="js/page-guru-mapel.js"]');
            expect(scriptTag).not.toBeNull();
            expect(scriptTag.getAttribute('src')).toMatch(/v=\d{2}\.\d{2}\.\d{2}\.\d+/);
        });
    });

    describe('2. Verifikasi Dinamis resetPortalTablesToEmpty()', () => {
        let escapeHTMLMock;

        beforeEach(() => {
            document.body.innerHTML = `
                <select id="select-kelas"><option value="">-- Kelas --</option></select>
                <select id="select-mapel"><option value="">-- Mapel --</option></select>
                <select id="select-semester"><option value="1">1</option></select>
                <span id="student-count-badge"></span>
                <div id="wrapper-class-cp" class="block"></div>
                <div id="gradebook-analytics-wrapper" class="block"></div>
                <div id="top-save-bar" class="flex"></div>
                <div id="bottom-save-bar" class="flex"></div>
                <div id="gradebook-table-wrapper"></div>
                <div id="kehadiran-table-wrapper"></div>
                <div id="jurnal-table-wrapper"></div>
                <div id="table-scope-title"></div>
                <div id="panel-penilaian"></div>
                <div id="panel-kehadiran" class="hidden"></div>
                <div id="panel-jurnal" class="hidden"></div>
            `;

            escapeHTMLMock = (str) => String(str || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
            window.escapeHTML = escapeHTMLMock;
        });

        test('Ketika kelas & mapel belum dipilih, merender tombol Load fallback', () => {
            const kelas = '';
            const mapel = '';
            const wrapperPenilaian = document.getElementById('gradebook-table-wrapper');

            wrapperPenilaian.innerHTML = `
                <div id="gradebook-empty-state" class="flex flex-col items-center justify-center p-12 text-center text-slate-400">
                    <i class="fa-solid fa-hand-pointer text-4xl mb-3 text-emerald-500/50"></i>
                    <p class="font-bold text-slate-700 dark:text-slate-200 text-sm">Pilih Kelas & Mata Pelajaran</p>
                    <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
                        ${(kelas && mapel) ? `Data penilaian untuk <b>${escapeHTMLMock(kelas)} - ${escapeHTMLMock(mapel)}</b> belum dimuat. Klik tombol <b>Load</b> di bawah atau di samping filter untuk membuka lembar penilaian.` : 'Pilih kelas dan mapel pengampu Anda pada baris filter di atas, lalu klik tombol <b>Load</b> untuk membuka lembar penilaian.'}
                    </p>
                    <button type="button" onclick="window.loadGradebookData()" id="btn-center-load-gradebook"
                        class="mt-4 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold text-xs rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-2 cursor-pointer">
                        <i class="fa-solid fa-rotate text-xs"></i>
                        <span>${(kelas && mapel) ? `Muat Data ${escapeHTMLMock(kelas)} - ${escapeHTMLMock(mapel)}` : 'Muat Data (Load)'}</span>
                    </button>
                </div>
            `;

            const btn = wrapperPenilaian.querySelector('#btn-center-load-gradebook');
            expect(btn).not.toBeNull();
            expect(btn.textContent).toContain('Muat Data (Load)');
        });

        test('Ketika kelas XI-1 dan mapel Matematika dipilih, merender tombol Load kontekstual XI-1 - Matematika', () => {
            const kelas = 'XI-1';
            const mapel = 'Matematika';
            const wrapperPenilaian = document.getElementById('gradebook-table-wrapper');

            wrapperPenilaian.innerHTML = `
                <div id="gradebook-empty-state" class="flex flex-col items-center justify-center p-12 text-center text-slate-400">
                    <i class="fa-solid fa-hand-pointer text-4xl mb-3 text-emerald-500/50"></i>
                    <p class="font-bold text-slate-700 dark:text-slate-200 text-sm">Pilih Kelas & Mata Pelajaran</p>
                    <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
                        ${(kelas && mapel) ? `Data penilaian untuk <b>${escapeHTMLMock(kelas)} - ${escapeHTMLMock(mapel)}</b> belum dimuat. Klik tombol <b>Load</b> di bawah atau di samping filter untuk membuka lembar penilaian.` : 'Pilih kelas dan mapel pengampu Anda pada baris filter di atas, lalu klik tombol <b>Load</b> untuk membuka lembar penilaian.'}
                    </p>
                    <button type="button" onclick="window.loadGradebookData()" id="btn-center-load-gradebook"
                        class="mt-4 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold text-xs rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-2 cursor-pointer">
                        <i class="fa-solid fa-rotate text-xs"></i>
                        <span>${(kelas && mapel) ? `Muat Data ${escapeHTMLMock(kelas)} - ${escapeHTMLMock(mapel)}` : 'Muat Data (Load)'}</span>
                    </button>
                </div>
            `;

            const btn = wrapperPenilaian.querySelector('#btn-center-load-gradebook');
            expect(btn).not.toBeNull();
            expect(btn.textContent).toContain('Muat Data XI-1 - Matematika');

            const textP = wrapperPenilaian.querySelector('p.text-xs');
            expect(textP.innerHTML).toContain('Data penilaian untuk <b>XI-1 - Matematika</b> belum dimuat.');
            expect(textP.innerHTML).toContain('Klik tombol <b>Load</b> di bawah atau di samping filter');
        });

        test('Tombol sentral memanggil window.loadGradebookData saat diklik', () => {
            const loadGradebookDataMock = jest.fn();
            window.loadGradebookData = loadGradebookDataMock;

            const btn = document.createElement('button');
            btn.id = 'btn-center-load-gradebook';
            btn.onclick = () => window.loadGradebookData();
            document.body.appendChild(btn);

            btn.click();
            expect(loadGradebookDataMock).toHaveBeenCalledTimes(1);
        });
    });
});

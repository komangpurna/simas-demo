/** @jest-environment jsdom */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Execute the production entry point without booting Firebase or the page's listeners.
const source = fs.readFileSync(path.join(__dirname, '../js/page-guru-mapel.js'), 'utf8');
const start = source.indexOf('window.printGradebookAnalytics = async function ()');
const alias = 'window.printLegerAndAnalytics = window.printGradebookAnalytics;';
if (start < 0 || source.indexOf(alias, start) < 0) throw new Error('Print entry point missing');
const printSource = source.slice(start, source.indexOf(alias, start) + alias.length);

describe('Guru Mapel: generated A4 print document', () => {
    let context, popup, browser;
    const cells = row => [...row.cells].map(cell => cell.textContent.trim());
    const table = doc => doc.querySelector('table.table-clean');
    const metric = (doc, label) => [...doc.querySelectorAll('.analysis-section table tr')]
        .find(row => row.cells[1]?.textContent.trim() === label)?.cells[2].textContent.trim();

    beforeEach(() => {
        document.body.innerHTML = `
            <input id="select-mapel" value="Matematika">
            <input id="select-kelas" value="X A">
            <input id="select-semester" value="1">
            <span id="header-guru-name">Ibu Guru</span>
            <table><tbody id="gradebook-tbody"></tbody></table>`;
        popup = {
            document: { write: jest.fn(), close: jest.fn() },
            close: jest.fn(), closed: false
        };
        browser = { open: jest.fn(() => popup), location: { href: 'https://school.test/guru-mapel.html' } };
        context = {
            window: browser, document, URL, Date,
            loadedStudents: [{ nis: '001', name: 'Ayu' }, { nis: '002', name: 'Budi' }, { nis: '003', name: 'Citra' }],
            activeColumns: [{ key: 't1', label: 'Tugas 1', type: 'tugas' }, { key: 'sas', label: 'SAS', type: 'sas' }],
            existingScoresMap: { '001': { t1: 80, sas: 90 }, '002': { t1: 0, sas: 50 } },
            existingSummariesMap: {
                '001': { tugas_avg: 80, sumatif_avg: 90, final_score: 85 },
                '002': { tugas_avg: 0, sumatif_avg: 50, final_score: 25 }
            },
            kkmValue: 75, raporConfig: { tahun_ajaran_aktif: '2026/2027' },
            allTeachers: [{ nama: 'Ibu Guru', nip: '12345' }],
            SCHOOL_CONFIG: { kopPath: 'assets/kop.png', schoolCity: 'Abang', headmasterName: 'Kepala Sekolah', headmasterNIP: '98765', headmasterRank: 'Pembina' },
            isPerhotelanMapel: name => name === 'Perhotelan',
            resolveAssignedTeacherForClassAndMapel: jest.fn().mockResolvedValue({ name: 'Ibu Guru' }),
            getTeacherRealName: jest.fn().mockResolvedValue('Guru Login'),
            getCurrentAcademicYearString: jest.fn(() => '2026/2027'),
            currentUser: {}, auth: { currentUser: {} },
            showToast: jest.fn(), Swal: { fire: jest.fn() }
        };
        vm.runInNewContext(printSource, context);
    });

    async function render() {
        await browser.printGradebookAnalytics();
        expect(popup.document.write).toHaveBeenCalledTimes(1);
        expect(popup.document.close).toHaveBeenCalledTimes(1);
        return new DOMParser().parseFromString(popup.document.write.mock.calls[0][0], 'text/html');
    }

    test('prints the actual roster, scores, five recap rows, analysis and signatures in compact A4 layout', async () => {
        const doc = await render();
        expect(browser.printLegerAndAnalytics).toBe(browser.printGradebookAnalytics);
        expect(doc.title).toBe('Leger Nilai & Laporan Analisis - Matematika X A');
        expect(doc.querySelector('.kop-img').getAttribute('src')).toBe('https://school.test/assets/kop.png');
        const meta = doc.querySelector('.meta-table');
        expect([...meta.rows].map(row => row.cells.length)).toEqual([9, 9]);
        expect([...meta.querySelectorAll('.meta-val')].map(cell => cell.textContent)).toEqual([
            'Matematika', 'X A', '75', 'Semester 1', '2026/2027', 'Ibu Guru'
        ]);
        const ledger = table(doc);
        expect([...ledger.tBodies[0].rows].map(cells)).toEqual([
            ['1', '001', 'Ayu', '80', '90', '80', '90', '85', 'Tuntas'],
            ['2', '002', 'Budi', '0', '50', '0', '50', '25', 'Remedial'],
            ['3', '003', 'Citra', '-', '-', '-', '-', '-', '-']
        ]);
        expect([...ledger.tFoot.rows].map(row => cells(row).slice(1, 6))).toEqual([
            ['40', '70', '40', '70', '55'], ['80', '90', '80', '90', '85'],
            ['0', '50', '0', '50', '25'], ['1', '1', '1', '1', '1'], ['1', '1', '1', '1', '1']
        ]);
        expect(doc.querySelector('.page-break').previousElementSibling).toBe(ledger);
        expect(doc.querySelectorAll('.analysis-section')).toHaveLength(4);
        expect(doc.querySelector('.sign-container').textContent).toContain('NIP. 12345');
        expect(doc.querySelector('.sign-container').textContent).toContain('NIP. 98765');
        const css = doc.querySelector('style').textContent;
        expect(css).toMatch(/@page\s*{\s*size: A4 portrait;\s*margin: 4mm 7mm 4mm 7mm;/);
        expect(css).toContain('max-height: 95px;');
        expect(css).toContain('page-break-before: always;');
        expect(css).toContain('padding: 1.5px 2.5px;');
        expect(context.resolveAssignedTeacherForClassAndMapel).not.toHaveBeenCalled();
    });

    test('emits a valid executable print script that focuses and prints after load', async () => {
        const doc = await render();
        expect(doc.scripts).toHaveLength(1);
        const printedWindow = { focus: jest.fn(), print: jest.fn() };
        const timeout = jest.fn();
        vm.runInNewContext(doc.scripts[0].textContent, { window: printedWindow, setTimeout: timeout });
        expect(printedWindow.print).not.toHaveBeenCalled();
        printedWindow.onload();
        expect(timeout).toHaveBeenCalledWith(expect.any(Function), 350);
        timeout.mock.calls[0][0]();
        expect(printedWindow.focus).toHaveBeenCalledTimes(1);
        expect(printedWindow.print).toHaveBeenCalledTimes(1);
    });

    test.each(['select-kelas', 'select-mapel', 'roster'])('guards missing %s before opening a popup or resolving a teacher', async missing => {
        if (missing === 'roster') context.loadedStudents.length = 0;
        else document.getElementById(missing).value = '';
        await browser.printGradebookAnalytics();
        expect(browser.open).not.toHaveBeenCalled();
        expect(context.resolveAssignedTeacherForClassAndMapel).not.toHaveBeenCalled();
        expect(context.showToast).toHaveBeenCalledWith('Peringatan', expect.stringContaining('Muat Siswa'), 'warning');
    });

    test.each([true, false])('handles a blocked popup with Swal available=%s', async withSwal => {
        browser.open.mockReturnValue(null);
        document.getElementById('header-guru-name').textContent = 'Loading...';
        if (!withSwal) delete context.Swal;
        await expect(browser.printGradebookAnalytics()).resolves.toBeUndefined();
        expect(context.resolveAssignedTeacherForClassAndMapel).not.toHaveBeenCalled();
        expect(popup.document.write).not.toHaveBeenCalled();
        expect(popup.document.close).not.toHaveBeenCalled();
        if (withSwal) expect(context.Swal.fire).toHaveBeenCalledWith(expect.objectContaining({ title: 'Pop-up Terblokir', icon: 'warning' }));
        else expect(context.showToast).toHaveBeenCalledWith('Pop-up Terblokir', expect.any(String), 'warning');
    });

    test('reserves the popup synchronously before asynchronous teacher lookup', async () => {
        document.getElementById('header-guru-name').textContent = 'Loading...';
        let resolveTeacher;
        context.resolveAssignedTeacherForClassAndMapel.mockImplementation(() => new Promise(resolve => { resolveTeacher = resolve; }));
        const pending = browser.printGradebookAnalytics();
        expect(browser.open).toHaveBeenCalledTimes(1);
        expect(popup.document.write).not.toHaveBeenCalled();
        resolveTeacher({ name: 'Ibu Guru' });
        await pending;
        expect(popup.document.write).toHaveBeenCalledTimes(1);
    });

    test('closes the reserved popup and reports failed teacher lookup', async () => {
        document.getElementById('header-guru-name').textContent = 'Loading...';
        context.resolveAssignedTeacherForClassAndMapel.mockRejectedValue(new Error('offline'));
        await expect(browser.printGradebookAnalytics()).resolves.toBeUndefined();
        expect(popup.close).toHaveBeenCalledTimes(1);
        expect(popup.document.write).not.toHaveBeenCalled();
        expect(context.showToast).toHaveBeenCalledWith('Gagal Mencetak', expect.any(String), 'error');
    });

    test('uses edited DOM scores and intentionally cleared cells without resurrecting saved values', async () => {
        document.getElementById('gradebook-tbody').innerHTML = `<tr data-nis="001">
            <td><input data-col-key="t1" value="0"><input data-col-key="sas" value=""></td>
            <td class="cell-tugas-avg">0</td><td class="cell-sumatif-avg">-</td><td class="cell-final-score">-</td></tr>`;
        const doc = await render();
        expect(cells(table(doc).tBodies[0].rows[0])).toEqual(['1', '001', 'Ayu', '0', '-', '0', '-', '-', '-']);
    });

    test('keeps null, blank and invalid cached grades unassessed rather than marking them zero or passed', async () => {
        const invalid = [null, '', 'invalid'];
        context.loadedStudents.forEach((s, i) => {
            context.existingScoresMap[s.nis] = { t1: invalid[i], sas: Infinity };
            context.existingSummariesMap[s.nis] = { tugas_avg: invalid[i], sumatif_avg: ' ', final_score: invalid[i] };
        });
        const doc = await render();
        for (const row of table(doc).tBodies[0].rows) expect(cells(row).slice(3)).toEqual(['-', '-', '-', '-', '-', '-']);
        expect(doc.body.textContent).toContain('BELUM ADA NILAI');
        expect(doc.body.textContent).not.toContain('Seluruh peserta didik (3 Siswa) telah tuntas');
        expect(metric(doc, 'Peserta Didik Remidial (< KKM)')).toBe('0 Siswa (0%)');
        expect(doc.body.textContent).toContain('3 siswa belum memiliki nilai akhir');
    });

    test('reports remedial percentage from actual remedial students and distinguishes ungraded students', async () => {
        const doc = await render();
        expect(metric(doc, 'Ketuntasan Belajar (≥ KKM)')).toBe('1 Siswa (33%)');
        expect(metric(doc, 'Peserta Didik Remidial (< KKM)')).toBe('1 Siswa (33%)');
        expect(doc.body.textContent).toContain('1 siswa belum memiliki nilai akhir');
        context.existingSummariesMap['002'].final_score = 80;
        const pending = browser.printGradebookAnalytics();
        await pending;
        const partial = new DOMParser().parseFromString(popup.document.write.mock.calls[1][0], 'text/html');
        expect(partial.body.textContent).not.toContain('Seluruh peserta didik (3 Siswa) telah tuntas');
    });

    test('preserves real zero averages and prints the all-passed message only when every student passed', async () => {
        context.loadedStudents.splice(1);
        context.existingScoresMap['001'] = { t1: 0, sas: 0 };
        context.existingSummariesMap['001'] = { tugas_avg: 0, sumatif_avg: 0, final_score: 0 };
        const doc = await render();
        for (const label of ['Rata-Rata Nilai Tugas (Formatif)', 'Rata-Rata Nilai Sumatif (Lingkup Materi)', 'Rata-Rata Nilai SAS', 'Rata-Rata Nilai Akhir (NA) Rombel']) {
            expect(metric(doc, label)).toBe('0');
        }
        context.existingSummariesMap['001'].final_score = 75;
        await browser.printGradebookAnalytics();
        expect(popup.document.write.mock.calls[1][0]).toContain('Seluruh peserta didik (1 Siswa) telah tuntas');
    });

    test('escapes user-controlled text in metadata, gradebook, recommendations and signatures', async () => {
        const payload = '<img src=x onerror="alert(1)"> & \'quoted\'';
        document.getElementById('select-mapel').value = payload;
        document.getElementById('header-guru-name').textContent = payload;
        context.loadedStudents[0].name = payload;
        context.activeColumns[0].label = payload;
        context.SCHOOL_CONFIG.headmasterName = payload;
        context.SCHOOL_CONFIG.kopPath = 'assets/kop.png?label=" onload="alert(1)';
        const doc = await render();
        expect(doc.querySelector('.meta-val').textContent).toBe(payload);
        expect(table(doc).tBodies[0].rows[0].cells[2].textContent).toBe(payload);
        expect(doc.querySelector('.sign-name').textContent).toBe(payload);
        expect(doc.querySelectorAll('img')).toHaveLength(1);
        expect(doc.querySelector('[onload]')).toBeNull();
        expect(doc.scripts).toHaveLength(1);
    });

    test('keeps Perhotelan report-grade column and recap aligned, including zero and fallback grades', async () => {
        document.getElementById('select-mapel').value = 'Perhotelan';
        document.getElementById('select-semester').value = '2';
        context.existingSummariesMap['001'].nilai_rapor = 0;
        const doc = await render();
        const ledger = table(doc);
        expect(cells(ledger.tHead.rows[0])).toContain('NILAI RAPOR');
        expect([...ledger.tBodies[0].rows].map(row => row.cells[8].textContent.trim())).toEqual(['0', '25', '-']);
        for (const row of [...ledger.tBodies[0].rows, ...ledger.tFoot.rows]) {
            expect([...row.cells].reduce((sum, cell) => sum + cell.colSpan, 0)).toBe(ledger.tHead.rows[0].cells.length);
        }
        expect(doc.body.textContent).toContain('Sumatif Akhir Tahun (SAT)');
    });
});

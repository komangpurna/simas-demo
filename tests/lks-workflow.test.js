const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const clone = value => value == null ? null : JSON.parse(JSON.stringify(value));
const books = [
    { grade: 10, subject: 'Matematika', harga: 17000, terima: 10, terjual: 0, diam: 0, sisa: 10, isActive: true },
    { grade: 10, subject: "Seni O'Bali", harga: 15000, terima: 10, terjual: 0, diam: 0, sisa: 10, isActive: true }
];
function store() {
    const data = new Map([['book_sales_lks_data', { books: clone(books), transactions: [], circulations: [], cashFlows: [], vendors: [] }]]);
    return {
        data, failRead: false, failWrite: '', delay: 0,
        async getSystemSetting(key) {
            if (this.failRead) throw new Error('Disconnected');
            return clone(data.get(key));
        },
        async saveSystemSetting(key, payload) {
            if (this.delay) await new Promise(resolve => setTimeout(resolve, this.delay));
            if (this.failWrite === key) throw new Error('Disconnected');
            data.set(key, clone(payload));
            return { success: true };
        },
        enabled: true
    };
}

async function page(kind, server, role = kind === 'pesan-lks' ? 'admin_kelas' : 'admin_lks', assignedClass = 'X-1', mockSchedule = null) {
    const html = fs.readFileSync(path.resolve(__dirname, `../${kind}.html`), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true });
    const win = dom.window;
    const notices = [];
    let authCallback;
    win.localStorage.setItem('user_role', role);
    win.localStorage.setItem('user_name', 'Penguji');
    win.confirm = () => true;
    win.hasRole = target => target === role;
    win.getCurrentUserDoc = async () => ({ role, assignedClass });
    win.getActiveClasses = async () => ['X-1', 'X-2', 'XI-1', 'XI-4'];
    win.getStudentsByClass = async () => [
        { nis: '100', name: "I Made O'Brian", class: assignedClass },
        { nis: '101', name: 'Ni Luh Ayu', class: assignedClass }
    ];
    Object.assign(win, {
        cfClient: server, auth: {}, SCHOOL_CONFIG: {},
        onAuthStateChanged: (_, callback) => { authCallback = callback; },
        initLayout: async () => {},
        showToast: (...args) => notices.push(args),
        escapeHTML: value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])),
        formatDateIndo: () => '13 Oktober 2026',
        parseASCSchedule: async () => mockSchedule
    });
    const source = fs.readFileSync(path.resolve(__dirname, `../js/page-${kind}.js`), 'utf8')
        .replace(/^import\s+[^;]+;?/gm, '')
        .replace(/export\s+(const|let|var|function|class|async\s+function)\s+/gm, '$1 ')
        .replace(/document.addEventListener\('DOMContentLoaded', \w+\);/g, '');
    vm.runInContext(source, dom.getInternalVMContext());
    await win[kind === 'pesan-lks' ? 'initPesanLksPage' : 'initPenjualanBukuPage']();
    await authCallback({ uid: 'tester', displayName: 'Penguji' });
    return { win, dom, notices, element: id => win.document.getElementById(id), close: () => dom.window.close() };
}

describe('Alur LKS pada DOM halaman asli, dua perangkat dengan server bersama', () => {
    let server;
    const pages = [];
    const open = async (...args) => { const result = await page(...args); pages.push(result); return result; };
    beforeEach(() => { server = store(); });
    afterEach(() => { pages.splice(0).forEach(p => p.close()); });

    test('siswa melalui admin kelas: centang, kirim, admin catat bertahap, tagihan dan stok konsisten', async () => {
        const student = await open('pesan-lks', server);
        const mathStock = () => [...student.element('lks-stock-list').children].find(item => item.textContent.includes('Matematika'));
        expect(mathStock().textContent).toContain('10 eks');
        student.win.onMatrixOrderCheckChanged('100', "I Made O'Brian", 'Matematika', true);
        student.win.onMatrixOrderCheckChanged('101', 'Ni Luh Ayu', 'Matematika', true);
        await student.win.executeSubmitMatrixOrder();
        expect(student.win.isMatrixOrderDirty()).toBe(false);
        expect(mathStock().textContent).toContain('10 eks');
        student.win.switchTab('matrix-rekap');
        expect(student.element('table-rekap-body').textContent).toContain('Rp 17.000');
        const admin = await open('penjualan-buku', server);
        expect(admin.win.localStorage.getItem('simas_book_orders_data')).toBeNull();
        admin.win.switchTab('orders');
        expect(admin.element('table-orders-body').textContent).toContain('Kurang 2 eks');
        const order = server.data.get('book_orders_data').orders[0];
        await admin.win.quickFulfillOrderTransaction(order.id);
        expect(admin.element('tx-class').value).toBe('X-1');
        expect(admin.element('tx-subject').value).toBe('Matematika');
        expect(admin.element('tx-qty').value).toBe('2');
        admin.element('tx-qty').value = '1';
        await admin.win.submitAddTransaction();
        expect(admin.element('table-orders-body').textContent).toContain('Kurang 1 eks');
        await admin.win.quickFulfillOrderTransaction(order.id);
        await admin.win.submitAddTransaction();
        expect(admin.element('table-orders-body').textContent).toContain('Seluruh Pesanan Kelas Sudah Terpenuhi');
        expect(server.data.get('book_sales_lks_data').transactions).toHaveLength(2);
        expect(server.data.get('book_sales_lks_data').books[0].sisa).toBe(8);
        student.win.localStorage.setItem('simas_book_sales_lks_data', JSON.stringify({ books }));
        student.element('btn-refresh').click();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(mathStock().textContent).toContain('8 eks');
        student.win.switchTab('matrix-order');
        student.win.setViewMode('cards');
        expect(mathStock().textContent).toContain('8 eks');
        await admin.win.quickFulfillOrderTransaction(order.id);
        expect(admin.element('modal-add-transaction').classList.contains('hidden')).toBe(true);
    });

    test('ringkasan stok menampilkan nol, menghitung data lama, dan mengikuti jenjang buku aktif', async () => {
        server.data.get('book_sales_lks_data').books = [
            { ...books[0], sisa: 0 },
            { ...books[1], sisa: 1234 },
            { grade: 10, subject: 'Bahasa Indonesia', harga: 17000, terima: '20', diam: '2', retur: '3', terjual: '4' },
            { grade: 10, subject: 'Bahasa Inggris', harga: 17000, terima: 2, terjual: 5 },
            { grade: 10, subject: 'Nonaktif', sisa: 5, isActive: false },
            { grade: 11, subject: 'Matematika', sisa: 7, isActive: true }
        ];
        const student = await open('pesan-lks', server, 'super_admin');
        const entries = () => [...student.element('lks-stock-list').children].map(item => item.textContent.replace(/\s+/g, ' ').trim());
        expect(student.element('lks-stock-grade').textContent).toBe('Kelas X');
        expect(entries()).toHaveLength(4);
        expect(entries()).toEqual(expect.arrayContaining([
            'Matematika 0 eks · Habis', "Seni O'Bali 1.234 eks", 'Bahasa Indonesia 11 eks', 'Bahasa Inggris 0 eks · Habis'
        ]));
        const before = clone(server.data.get('book_sales_lks_data'));
        await student.win.onActiveClassChanged('XI-1');
        expect(student.element('lks-stock-grade').textContent).toBe('Kelas XI');
        expect(entries()).toEqual(['Matematika 7 eks']);
        await student.win.onActiveClassChanged('XII-1');
        expect(student.element('lks-stock-grade').textContent).toBe('Kelas XII');
        expect(student.element('lks-stock-list').textContent).toContain('Belum ada buku LKS aktif');
        expect(server.data.get('book_sales_lks_data')).toEqual(before);
    });

    test('kirim ulang menggantikan pesanan approved/fulfilled tanpa duplikasi dan menjaga kelas lain', async () => {
        server.data.set('book_orders_data', { orders: [
            { id: 'old', orderedBy: { class: 'X-1' }, grade: 'X', bookSubject: 'Matematika', qty: 10, status: 'fulfilled' },
            { id: 'other', orderedBy: { class: 'X-2' }, grade: 10, qty: 5, status: 'approved' }
        ] });
        const student = await open('pesan-lks', server);
        student.win.onMatrixOrderCheckChanged('100', 'Made', 'Matematika', true);
        await student.win.executeSubmitMatrixOrder();
        await student.win.executeSubmitMatrixOrder();
        const orders = server.data.get('book_orders_data').orders;
        expect(orders).toHaveLength(2);
        expect(orders.find(o => o.id === 'other').qty).toBe(5);
        expect(orders.find(o => o.orderedBy.class === 'X-1').qty).toBe(1);
    });

    test('pembatalan seluruh pilihan dapat dikirim dan menghapus kebutuhan pada admin', async () => {
        const student = await open('pesan-lks', server);
        student.win.onMatrixOrderCheckChanged('100', 'Made', 'Matematika', true);
        await student.win.executeSubmitMatrixOrder();
        student.win.onMatrixOrderCheckChanged('100', 'Made', 'Matematika', false);
        student.win.saveMatrixOrders();
        expect(student.element('modal-confirm-matrix').classList.contains('hidden')).toBe(false);
        await student.win.executeSubmitMatrixOrder();
        expect(server.data.get('book_orders_data').orders).toHaveLength(0);
    });

    test.each(['book_matrix_x_1', 'book_orders_data'])('kegagalan simpan %s menjaga draft dan tidak menampilkan sukses', async key => {
        const student = await open('pesan-lks', server);
        student.win.onMatrixOrderCheckChanged('100', 'Made', 'Matematika', true);
        server.failWrite = key;
        await student.win.executeSubmitMatrixOrder();
        expect(student.win.isMatrixOrderDirty()).toBe(true);
        expect(student.notices.some(n => n[0] === 'Berhasil Dikirim')).toBe(false);
        server.failWrite = '';
        await student.win.executeSubmitMatrixOrder();
        expect(server.data.get('book_orders_data').orders).toHaveLength(1);
    });

    test('autosave berurutan, klik kirim ganda dan reload draft tidak menghilangkan perubahan', async () => {
        server.delay = 5;
        const student = await open('pesan-lks', server);
        student.win.onMatrixOrderCheckChanged('100', 'Made', 'Matematika', true);
        await new Promise(resolve => setTimeout(resolve, 20));
        const reload = await open('pesan-lks', server);
        expect(reload.win.isMatrixOrderDirty()).toBe(true);
        await Promise.all([reload.win.executeSubmitMatrixOrder(), reload.win.executeSubmitMatrixOrder()]);
        expect(server.data.get('book_matrix_x_1').dirty).toBe(false);
        expect(server.data.get('book_orders_data').orders).toHaveLength(1);
    });

    test('nama siswa dan mapel berapostrof tetap dapat dicentang melalui event DOM', async () => {
        const student = await open('pesan-lks', server);
        const checkbox = student.element('table-matrix-order-body').querySelectorAll('input[type=checkbox]')[1];
        checkbox.click();
        await student.win.executeSubmitMatrixOrder();
        expect(server.data.get('book_matrix_x_1').matrix['100'].books["Seni O'Bali"].ordered).toBe(true);
    });

    test('penjualan gagal menyimpan: modal dan input tetap terbuka, transaksi/stok dipulihkan, retry aman', async () => {
        const admin = await open('penjualan-buku', server);
        await admin.win.openAddTransactionModal();
        admin.element('tx-qty').value = '2';
        server.failWrite = 'book_sales_lks_data';
        await admin.win.submitAddTransaction();
        expect(admin.win.getCurrentTransactions()).toHaveLength(0);
        expect(admin.win.calcRemainingStock(10, 'Matematika')).toBe(10);
        expect(admin.element('modal-add-transaction').classList.contains('hidden')).toBe(false);
        expect(admin.element('tx-qty').value).toBe('2');
        expect(admin.notices.some(n => n[0] === 'Berhasil')).toBe(false);
        server.failWrite = '';
        await admin.win.submitAddTransaction();
        expect(server.data.get('book_sales_lks_data').transactions).toHaveLength(1);
    });

    test('stok terbatas dan klik simpan ganda tidak menghasilkan penjualan berlebih', async () => {
        const admin = await open('penjualan-buku', server);
        await admin.win.openAddTransactionModal();
        admin.element('tx-qty').value = '11';
        await admin.win.submitAddTransaction();
        expect(admin.win.getCurrentTransactions()).toHaveLength(0);
        admin.element('tx-qty').value = '2';
        server.delay = 10;
        await Promise.all([admin.win.submitAddTransaction(), admin.win.submitAddTransaction()]);
        expect(server.data.get('book_sales_lks_data').transactions).toHaveLength(1);
    });

    test('array transaksi kosong dari server tidak menghidupkan kembali transaksi cache yang sudah dihapus', async () => {
        const admin = await open('penjualan-buku', server);
        admin.win.localStorage.setItem('simas_book_sales_lks_data', JSON.stringify({ books, transactions: [{ id: 'deleted', qty: 9 }], cashFlows: [{ id: 'deleted-cash' }] }));
        await admin.win.loadSavedBookSalesData();
        expect(admin.win.getCurrentTransactions()).toHaveLength(0);
        expect(admin.win.getCurrentCashFlows()).toHaveLength(0);
    });

    test.each([['pesan-lks', 'siswa'], ['pesan-lks', 'admin_lks'], ['penjualan-buku', 'admin_kelas']])('%s menolak role %s', async (kind, role) => {
        const result = await open(kind, server, role);
        expect(result.element('access-denied-container').classList.contains('hidden')).toBe(false);
        expect(result.win.document.querySelector('main').classList.contains('hidden')).toBe(true);
    });

    test('akun admin kelas tanpa penugasan rombel tidak diam-diam memakai X-1', async () => {
        const student = await open('pesan-lks', server, 'admin_kelas', '');
        expect(student.element('access-denied-container').classList.contains('hidden')).toBe(false);
        expect(student.notices.some(n => n[0] === 'Rombel Belum Diatur')).toBe(true);
    });

    test('admin LKS tetap tidak melihat pengaturan setelah pergantian tab, termasuk role tambahan', async () => {
        const admin = await open('penjualan-buku', server);
        admin.win.switchTab('orders');
        expect(admin.element('tab-btn-settings').classList.contains('hidden')).toBe(true);
        admin.win.localStorage.setItem('user_role', 'guru_mapel');
        admin.win.hasRole = role => role === 'guru_mapel' || role === 'admin_lks';
        admin.win.switchTab('cashflow');
        expect(admin.element('cashflow-actions-container').classList.contains('hidden')).toBe(true);
        admin.win.switchTab('settings');
        expect(admin.element('tab-panel-settings').classList.contains('hidden')).toBe(true);
    });

    test('daftar mapel pesan LKS tersinkronisasi jadwal rombel XML (XI-1 tanpa Antropologi, XI-4 ada Antropologi)', async () => {
        const mockSchedule = {
            classesMap: new Map([
                ['c_xi_1', { id: 'c_xi_1', name: 'XI-1' }],
                ['c_xi_4', { id: 'c_xi_4', name: 'XI-4' }]
            ]),
            subjectsMap: new Map([
                ['s_indo', { id: 's_indo', name: 'Bahasa Indonesia' }],
                ['s_fisika', { id: 's_fisika', name: 'Fisika' }],
                ['s_antro', { id: 's_antro', name: 'Antropologi' }],
                ['s_sosio', { id: 's_sosio', name: 'Sosiologi' }]
            ]),
            lessonsMap: new Map([
                ['l1', { id: 'l1', subjectId: 's_indo', classIds: ['c_xi_1'] }],
                ['l2', { id: 'l2', subjectId: 's_fisika', classIds: ['c_xi_1'] }],
                ['l3', { id: 'l3', subjectId: 's_indo', classIds: ['c_xi_4'] }],
                ['l4', { id: 'l4', subjectId: 's_antro', classIds: ['c_xi_4'] }],
                ['l5', { id: 'l5', subjectId: 's_sosio', classIds: ['c_xi_4'] }]
            ])
        };

        const customBooks = [
            { grade: 11, subject: 'Bahasa Indonesia', harga: 17000, terima: 36, terjual: 0, diam: 0, sisa: 36, isActive: true },
            { grade: 11, subject: 'Fisika', harga: 18000, terima: 36, terjual: 0, diam: 0, sisa: 36, isActive: true },
            { grade: 11, subject: 'Antropologi', harga: 18000, terima: 36, terjual: 0, diam: 0, sisa: 36, isActive: true },
            { grade: 11, subject: 'Sosiologi', harga: 18000, terima: 36, terjual: 0, diam: 0, sisa: 36, isActive: false } // Sengaja disembunyikan di Pengaturan
        ];

        server.data.set('book_sales_lks_data', { books: customBooks, transactions: [] });

        // Uji Rombel XI-1
        const pageXI1 = await open('pesan-lks', server, 'admin_kelas', 'XI-1', mockSchedule);
        const xi1Books = pageXI1.win.getCurrentGradeBooks();
        const xi1Subjects = xi1Books.map(b => b.subject);

        expect(xi1Subjects).toContain('Bahasa Indonesia');
        expect(xi1Subjects).toContain('Fisika');
        expect(xi1Subjects).not.toContain('Antropologi'); // Antropologi tidak diajarkan di XI-1
        expect(xi1Subjects).not.toContain('Sosiologi'); // Sosiologi dinonaktifkan di Pengaturan

        const xi1StockText = pageXI1.element('lks-stock-list').textContent;
        expect(xi1StockText).toContain('Fisika');
        expect(xi1StockText).not.toContain('Antropologi');
        expect(xi1StockText).not.toContain('Sosiologi');

        // Uji Rombel XI-4
        const pageXI4 = await open('pesan-lks', server, 'admin_kelas', 'XI-4', mockSchedule);
        const xi4Books = pageXI4.win.getCurrentGradeBooks();
        const xi4Subjects = xi4Books.map(b => b.subject);

        expect(xi4Subjects).toContain('Bahasa Indonesia');
        expect(xi4Subjects).toContain('Antropologi'); // Antropologi diajarkan di XI-4
        expect(xi4Subjects).not.toContain('Fisika'); // Fisika tidak diajarkan di XI-4
        expect(xi4Subjects).not.toContain('Sosiologi'); // Sosiologi disembunyikan di Pengaturan

        const xi4StockText = pageXI4.element('lks-stock-list').textContent;
        expect(xi4StockText).toContain('Antropologi');
        expect(xi4StockText).not.toContain('Fisika');
        expect(xi4StockText).not.toContain('Sosiologi');
    });

    test('buku yang dinonaktifkan di pengaturan (isActive: false) tidak dihitung dalam analisis kebutuhan dan rekapitulasi penjualan', async () => {
        const admin = await open('penjualan-buku', server);
        const testBooks = [
            { id: 'b1', grade: 11, subject: 'Fisika', harga: 18000, terima: 36, terjual: 10, total: 180000, isActive: true },
            { id: 'b2', grade: 11, subject: 'Antropologi', harga: 18000, terima: 36, terjual: 5, total: 90000, isActive: true },
            { id: 'b3', grade: 11, subject: 'Sosiologi', harga: 18000, terima: 36, terjual: 0, total: 0, isActive: false }
        ];

        // Verifikasi calculateBooksDemandAnalysis menyaring isActive !== false
        const demand = admin.win.calculateBooksDemandAnalysis(testBooks, { 'XI-1': 36, 'XI-4': 36 }, null);
        const demandSubjects = demand.items.map(i => i.subject);
        expect(demandSubjects).toContain('Fisika');
        expect(demandSubjects).toContain('Antropologi');
        expect(demandSubjects).not.toContain('Sosiologi');

        // Verifikasi getBooksWithPeriodSales menyaring isActive !== false
        const periodSales = admin.win.getBooksWithPeriodSales(testBooks, [], 'all');
        const periodSubjects = periodSales.map(b => b.subject);
        expect(periodSubjects).toContain('Fisika');
        expect(periodSubjects).toContain('Antropologi');
        expect(periodSubjects).not.toContain('Sosiologi');
    });
});

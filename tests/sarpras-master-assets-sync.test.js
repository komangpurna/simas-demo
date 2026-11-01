/**
 * tests/sarpras-master-assets-sync.test.js
 *
 * Pengujian unit Jest untuk penyelarasan modul Sarpras SMAGESA & Sukawati:
 * 1. Kontrak tabel dan endpoint SSOT (/api/sarpras/master-assets/* & /api/sarpras/smsr/*)
 * 2. Logika validasi kuantitas ketersediaan peminjaman atomik (loanAvailabilityCte)
 * 3. Matriks transisi status peminjaman yang diizinkan (loanTransitions)
 * 4. Pembuatan tiket pemeliharaan dari aduan dan riwayat linimasa (sarpras_report_history)
 */

/**
 * tests/sarpras-master-assets-sync.test.js
 *
 * Pengujian unit Jest untuk penyelarasan modul Sarpras SMAGESA & Sukawati:
 * 1. Kontrak tabel dan endpoint SSOT (/api/sarpras/master-assets/* & /api/sarpras/smsr/*)
 * 2. Logika validasi kuantitas ketersediaan peminjaman atomik (loanAvailabilityCte)
 * 3. Matriks transisi status peminjaman yang diizinkan (loanTransitions)
 * 4. Pembuatan tiket pemeliharaan dari aduan dan riwayat linimasa (sarpras_report_history)
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadWorkerLibModule } = require('./helpers/worker-source.cjs');

describe('Penyelarasan Modul Sarpras (Master Aset, Pinjam Kuantitas, Aduan & Pemeliharaan)', () => {
    let contractModule;
    let loansModule;

    beforeAll(() => {
        // Muat sarpras-loans.js lewat helper isolasi VM
        loansModule = loadWorkerLibModule('lib/sarpras-loans.js');

        // Muat sarpras-storage-contract.mjs lewat VM context
        const contractPath = path.resolve(__dirname, '../js/sarpras-storage-contract.mjs');
        const contractSource = fs.readFileSync(contractPath, 'utf8')
            .replace(/export\s+const\s+/g, 'const ')
            .replace(/export\s+function\s+/g, 'function ');
        const ctx = vm.createContext({});
        vm.runInContext(contractSource + '; this.__contract = { MASTER_SARPRAS_TABLES, SMSR_SARPRAS_TABLES, MASTER_SARPRAS_API, SMSR_SARPRAS_API };', ctx);
        contractModule = ctx.__contract;
    });

    test('1. Kontrak Penyimpanan & API Master Sarpras Terpadu', () => {
        const { MASTER_SARPRAS_TABLES, MASTER_SARPRAS_API, SMSR_SARPRAS_API } = contractModule;
        expect(MASTER_SARPRAS_API).toBe('/api/sarpras/master-assets');
        expect(SMSR_SARPRAS_API).toBe('/api/sarpras/smsr');

        expect(MASTER_SARPRAS_TABLES).toHaveProperty('sarpras_tanah');
        expect(MASTER_SARPRAS_TABLES).toHaveProperty('sarpras_bangunan');
        expect(MASTER_SARPRAS_TABLES).toHaveProperty('sarpras_barang');
        expect(MASTER_SARPRAS_TABLES).toHaveProperty('sarpras_kelompok_barang');
        expect(MASTER_SARPRAS_TABLES).toHaveProperty('sarpras_jenis_bantuan');
        expect(MASTER_SARPRAS_TABLES).toHaveProperty('sarpras_peminjaman');
        expect(MASTER_SARPRAS_TABLES).toHaveProperty('sarpras_permintaan');
        expect(MASTER_SARPRAS_TABLES).toHaveProperty('sarpras_perbaikan');

        expect(MASTER_SARPRAS_TABLES.sarpras_tanah).toContain('luas');
        expect(MASTER_SARPRAS_TABLES.sarpras_bangunan).toContain('jumlah_ruang');
        expect(MASTER_SARPRAS_TABLES.sarpras_barang).toContain('jumlah_tersedia');
    });

    test('2. Validasi Peminjaman & Ketersediaan Kuantitas Atomik', () => {
        const { loanAvailabilityCte, validateSarprasLoan, loanTransitions } = loansModule;

        // Tipe tidak valid
        expect(validateSarprasLoan({ loanType: 'vehicle', targetId: '1', startTime: '2026-10-29T08:00', endTime: '2026-10-29T10:00', quantity: 1 }))
            .toContain('Pilih ruangan atau barang');

        // Jumlah ruangan lebih dari 1 ditolak
        expect(validateSarprasLoan({ loanType: 'room', targetId: 'room-1', startTime: '2026-10-29T08:00', endTime: '2026-10-29T10:00', quantity: 2 }))
            .toContain('Jumlah peminjaman tidak valid');

        // Jumlah barang kurang dari 1 ditolak
        expect(validateSarprasLoan({ loanType: 'item', targetId: 'item-1', startTime: '2026-10-29T08:00', endTime: '2026-10-29T10:00', quantity: 0 }))
            .toContain('Jumlah peminjaman tidak valid');

        // Waktu selesai sebelum atau sama dengan waktu mulai ditolak
        expect(validateSarprasLoan({ loanType: 'item', targetId: 'item-1', startTime: '2026-10-29T10:00', endTime: '2026-10-29T08:00', quantity: 1 }))
            .toContain('Waktu selesai harus setelah waktu mulai');

        // Data valid
        expect(validateSarprasLoan({ loanType: 'item', targetId: 'item-1', startTime: '2026-10-29T08:00', endTime: '2026-10-29T10:00', quantity: 5 }))
            .toBe('');

        // CTE & transisi
        expect(loanAvailabilityCte).toContain('WITH request(loan_type, target_id, start_time, end_time, quantity, exclude_id)');
        expect(loanAvailabilityCte).toContain('COALESCE(SUM(COALESCE(o.quantity, 1)), 0)');

        expect(loanTransitions.pending).toEqual({ approve: 'approved', reject: 'rejected', cancel: 'cancelled' });
        expect(loanTransitions.approved).toEqual({ borrow: 'borrowed', cancel: 'cancelled' });
        expect(loanTransitions.borrowed).toEqual({ return: 'returned' });
    });

    test('3. Paritas Frontend Sarpras Aduan & Pemeliharaan di SMAGESA', () => {
        const aduanJs = fs.readFileSync(path.resolve(__dirname, '../js/page-sarpras-aduan.js'), 'utf8');
        const aduanHtml = fs.readFileSync(path.resolve(__dirname, '../sarpras-aduan.html'), 'utf8');

        expect(aduanJs).toContain('window.createReportMaintenance');
        expect(aduanHtml).toContain('detail-maintenance-progress');
        expect(aduanHtml).toContain('detail-report-history');
    });

    test('4. Paritas Sarpras Inventaris Tab Switcher & Master Aset di SMAGESA', () => {
        const inventarisHtml = fs.readFileSync(path.resolve(__dirname, '../sarpras-inventaris.html'), 'utf8');
        const inventarisJs = fs.readFileSync(path.resolve(__dirname, '../js/page-sarpras-inventaris.js'), 'utf8');

        expect(inventarisHtml).toContain('id="sarpras-tab-inventaris"');
        expect(inventarisHtml).toContain('id="sarpras-tab-aset"');
        expect(inventarisHtml).toContain('id="sarpras-smsr-assets-panel"');
        expect(inventarisHtml).toContain('id="modal-container"');
        expect(inventarisHtml).toContain('id="print-modal-container"');

        expect(inventarisJs).toContain('switchSarprasInventoryView');
    });
});

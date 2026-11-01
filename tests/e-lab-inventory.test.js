/**
 * Unit Test: E-Laboratorium Inventaris Barang Tidak Habis Pakai
 * Menguji logika bisnis, kalkulasi stok per kondisi, mutasi kondisi atomik,
 * pembentukan kode inventaris, format zona waktu WITA, serta RBAC multi-lab.
 */

const fs = require('node:fs');
const path = require('node:path');

describe('E-Laboratorium Inventory Business Rules & Logic', () => {

    // =========================================================================
    // 1. KALKULASI KUANTITAS & VALIDASI STOK AWAL
    // =========================================================================
    describe('Kalkulasi Kuantitas Stok per Kondisi', () => {
        const validateAndCalculateTotal = (good, minor, major) => {
            const isNonNegInt = (val) => Number.isInteger(val) && val >= 0;

            if (!isNonNegInt(good) || !isNonNegInt(minor) || !isNonNegInt(major)) {
                return { valid: false, error: 'Kuantitas harus bilangan bulat non-negatif' };
            }

            const total = good + minor + major;
            if (total < 1) {
                return { valid: false, error: 'Total kuantitas barang harus minimal 1 unit' };
            }

            return { valid: true, total };
        };

        test('Menghitung total kuantitas barang dari 3 kondisi dengan benar', () => {
            const res = validateAndCalculateTotal(10, 3, 2);
            expect(res.valid).toBe(true);
            expect(res.total).toBe(15);
        });

        test('Menerima barang jika hanya ada kondisi baik (misal 5, 0, 0)', () => {
            const res = validateAndCalculateTotal(5, 0, 0);
            expect(res.valid).toBe(true);
            expect(res.total).toBe(5);
        });

        test('Menolak jika total unit kurang dari 1 (0 unit)', () => {
            const res = validateAndCalculateTotal(0, 0, 0);
            expect(res.valid).toBe(false);
            expect(res.error).toBe('Total kuantitas barang harus minimal 1 unit');
        });

        test('Menolak kuantitas negatif pada salah satu kondisi', () => {
            expect(validateAndCalculateTotal(-1, 5, 2).valid).toBe(false);
            expect(validateAndCalculateTotal(5, -2, 1).valid).toBe(false);
            expect(validateAndCalculateTotal(5, 2, -1).valid).toBe(false);
        });

        test('Menolak angka desimal / pecahan', () => {
            expect(validateAndCalculateTotal(2.5, 1, 0).valid).toBe(false);
            expect(validateAndCalculateTotal(2, 1.25, 0).valid).toBe(false);
        });

        test('Menolak tipe data non-angka atau NaN', () => {
            expect(validateAndCalculateTotal(NaN, 1, 0).valid).toBe(false);
            expect(validateAndCalculateTotal('5', 1, 0).valid).toBe(false);
            expect(validateAndCalculateTotal(null, 1, 0).valid).toBe(false);
        });
    });

    // =========================================================================
    // 2. MUTASI KONDISI ATOMIK (UBAH KONDISI BARANG)
    // =========================================================================
    describe('Validasi & Mutasi Stok Antar Kondisi (Atomik)', () => {
        const executeChangeCondition = (item, fromCond, toCond, qty) => {
            const validConds = ['good', 'minor_damage', 'major_damage'];
            if (!validConds.includes(fromCond) || !validConds.includes(toCond)) {
                return { success: false, error: 'Kondisi tidak valid' };
            }

            if (fromCond === toCond) {
                return { success: false, error: 'Kondisi asal dan kondisi tujuan tidak boleh sama' };
            }

            if (!Number.isInteger(qty) || qty <= 0) {
                return { success: false, error: 'Jumlah mutasi harus bilangan bulat positif (> 0)' };
            }

            const colMap = {
                good: 'qty_good',
                minor_damage: 'qty_minor_damage',
                major_damage: 'qty_major_damage'
            };

            const fromCol = colMap[fromCond];
            const toCol = colMap[toCond];
            const available = item[fromCol] || 0;

            if (qty > available) {
                return {
                    success: false,
                    error: `Jumlah perpindahan (${qty}) melebihi stok yang tersedia (${available})`
                };
            }

            const updated = { ...item };
            updated[fromCol] -= qty;
            updated[toCol] += qty;
            updated.qty_total = updated.qty_good + updated.qty_minor_damage + updated.qty_major_damage;

            return { success: true, updated };
        };

        const mockItem = {
            id: 'item-1',
            qty_good: 10,
            qty_minor_damage: 2,
            qty_major_damage: 1,
            qty_total: 13
        };

        test('Berhasil memindahkan unit dari kondisi baik ke rusak ringan', () => {
            const res = executeChangeCondition(mockItem, 'good', 'minor_damage', 3);
            expect(res.success).toBe(true);
            expect(res.updated.qty_good).toBe(7);
            expect(res.updated.qty_minor_damage).toBe(5);
            expect(res.updated.qty_major_damage).toBe(1);
            expect(res.updated.qty_total).toBe(13);
        });

        test('Berhasil memindahkan unit dari rusak berat ke kondisi baik (misal selesai diservis)', () => {
            const res = executeChangeCondition(mockItem, 'major_damage', 'good', 1);
            expect(res.success).toBe(true);
            expect(res.updated.qty_good).toBe(11);
            expect(res.updated.qty_major_damage).toBe(0);
            expect(res.updated.qty_total).toBe(13);
        });

        test('Menolak mutasi jika from_condition sama dengan to_condition', () => {
            const res = executeChangeCondition(mockItem, 'good', 'good', 2);
            expect(res.success).toBe(false);
            expect(res.error).toBe('Kondisi asal dan kondisi tujuan tidak boleh sama');
        });

        test('Menolak mutasi jika kuantitas melebihi stok kondisi asal', () => {
            const res = executeChangeCondition(mockItem, 'minor_damage', 'major_damage', 5);
            expect(res.success).toBe(false);
            expect(res.error).toContain('melebihi stok yang tersedia');
        });

        test('Menolak mutasi jika kuantitas 0 atau negatif', () => {
            expect(executeChangeCondition(mockItem, 'good', 'minor_damage', 0).success).toBe(false);
            expect(executeChangeCondition(mockItem, 'good', 'minor_damage', -2).success).toBe(false);
        });
    });

    // =========================================================================
    // 3. GENERATOR KODE INVENTARIS
    // =========================================================================
    describe('Format & Penomoran Kode Inventaris Otomatis', () => {
        const generateCode = (labKode, catKode, year, seq) => {
            const cleanLab = String(labKode || 'LAB').toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 4) || 'LAB';
            const cleanCat = String(catKode || 'ITM').toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 4) || 'ITM';
            const cleanYear = parseInt(year, 10) || new Date().getFullYear();
            const seqStr = String(seq).padStart(3, '0');
            return `LAB-${cleanLab}-${cleanCat}-${cleanYear}-${seqStr}`;
        };

        test('Menghasilkan format kode standar: LAB-{LAB}-{CAT}-{YEAR}-{SEQ:001}', () => {
            const code = generateCode('BIO', 'OPT', 2026, 1);
            expect(code).toBe('LAB-BIO-OPT-2026-001');
        });

        test('Melakukan padding 3 digit untuk nomor sequence di bawah 100', () => {
            expect(generateCode('KOMP', 'NET', 2026, 7)).toBe('LAB-KOMP-NET-2026-007');
            expect(generateCode('KOMP', 'NET', 2026, 25)).toBe('LAB-KOMP-NET-2026-025');
            expect(generateCode('KOMP', 'NET', 2026, 128)).toBe('LAB-KOMP-NET-2026-128');
        });

        test('Membersihkan karakter ilegal dan membatasi panjang kode lab/kategori', () => {
            const code = generateCode('bi-o#123', 'opt!cal', 2026, 1);
            expect(code).toBe('LAB-BIO1-OPTC-2026-001');
        });
    });

    // =========================================================================
    // 4. OTORISASI & ISOLASI AKSES MULTI-LAB (RBAC)
    // =========================================================================
    describe('Otorisasi Multi-Lab & RBAC Pengelolaan Inventaris', () => {
        const verifyAccess = (user, lab, action = 'read') => {
            if (!user) return { allowed: false, status: 401 };

            const allRoles = [user.role, ...(user.additionalRoles || [])].filter(Boolean);
            const isSuperOrAdmin = allRoles.some(r => ['super_admin', 'admin', 'superadmin', 'developer'].includes(r));
            const isKepalaLab = allRoles.includes('kepala_lab');

            // Super Admin & Kepala Lab memiliki akses penuh ke seluruh lab untuk operasi apapun
            if (isSuperOrAdmin || isKepalaLab) {
                return { allowed: true, status: 200, role: isSuperOrAdmin ? 'admin' : 'kepala_lab' };
            }

            if (!lab) return { allowed: false, status: 404 };

            // Read-only diizinkan untuk semua guru/staf terautentikasi
            if (action === 'read') {
                return { allowed: true, status: 200, role: 'viewer' };
            }

            // Write: Koordinator hanya berwenang untuk lab tugasnya
            const isCoordinator = Boolean(
                lab && (
                    (lab.koordinator_uid && lab.koordinator_uid === user.uid) ||
                    (lab.kepala_lab_uid && lab.kepala_lab_uid === user.uid)
                )
            );

            if (isCoordinator) {
                return { allowed: true, status: 200, role: 'koordinator' };
            }

            return {
                allowed: false,
                status: 403,
                error: 'Forbidden: Anda tidak memiliki wewenang mengelola laboratorium ini'
            };
        };

        const superAdmin = { uid: 'sa-01', role: 'super_admin' };
        const kepalaLab = { uid: 'kl-global', role: 'guru', additionalRoles: ['kepala_lab'] };
        const koordinatorBio = { uid: 'koor-bio', role: 'guru' };
        const koordinatorFis = { uid: 'koor-fis', role: 'guru' };
        const guruBiasa = { uid: 'guru-01', role: 'guru_mapel' };

        const labBiologi = { id: 'lab-bio', nama: 'Laboratorium Biologi', koordinator_uid: 'koor-bio' };
        const labFisika = { id: 'lab-fis', nama: 'Laboratorium Fisika', koordinator_uid: 'koor-fis' };
        const labUmum = { id: 'lab-gen', nama: 'Laboratorium Umum', koordinator_uid: null };

        test('Super Admin diizinkan write ke seluruh laboratorium', () => {
            expect(verifyAccess(superAdmin, labBiologi, 'write').allowed).toBe(true);
            expect(verifyAccess(superAdmin, labFisika, 'write').allowed).toBe(true);
        });

        test('Kepala Lab diizinkan write ke seluruh laboratorium (Biologi, Fisika, Umum)', () => {
            expect(verifyAccess(kepalaLab, labBiologi, 'write').allowed).toBe(true);
            expect(verifyAccess(kepalaLab, labFisika, 'write').allowed).toBe(true);
            expect(verifyAccess(kepalaLab, labUmum, 'write').allowed).toBe(true);
        });

        test('Koordinator Biologi diizinkan write ke Lab Biologi tugasnya', () => {
            const res = verifyAccess(koordinatorBio, labBiologi, 'write');
            expect(res.allowed).toBe(true);
            expect(res.role).toBe('koordinator');
        });

        test('Koordinator Biologi DITOLAK (403) saat mencoba write ke Lab Fisika', () => {
            const res = verifyAccess(koordinatorBio, labFisika, 'write');
            expect(res.allowed).toBe(false);
            expect(res.status).toBe(403);
            expect(res.error).toContain('tidak memiliki wewenang mengelola');
        });

        test('Guru biasa diizinkan read inventaris tetapi ditolak saat write', () => {
            expect(verifyAccess(guruBiasa, labBiologi, 'read').allowed).toBe(true);
            const writeRes = verifyAccess(guruBiasa, labBiologi, 'write');
            expect(writeRes.allowed).toBe(false);
            expect(writeRes.status).toBe(403);
        });
    });

    // =========================================================================
    // 5. FORMAT WAKTU WITA (Asia/Makassar)
    // =========================================================================
    describe('Format Zona Waktu WITA (Asia/Makassar)', () => {
        const formatWitaDateTime = (dateStr) => {
            if (!dateStr) return '-';
            try {
                const iso = (dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T')) + (dateStr.endsWith('Z') ? '' : 'Z');
                const d = new Date(iso);
                if (isNaN(d.getTime())) return dateStr;
                return new Intl.DateTimeFormat('id-ID', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'Asia/Makassar'
                }).format(d) + ' WITA';
            } catch (e) {
                return dateStr;
            }
        };

        test('Mengonversi ISO timestamp UTC ke waktu lokal WITA (UTC+8)', () => {
            const formatted = formatWitaDateTime('2026-09-06T12:00:00Z');
            expect(formatted).toContain('September');
            expect(formatted).toContain('2026');
            expect(formatted).toContain('20');
            expect(formatted).toContain('WITA');
        });

        test('Menangani format SQLite datetime now (YYYY-MM-DD HH:MM:SS)', () => {
            const formatted = formatWitaDateTime('2026-09-06 04:30:00');
            expect(formatted).toContain('September');
            expect(formatted).toContain('WITA');
        });

        test('Mengembalikan tanda "-" jika input kosong atau null', () => {
            expect(formatWitaDateTime('')).toBe('-');
            expect(formatWitaDateTime(null)).toBe('-');
        });
    });

    // =========================================================================
    // 6. INTEGRITAS FILE SKEMA & D1 MIGRATION
    // =========================================================================
    describe('Integritas Skema Database D1 SQL', () => {
        const migrationPath = path.resolve(__dirname, '../cloudflare/migrations/202609060001_add_e_lab_inventory.sql');
        const schemaPath = path.resolve(__dirname, '../cloudflare/schema.sql');

        test('Berkas migrasi Cloudflare D1 memuat tabel-tabel inventaris', () => {
            expect(fs.existsSync(migrationPath)).toBe(true);
            const content = fs.readFileSync(migrationPath, 'utf8');

            expect(content).toContain('inventory_categories');
            expect(content).toContain('inventory_locations');
            expect(content).toContain('inventory_items');
            expect(content).toContain('inventory_condition_history');
            expect(content).toContain('qty_good');
            expect(content).toContain('qty_minor_damage');
            expect(content).toContain('qty_major_damage');
            expect(content).toContain('qty_total');
        });

        test('Berkas schema.sql sinkron dengan seluruh tabel inventaris', () => {
            expect(fs.existsSync(schemaPath)).toBe(true);
            const content = fs.readFileSync(schemaPath, 'utf8');

            expect(content).toContain('CREATE TABLE IF NOT EXISTS inventory_categories');
            expect(content).toContain('CREATE TABLE IF NOT EXISTS inventory_locations');
            expect(content).toContain('CREATE TABLE IF NOT EXISTS inventory_items');
            expect(content).toContain('CREATE TABLE IF NOT EXISTS inventory_condition_history');
        });
    });

    // =========================================================================
    // 7. NORMALISASI RESPON API INVENTARIS & ARRAY SAFETY (DEFENSIVE UI)
    // =========================================================================
    describe('Normalisasi Respon API Inventaris & Array-Safety UI', () => {
        const normalizeInventoryItemsResponse = (res) => {
            const items = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
            if (res && typeof res.total === 'number') {
                items.total = res.total;
            }
            return items;
        };

        const safeExtractArray = (data) => {
            return Array.isArray(data) ? data : (data?.data || []);
        };

        test('Mengekstrak array items dari respon API standar Cloudflare { success, data, total }', () => {
            const mockApiResponse = {
                success: true,
                data: [
                    { id: 'item-1', name: 'Mikroskop', inventory_code: 'LAB-BIO-OPT-2026-001' },
                    { id: 'item-2', name: 'Gelas Kimia', inventory_code: 'LAB-KIM-GLS-2026-002' }
                ],
                total: 2,
                limit: 100,
                offset: 0
            };

            const items = normalizeInventoryItemsResponse(mockApiResponse);
            expect(Array.isArray(items)).toBe(true);
            expect(items.length).toBe(2);
            expect(items.total).toBe(2);
            expect(typeof items.map).toBe('function');
            expect(() => items.map(i => i.name)).not.toThrow();
        });

        test('Tetap aman jika API langsung mengembalikan array biasa', () => {
            const mockRawArray = [
                { id: 'item-1', name: 'Alat Peraga' }
            ];

            const items = normalizeInventoryItemsResponse(mockRawArray);
            expect(Array.isArray(items)).toBe(true);
            expect(items.length).toBe(1);
            expect(typeof items.map).toBe('function');
        });

        test('Mencegah TypeError jika API mengembalikan null, undefined, atau objek kosong', () => {
            expect(Array.isArray(normalizeInventoryItemsResponse(null))).toBe(true);
            expect(Array.isArray(normalizeInventoryItemsResponse(undefined))).toBe(true);
            expect(Array.isArray(normalizeInventoryItemsResponse({}))).toBe(true);
            expect(normalizeInventoryItemsResponse({}).length).toBe(0);
        });

        test('safeExtractArray mengekstrak array baik dari payload mentah maupun bersarang data', () => {
            expect(safeExtractArray([{ id: 1 }])).toEqual([{ id: 1 }]);
            expect(safeExtractArray({ data: [{ id: 2 }] })).toEqual([{ id: 2 }]);
            expect(safeExtractArray(null)).toEqual([]);
            expect(safeExtractArray(undefined)).toEqual([]);
            expect(safeExtractArray({})).toEqual([]);
        });
    });

    // =========================================================================
    // 8. LOGIKA PENGATURAN E-LABORATORIUM (2 SUBTAB, SEARCH & DUPLIKASI)
    // =========================================================================
    describe('Logika Pengaturan E-Laboratorium & Subtab Terpadu', () => {
        test('Subtab Pengaturan hanya mendukung 2 subtab resmi (labs dan inventory)', () => {
            const allowedSettingsSubtabs = ['labs', 'inventory'];
            const resolveSubtab = (input) => {
                if (input === 'categories' || input === 'locations') return 'inventory';
                return allowedSettingsSubtabs.includes(input) ? input : 'labs';
            };

            expect(resolveSubtab('labs')).toBe('labs');
            expect(resolveSubtab('inventory')).toBe('inventory');
            // Legacy alias auto-redirect ke inventory
            expect(resolveSubtab('categories')).toBe('inventory');
            expect(resolveSubtab('locations')).toBe('inventory');
        });

        test('Pencarian instan kategori memfilter berdasarkan nama atau kode (case-insensitive)', () => {
            const categories = [
                { id: 'cat-1', name: 'Optik & Mikroskop', code: 'OPT', is_active: 1 },
                { id: 'cat-2', name: 'Gelas Kimia & Tabung Reaksi', code: 'GLS', is_active: 1 },
                { id: 'cat-3', name: 'Komputer Komputasi', code: 'KOM', is_active: 1 }
            ];

            const filterCategories = (cats, term) => {
                const q = (term || '').trim().toLowerCase();
                if (!q) return cats;
                return cats.filter(c => (c.name || '').toLowerCase().includes(q) || (c.code || '').toLowerCase().includes(q));
            };

            expect(filterCategories(categories, 'opt').length).toBe(1);
            expect(filterCategories(categories, 'opt')[0].code).toBe('OPT');
            expect(filterCategories(categories, 'gelas').length).toBe(1);
            expect(filterCategories(categories, 'kom').length).toBe(1);
            expect(filterCategories(categories, 'nonexistent').length).toBe(0);
        });

        test('Pencarian instan lokasi memfilter berdasarkan nama lokasi', () => {
            const locations = [
                { id: 'loc-1', name: 'Lemari Mikroskop 01', is_active: 1 },
                { id: 'loc-2', name: 'Rak Reagen Kimia B', is_active: 1 },
                { id: 'loc-3', name: 'Meja Komputer 3', is_active: 1 }
            ];

            const filterLocations = (locs, term) => {
                const q = (term || '').trim().toLowerCase();
                if (!q) return locs;
                return locs.filter(l => (l.name || '').toLowerCase().includes(q));
            };

            expect(filterLocations(locations, 'mikroskop').length).toBe(1);
            expect(filterLocations(locations, 'reagen').length).toBe(1);
            expect(filterLocations(locations, 'meja').length).toBe(1);
            expect(filterLocations(locations, 'rak').length).toBe(1);
        });

        test('Deteksi duplikasi nama atau kode kategori dalam laboratorium yang sama', () => {
            const existingCategories = [
                { id: 'cat-1', lab_id: 'lab-bio', name: 'Alat Optik', code: 'OPT' },
                { id: 'cat-2', lab_id: 'lab-bio', name: 'Bahan Habis Pakai', code: 'BHP' }
            ];

            const checkCategoryDuplicate = (currentId, labId, name, code) => {
                const normName = name.trim().toLowerCase();
                const normCode = code.trim().toUpperCase();
                return existingCategories.some(c =>
                    c.lab_id === labId &&
                    c.id !== currentId &&
                    (c.name.toLowerCase() === normName || c.code.toUpperCase() === normCode)
                );
            };

            // Duplikasi nama pada lab yang sama
            expect(checkCategoryDuplicate('', 'lab-bio', 'Alat Optik', 'NEW')).toBe(true);
            // Duplikasi kode pada lab yang sama
            expect(checkCategoryDuplicate('', 'lab-bio', 'Nama Baru', 'OPT')).toBe(true);
            // Aman jika kategori baru unik
            expect(checkCategoryDuplicate('', 'lab-bio', 'Elektronik', 'ELEK')).toBe(false);
            // Aman saat mengedit dirinya sendiri (currentId sama)
            expect(checkCategoryDuplicate('cat-1', 'lab-bio', 'Alat Optik', 'OPT')).toBe(false);
        });

        test('Integritas markup e-lab.html memuat dua subtab dan 2 panel berdampingan', () => {
            const htmlPath = path.resolve(__dirname, '../e-lab.html');
            const html = fs.readFileSync(htmlPath, 'utf8');

            expect(html).toContain('id="btn-subtab-labs"');
            expect(html).toContain('id="btn-subtab-inventory"');
            expect(html).toContain('id="subview-pengaturan-labs"');
            expect(html).toContain('id="subview-pengaturan-inventory"');
            expect(html).toContain('id="panel-setting-categories"');
            expect(html).toContain('id="panel-setting-locations"');
            expect(html).toContain('id="modal-category-form"');
            expect(html).toContain('id="modal-location-form"');
            expect(html).toContain('id="modal-manage-lab"');
        });
    });

    // =========================================================================
    // 9. TOOLBAR INVENTARIS PROFESIONAL, SERVER SORTING & INTEGRITAS RELASI LAB
    // =========================================================================
    describe('Toolbar Inventaris Baru, Server-Side Sorting & Proteksi Integritas Relasi Lab', () => {
        test('Integritas markup toolbar inventaris utama, popover filter, chips, dan pagination di e-lab.html', () => {
            const htmlPath = path.resolve(__dirname, '../e-lab.html');
            const html = fs.readFileSync(htmlPath, 'utf8');

            // Compact Metrics Strip
            expect(html).toContain('id="inv-stat-items"');
            expect(html).toContain('id="inv-stat-units"');
            expect(html).toContain('id="inv-stat-good"');
            expect(html).toContain('id="inv-stat-minor"');
            expect(html).toContain('id="inv-stat-major"');
            expect(html).toContain('id="inv-scope-info"');

            // Toolbar Ringkas
            expect(html).toContain('id="inv-search-input"');
            expect(html).toContain('id="btn-inv-search-clear"');
            expect(html).toContain('id="inv-filter-lab"');
            expect(html).toContain('id="btn-inv-filter-toggle"');
            expect(html).toContain('id="inv-filter-badge"');
            expect(html).toContain('id="btn-inv-add-item"');

            // Popover Filter Kontrol
            expect(html).toContain('id="inv-filter-popover"');
            expect(html).toContain('id="inv-filter-category"');
            expect(html).toContain('id="inv-filter-location"');
            expect(html).toContain('id="inv-filter-condition"');
            expect(html).toContain('id="inv-filter-sort"');

            // Active Filter Chips & Pagination
            expect(html).toContain('id="inv-active-chips-bar"');
            expect(html).toContain('id="inv-active-chips-list"');
            expect(html).toContain('id="inv-table-footer"');
            expect(html).toContain('id="inv-limit-select"');
            expect(html).toContain('id="btn-inv-prev-page"');
            expect(html).toContain('id="btn-inv-next-page"');
            expect(html).toContain('id="inv-page-info"');
            expect(html).toContain('id="inv-count-info"');
        });

        test('UI/UX: Form pencarian bebas dari ikon penutup teks dan filter lab memiliki label jelas serta anti-clipping style', () => {
            const htmlPath = path.resolve(__dirname, '../e-lab.html');
            const html = fs.readFileSync(htmlPath, 'utf8');

            // 1. Pastikan style anti-clipping terdefinisi
            expect(html).toContain('.elab-compact-input');
            expect(html).toContain('.elab-compact-select');
            expect(html).toContain('.elab-toolbar-btn');

            // 2. Form input pencarian tidak lagi didampingi ikon kaca pembesar penutup teks
            // Form pencarian utama inventaris
            const invSearchBlock = html.substring(html.indexOf('id="inv-search-input"') - 150, html.indexOf('id="inv-search-input"') + 150);
            expect(invSearchBlock).not.toContain('fa-magnifying-glass');

            // Form pencarian kategori di pengaturan
            const catSearchBlock = html.substring(html.indexOf('id="search-category-input"') - 150, html.indexOf('id="search-category-input"') + 150);
            expect(catSearchBlock).not.toContain('fa-magnifying-glass');

            // Form pencarian lokasi di pengaturan
            const locSearchBlock = html.substring(html.indexOf('id="search-location-input"') - 150, html.indexOf('id="search-location-input"') + 150);
            expect(locSearchBlock).not.toContain('fa-magnifying-glass');

            // Form pencarian koordinator lab di pengaturan
            const koorSearchBlock = html.substring(html.indexOf('id="manage-lab-koordinator-search"') - 150, html.indexOf('id="manage-lab-koordinator-search"') + 150);
            expect(koorSearchBlock).not.toContain('fa-magnifying-glass');

            // 3. Filter Lab di toolbar inventaris memiliki label terlihat jelas 'Lab:'
            expect(html).toContain('for="inv-filter-lab"');
            expect(html).toContain('<span>Lab:</span>');
            expect(html).toContain('class="elab-compact-select');
        });

        test('Validasi Server-Side Sorting: Memetakan kolom yang diizinkan dan menolak SQL Injection', () => {
            const sortColumnMap = {
                'name': 'i.name',
                'inventory_code': 'i.inventory_code',
                'created_at': 'i.created_at',
                'qty_total': 'i.qty_total',
                'qty_good': 'i.qty_good',
                'price': 'i.price'
            };

            const resolveSortClause = (sortBy, sortDir) => {
                const sortCol = sortColumnMap[sortBy] || 'i.name';
                const dir = (String(sortDir).toUpperCase() === 'DESC') ? 'DESC' : 'ASC';
                return `${sortCol} ${dir}`;
            };

            // Sorting sah
            expect(resolveSortClause('name', 'asc')).toBe('i.name ASC');
            expect(resolveSortClause('name', 'desc')).toBe('i.name DESC');
            expect(resolveSortClause('created_at', 'desc')).toBe('i.created_at DESC');
            expect(resolveSortClause('qty_total', 'desc')).toBe('i.qty_total DESC');
            expect(resolveSortClause('price', 'asc')).toBe('i.price ASC');

            // Kolom tidak sah / potensi SQL injection dinetralkan ke default 'i.name ASC'
            expect(resolveSortClause('name; DROP TABLE labs;--', 'asc')).toBe('i.name ASC');
            expect(resolveSortClause('1=1', 'desc')).toBe('i.name DESC');
            expect(resolveSortClause(null, 'invalid')).toBe('i.name ASC');
        });

        test('Proteksi Integritas Relasi: Menolak penghapusan lab yang masih memiliki item inventaris aktif', () => {
            const canDeleteLab = (labId, inventoryCount) => {
                if (typeof inventoryCount === 'number' && inventoryCount > 0) {
                    return {
                        allowed: false,
                        status: 409,
                        error: `Laboratorium tidak dapat dihapus karena masih memiliki ${inventoryCount} barang inventaris aktif. Pindahkan atau hapus barang inventaris terlebih dahulu.`
                    };
                }
                return { allowed: true, status: 200 };
            };

            const resWithItems = canDeleteLab('lab-bio', 12);
            expect(resWithItems.allowed).toBe(false);
            expect(resWithItems.status).toBe(409);
            expect(resWithItems.error).toContain('masih memiliki 12 barang inventaris aktif');

            const resEmpty = canDeleteLab('lab-empty', 0);
            expect(resEmpty.allowed).toBe(true);
            expect(resEmpty.status).toBe(200);
        });

        test('Kalkulasi Filter Badge Count: Menghitung filter aktif non-default dengan tepat', () => {
            const computeActiveFilterCount = ({ category, location, condition, sort }) => {
                let count = 0;
                if (category && category.trim() !== '') count++;
                if (location && location.trim() !== '') count++;
                if (condition && condition.trim() !== '') count++;
                if (sort && sort !== 'name_asc') count++;
                return count;
            };

            // Semua default
            expect(computeActiveFilterCount({ category: '', location: '', condition: '', sort: 'name_asc' })).toBe(0);

            // Filter kategori & kondisi aktif
            expect(computeActiveFilterCount({ category: 'cat-opt', location: '', condition: 'good', sort: 'name_asc' })).toBe(2);

            // Semua filter aktif
            expect(computeActiveFilterCount({ category: 'cat-opt', location: 'loc-1', condition: 'good', sort: 'created_at_desc' })).toBe(4);
        });
    });

    // =========================================================================
    // 10. RBAC INVENTARIS: GURU MAPEL READ-ONLY VS KOORDINATOR LAB VS KEPALA LAB
    // =========================================================================
    describe('RBAC Inventaris: Guru Mapel Read-Only vs Koordinator Lab vs Kepala Lab', () => {
        const mockLabs = [
            { id: 'lab-bio', nama: 'Lab Biologi', koordinator_uid: 'u-guru-bio', koordinator_nama: 'Bu Wayan' },
            { id: 'lab-kim', nama: 'Lab Kimia', koordinator_uid: 'u-guru-kim', koordinator_nama: 'Pak Made' },
            { id: 'lab-fis', nama: 'Lab Fisika', koordinator_uid: null, koordinator_nama: null }
        ];

        // Simulasi fungsi RBAC sesuai implementasi js/page-e-lab.js
        const createElabRbacHelper = (currentUser, currentRole, isKepalaLab = false) => {
            const isLabAdminUser = () => ['superadmin', 'admin', 'developer'].includes(currentRole);

            const isUserCoordinatorForLab = (labId) => {
                if (!currentUser?.uid) return false;
                const lab = mockLabs.find(l => l.id === labId);
                return Boolean(lab && lab.koordinator_uid && lab.koordinator_uid === currentUser.uid);
            };

            const getAccessibleLabsForWrite = () => {
                if (isLabAdminUser() || isKepalaLab) return [...mockLabs];
                if (!currentUser?.uid) return [];
                return mockLabs.filter(l => Boolean(l.koordinator_uid && l.koordinator_uid === currentUser.uid));
            };

            const canUserManageLab = (labId) => {
                if (isLabAdminUser()) return true;
                if (isKepalaLab) return true;
                if (labId && isUserCoordinatorForLab(labId)) return true;
                return false;
            };

            const shouldShowAddButton = (currentLabFilter) => {
                const accessible = getAccessibleLabsForWrite();
                if (isLabAdminUser() || isKepalaLab) return true;
                if (currentLabFilter) return canUserManageLab(currentLabFilter);
                return accessible.length > 0;
            };

            return {
                isLabAdminUser,
                isUserCoordinatorForLab,
                getAccessibleLabsForWrite,
                canUserManageLab,
                shouldShowAddButton
            };
        };

        test('Guru Mapel tanpa tugas koordinator HANYA memiliki hak read-only (tombol tambah barang tersembunyi)', () => {
            const guruMapel = { uid: 'u-guru-sejarah', name: 'Pak Nyoman Sejarah' };
            const rbac = createElabRbacHelper(guruMapel, 'guru_mapel', false);

            // Lab yang bisa ditulis harus kosong
            expect(rbac.getAccessibleLabsForWrite()).toEqual([]);

            // Tombol tambah barang tersembunyi pada filter semua lab maupun filter lab tertentu
            expect(rbac.shouldShowAddButton('')).toBe(false);
            expect(rbac.shouldShowAddButton('lab-bio')).toBe(false);
            expect(rbac.shouldShowAddButton('lab-kim')).toBe(false);
            expect(rbac.shouldShowAddButton('lab-fis')).toBe(false);

            // Hak kelola lab selalu false
            expect(rbac.canUserManageLab('lab-bio')).toBe(false);
            expect(rbac.canUserManageLab('lab-kim')).toBe(false);
        });

        test('Guru Mapel yang ditugaskan sebagai Koordinator Lab berhak menambah/mengedit HANYA pada lab tugasnya', () => {
            const koordinatorBio = { uid: 'u-guru-bio', name: 'Bu Wayan Biologi' };
            const rbac = createElabRbacHelper(koordinatorBio, 'guru_mapel', false);

            // Hanya lab biologi yang dapat diakses untuk tulis
            const accessible = rbac.getAccessibleLabsForWrite();
            expect(accessible.length).toBe(1);
            expect(accessible[0].id).toBe('lab-bio');

            // Tombol tambah barang tampil saat melihat Lab Biologi atau melihat Seluruh Lab
            expect(rbac.shouldShowAddButton('lab-bio')).toBe(true);
            expect(rbac.shouldShowAddButton('')).toBe(true);

            // Tombol tambah barang TERSEMBUNYI saat melihat Lab Kimia atau Lab Fisika
            expect(rbac.shouldShowAddButton('lab-kim')).toBe(false);
            expect(rbac.shouldShowAddButton('lab-fis')).toBe(false);

            // Hak kelola lab hanya untuk lab-bio
            expect(rbac.canUserManageLab('lab-bio')).toBe(true);
            expect(rbac.canUserManageLab('lab-kim')).toBe(false);
            expect(rbac.canUserManageLab('lab-fis')).toBe(false);
        });

        test('Kepala Lab Global berhak menambah dan mengelola inventaris di seluruh laboratorium', () => {
            const kepalaLab = { uid: 'u-kalab-01', name: 'Dr. Ketut Kalab' };
            const rbac = createElabRbacHelper(kepalaLab, 'guru_mapel', true); // guru_mapel dengan additional role kepala_lab

            expect(rbac.getAccessibleLabsForWrite().length).toBe(mockLabs.length);
            expect(rbac.shouldShowAddButton('')).toBe(true);
            expect(rbac.shouldShowAddButton('lab-bio')).toBe(true);
            expect(rbac.shouldShowAddButton('lab-kim')).toBe(true);
            expect(rbac.shouldShowAddButton('lab-fis')).toBe(true);

            expect(rbac.canUserManageLab('lab-bio')).toBe(true);
            expect(rbac.canUserManageLab('lab-kim')).toBe(true);
            expect(rbac.canUserManageLab('lab-fis')).toBe(true);
        });

        test('Super Admin memiliki akses penuh write ke seluruh laboratorium', () => {
            const admin = { uid: 'u-admin-01', name: 'Super Administrator' };
            const rbac = createElabRbacHelper(admin, 'superadmin', false);

            expect(rbac.getAccessibleLabsForWrite().length).toBe(mockLabs.length);
            expect(rbac.shouldShowAddButton('')).toBe(true);
            expect(rbac.shouldShowAddButton('lab-bio')).toBe(true);
            expect(rbac.canUserManageLab('lab-bio')).toBe(true);
        });

        test('Integritas Kode page-e-lab.js: Sinkronisasi role realtime & proteksi RBAC inventaris', () => {
            const jsPath = path.resolve(__dirname, '../js/page-e-lab.js');
            const jsContent = fs.readFileSync(jsPath, 'utf8');

            // 1. Sinkronisasi role dan additional roles langsung dari userDoc saat onAuthStateChanged
            expect(jsContent).toContain('window.getCurrentUserDoc()');
            expect(jsContent).toContain("localStorage.setItem('user_additional_roles'");

            // 2. updateInventoryAddButtonVisibility terdefinisi dan dipanggil
            expect(jsContent).toContain('function updateInventoryAddButtonVisibility()');
            expect(jsContent).toContain('updateInventoryAddButtonVisibility();');

            // 3. canUserManageLab dipanggil untuk otorisasi item inventaris
            expect(jsContent).toContain('canUserManageLab(currentInventoryLabFilter)');
            expect(jsContent).toContain('canUserManageLab(item.lab_id)');
            expect(jsContent).toContain('canUserManageLab(labId)');

            // 4. legacy kepala_lab_uid tidak boleh ada pada coordinator check
            expect(jsContent).not.toMatch(/l\.koordinator_uid\s*===.*\|\|\s*l\.kepala_lab_uid/);

            // 5. updateInventoryAddButtonVisibility menyetel style.display = 'none' untuk proteksi ganda
            expect(jsContent).toContain("btnAddItem.style.display = 'none'");
            expect(jsContent).toContain("btnAddItem.style.display = ''");
        });

        test('Integritas CSS & DOM Anti-Leakage: Penegakan display none !important dan pembaruan SW Cache PWA', () => {
            const htmlPath = path.resolve(__dirname, '../e-lab.html');
            const htmlContent = fs.readFileSync(htmlPath, 'utf8');

            const swPath = path.resolve(__dirname, '../sw.js');
            const swContent = fs.readFileSync(swPath, 'utf8');

            const configPath = path.resolve(__dirname, '../js/config.js');
            const configContent = fs.readFileSync(configPath, 'utf8');

            // 1. .elab-toolbar-btn tidak boleh memiliki display: inline-flex !important yang menimpa .hidden
            expect(htmlContent).not.toContain('display: inline-flex !important;');

            // 2. .elab-toolbar-btn.hidden memiliki aturan display: none !important
            expect(htmlContent).toContain('.elab-toolbar-btn.hidden');
            expect(htmlContent).toContain('display: none !important;');

            // 3. Tombol #btn-inv-add-item memiliki atribut inline style="display: none;" sejak markup awal
            expect(htmlContent).toContain('id="btn-inv-add-item" onclick="window.openAddInventoryModal()" style="display: none;"');

            // 4. Service worker cache mengeliminasi cache browser lama
            expect(swContent).toMatch(/const CACHE_NAME = 'simas-pwa-v\d+';/);

            // 5. Konstanta APP_VERSION di config.js sinkron ke package.json
            const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
            expect(configContent).toContain(`export const APP_VERSION = "${pkg.version}";`);
        });
    });

    // =========================================================================
    // 11. KONSOLIDASI KOLOM AKSI TABEL KE MODAL DETAIL INVENTARIS
    // =========================================================================
    describe('Konsolidasi Kolom Aksi Tabel & Kartu ke Modal Detail', () => {
        const pageElabJsPath = path.resolve(__dirname, '../js/page-e-lab.js');
        const elabHtmlPath = path.resolve(__dirname, '../e-lab.html');
        const elabJsContent = fs.readFileSync(pageElabJsPath, 'utf8');
        const elabHtmlContent = fs.readFileSync(elabHtmlPath, 'utf8');

        test('Tabel Desktop hanya menampilkan tombol Detail pada kolom Aksi', () => {
            // Ekstrak blok fungsi renderInventoryItemsUI
            const startIdx = elabJsContent.indexOf('function renderInventoryItemsUI()');
            const endIdx = elabJsContent.indexOf('window.openAddInventoryModal =', startIdx);
            const renderFnCode = elabJsContent.substring(startIdx, endIdx);

            // Kolom aksi tabel hanya memuat tombol showInventoryDetail
            expect(renderFnCode).toContain("window.showInventoryDetail('${escapeHtml(item.id)}')");

            // Pastikan tidak ada tombol aksi ubah kondisi, edit, dan hapus di dalam tbody map
            const tbodyStart = renderFnCode.indexOf('if (tbody) {');
            const tbodyEnd = renderFnCode.indexOf('if (mobileContainer) {');
            const tbodyCode = renderFnCode.substring(tbodyStart, tbodyEnd);

            expect(tbodyCode).toContain('Detail');
            expect(tbodyCode).not.toContain('openChangeConditionModal');
            expect(tbodyCode).not.toContain('openEditInventoryModal');
            expect(tbodyCode).not.toContain('deleteInventoryItem');
        });

        test('Kartu Mobile hanya menampilkan tombol Detail', () => {
            const startIdx = elabJsContent.indexOf('if (mobileContainer) {');
            const endIdx = elabJsContent.indexOf('window.openAddInventoryModal =', startIdx);
            const mobileCode = elabJsContent.substring(startIdx, endIdx);

            expect(mobileCode).toContain("window.showInventoryDetail('${escapeHtml(item.id)}')");
            expect(mobileCode).toContain('Detail');
            expect(mobileCode).not.toContain('openChangeConditionModal');
            expect(mobileCode).not.toContain('openEditInventoryModal');
            expect(mobileCode).not.toContain('deleteInventoryItem');
        });

        test('Modal Detail menyediakan tombol Edit Data, Ubah Kondisi, dan Hapus lengkap dengan label', () => {
            expect(elabHtmlContent).toContain('id="modal-inventory-detail"');
            expect(elabHtmlContent).toContain('id="detail-inv-actions"');
            expect(elabHtmlContent).toContain('id="btn-detail-edit"');
            expect(elabHtmlContent).toContain('id="btn-detail-condition"');
            expect(elabHtmlContent).toContain('id="btn-detail-delete"');
            expect(elabHtmlContent).toContain('<i class="fa-solid fa-trash"></i> Hapus');
        });

        test('Script tag page-e-lab.js di e-lab.html menggunakan versi aplikasi aktif', () => {
            const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
            expect(elabHtmlContent).toContain(`src="js/page-e-lab.js?v=${pkg.version}"`);
        });

        test('Paska edit barang sukses, modal detail langsung dibuka kembali dengan data teranyar', () => {
            expect(elabJsContent).toContain('if (isEdit && itemId) {');
            expect(elabJsContent).toContain('window.showInventoryDetail(itemId);');
        });
    });

    // =========================================================================
    // 12. FITUR IMPOR DATA BARANG INVENTARIS DARI EXCEL (COPY-PASTE TSV)
    // =========================================================================
    describe('Fitur Impor Data Barang Inventaris dari Excel (Copy - Paste TSV)', () => {
        const pageElabJsPath = path.resolve(__dirname, '../js/page-e-lab.js');
        const elabHtmlPath = path.resolve(__dirname, '../e-lab.html');
        const workerJsPath = path.resolve(__dirname, '../cloudflare/worker.js');
        const cfClientPath = path.resolve(__dirname, '../js/cloudflare-client.js');

        const elabJsContent = fs.readFileSync(pageElabJsPath, 'utf8');
        const elabHtmlContent = fs.readFileSync(elabHtmlPath, 'utf8');
        const workerJsContent = fs.readFileSync(workerJsPath, 'utf8');
        const cfClientContent = fs.readFileSync(cfClientPath, 'utf8');

        // Helper fungsi parser logika yang sama persis dengan previewInventoryImportData
        const parseImportLines = (rawText, manualOffset, categories, locations) => {
            const rawLines = rawText.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim().length > 0);
            if (rawLines.length === 0) return { dataLines: [], rows: [], validCount: 0, invalidCount: 0, totalUnits: 0 };

            const firstLineCols = rawLines[0].split('\t').map(c => c.trim().toLowerCase());
            const isFirstLineHeader = firstLineCols.some(c =>
                c === 'nama' || c === 'nama barang' || c === 'barang' || c === 'spesifikasi' ||
                c === 'kategori' || c === 'no' || c === 'no.' || c === 'jumlah' || c === 'tahun'
            );

            const dataLines = isFirstLineHeader ? rawLines.slice(1) : rawLines;
            if (dataLines.length === 0) return { dataLines: [], rows: [], validCount: 0, invalidCount: 0, totalUnits: 0 };

            let offset = 0;
            if (manualOffset === '1') {
                offset = 1;
            } else if (manualOffset === '0') {
                offset = 0;
            } else {
                const sampleCols = dataLines[0].split('\t');
                if (sampleCols.length >= 10 && /^\d+$/.test(sampleCols[0].trim())) {
                    offset = 1;
                } else {
                    offset = 0;
                }
            }

            let validCount = 0;
            let invalidCount = 0;
            let totalUnits = 0;
            const rows = [];

            dataLines.forEach((line) => {
                const cols = line.split('\t').map(c => c.trim());
                const name = cols[offset] || '';
                const spec = cols[offset + 1] || '';
                const catStr = cols[offset + 2] || '';
                const locStr = cols[offset + 3] || '';
                const qtyRaw = cols[offset + 4] || '';
                const unit = cols[offset + 5] || '';
                const yearRaw = cols[offset + 6] || '';
                const funding = cols[offset + 7] || '';
                const notes = cols[offset + 8] || '';

                const errors = [];
                if (!name) errors.push('Nama barang kosong');
                if (!spec) errors.push('Spesifikasi/Merk kosong');
                if (!catStr) errors.push('Kategori kosong');
                if (!locStr) errors.push('Lokasi simpan kosong');

                const qty = parseInt(qtyRaw.replace(/[^0-9]/g, ''), 10);
                if (isNaN(qty) || qty < 1) errors.push('Jumlah unit harus angka minimal 1');
                if (!unit) errors.push('Satuan kosong');

                const year = parseInt(yearRaw.replace(/[^0-9]/g, ''), 10);
                if (isNaN(year) || year < 1900 || year > 2100) errors.push('Tahun perolehan wajib 4 digit (1900-2100)');
                if (!funding) errors.push('Sumber dana kosong');

                let matchedCat = null;
                if (catStr) {
                    matchedCat = categories.find(c =>
                        c.name.toLowerCase() === catStr.toLowerCase() ||
                        c.code.toLowerCase() === catStr.toLowerCase()
                    );
                    if (!matchedCat) {
                        matchedCat = categories.find(c =>
                            c.name.toLowerCase().includes(catStr.toLowerCase()) ||
                            catStr.toLowerCase().includes(c.name.toLowerCase())
                        );
                    }
                    if (!matchedCat) errors.push(`Kategori "${catStr}" tidak terdaftar`);
                }

                let matchedLoc = null;
                if (locStr) {
                    matchedLoc = locations.find(l =>
                        l.name.toLowerCase() === locStr.toLowerCase()
                    );
                    if (!matchedLoc) {
                        matchedLoc = locations.find(l =>
                            l.name.toLowerCase().includes(locStr.toLowerCase()) ||
                            locStr.toLowerCase().includes(l.name.toLowerCase())
                        );
                    }
                    if (!matchedLoc) errors.push(`Lokasi "${locStr}" tidak terdaftar`);
                }

                const isValid = errors.length === 0;
                if (isValid) {
                    validCount++;
                    totalUnits += qty;
                    rows.push({
                        name,
                        specification: spec,
                        category_id: matchedCat.id,
                        location_id: matchedLoc.id,
                        qty_good: qty,
                        qty_total: qty,
                        unit,
                        acquisition_year: year,
                        funding_source: funding,
                        notes,
                        errors
                    });
                } else {
                    invalidCount++;
                    rows.push({ name, errors, isValid: false });
                }
            });

            return { dataLines, rows, validCount, invalidCount, totalUnits, offset };
        };

        const sampleCats = [
            { id: 'cat-1', name: 'Optik', code: 'OPT' },
            { id: 'cat-2', name: 'Gelas Kimia', code: 'GLS' }
        ];

        const sampleLocs = [
            { id: 'loc-1', name: 'Lemari A' },
            { id: 'loc-2', name: 'Rak B' }
        ];

        test('Parsing data TSV 9 kolom standar dengan header dan alokasi 100% kondisi Baik', () => {
            const rawTsv = [
                'Nama Barang\tSpesifikasi / Merk\tKategori\tLokasi Simpan\tJumlah Unit\tSatuan\tTahun Perolehan\tSumber Dana\tKeterangan',
                'Mikroskop Binokuler\tOlympus CX23 LED\tOptik\tLemari A\t5\tUnit\t2026\tBOS Reguler\tPengadaan baru'
            ].join('\n');

            const result = parseImportLines(rawTsv, 'auto', sampleCats, sampleLocs);
            expect(result.validCount).toBe(1);
            expect(result.invalidCount).toBe(0);
            expect(result.totalUnits).toBe(5);
            expect(result.rows[0].qty_good).toBe(5);
            expect(result.rows[0].qty_total).toBe(5);
            expect(result.rows[0].specification).toBe('Olympus CX23 LED');
            expect(result.rows[0].category_id).toBe('cat-1');
            expect(result.rows[0].location_id).toBe('loc-1');
            expect(result.rows[0].notes).toBe('Pengadaan baru');
        });

        test('Smart Offset: Otomatis mendeteksi kolom No. Urut (10 kolom) dan menggeser offset ke 1', () => {
            const rawTsvWithNo = [
                'No\tNama Barang\tSpesifikasi\tKategori\tLokasi\tJumlah\tSatuan\tTahun\tSumber Dana\tKeterangan',
                '1\tGelas Ukur 100ml\tPyrex Kaca Borosilikat\tGelas Kimia\tRak B\t10\tBuah\t2025\tBOS Kinerja\t'
            ].join('\n');

            const result = parseImportLines(rawTsvWithNo, 'auto', sampleCats, sampleLocs);
            expect(result.offset).toBe(1);
            expect(result.validCount).toBe(1);
            expect(result.rows[0].name).toBe('Gelas Ukur 100ml');
            expect(result.rows[0].specification).toBe('Pyrex Kaca Borosilikat');
            expect(result.rows[0].category_id).toBe('cat-2');
            expect(result.rows[0].location_id).toBe('loc-2');
            expect(result.rows[0].qty_good).toBe(10);
            expect(result.rows[0].notes).toBe('');
        });

        test('Validasi kolom wajib: Menolak baris jika salah satu kolom wajib kosong', () => {
            const rawInvalid = [
                'Mikroskop\t\tOptik\tLemari A\t2\tUnit\t2026\tBOS\t',
                'Pipet Tetes\tPlastik 3ml\tGelas Kimia\tRak B\t0\tPcs\t2026\tBOS\t',
                'Tabung Reaksi\tPyrex\tKategori Gaib\tRak B\t5\tBuah\t2026\tBOS\t',
                'Cawan Petri\tAnumbra\tGelas Kimia\tRak B\t5\tSet\t26\tBOS\t'
            ].join('\n');

            const result = parseImportLines(rawInvalid, '0', sampleCats, sampleLocs);
            expect(result.validCount).toBe(0);
            expect(result.invalidCount).toBe(4);
            expect(result.rows[0].errors).toContain('Spesifikasi/Merk kosong');
            expect(result.rows[1].errors).toContain('Jumlah unit harus angka minimal 1');
            expect(result.rows[2].errors).toContain('Kategori "Kategori Gaib" tidak terdaftar');
            expect(result.rows[3].errors).toContain('Tahun perolehan wajib 4 digit (1900-2100)');
        });

        test('Keterangan bersifat opsional: Baris tetap valid jika keterangan kosong', () => {
            const rawTsv = 'Mikroskop Mini\tMono LED\tOptik\tLemari A\t3\tUnit\t2026\tBOS Reguler\t';
            const result = parseImportLines(rawTsv, '0', sampleCats, sampleLocs);
            expect(result.validCount).toBe(1);
            expect(result.rows[0].notes).toBe('');
        });

        test('Smart Matching Kategori & Lokasi: Mendukung case-insensitive dan pencarian substring', () => {
            const rawTsv = 'Lensa Cembung\tFokus 10cm\toptik\tlemarI a\t2\tBuah\t2026\tBOS\t';
            const result = parseImportLines(rawTsv, '0', sampleCats, sampleLocs);
            expect(result.validCount).toBe(1);
            expect(result.rows[0].category_id).toBe('cat-1');
            expect(result.rows[0].location_id).toBe('loc-1');
        });

        test('Integritas DOM di e-lab.html: Modal impor, tombol toolbar, dan panduan 9 kolom', () => {
            expect(elabHtmlContent).toContain('id="modal-inventory-import"');
            expect(elabHtmlContent).toContain('id="btn-inv-import-excel"');
            expect(elabHtmlContent).toContain('id="inv-import-paste-area"');
            expect(elabHtmlContent).toContain('id="inv-import-preview-container"');
            expect(elabHtmlContent).toContain('id="btn-inv-import-preview"');
            expect(elabHtmlContent).toContain('id="btn-inv-import-save"');
            expect(elabHtmlContent).toContain('onclick="window.openImportInventoryModal()"');
            expect(elabHtmlContent).toContain('onclick="window.copyInventoryExcelTemplate()"');
            expect(elabHtmlContent).toContain('onclick="window.previewInventoryImportData()"');
            expect(elabHtmlContent).toContain('onclick="window.submitInventoryImportData()"');
            expect(elabHtmlContent).toContain('Salin Format Kolom Excel');
            // Tombol impor memiliki style="display: none;" awal sebagai proteksi kebocoran
            expect(elabHtmlContent).toContain('id="btn-inv-import-excel"');
            expect(elabHtmlContent).toContain('style="display: none;"');
        });

        test('Integritas Controller di page-e-lab.js: Fungsi impor terdefinisi dan terekspos ke window', () => {
            expect(elabJsContent).toContain('window.openImportInventoryModal =');
            expect(elabJsContent).toContain('window.handleImportLabChange =');
            expect(elabJsContent).toContain('window.copyInventoryExcelTemplate =');
            expect(elabJsContent).toContain('window.previewInventoryImportData =');
            expect(elabJsContent).toContain('window.submitInventoryImportData =');
            expect(elabJsContent).toContain('cfClient.bulkSaveInventoryItems');
            // updateInventoryAddButtonVisibility mengontrol btnImportExcel
            expect(elabJsContent).toContain("const btnImportExcel = document.getElementById('btn-inv-import-excel');");
        });

        test('Integritas Backend di cloudflare/worker.js: Endpoint POST /api/inventory/items/bulk', () => {
            expect(workerJsContent).toContain('path === "/api/inventory/items/bulk" && method === "POST"');
            expect(workerJsContent).toContain('verifyLabAccess(env, authResult.user, labId, "write")');
            expect(workerJsContent).toContain('inventory_code LIKE ?');
            expect(workerJsContent).toContain('qty, acquisitionYear, fundingSource, notes, createdBy');
            expect(workerJsContent).toContain('env.DB.batch(statements)');
        });

        test('Integritas Client di js/cloudflare-client.js: Method bulkSaveInventoryItems dengan chunking 50', () => {
            expect(cfClientContent).toContain('async bulkSaveInventoryItems(labId, items)');
            expect(cfClientContent).toContain("const chunkSize = 50;");
            expect(cfClientContent).toContain("this.request('/api/inventory/items/bulk'");
        });
    });

    // =========================================================================
    // 13. SIMULASI ALUR PENGGUNAAN RIIL (REAL-WORLD SPREADSHEET & UI SIMULATION)
    // =========================================================================
    describe('Simulasi Alur Penggunaan Riil (Edge Cases Spreadsheet & Validasi Data)', () => {
        // Simulasi fungsi parsing yang identik dengan implementasi di page-e-lab.js
        const simulateRealWorldImportParsing = (rawText, categories, locations, manualOffset = 'auto') => {
            const rawLines = rawText.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim().length > 0);
            if (rawLines.length === 0) return { error: 'Area teks masih kosong', rows: [] };

            let delimiter = '\t';
            if (!rawLines[0].includes('\t')) {
                if (rawLines[0].includes(';')) delimiter = ';';
                else if (rawLines[0].includes(',')) delimiter = ',';
            }

            const cleanCell = (c) => {
                let s = (c || '').trim();
                if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
                    s = s.slice(1, -1).replace(/""/g, '"').trim();
                }
                return s;
            };

            const firstLineCols = rawLines[0].split(delimiter).map(c => cleanCell(c).toLowerCase());
            const isFirstLineHeader = firstLineCols.some(c =>
                c === 'nama' || c === 'nama barang' || c === 'barang' || c === 'spesifikasi' ||
                c === 'kategori' || c === 'no' || c === 'no.' || c === 'jumlah' || c === 'tahun'
            );

            const dataLines = isFirstLineHeader ? rawLines.slice(1) : rawLines;
            if (dataLines.length === 0) return { error: 'Hanya terdeteksi baris header', rows: [] };

            let offset = 0;
            if (manualOffset === '1') offset = 1;
            else if (manualOffset === '0') offset = 0;
            else {
                const sampleCols = dataLines[0].split(delimiter).map(cleanCell);
                if (sampleCols.length >= 10 && /^\d+$/.test(sampleCols[0])) {
                    offset = 1;
                } else {
                    offset = 0;
                }
            }

            const rows = [];
            for (const line of dataLines) {
                const cols = line.split(delimiter).map(cleanCell);
                const name = cols[offset] || '';
                const spec = cols[offset + 1] || '';
                const catStr = cols[offset + 2] || '';
                const locStr = cols[offset + 3] || '';
                const qtyRaw = cols[offset + 4] || '';
                const unit = cols[offset + 5] || '';
                const yearRaw = cols[offset + 6] || '';
                const funding = cols[offset + 7] || '';
                const notes = cols[offset + 8] || '';

                const errors = [];
                if (!name) errors.push('Nama barang kosong');
                if (!spec) errors.push('Spesifikasi/Merk kosong');
                if (!catStr) errors.push('Kategori kosong');
                if (!locStr) errors.push('Lokasi simpan kosong');

                // Validasi kuantitas riil
                let qty = NaN;
                const trimmedQty = qtyRaw.trim();
                if (/^-/.test(trimmedQty)) {
                    qty = -1;
                } else if (/^\d{1,3}[.,]\d{3}$/.test(trimmedQty)) {
                    qty = parseInt(trimmedQty.replace(/[.,]/g, ''), 10);
                } else {
                    const num = parseFloat(trimmedQty.replace(/,/g, '.'));
                    if (!isNaN(num)) {
                        qty = Math.floor(num);
                    } else {
                        const fallbackInt = parseInt(trimmedQty.replace(/[^0-9]/g, ''), 10);
                        if (!isNaN(fallbackInt)) qty = fallbackInt;
                    }
                }
                if (isNaN(qty) || qty < 1) errors.push('Jumlah unit harus angka minimal 1');

                if (!unit) errors.push('Satuan kosong');

                // Validasi tahun riil
                let year = NaN;
                const trimmedYear = yearRaw.trim();
                if (!/^-/.test(trimmedYear)) {
                    const yearMatch = trimmedYear.match(/\b(19\d\d|20\d\d)\b/);
                    if (yearMatch) {
                        year = parseInt(yearMatch[1], 10);
                    } else {
                        const numYear = parseFloat(trimmedYear.replace(/,/g, '.'));
                        if (!isNaN(numYear)) year = Math.floor(numYear);
                    }
                }
                if (isNaN(year) || year < 1900 || year > 2100) errors.push('Tahun perolehan wajib 4 digit (1900-2100)');

                if (!funding) errors.push('Sumber dana kosong');

                // Smart Matching Kategori
                let matchedCat = null;
                if (catStr) {
                    const cleanCat = catStr.toLowerCase();
                    matchedCat = categories.find(c =>
                        c.name.toLowerCase() === cleanCat ||
                        c.code.toLowerCase() === cleanCat ||
                        `${c.name} (${c.code})`.toLowerCase() === cleanCat
                    );
                    if (!matchedCat) {
                        matchedCat = categories.find(c =>
                            c.name.toLowerCase().includes(cleanCat) ||
                            cleanCat.includes(c.name.toLowerCase()) ||
                            (c.code && cleanCat.includes(c.code.toLowerCase()))
                        );
                    }
                    if (!matchedCat) errors.push(`Kategori "${catStr}" tidak terdaftar`);
                }

                // Smart Matching Lokasi
                let matchedLoc = null;
                if (locStr) {
                    const cleanLoc = locStr.toLowerCase();
                    matchedLoc = locations.find(l =>
                        l.name.toLowerCase() === cleanLoc ||
                        (l.code && l.code.toLowerCase() === cleanLoc) ||
                        `${l.name} (${l.code})`.toLowerCase() === cleanLoc
                    );
                    if (!matchedLoc) {
                        matchedLoc = locations.find(l =>
                            l.name.toLowerCase().includes(cleanLoc) ||
                            cleanLoc.includes(l.name.toLowerCase())
                        );
                    }
                    if (!matchedLoc) errors.push(`Lokasi "${locStr}" tidak terdaftar`);
                }

                rows.push({
                    name, spec, category_id: matchedCat?.id, location_id: matchedLoc?.id,
                    qty_good: qty, qty_total: qty, unit, acquisition_year: year, funding_source: funding,
                    notes, isValid: errors.length === 0, errors
                });
            }

            return { rows, validCount: rows.filter(r => r.isValid).length, errorCount: rows.filter(r => !r.isValid).length };
        };

        const mockCats = [
            { id: 'cat_elk', name: 'Elektronik & Multimedia', code: 'ELK' },
            { id: 'cat_frn', name: 'Furniture & Meubilair', code: 'FRN' },
            { id: 'cat_opt', name: 'Alat Optik & Mikroskop', code: 'OPT' }
        ];

        const mockLocs = [
            { id: 'loc_lma1', name: 'Lemari A1', code: 'LMA1' },
            { id: 'loc_rakb', name: 'Rak Bawah B2', code: 'RKB2' },
            { id: 'loc_mjg', name: 'Meja Guru', code: 'MJG' }
        ];

        test('Format Desimal Excel pada Kuantitas (misal 5.00 atau 10.0) diurai dengan tepat tanpa terlipatgandakan', () => {
            const pasteData = "Mikroskop Binokuler\tOlympus CX23\tAlat Optik & Mikroskop\tLemari A1\t5.00\tUnit\t2024.0\tBOS Reguler\tPengadaan baru";
            const result = simulateRealWorldImportParsing(pasteData, mockCats, mockLocs);

            expect(result.validCount).toBe(1);
            expect(result.rows[0].qty_good).toBe(5); // Bukan 500!
            expect(result.rows[0].acquisition_year).toBe(2024); // Bukan 20240!
        });

        test('Format Ribuan (1.000 atau 1,000) diurai menjadi 1000 unit dengan benar', () => {
            const pasteData = "Kaca Penutup Preparat\tCover Glass 18x18mm\tAlat Optik & Mikroskop\tLemari A1\t1.000\tKotak\t2023\tBOS Kinerja\t-";
            const result = simulateRealWorldImportParsing(pasteData, mockCats, mockLocs);

            expect(result.validCount).toBe(1);
            expect(result.rows[0].qty_good).toBe(1000);
        });

        test('Data bersel tanda kutip ganda dari Excel ("...") dibersihkan dan dicocokkan dengan sempurna', () => {
            const pasteData = `"Laptop ASUS Vivobook"\t"Core i5, 16GB RAM, SSD 512GB"\t"Elektronik & Multimedia"\t"Lemari A1"\t10\t"Unit"\t"2024"\t"BOS Reguler"\t"Label baru"`;
            const result = simulateRealWorldImportParsing(pasteData, mockCats, mockLocs);

            expect(result.validCount).toBe(1);
            expect(result.rows[0].name).toBe('Laptop ASUS Vivobook');
            expect(result.rows[0].spec).toBe('Core i5, 16GB RAM, SSD 512GB');
            expect(result.rows[0].category_id).toBe('cat_elk');
            expect(result.rows[0].location_id).toBe('loc_lma1');
        });

        test('Mendukung salinan CSV dengan delimiter titik-koma (;) dari Excel konfigurasi Indonesia', () => {
            const pasteData = `Nama Barang;Spesifikasi / Merk;Kategori;Lokasi Simpan;Jumlah Unit;Satuan;Tahun Perolehan;Sumber Dana;Keterangan\nProyektor Epson;EB-E500 3300 Lumens;Elektronik & Multimedia;Lemari A1;2;Unit;2023;BOS Kinerja;Ruang presentasi`;
            const result = simulateRealWorldImportParsing(pasteData, mockCats, mockLocs);

            expect(result.validCount).toBe(1);
            expect(result.rows[0].name).toBe('Proyektor Epson');
            expect(result.rows[0].qty_good).toBe(2);
            expect(result.rows[0].category_id).toBe('cat_elk');
        });

        test('Kategori dan lokasi yang mencantumkan kode singkatan atau format "Nama (Kode)" dicocokkan dengan tepat', () => {
            const pasteData = `Kursi Putar Lab\tHidrolik Hitam\tFRN\tLMA1\t20\tBuah\t2024\tKomite\t-`;
            const result = simulateRealWorldImportParsing(pasteData, mockCats, mockLocs);

            expect(result.validCount).toBe(1);
            expect(result.rows[0].category_id).toBe('cat_frn');
            expect(result.rows[0].location_id).toBe('loc_lma1');
        });

        test('Baris error menampilkan pesan spesifik dan tidak menggagalkan baris valid lainnya dalam batch', () => {
            const pasteData = [
                "Nama Barang\tSpesifikasi / Merk\tKategori\tLokasi Simpan\tJumlah Unit\tSatuan\tTahun Perolehan\tSumber Dana\tKeterangan",
                "Item Benar\tMerk A\tElektronik & Multimedia\tLemari A1\t4\tUnit\t2024\tBOS\tOk",
                "Item Tanpa Nama\t\tElektronik & Multimedia\tLemari A1\t2\tUnit\t2024\tBOS\tError",
                "Item Kategori Salah\tMerk B\tKategori Gaib\tLemari A1\t1\tUnit\t2024\tBOS\tError",
                "Item Qty Salah\tMerk C\tElektronik & Multimedia\tLemari A1\t-5\tUnit\t2024\tBOS\tError"
            ].join('\n');

            const result = simulateRealWorldImportParsing(pasteData, mockCats, mockLocs);
            expect(result.validCount).toBe(1);
            expect(result.errorCount).toBe(3);
            expect(result.rows[0].isValid).toBe(true);
            expect(result.rows[1].isValid).toBe(false);
            expect(result.rows[1].errors).toContain('Spesifikasi/Merk kosong');
            expect(result.rows[2].isValid).toBe(false);
            expect(result.rows[2].errors.some(e => e.includes('Kategori "Kategori Gaib" tidak terdaftar'))).toBe(true);
            expect(result.rows[3].isValid).toBe(false);
            expect(result.rows[3].errors).toContain('Jumlah unit harus angka minimal 1');
        });
    });

    // =========================================================================
    // 14. SIMULASI INTERAKSI DOM & SIKLUS HIDUP MODAL INVENTARIS
    // =========================================================================
    describe('Simulasi Siklus Hidup Modal Inventaris & Integrasi Tombol Aksi', () => {
        const elabHtmlPath = path.resolve(__dirname, '../e-lab.html');
        const elabJsPath = path.resolve(__dirname, '../js/page-e-lab.js');
        const elabHtmlContent = fs.readFileSync(elabHtmlPath, 'utf8');
        const elabJsContent = fs.readFileSync(elabJsPath, 'utf8');

        test('Markup modal-inventory-detail memuat seluruh elemen atribut data barang', () => {
            expect(elabHtmlContent).toContain('id="detail-inv-name"');
            expect(elabHtmlContent).toContain('id="detail-inv-code"');
            expect(elabHtmlContent).toContain('id="detail-inv-subtitle"');
            expect(elabHtmlContent).toContain('id="detail-inv-total"');
            expect(elabHtmlContent).toContain('id="detail-inv-good"');
            expect(elabHtmlContent).toContain('id="detail-inv-minor"');
            expect(elabHtmlContent).toContain('id="detail-inv-major"');
            expect(elabHtmlContent).toContain('id="detail-inv-location"');
            expect(elabHtmlContent).toContain('id="detail-inv-year"');
            expect(elabHtmlContent).toContain('id="detail-inv-funding"');
            expect(elabHtmlContent).toContain('id="detail-inv-unit"');
            expect(elabHtmlContent).toContain('id="detail-inv-spec"');
            expect(elabHtmlContent).toContain('id="detail-inv-notes"');
            expect(elabHtmlContent).toContain('id="detail-inv-history-list"');
        });

        test('Markup modal-inventory-import memuat dropdown format offset dengan opsi auto, 0, dan 1', () => {
            expect(elabHtmlContent).toContain('id="inv-import-offset-select"');
            expect(elabHtmlContent).toContain('value="auto"');
            expect(elabHtmlContent).toContain('value="0"');
            expect(elabHtmlContent).toContain('value="1"');
            expect(elabHtmlContent).toContain('id="inv-import-summary-badges"');
            expect(elabHtmlContent).toContain('id="inv-import-count-info"');
        });

        test('Controller e-lab menghubungkan aksi modal detail secara mulus', () => {
            // Edit barang dari modal detail
            expect(elabJsContent).toContain('window.handleDetailEditClick = function ()');
            expect(elabJsContent).toContain("safeCloseModal('modal-inventory-detail');");
            expect(elabJsContent).toContain('window.openEditInventoryModal(selectedInventoryItem.id);');

            // Ubah kondisi dari modal detail
            expect(elabJsContent).toContain('window.handleDetailChangeConditionClick = function ()');
            expect(elabJsContent).toContain('window.openChangeConditionModal(selectedInventoryItem.id);');

            // Hapus barang dari modal detail
            expect(elabJsContent).toContain('window.handleDetailDeleteClick = function ()');
            expect(elabJsContent).toContain('window.deleteInventoryItem(selectedInventoryItem.id, selectedInventoryItem.name);');
        });

        test('Controller impor e-lab membersihkan temporary rows dan memvalidasi sebelum simpan', () => {
            expect(elabJsContent).toContain('tempInventoryImportRows = [];');
            expect(elabJsContent).toContain('if (tempInventoryImportRows.length === 0)');
            expect(elabJsContent).toContain('isSubmittingInventoryImport');
            expect(elabJsContent).toContain('cfClient.bulkSaveInventoryItems(labId, tempInventoryImportRows)');
        });
    });

});




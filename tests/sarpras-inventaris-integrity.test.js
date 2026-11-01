/**
 * tests/sarpras-inventaris-integrity.test.js
 * ====================================================================
 * Test Suite: Integritas Modul Sarpras (Master Inventaris & KIR)
 * 1. Paritas Endpoint API Sarpras (Client -> Worker Router)
 * 2. Kepatuhan RBAC (Role admin_sarpras, Menu Config, Page Access Config)
 * 3. Integritas DOM Modal Anti-Nesting & Ergonomi Input pada sarpras-inventaris.html
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Suite Pengujian Integritas Modul Sarpras SIMAS SMAGESA', () => {
    const root = path.resolve(__dirname, '..');
    const workerJsPath = path.join(root, 'cloudflare', 'worker.js');
    const clientJsPath = path.join(root, 'js', 'cloudflare-client.js');
    const globalJsPath = path.join(root, 'js', 'global.js');
    const usersJsPath = path.join(root, 'js', 'page-users.js');
    const inventarisHtmlPath = path.join(root, 'sarpras-inventaris.html');
    const inventarisJsPath = path.join(root, 'js', 'page-sarpras-inventaris.js');

    const workerJs = fs.readFileSync(workerJsPath, 'utf8');
    const clientJs = fs.readFileSync(clientJsPath, 'utf8');
    const globalJs = fs.readFileSync(globalJsPath, 'utf8');
    const usersJs = fs.readFileSync(usersJsPath, 'utf8');
    const inventarisHtml = fs.readFileSync(inventarisHtmlPath, 'utf8');
    const inventarisJs = fs.readFileSync(inventarisJsPath, 'utf8');

    // 1. UJI PARITAS ENDPOINT API SARPRAS (CLIENT -> WORKER)
    describe('1. Paritas Endpoint API Sarpras (Client -> Worker)', () => {
        const sarprasEndpoints = [
            { method: 'GET', endpoint: '/api/sarpras/rooms', clientFn: 'getSarprasRooms' },
            { method: 'POST', endpoint: '/api/sarpras/rooms', clientFn: 'saveSarprasRoom' },
            { method: 'PUT', endpoint: '/api/sarpras/rooms/', clientFn: 'saveSarprasRoom' },
            { method: 'DELETE', endpoint: '/api/sarpras/rooms/', clientFn: 'deleteSarprasRoom' },
            { method: 'GET', endpoint: '/api/sarpras/inventory/summary', clientFn: 'getSarprasInventorySummary' },
            { method: 'GET', endpoint: '/api/sarpras/inventory/kir/', clientFn: 'getSarprasKirData' },
            { method: 'GET', endpoint: '/api/sarpras/inventory', clientFn: 'getSarprasInventory' },
            { method: 'POST', endpoint: '/api/sarpras/inventory', clientFn: 'saveSarprasInventoryItem' },
            { method: 'POST', endpoint: '/api/sarpras/inventory/bulk', clientFn: 'bulkImportSarprasInventory' },
            { method: 'PUT', endpoint: '/api/sarpras/inventory/', clientFn: 'saveSarprasInventoryItem' },
            { method: 'DELETE', endpoint: '/api/sarpras/inventory/', clientFn: 'deleteSarprasInventoryItem' },
            { method: 'POST', endpoint: '/api/sarpras/inventory/', suffix: '/change-condition', clientFn: 'changeSarprasInventoryCondition' },
            { method: 'GET', endpoint: '/api/sarpras/inventory/', suffix: '/history', clientFn: 'getSarprasInventoryHistory' }
        ];

        sarprasEndpoints.forEach(item => {
            test(`Worker menangani ${item.method} ${item.endpoint}`, () => {
                expect(workerJs).toContain(item.endpoint);
                expect(clientJs).toContain(item.clientFn);
            });
        });

        test('Fungsi canManageSarpras terpasang pada worker.js dan memeriksa peran yang berwenang', () => {
            expect(workerJs).toContain('function canManageSarpras(user)');
            expect(workerJs).toContain('"admin_sarpras"');
            expect(workerJs).toContain('"sarpras"');
            expect(workerJs).toContain('"super_admin"');
        });

        test('Tabel sarpras_rooms dan sarpras_inventory_items dideklarasikan secara idempotent', () => {
            expect(workerJs).toContain('CREATE TABLE IF NOT EXISTS sarpras_rooms');
            expect(workerJs).toContain('CREATE TABLE IF NOT EXISTS sarpras_inventory_items');
            expect(workerJs).toContain('CREATE TABLE IF NOT EXISTS sarpras_condition_history');
        });
    });

    // 2. UJI REGISTRASI RBAC DAN MENU
    describe('2. Registrasi RBAC dan Menu Sidebar Global', () => {
        test('Role admin_sarpras terdaftar di MENU_CONFIG pada js/global.js', () => {
            expect(globalJs).toContain("'admin_sarpras':");
            expect(globalJs).toContain("'sarpras_inventaris'");
        });

        test('PAGE_ACCESS_CONFIG memiliki aturan izin untuk sarpras-inventaris.html', () => {
            expect(globalJs).toContain("'sarpras-inventaris.html':");
            expect(globalJs).toContain("'admin_sarpras': 'rw'");
            expect(globalJs).toContain("'sarpras': 'rw'");
            expect(globalJs).toContain("'super_admin': 'rw'");
        });

        test('sarpras_group terdaftar di MENU_GROUPS pada js/global.js', () => {
            expect(globalJs).toContain("key: 'sarpras_group'");
            expect(globalJs).toContain("label: 'Sarana & Prasarana'");
            expect(globalJs).toContain("'sarpras_inventaris'");
        });

        test('Admin Sarpras terdaftar di ADDITIONAL_ONLY_ROLES pada js/page-users.js', () => {
            expect(usersJs).toContain("value: 'admin_sarpras'");
            expect(usersJs).toContain("label: 'Admin Sarpras'");
        });
    });

    // 3. UJI INTEGRITAS DOM & MODAL ANTI-NESTING
    describe('3. Integritas DOM Modal & UX Form pada sarpras-inventaris.html', () => {
        test('Semua modal overlay pada sarpras-inventaris.html berdiri mandiri di luar <main>', () => {
            const noComments = inventarisHtml.replace(/<!--[\s\S]*?-->/g, '');
            const mainCloseIdx = noComments.indexOf('</main>');
            expect(mainCloseIdx).toBeGreaterThan(0);

            const modals = ['modal-item', 'modal-rooms', 'modal-condition', 'modal-detail', 'modal-print-kir', 'modal-print-qr'];
            modals.forEach(modalId => {
                const modalIdx = noComments.indexOf(`id="${modalId}"`);
                expect(modalIdx).toBeGreaterThan(mainCloseIdx);
            });
        });

        test('Tidak ada input dengan leading icon bertumpuk (anti-overlapping mandate)', () => {
            // Memastikan tidak ada pola class="relative ... pl-9/pl-10" dengan leading absolute icon di dalam input
            const inputWithPl10 = inventarisHtml.match(/<input[^>]+class="[^"]*\bpl-(?:9|10)\b[^"]*"/gi);
            expect(inputWithPl10).toBeNull();
        });

        test('Script client mendeklarasikan seluruh handler window yang dipanggil di HTML', () => {
            const eventHandlers = [
                'loadSarprasData', 'handleRoomFilterChange', 'handleCategoryFilterChange',
                'handleConditionFilterChange', 'handleSearchInput', 'resetSarprasFilter',
                'changePage', 'openModal', 'closeModal', 'calcFormTotalQty',
                'openCreateItemModal', 'openEditItemModal', 'submitItemForm', 'deleteItem',
                'openRoomsModal', 'resetRoomForm', 'editRoom', 'submitRoomForm',
                'deleteRoom', 'openConditionModal', 'submitConditionForm', 'openItemDetail',
                'openKirPrintModal', 'printCurrentRoomKir', 'printKirArea',
                'openQrPrintModal', 'printQrArea', 'exportSarprasExcel'
            ];

            eventHandlers.forEach(handler => {
                expect(inventarisJs).toContain(`window.${handler} = ${handler}`);
            });
        });

        test('Anti-Blank Screen Mandate: Wajib memuat global.js dan meng-unhide main', () => {
            expect(inventarisHtml).toContain('src="js/global.js"');
            expect(inventarisJs).toContain("classList.remove('hidden')");
        });
    });
});

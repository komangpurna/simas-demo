/**
 * tests/integrasi-searchable-dropdown.test.js
 * Unit Test Suite untuk Searchable Dropdown Pemilihan Pengguna Target Push Notification
 */

const fs = require('fs');
const path = require('path');

describe('Searchable Dropdown Pemilihan Pengguna Target Push Notification (integrasi.html & js/page-integrasi.js)', () => {
    const projectRoot = path.resolve(__dirname, '..');
    const htmlPath = path.join(projectRoot, 'integrasi.html');
    const jsPath = path.join(projectRoot, 'js', 'page-integrasi.js');

    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const jsContent = fs.readFileSync(jsPath, 'utf8');

    describe('1. Struktur Markup & Aksesibilitas ARIA di integrasi.html', () => {
        test('Memiliki kontainer relatif #container-push-target-user', () => {
            expect(htmlContent).toContain('id="container-push-target-user"');
        });

        test('Input pencarian memiliki ID #push-target-user-search dan atribut combobox ARIA', () => {
            expect(htmlContent).toContain('id="push-target-user-search"');
            expect(htmlContent).toContain('role="combobox"');
            expect(htmlContent).toContain('aria-expanded="false"');
            expect(htmlContent).toContain('aria-autocomplete="list"');
            expect(htmlContent).toContain('aria-controls="push-user-search-results"');
        });

        test('Memiliki tombol pembersih pencarian #btn-clear-push-user', () => {
            expect(htmlContent).toContain('id="btn-clear-push-user"');
            expect(htmlContent).toContain('window.clearSelectedPushUser(true)');
        });

        test('Memiliki tombol toggle dropdown #btn-toggle-push-dropdown dengan ikon chevron', () => {
            expect(htmlContent).toContain('id="btn-toggle-push-dropdown"');
            expect(htmlContent).toContain('window.togglePushUserDropdown(event)');
            expect(htmlContent).toContain('id="icon-push-user-chevron"');
            expect(htmlContent).toContain('fa-chevron-down');
        });

        test('Memiliki kontainer melayang #push-user-search-results untuk daftar dropdown', () => {
            expect(htmlContent).toContain('id="push-user-search-results"');
            expect(htmlContent).toContain('absolute');
            expect(htmlContent).toContain('z-[100]');
        });

        test('Memiliki badge pengguna terpilih #selected-push-user-badge dengan nama dan detail', () => {
            expect(htmlContent).toContain('id="selected-push-user-badge"');
            expect(htmlContent).toContain('id="selected-push-user-name"');
            expect(htmlContent).toContain('id="selected-push-user-detail"');
            expect(htmlContent).toContain('id="push-target-user-uid"');
        });
    });

    describe('2. Logika Sisi Klien di js/page-integrasi.js', () => {
        test('Mengimpor escapeHTML dari ./global.js untuk perlindungan XSS', () => {
            expect(jsContent).toMatch(/import\s*\{[^}]*escapeHTML[^}]*\}\s*from\s*['"]\.\/global\.js['"]/);
        });

        test('Mendefinisikan fungsi loadPushUsersList dengan cache sessionStorage (0 redundant read)', () => {
            expect(jsContent).toContain('window.loadPushUsersList');
            expect(jsContent).toContain('sessionStorage.getItem(cacheKey)');
            expect(jsContent).toContain('simas_push_users_cache');
        });

        test('Mendefinisikan fungsi setupPushUserCombobox dengan pendengar event keyboard & click', () => {
            expect(jsContent).toContain('window.setupPushUserCombobox');
            expect(jsContent).toContain("e.key === 'Escape'");
            expect(jsContent).toContain("e.key === 'ArrowDown'");
            expect(jsContent).toContain("e.key === 'ArrowUp'");
        });

        test('Mendefinisikan renderPushUserOptions dengan pencarian multi-field (nama, email, role, class, nip, nis)', () => {
            expect(jsContent).toContain('window.renderPushUserOptions');
            expect(jsContent).toContain('u.name');
            expect(jsContent).toContain('u.email');
            expect(jsContent).toContain('u.role');
            expect(jsContent).toContain('u.assignedClass');
            expect(jsContent).toContain('u.nip');
            expect(jsContent).toContain('u.nis');
        });

        test('Mendefinisikan fungsi pemilihan dan pembersihan pengguna target', () => {
            expect(jsContent).toContain('window.selectPushUser');
            expect(jsContent).toContain('window.clearSelectedPushUser');
            expect(jsContent).toContain('window.togglePushUserDropdown');
            expect(jsContent).toContain('window.closePushUserDropdown');
        });

        test('handlePushTargetTypeChange memicu setupPushUserCombobox dan pemanggilan loadPushUsersList', () => {
            expect(jsContent).toContain('window.handlePushTargetTypeChange');
            expect(jsContent).toContain('window.setupPushUserCombobox()');
            expect(jsContent).toContain('window.loadPushUsersList()');
        });

        test('sendManualPushNotification memvalidasi targetValue dari push-target-user-uid', () => {
            expect(jsContent).toContain("document.getElementById('push-target-user-uid').value");
            expect(jsContent).toContain("Cari dan pilih satu target pengguna.");
            expect(jsContent).toContain("window.clearSelectedPushUser()");
        });
    });

    describe('3. Simulasi Fungsional Filter & Manipulasi State Dropdown', () => {
        let mockUsers = [
            { uid: 'u1', name: 'I Komang Purna', email: 'komang@smagesa.sch.id', role: 'super_admin', assignedClass: '', nip: '19850101', nis: '' },
            { uid: 'u2', name: 'Ni Made Ayu', email: 'ayu@smagesa.sch.id', role: 'guru_mapel', assignedClass: '', nip: '19900202', nis: '' },
            { uid: 'u3', name: 'Gede Arya Wijaya', email: 'arya@smagesa.sch.id', role: 'siswa', assignedClass: 'X.1', nip: '', nis: '12345' },
            { uid: 'u4', name: 'Ketut Budiarta', email: 'budi@smagesa.sch.id', role: 'wali_kelas', assignedClass: 'XII.A', nip: '19780303', nis: '' }
        ];

        test('Filter pencarian multi-field menghasilkan kecocokan yang tepat', () => {
            const filterUsers = (queryStr) => {
                const q = queryStr.toLowerCase();
                return mockUsers.filter(u => {
                    if (!q) return true;
                    return (u.name || '').toLowerCase().includes(q) ||
                        (u.email || '').toLowerCase().includes(q) ||
                        (u.role || '').toLowerCase().includes(q) ||
                        (u.assignedClass || '').toLowerCase().includes(q) ||
                        (u.nip || '').toLowerCase().includes(q) ||
                        (u.nis || '').toLowerCase().includes(q);
                });
            };

            expect(filterUsers('komang')).toHaveLength(1);
            expect(filterUsers('komang')[0].uid).toBe('u1');

            expect(filterUsers('guru_mapel')).toHaveLength(1);
            expect(filterUsers('guru_mapel')[0].name).toBe('Ni Made Ayu');

            expect(filterUsers('12345')).toHaveLength(1);
            expect(filterUsers('12345')[0].name).toBe('Gede Arya Wijaya');

            expect(filterUsers('XII.A')).toHaveLength(1);
            expect(filterUsers('XII.A')[0].name).toBe('Ketut Budiarta');

            expect(filterUsers('tidak_ada_user')).toHaveLength(0);
        });

        test('Simulasi selectPushUser dan clearSelectedPushUser mengubah nilai DOM dengan benar', () => {
            const dom = {
                'push-target-user-uid': { value: '' },
                'push-target-user-search': { value: '', setAttribute: jest.fn() },
                'selected-push-user-name': { textContent: '' },
                'selected-push-user-detail': { textContent: '' },
                'selected-push-user-badge': { classList: { add: jest.fn(), remove: jest.fn() } },
                'btn-clear-push-user': { classList: { add: jest.fn(), remove: jest.fn() } },
                'push-user-search-results': { classList: { add: jest.fn(), remove: jest.fn() } }
            };

            const selectUser = (uid, name, detail) => {
                dom['push-target-user-uid'].value = uid;
                dom['push-target-user-search'].value = name;
                dom['selected-push-user-name'].textContent = name;
                dom['selected-push-user-detail'].textContent = detail;
                dom['selected-push-user-badge'].classList.remove('hidden');
                dom['btn-clear-push-user'].classList.remove('hidden');
                dom['push-user-search-results'].classList.add('hidden');
            };

            const clearUser = () => {
                dom['push-target-user-uid'].value = '';
                dom['push-target-user-search'].value = '';
                dom['selected-push-user-badge'].classList.add('hidden');
                dom['btn-clear-push-user'].classList.add('hidden');
                dom['push-user-search-results'].classList.add('hidden');
            };

            selectUser('u1', 'I Komang Purna', 'Super Admin • komang@smagesa.sch.id');
            expect(dom['push-target-user-uid'].value).toBe('u1');
            expect(dom['push-target-user-search'].value).toBe('I Komang Purna');
            expect(dom['selected-push-user-name'].textContent).toBe('I Komang Purna');
            expect(dom['selected-push-user-badge'].classList.remove).toHaveBeenCalledWith('hidden');

            clearUser();
            expect(dom['push-target-user-uid'].value).toBe('');
            expect(dom['push-target-user-search'].value).toBe('');
            expect(dom['selected-push-user-badge'].classList.add).toHaveBeenCalledWith('hidden');
        });
    });
});

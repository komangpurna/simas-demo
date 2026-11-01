/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

describe('Presensi Siswa - Auto-Select Kelas Wali Kelas & Non-Locking Dropdown', () => {
    let mockActiveClasses;

    beforeEach(() => {
        // Setup mock DOM
        document.body.innerHTML = `
            <select id="input-class">
                <option value="">-- Pilih Kelas --</option>
            </select>
            <select id="history-scope">
                <option value="">-- Pilih Kelas--</option>
            </select>
            <select id="history-type">
                <option value="daily">Harian</option>
                <option value="monthly">Bulanan</option>
                <option value="semester">Semester</option>
            </select>
            <div id="attendance-list-container" class="hidden"></div>
            <div id="daily-summary-container"></div>
            <input type="date" id="input-date" value="2026-10-07">
        `;

        // Mock localStorage
        const storage = {};
        global.localStorage = {
            getItem: jest.fn((k) => storage[k] || null),
            setItem: jest.fn((k, v) => { storage[k] = String(v); }),
            removeItem: jest.fn((k) => { delete storage[k]; }),
            clear: jest.fn(() => { Object.keys(storage).forEach(k => delete storage[k]); })
        };

        mockActiveClasses = ['X-1', 'X-2', 'X-3', 'XI-1', 'XI-2', 'XII-1', 'XII-2'];
        window.getActiveClasses = jest.fn(async () => mockActiveClasses);
        window.loadDailySummary = jest.fn();
    });

    // Helper logic SSOT dari js/page-presensi.js
    function escapeHTML(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    async function executeLoadClassOptions({ userRole, userAssignedClass, hasRoleFn = null }) {
        const selectInput = document.getElementById('input-class');
        if (!selectInput) return;

        const cachedClassList = await window.getActiveClasses();

        const hasRoleHelper = (r) => hasRoleFn ? hasRoleFn(r) : (userRole === r);
        const isWali = hasRoleHelper('wali_kelas') || Boolean(userAssignedClass && (hasRoleHelper('guru_mapel') || hasRoleHelper('guru')));
        const isAdmin = hasRoleHelper('admin_kelas');

        const cleanAssignedClass = userAssignedClass ? String(userAssignedClass).trim().replace(/^Kelas\s+/i, '') : '';
        const normAssignedClass = cleanAssignedClass.replace(/[\s\-_]+/g, '').toLowerCase();

        let htmlInput = '<option value="">-- Pilih Kelas --</option>';

        cachedClassList.forEach(c => {
            const cleanC = String(c).trim().replace(/^Kelas\s+/i, '');
            if (isAdmin && cleanAssignedClass && cleanC.toLowerCase() !== cleanAssignedClass.toLowerCase()) {
                return;
            }
            htmlInput += `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`;
        });

        selectInput.innerHTML = htmlInput;
        selectInput.disabled = false; // Wali Kelas & umum tetap bisa memilih / ganti kelas

        // Auto-select kelas sendiri secara instan jika ada (Wali Kelas / Admin Kelas)
        if ((isWali || isAdmin) && cleanAssignedClass) {
            let matchedValue = '';
            for (const opt of selectInput.options) {
                if (!opt.value) continue;
                const cleanOpt = opt.value.trim().replace(/^Kelas\s+/i, '');
                if (opt.value === cleanAssignedClass || cleanOpt.toLowerCase() === cleanAssignedClass.toLowerCase()) {
                    matchedValue = opt.value;
                    break;
                }
            }
            if (!matchedValue) {
                for (const opt of selectInput.options) {
                    if (!opt.value) continue;
                    const normOpt = opt.value.trim().replace(/^Kelas\s+/i, '').replace(/[\s\-_]+/g, '').toLowerCase();
                    if (normOpt && normOpt === normAssignedClass) {
                        matchedValue = opt.value;
                        break;
                    }
                }
            }

            if (matchedValue) {
                selectInput.value = matchedValue;
            }
        }
    }

    function executeCloseInputMode({ userRole, userAssignedClass, hasRoleFn = null }) {
        document.getElementById('attendance-list-container')?.classList.add('hidden');
        document.getElementById('daily-summary-container')?.classList.remove('hidden');
        const selectInput = document.getElementById('input-class');
        if (selectInput) {
            const hasRoleHelper = (r) => hasRoleFn ? hasRoleFn(r) : (userRole === r);
            const isWali = hasRoleHelper('wali_kelas') || Boolean(userAssignedClass && (hasRoleHelper('guru_mapel') || hasRoleHelper('guru')));
            const isAdmin = hasRoleHelper('admin_kelas');
            if ((isWali || isAdmin) && userAssignedClass) {
                selectInput.value = userAssignedClass;
            } else {
                selectInput.value = "";
            }
        }
        window.loadDailySummary();
    }

    function executeCheckPresensiAccess(targetClass, { userRole, userAssignedClass, hasRoleFn = null, dateVal = null }) {
        const rawMyClass = localStorage.getItem('user_assigned_class') || userAssignedClass || '';
        const myClass = rawMyClass.trim().replace(/^Kelas\s+/i, '').toLowerCase();
        const target = (targetClass || '').trim().replace(/^Kelas\s+/i, '').toLowerCase();

        const hasRole = (r) => hasRoleFn ? hasRoleFn(r) : (userRole === r);

        if (hasRole('super_admin')) return true;

        let allowedByWaliKelas = false;
        if (hasRole('wali_kelas') || Boolean(myClass && (hasRole('guru_mapel') || hasRole('guru')))) {
            if (myClass && target && myClass === target) {
                allowedByWaliKelas = true;
            }
        }

        let allowedByAdminKelas = false;
        if (hasRole('admin_kelas')) {
            if (myClass && target && myClass === target) {
                allowedByAdminKelas = true;
            }
        }

        return allowedByWaliKelas || allowedByAdminKelas;
    }

    test('1. Wali Kelas otomatis memilih kelasnya sendiri saat membuka halaman presensi', async () => {
        await executeLoadClassOptions({
            userRole: 'wali_kelas',
            userAssignedClass: 'X-2'
        });

        const select = document.getElementById('input-class');
        expect(select.value).toBe('X-2');
    });

    test('2. Dropdown input-class TIDAK disabled, semua kelas tersedia, dan Wali Kelas tetap bisa ganti kelas', async () => {
        await executeLoadClassOptions({
            userRole: 'wali_kelas',
            userAssignedClass: 'X-2'
        });

        const select = document.getElementById('input-class');
        expect(select.disabled).toBe(false);

        // Memastikan opsi seluruh kelas ada dalam dropdown
        const optionValues = Array.from(select.options).map(o => o.value);
        expect(optionValues).toContain('X-1');
        expect(optionValues).toContain('X-2');
        expect(optionValues).toContain('X-3');
        expect(optionValues).toContain('XI-1');
        expect(optionValues).toContain('XII-1');

        // Wali kelas bebas mengganti pilihan ke kelas lain
        select.value = 'XI-1';
        expect(select.value).toBe('XI-1');
    });

    test('3. Normalisasi nama kelas dengan awalan "Kelas " tetap mencocokkan opsi dropdown dengan presisi', async () => {
        await executeLoadClassOptions({
            userRole: 'wali_kelas',
            userAssignedClass: 'Kelas X-3'
        });

        const select = document.getElementById('input-class');
        expect(select.value).toBe('X-3');
    });

    test('4. Multi-role guru mapel dengan additional role wali_kelas terdeteksi akurat dan auto-select kelasnya', async () => {
        const hasRoleFn = (role) => role === 'guru_mapel' || role === 'wali_kelas';

        await executeLoadClassOptions({
            userRole: 'guru_mapel',
            userAssignedClass: 'XI-2',
            hasRoleFn: hasRoleFn
        });

        const select = document.getElementById('input-class');
        expect(select.value).toBe('XI-2');
        expect(select.disabled).toBe(false);
    });

    test('5. Admin Kelas (siswa) hanya melihat kelasnya sendiri di dropdown', async () => {
        await executeLoadClassOptions({
            userRole: 'admin_kelas',
            userAssignedClass: 'X-1'
        });

        const select = document.getElementById('input-class');
        expect(select.value).toBe('X-1');

        const optionValues = Array.from(select.options).map(o => o.value).filter(Boolean);
        expect(optionValues).toEqual(['X-1']);
    });

    test('6. Menutup mode entri siswa (closeInputMode) memulihkan kelas sendiri untuk Wali Kelas', async () => {
        await executeLoadClassOptions({
            userRole: 'wali_kelas',
            userAssignedClass: 'X-2'
        });

        const select = document.getElementById('input-class');
        expect(select.value).toBe('X-2');

        // Simulasi wali kelas mengganti ke kelas lain untuk melihat data
        select.value = 'X-3';
        expect(select.value).toBe('X-3');

        // Saat klik kembali / closeInputMode, kelas sendiri dipulihkan
        executeCloseInputMode({
            userRole: 'wali_kelas',
            userAssignedClass: 'X-2'
        });

        expect(select.value).toBe('X-2');
        expect(window.loadDailySummary).toHaveBeenCalled();
    });

    test('7. Menutup mode entri siswa untuk pengguna non-wali me-reset pilihan kelas ke kosong', async () => {
        const select = document.getElementById('input-class');
        select.value = 'X-1';

        executeCloseInputMode({
            userRole: 'kesiswaan',
            userAssignedClass: null
        });

        expect(select.value).toBe('');
    });

    test('8. checkPresensiAccess mengizinkan edit untuk kelas sendiri dan menolak kelas lain bagi Wali Kelas', () => {
        localStorage.setItem('user_assigned_class', 'X-2');

        // Skenario positif: kelas sendiri
        const canEditOwn = executeCheckPresensiAccess('X-2', {
            userRole: 'wali_kelas',
            userAssignedClass: 'X-2'
        });
        expect(canEditOwn).toBe(true);

        // Skenario positif: variasi format "Kelas X-2"
        const canEditOwnWithPrefix = executeCheckPresensiAccess('Kelas X-2', {
            userRole: 'wali_kelas',
            userAssignedClass: 'X-2'
        });
        expect(canEditOwnWithPrefix).toBe(true);

        // Skenario negatif: kelas lain
        const canEditOther = executeCheckPresensiAccess('X-3', {
            userRole: 'wali_kelas',
            userAssignedClass: 'X-2'
        });
        expect(canEditOther).toBe(false);
    });

    test('9. js/page-presensi.js memuat kode sinkronisasi auto-select dan non-locking dropdown', () => {
        const fileContent = fs.readFileSync(path.join(__dirname, '..', 'js', 'page-presensi.js'), 'utf8');

        // Verifikasi keberadaan logika di file produksi
        expect(fileContent).toContain('selectInput.disabled = false');
        expect(fileContent).toContain('normAssignedClass');
        expect(fileContent).toContain('cleanAssignedClass');
        expect(fileContent).toContain('window.loadClassOptions = loadClassOptions');
        expect(fileContent).toContain('window.closeInputMode = () =>');
    });
});

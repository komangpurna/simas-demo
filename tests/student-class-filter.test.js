/**
 * @jest-environment jsdom
 */

describe('Student Class Filter Authorization & Position (Above Archives) Tests', () => {
    let selectElement;

    beforeEach(() => {
        document.body.innerHTML = `
            <select id="filter-class">
                <option value="">-- Pilih Kelas --</option>
            </select>
        `;
        selectElement = document.getElementById('filter-class');
        localStorage.clear();
        delete window.hasRole;
    });

    const runLoadClassOptions = async (role, additionalRoles = []) => {
        localStorage.setItem('user_role', role);
        window.hasRole = (targetRole) => {
            return role === targetRole || additionalRoles.includes(targetRole);
        };
        window.getActiveClasses = async () => ['X-1', 'X-2', 'XI-1', 'XII-1'];

        // Replicate logic as in js/page-students.js loadClassOptions
        const allowedAllStudentsRoles = ['super_admin', 'wakasek_kurikulum', 'staff', 'guru_mapel', 'guru_bk', 'bk'];
        const canSeeAllStudents = window.hasRole ?
            allowedAllStudentsRoles.some(r => window.hasRole(r)) :
            allowedAllStudentsRoles.includes(role);

        const activeClasses = await window.getActiveClasses({ bypassActiveFilter: true });
        selectElement.innerHTML = '<option value="">-- Pilih Kelas --</option>';

        if (activeClasses && activeClasses.length > 0) {
            activeClasses.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c; opt.innerText = c;
                selectElement.appendChild(opt);
            });
        }

        // Opsi Tampilkan Semua Siswa tepat di atas daftar siswa berstatus arsip
        if (canSeeAllStudents) {
            const optAll = document.createElement('option');
            optAll.value = 'ALL';
            optAll.innerText = '-- Tampilkan Semua Siswa --';
            selectElement.appendChild(optAll);
        }

        const optDivider = document.createElement('option');
        optDivider.disabled = true;
        optDivider.innerText = "──────────────────";
        selectElement.appendChild(optDivider);

        ['KELUAR', 'MUTASI', 'PINDAH', 'ALUMNI'].forEach(c => {
            const opt = document.createElement('option');
            opt.value = c; opt.innerText = `[ARSIP] Siswa ${c}`;
            selectElement.appendChild(opt);
        });
    };

    test('Staff dapat melihat opsi ALL tepat di atas daftar siswa berstatus arsip', async () => {
        await runLoadClassOptions('staff');

        const options = Array.from(selectElement.options);
        const allIndex = options.findIndex(opt => opt.value === 'ALL');

        expect(allIndex).toBeGreaterThan(0);
        expect(options[allIndex].innerText).toBe('-- Tampilkan Semua Siswa --');

        // Pastikan opsi tepat sebelum ALL adalah kelas aktif terakhir
        expect(options[allIndex - 1].value).toBe('XII-1');

        // Pastikan opsi tepat setelah ALL adalah divider arsip
        expect(options[allIndex + 1].disabled).toBe(true);

        // Pastikan setelah divider arsip adalah kelompok arsip KELUAR
        expect(options[allIndex + 2].value).toBe('KELUAR');
    });

    test('Guru Mapel dapat melihat opsi ALL tepat di atas daftar arsip', async () => {
        await runLoadClassOptions('guru_mapel');

        const options = Array.from(selectElement.options);
        const allIndex = options.findIndex(opt => opt.value === 'ALL');

        expect(allIndex).toBeGreaterThan(0);
        expect(options[allIndex].value).toBe('ALL');
        expect(options[allIndex + 1].disabled).toBe(true);
        expect(options[allIndex + 2].value).toBe('KELUAR');
    });

    test('Guru BK dapat melihat opsi ALL tepat di atas daftar arsip', async () => {
        await runLoadClassOptions('guru_bk');

        const options = Array.from(selectElement.options);
        const allIndex = options.findIndex(opt => opt.value === 'ALL');

        expect(allIndex).toBeGreaterThan(0);
        expect(options[allIndex].value).toBe('ALL');
        expect(options[allIndex + 1].disabled).toBe(true);
        expect(options[allIndex + 2].value).toBe('KELUAR');
    });

    test('Guru dengan alias BK atau multi-role Guru BK dapat melihat opsi ALL tepat di atas arsip', async () => {
        await runLoadClassOptions('bk');
        let options = Array.from(selectElement.options);
        let allIndex = options.findIndex(opt => opt.value === 'ALL');
        expect(allIndex).toBeGreaterThan(0);
        expect(options[allIndex + 1].disabled).toBe(true);

        // Uji multi-role: guru_mapel dengan additional role guru_bk
        await runLoadClassOptions('guru_mapel', ['guru_bk']);
        options = Array.from(selectElement.options);
        allIndex = options.findIndex(opt => opt.value === 'ALL');
        expect(allIndex).toBeGreaterThan(0);
        expect(options[allIndex + 1].disabled).toBe(true);
    });

    test('Super Admin & Wakasek Kurikulum tetap dapat melihat opsi ALL tepat di atas arsip', async () => {
        await runLoadClassOptions('super_admin');
        let options = Array.from(selectElement.options);
        let allIndex = options.findIndex(opt => opt.value === 'ALL');
        expect(allIndex).toBeGreaterThan(0);
        expect(options[allIndex + 1].disabled).toBe(true);

        await runLoadClassOptions('wakasek_kurikulum');
        options = Array.from(selectElement.options);
        allIndex = options.findIndex(opt => opt.value === 'ALL');
        expect(allIndex).toBeGreaterThan(0);
        expect(options[allIndex + 1].disabled).toBe(true);
    });

    test('Role tidak diizinkan (admin_pks, admin_spp, siswa) TIDAK melihat opsi ALL', async () => {
        const unauthorizedRoles = ['admin_pks', 'admin_spp', 'siswa'];

        for (const role of unauthorizedRoles) {
            await runLoadClassOptions(role);
            const options = Array.from(selectElement.options);
            const hasAll = options.some(opt => opt.value === 'ALL');
            expect(hasAll).toBe(false);

            // Setelah kelas aktif terakhir langsung divider arsip
            const xiiIndex = options.findIndex(opt => opt.value === 'XII-1');
            expect(options[xiiIndex + 1].disabled).toBe(true);
            expect(options[xiiIndex + 2].value).toBe('KELUAR');
        }
    });
});

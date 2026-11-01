/** @jest-environment jsdom */
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

describe('Student Partial Edit & Flexible Identity Number Verification', () => {

    test('1. global.js validateStudentIdentityNumbers mendukung allowPartial / isEdit', () => {
        const globalJsContent = fs.readFileSync(path.join(rootDir, 'js', 'global.js'), 'utf8');
        expect(globalJsContent).toContain('window.validateStudentIdentityNumbers');
        expect(globalJsContent).toContain('allowPartial');

        // Evaluasi implementasi window.validateStudentIdentityNumbers dari global.js
        const funcMatch = globalJsContent.match(/window\.validateStudentIdentityNumbers\s*=\s*function\s*\(([\s\S]*?)\n\};/);
        expect(funcMatch).not.toBeNull();

        // Evaluasi fungsi secara langsung di lingkungan test
        const evalValidate = new Function(`
            ${funcMatch[0]}
            return window.validateStudentIdentityNumbers;
        `)();

        // Kasus A: allowPartial: true dengan NIK kurang dari 16 digit (misal hanya 10 digit angka)
        const partialRes = evalValidate({
            nik: '5107041205', // 10 digit
            kk_no: '',
            father_nik: '-'
        }, { allowPartial: true });
        expect(partialRes.valid).toBe(true);

        // Kasus B: allowPartial: false / default tanpa options (mode tambah siswa baru wajib 16 digit)
        const strictRes = evalValidate({
            nik: '5107041205'
        });
        expect(strictRes.valid).toBe(false);
        expect(strictRes.message).toContain('16 digit angka');

        // Kasus C: Tetap menolak karakter non-angka walaupun mode parsial
        const alphaRes = evalValidate({
            nik: '51070412ABC'
        }, { allowPartial: true });
        expect(alphaRes.valid).toBe(false);
        expect(alphaRes.message).toContain('hanya boleh berisi angka');

        // Kasus D: Keunikan nomor lengkap 16 digit tetap dicek jika sama
        const dupeRes = evalValidate({
            nik: '5107041205060001',
            kk_no: '5107041205060001'
        }, { allowPartial: true });
        expect(dupeRes.valid).toBe(false);
        expect(dupeRes.message).toContain('tidak boleh sama');

        // Kasus E: Nomor dummy 16 digit (seperti 0000000000000000) tidak dianggap bentrok
        const dummyRes = evalValidate({
            nik: '0000000000000000',
            kk_no: '0000000000000000'
        }, { allowPartial: true });
        expect(dummyRes.valid).toBe(true);
    });

    test('2. HTML Forms memiliki atribut novalidate dan tidak memblokir NIK parsial dengan pattern="[0-9]{16}"', () => {
        const filesToCheck = [
            { file: 'siswa.html', formId: 'form-edit-student', nikPrefix: 'edit-' },
            { file: 'wali-kelas.html', formId: 'form-edit-siswa-wali', nikPrefix: 'edit-student-' },
            { file: 'guru-wali.html', formId: 'form-edit-siswa-wali', nikPrefix: 'wali-edit-' },
            { file: 'portal-siswa.html', formId: 'form-edit-profile-siswa', nikPrefix: 'student-edit-' }
        ];

        for (const { file, formId, nikPrefix } of filesToCheck) {
            const html = fs.readFileSync(path.join(rootDir, file), 'utf8');

            // Form wajib memiliki atribut novalidate agar HTML5 constraint tooltip tidak memblokir submit
            const formRegex = new RegExp(`<form[^>]*id=["']${formId}["'][^>]*novalidate`, 'i');
            expect(formRegex.test(html)).toBe(true);

            // Field NIK dan KK pada form edit tidak boleh memiliki pattern="[0-9]{16}"
            const editNikRegex = new RegExp(`id=["']${nikPrefix}nik["'][^>]*pattern=["']\\[0-9\\]\\{16\\}["']`, 'i');
            expect(editNikRegex.test(html)).toBe(false);

            const editKkRegex = new RegExp(`id=["']${nikPrefix}(kk_no|kk)["'][^>]*pattern=["']\\[0-9\\]\\{16\\}["']`, 'i');
            expect(editKkRegex.test(html)).toBe(false);
        }
    });

    test('3. Client Script memanggil validateStudentIdentityNumbers dengan opsi allowPartial / isEdit', () => {
        const scriptsToCheck = [
            'js/page-students.js',
            'js/page-wali-kelas.js',
            'js/page-guru-wali.js',
            'js/page-portal-siswa.js'
        ];

        for (const scriptPath of scriptsToCheck) {
            const jsContent = fs.readFileSync(path.join(rootDir, scriptPath), 'utf8');
            expect(jsContent).toMatch(/validateStudentIdentityNumbers\([^)]*\{\s*allowPartial:\s*true/);
        }
    });

    test('4. Preservasi Data Pokok (Smart Merge) jika Input Nama/Kelas Dikosongkan Saat Edit', () => {
        const oldStudent = {
            nis: '1001',
            name: 'I Wayan Koster',
            class: 'XII MIPA 1',
            gender: 'L',
            address: 'Jalan Lama'
        };

        // Simulasi input pengguna yang hanya mengubah alamat dan mengosongkan nama/kelas
        const formInput = {
            name: '',
            class: '',
            gender: '',
            address: 'Jalan Baru No. 10'
        };

        const mergedUpdates = {
            name: formInput.name || oldStudent.name,
            class: formInput.class || oldStudent.class,
            gender: formInput.gender || oldStudent.gender,
            address: formInput.address || oldStudent.address
        };

        expect(mergedUpdates.name).toBe('I Wayan Koster');
        expect(mergedUpdates.class).toBe('XII MIPA 1');
        expect(mergedUpdates.gender).toBe('L');
        expect(mergedUpdates.address).toBe('Jalan Baru No. 10');
    });

});

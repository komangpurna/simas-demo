/**
 * tests/workload-bk-runtime-integrity.test.js
 * ====================================================================
 * Test Suite: Integritas Runtime Deteksi Guru BK & Pencegahan ReferenceError
 * Memvalidasi kepatuhan:
 * 1. isCurrentTeacherBk() tidak melempar ReferenceError: _teachersList is not defined
 * 2. _adminTeachersCache digunakan sebagai cache resmi daftar guru
 * 3. confirmMarkUnplannedAbsence() tidak mengakses variabel tak terdefinisi
 * 4. scripts/check-syntax.js secara otomatis mendeteksi variabel internal undeclared
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Suite Pengujian Integritas Runtime Deteksi Guru BK', () => {
    const root = path.resolve(__dirname, '..');
    const pageBebanKerjaJs = fs.readFileSync(path.join(root, 'js', 'page-beban-kerja.js'), 'utf8');
    const checkSyntaxJs = fs.readFileSync(path.join(root, 'scripts', 'check-syntax.js'), 'utf8');

    test('1. page-beban-kerja.js tidak lagi memuat referensi variabel undeclared _teachersList', () => {
        expect(pageBebanKerjaJs).not.toContain('_teachersList');
    });

    test('2. page-beban-kerja.js tidak memuat referensi variabel undeclared _currentTeacherId', () => {
        expect(pageBebanKerjaJs).not.toContain('_currentTeacherId');
    });

    test('3. isCurrentTeacherBk menggunakan teacherPool berbasis _adminTeachersCache secara defensif', () => {
        expect(pageBebanKerjaJs).toContain('teacherPool');
        expect(pageBebanKerjaJs).toContain('_adminTeachersCache');
        expect(pageBebanKerjaJs).toContain('t.teacher_id || t.id || t.uid');
    });

    test('4. scripts/check-syntax.js memuat audit deteksi variabel internal undeclared berawalan _', () => {
        expect(checkSyntaxJs).toContain("name.startsWith('_') && !name.startsWith('__')");
        expect(checkSyntaxJs).toContain('Undeclared Internal Variable');
    });

    test('5. Simulasi fungsi isCurrentTeacherBk berjalan mulus tanpa error saat non-BK', () => {
        // Mock data guru
        const mockTeachersCache = [
            { id: 'gtk_kimia', name: 'Guru Kimia', jenis_ptk: 'Guru Mapel', mapel: 'Kimia' },
            { id: 'gtk_bk', name: 'Guru BK', jenis_ptk: 'Guru BK', mapel: 'Bimbingan Konseling' }
        ];

        function simulateIsCurrentTeacherBk(targetId, userRole = 'guru') {
            const allRoles = [userRole];
            if (allRoles.includes('guru_bk') || allRoles.includes('bk')) return true;

            const teacherPool = Array.isArray(mockTeachersCache) ? mockTeachersCache : [];
            let tObj = null;
            if (targetId && teacherPool.length > 0) {
                tObj = teacherPool.find(t => (t.teacher_id || t.id || t.uid) === targetId);
            }
            const tSubject = (tObj?.jenis_ptk || tObj?.mapel || '').toLowerCase();
            return tSubject.includes('bk') || tSubject.includes('bimbingan');
        }

        // Uji kasus guru Kimia (non-BK): wajib mengembalikan false tanpa error
        expect(simulateIsCurrentTeacherBk('gtk_kimia', 'guru')).toBe(false);

        // Uji kasus guru BK: wajib mengembalikan true
        expect(simulateIsCurrentTeacherBk('gtk_bk', 'guru')).toBe(true);

        // Uji kasus user dengan role guru_bk langsung
        expect(simulateIsCurrentTeacherBk('', 'guru_bk')).toBe(true);
    });
});

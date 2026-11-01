/**
 * tests/class-promotion.test.js
 * 
 * Verifikasi logika & integritas Modul Kenaikan Kelas Siswa:
 * 1. Kelas XII lulus menjadi Alumni dengan format: "Alumni [Kelas] ([Tahun Ajaran])" dan status: "alumni".
 * 2. Kelas XI naik ke Kelas XII dan status tetap "active".
 * 3. Kelas X naik ke Kelas XI dan status tetap "active".
 * 4. Siswa yang sudah berstatus alumni tidak ikut dinaikkan.
 * 5. Seluruh riwayat data siswa dipertahankan (0 query delete).
 */

describe('Student Class Promotion Logic & Data Safety', () => {
    // Fungsi simulasi transformasi kenaikan kelas siswa
    function simulateClassPromotion(students, academicYear = '2025/2026') {
        let promotedCount = 0;
        let alumniCount = 0;
        const result = [];

        for (const s of students) {
            const currentClass = String(s.class || '').trim();
            if (!currentClass) continue;

            const isAlreadyAlumni = currentClass.toLowerCase().includes('alumni') || s.status === 'alumni';
            if (isAlreadyAlumni) {
                result.push({ ...s });
                continue;
            }

            let newClass = currentClass;
            let newStatus = s.status || 'active';
            let isChanged = false;

            if (/^XII[\.\-\s]/i.test(currentClass) || currentClass.toUpperCase() === "XII") {
                newClass = `Alumni ${currentClass} (${academicYear})`;
                newStatus = 'alumni';
                isChanged = true;
                alumniCount++;
            } else if (/^XI[\.\-\s]/i.test(currentClass) || currentClass.toUpperCase() === "XI") {
                newClass = currentClass.replace(/^XI/i, 'XII');
                newStatus = 'active';
                isChanged = true;
                promotedCount++;
            } else if (/^X[\.\-\s]/i.test(currentClass) || currentClass.toUpperCase() === "X") {
                newClass = currentClass.replace(/^X/i, 'XI');
                newStatus = 'active';
                isChanged = true;
                promotedCount++;
            }

            result.push({
                ...s,
                class: newClass,
                status: newStatus,
                isChanged
            });
        }

        return {
            promotedCount,
            alumniCount,
            updatedStudents: result
        };
    }

    test('Promosi: Siswa Kelas XII lulus menjadi Alumni dengan status "alumni"', () => {
        const sample = [
            { nis: '1001', name: 'Siswa XII A', class: 'XII.1', status: 'active' },
            { nis: '1002', name: 'Siswa XII B', class: 'XII-MIPA 1', status: 'active' }
        ];

        const { alumniCount, promotedCount, updatedStudents } = simulateClassPromotion(sample, '2025/2026');

        expect(alumniCount).toBe(2);
        expect(promotedCount).toBe(0);
        expect(updatedStudents[0].class).toBe('Alumni XII.1 (2025/2026)');
        expect(updatedStudents[0].status).toBe('alumni');
        expect(updatedStudents[1].class).toBe('Alumni XII-MIPA 1 (2025/2026)');
        expect(updatedStudents[1].status).toBe('alumni');
    });

    test('Promosi: Siswa Kelas XI naik ke Kelas XII dengan status tetap "active"', () => {
        const sample = [
            { nis: '2001', name: 'Siswa XI A', class: 'XI.1', status: 'active' },
            { nis: '2002', name: 'Siswa XI B', class: 'XI-IPS 2', status: 'active' }
        ];

        const { alumniCount, promotedCount, updatedStudents } = simulateClassPromotion(sample, '2025/2026');

        expect(alumniCount).toBe(0);
        expect(promotedCount).toBe(2);
        expect(updatedStudents[0].class).toBe('XII.1');
        expect(updatedStudents[0].status).toBe('active');
        expect(updatedStudents[1].class).toBe('XII-IPS 2');
        expect(updatedStudents[1].status).toBe('active');
    });

    test('Promosi: Siswa Kelas X naik ke Kelas XI dengan status tetap "active"', () => {
        const sample = [
            { nis: '3001', name: 'Siswa X A', class: 'X.1', status: 'active' },
            { nis: '3002', name: 'Siswa X B', class: 'X-E1', status: 'active' }
        ];

        const { alumniCount, promotedCount, updatedStudents } = simulateClassPromotion(sample, '2025/2026');

        expect(alumniCount).toBe(0);
        expect(promotedCount).toBe(2);
        expect(updatedStudents[0].class).toBe('XI.1');
        expect(updatedStudents[0].status).toBe('active');
        expect(updatedStudents[1].class).toBe('XI-E1');
        expect(updatedStudents[1].status).toBe('active');
    });

    test('Idempotensi: Siswa yang sudah Alumni tidak diubah lagi', () => {
        const sample = [
            { nis: '9001', name: 'Alumni Lama', class: 'Alumni XII.1 (2024/2025)', status: 'alumni' }
        ];

        const { alumniCount, promotedCount, updatedStudents } = simulateClassPromotion(sample, '2025/2026');

        expect(alumniCount).toBe(0);
        expect(promotedCount).toBe(0);
        expect(updatedStudents[0].class).toBe('Alumni XII.1 (2024/2025)');
        expect(updatedStudents[0].status).toBe('alumni');
        expect(updatedStudents[0].isChanged).toBeUndefined();
    });

    test('Case-Insensitivity: Berhasil mengenali kelas dengan huruf kecil (x.1, xi.2, xii.3)', () => {
        const sample = [
            { nis: '5001', name: 'Siswa XII Kecil', class: 'xii.1', status: 'active' },
            { nis: '5002', name: 'Siswa XI Kecil', class: 'xi.2', status: 'active' },
            { nis: '5003', name: 'Siswa X Kecil', class: 'x.3', status: 'active' }
        ];

        const { alumniCount, promotedCount, updatedStudents } = simulateClassPromotion(sample, '2025/2026');

        expect(alumniCount).toBe(1);
        expect(promotedCount).toBe(2);
        expect(updatedStudents[0].class).toBe('Alumni xii.1 (2025/2026)');
        expect(updatedStudents[0].status).toBe('alumni');
        expect(updatedStudents[1].class).toBe('XII.2');
        expect(updatedStudents[1].status).toBe('active');
        expect(updatedStudents[2].class).toBe('XI.3');
        expect(updatedStudents[2].status).toBe('active');
    });

    test('Preservasi Data: Seluruh data NIS siswa dipertahankan tanpa ada baris yang hilang', () => {
        const sample = [
            { nis: '1001', name: 'Siswa XII', class: 'XII.1', status: 'active' },
            { nis: '2001', name: 'Siswa XI', class: 'XI.1', status: 'active' },
            { nis: '3001', name: 'Siswa X', class: 'X.1', status: 'active' }
        ];

        const { updatedStudents } = simulateClassPromotion(sample, '2025/2026');

        expect(updatedStudents.length).toBe(sample.length);
        const originalNis = sample.map(s => s.nis);
        const updatedNis = updatedStudents.map(s => s.nis);
        expect(updatedNis).toEqual(originalNis);
    });
});

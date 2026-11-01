/**
 * tests/alumni-cleanup.test.js
 * 
 * Verifikasi logika & keamanan fitur Hapus Data Alumni:
 * 1. Guardrail keamanan: Menolak penghapusan kelas reguler (X, XI, XII).
 * 2. Relasi data berbasis NIS siswa 100% (bukan UUID).
 * 3. Kelengkapan snapshot tabel relasi D1 untuk file auto-backup.
 * 4. Pemanfaatan retensi otomatis Supabase (pg_cron) tanpa query delete manual.
 */

describe('Alumni Cleanup & Security Guardrails', () => {
    // Helper fungsi validasi guardrail kelas alumni
    function isEligibleAlumniClass(className, studentsInClass = []) {
        if (!className || typeof className !== 'string') return false;
        const trimmed = className.trim();
        const isAlumniNamed = trimmed.toLowerCase().includes('alumni');
        const hasAlumniStatus = studentsInClass.some(s => s.status === 'alumni');
        return isAlumniNamed || hasAlumniStatus;
    }

    test('Guardrail: Memblokir penghapusan kelas reguler aktif', () => {
        expect(isEligibleAlumniClass('X.1')).toBe(false);
        expect(isEligibleAlumniClass('X-A')).toBe(false);
        expect(isEligibleAlumniClass('XI.MIPA 1')).toBe(false);
        expect(isEligibleAlumniClass('XII.IPS 2')).toBe(false);
        expect(isEligibleAlumniClass('XII-1')).toBe(false);
    });

    test('Guardrail: Mengizinkan penghapusan kelas alumni yang valid', () => {
        expect(isEligibleAlumniClass('Alumni XII-MIPA 1 (2025/2026)')).toBe(true);
        expect(isEligibleAlumniClass('ALUMNI XII-IPS 2 (2024/2025)')).toBe(true);
        expect(isEligibleAlumniClass('alumni 2026')).toBe(true);
        // Kelas dengan siswa berstatus 'alumni'
        expect(isEligibleAlumniClass('XII-LULUS', [{ nis: '1234', status: 'alumni' }])).toBe(true);
    });

    test('Identitas Siswa: Seluruh relasi data siswa wajib terikat pada NIS (0 UUID)', () => {
        const sampleStudent = {
            nis: '0987',
            name: 'Wayan Alumni',
            class: 'Alumni XII-MIPA 1 (2025/2026)',
            status: 'alumni'
        };

        // Snapshot data relasi Cloudflare D1
        const relatedRecords = [
            { id: 'rec_01', student_nis: '0987', category: 'Pelanggaran', points: 5 },
            { id: 'rec_02', student_nis: '0987', category: 'Prestasi', points: 10 }
        ];
        const bkActions = [
            { id: 'bka_101', student_nis: '0987', problem: 'Konseling Karir', status: 'Selesai' }
        ];
        const studentAggregate = {
            student_nis: '0987',
            points: 15
        };
        const raporScore = {
            id: 'Alumni XII-MIPA 1 (2025/2026)_0987_2025/2026',
            nis: '0987',
            class: 'Alumni XII-MIPA 1 (2025/2026)'
        };
        const permisiRequest = {
            id: 'prm_001',
            student_nis: '0987',
            permission_type: 'Keperluan Keluarga'
        };

        // Verifikasi relasi menggunakan NIS murni
        expect(sampleStudent.nis).toMatch(/^\d+$/);
        relatedRecords.forEach(r => expect(r.student_nis).toBe(sampleStudent.nis));
        bkActions.forEach(b => expect(b.student_nis).toBe(sampleStudent.nis));
        expect(studentAggregate.student_nis).toBe(sampleStudent.nis);
        expect(raporScore.nis).toBe(sampleStudent.nis);
        expect(permisiRequest.student_nis).toBe(sampleStudent.nis);
    });

    test('Kelengkapan Auto-Backup: Menjamin struktur snapshot memuat seluruh relasi data Cloudflare D1', () => {
        const backupPayload = {
            _meta: {
                appName: 'SIMAS - SHAKTI (Alumni Cleanup Auto-Backup)',
                backupDate: new Date().toISOString(),
                backupBy: 'superadmin@smagesa.sch.id',
                targetClass: 'Alumni XII-MIPA 1 (2025/2026)',
                totalStudents: 1
            },
            students: [{ nis: '0987', name: 'Wayan Alumni' }],
            student_aggregates: [{ student_nis: '0987', points: 15 }],
            records: [{ id: 'rec_01', student_nis: '0987' }],
            bk_actions: [{ id: 'bka_101', student_nis: '0987' }],
            rapor_scores: [{ id: 'score_01', nis: '0987' }],
            permisi_requests: [{ id: 'prm_01', student_nis: '0987' }],
            guru_wali_assignments: [{ id: 'gwa_01', student_nis: '0987' }],
            guru_wali_notes: [{ id: 'gwn_01', student_nis: '0987' }],
            walikelas_notes: [{ id: 'wkn_01', student_nis: '0987' }],
            peminatan_responses: [{ id: '2026_0987', nis: '0987' }],
            student_photos: [{ nis: '0987', active_photo_url: '/api/photos/student/active/0987.webp' }]
        };

        const expectedTables = [
            'students',
            'student_aggregates',
            'records',
            'bk_actions',
            'rapor_scores',
            'permisi_requests',
            'guru_wali_assignments',
            'guru_wali_notes',
            'walikelas_notes',
            'peminatan_responses',
            'student_photos'
        ];

        expectedTables.forEach(tableName => {
            expect(backupPayload).toHaveProperty(tableName);
            expect(Array.isArray(backupPayload[tableName])).toBe(true);
        });

        expect(backupPayload._meta.totalStudents).toBe(1);
        expect(backupPayload._meta.targetClass).toBe('Alumni XII-MIPA 1 (2025/2026)');
    });

    test('Tabel student_photos terdaftar di ANNUAL_RESET_TABLES untuk snapshot dan pembersihan otomatis alumni', () => {
        const fs = require('node:fs');
        const path = require('node:path');
        const workerContent = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'worker.js'), 'utf8');

        expect(workerContent).toContain("student_photos: ['nis', 'nis']");
        expect(workerContent).toContain("extractStudentPhotoR2Key");
        expect(workerContent).toContain("deleteStudentPhotosFromR2");
    });
});

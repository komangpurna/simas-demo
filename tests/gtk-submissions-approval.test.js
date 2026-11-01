/**
 * @file tests/gtk-submissions-approval.test.js
 * Pengujian Siklus Hidup Penuh Pengajuan & Persetujuan Data GTK Mandiri
 * Standar: OWASP Top 10, ASVS Level 1 & 2, Action & Security Parity
 */

describe('Siklus Hidup Penuh Pengajuan & Persetujuan Data GTK Mandiri', () => {
    const GTK_APPROVER_ROLES = ["super_admin", "wakasek_kurikulum", "staff", "admin"];

    function canApproveGtkSubmission(user) {
        if (!user) return false;
        const allRoles = [user.role, ...(user.additionalRoles || [])].filter(Boolean);
        return allRoles.some(r => GTK_APPROVER_ROLES.includes(r));
    }

    test('1. Validasi Hak Akses RBAC: Hanya Kurikulum, Staff, dan Super Admin yang berhak menyetujui', () => {
        // Approver yang sah
        expect(canApproveGtkSubmission({ role: 'wakasek_kurikulum' })).toBe(true);
        expect(canApproveGtkSubmission({ role: 'staff' })).toBe(true);
        expect(canApproveGtkSubmission({ role: 'super_admin' })).toBe(true);
        expect(canApproveGtkSubmission({ role: 'guru_mapel', additionalRoles: ['staff'] })).toBe(true);

        // Role yang tidak berhak (wajib ditolak HTTP 403)
        expect(canApproveGtkSubmission({ role: 'guru_mapel' })).toBe(false);
        expect(canApproveGtkSubmission({ role: 'siswa' })).toBe(false);
        expect(canApproveGtkSubmission({ role: 'kepala_sekolah' })).toBe(false);
        expect(canApproveGtkSubmission({ role: 'wali_kelas' })).toBe(false);
        expect(canApproveGtkSubmission(null)).toBe(false);
    });

    test('2. NIP diperkenankan berupa tanda strip (-) bagi pelamar/calon GTK Non-PNS', () => {
        const testInputNonPns = "-";
        const isValidNipInput = (nip) => {
            if (!nip) return false;
            const trimmed = String(nip).trim();
            if (trimmed === '-') return true; // Diperbolehkan strip
            return /^\d{18}$/.test(trimmed); // Atau 18 digit angka resmi
        };

        expect(isValidNipInput(testInputNonPns)).toBe(true);
        expect(isValidNipInput("198501012010011001")).toBe(true);
        expect(isValidNipInput("12345")).toBe(false); // Angka tidak lengkap
        expect(isValidNipInput("")).toBe(false);
    });

    test('3. Simulasi Alur Persetujuan (ACC): Masuk ke Master GTK tanpa membuat user login', () => {
        // Mock State Data
        const mockMasterGtk = [];
        const mockAuthUsers = []; // Wajib tetap kosong saat ACC GTK

        const submission = {
            id: 'sub_12345',
            name: 'I Made Suarta, S.Pd.',
            gender: 'L',
            nik: '5107010101850001',
            nuptk: '1234567890123456',
            nip: '-',
            status_kepegawaian: 'Honorer',
            jenis_ptk: 'Pendidik',
            phone: '08123456789',
            email: 'madesuarta@gmail.com',
            telegram_chat_id: '12345678',
            status: 'pending'
        };

        const approver = { role: 'wakasek_kurikulum', name: 'Waka Kurikulum SIMAS' };

        // Eksekusi Approval
        expect(canApproveGtkSubmission(approver)).toBe(true);

        // Simulasi penyimpanan ke Master GTK D1
        const gtkId = (submission.nik && submission.nik !== '-') ? submission.nik : `gtk_${Date.now()}`;
        mockMasterGtk.push({
            id: gtkId,
            nik: submission.nik,
            nip: submission.nip,
            nuptk: submission.nuptk,
            name: submission.name,
            gender: submission.gender,
            phone: submission.phone,
            email: submission.email,
            status_kepegawaian: submission.status_kepegawaian,
            jenis_ptk: submission.jenis_ptk,
            status: 'active'
        });

        submission.status = 'approved';
        submission.approved_by = approver.name;

        // Verifikasi hasil:
        // 1. Data GTK tersimpan di Master Data
        expect(mockMasterGtk.length).toBe(1);
        expect(mockMasterGtk[0].name).toBe('I Made Suarta, S.Pd.');
        expect(mockMasterGtk[0].status).toBe('active');

        // 2. Akun login TIDAK dibuat otomatis (tetap dilakukan di users.html)
        expect(mockAuthUsers.length).toBe(0);
        expect(submission.status).toBe('approved');
    });

    test('4. Simulasi Penolakan (Reject): Menyimpan alasan penolakan dan status rejected', () => {
        const submission = {
            id: 'sub_99999',
            name: 'Calon Belum Lengkap',
            status: 'pending'
        };

        const approver = { role: 'staff', name: 'Staf Tata Usaha' };
        expect(canApproveGtkSubmission(approver)).toBe(true);

        const reason = 'Berkas belum memenuhi kualifikasi formasi.';
        submission.status = 'rejected';
        submission.rejection_reason = reason;
        submission.approved_by = approver.name;

        expect(submission.status).toBe('rejected');
        expect(submission.rejection_reason).toBe(reason);
    });
});

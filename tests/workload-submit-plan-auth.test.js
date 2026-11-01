const fs = require('fs');
const path = require('path');

describe('Full Lifecycle Security & Action Parity - Workload Submit Plan Authorization', () => {
    let workerContent;

    beforeAll(() => {
        workerContent = fs.readFileSync(path.join(__dirname, '../cloudflare/worker.js'), 'utf8');
    });

    test('1. cloudflare/worker.js submit-plan wajib menggunakan resolveWorkloadTeacherId dan isWorkloadOwner', () => {
        // Memastikan tidak ada lagi bug legacy authResult.user.linkedTeacherId || authResult.user.uid tanpa resolve
        const submitPlanBlock = workerContent.match(/if \(\(path === "\/api\/workload\/submit-plan" && method === "POST"\)[\s\S]*?if \(!isMgr && !isWorkloadOwner\(version\.teacher_id, authResult\.user, userTeacherId\)\)/);
        expect(submitPlanBlock).not.toBeNull();
        expect(submitPlanBlock[0]).toContain('const userTeacherId = await resolveWorkloadTeacherId(env.DB, authResult.user);');
        expect(submitPlanBlock[0]).toContain('!isWorkloadOwner(version.teacher_id, authResult.user, userTeacherId)');
    });

    test('2. Fungsi helper isWorkloadOwner mendukung multi-identifier (GTK ID, Firebase UID, linkedTeacherId)', () => {
        // Ekstrak fungsi isWorkloadOwner dari worker.js untuk diuji secara fungsional
        const isOwnerMatch = workerContent.match(/function isWorkloadOwner\(targetTeacherId, user, resolvedTeacherId = null\) \{[\s\S]*?\n            \}/);
        expect(isOwnerMatch).not.toBeNull();

        const isWorkloadOwner = new Function('targetTeacherId', 'user', 'resolvedTeacherId', `
            ${isOwnerMatch[0]}
            return isWorkloadOwner(targetTeacherId, user, resolvedTeacherId);
        `);

        const mockUser = {
            uid: 'firebase_auth_uid_123',
            linkedTeacherId: 'linked_gtk_456',
            profile: { linkedTeacherId: 'profile_gtk_789' }
        };

        const resolvedGtkId = 'd1_gtk_record_001';

        // Skenario Positif 1: Cocok dengan resolvedTeacherId (Kasus riil bug guru: ww.teacher_id = GTK ID)
        expect(isWorkloadOwner(resolvedGtkId, mockUser, resolvedGtkId)).toBe(true);

        // Skenario Positif 2: Cocok dengan Firebase UID
        expect(isWorkloadOwner('firebase_auth_uid_123', mockUser, resolvedGtkId)).toBe(true);

        // Skenario Positif 3: Cocok dengan linkedTeacherId
        expect(isWorkloadOwner('linked_gtk_456', mockUser, resolvedGtkId)).toBe(true);

        // Skenario Positif 4: Cocok dengan profile.linkedTeacherId
        expect(isWorkloadOwner('profile_gtk_789', mockUser, resolvedGtkId)).toBe(true);

        // Skenario Negatif: Pengguna lain yang tidak cocok identitasnya
        expect(isWorkloadOwner('other_teacher_gtk_999', mockUser, resolvedGtkId)).toBe(false);
        expect(isWorkloadOwner('other_teacher_gtk_999', null, resolvedGtkId)).toBe(false);
        expect(isWorkloadOwner(null, mockUser, resolvedGtkId)).toBe(false);
    });

    test('3. Seluruh endpoint mutasi beban kerja terproteksi oleh isWorkloadOwner', () => {
        expect(workerContent).toContain('!isWorkloadOwner(version.teacher_id, authResult.user, userTeacherId)');
        expect(workerContent).toContain('!isWorkloadOwner(seg.teacher_id, authResult.user, userTeacherId)');
        expect(workerContent).toContain('!isWorkloadOwner(existing.teacher_id, authResult.user, userTeacherId)');
    });

    test('4. Inisialisasi auth di js/page-beban-kerja.js tidak memanggil loadAll sebelum token siap (Zero 401)', () => {
        const pageContent = fs.readFileSync(path.join(__dirname, '../js/page-beban-kerja.js'), 'utf8');
        // Pastikan tidak ada pemanggilan loadAll() telanjang langsung setelah renderStatusBadge()
        expect(pageContent).not.toMatch(/renderStatusBadge\(\);\s*loadAll\(\);/);
        // Pastikan ada pengecekan auth.currentUser atau onAuthStateChanged
        expect(pageContent).toMatch(/if \(auth && typeof auth\.onAuthStateChanged === 'function'\)/);
    });
});

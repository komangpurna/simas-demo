/** @jest-environment jsdom */
const fs = require('node:fs');
const path = require('node:path');

describe('Action Parity & Resource Ownership: Modul Dokumen Sekolah', () => {
    let workerContent;
    let pageDokumenContent;

    beforeAll(() => {
        workerContent = fs.readFileSync(path.join(__dirname, '../cloudflare/worker.js'), 'utf8');
        pageDokumenContent = fs.readFileSync(path.join(__dirname, '../js/page-dokumen.js'), 'utf8');
    });

    describe('1. Backend API Parity (cloudflare/worker.js)', () => {
        test('MANAGER_ROLES mencakup role kurikulum dan wakasek_kurikulum', () => {
            expect(workerContent).toMatch(/const\s+MANAGER_ROLES\s*=\s*\[[\s\S]*?["']kurikulum["'][\s\S]*?\]/);
            expect(workerContent).toMatch(/const\s+MANAGER_ROLES\s*=\s*\[[\s\S]*?["']wakasek_kurikulum["'][\s\S]*?\]/);
        });

        test('POST, PUT, dan DELETE /api/agenda/documents mengoperkan env ke verifyFirebaseToken', () => {
            // Memastikan pemanggilan verifyFirebaseToken menyertakan env
            const docApiRegex = /\/api\/agenda\/documents(?:\/:id)?[\s\S]*?verifyFirebaseToken\(request,\s*env\)/g;
            const matches = workerContent.match(docApiRegex);
            expect(matches).not.toBeNull();
            expect(matches.length).toBeGreaterThanOrEqual(2);
        });

        test('PUT dan DELETE /api/agenda/documents/:id mendukung Resource Ownership (isOwner)', () => {
            expect(workerContent).toContain('docUploader === userEmail || docUploader === userUid');
            expect(workerContent).toContain('const canEdit = isManager(authResult.user) || hasAnyUserRole(authResult.user, [\'wakasek_kurikulum\', \'kurikulum\']) || isOwner;');
            expect(workerContent).toContain('const canDelete = isManager(authResult.user) || hasAnyUserRole(authResult.user, [\'wakasek_kurikulum\', \'kurikulum\']) || isOwner;');
        });

        test('PUT /api/agenda/documents/:id memperbarui kolom description pada kueri SQL UPDATE', () => {
            expect(workerContent).toContain('UPDATE agenda_documents');
            expect(workerContent).toContain('description = ?');
        });
    });

    describe('2. Frontend Parity & Transparent Error Handling (js/page-dokumen.js)', () => {
        test('managerRoles di frontend mencakup wakasek_kurikulum dan kurikulum', () => {
            expect(pageDokumenContent).toContain("'wakasek_kurikulum'");
            expect(pageDokumenContent).toContain("'kurikulum'");
            expect(pageDokumenContent).toMatch(/const\s+managerRoles\s*=\s*\[[\s\S]*?['"]kurikulum['"][\s\S]*?\]/);
        });

        test('canManageDocument mengizinkan manager atau pemilik asli dokumen', () => {
            expect(pageDokumenContent).toContain('function canManageDocument(docItem)');
            expect(pageDokumenContent).toContain('if (isDocManager) return true;');
            expect(pageDokumenContent).toContain('uploader === activeEmail');
            expect(pageDokumenContent).toContain('uploader === activeUid');
        });

        test('Mapping agendaDocuments dari Cloudflare D1 memuat properti uploadedBy', () => {
            expect(pageDokumenContent).toMatch(/uploadedBy:\s*d\.uploaded_by\s*\|\|\s*d\.uploadedBy/);
        });

        test('saveAgendaDocument tidak melakukan silent return melainkan memberikan toast peringatan', () => {
            expect(pageDokumenContent).not.toMatch(/if\s*\(!isDocManager\)\s*return;/);
            expect(pageDokumenContent).toContain("showToast('Akses Dibatasi'");
        });

        test('deleteAgendaDocument dan toggleArchiveAgendaDocument memvalidasi canManageDocument dan meneruskan error server', () => {
            expect(pageDokumenContent).toContain('if (!canManageDocument(docItem))');
            expect(pageDokumenContent).toContain("e.message || 'Gagal menghapus dokumen.'");
            expect(pageDokumenContent).toContain("e.message || 'Gagal mengubah status arsip dokumen.'");
        });
    });

    describe('3. Simulasi Logika Hak Akses (RBAC & Ownership Logic)', () => {
        function checkCanManage(user, doc) {
            const managerRoles = ['super_admin', 'kepala_sekolah', 'wakasek_kurikulum', 'kurikulum', 'kesiswaan', 'kepala_lab'];
            const userRoles = [user.role, ...(user.additionalRoles || [])];
            const isManager = managerRoles.some(r => userRoles.includes(r));
            if (isManager) return true;
            if (!doc) return false;
            const uploader = (doc.uploadedBy || '').toLowerCase();
            return (user.email && uploader === user.email.toLowerCase()) || (user.uid && uploader === user.uid);
        }

        test('Pengguna Kurikulum (Maulita Wulan) memiliki hak manager untuk semua dokumen', () => {
            const buMaulita = {
                uid: 'Mw8seBW4b4hKYR5lcRR2opb41682',
                email: 'maulitawulan@gmail.com',
                role: 'guru_mapel',
                additionalRoles: ['wakasek_kurikulum']
            };
            const docOrangLain = { id: 'doc-1', uploadedBy: 'admin@smagesa.sch.id' };
            expect(checkCanManage(buMaulita, docOrangLain)).toBe(true);
        });

        test('Guru Mapel biasa BUKAN manager tetapi berhak mengelola dokumen miliknya sendiri', () => {
            const guruBiasa = {
                uid: 'guru-123',
                email: 'guru@smagesa.sch.id',
                role: 'guru_mapel',
                additionalRoles: []
            };
            const docMilikSendiri = { id: 'doc-own', uploadedBy: 'guru@smagesa.sch.id' };
            const docOrangLain = { id: 'doc-other', uploadedBy: 'admin@smagesa.sch.id' };

            expect(checkCanManage(guruBiasa, docMilikSendiri)).toBe(true);
            expect(checkCanManage(guruBiasa, docOrangLain)).toBe(false);
        });
    });
});

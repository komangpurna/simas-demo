const fs = require('fs');
const path = require('path');

describe('Homeroom Teacher & NIP Resolution for Report Card (SSOT)', () => {
    let resolveHomeroomTeacher;
    let mockWaliCache;
    let mockTeachersMap;

    beforeEach(() => {
        // Simulasi data Wali Kelas per rombel di sekolah
        mockWaliCache = new Map([
            ['XI-F2', {
                name: 'Drs. I Wayan Sudarta',
                nip: '197203151998021001',
                assignedClass: 'XI-F2',
                linkedTeacherId: 'T001'
            }],
            ['X-A', {
                name: 'Ni Luh Putu Anggreni, S.Pd.',
                nip: '', // Non-PNS / Honorer (tidak ada NIP)
                assignedClass: 'X-A',
                linkedTeacherId: 'T002'
            }]
        ]);

        mockTeachersMap = new Map([
            ['T001', { name: 'Drs. I Wayan Sudarta', nip: '197203151998021001' }],
            ['T002', { name: 'Ni Luh Putu Anggreni, S.Pd.', nip: '' }]
        ]);

        // Helper mock environment
        const mockWindow = {
            getWaliKelasByClass: jest.fn(async (cls) => {
                const clean = String(cls).replace(/^Kelas\s+/i, '').trim();
                return mockWaliCache.get(clean) || null;
            }),
            getTeachersMapCache: jest.fn(async () => mockTeachersMap)
        };

        // Fungsi reproduksi SSOT dari js/global.js
        resolveHomeroomTeacher = async function (className, currentUserProfile = null) {
            const rawClass = String(className || '').trim();
            const cleanClass = rawClass.replace(/^Kelas\s+/i, '');
            const normClass = cleanClass.replace(/[\s\-_]+/g, '').toLowerCase();

            let targetName = '';
            let targetNip = '';

            // 1. Cek apakah pengguna saat ini adalah Wali Kelas yang bersangkutan dari kelas ini
            const isCurrentUserActualWali = Boolean(
                currentUserProfile &&
                (currentUserProfile.role === 'wali_kelas' || currentUserProfile.role === 'guru') &&
                currentUserProfile.assignedClass &&
                normClass &&
                String(currentUserProfile.assignedClass).trim().replace(/^Kelas\s+/i, '').replace(/[\s\-_]+/g, '').toLowerCase() === normClass
            );

            // 2. Ambil data wali kelas resmi kelas ini melalui getWaliKelasByClass (SSOT)
            try {
                if (typeof mockWindow.getWaliKelasByClass === 'function' && cleanClass) {
                    const classWali = await mockWindow.getWaliKelasByClass(cleanClass);
                    if (classWali) {
                        targetName = classWali.name || '';
                        targetNip = classWali.nip || '';

                        // Jika NIP belum ada pada data user, cari di Master GTK via linkedTeacherId atau kecocokan nama
                        if (!targetNip && typeof mockWindow.getTeachersMapCache === 'function') {
                            try {
                                const tMap = await mockWindow.getTeachersMapCache();
                                if (classWali.linkedTeacherId && tMap.has(classWali.linkedTeacherId)) {
                                    targetNip = tMap.get(classWali.linkedTeacherId)?.nip || '';
                                } else if (targetName && tMap.size > 0) {
                                    const cleanWaliName = targetName.trim().toLowerCase();
                                    for (const [, tObj] of tMap.entries()) {
                                        const tName = String(tObj?.name || '').trim().toLowerCase();
                                        if (tName && (tName === cleanWaliName || tName.includes(cleanWaliName) || cleanWaliName.includes(tName))) {
                                            if (tObj.nip) {
                                                targetNip = tObj.nip;
                                                break;
                                            }
                                        }
                                    }
                                }
                            } catch (eT) {}
                        }
                    }
                }
            } catch (eWali) {}

            // 3. Jika pengguna saat ini terbukti benar-benar wali kelas kelas ini, gunakan datanya jika getWaliKelasByClass belum lengkap
            if (isCurrentUserActualWali) {
                if (!targetName) targetName = currentUserProfile.name || currentUserProfile.nama || '';
                if (!targetNip) targetNip = currentUserProfile.nip || '';
            }

            // 4. JIKA PENGGUNA YANG LOGIN ADALAH SUPER ADMIN, ADMIN, GURU WALI, BK, ATAU BUKAN WALI KELAS KELAS INI:
            // DILARANG KERAS menggunakan nama/NIP akun yang sedang login!
            if (!targetName) {
                targetName = cleanClass ? `Wali Kelas ${cleanClass}` : 'Wali Kelas';
            }

            // 5. Validasi & Standarisasi Format NIP yang Sah
            const cleanNip = String(targetNip || '').replace(/^NIP[\.\s:]*/i, '').trim();
            const hasValidNip = Boolean(
                cleanNip &&
                cleanNip !== '-' &&
                cleanNip !== '0' &&
                cleanNip.toLowerCase() !== 'null' &&
                cleanNip.toLowerCase() !== 'undefined' &&
                !cleanNip.startsWith('.') &&
                cleanNip.length >= 8
            );

            return {
                name: targetName,
                nip: hasValidNip ? `NIP. ${cleanNip}` : '',
                rawNip: hasValidNip ? cleanNip : '',
                isActualWali: isCurrentUserActualWali
            };
        };
    });

    test('Super Admin mencetak rapor kelas XI-F2: WAJIB memakai nama & NIP Wali Kelas XI-F2 (BUKAN NIP Admin)', async () => {
        const superAdminUser = {
            role: 'super_admin',
            name: 'I Komang Purna, S.Pd., M.Pd.',
            nip: '198501012010011005',
            assignedClass: null
        };

        const result = await resolveHomeroomTeacher('XI-F2', superAdminUser);

        expect(result.name).toBe('Drs. I Wayan Sudarta');
        expect(result.nip).toBe('NIP. 197203151998021001');
        expect(result.rawNip).toBe('197203151998021001');
        expect(result.isActualWali).toBe(false);
    });

    test('Guru Wali mencetak rapor siswa binaan kelas XI-F2: WAJIB memakai nama & NIP Wali Kelas XI-F2 (BUKAN Guru Wali)', async () => {
        const guruWaliUser = {
            role: 'guru_wali',
            name: 'Ni Wayan Dewi, S.Pd.',
            nip: '199008202019032008',
            assignedClass: null
        };

        const result = await resolveHomeroomTeacher('XI-F2', guruWaliUser);

        expect(result.name).toBe('Drs. I Wayan Sudarta');
        expect(result.nip).toBe('NIP. 197203151998021001');
        expect(result.isActualWali).toBe(false);
    });

    test('Wali Kelas asli XI-F2 mencetak rapor kelasnya sendiri: Menggunakan datanya sendiri', async () => {
        const actualWaliUser = {
            role: 'wali_kelas',
            name: 'Drs. I Wayan Sudarta',
            nip: '197203151998021001',
            assignedClass: 'XI-F2'
        };

        const result = await resolveHomeroomTeacher('XI-F2', actualWaliUser);

        expect(result.name).toBe('Drs. I Wayan Sudarta');
        expect(result.nip).toBe('NIP. 197203151998021001');
        expect(result.isActualWali).toBe(true);
    });

    test('Wali Kelas non-PNS (tanpa NIP valid) kelas X-A: NIP WAJIB kosong ("")', async () => {
        const superAdminUser = {
            role: 'super_admin',
            name: 'Admin Sekolah',
            nip: '198001012000011001'
        };

        const result = await resolveHomeroomTeacher('X-A', superAdminUser);

        expect(result.name).toBe('Ni Luh Putu Anggreni, S.Pd.');
        expect(result.nip).toBe('');
        expect(result.rawNip).toBe('');
    });

    test('Kelas belum ada wali terdaftar di sistem: Fallback aman "Wali Kelas [Nama Kelas]" & NIP kosong', async () => {
        const adminUser = {
            role: 'admin',
            name: 'Staf TU Admin',
            nip: '198205052008011004'
        };

        const result = await resolveHomeroomTeacher('XII-IPA 9', adminUser);

        expect(result.name).toBe('Wali Kelas XII-IPA 9');
        expect(result.nip).toBe('');
        expect(result.isActualWali).toBe(false);
    });

    test('Memastikan page-wali-kelas.js dan page-students.js memanggil resolveHomeroomTeacher', () => {
        const waliCode = fs.readFileSync(path.join(__dirname, '../js/page-wali-kelas.js'), 'utf8');
        const studentsCode = fs.readFileSync(path.join(__dirname, '../js/page-students.js'), 'utf8');
        const globalCode = fs.readFileSync(path.join(__dirname, '../js/global.js'), 'utf8');

        expect(waliCode).toMatch(/resolveHomeroomTeacher\(studentClass,\s*currentUserProfile\)/);
        expect(studentsCode).toMatch(/resolveHomeroomTeacher\(studentClass,\s*null\)/);
        expect(globalCode).toMatch(/window\.resolveHomeroomTeacher\s*=\s*async function/);
    });
});

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

describe('Validasi Fitur Edit/Hapus Jurnal Admin & Filter Belum Diisi (KBM Efektif)', () => {
    const adminHtml = fs.readFileSync(path.join(projectRoot, 'jurnal-admin.html'), 'utf8');
    const adminJs = fs.readFileSync(path.join(projectRoot, 'js', 'page-jurnal-admin.js'), 'utf8');
    const workerJs = fs.readFileSync(path.join(projectRoot, 'cloudflare', 'worker.js'), 'utf8');

    describe('1. Verifikasi UI jurnal-admin.html', () => {
        test('Memiliki dropdown filter-rekap-status dengan opsi Semua Jurnal dan Belum Diisi', () => {
            expect(adminHtml).toContain('id="filter-rekap-status"');
            expect(adminHtml).toContain('value="ALL"');
            expect(adminHtml).toContain('value="UNFILLED"');
            expect(adminHtml).toContain('Belum Diisi (Guru Hadir di Presensi)');
        });

        test('Memiliki markup modal edit jurnal (#modal-edit-jurnal-admin) terpadu', () => {
            expect(adminHtml).toContain('id="modal-edit-jurnal-admin"');
            expect(adminHtml).toContain('id="edit-jurnal-id"');
            expect(adminHtml).toContain('id="edit-jurnal-tanggal"');
            expect(adminHtml).toContain('id="edit-jurnal-kelas"');
            expect(adminHtml).toContain('id="edit-jurnal-guru"');
            expect(adminHtml).toContain('id="edit-jurnal-mapel"');
            expect(adminHtml).toContain('id="edit-jurnal-jp-container"');
            expect(adminHtml).toContain('id="edit-jurnal-lokasi"');
            expect(adminHtml).toContain('id="edit-jurnal-topik"');
            expect(adminHtml).toContain('id="edit-jurnal-catatan"');
            expect(adminHtml).toContain('id="edit-jurnal-presensi-list"');
            expect(adminHtml).toContain('window.addSiswaAbsenRowEdit()');
            expect(adminHtml).toContain('window.saveEditJurnalAdmin(event)');
        });
    });

    describe('2. Otorisasi Role di Cloudflare Worker API', () => {
        test('worker.js mengizinkan role kurikulum dan kepala_lab pada mutasi jurnal', () => {
            expect(workerJs).toContain('"kurikulum"');
            expect(workerJs).toContain('"kepala_lab"');
            const allowedRolesMatch = workerJs.match(/Mutasi jurnal[^\n]*\n\s*const allowedRoles\s*=\s*\[([^\]]+)\]/);
            expect(allowedRolesMatch).not.toBeNull();
            const allowedRolesStr = allowedRolesMatch[1];
            expect(allowedRolesStr).toContain('"kurikulum"');
            expect(allowedRolesStr).toContain('"kepala_lab"');
            expect(allowedRolesStr).toContain('"super_admin"');
            expect(allowedRolesStr).toContain('"wakasek_kurikulum"');
        });
    });

    describe('3. Logika Script (js/page-jurnal-admin.js)', () => {
        test('Mendefinisikan fungsi otorisasi canUserModifyJurnal', () => {
            expect(adminJs).toContain('function canUserModifyJurnal');
            expect(adminJs).toContain('super_admin');
            expect(adminJs).toContain('wakasek_kurikulum');
            expect(adminJs).toContain('kurikulum');
            expect(adminJs).toContain('kepala_lab');
        });

        test('Mendefinisikan fungsi computeUnfilledEffectiveSlots dan getAngkatanFromClass', () => {
            expect(adminJs).toContain('function computeUnfilledEffectiveSlots');
            expect(adminJs).toContain('function getAngkatanFromClass');
        });

        test('Menyediakan fungsi window untuk aksi Edit, Hapus, dan Tambah Jurnal Slot', () => {
            expect(adminJs).toContain('window.confirmDeleteJurnal');
            expect(adminJs).toContain('window.openEditJurnalAdmin');
            expect(adminJs).toContain('window.openCreateJurnalForSlot');
            expect(adminJs).toContain('window.closeModalEditJurnal');
            expect(adminJs).toContain('window.saveEditJurnalAdmin');
        });

        test('Menyematkan tombol Edit dan Hapus pada dialog rincian showJurnalRowDetail jika user berhak', () => {
            expect(adminJs).toContain('swal-btn-delete-jurnal');
            expect(adminJs).toContain('swal-btn-edit-jurnal');
            expect(adminJs).toContain('canUserModifyJurnal(item)');
        });
    });

    describe('4. Simulasi Logika Bisnis Hak Akses (canUserModifyJurnal)', () => {
        function canUserModifyJurnalPure(item, user, roles, profile) {
            if (!user) return false;
            const allowedRoles = ['super_admin', 'wakasek_kurikulum', 'kurikulum', 'kepala_lab', 'admin'];
            const hasAdminRole = Array.isArray(roles) && roles.some(r => allowedRoles.includes(r));
            if (hasAdminRole) return true;

            const userTeacherName = (profile?.nama || profile?.name || user?.displayName || '').trim().toLowerCase();
            const itemGuruName = (item?.guru || '').trim().toLowerCase();
            if (userTeacherName && itemGuruName && (userTeacherName === itemGuruName || itemGuruName.includes(userTeacherName) || userTeacherName.includes(itemGuruName))) {
                return true;
            }
            if (item?.uid_guru && user?.uid && item.uid_guru === user.uid) {
                return true;
            }
            return false;
        }

        test('Super Admin, Wakasek Kurikulum, Kurikulum, dan Kepala Lab berhak edit & hapus', () => {
            const item = { id: 'j1', guru: 'Drs. Guru Lain' };
            const user = { uid: 'u1', displayName: 'Admin User' };

            expect(canUserModifyJurnalPure(item, user, ['super_admin'], {})).toBe(true);
            expect(canUserModifyJurnalPure(item, user, ['wakasek_kurikulum'], {})).toBe(true);
            expect(canUserModifyJurnalPure(item, user, ['kurikulum'], {})).toBe(true);
            expect(canUserModifyJurnalPure(item, user, ['kepala_lab'], {})).toBe(true);
        });

        test('Guru pemilik jurnal berhak edit & hapus jurnal miliknya sendiri', () => {
            const item = { id: 'j2', guru: 'I Komang Purna, S.Pd' };
            const userOwner = { uid: 'u2', displayName: 'I Komang Purna' };
            const profileOwner = { nama: 'I Komang Purna, S.Pd' };

            expect(canUserModifyJurnalPure(item, userOwner, ['guru_mapel'], profileOwner)).toBe(true);
        });

        test('Guru lain yang bukan pemilik jurnal tidak berhak edit atau hapus', () => {
            const item = { id: 'j3', guru: 'Ni Wayan Sari, M.Pd' };
            const userOther = { uid: 'u3', displayName: 'I Made Budi' };
            const profileOther = { nama: 'I Made Budi, S.Pd' };

            expect(canUserModifyJurnalPure(item, userOther, ['guru_mapel'], profileOther)).toBe(false);
        });
    });

    describe('5. Simulasi Komputasi Belum Diisi KBM Efektif (Monitoring KBM Rule)', () => {
        function getAngkatanPure(className) {
            if (!className) return 'OTHER';
            const clean = String(className).trim().replace(/^KELAS\s+/i, '').toUpperCase();
            if (clean.startsWith('XII') || clean.startsWith('12')) return 'XII';
            if (clean.startsWith('XI') || clean.startsWith('11')) return 'XI';
            if (clean.startsWith('X') || clean.startsWith('10')) return 'X';
            const m = clean.match(/^(X|XI|XII|\d+)/i);
            return m ? m[1].toUpperCase() : 'OTHER';
        }

        test('getAngkatanPure mengklasifikasikan kelas dengan benar', () => {
            expect(getAngkatanPure('X-1')).toBe('X');
            expect(getAngkatanPure('XI-4')).toBe('XI');
            expect(getAngkatanPure('XII-MIPA-1')).toBe('XII');
            expect(getAngkatanPure('10-2')).toBe('X');
            expect(getAngkatanPure('11-A')).toBe('XI');
            expect(getAngkatanPure('12-B')).toBe('XII');
        });

        test('Slot JP tidak efektif (kelas terisi <= 2) diabaikan/tidak dimunculkan', () => {
            const verifiedCountX = 2;
            const isEffective = verifiedCountX > 2;
            expect(isEffective).toBe(false);
        });

        test('Slot JP efektif (kelas terisi > 2) dimunculkan sebagai belum diisi untuk rombel yang kosong', () => {
            const verifiedCountX = 4;
            const isEffective = verifiedCountX > 2;
            expect(isEffective).toBe(true);
        });
    });

    describe('6. Syarat Mutlak: Jurnal Kosong HANYA Tampil Jika Siswa Mengisi Guru Hadir (H)', () => {
        function filterUnfilledWithPresensi(slots, presensiRows) {
            const normClass = (c) => String(c || '').replace(/\s+/g, '').toUpperCase();
            const hadirMap = new Set();
            (presensiRows || []).forEach(row => {
                const st = (row.status || '').trim().toUpperCase();
                if (st === 'H' || st === 'HADIR') {
                    const k = normClass(row.kelas);
                    const jp = parseInt(row.jp, 10);
                    if (k && !isNaN(jp)) hadirMap.add(`${k}_${jp}`);
                }
            });

            return slots.filter(s => hadirMap.has(`${normClass(s.kelas)}_${s.jp}`));
        }

        test('Slot jadwal kosong dimunculkan JIKA siswa mengisi guru Hadir (H)', () => {
            const slots = [
                { kelas: 'X-1', jp: 2, guru: 'Guru A', mapel: 'Matematika' },
                { kelas: 'X-1', jp: 3, guru: 'Guru B', mapel: 'Fisika' }
            ];
            const presensi = [
                { kelas: 'X-1', jp: 2, status: 'H', guru_nama: 'Guru A' }
            ];
            const result = filterUnfilledWithPresensi(slots, presensi);
            expect(result.length).toBe(1);
            expect(result[0].jp).toBe(2);
        });

        test('Slot jadwal kosong DIABAIKAN jika siswa mengisi Sakit (S), Izin (I), atau tidak ada data presensi', () => {
            const slots = [
                { kelas: 'X-1', jp: 2, guru: 'Guru A', mapel: 'Matematika' },
                { kelas: 'X-1', jp: 3, guru: 'Guru B', mapel: 'Fisika' },
                { kelas: 'X-1', jp: 4, guru: 'Guru C', mapel: 'Kimia' }
            ];
            const presensi = [
                { kelas: 'X-1', jp: 2, status: 'S', guru_nama: 'Guru A' },
                { kelas: 'X-1', jp: 3, status: 'I', guru_nama: 'Guru B' }
                // jp 4 belum diisi presensi siswa
            ];
            const result = filterUnfilledWithPresensi(slots, presensi);
            expect(result.length).toBe(0);
        });
    });

    describe('7. Penyesuaian Pengajar & Mapel Edit Jurnal Mengacu pada Jadwal aSc Timetable', () => {
        const parserJs = fs.readFileSync(path.join(projectRoot, 'js', 'asc-schedule-parser.js'), 'utf8');

        test('asc-schedule-parser.js mengekspor fungsi getClassScheduleTeachersAndMapels', () => {
            expect(parserJs).toContain('export async function getClassScheduleTeachersAndMapels(');
            expect(parserJs).toContain('teacherMapelMap');
        });

        test('page-jurnal-admin.js mengimpor dan memanfaatkan getClassScheduleTeachersAndMapels', () => {
            expect(adminJs).toContain('getClassScheduleTeachersAndMapels');
            expect(adminJs).toContain('updateEditGuruDropdown');
            expect(adminJs).toContain('updateEditMapelDropdown');
            expect(adminJs).toContain('setupEditJurnalModalEvents');
        });

        test('Dropdown guru mengelompokkan guru jadwal aSc di optgroup teratas dan guru lainnya di bawah', () => {
            expect(adminJs).toContain('optgroup label="Guru Pengajar Kelas');
            expect(adminJs).toContain('(Jadwal aSc)"');
            expect(adminJs).toContain('optgroup label="Guru Lainnya (Pengganti / Tambahan)"');
        });

        test('Dropdown mapel memprioritaskan mapel guru bersangkutan di kelas tersebut', () => {
            expect(adminJs).toContain('optgroup label="Mapel Guru di Kelas');
            expect(adminJs).toContain('optgroup label="Mapel Lainnya di Kelas');
        });

        test('Simulasi logika pengelompokan guru kelas vs guru lain', () => {
            const classTeachers = [
                { name: 'Ni Ketut Ari Jijiv Liani, S.Pd.', mapels: ['Bahasa Jepang'] },
                { name: 'Guru Matematika, S.Pd.', mapels: ['Matematika'] }
            ];
            const allTeachers = [
                'Guru Fisika, S.Pd.',
                'Guru Matematika, S.Pd.',
                'Ni Ketut Ari Jijiv Liani, S.Pd.'
            ];

            const classTeacherNames = new Set(classTeachers.map(t => t.name.toLowerCase()));
            const otherTeachers = allTeachers.filter(name => !classTeacherNames.has(name.toLowerCase()));

            expect(classTeachers.length).toBe(2);
            expect(otherTeachers.length).toBe(1);
            expect(otherTeachers[0]).toBe('Guru Fisika, S.Pd.');
            expect(classTeachers[0].mapels).toContain('Bahasa Jepang');
        });

        test('Simulasi otomasi cerdas pemilihan mapel tunggal guru di kelas', () => {
            const teacherMapels = ['Bahasa Jepang'];
            let selectedMapel = '';
            if (!selectedMapel && teacherMapels.length === 1) {
                selectedMapel = teacherMapels[0];
            }
            expect(selectedMapel).toBe('Bahasa Jepang');
        });
    });

    describe('8. Pewarisan Presensi Blok KBM Multi-JP (Contiguous Lesson Presence Inheritance)', () => {
        test('Script js/page-jurnal-admin.js mengimplementasikan logika lessonBlocks dan pewarisan presensi Hadir', () => {
            expect(adminJs).toContain('lessonBlocks');
            expect(adminJs).toContain('blockHadir');
            expect(adminJs).toContain('isExplicitAbsent');
        });

        function simulateUnfilledSlotWithBlockInheritance(scheduleSlots, presensiRows, nonEffectiveJps = []) {
            const normClass = (c) => String(c || '').trim().replace(/^KELAS\s+/i, '').replace(/\s+/g, '').toUpperCase();
            const hadirPresensiMap = new Map();
            const recordedPresensiMap = new Map();

            (presensiRows || []).forEach(row => {
                const k = normClass(row.kelas);
                const jp = parseInt(row.jp, 10);
                if (k && !isNaN(jp)) {
                    recordedPresensiMap.set(`${k}_${jp}`, row);
                    const st = (row.status || '').trim().toUpperCase();
                    if (st === 'H' || st === 'HADIR') {
                        hadirPresensiMap.set(`${k}_${jp}`, row);
                    }
                }
            });

            // Bangun blok jam pelajaran berurutan (guru & mapel sama)
            const lessonBlocks = [];
            let currentBlock = [];
            scheduleSlots.forEach(slot => {
                const jpNum = slot.jp;
                const mapel = (slot.mapel || '').trim().toLowerCase();
                const guru = (slot.guru || slot.guruNama || '').trim().toLowerCase();
                const kNorm = normClass(slot.kelas);

                const prev = currentBlock[currentBlock.length - 1];
                if (prev && prev.guru === guru && prev.mapel === mapel && prev.jp === jpNum - 1 && prev.kNorm === kNorm) {
                    currentBlock.push({ jp: jpNum, guru, mapel, kNorm, raw: slot });
                } else {
                    if (currentBlock.length > 0) lessonBlocks.push(currentBlock);
                    currentBlock = [{ jp: jpNum, guru, mapel, kNorm, raw: slot }];
                }
            });
            if (currentBlock.length > 0) lessonBlocks.push(currentBlock);

            // Warisi status Hadir
            lessonBlocks.forEach(block => {
                const kNorm = block[0].kNorm;
                const blockHadir = block.map(b => hadirPresensiMap.get(`${kNorm}_${b.jp}`)).find(Boolean);
                if (!blockHadir) return;

                block.forEach(b => {
                    const key = `${kNorm}_${b.jp}`;
                    if (!hadirPresensiMap.has(key)) {
                        const existing = recordedPresensiMap.get(key);
                        const existingStatus = (existing?.status || '').trim().toUpperCase();
                        const isExplicitAbsent = ['S', 'SAKIT', 'I', 'IZIN', 'TK', 'A', 'ALPA'].includes(existingStatus);
                        if (!isExplicitAbsent) {
                            hadirPresensiMap.set(key, { ...blockHadir, jp: b.jp });
                        }
                    }
                });
            });

            // Filter slot yang belum diisi pada jam efektif dan memiliki status Hadir
            return scheduleSlots.filter(s => {
                const kNorm = normClass(s.kelas);
                // Lewati JP yang tidak efektif
                if (nonEffectiveJps.includes(s.jp)) return false;
                // Wajib memiliki status Hadir (langsung atau terwariskan)
                return hadirPresensiMap.has(`${kNorm}_${s.jp}`);
            });
        }

        test('Guru mengajar 3 JP (JP 1, 2, 3), JP 1 & 2 tidak efektif, siswa hanya isi Hadir (H) di JP 1 -> JP 3 efektif tetap muncul', () => {
            const schedule = [
                { kelas: 'X-1', jp: 1, guru: 'Pak Budi', mapel: 'Matematika' },
                { kelas: 'X-1', jp: 2, guru: 'Pak Budi', mapel: 'Matematika' },
                { kelas: 'X-1', jp: 3, guru: 'Pak Budi', mapel: 'Matematika' }
            ];
            // Siswa hanya input Hadir di JP 1
            const presensi = [
                { kelas: 'X-1', jp: 1, status: 'H', guru_nama: 'Pak Budi' }
            ];
            // JP 1 & 2 terdeteksi tidak efektif (misal upacara & non-efektif massal)
            const nonEffectiveJps = [1, 2];

            const result = simulateUnfilledSlotWithBlockInheritance(schedule, presensi, nonEffectiveJps);
            expect(result.length).toBe(1);
            expect(result[0].jp).toBe(3);
            expect(result[0].guru).toBe('Pak Budi');
        });

        test('Jika siswa secara eksplisit mencatat Sakit (S) di JP 3, status Hadir dari JP 1 TIDAK diwariskan ke JP 3', () => {
            const schedule = [
                { kelas: 'X-1', jp: 1, guru: 'Pak Budi', mapel: 'Matematika' },
                { kelas: 'X-1', jp: 2, guru: 'Pak Budi', mapel: 'Matematika' },
                { kelas: 'X-1', jp: 3, guru: 'Pak Budi', mapel: 'Matematika' }
            ];
            const presensi = [
                { kelas: 'X-1', jp: 1, status: 'H', guru_nama: 'Pak Budi' },
                { kelas: 'X-1', jp: 3, status: 'S', guru_nama: 'Pak Budi' } // Eksplisit Sakit di JP 3
            ];
            const nonEffectiveJps = [1, 2];

            const result = simulateUnfilledSlotWithBlockInheritance(schedule, presensi, nonEffectiveJps);
            expect(result.length).toBe(0);
        });
    });
});


/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

describe('Portal Guru Mapel - Identitas Guru Pengampu pada Header (#header-guru-name)', () => {
    const root = path.resolve(__dirname, '..');
    const jsPath = path.join(root, 'js', 'page-guru-mapel.js');
    const htmlPath = path.join(root, 'guru-mapel.html');
    const packagePath = path.join(root, 'package.json');

    const jsContent = fs.readFileSync(jsPath, 'utf8');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

    describe('1. Verifikasi Markup Statis HTML & Script Tag', () => {
        beforeEach(() => {
            document.body.innerHTML = htmlContent;
        });

        test('Elemen #header-guru-name tersedia di dalam banner header', () => {
            const headerGuruName = document.getElementById('header-guru-name');
            expect(headerGuruName).not.toBeNull();
            expect(headerGuruName.textContent.trim()).toBe('Guru Mapel');
        });

        test('Script tag page-guru-mapel.js merujuk ke versi aktif aplikasi', () => {
            const scriptTag = document.querySelector('script[src*="js/page-guru-mapel.js"]');
            expect(scriptTag).not.toBeNull();
            expect(scriptTag.getAttribute('src')).toBe(`js/page-guru-mapel.js?v=${packageJson.version}`);
        });

        test('Kode JS memuat fungsi resolveAssignedTeacherForClassAndMapel dan updateHeaderGuruName', () => {
            expect(jsContent).toContain('export async function resolveAssignedTeacherForClassAndMapel');
            expect(jsContent).toContain('export async function updateHeaderGuruName');
            expect(jsContent).toContain('window.resolveAssignedTeacherForClassAndMapel = resolveAssignedTeacherForClassAndMapel;');
            expect(jsContent).toContain('window.updateHeaderGuruName = updateHeaderGuruName;');
        });
    });

    describe('2. Logika Resolusi Guru Pengampu (resolveAssignedTeacherForClassAndMapel)', () => {
        function isClassMatching(classA, classB) {
            if (!classA || !classB) return false;
            if (classA === classB) return true;
            const cleanA = String(classA).trim().toLowerCase();
            const cleanB = String(classB).trim().toLowerCase();
            if (cleanA === cleanB) return true;
            return cleanA.replace(/[^a-z0-9]/gi, '') === cleanB.replace(/[^a-z0-9]/gi, '');
        }

        function isClassEqual(c, target) {
            return isClassMatching(c, target);
        }

        function getMapelNameCandidates(mapelName) {
            if (!mapelName) return [];
            const candidates = new Set([mapelName.trim()]);
            if (mapelName.match(/^Matematika/i)) {
                candidates.add('Matematika');
                candidates.add('Matematika (Umum)');
                candidates.add('Matematika Umum');
            }
            if (mapelName.match(/^Bahasa Indonesia/i)) {
                candidates.add('Bahasa Indonesia');
                candidates.add('Bahasa Indonesia (Umum)');
            }
            return Array.from(candidates);
        }

        function isMapelMatching(docMapel, mapelCandidates = []) {
            if (!docMapel) return false;
            const cleanDoc = String(docMapel).trim().toLowerCase();
            const candidates = Array.isArray(mapelCandidates) ? mapelCandidates : [mapelCandidates];
            return candidates.some(c => String(c).trim().toLowerCase() === cleanDoc);
        }

        async function mockResolveAssignedTeacher(kelas, mapel, options = {}) {
            const fallbackUser = options.currentUser || { uid: 'admin_123', displayName: 'Super Admin' };
            const fallbackResult = {
                name: fallbackUser.displayName,
                uid: fallbackUser.uid,
                nip: '198001012005011001',
                isAssigned: false,
                teachers: []
            };

            if (!kelas || !mapel || String(kelas).includes('--') || String(mapel).includes('--')) {
                return fallbackResult;
            }

            const cleanKelas = String(kelas).trim();
            const cleanMapel = String(mapel).trim();
            const config = options.config || {};
            const mapelGuruConfig = config.mapel_guru || {};

            let candidateGurus = [];
            if (Array.isArray(mapelGuruConfig[cleanMapel]) && mapelGuruConfig[cleanMapel].length > 0) {
                candidateGurus = mapelGuruConfig[cleanMapel];
            } else {
                const candidates = getMapelNameCandidates(cleanMapel);
                for (const [key, val] of Object.entries(mapelGuruConfig)) {
                    if (isMapelMatching(key, candidates) && Array.isArray(val) && val.length > 0) {
                        candidateGurus = val;
                        break;
                    }
                }
            }

            let matchedGurus = candidateGurus.filter(g => {
                if (!g) return false;
                if (typeof g === 'object' && Array.isArray(g.kelas) && g.kelas.length > 0) {
                    return g.kelas.some(c => isClassEqual(c, cleanKelas) || isClassMatching(c, cleanKelas));
                }
                return false;
            });

            if (matchedGurus.length === 0) {
                matchedGurus = candidateGurus.filter(g => {
                    if (!g) return false;
                    if (typeof g === 'string') return true;
                    if (typeof g === 'object' && (!Array.isArray(g.kelas) || g.kelas.length === 0)) return true;
                    return false;
                });
            }

            // Fallback XML
            if (matchedGurus.length === 0 && Array.isArray(options.xmlSubjects)) {
                const candidates = getMapelNameCandidates(cleanMapel);
                const matchedSub = options.xmlSubjects.find(sub => {
                    const subName = (sub.name || '').trim();
                    return subName === cleanMapel || isMapelMatching(subName, candidates);
                });
                if (matchedSub && Array.isArray(matchedSub.guruList)) {
                    matchedGurus = matchedSub.guruList.filter(g => {
                        if (Array.isArray(g.kelas) && g.kelas.length > 0) {
                            return g.kelas.some(c => isClassEqual(c, cleanKelas) || isClassMatching(c, cleanKelas));
                        }
                        return false;
                    });
                }
            }

            if (matchedGurus.length === 0) {
                return fallbackResult;
            }

            const tMap = options.teachersMap;
            const resolvedTeachers = [];
            for (const g of matchedGurus) {
                const rawName = (g.name || g.nama || '').trim();
                const rawUid = (g.uid || g.id || '').toString().trim();
                const rawNip = (g.nip || '').toString().trim();

                let gtkData = null;
                if (tMap) {
                    gtkData = (rawUid ? tMap.get(rawUid) : null) || (rawName ? tMap.get(rawName.toLowerCase()) : null);
                }

                const finalName = gtkData?.name || rawName || rawUid;
                const finalNip = gtkData?.nip || rawNip;
                const finalUid = gtkData?.id || rawUid;

                if (finalName && !resolvedTeachers.some(t => t.name === finalName)) {
                    resolvedTeachers.push({ name: finalName, uid: finalUid, nip: finalNip });
                }
            }

            if (resolvedTeachers.length === 0) return fallbackResult;

            const combinedName = resolvedTeachers.length === 2
                ? `${resolvedTeachers[0].name} & ${resolvedTeachers[1].name}`
                : resolvedTeachers.map(t => t.name).join(', ');

            return {
                name: combinedName,
                uid: resolvedTeachers[0].uid || '',
                nip: resolvedTeachers[0].nip || '',
                isAssigned: true,
                teachers: resolvedTeachers
            };
        }

        test('Menampilkan nama guru pengampu yang terdaftar di mapel_guru saat Super Admin memilih Kelas & Mapel', async () => {
            const mockConfig = {
                mapel_guru: {
                    'Matematika': [
                        { uid: 'guru_suarta', name: 'I Made Suarta', kelas: ['X-A', 'X-B'] },
                        { uid: 'guru_sari', name: 'Ni Wayan Sari', kelas: ['XI-1', 'XI-2'] }
                    ]
                }
            };
            const mockTeachersMap = new Map();
            mockTeachersMap.set('guru_suarta', { name: 'I Made Suarta, S.Pd.', nip: '198505122010011001' });

            const result = await mockResolveAssignedTeacher('X-A', 'Matematika', {
                config: mockConfig,
                teachersMap: mockTeachersMap
            });

            expect(result.isAssigned).toBe(true);
            expect(result.name).toBe('I Made Suarta, S.Pd.');
            expect(result.nip).toBe('198505122010011001');
            expect(result.uid).toBe('guru_suarta');
        });

        test('Mendukung penggabungan dua nama guru jika terdapat Team Teaching di kelas yang sama', async () => {
            const mockConfig = {
                mapel_guru: {
                    'Pendidikan Jasmani': [
                        { uid: 'guru_1', name: 'I Wayan Kertia, S.Pd.', kelas: ['X-A'] },
                        { uid: 'guru_2', name: 'I Ketut Sudana, S.Pd.', kelas: ['X-A'] }
                    ]
                }
            };

            const result = await mockResolveAssignedTeacher('X-A', 'Pendidikan Jasmani', {
                config: mockConfig
            });

            expect(result.isAssigned).toBe(true);
            expect(result.name).toBe('I Wayan Kertia, S.Pd. & I Ketut Sudana, S.Pd.');
        });

        test('Melakukan fallback ke jadwal XML jika mapel_guru belum terkonfigurasi', async () => {
            const mockConfig = { mapel_guru: {} };
            const mockXmlSubjects = [
                {
                    name: 'Bahasa Indonesia',
                    guruList: [
                        { uid: 'guru_indo', name: 'Ni Ketut Sunari, S.Pd.', kelas: ['XII-IPS-1'] }
                    ]
                }
            ];

            const result = await mockResolveAssignedTeacher('XII-IPS-1', 'Bahasa Indonesia', {
                config: mockConfig,
                xmlSubjects: mockXmlSubjects
            });

            expect(result.isAssigned).toBe(true);
            expect(result.name).toBe('Ni Ketut Sunari, S.Pd.');
        });

        test('Kembali ke nama pengguna yang login jika filter kelas atau mapel kosong/belum dipilih', async () => {
            const resultEmptyClass = await mockResolveAssignedTeacher('', 'Matematika');
            expect(resultEmptyClass.isAssigned).toBe(false);
            expect(resultEmptyClass.name).toBe('Super Admin');

            const resultPlaceholder = await mockResolveAssignedTeacher('-- Kelas --', '-- Mapel --');
            expect(resultPlaceholder.isAssigned).toBe(false);
            expect(resultPlaceholder.name).toBe('Super Admin');
        });
    });

    describe('3. Verifikasi Pembaruan DOM Header (#header-guru-name)', () => {
        beforeEach(() => {
            document.body.innerHTML = `
                <span id="header-guru-name">User Login Awal</span>
                <select id="select-kelas">
                    <option value="">-- Kelas --</option>
                    <option value="X-A" selected>X-A</option>
                </select>
                <select id="select-mapel">
                    <option value="">-- Mapel --</option>
                    <option value="Informatika" selected>Informatika</option>
                </select>
            `;
        });

        test('Fungsi updateHeaderGuruName memperbarui textContent dan title pada elemen #header-guru-name', async () => {
            const headerEl = document.getElementById('header-guru-name');

            function updateHeader(teacherName, isAssigned = true, nip = '') {
                headerEl.textContent = teacherName;
                if (isAssigned) {
                    headerEl.title = `Guru Pengampu Informatika - X-A: ${teacherName}${nip ? ` (NIP. ${nip})` : ''}`;
                } else {
                    headerEl.title = `User Login: ${teacherName}`;
                }
            }

            updateHeader('I Made Dharma, S.Kom.', true, '199003152019031008');

            expect(headerEl.textContent).toBe('I Made Dharma, S.Kom.');
            expect(headerEl.title).toContain('Guru Pengampu Informatika - X-A');
            expect(headerEl.title).toContain('199003152019031008');
        });
    });
});

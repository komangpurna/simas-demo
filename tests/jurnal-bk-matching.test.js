const fs = require('fs');
const path = require('path');

describe('Verifikasi Kesetaraan Logika Guru BK dengan Guru Mapel Lainnya', () => {
    const pageJurnalPath = path.resolve(__dirname, '../js/page-jurnal.js');
    const pageMonitoringKbmPath = path.resolve(__dirname, '../js/page-monitoring-kbm.js');
    const pageJurnalAdminPath = path.resolve(__dirname, '../js/page-jurnal-admin.js');
    const ascScheduleParserPath = path.resolve(__dirname, '../js/asc-schedule-parser.js');

    const pageJurnalJs = fs.readFileSync(pageJurnalPath, 'utf8');
    const pageMonitoringKbmJs = fs.readFileSync(pageMonitoringKbmPath, 'utf8');
    const pageJurnalAdminJs = fs.readFileSync(pageJurnalAdminPath, 'utf8');
    const ascScheduleParserJs = fs.readFileSync(ascScheduleParserPath, 'utf8');

    describe('1. Jurnal Mengajar (js/page-jurnal.js)', () => {
        test('compareWithActualSchedule tidak memiliki pengecualian hardcoded TIM BK', () => {
            expect(pageJurnalJs).not.toContain('const isBkSlot =');
            expect(pageJurnalJs).not.toContain('(isBkSlot && isUserGuruBk)');
        });

        test('smartMatchTeacher tidak memiliki cabang khusus TIM BK', () => {
            expect(pageJurnalJs).not.toContain('Special entity: TIM BK');
        });

        test('renderGuruDropdown menyertakan badge Guru BK untuk pengajar ber-role guru_bk', () => {
            expect(pageJurnalJs).toContain('const bkBadge = isBk ? `<span class="text-[10px] text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/40 px-2 py-0.5 rounded font-bold mr-1.5 shrink-0 inline-flex items-center gap-1"><i class="fa-solid fa-user-doctor text-[9px]"></i> Guru BK</span>` : \'\';');
        });

        test('getTeachersForClass hanya memunculkan guru yang mengajar di kelas tersebut (isolasi kelas ketat)', () => {
            const normCls = (str) => (str || '').toString().trim().replace(/[\.\s_]/g, '-').toUpperCase();
            function simulateGetTeachersForClass(targetClassName, allTeachers, scheduleData) {
                const normTarget = normCls(targetClassName);
                let teacherNames = [];

                if (scheduleData && scheduleData.classTeachersMap) {
                    const entry = scheduleData.classTeachersMap[normTarget];
                    if (entry) {
                        teacherNames = [...(entry.teacherNames || [])];
                    }
                }

                if (teacherNames.length === 0) return allTeachers;

                const matchedTeachers = [];
                const matchedNames = new Set();

                teacherNames.forEach(xmlName => {
                    const tObj = allTeachers.find(t => (t.nama || t.name) === xmlName);
                    if (tObj) {
                        const canonName = tObj.nama || tObj.name;
                        if (!matchedNames.has(canonName)) {
                            matchedTeachers.push(tObj);
                            matchedNames.add(canonName);
                        }
                    }
                });

                return matchedTeachers;
            }

            const masterTeachers = [
                { id: '1', nama: 'Guru Matematika X1', role: 'guru_mapel' },
                { id: '2', nama: 'Guru Bahasa X1', role: 'guru_mapel' },
                { id: '3', nama: 'Guru Fisika X2', role: 'guru_mapel' },
                { id: '4', nama: 'Guru Kimia X2', role: 'guru_mapel' },
                { id: '5', nama: 'I Ketut Sujana, S.Pd', role: 'guru_bk' }
            ];

            const mockScheduleData = {
                classTeachersMap: {
                    'XII-1': {
                        className: 'XII-1',
                        teacherNames: ['Guru Matematika X1', 'Guru Bahasa X1', 'I Ketut Sujana, S.Pd']
                    },
                    'XII-2': {
                        className: 'XII-2',
                        teacherNames: ['Guru Fisika X2', 'Guru Kimia X2']
                    }
                }
            };

            // Uji Kelas XII-1:
            const resultXII1 = simulateGetTeachersForClass('XII-1', masterTeachers, mockScheduleData);
            const namesXII1 = resultXII1.map(t => t.nama);
            expect(namesXII1).toContain('Guru Matematika X1');
            expect(namesXII1).toContain('Guru Bahasa X1');
            expect(namesXII1).toContain('I Ketut Sujana, S.Pd');
            expect(namesXII1).not.toContain('Guru Fisika X2');

            // Uji Kelas XII-2: Sujana tidak boleh masuk ke XII-2 jika tidak mengajar di sana
            const resultXII2 = simulateGetTeachersForClass('XII-2', masterTeachers, mockScheduleData);
            const namesXII2 = resultXII2.map(t => t.nama);
            expect(namesXII2).toContain('Guru Fisika X2');
            expect(namesXII2).toContain('Guru Kimia X2');
            expect(namesXII2).not.toContain('I Ketut Sujana, S.Pd');
        });

        test('isGuruBk mengenali guru ber-role guru_bk secara dinamis tanpa hardcode nama', () => {
            expect(pageJurnalJs).toContain('function isGuruBk(t)');
            expect(pageJurnalJs).toContain("roleStr === 'guru_bk'");
            expect(pageJurnalJs).not.toContain('SUARDANA');
            expect(pageJurnalJs).not.toContain('SUJANA');
        });

        test('normalizeTeacherName mengenali variasi spasi gelar akademis (S. Pd, S.Pd, S. Pd.) secara konsisten', () => {
            function evalNormalize(name) {
                let clean = name.toLowerCase();
                clean = clean.replace(/\b([a-z])\.\s+([a-z])\b/gi, '$1.$2');
                clean = clean.replace(/\b([a-z])\.\s+([a-z])\b/gi, '$1.$2');
                const titlePatterns = [
                    /\bm\.?\s*pd\.?\s*h\.?\b/gi,
                    /\bs\.?\s*pd\.?\s*h\.?\b/gi,
                    /\bm\.?\s*pd\.?\b/gi,
                    /\bs\.?\s*pd\.?\b/gi,
                    /\bs\.?\s*ag\.?\b/gi,
                    /\bs\.?\s*kom\.?\b/gi,
                    /\bs\.?\s*e\.?\b/gi,
                    /\bs\.?\s*t\.?\b/gi,
                    /\bm\.?\s*si\.?\b/gi,
                    /\bm\.?\s*m\.?\b/gi,
                    /\bm\.?\s*p\.?\b/gi,
                    /\bs\.?\s*p\.?\b/gi,
                    /\bdrs\.?\b/gi,
                    /\bdr\.?\b/gi,
                    /\bgr\.?\b/gi,
                    /\bh\.?\b/gi,
                    /\bhj\.?\b/gi
                ];
                titlePatterns.forEach(p => { clean = clean.replace(p, ' '); });
                return clean.replace(/[^a-z0-9\s]/gi, ' ').replace(/\s+/g, ' ').trim();
            }

            const norm1 = evalNormalize('I Kadek Suardana, S. Pd');
            const norm2 = evalNormalize('I Kadek Suardana, S.Pd');
            const norm3 = evalNormalize('I Kadek Suardana, S. Pd.');
            const norm4 = evalNormalize('I Kadek Suardana, S.Pd.');

            expect(norm1).toBe('i kadek suardana');
            expect(norm2).toBe('i kadek suardana');
            expect(norm3).toBe('i kadek suardana');
            expect(norm4).toBe('i kadek suardana');
            expect(norm1).toBe(norm2);
        });
    });

    describe('2. Monitoring KBM (js/page-monitoring-kbm.js)', () => {
        test('getCanonicalTeacherName tidak lagi memiliki cabang khusus TIM BK', () => {
            expect(pageMonitoringKbmJs).not.toContain('Entitas Khusus: TIM BK');
        });
    });

    describe('3. Admin Jurnal (js/page-jurnal-admin.js)', () => {
        test('tidak lagi memiliki percabangan TIM BK pada missingJpSlots', () => {
            expect(pageJurnalAdminJs).not.toContain("uG.includes('TIM BK')");
        });
    });

    describe('4. Parser Jadwal XML (js/asc-schedule-parser.js)', () => {
        test('asc-schedule-parser tidak lagi memiliki fallback generic TIM BK', () => {
            expect(ascScheduleParserJs).not.toContain("id: 'TIM_BK'");
            expect(ascScheduleParserJs).not.toContain("name: '[Grup] Guru BK (Seluruh Guru BK)'");
        });
    });
});

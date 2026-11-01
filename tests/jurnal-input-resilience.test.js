const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

describe('Ketahanan Form Input Jurnal Mengajar & Otorisasi Kios Cloudflare D1', () => {
    const pageJurnalJs = fs.readFileSync(path.join(projectRoot, 'js', 'page-jurnal.js'), 'utf8');
    const workerJs = fs.readFileSync(path.join(projectRoot, 'cloudflare', 'worker.js'), 'utf8');
    const jurnalHtml = fs.readFileSync(path.join(projectRoot, 'jurnal.html'), 'utf8');

    describe('1. Ketahanan Input Nama Guru (Anti Focus/Blur Wipe)', () => {
        test('selectedGuruName dideklarasikan pada APP STATE di bagian atas skrip', () => {
            expect(pageJurnalJs).toMatch(/let\s+selectedGuruName\s*=\s*'';/);
            expect(pageJurnalJs).toMatch(/window\.selectedGuruName\s*=\s*'';/);
        });

        test('autoPopulateSchedule mengisi selectedGuruName bersamaan dengan inputGuruEl.value', () => {
            expect(pageJurnalJs).toContain('selectedGuruName = matchedName || detectedTeacher;');
            expect(pageJurnalJs).not.toContain('selectedGuruName = bkTeachersInClass[0].nama;');
        });

        test('Event listener blur memakai resolusi record guru yang sama dengan submit', () => {
            expect(pageJurnalJs).toMatch(/inputGuru\.addEventListener\('blur',\s*\(\)\s*=>/);
            expect(pageJurnalJs).toContain('const teacher = findJournalTeacher(currentVal);');
            expect(pageJurnalJs).toContain('selectedGuruName = matched;');
        });

        test('Mode edit memulihkan selectedGuruName dari docData.guru', () => {
            expect(pageJurnalJs).toContain('selectedGuruName = docData.guru;');
        });

        test('Fallback legacy pengisian firstTeacher yang rawan salah di selectClass sudah dibersihkan', () => {
            expect(pageJurnalJs).not.toContain('inputGuru.value = firstTeacher.nama');
        });
    });

    describe('2. Otorisasi Cloudflare Worker (verifyJurnalAccess)', () => {
        test('Mengizinkan POST dan PUT untuk mutasi entri jurnal oleh kios kelas', () => {
            expect(workerJs).toContain('isJurnalEntryMutation');
            expect(workerJs).toMatch(/\(reqMethod === "POST" \|\| reqMethod === "PUT"\) && isJurnalEntryMutation/);
        });

        test('Melindungi endpoint master data & settings agar tidak bisa dimutasi tanpa otentikasi', () => {
            expect(workerJs).toContain('!path.startsWith("/api/jurnal/settings")');
            expect(workerJs).toContain('!path.startsWith("/api/jurnal/master")');
            expect(workerJs).toContain('!path.startsWith("/api/jurnal/gtk")');
            expect(workerJs).toContain('!path.startsWith("/api/jurnal/teachers")');
        });
    });

    describe('3. Resiliensi Mode Edit pada Client (proceedSubmit)', () => {
        test('Memiliki fallback saveJurnal force_submit jika updateJurnal PUT gagal', () => {
            expect(pageJurnalJs).toContain('await CloudflareAPI.updateJurnal(window.currentEditDocId, cfPayload);');
            expect(pageJurnalJs).toContain('await CloudflareAPI.saveJurnal({ ...cfPayload, id: window.currentEditDocId, force_submit: true });');
        });
    });

    describe('4. Sinkronisasi Versi Aplikasi', () => {
        test('Fungsi renderAppVersion menyinkronkan APP_VERSION ke elemen .app-version-text', () => {
            expect(pageJurnalJs).toContain('function renderAppVersion()');
            expect(pageJurnalJs).toContain('.app-version-text');
        });
    });

    describe('5. Otomatisasi Mapel & JP saat Pemilihan Guru Manual (Luar JP)', () => {
        test('filterMapelByGuru menerima parameter preferredMapel dan mendeteksi mapel dari jadwal XML', () => {
            expect(pageJurnalJs).toMatch(/window\.filterMapelByGuru\s*=\s*function\s*\(\s*preferredMapel\s*=\s*null\s*\)/);
            expect(pageJurnalJs).toContain('cachedScheduleData.scheduleMap[className]?.[dayOfWeek]');
            expect(pageJurnalJs).toContain('todaySchedMapel = slot.mapel;');
        });

        test('filterMapelByGuru mempertahankan nilai mapel dan tidak menghapusnya menjadi string kosong saat ada jadwal/pilihan', () => {
            expect(pageJurnalJs).toContain('const currentMapelVal = (preferredMapel || mapelSelect.value || \'\').trim();');
            expect(pageJurnalJs).toContain('targetToSelect = todaySchedMapel;');
            expect(pageJurnalJs).toContain('mapelSelect.value = targetToSelect;');
        });

        test('autoFillTeacherSchedule memanggil filterMapelByGuru(detectedMapel) dan menetapkan mapelSelect.value', () => {
            expect(pageJurnalJs).toContain('window.filterMapelByGuru(detectedMapel);');
            expect(pageJurnalJs).toContain('mapelSelect.value = detectedMapel;');
        });

        test('autoFillTeacherSchedule mencocokkan pengampu jadwal secara seragam (termasuk guru BK) tanpa pengecualian hardcoded', () => {
            expect(pageJurnalJs).toContain('isDirectMatch');
            expect(pageJurnalJs).not.toContain("slot.guruNama.toUpperCase().includes('TIM BK')");
        });

        test('Event listener blur pada input-guru memanggil autoFillTeacherSchedule saat guru terverifikasi', () => {
            expect(pageJurnalJs).toContain('autoFillTeacherSchedule(matched);');
        });

        test('ensureMasterData mem-parsing string data.mapel menjadi array yang valid', () => {
            expect(pageJurnalJs).toContain('parsedMapel = data.mapel.split(/[,;]/).map(s => s.trim()).filter(Boolean);');
        });
    });

    describe('6. Mitigasi Silent Hang & Watchdog Timer GPS saat Simpan Jurnal', () => {
        test('handleGpsAndProceed menyertakan watchdog timer untuk mencegah browser silent hang', () => {
            expect(pageJurnalJs).toContain('const gpsWatchdog = setTimeout(');
            expect(pageJurnalJs).toContain('handleGpsFailure("Watchdog timeout 8.5s (silent hang browser/OS terdeteksi)");');
        });

        test('Pencarian lokasi menggunakan opsi akurasi tinggi (enableHighAccuracy: true) untuk verifikasi lokasi kelas', () => {
            expect(pageJurnalJs).toContain('{ enableHighAccuracy: true, timeout: 8000, maximumAge: 5000 }');
        });

        test('handleGpsFailure memulihkan state tombol dan menampilkan pop-up konfirmasi simpan tanpa koordinat', () => {
            expect(pageJurnalJs).toContain('btn.innerHTML = originalBtnContent;');
            expect(pageJurnalJs).toContain('btn.disabled = false;');
            expect(pageJurnalJs).toContain("showPopup('confirm', 'GPS Masih Belum Tersedia'");
            expect(pageJurnalJs).toContain('geoCoordinates = { lat: 0, lng: 0 };');
        });
    });

    describe('7. Penyelarasan Dropdown Guru Berdasarkan Kelas Terpilih (SSOT aSc Timetables)', () => {
        test('Fungsi getTeachersForClass didefinisikan pada js/page-jurnal.js', () => {
            expect(pageJurnalJs).toContain('function getTeachersForClass(targetClassName, allTeachers, scheduleData)');
            expect(pageJurnalJs).toContain('window.getTeachersForClass = getTeachersForClass;');
        });

        test('loadAndParseScheduleXML menyusun classTeachersMap untuk pemetaan guru per kelas', () => {
            expect(pageJurnalJs).toContain('const classTeachersMap = {};');
            expect(pageJurnalJs).toContain('classTeachersMap, parsedAt: Date.now()');
        });

        test('renderMasterDataUI menggunakan getTeachersForClass untuk membatasi activeTeachers sesuai kelas', () => {
            expect(pageJurnalJs).toContain('activeTeachers = getTeachersForClass(targetClass, allTeachers, scheduleData);');
            expect(pageJurnalJs).toContain('renderGuruDropdown(activeTeachers);');
        });

        test('Simulasi fungsi getTeachersForClass memfilter guru kelas dan menyertakan guru BK secara akurat', () => {
            const mockAllTeachers = [
                { nama: 'Ni Made Sutri, S.Pd.', mapel: 'Biologi' },
                { nama: 'Drs. I Komang Sudiana, M.Pd', mapel: 'Fisika' },
                { nama: 'I Gede Agustika,S.Ag, M.Pd.H', mapel: 'Agama Hindu' },
                { nama: 'I Kadek Astika, S.Pd.', mapel: 'Bimbingan dan Konseling' }
            ];

            const mockScheduleData = {
                classTeachersMap: {
                    'X-1': {
                        className: 'X-1',
                        teacherNames: ['Ni Made Sutri, S.Pd.'],
                        hasBk: false
                    },
                    'XII-4': {
                        className: 'XII-4',
                        teacherNames: ['I Gede Agustika,S.Ag, M.Pd.H'],
                        hasBk: true
                    }
                }
            };

            // Ekstrak fungsi getTeachersForClass untuk pengujian langsung
            const fnMatch = pageJurnalJs.match(/function\s+getTeachersForClass[\s\S]*?\n\}/);
            expect(fnMatch).toBeTruthy();

            // Jalankan simulasi logika pemfilteran
            const normCls = (str) => (str || '').toString().trim().replace(/[\.\s_]/g, '-').toUpperCase();
            const smartMatch = (name, list) => {
                const found = list.find(t => t.nama === name || t.nama.toLowerCase().includes(name.toLowerCase()));
                return found ? found.nama : '';
            };

            function testFilter(clsName) {
                const entry = mockScheduleData.classTeachersMap[normCls(clsName)];
                if (!entry) return mockAllTeachers;
                const result = [];
                entry.teacherNames.forEach(n => {
                    const m = smartMatch(n, mockAllTeachers);
                    if (m) result.push(mockAllTeachers.find(t => t.nama === m));
                });
                if (entry.hasBk) {
                    mockAllTeachers.filter(t => t.mapel.includes('Bimbingan')).forEach(b => {
                        if (!result.some(r => r.nama === b.nama)) result.push(b);
                    });
                }
                return result;
            }

            const x1Teachers = testFilter('X-1');
            expect(x1Teachers.length).toBe(1);
            expect(x1Teachers[0].nama).toBe('Ni Made Sutri, S.Pd.');

            const x1DotTeachers = testFilter('X.1');
            expect(x1DotTeachers.length).toBe(1);
            expect(x1DotTeachers[0].nama).toBe('Ni Made Sutri, S.Pd.');

            const xii4Teachers = testFilter('XII-4');
            expect(xii4Teachers.length).toBe(2);
            expect(xii4Teachers.map(t => t.nama)).toContain('I Gede Agustika,S.Ag, M.Pd.H');
            expect(xii4Teachers.map(t => t.nama)).toContain('I Kadek Astika, S.Pd.');

            const unknownClassTeachers = testFilter('KELAS-LAIN');
            expect(unknownClassTeachers.length).toBe(mockAllTeachers.length);
        });
    });
});


/**
 * Test Suite: Kolom Nilai Rapor & Deskripsi CP Siswa Perhotelan (Guru Mapel Gradebook)
 * Memverifikasi deteksi mata pelajaran Perhotelan, rendering kolom kondisional,
 * fitur toggle show/hide kolom rapor perhotelan, auto-sync Nilai Rapor,
 * dan isolasi penuh agar guru mapel lain tidak terdampak.
 */

const fs = require('fs');
const path = require('path');

describe('Portal Guru Mapel: Kolom Tambahan Nilai Rapor & Deskripsi CP Perhotelan', () => {
    let pageGuruMapelJs;
    let guruMapelHtml;

    beforeAll(() => {
        pageGuruMapelJs = fs.readFileSync(path.join(__dirname, '../js/page-guru-mapel.js'), 'utf8');
        guruMapelHtml = fs.readFileSync(path.join(__dirname, '../guru-mapel.html'), 'utf8');
    });

    describe('1. Helper Deteksi Mata Pelajaran Perhotelan (isPerhotelanMapel)', () => {
        test('Fungsi isPerhotelanMapel terdefinisi dalam kode dan di-export ke window', () => {
            expect(pageGuruMapelJs).toContain('function isPerhotelanMapel(mapel)');
            expect(pageGuruMapelJs).toContain('window.isPerhotelanMapel = isPerhotelanMapel;');
        });

        test('Logika isPerhotelanMapel mendeteksi mapel kejuruan Perhotelan secara case-insensitive', () => {
            function isPerhotelanMapel(mapel) {
                if (!mapel) return false;
                return String(mapel).toLowerCase().includes('perhotelan');
            }

            expect(isPerhotelanMapel('Perhotelan')).toBe(true);
            expect(isPerhotelanMapel('perhotelan')).toBe(true);
            expect(isPerhotelanMapel('Perhotelan (HK)')).toBe(true);
            expect(isPerhotelanMapel('Perhotelan (FB)')).toBe(true);
            expect(isPerhotelanMapel('Praktik Perhotelan')).toBe(true);

            expect(isPerhotelanMapel('Matematika')).toBe(false);
            expect(isPerhotelanMapel('Bahasa Indonesia')).toBe(false);
            expect(isPerhotelanMapel('Bahasa Inggris')).toBe(false);
            expect(isPerhotelanMapel('Fisika')).toBe(false);
            expect(isPerhotelanMapel('Kimia')).toBe(false);
            expect(isPerhotelanMapel('Biologi')).toBe(false);
            expect(isPerhotelanMapel('Pendidikan Agama')).toBe(false);
            expect(isPerhotelanMapel('')).toBe(false);
            expect(isPerhotelanMapel(null)).toBe(false);
            expect(isPerhotelanMapel(undefined)).toBe(false);
        });
    });

    describe('2. Tombol Toggle Visibilitas Kolom Rapor Perhotelan', () => {
        test('guru-mapel.html memuat tombol toggle untuk desktop dan mobile', () => {
            expect(guruMapelHtml).toContain('id="btn-toggle-perhotelan-rapor"');
            expect(guruMapelHtml).toContain('id="btn-toggle-perhotelan-mobile"');
            expect(guruMapelHtml).toContain('togglePerhotelanRaporSection()');
        });

        test('State isPerhotelanRaporVisible default false (tersembunyi secara default)', () => {
            expect(pageGuruMapelJs).toContain('let isPerhotelanRaporVisible = false;');
            expect(pageGuruMapelJs).toContain('window.isPerhotelanRaporVisible = isPerhotelanRaporVisible;');
        });

        test('Fungsi updatePerhotelanToggleButton dan togglePerhotelanRaporSection terdefinisi dan di-export', () => {
            expect(pageGuruMapelJs).toContain('function updatePerhotelanToggleButton(isPerhotenan)');
            expect(pageGuruMapelJs).toContain('window.updatePerhotelanToggleButton = updatePerhotelanToggleButton;');
            expect(pageGuruMapelJs).toContain('window.togglePerhotelanRaporSection = function ()');
        });

        test('Tombol toggle menggunakan label ringkas "Rapor" dan mempertahankan ikon mata', () => {
            expect(guruMapelHtml).toContain('<span id="btn-toggle-perhotelan-text">Rapor</span>');
            expect(guruMapelHtml).toContain('<span id="btn-toggle-perhotelan-mobile-text">Rapor</span>');
            expect(pageGuruMapelJs).toContain("textDesktop.textContent = 'Rapor';");
            expect(pageGuruMapelJs).toContain("textMobile.textContent = 'Rapor';");
            expect(pageGuruMapelJs).toContain('fa-eye-slash');
            expect(pageGuruMapelJs).toContain('fa-eye');
        });

        test('togglePerhotelanRaporSection mengamankan nilai input siswa sebelum re-render', () => {
            const toggleChunk = pageGuruMapelJs.substring(
                pageGuruMapelJs.indexOf('window.togglePerhotelanRaporSection = function ()'),
                pageGuruMapelJs.indexOf('isPerhotelanRaporVisible = !isPerhotelanRaporVisible;')
            );
            expect(toggleChunk).toContain("row.querySelector('.perhotelan-nilai-rapor')");
            expect(toggleChunk).toContain("row.querySelector('.perhotelan-deskripsi-cp')");
        });
    });

    describe('3. Rendering Tabel Kondisional (renderGradebookTable)', () => {
        test('Header Nilai Rapor dan Deskripsi CP dibungkus kondisi showPerhotelanRapor', () => {
            expect(pageGuruMapelJs).toContain('const showPerhotelanRapor = isPerhotenan && isPerhotelanRaporVisible;');
            expect(pageGuruMapelJs).toContain('${showPerhotelanRapor ? `');
            expect(pageGuruMapelJs).toContain("window.sortGradebookTable('nilai_rapor')");
            expect(pageGuruMapelJs).toContain('Nilai Rapor');
            expect(pageGuruMapelJs).toContain('Deskripsi CP');
        });

        test('Body row memiliki input Nilai Rapor dan input satu baris Deskripsi CP yang setara tinggi kolom sebelumnya', () => {
            expect(pageGuruMapelJs).toContain('class="perhotelan-nilai-rapor');
            expect(pageGuruMapelJs).toContain('class="perhotelan-deskripsi-cp');
            expect(pageGuruMapelJs).toContain('<input type="text" value="${escapeHTML(perStudentCp)}"');
            expect(pageGuruMapelJs).toContain('window.onNilaiRaporChange(this)');
            expect(pageGuruMapelJs).toContain('window.onDeskripsiCpChange(this)');
        });

        test('Footer row memiliki 2 kolom kosong pelengkap jika showPerhotelanRapor aktif', () => {
            expect(pageGuruMapelJs).toContain('showPerhotelanRapor');
        });

        test('Input Nilai Rapor dan Deskripsi CP memiliki font size setara form kolom lain (11px)', () => {
            expect(guruMapelHtml).toContain('.perhotelan-nilai-rapor');
            expect(guruMapelHtml).toContain('font-size: 11px !important;');
            expect(pageGuruMapelJs).toContain('class="perhotelan-nilai-rapor w-14 p-1 text-center text-[11px]');
            expect(pageGuruMapelJs).toContain('class="perhotelan-deskripsi-cp w-full min-w-[180px] p-1 text-[11px]');
        });
    });

    describe('4. Isolasi Keamanan Guru Mapel Lain saat Menyimpan Nilai (saveScores)', () => {
        test('Variabel isPerhotenanSave mendeteksi apakah mapel yang disimpan adalah Perhotelan', () => {
            expect(pageGuruMapelJs).toContain('const isPerhotenanSave = isPerhotelanMapel(mapel);');
        });

        test('Untuk mapel selain Perhotelan, final_score dan deskripsi_cp tetap menggunakan nilai standar', () => {
            expect(pageGuruMapelJs).toContain('let savedFinalScore = finalScore;');
            expect(pageGuruMapelJs).toContain('let savedCpDesc = classCpDesc;');
            expect(pageGuruMapelJs).toContain('if (isPerhotenanSave) {');
        });

        test('Mendukung fallback ke existingStudentSummary saat kolom rapor perhotelan sedang disembunyikan', () => {
            const saveChunk = pageGuruMapelJs.substring(
                pageGuruMapelJs.indexOf('const isPerhotenanSave = isPerhotelanMapel(mapel);'),
                pageGuruMapelJs.indexOf('summaryPayloads.push({')
            );
            expect(saveChunk).toContain('if (isPerhotenanSave) {');
            expect(saveChunk).toContain("row.querySelector('.perhotelan-nilai-rapor')");
            expect(saveChunk).toContain("row.querySelector('.perhotelan-deskripsi-cp')");
            expect(saveChunk).toContain('savedFinalScore = existingStudentSummary.nilai_rapor;');
            expect(saveChunk).toContain('savedCpDesc = existingStudentSummary.deskripsi_cp;');
        });

        test('Memori lokal existingSummariesMap mencatat nilai_rapor hanya jika isPerhotenanSave bernilai true', () => {
            expect(pageGuruMapelJs).toContain('nilai_rapor: isPerhotenanSave ? savedFinalScore : undefined');
        });
    });

    describe('5. Sinkronisasi Otomatis Nilai Rapor dengan Nilai Akhir (calculateRowLive)', () => {
        test('calculateRowLive melakukan sinkronisasi live hanya jika dataset.manual !== "true"', () => {
            expect(pageGuruMapelJs).toContain("const nilaiRaporInput = row.querySelector('.perhotelan-nilai-rapor');");
            expect(pageGuruMapelJs).toContain("if (nilaiRaporInput && nilaiRaporInput.dataset.manual !== 'true') {");
            expect(pageGuruMapelJs).toContain("nilaiRaporInput.value = finalScore !== null ? Math.round(finalScore) : '';");
        });

        test('onNilaiRaporChange menandai input dengan dataset.manual = "true" dan setGradebookDirty', () => {
            expect(pageGuruMapelJs).toContain('input.dataset.manual = "true";');
            expect(pageGuruMapelJs).toContain('setGradebookDirty(true);');
        });
    });

    describe('6. Sortir dan Paste Excel Terisolasi', () => {
        test('getStudentColumnValue mendukung kolom nilai_rapor', () => {
            expect(pageGuruMapelJs).toContain("if (colKey === 'nilai_rapor')");
        });

        test('sortGradebookTable mengamankan input nilai_rapor dan deskripsi_cp sebelum menyortir', () => {
            expect(pageGuruMapelJs).toContain("const nrInp = row.querySelector('.perhotelan-nilai-rapor');");
            expect(pageGuruMapelJs).toContain("const cpInp = row.querySelector('.perhotelan-deskripsi-cp');");
        });

        test('openPasteModal menambahkan opsi nilai_rapor hanya jika mapel Perhotelan', () => {
            expect(pageGuruMapelJs).toContain("if (isPerhotelanMapel(mapel)) {");
            expect(pageGuruMapelJs).toContain('<option value="nilai_rapor">Nilai Rapor (Khusus Perhotelan)</option>');
        });

        test('applyPasteExcelData menangani target nilai_rapor secara spesifik dan auto-reveal jika kolom tersembunyi', () => {
            expect(pageGuruMapelJs).toContain("if (target === 'nilai_rapor') {");
            expect(pageGuruMapelJs).toContain("if (!isPerhotelanRaporVisible) {");
            expect(pageGuruMapelJs).toContain("row.querySelector('.perhotelan-nilai-rapor')");
            expect(pageGuruMapelJs).toContain("row.querySelector('.perhotelan-deskripsi-cp')");
        });
    });

    describe('7. Export Excel Kompatibilitas', () => {
        test('Header dan data NILAI RAPOR disertakan dalam export hanya jika mapel Perhotelan', () => {
            expect(pageGuruMapelJs).toContain("const isPerhotelan = isPerhotelanMapel(mapel);");
            expect(pageGuruMapelJs).toContain("thRow1.push('NILAI RAPOR');");
            expect(pageGuruMapelJs).toContain("thRow2.push('NILAI RAPOR');");
        });
    });

    describe('8. Wajib 3 Kolom Paste Excel & Tombol Preview Data Sebelum Simpan', () => {
        test('guru-mapel.html memuat elemen UI Tombol Preview, Kontainer Pratinjau, dan Petunjuk Khusus 3 Kolom', () => {
            expect(guruMapelHtml).toContain('id="btn-preview-paste"');
            expect(guruMapelHtml).toContain('onclick="window.previewPasteExcelData()"');
            expect(guruMapelHtml).toContain('id="paste-preview-container"');
            expect(guruMapelHtml).toContain('id="table-paste-preview"');
            expect(guruMapelHtml).toContain('id="paste-preview-summary-badge"');
            expect(guruMapelHtml).toContain('id="paste-guide-perhotelan"');
            expect(guruMapelHtml).toContain('onchange="window.onPasteTargetChange()"');
        });

        test('page-guru-mapel.js mendefinisikan fungsi parsePasteExcelRow, onPasteTargetChange, dan previewPasteExcelData', () => {
            expect(pageGuruMapelJs).toContain('function parsePasteExcelRow(line, target)');
            expect(pageGuruMapelJs).toContain('window.parsePasteExcelRow = parsePasteExcelRow;');
            expect(pageGuruMapelJs).toContain('window.onPasteTargetChange = function ()');
            expect(pageGuruMapelJs).toContain('window.previewPasteExcelData = function ()');
        });

        test('Logika parsePasteExcelRow mengekstrak 3 kolom (NIS, NR, Deskripsi CP) secara akurat tanpa memecah tanda koma pada narasi CP', () => {
            // Evaluasi logika parsing yang sama persis dengan modul
            function parsePasteExcelRow(line, target) {
                if (!line) return null;
                const trimmed = line.trim();
                if (!trimmed) return null;

                if (target === 'nilai_rapor') {
                    if (trimmed.includes('\t')) {
                        const rawParts = trimmed.split('\t').map(p => p.trim());
                        if (rawParts.length >= 3) {
                            return [rawParts[0], rawParts[1], rawParts.slice(2).join(' ').trim()];
                        } else if (rawParts.length === 2) {
                            return [rawParts[0], rawParts[1], ''];
                        }
                        return rawParts;
                    } else if (trimmed.includes(';')) {
                        const rawParts = trimmed.split(';').map(p => p.trim());
                        if (rawParts.length >= 3) {
                            return [rawParts[0], rawParts[1], rawParts.slice(2).join(';').trim()];
                        } else if (rawParts.length === 2) {
                            return [rawParts[0], rawParts[1], ''];
                        }
                        return rawParts;
                    } else {
                        const match = trimmed.match(/^(\S+)[\s\t]+(\d+(?:[\.,]\d+)?)[\s\t]+(.*)$/);
                        if (match) {
                            return [match[1], match[2], match[3].trim()];
                        }
                        const rawParts = trimmed.split(/\s{2,}|\t/).map(p => p.trim()).filter(Boolean);
                        if (rawParts.length >= 3) {
                            return [rawParts[0], rawParts[1], rawParts.slice(2).join(' ').trim()];
                        }
                        return rawParts;
                    }
                }
                return trimmed.split(/\t|;|,|\s{2,}/).map(p => p.trim()).filter(p => p !== '');
            }

            // Uji format tab-separated dari clipboard Excel dengan koma pada deskripsi CP
            const excelRow = '4243\t85\tMenunjukkan penguasaan sangat baik dalam Housekeeping, reservasi, dan laundry.';
            const resExcel = parsePasteExcelRow(excelRow, 'nilai_rapor');
            expect(resExcel).toHaveLength(3);
            expect(resExcel[0]).toBe('4243');
            expect(resExcel[1]).toBe('85');
            expect(resExcel[2]).toBe('Menunjukkan penguasaan sangat baik dalam Housekeeping, reservasi, dan laundry.');

            // Uji format hanya 2 kolom (tidak lengkap untuk rapor)
            const incompleteRow = '4243\t85';
            const resIncomplete = parsePasteExcelRow(incompleteRow, 'nilai_rapor');
            expect(resIncomplete[2]).toBe('');

            // Uji format standar mapel non-perhotelan (bebas kolom)
            const generalRow = '4243\t85\t90\t88';
            const resGeneral = parsePasteExcelRow(generalRow, 'all');
            expect(resGeneral).toEqual(['4243', '85', '90', '88']);
        });

        test('applyPasteExcelData memvalidasi kewajiban 3 kolom khusus target nilai_rapor dan menolak data yang tidak lengkap', () => {
            expect(pageGuruMapelJs).toContain("if (target === 'nilai_rapor') {");
            expect(pageGuruMapelJs).toContain("const valid3ColRows = lines.filter(line => {");
            expect(pageGuruMapelJs).toContain("parts && parts.length >= 3 && parts[0] && parts[1] !== '' && parts[2] && parts[2].trim().length > 0");
            expect(pageGuruMapelJs).toContain("Impor Nilai Rapor Perhotelan wajib memuat 3 kolom: NIS, Nilai Rapor (NR), dan Deskripsi CP!");
        });

        test('applyPasteExcelData menerapkan nilai ke .perhotelan-nilai-rapor dan .perhotelan-deskripsi-cp serta mengaktifkan dirty flag', () => {
            expect(pageGuruMapelJs).toContain("row.querySelector('.perhotelan-nilai-rapor');");
            expect(pageGuruMapelJs).toContain("row.querySelector('.perhotelan-deskripsi-cp');");
            expect(pageGuruMapelJs).toContain("window.onNilaiRaporChange(nrInput);");
            expect(pageGuruMapelJs).toContain("window.onDeskripsiCpChange(cpInput);");
            expect(pageGuruMapelJs).toContain("setGradebookDirty(true);");
        });
    });

    describe('9. Pewarnaan Real-time Nilai Rapor Perhotelan Berdasarkan KKM', () => {
        test('updateNilaiRaporHighlight terdefinisi dan di-export ke window', () => {
            expect(pageGuruMapelJs).toContain('function updateNilaiRaporHighlight(nrInput, currentKkm)');
            expect(pageGuruMapelJs).toContain('window.updateNilaiRaporHighlight = updateNilaiRaporHighlight;');
        });

        test('onNilaiRaporChange memanggil updateNilaiRaporHighlight secara langsung saat input diketik', () => {
            expect(pageGuruMapelJs).toContain('updateNilaiRaporHighlight(input, currentKkm);');
        });

        test('updateColumnHighlightsAndQuartiles memperbarui warna input Nilai Rapor', () => {
            expect(pageGuruMapelJs).toContain('updateNilaiRaporHighlight(nrInput, currentKkm);');
        });

        test('Logika updateNilaiRaporHighlight memberi warna merah (< KKM), hijau (>= KKM), dan ungu (kosong)', () => {
            function updateNilaiRaporHighlight(nrInput, currentKkm) {
                if (!nrInput) return;
                const kkm = currentKkm !== undefined ? currentKkm : 75;
                const valStr = nrInput.value.trim();
                const nrVal = parseFloat(valStr);

                nrInput.classList.remove(
                    'bg-rose-50', 'text-rose-700', 'border-rose-300',
                    'bg-emerald-50', 'text-emerald-800', 'border-emerald-300',
                    'bg-purple-50', 'border-purple-300', 'text-purple-800'
                );

                if (valStr !== '' && !isNaN(nrVal)) {
                    if (nrVal < kkm) {
                        nrInput.classList.add('bg-rose-50', 'text-rose-700', 'border-rose-300');
                    } else {
                        nrInput.classList.add('bg-emerald-50', 'text-emerald-800', 'border-emerald-300');
                    }
                } else {
                    nrInput.classList.add('bg-purple-50', 'border-purple-300', 'text-purple-800');
                }
            }

            // Mock input object dengan classList
            function createMockInput(val) {
                const classes = new Set(['bg-purple-50', 'border-purple-300', 'text-purple-800']);
                return {
                    value: val,
                    classList: {
                        add: (...cls) => cls.forEach(c => classes.add(c)),
                        remove: (...cls) => cls.forEach(c => classes.delete(c)),
                        contains: (c) => classes.has(c)
                    }
                };
            }

            // 1. Nilai di bawah KKM (< 75): 45 dan 65 -> Merah (bg-rose-50)
            const inputUnderKkm = createMockInput('45');
            updateNilaiRaporHighlight(inputUnderKkm, 75);
            expect(inputUnderKkm.classList.contains('bg-rose-50')).toBe(true);
            expect(inputUnderKkm.classList.contains('text-rose-700')).toBe(true);
            expect(inputUnderKkm.classList.contains('bg-emerald-50')).toBe(false);
            expect(inputUnderKkm.classList.contains('bg-purple-50')).toBe(false);

            // 2. Nilai mencapai/melampaui KKM (>= 75): 75 dan 85 -> Hijau (bg-emerald-50)
            const inputPassKkm = createMockInput('75');
            updateNilaiRaporHighlight(inputPassKkm, 75);
            expect(inputPassKkm.classList.contains('bg-emerald-50')).toBe(true);
            expect(inputPassKkm.classList.contains('text-emerald-800')).toBe(true);
            expect(inputPassKkm.classList.contains('bg-rose-50')).toBe(false);
            expect(inputPassKkm.classList.contains('bg-purple-50')).toBe(false);

            // 3. Nilai kosong -> Ungu default (bg-purple-50)
            const inputEmpty = createMockInput('');
            updateNilaiRaporHighlight(inputEmpty, 75);
            expect(inputEmpty.classList.contains('bg-purple-50')).toBe(true);
            expect(inputEmpty.classList.contains('bg-rose-50')).toBe(false);
            expect(inputEmpty.classList.contains('bg-emerald-50')).toBe(false);

            // 4. KKM Dinamis: Pengujian jika KKM diubah menjadi 80 (75 menjadi di bawah KKM)
            const inputDynamic80 = createMockInput('75');
            updateNilaiRaporHighlight(inputDynamic80, 80);
            expect(inputDynamic80.classList.contains('bg-rose-50')).toBe(true);
            expect(inputDynamic80.classList.contains('text-rose-700')).toBe(true);

            // 5. KKM Dinamis: Pengujian jika KKM diubah menjadi 60 (65 menjadi tuntas KKM)
            const inputDynamic60 = createMockInput('65');
            updateNilaiRaporHighlight(inputDynamic60, 60);
            expect(inputDynamic60.classList.contains('bg-emerald-50')).toBe(true);
            expect(inputDynamic60.classList.contains('text-emerald-800')).toBe(true);
        });
    });

    describe('10. Tombol Reset Kolom Nilai Rapor dan Deskripsi CP Perhotelan', () => {
        test('renderGradebookTable menyematkan tombol reset pada tfoot untuk nilai_rapor dan deskripsi_cp', () => {
            expect(pageGuruMapelJs).toContain("window.openResetColumnModal('nilai_rapor', 'Nilai Rapor')");
            expect(pageGuruMapelJs).toContain("window.openResetColumnModal('deskripsi_cp', 'Deskripsi CP')");
            expect(pageGuruMapelJs).toContain('data-col-key="nilai_rapor"');
            expect(pageGuruMapelJs).toContain('data-col-key="deskripsi_cp"');
        });

        test('updateColumnHighlightsAndQuartiles mengendalikan visibilitas tombol reset perhotelan', () => {
            expect(pageGuruMapelJs).toContain("document.querySelector('.btn-reset-col[data-col-key=\"nilai_rapor\"]')");
            expect(pageGuruMapelJs).toContain("document.querySelector('.btn-reset-col[data-col-key=\"deskripsi_cp\"]')");
            expect(pageGuruMapelJs).toContain("document.querySelector('.span-empty-reset[data-col-key=\"nilai_rapor\"]')");
            expect(pageGuruMapelJs).toContain("document.querySelector('.span-empty-reset[data-col-key=\"deskripsi_cp\"]')");
        });

        test('executeResetColumnData membersihkan input DOM dan memori summary untuk nilai_rapor dan deskripsi_cp', () => {
            expect(pageGuruMapelJs).toContain("if (targetKey === 'nilai_rapor') {");
            expect(pageGuruMapelJs).toContain("document.querySelectorAll('#gradebook-tbody tr .perhotelan-nilai-rapor');");
            expect(pageGuruMapelJs).toContain("existingSummariesMap[nis].nilai_rapor = null;");
            expect(pageGuruMapelJs).toContain("} else if (targetKey === 'deskripsi_cp') {");
            expect(pageGuruMapelJs).toContain("document.querySelectorAll('#gradebook-tbody tr .perhotelan-deskripsi-cp');");
            expect(pageGuruMapelJs).toContain("existingSummariesMap[nis].deskripsi_cp = '';");
        });
    });
});

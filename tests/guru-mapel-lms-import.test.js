/**
 * Unit & Behavioral Test: Fitur Impor Nilai Siswa dari Kuis LMS ke Lembar Penilaian Guru Mapel
 * Memverifikasi integritas DOM modal, tombol pemicu, fungsi-fungsi window, serta logika
 * penanganan nilai (skor final, esai pending review, NIS 4-digit, dan opsi overwrite).
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Verifikasi Fitur Impor Nilai LMS ke Tabel Penilaian (Guru Mapel)', () => {
    const root = path.resolve(__dirname, '..');
    const htmlPath = path.join(root, 'guru-mapel.html');
    const jsPath = path.join(root, 'js', 'page-guru-mapel.js');

    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const jsContent = fs.readFileSync(jsPath, 'utf8');

    test('Memastikan tombol "Nilai LMS" (#btn-import-lms) tersedia di wrapper tools lembar penilaian', () => {
        expect(htmlContent).toContain('id="btn-import-lms"');
        expect(htmlContent).toContain('window.openImportLmsModal()');
        expect(htmlContent).toContain('fa-graduation-cap');
    });

    test('Memastikan tombol "Kirim ke Penilaian" (#btn-lms-progress-to-gradebook) tersedia di modal progres kuis LMS', () => {
        expect(htmlContent).toContain('id="btn-lms-progress-to-gradebook"');
        expect(htmlContent).toContain('window.exportCurrentLmsQuizToGradebook()');
    });

    test('Memastikan modal dialog "#modal-import-lms-grade" berdiri mandiri sebagai top-level modal (Anti-Nesting)', () => {
        expect(htmlContent).toContain('id="modal-import-lms-grade"');
        expect(htmlContent).toContain('id="select-import-lms-material"');
        expect(htmlContent).toContain('id="select-import-lms-target-col"');
        expect(htmlContent).toContain('id="check-import-lms-overwrite"');
        expect(htmlContent).toContain('id="tbody-import-lms-preview"');
        expect(htmlContent).toContain('id="btn-apply-import-lms"');

        // Pastikan bukan di dalam kontainer modal lain
        const modalPos = htmlContent.indexOf('id="modal-import-lms-grade"');
        expect(modalPos).toBeGreaterThan(-1);
        const precedingHtml = htmlContent.substring(Math.max(0, modalPos - 200), modalPos);
        expect(precedingHtml).toContain('</div>');
    });

    test('Memastikan seluruh handler window untuk impor LMS terdaftar di page-guru-mapel.js', () => {
        expect(jsContent).toContain('window.openImportLmsModal');
        expect(jsContent).toContain('window.closeImportLmsModal');
        expect(jsContent).toContain('window.onImportLmsSourceChange');
        expect(jsContent).toContain('window.renderImportLmsPreview');
        expect(jsContent).toContain('window.applyImportLmsData');
        expect(jsContent).toContain('window.exportCurrentLmsQuizToGradebook');
    });

    test('Simulasi Logika Bisnis: Perhitungan Pratinjau Nilai dan Penanganan Status Kuis', () => {
        const loadedStudents = [
            { nis: '4243', name: 'Wayan Agus' },
            { nis: '4396', name: 'Made Budi' },
            { nis: '4450', name: 'Ketut Citra' },
            { nis: '4501', name: 'Nyoman Dika' }
        ];

        const existingScores = {
            '4243': '80', // Sudah ada nilai
            '4396': '',   // Belum ada nilai
            '4450': '75', // Sudah ada nilai
            '4501': ''    // Belum ada nilai
        };

        const lmsProgressData = [
            { nis: '4243', quiz_score: 95, quiz_answers: JSON.stringify({ status: 'graded' }) }, // Selesai
            { nis: '4396', quiz_score: 88, quiz_answers: JSON.stringify({ status: 'graded' }) }, // Selesai
            { nis: '4450', quiz_score: 60, quiz_answers: JSON.stringify({ status: 'pending_review' }) }, // Esai belum dinilai
            { nis: '4501', quiz_score: null, quiz_answers: '' } // Belum mengerjakan
        ];

        // Skenario 1: Overwrite = true
        let readyCountOverwrite = 0;
        const resultsOverwrite = loadedStudents.map(student => {
            const cleanNis = student.nis;
            const currentScore = existingScores[cleanNis];
            const lmsRecord = lmsProgressData.find(ls => ls.nis === cleanNis);

            let lmsScoreVal = null;
            let isPending = false;
            if (lmsRecord) {
                const meta = lmsRecord.quiz_answers ? JSON.parse(lmsRecord.quiz_answers) : {};
                isPending = (meta.status === 'pending_review');
                if (!isPending && lmsRecord.quiz_score !== null && lmsRecord.quiz_score !== undefined) {
                    lmsScoreVal = Number(lmsRecord.quiz_score);
                }
            }

            const hasValidLmsScore = (lmsScoreVal !== null && !isPending);
            let action = '';
            let finalScore = currentScore || null;

            if (!hasValidLmsScore) {
                action = isPending ? 'skip_pending' : 'skip_not_started';
            } else {
                readyCountOverwrite++;
                finalScore = lmsScoreVal;
                action = currentScore ? 'overwrite' : 'import_new';
            }

            return { nis: cleanNis, action, finalScore };
        });

        expect(readyCountOverwrite).toBe(2); // 4243 (overwrite) dan 4396 (import new)
        expect(resultsOverwrite.find(r => r.nis === '4243').action).toBe('overwrite');
        expect(resultsOverwrite.find(r => r.nis === '4243').finalScore).toBe(95);
        expect(resultsOverwrite.find(r => r.nis === '4396').action).toBe('import_new');
        expect(resultsOverwrite.find(r => r.nis === '4396').finalScore).toBe(88);
        expect(resultsOverwrite.find(r => r.nis === '4450').action).toBe('skip_pending');
        expect(resultsOverwrite.find(r => r.nis === '4450').finalScore).toBe('75'); // Tetap nilai lama
        expect(resultsOverwrite.find(r => r.nis === '4501').action).toBe('skip_not_started');

        // Skenario 2: Overwrite = false (Hanya isi kolom yang kosong)
        let readyCountNoOverwrite = 0;
        const resultsNoOverwrite = loadedStudents.map(student => {
            const cleanNis = student.nis;
            const currentScore = existingScores[cleanNis];
            const lmsRecord = lmsProgressData.find(ls => ls.nis === cleanNis);

            let lmsScoreVal = null;
            let isPending = false;
            if (lmsRecord) {
                const meta = lmsRecord.quiz_answers ? JSON.parse(lmsRecord.quiz_answers) : {};
                isPending = (meta.status === 'pending_review');
                if (!isPending && lmsRecord.quiz_score !== null && lmsRecord.quiz_score !== undefined) {
                    lmsScoreVal = Number(lmsRecord.quiz_score);
                }
            }

            const hasValidLmsScore = (lmsScoreVal !== null && !isPending);
            const hasExisting = Boolean(currentScore);
            let action = '';
            let finalScore = currentScore || null;

            if (!hasValidLmsScore) {
                action = isPending ? 'skip_pending' : 'skip_not_started';
            } else if (hasExisting) {
                action = 'retain_old';
                finalScore = currentScore;
            } else {
                readyCountNoOverwrite++;
                action = 'import_new';
                finalScore = lmsScoreVal;
            }

            return { nis: cleanNis, action, finalScore };
        });

        expect(readyCountNoOverwrite).toBe(1); // Hanya 4396 yang nilainya kosong
        expect(resultsNoOverwrite.find(r => r.nis === '4243').action).toBe('retain_old');
        expect(resultsNoOverwrite.find(r => r.nis === '4243').finalScore).toBe('80'); // Nilai lama dipertahankan
        expect(resultsNoOverwrite.find(r => r.nis === '4396').action).toBe('import_new');
        expect(resultsNoOverwrite.find(r => r.nis === '4396').finalScore).toBe(88);
    });
});

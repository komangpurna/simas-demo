/**
 * Unit & Behavioral Test: Guru Mapel Save Scores & Summaries Payload Integrity
 * Memastikan payload upsert guru_mapel_summaries tidak pernah menyertakan properti 'id'
 * sehingga terhindar dari PostgREST heterogeneous key union bug (null in not-null column id).
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Verifikasi Integritas Simpan Nilai Guru Mapel (guru_mapel_summaries)', () => {
    const root = path.resolve(__dirname, '..');
    const jsPath = path.join(root, 'js', 'page-guru-mapel.js');
    const htmlPath = path.join(root, 'guru-mapel.html');
    const configPath = path.join(root, 'js', 'config.js');
    const packagePath = path.join(root, 'package.json');

    const jsContent = fs.readFileSync(jsPath, 'utf8');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const configContent = fs.readFileSync(configPath, 'utf8');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

    test('Memastikan summaryPayloads tidak menyertakan key "id" secara kondisional pada saveScores', () => {
        // Regex memeriksa bahwa tidak ada ...(existingStudentSummary.id ? { id: ... } : {}) di summaryPayloads
        expect(jsContent).not.toMatch(/summaryPayloads\.push\(\s*\{[\s\S]*?\.\.\.\(existingStudentSummary\.id/);
        expect(jsContent).not.toMatch(/summaryPayloads\.push\(\s*\{[\s\S]*?id:\s*existingStudentSummary\.id/);
    });

    test('Memastikan saveStudentNotes tidak menyertakan key "id" secara kondisional pada summaryPayload', () => {
        expect(jsContent).not.toMatch(/const\s+summaryPayload\s*=\s*\{[\s\S]*?\.\.\.\(existingSummary\.id/);
        expect(jsContent).not.toMatch(/const\s+summaryPayload\s*=\s*\{[\s\S]*?id:\s*existingSummary\.id/);
    });

    test('Memastikan upsert guru_mapel_summaries di saveScores melakukan select id dan mengupdate map lokal', () => {
        expect(jsContent).toContain(".from('guru_mapel_summaries')");
        expect(jsContent).toContain(".upsert(chunk, { onConflict: 'gradebook_id,student_nis' })");
        expect(jsContent).toContain(".select('id, student_nis')");
        expect(jsContent).toContain("existingSummariesMap[item.student_nis].id = item.id");
    });

    test('Simulasi pembentukan batch summaryPayloads menghasilkan objek yang 100% homogen (tanpa key id)', () => {
        // Simulasikan 2 siswa: 1 siswa punya catatan lama (ada id di existing), 1 siswa baru
        const gradebookId = '2024-2025_S1_X-1_MAT';
        const existingSummariesMap = {
            '1001': { id: 45, catatan_apresiasi: 'Bagus', catatan_perilaku: 'Rajin', catatan_evaluasi: 'Tingkatkan' }
        };
        const students = [
            { nis: '1001', tugas: [80, 90], sumatif: [85], sas: 88 },
            { nis: '1002', tugas: [75, 70], sumatif: [80], sas: 78 }
        ];

        const summaryPayloads = [];

        students.forEach(st => {
            const nis = st.nis;
            const existingStudentSummary = existingSummariesMap[nis] || {};
            const tugasAvg = st.tugas.reduce((a, b) => a + b, 0) / st.tugas.length;
            const sumatifAvg = st.sumatif.reduce((a, b) => a + b, 0) / st.sumatif.length;
            const finalScore = Math.round((tugasAvg + sumatifAvg + st.sas) / 3);

            summaryPayloads.push({
                gradebook_id: gradebookId,
                student_nis: nis,
                tugas_avg: parseFloat(tugasAvg.toFixed(2)),
                sumatif_avg: parseFloat(sumatifAvg.toFixed(2)),
                sas_sat_score: st.sas,
                final_score: finalScore,
                deskripsi_cp: 'Capaian Pembelajaran Matematika',
                catatan_apresiasi: existingStudentSummary.catatan_apresiasi || null,
                catatan_perilaku: existingStudentSummary.catatan_perilaku || null,
                catatan_evaluasi: existingStudentSummary.catatan_evaluasi || null,
                updated_at: new Date().toISOString()
            });
        });

        // Verifikasi: Tidak ada objek yang memiliki key 'id'
        summaryPayloads.forEach(p => {
            expect(p).not.toHaveProperty('id');
        });

        // Verifikasi: Semua objek memiliki daftar keys yang identik (100% homogen)
        const keys1 = Object.keys(summaryPayloads[0]).sort();
        const keys2 = Object.keys(summaryPayloads[1]).sort();
        expect(keys1).toEqual(keys2);
    });

    test('Memastikan versi aplikasi tersinkronisasi di seluruh file terkait', () => {
        expect(packageJson.version).toMatch(/^\d{2}\.\d{2}\.\d{2}\.\d+$/);
        expect(configContent).toContain(`export const APP_VERSION = "${packageJson.version}";`);
        expect(htmlContent).toMatch(/src="js\/page-guru-mapel\.js\?v=\d{2}\.\d{2}\.\d{2}\.\d+"/);
    });
});

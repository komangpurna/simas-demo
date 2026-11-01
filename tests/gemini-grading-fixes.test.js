/**
 * tests/gemini-grading-fixes.test.js
 * Pengujian perbaikan Modul Koreksi AI Portal Guru Mapel:
 * pemetaan lembar ke siswa, normalisasi skor, impor ke Tab Penilaian, riwayat sesi,
 * dan otorisasi kepemilikan sesi di Cloudflare Worker.
 */
const fs = require('node:fs');
const path = require('node:path');

const {coreHelpers}=require('./helpers/ai-grading-harness.cjs');
const core=coreHelpers();
const rootDir = path.resolve(__dirname, '..');
const geminiJs = fs.readFileSync(path.join(rootDir, 'js', 'gemini-grading.js'), 'utf8');
const pageJs = fs.readFileSync(path.join(rootDir, 'js', 'page-guru-mapel.js'), 'utf8');
const html = fs.readFileSync(path.join(rootDir, 'guru-mapel.html'), 'utf8');
const workerJs = fs.readFileSync(path.join(rootDir, 'cloudflare', 'worker.js'), 'utf8');

/** Mengambil source satu fungsi top-level berdasarkan nama (pencocokan kurung kurawal). */
function extractFunction(src, name) {
    const startRe = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`);
    const m = startRe.exec(src);
    if (!m) throw new Error(`Fungsi ${name} tidak ditemukan`);
    let i = src.indexOf('{', m.index);
    let depth = 0;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
            depth--;
            if (depth === 0) break;
        }
    }
    return src.slice(m.index, i + 1).replace(/^export\s+/, '');
}

function loadGradingHelpers(state) {
    state.questions=state.questions.map(q=>({text:'Soal',rubric:'Kunci',answerType:'auto',...q}));
    const names = [
        'normalizePersonName',
        'detectStudentFromFilenameOrHeader',
        'matchStudentFromAiIdentity',
        'getRubricMaxTotal',
        'clampScore',
        'computeTotalScore',
        'normalizeAiScores',
        'parseGeminiJson',
        'extractGeminiText'
    ];
    const body = names.map(n => extractFunction(geminiJs, n)).join('\n') + `\nreturn { ${names.join(', ')} };`;
    // eslint-disable-next-line no-new-func
    return new Function('AI_GRADING_STATE', 'calculateTotal', 'clampItemScore', 'normalizeGradingResult', body)(state, core.calculateTotal, core.clampItemScore, core.normalizeGradingResult);
}

const students = [
    { nis: '1001', name: 'Budi Santoso', noAbsen: 1 },
    { nis: '1002', name: 'Citra Lestari', noAbsen: 2 },
    { nis: '1003', name: 'Dewi Anggraini', noAbsen: 3 },
    { nis: '1004', name: 'Dewi Kartika', noAbsen: 4 },
    { nis: '1010', name: 'Made Wirawan', noAbsen: 10 }
];

describe('Koreksi AI - pemetaan lembar jawaban ke siswa', () => {
    const h = loadGradingHelpers({ questions: [] });

    test('nama file kamera/WhatsApp tidak salah dipetakan sebagai no. absen', () => {
        expect(h.detectStudentFromFilenameOrHeader('WhatsApp Image 2026-10-11 at 10.15.32.jpeg', students)).toBeNull();
        expect(h.detectStudentFromFilenameOrHeader('IMG_20261011_101532.jpg', students)).toBeNull();
    });

    test('no. absen di awal nama file atau setelah kata "absen" dikenali', () => {
        expect(h.detectStudentFromFilenameOrHeader('01_Budi.jpg', students).nis).toBe('1001');
        expect(h.detectStudentFromFilenameOrHeader('absen 10.jpg', students).nis).toBe('1010');
        expect(h.detectStudentFromFilenameOrHeader('lembar no 2.png', students).nis).toBe('1002');
    });

    test('NIS dan nama siswa dikenali, nama depan ambigu tidak dipetakan', () => {
        expect(h.detectStudentFromFilenameOrHeader('jawaban-1003.jpg', students).nis).toBe('1003');
        expect(h.detectStudentFromFilenameOrHeader('citra.jpg', students).nis).toBe('1002');
        expect(h.detectStudentFromFilenameOrHeader('dewi kartika.jpg', students).nis).toBe('1004');
        expect(h.detectStudentFromFilenameOrHeader('dewi.jpg', students)).toBeNull();
    });

    test('identitas yang dibaca AI dari kop lembar dicocokkan dengan aman', () => {
        expect(h.matchStudentFromAiIdentity('BUDI SANTOSO', '', students).nis).toBe('1001');
        expect(h.matchStudentFromAiIdentity('Dewi Kartika', '', students).nis).toBe('1004');
        expect(h.matchStudentFromAiIdentity('Dewi', '', students)).toBeNull();
        expect(h.matchStudentFromAiIdentity('', 'No. 10', students).nis).toBe('1010');
        expect(h.matchStudentFromAiIdentity('Nama Tidak Dikenal', '', students)).toBeNull();
    });
});

describe('Koreksi AI - normalisasi skor', () => {
    test('nilai akhir dihitung dari skor per butir (bukan totalScore AI) dan dijepit ke skor maksimal', () => {
        const state = { questions: [{ no: 1, maxScore: 60 }, { no: 2, maxScore: 40 }] };
        const h = loadGradingHelpers(state);
        const scores = h.normalizeAiScores([
            { no: 1, score: 75, studentAnswerText: 'a', aiAnalysis:'Jawaban benar' },
            { no: 2, score: 30, studentAnswerText:'b', aiAnalysis:'Jawaban parsial' }
        ]);
        expect(scores.map(s => s.score)).toEqual([60, 30]);
        expect(h.computeTotalScore(scores)).toBe(90);
    });

    test('rubrik dengan total bukan 100 dikonversi ke skala 0-100', () => {
        const state = { questions: [{ no: 1, maxScore: 10 }, { no: 2, maxScore: 10 }] };
        const h = loadGradingHelpers(state);
        expect(h.computeTotalScore([{ no: 1, score: 10 }, { no: 2, score: 5 }])).toBe(75);
        expect(h.computeTotalScore([{ no: 1, score: -3 }, { no: 2, score: 'abc' }])).toBeNull();
    });

    test('respons Gemini multi-part dan blok markdown tetap terbaca', () => {
        const h = loadGradingHelpers({ questions: [] });
        const text = h.extractGeminiText({
            candidates: [{ content: { parts: [{ text: 'pikiran', thought: true }, { text: '```json\n{"a":' }, { text: '1}\n```' }] } }]
        });
        expect(h.parseGeminiJson(text)).toEqual({ a: 1 });
        expect(() => h.extractGeminiText({ promptFeedback: { blockReason: 'SAFETY' } })).toThrow('SAFETY');
    });
});

describe('Koreksi AI - integrasi Tab Penilaian & UI', () => {
    test('impor nilai memakai selector input gradebook yang sebenarnya', () => {
        expect(geminiJs).not.toContain('data-student-nis');
        expect(geminiJs).not.toContain('config-count-tugas');
        expect(geminiJs).toContain('input.score-input[data-col-key=');
        expect(geminiJs).toContain('window.ensureGradebookColumnVisible');
        expect(geminiJs).toContain('window.getGradebookColumnOptions');
        expect(pageJs).toContain('window.getGradebookColumnOptions = function');
        expect(pageJs).toContain('window.ensureGradebookColumnVisible = function');
        // Markup input gradebook yang dibidik oleh impor
        expect(pageJs).toContain('data-col-key="${col.key}"');
        expect(pageJs).toContain('data-nis="${student.nis}"');
    });

    test('rekap Koreksi AI di-refresh saat tab dibuka dan data kelas dimuat', () => {
        expect(geminiJs).toContain('window.renderStudentSubmissionsUI = renderStudentSubmissionsUI');
        const refreshCalls = pageJs.match(/window\.renderStudentSubmissionsUI\(\)/g) || [];
        expect(refreshCalls.length).toBeGreaterThanOrEqual(4);
    });

    test('modal riwayat sesi tersedia sebagai top-level sibling di luar <main>', () => {
        const { JSDOM } = require('jsdom');
        const doc = new JSDOM(html).window.document;
        const modal = doc.getElementById('modal-ai-session-history');
        expect(modal).not.toBeNull();
        expect(modal.closest('main')).toBeNull();
        expect(modal.parentElement.tagName).toBe('BODY');
        expect(doc.getElementById('list-ai-session-history')).not.toBeNull();
        expect(doc.getElementById('placeholder-ai-review-sheet')).not.toBeNull();
        expect(html).toContain('window.openAiSessionHistoryModal()');
        ['openAiSessionHistoryModal', 'closeAiSessionHistoryModal', 'loadAiGradingSessionFromHistory', 'deleteAiGradingSession']
            .forEach(fn => expect(geminiJs).toContain(`window.${fn} = ${fn}`));
    });
});

describe('Cloudflare Worker - otorisasi kepemilikan sesi Koreksi AI', () => {
    test('pemilik menyimpan/membuka/menghapus; guru lain ditolak', async () => {
        const {sessionHarness}=require('./helpers/ai-grading-session-harness.cjs');
        const h=sessionHarness();
        try {
            expect((await h.call()).status).toBe(200);
            expect((await h.call('GET',null,'/api/ai-grading/sessions/X-A_1')).status).toBe(200);
            expect((await h.call('GET',null,'/api/ai-grading/sessions/X-A_1',{uid:'other',role:'guru_mapel'})).status).toBe(403);
            expect((await h.call('DELETE',null,'/api/ai-grading/sessions/X-A_1')).status).toBe(200);
        } finally { h.close(); }
    });
});

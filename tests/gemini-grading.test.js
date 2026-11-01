/**
 * tests/gemini-grading.test.js
 * Test Suite Pengujian Modul Koreksi Asesmen Siswa Otomatis Berbasis Gemini AI (Portal Guru Mapel)
 */
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

describe('Gemini AI Automated Grading Module Tests', () => {
    const guruMapelHtmlPath = path.join(rootDir, 'guru-mapel.html');
    const geminiGradingJsPath = path.join(rootDir, 'js', 'gemini-grading.js');
    const pageGuruMapelJsPath = path.join(rootDir, 'js', 'page-guru-mapel.js');
    const prdPath = path.join(rootDir, 'PRD_SIMAS.md');

    test('1. guru-mapel.html memuat tab Koreksi AI, panel UI, dan modal Split-View', () => {
        expect(fs.existsSync(guruMapelHtmlPath)).toBe(true);
        const html = fs.readFileSync(guruMapelHtmlPath, 'utf8');

        // Tab tombol navigasi utama
        expect(html).toContain('id="tab-guru-koreksi-ai"');
        expect(html).toContain("switchGuruMapelTab('koreksi-ai')");

        // Panel Koreksi AI
        expect(html).toContain('id="panel-koreksi-ai"');
        expect(html).toContain('id="badge-gemini-key-status"');
        expect(html).toContain('id="tbody-ai-rubric-questions"');
        expect(html).toContain('id="grid-ai-student-thumbnails"');
        expect(html).toContain('id="tbody-ai-summary-rekap"');

        // Modal Split-View dan Import Nilai
        expect(html).toContain('id="modal-ai-review-split"');
        expect(html).toContain('id="img-ai-review-sheet"');
        expect(html).toContain('id="input-ai-review-total-score"');
        expect(html).toContain('id="modal-ai-import-gradebook"');
        expect(html).toContain('id="select-ai-import-target-column"');

        // Script module inclusion
        expect(html).toContain('src="js/gemini-grading.js');

        // Integritas hierarki DOM: pastikan panel-koreksi-ai berdiri mandiri sejajar (sibling) dan tidak bersarang di dalam panel-lms
        const { JSDOM } = require('jsdom');
        const dom = new JSDOM(html);
        const doc = dom.window.document;
        const panelKoreksiAi = doc.getElementById('panel-koreksi-ai');
        const panelLms = doc.getElementById('panel-lms');
        const panelPenilaian = doc.getElementById('panel-penilaian');
        expect(panelKoreksiAi).not.toBeNull();
        expect(panelLms).not.toBeNull();
        expect(panelPenilaian).not.toBeNull();
        expect(panelKoreksiAi.parentElement).toBe(panelPenilaian.parentElement);
        expect(panelLms.parentElement).toBe(panelPenilaian.parentElement);
        expect(panelKoreksiAi.closest('#panel-lms')).toBeNull();
    });

    test('2. js/page-guru-mapel.js mendukung tab koreksi-ai dan expose window.getLoadedStudents', () => {
        expect(fs.existsSync(pageGuruMapelJsPath)).toBe(true);
        const js = fs.readFileSync(pageGuruMapelJsPath, 'utf8');

        expect(js).toContain("tabName === 'koreksi-ai'");
        expect(js).toContain("panelKoreksiAi.classList.remove('hidden')");
        expect(js).toContain('window.getLoadedStudents = function');
    });

    test('3. js/gemini-grading.js terstruktur rapi dengan fungsi-fungsi utama', () => {
        expect(fs.existsSync(geminiGradingJsPath)).toBe(true);
        const js = fs.readFileSync(geminiGradingJsPath, 'utf8');

        expect(js).toContain('export async function checkTeacherApiKeyAvailability');
        expect(js).toContain('export async function handleQuestionPdfUpload');
        expect(js).toContain('export function addManualQuestion');
        expect(js).toContain('export function renderRubricTable');
        expect(js).toContain('export async function handleBulkStudentPhotosUpload');
        expect(js).toContain('export async function runBatchGrading');
        expect(js).toContain('export function openReviewModal');
        expect(js).toContain('export async function executeImportToGradebook');
        expect(js).toContain('export async function saveAiGradingSession');
    });

    test('4. PRD_SIMAS.md mendokumentasikan Modul 4.37 Koreksi Asesmen Siswa Otomatis Berbasis Gemini AI', () => {
        expect(fs.existsSync(prdPath)).toBe(true);
        const prd = fs.readFileSync(prdPath, 'utf8');

        expect(prd).toContain('### 4.37 Modul Koreksi Asesmen Siswa Otomatis Berbasis Gemini AI');
        expect(prd).toContain('Human-in-the-Loop');
        expect(prd).toContain('0 Biaya Cloud Storage');
        expect(prd).toContain('executeGeminiWithFallback');
    });

    test('5. Perlindungan Kuota & Rate Limit Tier Gratis (Pacing 12-14 RPM & Token Opt)', () => {
        const html = fs.readFileSync(guruMapelHtmlPath, 'utf8');
        const js = fs.readFileSync(geminiGradingJsPath, 'utf8');

        // Badge UI
        expect(html).toContain('Jeda otomatis aktif');

        // Logika Pacing & Retry pada js/gemini-grading.js
        expect(js).toContain('safeIntervalMs');
        expect(js).toContain('isQuotaOrRateLimit');
        expect(js).toContain('maxDimension = 2000');
    });

    test('6. Persistensi Sesi AI Tanpa Firestore (0 Kuota Firestore) dengan Cloudflare D1 & Supabase', () => {
        const js = fs.readFileSync(geminiGradingJsPath, 'utf8');
        const cfClientJs = fs.readFileSync(path.join(rootDir, 'js', 'cloudflare-client.js'), 'utf8');
        const cfWorkerJs = fs.readFileSync(path.join(rootDir, 'cloudflare', 'worker.js'), 'utf8');
        const cfMigration = fs.readFileSync(path.join(rootDir, 'cloudflare', 'migrations', '202609240001_add_ai_grading_sessions.sql'), 'utf8');
        const supaMigration = fs.readFileSync(path.join(rootDir, 'supabase', 'migrations', '202609240001_add_ai_grading_sessions.sql'), 'utf8');

        // Pastikan TIDAK menggunakan Firestore untuk sesi ai_grading_sessions
        expect(js).not.toContain("doc(db, 'users'");
        expect(js).not.toContain("'users', user.uid, 'ai_grading_sessions'");

        // Memastikan Cloudflare D1 API dipanggil di client & worker
        expect(cfClientJs).toContain('export async function cfSaveAiGradingSession');
        expect(cfClientJs).toContain('export async function cfGetAiGradingSession');
        expect(cfWorkerJs).toContain('handleAiGradingRequest');
        expect(cfWorkerJs).toContain('/api/ai-grading/sessions');

        // Memastikan migrasi tabel D1 dan Supabase ada
        expect(cfMigration).toContain('CREATE TABLE IF NOT EXISTS ai_grading_sessions');
        expect(supaMigration).toContain('CREATE TABLE IF NOT EXISTS ai_grading_sessions');
    });

    test('7. Format ID Dokumen Sesi menggunakan pola [kelas_timestamp]', () => {
        const js = fs.readFileSync(geminiGradingJsPath, 'utf8');

        // Pastikan pola [kelas_timestamp] digunakan saat membuat/menetapkan sessionId
        expect(js).toContain('${cleanKelas}_${Date.now()}');
        expect(js).toContain('loadAiGradingSession');
    });

    test('8. guru-mapel.html memuat modal-teacher-gemini-key mandiri dengan elemen kontrol lengkap', () => {
        const html = fs.readFileSync(guruMapelHtmlPath, 'utf8');

        expect(html).toContain('id="modal-teacher-gemini-key"');
        expect(html).toContain('id="input-teacher-gemini-key"');
        expect(html).toContain('id="modal-key-status-badge"');
        expect(html).toContain('id="btn-test-gemini-key"');
        expect(html).toContain('id="btn-save-teacher-key"');
        expect(html).toContain('id="btn-delete-teacher-key"');
        expect(html).toContain('window.toggleTeacherApiKeyVisibility()');
        expect(html).toContain('window.closeTeacherApiKeyModal()');

        // Verifikasi tidak ada leading icon absolut di dalam input (Anti-Overlapping Icon Rule)
        const { JSDOM } = require('jsdom');
        const dom = new JSDOM(html);
        const inputKey = dom.window.document.getElementById('input-teacher-gemini-key');
        expect(inputKey).not.toBeNull();
        expect(inputKey.className).not.toContain('pl-9');
        expect(inputKey.className).not.toContain('pl-10');
    });

    test('9. js/gemini-grading.js bebas dari alert/prompt/confirm browser jadul dan menampilkan API key tersimpan', () => {
        const js = fs.readFileSync(geminiGradingJsPath, 'utf8');

        // Bebas alert, prompt, dan confirm bawaan browser
        expect(js).not.toMatch(/\bwindow\.prompt\b/);
        expect(js).not.toMatch(/\bprompt\(/);
        expect(js).not.toMatch(/\bwindow\.alert\b/);
        expect(js).not.toMatch(/\bconfirm\(/);

        // Ekspor fungsi modal mandiri
        expect(js).toContain('export async function openTeacherApiKeyModal');
        expect(js).toContain('export function closeTeacherApiKeyModal');
        expect(js).toContain('export function toggleTeacherApiKeyVisibility');
        expect(js).toContain('export async function saveTeacherApiKeyFromModal');
        expect(js).toContain('export async function removeTeacherApiKey');
        expect(js).toContain('export async function testTeacherApiKeyConnection');

        // Membaca kunci dari SSOT akun (Firestore user_secrets & localStorage)
        expect(js).toContain('getUserGeminiApiKeysAsync()');
        expect(js).toContain('primaryKey');
        expect(js).toContain('showConfirmModal');
    });

    test('10. js/global.js menyediakan alias window.openProfileModal ke window.openEditProfile', () => {
        const globalJs = fs.readFileSync(path.join(rootDir, 'js', 'global.js'), 'utf8');
        expect(globalJs).toContain('window.openProfileModal = window.openEditProfile');
    });
});

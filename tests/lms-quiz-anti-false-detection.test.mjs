/**
 * tests/lms-quiz-anti-false-detection.test.mjs
 *
 * Verifikasi Pengamanan Anti-Salah Deteksi (Anti False-Positive) Kuis CBT Siswa:
 * 1. Menjamin proteksi document.hasFocus() aktif untuk mencegah false blur saat siswa mengetik/memilih jawaban.
 * 2. Menjamin Initial Grace Period (10 detik) saat kuis dibuka agar penyesuaian fullscreen tidak memicu pelanggaran.
 * 3. Menjamin perlindungan modal aktif agar tidak terjadi penalti bertubi-tubi (cascade).
 * 4. Menjamin toleransi durasi minimum (5 detik) untuk menyaring ketidaksengajaan/notifikasi sistem.
 * 5. Menjamin mutex guard reportingViolation untuk mencegah pengiriman laporan ganda.
 * 6. Menjamin pelepasan fullscreen saat masih aktif tidak langsung dicap kecurangan melainkan diberi petunjuk ramah.
 * 7. Menjamin pembersihan total event listener (termasuk visibilitychange dan focus).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

describe('Pengujian Pengamanan Anti-Salah Deteksi (Anti False-Positive) CBT LMS', () => {
    const studentJsPath = path.join(rootDir, 'js', 'lms-quiz-student.mjs');
    const content = fs.readFileSync(studentJsPath, 'utf8');

    test('1. document.hasFocus() dan document.visibilityState diikutsertakan sebagai guard anti-false-blur', () => {
        expect(content).toContain('document.hasFocus()');
        expect(content).toContain("document.visibilityState === 'visible'");
    });

    test('2. Initial Grace Period diterapkan saat kuis CBT dimulai', () => {
        expect(content).toContain('takingStartedAt');
        expect(content).toMatch(/takingStartedAt\s*&&\s*\(Date\.now\(\)\s*-\s*s\.takingStartedAt\s*<\s*10000\)/);
    });

    test('3. Guard modal aktif mencegah cascade / lonjakan pelanggaran ganda saat modal terbuka', () => {
        expect(content).toMatch(/modal-student-quiz-violation['"]\)\?\.classList\.contains\(['"]hidden['"]\)/);
    });

    test('4. Toleransi durasi minimum keluar layar disetel minimal 5 detik', () => {
        expect(content).toMatch(/duration\s*<\s*5/);
    });

    test('5. Mutex guard reportingViolation mencegah pengiriman laporan pelanggaran ganda', () => {
        expect(content).toContain('s.reportingViolation = true');
        expect(content).toContain('s.reportingViolation = false');
    });

    test('6. Fullscreen lepas saat dokumen masih aktif memberi petunjuk ramah bukan sanksi instan', () => {
        expect(content).toContain('Mode CBT mewajibkan Layar Penuh. Klik layar untuk kembali ke Layar Penuh.');
    });

    test('7. cleanStrictListeners membersihkan seluruh event listener tanpa kebocoran memori', () => {
        expect(content).toContain("removeEventListener('blur'");
        expect(content).toContain("removeEventListener('focus'");
        expect(content).toContain("removeEventListener('visibilitychange'");
        expect(content).toContain("removeEventListener('fullscreenchange'");
    });
});

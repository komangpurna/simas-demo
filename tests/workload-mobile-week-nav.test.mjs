/**
 * tests/workload-mobile-week-nav.test.mjs
 * Pengujian Unit Navigasi Pekan Mobile & Gestur Usap (Swipe) Layar Sentuh
 * Sesuai PRD Bab 23.26: Responsive Touch Ergonomics & Haptic Feedback pada E-Kinerja Guru
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { evaluateWeekSwipeGesture } = require('./workload-guru-utils.js');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

describe('Workload Mobile Week Navigation & Touch Gesture Ergonomics', () => {
    describe('evaluateWeekSwipeGesture - Validasi Argumen & Toleransi Input', () => {
        test('Argumen non-angka, undefined, null, atau NaN harus menghasilkan { isValid: false, direction: null }', () => {
            expect(evaluateWeekSwipeGesture(undefined, 0, 200)).toEqual({ isValid: false, direction: null });
            expect(evaluateWeekSwipeGesture(null, 0, 200)).toEqual({ isValid: false, direction: null });
            expect(evaluateWeekSwipeGesture('100', 0, 200)).toEqual({ isValid: false, direction: null });
            expect(evaluateWeekSwipeGesture(NaN, 0, 200)).toEqual({ isValid: false, direction: null });
            expect(evaluateWeekSwipeGesture(-80, undefined, 200)).toEqual({ isValid: false, direction: null });
            expect(evaluateWeekSwipeGesture(-80, 0, undefined)).toEqual({ isValid: false, direction: null });
            expect(evaluateWeekSwipeGesture(-80, 0, NaN)).toEqual({ isValid: false, direction: null });
        });

        test('Sentuhan berdurasi terlalu instan (< 30ms) atau terlalu lambat (> 550ms) wajib ditolak', () => {
            // Instan (< 30ms) kemungkinan noise / accidental click glitch
            expect(evaluateWeekSwipeGesture(-90, 5, 20)).toEqual({ isValid: false, direction: null });
            // Terlalu lama (> 550ms) adalah gestur tahan/drag lambat, bukan flick/usapan sengaja
            expect(evaluateWeekSwipeGesture(-90, 5, 600)).toEqual({ isValid: false, direction: null });
            expect(evaluateWeekSwipeGesture(120, -10, 1000)).toEqual({ isValid: false, direction: null });
        });

        test('Pergeseran horizontal kurang dari 55px wajib ditolak sebagai getaran jempol mikro', () => {
            expect(evaluateWeekSwipeGesture(54, 5, 200)).toEqual({ isValid: false, direction: null });
            expect(evaluateWeekSwipeGesture(-54, -5, 200)).toEqual({ isValid: false, direction: null });
            expect(evaluateWeekSwipeGesture(0, 0, 150)).toEqual({ isValid: false, direction: null });
        });

        test('Pergeseran yang didominasi sumbu vertikal (scroll halaman) wajib diabaikan secara ketat', () => {
            // Pengguna sedang scrolling ke bawah (deltaY besar), deltaX ada sedikit geseran jempol
            expect(evaluateWeekSwipeGesture(60, 120, 250)).toEqual({ isValid: false, direction: null });
            // Geseran diagonal miring dengan rasio <= 1.5 wajib ditolak
            expect(evaluateWeekSwipeGesture(60, 50, 250)).toEqual({ isValid: false, direction: null });
            expect(evaluateWeekSwipeGesture(-60, 40, 250)).toEqual({ isValid: false, direction: null }); // 60 <= 40 * 1.5 = 60
        });
    });

    describe('evaluateWeekSwipeGesture - Deteksi Arah Perpindahan Pekan', () => {
        test('Swipe ke kiri (deltaX < 0) valid harus menghasilkan arah "next" (minggu berikutnya)', () => {
            const result = evaluateWeekSwipeGesture(-80, 10, 220);
            expect(result).toEqual({
                isValid: true,
                direction: 'next'
            });
        });

        test('Swipe ke kanan (deltaX > 0) valid harus menghasilkan arah "prev" (minggu sebelumnya)', () => {
            const result = evaluateWeekSwipeGesture(100, -15, 280);
            expect(result).toEqual({
                isValid: true,
                direction: 'prev'
            });
        });

        test('Pergeseran tegas dengan sudut kemiringan ringan tetap diterima asalkan rasio X > 1.5 * Y', () => {
            // deltaX = -90, deltaY = 30 -> rasio 90 / 30 = 3.0 (> 1.5) -> Valid
            expect(evaluateWeekSwipeGesture(-90, 30, 190)).toEqual({
                isValid: true,
                direction: 'next'
            });
            // deltaX = 150, deltaY = -40 -> rasio 150 / 40 = 3.75 (> 1.5) -> Valid
            expect(evaluateWeekSwipeGesture(150, -40, 310)).toEqual({
                isValid: true,
                direction: 'prev'
            });
        });
    });

    describe('Statis UX & Aksesibilitas Responsif di e-kinerja.html', () => {
        const htmlCode = fs.readFileSync(path.join(rootDir, 'e-kinerja.html'), 'utf8');

        test('Header week nav container memiliki kelas responsif w-full sm:w-auto', () => {
            expect(htmlCode).toMatch(/id="header-week-nav-container"[^>]*class="[^"]*w-full\s+sm:w-auto/);
        });

        test('Tombol navigasi prev dan next memiliki touch target w-8 h-8 sm:w-7 sm:h-7 dan touch-manipulation', () => {
            expect(htmlCode).toMatch(/id="btn-prev-week"[^>]*class="[^"]*w-8\s+h-8\s+sm:w-7\s+sm:h-7[^"]*touch-manipulation/);
            expect(htmlCode).toMatch(/id="btn-next-week"[^>]*class="[^"]*w-8\s+h-8\s+sm:w-7\s+sm:h-7[^"]*touch-manipulation/);
        });

        test('Tombol "Minggu Ini" memiliki styling ergonomis h-8 sm:h-7 dan touch-manipulation', () => {
            expect(htmlCode).toMatch(/onclick="window\.workloadSetCurrentWeek\(\)"[^>]*class="[^"]*h-8\s+sm:h-7[^"]*touch-manipulation/);
        });

        test('Tombol Refresh Manual #btn-refresh-week berada di bilah navigasi pekan dengan styling compact & no-wrap', () => {
            expect(htmlCode).toMatch(/id="btn-refresh-week"[^>]*onclick="window\.workloadManualRefresh\(\)"/);
            expect(htmlCode).toMatch(/id="btn-refresh-week"[^>]*class="[^"]*w-8\s+h-8\s+sm:w-7\s+sm:h-7[^"]*shrink-0[^"]*touch-manipulation/);
            expect(htmlCode).toMatch(/id="btn-refresh-week"[\s\S]*?<i class="fa-solid fa-arrows-rotate/);
        });

        test('Floating week loading pill simetris di tengah bawah layar mobile', () => {
            expect(htmlCode).toMatch(/id="workload-floating-loading-pill"[^>]*class="[^"]*bottom-5\s+left-1\/2\s+-translate-x-1\/2\s+sm:left-auto\s+sm:right-6\s+sm:translate-x-0/);
        });
    });

    describe('Statis Logika & Integrasi di js/page-beban-kerja.js & js/workload-calc.js', () => {
        const pageCode = fs.readFileSync(path.join(rootDir, 'js', 'page-beban-kerja.js'), 'utf8');
        const calcCode = fs.readFileSync(path.join(rootDir, 'js', 'workload-calc.js'), 'utf8');

        test('js/workload-calc.js mengekspor evaluateWeekSwipeGesture', () => {
            expect(calcCode).toMatch(/export\s+function\s+evaluateWeekSwipeGesture\s*\(/);
        });

        test('js/page-beban-kerja.js mengimpor dan me-re-export evaluateWeekSwipeGesture', () => {
            expect(pageCode).toMatch(/import\s*\{[^}]*evaluateWeekSwipeGesture[^}]*\}\s*from\s*'\.\/workload-calc\.js'/);
            expect(pageCode).toMatch(/export\s*\{[^}]*evaluateWeekSwipeGesture[^}]*\}/);
        });

        test('js/page-beban-kerja.js menerapkan haptic feedback navigator.vibrate', () => {
            expect(pageCode).toMatch(/function\s+triggerNavHapticFeedback\s*\(\)\s*\{[\s\S]*?navigator\.vibrate\(10\)/);
        });

        test('js/page-beban-kerja.js memiliki fungsi setupMobileWeekSwipeGesture dengan proteksi shouldIgnoreTouch', () => {
            expect(pageCode).toMatch(/function\s+setupMobileWeekSwipeGesture\s*\(\)\s*\{/);
            expect(pageCode).toMatch(/shouldIgnoreTouch/);
            expect(pageCode).toMatch(/window\.workloadSetupMobileWeekSwipeGesture\s*=/);
        });

        test('Tidak memicu request API D1 tambahan saat navigasi atau swipe (hemat kuota & latensi 0ms)', () => {
            // Memastikan evaluateWeekSwipeGesture adalah pure function tanpa fetch/cf call
            expect(calcCode).not.toMatch(/function\s+evaluateWeekSwipeGesture[\s\S]*?fetch\(/);
        });

        test('js/page-beban-kerja.js mengekspos window.workloadManualRefresh dan tidak memiliki auto-refresh visibility/focus 25s', () => {
            expect(pageCode).toMatch(/window\.workloadManualRefresh\s*=\s*manualRefreshCurrentWeek/);
            expect(pageCode).toMatch(/async\s+function\s+manualRefreshCurrentWeek\s*\(\)/);
            // Memastikan auto-refresh 25s pada visibilitychange ditiadakan
            expect(pageCode).not.toMatch(/now\s*-\s*lastAutoRefreshTime\s*>\s*25000/);
            // Memastikan background revalidation 30s pada loadWeek cache hit ditiadakan
            expect(pageCode).not.toMatch(/if\s*\(\s*cached\.stale\s*\)\s*\{\s*loadWeek/);
        });
    });
});

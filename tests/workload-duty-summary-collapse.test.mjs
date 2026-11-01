/**
 * tests/workload-duty-summary-collapse.test.mjs
 * Pengujian Unit Logika Smart Adaptive Collapse Ringkasan Komposisi Tugas Pokok
 * (Permendikdasmen No. 11/2025) pada E-Kinerja Guru (e-kinerja.html)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveDutySummaryCollapsed } = require('./workload-guru-utils.js');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

describe('Workload Duty Summary Collapse (Smart Adaptive & Manual Override)', () => {
    describe('resolveDutySummaryCollapsed - Aturan Otomatis Berbasis Status Versi', () => {
        test('Status "draft" tanpa override manual harus otomatis TERBUKA (false)', () => {
            expect(resolveDutySummaryCollapsed('draft', null)).toBe(false);
            expect(resolveDutySummaryCollapsed('draft', undefined)).toBe(false);
        });

        test('Status "needs_revision" tanpa override manual harus otomatis TERBUKA (false)', () => {
            expect(resolveDutySummaryCollapsed('needs_revision', null)).toBe(false);
            expect(resolveDutySummaryCollapsed('needs_revision', undefined)).toBe(false);
        });

        test('Status "submitted" (diajukan) tanpa override manual harus otomatis TERLIPAT (true)', () => {
            expect(resolveDutySummaryCollapsed('submitted', null)).toBe(true);
            expect(resolveDutySummaryCollapsed('submitted', undefined)).toBe(true);
        });

        test('Status "approved" (difinalisasi/disetujui) tanpa override manual harus otomatis TERLIPAT (true)', () => {
            expect(resolveDutySummaryCollapsed('approved', null)).toBe(true);
            expect(resolveDutySummaryCollapsed('approved', undefined)).toBe(true);
        });

        test('Status tidak dikenal / undefined / null harus default aman TERBUKA (false)', () => {
            expect(resolveDutySummaryCollapsed(undefined, null)).toBe(false);
            expect(resolveDutySummaryCollapsed(null, null)).toBe(false);
            expect(resolveDutySummaryCollapsed('', null)).toBe(false);
            expect(resolveDutySummaryCollapsed('unknown_status', null)).toBe(false);
        });
    });

    describe('resolveDutySummaryCollapsed - Prioritas Override Manual Pengguna', () => {
        test('Override manual = true harus selalu TERLIPAT meskipun status draft', () => {
            expect(resolveDutySummaryCollapsed('draft', true)).toBe(true);
            expect(resolveDutySummaryCollapsed('needs_revision', true)).toBe(true);
            expect(resolveDutySummaryCollapsed('unknown', true)).toBe(true);
        });

        test('Override manual = false harus selalu TERBUKA meskipun status approved / submitted', () => {
            expect(resolveDutySummaryCollapsed('approved', false)).toBe(false);
            expect(resolveDutySummaryCollapsed('submitted', false)).toBe(false);
        });

        test('Reset manual = null harus mengembalikan kontrol ke status versi', () => {
            // Awalnya user override buka saat approved
            expect(resolveDutySummaryCollapsed('approved', false)).toBe(false);
            // Setelah ganti minggu / reset ke null -> kembali terlipat otomatis
            expect(resolveDutySummaryCollapsed('approved', null)).toBe(true);
        });
    });

    describe('Analisis Statis Kode & Aksesibilitas UI', () => {
        const pageCode = fs.readFileSync(path.join(rootDir, 'js', 'page-beban-kerja.js'), 'utf8');
        const htmlCode = fs.readFileSync(path.join(rootDir, 'e-kinerja.html'), 'utf8');

        test('js/page-beban-kerja.js wajib mengekspos window.workloadToggleDutySummaryCollapse', () => {
            expect(pageCode).toMatch(/window\.workloadToggleDutySummaryCollapse\s*=/);
        });

        test('js/page-beban-kerja.js wajib menyertakan atribut aksesibilitas aria-expanded pada tombol toggle', () => {
            expect(pageCode).toMatch(/aria-expanded="\$\{\!isCollapsed\}"/);
            expect(pageCode).toMatch(/aria-controls="plan-duty-summary-body"/);
        });

        test('e-kinerja.html wajib memuat id study-day-control-box dan study-day-help dengan sr-only default', () => {
            expect(htmlCode).toMatch(/id="study-day-control-box"/);
            expect(htmlCode).toMatch(/id="study-day-help"[^>]*class="[^"]*sr-only/);
        });

        test('e-kinerja.html wajib menggunakan tata letak strip tipis pada #plan-status-banner', () => {
            expect(htmlCode).toMatch(/id="plan-status-banner"[^>]*class="[^"]*px-3 py-1\.5/);
            expect(htmlCode).toMatch(/id="plan-status-banner-icon"[^>]*class="[^"]*w-6 h-6/);
        });

        test('js/workload-calc.js wajib mendefinisikan dan mengekspor resolveDutySummaryCollapsed', () => {
            const calcCode = fs.readFileSync(path.join(rootDir, 'js', 'workload-calc.js'), 'utf8');
            expect(calcCode).toMatch(/export function resolveDutySummaryCollapsed\(/);
            expect(pageCode).toMatch(/export\s*\{\s*resolveDutySummaryCollapsed\s*\}/);
        });

        test('Pembaruan ini tidak boleh memicu endpoint jaringan API Cloudflare D1 tambahan', () => {
            // Memastikan fungsi toggleDutySummaryCollapse murni manipulasi state lokal dan memanggil renderPlanDutySummary
            const toggleFnMatch = pageCode.match(/export function toggleDutySummaryCollapse\(\)\s*\{([\s\S]*?)\}/);
            expect(toggleFnMatch).not.toBeNull();
            const fnBody = toggleFnMatch[1];
            expect(fnBody).not.toMatch(/cfFetch|fetch|cfGet|cfSave|cfPost/);
        });
    });
});

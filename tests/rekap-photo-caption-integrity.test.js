/**
 * tests/rekap-photo-caption-integrity.test.js
 * ====================================================================
 * Test Suite: Integritas Multi-Photo Captions & Editor Caption In-Memory
 * pada Cetak Rekap Realisasi (Guru & Tendik)
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

describe('Suite Pengujian Multi-Photo Captions & In-Memory Caption Editor Rekap Realisasi', () => {
    const root = path.resolve(__dirname, '..');
    const sharedJsPath = path.join(root, 'js', 'rekap-infographic.js');
    const teacherJsPath = path.join(root, 'js', 'page-beban-kerja.js');
    const employeeJsPath = path.join(root, 'js', 'page-e-kinerja-tendik.js');

    const sharedJs = fs.readFileSync(sharedJsPath, 'utf8');
    const teacherJs = fs.readFileSync(teacherJsPath, 'utf8');
    const employeeJs = fs.readFileSync(employeeJsPath, 'utf8');

    function getRekapInfographicSandbox() {
        let code = sharedJs;
        code = code.replace(/export\s+const\s+/g, 'const ');
        code = code.replace(/export\s+function\s+/g, 'function ');
        code = code.replace(/export\s+default\s+/g, '');
        code += `;\nmodule.exports = { buildRekapInfographicHtml, isGenericCaption };`;
        const sandbox = {
            module: {},
            exports: {},
            console,
            Date,
            String,
            Number,
            Array,
            Math,
            parseInt,
            window: {}
        };
        vm.runInNewContext(code, sandbox);
        return sandbox.module.exports;
    }

    describe('1. Verifikasi Template Cetak Infografis (js/rekap-infographic.js)', () => {
        test('photoCell menyematkan overlay badge .ph-caption di dalam masing-masing .ph', () => {
            expect(sharedJs).toContain('<div class="ph">');
            expect(sharedJs).toContain('${hasCaption ? `<div class="ph-caption" title="${esc(p.caption)}">${esc(p.caption)}</div>` : \'\'}');
            expect(sharedJs).toContain('const hasCaption = !isGenericCaption(p?.caption);');
        });

        test('Eliminasi elemen .caption lama di luar .collage agar tidak hanya merender foto pertama', () => {
            expect(sharedJs).not.toMatch(/\$\{!\s*isGenericCaption\s*\(\s*mainPhoto\.caption\s*\)\s*\?\s*`<div class="caption">/);
        });

        test('CSS .ph-caption terpasang dengan backdrop blur, z-index, dan anti-overflow', () => {
            expect(sharedJs).toContain('.caption, .ph-caption {');
            expect(sharedJs).toContain('position: absolute;');
            expect(sharedJs).toContain('backdrop-filter: blur(4px);');
            expect(sharedJs).toContain('text-overflow: ellipsis;');
            expect(sharedJs).toContain('z-index: 2;');
        });

        test('buildRekapInfographicHtml merender seluruh caption untuk kegiatan multi-foto', () => {
            const mod = getRekapInfographicSandbox();
            const html = mod.buildRekapInfographicHtml({
                orientation: 'portrait',
                schoolName: 'SMA Negeri 1 Abang',
                title: 'Pelaksanaan Pembelajaran',
                activities: [
                    {
                        date: '2026-10-15',
                        title: 'Praktikum Kimia Laju Reaksi',
                        photos: [
                            { url: 'https://example.com/foto1.jpg', caption: 'Penyiapan Reagen Kimia' },
                            { url: 'https://example.com/foto2.jpg', caption: 'Pengamatan Perubahan Warna' },
                            { url: 'https://example.com/foto3.jpg', caption: 'Pencatatan Data Kelompok' }
                        ]
                    }
                ]
            });

            // Seluruh 3 caption harus muncul di dokumen HTML infografis
            expect(html).toContain('Penyiapan Reagen Kimia');
            expect(html).toContain('Pengamatan Perubahan Warna');
            expect(html).toContain('Pencatatan Data Kelompok');

            // Harus ada 3 tag .ph-caption
            const matches = html.match(/class="ph-caption"/g);
            expect(matches).not.toBeNull();
            expect(matches.length).toBe(3);
        });

        test('Foto dengan caption generik tidak memunculkan elemen .ph-caption', () => {
            const mod = getRekapInfographicSandbox();
            const html = mod.buildRekapInfographicHtml({
                orientation: 'portrait',
                schoolName: 'SMA Negeri 1 Abang',
                title: 'Piket Sekolah',
                activities: [
                    {
                        date: '2026-10-16',
                        title: 'Mengontrol Pintu Gerbang',
                        photos: [
                            { url: 'https://example.com/foto1.jpg', caption: 'Foto Bukti 1' },
                            { url: 'https://example.com/foto2.jpg', caption: 'dokumentasi.jpeg' }
                        ]
                    }
                ]
            });

            expect(html).not.toContain('class="ph-caption"');
        });
    });

    describe('2. Verifikasi E-Kinerja Guru (js/page-beban-kerja.js)', () => {
        test('State in-memory _rekapPhotoCaptions dan fungsi workloadUpdateRekapPrintPhotoCaption terpasang', () => {
            expect(teacherJs).toContain('let _rekapPhotoCaptions = {};');
            expect(teacherJs).toContain('export function workloadUpdateRekapPrintPhotoCaption');
            expect(teacherJs).toContain('window.workloadUpdateRekapPrintPhotoCaption = workloadUpdateRekapPrintPhotoCaption;');
        });

        test('collectRekapActivityPhotos mengintegrasikan override caption in-memory', () => {
            expect(teacherJs).toContain('Object.prototype.hasOwnProperty.call(_rekapPhotoCaptions, key)');
            expect(teacherJs).toContain('caption: overriddenCaption');
        });

        test('renderReportActivityDrawer menyajikan input editor caption untuk setiap foto kegiatan terpilih', () => {
            expect(teacherJs).toContain('Caption Foto');
            expect(teacherJs).toContain('window.workloadUpdateRekapPrintPhotoCaption');
            expect(teacherJs).toContain('placeholder="Caption foto');
        });

        test('workloadRemoveLocalPhoto membersihkan caption foto lokal terkait', () => {
            expect(teacherJs).toContain('delete _rekapPhotoCaptions[targetKey];');
        });
    });

    describe('3. Verifikasi E-Kinerja Tendik (js/page-e-kinerja-tendik.js)', () => {
        test('State _empPrint memuat photoCaptions dan fungsi updateEmployeeButirPhotoCaption terpasang', () => {
            expect(employeeJs).toContain('photoCaptions: {},');
            expect(employeeJs).toContain('export function updateEmployeeButirPhotoCaption');
            expect(employeeJs).toContain('window.updateEmployeeButirPhotoCaption = updateEmployeeButirPhotoCaption;');
        });

        test('collectEmployeeActivityPhotos mengintegrasikan override caption in-memory', () => {
            expect(employeeJs).toContain('Object.prototype.hasOwnProperty.call(_empPrint.photoCaptions, key)');
            expect(employeeJs).toContain('caption: overriddenCaption');
        });

        test('renderEmpPrintActivityList menyajikan input editor caption untuk setiap foto kegiatan terpilih', () => {
            expect(employeeJs).toContain('Caption Foto');
            expect(employeeJs).toContain('window.updateEmployeeButirPhotoCaption');
            expect(employeeJs).toContain('placeholder="Caption foto');
        });

        test('removeEmployeeButirLocalPhoto membersihkan caption foto lokal terkait', () => {
            expect(employeeJs).toContain('delete _empPrint.photoCaptions[targetKey];');
        });
    });
});

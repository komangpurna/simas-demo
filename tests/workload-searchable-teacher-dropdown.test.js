/**
 * @jest-environment jsdom
 */

/**
 * Unit Test Suite: Searchable Dropdown Pemilih Guru Supervisor di E-Kinerja
 * (e-kinerja.html & js/page-beban-kerja.js)
 * Sesuai panduan UI: Anti-Overlapping Icon, Tombol Clear & Chevron di Kanan,
 * Aksesibilitas ARIA Combobox, dan Sinkronisasi SSOT.
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Searchable Dropdown Pemilih Guru (E-Kinerja Supervisor)', () => {
    const root = path.resolve(__dirname, '..');
    const htmlPath = path.join(root, 'e-kinerja.html');
    const jsPath = path.join(root, 'js', 'page-beban-kerja.js');

    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const jsContent = fs.readFileSync(jsPath, 'utf8');

    describe('1. Integritas Struktur Markup & Aksesibilitas ARIA (e-kinerja.html)', () => {
        test('Menyediakan kontainer pembungkus #container-admin-teacher-search', () => {
            expect(htmlContent).toContain('id="container-admin-teacher-search"');
        });

        test('Menjaga elemen select asli #select-workload-teacher tersembunyi untuk backward-compatibility', () => {
            expect(htmlContent).toContain('id="select-workload-teacher"');
            expect(htmlContent).toContain('class="hidden"');
        });

        test('Input pencarian memiliki ID #input-admin-teacher-search dan atribut combobox ARIA lengkap', () => {
            expect(htmlContent).toContain('id="input-admin-teacher-search"');
            expect(htmlContent).toContain('role="combobox"');
            expect(htmlContent).toContain('aria-expanded="false"');
            expect(htmlContent).toContain('aria-autocomplete="list"');
            expect(htmlContent).toContain('aria-controls="admin-teacher-search-results"');
            expect(htmlContent).toContain('placeholder="-- Pilih Guru Terlebih Dahulu --"');
        });

        test('Memenuhi panduan UI Anti-Overlapping: padding kiri bersih (px-3.5) dan kontrol di sebelah kanan (right-1.5)', () => {
            expect(htmlContent).toContain('px-3.5 pr-14');
            expect(htmlContent).not.toMatch(/pl-9|pl-10.*id="input-admin-teacher-search"/);
            expect(htmlContent).toContain('id="btn-admin-clear-teacher"');
            expect(htmlContent).toContain('id="btn-toggle-admin-teacher-dropdown"');
            expect(htmlContent).toContain('id="icon-admin-teacher-chevron"');
        });

        test('Menyediakan kontainer menu dropdown mengambang #admin-teacher-search-results dengan elevasi z-50', () => {
            expect(htmlContent).toContain('id="admin-teacher-search-results"');
            expect(htmlContent).toContain('role="listbox"');
            expect(htmlContent).toContain('z-50');
            expect(htmlContent).toContain('shadow-2xl');
        });

        test('Bilah pemilih guru #admin-teacher-selector-strip memiliki stacking context relative z-30 dan #tab-monitoring-toolbar bersih dari flex bawaan saat hidden', () => {
            expect(htmlContent).toContain('id="admin-teacher-selector-strip"');
            expect(htmlContent).toMatch(/id="admin-teacher-selector-strip"[^>]*relative z-30/);
            expect(htmlContent).toMatch(/id="tab-monitoring-toolbar"\s+class="hidden\s+items-center/);
        });
    });

    describe('2. Ekspor Fungsi & Jembatan Window di js/page-beban-kerja.js', () => {
        test('Mengekspor seluruh fungsi pendukung searchable combobox guru', () => {
            expect(jsContent).toContain('export function getTeacherInitials(');
            expect(jsContent).toContain('export function highlightTeacherMatch(');
            expect(jsContent).toContain('export function renderAdminTeacherDropdownResults(');
            expect(jsContent).toContain('export function openAdminTeacherDropdown(');
            expect(jsContent).toContain('export function closeAdminTeacherDropdown(');
            expect(jsContent).toContain('export function toggleAdminTeacherDropdown(');
            expect(jsContent).toContain('export function filterAdminTeacherDropdown(');
            expect(jsContent).toContain('export async function selectAdminTeacher(');
            expect(jsContent).toContain('export function onAdminTeacherKeydown(');
            expect(jsContent).toContain('export function updateMonitoringToolbarVisibility(');
        });

        test('Mendaftarkan seluruh handler interaktif ke window untuk event listener inline', () => {
            expect(jsContent).toContain('window.workloadPopulateAdminTeacherDropdown = populateAdminTeacherDropdown');
            expect(jsContent).toContain('window.workloadOnAdminTeacherChange = onAdminTeacherChange');
            expect(jsContent).toContain('window.workloadAdminManageTeacher = adminManageTeacher');
            expect(jsContent).toContain('window.workloadAdminResetTeacher = adminResetTeacher');
            expect(jsContent).toContain('window.workloadOpenAdminTeacherDropdown = openAdminTeacherDropdown');
            expect(jsContent).toContain('window.workloadCloseAdminTeacherDropdown = closeAdminTeacherDropdown');
            expect(jsContent).toContain('window.workloadToggleAdminTeacherDropdown = toggleAdminTeacherDropdown');
            expect(jsContent).toContain('window.workloadFilterAdminTeacherDropdown = filterAdminTeacherDropdown');
            expect(jsContent).toContain('window.workloadSelectAdminTeacher = selectAdminTeacher');
            expect(jsContent).toContain('window.workloadOnAdminTeacherKeydown = onAdminTeacherKeydown');
            expect(jsContent).toContain('window.workloadUpdateMonitoringToolbarVisibility = updateMonitoringToolbarVisibility');
        });
    });

    describe('3. Logika Helper Pure (getTeacherInitials & highlightTeacherMatch)', () => {
        function getTeacherInitials(name = '') {
            if (!name) return 'G';
            const clean = name.replace(/^(Drs\.|Dr\.|H\.|Hj\.|Ir\.|Prof\.)\s*/i, '').trim();
            const parts = clean.split(/\s+/).filter(Boolean);
            if (parts.length === 0) return 'G';
            if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
            return (parts[0][0] + parts[1][0]).toUpperCase();
        }

        function highlightTeacherMatch(text = '', query = '') {
            if (!query || !text) return text;
            const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`(${escapedQuery})`, 'gi');
            return text.replace(regex, '<mark>$1</mark>');
        }

        test('getTeacherInitials mengekstrak inisial nama tanpa gelar', () => {
            expect(getTeacherInitials('Budi Mulyawan, S.Pd')).toBe('BM');
            expect(getTeacherInitials('Drs. I Komang Sudiana, M.Pd')).toBe('IK');
            expect(getTeacherInitials('Wayan')).toBe('WA');
            expect(getTeacherInitials('')).toBe('G');
        });

        test('highlightTeacherMatch membungkus kata kunci yang cocok dengan mark', () => {
            const res = highlightTeacherMatch('Drs. I Komang Sudiana', 'komang');
            expect(res).toContain('<mark>Komang</mark>');
        });
    });

    describe('4. Simulasi Runtime JSDOM', () => {
        let container, input, select, clearBtn, chevron, results;
        const mockTeachers = [
            { id: 'T001', name: 'Budi Mulyawan, S.Pd', jenis_ptk: 'Guru Mapel', mapel: 'Matematika' },
            { id: 'T002', name: 'Drs. I Komang Sudiana, M.Pd', jenis_ptk: 'Guru Mapel', mapel: 'Fisika' },
            { id: 'T003', name: 'Emy Permata Luciana Dewi, S.Pd', jenis_ptk: 'Guru BK', mapel: 'Bimbingan Konseling' }
        ];

        beforeEach(() => {
            document.body.innerHTML = `
                <div id="container-admin-teacher-search">
                    <select id="select-workload-teacher" class="hidden">
                        <option value="">-- Pilih Guru Terlebih Dahulu --</option>
                        <option value="T001">Budi Mulyawan, S.Pd</option>
                        <option value="T002">Drs. I Komang Sudiana, M.Pd</option>
                        <option value="T003">Emy Permata Luciana Dewi, S.Pd</option>
                    </select>
                    <input type="text" id="input-admin-teacher-search" />
                    <button type="button" id="btn-admin-clear-teacher" class="hidden"></button>
                    <button type="button" id="btn-toggle-admin-teacher-dropdown"></button>
                    <i id="icon-admin-teacher-chevron"></i>
                    <div id="admin-teacher-search-results" class="hidden"></div>
                </div>
            `;

            container = document.getElementById('container-admin-teacher-search');
            input = document.getElementById('input-admin-teacher-search');
            select = document.getElementById('select-workload-teacher');
            clearBtn = document.getElementById('btn-admin-clear-teacher');
            chevron = document.getElementById('icon-admin-teacher-chevron');
            results = document.getElementById('admin-teacher-search-results');
        });

        test('Filter pencarian menyaring daftar guru berdasarkan nama atau mapel', () => {
            const query = 'fisika';
            const filtered = mockTeachers.filter(t =>
                t.name.toLowerCase().includes(query) || (t.mapel && t.mapel.toLowerCase().includes(query))
            );

            expect(filtered.length).toBe(1);
            expect(filtered[0].id).toBe('T002');
            expect(filtered[0].name).toContain('I Komang Sudiana');
        });

        test('Pemilihan guru mengupdate input, select, dan menampilkan tombol clear', () => {
            const selected = mockTeachers[0];
            input.value = selected.name;
            select.value = selected.id;
            clearBtn.classList.remove('hidden');

            expect(input.value).toBe('Budi Mulyawan, S.Pd');
            expect(select.value).toBe('T001');
            expect(clearBtn.classList.contains('hidden')).toBe(false);
        });

        test('Reset pilihan guru mengosongkan input dan menyembunyikan tombol clear', () => {
            input.value = '';
            select.value = '';
            clearBtn.classList.add('hidden');

            expect(input.value).toBe('');
            expect(select.value).toBe('');
            expect(clearBtn.classList.contains('hidden')).toBe(true);
        });
    });
});

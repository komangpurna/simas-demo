/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import fs from 'node:fs';
import * as acorn from 'acorn';

const studentSource = fs.readFileSync('js/page-portal-siswa.js', 'utf8');

function extract(source, names) {
    return acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body.filter(n =>
        n.type === 'FunctionDeclaration' ? names.includes(n.id.name) :
        n.type === 'VariableDeclaration' ? n.declarations.some(d => names.includes(d.id.name)) :
        n.type === 'ExpressionStatement' && names.includes(n.expression.left?.property?.name))
        .map(n => source.slice(n.start, n.end)).join('\n');
}

describe('LMS Student Subject Cards Theming & Dynamic Classroom Banner', () => {
    let scope;

    beforeEach(() => {
        document.body.innerHTML = `
            <div id="student-lms-all-classes-section">
                <div id="student-lms-class-cards-grid"></div>
            </div>
            <div id="student-lms-classroom-header" class="hidden bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700 p-3.5 sm:p-4 shadow-xs">
                <button type="button" class="w-9 h-9"></button>
                <h3 id="student-lms-classroom-title"></h3>
                <p id="student-lms-classroom-teacher"><strong id="student-lms-teacher-name"></strong></p>
                <span id="student-lms-classroom-progress-badge"></span>
                <span id="student-lms-classroom-guide"></span>
            </div>
            <div id="student-lms-home-summary"></div>
            <div id="student-lms-list-container" class="hidden"></div>
            <div id="student-lms-filter-wrapper" class="hidden"></div>
            <div id="student-lms-inline-discussions-container" class="hidden"></div>
            <div id="student-lms-inline-deadlines-container" class="hidden"></div>
            <select id="select-student-lms-subject"></select>
            <div id="student-lms-subject-pills"></div>
        `;

        window.escapeHTML = str => String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

        scope = {
            window,
            document,
            currentNIS: '1104',
            currentStudent: { nis: '1104', name: 'Ni Komang Prama Santhi', class: 'XI-2' },
            studentLmsSubjects: [],
            studentLmsActiveSubject: '',
            studentLmsStatusFilter: 'pending',
            studentLmsRawData: { topics: [], materials: [] },
            formatTeacherDisplayName: name => name || 'Nama guru belum tersedia',
            getSubjectUrgencyIndicator: () => ({ badgeHtml: '', pillDotHtml: '' }),
            setStudentLmsStatusFilter: jest.fn(),
            renderStudentLmsPills: jest.fn()
        };

        const currentSource = fs.readFileSync('js/page-portal-siswa.js', 'utf8');
        const code = extract(currentSource, [
            'LMS_FALLBACK_PALETTES',
            'LMS_GRADIENTS',
            'getSubjectTheme',
            'renderStudentLmsClassCards',
            'updateStudentLmsClassroomHeader',
            'selectStudentLmsSubject'
        ]);

        new Function(...Object.keys(scope), code)(...Object.values(scope));
    });

    test('getSubjectTheme mencocokkan kata kunci semantik ke tema warna & ikon yang tepat', () => {
        const getTheme = window.getSubjectTheme;
        expect(typeof getTheme).toBe('function');

        // Kimia -> flask
        const kimia = getTheme('Kimia');
        expect(kimia.icon).toBe('fa-flask-vial');
        expect(kimia.bg).toContain('teal');

        // Biologi -> dna
        const biologi = getTheme('Biologi');
        expect(biologi.icon).toBe('fa-dna');
        expect(biologi.bg).toContain('emerald');

        // Matematika Tingkat Lanjut -> square-root-variable
        const mtl = getTheme('Matematika Tingkat Lanjut');
        expect(mtl.icon).toBe('fa-square-root-variable');
        expect(mtl.bg).toContain('violet');

        // Sejarah -> landmark
        const sejarah = getTheme('Sejarah');
        expect(sejarah.icon).toBe('fa-landmark');
        expect(sejarah.bg).toContain('amber');

        // Agama dan Budi Pekerti -> hands-praying
        const agama = getTheme('Agama dan Budi Pekerti');
        expect(agama.icon).toBe('fa-hands-praying');
        expect(agama.bg).toContain('rose');

        // Seni Budaya -> palette
        const seni = getTheme('Seni Budaya');
        expect(seni.icon).toBe('fa-palette');
        expect(seni.bg).toContain('fuchsia');

        // Bahasa Inggris -> language
        const bing = getTheme('Bahasa Inggris');
        expect(bing.icon).toBe('fa-language');
        expect(bing.bg).toContain('sky');

        // Bahasa Indonesia -> book-bookmark
        const bindo = getTheme('Bahasa Indonesia');
        expect(bindo.icon).toBe('fa-book-bookmark');
        expect(bindo.bg).toContain('blue');

        // Fisika -> atom
        const fisika = getTheme('Fisika');
        expect(fisika.icon).toBe('fa-atom');

        // Informatika -> laptop-code
        const info = getTheme('Informatika');
        expect(info.icon).toBe('fa-laptop-code');

        // PJOK / Penjas -> volleyball
        const pjok = getTheme('Pendidikan Jasmani, Olahraga, dan Kesehatan');
        expect(pjok.icon).toBe('fa-volleyball');
        expect(pjok.bg).toContain('lime');
    });

    test('getSubjectTheme menghasilkan fallback hash deterministik untuk mata pelajaran di luar kamus', () => {
        const getTheme = window.getSubjectTheme;
        const theme1 = getTheme('Robotika Terapan');
        const theme2 = getTheme('Robotika Terapan');
        expect(theme1).toEqual(theme2); // Deterministik
        expect(theme1.bg).toBeDefined();
        expect(theme1.border).toBeDefined();

        const theme3 = getTheme('Astronomi Antariksa');
        expect(theme3).toBeDefined();
    });

    test('renderStudentLmsClassCards menghasilkan 8 kartu mapel dengan warna & ikon tematik yang berbeda (Screenshot User)', () => {
        const subjects = [
            { subject_name: 'Bahasa Indonesia', teacher_name: 'Ni Kadek Ari Astuti, S.Pd', total_materials: 1, completed_count: 0, completion_rate: 0, topics: [{ id: 1 }] },
            { subject_name: 'Kimia', teacher_name: 'Rendy Mardika, S.Pd', total_materials: 1, completed_count: 1, completion_rate: 100, topics: [{ id: 2 }] },
            { subject_name: 'Biologi', teacher_name: 'Maulita Wulan Nugraheni, S.Pd', total_materials: 1, completed_count: 1, completion_rate: 100, topics: [{ id: 3 }] },
            { subject_name: 'Matematika Tingkat Lanjut', teacher_name: 'I Komang Purna, S.Pd., Gr.', total_materials: 1, completed_count: 1, completion_rate: 100, topics: [{ id: 4 }] },
            { subject_name: 'Agama dan Budi Pekerti', teacher_name: 'Ni Kadek Maryati, M.Pd. H', total_materials: 1, completed_count: 0, completion_rate: 0, topics: [{ id: 5 }] },
            { subject_name: 'Sejarah', teacher_name: 'Selfiana Esterlita Enggo, S.Pd', total_materials: 2, completed_count: 0, completion_rate: 0, topics: [{ id: 6 }, { id: 7 }] },
            { subject_name: 'Bahasa Inggris', teacher_name: 'Ni Luh Putu Tustiani, S.Pd', total_materials: 1, completed_count: 0, completion_rate: 0, topics: [{ id: 8 }] },
            { subject_name: 'Seni Budaya', teacher_name: 'Ni Kadek Nilawati, S.Pd', total_materials: 1, completed_count: 0, completion_rate: 0, topics: [{ id: 9 }] }
        ];

        scope.studentLmsSubjects = subjects;
        window.renderStudentLmsClassCards(subjects);

        const buttons = document.querySelectorAll('#student-lms-class-cards-grid button');
        expect(buttons).toHaveLength(8);

        // Mapel ke-7 (Bahasa Inggris) tidak boleh memiliki background / icon sama dengan Mapel ke-1 (Bahasa Indonesia)
        const bindoButton = buttons[0];
        const bingButton = buttons[6];
        expect(bindoButton.innerHTML).toContain('fa-book-bookmark');
        expect(bingButton.innerHTML).toContain('fa-language');
        expect(bindoButton.className).toContain('from-blue-600');
        expect(bingButton.className).toContain('from-sky-600');

        // Mapel ke-8 (Seni Budaya) tidak boleh memiliki background / icon sama dengan Mapel ke-2 (Kimia)
        const kimiaButton = buttons[1];
        const seniButton = buttons[7];
        expect(kimiaButton.innerHTML).toContain('fa-flask-vial');
        expect(seniButton.innerHTML).toContain('fa-palette');
        expect(kimiaButton.className).toContain('from-teal-600');
        expect(seniButton.className).toContain('from-fuchsia-600');

        // Verifikasi watermark memiliki transparansi subtle (style.opacity 0.07) agar teks tetap 100% jelas
        buttons.forEach(btn => {
            const watermark = btn.querySelector('.absolute.-right-4.-bottom-4');
            expect(watermark).not.toBeNull();
            expect(watermark.style.opacity).toBe('0.07');
            expect(watermark.className).toContain('group-hover:scale-110');
            // Verifikasi inline style linear-gradient terpasang
            expect(btn.getAttribute('style')).toContain('linear-gradient');
            // Verifikasi tombol Buka Mapel memiliki high-contrast pill
            expect(btn.innerHTML).toContain('Buka Mapel');
            expect(btn.innerHTML).toContain('bg-black/35');
        });
    });

    test('Matematika dan Bahasa Indonesia memiliki warna yang kontras dan jelas berbeda (Zero Color Collision)', () => {
        const getTheme = window.getSubjectTheme;
        const matematika = getTheme('Matematika');
        const bindo = getTheme('Bahasa Indonesia');

        expect(matematika.icon).toBe('fa-calculator');
        expect(bindo.icon).toBe('fa-book-bookmark');

        // Matematika adalah Ungu (Purple), Bahasa Indonesia adalah Biru Samudera (Blue)
        expect(matematika.bg).toContain('purple');
        expect(bindo.bg).toContain('blue');
        expect(matematika.bg).not.toEqual(bindo.bg);
        expect(matematika.gradientStart).not.toEqual(bindo.gradientStart);
    });

    test('6 Mata pelajaran dari screenshot user memiliki variasi warna tematik yang 100% berbeda', () => {
        const userSubjects = [
            'Bahasa Inggris',
            'Kimia',
            'Bahasa Indonesia',
            'Agama dan Budi Pekerti',
            'Prakarya dan Kewirausahaan',
            'Matematika'
        ];

        const getTheme = window.getSubjectTheme;
        const themes = userSubjects.map(name => getTheme(name));

        // Pastikan tidak ada 2 mapel yang memiliki kombinasi gradient yang sama
        const bgSet = new Set(themes.map(t => t.bg));
        const startColorSet = new Set(themes.map(t => t.gradientStart));

        expect(bgSet.size).toBe(6);
        expect(startColorSet.size).toBe(6);

        // Pastikan gradientEnd menggunakan warna gelap pekat (bukan putih/transparan)
        themes.forEach(theme => {
            expect(theme.gradientStart).toBeDefined();
            expect(theme.gradientEnd).toBeDefined();
            // Start dan End harus berupa kode HEX yang valid
            expect(theme.gradientStart).toMatch(/^#[0-9a-fA-F]{6}$/);
            expect(theme.gradientEnd).toMatch(/^#[0-9a-fA-F]{6}$/);
        });
    });

    test('updateStudentLmsClassroomHeader mengadopsi tema warna & watermark mapel aktif secara dinamis', () => {
        const subjects = [
            { subject_name: 'Kimia', teacher_name: 'Rendy Mardika, S.Pd', total_materials: 1, completed_count: 1, completion_rate: 100, topics: [{ id: 1 }] }
        ];
        scope.studentLmsSubjects.push(...subjects);

        // Buka mapel Kimia
        window.selectStudentLmsSubject('Kimia');

        const header = document.getElementById('student-lms-classroom-header');
        expect(header.classList.contains('hidden')).toBe(false);
        expect(header.className).toContain('from-teal-600');
        expect(header.getAttribute('style')).toContain('linear-gradient');

        const watermark = header.querySelector('.student-lms-header-watermark');
        expect(watermark).not.toBeNull();
        expect(watermark.innerHTML).toContain('fa-flask-vial');
        expect(watermark.style.opacity).toBe('0.07');

        const title = document.getElementById('student-lms-classroom-title');
        expect(title.textContent).toBe('Kimia');
        expect(title.className).toContain('text-white');

        // Kembali ke semua mapel
        window.selectStudentLmsSubject('');
        expect(header.classList.contains('hidden')).toBe(true);
        expect(header.getAttribute('style')).toBeNull();
        expect(header.querySelector('.student-lms-header-watermark')).toBeNull();
    });
});


/**
 * Unit & Behavioral Test Suite: Integrasi Foto Profil Siswa Compact pada Tab Nilai (Guru Mapel)
 * Memvalidasi penayangan foto siswa di sebelah kiri nama siswa pada tabel lembar penilaian,
 * memastikan ukuran compact (w-5 h-5 / 20px) dan padding py-1 agar tidak menambah tinggi baris form,
 * fallback inisial monogram, serta kepatuhan OWASP ASVS (escapeHTML & resolvePhotoUrl).
 */

const fs = require('fs');
const path = require('path');

describe('Portal Guru Mapel: Integrasi Pasfoto Siswa Compact pada Tab Nilai', () => {
    const root = path.resolve(__dirname, '..');
    const jsPath = path.join(root, 'js', 'page-guru-mapel.js');
    const jsContent = fs.readFileSync(jsPath, 'utf8');

    describe('1. Verifikasi Kode & Logika Render Foto Siswa di renderGradebookTable', () => {
        test('renderGradebookTable mengekstraksi URL foto siswa dari berbagai varian properti', () => {
            expect(jsContent).toContain('student.active_photo_url || student.activePhotoUrl || student.photoUrl');
        });

        test('renderGradebookTable menggunakan fungsi SSOT resolvePhotoUrl dengan aman', () => {
            expect(jsContent).toContain("(typeof window.resolvePhotoUrl === 'function' ? window.resolvePhotoUrl(rawPhoto) : rawPhoto)");
        });

        test('Foto siswa menggunakan ukuran circular compact w-5 h-5 (20px) untuk menjaga tinggi baris form', () => {
            expect(jsContent).toContain('w-5 h-5 rounded-full');
            expect(jsContent).toContain('shrink-0 overflow-hidden');
        });

        test('Sel nama siswa (col-nama-siswa) menggunakan padding py-0.5 agar total tinggi sel tetap compact dan sejajar input nilai', () => {
            expect(jsContent).toContain('class="col-nama-siswa px-2.5 py-0.5 font-bold');
        });

        test('Menyertakan fallback monogram inisial nama siswa jika foto tidak tersedia', () => {
            expect(jsContent).toContain("const sInitial = (student.name || 'S').trim().charAt(0).toUpperCase();");
            expect(jsContent).toContain('bg-blue-600 text-white text-[9px] flex items-center justify-center font-bold');
        });

        test('Menyertakan atribut lazy loading dan penanganan onerror pada elemen img', () => {
            expect(jsContent).toContain('loading="lazy"');
            expect(jsContent).toContain("onerror=\"this.onerror=null; this.parentElement.classList.add('bg-blue-600','text-white');");
        });

        test('Menerapkan sanitasi anti-XSS escapeHTML pada URL foto dan nama siswa (OWASP ASVS)', () => {
            expect(jsContent).toContain('escapeHTML(sPhotoUrl)');
            expect(jsContent).toContain('escapeHTML(student.name)');
        });

        test('Form input nilai umum dan perhotelan memiliki tinggi setara dan ultra-compact di guru-mapel.html', () => {
            const htmlPath = path.join(root, 'guru-mapel.html');
            const htmlContent = fs.readFileSync(htmlPath, 'utf8');

            // Tinggi setara di desktop (22px)
            expect(htmlContent).toMatch(/\.score-input,\s*\.perhotelan-nilai-rapor\s*\{[\s\S]*?height:\s*22px\s*!important;/);
            expect(htmlContent).toMatch(/\.perhotelan-deskripsi-cp\s*\{[\s\S]*?height:\s*22px\s*!important;/);

            // Tinggi setara di mobile (1.85rem)
            expect(htmlContent).toMatch(/@media\s*\(max-width:\s*639px\)[\s\S]*?\.score-input,\s*\.perhotelan-nilai-rapor\s*\{[\s\S]*?height:\s*1\.85rem\s*!important;/);
            expect(htmlContent).toMatch(/@media\s*\(max-width:\s*639px\)[\s\S]*?\.perhotelan-deskripsi-cp\s*\{[\s\S]*?height:\s*1\.85rem\s*!important;/);
        });
    });

    describe('2. Simulasi DOM: Rendering Baris Siswa dengan & Tanpa Foto', () => {
        function escapeHTML(str) {
            if (!str) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        function renderStudentAvatarHtml(student, resolvePhotoFn) {
            const rawPhoto = student.active_photo_url || student.activePhotoUrl || student.photoUrl || student.photo_url || student.foto || student.foto_url || '';
            const sPhotoUrl = rawPhoto ? (typeof resolvePhotoFn === 'function' ? resolvePhotoFn(rawPhoto) : rawPhoto) : '';
            const sInitial = (student.name || 'S').trim().charAt(0).toUpperCase();

            return sPhotoUrl
                ? `<div class="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center text-[9px] font-bold shrink-0 overflow-hidden ring-1 ring-slate-200/80 dark:ring-slate-700/80 shadow-2xs"><img src="${escapeHTML(sPhotoUrl)}" alt="${escapeHTML(student.name || '')}" class="w-full h-full object-cover" loading="lazy" onerror="this.onerror=null; this.parentElement.classList.add('bg-blue-600','text-white'); this.parentElement.innerHTML='${escapeHTML(sInitial)}';" /></div>`
                : `<div class="w-5 h-5 rounded-full bg-blue-600 text-white text-[9px] flex items-center justify-center font-bold shrink-0 shadow-2xs">${escapeHTML(sInitial)}</div>`;
        }

        test('Siswa yang memiliki foto aktif menghasilkan elemen img berukuran w-full h-full di dalam container w-5 h-5', () => {
            const mockStudent = {
                nis: '1001',
                name: 'I Komang Purna',
                active_photo_url: 'https://images.smagesa.sch.id/photos/1001.webp'
            };

            const html = renderStudentAvatarHtml(mockStudent, (url) => url);
            expect(html).toContain('<img src="https://images.smagesa.sch.id/photos/1001.webp"');
            expect(html).toContain('alt="I Komang Purna"');
            expect(html).toContain('loading="lazy"');
            expect(html).toContain('w-5 h-5 rounded-full');
        });

        test('Siswa tanpa foto menghasilkan monogram inisial nama berukuran w-5 h-5', () => {
            const mockStudent = {
                nis: '1002',
                name: 'Ni Luh Ayu Ketut',
                active_photo_url: null
            };

            const html = renderStudentAvatarHtml(mockStudent, (url) => url);
            expect(html).not.toContain('<img');
            expect(html).toContain('w-5 h-5 rounded-full bg-blue-600 text-white');
            expect(html).toContain('>N</div>');
        });

        test('Karakter berbahaya dalam nama dan URL disanitasi dengan benar (Anti-XSS)', () => {
            const mockMaliciousStudent = {
                nis: '1003',
                name: '<script>alert("XSS")</script>',
                active_photo_url: 'https://example.com/photo.jpg" onload="alert(1)'
            };

            const html = renderStudentAvatarHtml(mockMaliciousStudent, (url) => url);
            expect(html).not.toContain('<script>');
            expect(html).not.toContain('" onload="');
            expect(html).toContain('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
            expect(html).toContain('&quot; onload=&quot;');
        });
    });
});

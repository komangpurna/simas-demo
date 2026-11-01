const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

describe('Verifikasi Fitur Edit Jenis Pembinaan Guru Wali (4 Kategori Resmi)', () => {
    const htmlPath = path.join(projectRoot, 'guru-wali.html');
    const jsPath = path.join(projectRoot, 'js', 'page-guru-wali.js');
    const workerPath = path.join(projectRoot, 'cloudflare', 'worker.js');

    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const jsContent = fs.readFileSync(jsPath, 'utf8');
    const workerContent = fs.readFileSync(workerPath, 'utf8');

    test('Memastikan dropdown modal tambah (#catatan-kategori) hanya memiliki 4 kategori resmi', () => {
        const selectRegex = /<select\s+id=["']catatan-kategori["'][^>]*>([\s\S]*?)<\/select>/i;
        const match = htmlContent.match(selectRegex);
        expect(match).not.toBeNull();
        const optionsHtml = match[1];

        const optionValues = [...optionsHtml.matchAll(/value=["']([^"']+)["']/g)].map(m => m[1]);
        expect(optionValues).toEqual(['akademik', 'kompetensi', 'keterampilan', 'karakter']);
    });

    test('Memastikan dropdown modal edit (#edit-catatan-kategori) hanya memiliki 4 kategori resmi', () => {
        const selectRegex = /<select\s+id=["']edit-catatan-kategori["'][^>]*>([\s\S]*?)<\/select>/i;
        const match = htmlContent.match(selectRegex);
        expect(match).not.toBeNull();
        const optionsHtml = match[1];

        const optionValues = [...optionsHtml.matchAll(/value=["']([^"']+)["']/g)].map(m => m[1]);
        expect(optionValues).toEqual(['akademik', 'kompetensi', 'keterampilan', 'karakter']);
    });

    test('Memastikan dropdown filter (#filter-kategori) memiliki 4 kategori resmi ditambah opsi semua', () => {
        const selectRegex = /<select\s+id=["']filter-kategori["'][^>]*>([\s\S]*?)<\/select>/i;
        const match = htmlContent.match(selectRegex);
        expect(match).not.toBeNull();
        const optionsHtml = match[1];

        const optionValues = [...optionsHtml.matchAll(/value=["']([^"']*)["']/g)].map(m => m[1]);
        expect(optionValues).toEqual(['', 'akademik', 'kompetensi', 'keterampilan', 'karakter']);
    });

    test('Memastikan openEditCatatan menormalisasi kategori case-insensitive ke 4 kategori resmi', () => {
        expect(jsContent).toContain("const validCategories = ['akademik', 'kompetensi', 'keterampilan', 'karakter']");
        expect(jsContent).toContain("catSelect.value = catValue");
    });

    test('Memastikan submitEditCatatan menormalisasi kategori sebelum dikirim ke backend', () => {
        expect(jsContent).toContain("let kategori = (document.getElementById('edit-catatan-kategori')?.value || 'akademik').toLowerCase().trim()");
    });

    test('Memastikan timeline loadCatatanPembinaan mengekstrak title & content dari n.notes secara tahan banting', () => {
        expect(jsContent).toContain("const rawNotes = n.notes || n.content || ''");
        expect(jsContent).toContain("const lines = rawNotes.split('\\n')");
        expect(jsContent).toContain("const title = n.title || n.judul || lines[0] || 'Catatan Pembinaan'");
        expect(jsContent).toContain("const content = n.content || (lines.length > 1 ? lines.slice(1).join('\\n') : rawNotes)");
    });

    test('Memastikan getCategoryBadge menangani kategori secara case-insensitive', () => {
        expect(jsContent).toContain("const key = (category || 'akademik').toLowerCase().trim()");
    });

    test('Memastikan Worker endpoint PUT /api/perwalian/notes/:id mendecode ID URL secara presisi', () => {
        expect(workerContent).toContain('const id = decodeURIComponent(rawId)');
    });
});

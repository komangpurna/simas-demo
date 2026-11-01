/**
 * tests/html-modal-integrity.test.js
 *
 * Verifikasi Sistemik Integritas Hierarki DOM Modal:
 * 1. Seluruh modal di berkas HTML utama (e-kinerja.html, agenda-pegawai.html, dll)
 *    WAJIB berdiri mandiri (top-level / sibling) dan DILARANG KERAS bersarang (nested)
 *    di dalam modal atau kontainer berstatus hidden lainnya.
 * 2. Seluruh tag kontainer modal wajib berimbang sempurna (0 unclosed tags).
 * 3. Modal-modal kritis wajib memiliki z-index tinggi (z-[80] / z-[100]) agar tidak
 *    tertutup oleh stacking context sidebar/header desktop (z-50).
 */

const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

function walkHtml(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        const full = path.join(dir, file);
        const stat = fs.statSync(full);
        if (stat.isDirectory() && !file.startsWith('.') && file !== 'node_modules' && file !== 'cypress' && file !== 'scratch' && file !== 'templates') {
            results = results.concat(walkHtml(full));
        } else if (file.endsWith('.html')) {
            results.push(full);
        }
    });
    return results;
}

describe('Audit Integritas Hierarki DOM Modal & Keseimbangan Tag (Anti-Nesting Protection)', () => {
    const htmlFiles = walkHtml(rootDir);

    test('1. e-kinerja.html memiliki hierarki modal berimbang sempurna tanpa modal bersarang', () => {
        const filePath = path.join(rootDir, 'e-kinerja.html');
        const content = fs.readFileSync(filePath, 'utf8');
        const noComments = content.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
        const lines = noComments.split('\n');

        let stack = [];
        let nestedModalErrors = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const tagRegex = /<\/?([a-zA-Z0-9\-]+)(?:\s+[^>]*)?>/g;
            let m;

            while ((m = tagRegex.exec(line)) !== null) {
                const rawTag = m[0];
                const tagName = m[1].toLowerCase();
                const isClosing = rawTag.startsWith('</');
                const isSelfClosing = rawTag.endsWith('/>');

                if (tagName !== 'div') continue;
                if (isSelfClosing && !isClosing) continue;

                if (isClosing) {
                    if (stack.length > 0) stack.pop();
                } else {
                    const idMatch = rawTag.match(/id=["']([^"']+)["']/i);
                    const elementId = idMatch ? idMatch[1] : null;

                    if (elementId && elementId.startsWith('modal-')) {
                        const parentModal = stack.find(s => s.id && s.id.startsWith('modal-'));
                        if (parentModal) {
                            nestedModalErrors.push(`Modal #${elementId} (line ${i + 1}) bersarang di dalam #${parentModal.id} (line ${parentModal.line})`);
                        }
                    }

                    stack.push({
                        id: elementId,
                        line: i + 1
                    });
                }
            }
        }

        expect(nestedModalErrors).toEqual([]);
        // Pastikan tidak ada unclosed div di akhir berkas
        expect(stack.length).toBe(0);
    });

    test('2. Modal kebijakan alur persetujuan (#modal-workload-policy) memiliki stacking context z-[100] dan backdrop-blur standar', () => {
        const filePath = path.join(rootDir, 'e-kinerja.html');
        const content = fs.readFileSync(filePath, 'utf8');

        const modalMatch = content.match(/<div\b[^>]*id=["']modal-workload-policy["'][^>]*>/i);
        expect(modalMatch).not.toBeNull();
        expect(modalMatch[0]).toContain('z-[100]');
        expect(modalMatch[0]).toContain('backdrop-blur-sm');
        expect(modalMatch[0]).toContain('hidden');
    });

    test('3. Seluruh berkas HTML utama memiliki modal independen (tidak saling membungkus)', () => {
        const targetPages = [
            'e-kinerja.html',
            'e-kinerja-tendik.html',
            'agenda-pegawai.html',
            'agenda.html',
            'jurnal.html',
            'keuangan.html',
            'e-lab.html',
            'gtk.html',
            'guru-mapel.html',
            'dashboard.html'
        ];

        targetPages.forEach(fileName => {
            const filePath = path.join(rootDir, fileName);
            if (!fs.existsSync(filePath)) return;

            const content = fs.readFileSync(filePath, 'utf8');
            const noComments = content.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
            const lines = noComments.split('\n');

            let stack = [];
            let nestedErrors = [];

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const tagRegex = /<\/?div(?:\s+[^>]*)?>/gi;
                let m;

                while ((m = tagRegex.exec(line)) !== null) {
                    const rawTag = m[0];
                    const isClosing = rawTag.startsWith('</');
                    const isSelfClosing = rawTag.endsWith('/>');
                    if (isSelfClosing && !isClosing) continue;

                    if (isClosing) {
                        if (stack.length > 0) stack.pop();
                    } else {
                        const idMatch = rawTag.match(/id=["']([^"']+)["']/i);
                        const elementId = idMatch ? idMatch[1] : null;

                        const classMatch = rawTag.match(/class=["']([^"']+)["']/i);
                        const isOverlayModal = elementId && elementId.startsWith('modal-') && classMatch && classMatch[1].includes('fixed') && classMatch[1].includes('inset-0');

                        if (isOverlayModal) {
                            const parentOverlay = stack.find(s => s.isOverlay);
                            if (parentOverlay) {
                                nestedErrors.push(`${fileName}: Modal overlay #${elementId} (line ${i + 1}) bersarang di dalam modal overlay #${parentOverlay.id} (line ${parentOverlay.line})`);
                            }
                        }

                        stack.push({ id: elementId, isOverlay: Boolean(isOverlayModal), line: i + 1 });
                    }
                }
            }

            expect(nestedErrors).toEqual([]);
        });
    });

    test('4. guru-mapel.html memiliki hierarki tab panel independen (#panel-*) berimbang sempurna tanpa panel bersarang dan 0 unclosed tags', () => {
        const filePath = path.join(rootDir, 'guru-mapel.html');
        const content = fs.readFileSync(filePath, 'utf8');
        const noComments = content.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
        const lines = noComments.split('\n');

        let stack = [];
        let nestedPanelErrors = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const tagRegex = /<\/?div(?:\s+[^>]*)?>/gi;
            let m;

            while ((m = tagRegex.exec(line)) !== null) {
                const rawTag = m[0];
                const isClosing = rawTag.startsWith('</');
                const isSelfClosing = rawTag.endsWith('/>');
                if (isSelfClosing && !isClosing) continue;

                if (isClosing) {
                    if (stack.length > 0) stack.pop();
                } else {
                    const idMatch = rawTag.match(/id=["']([^"']+)["']/i);
                    const elementId = idMatch ? idMatch[1] : null;

                    const isTabPanel = elementId && elementId.startsWith('panel-');
                    if (isTabPanel) {
                        const parentPanel = stack.find(s => s.isTabPanel);
                        if (parentPanel) {
                            nestedPanelErrors.push(`Tab panel #${elementId} (line ${i + 1}) bersarang di dalam panel #${parentPanel.id} (line ${parentPanel.line})`);
                        }
                    }

                    stack.push({
                        id: elementId,
                        isTabPanel: Boolean(isTabPanel),
                        line: i + 1
                    });
                }
            }
        }

        expect(nestedPanelErrors).toEqual([]);
        // Pastikan tidak ada unclosed div di akhir berkas guru-mapel.html
        expect(stack.length).toBe(0);
    });

    test('5. dashboard.html memiliki modal log aktivitas (#modal-login-history) dengan tombol close di pojok kanan atas modal', () => {
        const filePath = path.join(rootDir, 'dashboard.html');
        const content = fs.readFileSync(filePath, 'utf8');

        // Modal login history harus ada
        expect(content).toContain('id="modal-login-history"');

        // Modal harus memiliki tombol close memanggil window.closeLoginHistoryModal()
        expect(content).toMatch(/<button\b[^>]*onclick=["']window\.closeLoginHistoryModal\(\)["'][^>]*>/i);

        // Modal harus memiliki ikon xmark
        const modalSection = content.substring(content.indexOf('id="modal-login-history"'), content.indexOf('id="modal-login-history"') + 3500);
        expect(modalSection).toContain('fa-xmark');
        expect(modalSection).toContain('closeLoginHistoryModal()');
        expect(modalSection).toContain('z-[100]');
    });

    test('6. portal-siswa.html memiliki overlay pelanggaran CBT (#modal-student-quiz-violation) berlatar merah penuh dengan elemen SSOT', () => {
        const filePath = path.join(rootDir, 'portal-siswa.html');
        const content = fs.readFileSync(filePath, 'utf8');

        expect(content).toContain('id="modal-student-quiz-violation"');
        const section = content.substring(content.indexOf('id="modal-student-quiz-violation"'), content.indexOf('id="modal-student-quiz-violation"') + 2500);
        expect(section).toContain('bg-red-600/95');
        expect(section).toContain('fa-triangle-exclamation');
        expect(section).toContain('JANGAN MENINGGALKAN HALAMAN UJIAN!');
        expect(section).toContain('Aktivitas mencurigakan terdeteksi.');
        expect(section).toContain('id="student-quiz-violation-current"');
        expect(section).toContain('id="student-quiz-violation-max"');
        expect(section).toContain('id="student-quiz-violation-limit-text"');
        expect(section).toContain('id="btn-student-quiz-ack-violation"');
        expect(section).toContain('Kembali ke Ujian');
    });
});

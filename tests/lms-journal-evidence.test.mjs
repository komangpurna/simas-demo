import { renderLmsJournalEvidenceCard, formatLmsJournalDuration } from '../js/lms-journal-evidence.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

function fixture(count = 36) {
    return { learning_version: 1, tanggal: '2026-10-15', kelas: 'XI-9', guru: 'Guru Contoh', mapel: 'Matematika',
        topik: 'Sudut di Berbagai Kuadran / Sudut Berelasi', jp: [1,2,3], material_ids: ['a'],
        period_start: '2026-10-15', period_end: '2026-10-15', snapshot_at: '2026-10-15T03:00:00.000Z',
        summary: { total: count, hadir: count-Math.floor(count/3), berprogres: count-Math.floor(count/3), selesai: Math.ceil(count/3) },
        students: Array.from({ length: count }, (_, index) => ({ nis: `PRIVATE-NIS-${index}`, nama: index === count - 1 ? 'Nama Siswa Terakhir yang Panjang Tetap Ditampilkan Seluruhnya' : `Nama Siswa ${index + 1}`,
            learning_status: ['completed','in_progress','not_opened'][index % 3], materials_completed: index % 3 === 0 ? 1 : 0,
            active_seconds: index % 3 === 2 ? null : 1805, status: index % 3 === 2 ? 'A' : 'H', reason: 'PRIVATE-REASON' })) };
}

test('all rows and full names fit inside the detailed evidence, without NIS or correction reasons', () => {
    const svg = renderLmsJournalEvidenceCard(fixture(), 1, { preview: true });
    const dom = new JSDOM(svg, { contentType: 'image/svg+xml' }), doc = dom.window.document;
    expect(doc.querySelectorAll('[data-evidence-student-row]')).toHaveLength(36);
    const last = doc.querySelector('[data-evidence-student-row="36"]');
    expect(last.textContent.replace(/\s+/g, '')).toContain('NamaSiswaTerakhiryangPanjangTetapDitampilkanSeluruhnya');
    const height = Number(doc.documentElement.getAttribute('height'));
    for (const text of doc.querySelectorAll('text')) expect(Number(text.getAttribute('y'))).toBeLessThan(height);
    expect(svg).toContain('PRATINJAU'); expect(svg).toContain('30 mnt 5 dtk'); expect(svg).toContain('Durasi bukan hitungan harian');
    expect(svg).not.toMatch(/PRIVATE-NIS|PRIVATE-REASON|data:image/); dom.window.close();
});

test('names and topics cannot inject SVG, scripts, images or invalid XML', () => {
    const data = fixture(1); data.topik = '<script>alert(1)</script> & kuadran\u0001';
    data.students[0].nama = '<image href="https://example.invalid"/> Nama & Siswa';
    const svg = renderLmsJournalEvidenceCard(data, 2), dom = new JSDOM(svg, { contentType: 'image/svg+xml' });
    expect(dom.window.document.querySelectorAll('script,image,foreignObject')).toHaveLength(0);
    expect(svg).toContain('&lt;script&gt;'); expect(svg).toContain('&amp; Siswa');
    expect(dom.window.document.querySelector('[data-evidence-student-row]').textContent.replace(/\s+/g,'')).toContain('Nama&Siswa'); expect(svg).not.toContain('\u0001');
    expect(svg).toContain('REKAP DISAHKAN GURU'); expect(svg).not.toContain('PRATINJAU'); dom.window.close();
});

test('legacy evidence keeps its aggregate layout and missing duration is never fabricated', () => {
    const old = fixture(1); delete old.learning_version;
    const svg = renderLmsJournalEvidenceCard(old, 1);
    expect(svg).toContain('width="1000"'); expect(svg).not.toContain('Nama Siswa');
    expect(formatLmsJournalDuration(null)).toBe('—'); expect(formatLmsJournalDuration(0)).toBe('0 dtk');
    expect(formatLmsJournalDuration(3660)).toBe('1 jam 1 mnt'); expect(formatLmsJournalDuration(NaN)).toBe('—');
});

test('renders Canva-style 2-panel collage with interactive discussion when comments exist', () => {
    const data = fixture(10);
    data.evidence_collage = {
        material: { title: 'Trigonometri Lanjutan', resource_type: 'gdrive', description: 'Pelajari konsep perbandingan trigonometri sudut berelasi.' },
        interactive: {
            type: 'discussion',
            prompt: 'Bagaimana tanda nilai sin/cos di Kuadran II?',
            comments: [{ user_name: 'Made Wijaya', user_role: 'siswa', content: 'Di kuadran II hanya sinus yang bertanda positif.' }]
        }
    };
    const svg = renderLmsJournalEvidenceCard(data, 1, { preview: true });
    const dom = new JSDOM(svg, { contentType: 'image/svg+xml' });
    const doc = dom.window.document;

    expect(doc.querySelector('[data-collage-panel="material"]')).not.toBeNull();
    const interactivePanel = doc.querySelector('[data-collage-panel="interactive"]');
    expect(interactivePanel).not.toBeNull();
    expect(interactivePanel.getAttribute('data-interactive-type')).toBe('discussion');
    expect(svg).toContain('DOKUMEN GOOGLE DRIVE / PDF');
    expect(svg).toContain('Trigonometri Lanjutan');
    expect(svg).toContain('FORUM DISKUSI AKTIF');
    expect(svg).toContain('Made Wijaya');
    expect(svg).toContain('hanya sinus yang bertanda positif');
    dom.window.close();
});

test('renders Canva-style collage with CBT quiz when quiz is active', () => {
    const data = fixture(5);
    data.evidence_collage = {
        material: { title: 'Video Persamaan Kuadrat', resource_type: 'youtube', description: 'Tonton video demonstrasi faktorisasi aljabar.' },
        interactive: {
            type: 'quiz',
            total_questions: 5,
            question_type: 'Pilihan Ganda',
            question_text: 'Berapakah akar-akar persamaan x^2 - 5x + 6 = 0?',
            options: ['x=2 atau x=3', 'x=1 atau x=6']
        }
    };
    const svg = renderLmsJournalEvidenceCard(data, 1);
    const dom = new JSDOM(svg, { contentType: 'image/svg+xml' });
    const doc = dom.window.document;

    expect(doc.querySelector('[data-collage-panel="material"]')).not.toBeNull();
    const interactivePanel = doc.querySelector('[data-collage-panel="interactive"]');
    expect(interactivePanel).not.toBeNull();
    expect(interactivePanel.getAttribute('data-interactive-type')).toBe('quiz');
    expect(svg).toContain('VIDEO PEMBELAJARAN');
    expect(svg).toContain('5 Butir Soal');
    expect(svg).toContain('akar-akar persamaan');
    expect(svg).toContain('A. x=2 atau x=3');
    dom.window.close();
});

test('renders Canva-style collage with self-study guide when neither discussion nor quiz is active', () => {
    const data = fixture(8);
    data.evidence_collage = {
        material: { title: 'Modul Bahasa Indonesia', resource_type: 'text', description: 'Struktur teks eksposisi dan kaidah kebahasaannya.' },
        interactive: {
            type: 'guide',
            target: 'Modul Bahasa Indonesia',
            instructions: 'Pelajari bahan ajar dan catat poin penting.',
            estimated_minutes: 45
        }
    };
    const svg = renderLmsJournalEvidenceCard(data, 1);
    const dom = new JSDOM(svg, { contentType: 'image/svg+xml' });
    const doc = dom.window.document;

    const interactivePanel = doc.querySelector('[data-collage-panel="interactive"]');
    expect(interactivePanel).not.toBeNull();
    expect(interactivePanel.getAttribute('data-interactive-type')).toBe('guide');
    expect(svg).toContain('PANDUAN BELAJAR MANDIRI');
    expect(svg).toContain('Estimasi 45 Menit');
    expect(svg).toContain('Eksplorasi materi &amp; bahan ajar hingga tuntas');
    dom.window.close();
});

test('collage content strictly sanitizes HTML/script/image tags preventing injection', () => {
    const data = fixture(2);
    data.evidence_collage = {
        material: { title: '<script>alert("materi")</script>', resource_type: 'link', description: '<image href="evil.jpg"/> deskripsi' },
        interactive: {
            type: 'discussion',
            prompt: 'Prompt & <bold>uji</bold>',
            comments: [{ user_name: '<script>bad()</script>', user_role: 'siswa', content: 'Komentar <svg/onload=alert(1)>' }]
        }
    };
    const svg = renderLmsJournalEvidenceCard(data, 1);
    const dom = new JSDOM(svg, { contentType: 'image/svg+xml' });
    const doc = dom.window.document;

    expect(doc.querySelectorAll('script,image,foreignObject')).toHaveLength(0);
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('&lt;image');
    dom.window.close();
});

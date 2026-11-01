/**
 * @jest-environment jsdom
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Game PID - Author and Submitter Labels & System Integrity', () => {
    let gamesJsContent;
    let adminJsContent;
    let cardHTMLFn;

    beforeAll(() => {
        const gamesJsPath = path.resolve(__dirname, '../pid/games.js');
        gamesJsContent = fs.readFileSync(gamesJsPath, 'utf8');

        const adminJsPath = path.resolve(__dirname, '../pid/admin.js');
        adminJsContent = fs.readFileSync(adminJsPath, 'utf8');

        window.eval(gamesJsContent);
        cardHTMLFn = window.cardHTML;
    });

    describe('Label Pengunggah pada Kartu Game PID (cardHTML)', () => {
        test('Menampilkan "Diupload oleh: [Nama]" dan BUKAN "Dibuat olch:" saat author berbeda dengan submitted_by_name', () => {
            const game = {
                id: 'game-123',
                title: 'Kuis Struktur Karya Ilmiah',
                category: 'kuis',
                subject: 'Bahasa Indonesia',
                author: 'Ni Kadek Ari Astuti, S.Pd',
                submitted_by_name: 'I Komang Purna, S.Pd., Gr.',
                submitted_by_uid: 'user-purna',
                is_active: true
            };

            const html = cardHTMLFn(game, 0);

            expect(html).toContain('<div class="card-author">Ni Kadek Ari Astuti, S.Pd</div>');
            expect(html).toContain('<div class="card-submitter">Diupload oleh: I Komang Purna, S.Pd., Gr.</div>');
            expect(html).not.toContain('Dibuat oleh:');
        });

        test('Tidak menampilkan card-submitter jika submitted_by_name sama persis dengan author', () => {
            const game = {
                id: 'game-456',
                title: 'Spinner Edukasi',
                category: 'arcade',
                author: 'I Komang Purna, S.Pd., Gr.',
                submitted_by_name: 'I Komang Purna, S.Pd., Gr.',
                is_active: true
            };

            const html = cardHTMLFn(game, 0);

            expect(html).toContain('<div class="card-author">I Komang Purna, S.Pd., Gr.</div>');
            expect(html).not.toContain('card-submitter');
            expect(html).not.toContain('Diupload oleh:');
            expect(html).not.toContain('Dibuat oleh:');
        });

        test('Menampilkan submitted_by_name sebagai author utama jika field author kosong atau "none"', () => {
            const game = {
                id: 'game-789',
                title: 'Sketsa AI: Tebak Gambar',
                category: 'kreativitas',
                author: 'none',
                submitted_by_name: 'I Komang Purna, S.Pd., Gr.',
                is_active: true
            };

            const html = cardHTMLFn(game, 0);

            expect(html).toContain('<div class="card-author">I Komang Purna, S.Pd., Gr.</div>');
            expect(html).not.toContain('card-submitter');
        });

        test('Tidak menampilkan baris author maupun submitter jika kedua field kosong', () => {
            const game = {
                id: 'game-999',
                title: 'Game Anonim',
                category: 'puzzle',
                is_active: true
            };

            const html = cardHTMLFn(game, 0);

            expect(html).not.toContain('class="card-author"');
            expect(html).not.toContain('class="card-submitter"');
        });
    });

    describe('Label Pengunggah pada Tabel Admin PID (admin.js)', () => {
        test('admin.js menggunakan label "Diupload oleh:" dan bukan "Diajukan:" untuk catatan pengunggah sekunder', () => {
            expect(adminJsContent).toContain('Diupload oleh: <span style="color: var(--text-dim);">');
            expect(adminJsContent).not.toContain('Diajukan: <span style="color: var(--text-dim);">');
        });
    });

    describe('Hak Akses Guru BK & Multi-Role Pengajar pada Portal PID', () => {
        test('global.js MENU_CONFIG memberikan akses game_pid kepada guru_bk', () => {
            const globalJs = fs.readFileSync(path.resolve(__dirname, '../js/global.js'), 'utf8');
            expect(globalJs).toMatch(/'guru_bk':\s*\[[^\]]*'game_pid'[^\]]*\]/);
        });

        test('portalpid.html mengizinkan login peran guru_bk dan peran guru lainnya', () => {
            const portalHtml = fs.readFileSync(path.resolve(__dirname, '../pid/portalpid.html'), 'utf8');
            expect(portalHtml).toContain("'guru_bk'");
            expect(portalHtml).toContain('canAccessPid');
        });

        test('canUserEditGame mengizinkan edit jika pengguna adalah pemilik pengunggah (submitted_by_uid) atau author GTK', () => {
            // Simulasi context viewer sebagai Guru BK
            window.pidPortalViewer = {
                uid: 'user-bk-01',
                name: 'Drs. I Made Sudarma',
                role: 'guru_bk'
            };

            const gameMilikBK = {
                id: 'game-bk-1',
                title: 'Kuis Gaya Belajar & Minat Karir',
                author: 'Drs. I Made Sudarma',
                submitted_by_uid: 'user-bk-01',
                submitted_by_name: 'Drs. I Made Sudarma',
                is_active: true
            };

            const gameOrangLain = {
                id: 'game-lain-2',
                title: 'Game Aljabar',
                author: 'Guru Lain, S.Pd',
                submitted_by_uid: 'user-lain-99',
                submitted_by_name: 'Guru Lain, S.Pd',
                is_active: true
            };

            expect(window.canUserEditGame(gameMilikBK)).toBe(true);
            expect(window.canUserEditGame(gameOrangLain)).toBe(false);
        });
    });

    describe('reference script dan konsistensi versi', () => {
        test('portalpid.html dan admin.html memuat script dengan cache buster versi', () => {
            const portalHtml = fs.readFileSync(path.resolve(__dirname, '../pid/portalpid.html'), 'utf8');
            const adminHtml = fs.readFileSync(path.resolve(__dirname, '../pid/admin.html'), 'utf8');

            expect(portalHtml).toContain('src="games.js?v=');
            expect(adminHtml).toContain('src="games.js?v=');
            expect(adminHtml).toContain('src="admin.js?v=');
        });

        test('Sinkronisasi nomor versi package.json, global config, dan PRD_SIMAS.md', () => {
            const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
            const configJs = fs.readFileSync(path.resolve(__dirname, '../js/config.js'), 'utf8');
            const prd = fs.readFileSync(path.resolve(__dirname, '../PRD_SIMAS.md'), 'utf8');

            expect(configJs).toContain(`export const APP_VERSION = "${pkg.version}";`);
            expect(prd).toContain('[' + pkg.version + ']');
        });
    });

    describe('Dukungan Hosting Kode HTML Mandiri (HTML Games & Sandboxed Runner)', () => {
        test('cardHTML memicu pembukaan showGameDetailModal untuk detail game interaktif', () => {
            const htmlGame = {
                id: 'game-html-01',
                title: 'Lab Fisika Gelombang',
                category: 'simulasi',
                subject: 'Fisika',
                author: 'I Nyoman Yasa, M.Pd',
                source_type: 'html',
                has_html: true,
                is_active: true
            };

            const rendered = cardHTMLFn(htmlGame, 0);

            expect(rendered).toContain("showGameDetailModal");
            expect(rendered).toContain("game-html-01");
            expect(rendered).toContain("Lab Fisika Gelombang");
            expect(rendered).toContain("I Nyoman Yasa, M.Pd");
        });

        test('portalpid.html memiliki modal-game-detail dan games.js mengekspor showGameDetailModal & closeGameDetailModal', () => {
            const portalHtml = fs.readFileSync(path.resolve(__dirname, '../pid/portalpid.html'), 'utf8');

            expect(portalHtml).toContain('id="modal-game-detail"');
            expect(portalHtml).toContain('id="game-detail-title"');
            expect(portalHtml).toContain('id="game-detail-author"');
            expect(portalHtml).toContain('id="btn-detail-play"');
            expect(portalHtml).toContain('id="btn-detail-edit"');
            expect(typeof window.showGameDetailModal).toBe('function');
            expect(typeof window.closeGameDetailModal).toBe('function');
        });

        test('inspectHtmlCode mengekstrak title, deskripsi, dan headings secara presisi', () => {
            const rawSample = `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Petualangan Sudut & Segitiga</title>
                    <meta name="description" content="Game edukasi interaktif untuk mengenali jenis-jenis segitiga.">
                </head>
                <body>
                    <h1>Misi Penjelajah Geometri</h1>
                    <p>Pilih sudut yang tepat untuk membuka pintu benteng!</p>
                </body>
                </html>
            `;

            expect(typeof window.inspectHtmlCode).toBe('function');
            const parsed = window.inspectHtmlCode(rawSample);

            expect(parsed).not.toBeNull();
            expect(parsed.title).toBe('Petualangan Sudut & Segitiga');
            expect(parsed.description).toContain('Game edukasi interaktif');
            expect(parsed.headings).toContain('Misi Penjelajah Geometri');
        });

        test('portalpid.html memiliki modal-game-player dengan sandbox ketat tanpa allow-same-origin', () => {
            const portalHtml = fs.readFileSync(path.resolve(__dirname, '../pid/portalpid.html'), 'utf8');

            expect(portalHtml).toContain('id="modal-game-player"');
            expect(portalHtml).toContain('sandbox="allow-scripts allow-forms allow-pointer-lock allow-fullscreen"');
            expect(portalHtml).not.toContain('allow-same-origin');
        });
    });

    describe('Adaptasi Kontras & Keterbacaan Teks Kartu Game PID (Luminance & WCAG AA Engine)', () => {
        test('parseColorBrightness menghitung luminansi secara akurat untuk berbagai format warna', () => {
            expect(typeof window.parseColorBrightness).toBe('function');

            // Warna gelap (skala 0 - 255)
            const darkHex1 = window.parseColorBrightness('#1a0933'); // Tactical arena background
            const darkHex2 = window.parseColorBrightness('#0f172a'); // Slate 900
            const darkRgb = window.parseColorBrightness('rgb(15, 23, 42)');
            const black = window.parseColorBrightness('#000000');

            expect(darkHex1).toBeLessThan(50);
            expect(darkHex2).toBeLessThan(50);
            expect(darkRgb).toBeLessThan(50);
            expect(black).toBe(0);

            // Warna terang
            const white = window.parseColorBrightness('#ffffff');
            const lightYellow = window.parseColorBrightness('#fbbf24');
            const lightGreen = window.parseColorBrightness('#4ade80');
            const lightRgb = window.parseColorBrightness('rgb(250, 250, 250)');

            expect(white).toBe(255);
            expect(lightYellow).toBeGreaterThan(150);
            expect(lightGreen).toBeGreaterThan(150);
            expect(lightRgb).toBeGreaterThan(200);
        });

        test('isDarkBackground mendeteksi gradien gelap vs gradien terang secara deterministik', () => {
            expect(typeof window.isDarkBackground).toBe('function');

            // Skenario gradien gelap (AI Squad Game, Night, Space)
            const tacticalGrad = 'linear-gradient(135deg, #1a0933 0%, #2b0d3e 50%, #0f051d 100%)';
            const spaceGrad = 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)';
            const deepPurple = '#1e1b4b';

            expect(window.isDarkBackground(tacticalGrad)).toBe(true);
            expect(window.isDarkBackground(spaceGrad)).toBe(true);
            expect(window.isDarkBackground(deepPurple)).toBe(true);
            expect(window.isDarkBackground('black')).toBe(true);

            // Skenario gradien cerah
            const amberGrad = 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 50%, #d97706 100%)';
            const greenGrad = 'linear-gradient(135deg, #4ade80 0%, #22c55e 50%, #16a34a 100%)';
            const cyanGrad = 'linear-gradient(135deg, #2dd4bf 0%, #14b8a6 50%, #0d9488 100%)';

            expect(window.isDarkBackground(amberGrad)).toBe(false);
            expect(window.isDarkBackground(greenGrad)).toBe(false);
            expect(window.isDarkBackground(cyanGrad)).toBe(false);
            expect(window.isDarkBackground('#ffffff')).toBe(false);

            // Edge cases aman dari crash
            expect(window.isDarkBackground(null)).toBe(false);
            expect(window.isDarkBackground('')).toBe(false);
            expect(window.isDarkBackground(undefined)).toBe(false);
        });

        test('cardHTML menyematkan kelas "theme-dark" saat game memiliki gradien gelap (seperti kartu SQUAD GAME)', () => {
            const squadGame = {
                id: 'game-tactical-01',
                title: 'SQUAD GAME TACTICAL ARENA',
                author: 'Selfiana Esterlita Enggo, S.Pd',
                category: 'arcade',
                subject: 'Informatika, PJOK, Sejarah',
                theme: {
                    bg_gradient: 'linear-gradient(135deg, #1a0933 0%, #2b0d3e 50%, #0f051d 100%)',
                    border_color: '#4c1d95'
                },
                is_active: true
            };

            const html = cardHTMLFn(squadGame, 0);

            expect(html).toContain('game-card');
            expect(html).toContain('theme-dark');
            expect(html).not.toContain('theme-light');
            expect(html).toContain('SQUAD GAME TACTICAL ARENA');
            expect(html).toContain('Selfiana Esterlita Enggo, S.Pd');
        });

        test('cardHTML menyematkan kelas "theme-light" saat game memiliki gradien cerah', () => {
            const bahasaGame = {
                id: 'game-bahasa-01',
                title: 'KOTAK MISTERI TEKS ANEKDOT',
                author: 'Ni Nyoman Mariati, S.Pd',
                category: 'kuis',
                subject: 'Bahasa Indonesia',
                theme: {
                    bg_gradient: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 50%, #d97706 100%)',
                    border_color: '#d97706'
                },
                is_active: true
            };

            const html = cardHTMLFn(bahasaGame, 0);

            expect(html).toContain('game-card');
            expect(html).toContain('theme-light');
            expect(html).not.toContain('theme-dark');
        });

        test('cardHTML mematuhi override eksplisit text_theme dari properti theme AI', () => {
            const explicitLightTextGame = {
                id: 'game-override-01',
                title: 'Cyber Security Lab',
                category: 'simulasi',
                theme: {
                    bg_gradient: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                    text_theme: 'light' // Memaksa tema teks putih
                },
                is_active: true
            };

            const explicitDarkTextGame = {
                id: 'game-override-02',
                title: 'Kuis Logika Ceria',
                category: 'kuis',
                theme: {
                    bg_gradient: 'linear-gradient(135deg, #38bdf8 0%, #0284c7 100%)',
                    text_theme: 'dark' // Memaksa tema teks gelap
                },
                is_active: true
            };

            const html1 = cardHTMLFn(explicitLightTextGame, 0);
            const html2 = cardHTMLFn(explicitDarkTextGame, 0);

            expect(html1).toContain('theme-dark');
            expect(html2).toContain('theme-light');
        });

        test('portalpid.html dan admin.html memiliki blok CSS .game-card.theme-dark untuk paritas kontras', () => {
            const portalHtml = fs.readFileSync(path.resolve(__dirname, '../pid/portalpid.html'), 'utf8');
            const adminHtml = fs.readFileSync(path.resolve(__dirname, '../pid/admin.html'), 'utf8');

            // Cek portalpid.html
            expect(portalHtml).toContain('.game-card.theme-dark .card-title');
            expect(portalHtml).toContain('color: #ffffff !important');
            expect(portalHtml).toContain('.game-card.theme-dark .card-author');
            expect(portalHtml).toContain('.game-card.theme-dark .card-subject-chip');

            // Cek admin.html
            expect(adminHtml).toContain('.game-card.theme-dark .card-title');
            expect(adminHtml).toContain('color: #ffffff !important');
            expect(adminHtml).toContain('.game-card.theme-dark .card-author');
            expect(adminHtml).toContain('.game-card.theme-dark .card-subject-chip');
        });
    });

    describe('Normalisasi & Ketahanan Render Gambar SVG AI (safeSvgToDataUri & Anti-Broken Image)', () => {
        let safeSvgToDataUriFn;

        beforeAll(() => {
            safeSvgToDataUriFn = window.safeSvgToDataUri;
        });

        test('safeSvgToDataUri terdefinisi sebagai fungsi global pada window', () => {
            expect(typeof safeSvgToDataUriFn).toBe('function');
        });

        test('safeSvgToDataUri mengenkode tanda petik tunggal menjadi %27 untuk mencegah konflik entitas XML', () => {
            const rawSvgWithSingleQuotes = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='40' fill='#38bdf8'/></svg>";
            const dataUri = safeSvgToDataUriFn(rawSvgWithSingleQuotes);

            expect(dataUri).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
            expect(dataUri).not.toContain("'"); // Tidak boleh ada tanda petik tunggal mentah
            expect(dataUri).toContain('%27');   // Tanda petik tunggal wajib dienkode menjadi %27

            // Verifikasi hasil lolos parsing XML tanpa parsererror
            const payload = decodeURIComponent(dataUri.replace('data:image/svg+xml;charset=utf-8,', ''));
            const doc = new DOMParser().parseFromString(payload, 'image/svg+xml');
            expect(doc.querySelector('parsererror')).toBeNull();
            expect(doc.querySelector('circle')).not.toBeNull();
        });

        test('safeSvgToDataUri otomatis membersihkan pembungkus markdown code fences', () => {
            const markdownWrappedSvg = "```xml\n<svg viewBox=\"0 0 100 100\"><rect width=\"100\" height=\"100\" fill=\"#10b981\"/></svg>\n```";
            const dataUri = safeSvgToDataUriFn(markdownWrappedSvg);

            expect(dataUri).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
            expect(dataUri).not.toContain('%60'); // Tidak ada backtick yang tersisa
            
            const payload = decodeURIComponent(dataUri.replace('data:image/svg+xml;charset=utf-8,', ''));
            const doc = new DOMParser().parseFromString(payload, 'image/svg+xml');
            expect(doc.querySelector('parsererror')).toBeNull();
            expect(doc.querySelector('rect')).not.toBeNull();
        });

        test('safeSvgToDataUri menginjeksi namespace xmlns dan viewBox jika absen', () => {
            const bareSvg = '<svg><polygon points="50,15 90,85 10,85" fill="#f59e0b"/></svg>';
            const dataUri = safeSvgToDataUriFn(bareSvg);

            const payload = decodeURIComponent(dataUri.replace('data:image/svg+xml;charset=utf-8,', ''));
            expect(payload).toContain('xmlns="http://www.w3.org/2000/svg"');
            expect(payload).toContain('viewBox="0 0 100 100"');
            
            const doc = new DOMParser().parseFromString(payload, 'image/svg+xml');
            expect(doc.querySelector('parsererror')).toBeNull();
        });

        test('safeSvgToDataUri memfilter tag script dan event handler XSS inline', () => {
            const xssSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" onload="alert(1)"><script>alert(2)</script><circle cx="50" cy="50" r="40"/></svg>';
            const dataUri = safeSvgToDataUriFn(xssSvg);

            const payload = decodeURIComponent(dataUri.replace('data:image/svg+xml;charset=utf-8,', ''));
            expect(payload).not.toContain('<script');
            expect(payload).not.toContain('onload');
            expect(payload).toContain('<circle');
        });

        test('safeSvgToDataUri membiarkan tautan URL HTTP/HTTPS standar apa adanya', () => {
            const httpsUrl = 'https://example.com/thumbnails/game-cover.png';
            expect(safeSvgToDataUriFn(httpsUrl)).toBe(httpsUrl);
        });

        test('cardHTML menghasilkan tag img dengan onerror fallback ke emoji tema dan lolos validasi XML', () => {
            const gameWithAiSvg = {
                id: 'game-ai-render-test',
                title: 'Simulasi Fisika Kinematika',
                category: 'simulasi',
                subject: 'Fisika',
                thumbnail_url: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='30' fill='#06b6d4'/></svg>",
                theme: {
                    emoji: '🚀',
                    bg_gradient: 'linear-gradient(135deg, #06b6d4 0%, #0284c7 100%)',
                    border_color: '#0284c7'
                },
                is_active: true
            };

            const html = cardHTMLFn(gameWithAiSvg, 0);

            // Verifikasi ada atribut onerror fallback
            expect(html).toContain('onerror=');
            expect(html).toContain('this.onerror=null');
            expect(html).toContain('ph-emoji');
            expect(html).toContain('🚀');

            // Ekstrak nilai src dari tag img
            const srcMatch = html.match(/<img[^>]+src="([^"]+)"/);
            expect(srcMatch).not.toBeNull();
            const srcValue = srcMatch[1];

            // Verifikasi srcValue TIDAK memuat entitas rusak &#39;
            expect(srcValue).not.toContain('&#39;');

            // Verifikasi browser dapat mendecode dan mem-parse SVG tanpa error
            const rawSvgFromSrc = decodeURIComponent(srcValue.replace('data:image/svg+xml;charset=utf-8,', ''));
            const doc = new DOMParser().parseFromString(rawSvgFromSrc, 'image/svg+xml');
            expect(doc.querySelector('parsererror')).toBeNull();
            expect(doc.querySelector('circle')).not.toBeNull();
        });

        test('portalpid.html dan admin.js memanggil safeSvgToDataUri secara konsisten', () => {
            const portalHtml = fs.readFileSync(path.resolve(__dirname, '../pid/portalpid.html'), 'utf8');
            const adminJs = fs.readFileSync(path.resolve(__dirname, '../pid/admin.js'), 'utf8');

            expect(portalHtml).toContain('window.safeSvgToDataUri(aiResult.svg_illustration)');
            expect(adminJs).toContain('window.safeSvgToDataUri(aiResult.svg_illustration)');
        });
    });

    describe('Tampilan Seluruh Chip Mata Pelajaran (Multi-Subject Chips Without Shortening)', () => {
        test('Merender seluruh mata pelajaran sebagai chip terpisah tanpa disingkat +1 atau +2', () => {
            const multiSubjectGame = {
                id: 'game-multi-subj-1',
                title: 'Squad Game Tactical Arena',
                category: 'arcade',
                subject: 'Informatika, PJOK, Sejarah',
                author: 'I Komang Purna, S.Pd., Gr.',
                submitted_by_name: 'I Komang Purna, S.Pd., Gr.',
                is_active: true
            };

            const html = cardHTMLFn(multiSubjectGame, 0);

            expect(html).toContain('<div class="card-subject">');
            expect(html).toContain('<span class="card-subject-chip">Informatika</span>');
            expect(html).toContain('<span class="card-subject-chip">PJOK</span>');
            expect(html).toContain('<span class="card-subject-chip">Sejarah</span>');
            expect(html).not.toContain('+1');
            expect(html).not.toContain('+2');
            expect(html).not.toMatch(/\+\d+/);
        });

        test('Game dengan 1 mapel dirender tepat 1 chip tanpa plus', () => {
            const singleSubjectGame = {
                id: 'game-single-subj-1',
                title: 'Kuis Trigonometri Cepat',
                category: 'kuis',
                subject: 'Matematika',
                author: 'Dra. Ni Made Rai',
                submitted_by_name: 'Dra. Ni Made Rai',
                is_active: true
            };

            const html = cardHTMLFn(singleSubjectGame, 0);

            expect(html).toContain('<span class="card-subject-chip">Matematika</span>');
            expect(html).not.toMatch(/\+\d+/);
        });
    });

    describe('Reorganisasi Portal PID: Klasifikasi Game Pembelajaran vs Game Santai & Ice Breaking', () => {
        let isLearningGameFn;
        let isCasualGameFn;
        let parseGameSubjectsFn;

        beforeAll(() => {
            isLearningGameFn = window.isLearningGame;
            isCasualGameFn = window.isCasualGame;
            parseGameSubjectsFn = window.parseGameSubjects;
        });

        test('Fungsi helper parseGameSubjects, isLearningGame, dan isCasualGame terekspor ke window', () => {
            expect(typeof parseGameSubjectsFn).toBe('function');
            expect(typeof isLearningGameFn).toBe('function');
            expect(typeof isCasualGameFn).toBe('function');
        });

        test('Game dengan mata pelajaran spesifik (Matematika/Biologi) diklasifikasikan sebagai Game Pembelajaran', () => {
            const mathGame = {
                title: 'Aljabar Seru',
                subject: 'Matematika'
            };
            expect(isLearningGameFn(mathGame)).toBe(true);
            expect(isCasualGameFn(mathGame)).toBe(false);
        });

        test('Game dengan Umum atau Ice Breaking diklasifikasikan sebagai Game Santai', () => {
            const casualGame1 = {
                title: 'Spinner Nama Siswa',
                subject: 'Ice Breaking'
            };
            const casualGame2 = {
                title: 'Tetris Santai',
                subject: 'Umum'
            };
            const casualGame3 = {
                title: 'Game Tanpa Mapel',
                subject: ''
            };

            expect(isCasualGameFn(casualGame1)).toBe(true);
            expect(isLearningGameFn(casualGame1)).toBe(false);

            expect(isCasualGameFn(casualGame2)).toBe(true);
            expect(isLearningGameFn(casualGame2)).toBe(false);

            expect(isCasualGameFn(casualGame3)).toBe(true);
            expect(isLearningGameFn(casualGame3)).toBe(false);
        });

        test('Multi-Membership: Game yang mencentang Mapel spesifik DAN Ice Breaking/Umum muncul di KEDUA filter', () => {
            const hybridGame = {
                title: 'Kuis Cepat Matematika Ice Breaking',
                subject: 'Matematika, Ice Breaking'
            };

            expect(isLearningGameFn(hybridGame)).toBe(true);
            expect(isCasualGameFn(hybridGame)).toBe(true);
        });

        test('Struktur DOM portalpid.html memuat Discovery Tabs dengan 3 mode (all, learning, casual) dan badge counter', () => {
            const portalHtmlPath = path.resolve(__dirname, '../pid/portalpid.html');
            const portalHtml = fs.readFileSync(portalHtmlPath, 'utf8');

            expect(portalHtml).toContain('id="discovery-tabs"');
            expect(portalHtml).toContain('data-mode="all"');
            expect(portalHtml).toContain('data-mode="learning"');
            expect(portalHtml).toContain('data-mode="casual"');
            expect(portalHtml).toContain('id="tab-count-all"');
            expect(portalHtml).toContain('id="tab-count-learning"');
            expect(portalHtml).toContain('id="tab-count-casual"');
            expect(portalHtml).toContain('id="game-detail-type-badge"');
        });

        test('Struktur DOM admin.html memuat filter mode (all, learning, casual)', () => {
            const adminHtmlPath = path.resolve(__dirname, '../pid/admin.html');
            const adminHtml = fs.readFileSync(adminHtmlPath, 'utf8');

            expect(adminHtml).toContain('id="admin-mode-filters"');
            expect(adminHtml).toContain('class="btn-sm admin-filter-btn active" data-mode="all"');
            expect(adminHtml).toContain('data-mode="learning"');
            expect(adminHtml).toContain('data-mode="casual"');
        });
    });
});

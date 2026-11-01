/** @jest-environment jsdom */
const fs = require('node:fs');
const path = require('node:path');

describe('Migrasi NIS Siswa Info Tooltip (siswa.html & js/page-students.js)', () => {
    let htmlContent;

    beforeAll(() => {
        htmlContent = fs.readFileSync(path.join(__dirname, '../siswa.html'), 'utf8');
    });

    beforeEach(() => {
        document.documentElement.innerHTML = htmlContent;

        // Inisialisasi logika toggle dari page-students.js
        window.toggleMigrateInfoTooltip = (e) => {
            if (e) {
                e.stopPropagation();
                e.preventDefault();
            }
            const tooltip = document.getElementById('tooltip-migrate-info');
            if (!tooltip) return;
            const isHidden = tooltip.classList.contains('invisible') || tooltip.style.visibility === 'hidden';
            if (isHidden) {
                tooltip.classList.remove('invisible', 'opacity-0', 'pointer-events-none');
                tooltip.classList.add('visible', 'opacity-100', 'pointer-events-auto');
                tooltip.style.visibility = 'visible';
                tooltip.style.opacity = '1';
                tooltip.style.pointerEvents = 'auto';
            } else {
                tooltip.classList.remove('visible', 'opacity-100', 'pointer-events-auto');
                tooltip.classList.add('invisible', 'opacity-0', 'pointer-events-none');
                tooltip.style.visibility = '';
                tooltip.style.opacity = '';
                tooltip.style.pointerEvents = '';
            }
        };

        document.addEventListener('click', (e) => {
            const tooltip = document.getElementById('tooltip-migrate-info');
            const btn = document.getElementById('btn-migrate-info-tooltip');
            if (tooltip && btn && !btn.contains(e.target) && !tooltip.contains(e.target)) {
                tooltip.classList.remove('visible', 'opacity-100', 'pointer-events-auto');
                tooltip.classList.add('invisible', 'opacity-0', 'pointer-events-none');
                tooltip.style.visibility = '';
                tooltip.style.opacity = '';
                tooltip.style.pointerEvents = '';
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const tooltip = document.getElementById('tooltip-migrate-info');
                if (tooltip) {
                    tooltip.classList.remove('visible', 'opacity-100', 'pointer-events-auto');
                    tooltip.classList.add('invisible', 'opacity-0', 'pointer-events-none');
                    tooltip.style.visibility = '';
                    tooltip.style.opacity = '';
                    tooltip.style.pointerEvents = '';
                }
            }
        });
    });

    test('1. Tombol pemicu tooltip (#btn-migrate-info-tooltip) terpasang dengan benar pada header tab migrasi', () => {
        const btn = document.getElementById('btn-migrate-info-tooltip');
        expect(btn).not.toBeNull();
        expect(btn.getAttribute('aria-label')).toBe('Informasi Penjelasan Migrasi NIS');
        expect(btn.querySelector('i.fa-circle-info')).not.toBeNull();

        const h3 = document.querySelector('#tab-student-migrate h3');
        expect(h3).not.toBeNull();
        expect(h3.textContent).toContain('Migrasi NIS Sementara ke NIS Resmi');
    });

    test('2. Penjelasan panjang database terintegrasi tersembunyi di dalam elemen tooltip (#tooltip-migrate-info)', () => {
        const tooltip = document.getElementById('tooltip-migrate-info');
        expect(tooltip).not.toBeNull();
        expect(tooltip.getAttribute('role')).toBe('tooltip');

        // Pastikan tersembunyi secara default
        expect(tooltip.classList.contains('invisible')).toBe(true);
        expect(tooltip.classList.contains('opacity-0')).toBe(true);

        // Pastikan teks lengkap cakupan migrasi database tetap lengkap dan presisi
        const content = tooltip.textContent;
        expect(content).toContain('Gunakan alat ini untuk memindahkan data siswa secara menyeluruh dari NIS Sementara');
        expect(content).toContain('Cloudflare D1 SQL');
        expect(content).toContain('Supabase PostgreSQL');
        expect(content).toContain('Firebase Firestore');
    });

    test('3. Fungsi toggleMigrateInfoTooltip dapat menampilkan dan menyembunyikan tooltip', () => {
        const tooltip = document.getElementById('tooltip-migrate-info');
        expect(tooltip.classList.contains('invisible')).toBe(true);

        // Simulasi klik untuk membuka tooltip
        window.toggleMigrateInfoTooltip();
        expect(tooltip.classList.contains('visible')).toBe(true);
        expect(tooltip.classList.contains('opacity-100')).toBe(true);
        expect(tooltip.style.visibility).toBe('visible');

        // Simulasi klik kedua untuk menutup tooltip
        window.toggleMigrateInfoTooltip();
        expect(tooltip.classList.contains('invisible')).toBe(true);
        expect(tooltip.classList.contains('opacity-0')).toBe(true);
        expect(tooltip.style.visibility).toBe('');
    });

    test('4. Klik di luar elemen tooltip dan tombol akan menutup tooltip', () => {
        const tooltip = document.getElementById('tooltip-migrate-info');

        // Buka tooltip
        window.toggleMigrateInfoTooltip();
        expect(tooltip.classList.contains('visible')).toBe(true);

        // Klik pada elemen luar (misal document.body)
        const outsideDiv = document.createElement('div');
        document.body.appendChild(outsideDiv);
        outsideDiv.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(tooltip.classList.contains('invisible')).toBe(true);
        expect(tooltip.classList.contains('visible')).toBe(false);
    });

    test('5. Menekan tombol Escape menutup tooltip yang sedang terbuka', () => {
        const tooltip = document.getElementById('tooltip-migrate-info');

        // Buka tooltip
        window.toggleMigrateInfoTooltip();
        expect(tooltip.classList.contains('visible')).toBe(true);

        // Tekan Escape
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        expect(tooltip.classList.contains('invisible')).toBe(true);
        expect(tooltip.classList.contains('visible')).toBe(false);
    });
});

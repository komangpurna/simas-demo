/** @jest-environment jsdom */
const fs = require('node:fs');
const path = require('node:path');

describe('Verifikasi Tata Letak Header Desktop E-Kinerja Tendik (2 Baris Proporsional)', () => {
    let htmlContent;

    beforeAll(() => {
        const htmlPath = path.join(__dirname, '../e-kinerja-tendik.html');
        htmlContent = fs.readFileSync(htmlPath, 'utf8');
        document.documentElement.innerHTML = htmlContent;
    });

    test('1. Header .premium-header terbagi menjadi 2 kontainer baris dengan pemisah border', () => {
        const header = document.querySelector('header.premium-header');
        expect(header).not.toBeNull();

        // Baris 1: Identitas & Kontrol Supervisi Pimpinan
        const heading = document.getElementById('page-title-heading');
        const supervisorActions = document.getElementById('header-supervisor-actions');
        expect(heading).not.toBeNull();
        expect(supervisorActions).not.toBeNull();

        // Baris 2: Navigasi Pekan/Target & Aksi Kerja Utama
        const primaryActions = document.getElementById('header-primary-actions');
        const targetBadge = document.getElementById('header-weekly-target-badge');
        expect(primaryActions).not.toBeNull();
        expect(targetBadge).not.toBeNull();

        // Verifikasi Baris 1 berada sebelum Baris 2 di DOM
        expect(supervisorActions.compareDocumentPosition(primaryActions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    test('2. Baris 1 (Atas) Kanan: Menampung kontrol manajerial / supervisi Kepala Sekolah', () => {
        const supervisorActions = document.getElementById('header-supervisor-actions');
        expect(supervisorActions).not.toBeNull();

        // 1. Switcher Pegawai
        const switcherWrapper = document.getElementById('employee-switcher-wrapper');
        expect(switcherWrapper).not.toBeNull();
        expect(supervisorActions.contains(switcherWrapper)).toBe(true);

        // 2. Tombol Beralih Mode Monitoring
        const btnMonitoring = document.getElementById('btn-monitoring-mode-toggle');
        expect(btnMonitoring).not.toBeNull();
        expect(supervisorActions.contains(btnMonitoring)).toBe(true);

        // 3. Tombol Rekap Realisasi VIP
        const btnRecap = document.getElementById('btn-employee-monthly-recap-toggle');
        expect(btnRecap).not.toBeNull();
        expect(supervisorActions.contains(btnRecap)).toBe(true);

        // 4. Tombol Kelola Penugasan
        const btnManage = document.getElementById('btn-manage-assignments');
        expect(btnManage).not.toBeNull();
        expect(supervisorActions.contains(btnManage)).toBe(true);
    });

    test('3. Baris 2 (Bawah) Kiri: Navigasi Pekan dan Badge Target Mingguan berdampingan', () => {
        const btnPrev = document.getElementById('btn-agenda-prev');
        const weekLabel = document.getElementById('header-week-label');
        const inputDate = document.getElementById('input-agenda-date');
        const btnNext = document.getElementById('btn-agenda-next');
        const btnToday = document.getElementById('btn-agenda-today');
        const targetBadge = document.getElementById('header-weekly-target-badge');

        expect(btnPrev).not.toBeNull();
        expect(weekLabel).not.toBeNull();
        expect(inputDate).not.toBeNull();
        expect(btnNext).not.toBeNull();
        expect(btnToday).not.toBeNull();
        expect(targetBadge).not.toBeNull();

        // Target badge harus berada setelah navigasi pekan di baris bawah
        expect(btnToday.compareDocumentPosition(targetBadge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(targetBadge.textContent).toContain('Target 37,5 Jam/Minggu');
    });

    test('4. Baris 2 (Bawah) Kanan: Menampung tombol aksi umum (Saran & Catat Aktivitas)', () => {
        const primaryActions = document.getElementById('header-primary-actions');
        expect(primaryActions).not.toBeNull();

        const btnSaran = document.getElementById('btn-global-chat-feedback');
        const btnCatat = document.getElementById('btn-open-activity-modal');

        expect(btnSaran).not.toBeNull();
        expect(primaryActions.contains(btnSaran)).toBe(true);
        expect(btnSaran.textContent).toContain('Saran');

        expect(btnCatat).not.toBeNull();
        expect(primaryActions.contains(btnCatat)).toBe(true);
        expect(btnCatat.textContent).toContain('Catat Aktivitas');

        // Tombol Saran mendahului tombol Catat Aktivitas
        expect(btnSaran.compareDocumentPosition(btnCatat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    test('5. Ruang judul halaman tidak terhimpit di desktop: Judul memiliki flex-1 min-w-0', () => {
        const heading = document.getElementById('page-title-heading');
        const headingParent = heading.parentElement;
        expect(headingParent.className).toContain('flex-1');
        expect(headingParent.className).toContain('min-w-0');
    });
});

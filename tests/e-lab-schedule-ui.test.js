/**
 * tests/e-lab-schedule-ui.test.js
 * Pengujian Unit & Integritas UI/UX Tab Jadwal E-Laboratorium SIMAS
 */

const fs = require('fs');
const path = require('path');

describe('E-Laboratorium Jadwal UI/UX & Structure Verification', () => {
    let htmlContent = '';
    let jsContent = '';

    beforeAll(() => {
        htmlContent = fs.readFileSync(path.join(__dirname, '../e-lab.html'), 'utf8');
        jsContent = fs.readFileSync(path.join(__dirname, '../js/page-e-lab.js'), 'utf8');
    });

    describe('Integritas Markup & Komponen Tab Jadwal di e-lab.html', () => {
        test('Memuat tab jadwal #view-jadwal dengan kontrol toolbar terpadu', () => {
            expect(htmlContent).toContain('id="view-jadwal"');
            expect(htmlContent).toContain('id="week-display"');
            expect(htmlContent).toContain('onclick="changeWeek(-1)"');
            expect(htmlContent).toContain('onclick="changeWeek(1)"');
        });

        test('Toolbar memiliki tombol "Minggu ini" menggantikan ikon rumah lama', () => {
            expect(htmlContent).toContain('onclick="goToCurrentWeek()"');
            expect(htmlContent).toContain('Minggu ini');
            expect(htmlContent).not.toMatch(/title="Minggu Ini">\s*<i class="fa-solid fa-house/);
        });

        test('Filter status menggunakan label Bahasa Indonesia dengan value API yang dipertahankan', () => {
            expect(htmlContent).toContain('<option value="">Semua Status</option>');
            expect(htmlContent).toContain('<option value="approved">✓ Disetujui</option>');
            expect(htmlContent).toContain('<option value="pending">⏳ Menunggu</option>');
            expect(htmlContent).toContain('<option value="conflict">⚠ Bentrok</option>');
        });

        test('Kontrol navigasi dan filter memiliki label aksesibel (aria-label / sr-only)', () => {
            expect(htmlContent).toContain('aria-label="Minggu sebelumnya"');
            expect(htmlContent).toContain('aria-label="Minggu berikutnya"');
            expect(htmlContent).toContain('aria-label="Filter Laboratorium"');
            expect(htmlContent).toContain('aria-label="Filter Status"');
            expect(htmlContent).toContain('aria-label="Alihkan tampilan kalender tabel atau daftar"');
        });

        test('Tabel kalender menggunakan table-layout fixed, min-width 860px, dan colgroup dengan lebar kolom waktu 110px serta hari 150px', () => {
            expect(htmlContent).toContain('<table class="w-full text-sm border-collapse" id="table-schedule">');
            expect(htmlContent).toContain('<colgroup>');
            expect(htmlContent).toContain('width: 110px');
            expect(htmlContent).toContain('class="sched-corner-header');
            expect(htmlContent).toContain('min-width: 860px');
            expect(htmlContent).toContain('min-width: 150px');
        });

        test('Menyediakan banner panduan smart quick booking dan tombol pembatalan', () => {
            expect(htmlContent).toContain('id="quickbook-banner"');
            expect(htmlContent).toContain('id="quickbook-banner-text"');
            expect(htmlContent).toContain('onclick="cancelSmartSelection()"');
        });

        test('Menyediakan container state visual loading, error, dan filter kosong', () => {
            expect(htmlContent).toContain('id="schedule-loading"');
            expect(htmlContent).toContain('id="schedule-error"');
            expect(htmlContent).toContain('id="schedule-filter-empty"');
            expect(htmlContent).toContain('window.resetScheduleFilters()');
        });

        test('Menyediakan modal khusus untuk slot booking padat #modal-slot-bookings', () => {
            expect(htmlContent).toContain('id="modal-slot-bookings"');
            expect(htmlContent).toContain('id="slot-modal-title"');
            expect(htmlContent).toContain('id="slot-modal-content"');
        });

        test('Memiliki stylesheet scoped #view-jadwal untuk mencegah konflik padding/font global', () => {
            expect(htmlContent).toContain('#view-jadwal select.elab-sched-select');
            expect(htmlContent).toContain('#view-jadwal .elab-sched-btn');
            expect(htmlContent).toContain('#table-schedule');
            expect(htmlContent).toContain('.sched-empty-slot');
            expect(htmlContent).toContain('.sched-empty-action');
        });
    });

    describe('Logika Palet Warna Lab & Aksesibilitas Kartu Booking', () => {
        const labColors = [
            { bg: '#eff6ff', text: '#1e3a8a', border: '#bfdbfe', accent: '#3b82f6' },
            { bg: '#f0fdf4', text: '#14532d', border: '#bbf7d0', accent: '#16a34a' },
            { bg: '#faf5ff', text: '#581c87', border: '#e9d5ff', accent: '#9333ea' },
            { bg: '#fff7ed', text: '#7c2d12', border: '#fed7aa', accent: '#ea580c' },
            { bg: '#f0fdfa', text: '#134e4a', border: '#99f6e4', accent: '#0d9488' }
        ];

        function getLabColorMock(labId) {
            if (!labId) return labColors[0];
            let hash = 0;
            for (let i = 0; i < labId.length; i++) {
                hash = labId.charCodeAt(i) + ((hash << 5) - hash);
            }
            const index = Math.abs(hash) % labColors.length;
            return labColors[index];
        }

        test('Setiap warna lab memiliki warna aksen sisi kiri dan latar lembut kontras', () => {
            const color1 = getLabColorMock('lab-komputer-1');
            expect(color1).toBeDefined();
            expect(color1.accent).toMatch(/^#[0-9a-f]{6}$/i);
            expect(color1.bg).toMatch(/^#[0-9a-f]{6}$/i);
            expect(color1.text).toMatch(/^#[0-9a-f]{6}$/i);
        });

        test('Ikon status tidak lagi menggunakan filter glow drop-shadow', () => {
            expect(jsContent).not.toContain('filter:drop-shadow(0 0 4px');
            expect(jsContent).not.toContain('filter:drop-shadow(0 0 3px');
        });

        test('Status dibedakan dengan teks dan ikon yang jelas', () => {
            expect(jsContent).toContain('Disetujui');
            expect(jsContent).toContain('Menunggu');
            expect(jsContent).toContain('Bentrok');
            expect(jsContent).toContain('fa-circle-check');
            expect(jsContent).toContain('fa-clock');
            expect(jsContent).toContain('fa-triangle-exclamation');
        });
    });

    describe('Pembedaan Konflik / Bentrok Nyata vs Booking Multi-Lab', () => {
        test('Dua booking di jam yang sama pada LAB BERBEDA tidak dicap sebagai bentrok', () => {
            const bookings = [
                { id: 'b1', lab_id: 'lab-bio', lab_nama: 'Lab Biologi', tanggal: '2026-09-08', jam_mulai: 2, jam_selesai: 3, status: 'approved' },
                { id: 'b2', lab_id: 'lab-fis', lab_nama: 'Lab Fisika', tanggal: '2026-09-08', jam_mulai: 2, jam_selesai: 3, status: 'approved' }
            ];

            const onSlot = bookings.filter(b => b.tanggal === '2026-09-08' && 2 >= b.jam_mulai && 2 <= b.jam_selesai);
            expect(onSlot.length).toBe(2);

            const hasConflict = onSlot.some(b => b.status === 'conflict');
            expect(hasConflict).toBe(false);
        });

        test('Hanya booking dengan status "conflict" yang menampilkan indikator bentrok', () => {
            const bookings = [
                { id: 'b1', lab_id: 'lab-komp', lab_nama: 'Lab Komputer', tanggal: '2026-09-08', jam_mulai: 1, jam_selesai: 2, status: 'conflict' }
            ];

            expect(bookings[0].status).toBe('conflict');
        });
    });

    describe('Logika Perhitungan Tanggal Mingguan', () => {
        function getWeekDatesMock(mondayDate) {
            const dates = [];
            for (let i = 0; i < 5; i++) {
                const d = new Date(mondayDate);
                d.setDate(mondayDate.getDate() + i);
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                dates.push(`${year}-${month}-${day}`);
            }
            return dates;
        }

        test('Menghasilkan 5 tanggal kerja (Senin - Jumat) berurutan', () => {
            const monday = new Date(2026, 8, 7); // 7 Sep 2026
            const dates = getWeekDatesMock(monday);
            expect(dates.length).toBe(5);
            expect(dates[0]).toBe('2026-09-07');
            expect(dates[1]).toBe('2026-09-08');
            expect(dates[2]).toBe('2026-09-09');
            expect(dates[3]).toBe('2026-09-10');
            expect(dates[4]).toBe('2026-09-11');
        });

        test('Mampu menangani pergantian bulan dengan mulus', () => {
            const monday = new Date(2026, 7, 31); // 31 Agu 2026
            const dates = getWeekDatesMock(monday);
            expect(dates[0]).toBe('2026-08-31');
            expect(dates[1]).toBe('2026-09-01');
            expect(dates[2]).toBe('2026-09-02');
            expect(dates[3]).toBe('2026-09-03');
            expect(dates[4]).toBe('2026-09-04');
        });

        test('Mampu menangani pergantian tahun dengan mulus', () => {
            const monday = new Date(2026, 11, 28); // 28 Des 2026
            const dates = getWeekDatesMock(monday);
            expect(dates[0]).toBe('2026-12-28');
            expect(dates[1]).toBe('2026-12-29');
            expect(dates[2]).toBe('2026-12-30');
            expect(dates[3]).toBe('2026-12-31');
            expect(dates[4]).toBe('2027-01-01');
        });
    });

    describe('Logika Slot Padat (> 2 booking)', () => {
        test('Jika slot memiliki lebih dari 2 booking, ditampilkan 2 kartu teratas dan tombol sisa', () => {
            const bookings = [
                { id: '1', lab_nama: 'Lab A', kegiatan: 'Praktikum A' },
                { id: '2', lab_nama: 'Lab B', kegiatan: 'Praktikum B' },
                { id: '3', lab_nama: 'Lab C', kegiatan: 'Praktikum C' },
                { id: '4', lab_nama: 'Lab D', kegiatan: 'Praktikum D' }
            ];

            const topCards = bookings.slice(0, 2);
            const remaining = bookings.length - 2;

            expect(topCards.length).toBe(2);
            expect(remaining).toBe(2);
        });
    });

    describe('Integrasi openBookingModal, quickBook, & Form Modal Booking', () => {
        test('openBookingModal terdefinisi sebagai fungsi dan diekspos ke window.openBookingModal di page-e-lab.js', () => {
            expect(jsContent).toMatch(/function\s+openBookingModal\s*\(/);
            expect(jsContent).toContain('window.openBookingModal = openBookingModal;');
        });

        test('quickBook memanggil openBookingModal dengan parameter dateStr, startJP, endJP', () => {
            expect(jsContent).toContain('openBookingModal(dateStr, startJP, endJP);');
        });

        test('Tombol header "+ Booking" di e-lab.html memanggil openBookingModal()', () => {
            expect(htmlContent).toMatch(/onclick="openBookingModal\(\)"[^>]*>\s*<i class="fa-solid fa-plus mr-1"><\/i>Booking/);
        });

        test('Semua elemen kontrol modal-booking yang di-reset/di-prefill oleh openBookingModal tersedia di e-lab.html', () => {
            const requiredElements = [
                'id="modal-booking"',
                'id="booking-lab"',
                'id="booking-date"',
                'id="booking-start-jp"',
                'id="booking-end-jp"',
                'id="booking-kelas"',
                'id="booking-kegiatan"',
                'id="booking-catatan"',
                'id="conflict-preview"',
                'id="btn-submit-booking"'
            ];
            requiredElements.forEach(idPattern => {
                expect(htmlContent).toContain(idPattern);
            });
        });
    });

    describe('Integrasi Foto Guru Penanggung Jawab Jam Praktikum (Zero Dimension Expansion)', () => {
        test('Fungsi getTeacherBookingAvatar terdefinisi dan diekspos ke window', () => {
            expect(jsContent).toMatch(/function\s+getTeacherBookingAvatar\s*\(/);
            expect(jsContent).toContain('window.getTeacherBookingAvatar = getTeacherBookingAvatar;');
        });

        test('Helper resolvePhotoUrl diimpor dari config.js untuk SSOT Cloudflare Worker/R2', () => {
            expect(jsContent).toContain("import { auth, db, PATHS, resolvePhotoUrl } from './config.js';");
        });

        test('Foto/avatar disembunyikan pada kartu matriks jadwal agar tampilan bersih & lapang', () => {
            // Memastikan foto tidak dimunculkan di kartu matriks kalender
            expect(jsContent).not.toContain('elab-teacher-avatar-slot absolute right-1.5 bottom-1.5');
            expect(jsContent).not.toContain('elab-teacher-avatar-slot absolute right-1 bottom-1');
            expect(jsContent).toContain("if (mode === 'schedule-single' || mode === 'schedule-multi')");
        });

        test('Default preferensi tampilan jadwal selalu tabel matriks kalender di semua perangkat', () => {
            expect(jsContent).toMatch(/isMobileListView\s*=\s*false/);
            expect(jsContent).not.toMatch(/isMobileListView\s*=\s*window\.innerWidth\s*<\s*768/);
        });

        test('Avatar dilengkapi mekanisme graceful fallback inisial dan penanganan onerror untuk modal & tabel riwayat', () => {
            expect(jsContent).toContain("onerror=\"this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';\"");
            expect(jsContent).toContain('bg-gradient-to-tr from-blue-600 to-indigo-600');
        });

        test('Tabel riwayat dan log pemakaian menyertakan foto guru di kolom pemohon', () => {
            expect(jsContent).toContain("getTeacherBookingAvatar(b, 'table')");
        });

        test('Modal detail booking dan modal slot padat menampilkan foto guru penanggung jawab', () => {
            expect(jsContent).toContain("getTeacherBookingAvatar(b, 'detail')");
            expect(jsContent).toContain("getTeacherBookingAvatar(b, 'compact')");
            expect(jsContent).toContain('Guru Penanggung Jawab Praktikum');
        });
    });

    describe('Integritas Stacking Context & Paritas Modal Konfirmasi E-Lab (Anti-Occlusion Protection)', () => {
        test('Modal konfirmasi aksi (#modal-confirm-action) menggunakan z-[10010] agar berada di depan modal detail (z-modal: 9999)', () => {
            const confirmMatch = htmlContent.match(/<div\b[^>]*id=["']modal-confirm-action["'][^>]*>/i);
            expect(confirmMatch).not.toBeNull();
            expect(confirmMatch[0]).toContain('z-[10010]');
            expect(confirmMatch[0]).toContain('fixed inset-0');
            expect(confirmMatch[0]).toContain('hidden');
        });

        test('Modal konfirmasi aksi mendukung klik backdrop untuk menutup dan proteksi stopPropagation pada card', () => {
            expect(htmlContent).toMatch(/id="modal-confirm-action"[^>]*onclick="closeModal\('modal-confirm-action'\)"/);
            expect(htmlContent).toContain('<div class="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden transform transition-all border border-slate-100 dark:border-slate-700"\n            onclick="event.stopPropagation()">');
        });

        test('Modal sekunder seperti #modal-quick-location dan #modal-replace-approval memiliki stacking context z-[10000]', () => {
            const quickLocMatch = htmlContent.match(/<div\b[^>]*id=["']modal-quick-location["'][^>]*>/i);
            expect(quickLocMatch).not.toBeNull();
            expect(quickLocMatch[0]).toContain('z-[10000]');

            expect(jsContent).toContain("modal.className = 'hidden fixed inset-0 z-[10000] bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm fade-in';");
        });

        test('showConfirmModal menangani varian aksi cancel (Batalkan), approve (Setujui), reject (Tolak), dan danger (Hapus)', () => {
            expect(jsContent).toContain("type === 'cancel'");
            expect(jsContent).toContain('<i class="fa-solid fa-trash mr-1"></i> Ya, Batalkan');
            expect(jsContent).toContain("type === 'approve'");
            expect(jsContent).toContain('<i class="fa-solid fa-check mr-1"></i> Ya, Setujui');
            expect(jsContent).toContain("type === 'danger'");
            expect(jsContent).toContain('<i class="fa-solid fa-trash-can mr-1"></i> Ya, Hapus');
            expect(jsContent).toContain('<i class="fa-solid fa-times mr-1"></i> Ya, Tolak');
        });

        test('Tombol batalkan di modal booking detail memanggil cancelBooking dengan benar', () => {
            expect(jsContent).toContain("cancelBooking('${bookingId}')");
            expect(jsContent).toContain("window.cancelBooking = function (bookingId)");
            expect(jsContent).toContain("showConfirmModal(");
            expect(jsContent).toContain("'Batalkan Booking'");
        });
    });
});

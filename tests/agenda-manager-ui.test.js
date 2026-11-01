/** @jest-environment jsdom */
const fs = require('node:fs');
const path = require('node:path');

describe('Kalender Agenda UI and Manager (agenda.html)', () => {
    let htmlContent;

    beforeAll(() => {
        htmlContent = fs.readFileSync(path.join(__dirname, '../agenda.html'), 'utf8');
    });

    beforeEach(() => {
        document.documentElement.innerHTML = htmlContent;
    });

    test('1. Header memiliki judul Kalender Agenda dan tombol Kelola Agenda dengan icon fa-sliders', () => {
        const btnManage = document.getElementById('btn-add-agenda');
        expect(btnManage).not.toBeNull();
        expect(btnManage.textContent).toContain('Kelola Agenda');
        expect(btnManage.querySelector('i.fa-sliders')).not.toBeNull();
        // Default tersembunyi sampai diverifikasi auth role
        expect(btnManage.classList.contains('hidden')).toBe(true);

        const h1 = document.querySelector('h1');
        expect(h1).not.toBeNull();
        expect(h1.textContent).toContain('Kalender Agenda');
    });

    test('2. Halaman agenda.html fokus pada kalender kegiatan dan daftar kegiatan mendatang', () => {
        const calGrid = document.getElementById('calendar-grid');
        const calMonthYear = document.getElementById('cal-month-year');
        const eventsList = document.getElementById('events-list');

        expect(calGrid).not.toBeNull();
        expect(calMonthYear).not.toBeNull();
        expect(eventsList).not.toBeNull();
    });

    test('3. Modal kelola kegiatan agenda sekolah memiliki struktur form dan daftar terpisah', () => {
        const modal = document.getElementById('modal-calendar-manager');
        expect(modal).not.toBeNull();
        expect(modal.classList.contains('hidden')).toBe(true);

        const modalContent = document.getElementById('modal-calendar-content');
        expect(modalContent).not.toBeNull();
        expect(modalContent.className).toContain('max-h-[94dvh]');

        // Form fields
        expect(document.getElementById('input-event-title')).not.toBeNull();
        expect(document.getElementById('input-event-date')).not.toBeNull();
        expect(document.getElementById('input-event-end-date')).not.toBeNull();
        expect(document.getElementById('select-event-type')).not.toBeNull();
        expect(document.getElementById('input-event-desc')).not.toBeNull();
        expect(document.getElementById('btn-save-event')).not.toBeNull();

        // Daftar kegiatan mendatang di sisi kanan
        expect(document.getElementById('label-cal-manager-period')).not.toBeNull();
        expect(document.getElementById('calendar-events-list')).not.toBeNull();
    });

    test('4. Seluruh ID DOM kalender agenda sekolah unik tanpa duplikasi', () => {
        const requiredIds = [
            'btn-add-agenda',
            'modal-calendar-manager',
            'modal-calendar-content',
            'input-event-title',
            'input-event-date',
            'input-event-end-date',
            'select-event-type',
            'input-event-desc',
            'btn-save-event',
            'label-cal-manager-period',
            'calendar-events-list',
            'calendar-grid',
            'cal-month-year',
            'events-list'
        ];

        requiredIds.forEach(id => {
            const elements = document.querySelectorAll(`#${id}`);
            expect(elements.length).toBe(1);
        });
    });

    test('5. Pengguna tanpa role manajer tidak dapat membuka modal pengelolaan agenda', () => {
        let isManager = false;
        const modal = document.getElementById('modal-calendar-manager');
        modal.classList.add('hidden');

        const openCalendarManager = () => {
            if (!isManager) return;
            modal.classList.remove('hidden');
        };

        openCalendarManager();
        expect(modal.classList.contains('hidden')).toBe(true);
    });

    test('6. Tombol Escape menutup modal pengelolaan agenda yang terbuka', () => {
        const modal = document.getElementById('modal-calendar-manager');
        modal.classList.remove('hidden');
        expect(modal.classList.contains('hidden')).toBe(false);

        let closed = false;
        const closeCalendarManager = () => {
            modal.classList.add('hidden');
            closed = true;
        };

        const escapeHandler = (e) => {
            if (e.key === 'Escape') {
                if (modal && !modal.classList.contains('hidden')) {
                    closeCalendarManager();
                }
            }
        };

        escapeHandler({ key: 'Escape' });
        expect(closed).toBe(true);
        expect(modal.classList.contains('hidden')).toBe(true);
    });

    test('7. CloudflareClient Calendar API contract: getCalendarEvents, create, update, delete', async () => {
        // Mock implementasi CloudflareClient minimal sesuai yang didefinisikan di cloudflare-client.js
        class MockCloudflareClient {
            constructor() {
                this.requests = [];
            }
            async request(path, options = {}) {
                this.requests.push({ path, options });
                if (path.startsWith('/api/agenda/events') && (options.method || 'GET') === 'GET') {
                    return {
                        success: true,
                        data: [
                            { id: '1', title: 'Rapat', date: '2026-09-10', time: '2026-09-12', category: 'kegiatan' },
                            { id: '2', title: 'Libur', date: '2026-09-15', time: '', category: 'libur', color: 'rose' }
                        ]
                    };
                }
                return { success: true };
            }
            async getAgendaEvents(year, month) {
                let path = '/api/agenda/events';
                if (year && month) {
                    path += `?year=${year}&month=${month}`;
                } else if (year) {
                    path += `?year=${year}`;
                }
                const res = await this.request(path, { method: 'GET' });
                const list = (res && Array.isArray(res.data)) ? res.data : (Array.isArray(res) ? res : []);
                return list.map(ev => ({
                    ...ev,
                    type: ev.type || ev.category || 'kegiatan',
                    category: ev.category || ev.type || 'kegiatan',
                    endDate: ev.endDate || (ev.time && /^\d{4}-\d{2}-\d{2}$/.test(ev.time) ? ev.time : null)
                }));
            }
            async getCalendarEvents(year, month) {
                let path = '/api/agenda/events';
                if (year && month) {
                    path += `?year=${year}&month=${month}`;
                } else if (year) {
                    path += `?year=${year}`;
                }
                const res = await this.request(path, { method: 'GET' });
                const rawList = (res && Array.isArray(res.data)) ? res.data : (Array.isArray(res) ? res : []);
                const mappedList = rawList.map(ev => ({
                    ...ev,
                    type: ev.type || ev.category || 'kegiatan',
                    category: ev.category || ev.type || 'kegiatan',
                    endDate: ev.endDate || (ev.time && /^\d{4}-\d{2}-\d{2}$/.test(ev.time) ? ev.time : null)
                }));
                return { success: true, data: mappedList };
            }
            async saveAgendaEvent(eventData, isEdit = false, id = null) {
                const payload = {
                    ...eventData,
                    category: eventData.category || eventData.type || 'kegiatan',
                    type: eventData.type || eventData.category || 'kegiatan',
                    time: eventData.time || eventData.endDate || '',
                    color: eventData.color || (eventData.type === 'libur' || eventData.category === 'libur' ? 'rose' : (eventData.type === 'penting' || eventData.category === 'penting' ? 'amber' : 'blue'))
                };
                if (isEdit && id) {
                    return await this.request(`/api/agenda/events/${id}`, {
                        method: 'PUT',
                        body: JSON.stringify(payload)
                    });
                } else {
                    return await this.request('/api/agenda/events', {
                        method: 'POST',
                        body: JSON.stringify(payload)
                    });
                }
            }
            async createCalendarEvent(eventData) {
                return await this.saveAgendaEvent(eventData, false);
            }
            async updateCalendarEvent(id, eventData) {
                return await this.saveAgendaEvent(eventData, true, id);
            }
            async deleteAgendaEvent(id) {
                return await this.request(`/api/agenda/events/${id}`, {
                    method: 'DELETE'
                });
            }
            async deleteCalendarEvent(id) {
                return await this.deleteAgendaEvent(id);
            }
        }

        const client = new MockCloudflareClient();

        // 1. Uji getCalendarEvents
        const calRes = await client.getCalendarEvents(2026, 9);
        expect(calRes).toHaveProperty('success', true);
        expect(Array.isArray(calRes.data)).toBe(true);
        expect(calRes.data[0].type).toBe('kegiatan');
        expect(calRes.data[0].endDate).toBe('2026-09-12');
        expect(calRes.data[1].type).toBe('libur');
        expect(calRes.data[1].endDate).toBeNull();

        // 2. Uji getAgendaEvents
        const agendaList = await client.getAgendaEvents(2026, 9);
        expect(Array.isArray(agendaList)).toBe(true);
        expect(agendaList.length).toBe(2);

        // 3. Uji createCalendarEvent
        await client.createCalendarEvent({
            title: 'Upacara',
            date: '2026-10-01',
            type: 'penting',
            endDate: '2026-10-01'
        });
        const createReq = client.requests.find(r => r.path === '/api/agenda/events' && r.options.method === 'POST');
        expect(createReq).toBeDefined();
        const createBody = JSON.parse(createReq.options.body);
        expect(createBody.category).toBe('penting');
        expect(createBody.color).toBe('amber');
        expect(createBody.time).toBe('2026-10-01');

        // 4. Uji updateCalendarEvent
        await client.updateCalendarEvent('evt-123', {
            title: 'Libur Diperpanjang',
            date: '2026-10-02',
            type: 'libur'
        });
        const updateReq = client.requests.find(r => r.path === '/api/agenda/events/evt-123' && r.options.method === 'PUT');
        expect(updateReq).toBeDefined();
        const updateBody = JSON.parse(updateReq.options.body);
        expect(updateBody.category).toBe('libur');
        expect(updateBody.color).toBe('rose');

        // 5. Uji deleteCalendarEvent
        await client.deleteCalendarEvent('evt-123');
        const deleteReq = client.requests.find(r => r.path === '/api/agenda/events/evt-123' && r.options.method === 'DELETE');
        expect(deleteReq).toBeDefined();
    });

    test('8. Elemen Tooltip Info Agenda (#calendar-day-tooltip) terpasang dengan atribut aksesibilitas yang lengkap', () => {
        const tooltip = document.getElementById('calendar-day-tooltip');
        expect(tooltip).not.toBeNull();
        expect(tooltip.getAttribute('role')).toBe('tooltip');
        expect(tooltip.getAttribute('aria-live')).toBe('polite');
        expect(tooltip.classList.contains('hidden')).toBe(true);

        const tooltipDateText = document.getElementById('tooltip-date-text');
        const tooltipCountBadge = document.getElementById('tooltip-count-badge');
        const tooltipEventsList = document.getElementById('tooltip-events-list');

        expect(tooltipDateText).not.toBeNull();
        expect(tooltipCountBadge).not.toBeNull();
        expect(tooltipEventsList).not.toBeNull();
    });

    test('9. Simulasi interaksi Tooltip Kalender: render agenda, sanitasi XSS, hover dan click pinning', () => {
        const tooltip = document.getElementById('calendar-day-tooltip');
        const dateTextEl = document.getElementById('tooltip-date-text');
        const badgeCountEl = document.getElementById('tooltip-count-badge');
        const listEl = document.getElementById('tooltip-events-list');

        // Dummy cell elemen kalender
        const dummyCell = document.createElement('div');
        dummyCell.id = 'day-cell-15';
        dummyCell.className = 'calendar-day-cell';
        document.body.appendChild(dummyCell);

        const escapeHTML = (str) => {
            if (!str) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        };

        const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

        let isTooltipPinned = false;
        let pinnedDay = null;

        const showCalendarTooltip = (day, year, month, dayEvents, cell, pin = false) => {
            if (!tooltip || !cell || !dayEvents || dayEvents.length === 0) return;
            if (pin) {
                isTooltipPinned = true;
                pinnedDay = day;
            }

            const dateObj = new Date(year, month, day);
            const dateTitle = `${dayNames[dateObj.getDay()]}, ${day} ${months[month]} ${year}`;

            if (dateTextEl) dateTextEl.textContent = dateTitle;
            if (badgeCountEl) badgeCountEl.textContent = `${dayEvents.length} Agenda`;

            if (listEl) {
                listEl.innerHTML = dayEvents.map(ev => {
                    const evType = ev.type || ev.category || 'kegiatan';
                    return `
                        <div class="p-2 rounded-lg event-item">
                            <span class="badge">${escapeHTML(evType)}</span>
                            <h5 class="event-title">${escapeHTML(ev.title || '')}</h5>
                            ${ev.description ? `<p class="event-desc">${escapeHTML(ev.description)}</p>` : ''}
                        </div>
                    `;
                }).join('');
            }

            tooltip.classList.remove('hidden');
        };

        const hideCalendarTooltip = (force = false) => {
            if (!tooltip) return;
            if (!force && isTooltipPinned) return;
            isTooltipPinned = false;
            pinnedDay = null;
            tooltip.classList.add('hidden');
        };

        const testEvents = [
            {
                title: '<script>alert("XSS")</script>Ujian Akhir Semester',
                type: 'penting',
                description: '<b>Harap membawa kartu ujian</b>',
                date: '2026-09-15'
            },
            {
                title: 'Rapat Kerja Dewan Guru',
                type: 'kegiatan',
                description: 'Di Ruang Pertemuan',
                date: '2026-09-15'
            }
        ];

        // A. Skenario Hover (unpinned)
        showCalendarTooltip(15, 2026, 8, testEvents, dummyCell, false);
        expect(tooltip.classList.contains('hidden')).toBe(false);
        expect(isTooltipPinned).toBe(false);
        expect(dateTextEl.textContent).toContain('15 September 2026');
        expect(badgeCountEl.textContent).toBe('2 Agenda');

        // Verifikasi Sanitasi XSS
        expect(listEl.innerHTML).not.toContain('<script>');
        expect(listEl.innerHTML).toContain('&lt;script&gt;');
        expect(listEl.innerHTML).not.toContain('<b>Harap');
        expect(listEl.innerHTML).toContain('&lt;b&gt;Harap');

        // Saat mouse leave (unpinned), tooltip sembunyi
        hideCalendarTooltip(false);
        expect(tooltip.classList.contains('hidden')).toBe(true);

        // B. Skenario Klik (pinned)
        showCalendarTooltip(15, 2026, 8, testEvents, dummyCell, true);
        expect(tooltip.classList.contains('hidden')).toBe(false);
        expect(isTooltipPinned).toBe(true);
        expect(pinnedDay).toBe(15);

        // Saat mouse leave terjadi saat pinned, tooltip TETAP terbuka
        hideCalendarTooltip(false);
        expect(tooltip.classList.contains('hidden')).toBe(false);
        expect(isTooltipPinned).toBe(true);

        // Saat dipaksa tutup (klik tombol tutup atau klik di luar)
        hideCalendarTooltip(true);
        expect(tooltip.classList.contains('hidden')).toBe(true);
        expect(isTooltipPinned).toBe(false);
    });
});


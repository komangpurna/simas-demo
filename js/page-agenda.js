/**
 * SIMAS - Halaman Kalender Agenda (js/page-agenda.js)
 * Khusus menangani visualisasi kalender kegiatan sekolah dan pengelolaan agenda resmi
 */

import { auth } from './config.js';
import { cfClient } from './cloudflare-client.js';
import { initLayout } from './global.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { parseDate, formatYMD, escapeHTML, showConfirmModal } from './agenda-common.js';
import { upsertSchoolHoliday, deleteSchoolHoliday, bootstrapSyncAgendaHolidays } from './holiday-manager.js';

const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const dayNames = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

let calDate = new Date();
let calPeriodDate = new Date();
let calendarEvents = [];
let editingCalendarEventId = null;
let editingCalendarEventYear = null;
let editingCalendarEventMonth = null;
let isManager = false;
let previousActiveElement = null;

// State Libur Nasional (Default: Aktif, disimpan di localStorage)
let showNationalHolidays = typeof localStorage !== 'undefined' ? localStorage.getItem('simas_show_holidays') !== 'false' : true;

// State Tooltip Agenda Interaktif
let isTooltipPinned = false;
let pinnedDay = null;
let pinnedCell = null;

onAuthStateChanged(auth, async (user) => {
    if (user) {
        const role = localStorage.getItem('user_role');
        await initLayout(role);

        // Role yang berhak mengelola agenda kegiatan sekolah
        const managerRoles = ['super_admin', 'kepala_sekolah', 'wakasek_kurikulum', 'kesiswaan', 'kepala_lab'];
        isManager = managerRoles.some(r => window.hasRole(r));
        
        const btnManage = document.getElementById('btn-add-agenda');
        if (btnManage && isManager) {
            btnManage.classList.remove('hidden');
        }

        updateToggleHolidaysButton();
        renderCalendar();

        // Jalankan bootstrap sync lib_hari_libur satu kali di background jika belum pernah disinkronkan
        if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem('simas_holiday_sync_bootstrapped')) {
            bootstrapSyncAgendaHolidays().catch(e => console.warn('[Agenda] Gagal bootstrap sync lib_hari_libur:', e));
        }

        // Tampilkan konten utama
        const main = document.querySelector('main');
        if (main) {
            main.classList.remove('hidden');
        }
    } else {
        window.location.replace('index.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash));
    }
});

// =============================================
// SECTION: TOGGLE & PRESET LIBUR NASIONAL
// =============================================

window.toggleNationalHolidays = function() {
    showNationalHolidays = !showNationalHolidays;
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem('simas_show_holidays', showNationalHolidays ? 'true' : 'false');
    }
    updateToggleHolidaysButton();
    renderCalendar();
};

function updateToggleHolidaysButton() {
    const btn = document.getElementById('btn-toggle-holidays');
    const label = document.getElementById('label-toggle-holidays');
    if (!btn) return;
    if (showNationalHolidays) {
        btn.className = 'px-2.5 py-1 rounded-xl text-[11px] font-bold border transition-all flex items-center gap-1.5 bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/60 shadow-sm';
        btn.title = 'Libur nasional aktif (klik untuk sembunyikan)';
        if (label) label.textContent = 'Libur Nasional';
    } else {
        btn.className = 'px-2.5 py-1 rounded-xl text-[11px] font-bold border transition-all flex items-center gap-1.5 bg-slate-100 text-slate-400 border-slate-200 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-500 dark:border-slate-700 shadow-none';
        btn.title = 'Libur nasional nonaktif (klik untuk tampilkan)';
        if (label) label.textContent = 'Libur: Nonaktif';
    }
}

// =============================================
// SECTION: RENDER MAIN CALENDAR
// =============================================

window.changeMonth = (dir) => {
    calDate.setMonth(calDate.getMonth() + dir);
    renderCalendar();
};

async function renderCalendar() {
    hideCalendarTooltip(true);
    const year = calDate.getFullYear();
    const month = calDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();

    const elMonthYear = document.getElementById('cal-month-year');
    const elPeriod = document.getElementById('label-cal-period');
    if (elMonthYear) elMonthYear.textContent = `${months[month]} ${year}`;
    if (elPeriod) elPeriod.textContent = `${months[month]} ${year}`;

    const grid = document.getElementById('calendar-grid');
    if (!grid) return;
    grid.innerHTML = '';

    // Empty slots di awal bulan
    for (let i = 0; i < firstDay; i++) {
        grid.innerHTML += `<div class="py-2.5 sm:py-3 flex items-center justify-center rounded-xl text-base sm:text-lg invisible">0</div>`;
    }

    const today = new Date();
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

    for (let i = 1; i <= lastDate; i++) {
        const isToday = isCurrentMonth && today.getDate() === i;
        const dayOfWeek = new Date(year, month, i).getDay();
        const isSunday = dayOfWeek === 0;

        let dayClass = 'text-slate-700 dark:text-slate-300';
        if (isToday) {
            dayClass = 'bg-blue-600 text-white font-black shadow-lg shadow-blue-500/30';
        } else if (isSunday) {
            dayClass = 'text-rose-600 dark:text-rose-400 font-bold';
        }

        grid.innerHTML += `
            <div id="day-cell-${i}" class="relative py-2.5 sm:py-3 flex flex-col items-center justify-center rounded-xl text-xs sm:text-sm font-semibold transition-all hover:bg-blue-50 dark:hover:bg-slate-800 ${dayClass}">
                <span>${i}</span>
                <div class="dots-container flex gap-1 mt-1"></div>
            </div>
        `;
    }

    // Load Events untuk bulan yang sedang dilihat
    loadEvents(year, month);
}

async function loadEvents(year, month) {
    const eventsList = document.getElementById('events-list');
    if (eventsList) {
        eventsList.innerHTML = '<div class="text-center py-8 text-xs text-slate-400 font-medium">Memuat agenda...</div>';
    }

    try {
        let events = [];
        try {
            const res = await cfClient.getCalendarEvents(year, month + 1);
            events = (res && Array.isArray(res.data)) ? res.data : (Array.isArray(res) ? res : []);
        } catch (err) {
            console.warn('[Calendar] Gagal memuat dari Cloudflare D1:', err);
            events = [];
        }

        // Integrasikan Hari Libur Nasional resmi (SKB 3 Menteri) jika toggle aktif
        if (showNationalHolidays) {
            const dh = window.DataHolidays;
            if (dh && typeof dh.getNationalHolidays === 'function') {
                const natHolidays = dh.getNationalHolidays(year);
                const monthPadded = String(month + 1).padStart(2, '0');
                const prefix = `${year}-${monthPadded}-`;
                const monthHolidays = natHolidays.filter(h => h.date && h.date.startsWith(prefix));

                monthHolidays.forEach(h => {
                    const exists = events.some(e => {
                        const edStr = (e.date || '').substring(0, 10);
                        return edStr === h.date && (e.title || '').trim().toLowerCase() === h.title.trim().toLowerCase();
                    });
                    if (!exists) {
                        events.push(h);
                    }
                });
            }
        }

        // Urutkan seluruh event berdasarkan tanggal mulai
        events.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

        // Petakan agenda per tanggal di bulan ini
        const lastDate = new Date(year, month + 1, 0).getDate();
        const eventsByDay = {};
        for (let d = 1; d <= lastDate; d++) {
            const dStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            eventsByDay[d] = events.filter(ev => {
                const s = (ev.date || '').substring(0, 10);
                if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
                let e = ev.endDate ? String(ev.endDate).substring(0, 10) : s;
                if (!/^\d{4}-\d{2}-\d{2}$/.test(e) || e < s) e = s;
                return dStr >= s && dStr <= e;
            });
        }

        // Tampilkan events di sidebar kanan
        if (eventsList) {
            eventsList.innerHTML = '';
            if (events.length === 0) {
                eventsList.innerHTML = `
                    <div class="text-center py-10 opacity-40">
                        <i class="fa-regular fa-calendar-xmark text-3xl mb-2"></i>
                        <p class="text-xs font-bold uppercase">Tidak ada kegiatan</p>
                    </div>
                `;
            } else {
                events.forEach((ev, idx) => {
                    const evType = ev.type || ev.category || 'kegiatan';
                    let badgeColor = 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800';
                    let badgeLabel = escapeHTML(ev.type || ev.category || 'Kegiatan');

                    if (ev.isNationalHoliday) {
                        badgeColor = 'bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-900/30 dark:text-rose-400 dark:border-rose-800';
                        badgeLabel = ev.isCutiBersama ? 'Cuti Bersama' : 'Libur Nasional';
                    } else if (ev.color === 'rose' || evType === 'libur') {
                        badgeColor = 'bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-900/30 dark:text-rose-400 dark:border-rose-800';
                    } else if (ev.color === 'amber' || evType === 'penting') {
                        badgeColor = 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800';
                    }

                    let dateStr = '';
                    const d = parseDate(ev.date);
                    if (d) {
                        dateStr = `${d.getDate()} ${months[d.getMonth()]}`;
                    }
                    if (ev.endDate) {
                        const ed = parseDate(ev.endDate);
                        if (ed && d && ed.getTime() !== d.getTime()) {
                            dateStr += ` - ${ed.getDate()} ${months[ed.getMonth()]}`;
                        }
                    }

                    eventsList.innerHTML += `
                        <div id="agenda-card-${idx}" data-date="${ev.date || ''}" data-end-date="${ev.endDate || ev.date || ''}" class="p-3 rounded-xl border border-slate-100 dark:border-slate-800 hover:border-blue-200 dark:hover:border-slate-700 transition-all bg-slate-50/50 dark:bg-slate-800/40">
                            <div class="flex items-center justify-between gap-2 mb-1">
                                <span class="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wider border ${badgeColor}">
                                    ${badgeLabel}
                                </span>
                                <span class="text-[10px] font-bold text-slate-400">${dateStr}</span>
                            </div>
                            <h4 class="font-bold text-xs text-slate-800 dark:text-white">${escapeHTML(ev.title || '')}</h4>
                            ${ev.description ? `<p class="text-[11px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">${escapeHTML(ev.description)}</p>` : ''}
                        </div>
                    `;
                });
            }
        }

        const today = new Date();
        const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

        // Tandai dots di grid kalender dan pasang interaksi tooltip
        for (let day = 1; day <= lastDate; day++) {
            const cell = document.getElementById(`day-cell-${day}`);
            if (!cell) continue;

            const dayEvents = eventsByDay[day] || [];
            const dotsContainer = cell.querySelector('.dots-container');
            if (dotsContainer) dotsContainer.innerHTML = '';

            const isToday = isCurrentMonth && today.getDate() === day;
            const hasHoliday = dayEvents.some(ev => ev.category === 'libur' || ev.isNationalHoliday);

            // Aksen tanggal merah pada kalender jika ada libur nasional
            if (hasHoliday && !isToday) {
                // Warna teks libur menggantikan warna dasar (urutan CSS Tailwind build)
                cell.classList.remove('text-slate-700', 'dark:text-slate-300');
                cell.classList.add('text-rose-600', 'dark:text-rose-400', 'font-black', 'bg-rose-50/60', 'dark:bg-rose-950/20', 'border', 'border-rose-200/50', 'dark:border-rose-900/40');
            }

            if (dayEvents.length > 0) {
                if (dotsContainer) {
                    dayEvents.slice(0, 3).forEach(ev => {
                        const evType = ev.type || ev.category || 'kegiatan';
                        let dotColor = 'bg-blue-500';
                        if (ev.color === 'rose' || evType === 'libur' || ev.isNationalHoliday) dotColor = 'bg-rose-500';
                        if (ev.color === 'amber' || evType === 'penting') dotColor = 'bg-amber-500';

                        const dot = document.createElement('div');
                        dot.className = `w-1.5 h-1.5 rounded-full ${dotColor}`;
                        dotsContainer.appendChild(dot);
                    });
                }

                cell.classList.add('has-events', 'cursor-pointer', 'hover:ring-2', 'hover:ring-blue-400/50');
                cell.setAttribute('title', `${dayEvents.length} kegiatan agenda`);
                cell.setAttribute('aria-haspopup', 'dialog');
                cell.setAttribute('aria-label', `${day} ${months[month]} ${year}: ${dayEvents.length} agenda kegiatan`);

                cell.onmouseenter = () => {
                    if (!isTooltipPinned) {
                        showCalendarTooltip(day, year, month, dayEvents, cell, false);
                    }
                };

                cell.onmouseleave = () => {
                    if (!isTooltipPinned) {
                        hideCalendarTooltip(false);
                    }
                };

                cell.onclick = (e) => {
                    e.stopPropagation();
                    if (isTooltipPinned && pinnedDay === day) {
                        hideCalendarTooltip(true);
                    } else {
                        showCalendarTooltip(day, year, month, dayEvents, cell, true);
                        highlightSidebarEvents(day, year, month);
                    }
                };
            } else {
                cell.classList.remove('has-events', 'hover:ring-2', 'hover:ring-blue-400/50');
                cell.removeAttribute('title');
                cell.removeAttribute('aria-haspopup');
                cell.removeAttribute('aria-label');
                cell.onmouseenter = null;
                cell.onmouseleave = null;
                cell.onclick = () => {
                    if (isTooltipPinned) hideCalendarTooltip(true);
                };
            }
        }

    } catch (error) {
        console.error("Error loading events:", error);
        if (eventsList) {
            eventsList.innerHTML = '<div class="text-center py-8 text-xs text-rose-500 font-medium">Gagal memuat kegiatan</div>';
        }
    }
}

// =============================================
// SECTION: TOOLTIP AGENDA INTERAKTIF
// =============================================

function showCalendarTooltip(day, year, month, dayEvents, cell, pin = false) {
    const tooltip = document.getElementById('calendar-day-tooltip');
    if (!tooltip || !cell || !dayEvents || dayEvents.length === 0) return;

    if (pin) {
        isTooltipPinned = true;
        pinnedDay = day;
        pinnedCell = cell;
    }

    const dateObj = new Date(year, month, day);
    const dateTitle = `${dayNames[dateObj.getDay()]}, ${day} ${months[month]} ${year}`;

    const dateTextEl = document.getElementById('tooltip-date-text');
    const badgeCountEl = document.getElementById('tooltip-count-badge');
    const listEl = document.getElementById('tooltip-events-list');

    if (dateTextEl) dateTextEl.textContent = dateTitle;
    if (badgeCountEl) badgeCountEl.textContent = `${dayEvents.length} Agenda`;

    if (listEl) {
        listEl.innerHTML = dayEvents.map(ev => {
            const evType = ev.type || ev.category || 'kegiatan';
            let badgeClass = 'bg-blue-500/20 text-blue-300 border-blue-500/30';
            let badgeIcon = '<i class="fa-regular fa-calendar-check text-[10px]"></i>';
            let badgeLabel = escapeHTML(ev.type || ev.category || 'Kegiatan');

            if (ev.isNationalHoliday) {
                badgeClass = 'bg-rose-500/20 text-rose-300 border-rose-500/30';
                badgeIcon = '<i class="fa-solid fa-flag text-[10px] text-rose-400"></i>';
                badgeLabel = ev.isCutiBersama ? 'Cuti Bersama' : 'Libur Nasional';
            } else if (ev.color === 'rose' || evType === 'libur') {
                badgeClass = 'bg-rose-500/20 text-rose-300 border-rose-500/30';
                badgeIcon = '<i class="fa-solid fa-umbrella-beach text-[10px]"></i>';
            } else if (ev.color === 'amber' || evType === 'penting') {
                badgeClass = 'bg-amber-500/20 text-amber-300 border-amber-500/30';
                badgeIcon = '<i class="fa-solid fa-star text-[10px]"></i>';
            }

            let dateRangeText = '';
            const d = parseDate(ev.date);
            const ed = ev.endDate ? parseDate(ev.endDate) : null;
            if (ed && d && ed.getTime() !== d.getTime()) {
                dateRangeText = `<span class="text-[10px] text-slate-400 font-medium ml-auto shrink-0"><i class="fa-regular fa-clock text-[9px] mr-1"></i>${d.getDate()} ${months[d.getMonth()].substring(0, 3)} - ${ed.getDate()} ${months[ed.getMonth()].substring(0, 3)}</span>`;
            }

            return `
                <div class="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/60 hover:border-slate-600 transition-colors">
                    <div class="flex items-center gap-1.5 mb-1.5">
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold border uppercase tracking-wider flex items-center gap-1 ${badgeClass}">
                            ${badgeIcon} ${badgeLabel}
                        </span>
                        ${dateRangeText}
                    </div>
                    <h5 class="text-xs font-bold text-white leading-snug">${escapeHTML(ev.title || '')}</h5>
                    ${ev.description ? `<p class="text-[11px] text-slate-300 mt-1 leading-relaxed line-clamp-2">${escapeHTML(ev.description)}</p>` : ''}
                    ${ev.location ? `<div class="text-[10px] text-slate-400 flex items-center gap-1 mt-1.5"><i class="fa-solid fa-location-dot text-rose-400 text-[9px]"></i> <span class="truncate">${escapeHTML(ev.location)}</span></div>` : ''}
                </div>
            `;
        }).join('');
    }

    tooltip.classList.remove('hidden');
    positionTooltip(cell);

    requestAnimationFrame(() => {
        tooltip.classList.remove('opacity-0', 'scale-95');
        tooltip.classList.add('opacity-100', 'scale-100');
    });
}

function positionTooltip(cell) {
    const tooltip = document.getElementById('calendar-day-tooltip');
    if (!tooltip || !cell) return;

    const cellRect = cell.getBoundingClientRect();
    const tooltipWidth = tooltip.offsetWidth || 300;
    const tooltipHeight = tooltip.offsetHeight || 160;

    let left = cellRect.left + (cellRect.width / 2) - (tooltipWidth / 2);
    const margin = 12;
    if (left < margin) left = margin;
    if (left + tooltipWidth > window.innerWidth - margin) {
        left = window.innerWidth - tooltipWidth - margin;
    }

    let top;
    const gap = 8;
    if (cellRect.top - tooltipHeight - gap > margin) {
        top = cellRect.top - tooltipHeight - gap;
    } else {
        top = cellRect.bottom + gap;
    }

    if (top + tooltipHeight > window.innerHeight - margin) {
        top = window.innerHeight - tooltipHeight - margin;
    }
    if (top < margin) top = margin;

    tooltip.style.top = `${Math.round(top)}px`;
    tooltip.style.left = `${Math.round(left)}px`;
}

function hideCalendarTooltip(force = false) {
    const tooltip = document.getElementById('calendar-day-tooltip');
    if (!tooltip) return;
    if (!force && isTooltipPinned) return;

    isTooltipPinned = false;
    pinnedDay = null;
    pinnedCell = null;

    tooltip.classList.remove('opacity-100', 'scale-100');
    tooltip.classList.add('opacity-0', 'scale-95');
    setTimeout(() => {
        if (!isTooltipPinned && tooltip.classList.contains('opacity-0')) {
            tooltip.classList.add('hidden');
        }
    }, 150);
}

function highlightSidebarEvents(day, year, month) {
    const dayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const cards = document.querySelectorAll('#events-list [data-date]');
    let firstMatch = null;

    cards.forEach(card => {
        const s = (card.getAttribute('data-date') || '').substring(0, 10);
        const e = (card.getAttribute('data-end-date') || s).substring(0, 10);
        if (dayStr >= s && dayStr <= e) {
            if (!firstMatch) firstMatch = card;
            // Latar sorotan menggantikan latar dasar kartu (urutan CSS Tailwind build), lalu dipulihkan
            card.classList.remove('bg-slate-50/50', 'dark:bg-slate-800/40');
            card.classList.add('ring-2', 'ring-blue-500', 'bg-blue-50/90', 'dark:bg-blue-900/40');
            setTimeout(() => {
                card.classList.remove('ring-2', 'ring-blue-500', 'bg-blue-50/90', 'dark:bg-blue-900/40');
                card.classList.add('bg-slate-50/50', 'dark:bg-slate-800/40');
            }, 2000);
        }
    });

    if (firstMatch) {
        firstMatch.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

window.showCalendarTooltip = showCalendarTooltip;
window.hideCalendarTooltip = hideCalendarTooltip;

// Tutup tooltip saat klik di luar area kalender/tooltip
document.addEventListener('click', (e) => {
    const tooltip = document.getElementById('calendar-day-tooltip');
    if (!tooltip || tooltip.classList.contains('hidden')) return;
    if (!tooltip.contains(e.target) && !e.target.closest('.has-events')) {
        hideCalendarTooltip(true);
    }
});

// Sesuaikan posisi jika window digulir
window.addEventListener('scroll', () => {
    if (!isTooltipPinned) {
        hideCalendarTooltip(false);
    } else if (pinnedCell) {
        positionTooltip(pinnedCell);
    }
}, { passive: true });

// =============================================
// SECTION: MODAL KELOLA AGENDA KEGIATAN & PERIODIK
// =============================================

function initHolidayPresets() {
    const selectEl = document.getElementById('select-preset-holiday');
    if (!selectEl || selectEl.children.length > 1) return;
    const dh = window.DataHolidays;
    const presets = dh ? dh.getFixedAnnualObservances() : [];
    presets.forEach((p, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        const dStr = `${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')}`;
        opt.textContent = `${dStr} - ${p.title} (${p.isHoliday ? 'Libur' : 'Peringatan'})`;
        selectEl.appendChild(opt);
    });
}

window.applyHolidayPreset = function(presetIndex) {
    if (presetIndex === '' || presetIndex === null) return;
    const dh = window.DataHolidays;
    const presets = dh ? dh.getFixedAnnualObservances() : [];
    const item = presets[parseInt(presetIndex, 10)];
    if (!item) return;

    const inputTitle = document.getElementById('input-event-title');
    const inputDate = document.getElementById('input-event-date');
    const selectType = document.getElementById('select-event-type');
    const selectRepeat = document.getElementById('select-event-repeat');
    const inputDesc = document.getElementById('input-event-desc');

    if (inputTitle) inputTitle.value = item.title;
    if (selectType) selectType.value = item.category;

    const currentYear = calPeriodDate.getFullYear() || new Date().getFullYear();
    const mStr = String(item.month).padStart(2, '0');
    const dStr = String(item.day).padStart(2, '0');
    if (inputDate) inputDate.value = `${currentYear}-${mStr}-${dStr}`;

    if (inputDesc && !inputDesc.value) inputDesc.value = item.desc || '';

    // Otomatis aktifkan mode perulangan tahunan
    if (selectRepeat) {
        selectRepeat.value = 'yearly';
        window.onRepeatModeChange('yearly');
    }
};

window.onRepeatModeChange = function(mode) {
    const secPeriodic = document.getElementById('section-periodic-settings');
    const secPreview = document.getElementById('section-repeat-count-preview');
    const labelEstimate = document.getElementById('label-repeat-duration-estimate');

    if (mode === 'periodic') {
        if (secPeriodic) secPeriodic.classList.remove('hidden');
        if (secPreview) secPreview.classList.remove('hidden');
        if (labelEstimate) labelEstimate.textContent = 'Estimasi siklus interval hari';
    } else if (mode === 'yearly') {
        if (secPeriodic) secPeriodic.classList.add('hidden');
        if (secPreview) secPreview.classList.remove('hidden');
        if (labelEstimate) labelEstimate.textContent = 'Estimasi tahun ke depan';
    } else if (mode === 'monthly' || mode === 'weekly') {
        if (secPeriodic) secPeriodic.classList.add('hidden');
        if (secPreview) secPreview.classList.remove('hidden');
        if (labelEstimate) labelEstimate.textContent = 'Estimasi jadwal berulang';
    } else {
        if (secPeriodic) secPeriodic.classList.add('hidden');
        if (secPreview) secPreview.classList.remove('hidden');
    }
    window.updateRepeatPreview();
};

window.setRepeatIntervalPreset = function(days) {
    const inputInterval = document.getElementById('input-repeat-interval');
    if (inputInterval) {
        inputInterval.value = days;
        window.updateRepeatPreview();
    }
};

window.updateRepeatPreview = function() {
    const dateVal = document.getElementById('input-event-date')?.value;
    const repeatMode = document.getElementById('select-event-repeat')?.value || 'none';
    const countVal = parseInt(document.getElementById('input-repeat-count')?.value, 10) || 10;
    const intervalVal = parseInt(document.getElementById('input-repeat-interval')?.value, 10) || 210;
    const container = document.getElementById('container-repeat-preview');
    const badgeCount = document.getElementById('badge-preview-count');

    if (!container) return;

    if (repeatMode === 'none') {
        container.innerHTML = '<p class="text-slate-400 italic text-[10px]">Mode perulangan tidak aktif (hanya 1 agenda)</p>';
        if (badgeCount) badgeCount.textContent = '1 Tanggal';
        return;
    }

    if (!dateVal) {
        container.innerHTML = '<p class="text-slate-400 italic text-[10px]">Tentukan tanggal mulai untuk melihat pratinjau</p>';
        if (badgeCount) badgeCount.textContent = '0 Tanggal';
        return;
    }

    let generated = [];
    const dh = window.DataHolidays;

    if (repeatMode === 'periodic') {
        generated = dh ? dh.generatePeriodicDates(dateVal, intervalVal, countVal) : [];
    } else if (repeatMode === 'yearly') {
        generated = dh ? dh.generateYearlyDates(dateVal, countVal) : [];
    } else if (repeatMode === 'monthly') {
        const [by, bm, bd] = dateVal.split('-').map(Number);
        for (let i = 0; i < countVal; i++) {
            const dt = new Date(Date.UTC(by, bm - 1 + i, bd, 12, 0, 0));
            const y = dt.getUTCFullYear();
            const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
            const d = String(dt.getUTCDate()).padStart(2, '0');
            generated.push({ index: i + 1, date: `${y}-${m}-${d}`, dayName: dayNames[dt.getUTCDay()] });
        }
    } else if (repeatMode === 'weekly') {
        generated = dh ? dh.generatePeriodicDates(dateVal, 7, countVal) : [];
    }

    if (badgeCount) badgeCount.textContent = `${generated.length} Tanggal`;

    if (generated.length === 0) {
        container.innerHTML = '<p class="text-rose-400 text-[10px]">Tanggal mulai tidak valid</p>';
        return;
    }

    container.innerHTML = generated.map(g => {
        const dObj = parseDate(g.date);
        const formatted = dObj ? `${dObj.getDate()} ${months[dObj.getMonth()]} ${dObj.getFullYear()}` : g.date;
        const extra = g.offsetDays !== undefined ? `<span class="text-[9px] text-slate-400">+${g.offsetDays} hr</span>` : '';
        return `
            <div class="flex items-center justify-between py-0.5 border-b border-slate-100 dark:border-slate-800 last:border-0 text-[10px]">
                <span><strong>#${g.index}.</strong> ${g.dayName || ''}, ${formatted}</span>
                ${extra}
            </div>
        `;
    }).join('');
};

window.openCalendarManager = function() {
    if (!isManager) {
        if (window.showToast) window.showToast('Anda tidak memiliki izin mengelola agenda.', 'error');
        return;
    }

    const modal = document.getElementById('modal-calendar-manager');
    const content = document.getElementById('modal-calendar-content');
    if (!modal || !content) return;

    previousActiveElement = document.activeElement;

    // Sinkronisasi bulan kalender manager dengan kalender utama
    calPeriodDate = new Date(calDate.getFullYear(), calDate.getMonth(), 1);

    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    requestAnimationFrame(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    });

    initHolidayPresets();
    window.cancelEditCalendarEvent();
    window.loadCalendarEvents(0);

    const closeBtn = modal.querySelector('button[aria-label="Tutup modal"]');
    if (closeBtn && typeof closeBtn.focus === 'function') {
        closeBtn.focus();
    }
};

window.closeCalendarManager = function() {
    const modal = document.getElementById('modal-calendar-manager');
    const content = document.getElementById('modal-calendar-content');
    if (!modal || !content) return;

    content.classList.remove('scale-100', 'opacity-100');
    content.classList.add('scale-95', 'opacity-0');

    setTimeout(() => {
        modal.classList.add('hidden');
        document.body.style.overflow = '';
        if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
            previousActiveElement.focus();
        }
    }, 200);

    renderCalendar();
};

window.loadCalendarEvents = async function(dir) {
    if (dir !== 0) {
        calPeriodDate.setMonth(calPeriodDate.getMonth() + dir);
    }
    const year = calPeriodDate.getFullYear();
    const monthIndex = calPeriodDate.getMonth();

    const periodLabel = document.getElementById('label-cal-manager-period');
    if (periodLabel) periodLabel.textContent = `${months[monthIndex]} ${year}`;

    const list = document.getElementById('calendar-events-list');
    if (!list) return;

    list.innerHTML = `
        <div class="text-center py-10 opacity-40">
            <i class="fa-solid fa-spinner fa-spin text-2xl mb-2 text-blue-500"></i>
            <p class="text-xs font-bold uppercase">Memuat Agenda...</p>
        </div>
    `;

    try {
        let events = [];
        try {
            const res = await cfClient.getCalendarEvents(year, monthIndex + 1);
            events = (res && Array.isArray(res.data)) ? res.data : (Array.isArray(res) ? res : []);
        } catch (e) {
            console.warn('[Calendar Manager] Gagal memuat dari D1:', e);
            events = [];
        }

        calendarEvents = events;

        if (calendarEvents.length === 0) {
            list.innerHTML = `
                <div class="text-center py-12 bg-slate-50 dark:bg-slate-900/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
                    <i class="fa-regular fa-calendar-xmark text-3xl mb-2 text-slate-300 dark:text-slate-600"></i>
                    <p class="text-xs font-bold text-slate-400">Belum ada agenda pada bulan ini</p>
                </div>
            `;
            return;
        }

        list.innerHTML = calendarEvents.map(ev => {
            const evType = ev.type || ev.category || 'kegiatan';
            let colorBg = 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400';
            if (ev.color === 'rose' || evType === 'libur') colorBg = 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400';
            if (ev.color === 'amber' || evType === 'penting') colorBg = 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400';

            const d = parseDate(ev.date);
            const ed = ev.endDate ? parseDate(ev.endDate) : null;
            let dateBadge = d ? `${d.getDate()} ${months[d.getMonth()]}` : '';
            if (ed && d && ed.getTime() !== d.getTime()) {
                dateBadge += ` - ${ed.getDate()} ${months[ed.getMonth()]}`;
            }

            const isSeries = Boolean((ev.description || '').match(/\[series:(rec_[a-zA-Z0-9_]+)\]/));

            return `
                <div class="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-700/70 hover:border-blue-300 transition-all flex items-start justify-between gap-3 group shadow-xs">
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2 mb-1 flex-wrap">
                            <span class="px-2 py-0.5 rounded-md text-[10px] font-bold ${colorBg}">
                                ${ev.type || ev.category || 'Kegiatan'}
                            </span>
                            ${isSeries ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-300 border border-purple-200 dark:border-purple-800" title="Kegiatan Berulang Periodik"><i class="fa-solid fa-arrows-rotate mr-0.5"></i> Periodik</span>` : ''}
                            <span class="text-[10px] font-bold text-slate-400">
                                <i class="fa-regular fa-calendar text-[9px]"></i> ${dateBadge}
                            </span>
                        </div>
                        <h5 class="text-xs font-bold text-slate-800 dark:text-white truncate">${ev.title || ''}</h5>
                        ${ev.description ? `<p class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">${escapeHTML((ev.description || '').replace(/\[series:[^\]]+\]/g, '').trim())}</p>` : ''}
                    </div>
                    <div class="flex items-center gap-1 shrink-0">
                        <button onclick="window.editCalendarEvent('${ev.id}')" class="w-7 h-7 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-slate-800 transition-all flex items-center justify-center text-xs" title="Edit Agenda">
                            <i class="fa-solid fa-pen"></i>
                        </button>
                        <button onclick="window.deleteCalendarEvent('${ev.id}')" class="w-7 h-7 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-800 transition-all flex items-center justify-center text-xs" title="Hapus Agenda">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

    } catch (err) {
        console.error("Error loading events in manager:", err);
        list.innerHTML = `
            <div class="text-center py-10 text-rose-500 text-xs">
                <i class="fa-solid fa-triangle-exclamation text-xl mb-1"></i>
                <p>Gagal memuat agenda</p>
            </div>
        `;
    }
};

window.editCalendarEvent = function(id) {
    const ev = calendarEvents.find(e => e.id === id);
    if (!ev) return;

    editingCalendarEventId = id;
    const d = parseDate(ev.date);
    if (d) {
        editingCalendarEventYear = d.getFullYear();
        editingCalendarEventMonth = d.getMonth() + 1;
    } else {
        editingCalendarEventYear = calPeriodDate.getFullYear();
        editingCalendarEventMonth = calPeriodDate.getMonth() + 1;
    }

    const inputTitle = document.getElementById('input-event-title');
    const inputDate = document.getElementById('input-event-date');
    const inputEndDate = document.getElementById('input-event-end-date');
    const selectType = document.getElementById('select-event-type');
    const inputDesc = document.getElementById('input-event-desc');
    const formTitle = document.getElementById('agenda-form-title');
    const saveBtn = document.getElementById('btn-save-event');
    const selectRepeat = document.getElementById('select-event-repeat');
    const selectPreset = document.getElementById('select-preset-holiday');

    if (inputTitle) inputTitle.value = ev.title || '';
    if (inputDate) inputDate.value = formatYMD(ev.date);
    if (inputEndDate) inputEndDate.value = ev.endDate ? formatYMD(ev.endDate) : '';
    if (selectType) selectType.value = ev.type || ev.category || 'kegiatan';
    if (inputDesc) inputDesc.value = (ev.description || '').replace(/\[series:[^\]]+\]/g, '').trim();

    // Saat mengedit 1 event, kunci mode perulangan pada 'none'
    if (selectRepeat) {
        selectRepeat.value = 'none';
        window.onRepeatModeChange('none');
    }
    if (selectPreset) selectPreset.value = '';

    if (formTitle) formTitle.textContent = 'Edit Agenda';
    if (saveBtn) {
        saveBtn.textContent = 'Perbarui Agenda';
        saveBtn.classList.remove('bg-emerald-600', 'hover:bg-emerald-700');
        saveBtn.classList.add('bg-blue-600', 'hover:bg-blue-700');
    }
};

window.cancelEditCalendarEvent = function() {
    editingCalendarEventId = null;
    editingCalendarEventYear = null;
    editingCalendarEventMonth = null;

    const inputTitle = document.getElementById('input-event-title');
    const inputDate = document.getElementById('input-event-date');
    const inputEndDate = document.getElementById('input-event-end-date');
    const selectType = document.getElementById('select-event-type');
    const inputDesc = document.getElementById('input-event-desc');
    const formTitle = document.getElementById('agenda-form-title');
    const saveBtn = document.getElementById('btn-save-event');
    const selectRepeat = document.getElementById('select-event-repeat');
    const selectPreset = document.getElementById('select-preset-holiday');

    if (inputTitle) inputTitle.value = '';
    const todayStr = formatYMD(new Date());
    if (inputDate) inputDate.value = todayStr;
    if (inputEndDate) inputEndDate.value = '';
    if (selectType) selectType.value = 'kegiatan';
    if (inputDesc) inputDesc.value = '';

    if (selectRepeat) {
        selectRepeat.value = 'none';
        window.onRepeatModeChange('none');
    }
    if (selectPreset) selectPreset.value = '';

    if (formTitle) formTitle.textContent = 'Tambah Agenda Baru';
    if (saveBtn) {
        saveBtn.textContent = 'Simpan Agenda';
        saveBtn.classList.remove('bg-blue-600', 'hover:bg-blue-700');
        saveBtn.classList.add('bg-emerald-600', 'hover:bg-emerald-700');
    }
};

/**
 * Helper untuk memeriksa apakah suatu tanggal masih dicakup oleh hari libur nasional resmi (DataHolidays)
 * atau event agenda kategori libur lainnya yang masih aktif di calendarEvents.
 */
function isDateCoveredByOtherHolidayEvent(d, excludeId = null, excludeSeriesId = null) {
    const dh = typeof window !== 'undefined' ? window.DataHolidays : null;
    if (dh && typeof dh.isNationalHoliday === 'function' && dh.isNationalHoliday(d)) {
        return true;
    }
    if (!Array.isArray(calendarEvents)) return false;
    return calendarEvents.some(ev => {
        if (!ev) return false;
        if (excludeId !== null && String(ev.id) === String(excludeId)) return false;
        if (excludeSeriesId && (ev.description || '').includes(`[series:${excludeSeriesId}]`)) return false;
        const cat = (ev.category || ev.type || '').toLowerCase();
        if (cat !== 'libur') return false;
        const s = ev.date;
        const e = ev.endDate || (ev.time && /^\d{4}-\d{2}-\d{2}/.test(ev.time) ? ev.time : null);
        if (!s) return false;
        if (e && e > s) {
            return d >= s && d <= e;
        }
        return d === s;
    });
}
if (typeof window !== 'undefined') {
    window.isDateCoveredByOtherHolidayEvent = isDateCoveredByOtherHolidayEvent;
}

window.saveCalendarEvent = async function() {
    const title = document.getElementById('input-event-title')?.value.trim();
    const date = document.getElementById('input-event-date')?.value;
    const endDate = document.getElementById('input-event-end-date')?.value || null;
    const type = document.getElementById('select-event-type')?.value || 'kegiatan';
    const desc = document.getElementById('input-event-desc')?.value.trim();
    const repeatMode = document.getElementById('select-event-repeat')?.value || 'none';
    const repeatInterval = parseInt(document.getElementById('input-repeat-interval')?.value, 10) || 210;
    const repeatCount = parseInt(document.getElementById('input-repeat-count')?.value, 10) || 10;

    if (!title) {
        if (window.showToast) window.showToast('Judul kegiatan wajib diisi', 'warning');
        return;
    }
    if (!date) {
        if (window.showToast) window.showToast('Tanggal mulai wajib diisi', 'warning');
        return;
    }
    if (endDate && endDate < date) {
        if (window.showToast) window.showToast('Tanggal selesai tidak boleh lebih awal dari tanggal mulai', 'warning');
        return;
    }

    const saveBtn = document.getElementById('btn-save-event');
    const origText = saveBtn ? saveBtn.textContent : '';
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
    }

    try {
        const payload = {
            title,
            date,
            endDate,
            time: endDate || '',
            type,
            category: type,
            description: desc,
            color: type === 'libur' ? 'rose' : (type === 'penting' ? 'amber' : 'blue')
        };

        let dateSeries = [];
        if (editingCalendarEventId) {
            await cfClient.updateCalendarEvent(editingCalendarEventId, payload);
            try {
                if (typeof cfClient.queueAgendaNotification === 'function') {
                    await cfClient.queueAgendaNotification({
                        eventId: editingCalendarEventId,
                        title,
                        changeType: 'updated'
                    });
                }
            } catch (qErr) {
                console.warn('[Agenda Notification] Gagal memasukkan antrean pembaruan agenda:', qErr);
            }
            if (window.showToast) window.showToast('Agenda berhasil diperbarui', 'success');
        } else {
            // Pembuatan Agenda Baru: Cek apakah periodik / berulang
            if (repeatMode !== 'none') {
                const dh = window.DataHolidays;
                if (repeatMode === 'periodic') {
                    dateSeries = dh ? dh.generatePeriodicDates(date, repeatInterval, repeatCount) : [];
                } else if (repeatMode === 'yearly') {
                    dateSeries = dh ? dh.generateYearlyDates(date, repeatCount) : [];
                } else if (repeatMode === 'monthly') {
                    const [by, bm, bd] = date.split('-').map(Number);
                    for (let i = 0; i < repeatCount; i++) {
                        const dt = new Date(Date.UTC(by, bm - 1 + i, bd, 12, 0, 0));
                        const y = dt.getUTCFullYear();
                        const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
                        const d = String(dt.getUTCDate()).padStart(2, '0');
                        dateSeries.push({ index: i + 1, date: `${y}-${m}-${d}` });
                    }
                } else if (repeatMode === 'weekly') {
                    dateSeries = dh ? dh.generatePeriodicDates(date, 7, repeatCount) : [];
                }

                if (dateSeries.length > 0) {
                    const seriesId = `rec_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
                    const seriesTag = `[series:${seriesId}]`;
                    const fullDesc = desc ? `${desc}\n${seriesTag}` : seriesTag;

                    const batchList = dateSeries.map(item => {
                        const itemEndDate = endDate ? (dh ? dh.calculateRecurrenceEndDate(date, endDate, item.date) : item.date) : null;
                        return {
                            title,
                            date: item.date,
                            endDate: itemEndDate,
                            time: itemEndDate || '',
                            type,
                            category: type,
                            description: fullDesc,
                            color: type === 'libur' ? 'rose' : (type === 'penting' ? 'amber' : 'blue')
                        };
                    });

                    await cfClient.createCalendarEventsBatch(batchList);
                    if (window.showToast) window.showToast(`Berhasil menjadwalkan ${batchList.length} agenda kegiatan secara periodik`, 'success');
                } else {
                    await cfClient.createCalendarEvent(payload);
                    if (window.showToast) window.showToast('Agenda berhasil ditambahkan', 'success');
                }
            } else {
                const createRes = await cfClient.createCalendarEvent(payload);
                const eventId = createRes?.id || createRes?.data?.id || `agenda_${Date.now()}`;
                try {
                    if (typeof cfClient.queueAgendaNotification === 'function') {
                        await cfClient.queueAgendaNotification({
                            eventId,
                            title,
                            changeType: 'created'
                        });
                    }
                } catch (qErr) {
                    console.warn('[Agenda Notification] Gagal memasukkan antrean agenda baru:', qErr);
                }
                if (window.showToast) window.showToast('Agenda berhasil ditambahkan', 'success');
            }
        }

        // Hitung seluruh tanggal libur baru yang akan didaftarkan jika kategori libur
        const newHolidayDates = [];
        if (type === 'libur') {
            const dh = window.DataHolidays;
            if (repeatMode !== 'none' && Array.isArray(dateSeries) && dateSeries.length > 0) {
                for (const item of dateSeries) {
                    const itemEndDate = endDate ? (dh ? dh.calculateRecurrenceEndDate(date, endDate, item.date) : item.date) : null;
                    if (itemEndDate && itemEndDate > item.date) {
                        let cur = new Date(item.date + 'T00:00:00Z');
                        const last = new Date(itemEndDate + 'T00:00:00Z');
                        while (cur <= last) {
                            newHolidayDates.push(cur.toISOString().split('T')[0]);
                            cur.setUTCDate(cur.getUTCDate() + 1);
                        }
                    } else {
                        newHolidayDates.push(item.date);
                    }
                }
            } else if (endDate && endDate > date) {
                let cur = new Date(date + 'T00:00:00Z');
                const last = new Date(endDate + 'T00:00:00Z');
                while (cur <= last) {
                    newHolidayDates.push(cur.toISOString().split('T')[0]);
                    cur.setUTCDate(cur.getUTCDate() + 1);
                }
            } else {
                newHolidayDates.push(date);
            }
        }

        // Sinkronisasi otomatis dua arah ke public.lib_hari_libur Supabase
        const prevEv = editingCalendarEventId ? calendarEvents.find(x => String(x.id) === String(editingCalendarEventId)) : null;
        if (prevEv && (prevEv.category === 'libur' || prevEv.type === 'libur')) {
            const oldHolidayDates = [];
            const pStart = prevEv.date;
            const pEnd = prevEv.endDate || (prevEv.time && /^\d{4}-\d{2}-\d{2}/.test(prevEv.time) ? prevEv.time : null);
            if (pStart) {
                if (pEnd && pEnd > pStart) {
                    let cur = new Date(pStart + 'T00:00:00Z');
                    const last = new Date(pEnd + 'T00:00:00Z');
                    while (cur <= last) {
                        oldHolidayDates.push(cur.toISOString().split('T')[0]);
                        cur.setUTCDate(cur.getUTCDate() + 1);
                    }
                } else {
                    oldHolidayDates.push(pStart);
                }
            }

            const rawDatesToDelete = type === 'libur'
                ? oldHolidayDates.filter(d => !newHolidayDates.includes(d))
                : oldHolidayDates;
            const datesToDelete = rawDatesToDelete.filter(d => !isDateCoveredByOtherHolidayEvent(d, editingCalendarEventId));
            for (const d of datesToDelete) {
                try { await deleteSchoolHoliday(d); } catch (e) {}
            }
        }

        if (type === 'libur') {
            for (const d of newHolidayDates) {
                try {
                    await upsertSchoolHoliday(d, title);
                } catch (hErr) {
                    console.warn('[Agenda Sync] Gagal upsert ke lib_hari_libur:', hErr);
                }
            }
        }

        if (typeof window.invalidateSystemConfig === 'function') {
            window.invalidateSystemConfig();
        }

        window.cancelEditCalendarEvent();

        // Arahkan periode ke bulan kegiatan yang baru disimpan
        const eventDateObj = parseDate(date);
        if (eventDateObj) {
            calPeriodDate = new Date(eventDateObj.getFullYear(), eventDateObj.getMonth(), 1);
        }

        await window.loadCalendarEvents(0);

    } catch (err) {
        console.error("Error saving calendar event:", err);
        if (window.showToast) window.showToast('Gagal menyimpan agenda: ' + (err.message || err), 'error');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = origText;
        }
    }
};

window.deleteCalendarEvent = async function(id) {
    const ev = calendarEvents.find(e => String(e.id) === String(id));
    const title = ev ? `"${ev.title}"` : 'kegiatan ini';

    // Cek apakah kegiatan ini merupakan bagian dari rangkaian periodik
    const seriesMatch = (ev?.description || '').match(/\[series:(rec_[a-zA-Z0-9_]+)\]/);
    const seriesId = seriesMatch ? seriesMatch[1] : null;

    if (seriesId) {
        const choice = await showConfirmModal(
            `Agenda ${title} merupakan bagian dari jadwal kegiatan periodik. Apakah Anda ingin menghapus SELURUH rangkaian kegiatan periodik ini? (Pilih Batal jika ingin menghapus hanya tanggal ini)`,
            'Hapus Rangkaian Periodik?',
            'danger'
        );

        if (choice) {
            try {
                if (editingCalendarEventId === id) window.cancelEditCalendarEvent();
                await cfClient.deleteCalendarEvent(id, seriesId);
                // Sinkronisasi hapus hari libur untuk seluruh rangkaian
                if (ev && (ev.category === 'libur' || ev.type === 'libur')) {
                    const seriesEvents = calendarEvents.filter(e => (e?.description || '').includes(`[series:${seriesId}]`));
                    for (const sev of seriesEvents) {
                        const sevStart = sev.date;
                        const sevEnd = sev.endDate || (sev.time && /^\d{4}-\d{2}-\d{2}/.test(sev.time) ? sev.time : null);
                        if (sevStart) {
                            if (sevEnd && sevEnd > sevStart) {
                                let cur = new Date(sevStart + 'T00:00:00Z');
                                const last = new Date(sevEnd + 'T00:00:00Z');
                                while (cur <= last) {
                                    const dStr = cur.toISOString().split('T')[0];
                                    if (!isDateCoveredByOtherHolidayEvent(dStr, id, seriesId)) {
                                        try { await deleteSchoolHoliday(dStr); } catch (e) {}
                                    }
                                    cur.setUTCDate(cur.getUTCDate() + 1);
                                }
                            } else {
                                if (!isDateCoveredByOtherHolidayEvent(sevStart, id, seriesId)) {
                                    try { await deleteSchoolHoliday(sevStart); } catch (e) {}
                                }
                            }
                        }
                    }
                }
                if (window.showToast) window.showToast('Seluruh rangkaian agenda periodik berhasil dihapus', 'success');
                if (typeof window.invalidateSystemConfig === 'function') window.invalidateSystemConfig();
                await window.loadCalendarEvents(0);
                return;
            } catch (err) {
                console.error("Error deleting series:", err);
                if (window.showToast) window.showToast('Gagal menghapus rangkaian agenda: ' + (err.message || err), 'error');
                return;
            }
        }
    }

    const ok = await showConfirmModal(
        `Apakah Anda yakin ingin menghapus agenda ${title}?`,
        'Hapus Agenda',
        'danger'
    );
    if (!ok) return;

    try {
        if (editingCalendarEventId === id) {
            window.cancelEditCalendarEvent();
        }

        await cfClient.deleteCalendarEvent(id);

        // Sinkronisasi hapus dari public.lib_hari_libur jika event kategori libur
        if (ev && (ev.category === 'libur' || ev.type === 'libur')) {
            const evStart = ev.date;
            const evEnd = ev.endDate || (ev.time && /^\d{4}-\d{2}-\d{2}/.test(ev.time) ? ev.time : null);
            if (evStart) {
                if (evEnd && evEnd > evStart) {
                    let cur = new Date(evStart + 'T00:00:00Z');
                    const last = new Date(evEnd + 'T00:00:00Z');
                    while (cur <= last) {
                        const dStr = cur.toISOString().split('T')[0];
                        if (!isDateCoveredByOtherHolidayEvent(dStr, id)) {
                            try { await deleteSchoolHoliday(dStr); } catch (e) {}
                        }
                        cur.setUTCDate(cur.getUTCDate() + 1);
                    }
                } else {
                    if (!isDateCoveredByOtherHolidayEvent(evStart, id)) {
                        try { await deleteSchoolHoliday(evStart); } catch (e) {}
                    }
                }
            }
        }
        try {
            if (typeof cfClient.queueAgendaNotification === 'function') {
                await cfClient.queueAgendaNotification({
                    eventId: id,
                    title: ev?.title || 'Agenda',
                    changeType: 'deleted'
                });
            }
        } catch (qErr) {
            console.warn('[Agenda Notification] Gagal memasukkan antrean hapus agenda:', qErr);
        }
        if (window.showToast) window.showToast('Agenda berhasil dihapus', 'success');

        if (typeof window.invalidateSystemConfig === 'function') {
            window.invalidateSystemConfig();
        }

        await window.loadCalendarEvents(0);

    } catch (err) {
        console.error("Error deleting calendar event:", err);
        if (window.showToast) window.showToast('Gagal menghapus agenda: ' + (err.message || err), 'error');
    }
};

// Keyboard escape handler
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const modal = document.getElementById('modal-calendar-manager');
        if (modal && !modal.classList.contains('hidden')) {
            window.closeCalendarManager();
        }
    }
});

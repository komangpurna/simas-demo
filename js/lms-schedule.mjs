// Jadwal sekolah selalu WITA, termasuk saat perangkat memakai zona waktu lain.
export function normalizeLmsScheduleTime(value, allowDateOnly = false) {
    const raw = String(value || '').trim();
    if (allowDateOnly && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return normalizeLmsScheduleTime(`${raw}T23:59:59.999+08:00`);
    }
    const match = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/i);
    if (!match || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4] || 0) > 59) return '';
    const calendarDate = new Date(`${match[1]}T00:00:00Z`);
    if (!Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== match[1]) return '';
    const date = new Date(match[5] ? raw : `${raw}+08:00`);
    return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

export function validateLmsSchedule(opensAt, closesAt) {
    const publish_at = normalizeLmsScheduleTime(opensAt);
    const due_date = normalizeLmsScheduleTime(closesAt);
    if (!publish_at) throw new Error('Tanggal dan waktu buka modul wajib diisi dengan benar (WITA).');
    if (!due_date) throw new Error('Tanggal dan waktu target selesai wajib diisi dengan benar (WITA).');
    if (Date.parse(due_date) <= Date.parse(publish_at)) throw new Error('Target selesai harus setelah waktu buka.');
    return { publish_at, due_date };
}

export function formatLmsScheduleTime(value) {
    const normalized = normalizeLmsScheduleTime(value, true);
    if (!normalized) return '-';
    try {
        const d = new Date(normalized);
        if (!Number.isFinite(d.getTime())) return '-';
        return new Intl.DateTimeFormat('id-ID', {
            timeZone: 'Asia/Makassar', day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
        }).format(d) + ' WITA';
    } catch {
        return '-';
    }
}

export function getLmsScheduleState(material, now = Date.now()) {
    const status = Number(material?.is_published ?? 1);
    const opensAt = normalizeLmsScheduleTime(material?.publish_at);
    const closesAt = normalizeLmsScheduleTime(material?.due_date, true);
    let state = 'open';
    if (status === 0) state = 'draft';
    else if (![1, 2].includes(status) || (status === 2 && !opensAt) || (material?.due_date && !closesAt)) state = 'invalid';
    else if (status === 2 && now < Date.parse(opensAt)) state = 'scheduled';
    const manual = Number(material?.is_teaching_completed) === 1 && material?.teaching_status_source !== 'deadline';
    const manualTime = normalizeLmsActivityTime(material?.teaching_completed_at || material?.updated_at || material?.created_at);
    const cutoffs = [closesAt, manual ? manualTime : ''].filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b));
    const cutoffAt = cutoffs[0] || '';
    const teachingCompleted = state === 'open' && (manual || Boolean(closesAt && now >= Date.parse(closesAt)));
    if (teachingCompleted) state = 'review';
    const message = state === 'scheduled' ? `Modul dibuka pada ${formatLmsScheduleTime(opensAt)}.`
        : state === 'invalid' ? 'Jadwal modul belum valid. Hubungi guru pengampu.'
        : state === 'draft' ? 'Modul belum dipublikasikan.' : '';
    return { state, opensAt, closesAt, message, isAccessible: state === 'open' || state === 'review',
        teachingCompleted, cutoffAt, teachingSource: teachingCompleted ? (closesAt && cutoffAt === closesAt ? 'deadline' : 'manual') : '' };
}

// Old D1 timestamps without a timezone are UTC, never the browser's local zone.
export function normalizeLmsActivityTime(value) {
    let raw = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)) raw = raw.replace(' ', 'T') + 'Z';
    return normalizeLmsScheduleTime(raw);
}

export function decorateLmsTeachingState(material, now = Date.now()) {
    const schedule = getLmsScheduleState(material, now);
    return { ...material, is_teaching_completed: schedule.teachingCompleted ? 1 : Number(material.is_teaching_completed) || 0,
        teaching_completed_at: schedule.teachingCompleted ? schedule.cutoffAt : material.teaching_completed_at || '',
        teaching_status_source: schedule.teachingSource, schedule_state: schedule.state };
}

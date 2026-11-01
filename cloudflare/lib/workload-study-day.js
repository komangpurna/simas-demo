import { detectTeacherStudyDay, validateTeacherStudyDayPlan } from '../../js/workload-calc.js';
import DataHolidays from '../../js/data-holidays.js';

export const WORKLOAD_STUDY_DAY_SCHEMA = `CREATE TABLE IF NOT EXISTS workload_study_days (
    plan_version_id TEXT PRIMARY KEY REFERENCES weekly_plan_versions(id) ON DELETE CASCADE,
    manual_day_index INTEGER CHECK (manual_day_index BETWEEN 0 AND 4),
    resolution_json TEXT NOT NULL,
    updated_by_uid TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

function decodeAscAttribute(value) {
    return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (entity, code) => {
        if (code[0] === '#') {
            const number = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
            return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : entity;
        }
        return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }[code.toLowerCase()];
    });
}

// aSc exports flat, attribute-only records. Read only well-formed sections; no DTD/entities.
function ascRecords(xml, section, tag) {
    const block = xml.match(new RegExp(`<${section}\\b[^>]*>([\\s\\S]*?)<\\/${section}\\s*>`, 'i'));
    if (!block) throw new Error(`Bagian ${section} belum lengkap`);
    const records = [];
    const regex = new RegExp(`<${tag}\\b((?:[^>"']|"[^"]*"|'[^']*')*)\\/\\s*>`, 'gi');
    for (const match of block[1].matchAll(regex)) {
        const attrs = {};
        for (const attr of match[1].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
            attrs[attr[1]] = decodeAscAttribute(attr[2] ?? attr[3]);
        }
        records.push(attrs);
    }
    if ((block[1].match(new RegExp(`<${tag}\\b`, 'gi')) || []).length !== records.length) throw new Error(`Data ${section} tidak lengkap`);
    return records;
}

function ascTeacherName(value) {
    return String(value || '').toLowerCase()
        .replace(/\b(?:drs|dra|dr|gr)\.?\b/g, ' ')
        .replace(/\b[sm]\.\s*(?:pd|ag|kom|si|e)\b\.?/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ').trim();
}

export function parseOfficialTeacherSchedule(config, teacher) {
    try {
        const xml = String(config?.xmlContent || '').replace(/<!--[\s\S]*?-->/g, '');
        if (!/<timetable\b/i.test(xml) || !/<\/timetable\s*>\s*$/i.test(xml) || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Master jadwal belum lengkap');
        const teachers = ascRecords(xml, 'teachers', 'teacher');
        const lessons = ascRecords(xml, 'lessons', 'lesson');
        const cards = ascRecords(xml, 'cards', 'card');
        const periods = ascRecords(xml, 'periods', 'period');
        const subjects = ascRecords(xml, 'subjects', 'subject');
        const keys = [teacher?.id, teacher?.nip, teacher?.nik].filter(v => v && v !== '-').map(String);
        const mapping = config.teacherMapping || {};
        // Both historical mapping directions are supported. An explicit mapping wins over names.
        let matches = teachers.filter(t => keys.includes(String(mapping[t.id] || '')) || keys.some(key => mapping[key] === t.id));
        if (!matches.length) matches = teachers.filter(t => keys.includes(t.id) || keys.includes(t.short));
        if (!matches.length) {
            const name = ascTeacherName(teacher?.name);
            if (name) matches = teachers.filter(t => ascTeacherName(t.name) === name);
        }
        if (matches.length !== 1) throw new Error(matches.length ? 'Pemetaan guru pada jadwal ambigu' : 'Guru belum dipetakan ke jadwal resmi');
        const teacherId = matches[0].id;
        const lessonMap = new Map(lessons.map(row => [row.id, row]));
        const periodMap = new Map(periods.map(row => [Number(row.period), row]));
        const subjectMap = new Map(subjects.map(row => [row.id, row.name]));
        const days = Object.fromEntries([1, 2, 3, 4, 5].map(day => [day, []]));
        const occupied = new Set();
        const minutes = value => {
            const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
            return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
        };
        for (const card of cards) {
            const lesson = lessonMap.get(card.lessonid);
            if (!lesson) throw new Error('Kartu jadwal tidak memiliki pelajaran');
            if (!(lesson.teacherids || '').split(',').map(v => v.trim()).includes(teacherId)) continue;
            const subject = subjectMap.get(lesson.subjectid);
            if (!subject) throw new Error('Mapel jadwal tidak ditemukan');
            if (/^(upacara|ekstrakurikuler)$/i.test(subject.trim())) continue;
            const masks = (card.days || '').split(',');
            const start = Number(card.period);
            if (!masks.every(mask => /^[01]{5}$/.test(mask)) || !Number.isInteger(start) || start < 1) throw new Error('Slot jadwal tidak sah');
            for (const mask of masks) for (let index = 0; index < 5; index++) {
                if (mask[index] !== '1') continue;
                // The school's aSc export already contains one card per occupied JP.
                // Expanding periodspercard would invent extra JP (e.g. 11/12 after JP 10).
                const period = periodMap.get(start);
                const length = minutes(period?.endtime) - minutes(period?.starttime);
                if (!(length > 0)) throw new Error('Durasi JP belum lengkap');
                const key = `${index}:${start}`;
                if (occupied.has(key)) continue;
                occupied.add(key);
                days[index + 1].push({ jp: start, mapel: subject, is_teaching: 1, minutes: length });
            }
        }
        return { complete: true, days, teacherId };
    } catch (error) {
        return { complete: false, reason: `${error.message}. Pilih hari secara manual atau periksa master jadwal.` };
    }
}

export async function readWorkloadStudyDay(db, planVersionId) {
    if (!planVersionId) return null;
    try {
        return await db.prepare('SELECT * FROM workload_study_days WHERE plan_version_id = ?').bind(planVersionId).first();
    } catch (error) {
        // GET stays read-only on a database that has not received this migration yet.
        if (/no such table.*workload_study_days/i.test(error.message)) return null;
        throw error;
    }
}

export async function fetchWorkloadHolidayDates(env, from, to) {
    if (!env?.SUPABASE_URL) return [];
    // Dates already have a public, read-only view used by OPAC. The base table
    // intentionally denies anon/authenticated access; HBG does not need its data.
    const key = env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error('Akses kalender libur sekolah belum dikonfigurasi');
    const query = new URLSearchParams({ select: 'tanggal', and: `(tanggal.gte.${from},tanggal.lte.${to})` });
    const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/lib_opac_hari_libur?${query}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    if (!response.ok) throw new Error(`Kalender libur sekolah belum dapat diperiksa (HTTP ${response.status}). Silakan coba lagi.`);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('Respons kalender libur sekolah tidak sah');
    return rows.map(row => row.tanggal);
}

export async function resolveWorkloadStudyDay(db, week, version, segments, override = undefined, env = null) {
    const saved = await readWorkloadStudyDay(db, version?.id);
    if (override === undefined && saved && version && !['draft', 'needs_revision'].includes(version.status)) {
        return JSON.parse(saved.resolution_json);
    }
    const manualIndex = override === undefined ? (saved?.manual_day_index ?? null) : override;
    const dates = Array.from({ length: 5 }, (_, i) => {
        const date = new Date(`${week.week_start_date}T00:00:00Z`);
        date.setUTCDate(date.getUTCDate() + i);
        return date.toISOString().slice(0, 10);
    });
    const holidays = await db.prepare(`SELECT date, time FROM calendar_events
        WHERE (category = 'libur' OR color = 'rose') AND date <= ?
        AND (date >= ? OR time >= ?)`)
        .bind(dates[4], dates[0], dates[0]).all();
    const registeredDates = new Set(await fetchWorkloadHolidayDates(env, dates[0], dates[4]));
    const excludedDayIndexes = dates.flatMap((date, i) => {
        const isHoliday = DataHolidays.isNationalHoliday(date) || registeredDates.has(date) || (holidays.results || []).some(row => {
            const end = /^\d{4}-\d{2}-\d{2}$/.test(row.time || '') ? row.time : row.date;
            return date >= row.date && date <= end;
        });
        const isLeave = (segments || []).some(seg => seg.date === date && (seg.is_leave === 1 || seg.is_leave === true || seg.catalog_id === 'cat_cuti_izin' || seg.category_code === 'CUTI_IZIN'));
        return isHoliday || isLeave ? [i] : [];
    });
    let teacherSchedule = null;
    if (manualIndex === null && excludedDayIndexes.length < 5) {
        const row = await db.prepare("SELECT value FROM system_settings WHERE key = 'schedule_config'").first();
        let config = null;
        try { config = row?.value ? JSON.parse(row.value) : null; } catch (_) { /* unavailable master */ }
        const teacher = await db.prepare('SELECT id, name, nip, nik FROM gtk WHERE id = ?').bind(week.teacher_id).first();
        teacherSchedule = parseOfficialTeacherSchedule(config, teacher || { id: week.teacher_id });
    }
    return detectTeacherStudyDay(segments, { manualStudyDayIndex: manualIndex, teacherSchedule, excludedDayIndexes });
}

// HBG is supplementary metadata on a read. Its dependency failures must never hide
// the saved week/version or prevent schedule import. Mutations still resolve strictly.
export async function readWorkloadStudyDayResolution(db, week, version, segments, env = null) {
    try {
        return await resolveWorkloadStudyDay(db, week, version, segments, undefined, env);
    } catch (error) {
        console.warn('[Workload HBG] Penetapan belum dapat dibaca:', error.message);
        return {
            studyDayIndex: null, studyDayName: '', suggestedDayIndex: null,
            status: 'unavailable', isAutoDetected: false, isExempt: false,
            reason: 'Status Hari Belajar Guru belum dapat diperiksa. Rencana dan Sinkron KBM tetap dapat digunakan. Coba muat ulang status HBG sebelum pengajuan.',
            retryable: true
        };
    }
}

export function workloadStudyDayStatement(db, planVersionId, studyDay, actorUid, manualIndex = undefined) {
    const manual = manualIndex === undefined ? (studyDay.status === 'manual' ? studyDay.studyDayIndex : null) : manualIndex;
    // Must immediately follow the version CAS update in the same D1 batch/transaction.
    return db.prepare(`INSERT INTO workload_study_days (plan_version_id, manual_day_index, resolution_json, updated_by_uid)
        SELECT ?, ?, ?, ? WHERE changes() = 1
        ON CONFLICT(plan_version_id) DO UPDATE SET manual_day_index = excluded.manual_day_index,
            resolution_json = excluded.resolution_json, updated_by_uid = excluded.updated_by_uid, updated_at = datetime('now')`)
        .bind(planVersionId, manual, JSON.stringify(studyDay), actorUid);
}

export async function validateWorkloadStudyDaySubmission(db, week, version, segments, env = null) {
    const studyDay = await resolveWorkloadStudyDay(db, week, version, segments, undefined, env);
    return { ...validateTeacherStudyDayPlan(studyDay, segments, week.week_start_date), studyDay };
}

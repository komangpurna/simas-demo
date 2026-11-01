import { lmsHasQuiz } from '../../js/lms-structure.mjs';
import { jsonResponse, errorResponse, getCorsHeaders } from './http.js';
import { renderLmsJournalEvidenceCard } from '../../js/lms-journal-evidence.mjs';

const LMS_JOURNAL_STATUSES = new Set(['H', 'S', 'I', 'A', 'D', 'T']);
export function lmsJournalNormalize(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}
function lmsJournalFail(message, status = 400) {
    const error = new Error(message); error.status = status; throw error;
}
export function lmsJournalToday(now = new Date()) {
    return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}
function lmsJournalDate(value) {
    const date = String(value || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
        lmsJournalFail('Tanggal tidak valid.');
    }
    return date;
}
export function lmsJournalParseJp(value) {
    if (typeof value === 'string') {
        const match = value.trim().match(/^(\d{1,2})\s*[-–—]\s*(\d{1,2})$/);
        if (match) {
            const start = Number(match[1]), end = Number(match[2]);
            if (start > end || end > 20) lmsJournalFail('Rentang JP tidak valid.');
            value = Array.from({ length: end - start + 1 }, (_, index) => start + index);
        } else value = value.split(',').map(part => Number(part.trim()));
    }
    if (!Array.isArray(value) || !value.length || value.length > 20 || value.some(jp => !Number.isInteger(jp) || jp < 1 || jp > 20)) {
        lmsJournalFail('Pilih JP yang valid, misalnya 2-4 atau 2,3,4.');
    }
    return [...new Set(value)].sort((a, b) => a - b);
}
export function lmsJournalSegmentJp(segment) {
    const match = String(segment.description || '').match(/\bJP\s*(\d{1,2}(?:\s*[-–—,]\s*\d{1,2})*)/i);
    try {
        const jp = match ? lmsJournalParseJp(match[1]) : [];
        return Number(segment.jp_count) > 0 && jp.length !== Number(segment.jp_count) ? [] : jp;
    } catch { return []; }
}
export function lmsJournalSegmentMatches(segment, scope) {
    const text = `${segment.activity_title || ''} ${segment.description || ''}`;
    const tokenMatches = value => {
        const parts = String(value || '').match(/[a-z0-9]+/gi) || [];
        return parts.length > 0 && new RegExp(`(?:^|[^a-z0-9])${parts.join('[\\s._-]*')}(?=$|[^a-z0-9])`, 'i').test(text);
    };
    const semester = value => ['1', 'ganjil'].includes(String(value).toLowerCase()) ? '1' : ['2', 'genap'].includes(String(value).toLowerCase()) ? '2' : String(value).toLowerCase();
    const yearMatches = !scope.academic_year || !segment.work_academic_year || lmsJournalNormalize(scope.academic_year) === lmsJournalNormalize(segment.work_academic_year);
    const semesterMatches = !scope.semester || !segment.work_semester || semester(scope.semester) === semester(segment.work_semester);
    return tokenMatches(scope.class_name) && tokenMatches(scope.subject_name) && yearMatches && semesterMatches;
}
export function lmsJournalValidateSegment(segment, scope, date, jp) {
    if (!segment || segment.date !== date || !lmsJournalSegmentMatches(segment, scope)) {
        lmsJournalFail('Pertemuan e-Kinerja tidak cocok dengan tanggal, kelas, atau mapel.', 409);
    }
    const expectedJp = lmsJournalSegmentJp(segment);
    if (Number(segment.jp_count) > 0 && jp.length !== Number(segment.jp_count)) {
        lmsJournalFail('Jumlah JP berbeda dari pertemuan e-Kinerja yang dipilih.', 409);
    }
    if (expectedJp.length ? JSON.stringify(expectedJp) !== JSON.stringify(jp) : Number(segment.jp_count) !== jp.length) {
        lmsJournalFail('JP berbeda dari pertemuan e-Kinerja. Pilih pertemuan yang sesuai atau gunakan isian manual.', 409);
    }
    return segment;
}
async function lmsJournalHash(value) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
const LMS_JOURNAL_LEARNING_FIELDS = ['learning_status', 'materials_opened', 'materials_completed', 'active_seconds', 'session_count'];
function lmsJournalLearning(progress, materialCount, students, activity) {
    const byStudent = new Map();
    for (const row of progress) {
        const nis = String(row.student_nis);
        if (!byStudent.has(nis)) byStudent.set(nis, []);
        byStudent.get(nis).push(row);
    }
    return new Map(students.map(student => {
        const nis = String(student.nis), records = byStudent.get(nis) || [];
        const completed = records.filter(row => row.status === 'completed').length;
        const recorded = records.filter(row => Number(row.active_seconds_total) > 0 || Number(row.session_count) > 0);
        const sum = key => records.reduce((total, row) => total + Math.max(0, Math.floor(Number(row[key]) || 0)), 0);
        return [nis, { learning_status: completed === materialCount ? 'completed' : records.length ? 'in_progress' : activity.has(nis) ? 'activity_only' : 'not_opened',
            materials_opened: records.length, materials_completed: completed,
            active_seconds: recorded.length ? sum('active_seconds_total') : null, session_count: sum('session_count') }];
    }));
}
function lmsJournalBase64Url(bytes) {
    return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function lmsJournalReceiptBytes(value) {
    return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
}
async function lmsJournalReceiptKey(secret, usage) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}
async function lmsJournalIssueReceipt(preview, uid, secret) {
    if (!secret) return '';
    const payload = { v: 1, uid, hash: preview.snapshot_hash, at: preview.snapshot.snapshot_at, exp: Date.now() + 3600000,
        rows: preview.snapshot.students.map(student => ({ nis: student.nis, ...Object.fromEntries(LMS_JOURNAL_LEARNING_FIELDS.map(key => [key, student[key]])) })) };
    const encoded = lmsJournalBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
    const signature = await crypto.subtle.sign('HMAC', await lmsJournalReceiptKey(secret, 'sign'), new TextEncoder().encode(`LMS-JOURNAL-LEARNING:1.${encoded}`));
    return `${encoded}.${lmsJournalBase64Url(new Uint8Array(signature))}`;
}
async function lmsJournalReadReceipt(body, uid, secret) {
    if (!body.learning_receipt) return null; // Older clients still undergo live hash validation.
    try {
        if (!secret || typeof body.learning_receipt !== 'string' || body.learning_receipt.length > 200000) throw new Error('receipt');
        const parts = body.learning_receipt.split('.');
        if (parts.length !== 2 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error('receipt');
        const valid = await crypto.subtle.verify('HMAC', await lmsJournalReceiptKey(secret, 'verify'), lmsJournalReceiptBytes(parts[1]), new TextEncoder().encode(`LMS-JOURNAL-LEARNING:1.${parts[0]}`));
        if (!valid) throw new Error('signature');
        const payload = JSON.parse(new TextDecoder().decode(lmsJournalReceiptBytes(parts[0])));
        if (payload.v !== 1 || payload.uid !== uid || payload.hash !== body.snapshot_hash || payload.at !== body.snapshot_at || !Number.isFinite(payload.exp) || payload.exp < Date.now() || !Array.isArray(payload.rows)) throw new Error('binding');
        return new Map(payload.rows.map(row => [String(row.nis), Object.fromEntries(LMS_JOURNAL_LEARNING_FIELDS.map(key => [key, row[key]]))]));
    } catch { lmsJournalFail('Rekap belajar kedaluwarsa atau berubah. Perbarui rekap dan tanda tangani kembali.', 409); }
}
async function lmsJournalOwner(db, material, authorization) {
    const id = material.teacher_id;
    let teacher = await db.prepare('SELECT id, name, foto FROM gtk WHERE id = ? OR nip = ? OR nik = ? LIMIT 1').bind(id, id, id).first();
    if (!teacher && id === authorization.user.uid && authorization.user.linkedTeacherId) {
        const linked = authorization.user.linkedTeacherId;
        teacher = await db.prepare('SELECT id, name, foto FROM gtk WHERE id = ? OR nip = ? OR nik = ? LIMIT 1').bind(linked, linked, linked).first();
    }
    if (!teacher) {
        const matches = await db.prepare('SELECT id, name, foto FROM gtk WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))').bind(material.teacher_name).all();
        if (matches.results.length === 1) teacher = matches.results[0];
    }
    return { id: teacher?.id || id, name: teacher?.name || material.teacher_name, photo: teacher?.foto || '' };
}
async function lmsJournalMaterials(db, ids, authorization, dependencies) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 20 || ids.some(id => typeof id !== 'string' || !id || id.length > 150)) {
        lmsJournalFail('Pilih 1 sampai 20 materi untuk pertemuan ini.');
    }
    const uniqueIds = [...new Set(ids)].sort();
    let { results } = await db.prepare(`SELECT m.*, t.academic_year, t.semester FROM lms_materials m
        JOIN lms_topics t ON t.id = m.topic_id WHERE m.id IN (${uniqueIds.map(() => '?').join(',')}) ORDER BY m.id`).bind(...uniqueIds).all();
    if (results.length === 0 && uniqueIds.length === 1) {
        const byModule = await db.prepare(`SELECT m.*, t.academic_year, t.semester FROM lms_materials m
            JOIN lms_topics t ON t.id = m.topic_id WHERE m.module_id = ? AND m.is_archived = 0 ORDER BY m.order_index, m.id`).bind(uniqueIds[0]).all();
        if (byModule.results?.length) results = [byModule.results[0]];
    }
    if (results.length !== uniqueIds.length) lmsJournalFail('Materi tidak ditemukan. Muat ulang LMS.', 404);
    const first = results[0];
    for (const material of results) {
        if (!dependencies.canManageLmsResource(authorization, material)) lmsJournalFail('Anda hanya dapat membuat jurnal untuk materi milik Anda.', 403);
        if (!dependencies.isLmsMaterialPublished(material)) lmsJournalFail('Jurnal hanya dapat dibuat dari materi yang sudah tayang.', 409);
        if (['teacher_id', 'class_name', 'subject_name', 'academic_year', 'semester'].some(key => material[key] !== first[key])) {
            lmsJournalFail('Materi harus berasal dari guru, kelas, mapel, tahun ajaran, dan semester yang sama.');
        }
    }
    return results;
}
async function lmsJournalSegments(db, teacherId, date) {
    const { results } = await db.prepare(`SELECT pts.*, pa.title AS activity_title, pa.work_week_id,
            w.is_locked AS week_locked, w.academic_year AS work_academic_year, w.semester AS work_semester, v.status AS plan_status
        FROM plan_time_segments pts JOIN plan_activities pa ON pa.id = pts.activity_id
        JOIN work_weeks w ON w.id = pa.work_week_id JOIN weekly_plan_versions v ON v.id = pts.plan_version_id
        WHERE w.teacher_id = ? AND pts.date = ? AND pa.is_cancelled = 0
        AND v.id = (SELECT id FROM weekly_plan_versions WHERE work_week_id = w.id ORDER BY version_number DESC LIMIT 1)
        AND (pts.is_teaching = 1 OR pa.category_code = 'PELAKSANAAN_KBM' OR pa.catalog_id = 'cat_kbm')
        ORDER BY pts.start_time, pts.id`).bind(teacherId, date).all();
    return results;
}
async function lmsJournalExisting(db, scope, date) {
    const { results } = await db.prepare(`SELECT j.*, l.revision AS lms_revision, l.snapshot_json AS lms_snapshot,
        l.plan_segment_id AS lms_segment_id FROM jurnal_guru j LEFT JOIN lms_journal_links l ON l.journal_id = j.id WHERE j.tanggal = ?`).bind(date).all();
    const matches = results.filter(row => lmsJournalNormalize(row.kelas) === lmsJournalNormalize(scope.class_name)
        && lmsJournalNormalize(row.mapel) === lmsJournalNormalize(scope.subject_name));
    if (matches.length > 1) lmsJournalFail('Ada beberapa jurnal pada kelas, mapel, dan tanggal ini. Periksa jurnal yang sudah ada.', 409);
    return matches[0] || null;
}

async function lmsJournalEntry(db, id, authorization, dependencies) {
    if (!/^lmsj_[a-f0-9]{40}$/.test(String(id || ''))) lmsJournalFail('Jurnal LMS tidak ditemukan.', 404);
    const entry = await db.prepare(`SELECT l.journal_id, l.snapshot_json, l.revision FROM lms_journal_links l
        JOIN jurnal_guru j ON j.id = l.journal_id WHERE l.journal_id = ?`).bind(id).first();
    if (!entry) lmsJournalFail('Jurnal LMS tidak ditemukan.', 404);
    const snapshot = JSON.parse(entry.snapshot_json);
    if (!dependencies.canManageLmsResource(authorization, { teacher_id: snapshot.lms_teacher_id || snapshot.uid_guru })) {
        lmsJournalFail('Anda hanya dapat membuka jurnal LMS milik Anda.', 403);
    }
    return { ...entry, snapshot };
}

function lmsJournalTeacherPhoto(owner, request) {
    try {
        const photo = new URL(owner.photo || `/api/photos/gtk/${encodeURIComponent(owner.id)}.webp`, request.url);
        if (['https:', 'http:'].includes(photo.protocol) && !photo.username && !photo.password) return photo.href;
    } catch { /* An unavailable profile photo uses the teacher's initials. */ }
    return '';
}

async function lmsJournalAttendancePreview(db, body, authorization, dependencies, frozenLearning = null) {
    const entry = await lmsJournalEntry(db, body.journal_id, authorization, dependencies);
    const original = entry.snapshot;
    const overrides = body.overrides || {};
    if (typeof overrides !== 'object' || Array.isArray(overrides)
        || Object.keys(overrides).some(nis => !original.students.some(student => String(student.nis) === nis))) {
        lmsJournalFail('Koreksi hanya dapat dilakukan untuk siswa pada jurnal tersimpan.');
    }
    let baseline = original, refreshState = '';
    if (body.refresh_attendance === true) {
        const ids = original.material_ids || [];
        let sources = [];
        if (ids.length) {
            const queryById = await db.prepare(`SELECT id,teacher_id,class_name,subject_name,resource_type,quiz_enabled,material_enabled
                FROM lms_materials WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
            sources = queryById.results || [];
            if (!sources.length) {
                const queryByModule = await db.prepare(`SELECT id,teacher_id,class_name,subject_name,resource_type,quiz_enabled,material_enabled
                    FROM lms_materials WHERE module_id IN (${ids.map(() => '?').join(',')}) AND is_archived = 0`).bind(...ids).all();
                sources = queryByModule.results || [];
            }
        }
        const validTeacherIds = new Set([
            String(original.lms_teacher_id || '').trim(),
            String(original.uid_guru || '').trim(),
            String(authorization.user?.uid || '').trim(),
            String(authorization.user?.linkedTeacherId || '').trim(),
            String(authorization.user?.nip || '').trim()
        ].filter(Boolean));
        const materials = sources.filter(material => {
            const isAuthorized = dependencies.canManageLmsResource(authorization, material)
                || validTeacherIds.has(String(material.teacher_id).trim())
                || dependencies.canManageLmsResource(authorization, { teacher_id: material.teacher_id });
            if (!isAuthorized) return false;
            const normMatClass = lmsJournalNormalize(material.class_name);
            const normOrigClass = lmsJournalNormalize(original.kelas);
            const classMatch = !normOrigClass || !normMatClass || normMatClass === normOrigClass
                || normMatClass.includes(normOrigClass) || normOrigClass.includes(normMatClass);
            const normMatSubj = lmsJournalNormalize(material.subject_name);
            const normOrigSubj = lmsJournalNormalize(original.mapel);
            const subjMatch = !normOrigSubj || !normMatSubj || normMatSubj === normOrigSubj
                || normMatSubj.includes(normOrigSubj) || normOrigSubj.includes(normMatSubj);
            return classMatch && subjMatch;
        });
        refreshState = materials.length === ids.length && ids.length ? 'updated' : materials.length ? 'partial' : 'unavailable';
        if (materials.length) {
            const cutoff = body.snapshot_at || new Date().toISOString();
            if (typeof cutoff !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(cutoff) || !Number.isFinite(Date.parse(cutoff)) || Date.parse(cutoff) > Date.now() + 1000) {
                lmsJournalFail('Waktu rekap tidak valid. Perbarui rekap kembali.');
            }
            const start = lmsJournalDate(original.period_start || original.tanggal), end = lmsJournalDate(original.period_end || original.tanggal);
            const startAt = new Date(`${start}T00:00:00+08:00`).toISOString();
            const endAt = new Date(Math.min(Date.parse(`${end}T23:59:59.999+08:00`), Date.parse(cutoff))).toISOString();
            if (start > end || endAt < startAt) lmsJournalFail('Periode jurnal tersimpan tidak valid.', 409);
            const { activity, activitySource, progress } = await lmsJournalActivity(db, materials, startAt, endAt);
            const roster = original.students.map(student => ({ nis: student.nis, name: student.nama }));
            const learning = refreshState === 'updated' ? frozenLearning || lmsJournalLearning(progress, ids.length, roster, activity) : null;
    const collage = baseline.evidence_collage || await lmsJournalBuildCollage(db, materials);
            baseline = { ...original, snapshot_at: cutoff, ...(learning ? { learning_version: 1 } : {}),
                ...(collage ? { evidence_collage: collage } : {}),
                students: original.students.map(student => {
                    const nis = String(student.nis), hasProgress = activity.has(nis) || student.has_progress;
                    return { ...student, ...(learning?.get(nis) || {}), has_progress: Boolean(hasProgress),
                        activity_at: activity.get(nis) || student.activity_at || '', activity_source: activitySource.get(nis) || student.activity_source || '',
                        ...(student.source === 'koreksi_guru' ? {} : { status: hasProgress ? 'H' : 'A',
                            source: hasProgress ? 'progres_lms' : 'belum_progres', reason: '' }) };
                }) };
        }
    }
    const students = baseline.students.map(student => {
        const override = overrides[String(student.nis)];
        if (!override) return student;
        if (typeof override !== 'object' || !LMS_JOURNAL_STATUSES.has(override.status) || (override.reason !== undefined && (typeof override.reason !== 'string' || override.reason.length > 300))) {
            lmsJournalFail('Setiap koreksi presensi harus memiliki status yang valid.');
        }
        return { ...student, status: override.status, reason: typeof override.reason === 'string' ? override.reason.trim() : '', source: 'koreksi_guru' };
    });
    // Opening/correcting a signed journal remains possible after source deletion.
    // Only an explicit refresh reads live activity; it never replaces the signed roster.
    const snapshot = { ...baseline, students, summary: { ...baseline.summary, hadir: students.filter(student => student.status === 'H').length,
        ...(refreshState ? { berprogres: students.filter(student => student.has_progress).length,
            selesai: students.filter(student => student.learning_status === 'completed').length,
            active_seconds_total: students.reduce((sum, student) => sum + (student.active_seconds || 0), 0) } : {}) } };
    if (snapshot.plan_segment_id) {
        const scope = { class_name: snapshot.kelas, subject_name: snapshot.mapel, academic_year: snapshot.academic_year, semester: snapshot.semester };
        const segment = (await lmsJournalSegments(db, snapshot.uid_guru, snapshot.tanggal)).find(item => item.id === snapshot.plan_segment_id);
        lmsJournalValidateSegment(segment, scope, snapshot.tanggal, snapshot.jp);
    }
    return { snapshot, snapshot_hash: await lmsJournalHash(JSON.stringify(snapshot)), revision: Number(entry.revision), journal_id: entry.journal_id,
        refresh_state: refreshState,
        history_note: refreshState === 'updated' ? 'Kehadiran dan rekap belajar diperbarui dari aktivitas LMS pada periode jurnal. Koreksi manual guru tetap dipertahankan.'
            : refreshState === 'partial' ? 'Sebagian bahan ajar sumber tidak tersedia. Kehadiran diperbarui dari sumber yang tersedia; durasi dan status belajar memakai rekap tersimpan.'
            : refreshState === 'unavailable' ? 'Bahan ajar sumber tidak tersedia. Rekap tersimpan dipertahankan; kehadiran tetap dapat dikoreksi.'
            : 'Koreksi presensi memakai jurnal tersimpan. Klik Perbarui rekap untuk mengambil aktivitas LMS terbaru pada periode jurnal.',
        workload_hint: 'Perubahan presensi memerlukan pemeriksaan dan tanda tangan baru.' };
}

// Student event recording is additive and must never block the established LMS path.
export async function recordLmsJournalActivity(db, materialId, studentNis, action) {
    try {
        const id = 'evt_' + await lmsJournalHash(`${materialId}|${studentNis}|${lmsJournalToday()}`);
        await db.prepare(`INSERT INTO lms_activity_events(id, material_id, student_nis, action) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
            .bind(id, materialId, String(studentNis), action).run();
    } catch (error) { console.warn('[LMS Journal] Aktivitas tambahan belum tercatat:', error.message); }
}

async function lmsJournalActivity(db, materials, startAt, endAt) {
    if (!materials.length) return { activity: new Map(), activitySource: new Map(), progress: [] };
    const ids = materials.map(material => material.id), placeholders = ids.map(() => '?').join(',');
    const { results: events } = await db.prepare(`SELECT student_nis, MIN(occurred_at) AS activity_at FROM lms_activity_events
        WHERE material_id IN (${placeholders}) AND occurred_at >= datetime(?) AND occurred_at <= datetime(?) GROUP BY student_nis`)
        .bind(...ids, startAt, endAt).all();
    const { results: progress } = await db.prepare(`SELECT p.student_nis, p.material_id, p.status, p.active_seconds_total, p.session_count, p.first_opened_at, p.last_accessed_at, p.completed_at, m.resource_type, m.quiz_enabled, m.material_enabled
        FROM lms_progress p JOIN lms_materials m ON m.id = p.material_id WHERE p.material_id IN (${placeholders})`).bind(...ids).all();
    const activity = new Map(events.map(event => [String(event.student_nis), event.activity_at]));
    const activitySource = new Map(events.map(event => [String(event.student_nis), 'student_event']));
    // Older data has first/last/completion times; the additive event ledger preserves intermediate activity thereafter.
    for (const row of progress) {
        const nis = String(row.student_nis);
        // A quiz may be graded later by the teacher; grading time is not student attendance.
        const timestamps = lmsHasQuiz(row) ? [row.first_opened_at] : [row.first_opened_at, row.last_accessed_at, row.completed_at];
        for (const timestamp of timestamps) {
            if (!timestamp) continue;
            const millis = Date.parse(/[zZ]|[+-]\d{2}:\d{2}$/.test(timestamp) ? timestamp : `${timestamp.replace(' ', 'T')}Z`);
            if (millis >= Date.parse(startAt) && millis <= Date.parse(endAt) && !activity.has(nis)) {
                activity.set(nis, timestamp); activitySource.set(nis, 'legacy_access');
            }
        }
    }
    const quizIds = materials.filter(material => lmsHasQuiz(material)).map(material => material.id);
    if (quizIds.length) {
        const attempts = await db.prepare(`SELECT student_nis, started_at, submitted_at FROM lms_quiz_attempts
            WHERE material_id IN (${quizIds.map(() => '?').join(',')})`).bind(...quizIds).all();
        for (const attempt of attempts.results) {
            const nis = String(attempt.student_nis);
            for (const timestamp of [attempt.started_at, attempt.submitted_at]) {
                if (!timestamp || activity.has(nis)) continue;
                const millis = Date.parse(/[zZ]$|[+-]\d{2}:\d{2}$/.test(timestamp) ? timestamp : `${timestamp.replace(' ', 'T')}Z`);
                if (millis >= Date.parse(startAt) && millis <= Date.parse(endAt)) { activity.set(nis, timestamp); activitySource.set(nis, 'quiz_attempt'); }
            }
        }
    }
    return { activity, activitySource, progress };
}

async function lmsJournalBuildCollage(db, materials) {
    if (!materials || !materials.length) return null;
    const primary = materials[0];
    const ids = materials.map(m => m.id);

    const materialData = {
        title: primary.title || 'Materi Pembelajaran',
        resource_type: primary.resource_type || 'text',
        description: primary.content_description || primary.instructions || "Materi pembelajaran LMS SIMAS SMANTARA.",
        instructions: primary.instructions || ''
    };

    let interactiveData = null;

    if (primary.allow_discussion) {
        try {
            const discussions = await db.prepare(
                `SELECT user_name, user_role, content, created_at
                 FROM lms_discussions
                 WHERE material_id IN (${ids.map(() => '?').join(',')}) AND is_hidden = 0
                 ORDER BY created_at ASC LIMIT 2`
            ).bind(...ids).all();
            if (discussions.results && discussions.results.length > 0) {
                interactiveData = {
                    type: 'discussion',
                    prompt: primary.discussion_prompt || 'Forum Diskusi & Refleksi Kelas',
                    comments: discussions.results.map(c => ({
                        user_name: c.user_name || 'Peserta',
                        user_role: c.user_role || 'siswa',
                        content: String(c.content || '').slice(0, 150)
                    }))
                };
            }
        } catch { /* graceful fallback */ }
    }

    if (!interactiveData) {
        let quizPayload = primary.quiz_payload;
        if (!quizPayload) {
            const withQuiz = materials.find(m => m.quiz_payload);
            if (withQuiz) quizPayload = withQuiz.quiz_payload;
        }

        if (quizPayload) {
            try {
                const parsed = typeof quizPayload === 'string' ? JSON.parse(quizPayload) : quizPayload;
                const questions = Array.isArray(parsed?.questions) ? parsed.questions : (Array.isArray(parsed) ? parsed : []);
                if (questions.length > 0) {
                    const q1 = questions[0];
                    interactiveData = {
                        type: 'quiz',
                        total_questions: questions.length,
                        question_text: String(q1.question || q1.text || q1.pertanyaan || 'Pertanyaan pemahaman materi.').slice(0, 160),
                        question_type: q1.type || 'Pilihan Ganda',
                        options: Array.isArray(q1.options)
                            ? q1.options.slice(0, 3).map(opt => String(typeof opt === 'string' ? opt : (opt.text || opt.label || '')).slice(0, 50))
                            : []
                    };
                }
            } catch { /* graceful fallback */ }
        }
    }

    if (!interactiveData) {
        interactiveData = {
            type: 'guide',
            target: primary.title || 'Kompetensi Pembelajaran',
            instructions: String(primary.instructions || primary.content_description || 'Pelajari bahan ajar dan tuntaskan aktivitas belajar mandiri di LMS.').slice(0, 180),
            estimated_minutes: 45
        };
    }

    return {
        material: materialData,
        interactive: interactiveData
    };
}

async function lmsJournalPreview(db, body, authorization, dependencies, frozenLearning = null) {
    if (body.attendance_only === true) return lmsJournalAttendancePreview(db, body, authorization, dependencies, frozenLearning);
    const materials = await lmsJournalMaterials(db, body.material_ids, authorization, dependencies);
    const scope = materials[0], owner = await lmsJournalOwner(db, scope, authorization);
    const date = lmsJournalDate(body.tanggal), today = lmsJournalToday();
    if (date > today) lmsJournalFail('Pembelajaran pada tanggal mendatang belum dapat direalisasikan.');
    const jp = lmsJournalParseJp(body.jp);
    const start = lmsJournalDate(body.period_start || date), end = lmsJournalDate(body.period_end || date);
    if (start > end || start > date || end < date || end > today || Date.parse(end) - Date.parse(start) > 30 * 86400000) {
        lmsJournalFail('Periode progres harus mencakup tanggal pembelajaran, maksimal 31 hari, dan tidak melewati hari ini.');
    }
    const cutoff = body.snapshot_at || new Date().toISOString();
    if (typeof cutoff !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(cutoff) || !Number.isFinite(Date.parse(cutoff)) || Date.parse(cutoff) > Date.now() + 1000) {
        lmsJournalFail('Waktu rekap tidak valid. Muat ulang progres.');
    }
    const startAt = new Date(`${start}T00:00:00+08:00`).toISOString();
    const endAt = new Date(Math.min(Date.parse(`${end}T23:59:59.999+08:00`), Date.parse(cutoff))).toISOString();
    if (endAt < startAt) lmsJournalFail('Waktu rekap mendahului periode progres.');
    const segments = await lmsJournalSegments(db, owner.id, date);
    const segmentId = String(body.plan_segment_id || '');
    const segment = segmentId ? lmsJournalValidateSegment(segments.find(item => item.id === segmentId), scope, date, jp) : null;
    const existing = await lmsJournalExisting(db, scope, date);
    if (existing && (!existing.lms_revision || ![owner.id, scope.teacher_id].includes(existing.uid_guru))) {
        lmsJournalFail('Jurnal kelas, mapel, dan tanggal ini sudah ada. Gunakan jurnal yang sudah tercatat; data tersebut tidak ditimpa.', 409);
    }
    const normalizedClass = lmsJournalNormalize(scope.class_name);
    const currentRoster = await db.prepare(`SELECT nis, name FROM students
        WHERE LOWER(REPLACE(REPLACE(REPLACE(TRIM(class), ' ', ''), '-', ''), '.', '')) = ?
        AND (status IS NULL OR status = '' OR LOWER(status) IN ('active', 'aktif')) ORDER BY nis`).bind(normalizedClass).all();
    // Revising a historical journal must retain the roster that the teacher originally signed.
    const originalRoster = existing?.lms_snapshot ? JSON.parse(existing.lms_snapshot).students : null;
    const students = originalRoster ? originalRoster.map(student => ({ nis: student.nis, name: student.nama })) : currentRoster.results;
    if (!students.length) lmsJournalFail('Daftar siswa aktif kelas ini kosong. Periksa data siswa sebelum menyimpan.', 409);
    const ids = materials.map(material => material.id);
    const { activity, activitySource, progress } = await lmsJournalActivity(db, materials, startAt, endAt);
    const overrides = body.overrides || {};
    if (typeof overrides !== 'object' || Array.isArray(overrides) || overrides === null) lmsJournalFail('Koreksi presensi tidak valid.');
    const knownNis = new Set(students.map(student => String(student.nis)));
    if (Object.keys(overrides).some(nis => !knownNis.has(nis))) lmsJournalFail('Koreksi presensi memuat siswa di luar kelas ini.');
    const learning = frozenLearning || lmsJournalLearning(progress, ids.length, students, activity);
    const rows = students.map(student => {
        const nis = String(student.nis), override = overrides[nis];
        if (override && (typeof override !== 'object' || (override.status && !LMS_JOURNAL_STATUSES.has(override.status)) || (override.reason !== undefined && (typeof override.reason !== 'string' || override.reason.length > 300)))) {
            lmsJournalFail('Setiap koreksi presensi harus memiliki status yang valid.');
        }
        return { nis, nama: student.name, status: override?.status !== undefined ? override.status : (activity.has(nis) ? 'H' : ''),
            has_progress: activity.has(nis), activity_at: activity.get(nis) || '',
            activity_source: activitySource.get(nis) || '',
            source: override ? (override.source || 'koreksi_guru') : (activity.has(nis) ? 'progres_lms' : 'belum_progres'), reason: typeof override?.reason === 'string' ? override.reason.trim() : '',
            ...learning.get(nis) };
    });
    const topik = String(body.topik || materials.map(material => material.title).join('; ')).trim();
    const catatan = String(body.catatan || '').trim();
    if (!topik || topik.length > 2000 || catatan.length > 4000) lmsJournalFail('Topik wajib diisi (maksimal 2.000 karakter); catatan maksimal 4.000 karakter.');
    const evidenceCollage = await lmsJournalBuildCollage(db, materials);
    const snapshot = { tanggal: date, kelas: scope.class_name, guru: owner.name, uid_guru: owner.id, mapel: scope.subject_name,
        academic_year: scope.academic_year, semester: scope.semester, lms_teacher_id: scope.teacher_id, topik, catatan, jp,
        plan_segment_id: segmentId, plan_activity_id: segment?.activity_id || '',
        planned_minutes: segment?.planned_minutes || null, lokasi_mengajar: 'Daring (LMS)',
        material_ids: ids, materials: materials.map(material => ({ id: material.id, title: material.title })),
        period_start: start, period_end: end, snapshot_at: cutoff, students: rows, learning_version: 1,
        ...(evidenceCollage ? { evidence_collage: evidenceCollage } : {}),
        summary: { total: rows.length, hadir: rows.filter(row => row.status === 'H').length, berprogres: rows.filter(row => row.has_progress).length,
            selesai: rows.filter(row => row.learning_status === 'completed').length,
            active_seconds_total: rows.reduce((sum, row) => sum + (row.active_seconds || 0), 0) } };
    return { snapshot, snapshot_hash: await lmsJournalHash(JSON.stringify(snapshot)), revision: Number(existing?.lms_revision || 0),
        journal_id: existing?.id || '', history_note: rows.some(row => row.activity_source === 'legacy_access')
            ? 'Progres historis memakai waktu buka/akses yang tersedia. Periksa presensi bila materi ini pernah dipakai pada pertemuan lain.' : '',
        workload_hint: segment ? (segment.week_locked ? 'Minggu kerja terkunci.' : segment.plan_status !== 'approved' ? 'Rencana mingguan belum disetujui.' : 'Siap disinkronkan setelah jurnal disahkan.') : 'Belum ditautkan ke pertemuan e-Kinerja.' };
}

export async function resolveLmsJournalPlanSegment(db, journal, candidates) {
    if (!String(journal.id).startsWith('lmsj_')) return null;
    const link = await db.prepare('SELECT plan_segment_id, snapshot_json FROM lms_journal_links WHERE journal_id = ?').bind(journal.id).first();
    if (!link?.plan_segment_id) return { reason: 'Jurnal LMS belum ditautkan ke pertemuan e-Kinerja. Buka Buat jurnal dari LMS untuk menautkan dan mengesahkan kembali.' };
    const segment = candidates.find(item => item.id === link.plan_segment_id);
    if (!segment) return { reason: 'Pertemuan e-Kinerja yang ditautkan tidak tersedia pada rencana aktif. Periksa dan sahkan ulang jurnal LMS.' };
    try {
        const jp = typeof journal.jp === 'string' ? JSON.parse(journal.jp) : journal.jp;
        const snapshot = JSON.parse(link.snapshot_json);
        const week = await db.prepare(`SELECT w.academic_year AS work_academic_year, w.semester AS work_semester
            FROM work_weeks w JOIN plan_activities a ON a.work_week_id = w.id WHERE a.id = ?`).bind(segment.activity_id).first();
        lmsJournalValidateSegment({ ...segment, ...week }, { class_name: journal.kelas, subject_name: journal.mapel,
            academic_year: snapshot.academic_year, semester: snapshot.semester }, journal.tanggal, jp);
    } catch (error) { return { reason: error.message }; }
    return { segment, score: 100 };
}

export function renderLmsJournalEvidence(snapshot, revision) {
    return renderLmsJournalEvidenceCard(snapshot, revision);
}

function lmsJournalValidateSignature(value) {
    if (typeof value !== 'string' || value.length > 400000 || !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/=]+$/.test(value)) {
        lmsJournalFail('Tanda tangan digital PNG wajib diisi.');
    }
    let bytes;
    try { bytes = atob(value.slice(value.indexOf(',') + 1)); } catch { lmsJournalFail('Tanda tangan tidak valid.'); }
    if (bytes.length < 80 || bytes.slice(12, 16) !== 'IHDR') lmsJournalFail('Tanda tangan tidak valid.');
    const dimension = offset => ((bytes.charCodeAt(offset) * 16777216) + (bytes.charCodeAt(offset + 1) << 16) + (bytes.charCodeAt(offset + 2) << 8) + bytes.charCodeAt(offset + 3));
    if (dimension(16) < 100 || dimension(16) > 2048 || dimension(20) < 40 || dimension(20) > 2048) lmsJournalFail('Ukuran tanda tangan tidak valid.');
    let offset = 8, hasPixels = false, ended = false;
    while (offset + 12 <= bytes.length) {
        const length = dimension(offset), type = bytes.slice(offset + 4, offset + 8);
        if (offset + 12 + length > bytes.length || (offset === 8 && (type !== 'IHDR' || length !== 13))) lmsJournalFail('Berkas tanda tangan tidak lengkap.');
        if (type === 'IDAT' && length > 0) hasPixels = true;
        offset += 12 + length;
        if (type === 'IEND') { ended = length === 0 && offset === bytes.length; break; }
    }
    if (!hasPixels || !ended) lmsJournalFail('Berkas tanda tangan tidak lengkap.');
}
async function lmsJournalSave(db, body, authorization, dependencies, request, receiptSecret) {
    if (body.confirm_attendance !== true) lmsJournalFail('Periksa dan konfirmasi seluruh presensi sebelum menandatangani.');
    lmsJournalValidateSignature(body.ttd);
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(String(body.request_id || ''))) lmsJournalFail('Identitas penyimpanan tidak valid.');
    const replay = await db.prepare('SELECT * FROM lms_journal_links WHERE request_id = ? AND signed_by = ?').bind(body.request_id, authorization.user.uid).first();
    if (replay) {
        if (body.snapshot_hash !== replay.snapshot_hash) lmsJournalFail('Identitas percobaan ulang tidak cocok dengan rekap tersimpan.', 409);
        const journal = await db.prepare('SELECT * FROM jurnal_guru WHERE id = ?').bind(replay.journal_id).first();
        let workloadSync;
        try { workloadSync = await dependencies.syncJournalToWorkload(db, journal, authorization.user); }
        catch { workloadSync = { success: false, reason: 'Jurnal tersimpan; sinkronisasi e-Kinerja belum berhasil.' }; }
        return { success: true, id: journal.id, revision: replay.revision, evidence_url: journal.foto_url, already_saved: true, workloadSync };
    }
    const frozenLearning = await lmsJournalReadReceipt(body, authorization.user.uid, receiptSecret);
    const preview = await lmsJournalPreview(db, body, authorization, dependencies, frozenLearning), snapshot = preview.snapshot;
    if (snapshot.students.some(student => !student.status || !LMS_JOURNAL_STATUSES.has(student.status))) {
        lmsJournalFail('Seluruh siswa wajib memiliki status presensi yang valid sebelum disimpan.');
    }
    const scopeKey = `${lmsJournalNormalize(snapshot.kelas)}|${lmsJournalNormalize(snapshot.mapel)}|${snapshot.tanggal}`;
    const id = `lmsj_${(await lmsJournalHash(scopeKey)).slice(0, 40)}`;
    if (body.attendance_only === true && id !== preview.journal_id) lmsJournalFail('Identitas jurnal tersimpan tidak cocok.', 409);
    const link = await db.prepare('SELECT * FROM lms_journal_links WHERE journal_id = ?').bind(id).first();
    if (body.snapshot_hash !== preview.snapshot_hash) lmsJournalFail('Data progres atau isian telah berubah. Muat ulang rekap dan tanda tangani kembali.', 409);
    if (!Number.isInteger(body.expected_revision) || body.expected_revision !== preview.revision || (link && body.confirm_update !== true)) {
        lmsJournalFail('Jurnal sudah tersedia atau diperbarui di sesi lain. Periksa jurnal terbaru sebelum menandatangani ulang.', 409);
    }
    if (link) {
        const log = await db.prepare('SELECT is_locked, verification_status, verified_by_uid FROM work_logs WHERE id = ?').bind(`wl_jurnal_${id}`).first();
        if (log && (log.is_locked === 1 || (log.verification_status === 'verified' && log.verified_by_uid && log.verified_by_uid !== 'system_auto_policy'))) {
            lmsJournalFail('Realisasi jurnal ini sudah dikunci atau diverifikasi pimpinan. Pembaruan otomatis tidak diizinkan.', 409);
        }
        if (log) {
            const scope = { class_name: snapshot.kelas, subject_name: snapshot.mapel, academic_year: snapshot.academic_year, semester: snapshot.semester };
            const meeting = (await lmsJournalSegments(db, snapshot.uid_guru, snapshot.tanggal)).find(segment => segment.id === snapshot.plan_segment_id && lmsJournalSegmentMatches(segment, scope));
            if (!meeting || meeting.plan_status !== 'approved' || meeting.week_locked) {
                lmsJournalFail('Realisasi jurnal sudah tertaut. Pilih pertemuan e-Kinerja yang disetujui sebelum memperbarui jurnal ini.', 409);
            }
        }
        const week = await db.prepare('SELECT w.is_locked FROM work_weeks w JOIN work_logs l ON l.work_week_id = w.id WHERE l.id = ?').bind(`wl_jurnal_${id}`).first();
        if (week?.is_locked === 1) lmsJournalFail('Minggu kerja realisasi jurnal ini sudah dikunci.', 409);
    }
    const revision = preview.revision + 1, token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
    const evidenceUrl = `${new URL(request.url).origin}/api/lms/journal/evidence/${token}.svg`;
    const presensi = JSON.stringify(snapshot.students.filter(student => student.status !== 'H').map(student => ({ nama: student.nama, nis: student.nis, status: student.status })));
    const snapshotJson = JSON.stringify(snapshot);
    const params = [snapshot.tanggal, snapshot.kelas, snapshot.guru, snapshot.uid_guru, snapshot.mapel, snapshot.topik,
        snapshot.catatan, JSON.stringify(snapshot.jp), snapshot.lokasi_mengajar, evidenceUrl, body.ttd, presensi];
    let statements;
    if (!link) {
        statements = [db.prepare(`INSERT INTO jurnal_guru(id, tanggal, kelas, guru, uid_guru, mapel, topik, catatan, jp, lokasi_mengajar, foto_url, ttd, presensi_detail)
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (
                SELECT 1 FROM jurnal_guru WHERE tanggal = ?
                AND LOWER(REPLACE(REPLACE(REPLACE(TRIM(kelas), ' ', ''), '-', ''), '.', '')) = ?
                AND LOWER(REPLACE(REPLACE(REPLACE(TRIM(mapel), ' ', ''), '-', ''), '.', '')) = ?)`)
            .bind(id, ...params, snapshot.tanggal, lmsJournalNormalize(snapshot.kelas), lmsJournalNormalize(snapshot.mapel)),
        db.prepare(`INSERT INTO lms_journal_links(journal_id, scope_key, teacher_id, plan_segment_id, revision, request_id, snapshot_hash, snapshot_json, evidence_token, signed_by)
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM jurnal_guru WHERE id = ?)`)
            .bind(id, scopeKey, snapshot.uid_guru, snapshot.plan_segment_id, revision, body.request_id, preview.snapshot_hash, snapshotJson, token, authorization.user.uid, id)];
    } else {
        statements = [db.prepare(`UPDATE lms_journal_links SET plan_segment_id = ?, revision = ?, request_id = ?, snapshot_hash = ?,
            snapshot_json = ?, evidence_token = ?, signed_by = ?, updated_at = datetime('now') WHERE journal_id = ? AND revision = ?
            AND NOT EXISTS (SELECT 1 FROM work_logs WHERE id = ? AND (is_locked = 1 OR
                (verification_status = 'verified' AND verified_by_uid IS NOT NULL AND verified_by_uid != '' AND verified_by_uid != 'system_auto_policy')))
            AND NOT EXISTS (SELECT 1 FROM work_weeks w JOIN work_logs l ON l.work_week_id = w.id WHERE l.id = ? AND w.is_locked = 1)`)
            .bind(snapshot.plan_segment_id, revision, body.request_id, preview.snapshot_hash, snapshotJson, token, authorization.user.uid, id, body.expected_revision, `wl_jurnal_${id}`, `wl_jurnal_${id}`),
        db.prepare(`UPDATE jurnal_guru SET tanggal = ?, kelas = ?, guru = ?, uid_guru = ?, mapel = ?, topik = ?, catatan = ?, jp = ?,
            lokasi_mengajar = ?, foto_url = ?, ttd = ?, presensi_detail = ?, updated_at = datetime('now') WHERE id = ?
            AND EXISTS (SELECT 1 FROM lms_journal_links WHERE journal_id = ? AND revision = ? AND request_id = ?)`)
            .bind(...params, id, id, revision, body.request_id)];
    }
    statements.push(db.prepare(`INSERT INTO lms_journal_evidence(token, journal_id, revision, snapshot_json)
        SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM lms_journal_links WHERE journal_id = ? AND revision = ? AND request_id = ?)`)
        .bind(token, id, revision, snapshotJson, id, revision, body.request_id));
    let saved;
    try { saved = await db.batch(statements); } catch (error) {
        if (/UNIQUE constraint/i.test(error.message)) lmsJournalFail('Jurnal sudah tersimpan di sesi lain. Muat ulang sebelum memperbarui.', 409);
        throw error;
    }
    if (!saved[0]?.meta?.changes) lmsJournalFail('Jurnal sudah berubah atau entri lain telah tersimpan. Muat ulang sebelum memperbarui.', 409);
    const journal = await db.prepare('SELECT * FROM jurnal_guru WHERE id = ?').bind(id).first();
    let workloadSync;
    try { workloadSync = await dependencies.syncJournalToWorkload(db, journal, authorization.user); }
    catch { workloadSync = { success: false, reason: 'Jurnal tersimpan; layanan e-Kinerja belum dapat dihubungi.' }; }
    return { success: true, id, revision, evidence_url: evidenceUrl, workloadSync };
}

export async function handleLmsJournalRequest(request, env, dependencies) {
    const url = new URL(request.url), path = url.pathname;
    try {
        const evidenceMatch = path.match(/^\/api\/lms\/journal\/evidence\/([a-f0-9]{64})\.svg$/);
        if (evidenceMatch && request.method === 'GET') {
            const evidence = await env.DB.prepare('SELECT snapshot_json, revision FROM lms_journal_evidence WHERE token = ?').bind(evidenceMatch[1]).first();
            if (!evidence) return errorResponse('Bukti tidak ditemukan.', 404, request);
            // Opaque capability URL shared through the journal. Never include NIS, signatures or correction reasons.
            return new Response(renderLmsJournalEvidence(JSON.parse(evidence.snapshot_json), evidence.revision), { headers: {
                ...getCorsHeaders(request),
                'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'private, max-age=86400',
                'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'none'; sandbox", 'Referrer-Policy': 'no-referrer'
            } });
        }
        const authorization = await dependencies.authorizeLmsEditor(request, env);
        if (!authorization.allowed) return errorResponse('Login guru diperlukan untuk membuat jurnal dari LMS.', authorization.status, request);
        const entryMatch = path.match(/^\/api\/lms\/journal\/entry\/(lmsj_[a-f0-9]{40})$/);
        if (entryMatch && request.method === 'GET') {
            const entry = await lmsJournalEntry(env.DB, entryMatch[1], authorization, dependencies), snapshot = entry.snapshot;
            if (url.searchParams.get('attendance_only') === '1') {
                const owner = await lmsJournalOwner(env.DB, { teacher_id: snapshot.lms_teacher_id || snapshot.uid_guru, teacher_name: snapshot.guru }, authorization);
                return jsonResponse({ success: true, material_id: (Array.isArray(snapshot.material_ids) && snapshot.material_ids[0]) || '', tanggal: snapshot.tanggal,
                    context: { scope: { class_name: snapshot.kelas, subject_name: snapshot.mapel, teacher_id: snapshot.uid_guru,
                        teacher_name: snapshot.guru, teacher_photo_url: lmsJournalTeacherPhoto(owner, request) },
                        materials: snapshot.materials, meetings: [],
                        existing: { id: entry.journal_id, revision: Number(entry.revision), owner_id: snapshot.uid_guru, snapshot } } }, 200, request);
            }
            const available = await env.DB.prepare(`SELECT m.* FROM lms_materials m JOIN lms_topics t ON t.id = m.topic_id
                WHERE m.teacher_id = ? AND m.class_name = ? AND m.subject_name = ? AND t.academic_year IS ? AND t.semester IS ? ORDER BY m.id`)
                .bind(snapshot.lms_teacher_id, snapshot.kelas, snapshot.mapel, snapshot.academic_year, snapshot.semester).all();
            const materials = available.results.filter(dependencies.isLmsMaterialPublished);
            const first = materials.find(material => snapshot.material_ids.includes(material.id));
            if (!first) return errorResponse('Materi sumber jurnal sudah tidak tersedia. Bukti yang disahkan tetap tersimpan; periksa data LMS sebelum memperbarui.', 409, request);
            return jsonResponse({ success: true, material_id: first.id, tanggal: snapshot.tanggal }, 200, request);
        }
        if (path === '/api/lms/journal/context' && request.method === 'GET') {
            const materials = await lmsJournalMaterials(env.DB, [url.searchParams.get('material_id')], authorization, dependencies);
            const scope = materials[0], owner = await lmsJournalOwner(env.DB, scope, authorization);
            const date = lmsJournalDate(url.searchParams.get('tanggal') || lmsJournalToday());
            const all = await env.DB.prepare(`SELECT m.id, m.title, m.is_published, m.publish_at FROM lms_materials m JOIN lms_topics t ON t.id = m.topic_id
                WHERE m.teacher_id = ? AND m.class_name = ? AND m.subject_name = ? AND t.academic_year IS ? AND t.semester IS ? ORDER BY m.order_index, m.id`)
                .bind(scope.teacher_id, scope.class_name, scope.subject_name, scope.academic_year, scope.semester).all();
            const segments = (await lmsJournalSegments(env.DB, owner.id, date)).filter(segment => lmsJournalSegmentMatches(segment, scope));
            const existing = await lmsJournalExisting(env.DB, scope, date);
            return jsonResponse({ success: true, scope: { class_name: scope.class_name, subject_name: scope.subject_name, teacher_id: owner.id, teacher_name: owner.name, teacher_photo_url: lmsJournalTeacherPhoto(owner, request) },
                materials: all.results.filter(dependencies.isLmsMaterialPublished), meetings: segments.map(segment => ({ ...segment, jp: lmsJournalSegmentJp(segment) })),
                existing: existing ? { id: existing.id, revision: Number(existing.lms_revision || 0), owner_id: existing.uid_guru,
                    snapshot: existing.lms_snapshot ? JSON.parse(existing.lms_snapshot) : null } : null }, 200, request);
        }
        if (request.method === 'POST' && ['/api/lms/journal/preview', '/api/lms/journal/save'].includes(path)) {
            const body = await request.json().catch(() => lmsJournalFail('Permintaan jurnal tidak valid.'));
            const receiptSecret = String(env.SESSION_SECRET || '').trim();
            if (path.endsWith('/preview')) {
                const preview = await lmsJournalPreview(env.DB, { ...body, snapshot_at: new Date().toISOString() }, authorization, dependencies);
                return jsonResponse({ success: true, ...preview, learning_receipt: await lmsJournalIssueReceipt(preview, authorization.user.uid, receiptSecret) }, 200, request);
            }
            return jsonResponse(await lmsJournalSave(env.DB, body, authorization, dependencies, request, receiptSecret), 200, request);
        }
        return errorResponse('Rute jurnal LMS tidak ditemukan.', 404, request);
    } catch (error) {
        if (/no such table|no such column/i.test(error.message)) return errorResponse('Integrasi jurnal LMS belum diaktifkan di server. Terapkan migrasi database fitur ini terlebih dahulu.', 503, request);
        if (!error.status) console.error('[LMS Journal]', error.message);
        return errorResponse(error.status ? error.message : 'Jurnal belum dapat diproses. Isian tetap tersedia; silakan coba lagi.', error.status || 500, request);
    }
}

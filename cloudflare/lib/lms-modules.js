import { validateLmsSchedule, getLmsScheduleState, decorateLmsTeachingState, normalizeLmsActivityTime } from '../../js/lms-schedule.mjs';
import { lmsHasMaterial, lmsHasQuiz, lmsHasDiscussion } from '../../js/lms-structure.mjs';
import { getLmsReadingState } from '../../js/lms-reading.mjs';
import { lmsTimeliness } from './lms-timeliness.js';

const text = (value, max = 16000) => String(value ?? '').trim().slice(0, max);
const flag = (value, fallback = 0) => value == null ? fallback : Number(value) === 1 ? 1 : Number(value) === 0 ? 0 : -1;
const same = (a, b) => text(a).toLowerCase() === text(b).toLowerCase();
const guard = "EXISTS (SELECT 1 FROM lms_modules accepted WHERE accepted.id=? AND accepted.revision=? AND accepted.last_request_id=?)";

function normalizePacket(packet, index, normalizeQuiz) {
    const prefix = `Bahan Ajar ${index + 1}: `;
    if (!packet || typeof packet !== 'object' || Array.isArray(packet)) throw new Error(prefix + 'data tidak valid.');
    const material = flag(packet.material_enabled), quiz = flag(packet.quiz_enabled), discussion = flag(packet.allow_discussion);
    if (![material, quiz, discussion].every(value => value === 0 || value === 1) || !(material || quiz || discussion)) throw new Error(prefix + 'aktifkan minimal satu bagian: Materi, Kuis Formatif / CBT, atau Forum Diskusi.');
    const title = text(packet.title, 300);
    if (!title) throw new Error(prefix + 'judul wajib diisi.');
    const type = packet.resource_type === 'quiz' ? 'text' : packet.resource_type || 'text';
    if (!['text', 'html', 'link', 'youtube', 'gdrive'].includes(type)) throw new Error(prefix + 'format Materi tidak valid.');
    const content = String(packet.content_description || '');
    if (type === 'html' && new TextEncoder().encode(content).length > 512 * 1024) throw new Error(prefix + 'HTML maksimal 512 KB.');
    let url = text(packet.resource_url, 4000);
    if (material) {
        if (type === 'html') {
            if (!content.trim()) throw new Error(prefix + 'kode HTML wajib diisi.');
            url = '';
        } else if (type === 'text' && !content.trim()) throw new Error(prefix + 'isi Materi wajib diisi.');
        else if (type !== 'text') {
            try {
                const parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`);
                if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname) throw new Error();
                url = parsed.href;
            } catch { throw new Error(prefix + 'tautan Materi harus berupa URL HTTP(S) yang valid.'); }
        }
    }
    if (type !== 'html' && content.length > 100000) throw new Error(prefix + 'isi Materi terlalu panjang.');
    if (String(packet.instructions || '').length > 16000 || String(packet.html_instructions || '').length > 16000) throw new Error(prefix + 'petunjuk maksimal 16.000 karakter.');
    let quizPayload = typeof packet.quiz_payload === 'string' ? packet.quiz_payload : JSON.stringify(packet.quiz_payload || {});
    if (quizPayload.length > 250000) throw new Error(prefix + 'isi kuis terlalu besar.');
    if (quiz) {
        try { quizPayload = JSON.stringify(normalizeQuiz(quizPayload)); } catch (error) { throw new Error(prefix + error.message); }
    }
    const prompt = text(packet.discussion_prompt, 5000);
    if (discussion && !prompt) throw new Error(prefix + 'pemantik Forum Diskusi wajib diisi.');
    return { id: text(packet.id, 160) || `packet_${crypto.randomUUID()}`, title, resource_type: type,
        content_description: content, resource_url: url, html_instructions: text(packet.html_instructions), instructions: text(packet.instructions),
        material_enabled: material, quiz_enabled: quiz, quiz_payload: quizPayload, allow_discussion: discussion, discussion_prompt: prompt, order_index: index + 1 };
}

async function getModule(db, id) { return db.prepare('SELECT * FROM lms_modules WHERE id=? AND is_deleted=0').bind(id).first(); }
async function packetsFor(db, id) {
    return (await db.prepare('SELECT * FROM lms_materials WHERE module_id=? AND is_archived=0 ORDER BY order_index,created_at,id').bind(id).all()).results || [];
}
async function moduleDto(db, module) {
    return { ...decorateLmsTeachingState({ ...module, is_published: module.is_visible ? 2 : 0 }), packets: await packetsFor(db, module.id) };
}

function packetStatement(db, module, packet, revision, requestId, minimum) {
    return db.prepare(`INSERT INTO lms_materials
        (id,module_id,topic_id,teacher_id,teacher_name,subject_name,class_name,title,instructions,
        content_description,html_instructions,resource_type,resource_url,quiz_payload,material_enabled,quiz_enabled,
        allow_discussion,discussion_prompt,is_published,publish_at,due_date,is_teaching_completed,teaching_completed_at,order_index,minimum_read_seconds,is_archived)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0 WHERE ${guard}
        ON CONFLICT(id) DO UPDATE SET title=excluded.title,instructions=excluded.instructions,
            content_description=excluded.content_description,html_instructions=excluded.html_instructions,
            resource_type=excluded.resource_type,resource_url=excluded.resource_url,quiz_payload=excluded.quiz_payload,
            material_enabled=excluded.material_enabled,quiz_enabled=excluded.quiz_enabled,allow_discussion=excluded.allow_discussion,
            discussion_prompt=excluded.discussion_prompt,is_published=excluded.is_published,publish_at=excluded.publish_at,
            due_date=excluded.due_date,is_teaching_completed=excluded.is_teaching_completed,teaching_completed_at=excluded.teaching_completed_at,
            order_index=excluded.order_index,is_archived=0,updated_at=excluded.updated_at`)
        .bind(packet.id, module.id, module.topic_id, module.teacher_id, module.teacher_name, module.subject_name, module.class_name,
            packet.title, packet.instructions, packet.content_description, packet.html_instructions, packet.resource_type, packet.resource_url,
            packet.quiz_payload, packet.material_enabled, packet.quiz_enabled, packet.allow_discussion, packet.discussion_prompt,
            module.is_visible ? 2 : 0, module.publish_at, module.due_date, module.is_teaching_completed, module.teaching_completed_at,
            packet.order_index, minimum, module.id, revision, requestId);
}

async function moduleProgress(db, module) {
    const packets = await packetsFor(db, module.id);
    const students = (await db.prepare(`SELECT s.nis,s.name,s.class,s.gender,sp.active_photo_url FROM students s
        LEFT JOIN student_photos sp ON sp.nis=s.nis WHERE LOWER(TRIM(s.class))=LOWER(TRIM(?))
        AND (LOWER(s.status) IN ('active','aktif') OR s.status IS NULL OR s.status='') ORDER BY s.name`).bind(module.class_name).all()).results || [];
    const progress = (await db.prepare(`SELECT p.*,
        (SELECT COUNT(*) FROM lms_discussions d WHERE d.material_id=p.material_id AND d.user_id=p.student_nis AND d.user_role='siswa' AND d.is_hidden=0) AS response_count
        FROM lms_progress p JOIN lms_materials m ON m.id=p.material_id WHERE m.module_id=? AND m.is_archived=0`).bind(module.id).all()).results || [];
    const rows = students.map(student => {
        const details = packets.map(packet => {
            const p = progress.find(row => row.material_id === packet.id && String(row.student_nis) === String(student.nis));
            const reading = getLmsReadingState(packet, p);
            const completed = Boolean(p?.first_opened_at) && reading.reading_complete && (!lmsHasQuiz(packet) || p.status === 'completed') && (!lmsHasDiscussion(packet) || p.response_count > 0);
            return { id: packet.id, title: packet.title, ...reading, ...lmsTimeliness(p), status: completed ? 'completed' : p?.first_opened_at ? 'opened' : 'not_started',
                first_opened_at: p?.first_opened_at || '', completed_at: completed ? p?.completed_at || reading.reading_completed_at : '',
                active_seconds_total: Number(p?.active_seconds_total) || 0, session_count: Number(p?.session_count) || 0,
                quiz_score: lmsHasQuiz(packet) ? p?.quiz_score ?? null : null, has_quiz: lmsHasQuiz(packet) };
        });
        const completed = details.length > 0 && details.every(detail => detail.status === 'completed');
        const times = key => details.map(d => normalizeLmsActivityTime(d[key])).filter(Boolean).sort();
        const scored = details.filter(d => d.quiz_score != null);
        return { ...student, packets: details, completed_packets: details.filter(d => d.status === 'completed').length, total_packets: details.length,
            status: completed ? 'completed' : details.some(d => d.first_opened_at) ? 'opened' : 'not_started',
            first_opened_at: times('first_opened_at')[0] || '', completed_at: completed ? times('completed_at').at(-1) || '' : '',
            active_seconds_total: details.reduce((sum, d) => sum + d.active_seconds_total, 0), session_count: details.reduce((sum, d) => sum + d.session_count, 0),
            quiz_score: scored.length ? Math.round(scored.reduce((sum, d) => sum + Number(d.quiz_score), 0) / scored.length) : null,
            ...lmsTimeliness(details.find(d => d.is_late)) };
    });
    return { material: { ...decorateLmsTeachingState({ ...module, is_published: module.is_visible ? 2 : 0 }), resource_type: 'module', is_module: true },
        packets, data: rows, summary: { total_students: rows.length, completed_count: rows.filter(r => r.status === 'completed').length,
            opened_count: rows.filter(r => r.status === 'opened').length, not_started_count: rows.filter(r => r.status === 'not_started').length,
            late_count: rows.filter(r => r.is_late).length } };
}

export async function handleLmsModuleRequest(request, env, path, method, deps) {
    if (!path.startsWith('/api/lms/modules')) return null;
    const { authorizeLmsEditor, canManageLmsResource, isManager, normalizeLmsQuiz, jsonResponse, errorResponse, autoSubmitExpiredStrictQuizzes } = deps;
    const auth = await authorizeLmsEditor(request, env);
    if (!auth.allowed) return errorResponse('Hak akses pengelola LMS diperlukan.', auth.status, request);
    const url = new URL(request.url), db = env.DB;
    try {
        if (path === '/api/lms/modules' && method === 'GET') {
            const clauses = ['is_deleted=0'], args = [];
            for (const [parameter, column] of [['class', 'class_name'], ['subject', 'subject_name'], ['topic_id', 'topic_id']]) {
                if (url.searchParams.get(parameter)) { clauses.push(`LOWER(TRIM(${column}))=LOWER(TRIM(?))`); args.push(url.searchParams.get(parameter)); }
            }
            if (!isManager(auth)) { clauses.push('teacher_id=?'); args.push(auth.user.uid); }
            const modules = (await db.prepare(`SELECT * FROM lms_modules WHERE ${clauses.join(' AND ')} ORDER BY order_index,created_at,id`).bind(...args).all()).results || [];
            const data = [];
            for (const module of modules) data.push(await moduleDto(db, module));
            return jsonResponse({ success: true, data }, 200, request);
        }
        const match = path.match(/^\/api\/lms\/modules\/([^/]+)(?:\/(settings|progress))?$/);
        if (match) {
            const module = await getModule(db, decodeURIComponent(match[1]));
            if (!module) {
                if (method === 'DELETE' && !match[2]) return jsonResponse({ success: true, message: 'Modul sudah tidak ada di server (telah terhapus).', already_deleted: true }, 200, request);
                return errorResponse('Modul tidak ditemukan.', 404, request);
            }
            if (!canManageLmsResource(auth, module)) return errorResponse('Modul bukan milik Anda.', 403, request);
            if (method === 'GET' && match[2] === 'progress') return jsonResponse({ success: true, ...await moduleProgress(db, module) }, 200, request);
            if (method === 'GET' && !match[2]) return jsonResponse({ success: true, data: await moduleDto(db, module) }, 200, request);
            if (method === 'DELETE' && !match[2]) {
                await db.batch([db.prepare('UPDATE lms_modules SET is_deleted=1,is_visible=0,revision=revision+1,updated_at=? WHERE id=?').bind(new Date(Date.now()).toISOString(), module.id),
                    db.prepare('UPDATE lms_materials SET is_archived=1,is_published=0 WHERE module_id=?').bind(module.id)]);
                return jsonResponse({ success: true }, 200, request);
            }
            if (method === 'POST' && match[2] === 'settings') {
                const body = await request.json();
                if (Number(body.revision) !== module.revision) return errorResponse('Modul telah berubah. Muat ulang sebelum mengubah pengaturannya.', 409, request);
                const visible = flag(body.is_visible, module.is_visible);
                if (visible < 0) return errorResponse('Pilihan tampil ke siswa tidak valid.', 400, request);
                const requestId = crypto.randomUUID(), revision = module.revision + 1;
                const result = await db.batch([
                    db.prepare('UPDATE lms_modules SET is_visible=?,revision=?,last_request_id=?,updated_at=? WHERE id=? AND revision=?')
                        .bind(visible, revision, requestId, new Date(Date.now()).toISOString(), module.id, module.revision),
                    db.prepare(`UPDATE lms_materials SET is_published=? WHERE module_id=? AND ${guard}`).bind(visible ? 2 : 0, module.id, module.id, revision, requestId)
                ]);
                if (!result[0].meta?.changes) return errorResponse('Modul telah berubah. Muat ulang.', 409, request);
                return jsonResponse({ success: true, data: await moduleDto(db, await getModule(db, module.id)) }, 200, request);
            }
        }
        if (path === '/api/lms/modules' && method === 'POST') {
            const raw = await request.text();
            if (new TextEncoder().encode(raw).length > 8 * 1024 * 1024) throw new Error('Isi modul maksimal 8 MB.');
            const body = JSON.parse(raw);
            if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Data Modul tidak valid.');
            const id = text(body.id, 160) || `module_${crypto.randomUUID()}`;
            const requestId = text(body.request_id, 160) || crypto.randomUUID();
            const existing = await getModule(db, id);
            if (existing && !canManageLmsResource(auth, existing)) return errorResponse('Modul bukan milik Anda.', 403, request);
            if (existing?.last_request_id === requestId) return jsonResponse({ success: true, id, data: await moduleDto(db, existing) }, 200, request);
            if (existing && Number(body.revision) !== existing.revision) return errorResponse('Modul telah diperbarui di sesi lain. Isian Anda dipertahankan; muat ulang sebelum menyimpan.', 409, request);
            const topic = await db.prepare('SELECT * FROM lms_topics WHERE id=?').bind(text(body.topic_id)).first();
            if (!topic) return errorResponse('Topik/Bab tidak ditemukan.', 404, request);
            if (!canManageLmsResource(auth, topic)) return errorResponse('Topik/Bab bukan milik Anda.', 403, request);
            if (existing && existing.topic_id !== topic.id) return errorResponse('Modul yang sudah digunakan tidak dapat dipindah ke topik lain.', 409, request);
            if ((body.class_name && !same(body.class_name, topic.class_name)) || (body.subject_name && !same(body.subject_name, topic.subject_name))) return errorResponse('Kelas/mapel modul harus sesuai Topik/Bab.', 409, request);
            const title = text(body.title, 300);
            if (!title) throw new Error('Nama Modul wajib diisi.');
            const schedule = validateLmsSchedule(body.publish_at, body.due_date);
            const teaching = flag(body.is_teaching_completed), visible = flag(body.is_visible, 1);
            if (teaching < 0 || visible < 0) throw new Error('Pengaturan modul tidak valid.');
            if (existing && getLmsScheduleState({ ...existing, is_published: existing.is_visible ? 2 : 0 }).teachingCompleted && !teaching && Date.parse(schedule.due_date) <= Date.now()) throw new Error('Aktifkan kembali Modul dengan target selesai baru yang masih akan datang.');
            if (!Array.isArray(body.packets) || !body.packets.length || body.packets.length > 25) throw new Error('Modul harus berisi 1–25 Bahan Ajar.');
            const packets = body.packets.map((packet, i) => normalizePacket(packet, i, normalizeLmsQuiz));
            if (new Set(packets.map(p => p.id)).size !== packets.length) throw new Error('Identitas Bahan Ajar tidak boleh berulang.');
            for (const packet of packets) {
                const old = await db.prepare('SELECT id,module_id FROM lms_materials WHERE id=?').bind(packet.id).first();
                if (old && old.module_id !== id) return errorResponse('Bahan Ajar tidak berasal dari modul ini.', 403, request);
            }
            const oldSchedule = existing ? getLmsScheduleState({ ...existing, is_published: 2 }) : null;
            const completedAt = teaching ? existing?.teaching_completed_at || (oldSchedule?.teachingCompleted ? oldSchedule.cutoffAt : '') || new Date(Date.now()).toISOString() : '';
            const module = { id, topic_id: topic.id, teacher_id: topic.teacher_id, teacher_name: topic.teacher_name, subject_name: topic.subject_name, class_name: topic.class_name,
                title, description: text(body.description), ...schedule, is_visible: visible, is_teaching_completed: teaching, teaching_completed_at: completedAt,
                order_index: Math.max(0, Number(body.order_index) || 0) };
            const revision = (existing?.revision || 0) + 1, now = new Date(Date.now()).toISOString();
            const statements = [existing
                ? db.prepare(`UPDATE lms_modules SET title=?,description=?,is_visible=?,publish_at=?,due_date=?,is_teaching_completed=?,teaching_completed_at=?,order_index=?,revision=?,last_request_id=?,updated_at=? WHERE id=? AND revision=?`)
                    .bind(module.title, module.description, visible, schedule.publish_at, schedule.due_date, teaching, completedAt, module.order_index, revision, requestId, now, id, existing.revision)
                : db.prepare(`INSERT OR IGNORE INTO lms_modules(id,topic_id,teacher_id,teacher_name,subject_name,class_name,title,description,is_visible,publish_at,due_date,is_teaching_completed,teaching_completed_at,order_index,revision,last_request_id,updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, topic.id, topic.teacher_id, topic.teacher_name, topic.subject_name, topic.class_name, title, module.description, visible,
                    schedule.publish_at, schedule.due_date, teaching, completedAt, module.order_index, revision, requestId, now)];
            const minimum = Number.isFinite(Number(env.LMS_MINIMUM_READING_SECONDS)) ? Math.max(0, Math.min(3600, Number(env.LMS_MINIMUM_READING_SECONDS))) : 300;
            for (const packet of packets) statements.push(packetStatement(db, module, packet, revision, requestId, minimum));
            const ids = packets.map(packet => packet.id);
            statements.push(db.prepare(`UPDATE lms_materials SET is_archived=1,is_published=0 WHERE module_id=? AND id NOT IN (${ids.map(() => '?').join(',')}) AND ${guard}`).bind(id, ...ids, id, revision, requestId));
            const results = await db.batch(statements);
            if (!results[0].meta?.changes) return errorResponse('Modul telah berubah. Muat ulang sebelum menyimpan.', 409, request);
            if (autoSubmitExpiredStrictQuizzes && (teaching === 1 || Date.parse(schedule.due_date) <= Date.now())) {
                for (const packet of packets) {
                    if (packet.quiz_enabled && packet.quiz_payload) {
                        try {
                            const fullMat = await db.prepare('SELECT * FROM lms_materials WHERE id=?').bind(packet.id).first();
                            if (fullMat) await autoSubmitExpiredStrictQuizzes(env, fullMat);
                        } catch (_) {}
                    }
                }
            }
            return jsonResponse({ success: true, id, data: await moduleDto(db, await getModule(db, id)) }, 200, request);
        }
        return errorResponse('Aksi modul tidak tersedia.', 404, request);
    } catch (error) {
        return errorResponse(error instanceof SyntaxError ? 'Data Modul tidak valid.' : error.message, 400, request);
    }
}

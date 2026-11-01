import { validateRubric, canApproveSubmission, calculateTotal } from '../../js/ai-grading-core.mjs';

const verifiedAiAssessmentStorage = new WeakSet();
const AI_ASSESSMENT_ROLES = new Set(['guru', 'guru_mapel', 'super_admin', 'kepala_sekolah', 'wakasek_kurikulum']);
export async function ensureAiAssessmentStorage(db) {
    if (verifiedAiAssessmentStorage.has(db)) return;
    await db.prepare(`CREATE TABLE IF NOT EXISTS ai_grading_sessions (
        id TEXT PRIMARY KEY, teacher_id TEXT, kelas TEXT NOT NULL, mapel TEXT NOT NULL,
        semester TEXT NOT NULL, tahun_ajaran TEXT NOT NULL, title TEXT NOT NULL,
        total_max_score REAL DEFAULT 100, questions_json TEXT NOT NULL DEFAULT '[]', submissions_json TEXT NOT NULL DEFAULT '{}',
        revision INTEGER NOT NULL DEFAULT 0, client_updated_at TEXT NOT NULL DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    )`).run();
    const { results = [] } = await db.prepare('PRAGMA table_info(ai_grading_sessions)').all();
    for (const [column, definition] of [['revision', 'INTEGER NOT NULL DEFAULT 0'], ['client_updated_at', "TEXT NOT NULL DEFAULT ''"]]) {
        if (!results.some(row => row.name === column)) {
            try { await db.prepare(`ALTER TABLE ai_grading_sessions ADD COLUMN ${column} ${definition}`).run(); }
            catch (error) { if (!/duplicate column/i.test(error.message)) throw error; }
        }
    }
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_ai_grading_teacher ON ai_grading_sessions(teacher_id)').run();
    verifiedAiAssessmentStorage.add(db);
}

export async function handleAiGradingSessionRequest(request, env, path, method, deps) {
    const { verifyFirebaseToken, jsonResponse, errorResponse } = deps;
    const authResult = await verifyFirebaseToken(request, env);
    if (!authResult.valid || !authResult.user?.uid) return errorResponse('Sesi login guru tidak valid.', 401, request);
    const user = authResult.user, teacherId = user.uid;
    const roles = [user.role, ...(Array.isArray(user.additionalRoles) ? user.additionalRoles : [])];
    if (!roles.some(role => AI_ASSESSMENT_ROLES.has(role))) return errorResponse('Hak akses guru mata pelajaran diperlukan.', 403, request);
    await ensureAiAssessmentStorage(env.DB);
    const db = env.DB, match = path.match(/^\/api\/ai-grading\/sessions\/([^/]+)$/);
    const id = match ? decodeURIComponent(match[1]) : '';
    const isOwner = row => row?.teacher_id === teacherId;
    if (method === 'GET' && id) {
        const row = await db.prepare('SELECT * FROM ai_grading_sessions WHERE id = ? LIMIT 1').bind(id).first();
        if (!row) return errorResponse('Sesi penilaian AI tidak ditemukan.', 404, request);
        if (!isOwner(row)) return errorResponse('Anda tidak berhak membuka sesi penilaian AI milik guru lain.', 403, request);
        let questions, submissions;
        try { questions = JSON.parse(row.questions_json); submissions = JSON.parse(row.submissions_json); }
        catch (_) { return errorResponse('Data sesi rusak. Draf lokal Anda tetap tersedia.', 500, request); }
        return jsonResponse({ success:true, data:{ ...row, questions, submissions, updatedAt:row.client_updated_at || row.updated_at.replace(' ', 'T') + 'Z' } },200,request);
    }
    if (method === 'GET' && !id && /^\/api\/ai-grading\/sessions\/?$/.test(path)) {
        const url = new URL(request.url), params = [teacherId];
        let sql = 'SELECT id, teacher_id, kelas, mapel, semester, tahun_ajaran, title, revision, client_updated_at, created_at, updated_at FROM ai_grading_sessions WHERE teacher_id = ?';
        for (const [param, column] of [['kelas','kelas'],['mapel','mapel'],['semester','semester'],['tahunAjaran','tahun_ajaran']]) {
            const value = url.searchParams.get(param)?.trim();
            if (value) { sql += ` AND ${column} = ?`; params.push(value); }
        }
        const requestedLimit = Number(url.searchParams.get('limit')) || 50;
        params.push(Math.min(100, Math.max(1, Math.floor(requestedLimit))));
        const { results = [] } = await db.prepare(sql + ' ORDER BY updated_at DESC LIMIT ?').bind(...params).all();
        return jsonResponse({ success:true, data:results },200,request);
    }
    if (method === 'POST' && /^\/api\/ai-grading\/sessions\/?$/.test(path)) {
        const text = await request.text();
        if (new TextEncoder().encode(text).length > 2 * 1024 * 1024) return errorResponse('Sesi terlalu besar (maksimal 2 MB teks). Bagi asesmen menjadi beberapa sesi.',413,request);
        let body;
        try { body = JSON.parse(text); } catch (_) { return errorResponse('Payload sesi tidak valid.',400,request); }
        if (!body || Array.isArray(body) || typeof body !== 'object') return errorResponse('Payload sesi tidak valid.',400,request);
        const clean = (value,max) => typeof value === 'string' ? value.trim().slice(0,max) : '';
        const sessionId = clean(body.sessionId || body.id,160);
        const kelas = clean(body.kelas,80), mapel = clean(body.mapel,150), semester = clean(body.semester,1);
        const tahunAjaran = clean(body.tahunAjaran || body.tahun_ajaran,20), title = clean(body.title,300) || `Asesmen ${mapel} ${kelas}`;
        if (!/^[a-zA-Z0-9_-]+$/.test(sessionId) || !kelas || !mapel || !['1','2'].includes(semester) || !/^\d{4}\/\d{4}$/.test(tahunAjaran)) return errorResponse('ID, kelas, mapel, semester, dan tahun ajaran sesi harus valid.',400,request);
        const questions = body.questions, submissions = body.submissions;
        if (!Array.isArray(questions) || questions.length > 200 || !submissions || Array.isArray(submissions) || typeof submissions !== 'object' || Object.keys(submissions).length > 200) return errorResponse('Struktur rubrik atau jawaban siswa tidak valid.',400,request);
        if (questions.some(q => !q || typeof q !== 'object' || typeof q.no !== 'string' && typeof q.no !== 'number' || !Number.isFinite(Number(q.maxScore)) || Number(q.maxScore) <= 0)) return errorResponse('Nomor dan bobot soal tidak valid.',400,request);
        // Files are ephemeral: reject accidental image/PDF persistence at the trust boundary.
        for (const sub of Object.values(submissions)) {
            if (!sub || typeof sub !== 'object' || sub.imageBase64 || sub.dataUrl || (Array.isArray(sub.pages) && sub.pages.some(page => page.base64 || page.dataUrl))) return errorResponse('Foto/PDF tidak boleh disimpan dalam sesi.',400,request);
            if (sub.isApproved) {
                try { validateRubric(questions); } catch (error) { return errorResponse(error.message,400,request); }
                if (!canApproveSubmission(sub,questions) || sub.totalOverride != null && (!Number.isFinite(sub.totalOverride) || sub.totalOverride < 0 || sub.totalOverride > 100 || !sub.overrideReason?.trim())) return errorResponse('Hasil disetujui harus lengkap dan sesuai rubrik aktif.',400,request);
                sub.totalScore = sub.totalOverride ?? calculateTotal(sub.scores,questions);
                sub.approvedBy = teacherId;
            }
        }
        const existing = await db.prepare('SELECT id, teacher_id, revision FROM ai_grading_sessions WHERE id = ? LIMIT 1').bind(sessionId).first();
        if (existing && !isOwner(existing)) return errorResponse('Anda tidak berhak mengubah sesi penilaian AI milik guru lain.',403,request);
        const expected = body.expectedRevision === undefined ? 0 : body.expectedRevision;
        if (!Number.isInteger(expected) || expected < 0 || existing && Number(existing.revision) !== expected || !existing && expected !== 0) return errorResponse('Konflik versi: sesi cloud memiliki versi lebih baru. Buka ulang sesi; draf lokal dipertahankan.',409,request);
        const updatedAt = clean(body.updatedAt,40);
        const validTime = Number.isFinite(Date.parse(updatedAt)) ? updatedAt : new Date().toISOString();
        const result = await db.prepare(`INSERT INTO ai_grading_sessions
            (id,teacher_id,kelas,mapel,semester,tahun_ajaran,title,total_max_score,questions_json,submissions_json,revision,client_updated_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,1,?,datetime('now'))
            ON CONFLICT(id) DO UPDATE SET kelas=excluded.kelas,mapel=excluded.mapel,semester=excluded.semester,
                tahun_ajaran=excluded.tahun_ajaran,title=excluded.title,total_max_score=excluded.total_max_score,
                questions_json=excluded.questions_json,submissions_json=excluded.submissions_json,
                revision=ai_grading_sessions.revision+1,client_updated_at=excluded.client_updated_at,updated_at=datetime('now')
            WHERE ai_grading_sessions.teacher_id=? AND ai_grading_sessions.revision=?`)
            .bind(sessionId,teacherId,kelas,mapel,semester,tahunAjaran,title,questions.reduce((sum,q)=>sum+Number(q.maxScore),0),
                JSON.stringify(questions),JSON.stringify(submissions),validTime,teacherId,expected).run();
        if (result.meta?.changes === 0) return errorResponse('Konflik versi: sesi telah berubah. Buka ulang sesi sebelum menyimpan.',409,request);
        return jsonResponse({ success:true, sessionId, revision:expected + 1, updatedAt:validTime },200,request);
    }
    if (method === 'DELETE' && id) {
        const existing = await db.prepare('SELECT id, teacher_id FROM ai_grading_sessions WHERE id = ? LIMIT 1').bind(id).first();
        if (!existing) return errorResponse('Sesi penilaian AI tidak ditemukan.',404,request);
        if (!isOwner(existing)) return errorResponse('Anda tidak berhak menghapus sesi penilaian AI milik guru lain.',403,request);
        await db.prepare('DELETE FROM ai_grading_sessions WHERE id = ? AND teacher_id = ?').bind(id,teacherId).run();
        return jsonResponse({success:true},200,request);
    }
    return errorResponse('Endpoint AI grading tidak ditemukan.',404,request);
}

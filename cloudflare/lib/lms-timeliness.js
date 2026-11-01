import { getLmsScheduleState } from '../../js/lms-schedule.mjs';
import { lmsHasMaterial, lmsHasQuiz } from '../../js/lms-structure.mjs';
import { getLmsReadingState } from '../../js/lms-reading.mjs';

/** Append to the same D1 transaction as accepted student work. Never trusts client dates. */
export function lmsLateActivityStatement(db, material, studentNis, now = Date.now(), guard = null) {
    const schedule = getLmsScheduleState(material, now);
    if (!schedule.isAccessible || !schedule.teachingCompleted || !schedule.cutoffAt || now < Date.parse(schedule.cutoffAt)) return null;
    // Completion before the cutoff is established from student activity, not
    // from when a teacher eventually grades an essay. A pending review cannot
    // start a retake, so it is safe to protect its on-time submission here too.
    return db.prepare(`UPDATE lms_progress SET late_started_at = ?, late_cutoff_at = ?
        WHERE material_id = ? AND student_nis = ? AND COALESCE(late_started_at, '') = ''
        AND NOT (
            COALESCE(julianday(first_opened_at) < julianday(?), 0)
            AND (? <= 0 OR ? = 'quiz' OR COALESCE(julianday(reading_completed_at) < julianday(?), 0)
                OR (status = 'completed' AND COALESCE(julianday(completed_at) < julianday(?), 0))
                OR (? = 1 AND julianday(first_opened_at) + ? / 86400.0 < julianday(?)))
            AND (? != 1 OR EXISTS (SELECT 1 FROM lms_discussions d
                WHERE d.material_id = lms_progress.material_id AND d.user_id = lms_progress.student_nis
                AND d.user_role = 'siswa' AND d.is_hidden = 0 AND julianday(d.created_at) < julianday(?)))
            AND (? != 'quiz' OR EXISTS (SELECT 1 FROM lms_quiz_attempts a
                WHERE a.material_id = lms_progress.material_id AND a.student_nis = lms_progress.student_nis
                AND julianday(a.submitted_at) < julianday(?)
                AND (a.status = 'pending_review' OR (a.status = 'graded' AND json_extract(CASE WHEN json_valid(a.result) THEN a.result ELSE '{}' END, '$.passed') = 1)))
                OR (status = 'completed' AND julianday(completed_at) < julianday(?)
                    AND NOT EXISTS (SELECT 1 FROM lms_quiz_attempts old WHERE old.material_id = lms_progress.material_id
                        AND old.student_nis = lms_progress.student_nis)))
        ) ${guard ? 'AND EXISTS (SELECT 1 FROM lms_quiz_attempts accepted WHERE accepted.id = ? AND accepted.revision = ?)' : ''}`)
        .bind(new Date(now).toISOString(), schedule.cutoffAt, material.id, String(studentNis),
            schedule.cutoffAt, lmsHasMaterial(material) ? Number(material.minimum_read_seconds) || 0 : 0, '', schedule.cutoffAt, schedule.cutoffAt,
            getLmsReadingState(material).reading_mode === 'external' ? 1 : 0, Number(material.minimum_read_seconds) || 0, schedule.cutoffAt,
            Number(material.allow_discussion) || 0, schedule.cutoffAt,
            lmsHasQuiz(material) ? 'quiz' : '', schedule.cutoffAt, schedule.cutoffAt, ...(guard ? [guard.id, guard.revision] : []));
}

export function lmsTimeliness(progress) {
    return { is_late: Boolean(progress?.late_started_at), late_started_at: progress?.late_started_at || '',
        late_cutoff_at: progress?.late_cutoff_at || '' };
}

export async function runLmsStudentStatements(db, statements, material, studentNis, now = Date.now(), guard = null) {
    const late = lmsLateActivityStatement(db, material, studentNis, now, guard);
    return db.batch(late ? [...statements, late] : statements);
}

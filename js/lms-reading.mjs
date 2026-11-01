import { normalizeLmsActivityTime } from './lms-schedule.mjs';
import { resolveLmsResourceLink } from './lms-resource-link.mjs';
import { lmsHasMaterial } from './lms-structure.mjs';

export function boundLmsActiveSeconds(material, progress, claimed, now = Date.now()) {
    if (!(Number(material.minimum_read_seconds) > 0)) return claimed;
    const first = Date.parse(normalizeLmsActivityTime(progress.first_opened_at));
    const checkpoint = Date.parse(normalizeLmsActivityTime(progress.updated_at || progress.first_opened_at));
    if (!Number.isFinite(first) || !Number.isFinite(checkpoint)) return Number(progress.active_seconds_total) || 0;
    return Math.max(0, Math.min(claimed, Math.floor((now - first) / 1000),
        (Number(progress.active_seconds_total) || 0) + Math.max(0, Math.floor((now - checkpoint) / 1000))));
}

export function getLmsReadingState(material, progress = {}, now = Date.now()) {
    const hasMaterial = lmsHasMaterial(material);
    const required = !hasMaterial ? 0 : Math.max(0, Math.min(3600, Number(material.minimum_read_seconds) || 0));
    const first = normalizeLmsActivityTime(progress?.first_opened_at || progress?.my_first_opened_at);
    const parsedFirst = Date.parse(first);
    const opened = Boolean(first && Number.isFinite(parsedFirst));
    const external = !['text', 'html', 'quiz'].includes(material?.resource_type) &&
        Boolean(material?.resource_url && !resolveLmsResourceLink(material?.resource_url, material?.resource_type, "https://simas-demo-5ead3.web.app")?.embedUrl);
    const elapsed = opened ? Math.max(0, Math.floor((now - parsedFirst) / 1000)) : 0;
    const active = Math.min(elapsed, Math.max(0, Number(progress?.active_seconds_total ?? progress?.my_active_seconds_total) || 0));
    const measured = external ? elapsed : active;
    const verified = progress?.reading_completed_at || progress?.my_reading_completed_at || '';
    const completed = !hasMaterial || (opened && (Boolean(verified) || (progress?.status || progress?.my_status) === 'completed' || measured >= required));

    let completedAt = verified || '';
    if (!completedAt && completed && hasMaterial) {
        if (external && opened && Number.isFinite(parsedFirst)) {
            completedAt = new Date(parsedFirst + required * 1000).toISOString();
        } else {
            completedAt = new Date(now).toISOString();
        }
    }

    return {
        reading_complete: completed,
        reading_mode: material?.resource_type === 'quiz' ? 'quiz' : external ? 'external' : 'active',
        reading_required_seconds: required,
        reading_active_seconds: active,
        reading_remaining_seconds: completed ? 0 : Math.max(0, required - measured),
        reading_completed_at: completedAt
    };
}

import { getLmsScheduleState } from './lms-schedule.mjs';

// Nullable flags keep old records/clients readable during the migration.
export function lmsHasMaterial(packet) {
    return packet?.material_enabled == null ? packet?.resource_type !== 'quiz' : Number(packet.material_enabled) === 1;
}
export function lmsHasQuiz(packet) {
    return packet?.quiz_enabled == null ? packet?.resource_type === 'quiz' : Number(packet.quiz_enabled) === 1;
}
export function lmsHasDiscussion(packet) { return Number(packet?.allow_discussion) === 1; }

export function groupLmsModules(packets = []) {
    const groups = new Map();
    for (const packet of Array.isArray(packets) ? packets : []) {
        const id = packet.module_id || `legacy_${packet.id}`;
        if (!groups.has(id)) groups.set(id, {
            id, topic_id: packet.topic_id, title: packet.module_title || packet.title,
            description: packet.module_description || '', class_name: packet.class_name, subject_name: packet.subject_name,
            teacher_id: packet.teacher_id, teacher_name: packet.teacher_name,
            order_index: packet.module_order ?? packet.order_index ?? 0,
            is_published: packet.is_published, publish_at: packet.publish_at, due_date: packet.due_date,
            is_teaching_completed: packet.is_teaching_completed, teaching_completed_at: packet.teaching_completed_at,
            teaching_status_source: packet.teaching_status_source, packets: []
        });
        groups.get(id).packets.push(packet);
    }
    return [...groups.values()].map(module => {
        module.packets.sort((a, b) => (Number(a.order_index) || 0) - (Number(b.order_index) || 0) || String(a.id).localeCompare(String(b.id)));
        const done = module.packets.filter(packet => packet.requirement_met).length;
        return { ...module, completed_packets: done, total_packets: module.packets.length,
            is_completed: done === module.packets.length, is_locked: Boolean(module.packets[0]?.is_locked),
            is_late: module.packets.some(packet => packet.is_late), schedule: getLmsScheduleState(module) };
    }).sort((a, b) => (Number(a.order_index) || 0) - (Number(b.order_index) || 0) || String(a.id).localeCompare(String(b.id)));
}

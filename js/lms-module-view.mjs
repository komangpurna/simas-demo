import { lmsHasMaterial, lmsHasQuiz, lmsHasDiscussion } from './lms-structure.mjs';

export const lmsViewEscape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paths = {
    chapter: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3z"/><path d="M3 10h18"/>',
    module: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
    packet: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4M9 12h6M9 16h4"/>',
    material: '<path d="M12 6c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Z"/><path d="M12 6v15"/>',
    quiz: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .7-1.5 1-1.5 2M12 17h.01"/>',
    discussion: '<path d="M21 11a8 8 0 0 1-8 8H6l-4 3 1-6a8 8 0 1 1 18-5Z"/><path d="M7 10h10M7 14h6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 11h18M8 15h2M14 15h2"/>',
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    journal: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M6 6h10M6 10h10"/>'
};
export function lmsUiIcon(kind) {
    return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[kind] || paths.packet}</svg>`;
}
export function lmsComponentPills(packet) {
    return [[lmsHasMaterial(packet), 'material', 'Materi'], [lmsHasQuiz(packet), 'quiz', 'Kuis Formatif / CBT'], [lmsHasDiscussion(packet), 'discussion', 'Forum Diskusi']]
        .filter(([enabled]) => enabled).map(([, kind, title]) => `<span class="lm-part-pill" data-lm-part="${kind}">${lmsUiIcon(kind)}${title}</span>`).join('');
}
export function lmsTopicHeading(topic, index, count, actions = '', tag = 'header') {
    const element=tag==='summary'?'summary':'header';
    return `<${element} class="lm-topic-header lm-chapter-header"><div class="lm-chapter-identity"><span class="lm-chapter-icon">${lmsUiIcon('chapter')}</span><div><span class="lm-overline">Bab / Topik ${index + 1}</span><h3>${lmsViewEscape(topic.title)}</h3><p class="lm-chapter-meta">${count} Modul pembelajaran</p></div></div>${actions ? `<div class="lm-actions">${actions}</div>` : ''}${element==='summary'?'<span class="lm-disclosure" aria-hidden="true">⌄</span>':''}</${element}>`;
}

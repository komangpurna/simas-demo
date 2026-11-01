/** @jest-environment node */
import { jest } from '@jest/globals';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as acorn from 'acorn';

const require = createRequire(import.meta.url);
const { harness } = require('./helpers/lms-quiz-harness.cjs');

const teacherSource = fs.readFileSync('js/page-guru-mapel.js', 'utf8');

function extract(source, names) {
    return acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body.filter(n =>
        n.type === 'FunctionDeclaration' ? names.includes(n.id.name) : n.type === 'ExpressionStatement' && names.includes(n.expression.left?.property?.name))
        .map(n => source.slice(n.start, n.end)).join('\n');
}

describe('LMS Topic & Material Delete Idempotency (Anti-Ghost-Card & Safe Purging)', () => {
    let h;

    beforeEach(() => {
        h = harness(undefined, { realLearningPath: true });
    });

    afterEach(() => {
        h.sqlite.close();
    });

    async function apiDelete(path, role = 'teacher') {
        h.context.actor = role === 'teacher' ? { uid: 'guru' } : { nis: '100' };
        const response = await h.context.worker.fetch(
            new Request(`https://worker.test/api/lms/${path}`, { method: 'DELETE' }),
            h.env,
            {}
        );
        const data = await response.json();
        return { status: response.status, data };
    }

    test('DELETE /api/lms/topics/:id menghapus topik yang ada beserta modul dan materi terkait secara kaskade', async () => {
        // Insert a module connected to this topic
        h.sqlite.prepare(`INSERT INTO lms_modules (id, topic_id, teacher_id, teacher_name, class_name, subject_name, title, order_index, is_visible)
            VALUES ('mod-1', 'topic', 'guru', 'Guru', 'X-1', 'IPA', 'Modul 1', 1, 1)`).run();

        const beforeTopic = h.sqlite.prepare("SELECT * FROM lms_topics WHERE id = 'topic'").get();
        expect(beforeTopic).toBeDefined();

        const { status, data } = await apiDelete('topics/topic');
        expect(status).toBe(200);
        expect(data.success).toBe(true);

        const afterTopic = h.sqlite.prepare("SELECT * FROM lms_topics WHERE id = 'topic'").get();
        expect(afterTopic).toBeUndefined();

        const afterMat = h.sqlite.prepare("SELECT * FROM lms_materials WHERE topic_id = 'topic'").all();
        expect(afterMat).toHaveLength(0);

        const afterMod = h.sqlite.prepare("SELECT * FROM lms_modules WHERE topic_id = 'topic'").all();
        expect(afterMod).toHaveLength(0);
    });

    test('DELETE /api/lms/topics/:id idempoten: menghapus topik yang sudah tidak ada di server mengembalikan status 200 already_deleted', async () => {
        const { status, data } = await apiDelete('topics/ghost_topic_123');
        expect(status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.already_deleted).toBe(true);
        expect(data.message).toContain('sudah tidak ada di server');
    });

    test('DELETE /api/lms/materials/:id idempoten: menghapus materi yang sudah tidak ada di server mengembalikan status 200 already_deleted', async () => {
        const { status, data } = await apiDelete('materials/ghost_material_456');
        expect(status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.already_deleted).toBe(true);
        expect(data.message).toContain('sudah tidak ada di server');
    });

    test('Frontend deleteLmsTopic membersihkan state lokal (currentLmsTopics & currentLmsMaterials) dan cache saat server mengembalikan already_deleted', async () => {
        const toast = jest.fn();
        const cfDeleteMock = jest.fn(async () => ({ success: true, already_deleted: true, message: 'Sudah terhapus' }));
        const loadMock = jest.fn(async () => {});

        const currentLmsTopics = [
            { id: 'topic_ghost', title: 'BAB 3 Kosong' },
            { id: 'topic_real', title: 'BAB 4 Ada' }
        ];
        const currentLmsMaterials = [
            { id: 'mat_1', topic_id: 'topic_real', title: 'Materi 1' },
            { id: 'mat_ghost', topic_id: 'topic_ghost', title: 'Materi Ghost' }
        ];
        const currentLmsModules = [
            { id: 'mod_ghost', topic_id: 'topic_ghost', title: 'Modul Ghost' }
        ];
        const sessionPortalDataCache = new Map([
            [JSON.stringify(['lms', 'X-1', 'IPA']), { topics: currentLmsTopics, materials: currentLmsMaterials }]
        ]);

        const windowMock = {
            showConfirmModal: jest.fn(async () => true),
            closeUnifiedLmsCreator: jest.fn(),
            closeLmsTopicModal: jest.fn(),
            loadLmsData: loadMock,
            escapeHTML: (str) => str,
            document: {
                getElementById: jest.fn(() => ({ value: 'topic_ghost' }))
            }
        };

        const deps = {
            window: windowMock,
            document: windowMock.document,
            currentLmsTopics,
            currentLmsMaterials,
            currentLmsModules,
            sessionPortalDataCache,
            showToast: toast,
            cfDeleteLmsTopic: cfDeleteMock,
            loadLmsData: loadMock,
            closeUnifiedLmsCreator: windowMock.closeUnifiedLmsCreator,
            closeLmsTopicModal: windowMock.closeLmsTopicModal
        };

        new Function(...Object.keys(deps), extract(teacherSource, ['deleteLmsTopic']))(...Object.values(deps));

        await windowMock.deleteLmsTopic('topic_ghost');

        expect(cfDeleteMock).toHaveBeenCalledWith('topic_ghost');
        // Topic ghost harus terhapus dari array
        expect(deps.currentLmsTopics.some(t => t.id === 'topic_ghost')).toBe(false);
        // Materi dan modul dari topic ghost juga harus terhapus
        expect(deps.currentLmsMaterials.some(m => m.topic_id === 'topic_ghost')).toBe(false);
        expect(deps.currentLmsModules.some(m => m.topic_id === 'topic_ghost')).toBe(false);
        // Cache harus terinvalisasi
        expect(sessionPortalDataCache.size).toBe(0);
        // Modal harus ditutup dan load dipanggil
        expect(windowMock.closeLmsTopicModal).toHaveBeenCalled();
        expect(loadMock).toHaveBeenCalledWith(true);
        expect(toast).toHaveBeenCalledWith('Berhasil Dihapus', expect.any(String), 'success');
    });

    test('Frontend deleteLmsTopic self-healing saat server melempar galat 404 (Topik tidak ditemukan)', async () => {
        const toast = jest.fn();
        const cfDeleteMock = jest.fn(async () => {
            const err = new Error('Topik tidak ditemukan.');
            err.status = 404;
            throw err;
        });
        const loadMock = jest.fn(async () => {});

        const currentLmsTopics = [{ id: 'topic_ghost_404', title: 'BAB 3 Hantu' }];
        const currentLmsMaterials = [];
        const currentLmsModules = [];
        const sessionPortalDataCache = new Map([
            [JSON.stringify(['lms', 'X-1', 'IPA']), { topics: currentLmsTopics, materials: currentLmsMaterials }]
        ]);

        const windowMock = {
            showConfirmModal: jest.fn(async () => true),
            closeUnifiedLmsCreator: jest.fn(),
            closeLmsTopicModal: jest.fn(),
            loadLmsData: loadMock,
            escapeHTML: (str) => str,
            document: {
                getElementById: jest.fn(() => ({ value: 'topic_ghost_404' }))
            }
        };

        const deps = {
            window: windowMock,
            document: windowMock.document,
            currentLmsTopics,
            currentLmsMaterials,
            currentLmsModules,
            sessionPortalDataCache,
            showToast: toast,
            cfDeleteLmsTopic: cfDeleteMock,
            loadLmsData: loadMock,
            closeUnifiedLmsCreator: windowMock.closeUnifiedLmsCreator,
            closeLmsTopicModal: windowMock.closeLmsTopicModal
        };

        new Function(...Object.keys(deps), extract(teacherSource, ['deleteLmsTopic']))(...Object.values(deps));

        await windowMock.deleteLmsTopic('topic_ghost_404');

        // Harus membersihkan topik lokal agar tidak terkunci di layar
        expect(deps.currentLmsTopics.some(t => t.id === 'topic_ghost_404')).toBe(false);
        expect(sessionPortalDataCache.size).toBe(0);
        expect(windowMock.closeLmsTopicModal).toHaveBeenCalled();
        expect(loadMock).toHaveBeenCalledWith(true);
        expect(toast).toHaveBeenCalledWith('Topik Dibersihkan', expect.stringContaining('tidak ada di server'), 'info');
    });
});

import { describe, test, expect, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

describe('LMS Copy Tab: Order & Dynamic Visibility', () => {
    let dom;
    let document;
    let window;

    beforeEach(() => {
        const html = fs.readFileSync(path.resolve(process.cwd(), 'guru-mapel.html'), 'utf8');
        dom = new JSDOM(html, { runScripts: 'outside-only' });
        window = dom.window;
        document = window.document;

        // Mock fungsi browser & dependensi minimal untuk page-guru-mapel
        window.escapeHTML = str => String(str).replace(/[&<>'"]/g, tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag));

        window.lmsCopyLoadedSourceData = { topics: [], materials: [] };
    });

    function loadLmsCopyFunctions() {
        const rawJs = fs.readFileSync(path.resolve(process.cwd(), 'js/page-guru-mapel.js'), 'utf8');
        const updateFnMatch = rawJs.match(/window\.updateLmsCopyScheduleVisibility\s*=\s*function\s*\(\)[\s\S]*?\n\};\n/);
        const onTopicChangeMatch = rawJs.match(/window\.onLmsCopyTopicCheckboxChange\s*=\s*function\s*\(\)[\s\S]*?\n\};\n/);
        const toggleAllMatch = rawJs.match(/window\.toggleLmsCopySelectAll\s*=\s*function\s*\(\)[\s\S]*?\n\};\n/);
        const initMatch = rawJs.match(/window\.initLmsCopyTabState\s*=\s*function\s*\(\)[\s\S]*?\n\};\n/);

        expect(updateFnMatch).toBeTruthy();
        expect(onTopicChangeMatch).toBeTruthy();
        expect(toggleAllMatch).toBeTruthy();
        expect(initMatch).toBeTruthy();

        window.eval(updateFnMatch[0]);
        window.eval(onTopicChangeMatch[0]);
        window.eval(toggleAllMatch[0]);
        window.eval(initMatch[0]);
    }

    test('DOM Integrity: wrapper-lms-copy-schedule diletakkan SETELAH lms-copy-preview-container', () => {
        const previewContainer = document.getElementById('lms-copy-preview-container');
        const scheduleWrapper = document.getElementById('wrapper-lms-copy-schedule');
        const publishInput = document.getElementById('input-lms-copy-publish-at');
        const dueInput = document.getElementById('input-lms-copy-due');

        expect(previewContainer).toBeTruthy();
        expect(scheduleWrapper).toBeTruthy();
        expect(publishInput).toBeTruthy();
        expect(dueInput).toBeTruthy();

        // Pastikan scheduleWrapper berada di dalam container copy dan posisinya setelah previewContainer
        const parent = previewContainer.parentElement.parentElement;
        expect(scheduleWrapper.parentElement).toBe(parent);

        // Periksa urutan node anak dalam parent
        const children = Array.from(parent.children);
        const previewSectionIndex = children.indexOf(previewContainer.parentElement);
        const scheduleIndex = children.indexOf(scheduleWrapper);

        expect(scheduleIndex).toBeGreaterThan(previewSectionIndex);
    });

    test('Initial State: wrapper-lms-copy-schedule memiliki class hidden secara default', () => {
        const scheduleWrapper = document.getElementById('wrapper-lms-copy-schedule');
        expect(scheduleWrapper.classList.contains('hidden')).toBe(true);
    });

    test('Dynamic Visibility: muncul saat topik terpilih, dan sembunyi saat 0 topik terpilih dengan preservasi nilai input', () => {
        loadLmsCopyFunctions();

        const scheduleWrapper = document.getElementById('wrapper-lms-copy-schedule');
        const previewContainer = document.getElementById('lms-copy-preview-container');
        const btnSubmit = document.getElementById('btn-submit-lms-copy');
        const publishInput = document.getElementById('input-lms-copy-publish-at');
        const dueInput = document.getElementById('input-lms-copy-due');

        // Simulasi inisialisasi awal
        window.initLmsCopyTabState();
        expect(scheduleWrapper.classList.contains('hidden')).toBe(true);
        expect(btnSubmit.disabled).toBe(true);

        // Simulasi data topik termuat di preview container
        previewContainer.innerHTML = `
            <div>
                <input type="checkbox" name="lms-copy-topic" value="topic_1" id="chk-1" checked onchange="window.onLmsCopyTopicCheckboxChange()">
                <label for="chk-1">Topik 1</label>
            </div>
            <div>
                <input type="checkbox" name="lms-copy-topic" value="topic_2" id="chk-2" checked onchange="window.onLmsCopyTopicCheckboxChange()">
                <label for="chk-2">Topik 2</label>
            </div>
        `;

        // Panggil pembaruan visibilitas (seperti saat selesai render)
        window.updateLmsCopyScheduleVisibility();

        // Form jadwal harus muncul (hidden hilang) dan tombol submit aktif
        expect(scheduleWrapper.classList.contains('hidden')).toBe(false);
        expect(btnSubmit.disabled).toBe(false);

        // Guru mengisi waktu jadwal
        publishInput.value = '2026-10-27T08:00';
        dueInput.value = '2026-10-27T10:00';

        // Guru membatalkan pilihan semua topik (0 topik terpilih)
        const chk1 = document.getElementById('chk-1');
        const chk2 = document.getElementById('chk-2');
        chk1.checked = false;
        chk2.checked = false;

        window.updateLmsCopyScheduleVisibility();

        // Form jadwal harus kembali tersembunyi dan tombol submit dinonaktifkan
        expect(scheduleWrapper.classList.contains('hidden')).toBe(true);
        expect(btnSubmit.disabled).toBe(true);

        // Guru mencentang kembali topik 1
        chk1.checked = true;
        window.updateLmsCopyScheduleVisibility();

        // Form jadwal muncul kembali
        expect(scheduleWrapper.classList.contains('hidden')).toBe(false);
        expect(btnSubmit.disabled).toBe(false);

        // Nilai input jadwal harus tetap terjaga (tidak terhapus)
        expect(publishInput.value).toBe('2026-10-27T08:00');
        expect(dueInput.value).toBe('2026-10-27T10:00');
    });

    test('toggleLmsCopySelectAll memicu updateLmsCopyScheduleVisibility dengan benar', () => {
        loadLmsCopyFunctions();

        const scheduleWrapper = document.getElementById('wrapper-lms-copy-schedule');
        const previewContainer = document.getElementById('lms-copy-preview-container');
        const btnToggleAll = document.getElementById('btn-lms-copy-toggle-all');

        previewContainer.innerHTML = `
            <div><input type="checkbox" name="lms-copy-topic" value="t1" id="t1" checked></div>
            <div><input type="checkbox" name="lms-copy-topic" value="t2" id="t2" checked></div>
        `;
        window.updateLmsCopyScheduleVisibility();
        expect(scheduleWrapper.classList.contains('hidden')).toBe(false);
        expect(btnToggleAll.textContent).toBe('Batal Pilih Semua');

        // Klik toggle all -> uncheck semua
        window.toggleLmsCopySelectAll();
        expect(document.getElementById('t1').checked).toBe(false);
        expect(document.getElementById('t2').checked).toBe(false);
        expect(scheduleWrapper.classList.contains('hidden')).toBe(true);
        expect(btnToggleAll.textContent).toBe('Pilih Semua');

        // Klik toggle all lagi -> check semua
        window.toggleLmsCopySelectAll();
        expect(document.getElementById('t1').checked).toBe(true);
        expect(document.getElementById('t2').checked).toBe(true);
        expect(scheduleWrapper.classList.contains('hidden')).toBe(false);
        expect(btnToggleAll.textContent).toBe('Batal Pilih Semua');
    });
});

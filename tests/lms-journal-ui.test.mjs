import { jest } from '@jest/globals';
import { installLmsJournal, lmsJournalDateWita, lmsJournalWorkloadMessage } from '../js/lms-journal.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { journalHarness } = require('./helpers/lms-journal-harness.cjs');
const { webcrypto } = require('node:crypto');
const { JSDOM } = require('jsdom');
jest.setTimeout(30000);

describe('LMS journal dialog uses real backend data and safe signed save flow', () => {
    let h, api, ink, signature, suggestions, loadMotivations, window, document, Event, MouseEvent, HTMLDialogElement, HTMLCanvasElement;
    const el = name => document.querySelector(`[data-journal-node="${name}"]`);
    const field = name => document.querySelector(`[data-journal-field="${name}"]`);
    async function settle() { for (let i=0;i<15;i++) await new Promise(resolve => setTimeout(resolve,0)); }
    async function prepare(assignAll = true) {
        await window.openLmsJournal('read',{tanggal:'2026-01-15'});
        if (assignAll) {
            const sel = document.querySelector('[data-student-nis="200"] select');
            if (sel && !sel.value) {
                sel.value = 'A';
                sel.dispatchEvent(new Event('input', { bubbles: true }));
                el('preview').click();
                await settle();
            }
        }
    }
    function draw() {
        const canvas=el('canvas');
        canvas.dispatchEvent(new MouseEvent('pointerdown',{clientX:10,clientY:10,bubbles:true}));
        canvas.dispatchEvent(new MouseEvent('pointermove',{clientX:80,clientY:60,bubbles:true}));
        canvas.dispatchEvent(new MouseEvent('pointerup',{bubbles:true}));
    }
    beforeEach(async () => {
        window = new JSDOM('<body><button data-lms-journal-material="read">Sinkron Jurnal Mengajar</button></body>', { url: 'http://localhost' }).window;
        ({ document, Event, MouseEvent, HTMLDialogElement, HTMLCanvasElement } = window);
        h=journalHarness();
        Object.defineProperty(window.crypto,'randomUUID',{configurable:true,value:()=>webcrypto.randomUUID()});
        HTMLDialogElement.prototype.showModal=function(){this.open=true;};
        HTMLDialogElement.prototype.close=function(){this.open=false;};
        HTMLCanvasElement.prototype.setPointerCapture=function(){};
        HTMLCanvasElement.prototype.getBoundingClientRect=()=>({left:0,top:0,width:600,height:220});
        ink={clearRect:jest.fn(),beginPath:jest.fn(),moveTo:jest.fn(),lineTo:jest.fn(),stroke:jest.fn()};
        HTMLCanvasElement.prototype.getContext=()=>ink;
        signature=(await h.signingBody()).ttd;
        HTMLCanvasElement.prototype.toDataURL=()=>signature;
        api=jest.fn(async (route,options={})=>{
            const result=await h.request(route,options.body?JSON.parse(options.body):null);
            if(result.httpStatus!==200){const error=new Error(result.error);error.status=result.httpStatus;throw error;}
            return result;
        });
        suggestions=[];
        loadMotivations=jest.fn().mockResolvedValue([]);
        installLmsJournal({request:api,scheduleSuggestions:async()=>suggestions,loadMotivations},window);
    });
    afterEach(()=>{ h.sqlite.close(); window.close(); });
    test('date uses WITA across UTC midnight and workload messaging distinguishes realization from verification',()=>{
        expect(lmsJournalDateWita(new Date('2026-10-14T17:00:00Z'))).toBe('2026-10-15');
        expect(lmsJournalWorkloadMessage({success:true,matched:true})).toContain('berhasil');
        expect(lmsJournalWorkloadMessage({success:true,matched:true,ignored:true,reason:'Terkunci'})).toContain('Terkunci');
    });
    test('meeting prefill and documentation preview write nothing; Save opens confirmation before signing',async()=>{
        await prepare(); expect(field('jp').value).toBe('2,3,4');
        expect(document.getElementById('lms-journal-title').textContent).toBe('Sinkron Jurnal Mengajar');
        expect(el('teacher').value).toBe('Guru Resmi'); expect(el('teacher').readOnly).toBe(true);
        expect(el('class').value).toBe('X-1'); expect(el('subject').value).toBe('IPA');
        expect(field('tanggal').type).toBe('hidden'); expect(el('settings').hidden).toBe(true);
        expect([...el('jp-options').querySelectorAll('[data-journal-jp]')].map(button=>button.textContent)).toEqual(['2','3','4']);
        expect(el('evidence-preview').hidden).toBe(false);
        const draft=decodeURIComponent(el('evidence-image').src.split(',').slice(1).join(','));
        expect(draft).toContain('PRATINJAU'); expect(draft).toContain('Hadir: 1/2'); expect(draft).toContain('Siswa Satu'); expect(draft).toContain('Siswa Dua'); expect(draft).toContain('15 mnt 15 dtk');
        expect(el('preview-content').textContent).toContain('Hadir 1/2');
        expect(h.sqlite.prepare('SELECT COUNT(*) n FROM jurnal_guru').get().n).toBe(0);
        el('save').click(); expect(el('sign').hidden).toBe(false);
        el('commit').click(); expect(el('sign-message').textContent).toContain('Centang');
        el('confirmed').checked=true;
        el('confirmed').dispatchEvent(new Event('change',{bubbles:true})); expect(el('sign-message').hidden).toBe(true);
        el('commit').click(); expect(el('message').textContent).toContain('Gambar tanda tangan');
        draw(); el('commit').click(); await settle();
        expect(el('success-workload').textContent).toContain('e-Kinerja tersinkron');
        expect(h.sqlite.prepare('SELECT COUNT(*) n FROM work_logs').get().n).toBe(1);
    });
    test('Save remains responsive after edits and refreshes evidence before showing a new confirmation',async()=>{
        await prepare(); el('confirmed').checked=true;
        field('topik').value='Topik terbaru'; field('topik').dispatchEvent(new Event('input',{bubbles:true}));
        expect(el('save').disabled).toBe(false); expect(el('confirmed').checked).toBe(false);
        expect(el('evidence-preview').dataset.stale).toBe('true');
        el('save').click(); await settle(); expect(el('sign').hidden).toBe(false);
        expect(el('sign-summary').textContent).toContain('Topik terbaru'); expect(el('confirmed').checked).toBe(false);
        expect(decodeURIComponent(el('evidence-image').src)).toContain('Topik terbaru');
        expect(h.sqlite.prepare('SELECT COUNT(*) n FROM jurnal_guru').get().n).toBe(0);
    });
    test('full evidence can be enlarged without losing the journal draft',async()=>{
        await prepare(); el('evidence-open').click();
        const viewer=document.querySelector('.lms-journal-evidence-dialog'); expect(viewer.open).toBe(true);
        expect(viewer.querySelector('img').src).toBe(el('evidence-image').src);
        viewer.querySelector('[data-evidence-fit]').click(); expect(viewer.classList.contains('lms-journal-evidence-fit')).toBe(true);
        viewer.querySelector('[data-evidence-close]').click(); expect(viewer.open).toBe(false);
        expect(document.querySelector('.lms-journal-dialog').open).toBe(true); expect(field('topik').value).toBe('Materi Pertama');
    });
    test('automatic settings and WITA date require no teacher input',async()=>{
        await window.openLmsJournal('read');
        expect(field('tanggal').value).toBe(lmsJournalDateWita());
        for(const name of ['tanggal','plan_segment_id','period_start','period_end','jp','schedule_note']) expect(field(name).type).toBe('hidden');
        expect(field('period_start').value).toBe(field('tanggal').value); expect(field('period_end').value).toBe(field('tanggal').value);
        expect(el('settings').hidden).toBe(true);
    });
    test('ambiguous meetings show actionable feedback instead of silently disabling Save or guessing a plan',async()=>{
        const original=api.getMockImplementation();
        api.mockImplementation(async (...args)=>{
            const result=await original(...args);
            if(args[0].includes('/context?')) result.meetings.push({...result.meetings[0],id:'another-meeting'});
            return result;
        });
        await window.openLmsJournal('read',{tanggal:'2026-01-15'});
        expect(field('plan_segment_id').value).toBe(''); expect(el('save').disabled).toBe(false);
        expect(api.mock.calls.some(([route])=>route.endsWith('/preview'))).toBe(false);
        el('save').click(); expect(el('save-hint').textContent).toContain('beberapa pertemuan');
        expect(el('sign').hidden).toBe(true);
    });
    test('official teacher schedule chooses a unique matching meeting automatically',async()=>{
        suggestions=[2,3,4]; const original=api.getMockImplementation();
        api.mockImplementation(async (...args)=>{const result=await original(...args); if(args[0].includes('/context?')) result.meetings.push({...result.meetings[0],id:'another',jp:[6,7],jp_count:2}); return result;});
        await prepare(); expect(field('plan_segment_id').value).toBe('segment'); expect(field('jp').value).toBe('2,3,4');
        expect(el('preview-content').textContent).toContain('Hadir 1/2');
    });
    test('official schedule fills JP and its explanation automatically when no e-Kinerja meeting exists',async()=>{
        suggestions=[2,3,4]; h.sqlite.exec("DELETE FROM plan_time_segments WHERE id='segment'");
        await prepare(); expect(field('plan_segment_id').value).toBe(''); expect(field('jp').value).toBe('2,3,4');
        expect(field('schedule_note').value).toContain('jadwal mengajar resmi');
        expect(el('preview-content').textContent).toContain('Hadir 1/2'); expect(el('evidence-preview').hidden).toBe(false);
        el('save').click(); expect(el('sign').hidden).toBe(false);
        expect(h.sqlite.prepare('SELECT COUNT(*) n FROM work_logs').get().n).toBe(0);
    });
    test('unassigned students block saving until manually selected, without requiring a reason',async()=>{
        await prepare(false);
        expect(el('preview-content').textContent).toContain('Belum Diisi: 1');
        const student=document.querySelector('[data-student-nis="200"]');
        expect(student.querySelector('select').value).toBe('');
        expect(student.querySelector('input[data-attendance-reason]')).toBeNull();
        el('save').click(); await settle();
        expect(el('save-hint').textContent).toContain('belum dipilih');
        expect(el('sign').hidden).toBe(true);
        student.querySelector('select').value='I';
        student.querySelector('select').dispatchEvent(new Event('input',{bubbles:true}));
        expect(el('save').disabled).toBe(false);
        el('save').click(); await settle();
        expect(el('sign').hidden).toBe(false);
        el('confirmed').checked=true; draw(); el('commit').click(); await settle();
        expect(JSON.parse(h.sqlite.prepare('SELECT presensi_detail FROM jurnal_guru').get().presensi_detail)[0].status).toBe('I');
    });
    test('lost response keeps signature and retry identity, so retry creates one journal only',async()=>{
        await prepare(); let lost=true; const original=api.getMockImplementation();
        api.mockImplementation(async (...args)=>{const result=await original(...args);if(args[0].endsWith('/save')&&lost){lost=false;throw new Error('Koneksi terputus');}return result;});
        el('save').click(); el('confirmed').checked=true; draw(); el('commit').click(); await settle();
        expect(el('message').textContent).toContain('Koneksi terputus'); expect(el('sign').hidden).toBe(false);
        el('commit').click(); await settle(); expect(el('result').textContent).toContain('Jurnal berhasil');
        const saves=api.mock.calls.filter(([route])=>route.endsWith('/save')).map(([,options])=>JSON.parse(options.body));
        expect(saves[0].request_id).toBe(saves[1].request_id);
        expect(h.sqlite.prepare('SELECT COUNT(*) n FROM jurnal_guru').get().n).toBe(1);
        const journal=h.sqlite.prepare('SELECT id FROM jurnal_guru').get();
        await window.openLmsJournalEntry(journal.id); expect(field('tanggal').value).toBe('2026-01-15');
        expect(document.querySelector('.lms-journal-dialog').getAttribute('aria-labelledby')).toBe('lms-journal-title');
    });
    test('manual journal conflict is visible and blocks importing over existing data',async()=>{
        h.sqlite.exec("INSERT INTO jurnal_guru(id,tanggal,kelas,guru,mapel) VALUES ('manual','2026-01-15','X-1','Guru Resmi','IPA')");
        await prepare(); expect(el('existing').textContent).toContain('tidak dapat ditimpa'); expect(el('preview').disabled).toBe(true);
        el('save').click(); expect(el('save-hint').textContent).toContain('tidak dapat ditimpa'); expect(el('sign').hidden).toBe(true);
    });
    test('editing saved attendance survives deleted materials and preserves the signed learning recap',async()=>{
        const first = await h.request('/api/lms/journal/save',await h.signingBody());
        h.sqlite.exec("DELETE FROM lms_materials; UPDATE students SET class='X-2',status='inactive' WHERE nis='200'");
        api.mockClear();
        await window.openLmsJournalEntry(first.id);
        expect(document.getElementById('lms-journal-title').textContent).toBe('Edit Kehadiran Jurnal');
        expect(el('save').textContent).toBe('Simpan Kehadiran');
        expect(field('topik').readOnly).toBe(true); expect(field('catatan').readOnly).toBe(true);
        expect(el('preview-content').textContent).toContain('Hadir 1/2');
        expect(el('preview-content').textContent).toContain('15 mnt 15 dtk');
        expect(api.mock.calls.some(([route])=>route.includes('/context?'))).toBe(false);
        const student=document.querySelector('[data-student-nis="200"]');
        expect(student.querySelector('input[data-attendance-reason]')).toBeNull();
        student.querySelector('select').value='I'; student.querySelector('select').dispatchEvent(new Event('input',{bubbles:true}));
        el('save').click(); await settle(); expect(el('sign-summary').textContent).toContain('Izin: 1');
        el('confirmed').checked=true; draw(); el('commit').click(); await settle();
        expect(el('result').textContent).toContain('Revisi 2');
        expect(JSON.parse(h.sqlite.prepare('SELECT presensi_detail FROM jurnal_guru').get().presensi_detail)).toEqual([{nama:'Siswa Dua',nis:'200',status:'I'}]);
        expect(h.sqlite.prepare('SELECT COUNT(*) n FROM jurnal_guru').get().n).toBe(1);
        el('done').click(); await prepare();
        // A new LMS sync still needs a live source; it must not retain the correction mode.
        expect(document.getElementById('lms-journal-title').textContent).toBe('Sinkron Jurnal Mengajar');
        expect(field('topik').readOnly).toBe(false);
    });
    test('Perbarui rekap refreshes saved attendance without writing; Simpan Kehadiran signs the refreshed result',async()=>{
        const first=await h.request('/api/lms/journal/save',await h.signingBody());
        await window.openLmsJournalEntry(first.id);
        expect(el('preview-content').textContent).toContain('Hadir 1/2');
        expect(el('attendance-help').textContent).toContain('Perbarui rekap');
        h.sqlite.exec("INSERT INTO lms_activity_events(id,material_id,student_nis,action,occurred_at) VALUES ('new','read','200','open','2026-01-15 04:00:00')");
        el('preview').click();await settle();
        expect(el('preview-content').textContent).toContain('Hadir 2/2');
        expect(document.querySelector('[data-student-nis="200"] select').value).toBe('H');
        const requests=api.mock.calls.filter(([route])=>route.endsWith('/preview'));
        expect(JSON.parse(requests.at(-1)[1].body)).toMatchObject({attendance_only:true,refresh_attendance:true,journal_id:first.id});
        expect(h.sqlite.prepare('SELECT revision FROM lms_journal_links').get().revision).toBe(1);
        el('save').click();expect(el('sign-summary').textContent).toContain('Hadir: 2');
        el('confirmed').checked=true;draw();el('commit').click();await settle();
        expect(h.sqlite.prepare('SELECT revision FROM lms_journal_links').get().revision).toBe(2);
        expect(JSON.parse(h.sqlite.prepare('SELECT presensi_detail FROM jurnal_guru').get().presensi_detail)).toEqual([]);
    });
    test('success card uses the official teacher photo and falls back gracefully if the image is unavailable',async()=>{
        h.sqlite.exec("UPDATE gtk SET foto='https://photos.example.test/guru.webp'");
        loadMotivations.mockResolvedValue([' ',null,'Terus <belajar> & menginspirasi.']);
        await prepare(); el('save').click(); el('confirmed').checked=true; draw(); el('commit').click(); await settle();
        expect(el('success-card').textContent).toContain('Guru Resmi'); expect(el('success-card').textContent).toContain('Tersimpan.');
        expect(el('success-card').querySelector('.lms-journal-success-teacher').textContent).toContain('Kelas X-1');
        expect(document.querySelector('.lms-journal-dialog').getAttribute('aria-labelledby')).toBe('lms-journal-success-title');
        expect(el('success-card').textContent).toContain('Tersinkron otomatis dari LMS SIMAS-SHAKTI.');
        expect(el('success-motivation').textContent).toBe('“Terus <belajar> & menginspirasi.”');
        expect(el('success-motivation').childElementCount).toBe(0);
        expect(el('success-photo').src).toBe('https://photos.example.test/guru.webp');
        el('success-photo').dispatchEvent(new Event('error')); expect(el('success-photo')).toBeNull();
        expect(el('success-card').querySelector('.lms-journal-success-avatar').textContent).toContain('GR');
        el('saved-evidence').click(); expect(document.querySelector('.lms-journal-evidence-dialog img').src).toContain('/api/lms/journal/evidence/');
    });
    test('a saved journal never claims e-Kinerja success when its realization remains pending',async()=>{
        h.sqlite.exec("UPDATE weekly_plan_versions SET status='draft'; UPDATE gtk SET foto='javascript:alert(1)'");
        loadMotivations.mockRejectedValue(new Error('Daftar motivasi tidak tersedia'));
        await prepare(); el('save').click(); el('confirmed').checked=true; draw(); el('commit').click(); await settle();
        expect(el('success-workload').classList.contains('is-pending')).toBe(true);
        expect(el('success-workload').textContent).toContain('belum tersinkron'); expect(el('success-photo')).toBeNull();
        expect(el('success-card').textContent).toContain('Jurnal berhasil disimpan');
        expect(el('success-card').textContent).not.toContain('berhasil disinkronkan');
        expect(h.sqlite.prepare('SELECT COUNT(*) n FROM work_logs').get().n).toBe(0);
    });
    test('Perbarui rekap recognizes materials with different teacher ID aliases and updates attendance from live activity', async () => {
        const first = await h.request('/api/lms/journal/save', await h.signingBody());
        await window.openLmsJournalEntry(first.id);
        expect(el('preview-content').textContent).toContain('Hadir 1/2');

        h.sqlite.exec("UPDATE lms_materials SET teacher_id='gtk-guru' WHERE id='read'");
        h.sqlite.exec(`INSERT INTO lms_progress(id, material_id, topic_id, student_nis, student_name, student_class, status, first_opened_at, active_seconds_total)
            VALUES ('p_200', 'read', 'top', '200', 'Siswa Dua', 'X-1', 'completed', '2026-01-15 04:00:00', 600)
            ON CONFLICT(id) DO UPDATE SET status='completed', first_opened_at='2026-01-15 04:00:00', active_seconds_total=600`);

        el('preview').click();
        await settle();

        expect(el('preview-content').textContent).not.toContain('Bahan ajar sumber tidak tersedia');
        expect(el('preview-content').textContent).toContain('Kehadiran dan rekap belajar diperbarui');
        expect(el('preview-content').textContent).toContain('Hadir 2/2');
        expect(document.querySelector('[data-student-nis="200"] select').value).toBe('H');
    });
});


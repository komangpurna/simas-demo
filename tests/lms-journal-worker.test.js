const { journalHarness } = require('./helpers/lms-journal-harness.cjs');
describe('LMS journal: actual Worker, SQLite, signature snapshot and e-Kinerja', () => {
    let h;
    beforeEach(() => { h = journalHarness(); });
    afterEach(() => h.sqlite.close());
    const row = (h, table) => h.sqlite.prepare(`SELECT * FROM ${table}`).get();
    const count = (h, table) => Number(h.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
    test('context uses official teacher and approved matching meeting; preview writes no journal or realization', async () => {
        const context = await h.request('/api/lms/journal/context?material_id=read&tanggal=2026-01-15');
        expect(context).toMatchObject({ httpStatus:200, scope: { teacher_id:'gtk-guru',teacher_name:'Guru Resmi' }, meetings:[{ id:'segment',jp:[2,3,4] }] });
        const result = await h.request('/api/lms/journal/preview', { ...h.base, material_ids:['read','read2'] });
        expect(result.snapshot.summary).toMatchObject({ total:2,hadir:1,berprogres:1,selesai:0,active_seconds_total:915 });
        expect(result.snapshot.students[0]).toMatchObject({learning_status:'in_progress',active_seconds:915,materials_opened:1});
        expect(result.snapshot.students[1]).toMatchObject({learning_status:'not_opened',active_seconds:null});
        expect(result.learning_receipt).toBeTruthy();
        expect(result.snapshot.students.map(s => s.status)).toEqual(['H','']);
        expect(count(h,'jurnal_guru')).toBe(0); expect(count(h,'work_logs')).toBe(0);
    });
    test('final signed journal creates exactly linked realization with plan minutes and generated evidence', async () => {
        const result = await h.request('/api/lms/journal/save', await h.signingBody());
        expect(result).toMatchObject({ httpStatus:200,success:true,revision:1,workloadSync:{success:true,matched:true,plan_activity_id:'activity',actual_minutes:120} });
        const journal = row(h,'jurnal_guru');
        expect(journal).toMatchObject({ tanggal:'2026-01-15',uid_guru:'gtk-guru',lokasi_mengajar:'Daring (LMS)' });
        expect(JSON.parse(journal.presensi_detail)).toEqual([{nama:'Siswa Dua',nis:'200',status:'A'}]);
        expect(row(h,'work_logs')).toMatchObject({ status_execution:'terlaksana',verification_status:'unverified',evidence_url:result.evidence_url });
        const evidence = await h.request(new URL(result.evidence_url).pathname,null,null);
        expect(evidence.httpStatus).toBe(200); expect(evidence.svg).toContain('Bukti pembelajaran LMS');
        expect(evidence.svg).toContain('data-collage-panel="material"');
        expect(evidence.svg).toContain('data-collage-panel="interactive"');
        expect(evidence.svg).toContain('Siswa Satu'); expect(evidence.svg).toContain('Siswa Dua'); expect(evidence.svg).toContain('15 mnt 15 dtk');
        expect(evidence.svg).not.toMatch(/Kelas Lain|Nonaktif|data:image/);
    });
    test.each([null,{nis:'100'},{uid:'lain',role:'guru_mapel'},{uid:'anon',role:'guru_mapel',isAnonymous:true}])('denies unauthorized identity %p without writes', async actor => {
        const result = await h.request('/api/lms/journal/preview',h.base,actor);
        expect([401,403]).toContain(result.httpStatus); expect(count(h,'jurnal_guru')).toBe(0);
    });
    test('signature and explicit attendance confirmation are mandatory', async () => {
        const body = await h.signingBody();
        for (const patch of [{ttd:''},{confirm_attendance:false},{ttd:'data:image/png;base64,abc'}]) {
            expect((await h.request('/api/lms/journal/save',{...body,...patch})).httpStatus).toBe(400);
        }
        expect(count(h,'jurnal_guru')).toBe(0);
    });
    test('rejects mismatched JP, future date, invalid date, cross-class materials and unknown overrides', async () => {
        for (const patch of [{jp:[1,2,3]},{tanggal:'2099-01-01'},{tanggal:'2026-02-30'},{overrides:{'300':{status:'H',reason:'Test'}}}]) {
            expect((await h.request('/api/lms/journal/preview',{...h.base,...patch})).httpStatus).not.toBe(200);
        }
        h.sqlite.exec("UPDATE lms_materials SET class_name='X-2' WHERE id='read2'");
        expect((await h.request('/api/lms/journal/preview',{...h.base,material_ids:['read','read2']})).httpStatus).toBe(400);
    });
    test('activity outside selected period does not count; any selected material is sufficient', async () => {
        h.sqlite.exec("UPDATE lms_progress SET first_opened_at='2026-01-14 02:00:00',last_accessed_at='2026-01-16 02:00:00'");
        expect((await h.request('/api/lms/journal/preview',h.base)).snapshot.summary.hadir).toBe(0);
        h.sqlite.exec("INSERT INTO lms_activity_events(id,material_id,student_nis,action,occurred_at) VALUES ('evt','read2','100','open','2026-01-15 03:00:00')");
        expect((await h.request('/api/lms/journal/preview',{...h.base,material_ids:['read','read2']})).snapshot.summary.hadir).toBe(1);
    });
    test('attendance corrections do not require reasons; saving blocks if unassigned; client teacher identity and fabricated attendance are ignored', async () => {
        const preview = await h.request('/api/lms/journal/preview', h.base);
        expect(preview.snapshot.students.find(s => s.nis === '200').status).toBe('');
        const unassignedBody = { ...h.base, snapshot_at: preview.snapshot.snapshot_at, snapshot_hash: preview.snapshot_hash,
            learning_receipt: preview.learning_receipt, expected_revision: 0, confirm_update: false, confirm_attendance: true,
            request_id: crypto.randomUUID(), ttd: (await h.signingBody()).ttd };
        expect((await h.request('/api/lms/journal/save', unassignedBody)).httpStatus).toBe(400);
        expect((await h.request('/api/lms/journal/preview',{...h.base,overrides:{'200':{status:'I',reason:''}}})).httpStatus).toBe(200);
        const body = await h.signingBody({overrides:{'200':{status:'I'}}});
        expect((await h.request('/api/lms/journal/save',{...body,guru:'Palsu',uid_guru:'300',presensi_detail:[]})).httpStatus).toBe(200);
        expect(row(h,'jurnal_guru').guru).toBe('Guru Resmi');
        expect(JSON.parse(row(h,'jurnal_guru').presensi_detail)[0].status).toBe('I');
    });
    test('retry is idempotent and signed snapshot stays fixed when later progress appears', async () => {
        const body = await h.signingBody(), first = await h.request('/api/lms/journal/save',body);
        h.sqlite.exec("INSERT INTO lms_activity_events(id,material_id,student_nis,action,occurred_at) VALUES ('evt','read','200','open','2026-01-15 03:00:00')");
        expect(row(h,'lms_journal_links').revision).toBe(1);
        const retry = await h.request('/api/lms/journal/save',body);
        expect(retry).toMatchObject({httpStatus:200,id:first.id,already_saved:true});
        expect(count(h,'jurnal_guru')).toBe(1); expect(count(h,'work_logs')).toBe(1); expect(count(h,'lms_journal_evidence')).toBe(1);
        const updated = await h.request('/api/lms/journal/save',await h.signingBody());
        expect(updated).toMatchObject({httpStatus:200,revision:2});
        expect(count(h,'lms_journal_evidence')).toBe(2);
        expect((await h.request(new URL(first.evidence_url).pathname,null,null)).svg).toContain('Hadir: 1/2');
        expect((await h.request(new URL(updated.evidence_url).pathname,null,null)).svg).toContain('Hadir: 2/2');
    });
    test('stale revision/hash fails without partial writes', async () => {
        const firstBody = await h.signingBody(); await h.request('/api/lms/journal/save',firstBody);
        expect((await h.request('/api/lms/journal/save',{...firstBody,request_id:crypto.randomUUID()})).httpStatus).toBe(409);
        const current = await h.signingBody(); current.topik='Perubahan setelah TTD';
        expect((await h.request('/api/lms/journal/save',current)).httpStatus).toBe(409);
        expect(count(h,'lms_journal_evidence')).toBe(1);
    });
    test('existing manual journal is not overwritten and generic journal endpoint cannot bypass LMS signing', async () => {
        h.sqlite.exec("INSERT INTO jurnal_guru(id,tanggal,kelas,guru,mapel,topik) VALUES ('manual','2026-01-15','X.1','Guru Resmi','IPA','Tetap')");
        expect((await h.request('/api/lms/journal/preview',h.base)).httpStatus).toBe(409);
        expect(row(h,'jurnal_guru').topik).toBe('Tetap'); h.sqlite.exec("DELETE FROM jurnal_guru");
        const result = await h.request('/api/lms/journal/save',await h.signingBody());
        expect((await h.request('/api/jurnal',{id:result.id,kelas:'X-1',guru:'Palsu',mapel:'IPA'})).httpStatus).toBe(409);
        expect((await h.request('/api/jurnal/'+result.id,{topik:'Palsu'},h.actor,'PUT')).httpStatus).toBe(409);
    });
    test('manual unlinked journal never guesses a plan; approval gate retains journal without realization', async () => {
        const manual = await h.request('/api/lms/journal/save',await h.signingBody({plan_segment_id:''}));
        expect(manual.workloadSync).toMatchObject({matched:false,ignored:true}); expect(count(h,'work_logs')).toBe(0);
        h.sqlite.exec('DELETE FROM jurnal_guru'); h.sqlite.exec("UPDATE weekly_plan_versions SET status='draft'");
        const body = await h.signingBody(), saved = await h.request('/api/lms/journal/save',body);
        expect(saved.httpStatus).toBe(200); expect(saved.workloadSync.reason).toContain('belum disetujui'); expect(count(h,'work_logs')).toBe(0);
        h.sqlite.exec("UPDATE weekly_plan_versions SET status='approved'");
        const retry = await h.request('/api/lms/journal/save',body);
        expect(retry.workloadSync).toMatchObject({success:true,matched:true}); expect(count(h,'work_logs')).toBe(1);
    });
    test('locked or manually verified realization prevents signed journal revision', async () => {
        await h.request('/api/lms/journal/save',await h.signingBody());
        h.sqlite.exec("UPDATE work_logs SET verification_status='verified',verified_by_uid='kepsek'");
        expect((await h.request('/api/lms/journal/save',await h.signingBody())).httpStatus).toBe(409);
        expect(row(h,'lms_journal_links').revision).toBe(1);
    });
    test('obsolete plan versions and a different class are never candidates', async () => {
        h.sqlite.exec("INSERT INTO weekly_plan_versions(id,work_week_id,version_number,status) VALUES ('new','week',2,'draft')");
        expect((await h.request('/api/lms/journal/context?material_id=read&tanggal=2026-01-15')).meetings).toEqual([]);
        expect((await h.request('/api/lms/journal/preview',h.base)).httpStatus).toBe(409);
    });
    test('migration is additive and rerunnable; missing migration fails only the optional integration', async () => {
        const fs=require('node:fs');
        h.sqlite.exec(fs.readFileSync('cloudflare/migrations/202610150002_lms_teaching_journal.sql','utf8'));
        h.sqlite.exec('DROP TABLE lms_activity_events');
        expect((await h.request('/api/lms/journal/preview',h.base)).httpStatus).toBe(503);
        expect(count(h,'lms_progress')).toBe(1);
    });
    test('daily activity recording is idempotent and missing ledger never blocks existing LMS reading', async () => {
        const actor={nis:'200'};
        const body={material_id:'read',action:'open',session_id:'reading'};
        expect((await h.request('/api/lms/student/track',body,actor)).httpStatus).toBe(200);
        expect((await h.request('/api/lms/student/track',body,actor)).httpStatus).toBe(200);
        expect(count(h,'lms_activity_events')).toBe(1);
        h.sqlite.exec('DROP TABLE lms_activity_events');
        expect((await h.request('/api/lms/student/track',body,actor)).httpStatus).toBe(200);
    });
    test('database failure rolls back journal, signed metadata and evidence together', async () => {
        h.sqlite.exec("CREATE TRIGGER reject_evidence BEFORE INSERT ON lms_journal_evidence BEGIN SELECT RAISE(ABORT,'Test storage unavailable'); END");
        expect((await h.request('/api/lms/journal/save',await h.signingBody())).httpStatus).toBe(500);
        expect(count(h,'jurnal_guru')).toBe(0); expect(count(h,'lms_journal_links')).toBe(0); expect(count(h,'lms_journal_evidence')).toBe(0);
        expect(count(h,'work_logs')).toBe(0);
    });
    test('e-Kinerja failure does not discard a signed journal and retry can finish synchronization', async () => {
        h.sqlite.exec("CREATE TRIGGER reject_log BEFORE INSERT ON work_logs BEGIN SELECT RAISE(ABORT,'Test workload unavailable'); END");
        const body=await h.signingBody(); const saved=await h.request('/api/lms/journal/save',body);
        expect(saved).toMatchObject({httpStatus:200,success:true,workloadSync:{success:false}});
        expect(count(h,'jurnal_guru')).toBe(1); h.sqlite.exec('DROP TRIGGER reject_log');
        expect((await h.request('/api/lms/journal/save',body)).workloadSync).toMatchObject({success:true,matched:true});
        expect(count(h,'work_logs')).toBe(1);
    });
    test('retry still recovers the saved result if source material changes after the response was lost', async () => {
        const body=await h.signingBody(), saved=await h.request('/api/lms/journal/save',body);
        h.sqlite.exec("UPDATE lms_materials SET is_published=0 WHERE id='read'");
        expect(await h.request('/api/lms/journal/save',body)).toMatchObject({httpStatus:200,id:saved.id,already_saved:true});
    });
    test('existing journal reopens its source and date only for the authorized teacher', async () => {
        const saved=await h.request('/api/lms/journal/save',await h.signingBody());
        expect(await h.request('/api/lms/journal/entry/'+saved.id)).toMatchObject({httpStatus:200,material_id:'read',tanggal:'2026-01-15'});
        expect((await h.request('/api/lms/journal/entry/'+saved.id,null,{uid:'lain',role:'guru_mapel'})).httpStatus).toBe(403);
    });
    test('material deletion preserves the signed aggregate evidence', async () => {
        const saved=await h.request('/api/lms/journal/save',await h.signingBody());
        h.sqlite.exec("DELETE FROM lms_materials WHERE id='read'");
        expect((await h.request(new URL(saved.evidence_url).pathname,null,null)).svg).toContain('Hadir: 1/2');
        expect(count(h,'jurnal_guru')).toBe(1);
    });
    test.each(["DELETE FROM lms_materials WHERE id='read'", "DELETE FROM lms_materials", "UPDATE lms_materials SET is_published=0"])(
        'saved attendance remains editable when source materials are unavailable: %s', async sql => {
            const first = await h.request('/api/lms/journal/save', await h.signingBody());
            const original = JSON.parse(row(h, 'lms_journal_links').snapshot_json);
            const evidence = (await h.request(new URL(first.evidence_url).pathname, null, null)).svg;
            h.sqlite.exec(sql);
            h.sqlite.exec("UPDATE students SET class='X-2',status='inactive' WHERE nis='200'; UPDATE lms_progress SET active_seconds_total=9999");
            const entry = await h.request(`/api/lms/journal/entry/${first.id}?attendance_only=1`);
            expect(entry).toMatchObject({ httpStatus:200, context:{ existing:{ id:first.id, revision:1 } } });
            expect(entry.context.existing.snapshot.material_ids).toEqual(['read']);
            const body = await h.signingBody({ attendance_only:true, journal_id:first.id, overrides:{'200':{status:'I',reason:'Izin keluarga'}} });
            const saved = await h.request('/api/lms/journal/save', body);
            expect(saved).toMatchObject({ httpStatus:200, id:first.id, revision:2, workloadSync:{ success:true, matched:true } });
            const updated = JSON.parse(row(h, 'lms_journal_links').snapshot_json);
            expect(updated).toMatchObject({ material_ids:original.material_ids, snapshot_at:original.snapshot_at, topik:original.topik, jp:original.jp });
            expect(updated.students[0]).toEqual(original.students[0]);
            expect(updated.students[1]).toMatchObject({ nis:'200',status:'I',source:'koreksi_guru',reason:'Izin keluarga',active_seconds:original.students[1].active_seconds });
            expect(JSON.parse(row(h, 'jurnal_guru').presensi_detail)).toEqual([{nama:'Siswa Dua',nis:'200',status:'I'}]);
            expect((await h.request(new URL(first.evidence_url).pathname, null, null)).svg).toBe(evidence);
            expect(count(h, 'jurnal_guru')).toBe(1); expect(count(h, 'work_logs')).toBe(1); expect(count(h, 'lms_journal_evidence')).toBe(2);
            expect((await h.request('/api/lms/journal/save', body)).already_saved).toBe(true);
        }
    );
    test('attendance corrections retain identity and learning data and require valid reasons, ownership and a fresh signature', async () => {
        const first = await h.request('/api/lms/journal/save', await h.signingBody());
        const correction = { attendance_only:true, journal_id:first.id, overrides:{'200':{status:'H',reason:'Hadir di kelas'}} };
        const preview = await h.request('/api/lms/journal/preview', { ...correction, guru:'Palsu', topik:'Palsu', tanggal:'2099-01-01', jp:[1], material_ids:['read2'], students:[] });
        expect(preview.snapshot).toMatchObject({ guru:'Guru Resmi',topik:'Materi Pertama',tanggal:'2026-01-15',jp:[2,3,4],material_ids:['read'],summary:{hadir:2} });
        expect((await h.request('/api/lms/journal/preview', { ...correction, overrides:{'200':{status:'H',reason:''}} })).httpStatus).toBe(200);
        for (const overrides of [{'200':{status:'X',reason:'Uji'}}, {'300':{status:'H',reason:'Uji'}}]) {
            expect((await h.request('/api/lms/journal/preview', { ...correction, overrides })).httpStatus).toBe(400);
        }
        expect((await h.request(`/api/lms/journal/entry/${first.id}?attendance_only=1`, null, {uid:'lain',role:'guru_mapel'})).httpStatus).toBe(403);
        expect((await h.request('/api/lms/journal/preview', correction, {uid:'lain',role:'guru_mapel'})).httpStatus).toBe(403);
        expect((await h.request('/api/lms/journal/preview', {...correction,journal_id:'manual'})).httpStatus).toBe(404);
        const body = await h.signingBody(correction);
        expect((await h.request('/api/lms/journal/save', {...body,ttd:''})).httpStatus).toBe(400);
        expect((await h.request('/api/lms/journal/save', {...body,confirm_attendance:false})).httpStatus).toBe(400);
        expect((await h.request('/api/lms/journal/save', {...body,overrides:{'200':{status:'S',reason:'Sakit'}}})).httpStatus).toBe(409);
        expect(row(h, 'lms_journal_links').revision).toBe(1);
        expect((await h.request('/api/lms/journal/save', body)).httpStatus).toBe(200);
        expect((await h.request('/api/lms/journal/save', {...body,request_id:crypto.randomUUID()})).httpStatus).toBe(409);
    });
    test('explicit saved-journal refresh updates automatic attendance and learning, then persists only after signing', async () => {
        const first = await h.request('/api/lms/journal/save', await h.signingBody());
        const oldEvidence = (await h.request(new URL(first.evidence_url).pathname, null, null)).svg;
        h.sqlite.exec(`INSERT INTO lms_progress(id,material_id,topic_id,student_nis,student_name,student_class,status,first_opened_at,last_accessed_at,active_seconds_total,session_count)
            VALUES('later','read','topic','200','Siswa Dua','X-1','completed','2026-01-15 04:00:00','2026-01-15 04:10:00',600,1);
            UPDATE lms_progress SET active_seconds_total=1200 WHERE student_nis='100';`);
        const base = {attendance_only:true,journal_id:first.id};
        expect((await h.request('/api/lms/journal/preview',base)).snapshot.summary.hadir).toBe(1);
        const preview = await h.request('/api/lms/journal/preview',{...base,refresh_attendance:true});
        expect(preview).toMatchObject({httpStatus:200,refresh_state:'updated',snapshot:{summary:{hadir:2,active_seconds_total:1800}}});
        expect(preview.snapshot.students[1]).toMatchObject({nis:'200',status:'H',source:'progres_lms',learning_status:'completed',active_seconds:600});
        expect(row(h,'lms_journal_links').revision).toBe(1);
        expect(JSON.parse(row(h,'jurnal_guru').presensi_detail)).toEqual([{nama:'Siswa Dua',nis:'200',status:'A'}]);
        const body = await h.signingBody({...base,refresh_attendance:true});
        h.sqlite.exec("UPDATE lms_progress SET active_seconds_total=1800 WHERE student_nis='200'");
        const saved = await h.request('/api/lms/journal/save',body);
        expect(saved).toMatchObject({httpStatus:200,id:first.id,revision:2});
        expect(JSON.parse(row(h,'jurnal_guru').presensi_detail)).toEqual([]);
        expect(JSON.parse(row(h,'lms_journal_links').snapshot_json).students[1].active_seconds).toBe(600);
        expect((await h.request(new URL(first.evidence_url).pathname,null,null)).svg).toBe(oldEvidence);
        expect((await h.request('/api/lms/journal/save',body)).already_saved).toBe(true);
    });
    test('attendance refresh respects the signed period, manual corrections, roster and original material selection', async () => {
        const first = await h.request('/api/lms/journal/save',await h.signingBody({overrides:{'200':{status:'I',reason:'Izin keluarga'}}}));
        h.sqlite.exec(`INSERT INTO lms_activity_events(id,material_id,student_nis,action,occurred_at) VALUES
            ('in-period','read','200','open','2026-01-15 04:00:00'),('outsider','read','300','open','2026-01-15 04:00:00');
            UPDATE students SET class='X-2',status='inactive' WHERE nis='200';`);
        const base = {attendance_only:true,journal_id:first.id,refresh_attendance:true,tanggal:'2099-01-01',material_ids:['read2']};
        const preview = await h.request('/api/lms/journal/preview',base);
        expect(preview.snapshot.material_ids).toEqual(['read']);expect(preview.snapshot.students.map(s=>s.nis)).toEqual(['100','200']);
        expect(preview.snapshot.students[1]).toMatchObject({status:'I',source:'koreksi_guru',reason:'Izin keluarga',has_progress:true});
        const correction = await h.request('/api/lms/journal/preview',{...base,overrides:{'200':{status:'S',reason:'Koreksi guru'}}});
        expect(correction.snapshot.students[1]).toMatchObject({status:'S',reason:'Koreksi guru'});
        expect((await h.request('/api/lms/journal/preview',base,{uid:'lain',role:'guru_mapel'})).httpStatus).toBe(403);
        expect((await h.request('/api/lms/journal/preview',base,{uid:'pengelola',role:'admin'})).httpStatus).toBe(200);
    });
    test('out-of-period and unrelated activity does not change Alfa when refreshing saved attendance', async () => {
        const first = await h.request('/api/lms/journal/save',await h.signingBody());
        h.sqlite.exec(`INSERT INTO lms_activity_events(id,material_id,student_nis,action,occurred_at) VALUES
            ('next-day','read','200','open','2026-01-16 04:00:00'),('other-source','read2','200','open','2026-01-15 04:00:00');`);
        const preview = await h.request('/api/lms/journal/preview',{attendance_only:true,journal_id:first.id,refresh_attendance:true});
        expect(preview.snapshot.students[1]).toMatchObject({status:'A',has_progress:false});
    });
    test('partial or deleted sources keep signed evidence while available sources can add attendance', async () => {
        const first=await h.request('/api/lms/journal/save',await h.signingBody({material_ids:['read','read2']}));
        h.sqlite.exec(`DELETE FROM lms_materials WHERE id='read2';
            UPDATE lms_progress SET active_seconds_total=9999;
            INSERT INTO lms_activity_events(id,material_id,student_nis,action,occurred_at) VALUES ('later','read','200','open','2026-01-15 04:00:00');`);
        const base={attendance_only:true,journal_id:first.id,refresh_attendance:true};
        const partial=await h.request('/api/lms/journal/preview',base);
        expect(partial).toMatchObject({refresh_state:'partial',snapshot:{summary:{hadir:2}}});
        expect(partial.snapshot.students[0].active_seconds).toBe(915);
        h.sqlite.exec('DELETE FROM lms_materials');
        const missing=await h.request('/api/lms/journal/preview',base);
        expect(missing).toMatchObject({httpStatus:200,refresh_state:'unavailable',snapshot:{summary:{hadir:1}}});
        expect(missing.history_note).toContain('tidak tersedia');
    });
    test.each(["UPDATE work_logs SET is_locked=1", "UPDATE work_logs SET verification_status='verified',verified_by_uid='kepsek'", "UPDATE work_weeks SET is_locked=1"])(
        'attendance corrections respect realization and week locks: %s', async sql => {
            const first = await h.request('/api/lms/journal/save', await h.signingBody());
            const body = await h.signingBody({ attendance_only:true, journal_id:first.id, overrides:{'200':{status:'S',reason:'Sakit'}} });
            h.sqlite.exec(sql);
            expect((await h.request('/api/lms/journal/save', body)).httpStatus).toBe(409);
            expect(row(h, 'lms_journal_links').revision).toBe(1); expect(count(h, 'lms_journal_evidence')).toBe(1);
        }
    );
    test('legacy reopen never substitutes unrelated material after the signed source is deleted', async () => {
        const first = await h.request('/api/lms/journal/save', await h.signingBody());
        h.sqlite.exec("DELETE FROM lms_materials WHERE id='read'");
        expect((await h.request(`/api/lms/journal/entry/${first.id}`)).httpStatus).toBe(409);
    });
    test.each(['academic_year','semester'])('context retains the source material when legacy topic %s is NULL', async column => {
        h.sqlite.exec(`UPDATE lms_topics SET ${column}=NULL`);
        const context = await h.request('/api/lms/journal/context?material_id=read&tanggal=2026-01-15');
        expect(context.httpStatus).toBe(200); expect(context.materials.map(material=>material.id)).toEqual(['read','read2']);
    });
    test('plan scope cannot accidentally match X-11 when the journal is X-1', async () => {
        h.sqlite.exec("UPDATE plan_activities SET title='KBM IPA (X-11)'; UPDATE plan_time_segments SET description='KBM IPA Kelas X-11 (JP 2–4)'");
        expect((await h.request('/api/lms/journal/context?material_id=read&tanggal=2026-01-15')).meetings).toEqual([]);
        expect((await h.request('/api/lms/journal/preview',h.base)).httpStatus).toBe(409);
    });
    test('historical revisions retain the signed roster when a student changes class or becomes inactive', async () => {
        await h.request('/api/lms/journal/save',await h.signingBody({overrides:{'200':{status:'I',reason:'Izin keluarga'}}}));
        h.sqlite.exec("UPDATE students SET class='X-2',status='inactive' WHERE nis='200'");
        const preview=await h.request('/api/lms/journal/preview',{...h.base,overrides:{'200':{status:'I',reason:'Izin keluarga'}}});
        expect(preview.snapshot.students.map(student=>student.nis)).toEqual(['100','200']);
        expect((await h.request('/api/lms/journal/save',await h.signingBody({overrides:{'200':{status:'I',reason:'Izin keluarga'}}}))).httpStatus).toBe(200);
    });
    test('teacher grading on a later day is not student activity on that day', async () => {
        h.sqlite.exec("UPDATE lms_materials SET resource_type='quiz' WHERE id='read'; UPDATE lms_progress SET first_opened_at='2026-01-14 02:00:00',last_accessed_at='2026-01-15 02:00:00',completed_at='2026-01-15 02:00:00'");
        const result=await h.request('/api/lms/journal/preview',h.base);
        expect(result.snapshot.summary.hadir).toBe(0);
    });
    test('PNG header alone is rejected and XML control characters cannot break generated evidence', async () => {
        const body=await h.signingBody({topik:'Materi <script> & contoh\u0001'});
        const header=Buffer.alloc(90);Buffer.from('89504e470d0a1a0a','hex').copy(header);header.write('IHDR',12);header.writeUInt32BE(600,16);header.writeUInt32BE(220,20);
        expect((await h.request('/api/lms/journal/save',{...body,ttd:'data:image/png;base64,'+header.toString('base64')})).httpStatus).toBe(400);
        const saved=await h.request('/api/lms/journal/save',body);
        const evidence=await h.request(new URL(saved.evidence_url).pathname,null,null);
        expect(evidence.svg).toContain('&lt;script&gt; &amp;'); expect(evidence.svg).not.toContain('\u0001');
    });
    test('a realization locked between review and transaction cannot change signed journal data', async () => {
        await h.request('/api/lms/journal/save',await h.signingBody());
        const body=await h.signingBody({topik:'Revisi'}), batch=h.env.DB.batch;
        h.env.DB.batch=async statements=>{h.sqlite.exec('UPDATE work_logs SET is_locked=1');return batch(statements);};
        expect((await h.request('/api/lms/journal/save',body)).httpStatus).toBe(409);
        expect(row(h,'jurnal_guru').topik).toBe('Materi Pertama'); expect(row(h,'lms_journal_links').revision).toBe(1);
    });
    test('a linked realization cannot silently lose its plan when the signed journal is revised', async () => {
        await h.request('/api/lms/journal/save',await h.signingBody());
        expect((await h.request('/api/lms/journal/save',await h.signingBody({plan_segment_id:''}))).httpStatus).toBe(409);
        expect(row(h,'lms_journal_links').plan_segment_id).toBe('segment');
    });
    test('meetings use the same academic year and recognize numeric semester codes', async () => {
        h.sqlite.exec("UPDATE work_weeks SET semester='1'");
        expect((await h.request('/api/lms/journal/context?material_id=read&tanggal=2026-01-15')).meetings).toHaveLength(1);
        h.sqlite.exec("UPDATE work_weeks SET academic_year='2025/2026'");
        expect((await h.request('/api/lms/journal/context?material_id=read&tanggal=2026-01-15')).meetings).toEqual([]);
    });
    test('aggregate evidence supports trusted cross-origin image/export loading', async () => {
        const saved=await h.request('/api/lms/journal/save',await h.signingBody());
        const response=await h.context.worker.fetch(new Request(saved.evidence_url,{headers:{Origin:'https://smagesa.web.app'}}),h.env,{});
        expect(response.status).toBe(200); expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://smagesa.web.app');
        expect(response.headers.get('Content-Type')).toContain('image/svg+xml');
    });
    test('ambiguous legacy JP descriptions never prefill a partial range or realize the wrong JP count', async () => {
        h.sqlite.exec("UPDATE plan_time_segments SET description='KBM IPA Kelas X-1 (JP 2 s/d 4)'");
        const context=await h.request('/api/lms/journal/context?material_id=read&tanggal=2026-01-15');
        expect(context.meetings[0]).toMatchObject({jp:[],jp_count:3});
        expect((await h.request('/api/lms/journal/preview',{...h.base,jp:[2]})).httpStatus).toBe(409);
        expect((await h.request('/api/lms/journal/preview',h.base)).httpStatus).toBe(200);
    });
    test('learning metrics aggregate only selected materials and never determine daily attendance',async()=>{
        h.sqlite.exec("INSERT INTO lms_progress(id,material_id,topic_id,student_nis,student_name,student_class,status,first_opened_at,last_accessed_at,active_seconds_total,session_count) VALUES ('second','read2','topic','100','Siswa Satu','X-1','completed','2026-01-14 02:00:00','2026-01-14 02:00:00',60,1)");
        const one=await h.request('/api/lms/journal/preview',h.base);
        expect(one.snapshot.students[0]).toMatchObject({active_seconds:915,materials_completed:0});
        const both=await h.request('/api/lms/journal/preview',{...h.base,material_ids:['read','read2']});
        expect(both.snapshot.students[0]).toMatchObject({active_seconds:975,materials_completed:1,learning_status:'in_progress'});
        const priorOnly=await h.request('/api/lms/journal/preview',{...h.base,material_ids:['read2']});
        expect(priorOnly.snapshot.students[0]).toMatchObject({learning_status:'completed',active_seconds:60,status:'',has_progress:false});
    });
    test('duration and completion are frozen during TTD and old evidence stays unchanged after a revision',async()=>{
        const body=await h.signingBody();
        h.sqlite.exec("UPDATE lms_progress SET active_seconds_total=2400,status='completed'");
        const first=await h.request('/api/lms/journal/save',body); expect(first.httpStatus).toBe(200);
        expect(JSON.parse(row(h,'lms_journal_links').snapshot_json).students[0]).toMatchObject({active_seconds:915,learning_status:'in_progress'});
        const firstSvg=(await h.request(new URL(first.evidence_url).pathname,null,null)).svg;
        expect(firstSvg).toContain('15 mnt 15 dtk'); expect(firstSvg).not.toContain('40 mnt');
        const updated=await h.request('/api/lms/journal/save',await h.signingBody()); expect(updated.revision).toBe(2);
        expect((await h.request(new URL(updated.evidence_url).pathname,null,null)).svg).toContain('40 mnt');
        expect((await h.request(new URL(first.evidence_url).pathname,null,null)).svg).toBe(firstSvg);
    });
    test('a modified or different-user learning receipt cannot forge duration or completion',async()=>{
        const body=await h.signingBody(), parts=body.learning_receipt.split('.');
        const payload=JSON.parse(Buffer.from(parts[0],'base64url').toString()); payload.rows[0].active_seconds=99999;
        const forged=Buffer.from(JSON.stringify(payload)).toString('base64url')+'.'+parts[1];
        expect((await h.request('/api/lms/journal/save',{...body,learning_receipt:forged})).httpStatus).toBe(409);
        expect((await h.request('/api/lms/journal/save',body,{uid:'admin-other',role:'admin'})).httpStatus).toBe(409);
        expect(count(h,'jurnal_guru')).toBe(0);
    });
    test('expired learning receipt requires a fresh review without writing a partial journal',async()=>{
        const body=await h.signingBody();
        require('node:vm').runInContext(`Date.now=()=>${Date.now()+3601000}`,h.context);
        expect((await h.request('/api/lms/journal/save',body)).httpStatus).toBe(409); expect(count(h,'jurnal_guru')).toBe(0);
    });
    test('an older client without a receipt retains live hash validation',async()=>{
        delete h.env.SESSION_SECRET;
        const body=await h.signingBody(); expect(body.learning_receipt).toBe('');
        h.sqlite.exec('UPDATE lms_progress SET active_seconds_total=3000');
        expect((await h.request('/api/lms/journal/save',body)).httpStatus).toBe(409);
        expect((await h.request('/api/lms/journal/save',await h.signingBody())).httpStatus).toBe(200);
    });
    test('profile photo comes from the official teacher record and unsafe protocols are rejected',async()=>{
        h.sqlite.exec("UPDATE gtk SET foto='/api/photos/gtk/resmi.webp'");
        const context=await h.request('/api/lms/journal/context?material_id=read&tanggal=2026-01-15');
        expect(context.scope.teacher_photo_url).toBe('https://worker.test/api/photos/gtk/resmi.webp');
        h.sqlite.exec("UPDATE gtk SET foto='javascript:alert(1)'");
        expect((await h.request('/api/lms/journal/context?material_id=read&tanggal=2026-01-15')).scope.teacher_photo_url).toBe('');
    });
});

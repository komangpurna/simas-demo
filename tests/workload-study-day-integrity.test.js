const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const { loadWorkerLibModule } = require('./helpers/worker-source.cjs');
const { loadWorkloadCalculations } = require('./helpers/ui-runtime-source.cjs');
const { journalHarness } = require('./helpers/lms-journal-harness.cjs');

const { parseOfficialTeacherSchedule } = loadWorkerLibModule('lib/workload-study-day.js');
const { detectTeacherStudyDay, validateTeacherStudyDayPlan } = loadWorkloadCalculations();

function schedule(days = [1, 2, 4, 5], teachers = '<teacher id="asc-a" name="Guru Resmi" short="A"/>') {
    return { xmlContent: `<timetable><periods>
        <period period="1" starttime="7:30" endtime="8:15"/>
        <period period="2" starttime="8:15" endtime="9:00"/>
        </periods><subjects><subject id="ipa" name="IPA &amp; Sains"/></subjects>
        <teachers>${teachers}</teachers><lessons>
        <lesson id="lesson" teacherids="asc-a" subjectid="ipa" periodspercard="1"/>
        </lessons><cards>${days.map(day => `<card lessonid="lesson" period="1" days="${'00000'.split('').map((_, i) => i + 1 === day ? '1' : '0').join('')}"/>`).join('')}</cards></timetable>` };
}

describe('Production HBG detection and official aSc input', () => {
    const teacher = { id: 'gtk-guru', name: 'Guru Resmi' };
    test('empty or partial plans never prove a free teaching day', () => {
        expect(detectTeacherStudyDay([])).toMatchObject({ studyDayIndex: null, status: 'unavailable' });
        expect(detectTeacherStudyDay([{ day_of_week: 2, is_teaching: 1 }])).toMatchObject({ studyDayIndex: null, status: 'unavailable' });
    });
    test('complete official schedule detects Wednesday even when plan is empty', () => {
        const parsed = parseOfficialTeacherSchedule(schedule(), teacher);
        expect(parsed.complete).toBe(true);
        expect(parsed.days[1][0]).toMatchObject({ minutes: 45, mapel: 'IPA & Sains' });
        expect(detectTeacherStudyDay([], { teacherSchedule: parsed })).toMatchObject({ studyDayIndex: 2, status: 'auto' });
    });
    test('blank parser placeholders are not counted as KBM', () => {
        const parsed = parseOfficialTeacherSchedule(schedule(), teacher);
        parsed.days[3].push({ jp: 1, mapel: '' });
        expect(detectTeacherStudyDay([], { teacherSchedule: parsed }).studyDayIndex).toBe(2);
    });
    test('planned teaching on the official free day requires explicit selection', () => {
        expect(detectTeacherStudyDay([{ day_of_week: 3, is_teaching: true }], {
            teacherSchedule: parseOfficialTeacherSchedule(schedule(), teacher)
        })).toMatchObject({ studyDayIndex: null, status: 'needs_selection' });
    });
    test('fully occupied days return only a suggestion ranked by duration', () => {
        const parsed = parseOfficialTeacherSchedule(schedule([1, 2, 3, 4, 5]), teacher);
        Object.values(parsed.days).forEach(slots => { slots[0].minutes = 120; });
        parsed.days[4] = [{ is_teaching: true, minutes: 30 }, { is_teaching: true, minutes: 30 }];
        expect(detectTeacherStudyDay([], { teacherSchedule: parsed })).toMatchObject({ studyDayIndex: null, status: 'needs_selection', suggestedDayIndex: 3 });
    });
    test('automatic selection excludes holidays and leave; manual selection retains exemption', () => {
        const parsed = parseOfficialTeacherSchedule(schedule([2, 4, 5]), teacher);
        expect(detectTeacherStudyDay([], { teacherSchedule: parsed, excludedDayIndexes: [0] }).studyDayIndex).toBe(2);
        expect(detectTeacherStudyDay([], { teacherSchedule: parsed, manualStudyDayIndex: 0, excludedDayIndexes: [0] }))
            .toMatchObject({ status: 'manual', studyDayIndex: 0, isExempt: true });
        expect(detectTeacherStudyDay([], { excludedDayIndexes: [0, 1, 2, 3, 4] })).toMatchObject({ status: 'exempt', isExempt: true });
    });
    test.each([undefined, {}, { xmlContent: '<timetable><teachers>' }, { xmlContent: schedule().xmlContent.replace('</cards>', '') }])('missing or truncated XML is unavailable: %p', config => {
        expect(parseOfficialTeacherSchedule(config, teacher).complete).toBe(false);
    });
    test('no matched teacher and ambiguous names cannot create an automatic Monday', () => {
        expect(parseOfficialTeacherSchedule(schedule(), { id: 'other', name: 'Orang Lain' }).complete).toBe(false);
        const config = schedule(undefined, '<teacher id="asc-a" name="Guru Resmi"/><teacher id="asc-b" name="Guru Resmi"/>');
        expect(parseOfficialTeacherSchedule(config, teacher).complete).toBe(false);
        config.teacherMapping = { 'asc-a': 'gtk-guru' };
        expect(parseOfficialTeacherSchedule(config, teacher).teacherId).toBe('asc-a');
        config.teacherMapping = { 'gtk-guru': 'asc-a' };
        expect(parseOfficialTeacherSchedule(config, teacher).teacherId).toBe('asc-a');
    });
    test('multi-day cards count each occupied JP once without expanding periodspercard', () => {
        const config = schedule([1]);
        config.xmlContent = config.xmlContent.replace('periodspercard="1"', 'periodspercard="2"').replace('days="10000"', 'days="11000"');
        const parsed = parseOfficialTeacherSchedule(config, teacher);
        expect(parsed.complete).toBe(true);
        expect(parsed.days[1]).toHaveLength(1);
        expect(parsed.days[2]).toHaveLength(1);
    });
    test('repository aSc master is accepted without changing its export format', () => {
        const config = { xmlContent: fs.readFileSync(path.join(__dirname, '../assets/Jadwal.xml'), 'utf8') };
        const parsed = parseOfficialTeacherSchedule(config, { id: '119C05C548251565' });
        expect(parsed.complete).toBe(true);
        expect(Object.values(parsed.days).flat().length).toBeGreaterThan(0);
    });
    test('bundled Worker retains national holidays through the UMD module import', async () => {
        const built = esbuild.buildSync({ entryPoints: [path.join(__dirname, '../cloudflare/lib/workload-study-day.js')], bundle: true, platform: 'browser', format: 'cjs', write: false });
        const module = { exports: {} };
        const context = vm.createContext({ module, exports: module.exports, console, URLSearchParams });
        vm.runInContext(built.outputFiles[0].text, context);
        const db = { prepare: sql => ({ bind() { return this; }, first: async () => sql.includes('workload_study_days') ? { manual_day_index: 0 } : null, all: async () => ({ results: [] }) }) };
        const result = await module.exports.resolveWorkloadStudyDay(db, { teacher_id: 'guru', week_start_date: '2026-06-01' }, { id: 'v', status: 'draft' }, []);
        expect(result).toMatchObject({ status: 'manual', studyDayIndex: 0, isExempt: true });
    });
    test('submission requires a real HBG activity on the exact date with positive duration', () => {
        const study = { studyDayIndex: 2, studyDayName: 'Rabu' };
        const seg = { day_of_week: 3, date: '2026-10-14', start_time: '10:00', end_time: '11:00', category_code: 'PERENCANAAN' };
        expect(validateTeacherStudyDayPlan(study, [seg], '2026-10-12').isValid).toBe(true);
        for (const invalid of [
            { ...seg, date: '2026-10-13' }, { ...seg, end_time: '10:00' },
            { ...seg, is_teaching: true, title: 'PKB' }, { ...seg, is_leave: true }, { ...seg, is_holiday: true }
        ]) expect(validateTeacherStudyDayPlan(study, [invalid], '2026-10-12').isValid).toBe(false);
    });
});

describe('HBG D1 persistence, authorization and submission using real SQLite', () => {
    let h;
    const route = '/api/workload/study-day';
    const weekRoute = '/api/workload/week?week_start_date=2026-10-12';
    const payload = (manual_day_index = 2, revision_lock = 1) => ({ work_week_id: 'week', plan_version_id: 'version', revision_lock, manual_day_index });
    const submit = revision_lock => h.request('/api/workload/submit-plan', { work_week_id: 'week', plan_version_id: 'version', revision_lock });
    const setConfig = config => h.sqlite.prepare("INSERT INTO system_settings(key,value) VALUES ('schedule_config',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(config));
    function hbgSegment(date = '2026-10-14', day = 3) {
        h.sqlite.exec(`INSERT OR IGNORE INTO activity_catalog(id,code,category_code,category_name,name) VALUES ('cat_rencana_modul','TEST_HBG','PERENCANAAN','Rencana','Rencana');
            INSERT INTO plan_activities(id,work_week_id,catalog_id,title,category_code) VALUES ('hbg','week','cat_rencana_modul','Modul ajar','PERENCANAAN');`);
        h.sqlite.prepare(`INSERT INTO plan_time_segments(id,plan_version_id,activity_id,date,day_of_week,start_time,end_time,planned_minutes)
            VALUES ('hbg-seg','version','hbg',?,?,'10:00','11:00',60)`).run(date, day);
    }
    beforeEach(() => {
        h = journalHarness();
        h.sqlite.exec(`UPDATE work_weeks SET week_start_date='2026-10-12',week_end_date='2026-10-16';
            UPDATE plan_time_segments SET date='2026-10-15';
            UPDATE weekly_plan_versions SET status='draft',revision_lock=1;`);
        setConfig(schedule());
    });
    afterEach(() => h.sqlite.close());
    test('GET returns official detection and never creates a missing table', async () => {
        h.sqlite.exec('DROP TABLE workload_study_days');
        const result = await h.request(weekRoute);
        expect(result.httpStatus).toBe(200);
        expect(result.data.study_day).toMatchObject({ status: 'auto', studyDayIndex: 2 });
        expect(h.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='workload_study_days'").get()).toBeUndefined();
    });
    test('manual choice survives a new request and is visible to a manager', async () => {
        expect((await h.request(route, payload(1))).httpStatus).toBe(200);
        expect((await h.request(weekRoute)).data.study_day).toMatchObject({ status: 'manual', studyDayIndex: 1 });
        const manager = { uid: 'admin', role: 'super_admin' };
        expect((await h.request(weekRoute + '&teacher_id=gtk-guru', null, manager)).data.study_day.studyDayIndex).toBe(1);
        h.sqlite.exec("INSERT INTO gtk(id,name) VALUES ('guru-b','Guru B');");
        expect((await h.request(weekRoute + '&teacher_id=guru-b', null, manager)).data.study_day.studyDayIndex).toBeNull();
    });
    test('switching back to automatic clears the manual override', async () => {
        expect((await h.request(route, payload(1))).httpStatus).toBe(200);
        expect((await h.request(route, payload(null, 2))).data.study_day).toMatchObject({ status: 'auto', studyDayIndex: 2 });
        expect(h.sqlite.prepare('SELECT manual_day_index FROM workload_study_days').get().manual_day_index).toBeNull();
    });
    test('mutation upgrades a legacy database idempotently', async () => {
        h.sqlite.exec('DROP TABLE workload_study_days');
        expect((await h.request(route, payload())).httpStatus).toBe(200);
        expect((await h.request(route, payload(1, 2))).httpStatus).toBe(200);
        expect(h.sqlite.prepare('SELECT COUNT(*) AS count FROM workload_study_days').get().count).toBe(1);
    });
    test('requests for another teacher or without authentication are rejected', async () => {
        expect((await h.request(route, payload(), { uid: 'outsider', role: 'guru_mapel' })).httpStatus).toBe(403);
        expect((await h.request(route, payload(), {})).httpStatus).toBe(401);
        expect(h.sqlite.prepare('SELECT * FROM workload_study_days').all()).toHaveLength(0);
    });
    test.each(['submitted', 'approved', 'rejected'])('status %s protects the saved choice', async status => {
        h.sqlite.prepare('UPDATE weekly_plan_versions SET status=?').run(status);
        expect((await h.request(route, payload())).httpStatus).toBe(403);
    });
    test('locked weeks and stale revisions cannot overwrite selection', async () => {
        expect((await h.request(route, payload())).httpStatus).toBe(200);
        expect((await h.request(route, payload(0))).httpStatus).toBe(409);
        h.sqlite.exec('UPDATE work_weeks SET is_locked=1');
        expect((await h.request(route, payload(0, 2))).httpStatus).toBe(403);
        expect(h.sqlite.prepare('SELECT manual_day_index FROM workload_study_days').get().manual_day_index).toBe(2);
    });
    test('a concurrent version change inside the write boundary preserves the prior choice', async () => {
        expect((await h.request(route, payload())).httpStatus).toBe(200);
        const batch = h.env.DB.batch;
        h.env.DB.batch = async statements => {
            h.sqlite.exec('UPDATE weekly_plan_versions SET revision_lock=revision_lock+1');
            return batch(statements);
        };
        expect((await h.request(route, payload(0, 2))).httpStatus).toBe(409);
        expect(h.sqlite.prepare('SELECT manual_day_index FROM workload_study_days').get().manual_day_index).toBe(2);
    });
    test.each([-1, 5, 1.5, '', '2', true])('invalid manual choice %p cannot be coerced into a day', async index => {
        expect((await h.request(route, payload(index))).httpStatus).toBe(400);
    });
    test('failed persistence rolls back the associated revision update', async () => {
        h.sqlite.exec("CREATE TRIGGER fail_hbg BEFORE INSERT ON workload_study_days BEGIN SELECT RAISE(ABORT,'test failure'); END;");
        expect((await h.request(route, payload())).httpStatus).toBe(500);
        expect(h.sqlite.prepare('SELECT revision_lock FROM weekly_plan_versions').get().revision_lock).toBe(1);
    });
    test('server rejects direct submission without an HBG activity or a confirmed day', async () => {
        expect((await submit(1)).httpStatus).toBe(422);
        setConfig(schedule([1, 2, 3, 4, 5]));
        hbgSegment();
        expect((await submit(1)).httpStatus).toBe(422);
        expect(h.sqlite.prepare('SELECT status FROM weekly_plan_versions').get().status).toBe('draft');
    });
    test('a keyword in KBM cannot satisfy HBG; a real activity on another date cannot either', async () => {
        h.sqlite.exec("UPDATE plan_activities SET title='PKB webinar'; UPDATE plan_time_segments SET date='2026-10-14',day_of_week=3;");
        expect((await h.request(route, payload())).httpStatus).toBe(200);
        expect((await submit(2)).httpStatus).toBe(422);
        hbgSegment('2026-10-13', 2);
        expect((await submit(2)).httpStatus).toBe(422);
    });
    test.each([0, 1])('approval mode %s stores a stable snapshot with the status transition', async require_plan_approval => {
        h.sqlite.prepare("INSERT INTO system_settings(key,value) VALUES ('workload_policy_config',?)").run(JSON.stringify({ require_plan_approval }));
        hbgSegment();
        const result = await submit(1);
        expect(result.httpStatus).toBe(200);
        expect(result.data.status).toBe(require_plan_approval ? 'submitted' : 'approved');
        const snapshot = JSON.parse(h.sqlite.prepare('SELECT resolution_json FROM workload_study_days').get().resolution_json);
        setConfig(schedule([1, 2, 3, 4]));
        expect((await h.request(weekRoute)).data.study_day).toEqual(snapshot);
        expect((await h.request(route, payload(0, 2))).httpStatus).toBe(403);
    });
    test('a snapshot write failure also rolls back submission status', async () => {
        hbgSegment();
        h.sqlite.exec("CREATE TRIGGER fail_hbg BEFORE INSERT ON workload_study_days BEGIN SELECT RAISE(ABORT,'test failure'); END;");
        expect((await submit(1)).httpStatus).toBe(500);
        expect(h.sqlite.prepare('SELECT status,revision_lock FROM weekly_plan_versions').get()).toMatchObject({ status: 'draft', revision_lock: 1 });
    });
    test.each(['holiday', 'leave'])('manual HBG on %s is exempt at the server', async type => {
        if (type === 'holiday') h.sqlite.exec("INSERT INTO calendar_events(id,title,date,category,created_by) VALUES ('libur','Libur sekolah','2026-10-14','libur','admin');");
        else {
            hbgSegment();
            h.sqlite.exec("UPDATE plan_activities SET category_code='CUTI_IZIN' WHERE id='hbg'");
        }
        expect((await h.request(route, payload())).data.study_day.isExempt).toBe(true);
        expect((await submit(2)).httpStatus).toBe(200);
    });
    test('automatic detection ignores the holiday free day and does not invent another free day', async () => {
        h.sqlite.exec("INSERT INTO calendar_events(id,title,date,category,created_by) VALUES ('libur','Libur sekolah','2026-10-14','libur','admin');");
        expect((await h.request(weekRoute)).data.study_day).toMatchObject({ studyDayIndex: null, status: 'needs_selection' });
    });
    test('registered school holidays from Supabase receive the same exemption as the browser', async () => {
        h.env.SUPABASE_URL = 'https://school.example.test';
        h.env.SUPABASE_ANON_KEY = 'test-public-key';
        h.context.fetch = jest.fn(async () => new Response(JSON.stringify([{ tanggal: '2026-10-14' }]), { status: 200 }));
        expect((await h.request(route, payload())).data.study_day.isExempt).toBe(true);
        expect((await submit(2)).httpStatus).toBe(200);
        expect(h.context.fetch.mock.calls[0][0]).toContain('/rest/v1/lib_opac_hari_libur?');
    });
    test('production anon credentials read only the existing public date view, never the protected base table', async () => {
        h.env.SUPABASE_URL = 'https://school.example.test';
        h.env.SUPABASE_ANON_KEY = 'test-public-key';
        h.env.SUPABASE_SERVICE_ROLE_KEY = 'unneeded-service-key';
        h.context.fetch = jest.fn(async url => url.includes('/rest/v1/lib_opac_hari_libur?')
            ? new Response(JSON.stringify([{ tanggal: '2026-10-14' }]), { status: 200 })
            : new Response(JSON.stringify({ code: '42501', message: 'permission denied for table lib_hari_libur' }), { status: 401 }));
        const week = await h.request(weekRoute);
        expect(week.httpStatus).toBe(200);
        expect(week.data.study_day.status).toBe('needs_selection');
        expect((await h.request(route, payload())).data.study_day).toMatchObject({ status: 'manual', isExempt: true });
        expect((await submit(2)).httpStatus).toBe(200);
        const calendarCalls = h.context.fetch.mock.calls.filter(([url]) => url.includes('/rest/v1/lib_'));
        expect(calendarCalls.length).toBeGreaterThan(0);
        for (const [url, options] of calendarCalls) {
            expect(url).toContain('/rest/v1/lib_opac_hari_libur?');
            expect(options.headers.apikey).toBe('test-public-key');
        }
    });
    test('calendar failures do not silently guess or persist a false exemption', async () => {
        h.env.SUPABASE_URL = 'https://school.example.test';
        h.env.SUPABASE_ANON_KEY = 'test-public-key';
        h.context.fetch = jest.fn(async () => new Response('', { status: 503 }));
        expect((await h.request(route, payload())).httpStatus).toBe(500);
        expect(h.sqlite.prepare('SELECT * FROM workload_study_days').all()).toHaveLength(0);
        expect((await submit(1)).httpStatus).toBe(500);
        expect(h.sqlite.prepare('SELECT status FROM weekly_plan_versions').get().status).toBe('draft');
    });
    test.each([401, 403, 503])('calendar HTTP %s leaves the saved week and schedule sync available', async status => {
        h.env.SUPABASE_URL = 'https://school.example.test';
        h.env.SUPABASE_ANON_KEY = 'test-public-key';
        h.context.fetch = jest.fn(async () => new Response(JSON.stringify({ code: '42501', message: 'permission denied for table lib_hari_libur' }), { status }));
        const week = await h.request(weekRoute);
        expect(week.httpStatus).toBe(200);
        expect(week.data.initialized).toBe(true);
        expect(week.data.active_version).toMatchObject({ id: 'version', status: 'draft' });
        expect(week.data.segments).toHaveLength(1);
        expect(week.data.study_day).toMatchObject({ status: 'unavailable', studyDayIndex: null, isExempt: false, retryable: true });
        const imported = await h.request('/api/workload/sync-schedule', {
            work_week_id: week.data.week.id, plan_version_id: week.data.active_version.id,
            schedule_items: [{ schedule_occurrence_id: 'asc-import', title: 'KBM IPA (X-1)', date: '2026-10-13', day_of_week: 2, start_time: '07:30', end_time: '08:15', is_teaching: 1, jp_count: 1 }]
        });
        expect(imported.httpStatus).toBe(200);
        expect(h.sqlite.prepare("SELECT COUNT(*) AS count FROM plan_activities WHERE schedule_occurrence_id='asc-import'").get().count).toBe(1);
        const refreshed = await h.request(weekRoute);
        expect(refreshed.httpStatus).toBe(200);
        expect(refreshed.data.segments).toHaveLength(2);
        // An unread calendar still cannot grant an exemption or pass finalization.
        expect((await submit(refreshed.data.active_version.revision_lock)).httpStatus).toBe(500);
        expect(h.sqlite.prepare('SELECT status FROM weekly_plan_versions').get().status).toBe('draft');
    });
    test('calendar denial on an uninitialized week still permits initialization and a subsequent read', async () => {
        h.env.SUPABASE_URL = 'https://school.example.test';
        h.env.SUPABASE_ANON_KEY = 'test-public-key';
        h.context.fetch = jest.fn(async () => new Response('', { status: 401 }));
        const emptyRoute = '/api/workload/week?week_start_date=2026-10-19';
        const before = await h.request(emptyRoute);
        expect(before.httpStatus).toBe(200);
        expect(before.data.initialized).toBe(false);
        expect(before.data.study_day.status).toBe('unavailable');
        const initialized = await h.request('/api/workload/week/initialize', { week_start_date: '2026-10-19' });
        expect(initialized.httpStatus).toBe(200);
        const after = await h.request(emptyRoute);
        expect(after.httpStatus).toBe(200);
        expect(after.data.initialized).toBe(true);
        expect(after.data.active_version.status).toBe('draft');
    });
});

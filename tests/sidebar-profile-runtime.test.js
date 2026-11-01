/** @jest-environment jsdom */

const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');

const source = fs.readFileSync(path.join(__dirname, '../js/global.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const declarations = new Set([
    'DEFAULT_CACHE_TTL', 'sidebarAuthReady', 'sidebarResolvedNames', 'sidebarProfileRequests',
    'getSidebarProfile', 'syncSidebarProfile', 'initLayout', 'earlyInitLayout'
]);
const assignments = new Set(['escapeHTML', 'getLocalCache', 'updateUIAvatars', 'updateSidebarProfileFromDB']);
const component = ast.body.flatMap(item => {
    const node = item.declaration || item;
    const wantedDeclaration = node.type === 'FunctionDeclaration' && declarations.has(node.id.name)
        || node.type === 'VariableDeclaration' && node.declarations.some(d => declarations.has(d.id.name));
    const expression = node.expression;
    const wantedAssignment = expression?.type === 'AssignmentExpression'
        && expression.left.object?.name === 'window' && assignments.has(expression.left.property?.name);
    const authListener = expression?.type === 'CallExpression' && expression.callee.name === 'onAuthStateChanged';
    return wantedDeclaration || wantedAssignment || authListener ? [source.slice(node.start, node.end)] : [];
}).join('\n');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

const user = (uid, extra = {}) => ({ uid, email: `${uid}@school.test`, providerData: [], ...extra });
const snapshot = data => ({ exists: () => data !== null, data: () => data });

describe('Sidebar profile during authentication and navigation', () => {
    let auth;
    let getDoc;
    let authListener;
    let layout;

    beforeEach(() => {
        jest.useFakeTimers();
        localStorage.clear();
        document.body.innerHTML = '<div id="app-layout"></div><main class="hidden"></main>';
        auth = { currentUser: null };
        getDoc = jest.fn().mockResolvedValue(snapshot(null));
        window.getAllUserRoles = () => ['guru_mapel'];
        window.syncDarkModeToggles = jest.fn();
        window.getLinkedTeacherForUser = jest.fn().mockResolvedValue(null);
        window.applyVipBadgeToAllUserAvatars = jest.fn();
        const root = 'http://localhost/';
        layout = new Function('auth', 'getDoc', 'doc', 'db', 'PATHS', 'resolvePhotoUrl',
            'ROOT_URL', 'APP_VERSION', 'SCHOOL_CONFIG', 'MENU_CONFIG', 'MENU_LABELS', 'MENU_GROUPS',
            'syncSystemAiConfig', 'injectChatIcon', 'onAuthStateChanged', 'initRealtimeMetadataListener',
            `${component}\nreturn { initLayout, earlyInitLayout };`
        )(auth, getDoc, (...args) => args, {}, { users: 'users' },
            url => url?.startsWith('/api/') ? `https://photos.test${url}` : url || '',
            root, 'test', { appBrand: 'SIMAS', schoolName: 'SMAGESA', schoolShortName: 'SMAGESA', logoPath: 'logo.png' },
            { guru_mapel: ['dashboard'] }, { dashboard: { link: `${root}dashboard.html`, icon: 'fa-home', label: 'Dashboard' } },
            [{ key: 'dashboard', type: 'single' }], jest.fn(), jest.fn(),
            (instance, callback) => { authListener = callback; }, jest.fn());
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    function expectNames(name) {
        const names = [...document.querySelectorAll('.user-name-el')];
        expect(names).toHaveLength(3); // desktop, popup, mobile
        names.forEach(el => expect(el.textContent).toBe(name));
    }

    test.each([false, true])('cached identity is present on the first render (collapsed: %s)', async collapsed => {
        localStorage.setItem('user_role', 'guru_mapel');
        localStorage.setItem('last_login_uid', 'teacher');
        localStorage.setItem('cached_user_name_teacher', 'I Komang Purna');
        localStorage.setItem('cached_user_photo_teacher', '/api/photos/teacher.webp');
        localStorage.setItem('sidebar_collapsed', String(collapsed));
        layout.earlyInitLayout();
        expectNames('I Komang Purna');
        expect(document.querySelectorAll('.user-avatar-container img')).toHaveLength(2);
        document.querySelectorAll('.user-avatar-container img').forEach(img => {
            expect(img.src).toBe('https://photos.test/api/photos/teacher.webp');
        });
        expect(getDoc).not.toHaveBeenCalled();
        expect(document.getElementById('desktop-sidebar').classList.contains(collapsed ? 'w-20' : 'w-64')).toBe(true);
        expect(document.querySelector('main').classList.contains(collapsed ? 'md:ml-20' : 'md:ml-64')).toBe(true);
    });

    test('a first login renders placeholders and resolves names and GTK photos without a 500 ms timer', async () => {
        const response = deferred();
        getDoc.mockReturnValue(response.promise);
        auth.currentUser = user('teacher');
        window.getLinkedTeacherForUser.mockResolvedValue({ data: { foto: '/api/photos/new.webp' } });
        await layout.initLayout();
        expectNames('');
        expect(document.querySelectorAll('.user-name-el [aria-label="Memuat profil"]')).toHaveLength(3);
        expect(document.getElementById('app-layout').textContent).not.toContain('Pengguna');
        expect(getDoc).toHaveBeenCalledTimes(1);
        response.resolve(snapshot({ name: 'Nama Guru' }));
        await window.updateSidebarProfileFromDB('teacher');
        expectNames('Nama Guru');
        expect(localStorage.getItem('cached_user_name_teacher')).toBe('Nama Guru');
        expect(localStorage.getItem('cached_user_photo_teacher')).toBe('https://photos.test/api/photos/new.webp');
        expect(document.querySelectorAll('.user-avatar-container img')).toHaveLength(2);
        expect(document.querySelectorAll('.user-avatar-container .animate-pulse')).toHaveLength(2);
        expect(window.applyVipBadgeToAllUserAvatars).toHaveBeenCalled();
    });

    test('auth restoration fills an already-rendered sidebar and coalesces concurrent profile requests', async () => {
        localStorage.setItem('user_role', 'guru_mapel');
        layout.earlyInitLayout();
        expectNames('');
        const response = deferred();
        getDoc.mockReturnValue(response.promise);
        auth.currentUser = user('teacher');
        authListener(auth.currentUser);
        const request = window.updateSidebarProfileFromDB('teacher');
        expect(request).toBe(window.updateSidebarProfileFromDB('teacher'));
        expect(getDoc).toHaveBeenCalledTimes(1);
        response.resolve(snapshot({ name: 'Guru Terpulihkan' }));
        await request;
        expectNames('Guru Terpulihkan');
    });

    test('cached user documents supply the correct first name without a separate name cache', async () => {
        auth.currentUser = user('teacher');
        localStorage.setItem('simas_userdoc_teacher', JSON.stringify({ data: { name: 'Nama Dokumen' }, timestamp: Date.now() }));
        await layout.initLayout();
        expectNames('Nama Dokumen');
    });

    test('refreshing an unchanged photo keeps the same image nodes', async () => {
        auth.currentUser = user('teacher');
        localStorage.setItem('cached_user_name_teacher', 'Guru');
        localStorage.setItem('cached_user_photo_teacher', '/api/photos/teacher.webp');
        await layout.initLayout();
        const images = [...document.querySelectorAll('.user-avatar-container img')];
        window.updateUIAvatars('/api/photos/teacher.webp');
        expect([...document.querySelectorAll('.user-avatar-container img')]).toEqual(images);
    });

    test.each(['user document', 'GTK photo'])('an account switch ignores a late %s response', async phase => {
        const response = deferred();
        if (phase === 'user document') getDoc.mockReturnValueOnce(response.promise);
        else {
            getDoc.mockResolvedValueOnce(snapshot({ name: 'Guru Lama' }));
            window.getLinkedTeacherForUser.mockReturnValueOnce(response.promise);
        }
        auth.currentUser = user('old');
        await layout.initLayout();
        const oldRequest = window.updateSidebarProfileFromDB('old');
        await Promise.resolve();
        auth.currentUser = user('new');
        localStorage.setItem('cached_user_name_new', 'Guru Baru');
        localStorage.setItem('cached_user_photo_new', '/api/photos/new.webp');
        await layout.initLayout();
        response.resolve(phase === 'user document' ? snapshot({ name: 'Guru Lama' }) : { data: { foto: '/api/photos/old.webp' } });
        await oldRequest;
        expectNames('Guru Baru');
        expect(localStorage.getItem('cached_user_name_old')).toBeNull();
        expect(localStorage.getItem('cached_user_photo_old')).toBeNull();
        document.querySelectorAll('.user-avatar-container img').forEach(img => {
            expect(img.src).toBe('https://photos.test/api/photos/new.webp');
        });
    });

    test('sign-out clears cached identity from the visible sidebar and ignores pending responses', async () => {
        auth.currentUser = user('teacher');
        localStorage.setItem('cached_user_name_teacher', 'Guru');
        localStorage.setItem('cached_user_photo_teacher', '/api/photos/teacher.webp');
        const response = deferred();
        getDoc.mockReturnValue(response.promise);
        await layout.initLayout();
        const request = window.updateSidebarProfileFromDB('teacher');
        auth.currentUser = null;
        authListener(null);
        expectNames('');
        expect(document.querySelector('.user-avatar-container img')).toBeNull();
        response.resolve(snapshot({ name: 'Guru' }));
        await request;
        expectNames('');
    });

    test.each(['missing document', 'network failure'])('a %s resolves placeholders to the existing email fallback', async reason => {
        auth.currentUser = user('teacher');
        if (reason === 'network failure') getDoc.mockRejectedValue(new Error('Offline'));
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        await layout.initLayout();
        await window.updateSidebarProfileFromDB('teacher');
        expectNames('teacher');
        expect(document.querySelector('.user-name-el [role="status"]')).toBeNull();
    });

    test('names containing markup remain text in desktop and mobile profiles', async () => {
        auth.currentUser = user('teacher');
        localStorage.setItem('cached_user_name_teacher', 'Guru <b>"A"</b>');
        await layout.initLayout();
        expectNames('Guru <b>"A"</b>');
        expect(document.querySelector('.user-name-el b')).toBeNull();
    });

    test('popup/embed mode still skips the shared layout', async () => {
        window.history.replaceState({}, '', '/opac.html?mode=popup');
        await layout.initLayout();
        expect(document.getElementById('app-layout').innerHTML).toBe('');
        expect(getDoc).not.toHaveBeenCalled();
        window.history.replaceState({}, '', '/');
        document.documentElement.classList.remove('is-embed-mode');
    });

    test('online status dot indicator is elevated (z-20) and not clipped by overflow-hidden', async () => {
        auth.currentUser = user('teacher');
        await layout.initLayout();

        const containers = document.querySelectorAll('.user-avatar-container');
        expect(containers).toHaveLength(2);

        containers.forEach(container => {
            // Anti-clipping: container avatar tidak boleh overflow-hidden agar dot online tidak terpotong kurva border-radius
            expect(container.classList.contains('overflow-hidden')).toBe(false);

            const dot = container.querySelector('.animate-pulse');
            expect(dot).not.toBeNull();
            expect(dot.classList.contains('z-20')).toBe(true);
            expect(dot.classList.contains('bg-emerald-500')).toBe(true);
            expect(dot.getAttribute('title')).toBe('Online');
        });

        // Verifikasi ketika update foto dilakukan, dot tetap memiliki elevasi z-20 dan tidak hilang
        window.updateUIAvatars('https://photos.test/api/photos/updated.webp');
        document.querySelectorAll('.user-avatar-container').forEach(container => {
            const dot = container.querySelector('.animate-pulse');
            expect(dot).not.toBeNull();
            expect(dot.classList.contains('z-20')).toBe(true);
        });
    });
});

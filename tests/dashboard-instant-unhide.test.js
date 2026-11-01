const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

describe('Optimasi P1 Dashboard Instant Unhide & Skeleton Loading', () => {
    const dashboardHtml = fs.readFileSync(path.join(projectRoot, 'dashboard.html'), 'utf8');
    const pageDashboardJs = fs.readFileSync(path.join(projectRoot, 'js', 'page-dashboard.js'), 'utf8');
    const configJs = fs.readFileSync(path.join(projectRoot, 'js', 'config.js'), 'utf8');
    const prdSimas = fs.readFileSync(path.join(projectRoot, 'PRD_SIMAS.md'), 'utf8');
    const changelogMd = fs.readFileSync(path.join(projectRoot, 'CHANGELOG.md'), 'utf8');
    const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

    test('1. dashboard.html memuat elemen main dan skeleton pulse shimmer pada 4 kartu statistik', () => {
        expect(dashboardHtml).toContain('<main class="hidden fade-in pb-10">');
        expect(dashboardHtml).toContain('id="count-students"');
        expect(dashboardHtml).toContain('id="count-permissions"');
        expect(dashboardHtml).toContain('id="count-violations"');
        expect(dashboardHtml).toContain('id="count-achievements"');

        const countPulse = (dashboardHtml.match(/animate-pulse/g) || []).length;
        expect(countPulse).toBeGreaterThanOrEqual(4);
    });

    test('2. js/page-dashboard.js melakukan instant unhide elemen main segera setelah initLayout()', () => {
        const initLayoutIndex = pageDashboardJs.indexOf('initLayout(effectiveRole);');
        expect(initLayoutIndex).not.toBe(-1);

        const unhideSnippet = `const mainContent = document.querySelector('main');
    if (mainContent) {
        mainContent.classList.remove('hidden');
    }`;
        expect(pageDashboardJs).toContain(unhideSnippet);

        const unhideIndex = pageDashboardJs.indexOf(unhideSnippet);
        expect(unhideIndex).toBeGreaterThan(initLayoutIndex);
        expect(unhideIndex).toBeLessThan(initLayoutIndex + 300);
    });

    test('3. js/page-dashboard.js memiliki safety guard blok finally pada loadDashboardData()', () => {
        expect(pageDashboardJs).toContain('finally {');
        expect(pageDashboardJs).toContain("if (mainContent && mainContent.classList.contains('hidden')) {");
    });

    test('4. js/page-dashboard.js memparalelkan pengambilan data melalui Promise.allSettled', () => {
        expect(pageDashboardJs).toContain('getDashboardActiveStudentCount()');
        expect(pageDashboardJs).toContain('Promise.allSettled([');
    });

    test('5. Sinkronisasi versi di package.json, config.js, PRD_SIMAS.md, dan CHANGELOG.md', () => {
        expect(packageJson.version).toMatch(/^\d{2}\.\d{2}\.\d{2}\.\d+$/);
        expect(configJs).toContain(`export const APP_VERSION = "${packageJson.version}";`);
        expect(prdSimas).toContain(`[${packageJson.version}]`);
        expect(changelogMd).toContain(`[${packageJson.version}]`);
    });
});

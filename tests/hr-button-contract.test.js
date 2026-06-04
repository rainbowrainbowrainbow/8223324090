const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const HR_HTML = fs.readFileSync(path.join(ROOT, 'hr.html'), 'utf8');
const HR_JS = fs.readFileSync(path.join(ROOT, 'js', 'hr-page.js'), 'utf8');

function lineNumber(source, index) {
    return source.slice(0, index).split(/\r?\n/).length;
}

function buttonTypeOffenders(filename, source) {
    return [...source.matchAll(/<button\b[^>]*>/g)]
        .filter(match => !/\btype\s*=/.test(match[0]))
        .map(match => `${filename}:${lineNumber(source, match.index)} ${match[0].slice(0, 120)}`);
}

test('HR static and rendered button tags declare an explicit type', () => {
    const offenders = [
        ...buttonTypeOffenders('hr.html', HR_HTML),
        ...buttonTypeOffenders('js/hr-page.js', HR_JS)
    ];
    assert.deepEqual(offenders, []);
    assert.equal(/createElement\(['"]button['"]\)/.test(HR_JS), false, 'new dynamic button elements must set .type = "button"');
});

test('HR grouped nav buttons expose routing and future visibility contract', () => {
    for (const token of [
        'const HR_NAV_GROUPS',
        "id: 'pulse'",
        "label: 'Пульс компанії'",
        "{ id: 'schedule', label: 'Графік', href: '/staff' }",
        "{ id: 'team', label: 'Команда', tab: 'team' }",
        "payroll: { tab: 'salary' }",
        'const HR_PAYROLL_WORKSPACE_TABS',
        'function isHrPayrollWorkspaceTab',
        'visible: () => canManageAccountSecurity()',
        'data-nav-id=',
        'data-tab=',
        'data-href=',
        'syncHrNavActive',
        'setHrNavTeamMode'
    ]) {
        assert.ok(HR_JS.includes(token), `missing ${token}`);
    }
    assert.equal(HR_JS.includes("label: 'Робітники', tab: 'team', bucket: 'workers'"), false, 'people buckets must not render as top HR nav buttons');
    assert.equal(HR_JS.includes("label: 'Стажери', tab: 'team', bucket: 'interns'"), false, 'people buckets must not render as top HR nav buttons');
});

test('HR legacy hashes remap to canonical tabs instead of blank states', () => {
    const aliases = [
        "workers: { tab: 'team', bucket: 'workers' }",
        "interns: { tab: 'team', bucket: 'interns' }",
        "blacklist: { tab: 'team', bucket: 'blacklist' }",
        "reserve: { tab: 'team', bucket: 'reserve' }",
        "payroll: { tab: 'salary' }",
        "rating: { tab: 'kpi' }",
        "ratings: { tab: 'kpi' }",
        "leaves: { tab: 'schedule' }",
        "'ai-team': { tab: 'today' }"
    ];
    for (const alias of aliases) assert.ok(HR_JS.includes(alias), `missing alias ${alias}`);
    assert.ok(HR_HTML.includes('id="tab-team"'), '#team must keep a canonical rendered panel');
    assert.ok(HR_JS.includes("target === 'accounts' && !canManageAccountSecurity()"));
    assert.ok(HR_JS.includes('!document.getElementById(`tab-${target}`)'));
    assert.ok(HR_JS.includes("return { tab: 'today', alias: requested !== 'today' };"));
});

test('HR people accordion keeps aria, bucket, count, and state contracts', () => {
    for (const token of [
        'data-people-bucket=',
        'aria-expanded=',
        'hr-people-bucket-count',
        'totalCount',
        'let activePeopleBucket = null',
        'activePeopleBucket === nextBucket ? null : nextBucket',
        'updatePeopleNavCounts(grouped)',
        'renderPeopleBucketState',
        'hr-people-empty--loading',
        'hr-people-empty--error',
        'Список порожній за поточними фільтрами',
        'window.setPeopleBucket'
    ]) {
        assert.ok(HR_JS.includes(token) || HR_HTML.includes(token), `missing ${token}`);
    }
    assert.equal(HR_JS.includes('Нікого не знайдено'), false);
});

test('HR KPI surface labels existing API sources explicitly', () => {
    for (const token of [
        'id="kpiSources"',
        'class="hr-kpi-sources"',
        'renderKpiSources',
        'monthly report',
        'onboarding',
        'ratings context',
        'даних ще немає'
    ]) {
        assert.ok(HR_JS.includes(token) || HR_HTML.includes(token), `missing ${token}`);
    }
});

test('HR dark and mobile CSS covers nav counts, people accordion, KPI, and tap targets', () => {
    assert.ok(HR_HTML.includes('body.dark-mode .hr-nav-count'));
    assert.ok(HR_HTML.includes('body.dark-mode .hr-kpi-source'));
    assert.ok(HR_HTML.includes('body.dark-mode .hr-people-empty--error'));
    assert.ok(HR_HTML.includes('@media (max-width: 768px)'));
    assert.ok(HR_HTML.includes('.hr-people-bucket-grid { grid-template-columns: 1fr; }'));
    assert.ok(HR_HTML.includes('.hr-tab { min-width: 80px; padding: 8px 10px; font-size: 12px; }'));

    const bodyRule = HR_HTML.match(/\.hr-people-bucket-body\s*\{([\s\S]*?)\}/)?.[1] || '';
    assert.equal(/overflow-[xy]\s*:/.test(bodyRule), false, 'people accordion body should not introduce nested scrolling');
});

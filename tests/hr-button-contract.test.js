const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { calculateHrClockOutPayroll } = require('../services/hrAttendance');
const {
    PAYROLL_EVENT_LABELS,
    assertPayrollPeriodOpen,
    loadPayrollPeriodLock,
    normalizePayrollDate,
    payrollMonthRange,
    payrollPeriodRange,
    recordPayrollPeriodEvent,
    requirePayrollMonth
} = require('../services/hrPayrollPeriod');
const {
    createStaffPayrollScheme,
    loadStaffPayrollSchemeWorkspace,
    payrollSchemeConfigFromRequest,
    payrollSchemeMeta
} = require('../services/hrPayrollSchemes');
const {
    archiveStaffDocument,
    createStaffDocument,
    listStaffDocuments,
    safeStaffDocumentDownloadFilename
} = require('../services/hrStaffDocuments');
const {
    issueStaffResource,
    listStaffResourceOptions,
    listStaffResources,
    returnStaffResource
} = require('../services/hrStaffResources');

const ROOT = path.join(__dirname, '..');
function readCssWithImports(file, seen = new Set()) {
    const normalized = file.replace(/\\/g, '/');
    if (seen.has(normalized)) return '';
    seen.add(normalized);

    const css = fs.readFileSync(path.join(ROOT, normalized), 'utf8');
    const dir = path.posix.dirname(normalized);
    const imports = [];
    const importPattern = /@import\s+(?:url\()?["']?([^"')]+\.css(?:\?[^"')]+)?)["']?\)?\s*;?/g;
    let match;

    while ((match = importPattern.exec(css)) !== null) {
        const rawRef = match[1].split('?')[0].replace(/^\/+/, '');
        const imported = rawRef.startsWith('css/')
            ? rawRef
            : path.posix.normalize(path.posix.join(dir, rawRef));
        imports.push(readCssWithImports(imported, seen));
    }

    return [css, ...imports].filter(Boolean).join('\n');
}

const HR_HTML = [
    fs.readFileSync(path.join(ROOT, 'hr.html'), 'utf8'),
    fs.readFileSync(path.join(ROOT, 'css', 'hr-page.css'), 'utf8')
].join('\n');
const HR_JS = fs.readFileSync(path.join(ROOT, 'js', 'hr-page.js'), 'utf8');
const HR_PULSE_SWITCHER_JS = fs.readFileSync(path.join(ROOT, 'js', 'hr-pulse-switcher.js'), 'utf8');
const HR_ROUTE = fs.readFileSync(path.join(ROOT, 'routes', 'hr.js'), 'utf8');
const HR_PAYROLL_PERIOD_SERVICE = fs.readFileSync(path.join(ROOT, 'services', 'hrPayrollPeriod.js'), 'utf8');
const HR_PAYROLL_SCHEMES_SERVICE = fs.readFileSync(path.join(ROOT, 'services', 'hrPayrollSchemes.js'), 'utf8');
const HR_ONBOARDING_SERVICE = fs.readFileSync(path.join(ROOT, 'services', 'hrOnboarding.js'), 'utf8');
const HR_STAFF_DOCUMENTS_SERVICE = fs.readFileSync(path.join(ROOT, 'services', 'hrStaffDocuments.js'), 'utf8');
const HR_STAFF_RESOURCES_SERVICE = fs.readFileSync(path.join(ROOT, 'services', 'hrStaffResources.js'), 'utf8');
const STAFF_ROUTE = fs.readFileSync(path.join(ROOT, 'routes', 'staff.js'), 'utf8');
const PAYROLL_SERVICE = fs.readFileSync(path.join(ROOT, 'services', 'payroll.js'), 'utf8');
const PAGES_CSS = readCssWithImports('css/pages.css');
const PAYROLL_EVENTS_MIGRATION = fs.readFileSync(path.join(ROOT, 'db', 'migrations', '250_payroll_period_events.sql'), 'utf8');
const ZRS_MIGRATION = fs.readFileSync(path.join(ROOT, 'db', 'migrations', '255_payroll_zrs_advances.sql'), 'utf8');

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

test('HR manual scheduled clock-out settles payroll from the planned shift', () => {
    const payroll = calculateHrClockOutPayroll({
        clock_in: '2026-06-06T14:55:00.000Z',
        status: 'present',
        planned_start: '10:00',
        planned_end: '18:00'
    }, {
        clockOut: '2026-06-06T15:00:00.000Z',
        breakMinutes: 30,
        settlementMode: 'scheduled_shift',
        kyivNow: new Date(2026, 5, 6, 18, 0)
    });

    assert.equal(payroll.actualWorkedMinutes, 0);
    assert.equal(payroll.scheduledWorkedMinutes, 450);
    assert.equal(payroll.totalWorkedMinutes, 450);
    assert.equal(payroll.settlementMode, 'scheduled_shift');
    assert.equal(payroll.status, 'present');
});

test('HR camera checkout keeps actual-time payroll through the shared clock-out helper', () => {
    const payroll = calculateHrClockOutPayroll({
        clock_in: '2026-06-06T06:00:00.000Z',
        status: 'present',
        planned_start: '09:00',
        planned_end: '18:00'
    }, {
        clockOut: '2026-06-06T13:30:00.000Z',
        breakMinutes: 30,
        settlementMode: 'actual_time',
        kyivNow: new Date(2026, 5, 6, 16, 30)
    });

    assert.equal(payroll.totalWorkedMinutes, 420);
    assert.equal(payroll.settlementMode, 'actual_time');
    assert.equal(payroll.earlyLeaveMinutes, 90);
    assert.equal(payroll.status, 'early_leave');
});

test('HR payroll period service owns range, lock, and event normalization', async () => {
    assert.equal(requirePayrollMonth('2026-02'), '2026-02');
    assert.equal(requirePayrollMonth('2026-02-01'), null);
    assert.equal(normalizePayrollDate('2026-02-28'), '2026-02-28');
    assert.equal(normalizePayrollDate('2026-02-30'), null);
    assert.deepEqual(payrollMonthRange('2024-02'), { from: '2024-02-01', to: '2024-02-29' });
    assert.deepEqual(payrollPeriodRange('2026-03'), {
        from: '2026-03-01',
        to: '2026-03-31',
        month_from: '2026-03',
        month_to: '2026-03',
        mode: 'month'
    });
    assert.deepEqual(payrollPeriodRange('2026-03', '2026-02-25', '2026-03-02'), {
        from: '2026-02-25',
        to: '2026-03-02',
        month_from: '2026-02',
        month_to: '2026-03',
        mode: 'range'
    });
    assert.throws(() => payrollPeriodRange('2026-03', '2026-03-10', '2026-03-01'), err => {
        assert.equal(err.statusCode, 400);
        return true;
    });

    const emptyLockDb = {
        async query(sql, params) {
            assert.match(sql, /FROM payroll_period_locks/);
            assert.deepEqual(params, ['2026-03']);
            return { rows: [] };
        }
    };
    assert.deepEqual(await loadPayrollPeriodLock('2026-03', emptyLockDb), {
        period_month: '2026-03',
        is_locked: false,
        locked_at: null,
        locked_by: null,
        unlocked_at: null,
        unlocked_by: null,
        note: null,
        meta_json: {}
    });

    const lockedDb = {
        async query() {
            return {
                rows: [{
                    period_month: '2026-03',
                    is_locked: true,
                    locked_at: '2026-03-31T20:00:00.000Z',
                    locked_by: 'creator',
                    note: 'closed',
                    meta_json: { source: 'test' }
                }]
            };
        }
    };
    await assert.rejects(() => assertPayrollPeriodOpen('2026-03', lockedDb), err => {
        assert.equal(err.statusCode, 423);
        assert.equal(err.payrollLock.is_locked, true);
        return true;
    });

    const eventDb = {
        async query(sql, params) {
            assert.match(sql, /INSERT INTO payroll_period_events/);
            assert.deepEqual(params, [
                '2026-03',
                'commit',
                'creator',
                'done',
                1234,
                2,
                JSON.stringify({ amount: 1234, count: 2 })
            ]);
            return {
                rows: [{
                    id: 7,
                    period_month: '2026-03',
                    event_type: 'commit',
                    actor: 'creator',
                    note: 'done',
                    amount: '1234',
                    items_count: '2',
                    meta_json: { amount: 1234, count: 2 },
                    created_at: '2026-03-31T20:00:00.000Z'
                }]
            };
        }
    };
    const event = await recordPayrollPeriodEvent('2026-03', 'commit', 'creator', 'done', { amount: 1234, count: 2 }, eventDb);
    assert.equal(event.event_label, PAYROLL_EVENT_LABELS.commit);
    assert.equal(event.amount, 1234);
    assert.equal(event.items_count, 2);
    assert.equal(await recordPayrollPeriodEvent('2026-03', 'unknown', 'creator', '', {}, eventDb), null);
});

test('HR payroll scheme service owns staff scheme config and metadata mapping', async () => {
    for (const token of [
        "require('../services/hrPayrollSchemes')",
        "router.get('/staff/:id/payroll-scheme', requireHrManage",
        "router.put('/staff/:id/payroll-scheme', requireHrManage",
        'loadStaffPayrollSchemeWorkspace(req.params.id)',
        'createStaffPayrollScheme(req.params.id, req.body, req.user)',
        "auditLog('staff_payroll_scheme_update'"
    ]) {
        assert.ok(HR_ROUTE.includes(token), `missing HR payroll scheme route token ${token}`);
    }
    for (const token of [
        'function payrollSchemeConfigFromRequest',
        'function payrollSchemeMeta',
        'async function loadPayrollSchemesForStaff',
        'async function loadStaffPayrollSchemeWorkspace',
        'async function createStaffPayrollScheme',
        'SCHEME_TYPES: PAYROLL_SCHEME_TYPES',
        'createPayrollScheme',
        'bonusRules',
        'deductions',
        'advances'
    ]) {
        assert.ok(HR_PAYROLL_SCHEMES_SERVICE.includes(token), `missing HR payroll scheme service token ${token}`);
    }
    assert.equal(HR_ROUTE.includes('function payrollSchemeConfigFromRequest'), false, 'route must not own payroll scheme config normalization');
    assert.equal(HR_ROUTE.includes('PAYROLL_SCHEME_TYPES.map'), false, 'route must not own payroll scheme type metadata');
    assert.equal(HR_ROUTE.includes('createPayrollScheme({'), false, 'route must not construct payroll scheme payloads directly');

    const queries = [];
    const fakeDb = {
        async query(sql, params = []) {
            queries.push({ sql, params });
            if (/SELECT id, name, hourly_rate, COALESCE\(rate_unit, 'hour'\) AS rate_unit FROM staff/i.test(sql)) {
                return { rows: [{ id: Number(params[0]), name: 'Dasha Staff', hourly_rate: 120, rate_unit: 'hour' }] };
            }
            if (/FROM payroll_schemes/i.test(sql)) {
                return {
                    rows: [{
                        id: 7,
                        staff_id: Number(params[0]),
                        scheme_type: 'hourly',
                        title: 'Hourly base',
                        is_active: true,
                        config_json: '{"hourlyRate":120}',
                        effective_from: '2026-06-01',
                        effective_to: null,
                        created_at: '2026-06-01T10:00:00.000Z',
                        updated_at: '2026-06-01T10:00:00.000Z'
                    }]
                };
            }
            return { rows: [] };
        }
    };

    const workspace = await loadStaffPayrollSchemeWorkspace(42, fakeDb);
    assert.equal(workspace.data.staff_id, 42);
    assert.equal(workspace.data.active_scheme.title, 'Hourly base');
    assert.equal(workspace.data.fallback_hourly_rate, 120);
    assert.equal(workspace.data.fallback_rate_unit, 'hour');
    assert.ok(workspace.data.scheme_types.some(type => type.value === 'hybrid'));
    assert.match(queries.at(-1).sql, /ORDER BY is_active DESC/);

    const hybridConfig = payrollSchemeConfigFromRequest('hybrid', {
        config: '{"base":{"kind":"per_shift","rate":90},"percentRules":[{"kind":"percent","rate":3}]}',
        base_rate: 150,
        base_quantity: 2,
        percent_rate: 5,
        percent_base: 1000,
        bonus_amount: 25,
        deduction_amount: 10,
        advance_amount: 5
    }, 120);
    assert.equal(hybridConfig.base.kind, 'per_shift');
    assert.equal(hybridConfig.base.rate, 150);
    assert.equal(hybridConfig.base.quantity, 2);
    assert.equal(hybridConfig.percentRules[0].rate, 5);
    assert.equal(hybridConfig.bonusRules[0].amount, 25);
    assert.equal(hybridConfig.deductions[0].amount, 10);
    assert.equal(hybridConfig.advances[0].amount, 5);

    const meta = payrollSchemeMeta({
        id: 8,
        staff_id: 42,
        scheme_type: 'manual',
        title: 'Manual',
        is_active: false,
        config_json: '{"manualAmount":300}',
        effective_from: '2026-06-02',
        effective_to: null,
        created_at: '2026-06-02T10:00:00.000Z',
        updated_at: '2026-06-02T10:00:00.000Z'
    });
    assert.equal(meta.staffId, 42);
    assert.equal(meta.schemeType, 'manual');
    assert.equal(meta.config.manualAmount, 300);

    const createCalls = [];
    const created = await createStaffPayrollScheme(42, {
        scheme_type: 'hybrid',
        title: 'Hybrid plan',
        base_rate: 150,
        bonus_amount: 25,
        effective_from: '2026-06-01',
        effective_to: 'not-a-date'
    }, { username: 'creator' }, {
        db: fakeDb,
        async createScheme(payload, user) {
            createCalls.push({ payload, user });
            return {
                id: 9,
                staffId: Number(payload.staffId),
                schemeType: payload.schemeType,
                title: payload.title
            };
        }
    });
    assert.equal(created.data.id, 9);
    assert.equal(created.audit.scheme_type, 'hybrid');
    assert.equal(createCalls[0].payload.config.base.rate, 150);
    assert.equal(createCalls[0].payload.config.bonusRules[0].amount, 25);
    assert.equal(createCalls[0].payload.effectiveFrom, '2026-06-01');
    assert.equal(createCalls[0].payload.effectiveTo, null);
    assert.equal(createCalls[0].user.username, 'creator');
});

test('HR grouped nav buttons expose routing and future visibility contract', () => {
    for (const token of [
        'const HR_NAV_GROUPS',
        "id: 'pulse'",
        "label: 'Пульс компанії'",
        'function hrPulseNavItems',
        'items: hrPulseNavItems()',
        'function renderHrPulseNavButton',
        "{ id: 'workers', label: 'Робітники', tab: 'team', bucket: 'workers', visible: () => canSeeHrTeamBucket('workers') }",
        "{ id: 'interns', label: 'Стажери', tab: 'team', bucket: 'interns', visible: () => canSeeHrTeamBucket('interns') }",
        "{ id: 'blacklist', label: 'Чорний список', tab: 'team', bucket: 'blacklist', visible: () => canSeeHrTeamBucket('blacklist') }",
        "{ id: 'reserve', label: 'Резерв', tab: 'team', bucket: 'reserve', visible: () => canSeeHrTeamBucket('reserve') }",
        "{ id: 'dismissed', label: 'Звільнені', tab: 'team', bucket: 'dismissed', visible: () => canSeeHrTeamBucket('dismissed') }",
        "other: { tab: 'vacancies' }",
        "href: '/training#onboarding'",
        'const HR_OTHER_WORKSPACE_TABS',
        'function isHrOtherWorkspaceTab',
        'const HR_PULSE_WORKSPACE_TABS',
        'function isHrPulseWorkspaceTab',
        'const HR_PEOPLE_WORKSPACE_TABS',
        'function isHrPeopleWorkspaceTab',
        "payroll: { tab: 'salary' }",
        "{ id: 'zrs', label: 'ЗРС' }",
        'const HR_PAYROLL_WORKSPACE_TABS',
        'function isHrPayrollWorkspaceTab',
        "nav.classList.toggle('hr-nav--pulse'",
        "nav.classList.toggle('hr-nav--people'",
        "workspaceMode && !peopleMode",
        "if (header) header.hidden = pulseMode || peopleMode",
        'visible: () => canManageAccountSecurity()',
        'data-nav-id=',
        'data-tab=',
        'data-href=',
        'syncHrNavActive',
        'setHrNavTeamMode'
    ]) {
        assert.ok(HR_JS.includes(token), `missing ${token}`);
    }
    assert.equal(HR_JS.includes("{ id: 'team', label: 'Команда', tab: 'team' }"), false, 'team workspace must use concrete people bucket tabs');
});

test('HR Pulse command cards replace legacy nav PNG switcher without weakening routing', () => {
    for (const token of [
        'function hrPulseSwitcher',
        'function hrPulseNavItems',
        'function renderHrPulseNavButton',
        'switcher.renderTab',
        "className: 'hr-tab hr-pulse-card ui-tab-card'",
        "classPrefix: 'hr-pulse-card'",
        "'data-nav-id': pulseItem.id",
        "'data-tab': pulseItem.tab || pulseItem.id",
        "'data-href': pulseItem.href || ''",
        'applyPulseCardBadges',
        'setPulseCardBadge'
    ]) {
        assert.ok(HR_JS.includes(token), `missing HR Pulse command-card token ${token}`);
    }

    for (const token of [
        'const PULSE_ITEMS',
        "id: 'today'",
        "id: 'schedule'",
        "id: 'reports'",
        "icon: 'calendar'",
        "icon: 'clock'",
        "icon: 'report'",
        "tone: 'people'",
        "tone: 'schedule'",
        "tone: 'reports'",
        "href: '/staff'",
        "hrHref: '/staff'",
        'function renderTab',
        'function renderStaffNav',
        'span class="${prefix}-icon"',
        'span class="${prefix}-content"',
        'span class="${prefix}-title"',
        'span class="${prefix}-subtitle"',
        'span class="${prefix}-badge',
        'data-pulse-badge=',
        'span class="${prefix}-line"',
        'data-pulse-tone='
    ]) {
        assert.ok(HR_PULSE_SWITCHER_JS.includes(token), `missing shared HR Pulse switcher token ${token}`);
    }

    for (const token of [
        '.hr-nav--pulse .hr-tab.hr-pulse-card',
        '.hr-nav--pulse .hr-nav-items',
        '.hr-pulse-card-icon',
        '.hr-pulse-card-title',
        '.hr-pulse-card-subtitle',
        '.hr-pulse-card-badge',
        '.hr-pulse-card-line',
        '.hr-nav--pulse .hr-tab.hr-pulse-card:focus-visible',
        '@media (prefers-reduced-motion: reduce)'
    ]) {
        assert.ok(HR_HTML.includes(token), `missing HR Pulse command-card CSS token ${token}`);
    }

    for (const token of [
        'flex-wrap: nowrap;',
        'width: auto;',
        'width: fit-content;',
        'content: none;',
        'flex: 0 0 var(--pulse-switcher-card-width);',
        'max-width: var(--pulse-switcher-card-max);',
        '@media (max-width: 1120px)',
        'overflow-x: auto;',
        'scrollbar-width: none;'
    ]) {
        assert.ok(HR_HTML.includes(token), `missing HR Pulse compact shell token ${token}`);
    }
    assert.equal(HR_HTML.includes('grid-template-columns: repeat(3, minmax(0, 1fr));'), false, 'HR Pulse must not return to full-width 3-column grid');

    for (const legacyToken of [
        'today-nav-light.png',
        'today-nav-dark.png',
        'schedule-nav-light.png',
        'schedule-nav-dark.png',
        'reports-nav-light.png',
        'reports-nav-dark.png',
        'lightImage',
        'darkImage',
        'withPulseVisual',
        'hr-pulse-card-media',
        'hr-pulse-card-img',
        'hr-pulse-card-overlay'
    ]) {
        assert.equal(HR_JS.includes(legacyToken), false, `legacy HR Pulse nav token must stay removed: ${legacyToken}`);
    }
});

test('HR legacy hashes remap to canonical tabs instead of blank states', () => {
    const aliases = [
        "workers: { tab: 'team', bucket: 'workers' }",
        "interns: { tab: 'team', bucket: 'interns' }",
        "blacklist: { tab: 'team', bucket: 'blacklist' }",
        "reserve: { tab: 'team', bucket: 'reserve' }",
        "dismissed: { tab: 'team', bucket: 'dismissed' }",
        "fired: { tab: 'team', bucket: 'dismissed' }",
        "terminated: { tab: 'team', bucket: 'dismissed' }",
        "other: { tab: 'vacancies' }",
        "payroll: { tab: 'salary' }",
        "rating: { tab: 'kpi' }",
        "ratings: { tab: 'kpi' }",
        "leaves: { tab: 'schedule' }",
        "'ai-team': { tab: 'today' }"
    ];
    for (const alias of aliases) assert.ok(HR_JS.includes(alias), `missing alias ${alias}`);
    assert.ok(HR_JS.includes("window.location.replace('/training#onboarding')"));
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
        "id: 'dismissed'",
        "title: 'Звільнені'",
        "if (staff.is_active === false) return 'dismissed';",
        "hrFetch(`/staff/${staffId}/status`",
        'Для звільнення відкрийте профіль і завершіть співпрацю через offboarding.',
        'hr-team-controls',
        'teamFilterInfo',
        'totalCount',
        'let activePeopleBucket = null',
        'activePeopleBucket = nextBucket',
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

test('HR KPI surface labels backend snapshot sources explicitly', () => {
    for (const token of [
        'id="kpiSources"',
        'class="hr-kpi-sources"',
        'class="hr-kpi-refresh"',
        'renderKpiSources',
        'HR-зріз',
        'Графік / присутність',
        'Задачі',
        'Онбординг',
        'Події / внесок',
        'Підсумковий KPI',
        'hrFetch(`/kpi?month=${month}`)',
        'даних ще немає'
    ]) {
        assert.ok(HR_JS.includes(token) || HR_HTML.includes(token), `missing ${token}`);
    }
    const loadKpiBlock = HR_JS.slice(HR_JS.indexOf('async function loadKpi'), HR_JS.indexOf('async function loadRatings'));
    assert.equal(loadKpiBlock.includes('hrFetch(`/report/monthly?month=${month}`)'), false);
    assert.equal(loadKpiBlock.includes("hrFetch('/ratings')"), false);
    assert.equal(HR_JS.includes('monthly report'), false);
    assert.equal(HR_JS.includes('ratings context'), false);
});

test('HR salary surface exposes payroll lock, reconciliation, and reversal controls', () => {
    for (const token of [
        'id="salaryPeriodStatus"',
        'id="salaryReconciliation"',
        'id="salaryPeriodEvents"',
        'id="salaryDateFrom"',
        'id="salaryDateTo"',
        'id="btnApplySalaryPeriod"',
        'id="btnResetSalaryPeriod"',
        'type="date"',
        'id="btnRefreshSalaryReconciliation"',
        'id="btnLockSalaryPeriod"',
        'id="btnUnlockSalaryPeriod"',
        'id="btnReverseSalary"',
        'function payrollMonthBounds',
        'function currentSalaryPeriod',
        'function salaryPeriodQueryString',
        'function renderSalaryPeriodControls',
        'function renderSalaryPeriodEvents',
        'function refreshSalaryReconciliation',
        'function setSalaryPeriodLock',
        'function reverseSalaryPeriod',
        'hrFetch(`/salary?${query}`)',
        'hrFetch(`/salary/reconciliation?month=${month}`)',
        "hrFetch('/salary/period-lock', 'POST'",
        "hrFetch('/salary/reverse', 'POST'",
        "period.mode === 'range'",
        'Нарахування зарплати доступне тільки для повного місяця',
        'Період закрито',
        'Журнал періоду',
        'Payroll active',
        'Finance salary'
    ]) {
        assert.ok(HR_JS.includes(token) || HR_HTML.includes(token), `missing ${token}`);
    }
});

test('HR payroll workspace exposes ZRS salary advances and deducts them from payroll', () => {
    for (const token of [
        'id="tab-zrs"',
        'id="btnAddZrs"',
        'id="zrsMonth"',
        'id="zrsSummary"',
        'async function loadZrs',
        'function renderZrs',
        'async function showZrsForm',
        'async function voidZrsAdjustment',
        'window.voidZrsAdjustment = voidZrsAdjustment',
        'hrFetch(`/salary/adjustments?month=${month}&type=advance`)',
        'hrFetch(`/salary/adjustment/${id}/void`, \'PUT\'',
        "type: 'advance'",
        'zrs-status-badge',
        'zrs-action-btn',
        'ЗРС до вирахування',
        'Зарплата після ЗРС'
    ]) {
        assert.ok(HR_JS.includes(token) || HR_HTML.includes(token), `missing ${token}`);
    }

    for (const token of [
        "FILTER (WHERE sa.type = 'advance')",
        '- COALESCE(at.advances, 0)',
        'total_advances',
        "requestedType === 'zrs' ? 'advance'",
        "router.put('/salary/adjustment/:id/void'",
        "SET status = 'voided'",
        "type: 'advance', label: 'ЗРС'",
        'advances_amount = EXCLUDED.advances_amount'
    ]) {
        assert.ok(HR_ROUTE.includes(token), `missing route token ${token}`);
    }

    for (const token of [
        "CHECK (type IN ('bonus', 'deduction', 'penalty', 'tip', 'advance'))",
        'idx_salary_adj_advance_month_staff',
        'MIGRATION_KIND: schema'
    ]) {
        assert.ok(ZRS_MIGRATION.includes(token), `missing migration token ${token}`);
    }
});

test('HR payroll keeps worked inactive staff and ignores unapplied salary adjustments', () => {
    for (const token of [
        'FROM hr_time_records tr',
        'FROM hr_shifts hs',
        'FROM payroll_reports pr',
        "WHERE COALESCE(sa.status, 'applied') = 'applied'"
    ]) {
        assert.ok(HR_ROUTE.includes(token), `missing route payroll token ${token}`);
    }

    for (const token of [
        'async function fetchStaffList(month)',
        "AND COALESCE(sa.status, 'applied') = 'applied'",
        'FROM hr_time_records tr',
        'FROM payroll_reports pr',
        'fetchStaffList(normalizedMonth)'
    ]) {
        assert.ok(PAYROLL_SERVICE.includes(token), `missing payroll service token ${token}`);
    }
});

test('HR salary backend owns payroll period lock, reconciliation, and reversal APIs', () => {
    for (const token of [
        'const PAYROLL_CONTROL_ROLES',
        "require('../services/hrPayrollPeriod')",
        "router.get('/salary/reconciliation'",
        "router.post('/salary/period-lock'",
        "router.post('/salary/reverse'",
        "router.post('/salary/commit', requirePayrollControl",
        'finance_transaction_id',
        'salary_reversal',
        'await assertPayrollPeriodOpen(month, client)',
        'await assertPayrollPeriodOpen(payrollMonth)',
        '$2::date AS date_from',
        '$3::date AS date_to',
        "sa.month >= p.month_from AND sa.month <= p.month_to",
        "pr.period_month >= p.month_from AND pr.period_month <= p.month_to",
        'period_lock: periodLock, reconciliation',
        'events'
    ]) {
        assert.ok(HR_ROUTE.includes(token), `missing route token ${token}`);
    }

    for (const token of [
        'function payrollMonthRange',
        'function normalizePayrollDate',
        'function payrollPeriodRange',
        'async function loadPayrollPeriodLock',
        'async function assertPayrollPeriodOpen',
        'async function setPayrollPeriodLock',
        'async function loadPayrollReconciliation',
        'async function recordPayrollPeriodEvent',
        'async function loadPayrollPeriodEvents',
        'const PAYROLL_EVENT_TYPES',
        'const PAYROLL_EVENT_LABELS',
        'FROM payroll_period_locks',
        'INSERT INTO payroll_period_events',
        'FROM payroll_period_events'
    ]) {
        assert.ok(HR_PAYROLL_PERIOD_SERVICE.includes(token), `missing payroll period service token ${token}`);
    }

    for (const token of [
        'CREATE TABLE IF NOT EXISTS payroll_period_events',
        "CHECK (event_type IN ('lock','unlock','commit','reverse'))",
        'idx_payroll_period_events_month_created'
    ]) {
        assert.ok(PAYROLL_EVENTS_MIGRATION.includes(token), `missing migration token ${token}`);
    }
});

test('HR onboarding assignment keeps routes thin and owns task sync in service', () => {
    for (const token of [
        "require('../services/hrOnboarding')",
        "router.get('/onboarding/responsible-candidates', requireHrManage",
        "router.get('/staff/:id/onboarding-assignment', requireHrManage",
        "router.put('/staff/:id/onboarding-assignment', requireHrManage",
        "router.post('/onboarding/start', requireHrManage",
        "router.get('/onboarding'",
        'const params = [ONBOARDING_TASK_SOURCE_TYPE]',
        'assignOnboardingResponsible(req.params.id, responsibleUserId, req.user',
        'loadActiveOnboardingProgress(staff.id)',
        'onboardingProgressMeta(progress)',
        'await attachOnboardingAssignments(result.rows)'
    ]) {
        assert.ok(HR_ROUTE.includes(token), `missing HR onboarding route token ${token}`);
    }

    for (const token of [
        "const ONBOARDING_TASK_SOURCE_TYPE = 'onboarding'",
        'async function assignOnboardingResponsible',
        'async function syncOnboardingTasks',
        'async function attachOnboardingAssignments',
        'async function withOnboardingTransaction',
        'async function insertHrAuditLog',
        "source_module = 'hr_onboarding'",
        "source_module: 'hr_onboarding'",
        'TASK_ACTION_TYPES.OWNER_REASSIGNED',
        'emitTaskAssignedToOwner(updatedTask, actor',
        'INSERT INTO onboarding_progress',
        'UPDATE onboarding_progress',
        'INSERT INTO hr_audit_log'
    ]) {
        assert.ok(HR_ONBOARDING_SERVICE.includes(token), `missing HR onboarding service token ${token}`);
    }
});

test('HR staff document service owns private upload, archive, and download metadata', async () => {
    for (const token of [
        "require('../services/hrStaffDocuments')",
        "router.get('/staff/:id/documents', requireHrManage",
        "router.post('/staff/:id/documents', requireHrManage, handleStaffDocumentUpload",
        "router.get('/staff/:id/documents/:documentId/download', requireHrManage",
        "router.delete('/staff/:id/documents/:documentId', requireHrManage",
        "auditLog('staff_document_upload'",
        "auditLog('staff_document_archive'",
        "res.setHeader('Cache-Control', 'no-store, private')",
        'safeStaffDocumentDownloadFilename(doc.original_name)'
    ]) {
        assert.ok(HR_ROUTE.includes(token), `missing HR staff document route token ${token}`);
    }

    for (const token of [
        'const STAFF_DOCUMENT_UPLOAD_LIMIT_BYTES = 10 * 1024 * 1024',
        'multer.memoryStorage()',
        'function validateStaffDocumentUploadFile',
        'function handleStaffDocumentUpload',
        'async function listStaffDocuments',
        'async function createStaffDocument',
        'async function loadStaffDocumentDownload',
        'async function archiveStaffDocument',
        "FROM staff_documents",
        "INSERT INTO staff_documents",
        "SET status = 'archived'",
        "crypto.createHash('sha256')",
        'download_url: `/api/hr/staff/${row.staff_id}/documents/${row.id}/download`'
    ]) {
        assert.ok(HR_STAFF_DOCUMENTS_SERVICE.includes(token), `missing HR staff document service token ${token}`);
    }

    const queries = [];
    const fakeDb = {
        async query(sql, params) {
            queries.push({ sql, params });
            if (/SELECT id, staff_id, document_type/i.test(sql)) {
                return {
                    rows: [{
                        id: 17,
                        staff_id: params[0],
                        document_type: 'contract',
                        title: 'Contract',
                        original_name: 'contract.pdf',
                        mime_type: 'application/pdf',
                        file_ext: '.pdf',
                        file_size: 12,
                        file_sha256: 'hash',
                        issued_at: '2026-06-08',
                        expires_at: null,
                        status: 'active',
                        notes: null,
                        uploaded_by: 'creator',
                        archived_at: null,
                        archived_by: null,
                        created_at: '2026-06-08T10:00:00.000Z',
                        updated_at: '2026-06-08T10:00:00.000Z'
                    }]
                };
            }
            if (/INSERT INTO staff_documents/i.test(sql)) {
                return {
                    rows: [{
                        id: 18,
                        staff_id: params[0],
                        document_type: params[1],
                        title: params[2],
                        original_name: params[3],
                        mime_type: params[4],
                        file_ext: params[5],
                        file_size: params[6],
                        file_sha256: params[7],
                        issued_at: params[9],
                        expires_at: params[10],
                        status: 'active',
                        notes: params[11],
                        uploaded_by: params[12],
                        archived_at: null,
                        archived_by: null,
                        created_at: '2026-06-08T10:00:00.000Z',
                        updated_at: '2026-06-08T10:00:00.000Z'
                    }]
                };
            }
            if (/UPDATE staff_documents/i.test(sql)) {
                return {
                    rows: [{
                        id: Number(params[0]),
                        staff_id: Number(params[1]),
                        document_type: 'contract',
                        title: 'Contract',
                        original_name: 'contract.pdf',
                        mime_type: 'application/pdf',
                        file_ext: '.pdf',
                        file_size: 12,
                        file_sha256: 'hash',
                        issued_at: null,
                        expires_at: null,
                        status: 'archived',
                        notes: null,
                        uploaded_by: 'creator',
                        archived_at: '2026-06-08T11:00:00.000Z',
                        archived_by: params[2],
                        created_at: '2026-06-08T10:00:00.000Z',
                        updated_at: '2026-06-08T11:00:00.000Z'
                    }]
                };
            }
            return { rows: [] };
        }
    };

    const listed = await listStaffDocuments(42, { includeArchived: false }, fakeDb);
    assert.equal(listed[0].download_url, '/api/hr/staff/42/documents/17/download');
    assert.match(queries.at(-1).sql, /status = 'active'/);

    const created = await createStaffDocument(42, {
        originalname: 'contract.pdf',
        mimetype: 'application/pdf',
        size: 12,
        buffer: Buffer.from('contract body')
    }, {
        document_type: 'contract',
        issued_at: '2026-06-08',
        expires_at: 'not-a-date',
        notes: 'Signed'
    }, 'creator', fakeDb);
    assert.equal(created.data.title, 'contract');
    assert.equal(created.data.file_ext, '.pdf');
    assert.equal(created.audit.document_type, 'contract');
    assert.equal(queries.at(-1).params[8].toString(), 'contract body');
    assert.equal(queries.at(-1).params[10], null);

    const archived = await archiveStaffDocument(42, 18, 'creator', fakeDb);
    assert.equal(archived.data.status, 'archived');
    assert.deepEqual(archived.audit, { document_id: 18, title: 'Contract' });
    assert.equal(safeStaffDocumentDownloadFilename('bad"name\n.pdf'), 'bad_name_.pdf');
});

test('HR staff documents are reachable from team card paperclip', () => {
    for (const token of [
        'data-ui-contract="hr-staff-document-paperclip"',
        'class="hr-team-document"',
        'onclick="openStaffDocuments(${Number(s.id)})"',
        'function openStaffDocuments',
        'window.openStaffDocuments = openStaffDocuments',
        "await openStaffEdit(Number(staffId), { focus: 'documents' })",
        "if (focusTarget === 'documents') focusStaffDocumentsPanel()",
        "document.getElementById('editDocumentFile')?.focus?.({ preventScroll: true })"
    ]) {
        assert.ok(HR_JS.includes(token), `missing HR document paperclip JS token ${token}`);
    }

    for (const token of [
        'id="editStaffDocumentsPanel"',
        'data-ui-contract="hr-staff-documents-panel"',
        'Документи й скани',
        'Додати скан',
        'Файл або скан'
    ]) {
        assert.ok(HR_HTML.includes(token), `missing HR document panel token ${token}`);
    }

    for (const token of [
        '.hr-team-document',
        '.hr-staff-foundation-panel.is-attention'
    ]) {
        assert.ok(`${HR_HTML}\n${PAGES_CSS}`.includes(token), `missing HR document paperclip CSS token ${token}`);
    }

    for (const token of ['editDocumentIssuedAt', 'editDocumentExpiresAt']) {
        assert.equal(HR_HTML.includes(token), false, `HR document upload form should not expose ${token}`);
    }
    const uploadStart = HR_JS.indexOf('async function uploadStaffDocument');
    const uploadEnd = HR_JS.indexOf('async function archiveStaffDocument', uploadStart);
    assert.notEqual(uploadStart, -1);
    assert.notEqual(uploadEnd, -1);
    const uploadBlock = HR_JS.slice(uploadStart, uploadEnd);
    assert.equal(uploadBlock.includes("body.append('issued_at'"), false);
    assert.equal(uploadBlock.includes("body.append('expires_at'"), false);
});

test('HR staff resource service owns warehouse and costume side effects atomically', async () => {
    for (const token of [
        "require('../services/hrStaffResources')",
        "router.get('/staff/:id/resources', requireHrManage",
        "router.get('/resource-options', requireHrManage",
        "router.post('/staff/:id/resources', requireHrManage",
        "router.put('/staff/:id/resources/:assignmentId/return', requireHrManage",
        "auditLog('staff_resource_issue'",
        "auditLog('staff_resource_return'"
    ]) {
        assert.ok(HR_ROUTE.includes(token), `missing HR staff resource route token ${token}`);
    }
    for (const token of [
        'async function issueStaffResource',
        'async function returnStaffResource',
        'async function listStaffResources',
        'async function listStaffResourceOptions',
        "await client.query('BEGIN')",
        "await client.query('COMMIT')",
        "client.query('ROLLBACK')",
        'INSERT INTO warehouse_history',
        'INSERT INTO warehouse_stock_movements',
        "VALUES ($1, 'issue', $2, NULL, $3, $4, $5, $6)",
        "VALUES ($1, 'return', NULL, $2, $3, $4, $5, $6)",
        'SET quantity = quantity - $1',
        'SET quantity = quantity + $1',
        'SET assigned_to = NULL, assigned_at = NULL',
        'function staffResourceAssignmentMeta'
    ]) {
        assert.ok(HR_STAFF_RESOURCES_SERVICE.includes(token), `missing HR staff resource service token ${token}`);
    }
    assert.equal(HR_ROUTE.includes('INSERT INTO warehouse_stock_movements'), false, 'route must not own warehouse movement writes');
    assert.equal(HR_ROUTE.includes('SET quantity = quantity - $1'), false, 'route must not own warehouse stock decrement');

    const listQueries = [];
    const listDb = {
        async query(sql, params) {
            listQueries.push({ sql, params });
            if (/FROM staff_resource_assignments sra/i.test(sql)) {
                return {
                    rows: [{
                        id: 31,
                        staff_id: Number(params[0]),
                        resource_kind: 'warehouse_stock',
                        warehouse_stock_id: 77,
                        costume_id: null,
                        warehouse_stock_name: 'Radio',
                        costume_name: null,
                        title: 'Radio',
                        quantity: 2,
                        issued_at: '2026-06-08',
                        due_return_at: null,
                        returned_at: null,
                        status: 'issued',
                        notes: null,
                        issued_by: 'creator',
                        returned_by: null,
                        warehouse_issue_movement_id: 501,
                        warehouse_return_movement_id: null,
                        created_at: '2026-06-08T10:00:00.000Z',
                        updated_at: '2026-06-08T10:00:00.000Z'
                    }]
                };
            }
            if (/FROM warehouse_stock ws/i.test(sql)) {
                return {
                    rows: [{
                        id: 77,
                        name: 'Radio',
                        category: 'Comms',
                        quantity: 5,
                        unit: 'шт',
                        owner: 'park',
                        location_id: 9,
                        location_name: 'Storage'
                    }]
                };
            }
            return { rows: [] };
        }
    };
    const listed = await listStaffResources(42, { includeReturned: false }, listDb);
    assert.equal(listed[0].warehouse_stock_name, 'Radio');
    assert.match(listQueries[0].sql, /sra.status = 'issued'/);
    const options = await listStaffResourceOptions({ kind: 'warehouse_stock', q: 'radio', businessContext: 'park' }, listDb);
    assert.equal(options.kind, 'warehouse_stock');
    assert.equal(options.data[0].label, 'Radio');
    assert.equal(listQueries.at(-1).params[0], 'park');

    const txQueries = [];
    const assignmentBase = {
        id: 31,
        staff_id: 42,
        resource_kind: 'warehouse_stock',
        warehouse_stock_id: 77,
        costume_id: null,
        title: 'Radio',
        quantity: 2,
        issued_at: '2026-06-08',
        due_return_at: '2026-06-09',
        returned_at: null,
        status: 'issued',
        notes: null,
        issued_by: 'creator',
        returned_by: null,
        warehouse_issue_movement_id: null,
        warehouse_return_movement_id: null,
        created_at: '2026-06-08T10:00:00.000Z',
        updated_at: '2026-06-08T10:00:00.000Z'
    };
    const fakePool = {
        async connect() {
            return {
                async query(sql, params = []) {
                    txQueries.push({ sql, params });
                    if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(sql)) return { rows: [] };
                    if (/FROM staff\s+WHERE id = \$1/i.test(sql)) return { rows: [{ id: params[0], name: 'Dasha Staff' }] };
                    if (/FROM warehouse_stock\s+WHERE id = \$1\s+AND is_active = true/i.test(sql)) {
                        return { rows: [{ id: 77, name: 'Radio', quantity: 5, unit: 'шт', location_id: 9, business_context: 'park' }] };
                    }
                    if (/INSERT INTO staff_resource_assignments/i.test(sql)) return { rows: [{ ...assignmentBase }] };
                    if (/UPDATE warehouse_stock\s+SET quantity = quantity - \$1/i.test(sql)) return { rows: [], rowCount: 1 };
                    if (/INSERT INTO warehouse_history/i.test(sql)) return { rows: [], rowCount: 1 };
                    if (/INSERT INTO warehouse_stock_movements/i.test(sql) && /'issue'/i.test(sql)) return { rows: [{ id: 501 }] };
                    if (/SET warehouse_issue_movement_id = \$2/i.test(sql)) {
                        return { rows: [{ ...assignmentBase, warehouse_issue_movement_id: params[1] }] };
                    }
                    if (/FROM staff_resource_assignments sra/i.test(sql)) {
                        return { rows: [{ ...assignmentBase, warehouse_stock_name: 'Radio', costume_id: 88, costume_name: 'Dragon' }] };
                    }
                    if (/SELECT id, location_id, business_context\s+FROM warehouse_stock/i.test(sql)) {
                        return { rows: [{ id: 77, location_id: 9, business_context: 'park' }] };
                    }
                    if (/UPDATE warehouse_stock\s+SET quantity = quantity \+ \$1/i.test(sql)) return { rows: [], rowCount: 1 };
                    if (/INSERT INTO warehouse_stock_movements/i.test(sql) && /'return'/i.test(sql)) return { rows: [{ id: 502 }] };
                    if (/SET status = 'returned'/i.test(sql)) {
                        return {
                            rows: [{
                                ...assignmentBase,
                                status: 'returned',
                                returned_at: params[2],
                                returned_by: params[3],
                                warehouse_return_movement_id: params[4],
                                costume_id: 88
                            }]
                        };
                    }
                    if (/UPDATE costumes\s+SET assigned_to = NULL/i.test(sql)) return { rows: [], rowCount: 1 };
                    return { rows: [] };
                },
                release() {}
            };
        }
    };

    const issued = await issueStaffResource(42, {
        resource_kind: 'warehouse_stock',
        warehouse_stock_id: 77,
        quantity: 2,
        due_return_at: '2026-06-09'
    }, {
        actor: 'creator',
        businessContext: 'park',
        today: '2026-06-08'
    }, fakePool);
    assert.equal(issued.data.warehouse_issue_movement_id, 501);
    assert.equal(issued.audit.resource_kind, 'warehouse_stock');
    assert.ok(txQueries.some(q => /^BEGIN$/i.test(q.sql)));
    assert.ok(txQueries.some(q => /^COMMIT$/i.test(q.sql)));
    assert.ok(txQueries.some(q => /INSERT INTO warehouse_history/i.test(q.sql) && q.params[1] === -2));
    assert.ok(txQueries.some(q => /INSERT INTO warehouse_stock_movements/i.test(q.sql) && /'issue'/i.test(q.sql)));

    txQueries.length = 0;
    const returned = await returnStaffResource(42, 31, { returned_at: '2026-06-10' }, {
        actor: 'creator',
        today: '2026-06-10'
    }, fakePool);
    assert.equal(returned.data.status, 'returned');
    assert.equal(returned.audit.warehouse_return_movement_id, 502);
    assert.ok(txQueries.some(q => /INSERT INTO warehouse_history/i.test(q.sql) && q.params[1] === 2));
    assert.ok(txQueries.some(q => /INSERT INTO warehouse_stock_movements/i.test(q.sql) && /'return'/i.test(q.sql)));
    assert.ok(txQueries.some(q => /UPDATE costumes\s+SET assigned_to = NULL/i.test(q.sql)));
});

test('HR offboarding readiness owns account/resource/document closure guardrails', () => {
    for (const token of [
        "router.get('/staff/:id/offboarding-readiness'",
        'async function loadStaffOffboardingReadiness',
        'staff_resource_assignments sra',
        'JOIN users u ON u.id = ep.user_id',
        'staff_documents sd',
        'staff_certifications sc',
        'session_revoked_at = NOW()',
        'UPDATE refresh_tokens',
        "eventType: 'account_deactivated'",
        'accountHasCreatorRole',
        "canUseAction(actor, 'manage_accounts')",
        'accountOffboardingBlockReason',
        'staffOffboardingDisableError',
        'accountRehireBlockReason',
        'actorCanReactivateStaffAccount',
        'account_reactivation_blocked',
        'requires_manage_accounts',
        'disable_requires_manage_accounts',
        'Не можна вимкнути власний CRM-акаунт через offboarding'
    ]) {
        assert.ok(HR_ROUTE.includes(token), `missing route token ${token}`);
    }
    for (const token of [
        'id="editOffboardingReadiness"',
        'function renderStaffOffboardingReadiness',
        "hrFetch(`/staff/${staffId}/offboarding-readiness`)",
        'allowForbiddenResponse',
        'hasOffboardingReadiness',
        'staffOffboardingReadiness.disable_available === false',
        "selectedAccountAction === 'disable' && hasOffboardingReadiness && activeAccountCount <= 0",
        'Перевірку готовності не завантажено',
        "accountAction = 'none'",
        'allowForbiddenResponse: true',
        "block_reason === 'requires_manage_accounts'",
        'needsAccountAccess',
        'account_reactivation_blocked',
        'manage_accounts',
        'Перевірка готовності завантажується'
    ]) {
        assert.ok(HR_JS.includes(token) || HR_HTML.includes(token), `missing UI token ${token}`);
    }
    for (const token of [
        '.hr-offboarding-readiness-card',
        'body.dark-mode .hr-offboarding-readiness-card',
        '.hr-offboarding-readiness-grid'
    ]) {
        assert.ok(PAGES_CSS.includes(token), `missing CSS token ${token}`);
    }
});

test('HR staff permanent delete is duplicate-only and typed-confirm guarded', () => {
    for (const token of [
        "const STAFF_DELETE_CONFIRMATION = 'ТАК'",
        'STAFF_DELETE_BLOCKER_CHECKS',
        'STAFF_DELETE_CLEANUP_CHECKS',
        'async function loadStaffDeleteReadiness',
        "router.get('/staff/:id/delete-readiness'",
        "router.delete('/staff/:id'",
        'confirmation !== STAFF_DELETE_CONFIRMATION',
        'employee_profiles',
        'bookings',
        'hr_time_records',
        'payroll_reports',
        'salary_adjustments',
        'staff_documents',
        'staff_resource_assignments',
        'training_course_enrollment',
        'UPDATE hr_audit_log SET staff_id = NULL',
        'staff_delete_permanent'
    ]) {
        assert.ok(HR_ROUTE.includes(token), `missing route token ${token}`);
    }
    for (const token of [
        'class="hr-team-delete"',
        'function deleteStaffProfile',
        "hrFetch(`/staff/${staffId}/delete-readiness`)",
        'Введіть ТАК для підтвердження',
        "method: 'DELETE'",
        "confirmation: 'ТАК'",
        'window.deleteStaffProfile = deleteStaffProfile'
    ]) {
        assert.ok(HR_JS.includes(token), `missing UI token ${token}`);
    }
    for (const token of [
        '.hr-team-delete',
        'body.dark-mode .page-container .hr-team-delete',
        '[data-theme="dark"] .page-container .hr-team-delete'
    ]) {
        assert.ok(PAGES_CSS.includes(token), `missing CSS token ${token}`);
    }
});

test('HR operational staff scope removes blacklist and unscheduled reserve from live routes', () => {
    for (const token of [
        'function activeNonBlacklistedStaffWhere',
        'function operationalStaffForDateWhere',
        'async function cleanupFutureStaffOperationalSchedule',
        "COALESCE(${alias}.hr_pool_status, 'core') <> 'blacklisted'",
        "COALESCE(${alias}.hr_pool_status, 'core') <> 'reserve'",
        "router.get('/today'",
        "router.get('/availability'",
        "router.put('/staff/:id/pool-status'",
        'schedule_cleanup: scheduleCleanup',
        'cleanupFutureStaffOperationalSchedule(client, req.params.id'
    ]) {
        assert.ok(HR_ROUTE.includes(token), `missing HR route token ${token}`);
    }
    for (const token of [
        'function activeOperationalStaffWhere',
        'function activeOperationalStaffForDateWhere',
        'async function cleanupFutureStaffOperationalSchedule',
        "router.get('/face-descriptors'",
        "LEFT JOIN hr_shifts hs ON hs.staff_id = s.id AND hs.shift_date = $1",
        "WHERE ${activeOperationalStaffForDateWhere('s', 'hs', 'tr')}",
        "router.delete('/:id'",
        'schedule_cleanup: scheduleCleanup',
        "COALESCE(${alias}.hr_pool_status, 'core') <> 'blacklisted'"
    ]) {
        assert.ok(STAFF_ROUTE.includes(token), `missing staff route token ${token}`);
    }
});

test('HR dark and mobile CSS covers nav counts, people accordion, KPI, and tap targets', () => {
    assert.ok(HR_HTML.includes('body.dark-mode .hr-nav-count'));
    assert.ok(HR_HTML.includes('body.dark-mode .hr-kpi-source'));
    assert.ok(HR_HTML.includes('body.dark-mode .hr-people-empty--error'));
    assert.ok(HR_HTML.includes('@media (max-width: 768px)'));
    assert.ok(HR_HTML.includes('.hr-people-bucket-grid { grid-template-columns: 1fr; }'));
    assert.ok(HR_HTML.includes('.hr-tab { min-width: 80px; padding: 8px 10px; font-size: 12px; }'));
    assert.ok(HR_HTML.includes('.hr-nav--pulse .hr-nav-items'));
    assert.ok(HR_HTML.includes('flex-wrap: nowrap;'));
    assert.ok(HR_HTML.includes('overflow-x: auto;'));
    assert.equal(HR_HTML.includes('grid-template-columns: repeat(3, minmax(0, 1fr));'), false);
    assert.ok(HR_HTML.includes('body.dark-mode .hr-nav--pulse .hr-tab.active'));

    const bodyRule = HR_HTML.match(/\.hr-people-bucket-body\s*\{([\s\S]*?)\}/)?.[1] || '';
    assert.equal(/overflow-[xy]\s*:/.test(bodyRule), false, 'people accordion body should not introduce nested scrolling');
});

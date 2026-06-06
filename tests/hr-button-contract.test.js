const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { calculateHrClockOutPayroll } = require('../services/hrAttendance');

const ROOT = path.join(__dirname, '..');
const HR_HTML = fs.readFileSync(path.join(ROOT, 'hr.html'), 'utf8');
const HR_JS = fs.readFileSync(path.join(ROOT, 'js', 'hr-page.js'), 'utf8');
const HR_ROUTE = fs.readFileSync(path.join(ROOT, 'routes', 'hr.js'), 'utf8');
const STAFF_ROUTE = fs.readFileSync(path.join(ROOT, 'routes', 'staff.js'), 'utf8');
const PAYROLL_SERVICE = fs.readFileSync(path.join(ROOT, 'services', 'payroll.js'), 'utf8');
const PAGES_CSS = fs.readFileSync(path.join(ROOT, 'css', 'pages.css'), 'utf8');
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

test('HR grouped nav buttons expose routing and future visibility contract', () => {
    for (const token of [
        'const HR_NAV_GROUPS',
        "id: 'pulse'",
        "label: 'Пульс компанії'",
        "{ id: 'schedule', label: 'Графік', href: '/staff' }",
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
        'id="btnRefreshSalaryReconciliation"',
        'id="btnLockSalaryPeriod"',
        'id="btnUnlockSalaryPeriod"',
        'id="btnReverseSalary"',
        'function renderSalaryPeriodControls',
        'function renderSalaryPeriodEvents',
        'function refreshSalaryReconciliation',
        'function setSalaryPeriodLock',
        'function reverseSalaryPeriod',
        'hrFetch(`/salary/reconciliation?month=${month}`)',
        "hrFetch('/salary/period-lock', 'POST'",
        "hrFetch('/salary/reverse', 'POST'",
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
        'function payrollMonthRange',
        'async function loadPayrollPeriodLock',
        'async function assertPayrollPeriodOpen',
        'async function setPayrollPeriodLock',
        'async function loadPayrollReconciliation',
        'async function recordPayrollPeriodEvent',
        'async function loadPayrollPeriodEvents',
        "router.get('/salary/reconciliation'",
        "router.post('/salary/period-lock'",
        "router.post('/salary/reverse'",
        "router.post('/salary/commit', requirePayrollControl",
        'finance_transaction_id',
        'salary_reversal',
        'await assertPayrollPeriodOpen(month, client)',
        'await assertPayrollPeriodOpen(payrollMonth)',
        'period_lock: periodLock, reconciliation',
        'events'
    ]) {
        assert.ok(HR_ROUTE.includes(token), `missing ${token}`);
    }

    for (const token of [
        'CREATE TABLE IF NOT EXISTS payroll_period_events',
        "CHECK (event_type IN ('lock','unlock','commit','reverse'))",
        'idx_payroll_period_events_month_created'
    ]) {
        assert.ok(PAYROLL_EVENTS_MIGRATION.includes(token), `missing migration token ${token}`);
    }
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
        'Не можна вимкнути власний CRM-акаунт через offboarding'
    ]) {
        assert.ok(HR_ROUTE.includes(token), `missing route token ${token}`);
    }
    for (const token of [
        'id="editOffboardingReadiness"',
        'function renderStaffOffboardingReadiness',
        "hrFetch(`/staff/${staffId}/offboarding-readiness`)",
        'staffOffboardingReadiness?.disable_available === false',
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
    assert.ok(HR_HTML.includes('grid-template-columns: repeat(3, minmax(0, 1fr));'));
    assert.ok(HR_HTML.includes('body.dark-mode .hr-nav--pulse .hr-tab.active'));

    const bodyRule = HR_HTML.match(/\.hr-people-bucket-body\s*\{([\s\S]*?)\}/)?.[1] || '';
    assert.equal(/overflow-[xy]\s*:/.test(bodyRule), false, 'people accordion body should not introduce nested scrolling');
});

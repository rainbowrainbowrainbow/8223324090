const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { calculateHrClockOutPayroll } = require('../services/hrAttendance');
const HrAttendanceState = require('../js/hr-attendance-state');
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
function readSource(...segments) {
    return fs.readFileSync(path.join(ROOT, ...segments), 'utf8').replace(/\r\n?/g, '\n');
}

function extractBalancedSource(source, openIndex, openChar = '[', closeChar = ']') {
    assert.notEqual(openIndex, -1, `missing opening ${openChar}`);
    let depth = 0;
    let quote = null;
    let escaped = false;

    for (let index = openIndex; index < source.length; index += 1) {
        const char = source[index];
        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === quote) {
                quote = null;
            }
            continue;
        }

        if (char === '\'' || char === '"' || char === '`') {
            quote = char;
            continue;
        }
        if (char === openChar) {
            depth += 1;
        } else if (char === closeChar) {
            depth -= 1;
            if (depth === 0) return source.slice(openIndex, index + 1);
        }
    }

    assert.fail(`unterminated ${openChar}${closeChar} block`);
}

function extractArrayAfter(source, needle) {
    const needleIndex = source.indexOf(needle);
    assert.notEqual(needleIndex, -1, `missing ${needle}`);
    return extractBalancedSource(source, source.indexOf('[', needleIndex));
}

function countTopLevelArrayElements(arraySource) {
    const body = arraySource.slice(1, -1).trim();
    if (!body) return 0;

    let count = 1;
    let depth = 0;
    let quote = null;
    let escaped = false;

    for (const char of body) {
        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === quote) {
                quote = null;
            }
            continue;
        }

        if (char === '\'' || char === '"' || char === '`') {
            quote = char;
            continue;
        }
        if (char === '[' || char === '(' || char === '{') {
            depth += 1;
        } else if (char === ']' || char === ')' || char === '}') {
            depth -= 1;
        } else if (char === ',' && depth === 0) {
            count += 1;
        }
    }

    return count;
}

function readCssWithImports(file, seen = new Set()) {
    const normalized = file.replace(/\\/g, '/');
    if (seen.has(normalized)) return '';
    seen.add(normalized);

    const css = readSource(normalized);
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

const HR_HTML_SOURCE = readSource('hr.html');
const HR_PAGE_CSS = readSource('css', 'hr-page.css');
const HR_HTML = [
    HR_HTML_SOURCE,
    HR_PAGE_CSS
].join('\n');
const HR_JS = fs.readFileSync(path.join(ROOT, 'js', 'hr-page.js'), 'utf8');
const HR_ATTENDANCE_STATE_JS = fs.readFileSync(path.join(ROOT, 'js', 'hr-attendance-state.js'), 'utf8');
const HR_ATTENDANCE_SERVICE = fs.readFileSync(path.join(ROOT, 'services', 'hrAttendance.js'), 'utf8');
const HR_PULSE_SWITCHER_JS = fs.readFileSync(path.join(ROOT, 'js', 'hr-pulse-switcher.js'), 'utf8');
const HR_ROUTE = fs.readFileSync(path.join(ROOT, 'routes', 'hr.js'), 'utf8');
const HR_PAYROLL_PERIOD_SERVICE = fs.readFileSync(path.join(ROOT, 'services', 'hrPayrollPeriod.js'), 'utf8');
const HR_PAYROLL_SCHEMES_SERVICE = fs.readFileSync(path.join(ROOT, 'services', 'hrPayrollSchemes.js'), 'utf8');
const HR_ONBOARDING_SERVICE = fs.readFileSync(path.join(ROOT, 'services', 'hrOnboarding.js'), 'utf8');
const HR_STAFF_DOCUMENTS_SERVICE = fs.readFileSync(path.join(ROOT, 'services', 'hrStaffDocuments.js'), 'utf8');
const HR_STAFF_RESOURCES_SERVICE = fs.readFileSync(path.join(ROOT, 'services', 'hrStaffResources.js'), 'utf8');
const STAFF_ROUTE = fs.readFileSync(path.join(ROOT, 'routes', 'staff.js'), 'utf8');
const STAFF_OPERATIONAL_FILTERS = fs.readFileSync(path.join(ROOT, 'services', 'staffOperationalFilters.js'), 'utf8');
const STAFF_LIFECYCLE_SERVICE = fs.readFileSync(path.join(ROOT, 'services', 'staffLifecycle.js'), 'utf8');
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

test('HR print modal uses page button components without leaking its open-state class', () => {
    const document = new JSDOM(HR_HTML_SOURCE).window.document;
    const expectClass = (id, className) => {
        const element = document.getElementById(id);
        assert.ok(element, `${id} exists`);
        assert.equal(element.classList.contains(className), true, `${id} uses ${className}`);
    };

    expectClass('btnHrPrintDocuments', 'hr-print-documents-trigger');
    assert.equal(document.getElementById('btnHrPrintDocuments').classList.contains('hr-print-documents-open'), false);
    expectClass('hrPrintPreviewButton', 'btn-page-primary');
    expectClass('hrPrintDownloadButton', 'btn-page-secondary');
    expectClass('hrPrintPrintButton', 'btn-page-secondary');
    expectClass('hrPrintOpenButton', 'btn-page-secondary');
    for (const id of ['hrPrintSelectAll', 'hrPrintAutomationRefresh', 'hrPrintResetPreset']) {
        expectClass(id, 'btn-page-toolbar');
    }

    const picker = document.querySelector('.hr-print-template-picker');
    assert.equal(picker.querySelectorAll('small').length, 0, 'template cards omit secondary descriptions');
    assert.ok(document.getElementById('hrPrintDetailsTitle'), 'PDF signature fields remain available');
    assert.equal(document.getElementById('hrPrintProfessionSearch').getAttribute('aria-label'), 'Пошук категорій');
    assert.match(HR_PAGE_CSS, /body\.hr-print-documents-open\s*\{\s*overflow:\s*hidden;/);
    assert.match(HR_PAGE_CSS, /\.hr-print-documents-trigger\s*\{[^}]*white-space:\s*nowrap;/);
    assert.doesNotMatch(HR_PAGE_CSS, /(?:^|,)\s*\.hr-print-documents-open\s*\{/m);

    assert.match(HR_JS, /class="btn-page-primary" data-hr-print-operation="(?:run-automation|preview-job)"/);
    assert.match(HR_JS, /class="btn-page-toolbar" data-hr-print-operation="(?:edit-automation|requeue-job)"/);
});

test('HR Today metrics expose people lists and count only open shifts as on shift', () => {
    const modelBlock = HR_JS.slice(
        HR_JS.indexOf('const TODAY_METRIC_DEFINITIONS'),
        HR_JS.indexOf('function summarizeTodayItems')
    );
    const summaryBlock = HR_JS.slice(
        HR_JS.indexOf('function summarizeTodayItems'),
        HR_JS.indexOf('const TODAY_ARRIVED_STATUSES')
    );

    assert.match(HR_HTML, /<button type="button" class="hr-today-metric-chip[^>]+aria-controls="todayMetricPeoplePanel"/);
    assert.match(HR_HTML, /id="todayMetricPeoplePanel"[^>]+hidden/);
    const sharedScriptIndex = HR_HTML.indexOf('js/hr-attendance-state.js');
    const pageScriptIndex = HR_HTML.indexOf('js/hr-page.js');
    assert.ok(sharedScriptIndex > -1 && sharedScriptIndex < pageScriptIndex, 'shared attendance state loads before HR page logic');
    assert.match(HR_ATTENDANCE_STATE_JS, /record && record\.clock_in && !record\.clock_out/);
    assert.match(HR_JS, /function isTodayItemOnShift[\s\S]*HrAttendanceState\.isAttendanceRecordOpen\(item\.record\)/);
    assert.doesNotMatch(HR_JS, /record\?\.clock_in && !item\.record\?\.clock_out/);
    assert.match(summaryBlock, /if \(isTodayItemOnShift\(item\)\)/);
    assert.doesNotMatch(summaryBlock, /early_leave[\s\S]*summary\.present\+\+/);
    assert.match(HR_JS, /function renderTodayMetricPeoplePanel/);
    assert.match(HR_JS, /function focusTodayStaffFromMetric/);
    assert.match(HR_ROUTE, /summarizeHrTodayItems\(data\)/);
    assert.doesNotMatch(HR_ROUTE, /present\+\+/);

    const context = vm.createContext({ HrAttendanceState });
    vm.runInContext(`${modelBlock}\n${summaryBlock}`, context);
    context.rows = [
        { record: { status: 'present', clock_in: '2026-07-16T06:00:00.000Z', clock_out: null } },
        { record: { status: 'early_leave', clock_in: '2026-07-16T06:00:00.000Z', clock_out: '2026-07-16T13:00:00.000Z', late_minutes: 10 } },
        { record: { status: 'auto_closed', clock_in: '2026-07-16T06:00:00.000Z', clock_out: '2026-07-16T15:00:00.000Z' } },
        { record: { status: 'sick', clock_in: null, clock_out: null } },
        { record: { status: 'vacation', clock_in: null, clock_out: null } },
        { record: null, shift: { planned_start: '09:00', planned_end: '18:00' } }
    ];
    const summary = JSON.parse(vm.runInContext('JSON.stringify(summarizeTodayItems(rows))', context));
    assert.deepEqual(summary, {
        total_staff: 6,
        present: 1,
        late: 1,
        absent: 1,
        on_vacation: 1,
        sick: 1
    });
});

test('HR Today owns one Kyiv date subscription and preserves other WebSocket consumers', () => {
    const pollingBlock = HR_JS.slice(
        HR_JS.indexOf('function startPolling'),
        HR_JS.indexOf('function initHrRealtime')
    );
    const realtimeBlock = HR_JS.slice(
        HR_JS.indexOf('function hrTodayKyivDate'),
        HR_JS.indexOf('// ==========================================\n// CONTEXT MENU')
    );
    const initBlock = HR_JS.slice(
        HR_JS.indexOf('function initHrRealtime'),
        HR_JS.indexOf('// ==========================================\n// CONTEXT MENU')
    );

    assert.match(realtimeBlock, /timeZone:\s*'Europe\/Kyiv'/);
    assert.match(realtimeBlock, /ParkWS\.subscribeDate\(nextDate\)/);
    assert.match(realtimeBlock, /ParkWS\.unsubscribeDate\(previousDate\)/);
    assert.doesNotMatch(realtimeBlock, /setSubscribedDates/);
    assert.match(pollingBlock, /syncHrRealtimeDateSubscription\(\)/);
    assert.ok(
        initBlock.indexOf('syncHrRealtimeDateSubscription();') < initBlock.indexOf('ParkWS.connect();'),
        'HR subscribes before connect so authentication can restore the date membership'
    );

    for (const selector of [
        'body.dark-mode .hr-clock-btn.clock-in',
        'html[data-theme="dark"] body .hr-clock-btn.clock-in',
        'body.dark-mode .hr-clock-btn.clock-out',
        'body.dark-mode .hr-clock-btn.clock-out.late',
        'body.dark-mode .hr-clock-btn.done',
        'body.dark-mode .hr-clock-btn:focus-visible',
        'body.dark-mode .hr-clock-btn:disabled'
    ]) {
        assert.ok(HR_HTML.includes(selector), `missing HR Today dark state selector ${selector}`);
    }
});

test('attendance mutation routes expose stable planSource from the shared service', () => {
    assert.match(HR_ATTENDANCE_SERVICE, /async function loadInitialAttendancePlanSource/);
    assert.match(HR_ATTENDANCE_SERVICE, /FROM hr_audit_log/);
    assert.match(HR_ATTENDANCE_SERVICE, /function planSourceFromAuditDetails/);
    assert.match(HR_ATTENDANCE_SERVICE, /planSource:\s*initialPlanSource/);
    assert.match(HR_ROUTE, /planSource:\s*clockInResult\.planSource/);
    assert.match(HR_ROUTE, /planSource:\s*clockOutResult\.planSource/);
    assert.match(STAFF_ROUTE, /planSource:\s*clockInResult\.planSource/);
    assert.match(STAFF_ROUTE, /planSource:\s*clockOutResult\.planSource/);
});

test('HR attendance CSV export uses shared escaping and stable column rows', () => {
    const exportRoute = HR_ROUTE.slice(
        HR_ROUTE.indexOf("router.get('/report/export'"),
        HR_ROUTE.indexOf('// ==========================================', HR_ROUTE.indexOf("router.get('/report/export'"))
    );
    const headerArray = extractArrayAfter(exportRoute, 'const header =');
    const rowArray = extractArrayAfter(exportRoute, 'return attendanceCsvRow(');

    assert.match(HR_ATTENDANCE_SERVICE, /function attendanceCsvCell/);
    assert.match(HR_ATTENDANCE_SERVICE, /function attendanceCsvRow/);
    assert.match(HR_ATTENDANCE_SERVICE, /firstMeaningfulChar/);
    assert.match(HR_ROUTE, /const header = \[/);
    assert.match(HR_ROUTE, /attendanceCsvRow\(header\)/);
    assert.match(HR_ROUTE, /attendanceCsvRow\(\[/);
    assert.match(HR_ROUTE, /attendancePlanWarningMessage\(r\.plan_source\)/);
    assert.equal(countTopLevelArrayElements(headerArray), 17);
    assert.equal(countTopLevelArrayElements(rowArray), 17);
    assert.match(exportRoute, /const facts = attendanceFactMinutes\(r\)/);
    assert.match(exportRoute, /const lateMinutes = facts\.lateMinutes/);
    assert.match(exportRoute, /const earlyLeaveMinutes = facts\.earlyLeaveMinutes/);
    assert.match(exportRoute, /const overtimeMinutes = facts\.overtimeMinutes/);
    assert.match(exportRoute, /lateMinutes > 0 \?/);
    assert.match(exportRoute, /earlyLeaveMinutes > 0 \?/);
    assert.match(exportRoute, /overtimeMinutes > 0 \?/);
    assert.doesNotMatch(exportRoute, /r\.status/);
    assert.doesNotMatch(HR_ROUTE, /return `\$\{r\.name\};/);
});

test('HR Today metric interactions keep all four counts, lists, closing paths, and row focus aligned', () => {
    const dom = new JSDOM(`
        <button type="button" data-today-metric="shift" aria-expanded="false"><strong id="todayOnShiftMetric">0</strong><small id="todayOnShiftMeta"></small></button>
        <button type="button" data-today-metric="late" aria-expanded="false"><strong id="todayLateMetric">0</strong><small id="todayLateMeta"></small></button>
        <button type="button" data-today-metric="absent" aria-expanded="false"><strong id="todayAbsentMetric">0</strong><small id="todayAbsentMeta"></small></button>
        <button type="button" data-today-metric="leave" aria-expanded="false"><strong id="todayLeaveMetric">0</strong><small id="todayLeaveMeta"></small></button>
        <section id="todayMetricPeoplePanel" hidden></section>
        <div id="todayList">
            <div data-staff-id="11" tabindex="-1"></div>
            <div data-staff-id="12" tabindex="-1"></div>
            <div data-staff-id="13" tabindex="-1"></div>
            <div data-staff-id="14" tabindex="-1"></div>
            <div data-staff-id="15" tabindex="-1"></div>
            <div data-staff-id="16" tabindex="-1"></div>
        </div>
    `);
    dom.window.matchMedia = () => ({ matches: true });
    dom.window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {
        this.dataset.scrolled = 'true';
    };

    const modelBlock = HR_JS.slice(
        HR_JS.indexOf('const TODAY_METRIC_DEFINITIONS'),
        HR_JS.indexOf('function summarizeTodayItems')
    );
    const summaryBlock = HR_JS.slice(
        HR_JS.indexOf('function summarizeTodayItems'),
        HR_JS.indexOf('const TODAY_ARRIVED_STATUSES')
    );
    const headerBlock = HR_JS.slice(
        HR_JS.indexOf('function setTodayHeaderMetricText'),
        HR_JS.indexOf('function todayMetricPersonMeta')
    );
    const interactionBlock = HR_JS.slice(
        HR_JS.indexOf('function todayMetricPersonMeta'),
        HR_JS.indexOf('function hrTodayActionIconSvg')
    );
    const context = vm.createContext({
        document: dom.window.document,
        window: dom.window,
        setTimeout: () => 1,
        clearTimeout: () => {},
        HrAttendanceState,
        escapeHtml: value => String(value ?? ''),
        fmtTimeFromISO: () => '09:00',
        fmtTime: value => String(value || '').slice(0, 5),
        ROLE_LABELS: {},
        STATUS_LABELS: { sick: 'Лікарняний', vacation: 'Відпустка' },
        staffDisplayGroupKeyForStaff: () => 'admin',
        staffDisplayGroupLabel: () => 'Адміністрація',
        renderToday: () => {}
    });
    vm.runInContext(`
        let todayActiveMetric = null;
        let todayMetricFocusTimer = null;
        let todayData = null;
        let todayFilters = { query: '', department: 'all' };
        ${modelBlock}
        ${summaryBlock}
        ${headerBlock}
        ${interactionBlock}
    `, context);
    context.items = [
        { staff_id: 11, staff_name: 'Відкрита зміна', position: 'Менеджер', record: { status: 'present', clock_in: '2026-07-16T06:00:00.000Z', clock_out: null } },
        { staff_id: 12, staff_name: 'Запізнення', position: 'Бариста', record: { status: 'late', clock_in: '2026-07-16T06:12:00.000Z', clock_out: '2026-07-16T15:00:00.000Z', late_minutes: 12 } },
        { staff_id: 13, staff_name: 'Відсутній', position: 'Аніматор', record: null, shift: { planned_start: '09:00', planned_end: '18:00' } },
        { staff_id: 14, staff_name: 'Лікарняний', position: 'Кухар', record: { status: 'sick', clock_in: null, clock_out: null } },
        { staff_id: 15, staff_name: 'Відпустка', position: 'Офіціант', record: { status: 'vacation', clock_in: null, clock_out: null } },
        { staff_id: 16, staff_name: 'Закрита зміна', position: 'Менеджер', record: { status: 'present', clock_in: '2026-07-16T06:00:00.000Z', clock_out: '2026-07-16T15:00:00.000Z' } }
    ];

    vm.runInContext('updateTodayHeaderMetrics(summarizeTodayItems(items)); bindTodayMetricChips(items)', context);
    const panel = dom.window.document.getElementById('todayMetricPeoplePanel');
    const scenarios = [
        { metric: 'shift', countId: 'todayOnShiftMetric', expectedIds: ['11'], detail: /На зміні з 09:00/ },
        { metric: 'late', countId: 'todayLateMetric', expectedIds: ['12'], detail: /Запізнення \+12 хв · зміна завершена/ },
        { metric: 'absent', countId: 'todayAbsentMetric', expectedIds: ['13'], detail: /План 09:00–18:00/ },
        { metric: 'leave', countId: 'todayLeaveMetric', expectedIds: ['14', '15'], detail: /Лікарняний|Відпустка/ }
    ];

    for (const scenario of scenarios) {
        const chip = dom.window.document.querySelector(`[data-today-metric="${scenario.metric}"]`);
        chip.click();
        const people = [...panel.querySelectorAll('[data-today-metric-staff-id]')];
        assert.equal(panel.hidden, false, `${scenario.metric}: panel opens`);
        assert.equal(chip.getAttribute('aria-expanded'), 'true', `${scenario.metric}: expanded state`);
        assert.equal(Number(dom.window.document.getElementById(scenario.countId).textContent), people.length, `${scenario.metric}: metric count matches list`);
        assert.deepEqual(people.map(button => button.dataset.todayMetricStaffId), scenario.expectedIds, `${scenario.metric}: matching people`);
        assert.match(panel.textContent, scenario.detail, `${scenario.metric}: useful context`);

        chip.click();
        assert.equal(panel.hidden, true, `${scenario.metric}: repeated click closes`);
        assert.equal(chip.getAttribute('aria-expanded'), 'false', `${scenario.metric}: collapsed state`);
    }

    const leaveChip = dom.window.document.querySelector('[data-today-metric="leave"]');
    leaveChip.click();
    panel.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(panel.hidden, true, 'Escape closes the people list');
    assert.equal(dom.window.document.activeElement, leaveChip, 'Escape restores focus to the active metric');

    const absentChip = dom.window.document.querySelector('[data-today-metric="absent"]');
    absentChip.click();
    absentChip.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(panel.hidden, true, 'Escape closes when focus remains on the keyboard opener');
    assert.equal(dom.window.document.activeElement, absentChip, 'opener Escape keeps focus on the active metric');

    const lateChip = dom.window.document.querySelector('[data-today-metric="late"]');
    lateChip.click();
    panel.querySelector('.hr-today-metric-panel-close').click();
    assert.equal(panel.hidden, true, 'close control hides the people list');
    assert.equal(dom.window.document.activeElement, lateChip, 'close control restores metric focus');

    const shiftChip = dom.window.document.querySelector('[data-today-metric="shift"]');
    shiftChip.click();
    panel.querySelector('[data-today-metric-staff-id="11"]').click();
    const row = dom.window.document.querySelector('[data-staff-id="11"]');
    assert.equal(panel.hidden, true);
    assert.equal(dom.window.document.activeElement, row);
    assert.equal(row.dataset.scrolled, 'true');
    assert.equal(row.classList.contains('hr-staff-row--metric-focus'), true);
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
    assert.equal(payroll.lateMinutes, 475);
    assert.equal(payroll.status, 'late');
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
        'const HR_PEOPLE_NAV_DETAILS',
        "icon: 'users'",
        "icon: 'graduation'",
        "icon: 'shield'",
        "icon: 'reserve'",
        "icon: 'archive'",
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
        "tab.matches(':disabled, [aria-disabled=\"true\"], [aria-busy=\"true\"]')",
        ".hr-nav--pulse .hr-tab[aria-current]",
        "removeAttribute('aria-current')",
        "setAttribute('aria-current', 'page')"
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
        'function renderTab',
        'function renderStaffNav',
        'span class="${prefix}-icon"',
        'span class="${prefix}-content"',
        'span class="${prefix}-title"',
        'span class="${prefix}-subtitle"',
        'span class="${prefix}-line"',
        'data-pulse-tone='
    ]) {
        assert.ok(HR_PULSE_SWITCHER_JS.includes(token), `missing shared HR Pulse switcher token ${token}`);
    }
    assert.equal(HR_PULSE_SWITCHER_JS.includes("hrHref: '/staff'"), false, 'HR schedule pulse card must stay an internal HR tab');

    for (const token of [
        '.hr-nav--pulse .hr-tab.hr-pulse-card',
        '.hr-nav--pulse .hr-nav-items',
        '.hr-pulse-card-icon',
        '.hr-pulse-card-title',
        '.hr-pulse-card-subtitle',
        '.hr-pulse-card-line',
        '.hr-nav--pulse .hr-tab.hr-pulse-card:focus-visible',
        '.hr-nav--pulse .hr-tab.hr-pulse-card:disabled',
        '.hr-nav--pulse .hr-tab.hr-pulse-card[aria-disabled="true"]',
        '.hr-nav--pulse .hr-tab.hr-pulse-card[aria-busy="true"]',
        '@media (prefers-reduced-motion: reduce)'
    ]) {
        assert.ok(HR_HTML.includes(token), `missing HR Pulse command-card CSS token ${token}`);
    }
    for (const token of [
        'applyPulseCardBadges',
        'setPulseCardBadge',
        'data-pulse-badge=',
        'span class="${prefix}-badge',
        '.hr-pulse-card-badge',
        '.staff-pulse-tab-badge'
    ]) {
        assert.equal(HR_JS.includes(token) || HR_PULSE_SWITCHER_JS.includes(token) || HR_HTML.includes(token), false, `legacy Pulse badge token must stay removed: ${token}`);
    }

    for (const token of [
        'flex-wrap: nowrap;',
        'width: 100%;',
        'grid-template-columns: repeat(3, minmax(0, 1fr));',
        'content: none;',
        'max-width: none;',
        'flex: 0 0 var(--pulse-switcher-card-width);',
        'max-width: var(--pulse-switcher-card-max);',
        '@media (max-width: 1120px)',
        'overflow-x: auto;',
        'scrollbar-width: none;'
    ]) {
        assert.ok(HR_HTML.includes(token), `missing HR Pulse full-width shell token ${token}`);
    }
    assert.ok(HR_HTML.includes('grid-template-columns: repeat(3, minmax(0, 1fr));'), 'HR Pulse should use full-width 3-column desktop grid');

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

test('HR people bucket navigation uses one rendered result surface and category-local search contracts', () => {
    for (const token of [
        'hr-people-results',
        'hr-people-results-grid',
        'hr-team-bucket-badge',
        'aria-pressed',
        "id: 'dismissed'",
        "title: 'Звільнені'",
        "if (staff.is_active === false) return 'dismissed';",
        "hrFetch(`/staff/${staffId}/status`",
        'Для звільнення відкрийте профіль і завершіть співпрацю через вкладку завершення співпраці.',
        'hr-team-controls',
        'teamFilterInfo',
        'totalCount',
        'let activePeopleBucket = null',
        'activePeopleBucket = requestedBucket',
        'activePeopleBucket = nextBucket',
        'function visiblePeopleBuckets',
        'function normalizeVisiblePeopleBucket',
        'function canSeeHrTeamBucket',
        'function clearTeamSearchOnBucketChange',
        'const activeStaff = teamStaff.filter(item => bucketForStaff(item) === activePeopleBucket);',
        'activeStaff.filter(item => teamSearchHaystack(item).includes(query))',
        'updatePeopleNavCounts(grouped)',
        'renderPeopleBucketState',
        'renderTeamBucket',
        'renderTeamSearchResults',
        'renderTeamCardStatusChips',
        'renderTeamTrainingCompact',
        'renderTeamOnboardingCompact',
        'hr-team-open',
        'hr-team-overflow-trigger',
        'hr-team-overflow-menu',
        'closeTeamCardMenus',
        'hr-people-empty--loading',
        'hr-people-empty--error',
        'Нічого не знайдено в цій категорії',
        'window.setPeopleBucket'
    ]) {
        assert.ok(HR_JS.includes(token) || HR_HTML.includes(token), `missing ${token}`);
    }
    for (const removedToken of [
        'teamArchiveSearch',
        'teamMissingBanner',
        'HR_TEAM_SETUP_FILTERS',
        'window.setTeamSetupFilter'
    ]) {
        assert.equal(HR_JS.includes(removedToken) || HR_HTML.includes(removedToken), false, `removed HR Team token returned: ${removedToken}`);
    }
    assert.equal(HR_HTML.includes('teamRoleFilter'), false);
    assert.equal(HR_HTML.includes('Показувати звільнених'), false);
});

test('HR scheduled clock-out excludes gaps between normalized shift segments', () => {
    const payroll = calculateHrClockOutPayroll({
        clock_in: '2026-06-06T06:00:00.000Z',
        status: 'present',
        planned_start: '09:00',
        planned_end: '20:00'
    }, {
        clockOut: '2026-06-06T17:00:00.000Z',
        breakMinutes: 0,
        scheduledWorkedMinutes: 540,
        settlementMode: 'scheduled_shift',
        kyivNow: new Date(2026, 5, 6, 20, 0)
    });

    assert.equal(payroll.scheduledWorkedMinutes, 540);
    assert.equal(payroll.totalWorkedMinutes, 540);
    assert.equal(payroll.settlementMode, 'scheduled_shift');
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
        'Активна зарплата',
        'Finance salary'
    ]) {
        assert.ok(HR_JS.includes(token) || HR_HTML.includes(token), `missing ${token}`);
    }
});

test('HR Salary and KPI expose independent local search and department filters', () => {
    for (const token of [
        'id="salarySearch"',
        'id="salaryFilterInfo"',
        'id="salaryFilterReset"',
        'id="salaryDepartmentFilters"',
        'id="kpiSearch"',
        'id="kpiFilterInfo"',
        'id="kpiFilterReset"',
        'id="kpiDepartmentFilters"',
        'aria-live="polite"',
        'class="hr-payroll-dept-filter"',
        'class="hr-payroll-filter-reset"',
        '.hr-payroll-dept-chip.is-active',
        '#tab-kpi .hr-payroll-dept-chip:focus-visible {\n    outline: 3px',
        '.hr-payroll-empty-state',
        '[data-theme="dark"] #tab-salary .hr-payroll-filters',
        '@media (max-width: 480px)'
    ]) {
        assert.ok(HR_HTML.includes(token), `missing Payroll filter surface token ${token}`);
    }

    const stateBlock = HR_JS.slice(
        HR_JS.indexOf('const payrollViewState ='),
        HR_JS.indexOf('let staffDisplayGroupsContract')
    );
    assert.match(stateBlock, /salary:\s*\{\s*allRows:\s*\[\],\s*query:\s*'',\s*department:\s*'all',\s*expandedGroups:\s*new Set\(\)/);
    assert.match(stateBlock, /kpi:\s*\{\s*allRows:\s*\[\],\s*query:\s*'',\s*department:\s*'all',\s*expandedGroups:\s*new Set\(\)/);

    for (const token of [
        'function payrollRowSearchHaystack',
        'normalizeSearchText(parts.filter(Boolean).join',
        'payrollProfessionSearchParts(row)',
        'profession_rate_summary',
        'departmentLabel(department)',
        'function payrollFilteredRows',
        'data-payroll-department=',
        'aria-pressed=',
        'Знайдено ${currentRows.length} із ${state.allRows.length}',
        "bindPayrollFilterControls('salary')",
        "bindPayrollFilterControls('kpi')",
        'nextChip?.focus()',
        "renderPayrollVisibleRows('salary')",
        "renderPayrollVisibleRows('kpi')",
        'За поточними фільтрами працівників не знайдено'
    ]) {
        assert.ok(HR_JS.includes(token), `missing Payroll filter behavior token ${token}`);
    }

    const loadSalaryBlock = HR_JS.slice(HR_JS.indexOf('async function loadSalary'), HR_JS.indexOf('function renderSalaryRateSummary'));
    const loadKpiBlock = HR_JS.slice(HR_JS.indexOf('async function loadKpi'), HR_JS.indexOf('async function loadRatings'));
    assert.ok(loadSalaryBlock.includes('hrFetch(`/salary?${query}`)'));
    assert.ok(loadSalaryBlock.includes('ensureProfessionsLoaded({ silent: true })'));
    assert.equal(loadSalaryBlock.includes('/staff?active=true'), false);
    assert.ok(loadKpiBlock.includes('hrFetch(`/kpi?month=${month}`)'));
    assert.equal(loadKpiBlock.includes('/staff?active=true'), false);

    const renderSalaryBlock = HR_JS.slice(HR_JS.indexOf('function renderSalary(data)'), HR_JS.indexOf('function formatZrsDate'));
    const renderKpiBlock = HR_JS.slice(HR_JS.indexOf('function renderKpi({'), HR_JS.indexOf('// TAB 9: ONBOARDING'));
    assert.ok(renderSalaryBlock.includes('const totals = data.totals || {}'));
    assert.ok(renderSalaryBlock.includes('payrollViewState.salary.allRows = Array.isArray(data.data)'));
    assert.ok(renderSalaryBlock.includes("renderPayrollVisibleRows('salary')"));
    assert.ok(renderKpiBlock.includes('renderKpiSources({ rows: allRows, sources })'));
    assert.ok(renderKpiBlock.includes('const totals = allRows.reduce'));
    assert.ok(renderKpiBlock.includes('totals.kpiScoreSum / allRows.length'));
    assert.ok(renderKpiBlock.includes("renderPayrollVisibleRows('kpi')"));
});

test('HR Salary and KPI render persistent accessible department groups', () => {
    for (const token of [
        "storageKey: 'pzp_hr_payroll_salary_expanded_groups'",
        "storageKey: 'pzp_hr_payroll_kpi_expanded_groups'",
        "hydratePayrollExpandedGroups('salary')",
        "hydratePayrollExpandedGroups('kpi')",
        'function payrollGroupedRows',
        'function payrollExpandedGroupKeysFromStorage',
        'function persistPayrollExpandedGroups',
        'function payrollSearchAutoExpandsGroups',
        'return payrollSearchAutoExpandsGroups(view) || isPayrollGroupExpanded(view, groupKey)',
        'function renderPayrollGroupedList',
        'type="button" class="hr-payroll-group-toggle"',
        'data-payroll-group-toggle=',
        'aria-expanded=',
        'hr-payroll-group-caret',
        'hr-payroll-group-label',
        'hr-payroll-group-count',
        'nextButton?.focus()',
        "renderPayrollGroupedList('salary'",
        "renderPayrollGroupedList('kpi'"
    ]) {
        assert.ok(HR_JS.includes(token), `missing Payroll group behavior token ${token}`);
    }
    for (const token of [
        '#tab-salary .hr-payroll-group-header',
        '#tab-kpi .hr-payroll-group-toggle:focus-visible',
        '.hr-payroll-group-header.is-expanded .hr-payroll-group-caret',
        '[data-theme="dark"] #tab-kpi .hr-payroll-group-header',
        '#tab-kpi .hr-payroll-group-toggle {\n        min-height: 44px;'
    ]) {
        assert.ok(HR_HTML.includes(token), `missing Payroll group CSS token ${token}`);
    }

    const groupHeaderBlock = HR_JS.slice(HR_JS.indexOf('function renderPayrollGroupHeader'), HR_JS.indexOf('function bindPayrollGroupToggles'));
    assert.ok(groupHeaderBlock.includes('<button type="button"'), 'group toggle must stay a native button for mouse, Enter, and Space');
    assert.ok(groupHeaderBlock.includes('aria-expanded='));
    assert.ok(groupHeaderBlock.includes('group.rows.length'));
});

test('HR Salary and KPI use compact accessible master-detail lists', () => {
    for (const token of [
        'id="salaryList" class="hr-payroll-list"',
        'id="kpiList" class="hr-payroll-list"',
        'function bindPayrollDetailToggles',
        'data-payroll-detail-toggle',
        'data-payroll-detail-label',
        'aria-controls=',
        'class="hr-payroll-details" hidden',
        'function renderSalaryEmployeeItem',
        'function renderKpiEmployeeItem'
    ]) {
        assert.ok(`${HR_HTML}\n${HR_JS}`.includes(token), `missing compact Payroll token ${token}`);
    }
    for (const obsoleteId of ['salaryHead', 'salaryBody', 'kpiHead', 'kpiBody']) {
        assert.ok(!HR_HTML.includes(`id="${obsoleteId}"`), `${obsoleteId} table mount must be removed`);
        assert.ok(!HR_JS.includes(`getElementById('${obsoleteId}')`), `${obsoleteId} must not be used by the renderer`);
    }

    const salaryBlock = HR_JS.slice(HR_JS.indexOf('function renderSalaryEmployeeItem'), HR_JS.indexOf('function renderSalaryRows'));
    const salaryContext = vm.createContext({
        ROLE_LABELS: { animator: 'Аніматор' },
        departmentLabel: value => value === 'animators' ? 'Аніматори' : 'Без відділу',
        escapeHtml: value => String(value ?? ''),
        fmtMoney: value => `${Number(value)} ₴`,
        renderSalaryRateSummary: row => `MULTI_RATE:${row.profession_rate_summary.map(item => `${item.profession_key}/${item.rate_unit}/${item.amount}/${item.kind}/${item.allocation_source}`).join('|')}`
    });
    vm.runInContext(salaryBlock, salaryContext);
    const salaryHtml = vm.runInContext(`renderSalaryEmployeeItem({
        staff_name: 'Працівник без attendance', role_type: 'animator', department: 'animators',
        days_worked: 0, hours_worked: 0, base_salary: 0, total_salary: 0,
        overtime_pay: 0, bonuses: 0, tips: 0, deductions: 0, penalties: 0, advances: 0,
        profession_rate_summary: [
            { profession_key: 'host', rate_unit: 'hour', amount: 1200, kind: 'base', allocation_source: 'schedule' },
            { profession_key: 'actor', rate_unit: 'day', amount: 800, kind: 'overtime', allocation_source: 'manual' }
        ]
    }, 0, 0)`, salaryContext);
    assert.ok(salaryHtml.includes('Працівник без attendance'));
    assert.ok(salaryHtml.includes('0 дн · 0 год'));
    assert.ok(salaryHtml.includes('MULTI_RATE:host/hour/1200/base/schedule|actor/day/800/overtime/manual'));
    for (const label of ['Переробки', 'Бонуси та чайові', 'Утримання та штрафи', 'ЗРС']) {
        assert.ok(salaryHtml.includes(label), `salary details must include ${label}`);
    }

    const kpiBlock = HR_JS.slice(HR_JS.indexOf('function renderKpiEmployeeItem'), HR_JS.indexOf('function renderKpiRows'));
    const kpiContext = vm.createContext({
        ROLE_LABELS: { manager: 'Менеджер' },
        departmentLabel: () => 'Адміністрація',
        escapeHtml: value => String(value ?? ''),
        num: value => Number(value || 0),
        kpiSignal: value => `<span>${value}</span>`,
        toneForPercent: () => 'good'
    });
    vm.runInContext(kpiBlock, kpiContext);
    const kpiHtml = vm.runInContext("renderKpiEmployeeItem({ staff_name: 'KPI Zero', role_type: 'manager', days_scheduled: 0, kpi_score: 0 }, 0, 0)", kpiContext);
    assert.ok(kpiHtml.includes('даних ще немає'));
    for (const label of ['Загальний бал', 'Присутність', 'Надійність', 'Задачі', 'Внесок', 'Розвиток']) {
        assert.ok(kpiHtml.includes(label), `KPI master-detail must include ${label}`);
    }

    for (const token of [
        '@media (max-width: 1200px)',
        '@media (max-width: 768px)',
        '@media (max-width: 480px)',
        '#tab-salary .hr-payroll-salary-summary',
        '#tab-kpi .hr-payroll-kpi-summary',
        '#tab-salary .hr-payroll-list',
        '#tab-salary .hr-payroll-group-content[hidden]',
        'min-height: 44px;'
    ]) {
        assert.ok(HR_HTML.includes(token), `missing responsive Payroll token ${token}`);
    }
});

test('HR Payroll local filter and group helpers preserve independent view state', () => {
    const sourceSlices = [
        HR_JS.slice(HR_JS.indexOf('function normalizeProfessionKey'), HR_JS.indexOf('function normalizeProfessionList')),
        HR_JS.slice(HR_JS.indexOf('function professionTitle'), HR_JS.indexOf('function staffSecondaryProfessions')),
        HR_JS.slice(HR_JS.indexOf('function normalizeSearchText'), HR_JS.indexOf('function normalizeDepartmentKey')),
        HR_JS.slice(HR_JS.indexOf('function normalizeDepartmentKey'), HR_JS.indexOf('function normalizeStaffDisplayGroupKey')),
        HR_JS.slice(HR_JS.indexOf('function departmentLabel'), HR_JS.indexOf('function companyStructureSelectOptions')),
        HR_JS.slice(HR_JS.indexOf('function payrollProfessionSearchParts'), HR_JS.indexOf('function renderPayrollFilterControls'))
    ];
    const storage = new Map();
    const localStorage = {
        getItem: key => storage.has(key) ? storage.get(key) : null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: key => storage.delete(key)
    };
    const context = vm.createContext({
        ROLE_LABELS: { animator: 'Аніматор', manager: 'Менеджер' },
        STAFF_DEPARTMENT_LABELS: { animators: 'Аніматори', admin: 'Адміністрація' },
        PAYROLL_DEPARTMENT_ORDER: ['animators', 'admin'],
        PAYROLL_VIEW_CONFIG: {
            salary: { storageKey: 'pzp_hr_payroll_salary_expanded_groups' },
            kpi: { storageKey: 'pzp_hr_payroll_kpi_expanded_groups' }
        },
        localStorage,
        hrProfessions: [{ key: 'party_host', title: 'Ведуча свят' }],
        payrollViewState: {
            salary: { allRows: [], query: '', department: 'all', expandedGroups: new Set() },
            kpi: { allRows: [], query: '', department: 'all', expandedGroups: new Set() }
        }
    });
    vm.runInContext(sourceSlices.join('\n'), context);

    const salaryRows = [
        {
            staff_name: 'Атаманенко Анна Михайлівна',
            role_type: 'animator',
            department: 'animators',
            profession_rate_summary: [{ profession_key: 'party_host' }]
        },
        {
            staff_name: 'Бойко Олена',
            role_type: 'manager',
            department: 'admin',
            profession_rate_summary: []
        }
    ];
    context.payrollViewState.salary.allRows = salaryRows;
    context.payrollViewState.kpi.allRows = salaryRows;

    context.payrollViewState.salary.query = 'АННА';
    assert.deepEqual(context.payrollFilteredRows('salary').map(row => row.staff_name), ['Атаманенко Анна Михайлівна']);
    context.payrollViewState.salary.query = 'аніматор';
    assert.deepEqual(context.payrollFilteredRows('salary').map(row => row.staff_name), ['Атаманенко Анна Михайлівна']);
    context.payrollViewState.salary.query = 'ведуча свят';
    assert.deepEqual(context.payrollFilteredRows('salary').map(row => row.staff_name), ['Атаманенко Анна Михайлівна']);

    context.payrollViewState.salary.query = 'менеджер';
    context.payrollViewState.salary.department = 'admin';
    assert.deepEqual(context.payrollFilteredRows('salary').map(row => row.staff_name), ['Бойко Олена']);
    context.payrollViewState.salary.allRows = [{
        staff_name: 'Коваль Марія',
        role_type: 'manager',
        department: 'admin',
        profession_rate_summary: []
    }];
    assert.equal(context.payrollViewState.salary.query, 'менеджер');
    assert.equal(context.payrollViewState.salary.department, 'admin');
    assert.deepEqual(context.payrollFilteredRows('salary').map(row => row.staff_name), ['Коваль Марія']);
    context.payrollViewState.salary.allRows = [salaryRows[0]];
    assert.equal(context.payrollViewState.salary.department, 'admin', 'an empty department must stay selected after period changes');
    assert.equal(context.payrollFilteredRows('salary').length, 0);
    const emptyDepartmentOption = context.payrollDepartmentOptions('salary').find(option => option.value === 'admin');
    assert.equal(emptyDepartmentOption?.value, 'admin');
    assert.equal(emptyDepartmentOption?.label, 'Адміністрація');
    assert.equal(emptyDepartmentOption?.count, 0);
    context.payrollViewState.salary.department = 'none';
    const emptyNoDepartmentOption = context.payrollDepartmentOptions('salary').find(option => option.value === 'none');
    assert.equal(emptyNoDepartmentOption?.label, 'Без відділу');
    context.payrollViewState.salary.department = 'admin';

    context.payrollViewState.kpi.query = 'ведуча свят';
    assert.equal(context.payrollFilteredRows('kpi').length, 0, 'KPI must not search Salary profession summaries');
    assert.equal(context.payrollViewState.salary.query, 'менеджер', 'KPI query must not overwrite Salary query');
    assert.equal(context.payrollViewState.salary.department, 'admin', 'KPI department must not overwrite Salary department');

    const groupedRows = context.payrollGroupedRows([
        salaryRows[0],
        salaryRows[1],
        { staff_name: 'Без відділу', role_type: 'manager', department: null, profession_rate_summary: [] }
    ]);
    assert.deepEqual(Array.from(groupedRows, group => group.key), ['animators', 'admin', 'none']);
    assert.equal(groupedRows[2]?.label, 'Без відділу');
    assert.equal(groupedRows.reduce((total, group) => total + group.rows.length, 0), 3);

    localStorage.setItem('pzp_hr_payroll_salary_expanded_groups', JSON.stringify(['animators', 'animators', 'all']));
    localStorage.setItem('pzp_hr_payroll_kpi_expanded_groups', JSON.stringify(['admin']));
    context.hydratePayrollExpandedGroups('salary');
    context.hydratePayrollExpandedGroups('kpi');
    assert.deepEqual(Array.from(context.payrollViewState.salary.expandedGroups), ['animators']);
    assert.deepEqual(Array.from(context.payrollViewState.kpi.expandedGroups), ['admin']);

    const persistedSalaryState = localStorage.getItem('pzp_hr_payroll_salary_expanded_groups');
    context.payrollViewState.salary.query = 'анна';
    assert.equal(context.isPayrollGroupExpandedForRender('salary', 'admin'), true, 'search must temporarily open matching groups');
    assert.equal(context.isPayrollGroupExpanded('salary', 'admin'), false, 'search auto-expand must not mutate saved state');
    assert.equal(localStorage.getItem('pzp_hr_payroll_salary_expanded_groups'), persistedSalaryState);

    context.payrollViewState.salary.query = '';
    context.setPayrollGroupExpanded('salary', 'admin', true);
    assert.deepEqual(JSON.parse(localStorage.getItem('pzp_hr_payroll_salary_expanded_groups')), ['admin', 'animators']);
    assert.deepEqual(JSON.parse(localStorage.getItem('pzp_hr_payroll_kpi_expanded_groups')), ['admin']);
    context.setPayrollGroupExpanded('salary', 'admin', false);
    assert.deepEqual(JSON.parse(localStorage.getItem('pzp_hr_payroll_salary_expanded_groups')), ['animators']);

    localStorage.setItem('pzp_hr_payroll_salary_expanded_groups', '{broken');
    context.hydratePayrollExpandedGroups('salary');
    assert.equal(context.payrollViewState.salary.expandedGroups.size, 0, 'invalid storage must fail closed');
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
        "router.get('/staff/:id/onboarding-processes', requireHrManage",
        "router.put('/staff/:id/onboarding-assignment', requireHrManage",
        "router.post('/onboarding/start', requireHrManage",
        "router.get('/onboarding'",
        'const params = [ONBOARDING_TASK_SOURCE_TYPE]',
        'assignOnboardingResponsible(req.params.id, responsibleUserId, req.user',
        'loadActiveOnboardingProgress(staff.id, pool, { professionKey })',
        'const onboarding = await syncProfessionOnboardingProgress(',
        'result.context.staff.id,',
        'result.context.profession.key,',
        'onboardingProgressMeta(progress)',
        'await attachOnboardingAssignments(result.rows)'
    ]) {
        assert.ok(HR_ROUTE.includes(token), `missing HR onboarding route token ${token}`);
    }

    for (const token of [
        "const ONBOARDING_TASK_SOURCE_TYPE = 'onboarding'",
        'async function assignOnboardingResponsible',
        'async function syncOnboardingTasks',
        'async function syncProfessionOnboardingProgress',
        'async function loadOnboardingProcessesForStaff',
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

test('HR staff documents are reachable from the compact team card overflow menu', () => {
    for (const token of [
        'data-ui-contract="hr-staff-document-paperclip"',
        'hr-team-document',
        'hr-team-overflow-menu',
        'onclick="openStaffDocuments(${id})"',
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
        'syncLinkedStaffAccountDeactivation',
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
        'session_revoked_at = NOW()',
        'UPDATE refresh_tokens',
        "eventType: 'account_deactivated'",
        'UPDATE employee_profiles'
    ]) {
        assert.ok(STAFF_LIFECYCLE_SERVICE.includes(token), `missing lifecycle service token ${token}`);
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
        'hr-team-delete',
        'hr-team-menu-section--danger',
        'тільки для дубля',
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

test('HR operational staff scope uses shared scheduleable filters for live routes', () => {
    for (const token of [
        "require('../services/staffOperationalFilters')",
        "require('../services/staffLifecycle')",
        'function activeNonBlacklistedStaffWhere',
        'function operationalStaffForDateWhere',
        'return scheduleableStaffWhere(alias, { dateExpression });',
        "scheduleableStaffWhere('staff', {",
        "scheduleableStaffWhere('s', { dateExpression: 'hs.shift_date' })",
        "scheduleableStaffWhere('staff', { dateExpression: '$1' })",
        "router.get('/today'",
        "router.get('/availability'",
        "router.put('/staff/:id/pool-status'",
        'schedule_cleanup: scheduleCleanup',
        'cleanupFutureStaffOperationalSchedule(client, req.params.id'
    ]) {
        assert.ok(HR_ROUTE.includes(token), `missing HR route token ${token}`);
    }
    for (const token of [
        "require('../services/staffOperationalFilters')",
        "require('../services/staffLifecycle')",
        'function activeOperationalStaffWhere',
        'function activeOperationalStaffForDateWhere',
        'function activeScheduleStaffWhere',
        "router.get('/face-descriptors'",
        "LEFT JOIN hr_shifts hs ON hs.staff_id = s.id AND hs.shift_date = $1",
        "WHERE ${activeOperationalStaffForDateWhere('s', 'hs', 'tr')}",
        "router.delete('/:id'",
        'schedule_cleanup: scheduleCleanup',
        "activeScheduleStaffWhere('s', 'ss.date')"
    ]) {
        assert.ok(STAFF_ROUTE.includes(token), `missing staff route token ${token}`);
    }
    for (const token of [
        "COALESCE(${safeAlias}.hr_pool_status, 'core') = 'core'",
        "COALESCE(${safeAlias}.is_freelance, false) = false",
        'termination_date'
    ]) {
        assert.ok(STAFF_OPERATIONAL_FILTERS.includes(token), `missing staff filter token ${token}`);
    }
    for (const token of [
        'async function cleanupFutureStaffOperationalSchedule',
        'DELETE FROM hr_shifts hs',
        'DELETE FROM staff_schedule ss',
        'NOT EXISTS',
        'hr_time_records',
        'syncLinkedStaffAccountDeactivation'
    ]) {
        assert.ok(STAFF_LIFECYCLE_SERVICE.includes(token), `missing lifecycle service token ${token}`);
    }
});

test('HR dark and mobile CSS covers nav counts, people result grid, KPI, and tap targets', () => {
    assert.ok(HR_HTML.includes('body.dark-mode .hr-nav-count'));
    assert.ok(HR_HTML.includes('body.dark-mode .hr-kpi-source'));
    assert.ok(HR_HTML.includes('body.dark-mode .hr-people-empty--error'));
    assert.ok(HR_HTML.includes('@media (max-width: 768px)'));
    assert.ok(HR_HTML.includes('.hr-people-results-grid { grid-template-columns: 1fr; }'));
    assert.ok(HR_HTML.includes('.hr-tab { min-width: 80px; padding: 8px 10px; font-size: 12px; }'));
    assert.ok(HR_HTML.includes('.hr-nav--pulse .hr-nav-items'));
    assert.ok(HR_HTML.includes('flex-wrap: nowrap;'));
    assert.ok(HR_HTML.includes('overflow-x: auto;'));
    assert.ok(HR_HTML.includes('grid-template-columns: repeat(3, minmax(0, 1fr));'));
    assert.ok(HR_HTML.includes('body.dark-mode .hr-nav--pulse .hr-tab.active'));
    assert.ok(HR_HTML.includes('.hr-team-open'));
    assert.ok(HR_HTML.includes('.hr-team-overflow-menu'));
    assert.ok(HR_HTML.includes('.hr-team-training-compact'));

    const resultRule = HR_HTML.match(/\.hr-people-results\s*\{([\s\S]*?)\}/)?.[1] || '';
    assert.equal(/overflow-[xy]\s*:/.test(resultRule), false, 'people result surface should not introduce nested scrolling');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const hrSource = fs.readFileSync(path.join(ROOT, 'js', 'hr-page.js'), 'utf8');
const uiSource = fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8');
const hrHtml = fs.readFileSync(path.join(ROOT, 'hr.html'), 'utf8');
const hrRouteSource = fs.readFileSync(path.join(ROOT, 'routes', 'hr.js'), 'utf8');
const hrCss = fs.readFileSync(path.join(ROOT, 'css', 'hr-page.css'), 'utf8');
const payrollPeriodSource = fs.readFileSync(path.join(ROOT, 'services', 'hrPayrollPeriod.js'), 'utf8');

const TXT = {
    defaultReason: '\u0417\u0420\u0421 \u043f\u0456\u0434 \u0437\u0430\u0440\u043f\u043b\u0430\u0442\u0443',
    animator: '\u0410\u043d\u0456\u043c\u0430\u0442\u043e\u0440',
    admin: '\u0410\u0434\u043c\u0456\u043d',
    noDepartment: '\u0411\u0435\u0437 \u0432\u0456\u0434\u0434\u0456\u043b\u0443',
    alla: '\u0410\u043b\u043b\u0430 \u041a\u043e\u0432\u0430\u043b\u044c',
    olena: '\u041e\u043b\u0435\u043d\u0430 \u0410\u043b\u0435\u0439\u043d\u0438\u043a\u043e\u0432\u0430',
    maria: '\u041c\u0430\u0440\u0456\u044f \u041f\u0435\u0442\u0440\u0435\u043d\u043a\u043e',
    artDepartment: '\u0410\u0440\u0442-\u0432\u0456\u0434\u0434\u0456\u043b',
    reception: '\u0420\u0435\u0446\u0435\u043f\u0446\u0456\u044f',
    searchAl: '\u0430\u043b',
    searchPet: '\u043f\u0435\u0442',
    confirmRisk: '\u041f\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0436\u0443\u044e \u0440\u0438\u0437\u0438\u043a',
    salaryUnavailable: '\u0420\u043e\u0437\u0440\u0430\u0445\u0443\u043d\u043e\u043a \u0437\u0430\u0440\u043f\u043b\u0430\u0442\u0438 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0438\u0439',
    summaryTitle: '\u041f\u0456\u0434\u0441\u0443\u043c\u043e\u043a \u043f\u043e \u043f\u0440\u0430\u0446\u0456\u0432\u043d\u0438\u043a\u0430\u0445',
    journalTitle: '\u0416\u0443\u0440\u043d\u0430\u043b \u043e\u043f\u0435\u0440\u0430\u0446\u0456\u0439',
    previewActive: '\u0410\u043a\u0442\u0438\u0432\u043d\u0438\u0439 \u0417\u0420\u0421 \u0437\u0430\u0440\u0430\u0437',
    salaryMissing: '\u043f\u0440\u0430\u0446\u0456\u0432\u043d\u0438\u043a\u0430 \u043d\u0435\u043c\u0430\u0454 \u0432 salary calculation',
    zeroNotInvented: '0 \u043d\u0435 \u043f\u0456\u0434\u0441\u0442\u0430\u0432\u043b\u044f\u0454\u0442\u044c\u0441\u044f',
    projectedAfter: '\u041f\u0440\u043e\u0433\u043d\u043e\u0437 \u043f\u0456\u0441\u043b\u044f \u043d\u043e\u0432\u043e\u0433\u043e \u0417\u0420\u0421',
    activeBefore: '\u0410\u043a\u0442\u0438\u0432\u043d\u0438\u0439 \u0417\u0420\u0421 \u0434\u043e \u043e\u043f\u0435\u0440\u0430\u0446\u0456\u0457',
    projectedTotal: '\u041f\u0440\u043e\u0433\u043d\u043e\u0437\u043e\u0432\u0430\u043d\u0438\u0439 total \u0417\u0420\u0421',
    comment: '\u041a\u043e\u043c\u0435\u043d\u0442\u0430\u0440'
};

function readFunctionSource(name) {
    const start = hrSource.indexOf(`function ${name}`);
    assert.notEqual(start, -1, `missing ${name}`);
    const next = hrSource.slice(start + 1).search(/\n(?:async\s+)?function\s+/);
    return hrSource.slice(start, next === -1 ? hrSource.length : start + 1 + next);
}

const zrsAdjustmentActiveSource = readFunctionSource('zrsAdjustmentActive');
const zrsAdjustmentIsAdvanceSource = readFunctionSource('zrsAdjustmentIsAdvance');
const zrsSummaryRowsFromAdjustmentsSource = readFunctionSource('zrsSummaryRowsFromAdjustments');
const buildZrsViewModelSource = readFunctionSource('buildZrsViewModel');
const normalizeZrsPeriodsSource = readFunctionSource('normalizeZrsPeriods');
const normalizeSearchTextSource = readFunctionSource('normalizeSearchText');
const buildZrsStaffOptionsSource = readFunctionSource('buildZrsStaffOptions');
const zrsStaffOptionMatchesQuerySource = readFunctionSource('zrsStaffOptionMatchesQuery');
const cleanZrsReasonSource = readFunctionSource('cleanZrsReason');
const zrsAmountFromValueSource = readFunctionSource('zrsAmountFromValue');
const zrsPreviewForStaffSource = readFunctionSource('zrsPreviewForStaff');
const renderZrsFormPreviewSource = readFunctionSource('renderZrsFormPreview');
const zrsConfirmationTextSource = readFunctionSource('zrsConfirmationText');

const { buildZrsViewModel, normalizeZrsPeriods } = new Function(
    `${zrsAdjustmentActiveSource}\n${zrsAdjustmentIsAdvanceSource}\n${zrsSummaryRowsFromAdjustmentsSource}\n${buildZrsViewModelSource}\n${normalizeZrsPeriodsSource}\nreturn { buildZrsViewModel, normalizeZrsPeriods };`
)();
const { buildZrsStaffOptions, zrsStaffOptionMatchesQuery } = new Function(
    `const ROLE_LABELS = { animator: ${JSON.stringify(TXT.animator)}, admin: ${JSON.stringify(TXT.admin)} };\nfunction departmentLabel(value) { return value || ${JSON.stringify(TXT.noDepartment)}; }\n${normalizeSearchTextSource}\n${buildZrsStaffOptionsSource}\n${zrsStaffOptionMatchesQuerySource}\nreturn { buildZrsStaffOptions, zrsStaffOptionMatchesQuery };`
)();
const {
    cleanZrsReason,
    zrsAmountFromValue,
    zrsPreviewForStaff,
    renderZrsFormPreview,
    zrsConfirmationText
} = new Function([
    `const ZRS_CANONICAL_DEFAULT_REASON = ${JSON.stringify(TXT.defaultReason)};`,
    `const ROLE_LABELS = { animator: ${JSON.stringify(TXT.animator)}, admin: ${JSON.stringify(TXT.admin)} };`,
    'function fmtMoney(value) { return String(Number(value || 0)) + " " + String.fromCharCode(0x20B4); }',
    cleanZrsReasonSource,
    zrsAmountFromValueSource,
    zrsPreviewForStaffSource,
    renderZrsFormPreviewSource,
    zrsConfirmationTextSource,
    'return { cleanZrsReason, zrsAmountFromValue, zrsPreviewForStaff, renderZrsFormPreview, zrsConfirmationText };'
].join('\n'))();

test('ZRS totals come only from active ZRS journal entries', () => {
    const view = buildZrsViewModel({
        data: [
            { id: 1, staff_id: 1, staff_name: 'Anna', type: 'advance', amount: 100, status: 'applied' },
            { id: 2, staff_id: 1, staff_name: 'Anna', type: 'advance', amount: 200, status: 'pending_review' },
            { id: 3, staff_id: 2, staff_name: 'Maria', type: 'advance', amount: 50, status: 'applied' },
            { id: 4, staff_id: 2, staff_name: 'Maria', type: 'advance', amount: 999, status: 'voided' },
            { id: 5, staff_id: 1, staff_name: 'Anna', type: 'bonus', amount: 9999, status: 'applied' }
        ],
        totals: { active_amount: 150, active_count: 2, voided_amount: 999, voided_count: 1, pending_count: 1 }
    }, {
        totals: { total_advances: 5000, total_salary: 19800 },
        data: [
            { staff_id: 1, staff_name: 'Anna', advances: 900, deductions: 30, penalties: 20, total_salary: 1000 },
            { staff_id: 3, staff_name: 'Unrelated', advances: 0, total_salary: 18800 }
        ]
    });

    assert.equal(view.totalZrs, 150);
    assert.equal(view.affectedCount, 2);
    assert.equal(view.activeEntryCount, 2);
    assert.equal(view.netAfterZrs, 1000);
    assert.equal(view.zrsTotals.activeAmount, 150);
    assert.equal(view.zrsTotals.activeCount, 2);
    assert.equal(view.zrsTotals.voidedAmount, 999);
    assert.equal(view.zrsTotals.voidedCount, 1);
    assert.equal(view.zrsTotals.pendingCount, 1);
    assert.equal(view.zrsRows.find(row => row.staff_id === 1)?.advances, 100);
    assert.equal(view.zrsRows.find(row => row.staff_id === 2)?.salary_missing, true);
});

test('ZRS empty state never displays unrelated team salary totals', () => {
    const view = buildZrsViewModel({ data: [] }, {
        totals: { total_advances: 0, total_salary: 18800 },
        data: [{ staff_id: 3, total_salary: 18800 }]
    });

    assert.equal(view.totalZrs, 0);
    assert.equal(view.affectedCount, 0);
    assert.equal(view.activeEntryCount, 0);
    assert.equal(view.netAfterZrs, 0);
    assert.deepEqual(view.zrsRows, []);
});

test('ZRS backend summary rows are not limited by the visible journal page', () => {
    const view = buildZrsViewModel({
        data: [
            { id: 1, staff_id: 1, staff_name: 'Anna', type: 'advance', amount: 100, status: 'applied' }
        ],
        summary_rows: [
            { staff_id: 1, staff_name: 'Anna', zrs_amount: 300, active_entry_count: 3 },
            { staff_id: 2, staff_name: 'Maria', zrs_amount: 75, active_entry_count: 1 }
        ],
        pagination: { limit: 1, offset: 0, total: 4, has_more: true }
    }, {
        data: [{ staff_id: 1, staff_name: 'Anna', total_salary: 900 }]
    });

    assert.equal(view.totalZrs, 375);
    assert.equal(view.affectedCount, 2);
    assert.equal(view.activeEntryCount, 4);
    assert.equal(view.zrsRows.find(row => row.staff_id === 2)?.salary_missing, true);
    assert.equal(view.pagination.has_more, true);
});

test('ZRS journal stays usable when salary context is unavailable', () => {
    const view = buildZrsViewModel({
        data: [{ id: 1, staff_id: 7, staff_name: TXT.alla, type: 'advance', amount: 100, status: 'applied' }],
        summary_rows: [{ staff_id: 7, staff_name: TXT.alla, zrs_amount: 100, active_entry_count: 1 }]
    }, { success: false, error: 'salary unavailable' }, { salaryUnavailable: true });

    assert.equal(view.totalZrs, 100);
    assert.equal(view.affectedCount, 1);
    assert.equal(view.netAfterZrs, null);
    assert.equal(view.zrsRows[0].salary_missing, true);
    assert.equal(view.zrsRows[0].salary_context_unavailable, true);
});

test('ZRS create preview exposes salary impact warnings and canonical reason helpers', () => {
    const context = {
        journal: {
            success: true,
            summary_rows: [{ staff_id: 7, staff_name: TXT.alla, zrs_amount: 250, active_entry_count: 2 }]
        },
        salary: {
            success: true,
            data: [{ staff_id: 7, staff_name: TXT.alla, role_type: 'animator', total_salary: 600 }]
        }
    };
    const staffById = new Map([[7, { id: 7, name: TXT.alla, role: 'animator', department: TXT.artDepartment }]]);

    const preview = zrsPreviewForStaff(context, staffById.get(7), 7, 700);
    assert.equal(preview.activeZrsAmount, 250);
    assert.equal(preview.activeZrsCount, 2);
    assert.equal(preview.currentSalary, 600);
    assert.equal(preview.projectedSalary, -100);
    assert.equal(preview.exceedsSalary, true);

    const previewText = renderZrsFormPreview({ staffId: '7', amount: '700' }, context, staffById, '2026-07');
    assert.match(previewText, new RegExp(`${TXT.previewActive}: 250 \\u20B4`));
    assert.match(previewText, /УВАГА:/);
    assert.match(previewText, new RegExp(`${TXT.projectedAfter}: -100 \\u20B4`));

    const noSalaryText = renderZrsFormPreview({ staffId: '8', amount: '100' }, {
        journal: { success: true, summary_rows: [] },
        salary: { success: true, data: [] }
    }, new Map([[8, { id: 8, name: TXT.maria, role: 'admin', department: TXT.reception }]]), '2026-07');
    assert.match(noSalaryText, new RegExp(TXT.salaryMissing));
    assert.match(noSalaryText, new RegExp(TXT.zeroNotInvented));

    const nul = String.fromCharCode(0);
    assert.equal(cleanZrsReason(`  ${nul}  `), TXT.defaultReason);
    assert.equal(cleanZrsReason(`  test${nul}  `), 'test');
    assert.equal(cleanZrsReason('x'.repeat(520)).length, 500);
    assert.equal(zrsAmountFromValue('25'), 25);
    assert.equal(zrsAmountFromValue('25.5'), 0);
    assert.equal(zrsAmountFromValue('0'), 0);

    const confirmation = zrsConfirmationText(preview, '2026-07', '');
    assert.match(confirmation, new RegExp(`${TXT.activeBefore}: 250 \\u20B4`));
    assert.match(confirmation, new RegExp(`${TXT.projectedTotal}: 950 \\u20B4`));
    assert.match(confirmation, new RegExp(`${TXT.comment}: ${TXT.defaultReason}`));
});

test('ZRS period list keeps historical months without a fixed 12 month cap', () => {
    assert.deepEqual(
        normalizeZrsPeriods(['2026-05', '2024-01', '2025-12', 'broken', '2024-01'], '2026-07'),
        ['2026-07', '2026-05', '2025-12', '2024-01']
    );
});

test('ZRS period union keeps baseline empty months selected month and old history', () => {
    assert.deepEqual(
        normalizeZrsPeriods(
            ['2026-07', '2026-04', '2024-01', 'broken', '2026-07'],
            '2026-06',
            ['2026-07', '2026-06', '2026-05']
        ),
        ['2026-07', '2026-06', '2026-05', '2026-04', '2024-01']
    );
});

test('ZRS staff search matches Ukrainian partial names and disambiguates duplicate full names', () => {
    const options = buildZrsStaffOptions([
        { id: 1, name: TXT.alla, role_type: 'animator', department: TXT.artDepartment },
        { id: 2, name: TXT.olena, role_type: 'admin', department: TXT.reception },
        { id: 3, name: TXT.maria, role_type: 'admin', department: TXT.reception },
        { id: 4, name: TXT.alla, role_type: 'admin', department: TXT.reception }
    ]);

    assert.deepEqual(
        options.filter(option => zrsStaffOptionMatchesQuery(option, TXT.searchAl)).map(option => option.value),
        ['1', '2', '4']
    );
    assert.deepEqual(
        options.filter(option => zrsStaffOptionMatchesQuery(option, TXT.searchPet)).map(option => option.value),
        ['3']
    );
    assert.equal(options.find(option => option.value === '1')?.label, `${TXT.alla} · ${TXT.animator} · ${TXT.artDepartment}`);
    assert.equal(options.find(option => option.value === '4')?.label, `${TXT.alla} · ${TXT.admin} · ${TXT.reception}`);
});

test('ZRS month and staff search contracts stay wired', () => {
    assert.match(hrSource, /if \(zrsMonth && !zrsMonth\.options\.length\) ensurePayrollMonthOptions\(zrsMonth, month\)/);
    assert.match(hrSource, /const selectedMonth = monthSelect\?\.value \|\| currentSalaryMonth\(\)/);
    assert.doesNotMatch(
        hrSource,
        /ensurePayrollMonthOptions\(monthSelect, currentSalaryMonth\(\)\);\s*const month = monthSelect\?\.value/
    );
    assert.match(hrSource, /key: 'staffQuery'[\s\S]*type: 'search'/);
    assert.match(hrSource, /dependsOn: 'staffQuery'[\s\S]*optionsFor: filteredStaffOptions/);
    assert.match(hrSource, /validate: validateZrsFormValues/);
    assert.match(hrSource, /type: 'dynamicNote'[\s\S]*render: values => renderZrsFormPreview/);
    assert.match(hrSource, /let zrsCreateRequestInFlight = false/);
    assert.match(hrSource, /loadZrsCreatePreviewContext\(month\)/);
    assert.match(hrSource, /if \(!latestContext\.journal\)/);
    assert.ok(hrSource.includes(TXT.confirmRisk));
    assert.match(hrSource, /zrsConfirmationText\(preview, month, reason\)/);
    assert.match(hrSource, /const staffId = Number\(String\(result\.staffId \|\| ''\)\.trim\(\)\)/);
    assert.match(hrSource, /Number\.isSafeInteger\(amount\)/);
    assert.doesNotMatch(hrSource, /Math\.abs\(parseInt\(result\.amount/);
    assert.match(uiSource, /parent\.addEventListener\('input', rebuild\)/);
    assert.match(hrHtml, /id="zrsSearch"/);
    assert.match(hrHtml, /placeholder="Пошук за ПІБ, #ID, staff ID або коментарем"/);
    assert.match(hrHtml, /aria-label="Пошук ЗРС за ПІБ, ID операції, staff ID або коментарем"/);
    assert.match(hrHtml, /zrs-journal-table/);
    assert.match(hrCss, /#tab-zrs\s*\{[\s\S]*overflow-x:\s*hidden/);
    assert.match(hrCss, /\.zrs-journal-table\s*\{[\s\S]*min-width:\s*1280px/);
    assert.match(hrHtml, /id="zrsStatusFilter"/);
    assert.match(hrHtml, /id="zrsRetry"/);
    assert.match(hrHtml, /id="zrsLoadMore"/);
    assert.match(hrSource, /function renderZrsError/);
    assert.match(hrSource, /function renderZrsLoadingState/);
    assert.match(hrSource, /function loadMoreZrsJournal/);
    assert.match(hrSource, /function standardPayrollMonths/);
    assert.match(hrSource, /const baselinePeriods = \[\.\.\.standardPayrollMonths\(\), \.\.\.currentOptions\]/);
    assert.match(hrSource, /include_periods: append \|\| options\.journalOnly \? '0' : '1'/);
    assert.match(hrSource, /const zrsSalaryContextCache = new Map\(\)/);
    assert.match(hrSource, /AbortController/);
    assert.match(hrSource, /loadZrs\(\{ journalOnly: true \}\)/);
    assert.match(hrSource, /loadZrs\(\{ append: true, journalOnly: true \}\)/);
    assert.match(hrSource, /loadZrs\(\{ retry: true \}\)/);
    assert.match(hrSource, /!lockKnown \|\| isLocked/);
    assert.ok(hrSource.includes(TXT.salaryUnavailable));
    assert.match(hrSource, /function canManageZrsAdjustments/);
    assert.match(hrSource, /canViewPayrollWorkspace\(user\) && canManageStaff/);
    assert.match(hrSource, /addBtn\.hidden = !canWriteZrs/);
    assert.match(hrSource, /const canVoid = canWriteZrs && lockKnown && !isLocked && active/);
    assert.match(hrSource, /return status === 'applied'/);
    assert.match(hrSource, /pending_review:/);
    assert.match(hrSource, /PAYROLL_ADJUSTMENTS_UNAVAILABLE/);
    assert.match(hrSource, /Payroll context/);
    assert.match(fs.readFileSync(path.join(ROOT, 'services', 'payroll.js'), 'utf8'), /throw payrollAdjustmentsUnavailableError\(err\)/);
    assert.match(hrRouteSource, /code: err\.code \|\| null/);
    assert.match(hrRouteSource, /acquirePayrollPeriodMutationLock\(client, payrollMonth\)/);
    assert.match(hrRouteSource, /ZRS_VOID_REASON_REQUIRED/);
    assert.match(hrRouteSource, /period_lock: periodLock/);
    assert.match(hrRouteSource, /WHERE sa\.type = 'advance'/);
    assert.doesNotMatch(hrRouteSource, /const periodFilter = buildFilters\(\{ includeStatus: false, includeMonth: false \}\)/);
    assert.match(hrRouteSource, /auditLog\('salary_adjustment_void'[\s\S]*?, client\)/);
    assert.match(payrollPeriodSource, /SELECT pg_advisory_xact_lock\(hashtextextended/);
    assert.match(payrollPeriodSource, /eventgenix:payroll-period:\$\{normalizedMonth\}/);
    assert.match(hrSource, /summary_rows/);
    assert.doesNotMatch(readFunctionSource('loadZrs'), /Promise\.all/);
    assert.match(hrSource, /pagination\.has_more/);
    assert.match(hrSource, /void_reason/);
    assert.match(hrSource, /const adjustmentId = Number\(row\.adjustment_id \|\| row\.id \|\| 0\)/);
    assert.match(hrSource, /staff ID: \$\{staffId \|\| '—'\}/);
    assert.match(hrSource, /row\.staff_role/);
    assert.match(hrSource, /row\.staff_department/);
    assert.match(hrSource, /row\.created_by_role/);
    assert.match(hrSource, /row\.voided_by_role/);
    assert.match(hrSource, /row\.affects_payroll/);
    assert.match(hrSource, /payrollStatusText/);
    assert.match(hrSource, /aria-label="Скасувати ЗРС #\$\{adjustmentId\}/);
    assert.match(hrSource, /zrsEmptyRow\(search \? 'У журналі немає записів за цим пошуком' : 'Журнал ЗРС порожній для вибраного статусу', 12\)/);
    assert.match(hrRouteSource, /escapeSqlLikePattern\(search\)/);
    assert.match(hrRouteSource, /COALESCE\(sa\.reason, ''\) ILIKE/);
    assert.match(hrRouteSource, /sa\.id = \$\$\{params\.length\}/);
    assert.match(hrRouteSource, /sa\.staff_id = \$\$\{params\.length\}/);
    assert.match(hrRouteSource, /sa\.id AS adjustment_id/);
    assert.match(hrRouteSource, /s\.role_type AS staff_role/);
    assert.match(hrRouteSource, /s\.department AS staff_department/);
    assert.match(hrRouteSource, /created_by_role/);
    assert.match(hrRouteSource, /voided_by_role/);
    assert.match(hrRouteSource, /AS affects_payroll/);
    assert.match(hrRouteSource, /AS active_amount/);
    assert.match(hrRouteSource, /AS voided_amount/);
    assert.match(hrRouteSource, /AS pending_count/);
    assert.ok(hrHtml.includes(TXT.summaryTitle));
    assert.ok(hrHtml.includes(TXT.journalTitle));
});
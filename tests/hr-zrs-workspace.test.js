const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const hrSource = fs.readFileSync(path.join(ROOT, 'js', 'hr-page.js'), 'utf8');
const uiSource = fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8');
const hrHtml = fs.readFileSync(path.join(ROOT, 'hr.html'), 'utf8');

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
const { buildZrsViewModel, normalizeZrsPeriods } = new Function(
    `${zrsAdjustmentActiveSource}\n${zrsAdjustmentIsAdvanceSource}\n${zrsSummaryRowsFromAdjustmentsSource}\n${buildZrsViewModelSource}\n${normalizeZrsPeriodsSource}\nreturn { buildZrsViewModel, normalizeZrsPeriods };`
)();
const { buildZrsStaffOptions, zrsStaffOptionMatchesQuery } = new Function(
    `const ROLE_LABELS = { animator: 'Аніматор', admin: 'Адмін' };\nfunction departmentLabel(value) { return value || 'Без відділу'; }\n${normalizeSearchTextSource}\n${buildZrsStaffOptionsSource}\n${zrsStaffOptionMatchesQuerySource}\nreturn { buildZrsStaffOptions, zrsStaffOptionMatchesQuery };`
)();

test('ZRS totals come only from active ZRS journal entries', () => {
    const view = buildZrsViewModel({
        data: [
            { id: 1, staff_id: 1, staff_name: 'Anna', type: 'advance', amount: 100, status: 'applied' },
            { id: 2, staff_id: 1, staff_name: 'Anna', type: 'advance', amount: 200, status: 'pending_review' },
            { id: 3, staff_id: 2, staff_name: 'Maria', type: 'advance', amount: 50, status: 'applied' },
            { id: 4, staff_id: 2, staff_name: 'Maria', type: 'advance', amount: 999, status: 'voided' },
            { id: 5, staff_id: 1, staff_name: 'Anna', type: 'bonus', amount: 9999, status: 'applied' }
        ]
    }, {
        totals: { total_advances: 5000, total_salary: 19800 },
        data: [
            {
                staff_id: 1,
                staff_name: 'Anna',
                advances: 900,
                deductions: 30,
                penalties: 20,
                total_salary: 1000
            },
            {
                staff_id: 3,
                staff_name: 'Unrelated',
                advances: 0,
                total_salary: 18800
            }
        ]
    });

    assert.equal(view.totalZrs, 350);
    assert.equal(view.affectedCount, 2);
    assert.equal(view.activeEntryCount, 3);
    assert.equal(view.netAfterZrs, 1000);
    assert.equal(view.zrsRows.find(row => row.staff_id === 1)?.advances, 300);
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

test('ZRS period list keeps historical months without a fixed 12 month cap', () => {
    assert.deepEqual(
        normalizeZrsPeriods(['2026-05', '2024-01', '2025-12', 'broken', '2024-01'], '2026-07'),
        ['2026-07', '2026-05', '2025-12', '2024-01']
    );
});
test('ZRS staff search matches Ukrainian partial names and disambiguates duplicate full names', () => {
    const options = buildZrsStaffOptions([
        { id: 1, name: 'Алла Коваль', role_type: 'animator', department: 'Арт-відділ' },
        { id: 2, name: 'Олена Алейникова', role_type: 'admin', department: 'Рецепція' },
        { id: 3, name: 'Марія Петренко', role_type: 'admin', department: 'Рецепція' },
        { id: 4, name: 'Алла Коваль', role_type: 'admin', department: 'Рецепція' }
    ]);

    assert.deepEqual(
        options.filter(option => zrsStaffOptionMatchesQuery(option, 'ал')).map(option => option.value),
        ['1', '2', '4']
    );
    assert.deepEqual(
        options.filter(option => zrsStaffOptionMatchesQuery(option, 'пет')).map(option => option.value),
        ['3']
    );
    assert.equal(options.find(option => option.value === '1')?.label, 'Алла Коваль · Аніматор · Арт-відділ');
    assert.equal(options.find(option => option.value === '4')?.label, 'Алла Коваль · Адмін · Рецепція');
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
    assert.match(hrSource, /const staffId = Number\(staffIdValue\)/);
    assert.match(hrSource, /Number\.isSafeInteger\(amount\)/);
    assert.doesNotMatch(hrSource, /Math\.abs\(parseInt\(result\.amount/);
    assert.match(uiSource, /parent\.addEventListener\('input', rebuild\)/);
    assert.match(hrHtml, /id="zrsSearch"/);
    assert.match(hrHtml, /id="zrsStatusFilter"/);
    assert.match(hrHtml, /id="zrsRetry"/);
    assert.match(hrHtml, /id="zrsLoadMore"/);
    assert.match(hrSource, /function renderZrsError/);
    assert.match(hrSource, /function renderZrsLoadingState/);
    assert.match(hrSource, /function loadMoreZrsJournal/);
    assert.match(hrSource, /summary_rows/);
    assert.match(hrSource, /pagination\.has_more/);
    assert.match(hrSource, /void_reason/);
    assert.match(hrHtml, /Підсумок по працівниках/);
    assert.match(hrHtml, /Журнал операцій/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');

function jsonResponse(data, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => data,
        blob: async () => new Blob([JSON.stringify(data)])
    };
}

async function waitFor(predicate, message = 'condition') {
    for (let i = 0; i < 60; i += 1) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.fail(`Timed out waiting for ${message}`);
}

async function setupReportsDom(setupOptions = {}) {
    const html = fs.readFileSync(path.join(ROOT, 'reports.html'), 'utf8');
    const js = fs.readFileSync(path.join(ROOT, 'js/reports-page.js'), 'utf8');
    const dom = new JSDOM(html, {
        url: 'http://localhost:3000/reports',
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });
    const { window } = dom;
    const createdReports = [];
    const requests = [];

    window.AppState = {};
    window.apiVerifyToken = async () => ({ id: 1, username: 'serhiy', role: 'creator' });
    const deniedActions = new Set(setupOptions.deniedActions || []);
    window.canAccess = action => !deniedActions.has(action);
    window.initDarkMode = () => {};
    window.showAuthenticatedPageShell = () => {};
    window.confirmModal = async () => true;
    window.promptModal = async () => 'Нова колонка';
    window.finishBlobDownload = () => {};
    window.localStorage.setItem('pzp_token', 'test-token');
    window.fetch = async (url, fetchOptions = {}) => {
        const target = String(url);
        requests.push({ url: target, options: fetchOptions });
        if (target.startsWith('/api/reports/templates')) {
            return jsonResponse({ success: true, templates: setupOptions.backendTemplates || [], canManage: true });
        }
        if (target.startsWith('/api/reports/drafts')) return jsonResponse({ success: true, drafts: [] });
        if (target.startsWith('/api/staff?active=true')) {
            if (setupOptions.staffApiFails) return jsonResponse({ success: false, error: 'staff_unavailable' }, 503);
            return jsonResponse({
                success: true,
                data: [
                    { id: 42, name: 'Оля Коваленко', display_name: 'Оля Коваленко', department: 'animators', position: 'Аніматор', role_type: 'animator' }
                ]
            });
        }
        if (target.startsWith('/api/staff/schedule')) {
            return jsonResponse({
                success: true,
                data: setupOptions.scheduleData ?? [
                    {
                        id: 700,
                        staff_id: 42,
                        date: '2026-06-28',
                        status: 'working',
                        shift_start: '09:00',
                        shift_end: '20:00',
                        hr_shift_id: 701,
                        primary_profession_key: 'reception',
                        planned_minutes: 510,
                        segments: [
                            {
                                id: 7101,
                                professionKey: 'reception',
                                shiftStart: '09:00',
                                shiftEnd: '13:00',
                                breakMinutes: 30,
                                additionalProfessionKeys: ['manager']
                            },
                            {
                                id: 7102,
                                professionKey: 'manager',
                                shiftStart: '15:00',
                                shiftEnd: '20:00',
                                breakMinutes: 0,
                                additionalProfessionKeys: []
                            }
                        ]
                    }
                ]
            });
        }
        if (target.startsWith('/api/staff/attendance')) {
            return jsonResponse({
                success: true,
                data: setupOptions.attendanceData ?? [
                    {
                        staff_id: 42,
                        date: '2026-06-28',
                        time_record_id: 800,
                        clock_in: '2026-06-28T10:30:00.000Z',
                        clock_out: '2026-06-28T18:00:00.000Z',
                        planned_start: '09:00',
                        planned_end: '20:00',
                        late_minutes: 30,
                        early_leave_minutes: 45,
                        overtime_minutes: 20,
                        total_worked_minutes: 450,
                        time_status: 'late',
                        plan_source: 'hr_shift',
                        attendance_source: 'hr_time_records',
                        allocation_source: 'clock_interval'
                    }
                ]
            });
        }
        if (target.startsWith('/api/reports/summary')) return jsonResponse({ today: { income: 0, expense: 0, newReports: 0 }, statuses: { new: 0 } });
        if (target.startsWith('/api/reports/accountants')) return jsonResponse([]);
        if (target.startsWith('/api/reports/hashtags')) {
            return jsonResponse([
                { hashtag: 'table-finance', total: 100, count: 1, activeCount: 1, inactiveCount: 0 },
                { hashtag: 'visible-ops', total: 50, count: 1, activeCount: 1, inactiveCount: 0 }
            ]);
        }
        if (target.startsWith('/api/reports/workflow-settings')) {
            return jsonResponse({
                approvalAssigneeUserId: 2,
                approvalAssigneeLabel: 'Бухгалтер',
                users: [{ id: 2, username: 'accountant', name: 'Бухгалтер', role: 'accountant', label: 'Бухгалтер' }],
                taskContract: { sourceType: 'report', sourceEntityType: 'report' }
            });
        }
        if (target.startsWith('/api/payroll/export-xlsx')) {
            return jsonResponse({ success: true, source: 'canonical_payroll_xlsx' });
        }
        if (target.startsWith('/api/payroll/export')) {
            return jsonResponse({ success: true, source: 'canonical_payroll_csv' });
        }
        if (target === '/api/reports/table/close' && fetchOptions.method === 'POST') {
            const body = JSON.parse(fetchOptions.body || '{}');
            const rawData = JSON.parse(JSON.stringify(body.tableJson || {}));
            rawData.reportTableTemplate.lifecycle = {
                status: 'closed',
                closedAt: '2026-05-23T10:00:00.000Z',
                closedBy: 'serhiy',
                closedByUserId: 1
            };
            const report = {
                id: body.reportId || 9100,
                type: 'expense',
                amount: body.amount,
                description: body.description,
                category: body.category,
                submittedBy: 'Сергій',
                submittedVia: 'web-template',
                status: 'new',
                lifecycleStatus: 'closed',
                approvalStatus: 'task_created',
                approvalTaskId: 777,
                approvalAssigneeName: 'Бухгалтер',
                closedAt: '2026-05-23T10:00:00.000Z',
                closedByUsername: 'serhiy',
                createdAt: new Date().toISOString(),
                hashtags: body.hashtags || [],
                hashtagActive: true,
                rawData,
                lockedSnapshot: rawData
            };
            createdReports.unshift(report);
            return jsonResponse({ success: true, report }, body.reportId ? 200 : 201);
        }
        if (target.startsWith('/api/reports?')) return jsonResponse({ reports: createdReports, total: createdReports.length });
        if (target === '/api/reports' && fetchOptions.method === 'POST') {
            const body = JSON.parse(fetchOptions.body || '{}');
            const report = {
                id: 9001,
                type: body.type,
                amount: body.amount,
                description: body.description,
                category: body.category,
                submittedBy: 'Сергій',
                submittedVia: body.submittedVia,
                status: 'new',
                createdAt: new Date().toISOString(),
                hashtags: body.hashtags || [],
                hashtagActive: true,
                rawData: body.rawData || {}
            };
            createdReports.unshift(report);
            return jsonResponse(report, 201);
        }
        return jsonResponse({});
    };

    window.eval(js);
    window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
    await waitFor(() => window.document.querySelectorAll('.rpt-sheet-input').length > 0, 'reports workspace init');
    return { window, requests };
}

test('reports workspace protects dirty table state and manages rows/columns', async () => {
    const { window } = await setupReportsDom();
    const document = window.document;

    const firstInput = document.querySelector('.rpt-sheet-input');
    firstInput.value = '2026-05-22';
    firstInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(document.getElementById('reportTemplateDirty').classList.contains('hidden'), false);

    window.confirmModal = async () => false;
    const picker = document.getElementById('reportTemplatePicker');
    picker.value = 'operations-checklist';
    picker.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.match(document.getElementById('reportSheetTitle').textContent, /Фінансовий/);
    assert.equal(picker.value, 'finance-day-summary');

    window.confirmModal = async () => true;
    picker.value = 'operations-checklist';
    picker.dispatchEvent(new window.Event('change', { bubbles: true }));
    await waitFor(() => /Операційний/.test(document.getElementById('reportSheetTitle').textContent), 'template switch');
    assert.equal(document.getElementById('reportTemplateDirty').classList.contains('hidden'), true);

    const rowsBefore = document.querySelectorAll('#reportSheetTable tbody tr').length;
    document.getElementById('reportTemplateAddRowBtn').click();
    assert.equal(document.querySelectorAll('#reportSheetTable tbody tr').length, rowsBefore + 1);

    document.querySelector('[data-report-row-duplicate="0"]').click();
    assert.equal(document.querySelectorAll('#reportSheetTable tbody tr').length, rowsBefore + 2);

    document.getElementById('reportTemplateAddColumnBtn').click();
    await waitFor(() => document.getElementById('reportSheetTable').textContent.includes('Нова колонка'), 'new column');
    const columnCount = document.querySelectorAll('#reportSheetTable thead th').length;
    const deleteColumnButtons = document.querySelectorAll('[data-report-column-delete]');
    deleteColumnButtons[deleteColumnButtons.length - 1].click();
    assert.equal(document.querySelectorAll('#reportSheetTable thead th').length, columnCount - 1);
});

test('reports create flow creates a real report without visible technical table hashtags', async () => {
    const { window, requests } = await setupReportsDom();
    const document = window.document;

    const firstInput = document.querySelector('.rpt-sheet-input');
    firstInput.value = '2026-05-22';
    firstInput.dispatchEvent(new window.Event('input', { bubbles: true }));

    document.getElementById('reportTemplateSaveBtn').click();
    await waitFor(() => requests.some(req => req.url === '/api/reports' && req.options.method === 'POST'), 'report create request');

    const createRequest = requests.find(req => req.url === '/api/reports' && req.options.method === 'POST');
    const body = JSON.parse(createRequest.options.body);
    assert.equal(body.submittedVia, 'web-template');
    assert.deepEqual(body.hashtags, []);
    await waitFor(() => /Оновити звіт/.test(document.getElementById('reportTemplateSaveBtn').textContent), 'create mode update');
    assert.equal(document.getElementById('reportTemplateDirty').classList.contains('hidden'), true);
    assert.match(document.getElementById('reportSheetModeChip').textContent, /#9001/);
    assert.equal(document.getElementById('hashtagDashboard').textContent.includes('table-finance'), false);
    assert.equal(document.getElementById('hashtagDashboard').textContent.includes('visible-ops'), true);
});

test('operations checklist stores owner staff id with display snapshot', async () => {
    const { window, requests } = await setupReportsDom();
    const document = window.document;

    const picker = document.getElementById('reportTemplatePicker');
    picker.value = 'operations-checklist';
    picker.dispatchEvent(new window.Event('change', { bubbles: true }));
    await waitFor(() => /Операційний/.test(document.getElementById('reportSheetTitle').textContent), 'operations template switch');

    const ownerSelect = document.querySelector('[data-row-index="0"][data-column-key="owner"][data-staff-field="true"]');
    assert.ok(ownerSelect);
    ownerSelect.value = '42';
    ownerSelect.dispatchEvent(new window.Event('input', { bubbles: true }));
    const status = document.querySelector('[data-row-index="0"][data-column-key="status"]');
    status.value = 'OK';
    status.dispatchEvent(new window.Event('input', { bubbles: true }));

    assert.match(document.getElementById('reportSheetSummary').textContent, /Report quality/);
    assert.match(document.getElementById('reportSheetSummary').textContent, /owner без staff_id/);
    document.querySelector('[data-report-quality-issue-filter="operations_owner_staff_id_missing"]').click();
    assert.equal(document.querySelectorAll('#reportSheetTable tbody tr').length, 2);
    document.querySelector('[data-report-quality-filter="needs_review"]').click();
    assert.equal(document.querySelectorAll('#reportSheetTable tbody tr').length, 2);

    document.getElementById('reportTemplateSaveBtn').click();
    await waitFor(() => requests.some(req => req.url === '/api/reports' && req.options.method === 'POST'), 'operations report create request');

    const createRequest = requests.find(req => req.url === '/api/reports' && req.options.method === 'POST');
    const body = JSON.parse(createRequest.options.body);
    const table = body.rawData.reportTableTemplate;
    const ownerColumn = table.columns.find(col => col.key === 'owner');
    const row = table.rows[0];
    assert.equal(ownerColumn.type, 'staff');
    assert.equal(ownerColumn.staffIdKey, 'owner_staff_id');
    assert.equal(row.owner, 'Оля Коваленко');
    assert.equal(row.owner_staff_id, '42');
    assert.equal(body.rawData.reportTableTemplate.reportQuality.status, 'needs_review');
    assert.equal(body.rawData.reportTableTemplate.reportQuality.blockingPolicy, 'informational_only_until_policy_confirmed');
    assert.equal(body.rawData.reportTableTemplate.reportQuality.issueCounts.operations_owner_staff_id_missing, 2);
});

test('staff report fields preserve legacy snapshot text without staff id', async () => {
    const { window, requests } = await setupReportsDom({
        backendTemplates: [
            {
                id: 'legacy-owner-template',
                title: 'Legacy owner table',
                category: 'Operations',
                layout: 'checklist',
                defaultReport: { type: 'expense', category: 'Офіс', hashtag: 'legacy-owner', amountColumn: null },
                columns: [
                    { key: 'task', label: 'Task', type: 'text' },
                    { key: 'owner', label: 'Owner', type: 'staff', staffIdKey: 'owner_staff_id' },
                    { key: 'status', label: 'Status', type: 'text' },
                    { key: 'note', label: 'Note', type: 'text' }
                ],
                rows: [
                    { task: 'Legacy task', owner: 'Legacy Owner', status: 'OK', note: 'old row' }
                ]
            }
        ]
    });
    const document = window.document;

    const picker = document.getElementById('reportTemplatePicker');
    picker.value = 'legacy-owner-template';
    picker.dispatchEvent(new window.Event('change', { bubbles: true }));
    await waitFor(() => /Legacy owner table/.test(document.getElementById('reportSheetTitle').textContent), 'legacy template switch');

    const ownerSelect = document.querySelector('[data-row-index="0"][data-column-key="owner"][data-staff-field="true"]');
    assert.ok(ownerSelect);
    assert.match(ownerSelect.textContent, /Legacy Owner · snapshot/);
    assert.equal(ownerSelect.value, '');

    document.getElementById('reportTemplateSaveBtn').click();
    await waitFor(() => requests.some(req => req.url === '/api/reports' && req.options.method === 'POST'), 'legacy report create request');

    const createRequest = requests.find(req => req.url === '/api/reports' && req.options.method === 'POST');
    const body = JSON.parse(createRequest.options.body);
    const row = body.rawData.reportTableTemplate.rows[0];
    assert.equal(row.owner, 'Legacy Owner');
    assert.equal(row.owner_staff_id, '');
    assert.equal(body.rawData.reportTableTemplate.reportQuality.status, 'needs_review');
    assert.equal(body.rawData.reportTableTemplate.reportQuality.issueCounts.operations_owner_staff_id_missing, 1);
});

test('payroll report template is read-only and exports through canonical payroll API', async () => {
    const { window, requests } = await setupReportsDom({
        backendTemplates: [{
            id: 700,
            code: 'canonical-payroll-template',
            title: 'Canonical payroll template',
            category: 'HR',
            layout: 'payroll',
            source: 'backend',
            defaultReport: { type: 'expense', category: 'ЗП', hashtag: 'table-payroll', amountColumn: 'total' },
            columns: [
                { key: 'date', label: 'Дата', type: 'date' },
                { key: 'employee', label: 'Працівник', type: 'staff', staffIdKey: 'employee_staff_id' },
                { key: 'total', label: 'До виплати', type: 'number' }
            ],
            rows: [{ date: '2026-06-28', employee: 'Оля', employee_staff_id: '42', total: '1200' }]
        }]
    });
    const document = window.document;

    const picker = document.getElementById('reportTemplatePicker');
    picker.value = 'canonical-payroll-template';
    picker.dispatchEvent(new window.Event('change', { bubbles: true }));
    await waitFor(() => /payroll/i.test(document.getElementById('reportSheetTitle').textContent), 'payroll template switch');

    assert.equal(document.getElementById('reportTemplateSaveBtn').disabled, true);
    assert.equal(document.getElementById('reportTemplateCloseBtn').disabled, true);
    assert.match(document.getElementById('reportTemplateStatus').textContent, /canonical Payroll API|read-only/i);
    assert.match(document.getElementById('reportSheetSummary').textContent, /Payroll read-only|Canonical API/i);

    document.getElementById('reportTemplateExportCsvBtn').click();
    await waitFor(() => requests.some(req => req.url.startsWith('/api/payroll/export?month=2026-06')), 'canonical payroll CSV export request');

    document.getElementById('reportTemplateExportXlsxBtn').click();
    await waitFor(() => requests.some(req => req.url.startsWith('/api/payroll/export-xlsx?month=2026-06')), 'canonical payroll XLSX export request');
    await waitFor(() => /XLSX payroll export from canonical API/i.test(document.getElementById('reportTemplateStatus').textContent), 'canonical payroll export completion');

    assert.equal(requests.some(req => req.url === '/api/reports/table/export-csv'), false);
    assert.equal(requests.some(req => req.url === '/api/reports/table/export-xlsx'), false);
    assert.equal(requests.some(req => req.url === '/api/reports' && req.options.method === 'POST'), false);
    assert.equal(requests.some(req => req.url.startsWith('/api/staff/schedule')), false);
    assert.equal(requests.some(req => req.url.startsWith('/api/staff/attendance')), false);
    window.close();
});

test('payroll report template keeps legacy advance columns labeled as ZRS', async () => {
    const { window } = await setupReportsDom({
        backendTemplates: [{
            id: 701,
            code: 'legacy-payroll-template',
            title: 'Legacy payroll template',
            category: 'HR',
            layout: 'payroll',
            source: 'backend',
            defaultReport: { type: 'expense', category: 'ЗП', hashtag: 'table-payroll', amountColumn: 'total' },
            columns: [
                { key: 'date', label: 'Дата', type: 'date' },
                { key: 'advance', label: 'Аванси', type: 'number' },
                { key: 'total', label: 'До виплати', type: 'number' }
            ],
            rows: [{ date: '2026-06-28', advance: '100', total: '500' }]
        }]
    });
    const document = window.document;
    const picker = document.getElementById('reportTemplatePicker');
    picker.value = 'legacy-payroll-template';
    picker.dispatchEvent(new window.Event('change', { bubbles: true }));
    await waitFor(() => /Legacy payroll template/.test(document.getElementById('reportSheetTitle').textContent), 'legacy payroll template switch');

    assert.match(document.getElementById('reportSheetTable').textContent, /ЗРС/);
    assert.doesNotMatch(document.getElementById('reportSheetTable').textContent, /Аванси/);
    assert.equal(document.getElementById('reportTemplateSaveBtn').disabled, true);
    window.close();
});

test('canonical Reports payroll projection replaces legacy staff reconciliation writes', async () => {
    const { window, requests } = await setupReportsDom();
    const document = window.document;

    const picker = document.getElementById('reportTemplatePicker');
    picker.value = 'payroll-staff';
    picker.dispatchEvent(new window.Event('change', { bubbles: true }));
    await waitFor(() => /payroll/i.test(document.getElementById('reportSheetTitle').textContent), 'payroll template switch');

    assert.equal(document.getElementById('reportTemplateSaveBtn').disabled, true);
    assert.equal(document.getElementById('reportTemplateCloseBtn').disabled, true);
    assert.match(document.getElementById('reportSheetSummary').textContent, /Payroll read-only|Canonical API/i);

    assert.equal(requests.some(req => req.url === '/api/reports' && req.options.method === 'POST'), false);
    assert.equal(requests.some(req => req.url === '/api/reports/table/export-csv'), false);
    assert.equal(requests.some(req => req.url.startsWith('/api/staff/schedule')), false);
    assert.equal(requests.some(req => req.url.startsWith('/api/staff/attendance')), false);
    window.close();
});

test('legacy Reports payroll reconciliation stored canonical staff id with display snapshot is obsolete', async () => {
    const reportsPage = fs.readFileSync(path.join(ROOT, 'js/reports-page.js'), 'utf8');
    assert.match(reportsPage, /reportsPayrollDeprecatedMessage/);
    assert.match(reportsPage, /canonical Payroll API/);
    assert.match(reportsPage, /api\/payroll\/export/);
    return;
    const { window, requests } = await setupReportsDom();
    const document = window.document;

    const picker = document.getElementById('reportTemplatePicker');
    picker.value = 'payroll-staff';
    picker.dispatchEvent(new window.Event('change', { bubbles: true }));
    await waitFor(() => /payroll/i.test(document.getElementById('reportSheetTitle').textContent), 'payroll template switch');

    const staffSelect = document.querySelector('[data-row-index="0"][data-column-key="employee"][data-staff-field="true"]');
    assert.ok(staffSelect);
    const date = document.querySelector('[data-row-index="0"][data-column-key="date"]');
    date.value = '2026-06-28';
    date.dispatchEvent(new window.Event('input', { bubbles: true }));
    staffSelect.value = '42';
    staffSelect.dispatchEvent(new window.Event('input', { bubbles: true }));

    const hours = document.querySelector('[data-row-index="0"][data-column-key="hours"]');
    const total = document.querySelector('[data-row-index="0"][data-column-key="total"]');
    hours.value = '7';
    total.value = '1200';
    [hours, total].forEach(input => input.dispatchEvent(new window.Event('input', { bubbles: true })));
    await waitFor(() => document.getElementById('reportSheetSummary').textContent.includes('Review'), 'payroll review summary');

    document.getElementById('reportTemplateExportCsvBtn').click();
    await waitFor(() => requests.some(req => req.url === '/api/reports/table/export-csv'), 'payroll CSV export request');
    const exportRequest = requests.find(req => req.url === '/api/reports/table/export-csv');
    const exportBody = JSON.parse(exportRequest.options.body);
    assert.equal(exportBody.reportTableTemplate.rows[0].planned_hours, 8.5);
    assert.equal(exportBody.reportTableTemplate.rows[0].planned_start, '09:00');
    assert.equal(exportBody.reportTableTemplate.rows[0].planned_end, '20:00');
    assert.equal(exportBody.reportTableTemplate.rows[0].clock_in, '13:30');
    assert.equal(exportBody.reportTableTemplate.rows[0].clock_out, '21:00');
    assert.equal(exportBody.reportTableTemplate.rows[0].late_minutes, 30);
    assert.equal(exportBody.reportTableTemplate.rows[0].early_leave_minutes, 45);
    assert.equal(exportBody.reportTableTemplate.rows[0].overtime_minutes, 20);
    assert.equal(exportBody.reportTableTemplate.payrollReconciliation.totals.planned, 8.5);

    document.getElementById('reportTemplateSaveBtn').click();
    await waitFor(() => requests.some(req => req.url === '/api/reports' && req.options.method === 'POST'), 'payroll report create request');

    const createRequest = requests.find(req => req.url === '/api/reports' && req.options.method === 'POST');
    const body = JSON.parse(createRequest.options.body);
    const row = body.rawData.reportTableTemplate.rows[0];
    assert.equal(row.employee, 'Оля Коваленко');
    assert.equal(row.employee_staff_id, '42');
    assert.equal(row.staff_id, '42');
    assert.equal(row.display_snapshot, 'Оля Коваленко');
    assert.equal(row.role_snapshot, 'animator');
    assert.equal(row.role, 'animator');
    assert.equal(row.planned_hours, 8.5);
    assert.equal(row.actual_hours, 7.5);
    assert.equal(row.paid_hours, 7);
    assert.deepEqual(row.planned_shift_ref, {
        source: 'staff_schedule',
        id: 700,
        hr_shift_id: 701,
        date: '2026-06-28',
        status: 'working',
        start: '09:00',
        end: '20:00'
    });
    assert.deepEqual(row.segment_refs, [7101, 7102]);
    assert.equal(row.primary_profession_key, 'reception');
    assert.equal(row.planned_allocation_source, 'schedule_planned_minutes');
    assert.equal(row.allocation_source, 'clock_interval');
    assert.equal(row.reconciliation_source, 'reports_rawData_payroll_reconciliation_v1');
    assert.equal(row.attendance_ref.time_record_id, 800);
    assert.equal(row.attendance_status, 'late+left_early+overtime');
    assert.deepEqual(row.attendance_events, ['late', 'left_early', 'overtime']);
    assert.equal(row.late_minutes, 30);
    assert.equal(row.early_leave_minutes, 45);
    assert.equal(row.overtime_minutes, 20);
    assert.equal(row.plan_source, 'hr_shift');
    assert.equal(row.reconciliation_status, 'needs_review');
    assert.ok(row.reconciliation_issues.includes('actual_paid_hours_mismatch'));
    assert.equal(body.rawData.reportTableTemplate.payrollReconciliation.status, 'needs_review');
    assert.equal(body.rawData.reportTableTemplate.reportQuality.status, 'needs_review');
    assert.equal(body.rawData.reportTableTemplate.reportQuality.blockingPolicy, 'informational_only_until_policy_confirmed');
    assert.equal(body.rawData.reportTableTemplate.reportQuality.issueCounts.payroll_actual_hours_mismatch, 1);
    assert.deepEqual(body.rawData.reportTableTemplate.payrollReconciliation.totals, {
        planned: 8.5,
        actual: 7.5,
        paid: 7,
        amount: 1200
    });
    assert.equal(body.amount, 1200);
});

test('legacy Reports payroll attendance ignored one-to-five minute legacy late status and warned on profession fallback is obsolete', async () => {
    const reportsPage = fs.readFileSync(path.join(ROOT, 'js/reports-page.js'), 'utf8');
    assert.match(reportsPage, /Payroll read-only/);
    assert.match(reportsPage, /loadPayrollReconciliationSources/);
    return;
    const { window, requests } = await setupReportsDom({
        scheduleData: [],
        attendanceData: [{
            staff_id: 42,
            date: '2026-06-28',
            time_record_id: 801,
            clock_in: '2026-06-28T06:05:00.000Z',
            clock_out: '2026-06-28T15:00:00.000Z',
            planned_start: '09:00',
            planned_end: '18:00',
            late_minutes: 5,
            early_leave_minutes: 30,
            overtime_minutes: 0,
            total_worked_minutes: 505,
            time_status: 'late',
            plan_source: 'profession_card',
            plan_warning: { message: 'План дня взято з картки основної професії' },
            attendance_source: 'hr_time_records'
        }]
    });
    const document = window.document;
    const picker = document.getElementById('reportTemplatePicker');
    picker.value = 'payroll-staff';
    picker.dispatchEvent(new window.Event('change', { bubbles: true }));
    await waitFor(() => /payroll/i.test(document.getElementById('reportSheetTitle').textContent), 'payroll template switch');

    const date = document.querySelector('[data-row-index="0"][data-column-key="date"]');
    date.value = '2026-06-28';
    date.dispatchEvent(new window.Event('input', { bubbles: true }));
    const staff = document.querySelector('[data-row-index="0"][data-column-key="employee"][data-staff-field="true"]');
    staff.value = '42';
    staff.dispatchEvent(new window.Event('input', { bubbles: true }));
    const total = document.querySelector('[data-row-index="0"][data-column-key="total"]');
    total.value = '100';
    total.dispatchEvent(new window.Event('input', { bubbles: true }));

    document.getElementById('reportTemplateSaveBtn').click();
    await waitFor(() => requests.some(req => req.url === '/api/reports' && req.options.method === 'POST'), 'fallback payroll save');
    const request = requests.find(req => req.url === '/api/reports' && req.options.method === 'POST');
    const table = JSON.parse(request.options.body).rawData.reportTableTemplate;
    const row = table.rows[0];

    assert.equal(row.late_minutes, 0);
    assert.equal(row.early_leave_minutes, 30);
    assert.deepEqual(row.attendance_events, ['left_early']);
    assert.equal(row.attendance_status, 'left_early');
    assert.equal(row.plan_source, 'profession_card');
    assert.match(row.plan_warning, /картки основної професії/);
    assert.ok(row.reconciliation_issues.includes('profession_card_fallback'));
    assert.equal(table.reportQuality.issueCounts.payroll_profession_card_fallback, 1);
    window.close();
});

test('legacy Reports payroll workspace ignored allocation overtime as an attendance event is obsolete', async () => {
    const reportsPage = fs.readFileSync(path.join(ROOT, 'js/reports-page.js'), 'utf8');
    assert.match(reportsPage, /isPayrollTableState/);
    assert.match(reportsPage, /Use canonical Payroll API\/export/);
    return;
    const { window, requests } = await setupReportsDom({
        scheduleData: [{
            id: 810,
            staff_id: 42,
            date: '2026-06-28',
            status: 'working',
            shift_start: '09:00',
            shift_end: '18:00',
            hr_shift_id: 811,
            primary_profession_key: 'reception',
            planned_minutes: 540,
            segments: [
                { id: 8111, professionKey: 'reception', shiftStart: '09:00', shiftEnd: '18:00', breakMinutes: 0, additionalProfessionKeys: [] }
            ]
        }],
        attendanceData: [{
            staff_id: 42,
            date: '2026-06-28',
            time_record_id: 812,
            clock_in: '2026-06-28T05:55:00.000Z',
            clock_out: '2026-06-28T15:00:00.000Z',
            planned_start: '09:00',
            planned_end: '18:00',
            late_minutes: 0,
            early_leave_minutes: 0,
            overtime_minutes: 0,
            allocation_overtime_minutes: 5,
            allocationOvertimeMinutes: 5,
            total_worked_minutes: 545,
            time_status: 'present',
            plan_source: 'hr_shift',
            attendance_source: 'hr_time_records',
            allocation_source: 'clock_interval',
            attendance_facts: {
                lateMinutes: 0,
                earlyLeaveMinutes: 0,
                overtimeMinutes: 0
            }
        }]
    });
    const document = window.document;
    const picker = document.getElementById('reportTemplatePicker');
    picker.value = 'payroll-staff';
    picker.dispatchEvent(new window.Event('change', { bubbles: true }));
    await waitFor(() => /payroll/i.test(document.getElementById('reportSheetTitle').textContent), 'payroll template switch');

    const date = document.querySelector('[data-row-index="0"][data-column-key="date"]');
    date.value = '2026-06-28';
    date.dispatchEvent(new window.Event('input', { bubbles: true }));
    const staff = document.querySelector('[data-row-index="0"][data-column-key="employee"][data-staff-field="true"]');
    staff.value = '42';
    staff.dispatchEvent(new window.Event('input', { bubbles: true }));
    const total = document.querySelector('[data-row-index="0"][data-column-key="total"]');
    total.value = '100';
    total.dispatchEvent(new window.Event('input', { bubbles: true }));

    document.getElementById('reportTemplateSaveBtn').click();
    await waitFor(() => requests.some(req => req.url === '/api/reports' && req.options.method === 'POST'), 'allocation overtime payroll save');
    const request = requests.find(req => req.url === '/api/reports' && req.options.method === 'POST');
    const table = JSON.parse(request.options.body).rawData.reportTableTemplate;
    const row = table.rows[0];

    assert.equal(row.overtime_minutes, 0);
    assert.deepEqual(row.attendance_events, []);
    assert.equal(row.attendance_status, 'completed');
    assert.equal(row.attendance_ref.overtime_minutes, 0);
    window.close();
});

test('legacy Reports payroll planned hours preferred segments over envelope and kept legacy fallback is obsolete', async t => {
    const reportsPage = fs.readFileSync(path.join(ROOT, 'js/reports-page.js'), 'utf8');
    assert.match(reportsPage, /Payroll read-only/);
    assert.match(reportsPage, /canonical API/);
    return;
    await t.test('adjacent segments sum without duplicating an additional role', async () => {
        const context = await createPayrollReportForSchedule([{
            id: 720,
            staff_id: 42,
            date: '2026-06-28',
            status: 'working',
            shift_start: '09:00',
            shift_end: '20:00',
            hr_shift_id: 721,
            primaryProfessionKey: 'reception',
            segments: [
                { id: 7201, professionKey: 'reception', shiftStart: '09:00', shiftEnd: '13:00', breakMinutes: 0, additionalProfessionKeys: ['manager'] },
                { id: 7202, professionKey: 'manager', shiftStart: '13:00', shiftEnd: '20:00', breakMinutes: 0, additionalProfessionKeys: [] }
            ]
        }]);
        const row = context.body.rawData.reportTableTemplate.rows[0];
        assert.equal(row.planned_hours, 11);
        assert.deepEqual(row.segment_refs, [7201, 7202]);
        assert.equal(row.planned_allocation_source, 'schedule_segments');
        context.window.close();
    });

    await t.test('gap and segment break are excluded from paid planned hours', async () => {
        const context = await createPayrollReportForSchedule([{
            id: 730,
            staff_id: 42,
            date: '2026-06-28',
            status: 'working',
            shift_start: '09:00',
            shift_end: '20:00',
            hr_shift_id: 731,
            profession_key: 'reception',
            segments: [
                { id: 7301, profession_key: 'reception', planned_start: '09:00', planned_end: '13:00', break_minutes: 30, additional_profession_keys: ['manager'] },
                { id: 7302, profession_key: 'manager', planned_start: '15:00', planned_end: '20:00', break_minutes: 0 }
            ]
        }]);
        const reconciliation = context.body.rawData.reportTableTemplate.payrollReconciliation;
        assert.equal(reconciliation.rows[0].planned_hours, 8.5);
        assert.equal(reconciliation.totals.planned, 8.5);
        context.window.close();
    });

    await t.test('camelCase planned minutes take priority over segment and envelope fallbacks', async () => {
        const context = await createPayrollReportForSchedule([{
            id: 735,
            staff_id: 42,
            date: '2026-06-28',
            status: 'working',
            shift_start: '09:00',
            shift_end: '20:00',
            hr_shift_id: 736,
            plannedMinutes: 420,
            segments: [
                { id: 7351, professionKey: 'reception', shiftStart: '09:00', shiftEnd: '13:00', breakMinutes: 0 },
                { id: 7352, professionKey: 'manager', shiftStart: '15:00', shiftEnd: '20:00', breakMinutes: 0 }
            ]
        }]);
        const row = context.body.rawData.reportTableTemplate.rows[0];
        assert.equal(row.planned_hours, 7);
        assert.equal(row.planned_allocation_source, 'schedule_planned_minutes');
        context.window.close();
    });

    await t.test('legacy single shift without segment data still uses envelope', async () => {
        const context = await createPayrollReportForSchedule([{
            id: 740,
            staff_id: 42,
            date: '2026-06-28',
            status: 'working',
            shift_start: '10:00',
            shift_end: '18:00',
            hr_shift_id: 741,
            profession_key: 'animator'
        }]);
        const row = context.body.rawData.reportTableTemplate.rows[0];
        assert.equal(row.planned_hours, 8);
        assert.deepEqual(row.segment_refs, []);
        assert.equal(row.planned_allocation_source, 'legacy_envelope');
        context.window.close();
    });
});

test('legacy Reports payroll report workspace no longer depends on staff options API', async () => {
    const { window, requests } = await setupReportsDom({ staffApiFails: true });
    const document = window.document;

    const picker = document.getElementById('reportTemplatePicker');
    picker.value = 'payroll-staff';
    picker.dispatchEvent(new window.Event('change', { bubbles: true }));
    await waitFor(() => /payroll/i.test(document.getElementById('reportSheetTitle').textContent), 'payroll template switch without staff options');

    assert.equal(document.getElementById('reportTemplateSaveBtn').disabled, true);
    assert.match(document.getElementById('reportSheetSummary').textContent, /Payroll read-only|Canonical API/i);

    assert.equal(requests.some(req => req.url === '/api/reports' && req.options.method === 'POST'), false);
    assert.equal(requests.some(req => req.url.startsWith('/api/staff/schedule')), false);
    assert.equal(requests.some(req => req.url.startsWith('/api/staff/attendance')), false);
    window.close();
});

test('legacy Reports payroll report workspace kept working when staff options API was unavailable is obsolete', async () => {
    const reportsPage = fs.readFileSync(path.join(ROOT, 'js/reports-page.js'), 'utf8');
    assert.match(reportsPage, /reportsPayrollDeprecatedMessage/);
    return;
    const { window, requests } = await setupReportsDom({ staffApiFails: true });
    const document = window.document;

    const picker = document.getElementById('reportTemplatePicker');
    picker.value = 'payroll-staff';
    picker.dispatchEvent(new window.Event('change', { bubbles: true }));
    await waitFor(() => /payroll/i.test(document.getElementById('reportSheetTitle').textContent), 'payroll template switch without staff options');

    const staffSelect = document.querySelector('[data-row-index="0"][data-column-key="employee"][data-staff-field="true"]');
    assert.ok(staffSelect);
    assert.match(staffSelect.textContent, /Оберіть працівника/);
    assert.equal([...staffSelect.options].some(option => option.value === '42'), false);
    assert.match(document.getElementById('reportSheetSummary').textContent, /snapshot fallback/);

    const total = document.querySelector('[data-row-index="0"][data-column-key="total"]');
    total.value = '500';
    total.dispatchEvent(new window.Event('input', { bubbles: true }));

    document.getElementById('reportTemplateSaveBtn').click();
    await waitFor(() => requests.some(req => req.url === '/api/reports' && req.options.method === 'POST'), 'fallback payroll report create request');

    const createRequest = requests.find(req => req.url === '/api/reports' && req.options.method === 'POST');
    const body = JSON.parse(createRequest.options.body);
    const row = body.rawData.reportTableTemplate.rows[0];
    assert.equal(row.employee, '');
    assert.equal(row.employee_staff_id, '');
    assert.equal(body.rawData.reportTableTemplate.reportQuality.status, 'needs_review');
    assert.equal(body.rawData.reportTableTemplate.reportQuality.issueCounts.staff_options_unavailable, 1);
    assert.equal(body.rawData.reportTableTemplate.reportQuality.issueCounts.payroll_employee_missing, 1);
    assert.equal(body.amount, 500);
});

test('reports API keeps payroll templates deprecated read-only without a new report schema', () => {
    const reportsRoute = fs.readFileSync(path.join(ROOT, 'routes/reports.js'), 'utf8');
    assert.match(reportsRoute, /function normalizeReportRawPayload/);
    assert.match(reportsRoute, /function normalizePayrollRows/);
    assert.match(reportsRoute, /reportsPayrollReadOnlyPayload/);
    assert.match(reportsRoute, /REPORTS_PAYROLL_READ_ONLY/);
    assert.match(reportsRoute, /canonical_payroll_service_required/);
    assert.match(reportsRoute, /\/api\/payroll\/export/);
    assert.match(reportsRoute, /\/api\/payroll\/export-xlsx/);
    assert.doesNotMatch(reportsRoute, /reports_rawData_payroll_reconciliation_v1/);
    assert.doesNotMatch(reportsRoute, /ALTER TABLE reports[\s\S]*staff_id|CREATE TABLE IF NOT EXISTS payroll_reconciliation/i);
});

test('standard park report totals dar subtotal and locks after close', async () => {
    const { window, requests } = await setupReportsDom();
    const document = window.document;

    const picker = document.getElementById('reportTemplatePicker');
    picker.value = 'park-standard-report';
    picker.dispatchEvent(new window.Event('change', { bubbles: true }));
    await waitFor(() => /Стандартний/.test(document.getElementById('reportSheetTitle').textContent), 'standard template switch');

    assert.equal(document.getElementById('reportTemplatePicker').value, 'park-standard-report');
    const headers = [...document.querySelectorAll('#reportSheetTable thead th .rpt-sheet-th-content > span:first-child')]
        .map(th => th.textContent.trim())
        .slice(0, 5);
    assert.deepEqual(headers, ['Дата', 'Категорія', 'Документ', 'Сума', 'Коментар']);

    const date = document.querySelector('[data-row-index="0"][data-column-key="date"]');
    const category = document.querySelector('[data-row-index="0"][data-column-key="category"]');
    const documentType = document.querySelector('[data-row-index="0"][data-column-key="document"]');
    const amount = document.querySelector('[data-row-index="0"][data-column-key="amount"]');
    date.value = '2026-05-23';
    category.value = 'дар';
    documentType.value = 'чек';
    amount.value = '120';
    [date, category, documentType, amount].forEach(input => input.dispatchEvent(new window.Event('input', { bubbles: true })));

    const category2 = document.querySelector('[data-row-index="1"][data-column-key="category"]');
    const amount2 = document.querySelector('[data-row-index="1"][data-column-key="amount"]');
    category2.value = 'афіша';
    amount2.value = '80';
    [category2, amount2].forEach(input => input.dispatchEvent(new window.Event('input', { bubbles: true })));

    const summary = document.getElementById('reportSheetSummary').textContent;
    assert.match(summary, /Ітого/);
    assert.match(summary, /Ітого ДАР/);
    assert.match(summary, /200/);
    assert.match(summary, /120/);

    document.getElementById('reportTemplateCloseBtn').click();
    await waitFor(() => requests.some(req => req.url === '/api/reports/table/close'), 'report close request');

    const closeRequest = requests.find(req => req.url === '/api/reports/table/close');
    const body = JSON.parse(closeRequest.options.body);
    assert.equal(body.tableJson.reportTableTemplate.defaultReport.amountColumn, 'amount');
    assert.equal(body.tableJson.reportTableTemplate.defaultReport.subtotalRules[0].categoryValue, 'дар');
    assert.equal(body.amount, 200);

    await waitFor(() => /Закритий/.test(document.getElementById('reportSheetModeChip').textContent), 'closed lock render');
    assert.match(document.getElementById('reportsTableBody').textContent, /#777/);
    assert.equal(document.getElementById('reportTemplateAddRowBtn').disabled, true);
    assert.equal(document.getElementById('reportTemplateAddColumnBtn').disabled, true);
    assert.equal(document.getElementById('reportTemplateCloseBtn').disabled, true);
    assert.equal(document.getElementById('reportTemplateExportCsvBtn').disabled, false);
    assert.equal(document.querySelector('.rpt-sheet-input').disabled, true);
});

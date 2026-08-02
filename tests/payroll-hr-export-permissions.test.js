'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { canUseAction, requireAction } = require('../middleware/auth');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function runActionGuards(user, actions) {
    let cursor = 0;
    let handlerCalled = false;
    let response = null;
    const req = { user };
    const res = {
        status(statusCode) {
            response = { statusCode };
            return this;
        },
        json(payload) {
            response = { ...response, payload };
            return this;
        }
    };
    const next = () => {
        if (cursor === actions.length) {
            handlerCalled = true;
            return;
        }
        requireAction(actions[cursor++])(req, res, next);
    };
    next();
    return { handlerCalled, response };
}

test('payroll read and export require their separate capabilities', () => {
    const accountant = { id: 1, role: 'accountant' };
    const manager = { id: 2, role: 'manager' };
    const creator = { id: 3, role: 'creator' };

    assert.equal(canUseAction(accountant, 'view_payroll'), true, 'accountant keeps payroll read');
    assert.equal(canUseAction(accountant, 'export_data'), false, 'accountant does not receive export by payroll read');
    assert.deepEqual(runActionGuards(accountant, ['view_payroll']), { handlerCalled: true, response: null });
    assert.deepEqual(runActionGuards(accountant, ['view_payroll', 'export_data']), {
        handlerCalled: false,
        response: { statusCode: 403, payload: { error: 'Insufficient permissions' } }
    });

    assert.equal(canUseAction(manager, 'view_payroll'), false, 'export_data does not grant payroll read');
    assert.equal(canUseAction(manager, 'export_data'), true, 'manager still has generic export capability');
    assert.deepEqual(runActionGuards(manager, ['view_payroll', 'export_data']), {
        handlerCalled: false,
        response: { statusCode: 403, payload: { error: 'Insufficient permissions' } }
    });

    assert.equal(canUseAction(creator, 'view_payroll'), true);
    assert.equal(canUseAction(creator, 'export_data'), true);
    assert.deepEqual(runActionGuards(creator, ['view_payroll', 'export_data']), { handlerCalled: true, response: null });
});

test('explicit export_data deny overrides a role default before an export handler', () => {
    const creatorWithDeniedExport = {
        id: 4,
        role: 'creator',
        action_denylist: ['export_data']
    };

    assert.equal(canUseAction(creatorWithDeniedExport, 'view_payroll'), true);
    assert.equal(canUseAction(creatorWithDeniedExport, 'export_data'), false);
    assert.deepEqual(runActionGuards(creatorWithDeniedExport, ['view_payroll', 'export_data']), {
        handlerCalled: false,
        response: { statusCode: 403, payload: { error: 'Insufficient permissions' } }
    });
});

test('HR report export requires its HR capability and export_data', () => {
    const security = { id: 5, role: 'security' };
    const creator = { id: 6, role: 'creator' };

    assert.equal(canUseAction(security, 'hr.reports.export'), true);
    assert.equal(canUseAction(security, 'export_data'), false);
    assert.deepEqual(runActionGuards(security, ['hr.reports.export', 'export_data']), {
        handlerCalled: false,
        response: { statusCode: 403, payload: { error: 'Insufficient permissions' } }
    });

    assert.equal(canUseAction(creator, 'hr.reports.export'), true);
    assert.equal(canUseAction(creator, 'export_data'), true);
    assert.deepEqual(runActionGuards(creator, ['hr.reports.export', 'export_data']), { handlerCalled: true, response: null });
});

test('payroll and HR export routes place export_data guards before service, database, and workbook work', () => {
    const payrollRoutes = read('routes/payroll.js');
    const hrRoutes = read('routes/hr.js');

    assert.match(payrollRoutes, /router\.get\('\/export', requireAction\('view_payroll'\), requireAction\('export_data'\), async \(req, res\) => \{[\s\S]*?await getSalaryReport\(/);
    assert.match(payrollRoutes, /router\.get\('\/export-xlsx', requireAction\('view_payroll'\), requireAction\('export_data'\), async \(req, res\) => \{[\s\S]*?await getSalaryReport\([\s\S]*?new ExcelJS\.Workbook\(\)/);
    assert.match(hrRoutes, /router\.get\('\/report\/export', requireAction\('export_data'\), async \(req, res\) => \{[\s\S]*?await pool\.query\(/);
    assert.match(hrRoutes, /router\.post\('\/attendance-documents\/pdf', requireAction\('hr\.reports\.export'\), requireAction\('export_data'\), async \(req, res\) => \{[\s\S]*?await buildHrAttendanceDocumentSnapshot\(/);
    assert.match(hrRoutes, /router\.get\('\/attendance-document-jobs\/:id\/pdf', requireAction\('export_data'\), async \(req, res\) => \{[\s\S]*?await getHrAttendanceDocumentJobPdf\(/);
});

test('permission registry and frontend keep payroll and HR export controls fail-closed', () => {
    const registry = read('config/permissionRegistry.js');
    const financePage = read('js/finance-page.js');
    const reportsPage = read('js/reports-page.js');
    const hrPage = read('js/hr-page.js');

    assert.match(registry, /api\('routes\/payroll\.js', '\/api\/payroll\/export and \/export-xlsx', 'export_data'\)/);
    assert.match(registry, /api\('routes\/hr\.js', '\/api\/hr\/report\/export and attendance PDF exports', 'export_data'\)/);
    assert.match(financePage, /function financeCanExportPayroll\(\)[\s\S]*?financeCanUsePayrollAction\('view_payroll'\)[\s\S]*?financeCanUsePayrollAction\('export_data'\)/);
    assert.match(reportsPage, /function canExportCanonicalPayroll\(\)[\s\S]*?canAccess\('view_payroll'\)[\s\S]*?canAccess\('export_data'\)/);
    assert.match(hrPage, /function canExportHrReports\(\)[\s\S]*?canUseAction\('export_data'\)/);
    assert.match(hrPage, /function canExportHrReports\(\)[\s\S]*?canUseHrCapability\('hr\.reports\.export'\)/);
    assert.match(hrPage, /async function generateHrPrintPreview\(\) \{[\s\S]*?if \(!canExportHrReports\(\)\) \{/);
});

test('staff schedule XLSX export requires schedule view and export_data before workbook work', () => {
    const instructor = { id: 7, role: 'instructor' };
    const manager = { id: 8, role: 'manager' };
    const deniedManager = { id: 9, role: 'manager', action_denylist: ['export_data'] };

    assert.equal(canUseAction(instructor, 'hr.schedule.view'), true);
    assert.equal(canUseAction(instructor, 'export_data'), false);
    assert.deepEqual(runActionGuards(instructor, ['hr.schedule.view', 'export_data']), {
        handlerCalled: false,
        response: { statusCode: 403, payload: { error: 'Insufficient permissions' } }
    });

    assert.equal(canUseAction(manager, 'hr.schedule.view'), true);
    assert.equal(canUseAction(manager, 'export_data'), true);
    assert.deepEqual(runActionGuards(manager, ['hr.schedule.view', 'export_data']), { handlerCalled: true, response: null });

    assert.equal(canUseAction(deniedManager, 'export_data'), false);
    assert.deepEqual(runActionGuards(deniedManager, ['hr.schedule.view', 'export_data']), {
        handlerCalled: false,
        response: { statusCode: 403, payload: { error: 'Insufficient permissions' } }
    });

    const staffRoutes = read('routes/staff.js');
    const registry = read('config/permissionRegistry.js');
    const staffPage = read('js/staff-page.js');
    assert.match(staffRoutes, /router\.post\('\/schedule\/export-xlsx', requireAction\('hr\.schedule\.view'\), requireAction\('export_data'\), async \(req, res\) => \{[\s\S]*?await buildStaffScheduleWorkbookBuffer\(/);
    assert.match(registry, /api\('routes\/staff\.js', '\/api\/staff\/schedule\/export-xlsx', 'export_data'\)/);
    assert.match(staffPage, /StaffState\.canExportSchedule = StaffState\.canViewSchedule && canUseStaffCapability\('export_data'\);/);
    assert.match(staffPage, /async function handleExcelExport\(\) \{[\s\S]*?if \(!StaffState\.canExportSchedule\) \{/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ACTION_PERMISSION_BY_KEY } = require('../config/permissionRegistry');
const { resolveCapability } = require('../services/accountAccessPolicy');

const ROOT = path.resolve(__dirname, '..');
const HR_CAPABILITIES = [
    'hr.today.view', 'hr.schedule.view', 'hr.schedule.manage',
    'hr.staff.view', 'hr.staff.manage', 'hr.reports.view',
    'hr.reports.export', 'hr.payroll.view', 'hr.payroll.manage'
];

function allowed(user, capability) {
    return resolveCapability(user, capability, { type: 'action' }).allowed;
}

test('registry contains the complete granular HR capability contract', () => {
    assert.deepEqual(HR_CAPABILITIES.filter(key => !ACTION_PERMISSION_BY_KEY[key]), []);
    for (const key of HR_CAPABILITIES) {
        assert.equal(ACTION_PERMISSION_BY_KEY[key].deprecated, false, `${key} must be active`);
    }
});

test('Admin can keep Today and Schedule while Reports is explicitly denied', () => {
    const admin = {
        role: 'admin',
        action_allowlist: ['hr.today.view', 'hr.schedule.view'],
        action_denylist: ['hr.reports.view', 'hr.reports.export']
    };
    assert.equal(allowed(admin, 'hr.today.view'), true);
    assert.equal(allowed(admin, 'hr.schedule.view'), true);
    assert.equal(allowed(admin, 'hr.reports.view'), false);
    assert.equal(allowed(admin, 'hr.reports.export'), false);
});

test('HR, Accountant, and Security presets do not cross payroll/manage boundaries', () => {
    const hr = { role: 'hr' };
    assert.equal(allowed(hr, 'hr.staff.manage'), true);
    assert.equal(allowed(hr, 'hr.payroll.view'), true);

    const accountant = { role: 'accountant' };
    assert.equal(allowed(accountant, 'hr.payroll.view'), true);
    assert.equal(allowed(accountant, 'hr.staff.view'), false);
    assert.equal(allowed(accountant, 'hr.reports.view'), false);

    const security = { role: 'security' };
    assert.equal(allowed(security, 'hr.today.view'), true);
    assert.equal(allowed(security, 'hr.schedule.view'), true);
    assert.equal(allowed(security, 'hr.reports.view'), true);
    assert.equal(allowed(security, 'hr.staff.manage'), false);
    assert.equal(allowed(security, 'hr.payroll.view'), false);
});

test('legacy explicit denies still constrain replacement HR capabilities', () => {
    const user = { role: 'admin', action_denylist: ['manage_staff', 'view_payroll'] };
    assert.equal(allowed(user, 'hr.schedule.manage'), false);
    assert.equal(allowed(user, 'hr.staff.manage'), false);
    assert.equal(allowed(user, 'hr.payroll.view'), false);
});

test('sidebar and pulse links preserve the URL/hash to capability chain', () => {
    const sidebar = fs.readFileSync(path.join(ROOT, 'js', 'components', 'sidebar.js'), 'utf8');
    const switcher = fs.readFileSync(path.join(ROOT, 'js', 'hr-pulse-switcher.js'), 'utf8');
    const frontend = fs.readFileSync(path.join(ROOT, 'js', 'hr-page.js'), 'utf8');

    assert.match(sidebar, /href: '\/hr'.*access: 'hr_page'.*activeHashes: \['today', 'schedule', 'reports'\]/);
    assert.match(switcher, /capability: 'hr\.today\.view'[\s\S]*href: '\/hr#today'/);
    assert.match(switcher, /capability: 'hr\.schedule\.view'[\s\S]*href: '\/staff'/);
    assert.match(switcher, /capability: 'hr\.reports\.view'[\s\S]*href: '\/hr#reports'/);
    assert.match(frontend, /function requestedHrTarget\(\)[\s\S]*window\.location\.hash/);
    assert.match(frontend, /function resolveHrTabTarget\(rawTarget\)[\s\S]*if \(!canViewHrTab\(target\)[\s\S]*denied: true/);
    assert.match(frontend, /if \(options\.updateHash \|\| resolved\.alias\)[\s\S]*history\.replaceState/);
});

test('frontend and backend contain the tab, endpoint, export, and payroll-shaping guards', () => {
    const frontend = fs.readFileSync(path.join(ROOT, 'js', 'hr-page.js'), 'utf8');
    const switcher = fs.readFileSync(path.join(ROOT, 'js', 'hr-pulse-switcher.js'), 'utf8');
    const hrRoute = fs.readFileSync(path.join(ROOT, 'routes', 'hr.js'), 'utf8');
    const staffRoute = fs.readFileSync(path.join(ROOT, 'routes', 'staff.js'), 'utf8');

    assert.match(frontend, /reports:\s*'hr\.reports\.view'/);
    assert.match(frontend, /firstAllowedHrTab\(\)/);
    assert.match(frontend, /function canExportHrReports\(\)/);
    assert.match(frontend, /reportExport\.hidden = !canExportHrReports\(\)/);
    assert.match(switcher, /capability:\s*'hr\.reports\.view'/);
    assert.match(hrRoute, /function requireHrCapabilityContract/);
    assert.match(hrRoute, /routePath === '\/report\/export'.*hr\.reports\.export/s);
    assert.match(hrRoute, /shapeHrPayrollFields\(data, req\.user\)/);
    assert.match(hrRoute, /shapeHrStaffList\(/);
    assert.match(hrRoute, /HR_SCHEDULE_STAFF_FIELDS/);
    assert.match(hrRoute, /routePath === '\/kpi'.*'hr\.payroll\.view'/s);
    assert.match(staffRoute, /router\.get\('\/schedule', requireAction\('hr\.schedule\.view'\)/);
    assert.match(staffRoute, /router\.get\('\/payroll', requireAction\('hr\.payroll\.view'\)/);
});
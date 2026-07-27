const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    ACTION_PERMISSIONS,
    canUseAction,
    actionPermissionDecision
} = require('../middleware/auth');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const PAYROLL_ACTION_MATRIX = {
    view_payroll: ['creator', 'director', 'vice_director', 'hr', 'accountant'],
    manage_payroll_accrual: ['creator', 'director', 'vice_director', 'hr', 'accountant'],
    approve_payroll_installment: ['creator', 'director', 'vice_director', 'hr', 'accountant'],
    confirm_payroll_payment: ['creator', 'director', 'vice_director', 'hr', 'accountant'],
    reverse_payroll_payment: ['creator', 'director', 'accountant'],
    close_payroll_period: ['creator', 'director', 'accountant'],
    manage_payroll_rules: ['creator', 'director', 'hr', 'accountant']
};

const DENIED_BASE_ROLES = [
    'senior_manager',
    'manager',
    'admin',
    'security',
    'reception',
    'animator'
];

test('payroll actions expose the approved role matrix only', () => {
    for (const [action, expectedRoles] of Object.entries(PAYROLL_ACTION_MATRIX)) {
        assert.deepEqual(ACTION_PERMISSIONS[action], expectedRoles, `${action} backend matrix`);

        for (const role of expectedRoles) {
            assert.equal(canUseAction({ id: 1, username: `${role}.user`, role }, action), true, `${role} can ${action}`);
        }

        for (const role of DENIED_BASE_ROLES) {
            assert.equal(canUseAction({ id: 2, username: `${role}.user`, role }, action), false, `${role} cannot ${action}`);
        }
    }
});

test('payroll actions keep user allowlist and denylist overrides visible in decisions', () => {
    const allowedByOverride = {
        id: 10,
        username: 'override.manager',
        role: 'manager',
        action_allowlist: ['confirm_payroll_payment']
    };
    const deniedByOverride = {
        id: 11,
        username: 'director.denied',
        role: 'director',
        action_denylist: ['confirm_payroll_payment']
    };

    assert.equal(canUseAction(allowedByOverride, 'confirm_payroll_payment'), true);
    assert.deepEqual(actionPermissionDecision(allowedByOverride, 'confirm_payroll_payment'), {
        allowed: true,
        source: 'allowlist',
        action: 'confirm_payroll_payment'
    });

    assert.equal(canUseAction(deniedByOverride, 'confirm_payroll_payment'), false);
    assert.deepEqual(actionPermissionDecision(deniedByOverride, 'confirm_payroll_payment'), {
        allowed: false,
        source: 'denylist',
        action: 'confirm_payroll_payment'
    });
});

test('payroll API routes use endpoint-level action guards instead of broad role gates', () => {
    const payrollRoutes = read('routes/payroll.js');
    const hrRoutes = read('routes/hr.js');
    const financeRoutes = read('routes/finance.js');
    const backendAuth = read('middleware/auth.js');
    const frontendAuth = read('js/auth.js');

    assert.equal(/router\.use\(requireRole/.test(payrollRoutes), false, 'payroll route must not use one broad role gate');
    for (const action of Object.keys(PAYROLL_ACTION_MATRIX)) {
        assert.match(payrollRoutes + hrRoutes, new RegExp(`requireAction\\('${action}'\\)`), `${action} route guard exists`);
    }

    assert.match(payrollRoutes, /payments\/confirm', requireAction\('confirm_payroll_payment'\)/);
    assert.match(payrollRoutes, /payments\/:id\/reverse', requireAction\('reverse_payroll_payment'\)/);
    assert.match(payrollRoutes, /period\/close', requireAction\('close_payroll_period'\)/);
    assert.match(hrRoutes, /router\.use\(requireRole\(\.\.\.HR_VIEW_ROLES\)\)/, 'HR router still has its page-level gate');
    assert.match(financeRoutes, /router\.use\(requireRole\('creator', 'director', 'accountant'\)\)/, 'Finance router remains finance-only');
    assert.match(backendAuth, /const HR_PAGE_ACCESS = \[\.\.\.MANAGER_UP, 'hr', 'admin', 'security'\]/);
    assert.match(frontendAuth, /const _HR_PAGE_ACCESS = \[\.\.\._MANAGER_UP, 'hr', 'admin', 'security'\]/);
    assert.doesNotMatch(backendAuth.match(/const HR_PAGE_ACCESS = .*/)?.[0] || '', /accountant/);
    assert.doesNotMatch(frontendAuth.match(/const _HR_PAGE_ACCESS = .*/)?.[0] || '', /accountant/);
});

test('payroll service and frontend use action checks for payment workflow', () => {
    const payrollService = read('services/payroll.js');
    const backendAuth = read('middleware/auth.js');
    const frontendAuth = read('js/auth.js');
    const hrPage = read('js/hr-page.js');
    const financePage = read('js/finance-page.js');

    assert.match(payrollService, /canUseAction\(user, action\)/);
    assert.match(payrollService, /assertPayrollActionPermission\(user, 'confirm_payroll_payment'/);
    assert.match(payrollService, /assertPayrollActionPermission\(user, 'reverse_payroll_payment'/);
    assert.doesNotMatch(payrollService, /PAYROLL_PAYMENT_ROLES/);

    for (const action of Object.keys(PAYROLL_ACTION_MATRIX)) {
        assert.match(backendAuth, new RegExp(`${action}:`), `${action} backend action`);
        assert.match(frontendAuth, new RegExp(`${action}:`), `${action} frontend action`);
    }

    assert.match(frontendAuth, /window\.canUseAction = canUseAction/);
    assert.match(hrPage, /hrCanUsePayrollAction\('manage_payroll_accrual'\)/);
    assert.match(hrPage, /hrCanUsePayrollAction\('reverse_payroll_payment'\)/);
    assert.match(financePage, /financeCanUsePayrollAction\('manage_payroll_rules'\)/);
    assert.match(financePage, /financeCanUsePayrollAction\('manage_payroll_accrual'\)/);
});

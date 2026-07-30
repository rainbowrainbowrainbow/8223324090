const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    ACTION_PERMISSIONS,
    canUseAction,
    actionPermissionDecision,
    PAGE_ACCESS
} = require('../middleware/auth');
const { ACTION_PERMISSION_BY_KEY } = require('../config/permissionRegistry');

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
    const allowedDecision = actionPermissionDecision(allowedByOverride, 'confirm_payroll_payment');
    assert.equal(allowedDecision.allowed, true);
    assert.equal(allowedDecision.source, 'explicit_allow');
    assert.equal(allowedDecision.sourceRole, null);
    assert.equal(allowedDecision.reason, 'listed_in_explicit_allow');
    assert.equal(allowedDecision.action, 'confirm_payroll_payment');

    assert.equal(canUseAction(deniedByOverride, 'confirm_payroll_payment'), false);
    const deniedDecision = actionPermissionDecision(deniedByOverride, 'confirm_payroll_payment');
    assert.equal(deniedDecision.allowed, false);
    assert.equal(deniedDecision.source, 'explicit_deny');
    assert.equal(deniedDecision.sourceRole, null);
    assert.equal(deniedDecision.reason, 'listed_in_explicit_deny');
    assert.equal(deniedDecision.action, 'confirm_payroll_payment');
});

test('payroll API routes use endpoint-level action guards instead of broad role gates', () => {
    const payrollRoutes = read('routes/payroll.js');
    const hrRoutes = read('routes/hr.js');
    const financeRoutes = read('routes/finance.js');
    const frontendAuth = read('js/auth.js');

    assert.equal(/router\.use\(requireRole/.test(payrollRoutes), false, 'payroll route must not use one broad role gate');
    for (const action of Object.keys(PAYROLL_ACTION_MATRIX)) {
        assert.match(payrollRoutes + hrRoutes, new RegExp(`requireAction\\('${action}'\\)`), `${action} route guard exists`);
    }

    assert.match(payrollRoutes, /payments\/confirm', requireAction\('confirm_payroll_payment'\)/);
    assert.match(payrollRoutes, /payments\/:id\/reverse', requireAction\('reverse_payroll_payment'\)/);
    assert.match(payrollRoutes, /period\/close', requireAction\('close_payroll_period'\)/);
    assert.match(hrRoutes, /router\.use\(requireHrCapabilityContract\)/, 'HR router uses the granular capability gate');
    assert.match(financeRoutes, /router\.use\(requireRole\('creator', 'director', 'accountant'\)\)/, 'Finance router remains finance-only');
    assert.deepEqual(PAGE_ACCESS['/hr'], [
        'creator', 'director', 'vice_director', 'senior_manager', 'manager', 'hr', 'admin', 'security'
    ]);
    assert.equal(PAGE_ACCESS['/hr'].includes('accountant'), false);
    assert.match(frontendAuth, /capabilityCatalog/);
});

test('payroll service and frontend use action checks for payment workflow', () => {
    const payrollService = read('services/payroll.js');
    const accountAccessPolicy = read('services/accountAccessPolicy.js');
    const frontendAuth = read('js/auth.js');
    const hrPage = read('js/hr-page.js');
    const financePage = read('js/finance-page.js');

    assert.match(payrollService, /canUseAction\(user, action\)/);
    assert.match(payrollService, /assertPayrollActionPermission\(user, 'confirm_payroll_payment'/);
    assert.match(payrollService, /assertPayrollActionPermission\(user, 'reverse_payroll_payment'/);
    assert.doesNotMatch(payrollService, /PAYROLL_PAYMENT_ROLES/);

    for (const action of Object.keys(PAYROLL_ACTION_MATRIX)) {
        assert.ok(ACTION_PERMISSION_BY_KEY[action], 'registry action: ' + action);
    }

    assert.match(accountAccessPolicy, /function resolveCapability/);
    assert.match(frontendAuth, /window\.canUseAction = canUseAction/);
    assert.match(hrPage, /hrCanUsePayrollAction\('manage_payroll_accrual'\)/);
    assert.match(hrPage, /hrCanUsePayrollAction\('reverse_payroll_payment'\)/);
    assert.match(financePage, /financeCanUsePayrollAction\('manage_payroll_rules'\)/);
    assert.match(financePage, /financeCanUsePayrollAction\('manage_payroll_accrual'\)/);
});

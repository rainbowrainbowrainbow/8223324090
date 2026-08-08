'use strict';

function freezeContract(contract) {
    return Object.freeze({
        ...contract,
        responseAssertion: Object.freeze({ ...(contract.responseAssertion || {}) })
    });
}

function pageContract(key, options = {}) {
    return freezeContract({
        key,
        type: 'page',
        frontendScenario: options.frontendScenario || 'sidebar/navigation decision',
        backendScenario: options.backendScenario || 'GET /api/auth/permissions page snapshot',
        canonicalUrl: options.canonicalUrl || key,
        directUrl: options.directUrl || options.canonicalUrl || key,
        allowExpectation: options.allowExpectation || 'explicit_allow_or_role_preset',
        denyExpectation: options.denyExpectation || 'explicit_deny_when_configurable',
        mutation: false,
        fixture: options.fixture || 'isolated-disposable-account',
        responseAssertion: {
            allowStatus: 200,
            denySource: options.configurable === false ? 'not_configurable' : 'explicit_deny',
            directUrlStatus: options.directUrlStatus || 'protected_or_public_static_shell'
        },
        configurable: options.configurable !== false,
        notes: options.notes || ''
    });
}

function actionContract(key, options = {}) {
    return freezeContract({
        key,
        type: 'action',
        frontendScenario: options.frontendScenario || 'capability-aware UI gate',
        backendScenario: options.backendScenario || 'real route guard plus /api/auth/permissions snapshot',
        allowExpectation: options.allowExpectation || 'explicit_allow_or_role_preset',
        denyExpectation: options.denyExpectation || 'explicit_deny_403_or_shaped_response',
        mutation: Boolean(options.mutation),
        fixture: options.fixture || 'isolated-disposable-account',
        responseAssertion: {
            allowStatus: options.allowStatus || 200,
            denyStatus: options.denyStatus || 403,
            denyBody: options.denyBody || 'permission-denied-or-shaped',
            source: options.source || 'explicit_allow_or_role_preset'
        },
        sensitive: Boolean(options.sensitive),
        testFiles: Object.freeze(options.testFiles || []),
        notes: options.notes || ''
    });
}

const PAGE_PERMISSION_TEST_CONTRACTS = Object.freeze({
    '/dashboard': pageContract('/dashboard', { configurable: false, notes: 'Authenticated universal shell, not a role-editor toggle.' }),
    '/': pageContract('/', { canonicalUrl: '/', directUrl: '/' }),
    '/maysternya-doli': pageContract('/maysternya-doli'),
    '/tasks': pageContract('/tasks'),
    '/chat': pageContract('/chat'),
    '/chat-settings': pageContract('/chat-settings'),
    '/center': pageContract('/center'),
    '/art': pageContract('/art'),
    '/content': pageContract('/content'),
    '/designer': pageContract('/designer'),
    '/designs': pageContract('/designs'),
    '/hermes-studio': pageContract('/hermes-studio'),
    '/graduation': pageContract('/graduation'),
    '/customers': pageContract('/customers'),
    '/staff': pageContract('/staff'),
    '/warehouse': pageContract('/warehouse'),
    '/training': pageContract('/training'),
    '/timeline-settings': pageContract('/timeline-settings'),
    '/booking-summary.html': pageContract('/booking-summary.html', { directUrl: '/booking-summary.html' }),
    '/demo': pageContract('/demo'),
    '/programs': pageContract('/programs'),
    '/hr': pageContract('/hr', { frontendScenario: 'sidebar + HR tab/hash decision' }),
    '/checkin': pageContract('/checkin'),
    '/finance': pageContract('/finance'),
    '/cashier-payments': pageContract('/cashier-payments'),
    '/accounting-deposits': pageContract('/accounting-deposits'),
    '/status': pageContract('/status'),
    '/guardian-ops': pageContract('/guardian-ops'),
    '/omni': pageContract('/omni'),
    '/copilot': pageContract('/copilot'),
    '/sound': pageContract('/sound'),
    '/afisha': pageContract('/afisha'),
    '/certificates': pageContract('/certificates'),
    '/certificates/new': pageContract('/certificates/new'),
    '/certificates/batch': pageContract('/certificates/batch'),
    '/sales-funnel': pageContract('/sales-funnel'),
    '/report-agent': pageContract('/report-agent'),
    '/reports': pageContract('/reports'),
    '/game': pageContract('/game', { configurable: false, notes: 'Personal/gamification surface, governed by session rules.' }),
    '/profile': pageContract('/profile', { configurable: false, notes: 'Self-service profile, governed by session ownership.' }),
    '/quiz': pageContract('/quiz', { configurable: false, notes: 'Personal/gamification surface, governed by session rules.' }),
    '/room': pageContract('/room', { configurable: false, notes: 'Personal/gamification surface, governed by session rules.' }),
    '/shop': pageContract('/shop', { configurable: false, notes: 'Personal/gamification surface, governed by session rules.' })
});

const ACTION_PERMISSION_TEST_CONTRACTS = Object.freeze({
    'hr.today.view': actionContract('hr.today.view', {
        backendScenario: 'GET /api/hr/today',
        testFiles: ['tests/integration/permission-capabilities.integration.test.js', 'tests/hr-capability-contract.test.js']
    }),
    'hr.schedule.view': actionContract('hr.schedule.view', {
        backendScenario: 'GET /api/hr/shifts',
        testFiles: ['tests/integration/permission-capabilities.integration.test.js', 'tests/hr-capability-contract.test.js']
    }),
    'hr.schedule.manage': actionContract('hr.schedule.manage', {
        backendScenario: 'POST /api/hr/shifts',
        mutation: true,
        sensitive: true,
        testFiles: ['tests/integration/permission-capabilities.integration.test.js', 'tests/hr-capability-contract.test.js']
    }),
    'hr.staff.view': actionContract('hr.staff.view', {
        backendScenario: 'GET /api/hr/staff',
        testFiles: ['tests/hr-capability-contract.test.js']
    }),
    'hr.staff.manage': actionContract('hr.staff.manage', {
        backendScenario: 'HR staff mutation routes',
        mutation: true,
        sensitive: true,
        testFiles: ['tests/account-center-contract.test.js', 'tests/hr-staff-medical-book.test.js']
    }),
    'hr.reports.view': actionContract('hr.reports.view', {
        backendScenario: 'GET /api/hr/report/*',
        sensitive: true,
        testFiles: ['tests/integration/permission-capabilities.integration.test.js', 'tests/hr-capability-contract.test.js']
    }),
    'hr.reports.export': actionContract('hr.reports.export', {
        backendScenario: 'GET /api/hr/report/export',
        sensitive: true,
        testFiles: ['tests/integration/permission-capabilities.integration.test.js', 'tests/hr-capability-contract.test.js']
    }),
    'hr.payroll.view': actionContract('hr.payroll.view', {
        backendScenario: 'HR/staff payroll read shaping',
        sensitive: true,
        testFiles: ['tests/hr-capability-contract.test.js', 'tests/payroll-permissions-contract.test.js']
    }),
    'hr.payroll.manage': actionContract('hr.payroll.manage', {
        backendScenario: 'HR payroll mutation routes',
        mutation: true,
        sensitive: true,
        testFiles: ['tests/hr-capability-contract.test.js', 'tests/payroll-permissions-contract.test.js']
    }),
    'finance.manage': actionContract('finance.manage', {
        backendScenario: 'finance mutation router guard',
        mutation: true,
        sensitive: true,
        testFiles: ['tests/finance-permission-contract.test.js']
    }),
    'payments.view': actionContract('payments.view', {
        backendScenario: 'cashier/checkin payment reads',
        sensitive: true,
        testFiles: ['tests/payment-workflow.test.js', 'tests/browser/cashier-payments-browser-smoke.js']
    }),
    'payments.create': actionContract('payments.create', {
        backendScenario: 'payment creation endpoints',
        mutation: true,
        sensitive: true,
        testFiles: ['tests/payment-workflow.test.js']
    }),
    'payments.confirm_received': actionContract('payments.confirm_received', {
        backendScenario: 'payment receipt confirmation endpoints',
        mutation: true,
        sensitive: true,
        testFiles: ['tests/payment-workflow.test.js']
    }),
    'fiscal.shift.open': actionContract('fiscal.shift.open', { backendScenario: 'fiscal shift open', mutation: true, sensitive: true, testFiles: ['tests/fiscal-cashier-operations.test.js'] }),
    'fiscal.shift.close': actionContract('fiscal.shift.close', { backendScenario: 'fiscal shift close', mutation: true, sensitive: true, testFiles: ['tests/fiscal-cashier-operations.test.js'] }),
    'fiscal.service_in': actionContract('fiscal.service_in', { backendScenario: 'fiscal service-in', mutation: true, sensitive: true, testFiles: ['tests/fiscal-cashier-operations.test.js'] }),
    'fiscal.service_out.request': actionContract('fiscal.service_out.request', { backendScenario: 'fiscal service-out request', mutation: true, sensitive: true, testFiles: ['tests/fiscal-cashier-operations.test.js'] }),
    'fiscal.service_out.approve': actionContract('fiscal.service_out.approve', { backendScenario: 'fiscal service-out approve', mutation: true, sensitive: true, testFiles: ['tests/fiscal-cashier-operations.test.js'] }),
    'fiscal.refund': actionContract('fiscal.refund', { backendScenario: 'fiscal refund', mutation: true, sensitive: true, testFiles: ['tests/fiscal-cashier-operations.test.js'] }),
    'fiscal.reconcile': actionContract('fiscal.reconcile', { backendScenario: 'fiscal reconciliation', mutation: true, sensitive: true, testFiles: ['tests/checkbox-webhook-reconciliation.test.js'] }),
    'fiscal.audit.view': actionContract('fiscal.audit.view', { backendScenario: 'fiscal audit reads', sensitive: true, testFiles: ['tests/fiscal-permissions-approvals.test.js'] }),
    'fiscal.configure': actionContract('fiscal.configure', {
        backendScenario: 'fiscal configuration approvals',
        mutation: true,
        sensitive: true,
        allowExpectation: 'primary_role_preset_only',
        testFiles: ['tests/fiscal-permissions-approvals.test.js']
    }),
    'create_booking': actionContract('create_booking', {
        backendScenario: 'booking create routes',
        mutation: true,
        testFiles: ['tests/booking-create-durability.test.js', 'tests/route-smoke.test.js']
    }),
    'edit_booking': actionContract('edit_booking', {
        backendScenario: 'booking edit visibility/mutation routes',
        mutation: true,
        sensitive: true,
        testFiles: ['tests/booking-visibility.test.js', 'tests/booking-status-actions.test.js']
    }),
    'delete_booking': actionContract('delete_booking', {
        backendScenario: 'booking delete/cancel routes',
        mutation: true,
        sensitive: true,
        testFiles: ['tests/auth-account-lifecycle.test.js', 'tests/booking-status-actions.test.js']
    }),
    'manage_accounts': actionContract('manage_accounts', {
        backendScenario: 'account management routes',
        mutation: true,
        sensitive: true,
        allowExpectation: 'primary_role_preset_only',
        testFiles: ['tests/auth-account-lifecycle.test.js', 'tests/account-center-contract.test.js']
    }),
    'view_all': actionContract('view_all', {
        backendScenario: 'booking visibility service',
        sensitive: true,
        testFiles: ['tests/booking-visibility.test.js', 'tests/permission-bootstrap-lifecycle.test.js']
    }),
    'view_revenue': actionContract('view_revenue', {
        backendScenario: 'revenue field shaping and financial route guards',
        sensitive: true,
        testFiles: ['tests/revenue-access-surface-contract.test.js', 'tests/revenue-access-group-a.test.js', 'tests/revenue-access-group-b.test.js']
    }),
    'manage_settings': actionContract('manage_settings', {
        backendScenario: 'system settings reads/mutations',
        mutation: true,
        sensitive: true,
        testFiles: ['tests/manage-settings-system-surfaces.test.js']
    }),
    'export_data': actionContract('export_data', {
        backendScenario: 'export generate/download/status before preparation',
        mutation: true,
        sensitive: true,
        testFiles: ['tests/revenue-access-surface-contract.test.js']
    }),
    'hermes.staff.manage': actionContract('hermes.staff.manage', {
        backendScenario: 'Hermes staff create/onboarding',
        mutation: true,
        sensitive: true,
        testFiles: ['tests/hermes-schedule-routes.test.js', 'tests/hermes-staff-account-onboarding.test.js']
    }),
    'hermes.attendance.manage': actionContract('hermes.attendance.manage', {
        backendScenario: 'Hermes attendance preview/apply',
        mutation: true,
        sensitive: true,
        testFiles: ['tests/hermes-attendance-import.test.js']
    }),
    'hermes.schedule.manage': actionContract('hermes.schedule.manage', {
        backendScenario: 'Hermes schedule preview/apply',
        mutation: true,
        sensitive: true,
        testFiles: ['tests/hermes-schedule-preview.test.js', 'tests/hermes-schedule-apply.test.js']
    }),
    'training.manage': actionContract('training.manage', {
        backendScenario: 'seeded Training checklist progress mutation',
        mutation: true,
        sensitive: true,
        testFiles: ['tests/training-course-progress.test.js']
    }),
    'view_payroll': actionContract('view_payroll', { backendScenario: 'legacy payroll read action', sensitive: true, testFiles: ['tests/payroll-permissions-contract.test.js'] }),
    'manage_payroll_accrual': actionContract('manage_payroll_accrual', { backendScenario: 'payroll accrual mutation', mutation: true, sensitive: true, testFiles: ['tests/payroll-workflow-contract.test.js'] }),
    'approve_payroll_installment': actionContract('approve_payroll_installment', { backendScenario: 'payroll installment approval', mutation: true, sensitive: true, testFiles: ['tests/payroll-workflow-contract.test.js'] }),
    'confirm_payroll_payment': actionContract('confirm_payroll_payment', { backendScenario: 'payroll payment confirmation', mutation: true, sensitive: true, testFiles: ['tests/payroll-workflow-contract.test.js'] }),
    'reverse_payroll_payment': actionContract('reverse_payroll_payment', { backendScenario: 'payroll payment reversal', mutation: true, sensitive: true, testFiles: ['tests/payroll-workflow-contract.test.js'] }),
    'close_payroll_period': actionContract('close_payroll_period', { backendScenario: 'payroll period close', mutation: true, sensitive: true, testFiles: ['tests/payroll-workflow-contract.test.js'] }),
    'manage_payroll_rules': actionContract('manage_payroll_rules', { backendScenario: 'payroll rules management', mutation: true, sensitive: true, testFiles: ['tests/payroll-permissions-contract.test.js'] })
});

module.exports = {
    PAGE_PERMISSION_TEST_CONTRACTS,
    ACTION_PERMISSION_TEST_CONTRACTS
};

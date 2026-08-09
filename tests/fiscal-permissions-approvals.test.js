'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { canUseAction } = require('../middleware/auth');
const { ACTION_PERMISSION_BY_KEY } = require('../config/permissionRegistry');
const {
    PAYMENT_FISCAL_CAPABILITIES,
    authorizeFiscalActionContext,
    assertFiscalBindingScope
} = require('../services/payments/fiscalAccess');
const {
    PIN_MAX_ATTEMPTS,
    PIN_SECRET_ENV_KEYS,
    createEphemeralActionPin,
    createActionPinHash,
    evaluatePinChallenge,
    approveFiscalAction,
    consumeFiscalApproval,
    consumeFiscalApprovalInTransaction,
    assertTestPinModeSafe
} = require('../services/payments/fiscalApprovals');

function differentPin(pin) {
    return pin.split('').map(digit => String((Number(digit) + 1) % 10)).join('');
}

function baseBinding(overrides = {}) {
    return {
        id: 10,
        fiscal_profile_id: 20,
        crm_profile_key: 'event_genix',
        fiscal_location_id: 30,
        fiscal_register_id: 40,
        register_fiscal_location_id: 30,
        user_id: 50,
        status: 'active',
        capability_scope: PAYMENT_FISCAL_CAPABILITIES,
        ...overrides
    };
}

function baseUser(overrides = {}) {
    return {
        id: 50,
        username: 'cashier.operator',
        role: 'reception',
        action_allowlist: [],
        action_denylist: [],
        business_contexts: ['event_genix'],
        default_business_context: 'event_genix',
        ...overrides
    };
}

test('payment/fiscal cashier capabilities are narrow and do not grant finance management', () => {
    for (const action of PAYMENT_FISCAL_CAPABILITIES) {
        assert.ok(ACTION_PERMISSION_BY_KEY[action], `${action} must be in the canonical permission registry`);
    }

    const cashier = baseUser();
    assert.equal(canUseAction(cashier, 'payments.view'), true);
    assert.equal(canUseAction(cashier, 'payments.create'), true);
    assert.equal(canUseAction(cashier, 'payments.confirm_received'), true);
    assert.equal(canUseAction(cashier, 'finance.manage'), false, 'cashier must not receive broad finance.manage');

    const cashierWithTargetedFiscalGrant = baseUser({ action_allowlist: ['fiscal.shift.open'] });
    assert.equal(canUseAction(cashierWithTargetedFiscalGrant, 'fiscal.shift.open'), true);
    assert.equal(canUseAction(cashierWithTargetedFiscalGrant, 'finance.manage'), false);

    const deniedCashier = baseUser({ action_denylist: ['payments.create'] });
    assert.equal(canUseAction(deniedCashier, 'payments.create'), false);
});

test('creator and art director can access park cashier payment/fiscal pilot without broad finance grant', () => {
    const { PAGE_ACCESS } = require('../middleware/auth');
    const requiredActions = [
        'payments.view',
        'payments.create',
        'payments.confirm_received',
        'fiscal.shift.open',
        'fiscal.shift.close',
        'fiscal.service_in',
        'fiscal.service_out.request',
        'fiscal.service_out.approve',
        'fiscal.refund',
        'fiscal.reconcile',
        'fiscal.audit.view'
    ];

    for (const role of ['creator', 'art_director']) {
        assert.ok(PAGE_ACCESS['/cashier-payments'].includes(role), role + ' must see the cashier page in the menu');
        for (const action of requiredActions) {
            assert.equal(canUseAction(baseUser({ role }), action), true, role + ' must have ' + action);
        }
    }

    assert.equal(canUseAction(baseUser({ role: 'art_director' }), 'finance.manage'), false, 'art director must not receive broad finance.manage');
});

test('fiscal.configure is non-delegable and explicit allowlist is ignored', () => {
    assert.equal(ACTION_PERMISSION_BY_KEY['fiscal.configure'].delegable, false);
    assert.equal(canUseAction(baseUser({ action_allowlist: ['fiscal.configure'] }), 'fiscal.configure'), false);
    assert.equal(canUseAction({ id: 1, role: 'creator', action_allowlist: ['fiscal.configure'] }, 'fiscal.configure'), true);
});

test('fiscal action context requires exact user, CRM profile, location, register, and capability', () => {
    const decision = authorizeFiscalActionContext({
        user: baseUser(),
        action: 'payments.create',
        binding: baseBinding(),
        fiscalProfileId: 20,
        crmProfileKey: 'event_genix',
        fiscalLocationId: 30,
        fiscalRegisterId: 40
    });
    assert.equal(decision.ok, true);
    assert.equal(decision.approvalRequired, false);

    assert.throws(
        () => assertFiscalBindingScope({
            user: baseUser(),
            binding: baseBinding(),
            fiscalProfileId: 20,
            crmProfileKey: 'dar',
            fiscalLocationId: 30,
            fiscalRegisterId: 40
        }),
        error => error.code === 'fiscal_binding_wrong_profile'
    );

    assert.throws(
        () => authorizeFiscalActionContext({
            user: baseUser({ action_denylist: ['payments.create'] }),
            action: 'payments.create',
            binding: baseBinding(),
            fiscalProfileId: 20,
            crmProfileKey: 'event_genix',
            fiscalLocationId: 30,
            fiscalRegisterId: 40
        }),
        error => error.code === 'fiscal_capability_denied'
    );
});

test('action PIN is hash-only in service responses and locks after repeated failures', async () => {
    const pin = createEphemeralActionPin();
    const wrongPin = differentPin(pin);
    let binding = {
        ...baseBinding(),
        action_pin_hash: await createActionPinHash(pin),
        pin_failed_attempts: 0
    };
    const now = new Date('2026-01-01T10:00:00.000Z');

    for (let attempt = 1; attempt <= PIN_MAX_ATTEMPTS; attempt += 1) {
        const result = await evaluatePinChallenge({ binding, providedPin: wrongPin, now });
        binding = { ...binding, ...result.bindingPatch };
    }

    assert.ok(binding.pin_locked_until instanceof Date);
    await assert.rejects(
        () => evaluatePinChallenge({ binding, providedPin: pin, now }),
        error => error.code === 'action_pin_locked'
    );

    const serialized = JSON.stringify(binding);
    assert.equal(serialized.includes(pin), false, 'raw PIN must not be present in binding metadata');
});

test('service_out approval requires a distinct approver and approval payload does not leak PIN', async () => {
    const pin = createEphemeralActionPin();
    const binding = {
        ...baseBinding({ user_id: 60 }),
        action_pin_hash: await createActionPinHash(pin)
    };
    const operation = {
        id: 70,
        fiscal_profile_id: 20,
        fiscal_register_id: 40,
        operation_type: 'service_out',
        initiated_by_user_id: 50
    };

    await assert.rejects(
        () => approveFiscalAction({
            actor: { id: 50, role: 'manager' },
            binding: { ...binding, user_id: 50 },
            operation,
            actionType: 'fiscal.service_out.approve',
            providedPin: pin
        }),
        error => error.code === 'service_out_distinct_approver_required'
    );

    const approved = await approveFiscalAction({
        actor: { id: 60, role: 'manager' },
        binding,
        operation,
        actionType: 'fiscal.service_out.approve',
        providedPin: pin,
        context: { visibleReason: 'operator cash withdrawal approval', pinEcho: pin }
    });

    assert.equal(approved.ok, true);
    assert.equal(approved.approval.action_type, 'service_out');
    const serialized = JSON.stringify(approved);
    assert.equal(serialized.includes(pin), false, 'approval result and audit metadata must not contain raw PIN');
    assert.equal(Object.hasOwn(approved.approval.approval_context, 'pinEcho'), false);
});

test('operation-bound approvals are one-time and replay attempts fail closed', () => {
    const approval = {
        fiscal_profile_id: 20,
        fiscal_register_id: 40,
        fiscal_operation_id: 70,
        action_type: 'refund',
        status: 'approved',
        approved_by_user_id: 60,
        expires_at: new Date('2026-01-01T10:05:00.000Z'),
        consumed_at: null
    };

    const consumed = consumeFiscalApproval(approval, {
        operationId: 70,
        actionType: 'fiscal.refund',
        now: new Date('2026-01-01T10:01:00.000Z')
    });
    assert.equal(consumed.status, 'consumed');
    assert.ok(consumed.consumed_at instanceof Date);

    assert.throws(
        () => consumeFiscalApproval(consumed, {
            operationId: 70,
            actionType: 'fiscal.refund',
            now: new Date('2026-01-01T10:02:00.000Z')
        }),
        error => error.code === 'approval_already_consumed'
    );
});

test('database approval consumption is atomic and scoped to operation/profile/register/action', async () => {
    const approval = {
        id: 90,
        fiscal_profile_id: 20,
        fiscal_register_id: 40,
        fiscal_operation_id: 70,
        action_type: 'refund',
        status: 'approved',
        approved_by_user_id: 60,
        expires_at: new Date('2026-01-01T10:05:00.000Z'),
        consumed_at: null
    };
    const calls = [];
    const client = {
        async query(sql, params) {
            calls.push({ sql, params });
            assert.match(sql, /status = 'approved'/);
            assert.match(sql, /consumed_at IS NULL/);
            assert.match(sql, /expires_at > \$6/);
            assert.match(sql, /fiscal_register_id = \$3/);
            assert.equal(params[0], 90);
            assert.equal(params[1], 20);
            assert.equal(params[2], 40);
            assert.equal(params[3], 70);
            assert.equal(params[4], 'refund');
            return { rows: [{ ...approval, status: 'consumed', consumed_at: params[5], consumed_by_operation_id: 70 }] };
        }
    };

    const consumed = await consumeFiscalApprovalInTransaction(client, {
        ...approval,
        id: 90
    }, {
        operationId: 70,
        actionType: 'fiscal.refund',
        actorUserId: 60,
        now: new Date('2026-01-01T10:01:00.000Z')
    });

    assert.equal(calls.length, 1);
    assert.equal(consumed.status, 'consumed');
    assert.equal(consumed.consumed_by_operation_id, 70);
});

test('configured test PIN mode fails closed in production-like environments', () => {
    const env = {
        NODE_ENV: 'production',
        [PIN_SECRET_ENV_KEYS[0]]: createEphemeralActionPin()
    };
    assert.throws(
        () => assertTestPinModeSafe(env),
        error => error.code === 'test_pin_mode_forbidden_in_production'
    );
});

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    createActionPinHash,
    createEphemeralActionPin,
    evaluatePinChallenge,
    PIN_LOCKOUT_MS,
    PIN_MAX_ATTEMPTS
} = require('../services/payments/fiscalApprovals');
const { enrollFiscalActionPin, verifyOwnFiscalActionPin } = require('../services/payments/cashierOperationsService');

const NOW = new Date('2026-09-13T12:00:00.000Z');

function testRoute(overrides = {}) {
    return {
        mode: 'test',
        expectedIsTest: true,
        sharedTestRegister: true,
        businessContext: 'event_genix',
        mapping: {
            fiscal_profile_id: 20,
            fiscal_location_id: 30,
            fiscal_register_id: 40,
            route_status: 'active',
            route_feature_enabled: true,
            fiscal_register_status: 'active',
            feature_enabled: true,
            provider: 'checkbox',
            shared_register_group: 'checkbox_single_test_register'
        },
        ...overrides
    };
}

function testUser(overrides = {}) {
    return {
        id: 50,
        role: 'reception',
        action_allowlist: [],
        action_denylist: [],
        business_contexts: ['event_genix'],
        default_business_context: 'event_genix',
        ...overrides
    };
}

function bindingState(actionPinHash, overrides = {}) {
    return {
        id: 10,
        user_id: 50,
        fiscal_profile_id: 20,
        fiscal_location_id: 30,
        fiscal_register_id: 40,
        provider: 'checkbox',
        status: 'active',
        action_pin_hash: actionPinHash,
        pin_failed_attempts: 0,
        pin_last_failed_at: null,
        pin_locked_until: null,
        pin_last_verified_at: null,
        ...overrides
    };
}

function createBindingClient(state) {
    const calls = [];
    const client = {
        calls,
        async query(sql, params = []) {
            const normalized = String(sql).replace(/\s+/g, ' ').trim();
            calls.push({ sql: normalized, params });
            if (normalized.startsWith('SELECT b.*, fp.crm_profile_key')) {
                const ownPinCheck = params.length === 5;
                const matchesOwnerScope = (!ownPinCheck || Number(state.user_id) === Number(params[1]))
                    && Number(state.fiscal_profile_id) === Number(params[ownPinCheck ? 2 : 1])
                    && Number(state.fiscal_location_id) === Number(params[ownPinCheck ? 3 : 2])
                    && Number(state.fiscal_register_id) === Number(params[ownPinCheck ? 4 : 3])
                    && state.provider === 'checkbox'
                    && state.status === 'active';
                return { rows: matchesOwnerScope ? [{ ...state }] : [] };
            }
            if (normalized.startsWith('UPDATE fiscal_cashier_bindings')) {
                state.pin_failed_attempts = params[1] ?? state.pin_failed_attempts;
                state.pin_last_failed_at = params[2] ?? state.pin_last_failed_at;
                state.pin_locked_until = params[3] ?? null;
                state.pin_last_verified_at = params[4] ?? state.pin_last_verified_at;
                return { rows: [] };
            }
            if (normalized.startsWith('INSERT INTO fiscal_audit_events')) return { rows: [] };
            throw new Error(`Unexpected synthetic PIN query: ${normalized}`);
        }
    };
    return client;
}

function immediateTransaction(client) {
    return callback => callback(client);
}

function serializedTransaction(client) {
    let tail = Promise.resolve();
    return callback => {
        const current = tail.then(() => callback(client));
        tail = current.catch(() => undefined);
        return current;
    };
}

function routeResolver(route) {
    return async () => route;
}

function verifyInput({ user, pin, route, client, withTransactionFn = immediateTransaction(client), pinEvaluator } = {}) {
    return verifyOwnFiscalActionPin({
        user,
        bindingId: 10,
        body: { actionPin: pin, businessContext: 'event_genix', routeOptionId: 'park_test' },
        routeResolver: routeResolver(route),
        withTransactionFn,
        pinEvaluator
    });
}

test('own test PIN check verifies only the active owner binding and creates no fiscal operation, approval, or outbox work', async () => {
    const pin = createEphemeralActionPin();
    const state = bindingState(await createActionPinHash(pin));
    const client = createBindingClient(state);

    const result = await verifyInput({ user: testUser(), pin, route: testRoute(), client });

    assert.deepEqual(result, { bindingId: 10, verified: true, pinLockedUntil: null, failedAttempts: 0 });
    assert.equal(state.pin_failed_attempts, 0);
    assert.equal(client.calls.filter(call => /FOR UPDATE OF b/.test(call.sql)).length, 1);
    assert.equal(client.calls.some(call => /fiscal_action_approvals|fiscal_operations|payment_outbox_jobs/i.test(call.sql)), false);
});

test('five sequential wrong own-PIN checks persist failures and lock the binding for fifteen minutes', async () => {
    const pin = createEphemeralActionPin();
    const state = bindingState(await createActionPinHash(pin));
    const client = createBindingClient(state);
    const wrongPin = pin.split('').map(digit => String((Number(digit) + 1) % 10)).join('');
    const pinEvaluator = input => evaluatePinChallenge({ ...input, now: NOW });

    for (let attempt = 1; attempt <= PIN_MAX_ATTEMPTS; attempt += 1) {
        await assert.rejects(
            verifyInput({ user: testUser(), pin: wrongPin, route: testRoute(), client, pinEvaluator }),
            error => error.code === (attempt === PIN_MAX_ATTEMPTS ? 'action_pin_locked' : 'action_pin_invalid')
        );
        assert.equal(state.pin_failed_attempts, attempt, `attempt ${attempt} must be durable before the error returns`);
    }

    assert.equal(state.pin_locked_until?.getTime(), NOW.getTime() + PIN_LOCKOUT_MS);
    await assert.rejects(
        verifyInput({ user: testUser(), pin, route: testRoute(), client, pinEvaluator }),
        error => error.code === 'action_pin_locked'
    );
});

test('parallel wrong own-PIN checks serialize at the binding row and do not lose failures', async () => {
    const pin = createEphemeralActionPin();
    const state = bindingState(await createActionPinHash(pin));
    const client = createBindingClient(state);
    const wrongPin = pin.split('').map(digit => String((Number(digit) + 1) % 10)).join('');
    const transaction = serializedTransaction(client);
    const pinEvaluator = input => evaluatePinChallenge({ ...input, now: NOW });

    const results = await Promise.allSettled(Array.from({ length: PIN_MAX_ATTEMPTS }, () => verifyInput({
        user: testUser(),
        pin: wrongPin,
        route: testRoute(),
        client,
        withTransactionFn: transaction,
        pinEvaluator
    })));

    assert.equal(results.every(result => result.status === 'rejected'), true);
    assert.equal(state.pin_failed_attempts, PIN_MAX_ATTEMPTS);
    assert.equal(state.pin_locked_until?.getTime(), NOW.getTime() + PIN_LOCKOUT_MS);
    assert.equal(client.calls.filter(call => /FOR UPDATE OF b/.test(call.sql)).length, PIN_MAX_ATTEMPTS);
});

test('own PIN check rejects production, foreign-context, inactive, and other-user bindings before verification', async () => {
    const pin = createEphemeralActionPin();
    const activeHash = await createActionPinHash(pin);

    for (const scenario of [
        { name: 'production route', route: testRoute({ mode: 'production', expectedIsTest: false }), user: testUser(), state: bindingState(activeHash), code: 'fiscal_test_pin_scope_invalid', reads: 0 },
        { name: 'foreign context', route: testRoute({ businessContext: 'dar' }), user: testUser(), state: bindingState(activeHash), code: 'fiscal_business_context_denied', reads: 0 },
        { name: 'revoked payments.view', route: testRoute(), user: testUser({ action_denylist: ['payments.view'] }), state: bindingState(activeHash), code: 'fiscal_capability_denied', reads: 0 },
        { name: 'inactive binding', route: testRoute(), user: testUser(), state: bindingState(activeHash, { status: 'inactive' }), code: 'fiscal_binding_not_found', reads: 1 },
        { name: 'other user binding', route: testRoute(), user: testUser(), state: bindingState(activeHash, { user_id: 60 }), code: 'fiscal_binding_not_found', reads: 1 }
    ]) {
        const client = createBindingClient(scenario.state);
        await assert.rejects(
            verifyInput({ user: scenario.user, pin, route: scenario.route, client }),
            error => error.code === scenario.code,
            scenario.name
        );
        assert.equal(client.calls.filter(call => call.sql.startsWith('SELECT b.*, fp.crm_profile_key')).length, scenario.reads, scenario.name);
    }
});

test('a delegated test PIN manager cannot enroll their own PIN', async () => {
    const pin = createEphemeralActionPin();
    const state = bindingState(await createActionPinHash(pin));
    const client = createBindingClient(state);
    const user = testUser({
        role: 'senior_manager',
        action_allowlist: ['fiscal.test.pin.manage']
    });

    await assert.rejects(
        enrollFiscalActionPin({
            user,
            bindingId: 10,
            body: { actionPin: pin, businessContext: 'event_genix', routeOptionId: 'park_test' },
            routeResolver: routeResolver(testRoute()),
            withTransactionFn: immediateTransaction(client)
        }),
        error => error.code === 'action_pin_self_enrollment_denied'
    );
    assert.equal(client.calls.some(call => call.sql.startsWith('UPDATE fiscal_cashier_bindings')), false);
});

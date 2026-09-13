'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearTerminalModules() {
    for (const modulePath of [
        '../services/payments/cashierTerminalSessionService',
        '../middleware/auth',
        '../services/businessMembership'
    ]) {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    }
}

function loadTerminalServiceWithUsers(usersById) {
    clearTerminalModules();
    const realAuth = require('../middleware/auth');
    installMock('../middleware/auth', {
        ...realAuth,
        loadAuthenticatedUserAccess: async ({ id }) => {
            const user = usersById.get(Number(id));
            if (!user) {
                const error = new Error('User not found');
                error.code = 'auth_user_not_found';
                error.status = 401;
                throw error;
            }
            return { ...user };
        }
    });
    installMock('../services/businessMembership', {
        loadMembershipAccess: async () => null,
        applyMembershipAccess: (user) => user
    });
    return require('../services/payments/cashierTerminalSessionService');
}

class TerminalFakeClient {
    constructor(state) {
        this.state = state;
        this.released = false;
        this.queries = [];
    }

    async query(sql, params = []) {
        this.queries.push({ sql, params });
        const normalized = String(sql).replace(/\s+/g, ' ').trim();
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalized)) {
            if (normalized === 'COMMIT') this.state.commits += 1;
            if (normalized === 'ROLLBACK') this.state.rollbacks += 1;
            return { rows: [] };
        }
        if (normalized.startsWith('SELECT * FROM cashier_terminal_sessions')) {
            if (params[0] !== this.state.session.public_id || Number(params[1]) !== Number(this.state.session.opened_by_user_id)) {
                return { rows: [] };
            }
            return { rows: [{ ...this.state.session }] };
        }
        if (normalized.startsWith('SELECT b.*, fp.crm_profile_key')) {
            const bindingId = Number(params[0]);
            const binding = this.state.bindings.get(bindingId);
            if (!binding
                || Number(binding.fiscal_profile_id) !== Number(params[1])
                || Number(binding.fiscal_location_id) !== Number(params[2])
                || Number(binding.fiscal_register_id) !== Number(params[3])
                || binding.status !== 'active') {
                return { rows: [] };
            }
            return { rows: [{ ...binding, crm_profile_key: 'event_genix', register_fiscal_location_id: binding.fiscal_location_id }] };
        }
        if (normalized.startsWith('SELECT b.*, fr.fiscal_location_id')) {
            const bindingId = Number(params[0]);
            const binding = this.state.bindings.get(bindingId);
            if (!binding
                || Number(binding.user_id) !== Number(params[1])
                || Number(binding.fiscal_profile_id) !== Number(params[2])
                || Number(binding.fiscal_location_id) !== Number(params[3])
                || Number(binding.fiscal_register_id) !== Number(params[4])
                || binding.status !== 'active') {
                return { rows: [] };
            }
            return { rows: [{ ...binding, crm_profile_key: 'event_genix', register_fiscal_location_id: binding.fiscal_location_id }] };
        }
        if (normalized.startsWith('UPDATE fiscal_cashier_bindings')) {
            const binding = this.state.bindings.get(Number(params[0]));
            Object.assign(binding, {
                pin_failed_attempts: params[1],
                pin_last_failed_at: params[2],
                pin_locked_until: params[3],
                pin_last_verified_at: params[4]
            });
            return { rows: [] };
        }
        if (normalized.startsWith('INSERT INTO fiscal_audit_events')) {
            this.state.auditEvents.push({ sql, params });
            return { rows: [] };
        }
        if (normalized.startsWith('UPDATE cashier_terminal_sessions SET failed_pin_attempts')) {
            this.state.session.failed_pin_attempts += 1;
            this.state.session.last_failed_pin_at = new Date();
            if (this.state.session.failed_pin_attempts >= Number(params[1])) {
                this.state.session.locked_at = new Date();
                this.state.session.locked_until = params[2];
            }
            return { rows: [] };
        }
        if (normalized.startsWith('UPDATE cashier_terminal_sessions SET active_cashier_user_id')) {
            Object.assign(this.state.session, {
                active_cashier_user_id: Number(params[1]),
                active_cashier_binding_id: Number(params[2]),
                failed_pin_attempts: 0,
                last_failed_pin_at: null,
                locked_at: null,
                locked_until: null,
                session_version: Number(this.state.session.session_version || 0) + 1
            });
            return { rows: [{ ...this.state.session }] };
        }
        if (normalized.startsWith('UPDATE cashier_terminal_sessions SET last_seen_at')) {
            this.state.session.last_seen_at = new Date();
            return { rows: [] };
        }
        throw new Error(`Unexpected SQL in terminal fake: ${normalized}`);
    }

    release() {
        this.released = true;
    }
}

function makeDbPool(state) {
    return {
        async connect() {
            return new TerminalFakeClient(state);
        }
    };
}

function baseState(overrides = {}) {
    const now = new Date('2026-09-13T09:00:00.000Z');
    return {
        commits: 0,
        rollbacks: 0,
        auditEvents: [],
        session: {
            id: 10,
            public_id: '11111111-1111-4111-8111-111111111111',
            fiscal_profile_id: 20,
            fiscal_location_id: 30,
            fiscal_register_id: 40,
            business_context: 'event_genix',
            route_option_id: 'park_test',
            opened_by_user_id: 1,
            active_cashier_user_id: null,
            active_cashier_binding_id: null,
            status: 'active',
            session_version: 1,
            failed_pin_attempts: 0,
            locked_at: null,
            locked_until: null,
            revoked_at: null,
            expires_at: new Date(now.getTime() + 60 * 60 * 1000)
        },
        bindings: new Map([
            [55, {
                id: 55,
                user_id: 2,
                fiscal_profile_id: 20,
                fiscal_location_id: 30,
                fiscal_register_id: 40,
                status: 'active',
                capability_scope: ['payments.create', 'payments.confirm_received'],
                action_pin_hash: 'hash',
                pin_failed_attempts: 0,
                pin_last_failed_at: null,
                pin_locked_until: null,
                pin_last_verified_at: null
            }]
        ]),
        ...overrides
    };
}

function opener() {
    return {
        id: 1,
        role: 'senior_manager',
        business_contexts: ['event_genix'],
        default_business_context: 'event_genix',
        action_allowlist: ['fiscal.terminal.launch']
    };
}

test('terminal cashier login commits failed PIN attempts and locks the session after five failures', async () => {
    const state = baseState();
    const service = loadTerminalServiceWithUsers(new Map([
        [2, {
            id: 2,
            role: 'reception',
            business_contexts: ['event_genix'],
            default_business_context: 'event_genix',
            action_allowlist: ['payments.create', 'payments.confirm_received']
        }]
    ]));
    const now = new Date('2026-09-13T09:00:00.000Z');
    const pinEvaluator = async ({ binding }) => ({
        ok: false,
        code: 'action_pin_invalid',
        bindingPatch: {
            pin_failed_attempts: Number(binding.pin_failed_attempts || 0) + 1,
            pin_last_failed_at: now,
            pin_locked_until: null,
            pin_last_verified_at: null
        },
        auditEvent: { metadata: { reason: 'test' } }
    });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
        await assert.rejects(
            () => service.loginTerminalCashier({
                dbPool: makeDbPool(state),
                user: opener(),
                sessionId: state.session.public_id,
                bindingId: 55,
                actionPin: '1234',
                now,
                pinEvaluator
            }),
            error => error.code === 'action_pin_invalid'
        );
    }

    assert.equal(state.session.failed_pin_attempts, 5);
    assert.ok(state.session.locked_at);
    assert.ok(state.session.locked_until);
    assert.equal(state.commits, 5, 'failed PIN attempts are committed for audit and lockout');

    await assert.rejects(
        () => service.loginTerminalCashier({
            dbPool: makeDbPool(state),
            user: opener(),
            sessionId: state.session.public_id,
            bindingId: 55,
            actionPin: '1234',
            now: new Date('2026-09-13T09:01:00.000Z'),
            pinEvaluator
        }),
        error => error.code === 'terminal_session_pin_locked' && error.status === 423
    );
});

test('terminal action rechecks the active cashier binding capability on every operation', async () => {
    const state = baseState();
    state.session.active_cashier_user_id = 2;
    state.session.active_cashier_binding_id = 55;
    state.bindings.get(55).capability_scope = ['payments.create'];
    const service = loadTerminalServiceWithUsers(new Map([
        [2, {
            id: 2,
            role: 'reception',
            business_contexts: ['event_genix'],
            default_business_context: 'event_genix',
            action_allowlist: ['payments.create', 'payments.confirm_received']
        }]
    ]));

    await assert.rejects(
        () => service.loadTerminalSessionForAction({
            dbPool: makeDbPool(state),
            user: opener(),
            sessionId: state.session.public_id,
            action: 'payments.confirm_received',
            businessContext: 'event_genix',
            routeOptionId: 'park_test',
            expectedVersion: state.session.session_version,
            now: new Date('2026-09-13T09:00:00.000Z')
        }),
        error => error.code === 'terminal_cashier_binding_capability_denied'
    );
});


test('terminal action rejects a stale terminal session version before using the active cashier', async () => {
    const state = baseState();
    state.session.session_version = 4;
    state.session.active_cashier_user_id = 2;
    state.session.active_cashier_binding_id = 55;
    const service = loadTerminalServiceWithUsers(new Map([
        [2, {
            id: 2,
            role: 'reception',
            business_contexts: ['event_genix'],
            default_business_context: 'event_genix',
            action_allowlist: ['payments.create', 'payments.confirm_received']
        }]
    ]));

    await assert.rejects(
        () => service.loadTerminalSessionForAction({
            dbPool: makeDbPool(state),
            user: opener(),
            sessionId: state.session.public_id,
            action: 'payments.create',
            businessContext: 'event_genix',
            routeOptionId: 'park_test',
            expectedVersion: 3,
            now: new Date('2026-09-13T09:00:00.000Z')
        }),
        error => error.code === 'terminal_session_version_stale' && error.status === 409
    );
});

test('terminal action rejects ended sessions and mismatched business or register route', async () => {
    const state = baseState();
    state.session.active_cashier_user_id = 2;
    state.session.active_cashier_binding_id = 55;
    const service = loadTerminalServiceWithUsers(new Map([
        [2, {
            id: 2,
            role: 'reception',
            business_contexts: ['event_genix'],
            default_business_context: 'event_genix',
            action_allowlist: ['payments.create', 'payments.confirm_received']
        }]
    ]));

    await assert.rejects(
        () => service.loadTerminalSessionForAction({
            dbPool: makeDbPool(baseState({
                session: {
                    ...state.session,
                    status: 'revoked',
                    revoked_at: new Date('2026-09-13T09:00:00.000Z')
                }
            })),
            user: opener(),
            sessionId: state.session.public_id,
            action: 'payments.create',
            businessContext: 'event_genix',
            routeOptionId: 'park_test',
            expectedVersion: state.session.session_version,
            now: new Date('2026-09-13T09:01:00.000Z')
        }),
        error => error.code === 'terminal_session_expired' && error.status === 401
    );

    await assert.rejects(
        () => service.loadTerminalSessionForAction({
            dbPool: makeDbPool(state),
            user: opener(),
            sessionId: state.session.public_id,
            action: 'payments.create',
            businessContext: 'dar',
            routeOptionId: 'park_test',
            expectedVersion: state.session.session_version,
            now: new Date('2026-09-13T09:00:00.000Z')
        }),
        error => error.code === 'terminal_business_context_mismatch' && error.status === 409
    );

    await assert.rejects(
        () => service.loadTerminalSessionForAction({
            dbPool: makeDbPool(state),
            user: opener(),
            sessionId: state.session.public_id,
            action: 'payments.create',
            businessContext: 'event_genix',
            routeOptionId: 'park_production',
            expectedVersion: state.session.session_version,
            now: new Date('2026-09-13T09:00:00.000Z')
        }),
        error => error.code === 'terminal_route_mismatch' && error.status === 409
    );
});

test('terminal cashier login rejects inactive or wrong-register bindings before checking PIN', async () => {
    const state = baseState();
    state.bindings.get(55).status = 'inactive';
    const service = loadTerminalServiceWithUsers(new Map([
        [2, {
            id: 2,
            role: 'reception',
            business_contexts: ['event_genix'],
            default_business_context: 'event_genix',
            action_allowlist: ['payments.create', 'payments.confirm_received']
        }]
    ]));
    let pinEvaluatorCalled = false;

    await assert.rejects(
        () => service.loginTerminalCashier({
            dbPool: makeDbPool(state),
            user: opener(),
            sessionId: state.session.public_id,
            bindingId: 55,
            actionPin: '1234',
            now: new Date('2026-09-13T09:00:00.000Z'),
            pinEvaluator: async () => {
                pinEvaluatorCalled = true;
                return { ok: true, bindingPatch: {} };
            }
        }),
        error => error.code === 'terminal_cashier_binding_invalid' && error.status === 403
    );

    assert.equal(pinEvaluatorCalled, false, 'inactive binding is rejected before PIN evaluation');
    assert.equal(state.commits, 0, 'invalid binding does not commit a terminal login');
});

test('terminal action does not inherit Creator permissions from the CRM user who opened the terminal', async () => {
    const state = baseState();
    state.session.active_cashier_user_id = 2;
    state.session.active_cashier_binding_id = 55;
    state.bindings.get(55).capability_scope = ['payments.create', 'payments.confirm_received'];
    const service = loadTerminalServiceWithUsers(new Map([
        [2, {
            id: 2,
            role: 'viewer',
            business_contexts: ['event_genix'],
            default_business_context: 'event_genix',
            action_allowlist: []
        }]
    ]));

    await assert.rejects(
        () => service.loadTerminalSessionForAction({
            dbPool: makeDbPool(state),
            user: {
                ...opener(),
                role: 'creator',
                action_allowlist: ['fiscal.terminal.launch', 'payments.create', 'payments.confirm_received', 'fiscal.configure']
            },
            sessionId: state.session.public_id,
            action: 'payments.confirm_received',
            businessContext: 'event_genix',
            routeOptionId: 'park_test',
            expectedVersion: state.session.session_version,
            now: new Date('2026-09-13T09:00:00.000Z')
        }),
        error => error.code === 'terminal_cashier_action_denied' && error.status === 403
    );
});

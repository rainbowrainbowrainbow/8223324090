'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVICE_PATH = path.join(ROOT, 'services/payments/sharedTestDayService.js');

class StubTestDrainError extends Error {
    constructor(code, status = 409) {
        super(code);
        this.name = 'TestDrainError';
        this.code = code;
        this.status = status;
        this.statusCode = status;
    }
}

class StubFiscalAccessError extends Error {
    constructor(code) {
        super(code);
        this.name = 'FiscalAccessError';
        this.code = code;
        this.status = 403;
    }
}

function buildHarness({ drainStatus = 'closed', shiftBusinessContext = 'dar', blockerCount = 0, userAccess = ['event_genix', 'dar'], closeOperationStatus = 'fiscalized' } = {}) {
    const user = { id: 11, actionAllowlist: ['fiscal.shift.close'], businessContexts: userAccess };
    const shift = {
        id: 41,
        fiscal_profile_id: 5,
        fiscal_location_id: 6,
        fiscal_register_id: 7,
        business_context: shiftBusinessContext,
        status: drainStatus === 'closed' ? 'closed' : 'open',
        lifecycle_stage: drainStatus === 'closed' ? 'CLOSED' : 'OPENED',
        close_operation_id: 101,
        provider_shift_id: 'provider-shift-41',
        provider_organization_id: 'provider-org',
        provider_outlet_id: 'provider-outlet',
        provider_register_id: 'provider-register',
        provider_license_ref: 'TEST_LICENSE',
        register_expected_is_test: 'true'
    };
    const routes = [
        {
            route_option_id: 'dar_test',
            business_context: 'dar',
            mode: 'test',
            expected_is_test: true,
            fiscal_profile_id: shift.fiscal_profile_id,
            fiscal_location_id: shift.fiscal_location_id,
            fiscal_register_id: shift.fiscal_register_id,
            shared_register_group: 'shared_test'
        },
        {
            route_option_id: 'park_test',
            business_context: 'event_genix',
            mode: 'test',
            expected_is_test: true,
            fiscal_profile_id: shift.fiscal_profile_id,
            fiscal_location_id: shift.fiscal_location_id,
            fiscal_register_id: shift.fiscal_register_id,
            shared_register_group: 'shared_test'
        }
    ].sort((left, right) => left.route_option_id.localeCompare(right.route_option_id));
    const binding = {
        id: 17,
        user_id: 21,
        provider_cashier_id: 'provider-cashier',
        provider_cashier_login_ref: 'TEST_CASHIER'
    };
    const fingerprint = require('node:crypto').createHash('sha256').update(JSON.stringify({
        routes: routes.map(route => [route.route_option_id, route.business_context, String(route.fiscal_profile_id),
            String(route.fiscal_location_id), String(route.fiscal_register_id), route.shared_register_group, route.expected_is_test]),
        shift: [String(shift.id), shift.provider_shift_id, shift.provider_organization_id, shift.provider_outlet_id,
            shift.provider_register_id, String(binding.id), String(binding.user_id), binding.provider_cashier_id]
    })).digest('hex');
    const activeDrain = {
        id: 99,
        fiscal_profile_id: shift.fiscal_profile_id,
        fiscal_register_id: shift.fiscal_register_id,
        fiscal_shift_id: shift.id,
        status: drainStatus,
        initiating_route_option_id: 'dar_test',
        initiated_by_user_id: 33,
        scope_fingerprint: fingerprint,
        started_at: '2026-09-11T10:00:00Z',
        closed_at: drainStatus === 'closed' ? '2026-09-11T10:05:00Z' : null,
        resumed_at: null
    };
    const calls = { fiscalActions: [] };
    const client = {
        query: async sql => {
            const text = String(sql);
            if (text.includes('FROM fiscal_sale_routes')) return { rows: routes };
            if (text.includes('FROM fiscal_operations') && text.includes("operation_type = 'shift_close'")) {
                return { rows: closeOperationStatus ? [{ status: closeOperationStatus }] : [] };
            }
            if (text.includes('FROM fiscal_shifts') && text.includes('id <>')) return { rows: [] };
            return { rows: [] };
        }
    };
    const stubs = new Map([
        [require.resolve('../db'), { pool: {} }],
        [require.resolve('../services/payments/fiscalAccess'), {
            authorizeFiscalActorAction: async (_client, { crmProfileKey }) => {
                calls.fiscalActions.push(crmProfileKey);
                if (!userAccess.includes(crmProfileKey)) throw new StubFiscalAccessError('fiscal_business_context_denied');
            }
        }],
        [require.resolve('../services/payments/testDrainGate'), {
            TestDrainError: StubTestDrainError,
            lockFiscalRegister: async () => {},
            loadActiveTestDrain: async () => activeDrain
        }],
        [require.resolve('../services/payments/shiftCloseBlockers'), {
            countFiscalShiftCloseBlockers: async () => blockerCount
        }],
        [require.resolve('../services/payments/paymentReadinessService'), {
            loadAndAuthorizePhase1CloseShift: async () => shift,
            loadPhase1CloseFiscalBinding: async () => binding
        }],
        [require.resolve('../middleware/auth'), {
            loadAuthenticatedUserAccess: async authenticatedUser => authenticatedUser
        }],
        [require.resolve('../services/checkbox/config'), {
            loadCheckboxRuntimeConfig: () => ({}),
            isCheckboxIntegrationEnabled: () => true,
            isCheckboxPaymentAcceptanceEnabled: () => true
        }],
        [require.resolve('../services/checkbox/provider'), {
            createProviderFromConfig: () => { throw new Error('provider must not run'); },
            normalizeShiftResponse: value => value,
            getCurrentShiftWithAbsenceProof: async () => ({ absent: true })
        }]
    ]);
    const originalLoad = Module._load;
    delete require.cache[require.resolve(SERVICE_PATH)];
    Module._load = function patchedLoad(request, parent, isMain) {
        const resolved = Module._resolveFilename(request, parent, isMain);
        if (stubs.has(resolved)) return stubs.get(resolved);
        return originalLoad.apply(this, arguments);
    };
    const service = require(SERVICE_PATH);
    return {
        client,
        user,
        shift,
        activeDrain,
        calls,
        service,
        restore: () => {
            Module._load = originalLoad;
            delete require.cache[require.resolve(SERVICE_PATH)];
        }
    };
}

test('closed shared test day can be resumed from the sibling PARK/DAR route by an authorized operator', async () => {
    const harness = buildHarness({ drainStatus: 'closed', shiftBusinessContext: 'dar' });
    try {
        const state = await harness.service.loadSharedTestDayState(harness.client, {
            user: harness.user,
            shift: harness.shift,
            routeOptionId: 'park_test',
            profileId: harness.shift.fiscal_profile_id,
            registerId: harness.shift.fiscal_register_id
        });
        assert.equal(state.visible, true, JSON.stringify(state));
        assert.equal(state.canResume, true, JSON.stringify(state));
        assert.equal(state.activeDrain.id, harness.activeDrain.id);
        assert.deepEqual(harness.calls.fiscalActions.sort(), ['dar', 'event_genix']);
    } finally {
        harness.restore();
    }
});

test('closed drain without fiscalized close operation remains blocked as unverified close', async () => {
    const harness = buildHarness({ drainStatus: 'closed', shiftBusinessContext: 'dar', closeOperationStatus: 'pending' });
    try {
        const state = await harness.service.loadSharedTestDayState(harness.client, {
            user: harness.user,
            shift: harness.shift,
            routeOptionId: 'park_test',
            profileId: harness.shift.fiscal_profile_id,
            registerId: harness.shift.fiscal_register_id
        });
        assert.equal(state.visible, true, JSON.stringify(state));
        assert.equal(state.canResume, false, JSON.stringify(state));
        assert.equal(state.reasonCode, 'shared_test_close_not_verified');
        assert.equal(state.activeDrain.id, harness.activeDrain.id);
    } finally {
        harness.restore();
    }
});

test('draining shared test day still cannot be taken over from the sibling route', async () => {
    const harness = buildHarness({ drainStatus: 'draining', shiftBusinessContext: 'dar' });
    try {
        const state = await harness.service.loadSharedTestDayState(harness.client, {
            user: harness.user,
            shift: harness.shift,
            routeOptionId: 'park_test',
            profileId: harness.shift.fiscal_profile_id,
            registerId: harness.shift.fiscal_register_id
        });
        assert.equal(state.canResume, false, JSON.stringify(state));
        assert.equal(state.reasonCode, 'shared_test_scope_mismatch');
    } finally {
        harness.restore();
    }
});

test('closed shared test day resume remains blocked when the operator lacks either business context', async () => {
    const harness = buildHarness({ drainStatus: 'closed', shiftBusinessContext: 'dar', userAccess: ['event_genix'] });
    try {
        const state = await harness.service.loadSharedTestDayState(harness.client, {
            user: harness.user,
            shift: harness.shift,
            routeOptionId: 'park_test',
            profileId: harness.shift.fiscal_profile_id,
            registerId: harness.shift.fiscal_register_id
        });
        assert.equal(state.canResume, false, JSON.stringify(state));
        assert.equal(state.reasonCode, 'fiscal_business_context_denied');
    } finally {
        harness.restore();
    }
});

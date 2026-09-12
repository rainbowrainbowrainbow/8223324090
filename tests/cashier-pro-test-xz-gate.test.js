'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    for (const modulePath of [
        '../routes/payments',
        '../db'
    ]) {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    }
}

function loadGate() {
    clearModules();
    installMock('../db', { pool: { query: async () => ({ rows: [] }) } });
    const router = require('../routes/payments');
    return router.__cashierProGateTest;
}

function baseScope(overrides = {}) {
    return {
        route_option_id: 'dar_test',
        business_context: 'dar',
        mode: 'test',
        expected_is_test: true,
        register_expected_is_test: 'true',
        route_status: 'active',
        route_feature_enabled: true,
        route_acceptance_enabled: true,
        register_status: 'active',
        register_feature_enabled: true,
        provider: 'checkbox',
        shared_register_group: 'checkbox_single_test_register',
        ...overrides
    };
}

test('PARK/DAR narrow XZ gate accepts exact shared test scope', () => {
    const { assertParkDarTestXzScope } = loadGate();
    const result = assertParkDarTestXzScope(baseScope(), {
        requestedRouteOptionId: 'dar_test',
        user: { id: 4, role: 'creator', business_contexts: ['event_genix', 'dar'] }
    });
    assert.deepEqual(result, { routeOptionId: 'dar_test', businessContext: 'dar' });
});

test('PARK/DAR narrow XZ gate rejects production and non-test scopes', () => {
    const { assertParkDarTestXzScope } = loadGate();
    assert.throws(
        () => assertParkDarTestXzScope(baseScope({
            route_option_id: 'dar_production',
            mode: 'production',
            expected_is_test: false,
            register_expected_is_test: 'false',
            shared_register_group: null
        }), {
            user: { id: 4, role: 'creator', business_contexts: ['dar'] }
        }),
        error => error.code === 'park_dar_test_xz_scope_invalid'
    );
});

test('PARK/DAR narrow XZ gate rejects mismatched route header', () => {
    const { assertParkDarTestXzScope } = loadGate();
    assert.throws(
        () => assertParkDarTestXzScope(baseScope(), {
            requestedRouteOptionId: 'park_test',
            user: { id: 4, role: 'creator', business_contexts: ['event_genix', 'dar'] }
        }),
        error => error.code === 'park_dar_test_xz_route_mismatch'
    );
});

test('PARK/DAR narrow XZ gate preserves business isolation', () => {
    const { assertParkDarTestXzScope } = loadGate();
    assert.throws(
        () => assertParkDarTestXzScope(baseScope(), {
            requestedRouteOptionId: 'dar_test',
            user: { id: 5, role: 'reception', business_contexts: ['event_genix'] }
        }),
        error => error.code === 'fiscal_route_business_denied'
    );
});

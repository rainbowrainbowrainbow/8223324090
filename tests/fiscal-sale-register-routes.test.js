'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    assertNoClientFiscalRouteOverride,
    listFiscalSaleRouteOptions,
    resolveFiscalSaleRoute
} = require('../services/payments/fiscalSaleRouteService');

function mapping({ business = 'event_genix', physicalBusiness = business, routeOptionId = null, registerId = 40, isTest = false, acceptance = true, routeAcceptance = acceptance } = {}) {
    const routeId = routeOptionId || `${business === 'dar' ? 'dar' : 'park'}_${isTest ? 'test' : 'production'}`;
    return {
        route_option_id: routeId,
        route_business_context: business,
        route_mode: isTest ? 'test' : 'production',
        route_expected_is_test: isTest,
        route_status: 'active',
        route_feature_enabled: true,
        route_acceptance_enabled: routeAcceptance,
        shared_register_group: isTest ? 'checkbox_single_test_register' : null,
        fiscal_profile_id: physicalBusiness === 'dar' ? 21 : 20,
        fiscal_location_id: physicalBusiness === 'dar' ? 31 : 30,
        fiscal_register_id: registerId,
        crm_profile_key: physicalBusiness,
        location_alias: physicalBusiness === 'dar' ? 'dar' : 'park',
        register_alias: physicalBusiness === 'dar' ? 'dar' : 'middle',
        register_display_name: physicalBusiness === 'dar' ? 'Студія' : 'Середня каса',
        provider: 'checkbox',
        fiscal_register_status: 'active',
        feature_enabled: true,
        acceptance_enabled: acceptance,
        register_expected_is_test: isTest,
        provider_license_ref: 'hidden-ref',
        provider_register_id: 'hidden-provider-id'
    };
}

class RouteDb {
    constructor({ activeShift = null, blockers = null, testIsTest = true, sharedGroupRows = null } = {}) {
        this.activeShift = activeShift;
        this.blockers = blockers || { pending_jobs: 0, unknown_operations: 0, unknown_orders: 0 };
        this.testIsTest = testIsTest;
        this.sharedGroupRows = sharedGroupRows;
    }
    async connect() { return this; }
    release() {}
    async query(sql, params = []) {
        const normalized = String(sql).replace(/\s+/g, ' ');
        if (normalized.includes('WHERE fsr.shared_register_group = $1')) {
            return { rows: this.sharedGroupRows || [
                mapping({ business: 'event_genix', physicalBusiness: 'event_genix', routeOptionId: 'park_test', registerId: 99, isTest: true }),
                mapping({ business: 'dar', physicalBusiness: 'event_genix', routeOptionId: 'dar_test', registerId: 99, isTest: true })
            ] };
        }
        if (normalized.includes('FROM fiscal_sale_routes fsr')) {
            const routeOptionId = params[0];
            const business = params[1];
            const isTest = routeOptionId.endsWith('_test');
            return { rows: [mapping({
                business,
                physicalBusiness: isTest ? 'event_genix' : business,
                routeOptionId,
                registerId: isTest ? 99 : business === 'dar' ? 41 : 40,
                isTest: isTest ? this.testIsTest : false
            })] };
        }
        if (normalized.includes('FROM fiscal_shifts')) {
            return { rows: this.activeShift ? [this.activeShift] : [] };
        }
        if (normalized.includes('AS pending_jobs')) return { rows: [this.blockers] };
        throw new Error(`Unhandled route query: ${normalized}`);
    }
}

const allowBusiness = () => true;
const allowConfigure = () => true;

test('four safe route options are visible to fiscal.configure users', async () => {
    const routes = await listFiscalSaleRouteOptions({
        dbPool: new RouteDb(),
        user: { id: 1 },
        canUseActionFn: allowConfigure,
        canAccessBusinessContextFn: allowBusiness
    });
    assert.deepEqual(routes.map(route => route.id), [
        'park_production',
        'park_test',
        'dar_production',
        'dar_test'
    ]);
    assert.equal(routes.filter(route => route.mode === 'test').every(route => route.registerLabel === 'Тестова каса'), true);
    assert.doesNotMatch(JSON.stringify(routes), /provider|credential|login/i);
});

test('test options are hidden without fiscal.configure', async () => {
    const routes = await listFiscalSaleRouteOptions({
        dbPool: new RouteDb(),
        user: { id: 1 },
        canUseActionFn: () => false,
        canAccessBusinessContextFn: allowBusiness
    });
    assert.deepEqual(routes.map(route => route.id), ['park_production', 'dar_production']);
});

test('browser fiscal/provider overrides are rejected before DB access', () => {
    for (const field of [
        'fiscalProfileId', 'fiscalRegisterId', 'locationAlias', 'registerAlias',
        'providerRegisterId', 'cashierId', 'credentialReference', 'isTest', 'registerMode'
    ]) {
        assert.throws(
            () => assertNoClientFiscalRouteOverride({ routeOptionId: 'park_test', [field]: 'forbidden' }),
            error => error.code === 'client_fiscal_scope_forbidden',
            field
        );
    }
});

test('PARK and DAR production route scope cannot be crossed', async () => {
    await assert.rejects(
        resolveFiscalSaleRoute({
            dbPool: new RouteDb(),
            user: { id: 1 },
            routeOptionId: 'park_production',
            businessContext: 'dar',
            canUseActionFn: allowConfigure,
            canAccessBusinessContextFn: allowBusiness
        }),
        error => error.code === 'fiscal_route_business_mismatch'
    );
});

test('both test routes resolve to one physical register but retain business ownership', async () => {
    const db = new RouteDb();
    const park = await resolveFiscalSaleRoute({
        dbPool: db,
        user: { id: 1 },
        routeOptionId: 'park_test',
        businessContext: 'event_genix',
        canUseActionFn: allowConfigure,
        canAccessBusinessContextFn: allowBusiness
    });
    const dar = await resolveFiscalSaleRoute({
        dbPool: db,
        user: { id: 1 },
        routeOptionId: 'dar_test',
        businessContext: 'dar',
        canUseActionFn: allowConfigure,
        canAccessBusinessContextFn: allowBusiness
    });
    assert.equal(park.mapping.fiscal_register_id, dar.mapping.fiscal_register_id);
    assert.notEqual(park.businessContext, dar.businessContext);
});

test('shared test register blocks concurrent context and unresolved recovery', async () => {
    await assert.rejects(
        resolveFiscalSaleRoute({
            dbPool: new RouteDb({ activeShift: { id: 5, status: 'open', business_context: 'event_genix' } }),
            user: { id: 1 },
            routeOptionId: 'dar_test',
            businessContext: 'dar',
            requireMutationReady: true,
            canUseActionFn: allowConfigure,
            canAccessBusinessContextFn: allowBusiness
        }),
        error => error.code === 'shared_test_register_owned_by_other_business'
    );
    await assert.rejects(
        resolveFiscalSaleRoute({
            dbPool: new RouteDb({ blockers: { pending_jobs: 1, unknown_operations: 0, unknown_orders: 0 } }),
            user: { id: 1 },
            routeOptionId: 'park_test',
            businessContext: 'event_genix',
            requireMutationReady: true,
            canUseActionFn: allowConfigure,
            canAccessBusinessContextFn: allowBusiness
        }),
        error => error.code === 'shared_test_register_recovery_incomplete'
    );
});

test('shared test routes fail closed when one active route points to another physical register', async () => {
    const sharedGroupRows = [
        mapping({ business: 'event_genix', physicalBusiness: 'event_genix', routeOptionId: 'park_test', registerId: 99, isTest: true }),
        mapping({ business: 'dar', physicalBusiness: 'dar', routeOptionId: 'dar_test', registerId: 100, isTest: true })
    ];
    await assert.rejects(
        resolveFiscalSaleRoute({
            dbPool: new RouteDb({ sharedGroupRows }),
            user: { id: 1 },
            routeOptionId: 'park_test',
            businessContext: 'event_genix',
            requireMutationReady: true,
            canUseActionFn: allowConfigure,
            canAccessBusinessContextFn: allowBusiness
        }),
        error => error.code === 'fiscal_shared_register_group_drift'
    );
});

test('shared test routes fail closed on provider or expected test-mode drift', async () => {
    for (const mutate of [
        row => { row.provider = 'another_provider'; },
        row => { row.route_expected_is_test = false; },
        row => { row.register_expected_is_test = false; }
    ]) {
        const driftedRoute = mapping({ business: 'dar', physicalBusiness: 'event_genix', routeOptionId: 'dar_test', registerId: 99, isTest: true });
        mutate(driftedRoute);
        await assert.rejects(
            resolveFiscalSaleRoute({
                dbPool: new RouteDb({ sharedGroupRows: [
                    mapping({ business: 'event_genix', physicalBusiness: 'event_genix', routeOptionId: 'park_test', registerId: 99, isTest: true }),
                    driftedRoute
                ] }),
                user: { id: 1 },
                routeOptionId: 'park_test',
                businessContext: 'event_genix',
                requireMutationReady: true,
                canUseActionFn: allowConfigure,
                canAccessBusinessContextFn: allowBusiness
            }),
            error => error.code === 'fiscal_shared_register_group_drift'
        );
    }
});

test('register mode mismatch and default-disabled acceptance fail closed', async () => {
    await assert.rejects(
        resolveFiscalSaleRoute({
            dbPool: new RouteDb({ testIsTest: false }),
            user: { id: 1 },
            routeOptionId: 'park_test',
            businessContext: 'event_genix',
            canUseActionFn: allowConfigure,
            canAccessBusinessContextFn: allowBusiness
        }),
        error => error.code === 'fiscal_route_mode_mismatch'
    );

    const db = new RouteDb();
    const originalQuery = db.query.bind(db);
    db.query = async (sql, params) => {
        const result = await originalQuery(sql, params);
        if (String(sql).includes('FROM fiscal_sale_routes fsr') && result.rows[0]) result.rows[0].route_acceptance_enabled = false;
        return result;
    };
    await assert.rejects(
        resolveFiscalSaleRoute({
            dbPool: db,
            user: { id: 1 },
            routeOptionId: 'park_production',
            businessContext: 'event_genix',
            requireMutationReady: true,
            canUseActionFn: allowConfigure,
            canAccessBusinessContextFn: allowBusiness
        }),
        error => error.code === 'fiscal_route_acceptance_disabled'
    );
});

'use strict';

const { pool } = require('../../db');
const { canUseAction } = require('../../middleware/auth');
const { canAccessBusinessContext } = require('../businessContext');

const ROUTE_OPTIONS = Object.freeze({
    park_production: Object.freeze({
        id: 'park_production',
        businessContext: 'event_genix',
        mode: 'production',
        locationAlias: 'park',
        registerAlias: 'middle',
        businessLabel: 'ПАРК',
        registerLabel: 'Середня каса'
    }),
    park_test: Object.freeze({
        id: 'park_test',
        businessContext: 'event_genix',
        mode: 'test',
        businessLabel: 'ПАРК',
        registerLabel: 'Тестова каса',
        sharedTestRegister: true
    }),
    dar_production: Object.freeze({
        id: 'dar_production',
        businessContext: 'dar',
        mode: 'production',
        locationAlias: 'dar',
        registerAlias: 'dar',
        businessLabel: 'ДАР',
        registerLabel: 'Студія / Каса ДАР'
    }),
    dar_test: Object.freeze({
        id: 'dar_test',
        businessContext: 'dar',
        mode: 'test',
        businessLabel: 'ДАР',
        registerLabel: 'Тестова каса',
        sharedTestRegister: true
    })
});

const CLIENT_FISCAL_FIELDS = Object.freeze([
    'fiscalProfileId', 'fiscal_profile_id',
    'fiscalRegisterId', 'fiscal_register_id',
    'providerRegisterId', 'provider_register_id',
    'providerCashierId', 'provider_cashier_id',
    'cashierId', 'cashier_id',
    'locationAlias', 'location_alias',
    'registerAlias', 'register_alias',
    'credentialReference', 'credential_reference',
    'credentialRef', 'credential_ref',
    'isTest', 'is_test',
    'registerMode', 'register_mode'
]);

class FiscalSaleRouteError extends Error {
    constructor(code, message, { status = 400, details = null } = {}) {
        super(message || code);
        this.name = 'FiscalSaleRouteError';
        this.code = code;
        this.status = status;
        this.statusCode = status;
        this.details = details;
    }
}

function booleanOrNull(value) {
    if (value === true || value === false) return value;
    const normalized = String(value ?? '').trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    return null;
}

function normalizeRouteOptionId(value) {
    const routeOptionId = String(value || '').trim().toLowerCase();
    if (!ROUTE_OPTIONS[routeOptionId]) {
        throw new FiscalSaleRouteError('fiscal_route_option_invalid', 'Unknown fiscal register option', { status: 422 });
    }
    return routeOptionId;
}

function routeOptionFromInput(body = {}) {
    return normalizeRouteOptionId(body.routeOptionId ?? body.route_option_id);
}

function assertNoClientFiscalRouteOverride(body = {}) {
    const forbidden = CLIENT_FISCAL_FIELDS.filter(field => Object.prototype.hasOwnProperty.call(body, field));
    if (forbidden.length) {
        throw new FiscalSaleRouteError(
            'client_fiscal_scope_forbidden',
            'Fiscal register identity is resolved from the selected safe route option',
            { status: 422, details: { fields: forbidden } }
        );
    }
}

function assertRouteVisibleToUser(route, user, { canUseActionFn = canUseAction, canAccessBusinessContextFn = canAccessBusinessContext } = {}) {
    if (!user?.id || !canAccessBusinessContextFn(user, route.businessContext)) {
        throw new FiscalSaleRouteError('fiscal_route_business_denied', 'Business context is not available to this user', { status: 403 });
    }
    if (route.mode === 'test' && !canUseActionFn(user, 'fiscal.configure')) {
        throw new FiscalSaleRouteError('fiscal_test_route_denied', 'Test register selection requires fiscal configuration access', { status: 403 });
    }
    return true;
}

const ROUTE_MAPPING_SELECT = `SELECT
    fsr.route_option_id,
    fsr.business_context AS route_business_context,
    fsr.mode AS route_mode,
    fsr.expected_is_test AS route_expected_is_test,
    fsr.status AS route_status,
    fsr.feature_enabled AS route_feature_enabled,
    fsr.acceptance_enabled AS route_acceptance_enabled,
    fsr.shared_register_group,
    fp.id AS fiscal_profile_id,
    fp.crm_profile_key,
    fp.legal_entity_key,
    fp.legal_entity_name,
    fp.provider_organization_id,
    fp.status AS fiscal_profile_status,
    fl.id AS fiscal_location_id,
    fl.location_alias,
    fl.display_name AS location_display_name,
    fl.provider_outlet_id,
    fr.id AS fiscal_register_id,
    fr.register_alias,
    fr.display_name AS register_display_name,
    fr.provider,
    fr.provider_register_id,
    fr.provider_license_ref,
    fr.status AS fiscal_register_status,
    fr.feature_enabled,
    fr.acceptance_enabled,
    fr.metadata AS register_metadata,
    COALESCE(fr.metadata->>'expected_is_test', fr.metadata->>'expectedIsTest') AS register_expected_is_test
FROM fiscal_sale_routes fsr
JOIN fiscal_profiles fp
  ON fp.id = fsr.fiscal_profile_id
JOIN fiscal_locations fl
  ON fl.id = fsr.fiscal_location_id
 AND fl.fiscal_profile_id = fp.id
JOIN fiscal_registers fr
  ON fr.id = fsr.fiscal_register_id
 AND fr.fiscal_profile_id = fp.id
 AND fr.fiscal_location_id = fl.id`;

async function loadRouteMapping(client, route) {
    const result = await client.query(
        `${ROUTE_MAPPING_SELECT}
          WHERE fsr.route_option_id = $1
            AND fsr.business_context = $2
            AND fp.status = 'active'
            AND fl.status = 'active'
            AND fr.status <> 'archived'`,
        [route.id, route.businessContext]
    );
    if (result.rows.length > 1) {
        throw new FiscalSaleRouteError('fiscal_route_mapping_ambiguous', 'Fiscal register route resolves to more than one register', {
            status: 409,
            details: { routeOptionId: route.id, matches: result.rows.length }
        });
    }
    return result.rows[0] || null;
}

function assertMappingMatchesRoute(route, mapping) {
    if (!mapping) {
        throw new FiscalSaleRouteError('fiscal_route_mapping_missing', 'Fiscal register route is not configured', {
            status: 409,
            details: { routeOptionId: route.id }
        });
    }
    const registerExpectedIsTest = booleanOrNull(mapping.register_expected_is_test);
    const routeExpectedIsTest = booleanOrNull(mapping.route_expected_is_test);
    const routeIsTest = route.mode === 'test';
    if (
        mapping.route_option_id !== route.id
        || mapping.route_business_context !== route.businessContext
        || mapping.route_mode !== route.mode
        || routeExpectedIsTest == null
        || registerExpectedIsTest == null
        || routeExpectedIsTest !== routeIsTest
        || registerExpectedIsTest !== routeIsTest
    ) {
        throw new FiscalSaleRouteError('fiscal_route_mode_mismatch', 'Fiscal register test/production mode does not match the selected route', {
            status: 409,
            details: { routeOptionId: route.id }
        });
    }
    if (String(mapping.provider || '') !== 'checkbox') {
        throw new FiscalSaleRouteError('fiscal_route_provider_invalid', 'Fiscal register route is not configured for Checkbox', { status: 409 });
    }
    if (route.sharedTestRegister && !String(mapping.shared_register_group || '').trim()) {
        throw new FiscalSaleRouteError('fiscal_shared_route_group_missing', 'Shared test route is missing an explicit sequential-use group', { status: 409 });
    }
    if (!route.sharedTestRegister && mapping.shared_register_group != null) {
        throw new FiscalSaleRouteError('fiscal_route_shared_group_invalid', 'Production route cannot use a shared test-register group', { status: 409 });
    }
    return routeExpectedIsTest;
}

async function sharedTestRegisterState(client, { mapping, businessContext }) {
    const shift = await client.query(
        `SELECT id, status, business_context
           FROM fiscal_shifts
          WHERE fiscal_profile_id = $1
            AND fiscal_register_id = $2
            AND status IN ('opening', 'open', 'closing')
          ORDER BY id DESC
          LIMIT 2`,
        [mapping.fiscal_profile_id, mapping.fiscal_register_id]
    );
    if (shift.rows.length > 1) {
        return { ready: false, reasonCode: 'shared_test_shift_ambiguous', activeBusinessContext: null };
    }
    if (shift.rows.length === 1) {
        const activeBusinessContext = String(shift.rows[0].business_context || '').trim().toLowerCase() || null;
        return {
            ready: activeBusinessContext === businessContext,
            reasonCode: activeBusinessContext === businessContext ? null : 'shared_test_register_owned_by_other_business',
            activeBusinessContext
        };
    }
    const blockers = await client.query(
        `SELECT
             (SELECT COUNT(*)::int
                FROM payment_outbox_jobs job
                LEFT JOIN payment_orders po
                  ON po.id = job.payment_order_id
                 AND po.fiscal_profile_id = job.fiscal_profile_id
                LEFT JOIN fiscal_operations operation
                  ON operation.id = job.fiscal_operation_id
                 AND operation.fiscal_profile_id = job.fiscal_profile_id
               WHERE COALESCE(po.fiscal_register_id, operation.fiscal_register_id) = $1
                 AND job.status IN ('queued', 'claimed', 'running', 'failed', 'dead')) AS pending_jobs,
             (SELECT COUNT(*)::int
                FROM fiscal_operations
               WHERE fiscal_register_id = $1
                 AND status = 'unknown') AS unknown_operations,
             (SELECT COUNT(*)::int
                FROM payment_orders
               WHERE fiscal_register_id = $1
                 AND (payment_status = 'unknown' OR fiscal_status = 'unknown')) AS unknown_orders`,
        [mapping.fiscal_register_id]
    );
    const row = blockers.rows[0] || {};
    const pendingJobs = Number(row.pending_jobs || 0);
    const unknownOperations = Number(row.unknown_operations || 0);
    const unknownOrders = Number(row.unknown_orders || 0);
    const ready = pendingJobs === 0 && unknownOperations === 0 && unknownOrders === 0;
    return {
        ready,
        reasonCode: ready ? null : 'shared_test_register_recovery_incomplete',
        activeBusinessContext: null,
        pendingJobs,
        unknownOperations,
        unknownOrders
    };
}

async function assertSharedRegisterGroupInvariant(client, mapping) {
    const sharedRegisterGroup = String(mapping?.shared_register_group || '').trim();
    if (!sharedRegisterGroup) {
        throw new FiscalSaleRouteError(
            'fiscal_shared_route_group_missing',
            'Shared test route is missing an explicit sequential-use group',
            { status: 409 }
        );
    }
    const result = await client.query(
        `SELECT
             fsr.route_option_id,
             fsr.fiscal_profile_id,
             fsr.fiscal_location_id,
             fsr.fiscal_register_id,
             fsr.expected_is_test AS route_expected_is_test,
             fr.provider,
             COALESCE(fr.metadata->>'expected_is_test', fr.metadata->>'expectedIsTest') AS register_expected_is_test
           FROM fiscal_sale_routes fsr
           JOIN fiscal_registers fr
             ON fr.id = fsr.fiscal_register_id
            AND fr.fiscal_profile_id = fsr.fiscal_profile_id
            AND fr.fiscal_location_id = fsr.fiscal_location_id
          WHERE fsr.shared_register_group = $1
            AND fsr.status = 'active'
          ORDER BY fsr.route_option_id`,
        [sharedRegisterGroup]
    );
    const activeRoutes = result.rows || [];
    const currentRouteIsActive = mapping.route_status === 'active';
    const currentRoute = activeRoutes.find(row => row.route_option_id === mapping.route_option_id) || null;
    const baseline = activeRoutes[0] || null;
    const samePhysicalRegister = row => (
        String(row.fiscal_profile_id) === String(baseline.fiscal_profile_id)
        && String(row.fiscal_location_id) === String(baseline.fiscal_location_id)
        && String(row.fiscal_register_id) === String(baseline.fiscal_register_id)
    );
    const currentRouteStillMatches = !currentRouteIsActive || (
        currentRoute
        && String(currentRoute.fiscal_profile_id) === String(mapping.fiscal_profile_id)
        && String(currentRoute.fiscal_location_id) === String(mapping.fiscal_location_id)
        && String(currentRoute.fiscal_register_id) === String(mapping.fiscal_register_id)
    );
    const hasDrift = (
        !currentRouteStillMatches
        || activeRoutes.some(row => (
            !samePhysicalRegister(row)
            || String(row.provider || '').trim() !== 'checkbox'
            || booleanOrNull(row.route_expected_is_test) !== true
            || booleanOrNull(row.register_expected_is_test) !== true
        ))
    );
    if (hasDrift) {
        throw new FiscalSaleRouteError(
            'fiscal_shared_register_group_drift',
            'Shared test-register routes do not resolve to one verified Checkbox test register',
            { status: 409, details: { sharedRegisterGroup } }
        );
    }
    return true;
}

async function resolveFiscalSaleRoute({
    dbPool = pool,
    client = null,
    user,
    routeOptionId,
    businessContext = null,
    requireMutationReady = false,
    canUseActionFn = canUseAction,
    canAccessBusinessContextFn = canAccessBusinessContext
} = {}) {
    const id = normalizeRouteOptionId(routeOptionId);
    const route = ROUTE_OPTIONS[id];
    assertRouteVisibleToUser(route, user, { canUseActionFn, canAccessBusinessContextFn });
    const requestedBusiness = String(businessContext || route.businessContext).trim().toLowerCase();
    if (requestedBusiness !== route.businessContext) {
        throw new FiscalSaleRouteError('fiscal_route_business_mismatch', 'Selected register route belongs to another business context', { status: 409 });
    }
    const ownsClient = !client;
    const queryable = client || await dbPool.connect();
    try {
        const mapping = await loadRouteMapping(queryable, route);
        const expectedIsTest = assertMappingMatchesRoute(route, mapping);
        let sequentialState = { ready: true, reasonCode: null, activeBusinessContext: null };
        if (route.sharedTestRegister) {
            await assertSharedRegisterGroupInvariant(queryable, mapping);
            sequentialState = await sharedTestRegisterState(queryable, { mapping, businessContext: route.businessContext });
        }
        if (requireMutationReady) {
            if (
                mapping.fiscal_register_status !== 'active'
                || mapping.feature_enabled !== true
                || mapping.route_status !== 'active'
                || mapping.route_feature_enabled !== true
            ) {
                throw new FiscalSaleRouteError('fiscal_route_feature_disabled', 'Selected fiscal register is not enabled', { status: 409 });
            }
            if (mapping.acceptance_enabled !== true || mapping.route_acceptance_enabled !== true) {
                throw new FiscalSaleRouteError('fiscal_route_acceptance_disabled', 'Selected fiscal register does not accept new payments', { status: 503 });
            }
            if (!sequentialState.ready) {
                throw new FiscalSaleRouteError(sequentialState.reasonCode, 'Shared test register cannot switch business context yet', { status: 409 });
            }
        }
        return {
            routeOptionId: route.id,
            businessContext: route.businessContext,
            businessLabel: route.businessLabel,
            mode: route.mode,
            registerLabel: route.registerLabel,
            expectedIsTest,
            sharedTestRegister: route.sharedTestRegister === true,
            sharedRegisterGroup: route.sharedTestRegister ? mapping.shared_register_group : null,
            sequentialState,
            mapping
        };
    } finally {
        if (ownsClient) queryable.release();
    }
}

function projectRouteOption(route, resolved = null, error = null) {
    const mapping = resolved?.mapping || null;
    const configured = Boolean(mapping);
    return {
        id: route.id,
        businessContext: route.businessContext,
        businessLabel: route.businessLabel,
        mode: route.mode,
        registerLabel: route.mode === 'test' ? route.registerLabel : (mapping?.register_display_name || route.registerLabel),
        status: mapping?.route_status || (configured ? 'draft' : 'missing'),
        configured,
        featureEnabled: mapping?.feature_enabled === true && mapping?.route_feature_enabled === true,
        acceptanceEnabled: mapping?.acceptance_enabled === true && mapping?.route_acceptance_enabled === true,
        sequentialReady: resolved?.sequentialState?.ready === true,
        readinessCode: error?.code || resolved?.sequentialState?.reasonCode || (
            !configured ? 'fiscal_route_mapping_missing'
                : mapping.fiscal_register_status !== 'active' || mapping.route_status !== 'active' ? 'register_inactive'
                    : mapping.feature_enabled !== true || mapping.route_feature_enabled !== true ? 'register_disabled'
                        : mapping.acceptance_enabled !== true || mapping.route_acceptance_enabled !== true ? 'payment_acceptance_disabled'
                            : 'ready'
        )
    };
}

async function listFiscalSaleRouteOptions({
    dbPool = pool,
    user,
    canUseActionFn = canUseAction,
    canAccessBusinessContextFn = canAccessBusinessContext
} = {}) {
    const options = [];
    for (const route of Object.values(ROUTE_OPTIONS)) {
        try {
            assertRouteVisibleToUser(route, user, { canUseActionFn, canAccessBusinessContextFn });
        } catch {
            continue;
        }
        try {
            const resolved = await resolveFiscalSaleRoute({
                dbPool,
                user,
                routeOptionId: route.id,
                canUseActionFn,
                canAccessBusinessContextFn
            });
            options.push(projectRouteOption(route, resolved));
        } catch (error) {
            if (
                error?.code === 'fiscal_route_mapping_ambiguous'
                || error?.code === 'fiscal_route_mode_mismatch'
                || error?.code === 'fiscal_shared_register_group_drift'
            ) {
                options.push(projectRouteOption(route, null, error));
            } else if (error?.code === 'fiscal_route_mapping_missing') {
                options.push(projectRouteOption(route));
            } else {
                throw error;
            }
        }
    }
    return options;
}

module.exports = {
    CLIENT_FISCAL_FIELDS,
    FiscalSaleRouteError,
    ROUTE_OPTIONS,
    assertNoClientFiscalRouteOverride,
    assertRouteVisibleToUser,
    booleanOrNull,
    listFiscalSaleRouteOptions,
    loadRouteMapping,
    normalizeRouteOptionId,
    projectRouteOption,
    resolveFiscalSaleRoute,
    routeOptionFromInput,
    sharedTestRegisterState
};

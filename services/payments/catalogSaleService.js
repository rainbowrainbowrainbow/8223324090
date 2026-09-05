'use strict';

const crypto = require('node:crypto');
const { pool } = require('../../db');
const { authorizeFiscalActorAction } = require('./fiscalAccess');
const { normalizeTender } = require('./paymentStateMachine');
const { toPostgresBigint } = require('./money');
const {
    PaymentServiceError,
    authorizeOrderReplay,
    assertCheckboxIntegrationReady,
    findOrderByIdempotency,
    fingerprint,
    loadFiscalItemMappings,
    loadOrderSnapshot,
    loadSelectedCashierBinding,
    normalizePaymentOrder,
    requireIdempotencyKey,
    withTransaction
} = require('./paymentService');
const { assertPaymentReadiness } = require('./paymentReadinessService');
const {
    isCheckboxIntegrationEnabled,
    isCheckboxPaymentAcceptanceEnabled
} = require('../checkbox/config');
const {
    assertNoClientFiscalRouteOverride,
    resolveFiscalSaleRoute
} = require('./fiscalSaleRouteService');

const CATALOG_SOURCE_TYPE = 'catalog_sale';
const BUSINESS_SCOPES = Object.freeze({
    event_genix: Object.freeze({ crmProfileKey: 'event_genix', locationAlias: 'park', registerAlias: 'middle' }),
    dar: Object.freeze({ crmProfileKey: 'dar', locationAlias: 'dar', registerAlias: 'dar' })
});

function scopeForBusiness(value) {
    const key = String(value || '').trim().toLowerCase();
    const scope = BUSINESS_SCOPES[key];
    if (!scope) throw new PaymentServiceError('catalog_business_context_invalid', 'Unknown catalog business context', { status: 422 });
    return scope;
}

function defaultRouteOptionIdForBusiness(value) {
    return scopeForBusiness(value).crmProfileKey === 'dar' ? 'dar_production' : 'park_production';
}

function normalizeRouteOption(body = {}, businessContext = null) {
    return String(
        body.routeOptionId
        ?? body.route_option_id
        ?? defaultRouteOptionIdForBusiness(businessContext ?? body.businessContext ?? body.business_context)
    ).trim().toLowerCase();
}

async function resolveCatalogRoute({
    client,
    dbPool,
    user,
    routeOptionId,
    businessContext,
    requireMutationReady = false,
    routeResolver = resolveFiscalSaleRoute
} = {}) {
    return routeResolver({
        client,
        dbPool,
        user,
        routeOptionId,
        businessContext,
        requireMutationReady
    });
}

function normalizeLines(input) {
    if (!Array.isArray(input) || input.length === 0) throw new PaymentServiceError('catalog_items_required', 'At least one catalog item is required', { status: 422 });
    return input.map((line, index) => {
        if (line.price != null || line.amount != null || line.unitPrice != null || line.unit_price != null) {
            throw new PaymentServiceError('client_payment_field_forbidden', 'Client price is forbidden', { status: 422, details: { line: index + 1 } });
        }
        const itemCode = String(line.itemCode || line.item_code || '').trim();
        const quantityMillis = Number(line.quantityMillis ?? line.quantity_millis ?? 1000);
        if (!itemCode || !Number.isSafeInteger(quantityMillis) || quantityMillis <= 0) throw new PaymentServiceError('catalog_line_invalid', 'Catalog item code and positive quantity are required', { status: 422, details: { line: index + 1 } });
        return { itemCode, quantityMillis };
    });
}

async function loadCatalog(client, businessContext, lines) {
    const codes = [...new Set(lines.map(line => line.itemCode))];
    const result = await client.query(
        `SELECT p.id, p.name, p.category, p.serving_unit, p.sale_config, pr.id AS price_rule_id,
                pr.code AS price_rule_code, pr.value AS price_uah
           FROM products p
           JOIN price_rules pr ON pr.product_id = p.id
          WHERE p.business_context = $1 AND p.id = ANY($2::text[])
            AND p.is_active = TRUE AND COALESCE(p.availability_status, 'active') = 'active'
            AND pr.value > 0
          FOR SHARE OF p, pr`,
        [businessContext, codes]
    );
    const grouped = new Map();
    for (const row of result.rows) {
        if (grouped.has(row.id)) throw new PaymentServiceError('catalog_price_ambiguous', 'Catalog price is ambiguous', { status: 409, details: { itemCode: row.id } });
        grouped.set(row.id, row);
    }
    const missing = codes.filter(code => !grouped.has(code));
    if (missing.length) throw new PaymentServiceError('catalog_item_unavailable', 'Catalog item is missing, inactive, zero-priced, or ambiguous', { status: 409, details: { itemCodes: missing } });
    return grouped;
}

async function loadDiscounts(client, businessContext, requested) {
    const codes = [...new Set((requested || []).map(value => String(value).trim()).filter(Boolean))];
    if (!codes.length) return new Map();
    const result = await client.query(`SELECT * FROM sales_discount_rules WHERE business_context=$1 AND code=ANY($2::text[]) AND is_active=TRUE`, [businessContext, codes]);
    const byCode = new Map(result.rows.map(row => [row.code, row]));
    const missing = codes.filter(code => !byCode.has(code));
    if (missing.length) throw new PaymentServiceError('catalog_discount_invalid', 'Discount rule is unavailable', { status: 422, details: { codes: missing } });
    return byCode;
}

function quoteLines(lines, catalog, discounts) {
    const secondDirection = discounts.get('dar_second_club_direction_10');
    const ubd = discounts.get('dar_ubd_20');
    const firstDirection = lines.map(line => catalog.get(line.itemCode).sale_config?.club_direction).find(Boolean) || null;
    return lines.map((line, index) => {
        const product = catalog.get(line.itemCode);
        const config = product.sale_config || {};
        const step = Number(config.quantity_step_millis || 1000);
        const minimum = Number(config.minimum_quantity_millis || 1000);
        if (line.quantityMillis < minimum || line.quantityMillis % step !== 0) throw new PaymentServiceError('catalog_quantity_invalid', 'Catalog quantity violates item rules', { status: 422, details: { itemCode: line.itemCode, minimumQuantityMillis: minimum, quantityStepMillis: step } });
        let discount = ubd || null;
        if (!discount && secondDirection && config.club_direction && config.club_direction !== firstDirection) discount = secondDirection;
        const originalUnitMinor = BigInt(product.price_uah) * 100n;
        const rateBps = BigInt(discount?.rate_bps || 0);
        const finalUnitMinor = (originalUnitMinor * (10000n - rateBps) + 5000n) / 10000n;
        const totalMinor = finalUnitMinor * BigInt(line.quantityMillis) / 1000n;
        return { index: index + 1, product, quantityMillis: BigInt(line.quantityMillis), originalUnitMinor, discountMinor: originalUnitMinor - finalUnitMinor, finalUnitMinor, totalMinor, discount };
    });
}

async function listCatalogItems({ dbPool = pool, businessContext, routeOptionId, user, authorizer = authorizeFiscalActorAction, routeResolver = resolveFiscalSaleRoute } = {}) {
    const sourceScope = scopeForBusiness(businessContext);
    const client = await dbPool.connect();
    try {
        const route = await resolveCatalogRoute({
            client,
            user,
            routeOptionId: routeOptionId || defaultRouteOptionIdForBusiness(sourceScope.crmProfileKey),
            businessContext: sourceScope.crmProfileKey,
            routeResolver
        });
        const mapping = route.mapping;
        await authorizer(client, { user, action: 'payments.view', crmProfileKey: route.businessContext });
        const result = await client.query(
            `SELECT p.id AS item_code,p.name,p.category,p.serving_unit AS unit,MIN(pr.value) AS price_uah,p.sale_config
               FROM products p JOIN price_rules pr ON pr.product_id=p.id
              WHERE p.business_context=$1 AND p.is_active=TRUE
                AND COALESCE(p.availability_status,'active')='active' AND pr.value>0
              GROUP BY p.id,p.name,p.category,p.serving_unit,p.sale_config
             HAVING COUNT(*)=1
              ORDER BY p.category,p.name,p.id`,
            [route.businessContext]
        );
        return result.rows.map(row => ({ itemCode:row.item_code,name:row.name,category:row.category,unit:row.unit,priceMinor:String(BigInt(row.price_uah)*100n),quantityRule:row.sale_config || {},priceSource:'price_rules',taxMode:'untaxed' }));
    } finally {
        client.release();
    }
}

async function listCatalogDiscounts({ dbPool = pool, businessContext, routeOptionId, user, authorizer = authorizeFiscalActorAction, routeResolver = resolveFiscalSaleRoute } = {}) {
    const sourceScope = scopeForBusiness(businessContext);
    const client = await dbPool.connect();
    try {
        const route = await resolveCatalogRoute({
            client,
            user,
            routeOptionId: routeOptionId || defaultRouteOptionIdForBusiness(sourceScope.crmProfileKey),
            businessContext: sourceScope.crmProfileKey,
            routeResolver
        });
        const mapping = route.mapping;
        await authorizer(client, { user, action: 'payments.view', crmProfileKey: route.businessContext });
        const result = await client.query(
            `SELECT code,name,rate_bps,eligibility_mode
               FROM sales_discount_rules
              WHERE business_context=$1 AND is_active=TRUE
              ORDER BY name,code`,
            [route.businessContext]
        );
        return result.rows.map(row => ({
            code: row.code,
            name: row.name,
            rateBps: Number(row.rate_bps),
            eligibilityMode: row.eligibility_mode
        }));
    } finally {
        client.release();
    }
}

async function createCatalogSalePaymentOrder({
    dbPool = pool,
    user,
    body = {},
    idempotencyKey,
    authorizer = authorizeFiscalActorAction,
    routeResolver = resolveFiscalSaleRoute,
    env = process.env,
    requireCheckboxIntegrationReady = false
} = {}) {
    const key = requireIdempotencyKey(idempotencyKey);
    assertNoClientFiscalRouteOverride(body);
    const sourceScope = scopeForBusiness(body.businessContext || body.business_context);
    const routeOptionId = normalizeRouteOption(body, sourceScope.crmProfileKey);
    const selectedCashierBindingId = Number(body.cashierBindingId ?? body.cashier_binding_id);
    if (!Number.isSafeInteger(selectedCashierBindingId) || selectedCashierBindingId <= 0) {
        throw new PaymentServiceError('cashier_binding_required', 'Select an active Checkbox cashier', { status: 422 });
    }
    const lines = normalizeLines(body.items);
    const { tender, paymentMethod } = normalizeTender(body.tender || body.paymentMethod || body.payment_method);
    const discountCodes = body.discountCodes || body.discount_codes || [];
    const requestFingerprint = fingerprint({ endpoint: 'create_catalog_sale_payment_order', businessContext: sourceScope.crmProfileKey, routeOptionId, selectedCashierBindingId, tender, lines, discountCodes });
    return withTransaction(dbPool, async client => {
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [key]);
        const route = await resolveCatalogRoute({
            client,
            user,
            routeOptionId,
            businessContext: sourceScope.crmProfileKey,
            requireMutationReady: requireCheckboxIntegrationReady,
            routeResolver
        });
        const mapping = route.mapping;
        await authorizer(client, { user, action: 'payments.create', crmProfileKey: route.businessContext });
        const existing = await findOrderByIdempotency(client, key);
        if (existing) {
            const order = await loadOrderSnapshot(client, existing.id);
            await authorizeOrderReplay(client, {
                user,
                order,
                action: 'payments.create',
                authorizer,
                expectedFiscalProfileId: mapping.fiscal_profile_id,
                expectedFiscalRegisterId: mapping.fiscal_register_id,
                expectedBusinessContext: route.businessContext,
                expectedRouteOptionId: route.routeOptionId,
                authorizationCrmProfileKey: route.businessContext,
                requestFingerprint
            });
            return { replayed: true, order: normalizePaymentOrder(order) };
        }
        const selectedBinding = await loadSelectedCashierBinding(client, {
            bindingId: selectedCashierBindingId,
            fiscalProfileId: mapping.fiscal_profile_id,
            fiscalRegisterId: mapping.fiscal_register_id
        });
        if (requireCheckboxIntegrationReady) {
            if (!isCheckboxIntegrationEnabled(env)) {
                throw new PaymentServiceError('checkbox_integration_disabled', 'Checkbox integration is disabled', { status: 503 });
            }
            if (!isCheckboxPaymentAcceptanceEnabled(env)) {
                throw new PaymentServiceError('checkbox_payment_acceptance_disabled', 'Checkbox payment acceptance is disabled', { status: 503 });
            }
            await assertCheckboxIntegrationReady(client, {
                env,
                user,
                cashierUserId: selectedBinding.user_id,
                cashierBindingId: selectedBinding.id,
                binding: selectedBinding,
                fiscalProfileId: mapping.fiscal_profile_id,
                fiscalRegisterId: mapping.fiscal_register_id,
                registerStatus: mapping.fiscal_register_status,
                registerFeatureEnabled: mapping.feature_enabled === true,
                registerAcceptanceEnabled: mapping.acceptance_enabled === true,
                registerExpectedIsTest: mapping.register_expected_is_test,
                provider: mapping.provider,
                providerLicenseRef: mapping.provider_license_ref
            });
            await assertPaymentReadiness({
                client,
                user,
                cashierUserId: selectedBinding.user_id,
                cashierBindingId: selectedBinding.id,
                fiscalProfileId: mapping.fiscal_profile_id,
                fiscalLocationId: mapping.fiscal_location_id,
                fiscalRegisterId: mapping.fiscal_register_id,
                crmProfileKey: mapping.crm_profile_key,
                authorizationCrmProfileKey: route.businessContext,
                locationAlias: mapping.location_alias,
                registerAlias: mapping.register_alias,
                action: 'payments.create',
                tender,
                env
            });
        }
        const catalog = await loadCatalog(client, route.businessContext, lines);
        const discounts = await loadDiscounts(client, route.businessContext, discountCodes);
        const quote = quoteLines(lines, catalog, discounts);
        const fiscalMappings = await loadFiscalItemMappings(client, {
            fiscalProfileId: mapping.fiscal_profile_id,
            fiscalRegisterId: mapping.fiscal_register_id,
            crmProfileKey: mapping.crm_profile_key,
            businessContext: route.businessContext,
            lines,
            sourceType: CATALOG_SOURCE_TYPE,
            itemType: CATALOG_SOURCE_TYPE
        });
        for (const row of fiscalMappings.values()) {
            if (
                row.tax_mode !== 'untaxed'
                || row.provider_tax_id
                || row.tax_code != null
                || row.tax_rate_bps != null
            ) {
                throw new PaymentServiceError('catalog_tax_mode_invalid', 'Catalog items must be untaxed', { status: 409 });
            }
        }
        const total = quote.reduce((sum, line) => sum + line.totalMinor, 0n);
        const sourceId = `catalog_${crypto.randomUUID()}`;
        const orderKey = `${CATALOG_SOURCE_TYPE}:${route.businessContext}:${sourceId}`;
        const sourceSnapshot = {
            source: CATALOG_SOURCE_TYPE,
            request_fingerprint: requestFingerprint,
            business_context: route.businessContext,
            route_option_id: route.routeOptionId,
            register_mode: route.mode,
            shared_test_register: route.sharedTestRegister === true,
            selected_cashier_binding_id: Number(selectedBinding.id),
            tender
        };
        const inserted = await client.query(`INSERT INTO payment_orders (fiscal_profile_id,fiscal_register_id,cashier_user_id,selected_fiscal_cashier_binding_id,source_type,source_id,order_key,idempotency_key,status,payment_status,fiscal_status,payment_method,total_amount_minor,currency,source_snapshot,created_by_user_id,fiscal_sale_route_option_id,business_context) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft','unpaid','pending',$9,$10,'UAH',$11::jsonb,$12,$13,$14) RETURNING *`, [mapping.fiscal_profile_id,mapping.fiscal_register_id,selectedBinding.user_id,selectedBinding.id,CATALOG_SOURCE_TYPE,sourceId,orderKey,key,paymentMethod,toPostgresBigint(total),JSON.stringify(sourceSnapshot),user?.id || null,route.routeOptionId,route.businessContext]);
        const order = inserted.rows[0];
        for (const line of quote) {
            const fm = fiscalMappings.get(line.product.id);
            await client.query(`INSERT INTO payment_order_items (fiscal_profile_id,payment_order_id,line_number,item_type,item_code,item_name,unit_price_minor,quantity_millis,total_amount_minor,currency,tax_reference,tax_code,tax_rate_bps,provider_tax_id,tax_mode,item_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'UAH',$10,NULL,NULL,NULL,'untaxed',$11::jsonb)`, [order.fiscal_profile_id,order.id,line.index,CATALOG_SOURCE_TYPE,line.product.id,fm.fiscal_item_name,toPostgresBigint(line.finalUnitMinor),toPostgresBigint(line.quantityMillis),toPostgresBigint(line.totalMinor),`price_rule:${line.product.price_rule_id}`,JSON.stringify({ original_unit_price_minor:String(line.originalUnitMinor),discount_amount_minor:String(line.discountMinor),final_unit_price_minor:String(line.finalUnitMinor),quantity_millis:String(line.quantityMillis),price_source:'price_rules',price_rule_id:Number(line.product.price_rule_id),price_rule_code:line.product.price_rule_code,discount_rule_code:line.discount?.code || null,fiscal_item_mapping_id:Number(fm.id) })]);
        }
        await client.query(`INSERT INTO fiscal_audit_events (fiscal_profile_id,actor_user_id,event_type,entity_table,entity_id,idempotency_key,after_snapshot) VALUES ($1,$2,'payment_order_created','payment_orders',$3,$4,$5::jsonb)`, [order.fiscal_profile_id,user?.id || null,order.id,key,JSON.stringify({ source_type: CATALOG_SOURCE_TYPE, total_amount_minor:String(total) })]);
        return { replayed: false, order: normalizePaymentOrder(order) };
    });
}

module.exports = {
    BUSINESS_SCOPES,
    CATALOG_SOURCE_TYPE,
    createCatalogSalePaymentOrder,
    defaultRouteOptionIdForBusiness,
    listCatalogDiscounts,
    listCatalogItems,
    normalizeLines,
    normalizeRouteOption,
    quoteLines,
    resolveCatalogRoute,
    scopeForBusiness
};

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCatalogSalePaymentOrder, normalizeLines, quoteLines, scopeForBusiness } = require('../services/payments/catalogSaleService');
const { assertNoSecrets, listSelectableCashiers, projectSelectable, updateCashierBinding } = require('../services/payments/cashierBindingAdminService');
const { loadSelectedCashierBinding } = require('../services/payments/paymentService');

test('catalog sale derives fiscal scope from business and rejects unknown context', () => {
    assert.deepEqual(scopeForBusiness('event_genix'), { crmProfileKey: 'event_genix', locationAlias: 'park', registerAlias: 'middle' });
    assert.deepEqual(scopeForBusiness('dar'), { crmProfileKey: 'dar', locationAlias: 'dar', registerAlias: 'dar' });
    assert.throws(() => scopeForBusiness('mixed'), /Unknown catalog business/);
});

test('catalog sale never accepts a browser price', () => {
    assert.throws(() => normalizeLines([{ itemCode: 'dar_logic_single', quantityMillis: 1000, price: 1 }]), /Client price is forbidden/);
});

test('weekend hourly care enforces two-hour minimum', () => {
    const catalog = new Map([['dar_hourly_care_weekend', { id: 'dar_hourly_care_weekend', price_uah: 350, sale_config: { quantity_step_millis: 1000, minimum_quantity_millis: 2000 } }]]);
    assert.throws(() => quoteLines([{ itemCode: 'dar_hourly_care_weekend', quantityMillis: 1000 }], catalog, new Map()), /quantity violates/);
    const [line] = quoteLines([{ itemCode: 'dar_hourly_care_weekend', quantityMillis: 2000 }], catalog, new Map());
    assert.equal(line.totalMinor, 70000n);
});

test('UBD discount produces the final unit price sent to Checkbox snapshot', () => {
    const catalog = new Map([['dar_logic_single', { id: 'dar_logic_single', price_uah: 300, sale_config: {} }]]);
    const discounts = new Map([['dar_ubd_20', { code: 'dar_ubd_20', rate_bps: 2000 }]]);
    const [line] = quoteLines([{ itemCode: 'dar_logic_single', quantityMillis: 1000 }], catalog, discounts);
    assert.equal(line.originalUnitMinor, 30000n);
    assert.equal(line.discountMinor, 6000n);
    assert.equal(line.finalUnitMinor, 24000n);
});

test('cashier administration rejects secret material', () => {
    assert.throws(() => assertNoSecrets({ cashierName: 'Test', password: 'never-store-this' }), /environment variables/);
    assert.doesNotThrow(() => assertNoSecrets({ cashierName: 'Test', cashierLogin: 'test.login' }));
});

test('DAR seed contains exactly 21 products and discounts are separate rules', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '347_dar_catalog_2026_2027.sql'), 'utf8');
    const seedBlock = sql.slice(0, sql.indexOf('INSERT INTO products'));
    const productRows = seedBlock.match(/^ \('dar_[^\n]+\)[,]?$/gm) || [];
    assert.equal(productRows.length, 21);
    assert.match(sql, /dar_ubd_20/);
    assert.doesNotMatch(sql, /INSERT INTO products[^;]+dar_ubd_20/s);
});

test('safe cashier list is scoped separately for PARK and DAR', async () => {
    const calls = [];
    const dbPool = {
        async connect() {
            return {
                release() {},
                async query(sql, params) {
                    const normalized = String(sql).replace(/\s+/g, ' ');
                    assert.match(normalized, /fcb\.provider='checkbox'/);
                    assert.match(normalized, /metadata->>'expectedIsTest'/);
                    calls.push(params);
                    const isDar = params[0] === 21;
                    return { rows: [{ id: isDar ? 22 : 11, cashier_name: isDar ? 'DAR cashier' : 'PARK cashier', status: 'active', expected_is_test: true, provider_cashier_login_ref: 'must-not-leak' }] };
                }
            };
        }
    };
    const routeResolver = async ({ businessContext }) => ({
        mapping: {
            fiscal_profile_id: businessContext === 'dar' ? 21 : 20,
            fiscal_location_id: businessContext === 'dar' ? 31 : 30,
            fiscal_register_id: businessContext === 'dar' ? 41 : 40,
            crm_profile_key: businessContext
        }
    });
    const park = await listSelectableCashiers({ dbPool, businessContext: 'event_genix', routeOptionId: 'park_production', user: { id: 50 }, authorizer: async () => ({ ok: true }), routeResolver });
    const dar = await listSelectableCashiers({ dbPool, businessContext: 'dar', routeOptionId: 'dar_production', user: { id: 50 }, authorizer: async () => ({ ok: true }), routeResolver });
    assert.deepEqual(calls, [[20, 40], [21, 41]]);
    assert.deepEqual(park, [{ id: 11, cashierName: 'PARK cashier', status: 'active', mode: 'test' }]);
    assert.deepEqual(dar, [{ id: 22, cashierName: 'DAR cashier', status: 'active', mode: 'test' }]);
    assert.equal(JSON.stringify([...park, ...dar]).includes('credential'), false);
    assert.equal(JSON.stringify([...park, ...dar]).includes('login'), false);
});

test('cashier admin register mode supports canonical and legacy metadata keys', () => {
    const service = fs.readFileSync(path.join(__dirname, '..', 'services', 'payments', 'cashierBindingAdminService.js'), 'utf8');
    assert.equal((service.match(/metadata->>'expected_is_test'/g) || []).length, 2);
    assert.equal((service.match(/metadata->>'expectedIsTest'/g) || []).length, 2);
});

test('public cashier projection never exposes provider or credential fields', () => {
    const publicRow = projectSelectable({ id: 1, cashier_name: 'Cashier', status: 'active', expected_is_test: false, cashier_login: 'hidden', provider_cashier_id: 'hidden', provider_cashier_login_ref: 'hidden' });
    assert.deepEqual(publicRow, { id: 1, cashierName: 'Cashier', status: 'active', mode: 'production' });
});

test('selected cashier binding must belong to the derived register', async () => {
    const client = { query: async () => ({ rows: [] }) };
    await assert.rejects(
        () => loadSelectedCashierBinding(client, { bindingId: 7, fiscalProfileId: 20, fiscalRegisterId: 40 }),
        error => error.code === 'cashier_binding_scope_invalid'
    );
});

test('selected cashier binding lookup requires active Checkbox binding with credential reference', async () => {
    for (const invalidState of ['suspended', 'draft', 'archived', 'missing-reference']) {
        const client = {
            async query(sql) {
                assert.match(sql, /provider = 'checkbox'/);
                assert.match(sql, /status = 'active'/);
                assert.match(sql, /NULLIF\(BTRIM\(provider_cashier_login_ref\), ''\) IS NOT NULL/);
                return { rows: [] };
            }
        };
        await assert.rejects(
            () => loadSelectedCashierBinding(client, { bindingId: 7, fiscalProfileId: 20, fiscalRegisterId: 40 }),
            error => error.code === 'cashier_binding_scope_invalid',
            invalidState
        );
    }
});

test('catalog order rejects every browser fiscal/register override before touching DB', async () => {
    const dbPool = { connect: async () => { throw new Error('database must not be touched'); } };
    for (const field of [
        'fiscalProfileId',
        'fiscal_profile_id',
        'fiscalRegisterId',
        'fiscal_register_id',
        'locationAlias',
        'location_alias',
        'registerAlias',
        'register_alias',
        'providerRegisterId',
        'provider_register_id',
        'cashierId',
        'credentialReference',
        'isTest'
    ]) {
        await assert.rejects(
            () => createCatalogSalePaymentOrder({
                dbPool,
                user: { id: 50 },
                body: { businessContext: 'dar', routeOptionId: 'dar_production', [field]: 'browser-value', cashierBindingId: 7, tender: 'cash', items: [{ itemCode: 'dar_logic_single' }] },
                idempotencyKey: `scope-override-${field}`
            }),
            error => error.code === 'client_fiscal_scope_forbidden',
            field
        );
    }
});

class CatalogFakeDb {
    constructor() {
        this.orders = [];
        this.items = [];
        this.orderInsertCount = 0;
        this.bindingQueryCount = 0;
        this.bindingAvailable = true;
        this.mappingProviderTaxId = null;
        this.mappingTaxCode = null;
        this.mappingTaxRateBps = null;
    }
    async connect() { return this; }
    release() {}
    async query(sql, params = []) {
        if (sql.includes('FROM fiscal_register_payment_drains')) return { rows: [] };
        const normalized = String(sql).replace(/\s+/g, ' ').trim();
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalized) || normalized.includes('pg_advisory_xact_lock')) return { rows: [] };
        if (normalized.includes('FROM fiscal_sale_routes fsr')) return { rows: [{ route_option_id: 'park_production', route_business_context: 'event_genix', route_mode: 'production', route_expected_is_test: false, route_status: 'active', route_feature_enabled: true, route_acceptance_enabled: true, shared_register_group: null, fiscal_profile_id: 20, fiscal_location_id: 30, fiscal_register_id: 40, crm_profile_key: 'event_genix', location_alias: 'park', register_alias: 'middle', legal_entity_key: 'park_fop', legal_entity_name: 'Park FOP', provider: 'checkbox', provider_license_ref: 'register-ref', fiscal_register_status: 'active', feature_enabled: true, acceptance_enabled: true, register_expected_is_test: false }] };
        if (normalized.includes('FROM fiscal_cashier_bindings') && normalized.includes('WHERE id = $1')) {
            this.bindingQueryCount += 1;
            return { rows: this.bindingAvailable ? [{ id: 7, fiscal_profile_id: 20, fiscal_register_id: 40, user_id: 77, provider_cashier_id: 'cashier-test', provider_cashier_login_ref: 'cashier-ref', cashier_name: 'Selected cashier', status: 'active' }] : [] };
        }
        if (normalized.includes('FROM payment_orders') && normalized.includes('WHERE idempotency_key = $1')) return { rows: this.orders.filter(row => row.idempotency_key === params[0]).slice(0, 1) };
        if (normalized.includes('FROM products p') && normalized.includes('JOIN price_rules pr')) return { rows: [{ id: 'park_token', name: 'Жетон', category: 'Парк', serving_unit: 'шт', sale_config: {}, price_rule_id: 90, price_rule_code: 'park_token_price', price_uah: 20 }] };
        if (normalized.includes('FROM sales_discount_rules')) return { rows: [] };
        if (normalized.includes('FROM fiscal_item_mappings')) return { rows: [{ id: 700, item_code: 'park_token', fiscal_item_name: 'Жетон', tax_mode: 'untaxed', provider_tax_id: this.mappingProviderTaxId, tax_code: this.mappingTaxCode, tax_rate_bps: this.mappingTaxRateBps }] };
        if (normalized.startsWith('INSERT INTO payment_orders')) {
            this.orderInsertCount += 1;
            const row = { id: 1, fiscal_profile_id: params[0], fiscal_register_id: params[1], cashier_user_id: params[2], selected_fiscal_cashier_binding_id: params[3], source_type: params[4], source_id: params[5], order_key: params[6], idempotency_key: params[7], status: 'draft', payment_status: 'unpaid', fiscal_status: 'pending', payment_method: params[8], total_amount_minor: params[9], currency: 'UAH', source_snapshot: JSON.parse(params[10]), created_by_user_id: params[11], fiscal_sale_route_option_id: params[12], business_context: params[13], confirmation_snapshot: {} };
            this.orders.push(row);
            return { rows: [row] };
        }
        if (normalized.startsWith('INSERT INTO payment_order_items')) { this.items.push(params); return { rows: [] }; }
        if (normalized.startsWith('INSERT INTO fiscal_audit_events')) return { rows: [] };
        if (normalized.includes('FROM payment_orders po') && normalized.includes('JOIN fiscal_profiles fp')) {
            const row = this.orders.find(order => order.id === Number(params[0]));
            return { rows: row ? [{ ...row, fiscal_location_id: 30, crm_profile_key: 'event_genix', location_alias: 'park', register_alias: 'middle', route_status: 'active', route_feature_enabled: true, route_acceptance_enabled: true, route_expected_is_test: false, register_expected_is_test: false }] : [] };
        }
        throw new Error(`Unhandled catalog fake query: ${normalized}`);
    }
}

test('catalog idempotency replays one order and keeps operator separate from selected cashier', async () => {
    const dbPool = new CatalogFakeDb();
    const input = { dbPool, user: { id: 50, role: 'creator', businessContexts: ['event_genix', 'dar'] }, body: { businessContext: 'event_genix', routeOptionId: 'park_production', cashierBindingId: 7, tender: 'cash', items: [{ itemCode: 'park_token', quantityMillis: 1000 }] }, idempotencyKey: 'catalog-once', authorizer: async () => ({ ok: true }) };
    const first = await createCatalogSalePaymentOrder(input);
    dbPool.bindingAvailable = false;
    const replay = await createCatalogSalePaymentOrder(input);
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(dbPool.orderInsertCount, 1);
    assert.equal(dbPool.bindingQueryCount, 1);
    assert.equal(dbPool.orders[0].cashier_user_id, 77);
    assert.equal(dbPool.orders[0].selected_fiscal_cashier_binding_id, 7);
    assert.equal(dbPool.orders[0].created_by_user_id, 50);
    assert.equal(dbPool.orders[0].fiscal_register_id, 40);
});

test('catalog sale rejects untaxed mappings with residual tax metadata', async () => {
    for (const [field, value] of [['mappingProviderTaxId', 'unexpected-tax-id'], ['mappingTaxCode', 'legacy-tax-code'], ['mappingTaxRateBps', 2000]]) {
        const dbPool = new CatalogFakeDb();
        dbPool[field] = value;
        await assert.rejects(
            () => createCatalogSalePaymentOrder({
                dbPool,
                user: { id: 50, role: 'creator', businessContexts: ['event_genix'] },
                body: { businessContext: 'event_genix', routeOptionId: 'park_production', cashierBindingId: 7, tender: 'cash', items: [{ itemCode: 'park_token', quantityMillis: 1000 }] },
                idempotencyKey: `catalog-tax-metadata-${field}`,
                authorizer: async () => ({ ok: true })
            }),
            error => field === 'mappingProviderTaxId'
                ? error.code === 'fiscal_item_tax_mapping_missing'
                : error.code === 'catalog_tax_mode_invalid',
            field
        );
        assert.equal(dbPool.orderInsertCount, 0);
    }
});

test('catalog order items persist untaxed fields as NULL literals', () => {
    const service = fs.readFileSync(path.join(__dirname, '..', 'services', 'payments', 'catalogSaleService.js'), 'utf8');
    assert.match(service, /tax_reference,tax_code,tax_rate_bps,provider_tax_id,tax_mode,item_snapshot\)[\s\S]*\$10,NULL,NULL,NULL,'untaxed',\$11::jsonb/);
});

test('cashier admin routes retain fiscal.configure while public list uses payments.create', () => {
    const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'payments.js'), 'utf8');
    assert.match(routes, /get\('\/catalog\/cashiers', requireAction\('payments\.create'\)/);
    assert.match(routes, /put\('\/fiscal-bindings\/cashiers\/:bindingId', requireAction\('fiscal\.configure'\)/);
});

test('cashier metadata audit stores no display name, login or credential material', async () => {
    let auditSnapshot = null;
    const client = {
        release() {},
        async query(sql, params = []) {
            const normalized = String(sql).replace(/\s+/g, ' ').trim();
            if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalized)) return { rows: [] };
            if (normalized.startsWith('UPDATE fiscal_cashier_bindings')) return { rows: [{ fiscal_profile_id: 20, id: 7 }] };
            if (normalized.startsWith('INSERT INTO fiscal_audit_events')) {
                auditSnapshot = JSON.parse(params[3]);
                return { rows: [] };
            }
            throw new Error(`Unhandled admin audit query: ${normalized}`);
        }
    };
    const dbPool = { connect: async () => client };
    await updateCashierBinding({
        dbPool,
        bindingId: 7,
        body: { cashierName: 'Visible name', cashierLogin: 'private.login' },
        actorUserId: 50
    });
    assert.deepEqual(auditSnapshot, { updated_fields_count: 2 });
    const serialized = JSON.stringify(auditSnapshot);
    assert.doesNotMatch(serialized, /login|credential|provider.*id|Visible name|private\.login|password|secret|pin|license|access.?key|device|token/i);
    await assert.rejects(
        updateCashierBinding({ dbPool, bindingId: 7, body: { cashierName: 'Visible name', cashierLogin: 'private.login', providerCashierId: 'forbidden' }, actorUserId: 50 }),
        error => error.code === 'cashier_metadata_field_forbidden'
    );
});

test('cashier sale UI exposes only safe route and cashier selectors', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'cashier-payments.html'), 'utf8');
    const script = fs.readFileSync(path.join(__dirname, '..', 'js', 'cashier-payments-page.js'), 'utf8');
    assert.match(html, /id="paymentCashierBinding"/);
    assert.match(html, /id="paymentBusinessContext"/);
    assert.match(html, /id="paymentRegisterRoute"/);
    assert.match(script, /cashierBindingId/);
    assert.match(script, /routeOptionId/);
    assert.match(script, /\/api\/payments\/catalog\/cashiers/);
    assert.doesNotMatch(html, /id="payment(?:ProviderRegister|LocationAlias|RegisterAlias|FiscalProfile)(?:Select|Input)"/);
});

test('auto-open uses the selected fiscal cashier while preserving the authenticated actor', () => {
    const service = fs.readFileSync(path.join(__dirname, '..', 'services', 'payments', 'cashierOperationsService.js'), 'utf8');
    assert.match(service, /order\.selected_fiscal_cashier_binding_id/);
    assert.match(service, /userId:\s*order\.cashier_user_id \|\| user\?\.id/);
    assert.match(service, /bindingId:\s*order\.selected_fiscal_cashier_binding_id \|\| null/);
    assert.match(service, /actorUserId: user\?\.id/);
});

test('receipt outbox resolves credentials from the selected fiscal cashier binding', () => {
    const worker = fs.readFileSync(path.join(__dirname, '..', 'services', 'payments', 'paymentOutboxWorker.js'), 'utf8');
    assert.match(worker, /THEN COALESCE\(po\.cashier_user_id, fo\.initiated_by_user_id\)/);
    assert.match(worker, /fo\.cashier_credential_ref = fcb\.provider_cashier_login_ref/);
    assert.match(worker, /NULLIF\(BTRIM\(fcb\.provider_cashier_login_ref\), ''\) IS NOT NULL/);
});

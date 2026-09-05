'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
    APPLY_CONFIRM_ENV,
    applyCatalogSaleMappings,
    buildSafeDryRun,
    planCatalogSaleMappings
} = require('../services/payments/catalogSaleMappingConfigurator');

function catalogRows(prefix, count, updatedBy = 'local-audit-fixture') {
    return Array.from({ length: count }, (_, index) => ({
        id: `${prefix}_${String(index + 1).padStart(3, '0')}`,
        name: `${prefix.toUpperCase()} item ${index + 1}`,
        is_active: true,
        availability_status: 'active',
        updated_by: updatedBy,
        price_rule_count: 1,
        positive_price_rule_count: 1
    }));
}

function desiredRowFromParams(params) {
    return {
        fiscal_profile_id: params[0],
        fiscal_register_id: params[1],
        crm_profile_key: params[2],
        business_context: params[3],
        source_type: params[4],
        item_type: params[5],
        item_code: params[6],
        fiscal_item_name: params[7],
        provider: params[8],
        provider_tax_id: null,
        tax_code: null,
        tax_rate_bps: null,
        tax_mode: 'untaxed',
        status: 'active'
    };
}

class CatalogMappingFixtureDb {
    constructor() {
        this.targets = {
            event_genix: {
                fiscal_profile_id: 10,
                fiscal_location_id: 20,
                fiscal_register_id: 30,
                crm_profile_key: 'event_genix',
                profile_status: 'active',
                location_status: 'active',
                register_status: 'active',
                feature_enabled: false,
                register_reference_configured: true
            },
            dar: {
                fiscal_profile_id: 11,
                fiscal_location_id: 21,
                fiscal_register_id: 31,
                crm_profile_key: 'dar',
                profile_status: 'active',
                location_status: 'active',
                register_status: 'draft',
                feature_enabled: false,
                register_reference_configured: true
            }
        };
        this.routeTargets = {
            park_production: { ...this.targets.event_genix, business_context: 'event_genix', mode: 'production' },
            dar_production: { ...this.targets.dar, business_context: 'dar', mode: 'production' },
            park_test: { ...this.targets.event_genix, fiscal_register_id: 32, business_context: 'event_genix', mode: 'test' },
            dar_test: { ...this.targets.event_genix, fiscal_register_id: 32, business_context: 'dar', mode: 'test' }
        };
        this.products = {
            event_genix: [
                ...catalogRows('park', 140),
                { id: 'park_inactive', name: 'Inactive', is_active: false, availability_status: 'active', price_rule_count: 1, positive_price_rule_count: 1 },
                { id: 'park_unavailable', name: 'Unavailable', is_active: true, availability_status: 'archived', price_rule_count: 1, positive_price_rule_count: 1 },
                { id: 'park_zero', name: 'Zero', is_active: true, availability_status: 'active', price_rule_count: 1, positive_price_rule_count: 0 },
                { id: 'park_ambiguous', name: 'Ambiguous', is_active: true, availability_status: 'active', price_rule_count: 2, positive_price_rule_count: 2 }
            ],
            dar: catalogRows('dar', 21, 'migration_347_dar_catalog')
        };
        this.mappings = [];
        this.admission = {
            30: Array.from({ length: 6 }, (_, index) => `admission_${index + 1}`),
            31: [],
            '32:event_genix': Array.from({ length: 6 }, (_, index) => `admission_${index + 1}`),
            '32:dar': []
        };
        this.writeCount = 0;
    }

    async query(sql, params = []) {
        const text = String(sql);
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text.trim()) || text.includes('pg_advisory_xact_lock')) {
            return { rows: [] };
        }
        if (text.includes('catalog-sale-config:target')) {
            const target = this.targets[params[0]];
            return { rows: target ? [target] : [] };
        }
        if (text.includes('catalog-sale-config:route-target')) {
            const target = this.routeTargets[params[0]];
            return { rows: target ? [target] : [] };
        }
        if (text.includes('catalog-sale-config:products')) {
            return { rows: this.products[params[0]] || [] };
        }
        if (text.includes('catalog-sale-config:existing-mappings')) {
            return {
                rows: this.mappings.filter(row => Number(row.fiscal_profile_id) === Number(params[0])
                    && Number(row.fiscal_register_id) === Number(params[1])
                    && String(row.business_context || row.crm_profile_key) === String(params[5]))
            };
        }
        if (text.includes('catalog-sale-config:cross-scope')) return { rows: [] };
        if (text.includes('catalog-sale-config:admission-mappings')) {
            const key = `${Number(params[1])}:${String(params[3])}`;
            return { rows: (this.admission[key] || this.admission[Number(params[1])] || []).map(item_code => ({ item_code })) };
        }
        if (text.includes('catalog-sale-config:cashier-status')) {
            return { rows: [{ active_count: 2, configured_count: 2 }] };
        }
        if (text.includes('catalog-sale-config:upsert')) {
            this.writeCount += 1;
            const desired = desiredRowFromParams(params);
            const existing = this.mappings.find(row => Number(row.fiscal_profile_id) === Number(desired.fiscal_profile_id)
                && Number(row.fiscal_register_id) === Number(desired.fiscal_register_id)
                && row.item_code === desired.item_code);
            if (existing) Object.assign(existing, desired);
            else this.mappings.push(desired);
            return { rows: [] };
        }
        throw new Error(`Unhandled fixture SQL: ${text.replace(/\s+/g, ' ').trim()}`);
    }
}

test('dry-run derives exactly 140 PARK and 21 DAR mappings without database writes', async () => {
    const db = new CatalogMappingFixtureDb();
    const plan = await planCatalogSaleMappings(db);
    const output = buildSafeDryRun(plan);

    assert.equal(db.writeCount, 0);
    assert.equal(output.ready, true);
    assert.deepEqual(output.totals, { desired: 161, insert: 161, update: 0, noOp: 0, conflict: 0 });
    assert.equal(output.scopes[0].desiredCatalogCount, 140);
    assert.equal(output.scopes[1].desiredCatalogCount, 21);
    assert.equal(output.scopes[0].excluded.inactive, 1);
    assert.equal(output.scopes[0].excluded.unavailable, 1);
    assert.equal(output.scopes[0].excluded.nonPositivePrice, 1);
    assert.equal(output.scopes[0].excluded.ambiguousPrice, 1);
    assert.equal(output.scopes[0].admissionTicket.activeCount, 6);
    assert.equal(output.scopes[1].admissionTicket.activeCount, 0);
});

test('sequential single-register setup can plan and apply one business context independently', async () => {
    const db = new CatalogMappingFixtureDb();
    delete db.targets.dar;
    const options = { businessContexts: ['event_genix'] };
    const first = await applyCatalogSaleMappings(db, { [APPLY_CONFIRM_ENV]: 'true' }, options);
    assert.equal(first.ready, true);
    assert.deepEqual(first.totals, { desired: 140, insert: 0, update: 0, noOp: 140, conflict: 0 });
    assert.equal(first.applied.insert, 140);
    assert.equal(first.scopes.length, 1);
    assert.equal(first.scopes[0].businessContext, 'event_genix');

    const second = await applyCatalogSaleMappings(db, { [APPLY_CONFIRM_ENV]: 'true' }, options);
    assert.equal(second.applied.insert, 0);
    assert.equal(second.applied.noOp, 140);
});

test('four logical routes map 322 catalog rows onto three physical registers without duplicating the shared test register', async () => {
    const db = new CatalogMappingFixtureDb();
    const first = await applyCatalogSaleMappings(db, { [APPLY_CONFIRM_ENV]: 'true' }, { includeTestRoutes: true });
    assert.equal(first.ready, true);
    assert.equal(first.applied.insert, 322);
    assert.equal(first.scopes.length, 4);
    const shared = first.scopes.filter(scope => scope.mode === 'test');
    assert.equal(shared.length, 2);
    assert.equal(new Set(shared.map(scope => db.routeTargets[scope.routeOptionId].fiscal_register_id)).size, 1);
    const second = await applyCatalogSaleMappings(db, { [APPLY_CONFIRM_ENV]: 'true' }, { includeTestRoutes: true });
    assert.equal(second.applied.noOp, 322);
    assert.equal(db.mappings.filter(row => row.business_context === 'event_genix').length, 280);
    assert.equal(db.mappings.filter(row => row.business_context === 'dar').length, 42);
});

test('mapping payload is untaxed, price-free and contains no provider item or tax ids', async () => {
    const db = new CatalogMappingFixtureDb();
    const plan = await planCatalogSaleMappings(db);
    const mappings = plan.scopes.flatMap(scope => scope.desiredMappings);
    assert.equal(mappings.length, 161);
    for (const mapping of mappings) {
        assert.equal(mapping.sourceType, 'catalog_sale');
        assert.equal(mapping.itemType, 'catalog_sale');
        assert.equal(mapping.provider, 'checkbox');
        assert.equal(mapping.taxMode, 'untaxed');
        assert.equal(mapping.providerTaxId, null);
        assert.equal(mapping.taxCode, null);
        assert.equal(mapping.taxRateBps, null);
        assert.equal(Object.keys(mapping).some(key => /price|providerItem/i.test(key)), false);
    }
});

test('legacy empty provider tax values are normalized to exact NULL instead of no-op', async () => {
    const db = new CatalogMappingFixtureDb();
    db.mappings.push({
        ...desiredRowFromParams([10, 30, 'event_genix', 'event_genix', 'catalog_sale', 'catalog_sale', 'park_001', 'PARK item 1', 'checkbox']),
        provider_tax_id: ''
    });
    const output = buildSafeDryRun(await planCatalogSaleMappings(db));
    assert.equal(output.scopes[0].changes.update, 1);
    assert.equal(output.scopes[0].changes.insert, 139);
});

test('sanitized dry-run contains reference status but no reference values, provider ids, logins or secrets', async () => {
    const db = new CatalogMappingFixtureDb();
    const output = buildSafeDryRun(await planCatalogSaleMappings(db));
    const serialized = JSON.stringify(output);
    assert.match(serialized, /referenceConfigured/);
    assert.doesNotMatch(serialized, /provider_(?:cashier|register|outlet|organization)_id/i);
    assert.doesNotMatch(serialized, /login_ref|credential_ref|license_ref|password|access_key|secret|token/i);
});

test('local apply converges to no-op and never changes register or acceptance state', async () => {
    const db = new CatalogMappingFixtureDb();
    const env = { [APPLY_CONFIRM_ENV]: 'true' };
    const first = await applyCatalogSaleMappings(db, env);
    assert.deepEqual(first.applied, { desired: 161, insert: 161, update: 0, noOp: 0, conflict: 0 });
    assert.equal(db.writeCount, 161);
    assert.equal(first.totals.noOp, 161);

    const second = await applyCatalogSaleMappings(db, env);
    assert.deepEqual(second.applied, { desired: 161, insert: 0, update: 0, noOp: 161, conflict: 0 });
    assert.equal(db.writeCount, 161);

    const source = fs.readFileSync(path.join(__dirname, '..', 'services', 'payments', 'catalogSaleMappingConfigurator.js'), 'utf8');
    assert.doesNotMatch(source, /UPDATE\s+fiscal_registers/i);
    assert.doesNotMatch(source, /accept(?:ance)?[_a-z]*\s*=/i);
});

test('ambiguous audited-set drift fails closed before mapping writes', async () => {
    const db = new CatalogMappingFixtureDb();
    db.products.event_genix.find(row => row.id === 'park_001').price_rule_count = 2;
    db.products.event_genix.find(row => row.id === 'park_001').positive_price_rule_count = 2;
    await assert.rejects(
        applyCatalogSaleMappings(db, { [APPLY_CONFIRM_ENV]: 'true' }),
        error => error.code === 'catalog_mapping_conflict'
    );
    assert.equal(db.writeCount, 0);
});

test('DAR requires exactly the 21 migration-owned catalog rows', async () => {
    const db = new CatalogMappingFixtureDb();
    db.products.dar.push({
        id: 'dar_unapproved_extra',
        name: 'Unapproved extra',
        is_active: true,
        availability_status: 'active',
        updated_by: 'migration_347_dar_catalog',
        price_rule_count: 1,
        positive_price_rule_count: 0
    });
    const output = buildSafeDryRun(await planCatalogSaleMappings(db));
    assert.equal(output.ready, false);
    assert.ok(output.scopes[1].conflicts.some(item => item.type === 'catalog_seed_row_count_mismatch'));
});

test('admission-ticket configurator remains a separate six-code flow', () => {
    const pilot = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'configure-checkbox-park-pilot.js'), 'utf8');
    const catalog = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'configure-checkbox-catalog-sale.js'), 'utf8');
    assert.match(pilot, /const SOURCE_TYPE = 'admission_ticket'/);
    assert.match(pilot, /const ITEM_TYPE = 'admission_ticket'/);
    assert.doesNotMatch(catalog, /configure-checkbox-park-pilot/);
});

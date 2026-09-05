/**
 * PostgreSQL verification for the PARK/DAR catalog-sale migrations.
 *
 * Run only through:
 *   npm run test:integration:catalog-sale:isolated
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { loadSelectedCashierBinding } = require('../../services/payments/paymentService');
const { listSelectableCashiers } = require('../../services/payments/cashierBindingAdminService');
const {
    DAR_CATALOG_CONTRACT_SHA256,
    GLOBAL_GATE_NAMES,
    databaseFingerprint,
    fetchProductionAttestation,
    loadDatabaseState,
    loadMigrationDigests,
    loadSchemaContract,
    migrationDigestMap,
    runReadOnlyPlan,
    sha256
} = require('../../services/payments/parkDarProductionConfigPlanner');
const {
    PRODUCTION_ATTESTATION_AUDIENCE,
    PRODUCTION_ATTESTATION_SOURCE,
    PRODUCTION_ORIGIN,
    PRODUCTION_RUNTIME_IDENTITY_SHA256
} = require('../../services/payments/parkDarProductionAttestation');

const root = path.resolve(__dirname, '..', '..');
const migrationNames = [
    '346_catalog_sale_foundation.sql',
    '347_dar_catalog_2026_2027.sql',
    '348_fiscal_cashier_admin_metadata.sql',
    '349_payment_order_selected_fiscal_cashier_binding.sql',
    '350_fiscal_register_route_acceptance.sql',
    '351_fiscal_sale_routes.sql'
];

const saleCatalogSql = `
    SELECT p.id AS item_code, p.name, p.category, p.serving_unit AS unit,
           MIN(pr.value) AS price_uah, p.sale_config
      FROM products p
      JOIN price_rules pr ON pr.product_id = p.id
     WHERE p.business_context = $1
       AND p.is_active = TRUE
       AND COALESCE(p.availability_status, 'active') = 'active'
       AND pr.value > 0
     GROUP BY p.id, p.name, p.category, p.serving_unit, p.sale_config
    HAVING COUNT(*) = 1
     ORDER BY p.id
`;

let pool;

function requireDisposableLocalDatabase() {
    assert.equal(process.env.RUN_CATALOG_SALE_MIGRATIONS_INTEGRATION, 'true');
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assert.ok(process.env.TEST_DATABASE_URL);
    const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, {
        ...process.env,
        DATABASE_URL: ''
    });
    assert.equal(target.isLocal, true, 'catalog migration verification requires loopback PostgreSQL');
    return target;
}

before(() => {
    const target = requireDisposableLocalDatabase();
    pool = new Pool({
        connectionString: target.url.toString(),
        ssl: false,
        max: 4,
        connectionTimeoutMillis: 10_000
    });
});

after(async () => {
    await pool?.end();
});

test('fresh startup applied the complete available catalog-sale migration set', async () => {
    const result = await pool.query(
        `SELECT version
           FROM schema_migrations
          WHERE version = ANY($1::text[])
          ORDER BY version`,
        [migrationNames.map(name => name.replace(/\.sql$/, ''))]
    );
    assert.deepEqual(result.rows.map(row => row.version), migrationNames.map(name => name.replace(/\.sql$/, '')));
});

test('catalog migrations are SQL-idempotent when executed a second time', async () => {
    const beforeCounts = await pool.query(`
        SELECT
            (SELECT COUNT(*)::int FROM products WHERE business_context = 'dar') AS dar_products,
            (SELECT COUNT(*)::int FROM price_rules WHERE product_id LIKE 'dar_%') AS dar_prices,
            (SELECT COUNT(*)::int FROM sales_discount_rules WHERE business_context = 'dar') AS dar_discounts
    `);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const name of migrationNames) {
            const sql = fs.readFileSync(path.join(root, 'db', 'migrations', name), 'utf8');
            await client.query(sql);
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
    const afterCounts = await pool.query(`
        SELECT
            (SELECT COUNT(*)::int FROM products WHERE business_context = 'dar') AS dar_products,
            (SELECT COUNT(*)::int FROM price_rules WHERE product_id LIKE 'dar_%') AS dar_prices,
            (SELECT COUNT(*)::int FROM sales_discount_rules WHERE business_context = 'dar') AS dar_discounts
    `);
    assert.deepEqual(afterCounts.rows[0], beforeCounts.rows[0]);
});

test('register acceptance and shared-test shift ownership are fail-closed by default', async () => {
    const registerColumn = await pool.query(
        `SELECT column_default, is_nullable
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'fiscal_registers'
            AND column_name = 'acceptance_enabled'`
    );
    assert.equal(registerColumn.rows.length, 1);
    assert.match(String(registerColumn.rows[0].column_default), /false/i);
    assert.equal(registerColumn.rows[0].is_nullable, 'NO');

    const shiftColumn = await pool.query(
        `SELECT is_nullable
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'fiscal_shifts'
            AND column_name = 'business_context'`
    );
    assert.deepEqual(shiftColumn.rows, [{ is_nullable: 'YES' }]);

    const routeColumns = await pool.query(
        `SELECT column_name, column_default
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'fiscal_sale_routes'
            AND column_name IN ('feature_enabled', 'acceptance_enabled')
          ORDER BY column_name`
    );
    assert.equal(routeColumns.rows.length, 2);
    assert.equal(routeColumns.rows.every(row => /false/i.test(String(row.column_default))), true);
});

test('DAR has exactly 21 active products with one positive price rule each', async () => {
    const count = await pool.query(`
        SELECT COUNT(*)::int AS count
          FROM products
         WHERE business_context = 'dar'
           AND is_active = TRUE
           AND COALESCE(availability_status, 'active') = 'active'
    `);
    assert.equal(count.rows[0].count, 21);

    const problematic = await pool.query(`
        SELECT p.id
          FROM products p
          LEFT JOIN price_rules pr ON pr.product_id = p.id
         WHERE p.business_context = 'dar'
           AND p.is_active = TRUE
           AND COALESCE(p.availability_status, 'active') = 'active'
         GROUP BY p.id
        HAVING COUNT(pr.id) <> 1
            OR COUNT(pr.id) FILTER (WHERE pr.value > 0) <> 1
    `);
    assert.deepEqual(problematic.rows, []);
});

test('DAR subscriptions, single lessons, discounts and weekend quantity remain distinct', async () => {
    const products = await pool.query(`
        SELECT id
          FROM products
         WHERE id IN ('dar_school_prep_8', 'dar_school_prep_single')
         ORDER BY id
    `);
    assert.deepEqual(products.rows.map(row => row.id), ['dar_school_prep_8', 'dar_school_prep_single']);

    const discounts = await pool.query(`
        SELECT code, rate_bps
          FROM sales_discount_rules
         WHERE business_context = 'dar'
         ORDER BY code
    `);
    assert.deepEqual(discounts.rows, [
        { code: 'dar_second_club_direction_10', rate_bps: 1000 },
        { code: 'dar_ubd_20', rate_bps: 2000 }
    ]);
    const discountProducts = await pool.query(`
        SELECT id
          FROM products
         WHERE business_context = 'dar'
           AND (id IN ('dar_second_club_direction_10', 'dar_ubd_20')
                OR LOWER(name) IN (LOWER('УБД 20%'), LOWER('Другий напрямок гуртка 10%')))
    `);
    assert.deepEqual(discountProducts.rows, []);
    const discountPrices = await pool.query(`
        SELECT id
          FROM price_rules
         WHERE code IN ('dar_second_club_direction_10', 'dar_ubd_20')
            OR LOWER(name) IN (LOWER('УБД 20%'), LOWER('Другий напрямок гуртка 10%'))
    `);
    assert.deepEqual(discountPrices.rows, []);

    const weekend = await pool.query(`
        SELECT (sale_config ->> 'minimum_quantity_millis')::int AS minimum_quantity_millis
          FROM products
         WHERE id = 'dar_hourly_care_weekend'
           AND business_context = 'dar'
    `);
    assert.equal(weekend.rows[0]?.minimum_quantity_millis, 2000);
});

test('PARK catalog is derived from products and price_rules', async () => {
    const catalog = await pool.query(saleCatalogSql, ['event_genix']);
    const sources = await pool.query(`
        SELECT COUNT(*)::int AS count
          FROM products p
          JOIN price_rules pr ON pr.product_id = p.id
         WHERE p.business_context = 'event_genix'
           AND p.is_active = TRUE
           AND COALESCE(p.availability_status, 'active') = 'active'
           AND pr.value > 0
    `);
    assert.ok(catalog.rows.length <= sources.rows[0].count);
    assert.ok(catalog.rows.every(row => Number(row.price_uah) > 0));
});

test('inactive, zero-priced and ambiguous products are excluded from the sale catalog', async () => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`
            INSERT INTO products
                (id, business_context, code, timeline_code, label, name, category, duration, price, is_active, availability_status)
            VALUES
                ('catalog_test_valid', 'event_genix', 'CTV', 'CTV', 'Valid', 'Valid', 'test', 0, 0, TRUE, 'active'),
                ('catalog_test_inactive', 'event_genix', 'CTI', 'CTI', 'Inactive', 'Inactive', 'test', 0, 0, FALSE, 'active'),
                ('catalog_test_zero', 'event_genix', 'CTZ', 'CTZ', 'Zero', 'Zero', 'test', 0, 0, TRUE, 'active'),
                ('catalog_test_ambiguous', 'event_genix', 'CTA', 'CTA', 'Ambiguous', 'Ambiguous', 'test', 0, 0, TRUE, 'active')
        `);
        await client.query(`
            INSERT INTO price_rules (code, name, value, unit, category, product_id)
            VALUES
                ('catalog_test_valid_price', 'Valid', 100, 'грн', 'test', 'catalog_test_valid'),
                ('catalog_test_inactive_price', 'Inactive', 100, 'грн', 'test', 'catalog_test_inactive'),
                ('catalog_test_zero_price', 'Zero', 0, 'грн', 'test', 'catalog_test_zero'),
                ('catalog_test_ambiguous_a', 'Ambiguous A', 100, 'грн', 'test', 'catalog_test_ambiguous'),
                ('catalog_test_ambiguous_b', 'Ambiguous B', 200, 'грн', 'test', 'catalog_test_ambiguous')
        `);
        const result = await client.query(saleCatalogSql, ['event_genix']);
        const fixtureIds = result.rows
            .map(row => row.item_code)
            .filter(id => id.startsWith('catalog_test_'));
        assert.deepEqual(fixtureIds, ['catalog_test_valid']);
    } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
    }
});

test('every active catalog-sale fiscal mapping is untaxed and has no provider tax id', async () => {
    const invalid = await pool.query(`
        SELECT id
          FROM fiscal_item_mappings
         WHERE status = 'active'
           AND (source_type = 'catalog_sale' OR item_type = 'catalog_sale')
           AND (tax_mode <> 'untaxed' OR NULLIF(BTRIM(COALESCE(provider_tax_id, '')), '') IS NOT NULL)
    `);
    assert.deepEqual(invalid.rows, []);
});

test('payment order keeps the exact selected fiscal cashier binding immutable', async () => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const user = await client.query(`
            INSERT INTO users (username, password_hash, role, name)
            VALUES ('catalog-binding-v349', 'not-a-real-secret', 'user', 'Catalog Binding Test')
            RETURNING id
        `);
        const profile = await client.query(`
            INSERT INTO fiscal_profiles (crm_profile_key, legal_entity_key, legal_entity_name, status)
            VALUES ('catalog_binding_test', 'catalog_binding_legal', 'Catalog Binding Legal', 'active')
            RETURNING id
        `);
        const location = await client.query(`
            INSERT INTO fiscal_locations (fiscal_profile_id, crm_profile_key, location_alias, display_name, status)
            VALUES ($1, 'catalog_binding_test', 'catalog_binding_location', 'Catalog Binding Location', 'active')
            RETURNING id
        `, [profile.rows[0].id]);
        const registers = await client.query(`
            INSERT INTO fiscal_registers (
                fiscal_profile_id, fiscal_location_id, crm_profile_key, register_alias,
                display_name, status, feature_enabled
            )
            VALUES
                ($1, $2, 'catalog_binding_test', 'catalog_binding_a', 'Catalog Binding A', 'active', FALSE),
                ($1, $2, 'catalog_binding_test', 'catalog_binding_b', 'Catalog Binding B', 'active', FALSE)
            RETURNING id, register_alias
        `, [profile.rows[0].id, location.rows[0].id]);
        const registerA = registers.rows.find(row => row.register_alias === 'catalog_binding_a');
        const registerB = registers.rows.find(row => row.register_alias === 'catalog_binding_b');
        const bindings = await client.query(`
            INSERT INTO fiscal_cashier_bindings (
                fiscal_profile_id, fiscal_register_id, user_id, provider_cashier_login_ref,
                status, crm_profile_key, fiscal_location_id, capability_scope
            )
            VALUES
                ($1, $2, $4, 'catalog-binding-a-v349', 'active', 'catalog_binding_test', $5, ARRAY['payments.create']),
                ($1, $3, $4, 'catalog-binding-b-v349', 'active', 'catalog_binding_test', $5, ARRAY['payments.create'])
            RETURNING id, fiscal_register_id
        `, [profile.rows[0].id, registerA.id, registerB.id, user.rows[0].id, location.rows[0].id]);
        const bindingA = bindings.rows.find(row => Number(row.fiscal_register_id) === Number(registerA.id));
        const bindingB = bindings.rows.find(row => Number(row.fiscal_register_id) === Number(registerB.id));
        const order = await client.query(`
            INSERT INTO payment_orders (
                fiscal_profile_id, fiscal_register_id, cashier_user_id,
                selected_fiscal_cashier_binding_id, source_type, source_id, order_key,
                idempotency_key, payment_method, total_amount_minor, created_by_user_id
            )
            VALUES ($1, $2, $3, $4, 'catalog_sale', 'binding-test', 'catalog-sale:binding-test',
                    'catalog-sale-binding-v349', 'cash', 10000, $3)
            RETURNING id, selected_fiscal_cashier_binding_id
        `, [profile.rows[0].id, registerA.id, user.rows[0].id, bindingA.id]);
        assert.equal(Number(order.rows[0].selected_fiscal_cashier_binding_id), Number(bindingA.id));

        await client.query('SAVEPOINT wrong_register_binding');
        await assert.rejects(
            client.query(`
                INSERT INTO payment_orders (
                    fiscal_profile_id, fiscal_register_id, cashier_user_id,
                    selected_fiscal_cashier_binding_id, source_type, source_id, order_key,
                    idempotency_key, payment_method, total_amount_minor, created_by_user_id
                )
                VALUES ($1, $2, $3, $4, 'catalog_sale', 'wrong-binding', 'catalog-sale:wrong-binding',
                        'catalog-sale-wrong-binding-v349', 'cash', 10000, $3)
            `, [profile.rows[0].id, registerA.id, user.rows[0].id, bindingB.id]),
            error => error.code === '23503'
        );
        await client.query('ROLLBACK TO SAVEPOINT wrong_register_binding');

        await client.query('SAVEPOINT mutate_binding');
        await assert.rejects(
            client.query(
                `UPDATE payment_orders SET selected_fiscal_cashier_binding_id = $1 WHERE id = $2`,
                [bindingB.id, order.rows[0].id]
            ),
            error => error.code === '55000'
        );
        await client.query('ROLLBACK TO SAVEPOINT mutate_binding');

        await client.query('SAVEPOINT delete_binding');
        await assert.rejects(
            client.query(`DELETE FROM fiscal_cashier_bindings WHERE id = $1`, [bindingA.id]),
            error => error.code === '23503'
        );
        await client.query('ROLLBACK TO SAVEPOINT delete_binding');
    } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
    }
});

test('cashier selection is register-scoped and rejects every non-active or unreferenced binding', async () => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const users = await client.query(`
            INSERT INTO users (username, password_hash, role, name)
            VALUES
                ('catalog-cashier-park-active', 'local-fixture', 'user', 'PARK Active'),
                ('catalog-cashier-dar-active', 'local-fixture', 'user', 'DAR Active'),
                ('catalog-cashier-suspended', 'local-fixture', 'user', 'Suspended'),
                ('catalog-cashier-draft', 'local-fixture', 'user', 'Draft'),
                ('catalog-cashier-archived', 'local-fixture', 'user', 'Archived'),
                ('catalog-cashier-no-ref', 'local-fixture', 'user', 'No Reference')
            RETURNING id, username
        `);
        const userByName = new Map(users.rows.map(row => [row.username, row.id]));
        const profiles = await client.query(`
            INSERT INTO fiscal_profiles (crm_profile_key, legal_entity_key, legal_entity_name, provider, status)
            VALUES
                ('event_genix', 'catalog_cashier_park', 'Catalog Cashier PARK', 'checkbox', 'active'),
                ('dar', 'catalog_cashier_dar', 'Catalog Cashier DAR', 'checkbox', 'active')
            RETURNING id, crm_profile_key
        `);
        const profileByContext = new Map(profiles.rows.map(row => [row.crm_profile_key, row.id]));
        const locations = await client.query(`
            INSERT INTO fiscal_locations (fiscal_profile_id, crm_profile_key, location_alias, display_name, status)
            VALUES
                ($1, 'event_genix', 'park', 'PARK', 'active'),
                ($2, 'dar', 'dar', 'DAR', 'active')
            RETURNING id, crm_profile_key
        `, [profileByContext.get('event_genix'), profileByContext.get('dar')]);
        const locationByContext = new Map(locations.rows.map(row => [row.crm_profile_key, row.id]));
        const registers = await client.query(`
            INSERT INTO fiscal_registers (
                fiscal_profile_id, fiscal_location_id, crm_profile_key, register_alias,
                display_name, provider, status, feature_enabled, metadata
            )
            VALUES
                ($1, $3, 'event_genix', 'middle', 'Middle', 'checkbox', 'active', TRUE, '{"expected_is_test":false}'),
                ($2, $4, 'dar', 'dar', 'DAR', 'checkbox', 'active', TRUE, '{"expected_is_test":false}')
            RETURNING id, crm_profile_key
        `, [
            profileByContext.get('event_genix'),
            profileByContext.get('dar'),
            locationByContext.get('event_genix'),
            locationByContext.get('dar')
        ]);
        const registerByContext = new Map(registers.rows.map(row => [row.crm_profile_key, row.id]));

        await client.query(`
            INSERT INTO fiscal_sale_routes (
                route_option_id, business_context, fiscal_profile_id, fiscal_location_id,
                fiscal_register_id, mode, expected_is_test, status, feature_enabled
            )
            VALUES
                ('park_production', 'event_genix', $1, $3, $5, 'production', FALSE, 'active', TRUE),
                ('dar_production', 'dar', $2, $4, $6, 'production', FALSE, 'active', TRUE)
        `, [
            profileByContext.get('event_genix'),
            profileByContext.get('dar'),
            locationByContext.get('event_genix'),
            locationByContext.get('dar'),
            registerByContext.get('event_genix'),
            registerByContext.get('dar')
        ]);

        const bindings = await client.query(`
            INSERT INTO fiscal_cashier_bindings (
                fiscal_profile_id, fiscal_register_id, fiscal_location_id, crm_profile_key,
                user_id, provider, provider_cashier_login_ref, status, capability_scope, cashier_name
            )
            VALUES
                ($1, $3, $5, 'event_genix', $7, 'checkbox', 'catalog-park-active-ref', 'active', ARRAY['payments.create'], 'PARK Active'),
                ($2, $4, $6, 'dar', $8, 'checkbox', 'catalog-dar-active-ref', 'active', ARRAY['payments.create'], 'DAR Active'),
                ($1, $3, $5, 'event_genix', $9, 'checkbox', 'catalog-suspended-ref', 'suspended', ARRAY['payments.create'], 'Suspended'),
                ($1, $3, $5, 'event_genix', $10, 'checkbox', 'catalog-draft-ref', 'draft', ARRAY['payments.create'], 'Draft'),
                ($1, $3, $5, 'event_genix', $11, 'checkbox', 'catalog-archived-ref', 'archived', ARRAY['payments.create'], 'Archived'),
                ($1, $3, $5, 'event_genix', $12, 'checkbox', NULL, 'active', ARRAY['payments.create'], 'No Reference')
            RETURNING id, user_id, fiscal_register_id, status, provider_cashier_login_ref
        `, [
            profileByContext.get('event_genix'),
            profileByContext.get('dar'),
            registerByContext.get('event_genix'),
            registerByContext.get('dar'),
            locationByContext.get('event_genix'),
            locationByContext.get('dar'),
            userByName.get('catalog-cashier-park-active'),
            userByName.get('catalog-cashier-dar-active'),
            userByName.get('catalog-cashier-suspended'),
            userByName.get('catalog-cashier-draft'),
            userByName.get('catalog-cashier-archived'),
            userByName.get('catalog-cashier-no-ref')
        ]);
        const bindingByUser = new Map(bindings.rows.map(row => [Number(row.user_id), row]));
        const sharedClientPool = { connect: async () => ({ query: (...args) => client.query(...args), release() {} }) };
        const authorizer = async () => ({ allowed: true });

        const routeUser = { id: 1, role: 'creator', businessContexts: ['event_genix', 'dar'] };
        const park = await listSelectableCashiers({ dbPool: sharedClientPool, businessContext: 'event_genix', user: routeUser, authorizer });
        const dar = await listSelectableCashiers({ dbPool: sharedClientPool, businessContext: 'dar', user: routeUser, authorizer });
        assert.deepEqual(park, [{ id: Number(bindingByUser.get(Number(userByName.get('catalog-cashier-park-active'))).id), cashierName: 'PARK Active', status: 'active', mode: 'production' }]);
        assert.deepEqual(dar, [{ id: Number(bindingByUser.get(Number(userByName.get('catalog-cashier-dar-active'))).id), cashierName: 'DAR Active', status: 'active', mode: 'production' }]);
        assert.doesNotMatch(JSON.stringify({ park, dar }), /login|credential|provider.*id/i);

        const invalidUsernames = [
            'catalog-cashier-suspended',
            'catalog-cashier-draft',
            'catalog-cashier-archived',
            'catalog-cashier-no-ref'
        ];
        for (const username of invalidUsernames) {
            const binding = bindingByUser.get(Number(userByName.get(username)));
            await assert.rejects(
                loadSelectedCashierBinding(client, {
                    bindingId: binding.id,
                    fiscalProfileId: profileByContext.get('event_genix'),
                    fiscalRegisterId: registerByContext.get('event_genix')
                }),
                error => error.code === 'cashier_binding_scope_invalid',
                username
            );
        }

        const darBinding = bindingByUser.get(Number(userByName.get('catalog-cashier-dar-active')));
        await assert.rejects(
            loadSelectedCashierBinding(client, {
                bindingId: darBinding.id,
                fiscalProfileId: profileByContext.get('event_genix'),
                fiscalRegisterId: registerByContext.get('event_genix')
            }),
            error => error.code === 'cashier_binding_scope_invalid'
        );
    } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
    }
});

test('one physical test register supports two explicit sequential logical routes without duplication', async () => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const profile = await client.query(`
            INSERT INTO fiscal_profiles (crm_profile_key, legal_entity_key, legal_entity_name, provider, status)
            VALUES ('event_genix', 'shared_route_fixture', 'Shared route fixture', 'checkbox', 'active')
            RETURNING id
        `);
        const profileId = profile.rows[0].id;
        const location = await client.query(`
            INSERT INTO fiscal_locations (fiscal_profile_id, crm_profile_key, location_alias, display_name, status)
            VALUES ($1, 'event_genix', 'shared_test', 'Shared test', 'active')
            RETURNING id
        `, [profileId]);
        const register = await client.query(`
            INSERT INTO fiscal_registers (
                fiscal_profile_id, fiscal_location_id, crm_profile_key, register_alias,
                display_name, provider, status, feature_enabled, metadata
            )
            VALUES ($1, $2, 'event_genix', 'shared_test', 'Shared test', 'checkbox', 'active', TRUE, '{"expected_is_test":true}')
            RETURNING id
        `, [profileId, location.rows[0].id]);
        await client.query(`
            INSERT INTO fiscal_sale_routes (
                route_option_id, business_context, fiscal_profile_id, fiscal_location_id,
                fiscal_register_id, mode, expected_is_test, status, feature_enabled,
                shared_register_group
            )
            VALUES
                ('park_test', 'event_genix', $1, $2, $3, 'test', TRUE, 'active', TRUE, 'checkbox_single_test_register'),
                ('dar_test', 'dar', $1, $2, $3, 'test', TRUE, 'active', TRUE, 'checkbox_single_test_register')
        `, [profileId, location.rows[0].id, register.rows[0].id]);
        const routes = await client.query(`
            SELECT COUNT(*)::int AS route_count,
                   COUNT(DISTINCT fiscal_register_id)::int AS physical_register_count,
                   BOOL_AND(acceptance_enabled = FALSE) AS all_acceptance_disabled
              FROM fiscal_sale_routes
             WHERE route_option_id IN ('park_test', 'dar_test')
        `);
        assert.deepEqual(routes.rows[0], {
            route_count: 2,
            physical_register_count: 1,
            all_acceptance_disabled: true
        });
    } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
    }
});

test('rollback headers are scoped to catalog objects and migration-owned DAR rows', () => {
    const sqlByName = new Map(migrationNames.map(name => [
        name,
        fs.readFileSync(path.join(root, 'db', 'migrations', name), 'utf8')
    ]));
    for (const [name, sql] of sqlByName) {
        assert.match(sql, /^-- MIGRATION_KIND:/m, `${name} migration kind`);
        assert.match(sql, /^-- SAFETY:/m, `${name} safety`);
        assert.match(sql, /^-- ROLLBACK:/m, `${name} rollback`);
    }
    assert.match(sqlByName.get('346_catalog_sale_foundation.sql'), /retain the additive objects by default/);
    assert.match(sqlByName.get('347_dar_catalog_2026_2027.sql'), /deactivate only DAR products/);
    assert.match(sqlByName.get('347_dar_catalog_2026_2027.sql'), /proving no ledger snapshot references them/);
    assert.match(sqlByName.get('348_fiscal_cashier_admin_metadata.sql'), /Retain the additive metadata columns by default/);
    assert.match(sqlByName.get('349_payment_order_selected_fiscal_cashier_binding.sql'), /retain the additive column by default/);
    assert.match(sqlByName.get('350_fiscal_register_route_acceptance.sql'), /Retain the additive columns by default/);
    assert.match(sqlByName.get('351_fiscal_sale_routes.sql'), /Retain the additive objects by default/);
});

test('read-only lifecycle inventory blocks target-scoped unknown refunds without COALESCE scope escapes', async () => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const profile = await client.query(`
            INSERT INTO fiscal_profiles (
                crm_profile_key, legal_entity_key, legal_entity_name, provider, status
            )
            VALUES ('event_genix', 'planner_refund_fixture', 'Planner refund fixture', 'checkbox', 'active')
            RETURNING id
        `);
        const profileId = profile.rows[0].id;
        const location = await client.query(`
            INSERT INTO fiscal_locations (
                fiscal_profile_id, crm_profile_key, location_alias, display_name, status
            )
            VALUES ($1, 'event_genix', 'park', 'PARK refund fixture', 'active')
            RETURNING id
        `, [profileId]);
        const targetProviderRegisterId = `planner-target-register-${process.pid}`;
        const registers = await client.query(`
            INSERT INTO fiscal_registers (
                fiscal_profile_id, fiscal_location_id, crm_profile_key, register_alias,
                display_name, provider, provider_register_id, status, feature_enabled
            )
            VALUES
                ($1, $2, 'event_genix', 'middle', 'Target register', 'checkbox', $3, 'active', FALSE),
                ($1, $2, 'event_genix', 'other', 'Unrelated register', 'checkbox', $4, 'active', FALSE)
            RETURNING id, register_alias
        `, [profileId, location.rows[0].id, targetProviderRegisterId, `planner-unrelated-register-${process.pid}`]);
        const targetRegisterId = registers.rows.find(row => row.register_alias === 'middle').id;
        const unrelatedRegisterId = registers.rows.find(row => row.register_alias === 'other').id;

        async function insertOrder(label, fiscalRegisterId) {
            const result = await client.query(`
                INSERT INTO payment_orders (
                    fiscal_profile_id, fiscal_register_id, source_type, source_id,
                    order_key, idempotency_key, payment_method, total_amount_minor
                )
                VALUES ($1, $2, 'catalog_sale', $3, $4, $5, 'cash', 100)
                RETURNING id
            `, [profileId, fiscalRegisterId, label, `order-${label}`, `order-idempotency-${label}`]);
            return result.rows[0].id;
        }

        async function insertRefund(label, {
            orderId,
            directRegisterId = null,
            operationId = null,
            status = 'requested',
            moneyStatus = 'not_started',
            fiscalStatus = 'not_started'
        }) {
            const result = await client.query(`
                INSERT INTO payment_refunds (
                    fiscal_profile_id, payment_order_id, fiscal_register_id, fiscal_operation_id,
                    idempotency_key, status, refund_method, amount_minor, reason,
                    money_refund_status, fiscal_refund_status
                )
                VALUES ($1, $2, $3, $4, $5, $6, 'cash', 100, 'Local lifecycle fixture', $7, $8)
                RETURNING id
            `, [
                profileId,
                orderId,
                directRegisterId,
                operationId,
                `refund-idempotency-${label}`,
                status,
                moneyStatus,
                fiscalStatus
            ]);
            return result.rows[0].id;
        }

        const directTargetOrder = await insertOrder('direct-target', targetRegisterId);
        await insertRefund('direct-target', {
            orderId: directTargetOrder,
            directRegisterId: targetRegisterId,
            status: 'money_refund_unknown'
        });

        const originatingTargetOrder = await insertOrder('originating-target', targetRegisterId);
        await insertRefund('originating-target', {
            orderId: originatingTargetOrder,
            moneyStatus: 'unknown'
        });

        const operationTargetOrder = await insertOrder('operation-target', unrelatedRegisterId);
        const operation = await client.query(`
            INSERT INTO fiscal_operations (
                fiscal_profile_id, fiscal_register_id, payment_order_id,
                operation_type, status, idempotency_key, amount_minor
            )
            VALUES ($1, $2, $3, 'return', 'fiscalized', $4, 100)
            RETURNING id
        `, [profileId, targetRegisterId, operationTargetOrder, 'operation-idempotency-target']);
        await insertRefund('operation-target', {
            orderId: operationTargetOrder,
            operationId: operation.rows[0].id,
            fiscalStatus: 'unknown'
        });

        const conflictingTargetOrder = await insertOrder('conflicting-target', targetRegisterId);
        await insertRefund('conflicting-target', {
            orderId: conflictingTargetOrder,
            directRegisterId: unrelatedRegisterId,
            status: 'fiscal_return_unknown'
        });

        const unrelatedOrder = await insertOrder('unrelated', unrelatedRegisterId);
        await insertRefund('unrelated', {
            orderId: unrelatedOrder,
            directRegisterId: unrelatedRegisterId,
            moneyStatus: 'unknown'
        });

        const terminalOrder = await insertOrder('terminal', targetRegisterId);
        await insertRefund('terminal', {
            orderId: terminalOrder,
            directRegisterId: targetRegisterId,
            status: 'fiscal_returned',
            moneyStatus: 'refunded',
            fiscalStatus: 'returned'
        });

        const state = await loadDatabaseState(client, {
            profiles: [{ key: 'event_genix' }],
            registers: [{ providerRegisterId: targetProviderRegisterId }],
            bindings: [],
            routes: []
        });
        assert.equal(state.lifecycle.unknownRefunds, 4);
        assert.equal(state.lifecycle.unscopableUnknownRefunds, 0);
        assert.equal(state.lifecycle.inconsistentRefundRegisterRefs, 2);
        assert.deepEqual(Object.keys(state.lifecycle).filter(key => /refund/i.test(key)).sort(), [
            'inconsistentRefundRegisterRefs',
            'unknownRefunds',
            'unscopableUnknownRefunds'
        ]);
        const sanitizedLifecycle = JSON.stringify(state.lifecycle);
        assert.equal(sanitizedLifecycle.includes(targetProviderRegisterId), false);
        assert.equal(Object.hasOwn(state.lifecycle, 'refundIds'), false);
        assert.equal(Object.hasOwn(state.lifecycle, 'orderIds'), false);
    } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
    }
});

test('production configuration planner executes exact post-migration inventory through a genuinely read-only role', async () => {
    const parkRows = await pool.query(saleCatalogSql, ['event_genix']);
    const darRows = await pool.query(saleCatalogSql, ['dar']);
    const ticketRows = await pool.query(`
        SELECT code, name
          FROM admission_ticket_types
         WHERE business_context='event_genix' AND is_active=TRUE
         ORDER BY code
    `);
    assert.equal(parkRows.rows.length, 140);
    assert.equal(darRows.rows.length, 21);
    assert.equal(ticketRows.rows.length, 6);

    const user = await pool.query(`
        INSERT INTO users (username, password_hash, role, name, is_active)
        VALUES ($1, 'DISABLED_PLANNER_FIXTURE', 'creator', 'Planner fixture', TRUE)
        RETURNING id
    `, [`park-dar-planner-${process.pid}-${Date.now()}`]);
    const userId = Number(user.rows[0].id);
    const expectedLiveSha = 'b'.repeat(40);
    const schemaContractSha256 = sha256(await loadSchemaContract(pool));
    const capabilities = [
        'payments.view', 'payments.create', 'payments.confirm_received',
        'fiscal.shift.open', 'fiscal.shift.close'
    ];
    const manifest = {
        schemaVersion: 1,
        release: {
            blockId: 'PARK-DAR-PRODUCTION-CONFIG-PLAN',
            expectedLiveSha,
            branch: 'codex/eventgenix-production',
            project: 'fortunate-appreciation',
            environment: 'production',
            service: '8223324090'
        },
        legalEntity: { key: 'planner_fixture_entity', name: 'Planner fixture entity', taxIdentifier: null },
        providerOrganizationId: 'org-test-planner',
        schemaContractSha256,
        profiles: [{ key: 'event_genix' }, { key: 'dar' }],
        locations: [
            { key: 'park_production', profileKey: 'event_genix', alias: 'park', displayName: 'PARK', providerOutletId: 'outlet-test-planner-park' },
            { key: 'dar_production', profileKey: 'dar', alias: 'dar', displayName: 'DAR', providerOutletId: 'outlet-test-planner-dar' },
            { key: 'shared_test', profileKey: 'event_genix', alias: 'shared_test', displayName: 'Test register', providerOutletId: 'outlet-test-planner-shared' }
        ],
        registers: [
            { key: 'park_production', profileKey: 'event_genix', locationKey: 'park_production', alias: 'middle', displayName: 'Middle register', providerRegisterId: 'register-test-planner-park', credentialRef: 'PARK_MIDDLE_PROD', expectedIsTest: false, integrationOwnerUserId: userId },
            { key: 'dar_production', profileKey: 'dar', locationKey: 'dar_production', alias: 'dar', displayName: 'Studio register', providerRegisterId: 'register-test-planner-dar', credentialRef: 'DAR_DAR_PROD', expectedIsTest: false, integrationOwnerUserId: userId },
            { key: 'shared_test', profileKey: 'event_genix', locationKey: 'shared_test', alias: 'shared_test', displayName: 'Test register', providerRegisterId: 'register-test-planner-shared', credentialRef: 'SHARED_TEST_REGISTER', expectedIsTest: true, integrationOwnerUserId: userId }
        ],
        bindings: [
            { key: 'park_production', registerKey: 'park_production', userId, providerCashierId: 'cashier-test-planner-park', credentialRef: 'PARK_MIDDLE_CASHIER_PROD', displayName: 'PARK cashier', cashierLogin: 'mock-login-planner-park', capabilities },
            { key: 'dar_production', registerKey: 'dar_production', userId, providerCashierId: 'cashier-test-planner-dar', credentialRef: 'DAR_DAR_CASHIER_PROD', displayName: 'DAR cashier', cashierLogin: 'mock-login-planner-dar', capabilities },
            { key: 'shared_test', registerKey: 'shared_test', userId, providerCashierId: 'cashier-test-planner-shared', credentialRef: 'SHARED_TEST_CASHIER', displayName: 'Test cashier', cashierLogin: 'mock-login-planner-shared', capabilities }
        ],
        routes: [
            { optionId: 'park_production', businessContext: 'event_genix', registerKey: 'park_production', mode: 'production', expectedIsTest: false, sharedRegisterGroup: null },
            { optionId: 'dar_production', businessContext: 'dar', registerKey: 'dar_production', mode: 'production', expectedIsTest: false, sharedRegisterGroup: null },
            { optionId: 'park_test', businessContext: 'event_genix', registerKey: 'shared_test', mode: 'test', expectedIsTest: true, sharedRegisterGroup: 'checkbox_single_test_register' },
            { optionId: 'dar_test', businessContext: 'dar', registerKey: 'shared_test', mode: 'test', expectedIsTest: true, sharedRegisterGroup: 'checkbox_single_test_register' }
        ],
        catalogMembership: {
            event_genix: { expectedCount: 140, itemCodesSha256: sha256(parkRows.rows.map(row => row.item_code).sort()) },
            dar: {
                expectedCount: 21,
                itemCodesSha256: sha256(darRows.rows.map(row => row.item_code).sort()),
                productPriceContractSha256: DAR_CATALOG_CONTRACT_SHA256
            }
        },
        admissionMappings: ticketRows.rows.map(row => ({ itemCode: row.code, fiscalItemName: row.name })),
        migrationDigests: migrationDigestMap(loadMigrationDigests(root))
    };

    const admin = await pool.connect();
    const roleName = `park_dar_planner_ro_${process.pid}_${Date.now()}`;
    try {
        await admin.query(`CREATE ROLE "${roleName}" NOLOGIN`);
        await admin.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
        await admin.query(`GRANT USAGE ON SCHEMA public TO "${roleName}"`);
        await admin.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO "${roleName}"`);
        await admin.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await admin.query(`SET LOCAL ROLE "${roleName}"`);
        const identity = await admin.query(`SELECT current_database() AS database_name,
                                                   current_user AS database_user,
                                                   inet_server_addr()::text AS server_address,
                                                   inet_server_port() AS server_port,
                                                   current_setting('server_version_num') AS server_version_num,
                                                   (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_oid,
                                                   (SELECT system_identifier::text FROM pg_control_system()) AS system_identifier,
                                                   (SELECT datdba::text FROM pg_database WHERE datname=current_database()) AS database_owner_oid,
                                                   (SELECT pg_encoding_to_char(encoding) FROM pg_database WHERE datname=current_database()) AS database_encoding,
                                                   (SELECT datcollate FROM pg_database WHERE datname=current_database()) AS database_collate,
                                                   (SELECT datctype FROM pg_database WHERE datname=current_database()) AS database_ctype`);
        const manifestFileSha256 = sha256(Buffer.from(JSON.stringify(manifest)));
        const attestation = {
            schemaVersion: 2,
            source: PRODUCTION_ATTESTATION_SOURCE,
            audience: PRODUCTION_ATTESTATION_AUDIENCE,
            origin: PRODUCTION_ORIGIN,
            blockId: manifest.release.blockId,
            nonce: '123e4567-e89b-42d3-a456-426614174001',
            manifestSha256: manifestFileSha256,
            observedAt: new Date(Date.now() - 1000).toISOString(),
            expiresAt: new Date(Date.now() + 4 * 60_000).toISOString(),
            liveSha: expectedLiveSha,
            branch: 'codex/eventgenix-production',
            project: 'fortunate-appreciation',
            environment: 'production',
            service: '8223324090',
            runtimeIdentitySha256: PRODUCTION_RUNTIME_IDENTITY_SHA256,
            databaseFingerprintSha256: databaseFingerprint(identity.rows[0]),
            globalGates: Object.fromEntries(GLOBAL_GATE_NAMES.map(name => [name, false]))
        };
        await admin.query('ROLLBACK');
        const attestationEnvelope = await fetchProductionAttestation({
            manifest,
            manifestSha256: manifestFileSha256,
            nonce: attestation.nonce,
            async fetchImpl(url) {
                return {
                    ok: true,
                    redirected: false,
                    url: String(url),
                    headers: { get: () => 'application/json' },
                    async text() { return JSON.stringify(attestation); }
                };
            }
        });
        let roleApplied = false;
        const readOnlyClient = {
            async query(sql, params) {
                const result = await admin.query(sql, params);
                if (!roleApplied && String(sql).startsWith('BEGIN TRANSACTION')) {
                    await admin.query(`SET LOCAL ROLE "${roleName}"`);
                    roleApplied = true;
                }
                return result;
            },
            release() {}
        };
        const result = await runReadOnlyPlan({
            dbPool: { async connect() { return readOnlyClient; } },
            manifest,
            attestationEnvelope,
            manifestFileSha256,
            expectedManifestSha256: manifestFileSha256,
            migrationRoot: root,
            env: {}
        });
        assert.equal(result.ready, true);
        assert.equal(result.readOnlyProof, true);
        assert.equal(result.migrationHead, 351);
        assert.deepEqual(result.counts.profiles, { insert: 2, update: 0, noOp: 0, conflict: 0 });
        assert.deepEqual(result.counts.registers, { insert: 3, update: 0, noOp: 0, conflict: 0 });
        assert.deepEqual(result.counts.routes, { insert: 4, update: 0, noOp: 0, conflict: 0 });
        assert.deepEqual(result.counts.catalogMappings, { insert: 322, update: 0, noOp: 0, conflict: 0 });
        assert.deepEqual(result.counts.admissionMappings, { insert: 12, update: 0, noOp: 0, conflict: 0 });
        assert.deepEqual(result.catalog, { eventGenix: 140, dar: 21 });
        const publicOutput = JSON.stringify(result);
        for (const hidden of [
            manifest.providerOrganizationId,
            manifest.registers[0].providerRegisterId,
            manifest.bindings[0].cashierLogin
        ]) assert.equal(publicOutput.includes(hidden), false);
    } finally {
        await admin.query('ROLLBACK').catch(() => {});
        await admin.query('GRANT ALL ON SCHEMA public TO PUBLIC').catch(() => {});
        await admin.query(`DROP ROLE IF EXISTS "${roleName}"`).catch(() => {});
        admin.release();
    }
});

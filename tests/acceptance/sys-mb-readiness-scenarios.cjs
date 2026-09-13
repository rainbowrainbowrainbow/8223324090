'use strict';

// Acceptance-only collector and read probes. Runtime modules are not replaced.
// Seed writes are restricted to the parent-owned disposable D06 database.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { runOwnershipPreflight, safeFailure } = require('../../scripts/audit-multibusiness-ownership');

const OWNED_TABLES = Object.freeze([
    'bookings', 'customers', 'leads', 'lead_customer_links', 'tasks', 'products', 'timeline_resources',
    'finance_transactions', 'finance_accounts', 'finance_categories',
    'warehouse_stock', 'warehouse_locations', 'warehouse_history', 'warehouse_stock_movements',
    'graduation_settings', 'graduation_services', 'graduation_packages', 'graduation_package_items',
    'graduation_quotes', 'graduation_child_packs', 'graduation_children',
    'graduation_diploma_templates', 'graduation_diploma_exports', 'graduation_automation_state'
]);
const EDGES = Object.freeze([
    ['booking_customer', 'bookings', 'customer_id', 'customers', 'id'],
    ['booking_product', 'bookings', 'program_id', 'products', 'id'],
    ['booking_linked_parent', 'bookings', 'linked_to', 'bookings', 'id'],
    ['customer_lead', 'customers', 'lead_id', 'leads', 'id'],
    ['lead_booking', 'leads', 'booking_id', 'bookings', 'id'],
    ['lead_product', 'leads', 'program_id', 'products', 'id'],
    ['lead_link_lead', 'lead_customer_links', 'lead_id', 'leads', 'id'],
    ['lead_link_customer', 'lead_customer_links', 'customer_id', 'customers', 'id'],
    ['finance_booking', 'finance_transactions', 'booking_id', 'bookings', 'id'],
    ['finance_account', 'finance_transactions', 'account_id', 'finance_accounts', 'id'],
    ['finance_category', 'finance_transactions', 'category_id', 'finance_categories', 'id'],
    ['stock_location', 'warehouse_stock', 'location_id', 'warehouse_locations', 'id'],
    ['stock_history', 'warehouse_history', 'stock_id', 'warehouse_stock', 'id'],
    ['stock_movement', 'warehouse_stock_movements', 'warehouse_stock_id', 'warehouse_stock', 'id'],
    ['graduation_package_item_package', 'graduation_package_items', 'package_id', 'graduation_packages', 'id'],
    ['graduation_package_item_service', 'graduation_package_items', 'service_id', 'graduation_services', 'id'],
    ['graduation_pack_quote', 'graduation_child_packs', 'graduation_quote_id', 'graduation_quotes', 'id'],
    ['graduation_child_quote', 'graduation_children', 'graduation_quote_id', 'graduation_quotes', 'id'],
    ['graduation_child_pack', 'graduation_children', 'child_pack_id', 'graduation_child_packs', 'id'],
    ['graduation_export_quote', 'graduation_diploma_exports', 'graduation_quote_id', 'graduation_quotes', 'id']
]);
const collectionDefinition = Object.freeze({
    source: 'ACTUAL_LOCAL_APP_DISPOSABLE_POSTGRESQL',
    ownerTables: OWNED_TABLES, relationshipIds: EDGES.map(edge => edge[0]),
    transaction: 'REPEATABLE READ READ ONLY; explicit ROLLBACK',
    unknownOwnerPolicy: 'Observe NULL/empty and unregistered contexts; never coalesce an owner to Park.',
    limitations: [
        'Fixture rows and application seeds are synthetic; counts are not a production inventory or an owner approval.',
        'This finite relationship list does not inspect embedded JSON, external assets, provider jobs or every operational join.',
        'Missing table/column, permission denial or RLS produces NOT_TESTABLE rather than a zero count.',
        'MD compatibility permits some opaque external product codes; missing product counts alone do not prove a service defect.',
        'Staff/payroll/certificate allocation and amounts are not inferred from membership or row counts.',
        'Background workers and outbound providers are held by the parent harness; their usage/delivery cannot be measured here.'
    ]
});

function safeCode(error) {
    return /^[A-Z0-9_]{3,90}$/.test(String(error?.code || '')) ? error.code : 'READINESS_COLLECTION_FAILED';
}

async function assertFixtureDatabase(db, fixture) {
    assert.notEqual(process.env.NODE_ENV, 'production');
    assert.match(String(fixture?.database || ''), /^eventgenix_d06_test_[a-f0-9]{32}$/);
    const result = await db.query('SELECT current_database() AS name');
    assert.equal(result.rows[0]?.name, fixture.database, 'Readiness must use the exact parent-owned fixture database');
}

async function seed({ db, fixture }) {
    await assertFixtureDatabase(db, fixture);
    const suffix = crypto.createHash('sha256').update(String(fixture.runId)).digest('hex').slice(0, 10);
    const marker = `D06_READINESS_${suffix}`;
    // Measure the same collector before injection: a nonzero startup count alone
    // must not satisfy the controlled sensitivity assertion after injection.
    const before = await collectOwnershipReadiness(db, fixture);
    const state = { source: 'DELIBERATE_DISPOSABLE_SENTINELS', marker, rows: {}, constraints: {},
        baseline: { unregisteredProductRows: before.tables.products?.counts?.unregisteredContextRows ?? null,
            crossContextCustomerLinks: before.relationships.lead_link_customer?.counts?.crossContextRows ?? null } };
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        let sequence = 0;
        async function insert(name, sql, params) {
            const savepoint = `d06_readiness_seed_${++sequence}`;
            await client.query(`SAVEPOINT ${savepoint}`);
            try {
                const result = await client.query(sql, params);
                assert.equal(result.rowCount, 1);
                const row = result.rows[0];
                await client.query(`RELEASE SAVEPOINT ${savepoint}`);
                state.rows[name] = { status: 'SEEDED', id: row.id };
                return row.id;
            } catch (error) {
                await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
                await client.query(`RELEASE SAVEPOINT ${savepoint}`);
                state.rows[name] = { status: 'NOT_TESTABLE', code: safeCode(error),
                    column: /^[a-z_][a-z0-9_]*$/.test(error.column || '') ? error.column : null };
                return null;
            }
        }
        await insert('staff', `INSERT INTO staff (name,department,position,is_active)
            VALUES ($1,'D06_SYNTHETIC','Fixture only',true) RETURNING id`, [marker]);
        state.certificateCode = `D06${suffix.toUpperCase()}`;
        await insert('certificate', `INSERT INTO certificates
            (cert_code,display_mode,display_value,type_text,valid_until,status)
            VALUES ($1,'fio',$2,'Synthetic read probe','2099-12-31','active') RETURNING id`,
        [state.certificateCode, marker]);
        await insert('art', `INSERT INTO brand_guidelines (category,title,value,is_active,created_by)
            VALUES ('rule',$1,'Synthetic read probe',true,'d06_fixture') RETURNING id`, [marker]);
        await insert('unregisteredProduct', `INSERT INTO products
            (id,business_context,code,timeline_code,label,name,category,duration,price)
            VALUES ($1,'d06_unregistered',$2,'Q6U',$3,$3,'animation',30,0) RETURNING id`,
        [`d06_orphan_product_${suffix}`, `D06${suffix}`, marker]);
        const leadId = await insert('crossContextLead', `INSERT INTO leads
            (business_context,client_name,status) VALUES ($1,$2,'new') RETURNING id`, [fixture.contexts.park, marker]);
        const customerId = await insert('crossContextCustomer', `INSERT INTO customers
            (business_context,name) VALUES ($1,$2) RETURNING id`, [fixture.contexts.dar, marker]);
        if (leadId && customerId) {
            await insert('crossContextLink', `INSERT INTO lead_customer_links
                (business_context,lead_id,customer_id,link_type,source)
                VALUES ($1,$2,$3,'d06_readiness','d06_synthetic_collector_probe') RETURNING id`,
            [fixture.contexts.park, leadId, customerId]);
        }
        const nullOwner = await insert('nullOwnerProduct', `INSERT INTO products
            (id,business_context,code,timeline_code,label,name,category,duration,price)
            VALUES ($1,NULL,$2,'Q6N',$3,$3,'animation',30,0) RETURNING id`,
        [`d06_null_product_${suffix}`, `DN${suffix}`, marker]);
        state.constraints.nullProductOwner = nullOwner
            ? { status: 'INJECTED_WITHOUT_SCHEMA_CHANGE' }
            : { status: 'NOT_TESTABLE', reason: 'EXISTING_CONSTRAINT_OR_SCHEMA_REJECTED_SENTINEL',
                code: state.rows.nullOwnerProduct.code, column: state.rows.nullOwnerProduct.column };
        if (customerId) {
            const missingLeadId = -2147000000;
            assert.equal((await client.query('SELECT id FROM leads WHERE id=$1', [missingLeadId])).rowCount, 0);
            const orphanLink = await insert('orphanLeadLink', `INSERT INTO lead_customer_links
                (business_context,lead_id,customer_id,link_type,source)
                VALUES ($1,$2,$3,'d06_missing_parent','d06_synthetic_collector_probe') RETURNING id`,
            [fixture.contexts.park, missingLeadId, customerId]);
            state.constraints.missingLeadParent = orphanLink
                ? { status: 'INJECTED_WITHOUT_SCHEMA_CHANGE' }
                : { status: 'NOT_TESTABLE', reason: 'EXISTING_CONSTRAINT_OR_SCHEMA_REJECTED_SENTINEL', code: state.rows.orphanLeadLink.code };
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally { client.release(); }
    fixture.readiness = state;
    return state;
}

async function collectOwnershipReadiness(db, fixture) {
    await assertFixtureDatabase(db, fixture);
    const client = await db.connect();
    const tables = [...new Set([...OWNED_TABLES, 'organizations', 'businesses', 'business_memberships', 'organization_memberships'])];
    const result = { source: collectionDefinition.source, collectionStatus: 'COMPLETE', readOnly: false,
        tables: {}, relationships: {}, membership: {}, limitations: collectionDefinition.limitations };
    try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await client.query("SET LOCAL statement_timeout = '15s'");
        await client.query("SET LOCAL lock_timeout = '1s'");
        assert.equal((await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only, 'on');
        result.readOnly = true;
        const metadata = await client.query(`SELECT c.relname AS table_name,a.attname AS column_name,c.relrowsecurity
            FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
            JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
            WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
              AND c.relname=ANY($1::text[])`, [tables]);
        const columns = new Map(tables.map(table => [table, new Set()]));
        const rls = new Set();
        for (const row of metadata.rows) {
            columns.get(row.table_name)?.add(row.column_name);
            if (row.relrowsecurity) rls.add(row.table_name);
        }
        const available = (table, ...names) => columns.get(table)?.size && names.every(name => columns.get(table).has(name));
        let sequence = 0;
        async function observe(requirements, sql, params = []) {
            if (requirements.some(([table]) => rls.has(table))) {
                result.collectionStatus = 'INCOMPLETE';
                return { status: 'NOT_TESTABLE', reason: 'ROW_LEVEL_SECURITY', counts: null };
            }
            if (!requirements.every(([table, ...names]) => available(table, ...names))) {
                result.collectionStatus = 'INCOMPLETE';
                return { status: 'NOT_TESTABLE', reason: 'MISSING_SCHEMA', counts: null };
            }
            const savepoint = `d06_readiness_observe_${++sequence}`;
            await client.query(`SAVEPOINT ${savepoint}`);
            try {
                const query = await client.query(sql, params);
                const counts = Object.fromEntries(Object.entries(query.rows[0] || {}).map(([key, value]) => {
                    const number = Number(value);
                    assert.ok(/^\d+$/.test(String(value)) && Number.isSafeInteger(number));
                    return [key, number];
                }));
                await client.query(`RELEASE SAVEPOINT ${savepoint}`);
                return { status: 'OBSERVED', counts };
            } catch (error) {
                await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
                await client.query(`RELEASE SAVEPOINT ${savepoint}`);
                result.collectionStatus = 'INCOMPLETE';
                return { status: 'NOT_TESTABLE', reason: safeCode(error), counts: null };
            }
        }
        for (const table of OWNED_TABLES) {
            result.tables[table] = await observe([[table, 'business_context'], ['businesses', 'context_key', 'organization_id', 'status'], ['organizations', 'id', 'status']],
                `SELECT COUNT(*) AS "totalRows",
                  COUNT(*) FILTER (WHERE NULLIF(BTRIM(r.business_context),'') IS NULL) AS "missingContextRows",
                  COUNT(*) FILTER (WHERE NULLIF(BTRIM(r.business_context),'') IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM public.businesses b WHERE b.context_key=r.business_context)) AS "unregisteredContextRows",
                  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.businesses b LEFT JOIN public.organizations o ON o.id=b.organization_id
                    WHERE b.context_key=r.business_context AND (b.status IS DISTINCT FROM 'active' OR o.status IS DISTINCT FROM 'active'))) AS "inactiveOwnerRows"
                 FROM public."${table}" r`);
        }
        for (const [id, child, foreignKey, parent, primaryKey] of EDGES) {
            result.relationships[id] = await observe([[child, foreignKey, 'business_context'], [parent, primaryKey, 'business_context']],
                `SELECT COUNT(*) FILTER (WHERE NULLIF(BTRIM(c."${foreignKey}"::text),'') IS NOT NULL) AS "linkedRows",
                  COUNT(*) FILTER (WHERE NULLIF(BTRIM(c."${foreignKey}"::text),'') IS NOT NULL AND p."${primaryKey}" IS NULL) AS "orphanRows",
                  COUNT(*) FILTER (WHERE p."${primaryKey}" IS NOT NULL AND NULLIF(BTRIM(c.business_context),'') IS NOT NULL
                    AND NULLIF(BTRIM(p.business_context),'') IS NOT NULL AND c.business_context<>p.business_context) AS "crossContextRows",
                  COUNT(*) FILTER (WHERE NULLIF(BTRIM(c."${foreignKey}"::text),'') IS NOT NULL
                    AND (NULLIF(BTRIM(c.business_context),'') IS NULL OR (p."${primaryKey}" IS NOT NULL AND NULLIF(BTRIM(p.business_context),'') IS NULL))) AS "unknownContextRows"
                 FROM public."${child}" c LEFT JOIN public."${parent}" p ON p."${primaryKey}"::text=c."${foreignKey}"::text`);
        }
        result.membership.duplicateBusinessMemberships = await observe([['business_memberships', 'user_id', 'business_id']],
            `SELECT COUNT(*) AS "duplicateKeys" FROM (SELECT user_id,business_id FROM business_memberships GROUP BY user_id,business_id HAVING COUNT(*)>1) duplicated`);
        result.membership.activeWithoutOrganizationMembership = await observe([
            ['business_memberships', 'user_id', 'business_id', 'is_active'], ['businesses', 'id', 'organization_id'],
            ['organization_memberships', 'user_id', 'organization_id', 'is_active']],
        `SELECT COUNT(*) AS "rows" FROM business_memberships bm JOIN businesses b ON b.id=bm.business_id
            WHERE bm.is_active IS TRUE AND NOT EXISTS (SELECT 1 FROM organization_memberships om
                WHERE om.user_id=bm.user_id AND om.organization_id=b.organization_id AND om.is_active IS TRUE)`);
        await client.query('ROLLBACK');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally { client.release(); }
}

async function run({ baseUrl, fixture, request, db, record }) {
    assert.equal(new URL(baseUrl).hostname, '127.0.0.1');
    await assertFixtureDatabase(db, fixture);
    const output = { definition: collectionDefinition, profileMatrix: [], protectedReadMatrix: [],
        compatibility: { source: 'MEASURED_FIXTURE_PROFILE_REQUESTS_ONLY', membershipRequests: 0,
            compatibilityRequests: 0, failedRequests: 0, runtimeTelemetry: {
                status: 'NOT_AVAILABLE', authoritativeUsage: null, observationWindow: null,
                coverage: 'Profile probes only; API audit excludes reads and ordinary403; no complete mode/ingress counter.',
                backgroundWorkers: 'HELD_BY_PARENT_HARNESS', outboundProviders: 'FORBIDDEN',
                zeroUsageEstablished: false } }, sentinelSetup: fixture.readiness || null };
    const cases = [['owner', fixture.contexts.park], ['owner', fixture.contexts.dar],
        ['multiOrg', fixture.contexts.park], ['multiOrg', fixture.contexts.other], ['otherOrg', fixture.contexts.other]];
    if (fixture.actors.compatibility) cases.push(['compatibility', 'maysternya_doli']);
    for (const [actor, context] of cases) {
        const id = `D06-READINESS-PROFILE-${actor}-${context}`;
        try {
            const response = await request({ actor, path: '/api/auth/business-profile', context });
            const profile = response.body?.businessProfile;
            const active = profile?.activeProfile;
            const passed = response.status === 200 && active?.businessContext === context
                && ['membership', 'compatibility'].includes(profile?.membershipMode);
            const observed = { actor, context, httpStatus: response.status, code: response.body?.code || null,
                activeContext: profile?.activeBusinessContext || null, membershipMode: profile?.membershipMode || null,
                role: typeof response.body?.user?.role === 'string' ? response.body.user.role : null,
                roles: Array.isArray(response.body?.user?.roles)
                    ? response.body.user.roles.filter(role => typeof role === 'string') : null,
                modulesSource: active?.modules?.source || null,
                enabledModules: active?.modules?.enabledIds || [],
                modules: (active?.modules?.descriptors || []).map(module => ({ key: module.key, status: module.status,
                    canEnable: module.canEnable, enabled: active.modules.enabled?.[module.key] === true })) };
            output.profileMatrix.push(observed);
            if (passed) output.compatibility[profile.membershipMode === 'membership' ? 'membershipRequests' : 'compatibilityRequests']++;
            else output.compatibility.failedRequests++;
            record({ id, domain: 'readiness_profile', status: passed ? 'PASS' : 'FAIL', method: 'GET',
                path: '/api/auth/business-profile', expected: { status: 200, activeContext: context }, observed });
        } catch (error) {
            output.compatibility.failedRequests++;
            record({ id, domain: 'readiness_profile', status: 'FAIL', path: '/api/auth/business-profile', observed: { code: safeCode(error) } });
        }
    }
    const protectedCases = [
        ['staff', '/api/staff', 'staff'],
        ['certificates', '/api/certificates', 'certificate'],
        ['art', '/api/art-director/brand', 'art'],
        ['payroll', `/api/payroll/settlement?month=${String(fixture.date).slice(0, 7)}`, null]
    ];
    for (const [actor, context] of [['owner', fixture.contexts.dar], ['otherOrg', fixture.contexts.other]]) {
        for (const [domain, path, sentinel] of protectedCases) {
            const id = `D06-READINESS-PROTECTED-${domain}-${context}`;
            if (sentinel && fixture.readiness?.rows?.[sentinel]?.status !== 'SEEDED') {
                record({ id, domain, status: 'NOT_TESTABLE', method: 'GET', path,
                    observed: { reason: 'CONTROLLED_SENTINEL_NOT_SEEDED', code: fixture.readiness?.rows?.[sentinel]?.code || null } });
                continue;
            }
            try {
                const response = await request({ actor, path, context });
                const markerPresent = sentinel ? JSON.stringify(response.body || {}).includes(fixture.readiness.marker) : null;
                const code = response.body?.code || null;
                const explicitContainment = response.status === 403 && /(?:not_migrated|module_disabled)$/.test(String(code || ''));
                const status = explicitContainment ? 'PASS' : response.status === 403 ? 'NOT_TESTABLE' : 'FAIL';
                const observed = { actor, context, httpStatus: response.status, code, sentinelPresent: markerPresent,
                    outcome: explicitContainment ? 'EXPLICIT_UNAVAILABLE_GUARD' : response.status === 403
                        ? 'ROLE_OR_OTHER_DENIAL_NOT_DOMAIN_PROOF' : markerPresent
                            ? 'UNOWNED_SYNTHETIC_RECORD_EXPOSED' : 'UNMIGRATED_ENDPOINT_NOT_DEMONSTRABLY_CONTAINED' };
                output.protectedReadMatrix.push({ domain, method: 'GET', path, status, ...observed });
                record({ id, domain, status, method: 'GET', path,
                    expected: { status: 403, behavior: 'Unsupported membership domain is unavailable before reading global records.' }, observed });
            } catch (error) {
                record({ id, domain, status: 'FAIL', method: 'GET', path, observed: { code: safeCode(error) } });
            }
        }
    }
    try {
        output.ownership = await collectOwnershipReadiness(db, fixture);
        const unregistered = output.ownership.tables.products?.counts?.unregisteredContextRows;
        const crossContext = output.ownership.relationships.lead_link_customer?.counts?.crossContextRows;
        const expectedUnregistered = fixture.readiness?.rows?.unregisteredProduct?.status === 'SEEDED';
        const expectedCrossContext = fixture.readiness?.rows?.crossContextLink?.status === 'SEEDED';
        const baseline = fixture.readiness?.baseline || {};
        const productDelta = Number.isSafeInteger(unregistered) && Number.isSafeInteger(baseline.unregisteredProductRows)
            ? unregistered - baseline.unregisteredProductRows : null;
        const linkDelta = Number.isSafeInteger(crossContext) && Number.isSafeInteger(baseline.crossContextCustomerLinks)
            ? crossContext - baseline.crossContextCustomerLinks : null;
        const expectedLinkDelta = (expectedCrossContext ? 1 : 0)
            + (fixture.readiness?.rows?.orphanLeadLink?.status === 'SEEDED' ? 1 : 0);
        const canMeasureSensitivity = expectedUnregistered && expectedCrossContext && productDelta !== null && linkDelta !== null;
        const sensitive = productDelta === 1 && linkDelta === expectedLinkDelta;
        record({ id: 'D06-READINESS-COUNTS', domain: 'ownership_collection',
            status: !canMeasureSensitivity ? 'NOT_TESTABLE' : !sensitive ? 'FAIL'
                : output.ownership.collectionStatus === 'COMPLETE' ? 'PASS' : 'NOT_TESTABLE',
            expected: 'Read-only fixture collection detects deliberate sentinels; missing coverage is not zero.',
            observed: { collectionStatus: output.ownership.collectionStatus, readOnly: output.ownership.readOnly,
                unregisteredProductSentinelDetected: expectedUnregistered ? productDelta === 1 : null,
                crossContextLinkSentinelDetected: expectedCrossContext ? linkDelta === expectedLinkDelta : null,
                unregisteredProductDelta: productDelta, crossContextLinkDelta: linkDelta, expectedCrossContextLinkDelta: expectedLinkDelta,
                semantics: 'COLLECTOR_SENSITIVITY_ONLY_NOT_DATA_CLEANLINESS' } });
    } catch (error) {
        output.ownership = { collectionStatus: 'FAILED', code: safeCode(error), counts: null };
        record({ id: 'D06-READINESS-COUNTS', domain: 'ownership_collection', status: 'NOT_TESTABLE', observed: output.ownership });
    }
    try {
        output.legacyPreflight = await runOwnershipPreflight(db);
        record({ id: 'D06-READINESS-LEGACY-PREFLIGHT', domain: 'legacy_collection',
            status: output.legacyPreflight.collectionStatus === 'COMPLETE' ? 'PASS' : 'NOT_TESTABLE',
            observed: { collectionStatus: output.legacyPreflight.collectionStatus, readOnly: output.legacyPreflight.readOnly,
                ownershipEstablished: false, safeToAutoBackfill: false, source: collectionDefinition.source } });
    } catch (error) {
        output.legacyPreflight = safeFailure(error);
        record({ id: 'D06-READINESS-LEGACY-PREFLIGHT', domain: 'legacy_collection', status: 'NOT_TESTABLE', observed: output.legacyPreflight });
    }
    record({ id: 'D06-READINESS-COMPATIBILITY', domain: 'compatibility_usage', status: 'NOT_TESTABLE',
        expected: 'A complete observed ingress/window is required to establish zero compatibility usage.', observed: output.compatibility });
    output.decisions = { PARK_DAR_RELEASE_READY: 'HOLD', GLOBAL_MODEL_COMPLETE: 'HOLD',
        reasons: ['Protected enabled-domain gaps and OWN-01–08 pending decisions are not cleared by collector or fixture PASS.',
            'Runtime compatibility/background/provider coverage is incomplete.', 'No production/live QA or exact-SHA release evidence is collected here.'] };
    return output;
}

module.exports = { seed, run, collectOwnershipReadiness, collectionDefinition };

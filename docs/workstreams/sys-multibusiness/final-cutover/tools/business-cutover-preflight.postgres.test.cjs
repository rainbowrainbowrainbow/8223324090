'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const { Pool } = require('pg');
const { runPreflight, DOMAINS, LEGACY_ROOTS, EDGES, TABLES, LIMITS } = require('./business-cutover-preflight.cjs');

test('cutover preflight: disposable local PostgreSQL, counts only, explicit rollback', {
    skip: process.env.SYS_MB_CUTOVER_LOCAL_TEST !== 'true', timeout: 120000
}, async t => {
    assert.equal(process.platform, 'linux');
    assert.match(process.version, /^v22\./);
    assert.notEqual(process.env.NODE_ENV, 'production');
    for (const key of ['RAILWAY_ENVIRONMENT', 'RAILWAY_PROJECT_ID', 'RAILWAY_SERVICE_ID', 'MULTIBUSINESS_AUDIT_DATABASE_URL']) {
        assert.ok(!process.env[key], 'Operator or production environment must not be supplied to fixture runner');
    }
    const database = 'eventgenix_cutover_test_' + crypto.randomUUID().replaceAll('-', '');
    const role = 'cutover_reader_' + crypto.randomBytes(10).toString('hex');
    assert.match(database, /^eventgenix_cutover_test_[a-f0-9]{32}$/);
    assert.match(role, /^cutover_reader_[a-f0-9]{20}$/);
    const admin = new Pool({ host: '/var/run/postgresql', user: 'postgres', database: 'postgres', max: 1 });
    let pool, created = false, roleCreated = false;
    const trace = [];
    let readonlyProbe = false;
    const observedPool = { async connect() {
        const client = await pool.connect();
        return { async query(sql, params) {
            trace.push(String(sql));
            const result = await client.query(sql, params);
            if (sql === 'SHOW transaction_read_only') {
                assert.equal(result.rows[0].transaction_read_only, 'on');
                if (readonlyProbe) {
                    await client.query('SAVEPOINT test_write_rejection');
                    await assert.rejects(() => client.query("INSERT INTO products (id,business_context) VALUES ('must_not_exist','crm')"), { code: '25006' });
                    await client.query('ROLLBACK TO SAVEPOINT test_write_rejection');
                    await client.query('RELEASE SAVEPOINT test_write_rejection');
                }
            }
            if (sql === 'SHOW transaction_isolation') assert.equal(result.rows[0].transaction_isolation, 'repeatable read');
            return result;
        }, release(error) { client.release(error); } };
    } };
    const collect = async context => {
        const start = trace.length;
        const report = await runPreflight(observedPool, context);
        const queries = trace.slice(start);
        assert.equal(queries[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        assert.equal(queries.at(-1), 'ROLLBACK');
        assert.ok(queries.every(sql => /^(BEGIN|SET LOCAL|SHOW|SELECT|WITH|SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK)/i.test(sql.trim())));
        assert.ok(queries.every(sql => !/username|password|token|name\b/i.test(sql.replace(/table_name|column_name|relname|attname|nspname|filename/g, 'metadata'))));
        assert.equal(report.safeToApply, false);
        assert.equal(report.authorizationVerified, false);
        assert.equal(report.ownershipEstablished, false);
        assert.equal(report.rollbackVerified, true);
        return report;
    };
    async function snapshot() {
        const rows = [];
        for (const name of TABLES) {
            if ((await pool.query('SELECT to_regclass($1) AS relation', ['public.' + name])).rows[0].relation) {
                rows.push([name, (await pool.query(`SELECT to_jsonb(t) AS value FROM public."${name}" t ORDER BY to_jsonb(t)::text`)).rows]);
            }
        }
        return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    }
    try {
        await admin.query(`CREATE DATABASE "${database}"`); created = true;
        pool = new Pool({ host: '/var/run/postgresql', user: 'postgres', database, max: 1 });
        assert.equal((await pool.query('SELECT current_database() AS database')).rows[0].database, database);
        await t.test('empty and partial schema are incomplete evidence, never zero business readiness', async () => {
            const empty = await collect('crm');
            assert.equal(empty.collectionStatus, 'INCOMPLETE');
            assert.deepEqual(empty.registry, { status: 'NOT_COLLECTED', reason: 'MISSING_SCHEMA', counts: null });
            assert.ok(Object.values(empty.domains).every(row => row.status === 'NOT_COLLECTED'));
            await pool.query('CREATE TABLE products (id TEXT PRIMARY KEY)');
            assert.equal((await collect('crm')).domains.products.status, 'NOT_COLLECTED');
            await pool.query('ALTER TABLE products ADD COLUMN business_context TEXT');
        });
        // Minimal permissive schema is deliberate: malformed historical edges can be counted without altering app schema.
        await pool.query(`CREATE TABLE organizations (id INTEGER PRIMARY KEY,status TEXT);
            CREATE TABLE businesses (id INTEGER PRIMARY KEY,organization_id INTEGER,context_key TEXT,status TEXT,access_mode TEXT,modules JSONB);
            CREATE TABLE users (id INTEGER PRIMARY KEY,username TEXT,password_hash TEXT,role TEXT,extra_roles TEXT[] DEFAULT '{}',
                page_allowlist TEXT[] DEFAULT '{}',page_denylist TEXT[] DEFAULT '{}',action_allowlist TEXT[] DEFAULT '{}',
                action_denylist TEXT[] DEFAULT '{}',business_contexts TEXT[] DEFAULT '{}',default_business_context TEXT,is_active BOOLEAN);
            CREATE TABLE organization_memberships (organization_id INTEGER,user_id INTEGER,role TEXT,is_active BOOLEAN);
            CREATE TABLE business_memberships (business_id INTEGER,organization_id INTEGER,user_id INTEGER,is_active BOOLEAN,is_default BOOLEAN);
            CREATE TABLE schema_migrations (filename TEXT);
            CREATE TABLE settings (key TEXT,value JSONB);`);
        for (const name of DOMAINS.filter(name => name !== 'products')) await pool.query(`CREATE TABLE public."${name}" (id TEXT PRIMARY KEY,business_context TEXT)`);
        for (const name of LEGACY_ROOTS) await pool.query(`CREATE TABLE public."${name}" (id TEXT PRIMARY KEY)`);
        for (const [, child, fk] of EDGES) await pool.query(`ALTER TABLE public."${child}" ADD COLUMN IF NOT EXISTS "${fk}" TEXT`);
        await pool.query(`INSERT INTO organizations VALUES (1,'active'),(2,'inactive');
            INSERT INTO businesses VALUES (1,1,'maysternya_doli','active','compatibility','["timeline","programs","chat","SECRET_MODULE"]'),
                (2,1,'crm','active','compatibility','["tasks"]'),(3,2,'dar','inactive','membership','[]');
            INSERT INTO users (id,username,password_hash,role,business_contexts,default_business_context,is_active) VALUES
                (1,'SECRET_USERNAME','SECRET_PASSWORD','director','{md}','maysternya',true),
                (2,'SECRET_USERNAME2','SECRET_PASSWORD','manager','{maysternya_doli}','md',true),
                (3,'SECRET_USERNAME3','SECRET_PASSWORD','creator','{}','event_genix',true),
                (4,'SECRET_USERNAME4','SECRET_PASSWORD','director','{sales_crm}','срм',true),
                (5,'SECRET_USERNAME5','SECRET_PASSWORD','director','{crm}','crm',false);
            INSERT INTO organization_memberships VALUES (1,1,'owner',true),(1,3,'member',true),(1,4,'member',true);
            INSERT INTO business_memberships VALUES (1,1,1,true,true),(1,99,2,true,false),(1,1,99,true,false),
                (2,1,1,true,true),(2,1,4,true,false);
            INSERT INTO products VALUES ('SECRET_MD_PRODUCT','maysternya_doli'),('SECRET_CRM_PRODUCT','crm'),('SECRET_UNKNOWN_OWNER',NULL);
            INSERT INTO bookings (id,business_context,program_id,customer_id) VALUES
                ('SECRET_B1','maysternya_doli','MD',NULL),('SECRET_B2','maysternya_doli','SECRET_CRM_PRODUCT',NULL),
                ('SECRET_B3','maysternya_doli','SECRET_UNKNOWN_OWNER',NULL),('SECRET_B4','maysternya_doli','SECRET_MD_PRODUCT',NULL),
                ('SECRET_B5','crm',NULL,NULL),('SECRET_B6',NULL,NULL,NULL);
            INSERT INTO customers (id,business_context,lead_id) VALUES ('SECRET_CUSTOMER','crm',NULL);
            INSERT INTO leads (id,business_context,program_id,booking_id) VALUES ('SECRET_LEAD','maysternya_doli','TARO',NULL);
            INSERT INTO lead_customer_links (id,business_context,lead_id,customer_id) VALUES ('SECRET_LINK','maysternya_doli','SECRET_LEAD','SECRET_CUSTOMER');`);
        const before = await snapshot();
        readonlyProbe = true;
        const complete = await collect('maysternya_doli');
        await t.test('read-only enforced by PostgreSQL and repeated snapshots leave every source row unchanged', async () => {
            assert.equal(complete.collectionStatus, 'COMPLETE_FOR_DECLARED_SCOPE');
            assert.deepEqual(complete.coverage, { declaredObservations: 49, observed: 49, notCollected: 0,
                ownedTables: 24, legacyOwnershipRoots: 11, foreignEdges: 7, fullCutoverInventoryCovered: false });
            assert.equal(complete.registry.counts.businessRows, 1);
            assert.equal(complete.registry.counts.compatibilityRows, 1);
            const repeated = await collect('maysternya_doli');
            const stable = ({ generatedAt, ...rest }) => rest;
            assert.deepEqual(stable(repeated), stable(complete));
            assert.equal(await snapshot(), before);
            assert.equal((await pool.query('SHOW transaction_read_only')).rows[0].transaction_read_only, 'off');
        });
        await t.test('scoped edges expose external codes, foreign and missing ownership without assigning them', () => {
            assert.deepEqual(complete.relationships.booking_product.counts,
                { linkedRows: 4, missingParentRows: 1, unattributedParentRows: 1, foreignContextParentRows: 1 });
            assert.equal(complete.relationships.lead_product.counts.missingParentRows, 1);
            assert.equal(complete.relationships.lead_link_customer.counts.foreignContextParentRows, 1);
            assert.deepEqual(complete.domains.bookings.counts, { requestedBusinessRows: 4, globalUnattributedRows: 1, otherContextRows: 1 });
            assert.doesNotMatch(JSON.stringify(complete), /SECRET_|TARO|PASSWORD|USERNAME/);
            assert.equal(complete.modules.counts.unknownConfiguredEntries, 1);
            assert.equal(complete.modules.counts.catalog.find(row => row.key === 'chat').declaredStatus, 'not_migrated');
        });
        await t.test('access cohort, organization mismatch and defaults have exact independently known counts', async () => {
            assert.equal(complete.legacyCohort.counts.activeUsersExamined, 4);
            assert.equal(complete.legacyCohort.counts.legacyPotentialCohortUsers, 2);
            assert.equal(complete.legacyCohort.counts.aliasAssignmentUsers, 1);
            assert.equal(complete.legacyCohort.counts.globalExplicitDefaultOutsideLegacyAllowedUsers, 1);
            assert.equal(complete.memberships.counts.organizationMismatchRows, 1);
            assert.equal(complete.memberships.counts.missingOrInactiveUserRows, 1);
            assert.equal(complete.defaults.counts.duplicateDefaultUserOrganizations, 1);
            assert.equal(complete.defaults.counts.activeOrganizationOwners, 1);
            const crm = await collect('crm');
            assert.equal(crm.legacyCohort.counts.legacyPotentialCohortUsers, 2);
            assert.equal(crm.legacyCohort.counts.globalExplicitDefaultOutsideLegacyAllowedUsers, 1);
            assert.equal(crm.domains.bookings.counts.requestedBusinessRows, 1);
        });
        readonlyProbe = false;
        await t.test('module payloads are bounded and duplicate registry keys cannot produce a complete inventory', async () => {
            const original = (await pool.query('SELECT modules FROM businesses WHERE id=1')).rows[0].modules;
            await pool.query("UPDATE businesses SET modules=jsonb_build_array(repeat('x',17000)) WHERE id=1");
            assert.equal((await collect('maysternya_doli')).modules.reason, 'MODULE_BUDGET_EXCEEDED');
            await pool.query('UPDATE businesses SET modules=$1::jsonb WHERE id=1', [JSON.stringify(original)]);
            await pool.query("INSERT INTO businesses VALUES (4,1,'maysternya_doli','active','membership','[]')");
            const duplicate = await collect('maysternya_doli');
            assert.equal(duplicate.registry.counts.businessRows, 2);
            assert.equal(duplicate.modules.reason, 'AMBIGUOUS_REGISTRY');
            await pool.query('DELETE FROM businesses WHERE id=4');
        });
        await t.test('RLS is not treated as whole-table visibility, including for superuser collectors', async () => {
            await pool.query('ALTER TABLE products ENABLE ROW LEVEL SECURITY');
            const result = await collect('maysternya_doli');
            assert.equal(result.domains.products.reason, 'ROW_LEVEL_SECURITY');
            assert.equal(result.relationships.booking_product.reason, 'ROW_LEVEL_SECURITY');
            assert.equal(result.domains.bookings.status, 'OBSERVED');
            await pool.query('ALTER TABLE products DISABLE ROW LEVEL SECURITY');
        });
        await t.test('restricted SELECT permissions preserve unavailable counts and recover independent metrics', async () => {
            await admin.query(`CREATE ROLE "${role}" NOLOGIN`); roleCreated = true;
            await pool.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
            await pool.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO "${role}"`);
            await pool.query(`REVOKE SELECT ON products FROM "${role}"`);
            const restricted = { async connect() {
                const client = await pool.connect();
                await client.query(`SET ROLE "${role}"`);
                return { query: (...args) => client.query(...args), release(error) { client.release(error || true); } };
            } };
            const result = await runPreflight(restricted, 'crm');
            assert.equal(result.domains.products.reason, 'SELECT_PERMISSION_REQUIRED');
            assert.equal(result.relationships.booking_product.counts, null);
            assert.equal(result.domains.bookings.status, 'OBSERVED');
        });
        await t.test('a held table lock times out locally, rolls back its observation and keeps unrelated evidence', async () => {
            const locker = new Pool({ host: '/var/run/postgresql', user: 'postgres', database, max: 1 });
            try {
                await locker.query('BEGIN');
                await locker.query('LOCK TABLE products IN ACCESS EXCLUSIVE MODE');
                const result = await collect('crm');
                assert.equal(result.domains.products.reason, 'LOCK_TIMEOUT');
                assert.equal(result.relationships.booking_product.counts, null);
                assert.equal(result.domains.bookings.status, 'OBSERVED');
            } finally { await locker.query('ROLLBACK'); await locker.end(); }
        });
        await t.test('oversized user rows and cohorts are explicitly unavailable, never sampled counts', async () => {
            await pool.query("UPDATE users SET page_allowlist=ARRAY[repeat('x',17000)] WHERE id=1");
            assert.equal((await collect('crm')).legacyCohort.reason, 'ACCESS_BUDGET_EXCEEDED');
            await pool.query("UPDATE users SET page_allowlist='{}' WHERE id=1");
            await pool.query(`INSERT INTO users (id,role,is_active) SELECT n,'director',true FROM generate_series(100,${100 + LIMITS.users}) n`);
            assert.equal((await collect('crm')).legacyCohort.reason, 'ACCESS_BUDGET_EXCEEDED');
            await pool.query('DELETE FROM users WHERE id>=100');
            await pool.query("INSERT INTO users (id,role,is_active,page_allowlist) SELECT n,'director',true,ARRAY[repeat('x',9000)] FROM generate_series(100,1100) n");
            assert.equal((await collect('crm')).legacyCohort.reason, 'ACCESS_BUDGET_EXCEEDED');
            await pool.query('DELETE FROM users WHERE id>=100');
            assert.equal(await snapshot(), before);
        });
    } finally {
        if (pool) await pool.end();
        if (created) {
            await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [database]);
            await admin.query(`DROP DATABASE "${database}"`);
            assert.equal((await admin.query('SELECT datname FROM pg_database WHERE datname=$1', [database])).rowCount, 0);
        }
        if (roleCreated) await admin.query(`DROP ROLE "${role}"`);
        await admin.end();
        process.stdout.write('[CUTOVER-PREFLIGHT] owned local database and fixture role cleanup verified\n');
    }
});

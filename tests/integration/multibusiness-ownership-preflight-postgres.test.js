'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { Pool } = require('pg');
const { runOwnershipPreflight } = require('../../scripts/audit-multibusiness-ownership');

const localSocket = process.env.BUSINESS_MEMBERSHIP_LOCAL_POSTGRES_TEST === '1';
const fixtureUrl = process.env.BUSINESS_MEMBERSHIP_TEST_DATABASE_URL;
function localConnection() {
    assert.notEqual(process.env.NODE_ENV, 'production');
    for (const key of ['RAILWAY_ENVIRONMENT', 'RAILWAY_PROJECT_ID', 'RAILWAY_SERVICE_ID']) assert.ok(!process.env[key]);
    if (localSocket) {
        assert.equal(process.platform, 'linux');
        return { host: '/var/run/postgresql', user: 'postgres', database: 'postgres' };
    }
    const url = new URL(fixtureUrl);
    assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
    assert.match(url.pathname, /(?:^|[_-])(test|testing|ci|disposable)(?:[_-]|$)/i);
    assert.doesNotMatch(url.pathname, /(?:^|[_-])(prod|production|live)(?:[_-]|$)/i);
    assert.notEqual(fixtureUrl, process.env.DATABASE_URL);
    return { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 5432),
        user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
        database: decodeURIComponent(url.pathname.slice(1)), ssl: false };
}

test('ownership preflight observes isolated PostgreSQL without mutating or disclosing records', {
    skip: !localSocket && !fixtureUrl, timeout: 120000
}, async t => {
    const connection = localConnection();
    const database = 'eventgenix_membership_test_' + crypto.randomUUID().replaceAll('-', '');
    assert.match(database, /^eventgenix_membership_test_[a-f0-9]{32}$/);
    const admin = new Pool({ ...connection, max: 1, connectionTimeoutMillis: 5000 });
    let pool;
    let created = false;
    let completeReport;
    try {
        await admin.query(`CREATE DATABASE "${database}"`);
        created = true;
        pool = new Pool({ ...connection, database, max: 1, connectionTimeoutMillis: 5000 });
        const observations = [];
        const observedSql = [];
        const observedPool = { async connect() {
            const client = await pool.connect();
            return { async query(sql, params) {
                observedSql.push(String(sql));
                const result = await client.query(sql, params);
                const text = String(sql).trim();
                if (/^(BEGIN|ROLLBACK|SHOW transaction_)/i.test(text)) {
                    observations.push({ sql: text, rows: result.rows });
                }
                return result;
            }, release(error) { client.release(error); } };
        } };
        async function collect() {
            const start = observations.length;
            const report = await runOwnershipPreflight(observedPool);
            const run = observations.slice(start);
            assert.match(run[0].sql, /^BEGIN/);
            assert.equal(run.find(row => /SHOW transaction_read_only/i.test(row.sql)).rows[0].transaction_read_only, 'on');
            assert.equal(run.find(row => /SHOW transaction_isolation/i.test(row.sql)).rows[0].transaction_isolation, 'repeatable read');
            assert.equal(run.at(-1).sql, 'ROLLBACK');
            assert.equal((await pool.query('SHOW transaction_read_only')).rows[0].transaction_read_only, 'off');
            assert.equal(report.status, 'HOLD_OWNERSHIP_DECISIONS');
            assert.equal(report.readOnly, true);
            assert.equal(report.safeToAutoBackfill, false);
            assert.equal(report.ownershipEstablished, false);
            return report;
        }
        function counts(report, name) {
            assert.equal(report.relationships[name].status, 'OBSERVED', name);
            return report.relationships[name].counts;
        }

        await t.test('empty schema is missing evidence rather than successful zero ownership counts', async () => {
            const report = await collect();
            assert.equal(report.collectionStatus, 'INCOMPLETE_SCHEMA');
            assert.equal(Object.keys(report.tables).length, 21);
            for (const value of Object.values(report.tables)) {
                assert.equal(value.status, 'NOT_CHECKED_MISSING_TABLE');
                assert.equal(value.totalRows, null);
            }
            for (const value of Object.values(report.relationships)) {
                assert.equal(value.status, 'NOT_CHECKED_MISSING_SCHEMA');
                assert.equal(value.counts, null);
            }
        });

        await t.test('partial schema counts present tables without inferring missing relationships or owners', async () => {
            await pool.query(`CREATE TABLE booking_templates (id INT PRIMARY KEY, notes TEXT);
                INSERT INTO booking_templates VALUES (1, 'SECRET_TEMPLATE_NOTE');
                CREATE TABLE recurring_templates (id INT PRIMARY KEY, product_id TEXT);
                CREATE TABLE bookings (id TEXT PRIMARY KEY, recurring_template_id INT);`);
            const report = await collect();
            assert.equal(report.tables.booking_templates.totalRows, 1);
            assert.deepEqual(report.tables.booking_templates.ownershipColumns, []);
            assert.deepEqual(report.tables.booking_templates.missingOwnerRows, {});
            assert.equal(report.relationships.recurring_instances.status, 'NOT_CHECKED_MISSING_SCHEMA');
            assert.equal(report.relationships.booking_template_products.status, 'NOT_CHECKED_MISSING_SCHEMA');
            assert.equal(report.collectionStatus, 'INCOMPLETE_SCHEMA');
            assert.doesNotMatch(JSON.stringify(report), /SECRET_TEMPLATE_NOTE/);
        });

        // Deliberately no foreign-key enforcement in this disposable fixture: orphan counts must
        // handle partial restores and historical poisoned records rather than assume perfect data.
        await pool.query(`TRUNCATE booking_templates;
            ALTER TABLE booking_templates ADD COLUMN product_id TEXT, ADD COLUMN room_resource_id TEXT;
            ALTER TABLE recurring_templates ADD COLUMN room_resource_id TEXT, ADD COLUMN is_active BOOLEAN DEFAULT true;
            ALTER TABLE bookings ADD COLUMN business_context TEXT, ADD COLUMN linked_to TEXT, ADD COLUMN notes TEXT;
            CREATE TABLE catalog_definitions (id INT PRIMARY KEY, public_token TEXT, owner_business_context TEXT, name TEXT);
            CREATE TABLE catalog_subcategories (id INT PRIMARY KEY, catalog_id INT);
            CREATE TABLE catalog_items (id INT PRIMARY KEY, catalog_id INT);
            CREATE TABLE catalog_settings (id INT PRIMARY KEY, catalog_id INT, auto_enabled BOOLEAN);
            CREATE TABLE catalog_pages (id INT PRIMARY KEY, catalog_id INT);
            CREATE TABLE catalog_page_history (id INT PRIMARY KEY, catalog_page_id INT);
            CREATE TABLE catalog_automations (id INT PRIMARY KEY, catalog_id INT, is_active BOOLEAN);
            CREATE TABLE trend_proposals (id INT PRIMARY KEY, catalog_id INT, generated_item_id INT);
            CREATE TABLE catalog_image_blobs (id INT PRIMARY KEY, data BYTEA);
            CREATE TABLE recurring_booking_skips (id INT PRIMARY KEY, template_id INT, details TEXT);
            CREATE TABLE products (id TEXT PRIMARY KEY, business_context TEXT, name TEXT);
            CREATE TABLE timeline_resources (id INT PRIMARY KEY, resource_id TEXT, business_context TEXT);
            CREATE TABLE finance_transactions (id INT PRIMARY KEY, staff_id INT, certificate_id INT, business_context TEXT);
            CREATE TABLE staff (id INT PRIMARY KEY, name TEXT);
            CREATE TABLE certificates (id INT PRIMARY KEY, business_context TEXT);
            CREATE TABLE payroll_reports (id INT PRIMARY KEY, business_id INT);
            CREATE TABLE organizations (id INT PRIMARY KEY, name TEXT);
            CREATE TABLE businesses (id INT PRIMARY KEY, organization_id INT, context_key TEXT);
            INSERT INTO organizations VALUES (1, 'SECRET_ORGANIZATION_NAME');
            INSERT INTO businesses VALUES (1, 1, 'event_genix'), (2, 1, 'dar');
            INSERT INTO products VALUES ('park-product', 'event_genix', 'SECRET_PRODUCT_NAME'),
                ('dar-product', 'dar', 'SECRET_OTHER_PRODUCT'), ('unknown-product', NULL, 'SECRET_UNKNOWN_PRODUCT');
            INSERT INTO booking_templates VALUES (1, 'SECRET_TEMPLATE_NOTE', 'park-product', 'shared-room'),
                (2, NULL, NULL, NULL), (3, NULL, ' ', NULL), (4, NULL, 'SECRET_ORPHAN_PRODUCT_ID', NULL),
                (5, NULL, 'unknown-product', NULL), (6, NULL, 'dar-product', 'shared-room');
            INSERT INTO recurring_templates (id, product_id) VALUES (1, 'park-product'), (2, 'dar-product'),
                (3, NULL), (4, 'SECRET_ORPHAN_PRODUCT_ID'), (5, 'unknown-product');
            INSERT INTO bookings VALUES ('SECRET_BOOKING_1', 1, 'event_genix', NULL, 'SECRET_CUSTOMER_NOTE'),
                ('SECRET_BOOKING_2', 1, 'dar', 'SECRET_BOOKING_1', NULL),
                ('SECRET_BOOKING_3', 2, NULL, NULL, NULL), ('SECRET_BOOKING_4', 2, ' ', NULL, NULL),
                ('SECRET_BOOKING_5', 3, 'event_genix', NULL, NULL), ('SECRET_BOOKING_6', 999, 'unregistered', NULL, NULL),
                ('SECRET_BOOKING_7', 4, NULL, NULL, NULL), ('SECRET_BOOKING_8', NULL, 'event_genix', NULL, NULL);
            INSERT INTO catalog_definitions VALUES (1, 'SECRET_PUBLIC_TOKEN', NULL, 'SECRET_CATALOG_NAME'),
                (2, NULL, 'dar', NULL), (3, ' ', ' ', NULL);
            INSERT INTO catalog_items VALUES (1, 1), (2, 999), (3, NULL);
            INSERT INTO catalog_pages VALUES (1, 1), (2, 999), (3, NULL);
            INSERT INTO catalog_page_history VALUES (1, 1), (2, 999), (3, NULL);
            INSERT INTO recurring_booking_skips VALUES (1, 1, 'SECRET_SKIP_DETAIL'), (2, 999, NULL), (3, NULL, NULL);
            INSERT INTO timeline_resources VALUES (1, 'shared-room', 'event_genix'), (2, 'shared-room', 'dar'),
                (3, 'unknown-room', NULL), (4, 'dar-room', 'dar');
            INSERT INTO staff VALUES (1, 'SECRET_STAFF_NAME');
            INSERT INTO certificates VALUES (1, 'event_genix');
            INSERT INTO finance_transactions VALUES (1, 1, 1, 'event_genix'), (2, 999, 999, NULL), (3, NULL, NULL, 'unregistered');
            INSERT INTO payroll_reports VALUES (1, 1), (2, NULL);
            UPDATE booking_templates SET room_resource_id = 'orphan-room' WHERE id = 4;
            UPDATE booking_templates SET room_resource_id = 'unknown-room' WHERE id = 5;
            UPDATE recurring_templates SET room_resource_id = CASE id WHEN 1 THEN 'shared-room'
                WHEN 2 THEN 'orphan-room' WHEN 4 THEN 'unknown-room' WHEN 5 THEN 'dar-room' ELSE NULL END;
            UPDATE recurring_templates SET is_active = false WHERE id = 5;
            UPDATE bookings SET linked_to = 'SECRET_BOOKING_1' WHERE id = 'SECRET_BOOKING_3';
            UPDATE bookings SET linked_to = 'SECRET_MISSING_PARENT' WHERE id = 'SECRET_BOOKING_6';
            INSERT INTO catalog_settings VALUES (1, 1, true), (2, 999, true), (3, NULL, false);
            INSERT INTO catalog_automations VALUES (1, 1, true), (2, NULL, false), (3, 999, true);`);

        async function snapshot() {
            const tables = (await pool.query(`SELECT tablename FROM pg_tables
                WHERE schemaname = 'public' ORDER BY tablename`)).rows;
            const state = {};
            for (const { tablename } of tables) {
                assert.match(tablename, /^[a-z_]+$/);
                state[tablename] = (await pool.query(`SELECT to_jsonb(t) AS data FROM public."${tablename}" t ORDER BY id::text`)).rows;
            }
            return crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');
        }
        const before = await snapshot();
        completeReport = await collect();

        await t.test('complete schema records owner observations without assigning legacy templates', async () => {
            assert.equal(completeReport.collectionStatus, 'COMPLETE');
            assert.equal(completeReport.tables.booking_templates.totalRows, 6);
            assert.deepEqual(completeReport.tables.booking_templates.ownershipColumns, []);
            assert.deepEqual(completeReport.tables.recurring_templates.ownershipColumns, []);
            assert.deepEqual(completeReport.tables.catalog_definitions.ownershipColumns, ['owner_business_context']);
            assert.deepEqual(completeReport.tables.catalog_definitions.missingOwnerRows, { owner_business_context: 2 });
            assert.deepEqual(completeReport.tables.bookings.missingOwnerRows, { business_context: 3 });
            assert.deepEqual(completeReport.tables.payroll_reports.missingOwnerRows, { business_id: 1 });
            assert.deepEqual(completeReport.tables.businesses.missingOwnerRows, { organization_id: 0 });
        });

        await t.test('recurring mixed businesses, missing contexts and orphan parents have exact independent counts', () => {
            assert.deepEqual(counts(completeReport, 'recurring_instances'), { linkedRows: 7, orphanTemplateRows: 1,
                missingContextRows: 3, mixedContextTemplates: 1, templatesWithMissingContext: 2 });
            assert.deepEqual(counts(completeReport, 'recurring_skips_template'), { linkedRows: 2, orphanRows: 1 });
            assert.deepEqual(counts(completeReport, 'bookings_registry_context'), { missingContextRows: 3, unregisteredContextRows: 1 });
            assert.deepEqual(counts(completeReport, 'recurring_linked_children'), {
                linkedRows: 3, orphanParentRows: 1, crossContextRows: 1, unknownContextRows: 2 });
            assert.deepEqual(counts(completeReport, 'recurring_activity'), { activeRows: 4, withoutInstanceRows: 1 });
        });

        await t.test('product, catalog and finance edges count missing links without including identities', () => {
            assert.deepEqual(counts(completeReport, 'booking_template_products'), {
                missingProductRows: 2, orphanProductRows: 1, productWithoutContextRows: 1 });
            assert.deepEqual(counts(completeReport, 'recurring_template_products'), {
                missingProductRows: 1, orphanProductRows: 1, productWithoutContextRows: 1 });
            for (const edge of ['catalog_items_definition', 'catalog_pages_definition', 'catalog_page_history_page',
                'finance_staff', 'finance_certificate']) {
                assert.deepEqual(counts(completeReport, edge), { linkedRows: 2, orphanRows: 1 });
            }
            assert.deepEqual(counts(completeReport, 'catalog_public_tokens'), { rowsWithPublicToken: 1 });
            assert.deepEqual(counts(completeReport, 'booking_templates_rooms'), {
                missingRoomRows: 2, orphanRoomRows: 1, ambiguousContextRows: 2, roomWithoutContextRows: 1 });
            assert.deepEqual(counts(completeReport, 'recurring_templates_rooms'), {
                missingRoomRows: 1, orphanRoomRows: 1, ambiguousContextRows: 1, roomWithoutContextRows: 1 });
            assert.deepEqual(counts(completeReport, 'catalog_automation_flags'), { activeRows: 2 });
            assert.deepEqual(counts(completeReport, 'catalog_automatic_settings'), { autoEnabledRows: 2 });
            assert.deepEqual(counts(completeReport, 'finance_transactions_registry_context'), { missingContextRows: 1, unregisteredContextRows: 1 });
            assert.doesNotMatch(JSON.stringify(completeReport), /SECRET_|park-product|dar-product|shared-room/);
        });

        await t.test('repeat collection uses real read-only snapshots and leaves every fixture row unchanged', async () => {
            const repeated = await collect();
            const stable = report => { const { generatedAt, ...content } = report; return content; };
            assert.deepEqual(stable(repeated), stable(completeReport));
            assert.equal(await snapshot(), before);
            assert.equal(observations.filter(row => row.sql === 'ROLLBACK').length, 4);
        });

        await t.test('enabled and forced row security suppresses table and dependent counts even for a privileged fixture connection', async () => {
            await pool.query('ALTER TABLE catalog_definitions ENABLE ROW LEVEL SECURITY; ALTER TABLE catalog_definitions FORCE ROW LEVEL SECURITY');
            const start = observedSql.length;
            const report = await collect();
            assert.equal(report.collectionStatus, 'INCOMPLETE_VISIBILITY');
            assert.ok(report.collectionIssues.includes('ROW_SECURITY'));
            assert.equal(report.tables.catalog_definitions.status, 'NOT_CHECKED_ROW_SECURITY');
            assert.equal(report.tables.catalog_definitions.totalRows, null);
            for (const edge of ['catalog_items_definition', 'catalog_pages_definition', 'catalog_public_tokens']) {
                assert.equal(report.relationships[edge].status, 'NOT_CHECKED_ROW_SECURITY');
                assert.equal(report.relationships[edge].counts, null);
            }
            assert.deepEqual(counts(report, 'finance_staff'), { linkedRows: 2, orphanRows: 1 });
            assert.equal(observedSql.slice(start).filter(sql => /COUNT\s*\(/i.test(sql)
                && /public\."?catalog_definitions"?\b/.test(sql)).length, 0);
            assert.equal(await snapshot(), before);
            assert.doesNotMatch(JSON.stringify(report), /SECRET_/);
        });

        if (process.env.MULTIBUSINESS_AUDIT_SAVE_FIXTURE === '1') {
            const evidenceDir = path.join(__dirname, '../../.codex-temp/sys-mb-legacy-ownership');
            fs.mkdirSync(evidenceDir, { recursive: true });
            fs.writeFileSync(path.join(evidenceDir, 'fixture-preflight.json'), JSON.stringify(completeReport, null, 2) + '\n');
        }
    } finally {
        if (pool) await pool.end();
        try {
            if (created) {
                await admin.query(`DROP DATABASE "${database}"`);
                assert.equal((await admin.query('SELECT datname FROM pg_database WHERE datname = $1', [database])).rowCount, 0);
            }
        } finally { await admin.end(); }
    }
});

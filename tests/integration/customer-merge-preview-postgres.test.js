'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { previewCustomerMerge } = require('../../services/customerMerge');

test('merge reference preview uses real PostgreSQL without changing customer data', { timeout: 60000 }, async t => {
    const configuredUrl = process.env.CUSTOMER_MERGE_TEST_DATABASE_URL;
    assert.ok(configuredUrl, 'CUSTOMER_MERGE_TEST_DATABASE_URL required; no production fallback');
    const target = assertSafeTestDatabaseUrl(configuredUrl, process.env);
    assert.equal(target.isLocal, true, 'This fixture only runs on loopback PostgreSQL');
    const database = 'customer_merge_test_' + randomUUID().replaceAll('-', '');
    assert.match(database, /^customer_merge_test_[a-f0-9]{32}$/);
    const admin = new Pool({ connectionString: target.url.href, connectionTimeoutMillis: 5000 });
    let pool;
    let created = false;
    t.after(async () => {
        await pool?.end();
        try { if (created) await admin.query(`DROP DATABASE "${database}"`); }
        finally { await admin.end(); }
    });
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    const fixtureUrl = new URL(target.url.href);
    fixtureUrl.pathname = '/' + database;
    pool = new Pool({ connectionString: fixtureUrl.href, connectionTimeoutMillis: 5000 });
    await pool.query(`
        CREATE TABLE customers (id INT PRIMARY KEY, name TEXT, phone TEXT, instagram TEXT,
            child_name TEXT, child_birthday DATE, social_identities JSONB DEFAULT '[]', business_context TEXT,
            lead_id INT, total_bookings INT DEFAULT 88, total_spent INT DEFAULT 99999, loyalty_tier_id INT, birthday_discount_used DATE);
        CREATE TABLE leads (id INT PRIMARY KEY, business_context TEXT);
        CREATE TABLE bookings (id VARCHAR(50) PRIMARY KEY, customer_id INT REFERENCES customers(id) ON DELETE SET NULL,
            business_context TEXT, date VARCHAR(20), price INT, linked_to VARCHAR(50), status TEXT);
        CREATE TABLE conversations (id INT PRIMARY KEY, customer_id INT REFERENCES customers(id), lead_id INT REFERENCES leads(id), business_context TEXT);
        CREATE TABLE customer_children (id INT PRIMARY KEY, customer_id INT REFERENCES customers(id) ON DELETE CASCADE,
            business_context TEXT, lead_id INT REFERENCES leads(id), booking_id VARCHAR(50) REFERENCES bookings(id),
            name TEXT, birthday DATE, source_kind TEXT, source_payload JSONB DEFAULT '{}');
        CREATE UNIQUE INDEX children_legacy ON customer_children (business_context, customer_id, source_kind) WHERE source_kind = 'legacy_customer_child';
        CREATE TABLE lead_customer_links (id INT PRIMARY KEY, customer_id INT REFERENCES customers(id) ON DELETE CASCADE,
            lead_id INT REFERENCES leads(id), business_context TEXT, link_type TEXT, metadata JSONB DEFAULT '{}',
            UNIQUE (business_context, customer_id, lead_id, link_type));
        CREATE TABLE event_reviews (id INT PRIMARY KEY, customer_id INT REFERENCES customers(id) ON DELETE SET NULL,
            booking_id VARCHAR(50) REFERENCES bookings(id), rating INT);
        CREATE TABLE communication_log (id INT PRIMARY KEY, customer_id INT REFERENCES customers(id) ON DELETE CASCADE, summary TEXT);
        CREATE TABLE customer_tags (id INT PRIMARY KEY, customer_id INT REFERENCES customers(id) ON DELETE CASCADE, tag TEXT, UNIQUE(customer_id, tag));
        CREATE TABLE support_tickets (id INT PRIMARY KEY, customer_id INT REFERENCES customers(id));
        CREATE TABLE banquet_groups (id INT PRIMARY KEY, customer_id INT REFERENCES customers(id), primary_booking_id VARCHAR(50) REFERENCES bookings(id));
        CREATE TABLE certificates (id INT PRIMARY KEY, customer_id INT REFERENCES customers(id), amount INT);
        CREATE TABLE discount_usage (id INT PRIMARY KEY, customer_id INT REFERENCES customers(id), discount_amount INT);
        CREATE TABLE banquet_deposits (id INT PRIMARY KEY, customer_id INT REFERENCES customers(id), amount INT);
        CREATE TABLE graduation_quotes (id INT PRIMARY KEY, customer_id INT, total_price INT);
        CREATE TABLE customer_retention_log (id INT PRIMARY KEY, customer_id INT);
        CREATE TABLE tasks (id INT PRIMARY KEY, source_entity_type TEXT, source_entity_id VARCHAR(120), business_context TEXT);
        CREATE TABLE hermes_jobs (id INT PRIMARY KEY, source_entity_type TEXT, source_entity_id VARCHAR(120), business_context TEXT);
        CREATE TABLE trusted_qa_runs (id INT PRIMARY KEY, required_customer_id VARCHAR(120), business_context TEXT);
    `);
    const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")).rows.map(row => row.tablename);
    async function reset() {
        await pool.query('TRUNCATE ' + tables.join(', ') + ' CASCADE');
        await pool.query("INSERT INTO customers (id, name, phone, business_context) VALUES (1, 'Fixture A', '+380000000001', 'event_genix'), (2, 'Fixture B', '+380000000001', 'event_genix'), (3, 'Other business', '+380000000001', 'dar')");
    }
    async function snapshot() {
        const result = {};
        for (const table of tables) result[table] = (await pool.query(`SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]'::jsonb) AS rows FROM ${table} r`)).rows[0].rows;
        return result;
    }
    async function previewUnchanged() {
        const before = await snapshot();
        const result = await previewCustomerMerge(pool, 1, 2, 'event_genix');
        assert.deepEqual(await snapshot(), before, 'Preview must not write customer, child, task, review, tag or journal data');
        assert.equal(result.canMerge, false);
        assert.equal(result.changesPerformed, false);
        return result;
    }
    await t.test('empty pair is reviewed but merging is never enabled', async () => {
        await reset();
        const preview = await previewUnchanged();
        assert.equal(preview.reviewPassed, true);
        assert.ok(preview.records.every(row => row.count === 0));
    });
    await t.test('counts every stored relation including journal tables without business_context', async () => {
        await reset();
        await pool.query(`
            INSERT INTO leads VALUES (10, 'event_genix');
            INSERT INTO bookings VALUES ('fixture', 2, 'event_genix', '2026-10-03', 700, NULL, 'confirmed');
            INSERT INTO conversations VALUES (10, 2, 10, 'event_genix');
            INSERT INTO customer_children VALUES (10, 2, 'event_genix', 10, 'fixture', 'Fixture child', '2018-10-01', 'manual', '{}');
            INSERT INTO lead_customer_links VALUES (10, 2, 10, 'event_genix', 'customer_card', '{}');
            INSERT INTO event_reviews VALUES (10, 2, 'fixture', 5);
            INSERT INTO communication_log VALUES (10, 2, 'Fixture note');
            INSERT INTO customer_tags VALUES (10, 2, 'VIP');
            INSERT INTO support_tickets VALUES (10, 2);
            INSERT INTO banquet_groups VALUES (10, 2, 'fixture');
        `);
        const preview = await previewUnchanged();
        for (const table of ['bookings','conversations','customer_children','lead_customer_links','event_reviews','communication_log','customer_tags','support_tickets','banquet_groups']) {
            assert.equal(preview.records.find(row => row.key === table).count, 1, table);
        }
        assert.equal(preview.reviewPassed, true);
    });
    for (const [table, extra] of [['certificates','amount'],['discount_usage','discount_amount'],['banquet_deposits','amount'],['graduation_quotes','total_price']]) {
        await t.test('flags protected history in ' + table + ' without disclosing amounts', async () => {
            await reset();
            await pool.query(`INSERT INTO ${table} (id, customer_id, ${extra}) VALUES (10, 2, 7654321)`);
            const preview = await previewUnchanged();
            assert.ok(preview.blockers.some(row => row.code === 'CUSTOMER_MERGE_PROTECTED_HISTORY'));
            assert.doesNotMatch(JSON.stringify(preview), /7654321|amount|total_price/);
        });
    }
    for (const table of ['tasks','hermes_jobs']) {
        await t.test('finds typed text customer references in ' + table, async () => {
            await reset();
            await pool.query(`INSERT INTO ${table} VALUES (10, 'customer', '2', 'event_genix'), (11, 'lead', '2', 'event_genix')`);
            const preview = await previewUnchanged();
            assert.equal(preview.records.find(row => row.key === table).count, 1);
            assert.ok(preview.blockers.some(row => row.code === 'CUSTOMER_MERGE_UNTYPED_REFERENCE'));
        });
    }
    await t.test('finds retention and trusted QA references', async () => {
        await reset();
        await pool.query("INSERT INTO customer_retention_log VALUES (10, 2); INSERT INTO trusted_qa_runs VALUES (10, '2', 'event_genix')");
        const preview = await previewUnchanged();
        assert.ok(preview.blockers.some(row => row.code === 'CUSTOMER_MERGE_UNTYPED_REFERENCE'));
        assert.ok(preview.blockers.some(row => row.code === 'CUSTOMER_MERGE_PROTECTED_HISTORY'));
    });
    await t.test('rejects foreign business pairs and reports poisoned linked parents', async () => {
        await reset();
        await assert.rejects(previewCustomerMerge(pool, 1, 3, 'event_genix'), error => error.status === 404);
        await pool.query("INSERT INTO leads VALUES (10, 'dar'); INSERT INTO lead_customer_links VALUES (10, 2, 10, 'event_genix', 'customer_card', '{}')");
        const preview = await previewUnchanged();
        assert.ok(preview.blockers.some(row => row.code === 'CUSTOMER_MERGE_PARENT_REFERENCE'));
        await pool.query("INSERT INTO bookings (id, customer_id, business_context) VALUES ('foreign', 2, 'dar')");
        assert.ok((await previewUnchanged()).blockers.some(row => row.code === 'CUSTOMER_MERGE_FOREIGN_REFERENCE'));
    });
    await t.test('reports child, tag, legacy child and lead link collisions', async () => {
        await reset();
        await pool.query(`INSERT INTO leads VALUES (10, 'event_genix');
            INSERT INTO customer_children (id, customer_id, business_context, name, birthday, source_kind)
            VALUES (10, 1, 'event_genix', 'Fixture', '2018-01-01', 'manual'), (11, 2, 'event_genix', 'Fixture', '2018-01-01', 'manual');
            INSERT INTO customer_tags VALUES (10, 1, 'VIP'), (11, 2, 'VIP');
            INSERT INTO lead_customer_links VALUES (10, 1, 10, 'event_genix', 'customer_card', '{}'), (11, 2, 10, 'event_genix', 'customer_card', '{}');`);
        const codes = (await previewUnchanged()).blockers.map(row => row.code);
        for (const code of ['CUSTOMER_MERGE_CHILD_CONFLICT','CUSTOMER_MERGE_TAG_CONFLICT','CUSTOMER_MERGE_LEAD_LINK_CONFLICT']) assert.ok(codes.includes(code));
        await reset();
        await pool.query("UPDATE customers SET child_name = 'Legacy fixture' WHERE id = 2");
        assert.ok((await previewUnchanged()).blockers.some(row => row.code === 'CUSTOMER_MERGE_LEGACY_CHILD'));
    });
    await t.test('unknown FK and unknown typed reference are reported, not silently ignored', async () => {
        await reset();
        await pool.query("CREATE TABLE unknown_customer_link (id INT PRIMARY KEY, owner_id INT REFERENCES customers(id)); CREATE TABLE unknown_customer_job (id INT, source_entity_type TEXT, source_entity_id TEXT)");
        const preview = await previewUnchanged();
        assert.ok(preview.blockers.some(row => row.code === 'CUSTOMER_MERGE_REFERENCE_UNSUPPORTED'));
        await pool.query('DROP TABLE unknown_customer_link, unknown_customer_job');
    });
    await t.test('PostgreSQL itself prevents writes inside the service transaction and releases after error', async () => {
        await reset();
        const connection = await pool.connect();
        let releaseCount = 0;
        const wrapped = { connect: async () => ({
            async query(sql, params) {
                const result = await connection.query(sql, params);
                if (sql.startsWith('BEGIN')) await connection.query("UPDATE customers SET name = 'Must not change' WHERE id = 1");
                return result;
            }, release() { releaseCount++; connection.release(); }
        }) };
        const before = await snapshot();
        await assert.rejects(previewCustomerMerge(wrapped, 1, 2, 'event_genix'), error => error.code === '25006');
        assert.equal(releaseCount, 1);
        assert.deepEqual(await snapshot(), before);
        assert.equal((await previewUnchanged()).canMerge, false, 'Failed transaction does not poison a pooled client');
    });
});

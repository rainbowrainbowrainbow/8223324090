'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const birthdays = require('../../services/customerBirthdaySegments');
const { syncBirthdayTagsForCustomer } = require('../../services/customerBirthdayTags');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');

test('PostgreSQL birthday selection, full counts, edits, and single-family tag synchronization', async t => {
    const url = process.env.CUSTOMER_BIRTHDAYS_TEST_DATABASE_URL;
    assert.ok(url, 'Use npm run test:integration:customer-birthdays:isolated; production URLs are forbidden');
    assertSafeTestDatabaseUrl(url, process.env);
    const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000 });
    let client;
    t.after(() => { client?.release(); return pool.end(); });
    client = await pool.connect();
    // Session-local fixtures shadow public tables. No application schema or real records change.
    await client.query(`
        CREATE TEMP TABLE customers (id integer PRIMARY KEY, business_context text,
            child_name text, child_birthday date);
        CREATE TEMP TABLE customer_children (id integer PRIMARY KEY, customer_id integer,
            business_context text, name text, birthday date, sort_order integer DEFAULT 0,
            source_payload jsonb DEFAULT '{}');
        CREATE TEMP TABLE customer_tags (customer_id integer, tag text, color text,
            source text, system_key text, created_by integer, updated_at timestamptz);
        CREATE UNIQUE INDEX ON customer_tags(customer_id,system_key)
            WHERE source = 'system' AND system_key IS NOT NULL;
        INSERT INTO customers VALUES
            (1,'dar','Old','2019-07-01'), (2,'dar',NULL,NULL), (3,'event_genix',NULL,NULL),
            (4,'dar','Legacy','2020-02-29'), (5,'dar','Old replaced','2020-10-01'),
            (6,'dar','Old cleared','2020-10-01');
        INSERT INTO customer_children(id,customer_id,business_context,name,birthday,source_payload) VALUES
            (1,1,'dar','March','2020-03-12','{}'),
            (2,1,'dar','October A','2020-10-15','{}'),
            (3,1,'dar','October B','2021-10-17','{}'),
            (4,1,'dar','Replaced','2020-10-18','{"manual_review":{"superseded":true}}'),
            (5,1,'dar','Other business','2020-10-18','{}'),
            (6,2,'dar',NULL,'2020-02-29','{}'),
            (7,3,'event_genix','Foreign','2020-10-18','{}'),
            (8,5,'dar','Replaced','2020-10-18','{"manual_review":{"status":"superseded"}}'),
            (9,6,'dar','Cleared',NULL,'{}');
        UPDATE customer_children SET business_context='event_genix' WHERE id=5;
        INSERT INTO customer_tags VALUES
            (1,'VIP','#123456','manual',NULL,NULL,NULL),
            (1,'Іменинники липня','#EC4899','system','birthday_month_07',NULL,NULL);
    `);

    async function segment(tag, limit = 20) {
        const params = ['dar'];
        const filter = birthdays.customerBirthdayTagFilterSql([tag], params);
        return (await client.query(`SELECT c.id, birthday_segment.child_count,
            COUNT(*) OVER() AS families, SUM(birthday_segment.child_count) OVER() AS children
            FROM customers c ${filter.join}
            WHERE c.business_context=$1 AND ${filter.condition} ORDER BY c.id LIMIT ${limit}`, params)).rows;
    }
    assert.deepEqual((await segment('Іменинники жовтня')).map(row => row.id), [1]);
    assert.equal((await segment('birthday_month_10'))[0].child_count, 2);
    assert.deepEqual((await segment('birthday_month_03')).map(row => row.id), [1]);
    assert.deepEqual((await segment('birthday_month_07')).map(row => row.id), []);
    assert.deepEqual((await segment('birthday_month_02')).map(row => row.id), [2, 4]);

    await syncBirthdayTagsForCustomer(client, 1);
    let tags = (await client.query('SELECT * FROM customer_tags WHERE customer_id=1 ORDER BY tag')).rows;
    assert.deepEqual(tags.filter(tag => tag.source === 'system').map(tag => tag.system_key).sort(),
        ['birthday', 'birthday_month_03', 'birthday_month_10']);
    assert.equal(tags.find(tag => tag.tag === 'VIP').color, '#123456');

    await client.query("UPDATE customer_children SET birthday='2020-11-15' WHERE id=2");
    assert.equal((await segment('birthday_month_10'))[0].child_count, 1);
    assert.equal((await segment('birthday_month_11'))[0].child_count, 1);
    await client.query('UPDATE customer_children SET birthday=NULL WHERE customer_id=1');
    assert.deepEqual(await segment('birthday_month_10'), []);
    assert.deepEqual(await segment('birthday_month_07'), [], 'the legacy July birthday stays suppressed');
    await syncBirthdayTagsForCustomer(client, 1);
    tags = (await client.query('SELECT * FROM customer_tags WHERE customer_id=1')).rows;
    assert.deepEqual(tags.map(tag => tag.tag), ['VIP']);

    await client.query(`INSERT INTO customers SELECT id,'dar',NULL,NULL FROM generate_series(10,39) id;
        INSERT INTO customer_children(id,customer_id,business_context,birthday)
            SELECT id+100,id,'dar','2020-10-15' FROM generate_series(10,39) id;`);
    const bounded = await segment('birthday_month_10');
    assert.equal(bounded.length, 20);
    assert.equal(Number(bounded[0].families), 30);
    assert.equal(Number(bounded[0].children), 30);

    await client.query('BEGIN');
    try {
        await client.query("UPDATE customer_children SET birthday='2020-12-15' WHERE id=1");
        await syncBirthdayTagsForCustomer(client, 1);
        const pending = await client.query("SELECT system_key FROM customer_tags WHERE customer_id=1 AND source='system'");
        assert.deepEqual(pending.rows.map(row => row.system_key).sort(), ['birthday', 'birthday_month_12']);
    } finally {
        await client.query('ROLLBACK');
    }
    assert.equal((await client.query('SELECT birthday FROM customer_children WHERE id=1')).rows[0].birthday, null);
    assert.deepEqual((await client.query('SELECT tag FROM customer_tags WHERE customer_id=1')).rows.map(row => row.tag), ['VIP']);
});

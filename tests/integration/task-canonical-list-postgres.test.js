'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { Client } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const policy = require('../../services/taskDuplicatePolicy');

// Preserve the pre-optimization predicate as an independent SQL equivalence oracle.
function previousCanonicalFilter(alias = 't') {
    const other = 'task_duplicate_canonical';
    return `(COALESCE(${alias}.status, 'todo') IN ('done','archived','cancelled') OR NOT EXISTS (
        SELECT 1 FROM tasks ${other} WHERE ${other}.id < ${alias}.id
        AND ${policy.ACTIVE_TASK_STATUS_SQL.replaceAll('t.', other + '.')}
        AND ${policy.duplicateSignatureSql(other)} = ${policy.duplicateSignatureSql(alias)}))`;
}

async function captureLists(canonicalFilter, cases, pool) {
    const oldFilter = policy.activeDuplicateCanonicalFilterSql;
    const oldQuery = pool.query;
    const routeId = require.resolve('../../routes/tasks');
    const oldRoute = require.cache[routeId];
    const captured = [];
    let calls;
    try {
        policy.activeDuplicateCanonicalFilterSql = canonicalFilter;
        delete require.cache[routeId];
        pool.query = async (sql, params = []) => {
            calls.push({ sql: String(sql), params: [...params] });
            return { rows: /SELECT COUNT\(\*\)::int AS total FROM tasks t/i.test(sql) ? [{ total: 0 }] : [] };
        };
        const router = require('../../routes/tasks');
        const handler = router.stack.find(layer => layer.route?.path === '/' && layer.route.methods.get).route.stack.at(-1).handle;
        for (const item of cases) {
            calls = [];
            const userId = item.userId || 7;
            const response = { code: 200, status(value) { this.code = value; return this; }, json(body) { this.body = body; return this; } };
            await handler({ query: item.query, body: {}, headers: {}, user: {
                id: userId, userId, username: 'fixture-user-' + userId, name: 'Fixture User ' + userId,
                role: item.role || 'creator', business_contexts: ['event_genix', 'dar']
            } }, response);
            assert.equal(response.code, 200, item.name);
            const list = calls.find(call => /SELECT t\.\*/.test(call.sql) && /LIMIT \$/.test(call.sql));
            assert.ok(list, item.name + ': actual route query');
            captured.push({ ...item, list, count: calls.find(call => /SELECT COUNT\(\*\)::int AS total FROM tasks t/i.test(call.sql)) });
        }
    } finally {
        pool.query = oldQuery;
        policy.activeDuplicateCanonicalFilterSql = oldFilter;
        if (oldRoute) require.cache[routeId] = oldRoute;
        else delete require.cache[routeId];
    }
    return captured;
}

test('canonical task selection and full list queries preserve terminal rows, scope, pagination and child payloads', async () => {
    // The isolated runner already points its app at this disposable database.
    // Validate the dedicated input while allowing that deliberate URL equality.
    const target = assertSafeTestDatabaseUrl(
        process.env.TASK_QUERY_TEST_DATABASE_URL || process.env.BUSINESS_MEMBERSHIP_TEST_DATABASE_URL,
        { ...process.env, DATABASE_URL: '' }
    );
    assert.equal(target.isLocal, true, 'This regression fixture requires loopback PostgreSQL');
    const client = new Client({ connectionString: target.url.toString(), ssl: false, connectionTimeoutMillis: 5000 });
    const schema = 'task_canonical_' + randomBytes(8).toString('hex');
    const marker = 'owned-synthetic-' + schema;
    const { pool } = require('../../db');
    let created = false;
    try {
        await client.connect();
        await client.query(`CREATE SCHEMA ${schema}`);
        created = true;
        await client.query(`COMMENT ON SCHEMA ${schema} IS '${marker}'`);
        await client.query(`SET search_path TO ${schema},public`);
        await client.query("SET statement_timeout='10000ms'");
        await client.query(`CREATE TABLE users(id integer PRIMARY KEY,name text,username text);
            CREATE TABLE tasks(id integer PRIMARY KEY,title text,description text,status text,assigned_to text,owner text,
                owner_user_id integer,created_by_user_id integer,created_by text,business_context text,visibility text,date text,
                deadline timestamp,created_at timestamp,updated_at timestamp,completed_at timestamp,archived_at timestamp,
                scheduled_start_at timestamptz,snoozed_until timestamptz,priority text,category text,subcategory text,
                checklist_template_key text,template_id integer,pack_id integer,source_entity_type text,source_entity_id text,
                afisha_id integer,source_type text,source_id text,source_module text,related_entity_type text,task_mode text,
                type text,workflow_state text);
            CREATE TABLE task_subtasks(id integer PRIMARY KEY,task_id integer,title text,is_done boolean,sort_order integer,
                source_type text,created_at timestamp,completed_at timestamp,updated_at timestamp);
            CREATE TABLE task_dependencies(task_id integer,depends_on_task_id integer,PRIMARY KEY(task_id,depends_on_task_id));
            CREATE TABLE task_observers(task_id integer,user_id integer,access_level text,PRIMARY KEY(task_id,user_id));
            CREATE TABLE task_logs(task_id integer,actor text);
            CREATE TABLE task_action_history(task_id integer,actor_user_id integer,actor_name_snapshot text);
            CREATE INDEX task_fixture_subtasks ON task_subtasks(task_id);
            INSERT INTO users VALUES(7,'Fixture User 7','fixture-user-7'),(8,'Fixture User 8','fixture-user-8');`);
        const common = { title: 'Same task', description: 'Synthetic only', status: 'todo', owner_user_id: 7,
            created_by_user_id: 7, business_context: 'event_genix', visibility: 'team', date: '2026-11-06',
            priority: 'normal', category: 'admin', source_type: 'manual', workflow_state: 'inbox' };
        const variants = [
            { id: 1, title: ' Same   Task ', category: null }, { id: 2, title: 'same task' },
            { id: 3, status: 'done' }, { id: 4, status: 'archived' }, { id: 5, status: 'cancelled' },
            { id: 6, business_context: 'dar' }, { id: 7, owner_user_id: 8 },
            { id: 8, title: 'Null state', status: null }, { id: 9, title: ' null  STATE ' },
            { id: 10, title: 'Template', template_id: 4, pack_id: 1, visibility: 'private' },
            { id: 11, title: 'template', template_id: 4, pack_id: 2 },
            { id: 12, title: 'Pack', pack_id: 42, source_entity_type: 'lead', source_entity_id: '1' },
            { id: 13, title: 'pack', pack_id: 42, source_entity_type: 'lead', source_entity_id: '2' },
            { id: 14, title: 'Entity', source_entity_type: 'LEAD', source_entity_id: '77' },
            { id: 15, title: 'entity', source_entity_type: 'lead', source_entity_id: '77' },
            { id: 16, title: 'Manual', source_id: '1' },
            { id: 17, title: 'manual', source_type: 'assistant_command', source_id: '2' },
            { id: 18, title: 'Automatic', source_type: 'booking', source_id: '1' },
            { id: 19, title: 'automatic', source_type: 'booking', source_id: '2' },
            { id: 20, title: 'Delimiter', category: 'a|b', subcategory: 'c' },
            { id: 21, title: 'delimiter', category: 'a', subcategory: 'b|c' },
            { id: 22, title: 'Context default', business_context: null },
            { id: 23, title: 'context default' },
            { id: 24, title: 'Private canonical', visibility: 'private' },
            { id: 25, title: 'private canonical' }
        ];
        for (const variant of variants) {
            const row = { ...common, ...variant };
            const columns = Object.keys(row);
            await client.query(`INSERT INTO tasks(${columns.join(',')},created_at,updated_at,completed_at)
                VALUES(${columns.map((_, index) => '$' + (index + 1)).join(',')},CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, Object.values(row));
        }
        await client.query(`INSERT INTO task_subtasks
            SELECT t.id*10+n,t.id,'Part '||n,n=1,n,'manual',CURRENT_TIMESTAMP,NULL,CURRENT_TIMESTAMP
            FROM tasks t CROSS JOIN generate_series(1,3)n;
            INSERT INTO task_observers VALUES(10,8,'editor');
            INSERT INTO task_dependencies VALUES(12,3),(12,6);`);
        const old = await client.query(`SELECT id FROM tasks t WHERE ${previousCanonicalFilter('t')} ORDER BY id`);
        const current = await client.query(`SELECT id FROM tasks t WHERE ${policy.activeDuplicateCanonicalFilterSql('t')} ORDER BY id`);
        const expected = [1,3,4,5,6,7,8,10,12,14,16,18,19,20,22,24];
        assert.deepEqual(current.rows.map(row => row.id), expected);
        assert.deepEqual(current.rows, old.rows);
        const viewer = await client.query(`SELECT id FROM tasks t WHERE ${policy.activeDuplicateCanonicalFilterSql('t')}
            AND (visibility='team' OR owner_user_id=8 OR EXISTS(SELECT 1 FROM task_observers o WHERE o.task_id=t.id AND o.user_id=8)) ORDER BY id`);
        assert.ok(viewer.rows.some(row => row.id === 10), 'observer can see the private canonical task');
        assert.ok(!viewer.rows.some(row => row.id === 25), 'viewer filtering must not promote a noncanonical public duplicate');
        const cases = [
            { name: 'legacy', query: { limit: '5' } },
            { name: 'inbox-page1', query: { pagination: '1', view: 'inbox', page: '1', limit: '5' } },
            { name: 'inbox-page2', query: { pagination: '1', view: 'inbox', page: '2', limit: '5' } },
            { name: 'done-today', query: { pagination: '1', view: 'done_today' } },
            { name: 'archive', query: { pagination: '1', view: 'archive' } },
            { name: 'show-duplicates', query: { pagination: '1', include_duplicates: 'true' } },
            { name: 'terminal-mixed-validity', query: { pagination: '1', status: 'done,invalid,archived' } },
            { name: 'active-and-terminal', query: { pagination: '1', status: 'todo,done' } },
            { name: 'invalid-status', query: { pagination: '1', status: 'invalid' } },
            { name: 'search', query: { pagination: '1', search: 'Task' } },
            { name: 'other-viewer', userId: 8, role: 'animator', query: { pagination: '1' } },
            { name: 'other-business', query: { pagination: '1', business_context: 'dar' } }
        ];
        const baseline = await captureLists(previousCanonicalFilter, cases, pool);
        const candidate = await captureLists(policy.activeDuplicateCanonicalFilterSql, cases, pool);
        for (let index = 0; index < cases.length; index++) {
            const before = baseline[index], after = candidate[index];
            assert.deepEqual(after.list.params, before.list.params, after.name + ': parameters');
            const expectedRows = (await client.query(before.list.sql, before.list.params)).rows;
            const actualRows = (await client.query(after.list.sql, after.list.params)).rows;
            assert.deepEqual(actualRows, expectedRows, after.name + ': ordered full rows');
            if (after.count) assert.deepEqual((await client.query(after.count.sql, after.count.params)).rows,
                (await client.query(before.count.sql, before.count.params)).rows, after.name + ': total count');
        }
        const detail = candidate.find(item => item.name === 'show-duplicates');
        const rows = (await client.query(detail.list.sql, detail.list.params)).rows;
        const withDependencies = rows.find(row => row.id === 12);
        assert.equal(withDependencies.subtask_count, 3);
        assert.equal(withDependencies.subtask_done_count, 1);
        assert.equal(withDependencies.subtasks.length, 3);
        assert.equal(withDependencies.dependency_count, 1, 'cross-business dependency stays excluded');
        assert.equal(withDependencies.open_dependency_count, 0);
    } finally {
        try {
            if (created) {
                const owner = await client.query('SELECT obj_description(oid) AS marker FROM pg_namespace WHERE nspname=$1', [schema]);
                assert.equal(owner.rows[0]?.marker, marker);
                await client.query(`DROP SCHEMA ${schema} CASCADE`);
            }
        } finally {
            await client.end();
            await pool.end();
        }
    }
});

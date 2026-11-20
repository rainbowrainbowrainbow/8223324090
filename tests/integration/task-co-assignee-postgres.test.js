'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { Client } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { buildTaskVisibilityScope } = require('../../services/taskPolicy');
const { buildTaskPersonalQuery } = require('../../services/taskPersonalScope');

test('co-assignee migration and visibility scope work on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
    const { url } = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
    const client = new Client({ connectionString: url.toString() });
    const schema = `task_co_test_${randomBytes(8).toString('hex')}`;
    await client.connect();
    try {
        await client.query(`CREATE SCHEMA ${schema}`);
        await client.query(`SET search_path TO ${schema}`);
        await client.query(`CREATE TABLE users (id integer PRIMARY KEY);
            CREATE TABLE tasks (id integer PRIMARY KEY, owner_user_id integer, assigned_to text, owner text, visibility text,
                created_by_user_id integer, created_by text, task_mode text);
            CREATE TABLE task_observers (task_id integer, user_id integer);
            INSERT INTO users VALUES (1), (2), (3);
            INSERT INTO tasks VALUES (1, 1, 'owner', 'owner', 'private', 1, 'owner', 'work');`);
        const sql = fs.readFileSync(path.join(__dirname, '../../db/migrations/427_task_co_assignees.sql'), 'utf8');
        await client.query(sql);
        await client.query(sql);
        await client.query('INSERT INTO task_co_assignees (task_id, user_id, added_by) VALUES (1, 2, 1)');
        const visibleFor = async id => {
            const params = [];
            const scope = buildTaskVisibilityScope({ id, username: `u${id}`, role: 'instructor' }, params, 't');
            return (await client.query(`SELECT id FROM tasks t WHERE TRUE ${scope}`, params)).rows;
        };
        assert.equal((await visibleFor(2)).length, 1);
        assert.equal((await visibleFor(3)).length, 0);
        const personalParams = [];
        const personal = buildTaskPersonalQuery({ id: 2, username: 'u2', role: 'instructor' }, personalParams, 't');
        const personalRows = await client.query(`SELECT ${personal.roles} AS roles, ${personal.coAssignee} AS co_assignee FROM tasks t WHERE ${personal.match}`, personalParams);
        assert.deepEqual(personalRows.rows, [{ roles: ['executor'], co_assignee: true }]);
        await client.query('DELETE FROM task_co_assignees WHERE task_id = 1 AND user_id = 2');
        assert.equal((await visibleFor(2)).length, 0);
        assert.equal((await client.query(`SELECT t.id FROM tasks t WHERE ${personal.match}`, personalParams)).rowCount, 0);
    } finally {
        await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await client.end();
    }
});

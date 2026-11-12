'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { withDeletionRouter } = require('../helpers/park-hr-deletion-router');

test('deletion on the fully migrated disposable schema', async () => {
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL);
    assert.equal(target.isLocal, true);
    const db = new Pool({ connectionString: target.url.toString() });
    try {
        const person = await db.query("INSERT INTO staff (name, department, position) VALUES ('Synthetic delete fixture', 'admin', 'QA') RETURNING id");
        const id = person.rows[0].id;
        await withDeletionRouter(async ({ request }) => {
            const path = `/staff/${id}`;
            const remove = () => request(path, { method: 'DELETE', body: { confirmation: 'ТАК' } });
            await db.query("INSERT INTO staff_schedule (staff_id, date) VALUES ($1, '2099-01-01')", [id]);
            const blocked = await request(path + '/delete-readiness');
            assert.equal(blocked.status, 200);
            assert.equal(blocked.body.data.can_delete, false);
            assert.equal((await remove()).status, 409);
            await db.query('DELETE FROM staff_schedule WHERE staff_id = $1', [id]);
            const ready = await request(path + '/delete-readiness');
            assert.equal(ready.status, 200, JSON.stringify(ready.body));
            assert.equal(ready.body.data.can_delete, true, JSON.stringify(ready.body));
            assert.equal((await remove()).status, 200);
            assert.equal((await db.query('SELECT count(*)::int AS count FROM staff WHERE id = $1', [id])).rows[0].count, 0);
            assert.equal((await db.query("SELECT count(*)::int AS count FROM hr_audit_log WHERE action = 'staff_delete_permanent' AND details::text LIKE $1", [`%Synthetic delete fixture%`])).rows[0].count, 1);
        }, db);
    } finally { await db.end(); }
});

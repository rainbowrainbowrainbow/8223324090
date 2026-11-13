'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { withDeletionRouter } = require('../helpers/park-hr-deletion-router');

const url = process.env.STAFF_DELETE_TEST_DATABASE_URL;
test('actual HR deletion handlers preserve dependencies and audit in disposable PostgreSQL', { skip: !url && !process.env.CI }, async t => {
    assert.ok(url, 'STAFF_DELETE_TEST_DATABASE_URL is required in CI');
    const target = assertSafeTestDatabaseUrl(url);
    assert.equal(target.isLocal, true, 'this fixture only permits local PostgreSQL');
    const db = new Pool({ connectionString: url, max: 8 });
    try {
        const existing = await db.query("SELECT to_regclass('public.staff') AS rel");
        assert.equal(existing.rows[0].rel, null, 'use a fresh disposable database; never reset existing staff');
        await db.query(`
            CREATE TABLE staff (id integer PRIMARY KEY, name text, department text, position text,
                role_type text, is_active boolean DEFAULT true, hr_pool_status text, created_at timestamptz DEFAULT now());
            CREATE TABLE employee_profiles (id serial PRIMARY KEY, staff_id integer REFERENCES staff(id) ON DELETE CASCADE);
            CREATE TABLE bookings (id serial PRIMARY KEY, line_id text, second_animator text);
            CREATE TABLE hr_time_records (id serial PRIMARY KEY, staff_id integer REFERENCES staff(id) ON DELETE CASCADE);
            CREATE TABLE payroll_reports (id serial PRIMARY KEY, staff_id integer REFERENCES staff(id) ON DELETE CASCADE);
            CREATE TABLE training_submissions (id serial PRIMARY KEY, staff_id integer);
            CREATE TABLE training_assignments (id serial PRIMARY KEY, assigned_to integer[]);
            CREATE TABLE discipline_actions_log (id serial PRIMARY KEY, staff_id integer);
            CREATE TABLE foreign_teacher_records (id serial PRIMARY KEY, teacher_id integer REFERENCES staff(id) ON DELETE CASCADE,
                business_context text DEFAULT 'dar');
            CREATE TABLE unknown_nullable_reference (id serial PRIMARY KEY, worker_id integer REFERENCES staff(id) ON DELETE SET NULL);
            CREATE TABLE hr_audit_log (id serial PRIMARY KEY, action text, staff_id integer REFERENCES staff(id),
                performed_by text, details jsonb, ip_address text);
            CREATE TABLE staff_face_descriptors (id serial PRIMARY KEY, staff_id integer REFERENCES staff(id) ON DELETE CASCADE);
            INSERT INTO staff(id, name) VALUES (9701, 'Synthetic Duplicate');
        `);
        await withDeletionRouter(async ({ state, request }) => {
            const readiness = () => request('/staff/9701/delete-readiness');
            const remove = (body = { confirmation: 'ТАК' }) => request('/staff/9701', { method: 'DELETE', body });
            await t.test('empty duplicate can pass readiness but wrong confirmation cannot delete it', async () => {
                assert.equal((await readiness()).body.data.can_delete, true);
                assert.equal((await remove({ confirmation: 'ні' })).status, 400);
                assert.equal((await db.query('SELECT count(*)::int AS n FROM staff')).rows[0].n, 1);
            });
            await t.test('known and newly discovered CASCADE/SET NULL references block', async () => {
                for (const [table, column] of [['employee_profiles', 'staff_id'], ['bookings', 'line_id'],
                    ['hr_time_records', 'staff_id'], ['payroll_reports', 'staff_id'],
                    ['foreign_teacher_records', 'teacher_id'], ['unknown_nullable_reference', 'worker_id']]) {
                    // Identifiers are closed test fixtures, not request input.
                    await db.query(`INSERT INTO ${table} (${column}) VALUES ($1)`, [9701]);
                    assert.equal((await readiness()).body.data.can_delete, false, table);
                    assert.equal((await remove()).status, 409, table);
                    assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 1);
                    await db.query(`DELETE FROM ${table}`);
                }
            });
            await t.test('legacy training and personnel history without foreign keys still block', async () => {
                for (const table of ['training_submissions', 'discipline_actions_log', 'training_assignments']) {
                    const column = table === 'training_assignments' ? 'assigned_to' : 'staff_id';
                    const value = table === 'training_assignments' ? [9701] : 9701;
                    await db.query(`INSERT INTO ${table} (${column}) VALUES ($1)`, [value]);
                    assert.equal((await readiness()).body.data.can_delete, false, table);
                    assert.equal((await remove()).status, 409, table);
                    await db.query(`DELETE FROM ${table}`);
                }
            });
            await db.query("INSERT INTO hr_audit_log(action, staff_id) VALUES ('synthetic_old', 9701)");
            await t.test('failure after audit changes rolls the entire transaction back', async () => {
                state.failSql = 'DELETE FROM staff';
                assert.equal((await remove()).status, 500);
                state.failSql = null;
                const logs = await db.query('SELECT action, staff_id FROM hr_audit_log');
                assert.deepEqual(logs.rows, [{ action: 'synthetic_old', staff_id: 9701 }]);
                assert.equal((await db.query('SELECT count(*)::int AS n FROM staff')).rows[0].n, 1);
            });
            await t.test('foreign-key failure returns 409 and retains audit linkage', async () => {
                await db.query(`CREATE FUNCTION reject_test_delete() RETURNS trigger LANGUAGE plpgsql AS $$
                    BEGIN RAISE EXCEPTION 'synthetic FK conflict' USING ERRCODE = '23503'; END $$;
                    CREATE TRIGGER reject_test_delete BEFORE DELETE ON staff FOR EACH ROW EXECUTE FUNCTION reject_test_delete()`);
                assert.equal((await remove()).status, 409);
                assert.equal((await db.query('SELECT staff_id FROM hr_audit_log')).rows[0].staff_id, 9701);
                await db.query('DROP TRIGGER reject_test_delete ON staff');
            });
            await t.test('a concurrent foreign-key insert cannot survive a committed staff deletion', async () => {
                let announceLocked;
                let continueDelete;
                const locked = new Promise(resolve => { announceLocked = resolve; });
                const resume = new Promise(resolve => { continueDelete = resolve; });
                state.beforeSql = async sql => {
                    if (sql.startsWith('UPDATE hr_audit_log')) { announceLocked(); await resume; }
                };
                const deletion = remove();
                const writer = await db.connect();
                let insertion;
                try {
                    await locked;
                    const pid = (await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
                    insertion = writer.query('INSERT INTO foreign_teacher_records(teacher_id) VALUES (9701)')
                        .then(() => ({ code: 'unexpected_success' }), error => error);
                    let blocked = false;
                    for (let i = 0; i < 100; i++) {
                        blocked = (await db.query('SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked', [pid])).rows[0].blocked;
                        if (blocked) break;
                        await new Promise(resolve => setTimeout(resolve, 20));
                    }
                    assert.equal(blocked, true, 'FK insert waits on the staff row lock');
                    continueDelete();
                    assert.equal((await deletion).status, 200);
                    assert.equal((await insertion).code, '23503');
                } finally {
                    continueDelete();
                    await deletion;
                    if (insertion) await insertion;
                    writer.release();
                    state.beforeSql = null;
                }
            });
            await t.test('successful delete preserves old audit and writes a deletion event', async () => {
                assert.equal((await readiness()).status, 404);
                const logs = await db.query('SELECT action, staff_id, details FROM hr_audit_log ORDER BY id');
                assert.equal(logs.rows.length, 2);
                assert.equal(logs.rows[0].staff_id, null);
                assert.equal(logs.rows[1].action, 'staff_delete_permanent');
                assert.equal(logs.rows[1].details.deleted_staff.id, 9701);
            });
            await t.test('only declared cleanup may cascade for a clean duplicate', async () => {
                await db.query("INSERT INTO staff(id, name) VALUES (9701, 'Synthetic Cleanup')");
                await db.query('INSERT INTO staff_face_descriptors(staff_id) VALUES (9701)');
                const ready = await readiness();
                assert.equal(ready.body.data.can_delete, true);
                assert.ok(ready.body.data.cleanup.some(item => item.key === 'face_descriptors' && item.count === 1));
                assert.equal((await remove()).status, 200);
                assert.equal((await db.query('SELECT count(*)::int AS n FROM staff_face_descriptors')).rows[0].n, 0);
            });
        }, db);
    } finally { await db.end(); }
});

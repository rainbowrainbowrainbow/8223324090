'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { withDeletionRouter } = require('../helpers/park-hr-deletion-router');

test('admin and creator save professions and admissions without changing compensation', async () => {
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL);
    assert.equal(target.isLocal, true);
    const db = new Pool({ connectionString: target.url.toString() });
    try {
        await db.query("INSERT INTO hr_professions (key, title) VALUES ('qa_regression', 'Synthetic regression profession') ON CONFLICT (key) DO NOTHING");
        const { rows: [staff] } = await db.query(`INSERT INTO staff
            (name, department, position, role_type, hourly_rate, secondary_professions)
            VALUES ('Synthetic profession regression', 'admin', 'QA', 'animator', 321, '["host"]') RETURNING id`);
        await db.query(`INSERT INTO staff_role_assignments
            (staff_id, profession_key, is_primary, hourly_rate, notes)
            VALUES ($1, 'animator', true, 321, 'Preserve assignment metadata'), ($1, 'host', false, 456, 'Preserve host rate')`, [staff.id]);
        await db.query(`INSERT INTO staff_profession_rates (staff_id, profession_key, hourly_rate)
            VALUES ($1, 'animator', 321), ($1, 'host', 456)`, [staff.id]);
        const { rows: [scheme] } = await db.query(`INSERT INTO payroll_schemes (staff_id, scheme_type, title, config_json)
            VALUES ($1, 'hourly', 'Synthetic protected payroll scheme', '{"hourlyRate":456}') RETURNING id`, [staff.id]);
        await db.query("UPDATE staff_role_assignments SET payroll_scheme_id = $2 WHERE staff_id = $1 AND profession_key = 'host'", [staff.id, scheme.id]);
        const finance = async () => ({
            staff: (await db.query('SELECT hourly_rate FROM staff WHERE id = $1', [staff.id])).rows,
            schemes: (await db.query('SELECT * FROM payroll_schemes WHERE staff_id = $1 ORDER BY id', [staff.id])).rows,
            rates: (await db.query('SELECT * FROM staff_profession_rates WHERE staff_id = $1 ORDER BY profession_key', [staff.id])).rows,
            assignments: (await db.query(`SELECT id, profession_key, hourly_rate, payroll_scheme_id, notes
                FROM staff_role_assignments WHERE staff_id = $1 ORDER BY profession_key`, [staff.id])).rows
        });
        const before = await finance();
        await withDeletionRouter(async ({ request, state, calls }) => {
            const path = `/staff/${staff.id}/role-assignments`;
            const body = { primary_role: 'host', assignments: [
                { profession_key: 'host', is_primary: true, status: 'active', admission_status: 'approved', internship_status: 'completed' },
                { profession_key: 'animator', is_primary: false, status: 'active', admission_status: 'blocked', internship_status: 'none' }
            ] };
            for (const role of ['admin', 'creator']) {
                state.actor = { role };
                const result = await request(path, { method: 'PUT', body });
                assert.equal(result.status, 200, JSON.stringify({ response: result.body, error: state.lastError }));
                assert.ok(result.body.profile_revision);
                assert.equal(result.body.data.find(row => row.profession_key === 'host').admission_status, 'approved');
                assert.equal(result.body.data.some(row => Object.hasOwn(row, 'hourly_rate')), false);
                assert.deepEqual(await finance(), before);
                const changed = (await db.query('SELECT role_type, secondary_professions FROM staff WHERE id = $1', [staff.id])).rows[0];
                assert.equal(changed.role_type, 'host');
                assert.deepEqual(changed.secondary_professions, ['animator']);
            }
            for (const actor of [{ role: 'admin', deny: ['hr.staff.manage'] },
                { role: 'admin', deny: ['hr.staff.profile.edit'] }, { role: 'admin', revoked: true },
                { role: 'admin', stale: true }, { role: 'admin', inactive: true }]) {
                state.actor = actor;
                const count = calls.length;
                assert.equal((await request(path, { method: 'PUT', body })).status, 403);
                assert.equal(calls.length, count);
            }
            state.actor = { role: 'admin' };
            for (const key of ['hourly_rate', 'payroll_scheme_id', 'notes', 'hourlyRate', 'payrollSchemeId']) {
                const count = calls.length;
                const injected = { ...body, assignments: [{ ...body.assignments[0], [key]: null }, body.assignments[1]] };
                assert.equal((await request(path, { method: 'PUT', body: injected })).status, 403, key);
                assert.equal(calls.length, count);
            }
            for (const [context, suffix] of [['dar', ''], ['event_genix', '?businessScope=all']]) {
                assert.equal((await request(path + suffix, { method: 'PUT', context, body })).status, 403);
            }
            const added = await request(path, { method: 'PUT', body: { ...body, assignments: [
                ...body.assignments, { profession_key: 'qa_regression', status: 'active', admission_status: 'pending', internship_status: 'in_progress' }
            ] } });
            assert.equal(added.status, 200, JSON.stringify(added.body));
            assert.equal(added.body.data.length, 3);
            const after = await finance();
            assert.deepEqual(after.staff, before.staff);
            assert.deepEqual(after.rates, before.rates);
            assert.deepEqual(after.schemes, before.schemes);
            assert.deepEqual(after.assignments.filter(row => row.profession_key !== 'qa_regression'), before.assignments);
            state.actor = { role: 'creator' };
            const financial = await request(path, { method: 'PUT', body: { ...body, assignments: body.assignments.map(row => ({
                ...row, hourly_rate: row.is_primary ? 654 : 321
            })) } });
            assert.equal(financial.status, 200, JSON.stringify({ response: financial.body, error: state.lastError }));
            assert.equal(Number((await db.query('SELECT hourly_rate FROM staff WHERE id = $1', [staff.id])).rows[0].hourly_rate), 654);
            assert.equal(Number((await db.query("SELECT hourly_rate FROM staff_profession_rates WHERE staff_id = $1 AND profession_key = 'host'", [staff.id])).rows[0].hourly_rate), 654);
        }, db);
    } finally { await db.end(); }
});

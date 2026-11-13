'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { withDeletionRouter } = require('./helpers/park-hr-deletion-router');

test('Park deletion uses actual HR handlers with management, isolation and transaction guards', async t => {
    await withDeletionRouter(async ({ state, calls, request }) => {
        const path = '/staff/9701';
        const remove = (body = { confirmation: 'ТАК' }) => request(path, { method: 'DELETE', body });
        await t.test('both manager roles reach readiness and the transactional duplicate delete', async () => {
            for (const role of ['director', 'creator']) {
                state.actor = { role };
                const readiness = await request(path + '/delete-readiness');
                assert.equal(readiness.status, 200);
                assert.equal(readiness.body.data.can_delete, true);
                const start = calls.length;
                assert.equal((await remove()).status, 200);
                const transaction = calls.slice(start);
                assert.equal(transaction[1], 'BEGIN');
                assert.match(transaction[2], /FOR UPDATE$/);
                assert.ok(transaction.find(sql => sql.startsWith('INSERT INTO hr_audit_log')));
                assert.equal(transaction.at(-1), 'COMMIT');
            }
        });
        await t.test('confirmation is required before acquiring a write connection', async () => {
            const start = calls.length;
            for (const body of [{}, { confirmation: 'так' }, { confirmation: 'YES' }]) {
                assert.equal((await remove(body)).status, 400);
            }
            assert.equal(calls.length, start);
        });
        await t.test('connection failure returns 500 without running SQL', async () => {
            state.failConnect = true;
            const start = calls.length;
            const result = await remove();
            assert.equal(result.status, 500);
            assert.equal(result.body.success, false);
            assert.deepEqual(calls.slice(start), ['CONNECT']);
            state.failConnect = false;
        });
        await t.test('viewers, delegated editors, denies, foreign and invalid memberships never query SQL', async () => {
            for (const [actor, context, suffix] of [
                [{ role: 'animator', allow: ['hr.staff.view', 'hr.staff.profile.edit'] }, 'event_genix', ''],
                [{ deny: ['hr.staff.manage'], allow: ['hr.staff.profile.edit'] }, 'event_genix', ''],
                [{ role: 'creator', deny: ['hr.staff.manage'] }, 'event_genix', ''],
                [{}, 'dar', ''], [{ revoked: true }, 'event_genix', ''],
                [{ inactive: true }, 'event_genix', ''], [{ inactiveOrganization: true }, 'event_genix', ''],
                [{ stale: true }, 'event_genix', ''],
                [{}, 'event_genix', '?businessScope=all'],
                [{}, 'event_genix', '?businessScope=multi&businessContexts=event_genix,dar'],
                [{}, 'event_genix', '?business_context=dar']
            ]) {
                state.actor = actor;
                const start = calls.length;
                for (const [method, endpoint] of [['GET', path + '/delete-readiness'], ['DELETE', path]]) {
                    const res = await request(endpoint + suffix, { method, context,
                        ...(method === 'DELETE' ? { body: { confirmation: 'ТАК' } } : {}) });
                    assert.equal(res.status, 403, JSON.stringify({ actor, context, suffix, method }));
                }
                assert.equal(calls.length, start);
            }
            state.actor = { unauthenticated: true };
            assert.equal((await remove()).status, 401);
        });
        await t.test('exact route matching rejects variants; one trailing slash follows Express behavior', async () => {
            state.actor = {};
            for (const id of ['0', '-1', '01', 'x', '9007199254740992']) {
                const start = calls.length;
                assert.equal((await request(`/staff/${id}/delete-readiness`)).status, 403);
                assert.equal((await request(`/staff/${id}`, { method: 'DELETE', body: { confirmation: 'ТАК' } })).status, 403);
                assert.equal(calls.length, start);
            }
            assert.equal((await request(path + '/delete-readiness/')).status, 200);
            assert.equal((await request(path + '/delete-readiness/extra')).status, 403);
            assert.equal((await request(path + '/delete-readiness', { method: 'HEAD' })).status, 403);
            assert.equal((await request(path + '/', { method: 'DELETE', body: { confirmation: 'ТАК' } })).status, 200);
        });
        await t.test('missing staff is 404 and delete rolls back', async () => {
            state.missing = true;
            assert.equal((await request(path + '/delete-readiness')).status, 404);
            assert.equal((await remove()).status, 404);
            assert.equal(calls.at(-1), 'ROLLBACK');
            state.missing = false;
        });
        await t.test('account, booking, attendance and payroll dependencies block deletion', async () => {
            for (const table of ['employee_profiles', 'bookings', 'hr_time_records', 'payroll_reports']) {
                state.counts = { [table]: 1 };
                assert.equal((await request(path + '/delete-readiness')).body.data.can_delete, false);
                const start = calls.length;
                assert.equal((await remove()).status, 409);
                assert.equal(calls.at(-1), 'ROLLBACK');
                assert.equal(calls.slice(start).some(sql => sql.startsWith('DELETE')), false);
            }
            state.counts = {};
        });
        await t.test('unknown foreign-key dependencies block cascades without exposing table names', async () => {
            state.references = [{ schema_name: 'public', table_name: 'foreign_business_records', column_name: 'teacher_id' }];
            state.counts = { '"public"."foreign_business_records"': 1 };
            const result = await remove();
            assert.equal(result.status, 409);
            assert.equal(result.body.data.blockers[0].key, 'additional_references');
            assert.equal(JSON.stringify(result.body).includes('foreign_business_records'), false);
            state.references = [];
            state.counts = {};
        });
        await t.test('financial blockers stay effective but hide amounts from non-payroll managers', async () => {
            state.outstanding = { count: 1, amount: 12345 };
            state.actor = { deny: ['hr.payroll.view'] };
            for (const result of [await request(path + '/delete-readiness'), await remove()]) {
                assert.equal(result.body.data.can_delete, false);
                assert.equal(result.body.data.blockers[0].amount, undefined);
            }
            state.actor = {};
            assert.equal((await request(path + '/delete-readiness')).body.data.blockers[0].amount, 12345);
            state.outstanding = { count: 0, amount: 0 };
        });
        await t.test('schema discovery and audit failures fail closed and rollback', async () => {
            for (const fragment of ['FROM pg_constraint', 'INSERT INTO hr_audit_log']) {
                state.failSql = fragment;
                const start = calls.length;
                assert.equal((await remove()).status, 500);
                assert.equal(calls.at(-1), 'ROLLBACK');
                assert.equal(calls.slice(start).some(sql => sql.startsWith('DELETE')), false);
            }
            state.failSql = null;
        });
    });
});

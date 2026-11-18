'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { getToken, request, BASE_URL } = require('../helpers');
const { assertSafeTestDatabaseUrl, assertSafeIsolatedTestUrl } = require('../../scripts/test-db-safety');
const { loadParkWorkParticipantIds } = require('../../services/parkWorkModuleAccess');

test('authenticated Park Training isolates staff progress, homework and current business access', async t => {
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assertSafeIsolatedTestUrl(BASE_URL);
    const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL);
    assert.equal(target.isLocal, true);
    const db = new Pool({ connectionString: target.url.toString() });
    const suffix = crypto.randomBytes(6).toString('hex');
    try {
        const creator = await getToken();
        const verified = await request('GET', '/api/auth/verify', null, creator);
        assert.equal(verified.status, 200);
        const rootId = verified.data.user.id;
        const { rows: [org] } = await db.query("INSERT INTO organizations (slug, name) VALUES ($1, 'Synthetic Training QA') RETURNING id", ['training-' + suffix]);
        const { rows: [park] } = await db.query(`INSERT INTO businesses
            (organization_id, context_key, label, short_label, access_mode, modules)
            VALUES ($1, 'event_genix', 'Synthetic Training Park', 'Park', 'membership', '["training","hr","tasks","dashboard"]') RETURNING id`, [org.id]);
        const { rows: [dar] } = await db.query(`INSERT INTO businesses
            (organization_id, context_key, label, short_label, access_mode, modules)
            VALUES ($1, 'dar', 'Synthetic foreign business', 'Foreign', 'membership', '["training"]') RETURNING id`, [org.id]);
        await db.query("INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner')", [org.id, rootId]);
        await db.query(`INSERT INTO business_memberships (organization_id, business_id, user_id, role, is_default)
            VALUES ($1, $2, $3, 'creator', true)`, [org.id, park.id, rootId]);
        const accounts = [];
        for (const role of ['waiter', 'instructor', 'hr']) {
            const username = `training.${role}.${suffix}`;
            const password = crypto.randomBytes(24).toString('base64url');
            const created = await request('POST', '/api/users', { username, password, name: `Synthetic Training ${role}`,
                role, businessContexts: ['event_genix'], defaultBusinessContext: 'event_genix', activateMembership: true }, creator);
            assert.equal(created.status, 200, JSON.stringify(created.data));
            const id = Number(created.data.user.id);
            // Staff IDs intentionally differ from account IDs, including existing ID collisions.
            const { rows: [staff] } = await db.query(`INSERT INTO staff (id, name, department, position, role_type)
                VALUES ($1, $2, 'admin', 'Synthetic QA', 'animator') RETURNING id`, [1000000 + id, `Synthetic Training ${role}`]);
            await db.query(`INSERT INTO employee_profiles (user_id, staff_id, full_name)
                VALUES ($1, $2, $3) ON CONFLICT (user_id) WHERE user_id IS NOT NULL
                DO UPDATE SET staff_id = EXCLUDED.staff_id`, [id, staff.id, `Synthetic Training ${role}`]);
            const login = await request('POST', '/api/auth/login', { username, password });
            assert.equal(login.status, 200);
            accounts.push({ id, staffId: staff.id, token: login.data.token, role });
        }
        const [a, b, manager] = accounts;
        const api = async (actor, method, path, body, context = 'event_genix') => {
            const response = await fetch(BASE_URL + '/api/training' + path, { method,
                headers: { authorization: 'Bearer ' + actor.token, 'x-business-context': context, 'content-type': 'application/json' },
                body: body === undefined ? undefined : JSON.stringify(body) });
            return { status: response.status, data: await response.json() };
        };
        const { rows: [article] } = await db.query("INSERT INTO knowledge_base (title, content) VALUES ('Synthetic Training article', 'Synthetic safe content') RETURNING id");
        const { rows: [quiz] } = await db.query(`INSERT INTO training_tests (article_id, title, questions)
            VALUES ($1, 'Synthetic quiz', '[{"question":"Synthetic question","options":["A","B"],"correct":0}]') RETURNING id`, [article.id]);

        await t.test('own progress uses the active staff bridge, never the same-numbered account', async () => {
            assert.equal((await api(a, 'POST', `/knowledge-base/${article.id}/mark-read`, {})).status, 200);
            assert.equal((await api(a, 'POST', `/KNOWLEDGE-BASE/${article.id}/MARK-READ/`, {})).status, 200);
            const progress = (await db.query('SELECT staff_id FROM knowledge_base_progress WHERE article_id = $1', [article.id])).rows;
            assert.deepEqual(progress, [{ staff_id: a.staffId }]);
            assert.equal((await api(a, 'POST', `/tests/${quiz.id}/submit`, { answers: [0] })).status, 200);
            assert.deepEqual((await db.query('SELECT staff_id FROM training_test_results WHERE test_id = $1', [quiz.id])).rows, [{ staff_id: a.staffId }]);
            const mine = await api(a, 'GET', '/progress');
            assert.equal(mine.status, 200);
            assert.equal(mine.data.testResults.some(row => Number(row.test_id) === quiz.id), true);
            const other = await api(b, 'GET', '/progress');
            assert.equal(other.status, 200);
            assert.equal(other.data.testResults.some(row => Number(row.test_id) === quiz.id), false);
            assert.equal((await api(a, 'POST', '/submit', { staff_id: b.staffId, content: 'Forged target' })).status, 403);
            assert.equal((await api(a, 'POST', '/submit', { content: 'Own synthetic response', telegram_id: 'FORGED' })).status, 200);
            const input = (await db.query('SELECT staff_id, telegram_id FROM staff_training_inputs WHERE staff_id = $1', [a.staffId])).rows[0];
            assert.equal(input.staff_id, a.staffId);
            assert.notEqual(input.telegram_id, 'FORGED');
            await db.query('UPDATE employee_profiles SET is_active = false WHERE user_id = $1', [a.id]);
            assert.equal((await api(a, 'POST', `/knowledge-base/${article.id}/mark-read`, {})).status, 409);
            await db.query('UPDATE employee_profiles SET is_active = true WHERE user_id = $1', [a.id]);
            await db.query('UPDATE staff SET is_active = false WHERE id = $1', [a.staffId]);
            assert.equal((await api(a, 'POST', `/tests/${quiz.id}/submit`, { answers: [0] })).status, 409);
            await db.query('UPDATE staff SET is_active = true WHERE id = $1', [a.staffId]);
        });

        await t.test('homework targets are Park accounts; unrelated assignments and submissions stay private', async () => {
            const created = await api(manager, 'POST', '/assignments', { title: 'Synthetic private assignment', assignedTo: [a.id] });
            assert.equal(created.status, 200, JSON.stringify(created.data));
            const id = created.data.assignment.id;
            assert.equal((await api(a, 'POST', '/assignments', { title: 'Unauthorized' })).status, 403);
            assert.equal((await api(b, 'GET', `/assignments/${id}`)).status, 404);
            for (const filter of ['', '?filter=all', '?filter=my', '?filter=overdue']) {
                const list = await api(b, 'GET', '/assignments' + filter);
                assert.equal(list.status, 200);
                assert.equal(list.data.assignments.some(row => row.id === id), false);
            }
            assert.equal((await api(b, 'POST', `/assignments/${id}/submit`, { text: 'Forged submission' })).status, 404);
            assert.equal((await api(a, 'POST', `/assignments/${id}/submit`, { text: 'Own synthetic submission' })).status, 200);
            // Even malformed historical data cannot expose another account's private answer.
            await db.query("INSERT INTO training_submissions (assignment_id, staff_id, submission_text) VALUES ($1, $2, 'PRIVATE_ANSWER_CANARY')", [id, b.id]);
            const own = await api(a, 'GET', `/assignments/${id}`);
            assert.equal(own.status, 200);
            assert.equal(own.data.assignment.assigned_to, undefined);
            assert.equal(own.data.submissions.length, 1);
            assert.equal(JSON.stringify(own.data).includes('PRIVATE_ANSWER_CANARY'), false);
            assert.equal((await api(manager, 'GET', `/assignments/${id}`)).data.submissions.length, 2);
            await db.query('UPDATE training_assignments SET is_active = false WHERE id = $1', [id]);
            assert.equal((await api(a, 'POST', `/assignments/${id}/submit`, {})).status, 404);
        });

        await t.test('fresh membership, module/page denials and business selection remain authoritative', async () => {
            await db.query(`INSERT INTO business_memberships (organization_id, business_id, user_id, role)
                VALUES ($1, $2, $3, 'waiter')`, [org.id, dar.id, a.id]);
            assert.equal((await api(a, 'GET', '/courses', undefined, 'dar')).status, 403);
            assert.equal((await api(a, 'GET', '/courses?businessScope=all')).status, 403);
            assert.equal((await api(a, 'GET', '/courses')).status, 200);
            for (const [column, value, restore] of [['page_denylist', ['/training'], []], ['is_active', false, true]]) {
                await db.query(`UPDATE business_memberships SET ${column} = $3 WHERE business_id = $1 AND user_id = $2`, [park.id, a.id, value]);
                assert.equal((await api(a, 'GET', '/courses')).status, 403);
                assert.equal((await loadParkWorkParticipantIds(db, 'training', [a.id])).has(a.id), false);
                assert.equal((await api(manager, 'POST', '/assignments', { title: 'Rejected foreign target', assignedTo: [a.id] })).status, 403);
                await db.query(`UPDATE business_memberships SET ${column} = $3 WHERE business_id = $1 AND user_id = $2`, [park.id, a.id, restore]);
            }
            await db.query("UPDATE business_memberships SET action_denylist = ARRAY['training.manage'] WHERE business_id = $1 AND user_id = $2", [park.id, manager.id]);
            assert.equal((await api(manager, 'POST', '/courses', { title: 'Denied management' })).status, 403);
            assert.equal((await api(manager, 'GET', '/weekly-pending')).status, 403);
            assert.equal((await api(manager, 'GET', '/courses')).status, 200);
            assert.equal((await loadParkWorkParticipantIds(db, 'training', [manager.id], { action: 'training.manage' })).size, 0);
            await db.query("UPDATE organization_memberships SET is_active = false WHERE organization_id = $1 AND user_id = $2", [org.id, a.id]);
            assert.equal((await api(a, 'GET', '/courses')).status, 403);
            assert.equal((await loadParkWorkParticipantIds(db, 'training', [a.id])).size, 0);
            await db.query("UPDATE organization_memberships SET is_active = true WHERE organization_id = $1 AND user_id = $2", [org.id, a.id]);
            await db.query("UPDATE users SET is_active = false WHERE id = $1", [a.id]);
            assert.equal((await api(a, 'GET', '/courses')).status, 401);
            assert.equal((await loadParkWorkParticipantIds(db, 'training', [a.id])).size, 0);
            await db.query("UPDATE users SET is_active = true WHERE id = $1", [a.id]);
            await db.query("UPDATE businesses SET modules = '[]' WHERE id = $1", [park.id]);
            assert.equal((await api(a, 'GET', '/courses')).status, 403);
            assert.equal((await loadParkWorkParticipantIds(db, 'training', [a.id])).has(a.id), false);
        });
    } finally { await db.end(); }
});

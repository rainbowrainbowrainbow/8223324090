'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createParkWorkFixture } = require('../helpers/park-work-app-fixture');

test('self readiness proves actual authenticated work reads without impersonation or auto-enrollment', async t => {
    const f = await createParkWorkFixture(['waiter']);
    const actor = f.actors[0];
    try {
        await t.test('six actual reads prove own access and retain no private payloads', async () => {
            const membershipBefore = await f.db.query('SELECT channel_id FROM chat_channel_members WHERE user_id=$1 ORDER BY channel_id', [actor.id]);
            const achievementsBefore = await f.db.query('SELECT achievement_key FROM user_achievements WHERE username=$1 ORDER BY achievement_key', [actor.username]);
            const result = await f.api(actor, 'POST', '/api/work-access/check', {});
            assert.equal(result.status, 200);
            assert.equal(result.data.readiness.ready, true, JSON.stringify(result.data));
            assert.equal(result.data.readiness.checks.data.results.length, 6);
            assert.ok(result.data.readiness.checks.data.results.every(read => read.passed && read.probe === 'authenticated_api'));
            const membershipAfter = await f.db.query('SELECT channel_id FROM chat_channel_members WHERE user_id=$1 ORDER BY channel_id', [actor.id]);
            const achievementsAfter = await f.db.query('SELECT achievement_key FROM user_achievements WHERE username=$1 ORDER BY achievement_key', [actor.username]);
            assert.deepEqual(membershipAfter.rows, membershipBefore.rows);
            assert.deepEqual(achievementsAfter.rows, achievementsBefore.rows);
            assert.doesNotMatch(JSON.stringify(result.data), /Synthetic work|Bearer |password|telegram_chat_id/);
        });
        await t.test('request bodies cannot provide another identity or forge read outcomes', async () => {
            assert.equal((await f.api(actor, 'POST', '/api/work-access/check', { userId: f.root.id })).status, 400);
            assert.equal((await f.api(actor, 'POST', '/api/work-access/check', { authenticatedReadChecks: [] })).status, 400);
            assert.equal((await f.api(actor, 'POST', '/api/work-access/check', {}, 'dar')).status, 403);
            const missingLink = await f.api(f.root, 'POST', '/api/work-access/check', {});
            assert.equal(missingLink.status, 200);
            assert.equal(missingLink.data.readiness.ready, false);
            assert.equal(missingLink.data.readiness.checks.profile.passed, false);
        });
        await t.test('current denials and link revocation invalidate a previously successful check', async () => {
            for (const page of ['/profile', '/tasks', '/chat', '/afisha', '/staff', '/training']) {
                await f.db.query('UPDATE business_memberships SET page_denylist=$1::text[] WHERE user_id=$2 AND business_id=$3', [[page], actor.id, f.park.id]);
                const denied = await f.api(actor, 'POST', '/api/work-access/check', {});
                assert.equal(denied.status, 200, page);
                assert.equal(denied.data.readiness.ready, false, page);
                assert.equal(denied.data.readiness.checks.pages.passed, false, page);
            }
            await f.db.query("UPDATE business_memberships SET page_denylist='{}'::text[] WHERE user_id=$1 AND business_id=$2", [actor.id, f.park.id]);
            await f.db.query('UPDATE employee_profiles SET is_active=false WHERE user_id=$1', [actor.id]);
            const unlinked = await f.api(actor, 'POST', '/api/work-access/check', {});
            assert.equal(unlinked.status, 200);
            assert.equal(unlinked.data.readiness.checks.profile.passed, false);
            assert.equal(unlinked.data.readiness.ready, false);
        });
    } finally { await f.db.end(); }
});

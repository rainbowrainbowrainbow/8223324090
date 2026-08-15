'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const smoke = require('../scripts/live-my-day-completion-mutation-smoke');

test('live My Day completion mutation smoke requires explicit live-write confirmation', () => {
    const options = smoke.parseArgs(['https://crm.example', '--test-user', 'qa@example.com'], {});
    assert.throws(
        () => smoke.validateOptions({ ...options, nodeEnv: '' }),
        /--confirm-live-write/
    );
});

test('live My Day completion mutation smoke refuses CI/test runtime', () => {
    const options = smoke.parseArgs([
        'https://crm.example',
        '--confirm-live-write',
        '--test-user',
        'qa@example.com'
    ], { CI: 'true' });
    assert.throws(
        () => smoke.validateOptions(options),
        /forbidden in CI\/test runtime/
    );
});

test('live My Day completion mutation smoke refuses missing expected test account guard', () => {
    const options = smoke.parseArgs(['https://crm.example', '--confirm-live-write'], {});
    assert.throws(
        () => smoke.validateOptions({ ...options, nodeEnv: '' }),
        /Expected test account/
    );
});

test('live My Day completion mutation smoke refuses unknown business context', () => {
    const options = smoke.parseArgs([
        'https://crm.example',
        '--confirm-live-write',
        '--test-user',
        'qa@example.com',
        '--business-context',
        'real_customer_context'
    ], {});
    assert.throws(
        () => smoke.validateOptions({ ...options, nodeEnv: '' }),
        /not in the allowed live-write list/
    );
});

test('live My Day completion mutation smoke validates exact test account id or username', () => {
    assert.equal(smoke.assertKnownTestAccount({ id: 42, username: 'qa_user' }, { testUserId: 42 }), true);
    assert.equal(smoke.assertKnownTestAccount({ id: 42, email: 'qa@example.com' }, { testUser: 'qa@example.com' }), true);
    assert.throws(
        () => smoke.assertKnownTestAccount({ id: 41, username: 'qa_user' }, { testUserId: 42 }),
        /expected test user id/
    );
    assert.throws(
        () => smoke.assertKnownTestAccount({ id: 42, username: 'real_user' }, { testUser: 'qa_user' }),
        /expected test username/
    );
});

test('completedTodayTasks assertion separates missing row from updated count', () => {
    const projection = {
        completedTodayTasks: [{ id: 101 }],
        stats: { taskQuick: { completedUnitsToday: 4, completedParentToday: 2, completedSubtasksToday: 2 } }
    };
    const result = smoke.assertCompletedTodayProjection(projection, 101);
    assert.equal(result.completedUnitsToday, 4);
    assert.equal(result.completedParentToday, 2);
    assert.equal(result.completedSubtasksToday, 2);
    assert.throws(
        () => smoke.assertCompletedTodayProjection({ completedTodayTasks: [], stats: { taskQuick: { completedUnitsToday: 4 } } }, 101),
        /does not include/
    );
    assert.throws(
        () => smoke.assertCompletedTodayProjection({ completedTodayTasks: [{ id: 101 }], stats: { taskQuick: { completedUnitsToday: 0 } } }, 101),
        /did not update/
    );
});

test('business context helper keeps task routes explicitly scoped', () => {
    assert.equal(smoke.routeWithBusinessContext('/api/tasks', 'event_genix'), '/api/tasks?businessContext=event_genix');
    assert.equal(smoke.routeWithBusinessContext('/api/tasks?businessContext=event_genix', 'event_genix'), '/api/tasks?businessContext=event_genix');
});

test('cleanup guard archives only tasks with the exact QA marker', () => {
    assert.equal(smoke.assertTaskContainsMarker({
        title: 'Codex QA completion pulse EGX_MY_DAY_COMPLETION_QA_test'
    }, 'EGX_MY_DAY_COMPLETION_QA_test'), true);
    assert.throws(
        () => smoke.assertTaskContainsMarker({ title: 'Codex QA completion pulse other marker' }, 'EGX_MY_DAY_COMPLETION_QA_test'),
        /refusing to archive/
    );
    assert.throws(
        () => smoke.assertTaskContainsMarker({ title: 'Codex QA completion pulse EGX_MY_DAY_COMPLETION_QA_test' }, 'bad_marker'),
        /Cleanup marker/
    );
});

test('redacted artifact keeps IDs and omits credentials or task text', () => {
    const artifact = smoke.redactedArtifact({
        marker: 'EGX_MY_DAY_COMPLETION_QA_test',
        version: { version: '0.80.150', commitSha: 'abc', sourceBranch: 'codex/source' },
        taskId: 2859,
        completedToday: true,
        cleanup: [{ id: 2859, status: 'archived' }],
        completedUnitsToday: 7,
        completedParentToday: 5,
        completedSubtasksToday: 2,
        browser: { ok: true, viewport: '1440x900' }
    }, {
        baseUrl: 'https://crm.example/path',
        businessContext: 'event_genix'
    });
    assert.equal(artifact.target.baseUrl, 'https://crm.example');
    assert.equal(artifact.task.id, 2859);
    assert.deepEqual(artifact.cleanup, [{ id: 2859, status: 'archived' }]);
    assert.equal(artifact.redaction.taskTextStored, false);
    assert.equal(artifact.redaction.credentialsStored, false);
    assert.equal(JSON.stringify(artifact).includes('password'), false);
    assert.equal(JSON.stringify(artifact).includes('Safe live QA task'), false);
});

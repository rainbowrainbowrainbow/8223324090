'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const smoke = require('../scripts/live-my-day-ai-mutation-smoke');

test('live My Day AI mutation smoke requires explicit live-write confirmation', () => {
    const options = smoke.parseArgs(['https://crm.example', '--test-user', 'qa@example.com'], {});
    assert.throws(
        () => smoke.validateOptions({ ...options, nodeEnv: '' }),
        /--confirm-live-write/
    );
});

test('live My Day AI mutation smoke refuses missing expected test account guard', () => {
    const options = smoke.parseArgs(['https://crm.example', '--confirm-live-write'], {});
    assert.throws(
        () => smoke.validateOptions({ ...options, nodeEnv: '' }),
        /Expected test account/
    );
});

test('live My Day AI mutation smoke refuses unknown business context', () => {
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

test('live My Day AI mutation smoke validates exact test account id or username', () => {
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

test('cleanup archives only exact IDs whose task text contains the QA marker', async () => {
    const calls = [];
    const marker = 'EGX_MY_DAY_AI_QA_2026-08-12_test';
    const ctx = {
        base: 'https://crm.example',
        token: 'token',
        businessContext: 'event_genix',
        timeoutMs: 1000
    };
    const originalFetch = global.fetch;
    global.fetch = async (url, options = {}) => {
        const path = new URL(url).pathname;
        calls.push({ path, method: options.method || 'GET' });
        if (path === '/api/tasks/101') {
            return jsonResponse(200, { id: 101, title: `${marker} exact QA task` });
        }
        if (path === '/api/tasks/102') {
            return jsonResponse(200, { id: 102, title: 'not a QA task' });
        }
        if (path === '/api/tasks/bulk') {
            const body = JSON.parse(options.body || '{}');
            assert.deepEqual(body.ids, [101]);
            assert.equal(body.action, 'archive');
            return jsonResponse(200, { success: true, count: 1 });
        }
        return jsonResponse(404, { error: 'not found' });
    };
    try {
        const result = await smoke.cleanupExactQaTasks(ctx, [101, 102, 101], marker);
        assert.deepEqual(result.map(row => ({ id: row.id, status: row.status })), [
            { id: 101, status: 'archived' },
            { id: 102, status: 'failed' }
        ]);
        assert.deepEqual(calls.filter(call => call.method === 'POST').map(call => call.path), ['/api/tasks/bulk']);
    } finally {
        global.fetch = originalFetch;
    }
});

test('bundle smoke commit sends accepted field masks required by current contract', () => {
    const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'scripts', 'live-my-day-ai-mutation-smoke.js'), 'utf8');
    assert.match(source, /acceptedFieldMasks/);
    assert.match(source, /BUNDLE_ACCEPTED_FIELDS/);
    assert.match(source, /'title', 'description', 'impactIds', 'subtasks', 'owner', 'dueDate', 'priority'/);
});

test('cleanup can use exact bundle guard for generated bundle tasks without marker title', async () => {
    const calls = [];
    const marker = 'EGX_MY_DAY_AI_QA_2026-08-12_test';
    const bundleId = 'bundle_guard_12345';
    const ctx = {
        base: 'https://crm.example',
        token: 'token',
        businessContext: 'event_genix',
        timeoutMs: 1000
    };
    const originalFetch = global.fetch;
    global.fetch = async (url, options = {}) => {
        const path = new URL(url).pathname;
        calls.push({ path, method: options.method || 'GET' });
        if (path === '/api/tasks/201') {
            return jsonResponse(200, { id: 201, title: 'Generated bundle task', bundle: { id: bundleId } });
        }
        if (path === '/api/tasks/bulk') {
            const body = JSON.parse(options.body || '{}');
            assert.deepEqual(body.ids, [201]);
            assert.equal(body.action, 'archive');
            return jsonResponse(200, { success: true, count: 1 });
        }
        return jsonResponse(404, { error: 'not found' });
    };
    try {
        const result = await smoke.cleanupExactQaTasks(ctx, [201], marker, { allowedSearchTokens: [bundleId] });
        assert.deepEqual(result.map(row => ({ id: row.id, status: row.status })), [
            { id: 201, status: 'archived' }
        ]);
        assert.deepEqual(calls.filter(call => call.method === 'POST').map(call => call.path), ['/api/tasks/bulk']);
    } finally {
        global.fetch = originalFetch;
    }
});

test('redacted artifact keeps IDs and omits task text/provider secrets', () => {
    const artifact = smoke.redactedArtifact({
        marker: 'EGX_MY_DAY_AI_QA_test',
        createdTaskIds: new Set([5, 4]),
        bundleIds: ['bundle-1'],
        records: [{ id: 4 }, { id: 5 }],
        steps: [{ name: 'preview', status: 'ok', durationMs: 10 }],
        cleanup: [{ id: 4, status: 'archived' }],
        status: 'passed',
        version: { version: '0.80.126', commit: 'abc' },
        sessionSource: 'login',
        userVerified: true
    }, {
        baseUrl: 'https://crm.example/path',
        businessContext: 'event_genix'
    });
    assert.deepEqual(artifact.created.taskIds, [4, 5]);
    assert.equal(artifact.target.baseUrl, 'https://crm.example');
    assert.equal(artifact.redaction.taskTextStored, false);
    assert.equal(JSON.stringify(artifact).includes('OPENAI_API_KEY'), false);
    assert.equal(JSON.stringify(artifact).includes('proposalToken'), false);
});

test('PowerShell secret parser reads env assignments without executing the file', () => {
    const parsed = smoke.parsePowerShellEnvAssignments(`
        $env:LIVE_MY_DAY_AI_MUTATION_USER='qa@example.com'
        $env:LIVE_MY_DAY_AI_MUTATION_PASS="secret value"
        Write-Host $env:LIVE_MY_DAY_AI_MUTATION_PASS
    `);
    assert.deepEqual(parsed, {
        LIVE_MY_DAY_AI_MUTATION_USER: 'qa@example.com',
        LIVE_MY_DAY_AI_MUTATION_PASS: 'secret value'
    });
});

function jsonResponse(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async text() {
            return JSON.stringify(body);
        }
    };
}

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
    browserRequestIsAllowed,
    parseRetryAfter,
    parseSecretAssignments,
    safeRequestPath
} = require('../scripts/live-authenticated-surface-qa');

const ROOT = path.resolve(__dirname, '..');
const runnerSource = fs.readFileSync(path.join(ROOT, 'scripts', 'live-authenticated-surface-qa.js'), 'utf8');
const authSource = fs.readFileSync(path.join(ROOT, 'js', 'auth.js'), 'utf8');
const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

test('authenticated live QA parses Retry-After without exposing secrets', () => {
    assert.equal(parseRetryAfter('2'), 2_000);
    assert.equal(parseRetryAfter('invalid'), 1_000);
    assert.equal(parseRetryAfter('Wed, 01 Aug 2026 12:00:05 GMT', Date.parse('Wed, 01 Aug 2026 12:00:00 GMT')), 5_000);
    const values = parseSecretAssignments("$env:LIVE_SMOKE_USER = 'dedicated-qa'\n$env:LIVE_SMOKE_PASS = 'private'\n");
    assert.equal(values.LIVE_SMOKE_USER, 'dedicated-qa');
    assert.equal(values.LIVE_SMOKE_PASS, 'private');
    assert.ok(!runnerSource.includes('console.log(config'));
    assert.ok(!runnerSource.includes('console.log(token'));
});

test('authenticated live QA allows only read-only browser calls and login', () => {
    assert.equal(safeRequestPath('https://crm.example/api/finance?scope=all'), '/api/finance');
    assert.ok(runnerSource.includes('function sanitizedApiPath'));
    assert.equal(browserRequestIsAllowed('GET', 'https://crm.example/api/finance'), true);
    assert.equal(browserRequestIsAllowed('HEAD', 'https://crm.example/api/health'), true);
    assert.equal(browserRequestIsAllowed('POST', 'https://crm.example/api/auth/login'), true);
    assert.equal(browserRequestIsAllowed('POST', 'https://crm.example/api/auth/refresh'), true);
    assert.equal(browserRequestIsAllowed('POST', 'https://crm.example/api/wallet/daily-login'), false);
    assert.equal(browserRequestIsAllowed('POST', 'https://crm.example/api/finance/transactions'), false);
    assert.equal(browserRequestIsAllowed('PATCH', 'https://crm.example/api/users/1/access'), false);
    assert.equal(browserRequestIsAllowed('POST', 'https://crm.example/api/users/1/qa-creator-lease'), false);
    assert.equal(browserRequestIsAllowed('DELETE', 'https://crm.example/api/users/1/qa-creator-lease'), false);
    assert.equal(browserRequestIsAllowed('DELETE', 'https://crm.example/api/finance/transactions/1'), false);
});

test('authenticated live QA is a manual gate with a role restoration contract', () => {
    const packageJson = require('../package.json');
    assert.match(packageJson.scripts['qa:live:authenticated'], /live-authenticated-surface-qa\.js/);
    assert.match(packageJson.scripts.verify, /test:live-authenticated-qa-contract/);
    assert.doesNotMatch(workflow, /qa:live:authenticated/);
    assert.match(runnerSource, /finally\s*\{[\s\S]*revokeQaCreatorLease\(base, creatorToken, qaUser\.id, qaCreatorLease\?\.leaseId\)/);
    assert.match(runnerSource, /await verifyUser\(base, restoredToken\)/);
    assert.match(runnerSource, /await readPermissions\(base, restoredToken\)/);
    assert.match(runnerSource, /createQaCreatorLease\(base, creatorToken, qaUser\.id\)/);
    assert.match(runnerSource, /QA_CREATOR_LEASE_SECONDS/);
    assert.match(runnerSource, /window\.__eventGenixLiveQaReadOnly = true/);
    assert.match(authSource, /window\.__eventGenixLiveQaReadOnly === true/);
    assert.doesNotMatch(runnerSource, /KNOWN_AUTOMATIC_BLOCKED_PATHS/);
    assert.doesNotMatch(runnerSource, /wallet\/daily-login/);
    assert.match(runnerSource, /browserMutations\.length === 0/);
    assert.match(runnerSource, /cameraCalls === 1/);
    assert.match(runnerSource, /function requirePlaywright\(\)/);
    assert.match(runnerSource, /const \{ chromium \} = requirePlaywright\(\);/);
    assert.match(runnerSource, /function classifyConsoleError\(message\)/);
    assert.match(runnerSource, /function safeResourceOrigin\(input\)/);
    assert.match(runnerSource, /route\.fulfill\(\{ status: 204/);
    assert.match(runnerSource, /consoleState\.cspErrors === 0/);
    assert.ok(!runnerSource.includes('errorKinds, message.text'));
});

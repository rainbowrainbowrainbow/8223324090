'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildCapabilitySnapshot } = require('../services/accountAccessPolicy');
const { ORIGIN, BASE, CONFIRM, validatePlan, publicQaContext, bookingPayload, decimal, createRequestPolicy, sha256, cli } = require('./browser/finance-money-production-qa');

const plan = () => ({ runId: 'finance-qa-run', testAccountId: 47, businessContext: 'event_genix', ttlMinutes: 30,
    accountTypes: ['cash', 'cash', 'bank'], categoryTypes: ['income', 'expense'], maxOperations: 40,
    maxAmountMinor: '1000000', maxPositiveMinor: '3000000', bookingFixtures: [{ requestId: 'fixture-one', programId: 'p1', lineId: 'l1', roomResourceId: 'r1', room: 'QA room', date: '2099-10-08', time: '10:00', duration: 60 }] });
const expires = () => new Date(Date.now() + 600000).toISOString();
const command = () => ({ command: 'expense', accountId: 1, categoryId: 2, amountMinor: '101', idempotencyKey: '01234567-89ab-4cde-8fab-0123456789ab' });
const policy = (options = {}) => createRequestPolicy({ plan: plan(), token: 'private-test-token', expiresAt: expires(), ...options });
const request = (method, pathname, body, headers = {}) => ({ method, url: `${ORIGIN}${pathname}`, body, headers });

test('production QA attaches its token only to exact finance routes and registered booking reads', () => {
    const guard = policy();
    const own = guard.decide(request('GET', BASE));
    assert.equal(own.headers['X-QA-Run-Token'], 'private-test-token');
    for (const pathname of ['/api/auth/permissions', '/api/finance/dashboard']) {
        const result = guard.decide(request('GET', pathname, null, { 'x-qa-run-token': 'incorrect-global-token', Authorization: 'session' }));
        assert.equal(result.allow, true);
        assert.equal(result.headers.Authorization, 'session');
        assert.ok(Object.keys(result.headers).every(key => !/qa-run/i.test(key)));
    }
    for (const pathname of ['/api/wallet', '/api/customers', '/api/tasks/my-cabinet', '/api/dashboard/widgets/currency']) {
        assert.equal(guard.decide(request('GET', pathname)).allow, false, 'incidental reads cannot reach lazy writers');
    }
    assert.equal(guard.decide(request('GET', `${BASE}/bookings/foreign`)).allow, false);
    guard.bookingIds.add('owned');
    assert.equal(guard.decide(request('GET', `${BASE}/bookings/owned`)).headers['X-QA-Run-Token'], 'private-test-token');
    for (const method of ['GET', 'POST']) {
        assert.equal(guard.decide({ method, url: 'https://api.checkbox.in.ua/api/v1/receipts/sell' }).allow, false);
        assert.equal(guard.decide(request(method, '/api/payments/readiness/probe')).allow, false);
    }
    assert.equal(guard.decide(request('POST', '/api/finance/manual-money/commands/extra', command())).allow, false);
    assert.equal(guard.decide(request('DELETE', '/api/finance/accounts/1')).allow, false);
});

test('same money command repeats same request identity; changed payload with same identity is blocked', () => {
    const guard = policy();
    const body = command();
    const first = guard.decide(request('POST', `${BASE}/commands`, body));
    const repeated = guard.decide(request('POST', `${BASE}/commands`, JSON.parse(JSON.stringify(body))));
    assert.equal(first.allow, true);
    assert.equal(repeated.allow, true);
    assert.equal(repeated.headers['X-QA-Run-Request-Id'], body.idempotencyKey);
    assert.equal(guard.report.repeatedCommandRequests, 1);
    assert.equal(guard.decide(request('POST', `${BASE}/commands`, { ...body, amountMinor: '102' })).code, 'finance_qa_command_identity_changed');
    assert.equal(guard.decide(request('POST', `${BASE}/commands`, { ...body, idempotencyKey: '' })).allow, false);
});

test('non-idempotent creates cannot be retried blindly and bookings must exactly match the approved fixture', () => {
    const guard = policy();
    const body = { name: 'QA only', type: 'cash' };
    assert.equal(guard.decide(request('POST', '/api/finance/accounts', body)).allow, true);
    assert.equal(guard.decide(request('POST', '/api/finance/accounts', body)).code, 'finance_qa_fixture_create_repeated');
    const fixtureBody = bookingPayload(plan().bookingFixtures[0], 'event_genix');
    assert.equal(guard.decide(request('POST', '/api/bookings', { ...fixtureBody, price: 1 })).allow, false);
    const permitted = guard.decide(request('POST', '/api/bookings', fixtureBody));
    assert.equal(permitted.allow, true);
    assert.equal(permitted.headers['X-QA-Run-Request-Id'], 'fixture-one');
    assert.equal(guard.decide(request('POST', '/api/bookings', fixtureBody)).allow, false);
});

test('expired run and changed business fail closed while ordinary login remains possible', () => {
    const expired = policy({ expiresAt: '2000-01-01T00:00:00Z' });
    assert.equal(expired.decide(request('GET', BASE)).allow, false);
    assert.equal(expired.decide(request('POST', `${BASE}/commands`, command())).allow, false);
    assert.equal(expired.decide(request('POST', '/api/auth/login', { username: 'test' })).allow, true);
    assert.equal(policy().decide(request('POST', `${BASE}/commands?businessContext=dar`, command())).code, 'finance_qa_business_mismatch');
});

test('run context and plan validation reject cross-actor context and unplanned booking fields', () => {
    const input = plan();
    assert.deepEqual(validatePlan(input), input);
    const qa = { runId: input.runId, actorId: input.testAccountId, businessContext: input.businessContext, expiresAt: expires(), token: 'never-copy-this' };
    assert.equal(publicQaContext(qa, input).token, undefined);
    assert.throws(() => publicQaContext({ ...qa, actorId: 48 }, input), /scope_mismatch/);
    assert.throws(() => publicQaContext({ ...qa, expiresAt: '2000-01-01' }, input), /expired/);
    assert.throws(() => validatePlan({ ...input, bookingFixtures: [{ ...input.bookingFixtures[0], customerId: 1 }] }), /fixture_fields/);
    assert.throws(() => validatePlan({ ...input, maxAmountMinor: '1e5' }), /amount_cap/);
    assert.throws(() => validatePlan({ ...input, maxAmountMinor: '100000' }), /amount_cap/, 'close balance must fit the cap before opening a shift');
    assert.throws(() => validatePlan({ ...input, businessContext: 'dar' }), /business_invalid/);
    assert.throws(() => validatePlan({ ...input, runId: 'x'.repeat(65) }), /run_invalid/);
    assert.equal(decimal('9007199254740993'), '90071992547409.93');
    assert.throws(() => cli(['--token', 'secret']), /argument_invalid/);
});

test('canonical normalized finance plan reaches the trusted booking matcher without added customer or price', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const vm = require('node:vm');
    const { createRequire } = require('node:module');
    function pureService(filename, overrides = {}) {
        const full = path.join(__dirname, '../services', filename);
        const module = { exports: {} };
        const actualRequire = createRequire(full);
        vm.runInNewContext(fs.readFileSync(full, 'utf8'), { module, exports: module.exports,
            require(id) {
                if (id === '../db') return { pool: { query() { throw new Error('No DB in contract test'); } } };
                if (id === './historyLog') return { insertHistory() { throw new Error('No writes in contract test'); } };
                return Object.hasOwn(overrides, id) ? overrides[id] : actualRequire(id);
            }, Buffer, Date, console, process }, { filename: full });
        return module.exports;
    }
    const registry = pureService('trustedQaRuns.js');
    const qa = pureService('financeMoneyQa.js', { './trustedQaRuns': registry });
    const raw = plan();
    raw.bookingFixtures[0] = { ...raw.bookingFixtures[0], productId: 'p1', status: 'confirmed', hosts: 1, pinataMode: 'none' };
    const normalized = JSON.parse(JSON.stringify(qa.normalizeFinanceQaPlan(raw)));
    const validated = validatePlan(normalized);
    assert.equal(sha256(JSON.stringify(validated)), qa.hashFinanceQaPlan(raw), 'runner pin matches the approved canonical server plan hash');
    const fixture = validated.bookingFixtures[0];
    const body = bookingPayload(fixture, validated.businessContext);
    registry.assertTrustedQaFixtureSafePayload({ body }, body);
    registry.assertBookingMatchesTrustedQaFixture(body, fixture);
    assert.equal(body.productId, 'p1');
    assert.equal(body.pinataMode, 'none');
    for (const field of ['requestId', 'customerId', 'customer_id', 'price']) assert.ok(!Object.hasOwn(body, field));
    const guard = createRequestPolicy({ plan: validated, token: 'test-only', expiresAt: expires() });
    const decision = guard.decide(request('POST', '/api/bookings', body));
    assert.equal(decision.allow, true);
    assert.equal(decision.headers['X-QA-Run-Request-Id'], fixture.requestId);
    assert.equal(guard.decide(request('POST', '/api/bookings', { ...body, customerId: 1 })).allow, false);
});

function preflightFixture() {
    const fs = require('node:fs');
    const path = require('node:path');
    const os = require('node:os');
    const vm = require('node:vm');
    const { createRequire } = require('node:module');
    const filename = path.join(__dirname, 'browser/finance-money-production-qa.js');
    const actualRequire = createRequire(filename);
    const module = { exports: {} };
    const approved = plan();
    const token = 'synthetic-memory-only-qa-token-for-unit-testing';
    const planBytes = Buffer.from(JSON.stringify(approved));
    const planFile = path.join(os.tmpdir(), 'synthetic-finance-qa-plan.json');
    const tokenFile = path.join(os.tmpdir(), 'synthetic-finance-qa-token');
    const reads = [];
    const writes = [];
    const requests = [];
    const options = { expectedSha: 'a'.repeat(40), confirm: CONFIRM, planHash: sha256(JSON.stringify(approved)) };
    const fakeFs = {
        realpathSync: value => value,
        readFileSync(file) {
            reads.push(file);
            if (file === planFile) return planBytes;
            if (file === tokenFile) return token;
            assert.equal(path.basename(file), 'codex-crm-secrets.ps1', 'only existing login source may be read');
            return 'synthetic credentials';
        },
        mkdirSync() {},
        writeFileSync(file, value) { writes.push({ file, value }); }
    };
    const release = { commitSha: options.expectedSha, sourceBranch: 'codex/eventgenix-production', version: 'test' };
    const permissions = { capabilities: buildCapabilitySnapshot({ id: approved.testAccountId, role: 'creator' }).decisions };
    const workspace = { success: true, available: true, accounts: [], qa: {
        runId: approved.runId, actorId: approved.testAccountId, businessContext: approved.businessContext,
        expiresAt: expires(), counts: { operations: 0 }
    } };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        module, exports: module.exports, __dirname: path.dirname(filename),
        require(id) {
            if (id === 'node:fs') return fakeFs;
            if (id === '../../scripts/live-authenticated-surface-qa') return {
                parseSecretAssignments: () => ({ LIVE_SMOKE_URL: ORIGIN, LIVE_SMOKE_USER: 'qa_fixture', LIVE_SMOKE_PASS: 'synthetic-login-password' })
            };
            if (id === 'playwright') return { chromium: { launch() { throw new Error('Stop after readiness in unit test'); } } };
            return actualRequire(id);
        },
        async fetch(url, requestOptions) {
            const pathname = new URL(url).pathname;
            requests.push({ pathname, options: requestOptions });
            const responses = {
                '/api/version': release,
                '/api/auth/login': { token: 'synthetic-session' },
                '/api/auth/verify': { user: { id: approved.testAccountId, username: 'qa_fixture' } },
                '/api/auth/permissions': permissions,
                [BASE]: workspace
            };
            assert.ok(Object.hasOwn(responses, pathname), 'unexpected preflight request');
            return { ok: true, json: async () => responses[pathname] };
        }, Buffer, URL, AbortSignal, Date, console, process
    }, { filename });
    return { run: module.exports.run, approved, token, planFile, tokenFile, reads, writes, requests, release, permissions, workspace,
        memory: { ...options, plan: approved, qaToken: token },
        files: { ...options, planFile, tokenFile, planFileSha256: sha256(planBytes) } };
}

test('memory and file inputs share release, identity and readiness checks without persisting the QA token', async () => {
    for (const mode of ['memory', 'files']) {
        const f = preflightFixture();
        const result = await f.run(f[mode]);
        assert.equal(result.ok, false, 'mock Chromium stops after complete readiness');
        assert.equal(result.failure, 'finance_qa_browser_failed');
        assert.deepEqual(f.requests.map(row => row.pathname), ['/api/version', '/api/auth/login', '/api/auth/verify', '/api/auth/permissions', BASE]);
        assert.equal(f.requests.at(-1).options.headers['X-QA-Run-Token'], f.token);
        assert.equal(f.writes.length, 1);
        assert.match(f.writes[0].file, /report\.json$/);
        assert.ok(!f.writes[0].value.includes(f.token));
        assert.ok(!JSON.stringify(result).includes(f.token));
        if (mode === 'memory') {
            assert.ok(!f.reads.includes(f.planFile));
            assert.ok(!f.reads.includes(f.tokenFile));
        }
    }
});

test('denied, missing or malformed finance decisions stop before any finance request', async t => {
    const cases = [
        ['denied', { 'action:finance.manage': { allowed: false, source: 'explicit_deny' } }],
        ['missing capabilities', undefined],
        ['missing decision', {}],
        ['null decision', { 'action:finance.manage': null }],
        ['legacy boolean decision', { 'action:finance.manage': true }],
        ['empty decision', { 'action:finance.manage': {} }],
        ['string allowed flag', { 'action:finance.manage': { allowed: 'true' } }],
        ['numeric allowed flag', { 'action:finance.manage': { allowed: 1 } }]
    ];
    for (const mode of ['memory', 'files']) {
        for (const [name, capabilities] of cases) {
            await t.test(`${mode}: ${name}`, async () => {
                const f = preflightFixture();
                f.permissions.capabilities = capabilities;
                await assert.rejects(f.run(f[mode]), { code: 'finance_qa_finance_access_missing' });
                assert.deepEqual(f.requests.map(row => row.pathname), [
                    '/api/version', '/api/auth/login', '/api/auth/verify', '/api/auth/permissions'
                ]);
                assert.ok(f.requests.every(row => !row.options.headers['X-QA-Run-Token']));
                assert.equal(f.writes.length, 0, 'rejected preflight cannot create browser artifacts');
            });
        }
    }
});

test('memory and file entry paths fail closed on confirmation, SHA, canonical plan hash or readiness mismatch', async () => {
    for (const mode of ['memory', 'files']) {
        for (const patch of [{ confirm: '' }, { expectedSha: '' }, { planHash: '0'.repeat(64) }]) {
            const f = preflightFixture();
            await assert.rejects(f.run({ ...f[mode], ...patch }), /finance_qa_/);
            assert.equal(f.requests.length, 0);
            assert.equal(f.writes.length, 0);
        }
        const wrongRelease = preflightFixture();
        wrongRelease.release.commitSha = 'b'.repeat(40);
        await assert.rejects(wrongRelease.run(wrongRelease[mode]), /live_release_mismatch/);
        assert.equal(wrongRelease.requests.length, 1, 'wrong release cannot reach login');
        const wrongWorkspace = preflightFixture();
        wrongWorkspace.workspace.qa.actorId = 999;
        await assert.rejects(wrongWorkspace.run(wrongWorkspace[mode]), /workspace_scope_mismatch/);
        assert.equal(wrongWorkspace.writes.length, 0);
    }
    const mixed = preflightFixture();
    await assert.rejects(mixed.run({ ...mixed.memory, tokenFile: mixed.tokenFile }), /input_sources_mixed/);
});

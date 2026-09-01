'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
    buildManifest,
    classifyMigration,
    confirmationValue,
    manifestHash,
    sanitize,
    validateManifest,
    warningText
} = require('../scripts/production-block-policy');
const {
    executeAction,
    findUnexpiredQaBlocker,
    parseOptions,
    isReleaseArtifact,
    prepareAction,
    qaResumeAction,
    qaRunArgs,
    readBlockFile,
    releaseCommandPlan,
    resolveSpawnCommand,
    resumeAuthorizedQa,
    writeBlockFile
} = require('../scripts/production-block-controller');

const LIVE_SHA = '1'.repeat(40);
const HEAD_SHA = '2'.repeat(40);
const RELEASE_SHA = '3'.repeat(40);

function facts(overrides = {}) {
    return {
        head: HEAD_SHA,
        currentBranch: 'codex/eventgenix-autonomy-hardening',
        live: { commitSha: LIVE_SHA, sourceBranch: 'codex/eventgenix-production', version: '0.0.1' },
        descendsFromLive: true,
        changedPaths: ['scripts/production-block-controller.js'],
        migrations: [],
        ...overrides
    };
}

function manifest(options = {}, factOverrides = {}) {
    return buildManifest(facts(factOverrides), {
        now: new Date(Date.now() - 1_000),
        validityMinutes: 60,
        releaseLabel: 'Autonomy Hardening',
        ...options
    });
}

function blockFile(t, value = manifest()) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eventgenix-production-block-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'block.json');
    writeBlockFile(file, value);
    return file;
}

function dryRuntime(overrides = {}) {
    return {
        async drift(value) {
            return {
                head: value.initialHeadSha,
                descendsFromBase: true,
                descendsFromInitial: true,
                migrations: [...value.allowedMigrationFiles],
                changedPaths: [...value.changedPaths]
            };
        },
        plan: releaseCommandPlan,
        async execute() {
            throw new Error('execute must not run in a dry-run test');
        },
        ...overrides
    };
}

test('prepare is read-only apart from its local block manifest', async t => {
    let productionExecutions = 0;
    const file = blockFile(t);
    fs.rmSync(file);
    const result = await prepareAction({
        blockFile: file,
        now: new Date(Date.now() - 1_000),
        validityMinutes: 60,
        releaseLabel: 'Autonomy Hardening',
        qaScope: { enabled: false }
    }, {
        async facts() { return facts(); },
        async execute() { productionExecutions += 1; }
    });
    assert.equal(result.success, true);
    assert.equal(productionExecutions, 0);
    assert.equal(readBlockFile(file).initialHeadSha, HEAD_SHA);
});

test('prepare validates an enabled QA scope before writing its authorization manifest', async t => {
    const file = blockFile(t);
    fs.rmSync(file);
    let preflightCalls = 0;
    const result = await prepareAction({
        blockFile: file,
        now: new Date(Date.now() - 1_000),
        validityMinutes: 60,
        releaseLabel: 'Autonomy Hardening',
        qaScope: { enabled: true, kind: 'canary', date: '2026-09-02', ttlMinutes: 15, animators: '1', fixtureLimit: 1 }
    }, {
        async facts() { return facts(); },
        async preflightQa(scope, live) {
            preflightCalls += 1;
            assert.equal(scope.date, '2026-09-02');
            assert.equal(live.commitSha, LIVE_SHA);
            return { success: true, action: 'preflight', collisionFree: true, expectedEntityCount: 1 };
        }
    });
    assert.equal(result.success, true);
    assert.equal(preflightCalls, 1);
    assert.equal(readBlockFile(file).runtimeState.qaPreflight.expectedEntityCount, 1);
});

test('wrong confirmation is rejected before production execution', async t => {
    const file = blockFile(t);
    await assert.rejects(
        executeAction({ blockFile: file, confirmation: 'wrong', dryRun: true }, dryRuntime()),
        error => error.code === 'PRODUCTION_BLOCK_CONFIRMATION_INVALID'
    );
});

test('expired manifest is rejected', async t => {
    const expired = buildManifest(facts(), {
        now: new Date(Date.now() - (10 * 60_000)),
        validityMinutes: 5
    });
    const file = blockFile(t, expired);
    await assert.rejects(
        executeAction({ blockFile: file, confirmation: confirmationValue(expired), dryRun: true }, dryRuntime()),
        error => error.code === 'PRODUCTION_BLOCK_EXPIRED'
    );
});

test('SHA drift outside the authorized descendant envelope is rejected', async t => {
    const value = manifest();
    const file = blockFile(t, value);
    await assert.rejects(
        executeAction({ blockFile: file, confirmation: confirmationValue(value), dryRun: true }, dryRuntime({
            async drift() {
                return { head: RELEASE_SHA, descendsFromBase: true, descendsFromInitial: false, migrations: [] };
            }
        })),
        error => error.code === 'PRODUCTION_BLOCK_SHA_DRIFT'
    );
});

test('manifest target drift is rejected even when its hash is recomputed', () => {
    const value = manifest();
    value.railwayServiceId = 'unexpected-service';
    value.manifestHash = manifestHash(value);
    assert.throws(() => validateManifest(value), error => error.code === 'PRODUCTION_BLOCK_TARGET_MISMATCH');
});

test('unknown migration classification is Red and prepare rejects it', () => {
    const migration = { file: 'db/migrations/999_unknown.sql', sql: 'SELECT 1;' };
    assert.equal(classifyMigration(migration.file, migration.sql).red, true);
    assert.throws(
        () => manifest({}, { changedPaths: [migration.file], migrations: [migration] }),
        error => error.code === 'PRODUCTION_BLOCK_RED_MIGRATION'
    );
});

test('cleanup migration requires separate Red approval', () => {
    const migration = {
        file: 'db/migrations/999_cleanup.sql',
        sql: '-- MIGRATION_KIND: cleanup\n-- SAFETY: exact scope\n-- ROLLBACK: restore backup\nDELETE FROM bookings;'
    };
    assert.equal(classifyMigration(migration.file, migration.sql).kind, 'cleanup');
    assert.throws(
        () => manifest({}, { changedPaths: [migration.file], migrations: [migration] }),
        error => error.code === 'PRODUCTION_BLOCK_RED_MIGRATION'
    );
});

test('data-fix needs bounded metadata and rejects protected real-data scope', () => {
    const safe = classifyMigration('db/migrations/999_safe.sql', [
        '-- MIGRATION_KIND: data-fix',
        '-- SAFETY: idempotent catalog-only update',
        '-- ROLLBACK: restore catalog mapping',
        '-- DATA_SCOPE: product catalog metadata',
        'UPDATE products SET timeline_code = code WHERE timeline_code IS NULL;'
    ].join('\n'));
    assert.equal(safe.red, false);
    const unsafe = classifyMigration('db/migrations/999_unsafe.sql', [
        '-- MIGRATION_KIND: data-fix',
        '-- SAFETY: scoped',
        '-- ROLLBACK: restore values',
        '-- DATA_SCOPE: real customer bookings',
        'UPDATE bookings SET status = status;'
    ].join('\n'));
    assert.equal(unsafe.red, true);
});

test('attempt budget stops execution before orchestration', async t => {
    const value = manifest({ maxReleaseAttempts: 1 });
    value.runtimeState.releaseAttempts = 1;
    const file = blockFile(t, value);
    await assert.rejects(
        executeAction({ blockFile: file, confirmation: confirmationValue(value), dryRun: true }, dryRuntime()),
        error => error.code === 'PRODUCTION_BLOCK_ATTEMPT_BUDGET_EXHAUSTED'
    );
});

test('manifest and reports redact secrets and database URLs', () => {
    const output = JSON.stringify(sanitize({
        password: 'do-not-print',
        nested: { authorization: 'Bearer abc', note: 'postgresql://user:pass@example/db' }
    }));
    assert.doesNotMatch(output, /do-not-print|Bearer abc|user:pass/);
    assert.match(output, /redacted/);
});

test('release plan requires exact-SHA CI, helper deploy, version proof, and no raw Railway command', () => {
    const plan = releaseCommandPlan(manifest()).join('\n');
    assert.match(plan, /gh run watch <exact-sha-run> --exit-status/);
    assert.match(plan, /npm run release:railway-up/);
    assert.match(plan, /npm run version:smoke/);
    assert.match(plan, /npm run release:timeline-proof/);
    assert.doesNotMatch(plan, /(^|\n)railway\s+up\b/);
});

test('production controller passes the authorized branch to timeline proof', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'production-block-controller.js'), 'utf8');
    assert.match(source, /release:timeline-proof[\s\S]{0,300}RELEASE_DEPLOY_BRANCH:\s*manifest\.allowedBranch/);
});

test('Windows npm commands use the bundled JS CLI instead of an unspawnable cmd shim', () => {
    const execPath = path.join('C:', 'portable-node', 'node.exe');
    const resolved = resolveSpawnCommand('npm', ['test'], {
        platform: 'win32',
        execPath,
        existsSync: file => file.endsWith(path.join('npm', 'bin', 'npm-cli.js'))
    });
    assert.equal(resolved.executable, execPath);
    assert.equal(resolved.args.at(-1), 'test');
    assert.match(resolved.args[0], /node_modules[\\/]npm[\\/]bin[\\/]npm-cli\.js$/);
    assert.doesNotMatch(resolved.executable, /npm\.cmd$/i);
});

test('release artifact allowlist accepts version/cache files only', () => {
    const accepted = [
        'package.json',
        'package-lock.json',
        'CHANGELOG.md',
        'sw.js',
        'timeline.html',
        'landing/index.html',
        'css/assistant-rail.css',
        'css/pages.css',
        'css/pages-shell.css',
        'css/sidebar-aurora.css',
        'js/designs-page.js',
        'server.js',
        'tests/ui-check.js',
        'docs/integrations/checkbox/IMPLEMENTATION_STATUS.md'
    ];
    accepted.forEach(file => assert.equal(isReleaseArtifact(file), true, file));
    const rejected = [
        ['css', 'arbitrary.css'].join('/'),
        ['js', 'arbitrary.js'].join('/'),
        ['docs', 'arbitrary.md'].join('/'),
        'scripts/production-block-controller.js',
        '.github/workflows/ci.yml'
    ];
    rejected.forEach(file => assert.equal(isReleaseArtifact(file), false, file));
});

test('warning describes a descendant release commit instead of promising the candidate SHA itself', () => {
    const text = warningText(manifest());
    assert.match(text, new RegExp(`Release commit.+candidate SHA ${HEAD_SHA}`));
    assert.doesNotMatch(text, new RegExp(`Push SHA ${HEAD_SHA}`));
});

test('QA controller receives only the explicitly authorized scope', () => {
    const value = manifest({
        qaScope: { enabled: true, kind: 'timeline', date: '2026-09-02', ttlMinutes: 15, animators: '1,2' }
    });
    const plan = releaseCommandPlan(value);
    assert.equal(plan.filter(command => command.includes('qa:timeline:controller')).length, 1);
    assert.deepEqual(value.allowedQaScope, {
        enabled: true,
        kind: 'timeline',
        date: '2026-09-02',
        ttlMinutes: 15,
        animators: '1,2'
    });
});

test('canary QA scope is fail-closed at exactly one fixture', () => {
    assert.doesNotThrow(() => manifest({
        qaScope: { enabled: true, kind: 'canary', date: '2026-09-03', ttlMinutes: 15, animators: '1', fixtureLimit: 1 }
    }));
    assert.throws(() => manifest({
        qaScope: { enabled: true, kind: 'canary', date: '2026-09-03', ttlMinutes: 15, animators: '1', fixtureLimit: 2 }
    }), error => error.code === 'PRODUCTION_BLOCK_QA_SCOPE_INVALID');
});

test('PowerShell-safe base64url QA scope preserves the same strict validation', () => {
    const scope = { enabled: true, kind: 'canary', date: '2026-09-03', ttlMinutes: 15, animators: '1', fixtureLimit: 1 };
    const encoded = Buffer.from(JSON.stringify(scope), 'utf8').toString('base64url');
    assert.deepEqual(parseOptions(['prepare', '--qa-scope-base64', encoded]).qaScope, scope);
    assert.throws(() => parseOptions(['prepare', '--qa-scope-base64', '%%%']),
        error => error.code === 'PRODUCTION_BLOCK_QA_SCOPE_INVALID');
});

test('unexpired active Trusted QA run is identified as a deferral blocker', () => {
    const now = new Date('2026-09-01T18:00:00.000Z');
    const blocker = findUnexpiredQaBlocker({ runs: [
        { runId: 'cleaned', state: 'cleaned', expiresAt: '2026-09-01T20:00:00.000Z' },
        { runId: 'expired', state: 'active', expiresAt: '2026-09-01T17:00:00.000Z' },
        { runId: 'manual-review', state: 'active', expiresAt: '2026-09-01T19:53:24.913Z', exactEntityCount: 36 }
    ] }, now);
    assert.equal(blocker.runId, 'manual-review');
});

test('authorized QA defers without invoking the write runner while another run is active', async () => {
    const value = manifest({
        qaScope: { enabled: true, kind: 'canary', date: '2026-09-03', ttlMinutes: 15, animators: '1', fixtureLimit: 1 }
    });
    let qaRuns = 0;
    const result = await resumeAuthorizedQa(value, RELEASE_SHA, {
        now: new Date('2026-09-01T18:00:00.000Z'),
        async liveVersion() { return { commitSha: RELEASE_SHA, sourceBranch: value.allowedBranch }; },
        async qaStatus() {
            return { runs: [{
                runId: 'manual-review', state: 'active', expiresAt: '2026-09-01T19:53:24.913Z', exactEntityCount: 36
            }] };
        },
        async qaRun() { qaRuns += 1; }
    });
    assert.equal(result.status, 'deferred');
    assert.equal(result.blockerRunId, 'manual-review');
    assert.equal(qaRuns, 0);
});

test('authorized QA rejects live release drift', async () => {
    const value = manifest({
        qaScope: { enabled: true, kind: 'canary', date: '2026-09-03', ttlMinutes: 15, animators: '1', fixtureLimit: 1 }
    });
    await assert.rejects(
        resumeAuthorizedQa(value, RELEASE_SHA, {
            async liveVersion() { return { commitSha: HEAD_SHA, sourceBranch: value.allowedBranch }; }
        }),
        error => error.code === 'PRODUCTION_BLOCK_QA_LIVE_DRIFT'
    );
});

test('authorized QA runner receives only the manifest-bound canary scope', async () => {
    const value = manifest({
        qaScope: { enabled: true, kind: 'canary', date: '2026-09-03', ttlMinutes: 15, animators: '1', fixtureLimit: 1 }
    });
    let captured = null;
    const result = await resumeAuthorizedQa(value, RELEASE_SHA, {
        async liveVersion() { return { commitSha: RELEASE_SHA, sourceBranch: value.allowedBranch }; },
        async qaStatus() { return { runs: [] }; },
        async qaRun(receivedManifest, receivedSha) {
            captured = { scope: receivedManifest.allowedQaScope, sha: receivedSha };
            return { status: 'active', runId: 'canary-run', ttlMinutes: 15 };
        }
    });
    assert.equal(result.runId, 'canary-run');
    assert.deepEqual(captured, { scope: value.allowedQaScope, sha: RELEASE_SHA });
    const args = qaRunArgs(value, RELEASE_SHA);
    assert.deepEqual(args.slice(1), [
        '--action', 'run',
        '--date', '2026-09-03',
        '--ttl-minutes', '15',
        '--animators', '1',
        '--release-sha', RELEASE_SHA,
        '--release-branch', value.allowedBranch,
        '--live-url', value.liveUrl,
        '--fixture-limit', '1'
    ]);
    assert.equal(args.some(arg => /cleanup|booking/i.test(arg)), false);
});

test('QA resume requires exact confirmation and a recorded release SHA', async t => {
    const value = manifest({
        qaScope: { enabled: true, kind: 'canary', date: '2026-09-03', ttlMinutes: 15, animators: '1', fixtureLimit: 1 }
    });
    const file = blockFile(t, value);
    const runtime = { async resumeQa() { throw new Error('must not run'); } };
    await assert.rejects(
        qaResumeAction({ blockFile: file, confirmation: 'wrong' }, runtime),
        error => error.code === 'PRODUCTION_BLOCK_CONFIRMATION_INVALID'
    );
    await assert.rejects(
        qaResumeAction({ blockFile: file, confirmation: confirmationValue(value) }, runtime),
        error => error.code === 'PRODUCTION_BLOCK_RELEASE_SHA_MISSING'
    );
});

test('QA resume rejects an expired production block', async t => {
    const value = buildManifest(facts(), {
        now: new Date(Date.now() - (10 * 60_000)),
        validityMinutes: 5,
        qaScope: { enabled: true, kind: 'canary', date: '2026-09-03', ttlMinutes: 15, animators: '1', fixtureLimit: 1 }
    });
    value.runtimeState.releaseSha = RELEASE_SHA;
    const file = blockFile(t, value);
    await assert.rejects(
        qaResumeAction({ blockFile: file, confirmation: confirmationValue(value) }, { async resumeQa() {} }),
        error => error.code === 'PRODUCTION_BLOCK_EXPIRED'
    );
});

test('QA resume persists only the result returned for the signed QA scope', async t => {
    const value = manifest({
        qaScope: { enabled: true, kind: 'canary', date: '2026-09-03', ttlMinutes: 15, animators: '1', fixtureLimit: 1 }
    });
    value.runtimeState.releaseSha = RELEASE_SHA;
    const file = blockFile(t, value);
    const result = await qaResumeAction({ blockFile: file, confirmation: confirmationValue(value) }, {
        async resumeQa(received, sha) {
            assert.deepEqual(received.allowedQaScope, value.allowedQaScope);
            assert.equal(sha, RELEASE_SHA);
            return { status: 'active', runId: 'canary-run', ttlMinutes: 15 };
        }
    });
    assert.equal(result.result.runId, 'canary-run');
    assert.equal(readBlockFile(file).runtimeState.qa.runId, 'canary-run');
});

test('runtime state can be updated without weakening the signed authorization envelope', t => {
    const value = manifest();
    const originalHash = value.manifestHash;
    value.runtimeState.releaseAttempts = 1;
    value.runtimeState.lastFailureCode = 'CI_FAILED';
    const file = blockFile(t, value);
    const restored = readBlockFile(file);
    assert.equal(restored.manifestHash, originalHash);
    assert.equal(restored.runtimeState.releaseAttempts, 1);
});

require('./codex-autopilot-policy.test');

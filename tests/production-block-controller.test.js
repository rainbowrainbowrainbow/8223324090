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
    migrationSqlHash,
    sanitize,
    validateManifest,
    validateQaScope,
    warningText
} = require('../scripts/production-block-policy');
const {
    applyReleaseNotes,
    assertHrPayrollProductionBase,
    assertPreparedProductionBase,
    assertHrPayrollCiResult,
    selectHrPayrollCiRun,
    executeAction,
    findUnexpiredQaBlocker,
    financeQaPreflight,
    parseOptions,
    isReleaseArtifact,
    prepareAction,
    qaResumeAction,
    qaRunArgs,
    readBlockFile,
    runAuthorizedReleaseStage,
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
                descendsFromRetry: true,
                migrations: [...value.allowedMigrationFiles],
                migrationHashes: Object.fromEntries(value.migrationClassifications.map(item => [item.file, item.sqlHash])),
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



test('SYS-MB protected workflow permits only its exact auth cutover Red surface', () => {
    const value = manifest({ protectedWorkflow: 'sys-mb-auth-cutover' }, {
        changedPaths: [
            'middleware/auth.js',
            'routes/organizations.js',
            'routes/finance.js',
            'routes/payroll.js',
            'services/businessCutover.js',
            'db/migrations/364_catalog_ownership_markers.sql',
            'docs/workstreams/sys-multibusiness/recovery-02/IMPLEMENTATION_RECOVERY_REPORT.md'
        ],
        migrations: [{
            file: 'db/migrations/364_catalog_ownership_markers.sql',
            sql: '-- MIGRATION_KIND: schema\n-- SAFETY: additive catalog ownership markers\n-- ROLLBACK: leave additive columns unused\nALTER TABLE catalog_definitions ADD COLUMN IF NOT EXISTS business_context TEXT;'
        }]
    });
    assert.equal(value.allowedProtectedWorkflow.kind, 'sys-mb-auth-cutover');
    assert.deepEqual(value.allowedProtectedWorkflow.protectedChangedPaths, [
        'db/migrations/364_catalog_ownership_markers.sql',
        'docs/workstreams/sys-multibusiness/recovery-02/IMPLEMENTATION_RECOVERY_REPORT.md',
        'middleware/auth.js',
        'routes/finance.js',
        'routes/organizations.js',
        'routes/payroll.js',
        'services/businessCutover.js'
    ]);
    assert.doesNotThrow(() => validateManifest(value));
    assert.match(warningText(value), /Protected workflow: sys-mb-auth-cutover/);
});

test('SYS-MB protected workflow does not permit unrelated Red production paths', () => {
    assert.throws(() => manifest({ protectedWorkflow: 'sys-mb-auth-cutover' }, {
        changedPaths: ['middleware/auth.js', 'routes/payments.js']
    }), error => error.code === 'PRODUCTION_BLOCK_RED_PATHS');
    assert.throws(() => manifest({ protectedWorkflow: 'unknown' }, {
        changedPaths: ['middleware/auth.js']
    }), error => error.code === 'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_INVALID');
});

test('certificate QA protected workflow keeps exactly the approved Red pair and migration', () => {
    const changedPaths = [
        'routes/auth.js', 'routes/finance.js', 'services/certificateQa.js',
        'scripts/trusted-qa-certificate-run.js',
        'db/migrations/371_trusted_qa_certificate_lookup.sql'
    ];
    const migrations = [{
        file: 'db/migrations/371_trusted_qa_certificate_lookup.sql',
        sql: '-- MIGRATION_KIND: schema\n-- SAFETY: additive and repeatable\n-- ROLLBACK: retain history\nCREATE INDEX IF NOT EXISTS qa_lookup ON trusted_qa_run_entities (entity_id);'
    }];
    const options = { protectedWorkflow: 'certificate-qa-isolation', qaScope: {
        enabled: true, kind: 'certificate', runId: 'certclose03_20260926_preflight',
        testAccountId: 48, businessContext: 'event_genix', ttlMinutes: 30, fixtureLimit: 1
    } };
    const value = manifest(options, { changedPaths, migrations });
    assert.equal(value.allowedProtectedWorkflow.kind, 'certificate-qa-isolation');
    assert.deepEqual(value.allowedProtectedWorkflow.protectedChangedPaths, ['routes/auth.js', 'routes/finance.js']);
    assert.doesNotThrow(() => validateManifest(value));
    assert.match(warningText(value), /1 запис, run certclose03_20260926_preflight, account 48, TTL 30 хв/);
    assert.throws(() => manifest(options, { changedPaths: [...changedPaths, 'routes/payments.js'], migrations }),
        error => error.code === 'PRODUCTION_BLOCK_RED_PATHS');
    assert.throws(() => manifest(options, { changedPaths: changedPaths.filter(file => !file.includes('/371_')), migrations: [] }),
        error => error.code === 'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID');
    assert.throws(() => manifest({ ...options, qaScope: { ...options.qaScope, fixtureLimit: 2 } },
        { changedPaths, migrations }), error => error.code === 'PRODUCTION_BLOCK_QA_SCOPE_INVALID');
});

test('certificate CI protected workflow signs only the expiry and booking precheck release', () => {
    const changedPaths = [
        '.github/workflows/ci.yml',
        'services/scheduler.js',
        'tests/browser/certificate-booking-precheck-app-smoke.js',
        'scripts/production-block-policy.js',
        'tests/production-block-controller.test.js'
    ];
    const options = { protectedWorkflow: 'certificate-ci-gate' };
    const value = manifest(options, { changedPaths });
    assert.deepEqual(value.allowedProtectedWorkflow, {
        enabled: true,
        kind: 'certificate-ci-gate',
        protectedChangedPaths: ['.github/workflows/ci.yml']
    });
    assert.equal(value.realDataMutationAllowed, false);
    assert.deepEqual(value.allowedMigrationFiles, []);
    assert.deepEqual(value.allowedQaScope, { enabled: false });
    assert.doesNotThrow(() => validateManifest(value));
    assert.match(warningText(value), /active із valid_until < поточної київської дати.*до 1000 записів/);

    assert.throws(() => manifest({}, { changedPaths }),
        error => error.code === 'PRODUCTION_BLOCK_RED_PATHS');
    for (const redPath of [
        '.github/workflows/deploy.yml',
        'middleware/auth.js',
        'routes/finance.js',
        'routes/payments.js',
        'railway.json',
        '.env.production'
    ]) {
        assert.throws(() => manifest(options, { changedPaths: [...changedPaths, redPath] }),
            error => error.code === 'PRODUCTION_BLOCK_RED_PATHS', redPath);
    }
    assert.throws(() => manifest(options, { changedPaths: [...changedPaths, 'routes/certificates.js'] }),
        error => error.code === 'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID');
    assert.throws(() => manifest(options, {
        changedPaths: changedPaths.filter(file => file !== 'services/scheduler.js')
    }), error => error.code === 'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID');
    assert.throws(() => manifest(options, {
        changedPaths: [...changedPaths, 'db/migrations/999_certificate_expiry.sql'],
        migrations: [{
            file: 'db/migrations/999_certificate_expiry.sql',
            sql: '-- MIGRATION_KIND: schema\n-- SAFETY: additive\n-- ROLLBACK: leave unused\nCREATE INDEX IF NOT EXISTS cert_expiry ON certificates (valid_until);'
        }]
    }), error => error.code === 'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID');
    assert.throws(() => manifest({ ...options, qaScope: {
        enabled: true, kind: 'canary', date: '2026-09-27', ttlMinutes: 15,
        animators: '1', fixtureLimit: 1
    } }, { changedPaths }), error => error.code === 'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID');
});

test('lead UI CI protected workflow signs only the reviewed unified-card release', () => {
    const changedPaths = [
        '.github/workflows/ci.yml', 'js/leads-page.js', 'leads.html',
        'tests/browser/omni-lead-links-actual-app-browser-smoke.js',
        'tests/browser/omni-workspace-navigation-fixtures.js',
        'docs/CERTIFICATE_CLOSE_03_RELEASE_PLAN.md',
        'tests/browser/checkin-journal-browser-smoke.js',
        'scripts/production-block-policy.js', 'tests/production-block-controller.test.js'
    ];
    const options = { protectedWorkflow: 'lead-ui-ci-gate' };
    const value = manifest(options, { changedPaths });
    assert.deepEqual(value.allowedProtectedWorkflow, {
        enabled: true, kind: 'lead-ui-ci-gate', protectedChangedPaths: ['.github/workflows/ci.yml']
    });
    assert.equal(value.realDataMutationAllowed, false);
    assert.equal(value.settingsMutationAllowed, false);
    assert.deepEqual(value.allowedMigrationFiles, []);
    assert.deepEqual(value.allowedQaScope, { enabled: false });
    assert.doesNotThrow(() => validateManifest(value));
    assert.equal(parseOptions(['prepare', '--protected-workflow', 'lead-ui-ci-gate']).protectedWorkflow, 'lead-ui-ci-gate');
    assert.throws(() => manifest({}, { changedPaths }),
        error => error.code === 'PRODUCTION_BLOCK_RED_PATHS');
    assert.throws(() => manifest({ protectedWorkflow: 'certificate-ci-gate' }, { changedPaths }),
        error => error.code === 'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID');
    for (const extra of ['.github/workflows/deploy.yml', 'middleware/auth.js', 'routes/finance.js', 'railway.json', '.env.production']) {
        assert.throws(() => manifest(options, { changedPaths: [...changedPaths, extra] }),
            error => error.code === 'PRODUCTION_BLOCK_RED_PATHS', extra);
    }
    for (const extra of ['routes/leads.js', 'services/omni-hub.js', 'scripts/production-block-controller.js', 'docs/unreviewed-release.md']) {
        assert.throws(() => manifest(options, { changedPaths: [...changedPaths, extra] }),
            error => error.code === 'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID', extra);
    }
    assert.throws(() => manifest(options, {
        changedPaths: changedPaths.filter(file => file !== 'tests/browser/omni-workspace-navigation-fixtures.js')
    }), error => error.code === 'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID');
    const migration = { file: 'db/migrations/999_unreviewed.sql',
        sql: '-- MIGRATION_KIND: schema\n-- SAFETY: additive\n-- ROLLBACK: leave unused\nCREATE INDEX IF NOT EXISTS test_idx ON leads (id);' };
    assert.throws(() => manifest(options, { changedPaths, migrations: [migration] }),
        error => error.code === 'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID');
    assert.throws(() => manifest({ ...options, qaScope: {
        enabled: true, kind: 'canary', date: '2026-09-28', ttlMinutes: 15, animators: '1', fixtureLimit: 1
    } }, { changedPaths }), error => error.code === 'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID');
    const mutated = { ...value, allowedQaScope: {
        enabled: true, kind: 'canary', date: '2026-09-28', ttlMinutes: 15, animators: '1', fixtureLimit: 1
    } };
    mutated.manifestHash = manifestHash(mutated);
    assert.throws(() => validateManifest(mutated),
        error => error.code === 'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID');
});

test('protected workflow parsing is explicit and disabled by default', () => {
    assert.equal(parseOptions(['prepare', '--protected-workflow', 'sys-mb-auth-cutover']).protectedWorkflow, 'sys-mb-auth-cutover');
    assert.equal(parseOptions(['prepare', '--protected-workflow', 'certificate-ci-gate']).protectedWorkflow, 'certificate-ci-gate');
    assert.equal(parseOptions(['prepare']).protectedWorkflow, 'none');
    assert.throws(() => manifest({}, { changedPaths: ['middleware/auth.js'] }),
        error => error.code === 'PRODUCTION_BLOCK_RED_PATHS');
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

test('tooling preflight fails before consuming a release attempt', async t => {
    const value = manifest({ maxReleaseAttempts: 1 });
    const file = blockFile(t, value);
    await assert.rejects(
        executeAction({ blockFile: file, confirmation: confirmationValue(value), dryRun: false }, dryRuntime({
            async preflightExecution() {
                const error = new Error('npm unavailable');
                error.code = 'PRODUCTION_BLOCK_NPM_CLI_MISSING';
                throw error;
            }
        })),
        error => error.code === 'PRODUCTION_BLOCK_NPM_CLI_MISSING'
    );
    assert.equal(readBlockFile(file).runtimeState.releaseAttempts, 0);
});

test('npm-stripped Windows execute arguments use strict positional block file and confirmation fallback', () => {
    const options = parseOptions(['execute', 'C:\\temp\\block.json', 'ALLOW_PRODUCTION_BLOCK:block:hash']);
    assert.equal(options.action, 'execute');
    assert.equal(options.blockFile, path.resolve('C:\\temp\\block.json'));
    assert.equal(options.confirmation, 'ALLOW_PRODUCTION_BLOCK:block:hash');
});

test('explicit production controller flags remain authoritative over positional fallback', () => {
    const options = parseOptions(['execute', '--block-file', 'explicit.json', '--confirmation', 'exact']);
    assert.equal(options.blockFile, path.resolve('explicit.json'));
    assert.equal(options.confirmation, 'exact');
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
    const execPath = path.win32.join('C:\\', 'portable-node', 'node.exe');
    const resolved = resolveSpawnCommand('npm', ['test'], {
        platform: 'win32',
        execPath,
        env: {},
        existsSync: file => file.endsWith(path.win32.join('npm', 'bin', 'npm-cli.js'))
    });
    assert.equal(resolved.executable, execPath);
    assert.equal(resolved.args.at(-1), 'test');
    assert.match(resolved.args[0], /node_modules[\\/]npm[\\/]bin[\\/]npm-cli\.js$/);
    assert.doesNotMatch(resolved.executable, /npm\.cmd$/i);
});

test('Windows portable node resolves npm from the sibling node_modules package', () => {
    const execPath = path.win32.join('C:\\', 'portable', 'node_modules', 'node', 'bin', 'node.exe');
    const siblingNpmCli = path.win32.join('C:\\', 'portable', 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const resolved = resolveSpawnCommand('npm', ['test'], {
        platform: 'win32',
        execPath,
        env: {},
        existsSync: file => file === siblingNpmCli
    });
    assert.equal(resolved.executable, execPath);
    assert.equal(resolved.args[0], siblingNpmCli);
    assert.deepEqual(resolved.args.slice(1), ['test']);
});

test('Windows npm commands fall back to the canonical inherited npm CLI', () => {
    const execPath = path.win32.resolve('C:\\system-node', 'node.exe');
    const inheritedNpmCli = path.win32.resolve('C:\\portable-node', 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const resolved = resolveSpawnCommand('npm', ['run', 'verify'], {
        platform: 'win32',
        execPath,
        env: { npm_execpath: inheritedNpmCli },
        existsSync: file => file === inheritedNpmCli
    });
    assert.equal(resolved.executable, execPath);
    assert.deepEqual(resolved.args, [inheritedNpmCli, 'run', 'verify']);
});

test('Windows npm commands reject an arbitrary inherited executable', () => {
    const arbitraryNpmExecPath = path.win32.resolve('C:\\temp', 'npm-wrapper.js');
    assert.throws(() => resolveSpawnCommand('npm', ['test'], {
        platform: 'win32',
        execPath: path.win32.resolve('C:\\system-node', 'node.exe'),
        env: { npm_execpath: arbitraryNpmExecPath },
        existsSync: file => file === arbitraryNpmExecPath
    }), error => error?.code === 'PRODUCTION_BLOCK_NPM_CLI_MISSING');
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

test('signed Ukrainian release notes replace both generated release artifacts before commit', t => {
    const value = manifest({ releaseNotes: [{ title: 'Перевірка', text: 'Показано доступність погашення.' }] });
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eventgenix-release-notes-test-'));
    const files = ['package.json', 'CHANGELOG.md', 'index.html'];
    t.after(() => {
        files.forEach(file => fs.unlinkSync(path.join(directory, file)));
        fs.rmdirSync(directory);
    });
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({
        version: '0.82.18', eventGenix: { releaseLabel: value.releaseLabel }
    }));
    fs.writeFileSync(path.join(directory, 'CHANGELOG.md'),
        `## v0.82.18 - ${value.releaseLabel}\n- **${value.releaseLabel}** - release marker, cache tags and visible version metadata were prepared automatically.`);
    fs.writeFileSync(path.join(directory, 'index.html'),
        `<h4>v0.82.18 — ${value.releaseLabel}</h4><li><b>${value.releaseLabel}</b> — release marker, cache tags and visible version metadata were prepared automatically.</li>`);
    applyReleaseNotes(value, directory);
    assert.match(fs.readFileSync(path.join(directory, 'CHANGELOG.md'), 'utf8'),
        /\*\*Перевірка\*\* — Показано доступність погашення/);
    assert.match(fs.readFileSync(path.join(directory, 'index.html'), 'utf8'),
        /<b>Перевірка<\/b> — Показано доступність погашення/);
    assert.throws(() => manifest({ releaseNotes: [{ title: '<unsafe>', text: 'text' }] }),
        error => error.code === 'PRODUCTION_BLOCK_RELEASE_NOTES_INVALID');
});

test('certificate QA remains pending for manual browser verification after exact live SHA proof', async () => {
    const value = manifest({ qaScope: { enabled: true, kind: 'certificate',
        runId: 'certclose03_20260926_preflight', testAccountId: 48,
        businessContext: 'event_genix', ttlMinutes: 30, fixtureLimit: 1 } });
    let called = false;
    const result = await resumeAuthorizedQa(value, RELEASE_SHA, {
        async liveVersion() { return { commitSha: RELEASE_SHA, sourceBranch: value.allowedBranch }; },
        async qaStatus() { called = true; },
        async qaRun() { called = true; }
    });
    assert.equal(result.status, 'pending_manual');
    assert.equal(result.runId, 'certclose03_20260926_preflight');
    assert.equal(called, false);
    assert.equal(releaseCommandPlan(value).some(command => command.includes('qa:timeline:controller')), false);
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
    assert.equal(args.slice(1).some(arg => /cleanup|booking/i.test(arg)), false);
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

test('production autonomy runbook documents npm-safe Windows argument boundaries', () => {
    const runbook = fs.readFileSync(path.join(__dirname, '..', 'docs', 'CODEX_PRODUCTION_AUTONOMY.md'), 'utf8');
    assert.match(runbook, /codex:production-block -- prepare -- \[options\]/);
    assert.match(runbook, /codex:production-block -- execute -- --block-file <path> --confirmation <exact-value>/);
    assert.match(runbook, /portable Windows PowerShell shim/);
});

require('./codex-autopilot-policy.test');

function hrPayFacts() {
    const migrationFile = 'db/migrations/374_payroll_day_exceptions.sql';
    return {
        releaseVersion: '0.0.2',
        changedPaths: ['routes/payroll.js', 'services/hrPayrollConditions.js', 'services/payrollConditionCalculation.js',
            'tests/integration/payroll-profiles-conditions.integration.test.js', migrationFile],
        migrations: [{ file: migrationFile, sql: fs.readFileSync(path.join(__dirname, '..', migrationFile), 'utf8') }]
    };
}
test('HR/payroll gate binds only its exact paths, migration and prepared version', () => {
    const scope = hrPayFacts();
    const options = { protectedWorkflow: 'hr-payroll' };
    const value = manifest(options, scope);
    assert.deepEqual(value.allowedProtectedWorkflow, { enabled: true, kind: 'hr-payroll', protectedChangedPaths: ['routes/payroll.js'] });
    assert.doesNotThrow(() => manifest(options, {...scope,changedPaths:[...scope.changedPaths,'.github/workflows/ci.yml','tests/browser/hr-pay-actual-app-browser-smoke.js']}));
    assert.equal(value.preparedRelease.sha, HEAD_SHA);
    assert.equal(value.preparedRelease.version, '0.0.2');
    assert.doesNotThrow(() => validateManifest(value));
    assert.ok(releaseCommandPlan(value).includes('npm run check:version (prepared exact SHA)'));
    assert.ok(!releaseCommandPlan(value).some(command => command.includes('version:bump')));
    assert.throws(() => manifest({}, scope), error => error.code === 'PRODUCTION_BLOCK_RED_PATHS');
    for (const extra of ['middleware/auth.js', 'routes/finance.js', '.github/workflows/deploy.yml', 'railway.json']) {
        assert.throws(() => manifest(options, { ...scope, changedPaths: [...scope.changedPaths, extra] }), error => error.code === 'PRODUCTION_BLOCK_RED_PATHS');
    }
    for (const extra of ['services/legacyBusinessSurface.js', 'routes/leads.js', 'docs/unreviewed.md']) {
        assert.throws(() => manifest(options, { ...scope, changedPaths: [...scope.changedPaths, extra] }), error => error.code === 'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID');
    }
    assert.throws(() => manifest(options, { ...scope, migrations: [...scope.migrations, { file: 'db/migrations/999_extra.sql', sql: scope.migrations[0].sql }] }),
        error => error.code === 'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID');
    assert.throws(() => manifest(options, { ...scope, releaseVersion: '0.0.1' }), error => error.code === 'PRODUCTION_BLOCK_RELEASE_NOT_PREPARED');
    assert.throws(() => manifest({ ...options, qaScope: { enabled: true, kind: 'canary', date: '2026-10-03', ttlMinutes: 15, animators: '1', fixtureLimit: 1 } }, scope),
        error => error.code === 'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID');
    for (const foreign of ['certificate-ci-gate', 'certificate-qa-isolation', 'lead-ui-ci-gate']) {
        assert.throws(() => manifest({ protectedWorkflow: foreign }, scope));
    }
});
test('HR/payroll execution rejects target, descendant SHA, file and migration drift before any command', async t => {
    const value = manifest({ protectedWorkflow: 'hr-payroll' }, hrPayFacts());
    const file = blockFile(t, value);
    await assert.doesNotReject(executeAction({ blockFile: file, confirmation: confirmationValue(value), dryRun: true }, dryRuntime()));
    for (const [override, code] of [
        [{ head: RELEASE_SHA, descendsFromInitial: true }, 'PRODUCTION_BLOCK_SHA_DRIFT'],
        [{ changedPaths: [...value.changedPaths, 'routes/finance.js'] }, 'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_DRIFT'],
        [{ migrations: [...value.allowedMigrationFiles, 'db/migrations/999_extra.sql'] }, 'PRODUCTION_BLOCK_MIGRATION_DRIFT']
    ]) {
        const runtime = dryRuntime({ async drift(current) { return { ...(await dryRuntime().drift(current)), ...override }; } });
        await assert.rejects(executeAction({ blockFile: file, confirmation: confirmationValue(value), dryRun: true }, runtime), error => error.code === code);
    }
    for (const field of ['allowedBranch', 'railwayProjectId', 'railwayEnvironment', 'railwayServiceId', 'liveUrl']) {
        const changed = JSON.parse(JSON.stringify(value)); changed[field] = 'wrong'; changed.manifestHash = manifestHash(changed);
        assert.throws(() => validateManifest(changed), error => error.code === 'PRODUCTION_BLOCK_TARGET_MISMATCH');
    }
});
test('HR/payroll retains expiry, exact human confirmation and three-attempt stop', async t => {
    const value = manifest({ protectedWorkflow: 'hr-payroll', maxReleaseAttempts: 3 }, hrPayFacts());
    const file = blockFile(t, value);
    await assert.rejects(executeAction({ blockFile: file, confirmation: 'not-human-confirmation', dryRun: true }, dryRuntime()), error => error.code === 'PRODUCTION_BLOCK_CONFIRMATION_INVALID');
    value.runtimeState.releaseAttempts = 3; writeBlockFile(file, value);
    await assert.rejects(executeAction({ blockFile: file, confirmation: confirmationValue(value), dryRun: true }, dryRuntime()), error => error.code === 'PRODUCTION_BLOCK_ATTEMPT_BUDGET_EXHAUSTED');
    const expired = manifest({ protectedWorkflow: 'hr-payroll', now: new Date(Date.now() - 10 * 60_000), validityMinutes: 5 }, hrPayFacts());
    const expiredFile = blockFile(t, expired);
    await assert.rejects(executeAction({ blockFile: expiredFile, confirmation: confirmationValue(expired), dryRun: true }, dryRuntime()), error => error.code === 'PRODUCTION_BLOCK_EXPIRED');
});

test('HR/payroll preflight rejects live or remote base drift and permits an exact-SHA push retry', () => {
    const value = manifest({ protectedWorkflow: 'hr-payroll' }, hrPayFacts());
    const live = { commitSha: LIVE_SHA, sourceBranch: value.allowedBranch };
    assert.doesNotThrow(() => assertHrPayrollProductionBase(value, live, LIVE_SHA));
    assert.doesNotThrow(() => assertHrPayrollProductionBase(value, live, HEAD_SHA));
    assert.throws(() => assertHrPayrollProductionBase(value, live, RELEASE_SHA), error => error.code === 'PRODUCTION_BLOCK_REMOTE_BASE_DRIFT');
    assert.throws(() => assertHrPayrollProductionBase(value, { ...live, commitSha: RELEASE_SHA }, LIVE_SHA), error => error.code === 'PRODUCTION_BLOCK_LIVE_BASE_DRIFT');
    assert.throws(() => assertHrPayrollProductionBase(value, { ...live, sourceBranch: 'wrong' }, LIVE_SHA), error => error.code === 'PRODUCTION_BLOCK_LIVE_BASE_DRIFT');
});

function successfulHrPayrollCi() {
    return { databaseId: 17, headSha: HEAD_SHA, headBranch: 'codex/eventgenix-production',
        workflowName: 'CI', event: 'push', status: 'completed', conclusion: 'success', jobs: [
            'Fast baseline', 'Omni browser regression', 'Certificate redemption regression',
            'Checkbox park PostgreSQL mock integration', 'HR Team browser smoke',
            'HR and payroll PostgreSQL integration', 'My Day PostgreSQL integration', 'My Day browser interactions'
        ].map(name => ({ name, status: 'completed', conclusion: 'success' })) };
}

test('HR/payroll selects only the latest exact production push CI', () => {
    const valid = successfulHrPayrollCi();
    const invalid = [
        { ...valid, databaseId: 30, workflowName: 'Unrelated workflow' },
        { ...valid, databaseId: 31, event: 'pull_request' },
        { ...valid, databaseId: 32, event: 'workflow_dispatch' },
        { ...valid, databaseId: 33, headBranch: 'codex/hr-pay-release-review-20261003' },
        { ...valid, databaseId: 34, headSha: LIVE_SHA }
    ];
    assert.equal(selectHrPayrollCiRun(invalid, HEAD_SHA), null);
    assert.equal(selectHrPayrollCiRun([...invalid, valid, { ...valid, databaseId: 18 }], HEAD_SHA).databaseId, 18);
});

test('HR/payroll rejects green summaries with missing, skipped or failed required jobs', () => {
    const valid = successfulHrPayrollCi();
    assert.doesNotThrow(() => assertHrPayrollCiResult(valid, HEAD_SHA));
    for (const required of valid.jobs) {
        const missing = { ...valid, jobs: valid.jobs.filter(job => job.name !== required.name) };
        assert.throws(() => assertHrPayrollCiResult(missing, HEAD_SHA), error => error.code === 'PRODUCTION_BLOCK_CI_REQUIRED_JOB_FAILED');
        for (const conclusion of ['skipped', 'failure', 'cancelled', 'neutral', '']) {
            const changed = { ...valid, jobs: valid.jobs.map(job => job.name === required.name ? { ...job, conclusion } : job) };
            assert.throws(() => assertHrPayrollCiResult(changed, HEAD_SHA), error => error.code === 'PRODUCTION_BLOCK_CI_REQUIRED_JOB_FAILED');
        }
    }
    assert.throws(() => assertHrPayrollCiResult({ ...valid, jobs: [...valid.jobs, valid.jobs[0]] }, HEAD_SHA), error => error.code === 'PRODUCTION_BLOCK_CI_REQUIRED_JOB_FAILED');
});

test('HR/payroll revalidates exact CI identity and completion after waiting', () => {
    const valid = successfulHrPayrollCi();
    for (const override of [{ headSha: RELEASE_SHA }, { headBranch: 'other' }, { workflowName: 'other' }, { event: 'pull_request' }]) {
        assert.throws(() => assertHrPayrollCiResult({ ...valid, ...override }, HEAD_SHA), error => error.code === 'PRODUCTION_BLOCK_CI_IDENTITY_INVALID');
    }
    for (const override of [{ status: 'in_progress' }, { conclusion: 'failure' }, { conclusion: 'cancelled' }]) {
        assert.throws(() => assertHrPayrollCiResult({ ...valid, ...override }, HEAD_SHA), error => error.code === 'PRODUCTION_BLOCK_CI_INCOMPLETE');
    }
});

test('HR/payroll accepts the exact prepared release markers without admitting adjacent paths', () => {
    const scope = hrPayFacts();
    const releaseFiles = ["CHANGELOG.md","accounting-deposits.html","afisha.html","art-director.html","booking-summary.html","cashier-payments.html","center.html","certificates.html","chat-settings.html","chat.html","checkin.html","content.html","copilot.html","css/assistant-rail.css","css/pages-shell.css","css/pages.css","css/sidebar-aurora.css","customers.html","dashboard.html","data-deletion.html","demo.html","designer.html","designs.html","docs/integrations/checkbox/IMPLEMENTATION_STATUS.md","finance.html","game.html","graduation.html","guardian-ops.html","hermes-studio.html","hr.html","index.html","invite.html","js/designs-page.js","landing/index.html","leads.html","omni.html","package-lock.json","package.json","privacy-policy.html","profile.html","programs.html","quiz.html","report-agent.html","reports.html","room.html","server.js","shop.html","sound.html","staff.html","status.html","sw.js","tasks.html","terms-of-service.html","tests/ui-check.js","timeline-settings.html","training.html","warehouse.html","docs/HR_PAY_RELEASE_NOTES.json"];
    const options = { protectedWorkflow: 'hr-payroll' };
    const value = manifest(options, { ...scope, changedPaths: [...scope.changedPaths, ...releaseFiles] });
    assert.doesNotThrow(() => validateManifest(value));
    for (const foreign of ['future-page.html', 'css/account-access-editor.css', 'js/new-release.js',
        'docs/HR_PAY_RELEASE_NOTES_OTHER.json', 'scripts/unreviewed-release.js']) {
        assert.throws(() => manifest(options, { ...scope, changedPaths: [...value.changedPaths, foreign] }),
            error => error.code === 'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID');
    }
});

function financeQaScope(overrides = {}) {
    return { enabled: true, kind: 'finance', runId: 'finance-qa-scoped-run', testAccountId: 48,
        businessContext: 'event_genix', ttlMinutes: 15,
        planFile: path.join(os.tmpdir(), 'finance-production-plan.json'), planHash: 'a'.repeat(64), ...overrides };
}

test('finance QA scope requires a full plan hash and exact local scope without arbitrary commands', () => {
    const valid = financeQaScope();
    assert.deepEqual(validateQaScope(valid), valid);
    for (const override of [
        { planFile: 'relative-plan.json' }, { planFile: '\\\\remote\\share\\plan.json' },
        { planFile: '/tmp/plan.js' }, { planHash: '' }, { planHash: 'a'.repeat(63) },
        { testAccountId: 0 }, { ttlMinutes: 31 }, { businessContext: 'foreign' },
        { command: 'create' }, { fixtureLimit: 99 }, { date: '2026-10-08' }
    ]) assert.throws(() => validateQaScope({ ...valid, ...override }),
        error => error.code === 'PRODUCTION_BLOCK_QA_SCOPE_INVALID');
    assert.throws(() => manifest({ qaScope: valid }),
        error => error.code === 'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID');
});

test('finance read-only preflight uses a fixed planner and rejects scope or complete plan hash drift', () => {
    const scope = financeQaScope();
    const env = { TRUSTED_QA_OPERATOR_DATABASE_URL: 'fixture-only', DATABASE_URL: 'fixture-only' };
    const report = { planHash: scope.planHash, plan: {
        runId: scope.runId, testAccountId: scope.testAccountId,
        businessContext: scope.businessContext, ttlMinutes: scope.ttlMinutes
    }, readiness: { isolated: true, openFinanceRuns: 0 } };
    let calls = 0;
    const run = (command, args) => {
        calls += 1;
        assert.equal(command, process.execPath);
        assert.equal(path.basename(args[0]), 'trusted-qa-finance-run.js');
        assert.deepEqual(args.slice(1), ['--mode', 'plan', '--plan-file', scope.planFile]);
        return JSON.stringify(report);
    };
    assert.equal(financeQaPreflight(scope, { env, commandResult: run }).planHash, scope.planHash);
    assert.equal(calls, 1);
    for (const invalid of [
        { ...report, planHash: 'b'.repeat(64) },
        { ...report, plan: { ...report.plan, testAccountId: 49 } },
        { ...report, plan: { ...report.plan, businessContext: 'other' } },
        { ...report, plan: { ...report.plan, ttlMinutes: 30 } },
        { ...report, plan: { ...report.plan, runId: 'another-run' } },
        { ...report, readiness: { isolated: false, openFinanceRuns: 0 } },
        { ...report, readiness: { isolated: true, openFinanceRuns: 1 } }
    ]) assert.throws(() => financeQaPreflight(scope, { env, commandResult: () => JSON.stringify(invalid) }),
        error => error.code === 'PRODUCTION_BLOCK_QA_PREFLIGHT_FAILED');
    assert.throws(() => financeQaPreflight(scope, { env: {}, commandResult: run }),
        error => error.code === 'PRODUCTION_BLOCK_QA_OPERATOR_DATABASE_MISSING');
    assert.throws(() => financeQaPreflight(scope, { env: { ...env, DATABASE_URL: 'other' }, commandResult: run }),
        error => error.code === 'PRODUCTION_BLOCK_QA_OPERATOR_DATABASE_MISSING');
    assert.equal(calls, 1, 'missing operator binding must not start the planner');
});

function financeFacts() {
    const files = ['db/migrations/381_finance_manual_money.sql', 'db/migrations/382_finance_trusted_qa.sql'];
    return { releaseVersion: '0.0.2', changedPaths: [
        'routes/finance.js', 'services/financeMoneyMovements.js', 'services/financeMoneyQa.js',
        'services/trustedQaRuns.js', 'scripts/trusted-qa-finance-run.js', 'scripts/run-isolated-postgres-tests.js',
        'tests/integration/finance-money-movements.integration.test.js',
        'tests/integration/finance-money-qa.integration.test.js', 'tests/browser/finance-money-actual-app-browser-smoke.js',
        ...files
    ], migrations: files.map(file => ({ file, sql: fs.readFileSync(path.join(__dirname, '..', file), 'utf8') })) };
}

test('finance gate binds exact reviewed SQL without weakening the generic destructive classifier', () => {
    const scope = financeFacts();
    const options = { protectedWorkflow: 'finance-manual-qa' };
    for (const migration of scope.migrations) {
        const executableSql = migration.sql.replace(/--.*$/gm, '').trim();
        assert.match(executableSql, /^SET LOCAL lock_timeout = '5s';\s+SET LOCAL statement_timeout = '60s';\s+CREATE\b/,
            'both exact migrations must establish transaction-local timeouts before any DDL');
    }
    assert.equal(classifyMigration(scope.migrations[0].file, scope.migrations[0].sql).red, true);
    const value = manifest(options, scope);
    assert.equal(value.preparedRelease.sha, HEAD_SHA);
    assert.equal(value.migrationClassifications[0].red, true, 'index replacement stays visible as Red');
    for (const item of value.migrationClassifications) {
        assert.equal(item.sqlHash, migrationSqlHash(scope.migrations.find(source => source.file === item.file).sql));
        assert.equal(item.protectedException, 'finance-manual-qa:reviewed-exact-sql');
    }
    assert.doesNotThrow(() => validateManifest(value));
    assert.match(warningText(value), /pre381/);
    assert.ok(releaseCommandPlan(value).includes('npm run check:version (prepared exact SHA)'));
    assert.ok(!releaseCommandPlan(value).some(command => command.includes('version:bump')));
    assert.throws(() => manifest({}, scope), error => error.code === 'PRODUCTION_BLOCK_RED_PATHS');
    assert.throws(() => manifest({ protectedWorkflow: 'sys-mb-auth-cutover' }, scope),
        error => error.code === 'PRODUCTION_BLOCK_RED_MIGRATION');
    assert.doesNotThrow(() => manifest(options, { ...scope, migrations: scope.migrations.map(item => ({
        ...item, sql: item.sql.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')
    })) }), 'canonical LF hashes must behave identically on Windows and CI');
    for (let index = 0; index < scope.migrations.length; index += 1) {
        assert.throws(() => manifest(options, { ...scope, migrations: scope.migrations.map((item, position) =>
            position === index ? { ...item, sql: `${item.sql}\nSELECT 1;\n` } : item) }),
        error => error.code === 'PRODUCTION_BLOCK_MIGRATION_HASH_DRIFT');
    }
    assert.throws(() => manifest(options, { ...scope, migrations: [...scope.migrations,
        { file: 'db/migrations/383_unreviewed.sql', sql: '-- MIGRATION_KIND: schema\nCREATE TABLE unauthorized(id int);' }] }),
    error => error.code === 'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID');
    assert.throws(() => manifest(options, { ...scope, migrations: scope.migrations.slice(0, 1) }),
        error => error.code === 'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID');
});

test('finance gate rejects adjacent paths, other QA kinds, unprepared versions and forged SQL exceptions', () => {
    const scope = financeFacts(), options = { protectedWorkflow: 'finance-manual-qa' };
    for (const extra of ['middleware/auth.js', 'routes/payments.js', '.github/workflows/ci.yml', 'railway.json']) {
        assert.throws(() => manifest(options, { ...scope, changedPaths: [...scope.changedPaths, extra] }),
            error => error.code === 'PRODUCTION_BLOCK_RED_PATHS');
    }
    for (const extra of ['services/payroll.js', 'services/accountAccessPolicy.js', 'routes/leads.js',
        'docs/unreviewed.md', 'future-page.html', 'scripts/unreviewed-release.js']) {
        assert.throws(() => manifest(options, { ...scope, changedPaths: [...scope.changedPaths, extra] }),
            error => error.code === 'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID');
    }
    assert.throws(() => manifest(options, { ...scope, releaseVersion: '0.0.1' }),
        error => error.code === 'PRODUCTION_BLOCK_RELEASE_NOT_PREPARED');
    assert.throws(() => manifest({ ...options, qaScope: { enabled: true, kind: 'canary',
        date: '2026-10-08', ttlMinutes: 15, animators: '1', fixtureLimit: 1 } }, scope),
    error => error.code === 'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID');
    const value = manifest(options, scope);
    for (const override of [{ sqlHash: 'b'.repeat(64) }, { protectedException: 'any-sql' }, { red: false },
        { number: 382, kind: 'schema', red: false, destructive: false }]) {
        const tampered = structuredClone(value);
        Object.assign(tampered.migrationClassifications[0], override);
        tampered.manifestHash = manifestHash(tampered);
        assert.throws(() => validateManifest(tampered), error =>
            ['PRODUCTION_BLOCK_MIGRATION_HASH_DRIFT', 'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID'].includes(error.code));
    }
});

test('finance exact release rejects SHA, inventory and SQL drift before commands', async t => {
    const value = manifest({ protectedWorkflow: 'finance-manual-qa' }, financeFacts());
    const file = blockFile(t, value);
    const options = { blockFile: file, confirmation: confirmationValue(value), dryRun: true };
    await assert.doesNotReject(executeAction(options, dryRuntime()));
    for (const [override, code] of [
        [{ head: RELEASE_SHA, descendsFromInitial: true }, 'PRODUCTION_BLOCK_SHA_DRIFT'],
        [{ changedPaths: [...value.changedPaths, 'routes/auth.js'] }, 'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_DRIFT'],
        [{ migrationHashes: {} }, 'PRODUCTION_BLOCK_MIGRATION_HASH_DRIFT'],
        [{ migrations: [...value.allowedMigrationFiles, 'db/migrations/999_extra.sql'] }, 'PRODUCTION_BLOCK_MIGRATION_DRIFT']
    ]) {
        await assert.rejects(executeAction(options, dryRuntime({ async drift(current) {
            return { ...(await dryRuntime().drift(current)), ...override };
        } })), error => error.code === code);
    }
    const live = { commitSha: LIVE_SHA, sourceBranch: value.allowedBranch };
    assert.doesNotThrow(() => assertPreparedProductionBase(value, live, LIVE_SHA));
    assert.doesNotThrow(() => assertPreparedProductionBase(value, live, HEAD_SHA));
    assert.throws(() => assertPreparedProductionBase(value, live, RELEASE_SHA), error => error.code === 'PRODUCTION_BLOCK_REMOTE_BASE_DRIFT');
    assert.throws(() => assertPreparedProductionBase(value, { ...live, commitSha: RELEASE_SHA }, LIVE_SHA),
        error => error.code === 'PRODUCTION_BLOCK_LIVE_BASE_DRIFT');
});

test('finance retains six-hour expiry, exact confirmation and the three-attempt hard limit', async t => {
    const scope = financeFacts(), options = { protectedWorkflow: 'finance-manual-qa' };
    const value = manifest({ ...options, validityMinutes: 360, maxReleaseAttempts: 3 }, scope);
    assert.throws(() => manifest({ ...options, validityMinutes: 361 }, scope), error => error.code === 'PRODUCTION_BLOCK_VALIDITY_INVALID');
    assert.throws(() => manifest({ ...options, maxReleaseAttempts: 4 }, scope), error => error.code === 'PRODUCTION_BLOCK_ATTEMPTS_INVALID');
    const enlarged = structuredClone(value);
    enlarged.maxReleaseAttempts = 4;
    enlarged.manifestHash = manifestHash(enlarged);
    assert.throws(() => validateManifest(enlarged), error => error.code === 'PRODUCTION_BLOCK_ATTEMPTS_INVALID');
    const file = blockFile(t, value);
    await assert.rejects(executeAction({ blockFile: file, confirmation: 'wrong', dryRun: true }, dryRuntime()),
        error => error.code === 'PRODUCTION_BLOCK_CONFIRMATION_INVALID');
    value.runtimeState.releaseAttempts = 3; writeBlockFile(file, value);
    await assert.rejects(executeAction({ blockFile: file, confirmation: confirmationValue(value), dryRun: true }, dryRuntime()),
        error => error.code === 'PRODUCTION_BLOCK_ATTEMPT_BUDGET_EXHAUSTED');
    const expired = manifest({ ...options, now: new Date(Date.now() - 10 * 60_000), validityMinutes: 5 }, scope);
    await assert.rejects(executeAction({ blockFile: blockFile(t, expired), confirmation: confirmationValue(expired), dryRun: true }, dryRuntime()),
        error => error.code === 'PRODUCTION_BLOCK_EXPIRED');
});

test('finance QA after exact live proof stays manual and revalidates its signed plan', async () => {
    const value = manifest({ protectedWorkflow: 'finance-manual-qa', qaScope: financeQaScope() }, financeFacts());
    let preflightCalls = 0, writes = 0;
    const dependencies = {
        async liveVersion() { return { commitSha: HEAD_SHA, sourceBranch: value.allowedBranch }; },
        async financeQaPreflight(scope) { preflightCalls += 1; assert.deepEqual(scope, value.allowedQaScope); },
        async qaStatus() { throw new Error('finance must not enter the timeline QA flow'); },
        async qaRun() { writes += 1; }
    };
    const result = await resumeAuthorizedQa(value, HEAD_SHA, dependencies);
    assert.equal(result.status, 'pending_manual');
    assert.equal(result.planHash, value.allowedQaScope.planHash);
    assert.equal(preflightCalls, 1);
    assert.equal(writes, 0);
    await assert.rejects(resumeAuthorizedQa(value, HEAD_SHA, { ...dependencies,
        async liveVersion() { return { commitSha: RELEASE_SHA, sourceBranch: value.allowedBranch }; }
    }), error => error.code === 'PRODUCTION_BLOCK_QA_LIVE_DRIFT');
    assert.equal(preflightCalls, 1, 'foreign live release must stop before planner invocation');
    await assert.rejects(resumeAuthorizedQa(value, HEAD_SHA, { ...dependencies,
        async financeQaPreflight() { throw Object.assign(new Error('plan changed'), { code: 'PRODUCTION_BLOCK_QA_PREFLIGHT_FAILED' }); }
    }), error => error.code === 'PRODUCTION_BLOCK_QA_PREFLIGHT_FAILED');
    assert.equal(writes, 0);
});

function financeRetryFixture(t, overrides = {}) {
    const previous = overrides.previous || manifest({ protectedWorkflow: 'finance-manual-qa', validityMinutes: 120 }, financeFacts());
    previous.runtimeState = { releaseAttempts: 1, lastFailureCode: 'PRODUCTION_BLOCK_COMMAND_FAILED',
        lastAttemptAt: new Date().toISOString(), ...overrides.runtimeState };
    const previousFile = blockFile(t, previous);
    const newFile = path.join(path.dirname(previousFile), 'retry.json');
    const nextFacts = facts({ ...financeFacts(), head: RELEASE_SHA, ...overrides.facts });
    const failedCi = { ...successfulHrPayrollCi(), headSha: previous.initialHeadSha,
        conclusion: 'failure', jobs: [{ name: 'HR and payroll PostgreSQL integration', status: 'completed', conclusion: 'failure' }] };
    const options = { blockFile: newFile, retryFrom: previousFile, retryCiRun: '37693198330',
        protectedWorkflow: 'finance-manual-qa', releaseLabel: previous.releaseLabel,
        validityMinutes: 360, maxReleaseAttempts: 3, ...overrides.options };
    const runtime = { ...dryRuntime(),
        async facts() { return nextFacts; },
        async retryFacts(received, candidate, runId) {
            assert.equal(received.manifestHash, previous.manifestHash);
            assert.equal(candidate.head, nextFacts.head);
            assert.equal(runId, '37693198330');
            return { remoteSha: previous.initialHeadSha, descendsFromPrior: true, ciRun: failedCi, ...overrides.evidence };
        }
    };
    return { previous, previousFile, newFile, nextFacts, failedCi, options, runtime };
}

test('finance retry parsing requires prepare with an exact prior manifest and failed CI ID', () => {
    const parsed = parseOptions(['prepare', '--', '--retry-from', '/tmp/prior.json', '--retry-ci-run', '37693198330']);
    assert.equal(parsed.retryFrom, path.resolve('/tmp/prior.json'));
    assert.equal(parsed.retryCiRun, '37693198330');
    for (const args of [['prepare', '--retry-from', '/tmp/prior.json'], ['prepare', '--retry-ci-run', '1'],
        ['execute', '--block-file', '/tmp/current.json', '--retry-from', '/tmp/prior.json', '--retry-ci-run', '1']]) {
        assert.throws(() => parseOptions(args), error => error.code === 'PRODUCTION_BLOCK_RETRY_BINDING_INVALID');
    }
});

test('finance retry binds failed prior CI, preserves expiry and budget, and supersedes the old manifest', async t => {
    const fixture = financeRetryFixture(t);
    const prepared = await prepareAction(fixture.options, fixture.runtime);
    const next = readBlockFile(fixture.newFile);
    assert.equal(next.initialHeadSha, RELEASE_SHA);
    assert.equal(next.validUntil, fixture.previous.validUntil, 'fresh prepare must not extend the original window');
    assert.equal(next.runtimeState.releaseAttempts, 1, 'prior attempt must consume the aggregate budget');
    assert.deepEqual(next.retryFrom, { blockFile: fixture.previousFile, blockId: fixture.previous.blockId,
        manifestHash: fixture.previous.manifestHash, headSha: HEAD_SHA, ciRunId: '37693198330', attemptsUsed: 1 });
    assert.notEqual(prepared.confirmation, confirmationValue(fixture.previous));
    assert.equal(readBlockFile(fixture.previousFile).runtimeState.supersededBy.manifestHash, next.manifestHash);
    const execute = { blockFile: fixture.newFile, confirmation: confirmationValue(next), dryRun: true };
    await assert.doesNotReject(executeAction(execute, fixture.runtime));
    await assert.rejects(executeAction({ ...execute, confirmation: confirmationValue(fixture.previous) }, fixture.runtime),
        error => error.code === 'PRODUCTION_BLOCK_CONFIRMATION_INVALID');
    await assert.rejects(executeAction({ blockFile: fixture.previousFile, confirmation: confirmationValue(fixture.previous), dryRun: true }, fixture.runtime),
        error => error.code === 'PRODUCTION_BLOCK_RETRY_SUPERSEDED');
    const live = { commitSha: LIVE_SHA, sourceBranch: next.allowedBranch };
    assert.doesNotThrow(() => assertPreparedProductionBase(next, live, HEAD_SHA));
    assert.throws(() => assertPreparedProductionBase(manifest({ protectedWorkflow: 'finance-manual-qa' },
        { ...financeFacts(), head: RELEASE_SHA }), live, HEAD_SHA), error => error.code === 'PRODUCTION_BLOCK_REMOTE_BASE_DRIFT');
    assert.throws(() => assertPreparedProductionBase(next, live, '4'.repeat(40)), error => error.code === 'PRODUCTION_BLOCK_REMOTE_BASE_DRIFT');
    await assert.rejects(prepareAction({ ...fixture.options, blockFile: path.join(path.dirname(fixture.newFile), 'fork.json') }, fixture.runtime),
        error => error.code === 'PRODUCTION_BLOCK_RETRY_SUPERSEDED');
});

test('finance retry rejects unrelated CI, scope, remote, ancestry, exhausted or successful prior attempts', async t => {
    const failures = [
        [{ runtimeState: { releaseAttempts: 0 } }, 'PRODUCTION_BLOCK_RETRY_STATE_INVALID'],
        [{ runtimeState: { releaseAttempts: 3 } }, 'PRODUCTION_BLOCK_RETRY_STATE_INVALID'],
        [{ runtimeState: { lastFailureCode: null } }, 'PRODUCTION_BLOCK_RETRY_STATE_INVALID'],
        [{ runtimeState: { releaseSha: HEAD_SHA } }, 'PRODUCTION_BLOCK_RETRY_STATE_INVALID'],
        [{ runtimeState: { releaseCompletedAt: new Date().toISOString() } }, 'PRODUCTION_BLOCK_RETRY_STATE_INVALID'],
        [{ facts: { head: HEAD_SHA } }, 'PRODUCTION_BLOCK_RETRY_SHA_INVALID'],
        [{ facts: { releaseVersion: '0.0.3' } }, 'PRODUCTION_BLOCK_RETRY_SCOPE_DRIFT'],
        [{ facts: { changedPaths: [...financeFacts().changedPaths, 'tests/route-smoke.test.js'] } }, 'PRODUCTION_BLOCK_RETRY_SCOPE_DRIFT'],
        [{ options: { qaScope: financeQaScope() } }, 'PRODUCTION_BLOCK_RETRY_SCOPE_DRIFT'],
        [{ options: { maxReleaseAttempts: 2 } }, 'PRODUCTION_BLOCK_RETRY_SCOPE_DRIFT'],
        [{ evidence: { remoteSha: LIVE_SHA } }, 'PRODUCTION_BLOCK_REMOTE_BASE_DRIFT'],
        [{ evidence: { remoteSha: '4'.repeat(40) } }, 'PRODUCTION_BLOCK_REMOTE_BASE_DRIFT'],
        [{ evidence: { descendsFromPrior: false } }, 'PRODUCTION_BLOCK_RETRY_SHA_INVALID']
    ];
    for (const [override, code] of failures) {
        const fixture = financeRetryFixture(t, override);
        await assert.rejects(prepareAction(fixture.options, fixture.runtime), error => error.code === code);
        assert.equal(fs.existsSync(fixture.newFile), false);
        assert.equal(readBlockFile(fixture.previousFile).runtimeState.supersededBy, undefined);
    }
    for (const override of [{ headSha: RELEASE_SHA }, { headBranch: 'foreign' }, { workflowName: 'Other' },
        { event: 'pull_request' }, { conclusion: 'success' }, { conclusion: 'cancelled' }, { status: 'in_progress' }, { jobs: [] }]) {
        const fixture = financeRetryFixture(t);
        fixture.runtime.retryFacts = async () => ({ remoteSha: HEAD_SHA, descendsFromPrior: true, ciRun: { ...fixture.failedCi, ...override } });
        await assert.rejects(prepareAction(fixture.options, fixture.runtime), error => error.code === 'PRODUCTION_BLOCK_RETRY_CI_INVALID');
    }
    const expired = financeRetryFixture(t, { previous: manifest({ protectedWorkflow: 'finance-manual-qa',
        now: new Date(Date.now() - 10 * 60_000), validityMinutes: 5 }, financeFacts()) });
    await assert.rejects(prepareAction(expired.options, expired.runtime), error => error.code === 'PRODUCTION_BLOCK_EXPIRED');
});

test('finance retry detects copied manifests, modified predecessor records, reset counts and changed expiry', async t => {
    const fixture = financeRetryFixture(t);
    await prepareAction(fixture.options, fixture.runtime);
    const next = readBlockFile(fixture.newFile);
    const copyFile = path.join(path.dirname(fixture.newFile), 'copy.json');
    writeBlockFile(copyFile, next);
    assert.throws(() => readBlockFile(copyFile), error => error.code === 'PRODUCTION_BLOCK_RETRY_SUPERSEDED');
    for (const mutate of [
        value => { value.runtimeState.releaseAttempts = 0; },
        value => { value.validUntil = new Date(Date.parse(value.validUntil) + 60_000).toISOString(); },
        value => { value.retryFrom.headSha = '4'.repeat(40); },
        value => { value.retryFrom.attemptsUsed = 0; },
        value => { value.retryFrom.command = 'arbitrary'; }
    ]) {
        const tampered = structuredClone(next); mutate(tampered); tampered.manifestHash = manifestHash(tampered);
        writeBlockFile(fixture.newFile, tampered);
        assert.throws(() => readBlockFile(fixture.newFile), error => error.code === 'PRODUCTION_BLOCK_RETRY_BINDING_INVALID');
    }
    writeBlockFile(fixture.newFile, next);
    const predecessor = readBlockFile(fixture.previousFile);
    predecessor.runtimeState.releaseAttempts = 2;
    writeBlockFile(fixture.previousFile, predecessor);
    assert.throws(() => readBlockFile(fixture.newFile), error => error.code === 'PRODUCTION_BLOCK_RETRY_BINDING_INVALID');
});

test('finance retry serializes attempts and carries the original budget into a final third attempt', async t => {
    const fixture = financeRetryFixture(t);
    await prepareAction(fixture.options, fixture.runtime);
    const next = readBlockFile(fixture.newFile);
    let releaseAttempt;
    let signalStarted;
    const started = new Promise(resolve => { signalStarted = resolve; });
    const hold = new Promise(resolve => { releaseAttempt = resolve; });
    const failingRuntime = { ...fixture.runtime, async execute() {
        signalStarted(); await hold;
        throw Object.assign(new Error('CI failed'), { code: 'PRODUCTION_BLOCK_COMMAND_FAILED' });
    } };
    const execute = { blockFile: fixture.newFile, confirmation: confirmationValue(next) };
    const first = executeAction(execute, failingRuntime);
    const firstAssertion = assert.rejects(first, error => error.code === 'PRODUCTION_BLOCK_COMMAND_FAILED');
    await started;
    await assert.rejects(executeAction(execute, failingRuntime), error => error.code === 'PRODUCTION_BLOCK_EXECUTION_IN_PROGRESS');
    releaseAttempt(); await firstAssertion;
    const failedSecond = readBlockFile(fixture.newFile);
    assert.equal(failedSecond.runtimeState.releaseAttempts, 2);
    const thirdFile = path.join(path.dirname(fixture.newFile), 'third.json');
    const thirdOptions = { ...fixture.options, retryFrom: fixture.newFile, blockFile: thirdFile };
    const thirdRuntime = { ...dryRuntime(),
        async facts() { return facts({ ...financeFacts(), head: '4'.repeat(40) }); },
        async retryFacts() { return { remoteSha: RELEASE_SHA, descendsFromPrior: true,
            ciRun: { ...fixture.failedCi, headSha: RELEASE_SHA } }; },
        async execute() { throw Object.assign(new Error('CI failed again'), { code: 'PRODUCTION_BLOCK_COMMAND_FAILED' }); }
    };
    await prepareAction(thirdOptions, thirdRuntime);
    const third = readBlockFile(thirdFile);
    assert.equal(third.runtimeState.releaseAttempts, 2);
    assert.equal(third.validUntil, fixture.previous.validUntil);
    await assert.rejects(executeAction({ blockFile: thirdFile, confirmation: confirmationValue(third) }, thirdRuntime),
        error => error.code === 'PRODUCTION_BLOCK_COMMAND_FAILED');
    assert.equal(readBlockFile(thirdFile).runtimeState.releaseAttempts, 3);
    await assert.rejects(executeAction({ blockFile: thirdFile, confirmation: confirmationValue(third) }, thirdRuntime),
        error => error.code === 'PRODUCTION_BLOCK_ATTEMPT_BUDGET_EXHAUSTED');
    await assert.rejects(prepareAction({ ...thirdOptions, retryFrom: thirdFile,
        blockFile: path.join(path.dirname(thirdFile), 'fourth.json') }, {
        ...thirdRuntime, async facts() { return facts({ ...financeFacts(), head: '5'.repeat(40) }); }
    }), error => error.code === 'PRODUCTION_BLOCK_RETRY_STATE_INVALID');
});

test('release stage revalidates expiry after tests and CI without executing an expired push or deploy', t => {
    const value = manifest({ protectedWorkflow: 'finance-manual-qa' }, financeFacts());
    const file = blockFile(t, value);
    const calls = [];
    const run = (command, args) => { calls.push([command, args]); return 'executed'; };
    const validTime = new Date(Date.parse(value.validUntil) - 1);
    const expiredTime = new Date(Date.parse(value.validUntil) + 1);
    assert.equal(runAuthorizedReleaseStage(value, file, 'git', ['push'], {},
        { now: validTime, commandResult: run }), 'executed');
    assert.throws(() => runAuthorizedReleaseStage(value, file, 'npm', ['run', 'release:railway-up'], {},
        { now: expiredTime, commandResult: run }), error => error.code === 'PRODUCTION_BLOCK_EXPIRED');
    assert.throws(() => runAuthorizedReleaseStage(value, file, 'git', ['push'], {},
        { now: expiredTime, commandResult: run }), error => error.code === 'PRODUCTION_BLOCK_EXPIRED');
    assert.deepEqual(calls, [['git', ['push']]], 'no expired protected stage may invoke a subprocess');
});

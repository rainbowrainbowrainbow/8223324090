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
    applyReleaseNotes,
    assertHrPayrollProductionBase,
    assertHrPayrollCiResult,
    selectHrPayrollCiRun,
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

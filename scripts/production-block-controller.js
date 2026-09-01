'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    ProductionBlockError,
    TARGET,
    buildManifest,
    confirmationValue,
    sanitize,
    stableJson,
    validateManifest,
    validateQaScope,
    warningText
} = require('./production-block-policy');

const ROOT = path.resolve(__dirname, '..');
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const TRUSTED_QA_CONTROLLER = path.join(ROOT, 'scripts', 'trusted-qa-timeline-controller.js');

function fail(condition, message, code, details = {}) {
    if (!condition) throw new ProductionBlockError(message, code, details);
}

function cleanText(value, max = 300) {
    return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function argValue(args, name, fallback = null) {
    const inline = args.find(arg => arg.startsWith(`${name}=`));
    if (inline) return inline.slice(name.length + 1);
    const index = args.indexOf(name);
    return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}

function argPresent(args, name) {
    return args.includes(name) || args.some(arg => arg === `${name}=true`);
}

function parseQaScope(value) {
    if (!value || value === 'none') return { enabled: false };
    let parsed;
    try { parsed = JSON.parse(value); } catch {
        throw new ProductionBlockError('--qa-scope must be JSON or none', 'PRODUCTION_BLOCK_QA_SCOPE_INVALID');
    }
    return sanitize(validateQaScope(parsed));
}

function decodeQaScope(value) {
    const encoded = String(value || '').trim();
    fail(/^[A-Za-z0-9_-]+={0,2}$/.test(encoded),
        '--qa-scope-base64 must be canonical base64url', 'PRODUCTION_BLOCK_QA_SCOPE_INVALID');
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
    const canonical = Buffer.from(decoded, 'utf8').toString('base64url');
    fail(canonical === encoded.replace(/=+$/, ''),
        '--qa-scope-base64 is malformed', 'PRODUCTION_BLOCK_QA_SCOPE_INVALID');
    return decoded;
}

function defaultBlockFile(blockId) {
    return path.join(os.tmpdir(), 'eventgenix-production-blocks', `${blockId}.json`);
}

function writeBlockFile(file, manifest) {
    const target = path.resolve(file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, stableJson(manifest), { encoding: 'utf8', flag: 'w' });
    return target;
}

function readBlockFile(file, options = {}) {
    fail(Boolean(file) && fs.existsSync(file), 'Production block file is unavailable', 'PRODUCTION_BLOCK_FILE_MISSING');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    return validateManifest(manifest, options);
}

function resolveSpawnCommand(command, args, options = {}) {
    const platform = options.platform || process.platform;
    const execPath = options.execPath || process.execPath;
    const existsSync = options.existsSync || fs.existsSync;
    if (platform === 'win32' && command === 'npm') {
        const npmCli = path.join(path.dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
        fail(existsSync(npmCli), 'Bundled npm CLI is unavailable beside the active Node runtime',
            'PRODUCTION_BLOCK_NPM_CLI_MISSING');
        return { executable: execPath, args: [npmCli, ...args] };
    }
    return { executable: command, args };
}

function commandResult(command, args, options = {}) {
    const resolved = resolveSpawnCommand(command, args);
    const result = childProcess.spawnSync(resolved.executable, resolved.args, {
        cwd: ROOT,
        encoding: 'utf8',
        windowsHide: true,
        stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...(options.env || {}) }
    });
    if (result.error) throw result.error;
    fail(result.status === 0, `${command} ${args.join(' ')} failed`, 'PRODUCTION_BLOCK_COMMAND_FAILED', {
        command: [command, ...args].join(' '),
        exitCode: result.status,
        stderr: cleanText(result.stderr, 1000)
    });
    return String(result.stdout || '').trim();
}

function git(args) {
    return commandResult('git', args);
}

function gitIsAncestor(base, head) {
    const result = childProcess.spawnSync('git', ['merge-base', '--is-ancestor', base, head], {
        cwd: ROOT, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
    });
    return result.status === 0;
}

function changedPaths(base, head) {
    const output = git(['diff', '--name-only', `${base}..${head}`]);
    return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function loadMigrations(paths) {
    return paths
        .filter(file => /^db\/migrations\/\d{3}_[a-z0-9_]+\.sql$/.test(file.replaceAll('\\', '/')))
        .map(file => ({ file: file.replaceAll('\\', '/'), sql: fs.readFileSync(path.join(ROOT, file), 'utf8') }));
}

async function liveVersion(url = TARGET.liveUrl) {
    const response = await fetch(`${url}/api/version`, { headers: { Accept: 'application/json' } });
    fail(response.ok, `Live /api/version returned HTTP ${response.status}`, 'PRODUCTION_BLOCK_LIVE_VERSION_FAILED');
    const body = await response.json();
    fail(SHA_PATTERN.test(String(body.commitSha || '').toLowerCase()) && body.sourceBranch === TARGET.branch,
        'Live version lacks exact production SHA/branch proof', 'PRODUCTION_BLOCK_LIVE_IDENTITY_INVALID');
    return body;
}

function defaultRuntime() {
    const runtime = {
        async facts() {
            fail(!git(['status', '--porcelain']), 'Prepare requires a clean worktree', 'PRODUCTION_BLOCK_DIRTY_WORKTREE');
            const head = git(['rev-parse', 'HEAD']).toLowerCase();
            const currentBranch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
            const live = await liveVersion();
            const paths = changedPaths(live.commitSha, head);
            return {
                head,
                currentBranch,
                live,
                descendsFromLive: gitIsAncestor(live.commitSha, head),
                changedPaths: paths,
                migrations: loadMigrations(paths)
            };
        },
        async drift(manifest) {
            fail(!git(['status', '--porcelain']), 'Execute requires a clean worktree', 'PRODUCTION_BLOCK_DIRTY_WORKTREE');
            const head = git(['rev-parse', 'HEAD']).toLowerCase();
            const paths = changedPaths(manifest.baseLiveSha, head);
            return {
                head,
                descendsFromBase: gitIsAncestor(manifest.baseLiveSha, head),
                descendsFromInitial: gitIsAncestor(manifest.initialHeadSha, head),
                migrations: loadMigrations(paths).map(item => item.file).sort(),
                changedPaths: paths
            };
        },
        plan(manifest) {
            return releaseCommandPlan(manifest);
        },
        async resumeQa(manifest, releaseSha) {
            return resumeAuthorizedQa(manifest, releaseSha);
        },
        async preflightQa(scope, live) {
            return trustedQaPreflight(scope, live);
        },
        async execute(manifest, blockFile) {
            commandResult('npm', ['test'], { inherit: true });
            commandResult('npm', ['run', 'version:bump', '--', 'patch', '--label', manifest.releaseLabel], { inherit: true });
            const releasePaths = git(['diff', '--name-only']).split(/\r?\n/).filter(Boolean);
            fail(releasePaths.length > 0, 'Version bump did not produce release artifacts', 'PRODUCTION_BLOCK_RELEASE_ARTIFACTS_MISSING');
            const invalidReleasePaths = releasePaths.filter(file => !isReleaseArtifact(file));
            fail(invalidReleasePaths.length === 0, 'Version bump changed files outside the release artifact allowlist',
                'PRODUCTION_BLOCK_RELEASE_ARTIFACT_DRIFT', { paths: invalidReleasePaths });
            commandResult('git', ['add', '--', ...releasePaths]);
            const versionStatus = git(['status', '--porcelain']);
            if (versionStatus) commandResult('git', ['commit', '-m', `Release ${manifest.releaseLabel}`], { inherit: true });
            const releaseSha = git(['rev-parse', 'HEAD']).toLowerCase();
            fail(gitIsAncestor(manifest.initialHeadSha, releaseSha),
                'Release commit is not a descendant of the authorized functional SHA', 'PRODUCTION_BLOCK_RELEASE_SHA_DRIFT');
            const migrationFiles = loadMigrations(changedPaths(manifest.baseLiveSha, releaseSha)).map(item => item.file).sort();
            fail(JSON.stringify(migrationFiles) === JSON.stringify(manifest.allowedMigrationFiles),
                'Migration set drifted after authorization', 'PRODUCTION_BLOCK_MIGRATION_DRIFT');
            commandResult('git', ['push', 'origin', `HEAD:refs/heads/${manifest.allowedBranch}`], { inherit: true });
            const exact = findExactCiRun(releaseSha);
            fail(Boolean(exact), 'Exact-SHA GitHub CI run was not found', 'PRODUCTION_BLOCK_CI_NOT_FOUND');
            commandResult('gh', ['run', 'watch', String(exact.databaseId), '--exit-status'], { inherit: true });
            commandResult('npm', ['run', 'release:railway-up', '--',
                '--branch', manifest.allowedBranch,
                '--commit', releaseSha,
                '--project', manifest.railwayProjectId,
                '--environment', manifest.railwayEnvironment,
                '--service', manifest.railwayServiceId,
                '--live-url', manifest.liveUrl
            ], {
                inherit: true,
                env: {
                    CODEX_PRODUCTION_BLOCK_ID: manifest.blockId,
                    CODEX_PRODUCTION_BLOCK_HASH: manifest.manifestHash
                }
            });
            commandResult('npm', ['run', 'version:smoke', '--', manifest.liveUrl], {
                inherit: true,
                env: { VERSION_SMOKE_EXPECT_COMMIT: releaseSha, VERSION_SMOKE_EXPECT_BRANCH: manifest.allowedBranch }
            });
            commandResult('npm', ['run', 'release:timeline-proof', '--', manifest.liveUrl], {
                inherit: true,
                env: { RELEASE_DEPLOY_BRANCH: manifest.allowedBranch }
            });
            manifest.runtimeState.releaseSha = releaseSha;
            manifest.runtimeState.releaseCompletedAt = new Date().toISOString();
            manifest.runtimeState.lastFailureCode = null;
            writeBlockFile(blockFile, manifest);
            let qa = null;
            if (manifest.allowedQaScope?.enabled) {
                qa = await runtime.resumeQa(manifest, releaseSha);
                manifest.runtimeState.qa = qa;
                writeBlockFile(blockFile, manifest);
            }
            return { releaseSha, ciUrl: exact.url, qa, blockFile };
        }
    };
    return runtime;
}

function isReleaseArtifact(file) {
    const normalized = String(file || '').replaceAll('\\', '/');
    const exactPaths = new Set([
        'package.json',
        'package-lock.json',
        'CHANGELOG.md',
        'sw.js',
        'landing/index.html',
        'css/assistant-rail.css',
        'css/pages.css',
        'css/pages-shell.css',
        'css/sidebar-aurora.css',
        'js/designs-page.js',
        'server.js',
        'tests/ui-check.js',
        'docs/integrations/checkbox/IMPLEMENTATION_STATUS.md'
    ]);
    return exactPaths.has(normalized) || /^[^/]+\.html$/.test(normalized);
}

function parseControllerJson(output, code) {
    try {
        return JSON.parse(String(output || ''));
    } catch {
        throw new ProductionBlockError('Trusted QA controller returned malformed JSON', code);
    }
}

function trustedQaStatus() {
    return parseControllerJson(
        commandResult(process.execPath, [TRUSTED_QA_CONTROLLER, '--action', 'status']),
        'PRODUCTION_BLOCK_QA_STATUS_INVALID'
    );
}

function trustedQaPreflight(scope, live) {
    const args = [
        TRUSTED_QA_CONTROLLER,
        '--action', 'preflight',
        '--date', scope.date,
        '--ttl-minutes', String(scope.ttlMinutes),
        '--animators', String(scope.animators),
        '--release-sha', String(live.commitSha || '').toLowerCase(),
        '--release-branch', live.sourceBranch,
        '--live-url', TARGET.liveUrl
    ];
    if (scope.kind === 'canary' || scope.fixtureLimit === 1) args.push('--fixture-limit', '1');
    const report = parseControllerJson(
        commandResult(process.execPath, args),
        'PRODUCTION_BLOCK_QA_PREFLIGHT_MALFORMED'
    );
    fail(report.success === true && report.action === 'preflight' && report.collisionFree === true,
        'Trusted QA preflight did not confirm an available collision-free scope',
        'PRODUCTION_BLOCK_QA_PREFLIGHT_FAILED', sanitize(report));
    return report;
}

function findUnexpiredQaBlocker(status, now = new Date()) {
    return (status?.runs || []).find(run => run?.state === 'active'
        && Number.isFinite(Date.parse(String(run.expiresAt || '')))
        && Date.parse(String(run.expiresAt)) > now.valueOf()) || null;
}

function qaRunArgs(manifest, releaseSha) {
    const qaScope = manifest.allowedQaScope;
    const args = [TRUSTED_QA_CONTROLLER,
        '--action', 'run',
        '--date', qaScope.date,
        '--ttl-minutes', String(qaScope.ttlMinutes),
        '--animators', String(qaScope.animators),
        '--release-sha', releaseSha,
        '--release-branch', manifest.allowedBranch,
        '--live-url', manifest.liveUrl
    ];
    if (qaScope.kind === 'canary') args.push('--fixture-limit', '1');
    return args;
}

function runAuthorizedQa(manifest, releaseSha) {
    const report = parseControllerJson(
        commandResult(process.execPath, qaRunArgs(manifest, releaseSha)),
        'PRODUCTION_BLOCK_QA_REPORT_INVALID'
    );
    fail(report.success === true && report.action === 'run',
        'Trusted QA controller did not confirm a successful run', 'PRODUCTION_BLOCK_QA_RUN_FAILED');
    return sanitize({
        status: 'active',
        kind: manifest.allowedQaScope.kind,
        ttlMinutes: manifest.allowedQaScope.ttlMinutes,
        runId: report.runId,
        expiresAt: report.expiresAt,
        reportFile: report.reportFile
    });
}

async function resumeAuthorizedQa(manifest, releaseSha, dependencies = {}) {
    fail(manifest.allowedQaScope?.enabled === true,
        'Production block does not authorize QA', 'PRODUCTION_BLOCK_QA_NOT_AUTHORIZED');
    fail(SHA_PATTERN.test(String(releaseSha || '').toLowerCase()),
        'QA resume requires a recorded exact release SHA', 'PRODUCTION_BLOCK_RELEASE_SHA_MISSING');
    const readLiveVersion = dependencies.liveVersion || liveVersion;
    const readQaStatus = dependencies.qaStatus || trustedQaStatus;
    const executeQa = dependencies.qaRun || runAuthorizedQa;
    const live = await readLiveVersion(manifest.liveUrl);
    fail(String(live.commitSha || '').toLowerCase() === releaseSha
        && live.sourceBranch === manifest.allowedBranch,
    'Live release identity differs from the block release SHA/branch', 'PRODUCTION_BLOCK_QA_LIVE_DRIFT');
    const blocker = findUnexpiredQaBlocker(await readQaStatus(), dependencies.now || new Date());
    if (blocker) {
        return sanitize({
            status: 'deferred',
            reason: 'unexpired_trusted_qa_run',
            blockerRunId: blocker.runId,
            retryAfter: blocker.expiresAt,
            exactEntityCount: blocker.exactEntityCount
        });
    }
    return executeQa(manifest, releaseSha);
}

function findExactCiRun(releaseSha, options = {}) {
    const attempts = Number(options.attempts || 12);
    const delayMs = Number(options.delayMs || 5000);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const runs = JSON.parse(commandResult('gh', [
            'run', 'list', '--commit', releaseSha, '--limit', '10',
            '--json', 'databaseId,headSha,status,conclusion,url'
        ]));
        const exact = runs.find(run => run.headSha === releaseSha);
        if (exact) return exact;
        if (attempt < attempts) childProcess.spawnSync(process.execPath, ['-e', `setTimeout(() => {}, ${delayMs})`], {
            cwd: ROOT, windowsHide: true, stdio: 'ignore'
        });
    }
    return null;
}

function releaseCommandPlan(manifest) {
    return [
        'npm test',
        `npm run version:bump -- patch --label "${manifest.releaseLabel}"`,
        `git push origin HEAD:refs/heads/${manifest.allowedBranch}`,
        'gh run watch <exact-sha-run> --exit-status',
        `npm run release:railway-up -- --branch ${manifest.allowedBranch} --project ${manifest.railwayProjectId} --environment ${manifest.railwayEnvironment} --service ${manifest.railwayServiceId}`,
        'npm run version:smoke -- <live-url>',
        'npm run release:timeline-proof -- <live-url>',
        ...(manifest.allowedQaScope?.enabled ? ['npm run qa:timeline:controller -- --action run <authorized-scope>'] : [])
    ];
}

async function prepareAction(options, runtime) {
    const facts = await runtime.facts();
    const manifest = buildManifest(facts, options);
    if (manifest.allowedQaScope?.enabled === true) {
        const qaPreflight = await runtime.preflightQa(manifest.allowedQaScope, facts.live);
        manifest.runtimeState.qaPreflight = sanitize(qaPreflight);
    }
    const blockFile = writeBlockFile(options.blockFile || defaultBlockFile(manifest.blockId), manifest);
    return sanitize({ success: true, action: 'prepare', blockFile, manifest, confirmation: confirmationValue(manifest), warning: warningText(manifest) });
}

async function statusAction(options) {
    const manifest = readBlockFile(options.blockFile, { requireUnexpired: false });
    return sanitize({ success: true, action: 'status', expired: new Date() > new Date(manifest.validUntil), manifest });
}

async function assertExecuteDrift(manifest, runtime) {
    const drift = await runtime.drift(manifest);
    fail(drift.descendsFromBase === true && gitIsSafeDescendant(manifest.initialHeadSha, drift.head, drift),
        'Candidate SHA is outside the authorized descendant envelope', 'PRODUCTION_BLOCK_SHA_DRIFT');
    fail(JSON.stringify(drift.migrations) === JSON.stringify(manifest.allowedMigrationFiles),
        'Migration set differs from the authorized envelope', 'PRODUCTION_BLOCK_MIGRATION_DRIFT', {
            expected: manifest.allowedMigrationFiles,
            actual: drift.migrations
        });
    return drift;
}

function gitIsSafeDescendant(initialHead, currentHead, drift) {
    if (currentHead === initialHead) return true;
    return drift.descendsFromInitial === true;
}

async function executeAction(options, runtime) {
    const manifest = readBlockFile(options.blockFile);
    fail(options.confirmation === confirmationValue(manifest),
        'Execute requires the exact block confirmation', 'PRODUCTION_BLOCK_CONFIRMATION_INVALID');
    const attempts = Number(manifest.runtimeState?.releaseAttempts || 0);
    fail(attempts < manifest.maxReleaseAttempts, 'Production block attempt budget is exhausted', 'PRODUCTION_BLOCK_ATTEMPT_BUDGET_EXHAUSTED');
    await assertExecuteDrift(manifest, runtime);
    if (options.dryRun) return sanitize({
        success: true,
        action: 'execute',
        dryRun: true,
        blockId: manifest.blockId,
        commands: runtime.plan(manifest)
    });
    manifest.runtimeState = {
        releaseAttempts: attempts + 1,
        lastAttemptAt: new Date().toISOString(),
        lastFailureCode: null
    };
    writeBlockFile(options.blockFile, manifest);
    try {
        const result = await runtime.execute(manifest, options.blockFile);
        manifest.runtimeState.releaseSha = result.releaseSha;
        manifest.runtimeState.releaseCompletedAt = manifest.runtimeState.releaseCompletedAt || new Date().toISOString();
        manifest.runtimeState.qa = result.qa || null;
        manifest.runtimeState.lastFailureCode = null;
        writeBlockFile(options.blockFile, manifest);
        return sanitize({ success: true, action: 'execute', blockId: manifest.blockId, attempt: attempts + 1, result });
    } catch (error) {
        manifest.runtimeState.lastFailureCode = error.code || 'PRODUCTION_BLOCK_EXECUTE_FAILED';
        writeBlockFile(options.blockFile, manifest);
        throw error;
    }
}

async function qaResumeAction(options, runtime) {
    const manifest = readBlockFile(options.blockFile);
    fail(options.confirmation === confirmationValue(manifest),
        'QA resume requires the exact block confirmation', 'PRODUCTION_BLOCK_CONFIRMATION_INVALID');
    fail(manifest.allowedQaScope?.enabled === true,
        'Production block does not authorize QA', 'PRODUCTION_BLOCK_QA_NOT_AUTHORIZED');
    const releaseSha = String(manifest.runtimeState?.releaseSha || '').toLowerCase();
    fail(SHA_PATTERN.test(releaseSha),
        'QA resume requires a completed release with an exact SHA', 'PRODUCTION_BLOCK_RELEASE_SHA_MISSING');
    const result = await runtime.resumeQa(manifest, releaseSha);
    manifest.runtimeState.qa = result;
    manifest.runtimeState.qaLastAttemptAt = new Date().toISOString();
    writeBlockFile(options.blockFile, manifest);
    return sanitize({ success: true, action: 'qa-resume', blockId: manifest.blockId, releaseSha, result });
}

function parseOptions(argv) {
    const args = [...argv];
    const action = cleanText(args[0] && !args[0].startsWith('-') ? args[0] : argValue(args, '--action', 'status'), 20).toLowerCase();
    fail(['prepare', 'status', 'execute', 'qa-resume'].includes(action), 'Unsupported production block action', 'PRODUCTION_BLOCK_ACTION_INVALID');
    const blockFileValue = argValue(args, '--block-file');
    if (action !== 'prepare') fail(Boolean(blockFileValue), `${action} requires --block-file`, 'PRODUCTION_BLOCK_FILE_REQUIRED');
    const qaScopeBase64 = argValue(args, '--qa-scope-base64');
    const qaScopeValue = qaScopeBase64 ? decodeQaScope(qaScopeBase64) : argValue(args, '--qa-scope', 'none');
    return {
        action,
        blockFile: blockFileValue ? path.resolve(blockFileValue) : null,
        confirmation: argValue(args, '--confirmation'),
        validityMinutes: Number(argValue(args, '--validity-minutes', '360')),
        maxReleaseAttempts: Number(argValue(args, '--max-release-attempts', '3')),
        releaseLabel: cleanText(argValue(args, '--release-label', 'Autonomy Hardening'), 120),
        qaScope: parseQaScope(qaScopeValue),
        dryRun: argPresent(args, '--dry-run')
    };
}

async function execute(options, runtime = defaultRuntime()) {
    if (options.action === 'prepare') return prepareAction(options, runtime);
    if (options.action === 'status') return statusAction(options);
    if (options.action === 'qa-resume') return qaResumeAction(options, runtime);
    return executeAction(options, runtime);
}

function publicError(error) {
    return sanitize({ success: false, code: error?.code || 'PRODUCTION_BLOCK_FAILED', message: cleanText(error?.message, 500), details: error?.details });
}

async function main() {
    return execute(parseOptions(process.argv.slice(2)));
}

if (require.main === module) {
    main()
        .then(result => process.stdout.write(stableJson(result)))
        .catch(error => {
            process.stderr.write(stableJson(publicError(error)));
            process.exitCode = 1;
        });
}

module.exports = {
    assertExecuteDrift,
    defaultBlockFile,
    decodeQaScope,
    execute,
    executeAction,
    findExactCiRun,
    findUnexpiredQaBlocker,
    isReleaseArtifact,
    parseOptions,
    parseQaScope,
    prepareAction,
    publicError,
    qaResumeAction,
    qaRunArgs,
    readBlockFile,
    releaseCommandPlan,
    resolveSpawnCommand,
    resumeAuthorizedQa,
    statusAction,
    trustedQaPreflight,
    writeBlockFile
};

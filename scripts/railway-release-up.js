#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const pkg = require('../package.json');
const {
    DEPLOYMENT_MANIFEST_FILENAME,
    writeDeploymentManifest,
    readDeploymentManifest
} = require('../services/releaseDeploymentManifest');

const DEFAULT_SERVICE = '8223324090';
const DEFAULT_ENVIRONMENT = 'production';
const DEFAULT_PROJECT = 'bc28b46c-d4bc-491c-893a-d8401c633668';
const DEFAULT_LIVE_URL = 'https://8223324090-production.up.railway.app';
const DEFAULT_POST_DEPLOY_SMOKE_ATTEMPTS = 36;
const DEFAULT_POST_DEPLOY_SMOKE_DELAY_MS = 5000;
const FULL_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const COMPLETE_DEPLOYMENT_METADATA_STATUSES = new Set(['railway', 'manifest']);

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseVersion(value) {
    const match = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
    if (!match) return null;
    return match.slice(1, 4).map(part => Number(part));
}

function compareVersions(left, right) {
    const a = parseVersion(left);
    const b = parseVersion(right);
    if (!a || !b) throw new Error(`Cannot compare versions: ${left || '(missing)'} vs ${right || '(missing)'}`);
    for (let index = 0; index < 3; index += 1) {
        if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
    }
    return 0;
}

function envBoolean(value) {
    return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function missingOptionValue(value) {
    const normalized = String(value || '').trim();
    return !normalized || normalized === 'true';
}

function normalizeCommit(value) {
    const commit = String(value || '').trim().toLowerCase();
    return FULL_COMMIT_SHA_PATTERN.test(commit) ? commit : '';
}

function assertCompleteLiveDeploymentMetadata(live) {
    if (!isPlainObject(live)) throw new Error('Live /api/version did not return an object');
    if (!String(live.version || '').trim()) throw new Error('Live /api/version is missing version');
    if (!normalizeCommit(live.commitSha)) throw new Error('Live /api/version is missing a valid commitSha');
    if (!String(live.sourceBranch || '').trim()) throw new Error('Live /api/version is missing sourceBranch');
    const meta = live.deploymentMetadata;
    if (!isPlainObject(meta)) throw new Error('Live /api/version is missing deploymentMetadata');
    if (meta.complete !== true || !COMPLETE_DEPLOYMENT_METADATA_STATUSES.has(meta.status)) {
        throw new Error(`Live deployment metadata is not complete (${meta.status || 'unknown'})`);
    }
}

function liveDeploymentMetadataIsComplete(live) {
    try {
        assertCompleteLiveDeploymentMetadata(live);
        return true;
    } catch {
        return false;
    }
}

function assertPreDeployLiveSafety({
    live,
    localVersion,
    head,
    branch,
    remoteSha = null,
    recoverMissingLiveMetadataCommit = ''
}) {
    if (!isPlainObject(live)) throw new Error('Live /api/version did not return an object');
    if (!String(live.version || '').trim()) throw new Error('Live /api/version is missing version');
    const localHead = normalizeCommit(head);
    const metadataComplete = liveDeploymentMetadataIsComplete(live);
    const recoveryCommit = normalizeCommit(recoverMissingLiveMetadataCommit);
    if (!metadataComplete && !recoveryCommit) assertCompleteLiveDeploymentMetadata(live);
    if (metadataComplete && recoveryCommit) {
        throw new Error('Refusing metadata recovery override because live deployment metadata is complete');
    }
    const liveCommit = metadataComplete ? normalizeCommit(live.commitSha) : recoveryCommit;
    if (!localHead) throw new Error('Local release HEAD is not an exact 40-character SHA');
    if (remoteSha !== null && normalizeCommit(remoteSha) !== localHead) {
        throw new Error(`Remote release branch is ${shortSha(remoteSha)}, but local HEAD is ${shortSha(localHead)}`);
    }
    const liveBranch = metadataComplete ? String(live.sourceBranch || '').trim() : branch;
    if (metadataComplete && liveBranch !== branch) {
        throw new Error(`Live source branch is "${live.sourceBranch}", expected release branch "${branch}"`);
    }
    const versionComparison = compareVersions(localVersion, live.version);
    if (versionComparison < 0) {
        throw new Error(`Refusing to deploy v${localVersion} over newer live v${live.version}`);
    }
    if (!metadataComplete && versionComparison <= 0) {
        throw new Error('Refusing metadata recovery override unless local release version is newer than live');
    }
    if (versionComparison === 0 && liveCommit !== localHead) {
        throw new Error(`Refusing same-version deploy v${localVersion}: live is ${shortSha(liveCommit)}, release is ${shortSha(localHead)}`);
    }
    return {
        liveVersion: live.version,
        liveCommit,
        liveBranch,
        localVersion,
        head: localHead,
        branch,
        recoveredMissingLiveMetadata: !metadataComplete
    };
}

function parseArgs(argv) {
    const options = {
        project: process.env.RELEASE_RAILWAY_PROJECT || process.env.RAILWAY_PROJECT_ID || DEFAULT_PROJECT,
        service: process.env.RELEASE_RAILWAY_SERVICE || process.env.RAILWAY_SERVICE || DEFAULT_SERVICE,
        environment: process.env.RELEASE_RAILWAY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT || DEFAULT_ENVIRONMENT,
        branch: process.env.RELEASE_DEPLOY_BRANCH || process.env.npm_config_branch || '',
        commit: process.env.RELEASE_DEPLOY_COMMIT || process.env.npm_config_commit || '',
        message: process.env.RELEASE_DEPLOY_MESSAGE || process.env.npm_config_message || '',
        liveUrl: process.env.RELEASE_LIVE_URL || process.env.npm_config_live_url || DEFAULT_LIVE_URL,
        dryRun: envBoolean(process.env.npm_config_dry_run),
        parseOnly: process.env.RELEASE_RAILWAY_UP_PARSE_ONLY === 'true',
        skipRemoteCheck: envBoolean(process.env.npm_config_skip_remote_check),
        keepExport: process.env.RELEASE_RAILWAY_KEEP_EXPORT === 'true' || envBoolean(process.env.npm_config_keep_export),
        exportRoot: process.env.RELEASE_RAILWAY_EXPORT_ROOT || process.env.npm_config_export_root || '',
        recoverMissingLiveMetadataCommit: process.env.RELEASE_RECOVER_MISSING_LIVE_METADATA_COMMIT || process.env.npm_config_recover_missing_live_metadata_commit || ''
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--dry-run') {
            options.dryRun = true;
        } else if (arg === '--parse-only') {
            options.parseOnly = true;
        } else if (arg === '--skip-remote-check') {
            options.skipRemoteCheck = true;
        } else if (arg === '--keep-export') {
            options.keepExport = true;
        } else if (arg === '--export-root') {
            options.exportRoot = requireValue(argv, index += 1, arg);
        } else if (arg === '--service') {
            options.service = requireValue(argv, index += 1, arg);
        } else if (arg === '--project') {
            options.project = requireValue(argv, index += 1, arg);
        } else if (arg === '--environment') {
            options.environment = requireValue(argv, index += 1, arg);
        } else if (arg === '--branch') {
            options.branch = requireValue(argv, index += 1, arg);
        } else if (arg === '--commit') {
            options.commit = requireValue(argv, index += 1, arg);
        } else if (arg === '--recover-missing-live-metadata-commit') {
            options.recoverMissingLiveMetadataCommit = requireValue(argv, index += 1, arg);
        } else if (arg === '--message') {
            options.message = requireValue(argv, index += 1, arg);
        } else if (arg === '--live-url') {
            options.liveUrl = requireValue(argv, index += 1, arg);
        } else if (isForwardedNpmConfigValue(arg, options)) {
            // npm on Windows/PowerShell can consume `--branch value` style flags
            // into npm_config_* env vars and append only the positional values.
            // Accept only exact values already represented in npm config; every
            // unrelated positional argument remains a hard failure.
            continue;
        } else if (applyForwardedNpmRunPositional(arg, options)) {
            continue;
        } else {
            fail(`Unknown argument: ${arg}`);
        }
    }

    return options;
}

function isForwardedNpmConfigValue(arg, options) {
    const value = String(arg || '').trim();
    if (!value || value.startsWith('--')) return false;
    return [
        options.branch,
        options.commit,
        options.message,
        options.liveUrl,
        options.project,
        options.service,
        options.environment,
        options.exportRoot,
        options.recoverMissingLiveMetadataCommit
    ].some(optionValue => value === String(optionValue || '').trim());
}

function applyForwardedNpmRunPositional(arg, options) {
    const value = String(arg || '').trim();
    if (!value || value.startsWith('--')) return false;
    if (missingOptionValue(options.branch) && /^[A-Za-z0-9._/-]+$/.test(value) && value.includes('/')) {
        options.branch = value;
        return true;
    }
    if (missingOptionValue(options.commit) && FULL_COMMIT_SHA_PATTERN.test(value)) {
        options.commit = value.toLowerCase();
        return true;
    }
    if (missingOptionValue(options.recoverMissingLiveMetadataCommit) && FULL_COMMIT_SHA_PATTERN.test(value)) {
        options.recoverMissingLiveMetadataCommit = value.toLowerCase();
        return true;
    }
    if ((!process.env.RELEASE_LIVE_URL && (missingOptionValue(options.liveUrl) || options.liveUrl === DEFAULT_LIVE_URL)) && /^https?:\/\//i.test(value)) {
        options.liveUrl = value;
        return true;
    }
    return false;
}

function requireValue(argv, index, flag) {
    const value = argv[index];
    if (!value || value.startsWith('--')) fail(`${flag} requires a value`);
    return value;
}

function fail(message) {
    console.error(`[release:railway-up] ${message}`);
    process.exit(1);
}

function commandText(command, args) {
    return [command, ...args].join(' ');
}

function resolveCommandExecutable(command) {
    if (process.platform !== 'win32') return command;
    if (command === 'git') return 'git.exe';
    if (command === 'tar') return 'tar.exe';
    if (command !== 'railway') return command;

    const explicit = String(process.env.RELEASE_RAILWAY_BIN || '').trim();
    if (explicit) {
        if (!fs.existsSync(explicit)) fail(`RELEASE_RAILWAY_BIN does not exist: ${explicit}`);
        return explicit;
    }

    const lookup = spawnSync('where.exe', ['railway.cmd'], {
        encoding: 'utf8',
        shell: false,
        windowsHide: true
    });
    const wrappers = lookup.status === 0
        ? String(lookup.stdout || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean)
        : [];
    for (const wrapper of wrappers) {
        const executable = path.join(path.dirname(wrapper), 'node_modules', '@railway', 'cli', 'bin', 'railway.exe');
        if (fs.existsSync(executable)) return executable;
    }
    fail('Could not resolve native Railway CLI on Windows. Set RELEASE_RAILWAY_BIN to railway.exe.');
}

function run(command, args, options = {}) {
    const executable = resolveCommandExecutable(command);
    const result = spawnSync(executable, args, {
        encoding: 'utf8',
        shell: false,
        stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
        env: { ...process.env, ...options.env }
    });
    if (result.error) fail(`${commandText(command, args)} failed: ${result.error.message}`);
    if (result.status !== 0) {
        const stderr = String(result.stderr || '').trim();
        fail(`${commandText(command, args)} exited ${result.status}${stderr ? `: ${stderr}` : ''}`);
    }
    return String(result.stdout || '').trim();
}

function git(args) {
    return run('git', args, { capture: true });
}

function gitExitStatus(args) {
    const executable = resolveCommandExecutable('git');
    const result = spawnSync(executable, args, {
        encoding: 'utf8',
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env
    });
    if (result.error) fail(`${commandText('git', args)} failed: ${result.error.message}`);
    return result.status;
}

function assertCleanWorktree() {
    const status = git(['status', '--porcelain']);
    if (status) fail('Worktree is dirty. Use a clean release worktree before deploying.');
}

function assertSafeBranchName(branch) {
    if (!branch) fail('RELEASE_DEPLOY_BRANCH or --branch is required.');
    if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes('..') || branch.startsWith('/') || branch.endsWith('/')) {
        fail(`Unsafe deploy branch name: ${branch}`);
    }
}

function assertSafeRailwayTarget(options) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(options.project)) {
        fail(`Invalid Railway project ID: ${options.project || '(missing)'}`);
    }
    if (!options.service || !options.environment) {
        fail('Railway service and environment are required.');
    }
}

function normalizeLiveUrl(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        fail(`Invalid --live-url: ${value || ''}`);
    }
    if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
        fail('Release live URL must use HTTPS outside localhost.');
    }
    return url.origin;
}

function remoteBranchSha(branch) {
    const output = git(['ls-remote', 'origin', `refs/heads/${branch}`]);
    const sha = output.split(/\s+/)[0] || '';
    if (!/^[0-9a-f]{40}$/i.test(sha)) fail(`Could not resolve origin/${branch}`);
    return sha;
}

function assertReleaseDescendsFromLive(liveCommit, head) {
    const liveSha = normalizeCommit(liveCommit);
    const headSha = normalizeCommit(head);
    if (!liveSha || !headSha || liveSha === headSha) return;
    const status = gitExitStatus(['merge-base', '--is-ancestor', liveSha, headSha]);
    if (status !== 0) {
        fail(`Release HEAD ${shortSha(headSha)} is not a descendant of live SHA ${shortSha(liveSha)}. Rebase onto current production before deploying.`);
    }
}

function shortSha(sha) {
    return String(sha || '').slice(0, 8);
}

function assertSafeExportRoot(exportRoot) {
    const resolved = path.resolve(exportRoot);
    const allowedParents = [path.resolve(os.tmpdir()), path.resolve(process.cwd(), '.codex-temp')];
    const allowed = allowedParents.some(parent => resolved === parent || resolved.startsWith(parent + path.sep));
    if (!allowed) fail(`Refusing export root outside temp/.codex-temp: ${resolved}`);
    return resolved;
}

function validateExport(sourceDir, head, branch) {
    const packagePath = path.join(sourceDir, 'package.json');
    const indexPath = path.join(sourceDir, 'index.html');
    if (!fs.existsSync(packagePath)) fail('Clean export is missing package.json');
    if (!fs.existsSync(indexPath)) fail('Clean export is missing index.html');
    const exportedPkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    if (exportedPkg.version !== pkg.version) {
        fail(`Clean export package.json version ${exportedPkg.version} does not match local ${pkg.version}`);
    }
    const indexHtml = fs.readFileSync(indexPath, 'utf8');
    if (!indexHtml.includes(`?v=${pkg.version}`) && !indexHtml.includes(`v${pkg.version}`)) {
        fail(`Clean export index.html does not expose v${pkg.version}`);
    }
    const manifestResult = readDeploymentManifest({ rootDir: sourceDir, expectedVersion: pkg.version });
    if (manifestResult.state !== 'valid'
        || manifestResult.manifest.commitSha !== head
        || manifestResult.manifest.sourceBranch !== branch) {
        fail(`Clean export ${DEPLOYMENT_MANIFEST_FILENAME} does not match release target.`);
    }
    const exportHead = run('git', ['rev-parse', head], { capture: true });
    if (exportHead !== head) fail(`Clean export source HEAD mismatch: ${exportHead} !== ${head}`);
}

function createCleanExport(head, branch, options) {
    const exportBase = options.exportRoot
        ? assertSafeExportRoot(options.exportRoot)
        : fs.mkdtempSync(path.join(os.tmpdir(), `eventgenix-release-${shortSha(head)}-`));
    if (options.exportRoot) {
        if (fs.existsSync(exportBase) && fs.readdirSync(exportBase).length) {
            fail(`Export root already exists and is not empty: ${exportBase}`);
        }
        fs.mkdirSync(exportBase, { recursive: true });
    }
    const sourceDir = path.join(exportBase, 'source');
    const archivePath = path.join(exportBase, 'source.tar');
    fs.mkdirSync(sourceDir, { recursive: true });
    run('git', ['archive', '--format=tar', '--output', archivePath, head]);
    run('tar', ['-xf', archivePath, '-C', sourceDir]);
    fs.rmSync(archivePath, { force: true });
    const manifestInfo = writeDeploymentManifest(sourceDir, {
        applicationVersion: pkg.version,
        commitSha: head,
        sourceBranch: branch
    });
    validateExport(sourceDir, head, branch);
    return { sourceDir, exportBase, manifestPath: manifestInfo.filePath };
}

function cleanupExport(exportInfo, options) {
    if (!exportInfo || options.keepExport) return;
    fs.rmSync(exportInfo.exportBase, { recursive: true, force: true });
}

function sleep(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runPostDeploySmoke(liveUrl, head, branch) {
    let lastOutput = '';
    for (let attempt = 1; attempt <= DEFAULT_POST_DEPLOY_SMOKE_ATTEMPTS; attempt += 1) {
        const result = spawnSync(process.execPath, ['scripts/live-version-smoke.js', liveUrl], {
            cwd: process.cwd(),
            encoding: 'utf8',
            shell: false,
            env: {
                ...process.env,
                VERSION_SMOKE_EXPECT_COMMIT: head,
                VERSION_SMOKE_EXPECT_BRANCH: branch,
                VERSION_SMOKE_RETRIES: '1',
                VERSION_SMOKE_TIMEOUT_MS: '10000',
                VERSION_SMOKE_RETRY_DELAY_MS: '0'
            }
        });
        if (result.status === 0) {
            const output = String(result.stdout || '').trim();
            if (output) console.log(`[release:railway-up] ${output}`);
            return;
        }
        lastOutput = String(result.stderr || result.stdout || '').trim();
        if (attempt < DEFAULT_POST_DEPLOY_SMOKE_ATTEMPTS) {
            console.warn(`[release:railway-up] post-deploy smoke attempt ${attempt}/${DEFAULT_POST_DEPLOY_SMOKE_ATTEMPTS} did not pass yet.`);
            sleep(DEFAULT_POST_DEPLOY_SMOKE_DELAY_MS);
        }
    }
    fail(`Post-deploy version smoke did not verify the uploaded artifact: ${lastOutput || 'no output'}`);
}

async function fetchLiveVersionSnapshot(liveUrl, options = {}) {
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof fetchImpl !== 'function') throw new Error('fetch is required to read live /api/version');
    const response = await fetchImpl(`${liveUrl}/api/version`, {
        headers: { Accept: 'application/json' },
        signal: options.signal
    });
    if (!response || response.ok !== true) {
        throw new Error(`Live /api/version returned HTTP ${response?.status || 'unknown'}`);
    }
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch {
        throw new Error('Live /api/version did not return JSON');
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.parseOnly) {
        console.log(JSON.stringify({
            branch: options.branch,
            commit: options.commit,
            liveUrl: options.liveUrl,
            dryRun: options.dryRun,
            skipRemoteCheck: options.skipRemoteCheck,
            project: options.project,
            service: options.service,
            environment: options.environment,
            recoverMissingLiveMetadataCommit: options.recoverMissingLiveMetadataCommit
        }));
        return;
    }
    assertSafeBranchName(options.branch);
    assertSafeRailwayTarget(options);
    assertCleanWorktree();
    const liveUrl = normalizeLiveUrl(options.liveUrl);

    const head = git(['rev-parse', 'HEAD']);
    const expectedCommit = options.commit || head;
    if (expectedCommit !== head) fail(`Expected commit ${expectedCommit} does not match local HEAD ${head}`);

    let remoteSha = null;
    if (!options.skipRemoteCheck) {
        remoteSha = remoteBranchSha(options.branch);
        if (remoteSha !== head) fail(`origin/${options.branch} is ${remoteSha}, but local HEAD is ${head}. Push and wait for CI first.`);
    }

    const liveSnapshot = await fetchLiveVersionSnapshot(liveUrl);
    const preDeploy = assertPreDeployLiveSafety({
        live: liveSnapshot,
        localVersion: pkg.version,
        head,
        branch: options.branch,
        remoteSha,
        recoverMissingLiveMetadataCommit: options.recoverMissingLiveMetadataCommit
    });
    assertReleaseDescendsFromLive(preDeploy.liveCommit, head);

    const message = options.message || `Release v${pkg.version} ${pkg.eventGenix?.releaseLabel || pkg.name} (${shortSha(head)}; ${options.branch})`;
    console.log(`[release:railway-up] project=${options.project}`);
    console.log(`[release:railway-up] service=${options.service}`);
    console.log(`[release:railway-up] environment=${options.environment}`);
    console.log(`[release:railway-up] branch=${options.branch}`);
    console.log(`[release:railway-up] commit=${head}`);
    console.log(`[release:railway-up] manifest=${DEPLOYMENT_MANIFEST_FILENAME}`);
    console.log(`[release:railway-up] liveUrl=${liveUrl}`);
    if (preDeploy.recoveredMissingLiveMetadata) {
        console.log(`[release:railway-up] recoveredMissingLiveMetadataFrom=${preDeploy.liveCommit}`);
    }
    console.log(`[release:railway-up] message=${message}`);

    if (options.dryRun) {
        console.log('[release:railway-up] dry-run > git archive --format=tar HEAD + deployment manifest');
        console.log(`[release:railway-up] dry-run > railway up <clean-export> --path-as-root --project ${options.project} --service ${options.service} --environment ${options.environment}`);
        console.log(`[release:railway-up] dry-run > VERSION_SMOKE_EXPECT_COMMIT=${head} VERSION_SMOKE_EXPECT_BRANCH=${options.branch} npm run version:smoke -- ${liveUrl}`);
        return;
    }

    let exportInfo = null;
    try {
        exportInfo = createCleanExport(head, options.branch, options);
        console.log(`[release:railway-up] clean export=${exportInfo.sourceDir}`);
        run('railway', [
            'up',
            exportInfo.sourceDir,
            '--path-as-root',
            '--project',
            options.project,
            '--service',
            options.service,
            '--environment',
            options.environment,
            '--message',
            message
        ]);
        runPostDeploySmoke(liveUrl, head, options.branch);
    } finally {
        cleanupExport(exportInfo, options);
    }
}

if (require.main === module) {
    main().catch(error => fail(error?.message || String(error)));
}

module.exports = {
    parseArgs,
    assertSafeRailwayTarget,
    compareVersions,
    assertPreDeployLiveSafety,
    fetchLiveVersionSnapshot,
    validateExport,
    createCleanExport,
    runPostDeploySmoke
};

#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const pkg = require('../package.json');

const DEFAULT_SERVICE = '8223324090';
const DEFAULT_ENVIRONMENT = 'production';

function parseArgs(argv) {
    const options = {
        service: process.env.RELEASE_RAILWAY_SERVICE || process.env.RAILWAY_SERVICE || DEFAULT_SERVICE,
        environment: process.env.RELEASE_RAILWAY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT || DEFAULT_ENVIRONMENT,
        branch: process.env.RELEASE_DEPLOY_BRANCH || '',
        commit: process.env.RELEASE_DEPLOY_COMMIT || '',
        message: process.env.RELEASE_DEPLOY_MESSAGE || '',
        dryRun: false,
        skipVariableSet: false,
        skipRemoteCheck: false,
        cleanExport: process.env.RELEASE_RAILWAY_CLEAN_EXPORT !== 'false',
        keepExport: process.env.RELEASE_RAILWAY_KEEP_EXPORT === 'true',
        exportRoot: process.env.RELEASE_RAILWAY_EXPORT_ROOT || ''
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--dry-run') {
            options.dryRun = true;
        } else if (arg === '--skip-variable-set') {
            options.skipVariableSet = true;
        } else if (arg === '--skip-remote-check') {
            options.skipRemoteCheck = true;
        } else if (arg === '--no-clean-export') {
            options.cleanExport = false;
        } else if (arg === '--keep-export') {
            options.keepExport = true;
        } else if (arg === '--export-root') {
            options.exportRoot = requireValue(argv, index += 1, arg);
        } else if (arg === '--service') {
            options.service = requireValue(argv, index += 1, arg);
        } else if (arg === '--environment') {
            options.environment = requireValue(argv, index += 1, arg);
        } else if (arg === '--branch') {
            options.branch = requireValue(argv, index += 1, arg);
        } else if (arg === '--commit') {
            options.commit = requireValue(argv, index += 1, arg);
        } else if (arg === '--message') {
            options.message = requireValue(argv, index += 1, arg);
        } else {
            fail(`Unknown argument: ${arg}`);
        }
    }

    return options;
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

function assertCleanWorktree() {
    const status = git(['status', '--porcelain']);
    if (status) {
        fail('Worktree is dirty. Use a clean release worktree before deploying.');
    }
}

function assertSafeBranchName(branch) {
    if (!branch) fail('RELEASE_DEPLOY_BRANCH or --branch is required.');
    if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes('..') || branch.startsWith('/') || branch.endsWith('/')) {
        fail(`Unsafe deploy branch name: ${branch}`);
    }
}

function remoteBranchSha(branch) {
    const output = git(['ls-remote', 'origin', `refs/heads/${branch}`]);
    const sha = output.split(/\s+/)[0] || '';
    if (!/^[0-9a-f]{40}$/i.test(sha)) fail(`Could not resolve origin/${branch}`);
    return sha;
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

function validateExport(sourceDir, head) {
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
    const exportHead = run('git', ['rev-parse', head], { capture: true });
    if (exportHead !== head) fail(`Clean export source HEAD mismatch: ${exportHead} !== ${head}`);
}

function createCleanExport(head, options) {
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
    validateExport(sourceDir, head);
    return { sourceDir, exportBase };
}

function cleanupExport(exportInfo, options) {
    if (!exportInfo || options.keepExport) return;
    fs.rmSync(exportInfo.exportBase, { recursive: true, force: true });
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    assertSafeBranchName(options.branch);
    assertCleanWorktree();

    const head = git(['rev-parse', 'HEAD']);
    const expectedCommit = options.commit || head;
    if (expectedCommit !== head) {
        fail(`Expected commit ${expectedCommit} does not match local HEAD ${head}`);
    }

    if (!options.skipRemoteCheck) {
        const remoteSha = remoteBranchSha(options.branch);
        if (remoteSha !== head) {
            fail(`origin/${options.branch} is ${remoteSha}, but local HEAD is ${head}. Push and wait for CI first.`);
        }
    }

    const message = options.message || `Release v${pkg.version} ${pkg.eventGenix?.releaseLabel || pkg.name} (${shortSha(head)}; ${options.branch})`;
    console.log(`[release:railway-up] service=${options.service}`);
    console.log(`[release:railway-up] environment=${options.environment}`);
    console.log(`[release:railway-up] branch=${options.branch}`);
    console.log(`[release:railway-up] commit=${head}`);
    console.log(`[release:railway-up] cleanExport=${options.cleanExport ? 'true' : 'false'}`);
    console.log(`[release:railway-up] message=${message}`);
    console.log(`[release:railway-up] postDeploySmoke=VERSION_SMOKE_EXPECT_COMMIT=${head} `
        + `VERSION_SMOKE_EXPECT_BRANCH=${options.branch} npm run version:smoke -- <live-url>`);

    let exportInfo = null;
    let deploySource = '.';
    if (options.cleanExport) {
        if (options.dryRun) {
            deploySource = '<clean-export-from-git-archive>';
            console.log('[release:railway-up] dry-run > git archive --format=tar HEAD');
        } else {
            exportInfo = createCleanExport(head, options);
            deploySource = exportInfo.sourceDir;
            console.log(`[release:railway-up] clean export=${deploySource}`);
        }
    }

    const variableArgs = [
        'variable',
        'set',
        `RELEASE_DEPLOY_COMMIT=${head}`,
        `RELEASE_DEPLOY_BRANCH=${options.branch}`,
        '--service',
        options.service,
        '--environment',
        options.environment,
        '--skip-deploys',
        '--json'
    ];
    const deployArgs = [
        'up',
        deploySource,
        '--path-as-root',
        '--service',
        options.service,
        '--environment',
        options.environment,
        '--message',
        message
    ];

    try {
        if (options.dryRun) {
            if (!options.skipVariableSet) console.log(`[release:railway-up] dry-run > railway ${variableArgs.join(' ')}`);
            console.log(`[release:railway-up] dry-run > railway ${deployArgs.join(' ')}`);
            return;
        }

        if (!options.skipVariableSet) {
            run('railway', variableArgs);
        }
        run('railway', deployArgs);
    } finally {
        cleanupExport(exportInfo, options);
    }
}

main();

#!/usr/bin/env node
/**
 * Print the canonical CRM version, but refuse to present a stale local checkout
 * as the current branch version.
 *
 * Usage:
 *   npm run version:current
 *   node scripts/current-version.js --no-fetch
 *   node scripts/current-version.js --json
 */

const path = require('path');
const { spawnSync } = require('child_process');
const pkg = require('../package.json');

const ROOT = path.resolve(__dirname, '..');
const NO_FETCH = process.argv.includes('--no-fetch');
const JSON_OUTPUT = process.argv.includes('--json');
const GIT_COMMAND = process.platform === 'win32' ? 'git.exe' : 'git';

function run(command, args) {
    const result = spawnSync(command, args, {
        cwd: ROOT,
        encoding: 'utf8'
    });
    return {
        ok: result.status === 0,
        status: result.status || 0,
        stdout: String(result.stdout || '').trim(),
        stderr: String(result.stderr || '').trim()
    };
}

function git(args) {
    return run(GIT_COMMAND, args);
}

function parseAheadBehind(value) {
    const [ahead, behind] = String(value || '').split(/\s+/).map(Number);
    return {
        ahead: Number.isFinite(ahead) ? ahead : 0,
        behind: Number.isFinite(behind) ? behind : 0
    };
}

function fetchArgsForUpstream(upstream) {
    const split = String(upstream || '').indexOf('/');
    if (split <= 0) return ['fetch', '--quiet'];
    const remote = upstream.slice(0, split);
    const branch = upstream.slice(split + 1);
    return ['fetch', '--quiet', remote, `refs/heads/${branch}:refs/remotes/${remote}/${branch}`];
}

function readGitState() {
    const inside = git(['rev-parse', '--is-inside-work-tree']);
    if (!inside.ok || inside.stdout !== 'true') {
        return {
            available: false,
            warning: inside.stderr || 'not a git work tree'
        };
    }

    const branch = git(['branch', '--show-current']);
    const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    const dirty = git(['status', '--porcelain']);
    const state = {
        available: true,
        branch: branch.stdout || '(detached)',
        upstream: upstream.ok ? upstream.stdout : '',
        ahead: 0,
        behind: 0,
        fetched: false,
        fetchWarning: '',
        upstreamWarning: upstream.ok ? '' : (upstream.stderr || 'no upstream configured'),
        dirtyFiles: dirty.ok && dirty.stdout ? dirty.stdout.split(/\r?\n/).filter(Boolean) : []
    };

    if (state.upstream && !NO_FETCH) {
        const fetched = git(fetchArgsForUpstream(state.upstream));
        state.fetched = fetched.ok;
        if (!fetched.ok) {
            state.fetchWarning = fetched.stderr || 'could not refresh upstream metadata';
        }
    }

    if (state.upstream) {
        const counts = git(['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
        if (counts.ok) {
            Object.assign(state, parseAheadBehind(counts.stdout));
        }
    }

    return state;
}

function buildResult() {
    const releaseLabel = String(pkg.eventGenix?.releaseLabel || pkg.releaseLabel || '').trim();
    const gitState = readGitState();
    const stale = Boolean(gitState.available && gitState.behind > 0);
    return {
        version: pkg.version,
        releaseLabel,
        source: 'package.json',
        git: gitState,
        stale,
        trusted: !stale
    };
}

function printHuman(result) {
    const label = result.releaseLabel ? ` - ${result.releaseLabel}` : '';
    console.log(`CRM version: v${result.version}${label}`);
    console.log(`source: ${result.source}`);

    if (!result.git.available) {
        console.log(`git: unavailable (${result.git.warning})`);
        return;
    }

    console.log(`branch: ${result.git.branch}`);
    if (result.git.upstream) {
        const sync = result.git.behind > 0
            ? `behind ${result.git.behind}`
            : result.git.ahead > 0
                ? `ahead ${result.git.ahead}`
                : 'in sync';
        console.log(`upstream: ${result.git.upstream} (${sync})`);
    } else {
        console.log(`upstream: none (${result.git.upstreamWarning})`);
    }

    if (result.git.fetchWarning) {
        console.log(`warning: ${result.git.fetchWarning}`);
    }

    console.log(result.git.dirtyFiles.length
        ? `worktree: dirty (${result.git.dirtyFiles.length} file(s))`
        : 'worktree: clean');

    if (result.stale) {
        console.error('');
        console.error(`Version guard failed: local branch is behind ${result.git.upstream} by ${result.git.behind} commit(s).`);
        console.error('Run git pull --ff-only, then run npm run version:current again before answering the current version.');
    }
}

const result = buildResult();
if (JSON_OUTPUT) {
    console.log(JSON.stringify(result, null, 2));
} else {
    printHuman(result);
}

if (result.stale) {
    process.exit(2);
}

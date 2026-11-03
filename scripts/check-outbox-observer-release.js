'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const BASE = 'bac980a44c2013cc3169b04df04efed05ddf6372';
const CONFIG_PARENT = 'd9c0b7c81fb81b69ed7d084ff78896a0f58d6843';
const CONFIG_BRANCH = 'codex/outbox-observer-cost-config-20261103';
const CONFIG_FILES = new Set([
    '.railway/railway.ts',
    'railway.json',
    'scripts/check-outbox-observer-release.js',
    'docs/hermes-railway-outbox-worker.md',
    'docs/OUTBOX_WORKER_CONFIG_MIGRATION.md'
]);
const CONFIG_SHA256 = '2b827430bf38645024fb01385c2807f0a63e195cf7df6056f72e6ebbfd416f3c';
const NORMALIZATION_PARENT = '24cf9503549c40d58672506801f9828f5c94ff28';
const NORMALIZATION_BRANCH = 'codex/outbox-observer-cost-config-normalize-20261103';
const NORMALIZATION_SHA256 = 'd62586a676c62319850b80ac90203781e831c1119303a57b9d7d859b6772012d';
const NORMALIZATION_FILES = new Set(['.railway/railway.ts', 'scripts/check-outbox-observer-release.js']);
const ALLOWED_FILES = new Set([
    '.github/workflows/ci.yml',
    'docs/hermes-railway-outbox-worker.md',
    'package.json',
    'scripts/check-outbox-observer-release.js',
    'scripts/hermes-notification-outbox-worker.js',
    'tests/hermes-notification-outbox-worker.test.js'
]);
const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });

function assertScope(files) {
    assert(files.length > 0, 'Worker candidate has no changes');
    for (const file of files) assert(ALLOWED_FILES.has(file), `Outside worker release scope: ${file}`);
}

function assertConfigScope(files) {
    assert(files.length > 0, 'Configuration candidate has no changes');
    for (const file of files) assert(CONFIG_FILES.has(file), `Outside config migration scope: ${file}`);
}

function assertNormalizationScope(files) {
    assert(files.length > 0, 'Normalization candidate has no changes');
    for (const file of files) assert(NORMALIZATION_FILES.has(file), `Outside config normalization scope: ${file}`);
}

function checkNormalization({ worktree }) {
    git('cat-file', '-e', `${NORMALIZATION_PARENT}^{commit}`);
    const tracked = git('diff', '--name-only', NORMALIZATION_PARENT, ...(worktree ? [] : ['HEAD']));
    const files = [...new Set((tracked + (worktree ? git('ls-files', '--others', '--exclude-standard') : '')).split(/\r?\n/).filter(Boolean))];
    assertNormalizationScope(files);
    assert.equal(fs.existsSync(path.join(ROOT, 'railway.json')), false);
    const digest = require('node:crypto').createHash('sha256').update(read('.railway/railway.ts')).digest('hex');
    assert.equal(digest, NORMALIZATION_SHA256, 'Unreviewed normalization configuration');
    for (const file of ['scripts/hermes-notification-outbox-worker.js', 'package.json', 'package-lock.json', '.github/workflows/ci.yml']) {
        assert.equal(read(file), git('show', `${NORMALIZATION_PARENT}:${file}`).replace(/\r\n/g, '\n'), `Frozen worker/CI file changed: ${file}`);
    }
    return { base: NORMALIZATION_PARENT, files, normalization: true, runtimeAndWorkflowUnchanged: true, configSha256: digest };
}

function checkConfigMigration({ worktree }) {
    git('cat-file', '-e', `${CONFIG_PARENT}^{commit}`);
    const tracked = git('diff', '--name-only', CONFIG_PARENT, ...(worktree ? [] : ['HEAD']));
    const files = [...new Set((tracked + (worktree ? git('ls-files', '--others', '--exclude-standard') : '')).split(/\r?\n/).filter(Boolean))];
    assertConfigScope(files);
    assert.equal(fs.existsSync(path.join(ROOT, 'railway.json')), false, 'Legacy file must be absent from the migration artifact');
    const digest = require('node:crypto').createHash('sha256').update(read('.railway/railway.ts')).digest('hex');
    assert.equal(digest, CONFIG_SHA256, 'Unreviewed IaC configuration');
    for (const file of ['scripts/hermes-notification-outbox-worker.js', 'package.json', 'package-lock.json', '.github/workflows/ci.yml']) {
        assert.equal(read(file), git('show', `${CONFIG_PARENT}:${file}`).replace(/\r\n/g, '\n'), `Frozen worker/CI file changed: ${file}`);
    }
    return { base: CONFIG_PARENT, files, configMigration: true, runtimeAndWorkflowUnchanged: true, configSha256: digest };
}

function check({ worktree = false } = {}) {
    const branch = process.env.GITHUB_REF || git('branch', '--show-current').trim();
    assert(/^(refs\/heads\/)?codex\/outbox-observer-cost-/.test(branch), 'Not an isolated observer release branch');
    if (branch.replace(/^refs\/heads\//, '') === NORMALIZATION_BRANCH) return checkNormalization({ worktree });
    if (branch.replace(/^refs\/heads\//, '') === CONFIG_BRANCH) return checkConfigMigration({ worktree });
    git('cat-file', '-e', `${BASE}^{commit}`);
    const tracked = git('diff', '--name-only', BASE, ...(worktree ? [] : ['HEAD']));
    const files = [...new Set((tracked + (worktree ? git('ls-files', '--others', '--exclude-standard') : '')).split(/\r?\n/).filter(Boolean))];
    assertScope(files);

    const originalWorker = git('show', `${BASE}:scripts/hermes-notification-outbox-worker.js`).replace(/\r\n/g, '\n');
    const candidateWorker = read('scripts/hermes-notification-outbox-worker.js');
    assert.equal(candidateWorker.split('async function runLoop(')[0], originalWorker.split('async function runLoop(')[0], 'Worker routing/send gates changed');
    assert.equal(candidateWorker.slice(candidateWorker.indexOf('async function main(')), originalWorker.slice(originalWorker.indexOf('async function main(')), 'Worker entrypoint/exports changed');
    assert.equal(read('railway.json').trim(), git('show', `${BASE}:railway.json`).replace(/\r\n/g, '\n').trim(), 'Worker configuration changed');

    const originalPackage = JSON.parse(git('show', `${BASE}:package.json`));
    const candidatePackage = JSON.parse(read('package.json'));
    const expectedUnit = originalPackage.scripts['test:unit'].replace('tests/hermes-notification-outbox.test.js', 'tests/hermes-notification-outbox-worker.test.js tests/hermes-notification-outbox.test.js');
    assert.equal(candidatePackage.scripts['test:unit'], expectedUnit, 'Unexpected unit-test command change');
    candidatePackage.scripts['test:unit'] = originalPackage.scripts['test:unit'];
    assert.deepEqual(candidatePackage, originalPackage, 'Package changed outside worker test inclusion');

    const legacyJobs = ['fast-baseline', 'hr-team-browser', 'hr-payroll-postgres'];
    let expectedLegacyWorkflow = git('show', `${BASE}:.github/workflows/ci.yml`).replace(/\r\n/g, '\n');
    for (const job of legacyJobs) {
        expectedLegacyWorkflow = expectedLegacyWorkflow.replace(`  ${job}:\n`, `  ${job}:\n    if: \${{ !startsWith(github.ref, 'refs/heads/codex/outbox-observer-cost-') }}\n`);
    }
    assert.equal(read('.github/workflows/ci.yml').split('\n  outbox-observer:')[0].trimEnd(), expectedLegacyWorkflow.trimEnd(), 'Non-worker CI commands changed');
    return { base: BASE, files, gatesUnchanged: true, nonWorkerChecksUnchanged: true };
}

if (require.main === module) {
    try {
        console.log(JSON.stringify(check({ worktree: process.argv.includes('--worktree') })));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = { assertScope, assertConfigScope, assertNormalizationScope, check };

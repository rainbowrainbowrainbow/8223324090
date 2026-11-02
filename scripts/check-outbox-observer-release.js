'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const BASE = 'bac980a44c2013cc3169b04df04efed05ddf6372';
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

function check({ worktree = false } = {}) {
    const branch = process.env.GITHUB_REF || git('branch', '--show-current').trim();
    assert(/^(refs\/heads\/)?codex\/outbox-observer-cost-/.test(branch), 'Not an isolated observer release branch');
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

module.exports = { assertScope, check };

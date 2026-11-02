'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { requiredMatrix, validateAttempt } = require('../tests/helpers/education-close-evidence');
const contracts = require('../tests/helpers/education-close-contracts.json');

// Balanced using run 40118259177. Preserve all fifteen mandatory pairs.
// Only installation/container startup is shared; native isolation is unchanged.
const SHARDS = {
    'chromium-core': ['teachers/chromium', 'hrLink/chromium', 'groups/chromium', 'series/chromium'],
    'chromium-lifecycle': ['lifecycle/chromium', 'date/chromium', 'async/chromium', 'journal/chromium'],
    'chromium-journey': ['attendance/chromium', 'acceptance/chromium', 'journey/chromium', 'responsive/chromium'],
    'webkit-flow': ['hrLink/webkit', 'journey/webkit'],
    'webkit-responsive': ['responsive/webkit']
};

function getPlan(shards = SHARDS) {
    const pairs = Object.values(shards).flat();
    assert.deepEqual([...pairs].sort(), [...requiredMatrix].sort(), 'Shards must cover the mandatory matrix exactly once');
    return Object.entries(shards).map(([id, entries]) => {
        const engines = new Set(entries.map(entry => entry.split('/')[1]));
        assert.equal(engines.size, 1, 'A shard must use exactly one browser engine');
        return { id, engine: [...engines][0], pairs: [...entries] };
    });
}

function verifyCase(directory, suite, engine, cwd) {
    const attempts = fs.readdirSync(directory, { withFileTypes: true })
        .filter(item => item.isDirectory() && item.name.startsWith('attempt-'));
    assert.equal(attempts.length, 1, 'Exactly one attempt per suite; automatic retry is forbidden');
    const attempt = path.join(directory, attempts[0].name);
    const recordFile = path.join(attempt, 'record.json');
    const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
    assert.equal(record.suite, suite);
    assert.equal(record.engine, engine);
    validateAttempt(record, attempt, contracts[suite], cwd);
    return path.relative(cwd, recordFile).replace(/\\/g, '/');
}

function runShard(id, {
    cwd = path.resolve(__dirname, '..'), env = process.env,
    outputRoot = env.EDU_CLOSE_SHARD_OUTPUT || path.join(cwd, 'output/education-ready/close04', 'shard-' + id),
    spawnSyncImpl = spawnSync, verifyCaseImpl = verifyCase
} = {}) {
    const shard = getPlan().find(item => item.id === id);
    assert.ok(shard, 'Specify a known education shard');
    const root = path.resolve(cwd, outputRoot);
    assert.ok(root.startsWith(path.join(cwd, 'output/education-ready') + path.sep), 'Evidence must stay in education output');
    fs.mkdirSync(root, { recursive: true });
    assert.equal(fs.readdirSync(root).length, 0, 'Use a fresh output directory for a new shard attempt');
    const summary = { schema: 'education-ci-shard-v1', id, engine: shard.engine, status: 'RUNNING',
        cases: shard.pairs.map(pair => ({ pair, status: 'NOT_RUN' })) };
    const save = () => {
        const fd = fs.openSync(path.join(root, 'shard.json'), 'w');
        try { fs.writeFileSync(fd, JSON.stringify(summary, null, 2) + '\n'); fs.fsyncSync(fd); }
        finally { fs.closeSync(fd); }
    };
    save();
    for (const item of summary.cases) {
        const [suite, engine] = item.pair.split('/');
        const directory = path.join(root, 'ci-' + suite + '-' + engine);
        item.status = 'RUNNING'; save();
        try {
            const result = spawnSyncImpl(process.execPath,
                [path.join(cwd, 'tests/integration/run-education-close-ci.js'), suite, engine],
                { cwd, env: { ...env, EDU_CLOSE_OUTPUT: directory }, stdio: 'inherit', shell: false, windowsHide: true });
            assert.ifError(result.error);
            assert.equal(result.signal, null, 'Suite terminated by signal');
            assert.equal(result.status, 0, 'Suite failed or was blocked');
            item.record = verifyCaseImpl(directory, suite, engine, cwd);
            item.status = 'PASS';
        } catch {
            // Never continue after failed checks, uncertain cleanup or missing proof.
            item.status = 'FAIL_OR_BLOCKED'; summary.status = 'FAIL_OR_BLOCKED'; save();
            return 1;
        }
        save();
    }
    summary.status = 'PASS'; save();
    return 0;
}

if (require.main === module) {
    try {
        if (process.argv[2] === '--plan') console.log(JSON.stringify(getPlan(), null, 2));
        else process.exitCode = runShard(process.argv[2]);
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { getPlan, runShard, verifyCase };

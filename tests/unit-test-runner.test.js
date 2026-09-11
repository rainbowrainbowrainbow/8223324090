'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runUnitTests } = require('../scripts/run-unit-tests');

for (const platform of ['win32', 'linux']) {
    test(`unit runner preserves all file arguments and uses the ${platform} concurrency policy`, () => {
        const files = ['tests/first.test.js', 'path with spaces/second.test.js'];
        const calls = [];
        const status = runUnitTests(files, {
            platform,
            spawnSyncImpl: (...args) => { calls.push(args); return { status: 0 }; }
        });
        assert.equal(status, 0);
        assert.equal(calls.length, 1, 'No automatic retries');
        const [binary, args, options] = calls[0];
        assert.equal(binary, process.execPath);
        assert.deepEqual(args, ['--test', ...(platform === 'win32' ? ['--test-concurrency=2'] : []), ...files]);
        assert.equal(options.shell, false);
        assert.equal(options.windowsHide, true);
        assert.equal(options.stdio, 'inherit');
        assert.deepEqual(files, ['tests/first.test.js', 'path with spaces/second.test.js']);
    });
}

test('unit runner rejects an empty list instead of discovering unrelated integration tests', () => {
    const errors = [];
    assert.equal(runUnitTests([], {
        spawnSyncImpl: () => assert.fail('Must not spawn without an explicit list'),
        reportError: message => errors.push(message)
    }), 1);
    assert.equal(errors.length, 1);
});

test('unit runner preserves a nonzero child exit status', () => {
    assert.equal(runUnitTests(['tests/first.test.js'], {
        spawnSyncImpl: () => ({ status: 17 })
    }), 17);
});

test('unit runner fails closed on launch failure, termination or missing status', () => {
    for (const result of [
        { status: null, error: { code: 'ENOENT' } },
        { status: null, signal: 'SIGTERM' },
        { status: null }
    ]) {
        const errors = [];
        assert.equal(runUnitTests(['tests/first.test.js'], {
            spawnSyncImpl: () => result,
            reportError: message => errors.push(message)
        }), 1);
        assert.equal(errors.length, 1);
    }
});

for (const failure of [false, true]) {
    test(`unit runner CLI executes an actual ${failure ? 'failing' : 'passing'} test without masking its result`, () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eventgenix unit runner '));
        const file = path.join(directory, 'probe.test.cjs');
        try {
            fs.writeFileSync(file, `const { test } = require('node:test');
                test('unit runner probe', () => { ${failure ? "throw new Error('expected fixture failure');" : ''} });`);
            // This verifies a separate CLI invocation, not a recursive node:test run.
            const env = { ...process.env };
            delete env.NODE_TEST_CONTEXT;
            const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/run-unit-tests.js'), file], {
                encoding: 'utf8', env, windowsHide: true, shell: false, timeout: 15000
            });
            assert.ifError(result.error);
            assert.equal(result.status, failure ? 1 : 0, result.stderr);
            assert.match(result.stdout, /# tests 1\b/);
            assert.match(result.stdout, failure ? /# fail 1\b/ : /# pass 1\b/);
        } finally {
            if (fs.existsSync(file)) fs.unlinkSync(file);
            fs.rmdirSync(directory);
        }
    });
}

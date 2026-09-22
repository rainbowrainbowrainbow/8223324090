'use strict';

const { spawnSync } = require('node:child_process');

const UNIT_TEST_COMMAND_PREFIX = 'node scripts/run-unit-tests.js ';

function getConfiguredUnitTestArgs(packageJson = require('../package.json')) {
    const command = packageJson.scripts?.['test:unit:files'];
    if (typeof command !== 'string' || !command.startsWith(UNIT_TEST_COMMAND_PREFIX)) {
        throw new Error('package.json must define test:unit:files with the explicit unit test list.');
    }

    const args = command.slice(UNIT_TEST_COMMAND_PREFIX.length).trim().split(/\s+/).filter(Boolean);
    if (args.length === 0) throw new Error('The configured unit test file list is empty.');
    return args;
}

function runUnitTests(args, {
    platform = process.platform,
    spawnSyncImpl = spawnSync,
    reportError = message => console.error(message)
} = {}) {
    if (args.length === 0) {
        reportError('Unit tests require an explicit test file list.');
        return 1;
    }

    // Keep the package's explicit test list and the Linux CI behavior intact.
    const concurrency = platform === 'win32' ? ['--test-concurrency=2'] : [];
    const result = spawnSyncImpl(process.execPath, ['--test', ...concurrency, ...args], {
        stdio: 'inherit',
        shell: false,
        windowsHide: true
    });
    if (result.error || result.signal || !Number.isInteger(result.status)) {
        reportError(`Unit test process did not complete: ${result.error?.code || result.signal || 'missing exit status'}`);
        return 1;
    }
    return result.status;
}

if (require.main === module) {
    let args = process.argv.slice(2);
    if (args.length === 0) {
        try {
            args = getConfiguredUnitTestArgs();
        } catch (error) {
            console.error(error.message);
            process.exitCode = 1;
        }
    }
    if (args.length > 0) process.exitCode = runUnitTests(args);
}

module.exports = { getConfiguredUnitTestArgs, runUnitTests };

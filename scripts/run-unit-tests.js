'use strict';

const { spawnSync } = require('node:child_process');

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

if (require.main === module) process.exitCode = runUnitTests(process.argv.slice(2));

module.exports = { runUnitTests };

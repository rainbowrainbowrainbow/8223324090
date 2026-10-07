'use strict';

const assert = require('node:assert/strict');
const { after } = require('node:test');
const pg = require('pg');

// Load before application modules, or with node --require, in synthetic suites.
// Preserve pg classes/type parsers; injected plain queryables remain unaffected.
const attempts = [];
for (const driverName of ['Pool', 'Client']) {
    for (const operation of ['query', 'connect']) {
        pg[driverName].prototype[operation] = function forbidRealDatabaseAccess() {
            const attemptedOperation = `${driverName}.${operation}`;
            attempts.push(attemptedOperation);
            const error = new Error(`REAL_DATABASE_ACCESS_BLOCKED: ${attemptedOperation}; inject a synthetic queryable`);
            error.code = 'REAL_DATABASE_ACCESS_BLOCKED';
            throw error;
        };
    }
}

// Callers may catch errors; any attempted driver access must still fail the run.
after(() => {
    // Node 22 can report a root after-hook failure without failing an eval process.
    if (attempts.length > 0) process.exitCode = 1;
    assert.deepEqual(attempts, [], 'Real database driver calls are forbidden in synthetic database tests');
});

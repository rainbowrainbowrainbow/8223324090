'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const guardPath = require.resolve('./helpers/forbid-real-db');

function guardedProbe(script) {
    const env = { ...process.env };
    // Run as a standalone test process, not as a child using Node's IPC reporter.
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--require', guardPath, '--eval', script], {
        env,
        encoding: 'utf8',
        timeout: 10000,
        maxBuffer: 128 * 1024
    });
    assert.ifError(result.error);
    return { ...result, output: `${result.stdout}${result.stderr}` };
}

test('database guard preserves synthetic queryables and pg type parsers', () => {
    const result = guardedProbe(`
        const assert = require('node:assert/strict');
        const test = require('node:test');
        const pg = require('pg');
        test('synthetic queryable', async () => {
            const queryable = { async query() { return { rows: [{ staff_id: 11 }] }; } };
            assert.deepEqual(await queryable.query(), { rows: [{ staff_id: 11 }] });
            assert.equal(typeof pg.Pool, 'function');
            assert.equal(typeof pg.Client, 'function');
            assert.equal(pg.types.getTypeParser(23)('11'), 11);
        });
    `);
    assert.equal(result.status, 0, result.output);
});

for (const driverName of ['Pool', 'Client']) {
    for (const operation of ['query', 'connect']) {
        test(`database guard fails the run after caught ${driverName}.${operation}`, () => {
            const result = guardedProbe(`
                const assert = require('node:assert/strict');
                const test = require('node:test');
                const pg = require('pg');
                test('catch forbidden driver access', () => {
                    // Never construct a driver/connection, even if guard installation regresses.
                    const receiver = new Proxy(Object.create(null), {
                        get() { throw new Error('Driver receiver access forbidden in guard self-test'); },
                        set() { throw new Error('Driver receiver access forbidden in guard self-test'); }
                    });
                    assert.throws(
                        () => pg['${driverName}'].prototype['${operation}'].call(receiver),
                        { code: 'REAL_DATABASE_ACCESS_BLOCKED' }
                    );
                });
            `);
            assert.equal(result.status, 1, result.output);
            assert.match(result.output, /Real database driver calls are forbidden in synthetic database tests/);
            assert.ok(result.output.includes(`${driverName}.${operation}`), result.output);
        });
    }
}

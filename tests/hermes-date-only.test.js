'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { describe, it } = require('node:test');

const helperPath = require.resolve('../services/postgresDateOnly');

function runDateOnlyProbe(timeZone) {
    const script = `
        const assert = require('node:assert/strict');
        const { types } = require('pg');
        const { toPostgresDateOnly } = require(${JSON.stringify(helperPath)});
        const parsedPostgresDate = types.getTypeParser(1082, 'text')('2026-07-16');
        assert.equal(toPostgresDateOnly(parsedPostgresDate), '2026-07-16');
        assert.equal(toPostgresDateOnly('2026-07-16'), '2026-07-16');
        process.stdout.write(toPostgresDateOnly(parsedPostgresDate));
    `;
    return execFileSync(process.execPath, ['-e', script], {
        encoding: 'utf8',
        env: { ...process.env, TZ: timeZone }
    });
}

describe('Hermes PostgreSQL DATE-only normalization', () => {
    for (const timeZone of ['UTC', 'Europe/Kyiv']) {
        it(`preserves 2026-07-16 when PostgreSQL parses DATE under TZ=${timeZone}`, () => {
            assert.equal(runDateOnlyProbe(timeZone), '2026-07-16');
        });
    }
});

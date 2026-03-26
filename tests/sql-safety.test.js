/**
 * tests/sql-safety.test.js — SQL safety utilities unit tests (v38.4.0)
 * Tests safeOrderBy, safeTableName, safeSets
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { safeOrderBy, safeTableName, safeSets } = require('../utils/sqlSafe');

describe('safeOrderBy', () => {
    const allowed = {
        date: 'event_date ASC',
        name: 'client_name ASC',
        created: 'created_at DESC'
    };

    it('returns allowed sort clause', () => {
        assert.equal(safeOrderBy('date', allowed, 'id ASC'), 'event_date ASC');
        assert.equal(safeOrderBy('name', allowed, 'id ASC'), 'client_name ASC');
    });

    it('returns default for unknown input', () => {
        assert.equal(safeOrderBy('DROP TABLE', allowed, 'id ASC'), 'id ASC');
        assert.equal(safeOrderBy(undefined, allowed, 'id ASC'), 'id ASC');
        assert.equal(safeOrderBy('', allowed, 'id ASC'), 'id ASC');
    });

    it('rejects SQL injection attempts', () => {
        assert.equal(safeOrderBy("'; DROP TABLE users; --", allowed, 'id ASC'), 'id ASC');
        assert.equal(safeOrderBy('1; DELETE FROM bookings', allowed, 'id ASC'), 'id ASC');
    });
});

describe('safeTableName', () => {
    const tables = new Set(['bookings', 'users', 'staff', 'tasks']);

    it('returns quoted name for allowed table', () => {
        assert.equal(safeTableName('bookings', tables), '"bookings"');
        assert.equal(safeTableName('users', tables), '"users"');
    });

    it('throws for disallowed table', () => {
        assert.throws(() => safeTableName('secrets', tables), {
            message: /not in allowlist/
        });
    });

    it('throws for SQL injection in table name', () => {
        assert.throws(() => safeTableName("bookings; DROP TABLE users", tables));
        assert.throws(() => safeTableName("' OR 1=1 --", tables));
    });

    it('accepts array as allowlist', () => {
        assert.equal(safeTableName('bookings', ['bookings', 'users']), '"bookings"');
    });

    it('throws for empty table name', () => {
        assert.throws(() => safeTableName('', tables));
    });
});

describe('safeSets', () => {
    it('builds SET clause from field definitions', () => {
        const result = safeSets({
            name: { column: 'name', value: 'Test' },
            email: { column: 'email', value: 'test@test.com' }
        }, 1);
        assert.ok(result, 'should return result');
        assert.equal(result.sets.length, 2, 'should have 2 sets');
        assert.ok(result.sets[0].includes('name'), 'should include name column');
        assert.ok(result.sets[1].includes('email'), 'should include email column');
        assert.equal(result.params.length, 2, 'should have 2 params');
        assert.equal(result.params[0], 'Test');
        assert.equal(result.params[1], 'test@test.com');
    });

    it('skips fields with undefined value', () => {
        const result = safeSets({
            name: { column: 'name', value: 'Test' },
            email: { column: 'email', value: undefined }
        }, 1);
        assert.ok(result);
        assert.equal(result.sets.length, 1, 'should have 1 set');
        assert.equal(result.params.length, 1, 'should have 1 param');
    });

    it('returns null when all values undefined', () => {
        const result = safeSets({
            name: { column: 'name', value: undefined },
            email: { column: 'email', value: undefined }
        }, 1);
        assert.equal(result, null);
    });

    it('handles startIdx parameter', () => {
        const result = safeSets({
            name: { column: 'name', value: 'Test' }
        }, 5);
        assert.ok(result.sets[0].includes('$5'), 'should use $5');
        assert.equal(result.nextIdx, 6, 'nextIdx should be 6');
    });

    it('increments parameter indices correctly', () => {
        const result = safeSets({
            a: { column: 'col_a', value: 'A' },
            b: { column: 'col_b', value: 'B' },
            c: { column: 'col_c', value: 'C' }
        }, 3);
        assert.ok(result.sets[0].includes('$3'));
        assert.ok(result.sets[1].includes('$4'));
        assert.ok(result.sets[2].includes('$5'));
        assert.equal(result.nextIdx, 6);
    });
});

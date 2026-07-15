/**
 * tests/backup.test.js — Backup API Tests
 * Run: node --test tests/backup.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Backup', () => {

    it('GET /api/backup/verify — verify backup integrity', async () => {
        const res = await authRequest('GET', '/api/backup/verify');
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(typeof res.data.ok === 'boolean', 'Should return ok flag');
        assert.ok(typeof res.data.tableCount === 'number', 'Should return table count');
        assert.ok(typeof res.data.totalRows === 'number', 'Should return row count');
        assert.equal(res.data.format, 'eventgenix.backup');
        assert.equal(res.data.formatVersion, 2);
    });

    it('GET /api/backup/download — download structured backup', async () => {
        const res = await authRequest('GET', '/api/backup/download');
        assert.equal(res.status, 200);
    });

    it('GET /api/backup/tables — list backup tables', async () => {
        const res = await authRequest('GET', '/api/backup/tables');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.tables), 'Should return tables array');
        assert.ok(res.data.tables.length > 0, 'Should have at least one table');
    });

    it('POST /api/backup/restore — reject without artifact', async () => {
        const res = await authRequest('POST', '/api/backup/restore', {});
        assert.equal(res.status, 400);
    });

    it('POST /api/backup/restore — reject legacy SQL', async () => {
        const res = await authRequest('POST', '/api/backup/restore', {
            sql: 'DROP TABLE users;'
        });
        assert.equal(res.status, 400);
        assert.equal(res.data.error, 'BACKUP_RAW_SQL_FORBIDDEN');
    });

    it('GET /api/backup/download-encrypted — reject without key', async () => {
        const res = await authRequest('GET', '/api/backup/download-encrypted');
        assert.equal(res.status, 400);
    });
});

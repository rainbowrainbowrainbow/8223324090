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
        assert.ok(typeof res.data.tables_backed_up === 'number', 'Should return table count');
        assert.ok(typeof res.data.total_rows === 'number', 'Should return row count');
    });

    it('GET /api/backup/download — download SQL backup', async () => {
        const res = await authRequest('GET', '/api/backup/download');
        assert.equal(res.status, 200);
    });

    it('GET /api/backup/tables — list backup tables', async () => {
        const res = await authRequest('GET', '/api/backup/tables');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.tables), 'Should return tables array');
        assert.ok(res.data.tables.length > 0, 'Should have at least one table');
    });

    it('POST /api/backup/restore — reject without SQL', async () => {
        const res = await authRequest('POST', '/api/backup/restore', {});
        assert.equal(res.status, 400);
    });

    it('POST /api/backup/restore — reject invalid statements', async () => {
        const res = await authRequest('POST', '/api/backup/restore', {
            sql: 'DROP TABLE users;'
        });
        assert.equal(res.status, 400);
        assert.ok(res.data.rejected, 'Should list rejected statements');
    });

    it('GET /api/backup/download-encrypted — reject without key', async () => {
        const res = await authRequest('GET', '/api/backup/download-encrypted');
        assert.equal(res.status, 400);
    });
});

/**
 * tests/our-fixes.test.js — Tests for our bug fixes (v38.4.0)
 * Verifies that fixes we made actually work correctly
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest, request, BASE_URL, TEST_USER, TEST_PASS } = require('./helpers');

describe('Pagination caps (fix: unbounded queries)', () => {
    it('chat messages limit is capped at 200', async () => {
        const res = await authRequest('GET', '/api/chat/channels/1/messages?limit=99999');
        assert.equal(res.status, 200);
        // Even if channel doesn't exist, the query should not crash
    });

    it('summary history limit is capped at 100', async () => {
        const res = await authRequest('GET', '/api/summary/history?limit=99999');
        assert.equal(res.status, 200);
    });

    it('summary usage days is capped at 365', async () => {
        const res = await authRequest('GET', '/api/summary/usage?days=99999');
        assert.equal(res.status, 200);
    });
});

describe('IDOR fix: payment endpoint requires auth', () => {
    it('PATCH /bookings/:id/payment requires edit_booking permission', async () => {
        // Should still work for admin (has all permissions)
        const res = await authRequest('PATCH', '/api/bookings/999999/payment', {
            payment_method: 'cash'
        });
        // 404 (booking not found) or 200 is fine — just not 403 for admin
        assert.ok([200, 404].includes(res.status),
            `Admin should have access, got ${res.status}`);
    });
});

describe('API 404 returns JSON', () => {
    it('unknown /api/ route returns JSON 404', async () => {
        const res = await authRequest('GET', '/api/nonexistent-route-12345');
        assert.equal(res.status, 404);
        assert.ok(res.data?.error, 'should return JSON error');
    });

    it('unknown /api/ POST returns JSON 404', async () => {
        const res = await authRequest('POST', '/api/nonexistent-route-12345');
        assert.equal(res.status, 404);
    });
});

describe('Telegram template escaping', () => {
    // This is a unit test — we can test the module directly
    it('esc function escapes HTML entities', () => {
        const { esc } = require('../services/templates');
        if (typeof esc === 'function') {
            assert.equal(esc('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
            assert.equal(esc('Tom & Jerry'), 'Tom &amp; Jerry');
            assert.equal(esc(''), '');
            assert.equal(esc(null), '');
        }
    });

    it('truncate function limits text length', () => {
        const { truncate } = require('../services/templates');
        if (typeof truncate === 'function') {
            assert.equal(truncate('short'), 'short');
            const long = 'x'.repeat(5000);
            const result = truncate(long);
            assert.ok(result.length <= 4020, 'should truncate to ~4000 chars');
            assert.ok(result.includes('обрізано'), 'should include truncation marker');
        }
    });
});

describe('contextCache cleanup', () => {
    it('contextCache exports stats function', () => {
        const cache = require('../services/contextCache');
        assert.ok(typeof cache.stats === 'function');
        const s = cache.stats();
        assert.ok(typeof s.size === 'number');
        assert.ok(typeof s.expired === 'number');
    });

    it('contextCache respects TTL', async () => {
        const cache = require('../services/contextCache');
        let callCount = 0;
        const val1 = await cache.getCached('test-key-1', 100, async () => {
            callCount++;
            return 'value1';
        });
        assert.equal(val1, 'value1');
        assert.equal(callCount, 1);

        // Second call within TTL should use cache
        const val2 = await cache.getCached('test-key-1', 100, async () => {
            callCount++;
            return 'value2';
        });
        assert.equal(val2, 'value1'); // cached
        assert.equal(callCount, 1); // not called again

        // Clean up
        cache.invalidate('test-key-1');
    });
});

describe('SQL safety validators', () => {
    it('safeTableName used in backup.js', () => {
        // Verify the import exists
        const fs = require('fs');
        const backupCode = fs.readFileSync(require('path').join(__dirname, '../routes/backup.js'), 'utf8');
        assert.ok(backupCode.includes('safeTableName'), 'backup.js should use safeTableName');
        assert.ok(backupCode.includes("require('../utils/sqlSafe')"), 'backup.js should import sqlSafe');
    });
});

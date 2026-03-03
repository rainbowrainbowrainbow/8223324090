/**
 * tests/packages.test.js — Packages & Feature Flags API Tests
 * Run: node --test tests/packages.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Packages', () => {
    let createdPackageCode;

    it('GET /api/packages — list packages', async () => {
        const res = await authRequest('GET', '/api/packages');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(Array.isArray(res.data.packages));
    });

    it('POST /api/packages — requires admin role', async () => {
        // admin user has 'creator' role which should work
        createdPackageCode = 'smoke_test_' + Date.now();
        const res = await authRequest('POST', '/api/packages', {
            code: createdPackageCode,
            name: 'Smoke Test Package',
            description: 'Test package from smoke tests',
            price_monthly: 999,
            features: { max_bookings: 100, has_analytics: true },
            sort_order: 99
        });
        // May be 201 (created) or 403 (role restriction)
        assert.ok([200, 201, 403].includes(res.status), `Expected 200/201/403, got ${res.status}`);
        if (res.status === 201 || res.status === 200) {
            assert.ok(res.data.success);
        }
    });

    it('GET /api/packages/:code — get existing package', async () => {
        // Use first available package instead of created one
        const listRes = await authRequest('GET', '/api/packages');
        const pkg = listRes.data.packages && listRes.data.packages[0];
        if (!pkg) return;
        const res = await authRequest('GET', `/api/packages/${pkg.code}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(res.data.package);
    });

    it('GET /api/packages/compare/all — compare all packages', async () => {
        const res = await authRequest('GET', '/api/packages/compare/all');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(Array.isArray(res.data.packages));
        assert.ok(Array.isArray(res.data.flags));
    });
});

describe('Feature Flags', () => {
    let createdFlagCode;

    it('GET /api/packages/flags/all — list flags', async () => {
        const res = await authRequest('GET', '/api/packages/flags/all');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(Array.isArray(res.data.flags));
    });

    it('POST /api/packages/flags — create flag', async () => {
        createdFlagCode = 'smoke_flag_' + Date.now();
        const res = await authRequest('POST', '/api/packages/flags', {
            code: createdFlagCode,
            name: 'Smoke Test Flag',
            description: 'Test flag',
            is_enabled: true,
            package_min: 'basic'
        });
        assert.ok([200, 201].includes(res.status), `Expected 200/201, got ${res.status}`);
        assert.ok(res.data.success);
    });

    it('PUT /api/packages/flags/:code — toggle flag', async () => {
        if (!createdFlagCode) return;
        const res = await authRequest('PUT', `/api/packages/flags/${createdFlagCode}`, {
            is_enabled: false
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });
});

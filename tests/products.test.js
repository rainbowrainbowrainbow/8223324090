/**
 * tests/products.test.js — Products API Tests
 * Run: node --test tests/products.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Products', () => {
    let createdProductId;

    // ==========================================
    // CREATE
    // ==========================================

    it('POST /api/products — create product', async () => {
        const res = await authRequest('POST', '/api/products', {
            code: 'SMOKE',
            timelineCode: 'SMK01',
            label: 'Smoke Test',
            name: 'Smoke Test Program',
            category: 'test',
            duration: 60,
            price: 1000,
            hosts: 1
        });
        assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.id, 'Should return product with id');
        assert.equal(res.data.timelineCode, 'SMK01');
        createdProductId = res.data.id;
    });

    it('POST /api/products — reject without required fields', async () => {
        const res = await authRequest('POST', '/api/products', {
            code: 'BAD'
        });
        assert.equal(res.status, 400);
    });

    // ==========================================
    // READ
    // ==========================================

    it('GET /api/products — list all products', async () => {
        const res = await authRequest('GET', '/api/products');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data), 'Should return array');
    });

    it('GET /api/products?active=true — filter active only', async () => {
        const res = await authRequest('GET', '/api/products?active=true');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('GET /api/products/:id — get single product', async () => {
        assert.ok(createdProductId, 'Need created product id');
        const res = await authRequest('GET', `/api/products/${createdProductId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.id);
    });

    it('GET /api/products/nonexistent — 404', async () => {
        const res = await authRequest('GET', '/api/products/nonexistent_999');
        assert.equal(res.status, 404);
    });

    // ==========================================
    // UPDATE
    // ==========================================

    it('PUT /api/products/:id — update product', async () => {
        assert.ok(createdProductId, 'Need created product id');
        const res = await authRequest('PUT', `/api/products/${createdProductId}`, {
            code: 'SMOKE',
            timelineCode: 'SMK01',
            label: 'Updated Smoke',
            name: 'Updated Smoke Program',
            category: 'test',
            duration: 90,
            price: 1500,
            hosts: 2
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.id);
        assert.equal(res.data.timelineCode, 'SMK01');
    });

    it('POST /api/products — rejects a timeline code containing duration', async () => {
        const res = await authRequest('POST', '/api/products', {
            code: 'SMOKEDURATION',
            timelineCode: '60хв',
            label: 'Smoke Duration Code',
            name: 'Smoke Duration Code Program',
            category: 'test',
            duration: 60,
            price: 1000,
            hosts: 1
        });
        assert.equal(res.status, 400);
        assert.match(String(res.data?.error || ''), /timelineCode must not contain duration/);
    });

    it('POST /api/products — rejects category-prefixed timeline code', async () => {
        const res = await authRequest('POST', '/api/products', {
            code: 'SMOKEPREFIX',
            timelineCode: 'МК РЕС',
            label: 'Smoke Prefix Code',
            name: 'Smoke Prefix Code Program',
            category: 'masterclass',
            duration: 60,
            price: 1000,
            hosts: 1
        });
        assert.equal(res.status, 400);
        assert.match(String(res.data?.error || ''), /without category prefix/);
    });

    it('POST /api/products — accepts one-character product timeline code', async () => {
        const res = await authRequest('POST', '/api/products', {
            code: 'SMOKEONE',
            timelineCode: '7',
            label: 'Smoke One Code',
            name: 'Smoke One Code Program',
            category: 'test',
            duration: 60,
            price: 1000,
            hosts: 1
        });
        assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.equal(res.data.timelineCode, '7');
        await authRequest('DELETE', `/api/products/${res.data.id}`);
    });

    it('GET /api/bookings/:date — resolves current catalog timeline code for old bookings and null for missing products', async () => {
        const date = '2099-12-02';
        const lineId = 'timeline_code_product_test';
        const bookingIds = [];

        await authRequest('POST', `/api/lines/${date}`, [
            { id: lineId, name: 'Timeline Code Product Test', color: '#6D28D9' }
        ]);

        try {
            const catalogBooking = await authRequest('POST', '/api/bookings', {
                date,
                time: '12:00',
                lineId,
                room: 'Марвел',
                programId: createdProductId,
                programCode: 'SMOKE',
                programName: 'Updated Smoke Program',
                label: 'Updated Smoke',
                duration: 60,
                price: 1500,
                category: 'test',
                status: 'confirmed'
            });
            assert.equal(catalogBooking.status, 200, JSON.stringify(catalogBooking.data));
            bookingIds.push(catalogBooking.data.booking.id);

            const missingProductBooking = await authRequest('POST', '/api/bookings', {
                date,
                time: '13:30',
                lineId,
                room: 'Марвел',
                programCode: 'LEGACY',
                programName: 'Legacy Product Missing',
                label: 'Legacy Product',
                duration: 30,
                price: 0,
                category: 'custom',
                status: 'confirmed'
            });
            assert.equal(missingProductBooking.status, 200, JSON.stringify(missingProductBooking.data));
            bookingIds.push(missingProductBooking.data.booking.id);

            const catalogUpdate = await authRequest('PUT', `/api/products/${createdProductId}`, {
                code: 'SMOKE',
                timelineCode: 'SMK02',
                label: 'Updated Smoke',
                name: 'Updated Smoke Program',
                category: 'test',
                duration: 90,
                price: 1500,
                hosts: 2
            });
            assert.equal(catalogUpdate.status, 200, JSON.stringify(catalogUpdate.data));

            const day = await authRequest('GET', `/api/bookings/${date}`);
            assert.equal(day.status, 200, JSON.stringify(day.data));
            const oldBooking = day.data.find(item => item.id === catalogBooking.data.booking.id);
            const fallbackBooking = day.data.find(item => item.id === missingProductBooking.data.booking.id);
            assert.equal(oldBooking?.timelineCode, 'SMK02');
            assert.equal(fallbackBooking?.timelineCode, null);
        } finally {
            for (const bookingId of bookingIds) {
                await authRequest('DELETE', `/api/bookings/${bookingId}?permanent=true`);
            }
        }
    });

    it('POST /api/products — rejects duplicate active timeline code in a domain', async () => {
        const res = await authRequest('POST', '/api/products', {
            code: 'SMOKE2',
            timelineCode: 'SMK02',
            label: 'Smoke Conflict',
            name: 'Different Smoke Program',
            category: 'test',
            duration: 60,
            price: 1000,
            hosts: 1
        });
        assert.equal(res.status, 409);
        assert.equal(res.data.code, 'PRODUCT_TIMELINE_CODE_CONFLICT');
    });

    // ==========================================
    // DELETE (soft)
    // ==========================================

    it('DELETE /api/products/:id — deactivate product', async () => {
        assert.ok(createdProductId, 'Need created product id');
        const res = await authRequest('DELETE', `/api/products/${createdProductId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });
});

/**
 * tests/wallet-shop.test.js — Tests for wallet, shop, minigame, and booking validation
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Wallet', () => {
    it('GET /wallet — returns wallet data', async () => {
        const res = await authRequest('GET', '/api/wallet');
        assert.equal(res.status, 200);
        assert.ok(typeof res.data.coins === 'number', 'should have coins');
    });

    it('GET /wallet/history — returns transactions', async () => {
        const res = await authRequest('GET', '/api/wallet/history');
        assert.equal(res.status, 200);
    });
});

describe('Shop', () => {
    it('GET /shop — list items', async () => {
        const res = await authRequest('GET', '/api/shop');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data), 'should return array');
    });

    it('GET /shop/inventory — user inventory', async () => {
        const res = await authRequest('GET', '/api/shop/inventory');
        assert.equal(res.status, 200);
    });

    it('POST /shop/buy with invalid item — returns error', async () => {
        const res = await authRequest('POST', '/api/shop/buy', { itemId: 999999 });
        assert.ok([200, 400, 404].includes(res.status));
        if (res.status === 200) {
            assert.ok(!res.data.success, 'should not succeed with invalid item');
        }
    });
});

describe('Minigame', () => {
    it('GET /minigame/status — game status', async () => {
        const res = await authRequest('GET', '/api/minigame/status');
        assert.equal(res.status, 200);
    });

    it('POST /minigame/complete — complete game', async () => {
        const res = await authRequest('POST', '/api/minigame/complete', {
            score: 100, level: 1, moves: 50
        });
        assert.ok([200, 400, 429].includes(res.status));
    });

    it('GET /minigame/daily-records — returns daily records', async () => {
        const res = await authRequest('GET', '/api/minigame/daily-records');
        assert.equal(res.status, 200);
    });
});

describe('Booking validation', () => {
    it('reject midnight-spanning booking', async () => {
        const res = await authRequest('POST', '/api/bookings', {
            date: '2099-06-15', time: '23:00', duration: 120,
            lineId: 1, programId: 1, programCode: 'TEST',
            programName: 'Test', label: 'Test', room: 'Test'
        });
        assert.ok([400, 409].includes(res.status), `Expected 400 or 409: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.error, 'should have error message');
    });

    it('accept valid booking within same day', async () => {
        const res = await authRequest('POST', '/api/bookings', {
            date: '2099-12-25', time: '09:00', duration: 60,
            lineId: 1, programId: 1, programCode: 'XMAS',
            programName: 'Xmas Test', label: 'Xmas', room: 'Зал VIP'
        });
        assert.ok([200, 409].includes(res.status), `Expected 200 or 409: ${JSON.stringify(res.data)}`);
    });

    it('reject invalid booking status on update', async () => {
        const create = await authRequest('POST', '/api/bookings', {
            date: '2099-06-16', time: '10:00', duration: 60,
            lineId: 1, programId: 1, programCode: 'TEST',
            programName: 'Test', label: 'Test', room: 'Зал 1'
        });
        if (create.status === 200 && create.data?.id) {
            const update = await authRequest('PUT', `/api/bookings/${create.data.id}`, {
                date: '2099-06-16', time: '10:00', duration: 60,
                lineId: 1, programId: 1, programCode: 'TEST',
                programName: 'Test', label: 'Test', room: 'Зал 1',
                status: 'hacked_status'
            });
            assert.equal(update.status, 200);
            if (update.data?.status) {
                assert.notEqual(update.data.status, 'hacked_status');
            }
        }
    });
});

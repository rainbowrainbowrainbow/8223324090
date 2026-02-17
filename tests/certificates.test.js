/**
 * tests/certificates.test.js — Certificate API Tests
 * Run: node --test tests/certificates.test.js
 * Env: TEST_URL, TEST_USER, TEST_PASS
 *
 * Requires a running server with a valid test user in the database.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { request, authRequest, getToken } = require('./helpers');

// ==========================================
// POST /api/certificates — Create single
// ==========================================

describe('POST /api/certificates — Create single', () => {
    const createdIds = [];

    after(async () => {
        for (const id of createdIds) {
            await authRequest('DELETE', `/api/certificates/${id}`).catch(() => {});
        }
    });

    it('POST /api/certificates — create with all valid fields → 201', async () => {
        const res = await authRequest('POST', '/api/certificates', {
            displayMode: 'fio',
            displayValue: 'Тестова Дитина',
            typeText: 'на одноразовий вхід',
            validUntil: '2099-12-31',
            notes: 'smoke test',
            season: 'winter'
        });
        assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.id, 'Should have id');
        assert.ok(res.data.certCode, 'Should have certCode');
        assert.ok(res.data.displayMode, 'Should have displayMode');
        assert.ok(res.data.hasOwnProperty('displayValue'), 'Should have displayValue');
        assert.ok(res.data.typeText, 'Should have typeText');
        assert.ok(res.data.validUntil, 'Should have validUntil');
        assert.ok(res.data.status, 'Should have status');
        assert.ok(res.data.season, 'Should have season');
        assert.equal(res.data.status, 'active');
        assert.match(res.data.certCode, /^CERT-\d{4}-\d{5}$/);
        assert.equal(res.data.displayValue, 'Тестова Дитина');
        assert.equal(res.data.season, 'winter');
        createdIds.push(res.data.id);
    });

    it('POST /api/certificates — create with minimal fields (defaults applied) → 201', async () => {
        const res = await authRequest('POST', '/api/certificates', {});
        assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.equal(res.data.displayMode, 'fio');
        assert.equal(res.data.displayValue, '');
        assert.equal(res.data.typeText, 'на одноразовий вхід');
        assert.ok(res.data.validUntil, 'validUntil should be set (auto-calculated)');
        assert.ok(['winter', 'spring', 'summer', 'autumn'].includes(res.data.season), `Season should be valid, got ${res.data.season}`);
        assert.equal(res.data.status, 'active');
        createdIds.push(res.data.id);
    });

    it('POST /api/certificates — create with displayMode number → 201', async () => {
        const res = await authRequest('POST', '/api/certificates', {
            displayMode: 'number',
            displayValue: '12345'
        });
        assert.equal(res.status, 201);
        assert.equal(res.data.displayMode, 'number');
        createdIds.push(res.data.id);
    });

    it('POST /api/certificates — invalid displayMode → 400', async () => {
        const res = await authRequest('POST', '/api/certificates', {
            displayMode: 'invalid_mode'
        });
        assert.equal(res.status, 400);
        assert.ok(res.data.error.includes('displayMode'), `Error should mention displayMode, got: ${res.data.error}`);
    });

    it('POST /api/certificates — displayValue too long (>200 chars) → 400', async () => {
        const res = await authRequest('POST', '/api/certificates', {
            displayValue: 'x'.repeat(201)
        });
        assert.equal(res.status, 400);
        assert.ok(res.data.error.includes('displayValue'), `Error should mention displayValue, got: ${res.data.error}`);
    });

    it('POST /api/certificates — typeText too long (>200 chars) → 400', async () => {
        const res = await authRequest('POST', '/api/certificates', {
            typeText: 'x'.repeat(201)
        });
        assert.equal(res.status, 400);
        assert.ok(res.data.error.includes('typeText'), `Error should mention typeText, got: ${res.data.error}`);
    });

    it('POST /api/certificates — invalid validUntil date format → 400', async () => {
        const res = await authRequest('POST', '/api/certificates', {
            validUntil: 'not-a-date'
        });
        assert.equal(res.status, 400);
        assert.ok(res.data.error.includes('validUntil'), `Error should mention validUntil, got: ${res.data.error}`);
    });

    it('POST /api/certificates — explicit season → 201', async () => {
        const res = await authRequest('POST', '/api/certificates', {
            season: 'summer'
        });
        assert.equal(res.status, 201);
        assert.equal(res.data.season, 'summer');
        createdIds.push(res.data.id);
    });

    it('POST /api/certificates — invalid season falls back to auto-detection → 201', async () => {
        const res = await authRequest('POST', '/api/certificates', {
            season: 'invalid_season'
        });
        assert.equal(res.status, 201);
        assert.ok(
            ['winter', 'spring', 'summer', 'autumn'].includes(res.data.season),
            `Season should be auto-detected valid season, got: ${res.data.season}`
        );
        createdIds.push(res.data.id);
    });

    it('POST /api/certificates — history entry recorded on create', async () => {
        const createRes = await authRequest('POST', '/api/certificates', {
            displayValue: 'Історія Тест',
            validUntil: '2099-12-31'
        });
        assert.equal(createRes.status, 201);
        createdIds.push(createRes.data.id);

        const historyRes = await authRequest('GET', '/api/history?action=certificate_create');
        assert.equal(historyRes.status, 200);
        const found = historyRes.data.items.find(h =>
            h.data && h.data.certCode === createRes.data.certCode
        );
        assert.ok(found, 'History should contain entry with the cert code');
    });

    it('POST /api/certificates — created certificate has issuedByName set', async () => {
        const res = await authRequest('POST', '/api/certificates', {
            validUntil: '2099-12-31'
        });
        assert.equal(res.status, 201);
        assert.ok(res.data.issuedByName, 'issuedByName should be set');
        createdIds.push(res.data.id);
    });
});

// ==========================================
// POST /api/certificates/batch — Batch generate
// ==========================================

describe('POST /api/certificates/batch — Batch generate', () => {
    const createdIds = [];

    after(async () => {
        for (const id of createdIds) {
            await authRequest('DELETE', `/api/certificates/${id}`).catch(() => {});
        }
    });

    it('POST /api/certificates/batch — batch of 5 → 201', async () => {
        const res = await authRequest('POST', '/api/certificates/batch', { quantity: 5 });
        assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.equal(res.data.success, true);
        assert.equal(res.data.certificates.length, 5);
        for (const cert of res.data.certificates) {
            assert.equal(cert.status, 'active');
            assert.match(cert.certCode, /^CERT-\d{4}-\d{5}$/);
            createdIds.push(cert.id);
        }
    });

    it('POST /api/certificates/batch — batch of 10 → 201', async () => {
        const res = await authRequest('POST', '/api/certificates/batch', { quantity: 10 });
        assert.equal(res.status, 201);
        assert.equal(res.data.certificates.length, 10);
        for (const cert of res.data.certificates) {
            createdIds.push(cert.id);
        }
    });

    it('POST /api/certificates/batch — batch of 15 → 201', async () => {
        const res = await authRequest('POST', '/api/certificates/batch', { quantity: 15 });
        assert.equal(res.status, 201);
        assert.equal(res.data.certificates.length, 15);
        for (const cert of res.data.certificates) {
            createdIds.push(cert.id);
        }
    });

    it('POST /api/certificates/batch — batch of 20 → 201', async () => {
        const res = await authRequest('POST', '/api/certificates/batch', { quantity: 20 });
        assert.equal(res.status, 201);
        assert.equal(res.data.certificates.length, 20);
        for (const cert of res.data.certificates) {
            createdIds.push(cert.id);
        }
    });

    it('POST /api/certificates/batch — all generated codes are unique', async () => {
        const res = await authRequest('POST', '/api/certificates/batch', { quantity: 20 });
        assert.equal(res.status, 201);
        const codes = res.data.certificates.map(c => c.certCode);
        const uniqueCodes = new Set(codes);
        assert.equal(uniqueCodes.size, codes.length, 'All cert codes should be unique');
        for (const cert of res.data.certificates) {
            createdIds.push(cert.id);
        }
    });

    it('POST /api/certificates/batch — invalid count 0 → 400', async () => {
        const res = await authRequest('POST', '/api/certificates/batch', { quantity: 0 });
        assert.equal(res.status, 400);
    });

    it('POST /api/certificates/batch — invalid count 3 → 400', async () => {
        const res = await authRequest('POST', '/api/certificates/batch', { quantity: 3 });
        assert.equal(res.status, 400);
    });

    it('POST /api/certificates/batch — invalid count 25 → 400', async () => {
        const res = await authRequest('POST', '/api/certificates/batch', { quantity: 25 });
        assert.equal(res.status, 400);
    });

    it('POST /api/certificates/batch — negative count → 400', async () => {
        const res = await authRequest('POST', '/api/certificates/batch', { quantity: -5 });
        assert.equal(res.status, 400);
    });

    it('POST /api/certificates/batch — non-number count → 400', async () => {
        const res = await authRequest('POST', '/api/certificates/batch', { quantity: 'abc' });
        assert.equal(res.status, 400);
    });

    it('POST /api/certificates/batch — respects custom typeText', async () => {
        const res = await authRequest('POST', '/api/certificates/batch', {
            quantity: 5,
            typeText: 'VIP пропуск'
        });
        assert.equal(res.status, 201);
        for (const cert of res.data.certificates) {
            assert.equal(cert.typeText, 'VIP пропуск');
            createdIds.push(cert.id);
        }
    });

    it('POST /api/certificates/batch — respects custom season', async () => {
        const res = await authRequest('POST', '/api/certificates/batch', {
            quantity: 5,
            season: 'autumn'
        });
        assert.equal(res.status, 201);
        for (const cert of res.data.certificates) {
            assert.equal(cert.season, 'autumn');
            createdIds.push(cert.id);
        }
    });

    it('POST /api/certificates/batch — notes contain batch info', async () => {
        const res = await authRequest('POST', '/api/certificates/batch', { quantity: 5 });
        assert.equal(res.status, 201);
        for (const cert of res.data.certificates) {
            assert.ok(
                cert.notes && cert.notes.includes('Пакетна генерація'),
                `Notes should contain batch info, got: ${cert.notes}`
            );
            createdIds.push(cert.id);
        }
    });

    it('POST /api/certificates/batch — history entry recorded', async () => {
        const res = await authRequest('POST', '/api/certificates/batch', { quantity: 5 });
        assert.equal(res.status, 201);
        for (const cert of res.data.certificates) {
            createdIds.push(cert.id);
        }

        const historyRes = await authRequest('GET', '/api/history?action=certificate_batch');
        assert.equal(historyRes.status, 200);
        assert.ok(historyRes.data.items.length > 0, 'History should have batch entries');
    });
});

// ==========================================
// GET /api/certificates — List with filters
// ==========================================

describe('GET /api/certificates — List with filters', () => {
    const createdIds = [];
    let searchCertCode = '';
    let searchCertId = null;

    before(async () => {
        // Create a few certificates for testing list/filter/search
        const res1 = await authRequest('POST', '/api/certificates', {
            displayValue: 'Тестовий Пошук',
            validUntil: '2099-12-31',
            season: 'winter'
        });
        if (res1.status === 201) {
            createdIds.push(res1.data.id);
            searchCertCode = res1.data.certCode;
            searchCertId = res1.data.id;
        }

        const res2 = await authRequest('POST', '/api/certificates', {
            displayValue: 'Другий Тестовий',
            validUntil: '2099-12-31',
            season: 'summer'
        });
        if (res2.status === 201) {
            createdIds.push(res2.data.id);
        }
    });

    after(async () => {
        for (const id of createdIds) {
            await authRequest('DELETE', `/api/certificates/${id}`).catch(() => {});
        }
    });

    it('GET /api/certificates — list all returns object with items and total', async () => {
        const res = await authRequest('GET', '/api/certificates');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.items), 'items should be an array');
        assert.equal(typeof res.data.total, 'number', 'total should be a number');
        assert.ok(res.data.total >= res.data.items.length, 'total >= items.length');
    });

    it('GET /api/certificates — filter by status active', async () => {
        const res = await authRequest('GET', '/api/certificates?status=active');
        assert.equal(res.status, 200);
        for (const item of res.data.items) {
            assert.equal(item.status, 'active', `All items should be active, got: ${item.status}`);
        }
    });

    it('GET /api/certificates — filter by status used', async () => {
        // Create a cert and mark as used
        const createRes = await authRequest('POST', '/api/certificates', { validUntil: '2099-12-31' });
        assert.equal(createRes.status, 201);
        createdIds.push(createRes.data.id);

        const patchRes = await authRequest('PATCH', `/api/certificates/${createRes.data.id}/status`, { status: 'used' });
        assert.equal(patchRes.status, 200);

        const res = await authRequest('GET', '/api/certificates?status=used');
        assert.equal(res.status, 200);
        for (const item of res.data.items) {
            assert.equal(item.status, 'used');
        }
    });

    it('GET /api/certificates — filter by status revoked', async () => {
        const res = await authRequest('GET', '/api/certificates?status=revoked');
        assert.equal(res.status, 200);
        for (const item of res.data.items) {
            assert.equal(item.status, 'revoked');
        }
    });

    it('GET /api/certificates — filter by status blocked', async () => {
        const res = await authRequest('GET', '/api/certificates?status=blocked');
        assert.equal(res.status, 200);
        for (const item of res.data.items) {
            assert.equal(item.status, 'blocked');
        }
    });

    it('GET /api/certificates — filter by status expired', async () => {
        const res = await authRequest('GET', '/api/certificates?status=expired');
        assert.equal(res.status, 200);
        for (const item of res.data.items) {
            assert.equal(item.status, 'expired');
        }
    });

    it('GET /api/certificates — search by cert_code', async () => {
        const res = await authRequest('GET', `/api/certificates?search=${searchCertCode}`);
        assert.equal(res.status, 200);
        const found = res.data.items.find(i => i.certCode === searchCertCode);
        assert.ok(found, `Results should contain certificate with code ${searchCertCode}`);
    });

    it('GET /api/certificates — search by displayValue (name)', async () => {
        const res = await authRequest('GET', '/api/certificates?search=Тестовий');
        assert.equal(res.status, 200);
        const found = res.data.items.find(i => i.id === searchCertId);
        assert.ok(found, 'Results should contain the test certificate');
    });

    it('GET /api/certificates — pagination limit', async () => {
        const res = await authRequest('GET', '/api/certificates?limit=2');
        assert.equal(res.status, 200);
        assert.ok(res.data.items.length <= 2, `Items should be <= 2, got ${res.data.items.length}`);
    });

    it('GET /api/certificates — pagination offset', async () => {
        const res1 = await authRequest('GET', '/api/certificates?limit=1&offset=0');
        const res2 = await authRequest('GET', '/api/certificates?limit=1&offset=1');
        assert.equal(res1.status, 200);
        assert.equal(res2.status, 200);
        if (res1.data.items.length > 0 && res2.data.items.length > 0) {
            assert.notEqual(
                res1.data.items[0].id,
                res2.data.items[0].id,
                'Offset results should be different items'
            );
        }
    });

    it('GET /api/certificates — limit capped at 500', async () => {
        const res = await authRequest('GET', '/api/certificates?limit=999');
        assert.equal(res.status, 200);
        assert.ok(res.data.items.length <= 500, `Items should be <= 500, got ${res.data.items.length}`);
    });

    it('GET /api/certificates — default limit is 100', async () => {
        const res = await authRequest('GET', '/api/certificates');
        assert.equal(res.status, 200);
        assert.ok(res.data.items.length <= 100, `Items should be <= 100, got ${res.data.items.length}`);
    });

    it('GET /api/certificates — items ordered by created_at DESC', async () => {
        const res = await authRequest('GET', '/api/certificates');
        assert.equal(res.status, 200);
        if (res.data.items.length >= 2) {
            const first = new Date(res.data.items[0].createdAt).getTime();
            const second = new Date(res.data.items[1].createdAt).getTime();
            assert.ok(first >= second, 'First item createdAt should be >= second item createdAt');
        }
    });
});

// ==========================================
// GET /api/certificates/:id — Single get
// ==========================================

describe('GET /api/certificates/:id — Single get', () => {
    const createdIds = [];

    after(async () => {
        for (const id of createdIds) {
            await authRequest('DELETE', `/api/certificates/${id}`).catch(() => {});
        }
    });

    it('GET /api/certificates/:id — existing certificate returns 200 with full data', async () => {
        const createRes = await authRequest('POST', '/api/certificates', {
            displayValue: 'Повний Тест',
            validUntil: '2099-12-31',
            season: 'winter'
        });
        assert.equal(createRes.status, 201);
        createdIds.push(createRes.data.id);

        const res = await authRequest('GET', `/api/certificates/${createRes.data.id}`);
        assert.equal(res.status, 200);

        // Check all mapped fields
        const fields = [
            'id', 'certCode', 'displayMode', 'displayValue', 'typeText',
            'issuedAt', 'validUntil', 'issuedByUserId', 'issuedByName',
            'status', 'usedAt', 'invalidatedAt', 'invalidReason', 'notes',
            'season', 'telegramAlertSent', 'createdAt', 'updatedAt'
        ];
        for (const field of fields) {
            assert.ok(res.data.hasOwnProperty(field), `Response should have field: ${field}`);
        }
    });

    it('GET /api/certificates/:id — non-existent returns 404', async () => {
        const res = await authRequest('GET', '/api/certificates/999999');
        assert.equal(res.status, 404);
        assert.equal(res.data.error, 'Certificate not found');
    });

    it('GET /api/certificates/:id — invalid ID format returns 404 or 500', async () => {
        const res = await authRequest('GET', '/api/certificates/not-a-number');
        assert.ok([404, 500].includes(res.status), `Expected 404 or 500, got ${res.status}`);
    });
});

// ==========================================
// GET /api/certificates/code/:code — Find by code
// ==========================================

describe('GET /api/certificates/code/:code — Find by code', () => {
    const createdIds = [];
    let testCertCode = '';

    before(async () => {
        const res = await authRequest('POST', '/api/certificates', {
            displayValue: 'Код Тест',
            validUntil: '2099-12-31'
        });
        if (res.status === 201) {
            createdIds.push(res.data.id);
            testCertCode = res.data.certCode;
        }
    });

    after(async () => {
        for (const id of createdIds) {
            await authRequest('DELETE', `/api/certificates/${id}`).catch(() => {});
        }
    });

    it('GET /api/certificates/code/:code — valid code returns certificate', async () => {
        const res = await authRequest('GET', `/api/certificates/code/${testCertCode}`);
        assert.equal(res.status, 200);
        assert.equal(res.data.certCode, testCertCode);

        // Check expected fields
        assert.ok(res.data.hasOwnProperty('id'), 'Should have id');
        assert.ok(res.data.hasOwnProperty('displayMode'), 'Should have displayMode');
        assert.ok(res.data.hasOwnProperty('status'), 'Should have status');
    });

    it('GET /api/certificates/code/:code — case-insensitive lookup', async () => {
        const lowerCode = testCertCode.toLowerCase();
        const res = await authRequest('GET', `/api/certificates/code/${lowerCode}`);
        assert.equal(res.status, 200, `Lowercase code lookup should work, got ${res.status}`);
    });

    it('GET /api/certificates/code/:code — non-existent code returns 404', async () => {
        const res = await authRequest('GET', '/api/certificates/code/CERT-0000-00000');
        assert.equal(res.status, 404);
        assert.equal(res.data.error, 'Certificate not found');
    });

    it('GET /api/certificates/code/:code — code with whitespace is trimmed', async () => {
        // URL-encode spaces around the code
        const codeWithSpaces = encodeURIComponent(` ${testCertCode} `);
        const res = await authRequest('GET', `/api/certificates/code/${codeWithSpaces}`);
        assert.equal(res.status, 200, `Trimmed code lookup should work, got ${res.status}`);
    });
});

// ==========================================
// GET /api/certificates/qr/:code — QR generation
// ==========================================

describe('GET /api/certificates/qr/:code — QR generation', () => {
    const createdIds = [];
    let testCertCode = '';

    before(async () => {
        const res = await authRequest('POST', '/api/certificates', {
            displayValue: 'QR Тест',
            validUntil: '2099-12-31'
        });
        if (res.status === 201) {
            createdIds.push(res.data.id);
            testCertCode = res.data.certCode;
        }
    });

    after(async () => {
        for (const id of createdIds) {
            await authRequest('DELETE', `/api/certificates/${id}`).catch(() => {});
        }
    });

    it('GET /api/certificates/qr/:code — QR generation for valid code', async () => {
        const res = await authRequest('GET', `/api/certificates/qr/${testCertCode}`);
        // 200 if bot configured, 500 if not
        assert.ok([200, 500].includes(res.status), `Expected 200 or 500, got ${res.status}`);
        if (res.status === 200) {
            assert.ok(res.data.dataUrl.startsWith('data:image/png;base64,'), 'dataUrl should be base64 PNG');
            assert.ok(res.data.deepLink.startsWith('https://t.me/'), 'deepLink should start with https://t.me/');
            assert.equal(res.data.certCode, testCertCode);
        }
    });

    it('GET /api/certificates/qr/:code — non-existent code returns 404', async () => {
        const res = await authRequest('GET', '/api/certificates/qr/CERT-0000-00000');
        assert.equal(res.status, 404);
    });

    it('GET /api/certificates/qr/:code — bot not configured returns 500', async () => {
        // In test env without TELEGRAM_BOT_TOKEN, this should return 500
        const res = await authRequest('GET', `/api/certificates/qr/${testCertCode}`);
        if (res.status === 500) {
            assert.ok(res.data.error, 'Should have error message');
        }
        // If 200, bot is configured — test still passes
        assert.ok([200, 500].includes(res.status), `Expected 200 or 500, got ${res.status}`);
    });
});

// ==========================================
// PUT /api/certificates/:id — Update
// ==========================================

describe('PUT /api/certificates/:id — Update', () => {
    const createdIds = [];
    let testCertId = null;

    before(async () => {
        const res = await authRequest('POST', '/api/certificates', {
            displayValue: 'Оригінальне Ім\'я',
            typeText: 'на одноразовий вхід',
            validUntil: '2099-12-31',
            notes: 'Оригінальні нотатки'
        });
        if (res.status === 201) {
            createdIds.push(res.data.id);
            testCertId = res.data.id;
        }
    });

    after(async () => {
        for (const id of createdIds) {
            await authRequest('DELETE', `/api/certificates/${id}`).catch(() => {});
        }
    });

    it('PUT /api/certificates/:id — update displayValue', async () => {
        const res = await authRequest('PUT', `/api/certificates/${testCertId}`, {
            displayValue: 'Новий Отримувач'
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.displayValue, 'Новий Отримувач');
    });

    it('PUT /api/certificates/:id — update typeText', async () => {
        const res = await authRequest('PUT', `/api/certificates/${testCertId}`, {
            typeText: 'VIP доступ на 3 дні'
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.typeText, 'VIP доступ на 3 дні');
    });

    it('PUT /api/certificates/:id — update notes', async () => {
        const res = await authRequest('PUT', `/api/certificates/${testCertId}`, {
            notes: 'Оновлені нотатки'
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.notes, 'Оновлені нотатки');
    });

    it('PUT /api/certificates/:id — update validUntil', async () => {
        const res = await authRequest('PUT', `/api/certificates/${testCertId}`, {
            validUntil: '2099-06-30'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.validUntil, 'validUntil should be set');
    });

    it('PUT /api/certificates/:id — non-existent returns 404', async () => {
        const res = await authRequest('PUT', '/api/certificates/999999', {
            displayValue: 'Не існує'
        });
        assert.equal(res.status, 404);
    });

    it('PUT /api/certificates/:id — history entry recorded for edit', async () => {
        const editRes = await authRequest('PUT', `/api/certificates/${testCertId}`, {
            displayValue: 'Історія Редагування'
        });
        assert.equal(editRes.status, 200);

        const historyRes = await authRequest('GET', '/api/history?action=certificate_edit');
        assert.equal(historyRes.status, 200);
        assert.ok(historyRes.data.items.length > 0, 'History should have edit entries');
    });
});

// ==========================================
// PATCH /api/certificates/:id/status — Status transitions
// ==========================================

describe('PATCH /api/certificates/:id/status — Status transitions', () => {
    const createdIds = [];

    // Helper: create a fresh active certificate for each test that needs one
    async function createActiveCert() {
        const res = await authRequest('POST', '/api/certificates', {
            displayValue: 'Статус Тест',
            validUntil: '2099-12-31'
        });
        assert.equal(res.status, 201);
        createdIds.push(res.data.id);
        return res.data;
    }

    after(async () => {
        for (const id of createdIds) {
            await authRequest('DELETE', `/api/certificates/${id}`).catch(() => {});
        }
    });

    it('PATCH /api/certificates/:id/status — active → used → 200', async () => {
        const cert = await createActiveCert();
        const res = await authRequest('PATCH', `/api/certificates/${cert.id}/status`, {
            status: 'used'
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.status, 'used');
        assert.ok(res.data.usedAt, 'usedAt should be set');
    });

    it('PATCH /api/certificates/:id/status — active → revoked (with reason) → 200', async () => {
        const cert = await createActiveCert();
        const res = await authRequest('PATCH', `/api/certificates/${cert.id}/status`, {
            status: 'revoked',
            reason: 'Помилка видачі'
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.status, 'revoked');
        assert.ok(res.data.invalidatedAt, 'invalidatedAt should be set');
        assert.equal(res.data.invalidReason, 'Помилка видачі');
    });

    it('PATCH /api/certificates/:id/status — active → blocked (with reason) → 200', async () => {
        const cert = await createActiveCert();
        const res = await authRequest('PATCH', `/api/certificates/${cert.id}/status`, {
            status: 'blocked',
            reason: 'Підозра на шахрайство'
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.status, 'blocked');
        assert.ok(res.data.invalidatedAt, 'invalidatedAt should be set');
        assert.equal(res.data.invalidReason, 'Підозра на шахрайство');
    });

    it('PATCH /api/certificates/:id/status — active → expired → 200', async () => {
        const cert = await createActiveCert();
        const res = await authRequest('PATCH', `/api/certificates/${cert.id}/status`, {
            status: 'expired'
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.status, 'expired');
    });

    it('PATCH /api/certificates/:id/status — used → used (one-time use check) → 400', async () => {
        const cert = await createActiveCert();
        // First mark as used
        const firstRes = await authRequest('PATCH', `/api/certificates/${cert.id}/status`, {
            status: 'used'
        });
        assert.equal(firstRes.status, 200);

        // Try to mark as used again
        const secondRes = await authRequest('PATCH', `/api/certificates/${cert.id}/status`, {
            status: 'used'
        });
        assert.equal(secondRes.status, 400);
        assert.ok(
            secondRes.data.error.includes('вже використаний'),
            `Error should mention already used, got: ${secondRes.data.error}`
        );
    });

    it('PATCH /api/certificates/:id/status — expired → anything → 400', async () => {
        const cert = await createActiveCert();
        // First mark as expired
        await authRequest('PATCH', `/api/certificates/${cert.id}/status`, { status: 'expired' });

        // Try to change from expired
        const res = await authRequest('PATCH', `/api/certificates/${cert.id}/status`, {
            status: 'used'
        });
        assert.equal(res.status, 400);
        assert.ok(
            res.data.error.includes('прострочений'),
            `Error should mention expired, got: ${res.data.error}`
        );
    });

    it('PATCH /api/certificates/:id/status — invalid status value → 400', async () => {
        const cert = await createActiveCert();
        const res = await authRequest('PATCH', `/api/certificates/${cert.id}/status`, {
            status: 'invalid_status'
        });
        assert.equal(res.status, 400);
        assert.ok(res.data.error, 'Should have error message');
    });

    it('PATCH /api/certificates/:id/status — missing status field → 400', async () => {
        const cert = await createActiveCert();
        const res = await authRequest('PATCH', `/api/certificates/${cert.id}/status`, {});
        assert.equal(res.status, 400);
    });

    it('PATCH /api/certificates/:id/status — status change with reason text', async () => {
        const cert = await createActiveCert();
        const res = await authRequest('PATCH', `/api/certificates/${cert.id}/status`, {
            status: 'revoked',
            reason: 'Тестова причина'
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.invalidReason, 'Тестова причина');
    });

    it('PATCH /api/certificates/:id/status — status change without reason', async () => {
        const cert = await createActiveCert();
        const res = await authRequest('PATCH', `/api/certificates/${cert.id}/status`, {
            status: 'blocked'
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.invalidReason, null);
    });

    it('PATCH /api/certificates/:id/status — non-existent certificate → 404', async () => {
        const res = await authRequest('PATCH', '/api/certificates/999999/status', {
            status: 'used'
        });
        assert.equal(res.status, 404);
    });

    it('PATCH /api/certificates/:id/status — history entry recorded for status change', async () => {
        const cert = await createActiveCert();
        await authRequest('PATCH', `/api/certificates/${cert.id}/status`, { status: 'used' });

        const historyRes = await authRequest('GET', '/api/history?action=certificate_used');
        assert.equal(historyRes.status, 200);
        const found = historyRes.data.items.find(h =>
            h.data && h.data.certCode === cert.certCode
        );
        assert.ok(found, 'History should contain entry with the cert code');
    });
});

// ==========================================
// DELETE /api/certificates/:id — Delete
// ==========================================

describe('DELETE /api/certificates/:id — Delete', () => {
    it('DELETE /api/certificates/:id — delete existing certificate', async () => {
        const createRes = await authRequest('POST', '/api/certificates', {
            displayValue: 'Видалити',
            validUntil: '2099-12-31'
        });
        assert.equal(createRes.status, 201);
        const certId = createRes.data.id;

        const deleteRes = await authRequest('DELETE', `/api/certificates/${certId}`);
        assert.equal(deleteRes.status, 200);
        assert.equal(deleteRes.data.success, true);

        // Verify deleted
        const getRes = await authRequest('GET', `/api/certificates/${certId}`);
        assert.equal(getRes.status, 404);
    });

    it('DELETE /api/certificates/:id — non-existent returns 404', async () => {
        const res = await authRequest('DELETE', '/api/certificates/999999');
        assert.equal(res.status, 404);
    });

    it('DELETE /api/certificates/:id — history entry recorded for delete', async () => {
        const createRes = await authRequest('POST', '/api/certificates', {
            displayValue: 'Історія Видалення',
            validUntil: '2099-12-31'
        });
        assert.equal(createRes.status, 201);
        const certId = createRes.data.id;

        await authRequest('DELETE', `/api/certificates/${certId}`);

        const historyRes = await authRequest('GET', '/api/history?action=certificate_delete');
        assert.equal(historyRes.status, 200);
        assert.ok(historyRes.data.items.length > 0, 'History should have delete entries');
    });
});

// ==========================================
// POST /api/certificates/:id/send-image — Telegram
// ==========================================

describe('POST /api/certificates/:id/send-image — Telegram image', () => {
    const createdIds = [];

    after(async () => {
        for (const id of createdIds) {
            await authRequest('DELETE', `/api/certificates/${id}`).catch(() => {});
        }
    });

    it('POST /api/certificates/:id/send-image — missing imageBase64 → 400', async () => {
        const createRes = await authRequest('POST', '/api/certificates', { validUntil: '2099-12-31' });
        assert.equal(createRes.status, 201);
        createdIds.push(createRes.data.id);

        const res = await authRequest('POST', `/api/certificates/${createRes.data.id}/send-image`, {});
        assert.equal(res.status, 400);
        assert.equal(res.data.error, 'imageBase64 is required');
    });

    it('POST /api/certificates/:id/send-image — non-existent certificate → 404', async () => {
        const res = await authRequest('POST', '/api/certificates/999999/send-image', {
            imageBase64: 'dGVzdA=='
        });
        assert.equal(res.status, 404);
    });

    it('POST /api/certificates/:id/send-image — Telegram chat not configured → 400 or 500', async () => {
        const createRes = await authRequest('POST', '/api/certificates', { validUntil: '2099-12-31' });
        assert.equal(createRes.status, 201);
        createdIds.push(createRes.data.id);

        const res = await authRequest('POST', `/api/certificates/${createRes.data.id}/send-image`, {
            imageBase64: 'dGVzdA=='
        });
        // 400 if chat not configured, 500 if Telegram fails
        assert.ok(
            [400, 500].includes(res.status),
            `Expected 400 or 500, got ${res.status}`
        );
    });
});

// ==========================================
// AUTH — Unauthenticated access
// ==========================================

describe('Auth — Unauthenticated access to certificates', () => {
    it('GET /api/certificates — without token → 401', async () => {
        const res = await request('GET', '/api/certificates');
        assert.equal(res.status, 401);
    });

    it('GET /api/certificates/:id — without token → 401', async () => {
        const res = await request('GET', '/api/certificates/1');
        assert.equal(res.status, 401);
    });

    it('GET /api/certificates/code/:code — without token → 401', async () => {
        const res = await request('GET', '/api/certificates/code/CERT-2026-00001');
        assert.equal(res.status, 401);
    });

    it('GET /api/certificates/qr/:code — without token → 401', async () => {
        const res = await request('GET', '/api/certificates/qr/CERT-2026-00001');
        assert.equal(res.status, 401);
    });

    it('POST /api/certificates — without token → 401', async () => {
        const res = await request('POST', '/api/certificates', {});
        assert.equal(res.status, 401);
    });

    it('POST /api/certificates/batch — without token → 401', async () => {
        const res = await request('POST', '/api/certificates/batch', { quantity: 5 });
        assert.equal(res.status, 401);
    });

    it('PATCH /api/certificates/:id/status — without token → 401', async () => {
        const res = await request('PATCH', '/api/certificates/1/status', { status: 'used' });
        assert.equal(res.status, 401);
    });

    it('PUT /api/certificates/:id — without token → 401', async () => {
        const res = await request('PUT', '/api/certificates/1', {});
        assert.equal(res.status, 401);
    });

    it('DELETE /api/certificates/:id — without token → 401', async () => {
        const res = await request('DELETE', '/api/certificates/1');
        assert.equal(res.status, 401);
    });

    it('POST /api/certificates/:id/send-image — without token → 401', async () => {
        const res = await request('POST', '/api/certificates/1/send-image', {});
        assert.equal(res.status, 401);
    });
});

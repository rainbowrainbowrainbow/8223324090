/**
 * tests/customers.test.js — Customers CRM API Tests
 * Run: node --test tests/customers.test.js
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Customers', () => {
    let createdCustomerId;
    let createdTagId;
    let birthdaySystemTagsSupported = null;
    const smokeTagName = `Smoke Tag ${Date.now()}`;
    const smokeTagColor = '#0F766E';
    const createTagName = 'VIP';
    const updateTagName = 'Постійний';
    const BIRTHDAY_TAG_KEY = 'birthday';
    const BIRTHDAY_MAY_TAG_KEY = 'birthday_month_05';
    const BIRTHDAY_JULY_TAG_KEY = 'birthday_month_07';
    const BIRTHDAY_AUGUST_TAG_KEY = 'birthday_month_08';

    function tagSystemKeys(tags = []) {
        return new Set((Array.isArray(tags) ? tags : [])
            .map(tag => tag.systemKey || tag.system_key || null)
            .filter(Boolean));
    }

    async function ensureBirthdaySystemTagsSupported(t) {
        if (birthdaySystemTagsSupported === null) {
            const res = await authRequest('GET', '/api/customers/tags');
            assert.equal(res.status, 200);
            birthdaySystemTagsSupported = Boolean(res.data.capabilities?.systemTags);
        }
        if (!birthdaySystemTagsSupported) {
            t.skip('customer_tags system columns are missing; run TAGS-06 migration to enable birthday API lifecycle assertions');
            return false;
        }
        return true;
    }

    function assertBirthdaySystemTags(tags, expectedMonthKey) {
        const keys = tagSystemKeys(tags);
        assert.ok(keys.has(BIRTHDAY_TAG_KEY), 'Should include base birthday system tag');
        assert.ok(keys.has(expectedMonthKey), `Should include ${expectedMonthKey}`);
        for (const tag of tags.filter(item => (item.systemKey || item.system_key || '').startsWith('birthday'))) {
            assert.equal(tag.source, 'system', `Birthday tag ${tag.tag} should be marked as system`);
        }
    }

    function assertNoBirthdaySystemTags(tags) {
        const keys = tagSystemKeys(tags);
        assert.ok(![...keys].some(key => key === BIRTHDAY_TAG_KEY || key.startsWith('birthday_month_')), 'Should not include birthday system tags');
    }

    // ==========================================
    // CREATE
    // ==========================================

    it('POST /api/customers — create customer', async () => {
        const res = await authRequest('POST', '/api/customers', {
            name: 'Тест Клієнт Smoke',
            phone: '+380997778899',
            instagram: '@test_smoke',
            childName: 'Данило',
            childBirthday: '2019-05-20',
            source: 'instagram',
            notes: 'smoke test customer',
            tags: [{ tag: createTagName, color: '#F59E0B' }]
        });
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.id, 'Should return customer with id');
        assert.ok(Array.isArray(res.data.tags), 'Should return tags array');
        assert.ok(res.data.tags.some(tag => tag.tag === createTagName), 'Should create customer with selected tag');
        createdCustomerId = res.data.id;
    });

    it('POST /api/customers — reject without name', async () => {
        const res = await authRequest('POST', '/api/customers', {
            phone: '+380997778899'
        });
        assert.ok([400, 500].includes(res.status), `Expected 400 or 500, got ${res.status}`);
    });

    // ==========================================
    // LIST & SEARCH
    // ==========================================

    it('GET /api/customers — list with pagination', async () => {
        const res = await authRequest('GET', '/api/customers?page=1&limit=5');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.customers), 'Should return customers array');
        assert.ok(typeof res.data.total === 'number', 'Should return total');
        assert.ok(typeof res.data.page === 'number', 'Should return page');
        assert.ok(typeof res.data.pages === 'number', 'Should return pages');
    });

    it('GET /api/customers?search=Smoke — search by name', async () => {
        const res = await authRequest('GET', '/api/customers?search=Smoke');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.customers));
    });

    it('GET /api/customers?source=instagram — filter by source', async () => {
        const res = await authRequest('GET', '/api/customers?source=instagram');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.customers));
    });

    it('GET /api/customers?sortBy=total_spent — sort by spending', async () => {
        const res = await authRequest('GET', '/api/customers?sortBy=total_spent');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.customers));
    });

    it('GET /api/customers/search?q=Тест — quick search', async () => {
        const res = await authRequest('GET', '/api/customers/search?q=Тест');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data), 'Should return array');
    });

    it('GET /api/customers/search?q=X — short query still works', async () => {
        const res = await authRequest('GET', '/api/customers/search?q=X');
        // min 2 chars required, may return 400 or empty array
        assert.ok([200, 400].includes(res.status));
    });

    // ==========================================
    // GET BY ID
    // ==========================================

    it('GET /api/customers/:id — get customer details', async () => {
        assert.ok(createdCustomerId, 'Need created customer id');
        const res = await authRequest('GET', `/api/customers/${createdCustomerId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.id, 'Should return customer');
        assert.ok(Array.isArray(res.data.bookings), 'Should include bookings');
        assert.ok(Array.isArray(res.data.certificates), 'Should include certificates');
        assert.ok(Array.isArray(res.data.tags), 'Should include tags array');
        assert.ok(res.data.tags.some(tag => tag.tag === createTagName), 'Should include tag saved from create questionnaire');
    });

    it('POST /api/customers — syncs birthday system tags on create', async (t) => {
        assert.ok(createdCustomerId, 'Need created customer id');
        if (!(await ensureBirthdaySystemTagsSupported(t))) return;

        const res = await authRequest('GET', `/api/customers/${createdCustomerId}`);
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.tags), 'Should include tags array');
        assertBirthdaySystemTags(res.data.tags, BIRTHDAY_MAY_TAG_KEY);
    });

    it('GET /api/customers/99999 — non-existent', async () => {
        const res = await authRequest('GET', '/api/customers/99999');
        assert.ok([404, 500].includes(res.status));
    });

    // ==========================================
    // TAGS
    // ==========================================

    it('GET /api/customers/tags — list tag catalog', async () => {
        const res = await authRequest('GET', '/api/customers/tags');
        assert.equal(res.status, 200);
        assert.equal(res.data.success, true);
        assert.ok(Array.isArray(res.data.tags), 'Should return current tag rows');
        assert.ok(Array.isArray(res.data.predefined), 'Should return predefined tag catalog');
        assert.equal(typeof res.data.capabilities?.systemTags, 'boolean', 'Should expose system tag capability flag');
        birthdaySystemTagsSupported = res.data.capabilities.systemTags;
    });

    it('POST /api/customers/:id/tags — add manual tag', async () => {
        assert.ok(createdCustomerId, 'Need created customer id');
        const res = await authRequest('POST', `/api/customers/${createdCustomerId}/tags`, {
            tag: smokeTagName,
            color: smokeTagColor
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.success, true);
        assert.ok(res.data.tag?.id, 'Should return created tag id');
        assert.equal(res.data.tag.tag, smokeTagName);
        assert.equal(res.data.tag.color, smokeTagColor);
        createdTagId = res.data.tag.id;
    });

    it('POST /api/customers/:id/tags — duplicate manual tag is soft success', async () => {
        assert.ok(createdCustomerId, 'Need created customer id');
        const res = await authRequest('POST', `/api/customers/${createdCustomerId}/tags`, {
            tag: smokeTagName,
            color: smokeTagColor
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.success, true);
        assert.ok(typeof res.data.message === 'string' && res.data.message.length > 0, 'Should return duplicate message');
        assert.equal(res.data.tag, undefined, 'Should not return a new tag row for duplicate');
    });

    it('GET /api/customers/:id — returns manual tags', async () => {
        assert.ok(createdCustomerId, 'Need created customer id');
        const res = await authRequest('GET', `/api/customers/${createdCustomerId}`);
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.tags), 'Should include tags array');
        assert.ok(res.data.tags.some(tag => tag.id === createdTagId && tag.tag === smokeTagName), 'Should include created manual tag');
    });

    it('GET /api/customers?tag=... — filters customers by manual tag', async () => {
        assert.ok(createdCustomerId, 'Need created customer id');
        const res = await authRequest('GET', `/api/customers?tag=${encodeURIComponent(smokeTagName)}`);
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.customers), 'Should return customers array');
        const taggedCustomer = res.data.customers.find(customer => customer.id === createdCustomerId);
        assert.ok(taggedCustomer, 'Should include customer with requested tag');
        assert.ok(Array.isArray(taggedCustomer.tags), 'Filtered list item should include tags array');
        assert.ok(taggedCustomer.tags.some(tag => tag.tag === smokeTagName), 'Filtered list item should include requested tag');
    });

    it('DELETE /api/customers/:id/tags/:tagId — remove manual tag', async () => {
        assert.ok(createdCustomerId, 'Need created customer id');
        assert.ok(createdTagId, 'Need created tag id');
        const res = await authRequest('DELETE', `/api/customers/${createdCustomerId}/tags/${createdTagId}`);
        assert.equal(res.status, 200);
        assert.equal(res.data.success, true);

        const details = await authRequest('GET', `/api/customers/${createdCustomerId}`);
        assert.equal(details.status, 200);
        assert.ok(Array.isArray(details.data.tags), 'Should include tags array after delete');
        assert.ok(!details.data.tags.some(tag => tag.id === createdTagId || tag.tag === smokeTagName), 'Should remove deleted manual tag');
    });

    // ==========================================
    // UPDATE
    // ==========================================

    it('PUT /api/customers/:id — update customer', async () => {
        assert.ok(createdCustomerId, 'Need created customer id');
        const res = await authRequest('PUT', `/api/customers/${createdCustomerId}`, {
            name: 'Тест Клієнт Оновлено',
            phone: '+380997778800',
            instagram: '@test_updated',
            childName: 'Данило',
            childBirthday: '2019-07-20',
            source: 'website',
            tags: [{ tag: updateTagName, color: '#8B5CF6' }]
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.id, 'Should return updated customer');
        assert.ok(Array.isArray(res.data.tags), 'Should return updated tags array');
        assert.ok(res.data.tags.some(tag => tag.tag === updateTagName), 'Should add tag from edit questionnaire');
        assert.ok(!res.data.tags.some(tag => tag.tag === createTagName), 'Should remove tag deleted in edit questionnaire');
    });

    it('PUT /api/customers/:id — updates birthday system tags when birthday month changes', async (t) => {
        assert.ok(createdCustomerId, 'Need created customer id');
        if (!(await ensureBirthdaySystemTagsSupported(t))) return;

        const res = await authRequest('PUT', `/api/customers/${createdCustomerId}`, {
            name: 'Smoke Birthday August',
            phone: '+380997778800',
            instagram: '@test_updated',
            childName: 'Birthday Kid',
            childBirthday: '2019-08-20',
            source: 'website',
            tags: [{ tag: updateTagName, color: '#8B5CF6' }]
        });
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.tags), 'Should return updated tags array');
        assertBirthdaySystemTags(res.data.tags, BIRTHDAY_AUGUST_TAG_KEY);
        const keys = tagSystemKeys(res.data.tags);
        assert.ok(!keys.has(BIRTHDAY_MAY_TAG_KEY), 'Should remove old May birthday month tag');
        assert.ok(!keys.has(BIRTHDAY_JULY_TAG_KEY), 'Should remove old July birthday month tag');
    });

    it('PUT /api/customers/:id — clears birthday system tags when birthday is cleared', async (t) => {
        assert.ok(createdCustomerId, 'Need created customer id');
        if (!(await ensureBirthdaySystemTagsSupported(t))) return;

        const res = await authRequest('PUT', `/api/customers/${createdCustomerId}`, {
            name: 'Smoke Birthday Cleared',
            phone: '+380997778800',
            instagram: '@test_updated',
            childName: 'Birthday Kid',
            childBirthday: null,
            source: 'website',
            tags: [{ tag: updateTagName, color: '#8B5CF6' }]
        });
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.tags), 'Should return updated tags array');
        assertNoBirthdaySystemTags(res.data.tags);
        assert.ok(res.data.tags.some(tag => tag.tag === updateTagName), 'Should preserve manual tag while clearing birthday tags');
    });

    it('PUT /api/customers/:id — legacy update without tags preserves manual tags', async () => {
        assert.ok(createdCustomerId, 'Need created customer id');
        const res = await authRequest('PUT', `/api/customers/${createdCustomerId}`, {
            name: 'Тест Клієнт Legacy Update',
            phone: '+380997778801',
            instagram: '@test_legacy_update',
            childName: 'Данило',
            source: 'website'
        });
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.tags), 'Should return existing tags array');
        assert.ok(res.data.tags.some(tag => tag.tag === updateTagName), 'Should preserve tags when tags payload is omitted');
    });

    // ==========================================
    // RFM ANALYSIS
    // ==========================================

    it('GET /api/customers/rfm — RFM segmentation', async () => {
        const res = await authRequest('GET', '/api/customers/rfm');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.customers), 'Should return customers');
        assert.ok(res.data.segments, 'Should return segments');
        assert.ok(typeof res.data.total === 'number', 'Should return total');
    });

    // ==========================================
    // STATS
    // ==========================================

    it('GET /api/customers/stats — customer statistics', async () => {
        const res = await authRequest('GET', '/api/customers/stats');
        assert.equal(res.status, 200);
        assert.ok(typeof res.data.total === 'number', 'Should return total');
        assert.ok(Array.isArray(res.data.bySource), 'Should return bySource');
        assert.ok(Array.isArray(res.data.topBySpent), 'Should return topBySpent');
    });

    // ==========================================
    // DELETE
    // ==========================================

    it('DELETE /api/customers/:id — delete customer', async () => {
        assert.ok(createdCustomerId, 'Need created customer id');
        const res = await authRequest('DELETE', `/api/customers/${createdCustomerId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success, 'Should return success');
    });
});

/**
 * tests/leads.test.js — Leads API Tests
 * Run: node --test tests/leads.test.js
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Leads', () => {
    let createdLeadId;

    // ==========================================
    // CREATE
    // ==========================================

    it('POST /api/leads — create lead', async () => {
        const res = await authRequest('POST', '/api/leads', {
            client_name: 'Тест Лід Smoke',
            phone: '+380991112233',
            source: 'instagram',
            notes: 'smoke test lead',
            children_count: 2,
            child_age: '5',
            event_date: '2099-06-15'
        });
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.success, 'Should return success');
        assert.ok(res.data.lead, 'Should return lead object');
        assert.ok(res.data.lead.id, 'Lead should have an id');
        createdLeadId = res.data.lead.id;
    });

    it('POST /api/leads — reject without client_name', async () => {
        const res = await authRequest('POST', '/api/leads', {
            phone: '+380991112233'
        });
        assert.ok([400, 500].includes(res.status), `Expected 400 or 500, got ${res.status}`);
    });

    // ==========================================
    // READ
    // ==========================================

    it('GET /api/leads — list leads', async () => {
        const res = await authRequest('GET', '/api/leads');
        assert.equal(res.status, 200);
        assert.ok(res.data.success, 'Should return success');
        assert.ok(Array.isArray(res.data.leads), 'Should return leads array');
    });

    it('GET /api/leads?status=new — filter by status', async () => {
        const res = await authRequest('GET', '/api/leads?status=new');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.leads));
        for (const lead of res.data.leads) {
            assert.equal(lead.status, 'new', 'All leads should have status=new');
        }
    });

    it('GET /api/leads?search=Smoke — search leads', async () => {
        const res = await authRequest('GET', '/api/leads?search=Smoke');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.leads));
    });

    it('GET /api/leads?source=instagram — filter by source', async () => {
        const res = await authRequest('GET', '/api/leads?source=instagram');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.leads));
    });

    it('GET /api/leads?limit=2 — limit results', async () => {
        const res = await authRequest('GET', '/api/leads?limit=2');
        assert.equal(res.status, 200);
        assert.ok(res.data.leads.length <= 2, 'Should respect limit');
    });

    // ==========================================
    // HOT LEADS
    // ==========================================

    it('GET /api/leads/hot — hot leads', async () => {
        const res = await authRequest('GET', '/api/leads/hot');
        assert.equal(res.status, 200);
        assert.ok(res.data.success, 'Should return success');
        assert.ok(Array.isArray(res.data.leads), 'Should return leads array');
    });

    // ==========================================
    // STATS
    // ==========================================

    it('GET /api/leads/stats — lead statistics', async () => {
        const res = await authRequest('GET', '/api/leads/stats');
        assert.equal(res.status, 200);
        assert.ok(res.data.success, 'Should return success');
        assert.ok(res.data.stats, 'Should return stats object');
        assert.ok(typeof res.data.total === 'number', 'Should return total count');
    });

    // ==========================================
    // UPDATE
    // ==========================================

    it('PATCH /api/leads/:id — update lead', async () => {
        assert.ok(createdLeadId, 'Need created lead id');
        const res = await authRequest('PATCH', `/api/leads/${createdLeadId}`, {
            status: 'contacted',
            notes: 'Updated via smoke test'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success, 'Should return success');
        assert.ok(res.data.lead, 'Should return updated lead');
    });

    it('PATCH /api/leads/:id — update client_name', async () => {
        assert.ok(createdLeadId, 'Need created lead id');
        const res = await authRequest('PATCH', `/api/leads/${createdLeadId}`, {
            client_name: 'Тест Лід Оновлено'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.lead);
    });

    it('PATCH /api/leads/99999 — non-existent lead', async () => {
        const res = await authRequest('PATCH', '/api/leads/99999', {
            status: 'contacted'
        });
        assert.ok([404, 500].includes(res.status), `Expected 404/500, got ${res.status}`);
    });

    // ==========================================
    // DELETE
    // ==========================================

    it('DELETE /api/leads/:id — delete lead', async () => {
        assert.ok(createdLeadId, 'Need created lead id');
        const res = await authRequest('DELETE', `/api/leads/${createdLeadId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success, 'Should return success');
    });

    it('DELETE /api/leads/99999 — non-existent lead', async () => {
        const res = await authRequest('DELETE', '/api/leads/99999');
        assert.ok([404, 200].includes(res.status));
    });
});

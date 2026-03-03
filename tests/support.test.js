/**
 * tests/support.test.js — Support & SLA API Tests
 * Run: node --test tests/support.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Support', () => {
    let createdTicketId;

    it('POST /api/support/tickets — create ticket', async () => {
        const res = await authRequest('POST', '/api/support/tickets', {
            subject: 'Smoke Test Ticket',
            description: 'Test ticket for smoke tests',
            category: 'general',
            priority: 'medium'
        });
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.success);
        assert.ok(res.data.ticket);
        assert.ok(res.data.ticket.ticket_number);
        createdTicketId = res.data.ticket.id;
    });

    it('POST /api/support/tickets — reject without subject', async () => {
        const res = await authRequest('POST', '/api/support/tickets', {
            description: 'Missing subject'
        });
        assert.equal(res.status, 400);
    });

    it('GET /api/support/tickets — list tickets', async () => {
        const res = await authRequest('GET', '/api/support/tickets');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('GET /api/support/tickets/:id — single ticket', async () => {
        assert.ok(createdTicketId, 'Need created ticket id');
        const res = await authRequest('GET', `/api/support/tickets/${createdTicketId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.ticket_number);
        assert.ok(Array.isArray(res.data.messages));
    });

    it('POST /api/support/tickets/:id/messages — add message', async () => {
        assert.ok(createdTicketId, 'Need created ticket id');
        const res = await authRequest('POST', `/api/support/tickets/${createdTicketId}/messages`, {
            message: 'Smoke test reply',
            sender_type: 'agent'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('PUT /api/support/tickets/:id — update status', async () => {
        assert.ok(createdTicketId, 'Need created ticket id');
        const res = await authRequest('PUT', `/api/support/tickets/${createdTicketId}`, {
            status: 'resolved'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('GET /api/support/sla — list SLA rules', async () => {
        const res = await authRequest('GET', '/api/support/sla');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('GET /api/support/retention — list retention policies', async () => {
        const res = await authRequest('GET', '/api/support/retention');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('GET /api/support/overview — dashboard', async () => {
        const res = await authRequest('GET', '/api/support/overview');
        assert.equal(res.status, 200);
        assert.ok(res.data.tickets);
    });
});

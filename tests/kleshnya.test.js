/**
 * tests/kleshnya.test.js — Kleshnya Chat API Tests
 * Run: node --test tests/kleshnya.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Kleshnya', () => {
    let sessionId;

    // ==========================================
    // SESSIONS
    // ==========================================

    it('POST /api/kleshnya/sessions — create session', async () => {
        const res = await authRequest('POST', '/api/kleshnya/sessions', {
            title: 'Smoke Session'
        });
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.id, 'Should return session with id');
        sessionId = res.data.id;
    });

    it('GET /api/kleshnya/sessions — list sessions', async () => {
        const res = await authRequest('GET', '/api/kleshnya/sessions');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('PUT /api/kleshnya/sessions/:id — rename session', async () => {
        assert.ok(sessionId, 'Need session id');
        const res = await authRequest('PUT', `/api/kleshnya/sessions/${sessionId}`, {
            title: 'Renamed Session'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.id);
    });

    it('GET /api/kleshnya/sessions/:id/messages — get messages', async () => {
        assert.ok(sessionId, 'Need session id');
        const res = await authRequest('GET', `/api/kleshnya/sessions/${sessionId}/messages`);
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    // ==========================================
    // CHAT
    // ==========================================

    it('GET /api/kleshnya/greeting — daily greeting', async () => {
        const res = await authRequest('GET', '/api/kleshnya/greeting');
        assert.equal(res.status, 200);
    });

    it('GET /api/kleshnya/chat — chat history', async () => {
        const res = await authRequest('GET', '/api/kleshnya/chat');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('POST /api/kleshnya/chat — send message', async () => {
        const res = await authRequest('POST', '/api/kleshnya/chat', {
            message: 'Привіт!',
            session_id: sessionId
        });
        assert.equal(res.status, 200);
    });

    it('POST /api/kleshnya/chat — reject empty message', async () => {
        const res = await authRequest('POST', '/api/kleshnya/chat', {
            message: ''
        });
        assert.equal(res.status, 400);
    });

    // ==========================================
    // SKILLS
    // ==========================================

    it('GET /api/kleshnya/skills — list skills', async () => {
        const res = await authRequest('GET', '/api/kleshnya/skills');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    // ==========================================
    // BRIDGE (secret auth — should reject without secret)
    // ==========================================

    it('GET /api/kleshnya/pending-messages — reject without secret', async () => {
        const res = await authRequest('GET', '/api/kleshnya/pending-messages');
        assert.equal(res.status, 403);
    });

    it('POST /api/kleshnya/webhook — reject without secret', async () => {
        const res = await authRequest('POST', '/api/kleshnya/webhook', { test: true });
        assert.equal(res.status, 403);
    });

    // ==========================================
    // MEDIA
    // ==========================================

    it('GET /api/kleshnya/media — list media', async () => {
        const res = await authRequest('GET', '/api/kleshnya/media');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    // ==========================================
    // CLEANUP
    // ==========================================

    it('DELETE /api/kleshnya/sessions/:id/messages — clear messages', async () => {
        assert.ok(sessionId, 'Need session id');
        const res = await authRequest('DELETE', `/api/kleshnya/sessions/${sessionId}/messages`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('DELETE /api/kleshnya/sessions/:id — delete session', async () => {
        assert.ok(sessionId, 'Need session id');
        const res = await authRequest('DELETE', `/api/kleshnya/sessions/${sessionId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });
});

/**
 * tests/board.test.js — Board (Dashboard) API Tests
 * Run: node --test tests/board.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Board', () => {
    let createdNoteId;

    // ==========================================
    // STATS
    // ==========================================

    it('GET /api/board/stats — dashboard stats', async () => {
        const res = await authRequest('GET', '/api/board/stats');
        assert.equal(res.status, 200);
        assert.ok(typeof res.data.bookings === 'number', 'Should have bookings count');
        assert.ok(typeof res.data.revenue === 'number', 'Should have revenue');
        assert.ok(res.data.date, 'Should have date');
    });

    // ==========================================
    // NOTES CRUD
    // ==========================================

    it('POST /api/board/notes — create note', async () => {
        const res = await authRequest('POST', '/api/board/notes', {
            text: 'Smoke test note',
            isShared: false
        });
        assert.ok([200, 201].includes(res.status), `Expected 200/201, got ${res.status}`);
        assert.ok(res.data.id, 'Should return note with id');
        createdNoteId = res.data.id;
    });

    it('POST /api/board/notes — create shared note', async () => {
        const res = await authRequest('POST', '/api/board/notes', {
            text: 'Shared smoke note',
            isShared: true
        });
        assert.ok([200, 201].includes(res.status));
    });

    it('GET /api/board/notes — list notes', async () => {
        const res = await authRequest('GET', '/api/board/notes');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data), 'Should return notes array');
    });

    it('PATCH /api/board/notes/:id — update note', async () => {
        if (!createdNoteId) return;
        const res = await authRequest('PATCH', `/api/board/notes/${createdNoteId}`, {
            text: 'Updated smoke note'
        });
        assert.equal(res.status, 200);
    });

    it('DELETE /api/board/notes/:id — delete note', async () => {
        if (!createdNoteId) return;
        const res = await authRequest('DELETE', `/api/board/notes/${createdNoteId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });
});

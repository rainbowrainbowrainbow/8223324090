/**
 * tests/music.test.js — Music Center API Tests
 * Run: node --test tests/music.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');
const { SOUND_API_SURFACE } = require('../config/soundApiSurface');

describe('Music', () => {
    let announcementId;
    let playlistId;

    it('Sound API contract keeps /api/music primary and /api/sound-library legacy-only', () => {
        assert.equal(SOUND_API_SURFACE.primary.mount, '/api/music');
        assert.equal(SOUND_API_SURFACE.primary.compatibilityOnly, false);
        assert.equal(SOUND_API_SURFACE.legacy.mount, '/api/sound-library');
        assert.equal(SOUND_API_SURFACE.legacy.compatibilityOnly, true);
    });

    // ==========================================
    // ANNOUNCEMENTS
    // ==========================================

    it('GET /api/music/announcements — list', async () => {
        const res = await authRequest('GET', '/api/music/announcements');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('POST /api/music/announcements — create', async () => {
        const res = await authRequest('POST', '/api/music/announcements', {
            title: 'Smoke Announcement',
            text_content: 'Увага! Тестове оголошення.',
            announcement_type: 'promo'
        });
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.success);
        assert.ok(res.data.announcement);
        announcementId = res.data.announcement.id;
    });

    it('POST /api/music/announcements — reject without required fields', async () => {
        const res = await authRequest('POST', '/api/music/announcements', {
            title: 'No text'
        });
        assert.equal(res.status, 400);
    });

    it('POST /api/music/announcements/:id/play — mark as played', async () => {
        assert.ok(announcementId, 'Need announcement id');
        const res = await authRequest('POST', `/api/music/announcements/${announcementId}/play`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('DELETE /api/music/announcements/:id — delete', async () => {
        assert.ok(announcementId, 'Need announcement id');
        const res = await authRequest('DELETE', `/api/music/announcements/${announcementId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    // ==========================================
    // PLAYLISTS
    // ==========================================

    it('GET /api/music/playlists — list', async () => {
        const res = await authRequest('GET', '/api/music/playlists');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('POST /api/music/playlists — create', async () => {
        const res = await authRequest('POST', '/api/music/playlists', {
            name: 'Smoke Playlist',
            category: 'background'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(res.data.playlist);
        playlistId = res.data.playlist.id;
    });

    it('POST /api/music/playlists — reject without name', async () => {
        const res = await authRequest('POST', '/api/music/playlists', {
            category: 'background'
        });
        assert.equal(res.status, 400);
    });

    it('DELETE /api/music/playlists/:id — delete', async () => {
        assert.ok(playlistId, 'Need playlist id');
        const res = await authRequest('DELETE', `/api/music/playlists/${playlistId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    // ==========================================
    // LOG & OVERVIEW
    // ==========================================

    it('GET /api/music/log — recent actions', async () => {
        const res = await authRequest('GET', '/api/music/log');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('GET /api/music/overview — dashboard', async () => {
        const res = await authRequest('GET', '/api/music/overview');
        assert.equal(res.status, 200);
        assert.ok(res.data.announcements);
        assert.ok(res.data.playlists);
    });
});

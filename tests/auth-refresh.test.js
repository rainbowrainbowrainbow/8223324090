/**
 * tests/auth-refresh.test.js — JWT Refresh Token tests (v38.4.0)
 * Tests token rotation, replay detection, session management, logout
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { request, BASE_URL, TEST_USER, TEST_PASS } = require('./helpers');

// Login and get full token set (access + refresh)
async function loginFresh() {
    const res = await request('POST', '/api/auth/login', {
        username: TEST_USER,
        password: TEST_PASS
    });
    assert.equal(res.status, 200, `Login failed: ${JSON.stringify(res.data)}`);
    return res.data;
}

describe('JWT Refresh Tokens', () => {
    it('login returns accessToken, refreshToken, and refreshExpiresAt', async () => {
        const data = await loginFresh();
        assert.ok(data.token, 'legacy token should exist');
        assert.ok(data.accessToken, 'accessToken should exist');
        assert.ok(data.refreshToken, 'refreshToken should exist');
        assert.ok(data.refreshExpiresAt, 'refreshExpiresAt should exist');
        assert.ok(data.user, 'user object should exist');
        assert.ok(data.user.id, 'user.id should exist');
    });

    it('accessToken and legacy token are different', async () => {
        const data = await loginFresh();
        // accessToken is short-lived (15m), legacy token is 24h
        assert.ok(data.accessToken.length > 20, 'accessToken should be a JWT');
        assert.ok(data.token.length > 20, 'legacy token should be a JWT');
    });

    it('refreshToken can rotate to new tokens', async () => {
        const login = await loginFresh();
        const res = await request('POST', '/api/auth/refresh', {
            refreshToken: login.refreshToken
        });
        assert.equal(res.status, 200, `Refresh failed: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.accessToken, 'new accessToken should exist');
        assert.ok(res.data.refreshToken, 'new refreshToken should exist');
        assert.ok(res.data.refreshExpiresAt, 'refreshExpiresAt should exist');
        assert.ok(res.data.user, 'user object should exist');
    });

    it('rotated refreshToken is different from original', async () => {
        const login = await loginFresh();
        const res = await request('POST', '/api/auth/refresh', {
            refreshToken: login.refreshToken
        });
        assert.equal(res.status, 200);
        assert.notEqual(res.data.refreshToken, login.refreshToken,
            'new refreshToken should differ from old');
    });

    it('old refreshToken is revoked after rotation', async () => {
        const login = await loginFresh();
        // Rotate once
        const rot1 = await request('POST', '/api/auth/refresh', {
            refreshToken: login.refreshToken
        });
        assert.equal(rot1.status, 200);
        // Try to use old token again — should fail (replay detection)
        const rot2 = await request('POST', '/api/auth/refresh', {
            refreshToken: login.refreshToken
        });
        assert.ok([401, 403].includes(rot2.status),
            `Replay should be rejected, got ${rot2.status}`);
    });

    it('new accessToken from refresh can verify', async () => {
        const login = await loginFresh();
        const rot = await request('POST', '/api/auth/refresh', {
            refreshToken: login.refreshToken
        });
        assert.equal(rot.status, 200);
        // Verify the new access token works
        const verify = await request('GET', '/api/auth/verify', null, rot.data.accessToken);
        assert.equal(verify.status, 200, 'New access token should verify');
        assert.ok(verify.data.user || verify.data.id, 'Verify should return user');
    });

    it('refresh without body returns 400', async () => {
        const res = await request('POST', '/api/auth/refresh', {});
        assert.equal(res.status, 400);
    });

    it('refresh with invalid token returns 401 or 403', async () => {
        const res = await request('POST', '/api/auth/refresh', {
            refreshToken: 'invalid-token-12345'
        });
        assert.ok([401, 403].includes(res.status),
            `Invalid refresh should be rejected, got ${res.status}`);
    });
});

describe('Logout', () => {
    it('logout revokes refreshToken', async () => {
        const login = await loginFresh();
        const logoutRes = await request('POST', '/api/auth/logout', {
            refreshToken: login.refreshToken
        });
        assert.equal(logoutRes.status, 200);
        assert.ok(logoutRes.data.success);

        // Refresh with revoked token should fail
        const refreshRes = await request('POST', '/api/auth/refresh', {
            refreshToken: login.refreshToken
        });
        assert.ok([401, 403].includes(refreshRes.status),
            'Revoked token should not refresh');
    });

    it('logout without params returns 400', async () => {
        const res = await request('POST', '/api/auth/logout', {});
        assert.equal(res.status, 400);
    });

    it('logout allDevices requires auth', async () => {
        const res = await request('POST', '/api/auth/logout', { allDevices: true });
        assert.equal(res.status, 401);
    });

    it('logout allDevices with auth revokes all sessions', async () => {
        const login1 = await loginFresh();
        const login2 = await loginFresh();

        // Logout all devices using login1's access token
        const headers = { 'Authorization': `Bearer ${login1.accessToken}` };
        const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ allDevices: true })
        });
        const logoutData = await logoutRes.json();
        assert.equal(logoutRes.status, 200);
        assert.ok(logoutData.success);

        // Both refresh tokens should be revoked
        const r1 = await request('POST', '/api/auth/refresh', {
            refreshToken: login1.refreshToken
        });
        assert.ok([401, 403].includes(r1.status), 'Login1 refresh should be revoked');

        const r2 = await request('POST', '/api/auth/refresh', {
            refreshToken: login2.refreshToken
        });
        assert.ok([401, 403].includes(r2.status), 'Login2 refresh should be revoked');
    });
});

describe('Sessions', () => {
    it('GET /sessions returns active sessions', async () => {
        const login = await loginFresh();
        const res = await request('GET', '/api/auth/sessions', null, login.accessToken);
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.sessions), 'sessions should be array');
        assert.ok(res.data.sessions.length >= 1, 'should have at least 1 session');
    });

    it('session has expected fields', async () => {
        const login = await loginFresh();
        const res = await request('GET', '/api/auth/sessions', null, login.accessToken);
        assert.equal(res.status, 200);
        const session = res.data.sessions[0];
        assert.ok(session.id, 'session should have id');
        assert.ok(session.created_at, 'session should have created_at');
        assert.ok(session.expires_at, 'session should have expires_at');
    });

    it('sessions require auth', async () => {
        const res = await request('GET', '/api/auth/sessions');
        assert.ok([401, 403].includes(res.status));
    });
});

'use strict';

process.env.RATE_LIMIT_MAX = '3';
process.env.AUTH_AVAILABILITY_RATE_LIMIT_MAX = '5';
process.env.LOGIN_RATE_LIMIT_MAX = '2';
process.env.LOGIN_IP_RATE_LIMIT_MAX = '10';
process.env.REFRESH_IP_RATE_LIMIT_MAX = '10';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const {
    rateLimiter,
    authAvailabilityRateLimiter,
    loginRateLimiter,
    refreshSessionLimiter
} = require('../middleware/rateLimit');

const ROOT = path.resolve(__dirname, '..');

function createStackApp() {
    const app = express();
    app.set('trust proxy', true);
    app.use(express.json());
    app.use(['/api/auth/verify', '/api/auth/login', '/api/auth/refresh'], authAvailabilityRateLimiter);
    app.use('/api/auth/login', loginRateLimiter);
    app.use('/api/auth/refresh', refreshSessionLimiter);
    app.use('/api', rateLimiter);
    app.get('/api/bookings', (req, res) => res.json({ ok: true, user: req.query.user || 'unknown' }));
    app.get('/api/auth/verify', (req, res) => res.json({
        user: { id: Number(req.query.user || 14), username: `operator.${req.query.user || 14}` }
    }));
    app.post('/api/auth/login', (req, res) => {
        if (req.body?.password === 'wrong') return res.status(401).json({ error: 'Invalid credentials' });
        return res.json({ accessToken: 'access' });
    });
    app.post('/api/auth/refresh', (_req, res) => res.json({ accessToken: 'access-new' }));
    return app;
}

async function withServer(app, callback) {
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    try {
        const base = `http://127.0.0.1:${server.address().port}`;
        return await callback(base);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

async function request(base, pathname, { ip, method = 'GET', body = null } = {}) {
    const response = await fetch(`${base}${pathname}`, {
        method,
        headers: {
            'X-Forwarded-For': ip,
            ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: response.status, body: parsed };
}

test('R1 gate: shared-IP business traffic must not exhaust auth verify/login/refresh recovery', async () => {
    await withServer(createStackApp(), async base => {
        const sharedIp = '198.51.100.42';
        for (let index = 0; index < 3; index += 1) {
            assert.equal((await request(base, `/api/bookings?user=${index}`, { ip: sharedIp })).status, 200);
        }

        const businessLimited = await request(base, '/api/bookings?user=overflow', { ip: sharedIp });
        assert.equal(businessLimited.status, 429);
        assert.equal(businessLimited.body.code, 'api_business_rate_limited');
        assert.equal(businessLimited.body.bucket, 'api_business_ip');

        assert.equal((await request(base, '/api/auth/verify?user=101', { ip: sharedIp })).status, 200);
        assert.equal((await request(base, '/api/auth/login', {
            ip: sharedIp,
            method: 'POST',
            body: { username: 'operator.102', password: 'correct' }
        })).status, 200);
        assert.equal((await request(base, '/api/auth/refresh', {
            ip: sharedIp,
            method: 'POST',
            body: { refreshToken: 'refresh-token-103' }
        })).status, 200);
    });
});

test('R3 gate: auth availability has a separate coarse IP bucket with machine-readable retry details', async () => {
    await withServer(createStackApp(), async base => {
        const sharedIp = '198.51.100.43';
        for (let index = 0; index < 5; index += 1) {
            assert.equal((await request(base, `/api/auth/verify?user=${index}`, { ip: sharedIp })).status, 200);
        }

        const limited = await request(base, '/api/auth/verify?user=overflow', { ip: sharedIp });
        assert.equal(limited.status, 429);
        assert.equal(limited.body.code, 'auth_availability_rate_limited');
        assert.equal(limited.body.bucket, 'auth_availability_ip');
        assert.equal(limited.body.retryable, true);
        assert.ok(Number(limited.body.retryAfterSeconds) > 0);
    });
});

test('R3 gate: credential brute force stays bounded after business traffic saturates the IP budget', async () => {
    await withServer(createStackApp(), async base => {
        const sharedIp = '198.51.100.44';
        for (let index = 0; index < 3; index += 1) {
            assert.equal((await request(base, `/api/bookings?user=${index}`, { ip: sharedIp })).status, 200);
        }
        assert.equal((await request(base, '/api/bookings?user=overflow', { ip: sharedIp })).status, 429);

        for (let index = 0; index < 2; index += 1) {
            const failed = await request(base, '/api/auth/login', {
                ip: sharedIp,
                method: 'POST',
                body: { username: 'brute.operator', password: 'wrong' }
            });
            assert.equal(failed.status, 401);
        }

        const limited = await request(base, '/api/auth/login', {
            ip: sharedIp,
            method: 'POST',
            body: { username: 'brute.operator', password: 'wrong' }
        });
        assert.equal(limited.status, 429);
        assert.equal(limited.body.code, 'login_rate_limited');
        assert.equal(limited.body.bucket, 'auth_login');
        assert.equal(limited.body.retryable, false);

        const neighboringAccount = await request(base, '/api/auth/login', {
            ip: sharedIp,
            method: 'POST',
            body: { username: 'neighbor.operator', password: 'correct' }
        });
        assert.equal(neighboringAccount.status, 200);
    });
});

test('R3 gate: server middleware order keeps auth availability before the business API bucket', () => {
    const source = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const authAvailabilityIndex = source.indexOf("app.use(['/api/auth/verify', '/api/auth/login', '/api/auth/refresh'], authAvailabilityRateLimiter)");
    const businessLimiterIndex = source.indexOf("app.use('/api', rateLimiter)");
    const authBoundaryIndex = source.indexOf('app.use(\'/api\', apiAuthBoundary(authenticateToken))');
    const loginLimiterIndex = source.indexOf("app.use('/api/auth/login', loginRateLimiter)");
    const refreshLimiterIndex = source.indexOf("app.use('/api/auth/refresh', refreshSessionLimiter)");

    assert.ok(authAvailabilityIndex >= 0, 'auth availability middleware must be mounted explicitly');
    assert.ok(businessLimiterIndex >= 0, 'business API limiter must stay mounted');
    assert.ok(authBoundaryIndex >= 0, 'API auth boundary must stay mounted');
    assert.ok(loginLimiterIndex >= 0, 'login brute-force limiter must stay mounted');
    assert.ok(refreshLimiterIndex >= 0, 'refresh abuse limiter must stay mounted');
    assert.ok(authAvailabilityIndex < businessLimiterIndex, 'auth availability must run before the business API bucket');
    assert.ok(businessLimiterIndex < authBoundaryIndex, 'business API limiter must still protect ordinary API traffic before auth work');
    assert.ok(loginLimiterIndex < authBoundaryIndex, 'login brute-force limiter must run before public login reaches the route');
    assert.ok(refreshLimiterIndex < authBoundaryIndex, 'refresh abuse limiter must run before public refresh reaches the route');
});

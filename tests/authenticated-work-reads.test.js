'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { checkAuthenticatedWorkReads } = require('../services/authenticatedWorkReads');

test('work proof reads six fixed local authenticated APIs and returns no response content', async () => {
    const seen = [];
    const server = http.createServer((req, res) => {
        seen.push({ path: req.url, bearer: req.headers.authorization, context: req.headers['x-business-context'] });
        res.setHeader('content-type', 'application/json');
        const body = req.url.startsWith('/api/auth/profile') ? { user: { id: 71 }, private: 'synthetic-private' }
            : req.url.startsWith('/api/tasks') ? { success: true }
                : req.url.startsWith('/api/staff') ? { success: true, data: [] }
                    : req.url.startsWith('/api/training') ? { success: true, courses: [] } : [];
        res.end(JSON.stringify(body));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const result = await checkAuthenticatedWorkReads({ socket: { localPort: server.address().port },
            headers: { authorization: 'Bearer synthetic-only', host: 'untrusted.invalid', 'x-forwarded-host': 'untrusted.invalid' },
            body: { path: 'https://untrusted.invalid' } }, { userId: 71, businessContext: 'event_genix' });
        assert.equal(result.length, 6);
        assert.ok(result.every(item => item.passed && item.probe === 'authenticated_api'));
        assert.equal(seen.length, 6);
        assert.ok(seen.every(item => item.bearer === 'Bearer synthetic-only' && item.context === 'event_genix'));
        assert.ok(seen.every(item => item.path.startsWith('/api/')));
        assert.doesNotMatch(JSON.stringify(result), /synthetic-private|synthetic-only|user/);
    } finally { await new Promise(resolve => server.close(resolve)); }
});

test('work proof rejects unsuccessful JSON, redirects and wrong profile identities', async () => {
    const server = http.createServer((req, res) => {
        res.setHeader('content-type', 'application/json');
        if (req.url.startsWith('/api/chat')) { res.statusCode = 302; res.setHeader('location', 'https://untrusted.invalid'); }
        if (req.url.startsWith('/api/afisha')) return res.end('invalid JSON');
        res.end(JSON.stringify({ success: false, user: { id: 72 }, error: 'synthetic-private-error' }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const result = await checkAuthenticatedWorkReads({ socket: { localPort: server.address().port },
            headers: { authorization: 'Bearer synthetic-only' } }, { userId: 71, businessContext: 'event_genix' });
        assert.ok(result.every(item => !item.passed));
        assert.equal(result.find(item => item.page === '/chat').httpStatus, 302);
        assert.doesNotMatch(JSON.stringify(result), /synthetic-private-error/);
    } finally { await new Promise(resolve => server.close(resolve)); }
    await assert.rejects(checkAuthenticatedWorkReads({ socket: { localPort: 80 }, headers: {} },
        { userId: 71, businessContext: 'event_genix' }), /context required/);
});

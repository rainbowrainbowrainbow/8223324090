'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    REQUIRED_PROXY_ENVIRONMENT_KEYS,
    resolveRailwayProxyConnectionString
} = require('../scripts/run-task-audit-readonly-role-via-railway-proxy');

test('Railway proxy wrapper accepts only complete Railway runtime variables', () => {
    assert.deepEqual(REQUIRED_PROXY_ENVIRONMENT_KEYS, [
        'RAILWAY_TCP_PROXY_DOMAIN',
        'RAILWAY_TCP_PROXY_PORT',
        'PGDATABASE',
        'PGUSER',
        'PGPASSWORD'
    ]);
    assert.throws(
        () => resolveRailwayProxyConnectionString({}),
        error => error.code === 'TASK_AUDIT_ROLE_RAILWAY_PROXY_REQUIRED'
    );
});

test('Railway proxy wrapper constructs a connection URL without exposing it', () => {
    const proxyUrl = resolveRailwayProxyConnectionString({
        RAILWAY_TCP_PROXY_DOMAIN: 'proxy.example.invalid',
        RAILWAY_TCP_PROXY_PORT: '15432',
        PGDATABASE: 'eventgenix',
        PGUSER: 'postgres',
        PGPASSWORD: 'secret with spaces'
    });
    const parsed = new URL(proxyUrl);
    assert.equal(parsed.hostname, 'proxy.example.invalid');
    assert.equal(parsed.port, '15432');
    assert.equal(parsed.username, 'postgres');
    assert.equal(parsed.password, 'secret%20with%20spaces');
    assert.equal(parsed.pathname, '/eventgenix');
});

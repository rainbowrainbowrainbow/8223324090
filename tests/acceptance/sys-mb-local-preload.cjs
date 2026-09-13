'use strict';

// Test transport fence only. Real Express, auth, services and SQL remain loaded.
const assert = require('node:assert/strict');
assert.equal(process.env.SYS_MB_D06_LOCAL, 'true');
assert.equal(process.env.NODE_ENV, 'test');
assert.match(process.env.PGDATABASE || '', /^eventgenix_d06_test_[a-f0-9]{32}$/);
assert.equal(process.env.PGHOST, '/var/run/postgresql');
assert.equal(process.env.BACKUP_OUTBOUND_HOLD, 'true');
const local = host => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(String(host).toLowerCase());
function validate(target) {
    const host = typeof target === 'string' || target instanceof URL
        ? new URL(target).hostname : target?.hostname || String(target?.host || 'localhost').split(':')[0];
    if (local(host)) return;
    process.stderr.write(`[D06_OUTBOUND_DENIED] ${String(host).replace(/[^a-zA-Z0-9.:-]/g, '')}\n`);
    throw Object.assign(new Error('Non-loopback transport blocked by D06 local harness'), { code: 'D06_OUTBOUND_BLOCKED' });
}
const nativeFetch = global.fetch;
global.fetch = (input, init) => { validate(input?.url || input); return nativeFetch(input, init); };
for (const moduleName of ['node:http', 'node:https']) {
    const transport = require(moduleName);
    for (const method of ['request', 'get']) {
        const original = transport[method];
        transport[method] = function(input, ...args) { validate(input); return original.call(this, input, ...args); };
    }
}
// The supported outbound-hold mode returns before WS initialization. Attach the
// unchanged production WS module explicitly; scheduler behavior is NOT_TESTABLE.
const http = require('node:http');
const originalEmit = http.Server.prototype.emit;
http.Server.prototype.emit = function(event, ...args) {
    const result = originalEmit.call(this, event, ...args);
    if (event === 'listening' && !this.__d06WebSocket) {
        this.__d06WebSocket = true;
        require('../../services/websocket').initWebSocket(this);
    }
    return result;
};

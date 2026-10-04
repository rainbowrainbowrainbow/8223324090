'use strict';

// Process-only boundary for local preview; no application/auth code is changed.
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const { DATABASES } = require('./education-ready-dataset');
if (process.env.EDU_READY_LOCAL_CONFIRM !== 'SEED_OWNED_LOCAL_EDUCATION'
    || !Object.values(DATABASES).includes(process.env.PGDATABASE)
    || process.env.PGHOST !== '127.0.0.1' || process.env.PGPORT !== '55469'
    || process.env.NODE_ENV !== 'test' || process.env.DATABASE_URL)
    throw new Error('Local preview network boundary requires the exact owned environment');
if (process.env.PGDATABASE === DATABASES.devices
    && process.env.EDU_READY_DEVICE_LOCAL_CONFIRM !== 'OWNED_DEVICE_PREVIEW_08C')
    throw new Error('Device preview requires its separate local ownership confirmation');

const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
    if (typeof args[0] === 'number' || typeof args[0] === 'string' && /^\d+$/.test(args[0])) {
        const port = Number(args.shift());
        if (typeof args[0] === 'string') args.shift();
        return listen.call(this, { port, host: '127.0.0.1' }, ...args);
    }
    if (args[0] && typeof args[0] === 'object' && args[0].port) args[0] = { ...args[0], host: '127.0.0.1' };
    return listen.apply(this, args);
};
function localHost(host) { return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(String(host).toLowerCase()); }
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
    const options = Array.isArray(args[0]) ? args[0][0] : args[0];
    // Child IPC pipes stay local; all TCP destinations must be loopback.
    if (!options?.path) {
        const host = typeof options === 'object' ? options.host || 'localhost'
            : typeof args[1] === 'string' ? args[1] : 'localhost';
        if (!localHost(host)) throw new Error('EDU-READY preview blocked outbound TCP');
    }
    return connect.apply(this, args);
};
function assertHttpTarget(value) {
    const host = typeof value === 'string' || value instanceof URL ? new URL(value).hostname
        : value?.hostname || value?.host || 'localhost';
    if (!localHost(host)) throw new Error('EDU-READY preview blocked outbound HTTP');
}
for (const transport of [http, https]) for (const name of ['request', 'get']) {
    const original = transport[name];
    transport[name] = function (...args) { assertHttpTarget(args[0]); return original.apply(this, args); };
}
const nativeFetch = globalThis.fetch;
globalThis.fetch = function (input, options) { assertHttpTarget(input instanceof Request ? input.url : input); return nativeFetch(input, options); };

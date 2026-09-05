'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SW_SOURCE = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function loadNetworkFirstPage() {
    const context = {
        console: { warn() {}, error() {}, log() {} },
        URL,
        Request,
        Response,
        fetch: async () => { throw new TypeError('controlled navigation failure'); },
        caches: {
            async match(request) {
                const value = typeof request === 'string' ? request : request.url;
                return new URL(value, 'https://event-genix.test').pathname === '/index.html'
                    ? new Response(INDEX_HTML, { status: 200, headers: { 'content-type': 'text/html' } })
                    : null;
            },
            async open() {
                return {
                    async addAll() {},
                    async put() {},
                    async match() { return null; }
                };
            },
            async keys() { return []; },
            async delete() { return true; }
        },
        indexedDB: {
            deleteDatabase() {
                const request = {};
                process.nextTick(() => request.onsuccess && request.onsuccess());
                return request;
            }
        },
        self: {
            location: { origin: 'https://event-genix.test' },
            addEventListener() {},
            skipWaiting() {},
            clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => {} },
            registration: { showNotification: async () => {} }
        }
    };
    vm.createContext(context);
    vm.runInContext(`${SW_SOURCE}; self.__networkFirstPage = networkFirstPage;`, context, { filename: 'sw.js' });
    return context.self.__networkFirstPage;
}

test('R4 gate: SW navigation fallback must not substitute Timeline shell for Leads/Certificates', async () => {
    const networkFirstPage = loadNetworkFirstPage();
    for (const pathname of ['/sales-funnel', '/certificates']) {
        const response = await networkFirstPage(new Request(`https://event-genix.test${pathname}`, {
            method: 'GET',
            headers: { Accept: 'text/html' }
        }));
        const html = await response.text();
        assert.equal(response.status, 503, `${pathname} should fail closed or use a same-page fallback`);
        assert.match(html, /data-offline-navigation="true"/, `${pathname} should return neutral offline navigation UI`);
        assert.match(html, new RegExp(`data-requested-route="${pathname}"`), `${pathname} should preserve requested route`);
        assert.equal(/timeline-dashboard-page/.test(html), false, `${pathname} must not receive index.html Timeline markup`);
    }
});

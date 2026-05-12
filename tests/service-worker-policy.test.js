const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
    API_CACHE_ALLOWLIST,
    MUTATION_QUEUE_ALLOWLIST,
    SENSITIVE_API_PATH_PREFIXES,
    runtimeApiAllowlist
} = require('../config/serviceWorkerPolicy');

const ROOT = path.join(__dirname, '..');
const swSource = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

function loadPolicy() {
    const listeners = {};
    const context = {
        console,
        URL,
        Request,
        Response,
        fetch: async () => new Response('{}', { status: 200 }),
        caches: {
            async keys() { return []; },
            async open() {
                return {
                    async addAll() {},
                    async add() {},
                    async put() {},
                    async delete() {},
                    async match() { return null; }
                };
            },
            async match() { return null; },
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
            addEventListener(type, handler) { listeners[type] = handler; },
            skipWaiting() {},
            registration: { showNotification: async () => {} },
            clients: {
                claim: async () => {},
                matchAll: async () => [],
                openWindow: async () => {}
            }
        }
    };

    vm.createContext(context);
    vm.runInContext(`${swSource}
        self.__policy = {
            API_CACHE_ALLOWLIST,
            SENSITIVE_API_PATH_PREFIXES,
            MUTATION_QUEUE_ALLOWLIST,
            isApiCacheAllowed,
            isMutationQueueAllowed
        };
    `, context, { filename: 'sw.js' });

    return context.self.__policy;
}

function get(url, headers = {}) {
    return new Request(`https://event-genix.test${url}`, { method: 'GET', headers });
}

function post(url) {
    return new Request(`https://event-genix.test${url}`, { method: 'POST' });
}

describe('Service Worker cache safety policy', () => {
    const policy = loadPolicy();

    it('uses a small explicit allowlist for API GET cache', () => {
        assert.deepEqual(JSON.parse(JSON.stringify(policy.API_CACHE_ALLOWLIST)), runtimeApiAllowlist());
        assert.deepEqual(API_CACHE_ALLOWLIST.map(({ type, path }) => ({ type, path })), runtimeApiAllowlist());
    });

    it('does not cache sensitive CRM API GET responses', () => {
        for (const pathPrefix of [
            '/api/finance/summary',
            '/api/chat/channels',
            '/api/hr/staff',
            '/api/customers',
            '/api/reports/monthly',
            '/api/dashboard/alerts',
            '/api/leads/hot',
            '/api/bookings/2099-01-01',
            '/api/tasks',
            '/api/warehouse',
            '/api/auth/verify'
        ]) {
            assert.equal(policy.isApiCacheAllowed(get(pathPrefix)), false, `${pathPrefix} must be network-only`);
        }
    });

    it('does not cache allowlisted API GET responses when Authorization is present', () => {
        assert.equal(policy.isApiCacheAllowed(get('/api/version')), true);
        assert.equal(policy.isApiCacheAllowed(get('/api/version', { Authorization: 'Bearer token' })), false);
    });

    it('keeps offline mutation replay disabled unless an endpoint is explicitly reviewed', () => {
        assert.deepEqual(Array.from(policy.MUTATION_QUEUE_ALLOWLIST), MUTATION_QUEUE_ALLOWLIST);
        assert.deepEqual(MUTATION_QUEUE_ALLOWLIST, []);
        assert.equal(policy.isMutationQueueAllowed(post('/api/bookings')), false);
        assert.equal(policy.isMutationQueueAllowed(post('/api/finance/transactions')), false);
        assert.equal(policy.isMutationQueueAllowed(post('/api/chat/messages')), false);
    });

    it('documents the sensitive endpoint classes in the policy guardrail', () => {
        for (const requiredPrefix of [
            '/api/finance',
            '/api/chat',
            '/api/hr',
            '/api/customers',
            '/api/reports',
            '/api/dashboard',
            '/api/leads',
            '/api/tasks',
            '/api/bookings',
            '/api/warehouse',
            '/api/auth'
        ]) {
            assert.ok(
                policy.SENSITIVE_API_PATH_PREFIXES.includes(requiredPrefix),
                `${requiredPrefix} should be in SENSITIVE_API_PATH_PREFIXES`
            );
            assert.ok(
                SENSITIVE_API_PATH_PREFIXES.includes(requiredPrefix),
                `${requiredPrefix} should be in config/serviceWorkerPolicy`
            );
        }
    });
});

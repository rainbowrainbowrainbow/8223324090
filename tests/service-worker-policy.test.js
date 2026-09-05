const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
    API_CACHE_ALLOWLIST,
    APP_SHELL_POLICY,
    MUTATION_QUEUE_ALLOWLIST,
    PRIVATE_RUNTIME_PATH_PREFIXES,
    SENSITIVE_API_PATH_PREFIXES,
    SERVICE_WORKER_POLICY,
    STATIC_RUNTIME_CACHE_ALLOWLIST,
    runtimeApiAllowlist,
    runtimeStaticAllowlist
} = require('../config/serviceWorkerPolicy');

const ROOT = path.join(__dirname, '..');
const swSource = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

function loadPolicy(options = {}) {
    const listeners = {};
    const deletedCaches = [];
    const deletedDatabases = [];
    const appShellAdds = [];
    const cachePuts = [];
    const openedCaches = [];
    let skipWaitingCalls = 0;
    let claimCalls = 0;
    const context = {
        console,
        URL,
        Request,
        Response,
        fetch: options.fetch || (async () => new Response('{}', { status: 200 })),
        caches: {
            async keys() { return options.cacheKeys || []; },
            async open(name) {
                openedCaches.push(name);
                return {
                    async addAll(urls) {
                        appShellAdds.push([...urls]);
                        if (options.addAllError) throw options.addAllError;
                    },
                    async add() {},
                    async put(request) { cachePuts.push(request); },
                    async delete() {},
                    async match() { return null; }
                };
            },
            async match(request) {
                return options.cacheMatch ? options.cacheMatch(request) : null;
            },
            async delete(name) {
                deletedCaches.push(name);
                return true;
            }
        },
        indexedDB: {
            deleteDatabase(name) {
                deletedDatabases.push(name);
                const request = {};
                process.nextTick(() => request.onsuccess && request.onsuccess());
                return request;
            }
        },
        self: {
            location: { origin: 'https://event-genix.test' },
            addEventListener(type, handler) { listeners[type] = handler; },
            skipWaiting() { skipWaitingCalls += 1; },
            registration: { showNotification: async () => {} },
            clients: {
                claim: async () => { claimCalls += 1; },
                matchAll: async () => [],
                openWindow: async () => {}
            }
        }
    };

    vm.createContext(context);
    vm.runInContext(`${swSource}
        self.__policy = {
            API_CACHE_ALLOWLIST,
            STATIC_RUNTIME_CACHE_ALLOWLIST,
            PRIVATE_RUNTIME_PATH_PREFIXES,
            SENSITIVE_API_PATH_PREFIXES,
            MUTATION_QUEUE_ALLOWLIST,
            isApiCacheAllowed,
            isMutationQueueAllowed,
            isPrivateRuntimePath,
            isStaticRuntimeCacheAllowed,
            clearPrivateCaches,
            cacheFirstWithNetwork,
            networkFirstPage,
            APP_SHELL,
            OFFLINE_FALLBACK_URL,
            OFFLINE_DB_NAME,
            __deletedCaches: ${JSON.stringify(null)},
            __deletedDatabases: ${JSON.stringify(null)}
        };
    `, context, { filename: 'sw.js' });

    context.self.__policy.__deletedCaches = deletedCaches;
    context.self.__policy.__deletedDatabases = deletedDatabases;
    context.self.__policy.__listeners = listeners;
    context.self.__policy.__appShellAdds = appShellAdds;
    context.self.__policy.__cachePuts = cachePuts;
    context.self.__policy.__openedCaches = openedCaches;
    context.self.__policy.__skipWaitingCalls = () => skipWaitingCalls;
    context.self.__policy.__claimCalls = () => claimCalls;
    return context.self.__policy;
}

function get(url, headers = {}) {
    return new Request(`https://event-genix.test${url}`, { method: 'GET', headers });
}

function post(url) {
    return new Request(`https://event-genix.test${url}`, { method: 'POST' });
}

async function waitForWorkerEvent(listener) {
    let pending;
    listener({ waitUntil(promise) { pending = promise; } });
    await pending;
}

describe('Service Worker cache safety policy', () => {
    const policy = loadPolicy();

    it('uses a small explicit allowlist for API GET cache', () => {
        assert.deepEqual(JSON.parse(JSON.stringify(policy.API_CACHE_ALLOWLIST)), runtimeApiAllowlist());
        assert.deepEqual(API_CACHE_ALLOWLIST.map(({ type, path }) => ({ type, path })), runtimeApiAllowlist());
    });

    it('does not cache sensitive CRM API GET responses', () => {
        const hotLeadsPath = ['/api/leads', 'hot'].join('/');
        for (const pathPrefix of [
            '/api/finance/summary',
            '/api/chat/channels',
            '/api/hr/staff',
            '/api/customers',
            '/api/reports/monthly',
            '/api/dashboard/alerts',
            hotLeadsPath,
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

    it('uses an explicit public allowlist for runtime static cache', () => {
        assert.deepEqual(
            JSON.parse(JSON.stringify(policy.STATIC_RUNTIME_CACHE_ALLOWLIST)),
            runtimeStaticAllowlist()
        );
        assert.deepEqual(
            STATIC_RUNTIME_CACHE_ALLOWLIST.map(({ type, path }) => ({ type, path })),
            runtimeStaticAllowlist()
        );
        assert.equal(policy.isStaticRuntimeCacheAllowed(get('/js/auth.js')), true);
        assert.equal(policy.isStaticRuntimeCacheAllowed(get('/images/logo-new.png')), true);
        assert.equal(policy.isStaticRuntimeCacheAllowed(get('/private/generated.pdf')), false);
    });

    it('keeps uploads and authorized static requests out of runtime cache', () => {
        assert.ok(PRIVATE_RUNTIME_PATH_PREFIXES.includes('/uploads'));
        assert.equal(policy.isPrivateRuntimePath('/uploads/customer-contract.pdf'), true);
        assert.equal(policy.isStaticRuntimeCacheAllowed(get('/uploads/customer-contract.pdf')), false);
        assert.equal(
            policy.isStaticRuntimeCacheAllowed(get('/js/auth.js', { Authorization: 'Bearer token' })),
            false
        );
    });

    it('cold install precaches only the reviewed minimal offline shell', async () => {
        const runtimePolicy = loadPolicy();
        await waitForWorkerEvent(runtimePolicy.__listeners.install);

        assert.deepEqual(
            JSON.parse(JSON.stringify(runtimePolicy.APP_SHELL)),
            APP_SHELL_POLICY.installAssets
        );
        assert.deepEqual(runtimePolicy.__appShellAdds, [APP_SHELL_POLICY.installAssets]);
        assert.equal(runtimePolicy.APP_SHELL.filter(url => url === '/index.html').length, 1);
        assert.equal(runtimePolicy.APP_SHELL.includes('/'), false);
        assert.equal(runtimePolicy.APP_SHELL.some(url => url.startsWith('/js/')), false);
        assert.equal(runtimePolicy.APP_SHELL.some(url => url.startsWith('/images/')), false);
        assert.equal(runtimePolicy.OFFLINE_FALLBACK_URL, APP_SHELL_POLICY.offlineFallbackUrl);
        assert.equal(runtimePolicy.__skipWaitingCalls(), 1);
    });

    it('cleans obsolete caches during an update and claims clients', async () => {
        const runtimePolicy = loadPolicy({
            cacheKeys: [
                'event-genix-v0.0.0',
                'event-genix-api-v0.0.0',
                'unrelated-cache'
            ]
        });

        await waitForWorkerEvent(runtimePolicy.__listeners.activate);

        assert.deepEqual(runtimePolicy.__deletedCaches.sort(), [
            'event-genix-api-v0.0.0',
            'event-genix-v0.0.0',
            'unrelated-cache'
        ]);
        assert.equal(runtimePolicy.__claimCalls(), 1);
    });

    it('uses one canonical cache key for root and index navigations', async () => {
        const runtimePolicy = loadPolicy();
        await runtimePolicy.networkFirstPage(get('/'));

        assert.equal(runtimePolicy.__cachePuts.length, 1);
        assert.equal(new URL(runtimePolicy.__cachePuts[0].url).pathname, '/index.html');
    });

    it('does not retain authenticated page navigations in runtime cache', async () => {
        const runtimePolicy = loadPolicy();
        await runtimePolicy.networkFirstPage(get('/customers'));

        assert.equal(runtimePolicy.__cachePuts.length, 0);
    });

    it('keeps booking, timeline, and images out of install while allowing runtime static cache', async () => {
        const runtimePolicy = loadPolicy();

        await runtimePolicy.cacheFirstWithNetwork(get('/js/booking.js'));
        await runtimePolicy.cacheFirstWithNetwork(get('/js/timeline.js'));
        await runtimePolicy.cacheFirstWithNetwork(get('/images/logo-new.png'));

        assert.deepEqual(
            runtimePolicy.__cachePuts.map(request => new URL(request.url).pathname),
            ['/js/booking.js', '/js/timeline.js', '/images/logo-new.png']
        );
    });

    it('returns the canonical shell only for root/index offline navigation fallback', async () => {
        const runtimePolicy = loadPolicy({
            fetch: async () => { throw new Error('offline'); },
            cacheMatch(request) {
                const value = typeof request === 'string' ? request : request.url;
                return new URL(value, 'https://event-genix.test').pathname === '/index.html'
                    ? new Response('<main>Offline shell</main>', { status: 200 })
                    : null;
            }
        });

        const response = await runtimePolicy.networkFirstPage(get('/'));
        assert.equal(response.status, 200);
        assert.equal(await response.text(), '<main>Offline shell</main>');
    });

    it('returns neutral offline navigation for module routes without an exact cached page', async () => {
        const runtimePolicy = loadPolicy({
            fetch: async () => { throw new Error('offline'); },
            cacheMatch(request) {
                const value = typeof request === 'string' ? request : request.url;
                return new URL(value, 'https://event-genix.test').pathname === '/index.html'
                    ? new Response('<main class="timeline-dashboard-page">Timeline shell</main>', { status: 200 })
                    : null;
            }
        });

        const response = await runtimePolicy.networkFirstPage(get('/reports.html'));
        const body = await response.text();
        assert.equal(response.status, 503);
        assert.match(body, /data-offline-navigation="true"/);
        assert.match(body, /data-requested-route="\/reports\.html"/);
        assert.doesNotMatch(body, /timeline-dashboard-page/);
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
    });

    it('clears API and runtime caches, restores the public shell, and deletes the legacy offline DB', async () => {
        const runtimePolicy = loadPolicy({
            cacheKeys: [
                'event-genix-v0.77.15',
                'event-genix-api-v0.77.15',
                'event-genix-api-old',
                'unrelated-cache'
            ]
        });

        await runtimePolicy.clearPrivateCaches();

        assert.deepEqual(runtimePolicy.__deletedCaches.sort(), [
            'event-genix-api-old',
            'event-genix-api-v0.77.15',
            'event-genix-v0.77.15'
        ]);
        assert.deepEqual(runtimePolicy.__appShellAdds, [APP_SHELL_POLICY.installAssets]);
        assert.deepEqual(runtimePolicy.__deletedDatabases, [SERVICE_WORKER_POLICY.offlineDatabaseName]);
        assert.equal(runtimePolicy.OFFLINE_DB_NAME, SERVICE_WORKER_POLICY.offlineDatabaseName);
        assert.equal(typeof runtimePolicy.__listeners.message, 'function');
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

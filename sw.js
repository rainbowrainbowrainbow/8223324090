/**
 * sw.js — Service Worker for Event Genix
 * Feature #9: Offline support with App Shell caching.
 *
 * Security note: authenticated CRM API data is network-only by default. Do not
 * add API cache or mutation replay paths without checking data sensitivity.
 *
 * Registration is owned by the authenticated runtime in js/auth.js.
 */

const CACHE_NAME = 'event-genix-v0.81.75';
const API_CACHE_NAME = 'event-genix-api-v0.81.75';

// Minimal offline shell. Large CRM modules and images use runtime cache only
// after a client actually requests them.
const OFFLINE_FALLBACK_URL = '/index.html';
const APP_SHELL = [
    OFFLINE_FALLBACK_URL,
    '/manifest.json',
    // Login, layout, dark mode, and mobile shell only.
    '/css/base.css',
    '/css/auth.css',
    '/css/layout.css',
    '/css/dark-mode.css',
    '/css/responsive.css'
];

const API_CACHE_PREFIX = 'event-genix-api-';
const RUNTIME_CACHE_PREFIX = 'event-genix-v';
const OFFLINE_DB_NAME = 'park-offline';

// Public, non-user-specific API GET responses that are safe to cache.
// Everything else under /api is network-only by default.
const API_CACHE_ALLOWLIST = [
    { type: 'exact', path: '/api/version' },
    { type: 'exact', path: '/api/status/public' }
];

// Explicit sensitive modules. This list is documentation and a guardrail;
// the real cache policy is still default-deny for API GET requests.
const SENSITIVE_API_PATH_PREFIXES = [
    '/api/auth',
    '/api/backup',
    '/api/telegram',
    '/api/report-bot',
    '/api/finance',
    '/api/chat',
    '/api/hr',
    '/api/customers',
    '/api/reports',
    '/api/report-agent',
    '/api/dashboard',
    '/api/analytics',
    '/api/leads',
    '/api/staff',
    '/api/tasks',
    '/api/bookings',
    '/api/warehouse',
    '/api/designs',
    '/api/sound',
    '/api/profile',
    '/api/users',
    '/api/settings',
    '/api/search',
    '/api/notifications',
    '/api/push',
    '/api/kleshnya',
    '/api/copilot',
    '/api/omni'
];

// Offline mutation replay is disabled until a specific endpoint is reviewed and
// added here with user-visible conflict handling. Never queue auth/chat/finance/
// HR/customer/report/uploads data by default.
const MUTATION_QUEUE_ALLOWLIST = [];

// Only reviewed public frontend assets may enter runtime Cache Storage.
// Authenticated uploads and every unknown runtime path stay network-only.
const STATIC_RUNTIME_CACHE_ALLOWLIST = [
    { type: 'exact', path: '/manifest.json' },
    { type: 'prefix', path: '/css' },
    { type: 'prefix', path: '/js' },
    { type: 'prefix', path: '/images' },
    { type: 'prefix', path: '/assets' },
    { type: 'prefix', path: '/landing' }
];

const PRIVATE_RUNTIME_PATH_PREFIXES = ['/uploads'];

function matchesPathPolicy(pathname, policies) {
    return policies.some((policy) => {
        if (policy.type === 'exact') return pathname === policy.path;
        if (policy.type === 'prefix') return pathname === policy.path || pathname.startsWith(`${policy.path}/`);
        return false;
    });
}

function requestHasAuthorization(request) {
    return request.headers.has('authorization') || request.headers.has('Authorization');
}

function isSensitiveApiPath(pathname) {
    return SENSITIVE_API_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isApiCacheAllowed(request, url = new URL(request.url)) {
    if (request.method !== 'GET') return false;
    if (!url.pathname.startsWith('/api/')) return false;
    if (requestHasAuthorization(request)) return false;
    if (isSensitiveApiPath(url.pathname)) return false;
    return matchesPathPolicy(url.pathname, API_CACHE_ALLOWLIST);
}

function isMutationQueueAllowed(request, url = new URL(request.url)) {
    if (!url.pathname.startsWith('/api/')) return false;
    if (request.method === 'GET') return false;
    if (isSensitiveApiPath(url.pathname)) return false;
    return matchesPathPolicy(url.pathname, MUTATION_QUEUE_ALLOWLIST);
}

function isPrivateRuntimePath(pathname) {
    return PRIVATE_RUNTIME_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isStaticRuntimeCacheAllowed(request, url = new URL(request.url)) {
    if (request.method !== 'GET') return false;
    if (requestHasAuthorization(request)) return false;
    if (isPrivateRuntimePath(url.pathname)) return false;
    return matchesPathPolicy(url.pathname, STATIC_RUNTIME_CACHE_ALLOWLIST);
}

function escapeOfflineHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function offlineNavigationResponse(request) {
    const url = new URL(request.url);
    const route = `${url.pathname}${url.search || ''}${url.hash || ''}`;
    const safeRoute = escapeOfflineHtml(route);
    return new Response(`<!doctype html>
<html lang="uk">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Event Genix — offline</title>
    <style>
        :root { color-scheme: light dark; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f8fafc; color: #0f172a; }
        main { max-width: 520px; margin: 24px; padding: 24px; border: 1px solid rgba(148, 163, 184, 0.35); border-radius: 18px; background: #fff; box-shadow: 0 18px 45px rgba(15, 23, 42, 0.12); }
        h1 { margin: 0 0 12px; font-size: 24px; }
        p { margin: 0 0 14px; line-height: 1.5; }
        code { display: inline-block; max-width: 100%; padding: 2px 6px; border-radius: 6px; background: rgba(15, 23, 42, 0.08); overflow-wrap: anywhere; }
        button { border: 0; border-radius: 10px; padding: 10px 14px; font-weight: 700; color: #fff; background: #2563eb; cursor: pointer; }
        @media (prefers-color-scheme: dark) {
            body { background: #020617; color: #e2e8f0; }
            main { background: #0f172a; border-color: rgba(148, 163, 184, 0.28); }
            code { background: rgba(226, 232, 240, 0.1); }
        }
    </style>
</head>
<body data-offline-navigation="true" data-requested-route="${safeRoute}" data-sw-version="${CACHE_NAME}">
    <main role="alert">
        <h1>Модуль тимчасово недоступний офлайн</h1>
        <p>Запитаний маршрут: <code>${safeRoute}</code></p>
        <p>Підключіться до мережі й повторіть відкриття цієї сторінки.</p>
        <button type="button" onclick="location.reload()">Спробувати ще раз</button>
    </main>
    <script>
        (function () {
            try {
                var key = 'pzp_redirect_diagnostics_v1';
                var maxEntries = 80;
                var maxBytes = 32768;
                var maxAgeMs = 24 * 60 * 60 * 1000;
                var maxRouteSegments = 3;
                var allowedModules = {
                    '': true,
                    'dashboard': true,
                    'sales-funnel': true,
                    'customers': true,
                    'certificates': true,
                    'tasks': true,
                    'profile': true,
                    'staff': true,
                    'hr': true,
                    'reports': true,
                    'analytics': true,
                    'finance': true,
                    'settings': true,
                    'chat': true,
                    'warehouse': true,
                    'designs': true,
                    'programs': true,
                    'bookings': true,
                    'afisha': true,
                    'training': true,
                    'invite': true,
                    'sound': true,
                    'omni': true,
                    'timeline': true,
                    'maysternya-doli': true,
                    'kleshnya': true,
                    'copilot': true,
                    'guardian-ops': true,
                    'hermes-studio': true,
                    'status': true
                };
                var staticChildren = {
                    certificates: { new: true, batch: true },
                    omni: { accounts: true }
                };
                function safeShort(value, limit) {
                    return String(value || '')
                        .replace(/[^a-zA-Z0-9_.:-]/g, '-')
                        .replace(/-+/g, '-')
                        .replace(/^-|-$/g, '')
                        .slice(0, limit || 80);
                }
                function routeSegment(segment) {
                    try { segment = decodeURIComponent(segment); } catch (_) {}
                    return safeShort(String(segment || '').toLowerCase(), 48);
                }
                function normalizeRoute(value) {
                    var pathname = String(value || location.pathname || '/').split(/[?#]/)[0] || '/';
                    var segments = pathname.split('/').filter(Boolean).map(routeSegment).filter(Boolean);
                    if (!segments.length) return '/';
                    var moduleName = segments[0];
                    if (!allowedModules[moduleName]) return '/:unknown';
                    var output = [moduleName];
                    var allowedChildren = staticChildren[moduleName] || {};
                    for (var index = 1; index < segments.length && output.length < maxRouteSegments; index += 1) {
                        output.push(allowedChildren[segments[index]] ? segments[index] : ':id');
                    }
                    return ('/' + output.join('/')).slice(0, 120);
                }
                function sanitizeSwVersion(value) {
                    var normalized = safeShort(value, 80);
                    return (/^event-genix(?:-api)?-v[a-zA-Z0-9_.:-]+$/).test(normalized) ? normalized : 'unknown';
                }
                function sanitizeEntry(entry, timestamp) {
                    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
                    var event = String(entry.event || '');
                    if (!({
                        'auth-bootstrap': true,
                        'auth-session-failure': true,
                        'auth-refresh': true,
                        'auth-redirect': true,
                        'auth-storage-clear': true,
                        'navigation-click': true,
                        'navigation-transition': true,
                        'shell-lifecycle': true,
                        'sw-offline-navigation': true
                    })[event]) return null;
                    var at = Number(entry.at || 0);
                    if (!Number.isFinite(at) || at <= 0 || at < timestamp - maxAgeMs || at > timestamp + 60000) return null;
                    var result = {
                        event: event,
                        at: at,
                        tabId: (/^tab-[a-z0-9-]{4,44}$/i).test(String(entry.tabId || '')) || entry.tabId === 'sw-offline-page' ? String(entry.tabId) : 'tab-unavailable',
                        buildVersion: safeShort(entry.buildVersion || '', 32),
                        swVersion: sanitizeSwVersion(entry.swVersion || 'unknown'),
                        route: normalizeRoute(entry.route),
                        visibility: ({ visible: true, hidden: true, prerender: true, unloaded: true })[entry.visibility] ? entry.visibility : 'unknown'
                    };
                    if (entry.status >= 100 && entry.status <= 599) result.status = Number(entry.status);
                    if (({ network: true, http: true, 'offline-navigation': true })[entry.reason]) result.reason = entry.reason;
                    if (({ 'offline-navigation': true })[entry.lifecycle]) result.lifecycle = entry.lifecycle;
                    return result;
                }
                var now = Date.now();
                var parsed = JSON.parse(localStorage.getItem(key) || '{}');
                var entries = Array.isArray(parsed.entries)
                    ? parsed.entries.map(function (entry) { return sanitizeEntry(entry, now); }).filter(Boolean)
                    : [];
                entries.push({
                    event: 'sw-offline-navigation',
                    at: now,
                    tabId: sessionStorage.getItem('pzp_redirect_diagnostics_tab_id') || 'sw-offline-page',
                    buildVersion: '',
                    swVersion: '${CACHE_NAME}',
                    route: normalizeRoute(location.pathname),
                    visibility: document.visibilityState || 'unknown',
                    lifecycle: 'offline-navigation',
                    status: 503,
                    reason: 'offline-navigation'
                });
                entries = entries.map(function (entry) { return sanitizeEntry(entry, now); }).filter(Boolean).slice(-maxEntries);
                var payload = JSON.stringify({ schema: 'eventgenix.redirect-diagnostics.v1', entries: entries });
                while (payload.length > maxBytes && entries.length > 0) {
                    entries = entries.slice(1);
                    payload = JSON.stringify({ schema: 'eventgenix.redirect-diagnostics.v1', entries: entries });
                }
                localStorage.setItem(key, payload);
            } catch (_) {}
        })();
        window.addEventListener('online', function () {
            setTimeout(function () { location.reload(); }, 100);
        }, { once: true });
    </script>
</body>
</html>`, {
        status: 503,
        statusText: 'Service Unavailable',
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store'
        }
    });
}

// ==========================================
// INSTALL — Pre-cache App Shell
// ==========================================

self.addEventListener('install', (event) => {
    console.log('[SW] Installing, cache:', CACHE_NAME);
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Caching App Shell assets');
                // Use addAll but don't fail install if some optional assets are missing
                return cache.addAll(APP_SHELL).catch((err) => {
                    console.warn('[SW] Some App Shell assets failed to cache, trying individually:', err);
                    // Fallback: try each asset individually, skip failures
                    return Promise.allSettled(
                        APP_SHELL.map((url) => cache.add(url).catch(() => {
                            console.warn('[SW] Failed to cache:', url);
                        }))
                    );
                });
            })
            .then(() => self.skipWaiting())
    );
});

// ==========================================
// ACTIVATE — Clean old caches
// ==========================================

self.addEventListener('activate', (event) => {
    console.log('[SW] Activating, cleaning old caches');
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => name !== CACHE_NAME && name !== API_CACHE_NAME)
                        .map((name) => {
                            console.log('[SW] Deleting old cache:', name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => clearOfflineMutationQueue())
            .then(() => self.clients.claim())
    );
});

self.addEventListener('message', (event) => {
    if (event?.data?.type !== 'redirect-diagnostics:get-version') return;
    try {
        event.ports?.[0]?.postMessage?.({
            type: 'redirect-diagnostics:version',
            swVersion: CACHE_NAME
        });
    } catch (err) {}
});

// ==========================================
// FETCH — Route to appropriate strategy
// ==========================================

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Only handle same-origin requests
    if (url.origin !== self.location.origin) {
        return;
    }

    const isApiRequest = url.pathname.startsWith('/api/');
    const method = event.request.method;

    // --- Mutations (POST/PUT/DELETE/PATCH to /api/*) ---
    if (isApiRequest && method !== 'GET') {
        event.respondWith(handleMutation(event.request));
        return;
    }

    // --- API GET requests ---
    if (isApiRequest && method === 'GET') {
        if (isApiCacheAllowed(event.request, url)) {
            event.respondWith(networkFirstWithCache(event.request));
        } else {
            event.respondWith(networkOnly(event.request));
        }
        return;
    }

    // --- Page navigations — network-first (never serve stale redirects from cache) ---
    if (event.request.mode === 'navigate') {
        event.respondWith(networkFirstPage(event.request));
        return;
    }

    // --- Static assets (App Shell) — cache-first ---
    if (isStaticRuntimeCacheAllowed(event.request, url)) {
        event.respondWith(cacheFirstWithNetwork(event.request));
    } else {
        event.respondWith(networkOnlyAsset(event.request));
    }
});

// ==========================================
// STRATEGIES
// ==========================================

/**
 * Cache-first strategy for static assets.
 * Serve from cache if available, fall back to network.
 */
async function cacheFirstWithNetwork(request) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
        return cachedResponse;
    }

    try {
        const networkResponse = await fetch(request);
        if (networkResponse.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch (err) {
        // If both cache and network fail, return offline fallback for navigation
        if (request.mode === 'navigate') {
            const fallback = await caches.match(OFFLINE_FALLBACK_URL);
            if (fallback) return fallback;
        }
        return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
    }
}

/**
 * Network-only strategy for sensitive API requests.
 * Do not fall back to Cache Storage for private CRM data.
 */
async function networkOnly(request) {
    try {
        return await fetch(request);
    } catch (err) {
        return new Response(
            JSON.stringify({ error: 'Offline', offline: true, cached: false }),
            {
                status: 503,
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-store'
                }
            }
        );
    }
}

async function networkOnlyAsset(request) {
    try {
        return await fetch(request);
    } catch (err) {
        return new Response('Offline', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Cache-Control': 'no-store' }
        });
    }
}

/**
 * Network-first strategy for navigations.
 * Cache shell pages separately from API data and fall back to the shell only.
 */
async function networkFirstPage(request) {
    try {
        const networkResponse = await fetch(request);
        if (networkResponse.ok) {
            const cache = await caches.open(CACHE_NAME);
            const pathname = new URL(request.url).pathname;
            if (pathname === '/' || pathname === OFFLINE_FALLBACK_URL) {
                const cacheKey = new Request(new URL(OFFLINE_FALLBACK_URL, self.location.origin).toString());
                cache.put(cacheKey, networkResponse.clone());
            }
        }
        return networkResponse;
    } catch (err) {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) return cachedResponse;

        const pathname = new URL(request.url).pathname;
        if (pathname === '/' || pathname === OFFLINE_FALLBACK_URL) {
            const shell = await caches.match(OFFLINE_FALLBACK_URL);
            if (shell) return shell;
        }

        return offlineNavigationResponse(request);
    }
}

/**
 * Network-first strategy for allowlisted public API GET requests.
 * Try network, cache successful responses, fall back to cache on failure.
 */
async function networkFirstWithCache(request) {
    try {
        const networkResponse = await fetch(request);
        if (networkResponse.ok) {
            const cache = await caches.open(API_CACHE_NAME);
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch (err) {
        // Network failed — try cache
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            console.log('[SW] Serving cached API response for:', request.url);
            return cachedResponse;
        }
        // No cache either — return error response
        return new Response(
            JSON.stringify({ error: 'Offline', offline: true }),
            {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
            }
        );
    }
}

/**
 * Handle mutation requests (POST/PUT/DELETE/PATCH).
 * Try network first. If offline, queue to IndexedDB via postMessage to client.
 */
async function handleMutation(request) {
    try {
        const response = await fetch(request.clone());
        return response;
    } catch (err) {
        if (!isMutationQueueAllowed(request)) {
            return new Response(
                JSON.stringify({
                    success: false,
                    offline: true,
                    queued: false,
                    error: 'Офлайн-черга вимкнена для цього запиту. Підключіться до інтернету і повторіть дію.'
                }),
                {
                    status: 503,
                    headers: {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'no-store'
                    }
                }
            );
        }

        // Network failed — queue the mutation for later sync
        console.log('[SW] Mutation failed (offline), queuing:', request.method, request.url);

        try {
            // Read the request body before it's consumed
            const body = await request.clone().text();
            const headers = {};
            for (const [key, value] of request.headers.entries()) {
                if (key === 'authorization' || key === 'content-type') {
                    headers[key] = value;
                }
            }

            // Notify all clients to queue this mutation
            const clients = await self.clients.matchAll({ type: 'window' });
            const mutationData = {
                type: 'QUEUE_MUTATION',
                mutation: {
                    method: request.method,
                    url: new URL(request.url).pathname + new URL(request.url).search,
                    body: body || null,
                    headers: headers
                }
            };

            for (const client of clients) {
                client.postMessage(mutationData);
            }
        } catch (queueErr) {
            console.error('[SW] Failed to queue mutation:', queueErr);
        }

        // Return an offline-aware response
        return new Response(
            JSON.stringify({
                success: false,
                offline: true,
                error: 'Збережено в черзі. Буде відправлено при підключенні.'
            }),
            {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
            }
        );
    }
}

// ==========================================
// BACKGROUND SYNC (where supported)
// ==========================================

self.addEventListener('sync', (event) => {
    if (event.tag === 'pzp-offline-sync') {
        console.log('[SW] Background sync triggered');
        event.waitUntil(notifyClientsToSync());
    }
});

/**
 * Notify client pages to run their sync logic.
 */
async function notifyClientsToSync() {
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) {
        client.postMessage({ type: 'SYNC_PENDING' });
    }
}

async function clearOfflineMutationQueue() {
    if (typeof indexedDB === 'undefined') return;

    await new Promise((resolve) => {
        const request = indexedDB.deleteDatabase(OFFLINE_DB_NAME);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
    });
}

async function clearPrivateCaches() {
    const cacheNames = await caches.keys();
    await Promise.all(
        cacheNames
            .filter((name) => name.startsWith(API_CACHE_PREFIX) || name.startsWith(RUNTIME_CACHE_PREFIX))
            .map((name) => {
                console.log('[SW] Clearing authenticated runtime cache:', name);
                return caches.delete(name);
            })
    );
    await clearOfflineMutationQueue();

    try {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(APP_SHELL);
    } catch (err) {
        console.warn('[SW] Public shell could not be restored after private cleanup:', err);
    }
}

// ==========================================
// MESSAGE HANDLING
// ==========================================

// ==========================================
// PUSH NOTIFICATIONS (Chat messages)
// ==========================================

self.addEventListener('push', (event) => {
    if (!event.data) return;

    let data;
    try {
        data = event.data.json();
    } catch (e) {
        data = { title: 'Нове повідомлення', body: event.data.text() };
    }

    const DINO_ICONS = ['🦕', '🦖', '🦎', '🐊', '🦴', '🌴'];
    const icon = data.icon || '/images/favicon-192.png';
    const dinoEmoji = DINO_ICONS[Math.floor(Math.random() * DINO_ICONS.length)];
    const title = (data.title || 'Event Genix Chat') + ' ' + dinoEmoji;
    const options = {
        body: data.body || 'Нове повідомлення',
        icon: icon,
        badge: '/images/favicon-192.png',
        tag: data.tag || 'chat-' + Date.now(),
        renotify: true,
        vibrate: [100, 50, 100, 50, 200],
        data: {
            url: data.url || '/chat.html',
            channelId: data.channelId || null
        },
        actions: [
            { action: 'open', title: 'Відкрити' },
            { action: 'dismiss', title: 'Потім' }
        ]
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    if (event.action === 'dismiss') return;

    const url = event.notification.data?.url || '/chat.html';
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clientList) => {
                for (const client of clientList) {
                    if (client.url.includes('/chat.html') && 'focus' in client) {
                        return client.focus();
                    }
                }
                return self.clients.openWindow(url);
            })
    );
});

// ==========================================
// MESSAGE HANDLING
// ==========================================

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }

    if (event.data && event.data.type === 'CLEAR_PRIVATE_CACHES') {
        const clearPromise = clearPrivateCaches();
        if (event.waitUntil) event.waitUntil(clearPromise);
    }

    // Allow client to request cache invalidation for a specific API path
    if (event.data && event.data.type === 'INVALIDATE_CACHE') {
        const path = event.data.path;
        if (path) {
            caches.open(API_CACHE_NAME).then((cache) => {
                cache.delete(new Request(self.location.origin + path));
                console.log('[SW] Cache invalidated for:', path);
            });
        }
    }
});

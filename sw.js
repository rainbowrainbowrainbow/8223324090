/**
 * sw.js — Service Worker for Event Genix
 * Feature #9: Offline support with App Shell caching.
 *
 * Security note: authenticated CRM API data is network-only by default. Do not
 * add API cache or mutation replay paths without checking data sensitivity.
 *
 * Integration: In index.html, add before </body>:
 *   <script>
 *     if ('serviceWorker' in navigator) {
 *       navigator.serviceWorker.register('/sw.js')
 *         .then(reg => console.log('[SW] Registered, scope:', reg.scope))
 *         .catch(err => console.error('[SW] Registration failed:', err));
 *     }
 *   </script>
 *
 * Integration: In index.html, add <script> tags:
 *   <script src="js/offline.js"></script>
 *   <script src="js/ws.js"></script>
 */

const CACHE_NAME = 'event-genix-v0.55.37';
const API_CACHE_NAME = 'event-genix-api-v0.55.37';

// App Shell — static assets to pre-cache on install
const APP_SHELL = [
    '/',
    '/index.html',
    '/manifest.json',
    // CSS modules (11 files)
    '/css/base.css',
    '/css/auth.css',
    '/css/layout.css',
    '/css/sidebar-aurora.css',
    '/css/timeline.css',
    '/css/panel.css',
    '/css/modals.css',
    '/css/controls.css',
    '/css/features.css',
    '/css/dark-mode.css',
    '/css/responsive.css',
    // JS modules (8 original + 2 new)
    '/js/config.js',
    '/js/api.js',
    '/js/ui.js',
    '/js/auth.js',
    '/js/timeline.js',
    '/js/booking.js',
    '/js/settings.js',
    '/js/app.js',
    '/js/ws.js',
    '/js/offline.js',
    // Images — logo, favicons, program icons
    '/images/logo-new.png',
    '/images/favicon-192.png',
    '/images/favicon-512.png',
    '/images/favicon.svg',
    '/images/apple-touch-icon.png',
    '/images/empty-state.png',
    '/images/icon-quest.png',
    '/images/icon-animation.png',
    '/images/icon-show.png',
    '/images/icon-photo.png',
    '/images/icon-masterclass.png',
    '/images/icon-pinata.png'
];

const API_CACHE_PREFIX = 'event-genix-api-';
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
    event.respondWith(cacheFirstWithNetwork(event.request));
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
            const fallback = await caches.match('/index.html');
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

/**
 * Network-first strategy for navigations.
 * Cache shell pages separately from API data and fall back to the shell only.
 */
async function networkFirstPage(request) {
    try {
        const networkResponse = await fetch(request);
        if (networkResponse.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch (err) {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) return cachedResponse;

        const shell = await caches.match('/index.html');
        if (shell) return shell;

        return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
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
            .filter((name) => name === API_CACHE_NAME || name.startsWith(API_CACHE_PREFIX))
            .map((name) => {
                console.log('[SW] Clearing private API cache:', name);
                return caches.delete(name);
            })
    );
    await clearOfflineMutationQueue();
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

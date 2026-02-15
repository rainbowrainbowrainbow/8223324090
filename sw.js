/**
 * sw.js — Service Worker for Парк Закревського Періоду Booking System
 * Feature #9: Offline support with App Shell caching and API data caching
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

const CACHE_NAME = 'park-booking-v9';
const API_CACHE_NAME = 'park-booking-api-v9';

// App Shell — static assets to pre-cache on install
const APP_SHELL = [
    '/',
    '/index.html',
    '/manifest.json',
    // CSS modules (10 files)
    '/css/base.css',
    '/css/auth.css',
    '/css/layout.css',
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

// API paths that should NEVER be cached
const NEVER_CACHE_PATHS = [
    '/api/auth/',
    '/api/telegram/',
    '/api/backup/'
];

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
        // Never cache auth, telegram, backup endpoints
        if (NEVER_CACHE_PATHS.some((p) => url.pathname.startsWith(p))) {
            return; // Let browser handle normally (network only)
        }
        event.respondWith(networkFirstWithCache(event.request));
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
 * Network-first strategy for API GET requests.
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

// ==========================================
// MESSAGE HANDLING
// ==========================================

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
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

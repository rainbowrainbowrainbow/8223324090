/**
 * js/offline.js — Offline Queue Manager for Парк Закревського Періоду
 * Feature #9: IndexedDB-based mutation queue with sync on reconnect
 *
 * Integration: In index.html, add before app.js:
 *   <script src="js/offline.js"></script>
 *
 * Uses IndexedDB to persist failed mutations (POST/PUT/DELETE/PATCH)
 * and replays them when connectivity is restored.
 *
 * Exports (browser globals):
 *   - OfflineQueue.queueMutation(method, url, body, headers)
 *   - OfflineQueue.syncPending()
 *   - OfflineQueue.getPendingCount()
 *   - OfflineQueue.clearQueue()
 *   - OfflineQueue.getPendingMutations()
 */

const OfflineQueue = (function () {
    'use strict';

    const DB_NAME = 'park-offline';
    const STORE_NAME = 'mutations';
    const DB_VERSION = 1;
    const MAX_RETRIES = 5;

    let _db = null;
    let _syncing = false;

    // ==========================================
    // IndexedDB SETUP
    // ==========================================

    /**
     * Open (or create) the IndexedDB database.
     * Returns a promise that resolves with the database instance.
     */
    function openDB() {
        if (_db) return Promise.resolve(_db);

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = function (event) {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                    store.createIndex('status', 'status', { unique: false });
                    console.log('[OfflineQueue] Created IndexedDB store:', STORE_NAME);
                }
            };

            request.onsuccess = function (event) {
                _db = event.target.result;

                // Handle database being closed unexpectedly
                _db.onclose = function () {
                    console.warn('[OfflineQueue] IndexedDB connection closed unexpectedly');
                    _db = null;
                };

                resolve(_db);
            };

            request.onerror = function (event) {
                console.error('[OfflineQueue] Failed to open IndexedDB:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    // ==========================================
    // QUEUE MUTATION
    // ==========================================

    /**
     * Queue a failed mutation for later replay.
     * @param {string} method - HTTP method (POST, PUT, DELETE, PATCH)
     * @param {string} url - API path (e.g. /api/bookings)
     * @param {string|object|null} body - Request body
     * @param {object} [headers] - Request headers (authorization, content-type)
     * @returns {Promise<string>} - ID of the queued mutation
     */
    async function queueMutation(method, url, body, headers) {
        try {
            const db = await openDB();
            const id = _generateId();

            const mutation = {
                id: id,
                timestamp: Date.now(),
                method: method,
                url: url,
                body: typeof body === 'string' ? body : (body ? JSON.stringify(body) : null),
                headers: headers || {},
                retryCount: 0,
                status: 'pending' // pending | syncing | failed | conflict
            };

            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const request = store.add(mutation);

                request.onsuccess = function () {
                    console.log('[OfflineQueue] Queued mutation:', method, url, '(id:', id, ')');
                    _notifyCountChange();
                    resolve(id);
                };

                request.onerror = function (event) {
                    console.error('[OfflineQueue] Failed to queue mutation:', event.target.error);
                    reject(event.target.error);
                };
            });
        } catch (err) {
            console.error('[OfflineQueue] queueMutation error:', err);
            throw err;
        }
    }

    // ==========================================
    // SYNC PENDING MUTATIONS
    // ==========================================

    /**
     * Replay all pending mutations in FIFO order.
     * Called when the browser goes online or via Background Sync.
     * @returns {Promise<{synced: number, failed: number, conflicts: number}>}
     */
    async function syncPending() {
        if (_syncing) {
            console.log('[OfflineQueue] Sync already in progress, skipping');
            return { synced: 0, failed: 0, conflicts: 0 };
        }

        _syncing = true;
        let synced = 0;
        let failed = 0;
        let conflicts = 0;

        try {
            const mutations = await _getAllPending();

            if (mutations.length === 0) {
                console.log('[OfflineQueue] No pending mutations to sync');
                _syncing = false;
                return { synced: 0, failed: 0, conflicts: 0 };
            }

            console.log('[OfflineQueue] Syncing', mutations.length, 'pending mutations...');

            // Process sequentially in FIFO order
            for (const mutation of mutations) {
                // Update status to syncing
                await _updateMutationStatus(mutation.id, 'syncing');

                try {
                    const response = await fetch(mutation.url, {
                        method: mutation.method,
                        headers: _buildHeaders(mutation.headers),
                        body: mutation.body
                    });

                    if (response.ok || (response.status >= 200 && response.status < 300)) {
                        // Success — remove from queue
                        await _removeMutation(mutation.id);
                        synced++;
                        console.log('[OfflineQueue] Synced:', mutation.method, mutation.url);
                    } else if (response.status === 409) {
                        // Conflict — mark for user resolution
                        await _updateMutationStatus(mutation.id, 'conflict');
                        conflicts++;
                        console.warn('[OfflineQueue] Conflict:', mutation.method, mutation.url);
                    } else if (response.status === 401) {
                        // Token expired — stop syncing, user needs to re-login
                        await _updateMutationStatus(mutation.id, 'pending');
                        console.warn('[OfflineQueue] Auth expired, pausing sync');
                        break;
                    } else if (response.status >= 500) {
                        // Server error — retry later
                        await _incrementRetry(mutation);
                        failed++;
                    } else {
                        // Other client errors (400, 404, etc.) — remove, don't retry
                        console.warn('[OfflineQueue] Client error', response.status, '— removing:', mutation.url);
                        await _removeMutation(mutation.id);
                        failed++;
                    }
                } catch (fetchErr) {
                    // Network still down — stop trying
                    await _updateMutationStatus(mutation.id, 'pending');
                    console.warn('[OfflineQueue] Still offline, stopping sync');
                    break;
                }
            }
        } catch (err) {
            console.error('[OfflineQueue] syncPending error:', err);
        }

        _syncing = false;
        _notifyCountChange();

        console.log('[OfflineQueue] Sync complete:', { synced, failed, conflicts });
        return { synced, failed, conflicts };
    }

    // ==========================================
    // QUERY HELPERS
    // ==========================================

    /**
     * Get the count of pending mutations.
     * @returns {Promise<number>}
     */
    async function getPendingCount() {
        try {
            const db = await openDB();
            return new Promise((resolve) => {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const request = store.count();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => resolve(0);
            });
        } catch (err) {
            return 0;
        }
    }

    /**
     * Get all pending mutations (for UI display).
     * @returns {Promise<Array>}
     */
    async function getPendingMutations() {
        try {
            return await _getAllPending();
        } catch (err) {
            return [];
        }
    }

    /**
     * Clear all mutations from the queue.
     * @returns {Promise<void>}
     */
    async function clearQueue() {
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const request = store.clear();
                request.onsuccess = () => {
                    console.log('[OfflineQueue] Queue cleared');
                    _notifyCountChange();
                    resolve();
                };
                request.onerror = (event) => reject(event.target.error);
            });
        } catch (err) {
            console.error('[OfflineQueue] clearQueue error:', err);
        }
    }

    // ==========================================
    // INTERNAL HELPERS
    // ==========================================

    /**
     * Generate a unique ID for a mutation entry.
     */
    function _generateId() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        // Fallback for older browsers
        return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 11);
    }

    /**
     * Get all mutations sorted by timestamp (FIFO).
     */
    async function _getAllPending() {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const index = store.index('timestamp');
            const request = index.getAll();

            request.onsuccess = () => {
                // Filter out mutations that exceeded max retries
                const mutations = (request.result || []).filter(
                    (m) => m.status !== 'failed' || m.retryCount < MAX_RETRIES
                );
                resolve(mutations);
            };
            request.onerror = (event) => reject(event.target.error);
        });
    }

    /**
     * Update the status of a mutation.
     */
    async function _updateMutationStatus(id, status) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const getRequest = store.get(id);

            getRequest.onsuccess = () => {
                const mutation = getRequest.result;
                if (!mutation) return resolve();
                mutation.status = status;
                const putRequest = store.put(mutation);
                putRequest.onsuccess = () => resolve();
                putRequest.onerror = (event) => reject(event.target.error);
            };
            getRequest.onerror = (event) => reject(event.target.error);
        });
    }

    /**
     * Increment retry count; mark as failed if max retries exceeded.
     */
    async function _incrementRetry(mutation) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const getRequest = store.get(mutation.id);

            getRequest.onsuccess = () => {
                const m = getRequest.result;
                if (!m) return resolve();
                m.retryCount = (m.retryCount || 0) + 1;
                m.status = m.retryCount >= MAX_RETRIES ? 'failed' : 'pending';
                const putRequest = store.put(m);
                putRequest.onsuccess = () => resolve();
                putRequest.onerror = (event) => reject(event.target.error);
            };
            getRequest.onerror = (event) => reject(event.target.error);
        });
    }

    /**
     * Remove a mutation from the queue.
     */
    async function _removeMutation(id) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = (event) => reject(event.target.error);
        });
    }

    /**
     * Build fetch headers from stored header object.
     * Refresh token from localStorage if available (token may have been refreshed).
     */
    function _buildHeaders(storedHeaders) {
        const headers = { ...storedHeaders };
        // Always use the freshest token available
        const token = localStorage.getItem('pzp_token');
        if (token) {
            headers['authorization'] = 'Bearer ' + token;
        }
        if (!headers['content-type'] && headers['Content-Type']) {
            headers['content-type'] = headers['Content-Type'];
        }
        return headers;
    }

    /**
     * Notify the page about queue count changes (for UI badge updates).
     */
    async function _notifyCountChange() {
        try {
            const count = await getPendingCount();
            // Dispatch a custom event for UI to listen to
            window.dispatchEvent(new CustomEvent('offlineQueueChange', {
                detail: { count: count }
            }));
        } catch (err) {
            // Ignore — UI update is non-critical
        }
    }

    // ==========================================
    // EVENT LISTENERS
    // ==========================================

    // Sync when coming back online
    window.addEventListener('online', function () {
        console.log('[OfflineQueue] Browser is online — syncing pending mutations');
        // Small delay to let network stabilize
        setTimeout(function () {
            syncPending();
        }, 1000);
    });

    // Listen for Service Worker messages to queue mutations
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', function (event) {
            if (event.data && event.data.type === 'QUEUE_MUTATION') {
                var m = event.data.mutation;
                queueMutation(m.method, m.url, m.body, m.headers);
            }
            if (event.data && event.data.type === 'SYNC_PENDING') {
                syncPending();
            }
        });
    }

    // Register for Background Sync if available
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
        navigator.serviceWorker.ready.then(function (registration) {
            // Request background sync whenever we go offline and have pending items
            window.addEventListener('offline', function () {
                getPendingCount().then(function (count) {
                    if (count > 0) {
                        registration.sync.register('pzp-offline-sync').catch(function (err) {
                            console.warn('[OfflineQueue] Background sync registration failed:', err);
                        });
                    }
                });
            });
        });
    }

    // ==========================================
    // PUBLIC API
    // ==========================================

    return {
        queueMutation: queueMutation,
        syncPending: syncPending,
        getPendingCount: getPendingCount,
        getPendingMutations: getPendingMutations,
        clearQueue: clearQueue
    };
})();

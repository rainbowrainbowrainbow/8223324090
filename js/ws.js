/**
 * js/ws.js — WebSocket client for real-time live-sync
 * Feature #10: Receives booking/line/settings updates via WebSocket
 *
 * Integration: In index.html, add before app.js:
 *   <script src="js/ws.js"></script>
 *
 * Then after successful login in js/app.js (or js/auth.js), call:
 *   ParkWS.connect();
 *
 * On logout, call:
 *   ParkWS.disconnect();
 *
 * Exports (browser globals):
 *   - ParkWS.connect()
 *   - ParkWS.disconnect()
 *   - ParkWS.isConnected()
 *   - ParkWS.subscribeDate(dateStr)
 *   - ParkWS.unsubscribeDate(dateStr)
 */

var ParkWS = (function () {
    'use strict';

    // Connection state
    var _ws = null;
    var _connected = false;
    var _intentionalClose = false;

    // Reconnection with exponential backoff
    var _reconnectAttempts = 0;
    var _reconnectTimer = null;
    var _reconnectDelays = [1000, 2000, 4000, 8000, 16000, 30000]; // max 30s

    // Currently subscribed dates
    var _subscribedDates = new Set();

    // ==========================================
    // CONNECT
    // ==========================================

    /**
     * Establish WebSocket connection.
     * Retrieves JWT token from localStorage and authenticates.
     */
    function connect() {
        // Don't connect if already connected or connecting
        if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        var token = localStorage.getItem('pzp_token');
        if (!token) {
            console.log('[WS] No auth token, skipping WebSocket connection');
            return;
        }

        // Don't connect when offline
        if (!navigator.onLine) {
            console.log('[WS] Browser is offline, deferring WebSocket connection');
            return;
        }

        _intentionalClose = false;

        // Build WebSocket URL
        var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        var wsUrl = protocol + '//' + window.location.host + '/ws';

        console.log('[WS] Connecting to:', wsUrl);

        try {
            _ws = new WebSocket(wsUrl);
        } catch (err) {
            console.error('[WS] Failed to create WebSocket:', err);
            _scheduleReconnect();
            return;
        }

        _ws.onopen = function () {
            console.log('[WS] Connection opened, authenticating...');
            // Send auth token as first message
            _send({
                type: 'auth',
                token: token
            });
        };

        _ws.onmessage = function (event) {
            _handleMessage(event.data);
        };

        _ws.onclose = function (event) {
            var wasConnected = _connected;
            _connected = false;
            _ws = null;

            console.log('[WS] Connection closed (code:', event.code, ', reason:', event.reason || 'none', ')');

            // Notify UI about disconnection
            _dispatchStatus(false);

            // Don't reconnect if intentionally closed or auth rejected
            if (_intentionalClose || event.code === 4001) {
                _reconnectAttempts = 0;
                return;
            }

            // Schedule reconnection
            if (wasConnected) {
                _reconnectAttempts = 0; // Reset on unexpected disconnect after being connected
            }
            _scheduleReconnect();
        };

        _ws.onerror = function (err) {
            console.error('[WS] Connection error');
            // onclose will be called after onerror
        };
    }

    // ==========================================
    // DISCONNECT
    // ==========================================

    /**
     * Intentionally disconnect the WebSocket.
     * Call this on logout.
     */
    function disconnect() {
        _intentionalClose = true;
        _connected = false;
        _reconnectAttempts = 0;
        _subscribedDates.clear();

        if (_reconnectTimer) {
            clearTimeout(_reconnectTimer);
            _reconnectTimer = null;
        }

        if (_ws) {
            try {
                _ws.close(1000, 'Client disconnect');
            } catch (err) {
                // Ignore close errors
            }
            _ws = null;
        }

        _dispatchStatus(false);
        console.log('[WS] Disconnected intentionally');
    }

    // ==========================================
    // CONNECTION STATUS
    // ==========================================

    /**
     * Check if WebSocket is currently connected and authenticated.
     * @returns {boolean}
     */
    function isConnected() {
        return _connected && _ws && _ws.readyState === WebSocket.OPEN;
    }

    // ==========================================
    // DATE SUBSCRIPTION
    // ==========================================

    /**
     * Subscribe to events for a specific date.
     * @param {string} dateStr - Date in YYYY-MM-DD format
     */
    function subscribeDate(dateStr) {
        _subscribedDates.add(dateStr);
        if (isConnected()) {
            _send({ type: 'JOIN_DATE', date: dateStr });
        }
    }

    /**
     * Unsubscribe from events for a specific date.
     * @param {string} dateStr - Date in YYYY-MM-DD format
     */
    function unsubscribeDate(dateStr) {
        _subscribedDates.delete(dateStr);
        if (isConnected()) {
            _send({ type: 'LEAVE_DATE', date: dateStr });
        }
    }

    // ==========================================
    // MESSAGE HANDLING
    // ==========================================

    /**
     * Handle incoming WebSocket message.
     */
    function _handleMessage(rawData) {
        var message;
        try {
            message = JSON.parse(rawData);
        } catch (err) {
            console.warn('[WS] Invalid JSON message:', rawData);
            return;
        }

        switch (message.type) {
            case 'auth:success':
                _connected = true;
                _reconnectAttempts = 0;
                console.log('[WS] Authenticated as:', message.payload.username,
                    '(clients:', message.payload.connectedClients, ')');
                _dispatchStatus(true);
                // Re-subscribe to previously subscribed dates
                _resubscribeDates();
                break;

            case 'error':
                console.warn('[WS] Server error:', message.message);
                break;

            case 'pong':
                // Server responded to our ping — connection is alive
                break;

            // Booking events
            case 'booking:created':
            case 'booking:updated':
            case 'booking:deleted':
            case 'booking:moved':
                _handleBookingEvent(message);
                break;

            // Line events
            case 'line:created':
            case 'line:updated':
            case 'line:deleted':
                _handleLineEvent(message);
                break;

            // Settings events
            case 'settings:updated':
                _handleSettingsEvent(message);
                break;

            default:
                console.log('[WS] Unknown event:', message.type);
                break;
        }
    }

    /**
     * Handle booking-related events.
     * Invalidates the booking cache and triggers timeline re-render.
     */
    function _handleBookingEvent(message) {
        console.log('[WS] Booking event:', message.type, message.payload);

        // Invalidate booking cache for the affected date
        var affectedDate = _extractDateFromPayload(message.payload);
        if (affectedDate && typeof AppState !== 'undefined' && AppState.cachedBookings) {
            delete AppState.cachedBookings[affectedDate];
        }

        // Invalidate SW API cache for the affected date
        _invalidateSWCache(affectedDate ? '/api/bookings/' + affectedDate : null);

        // Trigger timeline refresh
        _triggerTimelineRefresh();

        // Dispatch custom event for other modules
        window.dispatchEvent(new CustomEvent('ws:booking', {
            detail: { eventType: message.type, payload: message.payload }
        }));
    }

    /**
     * Handle line-related events.
     * Invalidates the lines cache and triggers timeline re-render.
     */
    function _handleLineEvent(message) {
        console.log('[WS] Line event:', message.type, message.payload);

        // Invalidate lines cache for the affected date
        var affectedDate = _extractDateFromPayload(message.payload);
        if (affectedDate && typeof AppState !== 'undefined' && AppState.cachedLines) {
            delete AppState.cachedLines[affectedDate];
        }

        // Invalidate SW API cache
        _invalidateSWCache(affectedDate ? '/api/lines/' + affectedDate : null);

        // Trigger timeline refresh
        _triggerTimelineRefresh();

        // Dispatch custom event
        window.dispatchEvent(new CustomEvent('ws:line', {
            detail: { eventType: message.type, payload: message.payload }
        }));
    }

    /**
     * Handle settings-related events.
     */
    function _handleSettingsEvent(message) {
        console.log('[WS] Settings event:', message.type, message.payload);

        // Dispatch custom event for settings panel to pick up
        window.dispatchEvent(new CustomEvent('ws:settings', {
            detail: { eventType: message.type, payload: message.payload }
        }));
    }

    // ==========================================
    // TIMELINE INTEGRATION
    // ==========================================

    /**
     * Trigger a timeline refresh by calling the existing renderTimeline() function.
     * Uses a debounce to avoid rapid-fire re-renders from multiple WS events.
     */
    var _refreshTimer = null;

    function _triggerTimelineRefresh() {
        if (_refreshTimer) {
            clearTimeout(_refreshTimer);
        }
        _refreshTimer = setTimeout(function () {
            _refreshTimer = null;
            if (typeof renderTimeline === 'function') {
                console.log('[WS] Triggering timeline refresh');
                renderTimeline();
            }
        }, 300); // 300ms debounce
    }

    /**
     * Extract the date (YYYY-MM-DD) from a WS event payload.
     * Looks for common date field names.
     */
    function _extractDateFromPayload(payload) {
        if (!payload) return null;
        return payload.date || payload.bookingDate || payload.dateStr || null;
    }

    // ==========================================
    // RECONNECTION
    // ==========================================

    /**
     * Schedule a reconnection attempt with exponential backoff.
     */
    function _scheduleReconnect() {
        if (_intentionalClose) return;
        if (_reconnectTimer) return;

        // Don't reconnect when offline — wait for online event
        if (!navigator.onLine) {
            console.log('[WS] Offline — will reconnect when online');
            return;
        }

        var delay = _reconnectDelays[Math.min(_reconnectAttempts, _reconnectDelays.length - 1)];
        _reconnectAttempts++;

        console.log('[WS] Reconnecting in', delay / 1000, 's (attempt', _reconnectAttempts, ')');

        _reconnectTimer = setTimeout(function () {
            _reconnectTimer = null;
            connect();
        }, delay);
    }

    /**
     * Re-subscribe to all previously subscribed dates after reconnection.
     */
    function _resubscribeDates() {
        for (var dateStr of _subscribedDates) {
            _send({ type: 'JOIN_DATE', date: dateStr });
        }
    }

    // ==========================================
    // NETWORK EVENTS
    // ==========================================

    // Resume reconnection when browser goes back online
    window.addEventListener('online', function () {
        console.log('[WS] Browser is online');
        if (!_connected && !_intentionalClose && localStorage.getItem('pzp_token')) {
            // Wait for offline queue sync to complete first, then reconnect
            setTimeout(function () {
                connect();
            }, 2000);
        }
    });

    // Pause reconnection when browser goes offline
    window.addEventListener('offline', function () {
        console.log('[WS] Browser is offline, pausing reconnection');
        if (_reconnectTimer) {
            clearTimeout(_reconnectTimer);
            _reconnectTimer = null;
        }
    });

    // ==========================================
    // UTILITY
    // ==========================================

    /**
     * Send a JSON message through the WebSocket.
     */
    function _send(obj) {
        if (_ws && _ws.readyState === WebSocket.OPEN) {
            try {
                _ws.send(JSON.stringify(obj));
            } catch (err) {
                console.error('[WS] Send error:', err);
            }
        }
    }

    /**
     * Dispatch a custom event to notify UI about connection status changes.
     */
    function _dispatchStatus(connected) {
        window.dispatchEvent(new CustomEvent('wsStatusChange', {
            detail: { connected: connected }
        }));
    }

    /**
     * Invalidate a path in the Service Worker API cache.
     */
    function _invalidateSWCache(path) {
        if (path && 'serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
                type: 'INVALIDATE_CACHE',
                path: path
            });
        }
    }

    // ==========================================
    // PUBLIC API
    // ==========================================

    return {
        connect: connect,
        disconnect: disconnect,
        isConnected: isConnected,
        subscribeDate: subscribeDate,
        unsubscribeDate: unsubscribeDate
    };
})();

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

    // v20.10.0: Debug logging (only when localStorage.pzp_debug = 'true')
    function _debug(...args) {
        if (localStorage.getItem('pzp_debug') === 'true') console.log(...args);
    }

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

    // Currently subscribed chat channels
    var _subscribedChannels = new Set();

    // Typing debounce timer
    var _typingTimer = null;

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
            _debug('[WS] No auth token, skipping WebSocket connection');
            return;
        }

        // Don't connect when offline
        if (!navigator.onLine) {
            _debug('[WS] Browser is offline, deferring WebSocket connection');
            return;
        }

        _intentionalClose = false;

        // Build WebSocket URL
        var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        var wsUrl = protocol + '//' + window.location.host + '/ws';

        _debug('[WS] Connecting to:', wsUrl);

        try {
            _ws = new WebSocket(wsUrl);
        } catch (err) {
            console.error('[WS] Failed to create WebSocket:', err);
            _scheduleReconnect();
            return;
        }

        _ws.onopen = function () {
            _debug('[WS] Connection opened, authenticating...');
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

            _debug('[WS] Connection closed (code:', event.code, ', reason:', event.reason || 'none', ')');

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
        _subscribedChannels.clear();

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
        _debug('[WS] Disconnected intentionally');
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
        if (!_isValidDate(dateStr) || _subscribedDates.has(dateStr)) return;
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
        if (!_isValidDate(dateStr) || !_subscribedDates.has(dateStr)) return;
        _subscribedDates.delete(dateStr);
        if (isConnected()) {
            _send({ type: 'LEAVE_DATE', date: dateStr });
        }
    }

    // ==========================================
    // MESSAGE HANDLING
    // ==========================================

    var _taskSignalMemory = new Map();

    function _taskSoundMuted() {
        try {
            if (window.crmMuteTaskSounds === true) return true;
            var mutedKeys = ['eg_task_sound_muted', 'crm_task_sound_muted', 'pzp_task_sound_muted', 'pzp_sound_muted'];
            return mutedKeys.some(function (key) {
                var value = localStorage.getItem(key);
                return value === 'true' || value === '1' || value === 'muted';
            });
        } catch (err) {
            return false;
        }
    }

    function setSubscribedDates(dateStrings) {
        var nextDates = new Set((Array.isArray(dateStrings) ? dateStrings : []).filter(_isValidDate));
        Array.from(_subscribedDates).forEach(function (dateStr) {
            if (!nextDates.has(dateStr)) unsubscribeDate(dateStr);
        });
        nextDates.forEach(function (dateStr) {
            if (!_subscribedDates.has(dateStr)) subscribeDate(dateStr);
        });
    }

    function _isValidDate(value) {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        var parsed = new Date(value + 'T00:00:00.000Z');
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    }

    function _taskArrivalSignalKey(payload) {
        var task = payload && payload.task ? payload.task : {};
        var id = payload && payload.notificationId
            ? payload.notificationId
            : [
                'task',
                payload && payload.assignmentEvent ? payload.assignmentEvent : 'assigned',
                task.id || task.taskId || task.task_id || 'unknown',
                task.ownerUserId || task.owner_user_id || 'owner'
            ].join(':');
        return String(id || '').trim();
    }

    function _shouldSignalTaskArrival(payload) {
        var key = _taskArrivalSignalKey(payload);
        if (!key) return true;
        var now = Date.now();
        var windowMs = 8000;
        var rememberedAt = Number(_taskSignalMemory.get(key) || 0);
        if (rememberedAt && now - rememberedAt < windowMs) return false;
        _taskSignalMemory.set(key, now);
        try {
            var storageKey = 'eg_task_signal_' + key.replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 96);
            var storedAt = Number(localStorage.getItem(storageKey) || 0);
            if (storedAt && now - storedAt < windowMs) return false;
            localStorage.setItem(storageKey, String(now));
        } catch (err) {}
        return true;
    }

    function _dispatchTaskAssignedRefresh(message) {
        var payload = message && message.payload ? message.payload : {};
        var task = payload.task || {};
        window.dispatchEvent(new CustomEvent('crm:tasks-updated', {
            detail: {
                source: 'ws_task_assigned',
                action: 'task_assigned',
                eventType: message.type,
                taskId: task.id || task.taskId || task.task_id || null,
                assignmentEvent: payload.assignmentEvent || 'assigned'
            }
        }));
    }

    function _playTaskAssignedSound() {
        try {
            if (_taskSoundMuted()) return;
            if (typeof SoundEngine !== 'undefined' && SoundEngine.playTask) {
                SoundEngine.playTask('task-new');
                return;
            }
            if (typeof SoundEngine !== 'undefined' && SoundEngine.play) {
                SoundEngine.play('task-new');
                return;
            }
            var AudioContextCtor = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextCtor) return;
            var ctx = new AudioContextCtor();
            var master = ctx.createGain();
            master.gain.setValueAtTime(0.0001, ctx.currentTime);
            master.gain.linearRampToValueAtTime(0.075, ctx.currentTime + 0.04);
            master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.50);
            master.connect(ctx.destination);
            [493.88, 659.25].forEach(function(freq, index) {
                var start = ctx.currentTime + index * 0.085;
                var osc = ctx.createOscillator();
                var gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, start);
                gain.gain.setValueAtTime(0.0001, start);
                gain.gain.linearRampToValueAtTime(index === 0 ? 0.72 : 0.56, start + 0.025);
                gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.34);
                osc.connect(gain);
                gain.connect(master);
                osc.start(start);
                osc.stop(start + 0.36);
            });
        } catch (err) {
            _debug('[WS] task assigned sound blocked:', err && err.message ? err.message : err);
        }
    }

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
                var wasReconnect = _reconnectAttempts > 0;
                _connected = true;
                _reconnectAttempts = 0;
                _debug('[WS] Authenticated as:', message.payload.username,
                    '(clients:', message.payload.connectedClients, ')');
                _dispatchStatus(true);
                // v21.14.0: Show synced toast on reconnect
                if (wasReconnect) {
                    _showConnectionToast('Синхронізовано', 'success');
                }
                // Re-subscribe to previously subscribed dates
                _resubscribeDates();
                if (wasReconnect) _reconcileTimelineAfterReconnect();
                // Fetch chat unread badge
                _updateChatBadge();
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
            case 'booking:banquet-link-updated':
                _handleBookingEvent(message);
                break;

            case 'banquet:arrival-updated':
            case 'banquet:booking-set-updated':
                _handleBanquetEvent(message);
                break;

            // Line events
            case 'line:created':
            case 'line:updated':
            case 'line:deleted':
            case 'timeline:roster-updated':
                _handleLineEvent(message);
                break;

            // Settings events
            case 'settings:updated':
                _handleSettingsEvent(message);
                break;

            // Chat events
            case 'chat:message':
                window.dispatchEvent(new CustomEvent('ws:chat', {
                    detail: { eventType: message.type, payload: message.payload }
                }));
                // Update unread badge + show toast on non-chat pages
                if (window.location.pathname !== '/chat') {
                    _incrementChatBadge();
                    var chatMsg = message.payload && message.payload.message;
                    if (chatMsg && typeof showNotification === 'function') {
                        var sender = chatMsg.displayName || chatMsg.username || '';
                        var preview = (chatMsg.content || '').substring(0, 60);
                        showNotification(sender + ': ' + preview);
                    }
                }
                break;
            case 'chat:typing':
            case 'chat:typing_stop':
            case 'chat:reaction':
            case 'chat:read':
            case 'chat:poll-update':
            case 'chat:poll-closed':
            case 'chat:mention':
            case 'chat:member-added':
            case 'chat:channel-invite':
            case 'chat:joined':
            case 'chat:left':
                window.dispatchEvent(new CustomEvent('ws:chat', {
                    detail: { eventType: message.type, payload: message.payload }
                }));
                break;

            // Guardian events
            case 'guardian:mood':
            case 'guardian:event':
                window.dispatchEvent(new CustomEvent('ws:chat', {
                    detail: { eventType: message.type, payload: message.payload }
                }));
                break;

            // Chat inline events (edits, mutes, deletes)
            case 'chat:message-edited':
            case 'chat:user-muted':
            case 'chat:delete':
                window.dispatchEvent(new CustomEvent('ws:chat', {
                    detail: { eventType: message.type, payload: message.payload }
                }));
                break;

            // Alert events (v39.7.0 — WS push replaces polling)
            case 'alert:updated':
                window.dispatchEvent(new CustomEvent('ws:alert', {
                    detail: { eventType: message.type, payload: message.payload }
                }));
                break;

            case 'hr:attendance-updated':
                window.dispatchEvent(new CustomEvent('ws:hr-attendance', {
                    detail: { eventType: message.type, payload: message.payload }
                }));
                break;

            case 'task:assigned':
                window.dispatchEvent(new CustomEvent('ws:task', {
                    detail: { eventType: message.type, payload: message.payload }
                }));
                _dispatchTaskAssignedRefresh(message);
                if (!_shouldSignalTaskArrival(message.payload || {})) break;
                _playTaskAssignedSound();
                if (typeof showNotification === 'function') {
                    var task = message.payload && message.payload.task;
                    showNotification('📋 Нова задача' + (task && task.title ? ': ' + String(task.title).slice(0, 80) : ''), 'success');
                }
                break;

            default:
                _debug('[WS] Unknown event:', message.type);
                break;
        }
    }

    /**
     * Handle booking-related events.
     * Invalidates the booking cache and triggers timeline re-render.
     */
    function _handleBookingEvent(message) {
        _debug('[WS] Booking event:', message.type, message.payload);
        if (!_payloadMatchesCurrentTimelineBusiness(message.payload)) {
            _debug('[WS] Ignoring booking event for another business context:', message.payload && message.payload.businessContext);
            return;
        }

        // Invalidate booking cache for the affected date
        var affectedDate = _extractDateFromPayload(message.payload);
        if (affectedDate && typeof AppState !== 'undefined' && AppState.cachedBookings) {
            window.invalidateTimelineDateCache?.(affectedDate, { lines: false });
        }

        // Invalidate SW API cache for the affected date
        _invalidateSWCache(affectedDate ? '/api/bookings/' + affectedDate : null);

        // Trigger timeline refresh
        _triggerTimelineRefresh();

        // Dispatch custom event for other modules
        window.dispatchEvent(new CustomEvent('ws:booking', {
            detail: { eventType: message.type, payload: message.payload }
        }));

        // v40.2: Toast notification for booking events (non-current-page)
        if (typeof showNotification === 'function' && window.location.pathname !== '/') {
            var p = message.payload || {};
            var label = p.label || p.programName || '';
            if (message.type === 'booking:created') showNotification('📅 Нове бронювання: ' + label);
            else if (message.type === 'booking:deleted') showNotification('🗑️ Скасовано: ' + label, 'warning');
        }
    }

    /**
     * Handle line-related events.
     * Invalidates the lines cache and triggers timeline re-render.
     */
    function _handleLineEvent(message) {
        _debug('[WS] Line event:', message.type, message.payload);
        if (!_payloadMatchesCurrentTimelineBusiness(message.payload)) {
            _debug('[WS] Ignoring line event for another business context:', message.payload && message.payload.businessContext);
            return;
        }

        // Invalidate lines cache for the affected date
        var affectedDate = _extractDateFromPayload(message.payload);
        if (affectedDate && typeof AppState !== 'undefined' && AppState.cachedLines) {
            window.invalidateTimelineDateCache?.(affectedDate, { bookings: false });
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
        _debug('[WS] Settings event:', message.type, message.payload);

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
                _debug('[WS] Triggering timeline refresh');
                renderTimeline();
            }
        }, 300); // 300ms debounce
    }

    function _handleBanquetEvent(message) {
        _debug('[WS] Banquet event:', message.type, message.payload);
        if (!_payloadMatchesCurrentTimelineBusiness(message.payload)) {
            _debug('[WS] Ignoring banquet event for another business context:', message.payload && message.payload.businessContext);
            return;
        }
        var payload = message.payload || {};
        var affectedDates = _extractDatesFromPayload(payload);
        var businessContext = _payloadBusinessContext(payload);
        var groupId = String(payload.groupId || payload.group_id || '').trim();
        affectedDates.forEach(function (affectedDate) {
            window.invalidateTimelineDateCache?.(affectedDate, {
                lines: false,
                bookings: true,
                fresh: true,
                businessContext: businessContext
            });
            _invalidateSWCache('/api/bookings/' + affectedDate);
        });
        if (groupId) {
            var previewInvalidation = {
                groupId: groupId,
                businessContext: businessContext
            };
            if (Array.isArray(payload.affectedBookingIds) && payload.affectedBookingIds.length) {
                previewInvalidation.bookingIds = payload.affectedBookingIds;
            }
            window.invalidateTimelineBanquetPreviewFreshness?.(previewInvalidation);
        }
        _triggerTimelineRefresh();
        window.dispatchEvent(new CustomEvent('ws:banquet', {
            detail: { eventType: message.type, payload: payload }
        }));
    }

    function _currentTimelineBusinessContext() {
        return window.TimelineBusinessContext?.state?.()?.activeBusinessContext
            || window.TimelineBusinessContext?.current?.()?.apiValue
            || window.TimelineBusinessContext?.current?.()?.key
            || window.CrmBusinessContext?.current?.()
            || 'event_genix';
    }

    function _payloadBusinessContext(payload) {
        return payload?.businessContext
            || payload?.business_context
            || payload?.context
            || payload?.booking?.businessContext
            || payload?.booking?.business_context
            || null;
    }

    function _payloadMatchesCurrentTimelineBusiness(payload) {
        var context = _payloadBusinessContext(payload);
        if (!context) return false;
        return String(context) === String(_currentTimelineBusinessContext());
    }

    /**
     * Extract the date (YYYY-MM-DD) from a WS event payload.
     * Looks for common date field names.
     */
    function _extractDateFromPayload(payload) {
        if (!payload) return null;
        return payload.date || payload.bookingDate || payload.dateStr || null;
    }

    function _extractDatesFromPayload(payload) {
        if (!payload) return [];
        var dates = [];
        if (Array.isArray(payload.affectedDates)) dates = dates.concat(payload.affectedDates);
        if (Array.isArray(payload.affected_dates)) dates = dates.concat(payload.affected_dates);
        dates.push(_extractDateFromPayload(payload));
        dates.push(payload.primaryBooking?.date || payload.primary_booking?.date || null);
        return [...new Set(dates
            .map(function (date) { return String(date || '').slice(0, 10); })
            .filter(function (date) { return /^\d{4}-\d{2}-\d{2}$/.test(date); }))];
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
            _debug('[WS] Offline — will reconnect when online');
            return;
        }

        var delay = _reconnectDelays[Math.min(_reconnectAttempts, _reconnectDelays.length - 1)];
        _reconnectAttempts++;

        _debug('[WS] Reconnecting in', delay / 1000, 's (attempt', _reconnectAttempts, ')');

        // v21.14.0: Show reconnecting toast on first attempt only
        if (_reconnectAttempts === 1) {
            _showConnectionToast('Перепідключення...', '');
        }

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
        // Also re-subscribe to chat channels
        for (var channelId of _subscribedChannels) {
            _send({ type: 'CHAT_JOIN', channelId: channelId });
        }
    }

    function _reconcileTimelineAfterReconnect() {
        var businessContext = _currentTimelineBusinessContext();
        for (var dateStr of _subscribedDates) {
            window.invalidateTimelineDateCache?.(dateStr, {
                lines: false,
                bookings: true,
                fresh: true,
                businessContext: businessContext
            });
            _invalidateSWCache('/api/bookings/' + dateStr);
        }
        window.invalidateTimelineBanquetPreviewFreshness?.({
            clearAll: true,
            businessContext: businessContext
        });
        _triggerTimelineRefresh();
        window.dispatchEvent(new CustomEvent('ws:reconnected', {
            detail: { businessContext: businessContext, dates: Array.from(_subscribedDates) }
        }));
    }

    // ==========================================
    // CHAT CHANNEL SUBSCRIPTION
    // ==========================================

    function joinChannel(channelId) {
        _subscribedChannels.add(channelId);
        if (isConnected()) {
            _send({ type: 'CHAT_JOIN', channelId: channelId });
        }
    }

    function leaveChannel(channelId) {
        _subscribedChannels.delete(channelId);
        if (isConnected()) {
            _send({ type: 'CHAT_LEAVE', channelId: channelId });
        }
    }

    function sendChatTyping(channelId) {
        if (!isConnected()) return;
        if (_typingTimer) return; // Already sent recently
        _send({ type: 'CHAT_TYPING', channelId: channelId });
        _typingTimer = setTimeout(function () { _typingTimer = null; }, 3000);
    }

    function send(obj) {
        _send(obj);
    }

    // ==========================================
    // NETWORK EVENTS
    // ==========================================

    // v21.14.0: UI toast helpers for connection status
    var _lastOfflineToastTime = 0;
    function _showConnectionToast(message, type) {
        if (typeof showNotification === 'function') {
            showNotification(message, type || '');
        }
    }

    // Resume reconnection when browser goes back online
    window.addEventListener('online', function () {
        _debug('[WS] Browser is online');
        _showConnectionToast('З\'єднання відновлено', 'success');
        if (!_connected && !_intentionalClose && localStorage.getItem('pzp_token')) {
            // Wait for offline queue sync to complete first, then reconnect
            setTimeout(function () {
                connect();
            }, 2000);
        }
    });

    // Pause reconnection when browser goes offline
    window.addEventListener('offline', function () {
        _debug('[WS] Browser is offline, pausing reconnection');
        _showConnectionToast('Ви офлайн — зміни збережені локально', 'error');
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
     * Fetch chat unread count and update the sidebar badge.
     */
    function _updateChatBadge() {
        var token = localStorage.getItem('pzp_token');
        if (!token) return;
        fetch('/api/chat/unread', { headers: { 'Authorization': 'Bearer ' + token } })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                if (data) _setChatBadge(data.total || 0);
            })
            .catch(function () {});
    }

    function _incrementChatBadge() {
        var badge = document.getElementById('chatUnreadBadge');
        if (!badge) return;
        var current = parseInt(badge.textContent || '0', 10);
        _setChatBadge(current + 1);
    }

    function _setChatBadge(count) {
        var badge = document.getElementById('chatUnreadBadge');
        if (!badge) return;
        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : String(count);
            badge.style.display = '';
        } else {
            badge.style.display = 'none';
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
        unsubscribeDate: unsubscribeDate,
        setSubscribedDates: setSubscribedDates,
        joinChannel: joinChannel,
        leaveChannel: leaveChannel,
        sendChatTyping: sendChatTyping,
        send: send
    };
})();

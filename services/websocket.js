/**
 * services/websocket.js — WebSocket server for real-time live-sync
 * Feature #10: WebSocket broadcasting for booking/line/settings changes
 *
 * Integration: In server.js, add after app.listen():
 *   const { initWebSocket } = require('./services/websocket');
 *   // Inside the .then() callback where `server` is assigned:
 *   initWebSocket(server);
 *
 * Then in route files (routes/bookings.js, routes/lines.js, routes/settings.js),
 * after successful DB commit, call:
 *   const { broadcast } = require('../services/websocket');
 *   broadcast('booking:created', bookingData, excludeUserId);
 *
 * Requires: npm install ws
 */

const { createLogger } = require('../utils/logger');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/auth');

const log = createLogger('WebSocket');

// WebSocket server instance
let _wss = null;

// Connected clients: Map<userId, Set<WebSocket>>
const _clients = new Map();

// Max connections per user (multiple tabs/devices)
const MAX_CONNECTIONS_PER_USER = 5;

// Heartbeat interval (ms)
const HEARTBEAT_INTERVAL = 30000;

// Missed pongs before disconnect
const MAX_MISSED_PONGS = 2;

// ==========================================
// INIT WebSocket SERVER
// ==========================================

/**
 * Initialize WebSocket server attached to the existing HTTP server.
 * @param {http.Server} httpServer - The Node.js HTTP server from app.listen()
 */
function initWebSocket(httpServer) {
    let WebSocket;
    try {
        WebSocket = require('ws');
    } catch (err) {
        log.warn('ws package not installed. WebSocket disabled. Run: npm install ws');
        return;
    }

    const { WebSocketServer } = WebSocket;

    _wss = new WebSocketServer({
        server: httpServer,
        path: '/ws',
        maxPayload: 64 * 1024 // 64KB max message size
    });

    log.info('WebSocket server initialized on path /ws');

    _wss.on('connection', (ws, req) => {
        _handleConnection(ws, req);
    });

    // Start heartbeat checker
    const heartbeatInterval = setInterval(() => {
        _heartbeat();
    }, HEARTBEAT_INTERVAL);

    // Clean up on server close
    _wss.on('close', () => {
        clearInterval(heartbeatInterval);
        log.info('WebSocket server closed');
    });

    return _wss;
}

// ==========================================
// CONNECTION HANDLING
// ==========================================

/**
 * Handle a new WebSocket connection.
 * The client must send an auth message with JWT token as the first message.
 */
function _handleConnection(ws, req) {
    // Track connection state
    ws._pzp = {
        authenticated: false,
        userId: null,
        username: null,
        role: null,
        subscribedDates: new Set(),
        missedPongs: 0,
        alive: true
    };

    // Set a timeout for authentication (10 seconds)
    const authTimeout = setTimeout(() => {
        if (!ws._pzp.authenticated) {
            _sendError(ws, 'Authentication timeout');
            ws.close(4001, 'Authentication timeout');
        }
    }, 10000);

    ws.on('message', (data) => {
        _handleMessage(ws, data, authTimeout);
    });

    ws.on('pong', () => {
        ws._pzp.alive = true;
        ws._pzp.missedPongs = 0;
    });

    ws.on('close', (code, reason) => {
        clearTimeout(authTimeout);
        _removeClient(ws);
        if (ws._pzp.authenticated) {
            log.info(`Client disconnected: ${ws._pzp.username} (code: ${code})`);
        }
    });

    ws.on('error', (err) => {
        log.error('WebSocket error:', err.message);
    });
}

/**
 * Handle incoming WebSocket message.
 */
function _handleMessage(ws, rawData, authTimeout) {
    let message;
    try {
        message = JSON.parse(rawData.toString());
    } catch (err) {
        _sendError(ws, 'Invalid JSON');
        return;
    }

    // First message must be auth
    if (!ws._pzp.authenticated) {
        if (message.type === 'auth' && message.token) {
            _authenticateClient(ws, message.token, authTimeout);
        } else {
            _sendError(ws, 'First message must be auth with token');
            ws.close(4001, 'Authentication required');
        }
        return;
    }

    // Handle authenticated messages
    switch (message.type) {
        case 'JOIN_DATE':
            if (message.date && typeof message.date === 'string') {
                ws._pzp.subscribedDates.add(message.date);
            }
            break;

        case 'LEAVE_DATE':
            if (message.date && typeof message.date === 'string') {
                ws._pzp.subscribedDates.delete(message.date);
            }
            break;

        case 'ping':
            _send(ws, { type: 'pong', timestamp: Date.now() });
            break;

        default:
            // Unknown message type — ignore
            break;
    }
}

/**
 * Authenticate client using JWT token.
 */
function _authenticateClient(ws, token, authTimeout) {
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        clearTimeout(authTimeout);

        ws._pzp.authenticated = true;
        ws._pzp.userId = String(decoded.id || decoded.userId || decoded.sub);
        ws._pzp.username = decoded.username || decoded.name || 'unknown';
        ws._pzp.role = decoded.role || 'viewer';

        // Track client connection
        _addClient(ws);

        // Send welcome message
        _send(ws, {
            type: 'auth:success',
            payload: {
                userId: ws._pzp.userId,
                username: ws._pzp.username,
                connectedClients: getConnectedClientsCount()
            }
        });

        log.info(`Client authenticated: ${ws._pzp.username} (userId: ${ws._pzp.userId})`);
    } catch (err) {
        _sendError(ws, 'Invalid or expired token');
        ws.close(4001, 'Invalid token');
    }
}

// ==========================================
// CLIENT TRACKING
// ==========================================

/**
 * Add a client to the tracking map.
 */
function _addClient(ws) {
    const userId = ws._pzp.userId;
    if (!_clients.has(userId)) {
        _clients.set(userId, new Set());
    }

    const userConnections = _clients.get(userId);

    // Enforce max connections per user
    if (userConnections.size >= MAX_CONNECTIONS_PER_USER) {
        // Close the oldest connection
        const oldest = userConnections.values().next().value;
        if (oldest && oldest.readyState === 1) { // OPEN
            _send(oldest, { type: 'error', message: 'Too many connections, closing oldest' });
            oldest.close(4002, 'Too many connections');
        }
        userConnections.delete(oldest);
    }

    userConnections.add(ws);
}

/**
 * Remove a client from the tracking map.
 */
function _removeClient(ws) {
    const userId = ws._pzp.userId;
    if (!userId) return;

    const userConnections = _clients.get(userId);
    if (userConnections) {
        userConnections.delete(ws);
        if (userConnections.size === 0) {
            _clients.delete(userId);
        }
    }
}

/**
 * Get total count of connected (authenticated) clients.
 */
function getConnectedClientsCount() {
    let count = 0;
    for (const connections of _clients.values()) {
        count += connections.size;
    }
    return count;
}

// ==========================================
// BROADCAST
// ==========================================

/**
 * Broadcast an event to all connected clients.
 * @param {string} eventType - Event type (e.g. 'booking:created', 'line:updated', 'settings:updated')
 * @param {object} data - Event payload
 * @param {string|null} [excludeUserId] - User ID to exclude from broadcast (the user who made the change)
 * @param {string|null} [date] - Optional date string (YYYY-MM-DD) to filter by subscribed dates
 */
function broadcast(eventType, data, excludeUserId, date) {
    if (!_wss) return;

    const message = JSON.stringify({
        type: eventType,
        payload: data || {},
        meta: {
            timestamp: new Date().toISOString(),
            excludedUser: excludeUserId || null
        }
    });

    let sent = 0;

    for (const [userId, connections] of _clients) {
        // Skip the user who made the change (they already have the response)
        if (excludeUserId && userId === excludeUserId) continue;

        for (const ws of connections) {
            if (ws.readyState !== 1) continue; // Only send to OPEN connections

            // If date filtering is requested, only send to clients subscribed to that date
            if (date && ws._pzp.subscribedDates.size > 0 && !ws._pzp.subscribedDates.has(date)) {
                continue;
            }

            try {
                ws.send(message);
                sent++;
            } catch (err) {
                log.error('Broadcast send error:', err.message);
            }
        }
    }

    if (sent > 0) {
        log.info(`Broadcast [${eventType}] to ${sent} client(s)` + (date ? ` for date ${date}` : ''));
    }
}

/**
 * Send a message to a specific user (all their connections).
 * @param {string} userId - Target user ID
 * @param {string} eventType - Event type
 * @param {object} data - Event payload
 */
function sendToUser(userId, eventType, data) {
    const connections = _clients.get(userId);
    if (!connections) return;

    const message = JSON.stringify({
        type: eventType,
        payload: data || {},
        meta: { timestamp: new Date().toISOString() }
    });

    for (const ws of connections) {
        if (ws.readyState === 1) {
            try {
                ws.send(message);
            } catch (err) {
                log.error('sendToUser error:', err.message);
            }
        }
    }
}

/**
 * Send a message to a specific user by username (all their connections).
 * Useful for Kleshnya webhook where we know username but not userId.
 * @param {string} username - Target username
 * @param {string} eventType - Event type
 * @param {object} data - Event payload
 */
function sendToUsername(username, eventType, data) {
    if (!_wss) return;

    const message = JSON.stringify({
        type: eventType,
        payload: data || {},
        meta: { timestamp: new Date().toISOString() }
    });

    let sent = 0;
    for (const [, connections] of _clients) {
        for (const ws of connections) {
            if (ws._pzp.username === username && ws.readyState === 1) {
                try {
                    ws.send(message);
                    sent++;
                } catch (err) {
                    log.error('sendToUsername error:', err.message);
                }
            }
        }
    }

    if (sent > 0) {
        log.info(`sendToUsername [${eventType}] to ${username}: ${sent} connection(s)`);
    }
}

// ==========================================
// HEARTBEAT
// ==========================================

/**
 * Ping all clients and disconnect stale ones.
 */
function _heartbeat() {
    if (!_wss) return;

    for (const [userId, connections] of _clients) {
        for (const ws of connections) {
            if (!ws._pzp.alive) {
                ws._pzp.missedPongs++;
                if (ws._pzp.missedPongs >= MAX_MISSED_PONGS) {
                    log.info(`Client ${ws._pzp.username} missed ${MAX_MISSED_PONGS} pongs, disconnecting`);
                    ws.terminate();
                    connections.delete(ws);
                    continue;
                }
            }

            ws._pzp.alive = false;
            try {
                ws.ping();
            } catch (err) {
                // Connection already dead
                connections.delete(ws);
            }
        }

        // Clean up empty user entries
        if (connections.size === 0) {
            _clients.delete(userId);
        }
    }
}

// ==========================================
// UTILITY
// ==========================================

/**
 * Send a JSON message to a specific WebSocket.
 */
function _send(ws, obj) {
    if (ws.readyState === 1) {
        try {
            ws.send(JSON.stringify(obj));
        } catch (err) {
            log.error('Send error:', err.message);
        }
    }
}

/**
 * Send an error message to a specific WebSocket.
 */
function _sendError(ws, message) {
    _send(ws, { type: 'error', message: message });
}

/**
 * Get the WebSocket server instance (for testing or shutdown).
 */
function getWSS() {
    return _wss;
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
    initWebSocket,
    broadcast,
    sendToUser,
    sendToUsername,
    getConnectedClientsCount,
    getWSS
};

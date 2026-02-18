/**
 * server.js — Entry point (v5.29: structured logging)
 *
 * Slim entry point that wires together all modules.
 * Each module lives in its own file under db/, middleware/, services/, routes/.
 */
const express = require('express');
const path = require('path');
const cors = require('cors');

// --- Core modules ---
const { pool, initDatabase } = require('./db');
const { authenticateToken } = require('./middleware/auth');
const { rateLimiter, loginRateLimiter } = require('./middleware/rateLimit');
const { cacheControl, securityHeaders } = require('./middleware/security');
const { requestIdMiddleware } = require('./middleware/requestId');
const { ensureWebhook, getConfiguredChatId, TELEGRAM_BOT_TOKEN, TELEGRAM_DEFAULT_CHAT_ID, drainTelegramRequests, getInFlightCount } = require('./services/telegram');
const { checkAutoDigest, checkAutoReminder, checkAutoBackup, checkRecurringTasks, checkScheduledDeletions, checkRecurringAfisha, checkCertificateExpiry, checkTaskReminders, checkWorkDayTriggers, checkMonthlyPointsReset, checkStreakUpdates } = require('./services/scheduler');
const { cleanupExpired: cleanupKleshnyaMessages } = require('./services/kleshnya-greeting');
const { processStaleMessages, BRIDGE_ENABLED: OPENCLAW_BRIDGE } = require('./services/kleshnya-bridge');
const { createLogger } = require('./utils/logger');
const { validateEnv } = require('./utils/validateEnv');
const { initWebSocket, getWSS } = require('./services/websocket');
const { runMigrations } = require('./db/migrate');

const log = createLogger('Server');

// Validate environment variables before anything else
validateEnv();

// --- Express app setup ---
const app = express();
const PORT = process.env.PORT || 3000;

// Global middleware
app.use(cors({
    origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        const domain = process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost';
        try {
            const host = new URL(origin).hostname;
            cb(null, host === domain || host === 'localhost');
        } catch { cb(null, false); }
    }
}));
app.use(express.json({ limit: '1mb' }));
app.use(requestIdMiddleware);
app.use(securityHeaders);
app.use(cacheControl);
app.use(express.static(path.join(__dirname)));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Graceful shutdown: reject new requests while shutting down
let isShuttingDown = false;
app.use((req, res, next) => {
    if (isShuttingDown) {
        res.set('Connection', 'close');
        return res.status(503).json({ error: 'Server is shutting down' });
    }
    next();
});

// Rate limiter for all API routes
app.use('/api', rateLimiter);

// Auth middleware: protect all API endpoints except public ones
app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/auth/') || req.path === '/health' || req.path.startsWith('/telegram/webhook') || req.path === '/kleshnya/webhook' || req.path === '/kleshnya/pending-messages' || req.path === '/kleshnya/sync-chat') {
        return next();
    }
    authenticateToken(req, res, next);
});

// Login rate limiter (stricter: 5 attempts per minute)
app.use('/api/auth/login', loginRateLimiter);

// --- Mount route modules ---
app.use('/api/auth', require('./routes/auth'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/lines', require('./routes/lines'));
app.use('/api/history', require('./routes/history'));
app.use('/api/afisha', require('./routes/afisha'));
app.use('/api/telegram', require('./routes/telegram'));
app.use('/api/backup/restore', express.json({ limit: '50mb' }));
app.use('/api/backup', require('./routes/backup'));
app.use('/api/products', require('./routes/products'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/task-templates', require('./routes/task-templates'));
app.use('/api/staff', require('./routes/staff'));
app.use('/api/certificates', require('./routes/certificates'));
app.use('/api/points', require('./routes/points'));
app.use('/api/kleshnya', require('./routes/kleshnya'));
app.use('/api/designs', require('./routes/designs'));
app.use('/api/contractors', require('./routes/contractors'));

// Analytics dashboard (revenue, programs, load, trends) — must be before settingsRouter
app.use('/api/stats', require('./routes/stats'));

// Settings router handles /api/stats/:from/:to, /api/settings, /api/rooms, /api/health
const settingsRouter = require('./routes/settings');
app.use('/api', settingsRouter);

// --- Daily digest endpoint (Task 6) ---
app.get('/api/shifts/daily-digest', async (req, res) => {
    try {
        const { getKyivDateStr } = require('./services/booking');
        const { buildAndSendDigest } = require('./services/scheduler');
        const todayStr = getKyivDateStr();

        // Also gather today's tasks
        const tasksResult = await pool.query(
            "SELECT title, status, priority FROM tasks WHERE date = $1 ORDER BY priority DESC, created_at",
            [todayStr]
        );

        // Send digest via existing scheduler logic (bookings + afisha)
        const digestResult = await buildAndSendDigest(todayStr);

        // If there are tasks, send a separate tasks digest
        if (tasksResult.rows.length > 0) {
            const { sendTelegramMessage, getConfiguredChatId } = require('./services/telegram');
            const chatId = await getConfiguredChatId();
            if (chatId) {
                const [y, m, d] = todayStr.split('-');
                let taskText = `📝 <b>ЗАДАЧІ НА ${d}.${m}.${y}</b>\n\n`;
                for (const task of tasksResult.rows) {
                    const icon = task.status === 'done' ? '✅' : task.status === 'in_progress' ? '🔄' : '⬜';
                    taskText += `${icon} ${task.title}\n`;
                }
                await sendTelegramMessage(chatId, taskText);
            }
        }

        res.json({
            success: true,
            date: todayStr,
            bookings: digestResult?.count || 0,
            tasks: tasksResult.rows.length
        });
    } catch (err) {
        log.error('Daily digest endpoint error', err);
        res.status(500).json({ error: 'Failed to send digest' });
    }
});

// --- Static pages ---
app.get('/invite', (req, res) => {
    res.sendFile(path.join(__dirname, 'invite.html'));
});

// v7.8: Standalone pages
app.get('/tasks', (req, res) => {
    res.sendFile(path.join(__dirname, 'tasks.html'));
});
app.get('/programs', (req, res) => {
    res.sendFile(path.join(__dirname, 'programs.html'));
});
app.get('/staff', (req, res) => {
    res.sendFile(path.join(__dirname, 'staff.html'));
});
app.get('/kleshnya', (req, res) => {
    res.sendFile(path.join(__dirname, 'kleshnya.html'));
});
app.get('/designs', (req, res) => {
    res.sendFile(path.join(__dirname, 'designs.html'));
});

// SPA fallback (must be last)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Global error handler
app.use((err, req, res, next) => {
    log.error('Unhandled express error', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Process-level error handlers
process.on('unhandledRejection', (reason) => {
    log.error('Unhandled promise rejection', reason);
});
process.on('uncaughtException', (err) => {
    log.error('Uncaught exception', err);
    process.exit(1);
});

// --- Start server ---
let server;
const schedulerIntervals = [];

initDatabase().then(() => {
    return runMigrations(pool);
}).catch(err => {
    log.error('Failed to initialize database, exiting', err);
    process.exit(1);
}).then(() => {
    server = app.listen(PORT, async () => {
        log.info(`Server running on port ${PORT}`);
        log.info(`Telegram bot token: ${TELEGRAM_BOT_TOKEN ? 'SET' : 'NOT SET'}`);
        log.info(`Telegram default chat ID: ${TELEGRAM_DEFAULT_CHAT_ID || 'NOT SET'}`);
        try {
            const dbChatId = await getConfiguredChatId();
            log.info(`Telegram effective chat ID: ${dbChatId || 'NONE'}`);
        } catch (e) { /* ignore */ }

        // v11.0.5: Clear greeting cache on startup (ensures fresh templates after deploy)
        try {
            const { pool: dbPool } = require('./db');
            await dbPool.query("DELETE FROM kleshnya_messages WHERE scope = 'daily_greeting'");
            log.info('Greeting cache cleared on startup');
        } catch (e) { log.error('Failed to clear greeting cache', e); }

        // Setup Telegram webhook + bot menu on start
        const appUrl = process.env.RAILWAY_PUBLIC_DOMAIN
            ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
            : null;
        if (appUrl) {
            ensureWebhook(appUrl).catch(err => log.error('Webhook auto-setup error', err));
        }

        // v11.1: Register bot commands (Telegram menu button)
        try {
            const { registerBotCommands } = require('./services/bot');
            registerBotCommands().catch(err => log.error('Bot commands registration error', err));
        } catch (e) { log.error('Failed to register bot commands', e); }

        // Schedulers: digest + reminder + backup + recurring + auto-delete (check every 60s)
        schedulerIntervals.push(setInterval(checkAutoDigest, 60000));
        schedulerIntervals.push(setInterval(checkAutoReminder, 60000));
        schedulerIntervals.push(setInterval(checkAutoBackup, 60000));
        schedulerIntervals.push(setInterval(checkRecurringTasks, 60000));
        schedulerIntervals.push(setInterval(checkRecurringAfisha, 60000));
        schedulerIntervals.push(setInterval(checkScheduledDeletions, 60000));
        schedulerIntervals.push(setInterval(checkCertificateExpiry, 60000));
        // v10.0: Kleshnya schedulers
        schedulerIntervals.push(setInterval(checkTaskReminders, 60000));
        schedulerIntervals.push(setInterval(checkWorkDayTriggers, 60000));
        schedulerIntervals.push(setInterval(checkMonthlyPointsReset, 60000));
        // v13.1: OpenClaw bridge fallback — process stale pending messages (every 30s)
        if (OPENCLAW_BRIDGE) {
            const { generateChatResponse } = require('./services/kleshnya-chat');
            const { getChatHistory, addChatMessage } = require('./services/kleshnya-greeting');
            const { sendToUsername } = require('./services/websocket');
            schedulerIntervals.push(setInterval(
                () => processStaleMessages(generateChatResponse, addChatMessage, getChatHistory, sendToUsername),
                30000
            ));
        }
        // v11.0: Kleshnya greeting cache cleanup (every 30min)
        schedulerIntervals.push(setInterval(cleanupKleshnyaMessages, 30 * 60 * 1000));
        // v11.1: Streak auto-update (daily at 23:55)
        schedulerIntervals.push(setInterval(checkStreakUpdates, 60000));
        log.info('Schedulers started: digest + reminder + backup + recurring + afisha + auto-delete + cert-expiry + kleshnya + greeting-cleanup + streaks');

        // WebSocket: attach to HTTP server for live-sync
        initWebSocket(server);
    });
});

// --- Graceful Shutdown ---
async function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    log.info(`${signal} received. Starting graceful shutdown...`);

    // Force exit after 30s if graceful shutdown hangs
    const forceExitTimeout = setTimeout(() => {
        log.error('Graceful shutdown timed out after 30s, forcing exit');
        process.exit(1);
    }, 30000);
    forceExitTimeout.unref(); // Don't keep process alive just for this timer

    // 1. Stop accepting new connections
    if (server) {
        server.close(() => {
            log.info('HTTP server closed');
        });
    }

    // 2. Clear all scheduler intervals
    for (const id of schedulerIntervals) {
        clearInterval(id);
    }
    log.info(`${schedulerIntervals.length} scheduler interval(s) cleared`);

    // 3. Close WebSocket server
    const wss = getWSS();
    if (wss) {
        wss.close();
        log.info('WebSocket server closed');
    }

    // 4. Drain in-flight Telegram requests before closing DB
    const inFlight = getInFlightCount();
    if (inFlight > 0) {
        try {
            log.info(`Draining ${inFlight} in-flight Telegram request(s)...`);
            await drainTelegramRequests(5000);
            log.info('Telegram requests drained');
        } catch (e) {
            log.warn(`Telegram drain timeout: ${e.message}`);
        }
    }

    // 5. Close DB pool (waits for active queries to finish)
    try {
        await pool.end();
        log.info('Database pool closed');
    } catch (e) {
        log.error('Error closing database pool', e);
    }

    log.info('Graceful shutdown complete');
    process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

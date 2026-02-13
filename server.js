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
const { ensureWebhook, getConfiguredChatId, TELEGRAM_BOT_TOKEN, TELEGRAM_DEFAULT_CHAT_ID } = require('./services/telegram');
const { checkAutoDigest, checkAutoReminder, checkAutoBackup, checkRecurringTasks, checkScheduledDeletions, checkRecurringAfisha, checkCertificateExpiry } = require('./services/scheduler');
const { createLogger } = require('./utils/logger');

const log = createLogger('Server');

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

// Rate limiter for all API routes
app.use('/api', rateLimiter);

// Auth middleware: protect all API endpoints except public ones
app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/auth/') || req.path === '/health' || req.path.startsWith('/telegram/webhook')) {
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
app.use('/api/backup', require('./routes/backup'));
app.use('/api/products', require('./routes/products'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/task-templates', require('./routes/task-templates'));
app.use('/api/staff', require('./routes/staff'));
app.use('/api/certificates', require('./routes/certificates'));

// Settings router handles /api/stats, /api/settings, /api/rooms, /api/health
const settingsRouter = require('./routes/settings');
app.use('/api', settingsRouter);

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
initDatabase().catch(err => {
    log.error('Failed to initialize database, exiting', err);
    process.exit(1);
}).then(() => {
    app.listen(PORT, async () => {
        log.info(`Server running on port ${PORT}`);
        log.info(`Telegram bot token: ${TELEGRAM_BOT_TOKEN ? 'SET' : 'NOT SET'}`);
        log.info(`Telegram default chat ID: ${TELEGRAM_DEFAULT_CHAT_ID || 'NOT SET'}`);
        try {
            const dbChatId = await getConfiguredChatId();
            log.info(`Telegram effective chat ID: ${dbChatId || 'NONE'}`);
        } catch (e) { /* ignore */ }

        // Setup Telegram webhook on start
        const appUrl = process.env.RAILWAY_PUBLIC_DOMAIN
            ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
            : null;
        if (appUrl) {
            ensureWebhook(appUrl).catch(err => log.error('Webhook auto-setup error', err));
        }

        // Schedulers: digest + reminder + backup + recurring + auto-delete (check every 60s)
        setInterval(checkAutoDigest, 60000);
        setInterval(checkAutoReminder, 60000);
        setInterval(checkAutoBackup, 60000);
        setInterval(checkRecurringTasks, 60000);
        setInterval(checkRecurringAfisha, 60000);
        setInterval(checkScheduledDeletions, 60000);
        setInterval(checkCertificateExpiry, 60000);
        log.info('Schedulers started: digest + reminder + backup + recurring + afisha + auto-delete + cert-expiry (every 60s)');
    });
});

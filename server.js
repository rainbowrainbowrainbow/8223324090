/**
 * server.js — Entry point (v5.28: modular architecture)
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
const { rateLimiter } = require('./middleware/rateLimit');
const { cacheControl } = require('./middleware/security');
const { ensureWebhook, getConfiguredChatId, TELEGRAM_BOT_TOKEN, TELEGRAM_DEFAULT_CHAT_ID } = require('./services/telegram');
const { checkAutoDigest, checkAutoReminder, checkAutoBackup } = require('./services/scheduler');

// --- Express app setup ---
const app = express();
const PORT = process.env.PORT || 3000;

// Global middleware
app.use(cors({ origin: (origin, cb) => cb(null, !origin || origin.includes(process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost')) }));
app.use(express.json());
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

// --- Mount route modules ---
app.use('/api/auth', require('./routes/auth'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/lines', require('./routes/lines'));
app.use('/api/history', require('./routes/history'));
app.use('/api/afisha', require('./routes/afisha'));
app.use('/api/telegram', require('./routes/telegram'));
app.use('/api/backup', require('./routes/backup'));

// Settings router handles /api/stats, /api/settings, /api/rooms, /api/health
const settingsRouter = require('./routes/settings');
app.use('/api', settingsRouter);

// --- Static pages ---
app.get('/invite', (req, res) => {
    res.sendFile(path.join(__dirname, 'invite.html'));
});

// SPA fallback (must be last)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- Start server ---
initDatabase().then(() => {
    app.listen(PORT, async () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`[Telegram Config] Bot token: ${TELEGRAM_BOT_TOKEN ? 'SET (' + TELEGRAM_BOT_TOKEN.slice(0, 8) + '...)' : 'NOT SET'}`);
        console.log(`[Telegram Config] Default chat ID: ${TELEGRAM_DEFAULT_CHAT_ID || 'NOT SET'}`);
        try {
            const dbChatId = await getConfiguredChatId();
            console.log(`[Telegram Config] Effective chat ID: ${dbChatId || 'NONE'}`);
        } catch (e) { /* ignore */ }

        // Setup Telegram webhook on start
        const appUrl = process.env.RAILWAY_PUBLIC_DOMAIN
            ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
            : null;
        if (appUrl) {
            ensureWebhook(appUrl).catch(err => console.error('Webhook auto-setup error:', err));
        }

        // Schedulers: digest + reminder + backup (check every 60s)
        setInterval(checkAutoDigest, 60000);
        setInterval(checkAutoReminder, 60000);
        setInterval(checkAutoBackup, 60000);
        console.log('[Scheduler] Digest + Reminder + Backup schedulers started (checks every 60s)');
    });
});

/**
 * server.js — Entry point (v5.25: Error handling & validation)
 *
 * Thin orchestrator: imports modules, mounts routes, starts schedulers.
 * All business logic lives in services/, routes/, middleware/.
 */

const express = require('express');
const path = require('path');
const cors = require('cors');

// --- Modules ---
const { pool, initDatabase } = require('./db');
const { authenticateToken } = require('./middleware/auth');
const { rateLimiter } = require('./middleware/rateLimit');
const { cacheControl, securityHeaders } = require('./middleware/security');
const { errorHandler } = require('./middleware/errorHandler');
const { getKyivDateStr, getKyivTimeStr } = require('./services/booking');
const telegram = require('./services/telegram');

// --- Routes ---
const authRoutes = require('./routes/auth');
const bookingRoutes = require('./routes/bookings');
const lineRoutes = require('./routes/lines');
const historyRoutes = require('./routes/history');
const settingsRoutes = require('./routes/settings');
const adminRoutes = require('./routes/admin');
const telegramRoutes = require('./routes/telegram');
const afishaRoutes = require('./routes/afisha');
const backupRoutes = require('./routes/backup');

const { buildAndSendDigest, sendTomorrowReminder } = require('./routes/telegram');
const { sendBackupToTelegram } = require('./routes/backup');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Global Middleware ---
app.use(cors({
    origin: (origin, cb) => cb(null, !origin || origin.includes(process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost'))
}));
app.use(express.json());
app.use(cacheControl);
app.use(securityHeaders);

// Static files
app.use(express.static(path.join(__dirname, '.'), {
    extensions: ['html'],
    index: 'index.html'
}));

// --- API Middleware ---
app.use('/api', rateLimiter);

// Auth guard: protect all /api except public endpoints
app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/auth/') || req.path === '/health' || req.path.startsWith('/telegram/webhook')) {
        return next();
    }
    authenticateToken(req, res, next);
});

// --- Mount Routes ---
app.use('/api/auth', authRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/lines', lineRoutes);
app.use('/api/history', historyRoutes);
app.use('/api', settingsRoutes);           // /api/stats, /api/settings, /api/rooms, /api/health
app.use('/api/admin', adminRoutes);
app.use('/api/telegram', telegramRoutes);
app.use('/api/afisha', afishaRoutes);
app.use('/api/backup', backupRoutes);

// --- Error Handler (must be AFTER all routes) ---
app.use(errorHandler);

// Invite page
app.get('/invite', (req, res) => {
    res.sendFile(path.join(__dirname, 'invite.html'));
});

// SPA fallback (must be last)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ==========================================
// SCHEDULERS (digest, reminder, backup)
// ==========================================

let digestSentToday = null;
let reminderSentToday = null;
let backupSentToday = null;

async function checkAutoDigest() {
    try {
        const result = await pool.query("SELECT key, value FROM settings WHERE key IN ('digest_time', 'digest_time_weekday', 'digest_time_weekend')");
        const settings = {};
        result.rows.forEach(r => { settings[r.key] = r.value; });

        const kyivDay = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Kyiv' })).getDay();
        const isWeekend = kyivDay === 0 || kyivDay === 6;

        const digestTime = isWeekend
            ? (settings.digest_time_weekend || settings.digest_time)
            : (settings.digest_time_weekday || settings.digest_time);

        if (!digestTime || !/^\d{2}:\d{2}$/.test(digestTime)) return;

        const nowTime = getKyivTimeStr();
        const todayStr = getKyivDateStr();

        if (nowTime === digestTime && digestSentToday !== todayStr) {
            digestSentToday = todayStr;
            console.log(`[AutoDigest] Sending daily digest for ${todayStr} at ${digestTime} (${isWeekend ? 'weekend' : 'weekday'})`);
            await buildAndSendDigest(todayStr);
        }
    } catch (err) {
        console.error('[AutoDigest] Error:', err);
    }
}

async function checkAutoReminder() {
    try {
        const result = await pool.query("SELECT value FROM settings WHERE key = 'reminder_time'");
        const reminderTime = result.rows[0]?.value;
        if (!reminderTime || !/^\d{2}:\d{2}$/.test(reminderTime)) return;

        const nowTime = getKyivTimeStr();
        const todayStr = getKyivDateStr();

        if (nowTime === reminderTime && reminderSentToday !== todayStr) {
            reminderSentToday = todayStr;
            console.log(`[AutoReminder] Sending tomorrow reminder at ${reminderTime}`);
            await sendTomorrowReminder(todayStr);
        }
    } catch (err) {
        console.error('[AutoReminder] Error:', err);
    }
}

async function checkAutoBackup() {
    try {
        const result = await pool.query("SELECT value FROM settings WHERE key = 'backup_time'");
        const backupTime = result.rows[0]?.value || '03:00';
        if (!/^\d{2}:\d{2}$/.test(backupTime)) return;

        const nowTime = getKyivTimeStr();
        const todayStr = getKyivDateStr();

        if (nowTime === backupTime && backupSentToday !== todayStr) {
            backupSentToday = todayStr;
            console.log(`[AutoBackup] Running daily backup at ${backupTime}`);
            await sendBackupToTelegram();
        }
    } catch (err) {
        console.error('[AutoBackup] Error:', err);
    }
}

// ==========================================
// START
// ==========================================

initDatabase().then(() => {
    app.listen(PORT, async () => {
        console.log(`Server running on port ${PORT}`);

        // Log Telegram config
        const activeToken = await telegram.getActiveBotToken();
        console.log(`[Telegram Config] Bot token: ${activeToken ? 'SET' : 'NOT SET'}`);
        try {
            const dbChatId = await telegram.getConfiguredChatId();
            console.log(`[Telegram Config] Effective chat ID: ${dbChatId || 'NONE'}`);
        } catch (e) { /* ignore */ }

        // Setup Telegram webhook
        const appUrl = process.env.RAILWAY_PUBLIC_DOMAIN
            ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
            : null;
        if (appUrl) {
            telegram.ensureWebhook(appUrl).catch(err => console.error('Webhook auto-setup error:', err));
        }

        // Start schedulers (every 60s)
        setInterval(checkAutoDigest, 60000);
        setInterval(checkAutoReminder, 60000);
        setInterval(checkAutoBackup, 60000);
        console.log('[Scheduler] Digest + Reminder + Backup schedulers started (checks every 60s)');
    });
});

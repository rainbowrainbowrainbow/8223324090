/**
 * server.js — Entry point (v5.29: structured logging)
 *
 * Slim entry point that wires together all modules.
 * Each module lives in its own file under db/, middleware/, services/, routes/.
 */
const express = require('express');
const path = require('path');
const cors = require('cors');
const compression = require('compression');
const { loadLocalEnv } = require('./utils/loadLocalEnv');

loadLocalEnv(__dirname);

// --- Core modules ---
const { pool, initDatabase } = require('./db');
const { authenticateToken, requireAction, requireRole } = require('./middleware/auth');
const { apiAuthBoundary } = require('./middleware/apiAuthBoundary');
const { businessScopeWriteGuard } = require('./middleware/businessScopeGuard');
const { rateLimiter, loginRateLimiter, sensitiveActionLimiter, shopBuyLimiter, landingLeadLimiter } = require('./middleware/rateLimit');
const { cacheControl, securityHeaders } = require('./middleware/security');
const { requestIdMiddleware } = require('./middleware/requestId');
const { errorResponseMetadata } = require('./middleware/errorResponseMetadata');
const { apiVersionRewrite } = require('./middleware/apiVersioning');
const { staticDocGuard } = require('./middleware/staticDocGuard');
const { ensureWebhook, getConfiguredChatId, TELEGRAM_BOT_TOKEN, TELEGRAM_DEFAULT_CHAT_ID, drainTelegramRequests, getInFlightCount, processRetryQueue } = require('./services/telegram');
const { ensureReportBotWebhook, REPORT_BOT_TOKEN } = require('./services/report-bot');
const { readDesignBlobByFilename } = require('./services/designStorage');
const { buildProfileAvatarBlobFallbackHandler } = require('./services/profileAvatarStorage');
const { buildCatalogImageBlobFallbackHandler } = require('./services/imageStorage');
const { checkAutoDigest, checkAutoReminder, checkAutoBackup, checkRecurringTasks, checkScheduledDeletions, checkRecurringAfisha, checkCertificateExpiry, checkTaskReminders, checkReplyAutoEscalations, checkWorkDayTriggers, checkMonthlyPointsReset, checkStreakUpdates, checkBirthdayGreetings, checkBirthdayReminders, checkDormantCustomers, checkUpcomingBookings, checkEventQueue, checkSLABreach, checkScheduledAnnouncements, checkTaskOverdue, checkCustomerRetention, checkAutoReport, checkHotLeads, checkScheduledChatMessages, checkExpiredChatMessages, checkAutoReviewRequests, checkTeamPulseReminder, checkAutoOrdering, checkBookingPushReminders, checkCertExpiryReminders, checkStaleCatalogImages, checkChatDailyDigest, checkRecurringAnnouncements, checkEventPipeline, checkNpsFollowUp, checkCleaningTasks, checkGraduationOpsAutomation, checkAttendanceReviewTasks, checkHrAttendancePrintAutomations, checkBirthdayTagSync } = require('./services/scheduler');
const { checkHrAutoClose, checkHrNoShow } = require('./services/hr');
const { sendWeeklyTrainingPrompts, sendWeeklySummaryToDirector } = require('./services/training');
const { cleanupExpired: cleanupKleshnyaMessages } = require('./services/kleshnya-greeting');
const { processStaleMessages, BRIDGE_ENABLED: OPENCLAW_BRIDGE } = require('./services/kleshnya-bridge');
const { createLogger } = require('./utils/logger');
const { validateEnv } = require('./utils/validateEnv');
const { initWebSocket, getWSS } = require('./services/websocket');
const { runMigrations } = require('./db/migrate');
const { apiAudit } = require('./middleware/apiAudit');
const { guardScheduler } = require('./services/schedulerGuard');
const { processPaymentOutboxJobs: processPaymentOutboxJobsBase } = require('./services/payments/paymentOutboxWorker');
const { runCheckboxReadinessProbeScheduler } = require('./services/payments/paymentReadinessService');

async function processPaymentOutboxJobs() {
    return processPaymentOutboxJobsBase({ throwOnDegraded: true });
}
const swaggerUi = require('swagger-ui-express');
const { swaggerSpec } = require('./swagger');
const {
    BACKUP_HTTP_BODY_LIMIT,
    isBackupRestoreRequestPath
} = require('./config/backupRestorePolicy');
const {
    lockSchemaMigrations,
    unlockSchemaMigrations
} = require('./services/backupSchemaLock');

const log = createLogger('Server');

function runAtKyivTime(time, fn) {
    return async () => {
        const { getKyivTimeStr } = require('./services/booking');
        if (getKyivTimeStr() !== time) return;
        await fn();
    };
}

function runAtKyivTimeOrUntilSettingDone(time, settingKey, fn) {
    return async () => {
        const { getKyivTimeStr } = require('./services/booking');
        if (getKyivTimeStr() === time) {
            await fn();
            return;
        }
        try {
            const result = await pool.query('SELECT value FROM settings WHERE key = $1 LIMIT 1', [settingKey]);
            if (!result.rows[0]?.value) await fn();
        } catch (err) {
            log.warn(`Scheduled first-run gate skipped for ${settingKey}`, { error: err.message });
        }
    };
}

// Validate environment variables before anything else
validateEnv();

async function telegramInboxOwnsGlobalBotToken() {
    if (!TELEGRAM_BOT_TOKEN) return false;
    try {
        const {
            hasActiveTelegramInboxConnection,
            isTelegramInboxConnectionUsingToken,
        } = require('./services/omni-accounts');
        return await isTelegramInboxConnectionUsingToken(TELEGRAM_BOT_TOKEN)
            || await hasActiveTelegramInboxConnection();
    } catch (err) {
        log.warn('Could not check Omni Telegram inbox webhook ownership', { error: err.message });
        return false;
    }
}

// --- Express app setup ---
const app = express();
app.disable('x-powered-by'); // v20.9.9: Don't expose Express version
app.set('trust proxy', 1);   // v20.9.27: Trust first proxy (Railway) — req.ip returns real client IP
const PORT = process.env.PORT || 3000;
const HERMES_JOB_RESULT_JSON_LIMIT = '20mb';
const BACKUP_RESTORE_JSON_LIMIT = BACKUP_HTTP_BODY_LIMIT;
const BACKUP_RECOVERY_MODE = process.env.BACKUP_RECOVERY_MODE === 'true';
const BACKUP_OUTBOUND_HOLD = process.env.BACKUP_OUTBOUND_HOLD === 'true';
const BACKUP_RECOVERY_ALLOWED_REQUESTS = new Set([
    'GET /api/health',
    'GET /api/ready',
    'GET /api/version',
    'GET /api/backup/tables',
    'GET /api/backup/verify',
    'POST /api/backup/restore',
    'POST /api/backup/restore-encrypted',
    'POST /api/auth/login',
    'GET /api/v1/health',
    'GET /api/v1/ready',
    'GET /api/v1/version',
    'GET /api/v1/backup/tables',
    'GET /api/v1/backup/verify',
    'POST /api/v1/backup/restore',
    'POST /api/v1/backup/restore-encrypted',
    'POST /api/v1/auth/login'
]);
const defaultJsonParser = express.json({ limit: '1mb' });

function isBackupRestoreRequest(req) {
    const requestPath = String(req.originalUrl || req.url || req.path || '').split('?')[0];
    return isBackupRestoreRequestPath(requestPath);
}

// Global middleware
app.use(cors({
    origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        const domain = process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost';
        try {
            const url = new URL(origin);
            // v25.3: Check full origin (host+port) to prevent port-spoofing
            const allowed = url.hostname === domain ||
                (url.hostname === 'localhost' && (!url.port || url.port === '3000'));
            cb(null, allowed);
        } catch { cb(null, false); }
    }
}));
app.use(compression());
app.use('/api/checkbox/webhook', require('./routes/checkbox-webhook'));
app.use('/api/v1/checkbox/webhook', require('./routes/checkbox-webhook'));
app.use((req, res, next) => {
    if (!BACKUP_RECOVERY_MODE) return next();
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    if (BACKUP_RECOVERY_ALLOWED_REQUESTS.has(`${method} ${req.path}`)) return next();
    return res.status(503).json({ error: 'BACKUP_RECOVERY_MODE_ACTIVE' });
});
app.use(['/api/hermes/jobs/:id/result', '/api/v1/hermes/jobs/:id/result'], express.json({ limit: HERMES_JOB_RESULT_JSON_LIMIT }));
app.use((req, res, next) => {
    // Backup restore payloads are parsed only after API authentication below.
    if (isBackupRestoreRequest(req)) return next();
    return defaultJsonParser(req, res, next);
});
app.use(requestIdMiddleware);
app.use(errorResponseMetadata);
app.use(securityHeaders);
app.use(cacheControl);
// v19.10: API versioning — /api/v1/* → /api/*
app.use(apiVersionRewrite);
app.use(staticDocGuard);
const catalogImageBlobHandler = buildCatalogImageBlobFallbackHandler(pool, log);
app.get('/uploads/catalog-images/items/:filename', catalogImageBlobHandler);
app.head('/uploads/catalog-images/items/:filename', catalogImageBlobHandler);
app.use('/uploads/catalog-images/items', express.static(path.join(__dirname, 'uploads', 'catalog-images', 'items')));
app.use('/uploads/catalog-images/items', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    return res.status(404).json({ error: 'image_not_found' });
});
app.get('/uploads/designs/:filename', async (req, res, next) => {
    try {
        const row = await readDesignBlobByFilename(pool, req.params.filename);
        if (!row?.data) return next();
        res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
        res.setHeader('Content-Disposition', 'inline');
        return res.send(Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data));
    } catch (err) {
        log.warn(`Design Postgres upload fallback skipped: ${err.message}`);
        return next();
    }
});
app.get('/uploads/profile-avatars/*', buildProfileAvatarBlobFallbackHandler(pool, log));
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

// v19.17: Request timeout — 30s for API endpoints
app.use('/api', (req, res, next) => {
    // A database recovery may legitimately run longer than the generic API
    // timeout. Its route owns disconnect/abort handling and checks the signal
    // before COMMIT, so it must not receive an early 408 while still mutating.
    if (isBackupRestoreRequest(req)) return next();
    req.setTimeout(30000, () => {
        if (!res.headersSent) {
            res.status(408).json({ error: 'Запит перевищив ліміт часу (30с)' });
        }
    });
    next();
});

// Swagger UI — public, no auth required
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { customSiteTitle: 'Event Genix API' }));
app.get('/api-docs.json', (req, res) => res.json(swaggerSpec));

// Rate limiter for all API routes
app.use('/api', rateLimiter);
app.use('/api/landing/demo-request', landingLeadLimiter);
app.use('/api/leads/landing', landingLeadLimiter);

// Auth middleware: protect all API endpoints except public ones
app.use('/api', apiAuthBoundary(authenticateToken));
const backupRestorePreParserGuard = requireRole('creator', 'director');
const backupRestorePreParserSettingsGuard = requireAction('manage_settings');
app.use(
    ['/api/backup/restore', '/api/backup/restore-encrypted'],
    backupRestorePreParserGuard,
    backupRestorePreParserSettingsGuard,
    express.json({ limit: BACKUP_RESTORE_JSON_LIMIT })
);

// Aggregate business scopes are overview-only; write actions must pick one active business first.
app.use('/api', businessScopeWriteGuard);

// Login rate limiter (stricter: 5 attempts per minute)
app.use('/api/auth/login', loginRateLimiter);
// v25.3: Rate limiters for sensitive endpoints
app.use('/api/auth/password', sensitiveActionLimiter);
app.use('/api/auth/refresh', sensitiveActionLimiter);
app.use('/api/auth/impersonate', sensitiveActionLimiter);
app.use('/api/shop/buy', shopBuyLimiter);
app.use('/api/gamification/shop/buy', shopBuyLimiter);

// v17.9.0: API audit trail — log all mutating requests by authenticated users
app.use('/api', apiAudit);

// --- Mount route modules ---
app.use('/api/auth', require('./routes/auth'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/banquets', require('./routes/banquets'));
app.use('/api/banquet-deposits', require('./routes/banquet-deposits'));
app.use('/api/booking-templates', require('./routes/booking-templates'));
app.use('/api/lines', require('./routes/lines'));
app.use('/api/timeline', require('./routes/timeline-resources'));
app.use('/api/history', require('./routes/history'));
app.use('/api/afisha', require('./routes/afisha'));
app.use('/api/telegram', require('./routes/telegram'));
app.use('/api/backup', require('./routes/backup'));
app.use('/api/products', require('./routes/products'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/my-day', require('./routes/my-day'));
app.use('/api/my-day/habits', require('./routes/my-day-habits'));
app.use('/api/task-templates', require('./routes/task-templates'));
app.use('/api/staff', require('./routes/staff'));
app.use('/api/certificates', require('./routes/certificates'));
app.use('/api/recurring', require('./routes/recurring'));
app.use('/api/points', require('./routes/points'));
app.use('/api/kleshnya', require('./routes/kleshnya'));
app.use('/api/designs', require('./routes/designs'));
app.use('/api/catalogs', require('./routes/catalogs'));
app.use('/api/contractors', require('./routes/contractors'));
app.use('/api/warehouse', require('./routes/warehouse'));
app.use('/api/hr', require('./routes/hr'));
app.use('/api/svitlana', require('./routes/svitlana'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/finance', require('./routes/finance'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/payroll', require('./routes/payroll'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/report-bot', require('./routes/report-bot'));
app.use('/api/personal-accounts', require('./routes/personal-accounts'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/procurement', require('./routes/procurement'));
app.use('/api/workers', require('./routes/workers'));
app.use('/api/work-queue', require('./routes/work-queue'));
app.use('/api/center', require('./routes/center'));
app.use('/api/art-director', require('./routes/art-director'));
app.use('/api/demo', require('./routes/demo'));
app.use('/api/packages', require('./routes/packages'));
app.use('/api/status', require('./routes/status'));
app.use('/api/events', require('./routes/event-queue'));
app.use('/api/print', require('./routes/print'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/support', require('./routes/support'));
app.use('/api/music', require('./routes/music'));
app.use('/api/search', require('./routes/search'));
app.use('/api/loyalty', require('./routes/loyalty'));
app.use('/api/users', require('./routes/users'));
app.use('/api/board', require('./routes/board'));
app.use('/api/training', require('./routes/training'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/page-statuses', require('./routes/page-statuses'));
app.use('/api/leads', require('./routes/leads'));
app.use('/api/copilot', require('./routes/copilot'));
app.use('/api/decisions', require('./routes/decisions'));
app.use('/api/sound-library', require('./routes/sound-library'));
app.use('/api/landing', require('./routes/landing'));
app.use('/api/scripts', require('./routes/scripts'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/guardian', require('./routes/guardian'));
app.use('/api/graduation', require('./routes/graduation'));
app.use('/api/agents', require('./routes/agents'));
app.use('/api/hermes', require('./routes/hermes'));
app.use('/api/hermes-studio', require('./routes/hermes-studio'));
app.use('/api/summary', require('./routes/summary'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/crm-assistant', require('./routes/crm-assistant'));
app.use('/api/dashboard-assistant', require('./routes/dashboard-assistant'));
app.use('/api/gamification', require('./routes/gamification'));
app.use('/api/subscription', require('./routes/subscription'));

// v22.4.0: Achievements system
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/achievements', require('./routes/achievements'));
app.use('/api/shop', require('./routes/shop'));
app.use('/api', require('./routes/shop')); // /api/inventory, /api/profile/:id, /api/profile/equip
app.use('/api/notes', require('./routes/notes'));
app.use('/api/minigame', require('./routes/minigame'));

// v22.5.0: Gamification v2 — Room, Quests, Titles
app.use('/api/room', require('./routes/room'));
app.use('/api/quests', require('./routes/quests'));

// v22.10.0: Gamification v3 — Quiz, Streaks
app.use('/api/quiz', require('./routes/quiz'));
app.use('/api/streaks', require('./routes/streaks'));

// Content Matrix — social media content planning
app.use('/api/content', require('./routes/content'));
app.use('/api/business-cards', require('./routes/business-cards'));
app.use('/api/marketing-agent', require('./routes/marketing-agent'));

// OmniClaw — omnichannel communication
app.use('/api/omni', require('./routes/omnichannel'));

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
// v22.0.0: Dashboard
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/invite', (req, res) => {
    res.sendFile(path.join(__dirname, 'invite.html'));
});

app.get('/maysternya-doli', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
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
app.get('/copilot', (req, res) => {
    res.sendFile(path.join(__dirname, 'copilot.html'));
});
app.get('/kleshnya', (req, res) => {
    res.redirect('/chat');
});
// v38.8.0: designs as standalone page (was redirect to /art?tab=designs)
app.get('/designs', (req, res) => {
    res.sendFile(path.join(__dirname, 'designs.html'));
});
app.get('/hermes-studio', (req, res) => {
    res.sendFile(path.join(__dirname, 'hermes-studio.html'));
});
app.get('/warehouse', (req, res) => {
    res.sendFile(path.join(__dirname, 'warehouse.html'));
});
app.get('/hr', (req, res) => {
    res.sendFile(path.join(__dirname, 'hr.html'));
});
app.get('/customers', (req, res) => {
    res.sendFile(path.join(__dirname, 'customers.html'));
});
app.get('/finance', (req, res) => {
    res.sendFile(path.join(__dirname, 'finance.html'));
});
app.get('/cashier-payments', (req, res) => {
    res.sendFile(path.join(__dirname, 'cashier-payments.html'));
});
app.get('/accounting-deposits', (req, res) => {
    res.sendFile(path.join(__dirname, 'accounting-deposits.html'));
});
app.get('/reports', (req, res) => {
    res.sendFile(path.join(__dirname, 'reports.html'));
});
app.get('/report-agent', (req, res) => {
    res.sendFile(path.join(__dirname, 'report-agent.html'));
});
app.get('/analytics', (req, res) => {
    // 'analytics.html' remains a thin client-side redirect shell for static-surface ownership.
    const requested = String(req.query.mode || req.query.tab || 'insights');
    const mode = requested === 'overview' || requested === 'operations' ? requested : 'insights';
    res.redirect(301, `/finance?mode=${encodeURIComponent(mode)}`);
});
app.get('/center', (req, res) => {
    res.sendFile(path.join(__dirname, 'center.html'));
});
// Embed routes — direct file serving for art-director iframes (no redirects)
app.get('/embed/designs', (req, res) => {
    res.sendFile(path.join(__dirname, 'designs.html'));
});
app.get('/embed/programs', (req, res) => {
    res.sendFile(path.join(__dirname, 'programs.html'));
});
app.get('/embed/graduation', (req, res) => {
    res.sendFile(path.join(__dirname, 'graduation.html'));
});
// v20.3.0: art-director → art rename
app.get('/art', (req, res) => {
    res.sendFile(path.join(__dirname, 'art-director.html'));
});
app.get('/art-director', (req, res) => res.redirect(301, '/art'));
app.get('/art-director.html', (req, res) => res.redirect(301, '/art'));
// v30.0.0: Graduation Event Builder
app.get('/graduation', (req, res) => {
    res.sendFile(path.join(__dirname, 'graduation.html'));
});
// v42.0: Content Matrix
app.get('/content', (req, res) => {
    res.sendFile(path.join(__dirname, 'content.html'));
});
app.get('/checkin', (req, res) => {
    res.sendFile(path.join(__dirname, 'checkin.html'));
});
app.get('/demo', (req, res) => {
    res.sendFile(path.join(__dirname, 'demo.html'));
});
app.get('/status', (req, res) => {
    res.sendFile(path.join(__dirname, 'status.html'));
});
app.get('/guardian-ops', (req, res) => {
    res.sendFile(path.join(__dirname, 'guardian-ops.html'));
});
// v20.3.0: training page
app.get('/training', (req, res) => {
    res.sendFile(path.join(__dirname, 'training.html'));
});
// v29.2.0: leads page — /sales-funnel is canonical, /leads redirects (bust cached 301)
app.get('/sales-funnel', (req, res) => {
    res.sendFile(path.join(__dirname, 'leads.html'));
});
app.get('/leads', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    res.redirect(302, `/sales-funnel${query}`);
});
// v20.13: Team messenger
app.get('/chat', (req, res) => {
    res.sendFile(path.join(__dirname, 'chat.html'));
});
app.get('/chat-settings', (req, res) => {
    res.sendFile(path.join(__dirname, 'chat-settings.html'));
});
app.get('/timeline-settings', (req, res) => {
    res.sendFile(path.join(__dirname, 'timeline-settings.html'));
});
app.get('/booking-summary.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'booking-summary.html'));
});
// v22.2.0: Gamification profile page
app.get('/profile', (req, res) => {
    res.sendFile(path.join(__dirname, 'profile.html'));
});

// Landing page (separate site)
app.use('/landing', express.static(path.join(__dirname, 'landing')));
app.get('/landing', (req, res) => {
    res.sendFile(path.join(__dirname, 'landing', 'index.html'));
});
app.get(['/manager-guide', '/manager-guide.html'], (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.redirect(302, '/landing/manager-guide.html');
});
app.get(['/sales-deck', '/sales-deck.html'], (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.redirect(302, '/landing/sales-deck.html');
});
app.get('/landing/sales-deck', (req, res) => {
    res.sendFile(path.join(__dirname, 'landing', 'sales-deck.html'));
});
// v22.4.0: shop, game pages
app.get('/shop', (req, res) => {
    res.sendFile(path.join(__dirname, 'shop.html'));
});
app.get('/game', (req, res) => {
    res.sendFile(path.join(__dirname, 'game.html'));
});
// v22.10.0: Quiz + Room pages
app.get('/quiz', (req, res) => {
    res.sendFile(path.join(__dirname, 'quiz.html'));
});
app.get('/room', (req, res) => {
    res.sendFile(path.join(__dirname, 'room.html'));
});

// v23.2.0: OmniClaw — omnichannel inbox
app.get('/omni', (req, res) => {
    res.sendFile(path.join(__dirname, 'omni.html'));
});

// v0.60.24: Afisha is a standalone product page instead of a timeline modal bridge.
app.get('/afisha', (req, res) => {
    res.sendFile(path.join(__dirname, 'afisha.html'));
});
// v0.60.23: Certificates are a standalone page flow; creation no longer opens timeline modals.
// v0.61.52: Redirect legacy nested asset paths left by cached /certificates/new HTML.
app.get(/^\/certificates\/(css|js|images)\/(.+)$/, (req, res) => {
    const bucket = req.params[0];
    const asset = String(req.params[1] || '').replace(/^\/+/, '');
    if (!bucket || !asset || asset.includes('..')) return res.status(404).send('Not found');
    const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.redirect(302, `/${bucket}/${asset}${query}`);
});
app.get(['/certificates', '/certificates/new', '/certificates/batch'], (req, res) => {
    res.sendFile(path.join(__dirname, 'certificates.html'));
});
// Designer and Sound — sendFile or redirect to /art
app.get('/designer', (req, res) => {
    res.sendFile(path.join(__dirname, 'designer.html'));
});
app.get('/sound', (req, res) => {
    res.sendFile(path.join(__dirname, 'sound.html'));
});

// v39.3: Public catalog viewer (no auth required)
app.get('/catalog/:slug/:token', async (req, res) => {
    try {
        const { pool } = require('./db');
        const cat = await pool.query('SELECT * FROM catalog_definitions WHERE id=$1 AND public_token=$2', [req.params.slug, req.params.token]);
        if (!cat.rowCount) return res.status(404).send('Каталог не знайдено');
        const pages = await pool.query('SELECT * FROM catalog_pages WHERE catalog_id=$1 AND is_active=true ORDER BY page_number', [req.params.slug]);
        const catalog = cat.rows[0];
        const pagesData = pages.rows;
        // Render simple HTML viewer
        const PAGE_THEMES = {
            gold: { bg1:'#2d2006',bg2:'#3d2e0a',bg3:'#4d3c12',accent:'#C9A84C',price:'#6EE7B7' },
            purple: { bg1:'#1a0a2e',bg2:'#2d1654',bg3:'#3f2272',accent:'#a855f7',price:'#6EE7B7' },
            cyan: { bg1:'#0a1a2e',bg2:'#0e2a4a',bg3:'#123a66',accent:'#06b6d4',price:'#6EE7B7' },
            green: { bg1:'#0a2e1a',bg2:'#0e4a2a',bg3:'#12663a',accent:'#22c55e',price:'#6EE7B7' },
            red: { bg1:'#2e0a0a',bg2:'#4a1616',bg3:'#662222',accent:'#ef4444',price:'#FDE68A' },
            pink: { bg1:'#2e0a1a',bg2:'#4a1630',bg3:'#662246',accent:'#ec4899',price:'#6EE7B7' },
            orange: { bg1:'#2e1a0a',bg2:'#4a2e16',bg3:'#664222',accent:'#f97316',price:'#6EE7B7' },
        };
        const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        let pagesHtml = pagesData.map(p => {
            const t = PAGE_THEMES[p.theme||'gold']||PAGE_THEMES.gold;
            const items = Array.isArray(p.items) ? p.items : (typeof p.items === 'string' ? JSON.parse(p.items||'[]') : []);
            const det = typeof p.details === 'string' ? JSON.parse(p.details||'{}') : (p.details||{});
            const price = p.price_label || (p.price ? `від ${p.price} ₴` : '');
            if (p.page_number === 0) {
                const bg = p.background_url || p.image_url || '';
                return `<div class="cat-page"><div class="cat-page-cover">${bg?`<div class="cat-page-cover-bg" style="background-image:url('${bg}')"></div>`:''}<div class="cat-page-cover-content"><div style="font-size:48px;margin-bottom:16px;opacity:0.8">🏰</div><h1>${esc(p.title)}</h1>${p.subtitle?`<p>${esc(p.subtitle)}</p>`:''}<div style="margin-top:24px;opacity:0.7;font-size:14px"><p>📞 0800 75 35 53</p><p>📍 вул. Закревського 61/2, Київ</p></div></div></div></div>`;
            }
            const itemsHtml = items.map(i=>`<div class="csvc-card"><span class="csvc-icon">${i.icon||'🎯'}</span><span class="csvc-name">${esc(i.name)}</span>${i.detail?`<span class="csvc-dur">${esc(i.detail)}</span>`:''}</div>`).join('');
            let statsHtml = '';
            const parts = [];
            if(det.duration) parts.push({v:det.duration,l:'тривалість'});
            if(det.kids) parts.push({v:det.kids,l:'дітей'});
            if(price) parts.push({v:price,l:'',isP:true});
            if(parts.length) statsHtml = '<div class="cat-stats">'+parts.map((s,i)=>{
                const div = i<parts.length-1?'<div class="cat-stat-divider"></div>':'';
                return `<div class="cat-stat${s.isP?' cat-stat-price':''}"><span class="${s.isP?'cat-price-val':'cat-stat-val'}">${s.v}</span><span class="cat-stat-lbl">${s.l}</span></div>${div}`;
            }).join('')+'</div>';
            return `<div class="cat-page" style="--cat-bg1:${t.bg1};--cat-bg2:${t.bg2};--cat-bg3:${t.bg3};--cat-accent:${t.accent};--cat-price:${t.price}"><div class="cat-hero">${p.image_url?`<img class="cat-hero-img" src="${p.image_url}" alt="${esc(p.title)}">`:''}<div class="cat-hero-content"><h1 class="cat-title">${esc(p.title||'').toUpperCase()}</h1>${p.subtitle?`<p class="cat-subtitle">${esc(p.subtitle)}</p>`:''}</div></div>${statsHtml}<div class="cat-body">${itemsHtml?`<div class="cat-section-title">Що входить</div><div class="cat-services">${itemsHtml}</div>`:''}${p.description?`<div class="cat-desc">${esc(p.description)}</div>`:''}</div><div class="cat-footer"><div class="cat-footer-info"><span>📍 Парк Закревського · Київ</span><span>📞 0800 75 35 53</span></div></div></div>`;
        }).join('');
        res.send(`<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(catalog.name)} — Event Genix</title><link rel="stylesheet" href="/css/catalog.css?v=0.80.155"><link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap" rel="stylesheet"><style>body{margin:0;background:#1a1a2e;font-family:'Nunito',sans-serif;padding:24px 16px;min-height:100vh;display:flex;flex-direction:column;align-items:center;gap:24px}h2{color:#fff;text-align:center;margin:0 0 8px}.cat-page{margin:0 auto}</style></head><body><h2>${esc(catalog.emoji||'')} ${esc(catalog.name)}</h2>${pagesHtml}<p style="text-align:center;color:rgba(255,255,255,0.3);font-size:12px;margin-top:24px">Event Genix CRM · Парк Закревського Періоду</p></body></html>`);
    } catch (err) {
        res.status(500).send('Помилка сервера');
    }
});

// v38.4.0: API 404 handler — return JSON instead of HTML for unknown API routes
app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// SPA fallback (must be last)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Global error handler — v19.10: include requestId for tracing
app.use((err, req, res, next) => {
    log.error('Unhandled express error', err);
    const requestId = res.getHeader('X-Request-ID') || req.headers['x-request-id'];
    res.status(500).json({ error: 'Internal server error', requestId });
});

// Process-level error handlers
process.on('unhandledRejection', (reason) => {
    log.error('Unhandled promise rejection', reason);
    // v38.4.0: Exit on unhandled rejection to prevent corrupted state
    process.exit(1);
});
process.on('uncaughtException', (err) => {
    log.error('Uncaught exception', err);
    process.exit(1);
});

// --- Start server ---
let server;
const schedulerIntervals = [];

// v22.20.1: Two-phase init — initDatabase creates base tables (indexes are safe via safeQuery),
// then migrations add columns/constraints, then initDatabase again for remaining indexes/seeds.
async function initializeDatabaseWithSchemaFence() {
    const guardClient = await pool.connect();
    let schemaLockHeld = false;
    try {
        await lockSchemaMigrations(guardClient);
        schemaLockHeld = true;
        await initDatabase();
        await runMigrations(pool, { schemaLockAlreadyHeld: true });
        await initDatabase();
    } finally {
        if (schemaLockHeld) await unlockSchemaMigrations(guardClient);
        guardClient.release();
    }
}

initializeDatabaseWithSchemaFence().catch(err => {
    log.error('Failed to initialize database, exiting', err);
    process.exit(1);
}).then(() => {
    server = app.listen(PORT, async () => {
        log.info(`Server running on port ${PORT}`);
        if (BACKUP_RECOVERY_MODE) {
            log.warn('Backup recovery mode active: ordinary routes and background side effects are disabled');
            return;
        }
        if (BACKUP_OUTBOUND_HOLD) {
            log.warn('Backup outbound hold active: web requests stay available while background and provider side effects remain disabled');
            return;
        }
        log.info(`Telegram bot token: ${TELEGRAM_BOT_TOKEN ? 'SET' : 'NOT SET'}`);
        log.info(`Telegram default chat ID: ${TELEGRAM_DEFAULT_CHAT_ID || 'NOT SET'}`);
        log.info(`Report bot token: ${REPORT_BOT_TOKEN ? 'SET' : 'NOT SET'}`);
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
            const omniOwnsTelegramWebhook = await telegramInboxOwnsGlobalBotToken();
            if (omniOwnsTelegramWebhook) {
                log.warn('Skipping legacy Telegram webhook auto-setup because the same bot token is bound as Omni Telegram inbox');
            } else {
                ensureWebhook(appUrl).catch(err => log.error('Webhook auto-setup error', err));
            }
            ensureReportBotWebhook(appUrl).catch(err => log.error('Report bot webhook setup error', err));
        }

        // v11.1: Register bot commands (Telegram menu button)
        try {
            const { registerBotCommands } = require('./services/bot');
            registerBotCommands().catch(err => log.error('Bot commands registration error', err));
        } catch (e) { log.error('Failed to register bot commands', e); }

        // v32.5: Register report bot commands
        try {
            const { registerReportBotCommands } = require('./services/report-bot');
            registerReportBotCommands().catch(err => log.error('Report bot commands registration error', err));
        } catch (e) { log.error('Failed to register report bot commands', e); }

        // Ensure chat bot is member of all default channels
        try {
            const { ensureBotMemberships } = require('./services/chat-bot');
            ensureBotMemberships().catch(err => log.error('Bot memberships error', err));
        } catch (e) { log.error('Failed to ensure bot memberships', e); }

        // Ensure Guardian AI agent is member of all default channels
        try {
            const { ensureGuardianMemberships } = require('./services/guardian');
            ensureGuardianMemberships().catch(err => log.error('Guardian memberships error', err));
        } catch (e) { log.error('Failed to ensure guardian memberships', e); }

        // v19.10: Schedulers wrapped with guardScheduler for dedup + error tracking
        schedulerIntervals.push(setInterval(guardScheduler('checkAutoDigest', checkAutoDigest, { dedup: 'daily' }), 60000));
        schedulerIntervals.push(setInterval(guardScheduler('checkAutoReminder', checkAutoReminder, { dedup: 'daily' }), 60000));
        schedulerIntervals.push(setInterval(guardScheduler('checkAutoBackup', checkAutoBackup, { dedup: null }), 60000));
        schedulerIntervals.push(setInterval(guardScheduler('checkRecurringTasks', checkRecurringTasks, { dedup: 'daily' }), 60000));
        schedulerIntervals.push(setInterval(guardScheduler('checkRecurringAfisha', checkRecurringAfisha, { dedup: 'daily' }), 60000));
        schedulerIntervals.push(setInterval(guardScheduler('checkScheduledDeletions', checkScheduledDeletions, { dedup: 'daily' }), 60000));
        schedulerIntervals.push(setInterval(guardScheduler('checkCertificateExpiry', checkCertificateExpiry, { dedup: 'daily' }), 60000));
        schedulerIntervals.push(setInterval(guardScheduler('checkTaskReminders', checkTaskReminders, { dedup: '5min' }), 60000));
        schedulerIntervals.push(setInterval(guardScheduler('checkReplyAutoEscalations', checkReplyAutoEscalations, { dedup: 'hourly' }), 60000));
        schedulerIntervals.push(setInterval(guardScheduler('checkWorkDayTriggers', checkWorkDayTriggers, { dedup: 'daily' }), 60000));
        schedulerIntervals.push(setInterval(guardScheduler('checkMonthlyPointsReset', checkMonthlyPointsReset, { dedup: 'daily' }), 60000));
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
        // v15.0: HR cron jobs
        schedulerIntervals.push(setInterval(guardScheduler('checkHrAutoClose', checkHrAutoClose, { dedup: 'daily' }), 60000));
        schedulerIntervals.push(setInterval(guardScheduler('checkHrNoShow', checkHrNoShow, { dedup: 'daily' }), 60000));
        // v11.0: Kleshnya greeting cache cleanup (every 30min)
        schedulerIntervals.push(setInterval(cleanupKleshnyaMessages, 30 * 60 * 1000));
        // v11.1: Streak auto-update (daily at 23:55)
        schedulerIntervals.push(setInterval(guardScheduler('checkStreakUpdates', checkStreakUpdates, { dedup: 'daily' }), 60000));
        // v15.1: Birthday greetings
        schedulerIntervals.push(setInterval(guardScheduler('checkBirthdayGreetings', checkBirthdayGreetings, { dedup: 'daily' }), 60000));
        // v30.4: CRM reminders — birthday 7d, dormant, upcoming bookings
        schedulerIntervals.push(setInterval(guardScheduler('checkBirthdayReminders', checkBirthdayReminders, { dedup: 'daily' }), 60000));
        schedulerIntervals.push(setInterval(runAtKyivTimeOrUntilSettingDone('03:20', 'customer_birthday_tags_backfill_done', guardScheduler('checkBirthdayTagSync', checkBirthdayTagSync, { dedup: 'daily' })), 60000));
        schedulerIntervals.push(setInterval(guardScheduler('checkDormantCustomers', checkDormantCustomers, { dedup: 'daily' }), 60000));
        schedulerIntervals.push(setInterval(guardScheduler('checkUpcomingBookings', checkUpcomingBookings, { dedup: 'daily' }), 60000));
        // v19.1: Event queue processor + SLA breach + announcements
        schedulerIntervals.push(setInterval(guardScheduler('checkEventQueue', checkEventQueue, { dedup: null }), 60000));
        schedulerIntervals.push(setInterval(guardScheduler('checkSLABreach', checkSLABreach, { dedup: 'hourly' }), 60000));
        schedulerIntervals.push(setInterval(guardScheduler('checkScheduledAnnouncements', checkScheduledAnnouncements, { dedup: 'hourly' }), 60000));
        // v19.2: Task overdue + customer retention
        schedulerIntervals.push(setInterval(guardScheduler('checkTaskOverdue', checkTaskOverdue, { dedup: 'hourly' }), 60000));
        schedulerIntervals.push(setInterval(guardScheduler('checkCustomerRetention', checkCustomerRetention, { dedup: 'daily' }), 60000));
        // v19.8: Auto-report
        schedulerIntervals.push(setInterval(guardScheduler('checkAutoReport', checkAutoReport, { dedup: 'daily' }), 60000));
        // v20.7.0: Hot leads checker (every 2 hours check)
        schedulerIntervals.push(setInterval(guardScheduler('checkHotLeads', checkHotLeads, { dedup: 'hourly' }), 60000));
        // Chat: scheduled messages (every 30s) + expired messages (every 60s)
        schedulerIntervals.push(setInterval(guardScheduler('checkScheduledChatMessages', checkScheduledChatMessages, { dedup: null }), 30000));
        schedulerIntervals.push(setInterval(guardScheduler('checkExpiredChatMessages', checkExpiredChatMessages, { dedup: null }), 60000));
        // v19.15: Telegram notification retry queue (every 30s)
        schedulerIntervals.push(setInterval(() => processRetryQueue().catch(err => log.error('Retry queue error', err)), 30000));
        // v22.18: Auto review requests (hourly) + Team pulse reminder (daily) + Auto ordering (hourly)
        schedulerIntervals.push(setInterval(guardScheduler('checkAutoReviewRequests', checkAutoReviewRequests, { dedup: 'hourly' }), 60000));
        schedulerIntervals.push(setInterval(guardScheduler('checkTeamPulseReminder', checkTeamPulseReminder, { dedup: 'daily' }), 60000));
        schedulerIntervals.push(setInterval(guardScheduler('checkAutoOrdering', checkAutoOrdering, { dedup: 'hourly' }), 60000));
        // v30.7: HR push reminders (every minute) + cert expiry (daily)
        schedulerIntervals.push(setInterval(guardScheduler('checkBookingPushReminders', checkBookingPushReminders, { dedup: null }), 60000));
        schedulerIntervals.push(setInterval(guardScheduler('checkCertExpiryReminders', checkCertExpiryReminders, { dedup: 'daily' }), 60000));
        // v33.5: Stale catalog images refresh (daily at 03:00 Kyiv)
        schedulerIntervals.push(setInterval(guardScheduler('checkStaleCatalogImages', checkStaleCatalogImages, { dedup: 'daily' }), 60000));
        // v33.7: Chat daily digest (20:00 Kyiv)
        schedulerIntervals.push(setInterval(guardScheduler('checkChatDailyDigest', checkChatDailyDigest, { dedup: 'daily' }), 60000));
        // v33.15.0: Recurring announcements (every minute, no dedup)
        schedulerIntervals.push(setInterval(guardScheduler('checkRecurringAnnouncements', checkRecurringAnnouncements, { dedup: null }), 60000));
        // v38.3.0: Operations Intelligence — event pipeline, NPS follow-up, cleaning tasks
        schedulerIntervals.push(setInterval(guardScheduler('checkEventPipeline', checkEventPipeline, { dedup: '5min' }), 60000));
        schedulerIntervals.push(setInterval(guardScheduler('checkNpsFollowUp', checkNpsFollowUp, { dedup: 'hourly' }), 60000));
        schedulerIntervals.push(setInterval(guardScheduler('checkCleaningTasks', checkCleaningTasks, { dedup: '5min' }), 60000));
        schedulerIntervals.push(setInterval(guardScheduler('checkGraduationOpsAutomation', checkGraduationOpsAutomation, { dedup: 'hourly' }), 60000));
        // Private previous-day attendance review tasks own durable source/date/owner idempotency.
        checkAttendanceReviewTasks().catch(err => log.error('Attendance review startup catch-up error', err));
        schedulerIntervals.push(setInterval(guardScheduler('checkAttendanceReviewTasks', checkAttendanceReviewTasks, { dedup: null }), 60000));
        // HR attendance document automations own DB-level idempotency and build leases.
        schedulerIntervals.push(setInterval(guardScheduler('checkHrAttendancePrintAutomations', checkHrAttendancePrintAutomations, { dedup: null }), 60000));
        // v20.4.0: Training prompts (Mon 09:00 Kyiv) + summary (Fri 17:00 Kyiv)
        async function checkTrainingPrompts() {
            const { getKyivTimeStr, getKyivDate } = require('./services/booking');
            const time = getKyivTimeStr();
            const day = getKyivDate().getDay(); // 0=Sun, 1=Mon
            if (day === 1 && time === '09:00') {
                await sendWeeklyTrainingPrompts();
            }
        }
        async function checkTrainingSummary() {
            const { getKyivTimeStr, getKyivDate } = require('./services/booking');
            const time = getKyivTimeStr();
            const day = getKyivDate().getDay();
            if (day === 5 && time === '17:00') {
                await sendWeeklySummaryToDirector();
            }
        }
        schedulerIntervals.push(setInterval(guardScheduler('checkTrainingPrompts', checkTrainingPrompts, { dedup: 'daily' }), 60000));
        schedulerIntervals.push(setInterval(guardScheduler('checkTrainingSummary', checkTrainingSummary, { dedup: 'daily' }), 60000));
        // v21.6: Guardian daily reports (runs at 21:00 Kyiv time)
        async function checkGuardianReports() {
            const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Kyiv' }));
            if (now.getHours() === 21 && now.getMinutes() < 2) {
                const { runDailyReports } = require('./services/guardian');
                await runDailyReports();
            }
        }
        schedulerIntervals.push(setInterval(guardScheduler('checkGuardianReports', checkGuardianReports, { dedup: 'daily' }), 60000));

        // v21.8: Guardian AI batch learn flush (every 5 min)
        async function flushGuardianLearn() {
            const { flushLearnBatch } = require('./services/guardian');
            await flushLearnBatch();
        }
        schedulerIntervals.push(setInterval(guardScheduler('flushGuardianLearn', flushGuardianLearn, { dedup: null }), 5 * 60 * 1000));

        // Contour 2: Agent activity tracking — parse git log every 30 min
        async function syncAgentActivities() {
            const { parseGitLog } = require('./services/agentTracker');
            await parseGitLog(24);
        }
        schedulerIntervals.push(setInterval(guardScheduler('syncAgentActivities', syncAgentActivities, { dedup: 'hourly' }), 30 * 60 * 1000));
        // Run initial sync on startup
        syncAgentActivities().catch(err => log.error('Initial agent sync error', err.message));

        // v38.4.0: Outbox relay — process transactional outbox events every 5 seconds
        const { processOutbox, cleanupOutbox } = require('./services/eventBus');
        const { runTrustedQaCleanupWatchdog } = require('./services/trustedQaRuns');
        schedulerIntervals.push(setInterval(async () => {
            try { await processOutbox(); } catch (e) { log.error('Outbox relay error', e.message); }
        }, 5000));

        // v38.4.0: Outbox + refresh token cleanup (daily)
        const { cleanupRefreshTokens } = require('./middleware/auth');
        schedulerIntervals.push(setInterval(guardScheduler('runCheckboxReadinessProbeScheduler', runCheckboxReadinessProbeScheduler, { dedup: null, autoPause: false }), 60000));
        schedulerIntervals.push(setInterval(guardScheduler('processPaymentOutboxJobs', processPaymentOutboxJobs, { dedup: null, autoPause: false }), 30000));
        schedulerIntervals.push(setInterval(guardScheduler('runTrustedQaCleanupWatchdog', runTrustedQaCleanupWatchdog, { dedup: '5min' }), 60000));
        schedulerIntervals.push(setInterval(guardScheduler('cleanupOutbox', cleanupOutbox, { dedup: 'daily' }), 60000));
        schedulerIntervals.push(setInterval(guardScheduler('cleanupRefreshTokens', cleanupRefreshTokens, { dedup: 'daily' }), 60000));

        log.info('Schedulers started (guarded): digest + reminder + backup + recurring + afisha + auto-delete + cert-expiry + kleshnya + greeting-cleanup + streaks + birthdays + event-queue + sla + announcements + task-overdue + retention + auto-report + tg-retry + training + guardian + ai-learn + agent-tracker + outbox + trusted-qa-cleanup + token-cleanup');

        // v42.3: Marketing agent — auto-publish scheduled posts every 5 min
        try {
            const { runMarketingScheduledPublish, runMarketingWeeklyPlanScheduler } = require('./lib/marketing-agent');
            schedulerIntervals.push(setInterval(async () => {
                try { await runMarketingScheduledPublish(); } catch (e) { log.warn('Marketing auto-publish error:', e.message); }
            }, 5 * 60 * 1000));
            log.info('Marketing auto-publish scheduler started (5 min interval)');

            // Weekly plan auto-generation: every minute check if Wednesday 08:00 UTC (10:00 Kyiv)
            schedulerIntervals.push(setInterval(async () => {
                try {
                    const result = await runMarketingWeeklyPlanScheduler();
                    if (!result.skipped) {
                        log.info(`Weekly plan auto-generated: ${result.count} posts for week ${result.weekNumber}`);
                    }
                } catch (e) { log.warn('Weekly plan auto-gen skipped:', e.message); }
            }, 60 * 1000));
            log.info('Weekly plan auto-gen scheduler started (Wednesday 10:00 Kyiv)');
        } catch (e) { log.warn('Marketing scheduler init failed:', e.message); }

        // WebSocket: attach to HTTP server for live-sync
        initWebSocket(server);

        // v39.7.0 — Alert broadcaster via WebSocket (every 60s, replaces client-side polling)
        try {
            const { startAlertBroadcaster } = require('./routes/dashboard');
            startAlertBroadcaster(60000);
            log.info('Alert broadcaster started (60s interval)');
        } catch (e) { log.warn('Alert broadcaster init failed:', e.message); }

        // v40.5: Task lifecycle — run daily at midnight + once on startup
        try {
            const { runTaskLifecycle } = require('./services/taskLifecycle');
            const guardedTaskLifecycle = guardScheduler('runTaskLifecycle', runTaskLifecycle, { dedup: 'daily' });
            setTimeout(() => guardedTaskLifecycle().catch(() => {}), 30000); // 30s after boot
            schedulerIntervals.push(setInterval(guardedTaskLifecycle, 60 * 1000)); // daily via guardScheduler
            log.info('Task lifecycle scheduler started');
        } catch (e) { log.warn('Task lifecycle init failed:', e.message); }
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
// carousel fix deploy trigger Wed Mar 11 16:15:20 UTC 2026

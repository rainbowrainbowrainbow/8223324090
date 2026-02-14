/**
 * utils/validateEnv.js — Environment variable validation at startup
 *
 * Validates all required and optional env vars before the server starts.
 * Exits with code 1 if critical errors are found (production only).
 * Logs warnings for missing optional vars with sane defaults.
 *
 * Env var inventory collected from:
 *   server.js, db/index.js, middleware/auth.js, middleware/rateLimit.js,
 *   services/telegram.js, services/backup.js, services/scheduler.js,
 *   utils/logger.js
 */
const { createLogger } = require('./logger');

const log = createLogger('EnvValidator');

function validateEnv() {
    const errors = [];
    const warnings = [];

    const isProduction = process.env.NODE_ENV === 'production';

    // --- JWT_SECRET ---
    // Used in: middleware/auth.js
    // Falls back to crypto.randomBytes(64) which changes on every restart
    if (isProduction && !process.env.JWT_SECRET) {
        errors.push(
            'JWT_SECRET is not set. In production, a stable JWT secret is required. ' +
            'Without it, all user sessions are invalidated on every restart. ' +
            'Set JWT_SECRET to a random string (64+ characters).'
        );
    } else if (!process.env.JWT_SECRET) {
        warnings.push(
            'JWT_SECRET not set. Auto-generating random secret. ' +
            'User sessions will be lost on restart.'
        );
    }

    // --- Database connectivity ---
    // Used in: db/index.js (DATABASE_URL or PGHOST/PGUSER/PGDATABASE)
    if (!process.env.DATABASE_URL) {
        const pgVars = ['PGHOST', 'PGUSER', 'PGDATABASE'];
        const missingPg = pgVars.filter(v => !process.env[v]);
        if (missingPg.length > 0) {
            warnings.push(
                `DATABASE_URL not set and missing PostgreSQL vars: ${missingPg.join(', ')}. ` +
                'Database connection may fail. Set DATABASE_URL or PGHOST+PGUSER+PGDATABASE.'
            );
        }
    }

    // --- Telegram ---
    // Used in: services/telegram.js
    if (!process.env.TELEGRAM_BOT_TOKEN) {
        warnings.push(
            'TELEGRAM_BOT_TOKEN not set. Using hardcoded fallback. ' +
            'Set TELEGRAM_BOT_TOKEN for your own bot.'
        );
    }

    // --- Type validations ---

    // PORT (server.js) — must be a valid number
    if (process.env.PORT && isNaN(parseInt(process.env.PORT))) {
        errors.push(`PORT must be a number, got: "${process.env.PORT}"`);
    }

    // RATE_LIMIT_MAX (middleware/rateLimit.js) — must be a valid number
    if (process.env.RATE_LIMIT_MAX && isNaN(parseInt(process.env.RATE_LIMIT_MAX))) {
        errors.push(`RATE_LIMIT_MAX must be a number, got: "${process.env.RATE_LIMIT_MAX}"`);
    }

    // LOGIN_RATE_LIMIT_MAX (middleware/rateLimit.js) — must be a valid number
    if (process.env.LOGIN_RATE_LIMIT_MAX && isNaN(parseInt(process.env.LOGIN_RATE_LIMIT_MAX))) {
        errors.push(`LOGIN_RATE_LIMIT_MAX must be a number, got: "${process.env.LOGIN_RATE_LIMIT_MAX}"`);
    }

    // LOG_LEVEL (utils/logger.js) — must be one of: debug, info, warn, error
    if (process.env.LOG_LEVEL && !['debug', 'info', 'warn', 'error'].includes(process.env.LOG_LEVEL)) {
        warnings.push(
            `LOG_LEVEL "${process.env.LOG_LEVEL}" is not recognized. ` +
            'Valid values: debug, info, warn, error. Defaulting to debug.'
        );
    }

    // --- Summary of all optional env vars with defaults ---
    // PORT              = 3000          (server.js)
    // NODE_ENV          = undefined     (utils/logger.js)
    // LOG_LEVEL         = 'debug'       (utils/logger.js)
    // DATABASE_URL      = undefined     (db/index.js — uses pg env vars as fallback)
    // JWT_SECRET        = auto-generated (middleware/auth.js)
    // RATE_LIMIT_MAX    = 120           (middleware/rateLimit.js)
    // LOGIN_RATE_LIMIT_MAX = 5          (middleware/rateLimit.js)
    // RAILWAY_PUBLIC_DOMAIN = null      (server.js, services/telegram.js)
    // TELEGRAM_BOT_TOKEN = hardcoded    (services/telegram.js)
    // TELEGRAM_DEFAULT_CHAT_ID = hardcoded (services/telegram.js)
    // WEBHOOK_SECRET    = auto-generated (services/telegram.js)

    // --- Output ---
    for (const w of warnings) {
        log.warn(w);
    }

    if (errors.length > 0) {
        for (const e of errors) {
            log.error(e);
        }
        log.error(`${errors.length} environment validation error(s). Server will not start.`);
        process.exit(1);
    }

    log.info(`Environment validated (${warnings.length} warning(s))`);
}

module.exports = { validateEnv };

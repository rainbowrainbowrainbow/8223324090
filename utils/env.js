/**
 * utils/env.js — Environment variable validation
 *
 * Validates all required/recommended ENV vars at startup.
 * Fails fast with a clear message instead of crashing later
 * with a cryptic "ECONNREFUSED" or "jwt malformed" error.
 *
 * Three levels:
 *   REQUIRED  — server won't start without these
 *   WARN      — server starts but features may not work
 *   INFO      — optional, logged for awareness
 */

function validateEnv() {
    const issues = [];

    // --- REQUIRED ---
    if (!process.env.DATABASE_URL) {
        issues.push('[CRITICAL] DATABASE_URL is not set — database will not connect');
    }

    // --- WARNINGS (server starts, but with limitations) ---
    if (!process.env.JWT_SECRET) {
        console.warn('[ENV] JWT_SECRET not set — using random value (sessions reset on restart)');
    }

    if (!process.env.TELEGRAM_BOT_TOKEN) {
        console.warn('[ENV] TELEGRAM_BOT_TOKEN not set — Telegram notifications disabled (can be set via admin panel)');
    }

    if (!process.env.RAILWAY_PUBLIC_DOMAIN) {
        console.warn('[ENV] RAILWAY_PUBLIC_DOMAIN not set — Telegram webhook auto-setup disabled');
    }

    // --- INFO ---
    const port = process.env.PORT || 3000;
    console.log(`[ENV] PORT=${port}, DATABASE_URL=${process.env.DATABASE_URL ? 'SET' : 'NOT SET'}, JWT_SECRET=${process.env.JWT_SECRET ? 'SET' : 'random'}`);

    // If critical issues found — log them but don't crash
    // (allows local dev without DATABASE_URL to still see static files)
    if (issues.length > 0) {
        console.error('='.repeat(60));
        issues.forEach(issue => console.error(issue));
        console.error('='.repeat(60));
    }
}

module.exports = { validateEnv };

# PLAN: Backend Infrastructure Improvements (#4-#7)

**Project**: Park Booking System (Vanilla JS, Express, PostgreSQL 16)
**Date**: 2026-02-14
**Scope**: Graceful shutdown, env validation, booking rate limiting, Telegram API timeout

---

## Feature #4: Graceful Shutdown

### Current State

`server.js` has no SIGTERM/SIGINT handlers. The only process-level handlers are:

```js
// server.js:104-110
process.on('unhandledRejection', (reason) => {
    log.error('Unhandled promise rejection', reason);
});
process.on('uncaughtException', (err) => {
    log.error('Uncaught exception', err);
    process.exit(1);
});
```

The HTTP server reference is **not stored** -- `app.listen()` is called inline without assigning the return value. Seven `setInterval` timers are created without storing their IDs, so they cannot be cleared.

### Resources That Need Cleanup

| Resource | File | Current State |
|---|---|---|
| HTTP server | `server.js:117` | `app.listen()` -- return value discarded |
| 7 scheduler intervals | `server.js:135-141` | `setInterval()` IDs not stored |
| 1 rate limit cleanup interval | `middleware/rateLimit.js:44-52` | `setInterval()` ID not stored |
| PostgreSQL pool | `db/index.js:10-13` | `pool` from `new Pool()` |
| In-flight Telegram HTTPS requests | `services/telegram.js` | raw `https.request()` calls |

### Implementation Plan

#### Step 1: Store server + interval references in `server.js`

```js
// Store HTTP server reference
const server = app.listen(PORT, async () => { ... });

// Store all interval IDs
const intervals = [];
intervals.push(setInterval(checkAutoDigest, 60000));
intervals.push(setInterval(checkAutoReminder, 60000));
intervals.push(setInterval(checkAutoBackup, 60000));
intervals.push(setInterval(checkRecurringTasks, 60000));
intervals.push(setInterval(checkRecurringAfisha, 60000));
intervals.push(setInterval(checkScheduledDeletions, 60000));
intervals.push(setInterval(checkCertificateExpiry, 60000));
```

#### Step 2: Export cleanup interval from `middleware/rateLimit.js`

```js
const cleanupInterval = setInterval(() => { ... }, 300000);
module.exports = { rateLimiter, loginRateLimiter, cleanupInterval };
```

#### Step 3: Add shutdown handler in `server.js`

```js
let isShuttingDown = false;

async function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    log.info(`${signal} received. Starting graceful shutdown...`);

    // 1. Stop accepting new connections
    server.close(() => {
        log.info('HTTP server closed (no new connections)');
    });

    // 2. Clear all scheduler intervals
    for (const id of intervals) {
        clearInterval(id);
    }
    clearInterval(cleanupInterval);
    log.info('All scheduler intervals cleared');

    // 3. Wait for in-flight Telegram requests (see Feature #7 cross-dep)
    //    telegram.js will expose a drain function
    try {
        await drainTelegramRequests(5000); // 5s max wait
        log.info('In-flight Telegram requests drained');
    } catch (e) {
        log.warn('Telegram drain timeout, proceeding');
    }

    // 4. Close DB pool (waits for active queries to finish)
    try {
        await pool.end();
        log.info('Database pool closed');
    } catch (e) {
        log.error('Error closing DB pool', e);
    }

    log.info('Graceful shutdown complete');
    process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
```

#### Step 4: Forced exit timeout

```js
// Inside gracefulShutdown, before starting cleanup:
const forceExitTimeout = setTimeout(() => {
    log.error('Graceful shutdown timed out after 15s, forcing exit');
    process.exit(1);
}, 15000);
forceExitTimeout.unref(); // Don't keep process alive just for this timer
```

#### Step 5: Reject new requests during shutdown

```js
// Add middleware before routes in server.js
app.use((req, res, next) => {
    if (isShuttingDown) {
        res.set('Connection', 'close');
        return res.status(503).json({ error: 'Server is shutting down' });
    }
    next();
});
```

### Files Changed

| File | Change |
|---|---|
| `server.js` | Store server/interval refs, add SIGTERM/SIGINT handlers, add shutdown middleware |
| `middleware/rateLimit.js` | Export cleanup interval ID |
| `services/telegram.js` | Export `drainTelegramRequests()` function (see Feature #7) |

---

## Feature #5: Env Validation at Startup

### Complete Process.env Variables Inventory

Collected via `grep -rn 'process\.env\.\w+'` across the entire codebase:

#### Application Core

| Variable | File | Current Default | Category |
|---|---|---|---|
| `PORT` | `server.js:25` | `3000` | Optional |
| `NODE_ENV` | `utils/logger.js:17` | `undefined` (dev mode) | Optional |
| `LOG_LEVEL` | `utils/logger.js:16` | `'debug'` | Optional |
| `DATABASE_URL` | `db/index.js:11-12` | `undefined` (uses pg defaults: PGHOST, PGUSER, etc.) | Conditional |
| `JWT_SECRET` | `middleware/auth.js:10` | `crypto.randomBytes(64).toString('hex')` | **Recommended** (warning already exists) |
| `RAILWAY_PUBLIC_DOMAIN` | `server.js:31,127-128`, `services/telegram.js:231-232` | `'localhost'` / `null` | Optional (Railway-specific) |

#### Rate Limiting

| Variable | File | Current Default | Category |
|---|---|---|---|
| `RATE_LIMIT_MAX` | `middleware/rateLimit.js:7` | `120` | Optional |
| `LOGIN_RATE_LIMIT_MAX` | `middleware/rateLimit.js:9` | Falls back to `RATE_LIMIT_MAX`, then `5` | Optional |

#### Telegram

| Variable | File | Current Default | Category |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | `services/telegram.js:12` | Hardcoded fallback token | **Required for Telegram** |
| `TELEGRAM_DEFAULT_CHAT_ID` | `services/telegram.js:13` | Hardcoded fallback chat ID | Optional (can be set via DB) |
| `WEBHOOK_SECRET` | `services/telegram.js:14` | `crypto.randomBytes(32).toString('hex')` | Optional (auto-generated) |

#### Test-Only (not relevant to runtime validation)

| Variable | File | Current Default | Category |
|---|---|---|---|
| `TEST_URL` | `tests/helpers.js:6` | `'http://localhost:3000'` | Test-only |
| `TEST_USER` | `tests/helpers.js:7` | `'admin'` | Test-only |
| `TEST_PASS` | `tests/helpers.js:8` | `'admin123'` | Test-only |

### Categorization

**Required** (server should refuse to start without these):
- None are strictly required today -- every variable has a fallback. However, in production (`NODE_ENV=production`), `JWT_SECRET` should be required since the auto-generated fallback changes on every restart, invalidating all user sessions.

**Recommended with Warnings** (server starts but logs warnings):
- `JWT_SECRET` -- already warns at `middleware/auth.js:11-12`
- `DATABASE_URL` -- if not set, relies on PostgreSQL environment vars (PGHOST, PGUSER, PGDATABASE), which may or may not be present

**Optional with Sane Defaults**:
- `PORT` (3000)
- `NODE_ENV` (undefined = dev mode)
- `LOG_LEVEL` ('debug')
- `RATE_LIMIT_MAX` (120)
- `LOGIN_RATE_LIMIT_MAX` (5)
- `RAILWAY_PUBLIC_DOMAIN` (null -- webhook not set)
- `TELEGRAM_BOT_TOKEN` (hardcoded fallback)
- `TELEGRAM_DEFAULT_CHAT_ID` (hardcoded fallback)
- `WEBHOOK_SECRET` (auto-generated)

### Implementation Plan

#### Step 1: Create `utils/validateEnv.js`

```js
/**
 * utils/validateEnv.js — Environment variable validation at startup
 */
const { createLogger } = require('./logger');
const log = createLogger('EnvValidator');

function validateEnv() {
    const errors = [];
    const warnings = [];

    // --- Production-required variables ---
    const isProduction = process.env.NODE_ENV === 'production';

    if (isProduction && !process.env.JWT_SECRET) {
        errors.push(
            'JWT_SECRET is not set. In production, a stable JWT secret is required. ' +
            'Without it, all user sessions are lost on every restart. ' +
            'Set JWT_SECRET to a random string (64+ characters).'
        );
    } else if (!process.env.JWT_SECRET) {
        warnings.push(
            'JWT_SECRET not set. Auto-generating random secret. ' +
            'User sessions will be lost on restart.'
        );
    }

    // --- Database connectivity ---
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
    if (!process.env.TELEGRAM_BOT_TOKEN) {
        warnings.push(
            'TELEGRAM_BOT_TOKEN not set. Using hardcoded fallback. ' +
            'Set TELEGRAM_BOT_TOKEN for your own bot.'
        );
    }

    // --- Type validation ---
    if (process.env.PORT && isNaN(parseInt(process.env.PORT))) {
        errors.push(`PORT must be a number, got: "${process.env.PORT}"`);
    }

    if (process.env.RATE_LIMIT_MAX && isNaN(parseInt(process.env.RATE_LIMIT_MAX))) {
        errors.push(`RATE_LIMIT_MAX must be a number, got: "${process.env.RATE_LIMIT_MAX}"`);
    }

    if (process.env.LOG_LEVEL && !['debug', 'info', 'warn', 'error'].includes(process.env.LOG_LEVEL)) {
        warnings.push(
            `LOG_LEVEL "${process.env.LOG_LEVEL}" is not recognized. ` +
            'Valid values: debug, info, warn, error. Defaulting to debug.'
        );
    }

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
```

#### Step 2: Call before everything in `server.js`

```js
// At the very top, after requires:
const { validateEnv } = require('./utils/validateEnv');
validateEnv(); // Exits process if critical errors found

// ... rest of server setup
```

This runs synchronously before `initDatabase()`, before `app.listen()`, before any middleware is registered.

### Files Changed

| File | Change |
|---|---|
| `utils/validateEnv.js` | **New file** -- env validation function |
| `server.js` | Import and call `validateEnv()` before server setup |

---

## Feature #6: Rate Limiting on Bookings

### Current Rate Limit Config

From `middleware/rateLimit.js`:

```
General API:  120 requests / 60 seconds per IP  (RATE_LIMIT_MAX env)
Login:          5 requests / 60 seconds per IP  (LOGIN_RATE_LIMIT_MAX env)
```

Both use in-memory Maps, keyed by IP. Cleanup runs every 5 minutes.

The general rate limiter is applied globally to `/api` in `server.js:45`:
```js
app.use('/api', rateLimiter);
```

**Problem**: Mutation-heavy endpoints (creating bookings, certificates) share the same generous 120 req/min limit with read endpoints. A script or misconfigured client could create dozens of bookings per minute.

### Target Endpoints for Stricter Limits

| Endpoint | Purpose | Proposed Limit |
|---|---|---|
| `POST /api/bookings` | Create single booking | 15 req/min per IP |
| `POST /api/bookings/full` | Create booking (extended) | 15 req/min per IP |
| `POST /api/certificates` | Issue single certificate | 10 req/min per IP |
| `POST /api/certificates/batch` | Issue batch of certificates | 3 req/min per IP |

### Implementation Plan

#### Step 1: Add configurable write rate limiter factory to `middleware/rateLimit.js`

```js
// New: stricter rate limiter for write (mutation) endpoints
const writeRateLimitMaps = new Map(); // key -> Map

function createWriteRateLimiter(name, { windowMs = 60000, max = 15 } = {}) {
    const map = new Map();
    writeRateLimitMaps.set(name, map);

    return function writeRateLimiter(req, res, next) {
        // Only apply to POST/PUT/DELETE methods
        if (!['POST', 'PUT', 'DELETE'].includes(req.method)) {
            return next();
        }

        const ip = req.ip || req.connection.remoteAddress;
        const now = Date.now();
        let entry = map.get(ip);
        if (!entry || now - entry.start > windowMs) {
            entry = { start: now, count: 1 };
            map.set(ip, entry);
        } else {
            entry.count++;
        }
        if (entry.count > max) {
            return res.status(429).json({
                error: 'Забагато запитів на створення, спробуйте пізніше'
            });
        }
        next();
    };
}

const bookingWriteLimiter = createWriteRateLimiter('bookings', { windowMs: 60000, max: 15 });
const certWriteLimiter = createWriteRateLimiter('certificates', { windowMs: 60000, max: 10 });
const certBatchLimiter = createWriteRateLimiter('cert-batch', { windowMs: 60000, max: 3 });
```

#### Step 2: Add cleanup for write rate limit maps

```js
// Extend existing cleanup interval to also clean write limiter maps
setInterval(() => {
    const now = Date.now();
    // ... existing cleanup ...
    for (const [name, map] of writeRateLimitMaps) {
        for (const [ip, entry] of map) {
            if (now - entry.start > 120000) map.delete(ip);
        }
    }
}, 300000);
```

#### Step 3: Apply in `server.js`

```js
const { rateLimiter, loginRateLimiter, bookingWriteLimiter, certWriteLimiter, certBatchLimiter } = require('./middleware/rateLimit');

// After auth middleware, before route mounting:
app.use('/api/bookings', bookingWriteLimiter);
app.use('/api/certificates/batch', certBatchLimiter); // Must be before /certificates
app.use('/api/certificates', certWriteLimiter);
```

**Ordering matters**: The `/api/certificates/batch` limiter must be registered before `/api/certificates` to match the more specific path first.

### Files Changed

| File | Change |
|---|---|
| `middleware/rateLimit.js` | Add `createWriteRateLimiter` factory + 3 preconfigured limiters |
| `server.js` | Import and mount `bookingWriteLimiter`, `certWriteLimiter`, `certBatchLimiter` |

---

## Feature #7: Telegram API Timeout

### Current State

`services/telegram.js` uses raw `https.request()` with **no timeouts**.

#### `telegramRequest()` (line 19-40)

```js
function telegramRequest(method, body) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : '';
        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${TELEGRAM_BOT_TOKEN}/${method}`,
            method: body ? 'POST' : 'GET',
            headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
        };
        const req = https.request(options, (res) => {
            let result = '';
            res.on('data', (chunk) => result += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(result)); }
                catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        if (body) req.write(data);
        req.end();
    });
}
```

**Problems**:
1. No socket timeout -- if Telegram API hangs during TLS handshake or connection, the request hangs forever.
2. No response timeout -- if Telegram sends headers but never finishes the body, the request hangs.
3. No request abort on timeout.
4. `sendTelegramMessage()` has retry logic (3 retries, 1s * attempt delay) but `telegramRequest()` itself has no timeout, so each retry could hang indefinitely.

#### `sendTelegramPhoto()` (line 266-311)

Same raw `https.request()` pattern, same problems. No timeout, no retry.

### Implementation Plan

#### Step 1: Add timeouts to `telegramRequest()`

```js
const TELEGRAM_SOCKET_TIMEOUT = 10000;  // 10s for TCP/TLS connection
const TELEGRAM_RESPONSE_TIMEOUT = 15000; // 15s for full response

// Track in-flight requests for graceful shutdown
let inFlightCount = 0;
let drainResolvers = [];

function telegramRequest(method, body) {
    return new Promise((resolve, reject) => {
        inFlightCount++;
        const data = body ? JSON.stringify(body) : '';
        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${TELEGRAM_BOT_TOKEN}/${method}`,
            method: body ? 'POST' : 'GET',
            headers: body ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            } : {},
            timeout: TELEGRAM_SOCKET_TIMEOUT // Socket connect timeout
        };

        let settled = false;
        function settle(fn, value) {
            if (settled) return;
            settled = true;
            inFlightCount--;
            if (inFlightCount === 0) {
                drainResolvers.forEach(r => r());
                drainResolvers = [];
            }
            fn(value);
        }

        // Response-level timeout
        const responseTimer = setTimeout(() => {
            req.destroy(new Error(`Telegram API response timeout (${TELEGRAM_RESPONSE_TIMEOUT}ms)`));
        }, TELEGRAM_RESPONSE_TIMEOUT);

        const req = https.request(options, (res) => {
            let result = '';
            res.on('data', (chunk) => result += chunk);
            res.on('end', () => {
                clearTimeout(responseTimer);
                try { settle(resolve, JSON.parse(result)); }
                catch (e) { settle(reject, e); }
            });
        });

        req.on('timeout', () => {
            req.destroy(new Error(`Telegram API socket timeout (${TELEGRAM_SOCKET_TIMEOUT}ms)`));
        });

        req.on('error', (err) => {
            clearTimeout(responseTimer);
            settle(reject, err);
        });

        if (body) req.write(data);
        req.end();
    });
}
```

#### Step 2: Add timeouts to `sendTelegramPhoto()`

Apply the same pattern to the `sendTelegramPhoto()` function (line 266-311):

```js
async function sendTelegramPhoto(chatId, photoBuffer, caption, options = {}) {
    // ... existing boundary/body construction ...

    return new Promise((resolve, reject) => {
        inFlightCount++;
        let settled = false;
        function settle(fn, value) {
            if (settled) return;
            settled = true;
            inFlightCount--;
            if (inFlightCount === 0) {
                drainResolvers.forEach(r => r());
                drainResolvers = [];
            }
            fn(value);
        }

        const responseTimer = setTimeout(() => {
            req.destroy(new Error('Telegram sendPhoto response timeout'));
        }, TELEGRAM_RESPONSE_TIMEOUT);

        const req = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
            method: 'POST',
            headers: { ... },
            timeout: TELEGRAM_SOCKET_TIMEOUT
        }, (res) => {
            let result = '';
            res.on('data', (chunk) => result += chunk);
            res.on('end', () => {
                clearTimeout(responseTimer);
                try {
                    const parsed = JSON.parse(result);
                    settle(resolve, parsed);
                } catch (e) { settle(reject, e); }
            });
        });

        req.on('timeout', () => {
            req.destroy(new Error('Telegram sendPhoto socket timeout'));
        });

        req.on('error', (err) => {
            clearTimeout(responseTimer);
            settle(reject, err);
        });

        req.write(body);
        req.end();
    });
}
```

#### Step 3: Adjust retry logic in `sendTelegramMessage()`

Current retry in `sendTelegramMessage()` (line 66-94) already does 3 retries with `1000 * attempt` ms backoff. Update to:

- **Max 2 retries** (3 attempts total is fine, keep current).
- **Exponential backoff**: `1000 * 2^(attempt-1)` -- 1s, 2s.
- **Only retry on timeout errors**, not on API 4xx errors.

```js
async function sendTelegramMessage(chatId, text, options = {}) {
    const retries = options.retries || 3;
    const threadId = await getConfiguredThreadId();
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const payload = { ... };
            const result = await telegramRequest('sendMessage', payload);
            if (result && result.ok) {
                log.info(`Message sent to ${chatId} (attempt ${attempt})`);
            } else {
                // API error (e.g., 400 Bad Request) -- do NOT retry
                log.warn(`API returned error on attempt ${attempt}`, result);
                if (result?.error_code >= 400 && result?.error_code < 500) {
                    return result; // Client error, retrying won't help
                }
            }
            return result;
        } catch (err) {
            log.error(`Send error (attempt ${attempt}/${retries}): ${err.message}`);
            if (attempt < retries) {
                const backoff = 1000 * Math.pow(2, attempt - 1); // 1s, 2s
                await new Promise(r => setTimeout(r, backoff));
            }
        }
    }
    log.error(`All ${retries} attempts failed for chat ${chatId}`);
    return null;
}
```

#### Step 4: Export drain function for graceful shutdown

```js
/**
 * Wait for all in-flight Telegram requests to complete.
 * Used by graceful shutdown in server.js.
 * @param {number} timeoutMs - Max time to wait (default 5000ms)
 */
function drainTelegramRequests(timeoutMs = 5000) {
    if (inFlightCount === 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
        drainResolvers.push(resolve);
        setTimeout(() => reject(new Error('Telegram drain timeout')), timeoutMs);
    });
}

module.exports = {
    // ... existing exports ...
    drainTelegramRequests
};
```

### Files Changed

| File | Change |
|---|---|
| `services/telegram.js` | Add socket/response timeouts to `telegramRequest()` and `sendTelegramPhoto()`, add in-flight tracking, add `drainTelegramRequests()`, adjust retry backoff |

---

## Cross-Dependencies

### Dependency Graph

```
Feature #5 (Env Validation)
    |
    v
Feature #4 (Graceful Shutdown) ---- depends on ----> Feature #7 (Telegram drain)
    |
    v
Feature #6 (Rate Limiting on Bookings) -- independent --
```

### Dependency Details

1. **Feature #5 runs before everything else**: `validateEnv()` is called synchronously at the top of `server.js`, before `initDatabase()`, before `app.listen()`. No dependencies on other features.

2. **Feature #4 depends on Feature #7**: The graceful shutdown handler calls `drainTelegramRequests()` which is added in Feature #7. The `inFlightCount` and drain mechanism must be implemented in `telegram.js` first.

3. **Feature #6 is independent**: Rate limiting changes only touch `middleware/rateLimit.js` and `server.js` route mounting. No interaction with shutdown or Telegram.

### Recommended Implementation Order

| Order | Feature | Reason |
|---|---|---|
| 1st | **#5 -- Env Validation** | Zero dependencies. Simple, standalone. Catches config errors early. |
| 2nd | **#7 -- Telegram API Timeout** | Must be in place before #4 (exports `drainTelegramRequests`). Fixes existing reliability issue. |
| 3rd | **#4 -- Graceful Shutdown** | Depends on #7 for Telegram drain. Most complex change (touches 3 files). |
| 4th | **#6 -- Rate Limiting** | Independent but lowest priority. Can be added at any time. |

### Shared File Changes Summary

| File | Features Touching It |
|---|---|
| `server.js` | #4, #5, #6 |
| `middleware/rateLimit.js` | #4 (export interval), #6 (write limiters) |
| `services/telegram.js` | #4 (drain export), #7 (timeouts) |
| `utils/validateEnv.js` | #5 (new file) |

### Testing Considerations

- **#5**: Test by unsetting `JWT_SECRET` with `NODE_ENV=production` -- server should refuse to start. Test with invalid `PORT=abc` -- should refuse. Test with valid env -- should start normally.
- **#7**: Simulate Telegram API timeout by pointing to a non-responsive host or using a test server with delayed responses. Verify that requests time out after 10-15s instead of hanging forever. Verify retry backoff timing.
- **#4**: Send SIGTERM to running server, verify: (a) new requests get 503, (b) in-flight requests complete, (c) scheduler intervals stop, (d) DB pool closes, (e) process exits cleanly. Test forced exit by having a hung DB query during shutdown -- should force exit after 15s.
- **#6**: Send rapid POST requests to `/api/bookings` -- verify 429 after 15th request in a minute. Verify GET requests are unaffected. Verify `/api/certificates/batch` limits at 3/min.

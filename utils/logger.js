/**
 * utils/logger.js — Structured logging with request ID tracking (v5.29)
 *
 * Features:
 * - Levels: debug, info, warn, error
 * - JSON format in production, human-readable in dev
 * - Request ID via AsyncLocalStorage (auto-attached to every log)
 * - Module context via child('ModuleName')
 * - Timestamp in ISO format
 */
const { AsyncLocalStorage } = require('async_hooks');

const asyncLocalStorage = new AsyncLocalStorage();

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const LOG_LEVEL = LEVELS[process.env.LOG_LEVEL || 'debug'] || 0;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function getStore() {
    return asyncLocalStorage.getStore() || {};
}

function formatPretty(level, module, message, data) {
    const ts = new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
    const store = getStore();
    const reqId = store.requestId ? ` [${store.requestId}]` : '';
    const mod = module ? `[${module}] ` : '';
    const dataStr = data !== undefined
        ? (data instanceof Error ? ` ${data.stack || data.message}` : ` ${JSON.stringify(data)}`)
        : '';
    return `${ts} ${level.toUpperCase().padEnd(5)}${reqId} ${mod}${message}${dataStr}`;
}

function formatJSON(level, module, message, data) {
    const store = getStore();
    const entry = {
        ts: new Date().toISOString(),
        level,
        ...(store.requestId && { reqId: store.requestId }),
        ...(store.method && { method: store.method }),
        ...(store.path && { path: store.path }),
        ...(module && { module }),
        msg: message
    };
    if (data !== undefined) {
        if (data instanceof Error) {
            entry.error = { message: data.message, stack: data.stack };
        } else {
            entry.data = data;
        }
    }
    return JSON.stringify(entry);
}

function log(level, module, message, data) {
    if (LEVELS[level] < LOG_LEVEL) return;

    const formatted = IS_PRODUCTION
        ? formatJSON(level, module, message, data)
        : formatPretty(level, module, message, data);

    if (level === 'error') {
        process.stderr.write(formatted + '\n');
    } else if (level === 'warn') {
        process.stderr.write(formatted + '\n');
    } else {
        process.stdout.write(formatted + '\n');
    }
}

function createLogger(module) {
    return {
        debug: (msg, data) => log('debug', module, msg, data),
        info:  (msg, data) => log('info',  module, msg, data),
        warn:  (msg, data) => log('warn',  module, msg, data),
        error: (msg, data) => log('error', module, msg, data),
        child: (childModule) => createLogger(module ? `${module}:${childModule}` : childModule)
    };
}

const logger = createLogger(null);

module.exports = { logger, createLogger, asyncLocalStorage };

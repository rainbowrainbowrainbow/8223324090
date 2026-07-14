'use strict';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const DATABASE_NAME_MARKER = /(^|[_-])(test|testing|ci|disposable)([_-]|$)/i;
const FORBIDDEN_HOST_MARKERS = /(railway|rlwy|primary-db)/i;
const FORBIDDEN_TARGET_MARKERS = /(^|[._-])(prod|production|live)([._-]|$)/i;
const RESET_CONFIRMATION = 'RESET_DISPOSABLE_TEST_DATABASE';
const REMOTE_CONFIRMATION = 'ALLOW_REMOTE_DISPOSABLE_TEST_DATABASE';

function parsePostgresUrl(rawValue) {
    const value = String(rawValue || '').trim();
    if (!value) {
        throw new Error('TEST_DATABASE_URL is required; DATABASE_URL is never used as a fallback');
    }

    let url;
    try {
        url = new URL(value);
    } catch {
        throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL');
    }

    if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
        throw new Error('TEST_DATABASE_URL must use postgres:// or postgresql://');
    }
    if (!url.hostname || !url.pathname || url.pathname === '/') {
        throw new Error('TEST_DATABASE_URL must include a host and database name');
    }
    return url;
}

function comparableDatabaseUrl(rawValue) {
    if (!rawValue) return null;
    try {
        const url = new URL(String(rawValue).trim());
        const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
        const port = url.port || '5432';
        const databaseName = decodeURIComponent(url.pathname.slice(1)).toLowerCase();
        return `${hostname}:${port}/${databaseName}`;
    } catch {
        return null;
    }
}

function assertSafeTestDatabaseUrl(rawValue, env = process.env) {
    const url = parsePostgresUrl(rawValue);
    const databaseName = decodeURIComponent(url.pathname.slice(1));
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const isLocal = LOCAL_HOSTS.has(hostname);

    if (env.NODE_ENV === 'production' || env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID || env.RAILWAY_SERVICE_ID) {
        throw new Error('Isolated DB tests are blocked in production/Railway environments');
    }
    if (FORBIDDEN_HOST_MARKERS.test(hostname)
        || FORBIDDEN_TARGET_MARKERS.test(hostname)
        || FORBIDDEN_TARGET_MARKERS.test(databaseName)) {
        throw new Error('TEST_DATABASE_URL points to a forbidden production/Railway-like host');
    }
    if (!DATABASE_NAME_MARKER.test(databaseName)) {
        throw new Error('Disposable database name must contain test, testing, ci, or disposable as a separate marker');
    }
    if (['postgres', 'template0', 'template1'].includes(databaseName.toLowerCase())) {
        throw new Error('Administrative/default PostgreSQL databases cannot be reset by the test runner');
    }
    if (String(env.TEST_DATABASE_RESET_CONFIRM || '') !== RESET_CONFIRMATION) {
        throw new Error(`Set TEST_DATABASE_RESET_CONFIRM=${RESET_CONFIRMATION} to allow disposable schema reset`);
    }

    const candidate = comparableDatabaseUrl(rawValue);
    for (const key of ['DATABASE_URL', 'PRODUCTION_DATABASE_URL', 'LIVE_DATABASE_URL']) {
        const configured = comparableDatabaseUrl(env[key]);
        if (configured && configured === candidate) {
            throw new Error(`TEST_DATABASE_URL must not match ${key}`);
        }
    }

    if (!isLocal && String(env.TEST_DATABASE_ALLOW_REMOTE || '') !== REMOTE_CONFIRMATION) {
        throw new Error(`Remote disposable DB requires TEST_DATABASE_ALLOW_REMOTE=${REMOTE_CONFIRMATION}`);
    }

    return { url, databaseName, hostname, isLocal };
}

function assertSafeIsolatedTestUrl(rawValue) {
    const value = String(rawValue || '').trim();
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new Error('TEST_URL must be a valid URL for isolated DB tests');
    }
    if (url.protocol !== 'http:' || !LOCAL_HOSTS.has(url.hostname.toLowerCase())) {
        throw new Error('Isolated DB tests may call only a local HTTP server');
    }
    if (!url.port) {
        throw new Error('TEST_URL must include the isolated server port');
    }
    return url;
}

module.exports = {
    RESET_CONFIRMATION,
    REMOTE_CONFIRMATION,
    assertSafeTestDatabaseUrl,
    assertSafeIsolatedTestUrl,
    parsePostgresUrl
};

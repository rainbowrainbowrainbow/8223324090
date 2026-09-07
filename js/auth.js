/**
 * auth.js - Авторизація та управління сесією
 * v5.0: Server-side JWT authentication
 */

function _escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let profileModalPasswordBaseline = '';
const AUTH_REFRESH_TOKEN_KEY = 'pzp_refresh_token';
const AUTH_ACCESS_TOKEN_KEY = 'pzp_access_token';
const AUTH_REFRESH_EXPIRES_KEY = 'pzp_refresh_expires_at';
const AUTH_SESSION_GENERATION_KEY = 'pzp_auth_session_generation';
const AUTH_TRANSITION_KEY = 'pzp_auth_transition';
const AUTH_LOGIN_INTENT_KEY = 'pzp_auth_login_intent';
const AUTH_RETURN_ROUTE_KEY = 'pzp_auth_return_route_v1';
const AUTH_RETURN_ROUTE_MAX_AGE_MS = 10 * 60 * 1000;
const AUTH_TRANSITION_MAX_AGE_MS = 15000;
let serviceWorkerRegistrationPromise = null;
let authenticatedRuntimeReady = false;
let offlineSessionRecoveryBound = false;
let crossTabLogoutInProgress = false;
let crossTabSessionSyncInProgress = false;
let authOwnedTransition = null;
let authServiceWorkerUpdatePromptVisible = false;
let authServiceWorkerUpdateDismissedForController = '';

function installRedirectDiagnosticsRuntime(global = window) {
    if (!global || global.RedirectDiagnostics) return global?.RedirectDiagnostics || null;

    const STORAGE_KEY = 'pzp_redirect_diagnostics_v1';
    const TAB_ID_KEY = 'pzp_redirect_diagnostics_tab_id';
    const SW_VERSION_KEY = 'pzp_redirect_diagnostics_sw_version';
    const MAX_ENTRIES = 80;
    const MAX_STORAGE_BYTES = 32768;
    const MAX_ENTRY_AGE_MS = 24 * 60 * 60 * 1000;
    const DEDUP_WINDOW_MS = 2000;
    const MAX_ROUTE_LENGTH = 120;
    const MAX_ROUTE_SEGMENTS = 3;
    const SAFE_EVENT_NAMES = new Set([
        'auth-bootstrap',
        'auth-session-failure',
        'auth-refresh',
        'auth-redirect',
        'auth-storage-clear',
        'navigation-click',
        'navigation-transition',
        'shell-lifecycle',
        'sw-offline-navigation'
    ]);
    const SAFE_DETAIL_KEYS = new Set([
        'stage',
        'status',
        'code',
        'reason',
        'requestId',
        'refreshOutcome',
        'redirectReason',
        'storageClearReason',
        'lifecycle',
        'bucket',
        'retryAfterSeconds',
        'targetRoute'
    ]);
    const SAFE_ENTRY_KEYS = new Set([
        'event',
        'at',
        'updatedAt',
        'count',
        'tabId',
        'buildVersion',
        'swVersion',
        'route',
        'visibility',
        ...SAFE_DETAIL_KEYS
    ]);
    const SAFE_ROUTE_MODULES = new Set([
        '',
        'dashboard',
        'sales-funnel',
        'customers',
        'certificates',
        'tasks',
        'profile',
        'staff',
        'hr',
        'reports',
        'analytics',
        'finance',
        'settings',
        'chat',
        'warehouse',
        'designs',
        'programs',
        'bookings',
        'afisha',
        'training',
        'invite',
        'sound',
        'omni',
        'timeline',
        'maysternya-doli',
        'kleshnya',
        'copilot',
        'guardian-ops',
        'hermes-studio',
        'status'
    ]);
    const SAFE_STATIC_ROUTE_CHILDREN = new Map([
        ['certificates', new Set(['new', 'batch'])],
        ['embed', new Set(['designs', 'programs', 'graduation'])],
        ['omni', new Set(['accounts'])]
    ]);
    const SAFE_CODE_VALUES = new Set([
        'unknown',
        'auth_availability_rate_limited',
        'auth_session_temporarily_unavailable',
        'auth_token_missing',
        'auth_token_invalid',
        'auth_user_missing',
        'auth_user_deactivated',
        'auth_user_inactive',
        'auth_session_revoked',
        'auth_identity_changed',
        'refresh_already_rotated'
    ]);
    const SAFE_REASON_VALUES = new Set([
        'unknown',
        'network',
        'http',
        'offline',
        'missing-session',
        'missing-or-terminal-session',
        'session-changed',
        'session-changed-retry',
        'session-transition',
        'malformed-response',
        'rate-limit-retry-later',
        'rate-limit-retry-exhausted',
        'refresh-already-rotated',
        'refresh-identity-mismatch',
        'forbidden-session',
        'unauthorized',
        'page-access-denied',
        'login-page',
        'authenticated-start-page',
        'context-access-denied',
        'auth-storage-clear',
        'api-auth-session-clear',
        'logout',
        'refresh-terminal',
        'refresh-identity-mismatch',
        'verify-forbidden-session',
        'verify-unauthorized',
        'verify-terminal',
        'offline-navigation',
        'bootstrap-error',
        'refresh-watchdog-timeout'
    ]);
    const SAFE_STAGE_VALUES = new Set([
        'unknown',
        'check-session-start',
        'session-bootstrap',
        'business-profile',
        'permissions',
        'verify',
        'refresh',
        'request',
        'user-merge',
        'cleanup',
        'complete',
        'post-login',
        'show-login-screen',
        'page-access',
        'business-context',
        'sidebar-click',
        'page-exiting',
        'recover-shell',
        'auto-fill',
        'bootstrap-error'
    ]);
    const SAFE_OUTCOME_VALUES = new Set(['unknown', 'success', 'empty', 'missing', 'transient', 'terminal', 'superseded', 'retry-later']);
    const SAFE_LIFECYCLE_VALUES = new Set(['unknown', 'pageshow-persisted', 'visibility-resume', 'offline-navigation']);
    const SAFE_BUCKET_VALUES = new Set(['unknown', 'auth_availability_ip', 'login_account_ip', 'login_ip', 'refresh_ip']);
    const SAFE_VISIBILITY_VALUES = new Set(['unknown', 'visible', 'hidden', 'prerender', 'unloaded']);

    const now = () => Date.now();
    const storage = () => {
        try { return global.localStorage || null; }
        catch { return null; }
    };
    const tabStorage = () => {
        try { return global.sessionStorage || null; }
        catch { return null; }
    };

    function safeShort(value, maxLength = 80) {
        if (value === undefined || value === null) return '';
        return String(value)
            .replace(/[^a-zA-Z0-9_.:-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, maxLength);
    }

    function normalizeToken(value) {
        return safeShort(value, 80).toLowerCase();
    }

    function controlledValue(value, allowedValues, fallback = 'unknown') {
        const normalized = normalizeToken(value);
        return allowedValues.has(normalized) ? normalized : fallback;
    }

    function tabId() {
        const session = tabStorage();
        if (!session) return 'tab-unavailable';
        try {
            const existing = session.getItem(TAB_ID_KEY);
            if (existing && /^tab-[a-z0-9-]{4,44}$/i.test(existing)) return existing;
            const random = global.crypto?.getRandomValues
                ? Array.from(global.crypto.getRandomValues(new Uint8Array(8)), byte => byte.toString(16).padStart(2, '0')).join('')
                : Math.random().toString(36).slice(2, 18);
            const value = `tab-${random}`.slice(0, 48);
            session.setItem(TAB_ID_KEY, value);
            return value;
        } catch {
            return 'tab-unavailable';
        }
    }

    function buildVersion() {
        try {
            const scripts = Array.from(global.document?.scripts || []);
            const versionScript = scripts.find(script => /(^|\/)js\/auth\.js/i.test(script.getAttribute('src') || ''))
                || scripts.find(script => /[?&]v=/.test(script.getAttribute('src') || ''));
            if (!versionScript) return '';
            return safeShort(new URL(versionScript.src, global.location?.href || 'http://localhost/').searchParams.get('v') || '', 32);
        } catch {
            return '';
        }
    }

    function sanitizeServiceWorkerVersion(value) {
        const normalized = safeShort(value, 80);
        return /^event-genix(?:-api)?-v[a-zA-Z0-9_.:-]+$/.test(normalized) ? normalized : 'unknown';
    }

    function rememberServiceWorkerVersion(value) {
        const normalized = sanitizeServiceWorkerVersion(value);
        if (normalized === 'unknown') return normalized;
        try { tabStorage()?.setItem(SW_VERSION_KEY, normalized); } catch {}
        try { storage()?.setItem(SW_VERSION_KEY, normalized); } catch {}
        return normalized;
    }

    function serviceWorkerVersion() {
        try {
            return sanitizeServiceWorkerVersion(tabStorage()?.getItem(SW_VERSION_KEY) || storage()?.getItem(SW_VERSION_KEY) || 'unknown');
        } catch {
            return 'unknown';
        }
    }

    function refreshServiceWorkerVersion(timeoutMs = 800) {
        return new Promise(resolve => {
            try {
                const controller = global.navigator?.serviceWorker?.controller;
                const Channel = global.MessageChannel || (typeof MessageChannel === 'function' ? MessageChannel : null);
                if (!controller || typeof controller.postMessage !== 'function' || !Channel) {
                    resolve(serviceWorkerVersion());
                    return;
                }
                const channel = new Channel();
                let settled = false;
                const finish = value => {
                    if (settled) return;
                    settled = true;
                    resolve(rememberServiceWorkerVersion(value));
                };
                const setTimer = global.setTimeout || (typeof setTimeout === 'function' ? setTimeout : null);
                const clearTimer = global.clearTimeout || (typeof clearTimeout === 'function' ? clearTimeout : null);
                const timer = setTimer ? setTimer(() => finish('unknown'), timeoutMs) : null;
                channel.port1.onmessage = event => {
                    if (timer && clearTimer) clearTimer(timer);
                    if (event?.data?.type === 'redirect-diagnostics:version') finish(event.data.swVersion);
                    else finish('unknown');
                };
                controller.postMessage({ type: 'redirect-diagnostics:get-version' }, [channel.port2]);
            } catch {
                resolve(serviceWorkerVersion());
            }
        });
    }

    function safeRouteSegment(segment) {
        let decoded = String(segment || '');
        try { decoded = decodeURIComponent(decoded); } catch {}
        return decoded
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_.:-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 48);
    }

    function normalizeRoute(value) {
        let pathname = value;
        try {
            if (!pathname) pathname = global.location?.pathname || '/';
            pathname = new URL(String(pathname), global.location?.origin || 'http://localhost').pathname || '/';
        } catch {
            pathname = String(pathname || '/').split(/[?#]/)[0] || '/';
        }
        const segments = String(pathname || '/')
            .split('/')
            .filter(Boolean)
            .map(safeRouteSegment)
            .filter(Boolean);
        if (!segments.length) return '/';
        const moduleName = segments[0];
        if (!SAFE_ROUTE_MODULES.has(moduleName)) return '/:unknown';
        const output = [moduleName];
        const staticChildren = SAFE_STATIC_ROUTE_CHILDREN.get(moduleName) || new Set();
        for (let index = 1; index < segments.length && output.length < MAX_ROUTE_SEGMENTS; index += 1) {
            const segment = segments[index];
            output.push(staticChildren.has(segment) ? segment : ':id');
        }
        const route = '/' + output.join('/');
        return route.length > MAX_ROUTE_LENGTH ? route.slice(0, MAX_ROUTE_LENGTH) : route;
    }

    function sanitizeDetails(details = {}) {
        const result = {};
        for (const key of SAFE_DETAIL_KEYS) {
            if (!Object.prototype.hasOwnProperty.call(details, key)) continue;
            if (key === 'status') {
                const status = Number(details[key]);
                if (Number.isInteger(status) && status >= 100 && status <= 599) result.status = status;
                continue;
            }
            if (key === 'retryAfterSeconds') {
                const seconds = Number(details[key]);
                if (Number.isFinite(seconds) && seconds > 0 && seconds <= 86400) result.retryAfterSeconds = Math.ceil(seconds);
                continue;
            }
            if (key === 'targetRoute') {
                result.targetRoute = normalizeRoute(details[key]);
                continue;
            }
            if (key === 'requestId') {
                const requestId = safeShort(details[key], 80);
                if (requestId) result.requestId = requestId;
                continue;
            }
            if (key === 'code') {
                result.code = controlledValue(details[key], SAFE_CODE_VALUES);
                continue;
            }
            if (key === 'stage') {
                result.stage = controlledValue(details[key], SAFE_STAGE_VALUES);
                continue;
            }
            if (key === 'reason' || key === 'redirectReason' || key === 'storageClearReason') {
                result[key] = controlledValue(details[key], SAFE_REASON_VALUES);
                continue;
            }
            if (key === 'refreshOutcome') {
                result.refreshOutcome = controlledValue(details[key], SAFE_OUTCOME_VALUES);
                continue;
            }
            if (key === 'lifecycle') {
                result.lifecycle = controlledValue(details[key], SAFE_LIFECYCLE_VALUES);
                continue;
            }
            if (key === 'bucket') {
                result.bucket = controlledValue(details[key], SAFE_BUCKET_VALUES);
            }
        }
        return result;
    }

    function sanitizeEntry(entry, timestamp = now()) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
        const eventName = SAFE_EVENT_NAMES.has(String(entry.event || '')) ? String(entry.event) : null;
        const at = Number(entry.at || 0);
        if (!eventName || !Number.isFinite(at) || at <= 0) return null;
        if (at < timestamp - MAX_ENTRY_AGE_MS || at > timestamp + 60000) return null;
        const result = {
            event: eventName,
            at,
            tabId: /^tab-[a-z0-9-]{4,44}$/i.test(String(entry.tabId || '')) || entry.tabId === 'sw-offline-page'
                ? String(entry.tabId)
                : 'tab-unavailable',
            buildVersion: safeShort(entry.buildVersion || '', 32),
            swVersion: sanitizeServiceWorkerVersion(entry.swVersion || 'unknown'),
            route: normalizeRoute(entry.route),
            visibility: controlledValue(entry.visibility, SAFE_VISIBILITY_VALUES)
        };
        Object.assign(result, sanitizeDetails(entry));
        const updatedAt = Number(entry.updatedAt || 0);
        if (Number.isFinite(updatedAt) && updatedAt >= at && updatedAt <= timestamp + 60000) result.updatedAt = updatedAt;
        const count = Number(entry.count || 0);
        if (Number.isInteger(count) && count > 1) result.count = Math.min(count, 999);
        const alwaysKeepKeys = new Set(['event', 'at', 'tabId', 'buildVersion', 'swVersion', 'route', 'visibility']);
        return Object.fromEntries(Object.entries(result).filter(([key, value]) => (
            SAFE_ENTRY_KEYS.has(key)
            && value !== undefined
            && (value !== '' || alwaysKeepKeys.has(key))
        )));
    }

    function readEntries() {
        const local = storage();
        if (!local) return [];
        try {
            const parsed = JSON.parse(local.getItem(STORAGE_KEY) || '{}');
            return Array.isArray(parsed.entries)
                ? parsed.entries.map(entry => sanitizeEntry(entry)).filter(Boolean).slice(-MAX_ENTRIES)
                : [];
        } catch {
            return [];
        }
    }

    function writeEntries(entries) {
        const local = storage();
        if (!local) return false;
        let bounded = entries.map(entry => sanitizeEntry(entry)).filter(Boolean).slice(-MAX_ENTRIES);
        let payload = JSON.stringify({ schema: 'eventgenix.redirect-diagnostics.v1', entries: bounded });
        while (payload.length > MAX_STORAGE_BYTES && bounded.length > 0) {
            bounded = bounded.slice(1);
            payload = JSON.stringify({ schema: 'eventgenix.redirect-diagnostics.v1', entries: bounded });
        }
        try {
            local.setItem(STORAGE_KEY, payload);
            return true;
        } catch {
            return false;
        }
    }

    function sameDedupKey(left, right) {
        return ['event', 'tabId', 'route', 'stage', 'status', 'code', 'reason', 'requestId', 'refreshOutcome', 'redirectReason', 'storageClearReason', 'lifecycle', 'targetRoute']
            .every(key => String(left?.[key] || '') === String(right?.[key] || ''));
    }

    function record(event, details = {}) {
        try {
            const entry = sanitizeEntry({
                event: SAFE_EVENT_NAMES.has(String(event || '')) ? String(event) : 'auth-bootstrap',
                at: now(),
                tabId: tabId(),
                buildVersion: buildVersion(),
                swVersion: serviceWorkerVersion(),
                route: normalizeRoute(details.route),
                visibility: controlledValue(global.document?.visibilityState || 'unknown', SAFE_VISIBILITY_VALUES),
                ...sanitizeDetails(details)
            });
            if (!entry) return false;
            const entries = readEntries();
            const previous = entries[entries.length - 1];
            if (previous && sameDedupKey(previous, entry) && entry.at - Number(previous.updatedAt || previous.at || 0) <= DEDUP_WINDOW_MS) {
                previous.updatedAt = entry.at;
                previous.count = Number(previous.count || 1) + 1;
            } else {
                entries.push(entry);
            }
            writeEntries(entries);
            return true;
        } catch {
            return false;
        }
    }

    function exportDiagnostics() {
        try {
            const entries = readEntries();
            writeEntries(entries);
            return {
                schema: 'eventgenix.redirect-diagnostics.v1',
                generatedAt: new Date(now()).toISOString(),
                tabId: tabId(),
                buildVersion: buildVersion(),
                swVersion: serviceWorkerVersion(),
                entries
            };
        } catch {
            return {
                schema: 'eventgenix.redirect-diagnostics.v1',
                generatedAt: new Date().toISOString(),
                tabId: 'tab-unavailable',
                swVersion: 'unknown',
                entries: []
            };
        }
    }

    async function copy() {
        await refreshServiceWorkerVersion().catch(() => 'unknown');
        const text = JSON.stringify(exportDiagnostics(), null, 2);
        try {
            if (global.navigator?.clipboard?.writeText) {
                await global.navigator.clipboard.writeText(text);
                return { copied: true, text };
            }
        } catch {}
        return { copied: false, text };
    }

    function clear() {
        try { storage()?.removeItem(STORAGE_KEY); } catch {}
    }

    try {
        global.navigator?.serviceWorker?.addEventListener?.('controllerchange', () => {
            void refreshServiceWorkerVersion();
        });
        void refreshServiceWorkerVersion();
    } catch {}

    global.RedirectDiagnostics = {
        record,
        export: exportDiagnostics,
        copy,
        clear,
        normalizeRoute,
        refreshServiceWorkerVersion,
        storageKey: STORAGE_KEY,
        limits: Object.freeze({
            maxEntries: MAX_ENTRIES,
            maxStorageBytes: MAX_STORAGE_BYTES,
            maxEntryAgeMs: MAX_ENTRY_AGE_MS,
            maxRouteLength: MAX_ROUTE_LENGTH
        })
    };
    return global.RedirectDiagnostics;
}

if (typeof window !== 'undefined') {
    installRedirectDiagnosticsRuntime(window);
}

function recordRedirectDiagnostic(event, details = {}) {
    try {
        window.RedirectDiagnostics?.record(event, details);
    } catch {}
}

function getActiveAuthTransitionMarker() {
    const marker = localStorage.getItem(AUTH_TRANSITION_KEY) || '';
    if (!marker) return '';
    const parts = String(marker).split('-');
    const timestampPart = ['remember', 'merge', 'api', 'auth', 'impersonate', 'restore'].includes(parts[0])
        ? parts[1]
        : parts[0];
    const startedAt = Number.parseInt(timestampPart || '', 36);
    const ageMs = Date.now() - startedAt;
    if (!Number.isFinite(startedAt)
        || ageMs > AUTH_TRANSITION_MAX_AGE_MS
        || ageMs < -1000) {
        if (localStorage.getItem(AUTH_TRANSITION_KEY) === marker) {
            localStorage.removeItem(AUTH_TRANSITION_KEY);
        }
        return '';
    }
    return marker;
}

function beginAuthTransition(prefix = 'auth') {
    const activeMarker = getActiveAuthTransitionMarker();
    if (activeMarker) {
        if (authOwnedTransition?.marker === activeMarker) {
            authOwnedTransition.depth += 1;
            return { marker: activeMarker, owned: true };
        }
        return { marker: activeMarker, owned: false };
    }
    const marker = `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(AUTH_TRANSITION_KEY, marker);
    authOwnedTransition = { marker, depth: 1 };
    return { marker, owned: true };
}

function endAuthTransition(transition) {
    if (!transition?.owned || authOwnedTransition?.marker !== transition.marker) return;
    authOwnedTransition.depth -= 1;
    if (authOwnedTransition.depth > 0) return;
    authOwnedTransition = null;
    if (localStorage.getItem(AUTH_TRANSITION_KEY) === transition.marker) {
        localStorage.removeItem(AUTH_TRANSITION_KEY);
    }
}

function hasAuthenticatedRuntimeSession() {
    if (typeof AppState === 'undefined' || !AppState.currentUser) return false;
    return Boolean(
        localStorage.getItem('pzp_token')
        || localStorage.getItem(AUTH_ACCESS_TOKEN_KEY)
        || localStorage.getItem(AUTH_REFRESH_TOKEN_KEY)
    );
}

function isAuthenticatedRuntimeReady() {
    return authenticatedRuntimeReady && hasAuthenticatedRuntimeSession();
}

function registerAuthenticatedServiceWorker() {
    if (!hasAuthenticatedRuntimeSession()) return Promise.resolve(null);
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);
    if (serviceWorkerRegistrationPromise) return serviceWorkerRegistrationPromise;

    serviceWorkerRegistrationPromise = navigator.serviceWorker.register('/sw.js')
        .then((registration) => {
            bindAuthenticatedServiceWorkerUpdatePrompt(registration);
            return registration;
        })
        .catch((err) => {
            serviceWorkerRegistrationPromise = null;
            console.warn('[auth] Service Worker registration failed', err);
            return null;
        });
    return serviceWorkerRegistrationPromise;
}

function markAuthenticatedRuntimeReady() {
    if (!hasAuthenticatedRuntimeSession()) return false;
    void registerAuthenticatedServiceWorker();
    if (typeof window.scheduleGlobalTaskTimerAssets === 'function') {
        window.scheduleGlobalTaskTimerAssets();
    }
    if (authenticatedRuntimeReady) return true;

    authenticatedRuntimeReady = true;
    window.dispatchEvent(new CustomEvent('crm:authenticated-runtime-ready'));
    return true;
}

function resetAuthenticatedRuntimeReady() {
    authenticatedRuntimeReady = false;
}

function scheduleOfflineSessionRecovery() {
    if (offlineSessionRecoveryBound) return;
    offlineSessionRecoveryBound = true;
    window.addEventListener('online', () => {
        offlineSessionRecoveryBound = false;
        void checkSession();
    }, { once: true });
}

window.isAuthenticatedRuntimeReady = isAuthenticatedRuntimeReady;

(function initSidebarSmartMenuLoader() {
    function assetVersion() {
        const scripts = Array.from(document.scripts || []);
        const script = scripts.find(item => /(^|\/)js\/auth\.js/.test(item.getAttribute('src') || ''))
            || scripts.find(item => /(^|\/)js\/notification\.js/.test(item.getAttribute('src') || ''))
            || scripts.find(item => /[?&]v=/.test(item.getAttribute('src') || ''));
        if (!script) return '';
        try {
            return new URL(script.src, window.location.href).searchParams.get('v') || '';
        } catch {
            return '';
        }
    }

    function assetSuffix() {
        const version = assetVersion();
        return version ? '?v=' + encodeURIComponent(version) : '';
    }

    function ensureSidebarSmartMenuAssets() {
        if (!document.getElementById('sidebarNav')) return false;
        const suffix = assetSuffix();

        if (!document.querySelector('link[data-sidebar-smart-menu-css]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = '/css/sidebar-smart-menu.css' + suffix;
            link.dataset.sidebarSmartMenuCss = 'true';
            document.head.appendChild(link);
        }

        if (window.SidebarSmartMenu && typeof window.SidebarSmartMenu.init === 'function') {
            window.SidebarSmartMenu.init();
            return true;
        }

        if (!document.querySelector('script[data-sidebar-smart-menu-js]')) {
            const script = document.createElement('script');
            script.src = '/js/sidebar-smart-menu.js' + suffix;
            script.defer = true;
            script.dataset.sidebarSmartMenuJs = 'true';
            script.onload = () => {
                if (window.SidebarSmartMenu && typeof window.SidebarSmartMenu.init === 'function') {
                    window.SidebarSmartMenu.init();
                }
            };
            document.body.appendChild(script);
        }

        return true;
    }

    function ensureGlobalTaskTimerAssets() {
        if (!hasAuthenticatedRuntimeSession()) return false;
        const suffix = assetSuffix();

        if (!document.querySelector('link[data-global-task-timer-css]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = '/css/global-task-timer.css' + suffix;
            link.dataset.globalTaskTimerCss = 'true';
            document.head.appendChild(link);
        }

        if (window.GlobalTaskTimer && typeof window.GlobalTaskTimer.init === 'function') {
            window.GlobalTaskTimer.init();
            return true;
        }

        if (!document.querySelector('script[data-global-task-timer-js]')) {
            const script = document.createElement('script');
            script.src = '/js/global-task-timer.js' + suffix;
            script.defer = true;
            script.dataset.globalTaskTimerJs = 'true';
            script.onload = () => {
                if (window.GlobalTaskTimer && typeof window.GlobalTaskTimer.init === 'function') {
                    window.GlobalTaskTimer.init();
                }
            };
            document.body.appendChild(script);
        }

        return true;
    }

    function scheduleSidebarSmartMenuAssets() {
        const ensure = window.ensureSidebarSmartMenuAssets || ensureSidebarSmartMenuAssets;
        const timer = typeof window.setTimeout === 'function'
            ? window.setTimeout.bind(window)
            : (typeof setTimeout === 'function' ? setTimeout : null);
        if (!timer) return;
        [0, 80, 240, 700, 1500].forEach(delay => {
            timer(() => ensure(), delay);
        });
    }

    function scheduleGlobalTaskTimerAssets() {
        const ensure = window.ensureGlobalTaskTimerAssets || ensureGlobalTaskTimerAssets;
        const timer = typeof window.setTimeout === 'function'
            ? window.setTimeout.bind(window)
            : (typeof setTimeout === 'function' ? setTimeout : null);
        if (!timer) return;
        [0, 120, 360, 900, 1800].forEach(delay => {
            timer(() => ensure(), delay);
        });
    }

    if (!window.ensureSidebarSmartMenuAssets) {
        window.ensureSidebarSmartMenuAssets = ensureSidebarSmartMenuAssets;
    }
    if (!window.ensureGlobalTaskTimerAssets) {
        window.ensureGlobalTaskTimerAssets = ensureGlobalTaskTimerAssets;
    }
    window.scheduleSidebarSmartMenuAssets = scheduleSidebarSmartMenuAssets;
    window.scheduleGlobalTaskTimerAssets = scheduleGlobalTaskTimerAssets;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scheduleSidebarSmartMenuAssets, { once: true });
    } else {
        scheduleSidebarSmartMenuAssets();
    }
})();

function getProfileModalPasswordState() {
    const current = document.getElementById('profileCurrentPwd')?.value || '';
    const next = document.getElementById('profileNewPwd')?.value || '';
    return `${current}|${next}`;
}

function isProfileModalDirty() {
    return getProfileModalPasswordState() !== profileModalPasswordBaseline;
}

function rememberProfileModalState() {
    const modal = document.getElementById('profileModal');
    profileModalPasswordBaseline = getProfileModalPasswordState();
    if (window.UnsafeDismissGuard && modal) {
        window.UnsafeDismissGuard.remember(modal, {
            selector: '#profileCurrentPwd,#profileNewPwd'
        });
    }
}

async function confirmProfileModalDiscardIfDirty() {
    const modal = document.getElementById('profileModal');
    if (!isProfileModalDirty()) return true;
    if (window.UnsafeDismissGuard && modal) {
        const confirmed = await window.UnsafeDismissGuard.confirmDiscardIfDirty(modal, {
            isDirty: isProfileModalDirty
        });
        if (confirmed) rememberProfileModalState();
        return confirmed;
    }
    let confirmed = false;
    if (typeof confirmModal === 'function') {
        confirmed = await confirmModal('Є незбережені зміни профілю. Закрити без збереження?', {
            type: 'warning',
            okText: 'Закрити без збереження',
            cancelText: 'Повернутись'
        });
    } else if (typeof showNotification === 'function') {
        showNotification('Підтвердження недоступне. Оновіть сторінку і повторіть дію.', 'error');
    }
    if (confirmed) rememberProfileModalState();
    return !!confirmed;
}

async function closeProfileModal(force = false) {
    const modal = document.getElementById('profileModal');
    if (!modal) return true;
    const closeNow = () => {
        modal.classList.add('hidden');
        profileModalPasswordBaseline = getProfileModalPasswordState();
    };
    if (window.UnsafeDismissGuard) {
        return window.UnsafeDismissGuard.attemptCloseEditableSurface(modal, closeNow, {
            force,
            isDirty: isProfileModalDirty
        });
    }
    if (!force && !(await confirmProfileModalDiscardIfDirty())) return false;
    closeNow();
    return true;
}

function openProfilePage() {
    if (window.location.pathname === '/profile') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }
    window.location.href = '/profile';
}

// ==========================================
// АВТОРИЗАЦІЯ
// ==========================================

async function checkSession() {
    return checkSessionAttempt(0);
}

async function checkSessionAttempt(sessionChangeRetry = 0) {
    recordRedirectDiagnostic('auth-bootstrap', { stage: 'check-session-start' });
    const restartAfterSessionChange = async stage => {
        recordRedirectDiagnostic('auth-bootstrap', { stage, reason: 'session-changed' });
        const sessionChangeError = authBootstrapSessionChangedError(stage);
        resetAuthenticatedRuntimeReady();
        if (typeof AppState !== 'undefined' && AppState?.currentUser) {
            if (typeof clearRuntimePermissionCatalog === 'function') {
                clearRuntimePermissionCatalog(AppState.currentUser);
            }
            AppState.currentUser = null;
        }
        const sessionStillExists = Boolean(
            localStorage.getItem('pzp_token')
            || localStorage.getItem(AUTH_ACCESS_TOKEN_KEY)
            || localStorage.getItem(AUTH_REFRESH_TOKEN_KEY)
        );
        if (sessionStillExists && sessionChangeRetry < 1) {
            recordRedirectDiagnostic('auth-bootstrap', { stage, reason: 'session-changed-retry' });
            return checkSessionAttempt(sessionChangeRetry + 1);
        }
        if (sessionStillExists) {
            showAuthenticatedPageShell({ markRuntimeReady: false });
            renderAuthSessionBootstrapError({
                retry: checkSession,
                failure: sessionChangeError.authFailure
            });
            return false;
        }
        clearAuthStorage({ reason: 'session-changed-terminal' });
        clearPrivateClientCaches();
        showLoginScreen();
        return false;
    };
    const token = localStorage.getItem('pzp_token');
    const accessToken = localStorage.getItem(AUTH_ACCESS_TOKEN_KEY);

    if (token || accessToken || hasStoredRefreshSession()) {
        let verifiedUser = null;
        let bootstrapSession = null;
        try {
            // Verify token with server
            verifiedUser = await apiVerifyToken();
            recordRedirectDiagnostic('auth-bootstrap', {
                stage: 'verify',
                refreshOutcome: verifiedUser ? 'success' : 'empty'
            });
            if (verifiedUser) {
                clearAuthSessionBootstrapError();
                bootstrapSession = captureAuthBootstrapSession(verifiedUser);
                if (!isAuthBootstrapSessionCurrent(bootstrapSession, verifiedUser)) {
                    return restartAfterSessionChange('session-bootstrap');
                }
                AppState.currentUser = verifiedUser;
                await hydrateBusinessOperatingProfile(verifiedUser, { sessionSnapshot: bootstrapSession });
                if (!isAuthBootstrapSessionCurrent(bootstrapSession, verifiedUser)) {
                    return restartAfterSessionChange('business-profile');
                }
                const permissions = await hydrateActionPermissions(verifiedUser, { sessionSnapshot: bootstrapSession });
                if (!isAuthBootstrapSessionCurrent(bootstrapSession, verifiedUser)) {
                    return restartAfterSessionChange('permissions');
                }
                if (!permissions) {
                    showAuthenticatedPageShell({ markRuntimeReady: false });
                    renderPermissionBootstrapError({
                        overlay: true,
                        retry: checkSession
                    });
                    return false;
                }
                window.WorkingRole?.hydrate?.();
                if (applyAuthReturnRouteAfterLogin(verifiedUser)) {
                    recordRedirectDiagnostic('auth-bootstrap', { stage: 'complete', refreshOutcome: 'success' });
                    return true;
                }
                showMainApp();
                recordRedirectDiagnostic('auth-bootstrap', { stage: 'complete', refreshOutcome: 'success' });
                if (typeof Sidebar !== 'undefined' && Sidebar.initUserCard) setTimeout(() => Sidebar.initUserCard(), 100);
                return true;
            }
        } catch (err) {
            console.warn('[auth] Session bootstrap failed', err);
            if (bootstrapSession && !isAuthBootstrapSessionCurrent(bootstrapSession, verifiedUser)) {
                return restartAfterSessionChange(err?.stage || 'session-bootstrap');
            }
            if (verifiedUser) {
                recordRedirectDiagnostic('auth-bootstrap', {
                    stage: err?.stage || 'bootstrap-error',
                    status: Number(err?.status || 0),
                    reason: 'bootstrap-error'
                });
                resetAuthenticatedRuntimeReady();
                showAuthenticatedPageShell({ markRuntimeReady: false });
                renderAuthSessionBootstrapError({
                    retry: checkSession,
                    failure: { status: Number(err?.status || 0), retryable: true }
                });
                return false;
            }
        }
        const authFailure = typeof getApiAuthSessionFailure === 'function'
            ? getApiAuthSessionFailure()
            : null;
        const transientAuthFailure = typeof isApiAuthSessionFailureTransient === 'function'
            && isApiAuthSessionFailureTransient(authFailure);
        if ((typeof navigator !== 'undefined' && navigator.onLine === false) || transientAuthFailure) {
            recordRedirectDiagnostic('auth-bootstrap', {
                stage: authFailure?.stage || 'verify',
                status: authFailure?.status,
                code: authFailure?.code,
                reason: authFailure?.reason || (typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'transient'),
                requestId: authFailure?.requestId,
                retryAfterSeconds: authFailure?.retryAfterSeconds
            });
            resetAuthenticatedRuntimeReady();
            if (typeof navigator !== 'undefined' && navigator.onLine === false) scheduleOfflineSessionRecovery();
            renderAuthSessionBootstrapError({ retry: checkSession, failure: authFailure });
            return false;
        }
        // Token expired or invalid
        resetAuthenticatedRuntimeReady();
    }
    // Canonical cleanup also covers partial storage left behind without tokens.
    recordRedirectDiagnostic('auth-bootstrap', { stage: 'cleanup', reason: 'missing-or-terminal-session' });
    clearAuthStorage({ reason: 'missing-or-terminal-session' });
    clearPrivateClientCaches();
    showLoginScreen();
    return false;
}

async function login(username, password) {
    const loginIntent = `login-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(AUTH_LOGIN_INTENT_KEY, loginIntent);
    const clearLoginIntent = () => {
        if (localStorage.getItem(AUTH_LOGIN_INTENT_KEY) === loginIntent) {
            localStorage.removeItem(AUTH_LOGIN_INTENT_KEY);
        }
    };
    let data;
    try {
        data = await apiLogin(username, password);
    } catch (err) {
        clearLoginIntent();
        console.error('Login error:', err);
        return { success: false, error: err.message || 'Невірний логін або пароль' };
    }

    if (localStorage.getItem(AUTH_LOGIN_INTENT_KEY) !== loginIntent
        || !rememberAuthSession(data, { loginIntent })) {
        revokeRefreshTokenValue(data.refreshToken);
        clearLoginIntent();
        return { success: false, error: 'Сесія змінилася в іншій вкладці. Повторіть вхід.' };
    }
    clearLoginIntent();
    AppState.currentUser = data.user;
    const bootstrapSession = captureAuthBootstrapSession(data.user || AppState.currentUser);
    try {
        const authenticatedUser = data.user || AppState.currentUser;
        if (!isAuthBootstrapSessionCurrent(bootstrapSession, authenticatedUser)) {
            return { success: true, pending: true };
        }
        await hydrateBusinessOperatingProfile(authenticatedUser, { sessionSnapshot: bootstrapSession });
        if (!isAuthBootstrapSessionCurrent(bootstrapSession, authenticatedUser)) {
            return { success: true, pending: true };
        }
        const permissions = await hydrateActionPermissions(authenticatedUser, { sessionSnapshot: bootstrapSession });
        if (!isAuthBootstrapSessionCurrent(bootstrapSession, authenticatedUser)) {
            return { success: true, pending: true };
        }
        if (!permissions) {
            showAuthenticatedPageShell({ markRuntimeReady: false });
            renderPermissionBootstrapError({
                overlay: true,
                retry: checkSession
            });
            return { success: true, pending: true };
        }
        window.WorkingRole?.hydrate?.();
        await registerAuthenticatedServiceWorker();
        if (!isAuthBootstrapSessionCurrent(bootstrapSession, authenticatedUser)) {
            return { success: true, pending: true };
        }
        // v33.14.0: Init sidebar user card
        if (typeof Sidebar !== 'undefined' && Sidebar.initUserCard) Sidebar.initUserCard();
        if (applyAuthReturnRouteAfterLogin(data.user || AppState.currentUser)) {
            return { success: true };
        }
        // Start every authenticated session from the account's timeline surface.
        const currentPath = window.location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
        const currentRoute = `${currentPath}${window.location.search || ''}`;
        const startPage = getAuthenticatedTimelineStartPage(data.user || AppState.currentUser);
        if (currentRoute !== startPage) {
            recordRedirectDiagnostic('auth-redirect', {
                stage: 'post-login',
                redirectReason: 'authenticated-start-page',
                targetRoute: startPage
            });
            window.location.href = startPage;
            return { success: true };
        }
        showMainApp();
        // v22.5: Check daily login reward
        checkDailyLogin();
        return { success: true };
    } catch (err) {
        console.warn('[auth] Post-login bootstrap failed', err);
        if (!isAuthBootstrapSessionCurrent(bootstrapSession, data.user || AppState.currentUser)) {
            return { success: true, pending: true };
        }
        resetAuthenticatedRuntimeReady();
        showAuthenticatedPageShell({ markRuntimeReady: false });
        renderAuthSessionBootstrapError({
            retry: checkSession,
            failure: { status: Number(err?.status || 0), retryable: true }
        });
        return { success: true, pending: true };
    }
}

function resetAuthExitVisualState(options = {}) {
    const preserveShellReady = options.preserveShellReady === true;
    document.body?.classList?.remove('page-exiting', 'shell-baseline');
    document.body?.removeAttribute?.('aria-busy');
    if (preserveShellReady) return;
    if (typeof Sidebar !== 'undefined' && Sidebar.clearShellReady) Sidebar.clearShellReady();
    else {
        document.body?.classList?.remove('shell-ready');
        document.documentElement?.classList?.remove('shell-ready');
    }
}

function logout() {
    recordRedirectDiagnostic('auth-storage-clear', { storageClearReason: 'logout' });
    // v9.1: Disconnect WebSocket on logout
    if (typeof ParkWS !== 'undefined') ParkWS.disconnect();
    revokeStoredRefreshToken();

    AppState.currentUser = null;
    resetAuthenticatedRuntimeReady();
    window.dispatchEvent(new CustomEvent('crm:auth-cleared', { detail: { reason: 'logout' } }));
    clearAuthStorage({ revokeImpersonationRefresh: false, reason: 'logout' });
    clearPrivateClientCaches();
    showLoginScreen();
}

function bindLogoutButton() {
    const btn = document.getElementById('logoutBtn');
    if (!btn || btn.dataset.logoutBound === '1') return;

    btn.dataset.logoutBound = '1';
    btn.addEventListener('click', (event) => {
        event.preventDefault();
        logout();
    });
}

function initSharedLogoutBinding() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindLogoutButton, { once: true });
        return;
    }
    bindLogoutButton();
}

initSharedLogoutBinding();

const HEADER_SETTINGS_PLACEHOLDER_TEXT = 'Налаштування цього розділу ще не доступні';
const _headerSettingsActionRegistry = new Map();

function isEmbeddedShellMode() {
    const root = document.documentElement;
    const body = document.body;
    if (root?.classList?.contains('embed-mode') || body?.classList?.contains('embed-mode')) return true;
    const params = new URLSearchParams(window.location.search || '');
    return params.get('embed') === '1' || params.get('embedded') === '1';
}

function normalizeHeaderSettingsPath(pathname = window.location.pathname) {
    return String(pathname || '/').split('#')[0].replace(/\.html$/, '').replace(/\/$/, '') || '/';
}

function showHeaderSettingsFeedback(message = HEADER_SETTINGS_PLACEHOLDER_TEXT, type = 'info') {
    if (typeof window.showNotification === 'function') {
        window.showNotification(message, type);
        return;
    }

    let notice = document.getElementById('headerSettingsFallbackNotice');
    if (!notice) {
        notice = document.createElement('div');
        notice.id = 'headerSettingsFallbackNotice';
        notice.className = 'header-settings-fallback-notice';
        notice.setAttribute('role', 'status');
        notice.setAttribute('aria-live', 'polite');
        document.body.appendChild(notice);
    }
    notice.textContent = message;
    notice.hidden = false;
    clearTimeout(showHeaderSettingsFeedback._timer);
    showHeaderSettingsFeedback._timer = setTimeout(() => {
        notice.hidden = true;
    }, 3600);
}

function registerHeaderSettingsAction(pathOrAction, maybeAction) {
    const path = typeof pathOrAction === 'string'
        ? normalizeHeaderSettingsPath(pathOrAction)
        : normalizeHeaderSettingsPath();
    const action = typeof pathOrAction === 'function' ? pathOrAction : maybeAction;
    if (typeof action !== 'function') return false;
    _headerSettingsActionRegistry.set(path, action);
    return true;
}

function userCanAccessSettingsPage(page) {
    if (typeof canAccessPage !== 'function') return false;
    return canAccessPage(page);
}

function resolveHeaderSettingsAction() {
    const currentPath = normalizeHeaderSettingsPath();
    const registered = _headerSettingsActionRegistry.get(currentPath);
    if (registered) return registered;

    if (currentPath === '/' && canAccess('manage_settings') && window.TimelineVisibility?.openSettingsCenter) {
        return () => window.TimelineVisibility.openSettingsCenter();
    }

    if (currentPath === '/dashboard' && window.DashboardPage?.openSettings) {
        return () => window.DashboardPage.openSettings();
    }

    if ((currentPath === '/chat' || currentPath === '/omni') && userCanAccessSettingsPage('/chat-settings')) {
        return () => { window.location.href = '/chat-settings'; };
    }

    return () => showHeaderSettingsFeedback();
}

function handleHeaderSettingsClick(event) {
    event.preventDefault();
    if (event.currentTarget?.id !== 'headerSettingsBtn') return;
    const action = resolveHeaderSettingsAction();
    action();
}

function createHeaderSettingsButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'headerSettingsBtn';
    button.className = 'header-settings-btn';
    button.title = 'Налаштування';
    button.setAttribute('aria-label', 'Налаштування');
    button.innerHTML = `
        <span class="header-settings-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.82l.05.05a2 2 0 1 1-2.83 2.83l-.05-.05A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6l-.08.08a2 2 0 1 1-3.84 0L10 20a1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.82.34l-.05.05a2 2 0 1 1-2.83-2.83l.05-.05A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1l-.08-.08a2 2 0 1 1 0-3.84L4 10a1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.34-1.82l-.05-.05a2 2 0 1 1 2.83-2.83l.05.05A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6l.08-.08a2 2 0 1 1 3.84 0L14 4a1.7 1.7 0 0 0 1 .6 1.7 1.7 0 0 0 1.82-.34l.05-.05a2 2 0 1 1 2.83 2.83l-.05.05A1.7 1.7 0 0 0 19.4 9c.15.36.35.7.6 1l.08.08a2 2 0 1 1 0 3.84L20 14c-.25.3-.45.64-.6 1Z"></path>
            </svg>
        </span>`;
    return button;
}

function placeHeaderSettingsButton(userPanel, button) {
    if (!userPanel || !button) return;
    const themeAction = userPanel.querySelector('#headerThemeToggle');
    if (themeAction && themeAction !== button) {
        userPanel.insertBefore(button, themeAction);
        normalizeHeaderActionOrder(userPanel);
        return;
    }
    const logoutAction = userPanel.querySelector('#logoutBtn');
    if (logoutAction && logoutAction !== button) {
        userPanel.insertBefore(button, logoutAction);
        normalizeHeaderActionOrder(userPanel);
        return;
    }
    if (button.parentElement !== userPanel) userPanel.appendChild(button);
    normalizeHeaderActionOrder(userPanel);
}

function normalizeHeaderActionOrder(userPanel) {
    if (!userPanel) return;
    const settingsAction = userPanel.querySelector('#headerSettingsBtn, #timelineConstructorBtn');
    const themeAction = userPanel.querySelector('#headerThemeToggle');
    const logoutAction = userPanel.querySelector('#logoutBtn');

    if (settingsAction && themeAction && settingsAction.nextElementSibling !== themeAction) {
        userPanel.insertBefore(settingsAction, themeAction);
    } else if (settingsAction && !themeAction && logoutAction && settingsAction.nextElementSibling !== logoutAction) {
        userPanel.insertBefore(settingsAction, logoutAction);
    }

    if (themeAction && logoutAction && themeAction.nextElementSibling !== logoutAction) {
        userPanel.insertBefore(themeAction, logoutAction);
    }
}

function initSharedHeaderActions() {
    if (isEmbeddedShellMode()) return 0;

    const panels = document.querySelectorAll('.header .user-panel');
    panels.forEach(panel => {
        panel.classList.add('header-actions');
    });

    const userPanel = document.querySelector('.header .user-panel');
    if (!userPanel) return panels.length;

    if (userPanel.querySelector('#timelineConstructorBtn')) {
        normalizeHeaderActionOrder(userPanel);
        return panels.length;
    }

    let button = document.getElementById('headerSettingsBtn');
    if (!button) button = createHeaderSettingsButton();

    if (button.dataset.headerSettingsBound !== '1') {
        button.dataset.headerSettingsBound = '1';
        button.addEventListener('click', handleHeaderSettingsClick);
    }

    placeHeaderSettingsButton(userPanel, button);
    return panels.length;
}

window.HeaderSettingsActions = {
    register: registerHeaderSettingsAction,
    open: () => resolveHeaderSettingsAction()(),
    feedback: showHeaderSettingsFeedback,
    refresh: initSharedHeaderActions
};

function clearImpersonationBackup(options = {}) {
    if (typeof sessionStorage === 'undefined') return;
    if (options.revokeRefresh === true
        && sessionStorage.getItem('realSessionBackupVersion') === '2'
        && Boolean(sessionStorage.getItem('impersonating'))) {
        const isolatedRefreshToken = sessionStorage.getItem('realRefreshToken');
        if (isolatedRefreshToken && typeof revokeRefreshTokenValue === 'function') {
            revokeRefreshTokenValue(isolatedRefreshToken);
        }
    }
    [
        'impersonating',
        'realToken',
        'realAccessToken',
        'realRefreshToken',
        'realRefreshExpiresAt',
        'realSessionGeneration',
        'realSessionBackupVersion',
        'realUser',
        'impersonationSessionGeneration',
        'impersonationTargetUser'
    ].forEach(key => sessionStorage.removeItem(key));
}

function clearAuthStorage(options = {}) {
    recordRedirectDiagnostic('auth-storage-clear', { storageClearReason: options.reason || 'auth-storage-clear' });
    const runtimeUser = typeof AppState !== 'undefined' && AppState ? AppState.currentUser : null;
    if (typeof clearRuntimePermissionCatalog === 'function') clearRuntimePermissionCatalog(runtimeUser);
    if (typeof setPermissionLifecycle === 'function') setPermissionLifecycle('idle');
    if (typeof AppState !== 'undefined' && AppState) AppState.currentUser = null;
    if (typeof resetAuthenticatedRuntimeReady === 'function') resetAuthenticatedRuntimeReady();
    localStorage.removeItem('pzp_token');
    localStorage.removeItem(AUTH_ACCESS_TOKEN_KEY);
    localStorage.removeItem(AUTH_REFRESH_TOKEN_KEY);
    localStorage.removeItem(AUTH_REFRESH_EXPIRES_KEY);
    localStorage.removeItem(AUTH_SESSION_GENERATION_KEY);
    localStorage.removeItem(CONFIG.STORAGE.CURRENT_USER);
    localStorage.removeItem(CONFIG.STORAGE.SESSION);
    localStorage.removeItem(AUTH_TRANSITION_KEY);
    if (options.preserveLoginIntent !== true) {
        localStorage.removeItem(AUTH_LOGIN_INTENT_KEY);
    }
    clearImpersonationBackup({ revokeRefresh: options.revokeImpersonationRefresh !== false });
}

function rememberAuthSession(data = {}, options = {}) {
    if (options.loginIntent
        && localStorage.getItem(AUTH_LOGIN_INTENT_KEY) !== options.loginIntent) return false;
    const transition = beginAuthTransition('remember');
    if (!transition.owned) return false;
    try {
        if (options.loginIntent
            && localStorage.getItem(AUTH_LOGIN_INTENT_KEY) !== options.loginIntent) return false;
        clearImpersonationBackup({ revokeRefresh: true });
        if (typeof rotateApiAuthSessionGeneration === 'function') {
            rotateApiAuthSessionGeneration();
        } else {
            const generation = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
            localStorage.setItem(AUTH_SESSION_GENERATION_KEY, generation);
        }
        const accessToken = data.accessToken || data.token || '';
        const legacyToken = data.token || accessToken;
        if (legacyToken) localStorage.setItem('pzp_token', legacyToken);
        if (accessToken) localStorage.setItem(AUTH_ACCESS_TOKEN_KEY, accessToken);
        if (data.refreshToken) localStorage.setItem(AUTH_REFRESH_TOKEN_KEY, data.refreshToken);
        if (data.refreshExpiresAt) localStorage.setItem(AUTH_REFRESH_EXPIRES_KEY, String(data.refreshExpiresAt));
        if (data.user) localStorage.setItem(CONFIG.STORAGE.CURRENT_USER, JSON.stringify(data.user));
    } finally {
        endAuthTransition(transition);
    }
    return true;
}

async function hydrateBusinessOperatingProfile(user = AppState.currentUser, options = {}) {
    const sessionSnapshot = options.sessionSnapshot || captureAuthBootstrapSession(user);
    if (!isAuthBootstrapSessionCurrent(sessionSnapshot, user)) {
        throw authBootstrapSessionChangedError('business-profile');
    }
    if (typeof window === 'undefined' || !window.CrmBusinessContext?.hydrateProfile) return null;
    const profile = await window.CrmBusinessContext.hydrateProfile({
        user,
        sessionSnapshot,
        updateUrl: false,
        emit: true
    });
    if (!isAuthBootstrapSessionCurrent(sessionSnapshot, user)) {
        throw authBootstrapSessionChangedError('business-profile');
    }
    if (profile && user) {
        user.businessProfile = profile;
        try {
            localStorage.setItem(CONFIG.STORAGE.CURRENT_USER, JSON.stringify(user));
        } catch {}
    }
    return profile;
}

const PERMISSION_RETRY_DELAY_MS = 250;

function readAuthBootstrapStoredUser() {
    try {
        const user = JSON.parse(localStorage.getItem(CONFIG.STORAGE.CURRENT_USER) || 'null');
        return user && typeof user === 'object' && !Array.isArray(user) ? user : null;
    } catch {
        return null;
    }
}

function authBootstrapUsersShareIdentity(left, right) {
    if (typeof apiAuthUsersShareIdentity === 'function') return apiAuthUsersShareIdentity(left, right);
    const leftId = left?.id === undefined || left?.id === null ? '' : String(left.id);
    const rightId = right?.id === undefined || right?.id === null ? '' : String(right.id);
    if (leftId && rightId) return leftId === rightId;
    const leftUsername = String(left?.username || '').trim().toLowerCase();
    const rightUsername = String(right?.username || '').trim().toLowerCase();
    return Boolean(leftUsername && rightUsername && leftUsername === rightUsername);
}

function captureAuthBootstrapSession(user = null) {
    if (typeof captureApiAuthSessionSnapshot === 'function') {
        return captureApiAuthSessionSnapshot(user);
    }
    const accessTokenKey = typeof AUTH_ACCESS_TOKEN_KEY !== 'undefined'
        ? AUTH_ACCESS_TOKEN_KEY
        : 'pzp_access_token';
    const refreshTokenKey = typeof AUTH_REFRESH_TOKEN_KEY !== 'undefined'
        ? AUTH_REFRESH_TOKEN_KEY
        : 'pzp_refresh_token';
    const generationKey = typeof AUTH_SESSION_GENERATION_KEY !== 'undefined'
        ? AUTH_SESSION_GENERATION_KEY
        : 'pzp_auth_session_generation';
    const storedUser = readAuthBootstrapStoredUser();
    const identitySource = user && typeof user === 'object' ? user : storedUser;
    const identityId = identitySource?.id ?? null;
    const identityUsername = String(identitySource?.username || '').trim();
    let generation = localStorage.getItem(generationKey) || '';
    const hasStoredSession = Boolean(
        localStorage.getItem('pzp_token')
        || localStorage.getItem(accessTokenKey)
        || localStorage.getItem(refreshTokenKey)
    );
    if (!generation && hasStoredSession) {
        generation = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(generationKey, generation);
    }
    return {
        generation,
        accessToken: localStorage.getItem('pzp_token') || localStorage.getItem(accessTokenKey) || '',
        refreshToken: localStorage.getItem(refreshTokenKey) || '',
        identity: identitySource && (identityId !== null || identityUsername)
            ? { id: identityId, username: identityUsername }
            : null,
        hadStoredUser: Boolean(storedUser)
    };
}

function isAuthBootstrapSessionCurrent(snapshot, user = null) {
    if (typeof isApiAuthSessionSnapshotCurrent === 'function') {
        return isApiAuthSessionSnapshotCurrent(snapshot, user);
    }
    if (!snapshot || typeof snapshot !== 'object') return false;
    const generationKey = typeof AUTH_SESSION_GENERATION_KEY !== 'undefined'
        ? AUTH_SESSION_GENERATION_KEY
        : 'pzp_auth_session_generation';
    const currentGeneration = localStorage.getItem(generationKey) || '';
    if (currentGeneration !== String(snapshot.generation || '')) return false;

    const expectedUser = user && typeof user === 'object' ? user : snapshot.identity;
    if (snapshot.identity && expectedUser && !authBootstrapUsersShareIdentity(snapshot.identity, expectedUser)) return false;
    const storedUser = readAuthBootstrapStoredUser();
    if (snapshot.hadStoredUser && !storedUser) return false;
    if (storedUser && expectedUser && !authBootstrapUsersShareIdentity(storedUser, expectedUser)) return false;
    const runtimeUser = typeof AppState !== 'undefined' && AppState?.currentUser
        ? AppState.currentUser
        : null;
    return !(runtimeUser && expectedUser && !authBootstrapUsersShareIdentity(runtimeUser, expectedUser));
}

function authBootstrapSessionChangedError(stage = 'bootstrap') {
    const existingFailure = typeof getApiAuthSessionFailure === 'function'
        ? getApiAuthSessionFailure()
        : null;
    const terminal = existingFailure?.kind === 'terminal';
    if (!terminal && typeof markApiAuthSessionChanged === 'function') markApiAuthSessionChanged(stage);
    else if (!terminal && typeof setApiAuthSessionFailure === 'function') {
        setApiAuthSessionFailure('transient', { stage, reason: 'session-changed' });
    }
    const error = new Error('Authentication session changed during page bootstrap');
    error.code = terminal ? 'auth_session_terminal' : 'auth_session_transient';
    error.authFailure = terminal
        ? existingFailure
        : { kind: 'transient', transient: true, stage, reason: 'session-changed' };
    return error;
}

let permissionLifecycle = { status: 'idle', attempt: 0, failure: null, updatedAt: 0 };

function getPermissionLifecycle() {
    return { ...permissionLifecycle };
}

function setPermissionLifecycle(status, details = {}) {
    permissionLifecycle = {
        status,
        attempt: Number(details.attempt || 0),
        failure: details.failure || null,
        updatedAt: Date.now()
    };
    if (typeof AppState !== 'undefined' && AppState) AppState.permissionLifecycle = getPermissionLifecycle();
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('permissions:lifecycle', { detail: getPermissionLifecycle() }));
    }
    return permissionLifecycle;
}

function clearRuntimePermissionCatalog(user) {
    if (typeof AppState !== 'undefined' && AppState) AppState.authPermissions = null;
    if (user && typeof user === 'object') delete user.permissions;
    PAGE_ACCESS = Object.create(null);
    ACTION_PERMISSIONS = Object.create(null);
    PAGE_CAPABILITY_ALIASES = Object.create(null);
    ACTION_CAPABILITY_ALIASES = Object.create(null);
    ACTION_LEGACY_KEYS = Object.create(null);
    ACTION_LEGACY_DENY_KEYS = Object.create(null);
    EXPLICIT_ALLOW_DISABLED_PAGES = new Set();
    EXPLICIT_ALLOW_DISABLED_ACTIONS = new Set();
    NON_DELEGABLE_ACTIONS = new Set();
}

function applyActionPermissions(user, permissions) {
    AppState.authPermissions = permissions;
    user.permissions = permissions;
    const catalog = permissions.capabilityCatalog || {};
    PAGE_ACCESS = catalog.pageRoles || Object.create(null);
    ACTION_PERMISSIONS = catalog.actionRoles || Object.create(null);
    PAGE_CAPABILITY_ALIASES = catalog.pageAliases || Object.create(null);
    ACTION_CAPABILITY_ALIASES = catalog.actionAliases || Object.create(null);
    ACTION_LEGACY_KEYS = catalog.actionLegacyKeys || Object.create(null);
    ACTION_LEGACY_DENY_KEYS = catalog.actionLegacyDenyKeys || Object.create(null);
    EXPLICIT_ALLOW_DISABLED_PAGES = new Set(catalog.explicitAllowDisabledPages || []);
    EXPLICIT_ALLOW_DISABLED_ACTIONS = new Set(catalog.explicitAllowDisabledActions || []);
    NON_DELEGABLE_ACTIONS = new Set(catalog.nonDelegableActions || []);
    if (Array.isArray(permissions.pageAllowlist)) {
        user.pageAllowlist = permissions.pageAllowlist;
        user.page_allowlist = permissions.pageAllowlist;
    }
    if (Array.isArray(permissions.pageDenylist)) {
        user.pageDenylist = permissions.pageDenylist;
        user.page_denylist = permissions.pageDenylist;
    }
    if (permissions.actionAllowlist) {
        user.actionAllowlist = permissions.actionAllowlist;
        user.action_allowlist = permissions.actionAllowlist;
    }
    if (permissions.actionDenylist) {
        user.actionDenylist = permissions.actionDenylist;
        user.action_denylist = permissions.actionDenylist;
    }
}

function permissionLoadError(status, cause) {
    const error = cause instanceof Error ? cause : new Error(`Permissions request failed${status ? ` (${status})` : ''}`);
    error.status = Number(status || error.status || 0) || 0;
    error.retryable = error.status >= 500 || error.status === 0;
    return error;
}

function permissionFailureMessage() {
    const failure = permissionLifecycle.failure || {};
    if (failure.status === 401) return 'Сесію не вдалося підтвердити під час завантаження прав. Дані сторінки не показані.';
    if (failure.status === 403) return 'Сервер не надав набір прав для цієї сесії. Дані сторінки не показані.';
    return 'Не вдалося тимчасово завантажити права доступу. Дані сторінки не показані, щоб не приховати дозволені дії помилково.';
}

function authSessionFailureMessage(failure = {}) {
    if (failure?.status === 429) {
        return 'Сервер тимчасово обмежив перевірку сесії. Зачекайте трохи й повторіть спробу.';
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return 'Немає з’єднання з сервером. Сесію збережено — повторіть перевірку після відновлення мережі.';
    }
    if (failure?.reason === 'refresh-watchdog-timeout') {
        return 'Сервер довго не відповідає на оновлення сесії. Дані входу збережено — повторіть спробу трохи пізніше або оновіть сторінку вручну.';
    }
    return 'Не вдалося тимчасово підтвердити сесію. Дані входу збережено — повторіть спробу.';
}


const AUTH_SAFE_RETURN_ROUTE_MODULES = new Set([
    '',
    'dashboard',
    'sales-funnel',
    'customers',
    'certificates',
    'tasks',
    'profile',
    'staff',
    'hr',
    'reports',
    'analytics',
    'finance',
    'settings',
    'chat',
    'warehouse',
    'designs',
    'programs',
    'bookings',
    'afisha',
    'training',
    'invite',
    'sound',
    'omni',
    'timeline',
    'maysternya-doli',
    'kleshnya',
    'copilot',
    'guardian-ops',
    'hermes-studio',
    'status'
]);
const AUTH_SAFE_RETURN_STATIC_CHILDREN = new Map([
    ['certificates', new Set(['new', 'batch'])],
    ['embed', new Set(['designs', 'programs', 'graduation'])],
    ['omni', new Set(['accounts'])]
]);

function normalizeAuthReturnRouteSegment(segment) {
    let decoded = String(segment || '');
    try { decoded = decodeURIComponent(decoded); } catch {}
    return decoded
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_.:-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48);
}

function normalizeSafeAuthReturnRoute(value) {
    let pathname = '';
    try {
        const locationOrigin = window.location?.origin || 'http://localhost';
        const parsed = new URL(String(value || window.location?.href || window.location?.pathname || '/'), locationOrigin);
        if (parsed.origin !== locationOrigin) return '';
        pathname = parsed.pathname || '/';
    } catch {
        pathname = String(value || window.location?.pathname || '/').split(/[?#]/)[0] || '/';
    }
    const segments = pathname
        .replace(/\.html$/i, '')
        .replace(/\/$/, '')
        .split('/')
        .filter(Boolean)
        .map(normalizeAuthReturnRouteSegment)
        .filter(Boolean);
    if (!segments.length) return '/';
    const moduleName = segments[0];
    if (!AUTH_SAFE_RETURN_ROUTE_MODULES.has(moduleName)) return '';
    const output = [moduleName];
    const staticChildren = AUTH_SAFE_RETURN_STATIC_CHILDREN.get(moduleName) || new Set();
    for (let index = 1; index < segments.length; index += 1) {
        const segment = segments[index];
        if (!staticChildren.has(segment)) break;
        output.push(segment);
    }
    return '/' + output.join('/');
}

function shouldRememberAuthReturnRouteForAuthFailure() {
    const failure = typeof getApiAuthSessionFailure === 'function'
        ? getApiAuthSessionFailure()
        : null;
    return failure?.kind === 'terminal' || failure?.terminal === true;
}

function rememberAuthReturnRoute(reason = 'terminal-auth') {
    const route = normalizeSafeAuthReturnRoute();
    if (!route || route === '/' || route === '/index') return false;
    try {
        localStorage.setItem(AUTH_RETURN_ROUTE_KEY, JSON.stringify({ route, at: Date.now(), reason: String(reason || 'terminal-auth') }));
        recordRedirectDiagnostic('auth-redirect', {
            stage: 'show-login-screen',
            redirectReason: 'login-page',
            targetRoute: route
        });
        return true;
    } catch {
        return false;
    }
}

function consumeAuthReturnRoute(user = AppState.currentUser) {
    let entry = null;
    const clearIntent = () => {
        try { localStorage.removeItem(AUTH_RETURN_ROUTE_KEY); } catch {}
    };
    try {
        const raw = localStorage.getItem(AUTH_RETURN_ROUTE_KEY) || '';
        if (raw) entry = JSON.parse(raw);
    } catch {
        clearIntent();
        return '';
    }
    const route = normalizeSafeAuthReturnRoute(entry?.route || '');
    const at = Number(entry?.at || 0);
    if (!route || route === '/' || route === '/index') {
        clearIntent();
        return '';
    }
    if (!Number.isFinite(at) || Date.now() - at > AUTH_RETURN_ROUTE_MAX_AGE_MS || at > Date.now() + 60000) {
        clearIntent();
        return '';
    }
    try {
        if (typeof canAccessPage === 'function') {
            const lifecycle = typeof getPermissionLifecycle === 'function'
                ? getPermissionLifecycle()
                : { status: 'ready' };
            if (lifecycle?.status !== 'ready') return '';
            if (!canAccessPage(route)) {
                clearIntent();
                recordRedirectDiagnostic('auth-redirect', {
                    stage: 'post-login',
                    redirectReason: 'page-access-denied',
                    targetRoute: getAuthenticatedTimelineStartPage(user || AppState.currentUser) || '/dashboard'
                });
                return '';
            }
        }
    } catch {
        return '';
    }
    clearIntent();
    return route;
}

function hasAuthRecoveryUnsavedChanges() {
    try {
        if (typeof window !== 'undefined' && window.BookingForm) {
            if (typeof window.BookingForm.isDirty === 'function' && window.BookingForm.isDirty()) return true;
            if (window.BookingForm._dirty === true) return true;
        }
    } catch {}
    try {
        if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return false;
        const editableSurfaces = Array.from(document.querySelectorAll('[data-editable-surface="true"]'));
        if (editableSurfaces.some(surface => {
            try {
                if (surface?.dataset?.dirty === 'true') return true;
                if (typeof window !== 'undefined'
                    && window.UnsafeDismissGuard
                    && typeof window.UnsafeDismissGuard.isDirtySurface === 'function') {
                    return window.UnsafeDismissGuard.isDirtySurface(surface);
                }
            } catch {}
            return false;
        })) return true;
        return Boolean(document.querySelectorAll('[data-dirty="true"], [data-unsaved-changes="true"], .is-dirty').length);
    } catch {
        return false;
    }
}

async function confirmAuthRecoveryReload() {
    if (!hasAuthRecoveryUnsavedChanges()) return true;
    const message = 'Є незбережені зміни. Оновлення сторінки може їх втратити. Оновити сторінку вручну?';
    const options = {
        type: 'warning',
        okText: 'Оновити сторінку',
        cancelText: 'Повернутись'
    };
    if (typeof confirmModal === 'function') return !!(await confirmModal(message, options));
    if (typeof customConfirm === 'function') return !!(await customConfirm(message, 'Незбережені зміни'));
    if (typeof showNotification === 'function') {
        showNotification('Оновлення заблоковано: потрібно підтвердити втрату незбережених змін.', 'warning');
    }
    return false;
}

async function reloadAuthSessionRecoveryPage() {
    const allowed = await confirmAuthRecoveryReload();
    if (!allowed) return false;
    const route = normalizeSafeAuthReturnRoute() || '/';
    rememberAuthReturnRoute('refresh-watchdog-reload');
    recordRedirectDiagnostic('auth-redirect', {
        stage: 'refresh-watchdog-reload',
        redirectReason: 'manual-reload',
        targetRoute: route
    });
    if (typeof window !== 'undefined' && typeof window.location?.reload === 'function') {
        window.location.reload();
        return true;
    }
    if (typeof window !== 'undefined' && window.location) {
        window.location.href = route;
        return true;
    }
    return false;
}

function applyAuthReturnRouteAfterLogin(user = AppState.currentUser) {
    const route = consumeAuthReturnRoute(user);
    if (!route) return false;
    const currentPath = window.location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
    if (currentPath === route) {
        recordRedirectDiagnostic('auth-redirect', {
            stage: 'post-login',
            redirectReason: 'return-route-current',
            targetRoute: route
        });
        return true;
    }
    recordRedirectDiagnostic('auth-redirect', {
        stage: 'post-login',
        redirectReason: 'authenticated-start-page',
        targetRoute: route
    });
    window.location.href = route;
    return true;
}

function authenticatedServiceWorkerUpdateControllerKey() {
    try {
        const controller = navigator.serviceWorker?.controller;
        return controller?.scriptURL || '';
    } catch {
        return '';
    }
}

function ensureAuthenticatedServiceWorkerUpdateSurface() {
    let target = document.getElementById('authServiceWorkerUpdatePrompt');
    if (!target && document.body && typeof document.createElement === 'function') {
        target = document.createElement('div');
        target.id = 'authServiceWorkerUpdatePrompt';
        target.className = 'auth-session-update-prompt';
        target.setAttribute('role', 'status');
        target.setAttribute('aria-live', 'polite');
        target.style.position = 'fixed';
        target.style.right = '16px';
        target.style.bottom = '16px';
        target.style.zIndex = '11000';
        target.style.maxWidth = '380px';
        document.body.appendChild(target);
    }
    return target;
}

async function confirmAuthenticatedServiceWorkerUpdateReload() {
    if (!hasAuthRecoveryUnsavedChanges()) return true;
    const message = 'Є незбережені зміни. Оновлення CRM перезавантажить сторінку й може їх втратити. Оновити зараз?';
    const options = {
        type: 'warning',
        okText: 'Оновити',
        cancelText: 'Пізніше'
    };
    if (typeof confirmModal === 'function') return !!(await confirmModal(message, options));
    if (typeof customConfirm === 'function') return !!(await customConfirm(message, 'Незбережені зміни'));
    if (typeof showNotification === 'function') {
        showNotification('Оновлення відкладено: потрібно підтвердити втрату незбережених змін.', 'warning');
    }
    return false;
}

async function applyAuthenticatedServiceWorkerUpdateReload() {
    const allowed = await confirmAuthenticatedServiceWorkerUpdateReload();
    if (!allowed) return false;
    const route = normalizeSafeAuthReturnRoute();
    if (route && route !== '/' && route !== '/index') {
        rememberAuthReturnRoute('service-worker-update');
    }
    recordRedirectDiagnostic('navigation-transition', {
        stage: 'service-worker-update',
        redirectReason: 'manual-reload',
        targetRoute: route || '/'
    });
    if (typeof window !== 'undefined' && typeof window.location?.reload === 'function') {
        window.location.reload();
        return true;
    }
    if (typeof window !== 'undefined' && window.location) {
        window.location.href = route || '/';
        return true;
    }
    return false;
}

function dismissAuthenticatedServiceWorkerUpdatePrompt() {
    const key = authenticatedServiceWorkerUpdateControllerKey() || `dismissed-${Date.now().toString(36)}`;
    authServiceWorkerUpdateDismissedForController = key;
    authServiceWorkerUpdatePromptVisible = false;
    document.getElementById('authServiceWorkerUpdatePrompt')?.remove();
}

function renderAuthenticatedServiceWorkerUpdatePrompt(reason = 'controllerchange') {
    if (!hasAuthenticatedRuntimeSession()) return false;
    const controllerKey = authenticatedServiceWorkerUpdateControllerKey();
    if (authServiceWorkerUpdatePromptVisible) return true;
    if (controllerKey && controllerKey === authServiceWorkerUpdateDismissedForController) return false;
    const target = ensureAuthenticatedServiceWorkerUpdateSurface();
    if (!target) return false;
    authServiceWorkerUpdatePromptVisible = true;
    recordRedirectDiagnostic('shell-lifecycle', {
        stage: 'service-worker-update-available',
        reason: 'service-worker-update',
        lifecycle: reason
    });
    target.innerHTML = `<div class="page-fatal-error auth-session-bootstrap-error" data-auth-sw-update-prompt><h3>Доступне оновлення CRM</h3><p>Щоб отримати нову версію інтерфейсу, оновіть сторінку вручну. Поточну роботу не буде перезавантажено без вашої дії.</p><div class="auth-session-bootstrap-actions"><button type="button" class="btn btn-primary" data-auth-sw-update-reload>Оновити</button><button type="button" class="btn btn-secondary" data-auth-sw-update-later>Пізніше</button></div><p class="muted">Перед оновленням CRM перевірить незбережені зміни й збереже безпечний маршрут.</p></div>`;
    const reloadButton = target.querySelector?.('[data-auth-sw-update-reload]');
    const laterButton = target.querySelector?.('[data-auth-sw-update-later]');
    reloadButton?.addEventListener('click', async () => {
        if (reloadButton.disabled) return;
        reloadButton.disabled = true;
        reloadButton.setAttribute('aria-busy', 'true');
        try {
            const reloading = await applyAuthenticatedServiceWorkerUpdateReload();
            if (!reloading) {
                reloadButton.disabled = false;
                reloadButton.removeAttribute('aria-busy');
            }
        } catch {
            reloadButton.disabled = false;
            reloadButton.removeAttribute('aria-busy');
            if (typeof showNotification === 'function') {
                showNotification('Не вдалося оновити CRM. Сторінка та сесія залишилися без змін.', 'error');
            }
        }
    });
    laterButton?.addEventListener('click', dismissAuthenticatedServiceWorkerUpdatePrompt);
    return true;
}

function bindAuthenticatedServiceWorkerUpdatePrompt(registration) {
    try {
        if (!registration || registration.__eventGenixUpdatePromptBound) return;
        registration.__eventGenixUpdatePromptBound = true;
        const hadController = Boolean(navigator.serviceWorker?.controller);
        registration.addEventListener?.('updatefound', () => {
            const worker = registration.installing || registration.waiting;
            if (!worker) return;
            worker.addEventListener?.('statechange', () => {
                if (hadController && (worker.state === 'installed' || worker.state === 'activated')) {
                    renderAuthenticatedServiceWorkerUpdatePrompt('updatefound');
                }
            });
        });
        navigator.serviceWorker?.addEventListener?.('controllerchange', () => {
            if (hadController) renderAuthenticatedServiceWorkerUpdatePrompt('controllerchange');
        });
        if (hadController && registration.waiting) {
            renderAuthenticatedServiceWorkerUpdatePrompt('waiting');
        }
    } catch {}
}

function clearAuthSessionBootstrapError() {
    document.getElementById('authSessionRecovery')?.remove();
}

function ensureAuthSessionRecoverySurface() {
    let target = document.getElementById('authSessionRecovery');
    if (!target && document.body && typeof document.createElement === 'function') {
        target = document.createElement('div');
        target.id = 'authSessionRecovery';
        target.className = 'auth-session-recovery-overlay';
        target.setAttribute('role', 'alert');
        target.setAttribute('aria-live', 'assertive');
        document.body.appendChild(target);
    }
    return target;
}

function renderAuthSessionBootstrapError(options = {}) {
    let target = options.target
        || (options.containerId ? document.getElementById(options.containerId) : null)
        || ensureAuthSessionRecoverySurface();
    if (!target) return;
    const retry = typeof options.retry === 'function' ? options.retry : null;
    const diagnosticsAvailable = Boolean(window.RedirectDiagnostics?.copy);
    const canManualReload = options.failure?.reason === 'refresh-watchdog-timeout';
    const reloadNote = canManualReload
        ? '<p class="muted" data-auth-session-reload-note>Оновлення сторінки є ручним виходом із завислого запиту. Воно не гарантує тихе відновлення сесії за чинного серверного контракту; якщо є незбережені зміни, CRM спитає підтвердження.</p>'
        : '';
    target.innerHTML = `<div class="page-fatal-error auth-session-bootstrap-error"><h3>Сесію тимчасово не підтверджено</h3><p data-auth-session-state="transient">${_escHtml(authSessionFailureMessage(options.failure))}</p>${reloadNote}<div class="auth-session-bootstrap-actions">${retry ? '<button type="button" class="btn btn-primary" data-auth-session-retry>Повторити</button>' : ''}${canManualReload ? '<button type="button" class="btn btn-secondary" data-auth-session-reload>Оновити сторінку</button>' : ''}${diagnosticsAvailable ? '<button type="button" class="btn btn-secondary" data-auth-session-copy-diagnostics>Скопіювати діагностику</button>' : ''}</div><p class="muted" data-auth-session-diagnostics-status hidden></p></div>`;
    const button = target.querySelector?.('[data-auth-session-retry]');
    if (button && retry) {
        button.addEventListener('click', async () => {
            if (button.disabled) return;
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
            try { await retry(); }
            finally {
                button.disabled = false;
                button.removeAttribute('aria-busy');
            }
        });
    }
    const reloadButton = target.querySelector?.('[data-auth-session-reload]');
    if (reloadButton) {
        reloadButton.addEventListener('click', async () => {
            if (reloadButton.disabled) return;
            reloadButton.disabled = true;
            reloadButton.setAttribute('aria-busy', 'true');
            try {
                const reloading = await reloadAuthSessionRecoveryPage();
                if (!reloading) {
                    reloadButton.disabled = false;
                    reloadButton.removeAttribute('aria-busy');
                }
            } catch {
                reloadButton.disabled = false;
                reloadButton.removeAttribute('aria-busy');
                if (typeof showNotification === 'function') {
                    showNotification('Не вдалося оновити сторінку. Сесія не очищена — спробуйте ще раз.', 'error');
                }
            }
        });
    }
    const diagnosticsButton = target.querySelector?.('[data-auth-session-copy-diagnostics]');
    const diagnosticsStatus = target.querySelector?.('[data-auth-session-diagnostics-status]');
    if (diagnosticsButton && diagnosticsAvailable) {
        diagnosticsButton.addEventListener('click', async () => {
            if (diagnosticsButton.disabled) return;
            diagnosticsButton.disabled = true;
            try {
                const result = await window.RedirectDiagnostics.copy();
                if (diagnosticsStatus) {
                    diagnosticsStatus.hidden = false;
                    diagnosticsStatus.textContent = result?.copied
                        ? 'Діагностику скопійовано. Передайте її підтримці.'
                        : 'Clipboard недоступний. Виконайте в консолі: JSON.stringify(window.RedirectDiagnostics.export(), null, 2)';
                }
            } catch {
                if (diagnosticsStatus) {
                    diagnosticsStatus.hidden = false;
                    diagnosticsStatus.textContent = 'Не вдалося скопіювати діагностику. Навігація та авторизація не змінені.';
                }
            } finally {
                diagnosticsButton.disabled = false;
            }
        });
    }
}

function handleTransientAuthSessionBootstrap(options = {}) {
    const failure = options.failure || (typeof getApiAuthSessionFailure === 'function'
        ? getApiAuthSessionFailure()
        : null);
    const isTransient = (typeof navigator !== 'undefined' && navigator.onLine === false)
        || (typeof isApiAuthSessionFailureTransient === 'function'
            && isApiAuthSessionFailureTransient(failure));
    if (!isTransient) return false;

    resetAuthenticatedRuntimeReady();
    if (options.showShell !== false) showAuthenticatedPageShell({ markRuntimeReady: false });
    renderAuthSessionBootstrapError({
        containerId: options.containerId,
        target: options.target,
        failure,
        retry: typeof options.retry === 'function'
            ? options.retry
            : () => window.location.reload()
    });
    return true;
}

function renderPermissionBootstrapError(options = {}) {
    const target = options.target
        || (options.overlay === true ? ensureAuthSessionRecoverySurface() : null)
        || document.getElementById(options.containerId || 'main-content');
    if (!target) return;
    const retry = typeof options.retry === 'function' ? options.retry : null;
    target.innerHTML = `<div class="page-fatal-error permission-bootstrap-error" role="alert" data-permission-state="error"><h3>Права доступу тимчасово недоступні</h3><p>${_escHtml(permissionFailureMessage())}</p>${retry ? '<button type="button" class="btn btn-primary" data-permission-retry>Повторити</button>' : ''}</div>`;
    const button = target.querySelector('[data-permission-retry]');
    if (button && retry) {
        button.addEventListener('click', async () => {
            if (button.disabled) return;
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
            try { await retry(); }
            finally {
                button.disabled = false;
                button.removeAttribute('aria-busy');
            }
        });
    }
}
async function hydrateActionPermissions(user = AppState.currentUser, options = {}) {
    if (!user) {
        clearRuntimePermissionCatalog(user);
        setPermissionLifecycle('error', { failure: { status: 0, retryable: false, message: 'Authenticated user is unavailable' } });
        return null;
    }
    const sessionSnapshot = options.sessionSnapshot || captureAuthBootstrapSession(user);
    if (!isAuthBootstrapSessionCurrent(sessionSnapshot, user)) {
        authBootstrapSessionChangedError('permissions');
        return null;
    }
    const maxAttempts = options.retry === false ? 1 : 2;
    clearRuntimePermissionCatalog(user);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (!isAuthBootstrapSessionCurrent(sessionSnapshot, user)) {
            authBootstrapSessionChangedError('permissions');
            return null;
        }
        setPermissionLifecycle('loading', { attempt });
        try {
            const headers = typeof getAuthHeaders === 'function'
                ? getAuthHeaders(false)
                : { Authorization: `Bearer ${localStorage.getItem(AUTH_ACCESS_TOKEN_KEY) || localStorage.getItem('pzp_token') || ''}` };
            const response = typeof apiFetchWithAuthRetry === 'function'
                ? await apiFetchWithAuthRetry('/api/auth/permissions', {
                    headers,
                    authSessionSnapshot: sessionSnapshot,
                    authUser: user
                })
                : await fetch('/api/auth/permissions', { headers });
            if (!isAuthBootstrapSessionCurrent(sessionSnapshot, user)) {
                authBootstrapSessionChangedError('permissions');
                return null;
            }
            if (!response) throw permissionLoadError(0);
            if (!response.ok) throw permissionLoadError(response.status);
            const permissions = await response.json();
            if (!isAuthBootstrapSessionCurrent(sessionSnapshot, user)) {
                authBootstrapSessionChangedError('permissions');
                return null;
            }
            applyActionPermissions(user, permissions);
            setPermissionLifecycle('ready', { attempt });
            try {
                localStorage.setItem(CONFIG.STORAGE.CURRENT_USER, JSON.stringify(user));
            } catch {}
            return permissions;
        } catch (cause) {
            if (!isAuthBootstrapSessionCurrent(sessionSnapshot, user)) {
                authBootstrapSessionChangedError('permissions');
                return null;
            }
            const error = permissionLoadError(cause?.status, cause);
            const failure = { status: error.status, retryable: error.retryable, message: error.message };
            if (error.retryable && attempt < maxAttempts) {
                if (Number(options.retryDelayMs ?? PERMISSION_RETRY_DELAY_MS) > 0) {
                    await new Promise(resolve => setTimeout(resolve, Number(options.retryDelayMs ?? PERMISSION_RETRY_DELAY_MS)));
                }
                continue;
            }
            clearRuntimePermissionCatalog(user);
            setPermissionLifecycle('error', { attempt, failure });
            return null;
        }
    }
    return null;
}
function hasStoredRefreshSession() {
    return Boolean(localStorage.getItem(AUTH_REFRESH_TOKEN_KEY));
}

function revokeRefreshTokenValue(refreshToken) {
    if (!refreshToken) return;
    try {
        fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
            keepalive: true
        }).catch(() => {});
    } catch {}
}

function revokeStoredRefreshToken() {
    const refreshTokens = new Set();
    const activeRefreshToken = localStorage.getItem(AUTH_REFRESH_TOKEN_KEY);
    if (activeRefreshToken) refreshTokens.add(activeRefreshToken);

    try {
        const hasIsolatedCreatorSession = sessionStorage.getItem('realSessionBackupVersion') === '2'
            && Boolean(sessionStorage.getItem('impersonating'));
        const isolatedCreatorRefreshToken = hasIsolatedCreatorSession
            ? sessionStorage.getItem('realRefreshToken')
            : null;
        if (isolatedCreatorRefreshToken) refreshTokens.add(isolatedCreatorRefreshToken);
    } catch {}

    refreshTokens.forEach(revokeRefreshTokenValue);
}

function handleCrossTabAuthStorageChange(event) {
    const authKeys = new Set([
        'pzp_token',
        AUTH_ACCESS_TOKEN_KEY,
        AUTH_REFRESH_TOKEN_KEY,
        AUTH_SESSION_GENERATION_KEY,
        CONFIG.STORAGE.CURRENT_USER,
        CONFIG.STORAGE.SESSION
    ]);
    if (crossTabSessionSyncInProgress || !authKeys.has(event?.key)) return;

    if (event?.newValue !== null) {
        const generationChanged = event.key === AUTH_SESSION_GENERATION_KEY
            && event.oldValue !== event.newValue;
        let identityChanged = false;
        if (event.key === CONFIG.STORAGE.CURRENT_USER && event.oldValue !== event.newValue) {
            try {
                const incomingUser = JSON.parse(event.newValue);
                const runtimeUser = typeof AppState !== 'undefined' && AppState
                    ? AppState.currentUser
                    : null;
                identityChanged = !runtimeUser
                    || typeof authBootstrapUsersShareIdentity !== 'function'
                    || !authBootstrapUsersShareIdentity(runtimeUser, incomingUser);
            } catch {
                identityChanged = true;
            }
        }
        if (!generationChanged && !identityChanged) return;

        crossTabSessionSyncInProgress = true;
        resetAuthenticatedRuntimeReady();
        if (typeof AppState !== 'undefined' && AppState?.currentUser) {
            if (typeof clearRuntimePermissionCatalog === 'function') {
                clearRuntimePermissionCatalog(AppState.currentUser);
            }
            AppState.currentUser = null;
        }
        if (typeof clearAuthenticatedPageShell === 'function') clearAuthenticatedPageShell();
        document.getElementById('mainApp')?.classList.add('hidden');
        document.getElementById('sidebarToggle')?.classList.add('hidden');
        window.location.reload();
        return;
    }

    if (crossTabLogoutInProgress) return;

    const sharedSessionStillExists = Boolean(
        localStorage.getItem('pzp_token')
        || localStorage.getItem(AUTH_ACCESS_TOKEN_KEY)
        || localStorage.getItem(AUTH_REFRESH_TOKEN_KEY)
        || localStorage.getItem(AUTH_SESSION_GENERATION_KEY)
        || localStorage.getItem(CONFIG.STORAGE.CURRENT_USER)
    );
    if (sharedSessionStillExists) return;

    const loginIntentInProgress = Boolean(localStorage.getItem(AUTH_LOGIN_INTENT_KEY));
    if (loginIntentInProgress) {
        crossTabLogoutInProgress = true;
        try {
            clearAuthStorage({ preserveLoginIntent: true });
            clearPrivateClientCaches();
            showLoginScreen();
        } finally {
            setTimeout(() => { crossTabLogoutInProgress = false; }, 0);
        }
        return;
    }

    crossTabLogoutInProgress = true;
    try {
        logout();
    } finally {
        setTimeout(() => { crossTabLogoutInProgress = false; }, 0);
    }
}

if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('storage', handleCrossTabAuthStorageChange);
}

function clearPrivateClientCaches() {
    try {
        if (typeof OfflineQueue !== 'undefined' && OfflineQueue.clearQueue) {
            OfflineQueue.clearQueue().catch(() => {});
        }
    } catch (err) {}

    try {
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_PRIVATE_CACHES' });
        }
    } catch (err) {}

    try {
        if ('caches' in window) {
            caches.keys()
                .then((keys) => Promise.all(
                    keys
                        .filter((key) => key.startsWith('event-genix-api-') || key.startsWith('event-genix-v'))
                        .map((key) => caches.delete(key))
                ))
                .catch(() => {});
        }
    } catch (err) {}
}

function showLoginScreen() {
    clearAuthSessionBootstrapError();
    // v31.7.1: Redirect to canonical login page from sub-pages
    const path = window.location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
    if (path !== '/' && path !== '/index') {
        if (typeof shouldRememberAuthReturnRouteForAuthFailure === 'function'
            && shouldRememberAuthReturnRouteForAuthFailure()
            && typeof rememberAuthReturnRoute === 'function') {
            rememberAuthReturnRoute('show-login-screen');
        }
        recordRedirectDiagnostic('auth-redirect', {
            stage: 'show-login-screen',
            redirectReason: 'login-page',
            targetRoute: '/'
        });
        resetAuthExitVisualState({ preserveShellReady: true });
        document.body.classList.remove('authenticated-shell', 'auth-screen');
        if (typeof window.location.replace === 'function') window.location.replace('/');
        else window.location.href = '/';
        return;
    }
    clearAuthenticatedPageShell();
    document.body.classList.add('auth-screen');
    document.body.classList.remove('authenticated-shell');
    document.getElementById('loginScreen')?.classList.remove('hidden');
    document.getElementById('mainApp')?.classList.add('hidden');
    // Hide floating buttons that are outside mainApp
    const sidebarToggle = document.getElementById('sidebarToggle');
    if (sidebarToggle) sidebarToggle.classList.add('hidden');
}

function clearAuthenticatedPageShell() {
    document.body.classList.remove('auth-screen', 'authenticated-shell');
    resetAuthExitVisualState();
}

let _crmAssistantRailLoadPromise = null;
const CRM_ASSISTANT_RAIL_ENABLED_KEY = 'eg_crm_assistant_rail_enabled';

function isCrmAssistantRailEnabled() {
    if (window.CRM_ASSISTANT_RAIL_DISABLED === true) return false;
    if (window.CRM_ASSISTANT_RAIL_ENABLED === true) return true;
    if (document.body?.dataset?.crmAssistantRail === 'on') return true;
    try {
        return localStorage.getItem(CRM_ASSISTANT_RAIL_ENABLED_KEY) === 'on';
    } catch {
        return false;
    }
}

function removeCrmAssistantRailSurface() {
    document.getElementById('dashboardAssistantRail')?.remove();
    document.getElementById('crmAssistantRail')?.remove();
    document.getElementById('crmAssistantRailHost')?.remove();
    document.getElementById('crmAssistantPanelOverlay')?.remove();
    document.querySelectorAll('.crm-assistant-click-guide-overlay, .crm-assistant-magic-burst').forEach(el => el.remove());
    document.querySelectorAll('.crm-assistant-click-guide-targeted').forEach(el => {
        el.classList.remove('crm-assistant-click-guide-targeted');
    });
    const headerContent = document.querySelector('.header .header-content');
    headerContent?.classList.remove('assistant-rail-mounted', 'assistant-rail-timeline-mounted');
    headerContent?.closest('.header')?.classList.remove('assistant-rail-timeline-header');
    document.querySelector('.main-content.timeline-assistant-main-mounted')?.classList.remove('timeline-assistant-main-mounted');
    document.body?.classList?.remove('timeline-assistant-main-mounted');
    window.CrmAssistantRail?.cleanupClickGuide?.();
}

function getCurrentAssetVersion() {
    const authScript = Array.from(document.scripts).find(script => /(^|\/)js\/auth\.js/.test(script.getAttribute('src') || ''));
    if (!authScript) return '';
    try {
        return new URL(authScript.src, window.location.href).searchParams.get('v') || '';
    } catch {
        return '';
    }
}

function ensureCrmAssistantRailAssets() {
    if (!isCrmAssistantRailEnabled()) {
        removeCrmAssistantRailSurface();
        return Promise.resolve(null);
    }

    if (
        window.CrmAssistantFoundation &&
        window.CrmAssistantOutputFormat &&
        window.CrmAssistantRail &&
        typeof window.CrmAssistantRail.init === 'function'
    ) {
        return Promise.resolve(window.CrmAssistantRail);
    }
    if (_crmAssistantRailLoadPromise) return _crmAssistantRailLoadPromise;

    const version = getCurrentAssetVersion();
    const suffix = version ? `?v=${encodeURIComponent(version)}` : '';
    const railCssPath = '/css/assistant-rail.css';
    const foundationJsPath = '/js/assistant-foundation.js';
    const outputFormatJsPath = '/js/assistant-output-format.js';
    const railJsPath = '/js/assistant-rail.js';
    const expectedRailCssHref = `${railCssPath}${suffix}`;
    const existingRailCss = document.querySelector('link[data-crm-assistant-rail-css]');
    if (!existingRailCss) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = expectedRailCssHref;
        link.dataset.crmAssistantRailCss = 'true';
        document.head.appendChild(link);
    } else {
        const currentHref = existingRailCss.getAttribute('href') || '';
        if (currentHref !== expectedRailCssHref) {
            existingRailCss.href = expectedRailCssHref;
        }
    }

    function loadAssistantScript(path, markerAttr, isReady, errorCode) {
        if (isReady()) return Promise.resolve();
        return new Promise((resolve, reject) => {
            if (document.querySelector(`script[${markerAttr}]`)) {
                const waitForGlobal = () => {
                    if (isReady()) resolve();
                    else window.setTimeout(waitForGlobal, 25);
                };
                waitForGlobal();
                return;
            }
            const script = document.createElement('script');
            script.src = `${path}${suffix}`;
            script.defer = true;
            script.setAttribute(markerAttr, 'true');
            script.onload = () => resolve();
            script.onerror = () => reject(new Error(errorCode));
            document.body.appendChild(script);
        });
    }

    _crmAssistantRailLoadPromise = loadAssistantScript(
        foundationJsPath,
        'data-crm-assistant-foundation-js',
        () => Boolean(window.CrmAssistantFoundation),
        'crm_assistant_foundation_load_failed'
    ).then(() => loadAssistantScript(
        outputFormatJsPath,
        'data-crm-assistant-output-format-js',
        () => Boolean(window.CrmAssistantOutputFormat),
        'crm_assistant_output_format_load_failed'
    )).then(() => loadAssistantScript(
        railJsPath,
        'data-crm-assistant-rail-js',
        () => Boolean(window.CrmAssistantRail),
        'crm_assistant_rail_load_failed'
    )).then(() => window.CrmAssistantRail);
    return _crmAssistantRailLoadPromise;
}

function initCrmAssistantRail() {
    if (!isCrmAssistantRailEnabled()) {
        removeCrmAssistantRailSurface();
        return Promise.resolve(false);
    }

    ensureCrmAssistantRailAssets()
        .then(rail => {
            if (rail && typeof rail.init === 'function') {
                rail.init({
                    page: document.body?.dataset?.page || document.title || window.location.pathname
                });
            }
        })
        .catch(err => console.warn('[crm-assistant] rail init failed', err));
}

function showAuthenticatedPageShell(options = {}) {
    const activateRuntime = options.markRuntimeReady !== false;
    if (activateRuntime) markAuthenticatedRuntimeReady();
    document.body.classList.remove('auth-screen');
    document.body.classList.add('authenticated-shell');
    document.getElementById('loginScreen')?.classList.add('hidden');
    const mainApp = document.getElementById('mainApp');
    if (mainApp) {
        mainApp.classList.remove('hidden');
        if (mainApp.style.display === 'none') mainApp.style.display = '';
    }

    const appUser = typeof AppState !== 'undefined' ? AppState.currentUser : null;
    const _userEl = document.getElementById('currentUser');
    if (_userEl && appUser?.name) _userEl.textContent = appUser.name;

    bindLogoutButton();
    initSharedHeaderActions();
    initHeaderThemeToggle();

    const sidebarToggle = document.getElementById('sidebarToggle');
    if (sidebarToggle) sidebarToggle.classList.remove('hidden');

    if (!activateRuntime) {
        if (typeof Sidebar !== 'undefined' && Sidebar.markShellReady) Sidebar.markShellReady();
        return;
    }

    if (typeof Sidebar !== 'undefined' && Sidebar.initUserCard) Sidebar.initUserCard();
    if (typeof Sidebar !== 'undefined' && Sidebar.markShellReady) Sidebar.markShellReady();
    if (typeof window.scheduleSidebarSmartMenuAssets === 'function') window.scheduleSidebarSmartMenuAssets();
    if (typeof window.CrmBusinessContext?.renderShell === 'function') {
        window.CrmBusinessContext.renderShell(appUser);
    }
    initCrmAssistantRail();
}

function renderStandaloneFatalError(options = {}) {
    const {
        containerId = 'main-content',
        title = 'Не вдалося відкрити модуль',
        message = 'Сторінка завантажилась, але один із кроків ініціалізації впав.',
        error,
        moduleName = 'module'
    } = options;
    const target = document.getElementById(containerId)
        || document.getElementById('main-content')
        || document.getElementById('mainApp')
        || document.body;
    if (!target) return;
    const errorMessage = error?.message || String(error || 'Unknown error');
    const requestId = error?.requestId ? `<p class="page-fatal-error-meta">requestId: ${_escHtml(error.requestId)}</p>` : '';
    target.innerHTML = `
        <div class="page-fatal-error" role="alert" data-module="${_escHtml(moduleName)}">
            <h3>${_escHtml(title)}</h3>
            <p>${_escHtml(message)}</p>
            <pre>${_escHtml(errorMessage)}</pre>
            ${requestId}
        </div>
    `;
}

function handleStandaloneInitError(moduleName, err, renderFatal) {
    console.error(`[${moduleName}:init] runtime failure`, err);
    if (typeof renderFatal === 'function') {
        renderFatal(err);
    } else {
        renderStandaloneFatalError({ moduleName, error: err });
    }
    if (typeof showNotification === 'function') {
        showNotification(`Помилка ініціалізації: ${moduleName}`, 'error');
    }
}

// v22.0.0: Role hierarchy — 26 roles (higher index = more permissions)
const ROLE_HIERARCHY = [
    'waiter', 'dishwasher', 'maintenance', 'cleaning', 'wardrobe', 'barista',
    'security', 'reception', 'animator', 'pastry_chef', 'head_pastry', 'cook', 'head_chef',
    'instructor', 'senior_instructor', 'admin', 'hr', 'it_specialist',
    'marketer', 'art_director', 'accountant', 'manager', 'senior_manager',
    'vice_director', 'director', 'creator'
];
const ROLE_LEVEL = {};
ROLE_HIERARCHY.forEach((r, i) => ROLE_LEVEL[r] = i);

const ROLE_NAMES = {
    creator: 'Творець', director: 'Директор', vice_director: 'Заст. директора',
    senior_manager: 'Старший менеджер', manager: 'Менеджер',
    accountant: 'Бухгалтер', art_director: 'Арт-директор', marketer: 'Маркетолог',
    it_specialist: 'IT-спеціаліст', hr: 'HR',
    admin: 'Адміністратор',
    senior_instructor: 'Адміністратор ігрових зон', instructor: 'Інструктор батутів', trampoline_instructor: 'Інструктор батутів',
    head_chef: 'Кухар', head_cook: 'Кухар', cook: 'Кухар', head_pastry: 'Шеф-кондитер', pastry_chef: 'Кондитер',
    animator: 'Аніматор', reception: 'Рецепція', barista: 'Бариста', bartender: 'Бариста', security: 'Охорона',
    wardrobe: 'Гардеробник', cleaning: 'Прибиральник', cleaner: 'Прибиральник', maintenance: 'Технічний директор', technician: 'Технічний директор',
    dishwasher: 'Посудомийник', waiter: 'Офіціант'
};

// Permission role presets and aliases are hydrated from /api/auth/permissions.
// The browser keeps no independent authorization matrix.
let PAGE_ACCESS = Object.create(null);
let ACTION_PERMISSIONS = Object.create(null);
let PAGE_CAPABILITY_ALIASES = Object.create(null);
let ACTION_CAPABILITY_ALIASES = Object.create(null);
let ACTION_LEGACY_KEYS = Object.create(null);
let ACTION_LEGACY_DENY_KEYS = Object.create(null);
let EXPLICIT_ALLOW_DISABLED_PAGES = new Set();
let EXPLICIT_ALLOW_DISABLED_ACTIONS = new Set();
let NON_DELEGABLE_ACTIONS = new Set();

const ROLE_PREVIEW_STORAGE_KEY = 'pzp_test_role';
const ROLE_PREVIEW_SESSION_KEY = 'testRole';
const ROLE_WORKING_STORAGE_KEY = 'pzp_working_role';
const ROLE_WORKING_OWNER_KEY = 'pzp_working_role_owner';
const ROLE_QUICK_ACCESS_BASE = ['/', '/staff', '/chat', '/certificates'];

const ROLE_SHELL_DEFAULT = {
    startPage: '/dashboard',
    dashboardPreset: '_default',
    quickAccess: ROLE_QUICK_ACCESS_BASE
};

const ROLE_SHELL_CONFIG = {
    creator: {
        startPage: '/dashboard',
        dashboardPreset: 'creator',
        quickAccess: ROLE_QUICK_ACCESS_BASE
    },
    director: {
        startPage: '/dashboard',
        dashboardPreset: 'director',
        quickAccess: ROLE_QUICK_ACCESS_BASE
    },
    vice_director: {
        startPage: '/dashboard',
        dashboardPreset: 'vice_director',
        quickAccess: ROLE_QUICK_ACCESS_BASE
    },
    senior_manager: {
        startPage: '/dashboard',
        dashboardPreset: 'senior_manager',
        quickAccess: ROLE_QUICK_ACCESS_BASE
    },
    manager: {
        startPage: '/dashboard',
        dashboardPreset: 'manager',
        quickAccess: ROLE_QUICK_ACCESS_BASE
    },
    admin: {
        startPage: '/',
        dashboardPreset: 'admin',
        quickAccess: ROLE_QUICK_ACCESS_BASE
    },
    reception: {
        startPage: '/',
        dashboardPreset: 'reception',
        quickAccess: ROLE_QUICK_ACCESS_BASE
    },
    animator: {
        startPage: '/tasks',
        dashboardPreset: 'animator',
        quickAccess: ROLE_QUICK_ACCESS_BASE
    },
    instructor: {
        startPage: '/tasks',
        dashboardPreset: 'instructor',
        quickAccess: ROLE_QUICK_ACCESS_BASE
    },
    senior_instructor: {
        startPage: '/tasks',
        dashboardPreset: 'senior_instructor',
        quickAccess: ROLE_QUICK_ACCESS_BASE
    },
    art_director: {
        startPage: '/art',
        dashboardPreset: 'art_director',
        quickAccess: ROLE_QUICK_ACCESS_BASE
    },
    marketer: {
        startPage: '/sales-funnel',
        dashboardPreset: 'marketer',
        quickAccess: ROLE_QUICK_ACCESS_BASE
    },
    accountant: {
        startPage: '/finance',
        dashboardPreset: 'accountant',
        quickAccess: ROLE_QUICK_ACCESS_BASE
    },
    hr: {
        startPage: '/hr',
        dashboardPreset: 'hr',
        quickAccess: ROLE_QUICK_ACCESS_BASE
    },
    security: {
        startPage: '/guardian-ops',
        dashboardPreset: 'security',
        quickAccess: ROLE_QUICK_ACCESS_BASE
    },
    head_chef: {
        startPage: '/tasks',
        dashboardPreset: 'head_chef',
        quickAccess: ROLE_QUICK_ACCESS_BASE
    },
    cook: {
        startPage: '/tasks',
        dashboardPreset: 'cook',
        quickAccess: ROLE_QUICK_ACCESS_BASE
    },
    head_pastry: {
        startPage: '/tasks',
        dashboardPreset: 'head_pastry',
        quickAccess: ROLE_QUICK_ACCESS_BASE
    },
    pastry_chef: {
        startPage: '/tasks',
        dashboardPreset: 'pastry_chef',
        quickAccess: ROLE_QUICK_ACCESS_BASE
    },
    barista: {
        startPage: '/tasks',
        dashboardPreset: 'barista',
        quickAccess: ROLE_QUICK_ACCESS_BASE
    },
    cleaning: {
        startPage: '/tasks',
        dashboardPreset: 'cleaning',
        quickAccess: ROLE_QUICK_ACCESS_BASE
    },
    maintenance: {
        startPage: '/tasks',
        dashboardPreset: 'maintenance',
        quickAccess: ROLE_QUICK_ACCESS_BASE
    }
};

function _normalizeRoleKey(role) {
    const key = String(role || '').trim();
    return ROLE_LEVEL[key] !== undefined ? key : '';
}

function _getRoleConfig(role) {
    const key = _normalizeRoleKey(role);
    return {
        ...ROLE_SHELL_DEFAULT,
        ...(key && ROLE_SHELL_CONFIG[key] ? ROLE_SHELL_CONFIG[key] : {})
    };
}

function getRoleStartPage(role) {
    return _getRoleConfig(role).startPage || ROLE_SHELL_DEFAULT.startPage;
}

function getAuthenticatedTimelineStartPage(user = AppState.currentUser) {
    if (typeof window !== 'undefined' && window.CrmBusinessContext?.startPageForUser) {
        return window.CrmBusinessContext.startPageForUser(user);
    }
    if (typeof window !== 'undefined' && window.CrmBusinessContext?.defaultTimelineRouteForUser) {
        return window.CrmBusinessContext.defaultTimelineRouteForUser(user);
    }
    const rawDefault = getRealUserRole(user) === 'creator'
        ? String(user?.defaultBusinessContext || user?.default_business_context || '').trim().toLowerCase()
        : '';
    const business = rawDefault === 'maysternya_doli'
        ? 'maysternya_doli'
        : (rawDefault === 'dar' ? 'dar' : 'event_genix');
    const timelineRoute = business === 'maysternya_doli'
        ? '/maysternya-doli'
        : (business === 'dar' ? '/?businessContext=dar' : '/');
    try {
        const prefix = business === 'maysternya_doli' ? 'md' : (business === 'dar' ? 'crm_dar' : 'pzp');
        const raw = localStorage.getItem(`${prefix}_timeline_display_settings`);
        const settings = raw ? JSON.parse(raw) : null;
        const startPage = settings?.timelineEnabled === false || settings?.mode === 'disabled'
            ? 'dashboard'
            : String(settings?.startPage || 'timeline');
        const map = {
            timeline: timelineRoute,
            dashboard: '/dashboard',
            leads: '/sales-funnel',
            customers: '/customers',
            omni: '/omni',
            tasks: '/tasks'
        };
        return map[startPage] || timelineRoute;
    } catch {
        return timelineRoute;
    }
}

function getRealUserRole(user = AppState.currentUser) {
    return _normalizeRoleKey(user?.role || user?.account_role || user?.accountRole) || null;
}

function _safeStorageGet(storage, key) {
    try {
        return storage?.getItem?.(key) || '';
    } catch {
        return '';
    }
}

function _safeStorageSet(storage, key, value) {
    try {
        storage?.setItem?.(key, String(value));
    } catch {}
}

function _safeStorageRemove(storage, key) {
    try {
        storage?.removeItem?.(key);
    } catch {}
}

function _workingRoleOwnerKey(user = AppState.currentUser) {
    return String(user?.id || user?.username || '').trim();
}

function getGrantedExtraRoles(user = AppState.currentUser) {
    const primary = getRealUserRole(user);
    const roles = [];
    if (Array.isArray(user?.extraRoles)) roles.push(...user.extraRoles);
    if (Array.isArray(user?.extra_roles)) roles.push(...user.extra_roles);
    if (Array.isArray(user?.roles)) roles.push(...user.roles.filter(role => role !== primary));
    return Array.from(new Set(roles
        .map(role => _normalizeRoleKey(role))
        .filter(role => role && role !== primary)));
}

function canSwitchWorkingRoles(user = AppState.currentUser) {
    return getRealUserRole(user) === 'creator';
}

function getAvailableWorkingRoles(user = AppState.currentUser) {
    const primary = getRealUserRole(user);
    if (!canSwitchWorkingRoles(user)) return primary ? [primary] : [];
    return Array.from(new Set([primary, ...getGrantedExtraRoles(user)].filter(Boolean)));
}

function clearStoredWorkingRole() {
    _safeStorageRemove(localStorage, ROLE_WORKING_STORAGE_KEY);
    _safeStorageRemove(localStorage, ROLE_WORKING_OWNER_KEY);
}

function getStoredWorkingRole(user = AppState.currentUser) {
    const raw = _safeStorageGet(localStorage, ROLE_WORKING_STORAGE_KEY);
    const owner = _safeStorageGet(localStorage, ROLE_WORKING_OWNER_KEY);
    const currentOwner = _workingRoleOwnerKey(user);
    if (owner && currentOwner && owner !== currentOwner) {
        clearStoredWorkingRole();
        return null;
    }
    const role = _normalizeRoleKey(raw);
    if (!role) return null;
    if (!getAvailableWorkingRoles(user).includes(role)) {
        clearStoredWorkingRole();
        return null;
    }
    return role;
}

function getActiveWorkingRole(user = AppState.currentUser) {
    return getStoredWorkingRole(user) || getRealUserRole(user);
}

function canPreviewRoles(user = AppState.currentUser) {
    return getRealUserRole(user) === 'creator';
}

function getPreviewableRoles(user = AppState.currentUser) {
    const realRole = getRealUserRole(user);
    if (!canPreviewRoles(user)) return realRole ? [realRole] : [];
    if (realRole === 'creator') return ROLE_HIERARCHY.slice();
    const max = ROLE_LEVEL[realRole] ?? -1;
    return ROLE_HIERARCHY.filter(role => role !== 'creator' && (ROLE_LEVEL[role] ?? -1) <= max);
}

function getStoredPreviewRole(user = AppState.currentUser) {
    const raw = sessionStorage.getItem(ROLE_PREVIEW_SESSION_KEY) || localStorage.getItem(ROLE_PREVIEW_STORAGE_KEY) || '';
    const role = _normalizeRoleKey(raw);
    if (!role || !canPreviewRoles(user) || !getPreviewableRoles(user).includes(role)) {
        if (raw) {
            sessionStorage.removeItem(ROLE_PREVIEW_SESSION_KEY);
            localStorage.removeItem(ROLE_PREVIEW_STORAGE_KEY);
        }
        return null;
    }
    const realRole = getRealUserRole(user);
    return role === realRole ? null : role;
}

function getEffectiveUserRole(user = AppState.currentUser) {
    return getStoredPreviewRole(user) || getActiveWorkingRole(user);
}

const RoleShell = {
    getConfig(role = getEffectiveUserRole()) {
        return _getRoleConfig(role);
    },
    getStartPage(role = getEffectiveUserRole()) {
        return getRoleStartPage(role);
    },
    getQuickAccessHrefs(role = getEffectiveUserRole()) {
        const config = _getRoleConfig(role);
        return Array.isArray(config.quickAccess) ? config.quickAccess.slice() : ROLE_SHELL_DEFAULT.quickAccess.slice();
    },
    getDashboardPreset(role = getEffectiveUserRole()) {
        return _getRoleConfig(role).dashboardPreset || role || ROLE_SHELL_DEFAULT.dashboardPreset;
    },
    getRoleLabel(role) {
        return ROLE_NAMES[role] || role || 'CRM';
    }
};
window.RoleShell = RoleShell;

function describeWorkingRoleImpact(role) {
    const config = _getRoleConfig(role);
    return [
        {
            key: 'sidebar',
            label: 'Sidebar / navigation',
            detail: 'Змінює рольовий фокус меню, порядок груп і quick access; grant-доступи акаунта лишаються правдою безпеки.'
        },
        {
            key: 'dashboard',
            label: 'Dashboard preset',
            detail: `Dashboard працює з preset: ${RoleShell.getDashboardPreset(role) || 'default'}.`
        },
        {
            key: 'quick_access',
            label: 'Quick access',
            detail: (config.quickAccess || ROLE_SHELL_DEFAULT.quickAccess).join(' · ')
        },
        {
            key: 'start_page',
            label: 'Start page',
            detail: getRoleStartPage(role) || ROLE_SHELL_DEFAULT.startPage
        }
    ];
}

function getWorkingRoleState(user = AppState.currentUser) {
    const baseRole = getRealUserRole(user);
    const extraRoles = getGrantedExtraRoles(user);
    const availableRoles = getAvailableWorkingRoles(user);
    const activeRole = getActiveWorkingRole(user) || baseRole || availableRoles[0] || null;
    const previewRole = getStoredPreviewRole(user);
    const effectiveRole = previewRole || activeRole;
    return {
        baseRole,
        realRole: baseRole,
        extraRoles,
        availableRoles,
        activeRole,
        workingRole: activeRole,
        previewRole,
        effectiveRole,
        isBaseActive: Boolean(baseRole && activeRole === baseRole),
        baseLabel: RoleShell.getRoleLabel(baseRole),
        realLabel: RoleShell.getRoleLabel(baseRole),
        extraRoleLabels: extraRoles.map(role => ({ role, label: RoleShell.getRoleLabel(role) })),
        activeLabel: RoleShell.getRoleLabel(activeRole),
        workingLabel: RoleShell.getRoleLabel(activeRole),
        previewLabel: previewRole ? RoleShell.getRoleLabel(previewRole) : '',
        effectiveLabel: RoleShell.getRoleLabel(effectiveRole),
        startPage: getRoleStartPage(effectiveRole),
        dashboardPreset: RoleShell.getDashboardPreset(effectiveRole),
        quickAccess: RoleShell.getQuickAccessHrefs(effectiveRole),
        changedSurfaces: describeWorkingRoleImpact(activeRole)
    };
}

function syncWorkingRoleToCurrentUser(state = getWorkingRoleState()) {
    const user = AppState.currentUser;
    if (!user) return;
    user.activeRole = state.activeRole || null;
    user.workingRole = state.activeRole || null;
    user.effectiveRole = state.effectiveRole || null;
    user.previewRole = state.previewRole || null;
    try {
        localStorage.setItem(CONFIG.STORAGE.CURRENT_USER, JSON.stringify(user));
    } catch {}
}

function applyRoleShellState(state) {
    syncWorkingRoleToCurrentUser(state);
    document.body?.classList.toggle('role-preview-active', Boolean(state.previewRole));
    document.body?.classList.toggle('working-role-active', Boolean(state.activeRole && state.baseRole && state.activeRole !== state.baseRole));
    if (state.previewRole) {
        document.body?.setAttribute('data-preview-role', state.previewRole);
    } else {
        document.body?.removeAttribute('data-preview-role');
    }
    if (state.activeRole) {
        document.body?.setAttribute('data-working-role', state.activeRole);
    } else {
        document.body?.removeAttribute('data-working-role');
    }
    if (typeof Sidebar !== 'undefined') {
        Sidebar.render?.();
        Sidebar.initUserCard?.();
    }
    document.querySelectorAll('[data-page-access]').forEach(el => {
        const page = _normalizePagePath(el.dataset.pageAccess);
        if (!page) return;
        el.classList.toggle('hidden', _isPageAllowedForRole(page, state.effectiveRole) !== true && !canAccessPage(page));
    });
    document.querySelectorAll('.sidebar-admin-only').forEach(el => {
        el.classList.toggle('hidden', !['creator', 'director'].includes(state.effectiveRole));
    });
    document.querySelectorAll('.sidebar-no-viewer').forEach(el => {
        const viewerRoles = ['waiter', 'dishwasher', 'maintenance', 'cleaning', 'wardrobe', 'barista', 'reception', 'animator', 'pastry_chef', 'cook', 'instructor'];
        el.classList.toggle('hidden', viewerRoles.includes(state.effectiveRole));
    });
}

const WorkingRole = {
    getBaseRole(user = AppState.currentUser) {
        return getRealUserRole(user);
    },
    getExtraRoles(user = AppState.currentUser) {
        return getGrantedExtraRoles(user);
    },
    getAvailableRoles(user = AppState.currentUser) {
        return getAvailableWorkingRoles(user);
    },
    getActiveRole(user = AppState.currentUser) {
        return getActiveWorkingRole(user);
    },
    getEffectiveRole(user = AppState.currentUser) {
        return getEffectiveUserRole(user);
    },
    getState(user = AppState.currentUser) {
        return getWorkingRoleState(user);
    },
    setActiveRole(role) {
        const nextRole = _normalizeRoleKey(role);
        const user = AppState.currentUser || {};
        const available = getAvailableWorkingRoles(user);
        if (!nextRole || !available.includes(nextRole)) return false;
        const baseRole = getRealUserRole(user);
        sessionStorage.removeItem(ROLE_PREVIEW_SESSION_KEY);
        localStorage.removeItem(ROLE_PREVIEW_STORAGE_KEY);
        if (nextRole === baseRole) {
            clearStoredWorkingRole();
        } else {
            _safeStorageSet(localStorage, ROLE_WORKING_STORAGE_KEY, nextRole);
            _safeStorageSet(localStorage, ROLE_WORKING_OWNER_KEY, _workingRoleOwnerKey(user));
        }
        this.refreshShell({ mode: 'working-role', role: nextRole });
        if (typeof showNotification === 'function') {
            showNotification(`Робоча роль: ${RoleShell.getRoleLabel(nextRole)}`, 'success');
        }
        return true;
    },
    resetToBase() {
        const baseRole = getRealUserRole();
        if (!baseRole) return false;
        return this.setActiveRole(baseRole);
    },
    hydrate() {
        const state = this.getState();
        applyRoleShellState(state);
        return state;
    },
    refreshShell(detail = {}) {
        const state = this.getState();
        applyRoleShellState(state);
        window.dispatchEvent(new CustomEvent('workingRoleChanged', { detail: { ...state, ...detail } }));
        window.dispatchEvent(new CustomEvent('roleSwitched', { detail: { role: state.effectiveRole, ...detail } }));
    }
};
window.WorkingRole = WorkingRole;

const RolePreview = {
    canPreview(user = AppState.currentUser) {
        return canPreviewRoles(user);
    },
    getRealRole(user = AppState.currentUser) {
        return getRealUserRole(user);
    },
    getPreviewRole(user = AppState.currentUser) {
        return getStoredPreviewRole(user);
    },
    getEffectiveRole(user = AppState.currentUser) {
        return getEffectiveUserRole(user);
    },
    getAvailableRoles(user = AppState.currentUser) {
        return getPreviewableRoles(user);
    },
    setPreviewRole(role) {
        const nextRole = _normalizeRoleKey(role);
        if (!canPreviewRoles() || !nextRole || !getPreviewableRoles().includes(nextRole)) return false;
        if (nextRole === getRealUserRole()) return this.clearPreviewRole();
        sessionStorage.setItem(ROLE_PREVIEW_SESSION_KEY, nextRole);
        localStorage.setItem(ROLE_PREVIEW_STORAGE_KEY, nextRole);
        this.refreshShell({ mode: 'preview', role: nextRole });
        if (typeof showNotification === 'function') {
            showNotification(`Перегляд як: ${RoleShell.getRoleLabel(nextRole)}`, 'success');
        }
        return true;
    },
    clearPreviewRole() {
        sessionStorage.removeItem(ROLE_PREVIEW_SESSION_KEY);
        localStorage.removeItem(ROLE_PREVIEW_STORAGE_KEY);
        const role = getActiveWorkingRole();
        this.refreshShell({ mode: 'reset', role });
        if (typeof showNotification === 'function') {
            showNotification('Перегляд ролі скинуто', 'success');
        }
        return true;
    },
    getState(user = AppState.currentUser) {
        const workingState = getWorkingRoleState(user);
        const realRole = workingState.baseRole;
        const previewRole = getStoredPreviewRole(user);
        const effectiveRole = previewRole || workingState.activeRole || realRole;
        return {
            ...workingState,
            realRole,
            previewRole,
            effectiveRole,
            canPreview: canPreviewRoles(user),
            roles: getPreviewableRoles(user),
            realLabel: RoleShell.getRoleLabel(realRole),
            previewLabel: previewRole ? RoleShell.getRoleLabel(previewRole) : '',
            effectiveLabel: RoleShell.getRoleLabel(effectiveRole),
            startPage: getRoleStartPage(effectiveRole),
            dashboardPreset: RoleShell.getDashboardPreset(effectiveRole),
            quickAccess: RoleShell.getQuickAccessHrefs(effectiveRole)
        };
    },
    refreshShell(detail = {}) {
        const state = this.getState();
        applyRoleShellState(state);
        window.dispatchEvent(new CustomEvent('rolePreviewChanged', { detail: { ...state, ...detail } }));
        window.dispatchEvent(new CustomEvent('roleSwitched', { detail: { role: state.effectiveRole, ...detail } }));
    }
};
window.RolePreview = RolePreview;

function getUserRole() {
    return getEffectiveUserRole();
}

function getUserRoles() {
    const previewRole = getStoredPreviewRole();
    if (previewRole) return [previewRole];
    const roles = [];
    const activeRole = getActiveWorkingRole();
    const primary = getRealUserRole();
    if (activeRole) roles.push(activeRole);
    if (primary) roles.push(primary);
    const user = AppState.currentUser || {};
    if (Array.isArray(user.roles)) roles.push(...user.roles);
    if (Array.isArray(user.extraRoles)) roles.push(...user.extraRoles);
    if (Array.isArray(user.extra_roles)) roles.push(...user.extra_roles);
    return Array.from(new Set(roles.filter(Boolean).map(String)));
}

function _normalizePagePath(page) {
    if (!page) return null;
    const raw = String(page).trim();
    if (!raw || raw.startsWith('#')) return null;
    const pathOnly = raw.split('#')[0].split('?')[0];
    const normalized = pathOnly.replace(/\.html$/, '').replace(/\/$/, '') || '/';
    return PAGE_CAPABILITY_ALIASES[pathOnly] || PAGE_CAPABILITY_ALIASES[normalized] || normalized;
}

function _normalizeActionKey(action) {
    const raw = String(action || '').trim();
    return ACTION_CAPABILITY_ALIASES[raw] || raw;
}

function getUserPageAllowlist(user = AppState.currentUser || {}) {
    const pages = [];
    if (Array.isArray(user.pageAllowlist)) pages.push(...user.pageAllowlist);
    if (Array.isArray(user.page_allowlist)) pages.push(...user.page_allowlist);
    const permissions = user === AppState.currentUser ? (AppState.authPermissions || user.permissions || {}) : (user.permissions || {});
    if (Array.isArray(permissions.pageAllowlist)) pages.push(...permissions.pageAllowlist);
    return Array.from(new Set(pages.map(_normalizePagePath).filter(Boolean)));
}

function getUserPageDenylist(user = AppState.currentUser || {}) {
    const pages = [];
    if (Array.isArray(user.pageDenylist)) pages.push(...user.pageDenylist);
    if (Array.isArray(user.page_denylist)) pages.push(...user.page_denylist);
    const permissions = user === AppState.currentUser ? (AppState.authPermissions || user.permissions || {}) : (user.permissions || {});
    if (Array.isArray(permissions.pageDenylist)) pages.push(...permissions.pageDenylist);
    return Array.from(new Set(pages.map(_normalizePagePath).filter(Boolean)));
}

function hasMinRole(minRole) {
    return getUserRoles().some(role => (ROLE_LEVEL[role] || 0) >= (ROLE_LEVEL[minRole] || 99));
}

function getCurrentUserActionList(primaryKey, legacyKey, user = AppState.currentUser || {}) {
    const values = [];
    if (Array.isArray(user[primaryKey])) values.push(...user[primaryKey]);
    if (Array.isArray(user[legacyKey])) values.push(...user[legacyKey]);
    const permissions = user === AppState.currentUser ? (AppState.authPermissions || user.permissions || {}) : (user.permissions || {});
    if (primaryKey === 'actionAllowlist' && Array.isArray(permissions.actionAllowlist)) values.push(...permissions.actionAllowlist);
    if (primaryKey === 'actionDenylist' && Array.isArray(permissions.actionDenylist)) values.push(...permissions.actionDenylist);
    return Array.from(new Set(values.map(_normalizeActionKey).filter(Boolean)));
}

function _frontendCapabilityDecision(normalized, allowed, source, sourceRole, reason) {
    return {
        allowed,
        source,
        sourceRole: sourceRole || null,
        reason,
        capability: `${normalized.type}:${normalized.key}`,
        type: normalized.type,
        key: normalized.key,
        requestedKey: normalized.requestedKey
    };
}

function resolveCapability(user, capability, context = {}) {
    const capabilityObject = capability && typeof capability === 'object' ? capability : null;
    const rawCapability = String(capabilityObject?.key ?? capability ?? '').trim();
    const prefixedType = rawCapability.match(/^(page|action):/)?.[1] || null;
    const requestedType = context.type || capabilityObject?.type || prefixedType
        || (rawCapability.startsWith('/') || rawCapability.startsWith('#') ? 'page' : 'action');
    const requestedKey = rawCapability.replace(/^(page|action):/, '');
    const key = requestedType === 'page' ? _normalizePagePath(requestedKey) : _normalizeActionKey(requestedKey);
    const normalized = { type: requestedType, key, requestedKey };
    const permissions = context.permissions || AppState.authPermissions || user?.permissions || null;
    const previewRole = context.previewRole || '';
    const capabilityId = `${requestedType}:${key}`;

    if (!previewRole && context.ignoreServer !== true) {
        const serverDecision = permissions?.capabilities?.[capabilityId];
        if (serverDecision) return { ...serverDecision };
        const legacyDecisions = requestedType === 'page' ? permissions?.pages : permissions?.actions;
        if (legacyDecisions && Object.prototype.hasOwnProperty.call(legacyDecisions, key)) {
            const allowed = Boolean(legacyDecisions[key]);
            return _frontendCapabilityDecision(normalized, allowed, 'server_effective', null, 'server_effective_permission');
        }
    }

    const rolePresets = requestedType === 'page' ? PAGE_ACCESS : ACTION_PERMISSIONS;
    const allowedRoles = rolePresets[key];
    if (!key || !Array.isArray(allowedRoles)) {
        return _frontendCapabilityDecision(normalized, false, 'default_deny', null, 'unknown_capability');
    }

    const effectiveUser = previewRole ? { role: previewRole, roles: [previewRole] } : (user || {});
    const allowlist = requestedType === 'page'
        ? getUserPageAllowlist(effectiveUser)
        : getCurrentUserActionList('actionAllowlist', 'action_allowlist', effectiveUser);
    const denylist = requestedType === 'page'
        ? getUserPageDenylist(effectiveUser)
        : getCurrentUserActionList('actionDenylist', 'action_denylist', effectiveUser);
    const overrideKeys = requestedType === 'action' ? [key, ...(ACTION_LEGACY_KEYS[key] || [])] : [key];
    const legacyDenyKeys = typeof ACTION_LEGACY_DENY_KEYS === 'undefined' ? [] : (ACTION_LEGACY_DENY_KEYS[key] || []);
    const denyOverrideKeys = requestedType === 'action' ? [...overrideKeys, ...legacyDenyKeys] : overrideKeys;
    if (denyOverrideKeys.some(candidate => denylist.includes(candidate))) {
        return _frontendCapabilityDecision(normalized, false, 'explicit_deny', null, 'listed_in_explicit_deny');
    }

    const actionNonDelegable = requestedType === 'action' && NON_DELEGABLE_ACTIONS.has(key);
    const explicitAllowSupported = requestedType === 'page'
        ? !EXPLICIT_ALLOW_DISABLED_PAGES.has(key)
        : !EXPLICIT_ALLOW_DISABLED_ACTIONS.has(key);
    if (explicitAllowSupported && !actionNonDelegable && overrideKeys.some(candidate => allowlist.includes(candidate))) {
        return _frontendCapabilityDecision(normalized, true, 'explicit_allow', null, 'listed_in_explicit_allow');
    }

    const roles = previewRole
        ? [previewRole]
        : Array.from(new Set((Array.isArray(context.roles)
            ? [context.primaryRole, ...context.roles]
            : [
                effectiveUser.role,
                ...(Array.isArray(effectiveUser.roles) ? effectiveUser.roles : []),
                ...(Array.isArray(effectiveUser.extraRoles) ? effectiveUser.extraRoles : []),
                ...(Array.isArray(effectiveUser.extra_roles) ? effectiveUser.extra_roles : [])
            ]).filter(Boolean).map(String)));
    const roleCandidates = actionNonDelegable ? [context.primaryRole || effectiveUser.role].filter(Boolean) : roles;
    const sourceRole = roleCandidates.find(role => allowedRoles.includes(role)) || null;
    if (sourceRole) {
        return _frontendCapabilityDecision(normalized, true, 'role_preset', sourceRole, 'granted_by_role_preset');
    }
    if ((!explicitAllowSupported || actionNonDelegable) && overrideKeys.some(candidate => allowlist.includes(candidate))) {
        const reason = actionNonDelegable ? 'non_delegable_explicit_allow_ignored' : 'explicit_allow_disabled';
        return _frontendCapabilityDecision(normalized, false, 'default_deny', null, reason);
    }
    return _frontendCapabilityDecision(normalized, false, 'default_deny', null, 'no_matching_grant');
}

if (typeof window !== 'undefined') {
    window.hydrateActionPermissions = hydrateActionPermissions;
    window.getPermissionLifecycle = getPermissionLifecycle;
    window.renderPermissionBootstrapError = renderPermissionBootstrapError;
    window.renderAuthSessionBootstrapError = renderAuthSessionBootstrapError;
    window.handleTransientAuthSessionBootstrap = handleTransientAuthSessionBootstrap;
    window.resolveCapability = resolveCapability;
}

function canAccess(action) {
    if (window.TimelineBusinessContext?.current().key === 'maysternya_doli') {
        const aliases = {
            create_booking: 'create',
            edit_booking: 'edit',
            delete_booking: 'delete',
            export_data: 'export',
            manage_settings: 'settings'
        };
        if (aliases[action]) {
            return window.TimelineBusinessContext.canUseAction(aliases[action], AppState.currentUser);
        }
    }
    return resolveCapability(AppState.currentUser, action, {
        type: 'action',
        previewRole: getStoredPreviewRole()
    }).allowed;
}

function canUseAction(action) {
    return canAccess(action);
}

if (typeof window !== 'undefined') {
    window.canUseAction = canUseAction;
}

function _isPageAllowedForRole(page, role) {
    if (!_normalizePagePath(page)) return null;
    return resolveCapability({ role, roles: [role] }, page, {
        type: 'page',
        previewRole: role,
        ignoreServer: true
    }).allowed;
}

function canAccessPage(page) {
    return resolveCapability(AppState.currentUser, page, {
        type: 'page',
        previewRole: getStoredPreviewRole()
    }).allowed;
}

function setTimelinePermissionHidden(elementOrId, hidden) {
    const el = typeof elementOrId === 'string' ? document.getElementById(elementOrId) : elementOrId;
    if (!el) return;
    const shouldHide = Boolean(hidden);
    el.classList.toggle('timeline-permission-hidden', shouldHide);
    el.toggleAttribute('data-timeline-permission-hidden', shouldHide);
    if (shouldHide) {
        el.classList.add('hidden');
    } else {
        el.classList.remove('hidden');
        el.style.display = '';
    }
}

function isViewer() {
    const role = getUserRole();
    const viewerRoles = ['waiter', 'dishwasher', 'maintenance', 'cleaning', 'wardrobe', 'barista', 'reception', 'animator', 'pastry_chef', 'cook', 'instructor'];
    return viewerRoles.includes(role);
}

function canManageProducts() {
    return hasMinRole('manager');
}

function isAdmin() {
    return hasMinRole('admin');
}

function isManagement() {
    return hasMinRole('senior_manager');
}

function shouldEnableAssistantIdleHints() {
    if (window.CRM_ASSISTANT_IDLE_HINTS === true) return true;
    try {
        return localStorage.getItem('eg_crm_assistant_idle_hints') === 'on';
    } catch {
        return false;
    }
}

function getCurrentPageAccessPath() {
    const path = window.location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
    const embeddedParents = {
        '/embed/designs': '/designs',
        '/embed/programs': '/programs',
        '/embed/graduation': '/graduation'
    };
    return embeddedParents[path] || path;
}

function enforceCurrentPageAccess(user = AppState.currentUser) {
    // A missing catalog is not an access denial. Standalone pages hydrate the
    // catalog asynchronously, so redirecting before that request completes
    // creates a false deny (and a visible bounce back to the timeline).
    if (getPermissionLifecycle().status !== 'ready') return null;

    const path = getCurrentPageAccessPath();
    if (path === '/invite') return true;
    if (canAccessPage(path)) return true;

    const fallback = getAuthenticatedTimelineStartPage(user || AppState.currentUser) || '/dashboard';
    if (window.location.pathname !== fallback) {
        recordRedirectDiagnostic('auth-redirect', {
            stage: 'page-access',
            redirectReason: 'page-access-denied',
            targetRoute: fallback
        });
        window.location.replace(fallback);
    }
    return false;
}

function showMainApp() {
    if (!enforceCurrentPageAccess()) return;
    document.getElementById('loginScreen')?.classList.add('hidden');
    const _userEl = document.getElementById('currentUser');
    if (_userEl && AppState.currentUser?.name) _userEl.textContent = AppState.currentUser.name;
    // Show floating buttons hidden during logout
    const sidebarToggle = document.getElementById('sidebarToggle');
    if (sidebarToggle) sidebarToggle.classList.remove('hidden');

    // v8.6: Close all panels/modals on page load to prevent stale empty views
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    ['certificatesPanel', 'bookingPanel'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    document.body.classList.remove('panel-open');
    const backdrop = document.getElementById('panelBackdrop');
    if (backdrop) backdrop.classList.add('hidden');

    if (window.TimelineBusinessContext?.current().key === 'maysternya_doli'
        && !window.TimelineBusinessContext.canAccessContext(AppState.currentUser)) {
        recordRedirectDiagnostic('auth-redirect', {
            stage: 'business-context',
            redirectReason: 'context-access-denied',
            targetRoute: '/dashboard'
        });
        window.location.href = '/dashboard';
        return;
    }

    // v20.1.0: Sidebar role-based visibility via page access matrix
    const role = getUserRole();
    document.querySelectorAll('[data-page-access]').forEach(el => {
        const page = _normalizePagePath(el.dataset.pageAccess);
        if (!page) return;
        el.classList.toggle('hidden', !canAccessPage(page));
    });
    // Legacy classes for backward compat
    document.querySelectorAll('.sidebar-admin-only').forEach(el => {
        el.classList.toggle('hidden', !canAccess('manage_settings'));
    });
    document.querySelectorAll('.sidebar-no-viewer').forEach(el => {
        el.classList.toggle('hidden', isViewer());
    });
    // Permission visibility is separate from the visual constructor state.
    setTimelinePermissionHidden('addLineBtn', !canAccess('create_booking'));
    // Timeline print and image export are available to every authenticated user.
    setTimelinePermissionHidden('exportTimelineBtn', false);
    setTimelinePermissionHidden('exportPdfBtn', false);
    setTimelinePermissionHidden('productSalesBtn', !canAccess('view_revenue'));

    if (window.TimelineBusinessContext?.current().key === 'maysternya_doli') {
        const canUse = action => window.TimelineBusinessContext.canUseAction(action, AppState.currentUser);
        setTimelinePermissionHidden('addLineBtn', !canUse('settings'));
        setTimelinePermissionHidden('productSalesBtn', true);
    }
    if (window.TimelineVisibility) {
        window.TimelineVisibility.refreshAccess?.();
        window.TimelineVisibility.applyVisibility?.();
    }

    // Compact mode toggle
    const compactToggle = document.getElementById('compactModeToggle');
    if (typeof syncTimelineCompactToggleAria === 'function') {
        syncTimelineCompactToggleAria();
    } else if (compactToggle) {
        compactToggle.checked = AppState.compactMode;
        compactToggle.setAttribute('aria-checked', AppState.compactMode ? 'true' : 'false');
    }

    // Zoom buttons
    updateZoomButtons();

    // Undo button
    updateUndoButton();

    // Status filter restore
    if (AppState.statusFilter && AppState.statusFilter !== 'all') {
        if (typeof syncTimelineStatusFilterButtons === 'function') {
            syncTimelineStatusFilterButtons();
        } else {
            document.querySelectorAll('.status-filter-btn').forEach(b => {
                const active = b.dataset.filter === AppState.statusFilter;
                b.classList.toggle('active', active);
                b.setAttribute('aria-pressed', active ? 'true' : 'false');
            });
        }
    }

    initializeTimeline();
    renderProgramIcons();
    setupSwipe();

    // v9.1: Connect WebSocket for live-sync
    if (typeof ParkWS !== 'undefined') ParkWS.connect();

    // v20.2.0: Initialize floating command panel
    if (typeof CommandPanel !== 'undefined') CommandPanel.init();

    // Assistant idle nudges are opt-in only. Default CRM shell must stay silent.
    if (shouldEnableAssistantIdleHints() && typeof IdleHints !== 'undefined') IdleHints.init();

    // v10.3: Personal cabinet — click on username
    const userNameEl = document.getElementById('currentUser');
    if (userNameEl) {
        userNameEl.setAttribute('role', 'link');
        userNameEl.setAttribute('tabindex', '0');
        userNameEl.setAttribute('title', 'Відкрити профіль');
        userNameEl.addEventListener('click', openProfilePage);
        userNameEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProfilePage(); }
        });
    }

    // v32.8: Auto-open settings if navigated from sidebar (?settings=open)
    if (window.location.search.includes('settings=open') && typeof showSettings === 'function') {
        setTimeout(() => showSettings(), 300);
        // Clean URL without reload
        history.replaceState(null, '', '/');
    }

    initGlobalHeaderSearch();
    showAuthenticatedPageShell();
}

// v10.6: Personal cabinet — full rebuild with tabs, achievements, shift, inbox, progress ring
const PROFILE_ACTION_NAMES = {
    create: 'Створення', edit: 'Редагування', delete: 'Видалення', confirm: 'Підтвердження',
    cancel: 'Скасування', afisha_create: 'Афіша +', afisha_edit: 'Афіша ред.',
    afisha_delete: 'Афіша —', tasks_generated: 'Задачі згенер.', recurring_create: 'Recurring',
    afisha_move: 'Переміщення', duplicate: 'Дублювання', certificate_create: 'Сертифікат +',
    certificate_used: 'Сертифікат використ.', certificate_revoked: 'Сертифікат скасов.'
};

// Cached achievement definitions
let _achievementDefs = null;

function profileFormatTime(dateStr) {
    return new Date(dateStr).toLocaleString('uk-UA', {
        timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    });
}

function profileActivityDetail(a) {
    try {
        const d = typeof a.data === 'string' ? JSON.parse(a.data) : a.data;
        return d.label || d.title || d.program || d.bookingId || '';
    } catch { return ''; }
}

function profileRenderActivityItems(items) {
    if (!items || items.length === 0) return '<div class="profile-empty">Немає активності</div>';
    return items.map(a => {
        const actionLabel = PROFILE_ACTION_NAMES[a.action] || a.action;
        const time = profileFormatTime(a.created_at);
        const detail = profileActivityDetail(a);
        return `<div class="profile-activity-item"><span class="profile-activity-action">${actionLabel}</span><span class="profile-activity-detail">${detail}</span><span class="profile-activity-time">${time}</span></div>`;
    }).join('');
}

function _profileDelta(d) {
    if (!d || d.thisWeek === d.lastWeek) return '';
    const diff = d.thisWeek - d.lastWeek;
    const cls = diff > 0 ? 'positive' : 'negative';
    return `<span class="prof-delta ${cls}">${diff > 0 ? '+' : ''}${diff}</span>`;
}

function _profileProgressRing(done, total) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const circumference = 2 * Math.PI * 36;
    const offset = circumference - (pct / 100) * circumference;
    return `<div class="prof-ring-wrap">
        <svg class="prof-ring" viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="36" fill="none" stroke="var(--gray-100)" stroke-width="6"/>
            <circle cx="40" cy="40" r="36" fill="none" stroke="var(--primary)" stroke-width="6"
                stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
                stroke-linecap="round" transform="rotate(-90 40 40)"/>
        </svg>
        <div class="prof-ring-text"><span class="prof-ring-pct">${pct}%</span></div>
    </div>`;
}

function profileKyivDate(offsetDays = 0) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kyiv',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const parts = formatter.formatToParts(new Date()).reduce((acc, part) => {
        if (part.type !== 'literal') acc[part.type] = Number(part.value);
        return acc;
    }, {});
    const { year, month, day } = parts;
    const shifted = new Date(Date.UTC(year, month - 1, day + Number(offsetDays || 0), 12, 0, 0));
    return shifted.toISOString().slice(0, 10);
}

function profileCurrentKyivHour() {
    const hour = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Kyiv',
        hour: '2-digit',
        hourCycle: 'h23'
    }).format(new Date());
    return Number(hour) || 0;
}

function profileBuildQuickSchedulePayload(option) {
    const date = option === 'day_after' ? profileKyivDate(2) : profileKyivDate(1);
    return { deadline: `${date}T18:00:00` };
}

function profileCloseRescheduleMenus() {
    let closed = false;
    document.querySelectorAll('.prof-reschedule-menu:not(.hidden)').forEach(menu => {
        menu.classList.add('hidden');
        closed = true;
    });
    document.querySelectorAll('.prof-overdue-trigger[aria-expanded="true"]').forEach(btn => {
        btn.setAttribute('aria-expanded', 'false');
    });
    return closed;
}

function profileToggleRescheduleMenu(taskId, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const menu = document.getElementById(`profRescheduleMenu-${taskId}`);
    const trigger = event?.currentTarget;
    const shouldOpen = menu?.classList.contains('hidden');
    profileCloseRescheduleMenus();
    if (!menu || !shouldOpen) return;
    menu.classList.remove('hidden');
    trigger?.setAttribute?.('aria-expanded', 'true');
}

async function profileQuickReschedule(taskId, option, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const btn = event?.currentTarget;
    const originalText = btn?.textContent || '';
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Переносимо...';
    }
    try {
        let payload;
        if (option === 'custom') {
            const selectedDate = typeof promptModal === 'function'
                ? await promptModal('Нова дата для задачі:', { inputType: 'date', defaultValue: profileKyivDate(1) })
                : null;
            if (!selectedDate) return;
            payload = { deadline: `${selectedDate}T18:00:00` };
        } else {
            payload = profileBuildQuickSchedulePayload(option);
        }
        const headers = typeof getAuthHeaders === 'function'
            ? getAuthHeaders()
            : { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('pzp_token') || ''}` };
        const response = await fetch(`/api/tasks/${taskId}/reschedule`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ ...payload, sourceSurface: 'profile_today_overdue_menu' })
        });
        if (typeof handleAuthError === 'function' && handleAuthError(response)) return;
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.success === false) {
            throw new Error(result.error || `HTTP ${response.status}`);
        }
        if (typeof apiLogAction === 'function') apiLogAction('profile_task_reschedule', `task_${taskId}`, { option });
        if (typeof showNotification === 'function') showNotification('Задачу перенесено', 'success');
        await profileRefreshActiveTab('today');
    } catch (err) {
        console.error('[profile] quick reschedule failed:', err);
        if (typeof showNotification === 'function') showNotification('Не вдалося перенести задачу', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = originalText;
        }
        profileCloseRescheduleMenus();
    }
}

async function profileRefreshActiveTab(fallbackTab = 'today') {
    const data = await apiGetProfile();
    if (!data) return;
    window._profileData = data;
    const activeTab = document.querySelector('.prof-tab.active')?.dataset?.tab || fallbackTab;
    _profileRenderTab(activeTab, data, _achievementDefs);
}

async function openProfileModal() {
    const modal = document.getElementById('profileModal');
    const content = document.getElementById('profileContent');
    if (!modal || !content) return;
    if (!modal.classList.contains('hidden') && !(await confirmProfileModalDiscardIfDirty())) return;

    modal.classList.remove('hidden');
    rememberProfileModalState();
    content.innerHTML = '<div class="profile-loading">Завантаження...</div>';

    // Log opening
    if (typeof apiLogAction === 'function') apiLogAction('open_profile', 'cabinet');

    // Load data and achievement definitions in parallel
    const [data, achDefs] = await Promise.all([
        apiGetProfile(),
        _achievementDefs ? Promise.resolve(_achievementDefs) : apiGetAchievements()
    ]);
    if (achDefs) _achievementDefs = achDefs;

    if (!data) {
        content.innerHTML = '<div class="profile-error">Не вдалося завантажити дані</div>';
        return;
    }

    // Store data globally for tab re-renders
    window._profileData = data;

    const roleName = ROLE_NAMES[data.user.role] || data.user.role;
    const tgStatus = data.user.telegramConnected;
    const rank = data.leaderboard.rank ? `#${data.leaderboard.rank}` : '—';

    // Build the shell: header + tabs + tab content
    const streakVal = data.streak.current || 0;
    const letter = data.user.name.charAt(0).toUpperCase();

    content.innerHTML = `
        <div class="profile-header">
            <div class="profile-avatar-wrap">
                <svg class="profile-avatar-ring" viewBox="0 0 64 64">
                    <circle cx="32" cy="32" r="29" fill="none" stroke="var(--gray-200)" stroke-width="3"/>
                    <circle cx="32" cy="32" r="29" fill="none" stroke="var(--primary)" stroke-width="3"
                        stroke-dasharray="${2 * Math.PI * 29}" stroke-dashoffset="${2 * Math.PI * 29 * (1 - Math.min(streakVal, 7) / 7)}"
                        stroke-linecap="round" transform="rotate(-90 32 32)"/>
                </svg>
                <div class="profile-avatar">${letter}</div>
            </div>
            <div class="profile-info">
                <div class="profile-name">${data.user.name}</div>
                <div class="profile-meta">
                    <span class="profile-role-badge">${roleName}</span>
                    <span class="profile-tg-badge ${tgStatus ? 'connected' : ''}">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>
                        ${tgStatus ? '' : ''}
                    </span>
                </div>
            </div>
            <div class="profile-header-stats">
                <div class="prof-mini-stat">
                    <span class="prof-mini-val prof-val-points">${data.points.permanentTotal}</span>
                    <span class="prof-mini-lbl">балів</span>
                </div>
                <div class="prof-mini-stat">
                    <span class="prof-mini-val prof-val-rank">${rank}</span>
                    <span class="prof-mini-lbl">ранг</span>
                </div>
                <div class="prof-mini-stat">
                    <span class="prof-mini-val prof-val-streak">${streakVal}</span>
                    <span class="prof-mini-lbl">стрік</span>
                </div>
            </div>
        </div>

        <div class="prof-tabs" role="tablist">
            <button class="prof-tab active" data-tab="today" role="tab">Сьогодні</button>
            <button class="prof-tab" data-tab="game" role="tab">Гра</button>
            <button class="prof-tab" data-tab="tasks" role="tab">Задачі</button>
            <button class="prof-tab" data-tab="stats" role="tab">Стати</button>
            <button class="prof-tab" data-tab="settings" role="tab">Налашт.</button>
        </div>

        <div class="prof-tab-content" id="profTabContent"></div>
    `;

    // Tab switching
    content.querySelectorAll('.prof-tab').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!(await confirmProfileModalDiscardIfDirty())) return;
            content.querySelectorAll('.prof-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            _profileRenderTab(btn.dataset.tab, window._profileData || data, achDefs);
            rememberProfileModalState();
            if (typeof apiLogAction === 'function') apiLogAction('profile_tab', btn.dataset.tab);
        });
    });

    // Render "Today" tab by default
    _profileRenderTab('today', data, achDefs);
    rememberProfileModalState();
    window._profileActivityOffset = data.recentActivity.length;
}

function _profileRenderTab(tabName, data, achDefs) {
    const container = document.getElementById('profTabContent');
    if (!container) return;

    switch (tabName) {
        case 'today': container.innerHTML = _profileTabToday(data); break;
        case 'game': _profileTabGame(container, data); break;
        case 'tasks': container.innerHTML = _profileTabTasks(data); break;
        case 'stats': container.innerHTML = _profileTabStats(data, achDefs); break;
        case 'settings': container.innerHTML = _profileTabSettings(data); break;
    }
}

// ==========================================
// TAB: СЬОГОДНІ
// ==========================================
function _profileTabToday(data) {
    const dp = data.dayProgress;
    const totalDayTasks = dp.tasksDoneToday + dp.tasksRemaining;

    // Shift block
    let shiftHTML = '';
    if (data.todayShift) {
        const s = data.todayShift;
        const statusMap = { working: 'На зміні', dayoff: 'Вихідний', vacation: 'Відпустка', sick: 'Лікарняний' };
        const statusCls = s.status === 'working' ? 'active' : 'off';
        const segments = Array.isArray(s.segments) ? s.segments : (Array.isArray(s.blocks) ? s.blocks : []);
        const shiftBlocks = segments.length
            ? segments.map(segment => `${escapeHtml(segment.start || '')}–${escapeHtml(segment.end || '')}${segment.professionKey ? ` · ${escapeHtml(segment.professionKey)}` : ''}`).join('<br>')
            : (s.start ? `${s.start} — ${s.end}` : '');
        shiftHTML = `<div class="prof-shift ${statusCls}">
            <div class="prof-shift-status">${statusMap[s.status] || s.status}</div>
            ${shiftBlocks ? `<div class="prof-shift-time">${shiftBlocks}</div>` : ''}
            ${s.note ? `<div class="prof-shift-note">${s.note}</div>` : ''}
        </div>`;
    }

    // Day progress ring
    const progressHTML = `<div class="prof-day-progress">
        ${_profileProgressRing(dp.tasksDoneToday, totalDayTasks)}
        <div class="prof-day-nums">
            <div class="prof-day-num-row"><span class="prof-day-done">${dp.tasksDoneToday}</span> виконано</div>
            <div class="prof-day-num-row"><span class="prof-day-rem">${dp.tasksRemaining}</span> залишилось</div>
            <div class="prof-day-num-row">${dp.bookingsToday} бронювань</div>
        </div>
    </div>`;

    // Inbox: overdue + upcoming as actionable items
    let inboxHTML = '';
    const inboxItems = [];
    if (data.tasks.overdueList && data.tasks.overdueList.length > 0) {
        data.tasks.overdueList.forEach(t => {
            const ago = Math.round((new Date() - new Date(t.deadline)) / 3600000);
            const urgentCls = t.priority === 'urgent' || t.priority === 'critical' ? ' urgent' : '';
            inboxItems.push(`<div class="prof-inbox-item danger${urgentCls}" data-task-id="${t.id}">
                <span class="prof-inbox-icon">!</span>
                <div class="prof-inbox-body">
                    <div class="prof-inbox-title">${_escHtml(t.title)}</div>
                    <div class="prof-reschedule-wrap">
                        <button class="prof-inbox-meta prof-overdue-trigger" type="button" aria-haspopup="menu" aria-expanded="false" onclick="profileToggleRescheduleMenu(${t.id}, event)">Прострочено ${ago} год <span>Перенести</span></button>
                        <div class="prof-reschedule-menu hidden" id="profRescheduleMenu-${t.id}" role="menu" aria-label="Перенести прострочену задачу">
                            <button type="button" role="menuitem" onclick="profileQuickReschedule(${t.id}, 'tomorrow', event)">На завтра</button>
                            <button type="button" role="menuitem" onclick="profileQuickReschedule(${t.id}, 'day_after', event)">На післязавтра</button>
                            <button type="button" role="menuitem" onclick="profileQuickReschedule(${t.id}, 'custom', event)">Обрати дату</button>
                        </div>
                    </div>
                </div>
                <div class="prof-inbox-actions">
                    <button class="prof-inbox-btn done" onclick="profileQuickStatus(${t.id},'done')" title="Готово">&#10003;</button>
                    <button class="prof-inbox-btn progress" onclick="profileQuickStatus(${t.id},'in_progress')" title="В роботу">&#9654;</button>
                </div>
            </div>`);
        });
    }
    if (data.tasks.upcoming && data.tasks.upcoming.length > 0) {
        data.tasks.upcoming.forEach(t => {
            const dl = new Date(t.deadline);
            const mins = Math.round((dl - new Date()) / 60000);
            const timeStr = mins < 60 ? `${mins} хв` : `${Math.round(mins / 60)} год`;
            const urgentCls = t.priority === 'urgent' || t.priority === 'critical' ? ' urgent' : '';
            inboxItems.push(`<div class="prof-inbox-item warning${urgentCls}" data-task-id="${t.id}">
                <span class="prof-inbox-icon">&#9202;</span>
                <div class="prof-inbox-body">
                    <div class="prof-inbox-title">${_escHtml(t.title)}</div>
                    <div class="prof-inbox-meta">Дедлайн через ${timeStr}</div>
                </div>
                <div class="prof-inbox-actions">
                    <button class="prof-inbox-btn done" onclick="profileQuickStatus(${t.id},'done')" title="Готово">&#10003;</button>
                    <button class="prof-inbox-btn progress" onclick="profileQuickStatus(${t.id},'in_progress')" title="В роботу">&#9654;</button>
                </div>
            </div>`);
        });
    }

    if (inboxItems.length > 0) {
        inboxHTML = `<div class="prof-section">
            <h4>Потребують уваги <span class="prof-badge-count">${inboxItems.length}</span></h4>
            <div class="prof-inbox">${inboxItems.join('')}</div>
        </div>`;
    } else {
        inboxHTML = `<div class="prof-section"><div class="prof-all-clear">Все під контролем!</div></div>`;
    }

    // Admin: team overview
    let teamHTML = '';
    if (data.team && data.team.length > 0) {
        const teamItems = data.team.map(m => {
            const hasOverdue = m.overdueTasks > 0;
            return `<div class="prof-team-member ${hasOverdue ? 'has-overdue' : ''}">
                <div class="prof-team-avatar">${m.name.charAt(0)}</div>
                <div class="prof-team-info">
                    <div class="prof-team-name">${m.name}</div>
                    <div class="prof-team-tasks">${m.openTasks} задач${hasOverdue ? ` / <span class="danger">${m.overdueTasks} протерм.</span>` : ''}</div>
                </div>
            </div>`;
        }).join('');
        teamHTML = `<div class="prof-section">
            <h4>Команда</h4>
            <div class="prof-team-grid">${teamItems}</div>
        </div>`;
    }

    return `${shiftHTML}${progressHTML}${inboxHTML}${teamHTML}`;
}

// ==========================================
// TAB: ЗАДАЧІ (with inline actions)
// ==========================================
function _profileTabTasks(data) {
    if (!data.myTasks || data.myTasks.length === 0) {
        return '<div class="prof-section"><div class="prof-all-clear">Немає активних задач</div></div>';
    }

    const taskItems = data.myTasks.map(t => {
        const icon = t.isBlocked ? '&#128274;' : (t.status === 'in_progress' ? '&#9673;' : (t.isOverdue ? '&#9888;' : '&#9675;'));
        const cls = t.isOverdue ? 'overdue' : (t.isBlocked ? 'blocked' : t.status);
        const deadlineStr = t.deadline ? profileFormatTime(t.deadline) : '';
        const priorityCls = t.priority === 'urgent' || t.priority === 'critical'
            ? 'urgent-priority high-priority'
            : (t.priority === 'high' ? 'high-priority' : '');
        const blockedLabel = t.isBlocked ? '<span class="prof-blocked-lbl">Заблоковано</span>' : '';

        // Action buttons based on current status
        let actionsHTML = '';
        if (!t.isBlocked) {
            if (t.status === 'todo') {
                actionsHTML = `<button class="prof-task-btn start" onclick="profileQuickStatus(${t.id},'in_progress')" title="Почати">&#9654;</button>
                    <button class="prof-task-btn done" onclick="profileQuickStatus(${t.id},'done')" title="Готово">&#10003;</button>`;
            } else if (t.status === 'in_progress') {
                actionsHTML = `<button class="prof-task-btn done" onclick="profileQuickStatus(${t.id},'done')" title="Готово">&#10003;</button>`;
            }
        }

        return `<div class="prof-task-row ${cls} ${priorityCls}" data-task-id="${t.id}">
            <span class="prof-task-icon">${icon}</span>
            <div class="prof-task-body">
                <div class="prof-task-title">${t.title}</div>
                <div class="prof-task-meta">${deadlineStr}${blockedLabel}<span class="prof-task-cat">${t.category || ''}</span></div>
            </div>
            <div class="prof-task-actions">${actionsHTML}</div>
        </div>`;
    }).join('');

    // Task summary chips
    const summaryHTML = `<div class="prof-task-summary">
        <span class="prof-chip todo">${data.tasks.assigned || 0} очікує</span>
        <span class="prof-chip progress">${data.tasks.in_progress || 0} в роботі</span>
        <span class="prof-chip done">${data.tasks.done || 0} готово</span>
        ${data.tasks.overdue > 0 ? `<span class="prof-chip overdue">${data.tasks.overdue} протерм.</span>` : ''}
    </div>`;

    return `<div class="prof-section">${summaryHTML}<div class="prof-tasks-list">${taskItems}</div></div>`;
}

// ==========================================
// TAB: СТАТИСТИКА (points, bookings, certs, achievements)
// ==========================================
function _profileTabStats(data, achDefs) {
    const bk = data.bookings;
    const monthName = new Date(data.points.month + '-01').toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' });

    // Stats summary with deltas
    const statsHTML = `<div class="prof-stats-grid">
        <div class="prof-stat-card">
            <div class="prof-stat-num">${bk ? bk.total : 0}${_profileDelta(data.deltas.bookings)}</div>
            <div class="prof-stat-lbl">Бронювань</div>
        </div>
        <div class="prof-stat-card">
            <div class="prof-stat-num">${data.tasks.done || 0}${_profileDelta(data.deltas.tasksDone)}</div>
            <div class="prof-stat-lbl">Виконано</div>
        </div>
        <div class="prof-stat-card">
            <div class="prof-stat-num">${data.tasks.total || 0}</div>
            <div class="prof-stat-lbl">Всього задач</div>
        </div>
        <div class="prof-stat-card">
            <div class="prof-stat-num">${data.certificates.total || 0}</div>
            <div class="prof-stat-lbl">Сертифікатів</div>
        </div>
    </div>`;

    // Points
    let txHTML = '';
    if (data.pointTransactions && data.pointTransactions.length > 0) {
        const reasonMap = { ON_TIME: 'Вчасно', EARLY: 'Раніше строку', HIGH_PRIORITY: 'Пріоритетна', LATE_MINOR: 'Невелике запізн.', LATE_MAJOR: 'Значне запізн.', NO_STATUS_UPDATE: 'Без оновлення', manual: 'Ручне' };
        txHTML = data.pointTransactions.map(tx => {
            const sign = tx.points > 0 ? '+' : '';
            const cls = tx.points >= 0 ? 'positive' : 'negative';
            const reasonLabel = reasonMap[tx.reason] || tx.reason || '';
            const taskLink = tx.taskTitle ? ` (${tx.taskTitle})` : '';
            return `<div class="profile-points-row"><span>${reasonLabel}${taskLink}</span><span class="profile-points-val ${cls}">${sign}${tx.points}</span></div>`;
        }).join('');
    }
    const pointsHTML = `<div class="prof-section">
        <h4>Бали за ${monthName}</h4>
        <div class="profile-points-row"><span>Місячні</span><span class="profile-points-val ${data.points.monthly >= 0 ? 'positive' : 'negative'}">${data.points.monthly > 0 ? '+' : ''}${data.points.monthly}</span></div>
        <div class="profile-points-row"><span>Постійні (всього)</span><span class="profile-points-val positive">+${data.points.permanentTotal}</span></div>
        ${txHTML ? '<div class="profile-tx-divider">Останні нарахування</div>' + txHTML : ''}
    </div>`;

    // Task stats
    let taskStatsHTML = '';
    if (data.tasks.avgCompletionHours !== null || data.tasks.escalations > 0 || (data.tasks.byCategory && data.tasks.byCategory.length > 0)) {
        taskStatsHTML = `<div class="prof-section"><h4>Деталі задач</h4>
            ${data.tasks.avgCompletionHours !== null ? `<div class="profile-stat-row">Серед. час виконання: <strong>${data.tasks.avgCompletionHours} год</strong></div>` : ''}
            ${data.tasks.escalations > 0 ? `<div class="profile-stat-row">Ескалацій: <strong>${data.tasks.escalations}</strong></div>` : ''}
            ${data.tasks.escalationHistory && data.tasks.escalationHistory.length > 0 ?
                data.tasks.escalationHistory.map(e => `<div class="prof-escalation-item">${e.title} — рівень ${e.from} &#8594; ${e.to} (${profileFormatTime(e.at)})</div>`).join('') : ''}
            ${data.tasks.byCategory && data.tasks.byCategory.length > 0 ? `<div class="profile-stat-row">По категоріях: ${data.tasks.byCategory.map(c => `<span class="profile-cat-chip">${c.category} (${c.count})</span>`).join(' ')}</div>` : ''}
        </div>`;
    }

    // Bookings detail
    let bookingsHTML = '';
    if (bk && bk.total > 0) {
        const confirmed = bk.byStatus.confirmed || 0;
        const preliminary = bk.byStatus.preliminary || 0;
        const cancelled = bk.byStatus.cancelled || 0;
        bookingsHTML = `<div class="prof-section"><h4>Бронювання</h4>
            <div class="profile-points-row"><span>Підтверджених</span><span class="profile-points-val positive">${confirmed}</span></div>
            <div class="profile-points-row"><span>Попередніх</span><span class="profile-points-val">${preliminary}</span></div>
            ${cancelled > 0 ? `<div class="profile-points-row"><span>Скасованих</span><span class="profile-points-val negative">${cancelled}</span></div>` : ''}
            ${data.showRevenue ? `<div class="profile-points-row"><span>Виручка</span><span class="profile-points-val positive">${bk.revenue.toLocaleString('uk-UA')} &#8372;</span></div>` : ''}
            ${bk.topPrograms && bk.topPrograms.length > 0 ? `<div class="profile-stat-row">Топ: ${bk.topPrograms.map(p => `${p.program_name} (${p.count})`).join(', ')}</div>` : ''}
        </div>`;
    }

    // Certificates detail
    let certsHTML = '';
    if (data.certificates && data.certificates.total > 0) {
        const cert = data.certificates;
        const recentHTML = cert.recentList && cert.recentList.length > 0 ?
            cert.recentList.slice(0, 5).map(c => {
                const stCls = c.status === 'active' ? 'positive' : (c.status === 'used' ? '' : 'negative');
                const stLabel = c.status === 'active' ? 'Активний' : (c.status === 'used' ? 'Використаний' : c.status);
                return `<div class="profile-points-row"><span>${_escHtml(c.code)} — ${_escHtml(c.name)}</span><span class="profile-points-val ${stCls}">${stLabel}</span></div>`;
            }).join('') : '';
        certsHTML = `<div class="prof-section"><h4>Сертифікати видані (${cert.total})</h4>
            ${cert.byStatus.active ? `<div class="profile-points-row"><span>Активних</span><span class="profile-points-val positive">${cert.byStatus.active}</span></div>` : ''}
            ${cert.byStatus.used ? `<div class="profile-points-row"><span>Використаних</span><span class="profile-points-val">${cert.byStatus.used}</span></div>` : ''}
            ${recentHTML ? '<div class="profile-tx-divider">Останні</div>' + recentHTML : ''}
        </div>`;
    }

    // Achievements
    let achievementsHTML = '';
    if (achDefs) {
        const unlockedKeys = new Set((data.achievements || []).map(a => a.key));
        const allKeys = Object.keys(achDefs);
        const achItems = allKeys.map(key => {
            const def = achDefs[key];
            const unlocked = unlockedKeys.has(key);
            return `<div class="prof-achievement ${unlocked ? 'unlocked' : 'locked'}">
                <span class="prof-ach-icon">${def.icon || '?'}</span>
                <div class="prof-ach-info">
                    <div class="prof-ach-title">${def.title}</div>
                    <div class="prof-ach-desc">${def.desc}</div>
                </div>
            </div>`;
        }).join('');
        achievementsHTML = `<div class="prof-section"><h4>Досягнення <span class="prof-badge-count">${unlockedKeys.size}/${allKeys.length}</span></h4>
            <div class="prof-achievements">${achItems}</div>
        </div>`;
    }

    // Activity
    const activityItemsHTML = profileRenderActivityItems(data.recentActivity);
    const activityHTML = `<div class="prof-section">
        <h4>Остання активність</h4>
        <div id="profileActivityList" class="profile-activity">${activityItemsHTML}</div>
        ${data.recentActivity.length >= 20 ? '<button class="btn-profile-load-more" onclick="profileLoadMoreActivity()">Показати ще</button>' : ''}
    </div>`;

    return `${statsHTML}${pointsHTML}${taskStatsHTML}${bookingsHTML}${certsHTML}${achievementsHTML}${activityHTML}`;
}

// ==========================================
// TAB: НАЛАШТУВАННЯ
// ==========================================
function _profileTabSettings(data) {
    const tgStatus = data.user.telegramConnected;
    const createdAt = new Date(data.user.createdAt).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });

    return `
        <div class="prof-section">
            <div class="prof-user-details">
                <div class="profile-points-row"><span>Користувач</span><span class="profile-points-val">${data.user.username}</span></div>
                <div class="profile-points-row"><span>Зареєстрований</span><span class="profile-points-val">${createdAt}</span></div>
                <div class="profile-points-row"><span>Telegram</span><span class="profile-points-val ${tgStatus ? 'positive' : ''}">${tgStatus ? 'Підключено' : 'Не підключено'}</span></div>
            </div>
        </div>
        <div class="prof-section">
            <h4>Змінити пароль</h4>
            <div id="profilePasswordForm" class="profile-password-form" style="display:block;background:transparent;border:none;padding:0;">
                <input type="password" id="profileCurrentPwd" placeholder="Поточний пароль" autocomplete="current-password">
                <input type="password" id="profileNewPwd" placeholder="Новий пароль (мін. 6 символів)" autocomplete="new-password">
                <div class="profile-pwd-actions">
                    <button class="btn-profile-save" onclick="profileChangePassword()">Зберегти</button>
                </div>
                <div id="profilePwdError" class="profile-pwd-error hidden"></div>
                <div id="profilePwdSuccess" class="profile-pwd-success hidden"></div>
            </div>
        </div>
        <div class="prof-section">
            <button class="btn-profile-action prof-logout-btn" onclick="logout()">Вийти з акаунту</button>
        </div>`;
}

// ==========================================
// TAB: ГРА (Gamification — achievements, shop, inventory, leaderboard)
// ==========================================
let _gameTabData = null;
let _gameSubTab = 'achievements';

function _profileGameIsCreator() {
    return getRealUserRole(AppState.currentUser) === 'creator';
}

function _gameSubTabLock(tab) {
    if ((tab === 'inventory' || tab === 'shop') && !_profileGameIsCreator()) {
        return { code: 'creator_only' };
    }
    return null;
}

function _renderGameComingSoon(tab) {
    const copy = tab === 'shop'
        ? {
            title: 'Магазин скоро',
            message: 'Магазин відкритий тільки для Creator під час перевірки балансу та товарів. Для команди покупки закриті до повного запуску.'
        }
        : {
            title: 'Інвентар скоро',
            message: 'Інвентар відкритий тільки для Creator під час підготовки нагород. Для команди розділ поки показує контрольований soon-стан.'
        };
    return `
        <div class="game-coming-soon">
            <div class="game-coming-soon-ribbon">скоро</div>
            <div class="game-coming-soon-kicker">Creator preview</div>
            <div class="game-coming-soon-title">${copy.title}</div>
            <div class="game-coming-soon-text">${copy.message}</div>
        </div>`;
}

async function _profileTabGame(container, data) {
    container.innerHTML = '<div class="profile-loading">Завантаження...</div>';

    const username = data.user.username;
    const [profile, achievements, shop, leaderboard] = await Promise.all([
        apiGamificationProfile(username),
        apiGamificationAchievements(),
        apiGamificationShop(),
        apiGamificationLeaderboard('xp')
    ]);

    _gameTabData = { profile, achievements, shop, leaderboard, username };

    if (!profile) {
        container.innerHTML = `
            <div class="prof-game-empty">
                <div class="prof-game-empty-icon">🏆</div>
                <div class="prof-game-empty-title">Система гейміфікації</div>
                <div class="prof-game-empty-desc">Досягнення, рівні та нагороди скоро будуть доступні</div>
                <div class="prof-game-empty-actions">
                    <a href="/game" class="prof-game-btn prof-game-btn-primary">Міні-гра</a>
                    <a href="/profile" class="prof-game-btn prof-game-btn-secondary">Повний профіль</a>
                </div>
            </div>`;
        return;
    }

    _gameSubTab = 'achievements';
    _renderGameTab(container);
}

function _renderGameTab(container) {
    const { profile, achievements, shop, leaderboard } = _gameTabData;
    const p = profile; // API returns flat object with profile, currency, level, etc.
    const profileData = p.profile || {};
    const level = p.level || { level: 1, title: 'Новачок', xp: 0, xpForNext: 100 };
    const coins = p.currency ? p.currency.coins : 0;
    const xp = profileData.xp || 0;

    // XP progress
    const xpForCurrent = level.xpForCurrent || 0;
    const xpForNext = level.xpForNext || 100;
    const xpProgress = xpForNext > xpForCurrent ? Math.min(100, Math.round((xp - xpForCurrent) / (xpForNext - xpForCurrent) * 100)) : 100;

    const headerHTML = `
        <div class="game-profile-header">
            <div class="game-level-badge">Lv.${level.level}</div>
            <div class="game-profile-info">
                <div class="game-title">${level.title || 'Новачок'}</div>
                <div class="game-xp-bar">
                    <div class="game-xp-fill" style="width:${xpProgress}%"></div>
                </div>
                <div class="game-xp-text">${xp} / ${xpForNext} XP</div>
            </div>
            <div class="game-coins">${coins} <span class="game-coin-icon">&#x1FA99;</span></div>
        </div>
    `;

    // Sub-tabs
    const subTabs = [
        { key: 'achievements', label: 'Досягнення' },
        { key: 'inventory', label: 'Інвентар' },
        { key: 'shop', label: 'Магазин' },
        { key: 'leaderboard', label: 'Лідери' }
    ];
    const subTabsHTML = `<div class="game-sub-tabs">${subTabs.map(t => {
        const locked = _gameSubTabLock(t.key);
        const classes = [
            'game-sub-tab',
            _gameSubTab === t.key ? 'active' : '',
            locked ? 'is-soon is-locked' : ''
        ].filter(Boolean).join(' ');
        const attrs = locked ? ' data-profile-locked="true" data-profile-soon="скоро"' : '';
        return `<button class="${classes}" onclick="_switchGameSubTab('${t.key}')"${attrs}>${t.label}</button>`;
    }).join('')}</div>`;

    let contentHTML = '';
    if (_gameSubTabLock(_gameSubTab)) {
        contentHTML = _renderGameComingSoon(_gameSubTab);
    } else {
        switch (_gameSubTab) {
            case 'achievements': contentHTML = _renderGameAchievements(achievements, profile); break;
            case 'inventory': contentHTML = _renderGameInventory(); break;
            case 'shop': contentHTML = _renderGameShop(shop, coins); break;
            case 'leaderboard': contentHTML = _renderGameLeaderboard(leaderboard); break;
        }
    }

    container.innerHTML = headerHTML + subTabsHTML + `<div class="game-content">${contentHTML}</div>`;
}

function _switchGameSubTab(tab) {
    _gameSubTab = tab;
    const container = document.getElementById('profTabContent');
    if (container && _gameTabData) _renderGameTab(container);
}

function _renderGameAchievements(achievements, profile) {
    if (!achievements || !Array.isArray(achievements) || achievements.length === 0) {
        return '<div class="profile-empty">Немає досягнень</div>';
    }
    const items = achievements;
    if (items.length === 0) return '<div class="profile-empty">Немає досягнень</div>';

    const unlocked = items.filter(a => a.unlocked).length;
    const rarityColors = { common: '#9CA3AF', uncommon: '#34D399', rare: '#60A5FA', epic: '#A78BFA', legendary: '#FBBF24' };

    const html = items.map(a => {
        const cls = a.unlocked ? 'unlocked' : 'locked';
        const rarityColor = rarityColors[a.rarity] || '#9CA3AF';
        const rewardText = a.reward_type === 'coins' ? `${a.reward_value} монет` :
                          a.reward_type === 'xp' ? `${a.reward_value} XP` : (a.reward_value || '');
        return `<div class="game-ach-card ${cls}">
            <div class="game-ach-icon">${a.icon || '?'}</div>
            <div class="game-ach-body">
                <div class="game-ach-name">${a.name || a.key}</div>
                <div class="game-ach-desc">${a.description || ''}</div>
                ${rewardText ? `<div class="game-ach-reward">${rewardText}</div>` : ''}
            </div>
            <div class="game-ach-rarity" style="color:${rarityColor}">${a.rarity || ''}</div>
        </div>`;
    }).join('');

    return `<div class="game-ach-header">${unlocked}/${items.length} відкрито</div>${html}`;
}

function _renderGameInventory() {
    if (_gameSubTabLock('inventory')) {
        return _renderGameComingSoon('inventory');
    }
    const profile = _gameTabData.profile || {};
    const inventory = profile.inventory || [];
    const equipped = profile.equipped || [];

    if (inventory.length === 0) {
        return '<div class="profile-empty">Інвентар порожній. Придбайте предмети в магазині!</div>';
    }

    const equippedIds = new Set(equipped.map(e => e.item_id));

    const html = inventory.map(item => {
        const isEquipped = equippedIds.has(item.id || item.item_id);
        return `<div class="game-inv-item ${isEquipped ? 'equipped' : ''}" onclick="_gameToggleEquip(${item.id || item.item_id}, '${item.type || 'badge'}', ${isEquipped})">
            <div class="game-inv-icon">${item.icon || '?'}</div>
            <div class="game-inv-name">${item.name || ''}</div>
            ${isEquipped ? '<div class="game-inv-badge">Активно</div>' : ''}
        </div>`;
    }).join('');

    return `<div class="game-inv-grid">${html}</div>`;
}

function _renderGameShop(shop, coins) {
    if (_gameSubTabLock('shop')) {
        return _renderGameComingSoon('shop');
    }
    if (!shop || !Array.isArray(shop) || shop.length === 0) {
        return '<div class="profile-empty">Магазин порожній</div>';
    }

    const items = shop;
    const html = items.map(item => {
        const owned = item.owned;
        const canBuy = !owned && coins >= (item.price_coins || 0);
        const featured = item.is_featured ? 'featured' : '';
        return `<div class="game-shop-item ${featured} ${owned ? 'owned' : ''}">
            <div class="game-shop-icon">${item.icon || '?'}</div>
            <div class="game-shop-body">
                <div class="game-shop-name">${item.name || ''}</div>
                <div class="game-shop-desc">${item.description || ''}</div>
                <div class="game-shop-price">${item.price_coins || 0} <span class="game-coin-icon">&#x1FA99;</span></div>
            </div>
            <div class="game-shop-action">
                ${owned ? '<span class="game-shop-owned">Придбано</span>' :
                  `<button class="game-shop-buy ${canBuy ? '' : 'disabled'}" onclick="_gameBuyItem(${item.id})" ${canBuy ? '' : 'disabled'}>Купити</button>`}
            </div>
        </div>`;
    }).join('');

    return html;
}

function _renderGameLeaderboard(leaderboard) {
    if (!leaderboard || !Array.isArray(leaderboard) || leaderboard.length === 0) {
        return '<div class="profile-empty">Лідерборд порожній</div>';
    }

    const items = leaderboard;
    const medalColors = ['#FBBF24', '#CBD5E0', '#CD7F32'];
    const currentUser = AppState.currentUser?.username;

    const html = items.map((u, i) => {
        const medal = i < 3 ? `<span style="color:${medalColors[i]}; font-size:18px">${['&#x1F947;','&#x1F948;','&#x1F949;'][i]}</span>` : `<span class="game-lb-rank">${i + 1}</span>`;
        const isMe = u.username === currentUser;
        return `<div class="game-lb-row ${isMe ? 'me' : ''}">
            ${medal}
            <div class="game-lb-name">${u.display_name || u.username}${isMe ? ' (ви)' : ''}</div>
            <div class="game-lb-stats">
                <span class="game-lb-xp">Lv.${u.level || 1}</span>
                <span class="game-lb-val">${u.xp || 0} XP</span>
            </div>
        </div>`;
    }).join('');

    // Sort buttons
    const sortBtns = `<div class="game-lb-sort">
        <button class="game-sub-tab active" onclick="_gameLeaderboardSort('xp')">XP</button>
        <button class="game-sub-tab" onclick="_gameLeaderboardSort('coins')">Монети</button>
        <button class="game-sub-tab" onclick="_gameLeaderboardSort('achievements')">Досягнення</button>
    </div>`;

    return sortBtns + html;
}

async function _gameBuyItem(shopItemId) {
    if (_gameSubTabLock('shop')) {
        if (typeof showNotification === 'function') showNotification('Магазин ще закритий', 'warning');
        return;
    }
    const result = await apiGamificationBuy(shopItemId);
    if (result.success) {
        if (typeof showNotification === 'function') showNotification('Придбано!', 'success');
        // Refresh game tab
        const container = document.getElementById('profTabContent');
        if (container && window._profileData) _profileTabGame(container, window._profileData);
    } else {
        if (typeof showNotification === 'function') showNotification(result.error || 'Помилка покупки', 'error');
    }
}

async function _gameToggleEquip(itemId, type, isEquipped) {
    if (_gameSubTabLock('inventory')) {
        if (typeof showNotification === 'function') showNotification('Інвентар ще закритий', 'warning');
        return;
    }
    let result;
    if (isEquipped) {
        result = await apiGamificationUnequip(type);
    } else {
        result = await apiGamificationEquip(itemId);
    }
    if (result.success) {
        const container = document.getElementById('profTabContent');
        if (container && window._profileData) _profileTabGame(container, window._profileData);
    }
}

async function _gameLeaderboardSort(sortBy) {
    const lb = await apiGamificationLeaderboard(sortBy);
    if (lb && _gameTabData) {
        _gameTabData.leaderboard = lb;
        _gameSubTab = 'leaderboard';
        const container = document.getElementById('profTabContent');
        if (container) _renderGameTab(container);
    }
}

// Quick status change from profile
async function profileQuickStatus(taskId, status) {
    const btn = event.target;
    btn.disabled = true;
    btn.style.opacity = '0.5';
    if (typeof apiLogAction === 'function') apiLogAction('quick_task_status', `task_${taskId}`, { status });
    const result = await apiQuickTaskStatus(taskId, status);
    if (result.success) {
        // Re-render by removing the task row or updating icon
        const row = document.querySelector(`[data-task-id="${taskId}"]`);
        if (row) {
            row.style.transition = 'opacity 0.3s, transform 0.3s';
            row.style.opacity = '0';
            row.style.transform = 'translateX(20px)';
            setTimeout(() => row.remove(), 300);
        }
        // Update day progress if visible
        const dp = window._profileData?.dayProgress;
        if (dp && status === 'done') {
            dp.tasksDoneToday++;
            dp.tasksRemaining = Math.max(0, dp.tasksRemaining - 1);
        }
    } else {
        btn.disabled = false;
        btn.style.opacity = '1';
    }
}

function profileShowPasswordForm() {
    const form = document.getElementById('profilePasswordForm');
    if (form) {
        form.classList.remove('hidden');
        document.getElementById('profileCurrentPwd')?.focus();
        rememberProfileModalState();
    }
}

async function profileChangePassword() {
    const current = document.getElementById('profileCurrentPwd')?.value;
    const newPwd = document.getElementById('profileNewPwd')?.value;
    const errEl = document.getElementById('profilePwdError');
    const okEl = document.getElementById('profilePwdSuccess');
    errEl.classList.add('hidden');
    okEl.classList.add('hidden');

    if (!current || !newPwd) {
        errEl.textContent = 'Заповніть обидва поля';
        errEl.classList.remove('hidden');
        return;
    }
    if (newPwd.length < 6) {
        errEl.textContent = 'Мінімум 6 символів';
        errEl.classList.remove('hidden');
        return;
    }

    const result = await apiChangePassword(current, newPwd);
    if (result.success) {
        okEl.textContent = 'Пароль змінено!';
        okEl.classList.remove('hidden');
        document.getElementById('profileCurrentPwd').value = '';
        document.getElementById('profileNewPwd').value = '';
        rememberProfileModalState();
        setTimeout(() => {
            document.getElementById('profilePasswordForm')?.classList.add('hidden');
            okEl.classList.add('hidden');
        }, 2000);
    } else {
        errEl.textContent = result.error || 'Помилка зміни пароля';
        errEl.classList.remove('hidden');
    }
}

async function profileLoadMoreActivity() {
    const list = document.getElementById('profileActivityList');
    const btn = document.querySelector('.btn-profile-load-more');
    if (!list) return;

    const offset = window._profileActivityOffset || 0;
    const data = await apiGetProfileActivity({ limit: 20, offset });
    if (!data || !data.items || data.items.length === 0) {
        if (btn) btn.textContent = 'Більше немає';
        return;
    }

    list.insertAdjacentHTML('beforeend', profileRenderActivityItems(data.items));
    window._profileActivityOffset = offset + data.items.length;
    if (data.items.length < 20 && btn) btn.remove();
}

// v22.5: Daily login reward check
async function checkDailyLogin() {
    try {
        // The authenticated production QA runner is read-only and must not claim rewards.
        if (window.__eventGenixLiveQaReadOnly === true) return;
        const token = localStorage.getItem('pzp_token');
        if (!token) return;
        const r = await fetch('/api/wallet/daily-login', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
        });
        if (!r.ok) return;
        const data = await r.json();
        if (data.alreadyClaimed) return;
        showDailyLoginPopup(data);
    } catch (e) { /* silent */ }
}

function showDailyLoginPopup(data) {
    const REWARDS = [10, 15, 20, 25, 30, 40, 50];
    let streakHtml = '';
    for (let i = 0; i < 7; i++) {
        const isClaimed = i < data.dayIndex - 1;
        const isToday = i === data.dayIndex - 1;
        streakHtml += `
        <div class="streak-day ${isClaimed ? 'claimed' : ''} ${isToday ? 'today' : ''}">
            <div class="streak-coins">${REWARDS[i]}</div>
            <div class="streak-label">Д${i + 1}</div>
        </div>`;
    }

    const popup = document.createElement('div');
    popup.className = 'daily-login-popup';
    popup.innerHTML = `
    <div class="daily-login-card">
        <div class="daily-login-title">Щоденний бонус!</div>
        <div class="daily-login-subtitle">День ${data.loginStreak} серії</div>
        <div class="daily-streak-row">${streakHtml}</div>
        <div class="daily-login-reward">+${data.reward} монет</div>
        ${data.bonusItem ? `<div class="daily-login-bonus">Бонус: ${data.bonusItem}!</div>` : ''}
        <button class="daily-login-close" onclick="this.closest('.daily-login-popup').remove()">Забрати</button>
    </div>`;
    document.body.appendChild(popup);

    // Auto-close after 10s
    setTimeout(() => { if (popup.parentNode) popup.remove(); }, 10000);
}

// v0.55.40: shared theme switch lives in the top-right header near the user name.
function isCrmDarkThemeActive() {
    return document.body.classList.contains('dark-mode') ||
        document.documentElement.getAttribute('data-theme') === 'dark';
}

function applyCrmThemeMode(isDark, persist = true) {
    const dark = !!isDark;
    document.body.classList.toggle('dark-mode', dark);
    document.body.classList.remove('night-auto');
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    if (persist) localStorage.setItem('pzp_dark_mode', String(dark));
    if (typeof AppState !== 'undefined') AppState.darkMode = dark;

    syncHeaderThemeToggle();
    window.dispatchEvent(new CustomEvent('crm:theme-changed', { detail: { dark } }));
}

function syncHeaderThemeToggle() {
    const btn = document.getElementById('headerThemeToggle');
    if (!btn) return;
    const isDark = isCrmDarkThemeActive();
    btn.classList.toggle('is-dark', isDark);
    btn.setAttribute('aria-pressed', String(isDark));
    btn.setAttribute('aria-label', isDark ? 'Перемкнути на світлу тему' : 'Перемкнути на темну тему');
    btn.title = isDark ? 'Темна тема: натисніть для світлої' : 'Світла тема: натисніть для темної';
}

function initHeaderThemeToggle() {
    if (isEmbeddedShellMode()) return;

    const userPanel = document.querySelector('.header .user-panel');
    if (!userPanel) return;

    const oldSidebarTheme = document.querySelector('.sidebar-theme-btn');
    if (oldSidebarTheme) oldSidebarTheme.remove();

    let btn = document.getElementById('headerThemeToggle');
    if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'headerThemeToggle';
        btn.className = 'header-theme-toggle';
        btn.innerHTML = `
            <span class="header-theme-track" aria-hidden="true">
                <span class="header-theme-glyph header-theme-glyph--sun">
                    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
                </span>
                <span class="header-theme-glyph header-theme-glyph--moon">
                    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M21 14.8A8.5 8.5 0 0 1 9.2 3a7 7 0 1 0 11.8 11.8Z"/></svg>
                </span>
                <span class="header-theme-thumb"></span>
            </span>`;

        const currentUser = document.getElementById('currentUser');
        if (currentUser && currentUser.parentElement === userPanel) {
            currentUser.insertAdjacentElement('afterend', btn);
        } else {
            const logoutBtn = document.getElementById('logoutBtn');
            if (logoutBtn && logoutBtn.parentElement === userPanel) userPanel.insertBefore(btn, logoutBtn);
            else userPanel.appendChild(btn);
        }
    }

    if (btn.dataset.themeBound !== '1') {
        btn.dataset.themeBound = '1';
        btn.addEventListener('click', () => applyCrmThemeMode(!isCrmDarkThemeActive(), true));
    }
    if (document.documentElement.dataset.headerThemeObserverBound !== '1') {
        document.documentElement.dataset.headerThemeObserverBound = '1';
        const observer = new MutationObserver(syncHeaderThemeToggle);
        observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
    syncHeaderThemeToggle();
    initSharedHeaderActions();
}

// v0.56.6: global search belongs to the shared authenticated header on every CRM page.
let _globalHeaderSearchScriptPromise = null;
let _globalFeatureRegistryScriptPromise = null;

function _sharedAssetSuffixFromAuth() {
    const script = Array.from(document.scripts || []).find(item => /(^|\/)js\/auth\.js/.test(item.getAttribute('src') || ''))
        || Array.from(document.scripts || []).find(item => /[?&]v=/.test(item.getAttribute('src') || ''));
    if (!script) return '';
    try {
        const version = new URL(script.src, window.location.href).searchParams.get('v') || '';
        return version ? `?v=${encodeURIComponent(version)}` : '';
    } catch {
        return '';
    }
}

function ensureGlobalSearchModal() {
    const existing = document.getElementById('searchModal');
    if (existing) {
        existing.setAttribute('role', 'dialog');
        existing.setAttribute('aria-modal', 'true');
        existing.setAttribute('aria-label', 'Глобальний пошук CRM');
        const header = existing.querySelector('.search-header');
        if (header && !header.querySelector('.search-header-icon')) {
            const icon = document.createElement('span');
            icon.className = 'search-header-icon';
            icon.setAttribute('aria-hidden', 'true');
            icon.textContent = '⌕';
            header.prepend(icon);
        }
        if (existing.dataset.globalSearchBackdropBound !== '1') {
            existing.dataset.globalSearchBackdropBound = '1';
            existing.addEventListener('click', event => {
                if (event.target === existing && typeof window.closeSearch === 'function') window.closeSearch();
            });
        }
        return;
    }
    const modal = document.createElement('div');
    modal.id = 'searchModal';
    modal.className = 'search-overlay hidden';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Глобальний пошук CRM');
    modal.innerHTML = `
        <div class="search-container">
            <div class="search-header">
                <span class="search-header-icon" aria-hidden="true">⌕</span>
                <input type="text" id="searchInput" class="search-input" placeholder="Пошук бронювань, клієнтів, задач..." autocomplete="off" oninput="onSearchInput(this.value)">
                <kbd class="search-kbd">Esc</kbd>
            </div>
            <div id="searchResults" class="search-results">
                <div class="search-hint">Почніть вводити для пошуку по бронюванням, клієнтам, задачам, програмам</div>
            </div>
            <div class="search-footer">
                <span><kbd>↑↓</kbd> навігація</span>
                <span><kbd>Enter</kbd> перейти</span>
                <span><kbd>Esc</kbd> закрити</span>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', event => {
        if (event.target === modal && typeof window.closeSearch === 'function') window.closeSearch();
    });
}

function ensureCrmFeatureRegistryScript() {
    if (window.CrmFeatureRegistry) return Promise.resolve(true);
    if (_globalFeatureRegistryScriptPromise) return _globalFeatureRegistryScriptPromise;

    const existing = Array.from(document.scripts || []).find(item => /(^|\/)js\/crm-feature-registry\.js/.test(item.getAttribute('src') || ''));
    if (existing) {
        _globalFeatureRegistryScriptPromise = new Promise(resolve => {
            if (window.CrmFeatureRegistry) {
                resolve(true);
                return;
            }
            existing.addEventListener('load', () => resolve(Boolean(window.CrmFeatureRegistry)), { once: true });
            existing.addEventListener('error', () => resolve(false), { once: true });
            setTimeout(() => resolve(Boolean(window.CrmFeatureRegistry)), 600);
        });
        return _globalFeatureRegistryScriptPromise;
    }

    _globalFeatureRegistryScriptPromise = new Promise(resolve => {
        const script = document.createElement('script');
        script.src = `/js/crm-feature-registry.js${_sharedAssetSuffixFromAuth()}`;
        script.dataset.crmFeatureRegistry = 'true';
        script.onload = () => resolve(Boolean(window.CrmFeatureRegistry));
        script.onerror = () => resolve(false);
        document.body.appendChild(script);
    });
    return _globalFeatureRegistryScriptPromise;
}

function ensureGlobalSearchScript() {
    if (typeof window.openSearch === 'function') {
        return ensureCrmFeatureRegistryScript().then(() => true);
    }
    if (_globalHeaderSearchScriptPromise) return _globalHeaderSearchScriptPromise;

    const existing = Array.from(document.scripts || []).find(item => /(^|\/)js\/search\.js/.test(item.getAttribute('src') || ''));
    if (existing) {
        _globalHeaderSearchScriptPromise = ensureCrmFeatureRegistryScript().then(() => new Promise(resolve => {
            if (typeof window.openSearch === 'function') {
                resolve(true);
                return;
            }
            existing.addEventListener('load', () => resolve(typeof window.openSearch === 'function'), { once: true });
            existing.addEventListener('error', () => resolve(false), { once: true });
            setTimeout(() => resolve(typeof window.openSearch === 'function'), 600);
        }));
        return _globalHeaderSearchScriptPromise;
    }

    _globalHeaderSearchScriptPromise = ensureCrmFeatureRegistryScript().then(() => new Promise(resolve => {
        const script = document.createElement('script');
        script.src = `/js/search.js${_sharedAssetSuffixFromAuth()}`;
        script.dataset.globalHeaderSearch = 'true';
        script.onload = () => resolve(typeof window.openSearch === 'function');
        script.onerror = () => resolve(false);
        document.body.appendChild(script);
    }));
    return _globalHeaderSearchScriptPromise;
}

function openGlobalHeaderSearch() {
    ensureGlobalSearchModal();
    ensureGlobalSearchScript().then(ready => {
        if (ready && typeof window.openSearch === 'function') {
            window.openSearch();
            return;
        }
        const input = document.getElementById('searchInput');
        const modal = document.getElementById('searchModal');
        if (modal) modal.classList.remove('hidden');
        if (input) input.focus();
    });
}

function initGlobalHeaderSearch() {
    if (isEmbeddedShellMode()) return false;

    const headerContent = document.querySelector('.header .header-content');
    if (!headerContent) return false;
    if (document.body?.classList?.contains('timeline-dashboard-page')) return false;

    ensureGlobalSearchModal();

    let btn = document.getElementById('globalHeaderSearchBtn') || headerContent.querySelector('.btn-search');
    if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        const userPanel = headerContent.querySelector('.user-panel');
        if (userPanel) headerContent.insertBefore(btn, userPanel);
        else headerContent.appendChild(btn);
    }

    btn.id = 'globalHeaderSearchBtn';
    btn.type = 'button';
    btn.classList.add('btn-search', 'header-search-btn');
    btn.removeAttribute('onclick');
    btn.title = 'Пошук по CRM (Ctrl+K)';
    btn.setAttribute('aria-label', 'Відкрити пошук по CRM');
    btn.innerHTML = `
        <span class="header-search-icon" aria-hidden="true">⌕</span>
        <span class="header-search-label">Пошук</span>
        <kbd>⌘K</kbd>
    `;

    if (btn.dataset.globalSearchBound !== '1') {
        btn.dataset.globalSearchBound = '1';
        btn.addEventListener('click', openGlobalHeaderSearch);
    }

    ensureGlobalSearchScript();
    return true;
}

// v0.56.9: expose safe shell controls for the assistant command router.
window.applyCrmThemeMode = applyCrmThemeMode;
window.openGlobalHeaderSearch = openGlobalHeaderSearch;

// v10.4: Auto-init profile handler on any page (sub-pages don't call showMainApp)
function initProfileHandler() {
    const el = document.getElementById('currentUser');
    if (!el || el.dataset.profileInit) return;
    el.dataset.profileInit = '1';
    el.classList.add('user-name-clickable');
    el.setAttribute('role', 'link');
    el.setAttribute('tabindex', '0');
    el.setAttribute('title', 'Відкрити профіль');
    el.addEventListener('click', openProfilePage);
    el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProfilePage(); }
    });

    // Init modal close for sub-pages that don't include app.js
    const profileModal = document.getElementById('profileModal');
    if (profileModal) {
        const closeBtn = profileModal.querySelector('.modal-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                closeProfileModal(false);
            });
        }
        profileModal.addEventListener('click', (e) => {
            if (e.target === profileModal) closeProfileModal(false);
        });
        if (!window.__profileRescheduleMenuBound) {
            window.__profileRescheduleMenuBound = true;
            document.addEventListener('click', (e) => {
                if (e.target?.closest?.('.prof-reschedule-wrap')) return;
                profileCloseRescheduleMenus();
            });
        }
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !profileModal.classList.contains('hidden')) {
                if (profileCloseRescheduleMenus()) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                closeProfileModal(false);
            }
        });
    }
}

// Run on DOMContentLoaded + MutationObserver for sub-pages that set currentUser later
document.addEventListener('DOMContentLoaded', () => {
    // Delay slightly to let page-specific JS set username first
    setTimeout(initProfileHandler, 100);
    setTimeout(initGlobalHeaderSearch, 110);
    setTimeout(initSharedHeaderActions, 115);
    setTimeout(initHeaderThemeToggle, 120);
    setTimeout(() => {
        if (document.body.classList.contains('authenticated-shell')) initCrmAssistantRail();
    }, 350);

    // v37.5: Auto-fill sidebar avatar from AppState OR localStorage.
    // AppState may itself have been populated from localStorage, so it is not
    // proof that the server session or permission catalog has been verified.
    function _autoFillUser() {
        try {
            let user = null;

            // Priority 1: AppState (runtime state or a previously restored cache)
            if (typeof AppState !== 'undefined' && AppState.currentUser) {
                user = AppState.currentUser;
                // Sync to localStorage so other mechanisms can find it
                const saved = JSON.parse(localStorage.getItem('pzp_current_user') || '{}');
                const savedHasIdentity = saved?.id !== undefined || Boolean(String(saved?.username || '').trim());
                const runtimeHasIdentity = user?.id !== undefined || Boolean(String(user?.username || '').trim());
                const sameIdentity = typeof apiAuthUsersShareIdentity === 'function'
                    ? apiAuthUsersShareIdentity(saved, user)
                    : (saved?.id !== undefined && user?.id !== undefined
                        ? String(saved.id) === String(user.id)
                        : String(saved?.username || '').trim().toLowerCase() === String(user?.username || '').trim().toLowerCase());
                if (savedHasIdentity && runtimeHasIdentity && !sameIdentity) {
                    if (typeof setApiAuthSessionFailure === 'function') {
                        setApiAuthSessionFailure('transient', { stage: 'auto-fill', reason: 'session-changed' });
                    }
                    if (typeof resetAuthenticatedRuntimeReady === 'function') resetAuthenticatedRuntimeReady();
                    if (typeof showAuthenticatedPageShell === 'function') {
                        showAuthenticatedPageShell({ markRuntimeReady: false });
                    }
                    if (typeof renderAuthSessionBootstrapError === 'function') {
                        renderAuthSessionBootstrapError({
                            failure: { status: 0, retryable: true, stage: 'auto-fill', reason: 'session-changed' },
                            retry: () => window.location.reload()
                        });
                    }
                    return;
                }
                user = { ...saved, ...user };
                AppState.currentUser = user;
                localStorage.setItem('pzp_current_user', JSON.stringify(user));
            }

            // Priority 2: localStorage (set by login() in auth.js)
            if (!user) {
                const saved = localStorage.getItem('pzp_current_user');
                if (!saved) return;
                user = JSON.parse(saved);
                if (!user || !user.name) return;
                // Fill AppState from localStorage
                if (typeof AppState !== 'undefined' && !AppState.currentUser) {
                    AppState.currentUser = user;
                }
            }

            const permissionState = getPermissionLifecycle().status;
            const hasVerifiedRuntime = isAuthenticatedRuntimeReady();
            if (!hasVerifiedRuntime || permissionState !== 'ready') return;
            if (!enforceCurrentPageAccess(user)) return;
            window.WorkingRole?.hydrate?.();

            // Fill header #currentUser
            const el = document.getElementById('currentUser');
            if (el && !el.textContent.trim()) {
                el.textContent = user.name || user.username || '';
            }
            // Fill sidebar avatar
            if (typeof Sidebar !== 'undefined' && Sidebar.initUserCard) {
                Sidebar.initUserCard();
            }
        } catch {}
    }
    setTimeout(_autoFillUser, 200);
    setTimeout(_autoFillUser, 500);
    setTimeout(_autoFillUser, 1000);
    setTimeout(_autoFillUser, 2000);
    setTimeout(_autoFillUser, 4000);
});

// ==========================================
// Compatibility tombstone: legacy RoleSwitcher UI is retired.
// Dashboard RolePreview is the only role-preview entrypoint.
// ==========================================

const RoleSwitcher = (() => {
    function reset() {
        return window.RolePreview?.clearPreviewRole?.() ?? false;
    }

    function resetImpersonation() {
        const realToken = sessionStorage.getItem('realToken');
        const realAccessToken = sessionStorage.getItem('realAccessToken');
        const realRefreshToken = sessionStorage.getItem('realRefreshToken');
        const realRefreshExpiresAt = sessionStorage.getItem('realRefreshExpiresAt');
        const realUser = sessionStorage.getItem('realUser');
        const hasIsolatedBackup = sessionStorage.getItem('realSessionBackupVersion') === '2';
        const hasBackup = hasIsolatedBackup || Boolean(realToken || realUser);
        const impersonating = sessionStorage.getItem('impersonating') || '';
        const expectedGeneration = sessionStorage.getItem('impersonationSessionGeneration') || '';
        let expectedTarget = null;
        try { expectedTarget = JSON.parse(sessionStorage.getItem('impersonationTargetUser') || 'null'); } catch {}
        const sessionMatchesTarget = () => {
            let currentUser = null;
            try { currentUser = JSON.parse(localStorage.getItem(CONFIG.STORAGE.CURRENT_USER) || 'null'); } catch {}
            const sameIdentity = expectedTarget
                ? (typeof apiAuthUsersShareIdentity === 'function'
                    ? apiAuthUsersShareIdentity(expectedTarget, currentUser)
                    : String(expectedTarget?.id ?? '') === String(currentUser?.id ?? '')
                        && String(expectedTarget?.username || '').trim().toLowerCase()
                            === String(currentUser?.username || '').trim().toLowerCase())
                : String(currentUser?.username || '').trim().toLowerCase()
                    === String(impersonating).trim().toLowerCase();
            const currentGeneration = localStorage.getItem(AUTH_SESSION_GENERATION_KEY) || '';
            return Boolean(impersonating && sameIdentity)
                && (!expectedGeneration || currentGeneration === expectedGeneration);
        };
        const discardBackup = () => {
            if (realRefreshToken) revokeRefreshTokenValue(realRefreshToken);
            clearImpersonationBackup();
        };

        const transitionBusy = typeof getActiveAuthTransitionMarker === 'function'
            ? Boolean(getActiveAuthTransitionMarker())
            : Boolean(localStorage.getItem(AUTH_TRANSITION_KEY));
        if (transitionBusy) return false;
        if (!hasBackup || !sessionMatchesTarget()) {
            discardBackup();
            return false;
        }

        const transition = typeof beginAuthTransition === 'function'
            ? beginAuthTransition('restore')
            : (() => {
                const marker = `restore-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
                localStorage.setItem(AUTH_TRANSITION_KEY, marker);
                return { marker, owned: true };
            })();
        if (!transition.owned) return false;
        try {
            if (!sessionMatchesTarget()) {
                discardBackup();
                return false;
            }
            if (hasIsolatedBackup) {
                if (realToken) localStorage.setItem('pzp_token', realToken);
                else localStorage.removeItem('pzp_token');
                if (realAccessToken) localStorage.setItem(AUTH_ACCESS_TOKEN_KEY, realAccessToken);
                else if (realToken) localStorage.setItem(AUTH_ACCESS_TOKEN_KEY, realToken);
                else localStorage.removeItem(AUTH_ACCESS_TOKEN_KEY);
                if (realRefreshToken) localStorage.setItem(AUTH_REFRESH_TOKEN_KEY, realRefreshToken);
                else localStorage.removeItem(AUTH_REFRESH_TOKEN_KEY);
                if (realRefreshExpiresAt) localStorage.setItem(AUTH_REFRESH_EXPIRES_KEY, realRefreshExpiresAt);
                else localStorage.removeItem(AUTH_REFRESH_EXPIRES_KEY);
            } else if (realToken) {
                // Backward compatibility for impersonation sessions created before refresh isolation.
                localStorage.setItem('pzp_token', realToken);
                localStorage.setItem(AUTH_ACCESS_TOKEN_KEY, realToken);
            }
            if (realUser) localStorage.setItem(CONFIG.STORAGE.CURRENT_USER, realUser);
            if (typeof rotateApiAuthSessionGeneration === 'function') rotateApiAuthSessionGeneration();
            clearImpersonationBackup();
        } finally {
            if (typeof endAuthTransition === 'function') endAuthTransition(transition);
            else if (localStorage.getItem(AUTH_TRANSITION_KEY) === transition.marker) {
                localStorage.removeItem(AUTH_TRANSITION_KEY);
            }
        }
        window.location.reload();
        return true;
    }

    return {
        init() {
            return false;
        },
        reset,
        resetImpersonation
    };
})();
window.RoleSwitcher = RoleSwitcher;

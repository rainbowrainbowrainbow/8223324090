/**
 * api.js - Всі API функції (PostgreSQL + localStorage fallback)
 * v25.3: Unified apiCall wrapper to reduce try/catch duplication
 */

const API_BASE = '/api';
const API_AUTH_ACCESS_TOKEN_KEY = 'pzp_access_token';
const API_AUTH_REFRESH_TOKEN_KEY = 'pzp_refresh_token';
const API_AUTH_REFRESH_EXPIRES_KEY = 'pzp_refresh_expires_at';
const API_AUTH_SESSION_GENERATION_KEY = 'pzp_auth_session_generation';
const API_AUTH_SESSION_TOKEN_ID_KEY = 'pzp_auth_session_token_id';
const API_AUTH_TRANSITION_KEY = 'pzp_auth_transition';
const API_AUTH_REFRESH_COORDINATION_KEY = 'pzp_auth_refresh_coordination';
const API_AUTH_REFRESH_APPLIED_AT_KEY = 'pzp_auth_refresh_applied_at';
const API_AUTH_PRESERVE_BUSINESS_SCOPE_HEADERS = Symbol('apiAuthPreserveBusinessScopeHeaders');
const API_AUTH_REFRESHABLE_UNAUTHORIZED_CODES = new Set([
    'auth_token_missing',
    'auth_token_invalid'
]);
const API_AUTH_TERMINAL_UNAUTHORIZED_CODES = new Set([
    'auth_user_missing',
    'auth_user_deactivated',
    'auth_user_inactive',
    'auth_session_revoked',
    'auth_identity_changed'
]);
const API_AUTH_REFRESH_SETTLEMENT_MS = 5000;
const API_AUTH_REFRESH_REPLAY_CONFIRM_DELAY_MS = 250;
const API_AUTH_TRANSITION_MAX_AGE_MS = 15000;
const API_AUTH_REFRESH_COORDINATION_MAX_AGE_MS = 15000;
const API_AUTH_REFRESH_COORDINATION_WAIT_MS = 5000;
const API_AUTH_REFRESH_WATCHDOG_MS = 12000;
const API_AUTH_RATE_LIMIT_RETRY_MAX = 2;
const API_AUTH_RATE_LIMIT_RETRY_DEFAULT_MS = 250;
const API_AUTH_RATE_LIMIT_AUTO_RETRY_MAX_DELAY_MS = 2000;
const API_AUTH_RETRYABLE_RATE_LIMIT_CODES = new Set([
    'auth_availability_rate_limited'
]);
const apiSemanticUnauthorizedResponses = new WeakSet();
let apiAuthRefreshOperation = null;
let apiAuthSessionFailure = null;
let apiOwnedAuthTransition = null;

function recordApiRedirectDiagnostic(event, details = {}) {
    try {
        window.RedirectDiagnostics?.record(event, details);
    } catch {}
}

function getActiveApiAuthTransitionMarker() {
    const marker = localStorage.getItem(API_AUTH_TRANSITION_KEY) || '';
    if (!marker) return '';
    const parts = String(marker).split('-');
    const timestampPart = ['remember', 'merge', 'api', 'auth', 'impersonate', 'restore'].includes(parts[0])
        ? parts[1]
        : parts[0];
    const startedAt = Number.parseInt(timestampPart || '', 36);
    const ageMs = Date.now() - startedAt;
    if (!Number.isFinite(startedAt)
        || ageMs > API_AUTH_TRANSITION_MAX_AGE_MS
        || ageMs < -1000) {
        if (localStorage.getItem(API_AUTH_TRANSITION_KEY) === marker) {
            localStorage.removeItem(API_AUTH_TRANSITION_KEY);
        }
        return '';
    }
    return marker;
}

function beginApiAuthTransition(prefix = 'api') {
    const activeMarker = getActiveApiAuthTransitionMarker();
    if (activeMarker) {
        if (apiOwnedAuthTransition?.marker === activeMarker) {
            apiOwnedAuthTransition.depth += 1;
            return { marker: activeMarker, owned: true };
        }
        return { marker: activeMarker, owned: false };
    }
    const marker = `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(API_AUTH_TRANSITION_KEY, marker);
    apiOwnedAuthTransition = { marker, depth: 1 };
    return { marker, owned: true };
}

function endApiAuthTransition(transition) {
    if (!transition?.owned || apiOwnedAuthTransition?.marker !== transition.marker) return;
    apiOwnedAuthTransition.depth -= 1;
    if (apiOwnedAuthTransition.depth > 0) return;
    apiOwnedAuthTransition = null;
    if (localStorage.getItem(API_AUTH_TRANSITION_KEY) === transition.marker) {
        localStorage.removeItem(API_AUTH_TRANSITION_KEY);
    }
}

function readApiAuthRefreshCoordinationMarker() {
    try {
        const raw = localStorage.getItem(API_AUTH_REFRESH_COORDINATION_KEY) || '';
        if (!raw) return null;
        const marker = JSON.parse(raw);
        const startedAt = Number(marker?.startedAt || 0);
        const ageMs = Date.now() - startedAt;
        if (!marker?.id
            || !Number.isFinite(startedAt)
            || ageMs > API_AUTH_REFRESH_COORDINATION_MAX_AGE_MS
            || ageMs < -1000) {
            if (localStorage.getItem(API_AUTH_REFRESH_COORDINATION_KEY) === raw) {
                localStorage.removeItem(API_AUTH_REFRESH_COORDINATION_KEY);
            }
            return null;
        }
        return marker;
    } catch {
        localStorage.removeItem(API_AUTH_REFRESH_COORDINATION_KEY);
        return null;
    }
}

function apiAuthRefreshCoordinationMatches(marker, refreshToken, sessionGeneration, expectedIdentityKey) {
    return marker
        && marker.refreshToken === refreshToken
        && String(marker.sessionGeneration || '') === String(sessionGeneration || '')
        && String(marker.expectedIdentityKey || '') === String(expectedIdentityKey || '');
}

function clearApiAuthRefreshCoordinationMarker(marker) {
    if (!marker?.id) return;
    const active = readApiAuthRefreshCoordinationMarker();
    if (active?.id === marker.id) localStorage.removeItem(API_AUTH_REFRESH_COORDINATION_KEY);
}

function getApiAuthRefreshAppliedAt() {
    const value = Number(localStorage.getItem(API_AUTH_REFRESH_APPLIED_AT_KEY) || 0);
    const now = Date.now();
    if (!Number.isFinite(value) || value < 0 || value > now + 1000) {
        localStorage.removeItem(API_AUTH_REFRESH_APPLIED_AT_KEY);
        return 0;
    }
    return value;
}

function rememberApiAuthRefreshAppliedAt(startedAt) {
    const value = Number(startedAt || 0);
    if (!Number.isFinite(value) || value <= 0) return;
    const current = getApiAuthRefreshAppliedAt();
    if (!current || value >= current) {
        localStorage.setItem(API_AUTH_REFRESH_APPLIED_AT_KEY, String(value));
    }
}

function setApiAuthSessionFailure(kind, details = {}) {
    const status = Number(details.status || 0) || null;
    apiAuthSessionFailure = {
        kind: kind === 'terminal' ? 'terminal' : 'transient',
        terminal: kind === 'terminal',
        transient: kind !== 'terminal',
        stage: details.stage || 'unknown',
        status,
        reason: details.reason || (status ? 'http' : 'network'),
        updatedAt: Date.now()
    };
    const retryAfterSeconds = Number(details.retryAfterSeconds);
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        apiAuthSessionFailure.retryAfterSeconds = retryAfterSeconds;
    }
    if (details.code) apiAuthSessionFailure.code = String(details.code);
    if (details.bucket) apiAuthSessionFailure.bucket = String(details.bucket);
    if (details.requestId) apiAuthSessionFailure.requestId = String(details.requestId);
    recordApiRedirectDiagnostic('auth-session-failure', apiAuthSessionFailure);
    return apiAuthSessionFailure;
}

function clearApiAuthSessionFailure() {
    apiAuthSessionFailure = null;
}

function getApiAuthSessionFailure() {
    return apiAuthSessionFailure ? { ...apiAuthSessionFailure } : null;
}

function isApiAuthSessionFailureTerminal(failure = apiAuthSessionFailure) {
    return failure?.kind === 'terminal' || failure?.terminal === true;
}

function isApiAuthSessionFailureTransient(failure = apiAuthSessionFailure) {
    return failure?.kind === 'transient' || failure?.transient === true;
}

function classifyApiAuthHttpFailure(status) {
    const normalizedStatus = Number(status || 0) || 0;
    return [400, 401, 403].includes(normalizedStatus) ? 'terminal' : 'transient';
}

function parseApiAuthRetryAfterMs(response) {
    const header = response?.headers?.get?.('Retry-After');
    const numericSeconds = Number(header);
    if (Number.isFinite(numericSeconds) && numericSeconds > 0) {
        return Math.max(API_AUTH_RATE_LIMIT_RETRY_DEFAULT_MS, Math.ceil(numericSeconds * 1000));
    }
    if (header) {
        const timestamp = Date.parse(header);
        if (Number.isFinite(timestamp)) {
            return Math.max(API_AUTH_RATE_LIMIT_RETRY_DEFAULT_MS, timestamp - Date.now());
        }
    }
    return API_AUTH_RATE_LIMIT_RETRY_DEFAULT_MS;
}

function getApiAuthRateLimitFailureDetails(stage, response, data = {}) {
    if (!isApiAuthRetryableRateLimit(response, data)) return null;
    const retryAfterMs = parseApiAuthRetryAfterMs(response);
    const bodyRetryAfterSeconds = Number(data?.retryAfterSeconds);
    const retryAfterSeconds = Number.isFinite(bodyRetryAfterSeconds) && bodyRetryAfterSeconds > 0
        ? bodyRetryAfterSeconds
        : Math.ceil(retryAfterMs / 1000);
    return {
        stage,
        status: response.status,
        reason: retryAfterMs > API_AUTH_RATE_LIMIT_AUTO_RETRY_MAX_DELAY_MS
            ? 'rate-limit-retry-later'
            : 'rate-limit-retry-exhausted',
        retryAfterSeconds,
        code: data?.code || 'auth_availability_rate_limited',
        bucket: data?.bucket || 'auth_availability_ip',
        requestId: data?.requestId || data?.request_id || null
    };
}

function isApiAuthRetryableRateLimit(response, data = {}) {
    if (response?.status !== 429) return false;
    const code = String(data?.code || '').trim().toLowerCase();
    return API_AUTH_RETRYABLE_RATE_LIMIT_CODES.has(code) || data?.bucket === 'auth_availability_ip';
}

function waitForApiAuthRateLimitBackoff(response) {
    return new Promise(resolve => setTimeout(resolve, parseApiAuthRetryAfterMs(response)));
}

async function retryApiAuthRateLimitedResponse(response, data, makeRequest, options = {}) {
    let retries = 0;
    let currentResponse = response;
    let currentData = data;
    while (isApiAuthRetryableRateLimit(currentResponse, currentData)
        && retries < API_AUTH_RATE_LIMIT_RETRY_MAX) {
        const retryAfterMs = parseApiAuthRetryAfterMs(currentResponse);
        if (retryAfterMs > API_AUTH_RATE_LIMIT_AUTO_RETRY_MAX_DELAY_MS) {
            return {
                response: currentResponse,
                data: currentData,
                retries,
                retryLater: true,
                retryAfterMs
            };
        }
        await waitForApiAuthRateLimitBackoff(currentResponse);
        if (typeof options.canContinue === 'function' && !options.canContinue()) break;
        currentResponse = await makeRequest();
        currentData = await currentResponse.json().catch(() => ({}));
        retries += 1;
    }
    return { response: currentResponse, data: currentData, retries, retryLater: false };
}

function normalizeApiAuthList(...values) {
    return Array.from(new Set(values.flatMap(value => Array.isArray(value) ? value : [])
        .map(value => String(value || '').trim().toLowerCase())
        .filter(Boolean)))
        .sort();
}

function apiAuthAuthorizationFingerprint(user = {}) {
    const primaryRole = String(user?.role || '').trim().toLowerCase();
    return JSON.stringify({
        primaryRole,
        roles: normalizeApiAuthList([primaryRole], user?.roles, user?.extraRoles, user?.extra_roles),
        pageAllowlist: normalizeApiAuthList(user?.pageAllowlist, user?.page_allowlist),
        pageDenylist: normalizeApiAuthList(user?.pageDenylist, user?.page_denylist),
        actionAllowlist: normalizeApiAuthList(user?.actionAllowlist, user?.action_allowlist),
        actionDenylist: normalizeApiAuthList(user?.actionDenylist, user?.action_denylist),
        businessContexts: normalizeApiAuthList(user?.businessContexts, user?.business_contexts),
        defaultBusinessContext: String(user?.defaultBusinessContext || user?.default_business_context || '').trim().toLowerCase(),
        qaCreatorLeaseId: String(user?.qaCreatorLeaseId || user?.qa_creator_lease_id || '')
    });
}

function readApiAuthStoredUser() {
    try {
        const user = JSON.parse(localStorage.getItem(CONFIG.STORAGE.CURRENT_USER) || 'null');
        return user && typeof user === 'object' && !Array.isArray(user) ? user : null;
    } catch {
        return null;
    }
}

function apiAuthUsersShareIdentity(left, right) {
    const leftId = left?.id === undefined || left?.id === null ? '' : String(left.id);
    const rightId = right?.id === undefined || right?.id === null ? '' : String(right.id);
    if (leftId && rightId) return leftId === rightId;

    const leftUsername = String(left?.username || '').trim().toLowerCase();
    const rightUsername = String(right?.username || '').trim().toLowerCase();
    return Boolean(leftUsername && rightUsername && leftUsername === rightUsername);
}

function createApiAuthSessionGeneration() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function ensureApiAuthSessionGeneration() {
    let generation = localStorage.getItem(API_AUTH_SESSION_GENERATION_KEY) || '';
    if (!generation && apiHasStoredAuthSession()) {
        generation = createApiAuthSessionGeneration();
        localStorage.setItem(API_AUTH_SESSION_GENERATION_KEY, generation);
    }
    return generation;
}

function rotateApiAuthSessionGeneration() {
    const generation = createApiAuthSessionGeneration();
    localStorage.setItem(API_AUTH_SESSION_GENERATION_KEY, generation);
    return generation;
}

function captureApiAuthSessionSnapshot(user = null) {
    const storedUser = readApiAuthStoredUser();
    const identitySource = user && typeof user === 'object' ? user : storedUser;
    const identityId = identitySource?.id ?? null;
    const identityUsername = String(identitySource?.username || '').trim();
    return {
        generation: ensureApiAuthSessionGeneration(),
        accessToken: getStoredAuthToken() || '',
        refreshToken: localStorage.getItem(API_AUTH_REFRESH_TOKEN_KEY) || '',
        identity: identitySource && typeof identitySource === 'object' && (identityId !== null || identityUsername)
            ? {
                id: identityId,
                username: identityUsername
            }
            : null,
        hadStoredUser: Boolean(storedUser)
    };
}

function isApiAuthSessionSnapshotCurrent(snapshot, user = null) {
    if (!snapshot || typeof snapshot !== 'object') return false;
    if (ensureApiAuthSessionGeneration() !== String(snapshot.generation || '')) return false;

    const expectedUser = user && typeof user === 'object' ? user : snapshot.identity;
    if (snapshot.identity && expectedUser && !apiAuthUsersShareIdentity(snapshot.identity, expectedUser)) return false;

    const storedUser = readApiAuthStoredUser();
    if (snapshot.hadStoredUser && !storedUser) return false;
    if (storedUser && expectedUser && !apiAuthUsersShareIdentity(storedUser, expectedUser)) return false;

    const runtimeUser = typeof AppState !== 'undefined' && AppState?.currentUser
        ? AppState.currentUser
        : null;
    if (runtimeUser && expectedUser && !apiAuthUsersShareIdentity(runtimeUser, expectedUser)) return false;
    return true;
}

function markApiAuthSessionChanged(stage = 'request') {
    const existingFailure = getApiAuthSessionFailure();
    if (existingFailure?.kind === 'terminal') return false;
    setApiAuthSessionFailure('transient', { stage, reason: 'session-changed' });
    return false;
}

function syncApiAuthUserAliases(target, source = {}) {
    [
        ['extraRoles', 'extra_roles'],
        ['pageAllowlist', 'page_allowlist'],
        ['pageDenylist', 'page_denylist'],
        ['actionAllowlist', 'action_allowlist'],
        ['actionDenylist', 'action_denylist'],
        ['businessContexts', 'business_contexts'],
        ['defaultBusinessContext', 'default_business_context']
    ].forEach(([camelKey, snakeKey]) => {
        const hasCamelValue = Object.prototype.hasOwnProperty.call(source, camelKey);
        const hasSnakeValue = Object.prototype.hasOwnProperty.call(source, snakeKey);
        if (!hasCamelValue && !hasSnakeValue) return;
        const value = hasCamelValue ? source[camelKey] : source[snakeKey];
        target[camelKey] = value;
        target[snakeKey] = value;
    });
    return target;
}

function getStoredAuthToken() {
    return localStorage.getItem('pzp_token') || localStorage.getItem(API_AUTH_ACCESS_TOKEN_KEY);
}

function apiHasStoredAuthSession() {
    return Boolean(getStoredAuthToken() || localStorage.getItem(API_AUTH_REFRESH_TOKEN_KEY));
}


function getApiAuthRefreshWatchdogTimers() {
    const setTimer = typeof window !== 'undefined' && typeof window.setTimeout === 'function'
        ? window.setTimeout.bind(window)
        : null;
    const clearTimer = typeof window !== 'undefined' && typeof window.clearTimeout === 'function'
        ? window.clearTimeout.bind(window)
        : null;
    return { setTimer, clearTimer };
}

function clearApiAuthRefreshWatchdog(operation) {
    if (!operation || operation.watchdogTimer === null || operation.watchdogTimer === undefined) return;
    const { clearTimer } = getApiAuthRefreshWatchdogTimers();
    if (clearTimer) clearTimer(operation.watchdogTimer);
    operation.watchdogTimer = null;
}

function buildApiAuthRefreshRetryLaterResult(reason = 'refresh-watchdog-timeout') {
    return { accessToken: null, outcome: 'retry-later', retryable: true, reason };
}

function createApiAuthRefreshControlledPromise(operation, transportPromise) {
    const { setTimer } = getApiAuthRefreshWatchdogTimers();
    return new Promise(resolve => {
        let settled = false;
        const settle = result => {
            if (settled) return;
            settled = true;
            clearApiAuthRefreshWatchdog(operation);
            resolve(result || { accessToken: null, outcome: 'transient' });
        };
        operation.resolvePublic = settle;
        if (setTimer && Number.isFinite(API_AUTH_REFRESH_WATCHDOG_MS) && API_AUTH_REFRESH_WATCHDOG_MS > 0) {
            operation.watchdogTimer = setTimer(() => {
                operation.watchdogTimer = null;
                operation.watchdogFired = true;
                if (apiAuthRefreshOperation !== operation
                    || !isApiAuthRefreshOperationCurrent(operation.refreshToken, operation.sessionGeneration)) {
                    settle({ accessToken: null, outcome: 'superseded' });
                    return;
                }
                setApiAuthSessionFailure('transient', {
                    stage: 'refresh',
                    reason: 'refresh-watchdog-timeout'
                });
                recordApiRedirectDiagnostic('auth-refresh', {
                    refreshOutcome: 'retry-later',
                    reason: 'refresh-watchdog-timeout'
                });
                settle(buildApiAuthRefreshRetryLaterResult());
            }, API_AUTH_REFRESH_WATCHDOG_MS);
        }
        transportPromise.then(result => {
            operation.transportSettled = true;
            settle(result);
        }, err => {
            operation.transportSettled = true;
            if (isApiAuthRefreshOperationCurrent(operation.refreshToken, operation.sessionGeneration)) {
                setApiAuthSessionFailure('transient', { stage: 'refresh', reason: 'network' });
                recordApiRedirectDiagnostic('auth-refresh', { refreshOutcome: 'transient', reason: 'network' });
            }
            console.warn('[Auth] refresh failed:', err?.message || err);
            settle({ accessToken: null, outcome: 'transient' });
        });
    });
}

function formatApiErrorPayload(payload = {}, fallback = 'API error') {
    if (typeof window !== 'undefined' && window.CrmApiErrors) {
        return window.CrmApiErrors.format(payload, fallback);
    }
    const requestId = payload?.requestId || payload?.request_id || '';
    const message = payload?.error || payload?.message || fallback;
    return `${message}${requestId ? ` · код: ${requestId}` : ''}`;
}

function apiErrorFromPayload(payload = {}, fallback = 'API error') {
    if (typeof window !== 'undefined' && window.CrmApiErrors) {
        return window.CrmApiErrors.toError(payload, fallback);
    }
    const error = new Error(payload?.error || payload?.message || fallback);
    error.requestId = payload?.requestId || payload?.request_id || '';
    error.status = payload?.status || null;
    error.payload = payload || {};
    return error;
}

function apiFailureFromBody(body = {}, response = null, fallback = 'API error') {
    const requestId = body.requestId || body.request_id || null;
    return {
        success: false,
        error: formatApiErrorPayload(body, fallback),
        code: body.code || null,
        conflict: body.conflict || false,
        conflictBookingId: body.conflictBookingId || body.details?.conflictBookingId || null,
        currentData: body.currentData || null,
        currentStatus: body.currentStatus || null,
        currentArrival: body.currentArrival ?? body.details?.currentArrival ?? null,
        currentUpdatedAt: body.currentUpdatedAt || body.details?.currentUpdatedAt || null,
        status: response?.status || body.status || null,
        requestId,
        details: body.details || null
    };
}

function apiAuthFailure(response = null) {
    const failure = getApiAuthSessionFailure();
    if (!response && failure?.transient) {
        return {
            ...apiFailureFromBody(
                {
                    error: 'Тимчасово не вдалося підтвердити сесію. Спробуйте ще раз.',
                    code: 'auth_session_temporarily_unavailable'
                },
                null,
                'Тимчасово не вдалося підтвердити сесію. Спробуйте ще раз.'
            ),
            authTransient: true,
            retryable: true
        };
    }
    return apiFailureFromBody(
        { error: 'Сесію завершено. Увійдіть знову.' },
        response,
        'Сесію завершено. Увійдіть знову.'
    );
}

function apiOfflineFailure(err, fallback = 'Немає звʼязку з сервером. Перевірте інтернет і спробуйте ще раз.') {
    return {
        success: false,
        error: fallback,
        offline: true,
        status: null,
        requestId: null,
        details: err?.message ? { message: err.message } : null
    };
}

function normalizeApiErrorResult(errorOrPayload = {}, fallbackMessage = 'API error') {
    if (errorOrPayload && errorOrPayload.success === true) return errorOrPayload;

    const isError = errorOrPayload instanceof Error;
    const payload = typeof errorOrPayload === 'string'
        ? { error: errorOrPayload }
        : (isError
            ? {
                error: errorOrPayload.message,
                message: errorOrPayload.message,
                offline: true,
                details: errorOrPayload.message ? { message: errorOrPayload.message } : null
            }
            : (errorOrPayload || {}));
    const status = payload.status || payload.response?.status || null;
    const requestId = payload.requestId || payload.request_id || payload.details?.requestId || payload.details?.request_id || null;
    const formattedPayload = {
        ...payload,
        status,
        requestId
    };

    return {
        ...payload,
        success: false,
        error: formatApiErrorPayload(formattedPayload, fallbackMessage),
        offline: Boolean(payload.offline || (isError && !status)),
        status,
        requestId
    };
}

async function apiErrorFromResponse(response, fallback = 'API error') {
    const payload = await response.json().catch(() => ({}));
    return apiErrorFromPayload({ ...payload, status: response.status }, fallback);
}

function timelineApiUrl(url, options = {}) {
    if (options.businessContext) {
        if (/[?&](businessContext|business_context)=/.test(String(url || ''))) return url;
        const joiner = url.includes('?') ? '&' : '?';
        return `${url}${joiner}businessContext=${encodeURIComponent(String(options.businessContext))}`;
    }
    if (typeof window !== 'undefined' && window.TimelineBusinessContext) {
        return window.TimelineBusinessContext.appendApiContext(url);
    }
    return url;
}

function timelineApiUrlWithView(url, options = {}) {
    let path = timelineApiUrl(url, options);
    const view = options.timelineView || (typeof window !== 'undefined' ? window.TimelineView?.current?.() : null);
    if (view) {
        path += `${path.includes('?') ? '&' : '?'}timelineView=${encodeURIComponent(String(view))}`;
    }
    return path;
}

function timelineApiPayload(payload) {
    if (typeof window !== 'undefined' && window.TimelineBusinessContext) {
        return window.TimelineBusinessContext.withApiContext(payload);
    }
    return payload;
}

const CRM_BUSINESS_STORAGE_KEY = 'pzp_crm_business_context';
const CRM_BUSINESS_STORAGE_USER_KEY = 'pzp_crm_business_context_user';
const CRM_BUSINESS_SCOPE_STORAGE_KEY = 'pzp_crm_business_scope_mode';
const CRM_BUSINESS_SCOPE_CONTEXTS_STORAGE_KEY = 'pzp_crm_business_scope_contexts';
const CRM_BUSINESS_LEGACY_PRODUCT_STORAGE_KEY = 'pzp_products_business_context';
const CRM_BUSINESS_DEFAULT_CONTEXT = 'event_genix';
const CRM_BUSINESS_SCOPE_SINGLE = 'single';
const CRM_BUSINESS_SCOPE_MULTI = 'multi';
const CRM_BUSINESS_SCOPE_ALL = 'all';
const CRM_BUSINESS_SCOPE_READ_ONLY = new Set([CRM_BUSINESS_SCOPE_MULTI, CRM_BUSINESS_SCOPE_ALL]);
const CRM_BUSINESS_CONTEXTS = Object.freeze({
    event_genix: {
        key: 'event_genix',
        label: 'Парк Закревського',
        shortLabel: 'Парк',
        pageAllowlist: null,
        modules: [
            'dashboard', 'timeline', 'tasks', 'chat', 'customers', 'leads', 'omni',
            'reports', 'finance', 'copilot', 'staff', 'hr', 'training', 'checkin',
            'programs', 'kitchen', 'catalogs', 'content', 'art', 'graduation',
            'sound', 'afisha', 'certificates', 'kleshnya', 'guardian', 'center',
            'warehouse', 'game', 'demo', 'settings'
        ]
    },
    dar: {
        key: 'dar',
        label: 'Дар',
        shortLabel: 'Дар',
        pageAllowlist: null,
        modules: [
            'dashboard', 'timeline', 'tasks', 'chat', 'customers', 'leads', 'omni', 'reports',
            'finance', 'copilot', 'staff', 'hr', 'content', 'art',
            'warehouse', 'kleshnya', 'center', 'settings'
        ]
    },
    maysternya_doli: {
        key: 'maysternya_doli',
        label: 'Майстерня долі',
        shortLabel: 'МД',
        pageAllowlist: '/maysternya-doli',
        modules: [
            'dashboard', 'timeline', 'tasks', 'chat', 'customers', 'leads', 'omni',
            'reports', 'finance', 'programs', 'content', 'kleshnya', 'settings'
        ]
    },
    crm: {
        key: 'crm',
        label: 'CRM продажі',
        shortLabel: 'CRM',
        pageAllowlist: null,
        modules: [
            'dashboard', 'tasks', 'chat', 'customers', 'leads', 'omni', 'reports',
            'finance', 'copilot', 'staff', 'hr', 'content', 'kleshnya', 'center',
            'settings'
        ]
    }
});
const CRM_BUSINESS_CONTEXT_ALIASES = Object.freeze({
    park_zakrevsky: CRM_BUSINESS_DEFAULT_CONTEXT,
    park: CRM_BUSINESS_DEFAULT_CONTEXT,
    pzp: CRM_BUSINESS_DEFAULT_CONTEXT,
    maysternya: 'maysternya_doli',
    md: 'maysternya_doli',
    crm_sales: 'crm',
    sales_crm: 'crm',
    'срм': 'crm'
});
const CRM_BUSINESS_SWITCH_ROLES = Object.freeze([
    'creator',
    'director'
]);
const CRM_BUSINESS_SCOPED_PAGES = Object.freeze({
    dashboard: { id: 'dashboard', label: 'Dashboard', paths: ['/dashboard'] },
    timeline: { id: 'timeline', label: 'Timeline', paths: ['/', '/maysternya-doli'] },
    products: { id: 'products', label: 'Products', paths: ['/programs'] },
    leads: { id: 'leads', label: 'Leads', paths: ['/sales-funnel', '/leads'] },
    customers: { id: 'customers', label: 'Customers', paths: ['/customers'] },
    warehouse: { id: 'warehouse', label: 'Warehouse', paths: ['/warehouse'] },
    hr: { id: 'hr', label: 'HR', paths: ['/hr', '/staff'] },
    reports: { id: 'reports', label: 'Reports', paths: ['/reports', '/finance', '/analytics'] },
    content: { id: 'content', label: 'Content', paths: ['/content', '/art', '/designer', '/designs'] },
    system: { id: 'system', label: 'System', paths: ['/tasks', '/chat', '/omni', '/copilot', '/center'] }
});
const CRM_BUSINESS_AGGREGATE_PAGE_IDS = new Set(['dashboard', 'products', 'leads', 'customers', 'reports']);
const crmBusinessPageBindings = new Map();
const crmBusinessProfileState = {
    profile: null,
    activeProfile: null,
    businessesById: new Map(),
    loadedAt: 0
};

function normalizeCrmBusinessContext(value) {
    const key = String(value || '').trim().toLowerCase();
    if (CRM_BUSINESS_CONTEXT_ALIASES[key]) return CRM_BUSINESS_CONTEXT_ALIASES[key];
    return CRM_BUSINESS_CONTEXTS[key] ? key : CRM_BUSINESS_DEFAULT_CONTEXT;
}

function parseCrmBusinessContextList(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];
    const text = value.trim();
    if (!text) return [];
    try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) return parsed;
    } catch {}
    return text.split(/[,;\s]+/);
}

function normalizeCrmBusinessContextList(value, fallback = []) {
    const source = parseCrmBusinessContextList(value);
    const normalized = [];
    source.forEach(item => {
        const key = normalizeCrmBusinessContext(item);
        if (CRM_BUSINESS_CONTEXTS[key] && !normalized.includes(key)) normalized.push(key);
    });
    return normalized.length ? normalized : [...fallback];
}

function normalizeCrmBusinessScopeMode(value) {
    const raw = String(value || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
    if (raw === 'all' || raw === 'all-business' || raw === 'overview') return CRM_BUSINESS_SCOPE_ALL;
    if (raw === 'multi' || raw === 'many' || raw === 'selected' || raw === 'several') return CRM_BUSINESS_SCOPE_MULTI;
    return CRM_BUSINESS_SCOPE_SINGLE;
}

function normalizedCrmPath(pathname = '') {
    return String(pathname || (typeof window !== 'undefined' ? window.location.pathname : '') || '/')
        .replace(/\.html$/, '')
        .replace(/\/+$/, '') || '/';
}

function crmBusinessContextFromRoute(pathname = '') {
    const path = normalizedCrmPath(pathname);
    if (path === '/maysternya-doli') return 'maysternya_doli';
    return null;
}

function crmBusinessContextFromUrl() {
    try {
        const params = new URLSearchParams(window.location.search || '');
        const value = params.get('businessContext') || params.get('business_context');
        return value ? normalizeCrmBusinessContext(value) : null;
    } catch {
        return null;
    }
}

function crmBusinessScopeFromUrl() {
    try {
        const params = new URLSearchParams(window.location.search || '');
        const rawMode = params.get('businessScope') || params.get('business_scope');
        const rawContext = params.get('businessContext') || params.get('business_context');
        const mode = normalizeCrmBusinessScopeMode(rawMode || rawContext);
        if (mode === CRM_BUSINESS_SCOPE_SINGLE) return null;
        return {
            mode,
            activeContext: crmBusinessContextFromUrl() || CRM_BUSINESS_DEFAULT_CONTEXT,
            selectedContexts: normalizeCrmBusinessContextList(
                params.get('businessContexts') || params.get('business_contexts'),
                []
            )
        };
    } catch {
        return null;
    }
}

function crmBusinessStorageUserKey(user) {
    if (!user) return '';
    return String(user.id || user.username || user.name || '').trim();
}

function removeCrmBusinessStorageKeys(keys = []) {
    try {
        keys.forEach(key => localStorage.removeItem(key));
    } catch {}
}

function clearCrmBusinessScopeStorage() {
    removeCrmBusinessStorageKeys([
        CRM_BUSINESS_SCOPE_STORAGE_KEY,
        CRM_BUSINESS_SCOPE_CONTEXTS_STORAGE_KEY
    ]);
}

function clearCrmBusinessContextStorage() {
    removeCrmBusinessStorageKeys([
        CRM_BUSINESS_STORAGE_KEY,
        CRM_BUSINESS_STORAGE_USER_KEY,
        CRM_BUSINESS_LEGACY_PRODUCT_STORAGE_KEY,
        CRM_BUSINESS_SCOPE_STORAGE_KEY,
        CRM_BUSINESS_SCOPE_CONTEXTS_STORAGE_KEY
    ]);
}

function rawCrmBusinessContextFromStorage() {
    try {
        const primary = localStorage.getItem(CRM_BUSINESS_STORAGE_KEY);
        if (primary) return { value: primary, sourceKey: CRM_BUSINESS_STORAGE_KEY };
        const legacy = localStorage.getItem(CRM_BUSINESS_LEGACY_PRODUCT_STORAGE_KEY);
        if (legacy) return { value: legacy, sourceKey: CRM_BUSINESS_LEGACY_PRODUCT_STORAGE_KEY };
    } catch {}
    return { value: null, sourceKey: null };
}

function resolveStoredCrmBusinessContext(user = null, options = {}) {
    try {
        const { value, sourceKey } = rawCrmBusinessContextFromStorage();
        if (!value) return null;
        const currentUserKey = crmBusinessStorageUserKey(user);
        const storedUserKey = String(localStorage.getItem(CRM_BUSINESS_STORAGE_USER_KEY) || '').trim();
        if (currentUserKey && storedUserKey !== currentUserKey) {
            clearCrmBusinessContextStorage();
            return null;
        }
        const rawKey = String(value || '').trim().toLowerCase();
        const aliasKey = CRM_BUSINESS_CONTEXT_ALIASES[rawKey] || rawKey;
        if (!CRM_BUSINESS_CONTEXTS[aliasKey]) {
            clearCrmBusinessContextStorage();
            return null;
        }
        const key = normalizeCrmBusinessContext(value);
        const policy = user ? resolveCrmBusinessPolicy(user) : null;
        if (policy && !policy.allowed.includes(key)) {
            clearCrmBusinessContextStorage();
            return null;
        }
        if (options.repair !== false && (sourceKey !== CRM_BUSINESS_STORAGE_KEY || value !== key)) {
            localStorage.setItem(CRM_BUSINESS_STORAGE_KEY, key);
            if (currentUserKey) localStorage.setItem(CRM_BUSINESS_STORAGE_USER_KEY, currentUserKey);
            localStorage.removeItem(CRM_BUSINESS_LEGACY_PRODUCT_STORAGE_KEY);
            clearCrmBusinessScopeStorage();
        }
        return {
            key,
            sourceKey,
            raw: value
        };
    } catch {
        return null;
    }
}

function crmBusinessContextFromStorage(user = null) {
    return resolveStoredCrmBusinessContext(user)?.key || null;
}

function crmBusinessScopeFromStorage(user = null) {
    try {
        const currentUserKey = crmBusinessStorageUserKey(user);
        const storedUserKey = String(localStorage.getItem(CRM_BUSINESS_STORAGE_USER_KEY) || '').trim();
        if (currentUserKey && storedUserKey !== currentUserKey) {
            clearCrmBusinessContextStorage();
            return null;
        }
        const mode = normalizeCrmBusinessScopeMode(localStorage.getItem(CRM_BUSINESS_SCOPE_STORAGE_KEY));
        if (mode === CRM_BUSINESS_SCOPE_SINGLE) return null;
        return {
            mode,
            activeContext: crmBusinessContextFromStorage(user) || CRM_BUSINESS_DEFAULT_CONTEXT,
            selectedContexts: normalizeCrmBusinessContextList(
                localStorage.getItem(CRM_BUSINESS_SCOPE_CONTEXTS_STORAGE_KEY),
                []
            )
        };
    } catch {
        return null;
    }
}

function crmBusinessRoles(user) {
    return [user?.role]
        .concat(Array.isArray(user?.roles) ? user.roles : [])
        .concat(Array.isArray(user?.extraRoles) ? user.extraRoles : [])
        .concat(Array.isArray(user?.extra_roles) ? user.extra_roles : [])
        .filter(Boolean)
        .map(String);
}

function crmBusinessPageAllowlist(user) {
    return []
        .concat(Array.isArray(user?.pageAllowlist) ? user.pageAllowlist : [])
        .concat(Array.isArray(user?.page_allowlist) ? user.page_allowlist : [])
        .filter(Boolean)
        .map(String);
}

function crmBusinessAssignedContexts(user) {
    return []
        .concat(Array.isArray(user?.businessContexts) ? user.businessContexts : [])
        .concat(Array.isArray(user?.business_contexts) ? user.business_contexts : [])
        .concat(Array.isArray(user?.allowedBusinessContexts) ? user.allowedBusinessContexts : [])
        .map(normalizeCrmBusinessContext)
        .filter((value, index, arr) => CRM_BUSINESS_CONTEXTS[value] && arr.indexOf(value) === index);
}

function crmBusinessUserCanSwitch(user) {
    return crmBusinessRoles(user).some(role => CRM_BUSINESS_SWITCH_ROLES.includes(role));
}

function crmBusinessExplicitForcedContext(user) {
    return user?.forcedBusinessContext
        || user?.forced_business_context
        || user?.businessContext
        || user?.business_context
        || user?.tenantBusinessContext
        || user?.tenant_business_context
        || null;
}

function crmBusinessExplicitDefaultContext(user) {
    return user?.defaultBusinessContext
        || user?.default_business_context
        || user?.preferredBusinessContext
        || user?.preferred_business_context
        || null;
}

function crmBusinessAllowedContexts(user) {
    if (!user) return [CRM_BUSINESS_DEFAULT_CONTEXT];
    if (!crmBusinessUserCanSwitch(user)) return [CRM_BUSINESS_DEFAULT_CONTEXT];
    const assigned = crmBusinessAssignedContexts(user);
    if (assigned.length) return assigned;
    if (crmBusinessUserCanSwitch(user)) return Object.keys(CRM_BUSINESS_CONTEXTS);
    const allowed = new Set([CRM_BUSINESS_DEFAULT_CONTEXT]);
    const allowlist = crmBusinessPageAllowlist(user);
    Object.values(CRM_BUSINESS_CONTEXTS).forEach(ctx => {
        if (ctx.pageAllowlist && allowlist.includes(ctx.pageAllowlist)) allowed.add(ctx.key);
    });
    return Array.from(allowed);
}

function resolveCrmBusinessDefaultContext(user, allowed = crmBusinessAllowedContexts(user)) {
    const normalizedAllowed = (Array.isArray(allowed) && allowed.length ? allowed : [CRM_BUSINESS_DEFAULT_CONTEXT])
        .map(normalizeCrmBusinessContext)
        .filter((key, index, arr) => CRM_BUSINESS_CONTEXTS[key] && arr.indexOf(key) === index);
    const explicitDefault = crmBusinessExplicitDefaultContext(user);
    if (explicitDefault) {
        const key = normalizeCrmBusinessContext(explicitDefault);
        if (normalizedAllowed.includes(key)) return key;
    }
    const explicitForced = crmBusinessExplicitForcedContext(user);
    if (explicitForced) {
        const key = normalizeCrmBusinessContext(explicitForced);
        if (normalizedAllowed.includes(key)) return key;
    }
    const nonDefault = normalizedAllowed.filter(ctx => ctx !== CRM_BUSINESS_DEFAULT_CONTEXT);
    if (nonDefault.length === 1) return nonDefault[0];
    return normalizedAllowed.includes(CRM_BUSINESS_DEFAULT_CONTEXT)
        ? CRM_BUSINESS_DEFAULT_CONTEXT
        : (normalizedAllowed[0] || CRM_BUSINESS_DEFAULT_CONTEXT);
}

function resolveCrmBusinessPolicy(user) {
    if (user && !crmBusinessUserCanSwitch(user)) {
        return {
            canSwitch: false,
            forced: CRM_BUSINESS_DEFAULT_CONTEXT,
            allowed: [CRM_BUSINESS_DEFAULT_CONTEXT],
            defaultContext: CRM_BUSINESS_DEFAULT_CONTEXT
        };
    }
    const allowed = crmBusinessAllowedContexts(user);
    const serverPolicy = user?.businessContextPolicy || user?.business_context_policy || null;
    if (serverPolicy && Array.isArray(serverPolicy.allowed)) {
        const serverAllowed = serverPolicy.allowed.map(normalizeCrmBusinessContext).filter(key => CRM_BUSINESS_CONTEXTS[key]);
        if (serverAllowed.length) {
            const serverDefault = normalizeCrmBusinessContext(serverPolicy.defaultContext || serverPolicy.default_context || serverPolicy.forced || serverAllowed[0]);
            return {
                canSwitch: Boolean(serverPolicy.canSwitch || serverAllowed.length > 1),
                forced: serverPolicy.forced ? normalizeCrmBusinessContext(serverPolicy.forced) : null,
                allowed: serverAllowed,
                defaultContext: serverAllowed.includes(serverDefault) ? serverDefault : serverAllowed[0]
            };
        }
    }
    const assigned = crmBusinessAssignedContexts(user);
    const canSwitch = Boolean(user && allowed.length > 1 && (crmBusinessUserCanSwitch(user) || assigned.length > 1));
    const explicit = crmBusinessExplicitForcedContext(user);
    const nonDefault = allowed.filter(ctx => ctx !== CRM_BUSINESS_DEFAULT_CONTEXT);
    const forced = canSwitch
        ? null
        : normalizeCrmBusinessContext(explicit || (nonDefault.length === 1 ? nonDefault[0] : CRM_BUSINESS_DEFAULT_CONTEXT));
    const defaultContext = resolveCrmBusinessDefaultContext(user, allowed);
    return {
        canSwitch,
        forced,
        allowed: canSwitch ? allowed : [forced || defaultContext || CRM_BUSINESS_DEFAULT_CONTEXT],
        defaultContext: forced || defaultContext || CRM_BUSINESS_DEFAULT_CONTEXT
    };
}

function normalizeCrmBusinessProfilePayload(payload = {}) {
    const profile = payload.businessProfile || payload.profile || payload;
    const businesses = Array.isArray(profile?.businesses) ? profile.businesses : [];
    const businessesById = new Map();
    businesses.forEach(item => {
        const key = normalizeCrmBusinessContext(item?.key || item?.id || item?.businessContext);
        if (!CRM_BUSINESS_CONTEXTS[key]) return;
        businessesById.set(key, {
            ...item,
            key,
            id: key,
            businessContext: key
        });
    });
    const activeKey = normalizeCrmBusinessContext(
        profile?.activeBusinessId
        || profile?.activeBusinessContext
        || profile?.scope?.activeContext
        || businesses[0]?.key
    );
    return {
        ...profile,
        activeBusinessId: activeKey,
        activeBusinessContext: activeKey,
        businesses: Array.from(businessesById.values()),
        activeProfile: businessesById.get(activeKey) || Array.from(businessesById.values())[0] || null
    };
}

function applyCrmBusinessProfile(profileInput = {}, options = {}) {
    const profile = normalizeCrmBusinessProfilePayload(profileInput);
    crmBusinessProfileState.profile = profile;
    crmBusinessProfileState.activeProfile = profile.activeProfile || null;
    crmBusinessProfileState.businessesById = new Map(
        (profile.businesses || []).map(item => [item.key, item])
    );
    crmBusinessProfileState.loadedAt = Date.now();

    if (profile.scope && options.syncScope !== false) {
        setCrmBusinessScope(profile.scope, {
            user: options.user || (typeof AppState !== 'undefined' ? AppState.currentUser : null),
            updateUrl: options.updateUrl !== false,
            emit: false,
            allowAggregate: true
        });
    }

    if (typeof window !== 'undefined' && window.TimelineBusinessContext?.saveDisplaySettings) {
        (profile.businesses || []).forEach(business => {
            if (!business?.timeline) return;
            const timelineContext = window.TimelineBusinessContext.contextForBusiness?.(business)
                || window.TimelineBusinessContext.CONTEXTS?.[business.key];
            if (!timelineContext) return;
            window.TimelineBusinessContext.saveDisplaySettings(business.timeline, {
                context: timelineContext,
                source: 'server_business_profile',
                merge: false
            });
        });
    }

    if (typeof document !== 'undefined' && document.body && profile.activeProfile) {
        document.body.dataset.crmBusinessContext = profile.activeProfile.key;
        document.body.dataset.crmBusinessType = profile.activeProfile.type || '';
        document.body.dataset.crmBusinessStartPage = profile.activeProfile.startPage || '';
        document.body.dataset.crmBusinessStartPath = profile.activeProfile.startPagePath || '';
        document.body.dataset.crmBusinessTimelineEnabled = profile.activeProfile.shell?.timelineEnabled === false ? 'false' : 'true';
    }

    if (typeof window !== 'undefined' && options.emit !== false) {
        window.dispatchEvent(new CustomEvent('crmBusinessProfileChanged', {
            detail: { profile, activeProfile: profile.activeProfile }
        }));
    }

    return profile;
}

function getCrmBusinessOperatingProfile() {
    return crmBusinessProfileState.profile || null;
}

function getCrmBusinessProfileForContext(context = getCrmBusinessContext()) {
    const key = normalizeCrmBusinessContext(context);
    return crmBusinessProfileState.businessesById.get(key) || null;
}

function crmBusinessContextHasModule(context, moduleId) {
    if (!moduleId) return true;
    const profile = getCrmBusinessProfileForContext(context);
    if (profile?.modules?.enabled && Object.prototype.hasOwnProperty.call(profile.modules.enabled, moduleId)) {
        return profile.modules.enabled[moduleId] !== false;
    }
    const ctx = CRM_BUSINESS_CONTEXTS[normalizeCrmBusinessContext(context)] || CRM_BUSINESS_CONTEXTS[CRM_BUSINESS_DEFAULT_CONTEXT];
    return Array.isArray(ctx.modules) && ctx.modules.includes(String(moduleId));
}

function crmBusinessContextSupportsTimeline(context) {
    return crmBusinessContextHasModule(context, 'timeline');
}

function crmBusinessTimelineRoute(context) {
    const key = normalizeCrmBusinessContext(context);
    if (!crmBusinessContextSupportsTimeline(key)) return null;
    if (key === 'maysternya_doli') return '/maysternya-doli';
    if (key === CRM_BUSINESS_DEFAULT_CONTEXT) return '/';
    return `/?businessContext=${encodeURIComponent(key)}`;
}

function sanitizeCrmBusinessContextForUser(context, user) {
    const key = normalizeCrmBusinessContext(context);
    const policy = resolveCrmBusinessPolicy(user);
    if (policy.canSwitch && policy.allowed.includes(key)) return key;
    if (!policy.canSwitch && policy.allowed.includes(key)) return key;
    return policy.defaultContext;
}

function resolveCrmBusinessContextState(user) {
    const activeUser = user || (typeof AppState !== 'undefined' ? AppState.currentUser : null);
    const fromRoute = crmBusinessContextFromRoute();
    const fromUrl = crmBusinessContextFromUrl();
    const storedInfo = resolveStoredCrmBusinessContext(activeUser);
    const stored = storedInfo?.key || null;
    const policy = resolveCrmBusinessPolicy(activeUser);
    const accountDefault = policy.defaultContext || CRM_BUSINESS_DEFAULT_CONTEXT;
    const timelineEntryDefault = crmBusinessContextSupportsTimeline(accountDefault) ? accountDefault : CRM_BUSINESS_DEFAULT_CONTEXT;
    const preferAccountDefaultOnTimelineRoot = normalizedCrmPath() === '/' && !fromUrl;
    const source = fromRoute
        ? 'route'
        : (fromUrl
            ? 'url'
            : (preferAccountDefaultOnTimelineRoot
                ? 'account_default'
                : (stored ? 'storage' : 'account_default')));
    const requested = fromRoute || fromUrl || (preferAccountDefaultOnTimelineRoot ? timelineEntryDefault : (stored || accountDefault)) || CRM_BUSINESS_DEFAULT_CONTEXT;
    const activeBusinessId = sanitizeCrmBusinessContextForUser(requested, activeUser);
    return {
        activeBusinessId,
        source: activeBusinessId === requested ? source : 'policy_fallback',
        routeBusinessId: fromRoute,
        urlBusinessId: fromUrl,
        storageBusinessId: stored,
        storageSourceKey: storedInfo?.sourceKey || null,
        lastExplicitBusinessId: stored,
        accountDefaultBusinessId: accountDefault,
        timelineEntryDefaultBusinessId: timelineEntryDefault,
        requestedBusinessId: requested,
        availableBusinessIds: policy.allowed,
        canSwitchBusiness: policy.canSwitch,
        policy
    };
}

function getCrmBusinessContext(user) {
    return resolveCrmBusinessContextState(user).activeBusinessId;
}

function crmBusinessPageAllowsAggregate(page = currentCrmBusinessScopedPage()) {
    return !!page && CRM_BUSINESS_AGGREGATE_PAGE_IDS.has(page.id);
}

function crmBusinessPageHasBinding(page = currentCrmBusinessScopedPage()) {
    const resolvedPage = typeof page === 'string'
        ? CRM_BUSINESS_SCOPED_PAGES[page]
        : page;
    return !!resolvedPage?.id && crmBusinessPageBindings.has(resolvedPage.id);
}

function sanitizeCrmBusinessContextListForUser(contexts, user) {
    const policy = resolveCrmBusinessPolicy(user);
    const allowed = policy.canSwitch ? policy.allowed : [policy.defaultContext];
    return normalizeCrmBusinessContextList(contexts, [])
        .filter(context => allowed.includes(context));
}

function sanitizeCrmBusinessScopeForUser(scope = {}, user, options = {}) {
    const policy = resolveCrmBusinessPolicy(user);
    const allowed = policy.canSwitch ? policy.allowed : [policy.defaultContext];
    const defaultContext = allowed.includes(policy.defaultContext)
        ? policy.defaultContext
        : (allowed[0] || CRM_BUSINESS_DEFAULT_CONTEXT);
    const allowAggregate = options.allowAggregate !== false && crmBusinessPageAllowsAggregate(options.page);
    const mode = allowAggregate ? normalizeCrmBusinessScopeMode(scope.mode) : CRM_BUSINESS_SCOPE_SINGLE;
    const activeContext = sanitizeCrmBusinessContextForUser(scope.activeContext || getCrmBusinessContext(user), user);

    if (mode === CRM_BUSINESS_SCOPE_ALL && policy.canSwitch && allowed.length > 1) {
        return {
            mode: CRM_BUSINESS_SCOPE_ALL,
            activeContext: allowed.includes(activeContext) ? activeContext : defaultContext,
            selectedContexts: [...allowed],
            allowedContexts: [...allowed],
            readOnly: true,
            canWrite: false
        };
    }

    if (mode === CRM_BUSINESS_SCOPE_MULTI && policy.canSwitch && allowed.length > 1) {
        const selected = sanitizeCrmBusinessContextListForUser(scope.selectedContexts, user);
        const contexts = selected.length >= 2 ? selected : allowed.slice(0, Math.min(allowed.length, 2));
        return {
            mode: CRM_BUSINESS_SCOPE_MULTI,
            activeContext: contexts[0] || defaultContext,
            selectedContexts: contexts,
            allowedContexts: [...allowed],
            readOnly: true,
            canWrite: false
        };
    }

    return {
        mode: CRM_BUSINESS_SCOPE_SINGLE,
        activeContext,
        selectedContexts: [activeContext],
        allowedContexts: [...allowed],
        readOnly: false,
        canWrite: true
    };
}

function resolveCrmBusinessScopeState(user, options = {}) {
    const activeUser = user || (typeof AppState !== 'undefined' ? AppState.currentUser : null);
    const page = options.page || currentCrmBusinessScopedPage();
    const current = getCrmBusinessContext(activeUser);
    const requested = crmBusinessPageAllowsAggregate(page)
        ? (crmBusinessScopeFromUrl() || crmBusinessScopeFromStorage(activeUser) || {
            mode: CRM_BUSINESS_SCOPE_SINGLE,
            activeContext: current,
            selectedContexts: [current]
        })
        : {
            mode: CRM_BUSINESS_SCOPE_SINGLE,
            activeContext: current,
            selectedContexts: [current]
        };
    return sanitizeCrmBusinessScopeForUser({
        ...requested,
        activeContext: requested.activeContext || current,
        selectedContexts: Array.isArray(requested.selectedContexts) && requested.selectedContexts.length
            ? requested.selectedContexts
            : [requested.activeContext || current]
    }, activeUser, {
        page,
        allowAggregate: options.allowAggregate !== false
    });
}

function getCrmBusinessScope(user) {
    const activeUser = user || (typeof AppState !== 'undefined' ? AppState.currentUser : null);
    return resolveCrmBusinessScopeState(activeUser);
}

function isCrmBusinessScopeReadOnly(scope = getCrmBusinessScope()) {
    return CRM_BUSINESS_SCOPE_READ_ONLY.has(scope?.mode) || scope?.readOnly === true;
}

function crmBusinessReadOnlyMessage(scope = getCrmBusinessScope(), actionLabel = 'змінювати дані') {
    const modeLabel = scope?.mode === CRM_BUSINESS_SCOPE_ALL ? 'усіх бізнесів' : 'кількох бізнесів';
    return `Огляд ${modeLabel} працює тільки для перегляду. Оберіть один бізнес, щоб ${actionLabel}.`;
}

function canWriteCrmBusinessScope(scope = getCrmBusinessScope()) {
    return !isCrmBusinessScopeReadOnly(scope);
}

function guardCrmBusinessWrite(actionLabel = 'змінювати дані', scope = getCrmBusinessScope()) {
    if (canWriteCrmBusinessScope(scope)) return true;
    const message = crmBusinessReadOnlyMessage(scope, actionLabel);
    if (typeof showNotification === 'function') {
        showNotification(message, 'warning');
    } else if (typeof window !== 'undefined' && typeof window.showNotification === 'function') {
        window.showNotification(message, 'warning');
    } else {
        console.warn(message);
    }
    return false;
}

function userCanAccessCrmBusinessContext(user, context) {
    if (!user) return false;
    const key = normalizeCrmBusinessContext(context);
    return resolveCrmBusinessPolicy(user).allowed.includes(key);
}

function getCrmBusinessContextOptions(user) {
    const policy = resolveCrmBusinessPolicy(user);
    const keys = policy.canSwitch ? policy.allowed : [policy.defaultContext];
    return keys
        .map(key => CRM_BUSINESS_CONTEXTS[normalizeCrmBusinessContext(key)])
        .filter(Boolean);
}

function getCrmBusinessState(user) {
    const resolution = resolveCrmBusinessContextState(user);
    const scope = resolveCrmBusinessScopeState(user);
    const page = currentCrmBusinessScopedPage();
    const activeBusinessId = resolution.activeBusinessId;
    return {
        activeBusinessId,
        scope,
        activeBusinessScope: scope.mode,
        selectedBusinessIds: scope.selectedContexts,
        businessScopeReadOnly: scope.readOnly,
        canWriteBusinessScope: scope.canWrite,
        canUseAggregateBusinessScope: crmBusinessPageAllowsAggregate(page),
        lastExplicitBusinessId: resolution.lastExplicitBusinessId,
        source: resolution.source,
        routeBusinessId: resolution.routeBusinessId,
        urlBusinessId: resolution.urlBusinessId,
        storageBusinessId: resolution.storageBusinessId,
        accountDefaultBusinessId: resolution.accountDefaultBusinessId,
        canSwitchBusiness: resolution.canSwitchBusiness,
        availableBusinesses: getCrmBusinessContextOptions(user).map(ctx => ({
            id: ctx.key,
            key: ctx.key,
            label: ctx.label,
            shortLabel: ctx.shortLabel || ctx.label,
            route: crmBusinessDestinationForCurrentPage(ctx.key) || ctx.pageAllowlist || null
        }))
    };
}

function setCrmBusinessContext(context, options = {}) {
    const user = options.user || (typeof AppState !== 'undefined' ? AppState.currentUser : null);
    const previous = getCrmBusinessContext(user);
    const key = sanitizeCrmBusinessContextForUser(context, user);
    try {
        localStorage.setItem(CRM_BUSINESS_STORAGE_KEY, key);
        const userKey = crmBusinessStorageUserKey(user);
        if (userKey) localStorage.setItem(CRM_BUSINESS_STORAGE_USER_KEY, userKey);
        localStorage.removeItem(CRM_BUSINESS_LEGACY_PRODUCT_STORAGE_KEY);
        localStorage.removeItem(CRM_BUSINESS_SCOPE_STORAGE_KEY);
        localStorage.removeItem(CRM_BUSINESS_SCOPE_CONTEXTS_STORAGE_KEY);
    } catch {}
    if (options.updateUrl !== false && typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        const routeContext = crmBusinessContextFromRoute(url.pathname);
        if (key === CRM_BUSINESS_DEFAULT_CONTEXT || routeContext === key) url.searchParams.delete('businessContext');
        else url.searchParams.set('businessContext', key);
        window.history.replaceState(window.history.state || {}, '', url);
    }
    if (typeof document !== 'undefined' && document.body) {
        document.body.dataset.crmBusinessContext = key;
    }
    if (options.emit !== false && typeof window !== 'undefined' && previous !== key) {
        window.dispatchEvent(new CustomEvent('crmBusinessContextChanged', {
            detail: { previous, current: key, context: CRM_BUSINESS_CONTEXTS[key] }
        }));
    }
    return key;
}

function setCrmBusinessScope(scopeInput = {}, options = {}) {
    const user = options.user || (typeof AppState !== 'undefined' ? AppState.currentUser : null);
    const previousScope = getCrmBusinessScope(user);
    const scope = sanitizeCrmBusinessScopeForUser(scopeInput, user, {
        page: currentCrmBusinessScopedPage(),
        allowAggregate: options.allowAggregate !== false
    });
    const previousContext = previousScope.activeContext;
    try {
        localStorage.setItem(CRM_BUSINESS_STORAGE_KEY, scope.activeContext);
        const userKey = crmBusinessStorageUserKey(user);
        if (userKey) localStorage.setItem(CRM_BUSINESS_STORAGE_USER_KEY, userKey);
        localStorage.removeItem(CRM_BUSINESS_LEGACY_PRODUCT_STORAGE_KEY);
        if (scope.mode === CRM_BUSINESS_SCOPE_SINGLE) {
            localStorage.removeItem(CRM_BUSINESS_SCOPE_STORAGE_KEY);
            localStorage.removeItem(CRM_BUSINESS_SCOPE_CONTEXTS_STORAGE_KEY);
        } else {
            localStorage.setItem(CRM_BUSINESS_SCOPE_STORAGE_KEY, scope.mode);
            localStorage.setItem(CRM_BUSINESS_SCOPE_CONTEXTS_STORAGE_KEY, JSON.stringify(scope.selectedContexts));
        }
    } catch {}
    if (options.updateUrl !== false && typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        const routeContext = crmBusinessContextFromRoute(url.pathname);
        if (scope.mode === CRM_BUSINESS_SCOPE_SINGLE) {
            url.searchParams.delete('businessScope');
            url.searchParams.delete('business_scope');
            url.searchParams.delete('businessContexts');
            url.searchParams.delete('business_contexts');
            if (scope.activeContext === CRM_BUSINESS_DEFAULT_CONTEXT || routeContext === scope.activeContext) url.searchParams.delete('businessContext');
            else url.searchParams.set('businessContext', scope.activeContext);
        } else {
            url.searchParams.set('businessScope', scope.mode);
            if (scope.mode === CRM_BUSINESS_SCOPE_MULTI) {
                url.searchParams.set('businessContexts', scope.selectedContexts.join(','));
            } else {
                url.searchParams.delete('businessContexts');
                url.searchParams.delete('business_contexts');
            }
            if (routeContext === scope.activeContext || scope.mode === CRM_BUSINESS_SCOPE_ALL) url.searchParams.delete('businessContext');
            else url.searchParams.set('businessContext', scope.activeContext);
        }
        window.history.replaceState(window.history.state || {}, '', url);
    }
    if (typeof document !== 'undefined' && document.body) {
        document.body.dataset.crmBusinessContext = scope.activeContext;
        document.body.dataset.crmBusinessScope = scope.mode;
        document.body.dataset.crmBusinessReadOnly = scope.readOnly ? 'true' : 'false';
    }
    if (options.emit !== false && typeof window !== 'undefined') {
        const changed = previousScope.mode !== scope.mode
            || previousContext !== scope.activeContext
            || previousScope.selectedContexts.join(',') !== scope.selectedContexts.join(',');
        if (changed) {
            window.dispatchEvent(new CustomEvent('crmBusinessContextChanged', {
                detail: {
                    previous: previousContext,
                    current: scope.activeContext,
                    context: CRM_BUSINESS_CONTEXTS[scope.activeContext],
                    previousScope,
                    scope
                }
            }));
            window.dispatchEvent(new CustomEvent('crmBusinessScopeChanged', {
                detail: { previousScope, scope }
            }));
            if (options.audit !== false && typeof apiLogAction === 'function') {
                apiLogAction('business_scope_switch', 'crm_business_scope', {
                    previousMode: previousScope.mode,
                    mode: scope.mode,
                    previousContext,
                    activeContext: scope.activeContext,
                    selectedContexts: scope.selectedContexts
                });
            }
        }
    }
    return scope;
}

function crmBusinessApiUrl(url, context = getCrmBusinessContext()) {
    const key = normalizeCrmBusinessContext(context);
    const scope = getCrmBusinessScope();
    try {
        const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
        const target = new URL(String(url), base);
        if (scope.mode === CRM_BUSINESS_SCOPE_SINGLE) {
            target.searchParams.set('businessContext', key);
            target.searchParams.delete('businessScope');
            target.searchParams.delete('businessContexts');
        } else {
            target.searchParams.set('businessScope', scope.mode);
            target.searchParams.set('businessContext', scope.activeContext);
            if (scope.mode === CRM_BUSINESS_SCOPE_MULTI) target.searchParams.set('businessContexts', scope.selectedContexts.join(','));
            else target.searchParams.delete('businessContexts');
        }
        if (typeof window !== 'undefined' && target.origin === window.location.origin) {
            return `${target.pathname}${target.search}${target.hash}`;
        }
        return target.toString();
    } catch {
        const joiner = String(url).includes('?') ? '&' : '?';
        if (scope.mode === CRM_BUSINESS_SCOPE_SINGLE) return `${url}${joiner}businessContext=${encodeURIComponent(key)}`;
        const contexts = scope.mode === CRM_BUSINESS_SCOPE_MULTI
            ? `&businessContexts=${encodeURIComponent(scope.selectedContexts.join(','))}`
            : '';
        return `${url}${joiner}businessScope=${encodeURIComponent(scope.mode)}&businessContext=${encodeURIComponent(scope.activeContext)}${contexts}`;
    }
}

function crmBusinessPayload(payload, context = getCrmBusinessContext()) {
    const scope = getCrmBusinessScope();
    if (scope.mode === CRM_BUSINESS_SCOPE_SINGLE) {
        return { ...(payload || {}), businessContext: normalizeCrmBusinessContext(context) };
    }
    return {
        ...(payload || {}),
        businessContext: scope.activeContext,
        businessScope: scope.mode,
        businessContexts: scope.selectedContexts
    };
}

function currentCrmBusinessScopedPage(pathname = '') {
    const path = normalizedCrmPath(pathname);
    return Object.values(CRM_BUSINESS_SCOPED_PAGES).find(page => page.paths.includes(path)) || null;
}

function crmBusinessDestinationForCurrentPage(context, page = currentCrmBusinessScopedPage()) {
    const key = normalizeCrmBusinessContext(context);
    if (page?.id !== 'timeline') return null;
    return crmBusinessTimelineRoute(key) || `/dashboard?businessContext=${encodeURIComponent(key)}`;
}

function crmBusinessHasLeadBookingHandoff(url) {
    const params = url?.searchParams;
    if (!params) return false;
    const hasLead = Boolean(params.get('leadId') || params.get('lead'));
    if (!hasLead) return false;
    return params.get('convert') === 'booking'
        || params.get('open') === 'booking'
        || params.has('bookingMode')
        || params.has('eventDate');
}

function crmBusinessHasTimelineViewHandoff(url, context) {
    const params = url?.searchParams;
    const timelineView = String(params?.get('timelineView') || params?.get('timeline_view') || '').trim();
    if (!['animators', 'rooms'].includes(timelineView)) return false;
    const requestedContext = params.get('businessContext');
    return !requestedContext
        || normalizeCrmBusinessContext(requestedContext) === normalizeCrmBusinessContext(context);
}

function crmBusinessHasTimelineDateHandoff(url, context) {
    const params = url?.searchParams;
    const timelineDate = String(params?.get('date') || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(timelineDate)) return false;
    const parsedDate = new Date(`${timelineDate}T00:00:00`);
    if (Number.isNaN(parsedDate.getTime())) return false;
    const requestedContext = params.get('businessContext');
    return !requestedContext
        || normalizeCrmBusinessContext(requestedContext) === normalizeCrmBusinessContext(context);
}

function crmBusinessDefaultTimelineRouteForUser(user) {
    const policy = resolveCrmBusinessPolicy(user);
    const defaultContext = policy.defaultContext || CRM_BUSINESS_DEFAULT_CONTEXT;
    const profile = getCrmBusinessProfileForContext(defaultContext);
    if (profile?.startPagePath) return profile.startPagePath;
    return crmBusinessTimelineRoute(defaultContext) || '/';
}

function crmBusinessStartPageForUser(user) {
    const policy = resolveCrmBusinessPolicy(user);
    const defaultContext = policy.defaultContext || getCrmBusinessContext(user);
    const profile = getCrmBusinessProfileForContext(defaultContext) || crmBusinessProfileState.activeProfile;
    if (profile?.startPagePath) return profile.startPagePath;
    return crmBusinessDefaultTimelineRouteForUser(user);
}

function navigateCrmBusinessDestination(context, page = currentCrmBusinessScopedPage()) {
    if (typeof window === 'undefined') return false;
    const destination = crmBusinessDestinationForCurrentPage(context, page);
    if (!destination) return false;
    const target = new URL(destination, window.location.origin);
    const current = new URL(window.location.href);
    if (target.pathname === current.pathname && target.search === current.search) return false;
    if (page?.id === 'timeline'
        && target.pathname === current.pathname
        && (crmBusinessHasLeadBookingHandoff(current)
            || crmBusinessHasTimelineViewHandoff(current, context)
            || crmBusinessHasTimelineDateHandoff(current, context))) {
        return false;
    }
    window.__crmBusinessNavigationPending = true;
    window.location.href = `${target.pathname}${target.search}${target.hash}`;
    return true;
}

function renderCrmBusinessShell(user) {
    if (typeof document === 'undefined') return false;
    const page = currentCrmBusinessScopedPage();
    const existing = document.getElementById('globalBusinessContextHost');
    if (existing) existing.remove();
    if (!page) return false;

    const scope = setCrmBusinessScope(resolveCrmBusinessScopeState(user, { page }), {
        user,
        updateUrl: true,
        emit: false,
        allowAggregate: true
    });
    const current = scope.activeContext;
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('crmBusinessContextHydrated', {
            detail: {
                current,
                context: CRM_BUSINESS_CONTEXTS[current],
                scope,
                state: getCrmBusinessState(user),
                page
            }
        }));
    }
    if (scope.mode === CRM_BUSINESS_SCOPE_SINGLE && navigateCrmBusinessDestination(current, page)) return true;
    return false;
}

async function switchCrmBusinessContext(context, options = {}) {
    const scope = await switchCrmBusinessScope({
        mode: CRM_BUSINESS_SCOPE_SINGLE,
        activeContext: context
    }, options);
    return scope.activeContext;
}

async function switchCrmBusinessScope(scopeInput = {}, options = {}) {
    const user = options.user || (typeof AppState !== 'undefined' ? AppState.currentUser : null);
    const nextScope = sanitizeCrmBusinessScopeForUser(scopeInput, user, {
        page: currentCrmBusinessScopedPage(),
        allowAggregate: options.allowAggregate !== false
    });
    const previousScope = getCrmBusinessScope(user);
    const next = nextScope.activeContext;
    const previous = previousScope.activeContext;
    const unchanged = previousScope.mode === nextScope.mode
        && previous === next
        && previousScope.selectedContexts.join(',') === nextScope.selectedContexts.join(',');
    if (unchanged) {
        setCrmBusinessScope(nextScope, { ...options, user, emit: false });
        return nextScope;
    }
    const page = currentCrmBusinessScopedPage();
    const binding = page ? crmBusinessPageBindings.get(page.id) : null;
    if (typeof binding?.beforeChange === 'function') {
        const allowed = await binding.beforeChange(next, previous, { scope: nextScope, previousScope });
        if (allowed === false) return previousScope;
    }
    const currentScope = setCrmBusinessScope(nextScope, { ...options, user, emit: true });
    const current = currentScope.activeContext;
    await hydrateCrmBusinessProfile({ ...options, user, emit: true, updateUrl: false }).catch(() => null);
    if (typeof binding?.onChange === 'function') {
        await binding.onChange({ current, previous, context: CRM_BUSINESS_CONTEXTS[current], scope: currentScope, previousScope });
    }
    if (currentScope.mode === CRM_BUSINESS_SCOPE_SINGLE && options.navigate !== false && navigateCrmBusinessDestination(current, page)) {
        return currentScope;
    }
    return currentScope;
}

function initCrmBusinessContextPage(options = {}) {
    const pageId = options.pageId || currentCrmBusinessScopedPage()?.id;
    const user = options.user || (typeof AppState !== 'undefined' ? AppState.currentUser : null);
    if (pageId) {
        crmBusinessPageBindings.set(pageId, {
            beforeChange: options.beforeChange,
            onChange: options.onChange
        });
    }
    const scope = setCrmBusinessScope(resolveCrmBusinessScopeState(user, {
        page: currentCrmBusinessScopedPage(),
        allowAggregate: options.allowAggregate !== false
    }), {
        user,
        updateUrl: options.updateUrl !== false,
        emit: false,
        allowAggregate: options.allowAggregate !== false
    });
    renderCrmBusinessShell(user);
    return scope.activeContext;
}

async function apiGetBusinessOperatingProfile(options = {}) {
    const url = crmBusinessApiUrl(`${API_BASE}/business/profile`, options.context || getCrmBusinessContext(options.user));
    const response = await apiFetchWithAuthRetry(url, {
        headers: getAuthHeaders(false),
        authSessionSnapshot: options.sessionSnapshot,
        authUser: options.user
    });
    if (!response || handleAuthError(response)) return null;
    return await response.json();
}

async function apiGetBusinessCabinet(options = {}) {
    const url = crmBusinessApiUrl(`${API_BASE}/business/cabinet`, options.context || getCrmBusinessContext(options.user));
    const response = await apiFetchWithAuthRetry(url, { headers: getAuthHeaders(false) });
    if (!response || handleAuthError(response)) return null;
    return await response.json();
}

async function apiSaveBusinessCabinet(payload = {}, options = {}) {
    const context = options.context || payload.businessContext || payload.context || getCrmBusinessContext(options.user);
    const url = crmBusinessApiUrl(`${API_BASE}/business/cabinet`, context);
    const response = await apiFetchWithAuthRetry(url, {
        method: 'PUT',
        headers: getAuthHeaders(true),
        body: JSON.stringify(crmBusinessPayload(payload, context))
    });
    if (!response || handleAuthError(response)) return null;
    return await response.json();
}

async function hydrateCrmBusinessProfile(options = {}) {
    const sessionSnapshot = options.sessionSnapshot || captureApiAuthSessionSnapshot(options.user);
    if (!isApiAuthSessionSnapshotCurrent(sessionSnapshot, options.user)) {
        markApiAuthSessionChanged('business-profile');
        return null;
    }
    try {
        const payload = await apiGetBusinessOperatingProfile(options);
        if (!isApiAuthSessionSnapshotCurrent(sessionSnapshot, options.user)) {
            markApiAuthSessionChanged('business-profile');
            return null;
        }
        if (!payload) return getCrmBusinessOperatingProfile();
        return applyCrmBusinessProfile(payload.businessProfile || payload, options);
    } catch (error) {
        if (!isApiAuthSessionSnapshotCurrent(sessionSnapshot, options.user)) return null;
        console.warn('[CrmBusinessContext] business profile hydrate failed', error);
        return getCrmBusinessOperatingProfile();
    }
}

if (typeof window !== 'undefined') {
    window.CrmBusinessContext = {
        contexts: CRM_BUSINESS_CONTEXTS,
        scopedPages: CRM_BUSINESS_SCOPED_PAGES,
        switchRoles: CRM_BUSINESS_SWITCH_ROLES,
        normalize: normalizeCrmBusinessContext,
        normalizeScopeMode: normalizeCrmBusinessScopeMode,
        current: getCrmBusinessContext,
        resolution: resolveCrmBusinessContextState,
        scope: getCrmBusinessScope,
        scopeResolution: resolveCrmBusinessScopeState,
        set: setCrmBusinessContext,
        setScope: setCrmBusinessScope,
        switchTo: switchCrmBusinessContext,
        switchScope: switchCrmBusinessScope,
        canAccess: userCanAccessCrmBusinessContext,
        hasModule: crmBusinessContextHasModule,
        isReadOnly: isCrmBusinessScopeReadOnly,
        readOnlyMessage: crmBusinessReadOnlyMessage,
        canWrite: canWriteCrmBusinessScope,
        guardWrite: guardCrmBusinessWrite,
        options: getCrmBusinessContextOptions,
        policy: resolveCrmBusinessPolicy,
        state: getCrmBusinessState,
        profile: getCrmBusinessOperatingProfile,
        activeProfile: () => crmBusinessProfileState.activeProfile,
        profileFor: getCrmBusinessProfileForContext,
        applyProfile: applyCrmBusinessProfile,
        hydrateProfile: hydrateCrmBusinessProfile,
        defaultTimelineRouteForUser: crmBusinessDefaultTimelineRouteForUser,
        startPageForUser: crmBusinessStartPageForUser,
        currentPage: currentCrmBusinessScopedPage,
        allowsAggregate: crmBusinessPageAllowsAggregate,
        hasPageBinding: crmBusinessPageHasBinding,
        initPage: initCrmBusinessContextPage,
        renderShell: renderCrmBusinessShell,
        apiUrl: crmBusinessApiUrl,
        payload: crmBusinessPayload
    };
}

// v39.9: Global safe fetch wrapper — auto-checks response.ok, handles auth errors
function applyCrmBusinessScopeHeaders(headers = {}) {
    if (!Object.keys(headers).some(key => String(key).toLowerCase() === 'x-business-context')) {
        headers['X-Business-Context'] = getCrmBusinessContext();
    }
    const scope = getCrmBusinessScope();
    if (scope.mode !== CRM_BUSINESS_SCOPE_SINGLE) {
        headers['X-Business-Scope'] = scope.mode;
        if (scope.mode === CRM_BUSINESS_SCOPE_MULTI) {
            headers['X-Business-Contexts'] = scope.selectedContexts.join(',');
        }
    }
    return headers;
}

const CRM_BUSINESS_MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CRM_BUSINESS_SCOPE_WRITE_EXEMPT_PATHS = new Set([
    '/api/auth/login',
    '/api/auth/refresh',
    '/api/auth/logout',
    '/api/auth/password',
    '/api/auth/security/revoke-sessions',
    '/api/auth/impersonate',
    '/api/auth/log-action',
    '/auth/login',
    '/auth/refresh',
    '/auth/logout',
    '/auth/password',
    '/auth/security/revoke-sessions',
    '/auth/impersonate',
    '/auth/log-action'
]);

function crmBusinessRequestPath(url) {
    try {
        const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
        return new URL(String(url || '/'), base).pathname;
    } catch (_) {
        return String(url || '/').split('?')[0];
    }
}

function assertCrmBusinessWritableRequest(url, method = 'GET') {
    const normalizedMethod = String(method || 'GET').toUpperCase();
    if (!CRM_BUSINESS_MUTATING_METHODS.has(normalizedMethod)) return;
    if (!isCrmBusinessScopeReadOnly()) return;
    const path = crmBusinessRequestPath(url);
    if (CRM_BUSINESS_SCOPE_WRITE_EXEMPT_PATHS.has(path)) return;
    throw apiErrorFromPayload({
        success: false,
        status: 403,
        code: 'business_scope_read_only',
        error: crmBusinessReadOnlyMessage(getCrmBusinessScope(), 'змінювати дані')
    }, 'Read-only business scope');
}

function apiNativeFetch(url, options) {
    return globalThis.fetch(url, options);
}

function apiNetworkShouldUseAuthRetry(url, options = {}) {
    let parsed;
    try {
        const base = typeof window !== 'undefined' && window.location?.origin
            ? window.location.origin
            : 'http://localhost';
        parsed = new URL(String(url || ''), base);
        if (typeof window !== 'undefined' && window.location?.origin && parsed.origin !== window.location.origin) {
            return false;
        }
    } catch {
        return false;
    }
    if (!parsed.pathname.startsWith('/api/')) return false;
    if (['/api/auth/login', '/api/auth/refresh', '/api/auth/verify'].includes(parsed.pathname)) return false;
    return apiHasAuthHeader(apiHeaderObject(options.headers || {})) || apiHasStoredAuthSession();
}

function apiNetworkFetch(url, options = {}) {
    if (apiNetworkShouldUseAuthRetry(url, options)) return apiFetchWithAuthRetry(url, options);
    return apiNativeFetch(url, options);
}

async function readApiResponseJsonForRetry(response) {
    try {
        const source = typeof response?.clone === 'function' ? response.clone() : response;
        return await source?.json?.().catch?.(() => ({})) || {};
    } catch {
        return {};
    }
}

async function classifyApiUnauthorizedResponse(response) {
    if (!response || response.status !== 401) return null;
    // Test doubles and very old fetch shims may not support clone(). Preserve the
    // legacy refresh behavior there; native browser Responses always support it.
    if (typeof response.clone !== 'function') return 'refreshable';
    try {
        const payload = await response.clone().json();
        const code = String(payload?.code || '').trim().toLowerCase();
        if (API_AUTH_REFRESHABLE_UNAUTHORIZED_CODES.has(code)) return 'refreshable';
        if (API_AUTH_TERMINAL_UNAUTHORIZED_CODES.has(code)) return 'terminal';
        return 'semantic';
    } catch {
        return 'semantic';
    }
}

async function safeFetch(url, opts = {}) {
    assertCrmBusinessWritableRequest(url, opts.method || 'GET');
    if (!opts.headers) opts.headers = {};
    if (!opts.headers['Authorization']) {
        const token = getStoredAuthToken();
        if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    }
    applyCrmBusinessScopeHeaders(opts.headers);
    const res = await apiNetworkFetch(url, opts);
    if (!res) return null;
    if (res.status === 401) {
        if (typeof handleAuthError === 'function') handleAuthError(res);
        return null;
    }
    if (!res.ok) {
        throw await apiErrorFromResponse(res, `HTTP ${res.status}`);
    }
    return res;
}

function getAuthHeaders(withContentType = true) {
    const token = getStoredAuthToken();
    const headers = {};
    if (withContentType) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return applyCrmBusinessScopeHeaders(headers);
}

function getTimelineAuthHeaders(withContentType = true) {
    const headers = getAuthHeaders(withContentType);
    delete headers['X-Business-Context'];
    delete headers['x-business-context'];
    delete headers['X-Business-Scope'];
    delete headers['x-business-scope'];
    delete headers['X-Business-Contexts'];
    delete headers['x-business-contexts'];
    Object.defineProperty(headers, API_AUTH_PRESERVE_BUSINESS_SCOPE_HEADERS, {
        value: true,
        enumerable: false
    });
    return headers;
}

function apiHeaderObject(headers = {}) {
    if (!headers) return {};
    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
        const result = {};
        headers.forEach((value, key) => { result[key] = value; });
        return result;
    }
    if (Array.isArray(headers)) return Object.fromEntries(headers);
    return { ...headers };
}

function apiHasAuthHeader(headers = {}) {
    return Object.keys(headers).some(key => String(key).toLowerCase() === 'authorization');
}

function apiWithBearer(headers = {}, token = '', force = false) {
    const next = apiHeaderObject(headers);
    if (token && (force || !apiHasAuthHeader(next))) {
        Object.keys(next).forEach(key => {
            if (String(key).toLowerCase() === 'authorization') delete next[key];
        });
        next.Authorization = `Bearer ${token}`;
    }
    return next;
}

async function apiFetchWithAuthRetry(url, opts = {}) {
    const request = { ...opts };
    const preserveBusinessScopeHeaders = request.authBusinessScope === false
        || opts.headers?.[API_AUTH_PRESERVE_BUSINESS_SCOPE_HEADERS] === true;
    const requiredSessionSnapshot = request.authSessionSnapshot || null;
    const requestedAuthUser = request.authUser && typeof request.authUser === 'object'
        ? request.authUser
        : null;
    delete request.authSessionSnapshot;
    delete request.authUser;
    delete request.authBusinessScope;
    assertCrmBusinessWritableRequest(url, request.method || 'GET');
    if (getActiveApiAuthTransitionMarker()) {
        setApiAuthSessionFailure('transient', { stage: 'request', reason: 'session-transition' });
        return null;
    }
    const originalHeaders = apiHeaderObject(opts.headers || {});
    if (!preserveBusinessScopeHeaders) applyCrmBusinessScopeHeaders(originalHeaders);
    const storedUser = readApiAuthStoredUser();
    const runtimeUser = typeof AppState !== 'undefined' && AppState?.currentUser
        ? AppState.currentUser
        : null;
    if (runtimeUser && storedUser && !apiAuthUsersShareIdentity(runtimeUser, storedUser)) {
        setApiAuthSessionFailure('transient', { stage: 'request', reason: 'session-changed' });
        return null;
    }
    const requestUser = requestedAuthUser || runtimeUser || storedUser;
    if (requiredSessionSnapshot
        && !isApiAuthSessionSnapshotCurrent(requiredSessionSnapshot, requestUser)) {
        markApiAuthSessionChanged('request');
        return null;
    }
    const requestSessionSnapshot = captureApiAuthSessionSnapshot(requestUser);
    const currentTokenForSameIdentity = () => {
        const latestToken = getStoredAuthToken();
        if (!latestToken || !apiAuthUsersShareIdentity(requestUser, readApiAuthStoredUser())) return null;
        return latestToken;
    };
    let token = getStoredAuthToken();
    if (!token && localStorage.getItem(API_AUTH_REFRESH_TOKEN_KEY)) {
        const refreshResult = await apiRefreshAuthSession(requestUser);
        token = refreshResult.accessToken;
        if (!token && refreshResult.outcome === 'superseded') token = currentTokenForSameIdentity();
        if (!token && ['transient', 'superseded', 'identity-mismatch'].includes(refreshResult.outcome)) {
            if (refreshResult.outcome === 'superseded') {
                setApiAuthSessionFailure('transient', { stage: 'request', reason: 'session-changed' });
            }
            return null;
        }
        if (!token && refreshResult.outcome === 'terminal') {
            if (typeof handleAuthError === 'function') {
                handleAuthError({ status: 401 }, { refreshAttempted: true });
            }
            return null;
        }
    }
    if (token && !isApiAuthSessionSnapshotCurrent(requestSessionSnapshot, requestUser)) {
        markApiAuthSessionChanged('request');
        return null;
    }
    if (getActiveApiAuthTransitionMarker()) {
        setApiAuthSessionFailure('transient', { stage: 'request', reason: 'session-transition' });
        return null;
    }
    request.headers = apiWithBearer(originalHeaders, token, true);

    let responseSessionSnapshot = requestSessionSnapshot;
    let response = await apiNativeFetch(url, request);
    if (getActiveApiAuthTransitionMarker()) {
        setApiAuthSessionFailure('transient', { stage: 'request', reason: 'session-transition' });
        return null;
    }
    let unauthorizedKind = await classifyApiUnauthorizedResponse(response);
    if (response.status !== 401
        && !isApiAuthSessionSnapshotCurrent(responseSessionSnapshot, requestUser)) {
        markApiAuthSessionChanged('request');
        return null;
    }
    if (response.status === 401
        && unauthorizedKind === 'refreshable'
        && localStorage.getItem(API_AUTH_REFRESH_TOKEN_KEY)) {
        if (!isApiAuthSessionSnapshotCurrent(responseSessionSnapshot, requestUser)) {
            markApiAuthSessionChanged('request');
            return null;
        }
        const latestStoredToken = getStoredAuthToken();
        if (latestStoredToken && latestStoredToken !== token) {
            const sameIdentityToken = currentTokenForSameIdentity();
            if (!sameIdentityToken) {
                // Never replay a request under a different signed-in account.
                setApiAuthSessionFailure('transient', { stage: 'request', reason: 'session-changed' });
                return null;
            }
            token = sameIdentityToken;
            responseSessionSnapshot = captureApiAuthSessionSnapshot(requestUser);
            if (getActiveApiAuthTransitionMarker()
                || getStoredAuthToken() !== token
                || !isApiAuthSessionSnapshotCurrent(responseSessionSnapshot, requestUser)) {
                setApiAuthSessionFailure('transient', { stage: 'request', reason: 'session-transition' });
                return null;
            }
            response = await apiNativeFetch(url, {
                ...request,
                headers: apiWithBearer(originalHeaders, token, true)
            });
            if (getActiveApiAuthTransitionMarker()) {
                setApiAuthSessionFailure('transient', { stage: 'request', reason: 'session-transition' });
                return null;
            }
            unauthorizedKind = await classifyApiUnauthorizedResponse(response);
        } else {
            const refreshResult = await apiRefreshAuthSession(requestUser);
            let refreshedToken = refreshResult.accessToken;
            if (!refreshedToken && refreshResult.outcome === 'superseded') {
                refreshedToken = currentTokenForSameIdentity();
            }
            if (refreshedToken) {
                const storedUserAfterRefresh = readApiAuthStoredUser();
                if (!isApiAuthSessionSnapshotCurrent(responseSessionSnapshot, requestUser)
                    || (requestUser && !apiAuthUsersShareIdentity(requestUser, storedUserAfterRefresh))) {
                    markApiAuthSessionChanged('request');
                    return null;
                }
                token = refreshedToken;
                responseSessionSnapshot = captureApiAuthSessionSnapshot(requestUser);
                if (getActiveApiAuthTransitionMarker()
                    || getStoredAuthToken() !== refreshedToken
                    || !isApiAuthSessionSnapshotCurrent(responseSessionSnapshot, requestUser)) {
                    setApiAuthSessionFailure('transient', { stage: 'request', reason: 'session-transition' });
                    return null;
                }
                response = await apiNativeFetch(url, {
                    ...request,
                    headers: apiWithBearer(originalHeaders, refreshedToken, true)
                });
                if (getActiveApiAuthTransitionMarker()) {
                    setApiAuthSessionFailure('transient', { stage: 'request', reason: 'session-transition' });
                    return null;
                }
                unauthorizedKind = await classifyApiUnauthorizedResponse(response);
            } else if (['transient', 'superseded', 'identity-mismatch'].includes(refreshResult.outcome)) {
                if (refreshResult.outcome === 'superseded') {
                    setApiAuthSessionFailure('transient', { stage: 'request', reason: 'session-changed' });
                }
                return null;
            } else if (['terminal', 'missing'].includes(refreshResult.outcome)) {
                if (refreshResult.outcome === 'missing') {
                    setApiAuthSessionFailure('terminal', {
                        stage: 'request',
                        status: response.status,
                        reason: 'missing-refresh-session'
                    });
                }
                if (typeof handleAuthError === 'function') {
                    handleAuthError(response, { refreshAttempted: true });
                }
                return null;
            } else {
                setApiAuthSessionFailure('transient', {
                    stage: 'request',
                    reason: 'unknown-refresh-outcome'
                });
                return null;
            }
        }
    }
    if (getActiveApiAuthTransitionMarker()) {
        setApiAuthSessionFailure('transient', { stage: 'request', reason: 'session-transition' });
        return null;
    }
    if (!isApiAuthSessionSnapshotCurrent(responseSessionSnapshot, requestUser)) {
        markApiAuthSessionChanged('request');
        return null;
    }
    const activeToken = getStoredAuthToken();
    if (response?.status === 401 && activeToken && activeToken !== token) {
        setApiAuthSessionFailure('transient', { stage: 'request', reason: 'session-changed' });
        return null;
    }
    if (response?.status === 401 && unauthorizedKind === 'semantic') {
        apiSemanticUnauthorizedResponses.add(response);
        return response;
    }
    if (response && response.status === 401 && typeof handleAuthError === 'function') {
        setApiAuthSessionFailure('terminal', {
            stage: 'request',
            status: response.status,
            reason: 'unauthorized'
        });
        if (handleAuthError(response, { refreshAttempted: true })) return null;
    }
    return response;
}

// v5.0: Handle 401/403 — redirect to login
function handleAuthError(response, options = {}) {
    if (!response) return true;
    if (response.status === 403) {
        return false;
    }
    if (response.status === 401) {
        if (apiSemanticUnauthorizedResponses.has(response)) return false;
        const hasRefreshSession = Boolean(localStorage.getItem(API_AUTH_REFRESH_TOKEN_KEY));
        if (hasRefreshSession && options.refreshAttempted !== true) {
            setApiAuthSessionFailure('transient', {
                stage: 'legacy-request',
                status: response.status,
                reason: 'access-token-expired'
            });
            void apiRefreshAuthSession().then(result => {
                if (!['terminal', 'missing'].includes(result.outcome)) return;
                const isEmbedded = document.documentElement.classList.contains('embed-mode')
                    || (window.self !== window.top);
                if (isEmbedded) return;
                if (typeof clearPrivateClientCaches === 'function') clearPrivateClientCaches();
                if (typeof showLoginScreen === 'function') showLoginScreen();
            });
            return true;
        }
        const existingFailure = getApiAuthSessionFailure();
        if (existingFailure?.kind !== 'terminal') {
            setApiAuthSessionFailure('terminal', {
                stage: 'request',
                status: response.status,
                reason: 'unauthorized'
            });
        }
        // In embedded mode (iframe), never redirect — parent page handles auth
        const isEmbedded = document.documentElement.classList.contains('embed-mode')
            || (window.self !== window.top);
        if (isEmbedded) return true;

        if (typeof clearAuthStorage === 'function') {
            // A late 401 from the previous session must not cancel a newer explicit login.
            clearAuthStorage({ preserveLoginIntent: true });
        } else {
            clearApiAuthSessionStorage();
        }
        if (typeof clearPrivateClientCaches === 'function') clearPrivateClientCaches();
        if (typeof showLoginScreen === 'function') showLoginScreen();
        return true;
    }
    return false;
}

/**
 * v25.3: Unified API call wrapper (#19)
 * Reduces try/catch + handleAuthError boilerplate across 60+ functions.
 * @param {string} method - HTTP method
 * @param {string} url - API path (relative to API_BASE)
 * @param {object|null} body - Request body (auto-stringified)
 * @param {object} opts - { fallback: default return on error, raw: return Response }
 * @returns {Promise<any>}
 */
async function apiCall(method, url, body = null, { fallback = null, raw = false } = {}) {
    try {
        assertCrmBusinessWritableRequest(`${API_BASE}${url}`, method);
        const isGet = method === 'GET';
        const opts = { method, headers: getAuthHeaders(!isGet) };
        if (body && !isGet) opts.body = JSON.stringify(body);
        const response = await apiNetworkFetch(`${API_BASE}${url}`, opts);
        if (handleAuthError(response)) return fallback;
        if (raw) return response;
        if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            return {
                success: false,
                error: formatApiErrorPayload(errBody, 'API error'),
                code: errBody.code || null,
                details: errBody.details || null,
                requestId: errBody.requestId || errBody.request_id || null,
                status: response.status
            };
        }
        return await response.json();
    } catch (err) {
        console.error(`[API] ${method} ${url}:`, err.message);
        return fallback;
    }
}

async function apiGetBookings(date, options = {}) {
    try {
        let path = timelineApiUrlWithView(`/bookings/${date}`, options);
        if (options.fresh) {
            path += `${path.includes('?') ? '&' : '?'}_fresh=${encodeURIComponent(String(Date.now()))}`;
        }
        const response = await apiNetworkFetch(`${API_BASE}${path}`, {
            headers: getTimelineAuthHeaders(false),
            signal: options.signal
        });
        if (handleAuthError(response)) return null;
        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            const error = apiErrorFromPayload({ ...payload, status: response.status }, `Bookings API error ${response.status}`);
            error.url = `${API_BASE}${path}`;
            throw error;
        }
        return await response.json();
    } catch (err) {
        if (err?.name === 'AbortError') throw err;
        console.error('API getBookings error:', {
            message: err?.message,
            status: err?.status || null,
            requestId: err?.requestId || null,
            url: err?.url || null
        });
        if (options.throwOnError) throw err;
        // v7.0.1: Return null on error so cache layer can preserve existing data
        return null;
    }
}

async function apiGetBookingById(id, options = {}) {
    const cleanId = String(id || '').trim();
    if (!cleanId) return { success: false, error: 'Missing booking ID', status: 400 };
    try {
        let path = timelineApiUrl(`/bookings/detail/${encodeURIComponent(cleanId)}`);
        if (options.fresh) {
            path += `${path.includes('?') ? '&' : '?'}_fresh=${encodeURIComponent(String(Date.now()))}`;
        }
        const response = await apiNetworkFetch(`${API_BASE}${path}`, { headers: getTimelineAuthHeaders(false) });
        if (handleAuthError(response)) return { success: false, status: response?.status || 401 };
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            return {
                success: false,
                error: body.error || body.message || `Booking API error ${response.status}`,
                code: body.code || null,
                status: response.status,
                requestId: body.requestId || body.request_id || null
            };
        }
        return body;
    } catch (err) {
        console.error('API getBookingById error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

const admissionTicketQuoteRequests = new Map();

async function apiQuoteAdmissionTickets(payload = {}, options = {}) {
    const sequenceKey = String(options.sequenceKey || 'booking-ticket-quote');
    const previous = admissionTicketQuoteRequests.get(sequenceKey);
    if (previous?.controller) previous.controller.abort();

    const controller = new AbortController();
    const sequence = Number(previous?.sequence || 0) + 1;
    admissionTicketQuoteRequests.set(sequenceKey, { sequence, controller });

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        admissionTicketQuoteRequests.delete(sequenceKey);
        return apiOfflineFailure(
            null,
            'Розрахунок квитків недоступний офлайн. Відновіть з’єднання із сервером.'
        );
    }

    try {
        const url = timelineApiUrl(`${API_BASE}/bookings/ticket-quote`, options);
        const requestOptions = {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload || {}),
            cache: 'no-store',
            signal: controller.signal
        };
        const response = typeof apiFetchWithAuthRetry === 'function'
            ? await apiFetchWithAuthRetry(url, requestOptions)
            : await apiNetworkFetch(url, requestOptions);
        const current = admissionTicketQuoteRequests.get(sequenceKey);
        if (!current || current.sequence !== sequence) {
            return { success: false, stale: true, aborted: true };
        }
        if (!response || handleAuthError(response)) return apiAuthFailure(response);
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body.success === false) {
            return apiFailureFromBody(body, response, 'Не вдалося розрахувати квитки');
        }
        return body;
    } catch (error) {
        if (error?.name === 'AbortError') {
            return { success: false, stale: true, aborted: true };
        }
        return apiOfflineFailure(
            error,
            'Розрахунок квитків недоступний без зв’язку із сервером.'
        );
    } finally {
        const current = admissionTicketQuoteRequests.get(sequenceKey);
        if (current?.sequence === sequence) admissionTicketQuoteRequests.delete(sequenceKey);
    }
}

async function apiGetAdmissionTicketCatalog(options = {}) {
    const dateQuery = options.pricingDate
        ? `?pricingDate=${encodeURIComponent(String(options.pricingDate))}`
        : '';
    const url = timelineApiUrl(`/center/tickets${dateQuery}`, options);
    return apiCall('GET', url, null, { fallback: { success: false, ticketTypes: [] } });
}

async function apiCreateAdmissionTicketTariffRevision(code, payload = {}, options = {}) {
    const url = timelineApiUrl(
        `/center/tickets/${encodeURIComponent(String(code || ''))}/tariffs`,
        options
    );
    return apiCall('POST', url, payload, { fallback: { success: false } });
}

async function apiCreateBooking(booking, options = {}) {
    try {
        const payload = timelineApiPayload(booking);
        if (options.banquetContext) payload.banquetContext = options.banquetContext;
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrlWithView('/bookings', options)}`, {
            method: 'POST',
            headers: getTimelineAuthHeaders(),
            body: JSON.stringify(payload)
        });
        if (handleAuthError(response)) return apiAuthFailure(response);
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return apiFailureFromBody(body, response);
        }
        return await response.json();
    } catch (err) {
        console.error('API createBooking error:', err);
        return apiOfflineFailure(err, 'Не вдалося створити бронювання. Перевірте зʼєднання і спробуйте ще раз.');
    }
}

async function apiCreateEducationLessonSeries(booking) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrl('/bookings/education-series')}`, {
            method: 'POST',
            headers: getTimelineAuthHeaders(),
            body: JSON.stringify(timelineApiPayload({ booking: timelineApiPayload(booking) }))
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return {
                success: false,
                error: body.error || 'API error',
                conflictBookingId: body.conflictBookingId || null,
                conflicts: body.conflicts || []
            };
        }
        return await response.json();
    } catch (err) {
        console.error('API createEducationLessonSeries error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

async function apiGetEducationLessonSeries(seriesId) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrl(`/bookings/education-series/${encodeURIComponent(seriesId)}`)}`, {
            headers: getTimelineAuthHeaders(false)
        });
        if (handleAuthError(response)) return { success: false, bookings: [] };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error', status: response.status, bookings: [] };
        }
        return await response.json();
    } catch (err) {
        console.error('API getEducationLessonSeries error:', err);
        return { success: false, error: err.message, offline: true, bookings: [] };
    }
}

async function apiCancelEducationLessonSeries(seriesId, options = {}) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrl(`/bookings/education-series/${encodeURIComponent(seriesId)}/cancel`)}`, {
            method: 'POST',
            headers: getTimelineAuthHeaders(),
            body: JSON.stringify(timelineApiPayload(options || {}))
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error', status: response.status };
        }
        return await response.json();
    } catch (err) {
        console.error('API cancelEducationLessonSeries error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

// v5.7: Create booking with linked bookings in one transaction
async function apiCreateBookingFull(main, linked, options = {}) {
    try {
        const payload = {
            main: timelineApiPayload(main),
            linked: (linked || []).map(item => timelineApiPayload(item))
        };
        if (Array.isArray(options.banquetActivities) && options.banquetActivities.length > 0) {
            payload.banquetActivities = options.banquetActivities.map(item => timelineApiPayload(item));
        }
        if (options.banquetContext) payload.banquetContext = options.banquetContext;
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrlWithView('/bookings/full', options)}`, {
            method: 'POST',
            headers: getTimelineAuthHeaders(),
            body: JSON.stringify(timelineApiPayload(payload))
        });
        if (handleAuthError(response)) return apiAuthFailure(response);
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return apiFailureFromBody(body, response);
        }
        return await response.json();
    } catch (err) {
        console.error('API createBookingFull error:', err);
        return apiOfflineFailure(err, 'Не вдалося створити бронювання з повʼязаними подіями. Перевірте зʼєднання і спробуйте ще раз.');
    }
}

async function apiGetBanquetByBooking(bookingId) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrl(`/banquets/by-booking/${encodeURIComponent(bookingId)}`)}`, {
            headers: getTimelineAuthHeaders(false)
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error', status: response.status };
        }
        return await response.json();
    } catch (err) {
        console.error('API getBanquetByBooking error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

async function apiUpdateBanquetBookingSet(groupId, payload = {}) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrl(`/banquets/${encodeURIComponent(groupId)}/booking-set`)}`, {
            method: 'PUT',
            headers: getTimelineAuthHeaders(),
            body: JSON.stringify(timelineApiPayload(payload))
        });
        if (handleAuthError(response)) return apiAuthFailure(response);
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return apiFailureFromBody(body, response);
        }
        return await response.json();
    } catch (err) {
        console.error('API updateBanquetBookingSet error:', err);
        return apiOfflineFailure(err, 'Не вдалося зберегти склад банкету. Перевірте з’єднання і спробуйте ще раз.');
    }
}

async function apiGetBanquetDepositByBooking(bookingId) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrl(`/banquets/by-booking/${encodeURIComponent(bookingId)}/deposit`)}`, {
            headers: getTimelineAuthHeaders(false)
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error', status: response.status };
        }
        return await response.json();
    } catch (err) {
        console.error('API getBanquetDepositByBooking error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

async function apiGetBanquetDepositByGroup(groupId) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrl(`/banquets/${encodeURIComponent(groupId)}/deposit`)}`, {
            headers: getTimelineAuthHeaders(false)
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error', status: response.status };
        }
        return await response.json();
    } catch (err) {
        console.error('API getBanquetDepositByGroup error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

async function apiListBanquetDepositsForAccounting(filters = {}) {
    try {
        const params = new URLSearchParams();
        const status = filters.accountingStatus || filters.accounting_status || filters.status || '';
        if (status) params.set('accountingStatus', status);
        const query = params.toString();
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrl(`/banquet-deposits${query ? `?${query}` : ''}`)}`, {
            headers: getTimelineAuthHeaders(false)
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error', status: response.status };
        }
        return await response.json();
    } catch (err) {
        console.error('API listBanquetDepositsForAccounting error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

async function apiStartBanquetDepositReview(depositId) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrl(`/banquet-deposits/${encodeURIComponent(depositId)}/review-start`)}`, {
            method: 'POST',
            headers: getTimelineAuthHeaders(true),
            body: JSON.stringify({})
        });
        if (handleAuthError(response)) return { success: false };
        const body = await response.json().catch(() => ({}));
        if (!response.ok) return { success: false, error: body.error || 'API error', status: response.status };
        return body;
    } catch (err) {
        console.error('API startBanquetDepositReview error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

async function apiUpdateBanquetDepositAccounting(depositId, payload = {}) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrl(`/banquet-deposits/${encodeURIComponent(depositId)}/accounting`)}`, {
            method: 'PATCH',
            headers: getTimelineAuthHeaders(true),
            body: JSON.stringify(payload)
        });
        if (handleAuthError(response)) return { success: false };
        const body = await response.json().catch(() => ({}));
        if (!response.ok) return { success: false, error: body.error || 'API error', status: response.status };
        return body;
    } catch (err) {
        console.error('API updateBanquetDepositAccounting error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

async function apiGetBanquetCandidates(options = {}) {
    try {
        const params = new URLSearchParams();
        if (options.date) params.set('date', options.date);
        if (options.customerId) params.set('customerId', options.customerId);
        if (options.room) params.set('room', options.room);
        if (options.sourceBookingId) params.set('sourceBookingId', options.sourceBookingId);
        if (options.drawerMode) params.set('drawerMode', options.drawerMode);
        if (options.contextGeneration) params.set('contextGeneration', options.contextGeneration);
        const query = params.toString();
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrl(`/banquets/candidates${query ? `?${query}` : ''}`)}`, {
            headers: getTimelineAuthHeaders(false)
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error', status: response.status };
        }
        return await response.json();
    } catch (err) {
        console.error('API getBanquetCandidates error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

async function apiCreateBanquetGroup(primaryBookingId, options = {}) {
    try {
        const payload = timelineApiPayload({
            primaryBookingId,
            groupName: options.groupName || null,
            source: options.source || 'manual',
            meta: options.meta || {},
            banquetContext: options.banquetContext || null
        });
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrl('/banquets')}`, {
            method: 'POST',
            headers: getTimelineAuthHeaders(),
            body: JSON.stringify(payload)
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error', code: body.code || null, status: response.status };
        }
        return await response.json();
    } catch (err) {
        console.error('API createBanquetGroup error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

async function apiCreateBanquetMemberBooking(groupId, payload = {}) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrl(`/banquets/${encodeURIComponent(groupId)}/member-booking`)}`, {
            method: 'POST',
            headers: getTimelineAuthHeaders(),
            body: JSON.stringify(timelineApiPayload({
                sourceBookingId: payload.sourceBookingId,
                role: payload.role || 'kitchen',
                booking: payload.booking || payload.memberBooking || null,
                banquetContext: { mode: 'existing', groupId }
            }))
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return apiFailureFromBody(body, response);
        }
        return await response.json();
    } catch (err) {
        console.error('API createBanquetMemberBooking error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

async function apiCreateBanquetMemberBookingFromSource(payload = {}) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrl('/banquets/from-source/member-booking')}`, {
            method: 'POST',
            headers: getTimelineAuthHeaders(),
            body: JSON.stringify(timelineApiPayload({
                sourceBookingId: payload.sourceBookingId || payload.source_booking_id,
                role: payload.role || 'kitchen',
                booking: payload.booking || payload.memberBooking || payload.member_booking || null,
                banquetContext: payload.banquetContext || null
            }))
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return apiFailureFromBody(body, response);
        }
        return await response.json();
    } catch (err) {
        console.error('API createBanquetMemberBookingFromSource error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

async function apiGetCenterPriceRule(code) {
    const safeCode = String(code || '').trim();
    if (!safeCode) return { success: false, error: 'Price rule code is required' };
    try {
        const response = await apiNetworkFetch(`${API_BASE}/center/prices/${encodeURIComponent(safeCode)}`, {
            headers: getAuthHeaders(false)
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return apiFailureFromBody(body, response);
        }
        return await response.json();
    } catch (err) {
        console.error('API getCenterPriceRule error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

async function apiCreateBanquetActivityBooking(groupId, payload = {}) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrl(`/banquets/${encodeURIComponent(groupId)}/activity-booking`)}`, {
            method: 'POST',
            headers: getTimelineAuthHeaders(),
            body: JSON.stringify(timelineApiPayload({
                sourceBookingId: payload.sourceBookingId,
                booking: payload.booking || payload.activityBooking || null,
                linkedBookings: Array.isArray(payload.linkedBookings) ? payload.linkedBookings : [],
                banquetContext: { mode: 'existing', groupId }
            }))
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return apiFailureFromBody(body, response);
        }
        return await response.json();
    } catch (err) {
        console.error('API createBanquetActivityBooking error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

async function apiCreateBanquetActivityBookingFromSource(payload = {}) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrl('/banquets/from-source/activity-booking')}`, {
            method: 'POST',
            headers: getTimelineAuthHeaders(),
            body: JSON.stringify(timelineApiPayload({
                sourceBookingId: payload.sourceBookingId || payload.source_booking_id,
                booking: payload.booking || payload.activityBooking || payload.activity_booking || null,
                linkedBookings: Array.isArray(payload.linkedBookings) ? payload.linkedBookings : [],
                banquetContext: payload.banquetContext || null
            }))
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return apiFailureFromBody(body, response);
        }
        return await response.json();
    } catch (err) {
        console.error('API createBanquetActivityBookingFromSource error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

async function apiAttachBanquetGroupBooking(groupId, bookingId, options = {}) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrl(`/banquets/${encodeURIComponent(groupId)}/bookings`)}`, {
            method: 'POST',
            headers: getTimelineAuthHeaders(),
            body: JSON.stringify(timelineApiPayload({
                bookingId,
                role: options.role || 'manual',
                label: options.label || null,
                sortOrder: options.sortOrder || null
            }))
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return {
                success: false,
                error: body.error || 'API error',
                code: body.code || null,
                status: response.status
            };
        }
        return await response.json();
    } catch (err) {
        console.error('API attachBanquetGroupBooking error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

async function apiGetBookingCancellationReadiness(id, options = {}) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrl(`/bookings/${encodeURIComponent(id)}/cancellation-readiness`, {
            businessContext: options.businessContext
        })}`, {
            method: 'GET',
            headers: getTimelineAuthHeaders(false)
        });
        if (handleAuthError(response)) return apiAuthFailure(response);
        const body = await response.json().catch(() => ({}));
        if (!response.ok) return apiFailureFromBody(body, response);
        return body;
    } catch (err) {
        console.error('API getBookingCancellationReadiness error:', err);
        return apiOfflineFailure(err, 'Не вдалося перевірити готовність до скасування. Перевірте зʼєднання і спробуйте ще раз.');
    }
}

async function apiCancelBanquetActivity(groupId, bookingId, options = {}) {
    try {
        const headers = getTimelineAuthHeaders(false);
        if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrl(`/banquets/${encodeURIComponent(groupId)}/activities/${encodeURIComponent(bookingId)}`, {
            businessContext: options.businessContext
        })}`, {
            method: 'DELETE',
            headers
        });
        if (handleAuthError(response)) return apiAuthFailure(response);
        const body = await response.json().catch(() => ({}));
        if (!response.ok) return apiFailureFromBody(body, response);
        return body;
    } catch (err) {
        console.error('API cancelBanquetActivity error:', err);
        return apiOfflineFailure(err, 'Не вдалося прибрати складову банкету. Перевірте зʼєднання і спробуйте ще раз.');
    }
}

async function apiCancelBanquetGroup(groupId, options = {}) {
    try {
        const headers = getTimelineAuthHeaders();
        if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrl(`/banquets/${encodeURIComponent(groupId)}/cancel`, {
            businessContext: options.businessContext
        })}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(timelineApiPayload({
                idempotencyKey: options.idempotencyKey || null
            }))
        });
        if (handleAuthError(response)) return apiAuthFailure(response);
        const body = await response.json().catch(() => ({}));
        if (!response.ok) return apiFailureFromBody(body, response);
        return body;
    } catch (err) {
        console.error('API cancelBanquetGroup error:', err);
        return apiOfflineFailure(err, 'Не вдалося скасувати банкет. Перевірте зʼєднання і спробуйте ще раз.');
    }
}

async function apiDeleteBooking(id, options = {}) {
    try {
        const headers = getTimelineAuthHeaders(false);
        if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrl(`/bookings/${id}`)}`, {
            method: 'DELETE',
            headers
        });
        if (handleAuthError(response)) return apiAuthFailure(response);
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return apiFailureFromBody(body, response);
        }
        return await response.json();
    } catch (err) {
        console.error('API deleteBooking error:', err);
        return apiOfflineFailure(err, 'Не вдалося видалити бронювання. Перевірте зʼєднання і спробуйте ще раз.');
    }
}

async function apiUpdateBanquetGuestArrival(groupId, guestArrivalTime, updatedAt, options = {}) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrl(`/banquets/${encodeURIComponent(groupId)}/arrival`, {
            businessContext: options.businessContext
        })}`, {
            method: 'PATCH',
            headers: getTimelineAuthHeaders(),
            body: JSON.stringify(timelineApiPayload({ guestArrivalTime, updatedAt }))
        });
        if (handleAuthError(response)) return apiAuthFailure(response);
        const body = await response.json().catch(() => ({}));
        if (!response.ok) return apiFailureFromBody(body, response);
        return body;
    } catch (err) {
        console.error('API updateBanquetGuestArrival error:', err);
        return apiOfflineFailure(err, 'Не вдалося змінити час приходу гостей. Перевірте зʼєднання і спробуйте ще раз.');
    }
}

async function apiUpdateBooking(id, booking) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrl(`/bookings/${id}`)}`, {
            method: 'PUT',
            headers: getTimelineAuthHeaders(),
            body: JSON.stringify(timelineApiPayload(booking))
        });
        if (handleAuthError(response)) return apiAuthFailure(response);
        // Optimistic locking: 409 with conflict field
        if (response.status === 409) {
            const body = await response.json().catch(() => ({}));
            return {
                ...apiFailureFromBody(body, response, 'Конфлікт даних'),
                conflict: body.conflict || false,
                currentData: body.currentData || null,
                conflictBookingId: body.conflictBookingId || null
            };
        }
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return apiFailureFromBody(body, response);
        }
        return await response.json();
    } catch (err) {
        console.error('API updateBooking error:', err);
        return apiOfflineFailure(err, 'Не вдалося оновити бронювання. Перевірте зʼєднання і спробуйте ще раз.');
    }
}

async function apiConfirmBooking(id, payload = {}) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrl(`/bookings/${encodeURIComponent(id)}/confirm`)}`, {
            method: 'POST',
            headers: getTimelineAuthHeaders(),
            body: JSON.stringify(timelineApiPayload(payload || {}))
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error', status: response.status, currentStatus: body.currentStatus || null };
        }
        return await response.json();
    } catch (err) {
        console.error('API confirmBooking error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

async function apiMarkBookingPreliminary(id, payload = {}) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrl(`/bookings/${encodeURIComponent(id)}/preliminary`)}`, {
            method: 'POST',
            headers: getTimelineAuthHeaders(),
            body: JSON.stringify(timelineApiPayload(payload || {}))
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error', status: response.status, currentStatus: body.currentStatus || null };
        }
        return await response.json();
    } catch (err) {
        console.error('API markBookingPreliminary error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

async function apiUpdateLinkedBookingsAtomic(id, payload) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrl(`/bookings/${encodeURIComponent(id)}/linked-atomic`)}`, {
            method: 'POST',
            headers: getTimelineAuthHeaders(),
            body: JSON.stringify(timelineApiPayload(payload || {}))
        });
        if (handleAuthError(response)) return { success: false };
        if (response.status === 409) {
            const body = await response.json().catch(() => ({}));
            return {
                success: false,
                conflict: true,
                error: body.error || 'Конфлікт даних',
                conflictBookingId: body.conflictBookingId || null
            };
        }
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return {
                success: false,
                error: body.error || 'API error',
                code: body.code || null,
                status: response.status,
                currentStatus: body.currentStatus || null
            };
        }
        return await response.json();
    } catch (err) {
        console.error('API updateLinkedBookingsAtomic error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

async function apiCreateBookingBanquetLink(sourceId, targetId, label = '', relationType = null) {
    try {
        const payload = { targetId, label };
        if (relationType) payload.relationType = relationType;
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrl(`/bookings/${encodeURIComponent(sourceId)}/banquet-links`)}`, {
            method: 'POST',
            headers: getTimelineAuthHeaders(),
            body: JSON.stringify(timelineApiPayload(payload))
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error', status: response.status };
        }
        return await response.json();
    } catch (err) {
        console.error('API createBookingBanquetLink error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

async function apiDeleteBookingBanquetLink(sourceId, targetId, relationType = 'banquet_activity') {
    try {
        let path = timelineApiUrl(`/bookings/${encodeURIComponent(sourceId)}/banquet-links/${encodeURIComponent(targetId)}`);
        if (relationType) {
            path += `${path.includes('?') ? '&' : '?'}relationType=${encodeURIComponent(relationType)}`;
        }
        const response = await apiNetworkFetch(`${API_BASE}${path}`, {
            method: 'DELETE',
            headers: getTimelineAuthHeaders(false)
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error', status: response.status };
        }
        return await response.json();
    } catch (err) {
        console.error('API deleteBookingBanquetLink error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

async function apiGetLines(date, options = {}) {
    try {
        let path = timelineApiUrlWithView(`/lines/${date}`, options);
        if (options.fresh) {
            path += `${path.includes('?') ? '&' : '?'}_fresh=${encodeURIComponent(String(Date.now()))}`;
        }
        const response = await apiNetworkFetch(`${API_BASE}${path}`, {
            headers: getTimelineAuthHeaders(false),
            signal: options.signal
        });
        if (handleAuthError(response)) { console.warn('[apiGetLines] Auth error — returning null'); return null; }
        if (!response.ok) throw new Error('API error ' + response.status);
        const data = await response.json();
        return data;
    } catch (err) {
        if (err?.name === 'AbortError') throw err;
        console.error('[apiGetLines] error:', err);
        return null;
    }
}

async function apiSaveLines(date, lines) {
    try {
        if (typeof window !== 'undefined' && window.TimelineView?.isRooms?.()) {
            return {
                success: false,
                error: 'Room timeline rows cannot be saved through legacy animator lines endpoint',
                code: 'room_timeline_legacy_line_save_blocked'
            };
        }
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrlWithView(`/lines/${date}`)}`, {
            method: 'POST',
            headers: getTimelineAuthHeaders(),
            body: JSON.stringify((lines || []).map(line => timelineApiPayload(line)))
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API saveLines error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

async function apiGetTimelineResources(type = null, options = {}) {
    try {
        const params = new URLSearchParams();
        if (type) params.set('type', type);
        if (options.includeInactive) params.set('includeInactive', 'true');
        const query = params.toString() ? `?${params.toString()}` : '';
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrl(`/timeline/resources${query}`)}`, {
            headers: getTimelineAuthHeaders(false)
        });
        if (handleAuthError(response)) return [];
        if (!response.ok) throw new Error('API error ' + response.status);
        const payload = await response.json();
        return Array.isArray(payload?.resources) ? payload.resources : [];
    } catch (err) {
        console.error('API getTimelineResources error:', err);
        return [];
    }
}

async function apiSaveTimelineResource(resource) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrl('/timeline/resources')}`, {
            method: 'POST',
            headers: getTimelineAuthHeaders(),
            body: JSON.stringify(timelineApiPayload(resource || {}))
        });
        if (handleAuthError(response)) return apiAuthFailure(response);
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return normalizeApiErrorResult({ ...body, status: response.status }, 'API error');
        }
        return await response.json();
    } catch (err) {
        console.error('API saveTimelineResource error:', err);
        return normalizeApiErrorResult(err, 'API error');
    }
}

async function apiUpdateTimelineResource(resourceId, resource) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrl(`/timeline/resources/${encodeURIComponent(resourceId)}`)}`, {
            method: 'PUT',
            headers: getTimelineAuthHeaders(),
            body: JSON.stringify(timelineApiPayload(resource || {}))
        });
        if (handleAuthError(response)) return apiAuthFailure(response);
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return normalizeApiErrorResult({ ...body, status: response.status }, 'API error');
        }
        return await response.json();
    } catch (err) {
        console.error('API updateTimelineResource error:', err);
        return normalizeApiErrorResult(err, 'API error');
    }
}

async function apiDeleteTimelineResource(resourceId, options = {}) {
    try {
        const params = new URLSearchParams();
        if (options.confirmFutureBookings) params.set('confirmFutureBookings', 'true');
        const suffix = params.toString() ? `?${params.toString()}` : '';
        const response = await apiNetworkFetch(`${API_BASE}${timelineApiUrl(`/timeline/resources/${encodeURIComponent(resourceId)}${suffix}`)}`, {
            method: 'DELETE',
            headers: getTimelineAuthHeaders(false)
        });
        if (handleAuthError(response)) return apiAuthFailure(response);
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return normalizeApiErrorResult({ ...body, status: response.status }, 'API error');
        }
        return await response.json();
    } catch (err) {
        console.error('API deleteTimelineResource error:', err);
        return normalizeApiErrorResult(err, 'API error');
    }
}

// v5.16: support filter params
async function apiGetHistory(filters = {}) {
    try {
        const params = new URLSearchParams();
        if (filters.action) params.set('action', filters.action);
        if (filters.user) params.set('user', filters.user);
        if (filters.from) params.set('from', filters.from);
        if (filters.to) params.set('to', filters.to);
        if (filters.search) params.set('search', filters.search);
        if (filters.limit) params.set('limit', filters.limit);
        if (filters.offset) params.set('offset', filters.offset);
        const qs = params.toString();
        const url = `${API_BASE}/history${qs ? '?' + qs : ''}`;
        const response = await apiNetworkFetch(url, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return { items: [], total: 0 };
        if (!response.ok) throw new Error('API error');
        const data = await response.json();
        // Backward compat: if server returns array (old format)
        if (Array.isArray(data)) return { items: data, total: data.length };
        return data;
    } catch (err) {
        console.error('API getHistory error:', err);
        const items = JSON.parse(localStorage.getItem(CONFIG.STORAGE.HISTORY) || '[]');
        return { items, total: items.length };
    }
}

async function apiAddHistory(action, user, data) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/history`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ action, user, data })
        });
        if (handleAuthError(response)) return;
        if (!response.ok) throw new Error('API error');
    } catch (err) {
        console.error('API addHistory error:', err);
        const history = JSON.parse(localStorage.getItem(CONFIG.STORAGE.HISTORY) || '[]');
        history.unshift({ id: Date.now(), action, user, data, timestamp: new Date().toISOString() });
        if (history.length > 500) history.pop();
        localStorage.setItem(CONFIG.STORAGE.HISTORY, JSON.stringify(history));
    }
}

async function apiGetStats(dateFrom, dateTo) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/stats/${dateFrom}/${dateTo}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return [];
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('apiGetStats error:', err);
        return [];
    }
}

// v9.0: Enhanced stats API (server-side aggregation)
async function apiGetStatsRevenue(params = {}) {
    try {
        const qs = new URLSearchParams();
        if (params.period) qs.set('period', params.period);
        if (params.from) qs.set('from', params.from);
        if (params.to) qs.set('to', params.to);
        const url = `${API_BASE}/stats/revenue${qs.toString() ? '?' + qs.toString() : ''}`;
        const response = await apiNetworkFetch(url, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('apiGetStatsRevenue error:', err);
        return null;
    }
}

async function apiGetStatsPrograms(params = {}) {
    try {
        const qs = new URLSearchParams();
        if (params.period) qs.set('period', params.period);
        if (params.from) qs.set('from', params.from);
        if (params.to) qs.set('to', params.to);
        if (params.limit) qs.set('limit', params.limit);
        const url = `${API_BASE}/stats/programs${qs.toString() ? '?' + qs.toString() : ''}`;
        const response = await apiNetworkFetch(url, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('apiGetStatsPrograms error:', err);
        return null;
    }
}

async function apiGetStatsLoad(params = {}) {
    try {
        const qs = new URLSearchParams();
        if (params.period) qs.set('period', params.period);
        if (params.from) qs.set('from', params.from);
        if (params.to) qs.set('to', params.to);
        const url = `${API_BASE}/stats/load${qs.toString() ? '?' + qs.toString() : ''}`;
        const response = await apiNetworkFetch(url, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('apiGetStatsLoad error:', err);
        return null;
    }
}

async function apiGetStatsTrends(period = 'month') {
    try {
        const url = `${API_BASE}/stats/trends?period=${encodeURIComponent(period)}`;
        const response = await apiNetworkFetch(url, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('apiGetStatsTrends error:', err);
        return null;
    }
}

async function apiTelegramNotify(text) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/telegram/notify`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ text })
        });
        if (handleAuthError(response)) return { success: false, reason: 'auth_error' };
        if (!response.ok) return { success: false, reason: 'server_error' };
        return await response.json();
    } catch (err) {
        console.error('Telegram notify error:', err);
        return { success: false, reason: 'network_error' };
    }
}

async function apiTelegramAskAnimator(date, note) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/telegram/ask-animator`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ date, note })
        });
        if (handleAuthError(response)) return { success: false, reason: 'auth_error' };
        let payload = null;
        try {
            payload = await response.json();
        } catch (_) {
            payload = null;
        }
        if (!response.ok) {
            return {
                ...(payload || {}),
                success: false,
                reason: payload?.reason || payload?.error || 'server_error',
                status: response.status
            };
        }
        return payload || { success: false, reason: 'empty_response' };
    } catch (err) {
        console.error('Telegram ask-animator error:', err);
        return { success: false, reason: 'network_error' };
    }
}

async function apiCheckAnimatorStatus(requestId) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/telegram/animator-status/${requestId}`, { headers: getAuthHeaders(false) });
        return await response.json();
    } catch (err) {
        console.error('Check animator status error:', err);
        return { status: 'error' };
    }
}

async function apiGetSetting(key) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/settings/${key}`, { headers: getAuthHeaders(false) });
        const data = await response.json();
        return data.value;
    } catch (err) {
        console.error('getSetting error:', err);
        return null;
    }
}

async function apiSaveSetting(key, value) {
    try {
        await apiNetworkFetch(`${API_BASE}/settings`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ key, value })
        });
    } catch (err) {
        console.error('saveSetting error:', err);
    }
}

// v7.0: Products catalog API
function addProductBusinessContextParam(params, context) {
    const value = normalizeCrmBusinessContext(context || getProductBusinessContextValue());
    const scope = getCrmBusinessScope();
    if (scope.mode !== CRM_BUSINESS_SCOPE_SINGLE) {
        params.set('businessScope', scope.mode);
        params.set('businessContext', scope.activeContext || value);
        if (scope.mode === CRM_BUSINESS_SCOPE_MULTI) params.set('businessContexts', scope.selectedContexts.join(','));
        else params.delete('businessContexts');
        return;
    }
    if (value) params.set('businessContext', value);
}

function getProductBusinessContextValue(source = {}) {
    if (typeof source === 'string') return source;
    if (source.businessContext || source.business_context) return source.businessContext || source.business_context;
    if (typeof window !== 'undefined' && window.ProductBusinessContext?.getApiContext) {
        return window.ProductBusinessContext.getApiContext();
    }
    if (typeof window !== 'undefined' && window.CrmBusinessContext?.current) {
        return window.CrmBusinessContext.current();
    }
    return CRM_BUSINESS_DEFAULT_CONTEXT;
}

async function apiGetProducts(activeOnly = true, filters = {}) {
    try {
        const params = new URLSearchParams();
        if (activeOnly) params.set('active', 'true');
        addProductBusinessContextParam(params, filters.businessContext || filters.business_context);
        if (filters.domain) params.set('domain', filters.domain);
        if (filters.kitchenType) params.set('kitchenType', filters.kitchenType);
        if (filters.menuSection) params.set('menuSection', filters.menuSection);
        if (filters.availabilityStatus) params.set('availabilityStatus', filters.availabilityStatus);
        if (filters.priceDate || filters.price_date) params.set('priceDate', filters.priceDate || filters.price_date);
        const qs = params.toString() ? `?${params.toString()}` : '';
        const response = await apiNetworkFetch(`${API_BASE}/products${qs}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getProducts error:', err);
        return null; // caller should fallback to PROGRAMS
    }
}

async function apiGetProduct(id, options = {}) {
    try {
        const params = new URLSearchParams();
        addProductBusinessContextParam(params, getProductBusinessContextValue(options));
        if (options.priceDate || options.price_date) params.set('priceDate', options.priceDate || options.price_date);
        const qs = params.toString() ? `?${params.toString()}` : '';
        const response = await apiNetworkFetch(`${API_BASE}/products/${encodeURIComponent(id)}${qs}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getProduct error:', err);
        return null;
    }
}

async function apiGetProductCatalogs() {
    try {
        const context = typeof window !== 'undefined' && window.ProductBusinessContext
            ? window.ProductBusinessContext.getApiContext()
            : '';
        const params = new URLSearchParams();
        addProductBusinessContextParam(params, context);
        const qs = params.toString() ? `?${params.toString()}` : '';
        const response = await apiNetworkFetch(`${API_BASE}/products/catalogs${qs}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return [];
        if (!response.ok) throw new Error('API error');
        const data = await response.json();
        return data.catalogs || [];
    } catch (err) {
        console.error('API getProductCatalogs error:', err);
        return [];
    }
}

// v7.1: Products CRUD API
async function apiCreateProduct(product) {
    try {
        if (!guardCrmBusinessWrite('створювати продукти')) {
            return { success: false, error: crmBusinessReadOnlyMessage(getCrmBusinessScope(), 'створювати продукти') };
        }
        const response = await apiNetworkFetch(`${API_BASE}/products`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(product)
        });
        if (handleAuthError(response)) return apiAuthFailure(response);
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return normalizeApiErrorResult({ ...body, status: response.status }, 'API error');
        }
        const data = await response.json();
        return { success: true, product: data };
    } catch (err) {
        console.error('API createProduct error:', err);
        return normalizeApiErrorResult(err, 'API error');
    }
}

async function apiUpdateProduct(id, product) {
    try {
        if (!guardCrmBusinessWrite('редагувати продукти')) {
            return { success: false, error: crmBusinessReadOnlyMessage(getCrmBusinessScope(), 'редагувати продукти') };
        }
        const response = await apiNetworkFetch(`${API_BASE}/products/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(product)
        });
        if (handleAuthError(response)) return apiAuthFailure(response);
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return normalizeApiErrorResult({ ...body, status: response.status }, 'API error');
        }
        const data = await response.json();
        return { success: true, product: data };
    } catch (err) {
        console.error('API updateProduct error:', err);
        return normalizeApiErrorResult(err, 'API error');
    }
}

async function apiUpdateProductDocument(id, payload) {
    try {
        if (!guardCrmBusinessWrite('редагувати документи продуктів')) {
            return { success: false, error: crmBusinessReadOnlyMessage(getCrmBusinessScope(), 'редагувати документи продуктів') };
        }
        const response = await apiNetworkFetch(`${API_BASE}/products/${encodeURIComponent(id)}/source-document`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload || {})
        });
        if (handleAuthError(response)) return apiAuthFailure(response);
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return normalizeApiErrorResult({ ...body, status: response.status }, 'API error');
        }
        const data = await response.json();
        return { success: true, product: data };
    } catch (err) {
        console.error('API updateProductDocument error:', err);
        return normalizeApiErrorResult(err, 'API error');
    }
}

async function apiDeleteProduct(id, options = {}) {
    try {
        if (!guardCrmBusinessWrite('деактивувати продукти')) {
            return { success: false, error: crmBusinessReadOnlyMessage(getCrmBusinessScope(), 'деактивувати продукти') };
        }
        const params = new URLSearchParams();
        addProductBusinessContextParam(params, getProductBusinessContextValue(options));
        const qs = params.toString() ? `?${params.toString()}` : '';
        const response = await apiNetworkFetch(`${API_BASE}/products/${encodeURIComponent(id)}${qs}`, {
            method: 'DELETE',
            headers: getAuthHeaders(false)
        });
        if (handleAuthError(response)) return apiAuthFailure(response);
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return normalizeApiErrorResult({ ...body, status: response.status }, 'API error');
        }
        return await response.json();
    } catch (err) {
        console.error('API deleteProduct error:', err);
        return normalizeApiErrorResult(err, 'API error');
    }
}

async function apiGetProductTechCard(id, options = {}) {
    try {
        const params = new URLSearchParams();
        addProductBusinessContextParam(params, getProductBusinessContextValue(options));
        const qs = params.toString() ? `?${params.toString()}` : '';
        const response = await apiNetworkFetch(`${API_BASE}/products/${encodeURIComponent(id)}/tech-card${qs}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return { success: false, techCard: { mode: 'simple', ingredients: [] } };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error' };
        }
        return await response.json();
    } catch (err) {
        console.error('API getProductTechCard error:', err);
        return { success: false, error: err.message, techCard: { mode: 'simple', ingredients: [] } };
    }
}

async function apiUpdateProductTechCard(id, payload = {}) {
    try {
        if (!guardCrmBusinessWrite('редагувати техкарти')) {
            return { success: false, error: crmBusinessReadOnlyMessage(getCrmBusinessScope(), 'редагувати техкарти') };
        }
        const response = await apiNetworkFetch(`${API_BASE}/products/${encodeURIComponent(id)}/tech-card`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload || {})
        });
        if (handleAuthError(response)) return apiAuthFailure(response);
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return normalizeApiErrorResult({ ...body, status: response.status }, 'API error');
        }
        return await response.json();
    } catch (err) {
        console.error('API updateProductTechCard error:', err);
        return normalizeApiErrorResult(err, 'API error');
    }
}

async function apiWriteOffProductTechCard(id, payload = {}) {
    try {
        if (!guardCrmBusinessWrite('списувати склад')) {
            return { success: false, error: crmBusinessReadOnlyMessage(getCrmBusinessScope(), 'списувати склад') };
        }
        const response = await apiNetworkFetch(`${API_BASE}/products/${encodeURIComponent(id)}/tech-card/write-off`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload || {})
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error', insufficient: body.insufficient || [], incomplete: body.incomplete || [] };
        }
        return await response.json();
    } catch (err) {
        console.error('API writeOffProductTechCard error:', err);
        return { success: false, error: err.message };
    }
}

async function apiGenerateProductMenuAiDraft(payload = {}) {
    try {
        if (!guardCrmBusinessWrite('створювати AI-чернетки меню')) {
            return { success: false, error: crmBusinessReadOnlyMessage(getCrmBusinessScope(), 'створювати AI-чернетки меню') };
        }
        const response = await apiNetworkFetch(`${API_BASE}/products/menu-ai-draft`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload || {})
        });
        if (handleAuthError(response)) return { success: false };
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            return { success: false, error: body.error || 'API error' };
        }
        return body;
    } catch (err) {
        console.error('API generateProductMenuAiDraft error:', err);
        return { success: false, error: err.message };
    }
}

async function apiGenerateProductMenuImage(id, payload = {}) {
    try {
        if (!guardCrmBusinessWrite('генерувати фото меню')) {
            return { success: false, error: crmBusinessReadOnlyMessage(getCrmBusinessScope(), 'генерувати фото меню') };
        }
        const response = await apiNetworkFetch(`${API_BASE}/products/${encodeURIComponent(id)}/menu-image/draft`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload || {})
        });
        if (handleAuthError(response)) return { success: false };
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            return { success: false, error: body.error || 'API error', code: body.code };
        }
        return body;
    } catch (err) {
        console.error('API generateProductMenuImage error:', err);
        return { success: false, error: err.message };
    }
}

async function apiCreateProductMenuExternalDraft(id, payload = {}) {
    try {
        if (!guardCrmBusinessWrite('зберегти ручний draft фото меню')) {
            return { success: false, error: crmBusinessReadOnlyMessage(getCrmBusinessScope(), 'зберегти ручний draft фото меню') };
        }
        const response = await apiNetworkFetch(`${API_BASE}/products/${encodeURIComponent(id)}/menu-image/external-draft`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload || {})
        });
        if (handleAuthError(response)) return { success: false };
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            return { success: false, error: body.error || 'API error', code: body.code };
        }
        return body;
    } catch (err) {
        console.error('API createProductMenuExternalDraft error:', err);
        return { success: false, error: err.message };
    }
}

async function apiGetProductMenuImageStatus(id, options = {}) {
    try {
        const params = new URLSearchParams();
        addProductBusinessContextParam(params, getProductBusinessContextValue(options));
        const qs = params.toString() ? `?${params.toString()}` : '';
        const response = await apiNetworkFetch(`${API_BASE}/products/${encodeURIComponent(id)}/menu-image/status${qs}`, {
            headers: getAuthHeaders(false)
        });
        if (handleAuthError(response)) return { success: false };
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            return { success: false, error: body.error || 'API error', code: body.code };
        }
        return body;
    } catch (err) {
        console.error('API getProductMenuImageStatus error:', err);
        return { success: false, error: err.message };
    }
}

async function apiApplyProductMenuImage(id, payload = {}) {
    try {
        if (!guardCrmBusinessWrite('застосувати фото меню')) {
            return { success: false, error: crmBusinessReadOnlyMessage(getCrmBusinessScope(), 'застосувати фото меню') };
        }
        const response = await apiNetworkFetch(`${API_BASE}/products/${encodeURIComponent(id)}/menu-image/apply`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload || {})
        });
        if (handleAuthError(response)) return { success: false };
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            return { success: false, error: body.error || 'API error', code: body.code };
        }
        return body;
    } catch (err) {
        console.error('API applyProductMenuImage error:', err);
        return { success: false, error: err.message };
    }
}

async function apiRejectProductMenuImage(id, payload = {}) {
    try {
        if (!guardCrmBusinessWrite('відхилити фото меню')) {
            return { success: false, error: crmBusinessReadOnlyMessage(getCrmBusinessScope(), 'відхилити фото меню') };
        }
        const response = await apiNetworkFetch(`${API_BASE}/products/${encodeURIComponent(id)}/menu-image/reject`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload || {})
        });
        if (handleAuthError(response)) return { success: false };
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            return { success: false, error: body.error || 'API error', code: body.code };
        }
        return body;
    } catch (err) {
        console.error('API rejectProductMenuImage error:', err);
        return { success: false, error: err.message };
    }
}

async function apiGetProductMenuAiDraft(id, options = {}) {
    try {
        const params = new URLSearchParams();
        addProductBusinessContextParam(params, getProductBusinessContextValue(options));
        const qs = params.toString() ? `?${params.toString()}` : '';
        const response = await apiNetworkFetch(`${API_BASE}/products/${encodeURIComponent(id)}/ai-card-draft${qs}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return { success: false };
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            return { success: false, error: body.error || 'API error' };
        }
        return body;
    } catch (err) {
        console.error('API getProductMenuAiDraft error:', err);
        return { success: false, error: err.message };
    }
}

async function apiSaveProductMenuAiDraft(id, payload = {}) {
    try {
        if (!guardCrmBusinessWrite('зберігати AI-чернетки меню')) {
            return { success: false, error: crmBusinessReadOnlyMessage(getCrmBusinessScope(), 'зберігати AI-чернетки меню') };
        }
        const response = await apiNetworkFetch(`${API_BASE}/products/${encodeURIComponent(id)}/ai-card-draft`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload || {})
        });
        if (handleAuthError(response)) return { success: false };
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            return { success: false, error: body.error || 'API error' };
        }
        return body;
    } catch (err) {
        console.error('API saveProductMenuAiDraft error:', err);
        return { success: false, error: err.message };
    }
}

async function apiGetProgramIconSettings() {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/products/program-icon-settings`, {
            headers: getAuthHeaders(false)
        });
        if (handleAuthError(response)) return { success: false };
        const body = await response.json().catch(() => ({}));
        if (!response.ok) return { success: false, error: body.error || 'API error', errors: body.errors || [] };
        return body;
    } catch (err) {
        console.error('API getProgramIconSettings error:', err);
        return { success: false, error: err.message };
    }
}

async function apiUpdateProgramIconSettings(settings = {}) {
    try {
        if (!guardCrmBusinessWrite('налаштовувати AI-іконки програм')) {
            return { success: false, error: crmBusinessReadOnlyMessage(getCrmBusinessScope(), 'налаштовувати AI-іконки програм') };
        }
        const response = await apiNetworkFetch(`${API_BASE}/products/program-icon-settings`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ settings })
        });
        if (handleAuthError(response)) return { success: false };
        const body = await response.json().catch(() => ({}));
        if (!response.ok) return { success: false, error: body.error || 'API error', errors: body.errors || [] };
        return body;
    } catch (err) {
        console.error('API updateProgramIconSettings error:', err);
        return { success: false, error: err.message };
    }
}

async function apiGenerateProductProgramIcon(id, payload = {}) {
    try {
        if (!guardCrmBusinessWrite('генерувати AI-іконку програми')) {
            return { success: false, error: crmBusinessReadOnlyMessage(getCrmBusinessScope(), 'генерувати AI-іконку програми') };
        }
        const response = await apiNetworkFetch(`${API_BASE}/products/${encodeURIComponent(id)}/program-icon/generate`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(crmBusinessPayload(payload || {}, getProductBusinessContextValue(payload)))
        });
        if (handleAuthError(response)) return { success: false };
        const body = await response.json().catch(() => ({}));
        if (!response.ok) return { success: false, error: body.error || 'API error', ...body };
        return body;
    } catch (err) {
        console.error('API generateProductProgramIcon error:', err);
        return { success: false, error: err.message };
    }
}

async function apiGetProductProgramIconStatus(id, options = {}) {
    try {
        const params = new URLSearchParams();
        addProductBusinessContextParam(params, getProductBusinessContextValue(options));
        const qs = params.toString() ? `?${params.toString()}` : '';
        const response = await apiNetworkFetch(`${API_BASE}/products/${encodeURIComponent(id)}/program-icon/status${qs}`, {
            headers: getAuthHeaders(false)
        });
        if (handleAuthError(response)) return { success: false };
        const body = await response.json().catch(() => ({}));
        if (!response.ok) return { success: false, error: body.error || 'API error', ...body };
        return body;
    } catch (err) {
        console.error('API getProductProgramIconStatus error:', err);
        return { success: false, error: err.message };
    }
}

// v5.0: Auth API
async function apiLogin(username, password) {
    const response = await apiNetworkFetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    if (!response.ok) {
        let errMsg = 'Login failed';
        try { const err = await response.json(); errMsg = err.error || errMsg; } catch {}
        const error = new Error(errMsg);
        error.status = response.status;
        error.retryAfter = response.headers?.get?.('Retry-After') || null;
        throw error;
    }
    const data = await response.json();
    clearApiAuthSessionFailure();
    return data;
}

function clearApiImpersonationBackup(options = {}) {
    if (typeof clearImpersonationBackup === 'function') {
        clearImpersonationBackup(options);
        return;
    }
    if (typeof sessionStorage === 'undefined') return;
    if (options.revokeRefresh === true
        && sessionStorage.getItem('realSessionBackupVersion') === '2'
        && Boolean(sessionStorage.getItem('impersonating'))) {
        revokeUnclaimedApiRefreshToken(sessionStorage.getItem('realRefreshToken'));
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

function revokeUnclaimedApiRefreshToken(refreshToken) {
    if (!refreshToken) return;
    try {
        apiNativeFetch(`${API_BASE}/auth/logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
            keepalive: true
        }).catch(() => {});
    } catch {}
}

function clearApiAuthSessionStorage(reason = 'api-auth-session-clear') {
    recordApiRedirectDiagnostic('auth-storage-clear', { storageClearReason: reason });
    const runtimeUser = typeof AppState !== 'undefined' && AppState ? AppState.currentUser : null;
    if (typeof clearRuntimePermissionCatalog === 'function') clearRuntimePermissionCatalog(runtimeUser);
    if (typeof setPermissionLifecycle === 'function') setPermissionLifecycle('idle');
    if (typeof AppState !== 'undefined' && AppState) AppState.currentUser = null;
    if (typeof resetAuthenticatedRuntimeReady === 'function') resetAuthenticatedRuntimeReady();
    localStorage.removeItem('pzp_token');
    localStorage.removeItem(API_AUTH_ACCESS_TOKEN_KEY);
    localStorage.removeItem(API_AUTH_REFRESH_TOKEN_KEY);
    localStorage.removeItem(API_AUTH_REFRESH_EXPIRES_KEY);
    localStorage.removeItem(API_AUTH_SESSION_GENERATION_KEY);
    localStorage.removeItem(API_AUTH_SESSION_TOKEN_ID_KEY);
    localStorage.removeItem(CONFIG.STORAGE.CURRENT_USER);
    localStorage.removeItem(CONFIG.STORAGE.SESSION);
    localStorage.removeItem(API_AUTH_TRANSITION_KEY);
    localStorage.removeItem(API_AUTH_REFRESH_COORDINATION_KEY);
    localStorage.removeItem(API_AUTH_REFRESH_APPLIED_AT_KEY);
    clearApiImpersonationBackup({ revokeRefresh: true });
}

function rememberApiAuthSession(data = {}, options = {}) {
    const transition = beginApiAuthTransition('remember');
    if (!transition.owned) return false;
    try {
        const storedUser = readApiAuthStoredUser();
        const identityChanged = Boolean(data.user && storedUser && !apiAuthUsersShareIdentity(data.user, storedUser));
        if (identityChanged || !localStorage.getItem(API_AUTH_SESSION_GENERATION_KEY)) {
            rotateApiAuthSessionGeneration();
        }
        const accessToken = data.accessToken || data.token || '';
        const legacyToken = data.token || accessToken;
        if (legacyToken) localStorage.setItem('pzp_token', legacyToken);
        if (accessToken) localStorage.setItem(API_AUTH_ACCESS_TOKEN_KEY, accessToken);
        if (data.refreshToken) localStorage.setItem(API_AUTH_REFRESH_TOKEN_KEY, data.refreshToken);
        if (data.refreshExpiresAt) localStorage.setItem(API_AUTH_REFRESH_EXPIRES_KEY, String(data.refreshExpiresAt));
        if (data.sessionTokenId !== undefined && data.sessionTokenId !== null) {
            localStorage.setItem(API_AUTH_SESSION_TOKEN_ID_KEY, String(data.sessionTokenId));
        }
        if (data.user) mergeApiCurrentUser(data.user, { allowIdentityChange: true });
        rememberApiAuthRefreshAppliedAt(options.refreshOperationStartedAt);
    } finally {
        endApiAuthTransition(transition);
    }
    return true;
}

function mergeApiCurrentUser(user = null, options = {}) {
    if (!user) return user;
    let transition = null;
    try {
        const saved = JSON.parse(localStorage.getItem(CONFIG.STORAGE.CURRENT_USER) || '{}');
        const savedId = saved?.id === undefined || saved?.id === null ? '' : String(saved.id);
        const incomingId = user?.id === undefined || user?.id === null ? '' : String(user.id);
        const savedUsername = String(saved?.username || '').trim().toLowerCase();
        const incomingUsername = String(user?.username || '').trim().toLowerCase();
        const identityChanged = savedId && incomingId
            ? savedId !== incomingId
            : Boolean(savedUsername && incomingUsername && savedUsername !== incomingUsername);
        if (identityChanged && options.allowIdentityChange !== true) {
            setApiAuthSessionFailure('transient', { stage: 'user-merge', reason: 'session-changed' });
            return null;
        }
        const next = identityChanged ? { ...user } : { ...saved, ...user };
        syncApiAuthUserAliases(next, user);
        const authorizationChanged = !identityChanged
            && apiAuthAuthorizationFingerprint(saved) !== apiAuthAuthorizationFingerprint(user);
        const hasIncomingPermissions = Object.prototype.hasOwnProperty.call(user, 'permissions')
            && user.permissions !== undefined;
        if (!identityChanged
            && !authorizationChanged
            && saved?.permissions
            && !hasIncomingPermissions) {
            next.permissions = saved.permissions;
        } else if (!hasIncomingPermissions) {
            delete next.permissions;
        }
        const runtimeAuthorizationChanged = identityChanged || authorizationChanged;
        if (runtimeAuthorizationChanged) {
            transition = beginApiAuthTransition('merge');
            if (!transition.owned) return null;
        }
        if (runtimeAuthorizationChanged && typeof clearRuntimePermissionCatalog === 'function') {
            clearRuntimePermissionCatalog(next);
        } else if (runtimeAuthorizationChanged && typeof AppState !== 'undefined' && AppState) {
            AppState.authPermissions = null;
            delete next.permissions;
        }
        if (runtimeAuthorizationChanged && typeof setPermissionLifecycle === 'function') {
            setPermissionLifecycle('loading');
        }
        if (runtimeAuthorizationChanged) rotateApiAuthSessionGeneration();
        localStorage.setItem(CONFIG.STORAGE.CURRENT_USER, JSON.stringify(next));
        const runtimeUser = typeof AppState !== 'undefined' && AppState?.currentUser
            ? AppState.currentUser
            : null;
        const mayPublishRuntimeUser = !runtimeUser
            || apiAuthUsersShareIdentity(runtimeUser, saved)
            || apiAuthUsersShareIdentity(runtimeUser, user);
        if (runtimeAuthorizationChanged
            && mayPublishRuntimeUser
            && typeof AppState !== 'undefined'
            && AppState) {
            AppState.currentUser = next;
        }
        return next;
    } catch {
        localStorage.setItem(CONFIG.STORAGE.CURRENT_USER, JSON.stringify(user));
        return user;
    } finally {
        if (transition) endApiAuthTransition(transition);
    }
}

function isApiAuthRefreshOperationCurrent(refreshToken, sessionGeneration) {
    return localStorage.getItem(API_AUTH_REFRESH_TOKEN_KEY) === refreshToken
        && (localStorage.getItem(API_AUTH_SESSION_GENERATION_KEY) || '') === String(sessionGeneration || '');
}

function waitForApiAuthRefreshSettlement(refreshToken, sessionGeneration) {
    if (!isApiAuthRefreshOperationCurrent(refreshToken, sessionGeneration)) return Promise.resolve(true);
    return new Promise(resolve => {
        let timer = null;
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            if (timer !== null && typeof clearTimeout === 'function') clearTimeout(timer);
            if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
                window.removeEventListener('storage', handleStorage);
            }
            resolve(!isApiAuthRefreshOperationCurrent(refreshToken, sessionGeneration));
        };
        const handleStorage = event => {
            if (!event
                || event.key === API_AUTH_REFRESH_TOKEN_KEY
                || event.key === API_AUTH_SESSION_GENERATION_KEY) finish();
        };
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            window.addEventListener('storage', handleStorage);
        }
        timer = setTimeout(finish, API_AUTH_REFRESH_SETTLEMENT_MS);
    });
}

function normalizeApiAuthSessionTokenId(value) {
    const numeric = Number(value || 0);
    return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 0;
}

function getApiAuthSessionTokenId() {
    const value = normalizeApiAuthSessionTokenId(localStorage.getItem(API_AUTH_SESSION_TOKEN_ID_KEY));
    if (!value && localStorage.getItem(API_AUTH_SESSION_TOKEN_ID_KEY)) {
        localStorage.removeItem(API_AUTH_SESSION_TOKEN_ID_KEY);
    }
    return value;
}

function apiAuthRefreshResponseMatchesIdentity(expectedUser, data = {}) {
    const storedUser = readApiAuthStoredUser();
    if (expectedUser && storedUser && !apiAuthUsersShareIdentity(expectedUser, storedUser)) return false;
    return true;
}

function canApplyApiAuthRefreshResponse(refreshToken, expectedUser, sessionGeneration, data = {}) {
    if (!data?.accessToken || !data.refreshToken) return false;
    if ((localStorage.getItem(API_AUTH_SESSION_GENERATION_KEY) || '') !== String(sessionGeneration || '')) return false;
    if (!apiAuthRefreshResponseMatchesIdentity(expectedUser, data)) return false;
    if (isApiAuthRefreshOperationCurrent(refreshToken, sessionGeneration)) return true;

    const responseSessionTokenId = normalizeApiAuthSessionTokenId(data.sessionTokenId || data.refreshTokenId);
    const currentSessionTokenId = getApiAuthSessionTokenId();
    const currentRefreshToken = localStorage.getItem(API_AUTH_REFRESH_TOKEN_KEY);
    if (!currentRefreshToken || currentRefreshToken === refreshToken) return false;
    return Boolean(responseSessionTokenId
        && currentSessionTokenId
        && responseSessionTokenId > currentSessionTokenId);
}

async function requestApiAuthTokenRefresh(refreshToken) {
    const headers = { 'Content-Type': 'application/json' };
    const accessToken = localStorage.getItem(API_AUTH_ACCESS_TOKEN_KEY) || localStorage.getItem('pzp_token');
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return apiNetworkFetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ refreshToken })
    });
}

async function performApiAuthTokenRefresh(refreshToken, expectedUser = null, sessionGeneration = '', options = {}) {
    if (!refreshToken) return { accessToken: null, outcome: 'missing' };
    try {
        let response = await requestApiAuthTokenRefresh(refreshToken);
        let data = await response.json().catch(() => ({}));
        ({ response, data } = await retryApiAuthRateLimitedResponse(
            response,
            data,
            () => requestApiAuthTokenRefresh(refreshToken),
            {
                canContinue: () => !getActiveApiAuthTransitionMarker()
                    && isApiAuthRefreshOperationCurrent(refreshToken, sessionGeneration)
            }
        ));
        if (getActiveApiAuthTransitionMarker()) {
            if (response.ok) revokeUnclaimedApiRefreshToken(data.refreshToken);
            setApiAuthSessionFailure('transient', { stage: 'refresh', reason: 'session-transition' });
            return { accessToken: null, outcome: 'superseded' };
        }
        if (!response.ok && !isApiAuthRefreshOperationCurrent(refreshToken, sessionGeneration)) {
            return { accessToken: null, outcome: 'superseded' };
        }
        if (response.ok && data.accessToken && !canApplyApiAuthRefreshResponse(refreshToken, expectedUser, sessionGeneration, data)) {
            return { accessToken: null, outcome: 'superseded' };
        }
        if (!response.ok || !data.accessToken) {
            let alreadyRotated = response.status === 409
                && String(data?.code || '').toLowerCase() === 'refresh_already_rotated';
            if (alreadyRotated) {
                if (await waitForApiAuthRefreshSettlement(refreshToken, sessionGeneration)) {
                    return { accessToken: null, outcome: 'superseded' };
                }
                await new Promise(resolve => setTimeout(resolve, API_AUTH_REFRESH_REPLAY_CONFIRM_DELAY_MS));
                if (getActiveApiAuthTransitionMarker()) {
                    setApiAuthSessionFailure('transient', { stage: 'refresh', reason: 'session-transition' });
                    return { accessToken: null, outcome: 'superseded' };
                }
                if (!isApiAuthRefreshOperationCurrent(refreshToken, sessionGeneration)) {
                    return { accessToken: null, outcome: 'superseded' };
                }
                response = await requestApiAuthTokenRefresh(refreshToken);
                data = await response.json().catch(() => ({}));
                ({ response, data } = await retryApiAuthRateLimitedResponse(
                    response,
                    data,
                    () => requestApiAuthTokenRefresh(refreshToken),
                    {
                        canContinue: () => !getActiveApiAuthTransitionMarker()
                            && isApiAuthRefreshOperationCurrent(refreshToken, sessionGeneration)
                    }
                ));
                if (getActiveApiAuthTransitionMarker()) {
                    if (response.ok) revokeUnclaimedApiRefreshToken(data.refreshToken);
                    setApiAuthSessionFailure('transient', { stage: 'refresh', reason: 'session-transition' });
                    return { accessToken: null, outcome: 'superseded' };
                }
                if (!response.ok && !isApiAuthRefreshOperationCurrent(refreshToken, sessionGeneration)) {
            return { accessToken: null, outcome: 'superseded' };
        }
        if (response.ok && data.accessToken && !canApplyApiAuthRefreshResponse(refreshToken, expectedUser, sessionGeneration, data)) {
                    return { accessToken: null, outcome: 'superseded' };
                }
                alreadyRotated = response.status === 409
                    && String(data?.code || '').toLowerCase() === 'refresh_already_rotated';
            }
            if (!response.ok || !data.accessToken) {
                if (alreadyRotated) {
                    const failureDetails = {
                        stage: 'refresh',
                        status: response.status,
                        reason: 'refresh-already-rotated',
                        code: data?.code || 'refresh_already_rotated',
                        requestId: data?.requestId || data?.request_id || null
                    };
                    setApiAuthSessionFailure('transient', failureDetails);
                    recordApiRedirectDiagnostic('auth-refresh', {
                        refreshOutcome: 'retry-later',
                        status: response.status,
                        code: data?.code,
                        reason: 'refresh-already-rotated',
                        requestId: data?.requestId || data?.request_id
                    });
                    return buildApiAuthRefreshRetryLaterResult('refresh-already-rotated');
                }
                const failureKind = response.ok ? 'transient' : classifyApiAuthHttpFailure(response.status);
                const rateLimitFailure = getApiAuthRateLimitFailureDetails('refresh', response, data);
                setApiAuthSessionFailure(failureKind, rateLimitFailure || {
                    stage: 'refresh',
                    status: response.status,
                    reason: alreadyRotated
                        ? 'refresh-already-rotated'
                        : (response.ok ? 'malformed-response' : 'http')
                });
                if (failureKind === 'terminal') clearApiAuthSessionStorage('refresh-terminal');
                recordApiRedirectDiagnostic('auth-refresh', {
                    refreshOutcome: failureKind,
                    status: response.status,
                    code: data?.code,
                    reason: rateLimitFailure?.reason || (alreadyRotated ? 'refresh-already-rotated' : 'http'),
                    requestId: data?.requestId || data?.request_id,
                    retryAfterSeconds: rateLimitFailure?.retryAfterSeconds
                });
                return { accessToken: null, outcome: failureKind };
            }
        }
        if (expectedUser
            && (!data.user || !apiAuthUsersShareIdentity(expectedUser, data.user))) {
            revokeUnclaimedApiRefreshToken(data.refreshToken);
            setApiAuthSessionFailure('terminal', {
                stage: 'refresh',
                reason: 'refresh-identity-mismatch'
            });
            clearApiAuthSessionStorage('refresh-identity-mismatch');
            recordApiRedirectDiagnostic('auth-refresh', {
                refreshOutcome: 'terminal',
                reason: 'refresh-identity-mismatch'
            });
            return { accessToken: null, outcome: 'terminal' };
        }
        if (!rememberApiAuthSession(data, { refreshOperationStartedAt: options.operationStartedAt })) {
            revokeUnclaimedApiRefreshToken(data.refreshToken);
            setApiAuthSessionFailure('transient', {
                stage: 'refresh',
                reason: 'session-transition'
            });
            return { accessToken: null, outcome: 'superseded' };
        }
        clearApiAuthSessionFailure();
        recordApiRedirectDiagnostic('auth-refresh', {
            refreshOutcome: 'success',
            status: response.status,
            requestId: data?.requestId || data?.request_id
        });
        return { accessToken: data.accessToken, outcome: 'success' };
    } catch (err) {
        if (!isApiAuthRefreshOperationCurrent(refreshToken, sessionGeneration)) {
            return { accessToken: null, outcome: 'superseded' };
        }
        setApiAuthSessionFailure('transient', {
            stage: 'refresh',
            reason: 'network'
        });
        recordApiRedirectDiagnostic('auth-refresh', {
            refreshOutcome: 'transient',
            reason: 'network'
        });
        console.warn('[Auth] refresh failed:', err?.message || err);
        return { accessToken: null, outcome: 'transient' };
    }
}

function apiAuthRefreshIdentityKey(user = null) {
    if (!user || typeof user !== 'object') return '';
    if (user.id !== undefined && user.id !== null) return `id:${String(user.id)}`;
    const username = String(user.username || '').trim().toLowerCase();
    return username ? `username:${username}` : '';
}

function waitForApiAuthRefreshCoordination(refreshToken, sessionGeneration) {
    if (!isApiAuthRefreshOperationCurrent(refreshToken, sessionGeneration)) return Promise.resolve('session-changed');
    return new Promise(resolve => {
        let timer = null;
        let settled = false;
        const finish = outcome => {
            if (settled) return;
            settled = true;
            if (timer !== null && typeof clearTimeout === 'function') clearTimeout(timer);
            if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
                window.removeEventListener('storage', handleStorage);
            }
            resolve(outcome);
        };
        const handleStorage = event => {
            if (!event) return finish('storage');
            if (event.key === API_AUTH_REFRESH_TOKEN_KEY
                || event.key === API_AUTH_SESSION_GENERATION_KEY) {
                return finish('session-changed');
            }
            if (event.key === API_AUTH_REFRESH_COORDINATION_KEY) return finish('coordination-changed');
            return null;
        };
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            window.addEventListener('storage', handleStorage);
        }
        timer = setTimeout(() => finish('timeout'), API_AUTH_REFRESH_COORDINATION_WAIT_MS);
    });
}

async function runApiAuthRefreshWithCoordination(refreshToken, expectedUser, sessionGeneration, expectedIdentityKey) {
    const operationId = createApiAuthSessionGeneration();
    const operationStartedAt = Date.now();
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const activeMarker = readApiAuthRefreshCoordinationMarker();
        if (apiAuthRefreshCoordinationMatches(activeMarker, refreshToken, sessionGeneration, expectedIdentityKey)
            && activeMarker.id !== operationId) {
            await waitForApiAuthRefreshCoordination(refreshToken, sessionGeneration);
            if (!isApiAuthRefreshOperationCurrent(refreshToken, sessionGeneration)) {
                return { accessToken: null, outcome: 'superseded' };
            }
        }

        const marker = {
            id: operationId,
            refreshToken,
            sessionGeneration,
            expectedIdentityKey,
            startedAt: operationStartedAt
        };
        localStorage.setItem(API_AUTH_REFRESH_COORDINATION_KEY, JSON.stringify(marker));
        const claimedMarker = readApiAuthRefreshCoordinationMarker();
        if (!claimedMarker || claimedMarker.id !== operationId) continue;
        try {
            return await performApiAuthTokenRefresh(refreshToken, expectedUser, sessionGeneration, { operationStartedAt });
        } finally {
            clearApiAuthRefreshCoordinationMarker(marker);
        }
    }
    return performApiAuthTokenRefresh(refreshToken, expectedUser, sessionGeneration, { operationStartedAt });
}

function apiRefreshAuthSession(expectedUserOverride = null) {
    if (getActiveApiAuthTransitionMarker()) {
        setApiAuthSessionFailure('transient', { stage: 'refresh', reason: 'session-transition' });
        return Promise.resolve({ accessToken: null, outcome: 'transient' });
    }
    const refreshToken = localStorage.getItem(API_AUTH_REFRESH_TOKEN_KEY);
    if (!refreshToken) return Promise.resolve({ accessToken: null, outcome: 'missing' });
    const sessionGeneration = ensureApiAuthSessionGeneration();
    const expectedUser = expectedUserOverride && typeof expectedUserOverride === 'object'
        ? expectedUserOverride
        : readApiAuthStoredUser();
    const expectedIdentityKey = apiAuthRefreshIdentityKey(expectedUser);
    if (apiAuthRefreshOperation?.refreshToken === refreshToken
        && apiAuthRefreshOperation?.sessionGeneration === sessionGeneration
        && apiAuthRefreshOperation?.expectedIdentityKey === expectedIdentityKey) {
        return apiAuthRefreshOperation.promise;
    }

    const operation = {
        refreshToken,
        sessionGeneration,
        expectedIdentityKey,
        promise: null,
        transportPromise: null,
        transportSettled: false,
        watchdogFired: false,
        watchdogTimer: null,
        resolvePublic: null
    };
    const transportRefresh = runApiAuthRefreshWithCoordination(
        refreshToken,
        expectedUser,
        sessionGeneration,
        expectedIdentityKey
    );
    operation.transportPromise = transportRefresh;
    operation.promise = createApiAuthRefreshControlledPromise(operation, transportRefresh);
    transportRefresh.then(() => {
        operation.transportSettled = true;
        clearApiAuthRefreshWatchdog(operation);
        if (apiAuthRefreshOperation === operation) apiAuthRefreshOperation = null;
    }, () => {
        operation.transportSettled = true;
        clearApiAuthRefreshWatchdog(operation);
        if (apiAuthRefreshOperation === operation) apiAuthRefreshOperation = null;
    });
    apiAuthRefreshOperation = operation;
    return operation.promise;
}

async function apiRefreshAuthToken() {
    const result = await apiRefreshAuthSession();
    return result.accessToken || null;
}

async function apiVerifyToken(sessionChangeRetry = 0) {
    if (getActiveApiAuthTransitionMarker()) {
        setApiAuthSessionFailure('transient', { stage: 'verify', reason: 'session-transition' });
        return null;
    }
    let token = getStoredAuthToken();
    const hadRefreshToken = Boolean(localStorage.getItem(API_AUTH_REFRESH_TOKEN_KEY));
    if (!token && hadRefreshToken) {
        const refreshResult = await apiRefreshAuthSession();
        if (refreshResult.outcome === 'superseded') {
            if (sessionChangeRetry < 1) return apiVerifyToken(sessionChangeRetry + 1);
            setApiAuthSessionFailure('transient', { stage: 'verify', reason: 'session-changed' });
            return null;
        }
        token = refreshResult.accessToken;
    }
    if (!token) {
        if (!hadRefreshToken || !getApiAuthSessionFailure()) {
            setApiAuthSessionFailure('terminal', {
                stage: 'verify',
                reason: 'missing-session'
            });
        }
        return null;
    }
    let verifiedRefreshToken = localStorage.getItem(API_AUTH_REFRESH_TOKEN_KEY);
    try {
        let response = await apiNetworkFetch(`${API_BASE}/auth/verify`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (getActiveApiAuthTransitionMarker()) {
            setApiAuthSessionFailure('transient', { stage: 'verify', reason: 'session-transition' });
            return null;
        }
        if (getStoredAuthToken() !== token
            || localStorage.getItem(API_AUTH_REFRESH_TOKEN_KEY) !== verifiedRefreshToken) {
            if (sessionChangeRetry < 1) return apiVerifyToken(sessionChangeRetry + 1);
            setApiAuthSessionFailure('transient', { stage: 'verify', reason: 'session-changed' });
            return null;
        }
        let verifyResponseData = await readApiResponseJsonForRetry(response);
        ({ response, data: verifyResponseData } = await retryApiAuthRateLimitedResponse(
            response,
            verifyResponseData,
            () => apiNetworkFetch(`${API_BASE}/auth/verify`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }),
            {
                canContinue: () => !getActiveApiAuthTransitionMarker()
                    && getStoredAuthToken() === token
                    && localStorage.getItem(API_AUTH_REFRESH_TOKEN_KEY) === verifiedRefreshToken
            }
        ));
        if (getActiveApiAuthTransitionMarker()) {
            setApiAuthSessionFailure('transient', { stage: 'verify', reason: 'session-transition' });
            return null;
        }
        if (getStoredAuthToken() !== token
            || localStorage.getItem(API_AUTH_REFRESH_TOKEN_KEY) !== verifiedRefreshToken) {
            if (sessionChangeRetry < 1) return apiVerifyToken(sessionChangeRetry + 1);
            setApiAuthSessionFailure('transient', { stage: 'verify', reason: 'session-changed' });
            return null;
        }
        if (response.status === 403) {
            setApiAuthSessionFailure('terminal', {
                stage: 'verify',
                status: response.status,
                reason: 'forbidden-session',
                requestId: verifyResponseData?.requestId || verifyResponseData?.request_id
            });
            clearApiAuthSessionStorage('verify-forbidden-session');
            return null;
        }
        if (response.status === 401) {
            const refreshResult = await apiRefreshAuthSession();
            if (!refreshResult.accessToken) {
                if (refreshResult.outcome === 'superseded') {
                    if (sessionChangeRetry < 1) return apiVerifyToken(sessionChangeRetry + 1);
                    setApiAuthSessionFailure('transient', { stage: 'verify', reason: 'session-changed' });
                } else if (refreshResult.outcome === 'missing' || !getApiAuthSessionFailure()) {
                    setApiAuthSessionFailure('terminal', {
                        stage: 'verify',
                        status: response.status,
                        reason: 'unauthorized'
                    });
                    clearApiAuthSessionStorage('verify-unauthorized');
                }
                return null;
            }
            const refreshedToken = refreshResult.accessToken;
            token = refreshedToken;
            verifiedRefreshToken = localStorage.getItem(API_AUTH_REFRESH_TOKEN_KEY);
            response = await apiNetworkFetch(`${API_BASE}/auth/verify`, {
                headers: { 'Authorization': `Bearer ${refreshedToken}` }
            });
            if (getActiveApiAuthTransitionMarker()) {
                setApiAuthSessionFailure('transient', { stage: 'verify', reason: 'session-transition' });
                return null;
            }
            if (getStoredAuthToken() !== token
                || localStorage.getItem(API_AUTH_REFRESH_TOKEN_KEY) !== verifiedRefreshToken) {
                if (sessionChangeRetry < 1) return apiVerifyToken(sessionChangeRetry + 1);
                setApiAuthSessionFailure('transient', { stage: 'verify', reason: 'session-changed' });
                return null;
            }
            verifyResponseData = await readApiResponseJsonForRetry(response);
            ({ response, data: verifyResponseData } = await retryApiAuthRateLimitedResponse(
                response,
                verifyResponseData,
                () => apiNetworkFetch(`${API_BASE}/auth/verify`, {
                    headers: { 'Authorization': `Bearer ${refreshedToken}` }
                }),
                {
                    canContinue: () => !getActiveApiAuthTransitionMarker()
                        && getStoredAuthToken() === token
                        && localStorage.getItem(API_AUTH_REFRESH_TOKEN_KEY) === verifiedRefreshToken
                }
            ));
            if (getActiveApiAuthTransitionMarker()) {
                setApiAuthSessionFailure('transient', { stage: 'verify', reason: 'session-transition' });
                return null;
            }
            if (getStoredAuthToken() !== token
                || localStorage.getItem(API_AUTH_REFRESH_TOKEN_KEY) !== verifiedRefreshToken) {
                if (sessionChangeRetry < 1) return apiVerifyToken(sessionChangeRetry + 1);
                setApiAuthSessionFailure('transient', { stage: 'verify', reason: 'session-changed' });
                return null;
            }
        }
        if (!response.ok) {
            const failureKind = classifyApiAuthHttpFailure(response.status);
            const rateLimitFailure = getApiAuthRateLimitFailureDetails('verify', response, verifyResponseData);
            setApiAuthSessionFailure(failureKind, rateLimitFailure || {
                stage: 'verify',
                status: response.status,
                reason: 'http'
            });
            if (failureKind === 'terminal') clearApiAuthSessionStorage('verify-terminal');
            return null;
        }
        const data = await response.json().catch(() => null);
        if (getStoredAuthToken() !== token
            || localStorage.getItem(API_AUTH_REFRESH_TOKEN_KEY) !== verifiedRefreshToken) {
            if (sessionChangeRetry < 1) return apiVerifyToken(sessionChangeRetry + 1);
            setApiAuthSessionFailure('transient', { stage: 'verify', reason: 'session-changed' });
            return null;
        }
        if (!data?.user || typeof data.user !== 'object' || Array.isArray(data.user)) {
            setApiAuthSessionFailure('transient', {
                stage: 'verify',
                status: response.status,
                reason: 'malformed-response',
                requestId: data?.requestId || data?.request_id
            });
            return null;
        }
        const user = mergeApiCurrentUser(data.user);
        if (!user) {
            setApiAuthSessionFailure('transient', { stage: 'verify', reason: 'session-transition' });
            return null;
        }
        clearApiAuthSessionFailure();
        return user;
    } catch (err) {
        if (getStoredAuthToken() !== token
            || localStorage.getItem(API_AUTH_REFRESH_TOKEN_KEY) !== verifiedRefreshToken) {
            if (sessionChangeRetry < 1) return apiVerifyToken(sessionChangeRetry + 1);
            setApiAuthSessionFailure('transient', { stage: 'verify', reason: 'session-changed' });
            return null;
        }
        setApiAuthSessionFailure('transient', {
            stage: 'verify',
            reason: 'network'
        });
        console.warn('[Auth] verify failed:', err?.message || err);
        return null;
    }
}

// v10.4: Personal cabinet profile
async function apiGetProfile() {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/auth/profile`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getProfile error:', err);
        return null;
    }
}

// v10.4: Change password
async function apiChangePassword(currentPassword, newPassword) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/auth/password`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ currentPassword, newPassword })
        });
        if (handleAuthError(response)) return { success: false };
        const data = await response.json();
        if (!response.ok) return { success: false, error: data.error || 'API error' };
        return { success: true };
    } catch (err) {
        console.error('API changePassword error:', err);
        return { success: false, error: err.message };
    }
}

// v10.6: Quick task status from profile
async function apiQuickTaskStatus(taskId, status) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/auth/tasks/${taskId}/quick-status`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify({ status })
        });
        if (handleAuthError(response)) return { success: false };
        const data = await response.json();
        if (!response.ok) return { success: false, error: data.error || 'API error' };
        return { success: true, ...data };
    } catch (err) {
        console.error('API quickTaskStatus error:', err);
        return { success: false, error: err.message };
    }
}

// v10.6: Log user UI action
async function apiLogAction(action, target, meta) {
    try {
        apiNetworkFetch(`${API_BASE}/auth/log-action`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ action, target, meta })
        }); // fire-and-forget
    } catch { /* ignore */ }
}

// v10.6: Get achievements definitions
async function apiGetAchievements() {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/auth/achievements`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return {};
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getAchievements error:', err);
        return {};
    }
}

// v10.6: Get user action log
async function apiGetActionLog(filters = {}) {
    try {
        const params = new URLSearchParams();
        if (filters.user) params.set('user', filters.user);
        if (filters.limit) params.set('limit', filters.limit);
        if (filters.offset) params.set('offset', filters.offset);
        const qs = params.toString();
        const response = await apiNetworkFetch(`${API_BASE}/auth/action-log${qs ? '?' + qs : ''}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return { items: [], total: 0 };
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getActionLog error:', err);
        return { items: [], total: 0 };
    }
}

// v10.4: Profile activity with pagination
async function apiGetProfileActivity(filters = {}) {
    try {
        const params = new URLSearchParams();
        params.set('user', AppState.currentUser.username);
        if (filters.action) params.set('action', filters.action);
        if (filters.from) params.set('from', filters.from);
        if (filters.to) params.set('to', filters.to);
        if (filters.limit) params.set('limit', filters.limit);
        if (filters.offset) params.set('offset', filters.offset);
        const url = `${API_BASE}/history?${params.toString()}`;
        const response = await apiNetworkFetch(url, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return { items: [], total: 0 };
        if (!response.ok) throw new Error('API error');
        const data = await response.json();
        if (Array.isArray(data)) return { items: data, total: data.length };
        return data;
    } catch (err) {
        console.error('API getProfileActivity error:', err);
        return { items: [], total: 0 };
    }
}

// v22.3: Gamification API helpers
async function apiGamificationProfile(username) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/gamification/profile/${encodeURIComponent(username)}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) return null;
        return await response.json();
    } catch { return null; }
}

async function apiGamificationShop() {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/gamification/shop`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) return null;
        return await response.json();
    } catch { return null; }
}

async function apiGamificationBuy(shopItemId) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/gamification/shop/buy`, {
            method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ shopItemId })
        });
        if (handleAuthError(response)) return { success: false };
        return await response.json();
    } catch { return { success: false }; }
}

async function apiGamificationEquip(itemId) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/gamification/equip`, {
            method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ itemId })
        });
        if (handleAuthError(response)) return { success: false };
        return await response.json();
    } catch { return { success: false }; }
}

async function apiGamificationUnequip(slot) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/gamification/unequip`, {
            method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ slot })
        });
        if (handleAuthError(response)) return { success: false };
        return await response.json();
    } catch { return { success: false }; }
}

async function apiGamificationLeaderboard(sortBy) {
    try {
        const qs = sortBy ? `?sortBy=${sortBy}` : '';
        const response = await apiNetworkFetch(`${API_BASE}/gamification/leaderboard${qs}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) return null;
        return await response.json();
    } catch { return null; }
}

async function apiGamificationAchievements() {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/gamification/achievements`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) return null;
        return await response.json();
    } catch { return null; }
}

async function apiGamificationCoinHistory() {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/gamification/coins/history`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) return null;
        return await response.json();
    } catch { return null; }
}

// v8.4: Certificates API
async function apiGetCertificates(filters = {}) {
    try {
        const params = new URLSearchParams();
        if (filters.status) params.set('status', filters.status);
        if (filters.search) params.set('search', filters.search);
        if (filters.limit) params.set('limit', filters.limit);
        if (filters.offset) params.set('offset', filters.offset);
        const qs = params.toString();
        const url = `${API_BASE}/certificates${qs ? '?' + qs : ''}`;
        const response = await apiFetchWithAuthRetry(url, { headers: getAuthHeaders(false) });
        if (!response) {
            const failure = getApiAuthSessionFailure();
            return {
                items: [],
                total: 0,
                stats: null,
                authTransient: isApiAuthSessionFailureTransient(failure),
                authFailure: failure
            };
        }
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getCertificates error:', err);
        return { items: [], total: 0, stats: null };
    }
}

async function apiCreateCertificate(data) {
    try {
        const response = await apiFetchWithAuthRetry(`${API_BASE}/certificates`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });
        if (!response) return { success: false, error: 'Сесію тимчасово не вдалося підтвердити' };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error' };
        }
        const cert = await response.json();
        return { success: true, certificate: cert };
    } catch (err) {
        console.error('API createCertificate error:', err);
        return { success: false, error: err.message };
    }
}

async function apiBatchCreateCertificates(data) {
    try {
        const response = await apiFetchWithAuthRetry(`${API_BASE}/certificates/batch`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });
        if (!response) return { success: false, error: 'Сесію тимчасово не вдалося підтвердити' };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error' };
        }
        return await response.json();
    } catch (err) {
        console.error('API batchCreateCertificates error:', err);
        return { success: false, error: err.message };
    }
}

async function apiGetCertificateByCode(code) {
    try {
        const response = await apiFetchWithAuthRetry(`${API_BASE}/certificates/code/${encodeURIComponent(code)}`, { headers: getAuthHeaders(false) });
        if (!response) return null;
        if (!response.ok) return null;
        return await response.json();
    } catch (err) {
        console.error('API getCertificateByCode error:', err);
        return null;
    }
}

async function apiUpdateCertificateStatus(id, status, reason) {
    try {
        const response = await apiFetchWithAuthRetry(`${API_BASE}/certificates/${id}/status`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify({ status, reason })
        });
        if (!response) return { success: false, error: 'Сесію тимчасово не вдалося підтвердити' };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error' };
        }
        const cert = await response.json();
        return { success: true, certificate: cert };
    } catch (err) {
        console.error('API updateCertificateStatus error:', err);
        return { success: false, error: err.message };
    }
}

async function apiUpdateCertificate(id, data) {
    try {
        const response = await apiFetchWithAuthRetry(`${API_BASE}/certificates/${id}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });
        if (!response) return { success: false, error: 'Сесію тимчасово не вдалося підтвердити' };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error' };
        }
        const cert = await response.json();
        return { success: true, certificate: cert };
    } catch (err) {
        console.error('API updateCertificate error:', err);
        return { success: false, error: err.message };
    }
}

async function apiDeleteCertificate(id) {
    try {
        const response = await apiFetchWithAuthRetry(`${API_BASE}/certificates/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders(false)
        });
        if (!response) return { success: false, error: 'Сесію тимчасово не вдалося підтвердити' };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error' };
        }
        return await response.json();
    } catch (err) {
        console.error('API deleteCertificate error:', err);
        return { success: false, error: err.message };
    }
}

// v11.0: Kleshnya API
function normalizeAssistantPageKey(pathname) {
    var raw = String(pathname || window.location.pathname || '/')
        .replace(/^\/+/, '')
        .replace(/\.html$/, '')
        .replace(/\/$/, '');
    if (!raw || raw === 'index') return 'timeline';
    if (raw === 'leads') return 'sales-funnel';
    if (raw === 'analytics') return 'finance';
    return raw;
}

function collectAssistantActiveFilters() {
    var filters = {};
    var nodes = Array.from(document.querySelectorAll([
        'input[type="search"]',
        'input[id*="Search"]',
        'input[id*="search"]',
        'input[id*="Date"]',
        'input[id*="date"]',
        'select[id*="Filter"]',
        'select[id*="filter"]',
        '[data-assistant-filter]'
    ].join(','))).slice(0, 12);
    nodes.forEach(function (node, index) {
        var value = (node.value || node.getAttribute('data-value') || '').toString().trim();
        if (!value) return;
        var key = node.getAttribute('data-assistant-filter') || node.name || node.id || ('filter' + index);
        filters[String(key).replace(/\s+/g, '_').slice(0, 50)] = value.slice(0, 120);
    });
    return filters;
}

function buildCrmAssistantPageContext(overrides = {}) {
    var pageKey = normalizeAssistantPageKey(overrides.pageKey || overrides.page || window.location.pathname);
    var activeTab = overrides.activeTab;
    if (!activeTab) {
        var active = document.querySelector('[aria-selected="true"], .tab-btn.active, .nav-tab.active, .period-btn.active, .filter-btn.active, .view-btn.active, .fin-tab.active');
        activeTab = active && active.textContent ? active.textContent.trim() : '';
    }

    var url = new URL(window.location.href);
    var selectedEntityId = overrides.selectedEntityId
        || url.searchParams.get('open')
        || url.searchParams.get('highlight')
        || url.searchParams.get('customer')
        || url.searchParams.get('lead')
        || url.searchParams.get('task')
        || url.searchParams.get('conversation')
        || '';
    var entityType = overrides.selectedEntityType || '';
    if (!entityType && selectedEntityId) {
        if (pageKey === 'customers') entityType = 'customer';
        else if (pageKey === 'sales-funnel') entityType = 'lead';
        else if (pageKey === 'tasks') entityType = 'task';
        else if (pageKey === 'omni' || pageKey === 'chat') entityType = 'conversation';
        else entityType = 'record';
    }

    var relatedHints = [];
    if (pageKey === 'customers') relatedHints = ['sales-funnel', 'timeline', 'omni'];
    else if (pageKey === 'sales-funnel') relatedHints = ['customers', 'tasks', 'timeline', 'omni'];
    else if (pageKey === 'finance') relatedHints = ['timeline', 'customers', 'sales-funnel'];
    else if (pageKey === 'tasks') relatedHints = ['dashboard', 'sales-funnel', 'timeline'];
    else if (pageKey === 'staff' || pageKey === 'hr') relatedHints = ['tasks', 'finance', 'training'];

    return {
        pageKey: pageKey,
        pathname: window.location.pathname || '/',
        pageTitle: overrides.pageTitle || overrides.title || document.querySelector('main h1, main h2, h1, h2')?.textContent?.trim() || document.title || pageKey,
        activeTab: activeTab || '',
        selectedEntity: overrides.selectedEntity || (selectedEntityId ? { type: entityType, id: selectedEntityId } : null),
        selectedEntityId: selectedEntityId || '',
        activeFilters: overrides.activeFilters || collectAssistantActiveFilters(),
        relatedPageHints: overrides.relatedPageHints || relatedHints
    };
}

async function apiGetKleshnyaGreeting(date) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/kleshnya/greeting?date=${date}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) return null;
        return await response.json();
    } catch (err) {
        console.error('API kleshnya greeting error:', err);
        return null;
    }
}

async function apiGetKleshnyaChat() {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/kleshnya/chat`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return [];
        if (!response.ok) return [];
        return await response.json();
    } catch (err) {
        console.error('API kleshnya chat error:', err);
        return [];
    }
}

async function apiSendKleshnyaMessage(message, sessionId) {
    try {
        const body = { message, pageContext: buildCrmAssistantPageContext() };
        if (sessionId) body.session_id = sessionId;
        const response = await apiNetworkFetch(`${API_BASE}/kleshnya/chat`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(body)
        });
        if (handleAuthError(response)) return null;
        if (!response.ok) return null;
        return await response.json();
    } catch (err) {
        console.error('API kleshnya chat error:', err);
        return null;
    }
}

// v2.0: Kleshnya Sessions API
async function apiGetKleshnyaSessions() {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/kleshnya/sessions`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return [];
        if (!response.ok) return [];
        return await response.json();
    } catch (err) {
        console.error('API kleshnya sessions error:', err);
        return [];
    }
}

async function apiCreateKleshnyaSession(title, emoji) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/kleshnya/sessions`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ title, emoji })
        });
        if (handleAuthError(response)) return null;
        if (!response.ok) return null;
        return await response.json();
    } catch (err) {
        console.error('API create session error:', err);
        return null;
    }
}

async function apiUpdateKleshnyaSession(id, updates) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/kleshnya/sessions/${id}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(updates)
        });
        if (handleAuthError(response)) return null;
        if (!response.ok) return null;
        return await response.json();
    } catch (err) {
        console.error('API update session error:', err);
        return null;
    }
}

async function apiDeleteKleshnyaSession(id) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/kleshnya/sessions/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders(false)
        });
        if (handleAuthError(response)) return false;
        return response.ok;
    } catch (err) {
        console.error('API delete session error:', err);
        return false;
    }
}

async function apiGetSessionMessages(sessionId, limit, offset) {
    try {
        let url = `${API_BASE}/kleshnya/sessions/${sessionId}/messages`;
        const params = [];
        if (limit) params.push(`limit=${limit}`);
        if (offset) params.push(`offset=${offset}`);
        if (params.length) url += '?' + params.join('&');
        const response = await apiNetworkFetch(url, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return [];
        if (!response.ok) return [];
        return await response.json();
    } catch (err) {
        console.error('API session messages error:', err);
        return [];
    }
}

async function apiSetMessageReaction(messageId, reaction) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/kleshnya/messages/${messageId}/reaction`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify({ reaction })
        });
        if (handleAuthError(response)) return null;
        if (!response.ok) return null;
        return await response.json();
    } catch (err) {
        console.error('API reaction error:', err);
        return null;
    }
}

async function apiGetKleshnyaMedia(type) {
    try {
        let url = `${API_BASE}/kleshnya/media`;
        if (type) url += `?type=${type}`;
        const response = await apiNetworkFetch(url, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return [];
        if (!response.ok) return [];
        return await response.json();
    } catch (err) {
        console.error('API kleshnya media error:', err);
        return [];
    }
}

// Warehouse API
async function apiGetWarehouse(filters = {}) {
    try {
        const params = new URLSearchParams();
        if (filters.category) params.set('category', filters.category);
        if (filters.search) params.set('search', filters.search);
        if (filters.q) params.set('q', filters.q);
        if (filters.locationId) params.set('locationId', filters.locationId);
        if (filters.low_stock) params.set('low_stock', 'true');
        if (filters.all) params.set('all', 'true');
        const qs = params.toString();
        const response = await apiNetworkFetch(`${API_BASE}/warehouse${qs ? '?' + qs : ''}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return { items: [], lowStockCount: 0 };
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getWarehouse error:', err);
        return { items: [], lowStockCount: 0 };
    }
}

async function apiGetWarehouseLocationsSummary() {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/warehouse/locations-summary`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return { success: false, locations: [] };
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getWarehouseLocationsSummary error:', err);
        return { success: false, locations: [] };
    }
}

async function apiGetWarehouseCostumes() {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/warehouse/costumes`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return { success: false, data: [] };
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getWarehouseCostumes error:', err);
        return { success: false, data: [], error: err.message };
    }
}

async function apiCreateWarehouseCostume(costume) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/warehouse/costumes`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(costume || {})
        });
        if (handleAuthError(response)) return { success: false };
        const body = await response.json().catch(() => ({}));
        if (!response.ok) return { success: false, error: body.error || 'API error' };
        return body;
    } catch (err) {
        console.error('API createWarehouseCostume error:', err);
        return { success: false, error: err.message };
    }
}

async function apiUpdateWarehouseCostume(id, costume) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/warehouse/costumes/${id}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(costume || {})
        });
        if (handleAuthError(response)) return { success: false };
        const body = await response.json().catch(() => ({}));
        if (!response.ok) return { success: false, error: body.error || 'API error' };
        return body;
    } catch (err) {
        console.error('API updateWarehouseCostume error:', err);
        return { success: false, error: err.message };
    }
}

async function apiDeleteWarehouseCostume(id) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/warehouse/costumes/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders(false)
        });
        if (handleAuthError(response)) return { success: false };
        const body = await response.json().catch(() => ({}));
        if (!response.ok) return { success: false, error: body.error || 'API error' };
        return body;
    } catch (err) {
        console.error('API deleteWarehouseCostume error:', err);
        return { success: false, error: err.message };
    }
}

async function apiCreateWarehouseLocation(location) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/warehouse/locations`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(location || {})
        });
        if (handleAuthError(response)) return { success: false };
        const body = await response.json().catch(() => ({}));
        if (!response.ok) return { success: false, error: body.error || 'API error' };
        return body;
    } catch (err) {
        console.error('API createWarehouseLocation error:', err);
        return { success: false, error: err.message };
    }
}

async function apiUpdateWarehouseLocation(id, location) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/warehouse/locations/${id}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(location || {})
        });
        if (handleAuthError(response)) return { success: false };
        const body = await response.json().catch(() => ({}));
        if (!response.ok) return { success: false, error: body.error || 'API error' };
        return body;
    } catch (err) {
        console.error('API updateWarehouseLocation error:', err);
        return { success: false, error: err.message };
    }
}

async function apiArchiveWarehouseLocation(id) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/warehouse/locations/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders(false)
        });
        if (handleAuthError(response)) return { success: false };
        const body = await response.json().catch(() => ({}));
        if (!response.ok) return { success: false, error: body.error || 'API error', activeStockCount: body.activeStockCount || 0 };
        return body;
    } catch (err) {
        console.error('API archiveWarehouseLocation error:', err);
        return { success: false, error: err.message };
    }
}

async function apiCreateWarehouseItem(item) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/warehouse`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(item)
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error' };
        }
        return await response.json();
    } catch (err) {
        console.error('API createWarehouseItem error:', err);
        return { success: false, error: err.message };
    }
}

async function apiUpdateWarehouseItem(id, item) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/warehouse/${id}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(item)
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error' };
        }
        return await response.json();
    } catch (err) {
        console.error('API updateWarehouseItem error:', err);
        return { success: false, error: err.message };
    }
}

async function apiDeleteWarehouseItem(id) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/warehouse/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders(false)
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error' };
        }
        return await response.json();
    } catch (err) {
        console.error('API deleteWarehouseItem error:', err);
        return { success: false, error: err.message };
    }
}

async function apiUseWarehouseItem(id, amount, reason) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/warehouse/${id}/use`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ amount, reason })
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error' };
        }
        return await response.json();
    } catch (err) {
        console.error('API useWarehouseItem error:', err);
        return { success: false, error: err.message };
    }
}

async function apiRestockWarehouseItem(id, amount, reason) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/warehouse/${id}/restock`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ amount, reason })
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error' };
        }
        return await response.json();
    } catch (err) {
        console.error('API restockWarehouseItem error:', err);
        return { success: false, error: err.message };
    }
}

async function apiTransferWarehouseItem(id, data) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/warehouse/stock/${id}/transfer`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });
        if (handleAuthError(response)) return { success: false };
        return await response.json();
    } catch (err) {
        console.error('API transferWarehouseItem error:', err);
        return { success: false, error: err.message };
    }
}

async function apiGetWarehouseMovements(id) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/warehouse/stock/${id}/movements`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return { success: false, movements: [] };
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getWarehouseMovements error:', err);
        return { success: false, movements: [] };
    }
}

async function apiGetWarehouseHistory(filters = {}) {
    try {
        const params = new URLSearchParams();
        if (filters.limit) params.set('limit', filters.limit);
        if (filters.offset) params.set('offset', filters.offset);
        const qs = params.toString();
        const response = await apiNetworkFetch(`${API_BASE}/warehouse/history${qs ? '?' + qs : ''}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return { items: [], total: 0 };
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getWarehouseHistory error:', err);
        return { items: [], total: 0 };
    }
}

async function apiGetWarehousePhotoIntakeStatus() {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/warehouse/photo-intake/status`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getWarehousePhotoIntakeStatus error:', err);
        return { success: false, error: err.message };
    }
}

async function apiGetWarehousePhotoIntakes(filters = {}) {
    try {
        const params = new URLSearchParams();
        if (filters.status) params.set('status', filters.status);
        if (filters.limit) params.set('limit', filters.limit);
        const qs = params.toString();
        const response = await apiNetworkFetch(`${API_BASE}/warehouse/photo-intake${qs ? '?' + qs : ''}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return { success: false, items: [] };
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getWarehousePhotoIntakes error:', err);
        return { success: false, items: [], error: err.message };
    }
}

async function apiConfirmWarehousePhotoIntake(id, payload) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/warehouse/photo-intake/${id}/confirm`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload || {})
        });
        if (handleAuthError(response)) return { success: false };
        const body = await response.json().catch(() => ({}));
        if (!response.ok) return { success: false, error: body.error || 'API error' };
        return body;
    } catch (err) {
        console.error('API confirmWarehousePhotoIntake error:', err);
        return { success: false, error: err.message };
    }
}

async function apiCancelWarehousePhotoIntake(id, notes) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/warehouse/photo-intake/${id}/cancel`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ notes: notes || null })
        });
        if (handleAuthError(response)) return { success: false };
        const body = await response.json().catch(() => ({}));
        if (!response.ok) return { success: false, error: body.error || 'API error' };
        return body;
    } catch (err) {
        console.error('API cancelWarehousePhotoIntake error:', err);
        return { success: false, error: err.message };
    }
}

async function apiGetContractors(filters = {}) {
    try {
        const params = new URLSearchParams();
        if (filters.category) params.set('category', filters.category);
        if (filters.q) params.set('q', filters.q);
        if (filters.active !== undefined) params.set('active', filters.active ? 'true' : 'false');
        const qs = params.toString();
        const response = await apiNetworkFetch(`${API_BASE}/contractors${qs ? '?' + qs : ''}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return { contractors: [] };
        if (!response.ok) throw new Error('API error');
        const data = await response.json();
        return Array.isArray(data) ? { contractors: data } : data;
    } catch (err) {
        console.error('API getContractors error:', err);
        return { contractors: [] };
    }
}

async function apiCreateContractor(data) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/contractors`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });
        if (handleAuthError(response)) return { success: false };
        return await response.json();
    } catch (err) {
        console.error('API createContractor error:', err);
        return { success: false, error: err.message };
    }
}

async function apiUpdateContractor(id, data) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/contractors/${id}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });
        if (handleAuthError(response)) return { success: false };
        return await response.json();
    } catch (err) {
        console.error('API updateContractor error:', err);
        return { success: false, error: err.message };
    }
}

async function apiGetContractorOrderContext(id, filters = {}) {
    try {
        const params = new URLSearchParams();
        if (filters.stockItemId) params.set('stockItemId', filters.stockItemId);
        if (filters.procurementItemId) params.set('procurementItemId', filters.procurementItemId);
        const response = await apiNetworkFetch(`${API_BASE}/contractors/${id}/order-context?${params}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getContractorOrderContext error:', err);
        return null;
    }
}

// v17.0: Procurement API
async function apiGetProcurementLists(filters = {}) {
    try {
        const params = new URLSearchParams();
        if (filters.department) params.set('department', filters.department);
        if (filters.status) params.set('status', filters.status);
        if (filters.all) params.set('all', 'true');
        const response = await apiNetworkFetch(`${API_BASE}/procurement?${params}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return { lists: [] };
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getProcurementLists error:', err);
        return { lists: [] };
    }
}

async function apiGetProcurementList(id) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/procurement/${id}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getProcurementList error:', err);
        return null;
    }
}

async function apiCreateProcurementList(data) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/procurement`, {
            method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(data)
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) {
        console.error('API createProcurementList error:', err);
        return null;
    }
}

async function apiUpdateProcurementList(id, data) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/procurement/${id}`, {
            method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify(data)
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) {
        console.error('API updateProcurementList error:', err);
        return null;
    }
}

async function apiDeleteProcurementList(id) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/procurement/${id}`, {
            method: 'DELETE', headers: getAuthHeaders()
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) {
        console.error('API deleteProcurementList error:', err);
        return null;
    }
}

async function apiAddProcurementItem(listId, data) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/procurement/${listId}/items`, {
            method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(data)
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) {
        console.error('API addProcurementItem error:', err);
        return null;
    }
}

async function apiUpdateProcurementItem(listId, itemId, data) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/procurement/${listId}/items/${itemId}`, {
            method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify(data)
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) {
        console.error('API updateProcurementItem error:', err);
        return null;
    }
}

async function apiDeleteProcurementItem(listId, itemId) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/procurement/${listId}/items/${itemId}`, {
            method: 'DELETE', headers: getAuthHeaders()
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) {
        console.error('API deleteProcurementItem error:', err);
        return null;
    }
}

async function apiCompleteProcurement(id) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/procurement/${id}/complete`, {
            method: 'POST', headers: getAuthHeaders()
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) {
        console.error('API completeProcurement error:', err);
        return null;
    }
}

async function apiGetProcurementSuggestions() {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/procurement/suggestions/low-stock`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return { suggestions: [] };
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getProcurementSuggestions error:', err);
        return { suggestions: [] };
    }
}

async function apiGetProcurementKitchenDemand() {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/procurement/suggestions/kitchen-demand`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return { suggestions: [] };
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getProcurementKitchenDemand error:', err);
        return { suggestions: [] };
    }
}

async function apiCreateProcurementFromStockItem(stockItemId, data = {}) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/procurement/from-stock-item/${stockItemId}`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) {
        console.error('API createProcurementFromStockItem error:', err);
        return null;
    }
}

async function apiReceiveProcurementItem(listId, itemId, data = {}) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/procurement/${listId}/items/${itemId}/receive`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) {
        console.error('API receiveProcurementItem error:', err);
        return null;
    }
}

// v17.0: Budget API
async function apiGetBudget(year) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/finance/budget?year=${year}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return { plans: [] };
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getBudget error:', err);
        return { plans: [] };
    }
}

async function apiSaveBudget(data) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/finance/budget`, {
            method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify(data)
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) {
        console.error('API saveBudget error:', err);
        return null;
    }
}

async function apiGetBudgetComparison(year, month) {
    try {
        const response = await apiNetworkFetch(`${API_BASE}/finance/budget/comparison?year=${year}&month=${month}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getBudgetComparison error:', err);
        return null;
    }
}

// v15.1: CRM — Customer search (autocomplete)
async function apiSearchCustomers(query) {
    try {
        let url = `${API_BASE}/customers/search?q=${encodeURIComponent(query)}`;
        url = window.TimelineBusinessContext?.appendApiContext?.(url) || url;
        const response = typeof apiFetchWithAuthRetry === 'function'
            ? await apiFetchWithAuthRetry(url, { headers: getAuthHeaders(false) })
            : await apiNetworkFetch(url, { headers: getAuthHeaders(false) });
        if (!response || handleAuthError(response)) return [];
        if (!response.ok) throw new Error('API error');
        const payload = await response.json();
        if (Array.isArray(payload)) return payload;
        if (Array.isArray(payload?.customers)) return payload.customers;
        return [];
    } catch (err) {
        console.error('API searchCustomers error:', err);
        return [];
    }
}

async function apiGetCustomer(id) {
    try {
        let url = `${API_BASE}/customers/${id}`;
        url = window.TimelineBusinessContext?.appendApiContext?.(url) || url;
        const response = typeof apiFetchWithAuthRetry === 'function'
            ? await apiFetchWithAuthRetry(url, { headers: getAuthHeaders(false) })
            : await apiNetworkFetch(url, { headers: getAuthHeaders(false) });
        if (!response || handleAuthError(response)) return null;
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getCustomer error:', err);
        return null;
    }
}
async function apiGetLeadBookingContext(id) {
    try {
        let url = `${API_BASE}/leads/${encodeURIComponent(id)}/booking-context`;
        url = window.TimelineBusinessContext?.appendApiContext?.(url) || url;
        const response = typeof apiFetchWithAuthRetry === 'function'
            ? await apiFetchWithAuthRetry(url, { headers: getAuthHeaders(false) })
            : await apiNetworkFetch(url, { headers: getAuthHeaders(false) });
        if (!response || handleAuthError(response)) return null;
        if (!response.ok) throw new Error('API error');
        const payload = await response.json();
        return payload?.leadContext || null;
    } catch (err) {
        console.error('API getLeadBookingContext error:', err);
        return null;
    }
}

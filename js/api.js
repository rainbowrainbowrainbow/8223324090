/**
 * api.js - Всі API функції (PostgreSQL + localStorage fallback)
 * v25.3: Unified apiCall wrapper to reduce try/catch duplication
 */

const API_BASE = '/api';
const API_AUTH_ACCESS_TOKEN_KEY = 'pzp_access_token';
const API_AUTH_REFRESH_TOKEN_KEY = 'pzp_refresh_token';
const API_AUTH_REFRESH_EXPIRES_KEY = 'pzp_refresh_expires_at';

function getStoredAuthToken() {
    return localStorage.getItem('pzp_token') || localStorage.getItem(API_AUTH_ACCESS_TOKEN_KEY);
}

function apiHasStoredAuthSession() {
    return Boolean(getStoredAuthToken() || localStorage.getItem(API_AUTH_REFRESH_TOKEN_KEY));
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

async function apiErrorFromResponse(response, fallback = 'API error') {
    const payload = await response.json().catch(() => ({}));
    return apiErrorFromPayload({ ...payload, status: response.status }, fallback);
}

function timelineApiUrl(url) {
    if (typeof window !== 'undefined' && window.TimelineBusinessContext) {
        return window.TimelineBusinessContext.appendApiContext(url);
    }
    return url;
}

function timelineApiPayload(payload) {
    if (typeof window !== 'undefined' && window.TimelineBusinessContext) {
        return window.TimelineBusinessContext.withApiContext(payload);
    }
    return payload;
}

const CRM_BUSINESS_STORAGE_KEY = 'pzp_crm_business_context';
const CRM_BUSINESS_STORAGE_USER_KEY = 'pzp_crm_business_context_user';
const CRM_BUSINESS_LEGACY_PRODUCT_STORAGE_KEY = 'pzp_products_business_context';
const CRM_BUSINESS_DEFAULT_CONTEXT = 'event_genix';
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
            'dashboard', 'tasks', 'chat', 'customers', 'leads', 'omni', 'reports',
            'finance', 'copilot', 'staff', 'hr', 'content', 'art',
            'warehouse', 'kleshnya', 'center', 'settings'
        ]
    },
    maysternya_doli: {
        key: 'maysternya_doli',
        label: 'Майстерня Долі',
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
    'director',
    'vice_director',
    'senior_manager'
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
const crmBusinessPageBindings = new Map();

function normalizeCrmBusinessContext(value) {
    const key = String(value || '').trim().toLowerCase();
    if (CRM_BUSINESS_CONTEXT_ALIASES[key]) return CRM_BUSINESS_CONTEXT_ALIASES[key];
    return CRM_BUSINESS_CONTEXTS[key] ? key : CRM_BUSINESS_DEFAULT_CONTEXT;
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

function crmBusinessStorageUserKey(user) {
    if (!user) return '';
    return String(user.id || user.username || user.name || '').trim();
}

function crmBusinessContextFromStorage(user = null) {
    try {
        const value = localStorage.getItem(CRM_BUSINESS_STORAGE_KEY)
            || localStorage.getItem(CRM_BUSINESS_LEGACY_PRODUCT_STORAGE_KEY);
        if (!value) return null;
        const currentUserKey = crmBusinessStorageUserKey(user);
        const storedUserKey = String(localStorage.getItem(CRM_BUSINESS_STORAGE_USER_KEY) || '').trim();
        if (currentUserKey && storedUserKey !== currentUserKey) return null;
        return normalizeCrmBusinessContext(value);
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
    const roles = crmBusinessRoles(user);
    return CRM_BUSINESS_SWITCH_ROLES.some(role => roles.includes(role));
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

function crmBusinessContextHasModule(context, moduleId) {
    if (!moduleId) return true;
    const ctx = CRM_BUSINESS_CONTEXTS[normalizeCrmBusinessContext(context)] || CRM_BUSINESS_CONTEXTS[CRM_BUSINESS_DEFAULT_CONTEXT];
    return Array.isArray(ctx.modules) && ctx.modules.includes(String(moduleId));
}

function sanitizeCrmBusinessContextForUser(context, user) {
    const key = normalizeCrmBusinessContext(context);
    const policy = resolveCrmBusinessPolicy(user);
    if (policy.canSwitch && policy.allowed.includes(key)) return key;
    if (!policy.canSwitch && policy.allowed.includes(key)) return key;
    return policy.defaultContext;
}

function getCrmBusinessContext(user) {
    const activeUser = user || (typeof AppState !== 'undefined' ? AppState.currentUser : null);
    const fromRoute = crmBusinessContextFromRoute();
    const fromUrl = crmBusinessContextFromUrl();
    const stored = crmBusinessContextFromStorage(activeUser);
    const policy = resolveCrmBusinessPolicy(activeUser);
    const accountDefault = policy.defaultContext || CRM_BUSINESS_DEFAULT_CONTEXT;
    const preferAccountDefaultOnTimelineRoot = normalizedCrmPath() === '/' && !fromUrl;
    const next = fromRoute || fromUrl || (preferAccountDefaultOnTimelineRoot ? accountDefault : (stored || accountDefault)) || CRM_BUSINESS_DEFAULT_CONTEXT;
    return sanitizeCrmBusinessContextForUser(next, activeUser);
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

function setCrmBusinessContext(context, options = {}) {
    const user = options.user || (typeof AppState !== 'undefined' ? AppState.currentUser : null);
    const previous = getCrmBusinessContext(user);
    const key = sanitizeCrmBusinessContextForUser(context, user);
    try {
        localStorage.setItem(CRM_BUSINESS_STORAGE_KEY, key);
        const userKey = crmBusinessStorageUserKey(user);
        if (userKey) localStorage.setItem(CRM_BUSINESS_STORAGE_USER_KEY, userKey);
        localStorage.removeItem(CRM_BUSINESS_LEGACY_PRODUCT_STORAGE_KEY);
    } catch {}
    if (options.updateUrl !== false && typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        const routeContext = crmBusinessContextFromRoute(url.pathname);
        if (key === CRM_BUSINESS_DEFAULT_CONTEXT || routeContext === key) url.searchParams.delete('businessContext');
        else url.searchParams.set('businessContext', key);
        window.history.replaceState(window.history.state || {}, '', url);
    }
    if (options.emit !== false && typeof window !== 'undefined' && previous !== key) {
        window.dispatchEvent(new CustomEvent('crmBusinessContextChanged', {
            detail: { previous, current: key, context: CRM_BUSINESS_CONTEXTS[key] }
        }));
    }
    return key;
}

function crmBusinessApiUrl(url, context = getCrmBusinessContext()) {
    const key = normalizeCrmBusinessContext(context);
    try {
        const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
        const target = new URL(String(url), base);
        target.searchParams.set('businessContext', key);
        if (typeof window !== 'undefined' && target.origin === window.location.origin) {
            return `${target.pathname}${target.search}${target.hash}`;
        }
        return target.toString();
    } catch {
        const joiner = String(url).includes('?') ? '&' : '?';
        return `${url}${joiner}businessContext=${encodeURIComponent(key)}`;
    }
}

function crmBusinessPayload(payload, context = getCrmBusinessContext()) {
    return { ...(payload || {}), businessContext: normalizeCrmBusinessContext(context) };
}

function currentCrmBusinessScopedPage(pathname = '') {
    const path = normalizedCrmPath(pathname);
    return Object.values(CRM_BUSINESS_SCOPED_PAGES).find(page => page.paths.includes(path)) || null;
}

function crmBusinessDestinationForCurrentPage(context, page = currentCrmBusinessScopedPage()) {
    const key = normalizeCrmBusinessContext(context);
    if (page?.id !== 'timeline') return null;
    if (key === 'maysternya_doli') return '/maysternya-doli';
    if (key === CRM_BUSINESS_DEFAULT_CONTEXT) return '/';
    return `/dashboard?businessContext=${encodeURIComponent(key)}`;
}

function navigateCrmBusinessDestination(context, page = currentCrmBusinessScopedPage()) {
    if (typeof window === 'undefined') return false;
    const destination = crmBusinessDestinationForCurrentPage(context, page);
    if (!destination) return false;
    const target = new URL(destination, window.location.origin);
    const current = new URL(window.location.href);
    if (target.pathname === current.pathname && target.search === current.search) return false;
    window.__crmBusinessNavigationPending = true;
    window.location.href = `${target.pathname}${target.search}${target.hash}`;
    return true;
}

function renderCrmBusinessShell(user) {
    if (typeof document === 'undefined') return false;
    const page = currentCrmBusinessScopedPage();
    const headerContent = document.querySelector('.header .header-content');
    const existing = document.getElementById('globalBusinessContextHost');
    if (!page || !headerContent) {
        if (existing) existing.remove();
        return false;
    }

    const policy = resolveCrmBusinessPolicy(user);
    const current = setCrmBusinessContext(getCrmBusinessContext(user), { user, updateUrl: true, emit: false });
    if (navigateCrmBusinessDestination(current, page)) return true;
    const context = CRM_BUSINESS_CONTEXTS[current] || CRM_BUSINESS_CONTEXTS[CRM_BUSINESS_DEFAULT_CONTEXT];
    const options = getCrmBusinessContextOptions(user);
    const host = existing || document.createElement('div');
    host.id = 'globalBusinessContextHost';
    host.className = 'crm-business-context-host';
    host.dataset.businessContextShell = page.id;
    host.dataset.locked = policy.canSwitch ? '0' : '1';
    host.setAttribute('aria-label', 'Бізнес-контекст CRM');

    if (policy.canSwitch && options.length > 1) {
        host.innerHTML = `
            <span class="crm-business-context-label">Бізнес</span>
            <select id="globalBusinessContextSelect" class="crm-business-context-select crm-business-context-select--global" aria-label="Бізнес-контекст CRM">
                ${options.map(ctx => `<option value="${ctx.key}"${ctx.key === current ? ' selected' : ''}>${ctx.label}</option>`).join('')}
            </select>
        `;
    } else {
        host.innerHTML = `
            <span class="crm-business-context-label">Бізнес</span>
            <span class="crm-business-context-chip" role="status" title="Контекст зафіксовано політикою ролі">
                <strong>${context.label}</strong>
                <span>зафіксовано</span>
            </span>
        `;
    }

    if (!existing) {
        const userPanel = headerContent.querySelector('.user-panel');
        if (userPanel) headerContent.insertBefore(host, userPanel);
        else headerContent.appendChild(host);
    }

    const select = host.querySelector('#globalBusinessContextSelect');
    if (select && select.dataset.bound !== '1') {
        select.dataset.bound = '1';
        select.addEventListener('change', async event => {
            select.disabled = true;
            await switchCrmBusinessContext(event.target.value, { user, updateUrl: true });
            renderCrmBusinessShell(user);
        });
    }
    return true;
}

async function switchCrmBusinessContext(context, options = {}) {
    const user = options.user || (typeof AppState !== 'undefined' ? AppState.currentUser : null);
    const next = sanitizeCrmBusinessContextForUser(context, user);
    const previous = getCrmBusinessContext(user);
    if (previous === next) {
        setCrmBusinessContext(next, { ...options, user, emit: false });
        return next;
    }
    const page = currentCrmBusinessScopedPage();
    const binding = page ? crmBusinessPageBindings.get(page.id) : null;
    if (typeof binding?.beforeChange === 'function') {
        const allowed = await binding.beforeChange(next, previous);
        if (allowed === false) return previous;
    }
    const current = setCrmBusinessContext(next, { ...options, user, emit: true });
    if (typeof binding?.onChange === 'function') {
        await binding.onChange({ current, previous, context: CRM_BUSINESS_CONTEXTS[current] });
    }
    if (options.navigate !== false && navigateCrmBusinessDestination(current, page)) {
        return current;
    }
    return current;
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
    const current = setCrmBusinessContext(getCrmBusinessContext(user), { user, updateUrl: options.updateUrl !== false, emit: false });
    renderCrmBusinessShell(user);
    return current;
}

if (typeof window !== 'undefined') {
    window.CrmBusinessContext = {
        contexts: CRM_BUSINESS_CONTEXTS,
        scopedPages: CRM_BUSINESS_SCOPED_PAGES,
        switchRoles: CRM_BUSINESS_SWITCH_ROLES,
        normalize: normalizeCrmBusinessContext,
        current: getCrmBusinessContext,
        set: setCrmBusinessContext,
        switchTo: switchCrmBusinessContext,
        canAccess: userCanAccessCrmBusinessContext,
        hasModule: crmBusinessContextHasModule,
        options: getCrmBusinessContextOptions,
        policy: resolveCrmBusinessPolicy,
        currentPage: currentCrmBusinessScopedPage,
        initPage: initCrmBusinessContextPage,
        renderShell: renderCrmBusinessShell,
        apiUrl: crmBusinessApiUrl,
        payload: crmBusinessPayload
    };
}

// v39.9: Global safe fetch wrapper — auto-checks response.ok, handles auth errors
async function safeFetch(url, opts = {}) {
    if (!opts.headers) opts.headers = {};
    if (!opts.headers['Authorization']) {
        const token = getStoredAuthToken();
        if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    }
    if (!opts.headers['X-Business-Context'] && !opts.headers['x-business-context']) {
        opts.headers['X-Business-Context'] = getCrmBusinessContext();
    }
    const res = await fetch(url, opts);
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
    headers['X-Business-Context'] = getCrmBusinessContext();
    return headers;
}

function getTimelineAuthHeaders(withContentType = true) {
    const headers = getAuthHeaders(withContentType);
    delete headers['X-Business-Context'];
    delete headers['x-business-context'];
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
    const originalHeaders = apiHeaderObject(opts.headers || {});
    if (!Object.keys(originalHeaders).some(key => String(key).toLowerCase() === 'x-business-context')) {
        originalHeaders['X-Business-Context'] = getCrmBusinessContext();
    }
    let token = getStoredAuthToken();
    if (!token && localStorage.getItem(API_AUTH_REFRESH_TOKEN_KEY)) token = await apiRefreshAuthToken();
    request.headers = apiWithBearer(originalHeaders, token);

    let response = await fetch(url, request);
    if (response.status === 401 && localStorage.getItem(API_AUTH_REFRESH_TOKEN_KEY)) {
        const refreshedToken = await apiRefreshAuthToken();
        if (refreshedToken) {
            response = await fetch(url, {
                ...opts,
                headers: apiWithBearer(originalHeaders, refreshedToken, true)
            });
        }
    }
    if (response && response.status === 401 && typeof handleAuthError === 'function') {
        if (handleAuthError(response)) return null;
    }
    return response;
}

// v5.0: Handle 401/403 — redirect to login
function handleAuthError(response) {
    if (response.status === 403) {
        return false;
    }
    if (response.status === 401) {
        // In embedded mode (iframe), never redirect — parent page handles auth
        const isEmbedded = document.documentElement.classList.contains('embed-mode')
            || (window.self !== window.top);
        if (isEmbedded) return true;

        if (typeof clearAuthStorage === 'function') {
            clearAuthStorage();
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
        const isGet = method === 'GET';
        const opts = { method, headers: getAuthHeaders(!isGet) };
        if (body && !isGet) opts.body = JSON.stringify(body);
        const response = await fetch(`${API_BASE}${url}`, opts);
        if (handleAuthError(response)) return fallback;
        if (raw) return response;
        if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            return {
                success: false,
                error: formatApiErrorPayload(errBody, 'API error'),
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

async function apiGetBookings(date) {
    try {
        const response = await fetch(`${API_BASE}${timelineApiUrl(`/bookings/${date}`)}`, { headers: getTimelineAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getBookings error:', err);
        // v7.0.1: Return null on error so cache layer can preserve existing data
        return null;
    }
}

async function apiCreateBooking(booking) {
    try {
        const response = await fetch(`${API_BASE}/bookings`, {
            method: 'POST',
            headers: getTimelineAuthHeaders(),
            body: JSON.stringify(timelineApiPayload(booking))
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error', conflictBookingId: body.conflictBookingId || null };
        }
        return await response.json();
    } catch (err) {
        console.error('API createBooking error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

// v5.7: Create booking with linked bookings in one transaction
async function apiCreateBookingFull(main, linked) {
    try {
        const response = await fetch(`${API_BASE}/bookings/full`, {
            method: 'POST',
            headers: getTimelineAuthHeaders(),
            body: JSON.stringify(timelineApiPayload({ main: timelineApiPayload(main), linked: (linked || []).map(item => timelineApiPayload(item)) }))
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error', conflictBookingId: body.conflictBookingId || null };
        }
        return await response.json();
    } catch (err) {
        console.error('API createBookingFull error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

async function apiDeleteBooking(id) {
    try {
        const response = await fetch(`${API_BASE}${timelineApiUrl(`/bookings/${id}`)}`, {
            method: 'DELETE',
            headers: getTimelineAuthHeaders(false)
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error' };
        }
        return await response.json();
    } catch (err) {
        console.error('API deleteBooking error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

async function apiUpdateBooking(id, booking) {
    try {
        const response = await fetch(`${API_BASE}${timelineApiUrl(`/bookings/${id}`)}`, {
            method: 'PUT',
            headers: getTimelineAuthHeaders(),
            body: JSON.stringify(timelineApiPayload(booking))
        });
        if (handleAuthError(response)) return { success: false };
        // Optimistic locking: 409 with conflict field
        if (response.status === 409) {
            const body = await response.json().catch(() => ({}));
            return {
                success: false,
                conflict: body.conflict || false,
                error: body.error || 'Конфлікт даних',
                currentData: body.currentData || null,
                conflictBookingId: body.conflictBookingId || null
            };
        }
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error' };
        }
        return await response.json();
    } catch (err) {
        console.error('API updateBooking error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

async function apiConfirmBooking(id, payload = {}) {
    try {
        const response = await fetch(`${API_BASE}/bookings/${encodeURIComponent(id)}/confirm`, {
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

async function apiUpdateLinkedBookingsAtomic(id, payload) {
    try {
        const response = await fetch(`${API_BASE}/bookings/${id}/linked-atomic`, {
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
            return { success: false, error: body.error || 'API error' };
        }
        return await response.json();
    } catch (err) {
        console.error('API updateLinkedBookingsAtomic error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

async function apiCreateBookingBanquetLink(sourceId, targetId, label = '') {
    try {
        const response = await fetch(`${API_BASE}${timelineApiUrl(`/bookings/${encodeURIComponent(sourceId)}/banquet-links`)}`, {
            method: 'POST',
            headers: getTimelineAuthHeaders(),
            body: JSON.stringify(timelineApiPayload({ targetId, label }))
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

async function apiDeleteBookingBanquetLink(sourceId, targetId) {
    try {
        const response = await fetch(`${API_BASE}${timelineApiUrl(`/bookings/${encodeURIComponent(sourceId)}/banquet-links/${encodeURIComponent(targetId)}`)}`, {
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

async function apiGetLines(date) {
    try {
        const response = await fetch(`${API_BASE}${timelineApiUrl(`/lines/${date}`)}`, { headers: getTimelineAuthHeaders(false) });
        // console.log('[apiGetLines] status=' + response.status + ' date=' + date);
        if (handleAuthError(response)) { console.warn('[apiGetLines] Auth error — returning null'); return null; }
        if (!response.ok) throw new Error('API error ' + response.status);
        const data = await response.json();
        // console.log('[apiGetLines] Got ' + (data ? data.length : 0) + ' lines');
        return data;
    } catch (err) {
        console.error('[apiGetLines] error:', err);
        return null;
    }
}

async function apiSaveLines(date, lines) {
    try {
        const response = await fetch(`${API_BASE}${timelineApiUrl(`/lines/${date}`)}`, {
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
        const response = await fetch(url, { headers: getAuthHeaders(false) });
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
        const response = await fetch(`${API_BASE}/history`, {
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
        const response = await fetch(`${API_BASE}/stats/${dateFrom}/${dateTo}`, { headers: getAuthHeaders(false) });
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
        const response = await fetch(url, { headers: getAuthHeaders(false) });
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
        const response = await fetch(url, { headers: getAuthHeaders(false) });
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
        const response = await fetch(url, { headers: getAuthHeaders(false) });
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
        const response = await fetch(url, { headers: getAuthHeaders(false) });
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
        const response = await fetch(`${API_BASE}/telegram/notify`, {
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
        const response = await fetch(`${API_BASE}/telegram/ask-animator`, {
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
        const response = await fetch(`${API_BASE}/telegram/animator-status/${requestId}`, { headers: getAuthHeaders(false) });
        return await response.json();
    } catch (err) {
        console.error('Check animator status error:', err);
        return { status: 'error' };
    }
}

async function apiGetSetting(key) {
    try {
        const response = await fetch(`${API_BASE}/settings/${key}`, { headers: getAuthHeaders(false) });
        const data = await response.json();
        return data.value;
    } catch (err) {
        console.error('getSetting error:', err);
        return null;
    }
}

async function apiSaveSetting(key, value) {
    try {
        await fetch(`${API_BASE}/settings`, {
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
        const qs = params.toString() ? `?${params.toString()}` : '';
        const response = await fetch(`${API_BASE}/products${qs}`, { headers: getAuthHeaders(false) });
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
        const qs = params.toString() ? `?${params.toString()}` : '';
        const response = await fetch(`${API_BASE}/products/${encodeURIComponent(id)}${qs}`, { headers: getAuthHeaders(false) });
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
        const response = await fetch(`${API_BASE}/products/catalogs${qs}`, { headers: getAuthHeaders(false) });
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
        const response = await fetch(`${API_BASE}/products`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(product)
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error' };
        }
        const data = await response.json();
        return { success: true, product: data };
    } catch (err) {
        console.error('API createProduct error:', err);
        return { success: false, error: err.message };
    }
}

async function apiUpdateProduct(id, product) {
    try {
        const response = await fetch(`${API_BASE}/products/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(product)
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error' };
        }
        const data = await response.json();
        return { success: true, product: data };
    } catch (err) {
        console.error('API updateProduct error:', err);
        return { success: false, error: err.message };
    }
}

async function apiUpdateProductDocument(id, payload) {
    try {
        const response = await fetch(`${API_BASE}/products/${encodeURIComponent(id)}/source-document`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload || {})
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error' };
        }
        const data = await response.json();
        return { success: true, product: data };
    } catch (err) {
        console.error('API updateProductDocument error:', err);
        return { success: false, error: err.message };
    }
}

async function apiDeleteProduct(id, options = {}) {
    try {
        const params = new URLSearchParams();
        addProductBusinessContextParam(params, getProductBusinessContextValue(options));
        const qs = params.toString() ? `?${params.toString()}` : '';
        const response = await fetch(`${API_BASE}/products/${encodeURIComponent(id)}${qs}`, {
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
        console.error('API deleteProduct error:', err);
        return { success: false, error: err.message };
    }
}

async function apiGetProductTechCard(id, options = {}) {
    try {
        const params = new URLSearchParams();
        addProductBusinessContextParam(params, getProductBusinessContextValue(options));
        const qs = params.toString() ? `?${params.toString()}` : '';
        const response = await fetch(`${API_BASE}/products/${encodeURIComponent(id)}/tech-card${qs}`, { headers: getAuthHeaders(false) });
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
        const response = await fetch(`${API_BASE}/products/${encodeURIComponent(id)}/tech-card`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload || {})
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error' };
        }
        return await response.json();
    } catch (err) {
        console.error('API updateProductTechCard error:', err);
        return { success: false, error: err.message };
    }
}

async function apiWriteOffProductTechCard(id, payload = {}) {
    try {
        const response = await fetch(`${API_BASE}/products/${encodeURIComponent(id)}/tech-card/write-off`, {
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
        const response = await fetch(`${API_BASE}/products/menu-ai-draft`, {
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

async function apiGetProductMenuAiDraft(id, options = {}) {
    try {
        const params = new URLSearchParams();
        addProductBusinessContextParam(params, getProductBusinessContextValue(options));
        const qs = params.toString() ? `?${params.toString()}` : '';
        const response = await fetch(`${API_BASE}/products/${encodeURIComponent(id)}/ai-card-draft${qs}`, { headers: getAuthHeaders(false) });
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
        const response = await fetch(`${API_BASE}/products/${encodeURIComponent(id)}/ai-card-draft`, {
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

// v5.0: Auth API
async function apiLogin(username, password) {
    const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    if (!response.ok) {
        let errMsg = 'Login failed';
        try { const err = await response.json(); errMsg = err.error || errMsg; } catch {}
        throw new Error(errMsg);
    }
    return await response.json();
}

function clearApiAuthSessionStorage() {
    localStorage.removeItem('pzp_token');
    localStorage.removeItem(API_AUTH_ACCESS_TOKEN_KEY);
    localStorage.removeItem(API_AUTH_REFRESH_TOKEN_KEY);
    localStorage.removeItem(API_AUTH_REFRESH_EXPIRES_KEY);
    localStorage.removeItem(CONFIG.STORAGE.CURRENT_USER);
    localStorage.removeItem(CONFIG.STORAGE.SESSION);
}

function rememberApiAuthSession(data = {}) {
    const accessToken = data.accessToken || data.token || '';
    const legacyToken = data.token || accessToken;
    if (legacyToken) localStorage.setItem('pzp_token', legacyToken);
    if (accessToken) localStorage.setItem(API_AUTH_ACCESS_TOKEN_KEY, accessToken);
    if (data.refreshToken) localStorage.setItem(API_AUTH_REFRESH_TOKEN_KEY, data.refreshToken);
    if (data.refreshExpiresAt) localStorage.setItem(API_AUTH_REFRESH_EXPIRES_KEY, String(data.refreshExpiresAt));
    if (data.user) localStorage.setItem(CONFIG.STORAGE.CURRENT_USER, JSON.stringify(data.user));
}

async function apiRefreshAuthToken() {
    const refreshToken = localStorage.getItem(API_AUTH_REFRESH_TOKEN_KEY);
    if (!refreshToken) return null;
    try {
        const response = await fetch(`${API_BASE}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.accessToken) {
            clearApiAuthSessionStorage();
            return null;
        }
        rememberApiAuthSession(data);
        return data.accessToken;
    } catch (err) {
        console.warn('[Auth] refresh failed:', err?.message || err);
        return null;
    }
}

async function apiVerifyToken() {
    let token = getStoredAuthToken();
    if (!token) token = await apiRefreshAuthToken();
    if (!token) return null;
    try {
        let response = await fetch(`${API_BASE}/auth/verify`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok && (response.status === 401 || response.status === 403)) {
            const refreshedToken = await apiRefreshAuthToken();
            if (!refreshedToken) return null;
            response = await fetch(`${API_BASE}/auth/verify`, {
                headers: { 'Authorization': `Bearer ${refreshedToken}` }
            });
        }
        if (!response.ok) return null;
        const data = await response.json();
        return data.user;
    } catch {
        return null;
    }
}

// v10.4: Personal cabinet profile
async function apiGetProfile() {
    try {
        const response = await fetch(`${API_BASE}/auth/profile`, { headers: getAuthHeaders(false) });
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
        const response = await fetch(`${API_BASE}/auth/password`, {
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
        const response = await fetch(`${API_BASE}/auth/tasks/${taskId}/quick-status`, {
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
        fetch(`${API_BASE}/auth/log-action`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ action, target, meta })
        }); // fire-and-forget
    } catch { /* ignore */ }
}

// v10.6: Get achievements definitions
async function apiGetAchievements() {
    try {
        const response = await fetch(`${API_BASE}/auth/achievements`, { headers: getAuthHeaders(false) });
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
        const response = await fetch(`${API_BASE}/auth/action-log${qs ? '?' + qs : ''}`, { headers: getAuthHeaders(false) });
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
        const response = await fetch(url, { headers: getAuthHeaders(false) });
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
        const response = await fetch(`${API_BASE}/gamification/profile/${encodeURIComponent(username)}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) return null;
        return await response.json();
    } catch { return null; }
}

async function apiGamificationShop() {
    try {
        const response = await fetch(`${API_BASE}/gamification/shop`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) return null;
        return await response.json();
    } catch { return null; }
}

async function apiGamificationBuy(shopItemId) {
    try {
        const response = await fetch(`${API_BASE}/gamification/shop/buy`, {
            method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ shopItemId })
        });
        if (handleAuthError(response)) return { success: false };
        return await response.json();
    } catch { return { success: false }; }
}

async function apiGamificationEquip(itemId) {
    try {
        const response = await fetch(`${API_BASE}/gamification/equip`, {
            method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ itemId })
        });
        if (handleAuthError(response)) return { success: false };
        return await response.json();
    } catch { return { success: false }; }
}

async function apiGamificationUnequip(slot) {
    try {
        const response = await fetch(`${API_BASE}/gamification/unequip`, {
            method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ slot })
        });
        if (handleAuthError(response)) return { success: false };
        return await response.json();
    } catch { return { success: false }; }
}

async function apiGamificationLeaderboard(sortBy) {
    try {
        const qs = sortBy ? `?sortBy=${sortBy}` : '';
        const response = await fetch(`${API_BASE}/gamification/leaderboard${qs}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) return null;
        return await response.json();
    } catch { return null; }
}

async function apiGamificationAchievements() {
    try {
        const response = await fetch(`${API_BASE}/gamification/achievements`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) return null;
        return await response.json();
    } catch { return null; }
}

async function apiGamificationCoinHistory() {
    try {
        const response = await fetch(`${API_BASE}/gamification/coins/history`, { headers: getAuthHeaders(false) });
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
        const response = await fetch(url, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return { items: [], total: 0, stats: null };
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getCertificates error:', err);
        return { items: [], total: 0, stats: null };
    }
}

async function apiCreateCertificate(data) {
    try {
        const response = await fetch(`${API_BASE}/certificates`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });
        if (handleAuthError(response)) return { success: false };
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
        const response = await fetch(`${API_BASE}/certificates/batch`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });
        if (handleAuthError(response)) return { success: false };
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
        const response = await fetch(`${API_BASE}/certificates/code/${encodeURIComponent(code)}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) return null;
        return await response.json();
    } catch (err) {
        console.error('API getCertificateByCode error:', err);
        return null;
    }
}

async function apiUpdateCertificateStatus(id, status, reason) {
    try {
        const response = await fetch(`${API_BASE}/certificates/${id}/status`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify({ status, reason })
        });
        if (handleAuthError(response)) return { success: false };
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
        const response = await fetch(`${API_BASE}/certificates/${id}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });
        if (handleAuthError(response)) return { success: false };
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
        const response = await fetch(`${API_BASE}/certificates/${id}`, {
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
        const response = await fetch(`${API_BASE}/kleshnya/greeting?date=${date}`, { headers: getAuthHeaders(false) });
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
        const response = await fetch(`${API_BASE}/kleshnya/chat`, { headers: getAuthHeaders(false) });
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
        const response = await fetch(`${API_BASE}/kleshnya/chat`, {
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
        const response = await fetch(`${API_BASE}/kleshnya/sessions`, { headers: getAuthHeaders(false) });
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
        const response = await fetch(`${API_BASE}/kleshnya/sessions`, {
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
        const response = await fetch(`${API_BASE}/kleshnya/sessions/${id}`, {
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
        const response = await fetch(`${API_BASE}/kleshnya/sessions/${id}`, {
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
        const response = await fetch(url, { headers: getAuthHeaders(false) });
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
        const response = await fetch(`${API_BASE}/kleshnya/messages/${messageId}/reaction`, {
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
        const response = await fetch(url, { headers: getAuthHeaders(false) });
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
        const response = await fetch(`${API_BASE}/warehouse${qs ? '?' + qs : ''}`, { headers: getAuthHeaders(false) });
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
        const response = await fetch(`${API_BASE}/warehouse/locations-summary`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return { success: false, locations: [] };
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getWarehouseLocationsSummary error:', err);
        return { success: false, locations: [] };
    }
}

async function apiCreateWarehouseLocation(location) {
    try {
        const response = await fetch(`${API_BASE}/warehouse/locations`, {
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
        const response = await fetch(`${API_BASE}/warehouse/locations/${id}`, {
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
        const response = await fetch(`${API_BASE}/warehouse/locations/${id}`, {
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
        const response = await fetch(`${API_BASE}/warehouse`, {
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
        const response = await fetch(`${API_BASE}/warehouse/${id}`, {
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
        const response = await fetch(`${API_BASE}/warehouse/${id}`, {
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
        const response = await fetch(`${API_BASE}/warehouse/${id}/use`, {
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
        const response = await fetch(`${API_BASE}/warehouse/${id}/restock`, {
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
        const response = await fetch(`${API_BASE}/warehouse/stock/${id}/transfer`, {
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
        const response = await fetch(`${API_BASE}/warehouse/stock/${id}/movements`, { headers: getAuthHeaders(false) });
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
        const response = await fetch(`${API_BASE}/warehouse/history${qs ? '?' + qs : ''}`, { headers: getAuthHeaders(false) });
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
        const response = await fetch(`${API_BASE}/warehouse/photo-intake/status`, { headers: getAuthHeaders(false) });
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
        const response = await fetch(`${API_BASE}/warehouse/photo-intake${qs ? '?' + qs : ''}`, { headers: getAuthHeaders(false) });
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
        const response = await fetch(`${API_BASE}/warehouse/photo-intake/${id}/confirm`, {
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
        const response = await fetch(`${API_BASE}/warehouse/photo-intake/${id}/cancel`, {
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
        const response = await fetch(`${API_BASE}/contractors${qs ? '?' + qs : ''}`, { headers: getAuthHeaders(false) });
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
        const response = await fetch(`${API_BASE}/contractors`, {
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
        const response = await fetch(`${API_BASE}/contractors/${id}`, {
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
        const response = await fetch(`${API_BASE}/contractors/${id}/order-context?${params}`, { headers: getAuthHeaders(false) });
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
        const response = await fetch(`${API_BASE}/procurement?${params}`, { headers: getAuthHeaders(false) });
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
        const response = await fetch(`${API_BASE}/procurement/${id}`, { headers: getAuthHeaders(false) });
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
        const response = await fetch(`${API_BASE}/procurement`, {
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
        const response = await fetch(`${API_BASE}/procurement/${id}`, {
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
        const response = await fetch(`${API_BASE}/procurement/${id}`, {
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
        const response = await fetch(`${API_BASE}/procurement/${listId}/items`, {
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
        const response = await fetch(`${API_BASE}/procurement/${listId}/items/${itemId}`, {
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
        const response = await fetch(`${API_BASE}/procurement/${listId}/items/${itemId}`, {
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
        const response = await fetch(`${API_BASE}/procurement/${id}/complete`, {
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
        const response = await fetch(`${API_BASE}/procurement/suggestions/low-stock`, { headers: getAuthHeaders(false) });
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
        const response = await fetch(`${API_BASE}/procurement/suggestions/kitchen-demand`, { headers: getAuthHeaders(false) });
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
        const response = await fetch(`${API_BASE}/procurement/from-stock-item/${stockItemId}`, {
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
        const response = await fetch(`${API_BASE}/procurement/${listId}/items/${itemId}/receive`, {
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
        const response = await fetch(`${API_BASE}/finance/budget?year=${year}`, { headers: getAuthHeaders(false) });
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
        const response = await fetch(`${API_BASE}/finance/budget`, {
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
        const response = await fetch(`${API_BASE}/finance/budget/comparison?year=${year}&month=${month}`, { headers: getAuthHeaders(false) });
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
            : await fetch(url, { headers: getAuthHeaders(false) });
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
            : await fetch(url, { headers: getAuthHeaders(false) });
        if (!response || handleAuthError(response)) return null;
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getCustomer error:', err);
        return null;
    }
}

const {
    DEFAULT_BUSINESS_CONTEXT,
    businessContextCatalog,
    businessContextFromRequest,
    canAccessBusinessContext,
    normalizeKnownBusinessContext,
    normalizeBusinessContext
} = require('./businessContext');
const { resolveCapability } = require('./accountAccessPolicy');
const { userBusinessModuleState } = require('./businessModuleRegistry');

const DEFAULT_TIMELINE_CONTEXT = DEFAULT_BUSINESS_CONTEXT;
const VALID_TIMELINE_CONTEXTS = new Set(
    businessContextCatalog()
        .filter(context => Array.isArray(context.modules) && context.modules.includes('timeline'))
        .map(context => context.key)
);
const MAYSTERNYA_DOLI_PATH = '/maysternya-doli';
const CONTEXT_ACTION_ROLES = {
    maysternya_doli: {
        create: ['creator'],
        edit: ['creator'],
        delete: ['creator'],
        export: ['creator'],
        sales: [],
        settings: ['creator']
    }
};
const PRIVATE_TIMELINE_CONTEXTS = new Set(['maysternya_doli']);

function isKnownBusinessContextInput(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return false;
    return Boolean(normalizeKnownBusinessContext(raw) || /^[a-z][a-z0-9_]{2,63}$/.test(raw));
}

function isTimelineContext(value) {
    const raw = String(value || '').trim();
    if (!raw) return false;
    if (!isKnownBusinessContextInput(raw)) return false;
    const known = normalizeKnownBusinessContext(raw);
    return known ? VALID_TIMELINE_CONTEXTS.has(known) : true;
}

function normalizeTimelineContext(value) {
    const raw = String(value || '').trim();
    if (!raw) return DEFAULT_TIMELINE_CONTEXT;
    if (isKnownBusinessContextInput(raw)) return normalizeBusinessContext(raw);
    const error = new Error('Invalid timeline business context');
    error.statusCode = 400;
    throw error;
}

function rawTimelineContextFromRequest(req) {
    return (
        req?.body?.businessContext
        || req?.body?.business_context
        || req?.query?.businessContext
        || req?.query?.business_context
        || req?.headers?.['x-business-context']
    );
}

function timelineContextFromRequest(req) {
    const raw = rawTimelineContextFromRequest(req);
    if (!raw) return businessContextFromRequest(req);
    return isKnownBusinessContextInput(raw)
        ? normalizeBusinessContext(raw)
        : String(raw).trim().toLowerCase();
}

function userRoles(user) {
    const roles = [];
    if (user?.role) roles.push(user.role);
    if (Array.isArray(user?.roles)) roles.push(...user.roles);
    if (Array.isArray(user?.extraRoles)) roles.push(...user.extraRoles);
    if (Array.isArray(user?.extra_roles)) roles.push(...user.extra_roles);
    return Array.from(new Set(roles.filter(Boolean).map(String)));
}

function userPageAllowlist(user) {
    const values = [];
    if (Array.isArray(user?.pageAllowlist)) values.push(...user.pageAllowlist);
    if (Array.isArray(user?.page_allowlist)) values.push(...user.page_allowlist);
    return Array.from(new Set(values.filter(Boolean).map(String)));
}

function canAccessTimelineContext(user, context) {
    if (!user) return false;
    const normalized = context ? normalizeBusinessContext(context) : DEFAULT_TIMELINE_CONTEXT;
    if (context && !isKnownBusinessContextInput(context)) return false;
    if (!userBusinessModuleState(user, normalized, 'timeline').available) return false;
    if (!canAccessBusinessContext(user, normalized)) return false;
    if (!PRIVATE_TIMELINE_CONTEXTS.has(normalized)) return true;
    return userRoles(user).includes('creator');
}

function canUseTimelineAction(user, context, action) {
    const normalized = context ? normalizeBusinessContext(context) : DEFAULT_TIMELINE_CONTEXT;
    if (!canAccessTimelineContext(user, normalized)) return false;
    if (action === 'settings' && !resolveCapability(user, 'manage_settings', { type: 'action' }).allowed) return false;
    const allowed = CONTEXT_ACTION_ROLES[normalized]?.[action];
    if (!Array.isArray(allowed)) return true;
    if (!allowed.length) return false;
    const roles = userRoles(user);
    return roles.includes('creator') || roles.some(role => allowed.includes(role));
}

function requireTimelineContext(req, res, context) {
    if (canAccessTimelineContext(req.user, context)) return true;
    res.status(403).json({ success: false, error: 'Timeline context is not available for this user' });
    return false;
}

function requireTimelineAction(req, res, context, action) {
    if (canUseTimelineAction(req.user, context, action)) return true;
    res.status(403).json({ success: false, error: 'Timeline action is not available for this user' });
    return false;
}

module.exports = {
    VALID_TIMELINE_CONTEXTS,
    DEFAULT_TIMELINE_CONTEXT,
    MAYSTERNYA_DOLI_PATH,
    isTimelineContext,
    normalizeTimelineContext,
    timelineContextFromRequest,
    canAccessTimelineContext,
    canUseTimelineAction,
    requireTimelineContext,
    requireTimelineAction
};

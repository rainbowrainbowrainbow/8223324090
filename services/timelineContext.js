const VALID_TIMELINE_CONTEXTS = new Set(['event_genix', 'maysternya_doli']);
const DEFAULT_TIMELINE_CONTEXT = 'event_genix';
const MAYSTERNYA_DOLI_PATH = '/maysternya-doli';
const CONTEXT_ACTION_ROLES = {
    maysternya_doli: {
        create: ['creator', 'director'],
        edit: ['creator', 'director'],
        delete: ['creator'],
        export: ['creator', 'director'],
        sales: [],
        settings: ['creator', 'director']
    }
};

function normalizeTimelineContext(value) {
    const raw = String(value || '').trim().toLowerCase();
    return VALID_TIMELINE_CONTEXTS.has(raw) ? raw : DEFAULT_TIMELINE_CONTEXT;
}

function timelineContextFromRequest(req) {
    return normalizeTimelineContext(
        req?.body?.businessContext
        || req?.body?.business_context
        || req?.query?.businessContext
        || req?.query?.business_context
        || req?.headers?.['x-business-context']
    );
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
    const normalized = normalizeTimelineContext(context);
    if (normalized === DEFAULT_TIMELINE_CONTEXT) return Boolean(user);
    if (!user) return false;
    if (userRoles(user).includes('creator')) return true;
    return userPageAllowlist(user).includes(MAYSTERNYA_DOLI_PATH);
}

function canUseTimelineAction(user, context, action) {
    const normalized = normalizeTimelineContext(context);
    if (!canAccessTimelineContext(user, normalized)) return false;
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
    normalizeTimelineContext,
    timelineContextFromRequest,
    canAccessTimelineContext,
    canUseTimelineAction,
    requireTimelineContext,
    requireTimelineAction
};

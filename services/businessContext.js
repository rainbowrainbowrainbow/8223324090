'use strict';

const DEFAULT_BUSINESS_CONTEXT = 'event_genix';
const BUSINESS_CONTEXTS = Object.freeze({
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
const BUSINESS_CONTEXT_ALIASES = Object.freeze({
  park_zakrevsky: DEFAULT_BUSINESS_CONTEXT,
  park: DEFAULT_BUSINESS_CONTEXT,
  pzp: DEFAULT_BUSINESS_CONTEXT,
  maysternya: 'maysternya_doli',
  md: 'maysternya_doli',
  crm_sales: 'crm',
  sales_crm: 'crm',
  'срм': 'crm'
});
const BUSINESS_CONTEXT_SWITCH_ROLES = Object.freeze([
  'creator',
  'director',
  'vice_director',
  'senior_manager'
]);

function normalizeBusinessContext(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (BUSINESS_CONTEXT_ALIASES[raw]) return BUSINESS_CONTEXT_ALIASES[raw];
  return BUSINESS_CONTEXTS[raw] ? raw : DEFAULT_BUSINESS_CONTEXT;
}

function businessContextFromRequest(req) {
  return normalizeBusinessContext(
    req?.body?.businessContext
    || req?.body?.business_context
    || req?.query?.businessContext
    || req?.query?.business_context
    || req?.headers?.['x-business-context']
  );
}

function roleList(user) {
  const roles = [];
  if (user?.role) roles.push(user.role);
  if (Array.isArray(user?.roles)) roles.push(...user.roles);
  if (Array.isArray(user?.extraRoles)) roles.push(...user.extraRoles);
  if (Array.isArray(user?.extra_roles)) roles.push(...user.extra_roles);
  return Array.from(new Set(roles.filter(Boolean).map(String)));
}

function pageAllowlist(user) {
  const values = [];
  if (Array.isArray(user?.pageAllowlist)) values.push(...user.pageAllowlist);
  if (Array.isArray(user?.page_allowlist)) values.push(...user.page_allowlist);
  return Array.from(new Set(values.filter(Boolean).map(String)));
}

function rawBusinessContextList(user) {
  const values = [];
  if (Array.isArray(user?.business_contexts)) values.push(...user.business_contexts);
  if (Array.isArray(user?.businessContexts)) values.push(...user.businessContexts);
  if (Array.isArray(user?.allowedBusinessContexts)) values.push(...user.allowedBusinessContexts);
  return values;
}

function normalizeBusinessContextList(value, fallback = [DEFAULT_BUSINESS_CONTEXT]) {
  const source = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.split(/[,;\s]+/) : []);
  const seen = new Set();
  const normalized = [];
  source.forEach(item => {
    const key = normalizeBusinessContext(item);
    if (!BUSINESS_CONTEXTS[key] || seen.has(key)) return;
    seen.add(key);
    normalized.push(key);
  });
  if (normalized.length) return normalized;
  return fallback ? normalizeBusinessContextList(fallback, null) : [];
}

function isBusinessContextSwitchRole(user) {
  const roles = roleList(user);
  return BUSINESS_CONTEXT_SWITCH_ROLES.some(role => roles.includes(role));
}

function explicitForcedBusinessContext(user) {
  return user?.forcedBusinessContext
    || user?.forced_business_context
    || user?.businessContext
    || user?.business_context
    || user?.tenantBusinessContext
    || user?.tenant_business_context
    || null;
}

function allowedBusinessContextsForUser(user) {
  if (!user) return [];
  const assigned = normalizeBusinessContextList(rawBusinessContextList(user), []);
  if (assigned.length) return assigned;
  if (isBusinessContextSwitchRole(user)) return Object.keys(BUSINESS_CONTEXTS);
  const allowed = new Set([DEFAULT_BUSINESS_CONTEXT]);
  const allowlist = pageAllowlist(user);
  Object.values(BUSINESS_CONTEXTS).forEach(ctx => {
    if (ctx.pageAllowlist && allowlist.includes(ctx.pageAllowlist)) allowed.add(ctx.key);
  });
  return Array.from(allowed);
}

function resolveForcedBusinessContext(user) {
  if (!user) return null;
  const allowed = allowedBusinessContextsForUser(user);
  const explicit = explicitForcedBusinessContext(user);
  if (explicit) return normalizeBusinessContext(explicit);
  const nonDefault = allowed.filter(ctx => ctx !== DEFAULT_BUSINESS_CONTEXT);
  return nonDefault.length === 1 ? nonDefault[0] : DEFAULT_BUSINESS_CONTEXT;
}

function resolveBusinessContextPolicy(user) {
  const allowed = allowedBusinessContextsForUser(user);
  const assigned = normalizeBusinessContextList(rawBusinessContextList(user), []);
  const canSwitch = Boolean(user && allowed.length > 1 && (isBusinessContextSwitchRole(user) || assigned.length > 1));
  const forced = canSwitch ? null : resolveForcedBusinessContext(user);
  return {
    canSwitch,
    forced,
    allowed: canSwitch ? allowed : [forced || DEFAULT_BUSINESS_CONTEXT],
    defaultContext: forced || DEFAULT_BUSINESS_CONTEXT
  };
}

function canAccessBusinessContext(user, context) {
  if (!user) return false;
  const normalized = normalizeBusinessContext(context);
  const policy = resolveBusinessContextPolicy(user);
  if (policy.canSwitch) return policy.allowed.includes(normalized);
  if (policy.forced) return normalized === policy.forced;
  return policy.allowed.includes(normalized);
}

function requireBusinessContext(req, res, context) {
  if (canAccessBusinessContext(req.user, context)) return true;
  res.status(403).json({ success: false, error: 'Business context is not available for this user' });
  return false;
}

function pushBusinessContextCondition(params, context, alias = '') {
  params.push(normalizeBusinessContext(context));
  const column = alias ? `${alias}.business_context` : 'business_context';
  return `COALESCE(${column}, '${DEFAULT_BUSINESS_CONTEXT}') = $${params.length}`;
}

function withBusinessContext(payload, context) {
  return {
    ...(payload || {}),
    business_context: normalizeBusinessContext(context)
  };
}

function businessContextCatalog() {
  return Object.values(BUSINESS_CONTEXTS).map(ctx => ({
    key: ctx.key,
    label: ctx.label,
    shortLabel: ctx.shortLabel || ctx.label,
    pageAllowlist: ctx.pageAllowlist || null,
    modules: Array.isArray(ctx.modules) ? [...ctx.modules] : []
  }));
}

function businessModulesForContext(context) {
  const ctx = BUSINESS_CONTEXTS[normalizeBusinessContext(context)] || BUSINESS_CONTEXTS[DEFAULT_BUSINESS_CONTEXT];
  return Array.isArray(ctx.modules) ? [...ctx.modules] : [];
}

function businessContextHasModule(context, moduleId) {
  if (!moduleId) return true;
  return businessModulesForContext(context).includes(String(moduleId));
}

module.exports = {
  BUSINESS_CONTEXTS,
  BUSINESS_CONTEXT_SWITCH_ROLES,
  DEFAULT_BUSINESS_CONTEXT,
  normalizeBusinessContext,
  normalizeBusinessContextList,
  businessContextCatalog,
  businessModulesForContext,
  businessContextHasModule,
  businessContextFromRequest,
  allowedBusinessContextsForUser,
  canAccessBusinessContext,
  resolveBusinessContextPolicy,
  requireBusinessContext,
  pushBusinessContextCondition,
  withBusinessContext
};

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
  'director'
]);
const BUSINESS_SCOPE_SINGLE = 'single';
const BUSINESS_SCOPE_MULTI = 'multi';
const BUSINESS_SCOPE_ALL = 'all';
const BUSINESS_SCOPE_MODES = Object.freeze([
  BUSINESS_SCOPE_SINGLE,
  BUSINESS_SCOPE_MULTI,
  BUSINESS_SCOPE_ALL
]);
const BUSINESS_SCOPE_READ_ONLY = Object.freeze([
  BUSINESS_SCOPE_MULTI,
  BUSINESS_SCOPE_ALL
]);

function normalizeBusinessContext(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (BUSINESS_CONTEXT_ALIASES[raw]) return BUSINESS_CONTEXT_ALIASES[raw];
  return BUSINESS_CONTEXTS[raw] ? raw : DEFAULT_BUSINESS_CONTEXT;
}

function normalizeKnownBusinessContext(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  if (BUSINESS_CONTEXT_ALIASES[raw]) return BUSINESS_CONTEXT_ALIASES[raw];
  return BUSINESS_CONTEXTS[raw] ? raw : null;
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

function parseBusinessContextListInput(value) {
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

function normalizeBusinessScopeMode(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (raw === 'all' || raw === 'all-business' || raw === 'overview') return BUSINESS_SCOPE_ALL;
  if (raw === 'multi' || raw === 'many' || raw === 'selected' || raw === 'several') return BUSINESS_SCOPE_MULTI;
  return BUSINESS_SCOPE_SINGLE;
}

function businessScopeModeFromRequest(req) {
  const explicit = req?.body?.businessScope
    || req?.body?.business_scope
    || req?.query?.businessScope
    || req?.query?.business_scope
    || req?.headers?.['x-business-scope'];
  const context = req?.body?.businessContext
    || req?.body?.business_context
    || req?.query?.businessContext
    || req?.query?.business_context
    || req?.headers?.['x-business-context'];
  return normalizeBusinessScopeMode(explicit || context);
}

function businessScopeContextsFromRequest(req) {
  const raw = req?.body?.businessContexts
    || req?.body?.business_contexts
    || req?.query?.businessContexts
    || req?.query?.business_contexts
    || req?.headers?.['x-business-contexts'];
  return normalizeBusinessContextList(parseBusinessContextListInput(raw), []);
}

function businessContextWasRequested(req) {
  return Boolean(
    req?.body?.businessContext
    || req?.body?.business_context
    || req?.query?.businessContext
    || req?.query?.business_context
    || req?.headers?.['x-business-context']
  );
}

function isBusinessContextSwitchRole(user) {
  return roleList(user).some(role => BUSINESS_CONTEXT_SWITCH_ROLES.includes(role));
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

function explicitDefaultBusinessContext(user) {
  return user?.defaultBusinessContext
    || user?.default_business_context
    || user?.preferredBusinessContext
    || user?.preferred_business_context
    || null;
}

function allowedBusinessContextsForUser(user) {
  if (!user) return [];
  if (!isBusinessContextSwitchRole(user)) return [DEFAULT_BUSINESS_CONTEXT];
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

function resolveDefaultBusinessContext(user, allowed = allowedBusinessContextsForUser(user)) {
  const normalizedAllowed = normalizeBusinessContextList(allowed, [DEFAULT_BUSINESS_CONTEXT]);
  const explicitDefault = explicitDefaultBusinessContext(user);
  if (explicitDefault) {
    const key = normalizeBusinessContext(explicitDefault);
    if (normalizedAllowed.includes(key)) return key;
  }
  const explicitForced = explicitForcedBusinessContext(user);
  if (explicitForced) {
    const key = normalizeBusinessContext(explicitForced);
    if (normalizedAllowed.includes(key)) return key;
  }
  const nonDefault = normalizedAllowed.filter(ctx => ctx !== DEFAULT_BUSINESS_CONTEXT);
  if (nonDefault.length === 1) return nonDefault[0];
  return normalizedAllowed.includes(DEFAULT_BUSINESS_CONTEXT)
    ? DEFAULT_BUSINESS_CONTEXT
    : (normalizedAllowed[0] || DEFAULT_BUSINESS_CONTEXT);
}

function resolveForcedBusinessContext(user) {
  if (!user) return null;
  if (!isBusinessContextSwitchRole(user)) return DEFAULT_BUSINESS_CONTEXT;
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
  const defaultContext = resolveDefaultBusinessContext(user, allowed);
  return {
    canSwitch,
    forced,
    allowed: canSwitch ? allowed : [forced || defaultContext || DEFAULT_BUSINESS_CONTEXT],
    defaultContext: forced || defaultContext || DEFAULT_BUSINESS_CONTEXT
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

function resolveBusinessScope(reqOrUser, maybeUser = null) {
  const req = reqOrUser && (
    reqOrUser.query
    || reqOrUser.body
    || reqOrUser.headers
    || reqOrUser.user
  ) ? reqOrUser : null;
  const user = maybeUser || req?.user || (req ? null : reqOrUser);
  const policy = resolveBusinessContextPolicy(user);
  const allowed = normalizeBusinessContextList(policy.allowed, [policy.defaultContext || DEFAULT_BUSINESS_CONTEXT]);
  const requestedMode = req ? businessScopeModeFromRequest(req) : BUSINESS_SCOPE_SINGLE;
  const requestedContexts = req ? businessScopeContextsFromRequest(req) : [];
  const requestedContext = req ? businessContextFromRequest(req) : (policy.defaultContext || DEFAULT_BUSINESS_CONTEXT);
  const explicitContext = req ? businessContextWasRequested(req) : false;
  const activeFallback = allowed.includes(policy.defaultContext)
    ? policy.defaultContext
    : (allowed[0] || DEFAULT_BUSINESS_CONTEXT);

  const base = {
    mode: BUSINESS_SCOPE_SINGLE,
    activeContext: allowed.includes(requestedContext) ? requestedContext : activeFallback,
    selectedContexts: [allowed.includes(requestedContext) ? requestedContext : activeFallback],
    allowedContexts: allowed,
    defaultContext: activeFallback,
    canSwitch: Boolean(policy.canSwitch),
    readOnly: false,
    canWrite: true,
    invalid: false,
    reason: null
  };

  if (!user) {
    return {
      ...base,
      invalid: true,
      reason: 'auth_required'
    };
  }

  if (requestedMode === BUSINESS_SCOPE_ALL) {
    if (!policy.canSwitch || allowed.length < 2) {
      return {
        ...base,
        invalid: true,
        reason: 'all_business_scope_unavailable'
      };
    }
    return {
      ...base,
      mode: BUSINESS_SCOPE_ALL,
      selectedContexts: allowed,
      activeContext: activeFallback,
      readOnly: true,
      canWrite: false
    };
  }

  if (requestedMode === BUSINESS_SCOPE_MULTI) {
    const selected = requestedContexts.filter(context => allowed.includes(context));
    const uniqueSelected = Array.from(new Set(selected));
    if (!policy.canSwitch || uniqueSelected.length < 2) {
      return {
        ...base,
        invalid: true,
        reason: 'multi_business_scope_unavailable'
      };
    }
    return {
      ...base,
      mode: BUSINESS_SCOPE_MULTI,
      selectedContexts: uniqueSelected,
      activeContext: uniqueSelected[0],
      readOnly: true,
      canWrite: false
    };
  }

  if (!canAccessBusinessContext(user, base.activeContext)) {
    return {
      ...base,
      invalid: true,
      reason: 'business_context_unavailable'
    };
  }

  if (explicitContext && !allowed.includes(requestedContext)) {
    return {
      ...base,
      activeContext: requestedContext,
      selectedContexts: [requestedContext],
      invalid: true,
      reason: 'business_context_unavailable'
    };
  }

  return base;
}

function isBusinessScopeReadOnly(scope) {
  return BUSINESS_SCOPE_READ_ONLY.includes(scope?.mode) || scope?.readOnly === true;
}

function requireBusinessScope(req, res, scope = resolveBusinessScope(req)) {
  if (!scope?.invalid) return true;
  res.status(403).json({
    success: false,
    error: 'Business scope is not available for this user',
    code: scope.reason || 'business_scope_unavailable'
  });
  return false;
}

function requireWritableBusinessScope(req, res, scope = resolveBusinessScope(req)) {
  if (!requireBusinessScope(req, res, scope)) return false;
  if (!isBusinessScopeReadOnly(scope)) return true;
  res.status(403).json({
    success: false,
    error: 'All-business and multi-business scopes are read-only. Select one active business before changing data.',
    code: 'business_scope_read_only'
  });
  return false;
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

function pushBusinessScopeCondition(params, scopeOrContext, alias = '') {
  const scope = scopeOrContext && typeof scopeOrContext === 'object' && !Array.isArray(scopeOrContext)
    ? scopeOrContext
    : { mode: BUSINESS_SCOPE_SINGLE, selectedContexts: [normalizeBusinessContext(scopeOrContext)] };
  const column = alias ? `${alias}.business_context` : 'business_context';
  const selected = normalizeBusinessContextList(
    scope.selectedContexts?.length ? scope.selectedContexts : [scope.activeContext || DEFAULT_BUSINESS_CONTEXT],
    [DEFAULT_BUSINESS_CONTEXT]
  );
  if (scope.mode === BUSINESS_SCOPE_MULTI || scope.mode === BUSINESS_SCOPE_ALL) {
    params.push(selected);
    return `COALESCE(${column}, '${DEFAULT_BUSINESS_CONTEXT}') = ANY($${params.length}::text[])`;
  }
  params.push(selected[0] || DEFAULT_BUSINESS_CONTEXT);
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
  BUSINESS_SCOPE_ALL,
  BUSINESS_SCOPE_MODES,
  BUSINESS_SCOPE_MULTI,
  BUSINESS_SCOPE_SINGLE,
  DEFAULT_BUSINESS_CONTEXT,
  normalizeKnownBusinessContext,
  normalizeBusinessContext,
  normalizeBusinessContextList,
  normalizeBusinessScopeMode,
  businessContextCatalog,
  businessModulesForContext,
  businessContextHasModule,
  businessContextFromRequest,
  businessScopeModeFromRequest,
  businessScopeContextsFromRequest,
  allowedBusinessContextsForUser,
  canAccessBusinessContext,
  resolveDefaultBusinessContext,
  resolveBusinessContextPolicy,
  resolveBusinessScope,
  requireBusinessContext,
  requireBusinessScope,
  requireWritableBusinessScope,
  pushBusinessContextCondition,
  pushBusinessScopeCondition,
  isBusinessScopeReadOnly,
  withBusinessContext
};

'use strict';

const DEFAULT_BUSINESS_CONTEXT = 'event_genix';
const BUSINESS_CONTEXTS = Object.freeze({
  event_genix: {
    key: 'event_genix',
    label: 'Event Genix',
    pageAllowlist: null
  },
  maysternya_doli: {
    key: 'maysternya_doli',
    label: 'Майстерня Долі',
    pageAllowlist: '/maysternya-doli'
  }
});

function normalizeBusinessContext(value) {
  const raw = String(value || '').trim().toLowerCase();
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

function canAccessBusinessContext(user, context) {
  const normalized = normalizeBusinessContext(context);
  if (normalized === DEFAULT_BUSINESS_CONTEXT) return Boolean(user);
  if (!user) return false;
  if (roleList(user).includes('creator')) return true;
  const ctx = BUSINESS_CONTEXTS[normalized];
  return Boolean(ctx?.pageAllowlist && pageAllowlist(user).includes(ctx.pageAllowlist));
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

module.exports = {
  BUSINESS_CONTEXTS,
  DEFAULT_BUSINESS_CONTEXT,
  normalizeBusinessContext,
  businessContextFromRequest,
  canAccessBusinessContext,
  requireBusinessContext,
  pushBusinessContextCondition,
  withBusinessContext
};

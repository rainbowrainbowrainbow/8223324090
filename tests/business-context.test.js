const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BUSINESS_CONTEXT_SWITCH_ROLES,
  businessContextCatalog,
  businessContextFromRequest,
  canAccessBusinessContext,
  normalizeBusinessContext,
  normalizeBusinessContextList,
  resolveBusinessContextPolicy
} = require('../services/businessContext');

test('business context normalizes legacy product aliases to the canonical CRM context', () => {
  assert.equal(normalizeBusinessContext('park_zakrevsky'), 'event_genix');
  assert.equal(normalizeBusinessContext('dar'), 'dar');
  assert.equal(normalizeBusinessContext('maysternya_doli'), 'maysternya_doli');
  assert.equal(normalizeBusinessContext('crm_sales'), 'crm');
  assert.equal(normalizeBusinessContext('unknown'), 'event_genix');
});

test('business context can be read from query, body, or header input', () => {
  assert.equal(businessContextFromRequest({ query: { businessContext: 'maysternya_doli' } }), 'maysternya_doli');
  assert.equal(businessContextFromRequest({ body: { business_context: 'park_zakrevsky' } }), 'event_genix');
  assert.equal(businessContextFromRequest({ headers: { 'x-business-context': 'dar' } }), 'dar');
});

test('switch policy is centralized for director-like roles', () => {
  assert.ok(BUSINESS_CONTEXT_SWITCH_ROLES.includes('creator'));
  assert.ok(BUSINESS_CONTEXT_SWITCH_ROLES.includes('director'));
  const policy = resolveBusinessContextPolicy({ role: 'director' });
  assert.equal(policy.canSwitch, true);
  assert.deepEqual(policy.allowed.sort(), ['crm', 'dar', 'event_genix', 'maysternya_doli'].sort());
  assert.equal(canAccessBusinessContext({ role: 'director' }, 'maysternya_doli'), true);
});

test('account business_contexts limit switchers to assigned businesses', () => {
  const policy = resolveBusinessContextPolicy({ role: 'manager', business_contexts: ['event_genix', 'dar'] });
  assert.equal(policy.canSwitch, true);
  assert.deepEqual(policy.allowed, ['event_genix', 'dar']);
  assert.equal(canAccessBusinessContext({ role: 'manager', business_contexts: ['event_genix', 'dar'] }, 'dar'), true);
  assert.equal(canAccessBusinessContext({ role: 'manager', business_contexts: ['event_genix', 'dar'] }, 'crm'), false);
});

test('default_business_context chooses the initial switcher value without narrowing access', () => {
  const user = {
    role: 'manager',
    business_contexts: ['event_genix', 'maysternya_doli'],
    default_business_context: 'maysternya_doli'
  };
  const policy = resolveBusinessContextPolicy(user);
  assert.equal(policy.canSwitch, true);
  assert.deepEqual(policy.allowed, ['event_genix', 'maysternya_doli']);
  assert.equal(policy.defaultContext, 'maysternya_doli');
  assert.equal(canAccessBusinessContext(user, 'event_genix'), true);
  assert.equal(canAccessBusinessContext(user, 'maysternya_doli'), true);
});

test('locked roles are forced to explicit or allowlisted business context', () => {
  const forced = resolveBusinessContextPolicy({ role: 'manager', forcedBusinessContext: 'maysternya_doli' });
  assert.equal(forced.canSwitch, false);
  assert.equal(forced.defaultContext, 'maysternya_doli');
  assert.deepEqual(forced.allowed, ['maysternya_doli']);
  assert.equal(canAccessBusinessContext({ role: 'manager', forcedBusinessContext: 'maysternya_doli' }, 'maysternya_doli'), true);
  assert.equal(canAccessBusinessContext({ role: 'manager', forcedBusinessContext: 'maysternya_doli' }, 'event_genix'), false);

  const allowlisted = resolveBusinessContextPolicy({ role: 'manager', pageAllowlist: ['/maysternya-doli'] });
  assert.equal(allowlisted.defaultContext, 'maysternya_doli');
  assert.deepEqual(allowlisted.allowed, ['maysternya_doli']);
});

test('ordinary locked roles stay in the default business context', () => {
  const policy = resolveBusinessContextPolicy({ role: 'manager' });
  assert.equal(policy.canSwitch, false);
  assert.equal(policy.defaultContext, 'event_genix');
  assert.deepEqual(policy.allowed, ['event_genix']);
  assert.equal(canAccessBusinessContext({ role: 'manager' }, 'maysternya_doli'), false);
});

test('business catalog exposes all four operator contexts and module boundaries', () => {
  const catalog = businessContextCatalog();
  assert.deepEqual(catalog.map(item => item.key).sort(), ['crm', 'dar', 'event_genix', 'maysternya_doli'].sort());
  assert.equal(catalog.find(item => item.key === 'crm').modules.includes('leads'), true);
  assert.equal(catalog.find(item => item.key === 'crm').modules.includes('warehouse'), false);
  assert.equal(catalog.find(item => item.key === 'maysternya_doli').modules.includes('omni'), true);
  assert.deepEqual(normalizeBusinessContextList(['park', 'dar', 'дар', 'crm']), ['event_genix', 'dar', 'crm']);
});

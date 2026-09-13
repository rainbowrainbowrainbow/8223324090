'use strict';

const {
  businessContextCatalog,
  businessModulesForContext,
  normalizeBusinessContext,
  resolveBusinessContextPolicy,
  resolveBusinessScope,
} = require('./businessContext');
const { getBusinessCabinetSettings, businessCabinetForUser } = require('./businessCabinet');
const { getOmniAccountStatusesAsync } = require('./omni-accounts');
const { authAccessContext } = require('./authBusinessProfile');
const { businessModuleCatalog, configuredBusinessModuleEnabled } = require('./businessModuleRegistry');

const START_PAGE_PATHS = Object.freeze({
  dashboard: '/dashboard',
  leads: '/sales-funnel',
  customers: '/customers',
  omni: '/omni',
  tasks: '/tasks',
});

const TIMELINE_CONTEXT_ROUTES = Object.freeze({
  event_genix: '/',
  dar: '/?businessContext=dar',
  maysternya_doli: '/maysternya-doli',
});

const TIMELINE_MODULE_TO_BUSINESS_MODULE = Object.freeze({
  timeline: 'timeline',
  leads: 'leads',
  customers: 'customers',
  omni: 'omni',
  tasks: 'tasks',
  products: 'programs',
  afisha: 'afisha',
  kitchen: 'kitchen',
});

function timelineRouteForContext(context) {
  const key = normalizeBusinessContext(context);
  return TIMELINE_CONTEXT_ROUTES[key] || `/?businessContext=${encodeURIComponent(key)}`;
}

function startPagePathForBusiness(context, timelineDisplay = {}, cabinet = null) {
  const startPage = timelineDisplay.timelineEnabled === false || timelineDisplay.mode === 'disabled'
    ? 'dashboard'
    : String(cabinet?.startPage || timelineDisplay.startPage || 'timeline');
  if (startPage === 'timeline') return timelineRouteForContext(context);
  return START_PAGE_PATHS[startPage] || timelineRouteForContext(context);
}

function businessTypeForTimelineDisplay(timelineDisplay = {}) {
  if (timelineDisplay.timelineEnabled === false || timelineDisplay.mode === 'disabled') return 'no_timeline';
  if (timelineDisplay.mode === 'park') return 'children_entertainment_park';
  if (timelineDisplay.mode === 'education') return 'education';
  if (timelineDisplay.mode === 'specialist') return 'specialist';
  if (timelineDisplay.mode === 'simple') return 'simple';
  return 'custom';
}

function moduleEnabledByTimelineCabinet(moduleId, timelineDisplay = {}) {
  const enabledModules = timelineDisplay.enabledModules || {};
  const entries = Object.entries(TIMELINE_MODULE_TO_BUSINESS_MODULE)
    .filter(([, businessModule]) => businessModule === moduleId)
    .map(([timelineModule]) => timelineModule);
  if (!entries.length) return null;
  return entries.some(timelineModule => enabledModules[timelineModule] !== false);
}

function buildModuleMap(context, timelineDisplay = {}, cabinet = null, configuredModules = null, membershipMode = false) {
  const baseModules = Array.isArray(configuredModules)
    ? configuredModules
    : businessModulesForContext(context);
  if (membershipMode) {
    // Membership modules have one authoritative configuration. Historical
    // cabinet defaults cannot silently re-enable an empty or disabled registry.
    const descriptors = businessModuleCatalog(context);
    const catalog = [...new Set([...descriptors.map(module => module.key), ...baseModules])];
    const enabled = Object.fromEntries(catalog.map(moduleId => [moduleId,
      configuredBusinessModuleEnabled({ contextKey: context, modules: configuredModules }, moduleId)]));
    return { source: 'business_registry', catalog, descriptors, enabled,
      enabledIds: catalog.filter(key => enabled[key]), disabledIds: catalog.filter(key => !enabled[key]) };
  }
  const enabled = {};
  baseModules.forEach(moduleId => { enabled[moduleId] = true; });

  Object.values(TIMELINE_MODULE_TO_BUSINESS_MODULE).forEach(moduleId => {
    if (!baseModules.includes(moduleId)) return;
    const cabinetValue = moduleEnabledByTimelineCabinet(moduleId, timelineDisplay);
    if (cabinetValue !== null) enabled[moduleId] = Boolean(cabinetValue);
  });

  if (timelineDisplay.timelineEnabled === false || timelineDisplay.mode === 'disabled') {
    if (baseModules.includes('timeline')) enabled.timeline = false;
  }

  if (timelineDisplay.mode === 'park' && timelineDisplay.parkKitchenMode === 'without_kitchen') {
    if (baseModules.includes('kitchen')) enabled.kitchen = false;
  }

  if (cabinet?.modules?.enabled) {
    baseModules.forEach(moduleId => {
      if (Object.prototype.hasOwnProperty.call(cabinet.modules.enabled, moduleId)) {
        enabled[moduleId] = cabinet.modules.enabled[moduleId] !== false;
      }
    });
  }

  if (baseModules.includes('dashboard')) enabled.dashboard = true;
  if (baseModules.includes('settings')) enabled.settings = true;

  const enabledIds = baseModules.filter(moduleId => enabled[moduleId] !== false);
  const disabledIds = baseModules.filter(moduleId => enabled[moduleId] === false);
  return {
    source: 'business_operating_profile',
    catalog: baseModules,
    enabled,
    enabledIds,
    disabledIds,
  };
}

async function summarizeOmniIntegrations(context, modules) {
  if (modules?.enabled?.omni !== true) {
    return {
      enabled: false,
      connectedChannels: [],
      sendCapableChannels: [],
      channels: [],
    };
  }

  try {
    const accounts = await getOmniAccountStatusesAsync({ businessContext: context });
    const channels = accounts.map(account => ({
      channel: account.channel,
      label: account.label,
      status: account.status,
      connected: account.connected === true,
      sendCapable: account.sendCapable === true,
      receiveCapable: account.receiveCapable === true,
    }));
    return {
      enabled: true,
      connectedChannels: channels.filter(channel => channel.connected).map(channel => channel.channel),
      sendCapableChannels: channels.filter(channel => channel.sendCapable).map(channel => channel.channel),
      channels,
    };
  } catch {
    return {
      enabled: true,
      connectedChannels: [],
      sendCapableChannels: [],
      channels: [],
      unavailable: true,
    };
  }
}

async function buildBusinessEntry(db, context, options = {}) {
  const key = normalizeBusinessContext(context);
  const membership = options.user?.businessMembershipAccess?.memberships?.find(item => item.businessContext === key) || null;
  const catalogEntry = membership
    ? { key, label: membership.businessLabel, shortLabel: membership.businessShortLabel, modules: membership.businessModules }
    : (businessContextCatalog().find(item => item.key === key) || { key, label: key, shortLabel: key });
  const cabinet = businessCabinetForUser(await getBusinessCabinetSettings(db, key), options.user);
  const membershipMode = membership?.accessMode === 'membership';
  const modules = buildModuleMap(key, cabinet.timeline, cabinet, catalogEntry.modules, membershipMode);
  const timelineDisplay = membershipMode && !modules.enabled.timeline
    ? { ...cabinet.timeline, timelineEnabled: false, mode: 'disabled', startPage: 'dashboard' }
    : cabinet.timeline;
  const effectiveCabinet = membershipMode ? { ...cabinet, modules, timeline: timelineDisplay } : cabinet;
  const preferredStart = timelineDisplay.timelineEnabled === false ? 'dashboard' : cabinet.startPage || timelineDisplay.startPage;
  const startPage = !membershipMode || modules.enabled[preferredStart] === true
    ? preferredStart
    : ['dashboard', 'timeline', 'tasks', 'customers', 'leads', 'omni'].find(moduleId => modules.enabled[moduleId]) || 'profile';
  const startPath = startPage === 'profile' ? '/profile' : startPage === 'timeline'
    ? timelineRouteForContext(key) : START_PAGE_PATHS[startPage] || '/profile';
  if (membershipMode) Object.assign(effectiveCabinet, { startPage, timelineEnabled: timelineDisplay.timelineEnabled,
    timelineMode: timelineDisplay.mode, timeline: { ...timelineDisplay, startPage } });
  const entry = {
    ...catalogEntry,
    id: key,
    businessId: membership?.businessId || null,
    organizationId: membership?.organizationId || null,
    accessMode: membership?.accessMode || 'compatibility',
    membership,
    businessContext: key,
    type: cabinet.businessType || businessTypeForTimelineDisplay(timelineDisplay),
    startPage,
    startPagePath: startPath,
    timelineRoute: timelineRouteForContext(key),
    timeline: timelineDisplay,
    cabinet: effectiveCabinet,
    modules,
    shell: {
      startPage,
      startPagePath: startPath,
      timelineEnabled: timelineDisplay.timelineEnabled !== false && timelineDisplay.mode !== 'disabled',
      timelineMode: timelineDisplay.mode,
      resourceModel: timelineDisplay.resourceModel,
      businessType: cabinet.businessType,
    },
  };

  if (options.includeIntegrations !== false) {
    entry.integrations = {
      omni: await summarizeOmniIntegrations(key, modules),
    };
  }

  return entry;
}

async function buildBusinessOperatingProfile(db, user, options = {}) {
  const policy = resolveBusinessContextPolicy(user);
  const scope = options.scope || resolveBusinessScope(user);
  const allowed = Array.isArray(policy.allowed) ? policy.allowed.filter(Boolean) : [];
  const businesses = [];

  for (const context of allowed) {
    businesses.push(await buildBusinessEntry(db, context, { ...options, user }));
  }

  const activeContext = scope.invalid ? null : scope.activeContext || policy.defaultContext || null;
  const activeProfile = businesses.find(item => item.key === activeContext) || null;
  const organizations = [];
  if (options.includeOrganizations === true) {
    const result = await db.query(
      `SELECT o.id, o.slug, o.name, o.status, om.role AS organization_role
       FROM organization_memberships om
       JOIN organizations o ON o.id = om.organization_id AND o.status = 'active'
       WHERE om.user_id = $1 AND om.is_active IS TRUE
       ORDER BY o.id`,
      [user.id]
    );
    result.rows.forEach(row => organizations.push({
      id: Number(row.id), slug: row.slug, name: row.name, status: row.status,
      role: row.organization_role,
      businessIds: businesses.filter(business => business.organizationId === Number(row.id)).map(business => business.businessId)
    }));
  }

  return {
    version: 1,
    source: 'server_business_profile',
    activeBusinessId: activeProfile?.key || null,
    activeBusinessContext: activeProfile?.key || null,
    activeProfile,
    activeMembership: scope.invalid ? null : user.businessMembershipAccess?.activeMembership || null,
    membershipConfigured: user.businessMembershipAccess?.configured === true,
    membershipMode: user.businessMembershipAccess?.membershipEnabled === true ? 'membership' : 'compatibility',
    accessContext: authAccessContext(scope),
    ...(options.includeOrganizations === true ? { organizations } : {}),
    businesses,
    allowedBusinessIds: allowed,
    defaultBusinessId: policy.defaultContext,
    canSwitchBusiness: policy.canSwitch === true,
    scope: {
      mode: scope?.mode || 'single',
      activeContext: activeProfile?.key || null,
      selectedContexts: scope.invalid ? [] : Array.isArray(scope?.selectedContexts) ? scope.selectedContexts : activeProfile ? [activeProfile.key] : [],
      allowedContexts: Array.isArray(scope?.allowedContexts) ? scope.allowedContexts : allowed,
      readOnly: scope.invalid || scope?.readOnly === true,
      canWrite: !scope.invalid && scope?.canWrite !== false,
      invalid: scope.invalid === true,
      reason: scope.reason || null,
    },
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  buildBusinessOperatingProfile,
  buildModuleMap,
  businessTypeForTimelineDisplay,
  startPagePathForBusiness,
  timelineRouteForContext,
};

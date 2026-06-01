'use strict';

const {
  businessContextCatalog,
  businessModulesForContext,
  normalizeBusinessContext,
  resolveBusinessContextPolicy,
  resolveBusinessScope,
} = require('./businessContext');
const { getBusinessCabinetSettings } = require('./businessCabinet');
const { getOmniAccountStatusesAsync } = require('./omni-accounts');

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
  return TIMELINE_CONTEXT_ROUTES[key] || '/dashboard';
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

function buildModuleMap(context, timelineDisplay = {}, cabinet = null) {
  const baseModules = businessModulesForContext(context);
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
  if (modules?.enabled?.omni === false) {
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
  const catalogEntry = businessContextCatalog().find(item => item.key === key) || { key, label: key, shortLabel: key };
  const cabinet = await getBusinessCabinetSettings(db, key);
  const timelineDisplay = cabinet.timeline;
  const modules = buildModuleMap(key, timelineDisplay, cabinet);
  const startPath = startPagePathForBusiness(key, timelineDisplay, cabinet);
  const entry = {
    ...catalogEntry,
    id: key,
    businessContext: key,
    type: cabinet.businessType || businessTypeForTimelineDisplay(timelineDisplay),
    startPage: timelineDisplay.timelineEnabled === false || timelineDisplay.mode === 'disabled'
      ? 'dashboard'
      : cabinet.startPage || timelineDisplay.startPage,
    startPagePath: startPath,
    timelineRoute: timelineRouteForContext(key),
    timeline: timelineDisplay,
    cabinet,
    modules,
    shell: {
      startPage: timelineDisplay.timelineEnabled === false || timelineDisplay.mode === 'disabled'
        ? 'dashboard'
        : cabinet.startPage || timelineDisplay.startPage,
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
  const allowed = Array.isArray(policy.allowed) && policy.allowed.length ? policy.allowed : [policy.defaultContext];
  const businesses = [];

  for (const context of allowed) {
    businesses.push(await buildBusinessEntry(db, context, options));
  }

  const activeContext = normalizeBusinessContext(
    scope?.activeContext || policy.defaultContext || businesses[0]?.key
  );
  const activeProfile = businesses.find(item => item.key === activeContext) || businesses[0] || null;

  return {
    version: 1,
    source: 'server_business_profile',
    activeBusinessId: activeProfile?.key || activeContext,
    activeBusinessContext: activeProfile?.key || activeContext,
    activeProfile,
    businesses,
    allowedBusinessIds: allowed,
    defaultBusinessId: policy.defaultContext,
    canSwitchBusiness: policy.canSwitch === true,
    scope: {
      mode: scope?.mode || 'single',
      activeContext: scope?.activeContext || activeProfile?.key || activeContext,
      selectedContexts: Array.isArray(scope?.selectedContexts) ? scope.selectedContexts : [activeProfile?.key || activeContext],
      allowedContexts: Array.isArray(scope?.allowedContexts) ? scope.allowedContexts : allowed,
      readOnly: scope?.readOnly === true,
      canWrite: scope?.canWrite !== false,
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

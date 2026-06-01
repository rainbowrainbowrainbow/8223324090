'use strict';

const { pool: defaultPool } = require('../db');
const {
  DEFAULT_BUSINESS_CONTEXT,
  businessContextCatalog,
  businessModulesForContext,
  normalizeBusinessContext,
} = require('./businessContext');
const {
  DEFAULT_TIMELINE_CONTEXT,
  isTimelineContext: isRegisteredTimelineContext,
} = require('./timelineContext');
const {
  TIMELINE_FEATURE_KEYS,
  TIMELINE_MODULE_KEYS,
  TIMELINE_POLICY_KEYS,
  defaultBookingPolicy,
  defaultTimelineFeatures,
  defaultTimelineModules,
  getTimelineDisplaySettings,
  normalizeTimelineDisplaySettings,
} = require('./timelineResources');

const BUSINESS_CABINET_VERSION = 1;
const BUSINESS_TYPE_ALIASES = Object.freeze({
  park: 'children_entertainment_park',
  children_park: 'children_entertainment_park',
  entertainment_park: 'children_entertainment_park',
  children_entertainment_park: 'children_entertainment_park',
  education: 'education',
  school: 'education',
  learning: 'education',
  specialist: 'specialist',
  simple: 'simple',
  disabled: 'no_timeline',
  no_timeline: 'no_timeline',
  custom: 'custom',
});
const BUSINESS_TYPES = new Set(Object.values(BUSINESS_TYPE_ALIASES));
const BUSINESS_START_PAGES = new Set(['timeline', 'dashboard', 'leads', 'customers', 'omni', 'tasks']);
const SAFE_ALWAYS_ON_MODULES = new Set(['dashboard', 'settings']);
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

function businessCabinetSettingsKey(context) {
  return `business_cabinet:${normalizeBusinessContext(context)}`;
}

function isTimelineContext(context) {
  return isRegisteredTimelineContext(context);
}

function defaultBusinessTypeForContext(context) {
  const key = normalizeBusinessContext(context);
  const modules = businessModulesForContext(key);
  if (!modules.includes('timeline')) return 'no_timeline';
  if (key === 'maysternya_doli') return 'simple';
  return 'children_entertainment_park';
}

function normalizeBusinessType(value, context, timelineDisplay = null) {
  const raw = String(value || '').trim().toLowerCase();
  const normalized = BUSINESS_TYPE_ALIASES[raw];
  if (normalized && BUSINESS_TYPES.has(normalized)) return normalized;
  if (timelineDisplay?.mode === 'disabled' || timelineDisplay?.timelineEnabled === false) return 'no_timeline';
  if (timelineDisplay?.mode === 'park') return 'children_entertainment_park';
  if (timelineDisplay?.mode === 'education') return 'education';
  if (timelineDisplay?.mode === 'specialist') return 'specialist';
  if (timelineDisplay?.mode === 'simple') return 'simple';
  return defaultBusinessTypeForContext(context);
}

function timelineModeForBusinessType(type, fallback = null) {
  const normalized = normalizeBusinessType(type, DEFAULT_BUSINESS_CONTEXT, fallback);
  if (normalized === 'no_timeline') return 'disabled';
  if (normalized === 'children_entertainment_park') return 'park';
  if (normalized === 'education') return 'education';
  if (normalized === 'specialist') return 'specialist';
  if (normalized === 'simple') return 'simple';
  return fallback?.mode || 'park';
}

function normalizeToggleRecord(value, defaults, allowedKeys) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const normalized = { ...defaults };
  allowedKeys.forEach(key => {
    if (Object.prototype.hasOwnProperty.call(source, key)) normalized[key] = Boolean(source[key]);
  });
  return normalized;
}

function defaultTimelineDisplayForBusiness(context) {
  const key = normalizeBusinessContext(context);
  const businessType = defaultBusinessTypeForContext(key);
  const mode = timelineModeForBusinessType(businessType);
  const parkKitchenMode = 'with_kitchen';
  const normalized = normalizeTimelineDisplaySettings({
    mode,
    timelineEnabled: mode !== 'disabled',
    parkKitchenMode,
    startPage: mode === 'disabled' ? 'dashboard' : 'timeline',
    enabledModules: defaultTimelineModules(mode, parkKitchenMode),
    timelineFeatures: defaultTimelineFeatures(mode, parkKitchenMode),
    bookingPolicy: defaultBookingPolicy(mode),
  }, isTimelineContext(key) ? key : DEFAULT_TIMELINE_CONTEXT);
  return { ...normalized, context: key };
}

function coerceTimelineDisplay(value = {}, context, fallbackTimeline = null) {
  const key = normalizeBusinessContext(context);
  const rawType = value.businessType || value.type;
  const fallback = fallbackTimeline || defaultTimelineDisplayForBusiness(key);
  const rawMode = value.mode || value.timelineMode || value.timeline?.mode || timelineModeForBusinessType(rawType, fallback);
  const mode = rawType && !value.mode && !value.timelineMode && !value.timeline?.mode
    ? timelineModeForBusinessType(rawType, fallback)
    : rawMode;
  const source = {
    ...fallback,
    ...(value.timeline && typeof value.timeline === 'object' ? value.timeline : {}),
    mode,
    timelineEnabled: value.timelineEnabled ?? value.timeline?.timelineEnabled ?? fallback.timelineEnabled,
    parkKitchenMode: value.parkKitchenMode || value.timeline?.parkKitchenMode || fallback.parkKitchenMode,
    startPage: value.startPage || value.timeline?.startPage || fallback.startPage,
    resourceModel: value.resourceModel || value.timeline?.resourceModel || fallback.resourceModel,
    enabledModules: value.enabledModules || value.timeline?.enabledModules || fallback.enabledModules,
    timelineFeatures: value.timelineFeatures || value.timeline?.timelineFeatures || fallback.timelineFeatures,
    bookingPolicy: value.bookingPolicy || value.timeline?.bookingPolicy || fallback.bookingPolicy,
  };
  const normalized = normalizeTimelineDisplaySettings(
    source,
    isTimelineContext(key) ? key : DEFAULT_TIMELINE_CONTEXT
  );
  return { ...normalized, context: key };
}

function moduleDefaultsFromTimeline(context, timelineDisplay = {}) {
  const baseModules = businessModulesForContext(context);
  const enabled = {};
  baseModules.forEach(moduleId => { enabled[moduleId] = true; });

  Object.entries(TIMELINE_MODULE_TO_BUSINESS_MODULE).forEach(([timelineModule, businessModule]) => {
    if (!baseModules.includes(businessModule)) return;
    if (Object.prototype.hasOwnProperty.call(timelineDisplay.enabledModules || {}, timelineModule)) {
      enabled[businessModule] = timelineDisplay.enabledModules[timelineModule] !== false;
    }
  });

  if (timelineDisplay.timelineEnabled === false || timelineDisplay.mode === 'disabled') {
    if (baseModules.includes('timeline')) enabled.timeline = false;
  }
  if (timelineDisplay.mode === 'park' && timelineDisplay.parkKitchenMode === 'without_kitchen') {
    if (baseModules.includes('kitchen')) enabled.kitchen = false;
  }
  SAFE_ALWAYS_ON_MODULES.forEach(moduleId => {
    if (baseModules.includes(moduleId)) enabled[moduleId] = true;
  });
  return enabled;
}

function normalizeBusinessModules(value, context, timelineDisplay = {}) {
  const key = normalizeBusinessContext(context);
  const catalog = businessModulesForContext(key);
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const rawEnabled = source.enabled || source.map || source;
  const enabled = moduleDefaultsFromTimeline(key, timelineDisplay);

  catalog.forEach(moduleId => {
    if (Object.prototype.hasOwnProperty.call(rawEnabled, moduleId)) {
      enabled[moduleId] = Boolean(rawEnabled[moduleId]);
    }
  });

  if (timelineDisplay.timelineEnabled === false || timelineDisplay.mode === 'disabled') {
    if (catalog.includes('timeline')) enabled.timeline = false;
  }
  if (timelineDisplay.mode === 'park' && timelineDisplay.parkKitchenMode === 'without_kitchen') {
    if (catalog.includes('kitchen')) enabled.kitchen = false;
  }
  SAFE_ALWAYS_ON_MODULES.forEach(moduleId => {
    if (catalog.includes(moduleId)) enabled[moduleId] = true;
  });

  const activeNonSafe = catalog.filter(moduleId => enabled[moduleId] !== false && !SAFE_ALWAYS_ON_MODULES.has(moduleId));
  if (!activeNonSafe.length) {
    if (catalog.includes('dashboard')) enabled.dashboard = true;
    if (catalog.includes('settings')) enabled.settings = true;
  }

  const enabledIds = catalog.filter(moduleId => enabled[moduleId] !== false);
  const disabledIds = catalog.filter(moduleId => enabled[moduleId] === false);
  return {
    source: 'business_cabinet',
    catalog,
    enabled,
    enabledIds,
    disabledIds,
  };
}

function normalizeBusinessCabinetSettings(value = {}, context = DEFAULT_BUSINESS_CONTEXT, options = {}) {
  const key = normalizeBusinessContext(context);
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const timeline = coerceTimelineDisplay(raw, key, options.fallbackTimeline);
  const businessType = normalizeBusinessType(raw.businessType || raw.type, key, timeline);
  const normalizedMode = timelineModeForBusinessType(businessType, timeline);
  const alignedTimeline = coerceTimelineDisplay({ ...timeline, mode: normalizedMode, timelineEnabled: normalizedMode !== 'disabled' }, key, timeline);
  const modules = normalizeBusinessModules(raw.modules || raw.businessModules || raw.moduleMap, key, alignedTimeline);
  const requestedStartPage = BUSINESS_START_PAGES.has(String(raw.startPage || alignedTimeline.startPage || '').trim())
    ? String(raw.startPage || alignedTimeline.startPage).trim()
    : (alignedTimeline.timelineEnabled === false ? 'dashboard' : 'timeline');
  let startPage = requestedStartPage;
  if (alignedTimeline.timelineEnabled === false && startPage === 'timeline') startPage = 'dashboard';
  if (modules.enabled[startPage] === false) startPage = 'dashboard';

  const guardrails = [];
  if (alignedTimeline.timelineEnabled === false && requestedStartPage === 'timeline') guardrails.push('timeline_start_requires_enabled_timeline');
  if (requestedStartPage !== startPage && modules.enabled[requestedStartPage] === false) guardrails.push(`${requestedStartPage}_start_requires_enabled_module`);
  if (alignedTimeline.mode !== 'park' && alignedTimeline.parkKitchenMode === 'without_kitchen') guardrails.push('kitchen_option_only_affects_park');

  return {
    version: BUSINESS_CABINET_VERSION,
    source: raw.source || options.source || 'business_cabinet',
    context: key,
    businessContext: key,
    businessType,
    timelineEnabled: alignedTimeline.timelineEnabled !== false,
    timelineMode: alignedTimeline.mode,
    parkKitchenMode: alignedTimeline.parkKitchenMode,
    startPage,
    resourceModel: alignedTimeline.resourceModel,
    modules,
    timeline: {
      ...alignedTimeline,
      startPage,
    },
    timelineFeatures: normalizeToggleRecord(
      raw.timelineFeatures || raw.timeline?.timelineFeatures || alignedTimeline.timelineFeatures,
      defaultTimelineFeatures(alignedTimeline.mode, alignedTimeline.parkKitchenMode),
      TIMELINE_FEATURE_KEYS
    ),
    bookingPolicy: normalizeToggleRecord(
      raw.bookingPolicy || raw.timeline?.bookingPolicy || alignedTimeline.bookingPolicy,
      defaultBookingPolicy(alignedTimeline.mode),
      TIMELINE_POLICY_KEYS
    ),
    timelineModuleKeys: [...TIMELINE_MODULE_KEYS],
    guardrails,
    updatedAt: raw.updatedAt || null,
    updatedBy: raw.updatedBy || null,
  };
}

async function readBusinessCabinetRaw(db, context) {
  const result = await db.query('SELECT value FROM settings WHERE key = $1', [businessCabinetSettingsKey(context)]);
  const raw = result.rows[0]?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function getBusinessCabinetSettings(db = defaultPool, context = DEFAULT_BUSINESS_CONTEXT) {
  const key = normalizeBusinessContext(context);
  const fallbackTimeline = isTimelineContext(key)
    ? await getTimelineDisplaySettings(db, key)
    : defaultTimelineDisplayForBusiness(key);
  const raw = await readBusinessCabinetRaw(db, key);
  if (raw) {
    return normalizeBusinessCabinetSettings(raw, key, {
      fallbackTimeline,
      source: 'business_cabinet',
    });
  }
  return normalizeBusinessCabinetSettings({}, key, {
    fallbackTimeline,
    source: isTimelineContext(key) ? 'timeline_display_fallback' : 'business_catalog_fallback',
  });
}

function timelineDisplayFromBusinessCabinet(cabinet) {
  const normalized = normalizeBusinessCabinetSettings(cabinet, cabinet?.businessContext || cabinet?.context || DEFAULT_BUSINESS_CONTEXT);
  return {
    ...normalized.timeline,
    enabledModules: normalized.timeline.enabledModules,
    timelineFeatures: normalized.timelineFeatures,
    bookingPolicy: normalized.bookingPolicy,
    startPage: normalized.startPage,
    context: normalized.context,
  };
}

async function saveBusinessCabinetSettings(db = defaultPool, context = DEFAULT_BUSINESS_CONTEXT, payload = {}, user = null) {
  const key = normalizeBusinessContext(context);
  const current = await getBusinessCabinetSettings(db, key);
  const cabinet = normalizeBusinessCabinetSettings({
    ...current,
    ...(payload || {}),
    updatedAt: new Date().toISOString(),
    updatedBy: user?.username || user?.id || null,
  }, key, {
    fallbackTimeline: current.timeline,
    source: 'business_cabinet',
  });
  const timeline = timelineDisplayFromBusinessCabinet(cabinet);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO settings (key, value)
       VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2`,
      [businessCabinetSettingsKey(key), JSON.stringify(cabinet)]
    );
    if (isTimelineContext(key)) {
      await client.query(
        `INSERT INTO settings (key, value)
         VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $2`,
        [`timeline_display:${key}`, JSON.stringify({
          ...timeline,
          updatedAt: cabinet.updatedAt,
          updatedBy: cabinet.updatedBy,
        })]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return cabinet;
}

function businessCabinetCatalog() {
  return businessContextCatalog().map(item => ({
    ...item,
    defaultBusinessType: defaultBusinessTypeForContext(item.key),
    supportsTimeline: businessModulesForContext(item.key).includes('timeline'),
  }));
}

module.exports = {
  BUSINESS_CABINET_VERSION,
  BUSINESS_START_PAGES,
  BUSINESS_TYPES,
  businessCabinetCatalog,
  businessCabinetSettingsKey,
  defaultBusinessTypeForContext,
  getBusinessCabinetSettings,
  isTimelineContext,
  normalizeBusinessCabinetSettings,
  normalizeBusinessModules,
  saveBusinessCabinetSettings,
  timelineDisplayFromBusinessCabinet,
  timelineModeForBusinessType,
};

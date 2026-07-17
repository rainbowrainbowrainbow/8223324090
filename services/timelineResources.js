'use strict';

const { pool: defaultPool } = require('../db');
const {
    DEFAULT_TIMELINE_CONTEXT,
    normalizeTimelineContext
} = require('./timelineContext');
const { timeToMinutes } = require('./booking');

const TIMELINE_DISPLAY_MODES = new Set(['disabled', 'simple', 'specialist', 'park', 'education']);
const TIMELINE_PARK_KITCHEN_MODES = new Set(['with_kitchen', 'without_kitchen']);
const TIMELINE_VIEW_MODES = new Set(['rooms', 'animators']);
const RESOURCE_TYPES = new Set(['animator', 'specialist', 'cabinet', 'room', 'online']);
const TIMELINE_START_PAGES = new Set(['timeline', 'dashboard', 'leads', 'customers', 'omni', 'tasks']);
const TIMELINE_RESOURCE_MODELS = new Set(['auto', 'none', 'animator', 'specialist', 'cabinet', 'room', 'online']);
const TIMELINE_MODULE_KEYS = Object.freeze([
    'timeline', 'bookings', 'leads', 'customers', 'omni', 'tasks', 'products',
    'afisha', 'kitchen', 'resources', 'teachers', 'lessonSeries'
]);
const TIMELINE_FEATURE_KEYS = Object.freeze([
    'quickCloseSlot', 'freeResources', 'series', 'afisha', 'kitchen',
    'compactBlocks', 'seriesBadge', 'teacherConflict', 'resourceCapacity'
]);
const TIMELINE_POLICY_KEYS = Object.freeze([
    'allowLessonsWithoutTeacher', 'allowLessonsWithoutGroup',
    'enforceTeacherConflict', 'enforceResourceCapacity',
    'notifyFirstOccurrenceOnly'
]);
const RESOURCE_TYPE_BY_DISPLAY_MODE = Object.freeze({
    disabled: null,
    simple: 'specialist',
    specialist: 'specialist',
    park: null,
    education: 'cabinet'
});
const RESOURCE_COLORS = ['#10B981', '#3B82F6', '#F97316', '#06B6D4', '#84CC16', '#EC4899', '#64748B', '#8B5CF6'];

function activeBookingStatusSql(alias = '') {
    const column = alias ? `${alias}.status` : 'status';
    return `LOWER(COALESCE(NULLIF(BTRIM(${column}), ''), 'confirmed')) != 'cancelled'`;
}

function defaultTimelineDisplayMode(context) {
    const key = normalizeTimelineContext(context);
    return key === 'maysternya_doli' || key === 'dar' ? 'simple' : 'park';
}

function timelineDisplaySettingsKey(context) {
    return `timeline_display:${normalizeTimelineContext(context)}`;
}

function normalizeTimelineDisplayMode(value, context) {
    const mode = String(value || '').trim();
    return TIMELINE_DISPLAY_MODES.has(mode) ? mode : defaultTimelineDisplayMode(context);
}

function normalizeParkKitchenMode(value) {
    const mode = String(value || '').trim();
    return TIMELINE_PARK_KITCHEN_MODES.has(mode) ? mode : 'with_kitchen';
}

function normalizeDefaultTimelineView(value, roomTimelineEnabled) {
    const view = String(value || '').trim().toLowerCase();
    if (roomTimelineEnabled && TIMELINE_VIEW_MODES.has(view)) return view;
    return 'animators';
}

function defaultTimelineViewForContext(context, mode, roomTimelineEnabled) {
    return mode === 'park' && roomTimelineEnabled && normalizeTimelineContext(context) === DEFAULT_TIMELINE_CONTEXT
        ? 'rooms'
        : 'animators';
}

function normalizeDefaultTimelineViewForContext(value, roomTimelineEnabled, context, mode) {
    const view = String(value || '').trim().toLowerCase();
    if (roomTimelineEnabled && TIMELINE_VIEW_MODES.has(view)) return view;
    return defaultTimelineViewForContext(context, mode, roomTimelineEnabled);
}

function defaultTimelineModules(mode, parkKitchenMode = 'with_kitchen') {
    const base = Object.fromEntries(TIMELINE_MODULE_KEYS.map(key => [key, false]));
    if (mode === 'disabled') {
        return { ...base, leads: true, customers: true, omni: true, tasks: true };
    }
    const common = {
        ...base,
        timeline: true,
        bookings: true,
        leads: true,
        customers: true,
        omni: true,
        tasks: true,
        resources: mode !== 'park'
    };
    if (mode === 'park') {
        return {
            ...common,
            products: true,
            afisha: true,
            kitchen: parkKitchenMode !== 'without_kitchen',
            resources: false
        };
    }
    if (mode === 'education') {
        return {
            ...common,
            teachers: true,
            lessonSeries: true
        };
    }
    return common;
}

function defaultTimelineFeatures(mode, parkKitchenMode = 'with_kitchen') {
    const base = Object.fromEntries(TIMELINE_FEATURE_KEYS.map(key => [key, false]));
    if (mode === 'disabled') return base;
    const common = {
        ...base,
        quickCloseSlot: true,
        freeResources: mode !== 'park',
        compactBlocks: mode !== 'park'
    };
    if (mode === 'park') {
        return {
            ...common,
            afisha: true,
            kitchen: parkKitchenMode !== 'without_kitchen'
        };
    }
    if (mode === 'education') {
        return {
            ...common,
            series: true,
            seriesBadge: true,
            teacherConflict: true,
            resourceCapacity: true
        };
    }
    return common;
}

function defaultBookingPolicy(mode) {
    return {
        allowLessonsWithoutTeacher: mode === 'education',
        allowLessonsWithoutGroup: true,
        enforceTeacherConflict: mode === 'education',
        enforceResourceCapacity: mode === 'education',
        notifyFirstOccurrenceOnly: mode === 'education'
    };
}

function defaultResourceModelForMode(mode) {
    if (mode === 'disabled') return 'none';
    if (mode === 'education') return 'cabinet';
    if (mode === 'simple' || mode === 'specialist') return 'specialist';
    if (mode === 'park') return 'auto';
    return 'auto';
}

function normalizeStartPage(value, mode) {
    const page = String(value || '').trim();
    if (TIMELINE_START_PAGES.has(page)) return page;
    return mode === 'disabled' ? 'dashboard' : 'timeline';
}

function normalizeResourceModel(value, mode) {
    const model = String(value || '').trim();
    return TIMELINE_RESOURCE_MODELS.has(model) ? model : defaultResourceModelForMode(mode);
}

function normalizeToggleRecord(value, defaults, allowedKeys) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const normalized = { ...defaults };
    allowedKeys.forEach(key => {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
            normalized[key] = Boolean(source[key]);
        }
    });
    return normalized;
}

function normalizeTimelineDisplaySettings(value, context) {
    const rawMode = String(value?.mode || '').trim();
    const explicitDisabled = value?.timelineEnabled === false || rawMode === 'disabled';
    const mode = explicitDisabled ? 'disabled' : normalizeTimelineDisplayMode(rawMode, context);
    const parkKitchenMode = normalizeParkKitchenMode(value?.parkKitchenMode);
    const enabledModules = normalizeToggleRecord(
        value?.enabledModules,
        defaultTimelineModules(mode, parkKitchenMode),
        TIMELINE_MODULE_KEYS
    );
    const timelineFeatures = normalizeToggleRecord(
        value?.timelineFeatures,
        defaultTimelineFeatures(mode, parkKitchenMode),
        TIMELINE_FEATURE_KEYS
    );
    const bookingPolicy = normalizeToggleRecord(
        value?.bookingPolicy,
        defaultBookingPolicy(mode),
        TIMELINE_POLICY_KEYS
    );

    if (mode === 'park' && parkKitchenMode === 'without_kitchen') {
        enabledModules.kitchen = false;
        timelineFeatures.kitchen = false;
    }
    if (mode === 'disabled') {
        enabledModules.timeline = false;
        enabledModules.bookings = false;
    }

    const resourceModel = mode === 'park'
        ? 'auto'
        : normalizeResourceModel(value?.resourceModel, mode);
    const roomTimelineEnabled = mode === 'park'
        && (Object.prototype.hasOwnProperty.call(value || {}, 'roomTimelineEnabled')
            ? value.roomTimelineEnabled !== false
            : normalizeTimelineContext(context) === DEFAULT_TIMELINE_CONTEXT);
    const defaultTimelineView = normalizeDefaultTimelineViewForContext(value?.defaultTimelineView, roomTimelineEnabled, context, mode);

    return {
        version: 2,
        timelineEnabled: mode !== 'disabled',
        mode,
        parkKitchenMode,
        startPage: normalizeStartPage(value?.startPage, mode),
        resourceModel,
        roomTimelineEnabled,
        defaultTimelineView,
        enabledModules,
        timelineFeatures,
        bookingPolicy,
        context: normalizeTimelineContext(context),
        updatedAt: value?.updatedAt || null,
        updatedBy: value?.updatedBy || null
    };
}

async function getTimelineDisplaySettings(db = defaultPool, context = DEFAULT_TIMELINE_CONTEXT) {
    const businessContext = normalizeTimelineContext(context);
    try {
        const result = await db.query('SELECT value FROM settings WHERE key = $1', [timelineDisplaySettingsKey(businessContext)]);
        const raw = result.rows[0]?.value;
        const parsed = raw ? JSON.parse(raw) : null;
        return normalizeTimelineDisplaySettings(parsed || {}, businessContext);
    } catch {
        return normalizeTimelineDisplaySettings({}, businessContext);
    }
}

function resourceTypeForDisplayMode(mode, settings = null) {
    const normalizedMode = String(mode || '').trim();
    if (normalizedMode === 'park') return null;
    const model = normalizeResourceModel(settings?.resourceModel, normalizedMode);
    if (model === 'none') return null;
    if (RESOURCE_TYPES.has(model)) return model;
    return RESOURCE_TYPE_BY_DISPLAY_MODE[normalizedMode] || null;
}

function normalizeResourceType(value, fallback = 'cabinet') {
    const raw = String(value || '').trim().toLowerCase();
    return RESOURCE_TYPES.has(raw) ? raw : fallback;
}

function normalizeEquipment(value) {
    if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return [];
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) return normalizeEquipment(parsed);
        } catch {}
        return trimmed.split(/[,;\n]+/).map(item => item.trim()).filter(Boolean);
    }
    return [];
}

function normalizeMetadata(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        try {
            const parsed = JSON.parse(value);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        } catch {}
    }
    return {};
}

function safeResourceId(value, fallbackPrefix = 'resource') {
    const raw = String(value || '').trim();
    if (/^[a-zA-Z0-9_.:-]{1,100}$/.test(raw)) return raw;
    return `${fallbackPrefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeCapacity(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10000) return null;
    return parsed;
}

function normalizeSortOrder(value, fallback = 0) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function resourceColor(index, fallback) {
    const color = String(fallback || '').trim();
    if (/^#[0-9A-Fa-f]{3,8}$/.test(color)) return color;
    return RESOURCE_COLORS[Math.max(0, index) % RESOURCE_COLORS.length];
}

function defaultResourcesFor(context, type) {
    const businessContext = normalizeTimelineContext(context);
    if (businessContext === 'maysternya_doli') {
        return [{
            resourceId: 'md-consult-room',
            type: 'specialist',
            name: 'Олександр',
            shortName: 'Олександр',
            color: '#0EA586',
            capacity: 1,
            equipment: ['online'],
            sortOrder: 10,
            metadata: { source: 'maysternya_default', online: true }
        }];
    }
    if (type === 'specialist') {
        return [{
            resourceId: 'specialist-main',
            type: 'specialist',
            name: 'Спеціаліст',
            shortName: 'Спец.',
            color: '#0EA586',
            capacity: 1,
            equipment: [],
            sortOrder: 10,
            metadata: { source: 'default_specialist' }
        }];
    }
    if (type === 'cabinet') {
        return [
            { resourceId: 'edu-cabinet-1', type: 'cabinet', name: 'Кабінет 1', shortName: 'Каб. 1', color: '#10B981', capacity: 8, sortOrder: 10 },
            { resourceId: 'edu-cabinet-2', type: 'cabinet', name: 'Кабінет 2', shortName: 'Каб. 2', color: '#3B82F6', capacity: 10, sortOrder: 20 },
            { resourceId: 'edu-cabinet-3', type: 'cabinet', name: 'Кабінет 3', shortName: 'Каб. 3', color: '#F97316', capacity: 12, sortOrder: 30 }
        ].map(item => ({ ...item, equipment: [], metadata: { source: 'default_education' } }));
    }
    return [];
}

function mapTimelineResourceRow(row = {}) {
    const equipment = Array.isArray(row.equipment) ? row.equipment : normalizeEquipment(row.equipment);
    const metadata = normalizeMetadata(row.metadata);
    return {
        id: row.id,
        businessContext: row.business_context || DEFAULT_TIMELINE_CONTEXT,
        resourceId: row.resource_id,
        type: row.type,
        name: row.name,
        shortName: row.short_name || null,
        color: row.color || null,
        capacity: row.capacity === null || row.capacity === undefined ? null : Number(row.capacity),
        equipment,
        isActive: row.is_active !== false,
        sortOrder: normalizeSortOrder(row.sort_order),
        metadata,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null
    };
}

function resourceToLine(resource) {
    return {
        id: resource.resourceId,
        resourceId: resource.resourceId,
        resourceType: resource.type,
        businessContext: resource.businessContext || DEFAULT_TIMELINE_CONTEXT,
        name: resource.name,
        shortName: resource.shortName,
        color: resource.color || '#10B981',
        capacity: resource.capacity,
        equipment: resource.equipment || [],
        metadata: resource.metadata || {},
        fromSheet: false,
        staffId: null,
        shiftStart: null,
        shiftEnd: null,
        shiftStatus: null,
        source: 'timeline_resource',
        resourceSource: 'timeline_resource',
        sortOrder: resource.sortOrder
    };
}

function timelineResourceAliases(resource = {}) {
    const metadata = normalizeMetadata(resource.metadata);
    const values = [
        ...(Array.isArray(metadata.aliases) ? metadata.aliases : []),
        ...(Array.isArray(metadata.legacyNames) ? metadata.legacyNames : []),
        ...(Array.isArray(metadata.legacy_names) ? metadata.legacy_names : [])
    ];
    return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function timelineResourceRoomMatchValues(resource = {}) {
    return [...new Set([
        resource.name,
        resource.shortName,
        resource.short_name,
        ...timelineResourceAliases(resource)
    ].map(value => String(value || '').trim()).filter(Boolean))];
}

function timelineResourceMatchesRoomValue(resource = {}, value = '') {
    const normalized = normalizedRoomIdentityValue(value);
    if (!normalized) return false;
    return timelineResourceRoomMatchValues(resource)
        .some(candidate => normalizedRoomIdentityValue(candidate) === normalized);
}

function mergeTimelineResourceRenameAliases(existing = null, inputMetadata = {}, nextName = '') {
    const existingMetadata = normalizeMetadata(existing?.metadata);
    const incomingMetadata = normalizeMetadata(inputMetadata);
    const metadata = {
        ...existingMetadata,
        ...incomingMetadata
    };
    const aliases = new Set([
        ...timelineResourceAliases({ metadata: existingMetadata }),
        ...timelineResourceAliases({ metadata: incomingMetadata })
    ]);
    const previousNames = [existing?.name, existing?.shortName].map(value => String(value || '').trim()).filter(Boolean);
    const normalizedNextName = String(nextName || '').trim().toLowerCase();
    previousNames.forEach(value => {
        if (value.toLowerCase() !== normalizedNextName) aliases.add(value);
    });
    return {
        ...metadata,
        aliases: Array.from(aliases).slice(-50)
    };
}

function normalizedRoomIdentityValue(value) {
    return String(value || '').trim().toLowerCase();
}

function resolveRoomTimelineResourceIdentity(resources = [], booking = {}, options = {}) {
    const safeResources = Array.isArray(resources) ? resources : [];
    const identity = booking.timelineIdentity || booking.timeline_identity || {};
    const projection = booking.timelineProjection || booking.timeline_projection || {};
    const explicitResourceType = normalizedRoomIdentityValue(
        booking.roomResourceType
        || booking.room_resource_type
        || projection.resourceType
        || projection.resource_type
        || booking.resourceType
        || booking.resource_type
        || identity.resourceType
        || identity.resource_type
    );
    const durableResourceId = String(
        booking.roomResourceId
        || booking.room_resource_id
        || projection.roomResourceId
        || projection.room_resource_id
        || (explicitResourceType === 'room' ? (
            projection.resourceId
            || projection.resource_id
            || booking.resourceId
            || booking.resource_id
            || identity.resourceId
            || identity.resource_id
        ) : '')
        || ''
    ).trim();
    const legacyRoomName = String(booking.room || booking.legacyRoomName || booking.legacy_room_name || '').trim();
    const normalizedRoom = normalizedRoomIdentityValue(legacyRoomName);
    if (['room-takeaway', 'takeaway', 'на виніс', 'на вынос'].includes(normalizedRoom)
        || normalizedRoomIdentityValue(durableResourceId) === 'room-takeaway') {
        return {
            resourceId: 'room-takeaway',
            resourceName: options.takeawayName || 'На виніс',
            legacyRoomName,
            status: 'takeaway',
            diagnosticReason: null,
            assignmentAllowed: true
        };
    }

    const byDurableId = durableResourceId
        ? safeResources.find(resource => String(resource.resourceId || '') === durableResourceId)
        : null;
    if (byDurableId) {
        return byDurableId.isActive === false
            ? {
                resourceId: options.quarantineResourceId || 'room-quarantine',
                resourceName: options.quarantineName || 'Невідома / неактивна кімната',
                legacyRoomName,
                resolvedResourceId: byDurableId.resourceId,
                resolvedResourceName: byDurableId.name,
                status: 'inactive',
                diagnosticReason: 'inactive_room',
                assignmentAllowed: false
            }
            : {
                resourceId: byDurableId.resourceId,
                resourceName: byDurableId.name,
                legacyRoomName,
                status: 'active',
                diagnosticReason: normalizedRoom && normalizedRoom !== normalizedRoomIdentityValue(byDurableId.name) ? 'renamed_room' : null,
                assignmentAllowed: true
            };
    }

    const exactName = safeResources.find(resource => [resource.name, resource.shortName]
        .some(value => normalizedRoomIdentityValue(value) === normalizedRoom));
    if (exactName) {
        return exactName.isActive === false
            ? {
                resourceId: options.quarantineResourceId || 'room-quarantine',
                resourceName: options.quarantineName || 'Невідома / неактивна кімната',
                legacyRoomName,
                resolvedResourceId: exactName.resourceId,
                resolvedResourceName: exactName.name,
                status: 'inactive',
                diagnosticReason: 'inactive_room',
                assignmentAllowed: false
            }
            : {
                resourceId: exactName.resourceId,
                resourceName: exactName.name,
                legacyRoomName,
                status: 'active',
                diagnosticReason: null,
                assignmentAllowed: true
            };
    }

    const aliasMatch = safeResources.find(resource => timelineResourceAliases(resource)
        .some(alias => normalizedRoomIdentityValue(alias) === normalizedRoom));
    if (aliasMatch) {
        return aliasMatch.isActive === false
            ? {
                resourceId: options.quarantineResourceId || 'room-quarantine',
                resourceName: options.quarantineName || 'Невідома / неактивна кімната',
                legacyRoomName,
                resolvedResourceId: aliasMatch.resourceId,
                resolvedResourceName: aliasMatch.name,
                status: 'inactive',
                diagnosticReason: 'inactive_room',
                assignmentAllowed: false
            }
            : {
                resourceId: aliasMatch.resourceId,
                resourceName: aliasMatch.name,
                legacyRoomName,
                status: 'renamed',
                diagnosticReason: 'renamed_room',
                assignmentAllowed: true
            };
    }

    const legacyNames = new Set((options.legacyRoomNames || []).map(normalizedRoomIdentityValue));
    if (normalizedRoom && legacyNames.has(normalizedRoom)) {
        return {
            resourceId: legacyRoomName,
            resourceName: legacyRoomName,
            legacyRoomName,
            status: 'legacy_active',
            diagnosticReason: 'legacy_room_text',
            assignmentAllowed: true
        };
    }
    return {
        resourceId: options.quarantineResourceId || 'room-quarantine',
        resourceName: options.quarantineName || 'Невідома / неактивна кімната',
        legacyRoomName,
        unresolvedResourceId: durableResourceId || null,
        status: durableResourceId ? 'unmatched' : 'custom',
        diagnosticReason: durableResourceId ? 'unmatched_room' : 'custom_room',
        assignmentAllowed: false
    };
}

async function upsertTimelineResource(db = defaultPool, context = DEFAULT_TIMELINE_CONTEXT, input = {}) {
    const businessContext = normalizeTimelineContext(context);
    const type = normalizeResourceType(input.type, 'cabinet');
    const name = String(input.name || input.label || '').trim().slice(0, 120);
    if (!name) {
        const err = new Error('resource name required');
        err.statusCode = 400;
        throw err;
    }
    const resourceId = safeResourceId(input.resourceId || input.resource_id || input.id, type);
    const shortName = String(input.shortName || input.short_name || '').trim().slice(0, 60) || null;
    const color = resourceColor(normalizeSortOrder(input.sortOrder || input.sort_order), input.color);
    const capacity = normalizeCapacity(input.capacity);
    const equipment = normalizeEquipment(input.equipment);
    const inputMetadata = normalizeMetadata(input.metadata);
    const isActive = input.isActive !== undefined ? Boolean(input.isActive) : input.is_active !== false;
    const sortOrder = normalizeSortOrder(input.sortOrder ?? input.sort_order);
    const existing = await findTimelineResource(db, businessContext, resourceId, {
        type,
        includeInactive: true
    });
    const metadata = mergeTimelineResourceRenameAliases(existing, inputMetadata, name);

    const result = await db.query(
        `INSERT INTO timeline_resources
            (business_context, resource_id, type, name, short_name, color, capacity, equipment, is_active, sort_order, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11::jsonb)
         ON CONFLICT (business_context, resource_id) DO UPDATE SET
            type = EXCLUDED.type,
            name = EXCLUDED.name,
            short_name = EXCLUDED.short_name,
            color = EXCLUDED.color,
            capacity = EXCLUDED.capacity,
            equipment = EXCLUDED.equipment,
            is_active = EXCLUDED.is_active,
            sort_order = EXCLUDED.sort_order,
            metadata = EXCLUDED.metadata,
            updated_at = NOW()
         RETURNING *`,
        [
            businessContext,
            resourceId,
            type,
            name,
            shortName,
            color,
            capacity,
            JSON.stringify(equipment),
            isActive,
            sortOrder,
            JSON.stringify(metadata)
        ]
    );
    return mapTimelineResourceRow(result.rows[0]);
}

async function ensureDefaultTimelineResources(db = defaultPool, context = DEFAULT_TIMELINE_CONTEXT, type = 'cabinet') {
    const businessContext = normalizeTimelineContext(context);
    const resourceType = normalizeResourceType(type, 'cabinet');
    const countResult = await db.query(
        'SELECT COUNT(*)::int AS count FROM timeline_resources WHERE business_context = $1 AND type = $2',
        [businessContext, resourceType]
    );
    if ((countResult.rows[0]?.count || 0) > 0) return;
    const defaults = defaultResourcesFor(businessContext, resourceType);
    for (const resource of defaults) {
        await upsertTimelineResource(db, businessContext, resource);
    }
}

async function listTimelineResources(db = defaultPool, options = {}) {
    const businessContext = normalizeTimelineContext(options.context || options.businessContext);
    const type = options.type ? normalizeResourceType(options.type) : null;
    if (options.ensureDefault && type) {
        await ensureDefaultTimelineResources(db, businessContext, type);
    }
    const params = [businessContext];
    const conditions = ['business_context = $1'];
    if (type) {
        params.push(type);
        conditions.push(`type = $${params.length}`);
    }
    if (!options.includeInactive) conditions.push('is_active = TRUE');
    const result = await db.query(
        `SELECT *
           FROM timeline_resources
          WHERE ${conditions.join(' AND ')}
          ORDER BY sort_order ASC, name ASC, id ASC`,
        params
    );
    return result.rows.map(mapTimelineResourceRow);
}

async function findTimelineResource(db = defaultPool, context = DEFAULT_TIMELINE_CONTEXT, resourceId, options = {}) {
    const businessContext = normalizeTimelineContext(context);
    const params = [businessContext, String(resourceId || '').trim()];
    const conditions = ['business_context = $1', 'resource_id = $2'];
    if (options.type) {
        params.push(normalizeResourceType(options.type));
        conditions.push(`type = $${params.length}`);
    }
    if (!options.includeInactive) conditions.push('is_active = TRUE');
    const result = await db.query(
        `SELECT * FROM timeline_resources WHERE ${conditions.join(' AND ')} LIMIT 1`,
        params
    );
    return result.rows[0] ? mapTimelineResourceRow(result.rows[0]) : null;
}

async function findTimelineResourceByName(db = defaultPool, context = DEFAULT_TIMELINE_CONTEXT, name, options = {}) {
    const businessContext = normalizeTimelineContext(context);
    const safeName = String(name || '').trim();
    if (!safeName) return null;
    const params = [businessContext, safeName];
    const conditions = [
        'business_context = $1',
        `(LOWER(BTRIM(name)) = LOWER(BTRIM($2)) OR LOWER(BTRIM(COALESCE(short_name, ''))) = LOWER(BTRIM($2)))`
    ];
    if (options.type) {
        params.push(normalizeResourceType(options.type));
        conditions.push(`type = $${params.length}`);
    }
    if (!options.includeInactive) conditions.push('is_active = TRUE');
    const result = await db.query(
        `SELECT * FROM timeline_resources WHERE ${conditions.join(' AND ')} ORDER BY is_active DESC, sort_order ASC, id ASC LIMIT 1`,
        params
    );
    return result.rows[0] ? mapTimelineResourceRow(result.rows[0]) : null;
}

async function timelineResourceLinesForMode(db = defaultPool, context = DEFAULT_TIMELINE_CONTEXT, mode, settings = null) {
    const type = resourceTypeForDisplayMode(mode, settings);
    if (!type) return null;
    const resources = await listTimelineResources(db, {
        context,
        type,
        includeInactive: false,
        ensureDefault: true
    });
    return resources.map(resourceToLine);
}

async function syncTimelineResourcesFromLines(db = defaultPool, context = DEFAULT_TIMELINE_CONTEXT, type = 'cabinet', lines = []) {
    const businessContext = normalizeTimelineContext(context);
    const resourceType = normalizeResourceType(type, 'cabinet');
    const normalizedLines = Array.isArray(lines) ? lines : [];
    const existingResources = await listTimelineResources(db, {
        context: businessContext,
        type: resourceType,
        includeInactive: true
    });
    const existingById = new Map(existingResources.map(resource => [String(resource.resourceId), resource]));
    const saved = [];
    for (let index = 0; index < normalizedLines.length; index += 1) {
        const line = normalizedLines[index] || {};
        const resource = await upsertTimelineResource(db, businessContext, {
            resourceId: line.resourceId || line.id,
            type: resourceType,
            name: line.name,
            shortName: line.shortName,
            color: line.color || resourceColor(index),
            capacity: line.capacity,
            equipment: line.equipment,
            metadata: mergeTimelineResourceRenameAliases(existingById.get(String(line.resourceId || line.id)), line.metadata, line.name),
            isActive: true,
            sortOrder: line.sortOrder ?? index * 10
        });
        saved.push(resource);
    }
    const keepIds = saved.map(resource => resource.resourceId);
    if (keepIds.length) {
        await db.query(
            `UPDATE timeline_resources
                SET is_active = FALSE, updated_at = NOW()
              WHERE business_context = $1
                AND type = $2
                AND resource_id <> ALL($3::text[])`,
            [businessContext, resourceType, keepIds]
        );
    } else {
        await db.query(
            `UPDATE timeline_resources
                SET is_active = FALSE, updated_at = NOW()
              WHERE business_context = $1
                AND type = $2`,
            [businessContext, resourceType]
        );
    }
    return saved;
}

async function deleteTimelineResource(db = defaultPool, context = DEFAULT_TIMELINE_CONTEXT, resourceId) {
    const businessContext = normalizeTimelineContext(context);
    const result = await db.query(
        `UPDATE timeline_resources
            SET is_active = FALSE, updated_at = NOW()
          WHERE business_context = $1 AND resource_id = $2
          RETURNING *`,
        [businessContext, String(resourceId || '').trim()]
    );
    return result.rows[0] ? mapTimelineResourceRow(result.rows[0]) : null;
}

async function countFutureActiveBookingsForTimelineResource(db = defaultPool, context = DEFAULT_TIMELINE_CONTEXT, resource = {}) {
    const businessContext = normalizeTimelineContext(context);
    const resourceId = String(resource?.resourceId || resource?.resource_id || '').trim();
    if (!resourceId) return 0;
    const type = normalizeResourceType(resource?.type, 'cabinet');
    const roomValues = type === 'room' ? timelineResourceRoomMatchValues(resource) : [];
    const result = await db.query(
        `SELECT COUNT(*)::int AS count
           FROM bookings b
          WHERE COALESCE(b.business_context, '${DEFAULT_TIMELINE_CONTEXT}') = $1
            AND b.date >= CURRENT_DATE
            AND ${activeBookingStatusSql('b')}
            AND (
                b.line_id = $2
                OR b.resource_id = $2
                ${roomValues.length ? 'OR b.room = ANY($3::text[])' : ''}
            )`,
        roomValues.length
            ? [businessContext, resourceId, roomValues]
            : [businessContext, resourceId]
    );
    return Number(result.rows[0]?.count || 0);
}

async function timelineResourceAvailability(db = defaultPool, options = {}) {
    const context = normalizeTimelineContext(options.context || options.businessContext);
    const type = normalizeResourceType(options.type || 'cabinet', 'cabinet');
    const date = String(options.date || '').trim();
    const time = String(options.time || '').trim();
    const duration = Math.max(1, Math.min(parseInt(options.duration, 10) || 60, 1440));
    const requestedCapacity = normalizeCapacity(options.capacity ?? options.attendees ?? options.kidsCount);
    const resources = await listTimelineResources(db, {
        context,
        type,
        includeInactive: false,
        ensureDefault: true
    });
    const resourceIds = resources.map(resource => resource.resourceId);
    const resourceNames = [...new Set(resources.flatMap(timelineResourceRoomMatchValues))];
    if (!resourceIds.length) {
        return { context, type, date, time, duration, requestedCapacity, total: 0, free: [], occupied: [], overCapacity: [], resources: [] };
    }
    const bookings = await db.query(
        `SELECT b.id, b.line_id, b.resource_id, b.room, b.time, b.duration, b.label, b.program_code, b.program_name,
                b.status, b.kids_count, b.group_name, b.linked_to, b.extra_data, b.customer_id, b.business_context,
                c.name AS customer_name,
                bg.id AS banquet_group_id,
                CASE WHEN bg.id IS NOT NULL THEN bgb.role ELSE NULL END AS banquet_group_role,
                bg.primary_booking_id AS banquet_group_primary_booking_id,
                bg.customer_id AS banquet_group_customer_id
           FROM bookings b
           LEFT JOIN customers c
             ON c.id = b.customer_id
            AND COALESCE(c.business_context, '${DEFAULT_TIMELINE_CONTEXT}') = COALESCE(b.business_context, '${DEFAULT_TIMELINE_CONTEXT}')
           LEFT JOIN banquet_group_bookings bgb
             ON bgb.booking_id = b.id
            AND COALESCE(bgb.business_context, '${DEFAULT_TIMELINE_CONTEXT}') = COALESCE(b.business_context, '${DEFAULT_TIMELINE_CONTEXT}')
           LEFT JOIN banquet_groups bg
             ON bg.id = bgb.group_id
            AND COALESCE(bg.business_context, '${DEFAULT_TIMELINE_CONTEXT}') = COALESCE(b.business_context, '${DEFAULT_TIMELINE_CONTEXT}')
            AND LOWER(COALESCE(NULLIF(BTRIM(bg.status), ''), 'active')) = 'active'
          WHERE b.date = $1
            AND COALESCE(b.business_context, '${DEFAULT_TIMELINE_CONTEXT}') = $2
            AND ${activeBookingStatusSql('b')}
            AND (b.line_id = ANY($3::text[]) OR b.resource_id = ANY($3::text[]) OR b.room = ANY($4::text[]))`,
        [date, context, resourceIds, resourceNames]
    );
    const start = timeToMinutes(time);
    const end = start + duration;
    const byResource = new Map(resources.map(resource => [resource.resourceId, []]));
    const dayBookingsByResource = new Map(resources.map(resource => [resource.resourceId, []]));
    for (const booking of bookings.rows) {
        const direct = resources.find(resource => [booking.resource_id, booking.line_id].some(value => resource.resourceId === value));
        const byName = direct || resources.find(resource => timelineResourceMatchesRoomValue(resource, booking.room));
        if (!byName) continue;
        if (!String(booking.linked_to || '').trim()) {
            const customerName = booking.customer_name || booking.group_name || booking.label
                || booking.program_name || booking.program_code || booking.id;
            dayBookingsByResource.get(byName.resourceId)?.push({
                id: booking.id,
                time: booking.time,
                duration: booking.duration || 0,
                customerName,
                label: booking.label || null,
                programName: booking.program_name || null,
                customerId: booking.customer_id ?? null,
                room: booking.room || null,
                businessContext: booking.business_context || context || DEFAULT_TIMELINE_CONTEXT,
                banquetGroupId: booking.banquet_group_id || null,
                banquetGroupRole: booking.banquet_group_role || null,
                banquetGroupPrimaryBookingId: booking.banquet_group_primary_booking_id || null,
                banquetGroupCustomerId: booking.banquet_group_customer_id ?? null,
                isBanquetGroupMember: Boolean(booking.banquet_group_id),
                isBanquetPrimary: Boolean(
                    booking.banquet_group_primary_booking_id
                    && String(booking.banquet_group_primary_booking_id) === String(booking.id)
                )
            });
        }
        const bookingStart = timeToMinutes(booking.time);
        const bookingEnd = bookingStart + (parseInt(booking.duration, 10) || 0);
        if (!(start < bookingEnd && end > bookingStart)) continue;
        byResource.get(byName.resourceId)?.push({
            id: booking.id,
            time: booking.time,
            duration: booking.duration,
            label: booking.label || booking.program_name || booking.program_code || null,
            kidsCount: booking.kids_count || null,
            resourceBlock: booking.extra_data?.timelineResourceBlock?.resourceBlocked === true
                || booking.extra_data?.maysternyaBooking?.slotClosed === true
        });
    }
    dayBookingsByResource.forEach((resourceBookings, resourceId) => {
        dayBookingsByResource.set(resourceId, [...resourceBookings].sort((a, b) =>
            String(a.time || '').localeCompare(String(b.time || ''))
            || String(a.id || '').localeCompare(String(b.id || ''))
        ));
    });
    const detailed = resources.map(resource => {
        const conflicts = byResource.get(resource.resourceId) || [];
        const dayBookings = dayBookingsByResource.get(resource.resourceId) || [];
        const capacity = normalizeCapacity(resource.capacity);
        const capacityAvailable = !requestedCapacity || !capacity || capacity >= requestedCapacity;
        const unavailableReason = conflicts.length > 0
            ? 'occupied'
            : (!capacityAvailable ? 'capacity' : null);
        return {
            ...resource,
            occupied: conflicts.length > 0,
            capacityAvailable,
            requestedCapacity,
            unavailableReason,
            bookings: conflicts,
            dayBookings
        };
    });
    const freeResources = detailed.filter(resource => !resource.occupied && resource.capacityAvailable);
    const occupiedResources = detailed.filter(resource => resource.occupied);
    const overCapacityResources = detailed.filter(resource => !resource.occupied && !resource.capacityAvailable);
    return {
        context,
        type,
        date,
        time,
        duration,
        requestedCapacity,
        total: resources.length,
        free: freeResources.map(resource => resource.name),
        occupied: occupiedResources.map(resource => resource.name),
        overCapacity: overCapacityResources.map(resource => resource.name),
        resources: detailed
    };
}

module.exports = {
    TIMELINE_DISPLAY_MODES,
    TIMELINE_PARK_KITCHEN_MODES,
    TIMELINE_VIEW_MODES,
    TIMELINE_START_PAGES,
    TIMELINE_RESOURCE_MODELS,
    TIMELINE_MODULE_KEYS,
    TIMELINE_FEATURE_KEYS,
    TIMELINE_POLICY_KEYS,
    RESOURCE_TYPES,
    defaultTimelineModules,
    defaultTimelineFeatures,
    defaultBookingPolicy,
    normalizeTimelineDisplaySettings,
    getTimelineDisplaySettings,
    resourceTypeForDisplayMode,
    normalizeResourceType,
    mapTimelineResourceRow,
    resourceToLine,
    timelineResourceAliases,
    timelineResourceRoomMatchValues,
    timelineResourceMatchesRoomValue,
    mergeTimelineResourceRenameAliases,
    resolveRoomTimelineResourceIdentity,
    upsertTimelineResource,
    ensureDefaultTimelineResources,
    listTimelineResources,
    findTimelineResource,
    findTimelineResourceByName,
    timelineResourceLinesForMode,
    syncTimelineResourcesFromLines,
    deleteTimelineResource,
    countFutureActiveBookingsForTimelineResource,
    timelineResourceAvailability
};

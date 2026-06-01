'use strict';

const { pool: defaultPool } = require('../db');
const {
    DEFAULT_TIMELINE_CONTEXT,
    normalizeTimelineContext
} = require('./timelineContext');
const { timeToMinutes } = require('./booking');

const TIMELINE_DISPLAY_MODES = new Set(['disabled', 'simple', 'specialist', 'park', 'education']);
const TIMELINE_PARK_KITCHEN_MODES = new Set(['with_kitchen', 'without_kitchen']);
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

    return {
        version: 2,
        timelineEnabled: mode !== 'disabled',
        mode,
        parkKitchenMode,
        startPage: normalizeStartPage(value?.startPage, mode),
        resourceModel,
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
    const metadata = normalizeMetadata(input.metadata);
    const isActive = input.isActive !== undefined ? Boolean(input.isActive) : input.is_active !== false;
    const sortOrder = normalizeSortOrder(input.sortOrder ?? input.sort_order);

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
            metadata: line.metadata,
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
    const resourceNames = resources.map(resource => resource.name);
    if (!resourceIds.length) {
        return { context, type, date, time, duration, requestedCapacity, total: 0, free: [], occupied: [], overCapacity: [], resources: [] };
    }
    const bookings = await db.query(
        `SELECT id, line_id, room, time, duration, label, program_code, program_name, status, kids_count, extra_data
           FROM bookings
          WHERE date = $1
            AND COALESCE(business_context, '${DEFAULT_TIMELINE_CONTEXT}') = $2
            AND status != 'cancelled'
            AND (line_id = ANY($3::text[]) OR room = ANY($4::text[]))`,
        [date, context, resourceIds, resourceNames]
    );
    const start = timeToMinutes(time);
    const end = start + duration;
    const byResource = new Map(resources.map(resource => [resource.resourceId, []]));
    for (const booking of bookings.rows) {
        const bookingStart = timeToMinutes(booking.time);
        const bookingEnd = bookingStart + (parseInt(booking.duration, 10) || 0);
        if (!(start < bookingEnd && end > bookingStart)) continue;
        const direct = resources.find(resource => resource.resourceId === booking.line_id);
        const byName = direct || resources.find(resource => resource.name === booking.room);
        if (!byName) continue;
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
    const detailed = resources.map(resource => {
        const conflicts = byResource.get(resource.resourceId) || [];
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
            bookings: conflicts
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
    upsertTimelineResource,
    ensureDefaultTimelineResources,
    listTimelineResources,
    findTimelineResource,
    findTimelineResourceByName,
    timelineResourceLinesForMode,
    syncTimelineResourcesFromLines,
    deleteTimelineResource,
    timelineResourceAvailability
};

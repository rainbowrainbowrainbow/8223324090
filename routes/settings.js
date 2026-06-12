/**
 * routes/settings.js — Settings, stats, rooms, health
 */
const router = require('express').Router();
const { pool } = require('../db');
const { validateDate, validateTime, validateSettingKey, mapBookingRow, timeToMinutes, ALL_ROOMS } = require('../services/booking');
const { createLogger } = require('../utils/logger');
const { logAdminAction } = require('../services/adminAudit');
const { settingsCache } = require('../services/cache');
const { getVisibleBookingScope } = require('../services/bookingVisibility');
const { getReleaseMetadata } = require('../services/release');
const {
    DEFAULT_TIMELINE_CONTEXT,
    timelineContextFromRequest,
    requireTimelineContext,
    requireTimelineAction
} = require('../services/timelineContext');
const {
    businessContextFromRequest,
    requireBusinessContext,
    resolveBusinessScope,
    requireBusinessScope,
    requireWritableBusinessScope
} = require('../services/businessContext');
const {
    getTimelineDisplaySettings,
    normalizeTimelineDisplaySettings,
    resourceTypeForDisplayMode,
    timelineResourceAvailability
} = require('../services/timelineResources');
const { buildBusinessOperatingProfile } = require('../services/businessProfile');
const {
    businessCabinetCatalog,
    businessCabinetSettingsKey,
    getBusinessCabinetSettings,
    isTimelineContext,
    saveBusinessCabinetSettings
} = require('../services/businessCabinet');
const {
    getChatSettingsBundle,
    getAIProviderDiagnostics,
    getUnifiedAIConfig,
    publicAIConfig,
    testUnifiedAIConfig,
    saveChatAISettings,
    getStoredIntegrationsSettings,
    saveIntegrationsSettings,
    getStoredGuardianSettings,
    saveGuardianSettings
} = require('../services/ai-config');

const { requireRole, requireMinRole, authenticateToken } = require('../middleware/auth');
const log = createLogger('Settings');

function activeBookingStatusSql(alias = '') {
    const column = alias ? `${alias}.status` : 'status';
    return `LOWER(COALESCE(NULLIF(BTRIM(${column}), ''), 'confirmed')) != 'cancelled'`;
}

const REQUIRED_SCHEMA_MIGRATIONS = Object.freeze([
    '216_booking_banquet_links',
    '260_leads_kanban_position',
    '262_leads_customer_links_and_value'
]);

const TRACKED_DATA_MIGRATIONS = Object.freeze([
    '261_leads_customer_card_canonical_customers'
]);

const REQUIRED_SCHEMA_COLUMNS = Object.freeze([
    ['bookings', 'business_context'],
    ['bookings', 'customer_id'],
    ['booking_banquet_links', 'relation_type'],
    ['customers', 'business_context'],
    ['customer_cards', 'business_context'],
    ['leads', 'business_context'],
    ['leads', 'kanban_position'],
    ['leads', 'potential_value'],
    ['lead_customer_links', 'business_context'],
    ['lead_customer_links', 'lead_id'],
    ['lead_customer_links', 'customer_id'],
    ['lead_customer_links', 'link_type']
]);

async function getRuntimeSchemaDiagnostics() {
    const diagnostics = {
        status: 'ok',
        migrations: {},
        dataMigrations: {},
        columns: {},
        missing: [],
        warnings: [],
        pendingDataMigrations: []
    };
    try {
        const migrationResult = await pool.query(
            'SELECT version FROM schema_migrations WHERE version = ANY($1::text[])',
            [REQUIRED_SCHEMA_MIGRATIONS]
        );
        const applied = new Set(migrationResult.rows.map(row => String(row.version || '')));
        for (const version of REQUIRED_SCHEMA_MIGRATIONS) {
            const ok = applied.has(version);
            diagnostics.migrations[version] = ok;
            if (!ok) diagnostics.missing.push(`migration:${version}`);
        }

        const dataMigrationResult = await pool.query(
            'SELECT version FROM schema_migrations WHERE version = ANY($1::text[])',
            [TRACKED_DATA_MIGRATIONS]
        );
        const appliedDataMigrations = new Set(dataMigrationResult.rows.map(row => String(row.version || '')));
        for (const version of TRACKED_DATA_MIGRATIONS) {
            const ok = appliedDataMigrations.has(version);
            diagnostics.dataMigrations[version] = ok;
            if (!ok) {
                diagnostics.pendingDataMigrations.push(version);
                diagnostics.warnings.push(`pending-data-migration:${version}`);
            }
        }

        const columnResult = await pool.query(
            `SELECT table_name, column_name
               FROM information_schema.columns
              WHERE table_schema = 'public'
                AND (table_name, column_name) IN (
                    ${REQUIRED_SCHEMA_COLUMNS.map((_, index) => `($${index * 2 + 1}, $${index * 2 + 2})`).join(', ')}
                )`,
            REQUIRED_SCHEMA_COLUMNS.flat()
        );
        const existingColumns = new Set(columnResult.rows.map(row => `${row.table_name}.${row.column_name}`));
        for (const [table, column] of REQUIRED_SCHEMA_COLUMNS) {
            const key = `${table}.${column}`;
            const ok = existingColumns.has(key);
            diagnostics.columns[key] = ok;
            if (!ok) diagnostics.missing.push(`column:${key}`);
        }

        diagnostics.status = diagnostics.missing.length ? 'degraded' : 'ok';
    } catch (err) {
        diagnostics.status = 'error';
        diagnostics.error = err.message;
    }
    return diagnostics;
}

async function buildBaseHealth() {
    const release = getReleaseMetadata();
    const checks = {
        version: release.version,
        releaseLabel: release.releaseLabel,
        database: 'unknown',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    };
    const mem = process.memoryUsage();
    checks.memory = {
        rss: Math.round(mem.rss / 1024 / 1024) + 'MB',
        heap: Math.round(mem.heapUsed / 1024 / 1024) + '/' + Math.round(mem.heapTotal / 1024 / 1024) + 'MB'
    };
    try {
        const start = Date.now();
        await pool.query('SELECT 1');
        checks.database = 'connected';
        checks.dbLatency = (Date.now() - start) + 'ms';
        checks.pool = { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount };
    } catch (err) {
        checks.database = 'error: ' + err.message;
    }
    checks.status = checks.database === 'connected' ? 'ok' : 'degraded';
    return checks;
}

async function buildDeepHealth() {
    const checks = await buildBaseHealth();
    checks.schema = checks.database === 'connected'
        ? await getRuntimeSchemaDiagnostics()
        : { status: 'unknown', missing: [] };
    try {
        const uc = await pool.query('SELECT COUNT(*)::int as c FROM users');
        checks.userCount = uc.rows[0].c;
    } catch {}
    checks.status = checks.database === 'connected' && checks.schema.status === 'ok' ? 'ok' : 'degraded';
    return checks;
}

// v39.8: Move version + health BEFORE auth (must be public)
// Duplicates removed from below auth wall

router.get('/version', (req, res) => {
    res.json(getReleaseMetadata());
});

router.get('/health', async (req, res) => {
    res.json(await buildBaseHealth());
});

router.get('/ready', async (req, res) => {
    const checks = await buildDeepHealth();
    res.status(checks.status === 'ok' ? 200 : 503).json(checks);
});

router.get('/health/deep', async (req, res) => {
    res.json(await buildDeepHealth());
});

// v39.8: Security — require authentication for remaining endpoints
router.use(authenticateToken);

const CHAT_SETTINGS_ROLES = ['creator', 'director', 'admin'];

function auditChatSettings(req, target, details) {
    logAdminAction('chat_settings_update', 'settings', {
        username: req.user?.username,
        target,
        details,
        ip: req.ip,
        requestId: req.headers['x-request-id']
    });
}

// v0.55.1: Dedicated chat/AI/integration/guardian settings surface.
router.get('/settings/chat', requireRole(...CHAT_SETTINGS_ROLES), async (req, res) => {
    try {
        res.json(await getChatSettingsBundle());
    } catch (err) {
        log.error('GET /settings/chat error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/settings/ai/providers', requireRole(...CHAT_SETTINGS_ROLES), async (req, res) => {
    try {
        res.json(await getAIProviderDiagnostics());
    } catch (err) {
        log.error('GET /settings/ai/providers error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.put('/settings/chat', requireRole(...CHAT_SETTINGS_ROLES), async (req, res) => {
    try {
        const body = req.body || {};
        if (body.chatAi) await saveChatAISettings(body.chatAi);
        if (body.integrations) await saveIntegrationsSettings(body.integrations);
        if (body.guardian) await saveGuardianSettings(body.guardian);
        auditChatSettings(req, 'chat_bundle', {
            updated: Object.keys(body).filter(key => ['chatAi', 'integrations', 'guardian'].includes(key))
        });
        res.json(await getChatSettingsBundle());
    } catch (err) {
        log.error('PUT /settings/chat error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/settings/chat/ai', requireRole(...CHAT_SETTINGS_ROLES), async (req, res) => {
    try {
        res.json(publicAIConfig(await getUnifiedAIConfig({ scope: 'chat_ai' })));
    } catch (err) {
        log.error('GET /settings/chat/ai error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.put('/settings/chat/ai', requireRole(...CHAT_SETTINGS_ROLES), async (req, res) => {
    try {
        await saveChatAISettings(req.body || {});
        auditChatSettings(req, 'chat_ai', {
            provider: req.body?.provider,
            model: req.body?.model,
            enabled: req.body?.enabled !== false,
            keySource: 'crm_ai_default'
        });
        res.json(publicAIConfig(await getUnifiedAIConfig({ scope: 'chat_ai' })));
    } catch (err) {
        log.error('PUT /settings/chat/ai error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/settings/chat/ai/test', requireRole(...CHAT_SETTINGS_ROLES), async (req, res) => {
    try {
        const result = await testUnifiedAIConfig({
            scope: 'chat_ai',
            live: req.body?.live !== false
        });
        res.status(result.ok ? 200 : 503).json(result);
    } catch (err) {
        log.error('POST /settings/chat/ai/test error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/settings/chat/integrations', requireRole(...CHAT_SETTINGS_ROLES), async (req, res) => {
    try {
        res.json(await getStoredIntegrationsSettings());
    } catch (err) {
        log.error('GET /settings/chat/integrations error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.put('/settings/chat/integrations', requireRole(...CHAT_SETTINGS_ROLES), async (req, res) => {
    try {
        const settings = await saveIntegrationsSettings(req.body || {});
        auditChatSettings(req, 'chat_integrations', settings);
        res.json(settings);
    } catch (err) {
        log.error('PUT /settings/chat/integrations error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/settings/chat/guardian', requireRole(...CHAT_SETTINGS_ROLES), async (req, res) => {
    try {
        const [settings, ai] = await Promise.all([
            getStoredGuardianSettings(),
            getUnifiedAIConfig({ scope: 'guardian_ai' })
        ]);
        res.json({ ...settings, ai: publicAIConfig(ai) });
    } catch (err) {
        log.error('GET /settings/chat/guardian error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.put('/settings/chat/guardian', requireRole(...CHAT_SETTINGS_ROLES), async (req, res) => {
    try {
        const settings = await saveGuardianSettings(req.body || {});
        auditChatSettings(req, 'guardian_ai', {
            enabled: settings.enabled,
            digestEnabled: settings.digestEnabled,
            securityLogEnabled: settings.securityLogEnabled,
            analyticsEnabled: settings.analyticsEnabled,
            provider: settings.provider,
            model: settings.model,
            keySource: settings.keySource
        });
        const ai = await getUnifiedAIConfig({ scope: 'guardian_ai' });
        res.json({ ...settings, ai: publicAIConfig(ai) });
    } catch (err) {
        log.error('PUT /settings/chat/guardian error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/stats/:dateFrom/:dateTo', requireRole('creator', 'director'), async (req, res) => {
    try {
        const { dateFrom, dateTo } = req.params;
        if (!validateDate(dateFrom) || !validateDate(dateTo)) {
            return res.status(400).json({ error: 'Invalid date format' });
        }
        const params = [dateFrom, dateTo, DEFAULT_TIMELINE_CONTEXT];
        const visibility = getVisibleBookingScope(req.user, params, 'b');
        const result = await pool.query(
            `SELECT b.* FROM bookings b
             WHERE b.date >= $1 AND b.date <= $2
               AND b.business_context = $3
               AND b.linked_to IS NULL
               AND ${activeBookingStatusSql('b')}
               ${visibility.sql}
             ORDER BY b.date, b.time`,
            params
        );
        res.json(result.rows.map(mapBookingRow));
    } catch (err) {
        log.error('Stats error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Settings CRUD — v19.10: with in-memory cache
function timelineVisibilitySettingsKey(context) {
    return `timeline_visibility:${context || DEFAULT_TIMELINE_CONTEXT}`;
}

function sanitizeTimelineVisibilityPayload(body) {
    const rawOverrides = body?.overrides && typeof body.overrides === 'object' ? body.overrides : {};
    const overrides = {};
    for (const [key, value] of Object.entries(rawOverrides)) {
        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(key)) continue;
        overrides[key] = Boolean(value);
    }
    return { version: 1, overrides };
}

function timelineDisplaySettingsKey(context) {
    return `timeline_display:${context || DEFAULT_TIMELINE_CONTEXT}`;
}

function sanitizeTimelineDisplayPayload(body, context) {
    return normalizeTimelineDisplaySettings(body || {}, context);
}

router.get('/settings/timeline-visibility', async (req, res) => {
    try {
        const context = timelineContextFromRequest(req);
        if (!requireTimelineContext(req, res, context)) return;
        const key = timelineVisibilitySettingsKey(context);
        const cached = settingsCache.get(key);
        const raw = cached !== null
            ? cached
            : (await pool.query('SELECT value FROM settings WHERE key = $1', [key])).rows[0]?.value;
        if (cached === null) settingsCache.set(key, raw || null);

        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
        res.json({
            context,
            version: 1,
            overrides: parsed?.overrides && typeof parsed.overrides === 'object' ? parsed.overrides : {},
            updatedAt: parsed?.updatedAt || null,
            updatedBy: parsed?.updatedBy || null
        });
    } catch (err) {
        log.error('GET /settings/timeline-visibility error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.put('/settings/timeline-visibility', async (req, res) => {
    try {
        const context = timelineContextFromRequest(req);
        if (!requireTimelineAction(req, res, context, 'settings')) return;
        const key = timelineVisibilitySettingsKey(context);
        const payload = {
            ...sanitizeTimelineVisibilityPayload(req.body || {}),
            context,
            updatedAt: new Date().toISOString(),
            updatedBy: req.user?.username || req.user?.id || null
        };
        const value = JSON.stringify(payload);
        await pool.query(
            `INSERT INTO settings (key, value)
             VALUES ($1, $2)
             ON CONFLICT (key) DO UPDATE SET value = $2`,
            [key, value]
        );
        settingsCache.invalidate(key);
        logAdminAction('timeline_visibility_update', 'settings', {
            username: req.user?.username,
            target: key,
            details: { context, keys: Object.keys(payload.overrides || {}) },
            ip: req.ip,
            requestId: req.headers['x-request-id']
        });
        res.json(payload);
    } catch (err) {
        log.error('PUT /settings/timeline-visibility error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/settings/timeline-display', async (req, res) => {
    try {
        const context = timelineContextFromRequest(req);
        if (!requireTimelineContext(req, res, context)) return;
        const key = timelineDisplaySettingsKey(context);
        const cached = settingsCache.get(key);
        const raw = cached !== null
            ? cached
            : (await pool.query('SELECT value FROM settings WHERE key = $1', [key])).rows[0]?.value;
        if (cached === null) settingsCache.set(key, raw || null);

        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
        res.json({
            context,
            ...sanitizeTimelineDisplayPayload(parsed || {}, context),
            updatedAt: parsed?.updatedAt || null,
            updatedBy: parsed?.updatedBy || null
        });
    } catch (err) {
        log.error('GET /settings/timeline-display error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.put('/settings/timeline-display', async (req, res) => {
    try {
        const context = timelineContextFromRequest(req);
        if (!requireTimelineAction(req, res, context, 'settings')) return;
        const key = timelineDisplaySettingsKey(context);
        const payload = {
            ...sanitizeTimelineDisplayPayload(req.body || {}, context),
            context,
            updatedAt: new Date().toISOString(),
            updatedBy: req.user?.username || req.user?.id || null
        };
        const value = JSON.stringify(payload);
        await pool.query(
            `INSERT INTO settings (key, value)
             VALUES ($1, $2)
             ON CONFLICT (key) DO UPDATE SET value = $2`,
            [key, value]
        );
        settingsCache.invalidate(key);
        logAdminAction('timeline_display_update', 'settings', {
            username: req.user?.username,
            target: key,
            details: {
                context,
                mode: payload.mode,
                timelineEnabled: payload.timelineEnabled,
                startPage: payload.startPage,
                resourceModel: payload.resourceModel,
                enabledModules: Object.keys(payload.enabledModules || {}).filter(key => payload.enabledModules[key]),
                timelineFeatures: Object.keys(payload.timelineFeatures || {}).filter(key => payload.timelineFeatures[key]),
                parkKitchenMode: payload.parkKitchenMode
            },
            ip: req.ip,
            requestId: req.headers['x-request-id']
        });
        res.json(payload);
    } catch (err) {
        log.error('PUT /settings/timeline-display error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/business/profile', async (req, res) => {
    try {
        const scope = resolveBusinessScope(req);
        if (!requireBusinessScope(req, res, scope)) return;
        const businessProfile = await buildBusinessOperatingProfile(pool, req.user, {
            scope,
            includeIntegrations: true
        });
        res.json({
            success: true,
            businessContext: businessProfile.activeBusinessContext,
            businessScope: businessProfile.scope,
            businessProfile
        });
    } catch (err) {
        log.error('GET /business/profile error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.get('/business/cabinet', async (req, res) => {
    try {
        const context = businessContextFromRequest(req);
        if (!requireBusinessContext(req, res, context)) return;
        const cabinet = await getBusinessCabinetSettings(pool, context);
        res.json({
            success: true,
            businessContext: context,
            cabinet,
            catalog: businessCabinetCatalog()
        });
    } catch (err) {
        log.error('GET /business/cabinet error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.put('/business/cabinet', requireRole('creator', 'director'), async (req, res) => {
    try {
        const scope = resolveBusinessScope(req);
        if (!requireWritableBusinessScope(req, res, scope)) return;
        const context = businessContextFromRequest(req);
        if (!requireBusinessContext(req, res, context)) return;
        if (isTimelineContext(context) && !requireTimelineAction(req, res, context, 'settings')) return;
        const cabinet = await saveBusinessCabinetSettings(pool, context, req.body || {}, req.user);
        settingsCache.invalidate(businessCabinetSettingsKey(context));
        if (isTimelineContext(context)) settingsCache.invalidate(`timeline_display:${context}`);
        const businessProfile = await buildBusinessOperatingProfile(pool, req.user, {
            scope: { ...scope, activeContext: context, selectedContexts: [context] },
            includeIntegrations: true
        });
        logAdminAction('business_cabinet_update', 'settings', {
            username: req.user?.username,
            target: businessCabinetSettingsKey(context),
            details: {
                context,
                businessType: cabinet.businessType,
                timelineMode: cabinet.timelineMode,
                timelineEnabled: cabinet.timelineEnabled,
                startPage: cabinet.startPage,
                enabledModules: cabinet.modules?.enabledIds || [],
                disabledModules: cabinet.modules?.disabledIds || []
            },
            ip: req.ip,
            requestId: req.headers['x-request-id']
        });
        res.json({
            success: true,
            businessContext: context,
            cabinet,
            businessProfile
        });
    } catch (err) {
        log.error('PUT /business/cabinet error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.get('/settings/:key', async (req, res) => {
    try {
        const key = req.params.key;
        const cached = settingsCache.get(key);
        if (cached !== null) {
            return res.json({ value: cached });
        }
        const result = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
        const value = result.rows.length > 0 ? result.rows[0].value : null;
        settingsCache.set(key, value);
        res.json({ value });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/settings', requireRole('creator', 'director'), async (req, res) => {
    try {
        const { key, value } = req.body;
        if (!key || !validateSettingKey(key)) {
            return res.status(400).json({ error: 'Invalid setting key' });
        }
        if (typeof value !== 'string' || value.length > 1000) {
            return res.status(400).json({ error: 'Invalid setting value' });
        }
        await pool.query(
            `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`,
            [key, value]
        );
        settingsCache.invalidate(key);
        // v19.10: Audit trail for settings changes
        logAdminAction('settings_update', 'settings', {
            username: req.user?.username, target: key,
            details: { value: value.length > 50 ? value.slice(0, 50) + '...' : value },
            ip: req.ip, requestId: req.headers['x-request-id']
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v33.3: PUT /api/settings/language — dedicated language endpoint
router.put('/settings/language', requireRole('creator', 'director', 'admin', 'user'), async (req, res) => {
    try {
        const { value } = req.body;
        if (!['uk', 'en'].includes(value)) {
            return res.status(400).json({ error: 'value must be uk or en' });
        }
        await pool.query(
            `INSERT INTO settings (key, value) VALUES ('language', $1) ON CONFLICT (key) DO UPDATE SET value = $1`,
            [value]
        );
        settingsCache.invalidate('language');
        res.json({ success: true, value });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Free rooms
router.get('/rooms/free/:date/:time/:duration', async (req, res) => {
    try {
        const { date, time, duration } = req.params;
        if (!validateDate(date)) return res.status(400).json({ error: 'Invalid date' });
        if (!validateTime(time)) return res.status(400).json({ error: 'Invalid time' });
        const dur = parseInt(duration) || 60;
        const context = timelineContextFromRequest(req);
        if (!requireTimelineContext(req, res, context)) return;
        const display = await getTimelineDisplaySettings(pool, context);
        const resourceType = resourceTypeForDisplayMode(display.mode, display);
        if (resourceType) {
            return res.json(await timelineResourceAvailability(pool, {
                context,
                type: resourceType,
                date,
                time,
                duration: dur,
                capacity: req.query.capacity || req.query.attendees || req.query.kidsCount
            }));
        }

        const params = [date, context || DEFAULT_TIMELINE_CONTEXT];
        const visibility = getVisibleBookingScope(req.user, params, 'b');
        const bookings = await pool.query(
            `SELECT b.id, b.room, b.time, b.duration, b.label, b.program_code, b.program_name,
                    b.group_name, b.linked_to, c.name AS customer_name
             FROM bookings b
             LEFT JOIN customers c
               ON c.id = b.customer_id
              AND COALESCE(c.business_context, '${DEFAULT_TIMELINE_CONTEXT}') = COALESCE(b.business_context, '${DEFAULT_TIMELINE_CONTEXT}')
             WHERE b.date = $1 AND COALESCE(b.business_context, '${DEFAULT_TIMELINE_CONTEXT}') = $2 AND ${activeBookingStatusSql('b')}
             ${visibility.sql}`,
            params
        );

        const reqStart = timeToMinutes(time);
        const reqEnd = reqStart + dur;
        const excludeId = String(req.query.excludeId || req.query.exclude_id || '').trim();

        const occupiedRooms = new Set();
        for (const b of bookings.rows) {
            if (excludeId && String(b.id || '') === excludeId) continue;
            if (!b.room) continue;
            const bStart = timeToMinutes(b.time);
            const bEnd = bStart + (b.duration || 0);
            if (reqStart < bEnd && reqEnd > bStart) {
                occupiedRooms.add(b.room);
            }
        }

        const dayBookingsByRoom = {};
        for (const b of bookings.rows) {
            if (excludeId && String(b.id || '') === excludeId) continue;
            if (!b.room || String(b.linked_to || '').trim()) continue;
            if (!dayBookingsByRoom[b.room]) dayBookingsByRoom[b.room] = [];
            const customerName = b.customer_name || b.group_name || b.label || b.program_name || b.program_code || b.id;
            dayBookingsByRoom[b.room].push({
                id: b.id,
                time: b.time,
                duration: b.duration || 0,
                customerName,
                label: b.label || null,
                programName: b.program_name || null
            });
        }
        Object.values(dayBookingsByRoom).forEach(roomBookings => {
            roomBookings.sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')) || String(a.id || '').localeCompare(String(b.id || '')));
        });
        const rooms = ALL_ROOMS.map(room => ({
            name: room,
            occupied: occupiedRooms.has(room),
            free: !occupiedRooms.has(room),
            dayBookings: dayBookingsByRoom[room] || []
        }));
        const free = ALL_ROOMS.filter(r => !occupiedRooms.has(r));
        res.json({ free, occupied: Array.from(occupiedRooms), total: ALL_ROOMS.length, rooms, dayBookingsByRoom });
    } catch (err) {
        log.error('Free rooms error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v39.8: /version and /health moved before auth middleware (see above)

// v39.8: /health moved before auth middleware (see above)

// v8.3: Automation rules CRUD
router.get('/automation-rules', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM automation_rules ORDER BY created_at DESC LIMIT 500');
        res.json(result.rows);
    } catch (err) {
        if (err.message.includes('does not exist')) return res.json([]);
        log.error('Automation rules get error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/automation-rules', requireRole('creator', 'director'), async (req, res) => {
    try {
        const { name, trigger_type, trigger_condition, actions, days_before } = req.body;
        if (!name || !trigger_condition || !actions) {
            return res.status(400).json({ error: 'name, trigger_condition, actions required' });
        }
        const result = await pool.query(
            `INSERT INTO automation_rules (name, trigger_type, trigger_condition, actions, days_before)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [name, trigger_type || 'booking_create', trigger_condition, actions, days_before || 0]
        );
        res.json({ success: true, rule: result.rows[0] });
    } catch (err) {
        log.error('Automation rule create error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.put('/automation-rules/:id', requireRole('creator', 'director'), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, trigger_type, trigger_condition, actions, days_before, is_active } = req.body;
        await pool.query(
            `UPDATE automation_rules SET name=$1, trigger_type=$2, trigger_condition=$3, actions=$4, days_before=$5, is_active=$6 WHERE id=$7`,
            [name, trigger_type || 'booking_create', trigger_condition, actions, days_before || 0, is_active !== false, id]
        );
        res.json({ success: true });
    } catch (err) {
        log.error('Automation rule update error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.delete('/automation-rules/:id', requireRole('creator', 'director'), async (req, res) => {
    try {
        await pool.query('DELETE FROM automation_rules WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        log.error('Automation rule delete error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v17.9.0: System status — management-only comprehensive health dashboard
router.get('/system-status', requireRole('creator', 'director', 'vice_director', 'senior_manager'), async (req, res) => {
    try {
        const startMs = Date.now();

        // DB table counts for key entities
        // v19.10: Use hardcoded Set to ensure only known table names are used (prevent SQL injection)
        const ALLOWED_STATUS_TABLES = new Set(['bookings', 'users', 'tasks', 'customers', 'finance_transactions', 'staff', 'certificates', 'contractors', 'warehouse_stock', 'procurement_lists']);
        const counts = {};
        for (const t of ALLOWED_STATUS_TABLES) {
            try {
                const r = await pool.query(`SELECT COUNT(*)::int AS c FROM "${t}"`);
                counts[t] = r.rows[0].c;
            } catch { counts[t] = null; }
        }

        // Last backup — from settings or action log
        let lastBackup = null;
        try {
            const bkpR = await pool.query(
                "SELECT created_at FROM user_action_log WHERE action = 'api:POST' AND target LIKE '%backup%' ORDER BY created_at DESC LIMIT 1"
            );
            if (bkpR.rows.length > 0) lastBackup = bkpR.rows[0].created_at;
        } catch { /* ignore */ }

        // Active users in last 24h
        let activeUsers24h = 0;
        try {
            const auR = await pool.query(
                "SELECT COUNT(DISTINCT username)::int AS c FROM user_action_log WHERE created_at > NOW() - INTERVAL '24 hours'"
            );
            activeUsers24h = auR.rows[0].c;
        } catch { /* ignore */ }

        // Recent API errors (4xx/5xx in last hour)
        let recentErrors = 0;
        try {
            const errR = await pool.query(
                "SELECT COUNT(*)::int AS c FROM user_action_log WHERE created_at > NOW() - INTERVAL '1 hour' AND meta->>'status' >= '400'"
            );
            recentErrors = errR.rows[0].c;
        } catch { /* ignore */ }

        // Migrations
        let migrations = [];
        try {
            const mgR = await pool.query('SELECT version, applied_at FROM schema_migrations ORDER BY applied_at DESC LIMIT 5');
            migrations = mgR.rows;
        } catch { /* ignore */ }

        const mem = process.memoryUsage();

        res.json({
            ok: true,
            checked_at: new Date().toISOString(),
            elapsed_ms: Date.now() - startMs,
            database: { connected: true, counts },
            activity: { active_users_24h: activeUsers24h, recent_errors_1h: recentErrors },
            backup: { last_triggered: lastBackup },
            memory_mb: {
                rss: Math.round(mem.rss / 1024 / 1024),
                heap_used: Math.round(mem.heapUsed / 1024 / 1024),
                heap_total: Math.round(mem.heapTotal / 1024 / 1024),
            },
            uptime_hours: Math.round(process.uptime() / 3600 * 10) / 10,
            node_version: process.version,
            migrations,
        });
    } catch (err) {
        log.error(`System status error: ${err.message}`);
        res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;

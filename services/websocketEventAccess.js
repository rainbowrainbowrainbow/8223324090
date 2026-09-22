'use strict';

const { pool } = require('../db');
const { applyMembershipAccess, loadMembershipAccess } = require('./businessMembership');
const { canAccessBusinessContext, normalizeBusinessContext, normalizeKnownBusinessContext, normalizeBusinessScopeMode, BUSINESS_SCOPE_SINGLE } = require('./businessContext');
const { resolveCapability } = require('./accountAccessPolicy');
const { canViewBooking } = require('./bookingVisibility');
const { buildTaskVisibilityScope } = require('./taskPolicy');
const { legacyBusinessSurfaceAccess } = require('./legacyBusinessSurface');
const { recordCompatibilityTelemetrySafe } = require('./businessCutover');
const { createLogger } = require('../utils/logger');

const TASK_EVENTS = new Set(['task:assigned', 'task:schedule_changed', 'task:slot_missed']);
const CHAT_EVENTS = new Set([
    'chat:joined', 'chat:left', 'chat:typing', 'chat:message', 'chat:booking-preview',
    'chat:mention', 'chat:channel-invite', 'chat:link-preview', 'chat:read', 'chat:reaction',
    'chat:edit', 'chat:delete', 'chat:pin', 'chat:member-added', 'chat:task', 'chat:thread-reply',
    'chat:poll-update', 'chat:poll-closed', 'chat:important', 'chat:super-reaction',
    'chat:message-edited', 'chat:user-muted', 'chat:user-unmuted'
]);
const PRESENCE_EVENTS = new Set(['user:online', 'user:offline', 'user:status']);
const ACCOUNT_TRANSCRIPT_EVENTS = new Set(['kleshnya:thinking', 'kleshnya:reply', 'kleshnya:media']);
const BUSINESS_EVENTS = new Set(['omni:message', 'omni:conversation']);
const log = createLogger('WebSocketBusinessAccess');

function positiveId(value) {
    if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return null;
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function explicitContext(value) {
    if (typeof value !== 'string') return null;
    const raw = value.trim().toLowerCase();
    if (!raw || normalizeBusinessScopeMode(raw) !== BUSINESS_SCOPE_SINGLE) return null;
    if (!normalizeKnownBusinessContext(raw) && !/^[a-z][a-z0-9_]{2,63}$/.test(raw)) return null;
    return normalizeBusinessContext(raw);
}

function telemetryBusinessContext(values = []) {
    const context = matchingContexts(values);
    return context || 'unknown';
}

function recordWebSocketTelemetry(businessContext, allowed) {
    recordCompatibilityTelemetrySafe(pool, {
        businessContext,
        entryFamily: 'websocket',
        decisionStage: 'serialization',
        authoritySource: businessContext === 'unknown' ? 'unknown' : 'membership',
        outcome: allowed ? 'allowed' : 'denied'
    }, log);
}

function matchingContexts(values) {
    const supplied = values.filter(value => value !== undefined && value !== null);
    if (!supplied.length) return null;
    const contexts = supplied.map(explicitContext);
    return contexts.every(context => context && context === contexts[0]) ? contexts[0] : null;
}

async function loadBusinessEventUser(freshUser, context) {
    const businessContext = explicitContext(context);
    if (!positiveId(freshUser?.id) || !businessContext || freshUser.is_active === false) return null;
    const access = await loadMembershipAccess(pool, freshUser, businessContext);
    if (access.invalid || access.testDoubleUnavailable) return null;
    const scopedUser = applyMembershipAccess(freshUser, access);
    return canAccessBusinessContext(scopedUser, businessContext) ? scopedUser : null;
}

async function canReceiveLegacyAccountSurface(freshUser, surface) {
    // Socket profiles normalize missing defaults. Read the explicit stored value
    // so neither that fallback nor an event payload can manufacture Park access.
    const account = await pool.query('SELECT default_business_context FROM users WHERE id = $1', [freshUser.id]);
    const context = explicitContext(account.rows[0]?.default_business_context);
    if (!context) return false;
    const user = await loadBusinessEventUser(freshUser, context);
    return Boolean(user && legacyBusinessSurfaceAccess({ user, query: { businessContext: context } }, surface).available);
}

async function canReceiveTask(freshUser, data) {
    const taskId = positiveId(data?.task?.id);
    if (!taskId) return false;
    const result = await pool.query('SELECT id, business_context FROM tasks WHERE id = $1', [taskId]);
    const task = result.rows[0];
    if (!task) return false;
    const businessContext = matchingContexts([
        task.business_context, data.task.businessContext, data.task.business_context,
        data.businessContext, data.business_context, data.meta?.businessContext
    ]);
    if (!businessContext || !explicitContext(task.business_context)) return false;
    const user = await loadBusinessEventUser(freshUser, businessContext);
    if (!user) return false;
    const params = [taskId, businessContext];
    // Reuse HTTP task privacy, ownership, observer and department policy. A
    // recipient ID alone does not prove that a former owner may still read it.
    const visibility = buildTaskVisibilityScope(user, params, 't');
    const visible = await pool.query(
        `SELECT t.id FROM tasks t WHERE t.id = $1 AND t.business_context = $2 ${visibility}`,
        params
    );
    return visible.rows.length > 0;
}

async function canReceiveBooking(freshUser, bookingId) {
    if (!['string', 'number'].includes(typeof bookingId) || String(bookingId).trim() === '') return false;
    const result = await pool.query('SELECT b.* FROM bookings b WHERE b.id = $1', [String(bookingId)]);
    const booking = result.rows[0];
    if (!booking) return false;
    const user = await loadBusinessEventUser(freshUser, booking.business_context);
    return Boolean(user && canViewBooking(user, booking));
}

async function canReceiveChannel(freshUser, data, options) {
    const channelId = positiveId(options.channelId ?? data.channelId);
    if (!channelId || (data.channelId !== undefined && positiveId(data.channelId) !== channelId)) return false;
    const result = await pool.query(
        `SELECT c.* FROM chat_channels c JOIN chat_channel_members cm ON cm.channel_id = c.id
         WHERE c.id = $1 AND cm.user_id = $2 AND COALESCE(c.is_archived, false) = false`,
        [channelId, freshUser.id]
    );
    const channel = result.rows[0];
    if (!channel) return false;
    const bookingLinks = [channel.linked_booking_id,
        channel.linked_entity_type === 'booking' ? channel.linked_entity_id : null]
        .filter(value => value !== undefined && value !== null && String(value).trim() !== '')
        .map(String);
    if (new Set(bookingLinks).size > 1) return false;
    if (bookingLinks.length && !await canReceiveBooking(freshUser, bookingLinks[0])) return false;
    if (channel.type === 'booking' && !bookingLinks.length) return false;

    let metadata = data.message?.metadata;
    if (typeof metadata === 'string') {
        try { metadata = JSON.parse(metadata); } catch { return false; }
    }
    const previews = [data.bookingPreview, metadata?.bookingPreview].filter(value => value !== undefined && value !== null);
    for (const preview of previews) {
        if (!await canReceiveBooking(freshUser, preview?.id)) return false;
    }
    // Unowned channels share the REST containment policy. A validated booking
    // link keeps its existing business/visibility contract above.
    return bookingLinks.length > 0 || canReceiveLegacyAccountSurface(freshUser, 'chat');
}

async function canReceivePresence(freshUser, data) {
    const targetId = positiveId(data.userId);
    if (!targetId) return false;
    const shared = await pool.query(
        `SELECT 1 FROM organization_memberships recipient
         JOIN organization_memberships subject ON subject.organization_id = recipient.organization_id
         JOIN organizations o ON o.id = recipient.organization_id AND o.status = 'active'
         WHERE recipient.user_id = $1 AND subject.user_id = $2
           AND recipient.is_active IS TRUE AND subject.is_active IS TRUE LIMIT 1`,
        [freshUser.id, targetId]
    );
    if (shared.rows.length) return true;
    const registry = await pool.query('SELECT id FROM organizations LIMIT 1');
    return registry.rows.length === 0;
}

async function canReceiveAttendance(freshUser, data, options) {
    const recordId = positiveId(data.hrTimeRecord?.id);
    const declared = [options.businessContext, data.businessContext, data.business_context,
        data.hrTimeRecord?.business_context, data.hrTimeRecord?.businessContext];
    if (recordId) {
        const result = await pool.query('SELECT business_context FROM hr_time_records WHERE id = $1', [recordId]);
        if (!result.rows[0] || !explicitContext(result.rows[0].business_context)) return false;
        declared.push(result.rows[0].business_context);
    }
    const context = matchingContexts(declared);
    const user = context && await loadBusinessEventUser(freshUser, context);
    return Boolean(user && resolveCapability(user, 'hr.today.view', { type: 'action' }).allowed);
}

async function canReceiveEventDecision(freshUser, eventType, data = {}, options = {}) {
    if (!positiveId(freshUser?.id) || freshUser.is_active === false || !data || typeof data !== 'object') return false;
    // These events must pass the specialized timeline audience/visibility path.
    if (/^(booking:|line:|banquet:)/.test(eventType) || eventType === 'timeline:roster-updated') return false;
    if (TASK_EVENTS.has(eventType)) return canReceiveTask(freshUser, data);
    if (CHAT_EVENTS.has(eventType)) return canReceiveChannel(freshUser, data, options);
    if (PRESENCE_EVENTS.has(eventType)) return canReceivePresence(freshUser, data);
    if (eventType === 'guardian:mood') return Object.entries(data).every(([key, value]) =>
        ['emoji', 'label', 'level', 'prevEmoji'].includes(key) && typeof value === 'string');
    if (eventType === 'alert:updated') return Object.keys(data).every(key => ['alerts', 'count'].includes(key))
        && Array.isArray(data.alerts) && data.alerts.length === 0 && data.count === 0;
    if (eventType === 'guardian:event' || eventType === 'guardian:health') return canReceiveChannel(freshUser, data, options);
    if (eventType === 'hr:attendance-updated') return canReceiveAttendance(freshUser, data, options);
    if (ACCOUNT_TRANSCRIPT_EVENTS.has(eventType)) {
        return options.delivery === 'username' && canReceiveLegacyAccountSurface(freshUser, 'kleshnya');
    }
    if (BUSINESS_EVENTS.has(eventType)) {
        const context = matchingContexts([options.businessContext, data.businessContext, data.business_context]);
        const user = context && await loadBusinessEventUser(freshUser, context);
        return Boolean(user && resolveCapability(user, '/omni', { type: 'page' }).allowed
            && (!options.page || resolveCapability(user, options.page, { type: 'page' }).allowed));
    }
    return false;
}

async function canReceiveEvent(freshUser, eventType, data = {}, options = {}) {
    const businessContext = telemetryBusinessContext([
        options.businessContext, options.business_context, data.businessContext, data.business_context,
        data.task?.businessContext, data.task?.business_context, data.hrTimeRecord?.businessContext, data.hrTimeRecord?.business_context,
        data.meta?.businessContext
    ]);
    const allowed = await canReceiveEventDecision(freshUser, eventType, data, options);
    recordWebSocketTelemetry(businessContext, allowed);
    return allowed;
}

module.exports = { loadBusinessEventUser, canReceiveEvent };

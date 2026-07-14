'use strict';

const express = require('express');
const { HERMES_INTEGRATION_ID } = require('../middleware/hermesAuth');
const { canUseAction } = require('../middleware/auth');
const { DEFAULT_BUSINESS_CONTEXT } = require('../services/businessContext');
const {
    activeStaffWhere,
    scheduleableStaffWhere
} = require('../services/staffOperationalFilters');
const { staffProfessionKeys } = require('../services/professions');
const {
    applyHermesScheduleImport,
    buildScheduleCellStateHash,
    normalizeHermesScheduleStatus,
    previewHermesScheduleImport
} = require('../services/hermesScheduleImport');
const { createHermesMutationGuard } = require('../services/hermesMutationGuard');
const { withHermesIdempotency } = require('../services/hermesIdempotency');
const { sendTelegramMessage, getConfiguredChatId } = require('../services/telegram');
const { broadcastLineEvent } = require('../services/websocket');
const { createLogger } = require('../utils/logger');

const log = createLogger('HermesSchedule');
const MAX_STAFF_LIMIT = 50;
const MAX_SCHEDULE_DAYS = 31;
const MAX_STAFF_IDS = 50;
const HERMES_SCHEDULE_BUSINESS_CONTEXT = DEFAULT_BUSINESS_CONTEXT;

function sendHermesScheduleError(res, status, code, error, meta = undefined) {
    const body = { success: false, error, code };
    if (meta && typeof meta === 'object' && Object.keys(meta).length) body.meta = meta;
    return res.status(status).json(body);
}

function hermesScheduleError(statusCode, code, message, details = undefined) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    if (details !== undefined) error.details = details;
    return error;
}

function parseBoolean(value, fallback, fieldName) {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    throw hermesScheduleError(400, 'HERMES_INVALID_FILTER', `${fieldName} must be true or false`);
}

function parseStaffLimit(value) {
    if (value === undefined || value === null || value === '') return MAX_STAFF_LIMIT;
    if (!/^\d+$/.test(String(value).trim())) {
        throw hermesScheduleError(400, 'HERMES_INVALID_FILTER', 'limit must be a positive integer');
    }
    const limit = Number(value);
    if (!Number.isSafeInteger(limit) || limit <= 0) {
        throw hermesScheduleError(400, 'HERMES_INVALID_FILTER', 'limit must be a positive integer');
    }
    return Math.min(limit, MAX_STAFF_LIMIT);
}

function encodeStaffCursor(staffId) {
    return Buffer.from(JSON.stringify({ staffId: Number(staffId) })).toString('base64url');
}

function decodeStaffCursor(value) {
    if (!value) return null;
    try {
        const decoded = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
        const staffId = Number(decoded.staffId ?? decoded.staff_id);
        if (!Number.isSafeInteger(staffId) || staffId <= 0) throw new Error('invalid cursor');
        return staffId;
    } catch {
        throw hermesScheduleError(400, 'HERMES_INVALID_CURSOR', 'Invalid staff cursor');
    }
}

function normalizeStaffQuery(value) {
    if (value === undefined || value === null || value === '') return null;
    const query = String(value).normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('uk-UA');
    if (!query) return null;
    if (query.length > 160) {
        throw hermesScheduleError(400, 'HERMES_INVALID_FILTER', 'q is too long');
    }
    return query;
}

function parseDateOnly(value, fieldName) {
    const text = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        throw hermesScheduleError(400, 'HERMES_INVALID_DATE_RANGE', `${fieldName} must use YYYY-MM-DD`);
    }
    const parsed = new Date(`${text}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
        throw hermesScheduleError(400, 'HERMES_INVALID_DATE_RANGE', `${fieldName} is not a valid date`);
    }
    return { text, time: parsed.getTime() };
}

function parseScheduleDateRange(query = {}) {
    const from = parseDateOnly(query.dateFrom, 'dateFrom');
    const to = parseDateOnly(query.dateTo, 'dateTo');
    const days = Math.floor((to.time - from.time) / 86400000) + 1;
    if (days <= 0 || days > MAX_SCHEDULE_DAYS) {
        throw hermesScheduleError(
            400,
            'HERMES_INVALID_DATE_RANGE',
            `dateFrom/dateTo must cover between 1 and ${MAX_SCHEDULE_DAYS} days`
        );
    }
    return { dateFrom: from.text, dateTo: to.text, days };
}

function parseStaffIds(value) {
    if (value === undefined || value === null || value === '') return [];
    const rawItems = Array.isArray(value) ? value : String(value).split(',');
    const ids = [];
    const seen = new Set();
    for (const raw of rawItems) {
        const text = String(raw).trim();
        if (!/^\d+$/.test(text)) {
            throw hermesScheduleError(400, 'HERMES_INVALID_FILTER', 'staffIds must contain positive integers');
        }
        const id = Number(text);
        if (!Number.isSafeInteger(id) || id <= 0) {
            throw hermesScheduleError(400, 'HERMES_INVALID_FILTER', 'staffIds must contain positive integers');
        }
        if (!seen.has(id)) {
            seen.add(id);
            ids.push(id);
        }
    }
    if (ids.length > MAX_STAFF_IDS) {
        throw hermesScheduleError(400, 'HERMES_INVALID_FILTER', `staffIds supports at most ${MAX_STAFF_IDS} ids`);
    }
    return ids.sort((left, right) => left - right);
}

function actorBusinessContexts(user = {}) {
    return new Set([
        ...(Array.isArray(user.businessContexts) ? user.businessContexts : []),
        ...(Array.isArray(user.business_contexts) ? user.business_contexts : []),
        user.defaultBusinessContext,
        user.default_business_context
    ].map(value => String(value || '').trim().toLowerCase()).filter(Boolean));
}

function assertHermesScheduleAccess(req) {
    if (req.integration?.id !== HERMES_INTEGRATION_ID
        || !['x-api-key', 'authorization-bearer'].includes(req.integration?.authMode)) {
        throw hermesScheduleError(401, 'HERMES_AUTH_REQUIRED', 'Hermes API key authentication is required');
    }
    const requestedContext = String(
        req.query?.businessContext
        ?? req.query?.business_context
        ?? req.body?.businessContext
        ?? req.body?.business_context
        ?? HERMES_SCHEDULE_BUSINESS_CONTEXT
    ).trim().toLowerCase();
    if (requestedContext !== HERMES_SCHEDULE_BUSINESS_CONTEXT
        || !actorBusinessContexts(req.user).has(HERMES_SCHEDULE_BUSINESS_CONTEXT)) {
        throw hermesScheduleError(
            403,
            'HERMES_SCHEDULE_BUSINESS_CONTEXT_UNAVAILABLE',
            'Hermes staff schedule reads currently support event_genix only'
        );
    }
    return HERMES_SCHEDULE_BUSINESS_CONTEXT;
}

function mapHermesStaff(row = {}) {
    return {
        staffId: Number(row.id),
        name: row.name || '',
        displayName: row.display_name || row.name || '',
        department: row.department || null,
        position: row.position || null,
        professions: staffProfessionKeys(row),
        scheduleable: row.scheduleable === true
    };
}

function mapHermesScheduleCell(row = {}) {
    const cell = {
        staffId: Number(row.staff_id),
        date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date || '').slice(0, 10),
        status: normalizeHermesScheduleStatus(row.status),
        startTime: row.shift_start ? String(row.shift_start).slice(0, 5) : null,
        endTime: row.shift_end ? String(row.shift_end).slice(0, 5) : null,
        note: row.note || null,
        professionKey: row.profession_key || null
    };
    return { ...cell, stateHash: buildScheduleCellStateHash(cell) };
}

async function notifyHermesScheduleApplySummary(db, changes = [], options = {}) {
    if (!changes.length) return { sent: false, reason: 'no_changes' };
    const staffIds = [...new Set(changes.map(change => Number(change.staffId)).filter(Boolean))];
    const staff = await db.query(
        `SELECT id, name, telegram_username
         FROM staff
         WHERE id = ANY($1::int[])`,
        [staffIds]
    );
    const staffById = new Map(staff.rows.map(row => [Number(row.id), row]));
    const details = changes.slice(0, 20).map(change => {
        const staffRow = staffById.get(Number(change.staffId));
        const staffLabel = staffRow?.telegram_username
            ? `@${staffRow.telegram_username}`
            : (staffRow?.name || `#${change.staffId}`);
        const time = change.plan?.plannedStart && change.plan?.plannedEnd
            ? ` · ${change.plan.plannedStart}–${change.plan.plannedEnd}`
            : '';
        return `• ${change.date} · ${staffLabel} · ${change.status}${time}`;
    });
    if (changes.length > details.length) details.push(`… ще ${changes.length - details.length} змін`);
    const previewId = options.previewId ? ` · ${options.previewId}` : '';
    const text = `📅 Hermes застосував графік (${changes.length})${previewId}\n${details.join('\n')}`;
    const getChatId = options.getConfiguredChatId || getConfiguredChatId;
    const sendMessage = options.sendTelegramMessage || sendTelegramMessage;
    const chatId = await getChatId();
    if (!chatId) return { sent: false, reason: 'chat_not_configured' };
    await sendMessage(chatId, text.length > 3900 ? `${text.slice(0, 3870)}\n…` : text);
    return { sent: true };
}

function broadcastHermesRosterDates(dates = [], actorUserId = null, options = {}) {
    const broadcastRoster = options.broadcastLineEvent || broadcastLineEvent;
    const uniqueDates = [...new Set(dates.map(value => String(value || '').slice(0, 10)).filter(Boolean))].sort();
    for (const date of uniqueDates) {
        broadcastRoster('timeline:roster-updated', {
            businessContext: HERMES_SCHEDULE_BUSINESS_CONTEXT,
            date
        }, actorUserId);
    }
    return uniqueDates;
}

function createHermesScheduleRouter(options = {}) {
    const router = express.Router();
    const db = options.pool;
    if (!db || typeof db.query !== 'function') {
        throw new Error('Hermes schedule router requires a queryable pool');
    }
    const applyMutationGuard = createHermesMutationGuard({
        integrationId: HERMES_INTEGRATION_ID,
        requireIntegrationId: true
    });
    const runWithIdempotency = options.withIdempotency || withHermesIdempotency;
    const applyScheduleImport = options.applyScheduleImport || applyHermesScheduleImport;
    const notifyScheduleBatch = options.notifyScheduleBatch || notifyHermesScheduleApplySummary;
    const broadcastRosterDates = options.broadcastRosterDates || broadcastHermesRosterDates;

    const requireHermesScheduleAccess = (req, res, next) => {
        try {
            assertHermesScheduleAccess(req);
            next();
        } catch (error) {
            sendHermesScheduleError(res, error.statusCode || 403, error.code || 'HERMES_SCHEDULE_FORBIDDEN', error.message);
        }
    };

    router.get('/staff', requireHermesScheduleAccess, async (req, res) => {
        try {
            const scheduleableOnly = parseBoolean(req.query.scheduleable, true, 'scheduleable');
            const includeFreelance = parseBoolean(
                req.query.includeFreelance ?? req.query.include_freelance,
                false,
                'includeFreelance'
            );
            const limit = parseStaffLimit(req.query.limit);
            const cursor = decodeStaffCursor(req.query.cursor);
            const normalizedQuery = normalizeStaffQuery(req.query.q);
            const params = [];
            const where = [];
            const scheduleableSql = scheduleableStaffWhere('s', {
                dateExpression: 'CURRENT_DATE',
                includeFreelance
            });

            where.push(scheduleableOnly
                ? scheduleableSql
                : activeStaffWhere('s', {
                    poolMode: 'not_blacklisted',
                    dateExpression: 'CURRENT_DATE',
                    includeFreelance
                }));
            if (cursor) {
                params.push(cursor);
                where.push(`s.id > $${params.length}`);
            }
            if (normalizedQuery) {
                params.push(normalizedQuery);
                const ref = `$${params.length}`;
                where.push(`(
                    LOWER(REGEXP_REPLACE(BTRIM(s.name), '\\s+', ' ', 'g')) = ${ref}
                    OR LOWER(REGEXP_REPLACE(BTRIM(COALESCE(NULLIF(s.display_name, ''), s.name)), '\\s+', ' ', 'g')) = ${ref}
                )`);
            }
            params.push(limit + 1);
            const result = await db.query(
                `SELECT s.id,
                        s.name,
                        COALESCE(NULLIF(s.display_name, ''), s.name) AS display_name,
                        s.department,
                        s.position,
                        s.role_type,
                        COALESCE(s.secondary_professions, '[]'::jsonb) AS secondary_professions,
                        (${scheduleableSql}) AS scheduleable
                 FROM staff s
                 WHERE ${where.join('\n                   AND ')}
                 ORDER BY s.id ASC
                 LIMIT $${params.length}`,
                params
            );
            const hasMore = result.rows.length > limit;
            const pageRows = result.rows.slice(0, limit);
            return res.json({
                success: true,
                items: pageRows.map(mapHermesStaff),
                pagination: {
                    nextCursor: hasMore && pageRows.length ? encodeStaffCursor(pageRows.at(-1).id) : null,
                    hasMore,
                    limit
                },
                meta: {
                    businessContext: HERMES_SCHEDULE_BUSINESS_CONTEXT,
                    scheduleable: scheduleableOnly,
                    includeFreelance,
                    qMatch: normalizedQuery ? 'normalized_exact' : null,
                    sanitized: true,
                    readOnly: true
                }
            });
        } catch (error) {
            if (error.statusCode && error.statusCode < 500) {
                return sendHermesScheduleError(res, error.statusCode, error.code, error.message, error.details);
            }
            log.error('GET /api/hermes/staff failed', error);
            return sendHermesScheduleError(res, 500, 'HERMES_INTERNAL_ERROR', 'Failed to read Hermes staff');
        }
    });

    router.get('/staff-schedule', requireHermesScheduleAccess, async (req, res) => {
        try {
            const range = parseScheduleDateRange(req.query);
            const staffIds = parseStaffIds(req.query.staffIds ?? req.query.staff_ids);
            const params = [range.dateFrom, range.dateTo];
            const where = [
                'ss.date >= $1::date',
                'ss.date <= $2::date',
                scheduleableStaffWhere('s', { dateExpression: 'ss.date', includeFreelance: false })
            ];
            if (staffIds.length) {
                params.push(staffIds);
                where.push(`ss.staff_id = ANY($${params.length}::int[])`);
            }
            const result = await db.query(
                `SELECT ss.staff_id,
                        ss.date::text AS date,
                        ss.status,
                        ss.shift_start,
                        ss.shift_end,
                        ss.note,
                        ss.profession_key
                 FROM staff_schedule ss
                 JOIN staff s ON s.id = ss.staff_id
                 WHERE ${where.join('\n                   AND ')}
                 ORDER BY ss.date ASC, ss.staff_id ASC`,
                params
            );
            return res.json({
                success: true,
                items: result.rows.map(mapHermesScheduleCell),
                meta: {
                    businessContext: HERMES_SCHEDULE_BUSINESS_CONTEXT,
                    dateFrom: range.dateFrom,
                    dateTo: range.dateTo,
                    days: range.days,
                    staffIds,
                    sanitized: true,
                    readOnly: true
                }
            });
        } catch (error) {
            if (error.statusCode && error.statusCode < 500) {
                return sendHermesScheduleError(res, error.statusCode, error.code, error.message, error.details);
            }
            log.error('GET /api/hermes/staff-schedule failed', error);
            return sendHermesScheduleError(res, 500, 'HERMES_INTERNAL_ERROR', 'Failed to read Hermes staff schedule');
        }
    });

    router.post('/staff-schedule/preview', requireHermesScheduleAccess, async (req, res) => {
        try {
            const preview = await previewHermesScheduleImport(db, req.body || {}, {
                actorUserId: req.integration?.actorUserId || req.user?.id,
                businessContext: HERMES_SCHEDULE_BUSINESS_CONTEXT
            });
            return res.status(preview.created ? 201 : 200).json(preview);
        } catch (error) {
            if (error.statusCode && error.statusCode < 500) {
                return sendHermesScheduleError(res, error.statusCode, error.code, error.message, error.details);
            }
            log.error('POST /api/hermes/staff-schedule/preview failed', error);
            return sendHermesScheduleError(
                res,
                500,
                'HERMES_INTERNAL_ERROR',
                'Failed to create Hermes schedule preview'
            );
        }
    });

    router.post(
        '/staff-schedule/apply',
        requireHermesScheduleAccess,
        applyMutationGuard,
        (req, res, next) => {
            if (!canUseAction(req.user, 'manage_staff')) {
                return sendHermesScheduleError(
                    res,
                    403,
                    'HERMES_MANAGE_STAFF_REQUIRED',
                    'Hermes actor does not have manage_staff permission'
                );
            }
            return next();
        },
        async (req, res) => {
            if (typeof db.connect !== 'function') {
                return sendHermesScheduleError(
                    res,
                    503,
                    'HERMES_SCHEDULE_TRANSACTION_UNAVAILABLE',
                    'Hermes schedule apply requires a transactional database pool'
                );
            }
            try {
                return await runWithIdempotency(req, res, async context => {
                    const applied = await applyScheduleImport(context.pool, req.body || {}, {
                        actor: { user: req.user, ip: req.ip },
                        actorUserId: req.integration?.actorUserId || req.user?.id,
                        businessContext: HERMES_SCHEDULE_BUSINESS_CONTEXT,
                        integrationId: HERMES_INTEGRATION_ID
                    });
                    if (applied.changes.length) {
                        context.afterCommit.push(() => {
                            Promise.resolve(notifyScheduleBatch(db, applied.changes, {
                                previewId: applied.response.previewId
                            })).catch(error => log.error('Hermes schedule apply notification failed', error));
                            broadcastRosterDates(
                                applied.dates,
                                req.integration?.actorUserId || req.user?.id
                            );
                        });
                    }
                    return { status: 200, body: applied.response };
                }, {
                    pool: db,
                    transactional: true,
                    requestPath: '/api/hermes/staff-schedule/apply'
                });
            } catch (error) {
                log.error('POST /api/hermes/staff-schedule/apply failed', error);
                return sendHermesScheduleError(
                    res,
                    500,
                    'HERMES_INTERNAL_ERROR',
                    'Failed to apply Hermes schedule preview'
                );
            }
        }
    );

    return router;
}

module.exports = createHermesScheduleRouter({
    pool: require('../db').pool
});
module.exports.createHermesScheduleRouter = createHermesScheduleRouter;
module.exports.decodeStaffCursor = decodeStaffCursor;
module.exports.encodeStaffCursor = encodeStaffCursor;
module.exports.mapHermesScheduleCell = mapHermesScheduleCell;
module.exports.mapHermesStaff = mapHermesStaff;
module.exports.broadcastHermesRosterDates = broadcastHermesRosterDates;
module.exports.notifyHermesScheduleApplySummary = notifyHermesScheduleApplySummary;
module.exports.parseScheduleDateRange = parseScheduleDateRange;
module.exports.parseStaffIds = parseStaffIds;
